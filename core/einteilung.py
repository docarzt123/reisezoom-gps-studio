"""Einteilungen einer Tour — Tage, Bewegungsart, eigene Bereiche (IDEAS §67, Schritt 4).

Marc, 13.09.2026: „nach Tagen zerlegen können, aber auch nach Bewegungsart oder
so. Aber wie wird das dann intern gespeichert? Da speichern wir dann ja jeden
Track einzeln. Das ist hier ja auch nicht richtig." — und zur Antwort
„Markierung über dem unveränderten Track": „das wäre der Königsweg".

**Was eine Einteilung ist.** Eine Liste von Bereichen über der Zeit einer Tour.
Der Track selbst bleibt unverändert; es gibt beliebig viele Einteilungen
nebeneinander (Tage UND Bewegungsart UND eigene).

**Gespeichert nach Uhrzeit, nicht nach Punktnummer (Q5).** Eine Reparatur
verschiebt Punktnummern, die Uhrzeit bleibt. Deshalb überlebt eine Einteilung
jede neue Version derselben Tour.

**Eine Zeile je Einteilung, die Bereiche als JSON.** Die Cloud spielt Nutzerdaten
ergänzend ein und löscht nie. Mit einer Zeile je Bereich blieben nach einer
Neuberechnung auf dem Zweitgerät die alten Bereiche liegen und überlagerten die
neuen; so gewinnt immer der ganze Stand einer Einteilung.

**Von Hand bleibt von Hand (Q9).** Jeder Bereich trägt seine Herkunft: `auto`
(erkannt), `app` (von der Aufzeichnungs-App geliefert) oder `hand`. Wird neu
berechnet, bleiben Hand-Bereiche stehen, und das Erkannte wird um sie herum
eingepasst.

**Rückgängig (Marc: „Undo für alles").** `stand()` liefert den kompletten Zustand
einer Einteilung, `stand_setzen()` schreibt ihn zurück — die Oberfläche legt
damit ihre Undo-Schritte an.
"""
from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional

ARTEN_EINTEILUNG = ("tage", "bewegung", "eigen")
QUELLEN = ("auto", "app", "hand")
ANZEIGEN = ("", "zeigen", "blass", "raffen", "ueberspringen")   # Q11; "" = Standard
FORMAT = 1

SCHEMA = """
CREATE TABLE IF NOT EXISTS einteilungen (
    id         TEXT PRIMARY KEY,
    tour       TEXT NOT NULL,          -- tour_id der Tour, sonst geo_hash
    art        TEXT NOT NULL,          -- tage | bewegung | eigen
    name       TEXT DEFAULT '',
    bereiche   TEXT DEFAULT '[]',      -- JSON, nach t0 sortiert
    format     INTEGER DEFAULT 1,
    geaendert  TEXT
);
CREATE INDEX IF NOT EXISTS idx_einteilungen_tour ON einteilungen(tour);
"""


def schema_anlegen(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    conn.commit()


def _jetzt() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _neue_id() -> str:
    return uuid.uuid4().hex[:12]


def einteilung_id(tour: str, art: str) -> str:
    """Tage und Bewegung gibt es je Tour genau einmal — mit fester Kennung, damit
    zwei Geräte dieselbe Zeile meinen. Eigene Einteilungen bekommen eine neue."""
    return f"{tour}:{art}" if art in ("tage", "bewegung") else f"{tour}:eigen:{_neue_id()}"


# ── Lesen und Schreiben ─────────────────────────────────────────────────────

def _zeile_zu_dict(r) -> dict:
    try:
        bereiche = json.loads(r["bereiche"] or "[]")
    except (TypeError, ValueError):
        bereiche = []
    return {"id": r["id"], "tour": r["tour"], "art": r["art"], "name": r["name"] or "",
            "bereiche": bereiche, "geaendert": r["geaendert"]}


def lesen(conn: sqlite3.Connection, tour: str) -> List[dict]:
    """Alle Einteilungen einer Tour: erst Tage, dann Bewegung, dann eigene."""
    if not tour:
        return []
    rang = {"tage": 0, "bewegung": 1, "eigen": 2}
    zeilen = conn.execute("SELECT * FROM einteilungen WHERE tour = ?", (tour,)).fetchall()
    raus = [_zeile_zu_dict(r) for r in zeilen]
    raus.sort(key=lambda e: (rang.get(e["art"], 9), e["name"], e["id"]))
    return raus


def eine(conn: sqlite3.Connection, eid: str) -> Optional[dict]:
    r = conn.execute("SELECT * FROM einteilungen WHERE id = ?", (eid,)).fetchone()
    return _zeile_zu_dict(r) if r else None


def _schreiben(conn: sqlite3.Connection, e: dict) -> dict:
    bereiche = sorted(e.get("bereiche") or [], key=lambda b: (b["t0"], b["t1"]))
    e["bereiche"] = bereiche
    e["geaendert"] = _jetzt()
    conn.execute(
        "INSERT INTO einteilungen(id, tour, art, name, bereiche, format, geaendert) "
        "VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET "
        "name=excluded.name, bereiche=excluded.bereiche, format=excluded.format, "
        "geaendert=excluded.geaendert",
        (e["id"], e["tour"], e["art"], e.get("name") or "",
         json.dumps(bereiche, ensure_ascii=False, separators=(",", ":")), FORMAT, e["geaendert"]))
    conn.commit()
    return e


def stand(conn: sqlite3.Connection, eid: str) -> Optional[dict]:
    """Der vollständige Zustand einer Einteilung — Grundlage für ⌘Z."""
    return eine(conn, eid)


def stand_setzen(conn: sqlite3.Connection, eid: str, zustand: Optional[dict]) -> Optional[dict]:
    """Einen früheren Zustand zurückschreiben. `None` = die Einteilung gab es
    vorher nicht → sie wird entfernt (Rückgängig von „anlegen")."""
    if zustand is None:
        conn.execute("DELETE FROM einteilungen WHERE id = ?", (eid,))
        conn.commit()
        return None
    z = dict(zustand)
    z["id"] = eid
    return _schreiben(conn, z)


def eigen_anlegen(conn: sqlite3.Connection, tour: str, name: str = "") -> dict:
    return _schreiben(conn, {"id": einteilung_id(tour, "eigen"), "tour": tour, "art": "eigen",
                             "name": name, "bereiche": []})


def entfernen(conn: sqlite3.Connection, eid: str) -> bool:
    n = conn.execute("DELETE FROM einteilungen WHERE id = ?", (eid,)).rowcount
    conn.commit()
    return bool(n)


# ── Berechnen ───────────────────────────────────────────────────────────────

def _epoch(t) -> Optional[float]:
    if t is None:
        return None
    if isinstance(t, (int, float)):
        return float(t)
    try:
        return datetime.fromisoformat(str(t).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def _bereich(t0: float, t1: float, art: str, name: str = "", quelle: str = "auto", **mehr) -> dict:
    b = {"id": _neue_id(), "t0": round(float(t0), 3), "t1": round(float(t1), 3), "art": art,
         "name": name, "quelle": quelle, "anzeige": ""}
    b.update({k: v for k, v in mehr.items() if v is not None})
    return b


def berechnen_bewegung(points, aktivitaet: Optional[str] = None,
                       wegpunkte: Optional[List[dict]] = None) -> List[dict]:
    """Bereiche aus der Bewegungserkennung (core/bewegung), nach Uhrzeit."""
    from . import bewegung as _bw, logbuch as _lb
    r = _bw.erkennen(points, aktivitaet=aktivitaet, wegpunkte=wegpunkte)
    raus = []
    for b in r["bereiche"]:
        if b.get("t0") is None or b.get("t1") is None or b["t1"] <= b["t0"]:
            continue
        raus.append(_bereich(b["t0"], b["t1"], b["art"], b.get("name") or "",
                             "app" if b.get("quelle") == "app" else "auto",
                             strecke_m=b.get("strecke_m"), tempo_kmh=b.get("tempo_kmh")))
    # Logbuch (§68, Q9): die Punkt-Einträge — höchster Punkt, Start und Ziel je
    # Tag — liegen in DERSELBEN Einteilung, als Bereich mit t0 == t1 und eigener
    # Koordinate. So gibt es eine Wahrheit (Q2) und ⌘Z über den Stand.
    if raus:
        for p in _lb.punkte_erzeugen(points, berechnen_tage(points)):
            if p.get("t") is None:
                continue
            raus.append(_bereich(p["t"], p["t"], p["art"], "", "auto",
                                 lat=p.get("lat"), lon=p.get("lon"), ele=p.get("ele"), tag=p.get("tag")))
    return raus


def berechnen_tage(points, versatz_min: Optional[int] = None, zone: str = "") -> List[dict]:
    """Ein Bereich je Kalendertag in der ORTSZEIT der Tour.

    Die Zone kommt aus `core/zeitzone` (Land oder Ort des Tracks); ohne sie gilt
    der übergebene Versatz, sonst UTC. Der Name bleibt leer — „Tag 3 · Mo 14. Juli"
    formt die Oberfläche in der Sprache des Nutzers aus `nr` und Datum.
    """
    from . import zeitzone as _zz
    zeiten = []
    lat = lon = None
    for p in points or []:
        t = _epoch(p.get("time") if isinstance(p, dict) else getattr(p, "time", None))
        if t is None:
            continue
        zeiten.append(t)
        if lat is None:
            lat = p.get("lat") if isinstance(p, dict) else getattr(p, "lat", None)
            lon = p.get("lon") if isinstance(p, dict) else getattr(p, "lon", None)
    if not zeiten:
        return []
    zeiten.sort()
    if not zone and versatz_min is None and lat is not None:
        try:
            zone = _zz.zone_fuer(lat, lon)
        except Exception:  # noqa: BLE001
            zone = ""

    def versatz(t):
        if versatz_min is not None:
            return int(versatz_min)
        if zone:
            try:
                return _zz.offset_min(zone, t)
            except Exception:  # noqa: BLE001
                return 0
        return 0

    raus = []
    tag_start = zeiten[0]
    tag = (datetime.fromtimestamp(zeiten[0], timezone.utc) + timedelta(minutes=versatz(zeiten[0]))).date()
    letzte = zeiten[0]
    nr = 1
    for t in zeiten[1:]:
        d = (datetime.fromtimestamp(t, timezone.utc) + timedelta(minutes=versatz(t))).date()
        if d != tag:
            if letzte > tag_start:
                raus.append(_bereich(tag_start, letzte, "tag", "", "auto", nr=nr, datum=tag.isoformat()))
                nr += 1
            tag, tag_start = d, t
        letzte = t
    if letzte > tag_start:
        raus.append(_bereich(tag_start, letzte, "tag", "", "auto", nr=nr, datum=tag.isoformat()))
    return raus


# ── Hand schlägt Automatik (Q9) ─────────────────────────────────────────────

def _ausschneiden(bereiche: List[dict], t0: float, t1: float) -> List[dict]:
    """Die Zeitspanne [t0, t1] aus allen Bereichen herausschneiden (teilt, kürzt, entfernt)."""
    raus = []
    for b in bereiche:
        if b["t1"] <= t0 or b["t0"] >= t1:
            raus.append(b)
            continue
        if b["t0"] < t0:
            links = dict(b, t1=t0)
            raus.append(links)
        if b["t1"] > t1:
            rechts = dict(b, t0=t1, id=_neue_id() if b["t0"] < t0 else b["id"])
            raus.append(rechts)
    return raus


def zusammenfuehren(alt: List[dict], neu: List[dict]) -> List[dict]:
    """Neu Erkanntes einsetzen, ohne Handarbeit zu verlieren.

    Hand-Bereiche aus `alt` bleiben unverändert stehen; die neuen automatischen
    Bereiche werden um sie herum eingepasst. Alles andere aus `alt` (auto, app)
    wird durch `neu` ersetzt.
    """
    hand = [b for b in (alt or []) if b.get("quelle") == "hand"]
    ergebnis = [dict(b) for b in (neu or [])]
    # Gelöschte automatische Punkte (Grabsteine, art "weg") kommen nicht zurück (Marc 13.09.2026)
    weg = [h for h in hand if h.get("art") == "weg"]
    if weg:
        def _begraben(b):
            if not _ist_punkt(b):
                return False
            for w in weg:
                if w.get("osm_id") and str(w.get("osm_id")) == str(b.get("osm_id")):
                    return True
                if w.get("weg_art") == b.get("art") and abs(float(w["t0"]) - float(b["t0"])) <= 120:
                    return True
            return False
        ergebnis = [b for b in ergebnis if not _begraben(b)]
    # Handpunkte mit gleicher Art ersetzen den automatischen (umbenannter Start bleibt einmal da)
    for h in hand:
        if _ist_punkt(h) and h.get("art") in ("start", "ziel", "hoechster_punkt"):
            ergebnis = [b for b in ergebnis if not (_ist_punkt(b) and b.get("art") == h.get("art")
                                                    and abs(float(b["t0"]) - float(h["t0"])) <= 120)]
    for h in hand:
        if _ist_punkt(h):          # ein Punkt schneidet nichts aus (sonst teilt er Bereiche)
            continue
        ergebnis = _ausschneiden(ergebnis, h["t0"], h["t1"])
    ergebnis += [dict(h) for h in hand]
    ergebnis.sort(key=lambda b: (b["t0"], b["t1"]))
    return ergebnis


def neu_berechnen(conn: sqlite3.Connection, tour: str, art: str, points,
                  aktivitaet: Optional[str] = None, wegpunkte: Optional[List[dict]] = None) -> dict:
    """Tage oder Bewegung (neu) berechnen und speichern — Handarbeit bleibt."""
    if art not in ("tage", "bewegung"):
        raise ValueError(f"nicht berechenbar: {art}")
    neu = berechnen_tage(points) if art == "tage" else berechnen_bewegung(points, aktivitaet, wegpunkte)
    eid = einteilung_id(tour, art)
    alt = eine(conn, eid)
    bereiche = zusammenfuehren((alt or {}).get("bereiche") or [], neu)
    return _schreiben(conn, {"id": eid, "tour": tour, "art": art,
                             "name": (alt or {}).get("name") or "", "bereiche": bereiche})


# ── Bearbeiten (alles wird „hand") ──────────────────────────────────────────

def _laden(conn, eid) -> dict:
    e = eine(conn, eid)
    if e is None:
        raise KeyError(f"Einteilung nicht gefunden: {eid}")
    return e


def _finden(e: dict, bid: str) -> int:
    for k, b in enumerate(e["bereiche"]):
        if b["id"] == bid:
            return k
    raise KeyError(f"Bereich nicht gefunden: {bid}")


def bereich_setzen(conn: sqlite3.Connection, eid: str, t0: float, t1: float, art: str,
                   name: str = "") -> dict:
    """Einen Bereich von Hand setzen. Was darunter lag, wird ausgeschnitten."""
    t0, t1 = float(min(t0, t1)), float(max(t0, t1))
    e = _laden(conn, eid)
    e["bereiche"] = _ausschneiden(e["bereiche"], t0, t1)
    e["bereiche"].append(_bereich(t0, t1, art, name, "hand", grenze=True))
    return _schreiben(conn, e)


def bereich_aendern(conn: sqlite3.Connection, eid: str, bid, **felder) -> dict:
    """Art, Name, Notiz oder Anzeige ändern. Macht den Bereich zu Handarbeit,
    außer bei der reinen Anzeige — die ist eine Darstellungswahl, keine Korrektur.

    `bid` darf eine Liste sein (Logbuch §68: ein Eintrag besteht aus mehreren
    rohen Bereichen) — dann bekommen alle dieselben Felder.
    """
    e = _laden(conn, eid)
    bids = list(bid) if isinstance(bid, (list, tuple)) else [bid]
    for einer in bids:
        b = e["bereiche"][_finden(e, einer)]
        inhalt = False
        for k in ("art", "name", "notiz"):
            if k in felder and felder[k] is not None:
                b[k] = str(felder[k])
                inhalt = True
        if "anzeige" in felder:
            a = str(felder["anzeige"] or "")
            if a not in ANZEIGEN:
                raise ValueError(f"unbekannte Anzeige: {a}")
            b["anzeige"] = a
        if inhalt:
            b["quelle"] = "hand"
    return _schreiben(conn, e)


def _ist_punkt(b: dict) -> bool:
    return b["t1"] <= b["t0"]


def punkt_setzen(conn: sqlite3.Connection, eid: str, t: float, art: str = "punkt", name: str = "",
                 lat=None, lon=None, ele=None, quelle: str = "hand", **mehr) -> dict:
    """Einen Punkt-Eintrag setzen (Logbuch §68 Q12, POIs Q11). Schneidet nichts aus —
    ein Punkt liegt in einem Bereich, er ersetzt ihn nicht."""
    e = _laden(conn, eid)
    if mehr.get("osm_id"):          # wieder übernommen: Grabstein weg
        e["bereiche"] = [b for b in e["bereiche"]
                         if not (b.get("art") == "weg" and str(b.get("osm_id")) == str(mehr["osm_id"]))]
    e["bereiche"].append(_bereich(t, t, art, name, quelle, lat=lat, lon=lon, ele=ele, **mehr))
    return _schreiben(conn, e)


def aufgehen_lassen(conn: sqlite3.Connection, eid: str, bids) -> dict:
    """Bereiche löschen, ohne ein Loch zu lassen (Q12 „löschen — geht im Nachbarn
    auf"): der Bereich davor wächst bis zum Ende des Gelöschten; gibt es keinen,
    beginnt der danach früher. Punkte werden einfach entfernt."""
    e = _laden(conn, eid)
    weg = set(list(bids) if isinstance(bids, (list, tuple)) else [bids])
    for w in weg:
        _finden(e, w)
    opfer = [b for b in e["bereiche"] if b["id"] in weg and not _ist_punkt(b)]
    e["bereiche"] = [b for b in e["bereiche"] if b["id"] not in weg]
    if opfer:
        t0 = min(b["t0"] for b in opfer)
        t1 = max(b["t1"] for b in opfer)
        bereiche = [b for b in e["bereiche"] if not _ist_punkt(b)]
        davor = [b for b in bereiche if b["t1"] <= t0 + 1e-6]
        danach = [b for b in bereiche if b["t0"] >= t1 - 1e-6]
        if davor:
            n = max(davor, key=lambda b: b["t1"])
            n["t1"] = max(n["t1"], t1)
            n["quelle"] = "hand"
        elif danach:
            n = min(danach, key=lambda b: b["t0"])
            n["t0"] = min(n["t0"], t0)
            n["quelle"] = "hand"
    return _schreiben(conn, e)


def teilen(conn: sqlite3.Connection, eid: str, bid: str, t: float) -> dict:
    e = _laden(conn, eid)
    k = _finden(e, bid)
    b = e["bereiche"][k]
    if not (b["t0"] < t < b["t1"]):
        raise ValueError("Schnitt liegt nicht im Bereich")
    links = dict(b, t1=float(t), quelle="hand")
    # `grenze`: eine bewusst gesetzte Grenze — das Logbuch legt gleichartige Nachbarn
    # sonst beim Lesen wieder zusammen (Marc, 13.09.2026: „der teilt viel weiter hinten").
    rechts = dict(b, t0=float(t), id=_neue_id(), quelle="hand", grenze=True)
    e["bereiche"][k:k + 1] = [links, rechts]
    return _schreiben(conn, e)


def _nachbarn(e: dict, bid_a: str, bid_b: str):
    """Zwei Bereiche in Zeitfolge (links, rechts) samt allem, was dazwischen liegt.
    Im Logbuch (§68) sind zwei Einträge oft nur durch einen verborgenen kurzen Halt
    getrennt — der geht dann mit auf. Punkte dazwischen bleiben stehen."""
    a, b = e["bereiche"][_finden(e, bid_a)], e["bereiche"][_finden(e, bid_b)]
    if _ist_punkt(a) or _ist_punkt(b):
        raise ValueError("Punkte haben keine gemeinsame Grenze")
    l, r = (a, b) if a["t0"] <= b["t0"] else (b, a)
    if l["t1"] > r["t0"] + 1e-6:
        raise ValueError("die Bereiche überlappen sich")
    zwischen = [x for x in e["bereiche"] if not _ist_punkt(x) and x is not l and x is not r
                and x["t0"] >= l["t1"] - 1e-6 and x["t1"] <= r["t0"] + 1e-6]
    return l, r, zwischen


def teilen_bei_zeit(conn: sqlite3.Connection, eid: str, t: float, kurz_s: float = 600.0) -> dict:
    """Logbuch §68: einen Eintrag an einer Uhrzeit teilen — egal, welcher rohe Bereich
    darunter liegt. Marc (13.09.2026): „da kommt: Schnitt liegt nicht im Bereich" —
    der sichtbare Eintrag reicht über einen aufgegangenen kurzen Halt hinaus, der rohe
    Bereich nicht. Fällt der Schnitt in so einen kurzen Halt, wird der Halt zur echten
    Grenze: er verschwindet, der Bereich davor endet, der danach beginnt am Schnitt."""
    e = _laden(conn, eid)
    t = float(t)
    bereiche = [b for b in e["bereiche"] if not _ist_punkt(b)]
    b = next((x for x in bereiche if x["t0"] < t < x["t1"]), None)
    if b is None:
        raise ValueError("Schnitt liegt nicht im Bereich")
    kurz = b["art"] in ("halt", "pause") and b.get("quelle") == "auto" and (b["t1"] - b["t0"]) < kurz_s
    if kurz:
        davor = [x for x in bereiche if x["t1"] <= b["t0"] + 1e-6]
        danach = [x for x in bereiche if x["t0"] >= b["t1"] - 1e-6]
        if davor and danach:
            l = max(davor, key=lambda x: x["t1"]); r = min(danach, key=lambda x: x["t0"])
            e["bereiche"] = [x for x in e["bereiche"] if x is not b]
            l["t1"] = r["t0"] = t
            l["quelle"] = r["quelle"] = "hand"
            r["grenze"] = True
            return _schreiben(conn, e)
    return teilen(conn, eid, b["id"], t)


def zusammenlegen(conn: sqlite3.Connection, eid: str, bid_a: str, bid_b: str) -> dict:
    """Zwei Bereiche zu einem — auch über verborgene kurze Halte hinweg. Art und Name vom längeren."""
    e = _laden(conn, eid)
    l, r, zwischen = _nachbarn(e, bid_a, bid_b)
    lang = l if (l["t1"] - l["t0"]) >= (r["t1"] - r["t0"]) else r
    neu = dict(lang, t0=l["t0"], t1=r["t1"], quelle="hand", grenze=bool(l.get("grenze")))
    for k in ("strecke_m", "tempo_kmh"):
        neu.pop(k, None)
    weg = {id(x) for x in zwischen} | {id(l), id(r)}
    rest = [x for x in e["bereiche"] if id(x) not in weg]
    rest.append(neu)
    e["bereiche"] = rest
    return _schreiben(conn, e)


def grenze_setzen(conn: sqlite3.Connection, eid: str, bid_links: str, bid_rechts: str, t: float) -> dict:
    """Die gemeinsame Grenze zweier Bereiche verschieben — verborgene kurze Halte dazwischen gehen auf."""
    e = _laden(conn, eid)
    l, r, zwischen = _nachbarn(e, bid_links, bid_rechts)
    if not (l["t0"] < t < r["t1"]):
        raise ValueError("Grenze läge außerhalb der beiden Bereiche")
    weg = {id(x) for x in zwischen}
    e["bereiche"] = [x for x in e["bereiche"] if id(x) not in weg]
    l["t1"] = r["t0"] = float(t)
    l["quelle"] = r["quelle"] = "hand"
    r["grenze"] = True
    return _schreiben(conn, e)


def bereich_entfernen(conn: sqlite3.Connection, eid: str, bid: str) -> dict:
    """Entfernen. Ein automatisch entstandener Punkt (Start, Ziel, POI …) hinterlässt
    einen Grabstein, damit ihn die nächste Berechnung nicht wieder einsetzt."""
    e = _laden(conn, eid)
    k = _finden(e, bid)
    b = e["bereiche"][k]
    if _ist_punkt(b) and (b.get("quelle") in ("auto", "app") or b.get("osm_id")) and b.get("art") != "weg":
        e["bereiche"][k] = _bereich(b["t0"], b["t0"], "weg", "", "hand", weg_art=b.get("art"),
                                    osm_id=b.get("osm_id"))
    else:
        del e["bereiche"][k]
    return _schreiben(conn, e)


# ── Auswertung ──────────────────────────────────────────────────────────────

def zusammenfassung(e: dict) -> dict:
    """Dauer (und, wo bekannt, Strecke) je Art — Q16: kein Ø über gemischte Tracks."""
    z: dict = {}
    for b in e.get("bereiche") or []:
        x = z.setdefault(b["art"], {"anzahl": 0, "dauer_s": 0.0, "strecke_m": 0.0})
        x["anzahl"] += 1
        x["dauer_s"] += max(0.0, b["t1"] - b["t0"])
        x["strecke_m"] += float(b.get("strecke_m") or 0.0)
    for x in z.values():
        x["tempo_kmh"] = round(x["strecke_m"] / x["dauer_s"] * 3.6, 2) if x["dauer_s"] > 0 and x["strecke_m"] else None
        x["dauer_s"] = round(x["dauer_s"], 1)
        x["strecke_m"] = round(x["strecke_m"], 1)
    return z
