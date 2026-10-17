"""Selbsttest „Alle Orte und Pässe entlang der Strecke“ (Highlights-Fenster).

Teil A: die Python-Funktionen aus core/highlights.py mit einem gemockten Overpass (keine Netzzugriffe).
Teil B: die echte Oberfläche an der echten Brücke (scripts/selftest_echtbruecke.py, Daten in einem
        Temp-Ordner): Highlights-Fenster öffnen, „Orte und Pässe“ anhaken, finden, übernehmen. `chl._http_overpass`
        wird im Prozess auf dieselbe Fixture gepatcht.

Aufruf: python scripts/selftest_orte_paesse.py
Ausgabe: je Prüfung OK/FAIL, am Ende RESULT: OK bzw. RESULT: FAIL (Exit 0 / 1).
"""
import asyncio
import json
import math
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

ergebnisse = []


def pruefe(name, ok, info=""):
    ergebnisse.append(bool(ok))
    print(("OK   " if ok else "FAIL ") + name + (f"  [{info}]" if info and not ok else ""))
    sys.stdout.flush()


# ── Fixture: 30 km nach Osten, Orte und Pässe in bekannten Abständen ──────────
LAT0, LON0 = 47.0, 11.0
_M_PRO_GRAD_LAT = 111_195.0


def _dlon(m):
    return m / (111_320.0 * math.cos(math.radians(LAT0)))


def pos(x_m, y_m):
    """(lat, lon) x Meter östlich und y Meter nördlich vom Start."""
    return LAT0 + y_m / _M_PRO_GRAD_LAT, LON0 + _dlon(x_m)


def strecke(n=301, schritt=100.0):
    pts = []
    for i in range(n):
        lat, lon = pos(i * schritt, 0)
        s = i * 20
        pts.append({"lat": lat, "lon": lon, "ele": round(400 + 150 * math.sin(i / 40.0), 1),
                    "time": f"2026-01-01T{10 + s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}Z"})
    return pts


_nid = [1000]


def _knoten(lage, tags):
    _nid[0] += 1
    return {"type": "node", "id": _nid[0], "lat": lage[0], "lon": lage[1], "tags": tags}


def _rel(rid, name, level, label=None, label_tags=None, centre=None, center=None, tags=None,
         centre_name=None, centre_tags=None):
    """Die Elemente, die Overpass für eine Relation liefert: erst die Relation, dann ihre Knoten."""
    t = {"name": name, "boundary": "administrative", "admin_level": str(level)}
    t.update(tags or {})
    el = {"type": "relation", "id": rid, "tags": t}
    if center:
        el["center"] = {"lat": center[0], "lon": center[1]}
    out = [el]
    if label:
        out.append(_knoten(label, dict({"name": name}, **(label_tags or {}))))
    if centre:
        out.append(_knoten(centre, dict({"name": centre_name or name}, **(centre_tags or {}))))
    return out


def overpass_orte():
    """Die Antwort der Orte-Abfrage (alles in einer Antwort; Reihenfolge absichtlich nicht nach Strecke)."""
    # Orts-Knoten (place) stehen vor den Relationen (erster Teil der Abfrage)
    el = [
        _knoten(pos(9000, 1200), {"name": "Weiler", "place": "village"}),          # Ortsteil, 1,2 km: dabei
        _knoten(pos(11000, 1800), {"name": "Fernteil", "place": "hamlet"}),       # 1,8 km: zu weit
        _knoten(pos(15200, 900), {"name": "Sankt Johann", "place": "town"}),      # Gemeinde-Hauptort: Duplikat
        _knoten(pos(18000, 500), {"name": "Mittelpunkt", "place": "village"}),    # dito
        _knoten(pos(24000, 1100), {"name": "Doppel", "place": "suburb"}),         # gleichnamig: der nähere bleibt
        _knoten(pos(24500, 800), {"name": "Doppel", "place": "suburb"}),
        _knoten(pos(24000, 300), {"name": "NurCenterMitKnoten", "place": "village"}),
        _knoten(pos(26000, 300), {"name": "Wiese", "place": "locality"}),         # keine der vier Arten
        _knoten(pos(27000, 100), {"place": "village"}),                            # ohne Namen
    ]
    el += _rel(11, "Dreikilometer", 8, label=pos(5000, 3000))
    el += _rel(12, "Sechskilometer", 8, label=pos(8000, 6000))
    el += _rel(13, "Großstadt", 6, label=pos(12000, 2000), label_tags={"place": "city"})
    el += _rel(14, "Landkreis", 6, label=pos(13000, 1000), label_tags={"place": "village"})
    el += _rel(15, "Stadtteil", 9, label=pos(14000, 500), label_tags={"place": "suburb"}, tags={"de:place": "town"})
    el += _rel(16, "St. Johann", 8, label=pos(15000, 1000))
    el += _rel(17, "Sankt Johann", 8, label=pos(15500, 2000))
    el += _rel(18, "Mittelpunkt", 8, centre=pos(18000, 500), center=pos(18000, 4000))
    el += _rel(19, "NurCenter", 8, center=pos(20000, 800))
    # nur center (Flächenmitte 4 km neben dem Weg), aber gleichnamiger Orts-Knoten 300 m daneben: Lage = Knoten
    el += _rel(22, "NurCenterMitKnoten", 8, center=pos(24000, 4000))
    el += _rel(20, "Beides", 8, label=pos(22000, 1000), centre=pos(22000, 4500))
    # Landkreis, dessen Sitz (admin_centre) eine Stadt anderen Namens ist: keine Gemeinde
    el += _rel(21, "Kreis Sitz", 6, centre=pos(10000, 1000), centre_name="Sitzstadt", centre_tags={"place": "town"})
    # Pässe stehen hinter den Relationen (zweiter Teil der Abfrage); der Musterpass liegt aber am weitesten vorn,
    # die Antwort ist also nicht nach Strecke sortiert
    el.append(_knoten(pos(3000, 140), {"name": "Musterpass", "mountain_pass": "yes", "ele": "884"}))
    el.append(_knoten(pos(27000, 200), {"name": "Fernpass", "mountain_pass": "yes", "ele": "1200"}))
    return {"elements": el}


class Mock:
    """Ersatz für chl._http_overpass: zählt Aufrufe, liefert immer dieselbe Antwort (Duplikate über Abschnitte)."""

    def __init__(self, antwort=None, fehler=None):
        self.antwort, self.fehler, self.aufrufe = antwort, fehler, []

    def __call__(self, query):
        self.aufrufe.append(query)
        if self.fehler:
            raise self.fehler
        return self.antwort


def namen(r):
    return [e["name"] for e in r["eintraege"]]


# ── Teil A ────────────────────────────────────────────────────────────────────
def teil_a(tmp):
    from core import highlights as chl
    pts = strecke()

    def lauf(**kw):
        m = Mock(overpass_orte())
        return chl.orte_und_paesse(pts, http=m, pause_s=0, **kw), m

    def sicher(name, f):
        try:
            f()
        except Exception as e:  # noqa: BLE001 — jede Ausnahme ist eine gescheiterte Prüfung
            pruefe(name, False, f"{type(e).__name__}: {str(e)[:150]}")

    r, m = {}, None

    def t_lauf():
        nonlocal r, m
        r, m = lauf()
        pruefe("A0 orte_und_paesse liefert netz=True und Einträge", r["netz"] is True and len(r["eintraege"]) > 0, r)
    sicher("A0 orte_und_paesse liefert netz=True und Einträge", t_lauf)
    if not r:
        return

    pruefe("A1 test_gemeinde_3km: Gemeinde 3 km neben dem Weg ist dabei", "Dreikilometer" in namen(r), namen(r))
    pruefe("A2 test_gemeinde_6km: Gemeinde 6 km neben dem Weg nicht", "Sechskilometer" not in namen(r), namen(r))
    pruefe("A3 test_stadt_level6_mit_city_label: Stadt auf Kreisebene mit place=city ist dabei",
           "Großstadt" in namen(r), namen(r))
    pruefe("A3b Kreisebene ohne Stadt-Label nicht", "Landkreis" not in namen(r), namen(r))
    pruefe("A4 test_stadtteil_level9: Stadtteil (Level 9) nicht, auch mit de:place", "Stadtteil" not in namen(r), namen(r))

    tpass = [e for e in r["eintraege"] if e["name"] == "Musterpass"]
    pruefe("A5 test_pass_140m: Pass 140 m neben dem Weg mit ele=884",
           len(tpass) == 1 and tpass[0]["art"] == "pass" and tpass[0]["ele"] == 884.0, tpass)
    pruefe("A6 test_pass_200m: Pass 200 m neben dem Weg nicht", "Fernpass" not in namen(r), namen(r))

    pruefe("A7 Text des Passes „Musterpass\\n884 m“", bool(tpass) and chl._text(tpass[0], {}) == "Musterpass\n884 m",
           chl._text(tpass[0], {}) if tpass else None)
    johann = [n for n in namen(r) if "johann" in n.casefold()]
    pruefe("A8 test_sankt_st_eins: „St. Johann“ und „Sankt Johann“ ergeben einen Eintrag", len(johann) == 1, johann)
    idxs = [e["idx"] for e in r["eintraege"]]
    pruefe("A9 test_reihenfolge: nach idx sortiert", idxs == sorted(idxs) and len(idxs) >= 5, idxs)
    pruefe("A10 Abschnitte: mehrere Abfragen für 30 km, jede mit Box und mountain_pass",
           len(m.aufrufe) == 3 and all("mountain_pass" in q for q in m.aufrufe), len(m.aufrufe))

    lage = {e["name"]: e for e in r["eintraege"]}
    la_m, lo_m = pos(18000, 500)
    la_b, lo_b = pos(22000, 1000)
    pruefe("A11 Lage: admin_centre, wenn kein label", "Mittelpunkt" in lage
           and abs(lage["Mittelpunkt"]["lat"] - la_m) < 1e-6 and abs(lage["Mittelpunkt"]["lon"] - lo_m) < 1e-6, lage.get("Mittelpunkt"))
    pruefe("A12 Lage: center, wenn weder label noch admin_centre", "NurCenter" in lage, namen(r))
    nk = lage.get("NurCenterMitKnoten")
    la_k, lo_k = pos(24000, 300)
    pruefe("A12b Lage: gleichnamiger Orts-Knoten statt center, Abstand = Knotenabstand", nk is not None
           and abs(nk["lat"] - la_k) < 1e-6 and abs(nk["lon"] - lo_k) < 1e-6 and abs(nk["abstand_m"] - 300) < 30, nk)
    pruefe("A13 Lage: label vor admin_centre", "Beides" in lage and abs(lage["Beides"]["lat"] - la_b) < 1e-6
           and abs(lage["Beides"]["lon"] - lo_b) < 1e-6, lage.get("Beides"))
    pruefe("A14 Felder eines Eintrags", all(set(e) >= {"art", "name", "lat", "lon", "ele", "osm_id", "idx", "frac", "abstand_m"}
                                              for e in r["eintraege"]), r["eintraege"][:1])

    # Hilfsfunktionen
    pruefe("A15 ist_gemeinde: Level 8 ja, Level 9 nein, Level 6 nur als Stadt (Lage-Knoten gleichen Namens)",
           chl.ist_gemeinde({"admin_level": "8"}, None) and not chl.ist_gemeinde({"admin_level": "9"}, {"place": "city"})
           and not chl.ist_gemeinde({"admin_level": "6", "name": "Ulm"}, None)
           and chl.ist_gemeinde({"admin_level": "6", "name": "Ulm"}, {"place": "town", "name": "Ulm"})
           and chl.ist_gemeinde({"admin_level": "4", "de:place": "city"}, None)
           and not chl.ist_gemeinde({"admin_level": "6", "name": "Ulm"}, {"place": "village", "name": "Ulm"})
           and not chl.ist_gemeinde({"admin_level": "6", "name": "Landkreis Rottweil"}, {"place": "town", "name": "Rottweil"}))
    pruefe("A15b Landkreis mit Sitz (admin_centre einer Stadt anderen Namens) ist keine Gemeinde", "Kreis Sitz" not in namen(r), namen(r))
    pruefe("A16 lokaler_name: name:de nur, wenn im Namen; zweisprachig → erster Teil",
           chl.lokaler_name({"name": "Meran - Merano", "name:de": "Meran"}) == "Meran"
           and chl.lokaler_name({"name": "Passo Tre Croci - Son Zuógo"}) == "Passo Tre Croci"
           and chl.lokaler_name({"name": "Ulm", "name:de": "Ulm"}) == "Ulm" and chl.lokaler_name({}) is None)
    pruefe("A17 gleicher_ort", chl.gleicher_ort("St. Ingbert") == chl.gleicher_ort("Sankt Ingbert")
           and chl.gleicher_ort("Sankt Ingbert") == "st. ingbert")
    pruefe("A18 orte_abfrage enthält die Box und beide Teile", all(s in chl.orte_abfrage((46.9, 10.8, 47.2, 11.4)) for s in
           ("(46.90000,10.80000,47.20000,11.40000)", "->.g", "admin_centre", '"mountain_pass"="yes"'))
           and chl.orte_abfrage((46.9, 10.8, 47.2, 11.4)).count("out body;") == 4 and "out tags;" not in chl.orte_abfrage((46.9, 10.8, 47.2, 11.4)))
    q = chl.orte_abfrage((46.9, 10.8, 47.2, 11.4))
    pruefe("A18b eine einzige Abfrage enthält auch die Orts-Knoten (town, village, hamlet, suburb)",
           all(w in q for w in ("town", "village", "hamlet", "suburb")) and '"place"' in q, q)

    # Ortsteile (Orts-Knoten bis 1,5 km neben der Strecke)
    ot = {e["name"]: e for e in r["eintraege"] if e["art"] == "ortsteil"}
    pruefe("A23 Ortsteil bis 1500 m (Weiler, 1,2 km) ist dabei, art=ortsteil, ohne Höhe",
           "Weiler" in ot and ot["Weiler"]["ele"] is None and 1100 <= ot["Weiler"]["abstand_m"] <= 1300, ot.get("Weiler"))
    pruefe("A24 Ortsteil über 1500 m (1,8 km) nicht", "Fernteil" not in namen(r), namen(r))
    pruefe("A25 Duplikat zur Gemeinde entfällt (auch Schreibvariante St./Sankt)",
           [e["art"] for e in r["eintraege"] if "johann" in e["name"].casefold()] == ["ort"]
           and [e["art"] for e in r["eintraege"] if e["name"] == "Mittelpunkt"] == ["ort"], namen(r))
    dop = [e for e in r["eintraege"] if e["name"] == "Doppel"]
    pruefe("A26 gleichnamige Ortsteile: nur der nähere (800 m)", len(dop) == 1 and 700 <= dop[0]["abstand_m"] <= 900, dop)
    pruefe("A27 place=locality und Knoten ohne Namen sind keine Ortsteile", "Wiese" not in namen(r)
           and all(e["name"] for e in r["eintraege"]), namen(r))
    pruefe("A28 Lage-Knoten einer Relation (place=city/suburb) werden nicht zusätzlich Ortsteil",
           [e["art"] for e in r["eintraege"] if e["name"] == "Großstadt"] == ["ort"] and "Stadtteil" not in namen(r), namen(r))

    # Cache
    cache = Path(tmp) / "orte_paesse_cache.json"
    m1 = Mock(overpass_orte())
    r1 = chl.orte_und_paesse(pts, http=m1, pause_s=0, cache_pfad=cache)
    n1 = len(m1.aufrufe)
    m2 = Mock(overpass_orte())
    r2 = chl.orte_und_paesse(pts, http=m2, pause_s=0, cache_pfad=cache)
    pruefe("A19 test_cache: der zweite Aufruf ruft http nicht mehr auf", n1 == 3 and len(m2.aufrufe) == 0
           and r2["eintraege"] == r1["eintraege"] and r2["netz"] is True and cache.is_file(), (n1, len(m2.aufrufe)))
    pruefe("A19b Cache-Schlüssel trägt die neue Version orte_v3|", all(k.startswith("orte_v3|") for k in json.loads(cache.read_text("utf-8"))))
    # Ein frischer Eintrag aus dem Format ohne Ortsteile (orte_v1) gilt nicht als vollständig
    cache_alt = Path(tmp) / "v1.json"
    cache_alt.write_text(json.dumps({"orte_v1|" + chl._orte_geo_hash(pts): {"t": time.time(), "v": [{"art": "ort", "name": "Alt"}]}}),
                         encoding="utf-8")
    m_alt = Mock(overpass_orte())
    r_alt = chl.orte_und_paesse(pts, http=m_alt, pause_s=0, cache_pfad=cache_alt)
    pruefe("A19c Cache-Eintrag im alten Format (ohne Ortsteile) wird neu abgefragt", len(m_alt.aufrufe) == 3
           and "Alt" not in namen(r_alt) and "Weiler" in namen(r_alt), (len(m_alt.aufrufe), namen(r_alt)))
    # Kein Netz
    cache2 = Path(tmp) / "leer.json"
    mk = Mock(fehler=OSError("kein Netz"))
    rk = chl.orte_und_paesse(pts, http=mk, pause_s=0, cache_pfad=cache2)
    pruefe("A20 test_kein_netz: netz=False, nichts gecacht", rk["netz"] is False and rk["eintraege"] == [] and not cache2.exists(), rk)
    vorher = cache.read_bytes()
    chl.orte_und_paesse(strecke(n=200), http=Mock(fehler=OSError("x")), pause_s=0, cache_pfad=cache)
    pruefe("A20b kein Netz lässt eine vorhandene Cache-Datei unverändert", cache.read_bytes() == vorher)

    # HTTP 200 mit remark (Overpass-Zeitüberschreitung) = Fehler, nichts cachen
    cache3 = Path(tmp) / "remark.json"
    teil = dict(overpass_orte(), remark='runtime error: Query timed out in "query" at line 1 after 21 seconds.')
    mr = Mock(teil)
    rr = chl.orte_und_paesse(pts, http=mr, pause_s=0, cache_pfad=cache3)
    pruefe("A20c remark-Antwort: netz=False, nichts gecacht, kein weiterer Abschnitt", rr["netz"] is False
           and not cache3.exists() and len(mr.aufrufe) == 1, (rr["netz"], len(mr.aufrufe)))
    # Ablauf des Cache über "t"
    c = json.loads(cache.read_text("utf-8"))
    alt = {k: dict(v, t=v["t"] - chl.ORTE_CACHE_MAX_S - 60) for k, v in c.items()}
    cache4 = Path(tmp) / "alt.json"
    cache4.write_text(json.dumps(alt), encoding="utf-8")
    m4 = Mock(overpass_orte())
    chl.orte_und_paesse(pts, http=m4, pause_s=0, cache_pfad=cache4)
    pruefe("A20d abgelaufener Cache-Eintrag wird neu abgefragt", len(m4.aufrufe) == n1, len(m4.aufrufe))
    m5 = Mock(overpass_orte())
    chl.orte_und_paesse(pts, http=m5, pause_s=0, cache_pfad=cache)
    pruefe("A21a frischer Cache-Eintrag wird genutzt", len(m5.aufrufe) == 0, len(m5.aufrufe))

    # Vorschläge aus den Einträgen (Text, Grund, empfohlen)
    vs = chl.orte_als_vorschlaege(pts, r["eintraege"])
    pruefe("A21 Vorschläge: grund=orte, empfohlen, Text Ort = Name, Pass = „Name\\n884 m“",
           len(vs) == len(r["eintraege"]) and all(v["grund"] == "orte" and v["empfohlen"] for v in vs)
           and any(v["text"] == "Musterpass\n884 m" for v in vs) and any(v["text"] == "Dreikilometer" for v in vs), vs[:2])
    gv = [v for v in vs if v["name"] == "Weiler"]
    pruefe("A29 Vorschlag eines Ortsteils: art=ortsteil, Text = Name, grund=orte", len(gv) == 1 and gv[0]["art"] == "ortsteil"
           and gv[0]["text"] == "Weiler" and gv[0]["grund"] == "orte" and gv[0]["abstand_m"] == ot["Weiler"]["abstand_m"], gv)

    # Box ohne Relation, nur ein Pass: der Pass darf nicht verloren gehen („Pässe erscheinen immer“)
    pa, rl, tl = {}, {}, {}
    chl._orte_sammeln([_knoten(pos(5000, 0), {"name": "Nurpass", "mountain_pass": "yes", "ele": "900"})], rl, pa, tl)
    pruefe("A30 Box ohne Relation: Pass bleibt erhalten, kein Ortsteil", len(pa) == 1 and not rl and not tl, (pa, tl))


# unveränderter Ablauf ohne die neue Option: auf cfa49cb erzeugt, bevor core/highlights.py geändert wurde
ERWARTET_UNVERAENDERT = [
    ("Hochberg", "gipfel", 60, 0.2), ("Sattelpass", "pass", 110, 0.3667), ("Aussichtspunkt", "aussicht", 150, 0.5),
    ("", "schnellster", 166, 0.5533), ("", "tiefster", 188, 0.6267), ("Beispieldorf", "ort", 200, 0.6667),
    ("Burg Beispiel", "burg", 240, 0.8),
]


def overpass_osm():
    """Antwort der bisherigen Abfrage (nwr-Elemente) für test_unveraendert."""
    def n(i, name, tags, x, y):
        la, lo = pos(x, y)
        return {"type": "node", "id": i, "lat": la, "lon": lo, "tags": dict(tags, name=name)}
    return {"elements": [
        n(1, "Hochberg", {"natural": "peak", "ele": "905"}, 6000, 40),
        n(2, "Sattelpass", {"mountain_pass": "yes", "ele": "850"}, 11000, 60),
        n(3, "Aussichtspunkt", {"tourism": "viewpoint"}, 15000, 100),
        n(4, "Beispieldorf", {"place": "village"}, 20000, 300),
        n(5, "Burg Beispiel", {"historic": "castle"}, 24000, 90),
        n(6, "Weitwegdorf", {"place": "village"}, 8000, 900),
    ]}


def osm_mit_pass():
    """Wie overpass_osm, dazu der Musterpass: ihn kennt auch die Orte-Abfrage (Dublette auf der OSM-Seite)."""
    r = overpass_osm()
    la, lo = pos(3000, 140)
    r["elements"].append({"type": "node", "id": 99, "lat": la, "lon": lo,
                          "tags": {"name": "Musterpass", "mountain_pass": "yes", "ele": "884"}})
    return r


def osm_ergebnis():
    from core import highlights as chl
    r = chl.highlights_fuer_track(strecke(), http=Mock(overpass_osm()))
    return [(p["name"], p["art"], p["idx"], round(p["frac"], 4)) for p in r["gewaehlt"]]


def t_unveraendert():
    ist = osm_ergebnis()
    pruefe("A22 test_unveraendert: highlights_fuer_track liefert dieselbe Liste wie auf cfa49cb",
           ERWARTET_UNVERAENDERT is not None and ist == ERWARTET_UNVERAENDERT, ist)


def main_a():
    with tempfile.TemporaryDirectory(prefix="rz-orte-") as tmp:
        from core import dateischutz as ds
        ds.app_ordner_setzen(Path(tmp))   # der Cache liegt wie in der App im App-Ordner (Dateischutz)
        try:
            t_unveraendert()
            teil_a(tmp)
        except Exception as e:  # noqa: BLE001
            pruefe("A Lauf ohne Ausnahme", False, f"{type(e).__name__}: {str(e)[:200]}")


# ── Teil B: echte Oberfläche an der echten Brücke ─────────────────────────────
DAUER_S = 60            # Videodauer; 500 m Strecke je Sekunde
# Alle Fixture-Orte/-Pässe, die die Liste zeigt (Python liefert alles bis 5 km), und die, die als Schilder übrig bleiben
ERWARTET_ALLE = {"Musterpass", "Nah1000", "Fern2000", "Teil1200", "A1", "A2", "A3", "B1", "B2", "B3", "Mittendrinpass",
                 "C1", "C2", "CTeil", "CPass", "Frei"}
ERWARTET_SCHILDER = {"Musterpass", "Nah1000", "Teil1200", "A1", "A2", "A3", "B1", "B2", "Mittendrinpass", "C1", "C2", "CPass", "Frei"}
ORTE_SCHILD_GROESSE = 20
ORTE_MAX_GLEICHZEITIG = 3
ORTE_NAH_M = 1500


def gpx_schreiben(pfad):
    zeilen = "".join(f'<trkpt lat="{p["lat"]:.6f}" lon="{p["lon"]:.6f}"><ele>{p["ele"]}</ele><time>{p["time"]}</time></trkpt>'
                     for p in strecke())
    pfad.write_text('<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="selftest" '
                    'xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Orte-Test</name><trkseg>' + zeilen
                    + "</trkseg></trk></gpx>", encoding="utf-8")


def overpass_ausduennen():
    """Orte/Pässe für das Ausdünnen (Videodauer 60 s, 500 m je Sekunde, ein Fenster dauert 4 s): nah (1000 m) bleibt, fern
    (2000 m) entfällt wegen Abstand; Ortsteil Teil1200 bleibt (Duplikat der Gemeinde Nah1000 entfällt schon in Python);
    drei zeitgleiche Orte A bleiben alle; B1–B3 + Pass = vier gleichzeitig: das fernste B3 entfällt; C1, C2, Ortsteil
    und Pass = vier gleichzeitig: der Ortsteil (niedrigste Priorität) entfällt."""
    el = [
        _knoten(pos(5000, 1000), {"name": "Nah1000", "place": "village"}),
        _knoten(pos(9000, 1200), {"name": "Teil1200", "place": "suburb"}),
        _knoten(pos(24200, 300), {"name": "CTeil", "place": "hamlet"}),
    ]
    el += _rel(41, "Nah1000", 8, label=pos(5000, 1000))
    el += _rel(42, "Fern2000", 8, label=pos(8000, 2000))
    for k in range(3):
        el += _rel(43 + k, f"A{k + 1}", 8, label=pos(14000 + 100 * k, 500))
    for k in range(3):
        el += _rel(46 + k, f"B{k + 1}", 8, label=pos(21000 + 100 * k, 500 + 200 * k))
    el += _rel(49, "Frei", 8, label=pos(29000, 800))
    el += _rel(50, "C1", 8, label=pos(24000, 500))
    el += _rel(51, "C2", 8, label=pos(24100, 500))
    el.append(_knoten(pos(3000, 140), {"name": "Musterpass", "mountain_pass": "yes", "ele": "884"}))
    el.append(_knoten(pos(21100, 100), {"name": "Mittendrinpass", "mountain_pass": "yes", "ele": "1500"}))
    el.append(_knoten(pos(24300, 100), {"name": "CPass", "mountain_pass": "yes", "ele": "1300"}))
    return {"elements": el}


def overpass_viele():
    """20 Orte im Abstand von 1,4 km (30 s Videodauer: 1,4 s auseinander, ein Fenster dauert 4 s)."""
    el = []
    for k in range(20):
        el += _rel(100 + k, f"Viel{k + 1:02d}", 8, label=pos(1000 + 1400 * k, 500))
    return {"elements": el}


MODUS = {"viele": False}


def overpass_patch():
    """Ersetzt chl._http_overpass im Prozess: die Orte-Abfrage (foreach) und die bisherige (nwr) bekommen je ihre Antwort."""
    from core import highlights as chl
    aufrufe = []

    def falsch(query, timeout=0):
        aufrufe.append(query)
        if "foreach" in query:
            return overpass_viele() if MODUS["viele"] else overpass_ausduennen()
        return osm_mit_pass()
    chl._http_overpass = falsch
    return aufrufe


LISTE_JS = """() => Array.from(document.querySelectorAll('.hl-zeile')).map(z => ({
    id: z.dataset.id, text: z.querySelector('textarea').value, an: z.querySelector('input[data-hlon]').checked,
    grund: (z.querySelector('.hl-meta .muted') || {}).textContent || '' }))"""

FENSTER_JS = """() => {
  const dur = parseFloat(document.getElementById('anim-dur').value);
  const s = (getActiveProject().signs || []).filter(x => x.hl_quelle === 'orte');
  return { dur, signs: s.map(x => {
    const nat = window.__rzSignAnkerAusOrt(x.lon, x.lat);
    const A = (typeof x.timeAnchor === 'number') ? x.timeAnchor : nat;
    const m = window.__rzSignMeta({ ...x, track_anchor: A }, dur);
    const nach = window.__rzSignDeckkraft(m, m.a_hide + 0.001), mitte = window.__rzSignDeckkraft(m, (m.a_show + m.a_hide) / 2);
    return { text: x.text, size: x.size, style: x.style, opacity: x.opacity, before: x.before, after: x.after, entry: x.entry, color: x.color,
             accent: x.accent, ta: x.timeAnchor, nat, von: m.a_show * dur, bis: m.a_hide * dur, nach, mitte, fadeOut: m.fadeOut };
  }) };
}"""


async def klick(page, sel):
    """Klick per DOM (die Bibliothekssperre „bib-gate“ liegt im Prüfstand über der Seite und finge page.click ab)."""
    await page.evaluate("(s) => document.querySelector(s).click()", sel)


def name1(s):
    return s["text"].split("\n")[0]


def fenster_pruefen(sg, nummer, titel):
    """Gemeinsame Prüfungen: höchstens 3 Schilder gleichzeitig, jeder timeAnchor = natürlicher Anker (oder nicht gesetzt)."""
    pruefe(f"{nummer} {titel}: höchstens {ORTE_MAX_GLEICHZEITIG} Zeitfenster gleichzeitig",
           max((sum(1 for y in sg if y["von"] <= x["von"] + 1e-6 < y["bis"] - 1e-6) for x in sg), default=0) <= ORTE_MAX_GLEICHZEITIG,
           [(name1(s), round(s["von"], 2), round(s["bis"], 2)) for s in sg])
    pruefe(f"{nummer}b {titel}: timeAnchor wird nie verschoben (nicht gesetzt oder gleich dem natürlichen Anker)",
           all(s["ta"] is None or abs(s["ta"] - s["nat"]) < 1e-6 for s in sg), [(name1(s), s["ta"], s["nat"]) for s in sg])


async def teil_b(p, tmp):
    import selftest_echtbruecke as eb  # noqa: E402  (setzt RZ_APP_ORDNER vor dem Import der App)
    gpx = Path(tmp) / "orte.gpx"
    gpx_schreiben(gpx)
    aufrufe = overpass_patch()
    browser, page, fehler = await eb.seite_starten(p)
    await page.evaluate("window.switchMod('animator')")
    await page.wait_for_timeout(2500)
    await page.evaluate(f"() => {{ window.loadGlobalGpx({json.dumps(str(gpx))}); }}")
    await page.wait_for_timeout(7000)
    await page.evaluate(f"""() => {{ const d = document.getElementById('anim-dur'); d.value = {DAUER_S};
        d.dispatchEvent(new Event('input', {{ bubbles: true }})); d.dispatchEvent(new Event('change', {{ bubbles: true }})); }}""")
    await page.wait_for_timeout(500)
    await page.evaluate("document.getElementById('anim-signs-highlights').click()")
    await page.wait_for_timeout(600)
    pruefe("B0 Highlights-Fenster mit Checkbox „Alle Orte und Pässe“, Standard aus",
           await page.evaluate("() => { const c = document.getElementById('hl-q-orte'); return !!c && !c.checked; }"))

    # Ohne Haken: dieselbe Vorschlagsliste wie bisher (Brücke ohne `orte`-Schlüssel)
    await klick(page, "#hl-finden")
    await page.wait_for_function("() => document.querySelectorAll('.hl-zeile').length > 0", timeout=60000)
    ohne = await page.evaluate(LISTE_JS)
    bisher = eb.api.highlights_vorschlaege(str(gpx), [], {"osm": True, "track": True, "halte": True})
    pruefe("B1 ohne Haken: Vorschlagsliste wie bisher (Texte, Reihenfolge, keine Orte-Zeilen)",
           [v["text"] for v in ohne] == [v["text"] for v in bisher["vorschlaege"]] and bisher["ok"]
           and not any(v.get("grund") == "orte" for v in bisher["vorschlaege"]), (ohne, bisher.get("vorschlaege")))
    n_orte_abfragen = sum(1 for q in aufrufe if "foreach" in q)
    pruefe("B1b ohne Haken: keine Orte-Abfrage an Overpass", n_orte_abfragen == 0, n_orte_abfragen)

    # Mit Haken: die Liste zeigt alles, erst „Übernehmen“ dünnt aus
    await klick(page, "#hl-q-orte")
    await klick(page, "#hl-finden")
    await page.wait_for_function("() => Array.from(document.querySelectorAll('.hl-meta .muted')).some(e => e.textContent.includes('Ort oder Pass'))",
                                 timeout=60000)
    mit = await page.evaluate(LISTE_JS)
    orte_zeilen = [v for v in mit if "Ort oder Pass" in v["grund"]]
    texte = {v["text"].split("\n")[0] for v in orte_zeilen}
    pruefe("B2 mit Haken: alle Fixture-Orte und -Pässe in der Liste, angehakt", texte == ERWARTET_ALLE and all(v["an"] for v in orte_zeilen),
           (sorted(texte), len(orte_zeilen)))
    pruefe("B2b Pass-Text „Musterpass\\n884 m“, nur einmal (Dublette der OSM-Seite entfällt)",
           sum(1 for v in mit if v["text"] == "Musterpass\n884 m") == 1 and sum(1 for v in mit if v["text"].startswith("Musterpass")) == 1,
           [v["text"] for v in mit if "Musterpass" in v["text"]])
    await klick(page, "#hl-uebernehmen")
    await page.wait_for_timeout(800)
    erg = await page.evaluate(FENSTER_JS)
    sg = sorted(erg["signs"], key=lambda s: s["von"])
    namen_sg = {name1(s) for s in sg}
    pruefe("B3 Übernehmen: nur die ausgedünnten Orte und alle Pässe werden Schilder, style=pin",
           namen_sg == ERWARTET_SCHILDER and all(s["style"] == "pin" for s in sg), (sorted(namen_sg), [s["style"] for s in sg]))
    pruefe("B3b Schildwerte: Deckkraft 0,6, Fenster 2+2 s, entry both; Pass abgesetzt (#ffc21a, #2b3a40), Ort #1d2b36",
           all(abs(s["opacity"] - 0.6) < 1e-9 and s["before"] == 2 and s["after"] == 2 and s["entry"] == "both" for s in sg)
           and all((s["accent"] == "#ffc21a" and s["color"] == "#2b3a40") if "pass" in name1(s).lower()
                   else s["color"] == "#1d2b36" for s in sg), sg[:2])
    toast_text = await page.evaluate("() => { const e = document.getElementById('toast'); return e && !e.hidden ? e.textContent : ''; }")
    n_aus = len(ERWARTET_ALLE) - len(ERWARTET_SCHILDER)
    pruefe("B3c Hinweis nennt die Zahl der ausgelassenen Orte",
           f"{n_aus} Orte ausgelassen" in toast_text, toast_text)
    pruefe("B4 Ort mit Abstand 2000 m entfällt, Ort mit 1000 m bleibt (Grenze 1500 m)",
           "Fern2000" not in namen_sg and "Nah1000" in namen_sg, sorted(namen_sg))
    fenster_pruefen(sg, "B5", "Ausdünnen")
    a = [s for s in sg if name1(s) in ("A1", "A2", "A3")]
    pruefe("B6 drei zeitgleiche Orte bleiben alle (Fenster überlappen sich)",
           len(a) == 3 and a[1]["von"] < a[0]["bis"] and a[2]["von"] < a[0]["bis"], [(name1(s), s["von"], s["bis"]) for s in a])
    pruefe("B6b vier gleichzeitig (B1–B3 + Pass): der Pass bleibt, das fernste B3 entfällt, B1/B2 bleiben",
           "Mittendrinpass" in namen_sg and {"B1", "B2"} <= namen_sg and "B3" not in namen_sg, sorted(namen_sg))
    pruefe("B6d Pass verdrängt Ortsteil: bei vier gleichzeitigen (C1, C2, Ortsteil, Pass) entfällt der Ortsteil",
           {"C1", "C2", "CPass"} <= namen_sg and "CTeil" not in namen_sg, sorted(namen_sg))
    pruefe("B6e Ortsteil ≤ 1500 m (Teil1200) wird Schild; das Duplikat Nah1000 gibt es nur einmal",
           "Teil1200" in namen_sg and sum(1 for v in mit if v["text"] == "Nah1000") == 1, sorted(namen_sg))
    pruefe(f"B6f Orts-, Ortsteil- und Pass-Schilder haben die Größe {ORTE_SCHILD_GROESSE}",
           all(s["size"] == ORTE_SCHILD_GROESSE for s in sg), [(name1(s), s["size"]) for s in sg])
    pruefe("B6c Fenster nicht unter das Original gekürzt (vor 2 s, nach 2 s)", all(s["before"] == 2 and s["after"] == 2 for s in sg))
    s0 = sg[0]
    pruefe("B7 nach a_hide ist das Schild unsichtbar (Deckkraft 0), mittendrin sichtbar",
           s0["fadeOut"] > 0 and s0["nach"] <= 0 and s0["mitte"] > 0.99, (s0["fadeOut"], s0["nach"], s0["mitte"]))

    # Kurze Videodauer: 20 Orte im Abstand von 1,4 s, ein Fenster dauert 4 s — es wird ausgedünnt, nichts verschoben
    MODUS["viele"] = True
    cache = Path(eb.APP.APP_SUPPORT) / "orte_paesse_cache.json"
    if cache.exists():
        cache.unlink()
    await page.evaluate("() => { getActiveProject().signs = []; }")
    await page.evaluate("""() => { const d = document.getElementById('anim-dur'); d.value = 30;
        d.dispatchEvent(new Event('input', { bubbles: true })); d.dispatchEvent(new Event('change', { bubbles: true })); }""")
    await page.wait_for_timeout(500)
    await page.evaluate("document.getElementById('anim-signs-highlights').click()")
    await page.wait_for_timeout(600)
    await page.wait_for_function("() => !!document.getElementById('hl-finden')", timeout=10000)
    await page.evaluate("() => { const c = document.getElementById('hl-q-orte'); if (!c.checked) c.click(); }")
    await klick(page, "#hl-finden")
    await page.wait_for_function("() => Array.from(document.querySelectorAll('.hl-meta .muted')).some(e => e.textContent.includes('Ort oder Pass'))",
                                 timeout=60000)
    await klick(page, "#hl-uebernehmen")
    await page.wait_for_timeout(800)
    erg2 = await page.evaluate(FENSTER_JS)
    sk = sorted(erg2["signs"], key=lambda s: s["von"])
    pruefe("B9 kurze Videodauer (20 Orte, 1,4 s auseinander, Fenster 4 s): höchstens 3 gleichzeitig, also bleiben alle 20",
           erg2["dur"] == 30 and len(sk) == 20 and name1(sk[0]) == "Viel01", (erg2["dur"], [name1(s) for s in sk]))
    fenster_pruefen(sk, "B9c", "kurze Videodauer")
    pruefe("B9d kurze Videodauer: alle timeAnchor zwischen 0 und 1", all(x["ta"] is None or 0 <= x["ta"] <= 1 for x in sk),
           [x["ta"] for x in sk])
    pruefe("B8 kein pageerror", not fehler, fehler[:3])
    await browser.close()


async def main_b(tmp):
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        try:
            await teil_b(p, tmp)
        except Exception as e:  # noqa: BLE001 — fehlendes Bedienelement o. ä. ist ein Prüfungsfehler, kein Absturz
            pruefe("B Lauf ohne Ausnahme", False, f"{type(e).__name__}: {str(e).splitlines()[0][:200]}")


if __name__ == "__main__":
    if "--erzeugen" in sys.argv:
        print(repr(osm_ergebnis()))
        sys.exit(0)
    with tempfile.TemporaryDirectory(prefix="rz-orte-b-") as tmp_b:
        main_a()
        asyncio.run(main_b(tmp_b))
    ok = all(ergebnisse)
    print("RESULT: " + ("OK" if ok else "FAIL"))
    sys.exit(0 if ok else 1)
