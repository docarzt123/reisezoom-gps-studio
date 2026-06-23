"""
Sonnenstand + Blickrichtung (v0.9.333) — die EINE Quelle der Wahrheit fürs
„Lichtstempel"-Gimmick im Geotagger. Reine Mathematik, keine Abhängigkeiten.

Das Web-Tool (gps-studio.reisezoom.com) spiegelt diese Logik in JS (SunCalc) —
hier ist die kanonische App-First-Variante (Python).

- `sun_position(dt_utc, lat, lon)` → (Höhe°, Azimut°), Azimut 0=N, im Uhrzeigersinn.
- `light_phase(alt_deg)` → Lichtphasen-Key (noon/day/golden/blue/dusk/night).
- `bearing(lat1, lon1, lat2, lon2)` → Kompass-Kurs in Grad (0=N).
- `light_vs_dir(sun_az, cam_dir)` → "back" (Gegenlicht) | "side" | "front".
- `compass8_index(deg)` → 0..7 (N, NO, O, …) für lokalisierte Labels.
"""
from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Optional, Tuple

_RAD = math.pi / 180.0


def _days_since_j2000(dt_utc: datetime) -> float:
    if dt_utc.tzinfo is None:
        dt_utc = dt_utc.replace(tzinfo=timezone.utc)
    # Julianisches Datum − J2000. timestamp() ist UTC-basiert.
    return dt_utc.timestamp() / 86400.0 + 2440587.5 - 2451545.0


def sun_position(dt_utc: datetime, lat: float, lon: float) -> Tuple[float, float]:
    """Sonnenhöhe (über Horizont, Grad) + Azimut (0=Nord, im Uhrzeigersinn, Grad).
    Portierung des SunCalc-Algorithmus (gleiche Konvention wie das Web-Tool)."""
    J = _days_since_j2000(dt_utc)
    M = (357.5291 + 0.98560028 * J) * _RAD                       # mittlere Anomalie
    C = (1.9148 * math.sin(M) + 0.02 * math.sin(2 * M)
         + 0.0003 * math.sin(3 * M)) * _RAD                       # Mittelpunktsgleichung
    L = M + C + 102.9372 * _RAD + math.pi                        # ekliptikale Länge
    e = 23.4397 * _RAD                                            # Schiefe der Ekliptik
    dec = math.asin(math.sin(L) * math.sin(e))                   # Deklination
    ra = math.atan2(math.sin(L) * math.cos(e), math.cos(L))      # Rektaszension
    lw = -lon * _RAD
    phi = lat * _RAD
    theta = (280.16 + 360.9856235 * J) * _RAD - lw               # Sternzeit
    H = theta - ra                                               # Stundenwinkel
    alt = math.asin(math.sin(phi) * math.sin(dec)
                    + math.cos(phi) * math.cos(dec) * math.cos(H))
    az = math.atan2(math.sin(H), math.cos(H) * math.sin(phi)
                    - math.tan(dec) * math.cos(phi))             # von Süden (SunCalc)
    az_compass = (az / _RAD + 180.0) % 360.0                     # → von Norden
    return (alt / _RAD, az_compass)


def light_phase(alt_deg: float) -> str:
    """Lichtphasen-Key aus der Sonnenhöhe (gleiche Schwellen wie im Web-Tool)."""
    if alt_deg >= 50:
        return "noon"
    if alt_deg >= 6:
        return "day"
    if alt_deg >= -4:
        return "golden"
    if alt_deg >= -6:
        return "blue"
    if alt_deg >= -18:
        return "dusk"
    return "night"


def bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Anfangskurs von Punkt 1 → Punkt 2 in Grad (0=N, im Uhrzeigersinn)."""
    la1, la2 = lat1 * _RAD, lat2 * _RAD
    dl = (lon2 - lon1) * _RAD
    y = math.sin(dl) * math.cos(la2)
    x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(dl)
    return (math.atan2(y, x) / _RAD + 360.0) % 360.0


def light_vs_dir(sun_az: float, cam_dir: float) -> str:
    """Verhältnis Kamerarichtung ↔ Sonne: 'back' (Gegenlicht), 'side', 'front' (Sonne im Rücken)."""
    d = abs(((sun_az - cam_dir + 540.0) % 360.0) - 180.0)
    if d <= 45:
        return "back"
    if d >= 135:
        return "front"
    return "side"


def compass8_index(deg: Optional[float]) -> Optional[int]:
    """0..7 für N, NO, O, SO, S, SW, W, NW (Labels lokalisiert das Frontend)."""
    if deg is None:
        return None
    return int(round((deg % 360.0) / 45.0)) % 8
