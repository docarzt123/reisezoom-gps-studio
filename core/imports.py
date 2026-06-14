"""
Universelle Track-Import-Schicht (v0.9.282, Beta-Tester/Leo-Wunsch).

Idee: Andere GPS-Track-Formate werden beim Öffnen automatisch nach GPX
konvertiert, sodass die ganze App (Animator, Tour-Map, Geotagger, Höhen-
Animator) unverändert mit echten GPX-Dateien weiterarbeitet. Der Nutzer öffnet
eine `.fit`/`.nmea`/`.kml`/… einfach wie eine GPX.

Unterstützte Eingabe-Formate:
  Stufe 1: FIT (.fit) · NMEA (.nmea/.log/.txt) · KML/KMZ (.kml/.kmz)
  Stufe 2: TCX (.tcx) · GeoJSON (.geojson/.json)

Öffentliche API:
  IMPORT_EXTS            – Menge der konvertierbaren Endungen (ohne .gpx)
  is_convertible(path)   – True wenn die Endung konvertierbar ist
  parse_points(path)     – Liste[(lat, lon, ele|None, time_iso|None)]
  write_gpx(points, out) – schreibt eine GPX-Datei (lat/lon/ele/time)
  convert_to_gpx(src, out, name=) – src → GPX-Datei
  ensure_gpx(path, cache_dir) – .gpx → unverändert; sonst konvertieren + cachen,
                                Pfad zur (gecachten) GPX zurückgeben

Architektur-Hinweis: ein Format = ein Parser, alles andere bleibt GPX. Wer ein
Format ergänzt, fügt einen `_parse_*` hinzu und trägt die Endung in `_DISPATCH` ein.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timezone
from typing import List, Optional, Tuple

import gpxpy
import gpxpy.gpx

_log = logging.getLogger("core.imports")

# (lat, lon, ele|None, time_iso|None)
Point = Tuple[float, float, Optional[float], Optional[str]]


class TrackImportError(Exception):
    """Konvertierung fehlgeschlagen (unbekanntes/leeres/kaputtes Format)."""


# Endung → Parser-Schlüssel. .txt/.json sind mehrdeutig → Content-Sniffing.
_DISPATCH = {
    ".fit": "fit",
    ".nmea": "nmea",
    ".log": "nmea",
    ".txt": "sniff",       # NMEA wenn $GP… drinsteht, sonst Fehler
    ".kml": "kml",
    ".kmz": "kmz",
    ".tcx": "tcx",
    ".geojson": "geojson",
    ".json": "sniff_json",  # GeoJSON wenn es so aussieht
}

IMPORT_EXTS = set(_DISPATCH.keys())


def is_convertible(path: str) -> bool:
    return os.path.splitext(str(path))[1].lower() in IMPORT_EXTS


# ── XML-Helfer ────────────────────────────────────────────────────────────────

def _localname(tag: str) -> str:
    """'{ns}LatitudeDegrees' → 'latitudedegrees' (namespace-agnostisch, lower)."""
    return tag.rsplit("}", 1)[-1].lower()


def _iter_local(root, name: str):
    """Alle Elemente mit lokalem Tag-Namen `name` (namespace-egal)."""
    name = name.lower()
    for el in root.iter():
        if _localname(el.tag) == name:
            yield el


# ── FIT (Garmin/Wahoo/Coros/Suunto/Strava) ──────────────────────────────────

_SEMI = 180.0 / (2 ** 31)  # Semicircles → Grad


def _parse_fit(path: str) -> List[Point]:
    try:
        import fitdecode  # type: ignore
    except Exception as e:  # pragma: no cover
        raise TrackImportError(
            "FIT-Import braucht das Paket 'fitdecode' (pip install fitdecode)."
        ) from e

    pts: List[Point] = []
    with fitdecode.FitReader(path) as fit:
        for frame in fit:
            if not isinstance(frame, fitdecode.FitDataMessage):
                continue
            if frame.name != "record":
                continue
            try:
                lat_raw = frame.get_value("position_lat", fallback=None)
                lon_raw = frame.get_value("position_long", fallback=None)
            except Exception:
                lat_raw = lon_raw = None
            if lat_raw is None or lon_raw is None:
                continue
            lat = lat_raw * _SEMI
            lon = lon_raw * _SEMI
            ele = frame.get_value("enhanced_altitude", fallback=None)
            if ele is None:
                ele = frame.get_value("altitude", fallback=None)
            ts = frame.get_value("timestamp", fallback=None)
            tiso = None
            if isinstance(ts, datetime):
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=timezone.utc)
                tiso = ts.astimezone(timezone.utc).isoformat()
            pts.append((float(lat), float(lon),
                        float(ele) if ele is not None else None, tiso))
    return pts


# ── NMEA 0183 (Canon 6D, Marine-GPS, Logger, Dashcams) ───────────────────────

def _nmea_coord(val: str, hemi: str) -> Optional[float]:
    """'4807.038','N' → 48.1173 Grad. Format (d)ddmm.mmmm."""
    try:
        v = float(val)
    except ValueError:
        return None
    deg = int(v // 100)
    minutes = v - deg * 100
    dd = deg + minutes / 60.0
    if hemi in ("S", "W"):
        dd = -dd
    return dd


def _parse_nmea(path: str) -> List[Point]:
    # RMC liefert Datum+Zeit+lat/lon, GGA liefert lat/lon+Höhe (ohne Datum).
    # Wir nehmen RMC als Rückgrat und ziehen die Höhe per Tageszeit aus GGA.
    gga_alt: dict = {}      # "hhmmss" → alt
    rmc: List[tuple] = []   # (hhmmss, ddmmyy, lat, lon)
    gga_only: List[tuple] = []  # (lat, lon, alt) falls gar kein RMC
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        for raw in fh:
            line = raw.strip()
            if not line or "$" not in line:
                continue
            line = line[line.index("$"):]
            body = line.split("*", 1)[0]
            f = body.split(",")
            typ = f[0][3:] if len(f[0]) >= 6 else f[0].lstrip("$")
            if typ == "RMC" and len(f) >= 10 and f[2] == "A":
                lat = _nmea_coord(f[3], f[4])
                lon = _nmea_coord(f[5], f[6])
                if lat is None or lon is None:
                    continue
                hhmmss = f[1].split(".")[0]
                rmc.append((hhmmss, f[9], lat, lon))
            elif typ == "GGA" and len(f) >= 10:
                # GGA-Felder: time, lat, N/S, lon, E/W, fix, numsat, hdop, alt, M …
                lat = _nmea_coord(f[2], f[3])
                lon = _nmea_coord(f[4], f[5])
                if lat is None or lon is None:
                    continue
                hhmmss = f[1].split(".")[0]
                alt = None
                try:
                    alt = float(f[9]) if f[9] not in ("", None) else None
                except ValueError:
                    alt = None
                if alt is not None:
                    gga_alt[hhmmss] = alt
                gga_only.append((lat, lon, alt))

    pts: List[Point] = []
    if rmc:
        for hhmmss, ddmmyy, lat, lon in rmc:
            tiso = None
            if len(ddmmyy) == 6 and len(hhmmss) == 6:
                try:
                    dt = datetime.strptime(ddmmyy + hhmmss, "%d%m%y%H%M%S")
                    dt = dt.replace(tzinfo=timezone.utc)
                    tiso = dt.isoformat()
                except ValueError:
                    tiso = None
            pts.append((lat, lon, gga_alt.get(hhmmss), tiso))
    else:
        # Nur GGA vorhanden → Position + Höhe, aber keine Zeit (GGA hat kein Datum)
        for lat, lon, alt in gga_only:
            pts.append((lat, lon, alt, None))
    return pts


def _looks_like_nmea(path: str) -> bool:
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            head = fh.read(4096)
        return bool(re.search(r"\$G[PNLA][A-Z]{3},", head))
    except Exception:
        return False


# ── KML / KMZ (Google Earth, My Maps) ────────────────────────────────────────

def _parse_kml_string(data: str) -> List[Point]:
    root = ET.fromstring(data)
    pts: List[Point] = []

    # 1) gx:Track — <when>…</when> + <gx:coord>lon lat ele</gx:coord> (paarweise)
    for trk in _iter_local(root, "track"):
        whens = [w.text.strip() for w in _iter_local(trk, "when") if w.text]
        coords = [c.text.strip() for c in trk if _localname(c.tag) == "coord" and c.text]
        for i, c in enumerate(coords):
            parts = c.split()
            if len(parts) < 2:
                continue
            lon, lat = float(parts[0]), float(parts[1])
            ele = float(parts[2]) if len(parts) >= 3 else None
            tiso = _norm_iso(whens[i]) if i < len(whens) else None
            pts.append((lat, lon, ele, tiso))
    if pts:
        return pts

    # 2) Klassische LineString-<coordinates>lon,lat,ele …</coordinates>
    for coords_el in _iter_local(root, "coordinates"):
        if not coords_el.text:
            continue
        for tok in coords_el.text.replace("\n", " ").split():
            parts = tok.split(",")
            if len(parts) < 2:
                continue
            try:
                lon, lat = float(parts[0]), float(parts[1])
            except ValueError:
                continue
            ele = None
            if len(parts) >= 3:
                try:
                    ele = float(parts[2])
                except ValueError:
                    ele = None
            pts.append((lat, lon, ele, None))
    return pts


def _parse_kml(path: str) -> List[Point]:
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        return _parse_kml_string(fh.read())


def _parse_kmz(path: str) -> List[Point]:
    with zipfile.ZipFile(path) as z:
        # doc.kml bevorzugt, sonst erste .kml im Archiv
        names = z.namelist()
        kml_name = "doc.kml" if "doc.kml" in names else next(
            (n for n in names if n.lower().endswith(".kml")), None)
        if not kml_name:
            raise TrackImportError("KMZ enthält keine KML-Datei.")
        data = z.read(kml_name).decode("utf-8", errors="replace")
    return _parse_kml_string(data)


# ── TCX (Garmin Training Center, Strava-Export) ──────────────────────────────

def _parse_tcx(path: str) -> List[Point]:
    tree = ET.parse(path)
    root = tree.getroot()
    pts: List[Point] = []
    for tp in _iter_local(root, "trackpoint"):
        lat = lon = ele = None
        tiso = None
        for ch in tp.iter():
            ln = _localname(ch.tag)
            if ln == "latitudedegrees" and ch.text:
                lat = float(ch.text)
            elif ln == "longitudedegrees" and ch.text:
                lon = float(ch.text)
            elif ln == "altitudemeters" and ch.text:
                try:
                    ele = float(ch.text)
                except ValueError:
                    ele = None
            elif ln == "time" and ch.text:
                tiso = _norm_iso(ch.text.strip())
        if lat is not None and lon is not None:
            pts.append((lat, lon, ele, tiso))
    return pts


# ── GeoJSON ──────────────────────────────────────────────────────────────────

def _parse_geojson(path: str) -> List[Point]:
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        data = json.load(fh)
    pts: List[Point] = []

    def emit_line(coords, times):
        for i, c in enumerate(coords):
            if not isinstance(c, (list, tuple)) or len(c) < 2:
                continue
            lon, lat = float(c[0]), float(c[1])
            ele = float(c[2]) if len(c) >= 3 else None
            tiso = _norm_iso(times[i]) if times and i < len(times) else None
            pts.append((lat, lon, ele, tiso))

    def handle_geometry(geom, props):
        if not geom:
            return
        gtype = geom.get("type")
        coords = geom.get("coordinates")
        # Strava/togpx: properties.coordTimes (flach oder pro Segment)
        times = (props or {}).get("coordTimes")
        if gtype == "LineString":
            emit_line(coords, times if isinstance(times, list) else None)
        elif gtype == "MultiLineString":
            for si, seg in enumerate(coords or []):
                seg_times = None
                if isinstance(times, list) and times and isinstance(times[0], list):
                    seg_times = times[si] if si < len(times) else None
                emit_line(seg, seg_times)
        elif gtype == "Point":
            emit_line([coords], times if isinstance(times, list) else None)

    t = data.get("type")
    if t == "FeatureCollection":
        for feat in data.get("features", []):
            handle_geometry(feat.get("geometry"), feat.get("properties"))
    elif t == "Feature":
        handle_geometry(data.get("geometry"), data.get("properties"))
    elif t in ("LineString", "MultiLineString", "Point"):
        handle_geometry(data, None)
    return pts


def _looks_like_geojson(path: str) -> bool:
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            head = fh.read(2048).lstrip()
        if not head.startswith("{"):
            return False
        return ('"type"' in head and
                ('FeatureCollection' in head or 'Feature' in head or
                 'LineString' in head))
    except Exception:
        return False


# ── ISO-Zeit normalisieren ───────────────────────────────────────────────────

def _norm_iso(s: Optional[str]) -> Optional[str]:
    """'2026-06-13T08:30:00Z' / mit Offset → ISO-8601 in UTC. None bei Fehler."""
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    except Exception:
        return None


# ── Dispatch ──────────────────────────────────────────────────────────────────

def parse_points(path: str) -> List[Point]:
    ext = os.path.splitext(path)[1].lower()
    key = _DISPATCH.get(ext)
    if key is None:
        raise TrackImportError(f"Unbekanntes Track-Format: {ext}")
    if key == "sniff":
        if _looks_like_nmea(path):
            key = "nmea"
        else:
            raise TrackImportError(
                f"{ext}-Datei sieht nicht nach NMEA aus — kein Track erkannt.")
    elif key == "sniff_json":
        key = "geojson" if _looks_like_geojson(path) else None
        if key is None:
            raise TrackImportError(
                ".json sieht nicht nach GeoJSON-Track aus.")
    parser = {
        "fit": _parse_fit, "nmea": _parse_nmea, "kml": _parse_kml,
        "kmz": _parse_kmz, "tcx": _parse_tcx, "geojson": _parse_geojson,
    }[key]
    pts = parser(path)
    if not pts:
        raise TrackImportError("Keine Track-Punkte in der Datei gefunden.")
    return pts


# ── GPX schreiben ─────────────────────────────────────────────────────────────

def write_gpx(points: List[Point], out_path: str, name: str = "Track") -> str:
    gpx = gpxpy.gpx.GPX()
    gpx.creator = "Reisezoom GPS Studio"
    trk = gpxpy.gpx.GPXTrack(name=name)
    gpx.tracks.append(trk)
    seg = gpxpy.gpx.GPXTrackSegment()
    trk.segments.append(seg)
    for lat, lon, ele, tiso in points:
        t = None
        if tiso:
            try:
                t = datetime.fromisoformat(tiso.replace("Z", "+00:00"))
            except Exception:
                t = None
        seg.points.append(gpxpy.gpx.GPXTrackPoint(
            latitude=lat, longitude=lon,
            elevation=ele, time=t))
    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write(gpx.to_xml())
    return out_path


def convert_to_gpx(src_path: str, out_path: str, name: Optional[str] = None) -> str:
    pts = parse_points(src_path)
    if name is None:
        name = os.path.splitext(os.path.basename(src_path))[0]
    return write_gpx(pts, out_path, name=name)


# ── ensure_gpx: Cache-Schicht ────────────────────────────────────────────────

def _cache_name(path: str) -> str:
    try:
        st = os.stat(path)
        sig = f"{os.path.abspath(path)}:{int(st.st_mtime)}:{st.st_size}"
    except OSError:
        sig = os.path.abspath(path)
    h = hashlib.sha1(sig.encode("utf-8")).hexdigest()[:12]
    stem = re.sub(r"[^A-Za-z0-9._-]", "_",
                  os.path.splitext(os.path.basename(path))[0])[:48] or "track"
    return f"{stem}-{h}.gpx"


def ensure_gpx(path: str, cache_dir) -> str:
    """`.gpx` → unverändert zurück. Andere Formate → nach GPX konvertieren,
    im `cache_dir` cachen (Schlüssel = Pfad+mtime+size) und den GPX-Pfad
    zurückgeben. Wirft TrackImportError bei kaputten/leeren Dateien."""
    ext = os.path.splitext(path)[1].lower()
    if ext == ".gpx" or not is_convertible(path):
        return path
    cache_dir = str(cache_dir)
    os.makedirs(cache_dir, exist_ok=True)
    out = os.path.join(cache_dir, _cache_name(path))
    if os.path.exists(out):
        try:
            if os.path.getmtime(out) >= os.path.getmtime(path):
                return out
        except OSError:
            pass
    tmp = out + ".tmp"
    convert_to_gpx(path, tmp)
    os.replace(tmp, out)
    _log.info("ensure_gpx: %s → %s", path, out)
    return out
