"""Geländehöhen aus AWS-Terrarium-Kacheln bei FESTER Zoomstufe — kachelunabhängig.

08.09.2026 (Marc: „im Render hüpft die Kamera in der Schlucht, in der Vorschau nicht"):
Die ruhige Kamera liest die Geländehöhe je Stützstelle bisher aus MapLibre
(`queryTerrainElevation`), also aus den Höhenkacheln, die beim Aufbau ZUFÄLLIG
geladen sind. Auf einer frischen Seite (Render) sind das grobe Übersichtskacheln,
in der warmgespielten Vorschau feine — gemessen 400–700 m Unterschied in der
Masca-Schlucht, die Kamera flog im Video entsprechend tiefer. Hier kommt die Höhe
immer aus derselben Kachelstufe, per Datei-Cache der Kachel-Weiche, in Vorschau
und Render gleich. Nur für den freien Gelände-Pfad (Terrarium); Mapbox-/MapTiler-
Gelände behält den alten Weg.
"""
from __future__ import annotations

import math
from typing import Optional

from . import tileproxy

DEM_ZOOM = 13      # ≈ 19 m/px am Äquator; Schlucht-Relief sichtbar, Track mit ~15 Kacheln abgedeckt


def _tile_xy(lng: float, lat: float, z: int) -> tuple[float, float]:
    n = 2 ** z
    lat = max(-85.05112878, min(85.05112878, float(lat)))
    x = (float(lng) + 180.0) / 360.0 * n
    y = (1.0 - math.log(math.tan(math.radians(lat)) + 1.0 / math.cos(math.radians(lat))) / math.pi) / 2.0 * n
    return x, y


def _terrarium_m(px) -> float:
    r, g, b = px[0], px[1], px[2]
    return r * 256.0 + g + b / 256.0 - 32768.0


def hoehen(points, z: int = DEM_ZOOM, cache_dir=None, clamp0: bool = True,
           laden=None) -> list[Optional[float]]:
    """Höhe (m) je [lng, lat] — bilinear aus der Terrarium-Kachel der Stufe `z`.
    Unter 0 m (Meeresboden) → 0 m wie die Kachel-Weiche. Fehlende Kachel → None.
    `laden(z, x, y)` ist der Kachel-Lader (Test-Haken), Standard tileproxy._terrarium_raw."""
    laden = laden or (lambda zz, xx, yy: tileproxy._terrarium_raw(zz, xx, yy, cache_dir))
    z = int(max(0, min(15, z)))
    n = 2 ** z
    kacheln: dict[tuple[int, int], object] = {}
    out: list[Optional[float]] = []

    def px_at(tx: int, ty: int, ix: int, iy: int):
        # Pixel (ix, iy) kann über den Kachelrand hinausragen → Nachbarkachel
        while ix < 0: ix += 256; tx -= 1
        while ix > 255: ix -= 256; tx += 1
        while iy < 0: iy += 256; ty -= 1
        while iy > 255: iy -= 256; ty += 1
        tx %= n
        if ty < 0 or ty >= n:
            return None
        key = (tx, ty)
        if key not in kacheln:
            try:
                kacheln[key] = laden(z, tx, ty)
            except Exception:       # noqa: BLE001
                kacheln[key] = None
        im = kacheln[key]
        if im is None:
            return None
        try:
            return _terrarium_m(im.getpixel((ix, iy)))
        except Exception:       # noqa: BLE001
            return None

    for p in points or []:
        try:
            lng, lat = float(p[0]), float(p[1])
        except Exception:       # noqa: BLE001
            out.append(None); continue
        fx, fy = _tile_xy(lng, lat, z)
        tx, ty = int(math.floor(fx)), int(math.floor(fy))
        px = (fx - tx) * 256.0 - 0.5
        py = (fy - ty) * 256.0 - 0.5
        x0, y0 = int(math.floor(px)), int(math.floor(py))
        ax, ay = px - x0, py - y0
        v = [px_at(tx, ty, x0, y0), px_at(tx, ty, x0 + 1, y0), px_at(tx, ty, x0, y0 + 1), px_at(tx, ty, x0 + 1, y0 + 1)]
        if any(q is None for q in v):
            gut = [q for q in v if q is not None]
            if not gut:
                out.append(None); continue
            h = sum(gut) / len(gut)
        else:
            h = (v[0] * (1 - ax) + v[1] * ax) * (1 - ay) + (v[2] * (1 - ax) + v[3] * ax) * ay
        if clamp0 and h < 0:
            h = 0.0
        out.append(round(h, 2))
    return out
