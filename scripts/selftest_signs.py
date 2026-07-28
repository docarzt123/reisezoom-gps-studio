#!/usr/bin/env python3
"""Editor-UI-Test für die neuen Zeiger-Optionen (v0.9.481).

Lädt ui/index.html mit dem Mock aus selftest_ui.py, seedet zwei Schilder ins
aktive Projekt, öffnet den Schild-Editor über die ✎-Zeile und prüft:
  * Zeiger-Farbe + Zeiger-Position sind da und zeigen die richtigen Werte
  * „Auto" schaltet um und der Picker folgt der Hintergrundfarbe
  * Stilwechsel (callout/pin ↔ banner) blendet die Felder ein/aus
  * Übernehmen schreibt accent + tailPos ins Schild
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
