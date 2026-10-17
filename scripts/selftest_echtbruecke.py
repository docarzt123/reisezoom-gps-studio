"""Hilfe für Selbsttests: die echte Oberfläche an die echte Brücke (app.Api) hängen — headless.

Aus selftest_realbridge.py herausgelöst (BRIDGE_JS, bridge(), Seite starten). Playwright lädt
ui/index.html; `window.pywebview.api` ist ein Proxy, der jeden Aufruf über `page.expose_function`
an `app.Api()` weiterreicht. Alle Daten der App (Einstellungen, Projekte, Caches) liegen in einem
frischen Temp-Verzeichnis (RZ_APP_ORDNER); der echte App-Ordner wird nie berührt.

Wichtig: Dieses Modul MUSS vor `import app` importiert werden — RZ_APP_ORDNER wird hier gesetzt,
bevor die App ihren Datenordner bestimmt.

Benutzung:
    import selftest_echtbruecke as eb
    async with async_playwright() as p:
        browser, page, fehler = await eb.seite_starten(p)
        ...
        await browser.close()
"""
import atexit
import json
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

# Frischer App-Ordner, immer — ein von außen gesetztes RZ_APP_ORDNER wird bewusst überschrieben.
APP_ORDNER = Path(tempfile.mkdtemp(prefix="rz-echtbruecke-"))
os.environ["RZ_APP_ORDNER"] = str(APP_ORDNER)
atexit.register(shutil.rmtree, str(APP_ORDNER), True)

sys.path.insert(0, str(REPO))
os.chdir(REPO)
import app as APP  # noqa: E402

api = APP.Api()
api.settings_set({"onboarding_done": True, "force_osm": False})

BRIDGE_JS = r"""
(() => {
  window.__rzKeinPmBoot = true;
  const NATIVE = {   // Dialoge/Fenster: nie native Aufrufe aus dem Prüfstand
    pick_save_path: async (name) => (window.__rzSavePath || null),
    pick_file: async () => null, pick_folder: async () => null,
    set_window_size: async () => ({ ok: true }), get_window_size: async () => ({ width: 1400, height: 900 }),
    quit: async () => {}, on_loaded: () => {}, open_url: async () => ({ ok: true }),
  };
  const api = new Proxy({}, {
    get(_t, name) {
      if (name in NATIVE) return NATIVE[name];
      if (typeof name !== "string") return undefined;
      return async (...args) => {
        const res = await window.rzBridge(name, JSON.stringify(args));
        return JSON.parse(res);
      };
    },
  });
  window.pywebview = { api };
  window.__applogs = [];
  window.dispatchEvent(new Event("pywebviewready"));
})();
"""


def bridge(name, args_json):
    """Ein Aufruf der Oberfläche an die echte Api; Antwort als JSON-Text."""
    args = json.loads(args_json)
    t0 = time.time()
    sys.stderr.write(f"[bridge] > {name}\n")
    sys.stderr.flush()
    try:
        return _bridge(name, args)
    finally:
        sys.stderr.write(f"[bridge] < {name} {time.time() - t0:.2f}s\n")
        sys.stderr.flush()


def _bridge(name, args):
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


async def seite_starten(p, init_skripte=(), viewport=None, warte_ms=4000):
    """Startet Chromium, hängt die echte Brücke an und lädt ui/index.html.

    init_skripte: JS-Texte, die VOR der Brücke in jede Seite eingespielt werden (z. B. window-Schalter).
    Liefert (browser, page, fehler); `fehler` sammelt die pageerror-Texte der Seite.
    """
    browser = await p.chromium.launch(headless=True, args=["--use-angle=default", "--enable-webgl", "--ignore-gpu-blocklist"])
    page = await browser.new_page(viewport=viewport or {"width": 1400, "height": 900})
    fehler = []
    page.on("pageerror", lambda e: fehler.append(str(e)[:300]))
    await page.expose_function("rzBridge", bridge)
    for js in init_skripte:
        await page.add_init_script(js)
    await page.add_init_script(BRIDGE_JS)
    await page.goto(f"file://{(REPO / 'ui/index.html').resolve()}", wait_until="domcontentloaded")
    await page.wait_for_timeout(warte_ms)
    return browser, page, fehler
