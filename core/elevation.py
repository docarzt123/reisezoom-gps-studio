"""Höhendaten aus einem Geländemodell (DEM) ergänzen oder ersetzen.

Warum: Viele Tracks haben gar keine Höhe (Handy ohne Barometer, gezeichnete
Strecken) oder eine sehr verrauschte — dann sind Auf-/Abstieg unbrauchbar. Diese
Funktion holt die Höhe pro Ort aus einem Geländemodell, das die Landschaft
beschreibt statt sie zu messen: rauschfrei, aber eben Gelände (Brücken und
Tunnel liegen darin auf Bodenhöhe).

App-first (Marc-Regel): Logik hier in `core/`, damit Desktop-App und
`reisezoom.com/gps` dasselbe rechnen.

**Stützstellen statt jeder Punkt.** Ein DEM löst 25–90 m auf; jeden GPS-Punkt
einzeln abzufragen wäre reine Verschwendung und würde jedes Kontingent sprengen.
Wir fragen daher nur alle `step_m` Meter einen Wert ab und interpolieren dazwischen
linear. Bei einer 20-km-Tour sind das rund 200 Abfragen statt 5000 — bei praktisch
gleichem Profil.

Datenquelle ist OpenTopoData (offener Dienst):
  * `eudem25m`  — Europa, 25 m Raster, deutlich feiner
  * `srtm90m`   — weltweit, 90 m Raster
Beides ohne Schlüssel. Der Dienst begrenzt auf 100 Orte je Anfrage und etwa eine
Anfrage pro Sekunde — beides ist hier eingebaut. Wer die Grenzen nicht mag, setzt
`base_url` auf eine eigene Instanz (das Projekt lässt sich selbst hosten).

**Wichtig für den Datenschutz:** Beim Aufruf gehen Koordinaten an diesen externen
Dienst. Das ist eine bewusste Entscheidung des Nutzers und muss in der Oberfläche
so dastehen — nicht heimlich im Hintergrund passieren.
"""
from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request
from typing import List, Optional

from . import net
from .gpxsimplify import haversine_m

__all__ = ["fill_elevation", "lookup_elevations", "DATASETS"]

DATASETS = {
    "eudem25m": {"label": "Europa (25 m)", "res_m": 25},
    "srtm90m": {"label": "Weltweit (90 m)", "res_m": 90},
}
_BASE = "https://api.opentopodata.org/v1"
_BATCH = 100          # Orte je Anfrage (Grenze des Dienstes)
_PAUSE_S = 1.05       # Pause zwischen Anfragen (Grenze: ~1/s)
_MAX_ANCHORS = 600    # Deckel, damit eine Riesentour nicht ewig läuft


def lookup_elevations(coords: List[tuple], dataset: str = "eudem25m",
                      base_url: str = _BASE, timeout: float = 25.0) -> List[Optional[float]]:
    """Höhen für eine Liste von (lat, lon) holen. Fehlwerte kommen als None."""
    out: List[Optional[float]] = []
    for start in range(0, len(coords), _BATCH):
        chunk = coords[start:start + _BATCH]
        locs = "|".join(f"{lat:.6f},{lon:.6f}" for lat, lon in chunk)
        url = f"{base_url}/{dataset}?" + urllib.parse.urlencode({"locations": locs})
        req = urllib.request.Request(url, headers={"User-Agent": "reisezoom-gps-studio"})
        # TLS-Kontext siehe core/net.py — ohne ihn scheitert der Aufruf im
        # gebauten Programm an fehlenden Zertifikaten.
        with urllib.request.urlopen(req, timeout=timeout, context=net.ssl_context()) as r:
            data = json.loads(r.read().decode("utf-8"))
        if str(data.get("status", "")).upper() != "OK":
            raise RuntimeError(data.get("error") or "DEM-Dienst meldet einen Fehler")
        for res in data.get("results", []):
            e = res.get("elevation")
            out.append(None if e is None else float(e))
        if start + _BATCH < len(coords):
            time.sleep(_PAUSE_S)
    return out


def fill_elevation(points: List[dict], dataset: str = "eudem25m",
                   mode: str = "missing", step_m: float = 90.0,
                   base_url: str = _BASE) -> dict:
    """Höhen aus dem Geländemodell in die Punkte schreiben.

    mode:
      * `missing`  — nur Punkte ohne Höhe füllen, vorhandene Messwerte bleiben
      * `replace`  — alle Höhen durch Geländewerte ersetzen (gegen Rauschen)

    Rückgabe enthält neben den Punkten, wie viele Werte gesetzt wurden und wie
    sich Auf-/Abstieg dadurch ändern — damit im UI sichtbar wird, was die
    Aktion bewirkt hat, statt nur „fertig" zu melden.
    """
    n = len(points)
    if n < 2:
        return {"ok": False, "error": "zu wenige Punkte"}
    if dataset not in DATASETS:
        return {"ok": False, "error": f"unbekannter Datensatz: {dataset}"}

    step_m = max(20.0, float(step_m or 90.0))

    # 1) Stützstellen wählen: erster, letzter und alle step_m dazwischen
    anchors = [0]
    run = 0.0
    for k in range(1, n):
        run += haversine_m(points[k - 1]["lat"], points[k - 1]["lon"],
                           points[k]["lat"], points[k]["lon"])
        if run >= step_m:
            anchors.append(k)
            run = 0.0
    if anchors[-1] != n - 1:
        anchors.append(n - 1)

    # Deckel: gleichmäßig ausdünnen statt hinten abzuschneiden
    if len(anchors) > _MAX_ANCHORS:
        keep = {0, n - 1}
        stride = len(anchors) / float(_MAX_ANCHORS)
        keep.update(anchors[int(i * stride)] for i in range(_MAX_ANCHORS))
        anchors = sorted(keep)

    # 2) abfragen
    try:
        vals = lookup_elevations([(points[k]["lat"], points[k]["lon"]) for k in anchors],
                                 dataset=dataset, base_url=base_url)
    except Exception as e:                                   # Netz/Dienst weg
        return {"ok": False, "error": f"DEM nicht erreichbar: {e}",
                "hint": "Später erneut versuchen — der offene Dienst hat ein Tageslimit."}

    known = [(k, v) for k, v in zip(anchors, vals) if v is not None]
    if len(known) < 2:
        return {"ok": False, "error": "Der Datensatz liefert für diese Gegend keine Werte",
                "hint": "Bei Tracks außerhalb Europas den weltweiten Datensatz wählen."}

    # 3) zwischen den Stützstellen linear interpolieren
    dem: List[Optional[float]] = [None] * n
    for (k0, v0), (k1, v1) in zip(known, known[1:]):
        dem[k0] = v0
        dem[k1] = v1
        if k1 > k0 + 1:
            span = float(k1 - k0)
            for k in range(k0 + 1, k1):
                dem[k] = v0 + (v1 - v0) * ((k - k0) / span)
    for k in range(known[0][0]):            # vor der ersten Stützstelle
        dem[k] = known[0][1]
    for k in range(known[-1][0] + 1, n):    # nach der letzten
        dem[k] = known[-1][1]

    # 4) einsetzen
    def gain_loss(seq):
        up = dn = 0.0
        last = None
        for e in seq:
            if e is None:
                continue
            if last is None:
                last = e
                continue
            d = e - last
            if abs(d) >= 3.0:               # 3-m-Schwelle wie überall im Projekt
                if d > 0:
                    up += d
                else:
                    dn += -d
                last = e
        return round(up), round(dn)

    before = gain_loss([p.get("ele") for p in points])
    out = []
    filled = 0
    for k, p in enumerate(points):
        q = dict(p)
        if dem[k] is not None and (mode == "replace" or q.get("ele") is None):
            q["ele"] = round(float(dem[k]), 1)
            filled += 1
        out.append(q)
    after = gain_loss([p.get("ele") for p in out])

    return {
        "ok": True, "points": out, "count": n,
        "filled": filled, "anchors": len(anchors), "queried": len(anchors),
        "dataset": dataset, "dataset_label": DATASETS[dataset]["label"],
        "step_m": step_m,
        "ascent_before_m": before[0], "descent_before_m": before[1],
        "ascent_m": after[0], "descent_m": after[1],
    }
