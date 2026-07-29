#!/usr/bin/env python3
"""Tests für die Zeiger-Optionen der Schilder (Farbe + Position, v0.9.481/482).

Teil 1 — Editor-UI: lädt ui/index.html mit dem Mock aus selftest_ui.py, seedet
zwei Schilder ins aktive Projekt, öffnet den Schild-Editor über die ✎-Zeile:
  * Zeiger-Farbe + Zeiger-Position sind da und zeigen die richtigen Werte
  * „Auto" schaltet um und der Picker folgt der Hintergrundfarbe
  * Stilwechsel (callout/pin ↔ banner) blendet die Felder ein/aus
  * Übernehmen schreibt accent + tailPos ins Schild

Teil 2 — Echtzeit + WYSIWYG (v0.9.482, nach Beta-Tester-Meldung): stylt EINE
bestehende Karte mehrfach um, so wie es der offene Editor tut, und prüft, dass
die Stecknadel sofort mitzieht statt erst beim Schließen des Editors. Danach
Pixel-Abgleich gegen den Canvas-Pfad, der ins Video geht — Vorschau und Video
müssen dieselbe Farbe zeigen.
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts"))

import selftest_ui as S  # noqa: E402

# Mock erweitern: aktives Projekt bringt zwei Schilder mit.
SIGNS = [
    {"lat": 52.525, "lon": 13.43, "text": "Sprechblase", "style": "callout",
     "bg": "none", "accent": "#ff0000", "tailPos": "left"},
    {"lat": 52.54, "lon": 13.46, "text": "Nadel", "style": "pin",
     "bg": "#123456", "accent": "auto", "tailPos": "center"},
]
MOCK = S.MOCK_API_JS.replace(
    'geotagger: SETTINGS.geotagger,\n  }];',
    'geotagger: SETTINGS.geotagger,\n    signs: ' + json.dumps(SIGNS) + ',\n  }];',
).replace(
    "    session_activate: async () => ({ ok: true, project: PROJECTS[0] }),",
    "    session_activate: async () => ({ ok: true, project: PROJECTS[0] }),\n"
    "    session_open_for_track: async () => ({ ok: true, session: { track_hash: 'h1', name: 'Mock' },"
    " active_project: PROJECTS[0], projects: PROJECTS }),\n"
    "    session_set_active_project: async () => ({ ok: true, active_project: PROJECTS[0], projects: PROJECTS }),\n"
    "    session_save_project_settings: async () => ({ ok: true }),",
)
assert "signs:" in MOCK and "session_open_for_track" in MOCK, "Projekt-Mock nicht gepatcht"

UI = REPO / "ui/index.html"


async def main() -> int:
    from playwright.async_api import async_playwright

    fails: list[str] = []
    errs: list[str] = []

    def ok(cond, msg):
        print(("   ✅ " if cond else "   ❌ ") + msg)
        if not cond:
            fails.append(msg)

    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        pg = await br.new_page(viewport={"width": 1500, "height": 950})
        pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.add_init_script(MOCK)
        await pg.goto(UI.as_uri(), wait_until="load")
        await pg.wait_for_timeout(4000)

        # Track laden → Session/Projekt (mit Schildern) wird aktiv
        await pg.evaluate("""async () => {
          if (typeof window.loadGlobalGpx === 'function')
            await window.loadGlobalGpx('/mock/track.gpx');
        }""")
        await pg.wait_for_timeout(2500)

        # Animator ist Default-Modul; Schilder-Akkordeon aufklappen
        await pg.evaluate("""() => {
          const s = document.getElementById('anim-signs-section');
          const b = s && s.querySelector('.section-collapse-body');
          if (b) { b.hidden = false; b.removeAttribute('hidden'); }
        }""")
        await pg.wait_for_timeout(800)

        rows = await pg.eval_on_selector_all("#anim-signs-list .sign-row", "e=>e.length")
        ok(rows == 2, f"Schild-Liste zeigt 2 Zeilen (ist: {rows})")
        if rows != 2:
            await br.close()
            return 1

        # ── Schild 1: callout, transparenter Hintergrund, eigener roter Zeiger links
        await pg.click('#anim-signs-list .sign-row[data-idx="0"] .sign-row-edit')
        await pg.wait_for_timeout(900)

        st = await pg.evaluate("""() => {
          const g = (id) => document.getElementById(id);
          const vis = (id) => { const e = g(id); return !!e && e.offsetParent !== null; };
          return {
            open: !!document.querySelector('.sign-editor'),
            acVal: g('se-ac') ? g('se-ac').value : null,
            acAuto: g('se-ac') ? g('se-ac').dataset.auto : null,
            btnOn: g('se-ac-auto') ? g('se-ac-auto').classList.contains('on') : null,
            tp: g('se-tp') ? g('se-tp').value : null,
            tpOpts: g('se-tp') ? [...g('se-tp').options].map(o=>o.value) : [],
            acVisible: vis('se-ac'), tpVisible: vis('se-tp'),
          };
        }""")
        print("   Editor Schild 1:", st)
        ok(st["open"], "Editor öffnet sich")
        ok(st["acVal"] == "#ff0000", f"Zeiger-Farbe zeigt eigene Farbe #ff0000 (ist: {st['acVal']})")
        ok(st["acAuto"] == "0", "Auto-Flag aus (eigene Farbe gesetzt)")
        ok(st["btnOn"] is False, "Auto-Knopf nicht aktiv")
        ok(st["tp"] == "left", f"Zeiger-Position = links (ist: {st['tp']})")
        ok(st["tpOpts"] == ["left", "center", "right"], f"drei Positionen (ist: {st['tpOpts']})")
        ok(st["acVisible"] and st["tpVisible"], "beide Felder sichtbar bei callout")

        # „Auto" drücken → Picker folgt dem Hintergrund (bg=none → #15171c)
        await pg.click("#se-ac-auto")
        await pg.wait_for_timeout(400)
        au = await pg.evaluate("""() => ({
          v: document.getElementById('se-ac').value,
          a: document.getElementById('se-ac').dataset.auto,
          on: document.getElementById('se-ac-auto').classList.contains('on'),
        })""")
        print("   nach Auto:", au)
        ok(au["a"] == "1" and au["on"], "Auto-Knopf schaltet auf Auto")

        # Stil auf „banner" → Zeiger-Felder verschwinden, zurück auf callout → wieder da
        await pg.select_option("#se-style", "banner")
        await pg.wait_for_timeout(400)
        hid = await pg.evaluate("""() => {
          const v = (id) => { const e = document.getElementById(id); return !!e && e.offsetParent !== null; };
          return { ac: v('se-ac'), tp: v('se-tp'), lab: v('se-ac-label') };
        }""")
        ok(not hid["ac"] and not hid["tp"] and not hid["lab"],
           f"Zeiger-Felder bei „Banner“ ausgeblendet (ist: {hid})")
        await pg.select_option("#se-style", "pin")
        await pg.wait_for_timeout(400)
        shown = await pg.evaluate("""() => {
          const v = (id) => { const e = document.getElementById(id); return !!e && e.offsetParent !== null; };
          return { ac: v('se-ac'), tp: v('se-tp') };
        }""")
        ok(shown["ac"] and shown["tp"], f"Zeiger-Felder bei „Nadel“ wieder da (ist: {shown})")

        # Eigene Farbe + rechts setzen, übernehmen
        await pg.evaluate("""() => {
          const c = document.getElementById('se-ac');
          c.value = '#00cc44'; c.dispatchEvent(new Event('input', {bubbles:true}));
          const s = document.getElementById('se-tp');
          s.value = 'right'; s.dispatchEvent(new Event('change', {bubbles:true}));
        }""")
        await pg.wait_for_timeout(600)

        # Die Karte lädt headless nicht (Mock-Token) → statt des Karten-Markers
        # den Renderer direkt mit genau den Editor-Werten füttern. Damit ist die
        # Kette Editor-Feld → Schild-Optik geprüft, ohne Mapbox.
        prev = await pg.evaluate("""() => {
          const acEl = document.getElementById('se-ac');
          const o = {
            text: 'X', style: document.getElementById('se-style').value,
            bg: 'none',
            accent: acEl.dataset.auto === '1' ? 'auto' : acEl.value,
            tailPos: document.getElementById('se-tp').value,
          };
          window.__rzSignDomInjectCss();
          const wrap = window.__rzSignDomBuild();
          document.body.appendChild(wrap);
          window.__rzSignDomStyle(wrap, o);
          const card = wrap.querySelector('[style*="--rz-tail"]') || wrap.firstElementChild || wrap;
          const r = {
            given: o,
            tail: card.style.getPropertyValue('--rz-tail'),
            accent: card.style.getPropertyValue('--rz-accent'),
            tailx: card.style.getPropertyValue('--rz-tailx'),
          };
          wrap.remove();
          return r;
        }""")
        print("   Renderer mit Editor-Werten:", prev)
        ok(prev["tail"] == "#00cc44", f"Zeiger-Farbe kommt an (ist: {prev['tail']})")
        ok("100%" in prev["tailx"], f"Position rechts kommt an (ist: {prev['tailx']})")

        # ── Teil 2: Echtzeit an EINER bestehenden Karte + Abgleich mit dem Video
        print("\n   ── Echtzeit + WYSIWYG (v0.9.482)")
        await pg.evaluate("""() => {
          window.__pinCard = window.__rzSignDomBuild();
          document.body.appendChild(window.__pinCard);
          window.__restyle = (o) => {
            window.__rzSignDomStyle(window.__pinCard, o);
            const p = window.__pinCard.querySelector('.rz-sign__pin path');
            const c = window.__pinCard.querySelector('.rz-sign') || window.__pinCard.firstElementChild;
            return {
              pinFill: p ? p.getAttribute('fill') : null,
              tail: c ? c.style.getPropertyValue('--rz-tail') : null,
              tailx: c ? c.style.getPropertyValue('--rz-tailx') : null,
            };
          };
          window.__canvasColors = (o) => {
            const r = window.__rzDrawSign(Object.assign({ text: 'X', size: 40 }, o));
            const d = r.data.data, n = {};
            for (let i = 0; i < d.length; i += 4) {
              if (d[i + 3] < 200) continue;
              const k = d[i] + ',' + d[i + 1] + ',' + d[i + 2];
              n[k] = (n[k] || 0) + 1;
            }
            return n;
          };
        }""")
        base = {"text": "Nadel", "style": "pin", "bg": "none",
                "accent": "auto", "tailPos": "center"}

        r0 = await pg.evaluate("o => window.__restyle(o)", base)
        ok(r0["pinFill"] == "#15171c",
           f"Nadel: Auto + transparent → dezentes Dunkel (ist: {r0['pinFill']})")
        # Genau der Beta-Tester-Fall: Farbe im OFFENEN Editor ändern.
        r1 = await pg.evaluate("o => window.__restyle(o)", {**base, "accent": "#ff0000"})
        ok(r1["pinFill"] == "#ff0000",
           f"Nadel übernimmt neue Farbe sofort, ohne Neuaufbau (ist: {r1['pinFill']})")
        r2 = await pg.evaluate("o => window.__restyle(o)",
                               {**base, "accent": "#ff0000", "tailPos": "right"})
        ok("100%" in (r2["tailx"] or ""), f"Nadel rechts kommt an (ist: {r2['tailx']})")
        r3 = await pg.evaluate("o => window.__restyle(o)", base)
        ok(r3["pinFill"] == "#15171c",
           f"zurück auf Auto greift wieder (ist: {r3['pinFill']})")

        for label, o in [
            ("eigene Farbe + transparent", {**base, "accent": "#ff0000"}),
            ("eigene Farbe + Box-Hintergrund", {**base, "bg": "#123456", "accent": "#00cc44"}),
            ("Auto + Box-Hintergrund", {**base, "bg": "#123456"}),
            ("Auto + transparent", base),
        ]:
            dom = await pg.evaluate("o => window.__restyle(o)", o)
            counts = await pg.evaluate("o => window.__canvasColors(o)", o)
            h = dom["pinFill"].lstrip("#")
            want = f"{int(h[0:2], 16)},{int(h[2:4], 16)},{int(h[4:6], 16)}"
            ok(counts.get(want, 0) > 50,
               f"{label}: Vorschau {dom['pinFill']} steckt auch im Video-Bild")

        # Sprechblase: bei transparent + Auto zeichnet der Canvas keine Spitze —
        # die Vorschau muss sie ebenfalls weglassen.
        cal = {"text": "Blase", "style": "callout", "bg": "none",
               "accent": "auto", "tailPos": "center"}
        rc = await pg.evaluate("o => window.__restyle(o)", cal)
        ok(rc["tail"] == "transparent",
           f"Spitze bei transparent+Auto auch in der Vorschau weg (ist: {rc['tail']})")
        rc2 = await pg.evaluate("o => window.__restyle(o)", {**cal, "accent": "#ff0000"})
        ok(rc2["tail"] == "#ff0000",
           f"mit eigener Farbe ist die Spitze wieder da (ist: {rc2['tail']})")

        # ── Teil 3 — icon-size: tanzende Buchstaben (v0.9.484) ────────────
        # Der datengetriebene icon-size-Ausdruck (popScale) lässt Mapbox das
        # Symbol beim Zoomen anders rastern → die Schrift zappelt. Er darf
        # deshalb NUR während eines laufenden Aufpoppens am Layer hängen.
        print("\n   ── icon-size / tanzende Buchstaben (v0.9.484)")
        iz = await pg.evaluate("""() => {
          const meta = window.__rzSignMeta, frame = window.__rzSignFrame;
          const dur = 12;
          const metas = [ meta({track_anchor: 0.30, entry: 'pop',  before: 0, after: 0}, dur),
                          meta({track_anchor: 0.70, entry: 'none', before: 0, after: 0}, dur) ];
          let expr = null;
          const map = {
            __rzSignSizeScale: 1, __rzSignPopMode: false,
            __rzSignFC: {type: 'FeatureCollection', features: metas.map(() => ({properties: {popScale: 1}}))},
            getLayer: () => true, setFilter() {}, setFeatureState() {},
            setLayoutProperty: (l, k, v) => { if (k === 'icon-size') expr = v; },
            getSource: () => ({ setData() {} }),
          };
          const at = (M) => { frame(map, 'lyr', 'src', metas, M); return map.__rzSignPopMode; };
          const w = metas[0].pop, a = metas[0].a_show;
          const out = { start: at(0), vor: at(a - 0.01), mitte: at(a + w * 0.3),
                        spaet: at(a + w * 0.9), nach: at(a + w + 0.01), ende: at(1) };
          out.letzterAusdruckHatPop = !!(expr && JSON.stringify(expr).includes('popScale'));
          const e = window.__rzSignIconSize(true, 2);
          out.zoomTopLevel = (e[0] === 'interpolate' && e[2][0] === 'zoom');
          out.ohnePopSauber = !JSON.stringify(window.__rzSignIconSize(false, 2)).includes('popScale');
          out.skaliert = window.__rzSignIconSize(false, 2)[4][2] === 1.0;
          return out;
        }""")
        print("   ", iz)
        ok(iz["start"] is False and iz["vor"] is False,
           "vor dem Aufpoppen reiner Zoom-Ausdruck (scharf)")
        ok(iz["mitte"] is True and iz["spaet"] is True,
           "während des Aufpoppens datengetrieben (es poppt wirklich)")
        ok(iz["nach"] is False and iz["ende"] is False and not iz["letzterAusdruckHatPop"],
           "danach sofort zurück auf den reinen Zoom-Ausdruck")
        ok(iz["zoomTopLevel"], "['zoom'] bleibt top-level (sonst verwirft Mapbox den Layer)")
        ok(iz["ohnePopSauber"], "Normal-Ausdruck enthält kein popScale")
        ok(iz["skaliert"], "Render-Scale steckt in den Stützwerten")

        await br.close()

    print(f"\n   pageerrors: {len(errs)}")
    for e in errs[:5]:
        print("   ❌", e)
    if errs:
        fails.append("pageerrors")
    print("\nRESULT:", "OK" if not fails else f"FAIL ({len(fails)})")
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
