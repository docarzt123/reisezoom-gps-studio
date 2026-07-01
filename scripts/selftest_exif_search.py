#!/usr/bin/env python3
"""Headless-Funktionstest für die EXIF-Tab-Suche (v0.9.355).

Lädt ui/index.html mit gemockter API (wiederverwendet MOCK_API_JS aus
selftest_ui.py), wechselt in den Geotagger, baut eine synthetische EXIF-
Tabelle in #gt-preview-exiftable, und prüft, dass das echte (im Modul
gebundene) Such-Handling Zeilen korrekt aus-/einblendet.
"""
from __future__ import annotations
import asyncio, sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
from scripts.selftest_ui import MOCK_API_JS, UI_INDEX  # gleiche Mock-API + Index

ROWS = [
    "Make", "Model", "GPSLatitude", "GPSLongitude",
    "GPSProcessingMethod", "GPSImgDirection", "ISO", "FNumber",
]

async def main():
    from playwright.async_api import async_playwright
    errors = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await (await browser.new_context(viewport={"width":1400,"height":900})).new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        await page.add_init_script(MOCK_API_JS)
        await page.goto(f"file://{UI_INDEX.resolve()}", wait_until="domcontentloaded")
        await page.wait_for_timeout(1500)
        # In den Geotagger wechseln
        tab = await page.query_selector('[data-mod="geotagger"]')
        assert tab, "Geotagger-Tab nicht gefunden"
        await tab.click()
        await page.wait_for_timeout(1200)

        # Suchfeld + Tabelle müssen existieren
        has_search = await page.evaluate("!!document.getElementById('gt-exif-search')")
        assert has_search, "Suchfeld #gt-exif-search fehlt"

        # Synthetische EXIF-Tabelle einsetzen (gleiche Struktur wie _gtRenderExif)
        await page.evaluate(
            """(rows) => {
                const tbl = document.getElementById('gt-preview-exiftable');
                tbl.innerHTML = '<table class="gt-exif-grid">' +
                  rows.map(r => `<tr><th>${r}</th><td>x</td></tr>`).join('') + '</table>';
            }""", ROWS)

        def vis_js():
            return """() => Array.from(document.querySelectorAll('#gt-preview-exiftable tr'))
                .filter(tr => tr.style.display !== 'none')
                .map(tr => tr.querySelector('th').textContent)"""

        async def type_search(q):
            await page.evaluate(
                """(q) => {
                    const i = document.getElementById('gt-exif-search');
                    i.value = q;
                    i.dispatchEvent(new Event('input', {bubbles:true}));
                }""", q)
            await page.wait_for_timeout(50)

        # 1) "GPS" -> nur GPS-Felder
        await type_search("GPS")
        vis = await page.evaluate(vis_js())
        exp = ["GPSLatitude","GPSLongitude","GPSProcessingMethod","GPSImgDirection"]
        assert vis == exp, f"GPS-Filter falsch: {vis}"
        print(f"  'GPS'  -> {vis}  ✓")

        # 2) case-insensitiv: "gps" gleich
        await type_search("gps")
        assert await page.evaluate(vis_js()) == exp, "case-insensitive fehlgeschlagen"
        print("  'gps'  -> case-insensitiv identisch  ✓")

        # 3) "iso" -> nur ISO
        await type_search("iso")
        vis = await page.evaluate(vis_js())
        assert vis == ["ISO"], f"ISO-Filter falsch: {vis}"
        print(f"  'iso'  -> {vis}  ✓")

        # 4) kein Treffer -> 0 Zeilen + Hinweis sichtbar
        await type_search("zzz")
        vis = await page.evaluate(vis_js())
        nomatch = await page.evaluate(
            "() => { const e=document.querySelector('#gt-preview-exiftable .gt-exif-nomatch'); return e && e.style.display!=='none' ? e.textContent : null; }")
        assert vis == [] and nomatch, f"Kein-Treffer falsch: vis={vis} hint={nomatch!r}"
        print(f"  'zzz'  -> 0 Zeilen + Hinweis: {nomatch!r}  ✓")

        # 5) leeren -> alle wieder sichtbar, Hinweis weg
        await type_search("")
        vis = await page.evaluate(vis_js())
        nomatch_hidden = await page.evaluate(
            "() => { const e=document.querySelector('#gt-preview-exiftable .gt-exif-nomatch'); return !e || e.style.display==='none'; }")
        assert vis == ROWS and nomatch_hidden, f"Leeren falsch: {vis}"
        print(f"  ''     -> alle {len(vis)} Zeilen wieder da, Hinweis weg  ✓")

        await browser.close()
    assert not errors, f"JS-pageerrors: {errors}"
    print("\nEXIF-SUCHE HEADLESS GRÜN ✓  (0 pageerrors)")

asyncio.run(main())
