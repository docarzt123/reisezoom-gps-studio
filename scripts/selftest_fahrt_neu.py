#!/usr/bin/env python3
"""Selbsttest „Fahrt neu erzeugen“ (18.10.2026), Logik rzEinfach.fahrtNeu.

rzEinfach.fahrtNeu(art, opt) ersetzt die Kamera-Keyframes durch eine neue Fahrt (Kamerafahrt mit Flugstil,
Start → Ziel oder Standard-Keyframes); Marker und andere Nicht-Kamera-Events bleiben, die Folge ist ein
einziger Undo-Schritt.

A) Schnittstelle vorhanden
B) Erzeugen: Kamera-Events ersetzt, Blickrichtung gesetzt, Nicht-Kamera-Event bleibt, Felder laut Tabelle
C) Undo: ein Schritt stellt den Vorzustand her; zweimal erzeugen, zweimal Undo
D) Ohne Track: false, nichts geändert
G) Popup „Kamerafahrt neu erzeugen“ und Knopf „🎬 Fahrt neu erzeugen…“ in der Zeitleiste (rzEinfach.fahrtNeuDialog)

Die echte Oberfläche läuft headless an der echten Brücke (app.Api), alle Daten in einem Temp-Ordner;
der echte App-Ordner wird nie berührt.

Aufruf: python scripts/selftest_fahrt_neu.py
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
APP_ORDNER = Path(tempfile.mkdtemp(prefix="rz-fahrtneu-"))
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
    print(("OK   " if ok else "FAIL ") + name + (f"  [{str(info)[:1500]}]" if info and not ok else ""))
    sys.stdout.flush()


def gpx_schreiben(pfad, n=600):
    """Synthetische Tour: Gerade von 9.00/48.00 nach 9.30/48.20, 1-Hz-Punkte mit Zeit."""
    zeilen = []
    for i in range(n):
        f = i / (n - 1)
        zeit = f"<time>2026-01-01T10:{i // 60:02d}:{i % 60:02d}Z</time>"
        zeilen.append(f'<trkpt lat="{48.0 + 0.2 * f:.6f}" lon="{9.0 + 0.3 * f:.6f}"><ele>{100 + 50 * f:.1f}</ele>{zeit}</trkpt>')
    pfad.write_text('<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="selftest" '
                    'xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Testtour</name><trkseg>'
                    + "".join(zeilen) + "</trkseg></trk></gpx>", encoding="utf-8")


def diff(ist_json, soll_json):
    """Kurzbefund für FAIL-Zeilen: Anzahl und die ersten abweichenden Events."""
    ist, soll = json.loads(ist_json), json.loads(soll_json)
    return {"n": [len(ist), len(soll)], "nur_ist": [e for e in ist if e not in soll][:3], "nur_soll": [e for e in soll if e not in ist][:3]}


MARKER = {"kind": "marker", "anchor": 0.5, "label": "Musterpass"}   # Nicht-Kamera-Event

ZUSTAND_JS = """() => {
  const KL = ["pitch", "bearing", "zoom", "center", "position"];
  const roh = window.__rzKeyframes.liste();
  const a = window.rzReadModuleSettings("animator") || {};
  return { roh: JSON.stringify(roh), kamera: JSON.stringify(roh.filter(e => KL.includes(e.kind))),
           nBearing: roh.filter(e => e.kind === "bearing").length,
           pitch: roh.filter(e => e.kind === "pitch").map(e => e.value),
           marker: JSON.stringify(roh.filter(e => !KL.includes(e.kind))),
           nKamera: roh.filter(e => KL.includes(e.kind)).length,
           kf: a.keyframes_enabled, folgt: a.camera_follow_track, vorgabe: a.kamera_vorgabe };
}"""


def sprach_init(code):
    """Init-Skript: die Brücke liefert die Strings der Sprache `code` (en/es) statt der deutschen Rückfälle."""
    strings = json.loads((REPO / "i18n" / f"{code}.json").read_text(encoding="utf-8"))
    c = json.dumps(code)
    return ("(() => { const s = " + json.dumps(strings, ensure_ascii=False) + "; const echt = window.pywebview.api;"
            " const antwort = { ok: true, strings: s, active: " + c + ", requested: " + c + ", system_locale: " + c + ", available: [" + c + "] };"
            " window.pywebview.api = new Proxy({ i18n_get_strings: async () => antwort },"
            " { get: (z, n) => (n in z) ? z[n] : echt[n] }); })();")


async def seite_starten(p, sprache=None):
    browser = await p.chromium.launch(headless=True, args=["--use-angle=default", "--enable-webgl", "--ignore-gpu-blocklist"])
    page = await browser.new_page(viewport={"width": 1400, "height": 900})
    fehler = []
    page.on("pageerror", lambda e: fehler.append(str(e)[:300]))
    await page.expose_function("rzBridge", bruecke)
    await page.add_init_script(BRIDGE_JS)
    if sprache:
        await page.add_init_script(sprach_init(sprache))
    await page.goto(f"file://{(REPO / 'ui/index.html').resolve()}", wait_until="domcontentloaded")
    await page.wait_for_timeout(3000)
    await page.evaluate("window.switchMod('animator')")
    await page.wait_for_timeout(2500)
    # Erststart ohne Bibliothek: das Tor (#bib-gate) deckt die Oberfläche ab.
    await page.add_style_tag(content="#bib-gate { display: none !important; }")
    return browser, page, fehler


async def main():
    gpx = APP_ORDNER / "tour.gpx"
    gpx_schreiben(gpx)
    async with async_playwright() as p:
        # D) Ohne Track: frische Seite, keine Tour geladen (zuerst: spätere Seiten stellen die zuletzt geladene Tour wieder her)
        browser, page, fehler2 = await seite_starten(p)
        vor = await page.evaluate("() => JSON.stringify(window.__rzKeyframes.liste())")
        r = await page.evaluate("() => (window.rzEinfach && window.rzEinfach.fahrtNeu) ? window.rzEinfach.fahrtNeu('fahrt') : 'fehlt'")
        await page.wait_for_timeout(1500)
        nach = await page.evaluate("() => JSON.stringify(window.__rzKeyframes.liste())")
        pruefe("D1 ohne Track: false, Events unverändert, kein pageerror", r is False and vor == nach and not fehler2, {"r": r, "f": fehler2[:3]})
        await browser.close()

        browser, page, fehler = await seite_starten(p)
        # Das Laden einer Tour stellt noch Sekunden später (Sitzungs-/Routen-Wiederherstellung) über rebindAllSettings
        # die Undo-Stapel zurück. Das ist Ladevorgang, nicht Teil der Prüfung: Zähler einhängen und warten, bis Ruhe ist.
        await page.evaluate("""() => { window.__resets = 0; const c = window.__rzUndoControllers.animator, o = c.reset;
          c.reset = function () { window.__resets++; return o.apply(this, arguments); }; }""")
        await page.evaluate(f"() => {{ window.loadGlobalGpx({json.dumps(str(gpx))}); }}")
        await page.wait_for_timeout(7000)
        ruhe, letzter = 0, -1
        for _ in range(80):   # bis 5 s lang kein reset() mehr kam (höchstens 30 s)
            n = await page.evaluate("() => window.__resets")
            ruhe = ruhe + 1 if n == letzter else 0
            letzter = n
            if ruhe >= 10:
                break
            await page.wait_for_timeout(500)

        async def zustand():
            return await page.evaluate(ZUSTAND_JS)

        def gleich(a, b):
            return json.loads(a) == json.loads(b)

        # Ausgangsfahrt (Begleiter) plus ein Nicht-Kamera-Event
        await page.evaluate("() => window.rzEinfach.kameraSetzen('fahrt')")
        await page.wait_for_timeout(1500)
        await page.evaluate("(m) => window.__rzKeyframes.setzen(window.__rzKeyframes.liste().concat([m]))", MARKER)
        await page.wait_for_timeout(500)
        vorher = await zustand()
        vorher_roh = vorher["roh"]
        vorher_kamera = vorher["kamera"]

        # A) Schnittstelle
        a1 = await page.evaluate("""() => ({ fn: typeof (window.rzEinfach || {}).fahrtNeu,
            name: (window.__rzFlugstile && window.__rzFlugstile.text) ? window.__rzFlugstile.text("orbit")[0] : null })""")
        pruefe("A1 rzEinfach.fahrtNeu ist eine Funktion, __rzFlugstile.text('orbit')[0] == 'Orbit'",
               a1["fn"] == "function" and a1["name"] == "Orbit", a1)
        if a1["fn"] != "function":
            await browser.close()
            print("RESULT: FAIL")
            return 1

        # B) Kamerafahrt mit Orbit
        r = await page.evaluate("() => window.rzEinfach.fahrtNeu('fahrt', { flug: 'orbit', lebendig: 0.5 })")
        await page.wait_for_timeout(1500)
        s = await zustand()
        pruefe("B1 fahrtNeu('fahrt', orbit) liefert true, Kamera-Events geändert, pitch enthält 0 (Orbit p: 0)",
               r is True and s["kamera"] != vorher_kamera and 0 in s["pitch"], {"r": r, "pitch": s["pitch"]})
        pruefe("B2 Blickrichtung gesetzt: mehr als 4 bearing-Events", s["nBearing"] > 4, s["nBearing"])
        pruefe("B3 Nicht-Kamera-Event unverändert vorhanden", gleich(s["marker"], json.dumps([MARKER])), s["marker"])
        pruefe("B4 keyframes_enabled, camera_follow_track true, kamera_vorgabe 'fahrt'",
               s["kf"] is True and s["folgt"] is True and s["vorgabe"] == "fahrt", s)

        # C) Undo. Leert die App mitten im Messfenster selbst die Undo-Stapel (spätes rebindAllSettings nach dem
        # Tour-Laden, Zähler __resets), wird der Block wiederholt (max. 3 Versuche) und das als HINWEIS gemeldet;
        # ohne belegten reset() gibt es keine Wiederholung, echte Fehler bleiben also sichtbar.
        async def undo_block(name, beschreibung, erzeugen, n_undo):
            ok, info = False, ""
            for versuch in range(1, 4):
                await page.evaluate("(l) => window.__rzKeyframes.setzen(JSON.parse(l))", vorher_roh)
                await page.wait_for_timeout(900)
                n0 = await page.evaluate("() => window.__resets")
                await erzeugen()
                for _ in range(n_undo):
                    await page.evaluate("window.__rzUndoControllers.animator.undo()")
                    await page.wait_for_timeout(600)
                s = await zustand()
                ok, info = gleich(s["roh"], vorher_roh), diff(s["roh"], vorher_roh)
                if ok or await page.evaluate("() => window.__resets") == n0 or versuch == 3:
                    break
                print(f"HINWEIS {name}: reset() durch App, Wiederholung {versuch}")
            pruefe(f"{name} {beschreibung}", ok, info)

        async def erzeuge_orbit():
            await page.evaluate("() => window.rzEinfach.fahrtNeu('fahrt', { flug: 'orbit', lebendig: 0.5 })")
            await page.wait_for_timeout(1800)

        async def erzeuge_zweimal():
            await erzeuge_orbit()
            await page.evaluate("() => window.rzEinfach.fahrtNeu('fahrt', { flug: 'tiefflieger', lebendig: 0.5 })")
            await page.wait_for_timeout(1800)

        await undo_block("C1", "ein Undo stellt Vorzustand (Fahrt + Marker) exakt wieder her", erzeuge_orbit, 1)
        await undo_block("C2", "zweimal erzeugen, zweimal Undo: Ausgangsstand", erzeuge_zweimal, 2)

        # B5) Start → Ziel
        r = await page.evaluate("() => window.rzEinfach.fahrtNeu('startziel')")
        await page.wait_for_timeout(1000)
        s = await zustand()
        pruefe("B5 fahrtNeu('startziel'): 8 Kamera-Events, camera_follow_track false, kamera_vorgabe 'startziel'",
               r is True and s["nKamera"] == 8 and s["folgt"] is False and s["vorgabe"] == "startziel", s)

        # B6) Standard-Keyframes
        await page.evaluate("window.rzEinfach.kameraSetzen('fahrt')")
        await page.wait_for_timeout(1500)
        folgt_vor = (await zustand())["folgt"]
        r = await page.evaluate("() => window.rzEinfach.fahrtNeu('standard')")
        await page.wait_for_timeout(1000)
        s = await zustand()
        std = json.loads(await page.evaluate("""() => JSON.stringify(window.__rzStandardKeyframes().map(ev => {
            const c = Object.assign({}, ev); delete c.standard; return c; }))"""))
        ist = json.loads(s["kamera"])
        # Gespeichert werden die Events normalisiert (zusätzliche Felder wie strecke_gruppe): jedes Standard-Event
        # muss mit allen seinen Feldern in einem gespeicherten Event stecken, Anzahl gleich, kein standard-Flag.
        passt = len(ist) == len(std) and all(any(all(e.get(k) == v for k, v in sv.items()) for e in ist) for sv in std)
        pruefe("B6 fahrtNeu('standard'): Kamera-Events == Standard-Keyframes ohne standard-Flag, vorgabe 'fahrt', folgt unverändert",
               r is True and passt and not any("standard" in e for e in ist) and s["vorgabe"] == "fahrt" and s["folgt"] == folgt_vor,
               {"std": std, "ist": ist})

        # G) Popup und Knopf in der Zeitleiste. Ausgangslage: Editor an, Kamerafahrt (Begleiter) plus Marker.
        await page.evaluate("window.rzEinfach.kameraSetzen('fahrt')")
        await page.wait_for_timeout(1500)
        await page.evaluate("(m) => window.__rzKeyframes.setzen(window.__rzKeyframes.liste().concat([m]))", MARKER)   # kameraSetzen ersetzt alles
        await page.wait_for_timeout(500)
        g1 = await page.evaluate("""() => { const b = document.getElementById('tl-btn-fahrt-neu');
            return b ? { da: true, aktiv: !b.disabled, sichtbar: !!b.offsetParent, text: b.textContent.trim() } : { da: false }; }""")
        pruefe("G1 #tl-btn-fahrt-neu sichtbar und aktiv bei eingeschaltetem Editor", g1.get("da") and g1["aktiv"] and g1["sichtbar"], g1)
        if not g1.get("da"):
            await browser.close()
            print("RESULT: FAIL")
            return 1
        g1b = await page.evaluate("""async () => { const cb = document.getElementById('anim-kf-enabled');
            cb.checked = false; cb.dispatchEvent(new Event('change', { bubbles: true }));
            await new Promise(r => setTimeout(r, 400));
            const b = document.getElementById('tl-btn-fahrt-neu'), c = document.getElementById('tl-btn-clear');
            const aus = { fahrtNeu: b.disabled || !b.offsetParent, alleWeg: c.disabled || !c.offsetParent };
            cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true }));
            await new Promise(r => setTimeout(r, 400));
            return { aus, an: !b.disabled && !!b.offsetParent }; }""")
        # Der Animator ruft timeline.setEnabled() nie auf: „aus“ heißt dort die CSS-Klasse --kf-off, die den Knopf wie
        # „Alle weg“ ausblendet. Verlangt wird also: nicht bedienbar (ausgeblendet oder deaktiviert), genau wie #tl-btn-clear.
        pruefe("G1b Editor aus: Knopf nicht bedienbar wie #tl-btn-clear; danach wieder aktiv",
               g1b["aus"]["fahrtNeu"] and g1b["aus"]["alleWeg"] and g1b["an"], g1b)
        await page.wait_for_timeout(500)
        g_vor = await zustand()

        async def popup():
            return await page.evaluate("""() => { const o = document.getElementById('modal-overlay');
              const q = (s) => Array.from(document.querySelectorAll('#modal-body ' + s));
              const sicht = (s) => { const e = document.querySelector('#modal-body ' + s); return !!(e && e.offsetParent); };
              const leb = document.querySelector('#modal-body #fn-leb');
              return { offen: !!o && !o.hidden, arten: q('[data-fn-art]').length, fluege: q('[data-fn-flug]').length, nStile: (window.__rzFlugstile && window.__rzFlugstile.liste || []).length,
                       hatLeb: !!leb, lebMin: leb && leb.min, lebMax: leb && leb.max, lebStep: leb && leb.step, leb: leb && leb.value,
                       artAn: q('[data-fn-art].is-on').map(e => e.dataset.fnArt), flugAn: q('[data-fn-flug].is-on').map(e => e.dataset.fnFlug),
                       hinweis: (document.querySelector('#modal-body #fn-hinweis') || {}).textContent || null,
                       flugSichtbar: sicht('[data-fn-flug]'), lebSichtbar: sicht('#fn-leb'),
                       abbr: !!document.querySelector('#fn-abbrechen'), ok: !!document.querySelector('#fn-ok') }; }""")

        await page.click("#tl-btn-fahrt-neu")
        await page.wait_for_timeout(500)
        g2 = await popup()
        pruefe("G2 Klick öffnet Modal: 3 Arten, alle Flugstile, Regler 0..1/0.05; vorbelegt fahrt + begleiter, Regler 0.5",
               g2["offen"] and g2["arten"] == 3 and g2["fluege"] == g2["nStile"] and g2["nStile"] > 0 and g2["hatLeb"] and g2["lebMin"] == "0" and g2["lebMax"] == "1"
               and g2["lebStep"] == "0.05" and g2["artAn"] == ["fahrt"] and g2["flugAn"] == ["begleiter"] and float(g2["leb"]) == 0.5
               and g2["abbr"] and g2["ok"], g2)
        pruefe("G3 #fn-hinweis nennt die Zahl der Kamera-Keyframes (%d)" % g_vor["nKamera"],
               bool(g2["hinweis"]) and str(g_vor["nKamera"]) in g2["hinweis"] and "{n}" not in g2["hinweis"], g2["hinweis"])

        await page.click('[data-fn-art="startziel"]')
        await page.wait_for_timeout(200)
        g4 = await popup()
        pruefe("G4 Start → Ziel gewählt: Flugstil-Karten und Regler verborgen, Art markiert",
               not g4["flugSichtbar"] and not g4["lebSichtbar"] and g4["artAn"] == ["startziel"], g4)
        await page.click('[data-fn-art="fahrt"]')
        await page.wait_for_timeout(200)
        g4b = await popup()
        pruefe("G4b zurück auf Kamerafahrt: Flugstile und Regler wieder sichtbar", g4b["flugSichtbar"] and g4b["lebSichtbar"], g4b)

        # G5) Abbrechen und Esc ändern nichts und rufen onAbbruch genau einmal
        await page.click("#fn-abbrechen")
        await page.wait_for_timeout(600)
        await page.evaluate("() => { window.__abbr = 0; window.rzEinfach.fahrtNeuDialog({ onAbbruch: () => { window.__abbr++; } }); }")
        await page.wait_for_timeout(400)
        await page.click("#fn-abbrechen")
        await page.wait_for_timeout(600)
        g5a = await popup()
        sa = await zustand()
        n_abbr = await page.evaluate("() => window.__abbr")
        pruefe("G5a Abbrechen: Modal zu, rohe Events unverändert, onAbbruch einmal",
               not g5a["offen"] and sa["roh"] == g_vor["roh"] and n_abbr == 1, {"offen": g5a["offen"], "abbr": n_abbr})
        await page.click("#tl-btn-fahrt-neu")
        await page.wait_for_timeout(400)
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(600)
        g5b = await popup()
        sb = await zustand()
        pruefe("G5b Esc: Modal zu, rohe Events unverändert", not g5b["offen"] and sb["roh"] == g_vor["roh"], g5b)
        await page.evaluate("() => { window.__abbr = 0; window.rzEinfach.fahrtNeuDialog({ onAbbruch: () => { window.__abbr++; } }); }")
        await page.wait_for_timeout(400)
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(400)
        await page.evaluate("() => { window.rzEinfach.fahrtNeuDialog({ onAbbruch: () => { window.__abbr++; } }); }")
        await page.wait_for_timeout(400)
        await page.click("#modal-close")
        await page.wait_for_timeout(400)
        pruefe("G5c Esc und Schließen-Kreuz rufen onAbbruch je genau einmal (insgesamt 2)",
               await page.evaluate("() => window.__abbr") == 2 and not (await popup())["offen"])

        # G6) Orbit wählen, Erzeugen
        await page.click("#tl-btn-fahrt-neu")
        await page.wait_for_timeout(400)
        await page.click('[data-fn-flug="orbit"]')
        await page.evaluate("() => { window.__abbr = 0; }")
        await page.click("#fn-ok")
        await page.wait_for_timeout(2500)
        g6 = await popup()
        sg = await zustand()
        pruefe("G6 Orbit + Erzeugen: Modal zu, Kamera-Events geändert, pitch enthält 0, mehr als 4 bearing-Events, Marker bleibt",
               not g6["offen"] and sg["kamera"] != g_vor["kamera"] and 0 in sg["pitch"] and sg["nBearing"] > 4
               and gleich(sg["marker"], json.dumps([MARKER])), {"offen": g6["offen"], "pitch": sg["pitch"], "nB": sg["nBearing"]})

        # G7) Auswahl wird gemerkt
        await page.click("#tl-btn-fahrt-neu")
        await page.wait_for_timeout(400)
        g7 = await popup()
        pruefe("G7 erneut geöffnet: orbit vorbelegt, Art fahrt, Regler 0.5",
               g7["flugAn"] == ["orbit"] and g7["artAn"] == ["fahrt"] and float(g7["leb"]) == 0.5, g7)
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(400)
        # G7b) Das Popup wird mit onAbbruch geöffnet und mit „Erzeugen“ beendet: onAbbruch darf nie feuern.
        await page.evaluate("() => { window.__abbr = 0; window.rzEinfach.fahrtNeuDialog({ onAbbruch: () => { window.__abbr++; } }); }")
        await page.wait_for_timeout(400)
        await page.click("#fn-ok")
        await page.wait_for_timeout(2500)
        await page.keyboard.press("Escape")   # ein verspätetes Esc darf ebenfalls nichts auslösen
        await page.wait_for_timeout(400)
        pruefe("G7b Erzeugen hat onAbbruch nicht aufgerufen (Popup mit onAbbruch geöffnet)",
               await page.evaluate("() => window.__abbr") == 0 and not (await popup())["offen"])

        # G9) Modal wird am onClose vorbei beendet (closeAllModals): der Esc-Listener darf kein späteres Esc verschlucken
        await page.evaluate("""() => { window.__abbr = 0; window.__esc = [];
            window.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.__esc.push(e.defaultPrevented); });
            window.rzEinfach.fahrtNeuDialog({ onAbbruch: () => { window.__abbr++; } }); }""")
        await page.wait_for_timeout(400)
        await page.evaluate("() => closeAllModals()")
        await page.evaluate("() => { openModal({ title: 'Fremd', body: '<p id=\"fremd-dlg\">x</p>', footer: '' }); }")
        await page.wait_for_timeout(200)
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(300)
        g9 = await page.evaluate("""() => { const o = document.getElementById('modal-overlay');
            return { esc: window.__esc, abbr: window.__abbr, fremdOffen: !!o && !o.hidden && !!document.getElementById('fremd-dlg') }; }""")
        await page.evaluate("() => closeAllModals()")
        pruefe("G9 Esc nach closeAllModals: erreicht andere Listener (nicht verhindert), schließt fremden Dialog nicht, kein onAbbruch",
               g9["esc"] == [False] and g9["fremdOffen"] and g9["abbr"] == 0, g9)

        # H) Einschalt-Dialog: dritter Knopf „Fahrt wählen…“. Ausgangslage je Durchlauf: Editor aus, keine Kamera-Keyframes.
        async def h_ausgang():
            await page.evaluate("""async () => { const cb = document.getElementById('anim-kf-enabled');
                window.__rzKeyframes.setzen([]); cb.checked = false; cb.dispatchEvent(new Event('change', { bubbles: true }));
                await new Promise(r => setTimeout(r, 500)); }""")

        async def h_zustand():
            return await page.evaluate("""() => {
              const cb = document.getElementById('anim-kf-enabled'), o = document.getElementById('modal-overlay');
              const kam = window.__rzKeyframes.liste().filter(e => ['pitch','bearing','zoom','center','position'].includes(e.kind));
              return { an: cb.checked, nKamera: kam.length, modalOffen: !!o && !o.hidden,
                       md: ['md-kf-ohne', 'md-kf-waehlen', 'md-kf-mit'].map(i => !!document.getElementById(i)),
                       fn: !!document.getElementById('fn-ok') }; }""")

        # Der Schalter ist im Einfach-Modus ausgeblendet: click() im Dokument löst denselben Weg aus wie ein Mausklick.
        async def schalter_klick():
            await page.evaluate("() => document.getElementById('anim-kf-enabled').click()")
            await page.wait_for_timeout(500)

        await h_ausgang()
        await schalter_klick()
        h1 = await h_zustand()
        pruefe("H1 Einschalt-Dialog hat #md-kf-ohne, #md-kf-waehlen, #md-kf-mit", h1["modalOffen"] and h1["md"] == [True, True, True], h1)
        if h1["md"][1]:
            await page.click("#md-kf-waehlen")
            await page.wait_for_timeout(500)
            h2 = await h_zustand()
            pruefe("H2 Fahrt wählen…: Einschalt-Dialog zu, Fahrt-Popup offen", h2["modalOffen"] and h2["fn"] and not any(h2["md"]), h2)
            await page.click("#fn-ok")
            await page.wait_for_timeout(2500)
            h3 = await h_zustand()
            pruefe("H3 Erzeugen: Editor an, Kamera-Events vorhanden, kein Modal", h3["an"] and h3["nKamera"] > 0 and not h3["modalOffen"], h3)

            await h_ausgang()
            await schalter_klick()
            await page.click("#md-kf-waehlen")
            await page.wait_for_timeout(500)
            await page.click("#fn-abbrechen")
            await page.wait_for_timeout(600)
            h4 = await h_zustand()
            pruefe("H4 Abbrechen: Editor aus, keine Kamera-Events, kein Modal offen", not h4["an"] and h4["nKamera"] == 0 and not h4["modalOffen"], h4)
        else:
            for n in ("H2", "H3", "H4"):
                pruefe(f"{n} (ohne #md-kf-waehlen nicht prüfbar)", False)
        pruefe("F1 kein pageerror (mit Track)", not fehler, fehler[:3])
        await browser.close()

        # G8) Sprache: eigener Seitenaufbau je Sprache; der Knopf trägt den Text der Sprache, keinen deutschen Rückfall
        de = json.loads((REPO / "i18n" / "de.json").read_text(encoding="utf-8"))
        for code in ("en", "es"):
            browser, page, _ = await seite_starten(p, code)
            soll = json.loads((REPO / "i18n" / f"{code}.json").read_text(encoding="utf-8"))
            g8 = await page.evaluate("""() => { const b = document.getElementById('tl-btn-fahrt-neu');
                return b ? { text: b.textContent.trim(), tip: b.title } : null; }""")
            ok8 = bool(g8) and soll["animator.kf.fahrt_neu"] in g8["text"] and g8["tip"] == soll["animator.kf.fahrt_neu_tip"] \
                and de["animator.kf.fahrt_neu"] not in g8["text"]
            pruefe(f"G8 Sprache {code}: Knopftext und Tooltip sind {code}, kein deutscher Rückfall", ok8, g8)
            await browser.close()

    ok = all(ergebnisse)
    print("RESULT: " + ("OK" if ok else "FAIL"))
    return 0 if ok else 1


sys.exit(asyncio.run(main()))
