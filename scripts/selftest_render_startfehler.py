#!/usr/bin/env python3
"""Regressions-Test: der Szenen-Render startet nicht mehr mit einem falschen Startfehler-Overlay.

Bug: Jede Seite des Szenen-Renders (Render-Seite und Vorläufer) hängt nach dem Laden den Kachel-Zwischenspeicher
ein (`_install_tile_cache`). Das räumte ihn SYNCHRON im Ereignisschleifen-Faden auf (`_tile_cache_prune`): bei
vielen Dateien viele Sekunden, in denen Python keine Anfrage der Seite bediente. Nach 25 s zeigte der Wächter
in ui/index.html das Vollbild-Overlay `#rz-start-error` („Zeitüberschreitung beim Laden"). Die App startete
darunter trotzdem fertig, der Render lief durch und nahm die Fehlerseite in jedes Bild auf.

Abhilfe: das Aufräumen läuft in einem Hintergrund-Thread (nur eines zugleich), der Wächter bleibt im
Render-Modus (`window.__rzRenderMode`) still, und `core.szene._startfehler_pruefen` bricht ab, falls das Overlay
trotzdem erscheint.

Geprüft (offline, ohne App und ohne Render):
  A  `_install_tile_cache` kehrt sofort zurück, auch wenn das Aufräumen lange dauert
  B  zwei gleichzeitige Aufrufe starten das Aufräumen nur einmal
  C  der Wächter löst im Render-Modus nicht aus (ohne Render-Modus schon)
  D  `_startfehler_pruefen` wirft bei vorhandenem Overlay, sonst nicht; `_seite_vorbereiten` ruft sie auf

Aufruf:  .venv/bin/python scripts/selftest_render_startfehler.py
Exit 0 = alles grün · Exit 1 = mindestens ein Fall rot.
"""
from __future__ import annotations

import ast
import asyncio
import sys
import tempfile
import time
from pathlib import Path
from types import SimpleNamespace

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

fehler = 0


def sagen(ok: bool, text: str, zusatz: str = "") -> None:
    global fehler
    print(f"  [{'OK  ' if ok else 'FAIL'}] {text}" + (f"  {zusatz}" if zusatz else ""))
    if not ok:
        fehler += 1


class FakeSeite:
    """Nur das, was `_install_tile_cache` von der Seite braucht."""

    async def route(self, muster, handler):
        self.handler = handler


async def prune_faelle() -> None:
    from core import animator as A

    cfg = SimpleNamespace(transparent_background=False)
    aufrufe = []

    def langsam(max_mb):
        aufrufe.append(time.monotonic())
        time.sleep(3)

    orig_prune, orig_dir = A._tile_cache_prune, A.TILE_CACHE_DIR
    with tempfile.TemporaryDirectory() as tmp:
        A._tile_cache_prune = langsam
        A.TILE_CACHE_DIR = Path(tmp)
        try:
            print("\nFall A: Aufräumen blockiert nicht")
            t0 = time.monotonic()
            await A._install_tile_cache(FakeSeite(), cfg)
            dauer = time.monotonic() - t0
            sagen(dauer < 0.5, "kehrt sofort zurück", f"{dauer:.2f} s")
            await asyncio.sleep(0.3)
            sagen(len(aufrufe) == 1, "Aufräumen läuft im Hintergrund an", f"{len(aufrufe)} Start")

            print("\nFall B: nur ein Aufräumen zugleich")
            await asyncio.sleep(3.2)        # das erste Aufräumen abwarten
            aufrufe.clear()
            await asyncio.gather(A._install_tile_cache(FakeSeite(), cfg), A._install_tile_cache(FakeSeite(), cfg))
            await asyncio.sleep(0.5)
            sagen(len(aufrufe) == 1, "zwei gleichzeitige Seiten starten es einmal", f"{len(aufrufe)} Starts")
            await asyncio.sleep(3.2)
        finally:
            A._tile_cache_prune, A.TILE_CACHE_DIR = orig_prune, orig_dir


async def browser_faelle() -> None:
    from playwright.async_api import async_playwright
    from core import szene

    index = (REPO / "ui" / "index.html").resolve().as_uri()
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        try:
            print("\nFall C: Wächter im Render-Modus")
            for render, erwartet in ((False, True), (True, False)):
                page = await browser.new_page()
                await page.clock.install()
                if render:
                    await page.add_init_script("window.__rzRenderMode = {}")
                await page.goto(index, wait_until="domcontentloaded")
                await page.clock.run_for(30000)
                fehlerliste = await page.evaluate("() => window.__rzStartErrors || []")
                ausgeloest = any("Zeitüberschreitung beim Laden" in str(e) for e in fehlerliste)
                name = "mit Render-Modus" if render else "ohne Render-Modus"
                sagen(ausgeloest == erwartet, f"{name}: Wächter {'löst aus' if erwartet else 'bleibt still'}",
                      f"Einträge: {len(fehlerliste)}")
                await page.close()

            print("\nFall D: Overlay-Prüfung")
            page = await browser.new_page()
            await page.set_content("<body><p>ok</p></body>")
            try:
                await szene._startfehler_pruefen(page)
                sagen(True, "ohne Overlay: keine Ausnahme")
            except Exception as e:      # noqa: BLE001
                sagen(False, "ohne Overlay: keine Ausnahme", repr(e)[:120])
            await page.set_content("<body><div id='rz-start-error'>x</div>"
                                   "<script>window.__rzStartErrors = ['Zeitüberschreitung beim Laden | 25 s'];</script></body>")
            try:
                await szene._startfehler_pruefen(page)
                sagen(False, "mit Overlay: RuntimeError")
            except RuntimeError as e:
                sagen("Zeitüberschreitung" in str(e), "mit Overlay: RuntimeError mit Fehlertext", str(e)[:100])
            except Exception as e:      # noqa: BLE001
                sagen(False, "mit Overlay: RuntimeError", repr(e)[:120])
            await page.close()
        finally:
            await browser.close()


def quelltext_faelle() -> None:
    baum = ast.parse((REPO / "core" / "szene.py").read_text(encoding="utf-8"))
    rufer = set()
    for knoten in ast.walk(baum):
        if isinstance(knoten, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for k in ast.walk(knoten):
                if isinstance(k, ast.Call) and getattr(k.func, "id", None) == "_startfehler_pruefen":
                    rufer.add(knoten.name)
    sagen("_seite_vorbereiten" in rufer, "_seite_vorbereiten ruft die Prüfung auf", f"Aufrufer: {sorted(rufer)}")


def main() -> int:
    asyncio.run(prune_faelle())
    asyncio.run(browser_faelle())
    print("\nFall D (Quelltext)")
    quelltext_faelle()
    print("\nALLES GRÜN" if not fehler else f"\n{fehler} FEHLER")
    return 1 if fehler else 0


if __name__ == "__main__":
    sys.exit(main())
