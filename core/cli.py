"""Kommandozeile `gpsstudio` (13.10.2026) — GPS Studio aus Skripten und anderen Programmen aufrufen.

    gpsstudio tours [--search TEXT] [--limit N]
    gpsstudio templates
    gpsstudio render <gpx file | tour id | unique tour name> [--template NAME] [--camera STYLE] [--format 9:16|16:9|1:1]
                     [--length SECONDS] [--no-photos] [--out FILE] [--overwrite]
    gpsstudio map-image <gpx file | tour id | name> [--out FILE] [--overwrite]
    gpsstudio mcp [--out-dir FOLDER]      MCP server for AI assistants (stdio, core/mcp_server.py)
    gpsstudio camera-export --rzproj PROJECT.rzproj [--out FILE] [--preview 960x540] [--overwrite]
                                         camera move frame by frame as JSON (rz-kamera/1), no video
    gpsstudio overlay-export --rzproj PROJECT.rzproj [--out FILE.mov] [--without-track] [--with-labels] [--frames 600,1199]
                             [--preview WxH]
                                         overlays as transparent ProRes 4444 (or single PNG frames), no map
                                         (--with-labels: keep the map's place/POI/road names as set in the project)
    (global: --library FOLDER)

Befehle, Schalter und das Ergebnis-JSON sind englisch (Marc: „wir wollen international sein“); die lesbaren
Fortschrittszeilen folgen der Sprache der App. Auf stdout steht genau eine JSON-Zeile ({"ok": …}), alles andere
(Fortschritt, Protokoll) geht nach stderr. Exit-Codes: 0 ok, 1 Fehler, 2 falscher Aufruf.

Arbeitsweise: dieselbe Bibliothek wie die App, aber NUR LESEND (`library.open_db_lesend`), keine
Sperre — darf neben der offenen App laufen. Projekte entstehen in einem Temp-Ordner. Ein Video entsteht genau wie in
der App: eine unsichtbare Seite öffnet den echten Schnell-Video-Dialog, wählt Vorlage/Format/Länge, „Im Animator
öffnen“, dann derselbe Render-Knopf mit festem Ziel (`__rzSchnellRender`). Eine vorhandene Datei wird nie
überschrieben (Zeitstempel davor), außer mit --overwrite.
"""
from __future__ import annotations

import argparse
import asyncio
import datetime as _dt
import json
import os
import sys
import tempfile
import threading
import time
from pathlib import Path

#: englischer Name → interne Vorlage des Schnell-Videos (ui/js/schnellvideo.js VORLAGEN)
VORLAGEN = {"landscape": "weite", "memory": "tagebuch", "social": "puls"}
#: 14.10.2026 — Flugstile der Kamerafahrt (englischer Name → interner, ui/js/schnellvideo.js FLUGSTILE)
KAMERAS = {"companion": "begleiter", "skimmer": "tiefflieger", "swallow": "schwalbe", "crane": "kranschwenk", "thermal": "thermik",
           "cruise": "reiseflughoehe", "dandelion": "pusteblume", "falcon": "falke", "orbit": "orbit", "carousel": "karussell"}
FORMATE = ("16:9", "9:16", "1:1")
LAENGEN = {20: "kurz", 40: "normal", 60: "lang"}

# Was die unsichtbare Seite NICHT darf: Einstellungen, Archiv, Cloud, Dialoge … (wie die Szene). Projekte und der Render
# dürfen — sie landen im Temp-Ordner bzw. in der gewählten Ausgabedatei.
_ERLAUBT = ("session_", "projekt_", "animator_start_render", "animator_cancel", "schnellvideo_")

_BRIDGE_JS = r"""
(() => {
  window.__rzKeinPmBoot = true;
  window.__rzFortsetzenGeprueft = true;
  window.__rzRightsAck = true;
  window.__rzKommandozeile = true;
  const NATIVE = {
    pick_save_path: async () => null, pick_file: async () => null, pick_folder: async () => null,
    set_window_size: async () => ({ ok: true }), get_window_size: async () => ({ width: 1500, height: 950 }),
    quit: async () => {}, on_loaded: () => {}, open_url: async () => ({ ok: true }),
  };
  const api = new Proxy({}, {
    get(_t, name) {
      if (name in NATIVE) return NATIVE[name];
      if (typeof name !== "string") return undefined;
      return async (...args) => JSON.parse(await window.rzBridge(name, JSON.stringify(args)));
    },
  });
  window.pywebview = { api };
  // Rückfragen (Keyframes ersetzen …) wie „Ja“ beantworten — es gibt niemanden, der klickt; alles liegt im Temp-Ordner
  setInterval(() => { try { const b = document.getElementById("confirm-ok"); if (b && b.offsetParent) b.click(); } catch (_) {} }, 400);
  window.dispatchEvent(new Event("pywebviewready"));
})();
"""


# 14.10.2026 — Abbruch von außen (SIGTERM: MCP cancel_job, kill). Hing der Render selbst (Weltumrundung, Datumsgrenze), wartete
# der Fortschritts-Faden ewig und Python beim Beenden auf ihn — der Prozess lief nach dem Abbruch 1,5 h weiter.
_ABGEBROCHEN = threading.Event()
_API = None
_LAUF: dict = {}          # app, tmp, out (stdout), ausgegeben
_AUSGABE_LOCK = threading.Lock()


def _ausgabe_einmal(d: dict) -> None:
    """Die eine Ergebnis-Zeile auf stdout — höchstens einmal (Abbruch schreibt sie schon im Signal)."""
    with _AUSGABE_LOCK:
        if _LAUF.get("ausgegeben") or not _LAUF.get("out"):
            return
        _LAUF["ausgegeben"] = True
        _LAUF["out"].write(json.dumps(d, ensure_ascii=False) + "\n")
        _LAUF["out"].flush()


def _abbrechen(*_):
    if _ABGEBROCHEN.is_set():
        return
    _ABGEBROCHEN.set()
    _melden("✗ cancelled")
    _ausgabe_einmal({"ok": False, "error": "cancelled"})
    try:
        if _API is not None:
            _API.animator_cancel()   # laufenden Render der App-Logik stoppen
    except Exception:  # noqa: BLE001
        pass

    def wachhund():   # dauert das Aufräumen länger als 20 s (Brücken-Aufrufe im Hintergrund), Temp räumen, hart beenden
        time.sleep(20)
        try:
            if _LAUF.get("tmp") is not None:
                _aufraeumen(_LAUF["app"], _LAUF["tmp"])
        except Exception:  # noqa: BLE001
            pass
        os._exit(130)
    threading.Thread(target=wachhund, daemon=True).start()
    raise KeyboardInterrupt()


class CliFehler(Exception):
    def __init__(self, text: str, code: int = 1, **mehr):
        super().__init__(text)
        self.code = code
        self.mehr = mehr


def _t(app, key: str, fallback: str) -> str:
    try:
        return app._ui_t()(key, fallback)
    except Exception:  # noqa: BLE001
        return fallback


def _melden(text: str) -> None:
    sys.stderr.write(text.rstrip() + "\n")
    sys.stderr.flush()


# ── Aufbau ──────────────────────────────────────────────────────────────────────────────────────────────────────────

def _vorbereiten(app, library: str | None):
    """Api im Kommandozeilen-Modus: Archiv nur lesend, Projekte in einem Temp-Ordner. Returns (api, temp_ordner)."""
    app.CLI_MODUS = True
    bib = Path(library).expanduser() if library else Path(app.BIB_ORT or app.BIB)
    if not app.cbib.ist_bibliothek(bib):
        raise CliFehler(_t(app, "cli.keine_bibliothek", "Keine GPS-Studio-Bibliothek gefunden: {p}").replace("{p}", str(bib)))
    db = app.cbib.db_pfad(bib)
    tmp = Path(tempfile.mkdtemp(prefix="gpsstudio-cli-")).resolve()
    try:
        app._ds.temp_ordner_merken(tmp)
    except Exception:  # noqa: BLE001
        pass
    app.BIB = app.BIB_ORT = bib
    app.LIBRARY_DB = db
    app.BIB_BEREIT = True
    app.DATEN_ORT = tmp
    api = app.Api()
    api._lib_conn = app.clib.open_db_lesend(db)
    return api, tmp


def _aufraeumen(app, tmp: Path) -> None:
    try:
        app._ds.ordner_loeschen(tmp, "kommandozeile", art=app._ds.ART_TEMP)
    except Exception as e:  # noqa: BLE001
        _melden(f"(temp folder not removed: {e})")


# ── Touren und Vorlagen ─────────────────────────────────────────────────────────────────────────────────────────────

def _tour_json(it: dict) -> dict:
    return {"id": it.get("geo_hash"), "name": it.get("display_name") or it.get("name") or Path(str(it.get("path"))).stem,
            "date": it.get("started_at"), "day": it.get("tag_lokal") or "",   # 19.10.2026 — Tourtag in Ortszeit
            "distance_km": round(float(it.get("distance_m") or 0) / 1000.0, 1),
            "activity": it.get("activity") or "", "file": it.get("path")}


def _tours(app, api, suche: str, limit: int) -> dict:
    res = app.clib.query(api._lib(), search=suche or "", limit=max(1, min(1000, int(limit or 50))))
    return {"ok": True, "total": res.get("total", 0), "tours": [_tour_json(it) for it in res.get("items", [])]}


def _eigene_vorlagen(api) -> list:
    try:
        s = api.settings_get() or {}
        return [x for x in (s.get("videostil_vorlagen") or []) if isinstance(x, dict) and x.get("name")]
    except Exception:  # noqa: BLE001
        return []


def _templates(api) -> dict:
    eigen = _eigene_vorlagen(api)
    return {"ok": True, "templates": [{"name": n, "kind": "builtin"} for n in VORLAGEN]
            + [{"name": x["name"], "kind": "own"} for x in eigen], "cameras": list(KAMERAS)}


def _tour_aufloesen(app, api, ref: str) -> str:
    """GPX-Datei (irgendwo), Tour-Kennung (geo_hash) oder eindeutiger Name → Pfad der Track-Datei."""
    p = Path(ref).expanduser()
    if p.is_file():
        return str(p.resolve())
    conn = api._lib()
    r = conn.execute("SELECT path FROM tracks WHERE geo_hash = ? ORDER BY haupt DESC LIMIT 1", (ref,)).fetchone()
    if r:
        return r[0]
    n = app.clib._norm(ref)
    zeilen = conn.execute("SELECT path, display_name, name, geo_hash FROM tracks WHERE haupt = 1 "
                          "AND (rz_norm(COALESCE(display_name, '')) = ? OR rz_norm(COALESCE(name, '')) = ?)", (n, n)).fetchall()
    if len(zeilen) == 1:
        return zeilen[0][0]
    if not zeilen:
        res = app.clib.query(conn, search=ref, limit=10)
        if res.get("total") == 1:
            return res["items"][0]["path"]
        kand = [_tour_json(x) for x in res.get("items", [])]
    else:
        kand = [{"id": z[3], "name": z[1] or z[2], "file": z[0]} for z in zeilen]
    if not kand:
        raise CliFehler(_t(app, "cli.tour_fehlt", "Keine Tour gefunden: {t}").replace("{t}", ref))
    raise CliFehler(_t(app, "cli.tour_mehrdeutig", "Mehrere Touren passen zu „{t}“ — bitte die Kennung (id) nehmen.").replace("{t}", ref),
                    candidates=kand)


def _ziel(app, api, out: str | None, stamm: str, endung: str, ueberschreiben: bool) -> Path:
    """Ausgabedatei: ohne --out in den Render-Ordner der App; nie überschreiben (Zeitstempel davor), außer --overwrite."""
    sauber = "".join(c if (c.isalnum() or c in " -_.,()") else "_" for c in (stamm or "GPS Studio")).strip() or "GPS Studio"
    if out:
        p = Path(out).expanduser()
        if p.is_dir():
            p = p / f"{sauber}{endung}"
        elif not p.suffix:
            p = p.with_suffix(endung)
    else:
        ordner = Path(app.APP_SUPPORT) / "_renders"
        ordner.mkdir(parents=True, exist_ok=True)
        p = ordner / f"{sauber}{endung}"
    p = p.resolve()
    p.parent.mkdir(parents=True, exist_ok=True)
    if p.exists() and not ueberschreiben:
        p = p.with_name(_dt.datetime.now().strftime("%Y%m%d-%H%M-") + p.name)
        while p.exists():
            p = p.with_name(_dt.datetime.now().strftime("%Y%m%d-%H%M%S-") + p.name.split("-", 2)[-1])
    try:
        app._ds.nutzer_ziel(str(p))
    except Exception:  # noqa: BLE001
        pass
    return p


# ── die unsichtbare Seite ───────────────────────────────────────────────────────────────────────────────────────────

def _bruecke(app, api):
    from core import szene

    def sync(name: str, args_json: str) -> str:
        try:
            args = json.loads(args_json or "[]")
        except Exception:  # noqa: BLE001
            args = []
        if not name.startswith(_ERLAUBT) and (szene._SCHREIBEND.match(name) or name.startswith("videostil_vorlage_")):
            return json.dumps({"ok": True, "kommandozeile": "read-only"})
        if name == "schnellvideo_anlegen" and len(args) >= 4:
            args[3] = None   # „zuletzt benutzt“ der App nicht überschreiben
        fn = getattr(api, name, None)
        if fn is None or name.startswith("_"):
            return json.dumps({"ok": False, "error": f"no bridge {name}"})
        try:
            res = fn(*args)
        except Exception as e:  # noqa: BLE001
            return json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"})
        try:
            return json.dumps(res, default=str)
        except Exception:  # noqa: BLE001
            return json.dumps({"ok": True})

    async def bruecke(name: str, args_json: str) -> str:
        # wie pywebview: jeder Aufruf in einem eigenen Faden (ein langsamer Netzaufruf hält die Seite nicht an)
        return await asyncio.get_running_loop().run_in_executor(None, sync, name, args_json)
    return bruecke


async def _warte(page, js: str, sek: float, was: str) -> object:
    ende = time.time() + sek
    while time.time() < ende:
        try:
            r = await page.evaluate(js)
            if r:
                return r
        except Exception:  # noqa: BLE001
            pass
        await page.wait_for_timeout(250)
    raise CliFehler(f"timeout: {was}")


async def _seite(p, app, api):
    from core import szene
    browser = await p.chromium.launch(headless=True, args=[
        "--use-angle=default", "--enable-webgl", "--ignore-gpu-blocklist", "--disable-gpu-sandbox",
        "--disable-background-networking", "--no-first-run", "--no-default-browser-check", "--allow-file-access-from-files"])
    page = await browser.new_page(viewport={"width": 1500, "height": 950})
    await page.expose_function("rzBridge", _bruecke(app, api))
    await page.add_init_script(_BRIDGE_JS)
    await page.goto(f"file://{szene.UI_INDEX.resolve()}", wait_until="domcontentloaded")
    await _warte(page, "() => !!(window.RZGPS_MODULES && window.switchMod && window.loadGlobalGpx && window.rzSchnellVideo)", 60, "app start")
    await page.wait_for_timeout(1200)
    return browser, page


def _fortschritt_verfolgen(app, api, t0: float) -> dict:
    """Render-Stand der App abfragen, bis er fertig ist; Fortschritt als Zeilen nach stderr."""
    letzt = ""
    while True:
        st = api.animator_status() or {}
        txt = f"{int(round(float(st.get('progress') or 0) * 100)):3d} %  {st.get('status') or ''}".rstrip()
        if txt != letzt:
            _melden(txt)
            letzt = txt
        if not st.get("running"):
            return st
        if _ABGEBROCHEN.is_set():
            api.animator_cancel()
            raise CliFehler("cancelled")
        if time.time() - t0 > 4 * 3600:
            api.animator_cancel()
            raise CliFehler("timeout: render")
        time.sleep(1.0)


async def _render(app, api, gpx: str, a) -> dict:
    from playwright.async_api import async_playwright
    t0 = time.time()
    eigen = None
    if a.template not in VORLAGEN:
        eigen = next((x for x in _eigene_vorlagen(api) if x["name"].strip().lower() == a.template.strip().lower()), None)
        if not eigen:
            raise CliFehler(_t(app, "cli.vorlage_fehlt", "Vorlage nicht gefunden: {v} — `gpsstudio templates` zeigt alle.").replace("{v}", a.template),
                            code=2)
    async with async_playwright() as p:
        browser, page = await _seite(p, app, api)
        try:
            _melden(_t(app, "cli.schritt_projekt", "Projekt wird angelegt …"))
            opts = {"fotoKreisen": True} if getattr(a, "circle_photos", False) else {}
            await page.evaluate(f"() => {{ window.__rzSchnellFertig = null; window.rzSchnellVideo({json.dumps(gpx)}, {json.dumps(opts)}); }}")
            await _warte(page, "() => !!document.getElementById('sv-animator')", 120, "quick video dialog")
            if eigen:
                await page.evaluate(f"() => document.querySelector('[data-sv-eigen=\"{eigen['id']}\"]')?.click()")
            else:
                await page.evaluate(f"() => document.querySelector('[data-sv-vorlage=\"{VORLAGEN[a.template]}\"]')?.click()")
            await page.wait_for_timeout(400)
            if a.format:
                await page.evaluate(f"() => document.querySelector('[data-sv-gruppe=\"format\"] [data-sv-wert=\"{a.format}\"]')?.click()")
            if getattr(a, "camera", None):
                k = KAMERAS[a.camera]
                gesetzt = await page.evaluate(f"""() => {{ const b = document.querySelector('[data-sv-gruppe="flug"] [data-sv-wert="{k}"]');
                    if (b) b.click(); return !!(b && b.classList.contains('is-on')); }}""")
                if not gesetzt:
                    raise CliFehler(f"--camera {a.camera}: could not be set in the dialog")
            if a.length:
                s = int(round(float(a.length)))
                if s in LAENGEN:
                    await page.evaluate(f"() => document.querySelector('[data-sv-gruppe=\"laenge\"] [data-sv-wert=\"{LAENGEN[s]}\"]')?.click()")
                    gesetzt = s
                else:
                    gesetzt = await page.evaluate(f"() => typeof window.__rzSchnellLaenge === 'function' ? window.__rzSchnellLaenge({s}) : null")
                if gesetzt != s:
                    raise CliFehler(f"--length {s}: could not be set in the dialog (got {gesetzt})")
            # 13.10.2026 — Fotos ausdrücklich an oder aus: der Dialog übernimmt sonst die zuletzt in der App gewählte
            # Einstellung („Fotos aus“ vom letzten Mal → Video ohne Fotos, obwohl --no-photos nicht gesetzt war)
            await page.evaluate("""(an) => { const c = document.getElementById('sv-fotos-an');
                if (c && c.checked !== an) { c.checked = an; c.dispatchEvent(new Event('change', { bubbles: true })); } }""",
                                not a.no_photos)
            await page.wait_for_timeout(600)
            # 13.10.2026 — Fotos und Clips sucht der Dialog im Hintergrund; vorher losgeschickt, entstand das Video ohne
            # Fotos. Warten, bis die Suche durch ist (Zustand des Dialogs, window.__rzSchnellGeladen).
            if not a.no_photos:
                await _warte(page, "() => typeof window.__rzSchnellGeladen === 'function' && window.__rzSchnellGeladen()", 180,
                             "photos and clips found")
                await page.wait_for_timeout(300)
                # nach dem Laden noch einmal: ohne gefundene Fotos schaltet der Dialog den Haken selbst aus — das bleibt so
                await page.evaluate("""() => { const c = document.getElementById('sv-fotos-an');
                    if (c && !c.checked && document.querySelector('#sv-fotos [data-sv-foto]')) { c.checked = true;
                    c.dispatchEvent(new Event('change', { bubbles: true })); } }""")
            await page.evaluate("() => document.getElementById('sv-animator').click()")
            fertig = await _warte(page, "() => window.__rzSchnellFertig", 240, "project ready")
            name = (fertig or {}).get("name") or Path(gpx).stem
            ziel = _ziel(app, api, a.out, name, ".mp4", a.overwrite)
            _melden(_t(app, "cli.schritt_render", "Video wird gerendert: {p}").replace("{p}", str(ziel)))
            await page.wait_for_timeout(1500)
            await page.evaluate(f"() => window.__rzSchnellRender({{ ziel: {json.dumps(str(ziel))}, name: {json.dumps(name)}, amZiel: true }})")
            # der Render läuft in der App-Logik (eigener Faden mit eigener Szene) — erst starten lassen, dann verfolgen
            await _warte(page, "async () => { const s = await window.pywebview.api.animator_status(); return s && (s.running || s.output || s.error) ? s : null; }",
                         120, "render start")
            st = await asyncio.get_running_loop().run_in_executor(None, _fortschritt_verfolgen, app, api, t0)
        finally:
            await browser.close()
    if st.get("error") or not ziel.exists():
        _melden(str(st.get("error") or ""))   # ganze Meldung (mit Traceback) ins Protokoll, ins JSON nur die erste Zeile
        raise CliFehler(str(st.get("error") or "").strip().splitlines()[0] if st.get("error") else _t(app, "cli.render_fehlt", "Render ohne Datei beendet"))
    return {"ok": True, "file": str(ziel), "template": a.template, "camera": getattr(a, "camera", None) or "companion",
            "duration_s": round(time.time() - t0, 1)}


async def _kartenbild(app, api, gpx: str, a) -> dict:
    from playwright.async_api import async_playwright
    t0 = time.time()
    async with async_playwright() as p:
        browser, page = await _seite(p, app, api)
        try:
            _melden(_t(app, "cli.schritt_karte", "Tour wird geladen …"))
            await page.evaluate(f"() => window.loadGlobalGpx({json.dumps(gpx)}, {{ stumm: true }})")
            await page.evaluate("() => window.switchMod('tourmap')")
            await _warte(page, "() => { try { const b = window.__rzAnimBereit && window.__rzAnimBereit(); return b && b.map && b.style && b.coords >= 2 && !b.pending; } catch (_) { return false; } }",
                         180, "map ready")
            await page.wait_for_timeout(2500)
            ziel = _ziel(app, api, a.out, Path(gpx).stem, ".png", a.overwrite)
            _melden(_t(app, "cli.schritt_bild", "Kartenbild wird gerendert: {p}").replace("{p}", str(ziel)))
            await page.evaluate(f"() => window.__rzSchnellRender({{ ziel: {json.dumps(str(ziel))}, name: 'map', amZiel: true }})")
            await _warte(page, "async () => { const s = await window.pywebview.api.animator_status(); return s && (s.running || s.output || s.error) ? s : null; }",
                         120, "render start")
            st = await asyncio.get_running_loop().run_in_executor(None, _fortschritt_verfolgen, app, api, t0)
        finally:
            await browser.close()
    if st.get("error") or not ziel.exists():
        _melden(str(st.get("error") or ""))   # ganze Meldung (mit Traceback) ins Protokoll, ins JSON nur die erste Zeile
        raise CliFehler(str(st.get("error") or "").strip().splitlines()[0] if st.get("error") else _t(app, "cli.render_fehlt", "Render ohne Datei beendet"))
    return {"ok": True, "file": str(ziel), "duration_s": round(time.time() - t0, 1)}


# ── Kamerafahrt (rz-kamera/1) aus einem exportierten Projekt ──────────────────────────────────────────────────────────
# 26.10.2026 (für 3D-Werkzeuge, die das INSTALLIERTE GPS Studio aufrufen — beim Nutzer gibt
# es kein scripts/kamera_export.py). Das Paket wird nicht in die Bibliothek des Nutzers eingespielt: der Befehl startet sich
# selbst noch einmal mit einem leeren Temp-App-Ordner (RZ_APP_ORDNER muss vor dem Laden von app.py stehen) und Schreibsperre
# auf diesen Ordner und das Ziel; das Kind spielt ein, exportiert und gibt die Ergebnis-Zeile zurück.

_KAMERA_KIND = "RZ_CLI_KAMERA_KIND"


def _paket_projekt(app, api, paket: Path):
    """Paket in den GERADE gültigen App-Ordner einspielen (der Aufrufer sorgt dafür, dass das ein leerer Temp-Ordner ist)
    und das im Paket aktive Projekt finden → (projekt_id, projekt) oder ein Fehler-dict."""
    import zipfile
    r = api.projekt_importieren(str(paket))
    if not r.get("ok"):
        return {"ok": False, "error": "import: " + str(r.get("error"))}
    from core import projekte as P
    projekte = P.laden(app.DATEN_ORT).get("projects") or {}
    # das im Paket aktive Projekt (beim Einspielen kann die ID wechseln — darum über den Namen), sonst das zuletzt geänderte
    aktiv_name = None
    try:
        pj = json.loads(zipfile.ZipFile(paket).read("projekte.json").decode("utf-8"))
        aktiv_name = ((pj.get("projects") or {}).get(pj.get("active_project_id") or "") or {}).get("name")
    except Exception:  # noqa: BLE001
        pass
    kand = sorted(projekte.items(), key=lambda kv: str(kv[1].get("modified_at") or ""), reverse=True)
    kand = [kv for kv in kand if (kv[1].get("animator") or {})] or kand
    if aktiv_name:
        kand = [kv for kv in kand if str(kv[1].get("name") or "").startswith(aktiv_name)] or kand
    if not kand:
        return {"ok": False, "error": "no project in the package"}
    return kand[0]


def kamera_aus_paket(app, api, paket: Path, ziel: Path, w: int = 0, h: int = 0) -> dict:
    """Paket einspielen (s. _paket_projekt), Kamerafahrt des aktiven Projekts nach `ziel`. Auch für scripts/kamera_export.py."""
    pp = _paket_projekt(app, api, paket)
    if isinstance(pp, dict):
        return pp
    pid, projekt = pp
    r = api.kamera_export(pid, str(ziel), int(w or 0), int(h or 0))
    if not r.get("ok"):
        return {"ok": False, "error": str(r.get("error"))}
    # „datei“: so lasen 3D-Werkzeuge bisher die Ausgabe von scripts/kamera_export.py
    return {"ok": True, "file": str(ziel), "datei": str(ziel), "frames": r.get("bilder"), "project": {"id": pid, "name": projekt.get("name")}}


def overlay_aus_paket(app, api, paket: Path, ziel: Path, w: int = 0, h: int = 0, ohne_spur: bool = False,
                      bilder: list | None = None, mit_beschriftung: bool = False) -> dict:
    """26.10.2026 (für 3D-Werkzeuge) — Einblendungen des aktiven Projekts transparent rendern: ProRes 4444 mit Alpha in
    Größe, Bildrate und Bildzahl des Videos (Bild k = Bild k des Kamera-Exports), auf Wunsch ohne Spur und Laufpunkt; mit
    `bilder` nur diese Bilder als PNG `<ziel ohne Endung>_<nr>.png`. Dieselbe Szene wie der Video-Render.
    27.10.2026 — `mit_beschriftung`: die Beschriftung der Karte (Orte, POIs, Straßen, Verkehr — so, wie die Schalter im
    Projekt stehen) bleibt stehen; Flächen, Linien, Luftbild und Schummerung der Karte fallen weiter weg."""
    pp = _paket_projekt(app, api, paket)
    if isinstance(pp, dict):
        return pp
    pid, projekt = pp
    an = projekt.get("animator") or {}
    from core import animator as A
    from core import szene
    cfg = A.AnimatorConfig(gpx_path="", output_path=str(ziel), mapbox_token=app._active_mapbox_token() or "",
                           width=int(an.get("width") or 1920), height=int(an.get("height") or 1080), fps=int(an.get("fps") or 30),
                           duration_s=float(an.get("duration_s") or 12), intro_s=float(an.get("intro_s") or 0),
                           hold_s=float(an.get("hold_s") or 0))
    cfg.transparent_background = True
    cfg.codec = "prores4444"
    params = {"szene_projekt_id": pid, "szene_vorschau_w": int(w or 0), "szene_vorschau_h": int(h or 0),
              "overlay_ohne_track": bool(ohne_spur), "overlay_mit_beschriftung": bool(mit_beschriftung)}
    if bilder:
        params["nur_bilder"] = list(bilder)
    letzt = [-1]

    def fortschritt(p, m):
        if int(p * 20) != letzt[0]:
            letzt[0] = int(p * 20)
            _melden(f"{int(p * 100):3d} % · {m}")
    asyncio.run(szene.render_szene(cfg, api=api, projekt_id=pid, params=params, on_progress=fortschritt,
                                   on_preview=lambda x: None, is_cancelled=lambda: _ABGEBROCHEN.is_set()))
    info = {"project": {"id": pid, "name": projekt.get("name")}, "width": cfg.width, "height": cfg.height, "fps": cfg.fps,
            "labels": bool(mit_beschriftung)}
    if bilder:
        dateien = list(szene.NUR_PNG)
        return dict({"ok": bool(dateien), "files": dateien, "dateien": dateien}, **info,
                    **({} if dateien else {"error": "no frames written (numbers outside the video?)"}))
    if not ziel.is_file():
        return {"ok": False, "error": "render ended without file"}
    n = 0
    try:   # Bildzahl mit ffmpeg selbst (ffprobe liegt nicht überall bei): Strom ins Leere kopieren, letzte „frame=“
        import re
        import subprocess
        err = subprocess.run([A.find_ffmpeg(), "-hide_banner", "-i", str(ziel), "-map", "0:v:0", "-c", "copy", "-f", "null", "-"],
                             capture_output=True, text=True, timeout=300).stderr
        treffer = re.findall(r"frame=\s*(\d+)", err or "")
        n = int(treffer[-1]) if treffer else 0
    except Exception:  # noqa: BLE001
        pass
    return dict({"ok": True, "file": str(ziel), "datei": str(ziel), "frames": n or None}, **info)


def _selbst_aufruf(app) -> list:
    """Wie startet man diese App noch einmal als Kommandozeile? (Windows: die Konsolenfassung gpsstudio.exe)"""
    if getattr(sys, "frozen", False):
        exe = Path(sys.executable)
        if sys.platform == "win32" and exe.with_name("gpsstudio.exe").is_file():
            return [str(exe.with_name("gpsstudio.exe"))]
        return [str(exe)] + ([] if exe.stem.lower() == "gpsstudio" else ["cli"])
    return [sys.executable, str(Path(app.__file__).resolve()), "cli"]


def _vorschau_mass(text: str | None) -> tuple:
    if not text:
        return 0, 0
    try:
        w, h = (int(x) for x in text.lower().split("x"))
        if w >= 200 and h >= 100:
            return w, h
    except ValueError:
        pass
    raise CliFehler("--preview must look like 960x540", code=2, fehler="--vorschau braucht die Form 960x540")


def _paket_pruefen(a) -> Path:
    paket = Path(a.rzproj).expanduser().resolve()
    if not paket.is_file():
        raise CliFehler(f"file not found: {paket}", code=2, fehler=f"Datei fehlt: {paket}")
    return paket


def _im_temp_app_ordner(app, befehl: list, schreibbar: list, meldung: str, was: str) -> dict:
    """Diesen Befehl noch einmal als Kindprozess mit leerem Temp-App-Ordner starten (Schreibsperre auf ihn und
    `schreibbar`, Kopie der Nutzer-Einstellungen) und dessen Ergebnis-Zeile zurückgeben."""
    arbeit = Path(tempfile.mkdtemp(prefix="gpsstudio-kamera-")).resolve()
    try:
        app._ds.temp_ordner_merken(arbeit)   # der Dateischutz darf ihn am Ende löschen
    except Exception:  # noqa: BLE001
        pass
    try:
        appo, bib = arbeit / "App-Ordner", arbeit / "Bibliothek"
        appo.mkdir()
        (appo / "bibliothek.json").write_text(json.dumps({"pfad": str(bib), "vorher": []}), encoding="utf-8")
        (appo / "testrechner.json").write_text(json.dumps({"schreiben_nur_in": [str(arbeit)] + [str(x) for x in schreibbar]}), encoding="utf-8")
        # die Einstellungen des Nutzers als Kopie (Kartendienste, Schlüssel, Gelände) — das Original bleibt unberührt
        einst = {}
        try:
            einst = json.loads((Path(app.APP_SUPPORT) / "settings.json").read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            pass
        einst.update({"onboarding_done": True, "logbuch_lernen_gefragt": True, "update_check_enabled": False,
                      "willkommen_beim_start": False})
        (appo / "settings.json").write_text(json.dumps(einst), encoding="utf-8")
        app.cbib.anlegen(bib)
        env = dict(os.environ, RZ_APP_ORDNER=str(appo), RZ_CLOUD_ABLAGE="datei", RZ_KEIN_WILLKOMMEN="1", RZ_CLOUD="0")
        env[_KAMERA_KIND] = "1"
        env.pop("RZ_SETTINGS_DATEI", None)
        _melden(meldung)
        import subprocess
        r = subprocess.run(_selbst_aufruf(app) + befehl, env=env, stdout=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")
        zeilen = [z for z in (r.stdout or "").splitlines() if z.strip().startswith("{")]
        try:
            erg = json.loads(zeilen[-1]) if zeilen else {}
        except ValueError:
            erg = {}
        if not erg:
            raise CliFehler(f"{was} ended without result (exit {r.returncode})", fehler=f"kein Ergebnis (exit {r.returncode})")
        if not erg.get("ok"):
            raise CliFehler(str(erg.get("error") or f"{was} failed"), fehler=str(erg.get("error") or ""))
        return erg
    finally:
        _aufraeumen(app, arbeit)


def _kamera_export(app, a) -> dict:
    paket = _paket_pruefen(a)
    w, h = _vorschau_mass(a.preview)
    if os.environ.get(_KAMERA_KIND) == "1":   # Kind: der App-Ordner ist schon der leere Temp-Ordner — dessen Bibliothek
        # darf die Api öffnen und beschreiben (ohne CLI_MODUS; der hielte sie geschlossen)
        return kamera_aus_paket(app, app.Api(), paket, Path(a.out), w, h)
    stamm = paket.stem + ".kamera"
    ziel = _ziel(app, None, a.out or str(paket.parent / (stamm + ".json")), stamm, ".json", a.overwrite)
    return _im_temp_app_ordner(app, ["camera-export", "--rzproj", str(paket), "--out", str(ziel)] + (["--preview", a.preview] if a.preview else []),
                               [ziel.parent], _t(app, "cli.schritt_kamera", "Kamerafahrt wird berechnet: {p}").replace("{p}", str(ziel)),
                               "camera export")


def _bilder_liste(text: str | None) -> list:
    if not text:
        return []
    try:
        return sorted({int(x) for x in str(text).replace(";", ",").split(",") if x.strip()})
    except ValueError:
        raise CliFehler("--frames must look like 600,1199", code=2, fehler="--bilder braucht die Form 600,1199") from None


def _overlay_export(app, a) -> dict:
    paket = _paket_pruefen(a)
    w, h = _vorschau_mass(a.preview)
    bilder = _bilder_liste(a.frames)
    if os.environ.get(_KAMERA_KIND) == "1":
        return overlay_aus_paket(app, app.Api(), paket, Path(a.out), w, h, a.without_track, bilder, a.with_labels)
    stamm = paket.stem + ".overlay"
    ziel = _ziel(app, None, a.out or str(paket.parent / (stamm + ".mov")), stamm, ".mov", a.overwrite)
    if bilder and not a.overwrite and any(Path(f"{ziel.with_suffix('')}_{n}.png").exists() for n in bilder):
        ziel = ziel.with_name(_dt.datetime.now().strftime("%Y%m%d-%H%M%S-") + ziel.name)   # Bilder nie überschreiben
    befehl = ["overlay-export", "--rzproj", str(paket), "--out", str(ziel)] + (["--preview", a.preview] if a.preview else []) \
        + (["--without-track"] if a.without_track else []) + (["--with-labels"] if a.with_labels else []) \
        + (["--frames", ",".join(map(str, bilder))] if bilder else [])
    return _im_temp_app_ordner(app, befehl, [ziel.parent],
                               _t(app, "cli.schritt_overlay", "Einblendungen werden transparent gerendert: {p}").replace("{p}", str(ziel)),
                               "overlay export")


# ── Einstieg ────────────────────────────────────────────────────────────────────────────────────────────────────────

def _parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="gpsstudio", description="GPS Studio from the command line. Prints one JSON line on stdout; progress goes to stderr.")
    ap.add_argument("--library", help="GPS Studio library folder (default: the one the app uses)")
    sub = ap.add_subparsers(dest="command", required=True)
    t = sub.add_parser("tours", help="list tours of the archive")
    t.add_argument("--search", default="", help="words to search for (name, place, year, tag, note, documents)")
    t.add_argument("--limit", type=int, default=50)
    sub.add_parser("templates", help="list video templates (built-in and your own ★ templates)")
    r = sub.add_parser("render", help="render a video of a tour")
    r.add_argument("tour", help="GPX/FIT/… file, tour id from `gpsstudio tours`, or a unique tour name")
    r.add_argument("--template", default="landscape", help="landscape, memory, social or the name of your own ★ template")
    r.add_argument("--camera", choices=list(KAMERAS), help="camera flight style: " + ", ".join(KAMERAS))
    r.add_argument("--format", choices=FORMATE)
    r.add_argument("--length", type=float, help="video length in seconds (15–600)")
    r.add_argument("--no-photos", action="store_true", help="no photo stops")
    r.add_argument("--circle-photos", action="store_true", help="camera circles once around each photo stop")
    r.add_argument("--out", help="output file or folder (default: the app's render folder)")
    r.add_argument("--overwrite", action="store_true", help="overwrite an existing file (default: add a timestamp)")
    m = sub.add_parser("map-image", help="render a map image (PNG) of a tour")
    m.add_argument("tour")
    m.add_argument("--out")
    m.add_argument("--overwrite", action="store_true")
    k = sub.add_parser("camera-export", help="camera move of an exported project (.rzproj) frame by frame as JSON (rz-kamera/1), no video")
    k.add_argument("--rzproj", required=True, help="project exported from GPS Studio (Project → Export project (.rzproj))")
    k.add_argument("--out", "--ziel", dest="out", help="output .json (default: next to the .rzproj, NAME.kamera.json)")
    k.add_argument("--preview", "--vorschau", dest="preview", help="preview size in CSS px as in the app, e.g. 960x540 (zoom refers to it)")
    k.add_argument("--overwrite", action="store_true", help="overwrite an existing file (default: add a timestamp)")
    o = sub.add_parser("overlay-export", help="overlays of an exported project (.rzproj) as transparent video (ProRes 4444 with alpha), same frames as the camera export")
    o.add_argument("--rzproj", required=True, help="project exported from GPS Studio (Project → Export project (.rzproj))")
    o.add_argument("--out", "--ziel", dest="out", help="output .mov (default: next to the .rzproj, NAME.overlay.mov)")
    o.add_argument("--without-track", "--ohne-track", dest="without_track", action="store_true",
                   help="leave out route line and running dot (for 3D tools that draw them themselves)")
    o.add_argument("--with-labels", "--mit-beschriftung", dest="with_labels", action="store_true",
                   help="keep the map labels (places, POIs, roads, transit as switched on in the project); the map itself stays transparent")
    o.add_argument("--frames", "--bilder", dest="frames", help="only these frames (0-based, e.g. 600,1199) as PNG with alpha: NAME_<nr>.png")
    o.add_argument("--preview", "--vorschau", dest="preview", help="preview size in CSS px as in the app, e.g. 960x540")
    o.add_argument("--overwrite", action="store_true", help="overwrite existing files (default: add a timestamp)")
    s = sub.add_parser("mcp", help="run as MCP server for AI assistants (stdio; started by the AI app, not by hand)")
    s.add_argument("--out-dir", help="folder for videos and map images (default: the app's render folder)")
    return ap


def main(argv: list, app) -> int:
    echt = sys.stdout
    sys.stdout = sys.stderr   # nur die Ergebnis-Zeile gehört nach stdout
    try:
        import logging
        for h in logging.getLogger().handlers:
            if isinstance(h, logging.StreamHandler) and getattr(h, "stream", None) in (echt, sys.__stdout__):
                h.setStream(sys.stderr)
    except Exception:  # noqa: BLE001
        pass

    _LAUF.update(out=echt, app=app, ausgegeben=False)

    def ausgabe(d: dict) -> None:
        _ausgabe_einmal(d)

    try:
        a = _parser().parse_args(argv)
    except SystemExit as e:
        if e.code in (0, None):
            return 0
        ausgabe({"ok": False, "error": "usage"})
        return 2
    tmp = None
    if sys.platform != "win32":
        # 13.10.2026 — abgebrochen (MCP cancel_job, kill): wie Strg+C behandeln, damit finally den Temp-Ordner räumt
        import signal
        signal.signal(signal.SIGTERM, _abbrechen)
    try:
        if a.command in ("camera-export", "overlay-export"):   # 26.10.2026 — eigener Temp-App-Ordner, nicht die Bibliothek
            erg = _kamera_export(app, a) if a.command == "camera-export" else _overlay_export(app, a)
            ausgabe(erg)
            return 0 if erg.get("ok") else 1
        global _API
        api, tmp = _vorbereiten(app, a.library)
        _API = api
        _LAUF["tmp"] = tmp
        if a.command == "tours":
            ausgabe(_tours(app, api, a.search, a.limit))
        elif a.command == "templates":
            ausgabe(_templates(api))
        elif a.command == "render":
            if a.length is not None and not (15 <= a.length <= 600):
                raise CliFehler("--length must be between 15 and 600 seconds", code=2)
            gpx = api._ensure_gpx(_tour_aufloesen(app, api, a.tour))
            ausgabe(asyncio.run(_render(app, api, gpx, a)))
        elif a.command == "map-image":
            gpx = api._ensure_gpx(_tour_aufloesen(app, api, a.tour))
            ausgabe(asyncio.run(_kartenbild(app, api, gpx, a)))
        elif a.command == "mcp":
            from core import mcp_server
            ordner = Path(a.out_dir).expanduser().resolve() if a.out_dir else Path(app.APP_SUPPORT) / "_renders"
            return mcp_server.laufen(app, api, ordner, a.library, echt)
        return 0
    except CliFehler as e:
        _melden(f"✗ {e}")
        ausgabe(dict({"ok": False, "error": str(e)}, **e.mehr))
        return e.code
    except Exception as e:  # noqa: BLE001
        _melden(f"✗ {type(e).__name__}: {e}")
        ausgabe({"ok": False, "error": f"{type(e).__name__}: {e}"})
        return 1
    except KeyboardInterrupt:
        if not _ABGEBROCHEN.is_set():
            _melden("✗ cancelled")
        ausgabe({"ok": False, "error": "cancelled"})
        return 130
    finally:
        if tmp is not None:
            _aufraeumen(app, tmp)


# ── Einrichten (Einstellungen → Für Fortgeschrittene → „Kommandozeile einrichten“) ────────────────────────────────────

def _befehl_ziel() -> Path:
    if sys.platform == "win32":
        # liegt bei jedem Windows-Benutzer schon im PATH (dort legt Windows auch seine App-Aliase ab)
        return Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData" / "Local"))) / "Microsoft" / "WindowsApps" / "gpsstudio.cmd"
    return Path.home() / ".local" / "bin" / "gpsstudio"


def _befehl_inhalt(root: Path) -> str:
    frozen = getattr(sys, "frozen", False)
    if sys.platform == "win32":
        exe = Path(sys.executable).with_name("gpsstudio.exe") if frozen else None
        aufruf = f'"{exe}"' if exe and exe.is_file() else (f'"{sys.executable}" cli' if frozen else f'"{sys.executable}" "{root / "app.py"}" cli')
        return f"@echo off\r\nrem GPS Studio command line (set up by the app)\r\n{aufruf} %*\r\n"
    aufruf = f'"{sys.executable}" cli' if frozen else f'"{sys.executable}" "{root / "app.py"}" cli'
    return f"#!/bin/sh\n# GPS Studio command line (set up by the app; set up again in Settings after moving the app)\nexec {aufruf} \"$@\"\n"


def status(root: Path) -> dict:
    """Ist `gpsstudio` eingerichtet, und zeigt er auf diese App?"""
    ziel = _befehl_ziel()
    da = ziel.is_file()
    aktuell = da and ziel.read_text(encoding="utf-8", errors="replace") == _befehl_inhalt(root)
    im_path = str(ziel.parent) in (os.environ.get("PATH") or "").split(os.pathsep)
    return {"ok": True, "pfad": str(ziel), "eingerichtet": da, "aktuell": bool(aktuell), "im_path": im_path,
            "ordner": str(ziel.parent)}


def einrichten(root: Path) -> dict:
    """Legt den Befehl `gpsstudio` an (Mac/Linux: ~/.local/bin, Windows: …\\WindowsApps\\gpsstudio.cmd)."""
    ziel = _befehl_ziel()
    try:
        ziel.parent.mkdir(parents=True, exist_ok=True)
        ziel.write_text(_befehl_inhalt(root), encoding="utf-8", newline="")
        if sys.platform != "win32":
            ziel.chmod(0o755)
    except OSError as e:
        return {"ok": False, "error": str(e), "pfad": str(ziel)}
    return status(root)
