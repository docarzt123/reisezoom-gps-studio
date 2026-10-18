#!/usr/bin/env python3
"""Selbsttest „Kamerabahn glätten“ (18.10.2026): Regler-Bereich und Sichtbarkeit.

Das Schnell-Video speichert `camera_follow_glatt_m` bis 4000 m. Der Regler reichte nur bis 1000 m
(das Range-Input kappte den gespeicherten Wert still) und war im Kamerafahrt-Modus samt
„Kamera folgt Track“ ausgeblendet, obwohl die Follow-Kamera dort weiterwirkt.

A) gespeicherte 2075 m → Regler und `_folgeGlattM()` zeigen 2075
B) 4000 bleibt 4000; Werte darüber werden auf 4000 gekappt
C) Kamerafahrt-Modus (keyframes_enabled) mit aktiver Follow-Kamera: Regler sichtbar
D) Follow-Kamera aus: Regler verborgen (wie bisher)
E) Standbild-Modus (Tour-Map): Regler bleibt ausgeblendet

Die echte Oberfläche läuft headless an der echten Brücke (app.Api), alle Daten in einem Temp-Ordner;
der echte App-Ordner wird nie berührt.

Aufruf: python scripts/selftest_kamerabahn_regler.py
Ausgabe: je Prüfung OK/FAIL, am Ende RESULT: OK bzw. RESULT: FAIL (Exit 0 / 1).
"""
import asyncio
import atexit
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
# Frischer App-Ordner, bevor die App ihren Datenordner bestimmt.
APP_ORDNER = Path(tempfile.mkdtemp(prefix="rz-kamerabahn-"))
os.environ["RZ_APP_ORDNER"] = str(APP_ORDNER)
atexit.register(shutil.rmtree, str(APP_ORDNER), True)
sys.path.insert(0, str(REPO))
os.chdir(REPO)
import app as APP  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

api = APP.Api()
api.settings_set({"onboarding_done": True, "force_osm": False})
ergebnisse = []

BRIDGE_JS = r"""
(() => {
  window.__rzKeinPmBoot = true;
  const NATIVE = {
    pick_save_path: async () => null, pick_file: async () => null, pick_folder: async () => null,
    set_window_size: async () => ({ ok: true }), get_window_size: async () => ({ width: 1400, height: 900 }),
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
  window.__applogs = [];
  window.dispatchEvent(new Event("pywebviewready"));
})();
"""


def bruecke(name, args_json):
    fn = getattr(api, name, None)
    if fn is None or name.startswith("_"):
        return json.dumps({"ok": False, "error": f"no bridge {name}"})
    try:
        return json.dumps(fn(*json.loads(args_json)), default=str)
    except Exception as e:  # noqa: BLE001
        return json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"})


def pruefe(name, ok, info=""):
    ergebnisse.append(bool(ok))
    print(("OK   " if ok else "FAIL ") + name + (f"  [{info}]" if info and not ok else ""))
    sys.stdout.flush()


# Projektwerte setzen und die Bindungen neu einlesen (wie beim Projektwechsel).
SETZEN_JS = """(werte) => {
  _activeProject = { id: "t", name: "t", animator: werte };
  rebindAllSettings();
  // bindSetting kennt für den Kamerafahrt-Schalter nur onChange → wie ein Klick des Nutzers nachziehen.
  document.getElementById("anim-kf-enabled").dispatchEvent(new Event("change", { bubbles: true }));
}"""
ZUSTAND_JS = """() => {
  const r = document.getElementById("anim-follow-glatt");
  const v = document.getElementById("anim-follow-glatt-v");
  return { da: !!r, wert: r && r.value, anzeige: v && v.textContent,
           sichtbar: !!r && r.offsetParent !== null, max: r && r.max,
           klassikVerborgen: document.getElementById("anim-camera-body-classic").hidden };
}"""


async def zustand(page, werte):
    await page.evaluate(SETZEN_JS, werte)
    await page.wait_for_timeout(300)
    return await page.evaluate(ZUSTAND_JS)


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--use-angle=default", "--enable-webgl", "--ignore-gpu-blocklist"])
        page = await browser.new_page(viewport={"width": 1400, "height": 900})
        fehler = []
        page.on("pageerror", lambda e: fehler.append(str(e)[:300]))
        await page.expose_function("rzBridge", bruecke)
        await page.add_init_script(BRIDGE_JS)
        await page.goto(f"file://{(REPO / 'ui/index.html').resolve()}", wait_until="domcontentloaded")
        await page.wait_for_timeout(3000)
        await page.evaluate("window.switchMod('animator')")
        await page.wait_for_timeout(2500)

        # Die Kamera-Regler liegen in einem zugeklappten Abschnitt und unter „Mehr“ (<details>) —
        # für die Sichtbarkeitsprüfung beides aufklappen, damit nur die Regler-Logik zählt.
        await page.evaluate("""() => {
          const m = document.getElementById('anim-kamera-mehr');
          if (m) m.open = true;
          const k = m && m.closest('.section-collapse-body');
          if (k) k.hidden = false;
        }""")

        folgen = {"camera_follow_track": True, "keyframes_enabled": False}
        s = await zustand(page, {**folgen, "camera_follow_glatt_m": 2075})
        pruefe("A1 gespeicherte 2075 m: Regler zeigt 2075, Anzeige „2075 m“", s["wert"] == "2075" and s["anzeige"] == "2075 m", s)
        pruefe("A2 Klassik-Modus, Follow an: Regler sichtbar", s["sichtbar"], s)

        s = await zustand(page, {**folgen, "camera_follow_glatt_m": 4000})
        pruefe("B1 4000 m bleiben 4000 (Deckel des Schnell-Videos)", s["wert"] == "4000" and s["anzeige"] == "4000 m", s)
        s = await zustand(page, {**folgen, "camera_follow_glatt_m": 5000})
        pruefe("B2 5000 m werden auf 4000 gekappt (Anzeige)", s["anzeige"] == "4000 m", s)

        s = await zustand(page, {"camera_follow_track": True, "keyframes_enabled": True, "camera_follow_glatt_m": 1850})
        pruefe("C0 Kamerafahrt-Modus: Klassik-Kamerabereich ist verborgen (Voraussetzung)", s["klassikVerborgen"], s)
        pruefe("C1 Kamerafahrt-Modus + Follow-Kamera: Regler sichtbar", s["sichtbar"], s)
        pruefe("C2 Kamerafahrt-Modus: gespeicherte 1850 m bleiben erhalten", s["anzeige"] == "1850 m", s)

        s = await zustand(page, {"camera_follow_track": False, "keyframes_enabled": True, "camera_follow_glatt_m": 1850})
        pruefe("D1 Kamerafahrt-Modus ohne Follow-Kamera: Regler verborgen", not s["sichtbar"], s)
        s = await zustand(page, {"camera_follow_track": False, "keyframes_enabled": False, "camera_follow_glatt_m": 1850})
        pruefe("D2 Klassik-Modus ohne Follow-Kamera: Regler verborgen", not s["sichtbar"], s)

        # E) Standbild-Modus: eigene Modul-Einhängung der Tour-Map
        await page.evaluate("window.switchMod('tourmap')")
        await page.wait_for_timeout(2500)
        await page.evaluate("""() => { _activeProject = { id: "t", name: "t", tourmap: { camera_follow_track: true } }; rebindAllSettings(); }""")
        await page.wait_for_timeout(300)
        await page.evaluate("""() => {
          const m = document.getElementById('anim-kamera-mehr');
          const k = m && m.closest('.section-collapse-body');
          if (k) k.hidden = false;
        }""")
        s = await page.evaluate(ZUSTAND_JS)
        # Voraussetzung: die Neigung (bleibt im Standbild) ist sichtbar → der Abschnitt ist wirklich offen
        pitch = await page.evaluate("() => document.getElementById('anim-pitch').offsetParent !== null")
        pruefe("E0 Standbild-Modus: Neigungsregler sichtbar (Voraussetzung)", pitch)
        pruefe("E1 Standbild-Modus: Regler vorhanden, aber ausgeblendet", s["da"] and not s["sichtbar"], s)
        pruefe("F kein pageerror", not fehler, fehler[:3])
        await browser.close()
    ok = all(ergebnisse)
    print("RESULT: " + ("OK" if ok else "FAIL"))
    return 0 if ok else 1


sys.exit(asyncio.run(main()))
