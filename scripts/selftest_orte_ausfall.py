#!/usr/bin/env python3
"""Selbsttest "Orte-Ausfall wird eindeutig gemeldet" (Highlights-Fenster, 19.10.2026).

Fällt Overpass für "Orte und Pässe" aus, soll das Fenster das klar sagen und einen erneuten Versuch anbieten. Dazu
meldet `highlights_vorschlaege` bei gesetzter Quelle `orte` zusätzlich `orte_netz` (False = Overpass für Orte nicht
erreichbar). Overpass wird nie gefragt: die HTTP-Schicht ist durch die "Welt" aus selftest_orte_paesse.py ersetzt.

Teil B (app.Api.highlights_vorschlaege, echte Brücke, Temp-App-Ordner)
  B1  Ausfall: `orte_netz` False, die Track-Zeilen sind trotzdem da
  B2  Teilantwort (Server bricht ab): `orte_unvollstaendig` True, `orte_netz` True
  B3  behoben, nur Quelle orte: `orte_netz` True, nur Orts-Zeilen
  B4  ohne Quelle orte: kein `orte_netz`

Teil K (Highlights-Fenster, headless Playwright mit der echten Brücke; das Intervall wird über
`window.__rzHlOrteWdh.s` verkürzt; `--ohne-ui` überspringt ihn)
  K1  Ausfall: Kasten mit Warnklasse und "Erneut versuchen", Track-Zeilen sichtbar
  K1b ohne Haken orte (und OSM fällt aus): kein Kasten
  K1c Vorbereitung: Track-Zeile mit eigenem Text und abgehakt
  K2  erneuter Fehlschlag: Knopf "Automatisch wiederholen"
  K3  Anzeige "Versuch 1 von 10"
  K4  Erfolg: Kasten grün, Orts-Zeilen da (nach Strecke sortiert), Text und Häkchen der Track-Zeile erhalten, ids eindeutig
  K5  dauerhafter Ausfall: nach 10 Versuchen "aufgegeben", genau 10 weitere Abfragen
  K6  Schließen beendet die Wiederholung (keine Abfragen, kein pageerror); beim Wiederöffnen steht der Warn-Kasten wieder da
  K7  Abbrechen mitten in einer Abfrage verwirft deren Antwort (keine neuen Zeilen, Kasten bleibt Warnung)
  K8  Teilantwort der Wiederholung ersetzt die Orts-Zeilen, der Kasten bleibt Warnung
  K9  Wiederholung gelingt: OSM-Vorschlag mit dem Namen eines Passes und "Höchster Punkt" am Pass werden abgewählt (mit
      Grund), eigene Änderungen an anderen Zeilen bleiben
  K10 Statuszeile nach dem Erfolg: kein "nicht erreichbar" mehr, neue Zahl der Orte und Pässe
  K11 während einer laufenden Abfrage zeigt der Zähler "sucht", nicht "nächster in 0:00"

Aufruf: python scripts/selftest_orte_ausfall.py [--ohne-ui]   Ausgabe: OK/FAIL je Prüfung, am Ende RESULT: OK|FAIL
"""
import asyncio
import json
import math
import re
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import selftest_orte_paesse as op  # noqa: E402,I001  (zuerst: setzt RZ_APP_ORDNER auf einen Temp-Ordner)

from core import dateischutz as ds  # noqa: E402

chl = op.chl
ergebnisse = []


def pruefe(name, ok, info=""):
    ergebnisse.append(bool(ok))
    print(("OK   " if ok else "FAIL ") + name + (f"  [{str(info)[:400]}]" if info and not ok else ""))
    sys.stdout.flush()


def teil_b(gpx: Path):
    import app as APP
    api = APP.Api()
    api.settings_set({"onboarding_done": True, "force_osm": False})
    welt = op.Welt(op.welt_ui())
    chl._http_overpass = lambda q, timeout=0: welt(q)
    nur_track = {"osm": False, "track": True, "halte": False, "orte": True}

    welt.kaputt_ab = 1
    r = api.highlights_vorschlaege(str(gpx), [], nur_track)
    pruefe("B1 Ausfall: orte_netz False, Track-Zeilen trotzdem da",
           r["ok"] and r.get("orte_netz") is False and any(v["grund"] == "track" for v in r.get("vorschlaege") or []),
           (r.get("error"), r.get("orte_netz")))

    welt.kaputt_ab = None
    welt.remark_ab_kaesten = 1   # jeder Kasten wird vom Server abgebrochen
    r = api.highlights_vorschlaege(str(gpx), [], nur_track)
    pruefe("B2 Teilantwort: orte_unvollstaendig True, orte_netz True",
           r["ok"] and r.get("orte_unvollstaendig") is True and r.get("orte_netz") is True,
           (r.get("error"), r.get("orte_unvollstaendig"), r.get("orte_netz")))

    welt.remark_ab_kaesten = 0
    r = api.highlights_vorschlaege(str(gpx), [], {"osm": False, "track": False, "halte": False, "orte": True})
    pruefe("B3 behoben, nur Quelle orte: orte_netz True, nur Orts-Zeilen",
           r.get("orte_netz") is True and (r.get("vorschlaege") or []) and all(v["grund"] == "orte" for v in r.get("vorschlaege") or []),
           (r.get("error"), r.get("orte_netz"), len(r.get("vorschlaege") or [])))

    r = api.highlights_vorschlaege(str(gpx), [], {"osm": False, "track": True, "halte": False, "orte": False})
    pruefe("B4 ohne Quelle orte: kein orte_netz", r["ok"] and "orte_netz" not in r, list(r))
    return APP, api, welt


ZEILEN_JS = """() => Array.from(document.querySelectorAll('.hl-zeile')).map(z => ({
    id: z.dataset.id, text: z.querySelector('textarea').value, an: z.querySelector('input[data-hlon]').checked,
    km: parseFloat((z.querySelector('.hl-meta b') || {}).textContent) || 0,
    grund: (z.querySelector('.hl-meta .muted') || {}).textContent || '' }))"""
KASTEN_JS = """() => { const k = document.getElementById('hl-orte-kasten');
    return k ? { sichtbar: !k.hidden, klasse: k.className, text: k.textContent, nochmal: !!document.getElementById('hl-orte-nochmal'),
                 auto: !!document.getElementById('hl-orte-auto'), abbrechen: !!document.getElementById('hl-orte-abbrechen') } : null; }"""


async def teil_k(APP, api, welt, gpx: Path):
    from playwright.async_api import async_playwright

    orte_abfragen = []
    echt = api.highlights_vorschlaege

    def zaehlen(pfad, quellen_ordner, quellen):
        if quellen.get("orte") and not quellen.get("track"):   # nur die stille Neuabfrage der Orte
            orte_abfragen.append(1)
        return echt(pfad, quellen_ordner, quellen)

    api.highlights_vorschlaege = zaehlen
    cache = APP.APP_SUPPORT / "orte_paesse_cache.json"

    def bruecke(name, args_json):
        fn = getattr(api, name, None)
        if fn is None or name.startswith("_"):
            return json.dumps({"ok": False, "error": f"no bridge {name}"})
        try:
            return json.dumps(fn(*json.loads(args_json)), default=str)
        except Exception as e:  # noqa: BLE001
            return json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"})

    def ausfall():
        cache.unlink(missing_ok=True)   # sonst würde der Cache den Ausfall verdecken
        welt.kaputt_ab = 1

    modus = {"langsam": 0.0, "teilantwort": False, "orte_aus": False, "osm_poi": False}
    pass_poi = {"type": "node", "id": 9002, "lat": op.pos(20_000, 50)[0], "lon": op.pos(20_000, 50)[1],
                "tags": {"natural": "peak", "name": "Doppelpass", "ele": "1650"}}

    def http(q, timeout=0):
        if modus["langsam"]:
            time.sleep(modus["langsam"])   # hält die Abfrage lange genug "in der Luft"
        if "out body qt" not in q and modus["osm_poi"]:   # OSM-Highlight-Abfrage: ein Gipfel mit dem Namen des Passes
            return {"elements": [pass_poi]}
        if "out body qt" in q and modus["orte_aus"]:
            raise OSError("HTTP Error 504: Gateway Timeout")
        antwort = welt(q)
        if modus["teilantwort"]:   # Server liefert Orte, meldet aber einen Abbruch
            antwort = dict(antwort, remark='runtime error: Query timed out in "query" at line 1 after 46 seconds.')
        return antwort

    chl._http_overpass = http

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--use-angle=default", "--enable-webgl", "--ignore-gpu-blocklist"])
        page = await browser.new_page(viewport={"width": 1400, "height": 900})
        fehler = []
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
        await page.evaluate("() => { getActiveProject().signs = []; }")

        async def oeffnen():
            await page.evaluate("document.getElementById('anim-signs-highlights').click()")
            await page.wait_for_function("() => !!document.getElementById('hl-q-orte')", timeout=10000)

        async def finden():
            await page.evaluate("() => document.getElementById('hl-finden').click()")
            await page.wait_for_function("() => !document.getElementById('hl-finden').disabled", timeout=60000)

        async def haken(osm, track, orte):
            await page.evaluate("""([osm, track, orte]) => { const w = { osm, track, halte: false, orte };
                for (const k in w) { const c = document.getElementById('hl-q-' + k); if (c.checked !== w[k]) c.click(); } }""",
                                [osm, track, orte])

        await oeffnen()
        await page.evaluate("() => { window.__rzHlOrteWdh.s = 1; }")

        # K1b: Haken orte aus, Overpass fällt aus (OSM-Quelle): kein Kasten
        ausfall()
        await haken(True, True, False)
        await finden()
        k = await page.evaluate(KASTEN_JS)
        pruefe("K1b Haken orte aus, OSM fällt aus: kein Kasten", k is not None and not k["sichtbar"] and not k["text"], k)

        # K1
        await haken(False, True, True)
        ausfall()
        await finden()
        k = await page.evaluate(KASTEN_JS)
        zeilen = await page.evaluate(ZEILEN_JS)
        pruefe("K1 Ausfall: Kasten mit Warnklasse und „Erneut versuchen“, Track-Zeilen sichtbar",
               k and k["sichtbar"] and "hl-orte-warn" in k["klasse"] and "überlastet" in k["text"] and k["nochmal"] and not k["auto"]
               and len(zeilen) >= 1, (k, len(zeilen)))

        # Eigene Änderungen an der Track-Zeile (die Teststrecke liefert genau eine): eigener Text, abgehakt
        await page.evaluate("""() => { const t = document.querySelector('.hl-zeile textarea');
            t.value = 'Eigener Text'; t.dispatchEvent(new Event('input', { bubbles: true }));
            document.querySelector('.hl-zeile input[data-hlon]').click(); }""")
        vorher = (await page.evaluate(ZEILEN_JS))[:1]
        pruefe("K1c Vorbereitung: Track-Zeile mit eigenem Text und abgehakt", vorher and vorher[0]["text"] == "Eigener Text" and vorher[0]["an"] is False, vorher)
        await page.evaluate("() => document.getElementById('hl-orte-nochmal').click()")
        await page.wait_for_function("() => !!document.getElementById('hl-orte-auto')", timeout=30000)
        k = await page.evaluate(KASTEN_JS)
        pruefe("K2 erneut Fehlschlag: Knopf „Automatisch wiederholen“ erscheint",
               k["auto"] and k["nochmal"] and "hl-orte-warn" in k["klasse"], k)

        orte_abfragen.clear()
        await page.evaluate("() => document.getElementById('hl-orte-auto').click()")
        k = await page.evaluate(KASTEN_JS)
        pruefe("K3 Anzeige „Versuch 1 von 10“", "Versuch 1 von 10, nächster in" in k["text"] and k["abbrechen"], k)

        welt.kaputt_ab = None   # Overpass wieder da
        await page.wait_for_function("() => document.getElementById('hl-orte-kasten').classList.contains('hl-orte-ok')", timeout=30000)
        k = await page.evaluate(KASTEN_JS)
        nachher = await page.evaluate(ZEILEN_JS)
        orte = [z for z in nachher if z["id"].startswith("w")]
        ids = [z["id"] for z in nachher]
        track = [z for z in nachher if z["id"] == vorher[0]["id"]]
        kms = [z["km"] for z in nachher]
        pruefe("K4 Erfolg: Kasten grün, Orts-Zeilen da (nach Strecke sortiert), Text und Häkchen der Track-Zeile erhalten, ids eindeutig",
               "vollständig" in k["text"] and orte and track == vorher and track[0]["text"] == "Eigener Text"
               and track[0]["an"] is False and len(set(ids)) == len(ids) and kms == sorted(kms), (k, nachher[:3], len(orte), kms))

        # K5: dauerhafter Ausfall, schnelles Intervall
        await page.evaluate("() => { window.__rzHlOrteWdh.s = 0.2; }")
        ausfall()
        await finden()
        await page.evaluate("() => document.getElementById('hl-orte-nochmal').click()")
        await page.wait_for_function("() => !!document.getElementById('hl-orte-auto')", timeout=30000)
        orte_abfragen.clear()
        await page.evaluate("() => document.getElementById('hl-orte-auto').click()")
        await page.wait_for_function(
            "() => /Nach 10 Versuchen weiterhin nicht erreichbar/.test(document.getElementById('hl-orte-kasten').textContent)", timeout=60000)
        await page.wait_for_timeout(1000)
        k = await page.evaluate(KASTEN_JS)
        pruefe("K5 nach 10 Versuchen „Nach 10 Versuchen weiterhin nicht erreichbar“, genau 10 weitere Abfragen",
               len(orte_abfragen) == 10 and k["nochmal"] and "hl-orte-warn" in k["klasse"], (len(orte_abfragen), k))

        # K6: Schließen beendet die Wiederholung
        await page.evaluate("() => document.getElementById('hl-orte-nochmal').click()")
        await page.wait_for_function("() => !!document.getElementById('hl-orte-auto')", timeout=30000)
        await page.evaluate("() => { window.__rzHlOrteWdh.s = 0.5; document.getElementById('hl-orte-auto').click(); }")
        await page.wait_for_function(
            "() => /Versuch [2-9] von 10/.test(document.getElementById('hl-orte-kasten').textContent)", timeout=30000)
        await page.evaluate("() => document.getElementById('hl-ab').click()")
        await page.wait_for_timeout(1500)   # eine laufende Abfrage ausklingen lassen
        n0 = len(orte_abfragen)
        await page.wait_for_timeout(2000)   # vier Intervalle
        await oeffnen()
        k = await page.evaluate(KASTEN_JS)
        pruefe("K6 Schließen beendet die Wiederholung: keine weiteren Abfragen, kein pageerror; Wiederöffnen zeigt den Warn-Kasten wieder",
               len(orte_abfragen) == n0 and not fehler and k is not None and k["sichtbar"] and "hl-orte-warn" in k["klasse"]
               and k["nochmal"] and k["auto"] and not k["abbrechen"],
               (n0, len(orte_abfragen), fehler[:3], k))

        # K7: "Abbrechen" verwirft eine laufende Abfrage: ihre (erfolgreiche) Antwort ändert weder Zeilen noch Kasten
        # (K11: solange die Abfrage läuft, zeigt der Zähler "sucht")
        await page.evaluate("() => { window.__rzHlOrteWdh.s = 1; }")
        ausfall()
        await finden()
        await page.evaluate("() => document.getElementById('hl-orte-nochmal').click()")
        await page.wait_for_function("() => !!document.getElementById('hl-orte-auto')", timeout=60000)
        zeilen_vorher = len(await page.evaluate(ZEILEN_JS))
        welt.kaputt_ab = None   # Overpass ist wieder da: die laufende Abfrage würde gelingen
        modus["langsam"] = 1.0
        cache.unlink(missing_ok=True)
        orte_abfragen.clear()
        # Die erste Abfrage beginnt nach 1 s und dauert 1 s; nach 1,3 s läuft sie: Zähler lesen, dann Abbrechen
        await page.evaluate("""() => { document.getElementById('hl-orte-auto').click();
            setTimeout(() => { window.__zaehlerLaeuft = (document.querySelector('.hl-orte-zaehler') || {}).textContent;
                document.getElementById('hl-orte-abbrechen').click(); }, 1300); }""")
        await page.wait_for_timeout(3500)   # verworfene Abfrage ist zurück
        k = await page.evaluate(KASTEN_JS)
        zaehler = await page.evaluate("() => window.__zaehlerLaeuft")
        zeilen_nachher = len(await page.evaluate(ZEILEN_JS))
        modus["langsam"] = 0.0
        pruefe("K11 laufende Abfrage: Zähler zeigt „sucht“ statt „nächster in 0:00“",
               zaehler and "sucht" in zaehler and "nächster" not in zaehler, zaehler)
        pruefe("K7 Abbrechen mitten in einer Abfrage: Antwort verworfen (keine neuen Zeilen, Kasten bleibt Warnung mit Wiederholungs-Knopf)",
               len(orte_abfragen) >= 1 and zeilen_nachher == zeilen_vorher and "hl-orte-warn" in k["klasse"] and k["auto"] and not k["abbrechen"],
               (len(orte_abfragen), zeilen_vorher, zeilen_nachher, k))

        # K8: Teilantwort der Wiederholung ersetzt die Orts-Zeilen, der Kasten bleibt Warnung
        ausfall()
        await finden()
        vorher_orte = await page.evaluate(ZEILEN_JS)
        welt.kaputt_ab = None
        modus["teilantwort"] = True
        cache.unlink(missing_ok=True)
        await page.evaluate("() => document.getElementById('hl-orte-nochmal').click()")
        await page.wait_for_function("() => !!document.getElementById('hl-orte-auto')", timeout=60000)
        k = await page.evaluate(KASTEN_JS)
        zeilen = await page.evaluate(ZEILEN_JS)
        orte = [z for z in zeilen if z["id"].startswith("w")]
        pruefe("K8 Teilantwort der Wiederholung: Orts-Zeilen aktualisiert, Kasten bleibt Warnung",
               len(orte) > len(vorher_orte) and "hl-orte-warn" in k["klasse"] and k["auto"], (len(vorher_orte), len(orte), k))
        modus["teilantwort"] = False

        # K9/K10: Strecke mit Hügel am Pass (Höchster Punkt bei 20 km), OSM liefert einen Gipfel namens "Doppelpass",
        # nur Overpass für die Orte fällt aus. Gelingt die Wiederholung, müssen beide Zeilen abgewählt sein wie im Backend.
        await page.evaluate("() => document.getElementById('hl-ab').click()")
        hang = op.hin_und_zurueck(60_000)
        for p_ in hang:
            m_ = (p_["lon"] - op.LON0) * op.KX
            p_["ele"] = 500.0 + 400.0 * math.exp(-(((m_ - 20_000.0) / 2500.0) ** 2))
        gpx2 = gpx.with_name("huegel.gpx")
        op.gpx_schreiben(gpx2, hang)
        await page.evaluate(f"() => window.loadGlobalGpx({json.dumps(str(gpx2))})")
        await page.wait_for_function("() => Array.isArray(window.__rzSgSpur && window.__rzSgSpur.zeilen()) && !!window.__rzSignAnkerAusOrt", timeout=30000)
        await page.wait_for_timeout(4000)
        await page.evaluate("() => { getActiveProject().signs = []; }")
        await oeffnen()
        await haken(True, True, True)
        modus["osm_poi"] = True
        modus["orte_aus"] = True
        welt.kaputt_ab = None
        cache.unlink(missing_ok=True)
        await finden()
        rows0 = await page.evaluate(ZEILEN_JS)
        status0 = await page.evaluate("() => document.getElementById('hl-status').textContent")
        poi0 = [z for z in rows0 if "Doppelpass" in z["text"] and not z["id"].startswith("w")]
        hoch0 = [z for z in rows0 if re.search("Höchster|Highest", z["text"])]
        sonst = [z for z in rows0 if z not in poi0 and z not in hoch0]
        k = await page.evaluate(KASTEN_JS)
        pruefe("K9a Vorbereitung: Ausfall nur der Orte, OSM-Gipfel „Doppelpass“ und „Höchster Punkt“ angehakt",
               k["sichtbar"] and len(poi0) == 1 and poi0[0]["an"] and len(hoch0) == 1 and hoch0[0]["an"]
               and not any(z["id"].startswith("w") for z in rows0), (k, [(z["text"], z["an"], z["grund"]) for z in rows0]))
        eigene = None
        if sonst:
            eigene = sonst[0]["id"]
            await page.evaluate("""(id) => { const t = document.querySelector(`[data-hltext="${id}"]`);
                t.value = 'Eigener Text 2'; t.dispatchEvent(new Event('input', { bubbles: true })); }""", eigene)
        modus["orte_aus"] = False
        cache.unlink(missing_ok=True)
        await page.evaluate("() => document.getElementById('hl-orte-nochmal').click()")
        await page.wait_for_function("() => document.getElementById('hl-orte-kasten').classList.contains('hl-orte-ok')", timeout=30000)
        rows1 = {z["id"]: z for z in await page.evaluate(ZEILEN_JS)}
        poi1, hoch1 = rows1.get(poi0[0]["id"]), rows1.get(hoch0[0]["id"])
        pruefe("K9 OSM-Gipfel mit dem Namen des Passes und „Höchster Punkt“ am Pass sind abgewählt (mit Grund), nicht gelöscht",
               poi1 and not poi1["an"] and "abgewählt" in poi1["grund"] and hoch1 and not hoch1["an"] and "abgewählt" in hoch1["grund"],
               (poi1, hoch1))
        pruefe("K9b eigene Änderung an einer anderen Zeile bleibt",
               eigene is None or (rows1[eigene]["text"] == "Eigener Text 2" and rows1[eigene]["an"] == sonst[0]["an"]),
               (eigene, rows1.get(eigene)))
        status1 = await page.evaluate("() => document.getElementById('hl-status').textContent")
        n_orte = sum(1 for z in rows1.values() if z["id"].startswith("w"))
        zahl = re.search(r"(\d+) Orte und Pässe", status1)
        pruefe("K10 Statuszeile nach dem Erfolg: Ausfall-Hinweis zuvor da, jetzt weg; neue Zahl der Orte und Pässe",
               "nicht erreichbar" in status0 and "nicht erreichbar" not in status1 and "nicht alle Orte" not in status1
               and zahl and int(zahl.group(1)) == n_orte > 0, (status0, status1, n_orte))
        modus["osm_poi"] = False
        await browser.close()


def main():
    with tempfile.TemporaryDirectory(prefix="rz-orte-ausfall-") as tmp:
        tmp = Path(tmp)
        ds.temp_ordner_merken(tmp)
        gpx = tmp / "hin-und-zurueck.gpx"
        op.gpx_schreiben(gpx, op.hin_und_zurueck(60_000))
        try:
            APP, api, welt = teil_b(gpx)
        except Exception as e:  # noqa: BLE001
            import traceback
            traceback.print_exc()
            pruefe("B Lauf ohne Ausnahme", False, f"{type(e).__name__}: {e}")
            return
        if "--ohne-ui" not in sys.argv:
            try:
                asyncio.run(teil_k(APP, api, welt, gpx))
            except Exception as e:  # noqa: BLE001
                pruefe("K Lauf ohne Ausnahme", False, f"{type(e).__name__}: {str(e).splitlines()[0][:200]}")


if __name__ == "__main__":
    main()
    ok = all(ergebnisse)
    print("RESULT: " + ("OK" if ok else "FAIL"))
    sys.exit(0 if ok else 1)
