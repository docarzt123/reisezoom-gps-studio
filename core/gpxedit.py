"""
GPX-Inspektor / Track-Editing (v0.9.233 — Marc-Idee, Nutzer-Bug-Report (c)).

Lädt den VOLLEN Roh-Track (jeder GPS-Punkt, NICHT das 800-Downsample der
Render-Pipeline) und schreibt einen editierten Track zurück. Die eigentliche
Heil-/Einfüge-Logik läuft im Frontend (interaktiv auf der Karte); hier nur
Laden (alle Punkte inkl. ele + time) und Speichern als neues GPX.

Konsistenz-Prinzip (Marc): beim „Heilen" werden nur Position + Höhe interpoliert,
die ZEITSTEMPEL bleiben — dadurch korrigiert sich die Geschwindigkeit von selbst
(gleiche Zeit, saubere kurze Strecke statt Reflektions-Spike). Beim Einfügen
neuer Punkte (Lücke füllen) werden lat/lon/ele UND time interpoliert.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import List, Optional

from . import gpx as cgpx


def load_points(path: str) -> dict:
    """Alle Track-Punkte mit Index, lat, lon, ele, time (ISO-UTC) laden.

    Returns {ok, points:[{i,lat,lon,ele,time}], count, has_time, has_ele, bbox}.
    """
    pts, stats = cgpx.parse_gpx(path)
    out = []
    has_time = False
    has_ele = False
    for i, p in enumerate(pts):
        if p.time:
            has_time = True
        if p.ele is not None:
            has_ele = True
        out.append({
            "i": i,
            "lat": float(p.lat),
            "lon": float(p.lon),
            "ele": (None if p.ele is None else float(p.ele)),
            "time": p.time,  # ISO-String oder None
        })
    # Hat der Quell-Track FIT/TCX-Sensoren? (→ Frontend zeigt Hinweis, dass sie
    # beim Speichern erhalten bleiben). extra ist nur intern, geht nicht raus.
    has_sensors = any(getattr(p, "extra", None) for p in pts)
    bbox = getattr(stats, "bbox", None) or {}
    return {
        "ok": True,
        "points": out,
        "count": len(out),
        "has_time": has_time,
        "has_ele": has_ele,
        "has_sensors": has_sensors,
        "bbox": bbox,
    }


def _parse_iso(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        # ISO-8601, evtl. mit 'Z'
        t = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if t.tzinfo is None:
            t = t.replace(tzinfo=timezone.utc)
        return t
    except Exception:
        return None


def save_points(
    points: List[dict], out_path: str, *, name: str = "Geheilt",
    src_path: Optional[str] = None, fmt: str = "gpx",
) -> dict:
    """Editierten Track schreiben — als GPX **oder TCX**, mit eingebetteten Sensoren.

    points = [{lat, lon, ele?, time?, oi?}] in Reihenfolge. `oi` = Original-Index
    im Quell-Track (vom Frontend durchgereicht); eingefügte Punkte haben kein `oi`.

    v0.9.335 (Nutzer-Feedback): Sensoren werden jetzt **direkt in die Datei**
    geschrieben (gpxtpx HR/Trittfrequenz/Temperatur + `<power>` im GPX, native
    Felder im TCX — Garmin/Strava lesen das), nicht mehr nur in den Sidecar. So
    geht beim portablen Weitergeben nichts verloren. Zusätzlich wird für GPX der
    Sidecar `<out>.sensors.json` geschrieben (verlustfrei auch für exotische
    Geräte-Felder wie grd_pct/ngp beim Re-Import in Reisezoom).

    `fmt` ∈ {"gpx", "tcx"}. Sensorwerte unveränderter/geheilter Punkte bleiben
    exakt (über `oi`), eingefügte Punkte werden interpoliert.

    Returns {ok, out_path, count, sensors_kept, fmt}.
    """
    if not points or len(points) < 2:
        return {"ok": False, "error": "Zu wenige Punkte zum Speichern"}
    fmt = (fmt or "gpx").lower()
    if fmt not in ("gpx", "tcx"):
        fmt = "gpx"

    pts: List[dict] = []
    oi_list: List[Optional[int]] = []   # Original-Index (oder None) je gültigem Punkt
    for p in points:
        try:
            lat = float(p["lat"]); lon = float(p["lon"])
        except (KeyError, TypeError, ValueError):
            continue
        ele = p.get("ele")
        ele_f = None
        if ele is not None:
            try:
                ele_f = float(ele)
            except (TypeError, ValueError):
                ele_f = None
        pts.append({"lat": lat, "lon": lon, "ele": ele_f, "time": p.get("time"), "extra": {}})
        oi = p.get("oi")
        oi_list.append(oi if isinstance(oi, int) else None)
    if len(pts) < 2:
        return {"ok": False, "error": "Zu wenige gültige Punkte"}

    # Sensoren re-indizieren und an die Punkte hängen (für den eingebetteten Export).
    out_extra = _reindex_extra(oi_list, src_path)
    has_sensors = bool(out_extra) and any(out_extra)
    if has_sensors:
        for pt, ex in zip(pts, out_extra):
            pt["extra"] = ex or {}

    from . import trackio as ctrackio
    data, _mime = ctrackio.export_payload(pts, fmt, name)

    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with open(out_path, "wb") as fh:
        fh.write(data if isinstance(data, (bytes, bytearray)) else str(data).encode("utf-8"))

    # GPX: zusätzlich Sidecar (verlustfrei, auch exotische Felder) neben die Datei.
    sensors_kept = has_sensors
    if fmt == "gpx" and has_sensors:
        try:
            from . import imports as cimports
            cimports.write_sidecar([e or {} for e in out_extra], out_path)
        except Exception:
            pass
    return {"ok": True, "out_path": out_path, "count": len(pts),
            "sensors_kept": sensors_kept, "fmt": fmt}


def _reindex_extra(
    oi_list: List[Optional[int]], src_path: Optional[str]
) -> List[Optional[dict]]:
    """Sensorwerte des Quell-Tracks index-gleich auf den editierten Track mappen.
    Unveränderte/geheilte Punkte (oi gesetzt) behalten ihren Wert, eingefügte
    (oi=None) werden interpoliert. Leere Liste, wenn die Quelle keine Sensoren hat."""
    if not src_path:
        return []
    try:
        src_pts, _ = cgpx.parse_gpx(src_path)   # extra ist aus dem Quell-Sidecar gemergt
    except Exception:
        return []
    if not src_pts or not any(getattr(sp, "extra", None) for sp in src_pts):
        return []
    nsrc = len(src_pts)
    out_extra: List[Optional[dict]] = [None] * len(oi_list)
    for i, oi in enumerate(oi_list):
        if oi is not None and 0 <= oi < nsrc:
            ex = getattr(src_pts[oi], "extra", None)
            out_extra[i] = dict(ex) if ex else {}
    _interp_none_runs(out_extra)   # eingefügte Punkte (oi=None) interpolieren
    return out_extra


def _interp_extra(left: dict, right: dict, frac: float) -> dict:
    """Sensorwerte zwischen zwei Punkten linear mischen (frac 0..1)."""
    out: dict = {}
    for key in set(left) | set(right):
        lv = left.get(key); rv = right.get(key)
        if isinstance(lv, (int, float)) and isinstance(rv, (int, float)):
            out[key] = lv + (rv - lv) * frac
        elif lv is not None:
            out[key] = lv
        elif rv is not None:
            out[key] = rv
    return out


def _interp_none_runs(arr: List[Optional[dict]]) -> None:
    """Lücken (None) in der Extra-Liste füllen: zwischen zwei Originalen linear
    interpolieren, an den Rändern den nächsten vorhandenen Wert übernehmen."""
    n = len(arr)
    i = 0
    while i < n:
        if arr[i] is not None:
            i += 1
            continue
        j = i
        while j < n and arr[j] is None:
            j += 1
        left = arr[i - 1] if i - 1 >= 0 else None
        right = arr[j] if j < n else None
        for k in range(i, j):
            if left is not None and right is not None:
                frac = (k - (i - 1)) / (j - (i - 1))
                arr[k] = _interp_extra(left, right, frac)
            elif left is not None:
                arr[k] = dict(left)
            elif right is not None:
                arr[k] = dict(right)
            else:
                arr[k] = {}
        i = j


def healed_output_path(src_path: str) -> str:
    """`/dir/2. Jan 2020.gpx` → `/dir/2. Jan 2020_geheilt.gpx`."""
    d = os.path.dirname(src_path)
    base = os.path.basename(src_path)
    stem, ext = os.path.splitext(base)
    if not ext:
        ext = ".gpx"
    return os.path.join(d, f"{stem}_geheilt{ext}")
