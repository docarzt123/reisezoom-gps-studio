#!/usr/bin/env python3
"""Ortsdaten-Kacheln bauen: Sehenswürdigkeiten, Orte und Pässe aus einem OpenStreetMap-Auszug (Geofabrik .osm.pbf).

Die App fragt dafür sonst Overpass — ein freier Server, der abends oft überlastet ist. Die Kacheln enthalten dieselben
Objekte, die die App bei Overpass abfragt (core/highlights.ARTEN + Orte), knapp wie eine Overpass-Antwort:
`{"elements": [{type, id, lat, lon, bounds?, tags}]}`. So wertet die App sie mit demselben Code aus (core/ortsdaten).

Kachel = KACHEL_GRAD × KACHEL_GRAD Grad, Name `k_<lat>_<lon>.json.gz` (Ecke unten links in KACHEL_GRAD-Schritten).
Dazu `stand.json`: Version, die Grenzen der Auszüge (Geofabrik-`.poly` neben der .pbf, z. B. `bayern.poly` zu
`bayern-latest.osm.pbf`) und je Kachel mit Inhalt die Prüfsumme. Ein Abfrage-Kasten ganz innerhalb einer Grenze wird
aus den Kacheln beantwortet (fehlende Kachel = leer: Meer, Wald ohne Namen); sonst fragt die App weiter Overpass.

Aufruf:
  python3 scripts/ortsdaten_bauen.py ZIELORDNER auszug1.osm.pbf [auszug2.osm.pbf …]
Braucht `osmium` (osmium-tool) im Pfad.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
from core import highlights as chl  # noqa: E402
from core import ortsdaten as cod  # noqa: E402

TAGS_BEHALTEN = ("name", "name:de", "ele", "place", "mountain_pass", "natural", "water", "tourism", "amenity",
                 "historic", "man_made", "memorial", "memorial:type")
PLACE_WERTE = ("city", "town", "village", "hamlet")


def filter_ausdruecke() -> list:
    werte: dict = {}
    for (k, v) in chl.ARTEN:
        if k != "place":
            werte.setdefault(k, []).append(v)
    raus = [f"nwr/{k}={','.join(vs)}" for k, vs in werte.items()]
    raus.append(f"n/place={','.join(PLACE_WERTE)}")
    return raus


def _art_passt(tags: dict) -> bool:
    if tags.get("place") in PLACE_WERTE or tags.get("mountain_pass") == "yes":
        return True
    return any(tags.get(k) == v for (k, v) in chl.ARTEN)


def _koordinaten(geo: dict):
    t, c = geo.get("type"), geo.get("coordinates")
    if t == "Point":
        yield c
    elif t in ("LineString", "MultiPoint"):
        yield from c
    elif t in ("Polygon", "MultiLineString"):
        for ring in c:
            yield from ring
    elif t == "MultiPolygon":
        for poly in c:
            for ring in poly:
                yield from ring


def element_aus(feature: dict):
    """GeoJSON-Feature aus `osmium export` → knappes Overpass-Element oder None."""
    p = feature.get("properties") or {}
    tags = {k: str(p[k]) for k in TAGS_BEHALTEN if p.get(k) not in (None, "")}
    if not str(tags.get("name") or "").strip() or not _art_passt(tags):
        return None
    if tags.get("natural") == "water" and str(tags.get("water") or "").lower() in chl.KEIN_SEE:
        return None
    if "stolperstein" in (tags.get("memorial:type", "") + tags.get("memorial", "")).lower():
        return None
    typ = {"n": "node", "w": "way", "r": "relation"}.get(str(p.get("@type") or "n")[0], "node")
    geo = feature.get("geometry") or {}
    pts = list(_koordinaten(geo))
    if not pts:
        return None
    if geo.get("type") == "Point":
        lon, lat = pts[0]
        return {"type": typ, "id": int(p.get("@id") or 0), "lat": round(lat, 6), "lon": round(lon, 6), "tags": tags}
    lons = [q[0] for q in pts]
    lats = [q[1] for q in pts]
    b = {"minlat": round(min(lats), 6), "minlon": round(min(lons), 6), "maxlat": round(max(lats), 6), "maxlon": round(max(lons), 6)}
    el = {"type": typ, "id": int(p.get("@id") or 0),
          "center": {"lat": round((b["minlat"] + b["maxlat"]) / 2, 6), "lon": round((b["minlon"] + b["maxlon"]) / 2, 6)},
          "bounds": b, "tags": tags}
    return el


def poly_lesen(pfad: Path) -> list:
    """Geofabrik-.poly → Ringe [[(lon, lat), …], …] (Löcher „!…“ bleiben draußen — dort fragt dann Overpass)."""
    ringe, ring, loch = [], None, False
    zeilen = pfad.read_text(encoding="utf-8").splitlines()[1:]
    for z in zeilen:
        z = z.strip()
        if not z:
            continue
        if z == "END":
            if ring is not None:
                if not loch:
                    ringe.append(ring)
                ring = None
            continue
        if ring is None:
            ring, loch = [], z.startswith("!")
            continue
        lon, lat = (float(x) for x in z.split()[:2])
        ring.append((lon, lat))
    return ringe


def auszug_lesen(pbf: Path, tmp: Path) -> tuple:
    """→ (Elemente, Grenz-Ringe)"""
    poly = pbf.with_name(pbf.name.replace("-latest.osm.pbf", ".poly"))
    if not poly.exists():
        raise SystemExit(f"Grenze fehlt: {poly} (von Geofabrik, gleicher Name wie der Auszug)")
    gefiltert = tmp / (pbf.stem + "-gefiltert.osm.pbf")
    subprocess.run(["osmium", "tags-filter", "-O", "-o", str(gefiltert), str(pbf)] + filter_ausdruecke(), check=True)
    geo = tmp / (pbf.stem + ".geojsonseq")
    subprocess.run(["osmium", "export", "-O", "-f", "geojsonseq", "-x", "print_record_separator=false",
                    "-a", "type,id", "-o", str(geo), str(gefiltert)], check=True)
    els = []
    with open(geo, encoding="utf-8") as f:
        for zeile in f:
            zeile = zeile.strip().lstrip("\x1e")
            if not zeile:
                continue
            el = element_aus(json.loads(zeile))
            if el:
                els.append(el)
    return els, [[(round(x, 4), round(y, 4)) for x, y in r] for r in poly_lesen(poly)]


def bauen(ziel: Path, auszuege: list) -> dict:
    t0 = time.time()
    version = time.strftime("%Y-%m")
    kacheln: dict = {}
    grenzen: list = []
    gesehen = set()
    with tempfile.TemporaryDirectory(prefix="ortsdaten-", dir=str(ziel.parent)) as td:
        for pbf in auszuege:
            els, gebiet = auszug_lesen(Path(pbf), Path(td))
            grenzen.extend(gebiet)
            for el in els:
                key = (el["type"], el["id"])
                if key in gesehen:         # Nachbar-Auszüge überlappen
                    continue
                gesehen.add(key)
                lat = el.get("lat", (el.get("center") or {}).get("lat"))
                lon = el.get("lon", (el.get("center") or {}).get("lon"))
                kacheln.setdefault(cod.kachel_name(lat, lon), []).append(el)
            print(f"  {Path(pbf).name}: {len(els)} Objekte, Grenze mit {sum(len(r) for r in gebiet)} Punkten", flush=True)
    ordner = ziel / version
    ordner.mkdir(parents=True, exist_ok=True)
    summen, bytes_ges = {}, 0
    for name, els in sorted(kacheln.items()):
        roh = json.dumps({"elements": els}, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        gz = gzip.compress(roh, 9, mtime=0)
        (ordner / name).write_bytes(gz)
        summen[name] = hashlib.sha1(gz).hexdigest()[:16]
        bytes_ges += len(gz)
    stand = {"format": cod.FORMAT, "version": version, "kachel_grad": cod.KACHEL_GRAD, "grenzen": grenzen,
             "kacheln": summen, "gebaut": time.strftime("%Y-%m-%dT%H:%M:%S")}
    (ziel / "stand.json").write_text(json.dumps(stand, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"✓ {len(summen)} Kacheln, {sum(len(v) for v in kacheln.values())} Objekte, {bytes_ges / 1e6:.1f} MB, "
          f"{time.time() - t0:.0f} s → {ordner}")
    return stand


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    bauen(Path(sys.argv[1]).resolve(), sys.argv[2:])
