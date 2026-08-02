#!/usr/bin/env python3
"""Archiv: gemerkte Filterleiste + der Umgang mit Dateien ohne Strecke.

Zwei Meldungen eines Beta-Testers, beide hier festgenagelt:

1. „Wenn man nach Längste zuerst filtert, eine Datei im Animator anschaut und
   dann zurück geht ins Archiv, springt er auf Neueste zuerst."
   → Das Archiv wird bei jedem Betreten neu gebaut. Geprüft wird deshalb der
   echte Weg: Sortierung setzen, Modul wechseln, zurück — steht sie noch?

2. „Es werden 61 Daten als nicht lesbar angezeigt. Die werden mir auch
   angezeigt, man kann sie aber nicht löschen."
   → Geprüft wird die Beschriftung (sind alle nur ohne GPS, darf da nicht
   „nicht lesbar" stehen) und dass „Aus der Liste nehmen" beim Backend ankommt.

Läuft headless mit gemockter `pywebview.api` — kein echtes Archiv, kein Netz.

Aufruf:  .venv/bin/python scripts/selftest_library_state.py
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "scripts"))

from selftest_ui import MOCK_API_JS, UI_INDEX   # noqa: E402

fehler = 0


def sagen(ok: bool, text: str, zusatz: str = "") -> None:
    global fehler
    print(f"  [{'OK  ' if ok else 'FAIL'}] {text}" + (f"  {zusatz}" if zusatz else ""))
    if not ok:
        fehler += 1


# Die Fehler-Bridges, die es im Standard-Mock noch nicht gibt, plus eine
# Mitschrift der Aufrufe — daran hängt die Prüfung, ob der Knopf wirklich etwas
# tut statt nur gut auszusehen.
EXTRA_MOCK = r"""
(() => {
  window.__rufe = [];
  const FEHLER = [
    { path: "/m/halle1.fit", filename: "halle1.fit", error_kind: "no_points",
      error: "Keine Track-Punkte in der Datei gefunden.", hidden: 0 },
    { path: "/m/halle2.fit", filename: "halle2.fit", error_kind: "no_points",
      error: "Keine Track-Punkte in der Datei gefunden.", hidden: 0 },
    { path: "/m/kaputt.fit", filename: "kaputt.fit", error_kind: "broken",
      error: "not a FIT file @ 0", hidden: 0 },
  ];
  window.__nurOhneStrecke = false;   // vom Test umgeschaltet
  const echt = window.pywebview.api;
  const patch = {
    library_errors: async (mitWeg) => {
      window.__rufe.push(["library_errors", mitWeg]);
      return { ok: true, items: window.__nurOhneStrecke
        ? FEHLER.filter(f => f.error_kind === "no_points") : FEHLER };
    },
    library_dismiss_errors: async (paths, weg) => {
      window.__rufe.push(["library_dismiss_errors", paths, weg]);
      return { ok: true, n: (paths || []).length };
    },
    library_stats: async (...a) => {
      const s = await echt.library_stats(...a);
      const n = window.__nurOhneStrecke ? 2 : 3;
      return Object.assign(s, { n_failed: n, n_nogps: window.__nurOhneStrecke ? 2 : 2 });
    },
  };
  window.pywebview = { api: new Proxy(echt, {
    get(t, p) { return (p in patch) ? patch[p] : t[p]; },
  }) };
})();
"""


async def main() -> int:
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1500, "height": 950})
        page = await ctx.new_page()
        seiten_fehler: list = []
        page.on("pageerror", lambda e: seiten_fehler.append(str(e)[:300]))

        await page.add_init_script(MOCK_API_JS)
        await page.add_init_script(EXTRA_MOCK)
        await page.goto(f"file://{UI_INDEX.resolve()}", wait_until="domcontentloaded")
        await page.wait_for_timeout(1800)

        async def zu(mod: str) -> None:
            tab = await page.query_selector(f'[data-mod="{mod}"]')
            if tab:
                await tab.click()
            await page.wait_for_timeout(1200)

        # ── 1) Sortierung überlebt den Modulwechsel ───────────────────────
        print("\n[1] Die Filterleiste überlebt den Modulwechsel")
        await page.evaluate("() => { try { localStorage.clear(); } catch (_) {} }")
        await zu("library")
        sagen(await page.evaluate("() => !!document.getElementById('lib-sort')"),
              "das Archiv ist offen")
        vorher = await page.evaluate("() => document.getElementById('lib-sort').value")
        sagen(vorher == "date_desc", "Voreinstellung ist „Neueste zuerst“", vorher)

        await page.select_option("#lib-sort", "dist_desc")
        await page.wait_for_timeout(700)

        await zu("animator")
        await zu("library")
        nachher = await page.evaluate(
            "() => document.getElementById('lib-sort') && document.getElementById('lib-sort').value")
        sagen(nachher == "dist_desc",
              "nach Animator und zurück steht immer noch „Längste zuerst“",
              f"→ {nachher}")

        # Zurücksetzen muss den gemerkten Wert auch wirklich löschen.
        await page.click("#lib-reset")
        await page.wait_for_timeout(500)
        await zu("animator")
        await zu("library")
        nach_reset = await page.evaluate(
            "() => document.getElementById('lib-sort') && document.getElementById('lib-sort').value")
        sagen(nach_reset == "date_desc", "„Zurücksetzen“ vergisst die Sortierung auch dauerhaft",
              f"→ {nach_reset}")

        # ── 2) Beschriftung: alles ohne GPS ≠ „nicht lesbar" ──────────────
        print("\n[2] Dateien ohne Strecke heißen nicht „nicht lesbar“")
        await page.evaluate("() => { window.__nurOhneStrecke = true; }")
        await zu("animator")
        await zu("library")
        await page.wait_for_timeout(900)
        text = await page.evaluate(
            "() => { const b = document.getElementById('lib-show-errors'); return b ? b.textContent.trim() : ''; }")
        sagen("ohne Strecke" in text, "der Knopf sagt „ohne Strecke“", f"→ {text!r}")
        sagen("nicht lesbar" not in text, "und eben nicht „nicht lesbar“", f"→ {text!r}")

        await page.evaluate("() => { window.__nurOhneStrecke = false; }")
        await zu("animator")
        await zu("library")
        await page.wait_for_timeout(900)
        text2 = await page.evaluate(
            "() => { const b = document.getElementById('lib-show-errors'); return b ? b.textContent.trim() : ''; }")
        sagen("nicht lesbar" in text2, "ist wirklich etwas kaputt, steht das auch da", f"→ {text2!r}")

        # ── 3) Aus der Liste nehmen ──────────────────────────────────────
        print("\n[3] „Aus der Liste nehmen“ kommt hinten an")
        await page.click("#lib-show-errors")
        await page.wait_for_timeout(700)
        n_boxen = await page.evaluate("() => document.querySelectorAll('.lib-err-cb').length")
        sagen(n_boxen == 3, "alle drei stehen mit Auswahlkästchen da", f"→ {n_boxen}")

        gruppen = await page.evaluate(
            "() => Array.from(document.querySelectorAll('.lib-dupe-head')).map(e => e.textContent.trim())")
        sagen(any("ohne Streckendaten" in g for g in gruppen)
              and any("nicht lesbar" in g for g in gruppen),
              "beide Gruppen getrennt überschrieben", str(gruppen))

        aus = await page.evaluate(
            "() => { const b = document.getElementById('lib-err-go'); return b ? b.disabled : null; }")
        sagen(aus is True, "ohne Auswahl ist der Knopf aus")

        await page.click("#lib-err-all")
        await page.wait_for_timeout(300)
        an = await page.evaluate("() => document.getElementById('lib-err-go').disabled")
        sagen(an is False, "nach „Alle auswählen“ ist er an")

        await page.click("#lib-err-go")
        await page.wait_for_timeout(900)
        ruf = await page.evaluate("""() => {
          const r = (window.__rufe || []).filter(x => x[0] === 'library_dismiss_errors');
          return r.length ? r[r.length - 1] : null; }""")
        sagen(bool(ruf), "library_dismiss_errors wurde gerufen", str(ruf))
        if ruf:
            sagen(len(ruf[1]) == 3, "mit allen drei Pfaden", str(ruf[1]))
            sagen(ruf[2] is True, "und mit „wegräumen“, nicht „zurückholen“")

        # ── 4) „Auch weggeräumte zeigen" fragt neu an ────────────────────
        print("\n[4] „Auch weggeräumte zeigen“")
        await page.wait_for_timeout(400)
        hat = await page.evaluate("() => !!document.getElementById('lib-err-showall')")
        if hat:
            await page.click("#lib-err-showall")
            await page.wait_for_timeout(700)
            letzte = await page.evaluate("""() => {
              const r = (window.__rufe || []).filter(x => x[0] === 'library_errors');
              return r.length ? r[r.length - 1][1] : null; }""")
            sagen(letzte is True, "die Liste wird mit „auch weggeräumte“ neu geholt", str(letzte))
        else:
            sagen(False, "das Kästchen „Auch weggeräumte zeigen“ ist da")

        sagen(not seiten_fehler, "keine JS-Fehler unterwegs",
              "; ".join(seiten_fehler[:2]))

        await browser.close()

    print("\n" + ("ALLE TESTS OK" if not fehler else f"{fehler} FEHLER"))
    return 1 if fehler else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
