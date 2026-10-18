"""Selbsttest „Tempo-Farben“ (17./18.10.2026): „Mehrere Track-Farben“ mit der Quelle Geschwindigkeit.

Teil A: die reinen Funktionen aus ui/js/tempo_farben.js auf einer leeren Seite (Glättung, Perzentil, Ampel).
Teil B: die echte Oberfläche an der echten Brücke (scripts/selftest_echtbruecke.py, Daten in einem
        Temp-Ordner) mit synthetischen Touren: Tempo-Rampe, Rampe mit GPS-Sprung, Tour ohne Zeit.
        Geprüft werden „Auto“ (bis zum 98. Perzentil der geglätteten Reihe) und der Knopf „Ampel“.
Teil C: dasselbe unter window.__rzRenderMode (wie core/szene.py) — der Render setzt denselben
        Verlauf wie die Vorschau.

Aufruf: python scripts/selftest_tempo_farben.py
Ausgabe: je Prüfung OK/FAIL, am Ende RESULT: OK bzw. RESULT: FAIL (Exit 0 / 1).
"""
import asyncio
import hashlib
import json
import re
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import selftest_echtbruecke as eb  # noqa: E402  (setzt RZ_APP_ORDNER vor dem Import der App)
from playwright.async_api import async_playwright  # noqa: E402

REPO = eb.REPO
ergebnisse = []

AMPEL = ["#2e9e44", "#f2c40f", "#d7191c"]


def pruefe(name, ok, info=""):
    ergebnisse.append(bool(ok))
    print(("OK   " if ok else "FAIL ") + name + (f"  [{info}]" if info and not ok else ""))
    sys.stdout.flush()


def gpx_schreiben(pfad, mit_zeit, n=600, sprung=False, schritt_s=1):
    """Synthetische Tour: gerade nach Osten, 1-Hz-Punkte, Tempo-Rampe 20 → 100 km/h, Höhe 100 → 700 m.

    sprung: Punkt Nr. 100 liegt 80 m weiter östlich als auf der Linie (ein GPS-Ausreißer).
    """
    lat, lon, m_pro_grad = 50.0, 10.0, 111320 * 0.6428  # cos(50°)
    x, zeilen = 0.0, []
    for i in range(n):
        v = (20 + 80 * i / (n - 1)) / 3.6
        sek = i * schritt_s
        zeit = f"<time>2026-01-01T{10 + sek // 3600:02d}:{sek // 60 % 60:02d}:{sek % 60:02d}Z</time>" if mit_zeit else ""
        versatz = 80 if (sprung and i == 100) else 0
        hoehe = 100 + 600 * i / (n - 1)
        zeilen.append(f'<trkpt lat="{lat}" lon="{lon + (x + versatz) / m_pro_grad:.6f}"><ele>{hoehe:.1f}</ele>{zeit}</trkpt>')
        x += v * schritt_s
    pfad.write_text('<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="selftest" '
                    'xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Testtour</name><trkseg>'
                    + "".join(zeilen) + "</trkseg></trk></gpx>", encoding="utf-8")


# ── Teil A ────────────────────────────────────────────────────────────────────
async def teil_a(p):
    browser = await p.chromium.launch(headless=True)
    page = await browser.new_page()
    await page.goto("about:blank")
    await page.add_script_tag(path=str(REPO / "ui/js/tempo_farben.js"))
    r = await page.evaluate("""() => {
      const T = window.rzTempoFarben;
      if (!T) return { fehlt: true };
      const d = [], z = [];
      for (let i = 0; i < 300; i++) { d.push(i * 10); z.push(i); }          // 10 m/s = 36 km/h
      const konst = T.glaetten(d, z);
      const d2 = d.map((v, i) => i >= 150 ? v + 73 : v);                    // ein Schritt mit 83 m in 1 s = 300 km/h
      const ausr = T.glaetten(d2, z);
      const ohneZeit = T.glaetten([0, 10, 20], [5, 5, 5]);
      const roh = []; for (let i = 0; i <= 100; i++) roh.push(i);
      const dd = [], zz = [];
      for (let i = 0; i < 800; i++) { dd.push(i * 18 * 60 / 3.6); zz.push(i * 18); }   // 800 Punkte à 18 s bei 60 km/h (ausgedünnte Langtour)
      const duenn = T.glaetten(dd, zz);
      const ampel = T.ampelStufen ? T.ampelStufen(0, 80) : null, rund = T.ampelStufen ? T.ampelStufen(12.34, 56.78) : null;
      return { duennMin: Math.min(...duenn), duennMax: Math.max(...duenn), konstMin: Math.min(...konst), konstMax: Math.max(...konst), ausrMax: Math.max(...ausr), ohneZeit,
               p98: T.perzentil(roh, 98), ampel, ampelRund: rund,
               stufen: T.stufen === undefined, mischen: T.mischen === undefined };
    }""")
    # _tempoGlatt aus dem echten Quelltext: Reise-Serie (speedKmh null) bekommt keine geglättete Reihe
    quelle = (REPO / "modules/animator/ui/module.js").read_text(encoding="utf-8")
    m = re.search(r"function _tempoGlatt\(ser\) \{.*?\n  \}", quelle, re.S)
    glatt = await page.evaluate("""(src) => {
      let _tempoGlattCache = null;
      const f = new Function("_tempoGlattCache", src + "; return _tempoGlatt;")(null);
      const z = [0, 1, 2, 3, 4], d = [0, 10, 20, 30, 40];
      const lauf = (o) => { const r = f(o); return r === null ? null : r.length; };
      return { mit: lauf({ has_time: true, cumDistM: d, cumTimeS: z, speedKmh: [1, 2, 3, 4, 5] }),
               reise: lauf({ has_time: true, cumDistM: d, cumTimeS: z, speedKmh: null }),
               ohneZeit: lauf({ has_time: false, cumDistM: d, cumTimeS: z, speedKmh: [1, 2, 3, 4, 5] }) };
    }""", m.group(0) if m else "")
    await browser.close()
    pruefe("A10 _tempoGlatt: mit Roh-Reihe geglättet; Reise (speedKmh null) und ohne Zeit → null",
           glatt == {"mit": 5, "reise": None, "ohneZeit": None}, glatt)
    pruefe("A0 window.rzTempoFarben vorhanden", not r.get("fehlt"))
    if r.get("fehlt"):
        return
    pruefe("A1 konstant 36 km/h → alle Werte 36 ± 0,5", abs(r["konstMin"] - 36) <= 0.5 and abs(r["konstMax"] - 36) <= 0.5, r)
    pruefe("A2 Ausreißer 300 km/h → geglättet < 60", r["ausrMax"] < 60, r["ausrMax"])
    pruefe("A3 ohne Zeit (Δt ≤ 0) → 0", r["ohneZeit"] == [0, 0, 0], r["ohneZeit"])
    pruefe("A4 perzentil([0..100], 98) == 98", r["p98"] == 98, r["p98"])
    pruefe("A9 800 Punkte à 18 s (Abstand > F/2) bei 60 km/h → alle Werte 60 ± 0,5",
           abs(r["duennMin"] - 60) <= 0.5 and abs(r["duennMax"] - 60) <= 0.5, (r["duennMin"], r["duennMax"]))
    pruefe("A5 ampelStufen(0, 80)", r["ampel"] == [{"v": 0, "color": AMPEL[0]}, {"v": 40, "color": AMPEL[1]},
                                                   {"v": 80, "color": AMPEL[2]}], r["ampel"])
    pruefe("A5b ampelStufen(12.34, 56.78): v auf 0,1 gerundet",
           [s["v"] for s in (r["ampelRund"] or [])] == [12.3, 34.6, 56.8], r["ampelRund"])
    pruefe("A8 stufen und mischen entfallen", r["stufen"] and r["mischen"], (r["stufen"], r["mischen"]))


# ── Teil B / C ────────────────────────────────────────────────────────────────
ZUSTAND_JS = """() => {
  const m = window.__rzLetzteKarte;
  let g = null; try { g = m.getPaintProperty('preview-line', 'line-gradient'); } catch (_) {}
  const proj = (typeof getActiveProject === 'function') ? getActiveProject() : null;
  const glob = (typeof _settingsCache !== 'undefined' && _settingsCache && _settingsCache.animator) || {};
  const a = (proj && proj.animator && 'track_color_stops' in proj.animator) ? proj.animator : glob;
  const sel = document.getElementById('anim-colors-source');
  return { gradient: JSON.stringify(g ?? null), stops: a.track_color_stops || [],
           quellen: sel ? Array.from(sel.options).map(o => o.value) : [] };
}"""


async def farben_setzen(page, an, quelle, modus):
    """Schaltet „Mehrere Track-Farben“ ein/aus und stellt Quelle und Übergang ein (jeweils mit change-Ereignis)."""
    await page.evaluate("""([an, quelle, modus]) => {
      const fire = (el) => el.dispatchEvent(new Event('change', { bubbles: true }));
      const cb = document.getElementById('anim-colors-enabled');
      if (cb.checked !== an) { cb.checked = an; fire(cb); }
      if (!an) return;
      const q = document.getElementById('anim-colors-source');
      if (q.value !== quelle) { q.value = quelle; fire(q); }
      const m = document.getElementById('anim-colors-mode');
      if (m.value !== modus) { m.value = modus; fire(m); }
    }""", [an, quelle, modus])
    await page.wait_for_timeout(1200)


async def klick(page, id_):
    await page.evaluate("(id) => document.getElementById(id).click()", id_)
    await page.wait_for_timeout(1200)


async def stops_setzen(page, quelle, stops):
    """Stufen wie aus einem gespeicherten Projekt vorgeben (ohne Auto/Ampel) und neu zeichnen lassen."""
    await page.evaluate("""([quelle, stops]) => {
      saveProjectSettings('animator', { track_colors_enabled: true, track_colors_source: quelle, track_color_stops: stops });
      const m = document.getElementById('anim-colors-mode'); m.dispatchEvent(new Event('change', { bubbles: true }));
    }""", [quelle, stops])
    await page.wait_for_timeout(1200)


async def tour_laden(page, pfad):
    await page.evaluate("window.switchMod('animator')")
    await page.wait_for_timeout(2500)
    await page.evaluate(f"() => {{ window.loadGlobalGpx({json.dumps(str(pfad))}); }}")
    await page.wait_for_timeout(7000)


async def ganzer_track(page):
    """Vorschau: ganzer Track statt nur bis zur Scrubber-Position (Schalter der Zeitleiste)."""
    await page.evaluate("""() => { const c = document.getElementById('tl-cb-fulltrack'); if (c && !c.checked) {
        c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); } }""")
    await page.wait_for_timeout(800)


async def bild_hash(page):
    await page.wait_for_function("() => { const m = window.__rzLetzteKarte; return m && m.loaded() && m.areTilesLoaded(); }", timeout=30000)
    await page.wait_for_timeout(500)
    png = await page.locator("#anim-viewport").screenshot()
    return hashlib.sha256(png).hexdigest()[:16]


def farben_von(stops):
    return [s["color"].lower() for s in stops]


async def teil_b(p, ordner):
    rampe, sprung, ohne = ordner / "rampe.gpx", ordner / "sprung.gpx", ordner / "ohne_zeit.gpx"
    gpx_schreiben(rampe, True)
    gpx_schreiben(sprung, True, sprung=True)
    gpx_schreiben(ohne, False)

    browser, page, fehler = await eb.seite_starten(p)
    await tour_laden(page, rampe)
    await ganzer_track(page)
    s_vorher = await page.evaluate(ZUSTAND_JS)
    h_vorher = await bild_hash(page)

    # B0 — die eigene Auswahl ist zurückgenommen, der Knopf „Ampel“ da
    da = await page.evaluate("""() => ({ alt: !!document.getElementById('anim-tempo-farben'),
        ampel: !!document.querySelector('#anim-color-btns-metric #anim-color-ampel'),
        reihe: (() => { const a = document.getElementById('anim-color-auto'), b = document.getElementById('anim-color-ampel');
                        return !!(a && b && a.nextElementSibling === b); })() })""")
    pruefe("B0 #anim-tempo-farben existiert nicht", not da["alt"], da)
    pruefe("B0b #anim-color-ampel in #anim-color-btns-metric, direkt nach „Auto“", da["ampel"] and da["reihe"], da)

    # B1 — Quelle Geschwindigkeit + „Auto“
    await farben_setzen(page, True, "speed", "gradient")
    await klick(page, "anim-color-auto")
    s_auto = await page.evaluate(ZUSTAND_JS)
    v = [s["v"] for s in s_auto["stops"]]
    pruefe("B1 Auto/Geschwindigkeit: 5 Stufen, letzter Wert = 98. Perzentil der geglätteten Rampe (90 < v < 100), erster ≈ 20 ± 2",
           len(v) == 5 and 90 < v[-1] < 100 and abs(v[0] - 20) <= 2, s_auto["stops"])

    # B2 — „Ampel“
    await klick(page, "anim-color-ampel")
    s_ampel = await page.evaluate(ZUSTAND_JS)
    va = [s["v"] for s in s_ampel["stops"]]
    pruefe("B2 Ampel: genau 3 Stufen mit den Ampelfarben, gleiche Spanne wie Auto",
           farben_von(s_ampel["stops"]) == AMPEL and len(va) == 3 and va[0] == v[0] and va[2] == v[-1], (s_ampel["stops"], v))
    pruefe("B2b Ampel: line-gradient enthält #d7191c", "#d7191c" in s_ampel["gradient"], s_ampel["gradient"][:120])

    # B2c — Quelle Höhe: Ampel spannt die ganze Höhe (min → max, kein Perzentil)
    await farben_setzen(page, True, "ele", "gradient")
    await klick(page, "anim-color-ampel")
    s_ele = await page.evaluate(ZUSTAND_JS)
    ve = [s["v"] for s in s_ele["stops"]]
    pruefe("B2c Ampel/Höhe: spannt 100 → 700 m", len(ve) == 3 and abs(ve[0] - 100) <= 5 and abs(ve[2] - 700) <= 5, s_ele["stops"])

    # B5 — Farben aus: Zustand und Bild wie vor dem Einschalten
    await farben_setzen(page, False, "", "")
    s_aus = await page.evaluate(ZUSTAND_JS)
    h_aus = await bild_hash(page)
    pruefe("B5 Farben aus: line-gradient und Screenshot-Hash wie vor dem Einschalten",
           s_aus["gradient"] == s_vorher["gradient"] and h_aus == h_vorher, (s_aus["gradient"][:60], s_vorher["gradient"][:60], h_aus, h_vorher))

    # B4 — gespeicherte Stufen bleiben nach dem Laden unverändert
    fest = [{"v": 0, "color": "#112233"}, {"v": 50, "color": "#445566"}]
    await stops_setzen(page, "speed", fest)
    await tour_laden(page, rampe)
    s_fest = await page.evaluate(ZUSTAND_JS)
    pruefe("B4 gespeicherte Stufen unverändert nach erneutem Laden",
           [(s["v"], s["color"].lower()) for s in s_fest["stops"]] == [(0, "#112233"), (50, "#445566")], s_fest["stops"])
    await farben_setzen(page, False, "", "")

    # B3 — Tour ohne Zeit: Quelle Geschwindigkeit fehlt, kein Fehler
    await tour_laden(page, ohne)
    s_ohne = await page.evaluate(ZUSTAND_JS)
    pruefe("B3 ohne Zeit: „Geschwindigkeit“ nicht im Dropdown, kein pageerror",
           "speed" not in s_ohne["quellen"] and not fehler, (s_ohne["quellen"], fehler[:3]))

    # B6 — Langtour: 1500 Punkte im 10-s-Abstand (rund 4,2 h) werden auf 800 ausgedünnt; die Abstände liegen
    # dann bei 10 oder 20 s, also immer über dem halben Fenster (7,5 s) — ohne das ±2-Punkte-Minimum wäre die Reihe 0
    lang = ordner / "lang.gpx"
    gpx_schreiben(lang, True, n=1500, schritt_s=10)
    await tour_laden(page, lang)
    await ganzer_track(page)
    await farben_setzen(page, True, "speed", "gradient")
    await stops_setzen(page, "speed", [])   # alte Stufen leeren, damit nur der Klick auf „Auto“ sie setzen kann
    await klick(page, "anim-color-auto")
    s_lang = await page.evaluate(ZUSTAND_JS)
    vl = [s["v"] for s in s_lang["stops"]]
    pruefe("B6 Langtour (ausgedünnt): Auto setzt genau 5 Stufen, letzter Wert > 80 (p98 der Rampe ≈ 98)",
           len(vl) == 5 and vl[-1] > 80, s_lang["stops"])
    await farben_setzen(page, False, "", "")

    # B1b — Reihe ist geglättet: harte Stufen bei 0 und 120 km/h; nur ein roher Sprung erreicht die 120
    await tour_laden(page, sprung)
    await ganzer_track(page)
    stufen120 = [{"v": 0, "color": "#00aa00"}, {"v": 120, "color": "#aa00aa"}]
    await stops_setzen(page, "speed", stufen120)
    await farben_setzen(page, True, "speed", "hard")
    await stops_setzen(page, "speed", stufen120)
    s_sprung = await page.evaluate(ZUSTAND_JS)
    pruefe("B1b Sprung-Tour: Farbreihe bleibt < 120 km/h (Gradient hat die Stufe ab 120 nie)",
           "#00aa00" in s_sprung["gradient"] and "#aa00aa" not in s_sprung["gradient"], s_sprung["gradient"][:200])
    await browser.close()
    return s_ampel


async def teil_c(p, ordner, s_ampel_vorschau):
    modus = {"w": 1280, "h": 720, "fps": 30, "width": 1280, "height": 720, "blur": 0, "zoomShift": 0,
             "kachelStufen": None, "transMs": 300, "transparent": False}
    browser, page, fehler = await eb.seite_starten(p, init_skripte=[f"window.__rzRenderMode = {json.dumps(modus)};"],
                                                   viewport={"width": 1280, "height": 720})
    await tour_laden(page, ordner / "rampe.gpx")
    await ganzer_track(page)
    await farben_setzen(page, True, "speed", "gradient")
    await klick(page, "anim-color-ampel")
    s = await page.evaluate(ZUSTAND_JS)
    pruefe("C1 Render-Modus mit Ampel: derselbe Gradient wie in der Vorschau", s["gradient"] == s_ampel_vorschau["gradient"],
           (s["gradient"][:100], s_ampel_vorschau["gradient"][:100]))
    pruefe("C2 Render-Modus: kein pageerror", not fehler, fehler[:3])
    await browser.close()


async def main():
    with tempfile.TemporaryDirectory(prefix="rz-tempo-gpx-") as tmp:
        ordner = Path(tmp)
        async with async_playwright() as p:
            await teil_a(p)
            try:
                s_ampel = await teil_b(p, ordner)
                await teil_c(p, ordner, s_ampel)
            except Exception as e:  # noqa: BLE001 — fehlendes Bedienelement o. ä. ist ein Prüfungsfehler, kein Absturz
                pruefe("B/C Lauf ohne Ausnahme", False, str(e).splitlines()[0][:200])
    ok = all(ergebnisse)
    print("RESULT: " + ("OK" if ok else "FAIL"))
    return 0 if ok else 1


sys.exit(asyncio.run(main()))
