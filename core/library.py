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
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Iterable, Optional

from . import gpx as cgpx
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
    indexed_at    TEXT,
    error         TEXT DEFAULT '',

    -- Nutzer-Eingaben. Werden beim Neu-Einlesen NICHT überschrieben.
    fav           INTEGER DEFAULT 0,
    tags          TEXT DEFAULT '',
    note          TEXT DEFAULT ''
);

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
    "thumb", "indexed_at", "error",
]


def open_db(db_path: Path) -> sqlite3.Connection:
    """Öffnet (und erstellt) die Archiv-Datenbank."""
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.executescript(_SCHEMA)
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
        # Komoot hängt „(Completed)" an gefahrene Touren; alles andere ist geplant.
        "planned": 0 if (src != "komoot" or "(completed)" in name.lower()) else 1,
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

    known = {
        r["path"]: (r["mtime"], r["size"])
        for r in conn.execute("SELECT path, mtime, size FROM tracks").fetchall()
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
            if old and not force and abs(old[0] - st.st_mtime) < 1 and old[1] == st.st_size:
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
        where.append("planned = ?"); args.append(1 if planned else 0)
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
    return {"total": total, "items": [_to_dict(r) for r in page]}


def _to_dict(r: sqlite3.Row) -> dict:
    d = dict(r)
    try:
        d["sensors"] = json.loads(d.get("sensors") or "[]")
    except (TypeError, ValueError):
        d["sensors"] = []
    d["tag_list"] = [t for t in (d.get("tags") or "").split(",") if t.strip()]
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
