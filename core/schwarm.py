"""Der Schwarm — alle Touren einer Auswahl laufen GLEICHZEITIG los.

Marc (24.08.2026, IDEAS §33): „guck ich so auf Teneriffa drauf. Da laufen dann
alle Wanderungen gleichzeitig los, gleich schnell. Ist dann 'n cooler Effekt."
Gebaut am 28.08.2026 auf Marcs Ansage: „die längste bestimmt die videodauer."

Nicht zu verwechseln mit dem Zusammenführen und dem Multi-Track-Render
(core/animator.py::_render_multi): Die reihen Touren NACHEINANDER zu einer
Reise, mit Kinoflügen dazwischen. Der Schwarm zeigt sie NEBENEINANDER in
derselben Zeit — die Kamera steht still über allen Touren, N Laufpunkte ziehen
gleichzeitig ihre Spuren.

Die eine fachliche Entscheidung (Marc): **gleiche Geschwindigkeit**, nicht
„gleichzeitig im Ziel". Jede Tour läuft in ihrer echten Länge; die längste
bestimmt die Videodauer, kürzere sind früher fertig und ihr Punkt bleibt am
Ziel stehen. Man sieht sofort, welche Tour die große war. Ehrlich.

Wie „gleich schnell" technisch entsteht
---------------------------------------
Alle Touren werden mit DEMSELBEN Punktabstand `s` (Meter) äquidistant neu
abgetastet. Dann ist ein globaler Index `g` je Frame für jede Tour dieselbe
zurückgelegte Distanz `g·s` — Bild f je Tour ist ein simples
`coords.slice(0, min(g, k_i))`, kein Suchen, keine Zeitachse. GPX-Zeitstempel
spielen absichtlich KEINE Rolle: Es geht um den Effekt, nicht um eine
Wettkampf-Auswertung.

Warum schneiden statt maskieren: `line-gradient`/`line-trim-offset` sind
Paint-Eigenschaften des LAYERS und gelten für alle Features gleich — der
Fortschritt je Tour lässt sich damit nicht steuern (IDEAS §33). Deshalb eine
GeoJSON-Quelle mit N LineStrings, deren Koordinaten pro Frame wachsen, plus
eine Punkt-Quelle mit N Laufpunkten. Farbe je Tour über `['get','color']`.

Der Deckel: 154 Teneriffa-Touren × 400 Punkte wären 60k Koordinaten je Frame.
`punktabstand()` wählt `s` so, dass die Summe unter MAX_PUNKTE_GESAMT bleibt
und die längste Tour trotzdem nie gröber als nötig wird.
"""
from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

from . import i18n as _i18n
from .frame_driver import FrameMuxer, muxer_fuer as _muxer_fuer, teildatei as _teildatei
from .gpx import parse_gpx as core_parse_gpx
from .logger import get_logger
from .animator import (MAP_STYLES, MAX_PUNKTE_GESAMT, MAX_PUNKTE_LAENGSTE,   # noqa: F401
                       MIN_ABSTAND_M, RenderCancelled, find_ffmpeg, _grab_frame,
                       _mapbox_gl_head, _render_dsf, _render_ss,
                       punktabstand, resample_aequidistant)

_log = get_logger("schwarm")


@dataclass
class SchwarmConfig:
    """Bewusst schlank — der Schwarm ist ein eigener Modus, kein Animator-Klon.

    Overlays, Keyframes, Schilder, Terrain, Intro-Flüge: alles rechnet mit
    EINEM Track und ergibt hier keinen Sinn (IDEAS §33). Was fehlt, fehlt mit
    Absicht.
    """
    tracks: list = field(default_factory=list)   # [{gpx_path, color, name}]
    output_path: str = ""
    mapbox_token: str = ""
    map_style: str = "outdoors"
    width: int = 1920
    height: int = 1080
    fps: int = 25
    duration_s: float = 20.0     # Laufzeit der LÄNGSTEN Tour — Marcs Regel
    hold_s: float = 3.0          # Standbild am Ende
    line_width: float = 3.0
    codec: str = "h264"
    crf: int = 18
    encoder_preset: str = "fast"
    ui_lang: str = ""
    overlay: bool = True         # kleines Zähl-Overlay oben links
    # Von _grab_frame erwartet (gleiche Semantik wie AnimatorConfig):
    transparent_background: bool = False
    frame_format: str = "jpeg"
    jpeg_quality: int = 92


def _esc(s: str) -> str:
    return (str(s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def make_schwarm_html(cfg: SchwarmConfig, touren: list, bbox: tuple,
                      gesamt_km: float = 0.0) -> str:
    """Die Render-Seite: eine Karte, zwei GeoJSON-Quellen, ein advanceFrame.

    `touren`: [{"coords": [[lon,lat],…], "color": "#…", "name": str}] — schon
    äquidistant abgetastet. `bbox` = (min_lon, min_lat, max_lon, max_lat).
    """
    _t = _i18n.uebersetzer(cfg.ui_lang)
    style_url = MAP_STYLES.get(cfg.map_style, MAP_STYLES["outdoors"])
    coords_js = json.dumps([t["coords"] for t in touren])
    colors_js = json.dumps([t["color"] for t in touren])
    overlay_html = ""
    overlay_js = "function overlayUpdate(fertig){}"
    if cfg.overlay:
        # Ein Zähl-Overlay, mehr nicht: „N Touren · X km · noch unterwegs: m".
        # Höhenprofil/Keyframes/Live-Werte ergeben im Schwarm keinen Sinn.
        overlay_html = (
            '<div id="ov">'
            f'<b>{len(touren)} ' + _esc(_t("schwarm.overlay.touren", "Touren")) + "</b>"
            ' · <span id="ov-km"></span>'
            ' · <span id="ov-lauf"></span>'
            "</div>"
        )
        overlay_js = f"""
const OV_GESAMT_KM = GESAMT_KM;
const OV_TXT_KM = {json.dumps(_t("schwarm.overlay.km_gesamt", "{km} km gesamt"))};
const OV_TXT_LAUF = {json.dumps(_t("schwarm.overlay.unterwegs", "noch unterwegs: {n}"))};
const OV_TXT_ZIEL = {json.dumps(_t("schwarm.overlay.alle_da", "alle angekommen"))};
document.getElementById('ov-km').textContent = OV_TXT_KM.replace('{{km}}', OV_GESAMT_KM.toFixed(0));
function overlayUpdate(unterwegs) {{
  document.getElementById('ov-lauf').textContent =
    unterwegs > 0 ? OV_TXT_LAUF.replace('{{n}}', unterwegs) : OV_TXT_ZIEL;
}}
"""
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8">
{_mapbox_gl_head()}
<style>
  html, body {{ margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }}
  #map {{ position: absolute; inset: 0; }}
  #ov {{
    position: absolute; top: 18px; left: 18px; z-index: 5;
    background: rgba(14, 17, 23, 0.72); color: #fff; border-radius: 10px;
    padding: 10px 16px; font: 500 16px/1.4 -apple-system, "Segoe UI", Roboto, sans-serif;
  }}
</style></head>
<body>
<div id="map"></div>
{overlay_html}
<script>
mapboxgl.accessToken = {json.dumps(cfg.mapbox_token)};
const TOUR_COORDS = {coords_js};
const TOUR_COLORS = {colors_js};
const TOUR_N = TOUR_COORDS.length;
const GESAMT_KM = {round(gesamt_km, 1)};
const LINE_WIDTH = {cfg.line_width};

const map = new mapboxgl.Map({{
  container: 'map',
  style: {json.dumps(style_url)},
  bounds: [[{bbox[0]}, {bbox[1]}], [{bbox[2]}, {bbox[3]}]],
  fitBoundsOptions: {{ padding: 70 }},
  interactive: false,
  fadeDuration: 0,
  attributionControl: true,
}});

window._ready = false;
map.on('load', () => {{
  map.addSource('swarm-lines', {{ type: 'geojson', data: leereLinien() }});
  map.addLayer({{
    id: 'swarm-lines', type: 'line', source: 'swarm-lines',
    layout: {{ 'line-join': 'round', 'line-cap': 'round' }},
    paint: {{ 'line-color': ['get', 'color'], 'line-width': LINE_WIDTH,
             'line-opacity': 0.95 }},
  }});
  map.addSource('swarm-dots', {{ type: 'geojson', data: leerePunkte() }});
  map.addLayer({{
    id: 'swarm-dots', type: 'circle', source: 'swarm-dots',
    paint: {{
      'circle-color': ['get', 'color'],
      'circle-radius': Math.max(3, LINE_WIDTH * 1.6),
      'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5,
    }},
  }});
  window._ready = true;
}});

function leereLinien() {{
  return {{ type: 'FeatureCollection', features: TOUR_COORDS.map((c, i) => ({{
    type: 'Feature', properties: {{ color: TOUR_COLORS[i] }},
    geometry: {{ type: 'LineString', coordinates: [c[0], c[0]] }},
  }})) }};
}}
function leerePunkte() {{
  return {{ type: 'FeatureCollection', features: TOUR_COORDS.map((c, i) => ({{
    type: 'Feature', properties: {{ color: TOUR_COLORS[i] }},
    geometry: {{ type: 'Point', coordinates: c[0] }},
  }})) }};
}}

{overlay_js}

// Ein Frame: globaler Index g = zurückgelegte Distanz / Punktabstand.
// Gleiche Geschwindigkeit heißt: derselbe g für alle — kürzere Touren sind
// bei g ≥ k fertig, ihr Punkt bleibt am Ziel stehen (angekommen).
window.advanceFrameSchwarm = (g) => {{
  let unterwegs = 0;
  const linien = [], punkte = [];
  for (let i = 0; i < TOUR_N; i++) {{
    const c = TOUR_COORDS[i];
    const k = Math.min(g, c.length - 1);
    if (g < c.length - 1) unterwegs++;
    linien.push({{ type: 'Feature', properties: {{ color: TOUR_COLORS[i] }},
      geometry: {{ type: 'LineString', coordinates: k >= 1 ? c.slice(0, k + 1) : [c[0], c[0]] }} }});
    punkte.push({{ type: 'Feature', properties: {{ color: TOUR_COLORS[i] }},
      geometry: {{ type: 'Point', coordinates: c[k] }} }});
  }}
  map.getSource('swarm-lines').setData({{ type: 'FeatureCollection', features: linien }});
  map.getSource('swarm-dots').setData({{ type: 'FeatureCollection', features: punkte }});
  overlayUpdate(unterwegs);
}};

window.isReady = () => window._ready === true;

// Idle-Wait wie im Animator (v0.9.14-Lehre): Screenshot erst, wenn alle
// Kacheln geladen und gezeichnet sind — sonst weiße Placeholder im Video.
window.waitForRender = () => new Promise(r => {{
  const settleMs = 50;
  const finish = () => setTimeout(r, settleMs);
  let tilesOk = true;
  try {{ tilesOk = map.areTilesLoaded(); }} catch (_) {{ tilesOk = true; }}
  if (map.loaded() && tilesOk && !map.isMoving()) {{ finish(); return; }}
  let done = false;
  const to = setTimeout(() => {{ if (!done) {{ done = true; finish(); }} }}, 5000);
  map.once('idle', () => {{ if (!done) {{ done = true; clearTimeout(to); finish(); }} }});
}});
</script>
</body></html>"""


async def render_schwarm(
    cfg: SchwarmConfig,
    on_progress: Optional[Callable[[float, str], None]] = None,
    on_preview: Optional[Callable[[str], None]] = None,
    is_cancelled: Optional[Callable[[], bool]] = None,
) -> str:
    """Der Schwarm-Render — gleiche Callbacks wie animator.render()."""
    import base64
    import io as _io
    from PIL import Image

    _t = _i18n.uebersetzer(cfg.ui_lang)

    def emit(p: float, msg: str) -> None:
        if on_progress:
            try:
                on_progress(p, msg)
            except Exception:
                pass

    def check_cancel() -> None:
        if is_cancelled and is_cancelled():
            raise RenderCancelled("Vom User abgebrochen")

    def push_preview(png_bytes: bytes) -> None:
        if not on_preview:
            return
        try:
            img = Image.open(_io.BytesIO(png_bytes))
            img.thumbnail((1280, 1280), Image.LANCZOS)
            if img.mode in ("RGBA", "LA", "P"):
                img = img.convert("RGB")
            buf = _io.BytesIO()
            img.save(buf, format="JPEG", quality=72)
            on_preview(base64.b64encode(buf.getvalue()).decode("ascii"))
        except Exception as e:
            _log.debug("preview encode failed: %s", e)

    emit(0.0, _t("schwarm.progress.lade", "Lade Touren …"))
    if len(cfg.tracks) < 2:
        raise RuntimeError("Schwarm braucht mindestens 2 Touren.")

    # ── 1. Parsen + Längen sammeln ─────────────────────────────────────────
    geparst = []
    for tc in cfg.tracks:
        try:
            pts, st = core_parse_gpx(tc["gpx_path"])
        except Exception as e:
            _log.warning("Schwarm: %s unlesbar (%s) — übersprungen", tc["gpx_path"], e)
            continue
        if len(pts) < 2 or pts[-1].dist_m <= 0:
            _log.warning("Schwarm: %s hat <2 Punkte/keine Strecke — übersprungen", tc["gpx_path"])
            continue
        geparst.append({"points": pts, "laenge": pts[-1].dist_m,
                        "color": tc.get("color") or "#ff6b35",
                        "name": tc.get("name") or Path(tc["gpx_path"]).stem})
    if len(geparst) < 2:
        raise RuntimeError(_t("schwarm.fehler.zu_wenig",
                              "Der Schwarm braucht mindestens 2 lesbare Touren mit Strecke."))

    l_max = max(t["laenge"] for t in geparst)
    l_sum = sum(t["laenge"] for t in geparst)
    s = punktabstand(l_max, l_sum)

    # ── 2. Äquidistant abtasten — der Kern von „gleich schnell" ────────────
    touren = []
    for t in geparst:
        coords = resample_aequidistant(t["points"], s)
        touren.append({"coords": coords, "color": t["color"], "name": t["name"]})
    k_max = max(len(t["coords"]) for t in touren)
    _log.info("Schwarm: %d Touren · längste %.1f km · Abstand %.1f m · Punkte gesamt %d (max je Tour %d)",
              len(touren), l_max / 1000.0, s, sum(len(t["coords"]) for t in touren), k_max)

    alle = [c for t in touren for c in t["coords"]]
    bbox = (min(c[0] for c in alle), min(c[1] for c in alle),
            max(c[0] for c in alle), max(c[1] for c in alle))

    html = make_schwarm_html(cfg, touren, bbox, gesamt_km=l_sum / 1000.0)

    anim_frames = max(2, int(round(cfg.duration_s * cfg.fps)))
    hold_frames = max(0, int(round(cfg.hold_s * cfg.fps)))
    total_frames = anim_frames + hold_frames

    emit(0.02, _t("animator.progress.load_map", "Karte laden") + f" ({cfg.map_style}) …")
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        t_pw = time.time()
        browser = await p.chromium.launch(
            headless=True,
            args=["--use-angle=default", "--enable-webgl", "--ignore-gpu-blocklist",
                  "--disable-gpu-sandbox", "--disable-background-networking",
                  "--disable-features=MediaRouter,DialMediaRouteProvider",
                  "--no-first-run", "--no-default-browser-check"],
        )
        _log.info("Chromium gestartet in %.1fs", time.time() - t_pw)
        _dsf = _render_dsf(cfg.width, cfg.height)
        _ss = _render_ss(cfg.width, cfg.height)
        page = await browser.new_page(
            viewport={"width": max(1, int(round(cfg.width / _dsf))),
                      "height": max(1, int(round(cfg.height / _dsf)))},
            device_scale_factor=_dsf * _ss,
        )
        page.on("pageerror", lambda err: _log.error("page.pageerror: %s", err))
        await page.set_content(html)

        ready = False
        for _i in range(60):
            ready = await page.evaluate("window.isReady()")
            if ready:
                break
            await asyncio.sleep(0.5)
        if not ready:
            _log.warning("Karte nach 30s nicht bereit — Render läuft trotzdem weiter.")

        emit(0.05, _t("animator.progress.map_ready", "Karte bereit, rendere Frames …"))

        # ── ffmpeg (h264/h265/prores wie im Animator, ohne Alpha) ──────────
        ffmpeg_bin = find_ffmpeg()
        codec = (cfg.codec or "h264").lower()
        if codec in ("prores", "prores4444"):
            ffmpeg_cmd = [ffmpeg_bin, "-y", "-loglevel", "error",
                          "-f", "image2pipe", "-framerate", str(cfg.fps), "-i", "-",
                          "-c:v", "prores_ks", "-profile:v", "4",
                          "-pix_fmt", "yuv444p10le", "-vendor", "ap10"]
        else:
            vcodec = "libx265" if codec in ("h265", "hevc") else "libx264"
            ffmpeg_cmd = [ffmpeg_bin, "-y", "-loglevel", "error",
                          "-f", "image2pipe", "-framerate", str(cfg.fps), "-i", "-",
                          *(["-vf", "scale=in_range=full:out_range=tv"]
                            if (cfg.frame_format or "jpeg").lower() == "jpeg" else []),
                          "-c:v", vcodec, "-preset", cfg.encoder_preset, "-crf", str(cfg.crf),
                          "-pix_fmt", "yuv420p", "-movflags", "+faststart"]
            if vcodec == "libx265":
                ffmpeg_cmd += ["-tag:v", "hvc1"]
        ffmpeg_cmd += ["-f", _muxer_fuer(cfg.output_path), _teildatei(cfg.output_path)]
        mux = FrameMuxer(ffmpeg_cmd, cfg.output_path, total_frames,
                         log=_log, cancelled_cls=RenderCancelled)

        try:
            preview_every = max(1, cfg.fps // 10)
            for f in range(total_frames):
                check_cancel()
                if f < anim_frames:
                    frac = f / max(1, anim_frames - 1)
                else:
                    frac = 1.0
                g = int(round(frac * (k_max - 1)))
                await page.evaluate(f"window.advanceFrameSchwarm({g})")
                await page.evaluate("window.waitForRender()")
                shot = await _grab_frame(page, cfg)
                mux.schreiben(shot, f + 1)
                if f % preview_every == 0:
                    push_preview(shot)
                emit(0.05 + 0.87 * (f + 1) / total_frames, f"Frame {f + 1} / {total_frames}")
        except BaseException as fehler:
            mux.abbrechen("Schwarm abgebrochen" if isinstance(fehler, RenderCancelled) else "Fehler")
            try:
                await browser.close()
            except Exception:
                pass
            raise

        emit(0.92, _t("animator.progress.ffmpeg", "ffmpeg finalisiert (+faststart, kann etwas dauern) …"))

        def _abgebrochen():
            try:
                check_cancel()
                return False
            except RenderCancelled:
                return True
        mux.abschliessen(_abgebrochen)
        await browser.close()

    emit(1.0, _t("animator.progress.done", "Fertig."))
    return cfg.output_path
