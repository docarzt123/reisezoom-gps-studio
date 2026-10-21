#!/usr/bin/env python3
"""Selbsttest „Orts-Schilder: Deckkraft und Größe wählbar“ (Highlights-Fenster).

Baut auf dem Gerüst von selftest_orte_paesse.py auf (Overpass-Welt, Brücke, headless Oberfläche).

Teil S (Übernehmen)
  S1  Orts-Schilder tragen `hl_quelle` "orte" und `hl_art` (stadt, dorf, pass)
  S1b ohne Projekt-Einstellung wie 0.9.798: Deckkraft 0,92, Dorf 17, sonst 20
  S1c übrige Highlights (OSM-Gipfel) ohne Markierung, Deckkraft 1
  S1d mindestens ein Dorf und ein Pass übernommen
Teil S2 bis S7 (Einstellungen im Fenster, Nachziehen, Rückfrage, Rückgängig)
  S2  Deckkraft 60 %: alle Orte 0,6, Größen unverändert, Projektwert, keine Frage; S2a übrige unverändert; S2b Regler nach Neuöffnen
  S3  Rückgängig: Orte wieder 0,92, Schlüssel weg
  S4  Größe 20 für alle (auch Dörfer); S4b 500 wird auf 60 begrenzt
  S5  Abweichung: Rückfrage mit Titel; S5b „Nichts ändern“ lässt alles, Regler springt zurück
  S6  „Alle angleichen“ zieht auch das Handschild nach
  S6a gleicher Wert nochmal: keine Frage
  S6b ein Undo nach „Alle angleichen“ stellt Schilder (auch Handschild) und Projektwert wieder her; gleicher Wert erzeugt keinen Schritt
  S7  neu übernommene Orte bekommen die Projektwerte
Teil S10 bis S12 (nur geänderte Eigenschaften, Rasterung, ohne Schilder)
  S10 „Alle angleichen“ schreibt nur die geänderte Eigenschaft; Frage nennt nur diese (S10a); Hand-Größe bleibt
  S11 Werte nahe am Soll (Deckkraft ±0,025, Größe ±1, wie nach dem Bearbeiten-Dialog) lösen keine Frage aus
  S12 ohne markierte Schilder nur Projektwert; S12b ein Undo stellt ihn wieder her
Ohne Oberfläche und übergreifend
  S8  Vorlage trägt hl_orte_opacity/hl_orte_size, keine Schilder
  S9  kein pageerror

Aufruf: python scripts/selftest_orte_schildstil.py      Ausgabe: OK/FAIL je Prüfung, am Ende RESULT: OK|FAIL
"""
# Import zuerst: setzt RZ_APP_ORDNER (Temp-Ordner) und sys.path, bevor irgendetwas anderes geladen wird.
import selftest_orte_paesse as op  # noqa: I001

import asyncio
import json
import sys
import tempfile
from pathlib import Path

from core import dateischutz as ds  # noqa: E402

ergebnisse = []


def pruefe(name, ok, info=""):
    ergebnisse.append(bool(ok))
    print(("OK   " if ok else "FAIL ") + name + (f"  [{str(info)[:400]}]" if info and not ok else ""))
    sys.stdout.flush()


SCHILDER_JS = """() => (getActiveProject().signs || []).map(x => ({
    text: x.text, opacity: x.opacity, size: x.size, accent: x.accent,
    hl_quelle: x.hl_quelle ?? null, hl_art: x.hl_art ?? null }))"""


async def schilder(page):
    return await page.evaluate(SCHILDER_JS)


def welt_bruecke():
    """Echte Brücke (app.Api) mit Overpass-Welt wie teil_b: Orte plus OSM-Gipfel „Hochkopf“."""
    import app as APP
    api = APP.Api()
    api.settings_set({"onboarding_done": True, "force_osm": False})
    welt = op.Welt(op.welt_ui())

    def falsch(q, timeout=0):
        if "out body qt" in q:
            return welt(q)
        return {"elements": [op.OSM_GIPFEL]}   # die OSM-Highlight-Abfrage
    op.chl._http_overpass = falsch
    return api


async def seite_oeffnen(p, api, gpx: Path, fehler):
    def bruecke(name, args_json):
        fn = getattr(api, name, None)
        if fn is None or name.startswith("_"):
            return json.dumps({"ok": False, "error": f"no bridge {name}"})
        try:
            return json.dumps(fn(*json.loads(args_json)), default=str)
        except Exception as e:  # noqa: BLE001
            return json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"})

    browser = await p.chromium.launch(headless=True, args=["--use-angle=default", "--enable-webgl", "--ignore-gpu-blocklist"])
    page = await browser.new_page(viewport={"width": 1400, "height": 900})
    page.on("pageerror", lambda e: fehler.append(str(e)[:300]))
    await page.expose_function("rzBridge", bruecke)
    await page.add_init_script(op.BRIDGE_JS)
    await page.goto(f"file://{(op.REPO / 'ui/index.html').resolve()}", wait_until="domcontentloaded")
    await page.wait_for_timeout(3000)
    await page.evaluate("window.switchMod('animator')")
    await page.wait_for_timeout(2500)
    await page.evaluate(f"() => window.loadGlobalGpx({json.dumps(str(gpx))})")
    await page.wait_for_function("() => Array.isArray(window.__rzSgSpur && window.__rzSgSpur.zeilen()) && !!window.__rzSignAnkerAusOrt", timeout=30000)
    await page.wait_for_timeout(4000)
    await page.evaluate("""() => { const d = document.getElementById('anim-dur'); d.value = 60;
        d.dispatchEvent(new Event('input', { bubbles: true })); d.dispatchEvent(new Event('change', { bubbles: true }));
        getActiveProject().signs = []; }""")
    await page.wait_for_timeout(500)
    return browser, page


async def fenster_oeffnen(page):
    await page.evaluate("document.getElementById('anim-signs-highlights').click()")
    await page.wait_for_function("() => !!document.getElementById('hl-q-orte')", timeout=10000)


async def fenster_zu(page):
    await page.evaluate("() => document.getElementById('hl-ab').click()")
    await page.wait_for_timeout(400)


async def setze(page, id_, wert):
    """Wert eines Bedienelements setzen und change auslösen (wie Loslassen des Reglers)."""
    await page.evaluate("""([id, w]) => { const e = document.getElementById(id); e.value = String(w);
        e.dispatchEvent(new Event('change', { bubbles: true })); }""", [id_, wert])
    await page.wait_for_timeout(500)


ZUSTAND_JS = """() => {
    const g = id => document.getElementById(id);
    const fr = g('hl-orte-frage');
    const p = getActiveProject().animator || {};
    return { deck: g('hl-orte-deckkraft')?.value, groesse: g('hl-orte-groesse')?.value,
             frage: !!fr && !fr.hidden && getComputedStyle(fr).display !== 'none', frage_text: fr ? fr.textContent : '',
             op: p.hl_orte_opacity ?? null, size: p.hl_orte_size ?? null };
}"""


async def zustand(page):
    return await page.evaluate(ZUSTAND_JS)


def orte_von(sg):
    return [s for s in sg if s["hl_quelle"] == "orte"]


def soll(s, op_, gr=None):
    return abs(s["opacity"] - op_) < 1e-9 and s["size"] == (gr if gr is not None else (17 if s["hl_art"] == "dorf" else 20))


async def alles_uebernehmen(page):
    await page.evaluate("() => document.querySelectorAll('.hl-zeile input[data-hlon]').forEach(c => { if (!c.checked) c.click(); })")
    await page.evaluate("() => document.getElementById('hl-uebernehmen').click()")
    await page.wait_for_timeout(1200)


async def fenster_suchen(page):
    """Highlights-Fenster öffnen, Haken osm + orte, suchen."""
    await fenster_oeffnen(page)
    await page.evaluate("""() => { for (const k of ['track', 'halte']) { const c = document.getElementById('hl-q-' + k); if (c.checked) c.click(); }
        for (const k of ['osm', 'orte']) { const o = document.getElementById('hl-q-' + k); if (!o.checked) o.click(); } }""")
    await page.evaluate("() => document.getElementById('hl-finden').click()")
    await page.wait_for_function("() => document.querySelectorAll('.hl-zeile').length > 0", timeout=60000)


async def teil_s(api, gpx: Path):
    from playwright.async_api import async_playwright
    fehler = []
    async with async_playwright() as p:
        browser, page = await seite_oeffnen(p, api, gpx, fehler)
        await fenster_suchen(page)
        # alles übernehmen: auch die vom Ausdünnen abgewählten Zeilen anhaken
        await alles_uebernehmen(page)
        sg = await schilder(page)
        orte = [s for s in sg if s["hl_quelle"] == "orte"]
        pruefe("S1 Orte markiert (hl_quelle, hl_art)", orte and all(s["hl_art"] in ("stadt", "dorf", "pass") for s in orte), sg[:2])
        pruefe("S1b ohne Einstellung wie 0.9.798: Deckkraft 0,92, Dorf 17, sonst 20",
               orte and all(abs(s["opacity"] - 0.92) < 1e-9 and s["size"] == (17 if s["hl_art"] == "dorf" else 20) for s in orte),
               [(s["hl_art"], s["opacity"], s["size"]) for s in orte[:3]])
        andere = [s for s in sg if s["hl_quelle"] is None]
        pruefe("S1c übrige Highlights (OSM-Gipfel) ohne Markierung, Deckkraft 1",
               andere and all(s["opacity"] == 1 for s in andere), [(s["text"], s["opacity"]) for s in andere[:3]])
        arten = {s["hl_art"] for s in orte}
        pruefe("S1d mindestens ein Dorf und ein Pass übernommen", "dorf" in arten and "pass" in arten, arten)
        await teil_s2(page)
        pruefe("S9 kein pageerror", not fehler, fehler[:3])
        await browser.close()


async def teil_s2(page):
    angleichen = "document.getElementById('hl-orte-angleichen').click()"
    nichts = "document.getElementById('hl-orte-nichts').click()"
    await fenster_oeffnen(page)
    await setze(page, "hl-orte-deckkraft", 60)
    sg = await schilder(page)
    orte = orte_von(sg)
    z = await zustand(page)
    pruefe("S2 Deckkraft 60 %: alle Orte 0,6, Größen unverändert, Projektwert 0,6, keine Frage",
           orte and all(soll(s, 0.6) for s in orte) and z["op"] == 0.6 and not z["frage"],
           [(s["hl_art"], s["opacity"], s["size"]) for s in orte[:3]] + [z])
    rest = [s["opacity"] for s in sg if s["hl_quelle"] is None]
    pruefe("S2a übrige Highlights unverändert (Deckkraft 1)", rest and all(o == 1 for o in rest), rest[:3])
    await fenster_zu(page)
    await fenster_oeffnen(page)
    z = await zustand(page)
    pruefe("S2b Fenster zu/auf: Regler zeigt 60, Größenfeld leer", z["deck"] == "60" and z["groesse"] == "", z)
    await fenster_zu(page)
    await page.evaluate("window.__rzUndoControllers.animator.undo()")
    await page.wait_for_timeout(600)
    sg = await schilder(page)
    z = await zustand(page)
    pruefe("S3 Rückgängig: Orte wieder 0,92 und Schlüssel hl_orte_opacity fehlt",
           orte_von(sg) and all(soll(s, 0.92) for s in orte_von(sg)) and z["op"] is None,
           [z] + [s["opacity"] for s in orte_von(sg)[:3]])
    await fenster_oeffnen(page)
    await setze(page, "hl-orte-deckkraft", 60)
    await setze(page, "hl-orte-groesse", 20)
    sg = await schilder(page)
    pruefe("S4 Größe 20: alle Orte 20 (auch Dörfer)",
           all(s["size"] == 20 and abs(s["opacity"] - 0.6) < 1e-9 for s in orte_von(sg)),
           [(s["hl_art"], s["opacity"], s["size"]) for s in orte_von(sg)[:4]])
    await setze(page, "hl-orte-groesse", 500)
    z = await zustand(page)
    pruefe("S4b Größe 500 wird auf 60 begrenzt", z["size"] == 60 and z["groesse"] == "60", z)
    await setze(page, "hl-orte-groesse", 20)
    # ein Orts-Schild von Hand auf 0,3, dann Regler auf 50
    await page.evaluate("() => { getActiveProject().signs.find(s => s.hl_quelle === 'orte').opacity = 0.3; }")
    await setze(page, "hl-orte-deckkraft", 50)
    z = await zustand(page)
    pruefe("S5 Abweichung: Frage sichtbar mit Titel, Text und Knöpfen",
           z["frage"] and "Einzelne Orte/Pässe haben eigene Werte." in z["frage_text"]
           and "Alle Orts- und Pass-Schilder auf Deckkraft 50 % setzen?" in z["frage_text"]
           and "Alle angleichen" in z["frage_text"] and "Nichts ändern" in z["frage_text"], z)
    await page.evaluate(nichts)
    await page.wait_for_timeout(500)
    orte = orte_von(await schilder(page))
    z = await zustand(page)
    pruefe("S5b Nichts ändern: Handschild 0,3, übrige 0,6, Projektwert 0,6, Regler wieder 60, Frage zu",
           abs(orte[0]["opacity"] - 0.3) < 1e-9 and all(abs(s["opacity"] - 0.6) < 1e-9 for s in orte[1:])
           and z["op"] == 0.6 and z["deck"] == "60" and not z["frage"], [z, [s["opacity"] for s in orte[:3]]])
    await setze(page, "hl-orte-deckkraft", 50)
    await page.evaluate(angleichen)
    await page.wait_for_timeout(500)
    orte = orte_von(await schilder(page))
    z = await zustand(page)
    pruefe("S6 Alle angleichen: alle Orte 0,5 inkl. Handschild, Projektwert 0,5, Frage zu",
           all(abs(s["opacity"] - 0.5) < 1e-9 for s in orte) and z["op"] == 0.5 and not z["frage"],
           [z, [s["opacity"] for s in orte[:3]]])
    # gleicher Wert nochmal: kein Undo-Schritt und keine Frage; ein Undo macht dann genau S6 rückgängig
    await setze(page, "hl-orte-deckkraft", 50)
    z = await zustand(page)
    pruefe("S6a gleicher Wert: keine Frage", not z["frage"], z)
    await fenster_zu(page)
    await page.evaluate("window.__rzUndoControllers.animator.undo()")
    await page.wait_for_timeout(600)
    orte = orte_von(await schilder(page))
    z = await zustand(page)
    pruefe("S6b ein Undo nach Angleichen (gleicher Wert ohne Schritt): Handschild 0,3, übrige 0,6, Projektwert 0,6",
           abs(orte[0]["opacity"] - 0.3) < 1e-9 and all(abs(s["opacity"] - 0.6) < 1e-9 for s in orte[1:]) and z["op"] == 0.6,
           [z, [s["opacity"] for s in orte[:3]]])
    await fenster_oeffnen(page)
    await setze(page, "hl-orte-deckkraft", 50)
    await page.evaluate(angleichen)
    await page.wait_for_timeout(500)
    # alle Orts-Schilder löschen, erneut suchen und übernehmen
    await fenster_zu(page)
    await page.evaluate("() => { const p = getActiveProject(); p.signs = p.signs.filter(s => s.hl_quelle !== 'orte'); }")
    await fenster_suchen(page)
    await alles_uebernehmen(page)
    orte = orte_von(await schilder(page))
    pruefe("S7 neu übernommene Orte bekommen 0,5 und Größe 20", orte and all(soll(s, 0.5, 20) for s in orte),
           [(s["hl_art"], s["opacity"], s["size"]) for s in orte[:3]])
    await teil_s3(page)


async def orte_setzen(page, op_, gr, erstes=None):
    """Alle Orts-Schilder auf (Deckkraft, Größe) setzen, das erste ggf. auf eigene Werte."""
    await page.evaluate("""([o, g, e]) => { let i = 0;
        for (const s of getActiveProject().signs) if (s.hl_quelle === 'orte') {
            s.opacity = (i === 0 && e) ? e[0] : o; s.size = (i === 0 && e) ? e[1] : g; i++; } }""", [op_, gr, erstes])


async def teil_s3(page):
    angleichen = "document.getElementById('hl-orte-angleichen').click()"
    await fenster_oeffnen(page)
    # S10: Hand-Größe überlebt eine reine Deckkraft-Änderung
    await orte_setzen(page, 0.5, 20, (0.3, 30))
    await setze(page, "hl-orte-deckkraft", 70)
    z = await zustand(page)
    pruefe("S10a Frage nennt nur die Deckkraft", z["frage"] and "Deckkraft 70 %" in z["frage_text"] and "Größe" not in z["frage_text"], z)
    await page.evaluate(angleichen)
    await page.wait_for_timeout(500)
    orte = orte_von(await schilder(page))
    pruefe("S10 nur Deckkraft angeglichen: alle 0,7, Hand-Größe 30 bleibt, übrige Größe 20",
           all(abs(s["opacity"] - 0.7) < 1e-9 for s in orte) and orte[0]["size"] == 30 and all(s["size"] == 20 for s in orte[1:]),
           [(s["opacity"], s["size"]) for s in orte[:3]])
    # S11: vom Bearbeiten-Dialog eingerastete Werte (kleine Abweichung) lösen keine Frage aus
    await orte_setzen(page, 0.7, 20, (0.68, 21))
    await setze(page, "hl-orte-deckkraft", 80)
    z = await zustand(page)
    orte = orte_von(await schilder(page))
    pruefe("S11 Abweichung innerhalb der Rasterung (0,68 / 21): keine Frage, alle 0,8",
           not z["frage"] and z["op"] == 0.8 and all(abs(s["opacity"] - 0.8) < 1e-9 for s in orte), [z, [s["opacity"] for s in orte[:3]]])
    # S12: ohne markierte Schilder nur der Projektwert, genau ein Undo-Schritt
    await fenster_zu(page)
    await page.evaluate("() => { const p = getActiveProject(); p.signs = p.signs.filter(s => s.hl_quelle !== 'orte'); }")
    await fenster_oeffnen(page)
    await setze(page, "hl-orte-deckkraft", 40)
    z = await zustand(page)
    pruefe("S12 ohne markierte Schilder: Projektwert 0,4 gesetzt, keine Frage", z["op"] == 0.4 and not z["frage"], z)
    await fenster_zu(page)
    await page.evaluate("window.__rzUndoControllers.animator.undo()")
    await page.wait_for_timeout(600)
    z = await zustand(page)
    pruefe("S12b ein Undo stellt den Projektwert 0,8 wieder her", z["op"] == 0.8, z)


def teil_vorlagen():
    from core import vorlagen
    v = vorlagen.aus_projekt({"animator": {"hl_orte_opacity": 0.6, "hl_orte_size": 20, "signs": [{"text": "x"}]},
                              "tourmap": {"hl_orte_opacity": 0.5}})
    pruefe("S8 Vorlage trägt hl_orte_opacity/hl_orte_size, keine Schilder",
           v["animator"].get("hl_orte_opacity") == 0.6 and v["animator"].get("hl_orte_size") == 20
           and "signs" not in v["animator"] and v["tourmap"].get("hl_orte_opacity") == 0.5)


def main():
    teil_vorlagen()
    with tempfile.TemporaryDirectory(prefix="rz-orte-stil-") as tmp:
        tmp = Path(tmp)
        ds.temp_ordner_merken(tmp)
        gpx = tmp / "hin-und-zurueck.gpx"
        op.gpx_schreiben(gpx, op.hin_und_zurueck(60_000))
        try:
            api = welt_bruecke()
            asyncio.run(teil_s(api, gpx))
        except Exception as e:  # noqa: BLE001
            import traceback
            traceback.print_exc()
            pruefe("S Lauf ohne Ausnahme", False, f"{type(e).__name__}: {str(e).splitlines()[0][:200]}")


if __name__ == "__main__":
    main()
    ok = bool(ergebnisse) and all(ergebnisse)
    print("RESULT: " + ("OK" if ok else "FAIL"))
    sys.exit(0 if ok else 1)
