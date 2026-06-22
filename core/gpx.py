"""
GPX-Parsing + Stats. Wrapper um gpxpy mit ergonomischen Helfern für UI/Renderer.
"""
from __future__ import annotations

import bisect
import statistics
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from math import radians, sin, cos, sqrt, atan2
from typing import List, Optional

import gpxpy
import gpxpy.gpx


@dataclass
class TrackPoint:
    lat: float
    lon: float
    ele: Optional[float]
    time: Optional[str]  # ISO-8601 UTC, None wenn nicht im GPX
    # kumulative Felder, von compute_cumulative() befüllt
    dist_m: float = 0.0      # kumulierte Distanz in Metern bis hier
    elapsed_s: float = 0.0   # kumulierte Zeit in Sekunden seit Track-Start


@dataclass
class TrackStats:
    n_points: int
    distance_m: float          # Gesamtstrecke in Metern
    duration_s: float          # Gesamtzeit in Sekunden (0 falls keine Timestamps)
    ascent_m: float            # Höhenmeter bergauf
    descent_m: float           # Höhenmeter bergab
    ele_min: Optional[float]   # minimale Höhe
    ele_max: Optional[float]   # maximale Höhe
    bbox: dict                 # {min_lat, max_lat, min_lon, max_lon}
    name: Optional[str]        # GPX-Track-Name
    moving_time_s: float = 0.0   # Bewegungs-/Netto-Zeit in Sekunden (Pausen abgezogen)
    max_speed_kmh: float = 0.0   # Spitzentempo in km/h (Spike-gekappt)


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Großkreis-Distanz in Metern."""
    R = 6371000.0
    p1, p2 = radians(lat1), radians(lat2)
    dp = radians(lat2 - lat1)
    dl = radians(lon2 - lon1)
    a = sin(dp / 2) ** 2 + cos(p1) * cos(p2) * sin(dl / 2) ** 2
    return 2 * R * atan2(sqrt(a), sqrt(1 - a))


def _compute_ascent_descent(eles, smooth_window: int = 5, threshold_m: float = 3.0):
    """Bergauf/Bergab in Metern aus einer Liste von Höhenwerten.

    Naive Methode (jeder positive dz wird summiert) überzählt bei GPS-Tracks
    massiv, weil GPS-Höhe pro Sample ±5–10 m rauscht. Dieser Algorithmus
    nutzt zwei Techniken:

    1. **Moving-Average-Smoothing** (Fenster `smooth_window`) glättet
       kurzes Rauschen weg.
    2. **Hysterese-Referenzpunkt**: wir merken den letzten „bestätigten"
       Höhen-Bezugspunkt. Erst wenn die aktuelle Höhe um mindestens
       `threshold_m` davon abweicht, übernehmen wir die Differenz und
       setzen den Referenzpunkt neu. Damit werden Mini-Auf-und-Abs durch
       Rauschen herausgefiltert — eine echte Steigung wird aber sauber
       summiert weil sie kontinuierlich über das Threshold hinausgeht.

    None-Werte in `eles` (= Punkte ohne Höhe) werden mit dem letzten
    gültigen Wert vor-/zurück-gefüllt.

    Liefert `(ascent_m, descent_m)`.
    """
    if not eles:
        return 0.0, 0.0
    # None auf nächsten gültigen Wert mappen
    last_valid = None
    clean = []
    for e in eles:
        if e is not None:
            last_valid = float(e)
        clean.append(last_valid if last_valid is not None else 0.0)
    if all(c == 0.0 for c in clean):
        return 0.0, 0.0
    # Moving-Average
    win = max(1, int(smooth_window))
    if win > 1 and len(clean) >= win:
        half = win // 2
        smoothed = []
        for i in range(len(clean)):
            lo = max(0, i - half)
            hi = min(len(clean), i + half + 1)
            window = clean[lo:hi]
            smoothed.append(sum(window) / len(window))
    else:
        smoothed = clean[:]
    # Hysterese-Referenzpunkt: erst wenn current vom letzten Bezugspunkt
    # um >= threshold abweicht, wird die Differenz übernommen.
    ascent = 0.0
    descent = 0.0
    th = float(threshold_m)
    ref = smoothed[0]
    for cur in smoothed[1:]:
        dz = cur - ref
        if dz >= th:
            ascent += dz
            ref = cur
        elif dz <= -th:
            descent += -dz
            ref = cur
        # sonst: cur ist „im Rauschband" um ref → nichts machen,
        # ref bleibt stehen. Wenn die Bewegung weitergeht, übersteigt
        # cur irgendwann zwingend das Threshold + wird übernommen.
    return ascent, descent


def compute_moving_and_max(pts: List[TrackPoint]) -> tuple[float, float]:
    """Bewegungszeit (s) + Spitzentempo (km/h) aus Trackpunkten.

    WICHTIG: immer auf der **vollen Auflösung** rechnen, NIE auf den fürs
    Rendering heruntergerechneten Punkten — Downsampling glättet den Peak weg
    (Nutzer-Feedback: gemessene 43 km/h wurden zu niedrig angezeigt).

    - **Spitzentempo**: **Median-Filter** (Fenster 5) über die Segment-
      Geschwindigkeiten, dann das Maximum. Der Median ist **skalenfrei** — er
      vergleicht jeden Punkt mit seinen Nachbarn, NICHT mit einer festen km/h-
      Grenze. Damit funktioniert er identisch für Wandern (5 km/h), Radfahren
      (40+), Auto/Zug/Flug (200+): isolierte GPS-Ausreißer/Teleports (1–2
      verrutschte Punkte) fallen raus, echtes ANHALTENDES Tempo (ein Sprint über
      mehrere Sekunden = viele Nachbarpunkte) bleibt voll erhalten. KEIN
      absoluter Cap mehr — der würde schnelle Tracks fälschlich abschneiden.
      (Nutzer-Feedback: Wanderung zeigte 7,4 km/h obwohl nie >7 — GPS-Sprung.)
    - **Bewegungszeit**: 60-Sekunden-Gleitfenster. Ein Segment zählt als
      Bewegung, wenn die *Netto-Verschiebung* (Luftlinie Fenster-Anfang→Ende)
      pro Zeit ≥ 0,6 km/h liegt. Damit gilt langsames Bergauf-Gehen (1 km/h
      echte Bewegung) NICHT als Pause, echtes Stehenbleiben dagegen schon.
    """
    n = len(pts)
    if n < 2:
        return 0.0, 0.0
    has_time = bool(pts[-1].elapsed_s) and any(p.time for p in pts)
    if not has_time:
        return 0.0, 0.0
    cum_time = [p.elapsed_s for p in pts]
    cum_dist = [p.dist_m for p in pts]

    # --- Spitzentempo: Median-Filter (Fenster 5), KEIN absoluter km/h-Cap ---
    # Der Median ist skalenfrei: ein einzelner GPS-Sprung wird von seinen 4
    # Nachbarn überstimmt (egal ob bei 5 oder 500 km/h), echtes anhaltendes
    # Tempo (≥3 Nachbarpunkte einig) bleibt. Ein fester Cap würde nur schnelle
    # Tracks (Auto/Zug/Flug) fälschlich beschneiden.
    seg = []  # Segment-Geschwindigkeiten in m/s
    for i in range(1, n):
        dt = cum_time[i] - cum_time[i - 1]
        seg.append((cum_dist[i] - cum_dist[i - 1]) / dt if dt > 0 else 0.0)
    HW_MED = 2  # ±2 → Fenster 5; killt isolierte Einzel-/Doppel-Ausreißer
    max_ms = 0.0
    for i in range(len(seg)):
        lo = max(0, i - HW_MED)
        hi = min(len(seg), i + HW_MED + 1)
        m = statistics.median(seg[lo:hi])
        if m > max_ms:
            max_ms = m

    # --- Bewegungszeit: 60s-Gleitfenster, Netto-Verschiebung ---
    HW = 60.0
    FLOOR_MS = 0.6 / 3.6
    moving_s = 0.0
    for i in range(1, n):
        dt_seg = cum_time[i] - cum_time[i - 1]
        if dt_seg <= 0:
            continue
        mid = 0.5 * (cum_time[i] + cum_time[i - 1])
        aa = max(0, min(bisect.bisect_left(cum_time, mid - HW), i - 1))
        bb = min(n - 1, max(bisect.bisect_right(cum_time, mid + HW) - 1, i))
        wdt = cum_time[bb] - cum_time[aa]
        if wdt <= 0:
            continue
        net = _haversine_m(pts[aa].lat, pts[aa].lon, pts[bb].lat, pts[bb].lon)
        if (net / wdt) >= FLOOR_MS:
            moving_s += dt_seg
    return moving_s, max_ms * 3.6


def parse_gpx(path: str) -> tuple[List[TrackPoint], TrackStats]:
    """Liest eine GPX-Datei, gibt Trackpunkte (mit kumulierten Werten) + Stats zurück."""
    with open(path, "r", encoding="utf-8") as fh:
        gpx = gpxpy.parse(fh)

    pts: List[TrackPoint] = []
    name = None
    for track in gpx.tracks:
        if not name and track.name:
            name = track.name
        for seg in track.segments:
            for p in seg.points:
                t_iso = None
                if p.time is not None:
                    t = p.time if p.time.tzinfo else p.time.replace(tzinfo=timezone.utc)
                    t_iso = t.astimezone(timezone.utc).isoformat()
                pts.append(
                    TrackPoint(
                        lat=p.latitude,
                        lon=p.longitude,
                        ele=p.elevation,
                        time=t_iso,
                    )
                )

    if not pts:
        raise ValueError("GPX enthält keine Trackpunkte")

    # Kumulierte Distanz/Zeit + Auf-/Abstieg
    eles_raw = [p.ele for p in pts if p.ele is not None]
    ele_min = min(eles_raw) if eles_raw else None
    ele_max = max(eles_raw) if eles_raw else None

    # Distanz + Zeit kumulieren
    t0 = None
    if pts[0].time:
        t0 = datetime.fromisoformat(pts[0].time)

    pts[0].dist_m = 0.0
    pts[0].elapsed_s = 0.0
    prev = pts[0]
    for cur in pts[1:]:
        d = _haversine_m(prev.lat, prev.lon, cur.lat, cur.lon)
        cur.dist_m = prev.dist_m + d
        if cur.time and t0:
            cur.elapsed_s = (datetime.fromisoformat(cur.time) - t0).total_seconds()
        else:
            cur.elapsed_s = prev.elapsed_s
        prev = cur

    # Auf-/Abstieg via geglätteter Höhe + Akkumulator-Threshold (Strava-Stil).
    # GPS-Höhe rauscht typisch ±5–10 m pro Sample → naive Summierung der dz-
    # Werte überzählt massiv. Stattdessen:
    #   1) Moving-Average über 5 Punkte glättet kurzes Rauschen
    #   2) Akkumulator akkumuliert Höhenänderung bis zu einem 3-m-Plateau-
    #      Wechsel — erst dann wird die akkumulierte Differenz übernommen.
    # Liefert Werte die deutlich besser zu Strava/Komoot passen.
    # Marc-Spec 2026-05-24: „Bergauf/bergab in den gesamtstats stimmt nicht".
    ascent, descent = _compute_ascent_descent(
        [p.ele for p in pts],
        smooth_window=5,
        threshold_m=3.0,
    )

    # Bewegungszeit + Spitzentempo auf voller Auflösung (siehe Helper-Docstring).
    moving_time_s, max_speed_kmh = compute_moving_and_max(pts)

    stats = TrackStats(
        n_points=len(pts),
        distance_m=pts[-1].dist_m,
        duration_s=pts[-1].elapsed_s,
        ascent_m=ascent,
        descent_m=descent,
        ele_min=ele_min,
        ele_max=ele_max,
        moving_time_s=moving_time_s,
        max_speed_kmh=max_speed_kmh,
        bbox={
            "min_lat": min(p.lat for p in pts),
            "max_lat": max(p.lat for p in pts),
            "min_lon": min(p.lon for p in pts),
            "max_lon": max(p.lon for p in pts),
        },
        name=name,
    )
    return pts, stats


def downsample(pts: List[TrackPoint], target: int = 500) -> List[TrackPoint]:
    """Reduziert Punkte auf ca. target Stück, gleichmäßig verteilt. Behält erste/letzte."""
    if len(pts) <= target:
        return pts
    step = (len(pts) - 1) / (target - 1)
    idx = [round(i * step) for i in range(target)]
    return [pts[i] for i in idx]


def to_json(pts: List[TrackPoint], stats: TrackStats) -> dict:
    """Serialisierbar fürs UI."""
    return {
        "points": [asdict(p) for p in pts],
        "stats": asdict(stats),
    }
