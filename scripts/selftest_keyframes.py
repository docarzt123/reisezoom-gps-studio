#!/usr/bin/env python3
"""Keyframes kopieren — im echten Browser (v0.9.505).

`tests/test_keyframe_kopieren.py` prüft die Logik. Hier geht es um die Strecke
dazwischen: kommt ein Alt-Klick überhaupt als „duplizieren“ an, bleibt das
Original beim Ziehen wirklich liegen, und greift ⌘C/⌘V nur dann, wenn es soll?

Genau diese Schicht war schon zweimal die Fehlerquelle — beim OK-Knopf und beim
Speichern der Einstellungen. Beide Male war das Backend richtig und die
Oberfläche fragte falsch.

Aufruf:  .venv/bin/python scripts/selftest_keyframes.py
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "scripts"))

fehler = 0


def sagen(ok: bool, text: str, zusatz: str = "") -> None:
    global fehler
    print(f"  [{'OK  ' if ok else 'FAIL'}] {text}" + (f"  {zusatz}" if zusatz else ""))
    if not ok:
        fehler += 1


# Die Zeitleiste ist ein eigenständiges Stück (`mountTimelineBar`) und braucht
# weder Karte noch Track — sie lässt sich isoliert in eine leere Seite hängen.
# Das macht diesen Test schnell und unabhängig vom Rest des Animators.
SEITE = """
<!doctype html><html><head><meta charset="utf-8"><style>{css}</style></head>
<body><div id="host" style="width:800px"></div>
<script>{util}</script>
<script>{tl}</script>
<script>
  window.__ruf = [];
  const merk = (name) => (...a) => window.__ruf.push({{ name, args: a }});
  // Die Leiste holt sich ihre Events über `getEvents` — sie bekommt sie NICHT
  // als Argument von `refresh()`.
  window.__events = [
    {{ kind: "pitch",   anchor: 0.2 }},
    {{ kind: "bearing", anchor: 0.2 }},
    {{ kind: "zoom",    anchor: 0.2 }},
    {{ kind: "zoom",    anchor: 0.8 }},
  ];
  window.__bar = mountTimelineBar({{
    container: document.getElementById("host"),
    getEvents: () => window.__events,
    onSelect: merk("select"),
    onAnchorChange: merk("move"),
    onEventCopy: merk("copy"),
    onEventClipboardCopy: merk("clipCopy"),
    onEventClipboardPaste: merk("clipPaste"),
    onScrub: () => {{}},
  }});
  window.__bar.setEnabled(true);
  window.__bar.refresh();
</script></body></html>
"""


async def main() -> int:
    from playwright.async_api import async_playwright

    css = (REPO / "ui/css/app.css").read_text(encoding="utf-8")
    util = (REPO / "ui/js/util.js").read_text(encoding="utf-8")
    tl = (REPO / "ui/js/timeline.js").read_text(encoding="utf-8")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await (await browser.new_context(
            viewport={"width": 1000, "height": 400})).new_page()
        seiten_fehler: list = []
        page.on("pageerror", lambda e: seiten_fehler.append(str(e)[:200]))
        await page.set_content(SEITE.format(css=css, util=util, tl=tl))
        await page.wait_for_timeout(600)

        marker = await page.eval_on_selector_all(
            ".timeline-marker", "e => e.length")
        sagen(marker > 0, "die Zeitleiste steht mit Markern", str(marker))
        if not marker:
            await browser.close()
            return 1

        async def kasten(sel):
            return await page.eval_on_selector(sel, """e => {
              const r = e.getBoundingClientRect();
              return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
            }""")

        ziel_x = await page.eval_on_selector(".timeline-track", """e => {
          const r = e.getBoundingClientRect(); return r.x + r.width * 0.6; }""")

        # ── 1. Normales Ziehen verschiebt ──────────────────────────────────
        print("\n[1] Ohne Alt wird verschoben")
        m = await kasten('.timeline-marker[data-kind="zoom"][data-anchor="0.8"]')
        await page.evaluate("window.__ruf = []")
        await page.mouse.move(m["x"], m["y"])
        await page.mouse.down()
        await page.mouse.move(ziel_x, m["y"], steps=6)
        await page.mouse.up()
        await page.wait_for_timeout(200)
        rufe = await page.evaluate("window.__ruf.map(r => r.name)")
        sagen("move" in rufe, "„verschieben“ wird gemeldet", str(rufe))
        sagen("copy" not in rufe, "und NICHT „kopieren“", str(rufe))

        # ── 2. Mit Alt wird dupliziert ─────────────────────────────────────
        print("\n[2] Mit Alt wird dupliziert")
        m = await kasten('.timeline-marker[data-kind="pitch"][data-anchor="0.2"]')
        await page.evaluate("window.__ruf = []")
        await page.keyboard.down("Alt")
        await page.mouse.move(m["x"], m["y"])
        await page.mouse.down()
        await page.mouse.move(ziel_x, m["y"], steps=6)
        # Während des Ziehens darf das Original NICHT gespeichert werden.
        zwischen = await page.evaluate("window.__ruf.map(r => r.name)")
        sagen("move" not in zwischen,
              "während des Ziehens wird nichts verschoben", str(zwischen))
        markiert = await page.eval_on_selector_all(
            ".timeline-marker.is-copying", "e => e.length")
        sagen(markiert > 0, "der Marker zeigt sichtbar an, dass kopiert wird",
              str(markiert))
        await page.mouse.up()
        await page.keyboard.up("Alt")
        await page.wait_for_timeout(200)
        rufe = await page.evaluate("window.__ruf")
        namen = [r["name"] for r in rufe]
        sagen("copy" in namen, "beim Loslassen wird „kopieren“ gemeldet", str(namen))
        sagen("move" not in namen, "und zu keinem Zeitpunkt „verschieben“", str(namen))
        kopie = next((r for r in rufe if r["name"] == "copy"), None)
        if kopie:
            quelle, ziel = kopie["args"][0], kopie["args"][1]
            sagen(abs(quelle["anchor"] - 0.2) < 0.01,
                  "die QUELLE ist die ursprüngliche Position", str(quelle))
            sagen(ziel > 0.4, "das ZIEL ist die neue Position", str(round(ziel, 3)))

        # ── 3. Ein Klick ohne Ziehen kopiert nichts ────────────────────────
        print("\n[3] Alt-Klick ohne Ziehen tut nichts")
        await page.evaluate("window.__ruf = []")
        await page.keyboard.down("Alt")
        await page.mouse.move(m["x"], m["y"])
        await page.mouse.down()
        await page.mouse.up()
        await page.keyboard.up("Alt")
        await page.wait_for_timeout(150)
        namen = await page.evaluate("window.__ruf.map(r => r.name)")
        sagen("copy" not in namen, "keine Kopie ohne Bewegung", str(namen))

        # ── 4. ⌘C / ⌘V ────────────────────────────────────────────────────
        print("\n[4] ⌘C / ⌘V")
        await page.click('.timeline-marker[data-kind="bearing"][data-anchor="0.2"]')
        await page.wait_for_timeout(150)
        await page.evaluate("window.__ruf = []")
        await page.keyboard.press("Meta+c")
        await page.wait_for_timeout(150)
        namen = await page.evaluate("window.__ruf.map(r => r.name)")
        sagen("clipCopy" in namen, "⌘C meldet „kopieren“", str(namen))

        await page.evaluate("window.__ruf = []")
        await page.keyboard.press("Meta+v")
        await page.wait_for_timeout(150)
        namen = await page.evaluate("window.__ruf.map(r => r.name)")
        sagen("clipPaste" in namen, "⌘V meldet „einfügen“", str(namen))

        # ── 5. In einem Eingabefeld hat der Nutzer Vorrang ────────────────
        print("\n[5] ⌘C in einem Eingabefeld gehört dem Nutzer")
        await page.evaluate("""() => {
          const i = document.createElement("input");
          i.id = "probe"; document.body.appendChild(i); i.focus();
        }""")
        await page.evaluate("window.__ruf = []")
        await page.keyboard.press("Meta+c")
        await page.wait_for_timeout(150)
        namen = await page.evaluate("window.__ruf.map(r => r.name)")
        sagen("clipCopy" not in namen,
              "die Zeitleiste hält sich raus — sonst wäre Text-Kopieren kaputt",
              str(namen))

        sagen(not seiten_fehler, "keine JavaScript-Fehler", "; ".join(seiten_fehler[:2]))
        await browser.close()

    print("\n" + ("✅ Keyframe-Kopieren im Browser bestanden" if not fehler
                  else f"❌ {fehler} Prüfung(en) gescheitert"))
    return 1 if fehler else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
