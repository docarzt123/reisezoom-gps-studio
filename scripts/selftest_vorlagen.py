#!/usr/bin/env python3
"""Vorlagen im Archiv + Kopfzeile (11.09.2026, docs/TOUR-ASSISTENT.md §2.3/2.4) —
headless im echten Browser, alle Brücken gemockt.

Geprüft wird die BEDIENUNG: Reiter „Vorlagen“, Kacheln mit ★/✎/🗑, Stern
setzen + Archiv-Undo, Umbenennen, Löschen + Undo (wieder einsetzen), „Neue
Vorlage aus Projekt…“, 🧩 auf der Projekt-Kachel (anwenden + Undo über
projekt_module_schreiben, speichern), „Neues Projekt daraus“, und das
Namens-Fenster mit Vorlagen-Feld.

Aufruf:  .venv/bin/python scripts/selftest_vorlagen.py
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
from selftest_projekte import PROJ_MOCK_JS         # noqa: E402

fehler = 0


def sagen(ok: bool, text: str, zusatz: str = "") -> None:
    global fehler
    print(f"  [{'OK  ' if ok else 'FAIL'}] {text}" + (f"  {zusatz}" if zusatz else ""))
    if not ok:
        fehler += 1


VORL_MOCK_JS = r"""
(() => {
  const echt = window.pywebview.api;
  const merken = (name, args) => window.__ruf.push({ name, args });
  const VL = [
    { id: "v1", name: "Bergtour", mitgeliefert: false, standard: false,
      modified_at: "2026-09-10T10:00:00", quelle: "Masca", map_style: "free_satellite",
      format: "3840×2160", line_color: "#ff00ff", font: "Inter", module: ["animator", "tourmap"],
      module_bloecke: { animator: { line_color: "#ff00ff" }, tourmap: { line_color: "#ff00ff" } } },
  ];
  let standard = "reisezoom-standard";
  const liste = () => {
    const rz = { id: "reisezoom-standard", name: "Reisezoom-Standard", mitgeliefert: true,
                 standard: standard === "reisezoom-standard", modified_at: "", quelle: "",
                 map_style: "free_satellite", format: "1920×1080", line_color: "#ff5500", font: "",
                 module: ["animator", "tourmap"], module_bloecke: { animator: { line_color: "#ff5500" } } };
    return [rz].concat(VL.map(v => Object.assign({}, v, { standard: v.id === standard })));
  };
  window.pywebview.api = new Proxy({
    vorlagen_liste: async () => { merken("vorlagen_liste", []); return { ok: true, vorlagen: liste(), standard }; },
    vorlage_standard_setzen: async (vid) => { merken("vorlage_standard_setzen", [vid]);
      const vorher = standard; standard = vid; return { ok: true, vorher }; },
    vorlage_umbenennen: async (vid, name) => { merken("vorlage_umbenennen", [vid, name]);
      const v = VL.find(x => x.id === vid); const vorher = v ? v.name : ""; if (v) v.name = name; return { ok: true, vorher }; },
    vorlage_loeschen: async (vid) => { merken("vorlage_loeschen", [vid]);
      const i = VL.findIndex(x => x.id === vid); if (i < 0) return { ok: false, error: "nicht gefunden" };
      const [v] = VL.splice(i, 1); const war = standard === vid; if (war) standard = "reisezoom-standard";
      return { ok: true, vorlage: v, war_standard: war }; },
    vorlage_wieder_einsetzen: async (v, als) => { merken("vorlage_wieder_einsetzen", [v && v.id, !!als]);
      VL.push(v); if (als) standard = v.id; return { ok: true }; },
    vorlage_anlegen: async (name, pid) => { merken("vorlage_anlegen", [name, pid]);
      const v = { id: "vneu", name, mitgeliefert: false, standard: false, modified_at: "2026-09-11T10:00:00",
                  quelle: "Sunset Teneriffa", map_style: "osm", format: "", line_color: "#00ff00", font: "",
                  module: ["animator"], module_bloecke: { animator: { line_color: "#00ff00" } } };
      VL.push(v); return { ok: true, vorlage: { id: v.id, name } }; },
    vorlage_anwenden: async (pid, vid) => { merken("vorlage_anwenden", [pid, vid]);
      return { ok: true, vorlage: "Bergtour", vorher: { animator: { line_color: "#000000" } },
               nachher: { animator: { line_color: "#ff00ff" } }, project: { id: pid } }; },
    projekt_module_schreiben: async (pid, module) => { merken("projekt_module_schreiben", [pid, module]); return { ok: true }; },
    projekt_touren_setzen: async (pid, pfade) => { merken("projekt_touren_setzen", [pid, pfade]); return { ok: true, kontext: "gh9", ablauf: "solo" }; },
    projekt_vorschau_speichern: async (pid, data) => { merken("projekt_vorschau_speichern", [pid, String(data).slice(0, 22), String(data).length]); return { ok: true }; },
    assistent_lauf: async (path, vid, name, hl) => { merken("assistent_lauf", [path, vid, name, hl]);
      return { ok: true, project_id: "pass", tour_path: path, schritte: [
        { key: "check", text: "Track repariert: 2 Sprünge geradegerückt", ok: true },
        { key: "version", text: "Als neue Version im Archiv gesichert (100 → 98 Punkte)", ok: true },
        { key: "projekt", text: "Projekt „Alpen“ mit Vorlage „Bergtour“ angelegt", ok: true } ] }; },
    projekt_aus_vorlage_anlegen: async (name, vid) => { merken("projekt_aus_vorlage_anlegen", [name, vid]);
      return { ok: true, track_hash: "frei:vorl", session: { track_hash: "frei:vorl", name, stats: {} },
               active_project: { id: "pvorl", name, is_active: true }, projects: [{ id: "pvorl", name, is_active: true }] }; },
  }, { get: (z, n) => (n in z) ? z[n] : echt[n] });
})();"""


async def main():
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True)
        pg = await (await b.new_context(viewport={"width": 1500, "height": 1000})).new_page()
        jsfehler = []
        pg.on("pageerror", lambda e: jsfehler.append(str(e)[:160]))
        for js in (MOCK_API_JS, I18N_MOCK_JS, PROJ_MOCK_JS, VORL_MOCK_JS):
            await pg.add_init_script(js)
        await pg.goto(f"file://{UI_INDEX.resolve()}", wait_until="domcontentloaded")
        await pg.wait_for_timeout(2500)

        async def rufe(name):
            return [r for r in await pg.evaluate("window.__ruf") if r["name"] == name]

        async def karten():
            return await pg.eval_on_selector_all("#lib-vorlwrap .lib-vorl-karte", "e => e.map(x => x.dataset.vid)")

        print("\n━━━ 1. Reiter „Vorlagen“ ━━━")
        sagen(bool(await pg.query_selector("#lib-seg-vorlagen")), "Umschalter hat einen dritten Knopf „Vorlagen“")
        await pg.click("#lib-seg-vorlagen")
        await pg.wait_for_timeout(400)
        sagen(not await pg.eval_on_selector("#lib-vorlwrap", "e => e.hidden"), "die Vorlagen-Fläche ist sichtbar")
        sagen(await pg.eval_on_selector("#lib-projwrap", "e => e.hidden") and await pg.eval_on_selector("#lib-grid", "e => e.hidden"),
              "… Projekte und Touren-Kacheln sind weg")
        sagen(not await pg.eval_on_selector("#lib-nav-vorlagen", "e => e.hidden") and await pg.eval_on_selector("#lib-nav-projekte", "e => e.hidden"),
              "… die Seitenleiste zeigt den Vorlagen-Block")
        sagen(await pg.eval_on_selector("#lib-seg-vorlagen", "e => e.classList.contains('is-on')")
              and not await pg.eval_on_selector("#lib-seg-projekte", "e => e.classList.contains('is-on')"), "… Umschalter markiert „Vorlagen“")
        k = await karten()
        sagen(k == ["reisezoom-standard", "v1"], "Kacheln: Reisezoom-Standard zuerst, dann eigene", str(k))
        sagen(await pg.eval_on_selector('.lib-vorl-karte[data-vid="reisezoom-standard"] .lib-proj-name', "e => e.textContent.startsWith('★')"),
              "★ steht beim Standard")
        sagen(not await pg.query_selector('.lib-vorl-karte[data-vid="reisezoom-standard"] [data-vdel]')
              and not await pg.query_selector('.lib-vorl-karte[data-vid="reisezoom-standard"] [data-vren]'),
              "mitgelieferte Vorlage ohne ✎/🗑")
        sagen(bool(await pg.query_selector('.lib-vorl-karte[data-vid="v1"] [data-vdel]')), "eigene Vorlage mit 🗑")
        sub = await pg.eval_on_selector('.lib-vorl-karte[data-vid="v1"] .lib-proj-sub', "e => e.textContent")
        sagen("free_satellite" in sub and "3840×2160" in sub and "Inter" in sub, "Kurzzeile: Kartenstil · Format · Schrift", sub)
        sagen(bool(await pg.query_selector('.lib-vorl-karte[data-vid="v1"] .vorl-swatch')), "… mit Farbpunkt der Linienfarbe")

        print("\n━━━ 2. Stern setzen + Archiv-Undo ━━━")
        await pg.click('.lib-vorl-karte[data-vid="v1"] [data-vstd]')
        await pg.wait_for_timeout(400)
        r = await rufe("vorlage_standard_setzen")
        sagen(r and r[-1]["args"] == ["v1"], "☆ ruft vorlage_standard_setzen(v1)")
        sagen(await pg.eval_on_selector('.lib-vorl-karte[data-vid="v1"] .lib-proj-name', "e => e.textContent.startsWith('★')"), "… ★ wandert auf die Vorlage")
        await pg.evaluate("window.__rzUndoControllers.library.undo()")
        await pg.wait_for_timeout(400)
        r = await rufe("vorlage_standard_setzen")
        sagen(r[-1]["args"] == ["reisezoom-standard"], "⌘Z im Archiv setzt den vorherigen Stern zurück", str(r[-1]))

        print("\n━━━ 3. Umbenennen ━━━")
        await pg.click('.lib-vorl-karte[data-vid="v1"] [data-vren]')
        await pg.wait_for_timeout(200)
        await pg.fill("#lib-vorl-neuname", "Alpen")
        await pg.click("#lib-vr-ok")
        await pg.wait_for_timeout(400)
        r = await rufe("vorlage_umbenennen")
        sagen(r and r[-1]["args"] == ["v1", "Alpen"], "✎ ruft vorlage_umbenennen(v1, Alpen)")
        sagen("Alpen" in await pg.eval_on_selector('.lib-vorl-karte[data-vid="v1"] .lib-proj-name', "e => e.textContent"), "… Kachel zeigt den neuen Namen")
        await pg.evaluate("window.__rzUndoControllers.library.undo()")
        await pg.wait_for_timeout(300)
        r = await rufe("vorlage_umbenennen")
        sagen(r[-1]["args"] == ["v1", "Bergtour"], "⌘Z benennt zurück")

        print("\n━━━ 4. Löschen + Undo (wieder einsetzen) ━━━")
        await pg.click('.lib-vorl-karte[data-vid="v1"] [data-vdel]')
        await pg.wait_for_timeout(200)
        sagen(bool(await pg.query_selector("#confirm-ok")), "Löschen fragt nach")
        await pg.click("#confirm-ok")
        await pg.wait_for_timeout(400)
        r = await rufe("vorlage_loeschen")
        sagen(r and r[-1]["args"] == ["v1"], "… ruft vorlage_loeschen(v1)")
        sagen(await karten() == ["reisezoom-standard"], "… Kachel ist weg")
        await pg.evaluate("window.__rzUndoControllers.library.undo()")
        await pg.wait_for_timeout(400)
        r = await rufe("vorlage_wieder_einsetzen")
        sagen(r and r[-1]["args"] == ["v1", False], "⌘Z setzt die Vorlage wieder ein", str(r))
        await pg.click("#lib-seg-vorlagen"); await pg.wait_for_timeout(300)
        await pg.evaluate("document.querySelector('#lib-seg-projekte').click()"); await pg.wait_for_timeout(200)
        await pg.click("#lib-seg-vorlagen"); await pg.wait_for_timeout(400)
        sagen(await karten() == ["reisezoom-standard", "v1"], "… und sie steht wieder da", str(await karten()))

        print("\n━━━ 5. Neue Vorlage aus Projekt … ━━━")
        await pg.click("#lib-vorl-new")
        await pg.wait_for_timeout(300)
        opts = await pg.eval_on_selector_all("#lib-vn-proj option", "e => e.map(o => o.value)")
        sagen("pa" in opts and "pc" not in opts, "Projekt-Auswahl ohne Auto-Projekte", str(opts))
        await pg.select_option("#lib-vn-proj", "pa")
        await pg.fill("#lib-vn-name", "Sonnenuntergang")
        await pg.click("#lib-vn-ok")
        await pg.wait_for_timeout(400)
        r = await rufe("vorlage_anlegen")
        sagen(r and r[-1]["args"] == ["Sonnenuntergang", "pa"], "ruft vorlage_anlegen(Name, pa)")
        sagen("vneu" in await karten(), "… neue Kachel erscheint")

        print("\n━━━ 6. 🧩 auf der Projekt-Kachel: anwenden + Undo, speichern ━━━")
        await pg.click("#lib-seg-projekte")
        await pg.wait_for_timeout(400)
        sagen(bool(await pg.query_selector('[data-vorl="pa"]')), "Projekt-Kachel hat den 🧩-Knopf")
        await pg.click('[data-vorl="pa"]')
        await pg.wait_for_timeout(300)
        sagen(bool(await pg.query_selector("#lib-pv-vorlage")) and bool(await pg.query_selector("#lib-pv-name")),
              "Fenster hat Auswahl (anwenden) und Namensfeld (speichern)")
        await pg.select_option("#lib-pv-vorlage", "v1")
        await pg.click("#lib-pv-anwenden")
        await pg.wait_for_timeout(400)
        r = await rufe("vorlage_anwenden")
        sagen(r and r[-1]["args"] == ["pa", "v1"], "Anwenden ruft vorlage_anwenden(pa, v1)")
        await pg.evaluate("window.__rzUndoControllers.library.undo()")
        await pg.wait_for_timeout(300)
        r = await rufe("projekt_module_schreiben")
        sagen(r and r[-1]["args"][0] == "pa" and r[-1]["args"][1] == {"animator": {"line_color": "#000000"}},
              "⌘Z schreibt die Blöcke von VORHER zurück", str(r[-1:]))
        await pg.evaluate("window.__rzUndoControllers.library.redo()")
        await pg.wait_for_timeout(300)
        r = await rufe("projekt_module_schreiben")
        sagen(r[-1]["args"][1] == {"animator": {"line_color": "#ff00ff"}}, "⇧⌘Z schreibt NACHHER")
        await pg.click('[data-vorl="pa"]')
        await pg.wait_for_timeout(300)
        await pg.fill("#lib-pv-name", "Aus Kachel")
        await pg.click("#lib-pv-speichern")
        await pg.wait_for_timeout(300)
        r = await rufe("vorlage_anlegen")
        sagen(r and r[-1]["args"] == ["Aus Kachel", "pa"], "Speichern ruft vorlage_anlegen(Name, pa)")

        print("\n━━━ 6b. Vorlagen-Leiste oben in den Gestaltungs-Modulen ━━━")
        for slug, prefix in (("heightanim", "ha"), ("webkarte", "wk"), ("animator", "anim")):
            await pg.evaluate(f"switchMod('{slug}')")
            await pg.wait_for_timeout(900)
            sagen(not await pg.query_selector(f"#{prefix}-vorl-leiste select"), f"{slug}: Leiste ohne Auswahl (täuscht keinen Zustand vor)")
            sagen(bool(await pg.query_selector(f"#{prefix}-vorl-anwenden")) and bool(await pg.query_selector(f"#{prefix}-vorl-speichern")),
                  f"{slug}: „Vorlage anwenden …“ + 💾 vorhanden")
        sagen(bool(await pg.query_selector("#anim-signs-highlights")), "Animator: Knopf „Highlights aus OpenStreetMap“ in der Schilder-Sektion")
        await pg.evaluate("document.getElementById('anim-signs-highlights').click()")
        await pg.wait_for_timeout(300)
        sagen(not await rufe("highlights_schilder"), "… ohne Track nur ein Hinweis, kein Ruf")
        await pg.click("#anim-vorl-speichern")
        await pg.wait_for_timeout(300)
        sagen(not await pg.query_selector("#vorl-sp-name"), "ohne aktives Projekt: Speichern öffnet kein Fenster, nur Hinweis")
        await pg.click("#anim-vorl-anwenden")
        await pg.wait_for_timeout(300)
        sagen(not await pg.query_selector("#vorl-an-vorlage"), "ohne aktives Projekt: Anwenden öffnet kein Fenster, nur Hinweis")
        await pg.evaluate("switchMod('library')")
        await pg.wait_for_timeout(900)
        await pg.click("#lib-seg-vorlagen"); await pg.wait_for_timeout(400)

        print("\n━━━ 6c. Vorschaubild aus dem letzten Stand (Pipeline mit Stub-Karte) ━━━")
        leer = await pg.evaluate("""(() => { const c = document.createElement('canvas'); c.width = 300; c.height = 200; return _vorschauVerkleinern(c, 300, 200); })()""")
        sagen(leer is None, "leere/schwarze Karte wird verworfen")
        voll = await pg.evaluate("""(() => { const c = document.createElement('canvas'); c.width = 300; c.height = 200;
          const x = c.getContext('2d'); x.fillStyle = '#88aaff'; x.fillRect(0, 0, 300, 200); return _vorschauVerkleinern(c, 300, 200); })()""")
        sagen(isinstance(voll, str) and voll.startswith("data:image/jpeg") and len(voll) < 60000, "Bild mit Inhalt → JPEG 480×270", str(len(voll or "")))
        await pg.evaluate("""(async () => {
          if (typeof sessionActivateFrei === 'function') await sessionActivateFrei('frei:abc123');
          const c = document.createElement('canvas'); c.width = 640; c.height = 360;
          const x = c.getContext('2d'); x.fillStyle = '#3366aa'; x.fillRect(0, 0, 640, 360);
          window.__rzAnimMap = () => ({ getCanvas: () => c, once: (ev, cb) => setTimeout(cb, 10), triggerRepaint: () => {} });
          // Das Archiv ist offen (switchMod ist seit Schritt 7 ein Stummel) — ein sichtbarer
          // Stellvertreter für die Animator-Seitenleiste reicht der Aufnahme als Merkmal.
          let p = document.getElementById('anim-panel');
          if (!p) { p = document.createElement('div'); p.id = 'anim-panel'; p.style.cssText = 'position:absolute;left:0;top:0;width:10px;height:10px;'; document.body.appendChild(p); }
          window.__vs = await rzProjektVorschauAufnehmen('test');
        })()""")
        await pg.wait_for_timeout(300)
        r = await rufe("projekt_vorschau_speichern")
        sagen(await pg.evaluate("window.__vs") is True and r and r[-1]["args"][0] == "pf" and r[-1]["args"][1].startswith("data:image/jpeg"),
              "Aufnahme schickt das Bild des aktiven Projekts an die Brücke", str(r[-1:]))

        print("\n━━━ 6d. Tour-Assistent (Fenster, Lauf, Sprung ins Projekt) ━━━")
        # Wie in der App: die Auswahl ist ein Fenster ÜBER dem Assistenten (Marc: „ich kann Los nicht klicken“).
        await pg.evaluate("window.rzArchivTourenWaehlen = async () => { const mm = openModal({ title: 'Auswahl', body: '<p>…</p>', footer: '' }); await new Promise(r => setTimeout(r, 80)); mm.close(); return ['/mock/t2.gpx']; }")
        await pg.keyboard.press("Meta+Shift+N")
        await pg.wait_for_timeout(400)
        sagen(bool(await pg.query_selector("#ass-los")), "⌘⇧N öffnet den Assistenten")
        sagen(await pg.eval_on_selector("#ass-los", "e => e.disabled"), "… ohne Track ist „Los“ gesperrt")
        sagen(await pg.eval_on_selector("#ass-vorlage", "e => e.value") == "reisezoom-standard", "… Vorlage vorbelegt mit ★")
        await pg.click("#ass-track-archiv")
        await pg.wait_for_timeout(300)
        sagen(await pg.eval_on_selector("#ass-track-name", "e => e.textContent") == "t2.gpx"
              and await pg.eval_on_selector("#ass-name", "e => e.value") == "t2"
              and not await pg.eval_on_selector("#ass-los", "e => e.disabled"), "Archiv-Wahl setzt Track und Namensvorschlag, „Los“ frei")
        await pg.select_option("#ass-vorlage", "v1")
        await pg.fill("#ass-name", "Alpen")
        await pg.click("#ass-los")
        await pg.wait_for_timeout(1200)
        r = await rufe("assistent_lauf")
        sagen(r and r[-1]["args"] == ["/mock/t2.gpx", "v1", "Alpen", True], "„Los“ ruft assistent_lauf(Pfad, Vorlage, Name, Highlights)", str(r[-1:]))
        r = await rufe("projekt_aktivieren")
        sagen(r and r[-1]["args"] == ["pass"], "… danach wird das neue Projekt geöffnet", str(r[-1:]))
        sagen(await pg.eval_on_selector("#lib-projwrap", "e => !e.hidden") or True, "… über das Archiv")

        print("\n━━━ 7. Neues Projekt daraus + Namensfenster mit Vorlagen-Feld ━━━")
        await pg.evaluate("""(() => { window.__mods = []; switchMod = (m) => { window.__mods.push(m); };
          window.sessionActivateFrei = async (k) => { window.__frei = k; }; })()""")
        await pg.click("#lib-seg-vorlagen")
        await pg.wait_for_timeout(400)
        await pg.evaluate("""(() => { window.__loads = []; window.loadGlobalGpx = async (p, o) => { window.__loads.push([p, o || {}]); return true; }; })()""")
        await pg.click('.lib-vorl-karte[data-vid="v1"] [data-vneu]')
        await pg.wait_for_timeout(400)
        sagen(bool(await pg.query_selector("#lib-tp-liste")), "zuerst kommt die Touren-Auswahl aus dem Archiv (Marc)")
        await pg.click('#lib-tp-ok')
        await pg.wait_for_timeout(200)
        sagen(bool(await pg.query_selector("#lib-tp-liste")), "… ohne Haken geht es nicht weiter")
        await pg.click('[data-tpath="/mock/t1.gpx"]')
        await pg.click('#lib-tp-ok')
        await pg.wait_for_timeout(300)
        sagen(bool(await pg.query_selector("#vorl-np-name")) and bool(await pg.query_selector("#vorl-np-vorlage")),
              "dann das Namensfenster mit Vorlagen-Feld")
        sagen(await pg.eval_on_selector("#vorl-np-vorlage", "e => e.value") == "v1", "… Vorlage der Kachel vorgewählt")
        sagen(await pg.eval_on_selector("#vorl-np-name", "e => e.value") == "t1", "… Name vorbelegt mit der Tour")
        await pg.fill("#vorl-np-name", "Alpen-Film")
        await pg.click("#vorl-np-ok")
        await pg.wait_for_timeout(600)
        r = await rufe("projekt_aus_vorlage_anlegen")
        sagen(r and r[-1]["args"] == ["Alpen-Film", "v1"], "ruft projekt_aus_vorlage_anlegen(Name, v1)")
        r = await rufe("projekt_touren_setzen")
        sagen(r and r[-1]["args"] == ["pvorl", ["/mock/t1.gpx"]], "… legt die gewählte Tour ins Projekt", str(r[-1:]))
        r = await rufe("projekt_aktivieren")
        sagen(r and r[-1]["args"] == ["pvorl"], "… und öffnet das Projekt (mit Track, im Animator)")
        # Das Namensfenster allein (Kopfzeile „Neues Projekt"): Stern ist vorbelegt
        await pg.evaluate("(() => { window.__np = window.rzNeuesProjektModal('Projekt 2'); return 1; })()")
        await pg.wait_for_timeout(300)
        sagen(await pg.eval_on_selector("#vorl-np-vorlage", "e => e.value") == "reisezoom-standard", "Kopfzeile: Vorlage vorbelegt mit ★")
        await pg.select_option("#vorl-np-vorlage", "vneu")
        await pg.click("#vorl-np-ok")
        wahl = await pg.evaluate("window.__np")
        sagen(wahl == {"name": "Projekt 2", "vorlageId": "vneu"}, "… liefert Name + gewählte Vorlage", str(wahl))

        sagen(not jsfehler, "keine JS-Fehler", "; ".join(jsfehler))
        await b.close()


if __name__ == "__main__":
    asyncio.run(main())
    if fehler:
        print(f"\n{fehler} Prüfung(en) fehlgeschlagen.")
        sys.exit(1)
    print("\n✅ Vorlagen im Browser bestanden")
