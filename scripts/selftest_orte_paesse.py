#!/usr/bin/env python3
"""Selbsttest „Orte und Pässe entlang der Strecke“ (Highlights-Fenster, 18.10.2026).

Wunsch aus der Community (PR #11): für einen Motorradtag die Städte und Dörfer, durch die man fährt, und die Pässe, über
die man fährt — als Schilder. Overpass wird hier nie gefragt: die HTTP-Schicht ist durch eine kleine „Welt“ ersetzt, die
jede Kasten-Abfrage wie der Server beantwortet.

Teil A (core/highlights.orte_und_paesse, ohne Netz)
  A1  500 km Strecke: zwei Overpass-Anfragen (nicht fünfzig), Fortschritt je Anfrage gemeldet
  A2  Orte entlang der langen Strecke: jedes Dorf bis 1,5 km, Kleinstädte bis 3 km, Städte bis 5 km — weiter weg nicht
  A3  Pass bis 150 m mit Höhe („Name\\n2094 m“), weiter weg nicht; `strecke_m` = Meter ab Start der Durchfahrt
  A4  Hin und zurück: Pass und Dorf auf dem Weg je zweimal (eigene `strecke_m`), Wendepass einmal
  A5  Cache: zweiter Lauf ohne Anfrage; höchstens ORTE_CACHE_MAX Einträge, Abgelaufenes fliegt raus, eindeutige Temp-Namen
  A6  Netz weg mittendrin: Teilergebnis, `netz` False, beim nächsten Mal nur die fehlende Anfrage
  A7  `remark` (Server bricht ab): viele Kästen → in zwei Hälften neu; ein Kasten → `unvollstaendig`, nicht gemerkt
  A8  Doppelte: town+village gleichen Namens an einer Stelle → einer; zwei gleichnamige Orte weit auseinander → beide;
      ein Gipfel, der wie ein Dorf heißt, ist keine Dublette (nur gleicher Name UND nah)
  A9  Namen: lokaler Name, „St.“ = „Sankt“
  A10 Auswertung von 10 000 Punkten × ~300 Orten in unter 3 s
Teil B (app.Api.highlights_vorschlaege, echte Brücke, Temp-App-Ordner)
  B1  ohne Haken: keine Orte-Abfrage; mit Haken: Zeilen `grund` orte mit `strecke_m`, Linien-Symbol, kein Bildzeichen
  B2  Fortschritt „Abschnitt i von n“ in der Wartemeldung; ein Gipfel gleichen Namens bleibt bei den OSM-Vorschlägen
Teil C (echte Oberfläche headless an der echten Brücke)
  C1  Highlights-Fenster: Haken „Orte und Pässe entlang der Strecke“, Standard aus; Liste mit Strich-Symbolen
  C2  dichte Orte: höchstens 3 Schilder gleichzeitig — der Rest ist in der Liste abgewählt (mit Grund), Pässe bleiben
  C3  Übernehmen: Stecknadeln mit `strecke_m`; der zweite Pass-Besuch liegt zeitlich an SEINER Durchfahrt

Aufruf: python scripts/selftest_orte_paesse.py      Ausgabe: OK/FAIL je Prüfung, am Ende RESULT: OK|FAIL
"""
import asyncio
import atexit
import json
import math
import os
import re
import shutil
import sys
import tempfile
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
APP_ORDNER = Path(tempfile.mkdtemp(prefix="rz-orte-paesse-"))
os.environ["RZ_APP_ORDNER"] = str(APP_ORDNER)
atexit.register(shutil.rmtree, str(APP_ORDNER), True)
sys.path.insert(0, str(REPO))
os.chdir(REPO)

from core import dateischutz as ds  # noqa: E402
from core import highlights as chl  # noqa: E402

ergebnisse = []


def pruefe(name, ok, info=""):
    ergebnisse.append(bool(ok))
    print(("OK   " if ok else "FAIL ") + name + (f"  [{str(info)[:400]}]" if info and not ok else ""))
    sys.stdout.flush()


# ── Geometrie: Strecke nach Osten auf 47,5° N, ein Punkt je 50 m ───────────────
LAT0, LON0 = 47.5, 9.0
KX = 111_320.0 * math.cos(math.radians(LAT0))


def pos(m, seitlich_m=0.0):
    """Punkt `m` Meter östlich vom Start, `seitlich_m` nördlich daneben."""
    return LAT0 + seitlich_m / 111_320.0, LON0 + m / KX


def strecke(laenge_m, schritt_m=50.0, t0=1_760_000_000):
    pts = []
    n = int(laenge_m / schritt_m)
    for i in range(n + 1):
        la, lo = pos(i * schritt_m)
        pts.append({"lat": la, "lon": lo, "ele": 500.0,
                    "time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t0 + i * 3))})
    return pts


def hin_und_zurueck(laenge_m, schritt_m=50.0, t0=1_760_000_000):
    """Hin nach Osten, zurück auf der Gegenspur (30 m daneben)."""
    pts = []
    n = int(laenge_m / schritt_m)
    k = 0
    for i in range(n + 1):
        la, lo = pos(i * schritt_m)
        pts.append({"lat": la, "lon": lo, "ele": 500.0, "time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t0 + k * 3))}); k += 1
    for i in range(n - 1, -1, -1):
        la, lo = pos(i * schritt_m, 30.0)
        pts.append({"lat": la, "lon": lo, "ele": 500.0, "time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t0 + k * 3))}); k += 1
    return pts


_ID = [1000]


def knoten(m, seitlich, **tags):
    _ID[0] += 1
    la, lo = pos(m, seitlich)
    return {"type": "node", "id": _ID[0], "lat": la, "lon": lo, "tags": tags}


class Welt:
    """Beantwortet die Kasten-Abfragen von `orte_abfrage` wie Overpass (Art-Filter + Rechteck)."""

    def __init__(self, knoten_liste, remark_ab_kaesten=0):
        self.knoten = knoten_liste
        self.aufrufe = []
        self.remark_ab_kaesten = remark_ab_kaesten
        self.kaputt_ab = None

    def __call__(self, q, timeout=None):
        self.aufrufe.append(q)
        if self.kaputt_ab is not None and len(self.aufrufe) >= self.kaputt_ab:
            raise OSError("HTTP Error 504: Gateway Timeout")
        stm = re.findall(r'node(\[[^;]*?\])\(([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)\);', q)
        if self.remark_ab_kaesten > 0 and len(stm) // 3 >= self.remark_ab_kaesten:
            return {"elements": [], "remark": "runtime error: Query timed out in \"query\" at line 1 after 46 seconds."}
        out = {}
        for filt, s, w, n, e in stm:
            s, w, n, e = float(s), float(w), float(n), float(e)
            for el in self.knoten:
                t = el["tags"]
                if '"mountain_pass"="yes"' in filt:
                    passt = t.get("mountain_pass") == "yes"
                elif "city|town" in filt:
                    passt = t.get("place") in ("city", "town")
                elif '"place"="village"' in filt:
                    passt = t.get("place") == "village"
                else:
                    passt = False
                if passt and t.get("name") and s <= el["lat"] <= n and w <= el["lon"] <= e:
                    out[el["id"]] = el
        r = {"elements": list(out.values())}
        if self.remark_ab_kaesten == -1 and len(stm) // 3 == 1:   # Einzelkasten bricht ab (A7b)
            r["remark"] = "runtime error: out of memory"
        return r


def welt_lang():
    """500 km: Dörfer alle 5 km 600 m daneben, zu ferne Dörfer, Klein-/Großstädte, ein Pass nah und einer fern."""
    el = []
    for k in range(100):
        el.append(knoten(2500 + k * 5000, 600 if k % 2 else -600, name=f"Dorf{k:03d}", place="village"))
    for k in range(20):
        el.append(knoten(12_000 + k * 25_000, 2500, name=f"Fern{k:02d}", place="village"))
    for k in range(10):
        el.append(knoten(30_000 + k * 50_000, -2500, name=f"Kleinstadt{k}", place="town"))
        el.append(knoten(40_000 + k * 50_000, 4000, name=f"Zuweit{k}", place="town"))
    for k in range(5):
        el.append(knoten(70_000 + k * 100_000, -4500, name=f"Grossstadt{k}", place="city"))
    el.append(knoten(250_100, 120, name="Mittelpass", mountain_pass="yes", ele="2094"))
    el.append(knoten(260_000, 400, name="Fernpass-Test", mountain_pass="yes", ele="1200"))
    return el


def teil_a(tmp: Path):
    # ── A1–A3: 500 km ──
    pts = strecke(500_000)
    welt = Welt(welt_lang())
    stand = []
    cache = tmp / "orte_paesse_cache.json"
    t0 = time.time()
    r = chl.orte_und_paesse(pts, http=welt, cache_pfad=cache, pause_s=0, fortschritt=lambda i, n: stand.append((i, n)))
    dauer = time.time() - t0
    pruefe("A1 500 km: zwei Overpass-Anfragen (vorher je 10 km eine: 50)", r["anfragen"] == 2 and len(welt.aufrufe) == 2, r["anfragen"])
    pruefe("A1b Fortschritt je Anfrage gemeldet: (1, 2), (2, 2)", stand == [(1, 2), (2, 2)], stand)
    pruefe("A1c alle Kästen in den Anfragen: Abfrage enthält je Kasten drei Zeilen und `out body`",
           all("out body" in q for q in welt.aufrufe) and sum(q.count("node[") for q in welt.aufrufe) == 3 * 20,
           [q.count("node[") for q in welt.aufrufe])
    namen = {e["name"] for e in r["eintraege"]}
    pruefe("A2 alle 100 Dörfer (600 m neben der Strecke) gefunden", all(f"Dorf{k:03d}" in namen for k in range(100)),
           sorted(n for n in namen if n.startswith("Dorf"))[:5])
    pruefe("A2b Dörfer 2,5 km daneben nicht (Grenze 1,5 km)", not any(n.startswith("Fern") for n in namen))
    pruefe("A2c Kleinstädte 2,5 km daneben ja, 4 km daneben nicht (Grenze 3 km)",
           all(f"Kleinstadt{k}" in namen for k in range(10)) and not any(n.startswith("Zuweit") for n in namen))
    pruefe("A2d Großstädte 4,5 km daneben ja (Grenze 5 km)", all(f"Grossstadt{k}" in namen for k in range(5)))
    arten = {e["name"]: e["art"] for e in r["eintraege"]}
    pruefe("A2e Arten: Dorf = dorf, Klein-/Großstadt = stadt, Pass = pass",
           arten.get("Dorf000") == "dorf" and arten.get("Kleinstadt0") == "stadt" and arten.get("Grossstadt0") == "stadt"
           and arten.get("Mittelpass") == "pass", arten.get("Mittelpass"))
    mp = next((e for e in r["eintraege"] if e["name"] == "Mittelpass"), None)
    pruefe("A3 Pass 120 m neben der Strecke gefunden, 400 m daneben nicht", mp is not None and "Fernpass-Test" not in namen)
    vs = chl.orte_als_vorschlaege(pts, r["eintraege"])
    v_mp = next((v for v in vs if v["name"] == "Mittelpass"), {})
    pruefe("A3b Pass-Text mit Höhe „Mittelpass\\n2094 m“, Linien-Symbol statt Bildzeichen",
           v_mp.get("text") == "Mittelpass\n2094 m" and v_mp.get("icon") == "mountain-snow" and not v_mp.get("symbol"), v_mp)
    cum = chl._kumuliert(pts)
    d3 = next(e for e in r["eintraege"] if e["name"] == "Dorf003")
    pruefe("A3c `strecke_m` = Meter ab Start der Durchfahrt (Pass bei 250,1 km = Punkt 5002, Dorf003 bei 17,5 km = Punkt 350)",
           mp and abs(mp["idx"] - 5002) <= 1 and mp["strecke_m"] == round(cum[mp["idx"]], 1)
           and abs(d3["idx"] - 350) <= 1 and d3["strecke_m"] == round(cum[d3["idx"]], 1),
           mp and (mp["idx"], mp["strecke_m"], d3["idx"]))
    pruefe("A3d nach Strecke sortiert", [e["idx"] for e in r["eintraege"]] == sorted(e["idx"] for e in r["eintraege"]))
    pruefe("A10 Abfrage + Auswertung (10 000 Punkte, 157 Orte) in unter 3 s", dauer < 3.0, f"{dauer:.2f} s")

    # ── A5: Cache ──
    welt2 = Welt(welt_lang())
    r2 = chl.orte_und_paesse(pts, http=welt2, cache_pfad=cache, pause_s=0)
    pruefe("A5 zweiter Lauf: keine Anfrage, dasselbe Ergebnis (Cache)",
           r2["anfragen"] == 0 and not welt2.aufrufe and [e["name"] for e in r2["eintraege"]] == [e["name"] for e in r["eintraege"]],
           r2["anfragen"])
    alt = ds.ersetzen
    tmp_namen = []
    ds.ersetzen = lambda q, z, *a, **k: (tmp_namen.append(Path(q).name), alt(q, z, *a, **k))[1]
    try:
        for k in range(chl.ORTE_CACHE_MAX + 15):
            chl._orte_cache_schreiben(cache, f"test|{k}", [{"id": k}])
    finally:
        ds.ersetzen = alt
    inhalt = json.loads(cache.read_text(encoding="utf-8"))
    pruefe(f"A5b Cache hat höchstens {chl.ORTE_CACHE_MAX} Einträge, die neuesten bleiben",
           len(inhalt) <= chl.ORTE_CACHE_MAX and f"test|{chl.ORTE_CACHE_MAX + 14}" in inhalt and "test|0" not in inhalt, len(inhalt))
    pruefe("A5c jeder Schreibvorgang mit eigenem Temp-Namen, keine Reste", len(set(tmp_namen)) == len(tmp_namen) > 1
           and not list(tmp.glob("*.tmp")), (tmp_namen[:2], list(tmp.glob("*.tmp"))))
    inhalt["test|alt"] = {"t": time.time() - chl.ORTE_CACHE_MAX_S - 10, "v": []}
    cache.write_text(json.dumps(inhalt), encoding="utf-8")
    pruefe("A5d abgelaufener Eintrag gilt nicht", chl._orte_cache_lesen(cache, "test|alt") is None)
    chl._orte_cache_schreiben(cache, "test|neu", [])
    pruefe("A5e beim nächsten Schreiben fliegt der abgelaufene Eintrag raus",
           "test|alt" not in json.loads(cache.read_text(encoding="utf-8")))

    # ── A4: hin und zurück ──
    hz = hin_und_zurueck(60_000)
    welt_hz = Welt([knoten(20_000, 50, name="Doppelpass", mountain_pass="yes", ele="1650"),
                    knoten(40_000, 500, name="Zweimaldorf", place="village"),
                    knoten(59_950, 40, name="Wendepass", mountain_pass="yes")])
    rh = chl.orte_und_paesse(hz, http=welt_hz, pause_s=0)
    def stellen(name):
        return sorted(round(e["strecke_m"] / 1000, 1) for e in rh["eintraege"] if e["name"] == name)
    pruefe("A4 Pass auf dem Hin- und Rückweg: zwei Einträge an ihrer Durchfahrt (20 km, 100 km)",
           [round(x) for x in stellen("Doppelpass")] == [20, 100], stellen("Doppelpass"))
    pruefe("A4b Dorf auf dem Hin- und Rückweg: zwei Einträge (40 km, 80 km)",
           [round(x) for x in stellen("Zweimaldorf")] == [40, 80], stellen("Zweimaldorf"))
    pruefe("A4c Wendepass einmal (eine Durchfahrt)", len(stellen("Wendepass")) == 1 and abs(stellen("Wendepass")[0] - 60) < 0.5,
           stellen("Wendepass"))

    # ── A6: Netz weg ──
    welt_aus = Welt(welt_lang()); welt_aus.kaputt_ab = 1
    ra = chl.orte_und_paesse(pts, http=welt_aus, cache_pfad=tmp / "c_aus.json", pause_s=0)
    pruefe("A6 Overpass nicht erreichbar: netz False, nach dem ersten Fehler keine weitere Anfrage, nichts gemerkt",
           ra["netz"] is False and len(welt_aus.aufrufe) == 1 and not (tmp / "c_aus.json").exists(), (ra["netz"], len(welt_aus.aufrufe)))
    welt_halb = Welt(welt_lang()); welt_halb.kaputt_ab = 2
    rh2 = chl.orte_und_paesse(pts, http=welt_halb, cache_pfad=tmp / "c_halb.json", pause_s=0)
    pruefe("A6b Ausfall mittendrin: Teilergebnis (erste Hälfte), netz False",
           rh2["netz"] is False and "Dorf000" in {e["name"] for e in rh2["eintraege"]}
           and "Dorf099" not in {e["name"] for e in rh2["eintraege"]})
    welt_wieder = Welt(welt_lang())
    rw = chl.orte_und_paesse(pts, http=welt_wieder, cache_pfad=tmp / "c_halb.json", pause_s=0)
    pruefe("A6c nächster Versuch fragt nur die fehlende Anfrage nach", rw["anfragen"] == 1 and rw["netz"]
           and len(rw["eintraege"]) == len(r["eintraege"]), rw["anfragen"])

    # ── A7: remark ──
    welt_rm = Welt(welt_lang(), remark_ab_kaesten=6)
    stand_rm = []
    rr = chl.orte_und_paesse(pts, http=welt_rm, cache_pfad=tmp / "c_rm.json", pause_s=0, fortschritt=lambda i, n: stand_rm.append((i, n)))
    pruefe("A7 Abbruch bei zu vielen Kästen: Anfrage wird geteilt, Ergebnis vollständig",
           not rr["unvollstaendig"] and len(rr["eintraege"]) == len(r["eintraege"]) and rr["anfragen"] == 6,
           (rr["anfragen"], len(rr["eintraege"]), stand_rm))
    pruefe("A7b Fortschritt wächst mit der Teilung (n wird größer)", stand_rm and stand_rm[-1][1] == 4, stand_rm)
    welt_rm1 = Welt([knoten(1000, 100, name="Kurzdorf", place="village")], remark_ab_kaesten=-1)
    r1 = chl.orte_und_paesse(strecke(5000), http=welt_rm1, cache_pfad=tmp / "c_rm1.json", pause_s=0)
    pruefe("A7c ein einzelner Kasten bricht ab: Teilergebnis, unvollständig, nicht gemerkt",
           r1["unvollstaendig"] and r1["netz"] and [e["name"] for e in r1["eintraege"]] == ["Kurzdorf"]
           and not (tmp / "c_rm1.json").exists(), r1)

    # ── A8: Doppelte ──
    welt_d = Welt([knoten(5000, 300, name="Sankt Anton", place="town"), knoten(5100, 250, name="St. Anton", place="village"),
                   knoten(10_000, 400, name="Neustadt", place="village"), knoten(40_000, 400, name="Neustadt", place="village")])
    rd = chl.orte_und_paesse(strecke(50_000), http=welt_d, pause_s=0)
    dn = [(e["name"], e["art"]) for e in rd["eintraege"]]
    pruefe("A8 town und village gleichen Namens („Sankt“/„St.“) an einer Stelle: einer (die Stadt)",
           [n for n in dn if "Anton" in n[0]] == [("Sankt Anton", "stadt")], dn)
    pruefe("A8b zwei gleichnamige Orte 30 km auseinander: beide", sum(1 for n in dn if n[0] == "Neustadt") == 2, dn)
    dorf = [{"name": "Hochkopf", "lat": pos(1000, 300)[0], "lon": pos(1000, 300)[1]}]
    gipfel_fern = {"name": "Hochkopf", "lat": pos(4000, 50)[0], "lon": pos(4000, 50)[1], "art": "gipfel"}
    gipfel_nah = {"name": "Hochkopf", "lat": pos(1100, 300)[0], "lon": pos(1100, 300)[1], "art": "ort"}
    pruefe("A8c Gipfel, der wie das Dorf heißt (3 km weg), ist keine Dublette; derselbe Ort 100 m weiter schon",
           not chl.ist_ort_dublette(gipfel_fern, dorf) and chl.ist_ort_dublette(gipfel_nah, dorf))

    # ── A9: Namen ──
    pruefe("A9 lokaler Name: „Bozen - Bolzano“ mit name:de → Bozen; „Passo Tre Croci - Son Zuógo“ → erster Teil",
           chl.lokaler_name({"name": "Bozen - Bolzano", "name:de": "Bozen"}) == "Bozen"
           and chl.lokaler_name({"name": "Passo Tre Croci - Son Zuógo"}) == "Passo Tre Croci"
           and chl.lokaler_name({"name": "Biel/Bienne"}) == "Biel")
    pruefe("A9b „St. Ingbert“ = „Sankt Ingbert“", chl.gleicher_ort("St. Ingbert") == chl.gleicher_ort("Sankt Ingbert"))
    return pts, hz


# ── Teil B: Brücke ─────────────────────────────────────────────────────────────

def gpx_schreiben(pfad: Path, pts):
    zeilen = "".join(f'<trkpt lat="{p["lat"]:.7f}" lon="{p["lon"]:.7f}"><ele>{p["ele"]}</ele><time>{p["time"]}</time></trkpt>'
                     for p in pts)
    pfad.write_text('<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="selftest" '
                    'xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Orte-Test</name><trkseg>' + zeilen
                    + "</trkseg></trk></gpx>", encoding="utf-8")


def welt_ui():
    """Hin und zurück 60 km. Doppelpass bei 20 km (auch auf dem Rückweg bei 100 km), Zweimaldorf bei 40/80 km, Wendepass
    am Wendepunkt; dazu dichte Dörfer bei 8–9 km (fünf binnen 1 km: bei 60 s Video zu viele gleichzeitig) und ein
    Hochkopf-Gipfel (OSM-Highlight) 100 m neben der Strecke bei 45 km mit demselben Namen wie ein Dorf bei 10 km."""
    el = [knoten(20_000, 50, name="Doppelpass", mountain_pass="yes", ele="1650"),
          knoten(40_000, 500, name="Zweimaldorf", place="village"),
          knoten(59_950, 40, name="Wendepass", mountain_pass="yes", ele="2100"),
          knoten(10_000, 400, name="Hochkopf", place="village")]
    for k in range(5):
        el.append(knoten(8000 + k * 250, 300 + 100 * k, name=f"Dicht{k}", place="village"))
    return el


OSM_GIPFEL = {"type": "node", "id": 9001, "lat": pos(45_000, 100)[0], "lon": pos(45_000, 100)[1],
              "tags": {"natural": "peak", "name": "Hochkopf", "ele": "1400"}}


def teil_b(gpx: Path):
    import app as APP
    api = APP.Api()
    api.settings_set({"onboarding_done": True, "force_osm": False})
    welt = Welt(welt_ui())

    def falsch(q, timeout=0):
        if "out body qt" in q:
            return welt(q)
        return {"elements": [OSM_GIPFEL]}   # die bisherige OSM-Highlight-Abfrage
    chl._http_overpass = falsch
    r0 = api.highlights_vorschlaege(str(gpx), [], {"osm": True, "track": True, "halte": True})
    pruefe("B1 ohne Haken: keine Orte-Abfrage, keine Orte-Zeilen", r0.get("ok") and not welt.aufrufe
           and not any(v.get("grund") == "orte" for v in r0["vorschlaege"]), r0.get("error"))
    stand = []
    alt_vm = APP._vorgang_melden
    APP._vorgang_melden = lambda text="", n=0, gesamt=0: (stand.append((text, n, gesamt)), alt_vm(text, n, gesamt))[1]
    try:
        r = api.highlights_vorschlaege(str(gpx), [], {"osm": True, "track": False, "halte": False, "orte": True})
    finally:
        APP._vorgang_melden = alt_vm
    orte = [v for v in r.get("vorschlaege") or [] if v.get("grund") == "orte"]
    pruefe("B1b mit Haken: Orte-Zeilen mit `strecke_m`, Linien-Symbol, ohne Bildzeichen",
           r.get("ok") and len(orte) >= 8 and all(isinstance(v.get("strecke_m"), (int, float)) and v.get("icon") and not v.get("symbol") for v in orte),
           (r.get("error"), orte[:1]))
    pruefe("B1c alle Zeilen tragen `strecke_m` (auch die OSM-Highlights)", all(v.get("strecke_m") is not None for v in r["vorschlaege"]))
    dp = sorted(round(v["strecke_m"] / 1000) for v in orte if v["name"] == "Doppelpass")
    pruefe("B1d Doppelpass zweimal (20 km, 100 km)", dp == [20, 100], dp)
    pruefe("B2 Wartemeldung „Abschnitt 1 von 1“", any("1" in t and g == 1 and n == 1 and ("Abschnitt" in t or "section" in t or "tramo" in t)
                                                     for t, n, g in stand), stand[-3:])
    pruefe("B2b OSM-Gipfel „Hochkopf“ bleibt neben dem gleichnamigen Dorf (keine Namens-Dublette)",
           any(v.get("grund") in ("poi", "poi_foto") and v.get("name") == "Hochkopf" for v in r["vorschlaege"])
           and any(v.get("grund") == "orte" and v.get("name") == "Hochkopf" for v in r["vorschlaege"]),
           [(v.get("grund"), v.get("name")) for v in r["vorschlaege"] if v.get("name") == "Hochkopf"])
    pruefe("B2c Cache liegt im App-Ordner und ist gültiges JSON",
           json.loads((Path(APP.APP_SUPPORT) / "orte_paesse_cache.json").read_text(encoding="utf-8")) != {})
    return APP, api, welt


# ── Teil C: echte Oberfläche ───────────────────────────────────────────────────

BRIDGE_JS = r"""
(() => {
  window.__rzKeinPmBoot = true;
  const NATIVE = { pick_save_path: async () => null, pick_file: async () => null, pick_folder: async () => null,
    set_window_size: async () => ({ ok: true }), get_window_size: async () => ({ width: 1400, height: 900 }),
    quit: async () => {}, on_loaded: () => {}, open_url: async () => ({ ok: true }) };
  const api = new Proxy({}, { get(_t, name) { if (name in NATIVE) return NATIVE[name]; if (typeof name !== "string") return undefined;
    return async (...args) => JSON.parse(await window.rzBridge(name, JSON.stringify(args))); } });
  window.pywebview = { api };
  window.dispatchEvent(new Event("pywebviewready"));
})();
"""

LISTE_JS = """() => Array.from(document.querySelectorAll('.hl-zeile')).map(z => ({
    text: z.querySelector('textarea').value, an: z.querySelector('input[data-hlon]').checked,
    grund: (z.querySelector('.hl-meta .muted') || {}).textContent || '',
    svg: !!z.querySelector('.hl-sym svg'), sym: (z.querySelector('.hl-sym') || {}).textContent || '' }))"""

SCHILDER_JS = """() => {
  const dur = parseFloat(document.getElementById('anim-dur').value);
  return { dur, signs: (getActiveProject().signs || []).map(x => {
    const A = window.__rzSignAnkerAusOrt(+x.lon, +x.lat, x.strecke_m);
    const ohne = window.__rzSignAnkerAusOrt(+x.lon, +x.lat);
    return { text: x.text, style: x.style, size: x.size, accent: x.accent, m: x.strecke_m, before: x.before, after: x.after,
             zoomScale: x.zoomScale, A, ohne, von: A * dur - (+x.before || 0), bis: A * dur + (+x.after || 0) };
  }) };
}"""


async def teil_c(APP, api, gpx: Path):
    from playwright.async_api import async_playwright

    def bruecke(name, args_json):
        fn = getattr(api, name, None)
        if fn is None or name.startswith("_"):
            return json.dumps({"ok": False, "error": f"no bridge {name}"})
        try:
            return json.dumps(fn(*json.loads(args_json)), default=str)
        except Exception as e:  # noqa: BLE001
            return json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"})

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--use-angle=default", "--enable-webgl", "--ignore-gpu-blocklist"])
        page = await browser.new_page(viewport={"width": 1400, "height": 900})
        fehler = []
        page.on("pageerror", lambda e: fehler.append(str(e)[:300]))
        await page.expose_function("rzBridge", bruecke)
        await page.add_init_script(BRIDGE_JS)
        await page.goto(f"file://{(REPO / 'ui/index.html').resolve()}", wait_until="domcontentloaded")
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
        await page.evaluate("document.getElementById('anim-signs-highlights').click()")
        await page.wait_for_function("() => !!document.getElementById('hl-q-orte')", timeout=10000)
        pruefe("C1 Highlights-Fenster: Haken „Orte und Pässe entlang der Strecke“, Standard aus",
               await page.evaluate("() => { const c = document.getElementById('hl-q-orte'); return !!c && !c.checked && /Pässe|passes|puertos/.test(c.parentElement.textContent); }"))
        await page.evaluate("() => { for (const k of ['osm', 'track', 'halte']) { const c = document.getElementById('hl-q-' + k); if (c.checked) c.click(); } document.getElementById('hl-q-orte').click(); }")
        await page.evaluate("() => document.getElementById('hl-finden').click()")
        await page.wait_for_function("() => document.querySelectorAll('.hl-zeile').length > 0", timeout=60000)
        liste = await page.evaluate(LISTE_JS)
        status = await page.evaluate("() => document.getElementById('hl-status').textContent")
        emoji = re.compile("[\U0001F300-\U0001FAFF☀-➿]")
        pruefe("C1b Liste: jede Zeile mit Strich-Symbol (SVG), kein Bildzeichen",
               liste and all(z["svg"] and not emoji.search(z["sym"]) for z in liste), liste[:2])
        pruefe("C1c Statuszeile nennt die Zahl der Orte und Pässe", "Orte und Pässe" in status or "towns and passes" in status, status)
        dicht = [z for z in liste if z["text"].startswith("Dicht")][:5]   # Hinweg (der Rückweg hat dieselben fünf noch einmal)
        pruefe("C2 fünf Dörfer binnen 1 km (60 s Video): nur so viele angehakt, dass höchstens 3 gleichzeitig stehen",
               len(dicht) == 5 and 0 < sum(z["an"] for z in dicht) <= 3 and any("abgewählt" in z["grund"] for z in dicht if not z["an"]),
               [(z["text"], z["an"], z["grund"]) for z in dicht])
        pruefe("C2b Pässe bleiben angehakt", all(z["an"] for z in liste if "Pass" in z["text"].split("\n")[0]),
               [(z["text"], z["an"]) for z in liste if "pass" in z["text"].lower()])
        pruefe("C2c Statuszeile sagt, wie viele abgewählt wurden", "abgewählt" in status or "unticked" in status, status)
        await page.evaluate("() => document.getElementById('hl-uebernehmen').click()")
        await page.wait_for_timeout(1200)
        sg = await page.evaluate(SCHILDER_JS)
        signs = sg["signs"]
        pruefe("C3 Übernehmen: Stecknadeln (pin), kleine Schrift, mit `strecke_m`, nicht mitskalierend",
               signs and all(s["style"] == "pin" and s["size"] in (17, 20) and isinstance(s["m"], (int, float)) and s["zoomScale"] is False
                             for s in signs), signs[:2])
        dp = sorted((s for s in signs if s["text"].startswith("Doppelpass")), key=lambda s: s["m"])
        pruefe("C3b Doppelpass: zwei Schilder, gelbe Nadel", len(dp) == 2 and all(s["accent"] == "#ffc21a" for s in dp), dp)
        if len(dp) == 2:
            # Ohne `strecke_m` landeten BEIDE beim selben (dem nächstgelegenen) Durchgang — der Pass liegt näher an der Gegenspur
            pruefe("C3c jeder Besuch erscheint an SEINER Durchfahrt (≈ 20/120 und 100/120 der Zeit); ohne `strecke_m` lägen beide gleich",
                   abs(dp[0]["A"] - 20 / 120) < 0.02 and abs(dp[1]["A"] - 100 / 120) < 0.02 and abs(dp[0]["ohne"] - dp[1]["ohne"]) < 0.01,
                   [(s["A"], s["ohne"], s["m"]) for s in dp])
        tmax = max((sum(1 for y in signs if y["von"] <= x["von"] + 1e-6 < y["bis"] - 1e-6) for x in signs), default=0)
        pruefe("C3d höchstens 3 Schilder gleichzeitig", tmax <= 3, tmax)
        pruefe("C4 kein pageerror", not fehler, fehler[:3])
        await browser.close()


def main():
    with tempfile.TemporaryDirectory(prefix="rz-orte-a-") as tmp:
        tmp = Path(tmp)
        ds.temp_ordner_merken(tmp)
        try:
            _pts, hz = teil_a(tmp)
        except Exception as e:  # noqa: BLE001
            import traceback
            traceback.print_exc()
            pruefe("A Lauf ohne Ausnahme", False, f"{type(e).__name__}: {e}")
            hz = hin_und_zurueck(60_000)
        gpx = tmp / "hin-und-zurueck.gpx"
        gpx_schreiben(gpx, hz)
        try:
            APP, api, _w = teil_b(gpx)
        except Exception as e:  # noqa: BLE001
            import traceback
            traceback.print_exc()
            pruefe("B Lauf ohne Ausnahme", False, f"{type(e).__name__}: {e}")
            return
        if "--ohne-ui" not in sys.argv:
            try:
                asyncio.run(teil_c(APP, api, gpx))
            except Exception as e:  # noqa: BLE001
                pruefe("C Lauf ohne Ausnahme", False, f"{type(e).__name__}: {str(e).splitlines()[0][:200]}")


if __name__ == "__main__":
    main()
    ok = all(ergebnisse)
    print("RESULT: " + ("OK" if ok else "FAIL"))
    sys.exit(0 if ok else 1)
