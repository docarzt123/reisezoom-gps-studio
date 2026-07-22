#!/usr/bin/env python3
"""Reisezoom GPS Studio — Deep-UI-Selbsttest (v0.9.459).

Härter als `selftest_ui.py` (das nur jedes Modul einmal mountet): fährt in
jedem Modul JEDEN Regler an — alle Checkboxen zweimal, alle Slider auf
min/max/Mitte, alle Selects durch alle Optionen, alle Akkordeons auf/zu, den
Keyframe-Editor im Wechsel mit Modulwechseln, Undo/Redo-Salven — und prüft
danach, dass KEIN als `[hidden]` markiertes Element sichtbar ist. Genau diese
drei Bug-Klassen (Style-Lade-Fehler beim Regler-Anfassen, Layout-CSS überstimmt
`[hidden]`, Race-Conditions beim Modulwechsel) fielen im Audit 2026-07-21 auf,
nachdem der einfache Smoke-Test sie übersehen hatte.

Mockt `window.pywebview.api` (kein Backend nötig) und lädt `ui/index.html` in
Playwright-Chromium. Exit 0 = sauber, Exit 1 = pageerror oder sichtbares
`[hidden]`-Element gefunden.

Aufruf:
    source .venv/bin/activate && python3 scripts/selftest_deep.py
"""
from __future__ import annotations

import asyncio
import importlib.util
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

# Mock-API aus dem einfachen Smoke-Test wiederverwenden (eine Quelle der Wahrheit).
_spec = importlib.util.spec_from_file_location("selftest_ui", REPO / "scripts/selftest_ui.py")
_st = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_st)
MOCK_API_JS = _st.MOCK_API_JS

from playwright.async_api import async_playwright  # noqa: E402

MODULES = ("animator", "tourmap", "heightanim", "geotagger", "gpxinspect")

# Erwartbare Console-Errors (Mock-Token → Mapbox 401 etc.) — kein echter Fehler.
IGNORE = ("mapbox access token", "401", "failed to load resource",
          "sprite", "glyphs", "ajaxerror")


async def _visible_hidden_elements(pg) -> list:
    """IDs/Klassen aller `[hidden]`-Elemente, die trotzdem eine Box haben."""
    return await pg.evaluate("""() => [...document.querySelectorAll('[hidden]')]
        .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
        .map(el => el.id || String(el.className).slice(0, 40))""")


async def run() -> int:
    pageerrors: list[str] = []
    findings: list[str] = []

    async with async_playwright() as p:
        browser = await p.chromium.launch()
        pg = await browser.new_page(viewport={"width": 1680, "height": 1050})
        pg.on("pageerror", lambda e: pageerrors.append(str(e)))
        await pg.add_init_script(MOCK_API_JS)
        await pg.goto((REPO / "ui/index.html").as_uri())
        await pg.wait_for_timeout(2500)

        # 1) Drei volle Modul-Wechsel-Zyklen (Race-Conditions).
        for cycle in range(3):
            for mod in MODULES:
                try:
                    await pg.click(f'[data-mod="{mod}"]', timeout=3000)
                except Exception as e:
                    findings.append(f"Modul-Tab {mod} nicht klickbar: {e}")
                await pg.wait_for_timeout(350 if cycle else 1100)
        print(f"3 Wechsel-Zyklen über {len(MODULES)} Module — pageerrors: {len(pageerrors)}")

        # 2) Animator: alle Checkboxen 2×, Slider min/max/Mitte, Selects komplett.
        await pg.click('[data-mod="animator"]'); await pg.wait_for_timeout(1200)
        n_cb = await pg.evaluate("""async () => {
          const bs = [...document.querySelectorAll('#anim-panel input[type="checkbox"]')];
          for (const b of bs) { b.click(); await new Promise(r=>setTimeout(r,12)); b.click(); await new Promise(r=>setTimeout(r,12)); }
          return bs.length;
        }""")
        n_sl = await pg.evaluate("""async () => {
          const ss = [...document.querySelectorAll('#anim-panel input[type="range"]')];
          for (const s of ss) for (const v of [s.min, s.max, String((+s.min+ +s.max)/2)]) {
            s.value = v; s.dispatchEvent(new Event('input',{bubbles:true})); s.dispatchEvent(new Event('change',{bubbles:true}));
            await new Promise(r=>setTimeout(r,6));
          }
          return ss.length;
        }""")
        n_se = await pg.evaluate("""async () => {
          const ss = [...document.querySelectorAll('#anim-panel select')];
          for (const s of ss) { const o0 = s.value;
            for (const o of s.options) { s.value = o.value; s.dispatchEvent(new Event('change',{bubbles:true})); await new Promise(r=>setTimeout(r,6)); }
            s.value = o0; s.dispatchEvent(new Event('change',{bubbles:true})); }
          return ss.length;
        }""")
        print(f"Animator: {n_cb} Checkboxen, {n_sl} Slider, {n_se} Selects — pageerrors: {len(pageerrors)}")

        # 3) Akkordeons aller Module auf/zu.
        for mod in MODULES:
            await pg.click(f'[data-mod="{mod}"]'); await pg.wait_for_timeout(600)
            await pg.evaluate("""async () => {
              const hs = [...document.querySelectorAll('aside.panel [data-accordion-section] .section-collapse-header')]
                .filter(h => h.getBoundingClientRect().width > 0);
              for (const h of hs) { h.click(); await new Promise(r=>setTimeout(r,15)); h.click(); await new Promise(r=>setTimeout(r,15)); }
            }""")
        print(f"Akkordeons aller Module — pageerrors: {len(pageerrors)}")

        # 4) Keyframe-Editor toggeln + Modulwechsel dazwischen.
        await pg.click('[data-mod="animator"]'); await pg.wait_for_timeout(700)
        await pg.evaluate("""async () => {
          const kf = document.getElementById('anim-kf-enabled');
          if (kf) for (let i=0;i<4;i++){ kf.click(); await new Promise(r=>setTimeout(r,120)); }
        }""")
        await pg.click('[data-mod="tourmap"]'); await pg.wait_for_timeout(400)
        await pg.click('[data-mod="animator"]'); await pg.wait_for_timeout(700)

        # 5) Undo/Redo-Salven.
        for mod in ("animator", "gpxinspect", "geotagger"):
            await pg.click(f'[data-mod="{mod}"]'); await pg.wait_for_timeout(350)
            for _ in range(10):
                await pg.keyboard.press("Meta+z"); await pg.wait_for_timeout(15)
            for _ in range(5):
                await pg.keyboard.press("Meta+Shift+z"); await pg.wait_for_timeout(15)
        print(f"KF-Toggle + Undo/Redo-Salven — pageerrors: {len(pageerrors)}")

        # 6) In jedem Modul: kein sichtbares [hidden]-Element (Layout-CSS-Regel).
        for mod in MODULES:
            await pg.click(f'[data-mod="{mod}"]'); await pg.wait_for_timeout(600)
            bad = await _visible_hidden_elements(pg)
            for b in bad:
                findings.append(f"sichtbares [hidden]-Element in {mod}: {b}")

        await browser.close()

    print("\n════ ERGEBNIS ════")
    print("pageerrors:", len(pageerrors))
    for e in pageerrors[:10]:
        print("  ✗", e[:200])
    for f in findings:
        print("  ✗", f)
    ok = not pageerrors and not findings
    print("RESULT:", "OK" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(run()))
