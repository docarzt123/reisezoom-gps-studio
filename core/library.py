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
Verbunden sind beide über den **`geo_hash`** (v0.9.529) — den kanonischen Hash
der vollen Koordinaten ohne Dateiname, `sessions.compute_track_hash(coords)`.
Sessions sind seit Schema 2 direkt darauf geschlüsselt; so kann das Archiv
anzeigen „an dieser Tour hast du schon gearbeitet", und die Cloud packt die
Projekte mit in den Umschlag (der ebenfalls am geo_hash hängt).

Zwei Hashes pro Tour:
  geo_hash    – nur Koordinaten: kanonische Identität. Verbindet zu Sessions
                und Cloud, findet dieselbe Tour unter anderem Dateinamen
                (Komoot-Exporte doppeln sich gern), benennt das Vorschaubild
  track_hash  – mit Dateiname: Altspalte. War als Session-Brücke gedacht,
                hat aber NIE gepasst (Sessions hashten downsampled UI-Koords
                ohne Namen — drei verschiedene Hashes pro Tour, entdeckt
                21.08.2026). Bleibt befüllt, damit Alt-Bestände (100k+ Zeilen
                bei Beta-Testern) nicht neu eingelesen werden müssen; neu
                anbinden sollte sich daran niemand mehr.

Öffentliche API:
  open_db(path)                      – Verbindung + Schema (idempotent)
  get_folders / add_folder / remove_folder
  scan(...)                          – Ordner einlesen (inkrementell)
  query(...)                         – filtern/sortieren/suchen
  stats(...)                         – Summen für die Kopfzeile
  get_track(path) / set_user_fields(...) / duplicates(...) / forget(...)
"""
from __future__ import annotations

import functools
import json
from datetime import date as _date
import logging
import os
import re
import sqlite3
import statistics
import threading
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Iterable, Optional

from . import gpx as cgpx
from .gpx import _haversine_m
from . import imports as cimports
from . import fitmeta as _fitmeta
from . import sessions as csessions

log = logging.getLogger(__name__)

# 2 (v0.9.501): FIT-Tour-Ebene. Der Sprung von 1 loest ein einmaliges
# Neu-Einlesen aller FIT-Dateien aus - siehe `_migrate_fit_neu_lesen`.
SCHEMA_VERSION = 2

# Welche Dateien eingelesen werden. GPX direkt, der Rest über die
# Import-Schicht (FIT/NMEA/KML/KMZ/TCX/GeoJSON → GPX im Cache).
INDEX_EXTS = {".gpx"} | set(cimports.IMPORT_EXTS)

# Endungen, die NICHTS über den Inhalt aussagen. `.json` liegt in jedem
# Programmordner, `.log` und `.txt` sowieso überall. Wer beim Einlesen einen
# größeren Ordner auswählt, holt sich davon Zehntausende ins Archiv — ein
# Nutzer meldete **4835 Touren und 98692 nicht lesbare Dateien**. Jede davon
# wurde geöffnet, angelesen, als Fehlerzeile gespeichert und machte die
# Datenbank träge.
#
# Für diese drei entscheidet deshalb der INHALT, nicht die Endung: ein kurzer
# Blick in die ersten Kilobytes (`_sieht_nach_track_aus`). Das kostet fast
# nichts und hält alles draußen, was offensichtlich kein Track ist.
MEHRDEUTIGE_EXTS = {".json", ".txt", ".log"}

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

# Wie lange eine Tour im Archiv bleibt, deren Datei nicht auffindbar ist.
# Gedacht für die externe Platte im Schrank: sie bleibt sichtbar, zählt in der
# Statistik mit und ist als „gerade nicht erreichbar" gekennzeichnet.
MISSING_DROP_DAYS = 90


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
    -- v0.9.494: Datei gerade nicht auffindbar (externe Platte abgezogen, Ordner
    -- umgezogen). Statt die Tour sofort zu vergessen, wird sie markiert — sie
    -- bleibt sichtbar, zählt weiter mit und verschwindet erst nach
    -- MISSING_DROP_DAYS. Leer = alles in Ordnung.
    missing_since TEXT DEFAULT '',
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
    -- v0.9.497: WARUM die Datei nicht gelesen werden konnte. `no_points` heißt
    -- „gelesen, aber ohne Koordinaten" — bei FIT der Regelfall für Rolle, Kraft
    -- und Bahnschwimmen. Das ist kein Defekt und wird getrennt gezeigt.
    -- `broken` ist alles andere. Leer = kein Fehler.
    error_kind    TEXT DEFAULT '',

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
    recorded_user INTEGER DEFAULT NULL,
    -- v0.9.491: eigener Name (leer = Name aus der Datei) und „ausgeblendet".
    -- Ausblenden statt löschen ist der schonende Weg für Touren, die man nicht
    -- mehr sehen will, aber auch nicht verlieren möchte.
    display_name  TEXT DEFAULT '',
    hidden        INTEGER DEFAULT 0
);

-- v0.9.489: Sammlungen — mehrere Touren als eine Einheit (Mehrtagestour,
-- Reise, Themenserie). Eine Tour darf in beliebig vielen Sammlungen liegen.
CREATE TABLE IF NOT EXISTS collections (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    note       TEXT DEFAULT '',
    created_at TEXT
);

-- v0.9.493: Zugehörigkeit hängt am Streckenverlauf, nicht am Dateipfad —
-- sonst ist die Mehrtagestour weg, sobald der Ordner einmal abgemeldet oder
-- die Datei umbenannt wurde.
CREATE TABLE IF NOT EXISTS collection_items (
    collection_id INTEGER NOT NULL,
    geo_hash      TEXT NOT NULL,
    sort_index    INTEGER DEFAULT 0,
    PRIMARY KEY (collection_id, geo_hash)
);

CREATE INDEX IF NOT EXISTS idx_colitems_col ON collection_items(collection_id);

-- v0.9.493: Alles, was der NUTZER zu einer Tour gesagt hat, hängt nicht mehr
-- am Dateipfad, sondern am Streckenverlauf (`geo_hash`). Grund: der Datei-Index
-- ist flüchtig — ein Ordner wird abgemeldet, eine Datei umbenannt, verschoben,
-- doppelt exportiert. Die Bewertung „das ist meine Lieblingsrunde" darf davon
-- nicht abhängen. Diese Tabelle wird beim Entfernen eines Ordners NICHT
-- angefasst und überlebt jedes Neu-Einlesen; sie ist winzig (ein paar hundert
-- Byte je Tour).
CREATE TABLE IF NOT EXISTS track_meta (
    geo_hash      TEXT PRIMARY KEY,
    fav           INTEGER DEFAULT 0,
    tags          TEXT DEFAULT '',
    note          TEXT DEFAULT '',
    cover         TEXT DEFAULT '',
    recorded_user INTEGER DEFAULT NULL,
    display_name  TEXT DEFAULT '',
    hidden        INTEGER DEFAULT 0,
    -- Vom Nutzer gewählte Fortbewegungsart. Leer = die Schätzung aus Name und
    -- Tempo gilt (_guess_activity). Wer einmal korrigiert, korrigiert für immer:
    -- der Wert hängt am geo_hash und überlebt Neu-Einlesen, Umbenennen und
    -- Verschieben. Wunsch eines Beta-Testers, v0.9.496.
    activity_user TEXT DEFAULT '',
    -- Eigene Track-Farbe für die Übersichtskarte im Archiv (#rrggbb). Leer =
    -- automatisch aus dem Streckenverlauf abgeleitet, damit benachbarte Touren
    -- nicht alle gleich aussehen. Gilt NUR im Archiv — Animator und Tour-Map
    -- haben ihre eigene Farbwahl je Projekt.
    color         TEXT DEFAULT '',
    last_name     TEXT DEFAULT '',
    first_seen    TEXT,
    last_seen     TEXT
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
    "recorded", "recorded_src", "thumb", "geom", "indexed_at", "error",
    "error_kind",
    # v0.9.493: das gecachte Kartenbild gehört zum technischen Teil — es hängt
    # am Geo-Hash und wird beim Einlesen aus dem Cache wiederhergestellt.
    # `cover` NICHT hier: das ist eine Nutzer-Eingabe und kommt aus track_meta.
    "map_thumb",
    # v0.9.501: FIT-Tour-Ebene. Technisch, weil beides direkt aus der Datei
    # kommt und bei jedem Einlesen neu entsteht — keine Nutzer-Eingabe.
    "fitmeta", "fit_profile",
]

# Spalten, die eine ältere Datenbank noch nicht hat. Beim Öffnen nachgezogen —
# eine bestehende Sammlung soll nicht neu aufgebaut werden müssen.
_ADD_COLS = [
    ("geom", "TEXT DEFAULT ''"),
    ("color", "TEXT DEFAULT ''"),
    ("map_thumb", "TEXT DEFAULT ''"),
    ("cover", "TEXT DEFAULT ''"),
    ("recorded", "INTEGER DEFAULT 1"),
    ("recorded_src", "TEXT DEFAULT ''"),
    ("recorded_user", "INTEGER DEFAULT NULL"),
    ("display_name", "TEXT DEFAULT ''"),
    ("hidden", "INTEGER DEFAULT 0"),
    # v0.9.494: seit wann die Datei nicht auffindbar ist (leer = alles gut).
    ("missing_since", "TEXT DEFAULT ''"),
    # v0.9.497: „ohne Strecke" vs. „kaputt" — siehe Schema.
    ("error_kind", "TEXT DEFAULT ''"),
    # v0.9.501: die Tour-Ebene aus FIT, roh und gefiltert (JSON). Roh, weil der
    # Neu-Import der teure Teil ist — 4835 Dateien noch einmal einzulesen, nur
    # weil uns später ein Feld einfällt, will niemand. Gezeigt wird nur der
    # kuratierte Auszug (`core.fitmeta.ANZEIGE`).
    ("fitmeta", "TEXT DEFAULT ''"),
    # Der frei vergebene Profilname des Geräts („Gravel", „Rennrad", „Commute").
    # Eigene Spalte statt in `tags`: `tags` gehört dem Nutzer, und ein Neu-Scan
    # darf dessen Eingaben nicht überschreiben.
    ("fit_profile", "TEXT DEFAULT ''"),
]


# Die Verbindung wird mit `check_same_thread=False` geöffnet (das Einlesen
# läuft in einem eigenen Thread) — sie ist damit aber NICHT nebenläufig
# benutzbar. Zwei gleichzeitige Abfragen über dieselbe Verbindung liefern
# vermischte Zeilen: in v0.9.492 kam aus einer Monats-Abfrage plötzlich NULL
# zurück, weil die Seitenleiste ihre Statistik parallel zur Trefferliste holte.
# Ein Modul-Lock reicht — die App hat genau ein Archiv, und die Abfragen sind
# Millisekunden-Sache.
_DB_LOCK = threading.RLock()


def _locked(fn):
    """Serialisiert jeden Zugriff auf die Archiv-Datenbank."""
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        with _DB_LOCK:
            return fn(*args, **kwargs)
    return wrapper


def open_db(db_path: Path) -> sqlite3.Connection:
    """Öffnet (und erstellt) die Archiv-Datenbank."""
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    # Die Freitextsuche gehört ins SQL, nicht hinterher in Python: sonst filtert
    # die Liste anders als `stats()` zählt („2 Touren … 16.314 km"). SQLite kann
    # kein akzent-unempfindliches LIKE, also reichen wir `_norm` als Funktion
    # hinein — bei ein paar tausend Zeilen kostet das nichts.
    try:
        conn.create_function("rz_norm", 1, _norm, deterministic=True)
    except TypeError:  # ältere SQLite-Bindings kennen `deterministic` nicht
        conn.create_function("rz_norm", 1, _norm)
    conn.executescript(_SCHEMA)
    # Der bisherige Schema-Stand muss VOR dem Überschreiben gelesen werden —
    # sonst steht dort schon die neue Nummer und keine Migration liefe je an.
    _alt = conn.execute("SELECT value FROM meta WHERE key = 'schema'").fetchone()
    try:
        schema_alt = int(_alt["value"]) if _alt else 0
    except (TypeError, ValueError):
        schema_alt = 0
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
    _migrate_meta_spalten(conn)
    _migrate_meta(conn)
    _migrate_collection_items(conn)
    _migrate_error_kind(conn)
    _migrate_fit_neu_lesen(conn, schema_alt)
    conn.commit()
    return conn


def _migrate_fit_neu_lesen(conn: sqlite3.Connection, schema_alt: int) -> None:
    """Einmalig: bestehende FIT-Zeilen zum erneuten Einlesen vormerken (v0.9.501).

    Der Scan überspringt Dateien, deren Zeit und Größe unverändert sind — er
    öffnet sie gar nicht erst. Für ein bestehendes Archiv hieße das: die neue
    Tour-Ebene (Ø-Puls, Sportart aus der Datei, Gerät) bliebe für immer leer,
    und die Fortbewegungsart käme weiter aus dem Dateinamen. Ein Nutzer mit 4835
    Touren müsste alles von Hand neu einlesen, um an Daten zu kommen, die längst
    in seinen Dateien stehen.

    Deshalb wird bei genau diesem Schema-Sprung die gemerkte Änderungszeit der
    FIT-Zeilen auf 0 gesetzt. Beim nächsten Einlesen sehen sie „verändert" aus
    und werden einmal neu gelesen — danach greift der Cache wieder normal.

    Nur FIT: alle anderen Formate haben keine Tour-Ebene, die müssten umsonst
    durch die Mühle.
    """
    if schema_alt <= 0 or schema_alt >= 2:
        return      # frische Datenbank oder schon migriert
    cur = conn.execute(
        "UPDATE tracks SET mtime = 0 WHERE lower(filename) LIKE '%.fit'")
    if cur.rowcount:
        log.info("library: %d FIT-Touren zum Neu-Einlesen vorgemerkt "
                 "(Tour-Ebene, v0.9.501)", cur.rowcount)


def _migrate_error_kind(conn: sqlite3.Connection) -> None:
    """Bestehende Fehler-Zeilen einmalig einsortieren (v0.9.497).

    Ohne das stünde bei jedem, der schon eingelesen hat, weiter „nicht lesbar" —
    bis er von sich aus neu einliest. Die Meldung ist ein fester Satz aus
    `core/imports.py`, das Zuordnen also eindeutig.
    """
    cur = conn.execute(
        "UPDATE tracks SET error_kind = 'no_points' "
        "WHERE error != '' AND COALESCE(error_kind,'') = '' "
        "AND error LIKE '%Keine Track-Punkte%'")
    n = cur.rowcount or 0
    rest = conn.execute(
        "UPDATE tracks SET error_kind = 'broken' "
        "WHERE error != '' AND COALESCE(error_kind,'') = ''").rowcount or 0
    if n or rest:
        log.info("library: Fehler-Zeilen einsortiert — %d ohne Strecke, %d kaputt", n, rest)


def _migrate_meta_spalten(conn: sqlite3.Connection) -> None:
    """Fehlende Spalten in `track_meta` nachziehen (bestehende Archive)."""
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(track_meta)").fetchall()}
    for name, typ in (("activity_user", "TEXT DEFAULT ''"), ("color", "TEXT DEFAULT ''")):
        if name not in cols:
            log.info("library: track_meta.%s wird ergänzt", name)
            conn.execute(f"ALTER TABLE track_meta ADD COLUMN {name} {typ}")


def _migrate_collection_items(conn: sqlite3.Connection) -> None:
    """Sammlungs-Zuordnung von `path` auf `geo_hash` umstellen (v0.9.493)."""
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(collection_items)").fetchall()}
    if "path" not in cols:
        return
    log.info("library: collection_items → geo_hash migrieren")
    conn.execute("ALTER TABLE collection_items RENAME TO collection_items_old")
    conn.execute("""
        CREATE TABLE collection_items (
            collection_id INTEGER NOT NULL,
            geo_hash      TEXT NOT NULL,
            sort_index    INTEGER DEFAULT 0,
            PRIMARY KEY (collection_id, geo_hash)
        )""")
    conn.execute(
        "INSERT OR IGNORE INTO collection_items(collection_id, geo_hash, sort_index) "
        "SELECT ci.collection_id, t.geo_hash, ci.sort_index FROM collection_items_old ci "
        "JOIN tracks t ON t.path = ci.path WHERE t.geo_hash IS NOT NULL AND t.geo_hash != ''")
    conn.execute("DROP TABLE collection_items_old")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_colitems_col ON collection_items(collection_id)")


def _migrate_meta(conn: sqlite3.Connection) -> None:
    """Bestehende Nutzer-Eingaben einmalig in `track_meta` heben.

    Bis v0.9.492 standen Favorit, Schlagwörter, Notiz, Titelbild, Hand-Korrektur,
    eigener Name und „ausgeblendet" in der `tracks`-Zeile — also am Dateipfad.
    Wer einen Ordner abmeldete, verlor sie. Hier werden sie einmalig an den
    `geo_hash` gehängt; danach lebt beides parallel (die Spalten in `tracks`
    bleiben als Anzeige-Cache erhalten und werden aus `track_meta` gefüllt).
    """
    done = conn.execute("SELECT value FROM meta WHERE key = 'meta_migrated'").fetchone()
    if done and done["value"] == "1":
        return
    n = 0
    rows = conn.execute(
        "SELECT geo_hash, name, fav, tags, note, cover, recorded_user, display_name, hidden "
        "FROM tracks WHERE geo_hash IS NOT NULL AND geo_hash != ''").fetchall()
    for r in rows:
        has_input = (r["fav"] or (r["tags"] or "").strip() or (r["note"] or "").strip()
                     or (r["cover"] or "").strip() or r["recorded_user"] is not None
                     or (r["display_name"] or "").strip() or r["hidden"])
        if not has_input:
            continue
        conn.execute(
            "INSERT INTO track_meta(geo_hash, fav, tags, note, cover, recorded_user, "
            "display_name, hidden, last_name, first_seen, last_seen) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(geo_hash) DO NOTHING",
            (r["geo_hash"], r["fav"] or 0, r["tags"] or "", r["note"] or "",
             r["cover"] or "", r["recorded_user"], r["display_name"] or "",
             r["hidden"] or 0, r["name"] or "", _now_iso(), _now_iso()))
        n += 1
    conn.execute("INSERT INTO meta(key, value) VALUES('meta_migrated','1') "
                 "ON CONFLICT(key) DO UPDATE SET value='1'")
    if n:
        log.info("library: %d Nutzer-Einträge nach track_meta übernommen", n)


# ── Beobachtete Ordner ───────────────────────────────────────────────────────

@_locked
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


@_locked
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


@_locked
def remove_folder(conn: sqlite3.Connection, path: str, drop_tracks: bool = True) -> None:
    p = str(Path(path).expanduser().resolve())
    conn.execute("DELETE FROM folders WHERE path = ?", (p,))
    if drop_tracks:
        conn.execute("DELETE FROM tracks WHERE folder = ?", (p,))
    conn.commit()


# ── Einlesen ─────────────────────────────────────────────────────────────────

def _days_since(iso: str) -> float:
    """Tage seit einem ISO-Zeitstempel; bei Unfug sehr groß (= alt)."""
    try:
        dt = datetime.fromisoformat(iso)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - dt).total_seconds() / 86400.0
    except (TypeError, ValueError):
        return 1e9


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _sieht_nach_track_aus(p: Path) -> bool:
    """Bei mehrdeutiger Endung: kurz hineinsehen, ob überhaupt ein Track drin ist.

    `.json`, `.txt` und `.log` sagen über den Inhalt nichts aus. Ohne diese
    Prüfung wandert jede Einstellungsdatei, jedes Protokoll und jede Notiz aus
    dem gewählten Ordner als „nicht lesbar" ins Archiv — bei einem Nutzer
    98692 Stück neben 4835 echten Touren.

    Gelesen werden nur die ersten Kilobytes; die Prüfungen sind dieselben, die
    der Import ohnehin benutzt.
    """
    ext = p.suffix.lower()
    if ext not in MEHRDEUTIGE_EXTS:
        return True
    try:
        if ext == ".json":
            return cimports._looks_like_geojson(str(p))
        return cimports._looks_like_nmea(str(p))
    except Exception:       # noqa: BLE001 — im Zweifel draußen lassen
        return False


def _iter_files(folder: str, recursive: bool) -> Iterable[Path]:
    base = Path(folder)
    if not base.is_dir():
        return
    if recursive:
        for root, dirs, files in os.walk(base):
            dirs[:] = [d for d in dirs if d not in SKIP_DIR_NAMES and not d.startswith(".")]
            for f in files:
                if Path(f).suffix.lower() in INDEX_EXTS and not f.startswith("."):
                    voll = Path(root) / f
                    if _sieht_nach_track_aus(voll):
                        yield voll
    else:
        for f in sorted(base.iterdir()):
            if f.is_file() and f.suffix.lower() in INDEX_EXTS and not f.name.startswith("."):
                if _sieht_nach_track_aus(f):
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
# ⚠️ Die Reihenfolge entscheidet: Der erste Treffer gewinnt. Die genaueren
# Rad-Arten müssen deshalb VOR dem allgemeinen „rad" stehen — sonst schluckt
# „radtour" schon alles, und „E-Bike Radtour" landete nie bei `ebike`.
_ACT_WORDS = [
    ("mtb",         ("mountainbike", "mountain bike", "mtb", "trail ride")),
    ("rennrad",     ("rennrad", "road cycling", "road bike", "rennradtour")),
    # Wunsch Beta-Tester: „Ich habe 3 Fahrräder unterteilt in Rennrad,
    # Gravel/Trekking und E-Bike." Ohne eigene Arten landete alles in einem Topf,
    # und eine Auswertung „wie viel bin ich mit dem E-Bike gefahren" war nicht
    # möglich.
    ("ebike",       ("e-bike", "ebike", "e bike", "pedelec", "s-pedelec",
                     "e-mtb", "emtb")),
    ("gravel",      ("gravel", "schotter", "trekkingrad", "trekking bike",
                     "crossrad", "querfeldein")),
    ("rad",         ("fahrrad", "radtour", "radfahren", "bike ride", "cycling",
                     "bicicleta", "ciclismo")),
    ("laufen",      ("laufen", "joggen", "running", "run ", "lauf ", "correr")),
    ("wandern",     ("wanderung", "wandern", "hike", "hiking", "senderismo",
                     "bergtour", "trekking")),
    ("spaziergang", ("spaziergang", "walk", "gassi", "paseo")),
    ("motorrad",    ("motorrad", "motorcycle", "moto ")),
    ("auto",        ("autofahrt", "roadtrip", "road trip", "wohnmobil", "camper")),
    ("boot",        ("kajak", "kanu", "paddel", "boot", "kayak", "sup ", "segeln")),
    ("ski",         ("ski", "langlauf", "skitour", "schneeschuh", "snowboard")),
]

# Die Arten, die von Hand wählbar sind — dieselbe Liste, die auch geschätzt wird.
# `set_activity` prüft dagegen, damit kein Tippfehler in der Datenbank landet.
ACTIVITIES = tuple(k for k, _ in _ACT_WORDS)

# Sammelposten für den Filter (Wunsch Beta-Tester): „Bei 3 verschiedenen
# Fahrrädern wäre es schön, wenn man alle Fahrräder, alles zu Fuß zusammenfasst."
# Wer seine Räder getrennt führt, will trotzdem manchmal nur wissen: wie viel
# war ich überhaupt mit dem Rad unterwegs?
#
# ⚠️ Die Werte MÜSSEN in ACTIVITIES existieren — sonst filtert der Sammelposten
# stillschweigend an einer Art vorbei. `tests/test_activity_groups.py` prüft das.
ACT_GROUPS = {
    "rad":  ("rad", "rennrad", "gravel", "mtb", "ebike"),
    "fuss": ("wandern", "spaziergang", "laufen"),
}
# Im Filter kommen sie als `grp:rad` / `grp:fuss` an — ein eigenes Präfix, damit
# sie sich nie mit einer echten Art verwechseln lassen (es GIBT eine Art „rad").
GROUP_PREFIX = "grp:"


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


def _row_from_file(path: Path, folder: str, thumbs_dir: Path, import_cache: Path,
                   map_thumbs_dir: Optional[Path] = None, covers_dir: Optional[Path] = None) -> dict:
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
        "error_kind": "",
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
        # geo_hash ist die kanonische Identität (v0.9.529): Sessions und
        # Cloud-Umschläge hängen an genau diesem Hash. track_hash (mit Name)
        # ist eine Altspalte — siehe Modul-Docstring; NICHT als Session-
        # Brücke verwenden.
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
        # Rangfolge der Fortbewegungsart: Raten → FIT → von Hand.
        # Die Datei weiß es besser als der Dateiname: ein Garmin schreibt
        # `sub_sport = gravel_cycling`, wo wir aus „Tour_2024.fit" gar nichts
        # lesen können. Die Hand-Korrektur kommt später in `_apply_meta` obendrauf
        # und schlägt beide — sonst überschriebe jeder Neu-Scan die Korrektur.
        "activity": _fitmeta.aktivitaet(getattr(stats, "tour_meta", None))
                    or _guess_activity(name, dist, moving),
        "fitmeta": (json.dumps(stats.tour_meta, separators=(",", ":"))
                    if getattr(stats, "tour_meta", None) else ""),
        "fit_profile": _fitmeta.profilname(getattr(stats, "tour_meta", None)),
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

    # v0.9.493 — Bilder liegen unter ihrem Geo-Hash und bleiben liegen. Wer
    # einen Ordner abmeldet und wieder hinzufügt (oder dieselbe Tour aus einem
    # anderen Ordner einliest), bekommt das Kartenbild aus dem Cache statt
    # eines neuen Mapbox-Abrufs.
    if map_thumbs_dir:
        mt = Path(map_thumbs_dir) / f"{row['geo_hash']}.png"
        if mt.exists() and mt.stat().st_size > 0:
            row["map_thumb"] = str(mt)
    if covers_dir:
        cv = Path(covers_dir) / f"{row['geo_hash']}.jpg"
        if cv.exists() and cv.stat().st_size > 0:
            row["cover"] = str(cv)
    return row


@_locked
def scan(
    conn: sqlite3.Connection,
    thumbs_dir: Path,
    import_cache: Path,
    folders: Optional[list] = None,
    force: bool = False,
    map_thumbs_dir: Optional[Path] = None,
    covers_dir: Optional[Path] = None,
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
    #
    # Vierter Wert: Die Zeile ist eine bekannte Fehler-Zeile. Auch die gilt als
    # fertig — eine Datei ohne Koordinaten hat beim zweiten Hinsehen genauso
    # wenig welche. Ohne das öffnete jeder Durchlauf die 61 Hallen-Einheiten
    # eines Nutzers erneut, für immer.
    known = {
        r["path"]: (r["mtime"], r["size"],
                    bool(r["geom"]) and bool(r["recorded_src"]),
                    bool(r["error"]))
        for r in conn.execute(
            "SELECT path, mtime, size, geom, recorded_src, error FROM tracks").fetchall()
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
            unveraendert = bool(old) and not force \
                and abs(old[0] - st.st_mtime) < 1 and old[1] == st.st_size
            if unveraendert and old[3]:
                # Bekannte Fehler-Zeile, Datei unverändert → gar nicht erst
                # öffnen. Weiter als „Fehler" gezählt, weil die Kopfzeile den
                # Zustand meint und nicht die Ereignisse dieses Durchlaufs;
                # sonst meldete ein Neu-Einlesen „0 Fehler", während oben
                # unverändert 61 stehen. Wird die Datei ersetzt, ändern sich
                # Zeit oder Größe und sie kommt von selbst wieder dran.
                failed += 1
            elif unveraendert and old[2]:
                skipped += 1
            else:
                row = _row_from_file(p, folder, thumbs_dir, import_cache,
                                     map_thumbs_dir, covers_dir)
                _upsert(conn, row)
                if old:
                    updated += 1
                else:
                    added += 1
        except Exception as e:
            failed += 1
            # „Ohne Koordinaten" ist kein Defekt: Rollentraining, Krafttraining,
            # Bahnschwimmen — die Uhr schreibt auch dafür eine FIT-Datei. Das
            # gehört nicht in denselben Topf wie eine kaputte Datei, sonst steht
            # bei jemandem mit 61 Hallen-Einheiten „61 Dateien nicht lesbar".
            kind = "no_points" if isinstance(e, cimports.NoTrackPoints) else "broken"
            if kind == "no_points":
                log.info("library: %s enthält keine Koordinaten (kein Fehler)", p.name)
            else:
                log.warning("library: %s konnte nicht gelesen werden: %s", p.name, e)
            try:
                # Zeit und Größe werden mitgeschrieben (früher 0/0). Nur damit
                # erkennt der nächste Durchlauf, dass sich an dieser Datei nichts
                # geändert hat, und lässt sie zu — und bemerkt umgekehrt, wenn
                # jemand sie ersetzt hat. Schlägt schon `stat()` fehl, bleibt es
                # bei 0/0, dann wird eben weiter jedes Mal nachgesehen.
                try:
                    _st = p.stat()
                    _mt, _sz = _st.st_mtime, _st.st_size
                except OSError:
                    _mt, _sz = 0, 0
                _upsert(conn, {
                    "path": sp, "folder": folder, "filename": p.name,
                    "mtime": _mt, "size": _sz, "indexed_at": _now_iso(),
                    "error": str(e)[:300], "error_kind": kind, "name": p.stem,
                })
            except Exception:
                pass
        if progress and (i % 10 == 0 or i == total - 1):
            progress({"done": i + 1, "total": total, "added": added,
                      "updated": updated, "skipped": skipped, "failed": failed,
                      "current": p.name})
        if i % 50 == 0:
            conn.commit()

    # Dateien, die gerade nicht auffindbar sind, werden NICHT sofort vergessen:
    # eine externe Platte ist abgezogen, ein Ordner umgezogen, ein Netzlaufwerk
    # nicht verbunden. Die Tour bleibt sichtbar und als „gerade nicht
    # erreichbar" markiert; erst nach MISSING_DROP_DAYS fliegt der Eintrag raus.
    # (Was der Nutzer zu ihr gesagt hat, überlebt in `track_meta` ohnehin.)
    removed = missing = back = 0
    now = _now_iso()
    for folder in watch:
        for r in conn.execute(
                "SELECT path, missing_since, error FROM tracks WHERE folder = ?",
                (folder,)).fetchall():
            # Altlast aufräumen: Fehler-Zeilen mit mehrdeutiger Endung, die der
            # Scanner heute gar nicht mehr aufsammelt (`.json`/`.txt`/`.log`
            # ohne Track-Inhalt). Die Datei liegt weiter auf der Platte, sie
            # gilt nur nicht mehr als Tour. Ohne das blieben sie für immer in
            # der Datenbank stehen — bei einem Nutzer 98692 Stück, die jede
            # Abfrage ausbremsten. An einer Fehler-Zeile hängt keine
            # Nutzereingabe, sie darf also ersatzlos weg.
            if (r["error"] and r["path"] not in seen
                    and Path(r["path"]).suffix.lower() in MEHRDEUTIGE_EXTS):
                conn.execute("DELETE FROM tracks WHERE path = ?", (r["path"],))
                removed += 1
                continue
            there = r["path"] in seen or Path(r["path"]).exists()
            if there:
                if r["missing_since"]:
                    conn.execute("UPDATE tracks SET missing_since = '' WHERE path = ?", (r["path"],))
                    back += 1
                continue
            since = r["missing_since"] or ""
            if not since:
                conn.execute("UPDATE tracks SET missing_since = ? WHERE path = ?", (now, r["path"]))
                missing += 1
            elif _days_since(since) > MISSING_DROP_DAYS:
                conn.execute("DELETE FROM tracks WHERE path = ?", (r["path"],))
                removed += 1
            else:
                missing += 1
    conn.commit()

    res = {"total": total, "added": added, "updated": updated, "skipped": skipped,
           "failed": failed, "removed": removed, "missing": missing, "back": back}
    log.info("library.scan: %s", res)
    return res


_META_COLS = ["fav", "tags", "note", "cover", "recorded_user", "display_name", "hidden", "color"]
# Sonderfall: in `track_meta` heißt die Spalte `activity_user` (leer = Schätzung
# gilt), in `tracks` schlicht `activity`. Deshalb wird sie getrennt gespiegelt.



def _geo_of(conn: sqlite3.Connection, path: str) -> str:
    """Fingerabdruck einer Datei — der Schlüssel für alles Dauerhafte."""
    r = conn.execute("SELECT geo_hash FROM tracks WHERE path = ?", (path,)).fetchone()
    return (r["geo_hash"] if r else "") or ""


def _apply_meta(conn: sqlite3.Connection, geo_hash: str, name: str = "",
                cover_hint: str = "") -> None:
    """Nutzer-Eingaben aus `track_meta` in die Datei-Zeile spiegeln.

    Die `tracks`-Spalten sind seit v0.9.493 nur noch Anzeige-Cache: gefiltert und
    sortiert wird weiter auf ihnen (ein JOIN in jeder Abfrage wäre teurer und
    unübersichtlicher), die Wahrheit steht in `track_meta`. Deshalb wird nach
    jedem Einlesen von dort zurückgeschrieben — so bekommt eine neu eingelesene
    Datei sofort wieder Favorit, Schlagwörter und Namen von früher.
    """
    if not geo_hash:
        return
    m = conn.execute("SELECT * FROM track_meta WHERE geo_hash = ?", (geo_hash,)).fetchone()
    now = _now_iso()
    if m is None:
        # `cover_hint`: eine Titelbild-Datei zu diesem Hash liegt noch im Cache,
        # die Meta-Zeile fehlt aber (frisches Archiv, alte Bilder). Übernehmen.
        conn.execute("INSERT INTO track_meta(geo_hash, cover, last_name, first_seen, last_seen) "
                     "VALUES(?,?,?,?,?) ON CONFLICT(geo_hash) DO NOTHING",
                     (geo_hash, cover_hint or "", name or "", now, now))
        if cover_hint:
            conn.execute("UPDATE tracks SET cover = ? WHERE geo_hash = ?", (cover_hint, geo_hash))
        return
    conn.execute(
        f"UPDATE tracks SET {', '.join(c + ' = ?' for c in _META_COLS)} WHERE geo_hash = ?",
        [m[c] for c in _META_COLS] + [geo_hash])
    # Hat der Nutzer die Fortbewegungsart selbst gesetzt, gewinnt sie — sonst
    # bleibt die Schätzung aus Name und Tempo stehen (leerer Wert = kein Eingriff).
    gewaehlt = (m["activity_user"] if "activity_user" in m.keys() else "") or ""
    if gewaehlt:
        conn.execute("UPDATE tracks SET activity = ? WHERE geo_hash = ?",
                     (gewaehlt, geo_hash))
    conn.execute("UPDATE track_meta SET last_seen = ?, last_name = ? WHERE geo_hash = ?",
                 (now, name or m["last_name"] or "", geo_hash))


def _set_meta(conn: sqlite3.Connection, path: str, **fields) -> bool:
    """Nutzer-Eingabe speichern: an den `geo_hash`, nicht an den Pfad.

    Wirkt damit automatisch auf ALLE Dateien mit identischem Streckenverlauf —
    dieselbe Tour zweimal exportiert heißt nicht, dass man sie zweimal
    bewerten muss.
    """
    r = conn.execute("SELECT geo_hash, name FROM tracks WHERE path = ?", (path,)).fetchone()
    if not r or not r["geo_hash"]:
        return False
    gh = r["geo_hash"]
    now = _now_iso()
    conn.execute("INSERT INTO track_meta(geo_hash, last_name, first_seen, last_seen) "
                 "VALUES(?,?,?,?) ON CONFLICT(geo_hash) DO NOTHING",
                 (gh, r["name"] or "", now, now))
    sets = ", ".join(f"{k} = ?" for k in fields)
    conn.execute(f"UPDATE track_meta SET {sets}, last_seen = ? WHERE geo_hash = ?",
                 list(fields.values()) + [now, gh])
    # Anzeige-Cache in allen Datei-Zeilen derselben Tour nachziehen.
    conn.execute(f"UPDATE tracks SET {sets} WHERE geo_hash = ?",
                 list(fields.values()) + [gh])
    conn.commit()
    return True


def _upsert(conn: sqlite3.Connection, row: dict) -> None:
    cols = ["path"] + [c for c in _TECH_COLS if c in row]
    vals = [row.get(c) for c in cols]
    sets = ", ".join(f"{c}=excluded.{c}" for c in cols if c != "path")
    conn.execute(
        f"INSERT INTO tracks({', '.join(cols)}) VALUES({', '.join('?' * len(cols))}) "
        f"ON CONFLICT(path) DO UPDATE SET {sets}",
        vals,
    )
    _apply_meta(conn, row.get("geo_hash") or "", row.get("name") or "",
                row.get("cover") or "")


# ── Abfragen ─────────────────────────────────────────────────────────────────

_SORTS = {
    "date_desc": "started_at DESC, mtime DESC",
    "date_asc": "started_at ASC, mtime ASC",
    "dist_desc": "distance_m DESC",
    "dist_asc": "distance_m ASC",
    "asc_desc": "ascent_m DESC",
    "asc_asc": "ascent_m ASC",
    "dur_desc": "duration_s DESC",
    "dur_asc": "duration_s ASC",
    "name_asc": "name COLLATE NOCASE ASC",
    "name_desc": "name COLLATE NOCASE DESC",
    "added_desc": "indexed_at DESC",
    # v0.9.501 — jede Spalte der Listenansicht ist anklickbar, also braucht
    # jede beide Richtungen. Vorher gab es zu Höhenmetern und Dauer nur „viel
    # zuerst": ein Klick auf die Kopfzeile hätte sich nicht umdrehen lassen.
    #
    # Schnitt, Startpunkt und Schlagwort fehlten ganz (Wunsch Beta-Tester:
    # „Ergänzung Durchschnittsgeschwindigkeit, Schlagwort, Startpunkt").
    "speed_desc": "avg_speed_kmh DESC",
    "speed_asc": "CASE WHEN avg_speed_kmh IS NULL OR avg_speed_kmh = 0 "
                 "THEN 1 ELSE 0 END, avg_speed_kmh ASC",
    # Leere Werte gehören in BEIDEN Richtungen ans Ende. Sonst beginnt
    # „Startpunkt A–Z" mit einer Bildschirmseite leerer Zellen — der Ortslauf
    # läuft im Hintergrund und ist bei einem frischen Archiv noch nicht durch.
    "place_asc": "CASE WHEN place = '' OR place IS NULL THEN 1 ELSE 0 END, "
                 "place COLLATE NOCASE ASC, started_at DESC",
    "place_desc": "CASE WHEN place = '' OR place IS NULL THEN 1 ELSE 0 END, "
                  "place COLLATE NOCASE DESC, started_at DESC",
    "tags_asc": "CASE WHEN tags = '' OR tags IS NULL THEN 1 ELSE 0 END, "
                "tags COLLATE NOCASE ASC, started_at DESC",
    "tags_desc": "CASE WHEN tags = '' OR tags IS NULL THEN 1 ELSE 0 END, "
                 "tags COLLATE NOCASE DESC, started_at DESC",
    "act_desc": "CASE WHEN activity = '' OR activity IS NULL THEN 1 ELSE 0 END, "
                "activity COLLATE NOCASE DESC, started_at DESC",
    # Nach Fortbewegungsart gruppiert (Wunsch Beta-Tester): erst alle Radtouren,
    # dann alle Wanderungen … innerhalb jeder Art die neuesten zuerst. Touren
    # ohne erkannte Art landen am Ende, nicht mittendrin.
    "act_asc": "CASE WHEN activity = '' OR activity IS NULL THEN 1 ELSE 0 END, "
               "activity COLLATE NOCASE ASC, started_at DESC",
    # Nur innerhalb einer Sammlung sinnvoll — siehe query().
    "collection": "started_at ASC",
}


# Alle Spalten AUSSER `geom`. Der Streckenverlauf ist mit Abstand die dickste
# Spalte (~1,6 KB je Tour) und wird nur von der Kartenansicht gebraucht — in
# `_to_dict` flog er bisher sofort wieder weg, nachdem SQLite ihn eingelesen
# hatte. Wird beim ersten Zugriff aus der Tabelle selbst gebildet, damit eine
# neue Spalte nicht vergessen werden kann.
_SPALTEN_OHNE_GEOM_CACHE: Optional[str] = None


# Spalten, die in einer Trefferliste nichts verloren haben: `geom` ist der
# vereinfachte Streckenverlauf, `fitmeta` der FIT-Rohblock (~1,2 KB je Tour).
# Bei 200 Kacheln je Nachladung wären das ein Viertel Megabyte, das niemand
# ansieht — beide werden erst beim Öffnen einer Tour einzeln nachgeladen.
_GROSSE_SPALTEN = ("geom", "fitmeta")


def _spalten_ohne_geom(conn: sqlite3.Connection) -> str:
    global _SPALTEN_OHNE_GEOM_CACHE
    if _SPALTEN_OHNE_GEOM_CACHE is None:
        namen = [r["name"] for r in conn.execute("PRAGMA table_info(tracks)").fetchall()]
        _SPALTEN_OHNE_GEOM_CACHE = ", ".join(n for n in namen if n not in _GROSSE_SPALTEN)
    return _SPALTEN_OHNE_GEOM_CACHE


def _norm(s: str) -> str:
    """Kleinschreibung ohne Akzente — damit „Müritz" auch „muritz" findet."""
    s = unicodedata.normalize("NFKD", (s or "").lower())
    return "".join(c for c in s if not unicodedata.combining(c))


def _like_escape(s: str) -> str:
    """`%`, `_` und `\\` für ein LIKE-Muster entschärfen.

    Ohne das sind es Platzhalter statt Zeichen: „100%" fand die gesamte
    Sammlung, „Tour_2024" auch „Tour 2024". Gehört immer mit `ESCAPE '\\'`
    zusammen — sonst kennt SQLite den Backslash nicht als Fluchtzeichen.
    """
    return (s or "").replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")



_SEARCH_HAY = ("COALESCE(display_name,'') || ' ' || COALESCE(name,'') || ' ' || "
               "COALESCE(filename,'') || ' ' || COALESCE(tags,'') || ' ' || "
               "COALESCE(note,'') || ' ' || COALESCE(place,'') || ' ' || "
               "COALESCE(country,'') || ' ' || COALESCE(region,'') || ' ' || "
               "COALESCE(fit_profile,'')")


def _build_where(search="", year=None, activity="", fav_only=False, planned=None,
                 tags=None, min_km=None, max_km=None, bbox=None, collection_id=None,
                 include_errors=False, include_hidden=False, hidden_only=False,
                 missing_only=False, von=None, bis=None, **_ignored) -> tuple:
    """Baut die WHERE-Klausel EINMAL — Liste und Statistik müssen zwingend
    dieselbe Auswahl meinen, sonst zählt die Statistik etwas anderes als das,
    was der Nutzer gerade sieht."""
    where, args = ["1=1"], []
    if not include_errors:
        where.append("error = ''")
    if hidden_only:
        # Der Bereich „Ausgeblendete" zeigt genau diese — nicht sie zusätzlich.
        where.append("hidden = 1")
    elif not include_hidden:
        where.append("hidden = 0")
    if missing_only:
        where.append("missing_since != ''")
    if year:
        where.append("year = ?"); args.append(int(year))
    # v0.9.505 — freier Zeitraum (Marc: „kann man nicht einfach einen
    # Datumsbereich einstellen"). `started_at` ist ISO-Text, deshalb reicht ein
    # Zeichenketten-Vergleich — „2025-03-14T…" liegt zwischen „2025-01-01" und
    # „2025-12-31z". Das `z` am Ende von `bis` schließt den letzten Tag MIT ein:
    # ohne das fiele „2025-12-31T09:00" aus dem Bereich, weil „2025-12-31T…"
    # größer ist als „2025-12-31".
    if von:
        where.append("started_at >= ?"); args.append(str(von)[:10])
    if bis:
        where.append("started_at <= ?"); args.append(str(bis)[:10] + "z")
    if activity:
        # Sammelposten (`grp:rad`) fassen mehrere Arten zusammen; alles andere
        # ist eine einzelne Art. Bewusst hier und nicht in der Oberfläche:
        # Liste, Karte und Statistik gehen alle durch `_build_where`, damit
        # zählt die Statistik garantiert dasselbe, was die Liste zeigt.
        if activity.startswith(GROUP_PREFIX):
            arten = ACT_GROUPS.get(activity[len(GROUP_PREFIX):], ())
            if arten:
                where.append(f"activity IN ({','.join('?' * len(arten))})")
                args.extend(arten)
            else:
                where.append("1=0")      # unbekannte Gruppe → nichts, nicht alles
        else:
            where.append("activity = ?"); args.append(activity)
    if fav_only:
        where.append("fav = 1")
    if planned is not None:
        # Effektiv heißt: die Hand-Korrektur schlägt die Schätzung.
        where.append("COALESCE(recorded_user, recorded) = ?")
        args.append(0 if planned else 1)
    if collection_id:
        where.append("geo_hash IN (SELECT geo_hash FROM collection_items WHERE collection_id = ?)")
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
        # `rz_norm`, nicht SQLites `lower()`: dessen Kleinschreibung kennt nur
        # ASCII (`lower('Ötztal')` bleibt 'Ötztal'), während Python die ganze
        # Unicode-Tabelle anwendet. Ein Schlagwort mit Umlaut war über diesen
        # Filter deshalb nie zu finden — während die Freitextsuche daneben es
        # fand, weil die schon immer über `rz_norm` lief.
        where.append("(',' || rz_norm(tags) || ',') LIKE ? ESCAPE '\\'")
        args.append(f"%,{_like_escape(_norm(t.strip()))},%")
    # Jedes Suchwort muss vorkommen — akzent-unempfindlich über `rz_norm`.
    # Findet der Text nichts, schlägt die Oberfläche den Begriff als ORT nach
    # und sucht über die Koordinaten weiter (siehe `library_search_place`).
    for w in (search or "").split():
        n = _norm(w)
        if n:
            # `%` und `_` sind in LIKE Platzhalter. Ohne Maskierung lieferte die
            # Suche nach „100%" die gesamte Sammlung und „Tour_2024" auch
            # „Tour 2024" — Treffer, die den Begriff gar nicht enthalten.
            where.append(f"rz_norm({_SEARCH_HAY}) LIKE ? ESCAPE '\\'")
            args.append(f"%{_like_escape(n)}%")
    return " AND ".join(where), args


@_locked
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
    include_hidden: bool = False,
    hidden_only: bool = False,
    missing_only: bool = False,
    with_geom: bool = False,
    collection_id: Optional[int] = None,
    von: Optional[str] = None,
    bis: Optional[str] = None,
) -> dict:
    """Gefilterte Trefferliste + Gesamtzahl (für „x von y").

    Unlesbare Dateien bleiben standardmäßig draußen — als Kachel wären sie
    leer und ohne Werte. Sie sind über `errors()` erreichbar, damit sie nicht
    stillschweigend verschwinden.
    """
    sql_where, args = _build_where(
        search=search, year=year, activity=activity, fav_only=fav_only, planned=planned,
        tags=tags, min_km=min_km, max_km=max_km, bbox=bbox,
        collection_id=collection_id, include_errors=include_errors,
        include_hidden=include_hidden, hidden_only=hidden_only,
        missing_only=missing_only, von=von, bis=bis)
    order = _SORTS.get(sort, _SORTS["date_desc"])
    if collection_id and sort == "collection":
        # Eigene Reihenfolge der Sammlung (Etappe 1, 2, 3 …).
        order = ("(SELECT sort_index FROM collection_items ci "
                 f"WHERE ci.geo_hash = tracks.geo_hash AND ci.collection_id = {int(collection_id)})")
    # Der Freitext steckt seit v0.9.492 in `_build_where` (via `rz_norm`) —
    # dadurch zählt `stats()` genau die Zeilen, die hier auch angezeigt werden.
    #
    # Gezählt und geblättert wird in SQL, nicht in Python. Vorher wurde die
    # GESAMTE Treffermenge geladen und erst danach geschnitten: Für 200
    # sichtbare Kacheln wanderten bei 5000 Touren alle 5000 Zeilen samt
    # Streckenverlauf (je ~1,6 KB) durch den Speicher. Und `geom` wird nur von
    # der Kartenansicht gebraucht — sonst gar nicht erst mitlesen.
    total = conn.execute(
        f"SELECT COUNT(*) FROM tracks WHERE {sql_where}", args).fetchone()[0]

    # `with_geom` will den Streckenverlauf für die Karte — NICHT den
    # FIT-Rohblock. Ein `SELECT *` schleppte den bei jeder Kartenansicht mit,
    # obwohl ihn dort nichts anfasst. Nur `get_track` (eine Tour) liest ihn.
    spalten = (_spalten_ohne_geom(conn) + ", geom") if with_geom \
        else _spalten_ohne_geom(conn)
    sql = f"SELECT {spalten} FROM tracks WHERE {sql_where} ORDER BY {order}"
    if limit:
        sql += f" LIMIT {int(limit)} OFFSET {int(offset)}"
    rows = conn.execute(sql, args).fetchall()
    return {"total": total, "items": [_to_dict(r, with_geom=with_geom) for r in rows]}


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
    # v0.9.501 — der FIT-Rohblock bleibt in der Datenbank; nach draußen geht nur
    # der kuratierte Auszug. `fitmeta` steckt nur in `get_track` (Detailansicht),
    # in Listen ist die Spalte gar nicht erst mitgelesen.
    if "fitmeta" in d:
        try:
            roh = json.loads(d.get("fitmeta") or "{}")
        except (TypeError, ValueError):
            roh = {}
        d["fit_fields"] = _fitmeta.anzeige_paare(roh)
        d["fit_raw_n"] = sum(len(v) for v in roh.values() if isinstance(v, dict))
        d.pop("fitmeta", None)
    # Startpunkt für die Listenansicht (Wunsch Beta-Tester). `place` ist der Ort,
    # `region` die Gegend darum — beides füllt der Ortslauf im Hintergrund. Kurz
    # für die Spalte, lang für den Tooltip.
    _ort = (d.get("place") or "").strip()
    _reg = (d.get("region") or "").strip()
    _land = (d.get("country") or "").strip()
    d["startort"] = _ort or _reg.split(" · ")[0] or _land
    d["startort_lang"] = " · ".join(x for x in (_ort, _reg, _land) if x)
    # Der eigene Name gewinnt; der Datei-Name bleibt daneben sichtbar.
    d["file_name"] = d.get("name") or ""
    d["name"] = (d.get("display_name") or "").strip() or d.get("name") or d.get("filename") or ""
    d["renamed"] = bool((d.get("display_name") or "").strip())
    d["hidden"] = int(d.get("hidden") or 0)
    # „gemacht" ist die effektive Bewertung: Hand-Korrektur schlägt Schätzung.
    eff = d.get("recorded_user")
    d["recorded_eff"] = int(eff if eff is not None else (d.get("recorded") or 0))
    d["recorded_manual"] = eff is not None
    d["planned"] = 0 if d["recorded_eff"] else 1
    d["distance_km"] = round((d.get("distance_m") or 0) / 1000.0, 2)
    d["missing_since"] = d.get("missing_since") or ""
    # KEIN Zugriff auf die Platte je Zeile. Das kostete bei 5000 Touren allein
    # 34 ms — und zwar bei JEDER Abfrage. Schlimmer: Genau die Datenträger, für
    # die `missing_since` erfunden wurde (abgezogene Platte, Netzlaufwerk),
    # antworten auf so eine Nachfrage sekundenlang oder gar nicht; das Archiv
    # stand dann bei jedem Tastendruck. `missing_since` weiß dasselbe, und es
    # steht schon in der Zeile.
    d["exists"] = not d["missing_since"]
    d["missing_days"] = round(_days_since(d["missing_since"])) if d["missing_since"] else 0
    return d


@_locked
def get_track(conn: sqlite3.Connection, path: str) -> Optional[dict]:
    r = conn.execute("SELECT * FROM tracks WHERE path = ?", (path,)).fetchone()
    if not r:
        return None
    d = _to_dict(r)
    # `activity_user` steht in `track_meta` und sagt der Oberfläche, ob die Art
    # geschätzt oder von Hand gesetzt ist. Bewusst hier nachgeschlagen statt per
    # JOIN in `query()`: die Bedingungen dort sind ohne Tabellen-Präfix
    # geschrieben, ein JOIN machte `geo_hash` mehrdeutig — und gebraucht wird
    # der Wert nur in der Detailspalte, also für genau eine Tour.
    m = conn.execute("SELECT activity_user FROM track_meta WHERE geo_hash = ?",
                     (d.get("geo_hash") or "",)).fetchone()
    d["activity_user"] = (m["activity_user"] if m else "") or ""
    return d


def _count_hidden(filters: dict) -> tuple:
    """SQL + Argumente für „wie viele ausgeblendete passen zu diesen Filtern"."""
    f = dict(filters)
    f.pop("fav_only", None)
    f.pop("planned", None)
    f["hidden_only"] = True
    w, a = _build_where(**f)
    return (f"SELECT COUNT(*) FROM tracks WHERE {w}", a)


@_locked
def stats(conn: sqlite3.Connection, **filters) -> dict:
    """Zahlen zur aktuellen Auswahl — dieselben Filter wie `query()`.

    Ohne Filter also das ganze Archiv, mit `collection_id` genau eine Sammlung,
    mit `planned=False` nur die gemachten Touren. So passt die Statistik immer
    zu dem, was gerade auf dem Schirm ist.
    """
    sql_where, args = _build_where(**filters)
    search = (filters.get("search") or "").strip()

    def rows(sql, extra=()):
        return conn.execute(sql, args + list(extra)).fetchall()

    r = conn.execute(
        f"SELECT COUNT(*) n, COALESCE(SUM(distance_m),0) d, COALESCE(SUM(ascent_m),0) a, "
        f"COALESCE(SUM(descent_m),0) de, COALESCE(SUM(moving_time_s),0) t, "
        f"COALESCE(MAX(distance_m),0) dmax, COALESCE(MAX(ascent_m),0) amax, "
        f"MIN(NULLIF(year,0)) y0, MAX(year) y1 "
        f"FROM tracks WHERE {sql_where}", args).fetchone()

    years = [{"year": x["year"], "n": x["n"], "km": round(x["d"] / 1000.0, 1),
              "ascent_m": round(x["a"] or 0), "hours": round((x["t"] or 0) / 3600.0, 1)}
             for x in rows(f"SELECT year, COUNT(*) n, SUM(distance_m) d, SUM(ascent_m) a, "
                           f"SUM(moving_time_s) t FROM tracks WHERE {sql_where} AND year > 0 "
                           f"GROUP BY year ORDER BY year")]

    # Monate: „01"…„12" quer über alle Jahre — zeigt die Saison.
    months = [{"month": int(x["m"] or 0), "n": x["n"], "km": round((x["d"] or 0) / 1000.0, 1)}
              for x in rows(f"SELECT CAST(substr(started_at, 6, 2) AS INTEGER) m, COUNT(*) n, "
                            f"SUM(distance_m) d FROM tracks WHERE {sql_where} "
                            f"AND length(started_at) >= 7 GROUP BY m ORDER BY m")]

    acts = [{"activity": x["activity"] or "", "n": x["n"], "km": round((x["d"] or 0) / 1000.0, 1)}
            for x in rows(f"SELECT activity, COUNT(*) n, SUM(distance_m) d FROM tracks "
                          f"WHERE {sql_where} GROUP BY activity ORDER BY n DESC")]

    # Fortbewegungsart je Jahr und je Monat (Wunsch Beta-Tester: „Vergleichen von
    # Fortbewegungsarten Monat mit Monat und Jahr mit Jahr — wie viel km und/oder
    # Zeit ich gewandert, gelaufen und Fahrrad gefahren bin").
    #
    # Beides in EINER Abfrage je Ebene statt einer pro Art: Bei einem Dutzend
    # Arten und acht Jahren wären das sonst hundert Durchläufe über die Tabelle.
    # Die Oberfläche bekommt flache Zeilen und gruppiert selbst.
    act_jahr = [{"year": x["y"], "activity": x["activity"] or "", "n": x["n"],
                 "km": round((x["d"] or 0) / 1000.0, 1),
                 "hours": round((x["t"] or 0) / 3600.0, 1)}
                for x in rows(
                    f"SELECT year y, activity, COUNT(*) n, SUM(distance_m) d, "
                    f"SUM(COALESCE(moving_time_s, duration_s)) t FROM tracks "
                    f"WHERE {sql_where} AND year > 0 "
                    f"GROUP BY y, activity ORDER BY y, n DESC")]

    act_monat = [{"month": x["m"], "activity": x["activity"] or "", "n": x["n"],
                  "km": round((x["d"] or 0) / 1000.0, 1),
                  "hours": round((x["t"] or 0) / 3600.0, 1)}
                 for x in rows(
                     f"SELECT substr(started_at, 1, 7) m, activity, COUNT(*) n, "
                     f"SUM(distance_m) d, SUM(COALESCE(moving_time_s, duration_s)) t "
                     f"FROM tracks WHERE {sql_where} AND length(started_at) >= 7 "
                     f"GROUP BY m, activity ORDER BY m, n DESC")]

    # ISO-Kalenderwochen (v0.9.505). ⚠️ SQLite kann das nicht: `strftime('%W')`
    # zählt ab dem ersten Sonntag und weicht an Jahreswechseln von ISO ab — der
    # 1. Januar 2027 liegt nach ISO in Woche 53 des Vorjahres, nach SQLite in
    # Woche 0 des neuen. Garmin und Komoot rechnen nach ISO, also wir auch.
    # Deshalb hier gruppieren statt in SQL: eine Abfrage, Zuordnung in Python.
    _wochen: dict = {}
    for x in rows(f"SELECT started_at, activity, distance_m d, "
                  f"COALESCE(moving_time_s, duration_s) t FROM tracks "
                  f"WHERE {sql_where} AND length(started_at) >= 10"):
        try:
            d = _date.fromisoformat(str(x["started_at"])[:10])
        except ValueError:
            continue
        iso = d.isocalendar()
        schluessel = (f"{iso[0]}-W{iso[1]:02d}", x["activity"] or "")
        e = _wochen.setdefault(schluessel, {"n": 0, "m": 0.0, "s": 0.0})
        e["n"] += 1
        e["m"] += x["d"] or 0
        e["s"] += x["t"] or 0
    act_woche = [{"week": w, "activity": a, "n": v["n"],
                  "km": round(v["m"] / 1000.0, 1),
                  "hours": round(v["s"] / 3600.0, 1)}
                 for (w, a), v in sorted(_wochen.items())]

    # Häufigste Startpunkte (Wunsch Beta-Tester: „Auswerten von genutzten
    # Startpunkten"). Der Ortslauf füllt `place`; ohne ihn bleibt die Liste leer,
    # und die Oberfläche sagt das dann auch.
    startorte = [{"ort": x["place"], "n": x["n"],
                  "km": round((x["d"] or 0) / 1000.0, 1)}
                 for x in rows(
                     f"SELECT place, COUNT(*) n, SUM(distance_m) d FROM tracks "
                     f"WHERE {sql_where} AND COALESCE(place,'') != '' "
                     f"GROUP BY place ORDER BY n DESC, place LIMIT 25")]

    longest = [_to_dict(x) for x in rows(
        f"SELECT * FROM tracks WHERE {sql_where} ORDER BY distance_m DESC LIMIT 5")]

    tags: dict = {}
    for x in rows(f"SELECT tags FROM tracks WHERE {sql_where} AND tags != ''"):
        for t in (x["tags"] or "").split(","):
            t = t.strip()
            if t:
                tags[t] = tags.get(t, 0) + 1

    # Gemacht/geplant getrennt — der Punkt, der Marc gestört hat.
    split = conn.execute(
        f"SELECT COALESCE(recorded_user, recorded) rec, COUNT(*) n, "
        f"COALESCE(SUM(distance_m),0) d FROM tracks WHERE {sql_where} GROUP BY rec", args).fetchall()
    done = next((x for x in split if x["rec"] == 1), None)
    plan = next((x for x in split if x["rec"] == 0), None)

    return {
        "n_tracks": r["n"],
        "total_km": round(r["d"] / 1000.0, 1),
        "total_ascent_m": round(r["a"] or 0),
        "total_descent_m": round(r["de"] or 0),
        "total_hours": round((r["t"] or 0) / 3600.0, 1),
        "longest_km": round((r["dmax"] or 0) / 1000.0, 1),
        "max_ascent_m": round(r["amax"] or 0),
        "avg_km": round((r["d"] / 1000.0 / r["n"]), 1) if r["n"] else 0,
        "year_min": r["y0"] or 0,
        "year_max": r["y1"] or 0,
        "years": years,
        "months": months,
        "activities": acts,
        "act_by_year": act_jahr,
        "act_by_month": act_monat,
        "act_by_week": act_woche,
        "startorte": startorte,
        "longest": longest,
        "tags": sorted(tags.items(), key=lambda kv: -kv[1]),
        "done": {"n": done["n"] if done else 0,
                 "km": round((done["d"] if done else 0) / 1000.0, 1)},
        "planned": {"n": plan["n"] if plan else 0,
                    "km": round((plan["d"] if plan else 0) / 1000.0, 1)},
        # Favoriten + Ausgeblendete: dieselben Filter, aber jeweils mit der
        # eigenen Klausel statt der aus `filters` — das sind die Zahlen neben
        # den Bereichen in der Seitenleiste. Bei „Ausgeblendete" muss die
        # `hidden = 0`-Klausel des Standard-WHERE ersetzt werden, sonst käme
        # dort immer 0 heraus.
        "n_fav": conn.execute(
            f"SELECT COUNT(*) FROM tracks WHERE {sql_where} AND fav = 1", args).fetchone()[0],
        "n_hidden": conn.execute(*_count_hidden(filters)).fetchone()[0],
        # Wie viele Touren liegen gerade auf einer Platte, die nicht da ist?
        "n_missing": conn.execute(
            f"SELECT COUNT(*) FROM tracks WHERE {sql_where} AND missing_since != ''",
            args).fetchone()[0],
        # Zwei Zahlen, weil zwei Dinge gemeint sind: `n_failed` sind alle nicht
        # weggeräumten Fehler-Zeilen, `n_nogps` davon die ohne Koordinaten. Sind
        # beide gleich groß, ist gar nichts kaputt — dann darf die Oberfläche
        # auch nicht „nicht lesbar" sagen.
        "n_failed": conn.execute(
            "SELECT COUNT(*) FROM tracks WHERE error != '' AND COALESCE(hidden,0) = 0"
        ).fetchone()[0],
        "n_nogps": conn.execute(
            "SELECT COUNT(*) FROM tracks WHERE error != '' AND COALESCE(hidden,0) = 0 "
            "AND error_kind = 'no_points'").fetchone()[0],
        "search_note": search,
    }


@_locked
def set_user_fields(conn: sqlite3.Connection, path: str, fav=None, tags=None, note=None) -> bool:
    fields = {}
    if fav is not None:
        fields["fav"] = 1 if fav else 0
    if tags is not None:
        # Die Oberfläche schickt eine Liste. Kommt trotzdem ein String an (etwa
        # aus einem Skript oder einem Test), würde `for t in tags` über die
        # ZEICHEN laufen: aus „Ötztal,Bergtour" würde „,,B,a,e,g,l,…" — lautlos,
        # und das Schlagwort wäre danach unauffindbar.
        if isinstance(tags, str):
            tags = tags.split(",")
        fields["tags"] = ",".join(sorted({t.strip() for t in tags if t.strip()}))
    if note is not None:
        fields["note"] = str(note)
    if not fields:
        return False
    return _set_meta(conn, path, **fields)


@_locked
def set_activity(conn: sqlite3.Connection, path: str, activity: str) -> bool:
    """Fortbewegungsart von Hand setzen — leerer Wert stellt die Schätzung her.

    Der Wert hängt am `geo_hash`, nicht am Pfad: eine Korrektur überlebt
    Neu-Einlesen, Umbenennen und Verschieben, und sie gilt sofort für alle
    Kopien derselben Tour.
    """
    wert = (activity or "").strip().lower()
    if wert and wert not in ACTIVITIES:
        raise ValueError(f"Unbekannte Fortbewegungsart: {activity!r}")
    geo = _geo_of(conn, path)
    if not geo:
        return False
    now = _now_iso()
    conn.execute("INSERT INTO track_meta(geo_hash, activity_user, first_seen, last_seen) "
                 "VALUES(?,?,?,?) ON CONFLICT(geo_hash) DO UPDATE SET "
                 "activity_user = excluded.activity_user, last_seen = excluded.last_seen",
                 (geo, wert, now, now))
    if wert:
        conn.execute("UPDATE tracks SET activity = ? WHERE geo_hash = ?", (wert, geo))
    else:
        # Zurück auf die Schätzung — pro Datei neu, weil sie von Name, Distanz
        # und Fahrzeit abhängt und die je Kopie abweichen können.
        for r in conn.execute("SELECT path, name, distance_m, moving_time_s FROM tracks "
                              "WHERE geo_hash = ?", (geo,)).fetchall():
            conn.execute("UPDATE tracks SET activity = ? WHERE path = ?",
                         (_guess_activity(r["name"] or "", r["distance_m"] or 0.0,
                                          r["moving_time_s"] or 0.0), r["path"]))
    conn.commit()
    return True


@_locked
def set_color(conn: sqlite3.Connection, path: str, color: str) -> bool:
    """Eigene Track-Farbe für die Übersichtskarte. Leer = wieder automatisch.

    Hängt am `geo_hash` wie alles Dauerhafte: überlebt Neu-Einlesen und gilt
    für alle Kopien derselben Tour.
    """
    wert = (color or "").strip().lower()
    if wert and not re.fullmatch(r"#[0-9a-f]{6}", wert):
        raise ValueError(f"Keine Farbe im Format #rrggbb: {color!r}")
    geo = _geo_of(conn, path)
    if not geo:
        return False
    now = _now_iso()
    conn.execute("INSERT INTO track_meta(geo_hash, color, first_seen, last_seen) "
                 "VALUES(?,?,?,?) ON CONFLICT(geo_hash) DO UPDATE SET "
                 "color = excluded.color, last_seen = excluded.last_seen",
                 (geo, wert, now, now))
    conn.execute("UPDATE tracks SET color = ? WHERE geo_hash = ?", (wert, geo))
    conn.commit()
    return True


@_locked
def set_recorded(conn: sqlite3.Connection, path: str, value) -> None:
    """Hand-Korrektur: True = gemacht, False = geplant, None = wieder schätzen."""
    _set_meta(conn, path, recorded_user=(None if value is None else (1 if value else 0)))


@_locked
def set_display_name(conn: sqlite3.Connection, path: str, name: str) -> None:
    """Eigener Name. Leer = wieder der Name aus der Datei."""
    _set_meta(conn, path, display_name=(name or "").strip())


@_locked
def set_hidden(conn: sqlite3.Connection, path: str, hidden: bool) -> None:
    _set_meta(conn, path, hidden=1 if hidden else 0)


@_locked
def _in_den_papierkorb(p: Path) -> str:
    """Datei in den **echten** Papierkorb des Systems legen.

    ⚠️ Bis v0.9.501 stand auf dem Knopf „In den Papierkorb", aber auf Windows
    verschob der Code die Datei nach `C:\\Users\\<Name>\\Trash` — ein selbst
    angelegter Ordner, NICHT der Papierkorb. Sie tauchte dort also nie auf, ließ
    sich nicht über „Wiederherstellen" zurückholen und wurde nie geleert. Ein
    Nutzer fragte deshalb zu Recht: „Wann ist die Datei endgültig weg?" — die
    ehrliche Antwort wäre „nie" gewesen.

    Reihenfolge:
      1. `send2trash` — die einzige Umsetzung, die auf allen drei Systemen im
         echten Papierkorb landet (Windows: Shell-API, Linux: freedesktop-Trash
         MIT `.trashinfo`, also inklusive „Zurücklegen").
      2. macOS-Rückfall über den Finder, falls das Paket im Bundle fehlt.
      3. Letzter Rückfall: in einen Ordner verschieben. Kein echter Papierkorb,
         aber immer noch besser, als die Datei zu löschen — und der Rückgabewert
         nennt dann den vollen Pfad, damit die Oberfläche nichts Falsches
         verspricht.
    """
    import shutil
    import subprocess
    import sys as _sys

    try:
        from send2trash import send2trash  # type: ignore
        send2trash(str(p))
        return "Papierkorb"
    except ImportError:
        pass
    except Exception as e:
        log.warning("library: send2trash fehlgeschlagen (%s) — Rückfall", e)

    if _sys.platform == "darwin":
        script = ('tell application "Finder" to delete POSIX file "%s"'
                  % str(p).replace('"', '\\"'))
        r = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
        if r.returncode != 0:
            raise OSError(r.stderr.strip() or "Papierkorb nicht erreichbar")
        return "Papierkorb"

    ordner = Path.home() / (".local/share/Trash/files"
                            if _sys.platform.startswith("linux") else "Trash")
    ordner.mkdir(parents=True, exist_ok=True)
    ziel = ordner / p.name
    i = 1
    while ziel.exists():
        ziel = ordner / f"{p.stem} ({i}){p.suffix}"
        i += 1
    shutil.move(str(p), str(ziel))
    return str(ziel)


def trash_file(conn: sqlite3.Connection, path: str) -> dict:
    """Legt die Datei in den Papierkorb und nimmt sie aus dem Archiv.

    Bewusst **Papierkorb statt Löschen**: Das Archiv fasst fremde Dateien an —
    ein Versehen muss rückholbar bleiben. Endgültig entscheidet der Nutzer,
    wenn er seinen Papierkorb leert.
    """
    p = Path(path)
    if not p.exists():
        forget(conn, path)
        return {"ok": True, "missing": True}
    moved_to = _in_den_papierkorb(p)
    forget(conn, path)
    return {"ok": True, "moved_to": moved_to,
            # Sagt der Oberfläche, ob sie „liegt im Papierkorb" versprechen darf.
            "echter_papierkorb": moved_to == "Papierkorb"}


@_locked
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
        conn.execute("UPDATE tracks SET map_thumb = ? WHERE geo_hash = ?",
                     (str(out), row.get("geo_hash") or ""))
        conn.commit()
        return str(out)

    # Der Pfad steckt als kodierte Polylinie in der URL; `auto` lässt Mapbox
    # Ausschnitt und Zoom aus der Linie selbst bestimmen.
    poly = urllib.parse.quote(_encode_polyline(pts), safe="")
    url = (f"https://api.mapbox.com/styles/v1/mapbox/{style}/static/"
           f"path-4+{line_color}-1({poly})/auto/{width}x{height}@2x"
           f"?access_token={urllib.parse.quote(token)}&attribution=false&logo=false")
    req = urllib.request.Request(url, headers={"User-Agent": "ReisezoomGPSStudio"})
    # TLS-Kontext siehe core/net.py.
    from . import net
    with urllib.request.urlopen(req, timeout=timeout, context=net.ssl_context()) as resp:
        data = resp.read()
    if not data:
        return ""
    # Erst vollständig daneben schreiben, dann umbenennen. Ein hartes Aus der
    # App (`os._exit`) zwischen Schreiben und Eintragen hinterließ sonst ein
    # halbes PNG — und weil die Prüfung beim nächsten Start nur „Datei da und
    # größer als 0" lautet, galt das kaputte Bild dauerhaft als gültiger Cache.
    tmp = out.with_name(out.name + f".{os.getpid()}.tmp")
    try:
        tmp.write_bytes(data)
        os.replace(tmp, out)
    finally:
        try:
            if tmp.exists():
                tmp.unlink()
        except OSError:
            pass
    # ⚠️ Diese Funktion läuft im Hintergrund-Thread und teilt sich die
    # Verbindung mit den Abfragen der Oberfläche. Ohne den Modul-Lock schreibt
    # sie im Sekundentakt mitten in eine laufende Abfragefolge — genau der Fall,
    # den der Kommentar am Modulkopf beschreibt.
    with _DB_LOCK:
        conn.execute("UPDATE tracks SET map_thumb = ? WHERE geo_hash = ?",
                     (str(out), row.get("geo_hash") or ""))
        conn.commit()
    return str(out)


# Die Bedingung „hat Streckenverlauf, aber noch kein Kartenbild" — einmal
# hingeschrieben, damit Liste und Zählung nicht auseinanderlaufen können.
_MAP_PENDING_WHERE = "error = '' AND geom != '' AND map_thumb = ''"


@_locked
def map_thumbs_pending_count(conn: sqlite3.Connection) -> int:
    """Nur die ANZAHL offener Kartenbilder.

    Die Oberfläche fragt den Fortschritt alle fünf Sekunden ab und brauchte
    davon immer nur die Zahl — holte sich aber über `map_thumbs_pending()` die
    kompletten Zeilen samt Streckenverlauf. Bei 5000 Touren waren das rund
    130 ms und einige MB Python-Objekte, 24-mal pro Minute, dauerhaft. Und die
    ganze Zeit lag dabei die Datenbanksperre auf allem anderen.
    """
    return conn.execute(
        f"SELECT COUNT(*) FROM tracks WHERE {_MAP_PENDING_WHERE}").fetchone()[0]


@_locked
def map_thumbs_pending(conn: sqlite3.Connection) -> list:
    """Touren mit Streckenverlauf, aber ohne gecachtes Karten-Vorschaubild.

    Wer nur zählen will, nimmt `map_thumbs_pending_count()` — das ist um
    Größenordnungen billiger.
    """
    rows = conn.execute(
        f"SELECT * FROM tracks WHERE {_MAP_PENDING_WHERE} ORDER BY started_at DESC"
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
    pause_s: float = 0.0,
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
        # `pause_s` bremst den Hintergrundlauf bewusst aus: die Bilder sollen
        # nebenbei eintröpfeln, nicht die Mapbox-Quota in einem Rutsch fressen.
        if pause_s and i < len(todo) - 1:
            end = time.monotonic() + pause_s
            while time.monotonic() < end:
                if should_stop and should_stop():
                    break
                time.sleep(min(0.25, max(0.0, end - time.monotonic())))
    return {"total": len(todo), "ok": done, "failed": failed, "error": err}


# ── Eigenes Titelbild ────────────────────────────────────────────────────────

@_locked
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
    _set_meta(conn, path, cover=str(out))
    return str(out)


@_locked
def clear_cover(conn: sqlite3.Connection, path: str) -> None:
    row = conn.execute("SELECT cover FROM tracks WHERE path = ?", (path,)).fetchone()
    if row and row["cover"]:
        try:
            Path(row["cover"]).unlink()
        except OSError:
            pass
    _set_meta(conn, path, cover="")


# ── Sammlungen ──────────────────────────────────────────────────────────────
#
# Eine Sammlung fasst Touren zu einer Einheit zusammen: die sechs Etappen einer
# Mehrtagestour, alle Touren einer Reise, eine Themenserie. Bewusst als eigene
# Tabelle und nicht als Schlagwort — eine Sammlung hat eine **Reihenfolge**
# (Etappe 1, 2, 3 …), und genau die braucht der Animator, wenn er sie am Stück
# abfliegt.

@_locked
def collections(conn: sqlite3.Connection) -> list:
    """Alle Sammlungen mit Anzahl + Summen."""
    rows = conn.execute("SELECT * FROM collections ORDER BY name COLLATE NOCASE").fetchall()
    out = []
    for r in rows:
        agg = conn.execute(
            "SELECT COUNT(*) n, COALESCE(SUM(t.distance_m),0) d, COALESCE(SUM(t.ascent_m),0) a "
            "FROM collection_items ci JOIN tracks t ON t.geo_hash = ci.geo_hash "
            "WHERE ci.collection_id = ?", (r["id"],)
        ).fetchone()
        out.append({"id": r["id"], "name": r["name"], "note": r["note"] or "",
                    "created_at": r["created_at"] or "", "n": agg["n"],
                    "total_km": round(agg["d"] / 1000.0, 1),
                    "total_ascent_m": round(agg["a"])})
    return out


@_locked
def collection_create(conn: sqlite3.Connection, name: str, paths: Optional[list] = None) -> int:
    cur = conn.execute("INSERT INTO collections(name, created_at) VALUES(?,?)",
                       (name.strip() or "Sammlung", _now_iso()))
    cid = cur.lastrowid
    if paths:
        collection_add(conn, cid, paths)
    conn.commit()
    return cid


@_locked
def collection_rename(conn: sqlite3.Connection, cid: int, name: str) -> None:
    conn.execute("UPDATE collections SET name = ? WHERE id = ?", (name.strip(), cid))
    conn.commit()


@_locked
def collection_delete(conn: sqlite3.Connection, cid: int) -> None:
    """Löscht die Sammlung — die Touren selbst bleiben natürlich im Archiv."""
    conn.execute("DELETE FROM collection_items WHERE collection_id = ?", (cid,))
    conn.execute("DELETE FROM collections WHERE id = ?", (cid,))
    conn.commit()


@_locked
def collection_add(conn: sqlite3.Connection, cid: int, paths: list) -> int:
    """Touren anhängen. Reihenfolge = Reihenfolge des Hinzufügens."""
    start = conn.execute(
        "SELECT COALESCE(MAX(sort_index), -1) + 1 FROM collection_items WHERE collection_id = ?",
        (cid,)).fetchone()[0]
    added = 0
    for i, p in enumerate(paths):
        gh = _geo_of(conn, p)
        if not gh:
            continue
        cur = conn.execute(
            "INSERT OR IGNORE INTO collection_items(collection_id, geo_hash, sort_index) "
            "VALUES(?,?,?)", (cid, gh, start + i))
        added += cur.rowcount
    conn.commit()
    return added


@_locked
def collection_remove(conn: sqlite3.Connection, cid: int, paths: list) -> None:
    for p in paths:
        gh = _geo_of(conn, p)
        if gh:
            conn.execute("DELETE FROM collection_items WHERE collection_id = ? AND geo_hash = ?",
                         (cid, gh))
    conn.commit()


@_locked
def collection_sort_by_date(conn: sqlite3.Connection, cid: int) -> None:
    """Nach Datum ordnen — bei Mehrtagestouren fast immer die richtige Folge."""
    rows = conn.execute(
        "SELECT ci.geo_hash, MIN(t.started_at) s, MIN(t.mtime) m FROM collection_items ci "
        "JOIN tracks t ON t.geo_hash = ci.geo_hash WHERE ci.collection_id = ? "
        "GROUP BY ci.geo_hash ORDER BY s, m", (cid,)).fetchall()
    for i, r in enumerate(rows):
        conn.execute("UPDATE collection_items SET sort_index = ? "
                     "WHERE collection_id = ? AND geo_hash = ?", (i, cid, r["geo_hash"]))
    conn.commit()


@_locked
def collection_items(conn: sqlite3.Connection, cid: int) -> list:
    # Bei doppelt vorliegenden Dateien (gleicher Verlauf) genügt eine davon.
    rows = conn.execute(
        "SELECT t.* FROM collection_items ci JOIN tracks t ON t.geo_hash = ci.geo_hash "
        "WHERE ci.collection_id = ? GROUP BY ci.geo_hash ORDER BY ci.sort_index",
        (cid,)).fetchall()
    return [_to_dict(r) for r in rows]


@_locked
def collections_of(conn: sqlite3.Connection, path: str) -> list:
    rows = conn.execute(
        "SELECT c.id, c.name FROM collection_items ci JOIN collections c ON c.id = ci.collection_id "
        "WHERE ci.geo_hash = ? ORDER BY c.name COLLATE NOCASE", (_geo_of(conn, path),)).fetchall()
    return [{"id": r["id"], "name": r["name"]} for r in rows]


def _fehler_wo(include_dismissed: bool) -> str:
    return "error != ''" if include_dismissed else \
        "error != '' AND COALESCE(hidden,0) = 0"


@_locked
def errors_count(conn: sqlite3.Connection, include_dismissed: bool = False) -> dict:
    """Wie viele Dateien fielen durch — getrennt nach Grund.

    Nur Zahlen: Bei einem Nutzer standen **98692** Fehler-Zeilen in der
    Datenbank; die alle zu laden, um sie zu zeigen, legte die Oberfläche für
    Minuten lahm.
    """
    wo = _fehler_wo(include_dismissed)
    r = conn.execute(
        f"SELECT COUNT(*) n, "
        f"SUM(CASE WHEN error_kind = 'no_points' THEN 1 ELSE 0 END) ohne "
        f"FROM tracks WHERE {wo}").fetchone()
    gesamt = r["n"] or 0
    ohne = r["ohne"] or 0
    return {"gesamt": gesamt, "ohne_strecke": ohne, "kaputt": gesamt - ohne}


@_locked
def errors(conn: sqlite3.Connection, include_dismissed: bool = False,
           limit: int = 300) -> list:
    """Dateien, aus denen keine Tour wurde — sortiert: erst die kaputten.

    `error_kind` trennt „gelesen, aber ohne Koordinaten" (`no_points`) von
    „wirklich kaputt" (`broken`). Weggeräumte stehen nur auf Wunsch dabei.

    ⚠️ **Mit Deckel.** Ein Nutzer hatte 98692 Fehler-Zeilen; die Oberfläche
    baute daraus 98692 Zeilen mit Auswahlkästchen und fror ein („man kann das
    Programm auch nicht mehr bedienen"). Die Gesamtzahl kommt aus
    `errors_count()`, angezeigt wird ein Ausschnitt. Wer alle wegräumen will,
    braucht die Liste ohnehin nicht — dafür gibt es `dismiss_all_errors()`.
    """
    wo = _fehler_wo(include_dismissed)
    sql = (f"SELECT * FROM tracks WHERE {wo} "
           "ORDER BY CASE WHEN error_kind = 'no_points' THEN 1 ELSE 0 END, "
           "filename COLLATE NOCASE")
    if limit:
        sql += f" LIMIT {int(limit)}"
    return [_to_dict(r) for r in conn.execute(sql).fetchall()]


@_locked
def dismiss_all_errors(conn: sqlite3.Connection, nur_art: str = "") -> int:
    """ALLE Fehler-Meldungen wegräumen, ohne sie einzeln anzuhaken.

    Bei 98692 Zeilen ist Anhaken keine Bedienung mehr. `nur_art` schränkt auf
    `no_points` oder `broken` ein — meist will man die harmlosen „ohne Strecke"
    loswerden und die echten Defekte behalten.

    Gelöscht wird auch hier nichts: nur `hidden`, wie beim einzelnen Wegräumen.
    """
    wo = "error != '' AND COALESCE(hidden,0) = 0"
    args: list = []
    if nur_art in ("no_points", "broken"):
        wo += " AND error_kind = ?"
        args.append(nur_art)
    cur = conn.execute(f"UPDATE tracks SET hidden = 1 WHERE {wo}", args)
    conn.commit()
    return cur.rowcount or 0


@_locked
def dismiss_errors(conn: sqlite3.Connection, paths: list, weg: bool = True) -> int:
    """Fehler-Zeilen aus der Liste nehmen (oder zurückholen).

    Gelöscht wird **nichts** — weder die Datei noch der Eintrag. Die Zeile
    bekommt nur `hidden`, und weil `hidden` nicht zu den technischen Spalten
    gehört, überlebt das jedes Neu-Einlesen. Ohne diesen Weg blieben 61
    Hallen-Einheiten für immer als Warnung stehen: der Nutzer kann die Dateien
    nicht ändern, und wegwerfen will er sie auch nicht.
    """
    if not paths:
        return 0
    q = ",".join("?" * len(paths))
    cur = conn.execute(
        f"UPDATE tracks SET hidden = ? WHERE path IN ({q}) AND error != ''",
        [1 if weg else 0] + list(paths))
    conn.commit()
    return cur.rowcount or 0


@_locked
def forget(conn: sqlite3.Connection, path: str) -> None:
    """Nimmt eine Tour aus dem Archiv — die Datei selbst bleibt liegen."""
    conn.execute("DELETE FROM tracks WHERE path = ?", (path,))
    conn.commit()


# ── Aufräumen (sehr langsam) ────────────────────────────────────────────────

# Wie lange Bilder und Notizen zu einer Tour aufgehoben werden, die nirgends
# mehr im Archiv liegt. Bewusst großzügig: eine externe Platte ist mal ein Jahr
# nicht angesteckt, und ein Kartenbild kostet 30 KB. Selbst gewählte Titelbilder
# und Meta-Zeilen mit echten Eingaben werden NIE automatisch gelöscht — die sind
# unersetzlich, die Bilder nicht.
CACHE_KEEP_DAYS = 400


@_locked
def housekeeping(conn: sqlite3.Connection, thumbs_dir: Path, map_thumbs_dir: Path,
                 covers_dir: Path, keep_days: int = CACHE_KEEP_DAYS) -> dict:
    """Verwaiste Vorschaubilder aufräumen — sehr zurückhaltend.

    Gelöscht wird nur, was (a) zu keiner Tour im Archiv gehört, (b) zu keiner
    Meta-Zeile mit echter Nutzer-Eingabe gehört und (c) älter als `keep_days`
    ist. Titelbilder (`covers`) bleiben immer.
    """
    alive = {r["geo_hash"] for r in conn.execute(
        "SELECT DISTINCT geo_hash FROM tracks WHERE geo_hash IS NOT NULL AND geo_hash != ''")}
    alive |= {r["geo_hash"] for r in conn.execute(
        "SELECT geo_hash FROM track_meta WHERE fav = 1 OR tags != '' OR note != '' "
        "OR cover != '' OR recorded_user IS NOT NULL OR display_name != '' OR hidden = 1")}
    alive |= {r["geo_hash"] for r in conn.execute("SELECT DISTINCT geo_hash FROM collection_items")}

    cutoff = time.time() - keep_days * 86400
    removed = freed = 0
    for d, ext in ((Path(thumbs_dir), ".png"), (Path(map_thumbs_dir), ".png")):
        if not d.is_dir():
            continue
        for f in d.glob("*" + ext):
            if f.stem in alive:
                continue
            try:
                st = f.stat()
                if st.st_mtime > cutoff:
                    continue
                size = st.st_size
                f.unlink()
                removed += 1
                freed += size
            except OSError:
                pass
    if removed:
        log.info("library.housekeeping: %d verwaiste Bilder gelöscht (%.1f MB)",
                 removed, freed / 1e6)
    return {"removed": removed, "freed_mb": round(freed / 1e6, 1),
            "keep_days": keep_days, "known": len(alive)}


# ── Gegenden benennen (damit die Suche „Teneriffa" findet) ──────────────────
#
# Die Spalten `place`, `country` und `region` gab es von Anfang an, und die Suche
# durchsucht sie — **gefüllt hat sie nie jemand.** Ergebnis: Wer „Teneriffa"
# eingab, fand nichts, obwohl 163 Touren dort liegen. Das Archiv wusste, WO die
# Tour ist, nur nicht, wie die Gegend heißt.
#
# Warum mehrere Punkte je Tour: Eine Fahrt von Berlin nach Teneriffa hat ihren
# Mittelpunkt irgendwo im Atlantik. Ein einziger Abruf würde also weder „Berlin"
# noch „Teneriffa" liefern, sondern nichts Brauchbares. Deshalb werden Start,
# Ziel und einige Punkte dazwischen abgefragt und die **Menge** der Gegenden
# gespeichert — die Tour ist dann unter beiden Namen zu finden.
#
# Warum das nicht teuer ist: Die Punkte werden vorher auf ein grobes Raster
# gerundet, und `geocode.reverse` cacht ohnehin. Eine Tour, die in einer Gegend
# bleibt, kostet damit einen einzigen echten Abruf; erst eine Tour über Länder
# hinweg kostet mehrere.

_ORT_ANKER_MAX = 6          # höchstens so viele Abfragen je Tour
_ORT_RASTER = 0.25          # ~25 km — feiner lohnt sich für eine Ortssuche nicht


def _ort_anker(geom: list) -> list:
    """Start, Ziel und einige Punkte dazwischen — auf grobem Raster entdoppelt."""
    if not geom:
        return []
    n = len(geom)
    idx = {0, n - 1}
    for k in range(1, _ORT_ANKER_MAX - 1):
        idx.add(int(round(k * (n - 1) / (_ORT_ANKER_MAX - 1))))
    roh = [geom[i] for i in sorted(idx) if 0 <= i < n]
    gesehen, out = set(), []
    for p in roh:
        try:
            lon, lat = float(p[0]), float(p[1])
        except (TypeError, ValueError, IndexError):
            continue
        schluessel = (round(lat / _ORT_RASTER), round(lon / _ORT_RASTER))
        if schluessel in gesehen:
            continue
        gesehen.add(schluessel)
        out.append((lat, lon))
    return out


def _ort_zusammenfassen(treffer: list) -> dict:
    """Aus mehreren Adressen die drei Suchfelder bauen — Reihenfolge bleibt."""
    def sammeln(feld: str) -> str:
        out = []
        for a in treffer:
            v = ((a or {}).get(feld) or "").strip()
            if v and v not in out:
                out.append(v)
        return " · ".join(out[:6])
    # `county` (Provinz/Insel/Landkreis) wandert mit in die Region: bei
    # Teneriffa steht dort „Santa Cruz de Tenerife", und ohne das findet die
    # Suche die Insel überhaupt nicht — `state` sagt nur „Kanarische Inseln".
    region = " · ".join(x for x in (sammeln("county"), sammeln("state")) if x)
    return {"place": sammeln("city"), "region": region,
            "country": sammeln("country")}


_ORTE_FEHLEN_WHERE = ("COALESCE(place,'') = '' AND COALESCE(country,'') = '' "
                      "AND COALESCE(geom,'') != '' AND error = ''")


@_locked
def orte_fehlen_count(conn: sqlite3.Connection) -> int:
    """Nur die ANZAHL der Touren ohne Ortsangabe — siehe
    `map_thumbs_pending_count()` für die Begründung."""
    return conn.execute(
        f"SELECT COUNT(*) FROM tracks WHERE {_ORTE_FEHLEN_WHERE}").fetchone()[0]


@_locked
def orte_fehlen(conn: sqlite3.Connection, limit: int = 0) -> list:
    """Touren ohne Ortsangabe (die noch abzufragen sind)."""
    sql = f"SELECT path, geom FROM tracks WHERE {_ORTE_FEHLEN_WHERE}"
    if limit:
        sql += f" LIMIT {int(limit)}"
    return [{"path": r["path"], "geom": r["geom"]} for r in conn.execute(sql).fetchall()]


@_locked
def ort_speichern(conn: sqlite3.Connection, path: str, felder: dict) -> None:
    """Gefundene Gegend an der Datei UND am Streckenverlauf hinterlegen.

    Am `geo_hash`, damit dieselbe Tour in einem anderen Ordner nicht noch einmal
    abgefragt wird — und damit die Angabe ein Neu-Einlesen überlebt.
    """
    conn.execute("UPDATE tracks SET place = ?, region = ?, country = ? WHERE path = ?",
                 (felder.get("place", ""), felder.get("region", ""),
                  felder.get("country", ""), path))
    geo = _geo_of(conn, path)
    if geo:
        conn.execute("UPDATE tracks SET place = ?, region = ?, country = ? "
                     "WHERE geo_hash = ? AND COALESCE(place,'') = ''",
                     (felder.get("place", ""), felder.get("region", ""),
                      felder.get("country", ""), geo))
    conn.commit()
