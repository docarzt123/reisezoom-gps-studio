"""
Sessions + Projekte (v0.8.0).

Konzept (Marc-Architektur 2026-05-22):

  Session  = an einem konkreten Track gebunden (Track-Hash über Koordinaten)
             ist intern, User sieht das nicht direkt
  Projekt  = Variation innerhalb einer Session (verschiedene Settings-Sets)
             User wählt + verwaltet diese im Topbar-Dropdown

Storage:
  sessions.json in APP_SUPPORT
  sessions/<hash>.gpx als Snapshot — falls User Original-GPX löscht

Globale settings.json bleibt für:
  - Mapbox-Token, Sprache, Onboarding-State
  - Modul-Defaults (werden bei „Neues Projekt" als Initial-Werte gezogen)

Beim ersten GPX-Load:
  - Track-Hash berechnen
  - Existiert Session? → laden, aktives Projekt zurückgeben
  - Sonst → neu anlegen mit Default-Projekt „Standard", initialisiert mit
    aktuellen Werten aus settings.json
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Optional

_log = logging.getLogger("core.sessions")


# ── Schemata ─────────────────────────────────────────────────────────────────

# 2 (v0.9.529): Sessions hängen am kanonischen `geo_hash` (Hash der VOLLEN
# Koordinaten der Datei, ohne Namen) — derselbe Hash, den das Tour-Archiv als
# `tracks.geo_hash` führt und an dem die Cloud-Umschläge hängen. Vorher war der
# Schlüssel der Hash der (je Modul unterschiedlich!) downsampled UI-Koordinaten:
# Animator fix 800 Punkte, Geotagger 50/km — derselbe Track bekam so bis zu
# drei verschiedene Hashes, und weder Cloud noch Archiv fanden die Projekte
# wieder. Migration: `migrate_to_geo_hash` (parst nur die Session-Snapshots,
# nie die Bibliothek — Nutzer mit 100k+ Dateien bleiben unangetastet).
SCHEMA_VERSION = 2
DEFAULT_PROJECT_NAME = "Standard"


@dataclass
class Project:
    id: str
    name: str
    created_at: str
    modified_at: str
    animator: dict = field(default_factory=dict)
    tourmap: dict = field(default_factory=dict)
    geotagger: dict = field(default_factory=dict)
    # v0.9.92 — Höhen-Animator (4. Modul): Höhenprofil als Video
    heightanim: dict = field(default_factory=dict)
    # v0.9.74 — Foto-Pins. Liste von {path, lon, lat, elevation?, datetime?}.
    # Thumbnails werden NICHT persistiert (zu groß für settings.json — würde
    # bei 50 Fotos schnell 5 MB JSON-Datei). Beim Projekt-Aktivieren werden
    # die Thumbs frisch über `photos_refresh_thumbs(paths)` aus dem Backend
    # nachgezogen. Geteilt zwischen Animator + Tour-Map (Marc-Spec
    # 2026-05-25).
    photos: list = field(default_factory=list)


@dataclass
class Session:
    track_hash: str
    name: str
    created_at: str
    last_active_at: str
    gpx_filenames_seen: list = field(default_factory=list)
    gpx_snapshot_path: str = ""        # relativ zu APP_SUPPORT
    stats: dict = field(default_factory=dict)
    active_project_id: str = ""
    projects: dict = field(default_factory=dict)  # id → Project-dict


# ── Hash ─────────────────────────────────────────────────────────────────────

def compute_track_hash(coords: Iterable, name: str = "") -> str:
    """Stabile Hash über GPS-Koordinaten (+ optional Datei-/Track-Name).

    Koordinaten auf 5 Nachkommastellen gerundet (~1 m Genauigkeit).

    `name` (seit v0.9.380): Datei-Basename des Tracks. Fließt in den Hash ein,
    damit **derselbe Track unter anderem Dateinamen als NEUES Projekt** gilt.
    Hintergrund: Marc benennt eine GPX bewusst um, um frisch zu starten — vorher
    erkannte die App den Track nur an den Koordinaten wieder und lud das alte
    Projekt inkl. gespeicherter Tour-Map-Fotos zurück (verwirrend). Mit Name im
    Hash = Umbenennen ⇒ neue Session. Leerer `name` ⇒ altes Verhalten (nur
    Koordinaten), z.B. bei Tracks ohne Datei-Pfad.

    `coords` ist eine Iterable von (lon, lat) oder [lon, lat] Paaren.
    Returns einen 16-Zeichen-Hex-String.
    """
    h = hashlib.sha1()
    if name:
        h.update(f"name:{name}\x00".encode("utf-8", "replace"))
    for c in coords:
        try:
            lon, lat = float(c[0]), float(c[1])
        except (TypeError, ValueError, IndexError):
            continue
        h.update(f"{round(lon, 5)},{round(lat, 5)};".encode())
    return h.hexdigest()[:16]


def mengen_hash(geo_hashes) -> str:
    """Ein Schlüssel für eine MENGE von Touren (Schwarm/Reise, IDEAS §38).

    Grilling-Entscheid Q14c+Q18a (28.08.2026): Projekte über mehrere Touren
    hängen nicht mehr am Projekt der ersten Tour, sondern an der Menge selbst —
    dieselben Touren wieder wählen heißt: die Arbeit ist wieder da, egal in
    welcher Reihenfolge markiert wurde. Deshalb wird SORTIERT und dedupliziert
    gehasht. Der Rückgabewert trägt das Präfix `menge:` — er landet im selben
    `sessions`-Speicher wie die Einzeltour-Sitzungen, kollidiert aber nie mit
    einem geo_hash (16 Hex ohne Präfix) und wird von Cloud-Sync und Migration
    schlicht übergangen (kein Snapshot, kein Umschlag — Cloud kommt in M5).
    """
    eindeutig = sorted(set(h for h in geo_hashes if h))
    h = hashlib.sha1()
    for g in eindeutig:
        h.update(g.encode("ascii", "replace") + b"\x00")
    return "menge:" + h.hexdigest()[:16]


def find_session_key(sessions_data: dict, ui_hash: str) -> str:
    """Sucht den Session-Schlüssel zu einem UI-Koordinaten-Hash.

    Seit Schema 2 ist der Schlüssel der kanonische `geo_hash` (volle
    Koordinaten). Aufrufe OHNE Dateipfad (z.B. der zweite `session_open_
    for_track`-Aufruf im Animator-Ladefluss) können nur den Hash der
    downsampled UI-Koordinaten liefern — der steht als Alias in
    `ui_hashes`, sobald derselbe Track einmal MIT Pfad geöffnet wurde.
    Returns "" wenn nichts passt.
    """
    if not ui_hash:
        return ""
    sessions = sessions_data.get("sessions") or {}
    if ui_hash in sessions:
        return ui_hash
    for key, sess in sessions.items():
        if ui_hash in (sess.get("ui_hashes") or []):
            return key
    return ""


# ── Storage I/O ──────────────────────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load_sessions(sessions_file: Path) -> dict:
    """Lädt sessions.json. Failsafe: bei Korruption leere Struktur.

    ⚠️ Der Failsafe ist **still**: eine kaputte Datei liefert eine leere
    Struktur, und der nächste Speichervorgang schreibt sie fest. Damit das
    nicht durch einen halb geschriebenen Zwischenstand ausgelöst werden kann,
    schreibt `save_sessions` unter einem eindeutigen Namen — siehe dort. Eine
    Datei, die trotzdem unlesbar ist, wird zur Seite gelegt statt überschrieben.
    """
    if not sessions_file.exists():
        return {"schema": SCHEMA_VERSION, "sessions": {}}
    try:
        data = json.loads(sessions_file.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or "sessions" not in data:
            raise ValueError("unerwartete Struktur")
        # Forward-Migrate falls Schema sich erweitert (v0.8.0: nichts zu tun)
        data.setdefault("schema", SCHEMA_VERSION)
        data.setdefault("sessions", {})
        return data
    except Exception as e:
        # Nicht kommentarlos verwerfen: Hier hängen alle Projekte, Keyframes,
        # Schilder und Foto-Pins des Nutzers dran. Eine Kopie zur Seite legen,
        # damit sich das im Zweifel von Hand retten lässt.
        try:
            kaputt = sessions_file.with_suffix(".kaputt")
            if not kaputt.exists():
                kaputt.write_bytes(sessions_file.read_bytes())
            _log.error("sessions.json unlesbar (%s) — Kopie liegt unter %s", e, kaputt)
        except Exception:
            _log.error("sessions.json unlesbar (%s) und ließ sich nicht sichern", e)
        return {"schema": SCHEMA_VERSION, "sessions": {}}


# Alle Lese-Ändere-Schreibe-Folgen auf sessions.json laufen unter diesem Lock.
# Grund: pywebview startet für JEDEN Bridge-Aufruf einen eigenen Thread
# (`webview/util.py`, `Thread(target=_call)`). Die Oberfläche schickt aus einem
# einzigen Debounce-Tick mehrere `session_update_project_settings`-Aufrufe los —
# einen je Modul. Ohne Lock laden zwei Threads dieselbe Datei, ändern je ihren
# Teil und schreiben nacheinander: die Änderung des ersten ist weg.
LOCK = threading.RLock()


def save_sessions(sessions_file: Path, data: dict) -> None:
    """Atomar schreiben (temp + rename) — auch bei mehreren Schreibern.

    Der Temp-Name enthält Prozess-ID und einen Zufallsteil. Vorher schrieben
    zwei gleichzeitige Aufrufe in **dieselbe** `sessions.tmp`; das Ergebnis war
    verschränkter JSON, den `load_sessions` still als „kaputt" verwarf — und mit
    ihm alle Projekte des Nutzers.
    """
    sessions_file.parent.mkdir(parents=True, exist_ok=True)
    tmp = sessions_file.with_name(
        f"{sessions_file.name}.{os.getpid()}.{uuid.uuid4().hex[:8]}.tmp")
    try:
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2, ensure_ascii=False)
            fh.flush()
            os.fsync(fh.fileno())   # sonst überlebt der Inhalt kein hartes Aus
        os.replace(tmp, sessions_file)
    finally:
        try:
            if tmp.exists():
                tmp.unlink()
        except OSError:
            pass


# ── Session-Lookup + Anlegen ─────────────────────────────────────────────────

def _new_project_id() -> str:
    return "proj_" + uuid.uuid4().hex[:8]


def _project_from_defaults(name: str, defaults: dict) -> dict:
    """Erstellt ein Projekt-Dict mit den passenden Modul-Default-Werten
    aus den globalen settings.json. Marc verliert nichts beim ersten
    Sessions-Anlegen — seine bisherigen Slider-Stände werden „eingefroren"
    in das Default-Projekt der jeweiligen Session.

    `defaults` ist das geladene `settings.json`-Dict (mit `animator`,
    `tourmap`, `geotagger` Sub-Dicts).
    """
    now = _now_iso()
    # v0.9.506 — Die Verteilung über den Track wird HIER festgelegt, nicht in
    # der Oberfläche. Grund: ein frisch angelegtes Projekt bekommt sofort rund
    # 50 Standardwerte mit, also lässt sich später nicht mehr am Inhalt
    # erkennen, ob es neu ist oder von vor v0.9.506 stammt. An dieser Stelle
    # weiß man es sicher — hier entsteht das Projekt gerade.
    #
    # Neue Projekte starten mit „gleichmäßig": das sieht ruhig aus und ist
    # vorhersagbar. „Wie aufgezeichnet" folgt dem Rhythmus des Aufnahmegeräts
    # und ist damit Zufall (in einer gemessenen Datei lagen zwischen zwei
    # Punkten 1121 Meter) — als Vorgabe taugt das nicht, nur als Rückfalloption
    # für bestehende Projekte, die genau so aussehen sollen wie bisher.
    anim = dict(defaults.get("animator", {}))
    anim.setdefault("pace_mode", "even")
    # 01.09.2026 (Marc): NEUE Projekte starten mit dem GPS-Studio-Wasserzeichen —
    # dieselbe Überlegung wie bei `pace_mode` oben: nur HIER lässt sich sicher
    # sagen, dass ein Projekt gerade entsteht. Bestehende Projekte (auch die von
    # zwei Beta-Tester) haben den Schlüssel nicht und bleiben unverändert ohne
    # Wasserzeichen — sie sollen nicht plötzlich ein Logo im Video haben.
    # `@lockup-white` ist ein Sentinel, kein Pfad: er löst sich auf jedem
    # Rechner auf und überlebt den Projekt-Export.
    anim.setdefault("watermark", {"path": "@lockup-white", "x": 84.5, "y": 91.3,
                                  "w": 15, "op": 0.65})
    return {
        "id": _new_project_id(),
        "name": name,
        "created_at": now,
        "modified_at": now,
        "animator": anim,
        "tourmap": dict(defaults.get("tourmap", {})),
        "geotagger": {
            k: v for k, v in (defaults.get("geotagger", {}) or {}).items()
            # Foto-Refs werden NICHT persistiert (Marc-Regel) — geotagger-
            # Settings sind nur die Konfiguration (offset, backup-toggle).
        },
        # v0.9.92 — Höhen-Animator
        "heightanim": dict(defaults.get("heightanim", {})),
        # v0.9.74 — Foto-Pins (Phase 1). Geteilt zwischen Animator + Tour-Map.
        # Nur `path/lon/lat/elevation/datetime` werden in sessions.json
        # gespeichert, Thumb-data-URLs werden bei Projekt-Activate frisch
        # über `photos_refresh_thumbs` nachgezogen.
        "photos": [],
    }


def get_or_create_session(
    sessions_data: dict,
    track_hash: str,
    coords: list,
    gpx_path: Optional[str],
    snapshot_dir: Path,
    global_defaults: dict,
    ui_hash: str = "",
    snapshot_src: Optional[str] = None,
) -> tuple[dict, dict]:
    """Liefert die Session + das aktive Projekt für einen Track-Hash.
    Legt neu an wenn nicht vorhanden.

    `ui_hash` (Schema 2): Hash der downsampled UI-Koordinaten dieses Aufrufs.
    Wird als Alias in `ui_hashes` vermerkt, damit spätere Aufrufe OHNE
    Dateipfad die Session über `find_session_key` wiederfinden.

    Returns: (session_dict, active_project_dict). Beide sind LIVE-References
    in `sessions_data` — Mutationen werden via save_sessions() persistiert.
    """
    sessions = sessions_data.setdefault("sessions", {})
    sess = sessions.get(track_hash)

    if sess is None:
        # Neue Session
        now = _now_iso()
        default_proj = _project_from_defaults(DEFAULT_PROJECT_NAME, global_defaults)
        sess = {
            "track_hash": track_hash,
            "name": _infer_session_name(gpx_path, coords),
            "created_at": now,
            "last_active_at": now,
            "gpx_filenames_seen": [],
            "gpx_snapshot_path": "",
            "stats": _compute_stats(coords),
            "active_project_id": default_proj["id"],
            "projects": {default_proj["id"]: default_proj},
        }
        # GPX-Snapshot anlegen
        if gpx_path:
            # 22.08.2026 (Audit): bei FIT/TCX/KML wird die konvertierte GPX
            # (snapshot_src) gesichert, nicht die Rohdatei unter „.gpx"-Namen.
            sess["gpx_snapshot_path"] = _save_snapshot(snapshot_src or gpx_path, track_hash, snapshot_dir)
            base = Path(gpx_path).name
            if base and base not in sess["gpx_filenames_seen"]:
                sess["gpx_filenames_seen"].append(base)
        sessions[track_hash] = sess
    else:
        # Existing Session — last_active aktualisieren, GPX-Dateinamen tracken
        sess["last_active_at"] = _now_iso()
        if gpx_path:
            base = Path(gpx_path).name
            if base and base not in sess.get("gpx_filenames_seen", []):
                sess.setdefault("gpx_filenames_seen", []).append(base)
            # Snapshot ggf. erneuern wenn fehlt
            if not sess.get("gpx_snapshot_path") or not (snapshot_dir / Path(sess["gpx_snapshot_path"]).name).exists():
                sess["gpx_snapshot_path"] = _save_snapshot(snapshot_src or gpx_path, track_hash, snapshot_dir)

    # Schema 2 — UI-Hash-Alias vermerken (für pfadlose Wiederfind-Aufrufe)
    if ui_hash and ui_hash != track_hash:
        aliase = sess.setdefault("ui_hashes", [])
        if ui_hash not in aliase:
            aliase.append(ui_hash)

    # Active Project — Failsafe wenn die ID nicht mehr existiert
    active_id = sess.get("active_project_id")
    if not active_id or active_id not in sess.get("projects", {}):
        # Wähle das erste vorhandene; wenn keins → neues anlegen
        if sess.get("projects"):
            active_id = next(iter(sess["projects"].keys()))
        else:
            new_proj = _project_from_defaults(DEFAULT_PROJECT_NAME, global_defaults)
            sess.setdefault("projects", {})[new_proj["id"]] = new_proj
            active_id = new_proj["id"]
        sess["active_project_id"] = active_id

    return sess, sess["projects"][active_id]


def _infer_session_name(gpx_path: Optional[str], coords: list) -> str:
    """Default-Name für eine neue Session — vorzugsweise Dateiname (ohne
    Endung), sonst „Track <n> Punkte"."""
    if gpx_path:
        stem = Path(gpx_path).stem
        if stem:
            return stem
    return f"Track ({len(coords)} Punkte)"


def _compute_stats(coords: list) -> dict:
    """Kompakte Stats für die UI-Anzeige im Dropdown. Genauere Stats
    macht core/gpx.py — die landen separat ins Animator-Stats-Panel."""
    n = len(coords)
    if n < 2:
        return {"n_points": n, "distance_m": 0}
    # Haversine-Summe für Distanz (grob; nur für Anzeige)
    import math
    R = 6371000.0
    total = 0.0
    for i in range(1, n):
        try:
            lon1, lat1 = float(coords[i-1][0]), float(coords[i-1][1])
            lon2, lat2 = float(coords[i][0]), float(coords[i][1])
        except (TypeError, ValueError, IndexError):
            continue
        dlon = math.radians(lon2 - lon1)
        dlat = math.radians(lat2 - lat1)
        a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
        total += 2 * R * math.asin(math.sqrt(a))
    return {"n_points": n, "distance_m": round(total)}


def _save_snapshot(gpx_path: str, track_hash: str, snapshot_dir: Path) -> str:
    """Legt die Trackdatei als Version in der Bibliothek ab.

    02.09.2026 (docs/UMBAU-BIBLIOTHEK.md, Schnitt 1): Bis hierher war das eine
    schlichte Kopie nach `sessions/<hash>.gpx` im App-Ordner — ein Nebenkanal
    neben dem Archiv. Jetzt IST diese Kopie die Wahrheit: `snapshot_dir` zeigt
    auf den Versionsspeicher der Bibliothek, geschrieben wird komprimiert.
    Der Rückgabewert bleibt ein relativer Pfad, damit Alt-Einträge in
    `touren.json` weiter lesbar sind.
    """
    from . import bibliothek as _bib
    ort = Path(snapshot_dir).parent          # <Bibliothek>/touren → <Bibliothek>
    try:
        _bib.version_ablegen(ort, Path(gpx_path), track_hash)
    except Exception:
        # Fehlt z.B. die Quelle (User-Quirk) — die Tour funktioniert auch ohne
        # Kopie, sie hängt dann eben weiter an ihrer Datei draußen.
        pass
    return f"touren/{track_hash[:2]}/{track_hash}.gpx.gz"


# ── Migration Schema 1 → 2: kanonischer geo_hash ────────────────────────────

def migrate_to_geo_hash(data: dict, app_support: Path) -> bool:
    """Schlüsselt Sessions vom UI-Koordinaten-Hash auf den kanonischen
    `geo_hash` (volle Datei-Koordinaten, ohne Namen) um.

    Parst dafür NUR die Session-Snapshots (`sessions/<hash>.gpx` — Kopien der
    Originaldateien, wenige Dutzend), niemals die Bibliothek. Sessions ohne
    lesbaren Snapshot behalten ihren alten Schlüssel (dann hängt an ihnen
    weiterhin kein Cloud-Umschlag — nicht schlechter als vorher). Der alte
    Schlüssel wandert in `ui_hashes`, damit pfadlose Aufrufe die Session
    weiter finden. Treffen zwei Alt-Sessions auf denselben geo_hash (derselbe
    Track, über Animator UND Geotagger geöffnet), werden sie zusammengelegt:
    Projekte vereinigt, die zuletzt aktive gewinnt bei Name/aktivem Projekt.

    Returns True wenn sich etwas geändert hat (Caller speichert + legt vorher
    eine .bak-Kopie an).
    """
    if int(data.get("schema") or 1) >= 2:
        return False
    sessions = data.get("sessions") or {}
    geaendert = True          # Schema-Stempel ändert sich immer
    data["schema"] = SCHEMA_VERSION

    def _geo_von_snapshot(sess: dict) -> str:
        rel = sess.get("gpx_snapshot_path") or ""
        if not rel:
            return ""
        snap = app_support / rel
        if not snap.is_file():
            return ""
        try:
            from . import gpx as cgpx          # lazy — Migration läuft einmal
            pts, _stats = cgpx.parse_gpx(str(snap))
            if len(pts) < 2:
                return ""
            return compute_track_hash([(p.lon, p.lat) for p in pts])
        except Exception as e:
            _log.warning("Session-Migration: Snapshot %s nicht lesbar (%s) — "
                         "Session behält alten Schlüssel", rel, e)
            return ""

    def _merge(ziel: dict, quelle: dict) -> None:
        """`quelle` in `ziel` auflösen. Projekte vereinigen (IDs sind uuid-
        eindeutig); bei allem Einwertigen gewinnt die zuletzt aktive Session."""
        ziel_proj = ziel.setdefault("projects", {})
        for pid, p in (quelle.get("projects") or {}).items():
            if pid not in ziel_proj:
                ziel_proj[pid] = p
        for feld in ("gpx_filenames_seen", "ui_hashes"):
            liste = ziel.setdefault(feld, [])
            for x in (quelle.get(feld) or []):
                if x not in liste:
                    liste.append(x)
        if (quelle.get("last_active_at") or "") > (ziel.get("last_active_at") or ""):
            ziel["last_active_at"] = quelle["last_active_at"]
            ziel["name"] = quelle.get("name") or ziel.get("name")
            if quelle.get("active_project_id") in ziel_proj:
                ziel["active_project_id"] = quelle["active_project_id"]
        if (quelle.get("created_at") or "") < (ziel.get("created_at") or "~"):
            ziel["created_at"] = quelle.get("created_at")

    neu: dict = {}
    for alt_key, sess in sessions.items():
        geo = _geo_von_snapshot(sess)
        key = geo or alt_key
        if geo and geo != alt_key:
            aliase = sess.setdefault("ui_hashes", [])
            if alt_key not in aliase:
                aliase.append(alt_key)
            sess["track_hash"] = geo
            # Snapshot auf den neuen Schlüsselnamen umziehen
            alt_snap = app_support / (sess.get("gpx_snapshot_path") or "")
            neu_snap = alt_snap.parent / f"{geo}.gpx"
            try:
                if alt_snap.is_file() and not neu_snap.exists():
                    alt_snap.rename(neu_snap)
                if neu_snap.is_file():
                    sess["gpx_snapshot_path"] = f"sessions/{geo}.gpx"
            except OSError as e:
                _log.warning("Session-Migration: Snapshot-Umzug %s → %s "
                             "fehlgeschlagen (%s)", alt_snap.name, neu_snap.name, e)
        if key in neu:
            _log.info("Session-Migration: '%s' und '%s' sind derselbe Track "
                      "(geo %s) — Projekte werden zusammengelegt",
                      neu[key].get("name"), sess.get("name"), key)
            _merge(neu[key], sess)
        else:
            neu[key] = sess
    data["sessions"] = neu
    _log.info("Session-Migration auf Schema 2: %d Sessions, %d Schlüssel",
              len(sessions), len(neu))
    return geaendert


# ── Projekt-Aktionen ─────────────────────────────────────────────────────────

def list_projects(session: dict) -> list:
    """Liste der Projekte einer Session als Mini-Dicts für UI."""
    out = []
    for pid, p in (session.get("projects") or {}).items():
        out.append({
            "id": pid,
            "name": p.get("name", "?"),
            "created_at": p.get("created_at"),
            "modified_at": p.get("modified_at"),
            "is_active": pid == session.get("active_project_id"),
        })
    out.sort(key=lambda x: x.get("created_at") or "")
    return out


def create_project(session: dict, name: str, global_defaults: dict, copy_from_id: Optional[str] = None) -> dict:
    """Legt ein neues Projekt in der Session an.

    `copy_from_id=None` → frische Default-Werte aus `global_defaults`.
    `copy_from_id` gesetzt → tiefe Kopie der Settings dieses Projekts.

    Returns: das neu erstellte Projekt-Dict.
    """
    now = _now_iso()
    new_id = _new_project_id()
    if copy_from_id and copy_from_id in (session.get("projects") or {}):
        src = session["projects"][copy_from_id]
        # Tiefe Kopie ALLER Modul-Sektionen (generisch, damit neue Module wie
        # `webkarte`/`heightanim` automatisch mitkopiert werden — nicht mehr
        # eine feste Whitelist, die neue Module vergisst). Nur die projekt-
        # eigenen Meta-Felder werden frisch gesetzt.
        proj = json.loads(json.dumps(src))
        proj["id"] = new_id
        proj["name"] = name
        proj["created_at"] = now
        proj["modified_at"] = now
    else:
        proj = _project_from_defaults(name, global_defaults)
        proj["id"] = new_id  # _project_from_defaults generiert eigene ID
    session.setdefault("projects", {})[new_id] = proj
    session["active_project_id"] = new_id
    session["last_active_at"] = now
    return proj


def rename_project(session: dict, project_id: str, new_name: str) -> bool:
    p = (session.get("projects") or {}).get(project_id)
    if not p:
        return False
    p["name"] = new_name
    p["modified_at"] = _now_iso()
    return True


def delete_project(session: dict, project_id: str, global_defaults: dict) -> dict:
    """Löscht ein Projekt. Safeguard: mindestens 1 Projekt pro Session.
    Wenn das letzte gelöscht wird, wird ein frisches „Standard" angelegt.

    Returns: das neue aktive Projekt-Dict.
    """
    projects = session.get("projects") or {}
    if project_id not in projects:
        # nichts zu tun, aktives Projekt zurück
        active = session.get("active_project_id")
        return projects.get(active, {})
    del projects[project_id]
    session["last_active_at"] = _now_iso()
    if not projects:
        # Frisches Standard
        new_proj = _project_from_defaults(DEFAULT_PROJECT_NAME, global_defaults)
        projects[new_proj["id"]] = new_proj
        session["active_project_id"] = new_proj["id"]
        return new_proj
    # Wenn das aktive gelöscht wurde, auf das erste verbleibende wechseln
    if session.get("active_project_id") == project_id:
        new_active = next(iter(projects.keys()))
        session["active_project_id"] = new_active
    return projects[session["active_project_id"]]


def set_active_project(session: dict, project_id: str) -> bool:
    if project_id in (session.get("projects") or {}):
        session["active_project_id"] = project_id
        session["last_active_at"] = _now_iso()
        return True
    return False


def update_project_settings(session: dict, project_id: str, module: str, patch: dict) -> bool:
    """Merget `patch` in `session.projects[project_id][module]`. Tief
    bei dict-Werten (analog `_load_settings`-Merge-Logik aus app.py).

    v0.9.74: Mit `module = None` oder `""` patcht direkt auf Projekt-Root
    (z.B. für `photos`-Liste, die nicht zu einem einzelnen Modul gehört).
    """
    p = (session.get("projects") or {}).get(project_id)
    if not p:
        return False
    if not module:
        # Root-Level-Patch (v0.9.74): direkt auf das Projekt-Dict schreiben.
        # Reserved Keys wie id/name/created_at NICHT zulassen (Defensiv).
        RESERVED = {"id", "created_at"}
        for k, v in (patch or {}).items():
            if k in RESERVED:
                continue
            p[k] = v
        p["modified_at"] = _now_iso()
        return True
    if module not in p or not isinstance(p[module], dict):
        p[module] = {}
    for k, v in patch.items():
        if isinstance(v, dict) and isinstance(p[module].get(k), dict):
            p[module][k].update(v)
        else:
            p[module][k] = v
    p["modified_at"] = _now_iso()
    return True


# ── Smoke-Test ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import tempfile

    tmp = Path(tempfile.mkdtemp())
    sess_file = tmp / "sessions.json"
    snap_dir = tmp / "sessions"

    coords = [(10.0, 50.0), (10.001, 50.001), (10.002, 50.0015)]
    h = compute_track_hash(coords)
    print(f"hash: {h}")

    data = load_sessions(sess_file)
    print(f"empty load: {data}")

    defaults = {
        "animator": {"pitch": 40, "rotation": 20, "line_color": "#ff6b35"},
        "tourmap": {"line_color": "#ff6b35"},
        "geotagger": {"offset_seconds": 0},
    }

    sess, proj = get_or_create_session(data, h, coords, "/tmp/test.gpx", snap_dir, defaults)
    print(f"first get_or_create: session-name={sess['name']!r}, project-name={proj['name']!r}")

    # Patchen
    update_project_settings(sess, proj["id"], "animator", {"pitch": 60})
    print(f"after patch pitch=60: {sess['projects'][proj['id']]['animator']['pitch']}")

    # Duplizieren
    dup = create_project(sess, "Variation", defaults, copy_from_id=proj["id"])
    print(f"after duplicate: 2 projects? {len(sess['projects'])}, dup pitch={dup['animator']['pitch']}")

    # Umbenennen
    rename_project(sess, dup["id"], "Cinematic")
    print(f"after rename: {sess['projects'][dup['id']]['name']}")

    # Löschen
    new_active = delete_project(sess, dup["id"], defaults)
    print(f"after delete dup: active is {new_active['name']!r}, total projects={len(sess['projects'])}")

    # Letztes Projekt löschen → erzeugt neues Standard
    last_id = sess["active_project_id"]
    new_active = delete_project(sess, last_id, defaults)
    print(f"after delete last: active is {new_active['name']!r} (sollte 'Standard' sein)")

    save_sessions(sess_file, data)
    reloaded = load_sessions(sess_file)
    print(f"roundtrip: hash in reload? {h in reloaded['sessions']}")
    print("✓ smoke ok")
