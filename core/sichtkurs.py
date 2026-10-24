"""Blickrichtung für die Übersicht nach Sichtbarkeit der Strecke (23.10.2026).

Marc: „ich will bessere Kartendarstellungen". Vorbild ist der Prototyp „GPS Studio Karten" (render.js `KULISSE`): Er
prüft 24 Richtungen, je mit Sichtstrahlen von der Kamera zu Punkten der Strecke gegen das Gelände, und nimmt die,
aus der am meisten zu sehen ist (Grand Canyon: 11 % → 100 %). Hier für die Übersicht am Anfang und Ende der
Kamerafahrt (Schnell-Video, „Fahrt neu erzeugen"): bisher schaute sie immer nach Norden — in einer tiefen Schlucht
mit Nordwand lag die Strecke dann hinter dem Berg.

Ist nichts verdeckt (flache Tour, offene Hänge), bleibt es bei Norden: Unter den Richtungen, die fast so gut sind wie
die beste (SPIELRAUM), gewinnt die mit dem kleinsten Winkel zu Norden.
"""
from __future__ import annotations

import logging
import math
from typing import Optional

import numpy as np

log = logging.getLogger("core.sichtkurs")

RICHTUNGEN = 24
SPIELRAUM = 0.03        # so viel schlechter als die beste darf eine nordnähere Richtung sein
PUNKTE = 80             # Stichproben auf der Strecke
SCHRITTE = 28           # Stützstellen je Sichtstrahl
UEBERHOEHUNG = 1.3      # etwa wie im Animator (Standard 1,5; die Übersicht wirkt eher flacher)


def _kachel(lon: float, lat: float, z: int) -> tuple:
    n = 1 << z
    x = (lon + 180.0) / 360.0 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def _mosaik(bbox, z: int, cache_dir):
    """Höhenraster über bbox (lon0, lat0, lon1, lat1) aus Terrarium-Kacheln → (Höhen, x0, y0) in Kachelpixeln."""
    from . import schatten
    x0, y1 = _kachel(bbox[0], bbox[1], z)
    x1, y0 = _kachel(bbox[2], bbox[3], z)
    tx0, tx1, ty0, ty1 = int(math.floor(x0)), int(math.floor(x1)), int(math.floor(y0)), int(math.floor(y1))
    w, h = (tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256
    feld = np.zeros((h, w), np.float32)
    for ty in range(ty0, ty1 + 1):
        for tx in range(tx0, tx1 + 1):
            t = schatten._hoehen(z, tx, ty, cache_dir)
            if t is not None:
                feld[(ty - ty0) * 256:(ty - ty0 + 1) * 256, (tx - tx0) * 256:(tx - tx0 + 1) * 256] = np.maximum(t, 0)
    return feld, tx0 * 256, ty0 * 256


def sichtkurs(linie: list, cache_dir, neigung: float = 25.0) -> Optional[dict]:
    """Beste Blickrichtung (Grad, 0 = Norden) für die Übersicht über `linie` ([[lon, lat], …]) bei `neigung`.
    → {"kurs", "sicht", "sicht_norden"} oder None (zu wenig Punkte / keine Höhen)."""
    pts = [(float(p[0]), float(p[1])) for p in (linie or []) if p and len(p) >= 2]
    if len(pts) < 2:
        return None
    lons, lats = [p[0] for p in pts], [p[1] for p in pts]
    lat0 = (min(lats) + max(lats)) / 2
    m_lon = 111320.0 * math.cos(math.radians(lat0))
    breite_m = max((max(lons) - min(lons)) * m_lon, (max(lats) - min(lats)) * 111320.0, 300.0)
    # Kamera etwa im Abstand der Einpass-Übersicht; Raster so weit, dass auch die Kamerastandorte drin liegen
    abstand = breite_m * 1.25
    rand = abstand * math.sin(math.radians(neigung)) + breite_m * 0.2
    bbox = (min(lons) - rand / m_lon, min(lats) - rand / 111320.0, max(lons) + rand / m_lon, max(lats) + rand / 111320.0)
    z = 12
    while z > 7:   # höchstens ~6×6 Kacheln
        x0, _ = _kachel(bbox[0], bbox[1], z); x1, _ = _kachel(bbox[2], bbox[3], z)
        if x1 - x0 <= 5:
            break
        z -= 1
    feld, px0, py0 = _mosaik(bbox, z, cache_dir)
    if not feld.any():
        return None
    n = 1 << z
    meter_je_px = 40075016.686 * math.cos(math.radians(lat0)) / (256 * n)

    def xy(lon, lat):
        x, y = _kachel(lon, lat, z)
        return x * 256 - px0, y * 256 - py0

    def hoehe(fx, fy):
        fx = np.clip(fx, 0, feld.shape[1] - 1.001); fy = np.clip(fy, 0, feld.shape[0] - 1.001)
        ix, iy = fx.astype(int), fy.astype(int); ax, ay = fx - ix, fy - iy
        return ((1 - ay) * ((1 - ax) * feld[iy, ix] + ax * feld[iy, ix + 1])
                + ay * ((1 - ax) * feld[iy + 1, ix] + ax * feld[iy + 1, ix + 1])) * UEBERHOEHUNG

    idx = np.linspace(0, len(pts) - 1, min(PUNKTE, len(pts))).astype(int)
    sp = np.array([xy(*pts[i]) for i in idx], np.float64)              # Strecke in Rasterpixeln
    sh = hoehe(sp[:, 0], sp[:, 1]) + 3.0                                # 3 m über Grund
    mitte = xy((min(lons) + max(lons)) / 2, lat0)
    mh = float(hoehe(np.array([mitte[0]]), np.array([mitte[1]]))[0])
    horiz_px = abstand * math.sin(math.radians(neigung)) / meter_je_px
    kam_h = mh + abstand * math.cos(math.radians(neigung))
    t = np.linspace(0.04, 0.98, SCHRITTE)[:, None]
    ergebnis = []
    for k in range(RICHTUNGEN):
        kurs = k * 360.0 / RICHTUNGEN
        # Die Kamera steht HINTER der Mitte, entgegen der Blickrichtung (y wächst nach Süden)
        kx = mitte[0] - math.sin(math.radians(kurs)) * horiz_px
        ky = mitte[1] + math.cos(math.radians(kurs)) * horiz_px
        rx = kx + (sp[:, 0][None, :] - kx) * t
        ry = ky + (sp[:, 1][None, :] - ky) * t
        rh = kam_h + (sh[None, :] - kam_h) * t
        verdeckt = (hoehe(rx, ry) > rh).any(axis=0)
        ergebnis.append((kurs, float(1.0 - verdeckt.mean())))
    beste = max(s for _, s in ergebnis)
    wahl = min((e for e in ergebnis if e[1] >= beste - SPIELRAUM), key=lambda e: min(e[0], 360 - e[0]))
    kurs = wahl[0] if wahl[0] <= 180 else wahl[0] - 360
    log.info("Sichtkurs: %.0f° (Sicht %.0f %%, nach Norden %.0f %%, Raster z%d)", kurs, wahl[1] * 100, ergebnis[0][1] * 100, z)
    return {"kurs": kurs, "sicht": round(wahl[1], 3), "sicht_norden": round(ergebnis[0][1], 3)}
