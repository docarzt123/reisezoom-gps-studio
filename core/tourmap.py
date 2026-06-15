"""
Tour-Karten-PNG-Generator: rendert eine GPX als statische Karte
(ein Mapbox-Frame mit komplettem Track + optionalen Stats-Boxen).

Use-Case: YouTube-Thumbnails, Instagram-Posts, Komoot-/Blog-Cover-Images.
Anders als der Animator: kein Video, keine Animation — ein Frame, ein PNG.

Nutzt die gleiche Mapbox-Render-Pipeline (Playwright + Headless-Chromium)
für identische Optik wie der Animator-Output.
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

# Wir teilen das Overlay-CSS mit dem Animator — gleiche Stats-Box-Optik,
# gleiche Skalierungs-Logik. Reuse vermeidet Drift zwischen beiden Modulen.
from .animator import _overlay_css, _dasharray_mapbox, _render_dsf, _render_ss  # type: ignore


_log = logging.getLogger("tourmap")


# Mapbox-Style-URL-Mapping identisch zum Animator
MAP_STYLES = {
    "satellite":         "mapbox://styles/mapbox/standard-satellite",
    "satellite_streets": "mapbox://styles/mapbox/satellite-streets-v12",
    "streets":           "mapbox://styles/mapbox/streets-v12",
    "outdoors":          "mapbox://styles/mapbox/outdoors-v12",
    "light":             "mapbox://styles/mapbox/light-v11",
    "dark":              "mapbox://styles/mapbox/dark-v11",
}


@dataclass
class TourmapConfig:
    gpx_path: str
    output_path: str
    mapbox_token: str
    map_style: str = "satellite"
    width: int = 1920
    height: int = 1080
    pitch: float = 35.0
    bearing: float = -10.0
    # Wieviel Padding um die Track-Bounds (in % der kürzeren Achse)
    padding_pct: float = 8.0
    exaggeration: float = 1.5
    enable_terrain: bool = True
    line_color: str = "#ff6b35"
    line_width: float = 4.5
    # Linien-Stil (v0.6.5) — siehe Doku in core/animator.py
    line_style: str = "solid"
    # Spacing-Faktor (v0.6.6) — analog Animator.
    line_style_spacing: float = 1.0
    # Track-Optik (v0.8.10) — analog Animator. "flat" = klassisch,
    # "tube" = weißer Highlight-Streifen oben drauf → 3D-Wurm-Look.
    track_style: str = "flat"
    # Glow um die Track-Linie (v0.6.8) — analog Animator. Tour-Map hat
    # keinen Schlagschatten (war nie ein Feature), aber den Glow gibt's
    # genauso. Default-Werte identisch zum Animator.
    glow_enabled: bool = True
    glow_strength: float = 4.0
    # === Karten-Feinabstimmung (v0.5.0) ===
    # Identische Felder wie im Animator — siehe ausführliche Doku dort.
    light_preset: str = "day"   # "dawn" | "day" | "dusk" | "night"
    show_place_labels: bool = True
    show_road_labels: bool = True
    show_poi_labels: bool = True
    show_transit_labels: bool = True
    show_admin_boundaries: bool = True
    # DEPRECATED — Master-Toggle für „alle Beschriftungen aus".
    hide_labels: bool = False
    # Stats-Boxen (wie im Animator, aber ohne "Live"-Box weil's statisch ist)
    show_overlays: bool = True
    overlay_totals_enabled: bool = True
    overlay_totals_position: str = "tl"      # tl|tr|bl|br
    overlay_elevation_enabled: bool = False  # für Thumbnails meist zu busy
    overlay_elevation_position: str = "bc"
    # Start-/End-Pin auf der Karte zeigen?
    show_pins: bool = True
    # OPTIONAL: Wenn das UI bereits einen Viewport hat (User hat gepant/gezoomt),
    # können wir den explizit übernehmen statt mit bounds-fit zu rechnen.
    # Wenn None → Default-Verhalten (Mapbox berechnet Center+Zoom aus Bbox).
    override_center: Optional[tuple[float, float]] = None
    override_zoom: Optional[float] = None
    # v0.9.74 — Foto-Pins (Phase 1, Spiegelung Animator). Permanent sichtbar
    # auf der finalen Karte; Single-Frame-Render → keine Zeit-Steuerung nötig.
    photos: list = field(default_factory=list)
    photos_size_px: int = 48
    photos_show: bool = True

    # v0.9.279 (Beta-Tester-Crash-Fix) — Ghost-Felder gespiegelt vom AnimatorConfig.
    # WARUM hier nötig: app.py.tourmap_render schleift dieselben ghost_*-Params
    # durch wie animator_render. Fehlten die Felder, crashte das TourMap-Rendern
    # mit „TourmapConfig got unexpected keyword 'ghost_track_enabled'".
    # ghost_track_* (eigener Track blass als „Geist" der animierten Linie) ist für
    # eine STATISCHE TourMap inhaltlich sinnlos — der ganze Track ist immer
    # durchgezogen sichtbar — wird also angenommen, aber NICHT gerendert.
    # ghost_gpx_* (zweite Vergleichs-GPX) wird hingegen gerendert (siehe _make_html).
    ghost_track_enabled: bool = False
    ghost_track_opacity: float = 0.30
    ghost_track_color: str = "#ff6b35"
    ghost_gpx_coords: list = field(default_factory=list)
    ghost_gpx_color: str = "#7fa8ff"
    ghost_gpx_opacity: float = 0.60
    ghost_gpx_width: float = 2.5
    ghost_gpx_dashed: bool = True


def _format_km(m: float) -> str:
    return f"{m / 1000:.1f} km" if m < 100000 else f"{m / 1000:.0f} km"


def _format_dur(s: float) -> str:
    s = int(s)
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    return f"{h}:{m:02d}:{sec:02d}" if h else f"{m:02d}:{sec:02d}"


def _bounds_zoom_with_padding(points, w: int, h: int, pad_pct: float):
    """Mapbox-Zoom so wählen dass der Track komplett rein passt + `pad_pct` % Rand."""
    lons = [p.lon for p in points]
    lats = [p.lat for p in points]
    min_lon, max_lon = min(lons), max(lons)
    min_lat, max_lat = min(lats), max(lats)
    center = ((min_lon + max_lon) / 2, (min_lat + max_lat) / 2)
    max_diff = max(max_lon - min_lon, max_lat - min_lat)
    if max_diff == 0:
        zoom = 15.0
    else:
        zoom = math.log2(360 / max_diff) + math.log2(min(w, h) / 512)
        # Pitch verzerrt → wir lassen etwas extra Luft. Plus User-Padding.
        zoom_correction = 0.8 + (pad_pct / 100.0) * 3.0
        zoom = max(6.0, min(17.0, zoom - zoom_correction))
    return center, zoom


def _make_html(cfg: TourmapConfig, coords: list, total_stats: dict,
               bbox: tuple, ele_min: float, ele_max: float,
               elevations: list) -> str:
    """Baut die Playwright-HTML-Seite. Komplette Spur sofort, kein advanceFrame.

    Wichtig für WYSIWYG: nutzt `mapboxgl.Map`-Option `bounds` +
    `fitBoundsOptions` damit Mapbox selbst Center+Zoom aus dem Bbox berechnet
    — gleicher Algorithmus wie `map.fitBounds()` im Frontend-Preview.
    Damit deckt sich Render und Vorschau geometrisch.
    """
    style_url = MAP_STYLES.get(cfg.map_style, MAP_STYLES["satellite"])
    coords_json = json.dumps(coords)
    min_lon, min_lat, max_lon, max_lat = bbox
    # Padding als Pixel-Wert, proportional zur kürzeren Render-Achse.
    # Formel MUSS identisch im Frontend sein (_padFactorPx in module.js).
    pad_factor = 0.05 + (cfg.padding_pct / 100.0)
    px_pad = max(2, int(round(pad_factor * min(cfg.width, cfg.height))))

    # Overlay-HTML zusammenbauen (analog Animator, aber keine Live-Box)
    overlays_block = ""
    # v0.9.24 — Spiegelung zu Animator: bei Track ohne Zeit/Höhe entsprechende
    # Stat-Zeilen ausblenden statt „0 m" / „00:00" anzuzeigen.
    has_time = bool(total_stats.get('duration_s'))
    has_ele = total_stats.get('ele_max') is not None and total_stats.get('ele_min') is not None
    if cfg.show_overlays:
        if cfg.overlay_totals_enabled:
            _rows = [f'<div class="stat-row"><span class="label">Strecke</span><span class="value">{_format_km(total_stats["distance_m"])}</span></div>']
            if has_time:
                _rows.append(f'<div class="stat-row"><span class="label">Zeit</span><span class="value">{_format_dur(total_stats["duration_s"])}</span></div>')
            if has_ele:
                _rows.append(f'<div class="stat-row"><span class="label">Bergauf</span><span class="value">&uarr; {total_stats["ascent_m"]:.0f} m</span></div>')
                _rows.append(f'<div class="stat-row"><span class="label">Bergab</span><span class="value">&darr; {total_stats["descent_m"]:.0f} m</span></div>')
                _rows.append(f'<div class="stat-row"><span class="label">Max. H&ouml;he</span><span class="value">{total_stats["ele_max"]:.0f} m</span></div>')
            overlays_block += f"""
<div class="stats-box pos-{cfg.overlay_totals_position}">
  {chr(10).join(_rows)}
</div>"""
        # Höhenprofil nur wenn echte Höhendaten vorhanden — sonst leerer Strich.
        if cfg.overlay_elevation_enabled and elevations and has_ele:
            # Komplettes Höhenprofil, voll gefüllt (keine Animation)
            W, H, PY = 1000, 120, 10
            rng = (ele_max - ele_min) or 1
            xy_pts = []
            for i, e in enumerate(elevations):
                x = (i / max(1, len(elevations) - 1)) * W
                y = H - PY - ((e - ele_min) / rng) * (H - PY * 2)
                xy_pts.append(f"{x:.1f},{y:.1f}")
            poly_pts = " ".join(xy_pts)
            fill_pts = f"{xy_pts[0].split(',')[0]},{H} {poly_pts} {xy_pts[-1].split(',')[0]},{H}" if xy_pts else ""
            overlays_block += f"""
<div id="overlay-bottom" class="pos-{cfg.overlay_elevation_position}">
  <div class="ele-header">
    <span class="ele-title">H&ouml;henprofil</span>
    <span class="ele-minmax">Min {ele_min:.0f} m<span class="sep">&bull;</span>Max {ele_max:.0f} m</span>
  </div>
  <svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" style="flex:1; width:100%;">
    <defs>
      <linearGradient id="ele-grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="{cfg.line_color}" stop-opacity="0.55"/>
        <stop offset="100%" stop-color="{cfg.line_color}" stop-opacity="0.02"/>
      </linearGradient>
    </defs>
    <polygon points="{fill_pts}" fill="url(#ele-grad)"/>
    <polyline points="{poly_pts}" fill="none" stroke="{cfg.line_color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>
</div>"""

    # JS-Block für Karten-Feinabstimmung — siehe ausführliche Doku im Animator.
    pl = cfg.show_place_labels and not cfg.hide_labels
    rl = cfg.show_road_labels and not cfg.hide_labels
    pi = cfg.show_poi_labels and not cfg.hide_labels
    tl = cfg.show_transit_labels and not cfg.hide_labels
    ab = cfg.show_admin_boundaries
    hide_labels_block = (
        "(function applyMapConfig(){"
        f"  const lightPreset = '{cfg.light_preset}';"
        f"  const showPlace = {str(pl).lower()};"
        f"  const showRoad = {str(rl).lower()};"
        f"  const showPoi = {str(pi).lower()};"
        f"  const showTransit = {str(tl).lower()};"
        f"  const showAdmin = {str(ab).lower()};"
        "  try { map.setConfigProperty('basemap', 'lightPreset', lightPreset); } catch(_){}"
        "  try { map.setConfigProperty('basemap', 'showPlaceLabels', showPlace); } catch(_){}"
        "  try { map.setConfigProperty('basemap', 'showRoadLabels', showRoad); } catch(_){}"
        "  try { map.setConfigProperty('basemap', 'showPointOfInterestLabels', showPoi); } catch(_){}"
        "  try { map.setConfigProperty('basemap', 'showTransitLabels', showTransit); } catch(_){}"
        "  try { map.setConfigProperty('basemap', 'showAdminBoundaries', showAdmin); } catch(_){}"
        "  const s = map.getStyle(); if(!s || !s.layers) return;"
        "  s.layers.forEach(l => {"
        "    if (l.type !== 'symbol' && l.type !== 'line') return;"
        "    const id = l.id.toLowerCase();"
        "    let want = null;"
        "    if (id.includes('admin') || id.includes('boundary') || id.includes('country-boundary')) want = showAdmin;"
        "    else if (id.includes('road') || id.includes('street') || id.includes('path')) want = (l.type === 'line') ? null : showRoad;"
        "    else if (id.includes('poi')) want = showPoi;"
        "    else if (id.includes('transit') || id.includes('airport') || id.includes('rail') || id.includes('ferry')) want = showTransit;"
        "    else if (id.includes('place') || id.includes('settlement') || id.includes('country-label') || id.includes('state-label')) want = showPlace;"
        "    if (want === null) return;"
        "    try { map.setLayoutProperty(l.id, 'visibility', want ? 'visible' : 'none'); } catch(_){}"
        "  });"
        "})();"
    )

    terrain_block = ""
    if cfg.enable_terrain:
        terrain_block = f"""
    map.addSource('mapbox-dem', {{
      type: 'raster-dem', url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
      tileSize: 512, maxzoom: 14
    }});
    map.setTerrain({{ source: 'mapbox-dem', exaggeration: {cfg.exaggeration} }});
"""

    # Map-Init-Variante: User-Override (WYSIWYG nach Pan/Zoom) oder bounds-fit
    if cfg.override_center is not None and cfg.override_zoom is not None:
        ovc = cfg.override_center
        # v0.9.131 — 4K-WYSIWYG-Fix. Das Frontend rechnet override_zoom via
        # correctedZoom() auf die VOLLE Render-Breite (cfg.width) hoch. Der
        # Render läuft aber mit einem CSS-Viewport von cfg.width / dsf
        # (device_scale_factor=dsf macht nur die Pixeldichte, nicht den
        # geografischen Ausschnitt). Mapbox-Zoom ist relativ zu CSS-Pixeln,
        # also ist der Zoom bei dsf>1 um log2(dsf) zu hoch → bei 4K (dsf=2)
        # exakt 1 Zoom-Stufe zu weit reingezoomt, bei 1080p (dsf=1) kein
        # Fehler. Korrektur: override_zoom - log2(dsf).
        _ov_dsf = _render_dsf(cfg.width, cfg.height)
        _ov_zoom = cfg.override_zoom - (math.log2(_ov_dsf) if _ov_dsf > 0 else 0.0)
        map_init = (
            f"const map = new mapboxgl.Map({{\n"
            f"  container: 'map', style: '{style_url}',\n"
            f"  center: [{ovc[0]}, {ovc[1]}],\n"
            f"  zoom: {_ov_zoom},\n"
            f"  pitch: {cfg.pitch}, bearing: {cfg.bearing},\n"
            f"  preserveDrawingBuffer: true, antialias: true, fadeDuration: 0\n"
            f"}});"
        )
        _log.info("Using UI viewport override: center=[%.6f,%.6f] zoom=%.2f (dsf-korrigiert von %.2f, dsf=%.2f)",
                  ovc[0], ovc[1], _ov_zoom, cfg.override_zoom, _ov_dsf)
    else:
        map_init = (
            f"const map = new mapboxgl.Map({{\n"
            f"  container: 'map', style: '{style_url}',\n"
            f"  bounds: [[{min_lon}, {min_lat}], [{max_lon}, {max_lat}]],\n"
            f"  fitBoundsOptions: {{\n"
            f"    padding: {px_pad},\n"
            f"    pitch: {cfg.pitch},\n"
            f"    bearing: {cfg.bearing},\n"
            f"  }},\n"
            f"  preserveDrawingBuffer: true, antialias: true, fadeDuration: 0\n"
            f"}});"
        )

    # v0.9.74 — Foto-Pins (Phase 1, Spiegelung Animator). JS-Block der
    # pro Foto ein Image lädt und addImage + Symbol-Layer einhängt.
    if cfg.photos_show and cfg.photos:
        # v0.9.77 — per-Foto visible-Flag (Spiegelung Animator)
        photos_for_render = [{
            "lon": float(p.get("lon", 0)),
            "lat": float(p.get("lat", 0)),
            "thumb": p.get("thumb"),
        } for p in cfg.photos
            if p.get("thumb") and p.get("visible", True) is not False]
        photos_json_str = json.dumps(photos_for_render)
        photos_size_factor = max(12, min(200, int(cfg.photos_size_px))) / 64.0
        photo_pins_block = (
            "const __photoPins = " + photos_json_str + ";\n"
            "if (__photoPins.length) {\n"
            "  let __loaded = 0;\n"
            "  const __onAllLoaded = () => {\n"
            "    if (map.getSource('photo-pins-src')) return;\n"
            "    map.addSource('photo-pins-src', {type:'geojson', data:{\n"
            "      type:'FeatureCollection',\n"
            "      features: __photoPins.map((p, i) => ({\n"
            "        type:'Feature', id:i,\n"
            "        properties:{ imgId: 'photo-thumb-'+i },\n"
            "        geometry:{ type:'Point', coordinates:[p.lon, p.lat] }\n"
            "      }))\n"
            "    }});\n"
            "    map.addLayer({\n"
            "      id:'photo-pins-lyr', type:'symbol', source:'photo-pins-src',\n"
            "      layout:{\n"
            "        'icon-image': ['get', 'imgId'],\n"
            f"        'icon-size': {photos_size_factor:.4f},\n"
            "        'icon-allow-overlap': true,\n"
            "        'icon-ignore-placement': true,\n"
            "        'icon-anchor': 'center'\n"
            "      }\n"
            "    });\n"
            "  };\n"
            "  __photoPins.forEach((p, i) => {\n"
            "    const id = 'photo-thumb-'+i;\n"
            "    const im = new Image();\n"
            "    im.onload = () => {\n"
            "      if (!map.hasImage(id)) map.addImage(id, im, {pixelRatio:2});\n"
            "      __loaded += 1;\n"
            "      if (__loaded === __photoPins.length) __onAllLoaded();\n"
            "    };\n"
            "    im.onerror = () => {\n"
            "      __loaded += 1;\n"
            "      if (__loaded === __photoPins.length) __onAllLoaded();\n"
            "    };\n"
            "    im.src = p.thumb;\n"
            "  });\n"
            "}\n"
        )
    else:
        photo_pins_block = "// no photo pins\n"

    pins_block = ""
    if cfg.show_pins and coords:
        first = coords[0]
        last = coords[-1]
        pins_block = f"""
    map.addSource('pins', {{
      type: 'geojson',
      data: {{
        type: 'FeatureCollection',
        features: [
          {{ type: 'Feature', properties: {{kind: 'start'}}, geometry: {{ type: 'Point', coordinates: [{first[0]}, {first[1]}] }} }},
          {{ type: 'Feature', properties: {{kind: 'end'}},   geometry: {{ type: 'Point', coordinates: [{last[0]}, {last[1]}] }} }}
        ]
      }}
    }});
    map.addLayer({{
      id: 'pin-glow', type: 'circle', source: 'pins',
      paint: {{ 'circle-radius': 14, 'circle-color': '#ffffff', 'circle-opacity': 0.3, 'circle-blur': 0.7, 'circle-pitch-alignment': 'map' }}
    }});
    map.addLayer({{
      id: 'pin-core', type: 'circle', source: 'pins',
      paint: {{
        'circle-radius': 7,
        'circle-color': ['match', ['get', 'kind'], 'start', '#ffffff', 'end', '{cfg.line_color}', '#fff'],
        'circle-stroke-color': ['match', ['get', 'kind'], 'start', '{cfg.line_color}', 'end', '#ffffff', '#fff'],
        'circle-stroke-width': 2.5,
        'circle-pitch-alignment': 'map'
      }}
    }});
"""

    # v0.9.279 — zweite Vergleichs-GPX als blasse, gestrichelte Linie (Spiegelung
    # animator.py „_gpx_ghost_js"). Wird VOR dem Haupt-Track-Layer eingefügt,
    # damit der echte Track oben drauf liegt.
    _tm_gpx_ghost_js = "// gpx-ghost off"
    _gg_coords = getattr(cfg, "ghost_gpx_coords", None) or []
    if len(_gg_coords) > 1:
        _gg = json.dumps([[float(c[0]), float(c[1])] for c in _gg_coords])
        _gg_zoff = ",'line-z-offset':150" if cfg.enable_terrain else ""
        _gg_dash = ",'line-dasharray':[2,2]" if getattr(cfg, "ghost_gpx_dashed", True) else ""
        _gg_col = str(getattr(cfg, "ghost_gpx_color", "#7fa8ff"))
        _gg_op = max(0.0, min(1.0, float(getattr(cfg, "ghost_gpx_opacity", 0.60))))
        _gg_w = float(getattr(cfg, "ghost_gpx_width", 2.5))
        _tm_gpx_ghost_js = (
            "map.addSource('gpx-ghost',{type:'geojson',data:{type:'Feature',geometry:{type:'LineString',coordinates:"
            + _gg + "}}});"
            "map.addLayer({id:'gpx-ghost',type:'line',source:'gpx-ghost',"
            "layout:{'line-cap':'round','line-join':'round'},"
            f"paint:{{'line-color':'{_gg_col}','line-width':{_gg_w:.2f},'line-opacity':{_gg_op:.2f}"
            + _gg_dash + _gg_zoff + "}});"
        )

    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8">
<script src="https://api.mapbox.com/mapbox-gl-js/v3.12.0/mapbox-gl.js"></script>
<link href="https://api.mapbox.com/mapbox-gl-js/v3.12.0/mapbox-gl.css" rel="stylesheet">
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body, html {{ width: 100%; height: 100%; overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }}
  #map {{ width: 100%; height: 100%; }}
{_overlay_css(cfg)}
</style></head>
<body>
<div id="map"></div>
{overlays_block}
<script>
mapboxgl.accessToken = '{cfg.mapbox_token}';
const allCoords = {coords_json};
{map_init}
let mapReady = false;
map.on('style.load', () => {{
  {hide_labels_block}
  {terrain_block}
  {_tm_gpx_ghost_js}
  map.addSource('track', {{ type: 'geojson', data: {{ type: 'Feature', geometry: {{ type: 'LineString', coordinates: allCoords }} }} }});
  // Round caps + line-join für saubere Track-Endungen (statt Mapbox-Default
  // butt/miter). Plus line-dasharray bei nicht-solid Linien-Stil.
  {("map.addLayer({ id: 'track-glow', type: 'line', source: 'track',"
    "layout: { 'line-cap': 'round', 'line-join': 'round' },"
    # v0.9.20 — Spiegelung Animator: Glow-line-width skaliert mit glow_strength.
    f"paint: {{ 'line-color': '{cfg.line_color}', 'line-width': {cfg.line_width * (2.0 + 0.21 * cfg.glow_strength):.2f}, 'line-opacity': 0.35, 'line-blur': {cfg.glow_strength:.1f}"
    + (f",'line-dasharray':{_dasharray_mapbox(cfg.line_style, cfg.line_style_spacing)}" if _dasharray_mapbox(cfg.line_style, cfg.line_style_spacing) else "")
    + (",'line-z-offset':150" if cfg.enable_terrain else "")
    + "} });") if cfg.glow_enabled and cfg.glow_strength > 0 else "// glow disabled"}
  map.addLayer({{ id: 'track-line', type: 'line', source: 'track',
    layout: {{ 'line-cap': 'round', 'line-join': 'round' }},
    paint: {{ 'line-color': '{cfg.line_color}', 'line-width': {cfg.line_width:.2f}, 'line-opacity': 0.95{f",'line-dasharray':{_dasharray_mapbox(cfg.line_style, cfg.line_style_spacing)}" if _dasharray_mapbox(cfg.line_style, cfg.line_style_spacing) else ""}{",'line-z-offset':150" if cfg.enable_terrain else ''} }} }});
  // v0.8.10 — Track-Optik „tube" (3D-Wurm, Beta-Tester-Wunsch): weißer
  // Highlight-Streifen oben auf der Track-Linie. Synchron zu core/animator.py.
  {("map.addLayer({ id: 'track-highlight', type: 'line', source: 'track',"
    "layout: { 'line-cap': 'round', 'line-join': 'round' },"
    f"paint: {{ 'line-color': '#ffffff', 'line-width': {cfg.line_width * 0.35:.2f}, 'line-opacity': 0.55, 'line-blur': 0.6"
    + (f",'line-dasharray':{_dasharray_mapbox(cfg.line_style, cfg.line_style_spacing)}" if _dasharray_mapbox(cfg.line_style, cfg.line_style_spacing) else "")
    + (",'line-z-offset':150" if cfg.enable_terrain else "")
    + "} });") if cfg.track_style == "tube" else "// no tube highlight"}
  {pins_block}
  // v0.9.74 — Foto-Pins (Phase 1).
{photo_pins_block}
}});
map.on('idle', () => {{ if (!mapReady) {{ mapReady = true; window._mapReady = true; }} }});
window.isReady = () => window._mapReady === true;
</script></body></html>"""


async def render_png(cfg: TourmapConfig,
                     on_progress: Optional[Callable[[float, str], None]] = None,
                     is_cancelled: Optional[Callable[[], bool]] = None) -> str:
    """Rendert die Tour als statische PNG.

    Returns: Pfad zum gerenderten PNG.
    """
    def emit(p: float, msg: str) -> None:
        if on_progress:
            try: on_progress(p, msg)
            except Exception: pass

    def check_cancel() -> None:
        if is_cancelled and is_cancelled():
            raise RuntimeError("Vom User abgebrochen")

    from .gpx import parse_gpx as core_parse_gpx, downsample

    emit(0.05, "GPX laden …")
    _log.info("render_png start · GPX=%s · output=%s", cfg.gpx_path, cfg.output_path)
    if not cfg.mapbox_token or not cfg.mapbox_token.startswith("pk."):
        raise RuntimeError("Tour-Karten brauchen einen Mapbox-Token (Settings → Mapbox-Token).")

    raw_points, total_stats = core_parse_gpx(cfg.gpx_path)
    # Tour-Karten brauchen mehr Punkte als Animator (statisches Bild → keine Performance-Sorge)
    points = downsample(raw_points, 1500)
    coords = [[p.lon, p.lat] for p in points]
    elevations = [p.ele if p.ele is not None else 0.0 for p in points]
    ele_min = min(elevations) if elevations else 0.0
    ele_max = max(elevations) if elevations else 0.0
    # Bbox aus Track berechnen — Mapbox in der Headless-Page macht den Fit selbst.
    lons = [p.lon for p in points]
    lats = [p.lat for p in points]
    bbox = (min(lons), min(lats), max(lons), max(lats))
    _log.info("Bbox: %s · padding=%.1f%% · viewport=%dx%d",
              bbox, cfg.padding_pct, cfg.width, cfg.height)

    total_stats_dict = {
        "distance_m": total_stats.distance_m,
        "duration_s": total_stats.duration_s,
        "ascent_m": total_stats.ascent_m,
        "descent_m": total_stats.descent_m,
        "ele_min": total_stats.ele_min,
        "ele_max": total_stats.ele_max,
    }
    html = _make_html(cfg, coords, total_stats_dict, bbox, ele_min, ele_max, elevations)

    emit(0.20, "Chromium starten …")
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        try:
            browser = await p.chromium.launch(
                headless=True,
                args=["--use-angle=default", "--enable-webgl", "--ignore-gpu-blocklist", "--disable-gpu-sandbox"],
            )
        except Exception as e:
            _log.error("Playwright/Chromium-Start fehlgeschlagen: %s", e)
            raise

        # v0.9.20 — DSF-skaliertes Viewport (Spiegelung Animator). Sorgt dafür
        # dass Mapbox line-widths/blur/font-sizes als CSS-Pixel interpretiert
        # und der Output bei 4K denselben visuellen Anteil im Frame hat wie
        # die Retina-Preview im App.
        _dsf = _render_dsf(cfg.width, cfg.height)
        _ss = _render_ss(cfg.width, cfg.height)  # v0.9.286: SSAA bei 4K (Spiegelung Animator)
        _vp_w = max(1, int(round(cfg.width / _dsf)))
        _vp_h = max(1, int(round(cfg.height / _dsf)))
        _log.info("Tour-Map: Playwright viewport=%dx%d CSS · DSF=%.2f · SSAA=%.2f · output=%dx%d device px",
                  _vp_w, _vp_h, _dsf, _ss, cfg.width, cfg.height)
        if _ss > 1.0:
            _log.info("Tour-Map SSAA aktiv (4K): Capture %dx%d → Lanczos-Downscale auf %dx%d",
                      int(_vp_w * _dsf * _ss), int(_vp_h * _dsf * _ss), cfg.width, cfg.height)
        page = await browser.new_page(
            viewport={"width": _vp_w, "height": _vp_h},
            device_scale_factor=_dsf * _ss,
        )
        page.on("console", lambda m: _log.info("page.console [%s] %s", m.type, m.text))
        page.on("pageerror", lambda e: _log.error("page.pageerror: %s", e))

        emit(0.35, "Karte vorbereiten …")
        await page.set_content(html)

        for _ in range(60):
            check_cancel()
            ready = await page.evaluate("window.isReady()")
            if ready:
                break
            await asyncio.sleep(0.5)

        # Terrain-Tiles + Satellite-Tiles vollständig laden lassen
        emit(0.65, "Tiles nachladen …")
        await asyncio.sleep(3)
        check_cancel()

        emit(0.85, "PNG screenshot …")
        # Output-Verzeichnis sicherstellen
        Path(cfg.output_path).parent.mkdir(parents=True, exist_ok=True)
        if _ss > 1.0:
            # v0.9.286 SSAA: in SS×-Auflösung greifen, per Lanczos auf Zielgröße
            # runterskalieren → anti-aliasing des feinen 4K-Satelliten-Details.
            import io
            from PIL import Image
            raw = await page.screenshot(type="png", full_page=False)
            im = Image.open(io.BytesIO(raw))
            if im.size != (cfg.width, cfg.height):
                im = im.resize((cfg.width, cfg.height), Image.LANCZOS)
            im.save(cfg.output_path, format="PNG")
        else:
            await page.screenshot(path=cfg.output_path, type="png", full_page=False)
        try:
            sz = Path(cfg.output_path).stat().st_size
            _log.info("Output OK: %s (%.1f MB)", cfg.output_path, sz / 1_000_000)
        except Exception:
            pass
        await browser.close()

    emit(1.0, "Fertig.")
    return cfg.output_path
