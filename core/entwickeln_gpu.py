"""Fotos entwickeln auf der Grafikkarte — derselbe Code wie die Live-Vorschau der Lupe (21.10.2026).

Bisher rechnete die Grafikkarte (ui/js/entwickeln_gl.js) nur die Vorschau; alles, was gespeichert wird — Export,
„Als neue Datei“, Raster-Vorschaubilder, Video, Schilder — rechnete numpy (`core/entwickeln._ton`). Jedes Werkzeug
gab es damit zweimal, und beide mussten gleich aussehen.

Jetzt läuft auch das Gespeicherte durch entwickeln_gl.js: ein unsichtbarer Chromium (wie beim Video-Render,
Playwright) hält eine leere Seite mit dem Entwickler offen. Python reicht die Pixel roh hinein und bekommt sie roh
zurück — über einen kleinen Server nur auf 127.0.0.1 mit Zufallspfad (24 MP hin und zurück ≈ 0,2 s; abgefangene
Anfragen über Playwright brauchten fürs Zurück 1,5 s je 11 MB, Base64 ähnlich). Ein eigener Faden
besitzt den Browser; alle Aufrufe stellen sich bei ihm an. Nach `LEERLAUF_S` ohne Auftrag geht der Browser wieder zu.

Gibt es keinen Chromium, kein WebGL 2 oder schlägt etwas fehl, liefert `entwickeln` None — dann rechnet wie bisher
numpy (nur die Grundregler, siehe entwickeln.anwenden). `RZ_ENTWICKELN_GPU=0` schaltet den Weg ab.
"""
from __future__ import annotations

import logging
import os
import queue
import secrets
import threading
import time
from pathlib import Path
from typing import Optional

_log = logging.getLogger(__name__)

LEERLAUF_S = 90          # so lange bleibt der Browser nach dem letzten Auftrag offen
ZEITLIMIT_S = 60         # je Bild
MAX_KANTE = 16384        # größer kann WebGL meist nicht; dann numpy
import sys
_JS = Path(getattr(sys, "_MEIPASS", "") or Path(__file__).resolve().parent.parent) / "ui" / "js" / "entwickeln_gl.js"

_SEITE = """<!doctype html><meta charset="utf-8"><title>rz-entwickeln</title><body><script>__JS__</script><script>
window.__rzEntwickeln = async (w, h, werte, rahmen) => {
  const roh = new Uint8Array(await (await fetch("ein")).arrayBuffer());
  if (!window.__rzE) window.__rzE = new rzEntwickler.EntwicklerGL(document.createElement("canvas"));
  const e = window.__rzE;
  e.quelleRoh(roh, w, h);
  const r = e.ausgeben(werte, { rahmen: !!rahmen });
  await fetch("aus", { method: "POST", body: new Blob([r.pixel]) });   // Blob: als ArrayBuffer 20× langsamer
  return { breite: r.breite, hoehe: r.hoehe };
};
window.__rzBereit = (() => {
  if (!(window.rzEntwickler && rzEntwickler.EntwicklerGL.geht())) return "kein WebGL 2";
  const g = document.createElement("canvas").getContext("webgl2"), e = g.getExtension("WEBGL_debug_renderer_info");
  const r = String(e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER));
  // Ohne echte Grafikkarte rechnet Chromium in Software (SwiftShader) — dann ist numpy schneller
  return /swiftshader|llvmpipe|software/i.test(r) ? "nur Software-Grafik (" + r + ")" : true;
})();
</script>"""

_lock = threading.Lock()
_faden: Optional[threading.Thread] = None
_auftraege: "queue.Queue" = queue.Queue()
_kaputt: Optional[str] = None      # Grund, warum der Weg nicht geht (dann nicht jedes Mal neu versuchen)


def an() -> bool:
    return (os.environ.get("RZ_ENTWICKELN_GPU", "1").strip() not in ("0", "nein", "aus")) and _kaputt is None


def grund() -> Optional[str]:
    return _kaputt


def entwickeln(img, werte: dict, rahmen: bool = False):
    """PIL-Bild + wirksame Werte → entwickeltes PIL-Bild (RGB) oder None (dann numpy)."""
    if not an():
        return None
    w, h = img.size
    if max(w, h) > MAX_KANTE or w < 1 or h < 1:
        return None
    _starten()
    fertig = threading.Event()
    kiste: dict = {}
    _auftraege.put((img.convert("RGBA").tobytes(), w, h, dict(werte or {}), bool(rahmen), kiste, fertig))
    if not fertig.wait(ZEITLIMIT_S + 30):
        _log.warning("[gpu] keine Antwort nach %d s — numpy", ZEITLIMIT_S + 30)
        return None
    if "fehler" in kiste:
        return None
    from PIL import Image
    bw, bh = kiste["groesse"]
    return Image.frombytes("RGBA", (bw, bh), kiste["pixel"]).convert("RGB")


def _starten() -> None:
    global _faden
    with _lock:
        if _faden is not None and _faden.is_alive():
            return
        _faden = threading.Thread(target=_lauf, name="rz-entwickeln-gpu", daemon=True)
        _faden.start()


def _lauf() -> None:
    """Der Faden, dem der Browser gehört. Endet nach LEERLAUF_S ohne Auftrag (der nächste Auftrag startet neu)."""
    global _kaputt, _faden
    try:
        from playwright.sync_api import sync_playwright
    except Exception as e:  # noqa: BLE001
        _kaputt = f"Playwright fehlt: {e}"
        _alle_abweisen()
        return
    pw = browser = server = None
    try:
        t0 = time.time()
        server, basis, ablage = _server()
        pw = sync_playwright().start()
        browser = pw.chromium.launch(headless=True, args=[
            "--use-angle=default", "--enable-webgl", "--ignore-gpu-blocklist", "--disable-gpu-sandbox",
            "--disable-background-networking", "--no-first-run", "--no-default-browser-check"])
        page = browser.new_page()
        page.goto(basis)
        bereit = page.evaluate("() => window.__rzBereit")
        if bereit is not True:
            raise RuntimeError(f"unsichtbarer Browser: {bereit}")
        _log.info("[gpu] Entwickler bereit in %.1f s", time.time() - t0)
        while True:
            try:
                auftrag = _auftraege.get(timeout=LEERLAUF_S)
            except queue.Empty:
                with _lock:     # nur aufhören, wenn wirklich nichts mehr wartet
                    if _auftraege.empty():
                        _faden = None
                        break
                continue
            roh, w, h, werte, rahmen, kiste, fertig = auftrag
            try:
                t1 = time.time()
                ablage["ein"] = roh
                ablage.pop("aus", None)
                r = page.evaluate("([w, h, werte, rahmen]) => window.__rzEntwickeln(w, h, werte, rahmen)",
                                  [w, h, werte, rahmen])
                pixel = ablage.pop("aus", None)
                if not pixel or len(pixel) != r["breite"] * r["hoehe"] * 4:
                    raise RuntimeError(f"Pixel fehlen ({len(pixel or b'')} statt {r['breite'] * r['hoehe'] * 4})")
                kiste["groesse"] = (r["breite"], r["hoehe"])
                kiste["pixel"] = pixel
                _log.debug("[gpu] %dx%d → %dx%d in %.2f s", w, h, r["breite"], r["hoehe"], time.time() - t1)
            except Exception as e:  # noqa: BLE001
                kiste["fehler"] = str(e)
                _log.warning("[gpu] Entwickeln fehlgeschlagen (%dx%d): %s — numpy", w, h, e)
            finally:
                ablage.pop("ein", None)
                fertig.set()
    except Exception as e:  # noqa: BLE001
        _kaputt = str(e)[:300]
        _log.warning("[gpu] Grafikkarten-Weg nicht verfügbar: %s — numpy rechnet", _kaputt)
        _alle_abweisen()
    finally:
        for zu in (lambda: browser and browser.close(), lambda: pw and pw.stop(),
                   lambda: server and (server.shutdown(), server.server_close())):
            try:
                zu()
            except Exception:  # noqa: BLE001
                pass


def _server():
    """Kleiner Server nur für den unsichtbaren Browser: Seite, Eingangs-Pixel, Ergebnis. Pfad mit Zufallsteil, damit
    andere Programme auf dem Rechner nichts abgreifen."""
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    geheim = secrets.token_hex(12)
    ablage: dict = {}
    seite = _SEITE.replace("__JS__", _JS.read_text(encoding="utf-8")).encode("utf-8")

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):  # noqa: D401
            pass

        def _antwort(self, body: bytes, typ: str) -> None:
            self.send_response(200)
            self.send_header("Content-Type", typ)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == f"/{geheim}/":
                self._antwort(seite, "text/html; charset=utf-8")
            elif self.path == f"/{geheim}/ein":
                self._antwort(ablage.get("ein", b""), "application/octet-stream")
            else:
                self.send_error(404)

        def do_POST(self):
            if self.path != f"/{geheim}/aus":
                self.send_error(404)
                return
            n = int(self.headers.get("Content-Length") or 0)
            ablage["aus"] = self.rfile.read(n)
            self._antwort(b"ok", "text/plain")

    server = ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=server.serve_forever, name="rz-entwickeln-gpu-server", daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_port}/{geheim}/", ablage


def _alle_abweisen() -> None:
    while True:
        try:
            *_, kiste, fertig = _auftraege.get_nowait()
        except queue.Empty:
            return
        kiste["fehler"] = _kaputt or "aus"
        fertig.set()
