#!/usr/bin/env python3
"""Regressions-Test: fehlende Gelände-Kacheln (DEM) dürfen nicht im gegriffenen Bild landen.

Bug: Liefert der DEM-Dienst für einzelne Kacheln 502 (oder bricht ab / antwortet zu langsam), setzt
`_install_tile_cache` die Adresse 20 s auf die Sperrliste und bricht weitere Anfragen sofort ab. MapLibre
markiert die Kachel als `errored` (hält `idle` nicht auf) bzw. lässt sie über die 5-s-Grenze von
`_WARTE_BILD_JS` hinaus `loading`. Das Bild wird trotzdem gegriffen: im Gelände fehlt ein Stück
(schwarzer Keil im Video).

Aufbau (komplett offline, ohne App und ohne Render): lokaler Kachelserver (DEM als Terrarium-PNG,
Deckschicht als bunte Kacheln) + Harness-Seite mit MapLibre + der ECHTE Handler `_install_tile_cache`
und die echten JS-Konstanten aus `core.szene`. Fehler werden im Server eingespielt (502 / Abbruch /
langsam). Geprüft werden der Kachelzustand der DEM-Quelle UND der Anteil dunkler Pixel im Bild.

Szenarien: A ohne Fehler · B Ausfall: die ersten 4 Anfragen je Kachel antworten nach 3 s mit 502 (zählbasiert,
unabhängig von der Rechnerlast) · C langsam (erste Antwort 10 s) · D dauerhaft 502 (muss begrenzt bleiben) · E sofort 502 für die ersten 3
Anfragen (Kachel endet als errored; Gelände dort flach, aber ohne schwarze Fläche).

19.10.2026 — dasselbe für Standbild und Einzelbild (WYSIWYG mit dem Video): G `render_szene_still` und H
`render_szene_frame` laufen ECHT durch (nur `_seite_vorbereiten` liefert die Harness-Seite statt der App-Szene), je mit
E-Fehlern (beim Greifen keine fehlerhafte/ladende DEM-Kachel) und D-Fehlern (Render endet, Wiederholungen begrenzt).

Umgebungsvariable `DEM_BILDER=<Ordner>`: legt je Szenario PNGs ab (vor/nach dem Nachladen).
Exit 0 = alle Fälle grün (oder übersprungen, wenn WebGL fehlt) · Exit 1 = mindestens ein Fall rot.
"""
import asyncio, io, os, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
VENDOR = REPO / "ui" / "vendor"
fehler = 0
fehl_texte: list = []


def sagen(ok: bool, text: str, zusatz: str = "") -> None:
    global fehler
    print(f"  [{'OK  ' if ok else 'FAIL'}] {text}" + (f"  {zusatz}" if zusatz else ""))
    if not ok:
        fehler += 1
        fehl_texte.append(f"{text} {zusatz}".strip())


def dem_png(z: int, x: int, y: int) -> bytes:
    """Terrarium-PNG (256x256) mit Wellen über die Weltkoordinate, damit Relief sichtbar ist."""
    import numpy as np
    from PIL import Image
    n = 256 * (2 ** z)
    px = (x * 256 + np.arange(256))[None, :] / n * 2000.0
    py = (y * 256 + np.arange(256))[:, None] / n * 2000.0
    h = 1200 + 1500 * np.sin(px) * np.cos(py * 1.3)
    v = (h + 32768.0) * 256.0
    r = np.floor(v / 65536).astype(np.uint8)
    g = (np.floor(v / 256) % 256).astype(np.uint8)
    b = (np.floor(v) % 256).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(np.dstack([r, g, b]), "RGB").save(buf, "PNG")
    return buf.getvalue()


def deck_png(z: int, x: int, y: int) -> bytes:
    """Helle, bunte Deckschicht (nie dunkel), damit ein schwarzer Keil eindeutig auffällt."""
    from PIL import Image
    c = (120 + (x * 37 + y * 11) % 120, 120 + (x * 23 + y * 53) % 120, 120 + (x * 71 + y * 29) % 120)
    buf = io.BytesIO()
    Image.new("RGB", (256, 256), c).save(buf, "PNG")
    return buf.getvalue()


HARNESS = """<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/maplibre-gl.css"><script src="/maplibre-gl.js"></script>
<style>html,body,#map{margin:0;width:100%;height:100%;background:#000}</style></head>
<body><div id="map"></div><script>
const m = new maplibregl.Map({container: 'map', fadeDuration: 0, center: [8.8, 48.36], zoom: 11, pitch: 60, bearing: 20,
  style: {version: 8, sources: {
      dem: {type: 'raster-dem', tiles: [location.origin + '/tile/terrain-aws/{z}/{x}/{y}'], tileSize: 256, encoding: 'terrarium', maxzoom: 15},
      deck: {type: 'raster', tiles: [location.origin + '/tile/deck/{z}/{x}/{y}'], tileSize: 256, maxzoom: 15}},
    layers: [{id: 'deck', type: 'raster', source: 'deck'}],
    terrain: {source: 'dem', exaggeration: 1.5}}});
window.__rzLetzteKarte = m;
// Stellvertreter für den Probelauf der App (render_szene_frame springt damit an die Videozeit)
window.__rzPreviewRun = () => {}; window.__rzPreviewStep = { ready: true, seek: () => {} };
window.demStand = () => {
  const id = m.getTerrain().source, sc = m.style.sourceCaches[id];
  const c = {loaded: 0, loading: 0, errored: 0, andere: 0, errKeys: [], ladKeys: []};
  for (const k in sc._tiles) {
    const s = sc._tiles[k].state;
    if (s === 'loaded') c.loaded++;
    else if (s === 'loading' || s === 'reloading') { c.loading++; c.ladKeys.push(k); }
    else if (s === 'errored') { c.errored++; c.errKeys.push(k); }
    else c.andere++;
  }
  c.tsc = !!(m.terrain && m.terrain.sourceCache && m.terrain.sourceCache.sourceCache === sc);
  c.areTilesLoaded = m.areTilesLoaded();
  return c;
};
window.__bereit = new Promise((r) => m.once('style.load', r));
</script></body></html>"""


class Testserver:
    """Kachelserver mit Fehlerinjektion. regel(z, x, y, anfrage_nr) → None | 'ok' | 502 | 'abbruch' | ('langsam', s)."""

    def __init__(self):
        self.regel = lambda z, x, y, n: None
        self.zaehler: dict = {}
        self.roh = 0   # Anfragen an terrain-aws-roh (Seekarte, immer 502)
        self.lock = threading.Lock()
        srv = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _senden(self, code, ctype, body):
                self.send_response(code)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                try:
                    self.wfile.write(body)
                except OSError:
                    pass

            def do_GET(self):
                p = self.path.split("?")[0]
                try:
                    if p == "/harness.html":
                        return self._senden(200, "text/html; charset=utf-8", HARNESS.encode("utf-8"))
                    if p in ("/maplibre-gl.js", "/maplibre-gl.css"):
                        ct = "text/javascript" if p.endswith("js") else "text/css"
                        return self._senden(200, ct, (VENDOR / p[1:]).read_bytes())
                    t = p.split("/")
                    if len(t) == 6 and t[1] == "tile":
                        z, x, y = int(t[3]), int(t[4]), int(t[5])
                        if t[2] == "deck":
                            return self._senden(200, "image/png", deck_png(z, x, y))
                        if t[2] == "terrain-aws-roh":
                            with srv.lock:
                                srv.roh += 1
                            return self._senden(502, "text/plain", b"Bad Gateway")
                        with srv.lock:
                            n = srv.zaehler[(z, x, y)] = srv.zaehler.get((z, x, y), 0) + 1
                        r = srv.regel(z, x, y, n)
                        if r == "abbruch":
                            self.close_connection = True
                            self.connection.close()
                            return None
                        if isinstance(r, tuple):
                            time.sleep(r[1])
                            if r[0] == "langsam502":
                                return self._senden(502, "text/plain", b"Bad Gateway")
                        elif r == 502:
                            return self._senden(502, "text/plain", b"Bad Gateway")
                        return self._senden(200, "image/png", dem_png(z, x, y))
                    self._senden(404, "text/plain", b"nicht gefunden")
                except Exception:
                    pass

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.httpd.daemon_threads = True
        self.port = self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def anfragen(self) -> int:
        with self.lock:
            return sum(self.zaehler.values())

    def stop(self):
        self.httpd.shutdown()
        self.httpd.server_close()


def dunkel_anteil(png: bytes) -> float:
    """Anteil fast schwarzer Pixel (max(R,G,B) < 40) im Bild."""
    import numpy as np
    from PIL import Image
    a = np.asarray(Image.open(io.BytesIO(png)).convert("RGB"))
    return float((a.max(axis=2) < 40).mean())


async def ruhe(page) -> None:
    """Vor dem Bildgriff: idle (höchstens 1,5 s) und zwei Zeichenläufe abwarten, damit das Bild nicht mitten im Zeichnen entsteht."""
    await page.evaluate("""() => new Promise((r) => {
      let d = false; const m = window.__rzLetzteKarte;
      const f = () => { if (d) return; d = true; requestAnimationFrame(() => requestAnimationFrame(r)); };
      try { m.once('idle', f); } catch (_) {} setTimeout(f, 1500); })""")


async def main() -> int:
    from playwright.async_api import async_playwright
    import core.animator as A
    import core.szene as S
    bilder = Path(os.environ["DEM_BILDER"]) if os.environ.get("DEM_BILDER") else None
    if bilder:
        bilder.mkdir(parents=True, exist_ok=True)
    fix_js = getattr(S, "_DEM_NACHLADEN_JS", None)
    print(f"Nachlade-JS in core.szene vorhanden: {'ja' if fix_js else 'nein'}")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--use-angle=default", "--enable-webgl", "--ignore-gpu-blocklist"])
        gewaehlt: list = []

        async def lauf(name, regel_fn, erwartet_fehler):
            srv = Testserver()
            ctx = await browser.new_context(viewport={"width": 900, "height": 600})
            page = await ctx.new_page()
            meldungen: list = []
            page.on("pageerror", lambda e: meldungen.append(str(e)[:200]))
            try:
                await page.goto(f"http://127.0.0.1:{srv.port}/harness.html")
                if not await page.evaluate("() => { try { return !!document.createElement('canvas').getContext('webgl2'); } catch (e) { return false; } }"):
                    return None
                # Erstlauf (Handler aktiv, noch kein Fehler): welche DEM-Kacheln gehören zur Ansicht?
                await A._install_tile_cache(page, SimpleNamespace(transparent_background=False))
                await page.evaluate("() => window.__bereit")
                await page.evaluate(S._WARTE_BILD_JS)
                if not gewaehlt:
                    gewaehlt.extend(sorted(k for k in srv.zaehler if (k[1] + k[2]) % 2 == 0))
                ok0 = await page.evaluate("() => window.demStand()")
                if name == "A":
                    return srv, page, ok0, ctx, 0.0
                # frische Seite, Fehler scharf
                srv.zaehler.clear()
                menge = set(gewaehlt)
                srv.regel = lambda z, x, y, n: regel_fn(n) if (z, x, y) in menge else None   # nur zählbasiert, keine Wanduhr
                await page.unroute_all()
                await page.goto(f"http://127.0.0.1:{srv.port}/harness.html")
                await A._install_tile_cache(page, SimpleNamespace(transparent_background=False))
                await page.evaluate("() => window.__bereit")
                print("  .. Seite bereit", flush=True)
                t0 = time.perf_counter()
                await page.evaluate(S._WARTE_BILD_JS)
                srv.dauer_warte = time.perf_counter() - t0
                return srv, page, ok0, ctx, 0.0
            except BaseException:
                await ctx.close()
                srv.stop()
                raise

        szenarien = [
            ("A", None, "Kontrolle ohne Fehler"),
            ("B", lambda n: ("langsam502", 3) if n <= 4 else None,
             "Ausfall: die ersten 4 Anfragen je Kachel antworten nach 3 s mit 502 (Weichen-Retry + Handler-Sperre wie in der App)"),
            ("C", lambda n: ("langsam", 10) if n == 1 else None, "erste Antwort 10 s langsam"),
            ("D", lambda n: 502, "dauerhaft sofort 502"),
            ("E", lambda n: 502 if n <= 3 else None, "sofort 502 für die ersten 3 Anfragen (Kachel endet als errored)"),
        ]
        for name, regel_fn, text in szenarien:
            print(f"\nSzenario {name}: {text}")
            erg = await lauf(name, regel_fn, name != "A")
            if erg is None:
                print("  [SKIP] WebGL2 nicht verfügbar — Szenario übersprungen")
                continue
            srv, page, st0, ctx, _ = erg
            try:
                st1 = await page.evaluate("() => window.demStand()")
                await ruhe(page)
                png1 = await page.screenshot()
                d1 = dunkel_anteil(png1)
                if bilder:
                    (bilder / f"dem_{name}_vor.png").write_bytes(png1)
                print(f"  Gutfall-Kachelzahl {st0['loaded']} (Auswahl fehlerhaft: {len(gewaehlt)}); nach _WARTE_BILD_JS: "
                      f"loaded={st1['loaded']} loading={st1['loading']} errored={st1['errored']} areTilesLoaded={st1['areTilesLoaded']} "
                      f"dunkel={d1:.4f} Serveranfragen={srv.anfragen()}")
                if name == "A":
                    sagen(st1["loaded"] > 0 and st1["errored"] == 0 and st1["tsc"], "Kalibrierung: DEM geladen, kein Fehler, Quelle = Terrain-Quelle")
                    sagen(d1 < 0.01, "Kontrollbild ohne dunkle Fläche", f"dunkel={d1:.4f}")
                    if fix_js:   # Mehraufwand je Bild im Gutfall (Zustand lesen, nichts nachladen)
                        zeiten = []
                        for _ in range(50):
                            t0 = time.perf_counter()
                            r = await page.evaluate(fix_js, 2)
                            zeiten.append((time.perf_counter() - t0) * 1000)
                        ms = sorted(zeiten)[len(zeiten) // 2]   # Median, großzügige Grenze (Rechnerlast)
                        sagen(r["runden"] == 0 and ms < 100, "Gutfall: Nachlade-Schritt lädt nichts und kostet wenig", f"{ms:.1f} ms je Aufruf")
                    continue
                sagen(st1["tsc"], "Kalibrierung: Quelle = Terrain-Quelle")
                # Nachladen (Fix), falls vorhanden
                if fix_js:
                    # wie die Bildschleife: je Bild 2 Runden; bei Restfehlern greift das nächste Bild erneut zu (höchstens 5 Bilder als großzügige Obergrenze)
                    for bild in range(1, 6):
                        t0 = time.perf_counter()
                        r = await page.evaluate(fix_js, 2)
                        print(f"  Nachladen (Bild {bild}): {r} in {time.perf_counter() - t0:.1f} s")
                        if not r["errored"] and not r["loading"]:
                            break
                st2 = await page.evaluate("() => window.demStand()")
                await ruhe(page)
                png2 = await page.screenshot()
                d2 = dunkel_anteil(png2)
                if bilder:
                    (bilder / f"dem_{name}_nach.png").write_bytes(png2)
                print(f"  danach: loaded={st2['loaded']} loading={st2['loading']} errored={st2['errored']} dunkel={d2:.4f} "
                      f"Serveranfragen={srv.anfragen()}")
                if name in ("B", "C", "E"):
                    sagen(st2["errored"] == 0 and st2["loading"] == 0, "alle DEM-Kacheln geladen, bevor das Bild gegriffen wird",
                          f"errored={st2['errored']} loading={st2['loading']}")
                    sagen(d2 < 0.01, "keine dunkle Fläche im gegriffenen Bild", f"dunkel={d2:.4f}")
                else:
                    # je Kachel: 1 Erstanfrage + 3 Neuladungen, jede mit höchstens 3 Versuchen im Handler
                    meist = max(srv.zaehler.values())
                    sagen(meist <= 12, "dauerhafter Ausfall: Wiederholungen je Kachel bleiben begrenzt", f"meiste Anfragen je Kachel={meist}")
            finally:
                if ctx:
                    await ctx.close()
                srv.stop()
        # Abgrenzung: terrain-aws-roh (Seekarte) ist KEIN Gelände und bleibt bei der 20-s-Sperre
        print("\nSzenario F: terrain-aws-roh bleibt gesperrt")
        srv = Testserver()
        ctx = await browser.new_context(viewport={"width": 900, "height": 600})
        try:
            page = await ctx.new_page()
            await page.goto(f"http://127.0.0.1:{srv.port}/maplibre-gl.css")
            await A._install_tile_cache(page, SimpleNamespace(transparent_background=False))
            url = f"http://127.0.0.1:{srv.port}/tile/terrain-aws-roh/5/17/11"
            for _ in range(2):
                await page.evaluate("(u) => fetch(u).then((r) => r.status, () => 0)", url)
            sagen(srv.roh == 3, "zweite Anfrage an terrain-aws-roh wird von der Sperre abgebrochen (3 Versuche gesamt)", f"Serveranfragen={srv.roh}")
        finally:
            await ctx.close()
            srv.stop()
        await browser.close()
    await einzelbild_faelle()
    for t in fehl_texte:   # am Ende wiederholen — run_tests.py zeigt nur das Ende der Ausgabe
        print(f"  ✗ {t}")
    print(f"\n{'ALLES GRÜN' if not fehler else str(fehler) + ' FEHLER'}")
    return 1 if fehler else 0


async def einzelbild_faelle() -> None:
    """G/H: Standbild (Tour-Map) und Einzelbild (Animator) über die echten Render-Funktionen aus core.szene."""
    import tempfile
    import core.animator as A
    import core.szene as S
    WEBGL_ARGS = ["--use-angle=default", "--enable-webgl", "--ignore-gpu-blocklist"]
    regeln = [("E", lambda n: 502 if n <= 3 else None, "sofort 502 für die ersten 3 Anfragen"),
              ("D", lambda n: 502, "dauerhaft sofort 502")]
    alt_seite, alt_greifen = S._seite_vorbereiten, A._grab_frame
    ausgabe = Path(tempfile.mkdtemp(prefix="dem-einzelbild-"))
    try:
        for fall, fn_name in (("G", "render_szene_still"), ("H", "render_szene_frame")):
            for kurz, regel_fn, text in regeln:
                print(f"\nSzenario {fall}{kurz}: {fn_name} — {text} (jede zweite Kachel)")
                srv = Testserver()
                srv.regel = lambda z, x, y, n, f=regel_fn: f(n) if (x + y) % 2 == 0 else None
                beim_greifen: dict = {}
                webgl = {"ok": True}

                async def seite(p, cfg, api, projekt_id, is_cancelled, emit, params=None, modul=None, _srv=srv, webgl=webgl):
                    b = await p.chromium.launch(headless=True, args=WEBGL_ARGS)
                    page = await (await b.new_context(viewport={"width": 900, "height": 600})).new_page()
                    await A._install_tile_cache(page, SimpleNamespace(transparent_background=False))
                    await page.goto(f"http://127.0.0.1:{_srv.port}/harness.html")
                    webgl["ok"] = await page.evaluate("() => { try { return !!document.createElement('canvas').getContext('webgl2'); } catch (e) { return false; } }")
                    if webgl["ok"]:
                        await page.evaluate("() => window.__bereit")
                    return b, page, 1, 1

                async def greifen(page, cfg, beim_greifen=beim_greifen):
                    beim_greifen.update(await page.evaluate("() => window.demStand()"))
                    return await alt_greifen(page, cfg)

                S._seite_vorbereiten, A._grab_frame = seite, greifen
                cfg = A.AnimatorConfig(gpx_path="", output_path=str(ausgabe / f"{fall}{kurz}.png"), mapbox_token="",
                                       width=900, height=600, fps=30, duration_s=4, intro_s=0, hold_s=0)
                t0 = time.perf_counter()
                try:
                    if fn_name == "render_szene_still":
                        await S.render_szene_still(cfg, api=None, projekt_id="selftest")
                    else:
                        await S.render_szene_frame(cfg, api=None, projekt_id="selftest", t_sek=1.0)
                    fertig = Path(cfg.output_path).is_file()
                except Exception as e:  # noqa: BLE001
                    fertig = False
                    print(f"  Render-Fehler: {e}")
                finally:
                    S._seite_vorbereiten, A._grab_frame = alt_seite, alt_greifen
                    srv.stop()
                if not webgl["ok"]:
                    print("  [SKIP] WebGL2 nicht verfügbar — Szenario übersprungen")
                    continue
                d = dunkel_anteil(Path(cfg.output_path).read_bytes()) if fertig else 1.0
                print(f"  beim Greifen: loaded={beim_greifen.get('loaded')} loading={beim_greifen.get('loading')} "
                      f"errored={beim_greifen.get('errored')} dunkel={d:.4f} in {time.perf_counter() - t0:.1f} s "
                      f"Serveranfragen={srv.anfragen()}")
                sagen(fertig, f"{fn_name}: Bild geschrieben")
                if kurz == "E":
                    sagen(beim_greifen.get("errored") == 0 and beim_greifen.get("loading") == 0,
                          f"{fn_name}: alle DEM-Kacheln geladen, bevor das Bild gegriffen wird",
                          f"errored={beim_greifen.get('errored')} loading={beim_greifen.get('loading')}")
                    sagen(d < 0.01, f"{fn_name}: keine dunkle Fläche im Bild", f"dunkel={d:.4f}")
                else:
                    meist = max(srv.zaehler.values()) if srv.zaehler else 0
                    sagen(meist <= 12, f"{fn_name}: dauerhafter Ausfall — Wiederholungen je Kachel begrenzt",
                          f"meiste Anfragen je Kachel={meist}")
    finally:
        S._seite_vorbereiten, A._grab_frame = alt_seite, alt_greifen
        import shutil
        shutil.rmtree(ausgabe, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
