#!/usr/bin/env python3
"""Ruhige Kamera je Abschnitt — im echten Browser (v0.9.534).

Klick auf das Übergangs-Symbol zwischen zwei Keyframes → Modal mit Häkchen
„Ruhige Kamera in diesem Abschnitt“ → anhaken → `onSmoothChange(anchor, true)`
wird gemeldet, nach `refresh()` trägt das Symbol die 🎥-Markierung, das Modal
bleibt offen, erneut öffnen zeigt das Häkchen gesetzt. Headless, ohne Brücke.

Aufruf:  .venv/bin/python scripts/selftest_ruhige_abschnitt.py
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
fehler = 0


def sagen(ok: bool, text: str, zusatz: str = "") -> None:
    global fehler
    print(f"  [{'OK  ' if ok else 'FAIL'}] {text}" + (f"  {zusatz}" if zusatz else ""))
    if not ok:
        fehler += 1


SEITE = """
<!doctype html><html><head><meta charset="utf-8"><style>{css}</style><style>{tlcss}</style></head>
<body><div id="host" style="width:900px"></div>
<script>{util}</script>
<script>{tl}</script>
<script>
  window.__ruf = [];
  window.__events = [
    {{ kind: "pitch", anchor: 0.2, value: 50, easing: "linear" }},
    {{ kind: "zoom",  anchor: 0.2, value_absolute: 10, easing: "linear" }},
    {{ kind: "pitch", anchor: 0.7, value: 55, easing: "ease_in_out" }},
    {{ kind: "zoom",  anchor: 0.7, value_absolute: 13, easing: "ease_in_out" }},
  ];
  window.__bar = mountTimelineBar({{
    container: document.getElementById("host"),
    getEvents: () => window.__events,
    onSelect: () => {{}}, onAnchorChange: () => {{}}, onScrub: () => {{}},
    onEasingChange: (a, e) => window.__ruf.push({{ name: "easing", a, e }}),
    onSmoothChange: (a, an) => {{
      window.__ruf.push({{ name: "smooth", a, an }});
      for (const ev of window.__events) if (Math.abs(ev.anchor - a) < 0.001) {{ if (an) ev.smooth_in = true; else delete ev.smooth_in; }}
      window.__bar.refresh();
    }},
  }});
  window.__bar.setEnabled(true);
  window.__bar.refresh();
</script></body></html>
"""


async def main() -> int:
    from playwright.async_api import async_playwright
    css = (REPO / "ui/css/app.css").read_text(encoding="utf-8")
    tlcss = (REPO / "ui/css/timeline.css").read_text(encoding="utf-8")
    util = (REPO / "ui/js/util.js").read_text(encoding="utf-8")
    tl = (REPO / "ui/js/timeline.js").read_text(encoding="utf-8")
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await (await browser.new_context(viewport={"width": 1000, "height": 500})).new_page()
        seiten_fehler: list = []
        page.on("pageerror", lambda e: seiten_fehler.append(str(e)[:200]))
        await page.set_content(SEITE.format(css=css, tlcss=tlcss, util=util, tl=tl))
        await page.wait_for_timeout(500)

        n_sym = await page.eval_on_selector_all(".timeline-easing-symbol", "e => e.length")
        sagen(n_sym == 1, "ein Übergangs-Symbol zwischen den zwei Keyframes", str(n_sym))
        if not n_sym:
            await browser.close(); return 1
        sagen(not await page.eval_on_selector_all(".timeline-easing-smooth-badge", "e => e.length"),
              "ohne Flag keine 🎥-Markierung")

        await page.click(".timeline-easing-symbol")
        await page.wait_for_timeout(200)
        sagen(await page.query_selector(".timeline-easing-modal") is not None, "Modal öffnet")
        cb = await page.query_selector(".easing-modal-smooth-cb")
        sagen(cb is not None, "Häkchen „Ruhige Kamera in diesem Abschnitt“ ist da")
        sagen(not await page.eval_on_selector(".easing-modal-smooth-cb", "e => e.checked"), "… zunächst aus")

        await page.click(".easing-modal-smooth-cb")
        await page.wait_for_timeout(200)
        rufe = await page.evaluate("window.__ruf")
        sm = [r for r in rufe if r["name"] == "smooth"]
        sagen(len(sm) == 1 and sm[0]["an"] is True and abs(sm[0]["a"] - 0.7) < 1e-6,
              "onSmoothChange(0.7, true) wird gemeldet", str(sm))
        sagen(await page.query_selector(".timeline-easing-modal") is not None, "Modal bleibt offen")
        sagen(await page.eval_on_selector_all(".timeline-easing-smooth-badge", "e => e.length") == 1,
              "Symbol trägt jetzt die 🎥-Markierung")
        sagen(await page.eval_on_selector_all(".timeline-easing-symbol.is-smooth", "e => e.length") == 1,
              "… und die is-smooth-Klasse")

        # Übergang wechseln → Modal schließt, Flag bleibt
        await page.click(".easing-modal-opt.easing-ease_out")
        await page.wait_for_timeout(200)
        sagen(await page.query_selector(".timeline-easing-modal") is None, "Übergangs-Wahl schließt das Modal")
        sagen(await page.evaluate("window.__events.filter(e => e.smooth_in).length") == 2, "Flag bleibt an beiden Ziel-Events")

        await page.click(".timeline-easing-symbol")
        await page.wait_for_timeout(200)
        sagen(await page.eval_on_selector(".easing-modal-smooth-cb", "e => e.checked"), "erneut öffnen: Häkchen gesetzt")
        await page.click(".easing-modal-smooth-cb")
        await page.wait_for_timeout(200)
        sm = [r for r in await page.evaluate("window.__ruf") if r["name"] == "smooth"]
        sagen(len(sm) == 2 and sm[1]["an"] is False, "abhaken meldet false", str(sm))
        sagen(await page.eval_on_selector_all(".timeline-easing-smooth-badge", "e => e.length") == 0,
              "Markierung verschwindet wieder")
        await page.keyboard.press("Escape")
        sagen(not seiten_fehler, "keine JS-Fehler", "; ".join(seiten_fehler))
        await browser.close()
    print("\n" + ("ALLE TESTS OK" if not fehler else f"{fehler} FEHLER"))
    return 1 if fehler else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
