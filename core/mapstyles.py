"""Kartenanbieter zur Auswahl — die EINE Stilliste für alle sieben Kartenflächen.

03.09.2026. Anlass: Mapbox verbietet in den Product Terms §1.7 („Print or
Video Use") die Veröffentlichung von Videos mit Kartenmaterial, solange man
keine Videorechte gekauft hat. Der Standardstil der App war ausgerechnet der
Mapbox-Satellit — also der Stil, den niemand veröffentlichen darf. Seitdem
gibt es hier einen Katalog mit vier weiteren Quellen:

  * **Staatliche Orthofotos** (`free_satellite`) — kostenlos, schärfer als
    Mapbox (20–50 cm), ein Eintrag, der das Land anhand der Track-Lage wählt.
    Feste Rechtecke im Code, keine Netzabfrage (muss ohne Cloud laufen).
  * **OpenFreeMap** — kostenlose OSM-Vektorstile, ohne Schlüssel, ohne Limit.
  * **MapTiler** — weltweit Satellit + Gelände, eigener Schlüssel; Video für
    Kanäle bis 100.000 Abonnenten erlaubt (Cloud Terms §5).
  * **AWS Terrain Tiles** (Mapzen terrarium) — Gelände ohne Mapbox. Fest an den
    Stil gekoppelt: Mapbox-Stil → Mapbox-DEM, alles andere → AWS. Sonst landen
    Mapbox-Daten in einem Video, das genau deshalb nicht mit Mapbox gerendert
    wurde.

Die Oberfläche bekommt den Katalog über `Api.map_catalog()` (siehe app.py) und
rechnet mit denselben Daten in `ui/js/util.js` (`resolveMapStyle`). Die Logik
dort ist ein Spiegel von `resolve()` hier — bei Änderung beide pflegen. Die
DATEN stehen nur hier.

Regel für Kachelquellen: Alles, was nicht von Mapbox kommt, läuft über
MapLibre GL — Mapbox GL JS darf mit fremden Kacheln lizenzrechtlich nicht
betrieben werden.
"""
from __future__ import annotations

from typing import Optional

# ── Anbieter ────────────────────────────────────────────────────────────────
# badge: "free"         — kostenlos, Video erlaubt (Nennung im Bild)
#        "key"          — eigener Schlüssel nötig; Video erlaubt (MapTiler:
#                         bis 100k Abonnenten, Gratistarif nicht-kommerziell)
#        "video_rights" — Video nur mit gekauften Rechten (Mapbox §1.7)
PROVIDERS = {
    "gov":      {"badge": "free",         "key": None},
    "ofm":      {"badge": "free",         "key": None},
    "osm":      {"badge": "free",         "key": None},
    "maptiler": {"badge": "key",          "key": "maptiler_key"},
    "mapbox":   {"badge": "video_rights", "key": "mapbox_token"},
}

# ── Gelände-Quellen (raster-dem) ────────────────────────────────────────────
# Das Gelände hängt am Stil, nicht an der Einstellung: Wer Mapbox NICHT
# rendert, bekommt auch kein Mapbox-Gelände.
TERRAIN = {
    "mapbox": {
        "url": "mapbox://mapbox.mapbox-terrain-dem-v1",
        "tileSize": 512, "maxzoom": 14,
        "attribution": "",
    },
    "maptiler": {
        "tiles": ["https://api.maptiler.com/tiles/terrain-rgb-v2/{z}/{x}/{y}.webp?key={maptiler_key}"],
        "tileSize": 512, "maxzoom": 12, "encoding": "mapbox",
        "attribution": "",
    },
    "aws": {
        "tiles": ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
        "tileSize": 256, "maxzoom": 15, "encoding": "terrarium",
        # Nennung laut Mapzen/Tilezen-Attribution (SRTM, EU-DEM, 3DEP, …)
        "attribution": "Gelände: Mapzen/AWS Terrain Tiles",
    },
}

# ── Stile ───────────────────────────────────────────────────────────────────
# key         — Wert in Projekt-/Modul-Einstellungen (`map_style`)
# provider    — s. PROVIDERS
# kind        — "vector" (Style-URL) | "raster" (Kachel-URL) | "gov" (Land wählt)
# terrain     — Name in TERRAIN
# group       — Reihenfolge/Überschrift im Ausklappmenü
# label       — deutscher Fallback; Übersetzung über i18n-Schlüssel `mapstyle.<key>`
STYLES = [
    # Kostenlos ─────────────────────────────────────────────────────────────
    {"key": "free_satellite", "provider": "gov", "kind": "gov", "group": "free",
     "label": "Satellit (kostenlos, Land wählt sich selbst)", "terrain": "aws"},
    {"key": "ofm_liberty", "provider": "ofm", "kind": "vector", "group": "free",
     "label": "Karte Liberty (OpenFreeMap)", "terrain": "aws",
     "style_url": "https://tiles.openfreemap.org/styles/liberty"},
    {"key": "ofm_bright", "provider": "ofm", "kind": "vector", "group": "free",
     "label": "Karte Bright (OpenFreeMap)", "terrain": "aws",
     "style_url": "https://tiles.openfreemap.org/styles/bright"},
    {"key": "ofm_positron", "provider": "ofm", "kind": "vector", "group": "free",
     "label": "Karte Positron hell (OpenFreeMap)", "terrain": "aws",
     "style_url": "https://tiles.openfreemap.org/styles/positron"},
    {"key": "osm", "provider": "osm", "kind": "raster", "group": "free",
     "label": "OpenStreetMap Standard", "terrain": "aws",
     "tiles": ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], "tileSize": 256, "maxzoom": 19,
     "attribution": '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'},
    {"key": "topo", "provider": "osm", "kind": "raster", "group": "free",
     "label": "OpenTopoMap", "terrain": "aws",
     "tiles": ["https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
               "https://b.tile.opentopomap.org/{z}/{x}/{y}.png",
               "https://c.tile.opentopomap.org/{z}/{x}/{y}.png"], "tileSize": 256, "maxzoom": 17,
     "attribution": '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)'},
    {"key": "cyclosm", "provider": "osm", "kind": "raster", "group": "free",
     "label": "CyclOSM", "terrain": "aws",
     "tiles": ["https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
               "https://b.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
               "https://c.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png"], "tileSize": 256, "maxzoom": 20,
     "attribution": '&copy; <a href="https://www.cyclosm.org/">CyclOSM</a> | &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'},
    {"key": "humanitarian", "provider": "osm", "kind": "raster", "group": "free",
     "label": "Humanitarian (HOT)", "terrain": "aws",
     "tiles": ["https://a.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
               "https://b.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
               "https://c.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png"], "tileSize": 256, "maxzoom": 20,
     "attribution": '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | Tiles: <a href="https://www.hotosm.org/">HOT</a>'},
    # MapTiler (Schlüssel) ─────────────────────────────────────────────────
    {"key": "maptiler_satellite", "provider": "maptiler", "kind": "vector", "group": "maptiler",
     "label": "MapTiler Satellit", "terrain": "maptiler",
     "style_url": "https://api.maptiler.com/maps/satellite/style.json?key={maptiler_key}"},
    {"key": "maptiler_hybrid", "provider": "maptiler", "kind": "vector", "group": "maptiler",
     "label": "MapTiler Satellit + Beschriftung", "terrain": "maptiler",
     "style_url": "https://api.maptiler.com/maps/hybrid/style.json?key={maptiler_key}"},
    {"key": "maptiler_outdoor", "provider": "maptiler", "kind": "vector", "group": "maptiler",
     "label": "MapTiler Outdoor", "terrain": "maptiler",
     "style_url": "https://api.maptiler.com/maps/outdoor-v2/style.json?key={maptiler_key}"},
    {"key": "maptiler_topo", "provider": "maptiler", "kind": "vector", "group": "maptiler",
     "label": "MapTiler Topo", "terrain": "maptiler",
     "style_url": "https://api.maptiler.com/maps/topo-v2/style.json?key={maptiler_key}"},
    {"key": "maptiler_streets", "provider": "maptiler", "kind": "vector", "group": "maptiler",
     "label": "MapTiler Streets", "terrain": "maptiler",
     "style_url": "https://api.maptiler.com/maps/streets-v2/style.json?key={maptiler_key}"},
    # Mapbox (Token; Video nur mit gekauften Rechten) ──────────────────────
    {"key": "satellite", "provider": "mapbox", "kind": "vector", "group": "mapbox",
     "label": "Mapbox Satellit (3D)", "terrain": "mapbox",
     "style_url": "mapbox://styles/mapbox/standard-satellite"},
    {"key": "satellite_streets", "provider": "mapbox", "kind": "vector", "group": "mapbox",
     "label": "Mapbox Satellit + Straßen", "terrain": "mapbox",
     "style_url": "mapbox://styles/mapbox/satellite-streets-v12"},
    {"key": "outdoors", "provider": "mapbox", "kind": "vector", "group": "mapbox",
     "label": "Mapbox Outdoor", "terrain": "mapbox",
     "style_url": "mapbox://styles/mapbox/outdoors-v12"},
    {"key": "streets", "provider": "mapbox", "kind": "vector", "group": "mapbox",
     "label": "Mapbox Streets", "terrain": "mapbox",
     "style_url": "mapbox://styles/mapbox/streets-v12"},
    {"key": "light", "provider": "mapbox", "kind": "vector", "group": "mapbox",
     "label": "Mapbox Hell", "terrain": "mapbox",
     "style_url": "mapbox://styles/mapbox/light-v11"},
    {"key": "dark", "provider": "mapbox", "kind": "vector", "group": "mapbox",
     "label": "Mapbox Dunkel", "terrain": "mapbox",
     "style_url": "mapbox://styles/mapbox/dark-v11"},
]
STYLE_BY_KEY = {s["key"]: s for s in STYLES}
DEFAULT_STYLE = "free_satellite"
GROUP_ORDER = ("free", "maptiler", "mapbox")

# Rückwärtskompatibel: die alte Mapbox-Liste (core/animator.py hatte sie bis
# 03.09.2026 selbst). Wird noch von älteren Aufrufern/Tests gelesen.
MAP_STYLES = {s["key"]: s["style_url"] for s in STYLES if s["provider"] == "mapbox"}


# ── Staatliche Orthofotos ───────────────────────────────────────────────────
# bbox: (lon_min, lat_min, lon_max, lat_max). Kleinere Flächen (Bundesländer,
# Stadtstaaten) stehen VOR den Ländern und gewinnen, weil `region_for_bbox`
# nach Fläche sortiert. Alle Endpunkte am 03.09.2026 mit echten Kacheln
# geprüft (z14, Bild nicht einfarbig). Hamburg fehlt: der katalogisierte
# Dienst `HH_WMS_DOP20` antwortet 404.
#
# Zwei Formen:
#   "tiles": XYZ/WMTS-Vorlage mit {z}/{x}/{y}   (MapLibre + Leaflet direkt)
#   "wms":   {"base", "layers", "format"}      → MapLibre über {bbox-epsg-3857},
#                                                 Leaflet über L.tileLayer.wms
def _wms(base: str, layers: str, fmt: str = "image/jpeg") -> dict:
    return {"base": base, "layers": layers, "format": fmt}


ORTHO_REGIONS = [
    # Deutschland — Land für Land (kein kostenloser Bundesdienst; BKG wmts_dop
    # verlangt Registrierung).
    {"id": "de-be", "name": "Berlin", "country": "DE", "bbox": (13.09, 52.34, 13.76, 52.68), "maxzoom": 20,
     "wms": _wms("https://gdi.berlin.de/services/wms/truedop_2024", "truedop_2024"),
     "attribution": "Luftbild: Geoportal Berlin / TrueDOP (dl-de/by-2-0)"},
    {"id": "de-hb", "name": "Bremen", "country": "DE", "bbox": (8.48, 53.01, 8.99, 53.61), "maxzoom": 20,
     "wms": _wms("https://geodienste.bremen.de/wms_dop20_2023", "DOP20_2023_HB,DOP20_2023_BHV"),
     "attribution": "Luftbild: Landesamt GeoInformation Bremen (CC BY 4.0)"},
    {"id": "de-sl", "name": "Saarland", "country": "DE", "bbox": (6.36, 49.11, 7.40, 49.64), "maxzoom": 20,
     "wms": _wms("https://geoportal.saarland.de/freewms/truedop", "sl_dop20_rgb"),
     "attribution": "Luftbild: LVGL Saarland (dl-de/by-2-0)"},
    {"id": "de-sh", "name": "Schleswig-Holstein", "country": "DE", "bbox": (7.86, 53.36, 11.31, 55.06), "maxzoom": 20,
     "wms": _wms("https://dienste.gdi-sh.de/WMS_SH_DOP20col_OpenGBD", "sh_dop20_rgb"),
     "attribution": "Luftbild: GeoBasis-DE/LVermGeo SH (CC BY 4.0)"},
    {"id": "de-mv", "name": "Mecklenburg-Vorpommern", "country": "DE", "bbox": (10.59, 53.11, 14.41, 54.69), "maxzoom": 20,
     "wms": _wms("https://www.geodaten-mv.de/dienste/adv_dop", "mv_dop"),
     "attribution": "Luftbild: GeoBasis-DE/M-V (dl-de/by-2-0)"},
    {"id": "de-ni", "name": "Niedersachsen", "country": "DE", "bbox": (6.65, 51.29, 11.60, 53.90), "maxzoom": 20,
     "wms": _wms("https://opendata.lgln.niedersachsen.de/doorman/noauth/dop_wms", "ni_dop20"),
     "attribution": "Luftbild: LGLN Niedersachsen (CC BY 4.0)"},
    {"id": "de-bb", "name": "Brandenburg", "country": "DE", "bbox": (11.27, 51.36, 14.77, 53.56), "maxzoom": 20,
     "wms": _wms("https://isk.geobasis-bb.de/mapproxy/dop20c/service/wms", "bebb_dop20c"),
     "attribution": "Luftbild: GeoBasis-DE/LGB (dl-de/by-2-0)"},
    {"id": "de-st", "name": "Sachsen-Anhalt", "country": "DE", "bbox": (10.56, 50.94, 13.19, 53.04), "maxzoom": 20,
     "wms": _wms("https://www.geodatenportal.sachsen-anhalt.de/wss/service/ST_LVermGeo_DOP_WMS_OpenData/guest", "lsa_lvermgeo_dop20_2"),
     "attribution": "Luftbild: GeoBasis-DE/LVermGeo ST (dl-de/by-2-0)"},
    {"id": "de-sn", "name": "Sachsen", "country": "DE", "bbox": (11.87, 50.17, 15.04, 51.69), "maxzoom": 20,
     "wms": _wms("https://geodienste.sachsen.de/wms_geosn_dop-rgb/guest", "sn_dop_020"),
     "attribution": "Luftbild: GeoSN Sachsen (dl-de/by-2-0)"},
    {"id": "de-th", "name": "Thüringen", "country": "DE", "bbox": (9.88, 50.20, 12.65, 51.65), "maxzoom": 20,
     "wms": _wms("https://www.geoproxy.geoportal-th.de/geoproxy/services/DOP20", "th_dop"),
     "attribution": "Luftbild: GDI-Th / TLBG (dl-de/by-2-0)"},
    {"id": "de-he", "name": "Hessen", "country": "DE", "bbox": (7.77, 49.39, 10.24, 51.66), "maxzoom": 20,
     "wms": _wms("https://www.gds-srv.hessen.de/cgi-bin/lika-services/ogc-free-images.ows", "he_dop_rgb"),
     "attribution": "Luftbild: HVBG Hessen (dl-de/zero-2-0)"},
    {"id": "de-nw", "name": "Nordrhein-Westfalen", "country": "DE", "bbox": (5.87, 50.32, 9.46, 52.53), "maxzoom": 20,
     "wms": _wms("https://www.wms.nrw.de/geobasis/wms_nw_dop", "nw_dop_rgb"),
     "attribution": "Luftbild: Geobasis NRW (dl-de/zero-2-0)"},
    {"id": "de-rp", "name": "Rheinland-Pfalz", "country": "DE", "bbox": (6.11, 48.97, 8.51, 50.94), "maxzoom": 20,
     "wms": _wms("https://geo4.service24.rlp.de/wms/rp_dop20.fcgi", "rp_dop20"),
     "attribution": "Luftbild: GeoBasis-DE/LVermGeoRP (dl-de/by-2-0)"},
    {"id": "de-bw", "name": "Baden-Württemberg", "country": "DE", "bbox": (7.51, 47.53, 10.50, 49.79), "maxzoom": 20,
     "wms": _wms("https://owsproxy.lgl-bw.de/owsproxy/ows/WMS_LGL-BW_ATKIS_DOP_20_C", "IMAGES_DOP_20_RGB"),
     "attribution": "Luftbild: LGL Baden-Württemberg (dl-de/by-2-0)"},
    {"id": "de-by", "name": "Bayern", "country": "DE", "bbox": (8.98, 47.27, 13.84, 50.56), "maxzoom": 20,
     "wms": _wms("https://geoservices.bayern.de/od/wms/dop/v1/dop20", "by_dop20c"),
     "attribution": "Luftbild: Bayerische Vermessungsverwaltung (CC BY 4.0)"},
    # Europa ────────────────────────────────────────────────────────────────
    {"id": "lu", "name": "Luxemburg", "country": "LU", "bbox": (5.73, 49.44, 6.53, 50.19), "maxzoom": 20,
     "tiles": ["https://wmts1.geoportail.lu/opendata/wmts/ortho_latest/GLOBAL_WEBMERCATOR_4_V3/{z}/{x}/{y}.jpeg"],
     "attribution": "Luftbild: ACT Luxembourg (CC0)"},
    {"id": "ch", "name": "Schweiz", "country": "CH", "bbox": (5.95, 45.80, 10.50, 47.81), "maxzoom": 20,
     "tiles": ["https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg"],
     "attribution": "Luftbild: © swisstopo"},
    {"id": "nl", "name": "Niederlande", "country": "NL", "bbox": (3.30, 50.75, 7.22, 53.60), "maxzoom": 19,
     "tiles": ["https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_ortho25/EPSG:3857/{z}/{x}/{y}.jpeg"],
     "attribution": "Luftbild: PDOK / Beeldmateriaal Nederland (CC BY 4.0)"},
    {"id": "at", "name": "Österreich", "country": "AT", "bbox": (9.50, 46.37, 17.17, 49.02), "maxzoom": 19,
     "tiles": ["https://mapsneu.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg"],
     "attribution": "Luftbild: basemap.at (CC BY 4.0)"},
    {"id": "cz", "name": "Tschechien", "country": "CZ", "bbox": (12.09, 48.55, 18.86, 51.06), "maxzoom": 19,
     "tiles": ["https://ags.cuzk.cz/arcgis1/rest/services/ORTOFOTO_WM/MapServer/tile/{z}/{y}/{x}"],
     "attribution": "Luftbild: © ČÚZK"},
    {"id": "ee", "name": "Estland", "country": "EE", "bbox": (21.70, 57.50, 28.20, 59.70), "maxzoom": 18,
     "tiles": ["https://tiles.maaamet.ee/tm/tms/1.0.0/foto@GMC/{z}/{x}/{y}.png"], "scheme": "tms",
     "attribution": "Luftbild: Maa-amet (CC BY 4.0)"},
    {"id": "pt", "name": "Portugal", "country": "PT", "bbox": (-9.55, 36.95, -6.19, 42.16), "maxzoom": 19,
     "wms": _wms("https://cartografia.dgterritorio.gov.pt/ortos2018/service", "Ortos2018-RGB", "image/png"),
     "attribution": "Luftbild: DGT Portugal, Ortos 2018 (CC BY 4.0)"},
    {"id": "fr", "name": "Frankreich", "country": "FR", "bbox": (-5.20, 41.30, 9.60, 51.10), "maxzoom": 19,
     "tiles": ["https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}"],
     "attribution": "Luftbild: © IGN France / Géoplateforme"},
    # 03.09.2026 (Marc, Masca-Render): Das PNOA-WMTS liefert über dem Meer opake
    # dunkellila Kacheln — Ränder und Meer wurden zugedeckt. Der WMS mit PNG +
    # TRANSPARENT lässt dort den Blue-Marble-Untergrund durch.
    {"id": "es", "name": "Spanien", "country": "ES", "bbox": (-18.20, 27.60, 4.40, 43.80), "maxzoom": 19,
     "wms": _wms("https://www.ign.es/wms-inspire/pnoa-ma", "OI.OrthoimageCoverage", "image/png"),
     "attribution": "Luftbild: PNOA © IGN España (CC BY 4.0)"},
    {"id": "it", "name": "Italien", "country": "IT", "bbox": (6.60, 36.60, 18.60, 47.10), "maxzoom": 18,
     "wms": _wms("https://wms.pcn.minambiente.it/ogc?map=/ms_ogc/WMS_v1.3/raster/ortofoto_colore_12.map", "OI.ORTOIMMAGINI.2012.32,OI.ORTOIMMAGINI.2012.33"),
     "attribution": "Luftbild: Geoportale Nazionale (MASE), Ortofoto 2012 (CC BY 3.0 IT)"},
    {"id": "pl", "name": "Polen", "country": "PL", "bbox": (14.12, 49.00, 24.15, 54.84), "maxzoom": 19,
     "tiles": ["https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMTS/StandardResolution?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTOFOTOMAPA&STYLE=default&FORMAT=image/jpeg&TILEMATRIXSET=EPSG:3857&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}"],
     "attribution": "Luftbild: Geoportal.gov.pl / GUGiK"},
    # Welt ──────────────────────────────────────────────────────────────────
    {"id": "jp", "name": "Japan", "country": "JP", "bbox": (122.90, 24.00, 146.00, 45.60), "maxzoom": 18,
     "tiles": ["https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg"],
     "attribution": "Luftbild: 地理院タイル (GSI Japan)"},
    {"id": "us", "name": "USA", "country": "US", "bbox": (-125.00, 24.40, -66.90, 49.40), "maxzoom": 16,
     "tiles": ["https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}"],
     "attribution": "Luftbild: USGS The National Map (public domain)"},
    {"id": "us-ak", "name": "Alaska", "country": "US", "bbox": (-179.20, 51.20, -129.90, 71.40), "maxzoom": 16,
     "tiles": ["https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}"],
     "attribution": "Luftbild: USGS The National Map (public domain)"},
    {"id": "us-hi", "name": "Hawaii", "country": "US", "bbox": (-160.30, 18.90, -154.80, 22.30), "maxzoom": 16,
     "tiles": ["https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}"],
     "attribution": "Luftbild: USGS The National Map (public domain)"},
]


# ── Weltweiter Untergrund für die Orthofotos ────────────────────────────────
# 03.09.2026 (Marc, Masca-Render): Die Landesdienste decken nur ihr Gebiet;
# über dem Meer und in der Ferne (steile Kamera) kamen Kachel-Löcher und bei
# PNOA unterhalb z7 ein Rausch-Muster. Darunter liegt jetzt NASA Blue Marble
# (gemeinfrei, global, z0–8): Meer bleibt Meer, ferne Küsten bleiben Küsten.
# Die Orthofoto-Quellen fordern erst ab `ORTHO_MINZOOM` Kacheln an.
BASE_LAYER = {
    "tiles": ["https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg"],
    "tileSize": 256, "maxzoom": 8,
    "attribution": "Hintergrund: NASA Blue Marble (GIBS)",
}
ORTHO_MINZOOM = 7

# ── Nachlesen: Bedingungen der Anbieter (Einstellungen → Karten, Handbuch) ─
# Marc, 03.09.2026: „setze links zu den quellen … dass jeder selbst nachlesen
# kann, was in den terms steht". Alles hier ist UNSERE Lesart der Bedingungen;
# Bedingungen ändern sich, und wir können uns irren — die Links sind die Quelle.
TERMS_LINKS = [
    {"id": "mapbox_terms", "label": "Mapbox Product Terms (§1.7 Print or Video Use)", "url": "https://www.mapbox.com/legal/product-terms"},
    {"id": "mapbox_tos", "label": "Mapbox Terms of Service", "url": "https://www.mapbox.com/legal/tos"},
    {"id": "maptiler_terms", "label": "MapTiler Cloud Terms of Service (§4 Free plan, §5 Limited Videos)", "url": "https://www.maptiler.com/terms/"},
    {"id": "maptiler_pricing", "label": "MapTiler Cloud — Tarife", "url": "https://www.maptiler.com/cloud/pricing/"},
    {"id": "osm_copyright", "label": "OpenStreetMap — Urheberrecht und Lizenz (ODbL)", "url": "https://www.openstreetmap.org/copyright"},
    {"id": "osm_tile_policy", "label": "OpenStreetMap Tile Usage Policy", "url": "https://operations.osmfoundation.org/policies/tiles/"},
    {"id": "openfreemap", "label": "OpenFreeMap — Nutzung und Lizenz", "url": "https://openfreemap.org/"},
    {"id": "openmaptiles", "label": "OpenMapTiles-Lizenz (BSD-3 / CC BY 4.0)", "url": "https://github.com/openmaptiles/openmaptiles/blob/master/LICENSE.md"},
    {"id": "aws_terrain", "label": "AWS Terrain Tiles (Mapzen/Tilezen) — Nennung", "url": "https://registry.opendata.aws/terrain-tiles/"},
    {"id": "nasa_gibs", "label": "NASA GIBS — Nutzung (gemeinfrei)", "url": "https://www.earthdata.nasa.gov/engage/open-data-services-software-policies"},
    {"id": "dl_de_by", "label": "Datenlizenz Deutschland – Namensnennung 2.0 (dl-de/by-2-0)", "url": "https://www.govdata.de/dl-de/by-2-0"},
    {"id": "dl_de_zero", "label": "Datenlizenz Deutschland – Zero 2.0 (dl-de/zero-2-0)", "url": "https://www.govdata.de/dl-de/zero-2-0"},
    {"id": "cc_by_4", "label": "Creative Commons BY 4.0", "url": "https://creativecommons.org/licenses/by/4.0/"},
    {"id": "ign_es", "label": "IGN España — Nutzungsbedingungen PNOA", "url": "https://www.ign.es/web/ign/portal/politica-datos"},
    {"id": "ign_fr", "label": "IGN France — Géoplateforme, Lizenz (Etalab)", "url": "https://geoservices.ign.fr/cgu-licences"},
    {"id": "swisstopo", "label": "swisstopo — Nutzungsbedingungen", "url": "https://www.swisstopo.admin.ch/de/nutzungsbedingungen-kostenlose-geodaten-und-geodienste"},
    {"id": "basemap_at", "label": "basemap.at — Nutzungsbedingungen (CC BY 4.0)", "url": "https://basemap.at/nutzungsbedingungen/"},
    {"id": "pdok", "label": "PDOK Luchtfoto — Lizenz", "url": "https://www.pdok.nl/introductie/-/article/luchtfoto-pdok"},
    {"id": "gsi_jp", "label": "GSI Japan — Nutzungsbedingungen (地理院タイル)", "url": "https://maps.gsi.go.jp/development/ichiran.html"},
    {"id": "usgs", "label": "USGS The National Map — gemeinfrei", "url": "https://www.usgs.gov/faqs/what-are-terms-uselicensing-map-services-and-data-national-map"},
    {"id": "google_geo", "label": "Zum Vergleich: Google Geo Guidelines (Earth/Earth Studio)", "url": "https://about.google/brand-resource-center/products-and-services/geo-guidelines/"},
]


def _area(b) -> float:
    return max(0.0, (b[2] - b[0])) * max(0.0, (b[3] - b[1]))


def bbox_tuple(bbox) -> Optional[tuple]:
    """(lon_min, lat_min, lon_max, lat_max) aus Tupel/Liste ODER dem Objekt
    {min_lat, max_lat, min_lon, max_lon} von core/gpx.py. None = unbrauchbar."""
    if not bbox:
        return None
    try:
        if isinstance(bbox, dict):
            t = (float(bbox["min_lon"]), float(bbox["min_lat"]), float(bbox["max_lon"]), float(bbox["max_lat"]))
        else:
            t = (float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3]))
    except Exception:
        return None
    return t


def regions_for_bbox(bbox) -> list[dict]:
    """Alle Orthofoto-Regionen, deren Rechteck den MITTELPUNKT des Track-
    Rechtecks enthält — kleinste Fläche zuerst (Berlin vor Brandenburg,
    Bundesland vor Land). Leer = keine Abdeckung."""
    bbox = bbox_tuple(bbox)
    if not bbox:
        return []
    cx = (bbox[0] + bbox[2]) / 2.0
    cy = (bbox[1] + bbox[3]) / 2.0
    hits = [r for r in ORTHO_REGIONS
            if r["bbox"][0] <= cx <= r["bbox"][2] and r["bbox"][1] <= cy <= r["bbox"][3]]
    hits.sort(key=lambda r: _area(r["bbox"]))
    return hits


def region_for_bbox(bbox) -> Optional[dict]:
    """Die wahrscheinlichste Region (kleinste Fläche um den Mittelpunkt)."""
    hits = regions_for_bbox(bbox)
    return hits[0] if hits else None


def region_stack(bbox) -> list[dict]:
    """Welche Regionen werden übereinandergelegt? Rechtecke der Bundesländer
    überlappen sich stark (Potsdam liegt im Rechteck von Sachsen-Anhalt). Da
    die Landesdienste außerhalb ihrer Grenzen durchsichtige PNGs liefern
    (03.09.2026 für alle 15 geprüft), werden ALLE Treffer gestapelt —
    kleinste Fläche oben, höchstens vier."""
    hits = regions_for_bbox(bbox)
    if not hits:
        return []
    # 03.09.2026 (Seebensee/Tirol): auch über Ländergrenzen stapeln. Der
    # Track lag im Rechteck von Bayern UND Österreich; allein gewählt liefert
    # der bayerische Dienst außerhalb Bayerns WEISSE Kacheln (JPEG) — als
    # PNG mit Alpha im Stapel scheint darunter Österreich durch.
    return hits[:4]


def wms_tile_template(wms: dict, transparent: bool = False) -> str:
    """WMS-GetMap als Kachelvorlage — MapLibre/Mapbox GL ersetzen
    `{bbox-epsg-3857}` selbst je Kachel. `transparent` = PNG mit Alpha, damit
    im Stapel das nächste Land durchscheint."""
    base = wms["base"]
    sep = "&" if "?" in base else "?"
    fmt = wms.get("format", "image/jpeg")
    if transparent or fmt == "image/png":
        fmt = "image/png&TRANSPARENT=TRUE"     # Alpha außerhalb der Abdeckung → Untergrund scheint durch
    return (base + sep + "SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=" + wms["layers"]
            + "&STYLES=&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=" + fmt)


def region_tiles(region: dict, transparent: bool = False, proxy_base: str = "") -> list[str]:
    """Kachelvorlage(n) einer Region. Mit `proxy_base` (lokaler Media-Server der
    App, s. core/tileproxy.py) läuft alles über `/tile/<id>/{z}/{x}/{y}` — das
    löst CORS (SH, ST, SN senden keine Freigabe) und speist den Zwischenspeicher."""
    if proxy_base:
        return [proxy_base.rstrip("/") + "/tile/" + region["id"] + "/{z}/{x}/{y}" + ("?t=1" if transparent else "")]
    if region.get("tiles"):
        return list(region["tiles"])
    return [wms_tile_template(region["wms"], transparent=transparent)]


def stack_attribution(stack: list[dict]) -> str:
    """Nennung eines Stapels: erste vollständig, weitere ohne „Luftbild:"-Vorsatz."""
    out = []
    for i, r in enumerate(stack):
        a = r["attribution"]
        if i and a.startswith("Luftbild: "):
            a = a[len("Luftbild: "):]
        if a not in out:
            out.append(a)
    return " | ".join(out)


def stack_style(stack: list[dict], proxy_base: str = "") -> dict:
    """GL-Style mit einer Raster-Quelle je Region; unterste = größte Fläche."""
    # 04.09.2026 (Marc, Brandenburg bei Zoom 7): Auch eine EINZELNE Region
    # immer als PNG mit Alpha — als JPEG füllt der Landesdienst alles
    # außerhalb seiner Grenze WEISS, und der Blue-Marble-Untergrund kommt nie
    # zum Vorschein (weiße Fläche mit Brandenburg-Insel). XYZ-Dienste ohne
    # Alpha-Variante (AT, LU, CZ …) bleiben, wie sie sind.
    transparent = True
    sources, layers = {}, []
    # Untergrund zuerst (ganz unten): Meer, Ferne, Lücken der Landesdienste.
    sources["rz-base"] = {"type": "raster", "tiles": list(BASE_LAYER["tiles"]), "tileSize": BASE_LAYER["tileSize"],
                          "maxzoom": BASE_LAYER["maxzoom"], "attribution": BASE_LAYER["attribution"]}
    layers.append({"id": "rz-base", "type": "raster", "source": "rz-base", "minzoom": 0})
    for r in reversed(stack):            # groß → klein = unten → oben
        sid = "rz-raster-" + r["id"] if transparent else "rz-raster"
        src = {"type": "raster", "tiles": region_tiles(r, transparent=transparent, proxy_base=proxy_base),
               "tileSize": 256, "minzoom": int(r.get("minzoom", ORTHO_MINZOOM)),
               "maxzoom": int(r.get("maxzoom", 19)), "attribution": r["attribution"]}
        if r.get("scheme") == "tms" and not proxy_base:   # die Weiche spiegelt y selbst
            src["scheme"] = "tms"
        sources[sid] = src
        layers.append({"id": sid, "type": "raster", "source": sid, "minzoom": 0})
    # Weltkugel: MapLibre 5 zeichnet bei kleinem Zoom einen Globus (Anflug aus
    # dem All wie bei Mapbox) — der Blue-Marble-Untergrund macht ihn erst schön.
    return {"version": 8, "projection": {"type": "globe"}, "sources": sources, "layers": layers}


def region_leaflet(region: dict, transparent: bool = False) -> dict:
    """Für die Leaflet-Exporte (Web-Karte, Tour-Map-HTML): Form wie
    `tourmap_html.OSM_TILE_STYLES`, plus `wms` wenn es ein WMS ist."""
    d = {"label": "Luftbild " + region["name"], "sub": "", "max": int(region.get("maxzoom", 19)),
         "attr": region["attribution"], "region": region["id"]}
    if region.get("tiles"):
        d["url"] = region["tiles"][0]
        if region.get("scheme") == "tms":
            d["tms"] = True
    else:
        d["url"] = ""
        d["wms"] = dict(region["wms"])
        if transparent:
            d["wms"]["format"] = "image/png"
            d["wms"]["transparent"] = True
    return d


def base_leaflet() -> dict:
    return {"label": "NASA Blue Marble", "url": BASE_LAYER["tiles"][0], "sub": "", "max": BASE_LAYER["maxzoom"],
            "attr": BASE_LAYER["attribution"], "base": True}


def stack_leaflet(stack: list[dict]) -> dict:
    """Leaflet-Kachelangabe für einen Stapel: `stack` = Liste unten → oben,
    immer mit dem Blue-Marble-Untergrund als erster Ebene."""
    if not stack:
        return {}
    # 04.09.2026 (Marc, Brandenburg bei Zoom 7): Auch eine EINZELNE Region
    # immer als PNG mit Alpha — als JPEG füllt der Landesdienst alles
    # außerhalb seiner Grenze WEISS, und der Blue-Marble-Untergrund kommt nie
    # zum Vorschein (weiße Fläche mit Brandenburg-Insel). XYZ-Dienste ohne
    # Alpha-Variante (AT, LU, CZ …) bleiben, wie sie sind.
    transparent = True
    d = region_leaflet(stack[0], transparent=transparent)
    d["attr"] = stack_attribution(stack)
    if transparent:
        d["label"] = "Luftbild " + "/".join(r["name"] for r in stack)
    d["stack"] = [base_leaflet()] + [dict(region_leaflet(r, transparent=transparent), min=ORTHO_MINZOOM) for r in reversed(stack)]
    return d


def raster_style(tiles: list[str], *, tile_size: int = 256, maxzoom: int = 19,
                 attribution: str = "", scheme: str = "xyz") -> dict:
    """GL-Style-8-Objekt mit EINER Raster-Quelle. Kein Layer-maxzoom, damit
    oberhalb der letzten Kachelstufe hochskaliert statt schwarz wird
    (Marc: hochskalieren, nicht die Quelle wechseln)."""
    src = {"type": "raster", "tiles": tiles, "tileSize": tile_size,
           "maxzoom": int(maxzoom), "attribution": attribution}
    if scheme == "tms":
        src["scheme"] = "tms"
    return {"version": 8, "projection": {"type": "globe"},   # 03.09.2026: Weltkugel wie bei Mapbox
            "sources": {"rz-raster": src},
            "layers": [{"id": "rz-raster", "type": "raster", "source": "rz-raster", "minzoom": 0}]}


TERRAIN_AWS_PROXY_ID = "terrain-aws"     # Weiche: /tile/terrain-aws/{z}/{x}/{y}


def terrain_source(name: str, *, maptiler_key: str = "", proxy_base: str = "") -> Optional[dict]:
    """raster-dem-Quelle. AWS-Terrarium enthält MEERESTIEFEN (Bathymetrie):
    an Küsten fiel das Gelände als dunkle Klippe ins Meer (Masca, 03.09.2026).
    Mit `proxy_base` laufen die Kacheln über die lokale Weiche, die alles
    unter 0 m auf 0 m klemmt (core/tileproxy.clamp_terrarium)."""
    t = TERRAIN.get(name)
    if not t:
        return None
    src = {"type": "raster-dem", "tileSize": t["tileSize"], "maxzoom": t["maxzoom"]}
    if t.get("url"):
        src["url"] = t["url"]
    if t.get("tiles"):
        src["tiles"] = [u.replace("{maptiler_key}", maptiler_key) for u in t["tiles"]]
        if name == "aws" and proxy_base:
            src["tiles"] = [proxy_base.rstrip("/") + "/tile/" + TERRAIN_AWS_PROXY_ID + "/{z}/{x}/{y}"]
    if t.get("encoding"):
        src["encoding"] = t["encoding"]
    if t.get("attribution"):
        src["attribution"] = t["attribution"]
    return src


def style_badge(key: str) -> str:
    s = STYLE_BY_KEY.get(key)
    return PROVIDERS[s["provider"]]["badge"] if s else "free"


def video_ok(key: str) -> bool:
    """False nur bei Mapbox — Veröffentlichung braucht gekaufte Videorechte."""
    return style_badge(key) != "video_rights"


def resolve(style_key: str, *, mapbox_token: str = "", maptiler_key: str = "",
            bbox=None, want_terrain: bool = True, proxy_base: str = "") -> dict:
    """Aus Stil-Schlüssel + Schlüsseln + Track-Lage die konkrete Karte machen.

    Liefert:
      key        — der tatsächlich verwendete Stil (nach Ausweichen)
      region     — bei Orthofotos: {"id": wahrscheinlichste, "name": alle im Stapel, "ids": [...]}
      requested  — der gewünschte
      engine     — "mapbox" | "maplibre"
      style      — Style-URL (str) oder Style-Objekt (dict)
      terrain    — raster-dem-Quelle (dict) oder None
      attribution — zusätzliche Nennung (Gelände), "" wenn keine
      region     — {"id","name"} bei staatlichen Orthofotos, sonst None
      notes      — Liste von Vermerken (Ausweichen, fehlender Schlüssel)
      badge / video_ok — Rechtelage des VERWENDETEN Stils

    Ausweichkette (Marc: sagen UND ausweichen, nie abbrechen):
      Mapbox ohne Token      → free_satellite
      MapTiler ohne Schlüssel → free_satellite
      free_satellite ohne Abdeckung → ofm_liberty (Karte mit Gelände)
    """
    notes: list[str] = []
    key = style_key if style_key in STYLE_BY_KEY else DEFAULT_STYLE
    if key != style_key:
        notes.append(f"unbekannter Stil '{style_key}' → {key}")
    mapbox_token = (mapbox_token or "").strip()
    maptiler_key = (maptiler_key or "").strip()
    st = STYLE_BY_KEY[key]
    if st["provider"] == "mapbox" and not (mapbox_token.startswith("pk.") and len(mapbox_token) > 20):
        notes.append("kein Mapbox-Token → Satellit (kostenlos)")
        key = "free_satellite"; st = STYLE_BY_KEY[key]
    if st["provider"] == "maptiler" and not maptiler_key:
        notes.append("kein MapTiler-Schlüssel → Satellit (kostenlos)")
        key = "free_satellite"; st = STYLE_BY_KEY[key]

    region = None
    stack: list[dict] = []
    if st["kind"] == "gov":
        stack = region_stack(bbox)
        region = stack[0] if stack else None
        if region is None:
            if bbox_tuple(bbox):
                notes.append("Satellit für diesen Track nicht verfügbar → Karte (OpenFreeMap)")
            key = "ofm_liberty"; st = STYLE_BY_KEY[key]

    if st["kind"] == "gov":
        style = stack_style(stack, proxy_base=proxy_base)
    elif st["kind"] == "raster":
        style = raster_style(st["tiles"], tile_size=st.get("tileSize", 256),
                             maxzoom=st.get("maxzoom", 19), attribution=st.get("attribution", ""))
    else:
        style = st["style_url"].replace("{maptiler_key}", maptiler_key)

    engine = "mapbox" if st["provider"] == "mapbox" else "maplibre"
    terrain = terrain_source(st["terrain"], maptiler_key=maptiler_key, proxy_base=proxy_base) if want_terrain else None
    attribution = ""
    if terrain and TERRAIN[st["terrain"]].get("attribution"):
        attribution = TERRAIN[st["terrain"]]["attribution"]
    return {
        "key": key, "requested": style_key, "engine": engine, "style": style,
        "terrain": terrain, "attribution": attribution,
        "region": ({"id": region["id"], "name": "/".join(r["name"] for r in stack),
                    "ids": [r["id"] for r in stack]} if region else None),
        "notes": notes, "badge": style_badge(key), "video_ok": video_ok(key),
        "provider": st["provider"],
    }


def catalog_for_ui(*, has_mapbox: bool, has_maptiler: bool, proxy_base: str = "") -> dict:
    """Alles, was die Oberfläche braucht, um Listen zu bauen und Stile selbst
    aufzulösen — OHNE Schlüsselwerte (die holt sie getrennt)."""
    return {
        "default": DEFAULT_STYLE,
        "group_order": list(GROUP_ORDER),
        "styles": [
            {"key": s["key"], "provider": s["provider"], "kind": s["kind"], "group": s["group"],
             "label": s["label"], "terrain": s["terrain"], "badge": PROVIDERS[s["provider"]]["badge"],
             "style_url": s.get("style_url"), "tiles": s.get("tiles"), "tileSize": s.get("tileSize", 256),
             "maxzoom": s.get("maxzoom", 19), "attribution": s.get("attribution", ""),
             "available": ((s["provider"] != "mapbox" or has_mapbox)
                           and (s["provider"] != "maptiler" or has_maptiler))}
            for s in STYLES
        ],
        "terrain": {k: ({**t, "tiles": [proxy_base.rstrip("/") + "/tile/" + TERRAIN_AWS_PROXY_ID + "/{z}/{x}/{y}"]}
                        if (k == "aws" and proxy_base) else t) for k, t in TERRAIN.items()},
        "regions": [
            {"id": r["id"], "name": r["name"], "country": r["country"], "bbox": list(r["bbox"]),
             "maxzoom": r.get("maxzoom", 19), "tiles": region_tiles(r),
             "scheme": r.get("scheme", "xyz"), "attribution": r["attribution"],
             "tiles_transparent": region_tiles(r, transparent=True),
             "leaflet": region_leaflet(r), "leaflet_transparent": region_leaflet(r, transparent=True)}
            for r in ORTHO_REGIONS
        ],
        "keys": {"mapbox": bool(has_mapbox), "maptiler": bool(has_maptiler)},
        "base_layer": BASE_LAYER, "ortho_minzoom": ORTHO_MINZOOM,
        "terms_links": TERMS_LINKS,
        # Lokale Kachel-Weiche (core/tileproxy.py); leer = direkt zum Dienst
        "proxy_base": proxy_base or "",
    }
