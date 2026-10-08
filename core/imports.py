"""
Universelle Track-Import-Schicht (v0.9.282, Nutzer-Wunsch).

Idee: Andere GPS-Track-Formate werden beim Öffnen automatisch nach GPX
konvertiert, sodass die ganze App (Animator, Tour-Map, Geotagger, Höhen-
Animator) unverändert mit echten GPX-Dateien weiterarbeitet. Der Nutzer öffnet
eine `.fit`/`.nmea`/`.kml`/… einfach wie eine GPX.

Unterstützte Eingabe-Formate:
  Stufe 1: FIT (.fit) · NMEA (.nmea/.log/.txt) · KML/KMZ (.kml/.kmz)
  Stufe 2: TCX (.tcx) · GeoJSON (.geojson/.json)
  Block 5 (05.10.2026): IGC (.igc) · DJI-Drohnen-Untertitel (.srt, nur mit Positionen)

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

from core import i18n as _i18n  # 29.09.2026 — Meldungen in der App-Sprache
import hashlib
import json
import logging
import os
import re
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Tuple


import gpxpy
import gpxpy.gpx

from . import dateischutz as _ds  # 14.09.2026: jeder Datei-Eingriff geprüft + gesichert

from . import sensors as _sensors
from . import fitmeta as _fitmeta

_log = logging.getLogger("core.imports")

# (lat, lon, ele|None, time_iso|None)  — Geometrie-Punkt.
# Sensor-tragende Parser (FIT/TCX) liefern 5-Tupel mit zusätzlichem extra-Dict
# `(lat, lon, ele, time_iso, {field: value})`. `_split_rows()` trennt beides.
Point = Tuple[float, float, Optional[float], Optional[str]]


class TrackImportError(Exception):
    """Konvertierung fehlgeschlagen (unbekanntes/leeres/kaputtes Format)."""


class NoTrackPoints(TrackImportError):
    """Die Datei ist in Ordnung — sie enthält nur keine Positionen.

    Der Regelfall bei FIT: Rollentraining, Krafttraining, Bahnschwimmen. Die Uhr
    schreibt für jede Aktivität eine Datei, auch wenn nie ein Satellit im Spiel
    war — Puls und Dauer stehen drin, Koordinaten nicht.

    Das ist **kein** Fehler, und es darf im Archiv auch nicht wie einer aussehen:
    Ein Nutzer mit 61 Hallen-Einheiten bekam „61 Dateien nicht lesbar" zu sehen
    und suchte den Fehler bei sich. Aufrufer, die zwischen „kaputt" und „ohne
    Strecke" unterscheiden wollen, fangen diese Klasse getrennt ab.
    """


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
    ".igc": "igc",          # 05.10.2026 — Gleitschirm/Segelflug-Logger
    ".srt": "sniff_srt",    # 05.10.2026 — DJI-Drohnen-Telemetrie neben dem Video
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


def _fit_extra(frame) -> dict:
    """Alle numerischen Sensor-Felder einer FIT-`record`-Message → {key: float}.
    Geometrie/abgeleitete Felder werden übersprungen (FIT_SKIP); bekannte Namen
    auf kanonische Keys gemappt, unbekannte numerische Felder durchgereicht
    (= „alles lesen was da ist"). Array-/None-/bool-Werte werden ignoriert."""
    out: dict = {}
    try:
        fields = frame.fields
    except Exception:
        return out
    for fld in fields:
        try:
            name = fld.name
            val = fld.value
        except Exception:
            continue
        if not name or name in _sensors.FIT_SKIP:
            continue
        if isinstance(val, bool) or not isinstance(val, (int, float)):
            continue
        key = _sensors.FIT_FIELD_MAP.get(name, name)
        out[key] = float(val)
    return out


def _parse_fit(path: str, meta_out: Optional[dict] = None) -> List[tuple]:
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
                # v0.9.501 — Tour-Ebene (session/sport/device_info/weather)
                # im SELBEN Durchlauf einsammeln. Ein zweiter Lesevorgang
                # würde bei großen Dateien (23000 Punkte) die Importzeit
                # verdoppeln, ohne einen einzigen Wert mehr zu liefern.
                if meta_out is not None:
                    _fitmeta.sammle(frame, meta_out)
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
                        float(ele) if ele is not None else None, tiso,
                        _fit_extra(frame)))
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
            raise TrackImportError(_i18n.t_aktiv("import.err_kmz_ohne_kml", "KMZ enthält keine KML-Datei."))
        data = z.read(kml_name).decode("utf-8", errors="replace")
    return _parse_kml_string(data)


# ── TCX (Garmin Training Center, Strava-Export) ──────────────────────────────

def _parse_tcx(path: str) -> List[tuple]:
    tree = ET.parse(path)
    root = tree.getroot()
    pts: List[tuple] = []
    for tp in _iter_local(root, "trackpoint"):
        lat = lon = ele = None
        tiso = None
        extra: dict = {}
        for ch in tp.iter():
            ln = _localname(ch.tag)
            txt = (ch.text or "").strip()
            if ln == "latitudedegrees" and txt:
                lat = float(txt)
            elif ln == "longitudedegrees" and txt:
                lon = float(txt)
            elif ln == "altitudemeters" and txt:
                try:
                    ele = float(txt)
                except ValueError:
                    ele = None
            elif ln == "time" and txt:
                tiso = _norm_iso(txt)
            # Sensoren: HR (<HeartRateBpm><Value>), Trittfrequenz, Leistung (TPX:Watts)
            elif ln == "value" and txt:          # nur HR-Value im TCX-Trackpoint
                try:
                    extra["hr"] = float(txt)
                except ValueError:
                    pass
            elif ln == "cadence" and txt:
                try:
                    extra["cadence"] = float(txt)
                except ValueError:
                    pass
            elif ln == "watts" and txt:
                try:
                    extra["power"] = float(txt)
                except ValueError:
                    pass
        if lat is not None and lon is not None:
            pts.append((lat, lon, ele, tiso, extra))
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


def _parse_igc(path: str) -> List[tuple]:
    """IGC (FAI-Flugschreiber-Format, 05.10.2026, Block 5 / I-089): Gleitschirm, Drachen, Segelflug.

    H-Zeile `HFDTE` = Datum (TTMMJJ, auch `HFDTEDATE:TTMMJJ,nn`), B-Zeilen = ein Punkt:
    `B HHMMSS DDMMmmmN DDDMMmmmE A PPPPP GGGGG` (Zeit UTC, Breite/Länge in Grad+Minuten·1000, Gültigkeit A/V,
    Druckhöhe, GPS-Höhe in m). Höhe: GPS-Höhe, wenn vorhanden (≠ 0), sonst Druckhöhe; die Druckhöhe geht
    zusätzlich als Sensorwert mit. Mitternacht: läuft die Uhr rückwärts, beginnt ein neuer Tag."""
    datum = None
    rows: List[tuple] = []
    letzte_s = None
    tag_plus = 0
    with open(path, "r", encoding="ascii", errors="replace") as fh:
        for raw in fh:
            z = raw.strip()
            if z.startswith("HFDTE"):
                m = re.search(r"(\d{6})", z[5:])
                if m:
                    try:
                        datum = datetime.strptime(m.group(1), "%d%m%y").replace(tzinfo=timezone.utc)
                    except ValueError:
                        datum = None
                continue
            if not z.startswith("B") or len(z) < 35:
                continue
            try:
                hh, mi, ss = int(z[1:3]), int(z[3:5]), int(z[5:7])
                lat = int(z[7:9]) + int(z[9:14]) / 60000.0
                if z[14] == "S":
                    lat = -lat
                lon = int(z[15:18]) + int(z[18:23]) / 60000.0
                if z[23] == "W":
                    lon = -lon
                druck = int(z[25:30]) if z[25:30].strip("-").isdigit() else None
                gnss = int(z[30:35]) if z[30:35].strip("-").isdigit() else None
            except (ValueError, IndexError):
                continue
            if not (-90 <= lat <= 90 and -180 <= lon <= 180) or (lat == 0 and lon == 0):
                continue
            sek = hh * 3600 + mi * 60 + ss
            if letzte_s is not None and sek < letzte_s - 3600:
                tag_plus += 1
            letzte_s = sek
            tiso = None
            if datum is not None:
                tiso = (datum + timedelta(days=tag_plus, seconds=sek)).isoformat()
            ele = float(gnss) if gnss not in (None, 0) else (float(druck) if druck is not None else None)
            extra = {"baro_alt": float(druck)} if druck not in (None, 0) else {}
            rows.append((lat, lon, ele, tiso, extra))
    return rows


# DJI schreibt zu jedem Video eine .srt mit einem Untertitel je Bild. Drei Generationen:
#   neu (Mini 3/4, Air 3, Mavic 3): „2023-06-16 14:23:45.123 … [latitude: 47.1] [longitude: 11.2] [rel_alt: 50.3 abs_alt: 650.1]"
#   Mavic Air/Air 2:                „[latitude : 47.1] [longtitude : 11.2] [altitude: 650.1]" (ja, „longtitude")
#   alt (Phantom 4, Mavic Pro):     „2017.08.05 14:11:51 … GPS(11.2,47.1,16) BAROMETER:1.9" (Länge zuerst!)
#   Mini 2/Avata:                   „GPS (11.2, 47.1, 19), D 12.34m, H 5.60m" (H = Höhe über Start)
_SRT_ZEIT = re.compile(r"(\d{4})[-.](\d{2})[-.](\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:[.,](\d{1,6}))?")
_SRT_LAT = re.compile(r"\[\s*latitude\s*:\s*(-?\d+(?:\.\d+)?)", re.I)
_SRT_LON = re.compile(r"\[\s*long(?:t)?itude\s*:\s*(-?\d+(?:\.\d+)?)", re.I)
_SRT_ABS = re.compile(r"abs_alt\s*:\s*(-?\d+(?:\.\d+)?)", re.I)
_SRT_REL = re.compile(r"rel_alt\s*:\s*(-?\d+(?:\.\d+)?)", re.I)
_SRT_ALT = re.compile(r"\[\s*altitude\s*:\s*(-?\d+(?:\.\d+)?)", re.I)
_SRT_GPS = re.compile(r"GPS\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)(?:\s*,\s*(-?\d+(?:\.\d+)?))?\s*\)")
_SRT_BARO = re.compile(r"BAROMETER\s*:\s*(-?\d+(?:\.\d+)?)", re.I)
_SRT_H = re.compile(r"(?:^|[ ,])H\s+(-?\d+(?:\.\d+)?)\s*m", re.M)


def _looks_like_dji_srt(path: str) -> bool:
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            head = fh.read(4096)
    except OSError:
        return False
    return bool(_SRT_LAT.search(head) or _SRT_GPS.search(head))


def _parse_dji_srt(path: str) -> List[tuple]:
    """DJI-Drohnen-Untertitel (05.10.2026) → ein Punkt je Sekunde.

    Ein Block je Videobild (25–60 je Sekunde) — wir nehmen den ersten Block jeder neuen Sekunde, sonst bekäme ein
    10-min-Flug 36.000 Punkte. Zeit: DJI schreibt die Ortszeit der Fernsteuerung OHNE Zone → wird ohne Zone
    weitergegeben, der Inspektor zeigt dann „Zeit ohne Zone" (wie bei Kameras). Höhe: absolute Höhe (abs_alt/altitude),
    sonst die Höhe über dem Startpunkt — dann als Sensorwert `rel_alt`, damit niemand sie für Meereshöhe hält."""
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        text = fh.read()
    bloecke = re.split(r"\n\s*\n", text.replace("\r\n", "\n"))
    rows: List[tuple] = []
    letzte_sek = None
    ohne_zeit = 0
    for b in bloecke:
        lat = lon = None
        m1, m2 = _SRT_LAT.search(b), _SRT_LON.search(b)
        if m1 and m2:
            lat, lon = float(m1.group(1)), float(m2.group(1))
        else:
            g = _SRT_GPS.search(b)
            if g:
                lon, lat = float(g.group(1)), float(g.group(2))     # alte Modelle: Länge zuerst
        if lat is None or lon is None or (lat == 0 and lon == 0) or not (-90 <= lat <= 90 and -180 <= lon <= 180):
            continue
        tiso = None
        mz = _SRT_ZEIT.search(b)
        if mz:
            try:
                y, mo, d, hh, mi, ss = (int(mz.group(i)) for i in range(1, 7))
                frac = (mz.group(7) or "0")[:6].ljust(6, "0")
                tiso = datetime(y, mo, d, hh, mi, ss, int(frac)).isoformat()
            except ValueError:
                tiso = None
        sek = tiso[:19] if tiso else None
        if sek is not None and sek == letzte_sek:
            continue
        if sek is None:
            ohne_zeit += 1                       # ohne Zeit: jedes 30. Bild (≈ 1/s bei 30 fps)
            if (ohne_zeit - 1) % 30:
                continue
        letzte_sek = sek
        ele, extra = None, {}
        ma, mr, mal = _SRT_ABS.search(b), _SRT_REL.search(b), _SRT_ALT.search(b)
        if ma and float(ma.group(1)) != 0:
            ele = float(ma.group(1))
        elif mal and float(mal.group(1)) != 0:
            ele = float(mal.group(1))
        rel = mr.group(1) if mr else None
        if rel is None:
            mb, mh = _SRT_BARO.search(b), _SRT_H.search(b)
            rel = (mb or mh).group(1) if (mb or mh) else None
        if rel is not None:
            extra["rel_alt"] = float(rel)
        rows.append((lat, lon, ele, tiso, extra))
    return rows


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

def _parse_rows(path: str, meta_out: Optional[dict] = None) -> List[tuple]:
    """Dispatch auf den Format-Parser → rohe Rows (4- ODER 5-Tupel mit extra).

    `meta_out` (optional) nimmt die Tour-Ebene auf. Nur FIT füllt sie; die
    anderen Formate kennen nichts Vergleichbares.
    """
    ext = os.path.splitext(path)[1].lower()
    key = _DISPATCH.get(ext)
    if key is None:
        raise TrackImportError(_i18n.t_aktiv("import.err_format", "Unbekanntes Track-Format: ") + str(ext))
    if key == "sniff":
        if _looks_like_nmea(path):
            key = "nmea"
        else:
            # ⚠️ library.fehler_grund erkennt diesen Satz wieder (alle Sprachen)
            raise TrackImportError(_i18n.t_aktiv(
                "import.err_kein_nmea", "{ext}-Datei sieht nicht nach NMEA aus — kein Track erkannt.").replace("{ext}", str(ext)))
    elif key == "sniff_srt":
        if _looks_like_dji_srt(path):
            key = "dji_srt"
        else:
            # ⚠️ library.fehler_grund erkennt diesen Satz wieder (alle Sprachen) — normale Film-Untertitel
            raise TrackImportError(_i18n.t_aktiv(
                "import.err_kein_dji", ".srt sieht nicht nach DJI-Drohnendaten aus — kein Track erkannt."))
    elif key == "sniff_json":
        key = "geojson" if _looks_like_geojson(path) else None
        if key is None:
            raise TrackImportError(_i18n.t_aktiv(
                "import.err_kein_geojson", ".json sieht nicht nach GeoJSON-Track aus."))
    parser = {
        "fit": _parse_fit, "nmea": _parse_nmea, "kml": _parse_kml,
        "kmz": _parse_kmz, "tcx": _parse_tcx, "geojson": _parse_geojson, "igc": _parse_igc,
        "dji_srt": _parse_dji_srt,
    }[key]
    rows = parser(path, meta_out) if key == "fit" else parser(path)
    if not rows:
        # Gelesen werden konnte die Datei — sie hat nur keine Positionen.
        raise NoTrackPoints(_i18n.t_aktiv("import.err_keine_punkte", "Keine Track-Punkte in der Datei gefunden."))
    return rows


def _split_rows(rows: List[tuple]) -> tuple[List[Point], List[dict]]:
    """Rows (4-/5-Tupel) → (Geometrie-4-Tupel, Liste der extra-Dicts)."""
    pts: List[Point] = []
    extras: List[dict] = []
    for r in rows:
        pts.append((r[0], r[1], r[2], r[3]))
        extras.append(r[4] if len(r) >= 5 and isinstance(r[4], dict) else {})
    return pts, extras


def parse_points(path: str) -> List[Point]:
    """Nur Geometrie (lat,lon,ele,time) — rückwärtskompatibel."""
    return _split_rows(_parse_rows(path))[0]


def parse_track(path: str, meta_out: Optional[dict] = None) -> tuple[List[Point], List[dict]]:
    """Geometrie + Sensor-extras pro Punkt (für die Sidecar-Erzeugung).

    `meta_out` wird — falls übergeben — mit der Tour-Ebene gefüllt (nur FIT).
    """
    return _split_rows(_parse_rows(path, meta_out))


# ── GPX schreiben ─────────────────────────────────────────────────────────────

def _gpx_xml_gpxpy(points: List[Point], name) -> str:
    gpx = gpxpy.gpx.GPX()
    gpx.creator = "Reisezoom GPS Studio"
    trk = gpxpy.gpx.GPXTrack(name=name)
    gpx.tracks.append(trk)
    seg = gpxpy.gpx.GPXTrackSegment()
    trk.segments.append(seg)
    for row in points:
        lat, lon, ele, tiso = row[0], row[1], row[2], row[3]
        t = None
        if tiso:
            try:
                t = datetime.fromisoformat(tiso.replace("Z", "+00:00"))
            except Exception:
                t = None
        seg.points.append(gpxpy.gpx.GPXTrackPoint(
            latitude=lat, longitude=lon,
            elevation=ele, time=t))
    return gpx.to_xml()


# 14.09.2026 (Nacht-Review): gpxpy serialisiert jeden Punkt über seine generische
# Feld-Reflexion — 150 000 Punkte = 2,7 s nur fürs Schreiben des Import-Caches.
# Der Rahmen (Kopf, Track, Name) kommt weiter aus gpxpy (leeres Segment); die
# Punkte werden in genau dem Format eingesetzt, das gpxpy 1.6.2 schreibt
# (`make_str` für Zahlen, `format_time` für Zeiten). Ungewöhnliche Werte →
# gpxpy wie bisher. Wächter: tests/test_write_gpx_gleich.py (bytegleich).
_GPXPY_GEPRUEFT = "1.6.2"


def _gpx_xml_schnell(points: List[Point], name) -> Optional[str]:
    if gpxpy.__version__ != _GPXPY_GEPRUEFT:
        return None
    from gpxpy import utils as _gu
    from gpxpy.gpxfield import format_time as _ft
    rahmen = _gpx_xml_gpxpy([], name)
    marke = "<trkseg>"
    if rahmen.count(marke) != 1:
        return None
    teile = []
    anhaengen = teile.append
    ms = _gu.make_str
    for row in points:
        # wie GPXTrackPoint.__init__: `latitude or 0` (0.0 und None werden zu „0")
        lat, lon, ele, tiso = row[0] or 0, row[1] or 0, row[2], row[3]
        if (type(lat) not in (float, int) or type(lon) not in (float, int)
                or (ele is not None and type(ele) not in (float, int))):
            return None
        anhaengen(f'\n      <trkpt lat="{ms(lat)}" lon="{ms(lon)}">')
        if ele is not None:
            anhaengen(f"\n        <ele>{ms(ele)}</ele>")
        if tiso:
            try:
                t = datetime.fromisoformat(tiso.replace("Z", "+00:00"))
            except Exception:
                t = None
            if t is not None:
                anhaengen(f"\n        <time>{_ft(t)}</time>")
        anhaengen("\n      </trkpt>")
    k = rahmen.index(marke) + len(marke)
    return rahmen[:k] + "".join(teile) + rahmen[k:]


def write_gpx(points: List[Point], out_path: str, name: str = "Track") -> str:
    xml = None
    try:
        xml = _gpx_xml_schnell(points, name)
    except Exception:  # noqa: BLE001 — im Zweifel wie bisher über gpxpy
        xml = None
    if xml is None:
        xml = _gpx_xml_gpxpy(points, name)
    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write(xml)
    return out_path


def _sidecar_for(gpx_path: str) -> str:
    base = gpx_path[:-4] if gpx_path.lower().endswith(".gpx") else gpx_path
    return base + ".sensors.json"


def write_sidecar(extras: List[dict], gpx_path: str,
                  tour: Optional[dict] = None) -> Optional[str]:
    """Schreibt `<gpx>.sensors.json` (Variante B) mit index-gleichen Sensor-
    Reihen. Tut nichts (gibt None zurück), wenn weder Sensoren noch Tour-Ebene
    vorkommen.

    v0.9.501 — `tour` ist die Tour-Ebene aus FIT (session/sport/device_info/
    weather). Sie gehört in dieselbe Datei, weil sie dasselbe Problem hat: die
    Umwandlung nach GPX wirft sie sonst weg, und GPX hat für „Ø-Puls dieser
    Tour" keinen Platz.
    """
    keys = set()
    for e in extras:
        keys.update(e.keys())
    if not keys and tour is None:
        return None
    n = len(extras)
    values = {k: [extras[i].get(k) for i in range(n)] for k in keys}
    data = {"fields": _sensors.describe_fields(keys), "values": values}
    if tour is not None:
        # Auch ein LEERER Tour-Block wird geschrieben: der Schlüssel selbst ist
        # die Auskunft „diese Sidecar stammt aus einer Version, die die
        # Tour-Ebene kennt". Ohne ihn wüsste `ensure_gpx` nicht, ob eine Datei
        # nichts hergibt oder nur alt gecacht ist — und würde sie bei jedem
        # Einlesen erneut umwandeln.
        data["tour"] = tour
    sc = _sidecar_for(gpx_path)
    with open(sc, "w", encoding="utf-8") as fh:
        json.dump(data, fh)
    return sc


def convert_to_gpx(src_path: str, out_path: str, name: Optional[str] = None) -> str:
    """Konvertiert nach GPX (Geometrie). Schreibt KEINE Sidecar — die
    sensor-bewusste Cache-Schicht ist `ensure_gpx` (atomisches GPX + Sidecar)."""
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


def _cache_veraltet(gpx_out: str, ext: str) -> bool:
    """Stammt der GPX-Cache aus der Zeit vor der Tour-Ebene (v0.9.501)?

    Betrifft nur FIT. Wer sein Archiv vorher eingelesen hat, hat einen gültigen
    GPX-Cache — und der würde ohne diese Prüfung nie wieder angefasst. Die
    Tour-Ebene (Ø-Puls, Sportart, Gerät) bliebe für ein bestehendes Archiv
    dauerhaft leer, und die Fortbewegungsart käme weiter aus dem Dateinamen.

    Erkennungsmerkmal ist der `tour`-Schlüssel in der Sidecar, den seit v0.9.501
    JEDE aus FIT erzeugte Sidecar trägt — auch wenn er leer ist. Fehlt er, ist
    der Cache alt und wird einmalig neu gebaut; danach greift er wieder normal.
    """
    if ext != ".fit":
        return False
    sc = _sidecar_for(gpx_out)
    if not os.path.exists(sc):
        return True
    try:
        with open(sc, "r", encoding="utf-8") as fh:
            return "tour" not in json.load(fh)
    except Exception:
        return True     # unlesbar → lieber neu bauen als raten


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
    if os.path.exists(out) and not _cache_veraltet(out, ext):
        try:
            if os.path.getmtime(out) >= os.path.getmtime(path):
                return out
        except OSError:
            pass
    # v0.9.330 — Geometrie atomisch als GPX + Sensoren als Sidecar (Variante B).
    # v0.9.501 — dazu die Tour-Ebene, aber nur FIT liefert so etwas. Bei allen
    # anderen Formaten bleibt `tour` None, damit kein leerer Block entsteht,
    # der `_cache_veraltet` durcheinanderbrächte.
    tour: Optional[dict] = {} if ext == ".fit" else None
    pts, extras = parse_track(path, tour)
    if not pts:
        raise NoTrackPoints(_i18n.t_aktiv("import.err_keine_punkte", "Keine Track-Punkte in der Datei gefunden."))
    name = os.path.splitext(os.path.basename(path))[0]
    tmp = out + ".tmp"
    write_gpx(pts, tmp, name=name)
    _ds.ersetzen(tmp, out, "import_umwandeln", art=_ds.ART_CACHE)   # Cache-GPX, neu erzeugbar
    sc = write_sidecar(extras, out, tour)
    _log.info("ensure_gpx: %s → %s%s", path, out, " (+sensors)" if sc else "")
    return out
