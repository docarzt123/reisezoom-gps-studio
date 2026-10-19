#!/usr/bin/env python3
"""Regressions-Test: der Render-Browser räumt seinen Speicher regelmäßig auf.

Bug: Beim Video-Render wuchs der Render-Browser je 100 Bilder um mehrere hundert MB, bis der Arbeitsspeicher
ausging und lange Videos abbrachen. Ursache ist kein Leck, sondern kurzlebiger Müll der Seite mit nativem
Anhang, den V8 erst spät wegräumt. Abhilfe: `core.szene._speicher_aufraeumen` löst über eine CDP-Sitzung alle
`GC_BILDER` Bilder einen vollen GC aus, in der Bildschleife und im Vorläufer.

Geprüft (offline, ohne App und ohne Render):
  A  der Aufruf räumt unerreichbare Objekte wirklich weg (Heap vorher/nachher) und liefert True
  B  die CDP-Sitzung wird je Seite nur einmal angelegt
  C  nach dem Schließen der Seite: kein Fehler nach außen, Ergebnis False
  D  Bildschleife (render_szene) und Vorläufer (_vorlaeufer) rufen ihn auf (Quelltext)
  E  RZ_GC_BILDER steuert den Abstand, 0 schaltet ab

Aufruf:  .venv/bin/python scripts/selftest_render_gc.py
Exit 0 = alles grün · Exit 1 = mindestens ein Fall rot.
"""
from __future__ import annotations

import ast
import asyncio
import os
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

fehler = 0


def sagen(ok: bool, text: str, zusatz: str = "") -> None:
    global fehler
    print(f"  [{'OK  ' if ok else 'FAIL'}] {text}" + (f"  {zusatz}" if zusatz else ""))
    if not ok:
        fehler += 1


MUELL_JS = """() => {
  // rund 40 MB kurzlebige Objekte, danach unerreichbar
  let a = [];
  for (let i = 0; i < 400; i++) a.push(new Array(12500).fill(0).map((_, k) => ({ k, s: 'x' + k })));
  window.__rzTestAnzahl = a.length;
  a = null;
  return true;
}"""


async def heap_mb(page) -> float:
    cdp = await page.context.new_cdp_session(page)
    try:
        h = await cdp.send("Runtime.getHeapUsage")
        return h["usedSize"] / 1048576
    finally:
        await cdp.detach()


async def browser_faelle() -> None:
    from playwright.async_api import async_playwright
    from core import szene

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        try:
            page = await browser.new_page()
            await page.goto("about:blank")

            print("\nFall A: Müll wird weggeräumt")
            await page.evaluate(MUELL_JS)
            vor = await heap_mb(page)
            ok = await szene._speicher_aufraeumen(page)
            nach = await heap_mb(page)
            sagen(ok is True, "Aufruf liefert True")
            sagen(vor - nach > 10, "Heap schrumpft deutlich", f"vorher {vor:.1f} MB, nachher {nach:.1f} MB")

            print("\nFall B: eine CDP-Sitzung je Seite")
            erste = getattr(page, "_rz_cdp", None)
            await szene._speicher_aufraeumen(page)
            sagen(erste is not None and getattr(page, "_rz_cdp", None) is erste, "Sitzung wird wiederverwendet")

            print("\nFall C: geschlossene Seite")
            await page.close()
            try:
                ok = await szene._speicher_aufraeumen(page)
                sagen(ok is False, "liefert False ohne Ausnahme")
            except Exception as e:      # noqa: BLE001
                sagen(False, "liefert False ohne Ausnahme", repr(e)[:120])
        finally:
            await browser.close()


def quelltext_faelle() -> None:
    print("\nFall D: Aufrufe in Bildschleife und Vorläufer")
    baum = ast.parse((REPO / "core" / "szene.py").read_text(encoding="utf-8"))
    rufer = set()
    for knoten in ast.walk(baum):
        if isinstance(knoten, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for k in ast.walk(knoten):
                if isinstance(k, ast.Call) and getattr(k.func, "id", None) == "_speicher_aufraeumen":
                    rufer.add(knoten.name)
    sagen("render_szene" in rufer, "Bildschleife (render_szene) räumt auf", f"Aufrufer: {sorted(rufer)}")
    sagen("_vorlaeufer" in rufer, "Vorläufer räumt auf")


def env_faelle() -> None:
    print("\nFall E: RZ_GC_BILDER")
    for wert, erwartet in (("", 25), ("10", 10), ("0", 0)):
        env = dict(os.environ, RZ_GC_BILDER=wert)
        r = subprocess.run([sys.executable, "-c", "from core import szene; print(szene.GC_BILDER)"],
                           cwd=REPO, env=env, capture_output=True, text=True, timeout=120)
        ist = r.stdout.strip().splitlines()[-1] if r.stdout.strip() else r.stderr.strip()[-120:]
        sagen(ist == str(erwartet), f"RZ_GC_BILDER={wert or '(leer)'} ergibt {erwartet}", f"ist {ist}")


def main() -> int:
    quelltext_faelle()
    env_faelle()
    asyncio.run(browser_faelle())
    print("\nALLES GRÜN" if not fehler else f"\n{fehler} FEHLER")
    return 1 if fehler else 0


if __name__ == "__main__":
    sys.exit(main())
