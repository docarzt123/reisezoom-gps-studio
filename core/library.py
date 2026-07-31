"""
Tour-Archiv (Katalog) — v0.9.486

Was das ist: ein durchsuchbarer Index über *alle* Track-Dateien, die auf dem
Rechner liegen. Der Nutzer sagt einmal, welche Ordner beobachtet werden; die App
liest sie ein und weiß danach zu jeder Tour Datum, Strecke, Höhenmeter, Dauer,
Gegend und Vorschaubild — ohne die Dateien erneut zu öffnen.

Warum SQLite und nicht JSON: 700 Touren sind heute normal, 5000 morgen. Eine
JSON-Datei müsste dafür bei jedem Filterklick komplett gelesen und im Speicher
durchsucht werden. SQLite filtert und sortiert das im Millisekundenbereich, ist
in Python eingebaut (keine neue Abhängigkeit, PyInstaller-freundlich) und
überlebt einen Absturz mitten im Schreiben.

Abgrenzung zu `core/sessions.py`:
  Archiv   = welche Touren gibt es (Datei-Ebene, viele, read-only Metadaten)
  Sessions = woran habe ich gearbeitet (Projekte/Einstellungen pro Track)
Verbunden sind beide über `track_hash` — exakt derselbe Hash wie in
`sessions.compute_track_hash(coords, name=Dateiname)`. Dadurch kann das Archiv
anzeigen „an dieser Tour hast du schon gearbeitet" und direkt dorthin springen.

Zwei Hashes pro Tour, das ist Absicht:
  track_hash  – mit Dateiname, verbindet zur Session (siehe oben)
  geo_hash    – nur Koordinaten, findet dieselbe Tour unter anderem Dateinamen
                (Komoot-Exporte doppeln sich gern) und benennt das Vorschaubild

Öffentliche API:
  open_db(path)                      – Verbindung + Schema (idempotent)
  get_folders / add_folder / remove_folder
  scan(...)                          – Ordner einlesen (inkrementell)
  query(...)                         – filtern/sortieren/suchen
  stats(...)                         – Summen für die Kopfzeile
  get_track(path) / set_user_fields(...) / duplicates(...) / forget(...)
"""
from __future__ import annotations

import json
import logging
import os
import re
import sqlite3
import statistics
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Iterable, Optional

from . import gpx as cgpx
from .gpx import _haversine_m
from . import imports as cimports
from . import sessions as csessions

log = logging.getLogger(__name__)

SCHEMA_VERSION = 1

# Welche Dateien eingelesen werden. GPX direkt, der Rest über die
# Import-Schicht (FIT/NMEA/KML/KMZ/TCX/GeoJSON → GPX im Cache).
INDEX_EXTS = {".gpx"} | set(cimports.IMPORT_EXTS)

# Ordner, die beim Einlesen übersprungen werden — dort liegen App-interne
# Kopien, die sonst als Dubletten der echten Touren auftauchen.
SKIP_DIR_NAMES = {
    "sessions",          # GPX-Schnappschüsse der App
    "_imports",          # konvertierte Fremdformate
    "_renders",
    "node_modules",
    ".git",
}

THUMB_W, THUMB_H = 360, 200


# ── Datenbank ────────────────────────────────────────────────────────────────

_SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS folders (
    path       TEXT PRIMARY KEY,
    added_at   TEXT,
    recursive  INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tracks (
    path          TEXT PRIMARY KEY,
    folder        TEXT,
    filename      TEXT,
    mtime         REAL,
    size          INTEGER,

    track_hash    TEXT,
    geo_hash      TEXT,

    name          TEXT,
    started_at    TEXT,
    ended_at      TEXT,
    year          INTEGER,

    distance_m    REAL,
    duration_s    REAL,
    moving_time_s REAL,
    ascent_m      REAL,
    descent_m     REAL,
    ele_min       REAL,
    ele_max       REAL,
    max_speed_kmh REAL,
    avg_speed_kmh REAL,

    n_points      INTEGER,
    n_segments    INTEGER,
    has_time      INTEGER,
    has_ele       INTEGER,
    sensors       TEXT,

    min_lat REAL, max_lat REAL, min_lon REAL, max_lon REAL,
    center_lat REAL, center_lon REAL,

    activity      TEXT,
    source        TEXT,
    source_url    TEXT,
    planned       INTEGER DEFAULT 0,

    place         TEXT DEFAULT '',
    country       TEXT DEFAULT '',
    region        TEXT DEFAULT '',

    thumb         TEXT DEFAULT '',
    -- v0.9.487: vereinfachter Streckenverlauf als JSON [[lon,lat],…] (max 80
    -- Punkte, 5 Nachkommastellen). Reicht für die Übersichtskarte über alle
    -- Touren und fürs Karten-Vorschaubild — die volle Datei dafür zu öffnen
    -- wäre bei 700 Touren undenkbar.
    geom          TEXT DEFAULT '',
    -- v0.9.487: gecachtes Karten-Vorschaubild (Mapbox Static Images, einmal
    -- geladen, danach lokal) und ein selbst gewähltes Bild.
    map_thumb     TEXT DEFAULT '',
    indexed_at    TEXT,
    error         TEXT DEFAULT '',

    -- v0.9.489: gemacht (aufgezeichnet) oder nur geplant — generisch erkannt,
    -- `recorded_src` sagt woran. `recorded_user` ist die Hand-Korrektur des
    -- Nutzers (NULL = automatisch) und zählt zu den Nutzer-Eingaben.
    recorded      INTEGER DEFAULT 1,
    recorded_src  TEXT DEFAULT '',

    -- Nutzer-Eingaben. Werden beim Neu-Einlesen NICHT überschrieben.
    fav           INTEGER DEFAULT 0,
    tags          TEXT DEFAULT '',
    note          TEXT DEFAULT '',
    cover         TEXT DEFAULT '',
    recorded_user INTEGER DEFAULT NULL
);

-- v0.9.489: Sammlungen — mehrere Touren als eine Einheit (Mehrtagestour,
-- Reise, Themenserie). Eine Tour darf in beliebig vielen Sammlungen liegen.
CREATE TABLE IF NOT EXISTS collections (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    note       TEXT DEFAULT '',
    created_at TEXT
);

CREATE TABLE IF NOT EXISTS collection_items (
    collection_id INTEGER NOT NULL,
    path          TEXT NOT NULL,
    sort_index    INTEGER DEFAULT 0,
    PRIMARY KEY (collection_id, path)
);

CREATE INDEX IF NOT EXISTS idx_colitems_col ON collection_items(collection_id);

CREATE INDEX IF NOT EXISTS idx_tracks_started ON tracks(started_at);
CREATE INDEX IF NOT EXISTS idx_tracks_dist    ON tracks(distance_m);
CREATE INDEX IF NOT EXISTS idx_tracks_geo     ON tracks(geo_hash);
CREATE INDEX IF NOT EXISTS idx_tracks_hash    ON tracks(track_hash);
CREATE INDEX IF NOT EXISTS idx_tracks_folder  ON tracks(folder);
"""

# Spalten, die beim Neu-Einlesen aktualisiert werden (alles außer den
# Nutzer-Eingaben fav/tags/note).
_TECH_COLS = [
    "folder", "filename", "mtime", "size", "track_hash", "geo_hash", "name",
    "started_at", "ended_at", "year", "distance_m", "duration_s",
    "moving_time_s", "ascent_m", "descent_m", "ele_min", "ele_max",
    "max_speed_kmh", "avg_speed_kmh", "n_points", "n_segments", "has_time",
    "has_ele", "sensors", "min_lat", "max_lat", "min_lon", "max_lon",
    "center_lat", "center_lon", "activity", "source", "source_url", "planned",
    "recorded", "recorded_src", "thumb", "geom", "indexed_at", "error",
]

# Spalten, die eine ältere Datenbank noch nicht hat. Beim Öffnen nachgezogen —
# eine bestehende Sammlung soll nicht neu aufgebaut werden müssen.
_ADD_COLS = [
    ("geom", "TEXT DEFAULT ''"),
    ("map_thumb", "TEXT DEFAULT ''"),
    ("cover", "TEXT DEFAULT ''"),
    ("recorded", "INTEGER DEFAULT 1"),
    ("recorded_src", "TEXT DEFAULT ''"),
    ("recorded_user", "INTEGER DEFAULT NULL"),
]


def open_db(db_path: Path) -> sqlite3.Connection:
    """Öffnet (und erstellt) die Archiv-Datenbank."""
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.executescript(_SCHEMA)
    have = {r["name"] for r in conn.execute("PRAGMA table_info(tracks)").fetchall()}
    for col, decl in _ADD_COLS:
        if col not in have:
            conn.execute(f"ALTER TABLE tracks ADD COLUMN {col} {decl}")
            log.info("library: Spalte %s nachgetragen", col)
    conn.execute(
        "INSERT INTO meta(key, value) VALUES('schema', ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (str(SCHEMA_VERSION),),
    )
    conn.commit()
    return conn


# ── Beobachtete Ordner ───────────────────────────────────────────────────────

def get_folders(conn: sqlite3.Connection) -> list:
    rows = conn.execute(
        "SELECT path, added_at, recursive FROM folders ORDER BY path"
    ).fetchall()
    out = []
    for r in rows:
        p = Path(r["path"])
        out.append({
            "path": r["path"],
            "added_at": r["added_at"] or "",
            "recursive": bool(r["recursive"]),
            "exists": p.is_dir(),
            "n_tracks": conn.execute(
                "SELECT COUNT(*) FROM tracks WHERE folder = ?", (r["path"],)
            ).fetchone()[0],
        })
    return out


def add_folder(conn: sqlite3.Connection, path: str, recursive: bool = True) -> bool:
    p = str(Path(path).expanduser().resolve())
    if not Path(p).is_dir():
        return False
    conn.execute(
        "INSERT INTO folders(path, added_at, recursive) VALUES(?,?,?) "
        "ON CONFLICT(path) DO UPDATE SET recursive=excluded.recursive",
        (p, _now_iso(), 1 if recursive else 0),
    )
    conn.commit()
    return True


def remove_folder(conn: sqlite3.Connection, path: str, drop_tracks: bool = True) -> None:
    p = str(Path(path).expanduser().resolve())
    conn.execute("DELETE FROM folders WHERE path = ?", (p,))
    if drop_tracks:
        conn.execute("DELETE FROM tracks WHERE folder = ?", (p,))
    conn.commit()


# ── Einlesen ─────────────────────────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _iter_files(folder: str, recursive: bool) -> Iterable[Path]:
    base = Path(folder)
    if not base.is_dir():
        return
    if recursive:
        for root, dirs, files in os.walk(base):
            dirs[:] = [d for d in dirs if d not in SKIP_DIR_NAMES and not d.startswith(".")]
            for f in files:
                if Path(f).suffix.lower() in INDEX_EXTS and not f.startswith("."):
                    yield Path(root) / f
    else:
        for f in sorted(base.iterdir()):
            if f.is_file() and f.suffix.lower() in INDEX_EXTS and not f.name.startswith("."):
                yield f


_KOMOOT_RE = re.compile(r"komoot\.[a-z]{2,3}/tour/(\d+)", re.I)
_CREATOR_RE = re.compile(r'creator="([^"]{1,60})"', re.I)


def _peek_source(path: Path) -> tuple:
    """Herkunft aus dem Dateikopf: (source, source_url). Billig, nur 4 KB."""
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            head = fh.read(4096)
    except OSError:
        return "", ""
    m = _KOMOOT_RE.search(head)
    if m:
        return "komoot", f"https://www.komoot.de/tour/{m.group(1)}"
    c = _CREATOR_RE.search(head)
    return ((c.group(1).strip() if c else ""), "")


# Aufzeichnende Apps schreiben die Sportart meist in den Tour-Namen — Komoot
# nennt eine mitgeschnittene Radtour schlicht „Fahrradtour 10.06.2020". Das ist
# die weit verlässlichere Quelle als das Durchschnittstempo, denn eine gemütliche
# Radtour mit Pausen liegt bei 10 km/h und wäre sonst „Laufen".
_ACT_WORDS = [
    ("mtb",         ("mountainbike", "mountain bike", "mtb", "trail ride")),
    ("rennrad",     ("rennrad", "road cycling", "road bike")),
    ("rad",         ("fahrrad", "radtour", "radfahren", "bike ride", "cycling",
                     "e-bike", "ebike", "bicicleta", "ciclismo")),
    ("laufen",      ("laufen", "joggen", "running", "run ", "lauf ", "correr")),
    ("wandern",     ("wanderung", "wandern", "hike", "hiking", "senderismo",
                     "bergtour", "trekking")),
    ("spaziergang", ("spaziergang", "walk", "gassi", "paseo")),
    ("motorrad",    ("motorrad", "motorcycle", "moto ")),
    ("auto",        ("autofahrt", "roadtrip", "road trip", "wohnmobil", "camper")),
    ("boot",        ("kajak", "kanu", "paddel", "boot", "kayak", "sup ", "segeln")),
    ("ski",         ("ski", "langlauf", "skitour", "schneeschuh", "snowboard")),
]


def _guess_activity(name: str, distance_m: float, moving_s: float) -> str:
    """Einordnung der Fortbewegungsart: erst am Namen, sonst am Tempo.

    Bewusst grob: das ist ein Vorschlag zum Filtern, keine Wahrheit. Wer es
    genauer braucht, vergibt ein eigenes Schlagwort — das schlägt die Schätzung.
    """
    kmh = (distance_m / 1000.0) / (moving_s / 3600.0) if (moving_s > 0 and distance_m > 0) else 0.0
    low = _norm(name)
    for key, words in _ACT_WORDS:
        if any(w in low for w in words):
            # Der Name gewinnt — außer er widerspricht dem Tempo eindeutig.
            # Komoot nennt jede Aufzeichnung erst mal „Wanderung"; 175 km mit
            # 27 km/h sind aber sicher keine.
            if key in ("wandern", "spaziergang", "laufen") and kmh > 12:
                break
            return key
    if kmh <= 0:
        return ""
    if kmh < 2.5:
        return "spaziergang"
    if kmh < 7:
        return "wandern"
    if kmh < 12:
        return "laufen"
    if kmh < 28:
        return "rad"
    if kmh < 55:
        return "motorrad"
    return "auto"


# ── Gemacht oder nur geplant? ────────────────────────────────────────────────
#
# Anfangs hing das allein an Komoots „(Completed)" im Tour-Namen — das ist für
# jede andere Quelle wertlos. Diese Erkennung kommt ohne aus und stützt sich
# darauf, wie eine Aufzeichnung tatsächlich aussieht:
#
#   * Sensoren (Puls, Trittfrequenz, Leistung, Temperatur) gibt es nur beim
#     Mitschneiden — das ist ein Beweis, keine Schätzung.
#   * Eine Aufzeichnung hat **unregelmäßige Zeitabstände** (Pausen, Ampeln,
#     GPS-Aussetzer) und **schwankendes Tempo**. Eine geplante Route bekommt
#     ihre Zeiten aus einer Modellgeschwindigkeit — sie läuft gleichmäßig durch.
#   * Ohne Zeitstempel kann es keine Aufzeichnung sein.
#
# Die Schwellen sind an Marcs 709 Komoot-Touren gemessen (Stichprobe 160,
# je zur Hälfte gemacht/geplant): Zeitabstands-Streuung im Median 2,75 (gemacht)
# gegen 1,03 (geplant), Tempo-Streuung 0,37 gegen 0,13. Die Regel unten trifft
# damit rund **87 %** — gut genug als Voreinstellung, aber eben eine Schätzung.
# Deshalb kann sie pro Tour von Hand überschrieben werden (`recorded_user`), und
# die Quelle steht in `recorded_src`, damit man sieht, worauf sie beruht.

RECORDED_DT_CV = 1.6      # Streuung der Zeitabstände
RECORDED_SPEED_CV = 0.30  # Streuung der Geschwindigkeit


def _recorded_guess(pts: list, stats, name: str) -> tuple:
    """(gemacht: bool, quelle: str)"""
    if getattr(stats, "sensor_fields", None):
        return True, "sensors"

    low = _norm(name)
    # Ausdrückliche Kennzeichnungen verschiedener Anbieter.
    if any(w in low for w in ("(completed)", "completed", "aufgezeichnet",
                              "recorded", "activity", "aktivitat")):
        return True, "name"
    if any(w in low for w in ("geplant", "planned", "route planung", "planung")):
        return False, "name"

    times = [p.time for p in pts if p.time]
    if len(times) < 10:
        return False, "notime"

    from datetime import datetime
    try:
        T = [datetime.fromisoformat(t.replace("Z", "+00:00")).timestamp() for t in times]
    except ValueError:
        return False, "notime"

    tp = [p for p in pts if p.time]
    dts, sp = [], []
    for a, ta, b, tb in zip(tp, T, tp[1:], T[1:]):
        dt = tb - ta
        if dt <= 0:
            continue
        dts.append(dt)
        sp.append(_haversine_m(a.lat, a.lon, b.lat, b.lon) / dt)
    if len(dts) < 5:
        return False, "notime"

    mean_dt = sum(dts) / len(dts)
    mean_sp = sum(sp) / len(sp)
    dt_cv = (statistics.pstdev(dts) / mean_dt) if mean_dt else 0.0
    sp_cv = (statistics.pstdev(sp) / mean_sp) if mean_sp else 0.0
    if dt_cv >= RECORDED_DT_CV or sp_cv >= RECORDED_SPEED_CV:
        return True, "rhythm"
    return False, "rhythm"


GEOM_MAX_POINTS = 80


def _simplify(coords: list, target: int = GEOM_MAX_POINTS) -> list:
    """Gleichmäßig ausgedünnter Streckenverlauf, gerundet auf ~1 m.

    Bewusst simpel (jeden n-ten Punkt) statt Douglas-Peucker: für eine
    Übersichtskarte über hunderte Touren zählt die grobe Form, und der
    Rechenaufwand liegt bei 700 Dateien im Einlesen, nicht in der Genauigkeit.
    """
    if not coords:
        return []
    if len(coords) <= target:
        pts = list(coords)
    else:
        step = len(coords) / float(target)
        pts = [coords[min(len(coords) - 1, int(i * step))] for i in range(target)]
        pts.append(coords[-1])
    return [[round(float(c[0]), 5), round(float(c[1]), 5)] for c in pts]


def _make_thumb(coords: list, out_path: Path) -> bool:
    """Kleines Vorschaubild des Streckenverlaufs — ohne Karte, ohne Netz.

    Der Linienzug allein reicht zum Wiedererkennen und kostet nichts: keine
    Kachel-Downloads, kein Mapbox-Kontingent, funktioniert offline. Eine echte
    Karte im Hintergrund wäre schöner, ist aber bei 700 Touren weder schnell
    noch kostenlos.
    """
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        return False
    pts = [(float(c[0]), float(c[1])) for c in coords if c]
    if len(pts) < 2:
        return False

    lons = [p[0] for p in pts]
    lats = [p[1] for p in pts]
    import math
    lat0 = math.radians(sum(lats) / len(lats))
    # Längengrade auf Breitengrad-Maßstab bringen, sonst ist die Tour
    # in Nord-Süd-Richtung gestaucht (Web-Mercator im Kleinen).
    xs = [lo * math.cos(lat0) for lo in lons]
    ys = [-la for la in lats]

    pad = 12
    w, h = THUMB_W, THUMB_H
    spanx = max(1e-9, max(xs) - min(xs))
    spany = max(1e-9, max(ys) - min(ys))
    scale = min((w - 2 * pad) / spanx, (h - 2 * pad) / spany)
    offx = (w - spanx * scale) / 2 - min(xs) * scale
    offy = (h - spany * scale) / 2 - min(ys) * scale
    line = [(x * scale + offx, y * scale + offy) for x, y in zip(xs, ys)]

    # Zu viele Punkte machen das Bild nicht besser, nur das Zeichnen langsam.
    if len(line) > 1200:
        step = len(line) / 1200.0
        line = [line[int(i * step)] for i in range(1200)]

    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.line(line, fill=(0, 0, 0, 90), width=5, joint="curve")        # Schatten
    d.line(line, fill=(255, 122, 0, 255), width=3, joint="curve")   # Track
    r = 4
    d.ellipse([line[0][0] - r, line[0][1] - r, line[0][0] + r, line[0][1] + r],
              fill=(46, 204, 113, 255))
    d.ellipse([line[-1][0] - r, line[-1][1] - r, line[-1][0] + r, line[-1][1] + r],
              fill=(231, 76, 60, 255))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path, "PNG")
    return True


def _row_from_file(path: Path, folder: str, thumbs_dir: Path, import_cache: Path) -> dict:
    """Liest eine Track-Datei und baut die Datenbank-Zeile."""
    st = path.stat()
    row = {
        "path": str(path),
        "folder": folder,
        "filename": path.name,
        "mtime": st.st_mtime,
        "size": st.st_size,
        "indexed_at": _now_iso(),
        "error": "",
    }
    gpx_path = str(path)
    if path.suffix.lower() != ".gpx":
        gpx_path = cimports.ensure_gpx(str(path), import_cache)

    pts, stats = cgpx.parse_gpx(gpx_path)
    coords = [(p.lon, p.lat) for p in pts]
    times = [p.time for p in pts if p.time]

    dur = float(stats.duration_s or 0.0)
    moving = float(stats.moving_time_s or 0.0) or dur
    dist = float(stats.distance_m or 0.0)
    src, src_url = _peek_source(path)
    name = (stats.name or path.stem).strip()
    _rec, _rec_src = _recorded_guess(pts, stats, name)

    row.update({
        # Der Session-Hash MUSS genauso gebildet werden wie beim Öffnen eines
        # Tracks in app.py (Dateiname fließt ein) — sonst findet das Archiv die
        # bestehenden Projekte nicht wieder.
        "track_hash": csessions.compute_track_hash(coords, name=path.name),
        "geo_hash": csessions.compute_track_hash(coords),
        "name": name,
        "started_at": times[0] if times else "",
        "ended_at": times[-1] if times else "",
        "year": int(times[0][:4]) if times and times[0][:4].isdigit() else 0,
        "distance_m": dist,
        "duration_s": dur,
        "moving_time_s": moving,
        "ascent_m": float(stats.ascent_m or 0.0),
        "descent_m": float(stats.descent_m or 0.0),
        "ele_min": stats.ele_min,
        "ele_max": stats.ele_max,
        "max_speed_kmh": float(stats.max_speed_kmh or 0.0),
        "avg_speed_kmh": (dist / 1000.0) / (moving / 3600.0) if moving > 0 else 0.0,
        "n_points": int(stats.n_points or 0),
        "n_segments": int(stats.n_segments or 1),
        "has_time": 1 if times else 0,
        "has_ele": 1 if any(p.ele is not None for p in pts) else 0,
        "sensors": json.dumps([f.get("key") for f in (stats.sensor_fields or [])]),
        "min_lat": (stats.bbox or {}).get("min_lat"),
        "max_lat": (stats.bbox or {}).get("max_lat"),
        "min_lon": (stats.bbox or {}).get("min_lon"),
        "max_lon": (stats.bbox or {}).get("max_lon"),
        "center_lat": sum(p.lat for p in pts) / len(pts) if pts else None,
        "center_lon": sum(p.lon for p in pts) / len(pts) if pts else None,
        "activity": _guess_activity(name, dist, moving),
        "source": src,
        "source_url": src_url,
        "planned": 0 if _rec else 1,     # Altfeld, bleibt der Kehrwert
        "recorded": 1 if _rec else 0,
        "recorded_src": _rec_src,
        "geom": json.dumps(_simplify(coords), separators=(",", ":")),
    })

    thumb = thumbs_dir / f"{row['geo_hash']}.png"
    if not thumb.exists():
        try:
            _make_thumb(coords, thumb)
        except Exception as e:      # ein kaputtes Bild darf den Index nicht kippen
            log.warning("library: Vorschaubild fehlgeschlagen für %s: %s", path.name, e)
    row["thumb"] = str(thumb) if thumb.exists() else ""
    return row


def scan(
    conn: sqlite3.Connection,
    thumbs_dir: Path,
    import_cache: Path,
    folders: Optional[list] = None,
    force: bool = False,
    progress: Optional[Callable[[dict], None]] = None,
    should_stop: Optional[Callable[[], bool]] = None,
) -> dict:
    """Liest die beobachteten Ordner ein.

    Inkrementell: eine Datei wird nur neu gelesen, wenn Änderungszeit oder Größe
    abweichen (`force=True` liest alles neu). Ein Fehler in einer Datei wird in
    der Zeile vermerkt und übersprungen — ein einzelnes kaputtes GPX darf nie
    den ganzen Durchlauf abbrechen.
    """
    thumbs_dir = Path(thumbs_dir)
    import_cache = Path(import_cache)
    watch = folders if folders is not None else [f["path"] for f in get_folders(conn)]
    rec = {f["path"]: f["recursive"] for f in get_folders(conn)}

    files: list = []
    for folder in watch:
        for p in _iter_files(folder, rec.get(folder, True)):
            files.append((p, folder))

    # `geom` und die Gemacht/Geplant-Bewertung fehlen bei Einträgen aus einer
    # älteren Version. Solche Zeilen werden neu gelesen, auch wenn die Datei
    # unverändert ist — sonst bliebe die Übersichtskarte für die halbe Sammlung
    # leer und der Filter „Nur gemachte" liefe auf Voreinstellungen.
    known = {
        r["path"]: (r["mtime"], r["size"], bool(r["geom"]) and bool(r["recorded_src"]))
        for r in conn.execute(
            "SELECT path, mtime, size, geom, recorded_src FROM tracks").fetchall()
    }
    seen = set()
    added = updated = skipped = failed = 0
    total = len(files)

    for i, (p, folder) in enumerate(files):
        if should_stop and should_stop():
            break
        sp = str(p)
        seen.add(sp)
        try:
            st = p.stat()
            old = known.get(sp)
            if (old and old[2] and not force
                    and abs(old[0] - st.st_mtime) < 1 and old[1] == st.st_size):
                skipped += 1
            else:
                row = _row_from_file(p, folder, thumbs_dir, import_cache)
                _upsert(conn, row)
                if old:
                    updated += 1
                else:
                    added += 1
        except Exception as e:
            failed += 1
            log.warning("library: %s konnte nicht gelesen werden: %s", p.name, e)
            try:
                _upsert(conn, {
                    "path": sp, "folder": folder, "filename": p.name,
                    "mtime": 0, "size": 0, "indexed_at": _now_iso(),
                    "error": str(e)[:300], "name": p.stem,
                })
            except Exception:
                pass
        if progress and (i % 10 == 0 or i == total - 1):
            progress({"done": i + 1, "total": total, "added": added,
                      "updated": updated, "skipped": skipped, "failed": failed,
                      "current": p.name})
        if i % 50 == 0:
            conn.commit()

    # Dateien, die es nicht mehr gibt, fliegen raus — aber nur aus den
    # Ordnern, die gerade tatsächlich durchsucht wurden.
    removed = 0
    for folder in watch:
        for r in conn.execute("SELECT path FROM tracks WHERE folder = ?", (folder,)).fetchall():
            if r["path"] not in seen and not Path(r["path"]).exists():
                conn.execute("DELETE FROM tracks WHERE path = ?", (r["path"],))
                removed += 1
    conn.commit()

    res = {"total": total, "added": added, "updated": updated, "skipped": skipped,
           "failed": failed, "removed": removed}
    log.info("library.scan: %s", res)
    return res


def _upsert(conn: sqlite3.Connection, row: dict) -> None:
    cols = ["path"] + [c for c in _TECH_COLS if c in row]
    vals = [row.get(c) for c in cols]
    sets = ", ".join(f"{c}=excluded.{c}" for c in cols if c != "path")
    conn.execute(
        f"INSERT INTO tracks({', '.join(cols)}) VALUES({', '.join('?' * len(cols))}) "
        f"ON CONFLICT(path) DO UPDATE SET {sets}",
        vals,
    )


# ── Abfragen ─────────────────────────────────────────────────────────────────

_SORTS = {
    "date_desc": "started_at DESC, mtime DESC",
    "date_asc": "started_at ASC, mtime ASC",
    "dist_desc": "distance_m DESC",
    "dist_asc": "distance_m ASC",
    "asc_desc": "ascent_m DESC",
    "dur_desc": "duration_s DESC",
    "name_asc": "name COLLATE NOCASE ASC",
    "added_desc": "indexed_at DESC",
    # Nur innerhalb einer Sammlung sinnvoll — siehe query().
    "collection": "started_at ASC",
}


def _norm(s: str) -> str:
    """Kleinschreibung ohne Akzente — damit „Müritz" auch „muritz" findet."""
    s = unicodedata.normalize("NFKD", (s or "").lower())
    return "".join(c for c in s if not unicodedata.combining(c))


def query(
    conn: sqlite3.Connection,
    search: str = "",
    year: Optional[int] = None,
    activity: str = "",
    fav_only: bool = False,
    planned: Optional[bool] = None,
    tags: Optional[list] = None,
    min_km: Optional[float] = None,
    max_km: Optional[float] = None,
    bbox: Optional[dict] = None,
    sort: str = "date_desc",
    limit: int = 500,
    offset: int = 0,
    include_errors: bool = False,
    with_geom: bool = False,
    collection_id: Optional[int] = None,
) -> dict:
    """Gefilterte Trefferliste + Gesamtzahl (für „x von y").

    Unlesbare Dateien bleiben standardmäßig draußen — als Kachel wären sie
    leer und ohne Werte. Sie sind über `errors()` erreichbar, damit sie nicht
    stillschweigend verschwinden.
    """
    where, args = ["1=1"], []
    if not include_errors:
        where.append("error = ''")
    if year:
        where.append("year = ?"); args.append(int(year))
    if activity:
        where.append("activity = ?"); args.append(activity)
    if fav_only:
        where.append("fav = 1")
    if planned is not None:
        # Effektiv heißt: die Hand-Korrektur schlägt die Schätzung.
        where.append("COALESCE(recorded_user, recorded) = ?")
        args.append(0 if planned else 1)
    if collection_id:
        where.append("path IN (SELECT path FROM collection_items WHERE collection_id = ?)")
        args.append(int(collection_id))
    if min_km is not None:
        where.append("distance_m >= ?"); args.append(float(min_km) * 1000)
    if max_km is not None:
        where.append("distance_m <= ?"); args.append(float(max_km) * 1000)
    if bbox:
        # Überlappung der Rechtecke, nicht Enthaltensein — sonst fällt eine
        # Tour raus, die nur zur Hälfte im gewählten Ausschnitt liegt.
        where.append("max_lat >= ? AND min_lat <= ? AND max_lon >= ? AND min_lon <= ?")
        args += [bbox["min_lat"], bbox["max_lat"], bbox["min_lon"], bbox["max_lon"]]
    for t in (tags or []):
        where.append("(',' || lower(tags) || ',') LIKE ?")
        args.append(f"%,{t.strip().lower()},%")

    sql_where = " AND ".join(where)
    order = _SORTS.get(sort, _SORTS["date_desc"])
    if collection_id and sort == "collection":
        # Eigene Reihenfolge der Sammlung (Etappe 1, 2, 3 …).
        order = ("(SELECT sort_index FROM collection_items ci "
                 f"WHERE ci.path = tracks.path AND ci.collection_id = {int(collection_id)})")
    rows = conn.execute(
        f"SELECT * FROM tracks WHERE {sql_where} ORDER BY {order}", args
    ).fetchall()

    # Freitext wird in Python gefiltert: SQLite kann von Haus aus kein
    # akzent-unempfindliches LIKE, und bei ein paar tausend Zeilen ist das
    # schneller getippt als eine zweite Suchtabelle gepflegt.
    if search.strip():
        needles = [_norm(w) for w in search.split() if w.strip()]
        def hit(r):
            hay = _norm(" ".join([
                r["name"] or "", r["filename"] or "", r["tags"] or "",
                r["note"] or "", r["place"] or "", r["country"] or "",
                r["region"] or "",
            ]))
            return all(n in hay for n in needles)
        rows = [r for r in rows if hit(r)]

    total = len(rows)
    page = rows[offset:offset + limit] if limit else rows
    return {"total": total, "items": [_to_dict(r, with_geom=with_geom) for r in page]}


def _to_dict(r: sqlite3.Row, with_geom: bool = False) -> dict:
    d = dict(r)
    # Der Streckenverlauf ist nur für die Kartenansicht nötig. Bei 700 Touren
    # sind das sonst 700 × 80 Koordinaten, die durch die Brücke müssen, ohne
    # dass sie jemand anschaut.
    if with_geom:
        try:
            d["geom"] = json.loads(d.get("geom") or "[]")
        except (TypeError, ValueError):
            d["geom"] = []
    else:
        d.pop("geom", None)
    # Welches Bild die Kachel zeigt: eigenes Titelbild schlägt Kartenbild,
    # Kartenbild schlägt die reine Linienzeichnung.
    d["image"] = d.get("cover") or d.get("map_thumb") or d.get("thumb") or ""
    d["image_kind"] = ("cover" if d.get("cover")
                       else "map" if d.get("map_thumb")
                       else "line" if d.get("thumb") else "")
    try:
        d["sensors"] = json.loads(d.get("sensors") or "[]")
    except (TypeError, ValueError):
        d["sensors"] = []
    d["tag_list"] = [t for t in (d.get("tags") or "").split(",") if t.strip()]
    # „gemacht" ist die effektive Bewertung: Hand-Korrektur schlägt Schätzung.
    eff = d.get("recorded_user")
    d["recorded_eff"] = int(eff if eff is not None else (d.get("recorded") or 0))
    d["recorded_manual"] = eff is not None
    d["planned"] = 0 if d["recorded_eff"] else 1
    d["distance_km"] = round((d.get("distance_m") or 0) / 1000.0, 2)
    d["exists"] = Path(d["path"]).exists()
    return d


def get_track(conn: sqlite3.Connection, path: str) -> Optional[dict]:
    r = conn.execute("SELECT * FROM tracks WHERE path = ?", (path,)).fetchone()
    return _to_dict(r) if r else None


def stats(conn: sqlite3.Connection) -> dict:
    """Summen für die Kopfzeile des Archivs."""
    r = conn.execute(
        "SELECT COUNT(*) n, COALESCE(SUM(distance_m),0) d, COALESCE(SUM(ascent_m),0) a, "
        "COALESCE(SUM(moving_time_s),0) t, MIN(NULLIF(year,0)) y0, MAX(year) y1 "
        "FROM tracks WHERE error = ''"
    ).fetchone()
    years = [
        {"year": x["year"], "n": x["n"], "km": round(x["d"] / 1000.0, 1)}
        for x in conn.execute(
            "SELECT year, COUNT(*) n, SUM(distance_m) d FROM tracks "
            "WHERE year > 0 AND error = '' GROUP BY year ORDER BY year"
        ).fetchall()
    ]
    acts = [
        {"activity": x["activity"] or "", "n": x["n"]}
        for x in conn.execute(
            "SELECT activity, COUNT(*) n FROM tracks WHERE error = '' "
            "GROUP BY activity ORDER BY n DESC"
        ).fetchall()
    ]
    tags: dict = {}
    for x in conn.execute("SELECT tags FROM tracks WHERE tags != ''").fetchall():
        for t in (x["tags"] or "").split(","):
            t = t.strip()
            if t:
                tags[t] = tags.get(t, 0) + 1
    return {
        "n_tracks": r["n"],
        "total_km": round(r["d"] / 1000.0, 1),
        "total_ascent_m": round(r["a"]),
        "total_hours": round(r["t"] / 3600.0, 1),
        "year_min": r["y0"] or 0,
        "year_max": r["y1"] or 0,
        "years": years,
        "activities": acts,
        "tags": sorted(tags.items(), key=lambda kv: -kv[1]),
        "n_failed": conn.execute("SELECT COUNT(*) FROM tracks WHERE error != ''").fetchone()[0],
    }


def set_user_fields(conn: sqlite3.Connection, path: str, fav=None, tags=None, note=None) -> bool:
    sets, args = [], []
    if fav is not None:
        sets.append("fav = ?"); args.append(1 if fav else 0)
    if tags is not None:
        clean = ",".join(sorted({t.strip() for t in tags if t.strip()}))
        sets.append("tags = ?"); args.append(clean)
    if note is not None:
        sets.append("note = ?"); args.append(str(note))
    if not sets:
        return False
    args.append(path)
    conn.execute(f"UPDATE tracks SET {', '.join(sets)} WHERE path = ?", args)
    conn.commit()
    return True


def set_recorded(conn: sqlite3.Connection, path: str, value) -> None:
    """Hand-Korrektur: True = gemacht, False = geplant, None = wieder schätzen."""
    conn.execute("UPDATE tracks SET recorded_user = ? WHERE path = ?",
                 (None if value is None else (1 if value else 0), path))
    conn.commit()


def duplicates(conn: sqlite3.Connection) -> list:
    """Gruppen von Dateien mit identischem Streckenverlauf."""
    rows = conn.execute(
        "SELECT geo_hash, COUNT(*) n FROM tracks WHERE geo_hash != '' AND error = '' "
        "GROUP BY geo_hash HAVING n > 1 ORDER BY n DESC"
    ).fetchall()
    out = []
    for r in rows:
        items = conn.execute(
            "SELECT * FROM tracks WHERE geo_hash = ? ORDER BY mtime", (r["geo_hash"],)
        ).fetchall()
        out.append({"geo_hash": r["geo_hash"], "n": r["n"],
                    "items": [_to_dict(x) for x in items]})
    return out


# ── Karten-Vorschaubilder (Mapbox Static Images, einmal laden → lokal) ───────

def _encode_polyline(points: list, precision: int = 5) -> str:
    """Google-Polyline-Kodierung (lat,lon) — das Format, das Mapbox' Static-API
    für Linien-Overlays erwartet. Selbst geschrieben statt Bibliothek: 20 Zeilen
    gegen eine weitere Abhängigkeit im Bundle."""
    factor = 10 ** precision
    out = []
    prev_lat = prev_lon = 0
    for lon, lat in points:
        ilat = int(round(float(lat) * factor))
        ilon = int(round(float(lon) * factor))
        for delta in (ilat - prev_lat, ilon - prev_lon):
            v = ~(delta << 1) if delta < 0 else (delta << 1)
            while v >= 0x20:
                out.append(chr((0x20 | (v & 0x1F)) + 63))
                v >>= 5
            out.append(chr(v + 63))
        prev_lat, prev_lon = ilat, ilon
    return "".join(out)


def map_thumb_fetch(
    conn: sqlite3.Connection,
    row: dict,
    thumbs_dir: Path,
    token: str,
    style: str = "outdoors-v12",
    line_color: str = "ff6b35",
    width: int = 360,
    height: int = 200,
    timeout: float = 20.0,
) -> str:
    """Lädt EIN Karten-Vorschaubild und legt es dauerhaft ab.

    Das Bild wird genau einmal geholt; danach liegt es lokal und die Ansicht
    kostet weder Wartezeit noch Kontingent. Ohne Token oder ohne Streckenverlauf
    passiert nichts — dann bleibt es bei der reinen Linienzeichnung.
    """
    import urllib.parse
    import urllib.request

    if not token or not token.startswith("pk."):
        return ""
    try:
        pts = json.loads(row.get("geom") or "[]")
    except (TypeError, ValueError):
        pts = []
    if len(pts) < 2:
        return ""

    thumbs_dir = Path(thumbs_dir)
    thumbs_dir.mkdir(parents=True, exist_ok=True)
    out = thumbs_dir / f"{row.get('geo_hash') or row.get('track_hash')}.png"
    if out.exists() and out.stat().st_size > 0:
        # Zwei Dateien mit identischem Verlauf teilen sich EIN Bild (der
        # Dateiname ist der Geo-Hash). Ohne dieses Update behielte die zweite
        # Zeile ihr leeres `map_thumb` — sie wäre für immer „offen".
        conn.execute("UPDATE tracks SET map_thumb = ? WHERE path = ?", (str(out), row["path"]))
        conn.commit()
        return str(out)

    # Der Pfad steckt als kodierte Polylinie in der URL; `auto` lässt Mapbox
    # Ausschnitt und Zoom aus der Linie selbst bestimmen.
    poly = urllib.parse.quote(_encode_polyline(pts), safe="")
    url = (f"https://api.mapbox.com/styles/v1/mapbox/{style}/static/"
           f"path-4+{line_color}-1({poly})/auto/{width}x{height}@2x"
           f"?access_token={urllib.parse.quote(token)}&attribution=false&logo=false")
    req = urllib.request.Request(url, headers={"User-Agent": "ReisezoomGPSStudio"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = resp.read()
    if not data:
        return ""
    out.write_bytes(data)
    conn.execute("UPDATE tracks SET map_thumb = ? WHERE path = ?", (str(out), row["path"]))
    conn.commit()
    return str(out)


def map_thumbs_pending(conn: sqlite3.Connection) -> list:
    """Touren mit Streckenverlauf, aber ohne gecachtes Karten-Vorschaubild."""
    rows = conn.execute(
        "SELECT * FROM tracks WHERE error = '' AND geom != '' AND map_thumb = '' "
        "ORDER BY started_at DESC"
    ).fetchall()
    return [dict(r) for r in rows]


def map_thumbs_fetch_all(
    conn: sqlite3.Connection,
    thumbs_dir: Path,
    token: str,
    style: str = "outdoors-v12",
    progress: Optional[Callable[[dict], None]] = None,
    should_stop: Optional[Callable[[], bool]] = None,
    limit: int = 0,
) -> dict:
    """Holt die fehlenden Karten-Vorschaubilder der Reihe nach.

    Ein Fehler bei einer Tour (Netz weg, Kontingent voll) beendet den Lauf —
    weiterzumachen würde nur eine Fehlerlawine erzeugen. Was schon geladen ist,
    bleibt liegen; ein zweiter Anlauf setzt genau dort fort.
    """
    todo = map_thumbs_pending(conn)
    if limit:
        todo = todo[:limit]
    done = failed = 0
    err = ""
    for i, row in enumerate(todo):
        if should_stop and should_stop():
            break
        try:
            if map_thumb_fetch(conn, row, thumbs_dir, token, style=style):
                done += 1
        except Exception as e:
            failed += 1
            err = str(e)
            log.warning("library: Karten-Vorschaubild fehlgeschlagen (%s): %s",
                        row.get("filename"), e)
            break
        if progress:
            progress({"done": i + 1, "total": len(todo), "ok": done,
                      "failed": failed, "current": row.get("name") or ""})
    return {"total": len(todo), "ok": done, "failed": failed, "error": err}


# ── Eigenes Titelbild ────────────────────────────────────────────────────────

def set_cover(conn: sqlite3.Connection, path: str, image_path: str,
              covers_dir: Path, max_w: int = 720) -> str:
    """Legt ein eigenes Bild als Titelbild einer Tour ab (verkleinerte Kopie).

    Kopie statt Verweis: das Original darf verschoben oder gelöscht werden,
    ohne dass im Archiv eine Lücke entsteht — und ein 45-MP-Foto muss nicht bei
    jedem Aufbau der Kachelansicht durch die Brücke.
    """
    from PIL import Image

    row = conn.execute("SELECT geo_hash FROM tracks WHERE path = ?", (path,)).fetchone()
    if not row:
        return ""
    covers_dir = Path(covers_dir)
    covers_dir.mkdir(parents=True, exist_ok=True)
    out = covers_dir / f"{row['geo_hash']}.jpg"
    img = Image.open(image_path)
    img = img.convert("RGB")
    if img.width > max_w:
        img = img.resize((max_w, max(1, round(img.height * max_w / img.width))))
    img.save(out, "JPEG", quality=85)
    conn.execute("UPDATE tracks SET cover = ? WHERE path = ?", (str(out), path))
    conn.commit()
    return str(out)


def clear_cover(conn: sqlite3.Connection, path: str) -> None:
    row = conn.execute("SELECT cover FROM tracks WHERE path = ?", (path,)).fetchone()
    if row and row["cover"]:
        try:
            Path(row["cover"]).unlink()
        except OSError:
            pass
    conn.execute("UPDATE tracks SET cover = '' WHERE path = ?", (path,))
    conn.commit()


# ── Sammlungen ──────────────────────────────────────────────────────────────
#
# Eine Sammlung fasst Touren zu einer Einheit zusammen: die sechs Etappen einer
# Mehrtagestour, alle Touren einer Reise, eine Themenserie. Bewusst als eigene
# Tabelle und nicht als Schlagwort — eine Sammlung hat eine **Reihenfolge**
# (Etappe 1, 2, 3 …), und genau die braucht der Animator, wenn er sie am Stück
# abfliegt.

def collections(conn: sqlite3.Connection) -> list:
    """Alle Sammlungen mit Anzahl + Summen."""
    rows = conn.execute("SELECT * FROM collections ORDER BY name COLLATE NOCASE").fetchall()
    out = []
    for r in rows:
        agg = conn.execute(
            "SELECT COUNT(*) n, COALESCE(SUM(t.distance_m),0) d, COALESCE(SUM(t.ascent_m),0) a "
            "FROM collection_items ci JOIN tracks t ON t.path = ci.path "
            "WHERE ci.collection_id = ?", (r["id"],)
        ).fetchone()
        out.append({"id": r["id"], "name": r["name"], "note": r["note"] or "",
                    "created_at": r["created_at"] or "", "n": agg["n"],
                    "total_km": round(agg["d"] / 1000.0, 1),
                    "total_ascent_m": round(agg["a"])})
    return out


def collection_create(conn: sqlite3.Connection, name: str, paths: Optional[list] = None) -> int:
    cur = conn.execute("INSERT INTO collections(name, created_at) VALUES(?,?)",
                       (name.strip() or "Sammlung", _now_iso()))
    cid = cur.lastrowid
    if paths:
        collection_add(conn, cid, paths)
    conn.commit()
    return cid


def collection_rename(conn: sqlite3.Connection, cid: int, name: str) -> None:
    conn.execute("UPDATE collections SET name = ? WHERE id = ?", (name.strip(), cid))
    conn.commit()


def collection_delete(conn: sqlite3.Connection, cid: int) -> None:
    """Löscht die Sammlung — die Touren selbst bleiben natürlich im Archiv."""
    conn.execute("DELETE FROM collection_items WHERE collection_id = ?", (cid,))
    conn.execute("DELETE FROM collections WHERE id = ?", (cid,))
    conn.commit()


def collection_add(conn: sqlite3.Connection, cid: int, paths: list) -> int:
    """Touren anhängen. Reihenfolge = Reihenfolge des Hinzufügens."""
    start = conn.execute(
        "SELECT COALESCE(MAX(sort_index), -1) + 1 FROM collection_items WHERE collection_id = ?",
        (cid,)).fetchone()[0]
    added = 0
    for i, p in enumerate(paths):
        cur = conn.execute(
            "INSERT OR IGNORE INTO collection_items(collection_id, path, sort_index) VALUES(?,?,?)",
            (cid, p, start + i))
        added += cur.rowcount
    conn.commit()
    return added


def collection_remove(conn: sqlite3.Connection, cid: int, paths: list) -> None:
    for p in paths:
        conn.execute("DELETE FROM collection_items WHERE collection_id = ? AND path = ?", (cid, p))
    conn.commit()


def collection_sort_by_date(conn: sqlite3.Connection, cid: int) -> None:
    """Nach Datum ordnen — bei Mehrtagestouren fast immer die richtige Folge."""
    rows = conn.execute(
        "SELECT ci.path FROM collection_items ci JOIN tracks t ON t.path = ci.path "
        "WHERE ci.collection_id = ? ORDER BY t.started_at, t.mtime", (cid,)).fetchall()
    for i, r in enumerate(rows):
        conn.execute("UPDATE collection_items SET sort_index = ? WHERE collection_id = ? AND path = ?",
                     (i, cid, r["path"]))
    conn.commit()


def collection_items(conn: sqlite3.Connection, cid: int) -> list:
    rows = conn.execute(
        "SELECT t.* FROM collection_items ci JOIN tracks t ON t.path = ci.path "
        "WHERE ci.collection_id = ? ORDER BY ci.sort_index", (cid,)).fetchall()
    return [_to_dict(r) for r in rows]


def collections_of(conn: sqlite3.Connection, path: str) -> list:
    rows = conn.execute(
        "SELECT c.id, c.name FROM collection_items ci JOIN collections c ON c.id = ci.collection_id "
        "WHERE ci.path = ? ORDER BY c.name COLLATE NOCASE", (path,)).fetchall()
    return [{"id": r["id"], "name": r["name"]} for r in rows]


def errors(conn: sqlite3.Connection) -> list:
    """Dateien, die beim Einlesen nicht gelesen werden konnten."""
    rows = conn.execute(
        "SELECT * FROM tracks WHERE error != '' ORDER BY filename"
    ).fetchall()
    return [_to_dict(r) for r in rows]


def forget(conn: sqlite3.Connection, path: str) -> None:
    """Nimmt eine Tour aus dem Archiv — die Datei selbst bleibt liegen."""
    conn.execute("DELETE FROM tracks WHERE path = ?", (path,))
    conn.commit()
