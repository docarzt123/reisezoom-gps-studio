"""MCP-Server `gpsstudio mcp` (13.10.2026) — GPS Studio für KI-Assistenten (Claude & Co.) steuerbar.

Marc 09.10.2026: „nur Stufe 1 (lokaler MCP-Server: Touren suchen, Schnell-Video rendern, Kartenbild, Fortschritt; nur
lesen + in Ausgabeordner schreiben) … keine Cloud-API“. Läuft lokal über stdio (eine JSON-RPC-Nachricht je Zeile,
Model Context Protocol), gestartet vom KI-Programm:

    { "mcpServers": { "gps-studio": { "command": "~/.local/bin/gpsstudio", "args": ["mcp"] } } }

Werkzeuge (Namen und Texte englisch wie die Kommandozeile):
  search_tours     Touren des Archivs suchen (nur lesend, wie `gpsstudio tours`)
  list_templates   Vorlagen fürs Video
  render_video     Schnell-Video einer Tour als Auftrag starten → job_id
  render_map_image Kartenbild (PNG) einer Tour als Auftrag starten → job_id
  job_status       Stand eines Auftrags (wartet auf Wunsch bis zu 50 s); fertig → Datei, beim Kartenbild auch eine Vorschau
  cancel_job       Auftrag abbrechen

Video und Kartenbild dauern Minuten — länger, als ein KI-Programm auf eine Antwort wartet. Darum laufen sie als
Aufträge nacheinander im Hintergrund, jeder als eigener Aufruf der Kommandozeile (`gpsstudio render` / `map-image`):
dieselbe Render-Logik wie in der App, eigener Prozess, eigener Temp-Ordner. Geschrieben wird nur in den Ausgabeordner
(Render-Ordner der App oder `--out-dir`), nie überschrieben (Zeitstempel davor). Die KI kann keinen Zielpfad wählen.
stdout gehört allein dem Protokoll; alles andere geht nach stderr.
"""
from __future__ import annotations

import base64
import io
import itertools
import json
import os
import queue
import re
import subprocess
import sys
import threading
import time
from pathlib import Path

PROTOKOLLE = ("2025-06-18", "2025-03-26", "2024-11-05")
WARTEN_MAX = 50.0          # job_status wartet höchstens so lange (KI-Programme brechen Anfragen nach ~60 s ab)
VORSCHAU_PX = 1024         # Kartenbild-Vorschau für die KI (lange Kante)

ANWEISUNG = ("GPS Studio makes animated map videos and map images of GPS tours from the user's local archive. "
             "Find a tour with search_tours (words: name, place, year, tag), then start render_video or render_map_image "
             "with its id. Rendering takes minutes: poll job_status with the job_id (it waits up to 50 s per call) until "
             "the state is 'done', then tell the user the file path. Files go to the GPS Studio output folder and are "
             "never overwritten. Everything runs locally; nothing is uploaded.")

WERKZEUGE = [
    {"name": "search_tours",
     "title": "Search tours",
     "description": "Search the tours in the user's GPS Studio archive (read-only). Words match name, place, year, tag, note "
                    "and attached documents; all words must match. Empty search lists the newest tours. Returns id, name, "
                    "date, distance_km, activity and file for each tour.",
     "inputSchema": {"type": "object", "properties": {
         "search": {"type": "string", "description": "Search words, e.g. 'Teide 2025' or 'Gantrisch'"},
         "limit": {"type": "integer", "minimum": 1, "maximum": 200, "default": 20}}},
     "annotations": {"readOnlyHint": True, "openWorldHint": False}},
    {"name": "list_templates",
     "title": "List video templates",
     "description": "List the video templates: built-in 'landscape' (calm, wide), 'memory' (diary style), 'social' "
                    "(fast, for short clips) and the user's own ★ templates, plus the camera flight styles for render_video.",
     "inputSchema": {"type": "object", "properties": {}},
     "annotations": {"readOnlyHint": True, "openWorldHint": False}},
    {"name": "render_video",
     "title": "Render a tour video",
     "description": "Start rendering an animated map video (MP4) of one tour, exactly like the app's quick video. Returns a "
                    "job_id at once; rendering takes a few minutes — poll job_status. Jobs run one after another.",
     "inputSchema": {"type": "object", "required": ["tour"], "properties": {
         "tour": {"type": "string", "description": "Tour id from search_tours (preferred) or a unique tour name"},
         "template": {"type": "string", "default": "landscape", "description": "landscape, memory, social or an own template name"},
         "camera": {"type": "string", "enum": ["companion", "skimmer", "swallow", "crane", "thermal", "cruise", "dandelion", "falcon", "orbit", "carousel"],
                    "description": "Camera flight style: companion (soft, behind you — default), skimmer (close, low, steep), swallow (agile), "
                                   "crane (swings outward in curves), thermal (higher, gliding), cruise (high and flat), dandelion "
                                   "(drifts in one direction), falcon (high, from above, slowly circling), orbit (top-down from far up, slow orbit), "
                                   "carousel (close, slowly circling around the moving dot)"},
         "format": {"type": "string", "enum": ["16:9", "9:16", "1:1"], "description": "Picture format (default: the template's)"},
         "length_s": {"type": "number", "minimum": 15, "maximum": 600, "description": "Video length in seconds (default: the template's)"},
         "photos": {"type": "boolean", "default": True, "description": "Show the tour's photos as stops"},
         "circle_photos": {"type": "boolean", "default": False, "description": "Camera circles once around each photo stop"}}},
     "annotations": {"readOnlyHint": False, "destructiveHint": False, "idempotentHint": False, "openWorldHint": False}},
    {"name": "render_map_image",
     "title": "Render a map image",
     "description": "Start rendering a map image (PNG) of one tour. Returns a job_id; poll job_status — when done it also "
                    "returns a small preview of the image.",
     "inputSchema": {"type": "object", "required": ["tour"], "properties": {
         "tour": {"type": "string", "description": "Tour id from search_tours (preferred) or a unique tour name"}}},
     "annotations": {"readOnlyHint": False, "destructiveHint": False, "idempotentHint": False, "openWorldHint": False}},
    {"name": "render_project",
     "title": "Render a project video",
     "description": "Start rendering the video of an exported GPS Studio project (.rzproj file) exactly like the app's video "
                    "export — keyframes, signs, photos, tours, labels and music as in the project, same frames as the camera "
                    "export. Optionally another output height (e.g. 1080 for a 4K project). Returns a job_id; poll job_status.",
     "inputSchema": {"type": "object", "required": ["rzproj"], "properties": {
         "rzproj": {"type": "string", "description": "Path of the .rzproj file (Project → Export project)"},
         "height": {"type": "integer", "minimum": 64, "maximum": 4320, "description": "Output height in px; width follows the project's aspect ratio"},
         "preview": {"type": "string", "description": "Preview size in CSS px as in the app, e.g. 960x540 (as for the camera export)"}}},
     "annotations": {"readOnlyHint": False, "destructiveHint": False, "idempotentHint": False, "openWorldHint": False}},
    {"name": "job_status",
     "title": "Job status",
     "description": "State of a render job: queued, running (with progress 0–100), done (with file) or error. Waits up to "
                    "wait_s seconds (max 50) for the job to finish before answering.",
     "inputSchema": {"type": "object", "required": ["job_id"], "properties": {
         "job_id": {"type": "string"},
         "wait_s": {"type": "number", "minimum": 0, "maximum": 50, "default": 30}}},
     "annotations": {"readOnlyHint": True, "openWorldHint": False}},
    {"name": "cancel_job",
     "title": "Cancel job",
     "description": "Cancel a queued or running render job.",
     "inputSchema": {"type": "object", "required": ["job_id"], "properties": {"job_id": {"type": "string"}}},
     "annotations": {"readOnlyHint": False, "destructiveHint": False, "openWorldHint": False}},
]


class _Fehler(Exception):
    pass


def _melden(text: str) -> None:
    sys.stderr.write("[mcp] " + text.rstrip() + "\n")
    sys.stderr.flush()


def cli_aufruf() -> list:
    """Wie man die Kommandozeile dieser App startet (für die Aufträge)."""
    exe = Path(sys.executable)
    if getattr(sys, "frozen", False):
        # Windows-Konsolenfassung gpsstudio.exe startet ohne „cli“ (app.py erkennt den Namen)
        return [str(exe)] if exe.stem.lower() == "gpsstudio" else [str(exe), "cli"]
    return [str(exe), str(Path(__file__).resolve().parent.parent / "app.py"), "cli"]


class Auftraege:
    """Render-Aufträge nacheinander in einem Hintergrund-Faden, je einer als eigener Kommandozeilen-Prozess."""

    def __init__(self, basis: list, ausgabe: Path):
        self.basis = basis
        self.ausgabe = ausgabe
        self.jobs: dict = {}
        self._lock = threading.Lock()
        self._fertig = threading.Condition(self._lock)
        self._q: queue.Queue = queue.Queue()
        self._nr = itertools.count(1)
        threading.Thread(target=self._arbeiten, name="mcp-auftraege", daemon=True).start()

    def neu(self, art: str, args: list, tour: str) -> dict:
        jid = f"job-{next(self._nr)}-{int(time.time()) % 100000}"
        with self._lock:
            self.jobs[jid] = {"job_id": jid, "kind": art, "tour": tour, "state": "queued", "progress": 0, "message": "",
                              "file": None, "error": None, "created": time.time(), "proc": None}
        self._q.put((jid, args))
        return self.stand(jid)

    def stand(self, jid: str) -> dict:
        with self._lock:
            j = self.jobs.get(jid)
            if not j:
                raise _Fehler(f"unknown job_id: {jid}")
            vor = sum(1 for x in self.jobs.values() if x["state"] == "queued" and x["created"] < j["created"])
            d = {k: v for k, v in j.items() if k not in ("proc", "created")}
            if j["state"] == "queued":
                d["jobs_before"] = vor
            return d

    def warten(self, jid: str, sek: float) -> dict:
        ende = time.time() + max(0.0, min(WARTEN_MAX, sek))
        with self._fertig:
            while True:
                j = self.jobs.get(jid)
                if not j or j["state"] in ("done", "error", "cancelled"):
                    break
                rest = ende - time.time()
                if rest <= 0:
                    break
                self._fertig.wait(timeout=min(rest, 1.0))
        return self.stand(jid)

    def abbrechen(self, jid: str) -> dict:
        with self._lock:
            j = self.jobs.get(jid)
            if not j:
                raise _Fehler(f"unknown job_id: {jid}")
            if j["state"] in ("queued", "running"):
                j["state"] = "cancelled"
                p = j.get("proc")
                if p and p.poll() is None:
                    _beenden(p)
            self._fertig.notify_all()
        return self.stand(jid)

    def _setzen(self, jid: str, **k) -> None:
        with self._lock:
            j = self.jobs.get(jid)
            if j and not (j["state"] == "cancelled" and k.get("state") not in (None, "cancelled")):
                j.update(k)
            self._fertig.notify_all()

    def _arbeiten(self) -> None:
        while True:
            jid, args = self._q.get()
            with self._lock:
                if self.jobs.get(jid, {}).get("state") == "cancelled":
                    continue
            self._ausfuehren(jid, args)

    def _ausfuehren(self, jid: str, args: list) -> None:
        cmd = self.basis + args + ["--out", str(self.ausgabe)]
        _melden(f"{jid}: {' '.join(args)}")
        try:
            # eigene Prozessgruppe: beim Abbrechen geht der unsichtbare Browser des Renders mit (sonst bliebe er als Waise)
            gruppe = ({"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if sys.platform == "win32"
                      else {"start_new_session": True})
            p = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 text=True, encoding="utf-8", errors="replace", bufsize=1, **gruppe)
        except OSError as e:
            self._setzen(jid, state="error", error=f"could not start: {e}")
            return
        self._setzen(jid, state="running", proc=p, message="starting")
        stdout_teile: list = []
        t_out = threading.Thread(target=lambda: stdout_teile.append(p.stdout.read()), daemon=True)
        t_out.start()
        for zeile in p.stderr:
            z = zeile.strip()
            if not z:
                continue
            m = re.match(r"^(\d{1,3}) %\s*(.*)$", z)
            if m:
                self._setzen(jid, progress=min(100, int(m.group(1))), message=m.group(2)[:200])
            elif not z.startswith(("[", "20", "Traceback", "  File")) and len(z) < 240:
                self._setzen(jid, message=z)
        p.wait()
        t_out.join(timeout=5)
        with self._lock:
            if self.jobs[jid]["state"] == "cancelled":
                self._fertig.notify_all()
                return
        ergebnis = None
        for z in reversed(("".join(stdout_teile)).strip().splitlines()):
            try:
                ergebnis = json.loads(z)
                break
            except ValueError:
                continue
        if ergebnis and ergebnis.get("ok") and ergebnis.get("file"):
            self._setzen(jid, state="done", progress=100, file=ergebnis["file"], message="",
                         duration_s=ergebnis.get("duration_s"))
        else:
            fehler = (ergebnis or {}).get("error") or f"render ended with exit code {p.returncode}"
            mehr = {"candidates": ergebnis["candidates"]} if ergebnis and ergebnis.get("candidates") else {}
            self._setzen(jid, state="error", error=fehler, **mehr)


def _beenden(p: subprocess.Popen) -> None:
    """Render-Prozess samt Kindern (Browser) beenden."""
    try:
        if sys.platform == "win32":
            subprocess.run(["taskkill", "/PID", str(p.pid), "/T", "/F"], capture_output=True, timeout=20)
            return
        import signal
        os.killpg(p.pid, signal.SIGTERM)

        def nachfassen():
            try:
                p.wait(timeout=8)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(p.pid, signal.SIGKILL)
                except OSError:
                    pass
        threading.Thread(target=nachfassen, daemon=True).start()
    except (OSError, subprocess.SubprocessError) as e:
        _melden(f"cancel: {e}")
        try:
            p.kill()
        except OSError:
            pass


def _vorschau(pfad: str) -> dict | None:
    """Kartenbild verkleinert als MCP-Bildinhalt (die KI soll es sehen können, nicht 5 MB lesen)."""
    try:
        from PIL import Image
        with Image.open(pfad) as im:
            im = im.convert("RGB")
            im.thumbnail((VORSCHAU_PX, VORSCHAU_PX))
            buf = io.BytesIO()
            im.save(buf, "JPEG", quality=82)
        return {"type": "image", "data": base64.b64encode(buf.getvalue()).decode("ascii"), "mimeType": "image/jpeg"}
    except Exception as e:  # noqa: BLE001
        _melden(f"preview: {e}")
        return None


class Server:
    def __init__(self, app, api, ausgabe: Path, library: str | None, schreiben):
        from core import cli as _cli
        self.app, self.api, self.cli = app, api, _cli
        self.schreiben = schreiben
        basis = cli_aufruf() + (["--library", library] if library else [])
        self.auftraege = Auftraege(basis, ausgabe)
        self.ausgabe = ausgabe

    # ── Werkzeuge ───────────────────────────────────────────────────────────────────────────────────────────────────
    def _tour_pruefen(self, ref: str) -> str:
        ref = str(ref or "").strip()
        if not ref:
            raise _Fehler("tour is required")
        if Path(ref).expanduser().is_file():
            raise _Fehler("pass a tour id or name from search_tours, not a file path")
        try:
            return self.cli._tour_aufloesen(self.app, self.api, ref)
        except self.cli.CliFehler as e:
            raise _Fehler(str(e) + ((" Candidates: " + json.dumps(e.mehr["candidates"], ensure_ascii=False))
                                    if e.mehr.get("candidates") else "")) from None

    def werkzeug(self, name: str, a: dict) -> tuple:
        """Returns (daten-dict, zusatz-inhalte)."""
        if name == "search_tours":
            return self.cli._tours(self.app, self.api, str(a.get("search") or ""), int(a.get("limit") or 20)), []
        if name == "list_templates":
            return self.cli._templates(self.api), []
        if name == "render_video":
            tour = str(a.get("tour") or "")
            self._tour_pruefen(tour)
            vorlage = str(a.get("template") or "landscape")
            if vorlage not in self.cli.VORLAGEN and not any(x["name"].strip().lower() == vorlage.strip().lower()
                                                             for x in self.cli._eigene_vorlagen(self.api)):
                raise _Fehler(f"unknown template: {vorlage} — see list_templates")
            args = ["render", tour, "--template", vorlage]
            if a.get("camera"):
                if a["camera"] not in self.cli.KAMERAS:
                    raise _Fehler("unknown camera — see list_templates")
                args += ["--camera", a["camera"]]
            if a.get("format"):
                if a["format"] not in self.cli.FORMATE:
                    raise _Fehler("format must be 16:9, 9:16 or 1:1")
                args += ["--format", a["format"]]
            if a.get("length_s") is not None:
                s = float(a["length_s"])
                if not 15 <= s <= 600:
                    raise _Fehler("length_s must be between 15 and 600")
                args += ["--length", f"{s:g}"]
            if a.get("photos") is False:
                args.append("--no-photos")
            if a.get("circle_photos"):
                args.append("--circle-photos")
            return self.auftraege.neu("video", args, tour), []
        if name == "render_project":   # 27.10.2026 — Projekt-Video (.rzproj), wie `gpsstudio project-render`
            paket = Path(str(a.get("rzproj") or "")).expanduser()
            if paket.suffix.lower() != ".rzproj" or not paket.is_file():
                raise _Fehler(f"not an existing .rzproj file: {paket}")
            args = ["project-render", "--rzproj", str(paket.resolve())]
            if a.get("height") is not None:
                hh = int(a["height"])
                if not 64 <= hh <= 4320:
                    raise _Fehler("height must be between 64 and 4320")
                args += ["--height", str(hh)]
            if a.get("preview"):
                args += ["--preview", str(a["preview"])]
            return self.auftraege.neu("video", args, paket.name), []
        if name == "render_map_image":
            tour = str(a.get("tour") or "")
            self._tour_pruefen(tour)
            return self.auftraege.neu("map_image", ["map-image", tour], tour), []
        if name == "job_status":
            d = self.auftraege.warten(str(a.get("job_id") or ""), float(a.get("wait_s", 30) or 0))
            extra = []
            if d["state"] == "done" and d.get("kind") == "map_image" and d.get("file"):
                v = _vorschau(d["file"])
                if v:
                    extra.append(v)
            return d, extra
        if name == "cancel_job":
            return self.auftraege.abbrechen(str(a.get("job_id") or "")), []
        raise _Fehler(f"unknown tool: {name}")

    # ── Protokoll ───────────────────────────────────────────────────────────────────────────────────────────────────
    def antwort(self, nid, result=None, error=None) -> None:
        m = {"jsonrpc": "2.0", "id": nid}
        if error is not None:
            m["error"] = error
        else:
            m["result"] = result
        self.schreiben(m)

    def _aufruf(self, nid, params: dict) -> None:
        name = str(params.get("name") or "")
        try:
            daten, extra = self.werkzeug(name, params.get("arguments") or {})
            self.antwort(nid, {"content": [{"type": "text", "text": json.dumps(daten, ensure_ascii=False)}] + extra,
                               "structuredContent": daten, "isError": False})
        except _Fehler as e:
            self.antwort(nid, {"content": [{"type": "text", "text": str(e)}], "isError": True})
        except Exception as e:  # noqa: BLE001
            _melden(f"{name}: {type(e).__name__}: {e}")
            self.antwort(nid, {"content": [{"type": "text", "text": f"{type(e).__name__}: {e}"}], "isError": True})

    def nachricht(self, m: dict) -> None:
        meth, nid, params = m.get("method"), m.get("id"), m.get("params") or {}
        if meth is None:
            return   # Antwort des Clients (wir fragen nie etwas) — ignorieren
        if nid is None:
            return   # Benachrichtigung (initialized, cancelled …)
        if meth == "initialize":
            v = params.get("protocolVersion")
            self.antwort(nid, {"protocolVersion": v if v in PROTOKOLLE else PROTOKOLLE[0],
                               "capabilities": {"tools": {"listChanged": False}},
                               "serverInfo": {"name": "gps-studio", "title": "GPS Studio",
                                              "version": str(getattr(self.app, "APP_VERSION", ""))},
                               "instructions": ANWEISUNG})
        elif meth == "ping":
            self.antwort(nid, {})
        elif meth == "tools/list":
            self.antwort(nid, {"tools": WERKZEUGE})
        elif meth == "tools/call":
            # job_status kann warten — eigener Faden, damit ping/andere Anfragen weiter beantwortet werden
            threading.Thread(target=self._aufruf, args=(nid, params), daemon=True).start()
        elif meth in ("resources/list", "prompts/list"):
            self.antwort(nid, {"resources": []} if meth == "resources/list" else {"prompts": []})
        else:
            self.antwort(nid, error={"code": -32601, "message": f"method not found: {meth}"})


def laufen(app, api, ausgabe: Path, library: str | None, stdout, stdin=None) -> int:
    """stdio-Schleife bis stdin endet."""
    lock = threading.Lock()

    def schreiben(m: dict) -> None:
        with lock:
            stdout.write(json.dumps(m, ensure_ascii=False) + "\n")
            stdout.flush()

    ausgabe.mkdir(parents=True, exist_ok=True)
    srv = Server(app, api, ausgabe, library, schreiben)
    _melden(f"GPS Studio MCP server ready — output folder: {ausgabe}")
    for zeile in (stdin or sys.stdin):
        zeile = zeile.strip()
        if not zeile:
            continue
        try:
            m = json.loads(zeile)
        except ValueError:
            schreiben({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "parse error"}})
            continue
        for einzel in (m if isinstance(m, list) else [m]):
            if isinstance(einzel, dict):
                try:
                    srv.nachricht(einzel)
                except Exception as e:  # noqa: BLE001
                    _melden(f"message: {type(e).__name__}: {e}")
                    if einzel.get("id") is not None:
                        srv.antwort(einzel["id"], error={"code": -32603, "message": str(e)})
    # Ende der Eingabe = das KI-Programm hat beendet: laufenden Auftrag mit beenden
    for jid in list(srv.auftraege.jobs):
        if srv.auftraege.jobs[jid]["state"] in ("queued", "running"):
            srv.auftraege.abbrechen(jid)
    return 0
