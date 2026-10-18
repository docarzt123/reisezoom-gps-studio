#!/usr/bin/env python3
"""Selbsttest „Keyframe-Schalter blendet aus statt zu löschen“ (18.10.2026).

Der Schalter „Keyframe-Editor“ (#anim-kf-enabled) fragte beim Ausschalten „Alle Keyframes löschen?“ und
löschte die Kamera-Keyframes. Jetzt blendet er sie nur aus (`getTimelineEvents()` liefert dann keine
Kamera-Events), sie bleiben im Projekt und kommen beim Einschalten zurück.

A) Ausschalten: kein Dialog, Einstellung aus, rohe Events vollständig, wirksame Events ohne Kamera-Events
B) Einschalten: kein Dialog, Kamera-Events wieder wirksam
C) Rückgängig nach dem Ausschalten: Schalter wieder an, Events unverändert
D) Pille „Fest“, dann „Kamerafahrt“: eigene Keyframes bleiben erhalten
E) Projekt mit gespeichert ausgeschaltetem Schalter laden: Keyframes unversehrt, nicht wirksam
G) Handkamera bei ausgeschaltetem Editor mit versteckten Keyframes: von Hand verschobene Karte wird gemerkt
H) Pille „Start → Ziel“ bei ausgeschaltetem Editor mit versteckten Keyframes: Rückfrage statt stillem Ersetzen
F) kein pageerror, keine verdeckten Klicks

Die echte Oberfläche läuft headless an der echten Brücke (app.Api), alle Daten in einem Temp-Ordner;
der echte App-Ordner wird nie berührt.

Aufruf: python scripts/selftest_kf_schalter.py
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
APP_ORDNER = Path(tempfile.mkdtemp(prefix="rz-kfschalter-"))
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
    print(("OK   " if ok else "FAIL ") + name + (f"  [{str(info)[:240]}]" if info and not ok else ""))
    sys.stdout.flush()


def kf_events():
    """Acht Kamera-Events (neutrale Werte)."""
    ev = []
    for a in (0, 1):
        ev.append({"kind": "pitch", "anchor": a, "value": 40, "easing": "ease_in_out"})
        ev.append({"kind": "bearing", "anchor": a, "value": 10 * a, "easing": "ease_in_out"})
        ev.append({"kind": "zoom", "anchor": a, "value_offset": 0.5 + a, "easing": "ease_in_out"})
        ev.append({"kind": "center", "anchor": a, "value": [8.0 + a, 48.0 + a], "easing": "ease_in_out"})
    return ev


KF = kf_events()
MARKER = {"kind": "marker", "anchor": 0.5, "label": "Musterpass"}   # Nicht-Kamera-Event
ALLE = KF + [MARKER]

# Projekt setzen und Bindungen neu einlesen (wie beim Projektwechsel); `an` = keyframes_enabled.
SETZEN_JS = """([an, events, nachziehen]) => {
  _activeProject = { id: "t", name: "t", animator: { keyframes_enabled: an, timeline_events: events } };
  rebindAllSettings();
  if (nachziehen) document.getElementById("anim-kf-enabled").dispatchEvent(new Event("change", { bubbles: true }));
}"""
ZUSTAND_JS = """() => {
  // Die Funktionen des Moduls sind nicht global: rohe Events aus dem aktiven Projekt, wirksame Events aus der
  // Zeitleiste (zeichnet genau getTimelineEvents(); der Schalter blendet dort die Kamera-Marker aus).
  const KL = ["pitch", "bearing", "zoom", "center", "position"];
  const cb = document.getElementById("anim-kf-enabled");
  const ov = document.getElementById("modal-overlay");
  const pa = (getActiveProject() || {}).animator || {};
  const roh = pa.timeline_events || [];
  if (window.__rzTlBar) { window.__rzTlBar.refresh(); window.__rzTlBar.flush(); }
  const marker = document.querySelectorAll(".timeline-marker:not(.timeline-marker-cluster)").length;
  return { an: cb.checked, einst: (window.rzReadModuleSettings("animator") || {}).keyframes_enabled,
           modal: !!ov && !ov.hidden, nRoh: roh.length, wirkKamera: marker,
           roh: JSON.stringify(roh), rohKamera: JSON.stringify(roh.filter(e => KL.includes(e.kind))) };
}"""


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
        # Erststart ohne Bibliothek: das Tor (#bib-gate) deckt die Oberfläche ab und finge die Klicks ab.
        await page.add_style_tag(content="#bib-gate { display: none !important; }")
        # Der Schalter liegt unter „Mehr“ in einem zugeklappten Abschnitt → aufklappen, damit Playwright klicken kann.
        await page.evaluate("""() => {
          const m = document.getElementById('anim-kamera-mehr');
          if (m) m.open = true;
          const k = m && m.closest('.section-collapse-body');
          if (k) k.hidden = false;
        }""")

        async def setzen(an, events, nachziehen=True):
            await page.evaluate(SETZEN_JS, [an, events, nachziehen])
            await page.wait_for_timeout(300)

        async def klick(sel):
            try:
                await page.click(sel, timeout=5000)
            except Exception as e:  # noqa: BLE001 - ein verdeckter Schalter ist selbst ein Befund
                fehler.append("Klick " + sel + ": " + str(e).splitlines()[0][:120])

        async def zustand():
            return await page.evaluate(ZUSTAND_JS)

        roh_alle = json.dumps(ALLE)
        roh_kf = json.dumps(KF)

        def gleich(a, b):
            return json.loads(a) == json.loads(b)

        # A) Ausschalten
        await setzen(True, ALLE)
        await klick("#anim-kf-enabled")
        await page.wait_for_timeout(300)
        s = await zustand()
        pruefe("A1 Ausschalten: kein offener Dialog", not s["modal"], s)
        pruefe("A2 Ausschalten: Schalter aus, Einstellung keyframes_enabled=false", s["an"] is False and s["einst"] is False, s)
        pruefe("A3 Ausschalten: alle 9 rohen Events bleiben erhalten", gleich(s["roh"], roh_alle), s["roh"][:200])
        pruefe("A4 Ausschalten: wirksame Events enthalten keine Kamera-Events", s["wirkKamera"] == 0, s)

        # B) Wieder einschalten (falls A1 den Dialog offen liess, vorher schliessen)
        await page.evaluate("() => { const o = document.getElementById('modal-overlay'); if (o) o.hidden = true; }")
        await klick("#anim-kf-enabled")
        await page.wait_for_timeout(300)
        s = await zustand()
        pruefe("B1 Einschalten: kein Dialog, Schalter an, 8 Kamera-Events wirksam", not s["modal"] and s["an"] is True and s["wirkKamera"] == 8, s)

        # C) Rückgängig nach dem Ausschalten
        await setzen(True, ALLE)
        await klick("#anim-kf-enabled")
        await page.wait_for_timeout(900)
        aus = (await zustand())["an"] is False   # Voraussetzung: vor dem Rückgängig ist der Schalter wirklich aus
        await page.evaluate("window.__rzUndoControllers.animator.undo()")
        await page.wait_for_timeout(500)
        s = await zustand()
        pruefe("C1 Rückgängig: Schalter wieder an, Events unverändert", aus and s["an"] is True and gleich(s["roh"], roh_alle), s)

        # D) Fest → Kamerafahrt: eigene Keyframes bleiben
        await setzen(True, ALLE)
        await page.evaluate("() => { const o = document.getElementById('modal-overlay'); if (o) o.hidden = true; }")
        await klick('#anim-kamera-art [data-kamera-art="fest"]')
        await page.wait_for_timeout(600)
        await klick('#anim-kamera-art [data-kamera-art="fahrt"]')
        await page.wait_for_timeout(900)
        s = await zustand()
        pruefe("D1 Fest, dann Kamerafahrt: Schalter an, eigene Kamera-Events unverändert", s["an"] is True and gleich(s["rohKamera"], roh_kf), s)

        # G) Handkamera bei ausgeschaltetem Editor mit versteckten Keyframes: wird gemerkt (manual_cam)
        await setzen(False, ALLE)
        await page.wait_for_timeout(2500)   # Kamerabewegungen der Vorschau (Pille, Anpassen) auslaufen lassen
        vorher = await page.evaluate("() => window.__rzHandKamera()")
        box = await page.evaluate("""() => { const r = document.querySelector('#map-canvas, .maplibregl-canvas').getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }""")
        await page.mouse.move(box["x"], box["y"])
        await page.mouse.down()
        await page.wait_for_timeout(100)
        await page.mouse.move(box["x"] + 80, box["y"] + 40, steps=25)
        await page.wait_for_timeout(150)   # Pause vor dem Loslassen: keine Trägheit
        await page.mouse.up()
        hand = None
        for _ in range(20):   # moveend kommt nach der Geste; bis zu 4 s warten
            await page.wait_for_timeout(200)
            hand = await page.evaluate("() => window.__rzHandKamera()")
            if hand is not None:
                break
        pruefe("G1 versteckte Keyframes, Editor aus: von Hand verschobene Karte wird als Handkamera gemerkt",
               vorher is None and hand is not None and "center" in hand, {"vorher": vorher, "hand": hand})

        # H) Pille „Start → Ziel“ ersetzt versteckte Keyframes nie still: erst die Rückfrage
        await setzen(False, ALLE)
        await page.evaluate("() => { const o = document.getElementById('modal-overlay'); if (o) o.hidden = true; }")
        await klick('#anim-kamera-art [data-kamera-art="startziel"]')
        await page.wait_for_timeout(500)
        s = await zustand()
        pruefe("H1 Start → Ziel bei versteckten Keyframes: Rückfrage-Dialog offen, Events unverändert",
               s["modal"] and gleich(s["roh"], roh_alle), s)
        await page.evaluate("() => openModal({}).close()")   # Rückfrage abbrechen
        await page.wait_for_timeout(300)
        s = await zustand()
        pruefe("H2 nach dem Schließen: Events weiterhin unverändert, Schalter aus", gleich(s["roh"], roh_alle) and s["an"] is False, s)

        # E) Projekt laden mit ausgeschaltetem Schalter
        await setzen(False, ALLE, nachziehen=False)
        s = await zustand()
        pruefe("E1 Laden mit keyframes_enabled=false: Schalter aus, Events vollständig, keine Kamera-Events wirksam",
               s["an"] is False and gleich(s["roh"], roh_alle) and s["wirkKamera"] == 0, s)

        pruefe("F kein pageerror, keine verdeckten Klicks", not fehler, fehler[:3])
        await browser.close()
    ok = all(ergebnisse)
    print("RESULT: " + ("OK" if ok else "FAIL"))
    return 0 if ok else 1


sys.exit(asyncio.run(main()))
