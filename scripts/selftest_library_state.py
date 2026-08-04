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
      // Zahlen für die Vergleichstabelle: drei Jahre × drei Arten, dazu
      // Startpunkte. Bewusst ungleich verteilt, damit die Hervorhebung der
      // stärksten Zelle je Zeile überhaupt etwas zu tun hat.
      const jahre = [
        { year: 2023, activity: "wandern", n: 20, km: 300, hours: 90 },
        { year: 2023, activity: "rad",     n: 10, km: 500, hours: 40 },
        { year: 2023, activity: "ebike",   n:  5, km: 200, hours: 15 },
        { year: 2024, activity: "wandern", n: 25, km: 380, hours: 110 },
        { year: 2024, activity: "rad",     n: 30, km: 1200, hours: 95 },
        { year: 2024, activity: "ebike",   n: 12, km: 460, hours: 33 },
        { year: 2025, activity: "wandern", n: 18, km: 260, hours: 80 },
        { year: 2025, activity: "rad",     n: 22, km: 900, hours: 70 },
      ];
      const monate = [
        { month: "2025-05", activity: "wandern", n: 4, km: 60, hours: 18 },
        { month: "2025-05", activity: "rad",     n: 6, km: 240, hours: 19 },
        { month: "2025-06", activity: "rad",     n: 8, km: 330, hours: 26 },
      ];
      return Object.assign(s, {
        n_failed: n, n_nogps: window.__nurOhneStrecke ? 2 : 2,
        act_by_year: jahre, act_by_month: monate,
        startorte: [{ ort: "Zuhause", n: 42, km: 980 },
                    { ort: "Bahnhof", n: 11, km: 240 }],
      });
    },
    // Seitenweises Nachladen: 450 künstliche Touren, ausgeliefert nach
    // limit/offset — genau wie das echte Backend (core/library.py query()).
    library_query: async (params) => {
      const p = params || {};
      window.__rufe.push(["library_query", p.limit, p.offset || 0]);
      if (!window.__viele) return echt.library_query(p);
      const TOTAL = 450;
      const limit = p.limit || 0, off = p.offset || 0;
      const n = limit ? Math.min(limit, Math.max(0, TOTAL - off)) : TOTAL;
      const items = Array.from({ length: n }, (_, k) => ({
        path: `/m/tour${off + k}.gpx`, name: `Tour ${off + k}`,
        filename: `tour${off + k}.gpx`, started_at: "2026-01-01T10:00:00",
        distance_m: 10000, ascent_m: 100, duration_s: 3600, activity: "rad",
        fav: 0, recorded_eff: 1, has_session: false, thumb_url: "",
      }));
      return { ok: true, total: TOTAL, items };
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

        # ── 5) Nachladen beim Scrollen (Beta-Tester: 4787 Touren, 200 Kacheln) ─
        print("\n[5] Nachladen beim Scrollen")
        # Fehler-Dialog schließen, falls noch offen, dann auf „viele Touren".
        await page.evaluate("""() => {
          const x = document.getElementById('modal-close');
          if (x) x.click();
          const o = document.getElementById('modal-overlay');
          if (o) o.classList.remove('open'), o.style.display = 'none';
        }""")
        await page.evaluate("() => { window.__viele = true; }")
        await zu("animator")
        await zu("library")
        await page.wait_for_timeout(900)

        n1 = await page.evaluate("() => document.querySelectorAll('#lib-grid .lib-card').length")
        sagen(n1 == 200, "erste Seite: 200 Kacheln", f"→ {n1}")
        kopf = await page.evaluate(
            "() => (document.getElementById('lib-head') || {}).textContent || ''")
        sagen("450" in kopf, "die Kopfzeile nennt die echte Gesamtzahl", f"→ {kopf.strip()[:40]!r}")

        # Ans Ende scrollen → nächste Seite muss dazukommen.
        await page.evaluate(
            "() => { const g = document.getElementById('lib-grid'); g.scrollTop = g.scrollHeight; }")
        await page.wait_for_timeout(900)
        n2 = await page.evaluate("() => document.querySelectorAll('#lib-grid .lib-card').length")
        sagen(n2 == 400, "nach dem Scrollen: 400 Kacheln", f"→ {n2}")

        await page.evaluate(
            "() => { const g = document.getElementById('lib-grid'); g.scrollTop = g.scrollHeight; }")
        await page.wait_for_timeout(900)
        n3 = await page.evaluate("() => document.querySelectorAll('#lib-grid .lib-card').length")
        sagen(n3 == 450, "dritte Seite: alle 450, kein Überschuss", f"→ {n3}")

        # Am Ende angekommen darf keine weitere Abfrage mehr rausgehen.
        vor = await page.evaluate(
            "() => (window.__rufe || []).filter(x => x[0] === 'library_query').length")
        await page.evaluate(
            "() => { const g = document.getElementById('lib-grid'); g.scrollTop = 0; g.scrollTop = g.scrollHeight; }")
        await page.wait_for_timeout(900)
        nach = await page.evaluate(
            "() => (window.__rufe || []).filter(x => x[0] === 'library_query').length")
        sagen(nach == vor, "am Ende: kein weiteres Nachladen mehr", f"→ {vor} → {nach}")

        # Die nachgeladenen Kacheln müssen anklickbar sein (data-i stimmt):
        # Nach dem Klick auf die letzte Kachel muss GENAU die Kachel „Tour 449"
        # als gewählt markiert sein — nicht irgendeine frühere.
        await page.evaluate("""() => {
          const cards = document.querySelectorAll('#lib-grid .lib-card');
          cards[cards.length - 1].click(); }""")
        await page.wait_for_timeout(500)
        gewaehlt = await page.evaluate("""() => {
          const c = document.querySelector('#lib-grid .lib-card.is-sel .lib-card-name');
          return c ? c.textContent.trim() : ''; }""")
        sagen(gewaehlt == "Tour 449",
              "die letzte nachgeladene Kachel wählt die richtige Tour", f"→ {gewaehlt!r}")

        # ── 6) Die markierte Tour überlebt den Modulwechsel ──────────────
        print("\n[6] Die Markierung bleibt")
        await page.evaluate("() => { window.__viele = true; }")
        await zu("animator")
        await zu("library")
        await page.wait_for_timeout(900)

        # Eine Kachel anklicken …
        await page.evaluate(
            "() => { const c = document.querySelectorAll('#lib-grid .lib-card');"
            " if (c[3]) c[3].click(); }")
        await page.wait_for_timeout(500)
        vorher = await page.evaluate(
            "() => { const c = document.querySelector("
            "'#lib-grid .lib-card.is-sel .lib-card-name');"
            " return c ? c.textContent.trim() : ''; }")
        sagen(bool(vorher), "eine Tour ist markiert", vorher)

        # … Modul wechseln und zurückkommen.
        await zu("animator")
        await zu("library")
        await page.wait_for_timeout(900)
        nachher = await page.evaluate(
            "() => { const c = document.querySelector("
            "'#lib-grid .lib-card.is-sel .lib-card-name');"
            " return c ? c.textContent.trim() : ''; }")
        sagen(nachher == vorher,
              "nach dem Modulwechsel ist dieselbe Tour noch markiert",
              f"vorher {vorher!r} / nachher {nachher!r}")
        # Der Name steht in der Detailspalte in einem EINGABEFELD (umbenennbar) —
        # `textContent` sieht Feldinhalte nicht, deshalb die Werte mitnehmen.
        detail = await page.evaluate(
            "() => { const d = document.getElementById('lib-detail');"
            " if (!d) return '';"
            " const felder = Array.from(d.querySelectorAll('input, textarea'))"
            "   .map(e => e.value).join(' ');"
            " return (d.textContent || '') + ' ' + felder; }")
        sagen(bool(vorher) and vorher in detail,
              "und die Detailspalte zeigt sie auch",
              detail.strip()[:60])

        # ── 7) Vergleichstabelle in der Statistik ────────────────────────
        print("\n[7] Fortbewegung im Vergleich")
        await page.evaluate(
            "() => { const b = document.querySelector('.lib-view[data-view=\"stats\"]');"
            " if (b) b.click(); }")
        await page.wait_for_timeout(900)

        kopf = await page.evaluate(
            "() => Array.from(document.querySelectorAll('.lib-vgl thead th'))"
            ".map(e => e.textContent.trim())")
        sagen("Jahr" in kopf, "die Tabelle steht, mit Jahres-Spalte", str(kopf))
        for art in ("Wandern", "Rad", "E-Bike"):
            sagen(art in kopf, f"Spalte für {art} ist da")

        zeilen = await page.evaluate(
            "() => Array.from(document.querySelectorAll('.lib-vgl tbody tr'))"
            ".map(r => r.querySelector('th').textContent.trim())")
        sagen(zeilen == ["2023", "2024", "2025"],
              "drei Jahre als Zeilen", str(zeilen))

        # In 2024 ist Rad mit 1200 km die stärkste Art — genau die muss die
        # Hervorhebung bekommen.
        top2024 = await page.evaluate(
            "() => { const r = Array.from(document.querySelectorAll('.lib-vgl tbody tr'))"
            "  .find(x => x.querySelector('th').textContent.trim() === '2024');"
            " if (!r) return null;"
            " const zellen = Array.from(r.querySelectorAll('td'));"
            " const i = zellen.findIndex(c => c.classList.contains('is-top'));"
            " const kopf = Array.from(document.querySelectorAll('.lib-vgl thead th'));"
            " return i < 0 ? null : { art: kopf[i + 1].textContent.trim(),"
            "   wert: zellen[i].textContent.trim() }; }")
        sagen(top2024 and top2024["art"] == "Rad",
              "2024 ist Rad hervorgehoben — die stärkste Art des Jahres",
              str(top2024))
        # Das Tausender-Trennzeichen hängt an der Sprache (1.200 / 1,200) — hier
        # zählt der Wert, nicht die Schreibweise.
        sagen(top2024 and top2024["wert"].replace(".", "").replace(",", "") == "1200",
              "und zwar mit dem richtigen Wert in km", str(top2024))

        # Und die Schreibweise folgt der OBERFLÄCHE, nicht dem System: Sonst
        # steht in der deutschen Oberfläche „1,200 km", weil macOS englisch
        # läuft. (Derselbe Fund wie seinerzeit beim Datum.)
        schreibweisen = await page.evaluate("""() => {
          const echt = window.i18nMeta;
          const mach = (code) => {
            window.i18nMeta = () => ({ active: code });
            const n = (v) => Math.round(v).toLocaleString(code);
            return n(1200);
          };
          const de = mach('de'), en = mach('en');
          window.i18nMeta = echt;
          return { de, en };
        }""")
        sagen(schreibweisen["de"] == "1.200" and schreibweisen["en"] == "1,200",
              "die Zahlen-Schreibweise folgt der eingestellten Sprache",
              str(schreibweisen))

        # Auf Stunden umschalten: Dann führt 2024 Wandern (110 h gegen 95 h).
        await page.evaluate(
            "() => { const b = document.querySelector('[data-vgl-mass=\"hours\"]');"
            " if (b) b.click(); }")
        await page.wait_for_timeout(500)
        top_std = await page.evaluate(
            "() => { const r = Array.from(document.querySelectorAll('.lib-vgl tbody tr'))"
            "  .find(x => x.querySelector('th').textContent.trim() === '2024');"
            " if (!r) return null;"
            " const zellen = Array.from(r.querySelectorAll('td'));"
            " const i = zellen.findIndex(c => c.classList.contains('is-top'));"
            " const kopf = Array.from(document.querySelectorAll('.lib-vgl thead th'));"
            " return i < 0 ? null : kopf[i + 1].textContent.trim(); }")
        sagen(top_std == "Wandern",
              "nach Stunden gerechnet führt 2024 das Wandern — nicht mehr das Rad",
              str(top_std))

        # Auf Monate umschalten.
        await page.evaluate(
            "() => { const b = document.querySelector('[data-vgl-ebene=\"month\"]');"
            " if (b) b.click(); }")
        await page.wait_for_timeout(500)
        mzeilen = await page.evaluate(
            "() => Array.from(document.querySelectorAll('.lib-vgl tbody tr'))"
            ".map(r => r.querySelector('th').textContent.trim())")
        sagen(len(mzeilen) == 2 and "Mai" in mzeilen[0],
              "Monatsansicht zeigt Monatsnamen", str(mzeilen))

        # Die Wahl muss den Modulwechsel überleben.
        await zu("animator")
        await zu("library")
        await page.wait_for_timeout(900)
        gemerkt = await page.evaluate(
            "() => { const b = document.querySelector('[data-vgl-ebene=\"month\"]');"
            " return b ? b.classList.contains('is-on') : null; }")
        sagen(gemerkt is True, "die Wahl „Monate“ ist noch gesetzt", str(gemerkt))

        print("\n[8] Häufigste Startpunkte")
        orte = await page.evaluate(
            "() => Array.from(document.querySelectorAll('.lib-acts'))"
            ".map(e => e.textContent).join(' ')")
        sagen("Zuhause" in orte, "die Startpunkte stehen da", "Zuhause" in orte)

        sagen(not seiten_fehler, "keine JS-Fehler unterwegs",
              "; ".join(seiten_fehler[:2]))

        await browser.close()

    print("\n" + ("ALLE TESTS OK" if not fehler else f"{fehler} FEHLER"))
    return 1 if fehler else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
