#!/usr/bin/env python3
"""Startet eine Testdatei mit gestreckten festen Wartezeiten der Browser-Tests (23.10.2026).

Marc: „Das müsste doch einfach nur langsam und fertig werden, oder nicht?" — Viele UI-Tests warten eine FESTE Zeit
(`page.wait_for_timeout(400)`) und prüfen dann. Rendert nebenher Blender auf derselben Grafikkarte, ist die Oberfläche
nach 400 ms noch nicht so weit, und der Test meldet einen Fehler, den es nicht gibt. `scripts/run_tests.py` misst vor
jedem Test die Fremdlast und setzt `RZ_TEST_TEMPO` (1 = normal); hier wird jede feste Wartezeit von Playwright mit
diesem Faktor gestreckt — die Tests werden langsamer statt rot. Die Testdatei selbst läuft unverändert.

Aufruf: test_tempo_start.py <testdatei> [argumente …]
"""
import os
import runpy
import sys


def _strecken(faktor: float) -> None:
    try:
        from playwright.async_api import Page as APage
        from playwright.sync_api import Page as SPage
    except Exception:  # noqa: BLE001 — Test ohne Playwright
        return
    a_orig, s_orig = APage.wait_for_timeout, SPage.wait_for_timeout

    def lang(t: float) -> float:
        # Kurze Pausen sind Takt (Mausrad-Rasten 150 ms, Ziehen in 16-ms-Schritten) — die bleiben, sonst wird aus einer
        # schnellen Geste zwei. Längere Pausen wachsen um höchstens 2 s: die App blendet Hinweise nach ein paar Sekunden
        # wieder aus, ein zu langes Warten verpasste sie.
        t = float(t)
        return t if t < 300 else min(t * faktor, t + 2000)

    async def a_warten(self, timeout):
        return await a_orig(self, lang(timeout))

    def s_warten(self, timeout):
        return s_orig(self, lang(timeout))

    APage.wait_for_timeout = a_warten
    SPage.wait_for_timeout = s_warten


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    try:
        faktor = max(1.0, min(5.0, float(os.environ.get("RZ_TEST_TEMPO", "1") or 1)))
    except ValueError:
        faktor = 1.0
    if faktor > 1.0:
        _strecken(faktor)
    datei = sys.argv[1]
    sys.argv = sys.argv[1:]                     # der Test sieht sich selbst als argv[0]
    sys.path.insert(0, os.path.dirname(os.path.abspath(datei)))
    runpy.run_path(datei, run_name="__main__")


if __name__ == "__main__":
    main()
