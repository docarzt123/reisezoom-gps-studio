"""
GPX-Parsing + Stats. Wrapper um gpxpy mit ergonomischen Helfern für UI/Renderer.
"""
from __future__ import annotations

import bisect
import json
import os
import statistics
from dataclasses import dataclass, asdict, field
from datetime import datetime, timezone
from math import radians, sin, cos, sqrt, atan2
from typing import List, Optional

import gpxpy
import gpxpy.gpx

from . import sensors as _sensors


@dataclass
class TrackPoint:
    lat: float
    lon: float
    ele: Optional[float]
    time: Optional[str]  # ISO-8601 UTC, None wenn nicht im GPX
    # v0.9.483 — Etappen-Nummer. Eine GPX kann mehrere <trkseg>/<trk> enthalten: sechs an
    # verschiedenen Tagen gelaufene Etappen sind EIN File. Über eine Segmentgrenze darf
    # NICHT gerechnet werden — die Luftlinie zwischen Etappenende und nächstem Start ist
    # keine gelaufene Strecke, und die Nacht dazwischen keine Gehzeit.
    seg: int = 0
    # kumulative Felder, von compute_cumulative() befüllt
    dist_m: float = 0.0      # kumulierte Distanz in Metern bis hier
    elapsed_s: float = 0.0   # kumulierte Zeit seit Track-Start; bei mehreren Etappen die
                             # SUMME der Etappen-Zeiten (Pausen dazwischen zählen nicht)
    # v0.9.330 — Sensor-Zusatzwerte pro Punkt (FIT-HR/Power/Temp/…, GPX-Extensions).
    # Geometrie/abgeleitete Werte (Distanz/Tempo/Steigung) gehören NICHT hier rein.
    extra: dict = field(default_factory=dict)


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
    # v0.9.330 — vorhandene Sensorfelder [{key,label,unit}] (FIT/GPX-Extensions).
    sensor_fields: list = field(default_factory=list)
    # v0.9.483 — Anzahl Etappen (<trkseg>/<trk>). 1 = normale Einzeltour.
    n_segments: int = 1
    # 23.08.2026 — Name je Etappe (Reihenfolge = Etappennummer). Bei
    # zusammengeführten Touren ist das der Tour-Name; Übergänge heißen "".
    seg_names: list = field(default_factory=list)
    # v0.9.501 — Tour-Ebene aus FIT (session/sport/device_info/weather), roh.
    # Leer bei GPX ohne Sidecar — kein Format außer FIT liefert so etwas.
    tour_meta: dict = field(default_factory=dict)


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


def _ext_localname(tag) -> str:
    return str(tag).rsplit("}", 1)[-1].lower()


def _read_point_extensions(gp) -> dict:
    """Liest Standard-Extensions eines gpxpy-Punkts → {key: float}.
    Namespace-agnostisch: durchsucht den Extension-Teilbaum nach bekannten
    lokalen Tag-Namen — gpxtpx/gpxpx (hr/cad/atemp/power, Strava/Garmin) UND
    den Reisezoom-Logger-Namespace rz: (hdg/pitch/lux/…, Android-App)."""
    out: dict = {}
    exts = getattr(gp, "extensions", None) or []
    for el in exts:
        try:
            nodes = [el] + list(el.iter())
        except Exception:
            nodes = [el]
        for n in nodes:
            ln = _ext_localname(getattr(n, "tag", ""))
            txt = (getattr(n, "text", None) or "").strip()
            if not txt:
                continue
            key = None
            if ln in _sensors.GPXTPX_READ:
                key = _sensors.GPXTPX_READ[ln]
            elif ln in _sensors.RZ_READ:
                # Reisezoom-Logger (Android): rz:hdg/pitch/lux/… → kanonische Keys
                key = _sensors.RZ_READ[ln]
            elif ln in ("power", "powerinwatts"):
                key = "power"
            if key is None:
                continue
            try:
                out[key] = float(txt)
            except ValueError:
                pass
    return out


def _sidecar_path(gpx_path: str) -> str:
    base = gpx_path[:-4] if gpx_path.lower().endswith(".gpx") else gpx_path
    return base + ".sensors.json"


def _load_sidecar_into(pts: List[TrackPoint], gpx_path: str) -> dict:
    """Lädt `<gpx>.sensors.json` (Variante B) und mergt index-gleich in extra.
    Fehlt die Datei (Track ohne Sensoren / alter Cache) → still no-op.

    Rückgabe: die Tour-Ebene aus der Sidecar (v0.9.501) oder `{}`.
    """
    sc = _sidecar_path(gpx_path)
    if not os.path.exists(sc):
        return {}
    try:
        with open(sc, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        values = data.get("values") or {}
        n = len(pts)
        for key, arr in values.items():
            if not isinstance(arr, list):
                continue
            for i in range(min(n, len(arr))):
                v = arr[i]
                if v is not None:
                    pts[i].extra[key] = v
        tour = data.get("tour")
        return tour if isinstance(tour, dict) else {}
    except Exception:
        return {}  # defekte Sidecar darf den Track-Load NICHT kippen


# 22.08.2026 — Fremdformate (FIT/TCX/KML/…) laufen durch dieselbe Tür. Die App
# setzt beim Start den Cache-Ordner; dann konvertiert `parse_gpx` selbst, statt
# dass jede der 17 Aufrufstellen in app.py an `_ensure_gpx` denken muss. Ein
# Beta-Tester-Log zeigte 412 UnicodeDecodeErrors aus `animator_pace_map`, weil
# dort der rohe .fit-Pfad ankam (Archiv mit 103.000 FIT-Dateien).
IMPORT_CACHE_DIR: Optional[str] = None


def _als_gpx(path: str) -> str:
    if not path or os.path.splitext(path)[1].lower() == ".gpx" or not IMPORT_CACHE_DIR:
        return path
    try:
        from . import imports as _imp
        if not _imp.is_convertible(path):
            return path
        return _imp.ensure_gpx(path, IMPORT_CACHE_DIR)
    except Exception:
        return path      # der eigentliche Parse-Fehler ist dann die bessere Meldung


# Etappenname, an dem eine Übergangs-Etappe erkannt wird (siehe core/merge.py).
UEBERGANG_NAME = "rz:uebergang"


def etappen_reihen(pts, seg_names=None) -> dict:
    """23.08.2026 (Marc: „Statistiken für die Teilstücke und für das Ganze") —
    Reihen je Punkt für die Etappen-Anzeige im Overlay:

      nr    – Etappennummer (1-basiert, NUR Touren; im Übergang die davor)
      d0/t0 – Strecke/Zeit am Anfang dieser Etappe → „in dieser Etappe" ist
              schlicht `cumDist[i] - d0[i]`
      name  – Etappenname je Punkt (aus den <trk>-Namen)
      gesamt – Anzahl der Tour-Etappen (ohne Übergänge)
    """
    n = len(pts)
    nr = [0] * n
    d0 = [0.0] * n
    t0 = [0.0] * n
    namen = [""] * n
    if not n:
        return {"nr": nr, "d0": d0, "t0": t0, "name": namen, "gesamt": 0}
    seg_names = list(seg_names or [])
    zaehler = 0
    letzte_seg = None
    akt_d0 = akt_t0 = 0.0
    akt_name = ""
    for i, p in enumerate(pts):
        ueberg = bool(p.extra.get("rz_uebergang"))
        if p.seg != letzte_seg:
            letzte_seg = p.seg
            if not ueberg:
                zaehler += 1
                akt_d0, akt_t0 = p.dist_m, p.elapsed_s
                akt_name = seg_names[p.seg] if p.seg < len(seg_names) else ""
        nr[i] = zaehler
        d0[i], t0[i] = akt_d0, akt_t0
        namen[i] = akt_name
    return {"nr": nr, "d0": d0, "t0": t0, "name": namen, "gesamt": zaehler}


def unsichtbare_bereiche(pts) -> list:
    """Punkt-Indexbereiche [i, j], deren Linie NICHT gezeichnet werden darf
    (23.08.2026): die Sprünge über Etappengrenzen und die unsichtbaren
    Übergänge aus dem Zusammenführen. Zusammenhängende Bereiche werden
    verschmolzen. Die Vorschau (`segMaskExpr`) und der Render (`__rzSegMask`)
    bekommen genau diese Liste — beide müssen dieselbe Antwort zeichnen."""
    roh = []
    for i in range(1, len(pts)):
        a, b = pts[i - 1], pts[i]
        versteckt = ((a.extra.get("rz_uebergang") and not a.extra.get("rz_uebergang_sichtbar"))
                     or (b.extra.get("rz_uebergang") and not b.extra.get("rz_uebergang_sichtbar")))
        if a.seg != b.seg or versteckt:
            roh.append([i - 1, i])
    if not roh:
        return []
    out = [roh[0]]
    for r in roh[1:]:
        if r[0] <= out[-1][1]:
            out[-1][1] = max(out[-1][1], r[1])
        else:
            out.append(r)
    return out


def laufpunkt_aus_bereiche(pts) -> list:
    """Wo der Laufpunkt nichts zu suchen hat: in den unsichtbaren Übergängen
    (dort fliegt nur die Kamera)."""
    roh = [[i, i] for i, p in enumerate(pts)
           if p.extra.get("rz_uebergang") and not p.extra.get("rz_uebergang_sichtbar")]
    if not roh:
        return []
    out = [roh[0]]
    for r in roh[1:]:
        if r[0] <= out[-1][1] + 1:
            out[-1][1] = r[1]
        else:
            out.append(r)
    return out


def parse_gpx(path: str, text: str | None = None) -> tuple[List[TrackPoint], TrackStats]:
    """Liest eine GPX-Datei (oder ein konvertierbares Fremdformat, siehe
    IMPORT_CACHE_DIR), gibt Trackpunkte (mit kumulierten Werten) + Stats zurück.

    `text` (31.08.2026, Beta-Tester-Befund (NAS)): Wer die Datei schon gelesen hat,
    reicht den Inhalt herein — dann wird sie hier NICHT erneut geöffnet. Der
    Archiv-Scan öffnete jede GPX zweimal (Parse + Quell-Erkennung); über SMB
    ist jede Öffnung ein Netz-Roundtrip."""
    if text is not None:
        gpx = gpxpy.parse(text)
    elif str(path).lower().endswith(".gz"):
        # 02.09.2026 — Der Versionsspeicher der Bibliothek legt Touren
        # gzip-komprimiert ab (docs/UMBAU-BIBLIOTHEK.md, Schnitt 1). Das ist
        # kein Sonderfall der App: `.gpx.gz` liefern auch Strava-Exporte und
        # etliche Logger, es hat vorher nur niemand lesen können.
        import gzip as _gzip
        with _gzip.open(path, "rt", encoding="utf-8") as fh:
            gpx = gpxpy.parse(fh)
    else:
        path = _als_gpx(path)
        with open(path, "r", encoding="utf-8") as fh:
            gpx = gpxpy.parse(fh)

    pts: List[TrackPoint] = []
    seg_namen: List[str] = []
    name = None
    seg_no = -1          # v0.9.483 — läuft über ALLE Tracks/Segmente hinweg weiter
    for track in gpx.tracks:
        # 23.08.2026 — Übergangs-Etappe aus dem Zusammenführen mehrerer Touren
        # (core/merge.py). Sie gehört zu keiner Tour: Strecke und Zeit lassen sie
        # aus, und die unsichtbare Variante wird auch nicht gezeichnet.
        _tn = str(track.name or "")
        _ueberg = _tn.startswith(UEBERGANG_NAME)
        _ueberg_sichtbar = _tn.startswith(UEBERGANG_NAME + "-sichtbar")
        if not name and track.name and not _ueberg:
            name = track.name
        for seg in track.segments:
            if seg.points:
                seg_no += 1      # leere Segmente erzeugen keine Lücke
                seg_namen.append("" if _ueberg else _tn)
            for p in seg.points:
                t_iso = None
                if p.time is not None:
                    t = p.time if p.time.tzinfo else p.time.replace(tzinfo=timezone.utc)
                    t_iso = t.astimezone(timezone.utc).isoformat()
                _extra = _read_point_extensions(p)   # gpxtpx/gpxpx (Strava/Garmin)
                if _ueberg:
                    _extra["rz_uebergang"] = 1.0
                    if _ueberg_sichtbar:
                        _extra["rz_uebergang_sichtbar"] = 1.0
                pts.append(
                    TrackPoint(
                        lat=p.latitude,
                        lon=p.longitude,
                        ele=p.elevation,
                        time=t_iso,
                        seg=max(0, seg_no),
                        extra=_extra,
                    )
                )

    if not pts:
        # 22.08.2026 — Routen (<rte>/<rtept>) als Track lesen. Geplante Etappen
        # aus Planungstools (BaseCamp, Wikiloc, „Route" statt „Track") kommen so
        # daher — vorher „GPX enthält keine Trackpunkte" und die Datei fehlte im
        # Archiv (Nutzer-Video: „06a" neben „06" wird nicht erkannt). Jede Route
        # ist ihre eigene Etappe; ohne Zeitstempel zählt sie automatisch als geplant.
        for route in gpx.routes:
            if not name and route.name:
                name = route.name
            if route.points:
                seg_no += 1
                seg_namen.append(str(route.name or ""))
            for p in route.points:
                t_iso = None
                if p.time is not None:
                    t = p.time if p.time.tzinfo else p.time.replace(tzinfo=timezone.utc)
                    t_iso = t.astimezone(timezone.utc).isoformat()
                pts.append(TrackPoint(lat=p.latitude, lon=p.longitude, ele=p.elevation,
                                      time=t_iso, seg=max(0, seg_no), extra={}))
    if not pts:
        raise ValueError("GPX enthält keine Trackpunkte")

    # v0.9.330 — Sensor-Sidecar (Variante B): index-gleiche Zusatzreihen mergen.
    _tour_meta = _load_sidecar_into(pts, path)
    _seen_fields = set()
    for _p in pts:
        _seen_fields.update(_p.extra.keys())
    # 24.08.2026, am Rechner gefunden: `extra` trägt auch INTERNE Marker, keine
    # Messwerte. `rz_uebergang` stand dadurch als wählbares Datenfeld zwischen
    # Puls und Trittfrequenz — ein Wahrheitswert, den niemand einblenden will.
    # Interne Marker heißen alle `rz_uebergang…` und fliegen hier raus.
    _seen_fields -= {k for k in _seen_fields if str(k).startswith("rz_uebergang")}
    sensor_fields = _sensors.describe_fields(_seen_fields)

    # Kumulierte Distanz/Zeit + Auf-/Abstieg
    eles_raw = [p.ele for p in pts if p.ele is not None]
    ele_min = min(eles_raw) if eles_raw else None
    ele_max = max(eles_raw) if eles_raw else None

    # Distanz + Zeit kumulieren.
    # v0.9.483 — an einer Etappengrenze wird WEDER Distanz NOCH Zeit addiert. Vorher war
    # `elapsed_s` schlicht „jetzt minus erster Zeitstempel"; bei einer Sechs-Etappen-Tour
    # steckten darin alle Nächte dazwischen (gemeldet: 12947 h statt der Gehzeit), und die
    # Luftlinien zwischen den Etappen blähten die Strecke auf (490 km statt 250 km).
    pts[0].dist_m = 0.0
    pts[0].elapsed_s = 0.0
    prev = pts[0]
    for cur in pts[1:]:
        # Übergänge gehören zu keiner Tour → wie eine Etappengrenze behandeln.
        same_seg = (cur.seg == prev.seg
                    and not cur.extra.get("rz_uebergang")
                    and not prev.extra.get("rz_uebergang"))
        cur.dist_m = prev.dist_m + (
            _haversine_m(prev.lat, prev.lon, cur.lat, cur.lon) if same_seg else 0.0
        )
        if same_seg and cur.time and prev.time:
            dt = (datetime.fromisoformat(cur.time) - datetime.fromisoformat(prev.time)).total_seconds()
            cur.elapsed_s = prev.elapsed_s + max(0.0, dt)
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
    # v0.9.483 — je Etappe getrennt: der Höhenunterschied zwischen dem Ende einer Etappe
    # und dem Start der nächsten (anderer Ort, oft anderes Tal) ist kein Anstieg.
    ascent = descent = 0.0
    _seg_start = 0
    for _i in range(1, len(pts) + 1):
        if _i == len(pts) or pts[_i].seg != pts[_seg_start].seg:
            _a, _d = _compute_ascent_descent(
                [p.ele for p in pts[_seg_start:_i]],
                smooth_window=5,
                threshold_m=3.0,
            )
            ascent += _a
            descent += _d
            _seg_start = _i

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
        n_segments=(pts[-1].seg + 1),
        seg_names=seg_namen,
        bbox={
            "min_lat": min(p.lat for p in pts),
            "max_lat": max(p.lat for p in pts),
            "min_lon": min(p.lon for p in pts),
            "max_lon": max(p.lon for p in pts),
        },
        name=name,
        sensor_fields=sensor_fields,
        tour_meta=_tour_meta,
    )
    return pts, stats


def parse_waypoints(path: str) -> List[dict]:
    """Liest die GPX-`<wpt>`-Elemente (Points of Interest) einer Datei.

    Getrennt von `parse_gpx` weil die meisten Tracks keine Waypoints haben
    und der Höhen-Animator sie optional dazuholt. Liefert eine Liste
    `[{lat, lon, ele, name, desc, sym}]` — leer wenn keine vorhanden.
    gpxpy übernimmt das Namespace-Handling (gpx 1.0/1.1).
    """
    try:
        with open(path, "r", encoding="utf-8") as fh:
            gpx = gpxpy.parse(fh)
    except Exception:
        return []
    out: List[dict] = []
    for w in getattr(gpx, "waypoints", []) or []:
        try:
            lat = float(w.latitude)
            lon = float(w.longitude)
        except (TypeError, ValueError):
            continue
        out.append({
            "lat": lat,
            "lon": lon,
            "ele": float(w.elevation) if w.elevation is not None else None,
            "name": (w.name or "").strip(),
            "desc": (getattr(w, "description", None) or "").strip(),
            "sym": (getattr(w, "symbol", None) or "").strip(),
        })
    return out


def downsample(pts: List[TrackPoint], target: int = 500) -> List[TrackPoint]:
    """Reduziert Punkte auf ca. target Stück, gleichmäßig verteilt. Behält erste/letzte."""
    if len(pts) <= target:
        return pts
    step = (len(pts) - 1) / (target - 1)
    idx = [round(i * step) for i in range(target)]
    return [pts[i] for i in idx]


# ── Verteilung der Frames über den Track (v0.9.506) ─────────────────────────
# Bis hierher galt: Frame k zeigt Punkt k aus `downsample()` — also jeden n-ten
# AUFGEZEICHNETEN Punkt. Wie das aussieht, entscheidet damit allein das Gerät:
# löst es nach Strecke aus, wirkt die Animation gleichmäßig; löst es nach Zeit
# aus, zeigt sie das echte Tempo. Gemessen an echtem Material liegt dazwischen
# alles — eine Komoot-Datei hatte im Mittel 10,7 m je Punkt und einen einzelnen
# Sprung von 1121 m. Deshalb wird die Achse jetzt gewählt statt geerbt.

#: Bewegungsschwelle — dieselbe wie in `compute_moving_and_max()`. ⚠️ Die beiden
#: MÜSSEN übereinstimmen: sonst meldet die Statistik „2:00 h Stillstand" und der
#: Animator kürzt eine andere Zeit weg, und niemand kann sich die Differenz
#: erklären.
PAUSE_FLOOR_MS = 0.6 / 3.6
PAUSE_FENSTER_S = 60.0


def finde_pausen(pts: List[TrackPoint], min_dauer_s: float = 120.0) -> List[dict]:
    """Zusammenhängende Abschnitte ohne echte Fortbewegung.

    Pausen treten in **zwei Gestalten** auf und beide müssen erwischt werden:
    als eine große Zeitlücke zwischen zwei nah beieinander liegenden Punkten
    (die Auto-Pause des Geräts — gemessen bis 1898 s), und als viele Punkte, die
    sich am selben Fleck drängeln. Über die Zeitachse gerechnet fallen beide
    unter dieselbe Regel.

    Gibt Abschnitte `{"von_s", "bis_s", "dauer_s"}` auf der `elapsed_s`-Achse
    zurück, nur solche ab `min_dauer_s`.
    """
    n = len(pts)
    if n < 2 or not pts[-1].elapsed_s:
        return []
    cum_time = [p.elapsed_s for p in pts]

    steht = [False] * n          # steht[i] = Abschnitt i-1 → i ist Stillstand
    for i in range(1, n):
        if cum_time[i] - cum_time[i - 1] <= 0:
            continue
        mid = 0.5 * (cum_time[i] + cum_time[i - 1])
        aa = max(0, min(bisect.bisect_left(cum_time, mid - PAUSE_FENSTER_S), i - 1))
        bb = min(n - 1, max(bisect.bisect_right(cum_time, mid + PAUSE_FENSTER_S) - 1, i))
        wdt = cum_time[bb] - cum_time[aa]
        if wdt <= 0:
            continue
        net = _haversine_m(pts[aa].lat, pts[aa].lon, pts[bb].lat, pts[bb].lon)
        steht[i] = (net / wdt) < PAUSE_FLOOR_MS

    pausen: List[dict] = []
    i = 1
    while i < n:
        if not steht[i]:
            i += 1
            continue
        start = i - 1
        while i < n and steht[i]:
            i += 1
        von, bis = cum_time[start], cum_time[i - 1]
        if bis - von >= min_dauer_s:
            pausen.append({"von_s": von, "bis_s": bis, "dauer_s": bis - von})
    return pausen


def pausen_bericht(pts: List[TrackPoint], min_dauer_s: float = 120.0) -> dict:
    """Was der Nutzer wissen muss, bevor er den Schwellwert einstellt.

    Ohne diese Zahlen neben dem Regler stellt sie niemand richtig ein — deshalb
    liefert dieselbe Rechnung, die später kürzt, auch die Anzeige.
    """
    pausen = finde_pausen(pts, min_dauer_s)
    gesamt_s = pts[-1].elapsed_s if pts else 0.0
    steh_s = sum(p["dauer_s"] for p in pausen)
    return {
        "gesamt_s": gesamt_s,
        "pausen": len(pausen),
        "stillstand_s": steh_s,
        "laengste_s": max((p["dauer_s"] for p in pausen), default=0.0),
        "anteil": (steh_s / gesamt_s) if gesamt_s > 0 else 0.0,
        "hat_zeit": bool(gesamt_s),
    }


def _zeitachse_ohne_pausen(pts: List[TrackPoint], pausen: List[dict],
                           kappen_auf_s: float) -> List[float]:
    """Zeitachse, in der jede Pause nur noch `kappen_auf_s` Sekunden lang ist.

    Der Trick: die Pausen-Behandlung ist damit **kein Sonderfall im Renderer**,
    sondern steckt in der Achse. Wer danach gleichmäßig abtastet, bekommt die
    gekürzten Pausen automatisch — `kappen_auf_s = 0` ergibt „überspringen".
    """
    achse: List[float] = []
    versatz = 0.0
    j = 0
    for p in pts:
        t = p.elapsed_s
        # Alle Pausen, die vor diesem Punkt komplett abgeschlossen sind,
        # verkürzen alles Folgende um ihren gesparten Anteil.
        while j < len(pausen) and pausen[j]["bis_s"] <= t:
            versatz += max(0.0, pausen[j]["dauer_s"] - kappen_auf_s)
            j += 1
        # Steckt der Punkt MITTEN in einer Pause, wird innerhalb der Pause
        # anteilig gestaucht — sonst spränge die Achse an der Pausengrenze.
        if j < len(pausen) and pausen[j]["von_s"] < t < pausen[j]["bis_s"]:
            pa = pausen[j]
            anteil = (t - pa["von_s"]) / max(1e-9, pa["dauer_s"])
            achse.append(pa["von_s"] - versatz + anteil * kappen_auf_s)
        else:
            achse.append(t - versatz)
    return achse


def _interpoliere(a: TrackPoint, b: TrackPoint, f: float) -> TrackPoint:
    """Ein Zwischenpunkt zwischen zwei Messpunkten.

    ⚠️ Sensorwerte (Puls, Trittfrequenz, Leistung) müssen **mit**: sonst springt
    die Live-Anzeige im Video, während sich die Position sanft bewegt. Zahlen
    werden interpoliert, alles andere vom näheren Punkt übernommen.
    """
    if f <= 0:
        return a
    if f >= 1:
        return b
    def misch(x, y):
        if x is None or y is None:
            return x if f < 0.5 else y
        return x + (y - x) * f
    extra = dict(a.extra or {})
    for k, v in (b.extra or {}).items():
        av = (a.extra or {}).get(k)
        if isinstance(av, (int, float)) and isinstance(v, (int, float)):
            extra[k] = av + (v - av) * f
        elif k not in extra or f >= 0.5:
            extra[k] = v
    return TrackPoint(
        lat=a.lat + (b.lat - a.lat) * f,
        lon=a.lon + (b.lon - a.lon) * f,
        ele=misch(a.ele, b.ele),
        time=a.time if f < 0.5 else b.time,
        seg=a.seg if f < 0.5 else b.seg,
        dist_m=a.dist_m + (b.dist_m - a.dist_m) * f,
        elapsed_s=a.elapsed_s + (b.elapsed_s - a.elapsed_s) * f,
        extra=extra,
    )


def achsenwerte(pts: List[TrackPoint], achse: str, pausen: str = "trim",
                pause_ab_s: float = 120.0, pause_auf_s: float = 5.0) -> List[float]:
    """Die Achse, entlang der verteilt wird — Strecke oder bereinigte Zeit."""
    if achse == "time":
        pa = finde_pausen(pts, pause_ab_s) if pausen in ("trim", "skip") else []
        return _zeitachse_ohne_pausen(pts, pa, 0.0 if pausen == "skip" else pause_auf_s)
    return [p.dist_m for p in pts]


def _stuetzstellen(werte: List[float], target: int):
    """Für jede der `target` Stützstellen: (Index davor, Anteil bis zum nächsten).

    Geteilt von `resample()` (baut daraus Punkte) und `pace_index_map()` (baut
    daraus die Tabelle für die Vorschau). ⚠️ Beide MÜSSEN dieselbe Rechnung
    benutzen, sonst zeigt die Vorschau etwas anderes als das fertige Video —
    und genau dafür ist die Vorschau da.
    """
    spanne = werte[-1] - werte[0]
    j = 0
    for k in range(target):
        ziel = werte[0] + spanne * (k / max(1, target - 1))
        # ⚠️ `<=` statt `<`: bei „überspringen" fallen alle Punkte einer Pause
        # auf denselben Achsenwert. Mit `<` bliebe der Abtaster am ersten davon
        # hängen und mehrere Frames zeigten denselben Ort — also genau das
        # Stehenbleiben, das dieser Modus verhindern soll (gemessen: 6 von 200
        # Frames). Mit `<=` läuft er über das Plateau hinweg.
        while j < len(werte) - 2 and werte[j + 1] <= ziel:
            j += 1
        d = werte[j + 1] - werte[j]
        f = 0.0 if d <= 0 else (ziel - werte[j]) / d
        yield j, max(0.0, min(1.0, f))


def pace_index_map(pts: List[TrackPoint], n: int, achse: str = "raw",
                   pausen: str = "trim", pause_ab_s: float = 120.0,
                   pause_auf_s: float = 5.0) -> List[float]:
    """Tabelle „Fortschritt → Punkt-Index" mit `n` Stützstellen.

    Dafür da, dass die **Vorschau** in der App dieselbe Verteilung zeigt wie der
    spätere Render. Die Vorschau läuft im Browser über die Rohkoordinaten und
    wüsste sonst nichts von der gewählten Achse — sie zeigte immer „wie
    aufgezeichnet", während das Video etwas anderes tut.

    Zurück kommen Bruchteil-Indizes (12.4 = zwischen Punkt 12 und 13), damit die
    Vorschau weich läuft statt zu springen.
    """
    letzter = len(pts) - 1
    gerade = lambda: [letzter * (k / (n - 1)) for k in range(n)]
    if len(pts) < 2 or n < 2:
        return [0.0] * max(1, n)
    if achse == "time" and not pts[-1].elapsed_s:
        achse = "dist"              # ohne Zeitstempel gibt es keine Zeitachse
    if achse == "raw":
        return gerade()
    werte = achsenwerte(pts, achse, pausen, pause_ab_s, pause_auf_s)
    if werte[-1] - werte[0] <= 0:
        return gerade()
    return [j + f for j, f in _stuetzstellen(werte, n)]


def resample(pts: List[TrackPoint], target: int, achse: str = "raw",
             pausen: str = "trim", pause_ab_s: float = 120.0,
             pause_auf_s: float = 5.0) -> List[TrackPoint]:
    """Verteilt `target` Punkte gleichmäßig entlang der gewählten Achse.

    * `achse="raw"`   — jeder n-te aufgezeichnete Punkt (Verhalten bis v0.9.505)
    * `achse="dist"`  — gleichmäßig über die Strecke → sichtbar gleichbleibendes Tempo
    * `achse="time"`  — gleichmäßig über die Zeit → sichtbar das echte Tempo

    Bei `achse="time"` regelt `pausen`, was mit Standzeiten passiert:
    `"show"` (voll), `"trim"` (auf `pause_auf_s` gekürzt) oder `"skip"` (raus).

    `target` darf **größer** sein als die Zahl der Messpunkte: dann entstehen
    Zwischenwerte, und ein grob aufgezeichneter Track bewegt sich flüssig statt
    zu ruckeln. `downsample()` konnte das nie (es reduziert nur) — im Animator
    fällt das nicht auf, weil dort nie mehr Punkte verlangt werden als vorhanden.

    ⚠️ Ohne Zeitstempel gibt es keine Zeitachse — dann fällt die Funktion
    stillschweigend auf `"dist"` zurück. Die Oberfläche sperrt die Auswahl schon
    vorher, aber der Kern darf deshalb nicht abstürzen (geplante Routen ohne
    Zeit sind häufig: bei einem Archiv mit 709 Touren 304 Stück).
    """
    if len(pts) < 2 or target < 2:
        return pts[:target] if target >= 1 else pts
    if achse == "raw":
        if target <= len(pts):
            return downsample(pts, target)
        # v0.9.510 — „wie aufgezeichnet" HOCHtasten: die Achse ist der
        # Punkt-INDEX selbst. Damit bleibt der Rhythmus des Geräts exakt
        # erhalten — es entstehen nur Zwischenpositionen auf den vorhandenen
        # Wegstücken. (Strecken- oder Zeitachse würde die Verteilung ändern
        # und aus „raw" heimlich „even"/„real" machen.)
        werte = [float(i) for i in range(len(pts))]
        out = [_interpoliere(pts[j], pts[j + 1], f)
               for j, f in _stuetzstellen(werte, target)]
        out[0], out[-1] = pts[0], pts[-1]
        return out

    hat_zeit = bool(pts[-1].elapsed_s)
    if achse == "time" and not hat_zeit:
        achse = "dist"

    werte = achsenwerte(pts, achse, pausen, pause_ab_s, pause_auf_s)
    if werte[-1] - werte[0] <= 0:
        return downsample(pts, target)

    out: List[TrackPoint] = [
        _interpoliere(pts[j], pts[j + 1], f)
        for j, f in _stuetzstellen(werte, target)
    ]
    out[0], out[-1] = pts[0], pts[-1]
    return out


def to_json(pts: List[TrackPoint], stats: TrackStats) -> dict:
    """Serialisierbar fürs UI."""
    return {
        "points": [asdict(p) for p in pts],
        "stats": asdict(stats),
    }
