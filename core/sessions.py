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
import shutil
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Optional


# ── Schemata ─────────────────────────────────────────────────────────────────

SCHEMA_VERSION = 1
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


# ── Storage I/O ──────────────────────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load_sessions(sessions_file: Path) -> dict:
    """Lädt sessions.json. Failsafe: bei Korruption leere Struktur."""
    if not sessions_file.exists():
        return {"schema": SCHEMA_VERSION, "sessions": {}}
    try:
        data = json.loads(sessions_file.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or "sessions" not in data:
            return {"schema": SCHEMA_VERSION, "sessions": {}}
        # Forward-Migrate falls Schema sich erweitert (v0.8.0: nichts zu tun)
        data.setdefault("schema", SCHEMA_VERSION)
        data.setdefault("sessions", {})
        return data
    except Exception:
        return {"schema": SCHEMA_VERSION, "sessions": {}}


def save_sessions(sessions_file: Path, data: dict) -> None:
    """Atomar schreiben (temp + rename)."""
    sessions_file.parent.mkdir(parents=True, exist_ok=True)
    tmp = sessions_file.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(sessions_file)


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
    return {
        "id": _new_project_id(),
        "name": name,
        "created_at": now,
        "modified_at": now,
        "animator": dict(defaults.get("animator", {})),
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
) -> tuple[dict, dict]:
    """Liefert die Session + das aktive Projekt für einen Track-Hash.
    Legt neu an wenn nicht vorhanden.

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
            sess["gpx_snapshot_path"] = _save_snapshot(gpx_path, track_hash, snapshot_dir)
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
                sess["gpx_snapshot_path"] = _save_snapshot(gpx_path, track_hash, snapshot_dir)

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
    """Kopiert das GPX in den Snapshot-Ordner. Returns: rel. Pfad zu APP_SUPPORT."""
    snapshot_dir.mkdir(parents=True, exist_ok=True)
    target = snapshot_dir / f"{track_hash}.gpx"
    try:
        shutil.copy2(gpx_path, target)
    except Exception:
        # Fehlt z.B. die Quelle (User-Quirk) — Session funktioniert auch
        # ohne Snapshot, GPX-Reload erfordert dann Marc's manuelles Öffnen.
        pass
    return f"sessions/{track_hash}.gpx"


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
