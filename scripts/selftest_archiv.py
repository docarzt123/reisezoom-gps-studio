#!/usr/bin/env python3
"""Tour-Archiv im echten Browser — Sortierung, FIT-Werte, Fehler-Dialog.

Der Anlass
----------
Drei Meldungen eines Beta-Testers mit knapp 5000 Touren und fast 99000 nicht
lesbaren Dateien:

  * „Sortieren nach: Wenn man in der Liste auf die einzelnen Überschriften
    Name, Datum usw. klickt" — die Kopfzeile war reine Beschriftung. Und das
    Auswahlfeld kannte weder Schnitt noch Startpunkt noch Schlagwort.
  * „Wenn man auf Dateien nicht lesbar klickt passiert nichts und man kann das
    Programm auch nicht mehr bedienen. … Nach einer Zeit öffnet sich doch ein
    Fenster." — der Dialog baute eine Zeile je Datei, also 98692 Zeilen mit
    Auswahlkästchen.
  * „Die Fit Datei beinhaltet noch viel mehr Daten die man auslesen kann.“

Warum im Browser und nicht im Speicher
--------------------------------------
Genau diese Fehlerklasse entsteht ZWISCHEN den Schichten: das Backend liefert
richtig, die Oberfläche fragt falsch — oder umgekehrt. Beim OK-Knopf war es
zuletzt genau so; ein Test auf dem Zustand im Speicher hätte ihn nicht gesehen.

Aufruf:  .venv/bin/python scripts/selftest_archiv.py
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "scripts"))

from selftest_ui import MOCK_API_JS, UI_INDEX   # noqa: E402

# Der Standard-Mock kennt `i18n_get_strings` nicht — die Oberfläche lief im
# Test deshalb IMMER auf den englischen Rückfalltexten im Code, und ein
# fehlender Übersetzungs-Schlüssel wäre nie aufgefallen. Hier kommt die echte
# deutsche Sprachdatei rein, damit der Test das prüft, was der Nutzer sieht.
_DE = json.loads((REPO / "i18n/de.json").read_text(encoding="utf-8"))
I18N_MOCK_JS = (
    "(() => { const s = " + json.dumps(_DE, ensure_ascii=False) + ";"
    " window.__rzI18n = { ok: true, strings: s, active: \"de\","
    " requested: \"de\", system_locale: \"de\", available: [\"de\"] }; })();"
)

fehler = 0


def sagen(ok: bool, text: str, zusatz: str = "") -> None:
    global fehler
    print(f"  [{'OK  ' if ok else 'FAIL'}] {text}" + (f"  {zusatz}" if zusatz else ""))
    if not ok:
        fehler += 1


# Ein zweites Init-Skript legt sich ÜBER die Standard-Mocks. Es merkt sich jeden
# Aufruf, damit der Test prüfen kann, was die Oberfläche wirklich ans Backend
# schickt — nicht nur, was danach auf dem Bildschirm steht.
ARCHIV_MOCK_JS = r"""
(() => {
  const warten = () => new Promise(r => setTimeout(r, 0));
  window.__ruf = [];
  const merken = (name, args) => window.__ruf.push({ name, args });

  const TOUREN = [];
  const ARTEN = ["rad", "wandern", "mtb", "rennrad", "gravel", "ebike"];
  for (let i = 0; i < 6; i++) {
    TOUREN.push({
      path: `/mock/t${i}.fit`, filename: `t${i}.fit`, name: `Tour ${"FEDCBA"[i]}`,
      started_at: `202${i}-05-0${i + 1}T08:00:00+00:00`,
      distance_m: (6 - i) * 10000, distance_km: (6 - i) * 10,
      duration_s: (i + 1) * 3600, moving_time_s: (i + 1) * 3500,
      ascent_m: i * 150, avg_speed_kmh: 30 - i * 3,
      activity: ARTEN[i], fit_profile: i % 2 ? "Gravel" : "",
      startort: i % 3 ? `Ort ${i}` : "", startort_lang: "",
      n_points: 500, n_segments: 1, planned: 0, recorded_eff: 1,
      recorded_manual: false, recorded_src: "sensors", fav: 0,
      tags: i % 2 ? "test" : "", tag_list: i % 2 ? ["test"] : [],
      note: "", exists: true, thumb_url: "", has_session: false, error: "",
      cover: "", image_kind: "line", hidden: 0, renamed: false,
      file_name: `Tour ${"FEDCBA"[i]}`,
    });
  }

  const echt = window.pywebview.api;
  const eigene = {
    i18n_get_strings: async () => window.__rzI18n,
    // Ohne `n_failed` baut das Archiv den Knopf „Dateien nicht lesbar" gar
    // nicht erst — dann prüfte der Test einen Klick ins Leere.
    library_stats: async () => ({ ok: true, n_tracks: 6, total_km: 210,
      total_ascent_m: 2250, total_descent_m: 2200, total_hours: 21,
      avg_km: 35, longest_km: 60, year_min: 2020, year_max: 2025,
      years: [], months: [], activities: [], act_by_year: [], act_by_month: [],
      startorte: [], longest: [], tags: [],
      done: { n: 6, km: 210 }, planned: { n: 0, km: 0 },
      n_fav: 0, n_hidden: 0, n_missing: 0,
      n_failed: 98692, n_nogps: 61 }),
    library_query: async (opts) => {
      merken("library_query", opts);
      return { ok: true, total: TOUREN.length, items: TOUREN };
    },
    // Die Detailspalte lädt genau hier die FIT-Werte nach.
    library_get_track: async (pfad) => {
      merken("library_get_track", pfad);
      return { ok: true, track: {
        activity_user: "",
        fit_raw_n: 48,
        fit_fields: [
          { key: "session.avg_heart_rate", label: "Ø Puls", unit: "bpm", value: 116 },
          { key: "session.total_calories", label: "Kalorien", unit: "kcal", value: 812 },
          { key: "sport.name", label: "Profil", unit: "", value: "Gravel" },
          // Kennwerte aus der Datei — die Oberflaeche muss sie uebersetzen,
          // sonst steht in einer deutschen Ansicht „Unterart: gravel_cycling".
          { key: "sport.sport", label: "Sportart", unit: "", value: "cycling", code: true },
          { key: "sport.sub_sport", label: "Unterart", unit: "", value: "gravel_cycling", code: true },
          // Kein Eintrag in der Sprachdatei — muss trotzdem lesbar herauskommen.
          { key: "device_info.manufacturer", label: "Hersteller", unit: "", value: "wahoo_fitness", code: true },
        ],
      }};
    },
    // 98692 Fehler wie beim Beta-Tester — die Zahl kommt aus einer Zählabfrage,
    // die Liste ist gedeckelt.
    library_errors_count: async (m) => {
      merken("library_errors_count", m);
      return { gesamt: 98692, ohne_strecke: 61, kaputt: 98631 };
    },
    library_errors: async (m) => {
      merken("library_errors", m);
      const items = [];
      for (let i = 0; i < 300; i++) {
        items.push({ path: `/mock/kaputt${i}.json`, filename: `kaputt${i}.json`,
                     error: "Unbekanntes Track-Format",
                     error_kind: i < 61 ? "no_points" : "broken" });
      }
      return { ok: true, items };
    },
    library_dismiss_all_errors: async (art) => {
      merken("library_dismiss_all_errors", art);
      return { ok: true, n: art === "no_points" ? 61 : 98631 };
    },
  };
  window.pywebview.api = new Proxy(eigene, {
    get: (ziel, name) => (name in ziel) ? ziel[name] : echt[name],
  });
})();
"""


async def main() -> int:
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1600, "height": 1000})
        page = await ctx.new_page()
        seiten_fehler: list = []
        page.on("pageerror", lambda e: seiten_fehler.append(str(e)[:300]))

        await page.add_init_script(MOCK_API_JS)
        await page.add_init_script(I18N_MOCK_JS)
        await page.add_init_script(ARCHIV_MOCK_JS)
        await page.goto(f"file://{UI_INDEX.resolve()}", wait_until="domcontentloaded")
        await page.wait_for_timeout(1800)

        tab = await page.query_selector('[data-mod="library"]')
        if not tab:
            print("  [FAIL] Archiv-Reiter nicht gefunden")
            await browser.close()
            return 1
        await tab.click()
        await page.wait_for_timeout(1200)

        # ── 1) Listenansicht mit anklickbarer Kopfzeile ───────────────────
        print("\n[1] Die Kopfzeile der Liste ist anklickbar")
        knopf = await page.query_selector('[data-view="list"]')
        if knopf:
            await knopf.click()
            await page.wait_for_timeout(600)

        koepfe = await page.eval_on_selector_all(
            "#lib-list .lib-row-head [data-col]", "els => els.map(e => e.dataset.col)")
        sagen(len(koepfe) == 9,
              "alle neun Spalten sind sortierbar", f"{len(koepfe)}: {koepfe}")
        for erwartet in ("name", "date", "dist", "asc", "dur", "speed",
                         "act", "place", "tags"):
            sagen(erwartet in koepfe, f"Spalte „{erwartet}“ ist dabei")

        # ── 2) Ein Klick sortiert, der zweite dreht um ────────────────────
        print("\n[2] Erster Klick sortiert, zweiter dreht um")
        await page.evaluate("window.__ruf = []")
        await page.click('#lib-list .lib-row-head [data-col="name"]')
        await page.wait_for_timeout(500)
        s1 = await page.evaluate(
            "(window.__ruf.filter(r => r.name === 'library_query').pop() || {}).args")
        sagen(bool(s1) and s1.get("sort") == "name_asc",
              "Name → name_asc geht ans Backend", str(s1 and s1.get("sort")))

        await page.click('#lib-list .lib-row-head [data-col="name"]')
        await page.wait_for_timeout(500)
        s2 = await page.evaluate(
            "(window.__ruf.filter(r => r.name === 'library_query').pop() || {}).args")
        sagen(bool(s2) and s2.get("sort") == "name_desc",
              "zweiter Klick → name_desc", str(s2 and s2.get("sort")))

        pfeil = await page.eval_on_selector(
            '#lib-list .lib-row-head [data-col="name"] .lib-th-pfeil',
            "e => e.textContent.trim()")
        sagen(pfeil in ("▲", "▼"), "die aktive Spalte zeigt einen Pfeil", repr(pfeil))
        aktiv = await page.eval_on_selector_all(
            "#lib-list .lib-row-head .lib-th.is-sort", "els => els.length")
        sagen(aktiv == 1, "genau eine Spalte ist hervorgehoben", str(aktiv))

        # Zahlenspalten beginnen mit „viel zuerst“ — sonst zeigt „Strecke“ beim
        # ersten Klick die kürzesten Touren, was niemand meint.
        print("\n[3] Zahlenspalten beginnen absteigend, Textspalten A–Z")
        for spalte, erwartet in (("dist", "dist_desc"), ("speed", "speed_desc"),
                                 ("asc", "asc_desc"), ("dur", "dur_desc"),
                                 ("place", "place_asc"), ("tags", "tags_asc"),
                                 ("act", "act_asc"), ("date", "date_desc")):
            await page.evaluate("window.__ruf = []")
            await page.click(f'#lib-list .lib-row-head [data-col="{spalte}"]')
            await page.wait_for_timeout(350)
            g = await page.evaluate(
                "(window.__ruf.filter(r => r.name === 'library_query').pop() || {}).args")
            sagen(bool(g) and g.get("sort") == erwartet,
                  f"{spalte} → {erwartet}", str(g and g.get("sort")))

        # ── 4) Auswahlfeld und Kopfzeile bleiben einig ───────────────────
        print("\n[4] Auswahlfeld und Kopfzeile zeigen dasselbe")
        wert = await page.eval_on_selector("#lib-sort", "e => e.value")
        sagen(wert == "date_desc",
              "das Auswahlfeld folgt dem Klick in der Kopfzeile", wert)
        optionen = await page.eval_on_selector_all(
            "#lib-sort option", "els => els.map(e => e.value)")
        for muss in ("speed_desc", "speed_asc", "place_asc", "tags_asc",
                     "name_desc", "dur_asc", "asc_asc"):
            sagen(muss in optionen, f"das Auswahlfeld kennt {muss}")

        # ── 5) FIT-Werte in der Detailspalte ─────────────────────────────
        print("\n[5] Werte aus der Aufzeichnung stehen in der Detailspalte")

        await page.click("#lib-list .lib-row:not(.lib-row-head)")
        await page.wait_for_timeout(700)
        block = await page.query_selector(".lib-fit")
        sagen(block is not None, "der Block ist da")
        if block:
            txt = await block.inner_text()
            sagen("116" in txt, "der Ø-Puls steht drin")
            sagen("812" in txt, "die Kalorien stehen drin")
            sagen("Gravel" in txt, "der Profilname steht drin")
            sagen("42" in txt, "der Hinweis auf die weiteren Werte nennt 42", txt[-90:])
            sagen("cycling" not in txt and "gravel_cycling" not in txt,
                  "kein rohes Kennwort aus der Datei steht im Text", txt[:200])
            sagen("Radfahren" in txt and "Gravel" in txt,
                  "Sportart und Unterart sind benannt")
            sagen("Wahoo Fitness" in txt,
                  "unbenannte Kennwerte werden wenigstens lesbar gemacht", txt[:200])

        # ── 6) Fehler-Dialog mit 98692 Meldungen ─────────────────────────
        print("\n[6] Fehler-Dialog bei 98692 Meldungen")
        await page.evaluate("window.__ruf = []")
        vorher = await page.evaluate("performance.now()")
        await page.evaluate("""() => {
          const b = document.getElementById("lib-show-errors");
          if (b) b.click();
        }""")
        await page.wait_for_timeout(900)
        dauer = await page.evaluate("performance.now()") - vorher

        offen = await page.eval_on_selector(
            "#modal-overlay", "e => !e.hidden")
        sagen(offen, "der Dialog geht auf")
        gezaehlt = await page.evaluate(
            "window.__ruf.some(r => r.name === 'library_errors_count')")
        sagen(gezaehlt, "die Gesamtzahl kommt aus einer Zählabfrage")

        inhalt = await page.eval_on_selector("#modal-overlay", "e => e.innerText")
        # Der Tausendertrenner richtet sich nach der Sprache der Oberfläche
        # (`num()` → `i18nMeta().active`). Kopflos ist keine geladen, dann
        # greift die Browser-Voreinstellung — beide Schreibweisen sind richtig.
        sagen(any(x in inhalt for x in ("98.692", "98,692", "98692")),
              "die echte Gesamtzahl steht im Dialog")
        zeilen = await page.eval_on_selector_all(
            "#modal-overlay .lib-dupes input[type=checkbox]", "els => els.length")
        sagen(zeilen <= 320,
              "es werden höchstens 300 Zeilen aufgebaut, nicht 98692", str(zeilen))
        sagen(dauer < 3000, "der Aufbau bleibt unter drei Sekunden",
              f"{dauer:.0f} ms")

        # Die Frage des Testers — „können die weg?“ — muss der Dialog beantworten.
        sagen("Kilometer" in inhalt and "nicht" in inhalt,
              "der Dialog sagt, dass diese Dateien nicht in die Auswertung zählen")

        for knopf_id, art in (("lib-err-all-nogps", "no_points"),
                              ("lib-err-all-broken", "broken")):
            da = await page.query_selector(f"#{knopf_id}")
            sagen(da is not None, f"Sammel-Knopf „{art}“ ist da")

        await page.evaluate("window.__ruf = []")
        b = await page.query_selector("#lib-err-all-broken")
        if b:
            await b.click()
            await page.wait_for_timeout(700)
            gerufen = await page.evaluate(
                "(window.__ruf.find(r => r.name === 'library_dismiss_all_errors') || {}).args")
            sagen(gerufen == "broken",
                  "der Knopf räumt die ganze Gruppe weg statt Zeile für Zeile",
                  repr(gerufen))

        # ── 6b) Einzahl: „1 Dateien konnten…" liest sich falsch ──────────
        print("\n[6b] Bei genau einer Meldung stimmt die Einzahl")
        await page.click("#modal-close")      # erst zu, sonst stapelt der Test
        await page.wait_for_timeout(400)
        await page.evaluate("""() => {
          const a = window.pywebview.api;
          a.library_errors_count = async () => ({ gesamt: 1, ohne_strecke: 0, kaputt: 1 });
          a.library_errors = async () => ({ ok: true, items: [
            { path: "/mock/x.gpx", filename: "x.gpx", error: "kaputt", error_kind: "broken" }] });
        }""")
        await page.evaluate("""() => {
          const b = document.getElementById("lib-show-errors"); if (b) b.click();
        }""")
        await page.wait_for_timeout(800)
        eins = await page.eval_on_selector("#modal-overlay", "e => e.innerText")
        sagen("Datei konnte nicht" in eins,
              "Einzahl im Fließtext", eins[:120].replace("\n", " "))
        sagen("Alle 1" not in eins, "kein „Alle 1 …“ auf dem Knopf")
        sagen("Die nicht lesbare Datei" in eins, "Einzahl auf dem Knopf")

        # ── 7) Und der Dialog geht mit EINEM Klick wieder zu ─────────────
        print("\n[7] Der Dialog lässt sich mit einem Klick schließen")
        # Nach dem Wegräumen baut sich der Dialog neu auf. Täte er das über den
        # offenen hinweg, lägen zwei Fenster übereinander und ein Klick auf ✕
        # brächte nur das obere weg — der Nutzer stünde vor dem veralteten Stand.
        await page.click("#modal-close")
        await page.wait_for_timeout(500)
        zu = await page.eval_on_selector("#modal-overlay", "e => e.hidden")
        sagen(zu, "ein Klick auf ✕ genügt — kein Dialog-Stapel")

        sagen(not seiten_fehler, "keine JavaScript-Fehler auf der Seite",
              "; ".join(seiten_fehler[:2]))
        await browser.close()

    print("\n" + ("✅ Archiv-Selbsttest bestanden" if not fehler
                  else f"❌ {fehler} Prüfung(en) gescheitert"))
    return 1 if fehler else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
