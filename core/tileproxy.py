"""Kachel-Weiche für die staatlichen Orthofotos — holt, speichert, reicht durch.

03.09.2026. Zwei Gründe, die Kacheln nicht direkt aus dem Browser zu laden:

  1. **CORS.** WebGL-Karten (MapLibre/Mapbox GL) laden Raster-Kacheln per
     `fetch()`; der Dienst muss dafür `Access-Control-Allow-Origin` senden.
     Schleswig-Holstein, Sachsen-Anhalt und Sachsen tun das nicht — die
     Vorschau blieb dort leer, obwohl die Kachel per curl kam.
  2. **Zwischenspeicher.** Vorschau und Render laden dieselben Kacheln; über
     die Weiche teilen sie sich einen Speicher (`_tilecache` im App-Support).
     MapTiler erlaubt ihn ausdrücklich, die OSM-Policy verlangt ihn.

Der lokale Media-Server der App (app.py, 127.0.0.1) beantwortet
`/tile/<region>/<z>/<x>/<y>[?t=1]` über `fetch_tile()`. `t=1` = PNG mit
Alpha (Stapel mehrerer Bundesländer). Die Adresse des Dienstes kennt nur diese
Datei — der Browser sieht nie die Original-URL.

Speicherformat je Datei: erste Zeile Content-Type, dann die Bytes — dasselbe
Format wie der Playwright-Zwischenspeicher in core/animator.py, damit beide
dieselben Dateien lesen.
"""
from __future__ import annotations

import hashlib
import logging
import math
import os
import re
import urllib.request
from pathlib import Path
from typing import Optional

from . import mapstyles as ms

_log = logging.getLogger("rzgps.tileproxy")
_UA = {"User-Agent": "ReisezoomGPSStudio (+https://reisezoom.com/gps)"}


def _bbox3857(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    n = 2 ** z
    r = 6378137.0 * math.pi
    return (x / n * 2 * r - r, r - (y + 1) / n * 2 * r, (x + 1) / n * 2 * r - r, r - y / n * 2 * r)


OVERSAMPLE_MAX = 4          # höchstens 4× (1024 px) je Kachel anfordern
TILE_OUT_PX = 512           # überabgetastete Kacheln auf diese Kantenlänge verkleinern


def oversample_factor(region: dict, z: int) -> int:
    """Wie viel größer (Faktor) eine WMS-Kachel angefordert wird, damit der
    Dienst das Mosaik der `scale_z`-Skala rendert (PNOA: sonst Farbkante)."""
    sz = region.get("scale_z")
    if not sz or not region.get("wms") or z >= sz:
        return 1
    if z < int(sz) - 2:            # z ≤ 11: selbst 4× reicht nicht mehr (gemessen), nur teuer — lassen
        return 1
    return int(min(OVERSAMPLE_MAX, 2 ** (int(sz) - z)))


def upstream_url(region: dict, z: int, x: int, y: int, transparent: bool = False) -> str:
    """Die echte Adresse einer Kachel — XYZ, TMS (y gespiegelt) oder WMS (bbox)."""
    tpl = ms.region_tiles(region, transparent=transparent)[0]
    yy = (2 ** z - 1 - y) if region.get("scheme") == "tms" else y
    u = tpl.replace("{z}", str(z)).replace("{x}", str(x)).replace("{y}", str(yy))
    if "{bbox-epsg-3857}" in u:
        u = u.replace("{bbox-epsg-3857}", ",".join(f"{c:.3f}" for c in _bbox3857(z, x, y)))
    f = oversample_factor(region, z)
    if f > 1:
        u = u.replace("WIDTH=256&HEIGHT=256", f"WIDTH={256 * f}&HEIGHT={256 * f}")
    return u


def wms_oversample_url(url: str):
    """Für den Render ohne Weiche (Playwright-Route): WMS-Adresse aus dem Stil
    → (ggf. vergrößerte Adresse, Faktor). Zoom aus der BBOX-Breite."""
    if "SERVICE=WMS" not in url or "WIDTH=256&HEIGHT=256" not in url:
        return url, 1
    region = next((r for r in ms.ORTHO_REGIONS if r.get("wms") and url.startswith(r["wms"]["base"])), None)
    if region is None or not region.get("scale_z"):
        return url, 1
    m = re.search(r"BBOX=([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)", url)
    if not m:
        return url, 1
    w = abs(float(m.group(3)) - float(m.group(1)))
    if w <= 0:
        return url, 1
    z = int(round(math.log2(2 * 6378137.0 * math.pi / w)))
    f = oversample_factor(region, z)
    if f <= 1:
        return url, 1
    return url.replace("WIDTH=256&HEIGHT=256", f"WIDTH={256 * f}&HEIGHT={256 * f}"), f


def downscale_tile(body: bytes, ct: str, size: int = TILE_OUT_PX) -> tuple[bytes, str]:
    """Überabgetastete Kachel auf `size` px verkleinern (PNG bleibt PNG mit Alpha)."""
    try:
        from io import BytesIO
        from PIL import Image
        im = Image.open(BytesIO(body))
        if max(im.size) <= size:
            return body, ct
        im = im.convert("RGBA" if "png" in ct else "RGB")
        im = im.resize((size, size), Image.LANCZOS)
        out = BytesIO()
        if "png" in ct:
            im.save(out, format="PNG", compress_level=3); return out.getvalue(), "image/png"
        im.save(out, format="JPEG", quality=88); return out.getvalue(), "image/jpeg"
    except Exception as e:      # noqa: BLE001
        _log.debug("downscale_tile: %s", e)
        return body, ct


def cache_path(cache_dir: Path, url: str) -> Path:
    h = hashlib.sha1(url.encode("utf-8")).hexdigest()
    return cache_dir / h[:2] / (h + ".bin")


TERRARIUM_HOST = "elevation-tiles-prod/terrarium"
CLAMP_KEY_SUFFIX = "#clamp0"     # eigener Schlüssel: alte, ungeklemmte Kacheln bleiben liegen


def is_terrarium_url(url: str) -> bool:
    return TERRARIUM_HOST in url


def clamp_terrarium(body: bytes) -> bytes:
    """Terrarium-PNG: Höhe = R·256 + G + B/256 − 32768. Alles unter 0 m
    (R < 128, also Meeresboden) wird auf genau 0 m gesetzt (128,0,0) — sonst
    steht an jeder Küste eine Klippe bis zum Meeresgrund. Bei Fehlern
    kommt die Kachel unverändert zurück."""
    try:
        from io import BytesIO
        from PIL import Image
        im = Image.open(BytesIO(body)).convert("RGB")
        r = im.split()[0]
        mask = r.point(lambda v: 255 if v < 128 else 0)
        if not mask.getbbox():
            return body
        im.paste((128, 0, 0), mask=mask)
        out = BytesIO(); im.save(out, format="PNG", compress_level=1)
        return out.getvalue()
    except Exception as e:      # noqa: BLE001
        _log.debug("clamp_terrarium: %s", e)
        return body


SEA_MASK_DEPTH = -3.0      # tiefer als 3 m = Meer (Küsten-Rauschen im DEM bleibt Land)
# Meerestiefen stecken in AWS-Terrarium nur bis z10 (darüber ist das Meer 0 m,
# 04.09.2026 gemessen) → Maske immer aus der z10-Kachel (≈150 m/px) schneiden.
_TERRAIN_RAW_MAX_Z = 10
SEA_MASK_MAX_Z = 18        # alle Kacheln gleich behandeln — sonst Stufen zwischen den Zoomstufen


def _terrarium_raw(z: int, x: int, y: int, cache_dir, timeout: float = 30.0):
    """UNgeklemmte Terrarium-Kachel als PIL-RGB (oder None). Eigener Cache-Schlüssel."""
    from io import BytesIO
    from PIL import Image
    from . import net
    url = ms.TERRAIN["aws"]["tiles"][0].replace("{z}", str(z)).replace("{x}", str(x)).replace("{y}", str(y))
    cp = cache_path(Path(cache_dir), url + "#raw") if cache_dir else None
    body = None
    if cp is not None and cp.exists():
        try:
            raw = cp.read_bytes(); body = raw[raw.index(b"\n") + 1:]
        except Exception:
            body = None
    if body is None:
        try:
            req = urllib.request.Request(url, headers=_UA)
            with urllib.request.urlopen(req, timeout=timeout, context=net.ssl_context()) as resp:
                body = resp.read()
        except Exception as e:      # noqa: BLE001
            _log.debug("terrarium raw %d/%d/%d: %s", z, x, y, e)
            return None
        if cp is not None:
            try:
                cp.parent.mkdir(parents=True, exist_ok=True)
                tmp = cp.with_name(cp.name + f".{os.getpid()}.tmp"); tmp.write_bytes(b"image/png\n" + body); os.replace(tmp, cp)
            except OSError:
                pass
    try:
        return Image.open(BytesIO(body)).convert("RGB")
    except Exception:
        return None


def sea_mask_for(z: int, x: int, y: int, size: int, cache_dir):
    """PIL-L-Maske (255 = Land/behalten, 0 = Meer) in `size`×`size` für die
    Kachel z/x/y — aus der Terrarium-Kachel derselben Lage (bei z > 15 aus der
    Elternkachel ausgeschnitten). None, wenn keine Höhendaten kommen.
    Höhe = R·256 + G + B/256 − 32768; Meer (< −3 m) ⇔ R < 127 oder (R == 127 und G < 253)."""
    from PIL import Image
    zz, xx, yy, crop = z, x, y, None
    if z > _TERRAIN_RAW_MAX_Z:
        d = z - _TERRAIN_RAW_MAX_Z
        zz, xx, yy = _TERRAIN_RAW_MAX_Z, x >> d, y >> d
        n = 1 << d; sub = 256 // n
        crop = ((x % n) * sub, (y % n) * sub, (x % n) * sub + sub, (y % n) * sub + sub)
    im = _terrarium_raw(zz, xx, yy, cache_dir)
    if im is None:
        return None
    if crop:
        im = im.crop(crop)
    r, g, _b = im.split()
    land_r = r.point(lambda v: 255 if v >= 128 else 0)                 # R ≥ 128: sicher Land
    edge_r = r.point(lambda v: 255 if v == 127 else 0)                 # R == 127: −256…−1 m
    land_g = g.point(lambda v: 255 if v >= 253 else 0)                 # davon ≥ −3 m: Land
    from PIL import ImageChops
    mask = ImageChops.lighter(land_r, ImageChops.multiply(edge_r, land_g))
    if mask.size != (size, size):
        mask = mask.resize((size, size), Image.BILINEAR)
    return mask


def apply_sea_mask(body: bytes, ct: str, z: int, x: int, y: int, cache_dir) -> tuple[bytes, str]:
    """Orthofoto-Kachel: Meerpixel durchsichtig machen (PNG mit Alpha)."""
    try:
        from io import BytesIO
        from PIL import Image, ImageChops
        im = Image.open(BytesIO(body)).convert("RGBA")
        mask = sea_mask_for(z, x, y, im.size[0], cache_dir)
        if mask is None or mask.getextrema() == (255, 255):
            return body, ct                       # keine Höhendaten / kein Meer in dieser Kachel
        im.putalpha(ImageChops.multiply(im.split()[3], mask))
        out = BytesIO(); im.save(out, format="PNG", compress_level=3)
        return out.getvalue(), "image/png"
    except Exception as e:      # noqa: BLE001
        _log.debug("apply_sea_mask: %s", e)
        return body, ct


def fetch_tile(region_id: str, z: int, x: int, y: int, transparent: bool,
               cache_dir: Optional[Path], timeout: float = 30.0) -> tuple[int, str, bytes]:
    """(status, content_type, body). 404 bei unbekannter Region, 502 wenn der
    Dienst nicht antwortet. Erfolgreiche Bilder landen im Zwischenspeicher.
    `terrain-aws` = AWS-Terrarium mit Klemme (Meerestiefen → 0 m)."""
    if z < 0 or z > 22:
        return 404, "text/plain", b"bad zoom"
    terrain = region_id == ms.TERRAIN_AWS_PROXY_ID
    region = None
    if terrain:
        url = ms.TERRAIN["aws"]["tiles"][0].replace("{z}", str(z)).replace("{x}", str(x)).replace("{y}", str(y))
    else:
        region = next((r for r in ms.ORTHO_REGIONS if r["id"] == region_id), None)
        if region is None:
            return 404, "text/plain", b"unknown region"
        url = upstream_url(region, z, x, y, transparent)
    _suffix = CLAMP_KEY_SUFFIX if terrain else ("#sea1" if (region is not None and region.get("sea_mask") and z <= SEA_MASK_MAX_Z) else "")
    cp = cache_path(Path(cache_dir), url + _suffix) if cache_dir else None   # eigener Schlüssel je Nachbearbeitung
    if cp is not None and cp.exists():
        try:
            raw = cp.read_bytes()
            nl = raw.index(b"\n")
            return 200, raw[:nl].decode("ascii", "ignore") or "image/jpeg", raw[nl + 1:]
        except Exception:
            pass
    from . import net
    body = b""; ct = ""; fehler = None
    for versuch in range(2):                    # 04.09.2026: einmal wiederholen — unter Last kippten einzelne AWS-Kacheln mit 502
        try:
            req = urllib.request.Request(url, headers=_UA)
            with urllib.request.urlopen(req, timeout=timeout, context=net.ssl_context()) as resp:
                ct = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower()
                body = resp.read()
            fehler = None
            break
        except Exception as e:      # noqa: BLE001
            fehler = e
    if fehler is not None:
        _log.warning("Kachel %s z%d/%d/%d: %s", region_id, z, x, y, fehler)
        return 502, "text/plain", str(fehler).encode("utf-8", "ignore")
    if not ct.startswith("image/"):
        # WMS-Fehler kommen als XML mit Status 200 — nicht als Bild ausliefern
        return 502, "text/plain", body[:400]
    if terrain:
        body = clamp_terrarium(body)
    elif region is not None:
        if oversample_factor(region, z) > 1:
            body, ct = downscale_tile(body, ct)
        if region.get("sea_mask") and z <= SEA_MASK_MAX_Z:
            body, ct = apply_sea_mask(body, ct, z, x, y, cache_dir)
    if cp is not None and len(body) < 8_000_000:
        try:
            cp.parent.mkdir(parents=True, exist_ok=True)
            tmp = cp.with_name(cp.name + f".{os.getpid()}.tmp")
            tmp.write_bytes(ct.encode("ascii", "ignore") + b"\n" + body)
            os.replace(tmp, cp)
        except OSError as e:
            _log.debug("Zwischenspeicher: %s", e)
    return 200, ct, body


def parse_request_path(path: str) -> Optional[tuple[str, int, int, int, bool]]:
    """`/tile/<region>/<z>/<x>/<y>[?t=1]` → (region, z, x, y, transparent) oder None."""
    p, _, q = path.partition("?")
    parts = p.strip("/").split("/")
    if len(parts) != 5 or parts[0] != "tile":
        return None
    try:
        z, x, y = int(parts[2]), int(parts[3]), int(parts[4])
    except ValueError:
        return None
    transparent = "t=1" in q.split("&")
    return parts[1], z, x, y, transparent
