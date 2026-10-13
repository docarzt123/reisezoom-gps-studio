"""Tour aus Fotos — aus den Orten und Aufnahmezeiten verorteter Fotos einen Track bauen (12.10.2026, Ausbau).

Die Grundform (0.9.787) verband die Fotos nacheinander und verteilte die Zeit gleichmäßig über die ganze Strecke.
Bei einer echten Reise ging das schief: Die Wegeführung bekam nur 24 Stützpunkte (Fotos dazwischen lagen neben der
Linie), Mittagspausen und Nächte wurden verschmiert, mehrere Tage waren ein Track, und ein Foto mit falschem GPS-Punkt
riss einen Zacken quer übers Land. Hier:

  · Ausreißer: ein Foto, das nur mit unmöglichem Tempo hin und wieder zurück erreichbar wäre, fällt heraus.
  · Je Tag (lokaler Aufnahmetag) ein Abschnitt — die App liest ihn als eigene Etappe; über die Nacht wird nicht
    gerechnet und keine Linie gezogen.
  · Wegeführung in Stücken zu höchstens MAX_WP Fotos (Fotos am selben Fleck zählen als einer), jedes Foto liegt auf
    der Linie.
  · Zeit je Abschnitt zwischen zwei Fotos: unterwegs mit typischem Tempo, die übrige Zeit steht der Punkt beim
    früheren Foto — dort, wo fotografiert wurde (die Fotostopps der App zeigen dann das Foto im Stand).

Ohne Netz und Höhen: `route_fn` ist eine Funktion (Punkte [(lon, lat)] → {"coords": [[lon, lat], …]}), die Höhen
füllt der Aufrufer (app.py, Geländekacheln).
"""
from __future__ import annotations

import math
import time
from datetime import datetime, timezone
from statistics import median
from typing import Callable, Optional

TYPISCH_KMH = {"walking": 4.5, "cycling": 16.0, "driving": 50.0}
VMAX_KMH = {"gerade": 300.0}   # Ausreißer-Grenze (für alle Wegearten gleich)
NAH_M = 25.0          # Fotos so nah beieinander zählen als ein Ort
MAX_WP = 20           # Stützpunkte je Anfrage an den Wegedienst
PAUSE_ZWISCHEN_S = 0.35


def abstand_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def _d(a: dict, b: dict) -> float:
    return abstand_m(a["lat"], a["lon"], b["lat"], b["lon"])


def _tempo(a: dict, b: dict) -> float:
    """m/s von a nach b; gleiche Sekunde zählt als 1 s."""
    return _d(a, b) / max(1.0, abs(float(b["t"]) - float(a["t"])))


def ausreisser(punkte: list, profil: str) -> tuple:
    """(gute, weggelassene) — `punkte` nach Zeit sortiert, je {lat, lon, t, …}. Ein Foto fliegt raus, wenn es nur mit
    mehr als VMAX erreichbar wäre UND der Umweg über es deutlich länger ist als der direkte Weg zwischen seinen Nachbarn
    (ein echter weiter Sprung — Flug, Fähre — hat keinen Rückweg und bleibt). Am Anfang/Ende: Sprung über 2 km mit
    unmöglichem Tempo zum einzigen Nachbarn. Die Grenze hängt NICHT an der gewählten Wegeart (Klicktest 12.10.: mit
    „zu Fuß“ flog ein echtes Foto einer Autofahrt raus) — ein falscher GPS-Punkt verrät sich durch einen absurden
    Sprung, nicht durch Autotempo."""
    vmax = VMAX_KMH["gerade"] / 3.6
    gut = list(punkte)
    raus: list = []
    for _ in range(len(punkte)):
        schlimmst, wert = None, 0.0
        n = len(gut)
        if n < 3:
            break
        for i in range(n):
            p = gut[i]
            if 0 < i < n - 1:
                a, b = gut[i - 1], gut[i + 1]
                umweg = _d(a, p) + _d(p, b) - _d(a, b)
                if umweg > 1000.0 and umweg > 2.0 * _d(a, b) and max(_tempo(a, p), _tempo(p, b)) > vmax:
                    if umweg > wert:
                        schlimmst, wert = i, umweg
            else:
                q = gut[1] if i == 0 else gut[n - 2]
                weiter = gut[2] if i == 0 else gut[n - 3]
                d = _d(p, q)
                # nur wenn der Nachbar zu seinem eigenen Nachbarn passt (sonst wäre der Nachbar der Ausreißer)
                if d > 2000.0 and _tempo(p, q) > vmax and _tempo(q, weiter) <= vmax and d > wert:
                    schlimmst, wert = i, d
        if schlimmst is None:
            break
        raus.append(gut.pop(schlimmst))
    return gut, raus


def orte(punkte: list) -> list:
    """Aufeinanderfolgende Fotos am selben Fleck (≤ NAH_M zum ersten der Gruppe) zu einem Ort: {lat, lon, ele, t0, t1, n}."""
    out: list = []
    for p in punkte:
        if out and abstand_m(out[-1]["lat"], out[-1]["lon"], p["lat"], p["lon"]) <= NAH_M:
            o = out[-1]
            o["t1"] = float(p["t"]); o["n"] += 1
            if o.get("ele") is None and p.get("ele") is not None:
                o["ele"] = p.get("ele")
            continue
        out.append({"lat": float(p["lat"]), "lon": float(p["lon"]), "ele": p.get("ele"),
                    "t0": float(p["t"]), "t1": float(p["t"]), "n": 1})
    return out


def _wege(orte_: list, profil: str, route_fn: Optional[Callable]) -> tuple:
    """Geometrie je Abschnitt Ort j → j+1 als Liste [[lon, lat], …] (Anfang und Ende = die beiden Orte).
    Gibt (abschnitte, alle_mit_weg, keiner_mit_weg) zurück."""
    n = len(orte_)
    gerade = [[[o["lon"], o["lat"]], [q["lon"], q["lat"]]] for o, q in zip(orte_, orte_[1:])]
    if profil not in TYPISCH_KMH or route_fn is None or n < 2:
        return gerade, False, True
    abschnitte = list(gerade)
    mit_weg = [False] * (n - 1)
    start = 0
    erste = True
    while start < n - 1:
        ende = min(n - 1, start + MAX_WP - 1)
        stueck = orte_[start:ende + 1]
        if not erste:
            time.sleep(PAUSE_ZWISCHEN_S)   # freie Dienste: nicht im Dauerfeuer fragen
        erste = False
        try:
            r = route_fn([(o["lon"], o["lat"]) for o in stueck])
            coords = [[float(c[0]), float(c[1])] for c in (r or {}).get("coords") or []]
        except Exception:  # noqa: BLE001 — kein Weg: dieses Stück gerade
            coords = []
        if len(coords) >= 2:
            idx = _stellen(coords, stueck)
            for k in range(len(stueck) - 1):
                a, b = idx[k], idx[k + 1]
                teil = coords[a:b + 1] if b > a else []
                if len(teil) >= 2:
                    # Anfang und Ende genau auf die Fotos legen (der Dienst rückt sie auf die nächste Straße)
                    teil = [[stueck[k]["lon"], stueck[k]["lat"]]] + teil[1:-1] + [[stueck[k + 1]["lon"], stueck[k + 1]["lat"]]]
                    abschnitte[start + k] = teil
                    mit_weg[start + k] = True
        start = ende
    return abschnitte, all(mit_weg), not any(mit_weg)


def _stellen(coords: list, stueck: list) -> list:
    """Index in `coords` für jedes Foto des Stücks — vorwärts gesucht, damit eine Strecke, die später noch einmal am
    selben Ort vorbeikommt, nicht vorgreift: gesucht wird nur bis zum Dreifachen des Luftlinien-Abstands (+ 2 km)."""
    idx = [0]
    pos = 0
    for k in range(1, len(stueck)):
        o = stueck[k]
        luft = abstand_m(stueck[k - 1]["lat"], stueck[k - 1]["lon"], o["lat"], o["lon"])
        grenze = 3.0 * luft + 2000.0
        best, best_d, weg = pos, float("inf"), 0.0
        for i in range(pos, len(coords)):
            if i > pos:
                weg += abstand_m(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0])
                if weg > grenze:
                    break
            d = abstand_m(coords[i][1], coords[i][0], o["lat"], o["lon"])
            if d < best_d:
                best, best_d = i, d
        if k == len(stueck) - 1:
            best = len(coords) - 1   # das letzte Foto ist das Ende der Route
        pos = max(pos, best)
        idx.append(pos)
    return idx


def _laenge(teil: list) -> float:
    return sum(abstand_m(a[1], a[0], b[1], b[0]) for a, b in zip(teil, teil[1:]))


def tag_spur(punkte: list, profil: str, route_fn: Optional[Callable], seg: int = 0) -> dict:
    """Ein Tag: Punkte [{lat, lon, ele, time, seg}] mit Zeiten, die zu den Fotos passen."""
    o = orte(punkte)
    if len(o) == 1:
        p = [{"lat": o[0]["lat"], "lon": o[0]["lon"], "ele": o[0]["ele"], "t": o[0]["t0"], "seg": seg}]
        if o[0]["t1"] > o[0]["t0"]:
            p.append(dict(p[0], t=o[0]["t1"]))
        return {"punkte": p, "km": 0.0, "mit_weg": False, "ohne_weg": True}
    abschnitte, alle, keiner = _wege(o, profil, route_fn)
    laengen = [_laenge(t) for t in abschnitte]
    if profil in TYPISCH_KMH:
        v = TYPISCH_KMH[profil] / 3.6
    else:   # gerade Linien: das übliche Tempo dieser Fotos (Mittel der Abschnitte), nicht unter 3 km/h
        vs = [l_ / (q["t0"] - p["t1"]) for l_, p, q in zip(laengen, o, o[1:]) if q["t0"] - p["t1"] > 0 and l_ > 0]
        v = max(3.0 / 3.6, median(vs)) if vs else 5.0 / 3.6
    out: list = []

    def dazu(lon, lat, t, ele=None):
        if out and t < out[-1]["t"]:
            t = out[-1]["t"]
        out.append({"lat": lat, "lon": lon, "ele": ele, "t": t, "seg": seg})

    for j, teil in enumerate(abschnitte):
        a, b = o[j], o[j + 1]
        if j == 0:
            dazu(a["lon"], a["lat"], a["t0"], a["ele"])
        if a["t1"] > a["t0"]:
            dazu(a["lon"], a["lat"], a["t1"], a["ele"])
        luecke = max(0.0, b["t0"] - a["t1"])
        fahrt = laengen[j] / v if v > 0 else luecke
        los = a["t1"] + max(0.0, luecke - fahrt)   # Rest der Zeit: Stand beim Foto
        if los > a["t1"] + 1:
            dazu(a["lon"], a["lat"], los, a["ele"])
        gesamt = laengen[j] or 1.0
        weg = 0.0
        for i in range(1, len(teil)):
            weg += abstand_m(teil[i - 1][1], teil[i - 1][0], teil[i][1], teil[i][0])
            t = los + (b["t0"] - los) * (weg / gesamt)
            ele = b["ele"] if i == len(teil) - 1 else None
            dazu(teil[i][0], teil[i][1], t, ele)
    letzter = o[-1]
    if letzter["t1"] > letzter["t0"]:
        dazu(letzter["lon"], letzter["lat"], letzter["t1"], letzter["ele"])
    return {"punkte": out, "km": sum(laengen) / 1000.0, "mit_weg": alle, "ohne_weg": keiner}


def spur_aus_fotos(fotos: list, profil: str = "gerade", route_fn: Optional[Callable] = None) -> dict:
    """`fotos` = [{lat, lon, ele?, aufnahme_utc, tag_lokal?, path?}] (Reihenfolge egal). Ergebnis:
    {punkte: [{lat, lon, ele, time, seg}], tage: [{tag, n, km}], ausreisser: [path], n_fotos, wege, wege_teilweise}."""
    p = [{"lat": float(f["lat"]), "lon": float(f["lon"]), "ele": f.get("ele"), "t": float(f["aufnahme_utc"]),
          "tag": f.get("tag_lokal") or datetime.fromtimestamp(float(f["aufnahme_utc"]), timezone.utc).strftime("%Y-%m-%d"),
          "path": f.get("path")}
         for f in fotos if f.get("lat") is not None and f.get("lon") is not None and f.get("aufnahme_utc") is not None]
    p.sort(key=lambda x: x["t"])
    gut, raus = ausreisser(p, profil)
    tage: list = []
    for x in gut:
        if not tage or tage[-1][0] != x["tag"]:
            tage.append((x["tag"], []))
        tage[-1][1].append(x)
    punkte: list = []
    info: list = []
    alle_weg, irgendein_weg = True, False
    for nr, (tag, liste) in enumerate(tage):
        r = tag_spur(liste, profil, route_fn, seg=nr)
        punkte.extend(r["punkte"])
        info.append({"tag": tag, "n": len(liste), "km": round(r["km"], 1)})
        if len(orte(liste)) > 1:
            alle_weg = alle_weg and r["mit_weg"]
            irgendein_weg = irgendein_weg or not r["ohne_weg"]
    for q in punkte:
        q["time"] = datetime.fromtimestamp(q.pop("t"), timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {"punkte": punkte, "tage": info, "ausreisser": [x.get("path") for x in raus], "n_fotos": len(gut),
            "wege": irgendein_weg and alle_weg, "wege_teilweise": irgendein_weg and not alle_weg}
