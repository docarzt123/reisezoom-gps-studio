"""Der Foto-Bestand — Fotos und Videos als gemeinsame Quelle aller Werkzeuge.

Beschlossen mit Marc am 12.09.2026 (Grilling, `docs/IDEAS.md` §64). Marc:
„man gibt wie beim archiv einen oder mehrere ordner und das tool zeigt die
bilder auf einer karte an oder nach datum oder wie auch immer. darauf kann man
direkt in den einzelnen tools zugreifen."

**Warum es das gibt.** Fotos lagen dreifach herum: der Geotagger scannte
Ordner, die Tour-Map hielt ihre Pins im Projekt, das Highlights-Fenster seine
Ordner nur im Speicher. Dreimal dieselben Dateien, dreimal EXIF neu gelesen,
kein gemeinsamer Bestand. Hier steht er.

**Was entschieden ist (Runde 1–3 des Grillings):**

- Der Bestand liegt in der **Archiv-Datenbank** (`library.db`), nicht in einer
  zweiten Datenbank. Sie hat Ordnerverwaltung, Umzug und Sicherungen schon.
- **Videos gehören dazu** (Marc zweimal betont).
- **Stufe 1 liest nur.** Keine Datei wird angefasst. Geschätzte Koordinaten
  (später) leben in der Datenbank, ins Bild schreibt allein der Geotagger.
- **Alle Tags kommen in die Datenbank** (Marc: „damit kann man eine viel
  bessere suche bauen"). Gemessen am 12.09.2026 an echten Dateien: alles lesen
  kostet nicht mehr als acht Felder, gepackt bleiben ~1,9 KB je Datei.
- **Zwei Durchgänge:** erst die Dateiliste (Sekunden), dann Aufnahmedaten und
  Vorschaubilder im Hintergrund — mit Fortschritt und Abbrechen, wie der
  Track-Scan.
- **Fotos zu Touren werden gerechnet, nicht gespeichert** — über das
  Zeitfenster der Tour. Sonst müsste jede Zeitzonen-Korrektur alles neu
  schreiben.
- **Ortsnamen** kommen nur aus den Bild-Daten selbst (der Geotagger schreibt
  sie dorthin). Fehlt etwas, sagt das Foto es sichtbar, statt still zu lügen.

Der Zugriff der Werkzeuge (Foto-Pins, Schilder, Highlights) und das Verorten
ohne Track sind eigene Stufen — siehe §64.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import sqlite3
import sys
import threading
import time
import zlib
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Iterable, Optional

from . import exif as cexif
from . import photos as cphotos

log = logging.getLogger(__name__)

# Ordner, die ein Scan nie betritt — dieselbe Liste wie im Track-Archiv, plus
# die Fotomediathek: Apple verwaltet sie selbst, ein Fremdzugriff auf ihr
# Inneres ist weder erlaubt noch sinnvoll.
SKIP_DIRS = {
    ".git", "node_modules", "__pycache__", ".venv", "venv",
    "$RECYCLE.BIN", "System Volume Information", ".Trash", ".Trashes",
    "_renders", "photo_thumb_cache",
    # 04.10.2026 — NAS-eigene Ordner: Papierkorb und Schnappschüsse (Synology „#recycle"/„#snapshot", QNAP „@Recycle"/
    # „@Recently-Snapshot") und Synologys eigene Vorschaubilder („@eaDir"). Im Ordnerbaum tauchte „#recycle" mit
    # gelöschten Fotos auf.
    "#recycle", "#snapshot", "@eaDir", "@Recycle", "@Recently-Snapshot", "@SynoResource",
}
SKIP_SUFFIXE = (".photoslibrary", ".photoslibrary/", ".aplibrary", ".migratedphotolibrary")

# Wie tief ein nicht-rekursiver Ordner gelesen wird: gar nicht tief.
# Rekursive Ordner haben eine Grenze, damit ein versehentlich gewähltes
# Wurzelverzeichnis nicht die halbe Platte einliest.
TIEFE_MAX = 8

# Stapelgröße für exiftool. Gemessen: der Aufruf selbst kostet mehr als die
# Dateien darin, 60 ist ein guter Kompromiss zwischen Tempo und Abbrechbarkeit.
STAPEL = 60
# Auf einem Netzlaufwerk (NAS im WLAN) kleiner: ein Stapel ist die Einheit, die
# bei einem exiftool-Hänger vertagt und in Teilen wiederholt wird — 60 Dateien
# über WLAN sind dafür zu viel am Stück (14.09.2026).
STAPEL_FERN = 20
# Wie ein Stapel nach einem Hänger zerlegt wird: 60 → 10 → 1. Erst die Einzel-
# datei, die dann noch hängt, bekommt den Fehlerstempel — nicht ihre 59 Nachbarn.
STAPEL_TEILUNG = (10, 1)
# So viele Einzeldateien dürfen in EINEM Lauf hängen, dann gilt exiftool bzw. das
# Laufwerk als weg und der Rest wird vertagt statt Datei für Datei abgewartet.
HAENGER_MAX = 3

# Wie viele Vorschaubilder gleichzeitig entstehen. Mehr bringt nichts: ab vier
# Fäden ist die Platte, nicht der Decoder die Grenze.
THUMB_FAEDEN = 4
# Auf dem WLAN-NAS war EIN Faden messbar schneller als vier (12.09.2026): die
# Lesezugriffe bremsen sich gegenseitig.
THUMB_FAEDEN_FERN = 1

ART_FOTO = "foto"
ART_VIDEO = "video"

SCHEMA = """
CREATE TABLE IF NOT EXISTS foto_ordner (
    path       TEXT PRIMARY KEY,
    added_at   TEXT,
    recursive  INTEGER DEFAULT 1
);
-- 04.10.2026: was über ein Laufwerk bekannt war, als es zuletzt verbunden war (core/laufwerke.py) —
-- damit die App auch bei fehlendem NAS „Netzlaufwerk auf <Server>" sagen und „Verbinden" anbieten kann
CREATE TABLE IF NOT EXISTS foto_laufwerk (
    wurzel     TEXT PRIMARY KEY,
    art        TEXT,
    server     TEXT,
    url        TEXT,
    freigabe   TEXT,
    gesehen_am TEXT
);
-- 18.09.2026: Änderungszeit je Verzeichnis (schnelle Nachschau, s. durchgang1)
CREATE TABLE IF NOT EXISTS foto_verz (
    path   TEXT PRIMARY KEY,
    mtime  REAL,
    geprueft REAL    -- 04.10.2026: wann zuletzt jede Datei darin abgefragt wurde (fortsetzbare gründliche Runde)
);

CREATE TABLE IF NOT EXISTS fotos (
    path          TEXT PRIMARY KEY,
    ordner        TEXT,
    dateiname     TEXT,
    mtime         REAL,
    size          INTEGER,
    art           TEXT,            -- 'foto' | 'video'

    -- Wiedererkennung nach Umbenennen/Verschieben: Größe + Teil-Hash.
    inhalt_id     TEXT,

    -- Zeit: UTC-Sekunden, dazu die Zeitzone der Aufnahme in Minuten und ob
    -- sie wirklich in der Datei stand (sonst ist die Lokalzeit geraten).
    aufnahme_utc  REAL,
    tz_minuten    INTEGER,
    tz_bekannt    INTEGER DEFAULT 0,
    tag_lokal     TEXT,            -- 'YYYY-MM-DD' in der Zeit der Aufnahme
    jahr          INTEGER,

    lat           REAL,
    lon           REAL,
    ele           REAL,

    kamera        TEXT DEFAULT '',
    objektiv      TEXT DEFAULT '',
    iso           TEXT DEFAULT '',
    blende        TEXT DEFAULT '',
    brennweite    TEXT DEFAULT '',
    belichtung    TEXT DEFAULT '',
    breite        INTEGER,
    hoehe         INTEGER,
    dauer_s       REAL,

    -- Ort kommt aus den Bild-Daten (der Geotagger schreibt ihn dorthin).
    ort           TEXT DEFAULT '',
    region        TEXT DEFAULT '',
    land          TEXT DEFAULT '',
    stichworte    TEXT DEFAULT '',

    -- Alle übrigen Tags, gepackt. Gesucht wird über fotos_fts, nicht hierin.
    tags_blob     BLOB,
    tags_n        INTEGER DEFAULT 0,
    -- Der Text, der in den Volltext-Index geht (auch der Rückfallweg nutzt ihn).
    hay           TEXT DEFAULT '',

    thumb         INTEGER DEFAULT 0,   -- 1 = Vorschaubild liegt im Cache
    -- Schlüssel des Vorschaubild-Caches, gemerkt aus Änderungszeit und Größe.
    -- Steht hier, damit die Vorschau auch ohne das Laufwerk gefunden wird.
    fp            TEXT,
    fehlt_seit    TEXT,
    indexed_at    TEXT,
    error         TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_fotos_zeit   ON fotos(aufnahme_utc);
CREATE INDEX IF NOT EXISTS idx_fotos_tag    ON fotos(tag_lokal);
CREATE INDEX IF NOT EXISTS idx_fotos_ordner ON fotos(ordner);
CREATE INDEX IF NOT EXISTS idx_fotos_art    ON fotos(art);
CREATE INDEX IF NOT EXISTS idx_fotos_jahr   ON fotos(jahr);
CREATE INDEX IF NOT EXISTS idx_fotos_kamera ON fotos(kamera);
CREATE INDEX IF NOT EXISTS idx_fotos_inhalt ON fotos(inhalt_id);
CREATE INDEX IF NOT EXISTS idx_fotos_offen  ON fotos(indexed_at);
"""

# Der Volltext-Index ist dieselbe Bauart wie bei den Touren (FTS5, Trigramm):
# Teilwort-Treffer bleiben erhalten, die Pflege machen Trigger in SQLite.
_FTS_SQL = """
-- 05.10.2026 (Audit B-1/B-2) — Volltext über die ZEILENNUMMER an `fotos` gekoppelt (fotos_fts2), nicht mehr über
-- `path`: der stand in fotos_fts als UNINDEXED, jedes „DELETE … WHERE path = ?" las die ganze Tabelle — beim Einlesen
-- 0,1 s je Foto (Marcs Log, behoben über Nur-Einfügen), beim Ordner-Entfernen aber weiterhin je gelöschter Zeile
-- (gemessen: 26.900 Zeilen in 339 s; Marcs ganzer NAS-Ordner wären Stunden). Über rowid ist Löschen ein Baumzugriff.
-- Die rowid von `fotos` ist stabil: kein VACUUM, kein INSERT OR REPLACE, kein Umbenennen von `path` im Code.
CREATE VIRTUAL TABLE IF NOT EXISTS fotos_fts2 USING fts5(
    hay,
    tokenize = "trigram remove_diacritics 1"
);
DROP TRIGGER IF EXISTS fotos_fts_ai;
DROP TRIGGER IF EXISTS fotos_fts_au;
DROP TRIGGER IF EXISTS fotos_fts_ai2;
DROP TRIGGER IF EXISTS fotos_fts_ad;
DROP TRIGGER IF EXISTS fotos_fts_neu;
DROP TRIGGER IF EXISTS fotos_fts_au2;
CREATE TRIGGER IF NOT EXISTS fotos_fts2_ai AFTER INSERT ON fotos WHEN COALESCE(new.hay,'') != '' BEGIN
    INSERT INTO fotos_fts2(rowid, hay) VALUES (new.rowid, lower(new.hay));
END;
CREATE TRIGGER IF NOT EXISTS fotos_fts2_ad AFTER DELETE ON fotos BEGIN
    DELETE FROM fotos_fts2 WHERE rowid = old.rowid;
END;
CREATE TRIGGER IF NOT EXISTS fotos_fts2_au AFTER UPDATE OF hay ON fotos
    WHEN COALESCE(old.hay,'') IS NOT COALESCE(new.hay,'') BEGIN
    DELETE FROM fotos_fts2 WHERE rowid = old.rowid;
    INSERT INTO fotos_fts2(rowid, hay) SELECT new.rowid, lower(new.hay) WHERE COALESCE(new.hay,'') != '';
END;
"""

_FTS_OK = False


def schema_anlegen(conn: sqlite3.Connection) -> None:
    """Tabellen und Volltext-Index anlegen. Idempotent, von `open_db` gerufen."""
    global _FTS_OK
    conn.executescript(SCHEMA)
    # Nachträgliche Spalten: bestehende Bibliotheken kennen `fp` noch nicht.
    # Der Wert füllt sich beim nächsten Durchgang 1 von selbst.
    spalten = {r[1] for r in conn.execute("PRAGMA table_info(fotos)")}
    if "fp" not in spalten:
        conn.execute("ALTER TABLE fotos ADD COLUMN fp TEXT")
    if "geprueft" not in {r[1] for r in conn.execute("PRAGMA table_info(foto_verz)")}:
        conn.execute("ALTER TABLE foto_verz ADD COLUMN geprueft REAL")
    try:
        neu_angelegt = not conn.execute("SELECT 1 FROM sqlite_master WHERE name = 'fotos_fts2'").fetchone()
        conn.executescript(_FTS_SQL)
        if neu_angelegt:
            # einmalig je Bibliothek: Suchtexte übernehmen, alte Tabelle (mit ihren Leerzeilen) weg
            t0 = time.monotonic()
            conn.execute("INSERT INTO fotos_fts2(rowid, hay) SELECT rowid, lower(hay) FROM fotos "
                         "WHERE COALESCE(hay, '') != ''")
            conn.execute("DROP TABLE IF EXISTS fotos_fts")
            log.info("fotos: Volltext auf Zeilennummern umgestellt (%d Einträge, %.1f s)",
                     conn.execute("SELECT COUNT(*) FROM fotos_fts2").fetchone()[0], time.monotonic() - t0)
        _FTS_OK = True
    except sqlite3.Error as e:
        _FTS_OK = False
        log.info("fotos: kein Volltext-Index (%s) — die Suche nimmt den LIKE-Weg", e)
    conn.commit()


# ── Ordner ──────────────────────────────────────────────────────────────────

def ordner_liste(conn: sqlite3.Connection, pruefen: bool = True) -> list:
    """Die beobachteten Fotoordner, je mit Anzahl, Fehlbestand und Laufwerk.

    Eigene Liste, nicht die der Tracks (Marc: „eigener ordner, dass man auch
    weiß, dass es hier definitiv um fotos geht").

    04.10.2026 (Marc: „es wird immer noch nicht richtig angezeigt, welche Ordner eingehängt sind") — `da` kommt aus
    core/laufwerke.info: Laufwerk eingehängt UND lesbar (eine hängende NAS-Verbindung zählt nicht als da), statt nur
    `is_dir`. `laufwerk` sagt, was der Finder sagt: Name, Netz/USB/dieser Rechner, Server, Adresse zum Verbinden,
    und ob derselbe Ordner gerade unter anderem Namen eingehängt ist („Fotos-1").
    """
    from . import laufwerke as _lw
    # 05.10.2026 (Audit B-3/E-8) — Datenbank unter der Bibliotheks-Sperre, die Laufwerksprüfung (bei hängendem NAS
    # Sekunden) OHNE: sonst stünde während der Prüfung das ganze Archiv.
    with db_sperre():
        gemerkt = {r["wurzel"]: dict(r) for r in conn.execute("SELECT * FROM foto_laufwerk")}
        zeilen = []
        # 06.10.2026 — je Ordner zwei Zählungen waren je zwei Durchgänge über dessen Fotos; jetzt eine gruppierte
        # Abfrage über den Ordner-Index für alle Ordner zusammen (gleiche Zahlen: exakt `ordner = Wurzel`).
        wurzeln = conn.execute("SELECT path, added_at, recursive FROM foto_ordner ORDER BY path").fetchall()
        zahlen = {}
        if wurzeln:
            ph = ",".join("?" * len(wurzeln))
            for o, n, fehlt in conn.execute(f"SELECT ordner, COUNT(*), SUM(fehlt_seit IS NOT NULL) FROM fotos "
                                            f"WHERE ordner IN ({ph}) GROUP BY ordner", [r["path"] for r in wurzeln]):
                zahlen[o] = (int(n or 0), int(fehlt or 0))
        for r in wurzeln:
            n, fehlt = zahlen.get(r["path"], (0, 0))
            zeilen.append((r["path"], r["added_at"], r["recursive"], n, fehlt))
    tab = _lw.mount_tabelle()
    raus, merken = [], []
    for p, added, rek, n, fehlt in zeilen:
        lw = _laufwerk_von(p, tab, gemerkt, pruefen)
        if lw.get("verbunden") and lw.get("wurzel") and lw.get("art") in ("netz", "extern"):
            merken.append(lw)
        raus.append({"path": p, "added_at": added, "recursive": bool(rek),
                     "n": n, "fehlt": fehlt, "da": bool(lw["da"]), "laufwerk": lw})
    if merken:
        with db_sperre():
            for lw in merken:
                _laufwerk_merken(conn, lw, gemerkt)
    return raus


def db_sperre():
    """Die Sperre der Bibliotheks-Verbindung (core/library._DB_LOCK, ein RLock) — für Brücken, die die gemeinsame
    Verbindung der Oberfläche benutzen. Fäden mit eigener Verbindung (Einlesen) stören sich daran nicht."""
    try:
        from .library import _DB_LOCK
        return _DB_LOCK
    except Exception:  # noqa: BLE001
        import contextlib
        return contextlib.nullcontext()


def _laufwerk_von(p: str, tab: list, gemerkt: dict, pruefen: bool) -> dict:
    from . import laufwerke as _lw
    # das gemerkte Laufwerk, dessen Wurzel den Ordner enthält (längste zuerst) — gilt für /Volumes, /media, X:\ …
    passend = {}
    for w, g in gemerkt.items():
        if w and (p == w or p.startswith(w.rstrip("/\\") + ("\\" if "\\" in w else "/"))):
            if not passend or len(w) > len(passend.get("wurzel", "")):
                passend = g
    try:
        return _lw.info(p, tabelle=tab, gemerkt=passend, pruefen=pruefen)
    except Exception as e:  # noqa: BLE001 — eine kaputte Erkennung darf die Liste nie leeren
        log.warning("fotos: Laufwerk von %s nicht bestimmbar: %s", p, e)
        da = Path(p).is_dir()
        return {"name": "", "art": "intern", "server": "", "url": "", "freigabe": "", "wurzel": "",
                "verbunden": da, "lesbar": None, "da": da, "alternativ": ""}


def _laufwerk_merken(conn: sqlite3.Connection, lw: dict, gemerkt: dict) -> None:
    alt = gemerkt.get(lw["wurzel"]) or {}
    neu = {"art": lw.get("art") or "", "server": lw.get("server") or "", "url": lw.get("url") or "",
           "freigabe": lw.get("freigabe") or ""}
    if all((alt.get(k) or "") == v for k, v in neu.items()):
        return
    conn.execute("INSERT INTO foto_laufwerk(wurzel, art, server, url, freigabe, gesehen_am) VALUES(?,?,?,?,?,?) "
                 "ON CONFLICT(wurzel) DO UPDATE SET art=excluded.art, server=excluded.server, url=excluded.url, "
                 "freigabe=excluded.freigabe, gesehen_am=excluded.gesehen_am",
                 (lw["wurzel"], neu["art"], neu["server"], neu["url"], neu["freigabe"], _jetzt()))
    conn.commit()
    gemerkt[lw["wurzel"]] = dict(neu, wurzel=lw["wurzel"])


def laufwerk_url(conn: sqlite3.Connection, ordner: str) -> str:
    """Adresse zum Verbinden des Laufwerks eines Fotoordners (gemerkt, solange es verbunden war)."""
    for o in ordner_liste(conn, pruefen=False):
        if o["path"] == ordner:
            return (o.get("laufwerk") or {}).get("url") or ""
    return ""


def ordner_hinzu(conn: sqlite3.Connection, path: str, recursive: bool = True) -> bool:
    p = str(Path(path).expanduser().resolve())
    if not Path(p).is_dir():
        return False
    conn.execute("INSERT INTO foto_ordner(path, added_at, recursive) VALUES(?,?,?) "
                 "ON CONFLICT(path) DO UPDATE SET recursive = excluded.recursive",
                 (p, _jetzt(), 1 if recursive else 0))
    conn.commit()
    return True


def ordner_weg(conn: sqlite3.Connection, path: str, mit_fotos: bool = True) -> None:
    """Ordner nicht mehr beobachten. `mit_fotos` wirft die Einträge weg —
    die Dateien draußen bleiben unberührt, hier steht nur der Index."""
    p = str(path)
    conn.execute("DELETE FROM foto_ordner WHERE path = ?", (p,))
    if mit_fotos:
        conn.execute("DELETE FROM fotos WHERE ordner = ?", (p,))
    conn.commit()


# ── Dateien finden ──────────────────────────────────────────────────────────

_SKIP_KLEIN = {s.lower() for s in SKIP_DIRS}   # Audit B-10: NTFS „$Recycle.Bin", „#Recycle" … unabhängig von Groß/klein


def pfadbereich(v: str) -> tuple:
    """Ordner samt Unterordnern als Bereich über den Pfad (`lo < path < hi`, kein LIKE) — für Fotos UND Touren.

    Audit B-9 (05.10.2026): `C:\\` wurde per rstrip zu `C:` und galt dann als Schrägstrich-Pfad → kein Treffer.
    Trennzeichen: Backslash, wenn einer drinsteht oder der Rest nur ein Laufwerksbuchstabe ist."""
    v = str(v)
    kurz = v.rstrip("/\\")
    sep = "\\" if (("\\" in v and "/" not in v) or re.match(r"^[A-Za-z]:$", kurz)) else "/"
    return kurz + sep, kurz + chr(ord(sep) + 1)


def _ueberspringen(d: Path) -> bool:
    name = d.name
    if name.lower() in _SKIP_KLEIN or name.startswith("."):
        return True
    low = name.lower()
    return any(low.endswith(s.rstrip("/")) for s in SKIP_SUFFIXE)


def medien_finden(ordner: str, recursive: bool = True) -> Iterable[Path]:
    """Alle Fotos und Videos unter diesem Ordner, ohne die Sperrbezirke."""
    wurzel = Path(ordner)
    if not wurzel.is_dir():
        return
    stapel = [(wurzel, 0)]
    while stapel:
        d, tiefe = stapel.pop()
        try:
            einträge = list(os.scandir(d))
        except OSError:
            continue
        for e in einträge:
            try:
                if e.is_dir(follow_symlinks=False):
                    if recursive and tiefe < TIEFE_MAX and not _ueberspringen(Path(e.path)):
                        stapel.append((Path(e.path), tiefe + 1))
                    continue
                if not e.is_file(follow_symlinks=False):
                    continue
            except OSError:
                continue
            if e.name.startswith("."):
                continue
            if cexif.is_media(e.path):
                yield Path(e.path)


# ── Schnelle Nachschau (18.09.2026) ─────────────────────────────────────────
# Marc: „Muss der da jedes Mal alles durchchecken, weil das ja ewig dauert, übers Netz?" Gemessen auf seinem
# NAS (SMB): 138.030 Dateien, `stat` je Datei 13,7 ms → 31 min je Nachschau, alle 6 h. Das Auflisten der
# Ordner kostet dagegen ~3 min. Deshalb: Ist die Änderungszeit eines VERZEICHNISSES dieselbe wie beim letzten
# Mal, gelten seine bekannten Dateien als unverändert und werden ohne `stat` übernommen; gefragt wird nur nach
# Namen, die der Bestand nicht kennt. Hinzufügen, Löschen, Umbenennen und Neuschreiben (exiftool, Lightroom:
# temporäre Datei + Umbenennen) ändern die Verzeichniszeit → dieses Verzeichnis wird ganz geprüft. Nur eine
# Änderung IN einer Datei ohne Umbenennen fällt so nicht auf — dafür läuft alle GRUENDLICH_TAGE eine gründliche
# Nachschau, die wie früher jede Datei fragt.
GRUENDLICH_TAGE = 7


def erwartete_dateien(conn: sqlite3.Connection, ordner: Optional[list] = None) -> int:
    """Wie viele Dateien Durchgang 1 voraussichtlich sieht: der bekannte Bestand der (erreichbaren) Ordner.
    Für „x von ≈ y" und die Restzeit in der Oberfläche (04.10.2026) — eine Schätzung, neue Dateien kommen dazu."""
    ziele = ordner if ordner is not None else [o["path"] for o in ordner_liste(conn, pruefen=False) if o["da"]]
    n = 0
    for o in ziele:
        n += conn.execute("SELECT COUNT(*) FROM fotos WHERE ordner = ? AND fehlt_seit IS NULL", (o,)).fetchone()[0]
    return int(n)


def gelesene(conn: sqlite3.Connection) -> int:
    """Wie viele vorhandene Dateien Schritt 2 schon gelesen hat — bleibt über einen Neustart erhalten.

    Marc, 04.10.2026: „Wenn ich bei Schritt 2 die App schließe, fängt er dann wieder bei 0 % an?" — nein, gelesen
    bleibt gelesen; aber die Anzeige zählte nur den Rest als 100 %. Mit dieser Zahl zeigt sie den Gesamtstand."""
    return int(conn.execute("SELECT COUNT(*) FROM fotos WHERE indexed_at IS NOT NULL AND fehlt_seit IS NULL")
               .fetchone()[0])


def gruendlich_faellig(conn: sqlite3.Connection) -> bool:
    r = conn.execute("SELECT value FROM meta WHERE key = 'fotos_gruendlich'").fetchone()
    try:
        letzte = float(r["value"]) if r and r["value"] else None
    except (TypeError, ValueError):
        letzte = None
    return letzte is None or (datetime.now(timezone.utc).timestamp() - letzte) > GRUENDLICH_TAGE * 86400


def _gruendlich_merken(conn: sqlite3.Connection) -> None:
    conn.execute("INSERT INTO meta(key, value) VALUES('fotos_gruendlich', ?) "
                 "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                 (str(datetime.now(timezone.utc).timestamp()),))
    conn.execute("DELETE FROM meta WHERE key = 'fotos_gruendlich_runde'")


def gruendliche_runde(conn: sqlite3.Connection) -> Optional[float]:
    """Beginn einer angefangenen, noch nicht fertigen gründlichen Runde (sonst None).

    04.10.2026 (Marc: „ich war immer noch bei Schritt 1 … und das hat er wieder von vorne angefangen") — bis dahin
    merkte sich Schritt 1 erst am Ende, was er geschafft hatte: App zu → die Wochen-Nachschau war wieder fällig und
    fragte jede Datei von vorn ab. Jetzt hat eine gründliche Runde einen Beginn; jeder Ordner, dessen Dateien alle
    abgefragt sind, bekommt sofort `foto_verz.geprueft`. Ein neuer Lauf übernimmt Ordner, die seit dem Rundenbeginn
    geprüft und seitdem unverändert sind, und macht beim Rest weiter."""
    r = conn.execute("SELECT value FROM meta WHERE key = 'fotos_gruendlich_runde'").fetchone()
    try:
        return float(r["value"]) if r and r["value"] else None
    except (TypeError, ValueError):
        return None


def medien_pruefen(ordner: str, recursive: bool, verz: dict, bekannt: dict, gruendlich: bool,
                   verz_neu: dict, runde: Optional[float] = None, unlesbar: Optional[set] = None) -> Iterable[tuple]:
    """Wie `medien_finden`, aber je Datei mit der Auskunft, ob sie OHNE `stat` übernommen werden darf.

    `verz` = {verzeichnis: (mtime, geprueft) vom letzten Mal}, `bekannt` = {verzeichnis: {dateiname, …}} aus dem
    Bestand (ohne als fehlend Markierte). `verz_neu` sammelt die heutigen Verzeichniszeiten. Gründlich wird
    trotzdem übernommen, was in DIESER Runde (`runde` = Beginn) schon geprüft wurde und unverändert ist.
    Nach den Dateien eines Verzeichnisses kommt `(None, (verzeichnis, übernommen?, geprueft_alt))` — es ist dann
    vollständig abgearbeitet."""
    wurzel = Path(ordner)
    if not wurzel.is_dir():
        return
    stapel = [(wurzel, 0)]
    while stapel:
        d, tiefe = stapel.pop()
        try:
            einträge = list(os.scandir(d))
            dmt = os.stat(d).st_mtime
        except OSError:
            if unlesbar is not None:   # Audit B-4: was hier liegt, ist nicht „weg", nur gerade nicht lesbar
                unlesbar.add(str(d))
            continue
        ds = str(d)
        verz_neu[ds] = dmt
        alt_mt, alt_gp = verz.get(ds, (None, None))
        gleich = alt_mt is not None and abs((alt_mt or 0) - dmt) < 1
        ruhig = gleich and ((not gruendlich) or (runde is not None and (alt_gp or 0) >= runde))
        namen = bekannt.get(ds) or ()
        for e in einträge:
            try:
                if e.is_dir(follow_symlinks=False):
                    if recursive and tiefe < TIEFE_MAX and not _ueberspringen(Path(e.path)):
                        stapel.append((Path(e.path), tiefe + 1))
                    continue
                if not e.is_file(follow_symlinks=False):
                    continue
            except OSError:
                continue
            if e.name.startswith("."):
                continue
            if cexif.is_media(e.path):
                yield Path(e.path), (ruhig and e.name in namen)
        yield None, (ds, ruhig, alt_gp)


def art_von(path: str) -> str:
    return ART_VIDEO if cexif.is_video(str(path)) else ART_FOTO


def inhalt_id(path: Path, size: int) -> str:
    """Wiedererkennungs-Kennung: Größe plus Hash über Anfang und Ende.

    Ganze Dateien zu hashen wäre bei RAWs und Videos zu teuer; Anfang und Ende
    genügen, um eine umbenannte oder verschobene Datei wiederzufinden.
    """
    try:
        kopf, ende = kopf_und_ende(path, size)
    except OSError:
        return ""
    return kennung_aus(kopf, ende, size)


def kopf_und_ende(path, size: int) -> tuple:
    """Die ersten und (bei Dateien über 128 KB) die letzten 64 KB — in EINEM Öffnen (06.10.2026: Schritt 3 nimmt
    daraus Kennung UND Schnellbild, statt die Datei zweimal übers NAS zu öffnen). OSError, wenn nicht lesbar."""
    with open(path, "rb") as f:
        kopf = f.read(65536)
        ende = b""
        if size > 131072:
            f.seek(-65536, os.SEEK_END)
            ende = f.read(65536)
    return kopf, ende


def kennung_aus(kopf: bytes, ende: bytes, size: int) -> str:
    h = hashlib.sha1()
    h.update(str(size).encode())
    h.update(kopf)
    if size > 131072:
        h.update(ende)
    return f"{size}-{h.hexdigest()[:12]}"


def _jetzt() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


_FERN_CACHE: dict = {}


def ist_fern(path) -> bool:
    """Liegt der Pfad auf einem eingehängten (Netz-)Laufwerk statt auf der
    Startplatte? Entscheidet Stapelgröße und Fadenzahl im Scan (14.09.2026).

    macOS: alles unter /Volumes/, das nicht die Startplatte selbst ist (die
    hängt dort als Link auf „/"). Linux: /mnt, /media, /net, /run/media, gvfs.
    Windows: UNC-Pfade. Ein gemappter Windows-Laufwerksbuchstabe ist nicht
    erkennbar — dann gilt der lokale Wert, wie bisher.
    """
    p = str(path or "")
    if not p:
        return False
    if os.name == "nt":
        return p.startswith("\\\\") or p.startswith("//")
    if sys.platform == "darwin":
        if not p.startswith("/Volumes/"):
            return False
        teile = p.split("/", 3)
        wurzel = "/".join(teile[:3])          # /Volumes/<Name>
        da = _FERN_CACHE.get(wurzel)
        if da is None:
            try:
                da = os.path.realpath(wurzel) != "/"
            except OSError:
                da = True
            _FERN_CACHE[wurzel] = da
        return da
    return p.startswith(("/mnt/", "/media/", "/net/", "/run/media/")) or "/gvfs/" in p


# 05.10.2026 (Marc: „nicht mehr als zwei, da sind Festplatten drin") — auf einem Netzlaufwerk lesen zwei exiftool-
# Prozesse je einen Stapel gleichzeitig: die meiste Zeit wartet exiftool aufs Netz, nicht auf die Platte. Lokal einer.
# `RZ_FOTO_LESER=1` schaltet zum Vergleich zurück. Nie mehr als 2 (NAS mit Festplatten, parallele Zugriffe ließen es
# bei Marc schon abstürzen).
LESER_FERN = max(1, min(2, int(os.environ.get("RZ_FOTO_LESER", "2") or 2)))
_LESER_ROLLEN = ("read", "read2")
_lese_ort = threading.local()    # je Lese-Faden: rolle, fern, mb_je (Stubs in Tests rufen _tags_stapel(pfade))


def _tags_stapel(pfade: list) -> tuple:
    """Kernwerte und alle Tags für einen Stapel — beides in einem Zug.
    Wirft ExifToolTimeout, wenn der Daemon hängt."""
    # 05.10.2026 — EIN exiftool-Aufruf statt zwei (Kernwerte + alle Tags), `-fast`: jede Datei auf dem NAS nur einmal
    ort = getattr(_lese_ort, "wert", None) or {}
    return cexif.read_beides_viele(pfade, fast=True, rolle=ort.get("rolle", "read"), fern=bool(ort.get("fern")),
                                   mb=float(ort.get("mb_je") or 0) * len(pfade))


def _tags_lesen_im_faden(pfade: list, rolle: str, fern: bool, mb: float, kenn: Optional[list] = None) -> tuple:
    """`_tags_lesen_geteilt` mit eigenem exiftool-Prozess (`rolle`) — läuft im Lese-Faden.

    05.10.2026 (Marcs Log mit zwei Lesern: „Daten 20 s, Kennung 27 s" in Video-Ordnern) — der Faden rechnet auch die
    Kennungen seines Stapels (`kenn` = [(pfad, größe)]), statt dass der Hauptfaden sie danach allein Datei für Datei
    holt. Gleiche 128 KB je Datei, nur zwei Stapel zugleich. Rückgabe: (meta, tags, haenger, kennungen, sekunden)."""
    _lese_ort.wert = {"rolle": rolle, "fern": fern, "mb_je": (mb / len(pfade)) if pfade else 0.0}
    try:
        meta, tags_alle, haenger = _tags_lesen_geteilt(pfade)
    finally:
        _lese_ort.wert = None
    t0 = time.monotonic()
    kennungen = {p: inhalt_id(Path(p), int(g or 0)) for p, g in (kenn or [])}
    return meta, tags_alle, haenger, kennungen, time.monotonic() - t0


def _tags_lesen_geteilt(pfade: list, teilung=STAPEL_TEILUNG) -> tuple:
    """Einen Stapel lesen; hängt exiftool, den Stapel zerlegen (60 → 10 → 1).

    Rückgabe: (meta, tags_alle, haenger) — `haenger` sind die Einzeldateien,
    bei denen exiftool auch allein nicht antwortete. Nur die bekommen später den
    Fehlerstempel. Vorher (bis 14.09.2026) galt nach einem Hänger der ganze
    Stapel als „keine Aufnahmedaten lesbar" und kam nie wieder dran.
    """
    try:
        meta, tags_alle = _tags_stapel(pfade)
        return meta, tags_alle, []
    except cexif.ExifToolTimeout as e:
        if not teilung:
            log.warning("fotos: exiftool-Hänger bei Einzeldatei %s (%s)", pfade[0], e)
            return {}, {}, list(pfade)
        groesse = teilung[0]
        log.warning("fotos: exiftool-Hänger bei Stapel von %d Dateien — "
                    "lese in Teilen zu %d (%s)", len(pfade), groesse, e)
    meta, tags_alle, haenger = {}, {}, []
    for i in range(0, len(pfade), groesse):
        m, t, h = _tags_lesen_geteilt(pfade[i:i + groesse], teilung[1:])
        meta.update(m)
        tags_alle.update(t)
        haenger += h
        if len(haenger) >= HAENGER_MAX:
            # exiftool antwortet auf nichts mehr (Laufwerk weg? Daemon kaputt?):
            # den Rest nicht Datei für Datei abwarten, sondern vertagen.
            break
    return meta, tags_alle, haenger


# ── Durchgang 1: die Dateiliste ─────────────────────────────────────────────

def durchgang1(conn: sqlite3.Connection, fortschritt: Optional[Callable] = None,
               stop: Optional[Callable] = None, ordner: Optional[list] = None,
               aktuell: Optional[Callable] = None, gruendlich: Optional[bool] = None) -> dict:
    """Nur die Liste: Pfad, Ordner, Änderungszeit, Größe, Art.

    Läuft in Sekunden, weil keine Datei geöffnet wird. Danach steht die Ansicht
    schon, während Durchgang 2 im Hintergrund die Aufnahmedaten nachträgt.
    """
    ziele = ordner if ordner is not None else [o["path"] for o in ordner_liste(conn)
                                               if o["da"]]
    rek = {o["path"]: o["recursive"] for o in ordner_liste(conn)}
    neu = gesehen = geaendert = 0
    alle_pfade: set = set()
    letzter_commit = time.monotonic()
    # 18.09.2026 — schnelle Nachschau: unveränderte Verzeichnisse ohne `stat` übernehmen (s. medien_pruefen)
    if gruendlich is None:
        gruendlich = gruendlich_faellig(conn)
    runde = None
    if gruendlich and ordner is None:
        runde = gruendliche_runde(conn)
        if runde is None:      # neue Runde beginnen — ihr Beginn bleibt stehen, bis sie ganz durch ist
            runde = time.time()
            geduldig(conn.execute, "INSERT INTO meta(key, value) VALUES('fotos_gruendlich_runde', ?) "
                     "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (str(runde),))
            geduldig(conn.commit)
    verz = {r["path"]: (r["mtime"], r["geprueft"])
            for r in conn.execute("SELECT path, mtime, geprueft FROM foto_verz").fetchall()}
    bekannt: dict = {}
    if verz:
        for r in conn.execute("SELECT path FROM fotos WHERE fehlt_seit IS NULL").fetchall():
            d_, n_ = os.path.split(r["path"])
            bekannt.setdefault(d_, set()).add(n_)
    verz_neu: dict = {}
    uebernommen = 0
    # Was GPS Studio seit der letzten Nachschau selbst geschrieben hat, wird trotzdem gefragt (s. core/exif).
    try:
        selbst = cexif.selbst_geschrieben_abholen()
    except Exception:      # noqa: BLE001
        selbst = set()

    # 05.10.2026 (Audit G-2): Schritt 1 lief bei Marc 52 Minuten ohne eine Logzeile — jetzt jede Minute ein Lebenszeichen
    t_start = t_log = time.time()
    verz_fertig = 0
    unlesbar: set = set()
    for o in ziele:
        for f, ruhig in medien_pruefen(o, rek.get(o, True), verz, bekannt, bool(gruendlich), verz_neu, runde, unlesbar):
            if time.time() - t_log >= 60:
                t_log = time.time()
                log.info("fotos: Schritt 1 (%s): %d Dateien in %d Ordnern gesehen (%d neu, %d geändert, %d übernommen), %d min",
                         "gründlich" if gruendlich else "schnell", gesehen, verz_fertig, neu, geaendert, uebernommen,
                         int((t_log - t_start) / 60))
            if f is None:
                verz_fertig += 1
                # Verzeichnis vollständig: gleich merken, nicht erst am Ende — ein Neustart macht sonst von vorn
                # weiter (Marc, 04.10.2026). Sicher, weil jede Datei darin schon eingetragen ist.
                # `geprueft` nur neu, wenn die Dateien wirklich abgefragt wurden; übernommene behalten ihren Wert.
                vd, vruhig, vgp = ruhig
                geduldig(conn.execute, "INSERT INTO foto_verz(path, mtime, geprueft) VALUES(?, ?, ?) "
                         "ON CONFLICT(path) DO UPDATE SET mtime = excluded.mtime, geprueft = excluded.geprueft",
                         (vd, verz_neu.get(vd), vgp if vruhig else time.time()))
                continue
            if stop and stop():
                return {"abbruch": True, "neu": neu, "gesehen": gesehen,
                        "geaendert": geaendert, "uebernommen": uebernommen}
            if ruhig and (not selbst or os.path.abspath(str(f)) not in selbst):
                alle_pfade.add(str(f))
                gesehen += 1
                uebernommen += 1
                if fortschritt and gesehen % 200 == 0:
                    fortschritt(gesehen, 0)
                    if aktuell:
                        try: aktuell(str(f.parent), {"neu": neu, "geaendert": geaendert, "uebernommen": uebernommen})
                        except Exception: pass
                continue
            try:
                st = f.stat()
            except OSError:
                continue
            p = str(f)
            alle_pfade.add(p)
            gesehen += 1
            fp = cphotos.fingerprint_aus(p, st.st_mtime_ns, st.st_size)
            alt = geduldig(conn.execute,
                           "SELECT mtime, size, fp, fehlt_seit FROM fotos WHERE path = ?", (p,)).fetchone()
            if alt is None:
                geduldig(conn.execute,
                         "INSERT INTO fotos(path, ordner, dateiname, mtime, size, art, fp, "
                         "fehlt_seit) VALUES(?,?,?,?,?,?,?,NULL)",
                         (p, o, f.name, st.st_mtime, st.st_size, art_von(p), fp))
                neu += 1
            else:
                if abs((alt["mtime"] or 0) - st.st_mtime) > 1 or (alt["size"] or 0) != st.st_size:
                    # Datei hat sich geändert → Aufnahmedaten neu lesen lassen.
                    geduldig(conn.execute,
                             "UPDATE fotos SET mtime = ?, size = ?, fp = ?, indexed_at = NULL, "
                             "fehlt_seit = NULL WHERE path = ?", (st.st_mtime, st.st_size, fp, p))
                    geaendert += 1
                else:
                    # 13.09.2026 (Echt-App-Test): nur schreiben, wenn es etwas zu schreiben
                    # gibt. Auch ein UPDATE ohne Treffer öffnet eine Schreibtransaktion — über
                    # 200 Dateien auf dem NAS hielt der Scan so sekundenlang die Bibliothek
                    # gesperrt, und ein Track-Import im Geotagger scheiterte an „locked".
                    if alt["fehlt_seit"] is not None:
                        geduldig(conn.execute,
                                 "UPDATE fotos SET fehlt_seit = NULL WHERE path = ?", (p,))
                    if (alt["fp"] or "") != fp:
                        # Bibliothek von vor dieser Fassung: Wert nachtragen.
                        geduldig(conn.execute,
                                 "UPDATE fotos SET fp = ? WHERE path = ?", (fp, p))
            # Schreibsperre kurz halten: spätestens nach 0,3 s abschließen, nicht erst
            # nach 200 Dateien (13.09.2026).
            if conn.in_transaction and time.monotonic() - letzter_commit > 0.3:
                geduldig(conn.commit)
                letzter_commit = time.monotonic()
            if fortschritt and gesehen % 200 == 0:
                geduldig(conn.commit)
                letzter_commit = time.monotonic()
                fortschritt(gesehen, 0)
                if aktuell:   # 18.09.2026 (Marc: „was macht GPS Studio gerade mit den Fotos?") — Ordner + Zwischenstand
                    try: aktuell(str(f.parent), {"neu": neu, "geaendert": geaendert, "uebernommen": uebernommen})
                    except Exception: pass

    # Was in einem beobachteten Ordner nicht mehr auftauchte, fehlt. Bewusst
    # nur markiert, nicht gelöscht: die externe Platte kommt wieder.
    weg = 0
    # Audit B-4 (05.10.2026): fiel das Netzlaufwerk mitten im Lauf weg, galten alle nicht mehr erreichten Fotos als
    # „fehlt" — Zehntausende verschwanden aus Raster, Karte und Suche. Jetzt nur, wenn der Ordner noch da ist, und nie
    # unter einem Verzeichnis, das sich in diesem Lauf nicht lesen ließ.
    noch_da = [o for o in ziele if Path(o).is_dir()]
    if len(noch_da) < len(ziele):
        log.warning("fotos: Schritt 1 — %d Ordner zum Schluss nicht erreichbar, ihre Dateien bleiben unmarkiert: %s",
                    len(ziele) - len(noch_da), ", ".join(o for o in ziele if o not in noch_da)[:300])
    if unlesbar:
        log.warning("fotos: Schritt 1 — %d Verzeichnisse nicht lesbar, ihre Dateien bleiben unmarkiert (z. B. %s)",
                    len(unlesbar), next(iter(unlesbar)))
    unl = tuple(u.rstrip("/\\") + os.sep for u in unlesbar)
    if noch_da:
        platz = ",".join("?" for _ in noch_da)
        for r in conn.execute(f"SELECT path FROM fotos WHERE ordner IN ({platz}) "
                              "AND fehlt_seit IS NULL", tuple(noch_da)).fetchall():
            if r["path"] not in alle_pfade and not (unl and r["path"].startswith(unl)):
                geduldig(conn.execute,
                         "UPDATE fotos SET fehlt_seit = ? WHERE path = ?", (_jetzt(), r["path"]))
                weg += 1
    geduldig(conn.commit)
    if gruendlich and ordner is None:
        _gruendlich_merken(conn)
    geduldig(conn.commit)
    return {"neu": neu, "gesehen": gesehen, "geaendert": geaendert, "fehlt": weg,
            "uebernommen": uebernommen, "gruendlich": bool(gruendlich)}


# ── Durchgang 2: Aufnahmedaten und Vorschaubilder ───────────────────────────

_HAY_TAGS = ("Keywords", "Subject", "Title", "Description", "ImageDescription",
             "Caption-Abstract", "LensModel", "LensID", "Software", "City",
             "State", "Province-State", "Country", "Country-PrimaryLocationName",
             "Sub-location", "Location", "Artist", "Creator", "Make", "Model")


def _wert(tags: dict, *namen: str) -> str:
    for n in namen:
        v = tags.get(n)
        if v not in (None, "", []):
            return str(v).strip()
    return ""


def _hay(p: Path, tags: dict, kamera: str) -> str:
    """Der Text, den die Suche durchsucht: Dateiname, Ordner, Kamera und die
    sprechenden Tags. Klein geschrieben, damit der Index nichts umrechnen muss."""
    teile = [p.name, p.parent.name, kamera]
    teile += [_wert(tags, n) for n in _HAY_TAGS]
    return " ".join(t for t in teile if t).lower()[:4000]


def _offene(conn: sqlite3.Connection, grenze: Optional[int] = None, nur: Optional[list] = None) -> list:
    if nur:
        # 04.10.2026 — gezielt einzelne Dateien neu lesen (nach dem Bearbeiten im Archiv)
        return conn.execute("SELECT path, art, size FROM fotos WHERE indexed_at IS NULL AND path IN (%s) ORDER BY path"
                            % ",".join("?" for _ in nur), list(nur)).fetchall()
    sql = ("SELECT path, art, size FROM fotos WHERE indexed_at IS NULL AND fehlt_seit IS NULL "
           "ORDER BY path")
    if grenze:
        sql += f" LIMIT {int(grenze)}"
    return conn.execute(sql).fetchall()


def neu_lesen(conn: sqlite3.Connection, pfade: list) -> dict:
    """Einzelne Dateien sofort neu einlesen (04.10.2026): nach dem Schreiben im Archiv (EXIF, Ort) sollen Raster,
    Karte und Detailspalte die neuen Werte zeigen, nicht erst nach der nächsten Nachschau. Größe/Änderungszeit
    nachziehen, als ungelesen markieren, Durchgang 2 nur für diese Pfade."""
    pfade = [str(p) for p in (pfade or []) if p]
    for p in pfade:
        try:
            st = os.stat(p)
        except OSError:
            continue
        conn.execute("UPDATE fotos SET indexed_at = NULL, mtime = ?, size = ?, error = '' WHERE path = ?",
                     (st.st_mtime, st.st_size, p))
    conn.commit()
    return durchgang2(conn, nur=pfade)


SELBSTHEIL_SCHLUESSEL = "fotos_selbstheil_2026_09_14"
FEHLTEXT_KEINE_DATEN = "keine Aufnahmedaten lesbar"


def selbstheilung_haenger(conn: sqlite3.Connection) -> int:
    """Einmal je Bibliothek: die Opfer des Hänger-Fehlers wieder freigeben.

    Bis 14.09.2026 stempelte ein exiftool-Hänger den ganzen 60er-Stapel als
    „keine Aufnahmedaten lesbar" ab — in Marcs Bibliothek liegen genau 60
    solche Zeilen. Wer diesen Text trägt und keine Aufnahmezeit hat, bekommt
    `indexed_at` und `error` zurückgesetzt und wird im nächsten Durchgang neu
    gelesen. Ob es lief, merkt sich die meta-Tabelle; Rückgabe: Anzahl.
    """
    try:
        r = conn.execute("SELECT value FROM meta WHERE key = ?",
                         (SELBSTHEIL_SCHLUESSEL,)).fetchone()
    except sqlite3.OperationalError:
        return 0
    if r is not None:
        return 0
    cur = geduldig(conn.execute,
                   "UPDATE fotos SET indexed_at = NULL, error = NULL "
                   "WHERE error = ? AND aufnahme_utc IS NULL",
                   (FEHLTEXT_KEINE_DATEN,))
    n = int(cur.rowcount or 0) if cur is not None else 0
    geduldig(conn.execute, "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
             (SELBSTHEIL_SCHLUESSEL, f"{_jetzt()} n={n}"))
    geduldig(conn.commit)
    if n:
        log.info("fotos: Selbstheilung — %d Dateien mit '%s' werden neu gelesen",
                 n, FEHLTEXT_KEINE_DATEN)
    return n


class RestZeit:
    """Restzeit von Schritt 2 aus dem, was noch zu lesen ist: Sekunden je Datei + Sekunden je MB.

    04.10.2026 (Marc: „die Zeit tickert die ganze Zeit hoch … die sollte auf einen Schlag hoch sein und
    runtertickern") — die Oberfläche teilte den Rest durch das Tempo seit dem Start. Gelesen wird aber Ordner für
    Ordner nach Jahren, und neuere Jahre haben größere Dateien: es wird mit der Zeit langsamer, die Schätzung wuchs
    mit. Die Zeit hängt am NAS vor allem an den Megabyte, und die kennt der Bestand schon aus Schritt 1. Gemessen wird
    je Stapel (Dateien, MB, Sekunden), ausgeglichen mit kleinster Quadratsumme und langsamem Vergessen; das Ergebnis
    bleibt in der Bibliothek (`meta fotos_tempo2`), damit nach einem Neustart sofort eine gute Schätzung dasteht."""
    VERGESSEN = 0.98
    VORWISSEN = 5.0        # so viele Stapel zählt das gemerkte Tempo am Anfang

    def __init__(self, alt: Optional[dict] = None):
        self.a = self.b = None
        self.s = [0.0] * 5   # Σnn, Σnm, Σmm, Σnt, Σmt
        self.mb_je_datei = float((alt or {}).get("mb_je_datei") or 5.0)
        if alt and alt.get("a") is not None:
            # gemerktes Tempo als VORWISSEN-mal ein typischer Stapel (20 Dateien) — echte Stapel lösen es ab
            a, b = float(alt.get("a") or 0), float(alt.get("b") or 0)
            n, m = 20.0, 20.0 * self.mb_je_datei
            self._dazu(n, m, a * n + b * m, self.VORWISSEN)
            self.a, self.b = a, b

    def _dazu(self, n: float, m: float, t: float, w: float = 1.0) -> None:
        for k, x in enumerate((n * n, n * m, m * m, n * t, m * t)):
            self.s[k] += w * x

    def stapel(self, n: int, mb: float, sek: float) -> None:
        if n <= 0 or sek <= 0:
            return
        self.s = [x * self.VERGESSEN for x in self.s]
        self._dazu(float(n), float(mb), float(sek))
        nn, nm, mm, nt, mt = self.s
        det = nn * mm - nm * nm
        a = b = None
        if det > 1e-9 * max(1.0, nn * mm):
            a = (nt * mm - mt * nm) / det
            b = (mt * nn - nt * nm) / det
        if a is None or a < 0 or b < 0:
            # noch nicht trennbar (zu wenige, zu ähnliche Stapel) → alles als Zeit je MB: am NAS bestimmt die Menge
            # die Dauer, und weil die Dateien später größer werden, schätzt das nicht zu niedrig
            if mm > 1e-9:
                a, b = 0.0, mt / mm
            else:
                a, b = (nt / nn if nn else 0.0), 0.0
        self.a, self.b = a, b
        self.mb_je_datei = 0.9 * self.mb_je_datei + 0.1 * (mb / n)

    def rest(self, n: int, mb: float) -> Optional[float]:
        if self.a is None:
            return None
        return max(0.0, self.a * n + self.b * mb)

    def merken(self) -> dict:
        return {"a": self.a, "b": self.b, "mb_je_datei": self.mb_je_datei}


class RestZeitDateien:
    """Restzeit von Schritt 2 aus der Dateizahl: Sekunden je Datei, Median der letzten Stapel.

    05.10.2026 (Marc: „die Dauer beim Einlesen springt viel zu wild hin und her") — seit `-fast` liest exiftool nur den
    Dateikopf, die Dateigröße zählt kaum noch. Das alte Modell (je Datei + je MB, `RestZeit`) kippte in Video-Ordnern
    (Stapel mit 20–40 GB neben 2 GB) ständig um und rechnete mit den Terabyte des Rests riesige Sprünge. Dazu messen
    zwei Leser die Zeit je Stapel nicht mehr sauber. Jetzt: Wanduhr-Zeit zwischen zwei fertigen Stapeln, je Datei, Median
    über die letzten FENSTER Stapel (Hänger und Ausreißer verschieben ihn kaum). Gleiche Schnittstelle wie `RestZeit`."""
    FENSTER = 40

    def __init__(self, alt: Optional[dict] = None):
        from collections import deque
        self.werte = deque(maxlen=self.FENSTER)
        s = (alt or {}).get("s_je_datei")
        self.a = float(s) if s else None
        self.b = 0.0
        if self.a:
            for _ in range(5):          # gemerktes Tempo als Vorwissen, echte Stapel lösen es ab
                self.werte.append(self.a)

    def stapel(self, n: int, mb: float, sek: float) -> None:
        if n <= 0 or sek <= 0:
            return
        self.werte.append(sek / n)
        w = sorted(self.werte)
        self.a = w[len(w) // 2]

    def rest(self, n: int, mb: float = 0.0) -> Optional[float]:
        return None if self.a is None else max(0.0, self.a * n)

    def merken(self) -> dict:
        return {"s_je_datei": self.a, "a": self.a, "b": 0.0}


def tempo_lesen(conn: sqlite3.Connection, schluessel: str = "fotos_tempo2") -> Optional[dict]:
    r = conn.execute("SELECT value FROM meta WHERE key = ?", (schluessel,)).fetchone()
    try:
        return json.loads(r["value"]) if r and r["value"] else None
    except (TypeError, ValueError):
        return None


def tempo_merken(conn: sqlite3.Connection, rz, schluessel: str = "fotos_tempo2") -> None:
    if rz.a is None:
        return
    geduldig(conn.execute, "INSERT INTO meta(key, value) VALUES(?, ?) "
             "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (schluessel, json.dumps(rz.merken())))


def durchgang2(conn: sqlite3.Connection, fortschritt: Optional[Callable] = None,
               stop: Optional[Callable] = None, grenze: Optional[int] = None,
               mit_thumbs: bool = True, aktuell: Optional[Callable] = None, nur: Optional[list] = None,
               schaetzung: Optional[Callable] = None) -> dict:
    """Aufnahmedaten (alle Tags) und Vorschaubilder für alles Ungelesene (oder nur `nur`).
    `schaetzung(rest_sekunden)` meldet nach jedem Stapel die Restzeit (s. `RestZeit`)."""
    selbstheilung_haenger(conn)
    offen = _offene(conn, grenze, nur)
    gesamt = len(offen)
    fertig = fehler = fern = haenger_n = 0
    rz = RestZeitDateien(tempo_lesen(conn))
    rest_mb = sum(float(r["size"] or 0) for r in offen) / 1e6
    if schaetzung:
        try: schaetzung(rz.rest(gesamt, rest_mb))
        except Exception: pass
    stapel_n = 0
    # 04.10.2026 (Marc: „225 h … das lässt sich nicht beschleunigen?") — wohin die Zeit geht, steht im Log: je 10 Stapel
    # Dateien, MB, Sekunden für Aufnahmedaten (exiftool), Kennung (128 KB je Datei) und Vorschaubilder.
    mess = {"n": 0, "mb": 0.0, "daten": 0.0, "kennung": 0.0, "schreiben": 0.0, "bilder": 0.0, "gesamt": 0.0}
    if fortschritt and gesamt:
        # Die Gesamtzahl sofort melden: der erste Stapel braucht mit Daemon-
        # Start gut zwei Sekunden, und so lange stand in der Kopfzeile nur
        # „Aufnahmedaten lesen 0" statt „0 / 600".
        fortschritt(0, gesamt)

    # 05.10.2026 — Vorrat gelesener Stapel: auf einem Netzlaufwerk lesen LESER_FERN (2) exiftool-Prozesse zugleich je
    # einen Stapel; Kennung, Schreiben und Fortschritt laufen danach der Reihe nach wie bisher.
    from collections import deque
    leser = ThreadPoolExecutor(max_workers=LESER_FERN, thread_name_prefix="foto-leser")
    vorrat: deque = deque()
    lauf_nr = 0
    i = 0

    def _nachfuellen():
        nonlocal i, fern, lauf_nr
        while i < gesamt:
            fern_jetzt = ist_fern(offen[i]["path"])
            if len(vorrat) >= (LESER_FERN if fern_jetzt else 1):
                return
            # Auf einem Netzlaufwerk kleinere Stapel und ein Faden fürs Vorschaubild.
            stapel = STAPEL_FERN if fern_jetzt else STAPEL
            teil_ = offen[i:i + stapel]
            i += stapel
            mb_ = sum(float(r["size"] or 0) for r in teil_) / 1e6
            # Nicht erreichbare Dateien werden ÜBERSPRUNGEN, nicht als fehlerhaft
            # abgestempelt: sonst gilt ein Foto auf dem abgeschalteten NAS für immer
            # als „keine Aufnahmedaten lesbar" und wird nie wieder angefasst.
            # (Marc, 12.09.2026: Fotos liegen auf einem NAS im WLAN.)
            weg_ = [r for r in teil_ if not Path(r["path"]).is_file()]
            if weg_:
                fern += len(weg_)
                teil_ = [r for r in teil_ if Path(r["path"]).is_file()]
            zukunft = None
            if teil_:
                rolle = _LESER_ROLLEN[lauf_nr % LESER_FERN] if fern_jetzt else "read"
                lauf_nr += 1
                # Kennung: Videos immer, Fotos nur mit Vorschaubild (sonst bekommen sie sie in Schritt 3)
                kenn = [(r["path"], r["size"]) for r in teil_ if mit_thumbs or r["art"] != ART_FOTO]
                zukunft = leser.submit(_tags_lesen_im_faden, [r["path"] for r in teil_], rolle, fern_jetzt,
                                       mb_ * len(teil_) / max(1, len(teil_) + len(weg_)), kenn)
            vorrat.append((teil_, fern_jetzt, weg_, mb_, zukunft))

    def _vorrat_weg():
        for e in vorrat:
            if e[4] is not None:
                e[4].cancel()
        vorrat.clear()
        # auf den gerade laufenden Stapel warten (höchstens einer je Leser): ein Faden, der nach dem Ende des Laufs noch
        # liest, riss beim Beenden des Prozesses die Laufzeit mit („recursive_mutex lock failed"). Beim Schließen
        # beendet `_on_closing` exiftool zuvor, dann kehrt der Faden sofort zurück.
        leser.shutdown(wait=True, cancel_futures=True)

    t_fertig_vorher = time.monotonic()
    while i < gesamt or vorrat:
        if stop and stop():
            _vorrat_weg()
            conn.commit()
            return {"abbruch": True, "fertig": fertig, "gesamt": gesamt,
                    "fehler": fehler, "fern": fern, "haenger": haenger_n}
        _nachfuellen()
        if not vorrat:
            break
        teil, fern_hier, weg, mb_stapel, zukunft = vorrat.popleft()
        t_stapel = time.monotonic()
        rest_mb = max(0.0, rest_mb - mb_stapel)
        if not teil:
            if fortschritt:
                fortschritt(fertig, gesamt)
            continue
        pfade = [r["path"] for r in teil]
        if aktuell and pfade:   # 18.09.2026 — welche Datei gerade dran ist
            try: aktuell(pfade[0], {})
            except Exception: pass
        t_daten = time.monotonic()
        # Der nächste Stapel liest schon (anderer exiftool-Prozess), während wir auf diesen warten. Nachgefüllt wird nur
        # oben in der Schleife — so laufen nie zwei Stapel auf demselben Prozess.
        meta, tags_alle, haenger, kennungen, kenn_s = zukunft.result()
        mess["daten"] += time.monotonic() - t_daten
        mess["leser"] = LESER_FERN if fern_hier else 1
        if haenger:
            haenger_n += len(haenger)
            if haenger_n >= HAENGER_MAX:
                # exiftool hat mehrfach auch bei Einzeldateien nicht geantwortet:
                # das ist nicht die Datei, sondern der Daemon oder das Laufwerk.
                # Dann werden auch die hängenden Dateien und alles noch nicht
                # Gelesene VERTAGT wie ferne Dateien (indexed_at bleibt leer,
                # kein Fehltext) — der nächste Lauf versucht es erneut.
                gelesen = set(meta) | set(tags_alle)
                vertagt = [p for p in pfade if p not in gelesen or p in haenger]
                fern += len(vertagt)
                teil = [r for r in teil if r["path"] not in vertagt]
                pfade = [r["path"] for r in teil]
                haenger = []
        haenger = set(haenger)

        # Die Wiedererkennungs-Kennung liest 128 KB je Datei — auf dem NAS ist
        # das der langsamste Teil des Stapels. Deshalb VOR der Schreib-
        # transaktion, nicht mittendrin: solange die offen ist, wartet die
        # Oberfläche auf jeden eigenen Schreibzugriff (14.09.2026).
        # 05.10.2026 (Marcs Log: Kennung ~20 s je 200 Dateien) — beim Massenlauf (ohne Bilder) bekommen Fotos ihre
        # Kennung erst in Schritt 3: dort ist die Datei fürs Vorschaubild ohnehin gerade gelesen. Videos (kein Bild in
        # Schritt 3) und Einzeldateien (mit Bild) bekommen sie im Lese-Faden (`_tags_lesen_im_faden`, gleich nach
        # exiftool, parallel zum anderen Leser). Im Log zählt die Faden-Zeit (überlappt mit „Daten").
        mess["kennung"] += kenn_s
        t_schreib = time.monotonic()

        for r in teil:
            p = r["path"]
            pfad = Path(p)
            m = meta.get(p) or {}
            tags = tags_alle.get(p) or {}
            fehlt_grund = ""
            if p in haenger:
                fehlt_grund = "exiftool antwortet bei dieser Datei nicht (Hänger)"
                fehler += 1
            elif not m and not tags:
                fehlt_grund = FEHLTEXT_KEINE_DATEN
                fehler += 1
                # 22.09.2026 — die ersten paar je Lauf mit Pfad ins Log: ein Tester-Log
                # mit „fehler: 1433" sagte nichts darüber, ob exiftool die Datei nicht
                # fand, sie nicht lesen konnte oder der Pfad nicht zusammenpasste.
                if fehler <= 3:
                    log.warning("[fotos] keine Aufnahmedaten lesbar: %s · exiftool-Sätze im Stapel: meta %d, tags %d, "
                                "gefragt %d · Beispiel-Schlüssel: %s", p, len(meta), len(tags_alle), len(pfade),
                                (next(iter(meta), None) or next(iter(tags_alle), None) or "—"))

            dt = m.get("datetime")
            tz_min = m.get("tz_minutes")
            utc = dt.replace(tzinfo=timezone.utc).timestamp() if dt else None
            tag_lokal = jahr = None
            if utc is not None:
                lokal = datetime.fromtimestamp(utc, timezone.utc) + timedelta(minutes=tz_min or 0)
                tag_lokal = lokal.strftime("%Y-%m-%d")
                jahr = lokal.year

            kamera = m.get("camera") or _wert(tags, "Model")
            hay = _hay(pfad, tags, kamera)

            rest = {k: v for k, v in tags.items()
                    if k not in ("SourceFile", "Directory", "FileName")}
            blob = None
            if rest:
                try:
                    blob = zlib.compress(json.dumps(rest, ensure_ascii=False).encode("utf-8"), 6)
                except (TypeError, ValueError):
                    blob = None

            sql = ("UPDATE fotos SET inhalt_id = ?, aufnahme_utc = ?, tz_minuten = ?, "
                "tz_bekannt = ?, tag_lokal = ?, jahr = ?, lat = ?, lon = ?, ele = ?, "
                "kamera = ?, objektiv = ?, iso = ?, blende = ?, brennweite = ?, "
                "belichtung = ?, breite = ?, hoehe = ?, dauer_s = ?, ort = ?, region = ?, "
                "land = ?, stichworte = ?, tags_blob = ?, tags_n = ?, hay = ?, thumb = ?, "
                "indexed_at = ?, error = ? WHERE path = ?")
            werte = (kennungen.get(p),
                 utc, tz_min, 1 if tz_min is not None else 0, tag_lokal, jahr,
                 m.get("lat"), m.get("lon"), m.get("alt"),
                 kamera, _wert(tags, "LensModel", "LensID", "Lens", "LensInfo"),
                 _wert(tags, "ISO", "ISOSpeed"), _wert(tags, "FNumber", "ApertureValue"),
                 _wert(tags, "FocalLength"), _wert(tags, "ExposureTime", "ShutterSpeed"),
                 int(m["breite"]) if m.get("breite") else None,
                 int(m["hoehe"]) if m.get("hoehe") else None,
                 m.get("dauer_s"),
                 _wert(tags, "City", "Sub-location"),
                 _wert(tags, "State", "Province-State"),
                 _wert(tags, "Country", "Country-PrimaryLocationName"),
                 _wert(tags, "Keywords", "Subject"),
                 blob, len(rest), hay, 0, _jetzt(), fehlt_grund, p)
            geduldig(conn.execute, sql, werte)
            fertig += 1

        # Vorschaubilder sind der Bremsklotz, nicht das Lesen der Tags: gemessen
        # am 12.09.2026 gingen von 590 ms je Datei über 500 ms für das Bild weg
        # (große TIFFs, Videos). Darum vier Fäden parallel — sie warten ohnehin
        # meist auf Platte und Decoder.
        # Und NUR für Fotos: ein Video-Vorschaubild kostet bis zu drei
        # Werkzeuge nacheinander (qlmanage 15 s, exiftool, zweimal ffmpeg 20 s)
        # und bremste den Massenlauf aus. Videos bekommen ihr Bild beim ersten
        # Ansehen über `fotos_thumbs` (Oberfläche holt fehlende nach). Dateien,
        # bei denen exiftool hing, werden nicht auch noch fürs Bild angefasst.
        mess["schreiben"] += time.monotonic() - t_schreib
        t_bilder = time.monotonic()
        if mit_thumbs:
            fuer_thumb = [r["path"] for r in teil
                          if r["art"] == ART_FOTO and r["path"] not in haenger]
            faeden = THUMB_FAEDEN_FERN if fern_hier else THUMB_FAEDEN
            with ThreadPoolExecutor(max_workers=faeden) as pool:
                for pfad_ok, ok in pool.map(_thumb_versuch, fuer_thumb):
                    if ok:
                        geduldig(conn.execute,
                                 "UPDATE fotos SET thumb = 1 WHERE path = ?", (pfad_ok,))

        geduldig(conn.commit)
        mess["bilder"] += time.monotonic() - t_bilder
        mess["n"] += len(teil); mess["mb"] += mb_stapel; mess["gesamt"] += time.monotonic() - t_stapel
        if stapel_n % 10 == 9 and mess["n"]:
            log.info("[fotos] Schritt 2 gemessen: %d Dateien, %.0f MB in %.0f s (%.2f s/Datei) — Daten %.0f s, "
                     "Kennung %.0f s, Schreiben %.0f s, Bilder %.0f s%s%s", mess["n"], mess["mb"], mess["gesamt"],
                     mess["gesamt"] / mess["n"], mess["daten"], mess["kennung"], mess["schreiben"], mess["bilder"],
                     (f" (Netzlaufwerk, {mess.get('leser', 1)} Leser)") if fern_hier else "",
                     "" if _wach_aktiv() else " (App Nap möglich)")
            mess = dict.fromkeys(mess, 0) | {"mb": 0.0}
        # nur volle Stapel lesen das Tempo — übersprungene (Laufwerk weg) wären „unendlich schnell"
        # Wanduhr-Zeit seit dem vorigen fertigen Stapel (mit zwei Lesern überlappen sich die Stapel)
        t_jetzt = time.monotonic()
        wand = t_jetzt - t_fertig_vorher
        t_fertig_vorher = t_jetzt
        if teil and not weg:
            rz.stapel(len(teil), mb_stapel, wand)
            stapel_n += 1
            if stapel_n % 20 == 0:
                tempo_merken(conn, rz)
                geduldig(conn.commit)
        if schaetzung:
            try: schaetzung(rz.rest(max(0, gesamt - i) + sum(len(e[0]) for e in vorrat), rest_mb))
            except Exception: pass
        if fortschritt:
            fortschritt(fertig, gesamt)

        if haenger_n >= HAENGER_MAX:
            # Dauerhaft kein exiftool mehr: Lauf beenden, der Rest bleibt
            # ungelesen und kommt beim nächsten Lauf wieder dran.
            fern += (gesamt - i if i < gesamt else 0) + sum(len(e[0]) for e in vorrat)
            _vorrat_weg()
            log.warning("fotos: exiftool antwortet dauerhaft nicht (%d Einzeldateien) — "
                        "Lauf beendet, %d Dateien beim nächsten Lauf dran", haenger_n, fern)
            break

    leser.shutdown(wait=True, cancel_futures=True)
    if mess["n"]:
        log.info("[fotos] Schritt 2 gemessen (Rest): %d Dateien, %.0f MB in %.0f s (%.2f s/Datei) — Daten %.0f s, "
                 "Kennung %.0f s, Schreiben %.0f s, Bilder %.0f s%s%s", mess["n"], mess["mb"], mess["gesamt"],
                 mess["gesamt"] / mess["n"], mess["daten"], mess["kennung"], mess["schreiben"], mess["bilder"],
                 f" ({mess.get('leser', 1)} Leser)" if mess.get("leser", 1) > 1 else "",
                 "" if _wach_aktiv() else " (App Nap möglich)")
    if stapel_n:
        tempo_merken(conn, rz)
        geduldig(conn.commit)
    if fern:
        log.info("fotos: %d Dateien gerade nicht erreichbar — beim nächsten Lauf dran", fern)
    return {"fertig": fertig, "gesamt": gesamt, "fehler": fehler, "fern": fern,
            "haenger": haenger_n}


# ── Durchgang 3: Vorschaubilder (04.10.2026) ─────────────────────────────────
# Marc: „225 h … das sind ja fast 2 Wochen" → „Daten zuerst, Bilder danach": Schritt 2 liest nur noch die
# Aufnahmedaten (dann gehen Suche, Datum, Karte und Ordner gleich für den ganzen Bestand), die Vorschaubilder holt
# dieser Schritt danach. Auf dem NAS zwei Fäden: einer liest, während der andere rechnet (gemessen wird im Log).
# Wo der Mensch gerade hinschaut, holt die Oberfläche die Bilder ohnehin sofort (`api.fotos_thumbs`).
# thumb: 0 = noch keins, 1 = im Cache, -1 = ging nicht (wird erst nach einer Änderung der Datei neu versucht).
BILDER_STAPEL = 24
BILDER_FAEDEN = 4
BILDER_FAEDEN_FERN = 2


def _nur_ordner(ordner: Optional[list]) -> tuple:
    """SQL-Zusatz „nur diese Fotoordner" (None = alle)."""
    if ordner is None:
        return "", ()
    if not ordner:
        return " AND 0", ()
    return f" AND ordner IN ({','.join('?' for _ in ordner)})", tuple(ordner)


def erreichbare_ordner(conn: sqlite3.Connection) -> Optional[list]:
    """Die beobachteten Ordner, die gerade da sind (Laufwerk eingehängt und lesbar) — None, wenn das nicht klärbar ist."""
    try:
        return [o["path"] for o in ordner_liste(conn) if o["da"]]
    except Exception as e:  # noqa: BLE001
        log.debug("erreichbare_ordner: %s", e)
        return None


def ohne_bild(conn: sqlite3.Connection, ordner: Optional[list] = None) -> int:
    zus, w = _nur_ordner(ordner)
    return int(conn.execute("SELECT COUNT(*) FROM fotos WHERE fehlt_seit IS NULL AND indexed_at IS NOT NULL "
                            "AND art = ? AND COALESCE(thumb, 0) = 0" + zus, (ART_FOTO, *w)).fetchone()[0])


SCHNELL_ENDUNGEN = {".jpg", ".jpeg"}
_rollen_sperre = threading.Lock()


def _leser_setzen(rollen) -> None:
    """Pool-Initialisierer: jeder Bild-Faden bekommt seinen exiftool-Leser („read"/„read2", höchstens zwei — NAS mit
    Festplatten, s. LESER_FERN). Vorher gingen alle RAW-Vorschauen durch EINEN Prozess (06.10.2026)."""
    with _rollen_sperre:
        cexif.LESE_ROLLE.wert = next(rollen, "read")


def _jpg_geschwister(conn: sqlite3.Connection, r) -> Optional[tuple]:
    """Für eine RAW-Datei: das gleichnamige JPG im selben Ordner mit fertigem Vorschaubild → (pfad, fp, thumb)."""
    p = Path(r["path"])
    if p.suffix.lower() in SCHNELL_ENDUNGEN or not cexif.is_raw(str(p)):
        return None
    stamm = str(p.with_suffix(""))
    z = conn.execute("SELECT path, fp, thumb FROM fotos WHERE ordner = ? AND thumb IN (1, 2) AND path IN (?, ?, ?, ?)",
                     (r["ordner"], stamm + ".jpg", stamm + ".JPG", stamm + ".jpeg", stamm + ".JPEG")).fetchone()
    return (z["path"], z["fp"], z["thumb"]) if z else None


def _bild_versuch(arg: tuple) -> tuple:
    """(Pfad, Bild ok?, Kennung) — die Kennung hier, weil die Datei fürs Bild gerade gelesen wurde (Schritt 2 lässt
    sie bei Fotos aus, 05.10.2026). `ok`: True (volles Bild), "schnell" (eingebettetes EXIF-Vorschaubild, 06.10.2026),
    False (kein Bild möglich), None (gerade nicht lesbar)."""
    path, fp, size, kennung = arg[:4]
    schnell = len(arg) > 4 and arg[4]
    geschwister = arg[5] if len(arg) > 5 else None
    vorrat = len(arg) > 6 and arg[6]
    if geschwister:
        # 06.10.2026 — RAW+JPG-Paar: die RAW übernimmt das Vorschaubild des JPG (kein exiftool übers NAS)
        gp, gfp, gthumb = geschwister
        daten = cphotos.thumb_gecacht(gp, cphotos.THUMB_RASTER_PX, gfp, nur_cache=True)
        if daten and cphotos.thumb_ablegen(path, cphotos.THUMB_RASTER_PX, fp, daten):
            if not kennung:
                try:
                    kopf, ende = kopf_und_ende(path, int(size or 0))
                    kennung = kennung_aus(kopf, ende, int(size or 0))
                except OSError:
                    return path, None, kennung
            return path, ("schnell" if gthumb == 2 else True), kennung
    if schnell and Path(path).suffix.lower() in SCHNELL_ENDUNGEN:
        # 06.10.2026 (Marc: „B ja") — EIN Öffnen, 64 KB vorn (+ 64 KB hinten für die Kennung) statt der ganzen Datei
        try:
            kopf, ende = kopf_und_ende(path, int(size or 0))
        except OSError:
            return path, None, kennung
        if not kennung:
            kennung = kennung_aus(kopf, ende, int(size or 0)) if size else None
        daten = cphotos.schnellbild_aus_kopf(kopf, cphotos.THUMB_RASTER_PX)
        if daten and cphotos.thumb_ablegen(path, cphotos.THUMB_RASTER_PX, fp, daten):
            return path, "schnell", kennung
    try:
        if vorrat:
            # 06.10.2026 (Marc: „A") — Inhaltssuche an: EIN Dekodieren für Rasterbild UND 600er (→ Vorrat der Suche)
            klein, gross = cphotos.thumb_und_quelle(path, fp)
            ok = bool(klein)
            if gross:
                cphotos.vorrat_ablegen(path, gross)
        else:
            ok = bool(cphotos.thumb_gecacht(path, cphotos.THUMB_RASTER_PX, fp))
    except Exception:  # noqa: BLE001
        ok = False
    # Audit B-5 (05.10.2026): fiel das NAS mitten im Stapel weg, bekam die Datei dauerhaft thumb = -1 und kam nie
    # wieder dran. Ist sie jetzt nicht (mehr) erreichbar, ist das kein Formatfehler: None = später noch einmal.
    if ok is False and not os.path.isfile(path):
        ok = None
    if not kennung:
        try:
            kennung = inhalt_id(Path(path), int(size or 0)) or None
        except Exception:  # noqa: BLE001
            kennung = None
    return path, ok, kennung


def durchgang3(conn: sqlite3.Connection, fortschritt: Optional[Callable] = None,
               stop: Optional[Callable] = None, aktuell: Optional[Callable] = None,
               schaetzung: Optional[Callable] = None, ordner: Optional[list] = None,
               schnell: bool = False, vorrat: bool = False) -> dict:
    """Vorschaubilder für alles Gelesene ohne Bild. Abbrechbar; macht beim nächsten Lauf weiter.

    Audit B-6 (05.10.2026): nur in erreichbaren Ordnern — unterwegs ohne NAS lief sonst alle 20 Minuten ein Durchgang
    über den ganzen Bestand, mit `is_file` je Datei (auf einem hängenden Mount Sekunden je Aufruf)."""
    if ordner is None:
        ordner = erreichbare_ordner(conn)
    zus, w = _nur_ordner(ordner)
    # 06.10.2026 — je Ordner erst die JPEGs: eine RAW-Datei daneben übernimmt dann deren Vorschaubild (RAW+JPG-Paar)
    offen = conn.execute("SELECT path, ordner, fp, size, inhalt_id FROM fotos WHERE fehlt_seit IS NULL AND indexed_at IS NOT NULL "
                         "AND art = ? AND COALESCE(thumb, 0) = 0" + zus +
                         " ORDER BY ordner, CASE WHEN lower(path) LIKE '%.jpg' OR lower(path) LIKE '%.jpeg' THEN 0 ELSE 1 END, path",
                         (ART_FOTO, *w)).fetchall()
    gesamt = len(offen)
    fertig = ok_n = fehl = fern = 0
    rz = RestZeit(tempo_lesen(conn, "fotos_tempo3"))
    rest_mb = sum(float(r["size"] or 0) for r in offen) / 1e6
    if fortschritt and gesamt:
        fortschritt(0, gesamt)
    if schaetzung:
        try: schaetzung(rz.rest(gesamt, rest_mb))
        except Exception: pass
    stapel_n = 0
    schnell_n = 0
    mess = {"n": 0, "mb": 0.0, "s": 0.0}
    i = 0
    while i < gesamt:
        if stop and stop():
            break
        teil = offen[i:i + BILDER_STAPEL]
        i += len(teil)
        t0 = time.monotonic()
        fern_hier = ist_fern(teil[0]["path"])
        # 06.10.2026 — kein `is_file` je Datei mehr vorweg (auf dem NAS 14–35 ms je Aufruf): der Leseversuch merkt selbst,
        # wenn eine Datei fehlt (→ None = „gerade nicht lesbar", zählt unten als fern)
        da = list(teil)
        if aktuell and da:
            try: aktuell(da[0]["path"], {})
            except Exception: pass
        faeden = BILDER_FAEDEN_FERN if fern_hier else BILDER_FAEDEN
        ergebnis = []
        if da:
            rollen = iter(_LESER_ROLLEN * faeden)
            vorrat_hier = bool(vorrat) and cphotos.vorrat_anzahl() < cphotos.VORRAT_MAX
            with ThreadPoolExecutor(max_workers=faeden, initializer=_leser_setzen, initargs=(rollen,)) as pool:
                ergebnis = list(pool.map(_bild_versuch, [(r["path"], r["fp"], r["size"], r["inhalt_id"], schnell,
                                                          _jpg_geschwister(conn, r), vorrat_hier) for r in da]))
        for pfad_ok, gut, kennung in ergebnis:
            if gut is None:     # gerade nicht lesbar → thumb bleibt 0, der nächste Lauf versucht es wieder
                fern += 1
                if kennung:
                    geduldig(conn.execute, "UPDATE fotos SET inhalt_id = COALESCE(?, inhalt_id) WHERE path = ?",
                             (kennung, pfad_ok))
                continue
            # thumb: 1 = volles Bild, 2 = Schnellbild (wird beim Ansehen scharf), -1 = keins möglich
            geduldig(conn.execute, "UPDATE fotos SET thumb = ?, inhalt_id = COALESCE(?, inhalt_id) WHERE path = ?",
                     (2 if gut == "schnell" else 1 if gut else -1, kennung, pfad_ok))
            schnell_n += 1 if gut == "schnell" else 0
            ok_n += 1 if gut else 0
            fehl += 0 if gut else 1
        geduldig(conn.commit)
        fertig += len(teil)
        mb = sum(float(r["size"] or 0) for r in teil) / 1e6
        rest_mb = max(0.0, rest_mb - mb)
        dt = time.monotonic() - t0
        if da and len(da) == len(teil):
            rz.stapel(len(teil), mb, dt)
            stapel_n += 1
            mess["n"] += len(teil); mess["mb"] += mb; mess["s"] += dt
            if stapel_n % 10 == 0:
                tempo_merken(conn, rz, "fotos_tempo3")
                geduldig(conn.commit)
                log.info("[fotos] Schritt 3 gemessen: %d Bilder, %.0f MB in %.0f s (%.2f s/Bild, %d Fäden, %d Schnellbilder)%s",
                         mess["n"], mess["mb"], mess["s"], mess["s"] / mess["n"], faeden, schnell_n - mess.get("s0", 0),
                         " (Netzlaufwerk)" if fern_hier else "")
                mess = {"n": 0, "mb": 0.0, "s": 0.0, "s0": schnell_n}
        if schaetzung:
            try: schaetzung(rz.rest(gesamt - i, rest_mb))
            except Exception: pass
        if fortschritt:
            fortschritt(fertig, gesamt)
    if mess["n"]:
        log.info("[fotos] Schritt 3 gemessen (Rest): %d Bilder, %.0f MB in %.0f s (%.2f s/Bild)",
                 mess["n"], mess["mb"], mess["s"], mess["s"] / mess["n"])
    if stapel_n:
        tempo_merken(conn, rz, "fotos_tempo3")
        geduldig(conn.commit)
    return {"fertig": fertig, "gesamt": gesamt, "bilder": ok_n, "ohne": fehl, "fern": fern, "schnell": schnell_n,
            "abbruch": bool(stop and stop())}


def fps_lesen(conn: sqlite3.Connection, pfade: list) -> dict:
    """Die gemerkten Cache-Schlüssel zu diesen Pfaden — ein Zugriff für alle.

    Damit kommen die Vorschaubilder auch dann aus dem Cache, wenn das Laufwerk
    gerade nicht erreichbar ist (NAS im WLAN, Platte am Schreibtisch).
    """
    raus = {}
    pfade = [p for p in (pfade or []) if p]
    for i in range(0, len(pfade), 400):
        teil = pfade[i:i + 400]
        platz = ",".join("?" for _ in teil)
        for r in conn.execute(f"SELECT path, fp FROM fotos WHERE path IN ({platz})", tuple(teil)):
            if r["fp"]:
                raus[r["path"]] = r["fp"]
    return raus


# Wie lange ein vollständiger Blick in die Ordner gilt, bevor er beim Öffnen
# des Bereichs erneut läuft. Auf einem NAS im WLAN kostet ein solcher Durchlauf
# Minuten (gemessen am 12.09.2026), deshalb nicht bei jedem Öffnen.
NACHSCHAU_STUNDEN = 6
# 06.10.2026 — solange noch gelesen wird (Ungelesenes/Vorschaubilder offen), wartet die Nachschau bis zu so lange
NACHSCHAU_OFFEN_MAX_H = 24


def geduldig(fn, *args, versuche: int = 10, pause: float = 0.4):
    """Einen Datenbankzugriff wiederholen, solange jemand anders schreibt.

    WAL lässt Lesen und Schreiben nebeneinander laufen, aber **zwei Schreiber**
    schließen sich weiterhin aus. Der Scan-Faden und die Oberfläche schreiben
    beide (Bestand hier, gelernte Cache-Schlüssel dort) — ohne Geduld bricht der
    lange Lauf ab, sobald er einmal unglücklich trifft. Genau das hat Marc am
    12.09.2026 gesehen: „es läuft kurz los und dann kommt der Knopf."
    """
    for i in range(versuche):
        try:
            return fn(*args)
        except sqlite3.OperationalError as e:
            if "locked" not in str(e).lower() and "busy" not in str(e).lower():
                raise
            if i == versuche - 1:
                raise
            log.info("fotos: Datenbank belegt — warte (%d/%d)", i + 1, versuche)
            time.sleep(pause * (i + 1))
    return None


def letzte_nachschau(conn: sqlite3.Connection) -> Optional[float]:
    r = conn.execute("SELECT value FROM meta WHERE key = 'fotos_nachschau'").fetchone()
    try:
        return float(r["value"]) if r and r["value"] else None
    except (TypeError, ValueError):
        return None


def nachschau_merken(conn: sqlite3.Connection) -> None:
    conn.execute("INSERT INTO meta(key, value) VALUES('fotos_nachschau', ?) "
                 "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                 (str(datetime.now(timezone.utc).timestamp()),))
    conn.commit()


def was_zu_tun(conn: sqlite3.Connection) -> dict:
    """Was beim Öffnen des Bereichs von selbst nachgeholt werden sollte.

    Marc, 12.09.2026: „wenn ich einen ordner hinzugefügt habe, dann will ich
    doch auch, dass der gemonitort wird … und wenn sich im ordner etwas
    geändert hat, muss das die app ja auch merken."

    Zwei getrennte Fragen: **Ungelesenes** weiterlesen kostet nur die Dateien,
    die ohnehin drankommen — das ist immer fällig. Ein **vollständiger Blick**
    in die Ordner kostet auf einem Netzlaufwerk Minuten, der läuft nur, wenn er
    lange genug her ist.
    """
    liste = ordner_liste(conn)
    erreichbar = [o["path"] for o in liste if o["da"]]
    with db_sperre():
        offen = conn.execute("SELECT COUNT(*) FROM fotos WHERE indexed_at IS NULL "
                             "AND fehlt_seit IS NULL").fetchone()[0]
        letzte = letzte_nachschau(conn)
        ob = ohne_bild(conn, erreichbar)    # Audit B-6: Fotos auf einem gerade fehlenden Laufwerk sind kein Startgrund
    alt = (datetime.now(timezone.utc).timestamp() - letzte) if letzte else None
    faellig = (letzte is None) or (alt is not None and alt > NACHSCHAU_STUNDEN * 3600)
    return {"ungelesen": int(offen), "ohne_bild": ob, "nachschau_faellig": bool(faellig and erreichbar),
            "letzte_nachschau": letzte, "ordner_da": len(erreichbar),
            "ordner": len(liste)}


def fp_setzen(conn: sqlite3.Connection, werte: dict) -> int:
    """Nachträglich gelernte Cache-Schlüssel merken.

    Bibliotheken von vor dieser Fassung haben die Spalte leer. Wer ohnehin ein
    Vorschaubild baut, hat den Wert gerade in der Hand — dann steht er beim
    nächsten Öffnen bereit und die Seite kommt ohne einen einzigen `stat` aus.
    """
    n = 0
    try:
        for pfad, fp in (werte or {}).items():
            if fp:
                n += conn.execute("UPDATE fotos SET fp = ? WHERE path = ? AND "
                                  "COALESCE(fp,'') != ?", (fp, pfad, fp)).rowcount or 0
    finally:
        # IMMER abschließen — auch wenn keine Zeile passte. Pythons sqlite3
        # öffnet vor jedem UPDATE still eine Schreibtransaktion; ohne commit
        # blieb sie offen, hielt die Schreibsperre der ganzen Bibliothek, und
        # der Foto-Scan im Hintergrund lief nach 30 Sekunden Warten mit
        # „database is locked" auf. Genau das war Marcs Abbruch am 12.09.2026
        # („es läuft kurz los und dann kommt der Knopf").
        conn.commit()
    return n


def fp_lesen(conn: sqlite3.Connection, path: str) -> str:
    r = conn.execute("SELECT fp FROM fotos WHERE path = ?", (path,)).fetchone()
    return (r["fp"] or "") if r else ""


def _thumb_versuch(path: str) -> tuple:
    """Ein Vorschaubild in den Cache legen. Läuft in einem eigenen Faden."""
    try:
        return path, bool(cphotos.thumb_gecacht(path, cphotos.THUMB_RASTER_PX))
    except Exception:
        return path, False


def tags_lesen(conn: sqlite3.Connection, path: str) -> dict:
    """Die gepackten Tags eines Fotos auspacken — für die Detailansicht."""
    r = conn.execute("SELECT tags_blob FROM fotos WHERE path = ?", (path,)).fetchone()
    if not r or not r["tags_blob"]:
        return {}
    try:
        return json.loads(zlib.decompress(r["tags_blob"]).decode("utf-8"))
    except (zlib.error, ValueError, UnicodeDecodeError):
        return {}


# ── Abfragen ────────────────────────────────────────────────────────────────

def _where(f: dict) -> tuple:
    """Filter → (SQL-Bedingung, Werte). Ein Ort für alles, damit Liste, Karte
    und Zählung nie unterschiedlich filtern (Lehre aus dem Track-Archiv)."""
    f = f or {}
    teile = ["1=1"]
    werte: list = []

    if not f.get("mit_fehlenden"):
        teile.append("fehlt_seit IS NULL")
    if f.get("art") in (ART_FOTO, ART_VIDEO):
        teile.append("art = ?")
        werte.append(f["art"])
    if f.get("jahr"):
        teile.append("jahr = ?")
        werte.append(int(f["jahr"]))
    if f.get("kamera"):
        teile.append("kamera = ?")
        werte.append(f["kamera"])
    if f.get("ordner"):
        teile.append("ordner = ?")
        werte.append(f["ordner"])
    # 04.10.2026 (Marc: „die Unterordner sehe ich nirgends … dass man sich auch da durchklicken kann") — ein Ordner
    # samt allen Unterordnern, als Bereich über den Primärschlüssel (schnell, kein LIKE): „/a/b/" ≤ path < „/a/b0"
    if f.get("verz"):
        teile.append("(path > ? AND path < ?)")
        werte.extend(pfadbereich(f["verz"]))
    if f.get("gps") == "mit":
        teile.append("lat IS NOT NULL AND lon IS NOT NULL")
    elif f.get("gps") == "ohne":
        teile.append("(lat IS NULL OR lon IS NULL)")
    if f.get("ohne_zeit"):
        teile.append("aufnahme_utc IS NULL")
    if f.get("von"):
        teile.append("tag_lokal >= ?")
        werte.append(str(f["von"])[:10])
    if f.get("bis"):
        teile.append("tag_lokal <= ?")
        werte.append(str(f["bis"])[:10])
    if f.get("von_utc") is not None:
        teile.append("aufnahme_utc >= ?")
        werte.append(float(f["von_utc"]))
    if f.get("bis_utc") is not None:
        teile.append("aufnahme_utc <= ?")
        werte.append(float(f["bis_utc"]))

    # 04.10.2026 (IDEAS §81) — die Inhaltssuche liefert eine fertige Trefferliste; sie ersetzt dann `suche`
    # (app.py `_filter_mit_inhalt`), damit Raster, Karte, Tage und Touren dieselben Treffer zeigen.
    if f.get("pfade") is not None:
        pf = [str(p) for p in f["pfade"]]
        if pf:
            teile.append("path IN (%s)" % ",".join("?" * len(pf)))
            werte.extend(pf)
        else:
            teile.append("0")
    suche = " ".join(str(f.get("suche") or "").split()).lower()
    if suche:
        if _FTS_OK:
            teile.append("rowid IN (SELECT rowid FROM fotos_fts2 WHERE fotos_fts2 MATCH ?)")
            werte.append(" AND ".join(f'"{w}"' for w in suche.split()))
        else:
            for w in suche.split():
                teile.append("hay LIKE ?")
                werte.append(f"%{w}%")
    return " AND ".join(teile), werte


_SPALTEN = ("path, ordner, dateiname, art, size, aufnahme_utc, tz_minuten, tz_bekannt, "
            "tag_lokal, jahr, lat, lon, ele, kamera, objektiv, iso, blende, brennweite, "
            "belichtung, breite, hoehe, dauer_s, ort, region, land, stichworte, tags_n, "
            "thumb, fehlt_seit, indexed_at, error")


def abfrage(conn: sqlite3.Connection, filter: Optional[dict] = None,
            limit: int = 300, offset: int = 0, sortierung: str = "zeit_neu") -> dict:
    """Eine Seite des Bestands, plus die Gesamtzahl zum Filter."""
    wo, werte = _where(filter or {})
    ordnung = {
        "zeit_neu": "aufnahme_utc DESC NULLS LAST, dateiname DESC",
        "zeit_alt": "aufnahme_utc ASC NULLS LAST, dateiname ASC",
        "name": "dateiname ASC",
        "ordner": "ordner ASC, dateiname ASC",
    }.get(sortierung, "aufnahme_utc DESC NULLS LAST, dateiname DESC")
    n = conn.execute(f"SELECT COUNT(*) FROM fotos WHERE {wo}", werte).fetchone()[0]
    # 25.09.2026 — „ohne Koordinate" für die TREFFER, nicht für den ganzen Bestand:
    # die Suche „Canon" zeigte „1 Dateien · 8 ohne Koordinate". Gezählt wie in
    # `stand()`: nur Gelesenes, Ungelesenes hat noch gar keine Koordinate.
    # Nur mit der ersten Seite — beim Weiterblättern ändert sich die Zahl nicht.
    ohne = conn.execute(
        f"SELECT COUNT(*) FROM fotos WHERE {wo} AND indexed_at IS NOT NULL "
        f"AND (lat IS NULL OR lon IS NULL)", werte).fetchone()[0] if not int(offset) else None
    rows = conn.execute(
        f"SELECT {_SPALTEN} FROM fotos WHERE {wo} ORDER BY {ordnung} LIMIT ? OFFSET ?",
        werte + [int(limit), int(offset)]).fetchall()
    return {"n": n, "ohne_koordinate": ohne, "fotos": [dict(r) for r in rows]}


def zeile(conn: sqlite3.Connection, path: str) -> Optional[dict]:
    """Eine Datei aus dem Bestand — ohne die gepackten Tags (siehe `tags_lesen`)."""
    r = conn.execute(f"SELECT {_SPALTEN} FROM fotos WHERE path = ?", (path,)).fetchone()
    return dict(r) if r else None


def zeilen(conn: sqlite3.Connection, pfade: list) -> dict:
    """Mehrere Dateien auf einmal, als {path: zeile} — für Listen in fester Reihenfolge (Inhaltssuche)."""
    raus = {}
    for i in range(0, len(pfade), 500):
        t = pfade[i:i + 500]
        for r in conn.execute(f"SELECT {_SPALTEN} FROM fotos WHERE path IN (%s)" % ",".join("?" * len(t)), t):
            raus[r["path"]] = dict(r)
    return raus


def tage(conn: sqlite3.Connection, filter: Optional[dict] = None, limit: int = 2000) -> list:
    """Anzahl je Tag — die Gliederung der Rasteransicht."""
    wo, werte = _where(filter or {})
    rows = conn.execute(
        f"SELECT tag_lokal AS tag, COUNT(*) AS n, MIN(aufnahme_utc) AS von, "
        f"MAX(aufnahme_utc) AS bis, SUM(lat IS NOT NULL) AS mit_gps "
        f"FROM fotos WHERE {wo} GROUP BY tag_lokal "
        f"ORDER BY tag DESC NULLS LAST LIMIT ?", werte + [int(limit)]).fetchall()
    return [dict(r) for r in rows]


def datumsbaum(conn: sqlite3.Connection, filter: Optional[dict] = None) -> list:
    """Anzahl je Aufnahmetag, OHNE Begrenzung — für den Baum „Nach Datum" (Jahr → Monat → Tag) in der Seitenleiste
    (04.10.2026, Marc nach Lightroom-Vorbild). Datumsteile des Filters (von/bis/jahr) gelten hier nicht, sonst
    schrumpfte der Baum beim Klicken auf den gewählten Tag. Tage ohne Aufnahmezeit fehlen (eigener Eintrag links)."""
    g = {k: v for k, v in (filter or {}).items() if k not in ("von", "bis", "jahr", "von_utc", "bis_utc")}
    wo, werte = _where(g)
    rows = conn.execute(f"SELECT tag_lokal AS tag, COUNT(*) AS n FROM fotos WHERE {wo} AND tag_lokal IS NOT NULL "
                        f"GROUP BY tag_lokal ORDER BY tag_lokal", werte).fetchall()
    return [{"tag": r["tag"], "n": r["n"]} for r in rows]


def ordnerbaum(conn: sqlite3.Connection, filter: Optional[dict] = None) -> dict:
    """Anzahl je Verzeichnis (nur die Dateien direkt darin) und die beobachteten Wurzeln — für den Baum „Nach Ordner"
    in der Seitenleiste (04.10.2026). Zusammengezählt und verschachtelt wird in der Oberfläche. Der Ordnerfilter
    selbst (`verz`) und die Suche gelten hier nicht, sonst schrumpfte der Baum beim Klicken."""
    g = {k: v for k, v in (filter or {}).items() if k not in ("verz", "suche", "aehnlich", "pfade")}
    wo, werte = _where(g)
    zaehl: dict = {}
    for (p,) in conn.execute(f"SELECT path FROM fotos WHERE {wo}", werte):
        d = os.path.dirname(p)
        zaehl[d] = zaehl.get(d, 0) + 1
    wurzeln = [r["path"] for r in conn.execute("SELECT path FROM foto_ordner ORDER BY path")]
    return {"wurzeln": wurzeln, "verz": sorted(zaehl.items())}


def punkte(conn: sqlite3.Connection, filter: Optional[dict] = None,
           raster: int = 3) -> list:
    """Punktwolke für die Karte: zusammengefasste Koordinaten mit Anzahl.

    `raster` = Nachkommastellen der Zusammenfassung (3 ≈ 100 m). Ohne das
    Zusammenfassen sind zehntausend Punkte ein Brei — mit ihm wird die Dichte
    zur Helligkeit, wie Marc es von Google Fotos kennt.
    """
    f = dict(filter or {})
    f["gps"] = "mit"
    wo, werte = _where(f)
    r = max(0, min(6, int(raster)))
    rows = conn.execute(
        f"SELECT ROUND(lat, {r}) AS lat, ROUND(lon, {r}) AS lon, COUNT(*) AS n "
        f"FROM fotos WHERE {wo} GROUP BY ROUND(lat, {r}), ROUND(lon, {r}) "
        f"ORDER BY n DESC", werte).fetchall()
    return [{"lat": x["lat"], "lon": x["lon"], "n": x["n"]} for x in rows]


def kameras(conn: sqlite3.Connection) -> list:
    rows = conn.execute("SELECT kamera, COUNT(*) n FROM fotos WHERE kamera <> '' "
                        "AND fehlt_seit IS NULL GROUP BY kamera ORDER BY n DESC").fetchall()
    return [{"kamera": r["kamera"], "n": r["n"]} for r in rows]


def jahre(conn: sqlite3.Connection) -> list:
    rows = conn.execute("SELECT jahr, COUNT(*) n FROM fotos WHERE jahr IS NOT NULL "
                        "AND fehlt_seit IS NULL GROUP BY jahr ORDER BY jahr DESC").fetchall()
    return [{"jahr": r["jahr"], "n": r["n"]} for r in rows]


def stand(conn: sqlite3.Connection) -> dict:
    """Was der Bestand hält — und was ihm fehlt. Die fehlenden Angaben stehen
    sichtbar im Archiv, statt still zu fehlen (Marc, Q16)."""
    # 06.10.2026 (Marc: „im Archiv, wenn man auf Fotos geht, muss er immer erst lesen") — neun Zählungen waren neun
    # Durchgänge über den ganzen Bestand (370.000 Zeilen: ~240 ms, neben einem laufenden Einlesen ein Vielfaches).
    # Jetzt EIN Durchgang mit Summen je Bedingung; die Zahlen sind dieselben (tests/test_fotos_oeffnen_schnell.py).
    r = conn.execute(
        "SELECT"
        " SUM(fehlt_seit IS NULL),"
        " SUM(fehlt_seit IS NULL AND art = ?),"
        " SUM(fehlt_seit IS NULL AND art = ?),"
        " SUM(fehlt_seit IS NULL AND indexed_at IS NULL),"
        " SUM(fehlt_seit IS NULL AND indexed_at IS NOT NULL AND art = ? AND COALESCE(thumb, 0) = 0),"
        " SUM(fehlt_seit IS NULL AND indexed_at IS NOT NULL AND (lat IS NULL OR lon IS NULL)),"
        " SUM(fehlt_seit IS NULL AND indexed_at IS NOT NULL AND aufnahme_utc IS NULL),"
        " SUM(fehlt_seit IS NULL AND aufnahme_utc IS NOT NULL AND tz_bekannt = 0),"
        " SUM(fehlt_seit IS NOT NULL)"
        " FROM fotos", (ART_FOTO, ART_VIDEO, ART_FOTO)).fetchone()
    z = [int(x or 0) for x in r]
    return {
        "gesamt": z[0], "fotos": z[1], "videos": z[2], "ungelesen": z[3], "ohne_bild": z[4],
        "ohne_koordinate": z[5], "ohne_zeit": z[6], "zeit_geraten": z[7], "fehlt": z[8],
        "ordner": conn.execute("SELECT COUNT(*) FROM foto_ordner").fetchone()[0],
    }


# ── Fotos und Touren ────────────────────────────────────────────────────────
#
# Gerechnet, nicht gespeichert (Marc, Q11): die Touren haben Anfang und Ende in
# der Datenbank. Eine gespeicherte Zuordnung müsste nach jeder
# Zeitzonen-Korrektur neu geschrieben werden.

SPIELRAUM_S = 30 * 60      # wie im Geotagger: eine halbe Stunde Spielraum


def _epoche(iso: Optional[str]) -> Optional[float]:
    if not iso:
        return None
    try:
        return datetime.fromisoformat(str(iso)).timestamp()
    except ValueError:
        return None


def tour_fenster(conn: sqlite3.Connection) -> list:
    """Alle Touren mit Zeitfenster, jüngste zuerst — Grundlage der Zuordnung."""
    raus = []
    # NULLIF, nicht nur COALESCE: `display_name` und `name` sind mit '' vorbelegt,
    # ein reines COALESCE liefert dann den leeren Text und die Tour heißt „—".
    for r in conn.execute("SELECT path, geo_hash, COALESCE(NULLIF(display_name, ''), "
                          "NULLIF(name, ''), NULLIF(filename, ''), path) AS name, "
                          "started_at, ended_at, COALESCE(n_segments, 1) AS n_seg FROM tracks "
                          "WHERE started_at IS NOT NULL AND ended_at IS NOT NULL "
                          "AND COALESCE(hidden, 0) = 0").fetchall():
        von, bis = _epoche(r["started_at"]), _epoche(r["ended_at"])
        if von is None or bis is None:
            continue
        raus.append({"path": r["path"], "geo_hash": r["geo_hash"], "name": r["name"],
                     "von": von, "bis": bis, "n_seg": int(r["n_seg"] or 1)})
    raus.sort(key=lambda x: x["von"], reverse=True)
    return raus


# 04.10.2026 (Marc, Screenshot: „Striche kreuz und quer durch den eigentlichen Rundweg … von den einzelnen Etappen")
# Eine zusammengeführte Tour („66 Seen #1 + #2 + …", 29 Etappen von 2024 bis 2026) hat als Zeitfenster Anfang der
# ersten bis Ende der letzten Etappe — zwei Jahre. Ein Foto vom 26.02.2026 „lief" damit auf ihr, obwohl an dem Tag
# keine Etappe gelaufen wurde, und die Detailkarte verband die Etappen-Enden mit geraden Strichen (das Archiv kennt
# nur eine Linie aus 80 Punkten). Jetzt: bei mehreren Etappen über mehr als ETAPPEN_AB_S zählt nur die Zeit der
# einzelnen Etappen, und gezeichnet wird je Etappe getrennt — beides aus der Datei, einmal gelesen und gemerkt.
ETAPPEN_AB_S = 36 * 3600
ETAPPEN_PUNKTE = 1500
_ETAPPEN_MERK: dict = {}
ETAPPEN_PRUEFEN_S = 30


def etappen(path: str) -> Optional[dict]:
    """{fenster: [(von, bis) je Etappe], teile: [[[lon, lat], …] je Etappe]} aus der Tour-Datei — oder None."""
    # Audit B-7 (05.10.2026): `touren_zu_fotos` fragt je Foto — bis 100 000 `os.stat` je Aufruf, am NAS sehr langsam.
    # Die Datei wird höchstens alle ETAPPEN_PRUEFEN_S neu angesehen; ist sie gerade nicht lesbar, gilt das Gemerkte.
    m = _ETAPPEN_MERK.get(path)
    jetzt = time.monotonic()
    if m and jetzt - m[2] < ETAPPEN_PRUEFEN_S:
        return m[1]
    try:
        st = os.stat(path)
    except OSError:
        return m[1] if m else None
    k = (st.st_mtime, st.st_size)
    if m and m[0] == k:
        _ETAPPEN_MERK[path] = (k, m[1], jetzt)
        return m[1]
    try:
        from core import gpx as cgpx
        pts, _ = cgpx.parse_gpx(path)
    except Exception as e:  # noqa: BLE001
        log.debug("etappen(%s): %s", path, e)
        return None
    je: dict = {}
    for p in pts:
        je.setdefault(p.seg, []).append(p)
    gesamt = max(1, len(pts))
    fenster, teile = [], []
    for seg in sorted(je):
        ps = je[seg]
        zeiten = [_epoche(p.time) for p in ps if p.time]
        zeiten = [z for z in zeiten if z is not None]
        if zeiten:
            fenster.append((min(zeiten), max(zeiten)))
        n = max(2, round(ETAPPEN_PUNKTE * len(ps) / gesamt))
        schritt = max(1, len(ps) // n)
        linie = [[round(p.lon, 5), round(p.lat, 5)] for p in ps[::schritt]]
        if ps[-1] is not ps[::schritt][-1]:
            linie.append([round(ps[-1].lon, 5), round(ps[-1].lat, 5)])
        if len(linie) > 1:
            teile.append(linie)
    erg = {"fenster": fenster, "teile": teile}
    _ETAPPEN_MERK[path] = (k, erg, jetzt)
    return erg


def _in_etappe(t: dict, utc: float, spielraum: int) -> bool:
    if (t.get("n_seg") or 1) <= 1 or (t["bis"] - t["von"]) <= ETAPPEN_AB_S:
        return True
    e = etappen(t["path"])
    if not e or not e["fenster"]:
        return True            # Datei gerade nicht lesbar: wie bisher nach dem ganzen Fenster
    return any((v - spielraum) <= utc <= (b + spielraum) for v, b in e["fenster"])


def tour_zu_zeit(fenster: list, utc: Optional[float],
                 spielraum: int = SPIELRAUM_S) -> Optional[dict]:
    """Welche Tour lief zu diesem Zeitpunkt? Bei Überschneidung die kürzere,
    weil ein Spaziergang innerhalb einer Womo-Etappe der genauere Treffer ist.
    Zusammengeführte Touren zählen nur in der Zeit ihrer Etappen (s. `etappen`)."""
    if utc is None:
        return None
    treffer = [t for t in fenster if (t["von"] - spielraum) <= utc <= (t["bis"] + spielraum)
               and _in_etappe(t, utc, spielraum)]
    if not treffer:
        return None
    return min(treffer, key=lambda t: t["bis"] - t["von"])


def tour_fuer_foto(conn: sqlite3.Connection, d: dict) -> Optional[dict]:
    """Welche Tour deckt die Aufnahmezeit dieses Fotos ab — mit Streckenverlauf.

    Der Verlauf (`geom`) liegt im Archiv schon vereinfacht vor, er kostet also
    nichts extra. Damit kann die Detailspalte das Bild AUF seiner Tour zeigen.
    """
    t = tour_zu_zeit(tour_fenster(conn), d.get("aufnahme_utc"))
    if not t:
        return None
    r = conn.execute("SELECT geom, COALESCE(missing_since,'') AS weg FROM tracks "
                     "WHERE path = ? LIMIT 1", (t["path"],)).fetchone()
    geom = []
    if r and r["geom"]:
        try:
            geom = json.loads(r["geom"])
        except (TypeError, ValueError):
            geom = []
    teile = None
    if (t.get("n_seg") or 1) > 1:
        e = etappen(t["path"])
        teile = e["teile"] if e and e["teile"] else None
    return {"name": t["name"], "geo_hash": t["geo_hash"], "path": t["path"],
            "von": t["von"], "bis": t["bis"], "geom": geom, "teile": teile,
            "datei_da": bool(r and not r["weg"])}


# Was an einem Foto fehlt, als Schlüssel. Der Text steht in der Oberfläche —
# hier nur der Befund, die Stufe und ob wir ihn lösen können.
def befunde_foto(conn: sqlite3.Connection, d: dict,
                 tour: Optional[dict] = None) -> list:
    """Erkannte Mängel eines Fotos samt Lösungsweg.

    Marc, 12.09.2026: „anzeigen was für probleme gemeldet werden und ob wir die
    lösen können." Also nicht nur „keine Koordinate", sondern: es gibt eine Tour
    zu dieser Zeit, der Geotagger kann das Bild verorten — oder eben nicht.
    """
    raus = []

    def fund(key, stufe, loesbar, aktion="", **rest):
        raus.append(dict({"key": key, "stufe": stufe, "loesbar": bool(loesbar),
                          "aktion": aktion}, **rest))

    if d.get("fehlt_seit"):
        fund("datei_weg", "gelb", False, "", seit=d.get("fehlt_seit"))
    if d.get("error"):
        fund("lesefehler", "rot", False, "", text=str(d.get("error"))[:200])

    hat_zeit = d.get("aufnahme_utc") is not None
    if not hat_zeit:
        fund("keine_zeit", "rot", False, "", mtime=d.get("mtime"))
    elif not d.get("tz_bekannt"):
        # Mit Track lässt sich die Zeitzone berechnen, ohne bleibt sie geraten.
        fund("zeitzone_geraten", "gelb", bool(tour), "geotagger" if tour else "",
             tour=(tour or {}).get("name", ""))

    if d.get("lat") is None or d.get("lon") is None:
        if tour and tour.get("geom"):
            fund("keine_koordinate", "gelb", True, "geotagger",
                 tour=tour.get("name", ""), tour_pfad=tour.get("path", ""),
                 tour_da=bool(tour.get("datei_da")))
        elif hat_zeit:
            fund("keine_koordinate", "gelb", False, "")
        else:
            fund("keine_koordinate", "gelb", False, "")
    return raus


def touren_zu_fotos(conn: sqlite3.Connection, filter: Optional[dict] = None) -> list:
    """Der Bestand nach Touren gruppiert: welche Tour wie viele Fotos hat, und
    wie viele davon noch keine Koordinate haben.

    Das ist die Stelle, die kein anderes Fototool haben kann: die Touren liegen
    schon hier, also weiß der Bestand, wo ein Foto ohne Koordinate entstand.
    """
    fenster = tour_fenster(conn)
    wo, werte = _where(filter or {})
    rows = conn.execute(f"SELECT aufnahme_utc, lat FROM fotos WHERE {wo} "
                        "AND aufnahme_utc IS NOT NULL", werte).fetchall()
    eimer: dict = {}
    ohne = 0
    for r in rows:
        t = tour_zu_zeit(fenster, r["aufnahme_utc"])
        if not t:
            ohne += 1
            continue
        e = eimer.setdefault(t["geo_hash"] or t["path"],
                             {"geo_hash": t["geo_hash"], "path": t["path"],
                              "name": t["name"], "von": t["von"], "bis": t["bis"],
                              "n": 0, "ohne_koordinate": 0})
        e["n"] += 1
        if r["lat"] is None:
            e["ohne_koordinate"] += 1
    liste = sorted(eimer.values(), key=lambda x: x["von"], reverse=True)
    if ohne:
        # Fotos, die in keine Tour fallen, gehen nicht verloren: sie stehen als
        # eigene Zeile am Ende, damit die Summe in der Oberfläche aufgeht.
        liste.append({"geo_hash": "", "path": "", "name": "", "von": 0, "bis": 0,
                      "n": ohne, "ohne_koordinate": 0, "ohne_tour": True})
    return liste


def fotos_einer_tour(conn: sqlite3.Connection, geo_hash: str = "", path: str = "",
                     spielraum: int = SPIELRAUM_S, limit: int = 2000) -> dict:
    """Alle Fotos im Zeitfenster dieser Tour — für die Werkzeuge und die Karte."""
    if geo_hash:
        r = conn.execute("SELECT path, started_at, ended_at FROM tracks WHERE geo_hash = ? "
                         "AND started_at IS NOT NULL LIMIT 1", (geo_hash,)).fetchone()
    else:
        r = conn.execute("SELECT path, started_at, ended_at FROM tracks WHERE path = ?",
                         (path,)).fetchone()
    if not r:
        return {"n": 0, "fotos": []}
    von, bis = _epoche(r["started_at"]), _epoche(r["ended_at"])
    if von is None or bis is None:
        return {"n": 0, "fotos": []}
    rows = conn.execute(
        f"SELECT {_SPALTEN} FROM fotos WHERE fehlt_seit IS NULL AND aufnahme_utc "
        "BETWEEN ? AND ? ORDER BY aufnahme_utc LIMIT ?",
        (von - spielraum, bis + spielraum, int(limit))).fetchall()
    return {"n": len(rows), "von": von, "bis": bis, "fotos": [dict(x) for x in rows]}


def _wach_aktiv() -> bool:
    try:
        from core import wachhalten
        return wachhalten.aktiv()
    except Exception:  # noqa: BLE001
        return False
