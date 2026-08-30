# -*- coding: utf-8 -*-
"""Projekt-Store — E1 des Umbaus „Projekte, Tour-Identität & Historie".

BESCHLOSSEN im Grilling (Marc, 29.08.2026, docs/IDEAS.md §39). Marcs Kernsatz:
„wir müssen weg davon, alles am track festzumachen."

Das Modell
----------
- **Projekt** = eigenständige Arbeitsmappe (eigene ID, Name, Status,
  modified_at). Es referenziert seine Touren und trägt die gesamte Arbeit
  (Modul-Stände: animator/tourmap/geotagger/heightanim/photos …). Der Ablauf
  (solo / reise / schwarm samt Modus) ist eine PROJEKT-Eigenschaft — der
  frühere „Mengen-Sitzungs"-Apparat entfällt.
- **Tour** = das Aufgezeichnete. Ihre FAKTEN (Name, Stats, Snapshot, gesehene
  Dateinamen, UI-Hash-Aliase) leben tour-seitig in `touren.json` und werden
  von allen Projekten geteilt. Das ist die Vorstufe des Tour-Registers (E2:
  stabile UUIDs, Dupletten-Zusammenlegung, rz:id-Einbettung).

Der Kontext-Schlüssel (E1-Übergang, WICHTIG für E2)
---------------------------------------------------
Jedes Projekt trägt `kontext`: bei Einzeltouren der geo_hash der Tour, bei
Kompositionen `menge:<hash>` über die geo_hashes aller Touren. Der Kontext ist
NUR ein abgeleiteter Gruppierungs-Schlüssel — er beantwortet „welche Projekte
gehören zu dem, was gerade offen ist?" und ersetzt 1:1 die frühere Session.
In E2 wird er durch Tour-UUIDs ersetzt; bis dahin bleibt damit JEDER
JS-Antwort-Vertrag der session_*-Brücken unverändert (track_hash == kontext).

Dateien (APP_SUPPORT)
---------------------
- `projekte.json`  {"schema": 1, "projects": {pid: PROJEKT}, "aktiv": {kontext: pid}}
- `touren.json`    {"schema": 1, "touren": {geo_hash: TOUR_FAKTEN}}
- Die alte `sessions.json` wird bei der einmaligen Migration nach
  `sessions.json.aufgeloest-<stamp>` umbenannt (nichts wird gelöscht).

PROJEKT-Felder
--------------
id, name, status ("aktiv"|"fertig"|"idee"), auto (bool: automatisch angelegt
und nie angefasst — jede echte Änderung setzt es auf False), created_at,
modified_at, kontext, ablauf ("solo"|"reise"|"schwarm"), schwarm_modus,
schwarm_pausen, geo_hashes (Liste; solo: genau einer), gpx_paths (geordnete
Pfade der Komposition; solo meist leer — der Pfad kommt beim Öffnen),
plus die Modul-Stände (unverändert übernommen; `animator.extra_tours` bleibt
in E1 bewusst dort — Normalisierung in die Tour-Referenzen ist E2/E3).

Nebenläufigkeit: EIN RLock für beide Dateien; Speichern schreibt atomar
(tmp + os.replace), wie zuvor bei sessions.json.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
import uuid
from pathlib import Path
from typing import Optional

from . import sessions as _s   # bewährte Primitiven wiederverwenden

log = logging.getLogger("core.projekte")

LOCK = threading.RLock()

SCHEMA = 1
STATUS_WERTE = ("aktiv", "fertig", "idee")


def _now_iso() -> str:
    return _s._now_iso()


# ── Laden / Speichern ────────────────────────────────────────────────────────

def _lese_json(pfad: Path) -> dict:
    try:
        with open(pfad, "r", encoding="utf-8") as f:
            return json.load(f) or {}
    except FileNotFoundError:
        return {}
    except Exception as e:
        # Kaputte Datei: NIE still überschreiben — beiseitelegen und frisch
        # starten (gleiche Philosophie wie load_sessions).
        log.error("projekte: %s unlesbar (%s) — lege sie beiseite", pfad, e)
        try:
            os.replace(pfad, str(pfad) + f".kaputt-{time.strftime('%Y%m%d-%H%M%S')}")
        except Exception:
            pass
        return {}


def _schreibe_json(pfad: Path, daten: dict) -> None:
    """Atomar schreiben — wortgleich zu `sessions.save_sessions`.

    Zwei Härtungen, die dieser Store beim E1-Umbau nicht mitbekommen hatte und
    die beide aus echten Vorfällen stammen (siehe `core/sessions.py`):
    (1) **prozess-eindeutiger Temp-Name** — bei festem `.tmp` schrieben zwei
    gleichzeitige Schreiber (zweite App-Instanz) in dieselbe Datei, das Ergebnis
    war verschränkter JSON, den `_lese_json` still als „kaputt" beiseitelegt —
    und mit ihm ALLE Projekte. (2) **flush + fsync** — sonst überlebt der Inhalt
    kein hartes Aus, und am Ziel landet nach `os.replace` ein 0-Byte-Torso.
    """
    pfad.parent.mkdir(parents=True, exist_ok=True)
    tmp = pfad.with_name(f"{pfad.name}.{os.getpid()}.{uuid.uuid4().hex[:8]}.tmp")
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(daten, f, ensure_ascii=False, indent=1)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, pfad)
    finally:
        try:
            if tmp.exists():
                tmp.unlink()
        except OSError:
            pass


def laden(app_support: Path) -> dict:
    """Kombinierte In-Memory-Sicht: {"projects", "aktiv", "touren"}."""
    p = _lese_json(app_support / "projekte.json")
    t = _lese_json(app_support / "touren.json")
    return {
        "projects": p.get("projects") or {},
        "aktiv": p.get("aktiv") or {},
        "touren": t.get("touren") or {},
    }


def speichern(app_support: Path, daten: dict) -> None:
    _schreibe_json(app_support / "projekte.json",
                   {"schema": SCHEMA, "projects": daten.get("projects") or {},
                    "aktiv": daten.get("aktiv") or {}})
    _schreibe_json(app_support / "touren.json",
                   {"schema": SCHEMA, "touren": daten.get("touren") or {}})


# ── Migration (einmalig) ─────────────────────────────────────────────────────

_META_FELDER = ("id", "name", "created_at", "modified_at")


def _payload_von(projekt_alt: dict) -> dict:
    """Modul-Stände eines Alt-Projekts (alles außer den Meta-Feldern)."""
    return {k: v for k, v in (projekt_alt or {}).items() if k not in _META_FELDER}


def _hat_arbeit(payload: dict, name: str) -> bool:
    """„Wurde hier echt gearbeitet?"-Heuristik fürs auto-Flag (Q10c) bei der
    MIGRATION. Ein Defaults-Vergleich taugt nicht — die globalen Defaults sind
    seit dem Anlegen alter Projekte gedriftet (real gemessen: 0 Treffer bei
    113 Projekten). Stattdessen zählen ARBEITS-MARKER, an Marcs echtem Bestand
    geeicht (73 ohne Marker, 40 mit): umbenannt, Keyframes (timeline_events),
    Etappen, Ghost-Spuren, Diagramme, Mehrfarben-Stops, Fokus-Tour, Fotos.
    Verstellte Slider allein zählen NICHT — auto blendet ja nur die Sortierung
    im Projekte-Bereich, gelöscht wird nichts."""
    if name != _s.DEFAULT_PROJECT_NAME:
        return True
    a = payload.get("animator") or {}
    if any(a.get(k) for k in ("timeline_events", "extra_tours", "ghosts",
                              "charts", "track_color_stops", "tours_fokus")):
        return True
    if payload.get("photos"):
        return True
    return False


def migrieren_falls_noetig(app_support: Path, sessions_file: Path,
                           defaults: dict) -> Optional[dict]:
    """Einmalige Überführung sessions.json → projekte.json + touren.json.

    Läuft nur, wenn projekte.json noch nicht existiert. Die alte Datei wird
    danach zu `sessions.json.aufgeloest-<stamp>` umbenannt (Sicherung, kein
    Löschen). Gibt eine Zusammenfassung zurück (fürs Log/HANDOVER) oder None,
    wenn nichts zu tun war.
    """
    with LOCK:
        if (app_support / "projekte.json").exists():
            return None
        if not sessions_file.exists():
            # Frische Installation: leere Stores anlegen.
            speichern(app_support, {"projects": {}, "aktiv": {}, "touren": {}})
            return {"neu": True, "projekte": 0, "touren": 0, "kompositionen": 0}

        alt = _s.load_sessions(sessions_file)
        sessions = (alt.get("sessions") or {})
        daten = {"projects": {}, "aktiv": {}, "touren": {}}
        n_proj = n_komp = 0

        for key, sess in sessions.items():
            if not isinstance(sess, dict):
                continue
            ist_menge = isinstance(key, str) and key.startswith("menge:")
            if not ist_menge:
                # Tour-Fakten aus der Session heben (Vorstufe des Registers).
                daten["touren"][key] = {
                    "name": sess.get("name") or "",
                    "stats": sess.get("stats") or {},
                    "created_at": sess.get("created_at") or "",
                    "last_active_at": sess.get("last_active_at") or "",
                    "gpx_filenames_seen": list(sess.get("gpx_filenames_seen") or []),
                    "gpx_snapshot_path": sess.get("gpx_snapshot_path") or "",
                    "ui_hashes": list(sess.get("ui_hashes") or []),
                    "gpx_paths": [],
                }
            for pid, p in (sess.get("projects") or {}).items():
                if not isinstance(p, dict):
                    continue
                payload = _payload_von(p)
                # Projekt-IDs waren früher nur JE SESSION eindeutig — global
                # kann es Kollisionen geben (real: 1 Fall). Dann neue ID.
                neu_id = pid
                if pid in daten["projects"]:
                    neu_id = uuid.uuid4().hex[:12]
                    log.warning("Migration: Projekt-ID %s doppelt (Kontext %s) "
                                "— neue ID %s", pid, key, neu_id)
                neu = {
                    "id": neu_id,
                    "name": p.get("name") or _s.DEFAULT_PROJECT_NAME,
                    "status": "aktiv",
                    "auto": (not ist_menge
                             and not _hat_arbeit(payload, p.get("name") or "")),
                    "created_at": p.get("created_at") or sess.get("created_at") or _now_iso(),
                    "modified_at": p.get("modified_at") or sess.get("last_active_at") or _now_iso(),
                    "kontext": key,
                    "ablauf": (sess.get("ablauf") or "reise") if ist_menge else "solo",
                    "schwarm_modus": sess.get("schwarm_modus") or "gleich",
                    "schwarm_pausen": bool(sess.get("schwarm_pausen", True)),
                    "geo_hashes": (sorted(set(sess.get("geo_hashes") or []))
                                   if ist_menge else [key]),
                    "gpx_paths": list(sess.get("gpx_paths") or []) if ist_menge else [],
                }
                neu.update(payload)
                daten["projects"][neu_id] = neu
                n_proj += 1
                if ist_menge:
                    n_komp += 1
                if sess.get("active_project_id") == pid:
                    daten["aktiv"][key] = neu_id
            if key not in daten["aktiv"] and (sess.get("projects") or {}):
                daten["aktiv"][key] = next(iter(
                    [p2["id"] for p2 in daten["projects"].values()
                     if p2.get("kontext") == key] or [""]))

        speichern(app_support, daten)
        ziel = str(sessions_file) + f".aufgeloest-{time.strftime('%Y%m%d-%H%M%S')}"
        os.replace(sessions_file, ziel)
        info = {"neu": False, "projekte": n_proj, "touren": len(daten["touren"]),
                "kompositionen": n_komp, "alt_datei": ziel}
        log.info("Migration Sessions→Projekte: %d Projekte (%d Kompositionen), "
                 "%d Touren-Fakten · alte Datei: %s",
                 n_proj, n_komp, len(daten["touren"]), ziel)
        return info


# ── Kontext (ersetzt die Session) ───────────────────────────────────────────

def projekte_im(daten: dict, kontext: str) -> list:
    """Projekte eines Kontexts, Form wie sessions.list_projects (JS-Vertrag)."""
    aktiv = (daten.get("aktiv") or {}).get(kontext)
    out = []
    for pid, p in (daten.get("projects") or {}).items():
        if p.get("kontext") != kontext:
            continue
        out.append({"id": pid, "name": p.get("name", "?"),
                    "created_at": p.get("created_at"),
                    "modified_at": p.get("modified_at"),
                    "is_active": pid == aktiv})
    out.sort(key=lambda x: x.get("created_at") or "")
    return out


def _aktives_projekt(daten: dict, kontext: str) -> Optional[dict]:
    pid = (daten.get("aktiv") or {}).get(kontext)
    p = (daten.get("projects") or {}).get(pid) if pid else None
    if p is not None and p.get("kontext") == kontext:
        return p
    # Failsafe: erstes Projekt des Kontexts.
    for kid, kp in (daten.get("projects") or {}).items():
        if kp.get("kontext") == kontext:
            daten.setdefault("aktiv", {})[kontext] = kid
            return kp
    return None


def _neues_projekt(kontext: str, name: str, defaults: dict, *, auto: bool,
                   ablauf: str = "solo", geo_hashes=None, gpx_paths=None,
                   modus: str = "gleich", pausen: bool = True,
                   payload: Optional[dict] = None) -> dict:
    basis = _s._project_from_defaults(name, defaults)
    p = {
        "id": basis["id"], "name": name, "status": "aktiv", "auto": auto,
        "created_at": basis["created_at"], "modified_at": basis["modified_at"],
        "kontext": kontext, "ablauf": ablauf,
        "schwarm_modus": modus, "schwarm_pausen": bool(pausen),
        "geo_hashes": list(geo_hashes or ([kontext] if ablauf == "solo" else [])),
        "gpx_paths": list(gpx_paths or []),
    }
    p.update(payload if payload is not None else _payload_von(basis))
    return p


def session_sicht(daten: dict, kontext: str) -> dict:
    """Session-förmige Antwort für die unveränderten JS-Verträge."""
    aktiv = _aktives_projekt(daten, kontext) or {}
    if kontext.startswith("menge:"):
        name = aktiv.get("name") or ""
        stats = {"n_tours": len(aktiv.get("geo_hashes") or [])}
    elif kontext.startswith("frei:"):
        # v0.9.612 (Marc: „bau direkt ein leeres projekt"): Projekt ohne Tour —
        # der Name der Sitzung ist der Projektname, Stats gibt es keine.
        name = aktiv.get("name") or ""
        stats = {}
    else:
        tour = (daten.get("touren") or {}).get(kontext) or {}
        name = tour.get("name") or ""
        stats = tour.get("stats") or {}
    return {"track_hash": kontext, "name": name, "stats": stats,
            "ablauf": aktiv.get("ablauf") if aktiv.get("ablauf") != "solo" else "reise",
            "schwarm_modus": aktiv.get("schwarm_modus", "gleich"),
            "schwarm_pausen": bool(aktiv.get("schwarm_pausen", True))}


def kontext_oeffnen_einzel(daten: dict, geo_hash: str, coords: list,
                           gpx_path: Optional[str], snapshot_dir: Path,
                           defaults: dict, ui_hash: str = "",
                           snapshot_src: Optional[str] = None,
                           rz_id: str = "") -> dict:
    """Spiegel von get_or_create_session für Einzeltouren: pflegt die
    Tour-Fakten, sorgt für ≥1 Projekt im Kontext und liefert das aktive.

    E2/E3: `rz_id` = in der Datei eingebettete Tour-Kennung (falls vorhanden).
    Ist die Geometrie neu, aber die Tour bekannt (per rz:id ODER weil dieselbe
    Datei früher eine andere Geometrie hatte), wird der neue Eintrag als
    FASSUNG an die bestehende Kette gehängt („extern geändert", Q4b) statt
    eine fremde Tour aufzumachen."""
    touren = daten.setdefault("touren", {})
    tour = touren.get(geo_hash)
    now = _now_iso()
    if tour is None:
        tour = {"name": _s._infer_session_name(gpx_path, coords),
                "stats": _s._compute_stats(coords),
                "created_at": now, "last_active_at": now,
                "gpx_filenames_seen": [], "gpx_snapshot_path": "",
                "ui_hashes": [], "gpx_paths": []}
        if gpx_path:
            tour["gpx_snapshot_path"] = _s._save_snapshot(
                snapshot_src or gpx_path, geo_hash, snapshot_dir)
        # E3 (Q4b): bekannte Tour, neue Geometrie? Erst über rz:id, dann über
        # den Datei-Pfad suchen — Treffer heißt: Fassung, keine neue Tour.
        vorgaenger = None
        if rz_id:
            g = kette(daten, rz_id)
            if g:
                vorgaenger = g[-1]
        if vorgaenger is None and gpx_path:
            for gh2, t2 in touren.items():
                if gh2 != geo_hash and isinstance(t2, dict)                         and gpx_path in (t2.get("gpx_paths") or []):
                    vorgaenger = (gh2, t2)
                    break
        if vorgaenger is not None:
            alt_gh, alt_t = vorgaenger
            if not alt_t.get("id"):
                register_migrieren(daten)
            nmax = max(((t.get("fassung") or {}).get("nr", 1)
                        for _, t in kette(daten, alt_t["id"])), default=1)
            tour["id"] = alt_t["id"]
            tour["fassung"] = {"nr": nmax + 1, "erstellt": now,
                               "quelle": "extern"}
            if not tour.get("name"):
                tour["name"] = alt_t.get("name") or ""
            log.info("Tour %s: extern geänderte Datei erkannt — Fassung %d "
                     "(%s → %s)", alt_t["id"], nmax + 1,
                     alt_gh[:12], geo_hash[:12])
        else:
            tour["id"] = "tour_" + uuid.uuid4().hex[:12]
            tour["fassung"] = {"nr": 1, "erstellt": now, "quelle": "import"}
        touren[geo_hash] = tour
    else:
        tour["last_active_at"] = now
        if gpx_path and (not tour.get("gpx_snapshot_path")
                         or not (snapshot_dir / Path(tour["gpx_snapshot_path"]).name).exists()):
            tour["gpx_snapshot_path"] = _s._save_snapshot(
                snapshot_src or gpx_path, geo_hash, snapshot_dir)
    if gpx_path:
        base = Path(gpx_path).name
        if base and base not in tour.setdefault("gpx_filenames_seen", []):
            tour["gpx_filenames_seen"].append(base)
        if gpx_path not in tour.setdefault("gpx_paths", []):
            tour["gpx_paths"].append(gpx_path)
    if ui_hash and ui_hash != geo_hash:
        if ui_hash not in tour.setdefault("ui_hashes", []):
            tour["ui_hashes"].append(ui_hash)

    aktiv = _aktives_projekt(daten, geo_hash)
    if aktiv is None:
        # Q10c: jeder Track bekommt automatisch ein (leeres) Start-Projekt.
        aktiv = _neues_projekt(geo_hash, _s.DEFAULT_PROJECT_NAME, defaults, auto=True)
        daten.setdefault("projects", {})[aktiv["id"]] = aktiv
        daten.setdefault("aktiv", {})[geo_hash] = aktiv["id"]
    return aktiv


def find_kontext_by_ui_hash(daten: dict, ui_hash: str) -> str:
    if not ui_hash:
        return ""
    touren = daten.get("touren") or {}
    if ui_hash in touren:
        return ui_hash
    for gh, t in touren.items():
        if ui_hash in (t.get("ui_hashes") or []):
            return gh
    return ""


# ── Projekt-CRUD (Verträge wie die sessions-Pendants) ───────────────────────

def _angefasst(p: dict) -> None:
    p["modified_at"] = _now_iso()
    p["auto"] = False


def update_settings(daten: dict, kontext: str, project_id: str,
                    module: Optional[str], patch: dict) -> bool:
    p = (daten.get("projects") or {}).get(project_id)
    if not p or p.get("kontext") != kontext:
        return False
    ziel = p if not module else p.setdefault(module, {})
    for k, v in (patch or {}).items():
        if isinstance(v, dict) and isinstance(ziel.get(k), dict):
            ziel[k] = {**ziel[k], **v}
        else:
            ziel[k] = v
    if module:
        # Q22: „Öffnen" im Projekte-Bereich springt ins zuletzt benutzte Modul.
        p["letztes_modul"] = module
    _angefasst(p)
    return True


def create(daten: dict, kontext: str, name: str, defaults: dict,
           copy_from_id: Optional[str] = None) -> dict:
    vorlage = (daten.get("projects") or {}).get(copy_from_id) if copy_from_id else None
    if vorlage:
        neu = json.loads(json.dumps(vorlage))
        neu["id"] = uuid.uuid4().hex[:12]
        neu["name"] = name
        neu["created_at"] = neu["modified_at"] = _now_iso()
        neu["auto"] = False
        neu["status"] = "aktiv"
    else:
        muster = _aktives_projekt(daten, kontext)
        neu = _neues_projekt(kontext, name, defaults, auto=False,
                             ablauf=(muster or {}).get("ablauf", "solo"),
                             geo_hashes=(muster or {}).get("geo_hashes"),
                             gpx_paths=(muster or {}).get("gpx_paths"),
                             modus=(muster or {}).get("schwarm_modus", "gleich"),
                             pausen=(muster or {}).get("schwarm_pausen", True))
        # 29.08.2026 (Marc: „bumms war der schwarm weg"): Der Animator zeichnet
        # die Etappen aus animator.extra_tours — ein NEUES Projekt im selben
        # Mengen-Kontext muss die Komposition erben, sonst steht nur der
        # Haupt-Track da. Keyframes & Co. bleiben bewusst frisch.
        extra = ((muster or {}).get("animator") or {}).get("extra_tours")
        if extra and str(kontext).startswith("menge:"):
            neu.setdefault("animator", {})["extra_tours"] = json.loads(json.dumps(extra))
            for k in ("tours_ablauf", "tour_colors", "tours_dezent"):
                if k in (muster.get("animator") or {}):
                    neu["animator"][k] = json.loads(json.dumps(muster["animator"][k]))
    daten.setdefault("projects", {})[neu["id"]] = neu
    daten.setdefault("aktiv", {})[kontext] = neu["id"]
    return neu


def rename(daten: dict, project_id: str, new_name: str) -> bool:
    p = (daten.get("projects") or {}).get(project_id)
    if not p:
        return False
    p["name"] = new_name
    _angefasst(p)
    return True


def set_status(daten: dict, project_id: str, status: str) -> bool:
    p = (daten.get("projects") or {}).get(project_id)
    if not p or status not in STATUS_WERTE:
        return False
    p["status"] = status
    p["modified_at"] = _now_iso()
    return True


def delete(daten: dict, kontext: str, project_id: str, defaults: dict) -> dict:
    """Safeguard wie früher: der Kontext behält mindestens ein Projekt."""
    projects = daten.setdefault("projects", {})
    if project_id in projects and projects[project_id].get("kontext") == kontext:
        del projects[project_id]
    rest = [p for p in projects.values() if p.get("kontext") == kontext]
    if not rest:
        neu = _neues_projekt(kontext, _s.DEFAULT_PROJECT_NAME, defaults, auto=True)
        projects[neu["id"]] = neu
        rest = [neu]
    aktiv = daten.setdefault("aktiv", {})
    if aktiv.get(kontext) not in projects:
        aktiv[kontext] = rest[0]["id"]
    return projects[aktiv[kontext]]


def modul_arbeit(p: dict, m: str) -> bool:
    """Liegt in Modul `m` ECHTE Arbeit (Inhalte, keine Default-Settings)?
    v0.9.621 als Chip-Kriterium eingeführt; seit v0.9.630 auch die Grundlage
    des Auto-Aufräumens — deshalb zählt `letztes_modul` hier NICHT (das trägt
    jedes nur geöffnete Projekt und würde das Aufräumen aushebeln)."""
    d = p.get(m) if isinstance(p.get(m), dict) else {}
    if m == "animator":
        return any(d.get(k) for k in ("timeline_events", "extra_tours",
                                      "ghosts", "charts", "track_color_stops"))
    if m == "tourmap":
        return bool(p.get("tourmap_signs") or d.get("signs") or p.get("signs"))
    if m == "geotagger":
        return bool(p.get("photos"))
    if m == "heightanim":
        return bool(d.get("series") or d.get("series2"))
    return False


AUTO_AUFRAEUMEN_TAGE = 30


def auto_aufraeumen(app_support: Path, daten: dict) -> int:
    """Auto-Projekte ohne jede Arbeit still entfernen (Marc, 30.08.2026, nach
    Dieters 111 „Standard"-Karten): Nur Projekte, die (1) automatisch angelegt
    wurden, (2) nie umbenannt oder im Status geändert wurden, (3) in KEINEM
    Modul echte Arbeit tragen und (4) seit `AUTO_AUFRAEUMEN_TAGE` Tagen
    unberührt sind. Öffnet man die Tour später wieder, entsteht ohnehin ein
    frisches Auto-Projekt — es geht nichts verloren. Rückgabe: Anzahl weg."""
    from datetime import datetime, timezone
    jetzt = datetime.now(timezone.utc)
    weg = []
    for pid, p in list((daten.get("projects") or {}).items()):
        if not p.get("auto"):
            continue
        if (p.get("name") or _s.DEFAULT_PROJECT_NAME) != _s.DEFAULT_PROJECT_NAME:
            continue
        if (p.get("status") or "aktiv") != "aktiv":
            continue
        if any(modul_arbeit(p, m) for m in ("animator", "tourmap",
                                            "geotagger", "heightanim")):
            continue
        stempel = p.get("modified_at") or p.get("created_at") or ""
        try:
            alter_tage = (jetzt - datetime.fromisoformat(stempel)).total_seconds() / 86400.0
        except (TypeError, ValueError):
            continue   # ohne lesbaren Stempel lieber behalten
        if alter_tage < AUTO_AUFRAEUMEN_TAGE:
            continue
        weg.append(pid)
    for pid in weg:
        if loeschen(daten, pid):
            try:
                _staende_datei(app_support, pid).unlink(missing_ok=True)
            except OSError:
                pass
    if weg:
        log.info("Auto-Aufräumen: %d unberührte Auto-Projekte (> %d Tage) entfernt",
                 len(weg), AUTO_AUFRAEUMEN_TAGE)
    return len(weg)


def loeschen(daten: dict, project_id: str) -> bool:
    """PM-Löschen: das Projekt verschwindet WIRKLICH (kein Kontext-Safeguard —
    öffnet man die Tour später wieder, entsteht ein frisches auto-Projekt)."""
    projects = daten.get("projects") or {}
    p = projects.pop(project_id, None)
    if p is None:
        return False
    aktiv = daten.setdefault("aktiv", {})
    if aktiv.get(p.get("kontext")) == project_id:
        rest = [q["id"] for q in projects.values()
                if q.get("kontext") == p.get("kontext")]
        if rest:
            aktiv[p["kontext"]] = rest[0]
        else:
            aktiv.pop(p.get("kontext"), None)
    return True


def duplizieren(daten: dict, project_id: str, name: str = "") -> Optional[dict]:
    """PM-Duplizieren: tiefe Kopie im selben Kontext, wird aktiv."""
    p = (daten.get("projects") or {}).get(project_id)
    if not p:
        return None
    neu = json.loads(json.dumps(p))
    neu["id"] = uuid.uuid4().hex[:12]
    neu["name"] = name or (p.get("name", "?") + " (Kopie)")
    neu["created_at"] = neu["modified_at"] = _now_iso()
    neu["auto"] = False
    neu["status"] = "aktiv"
    daten.setdefault("projects", {})[neu["id"]] = neu
    daten.setdefault("aktiv", {})[p.get("kontext", "")] = neu["id"]
    return neu


def set_active(daten: dict, kontext: str, project_id: str) -> bool:
    p = (daten.get("projects") or {}).get(project_id)
    if not p or p.get("kontext") != kontext:
        return False
    daten.setdefault("aktiv", {})[kontext] = project_id
    return True


# ── Kompositionen (ersetzen die Mengen-Sitzungen) ───────────────────────────

def kontext_oeffnen_menge(daten: dict, pfade: list, hashes: list, ablauf: str,
                          modus: str, pausen: bool, defaults: dict) -> dict:
    """Spiegel von session_open_for_menge: Projekt(e) zum Mengen-Kontext.

    Neue Archiv-Wahl (Ablauf/Modus) gilt für das AKTIVE Projekt des Kontexts —
    wortgleich zur bisherigen Sitzungs-Regel. Rückgabe: {"kontext", "neu"}.
    """
    key = _s.mengen_hash(hashes)
    aktiv = _aktives_projekt(daten, key)
    neu_angelegt = aktiv is None
    if neu_angelegt:
        name = ("Schwarm" if ablauf == "schwarm" else "Reise") + f" ({len(pfade)} Touren)"
        payload = None
        # Q18a (nur EXAKT gleiche Menge, v0.9.578): alte Solo-Reise der ersten
        # Tour als Startstand übernehmen, wenn sie genau diese Menge beschreibt.
        erste = _aktives_projekt(daten, hashes[0]) if hashes else None
        alt_extra = ((erste or {}).get("animator") or {}).get("extra_tours") or []
        if alt_extra:
            import unicodedata
            nfc = lambda x: unicodedata.normalize("NFC", str(x or ""))
            alte = {nfc(pfade[0])} | {nfc(t.get("gpx_path"))
                                      for t in alt_extra if isinstance(t, dict)}
            if alte == {nfc(p) for p in pfade}:
                payload = _payload_von({k: v for k, v in erste.items()
                                        if k not in ("status", "auto", "kontext",
                                                     "ablauf", "schwarm_modus",
                                                     "schwarm_pausen", "geo_hashes",
                                                     "gpx_paths")})
                log.info("Komposition %s: alte Reise aus Projekt %s übernommen",
                         key, erste.get("id"))
        aktiv = _neues_projekt(key, name, defaults, auto=False, ablauf=ablauf,
                               geo_hashes=sorted(set(hashes)), gpx_paths=pfade,
                               modus=modus, pausen=pausen, payload=payload)
        if payload is None and ablauf == "schwarm":
            # Schwarm-Overlay-Vorbelegung (M2) — wie bisher nur bei NEUEN.
            aktiv.setdefault("animator", {})
            aktiv["animator"].setdefault("overlay_live_fields",
                                         ["dist_done", "swarm_underway"])
            aktiv["animator"].setdefault("overlay_totals_fields", ["swarm_total"])
        daten.setdefault("projects", {})[aktiv["id"]] = aktiv
        daten.setdefault("aktiv", {})[key] = aktiv["id"]
    else:
        if aktiv.get("ablauf") != ablauf:
            log.info("Komposition %s: Ablauf %r → %r (neue Wahl im Archiv)",
                     key, aktiv.get("ablauf"), ablauf)
            aktiv["ablauf"] = ablauf
        if (aktiv.get("schwarm_modus") != modus
                or bool(aktiv.get("schwarm_pausen", True)) != bool(pausen)):
            log.info("Komposition %s: Modus %r(P=%s) → %r(P=%s)", key,
                     aktiv.get("schwarm_modus"), aktiv.get("schwarm_pausen", True),
                     modus, pausen)
            aktiv["schwarm_modus"] = modus
            aktiv["schwarm_pausen"] = bool(pausen)
        aktiv["gpx_paths"] = list(pfade)
        aktiv["geo_hashes"] = sorted(set(hashes))
        # Selbstheilung (v0.9.578): fremde Etappen fliegen aus allen Projekten
        # dieses Kontexts.
        import unicodedata
        nfc = lambda x: unicodedata.normalize("NFC", str(x or ""))
        mitglieder = {nfc(p) for p in pfade}
        for p in (daten.get("projects") or {}).values():
            if p.get("kontext") != key:
                continue
            anim = p.get("animator")
            et = anim.get("extra_tours") if isinstance(anim, dict) else None
            if not isinstance(et, list):
                continue
            behalten = [t for t in et if isinstance(t, dict)
                        and nfc(t.get("gpx_path")) in mitglieder]
            if len(behalten) != len(et):
                log.info("Komposition %s: %d fremde Etappe(n) aus Projekt %r entfernt",
                         key, len(et) - len(behalten), p.get("name"))
                anim["extra_tours"] = behalten
    return {"kontext": key, "neu": neu_angelegt}


# ── Querschnitt: Projekt-Manager, Ersetzen-Migration, Cloud-Sicht ───────────

def projekt_frei_anlegen(daten: dict, name: str, defaults: dict) -> dict:
    """v0.9.612 (Q1/Q2, Marc: „bau direkt ein leeres projekt und wenn man
    will kann man da dann touren hinzufügen"): Projekt OHNE Tour. Kontext
    `frei:<uuid>` — der Store und alle Projekt-Brücken können mit jedem
    Kontext-Schlüssel umgehen, nur Öffnen/Laden behandeln ihn besonders."""
    kontext = "frei:" + uuid.uuid4().hex[:12]
    p = _neues_projekt(kontext, name or _s.DEFAULT_PROJECT_NAME, defaults,
                       auto=False, ablauf="solo", geo_hashes=[], gpx_paths=[])
    p["geo_hashes"] = []
    daten.setdefault("projects", {})[p["id"]] = p
    daten.setdefault("aktiv", {})[kontext] = p["id"]
    log.info("Leeres Projekt angelegt: %r (%s)", p["name"], kontext)
    return p


def projekt_touren_setzen(daten: dict, project_id: str, paare: list) -> dict:
    """Touren einem (frei angelegten) Projekt geben: `paare` = [(geo_hash,
    gpx_path)] in gewünschter Reihenfolge. Re-keyt den Kontext (1 Tour =
    solo-Hash, ≥2 = Mengen-Hash) und zieht den aktiv-Zeiger mit; der
    Payload (Keyframes, Stationen, Schilder) bleibt unangetastet."""
    p = (daten.get("projects") or {}).get(project_id)
    if not p or not paare:
        return {"ok": False, "error": "Projekt/Touren fehlen"}
    hashes = [gh for gh, _pf in paare if gh]
    pfade = [pf for _gh, pf in paare if pf]
    if not hashes:
        return {"ok": False, "error": "keine geo_hashes"}
    alt_kontext = p.get("kontext") or ""
    if len(hashes) == 1:
        neu_kontext = hashes[0]
        p["ablauf"] = "solo"
    else:
        neu_kontext = _s.mengen_hash(hashes)
        if p.get("ablauf") not in ("reise", "schwarm"):
            p["ablauf"] = "reise"
    p["geo_hashes"] = sorted(set(hashes))
    p["gpx_paths"] = list(pfade)
    p["kontext"] = neu_kontext
    aktiv = daten.setdefault("aktiv", {})
    if aktiv.get(alt_kontext) == project_id:
        aktiv.pop(alt_kontext, None)
    aktiv.setdefault(neu_kontext, project_id)
    _angefasst(p)
    log.info("Projekt %s: %d Tour(en) gesetzt, Kontext %s → %s",
             project_id, len(hashes), alt_kontext, neu_kontext)
    return {"ok": True, "kontext": neu_kontext, "ablauf": p["ablauf"]}


def alle_projekte(daten: dict) -> list:
    """Karten-Daten für den Projekte-Bereich im Archiv (sortiert die UI)."""
    out = []
    touren = daten.get("touren") or {}
    # v0.9.616 (Marc: „sehe nur das 2. angelegte projekt"): sobald ein Kontext
    # MEHR als ein Projekt hat, wird keins davon als „automatisch" versteckt —
    # wer ein zweites Projekt anlegt, arbeitet offensichtlich an der Tour.
    je_kontext: dict = {}
    for p in (daten.get("projects") or {}).values():
        k = p.get("kontext") or ""
        je_kontext[k] = je_kontext.get(k, 0) + 1
    for pid, p in (daten.get("projects") or {}).items():
        ghs = p.get("geo_hashes") or []
        tour_namen = [((touren.get(g) or {}).get("name") or "") for g in ghs]
        # v0.9.621 (Abnahme-Befund): „Modul-Dict nicht leer" traf IMMER zu —
        # jedes Projekt trägt Default-Einstellungen, also zeigten alle Karten
        # alle vier Chips. Ein Chip heißt jetzt: dort liegt ARBEIT (Marker)
        # oder es war das zuletzt benutzte Modul.
        module = [m for m in ("animator", "tourmap", "geotagger", "heightanim")
                  if m == p.get("letztes_modul") or modul_arbeit(p, m)]
        # 30.08.2026 (Beta-Tester Dieter, 111 Auto-Projekte): jede Karte hieß
        # „Standard" (DEFAULT_PROJECT_NAME) — 111-mal derselbe Name sagt
        # nichts. Automatisch angelegte Projekte zeigen den Tour-Namen.
        name = p.get("name", "?")
        if p.get("auto") and (not name or name == _s.DEFAULT_PROJECT_NAME):
            name = next((n for n in tour_namen if n), name)
        out.append({
            "id": pid, "name": name,
            "status": p.get("status", "aktiv"),
            "auto": bool(p.get("auto")) and je_kontext.get(p.get("kontext") or "", 1) < 2,
            "created_at": p.get("created_at"), "modified_at": p.get("modified_at"),
            "kontext": p.get("kontext", ""),
            "ablauf": p.get("ablauf", "solo"),
            "schwarm_modus": p.get("schwarm_modus", "gleich"),
            "n_touren": max(1, len(ghs)),
            "geo_hashes": ghs,
            "gpx_paths": list(p.get("gpx_paths") or []),
            "tour_namen": [n for n in tour_namen if n],
            "module": module,
            "letztes_modul": p.get("letztes_modul") or "",
        })
    return out


# ── E2: Tour-Register — UUID + Fassungen (IDEAS §39, 29.08.2026) ─────────────
#
# Abwärtskompatibel gebaut: `touren` bleibt nach geo_hash verschlüsselt (jede
# FASSUNG = ein Eintrag, wie bisher jede Tour), die Kette entsteht über ein
# geteiltes `id` + `fassung {nr, erstellt, quelle}` je Eintrag. Alle Brücken-
# Verträge (track_hash == kontext == geo_hash) bleiben unangetastet; ein
# Projekt ist automatisch an die Fassung „gepinnt", deren geo_hash sein
# Kontext ist (Q16a — Marcs „die animation könnte auseinanderfallen").

FASSUNG_QUELLEN = ("import", "werkzeug", "extern", "rollback", "backup")


def register_migrieren(daten: dict) -> int:
    """Einmalig/idempotent: jedem Tour-Eintrag ohne `id` eine stabile UUID und
    Fassung 1 geben. Läuft bei jedem Start mit (neue Einträge rutschen nach)."""
    n = 0
    for t in (daten.get("touren") or {}).values():
        if not isinstance(t, dict) or t.get("id"):
            continue
        t["id"] = "tour_" + uuid.uuid4().hex[:12]
        t["fassung"] = {"nr": 1, "erstellt": t.get("created_at") or _now_iso(),
                        "quelle": "import"}
        n += 1
    return n


def register_lauf(app_support: Path) -> int:
    """Beim App-Start: Alt-Einträge ohne UUID nachregistrieren (idempotent)."""
    with LOCK:
        daten = laden(app_support)
        n = register_migrieren(daten)
        if n:
            speichern(app_support, daten)
            log.info("Tour-Register: %d Einträge mit UUID+Fassung versehen", n)
    return n


def tour_von_hash(daten: dict, geo_hash: str) -> Optional[dict]:
    return (daten.get("touren") or {}).get(geo_hash)


def kette(daten: dict, tour_id: str) -> list:
    """Alle Fassungen einer Tour als [(geo_hash, eintrag)], älteste zuerst."""
    if not tour_id:
        return []
    glieder = [(gh, t) for gh, t in (daten.get("touren") or {}).items()
               if isinstance(t, dict) and t.get("id") == tour_id]
    glieder.sort(key=lambda x: ((x[1].get("fassung") or {}).get("nr", 1),
                                (x[1].get("fassung") or {}).get("erstellt", "")))
    return glieder


def neueste_fassung(daten: dict, tour_id: str) -> str:
    g = kette(daten, tour_id)
    return g[-1][0] if g else ""


def fassung_anlegen(daten: dict, alt_gh: str, neu_gh: str, quelle: str,
                    snapshot_pfad: str = "", gpx_path: str = "") -> Optional[dict]:
    """Neue Fassung an die Kette von `alt_gh` hängen (Heilen/Ersetzen/extern).

    Bestehende Projekte bleiben GEPINNT (ihr Kontext zeigt weiter auf die alte
    Fassung — die alte Tour-Zeile samt Snapshot bleibt stehen); nur das
    Register wächst. Gibt den neuen Eintrag zurück, None wenn nichts zu tun."""
    if not alt_gh or not neu_gh or alt_gh == neu_gh:
        return None
    touren = daten.setdefault("touren", {})
    alt = touren.get(alt_gh)
    if not isinstance(alt, dict):
        return None
    if not alt.get("id"):
        register_migrieren(daten)
    if neu_gh in touren:
        # Kette ggf. zusammenführen (Datei kam auf bekannte Geometrie zurück).
        vorhanden = touren[neu_gh]
        if not vorhanden.get("id"):
            vorhanden["id"] = alt["id"]
            nmax = max(((t.get("fassung") or {}).get("nr", 1)
                        for _, t in kette(daten, alt["id"])), default=1)
            vorhanden["fassung"] = {"nr": nmax + 1, "erstellt": _now_iso(),
                                    "quelle": quelle}
        return vorhanden
    nmax = max(((t.get("fassung") or {}).get("nr", 1)
                for _, t in kette(daten, alt["id"])), default=1)
    now = _now_iso()
    neu = {"id": alt["id"],
           "fassung": {"nr": nmax + 1, "erstellt": now, "quelle": quelle},
           "name": alt.get("name") or "",
           "stats": {},
           "created_at": now, "last_active_at": now,
           "gpx_filenames_seen": list(alt.get("gpx_filenames_seen") or []),
           "gpx_snapshot_path": snapshot_pfad or "",
           "ui_hashes": [],
           "gpx_paths": [gpx_path] if gpx_path else list(alt.get("gpx_paths") or [])}
    touren[neu_gh] = neu
    log.info("Tour %s: Fassung %d angelegt (%s) %s → %s",
             alt["id"], nmax + 1, quelle, alt_gh[:12], neu_gh[:12])
    return neu


def fassungs_hinweis(daten: dict, geo_hash: str) -> Optional[dict]:
    """Für die Projekt-Karte: gibt es zur gepinnten Fassung eine NEUERE?"""
    t = tour_von_hash(daten, geo_hash)
    if not t or not t.get("id"):
        return None
    neu_gh = neueste_fassung(daten, t["id"])
    if not neu_gh or neu_gh == geo_hash:
        return None
    neu = tour_von_hash(daten, neu_gh) or {}
    return {"geo_hash": neu_gh,
            "nr": (neu.get("fassung") or {}).get("nr", 0),
            "eigene_nr": (t.get("fassung") or {}).get("nr", 0)}


def projekt_auf_neueste(daten: dict, project_id: str) -> dict:
    """„⬆ neuere Fassung": genau DIESES Projekt auf die neuesten Fassungen
    seiner Touren heben (Solo-Kontext, geo_hashes-Liste, Mengen-Hash, aktiv).
    Andere Projekte bleiben gepinnt — das ist der Unterschied zum alten
    geo_hash_migrieren."""
    p = (daten.get("projects") or {}).get(project_id)
    if not p:
        return {"ok": False, "error": "unbekanntes Projekt"}
    umzu = {}
    for gh in list(p.get("geo_hashes") or []) + ([p["kontext"]] if not str(p.get("kontext", "")).startswith("menge:") else []):
        t = tour_von_hash(daten, gh)
        if t and t.get("id"):
            neu = neueste_fassung(daten, t["id"])
            if neu and neu != gh:
                umzu[gh] = neu
    if not umzu:
        return {"ok": True, "geaendert": 0}
    aktiv = daten.setdefault("aktiv", {})
    alt_kontext = p.get("kontext")
    if p.get("geo_hashes"):
        p["geo_hashes"] = sorted(set(umzu.get(g, g) for g in p["geo_hashes"]))
    if str(alt_kontext or "").startswith("menge:"):
        p["kontext"] = _s.mengen_hash(p["geo_hashes"])
        # gpx_paths bleiben stehen — die Brücke löst Pfade beim Öffnen ohnehin
        # frisch über Tour-Fakten/Archiv auf (projekte_liste/projekt_aktivieren).
    else:
        p["kontext"] = umzu.get(alt_kontext, alt_kontext)
    if aktiv.get(alt_kontext) == project_id:
        aktiv.pop(alt_kontext, None)
    aktiv.setdefault(p["kontext"], project_id)
    _angefasst(p)
    log.info("Projekt %s auf neueste Fassung(en) gehoben: %s", project_id, umzu)
    return {"ok": True, "geaendert": len(umzu), "kontext": p["kontext"]}


# ── E3: Projekt-Stände — Arbeitsstand-Historie je Projekt (IDEAS §39) ───────
#
# Jede Werkzeug-Speicherung erzeugt höchstens alle STAND_MIN_ABSTAND_S einen
# Stand (sonst würde jeder Regler-Zug einen anlegen). Ablage als JSONL neben
# dem Store: projekt_staende/<pid>.jsonl, die letzten STAND_MAX bleiben.

STAND_MAX = 20
STAND_MIN_ABSTAND_S = 600


def _staende_datei(app_support: Path, project_id: str) -> Path:
    d = app_support / "projekt_staende"
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{project_id}.jsonl"


def stand_schreiben(app_support: Path, projekt: dict,
                    erzwingen: bool = False) -> bool:
    """Aktuellen Arbeitsstand des Projekts anhängen (gedrosselt)."""
    pid = (projekt or {}).get("id")
    if not pid:
        return False
    datei = _staende_datei(app_support, pid)
    zeilen = []
    if datei.exists():
        zeilen = [z for z in datei.read_text(encoding="utf-8").splitlines() if z.strip()]
    if zeilen and not erzwingen:
        try:
            from datetime import datetime, timezone
            letzt = json.loads(zeilen[-1]).get("ts", "")
            if letzt:
                # _now_iso() ist UTC-aware — mktime/strptime würde die Zeit
                # als LOKAL deuten und die Drossel je nach Zeitzone aushebeln.
                delta = (datetime.now(timezone.utc)
                         - datetime.fromisoformat(letzt)).total_seconds()
                if 0 <= delta < STAND_MIN_ABSTAND_S:
                    return False
        except Exception:
            pass
    stand = {"ts": _now_iso(), "name": projekt.get("name", ""),
             "payload": _payload_von(projekt)}
    zeilen.append(json.dumps(stand, ensure_ascii=False, sort_keys=True))
    datei.write_text("\n".join(zeilen[-STAND_MAX:]) + "\n", encoding="utf-8")
    return True


def staende_liste(app_support: Path, project_id: str) -> list:
    datei = _staende_datei(app_support, project_id)
    if not datei.exists():
        return []
    out = []
    for z in datei.read_text(encoding="utf-8").splitlines():
        if not z.strip():
            continue
        try:
            d = json.loads(z)
            pl = d.get("payload") or {}
            out.append({"ts": d.get("ts", ""),
                        "keyframes": len((pl.get("animator") or {}).get("timeline_events") or []),
                        "schilder": len(pl.get("tourmap_signs") or pl.get("signs") or []),
                        "fotos": len(pl.get("photos") or [])})
        except Exception:
            continue
    return out


def stand_wiederherstellen(app_support: Path, daten: dict, project_id: str,
                           ts: str) -> bool:
    """Payload eines Stands zurück ins Projekt — der JETZIGE Stand wird
    vorher selbst als Stand gesichert (nichts geht verloren)."""
    p = (daten.get("projects") or {}).get(project_id)
    if not p:
        return False
    datei = _staende_datei(app_support, project_id)
    if not datei.exists():
        return False
    ziel = None
    for z in datei.read_text(encoding="utf-8").splitlines():
        try:
            d = json.loads(z)
        except Exception:
            continue
        if d.get("ts") == ts:
            ziel = d
    if ziel is None:
        return False
    stand_schreiben(app_support, p, erzwingen=True)
    for k in list(p.keys()):
        if k not in _META_FELDER:
            p.pop(k)
    for k, v in (ziel.get("payload") or {}).items():
        p[k] = v
    _angefasst(p)
    log.info("Projekt %s: Stand %s wiederhergestellt", project_id, ts)
    return True


def geo_hash_migrieren(daten: dict, alt: str, neu: str) -> int:
    """Nach „Im Archiv ersetzen" (geheilte Datei = neuer geo_hash): Kontexte,
    Referenzen und Tour-Fakten umziehen. Gibt die Zahl betroffener Projekte
    zurück. (Wird in E2 durch stabile Tour-UUIDs überflüssig.)"""
    if not alt or not neu or alt == neu:
        return 0
    n = 0
    touren = daten.setdefault("touren", {})
    if alt in touren and neu not in touren:
        touren[neu] = touren.pop(alt)
    aktiv = daten.setdefault("aktiv", {})
    umzu = {}
    for p in (daten.get("projects") or {}).values():
        getroffen = False
        if alt in (p.get("geo_hashes") or []):
            p["geo_hashes"] = sorted(set(neu if g == alt else g
                                         for g in p["geo_hashes"]))
            getroffen = True
        if p.get("kontext") == alt:
            p["kontext"] = neu
            getroffen = True
        elif str(p.get("kontext") or "").startswith("menge:") and getroffen:
            neu_key = _s.mengen_hash(p["geo_hashes"])
            umzu[p["kontext"]] = neu_key
            p["kontext"] = neu_key
        if getroffen:
            n += 1
    for alt_key, neu_key in {alt: neu, **umzu}.items():
        if alt_key in aktiv and neu_key not in aktiv:
            aktiv[neu_key] = aktiv.pop(alt_key)
    return n


def export_sessions_sicht(daten: dict) -> dict:
    """ÜBERGANGS-Sicht für die Cloud (bis Cloud v2 in E3): baut aus dem
    Projekt-Store die alte sessions-Form nach, damit das Wire-Format und der
    Zweitrechner unverändert weiterlaufen. Nur LESEND benutzt."""
    sessions = {}
    touren = daten.get("touren") or {}
    for kontext in {p.get("kontext") for p in (daten.get("projects") or {}).values()}:
        if not kontext:
            continue
        projs = {p["id"]: {**{k: v for k, v in p.items()
                              if k not in ("status", "auto", "kontext", "ablauf",
                                           "schwarm_modus", "schwarm_pausen",
                                           "geo_hashes", "gpx_paths")}}
                 for p in (daten.get("projects") or {}).values()
                 if p.get("kontext") == kontext}
        aktiv_p = _aktives_projekt(daten, kontext) or {}
        sess = {"track_hash": kontext,
                "active_project_id": (daten.get("aktiv") or {}).get(kontext) or "",
                "projects": projs}
        if kontext.startswith("menge:"):
            sess.update({"name": aktiv_p.get("name") or "",
                         "ablauf": aktiv_p.get("ablauf") or "reise",
                         "schwarm_modus": aktiv_p.get("schwarm_modus", "gleich"),
                         "schwarm_pausen": bool(aktiv_p.get("schwarm_pausen", True)),
                         "geo_hashes": list(aktiv_p.get("geo_hashes") or []),
                         "gpx_paths": list(aktiv_p.get("gpx_paths") or []),
                         "stats": {"n_tours": len(aktiv_p.get("geo_hashes") or [])}})
        else:
            t = touren.get(kontext) or {}
            sess.update({"name": t.get("name") or "",
                         "stats": t.get("stats") or {},
                         "created_at": t.get("created_at") or "",
                         "last_active_at": t.get("last_active_at") or "",
                         "gpx_filenames_seen": list(t.get("gpx_filenames_seen") or []),
                         "gpx_snapshot_path": t.get("gpx_snapshot_path") or "",
                         "ui_hashes": list(t.get("ui_hashes") or [])})
        sessions[kontext] = sess
    return {"schema": 2, "sessions": sessions}


def import_session_objekt(daten: dict, kontext: str, session_obj: dict,
                          defaults: dict) -> int:
    """Cloud-Empfang (Übergang): ein session-förmiges Objekt in den
    Projekt-Store einspielen (dieselbe Transformation wie die Migration,
    für genau einen Kontext). Bestehende Projekte gleicher ID werden
    überschrieben (Cloud gewinnt — wie bisher beim Umschlag-Einspielen)."""
    n = 0
    ist_menge = kontext.startswith("menge:")
    if not ist_menge:
        daten.setdefault("touren", {}).setdefault(kontext, {}).update({
            "name": session_obj.get("name") or "",
            "stats": session_obj.get("stats") or {},
            "gpx_filenames_seen": list(session_obj.get("gpx_filenames_seen") or []),
            "ui_hashes": list(session_obj.get("ui_hashes") or []),
        })
    for pid, p in (session_obj.get("projects") or {}).items():
        if not isinstance(p, dict):
            continue
        payload = _payload_von(p)
        bestehend = (daten.get("projects") or {}).get(pid) or {}
        neu = {
            "id": pid,
            "name": p.get("name") or _s.DEFAULT_PROJECT_NAME,
            "status": bestehend.get("status", "aktiv"),
            "auto": bool(bestehend.get("auto", False)),
            "created_at": p.get("created_at") or _now_iso(),
            "modified_at": p.get("modified_at") or _now_iso(),
            "kontext": kontext,
            "ablauf": (session_obj.get("ablauf") or "reise") if ist_menge else "solo",
            "schwarm_modus": session_obj.get("schwarm_modus") or "gleich",
            "schwarm_pausen": bool(session_obj.get("schwarm_pausen", True)),
            "geo_hashes": (sorted(set(session_obj.get("geo_hashes") or []))
                           if ist_menge else [kontext]),
            "gpx_paths": list(session_obj.get("gpx_paths") or []) if ist_menge else [],
        }
        neu.update(payload)
        daten.setdefault("projects", {})[pid] = neu
        n += 1
    if session_obj.get("active_project_id"):
        daten.setdefault("aktiv", {})[kontext] = session_obj["active_project_id"]
    return n
