#!/usr/bin/env python3
"""Projekt-Bereich im Archiv (E1, v0.9.600) — headless im echten Browser.

Der Anlass
----------
Grilling 29.08.2026 (IDEAS §39) + v0.9.606 (Marc: „lass den [Umschalter]
immer da unten … wechsel nur die ansicht da unten … touren und projekte
werden ähnlich organisiert"): Projekte sind eine gleichwertige Ansicht IM
Archiv — Umschalter in der Filterzeile, Status-Bereiche links, Suche wirkt,
die App startet in dieser Ansicht. Marc: „nicht meinen rechner übernehmen
für tests. alles nur headless testen" — deshalb komplett ohne echte App.

Warum im Browser und nicht am Quelltext
---------------------------------------
Der Boot-Weg (app.js setzt __rzStartProjekte → Archiv verbraucht die Flagge
→ renderProjekte) läuft über mehrere Dateien. Ob am Ende wirklich Karten auf
dem Bildschirm stehen und ein Klick die richtige Brücke ruft, sieht nur ein
echter Browser.

Aufruf:  .venv/bin/python scripts/selftest_projekte.py
Braucht kein Netz (alle Brücken gemockt).
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "scripts"))

from selftest_ui import MOCK_API_JS, UI_INDEX      # noqa: E402
from selftest_archiv import I18N_MOCK_JS           # noqa: E402

fehler = 0


def sagen(ok: bool, text: str, zusatz: str = "") -> None:
    global fehler
    print(f"  [{'OK  ' if ok else 'FAIL'}] {text}" + (f"  {zusatz}" if zusatz else ""))
    if not ok:
        fehler += 1


# Legt sich ÜBER die Standard-Mocks: drei Projekte (2 eigene + 1 auto) und ein
# Ruf-Protokoll, damit der Test sieht, was die Oberfläche wirklich sendet.
PROJ_MOCK_JS = r"""
(() => {
  window.__rzKeinPmBoot = false;   // dieser Test prüft den Boot-Einstieg selbst
  const echt = window.pywebview.api;
  window.__ruf = [];
  const merken = (name, args) => window.__ruf.push({ name, args });
  const P = [
    { id: "pa", name: "Sunset Teneriffa", status: "aktiv", auto: false,
      ablauf: "solo", modified_at: "2026-08-28T10:00:00", n_touren: 1,
      tour_namen: ["Masca-Schlucht"], geo_hashes: ["gh1"],
      module: ["animator", "tourmap"], letztes_modul: "tourmap",
      exists: true, pfade_ok: true, haupt_pfad: "/mock/masca.gpx",
      neuere_fassung: { geo_hash: "ghNEU", nr: 3, eigene_nr: 2 } },
    { id: "pb", name: "Camino Schwarm", status: "fertig", auto: false,
      ablauf: "schwarm", schwarm_modus: "ziel",
      modified_at: "2026-08-27T10:00:00", n_touren: 2,
      tour_namen: ["Etappe 1", "Etappe 2"], geo_hashes: ["gh2", "gh3"],
      module: ["animator"], letztes_modul: "animator",
      exists: true, pfade_ok: true },
    { id: "pf", name: "Kartenflug", status: "aktiv", auto: false,
      ablauf: "solo", frei: true, kontext: "frei:abc123",
      modified_at: "2026-08-25T10:00:00", n_touren: 0, tour_namen: [],
      geo_hashes: [], module: [], letztes_modul: "reiseroute",
      exists: true, pfade_ok: true, haupt_pfad: "" },
    { id: "pc", name: "t3.gpx", status: "aktiv", auto: true, ablauf: "solo",
      modified_at: "2026-08-26T10:00:00", n_touren: 1, tour_namen: ["t3"],
      geo_hashes: ["gh4"], module: [], letztes_modul: "animator",
      exists: true, pfade_ok: true, haupt_pfad: "/mock/t3.gpx" },
  ];
  window.pywebview.api = new Proxy({
    projekte_liste: async () => ({ ok: true, projekte: P.slice() }),
    projekt_aktivieren: async (pid) => {
      merken("projekt_aktivieren", [pid]);
      const p = P.find(x => x.id === pid) || {};
      return { ok: true, ablauf: p.ablauf, letztes_modul: p.letztes_modul,
               frei: !!p.frei, kontext: p.kontext || "",
               gpx_paths: pid === "pb" ? ["/mock/e1.gpx", "/mock/e2.gpx"]
                                       : [p.haupt_pfad],
               schwarm_modus: p.schwarm_modus || "gleich",
               schwarm_pausen: true };
    },
    projekt_status_setzen: async (pid, st) => {
      merken("projekt_status_setzen", [pid, st]);
      const p = P.find(x => x.id === pid); if (p) p.status = st;
      return { ok: true };
    },
    projekt_umbenennen: async (pid, name) => {
      merken("projekt_umbenennen", [pid, name]);
      const p = P.find(x => x.id === pid);
      if (p) { p.name = name; p.auto = false; }
      return { ok: true };
    },
    projekt_duplizieren: async (pid) => {
      merken("projekt_duplizieren", [pid]);
      const p = P.find(x => x.id === pid);
      if (p) P.push(Object.assign({}, p, { id: pid + "_k",
                                           name: p.name + " (Kopie)" }));
      return { ok: true };
    },
    projekt_frei_anlegen: async (name) => {
      merken("projekt_frei_anlegen", [name]);
      P.push({ id: "pneu", name, status: "aktiv", auto: false, ablauf: "solo",
               frei: true, kontext: "frei:neu", n_touren: 0, tour_namen: [],
               geo_hashes: [], module: [], letztes_modul: "", exists: true,
               modified_at: "2026-08-29T12:00:00" });
      return { ok: true, track_hash: "frei:neu",
               session: { track_hash: "frei:neu", name, stats: {} },
               active_project: { id: "pneu", name, is_active: true },
               projects: [{ id: "pneu", name, is_active: true }] };
    },
    session_open_for_frei: async (k) => {
      merken("session_open_for_frei", [k]);
      return { ok: true, track_hash: k,
               session: { track_hash: k, name: "Kartenflug", stats: {} },
               active_project: { id: "pf", name: "Kartenflug", is_active: true },
               projects: [{ id: "pf", name: "Kartenflug", is_active: true }] };
    },
    library_query: async () => ({ ok: true, items: [
      { path: "/mock/t1.gpx", name: "Tour Eins", filename: "t1.gpx" },
      { path: "/mock/t2.gpx", name: "Tour Zwei", filename: "t2.gpx" },
    ], total: 2 }),
    projekt_touren_setzen: async (pid, paths) => {
      merken("projekt_touren_setzen", [pid, paths]);
      const p = P.find(x => x.id === pid);
      if (p) { p.frei = false; p.n_touren = paths.length; p.geo_hashes = paths.map((_, i) => "g" + i); }
      return { ok: true, kontext: "menge:xyz", ablauf: "reise" };
    },
    projekt_thumbs: async (pids) => {
      merken("projekt_thumbs", [pids.slice().sort()]);
      const px = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
      const o = {}; pids.forEach(p => { o[p] = px; }); return { ok: true, thumbs: o };
    },
    projekt_fassung_aktualisieren: async (pid) => {
      merken("projekt_fassung_aktualisieren", [pid]);
      const p = P.find(x => x.id === pid); if (p) delete p.neuere_fassung;
      return { ok: true, geaendert: 1 };
    },
    projekt_staende: async (pid) => {
      merken("projekt_staende", [pid]);
      return { ok: true, staende: [
        { ts: "2026-08-29T10:00:00+00:00", keyframes: 4, schilder: 1, fotos: 0 },
        { ts: "2026-08-29T11:00:00+00:00", keyframes: 7, schilder: 2, fotos: 1 },
      ] };
    },
    projekt_stand_wiederherstellen: async (pid, ts) => {
      merken("projekt_stand_wiederherstellen", [pid, ts]);
      return { ok: true };
    },
    projekt_loeschen: async (pid) => {
      merken("projekt_loeschen", [pid]);
      const i = P.findIndex(x => x.id === pid); if (i >= 0) P.splice(i, 1);
      return { ok: true };
    },
  }, { get: (z, n) => (n in z) ? z[n] : echt[n] });
})();"""


async def main():
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True)
        pg = await (await b.new_context(
            viewport={"width": 1500, "height": 1000})).new_page()
        jsfehler = []
        pg.on("pageerror", lambda e: jsfehler.append(str(e)[:160]))
        for js in (MOCK_API_JS, I18N_MOCK_JS, PROJ_MOCK_JS):
            await pg.add_init_script(js)
        await pg.goto(f"file://{UI_INDEX.resolve()}",
                      wait_until="domcontentloaded")
        await pg.wait_for_timeout(2500)

        print("\n━━━ 1. Boot startet in der Projekte-Ansicht ━━━")
        sagen(not await pg.eval_on_selector("#lib-projwrap", "e => e.hidden"),
              "die Projekt-Fläche ist beim Start sichtbar")
        sagen(await pg.eval_on_selector("#lib-grid", "e => e.hidden"),
              "… die Touren-Kacheln sind weg")
        sagen(await pg.eval_on_selector("#lib-nav-touren", "e => e.hidden")
              and not await pg.eval_on_selector("#lib-nav-projekte", "e => e.hidden"),
              "… die Seitenleiste zeigt Projekt-Bereiche statt Tour-Filter")
        sagen(await pg.eval_on_selector(".lib-bar", "e => e.classList.contains('proj-mode')"),
              "… die Filterzeile zeigt nur Umschalter + Suche")
        deine = await pg.eval_on_selector_all(
            "#lib-projwrap > .lib-proj-liste .lib-proj-karte",
            "e => e.map(x => x.dataset.pid)")
        sagen(deine == ["pa", "pf", "pb"],
              "„Deine Projekte“: aktiv vor fertig (frei-Projekt dabei)", str(deine))
        autos = await pg.eval_on_selector_all(
            ".lib-proj-autos .lib-proj-karte", "e => e.map(x => x.dataset.pid)")
        sagen(autos == ["pc"], "auto-Projekte eingeklappt darunter (Q10c)",
              str(autos))
        sagen(await pg.eval_on_selector(
            '.lib-proj-karte[data-pid="pb"]',
            "e => e.classList.contains('fertig')"),
              "fertige Projekte sind als solche gestaltet")
        await pg.wait_for_timeout(400)
        sagen(bool(await pg.query_selector('[data-pthumb="pa"] img')),
              "Karten-Vorschau wird geladen (v0.9.615)")

        print("\n━━━ 2. Bereiche links + Suche filtern ━━━")
        n_fertig = await pg.eval_on_selector(
            '[data-pscope="fertig"] .lib-nav-n', "e => e.textContent")
        sagen(n_fertig.strip() == "1", "Status-Bereiche zählen mit", n_fertig)
        await pg.click('[data-pscope="fertig"]')
        await pg.wait_for_timeout(300)
        nur = await pg.eval_on_selector_all(
            "#lib-projwrap .lib-proj-karte", "e => e.map(x => x.dataset.pid)")
        sagen(nur == ["pb"], "Bereich „fertig“ filtert die Karten", str(nur))
        await pg.click('[data-pscope="auto"]')
        await pg.wait_for_timeout(300)
        nur = await pg.eval_on_selector_all(
            "#lib-projwrap .lib-proj-karte", "e => e.map(x => x.dataset.pid)")
        sagen(nur == ["pc"], "Bereich „Automatisch angelegt“ zeigt die autos", str(nur))
        await pg.click('[data-pscope="alle"]')
        await pg.wait_for_timeout(300)
        await pg.fill("#lib-search", "camino")
        await pg.wait_for_timeout(700)
        nur = await pg.eval_on_selector_all(
            "#lib-projwrap > .lib-proj-liste .lib-proj-karte",
            "e => e.map(x => x.dataset.pid)")
        sagen(nur == ["pb"], "Suche „camino“ lässt nur das eine übrig", str(nur))
        await pg.fill("#lib-search", "")
        await pg.wait_for_timeout(700)

        print("\n━━━ 2b. Umschalter Projekte ⇄ Touren-Archiv ━━━")
        await pg.click("#lib-seg-touren")
        await pg.wait_for_timeout(300)
        sagen(await pg.eval_on_selector("#lib-projwrap", "e => e.hidden")
              and not await pg.eval_on_selector("#lib-nav-touren", "e => e.hidden"),
              "„Touren-Archiv“ zeigt wieder Touren + Tour-Filter")
        await pg.click("#lib-seg-projekte")
        await pg.wait_for_timeout(300)
        sagen(not await pg.eval_on_selector("#lib-projwrap", "e => e.hidden"),
              "… und „Projekte“ wechselt zurück")

        # Ab hier: Modulwechsel + Track-Laden abfangen — geprüft wird die
        # ÜBERGABE, nicht der Lader (der hat eigene Tests).
        await pg.evaluate("""(() => {
          window.__mods = [];
          switchMod = (m) => { window.__mods.push(m); };
          window.__loads = [];
          window.loadGlobalGpx = async (p, o) => {
            window.__loads.push([p, o || {}]); return true; };
        })()""")

        print("\n━━━ 3. Öffnen springt ins zuletzt benutzte Modul (Q22) ━━━")
        await pg.click('[data-open="pa"]')
        await pg.wait_for_timeout(300)
        ruf = await pg.evaluate("window.__ruf")
        sagen(any(r["name"] == "projekt_aktivieren" and r["args"] == ["pa"]
                  for r in ruf), "Öffnen aktiviert das Projekt an der Brücke")
        loads = await pg.evaluate("window.__loads")
        sagen(loads and loads[-1][0] == "/mock/masca.gpx",
              "… lädt die Haupt-Tour", str(loads))
        mods = await pg.evaluate("window.__mods")
        sagen(mods and mods[-1] == "tourmap",
              "… und springt ins letzte Modul (tourmap)", str(mods))
        await pg.click('.lib-proj-chip[data-open-modul="animator"][data-pid="pa"]')
        await pg.wait_for_timeout(300)
        mods = await pg.evaluate("window.__mods")
        sagen(mods[-1] == "animator",
              "Modul-Chip überstimmt das letzte Modul", str(mods))

        print("\n━━━ 4. Kompositionen gehen den Übergabe-Weg ━━━")
        await pg.click('[data-open="pb"]')
        await pg.wait_for_timeout(300)
        pend = await pg.evaluate(
            "[window.__rzPendingTours, window.__rzPendingAblauf,"
            " window.__rzPendingModus, window.__rzPendingPausen]")
        sagen(pend[0] == ["/mock/e2.gpx"] and pend[1] == "schwarm",
              "Etappen + Ablauf liegen bereit", str(pend))
        sagen(pend[2] == "ziel" and pend[3] is True,
              "Schwarm-Modus + Pausen kommen aus dem Projekt", str(pend))
        loads = await pg.evaluate("window.__loads")
        sagen(loads[-1][0] == "/mock/e1.gpx"
              and loads[-1][1].get("menge") is True,
              "erste Etappe lädt als Mengen-Start", str(loads[-1]))
        mods = await pg.evaluate("window.__mods")
        sagen(mods[-1] == "animator", "Komposition öffnet im Animator")

        print("\n━━━ 4b. Fassungs-Pinning + Stände (E2/E3) ━━━")
        sagen(bool(await pg.query_selector('.lib-proj-up[data-up="pa"]')),
              "gepinnte Karte trägt den ⬆-Chip")
        await pg.click('.lib-proj-up[data-up="pa"]')
        await pg.wait_for_timeout(200)
        sagen(bool(await pg.query_selector("#lib-up-ok")),
              "… Klick fragt mit Vorher/Nachher-Hinweis")
        await pg.click("#lib-up-ok")
        await pg.wait_for_timeout(300)
        ruf = await pg.evaluate("window.__ruf")
        sagen(any(r["name"] == "projekt_fassung_aktualisieren"
                  and r["args"] == ["pa"] for r in ruf),
              "… Bestätigen ruft die Brücke")
        sagen(not bool(await pg.query_selector('.lib-proj-up[data-up="pa"]')),
              "… danach ist der Chip weg")
        await pg.click('[data-st="pb"]')
        await pg.wait_for_timeout(300)
        sagen(bool(await pg.query_selector("[data-strb]")),
              "🕘 zeigt die gesicherten Stände")
        await pg.click('[data-strb="2026-08-29T10:00:00+00:00"]')
        await pg.wait_for_timeout(300)
        ruf = await pg.evaluate("window.__ruf")
        sagen(any(r["name"] == "projekt_stand_wiederherstellen"
                  and r["args"] == ["pb", "2026-08-29T10:00:00+00:00"]
                  for r in ruf),
              "↩︎ stellt den gewählten Stand wieder her")

        print("\n━━━ 4c. Leeres Projekt (Q1/Q2, v0.9.612) ━━━")
        sagen(bool(await pg.query_selector("#lib-proj-new")),
              "„+ Neues Projekt“ steht in der Projekt-Seitenleiste")
        # v0.9.613: absichtlich in einen filternden Bereich stellen — das
        # frische Projekt muss TROTZDEM sofort sichtbar sein (Marc-Befund).
        await pg.click('[data-pscope="fertig"]')
        await pg.wait_for_timeout(200)
        await pg.click("#lib-proj-new")
        await pg.wait_for_timeout(200)
        await pg.eval_on_selector("#lib-proj-newname", "e => e.value = 'Intro-Flug'")
        await pg.click("#lib-pn-ok")
        await pg.wait_for_timeout(300)
        ruf = await pg.evaluate("window.__ruf")
        sagen(any(r["name"] == "projekt_frei_anlegen" and r["args"] == ["Intro-Flug"]
                  for r in ruf), "Anlegen ruft die Brücke")
        sagen(bool(await pg.query_selector('.lib-proj-karte[data-pid="pneu"]')),
              "… und die Karte erscheint")
        sagen(bool(await pg.query_selector('[data-addtours="pf"]')),
              "frei-Karte trägt den ➕-Knopf")
        await pg.click('[data-open="pf"]')
        await pg.wait_for_timeout(300)
        ruf = await pg.evaluate("window.__ruf")
        sagen(any(r["name"] == "session_open_for_frei" and r["args"] == ["frei:abc123"]
                  for r in ruf), "Öffnen aktiviert den frei-Kontext ohne Track")
        mods = await pg.evaluate("window.__mods")
        sagen(mods[-1] == "reiseroute",
              "… und springt ins letzte Modul (Reiseroute)", str(mods))
        await pg.click('[data-addtours="pf"]')
        await pg.wait_for_timeout(300)
        await pg.wait_for_timeout(300)
        sagen(bool(await pg.query_selector("#lib-tp-liste")),
              "➕ öffnet den Archiv-Picker")
        # v0.9.621: leeres Bestätigen darf nicht mehr stumm enden.
        await pg.click("#lib-tp-ok")
        await pg.wait_for_timeout(200)
        sagen(not any(r["name"] == "projekt_touren_setzen"
                      for r in await pg.evaluate("window.__ruf")),
              "leeres Bestätigen ruft die Brücke NICHT (Hinweis statt stumm)")
        for pfad in ("/mock/t1.gpx", "/mock/t2.gpx"):
            await pg.eval_on_selector(
                f'#lib-tp-liste [data-tpath="{pfad}"]',
                "e => { e.checked = true; e.dispatchEvent(new Event('change')); }")
        await pg.click("#lib-tp-ok")
        await pg.wait_for_timeout(300)
        ruf = await pg.evaluate("window.__ruf")
        sagen(any(r["name"] == "projekt_touren_setzen"
                  and r["args"][0] == "pf"
                  and sorted(r["args"][1]) == ["/mock/t1.gpx", "/mock/t2.gpx"]
                  for r in ruf), "Hinzufügen setzt die gewählten Touren")

        print("\n━━━ 5. Verwalten direkt auf der Karte ━━━")
        await pg.eval_on_selector(
            '.lib-proj-status[data-pid="pa"]',
            "e => { e.value = 'idee'; e.dispatchEvent(new Event('change')); }")
        await pg.wait_for_timeout(300)
        ruf = await pg.evaluate("window.__ruf")
        sagen(any(r["name"] == "projekt_status_setzen"
                  and r["args"] == ["pa", "idee"] for r in ruf),
              "Status-Wechsel geht an die Brücke")
        await pg.click('[data-dup="pb"]')
        await pg.wait_for_timeout(300)
        sagen(bool(await pg.query_selector('.lib-proj-karte[data-pid="pb_k"]')),
              "Duplizieren: die Kopie erscheint sofort")

        sagen(not jsfehler, "keine JavaScript-Fehler", "; ".join(jsfehler))
        await b.close()


if __name__ == "__main__":
    asyncio.run(main())
    if fehler:
        print(f"\n{fehler} Prüfung(en) fehlgeschlagen.")
        sys.exit(1)
    print("\n✅ Projekt-Bereich im Browser bestanden")
