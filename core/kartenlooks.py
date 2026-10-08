"""Eigene Kartenlooks (07.10.2026, Karten-Editor).

Marc: „Im Web kann man halt 10 verschiedene Stile, und auf dem Desktop kann man sich die Karten komplett selber bauen.“
Ein eigener Look ist ein Look-Objekt wie in `ui/js/kartenlook.js` (Rollen-Farben, Schrift, Schummerung, Leuchtsaum,
Tiefen) plus Name. Er liegt app-weit in der Bibliothek (`kartenlooks.json`, reist mit der Bibliothek um) und zusätzlich
als Kopie im Projekt (`animator.kartenlook`) — so kennen Video, `.rzproj` und das Web den Look auch ohne diese Datei.

    {"schema": 1, "looks": {id: {"id", "name", "erstellt", "geaendert", "look": {...}}}}
"""
from __future__ import annotations

import json
import logging
import re
import threading
import time
import uuid
from pathlib import Path

from core import dateischutz as _ds

log = logging.getLogger(__name__)
DATEI = "kartenlooks.json"
SCHEMA = 1
LOCK = threading.RLock()
_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
MAX_LOOKS = 200
EXTRAS_BOOL = ("enable_terrain", "gebaeude_3d", "gebaeude_wachsen", "show_place_labels", "show_road_labels",
               "show_poi_labels", "show_transit_labels", "show_admin_boundaries")


def _pfad(ort: Path) -> Path:
    return Path(ort) / DATEI


def laden(ort: Path) -> dict:
    p = _pfad(ort)
    with LOCK:
        try:
            if p.exists():
                d = json.loads(p.read_text(encoding="utf-8"))
                if isinstance(d, dict) and isinstance(d.get("looks"), dict):
                    d.setdefault("schema", SCHEMA)
                    return d
        except Exception as e:  # noqa: BLE001 — kaputte Datei darf die App nicht stoppen
            log.error("kartenlooks.json unlesbar: %s", e)
            try:
                _ds.umbenennen(p, p.with_suffix(".json.kaputt-" + time.strftime("%Y%m%d-%H%M%S")), "kartenlooks_kaputt")
            except Exception:  # noqa: BLE001
                pass
    return {"schema": SCHEMA, "looks": {}}


def speichern(ort: Path, daten: dict) -> None:
    p = _pfad(ort)
    with LOCK:
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(daten, ensure_ascii=False, indent=1), encoding="utf-8")
        _ds.ersetzen(tmp, p, "kartenlooks_speichern")


def bereinigen(look) -> dict | None:
    """Look-Objekt prüfen und auf bekannte Felder kürzen (kommt auch aus importierten Dateien)."""
    if not isinstance(look, dict):
        return None
    farben = ("land", "water", "waterway", "wood", "park", "building", "minor", "major", "motorway", "rail",
              "text", "halo", "waterText")
    o: dict = {"v": 1, "basis": "positron"}
    for k in farben:
        v = look.get(k)
        if isinstance(v, str) and _HEX.match(v):
            o[k] = v.lower()
    if not o.get("land") or not o.get("water"):
        return None
    c = look.get("casing")
    o["casing"] = c.lower() if isinstance(c, str) and _HEX.match(c) else None
    for k in ("id", "name", "satellit"):
        if k in look and isinstance(look[k], (str, bool)):
            o[k] = look[k] if not isinstance(look[k], str) else look[k][:80]
    o["font"] = look.get("font") if look.get("font") in ("regular", "bold", "italic") else "regular"
    o["caps"] = bool(look.get("caps"))
    o["labels"] = look.get("labels") is not False

    def obj(name, felder):
        v = look.get(name)
        if not isinstance(v, dict):
            return None
        r = {}
        for f, art in felder.items():
            x = v.get(f)
            if art == "farbe" and isinstance(x, str) and _HEX.match(x):
                r[f] = x.lower()
            elif art == "zahl" and isinstance(x, (int, float)):
                r[f] = float(x)
            elif art == "bool":
                r[f] = bool(x)
        return r
    b = obj("border", {"color": "farbe", "dash": "bool"})
    o["border"] = b if b and b.get("color") else {"color": "#9a9a9a", "dash": False}
    o["coast"] = obj("coast", {"color": "farbe", "width": "zahl", "opacity": "zahl"}) or None
    if o["coast"] is not None and not o["coast"].get("color"):
        o["coast"] = None
    o["shade"] = obj("shade", {"shadow": "farbe", "highlight": "farbe", "accent": "farbe", "exaggeration": "zahl"}) or None
    if o["shade"] is not None and not (o["shade"].get("shadow") and o["shade"].get("highlight")):
        o["shade"] = None
    o["glow"] = obj("glow", {"color": "farbe", "strength": "zahl"}) if isinstance(look.get("glow"), dict) else None
    d = look.get("depths")
    if isinstance(d, dict) and isinstance(d.get("bands"), list):
        bands = [[float(x[0]), x[1].lower()] for x in d["bands"]
                 if isinstance(x, list) and len(x) == 2 and isinstance(x[0], (int, float))
                 and isinstance(x[1], str) and _HEX.match(x[1])][:12]
        o["depths"] = {"bands": bands} if bands else None
    else:
        o["depths"] = None
    # 08.10.2026 — Kartenzubehör, das ein eigener Look mitträgt (Gelände, 3D-Häuser, „Auf der Karte anzeigen“)
    ex = look.get("extras")
    if isinstance(ex, dict):
        r = {}
        for k in EXTRAS_BOOL:
            if isinstance(ex.get(k), bool):
                r[k] = ex[k]
        x = ex.get("exaggeration")
        if isinstance(x, (int, float)) and not isinstance(x, bool):
            r["exaggeration"] = max(0.0, min(4.0, float(x)))
        if r:
            o["extras"] = r
    return o


def liste(ort: Path) -> list:
    d = laden(ort)
    return sorted(d["looks"].values(), key=lambda x: str(x.get("name", "")).lower())


def anlegen(ort: Path, name: str, look: dict, lid: str = "") -> dict:
    sauber = bereinigen(look)
    if sauber is None:
        raise ValueError("kein gültiger Kartenlook")
    with LOCK:
        d = laden(ort)
        if len(d["looks"]) >= MAX_LOOKS and lid not in d["looks"]:
            raise ValueError("zu viele eigene Looks")
        jetzt = time.strftime("%Y-%m-%dT%H:%M:%S")
        lid = lid if lid in d["looks"] else "kl_" + uuid.uuid4().hex[:10]
        alt = d["looks"].get(lid) or {}
        name = (str(name or "").strip() or alt.get("name") or "Eigener Look")[:60]
        sauber["id"] = lid
        sauber["name"] = name
        e = {"id": lid, "name": name, "erstellt": alt.get("erstellt") or jetzt, "geaendert": jetzt, "look": sauber}
        d["looks"][lid] = e
        speichern(ort, d)
        return e


def loeschen(ort: Path, lid: str) -> bool:
    with LOCK:
        d = laden(ort)
        if lid not in d["looks"]:
            return False
        d["looks"].pop(lid)
        speichern(ort, d)
        return True
