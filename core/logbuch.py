"""Logbuch der Tour — was wann war (docs/LOGBUCH.md, IDEAS §68, Stufe 1).

Marc, 13.09.2026: „wie wäre es, wenn der inspector eine art logbuch generiert,
was wo war — zeit von bis: fähre von bis, pause, fahrt von nach, spaziergang/
wanderung usw. … höchster punkt."

**Eine Wahrheit (Q2).** Das Logbuch IST die Einteilung „Bewegung" aus
core/einteilung — die rohen Bereiche der Erkennung (core/bewegung) plus die
Punkt-Einträge (höchster Punkt, Start und Ziel je Tag). Dieses Modul macht daraus
die *lesbare Folge*: Es ändert die Einteilung nicht, sondern legt beim Lesen die
Regeln darüber, die Marc festgelegt hat:

- **Q5 — kein „Halt".** Stillstand ab zehn Minuten ist eine Pause. Was kürzer
  ist, geht im umgebenden Abschnitt auf (die Ampel, der Blick auf die Karte).
  Die Rohdaten bleiben; „alles zeigen" holt sie in der Oberfläche zurück.
- **Q7 — Gehen bekommt einen Namen.** Sagt die Tour „Wandern", ist jedes Gehen
  eine Wanderung; sagt sie „Spaziergang", ein Spaziergang. Sonst entscheiden
  Länge und Höhenmeter. Intern bleibt es `gehen`.
- **Q8 — unsicher wird dem Nachbarn zugeschlagen.** Liegt „unsicher" zwischen
  zwei gleichen Arten, ist es diese Art; hat es nur einen bewegten Nachbarn,
  dessen. Geht beides nicht, bleibt es ehrlich „Rad oder Laufen?".

Die Schwellen sind Einstellungen (Q13, ab Stufe 2 in der Oberfläche); hier
stehen die Standardwerte.
"""
from __future__ import annotations

from bisect import bisect_left, bisect_right
from datetime import datetime
from typing import List, Optional

STANDARD = {
    "orte_holen": 1.0,          # Q10: Ortsnamen im Netz nachschlagen (Photon), abschaltbar
    "pois_holen": 1.0,          # Q11: Sehenswürdigkeiten am Weg suchen (OSM), abschaltbar
    "pois_menge": 30.0,         # Q11: wie viele POIs die Spur höchstens zeigt
    "pause_ab_s": 600.0,        # Q5: Stillstand ab 10 min wird Pause
    "wanderung_ab_m": 5000.0,   # Q7: Gehen ab 5 km …
    "wanderung_ab_hm": 200.0,   # … oder ab 200 Höhenmetern ist eine Wanderung
    "langsame_fahrt_bis_s": 2700.0,   # Rad/Laufen unter 45 min zwischen zwei Fahrten = langsame Fahrt
    "fahrt_beherrscht_ab_m": 300000.0,  # ab 300 km Fahrt (doppelt so weit wie Rad, Rad nur kurze Stücke) = langsame Fahrt
}
HM_SCHWELLE_M = 3.0            # Höhenmeter zählen erst ab 3 m Änderung (GPS-Rauschen)

UNSICHER_RAD_AB_KMH = 7.0   # 14.09.2026 — dauerhaft schneller geht niemand; darüber ist „unsicher“ Rad/Laufen
PUNKT_ARTEN = ("hoechster_punkt", "start", "ziel", "punkt", "poi")
HAND_ARTEN = ("fahrt", "uebersetzen", "wanderung", "spaziergang", "rad", "laufen", "wassersport", "pause")   # Q12: Art ändern
BEWEGT = ("gehen", "laufen", "rad", "fahrt", "uebersetzen")
STILL = ("halt", "pause")


# ── Zeit ────────────────────────────────────────────────────────────────────

def _epoch(t) -> Optional[float]:
    if t is None:
        return None
    if isinstance(t, (int, float)):
        return float(t)
    try:
        return datetime.fromisoformat(str(t).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


class _Zeiten:
    """Punktzeiten sortiert, für die Suche „welche Punkte liegen in [t0, t1]"."""

    def __init__(self, points):
        self.ts: List[float] = []
        self.idx: List[int] = []
        self.pts = list(points or [])
        for i, p in enumerate(self.pts):
            t = _epoch(p.get("time") if isinstance(p, dict) else getattr(p, "time", None))
            if t is not None:
                self.ts.append(t)
                self.idx.append(i)

    def bereich(self, t0: float, t1: float):
        """(erster, letzter) Punkt-Index innerhalb [t0, t1] — oder None."""
        if not self.ts:
            return None
        a = bisect_left(self.ts, t0)
        b = bisect_right(self.ts, t1) - 1
        if b < a:
            return None
        return self.idx[a], self.idx[b]

    def naechster(self, t: float) -> Optional[int]:
        if not self.ts:
            return None
        k = bisect_left(self.ts, t)
        if k >= len(self.ts):
            return self.idx[-1]
        if k > 0 and (t - self.ts[k - 1]) < (self.ts[k] - t):
            return self.idx[k - 1]
        return self.idx[k]


def _ele(p):
    e = p.get("ele") if isinstance(p, dict) else getattr(p, "ele", None)
    try:
        e = float(e)
    except (TypeError, ValueError):
        return None
    return e if e == e else None   # NaN raus


def hoehenmeter(points, a: int, b: int) -> dict:
    """Bergauf/bergab zwischen zwei Punkt-Indizes, mit Schwelle gegen Rauschen."""
    auf = ab = 0.0
    letzte = None
    hoch = tief = None
    for k in range(max(0, a), min(len(points), b + 1)):
        e = _ele(points[k])
        if e is None:
            continue
        hoch = e if hoch is None else max(hoch, e)
        tief = e if tief is None else min(tief, e)
        if letzte is None:
            letzte = e
            continue
        d = e - letzte
        if abs(d) < HM_SCHWELLE_M:
            continue
        if d > 0:
            auf += d
        else:
            ab -= d
        letzte = e
    return {"auf": round(auf), "ab": round(ab), "hoch": hoch, "tief": tief}


# ── Punkt-Einträge (Q9: höchster Punkt, Start, Ziel — je Tag) ───────────────

def punkte_erzeugen(points, tage: Optional[List[dict]] = None) -> List[dict]:
    """Die Punkt-Einträge der Tour: je Tag der höchste Punkt, Start und Ziel.

    Ohne Tage (Track ohne Datum) gilt die ganze Tour als ein Tag. Rückgabe sind
    schlichte Dicts `{t, art, lat, lon, ele, tag}` — core/einteilung macht daraus
    Bereiche mit t0 == t1 in derselben Einteilung wie die Bewegung.
    """
    z = _Zeiten(points)
    if not z.ts:
        return []
    fenster = [(float(x["t0"]), float(x["t1"]), int(x.get("nr") or k + 1))
               for k, x in enumerate(tage or []) if x.get("t0") is not None]
    if not fenster:
        fenster = [(z.ts[0], z.ts[-1], 1)]
    raus: List[dict] = []
    for t0, t1, nr in fenster:
        lage = z.bereich(t0, t1)
        if lage is None:
            continue
        a, b = lage

        def punkt(k, art, nr=nr):
            p = z.pts[k]
            g = (lambda n: p.get(n) if isinstance(p, dict) else getattr(p, n, None))
            return {"t": _epoch(g("time")), "art": art, "lat": g("lat"), "lon": g("lon"),
                    "ele": _ele(p), "tag": nr, "idx": k}

        raus.append(punkt(a, "start"))
        hoch_k, hoch_e = None, None
        for k in range(a, b + 1):
            e = _ele(z.pts[k])
            if e is not None and (hoch_e is None or e > hoch_e):
                hoch_k, hoch_e = k, e
        if hoch_k is not None and b > a:
            raus.append(punkt(hoch_k, "hoechster_punkt"))
        if b > a:
            raus.append(punkt(b, "ziel"))
    return raus


# ── Die lesbare Folge (Q5, Q7, Q8) ──────────────────────────────────────────

def _prior(aktivitaet: Optional[str]) -> str:
    a = (aktivitaet or "").lower()
    # Marc, 13.09.2026 (Kajak-Tour als „Wanderung"): „Wanderung auf dem Wasser ist
    # sehr unwahrscheinlich" — sagt die Tour Boot/Kajak/SUP, ist alles Langsame
    # Wassersport. Die Art je Eintrag ändern kommt mit Stufe 2.
    if any(w in a for w in ("boot", "boat", "kajak", "kayak", "kanu", "canoe", "paddel", "paddl",
                            "sup", "segel", "sail", "ruder", "row", "wasser", "water", "surf")):
        return "wassersport"
    if any(w in a for w in ("spazier", "walk")):
        return "spaziergang"
    if any(w in a for w in ("wander", "hik", "trek", "berg")):
        return "wanderung"
    return ""


def _anzeige_art(e: dict, prior: str, einst: dict) -> str:
    if prior == "wassersport" and e["art"] in ("gehen", "laufen", "rad", "unsicher"):
        return "wassersport"
    if e["art"] != "gehen":
        return e["art"]
    if prior:
        return prior
    if (e.get("strecke_m") or 0) >= einst["wanderung_ab_m"] or (e.get("hoehe_auf") or 0) >= einst["wanderung_ab_hm"]:
        return "wanderung"
    return "spaziergang"


def _eintrag(b: dict) -> dict:
    art = "pause" if b["art"] in STILL else b["art"]
    return {"id": b["id"], "bids": [b["id"]], "art": art, "art_roh": b["art"],
            "name": b.get("name") or "", "quelle": b.get("quelle") or "auto",
            "anzeige": b.get("anzeige") or "", "t0": float(b["t0"]), "t1": float(b["t1"]),
            "strecke_m": float(b.get("strecke_m") or 0.0), "geraten": False,
            "dauer_roh": max(0.0, float(b["t1"]) - float(b["t0"])),
            "grenze": bool(b.get("grenze"))}


def _messen(e: dict, z: Optional[_Zeiten]) -> None:
    e["dauer_s"] = round(max(0.0, e["t1"] - e["t0"]), 1)
    e["tempo_kmh"] = round(e["strecke_m"] / e["dauer_s"] * 3.6, 1) if e["dauer_s"] > 0 and e["art"] not in ("pause",) else 0.0
    e["hoehe_auf"] = e["hoehe_ab"] = 0
    e["von_idx"] = e["bis_idx"] = None
    if z is None:
        return
    lage = z.bereich(e["t0"], e["t1"])
    if lage is None:
        return
    e["von_idx"], e["bis_idx"] = lage
    if e["art"] != "pause":
        hm = hoehenmeter(z.pts, lage[0], lage[1])
        e["hoehe_auf"], e["hoehe_ab"] = hm["auf"], hm["ab"]


def _verschmelzen(folge: List[dict]) -> List[dict]:
    raus: List[dict] = []
    for e in folge:
        v = raus[-1] if raus else None
        if v and not e["grenze"] and v["art"] == e["art"] and v["name"] == e["name"] \
                and v["quelle"] == e["quelle"] and abs(v["t1"] - e["t0"]) < 1e-6:
            v["t1"] = e["t1"]
            v["strecke_m"] += e["strecke_m"]
            v["dauer_roh"] = (v.get("dauer_roh") or 0.0) + (e.get("dauer_roh") or 0.0)
            v["bids"] += e["bids"]
            v["geraten"] = v["geraten"] or e["geraten"]
            continue
        raus.append(e)
    return raus


def eintraege(bereiche: List[dict], points=None, aktivitaet: Optional[str] = None,
              tage: Optional[List[dict]] = None, einstellungen: Optional[dict] = None) -> dict:
    """Aus den rohen Bereichen der Einteilung „Bewegung" die Folge des Logbuchs.

    Rückgabe: ``eintraege`` (Bereiche mit t0 < t1), ``punkte`` (t0 == t1),
    ``verborgen`` (Kennungen der aufgegangenen kurzen Halte), ``zusammenfassung``
    je Anzeige-Art und ``hoechster`` (der höchste Punkt der ganzen Tour).
    """
    einst = dict(STANDARD)
    einst.update({k: float(v) for k, v in (einstellungen or {}).items() if v is not None})
    z = _Zeiten(points) if points else None
    prior = _prior(aktivitaet)

    punkte: List[dict] = []
    folge: List[dict] = []
    for b in sorted(bereiche or [], key=lambda x: (x["t0"], x["t1"])):
        if b.get("art") == "weg":          # Grabstein eines gelöschten Punkts
            continue
        if b.get("art") in PUNKT_ARTEN or b["t1"] <= b["t0"]:
            p = dict(b)
            p["t"] = float(b["t0"])
            if z is not None and p.get("idx") is None:
                p["idx"] = z.naechster(p["t"])
            punkte.append(p)
            continue
        folge.append(_eintrag(b))

    # Q5: kurze Stillstände gehen im Nachbarn auf. Benannte Halte der
    # Aufzeichnungs-App bleiben — der Nutzer hat sie bewusst gesetzt. Handarbeit
    # bleibt immer.
    verborgen: List[str] = []
    behalten: List[dict] = []
    for k, e in enumerate(folge):
        kurz = (e["art"] == "pause" and (e["t1"] - e["t0"]) < einst["pause_ab_s"]
                and e["quelle"] == "auto")
        if not kurz:
            behalten.append(e)
            continue
        verborgen.append(e["id"])
        if behalten:
            behalten[-1]["t1"] = e["t1"]          # der Abschnitt davor läuft durch
        elif k + 1 < len(folge):
            folge[k + 1]["t0"] = e["t0"]          # ganz am Anfang: der danach beginnt früher
    folge = behalten

    # Q8: unsicher dem Nachbarn zuschlagen — Pausen dazwischen zählen nicht.
    def bewegter_nachbar(k, schritt):
        m = k + schritt
        while 0 <= m < len(folge):
            if folge[m]["art"] in BEWEGT:
                return folge[m]["art"]
            if folge[m]["art"] == "unsicher":
                return None
            m += schritt
        return None

    # 14.09.2026 (Marc, Radtour mit dem Sohn, 7–12 km/h, zwischendurch abgestiegen): „unsicher“
    # heißt hier fast immer langsames Rad. Dem Gehen-Nachbarn zugeschlagen wurde daraus eine
    # einzige Wanderung. Jetzt entscheidet das Tempo mit: Gehen geht nicht dauerhaft über
    # UNSICHER_RAD_AB_KMH — ein solches Stück wird Rad (bzw. Laufen, wenn die Tour ein Lauf ist).
    lauf_tour = bool(aktivitaet) and any(w in str(aktivitaet).lower() for w in ("lauf", "run", "jog", "trail"))

    def tempo(e):
        # Bewegtes Tempo VOR dem Aufgehen kurzer Halte (Q5 verlängert t0/t1 und verwässert es)
        d = e.get("dauer_roh") or (e["t1"] - e["t0"])
        return (e["strecke_m"] / d * 3.6) if d > 0 else 0.0

    for k, e in enumerate(folge):
        if e["art"] != "unsicher":
            continue
        links, rechts = bewegter_nachbar(k, -1), bewegter_nachbar(k, +1)
        schnell = tempo(e) >= UNSICHER_RAD_AB_KMH
        neu = None
        if links and rechts and links == rechts:
            neu = links
        elif (links and not rechts) or (rechts and not links):
            neu = links or rechts
        elif links and rechts:                       # verschiedene Nachbarn: das passende Tempo
            zu_fuss = [x for x in (links, rechts) if x == "gehen"]
            anders = [x for x in (links, rechts) if x in ("rad", "laufen")]   # Fahrt/Fähre: ehrlich unsicher lassen
            neu = (anders[0] if anders else None) if schnell else (zu_fuss[0] if zu_fuss else None)
        if neu == "gehen" and schnell:
            neu = "laufen" if lauf_tour else "rad"
        if neu is None and schnell and not links and not rechts and prior != "wassersport":
            neu = "laufen" if lauf_tour else "rad"
        if neu and neu != "uebersetzen":
            e["art"] = neu
            e["geraten"] = True

    # Langsame Fahrt (13.09.2026, an der Wohnmobil-Reise gesehen): Rät das Archiv
    # die Aktivität falsch („Rad" für ein Wohnmobil), wird jede Ortsdurchfahrt mit
    # 15–35 km/h zu „Rad" — 199 Einträge, 31 Stunden. Ein kurzes Stück Rad oder
    # Laufen ZWISCHEN zwei Fahrten ist aber praktisch immer langsames Fahren.
    # Vermutet, nicht gewusst — deshalb als „geraten" gekennzeichnet.
    for k, e in enumerate(folge):
        if e["art"] not in ("rad", "laufen") or e["quelle"] != "auto":
            continue
        if (e["t1"] - e["t0"]) >= einst["langsame_fahrt_bis_s"]:
            continue
        if bewegter_nachbar(k, -1) == "fahrt" and bewegter_nachbar(k, +1) == "fahrt":
            e["art"] = "fahrt"
            e["geraten"] = True
    # … und wenn die Fahrt die Reise beherrscht (Hunderte Kilometer, doppelt so
    # weit wie alles „Rad") UND das „Rad" aus lauter kurzen Stücken besteht, ist
    # auch das übrige „Rad" langsames Fahren: Ortsdurchfahrten. Eine Radtour mit
    # Anreise im Auto hat wenige lange Rad-Blöcke — die bleiben Rad.
    fahrt_m = sum(e["strecke_m"] for e in folge if e["art"] == "fahrt")
    rad = [e for e in folge if e["art"] == "rad" and e["quelle"] == "auto"]
    rad_m = sum(e["strecke_m"] for e in rad)
    kurz = sum(1 for e in rad if (e["t1"] - e["t0"]) < einst["langsame_fahrt_bis_s"])
    if rad and fahrt_m >= einst["fahrt_beherrscht_ab_m"] and fahrt_m >= 2.0 * rad_m \
            and kurz >= 0.7 * len(rad):
        for e in rad:
            e["art"] = "fahrt"
            e["geraten"] = True

    # 14.09.2026 — die Aktivität aus der Datei ist ein schwacher Hinweis: Komoot schreibt
    # „hike“ auch über eine Radtour. Überwiegt Rad/Laufen die Gehstrecke deutlich, gilt der
    # Wander-Hinweis nicht; die Gehstücke dazwischen sind dann Spaziergänge (Absteigen).
    if prior in ("wanderung", "spaziergang"):
        rad_m = sum(e["strecke_m"] for e in folge if e["art"] in ("rad", "laufen"))
        geh_m = sum(e["strecke_m"] for e in folge if e["art"] == "gehen")
        if rad_m > geh_m:
            prior = ""
    folge = _verschmelzen(folge)
    for e in folge:
        _messen(e, z)
        e["anzeige_art"] = _anzeige_art(e, prior, einst)
        e["notiz"] = next((b.get("notiz") or "" for b in bereiche if b["id"] in e["bids"] and b.get("notiz")), "")

    # Tag je Eintrag (nach Beginn) — nur, wenn es Tage gibt
    fenster = [(float(x["t0"]), float(x["t1"]), int(x.get("nr") or k + 1))
               for k, x in enumerate(tage or []) if x.get("t0") is not None]
    if fenster:
        def tag_von(t):
            # Ein Tag mit nur einem Punkt hat kein Fenster (berechnen_tage) — dann
            # zählt der letzte Tag, der vor dieser Zeit begonnen hat, nie der
            # letzte der Reise (sonst springt die Liste an der Stelle um).
            return next((nr for t0, t1, nr in fenster if t0 - 1 <= t <= t1 + 1),
                        next((nr for t0, _t1, nr in reversed(fenster) if t0 - 1 <= t), fenster[0][2]))
        for e in folge + punkte:
            t = e.get("t0", e.get("t"))
            e["tag"] = tag_von(t)
        # Eine Pause, die über die Nacht in den nächsten Tag reicht, ist eine
        # Übernachtung — im Wohnmobil-Logbuch die häufigste Zeile.
        for e in folge:
            if e["art"] == "pause" and (tag_von(e["t1"]) or e["tag"]) != e["tag"]:
                e["anzeige_art"] = "uebernachtung"

    zsf: dict = {}
    for e in folge:
        x = zsf.setdefault(e["anzeige_art"], {"anzahl": 0, "dauer_s": 0.0, "strecke_m": 0.0, "hoehe_auf": 0})
        x["anzahl"] += 1
        x["dauer_s"] += e["dauer_s"]
        x["strecke_m"] += e["strecke_m"]
        x["hoehe_auf"] += e.get("hoehe_auf") or 0
    for x in zsf.values():
        x["dauer_s"] = round(x["dauer_s"], 1)
        x["strecke_m"] = round(x["strecke_m"], 1)

    hoechster = None
    for p in punkte:
        if p.get("art") == "hoechster_punkt" and p.get("ele") is not None:
            if hoechster is None or p["ele"] > hoechster["ele"]:
                hoechster = p

    return {"eintraege": folge, "punkte": punkte, "verborgen": verborgen,
            "zusammenfassung": zsf, "hoechster": hoechster, "einstellungen": einst}


# ── Stufe 3: Ortsnamen (Q10) und Sehenswürdigkeiten (Q11) ──────────────────
#
# Beides braucht Netz und läuft NACH dem Logbuch im Hintergrund (Kasten unten
# rechts), abschaltbar. Was einmal nachgeschlagen wurde, bleibt in der Bibliothek:
# Ortsnamen je Stelle (rund 100 m Raster), POIs je Tour. Ohne Netz wird später
# nachgetragen — es fehlt dann ein Name, nie ein Eintrag.

import json as _json
import math as _math
import sqlite3 as _sqlite3
from datetime import datetime as _dt, timezone as _tz

SCHEMA = """
CREATE TABLE IF NOT EXISTS logbuch_orte (
    schluessel TEXT PRIMARY KEY,   -- "lat,lon" auf 3 Stellen (~100 m)
    ort        TEXT DEFAULT '',
    gemeinde   TEXT DEFAULT '',
    land       TEXT DEFAULT '',
    geaendert  TEXT
);
CREATE TABLE IF NOT EXISTS logbuch_pois (
    tour       TEXT PRIMARY KEY,
    daten      TEXT DEFAULT '[]',
    geaendert  TEXT
);
"""
POI_WICHTIG_RANG = 1        # Gipfel, Pässe, Burgen: immer ins Logbuch (Q11)
POI_PAUSE_NAH_M = 300.0     # ein POI so nah an einer Pause gehört dazu


def schema_anlegen(conn: _sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    conn.commit()


def _jetzt() -> str:
    return _dt.now(_tz.utc).isoformat(timespec="seconds")


def ort_schluessel(lat, lon) -> str:
    return f"{round(float(lat), 3):.3f},{round(float(lon), 3):.3f}"


def ort_lesen(conn, lat, lon) -> Optional[dict]:
    r = conn.execute("SELECT ort, gemeinde, land FROM logbuch_orte WHERE schluessel = ?",
                     (ort_schluessel(lat, lon),)).fetchone()
    return {"ort": r[0], "gemeinde": r[1], "land": r[2]} if r else None


def ort_merken(conn, lat, lon, ort: str, gemeinde: str = "", land: str = "") -> None:
    conn.execute("INSERT INTO logbuch_orte(schluessel, ort, gemeinde, land, geaendert) VALUES(?,?,?,?,?) "
                 "ON CONFLICT(schluessel) DO UPDATE SET ort=excluded.ort, gemeinde=excluded.gemeinde, "
                 "land=excluded.land, geaendert=excluded.geaendert",
                 (ort_schluessel(lat, lon), ort or "", gemeinde or "", land or "", _jetzt()))
    conn.commit()


def ort_aus_adresse(a: Optional[dict]) -> dict:
    """Aus der normalisierten Adresse (core/geocode) das Grobe: „Ort, Gemeinde"."""
    if not a:
        return {"ort": "", "gemeinde": "", "land": ""}
    ort = (a.get("city") or a.get("county") or a.get("state") or "").strip()
    gemeinde = (a.get("county") or a.get("state") or "").strip()
    if gemeinde == ort:
        gemeinde = (a.get("state") or "").strip() if (a.get("state") or "").strip() != ort else ""
    return {"ort": ort, "gemeinde": gemeinde, "land": (a.get("country") or "").strip()}


def ort_kurz(o: Optional[dict]) -> str:
    if not o or not o.get("ort"):
        return ""
    return o["ort"] + (", " + o["gemeinde"] if o.get("gemeinde") and o["gemeinde"] != o["ort"] else "")


def orte_stellen(eintraege_: List[dict], punkte: List[dict], points) -> List[dict]:
    """Wo ein Ortsname gebraucht wird: Pausen „hier", Bewegung „von"/„nach", Punkte „hier".
    Punkte der Aufzeichnungs-App mit Namen brauchen keinen (Q10: App-Name zuerst)."""
    raus: List[dict] = []

    def koord(i):
        if i is None or i < 0 or i >= len(points):
            return None
        p = points[i]
        la = p.get("lat") if isinstance(p, dict) else getattr(p, "lat", None)
        lo = p.get("lon") if isinstance(p, dict) else getattr(p, "lon", None)
        return (float(la), float(lo)) if la is not None and lo is not None else None

    for e in eintraege_:
        if e["art"] == "pause":
            if e.get("name"):
                continue
            k = koord(e.get("von_idx"))
            if k:
                raus.append({"id": e["id"], "rolle": "hier", "lat": k[0], "lon": k[1]})
        else:
            for rolle, idx in (("von", e.get("von_idx")), ("nach", e.get("bis_idx"))):
                k = koord(idx)
                if k:
                    raus.append({"id": e["id"], "rolle": rolle, "lat": k[0], "lon": k[1]})
    for p in punkte:
        if p.get("name") or p.get("art") == "poi":
            continue
        k = koord(p.get("idx")) if p.get("idx") is not None else (
            (float(p["lat"]), float(p["lon"])) if p.get("lat") is not None else None)
        if k:
            raus.append({"id": p["id"], "rolle": "hier", "lat": k[0], "lon": k[1]})
    return raus


def _hav(lat1, lon1, lat2, lon2) -> float:
    R = 6371000.0
    p1, p2 = _math.radians(lat1), _math.radians(lat2)
    d = _math.sin((p2 - p1) / 2) ** 2 + _math.cos(p1) * _math.cos(p2) * _math.sin(_math.radians(lon2 - lon1) / 2) ** 2
    return 2 * R * _math.asin(_math.sqrt(d))


def pois_bewerten(pois: List[dict], eintraege_: List[dict], points) -> List[dict]:
    """Q11: Welche POIs gehören ins Logbuch — Gipfel/Pässe/Burgen immer, andere nur
    in Pausen-Nähe. Alle anderen bleiben in der POI-Spur."""
    pausen = []
    for e in eintraege_:
        if e["art"] == "pause" and e.get("von_idx") is not None:
            p = points[e["von_idx"]]
            la = p.get("lat") if isinstance(p, dict) else getattr(p, "lat", None)
            lo = p.get("lon") if isinstance(p, dict) else getattr(p, "lon", None)
            if la is not None:
                pausen.append((float(la), float(lo), e["id"]))
    raus = []
    for q in pois:
        q = dict(q)
        nah = next((pid for la, lo, pid in pausen if _hav(la, lo, q["lat"], q["lon"]) <= POI_PAUSE_NAH_M), None)
        q["pause"] = nah
        q["wichtig"] = bool(int(q.get("rang", 9)) <= POI_WICHTIG_RANG or nah)
        raus.append(q)
    return raus


def pois_lesen(conn, tour: str) -> Optional[List[dict]]:
    r = conn.execute("SELECT daten FROM logbuch_pois WHERE tour = ?", (tour,)).fetchone()
    if not r:
        return None
    try:
        return list(_json.loads(r[0] or "[]"))
    except (TypeError, ValueError):
        return None


def pois_merken(conn, tour: str, pois: List[dict]) -> None:
    conn.execute("INSERT INTO logbuch_pois(tour, daten, geaendert) VALUES(?,?,?) "
                 "ON CONFLICT(tour) DO UPDATE SET daten=excluded.daten, geaendert=excluded.geaendert",
                 (tour, _json.dumps(pois, ensure_ascii=False, separators=(",", ":")), _jetzt()))
    conn.commit()
