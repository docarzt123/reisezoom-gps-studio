#!/usr/bin/env python3
"""Schnappschuss der OpenFreeMap-„Liberty"-Ebenen als Beschriftungs-Overlay
für Raster-Stile (Satellit (kostenlos), MapTiler-Satellit, OSM-Raster).

04.09.2026 (Marc: „Auf der Karte anzeigen — Orte, Straßen usw. — funktioniert
bei Satellit (kostenlos) nicht"): Reine Rasterkarten haben keine Ebenen, die
man ein- und ausblenden könnte. Deshalb legen wir die Vektor-Ebenen von
OpenFreeMap (OpenMapTiles-Schema, frei, ohne Schlüssel) darüber — nach
Gruppen sortiert, damit die fünf Schalter greifen:

  places  = label_*                       (Orte, Länder, Bundesländer)
  roads   = road_/bridge_/tunnel_* (ohne Schienen) + highway-name/-shield + Pfeile
  pois    = poi_r*
  transit = *_rail*, poi_transit, airport, aeroway_*
  admin   = boundary_*

Aufruf: python3 scripts/update_ofm_overlay.py  → ui/vendor/ofm-liberty-overlay.json
Quelle: https://tiles.openfreemap.org/styles/liberty (Lizenz: Daten ODbL/OSM,
Stil BSD). Der Schnappschuss liegt im Bundle, damit die App nicht vom Live-
Stil abhängt; hier gelegentlich neu erzeugen.
"""
import json, sys, urllib.request
from pathlib import Path

SRC = "https://tiles.openfreemap.org/styles/liberty"
OUT = Path(__file__).resolve().parent.parent / "ui" / "vendor" / "ofm-liberty-overlay.json"


def group_of(layer_id: str) -> str | None:
    i = layer_id
    if i.startswith("boundary_"):
        return "admin"
    if i.startswith("label_"):
        return "places"
    if "rail" in i or i == "poi_transit" or i == "airport" or i.startswith("aeroway_"):
        return "transit"
    if i.startswith("poi_"):
        return "pois"
    if i.startswith(("road_", "bridge_", "tunnel_", "highway-")):
        return "roads"
    return None


def main() -> int:
    req = urllib.request.Request(SRC, headers={"User-Agent": "ReisezoomGPSStudio (+https://reisezoom.com/gps)"})
    raw = urllib.request.urlopen(req, timeout=30).read().decode("utf-8")
    style = json.loads(raw)
    layers = []
    for l in style["layers"]:
        g = group_of(l["id"])
        if not g or l.get("source") != "openmaptiles":
            continue
        l = dict(l)
        l["id"] = f"rz-ov-{g}-{l['id']}"
        l["metadata"] = {"rz_group": g}
        layers.append(l)
    out = {"version": 1, "source_url": SRC, "sources": {"openmaptiles": style["sources"]["openmaptiles"]},
           "glyphs": style["glyphs"], "sprite": style["sprite"], "layers": layers,
           "attribution": "Beschriftung: © OpenMapTiles © OpenStreetMap contributors (OpenFreeMap)"}
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    from collections import Counter
    print(f"{len(layers)} Ebenen →", OUT, Counter(l["metadata"]["rz_group"] for l in layers))
    return 0


if __name__ == "__main__":
    sys.exit(main())
