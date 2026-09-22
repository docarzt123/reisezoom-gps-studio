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
import sqlite3
import sys
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
-- 18.09.2026: Änderungszeit je Verzeichnis (schnelle Nachschau, s. durchgang1)
CREATE TABLE IF NOT EXISTS foto_verz (
    path   TEXT PRIMARY KEY,
    mtime  REAL
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
CREATE VIRTUAL TABLE IF NOT EXISTS fotos_fts USING fts5(
    path UNINDEXED, hay,
    tokenize = "trigram remove_diacritics 1"
);
CREATE TRIGGER IF NOT EXISTS fotos_fts_ai AFTER INSERT ON fotos BEGIN
    INSERT INTO fotos_fts(path, hay) VALUES (new.path, lower(COALESCE(new.hay,'')));
END;
CREATE TRIGGER IF NOT EXISTS fotos_fts_ad AFTER DELETE ON fotos BEGIN
    DELETE FROM fotos_fts WHERE path = old.path;
END;
CREATE TRIGGER IF NOT EXISTS fotos_fts_au AFTER UPDATE OF hay ON fotos BEGIN
    DELETE FROM fotos_fts WHERE path = old.path;
    INSERT INTO fotos_fts(path, hay) VALUES (new.path, lower(COALESCE(new.hay,'')));
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
    try:
        conn.executescript(_FTS_SQL)
        _FTS_OK = True
    except sqlite3.Error as e:
        _FTS_OK = False
        log.info("fotos: kein Volltext-Index (%s) — die Suche nimmt den LIKE-Weg", e)
    conn.commit()


def fts_da() -> bool:
    return _FTS_OK


# ── Ordner ──────────────────────────────────────────────────────────────────

def ordner_liste(conn: sqlite3.Connection) -> list:
    """Die beobachteten Fotoordner, je mit Anzahl und Fehlbestand.

    Eigene Liste, nicht die der Tracks (Marc: „eigener ordner, dass man auch
    weiß, dass es hier definitiv um fotos geht").
    """
    raus = []
    for r in conn.execute("SELECT path, added_at, recursive FROM foto_ordner ORDER BY path"):
        p = r["path"]
        n = conn.execute("SELECT COUNT(*) FROM fotos WHERE ordner = ?", (p,)).fetchone()[0]
        fehlt = conn.execute("SELECT COUNT(*) FROM fotos WHERE ordner = ? AND fehlt_seit IS NOT NULL",
                             (p,)).fetchone()[0]
        raus.append({"path": p, "added_at": r["added_at"], "recursive": bool(r["recursive"]),
                     "n": n, "fehlt": fehlt, "da": Path(p).is_dir()})
    return raus


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

def _ueberspringen(d: Path) -> bool:
    name = d.name
    if name in SKIP_DIRS or name.startswith("."):
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


def medien_pruefen(ordner: str, recursive: bool, verz: dict, bekannt: dict, gruendlich: bool,
                   verz_neu: dict) -> Iterable[tuple]:
    """Wie `medien_finden`, aber je Datei mit der Auskunft, ob sie OHNE `stat` übernommen werden darf.

    `verz` = {verzeichnis: mtime vom letzten Mal}, `bekannt` = {verzeichnis: {dateiname, …}} aus dem Bestand
    (ohne als fehlend Markierte). `verz_neu` sammelt die heutigen Verzeichniszeiten."""
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
            continue
        ds = str(d)
        verz_neu[ds] = dmt
        ruhig = (not gruendlich) and (ds in verz) and abs((verz[ds] or 0) - dmt) < 1
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


def art_von(path: str) -> str:
    return ART_VIDEO if cexif.is_video(str(path)) else ART_FOTO


def inhalt_id(path: Path, size: int) -> str:
    """Wiedererkennungs-Kennung: Größe plus Hash über Anfang und Ende.

    Ganze Dateien zu hashen wäre bei RAWs und Videos zu teuer; Anfang und Ende
    genügen, um eine umbenannte oder verschobene Datei wiederzufinden.
    """
    h = hashlib.sha1()
    h.update(str(size).encode())
    try:
        with open(path, "rb") as f:
            h.update(f.read(65536))
            if size > 131072:
                f.seek(-65536, os.SEEK_END)
                h.update(f.read(65536))
    except OSError:
        return ""
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


def _stapel_fuer(path) -> int:
    return STAPEL_FERN if ist_fern(path) else STAPEL


def _tags_stapel(pfade: list) -> tuple:
    """Kernwerte und alle Tags für einen Stapel — beides in einem Zug.
    Wirft ExifToolTimeout, wenn der Daemon hängt."""
    meta = cexif.read_meta_viele(pfade)
    tags_alle = cexif.read_alle_tags_viele(pfade)
    return meta, tags_alle


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
    verz = {r["path"]: r["mtime"] for r in conn.execute("SELECT path, mtime FROM foto_verz").fetchall()}
    bekannt: dict = {}
    if not gruendlich and verz:
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

    for o in ziele:
        for f, ruhig in medien_pruefen(o, rek.get(o, True), verz, bekannt, bool(gruendlich), verz_neu):
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
    if ziele:
        platz = ",".join("?" for _ in ziele)
        for r in conn.execute(f"SELECT path FROM fotos WHERE ordner IN ({platz}) "
                              "AND fehlt_seit IS NULL", tuple(ziele)).fetchall():
            if r["path"] not in alle_pfade:
                geduldig(conn.execute,
                         "UPDATE fotos SET fehlt_seit = ? WHERE path = ?", (_jetzt(), r["path"]))
                weg += 1
    geduldig(conn.commit)
    # Verzeichniszeiten erst JETZT merken (ein abgebrochener Lauf merkt nichts → nächstes Mal wird neu gefragt).
    if verz_neu:
        geduldig(conn.executemany, "INSERT INTO foto_verz(path, mtime) VALUES(?, ?) "
                 "ON CONFLICT(path) DO UPDATE SET mtime = excluded.mtime", list(verz_neu.items()))
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


def _offene(conn: sqlite3.Connection, grenze: Optional[int] = None) -> list:
    sql = ("SELECT path, art FROM fotos WHERE indexed_at IS NULL AND fehlt_seit IS NULL "
           "ORDER BY path")
    if grenze:
        sql += f" LIMIT {int(grenze)}"
    return conn.execute(sql).fetchall()


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


def durchgang2(conn: sqlite3.Connection, fortschritt: Optional[Callable] = None,
               stop: Optional[Callable] = None, grenze: Optional[int] = None,
               mit_thumbs: bool = True, aktuell: Optional[Callable] = None) -> dict:
    """Aufnahmedaten (alle Tags) und Vorschaubilder für alles Ungelesene."""
    selbstheilung_haenger(conn)
    offen = _offene(conn, grenze)
    gesamt = len(offen)
    fertig = fehler = fern = haenger_n = 0
    if fortschritt and gesamt:
        # Die Gesamtzahl sofort melden: der erste Stapel braucht mit Daemon-
        # Start gut zwei Sekunden, und so lange stand in der Kopfzeile nur
        # „Aufnahmedaten lesen 0" statt „0 / 600".
        fortschritt(0, gesamt)

    i = 0
    while i < gesamt:
        if stop and stop():
            conn.commit()
            return {"abbruch": True, "fertig": fertig, "gesamt": gesamt,
                    "fehler": fehler, "fern": fern, "haenger": haenger_n}
        # Auf einem Netzlaufwerk kleinere Stapel und ein Faden fürs Vorschaubild.
        fern_hier = ist_fern(offen[i]["path"])
        stapel = STAPEL_FERN if fern_hier else STAPEL
        teil = offen[i:i + stapel]
        i += stapel
        # Nicht erreichbare Dateien werden ÜBERSPRUNGEN, nicht als fehlerhaft
        # abgestempelt: sonst gilt ein Foto auf dem abgeschalteten NAS für immer
        # als „keine Aufnahmedaten lesbar" und wird nie wieder angefasst.
        # (Marc, 12.09.2026: Fotos liegen auf einem NAS im WLAN.)
        weg = [r for r in teil if not Path(r["path"]).is_file()]
        if weg:
            fern += len(weg)
            teil = [r for r in teil if Path(r["path"]).is_file()]
        if not teil:
            if fortschritt:
                fortschritt(fertig, gesamt)
            continue
        pfade = [r["path"] for r in teil]
        if aktuell and pfade:   # 18.09.2026 — welche Datei gerade dran ist
            try: aktuell(pfade[0], {})
            except Exception: pass
        groessen = {x["path"]: (x["size"] or 0) for x in conn.execute(
            "SELECT path, size FROM fotos WHERE path IN (%s)"
            % ",".join("?" for _ in pfade), pfade).fetchall()}
        meta, tags_alle, haenger = _tags_lesen_geteilt(pfade)
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
        kennungen = {p: inhalt_id(Path(p), int(groessen.get(p) or 0)) for p in pfade}

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
            werte = (kennungen.get(p, ""),
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
        if fortschritt:
            fortschritt(fertig, gesamt)

        if haenger_n >= HAENGER_MAX:
            # Dauerhaft kein exiftool mehr: Lauf beenden, der Rest bleibt
            # ungelesen und kommt beim nächsten Lauf wieder dran.
            fern += gesamt - i if i < gesamt else 0
            log.warning("fotos: exiftool antwortet dauerhaft nicht (%d Einzeldateien) — "
                        "Lauf beendet, %d Dateien beim nächsten Lauf dran", haenger_n, fern)
            break

    if fern:
        log.info("fotos: %d Dateien gerade nicht erreichbar — beim nächsten Lauf dran", fern)
    return {"fertig": fertig, "gesamt": gesamt, "fehler": fehler, "fern": fern,
            "haenger": haenger_n}


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
    offen = conn.execute("SELECT COUNT(*) FROM fotos WHERE indexed_at IS NULL "
                         "AND fehlt_seit IS NULL").fetchone()[0]
    letzte = letzte_nachschau(conn)
    alt = (datetime.now(timezone.utc).timestamp() - letzte) if letzte else None
    faellig = (letzte is None) or (alt is not None and alt > NACHSCHAU_STUNDEN * 3600)
    erreichbar = [o["path"] for o in ordner_liste(conn) if o["da"]]
    return {"ungelesen": int(offen), "nachschau_faellig": bool(faellig and erreichbar),
            "letzte_nachschau": letzte, "ordner_da": len(erreichbar),
            "ordner": len(ordner_liste(conn))}


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

    suche = " ".join(str(f.get("suche") or "").split()).lower()
    if suche:
        if _FTS_OK:
            teile.append("path IN (SELECT path FROM fotos_fts WHERE fotos_fts MATCH ?)")
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
    rows = conn.execute(
        f"SELECT {_SPALTEN} FROM fotos WHERE {wo} ORDER BY {ordnung} LIMIT ? OFFSET ?",
        werte + [int(limit), int(offset)]).fetchall()
    return {"n": n, "fotos": [dict(r) for r in rows]}


def zeile(conn: sqlite3.Connection, path: str) -> Optional[dict]:
    """Eine Datei aus dem Bestand — ohne die gepackten Tags (siehe `tags_lesen`)."""
    r = conn.execute(f"SELECT {_SPALTEN} FROM fotos WHERE path = ?", (path,)).fetchone()
    return dict(r) if r else None


def tage(conn: sqlite3.Connection, filter: Optional[dict] = None, limit: int = 2000) -> list:
    """Anzahl je Tag — die Gliederung der Rasteransicht."""
    wo, werte = _where(filter or {})
    rows = conn.execute(
        f"SELECT tag_lokal AS tag, COUNT(*) AS n, MIN(aufnahme_utc) AS von, "
        f"MAX(aufnahme_utc) AS bis, SUM(lat IS NOT NULL) AS mit_gps "
        f"FROM fotos WHERE {wo} GROUP BY tag_lokal "
        f"ORDER BY tag DESC NULLS LAST LIMIT ?", werte + [int(limit)]).fetchall()
    return [dict(r) for r in rows]


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
    eine = lambda sql, w=(): conn.execute(sql, w).fetchone()[0]  # noqa: E731
    return {
        "gesamt": eine("SELECT COUNT(*) FROM fotos WHERE fehlt_seit IS NULL"),
        "fotos": eine("SELECT COUNT(*) FROM fotos WHERE fehlt_seit IS NULL AND art = ?", (ART_FOTO,)),
        "videos": eine("SELECT COUNT(*) FROM fotos WHERE fehlt_seit IS NULL AND art = ?", (ART_VIDEO,)),
        "ungelesen": eine("SELECT COUNT(*) FROM fotos WHERE fehlt_seit IS NULL AND indexed_at IS NULL"),
        "ohne_koordinate": eine("SELECT COUNT(*) FROM fotos WHERE fehlt_seit IS NULL "
                                "AND indexed_at IS NOT NULL AND (lat IS NULL OR lon IS NULL)"),
        "ohne_zeit": eine("SELECT COUNT(*) FROM fotos WHERE fehlt_seit IS NULL "
                          "AND indexed_at IS NOT NULL AND aufnahme_utc IS NULL"),
        "zeit_geraten": eine("SELECT COUNT(*) FROM fotos WHERE fehlt_seit IS NULL "
                             "AND aufnahme_utc IS NOT NULL AND tz_bekannt = 0"),
        "fehlt": eine("SELECT COUNT(*) FROM fotos WHERE fehlt_seit IS NOT NULL"),
        "ordner": eine("SELECT COUNT(*) FROM foto_ordner"),
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
                          "started_at, ended_at FROM tracks "
                          "WHERE started_at IS NOT NULL AND ended_at IS NOT NULL "
                          "AND COALESCE(hidden, 0) = 0").fetchall():
        von, bis = _epoche(r["started_at"]), _epoche(r["ended_at"])
        if von is None or bis is None:
            continue
        raus.append({"path": r["path"], "geo_hash": r["geo_hash"], "name": r["name"],
                     "von": von, "bis": bis})
    raus.sort(key=lambda x: x["von"], reverse=True)
    return raus


def tour_zu_zeit(fenster: list, utc: Optional[float],
                 spielraum: int = SPIELRAUM_S) -> Optional[dict]:
    """Welche Tour lief zu diesem Zeitpunkt? Bei Überschneidung die kürzere,
    weil ein Spaziergang innerhalb einer Womo-Etappe der genauere Treffer ist."""
    if utc is None:
        return None
    treffer = [t for t in fenster if (t["von"] - spielraum) <= utc <= (t["bis"] + spielraum)]
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
    return {"name": t["name"], "geo_hash": t["geo_hash"], "path": t["path"],
            "von": t["von"], "bis": t["bis"], "geom": geom,
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
