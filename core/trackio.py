"""
Track-Export als String — GPX und CSV.

Single source of truth: wird von der Desktop-App (Bridge `export_current_csv`)
UND vom Web-Endpoint (`gps-studio-web/api/export.py`) genutzt. Punkte sind
`[{lat, lon, ele?, time?}]` (oder Objekte mit gleichnamigen Attributen); `time`
ist ISO-8601 (UTC) oder None.
"""
from __future__ import annotations

import csv
import io
import xml.sax.saxutils as _sx
from datetime import datetime, timezone
from typing import Optional


def _get(p, key):
    if isinstance(p, dict):
        return p.get(key)
    return getattr(p, key, None)


def _parse_iso(s):
    if not s:
        return None
    try:
        t = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        return t if t.tzinfo else t.replace(tzinfo=timezone.utc)
    except Exception:
        return None


# v0.9.330 — Sensor-Felder, die GPX nativ tragen kann (gpxtpx/gpxpx). Spiegel
# von core.sensors.GPX_EXPORT; hier INLINE gehalten, damit dieses Modul
# dependency-arm bleibt (wird auch vom Web-Export genutzt).
_GPXTPX_NS = "http://www.garmin.com/xmlschemas/TrackPointExtension/v1"
_GPXPX_NS = "http://www.garmin.com/xmlschemas/PowerExtension/v1"
_TPX_FIELDS = {"hr": "hr", "cadence": "cad", "temperature": "atemp"}


def _point_extensions(p) -> str:
    """GPX-Standard-Extensions eines Punkts aus seinem `extra`-Dict — alles, wofür
    das Format Felder hat (HR/Trittfrequenz/Temp via gpxtpx, Leistung via <power>).
    Nicht-Standard-Felder (E-Bike etc.) trägt GPX nicht → werden nicht exportiert."""
    extra = _get(p, "extra")
    if not isinstance(extra, dict) or not extra:
        return ""
    tpx = []
    for key, ln in _TPX_FIELDS.items():
        v = extra.get(key)
        if v is None:
            continue
        try:
            tpx.append(f"<gpxtpx:{ln}>{float(v):g}</gpxtpx:{ln}>")
        except (TypeError, ValueError):
            pass
    parts = []
    if tpx:
        parts.append("<gpxtpx:TrackPointExtension>" + "".join(tpx) + "</gpxtpx:TrackPointExtension>")
    pw = extra.get("power")
    if pw is not None:
        try:
            parts.append(f"<power>{float(pw):g}</power>")
        except (TypeError, ValueError):
            pass
    return ("<extensions>" + "".join(parts) + "</extensions>") if parts else ""


def to_gpx_string(points, name: Optional[str] = None) -> str:
    """Punkte als valides GPX-1.1 (ein Track, ein Segment) zurückgeben.
    Sensor-Standardfelder (HR/Trittfrequenz/Temp/Leistung) werden als
    gpxtpx/gpxpx-Extensions mitgeschrieben (Strava/Garmin lesen die)."""
    nm = _sx.escape(name) if name else "Track"
    out = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<gpx version="1.1" creator="Reisezoom GPS Studio" '
        'xmlns="http://www.topografix.com/GPX/1/1" '
        f'xmlns:gpxtpx="{_GPXTPX_NS}" xmlns:gpxpx="{_GPXPX_NS}">',
        f"<trk><name>{nm}</name><trkseg>",
    ]
    for p in points:
        lat = _get(p, "lat"); lon = _get(p, "lon")
        if lat is None or lon is None:
            continue
        ele = _get(p, "ele"); tm = _get(p, "time")
        seg = [f'<trkpt lat="{float(lat):.7f}" lon="{float(lon):.7f}">']
        if ele is not None:
            try:
                seg.append(f"<ele>{float(ele):.2f}</ele>")
            except (TypeError, ValueError):
                pass
        dt = _parse_iso(tm)
        if dt is not None:
            seg.append("<time>" + dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") + "</time>")
        seg.append(_point_extensions(p))
        seg.append("</trkpt>")
        out.append("".join(seg))
    out.append("</trkseg></trk></gpx>")
    return "\n".join(out) + "\n"


def to_csv_string(points) -> str:
    """Punkte als CSV: index,lat,lon,ele,time (ISO-UTC oder leer)."""
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["index", "lat", "lon", "ele", "time"])
    i = 0
    for p in points:
        lat = _get(p, "lat"); lon = _get(p, "lon")
        if lat is None or lon is None:
            continue
        ele = _get(p, "ele"); tm = _get(p, "time")
        dt = _parse_iso(tm)
        w.writerow([
            i,
            f"{float(lat):.7f}",
            f"{float(lon):.7f}",
            ("" if ele is None else f"{float(ele):.2f}"),
            ("" if dt is None else dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")),
        ])
        i += 1
    return buf.getvalue()


def to_geojson_string(points, name: Optional[str] = None) -> str:
    """Punkte als GeoJSON FeatureCollection mit einer LineString-Feature.
    Koordinaten [lon, lat(, ele)]; Zeiten (falls vorhanden) als `coordTimes`."""
    import json
    coords = []
    times = []
    for p in points:
        lat = _get(p, "lat"); lon = _get(p, "lon")
        if lat is None or lon is None:
            continue
        c = [round(float(lon), 7), round(float(lat), 7)]
        ele = _get(p, "ele")
        if ele is not None:
            try:
                c.append(round(float(ele), 2))
            except (TypeError, ValueError):
                pass
        coords.append(c)
        dt = _parse_iso(_get(p, "time"))
        times.append(dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if dt else None)
    props = {"name": name or "Track"}
    if any(times):
        props["coordTimes"] = times
    fc = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": props,
         "geometry": {"type": "LineString", "coordinates": coords}}]}
    return json.dumps(fc, ensure_ascii=False)


def to_kml_string(points, name: Optional[str] = None) -> str:
    """Punkte als KML 2.2 (ein Placemark mit LineString)."""
    nm = _sx.escape(name) if name else "Track"
    coords = []
    for p in points:
        lat = _get(p, "lat"); lon = _get(p, "lon")
        if lat is None or lon is None:
            continue
        ele = _get(p, "ele")
        try:
            e = float(ele) if ele is not None else 0.0
        except (TypeError, ValueError):
            e = 0.0
        coords.append(f"{float(lon):.7f},{float(lat):.7f},{e:.2f}")
    out = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>',
        f"<name>{nm}</name>",
        f"<Placemark><name>{nm}</name><LineString><tessellate>1</tessellate>",
        "<coordinates>" + " ".join(coords) + "</coordinates>",
        "</LineString></Placemark>",
        "</Document></kml>",
    ]
    return "\n".join(out) + "\n"


def to_kmz_bytes(points, name: Optional[str] = None) -> bytes:
    """KMZ = gezipptes KML (doc.kml)."""
    import zipfile
    kml = to_kml_string(points, name)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("doc.kml", kml)
    return buf.getvalue()


def to_tcx_string(points, name: Optional[str] = None) -> str:
    """Punkte als Garmin TCX (Activity). TCX braucht je Trackpoint eine Zeit —
    fehlende Zeiten werden sekundenweise ab vorigem/Basis aufgefüllt."""
    from datetime import timedelta
    pts = [p for p in points if _get(p, "lat") is not None and _get(p, "lon") is not None]
    raw = [_parse_iso(_get(p, "time")) for p in pts]
    if not any(raw):
        b = datetime(2020, 1, 1, tzinfo=timezone.utc)
        times = [b + timedelta(seconds=i) for i in range(len(pts))]
    else:
        times = []
        last = None
        for dt in raw:
            if dt is None:
                dt = (last + timedelta(seconds=1)) if last else datetime(2020, 1, 1, tzinfo=timezone.utc)
            times.append(dt); last = dt
    fz = lambda dt: dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    sid = fz(times[0]) if times else "2020-01-01T00:00:00Z"
    out = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">',
        '<Activities><Activity Sport="Other">',
        f"<Id>{sid}</Id>",
        f'<Lap StartTime="{sid}"><Track>',
    ]
    for p, dt in zip(pts, times):
        lat = float(_get(p, "lat")); lon = float(_get(p, "lon")); ele = _get(p, "ele")
        seg = ["<Trackpoint>", f"<Time>{fz(dt)}</Time>",
               f"<Position><LatitudeDegrees>{lat:.7f}</LatitudeDegrees>"
               f"<LongitudeDegrees>{lon:.7f}</LongitudeDegrees></Position>"]
        if ele is not None:
            try:
                seg.append(f"<AltitudeMeters>{float(ele):.2f}</AltitudeMeters>")
            except (TypeError, ValueError):
                pass
        # v0.9.335 — Sensoren nativ ins TCX (Garmin/Strava lesen HeartRateBpm/Cadence).
        # TCX-Schema-Reihenfolge: …AltitudeMeters, [DistanceMeters], HeartRateBpm, Cadence.
        extra = _get(p, "extra")
        if isinstance(extra, dict) and extra:
            hr = extra.get("hr")
            if isinstance(hr, (int, float)) and not isinstance(hr, bool):
                seg.append(f"<HeartRateBpm><Value>{int(round(hr))}</Value></HeartRateBpm>")
            cad = extra.get("cadence")
            if isinstance(cad, (int, float)) and not isinstance(cad, bool):
                seg.append(f"<Cadence>{max(0, min(254, int(round(cad))))}</Cadence>")
        seg.append("</Trackpoint>")
        out.append("".join(seg))
    out += ["</Track></Lap></Activity></Activities>", "</TrainingCenterDatabase>"]
    return "\n".join(out) + "\n"


# fmt → MIME-Typ. Single source of truth für App + Web-Export.
EXPORT_MIME = {
    "gpx": "application/gpx+xml",
    "csv": "text/csv",
    "geojson": "application/geo+json",
    "kml": "application/vnd.google-earth.kml+xml",
    "kmz": "application/vnd.google-earth.kmz",
    "tcx": "application/vnd.garmin.tcx+xml",
}
SUPPORTED_EXPORT = tuple(EXPORT_MIME.keys())


def to_string(points, fmt: str = "gpx", name: Optional[str] = None) -> str:
    fmt = (fmt or "gpx").lower()
    if fmt == "csv":
        return to_csv_string(points)
    if fmt == "geojson":
        return to_geojson_string(points, name)
    if fmt == "kml":
        return to_kml_string(points, name)
    if fmt == "tcx":
        return to_tcx_string(points, name)
    return to_gpx_string(points, name)


def export_payload(points, fmt: str = "gpx", name: Optional[str] = None):
    """Binär-sicherer Export: gibt (bytes, mime) zurück. KMZ ist gezippt,
    alle anderen sind UTF-8-Text."""
    fmt = (fmt or "gpx").lower()
    if fmt not in EXPORT_MIME:
        fmt = "gpx"
    if fmt == "kmz":
        return to_kmz_bytes(points, name), EXPORT_MIME["kmz"]
    return to_string(points, fmt, name).encode("utf-8"), EXPORT_MIME[fmt]
