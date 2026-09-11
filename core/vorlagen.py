# -*- coding: utf-8 -*-
"""Vorlagen — leere Projekte (docs/TOUR-ASSISTENT.md §2, Marc 11.09.2026).

Eine Vorlage trägt je Modul den Einstellungs-Block eines Projekts OHNE alles,
was am Track hängt (Keyframes, Schilder, Fotos, Gruppen, Schnitt …). Marcs
Regel: „alles was irgendwie am track hängt kommt nicht in die vorlage, alles
andere schon.“ Die Sperrliste `TRACKGEBUNDEN` ist die EINE Stelle dafür — die
älteren „eigenen Standardwerte“ (app.save_user_defaults) benutzen sie mit.

Datei (im Bibliotheks-Ordner, wie projekte.json): `vorlagen.json`
    {"schema": 1, "vorlagen": {id: VORLAGE}, "standard": id}
VORLAGE = {id, name, created_at, modified_at, quelle, module: {modul: {...}}}

„Reisezoom-Standard“ (REISEZOOM_ID) steht nicht in der Datei — sie entsteht bei
jedem `liste()` aus den Werkswerten, die der Aufrufer mitgibt. Der Stern
(`standard`) nennt die Vorlage, mit der neue Projekte starten; zeigt er ins
Leere, gilt Reisezoom-Standard.
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

log = logging.getLogger("core.vorlagen")

LOCK = threading.RLock()
SCHEMA = 1
DATEI = "vorlagen.json"
REISEZOOM_ID = "reisezoom-standard"
REISEZOOM_NAME = "Reisezoom-Standard"
MIGRATION_NAME = "Meine Standardwerte"
MEIN_STANDARD_NAME = "Mein Standard"

#: Module, deren Einstellungs-Block in eine Vorlage kommt.
MODULE = ("animator", "tourmap", "geotagger", "heightanim", "webkarte")

#: Schlüssel, die NIE in eine Vorlage kommen (Spec §2.1). Je Modul.
TRACKGEBUNDEN = {
    "animator": {
        "timeline_events", "keyframes_enabled", "render_start_anchor", "render_end_anchor",
        "timeline_anchor_v", "timeline_schema_v", "timeline_dedupe_v",
        "manual_cam", "static_zoom", "static_bearing", "static_padding", "static_pins",
        "trim_start", "trim_end", "extra_tours", "ghosts", "ghost_gpx_path",
        "gruppen", "tempo_eintraege", "tours_ablauf", "tours_dezent", "tours_dot_haupt",
        "tours_fokus", "tours_haupt_start_s", "tour_colors", "etappe1_dauer_s", "etappe1_name",
        "charts", "track_color_stops", "signs", "photos", "last_save_dir",
        "open_sections", "collapsed_sections",
    },
    "tourmap": {
        "static_zoom", "static_bearing", "static_padding", "static_pins", "manual_cam",
        "keyframes_enabled", "signs", "photos", "last_save_dir",
        "open_sections", "collapsed_sections",
    },
    "heightanim": {"trim_start", "trim_end", "waypoints", "wp_hidden", "wp_sources",
                   "last_save_dir", "open_sections", "collapsed_sections"},
    "geotagger": {"last_photos_dir", "last_photos_paths", "open_sections", "collapsed_sections"},
    "webkarte": {"tracks"},
}


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime())


def _pfad(app_support: Path) -> Path:
    return Path(app_support) / DATEI


def laden(app_support: Path) -> dict:
    p = _pfad(app_support)
    with LOCK:
        try:
            if p.exists():
                with open(p, "r", encoding="utf-8") as fh:
                    d = json.load(fh)
                if isinstance(d, dict) and isinstance(d.get("vorlagen"), dict):
                    d.setdefault("schema", SCHEMA)
                    d.setdefault("standard", "")
                    return d
        except Exception as e:  # noqa: BLE001 — kaputte Datei darf die App nicht stoppen
            log.error("vorlagen.json unlesbar: %s", e)
            try:
                p.rename(p.with_suffix(".json.kaputt-" + time.strftime("%Y%m%d-%H%M%S")))
            except Exception:  # noqa: BLE001
                pass
    return {"schema": SCHEMA, "vorlagen": {}, "standard": ""}


def speichern(app_support: Path, daten: dict) -> None:
    p = _pfad(app_support)
    with LOCK:
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".json.tmp")
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(daten, fh, ensure_ascii=False, indent=1)
        os.replace(tmp, p)


# ── Filter ──────────────────────────────────────────────────────────────────

def _erlaubt(v) -> bool:
    return isinstance(v, (str, int, float, bool, list, dict, type(None)))


def modul_filtern(modul: str, block: dict) -> dict:
    """Ein Modul-Block ohne Trackgebundenes und ohne private Schlüssel."""
    sperr = TRACKGEBUNDEN.get(modul, set())
    if not isinstance(block, dict):
        return {}
    return {k: json.loads(json.dumps(v)) for k, v in block.items()
            if k not in sperr and not str(k).startswith("_") and _erlaubt(v)}


def aus_projekt(projekt: dict) -> dict:
    """Die Modul-Blöcke eines Projekts, wie sie in eine Vorlage gehören."""
    out = {}
    for m in MODULE:
        gefiltert = modul_filtern(m, (projekt or {}).get(m) or {})
        if gefiltert:
            out[m] = gefiltert
    return out


# ── Liste / Zugriff ─────────────────────────────────────────────────────────

def _werk_vorlage(werk: dict) -> dict:
    module = {m: modul_filtern(m, (werk or {}).get(m) or {}) for m in MODULE}
    return {"id": REISEZOOM_ID, "name": REISEZOOM_NAME, "mitgeliefert": True,
            "created_at": "", "modified_at": "", "quelle": "",
            "module": {m: b for m, b in module.items() if b}}


def standard_id(daten: dict) -> str:
    sid = str((daten or {}).get("standard") or "")
    if sid and sid in (daten.get("vorlagen") or {}):
        return sid
    return REISEZOOM_ID


def holen(daten: dict, vid: str, werk: Optional[dict] = None) -> Optional[dict]:
    if not vid or vid == REISEZOOM_ID:
        return _werk_vorlage(werk or {}) if werk is not None else None
    return (daten.get("vorlagen") or {}).get(vid)


def standard(daten: dict, werk: dict) -> dict:
    """Die Stern-Vorlage (oder Reisezoom-Standard)."""
    return holen(daten, standard_id(daten), werk) or _werk_vorlage(werk)


def kurzinfo(v: dict) -> dict:
    """Für die Kachel: Kartenstil, Format, Linienfarbe, Schrift."""
    a = (v.get("module") or {}).get("animator") or {}
    return {
        "map_style": a.get("map_style", ""),
        "format": f"{a.get('width', '')}×{a.get('height', '')}" if a.get("width") else "",
        "line_color": a.get("line_color", ""),
        "font": a.get("overlay_font", ""),
        "module": sorted((v.get("module") or {}).keys()),
    }


def liste(daten: dict, werk: dict) -> list:
    """Alle Vorlagen als Karten-Daten: Reisezoom-Standard zuerst, dann nach Name."""
    std = standard_id(daten)
    out = [_werk_vorlage(werk)]
    eigene = list((daten.get("vorlagen") or {}).values())
    eigene.sort(key=lambda v: str(v.get("name") or "").lower())
    out.extend(eigene)
    karten = []
    for v in out:
        k = {"id": v["id"], "name": v.get("name", "?"),
             "mitgeliefert": bool(v.get("mitgeliefert")),
             "standard": v["id"] == std,
             "created_at": v.get("created_at", ""), "modified_at": v.get("modified_at", ""),
             "quelle": v.get("quelle", "")}
        k.update(kurzinfo(v))
        karten.append(k)
    return karten


# ── CRUD ────────────────────────────────────────────────────────────────────

def freier_name(daten: dict, basis: str) -> str:
    namen = {str(v.get("name") or "").lower() for v in (daten.get("vorlagen") or {}).values()}
    namen.add(REISEZOOM_NAME.lower())
    if basis.lower() not in namen:
        return basis
    n = 2
    while f"{basis} ({n})".lower() in namen:
        n += 1
    return f"{basis} ({n})"


def anlegen(daten: dict, name: str, projekt: dict, quelle: str = "",
            vid: str = "") -> dict:
    now = _now_iso()
    v = {"id": vid or uuid.uuid4().hex[:12], "name": freier_name(daten, name or "Vorlage"),
         "created_at": now, "modified_at": now, "quelle": quelle or "",
         "module": aus_projekt(projekt)}
    daten.setdefault("vorlagen", {})[v["id"]] = v
    log.info("Vorlage angelegt: %r (%s) aus %r", v["name"], v["id"], quelle)
    return v


def aktualisieren(daten: dict, vid: str, projekt: dict, quelle: str = "") -> Optional[dict]:
    v = (daten.get("vorlagen") or {}).get(vid)
    if not v:
        return None
    v["module"] = aus_projekt(projekt)
    v["modified_at"] = _now_iso()
    if quelle:
        v["quelle"] = quelle
    return v


def umbenennen(daten: dict, vid: str, name: str) -> bool:
    v = (daten.get("vorlagen") or {}).get(vid)
    if not v or not (name or "").strip():
        return False
    v["name"] = name.strip()
    v["modified_at"] = _now_iso()
    return True


def loeschen(daten: dict, vid: str) -> Optional[dict]:
    """Entfernt eine Vorlage und gibt sie zurück (für Undo im Archiv)."""
    if vid == REISEZOOM_ID:
        return None
    v = (daten.get("vorlagen") or {}).pop(vid, None)
    if v and daten.get("standard") == vid:
        daten["standard"] = ""
    return v


def wieder_einsetzen(daten: dict, v: dict) -> None:
    daten.setdefault("vorlagen", {})[v["id"]] = v


def standard_setzen(daten: dict, vid: str) -> bool:
    if vid == REISEZOOM_ID:
        daten["standard"] = ""
        return True
    if vid not in (daten.get("vorlagen") or {}):
        return False
    daten["standard"] = vid
    return True


# ── Anwenden ────────────────────────────────────────────────────────────────

def anwenden(projekt: dict, vorlage: dict) -> dict:
    """Schreibt die Modul-Blöcke der Vorlage ins Projekt. Nur Schlüssel, die
    die Vorlage trägt, werden überschrieben — Trackgebundenes (sowohl im
    Projekt vorhanden als auch per Sperrliste) bleibt stehen.
    Rückgabe: die betroffenen Modul-Blöcke VOR dem Anwenden (für Undo)."""
    vorher = {}
    for m, block in ((vorlage or {}).get("module") or {}).items():
        if m not in MODULE or not isinstance(block, dict):
            continue
        ziel = projekt.setdefault(m, {})
        if not isinstance(ziel, dict):
            ziel = projekt[m] = {}
        vorher[m] = json.loads(json.dumps(ziel))
        sperr = TRACKGEBUNDEN.get(m, set())
        for k, v in block.items():
            if k in sperr:
                continue
            ziel[k] = json.loads(json.dumps(v))
    return vorher


def defaults_mit_vorlage(base: dict, vorlage: Optional[dict]) -> dict:
    """Werkswerte + Vorlage → Vorgaben für ein neues Projekt (tiefe Kopie)."""
    out = json.loads(json.dumps(base))
    for m, block in ((vorlage or {}).get("module") or {}).items():
        if m in out and isinstance(out[m], dict) and isinstance(block, dict):
            out[m].update(modul_filtern(m, block))
        elif isinstance(block, dict) and m in MODULE:
            out[m] = modul_filtern(m, block)
    return out


# ── Migration der alten „eigenen Standardwerte“ ─────────────────────────────

def migrieren_user_defaults(daten: dict, user_defaults: Optional[dict]) -> Optional[dict]:
    """Einmalig: settings.json["user_defaults"] → Vorlage „Meine Standardwerte“
    mit Stern. Gibt die angelegte Vorlage zurück (oder None, wenn nichts da)."""
    if not isinstance(user_defaults, dict) or not user_defaults:
        return None
    if any(v.get("quelle") == "user_defaults" for v in (daten.get("vorlagen") or {}).values()):
        return None
    now = _now_iso()
    v = {"id": uuid.uuid4().hex[:12], "name": freier_name(daten, MIGRATION_NAME),
         "created_at": now, "modified_at": now, "quelle": "user_defaults",
         "module": {m: modul_filtern(m, b) for m, b in user_defaults.items()
                    if m in MODULE and isinstance(b, dict)}}
    v["module"] = {m: b for m, b in v["module"].items() if b}
    if not v["module"]:
        return None
    daten.setdefault("vorlagen", {})[v["id"]] = v
    daten["standard"] = v["id"]
    log.info("Eigene Standardwerte → Vorlage %r (%s)", v["name"], v["id"])
    return v
