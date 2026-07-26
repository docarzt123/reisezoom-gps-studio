"""Track ausdünnen + Ausreißer entfernen — reine Geometrie/Statistik, keine IO.

App-first (Marc-Regel): die Logik lebt hier in `core/`, damit Desktop-App **und**
`gps-studio.reisezoom.com` (via `api/tools.py`) exakt dasselbe rechnen.

Beide Funktionen arbeiten auf den Punkt-Dicts, die `gpxedit.load_points()` liefert
({i, lat, lon, ele, time, …}) und geben Punkte **derselben Struktur** zurück —
Zusatzfelder (Sensorik, `si`/`oi`) bleiben unangetastet, es wird nur ausgewählt,
nie umgeschrieben.
"""
from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import List, Optional

__all__ = ["simplify_points", "clean_outliers", "haversine_m"]


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Entfernung zweier Punkte in Metern (Kugelmodell)."""
    r = 6371000.0
    p = math.pi / 180.0
    dlat = (lat2 - lat1) * p
    dlon = (lon2 - lon1) * p
    a = (math.sin(dlat / 2) ** 2
         + math.cos(lat1 * p) * math.cos(lat2 * p) * math.sin(dlon / 2) ** 2)
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def _perp_dist_m(p, a, b) -> float:
    """Abstand von `p` zur Strecke a→b in Metern.

    Lokale Näherung: Grad → Meter über den Breitengrad (cos-Korrektur für lon).
    Auf Track-Längen völlig ausreichend und ohne Projektions-Abhängigkeit.
    """
    lat0 = math.radians((a["lat"] + b["lat"]) / 2.0)
    mx = 111320.0 * math.cos(lat0)   # m pro ° Länge
    my = 110540.0                    # m pro ° Breite
    px, py = p["lon"] * mx, p["lat"] * my
    ax, ay = a["lon"] * mx, a["lat"] * my
    bx, by = b["lon"] * mx, b["lat"] * my
    dx, dy = bx - ax, by - ay
    seg2 = dx * dx + dy * dy
    if seg2 <= 0:
        return math.hypot(px - ax, py - ay)
    t = ((px - ax) * dx + (py - ay) * dy) / seg2
    t = 0.0 if t < 0 else (1.0 if t > 1 else t)
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def simplify_points(points: List[dict], tol_m: float = 5.0) -> dict:
    """Douglas-Peucker: Punkte ausdünnen, ohne die Linienform zu verlieren.

    `tol_m` = maximaler erlaubter Abstand eines entfernten Punktes zur
    verbleibenden Linie (Meter). Start- und Endpunkt bleiben IMMER erhalten.

    Returns {ok, points, removed, kept, tol_m}.
    """
    try:
        tol = float(tol_m)
    except (TypeError, ValueError):
        tol = 5.0
    tol = max(0.0, min(1000.0, tol))
    n = len(points or [])
    if n < 3 or tol <= 0:
        return {"ok": True, "points": list(points or []), "removed": 0,
                "kept": n, "tol_m": tol}

    keep = [False] * n
    keep[0] = keep[n - 1] = True
    # Iterativ (kein Rekursions-Limit bei sehr langen Tracks).
    stack = [(0, n - 1)]
    while stack:
        i0, i1 = stack.pop()
        if i1 <= i0 + 1:
            continue
        a, b = points[i0], points[i1]
        worst, worst_i = -1.0, -1
        for k in range(i0 + 1, i1):
            d = _perp_dist_m(points[k], a, b)
            if d > worst:
                worst, worst_i = d, k
        if worst > tol and worst_i > 0:
            keep[worst_i] = True
            stack.append((i0, worst_i))
            stack.append((worst_i, i1))

    out = [p for p, k in zip(points, keep) if k]
    return {"ok": True, "points": out, "removed": n - len(out),
            "kept": len(out), "tol_m": tol}


def _parse_iso(s) -> Optional[datetime]:
    if not s:
        return None
    if isinstance(s, datetime):
        return s if s.tzinfo else s.replace(tzinfo=timezone.utc)
    txt = str(s).strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(txt)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def clean_outliers(points: List[dict], max_speed_kmh: float = 250.0) -> dict:
    """GPS-Ausreißer entfernen — Punkte, die nur per „Sprung" erreichbar wären.

    Ein Punkt fliegt raus, wenn die Geschwindigkeit vom letzten *behaltenen*
    Punkt dorthin `max_speed_kmh` übersteigt (klassischer GPS-Verschlucker:
    ein Sample landet kilometerweit weg und kommt danach zurück).

    Ohne Zeitstempel ist Geschwindigkeit nicht bestimmbar — dann greift ein
    reiner Distanz-Notnagel (Sprung > 5 km zwischen Nachbarpunkten).
    Start- und Endpunkt bleiben erhalten.

    Returns {ok, points, removed, kept, max_speed_kmh, mode}.
    """
    try:
        vmax = float(max_speed_kmh)
    except (TypeError, ValueError):
        vmax = 250.0
    vmax = max(1.0, min(2000.0, vmax))
    n = len(points or [])
    if n < 3:
        return {"ok": True, "points": list(points or []), "removed": 0,
                "kept": n, "max_speed_kmh": vmax, "mode": "none"}

    times = [_parse_iso(p.get("time")) for p in points]
    has_time = sum(1 for t in times if t) >= max(2, int(n * 0.5))
    mode = "speed" if has_time else "distance"

    out = [points[0]]
    last_i = 0
    removed = 0
    for i in range(1, n):
        p, q = points[last_i], points[i]
        d = haversine_m(float(p["lat"]), float(p["lon"]),
                        float(q["lat"]), float(q["lon"]))
        drop = False
        if mode == "speed" and times[last_i] and times[i]:
            dt = (times[i] - times[last_i]).total_seconds()
            if dt > 0:
                if (d / dt) * 3.6 > vmax:
                    drop = True
            elif d > 5000.0:
                drop = True          # gleiche Zeit, aber km entfernt
        elif d > 5000.0:
            drop = True
        # Der letzte Punkt bleibt immer stehen (sonst endet der Track im Nichts).
        if drop and i < n - 1:
            removed += 1
            continue
        out.append(q)
        last_i = i

    return {"ok": True, "points": out, "removed": removed, "kept": len(out),
            "max_speed_kmh": vmax, "mode": mode}
