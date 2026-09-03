#!/usr/bin/env python3
"""Kartenquellen anklopfen — liefert jede Orthofoto-Region und jedes Gelände noch?

03.09.2026. Staatliche Dienste ziehen um, benennen Layer um oder stellen auf
Registrierung um (Hamburg tat genau das). Dieses Skript holt je Quelle EINE
Kachel an einem Punkt mitten in der Region (z14), prüft, dass ein Bild kommt
und dass es nicht einfarbig ist. Netz nötig; darum kein Teil der Testreihe.

Aufruf:
    .venv/bin/python scripts/check_map_sources.py            # alle
    .venv/bin/python scripts/check_map_sources.py de-by es   # nur diese
    .venv/bin/python scripts/check_map_sources.py --maptiler # auch MapTiler (Schlüssel aus den Einstellungen)

Exit 0 = alles liefert, 1 = mindestens eine Quelle nicht.
"""
from __future__ import annotations

import concurrent.futures as cf
import io
import json
import math
import ssl
import sys
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
from core import mapstyles as ms  # noqa: E402

try:
    from PIL import Image, ImageStat
except ImportError:  # pragma: no cover
    Image = None

CTX = ssl.create_default_context()
UA = {"User-Agent": "ReisezoomGPSStudio/check_map_sources"}


def _xyz(lon, lat, z):
    n = 2 ** z
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n)
    return x, y


def _bbox3857(x, y, z):
    n = 2 ** z
    r = 6378137 * math.pi
    return (x / n * 2 * r - r, r - (y + 1) / n * 2 * r, (x + 1) / n * 2 * r - r, r - y / n * 2 * r)


def _url(template, lon, lat, z, scheme="xyz"):
    x, y = _xyz(lon, lat, z)
    if scheme == "tms":
        y = 2 ** z - 1 - y
    u = template.replace("{z}", str(z)).replace("{x}", str(x)).replace("{y}", str(y))
    if "{bbox-epsg-3857}" in u:
        u = u.replace("{bbox-epsg-3857}", ",".join(f"{c:.3f}" for c in _bbox3857(*_xyz(lon, lat, z), z)))
    return u


def _fetch(u, timeout=40):
    req = urllib.request.Request(u, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
            return r.status, r.headers.get("Content-Type", ""), r.read()
    except Exception as e:  # Zertifikat/Netz/HTTP — als Text zurück
        return None, type(e).__name__ + ": " + str(e)[:80], b""


def probe(name, template, lon, lat, z, scheme="xyz"):
    u = _url(template, lon, lat, z, scheme)
    st, ct, data = _fetch(u)
    if st is None:
        return name, False, f"FEHLER {ct}"
    if Image is None:
        return name, st == 200 and len(data) > 500, f"{st} {ct} {len(data)} B"
    try:
        im = Image.open(io.BytesIO(data)).convert("L")
        sd = ImageStat.Stat(im).stddev[0]
        ok = st == 200 and sd > 5
        return name, ok, f"{st} {im.size[0]}×{im.size[1]} stddev={sd:.1f}" + ("" if ok else " (einfarbig?)")
    except Exception:
        return name, False, f"{st} {ct} kein Bild: {data[:80]!r}"


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    want_maptiler = "--maptiler" in sys.argv
    jobs = []
    for r in ms.ORTHO_REGIONS:
        if args and r["id"] not in args:
            continue
        b = r["bbox"]
        lon, lat = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
        # Mittelpunkt kann im Meer liegen (Spanien mit Kanaren, USA): bekannte Landpunkte
        land = {"es": (-3.70, 40.42), "us": (-119.5, 37.7), "us-ak": (-149.9, 61.2), "us-hi": (-155.5, 19.6),
                "jp": (138.73, 35.36), "fr": (2.35, 48.86), "it": (12.49, 41.89), "pt": (-8.6, 41.15),
                "ee": (24.75, 59.43), "nl": (5.9, 52.2), "de-hb": (8.81, 53.08), "de-sh": (10.13, 54.32),
                "de-mv": (12.10, 54.09), "de-ni": (9.73, 52.37)}
        lon, lat = land.get(r["id"], (lon, lat))
        jobs.append((r["id"] + " " + r["name"], ms.region_tiles(r)[0], lon, lat, 14, r.get("scheme", "xyz")))
    if not args:
        jobs.append(("terrain aws", ms.TERRAIN["aws"]["tiles"][0], 7.99, 46.55, 12))
        jobs.append(("ofm liberty style", ms.STYLE_BY_KEY["ofm_liberty"]["style_url"], 0, 0, 0))
        jobs.append(("osm", ms.STYLE_BY_KEY["osm"]["tiles"][0], 13.4, 52.5, 12))
        jobs.append(("topo", ms.STYLE_BY_KEY["topo"]["tiles"][0], 13.4, 52.5, 12))
    if want_maptiler:
        key = ""
        try:
            sp = Path.home() / "Library/Application Support/Reisezoom GPS Studio/settings.json"
            key = (json.load(open(sp)).get("maptiler_key") or "").strip()
        except Exception:
            pass
        if key:
            jobs.append(("maptiler terrain", ms.TERRAIN["maptiler"]["tiles"][0].replace("{maptiler_key}", key), 7.99, 46.55, 10))
            jobs.append(("maptiler satellite style", ms.STYLE_BY_KEY["maptiler_satellite"]["style_url"].replace("{maptiler_key}", key), 0, 0, 0))
        else:
            print("  (kein MapTiler-Schlüssel in den Einstellungen — übersprungen)")

    def run(j):
        name, tpl, lon, lat, z = j[:5]
        scheme = j[5] if len(j) > 5 else "xyz"
        if tpl.endswith("style.json") or "/styles/" in tpl and "{z}" not in tpl:
            st, ct, data = _fetch(tpl)
            ok = st == 200 and b'"version"' in data
            return name, ok, f"{st} {len(data)} B Style-JSON"
        return probe(name, tpl, lon, lat, z, scheme)

    rot = 0
    with cf.ThreadPoolExecutor(8) as ex:
        for name, ok, info in ex.map(run, jobs):
            print(f"  {'✓' if ok else '✗'}  {name:32s} {info}")
            rot += 0 if ok else 1
    print()
    print("✅ alle Quellen liefern" if rot == 0 else f"✗ {rot} Quelle(n) liefern nicht — Katalog in core/mapstyles.py prüfen")
    return 0 if rot == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
