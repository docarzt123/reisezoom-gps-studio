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


def upstream_url(region: dict, z: int, x: int, y: int, transparent: bool = False) -> str:
    """Die echte Adresse einer Kachel — XYZ, TMS (y gespiegelt) oder WMS (bbox)."""
    tpl = ms.region_tiles(region, transparent=transparent)[0]
    yy = (2 ** z - 1 - y) if region.get("scheme") == "tms" else y
    u = tpl.replace("{z}", str(z)).replace("{x}", str(x)).replace("{y}", str(yy))
    if "{bbox-epsg-3857}" in u:
        u = u.replace("{bbox-epsg-3857}", ",".join(f"{c:.3f}" for c in _bbox3857(z, x, y)))
    return u


def cache_path(cache_dir: Path, url: str) -> Path:
    h = hashlib.sha1(url.encode("utf-8")).hexdigest()
    return cache_dir / h[:2] / (h + ".bin")


def fetch_tile(region_id: str, z: int, x: int, y: int, transparent: bool,
               cache_dir: Optional[Path], timeout: float = 30.0) -> tuple[int, str, bytes]:
    """(status, content_type, body). 404 bei unbekannter Region, 502 wenn der
    Dienst nicht antwortet. Erfolgreiche Bilder landen im Zwischenspeicher."""
    region = next((r for r in ms.ORTHO_REGIONS if r["id"] == region_id), None)
    if region is None or z < 0 or z > 22:
        return 404, "text/plain", b"unknown region"
    url = upstream_url(region, z, x, y, transparent)
    cp = cache_path(Path(cache_dir), url) if cache_dir else None
    if cp is not None and cp.exists():
        try:
            raw = cp.read_bytes()
            nl = raw.index(b"\n")
            return 200, raw[:nl].decode("ascii", "ignore") or "image/jpeg", raw[nl + 1:]
        except Exception:
            pass
    try:
        from . import net
        req = urllib.request.Request(url, headers=_UA)
        with urllib.request.urlopen(req, timeout=timeout, context=net.ssl_context()) as resp:
            ct = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            body = resp.read()
    except Exception as e:
        _log.warning("Kachel %s z%d/%d/%d: %s", region_id, z, x, y, e)
        return 502, "text/plain", str(e).encode("utf-8", "ignore")
    if not ct.startswith("image/"):
        # WMS-Fehler kommen als XML mit Status 200 — nicht als Bild ausliefern
        return 502, "text/plain", body[:400]
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
