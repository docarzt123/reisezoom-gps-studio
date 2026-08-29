#!/usr/bin/env python3
"""Projekt-Bereich im Archiv (E1, v0.9.600) — headless im echten Browser.

Der Anlass
----------
Grilling 29.08.2026 (IDEAS §39): Sessions sind aufgelöst, Projekte sind
eigenständige Arbeitsmappen. v0.9.601 (Marc: „das ist blöd über die sidebar
… bau eine komplett neue ansicht"): der Projektmanager ist ein Vollbild-
Overlay (ui/js/projekte.js), die App startet darin, der 🗂-Knopf in der
Track-Leiste öffnet ihn aus jedem Modul. Marc dazu: „nicht meinen rechner
übernehmen für tests. alles nur headless testen" — deshalb prüft dieser
Test die Oberfläche komplett ohne echte App.

Warum im Browser und nicht am Quelltext
---------------------------------------
Der Boot-Weg (app.js ruft projektManagerOeffnen → Overlay → renderProjekte)
läuft über drei Dateien. Ob am Ende wirklich Karten auf dem Bildschirm
stehen und ein Klick die richtige Brücke ruft, sieht nur ein echter Browser.

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
  window.__rzKeinPmBoot = false;   // dieser Test prüft den Boot-Öffner selbst
  const echt = window.pywebview.api;
  window.__ruf = [];
  const merken = (name, args) => window.__ruf.push({ name, args });
  const P = [
    { id: "pa", name: "Sunset Teneriffa", status: "aktiv", auto: false,
      ablauf: "solo", modified_at: "2026-08-28T10:00:00", n_touren: 1,
      tour_namen: ["Masca-Schlucht"], geo_hashes: ["gh1"],
      module: ["animator", "tourmap"], letztes_modul: "tourmap",
      exists: true, pfade_ok: true, haupt_pfad: "/mock/masca.gpx" },
    { id: "pb", name: "Camino Schwarm", status: "fertig", auto: false,
      ablauf: "schwarm", schwarm_modus: "ziel",
      modified_at: "2026-08-27T10:00:00", n_touren: 2,
      tour_namen: ["Etappe 1", "Etappe 2"], geo_hashes: ["gh2", "gh3"],
      module: ["animator"], letztes_modul: "animator",
      exists: true, pfade_ok: true },
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

        print("\n━━━ 1. Boot öffnet den Projektmanager (Vollbild) ━━━")
        sagen(not await pg.eval_on_selector("#pmgr-overlay", "e => e.hidden"),
              "das Overlay steht beim Start offen")
        # v0.9.602 (Marc: „im projekt manager fehlt die ganze topbar"): das
        # Overlay beginnt UNTER der Topbar — Tabs bleiben klickbar.
        sagen(await pg.evaluate("""(() => {
          const tb = document.querySelector(".topbar").getBoundingClientRect();
          const ov = document.getElementById("pmgr-overlay").getBoundingClientRect();
          return ov.top >= tb.bottom - 1 && tb.height > 10;
        })()"""), "… die Topbar bleibt sichtbar (Overlay beginnt darunter)")
        deine = await pg.eval_on_selector_all(
            "#pmgr-body > .lib-proj-liste .lib-proj-karte",
            "e => e.map(x => x.dataset.pid)")
        sagen(deine == ["pa", "pb"],
              "„Deine Projekte“: aktiv vor fertig", str(deine))
        autos = await pg.eval_on_selector_all(
            ".lib-proj-autos .lib-proj-karte", "e => e.map(x => x.dataset.pid)")
        sagen(autos == ["pc"], "auto-Projekte eingeklappt darunter (Q10c)",
              str(autos))
        sagen("2" in (await pg.eval_on_selector(
            "#pmgr-n", "e => e.textContent")),
              "Kopfzeile zählt nur die eigenen")
        sagen(await pg.eval_on_selector(
            '.lib-proj-karte[data-pid="pb"]',
            "e => e.classList.contains('fertig')"),
              "fertige Projekte sind als solche gestaltet")

        print("\n━━━ 2. Suche filtert die Karten ━━━")
        await pg.fill("#pmgr-search", "camino")
        await pg.wait_for_timeout(500)
        nur = await pg.eval_on_selector_all(
            "#pmgr-body .lib-proj-karte", "e => e.map(x => x.dataset.pid)")
        sagen(nur == ["pb"], "Suche „camino“ lässt nur das eine übrig", str(nur))
        await pg.fill("#pmgr-search", "")
        await pg.wait_for_timeout(500)

        print("\n━━━ 2b. Schließen + 🗂-Knopf in der Track-Leiste ━━━")
        await pg.click("#pmgr-close")
        sagen(await pg.eval_on_selector("#pmgr-overlay", "e => e.hidden"),
              "✕ schließt das Overlay")
        sagen(bool(await pg.query_selector('[data-gpxbar=\'projekte\']')),
              "die Track-Leiste hat den Projekte-Knopf (oben links)")
        await pg.click('[data-gpxbar="projekte"]')
        await pg.wait_for_timeout(300)
        sagen(not await pg.eval_on_selector("#pmgr-overlay", "e => e.hidden"),
              "… und er öffnet den Manager wieder")

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
        sagen(await pg.eval_on_selector("#pmgr-overlay", "e => e.hidden"),
              "Öffnen schließt das Overlay")
        await pg.evaluate("window.projektManagerOeffnen()")
        await pg.wait_for_timeout(300)
        await pg.click('.lib-proj-chip[data-open-modul="animator"][data-pid="pa"]')
        await pg.wait_for_timeout(300)
        mods = await pg.evaluate("window.__mods")
        sagen(mods[-1] == "animator",
              "Modul-Chip überstimmt das letzte Modul", str(mods))
        await pg.evaluate("window.projektManagerOeffnen()")
        await pg.wait_for_timeout(300)

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
        await pg.evaluate("window.projektManagerOeffnen()")
        await pg.wait_for_timeout(300)

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
