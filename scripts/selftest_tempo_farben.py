"""Selbsttest „Tempo-Farben“ (17.10.2026): gefahrene Strecke nach Geschwindigkeit färben.

Teil A: die reinen Funktionen aus ui/js/tempo_farben.js auf einer leeren Seite.
Teil B: die echte Oberfläche an der echten Brücke (scripts/selftest_echtbruecke.py, Daten in einem
        Temp-Ordner) mit synthetischen Touren: Tempo-Rampe mit Zeit und eine Tour ohne Zeit.
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


def pruefe(name, ok, info=""):
    ergebnisse.append(bool(ok))
    print(("OK   " if ok else "FAIL ") + name + (f"  [{info}]" if info and not ok else ""))
    sys.stdout.flush()


def gpx_schreiben(pfad, mit_zeit, n=600):
    """Synthetische Tour: gerade nach Osten, 1-Hz-Punkte, Tempo-Rampe 20 → 100 km/h."""
    lat, lon, m_pro_grad = 50.0, 10.0, 111320 * 0.6428  # cos(50°)
    x, zeilen = 0.0, []
    for i in range(n):
        v = (20 + 80 * i / (n - 1)) / 3.6
        zeit = f"<time>2026-01-01T10:{i // 60:02d}:{i % 60:02d}Z</time>" if mit_zeit else ""
        zeilen.append(f'<trkpt lat="{lat}" lon="{lon + x / m_pro_grad:.6f}"><ele>100</ele>{zeit}</trkpt>')
        x += v
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
      return { konstMin: Math.min(...konst), konstMax: Math.max(...konst), ausrMax: Math.max(...ausr), ohneZeit,
               p98: T.perzentil(roh, 98), ampel: T.stufen("ampel", 80, "#ff8c2e"), eigen: T.stufen("eigen", 50, "#ff8c2e") };
    }""")
    # _tempoMoeglich aus dem echten Quelltext: Reihe ohne Geschwindigkeit (Reise: null, fehlend: undefined) → gesperrt
    quelle = (REPO / "modules/animator/ui/module.js").read_text(encoding="utf-8")
    m = re.search(r"function _tempoMoeglich\(\) \{.*?\n  \}", quelle, re.S)
    moeglich = await page.evaluate("""(src) => {
      const T = window.rzTempoFarben;
      let reihe = null;
      const _colorSeriesSafe = () => reihe;
      const f = new Function("_colorSeriesSafe", src + "; return _tempoMoeglich;")(_colorSeriesSafe);
      const basis = { has_time: true, cumDistM: [0, 1], cumTimeS: [0, 1] };
      const lauf = (o) => { reihe = o; return f(); };
      return { mit: lauf({ ...basis, speedKmh: [0, 1] }), reise: lauf({ ...basis, speedKmh: null }),
               fehlt: lauf({ ...basis }), ohneZeit: lauf({ ...basis, speedKmh: [0, 1], has_time: false }),
               keineReihe: lauf(null), tempoDa: !!T };
    }""", m.group(0) if m else "")
    await browser.close()
    pruefe("A7 _tempoMoeglich: mit Geschwindigkeit möglich; Reise (null), fehlend (undefined), ohne Zeit, ohne Reihe gesperrt",
           moeglich == {"mit": True, "reise": False, "fehlt": False, "ohneZeit": False, "keineReihe": False, "tempoDa": True}, moeglich)
    pruefe("A0 window.rzTempoFarben vorhanden", not r.get("fehlt"))
    if r.get("fehlt"):
        return
    pruefe("A1 konstant 36 km/h → alle Werte 36 ± 0,5", abs(r["konstMin"] - 36) <= 0.5 and abs(r["konstMax"] - 36) <= 0.5, r)
    pruefe("A2 Ausreißer 300 km/h → geglättet < 60", r["ausrMax"] < 60, r["ausrMax"])
    pruefe("A3 ohne Zeit (Δt ≤ 0) → 0", r["ohneZeit"] == [0, 0, 0], r["ohneZeit"])
    pruefe("A4 perzentil([0..100], 98) == 98", r["p98"] == 98, r["p98"])
    pruefe("A5 stufen ampel", r["ampel"] == [{"v": 0, "color": "#2e9e44"}, {"v": 40, "color": "#f2c40f"},
                                             {"v": 80, "color": "#d7191c"}], r["ampel"])
    pruefe("A6 stufen eigen: erster Stop rgba(255,140,46,0.25), letzter rgba(255,140,46,1)",
           r["eigen"][0]["color"] == "rgba(255,140,46,0.25)" and r["eigen"][-1] == {"v": 50, "color": "rgba(255,140,46,1)"}
           and len(r["eigen"]) == 2, r["eigen"])


# ── Teil B / C ────────────────────────────────────────────────────────────────
ZUSTAND_JS = """() => {
  const m = window.__rzLetzteKarte;
  const g = (id, k) => { try { return m.getPaintProperty(id, k); } catch (_) { return undefined; } };
  const sel = document.getElementById('anim-tempo-farben');
  return { gradient: JSON.stringify(g('preview-line', 'line-gradient') ?? null),
           geistSichtbar: m.getLayer('preview-ghost') ? m.getLayoutProperty('preview-ghost', 'visibility') : 'keine-ebene',
           geistDeckkraft: g('preview-ghost', 'line-opacity'), geistFarbe: g('preview-ghost', 'line-color'),
           linienFarbe: (document.getElementById('anim-color') || {}).value,
           wert: sel && sel.value };
}"""


async def tempo_setzen(page, wert):
    await page.evaluate("""(w) => { const s = document.getElementById('anim-tempo-farben'); s.value = w;
        s.dispatchEvent(new Event('change', { bubbles: true })); }""", wert)
    await page.wait_for_timeout(1200)


async def geist_aus(page):
    await page.evaluate("""() => { const c = document.getElementById('anim-ghost-enabled'); if (c && c.checked) {
        c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); } }""")
    await page.wait_for_timeout(600)


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


async def panel_auswahl(page):
    """Öffnet das Stil-Panel der Haupt-Tour und liefert Zustand der Zeile „Tempo-Farben“."""
    await page.evaluate("() => { const b = document.querySelector('.anim-stil-toggle'); if (b) b.click(); }")
    await page.wait_for_timeout(800)
    return await page.evaluate("""() => { const s = document.querySelector('[data-tempo-farben]');
        return s ? { disabled: s.disabled, titel: s.closest('.anim-stil-zeile').title, optionen: Array.from(s.options).map(o => o.value) } : null; }""")


async def teil_b(p, ordner):
    mit, ohne = ordner / "mit_zeit.gpx", ordner / "ohne_zeit.gpx"
    gpx_schreiben(mit, True)
    gpx_schreiben(ohne, False)

    browser, page, fehler = await eb.seite_starten(p)
    await tour_laden(page, mit)
    await geist_aus(page)
    await ganzer_track(page)
    s_ohne_schluessel = await page.evaluate(ZUSTAND_JS)
    h_ohne_schluessel = await bild_hash(page)
    await tempo_setzen(page, "aus")
    s_aus = await page.evaluate(ZUSTAND_JS)
    h_aus = await bild_hash(page)
    pruefe("B1a ohne Schlüssel: Auswahl steht auf „aus“", s_ohne_schluessel["wert"] == "aus", s_ohne_schluessel["wert"])
    pruefe("B1b ohne Schlüssel == „aus“: line-gradient gleich",
           s_ohne_schluessel["gradient"] == s_aus["gradient"], (s_ohne_schluessel["gradient"][:80], s_aus["gradient"][:80]))
    pruefe("B1c ohne Schlüssel == „aus“: Screenshot-Hash gleich", h_ohne_schluessel == h_aus, (h_ohne_schluessel, h_aus))
    pruefe("B1d „aus“: kein Tempo-Verlauf, Geist aus", "#d7191c" not in s_aus["gradient"] and s_aus["geistSichtbar"] == "none",
           (s_aus["gradient"][:80], s_aus["geistSichtbar"]))

    await tempo_setzen(page, "ampel")
    s_ampel = await page.evaluate(ZUSTAND_JS)
    pruefe("B2a „ampel“: Gradient gesetzt und enthält #d7191c", s_ampel["gradient"] != "null" and "#d7191c" in s_ampel["gradient"],
           s_ampel["gradient"][:120])
    pruefe("B2b „ampel“: Geist-Ebene sichtbar (30 %, Linienfarbe) trotz ausgeschaltetem Geist",
           s_ampel["geistSichtbar"] == "visible" and abs(s_ampel["geistDeckkraft"] - 0.3) < 1e-6
           and str(s_ampel["geistFarbe"]).lower() == str(s_ampel["linienFarbe"]).lower(), s_ampel)
    await tempo_setzen(page, "eigen")
    s_eigen = await page.evaluate(ZUSTAND_JS)
    g_eigen = json.loads(s_eigen["gradient"]) or []
    pruefe("B2d „eigen“: Gradient mit rgba-Stufen, vorn blass, hinten deckend in der Linienfarbe",
           len(g_eigen) > 4 and str(g_eigen[4]).startswith("rgba(") and float(str(g_eigen[4]).rstrip(")").split(",")[-1]) < 0.6
           and str(g_eigen[-1]).endswith(",1)"), s_eigen["gradient"][:160])

    await tempo_setzen(page, "aus")
    s_zurueck = await page.evaluate(ZUSTAND_JS)
    h_zurueck = await bild_hash(page)
    pruefe("B2e zurück auf „aus“: Zustand und Bild wie vorher",
           s_zurueck["gradient"] == s_aus["gradient"] and s_zurueck["geistSichtbar"] == "none" and h_zurueck == h_aus,
           (s_zurueck["geistSichtbar"], h_zurueck, h_aus))
    panel = await panel_auswahl(page)
    pruefe("B2f Stil-Panel: Auswahl aktiv mit aus/ampel/eigen", bool(panel) and not panel["disabled"]
           and panel["optionen"] == ["aus", "ampel", "eigen"], panel)

    # (3) Tour ohne Zeit — die gespeicherte Wahl „ampel“ greift dort nicht
    await tempo_setzen(page, "ampel")
    await tour_laden(page, ohne)
    s_ohne_zeit = await page.evaluate(ZUSTAND_JS)
    panel = await panel_auswahl(page)
    pruefe("B3a ohne Zeit: Auswahl disabled, Tooltip „Nur für Tracks mit Zeitstempeln“",
           bool(panel) and panel["disabled"] and panel["titel"] == "Nur für Tracks mit Zeitstempeln", panel)
    pruefe("B3b ohne Zeit: kein Tempo-Verlauf", "#d7191c" not in s_ohne_zeit["gradient"], s_ohne_zeit["gradient"][:80])
    pruefe("B3c kein pageerror", not fehler, fehler[:3])
    await browser.close()
    return s_ampel


async def teil_c(p, ordner, s_ampel_vorschau):
    modus = {"w": 1280, "h": 720, "fps": 30, "width": 1280, "height": 720, "blur": 0, "zoomShift": 0,
             "kachelStufen": None, "transMs": 300, "transparent": False}
    browser, page, fehler = await eb.seite_starten(p, init_skripte=[f"window.__rzRenderMode = {json.dumps(modus)};"],
                                                   viewport={"width": 1280, "height": 720})
    await tour_laden(page, ordner / "mit_zeit.gpx")
    await geist_aus(page)
    await ganzer_track(page)
    await tempo_setzen(page, "ampel")
    s = await page.evaluate(ZUSTAND_JS)
    pruefe("C1 Render-Modus: derselbe Gradient wie in der Vorschau", s["gradient"] == s_ampel_vorschau["gradient"],
           (s["gradient"][:100], s_ampel_vorschau["gradient"][:100]))
    pruefe("C2 Render-Modus: Geist sichtbar, 30 %", s["geistSichtbar"] == "visible" and abs(s["geistDeckkraft"] - 0.3) < 1e-6, s)
    pruefe("C3 Render-Modus: kein pageerror", not fehler, fehler[:3])
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
