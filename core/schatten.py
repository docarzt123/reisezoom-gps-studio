"""Schlagschatten aus dem Höhenmodell als Kachelebene (23.10.2026).

Marc: „ich will bessere Kartendarstellungen". Vorbild ist der Prototyp „GPS Studio Karten" (tools/region.py
`schatten()`): ein Sonnenstrahl läuft über das Höhenraster; wo das Gelände in Richtung Sonne höher liegt als der
Strahl, liegt der Punkt im Schatten. Das gibt Luftbildern Plastik, die eine Schummerung (Hillshade) allein nicht
hat — Grate werfen lange Schatten in die Täler.

Die Kachel-Weiche liefert `/tile/schatten/{z}/{x}/{y}`: ein durchsichtiges PNG, dunkel-kühl getönt, Deckkraft =
Schattenanteil. Die Karte legt es über die Luftbilder (Stärke = Ebenen-Deckkraft, Regler „Schatten").

- Sonne Süd-Südost 155°, 48° hoch — passt zu den Schatten in Mittags-Luftbildern (wie im Prototyp).
- Höhen aus derselben Quelle wie das 3D-Gelände (Mapterhorn, sonst AWS) über `tileproxy.fetch_tile`.
- Rechnet je Kachel mit den acht Nachbarn (Schatten reichen bis `REICHWEITE_M` über die Kachelgrenze).
- Über `MAX_Z` wird die Elternkachel gerechnet und vergrößert, unter `MIN_Z` gibt es keine Schatten.
- Ergebnis im Zwischenspeicher (`<cache>/schatten/<version>/z/x/y.png`), Version im Pfad.
"""
from __future__ import annotations

import logging
import math
from io import BytesIO
from pathlib import Path
from typing import Optional

import numpy as np

log = logging.getLogger("core.schatten")

SONNE_AZ, SONNE_EL = 155.0, 48.0
REICHWEITE_M = 2500.0
WEICH_M = 6.0
MIN_Z, MAX_Z = 8, 14
FARBE = (22, 28, 48)          # dunkel, leicht blau — Schatten unter klarem Himmel
VERSION = "s1"
GROESSE = 256

_LEER: Optional[bytes] = None


def _png(rgba: np.ndarray) -> bytes:
    from PIL import Image
    b = BytesIO()
    Image.fromarray(rgba, "RGBA").save(b, "PNG", optimize=False, compress_level=3)
    return b.getvalue()


def leer() -> bytes:
    global _LEER
    if _LEER is None:
        _LEER = _png(np.zeros((GROESSE, GROESSE, 4), np.uint8))
    return _LEER


def _hoehen(z: int, x: int, y: int, cache_dir) -> Optional[np.ndarray]:
    """Terrarium-Kachel der Geländequelle → Höhen in Metern (256×256) oder None."""
    from PIL import Image
    from . import mapstyles as ms, tileproxy as tp
    n = 1 << z
    if not (0 <= y < n):
        return None
    st, _ct, body = tp.fetch_tile(ms.TERRAIN_AWS_PROXY_ID, z, x % n, y, False, cache_dir)
    if st != 200 or not body:
        return None
    try:
        a = np.asarray(Image.open(BytesIO(body)).convert("RGB"), np.float32)
    except Exception:  # noqa: BLE001
        return None
    if a.shape[0] != GROESSE:
        from PIL import Image as I
        a = np.asarray(I.fromarray(a.astype(np.uint8)).resize((GROESSE, GROESSE), I.BILINEAR), np.float32)
    return a[..., 0] * 256.0 + a[..., 1] + a[..., 2] / 256.0 - 32768.0


def _verschieben(a: np.ndarray, dy: float, dx: float) -> np.ndarray:
    """a um (dy, dx) Pixel verschieben, bilinear, Rand = nächster Wert (wie ndimage.shift mode=nearest)."""
    h, w = a.shape
    iy, ix = int(math.floor(dy)), int(math.floor(dx))
    fy, fx = dy - iy, dx - ix
    ys = np.clip(np.arange(h) - iy, 0, h - 1)
    ys1 = np.clip(np.arange(h) - iy - 1, 0, h - 1)
    xs = np.clip(np.arange(w) - ix, 0, w - 1)
    xs1 = np.clip(np.arange(w) - ix - 1, 0, w - 1)
    return ((1 - fy) * ((1 - fx) * a[ys][:, xs] + fx * a[ys][:, xs1])
            + fy * ((1 - fx) * a[ys1][:, xs] + fx * a[ys1][:, xs1]))


def schatten_feld(h: np.ndarray, pixel_m: float, az: float = SONNE_AZ, el: float = SONNE_EL,
                  max_m: float = REICHWEITE_M) -> np.ndarray:
    """Schattenanteil 0…1 je Pixel (1 = im Schatten). h: Höhen (Zeilen Nord→Süd), pixel_m: Bodenmeter je Pixel."""
    dx = math.sin(math.radians(az))
    dy = -math.cos(math.radians(az))        # Richtung ZUR Sonne in Pixeln (y nach unten = Süden)
    tanel = math.tan(math.radians(el))
    land = np.maximum(h, 0).astype(np.float32)
    s = np.zeros_like(land)
    d = 1.0
    while d * pixel_m < max_m:
        # Höhe des Geländes d Pixel in Richtung Sonne, verglichen mit dem Strahl über dem Punkt
        weiter = _verschieben(land, -dy * d, -dx * d)
        np.maximum(s, np.clip((weiter - (land + d * pixel_m * tanel)) / WEICH_M, 0, 1), out=s)
        d = d + max(1.0, d * 0.06)
    return s


def schatten_mitte(h: np.ndarray, rand: int, pixel_m: float, az: float = SONNE_AZ, el: float = SONNE_EL,
                   max_m: float = REICHWEITE_M) -> np.ndarray:
    """Wie `schatten_feld`, aber nur für die Mitte von `h` (je Seite `rand` Pixel Nachbarschaft weg).

    25.10.2026 (volle Suite: Render mit Schatten wartete bis 4 s je Bild, ohne 0,4 s) — `schatten_feld` rechnete das ganze
    3×3-Kachel-Raster (768², ~60 Schritte mit Index-Kopien), gebraucht wird nur die mittlere Kachel. Hier: Ausschnitte
    statt Kopien, nur 256² je Schritt. Gleiches Ergebnis innerhalb der Mitte (bilinear, Abtastung in Richtung Sonne)."""
    dx = math.sin(math.radians(az))
    dy = -math.cos(math.radians(az))
    tanel = math.tan(math.radians(el))
    land = np.pad(np.maximum(h, 0).astype(np.float32), 1, mode="edge")
    H, W = h.shape
    ho, br = H - 2 * rand, W - 2 * rand
    y0 = x0 = rand + 1                     # Mitte im gepolsterten Raster
    mitte = land[y0:y0 + ho, x0:x0 + br]
    s = np.zeros((ho, br), np.float32)
    grenze = max(0, min(rand, (max_m / pixel_m) if pixel_m > 0 else 0))
    d = 1.0
    while d * pixel_m < max_m and d < grenze:
        oy, ox = dy * d, dx * d            # Abtastpunkt in Richtung Sonne
        iy, ix = int(math.floor(oy)), int(math.floor(ox))
        fy, fx = oy - iy, ox - ix
        a = land[y0 + iy:y0 + iy + ho, x0 + ix:x0 + ix + br]
        b = land[y0 + iy:y0 + iy + ho, x0 + ix + 1:x0 + ix + 1 + br]
        c = land[y0 + iy + 1:y0 + iy + 1 + ho, x0 + ix:x0 + ix + br]
        e = land[y0 + iy + 1:y0 + iy + 1 + ho, x0 + ix + 1:x0 + ix + 1 + br]
        weiter = (1 - fy) * ((1 - fx) * a + fx * b) + fy * ((1 - fx) * c + fx * e)
        np.maximum(s, np.clip((weiter - (mitte + d * pixel_m * tanel)) / WEICH_M, 0, 1), out=s)
        d = d + max(1.0, d * 0.06)
    return s


def _pixel_m(z: int, y: int) -> float:
    n = 1 << z
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 0.5) / n))))
    return 40075016.686 * math.cos(math.radians(lat)) / (GROESSE * n)


def _rechnen(z: int, x: int, y: int, cache_dir) -> Optional[np.ndarray]:
    """Schattenfeld der Kachel z/x/y (256×256) aus ihr und den acht Nachbarn; None ohne Höhen."""
    mitte = _hoehen(z, x, y, cache_dir)
    if mitte is None:
        return None
    gross = np.empty((3 * GROESSE, 3 * GROESSE), np.float32)
    for j in (-1, 0, 1):
        for i in (-1, 0, 1):
            t = mitte if (i, j) == (0, 0) else _hoehen(z, x + i, y + j, cache_dir)
            if t is None:
                t = mitte   # Rand der Welt / fehlende Kachel: Mitte wiederholen (wirft keinen falschen Schatten)
            gross[(j + 1) * GROESSE:(j + 2) * GROESSE, (i + 1) * GROESSE:(i + 2) * GROESSE] = t
    return schatten_mitte(gross, GROESSE, _pixel_m(z, y), max_m=min(REICHWEITE_M, GROESSE * _pixel_m(z, y)))


def kachel(z: int, x: int, y: int, cache_dir) -> bytes:
    """PNG der Schattenkachel (durchsichtig, wo kein Schatten)."""
    if z < MIN_Z:
        return leer()
    pfad = Path(cache_dir) / "schatten" / VERSION / str(z) / str(x) / f"{y}.png" if cache_dir else None
    if pfad is not None and pfad.exists():
        try:
            return pfad.read_bytes()
        except OSError:
            pass
    zr = min(z, MAX_Z)
    k = 1 << (z - zr)
    feld = _rechnen(zr, x // k, y // k, cache_dir)
    if feld is None:
        return leer()        # ohne Höhen nicht merken: beim nächsten Mal neu versuchen
    if k > 1:
        from PIL import Image
        ox, oy = (x % k) * GROESSE // k, (y % k) * GROESSE // k
        teil = feld[oy:oy + GROESSE // k, ox:ox + GROESSE // k]
        feld = np.asarray(Image.fromarray((teil * 255).astype(np.uint8)).resize((GROESSE, GROESSE), Image.BILINEAR),
                          np.float32) / 255.0
    rgba = np.zeros((GROESSE, GROESSE, 4), np.uint8)
    rgba[..., 0], rgba[..., 1], rgba[..., 2] = FARBE
    rgba[..., 3] = np.clip(feld * 255.0, 0, 255).astype(np.uint8)
    body = _png(rgba)
    if pfad is not None:
        try:
            from . import dateischutz as _ds
            pfad.parent.mkdir(parents=True, exist_ok=True)
            tmp = pfad.with_name(pfad.name + ".tmp")
            tmp.write_bytes(body)
            _ds.ersetzen(tmp, pfad, "kachel", art=_ds.ART_CACHE)
        except Exception:  # noqa: BLE001
            pass
    return body
