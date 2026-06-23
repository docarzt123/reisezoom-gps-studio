"""
Sensor-Feld-Registry — Single Source of Truth für Zusatzdaten pro Trackpunkt
(FIT-Sensoren, GPX-Extensions). Phase 1 der FIT-Daten-Power (IDEAS §15.2).

Begriffe:
  - **kanonischer Key** (z. B. "hr", "power"): interner Name eines Sensorfeldes.
    Liegt pro Trackpunkt in `TrackPoint.extra[key]`.
  - **Sidecar**: `<cache>.sensors.json` neben der (Cache-)GPX, hält ALLE
    Sensorreihen index-gleich zu den GPX-Punkten (Variante B — siehe IDEAS §15).
  - **Standard-Extensions**: gpxtpx/gpxpx — die einzigen Felder, die ein GPX
    nativ tragen kann. Werden beim Import gelesen + beim Export geschrieben.

Geometrie (lat/lon/ele/time) + abgeleitete Werte (Distanz, Tempo, Steigung,
Auf-/Abstieg) gehören NICHT hierher — die rechnen wir selbst aus dem Track.
Hier stehen nur „echte" Zusatz-Messwerte.
"""
from __future__ import annotations

from typing import Optional

# ── kanonischer Key → (Label DE, Einheit) ────────────────────────────────────
# Unbekannte Keys (Hersteller-/Developer-Felder) bekommen Label=Key, Einheit="".
FIELD_META: dict[str, tuple[str, str]] = {
    "hr":           ("Herzfrequenz",   "bpm"),
    "cadence":      ("Trittfrequenz",  "rpm"),
    "temperature":  ("Temperatur",     "°C"),
    "power":        ("Leistung",       "W"),
    "respiration":  ("Atemfrequenz",   "1/min"),
    "core_temp":    ("Körpertemp.",    "°C"),
    # E-Bike (Feldnamen je nach Hersteller; häufige fitdecode-Namen):
    "battery_soc":  ("Akku",           "%"),
    "assist":       ("Unterstützung",  "%"),
    "motor_power":  ("Motor-Leistung", "W"),
    # v0.9.334 — gängige Suunto/Garmin-Developer-Felder lesbar machen (Nutzer-
    # Feedback: „GRD_PCT/NGP versteht keiner"). Pro Projekt umbenennbar (Override).
    "grd_pct":         ("Steigung",            "%"),
    "ngp":             ("Norm. Graded Pace",   ""),
    "vertical_speed":  ("Vertikaltempo",       "m/s"),
    "stance_time":     ("Bodenkontaktzeit",    "ms"),
    "step_length":     ("Schrittlänge",        "mm"),
    "vertical_oscillation": ("Vertikale Bewegung", "cm"),
    "saturated_hemoglobin_percent": ("SpO₂",   "%"),
}

# ── FIT-record-Feldname → kanonischer Key ────────────────────────────────────
# Bewusst NICHT gemappt: speed/distance/altitude/grade — die leiten wir selbst
# ab (kein Doppeln). Unbekannte numerische FIT-Felder werden mit ihrem Rohnamen
# als Key durchgereicht (siehe imports._fit_extra).
FIT_FIELD_MAP: dict[str, str] = {
    "heart_rate":      "hr",
    "cadence":         "cadence",
    "temperature":     "temperature",
    "power":           "power",
    "respiration_rate": "respiration",
    "core_temperature": "core_temp",
    "battery_soc":     "battery_soc",
    "assist":          "assist",
}

# FIT-Felder, die wir NIE als Sensor übernehmen (Geometrie/abgeleitet/intern).
FIT_SKIP = {
    "position_lat", "position_long", "altitude", "enhanced_altitude",
    "distance", "speed", "enhanced_speed", "grade", "timestamp",
    "gps_accuracy", "compressed_speed_distance", "cycles", "total_cycles",
    "fractional_cadence", "accumulated_power", "left_right_balance",
}

# ── GPX-Standard-Extensions ──────────────────────────────────────────────────
# kanonischer Key → ("gpxtpx", <localname>) ODER ("power", None) für Stravas
# <power>-Element direkt unter <extensions>. Nur diese Felder kann GPX nativ.
GPX_EXPORT: dict[str, tuple[str, Optional[str]]] = {
    "hr":          ("gpxtpx", "hr"),
    "cadence":     ("gpxtpx", "cad"),
    "temperature": ("gpxtpx", "atemp"),
    "power":       ("power", None),
}

# Beim IMPORT: gpxtpx-localname (lowercase) → kanonischer Key.
GPXTPX_READ: dict[str, str] = {
    "hr": "hr",
    "cad": "cadence",
    "atemp": "temperature",
    "cadence": "cadence",
    "heartrate": "hr",
}

GPXTPX_NS = "http://www.garmin.com/xmlschemas/TrackPointExtension/v1"
GPXPX_NS = "http://www.garmin.com/xmlschemas/PowerExtension/v1"


def field_meta(key: str) -> tuple[str, str]:
    """(Label, Einheit) für einen Key; Fallback: (Key, "") für Unbekanntes."""
    return FIELD_META.get(key, (key, ""))


def field_meta_ov(key: str, overrides=None) -> tuple[str, str]:
    """Wie field_meta, aber projekt-eigene Overrides haben Vorrang. `overrides`
    ist ein dict `{key: {"label": str, "unit": str}}` (v0.9.334, Nutzer-Wunsch:
    GRD_PCT→„Steigung", Trittfrequenz→„Schrittfrequenz/spm", Knoten beim Segeln …)."""
    lbl, unit = field_meta(key)
    if overrides:
        o = overrides.get(key)
        if isinstance(o, dict):
            if o.get("label"):
                lbl = str(o["label"])
            if o.get("unit") is not None:
                unit = str(o["unit"])
    return lbl, unit


def describe_fields(keys) -> list[dict]:
    """Liste [{key,label,unit}] für eine Menge vorhandener Keys (sortiert:
    bekannte zuerst in Registry-Reihenfolge, dann unbekannte alphabetisch)."""
    keys = set(keys)
    out = []
    for k in FIELD_META:
        if k in keys:
            lbl, unit = FIELD_META[k]
            out.append({"key": k, "label": lbl, "unit": unit})
            keys.discard(k)
    for k in sorted(keys):
        out.append({"key": k, "label": k, "unit": ""})
    return out
