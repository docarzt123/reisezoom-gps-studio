"""Höhen-Animator (v0.9.94) — Höhenprofil als Video.

Render-Pipeline analog zum Animator:
- HTML-Page mit SVG-Höhenprofil + JS-`advanceFrame(progress)` Funktion
- Playwright Headless-Chromium-Browser, lädt diese HTML
- Frame-by-Frame Screenshot → ffmpeg-Pipe → MP4 / .mov

Codec-Modi:
- "h264" (Default)    → .mp4, yuv420p, +faststart
- "h265" / "hevc"     → .mp4 mit hvc1-Tag
- "prores"            → .mov, ProRes 4444 ohne Alpha
- transparent_background=True → .mov, ProRes 4444 MIT Alpha (yuva444p10le)

Trim:
- trim_start_anchor, trim_end_anchor: 0..1 — definiert welcher Bereich
  des Tracks animiert wird. Default 0..1 = ganzer Track. Hinweis: die
  Distanz-Achse zeigt immer den GESAMTEN Track (Hilfsorientierung),
  aber Linie + Marker animieren nur den Trim-Bereich. Auf Wunsch
  später separat schaltbar.
"""
from __future__ import annotations

import asyncio
import base64
import io
import json
import logging
import os
import subprocess
import threading
import time

from core import sensors as _sensors

# v0.9.274 (Nutzer-Bug) — Windows: ffmpeg ohne sichtbares Konsolenfenster starten.
_WIN_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0


def _drain_stderr(pipe):
    """v0.9.388 — liest ffmpeg-stderr fortlaufend leer (Thread), sonst blockiert ffmpeg
    bei viel stderr (Platte voll) im vollen Pipe-Puffer → `ff.stdin.write` hängt ewig.
    Gibt (thread, bytearray) zurück. Siehe core/animator.py für Details."""
    buf = bytearray()

    def _run():
        try:
            for chunk in iter(lambda: pipe.read(65536), b""):
                buf.extend(chunk)
        except Exception:
            pass

    th = threading.Thread(target=_run, daemon=True)
    th.start()
    return th, buf
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

from PIL import Image

from . import gpx as cgpx
from .animator import find_ffmpeg  # gleiches ffmpeg wie Animator (bundle-aware)

_log = logging.getLogger(__name__)


class RenderCancelled(Exception):
    pass


@dataclass
class HeightConfig:
    gpx_path: str
    output_path: str
    duration_s: int = 12
    hold_s: int = 2
    fps: int = 30
    width: int = 1920
    height: int = 1080
    codec: str = "h264"            # "h264" | "h265" | "prores"
    crf: int = 20
    transparent_background: bool = False  # → ProRes 4444 mit Alpha-Plane
    # v0.9.437 (Daten-Animator) — welche Messreihen geplottet werden.
    #   series_a = linke Y-Achse (Pflicht, Default Höhe)
    #   series_b = rechte Y-Achse (optional, "" = aus) — z.B. Puls neben Höhe
    # IDs kommen aus available_series(): abgeleitet (ele/speed/grade) oder ein
    # Sensor-Key (hr/power/cadence/…). Jede Achse skaliert eigenständig (auto).
    # `series_labels`/`series_units` reicht die UI lokalisiert durch (wie
    # stats_labels), damit die Achsen-Beschriftung im Video zur App-Sprache passt.
    series_a: str = "ele"
    series_b: str = ""
    line_color_b: str = "#2e86de"
    line_width_b: float = 3.0
    series_labels: dict = field(default_factory=dict)   # {series_id: Label}
    series_units: dict = field(default_factory=dict)    # {series_id: Einheit}
    # Visuelles (line_color/line_width = Serie A)
    background_color: str = "#1a1a1a"
    # v0.9.444 — Deckkraft des Vordergrunds (Kurve/Fläche/Text/Marker) als
    # SVG-Opacity. 1.0 = wie bisher. Für Overlays getrennt vom Hintergrund
    # steuerbar (der Hintergrund steckt in background_color als rgba).
    foreground_opacity: float = 1.0
    line_color: str = "#ff6b35"
    line_width: float = 4.0
    grid_enabled: bool = True
    show_axes: bool = True               # Haupt-Schalter: aus = gar keine Achsen-Beschriftung
    # v0.9.447 — Achsen einzeln steuerbar. Vorher war alles an EINEM Schalter und
    # die Anzahl der Werte fest verdrahtet (7 auf X, 6 auf Y). Bei kleinen Overlay-
    # Diagrammen ist genau das der Grund, warum die Beschriftung unlesbar wird.
    axis_x_labels: bool = True           # X-Achse (Distanz)
    axis_y_labels: bool = True           # Y-Achse links (Reihe A)
    axis_y2_labels: bool = True          # Y-Achse rechts (Reihe B, nur wenn vorhanden)
    axis_x_ticks: int = 6                # Intervalle auf X → 7 Beschriftungen
    axis_y_ticks: int = 5                # Intervalle auf Y → 6 Beschriftungen
    axis_font_size: float = 20.0         # Basis-Schriftgröße bei 1080 Referenz-Höhe
    # Textskala getrennt von der Geometrie: 0 = automatisch (= Diagramm-Höhe/1080,
    # wie bisher, richtig für das Vollbild-Video). >0 = explizit — die Overlay-Charts
    # setzen hier die Skala der VIDEO-Auflösung ein, sonst schrumpft die Schrift mit
    # der kleinen Box mit und wird unleserlich (Marc-Bug 2026-07-21).
    text_scale: float = 0.0
    show_marker: bool = True
    marker_show_dot: bool = True         # v0.9.405 — laufender Punkt (zeichnet die Linie), unabhängig von der Info-Box
    grid_color: str = "#3a3a3a"          # v0.9.394 — Gitterfarbe (frei wählbar)
    label_color: str = "#cccccc"         # v0.9.394 — Beschriftungsfarbe (Achsen/Header/Callout)
    smoothing: int = 0                   # v0.9.400 — Glättung: Radius (Punkte je Seite) für gleitenden Mittelwert der Höhen; 0 = aus
    # v0.9.402 — Fläche unter der Linie: an/aus, Farbe, Deckkraft (0..100) + Höhen-Farbzonen.
    area_fill: bool = True
    area_color: str = "#ff6b35"
    area_opacity: int = 18               # Prozent (0..100)
    area_mode: str = "smooth"            # "smooth" (weicher Verlauf) | "bands" (harte Bänder)
    fill_stops: list = field(default_factory=list)  # [{"ele": float, "color": "#rrggbb"}] — ab jeder Höhe wechselt die Füllfarbe
    # v0.9.403 — Höhen-Farbzonen auch für Hintergrund + Linie (gleiche Semantik wie fill_stops)
    bg_mode: str = "smooth"
    bg_clip: bool = False                 # v0.9.404 — Hintergrund-Verlauf nur im Diagramm-Bereich
    bg_stops: list = field(default_factory=list)
    line_mode: str = "smooth"
    line_stops: list = field(default_factory=list)
    # v0.9.394 — Sachliche Info-Leiste + Steigung am Marker + Wegpunkte.
    show_stats_header: bool = True
    # Welche Stat-Felder in der Kopf-Leiste (Reihenfolge = Anzeige-Reihenfolge).
    # Gültige IDs: distance, updown, avg_grad, max_grad, ele_minmax, ele_max, ele_avg
    stats_fields: list = field(default_factory=lambda: [
        "distance", "updown", "avg_grad", "max_grad", "ele_max"
    ])
    show_gradient: bool = True          # Steigungs-% am laufenden Marker
    # v0.9.396 — Marker (Punkt + Info-Box) vollständig konfigurierbar
    marker_dot_color: str = "#ffffff"
    marker_dot_size: float = 6.0
    marker_bg: str = "#000000"
    marker_bg_opacity: float = 0.6
    marker_border_color: str = "#ff6b35"
    marker_border_width: float = 1.5
    marker_font_size: float = 16.0
    marker_show_icon: bool = True       # ⛰-Symbol in der Box
    marker_show_ele: bool = True        # Höhe in der Box
    marker_show_dist: bool = True       # Distanz in der Box
    # Lokalisierte Labels für die Kopf-Leiste {field_id: label}. Aus der UI
    # (t()) durchgereicht damit das Video zur App-Sprache passt. Fallback DE.
    stats_labels: dict = field(default_factory=dict)
    # Wegpunkte auf der Strecke: [{dist_m, ele, label, icon, color}]. Bereits
    # auf dist_m aufgelöst (Projektion/Anchor passiert in der Bridge/UI).
    waypoints: list = field(default_factory=list)
    # Trim
    trim_start: float = 0.0        # 0..1
    trim_end: float = 1.0          # 0..1


# ── HTML-Generator ──────────────────────────────────────────────────────────


def _make_html(cfg: HeightConfig, distances_m: list[float], elevations: list[float],
               values_b: list[float] | None = None, inline_id: str = "") -> str:
    """Erzeugt die HTML-Seite die im Headless-Browser geladen wird.

    Die Seite zeichnet EINE Messreihe (cfg.series_a) als SVG über die Distanz.
    `elevations` ist deshalb generisch zu lesen: es sind die Werte der
    gewählten Serie (Höhe, Puls, Tempo, …) — Kurve, Y-Skala, Farbzonen und
    Min/Max/Ø rechnen alle darauf. Nur die höhen-semantischen Extras
    (Auf-/Abstieg, Steigung, ⛰) gelten weiter nur für series_a == "ele".

    Eine globale Funktion `window.advanceFrame(progress)` setzt den Fortschritt
    0..1 und löst ein synchrones Re-Render aus. Pro Frame: advanceFrame(p) →
    wait → screenshot.
    """
    # v0.9.438 — series_b ist optional. Nur wenn eine zweite Reihe gewählt IST
    # und Werte mitkommen, zeichnen wir sie; sonst bleibt alles wie bei einer
    # Reihe (kein rechter Rand, keine zweite Achse).
    _sid_b = (getattr(cfg, "series_b", "") or "").strip()
    _has_b = bool(_sid_b) and bool(values_b) and len(values_b or []) == len(elevations)
    data_json = json.dumps({
        "distances_m": distances_m,
        "elevations": elevations,
        "values_b": list(values_b) if _has_b else [],
    })
    bg = cfg.background_color if not cfg.transparent_background else "transparent"
    grid_color = cfg.grid_color or "#3a3a3a"
    label_color = cfg.label_color or "#cccccc"
    # v0.9.437 (Daten-Animator) — Meta der geplotteten Serie fürs Template.
    _sid = getattr(cfg, "series_a", "ele") or "ele"
    _s_label, _s_unit = series_meta(_sid, getattr(cfg, "series_labels", None),
                                    getattr(cfg, "series_units", None))
    series_id_json = json.dumps(_sid)
    series_label_json = json.dumps(_s_label)
    series_unit_json = json.dumps(_s_unit)
    series_dec_json = json.dumps(_series_decimals(_sid))
    series_is_ele_js = "true" if _sid == "ele" else "false"
    # Meta der zweiten Reihe (rechte Achse).
    if _has_b:
        _b_label, _b_unit = series_meta(_sid_b, getattr(cfg, "series_labels", None),
                                        getattr(cfg, "series_units", None))
    else:
        _b_label, _b_unit = "", ""
    has_b_js = "true" if _has_b else "false"
    series_b_label_json = json.dumps(_b_label)
    series_b_unit_json = json.dumps(_b_unit)
    series_b_dec_json = json.dumps(_series_decimals(_sid_b) if _has_b else 0)
    line_color_b_json = json.dumps(getattr(cfg, "line_color_b", "#2e86de"))
    line_width_b_json = json.dumps(float(getattr(cfg, "line_width_b", 3.0) or 3.0))

    # v0.9.444 — Inline-Modus: das SVG wird DIREKT ins Vorschau-DOM eingebettet
    # (kein iframe → macOS/WKWebView lässt die Karte durchscheinen). Dafür müssen
    # SVG-ID, Gradient-Def-IDs und die advanceFrame-Registrierung pro Instanz
    # eindeutig sein, und der Script-Block wird in eine IIFE gewickelt. inline_id=""
    # = klassischer Voll-Seiten-Output (Render/Daten-Animator) → 100% unverändert.
    _inline = bool(inline_id)
    _svgid = ("rzc-" + inline_id) if _inline else "svg"
    _gsuf = ("-" + inline_id) if _inline else ""
    _fgop = max(0.0, min(1.0, float(getattr(cfg, "foreground_opacity", 1.0) or 1.0)))
    _svg_extra = (f' style="width:100%;height:100%;display:block;opacity:{_fgop}"'
                  if _inline else "")
    _iife_open = "(function(){" if _inline else ""
    if _inline:
        _script_end = ("(window.__rzInlineCharts=window.__rzInlineCharts||{})["
                       + json.dumps(inline_id) + "]=function(progress){draw(progress);};"
                       + "draw(0);})();")
    else:
        _script_end = ("window.advanceFrame = function(progress) { draw(progress); };"
                       "window.isReady = function() { return true; };"
                       "window.waitForRender = function() { return new Promise(r => setTimeout(r, 0)); };"
                       "draw(0); window._ready = true;")

    return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>height-render</title>
<style>
  html, body {{ margin: 0; padding: 0; background: {bg}; overflow: hidden; }}
  body {{ width: {cfg.width}px; height: {cfg.height}px; }}
  #{_svgid} {{ width: 100%; height: 100%; display: block; opacity: {_fgop}; }}
</style></head>
<body>
<svg id="{_svgid}"{_svg_extra} width="{cfg.width}" height="{cfg.height}" viewBox="0 0 {cfg.width} {cfg.height}"
     preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"></svg>
<script>
{_iife_open}
const DATA = {data_json};
const W = {cfg.width}, H = {cfg.height};
const BG = {json.dumps(bg)};
const TRANSPARENT = {str(cfg.transparent_background).lower()};
const LC = {json.dumps(cfg.line_color)};
const LW = {float(cfg.line_width)};
const SHOW_GRID = {str(cfg.grid_enabled).lower()};
const SHOW_AXES = {str(cfg.show_axes).lower()};
// v0.9.447 — Achsen einzeln + Schriftgröße + entkoppelte Textskala
const AXIS_X_LABELS = {str(getattr(cfg, "axis_x_labels", True)).lower()};
const AXIS_Y_LABELS = {str(getattr(cfg, "axis_y_labels", True)).lower()};
const AXIS_Y2_LABELS = {str(getattr(cfg, "axis_y2_labels", True)).lower()};
const AXIS_X_TICKS = {max(1, int(getattr(cfg, "axis_x_ticks", 6) or 6))};
const AXIS_Y_TICKS = {max(1, int(getattr(cfg, "axis_y_ticks", 5) or 5))};
const AXIS_FONT_SIZE = {float(getattr(cfg, "axis_font_size", 20.0) or 20.0)};
const TEXT_SCALE_CFG = {float(getattr(cfg, "text_scale", 0.0) or 0.0)};
const SHOW_MARKER = {str(cfg.show_marker).lower()};
const MK_SHOW_DOT = {str(bool(cfg.marker_show_dot)).lower()};
const TRIM_S = {float(cfg.trim_start)};
const TRIM_E = {float(cfg.trim_end)};
const GRID_COLOR = {json.dumps(grid_color)};
const LBL_COLOR = {json.dumps(label_color)};
// v0.9.394 — Info-Leiste + Steigung + Wegpunkte
const SHOW_HEADER = {str(cfg.show_stats_header).lower()};
const STATS_FIELDS = {json.dumps(cfg.stats_fields)};
const STATS_LABELS = {json.dumps(cfg.stats_labels)};
const SHOW_GRAD = {str(cfg.show_gradient).lower()};
const WAYPOINTS = {json.dumps(cfg.waypoints)};
// v0.9.396 — Marker vollständig konfigurierbar
const MK_DOT_COLOR = {json.dumps(cfg.marker_dot_color)};
const MK_DOT_SIZE = {float(cfg.marker_dot_size)};
const MK_BG = {json.dumps(cfg.marker_bg)};
const MK_BG_OP = {float(cfg.marker_bg_opacity)};
const MK_BORDER = {json.dumps(cfg.marker_border_color)};
const MK_BW = {float(cfg.marker_border_width)};
const MK_FS = {float(cfg.marker_font_size)};
const MK_SHOW_ICON = {str(cfg.marker_show_icon).lower()};
const MK_SHOW_ELE = {str(cfg.marker_show_ele).lower()};
const MK_SHOW_DIST = {str(cfg.marker_show_dist).lower()};
// v0.9.437 (Daten-Animator) — Meta der geplotteten Serie. `elevs` trägt die
// Werte DIESER Serie; S_IS_ELE schaltet die höhen-only-Teile (⛰, Steigung,
// Auf-/Abstieg) zu, die bei Puls/Tempo/… keinen Sinn ergeben.
const S_ID = {series_id_json};
const S_LABEL = {series_label_json};
const S_UNIT = {series_unit_json};
const S_DEC = {series_dec_json};
const S_IS_ELE = {series_is_ele_js};
// Wert + Einheit der Serie einheitlich formatieren.
function sFmt(v) {{ return v.toFixed(S_DEC) + (S_UNIT ? " " + S_UNIT : ""); }}
// v0.9.438 — optionale zweite Reihe auf eigener rechter Achse.
const HAS_B = {has_b_js};
const B_LABEL = {series_b_label_json};
const B_UNIT = {series_b_unit_json};
const B_DEC = {series_b_dec_json};
const LC_B = {line_color_b_json};
const LW_B = {line_width_b_json};
function bFmt(v) {{ return v.toFixed(B_DEC) + (B_UNIT ? " " + B_UNIT : ""); }}
function _rzRgba(hex, a) {{
  const m = /^#?([0-9a-f]{{6}})$/i.exec(hex || "");
  if (!m) return "rgba(0,0,0," + a + ")";
  const n = parseInt(m[1], 16);
  return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
}}

// Padding skaliert mit Höhe (für 4K-Render werden Achsenlabels größer)
const SCALE = H / 1080;
// v0.9.447 — TEXT_SCALE ist von SCALE getrennt. SCALE beschreibt die GEOMETRIE
// (Ränder, Linienstärken, Marker) und darf mit der Box schrumpfen. Die SCHRIFT
// darf das nicht: ein Overlay-Diagramm von 270 px Höhe ergab SCALE 0.25 und damit
// 5-px-Text — unlesbar. Bei text_scale=0 bleibt alles exakt wie früher (Vollbild-
// Video), die Overlays setzen dort die Skala der Video-Auflösung ein.
const TEXT_SCALE = TEXT_SCALE_CFG > 0 ? TEXT_SCALE_CFG : SCALE;
const FONT_SIZE = Math.max(5, Math.round(AXIS_FONT_SIZE * TEXT_SCALE));
// Welche Achsen zeichnen wir überhaupt? SHOW_AXES bleibt der Hauptschalter.
const AX_X  = SHOW_AXES && AXIS_X_LABELS;
const AX_Y  = SHOW_AXES && AXIS_Y_LABELS;
const AX_Y2 = SHOW_AXES && AXIS_Y2_LABELS && HAS_B;
// Ränder richten sich nach der TATSÄCHLICHEN Textgröße (nicht mehr nach SCALE),
// sonst wird größere Schrift abgeschnitten. Ist eine Achse aus, fällt ihr Rand
// auf ein Minimum — die Kurve bekommt den Platz.
const AX_GAP = Math.round(FONT_SIZE * 0.6);
function _labelRoom(unit) {{
  // Breite grob aus Zeichenzahl: „3946 m" ≈ 6, „24.5 km/h" ≈ 9 Zeichen.
  const chars = 5 + Math.max(0, (unit || "").length);
  return Math.round(chars * FONT_SIZE * 0.58) + AX_GAP;
}}
const PAD_L = AX_Y ? _labelRoom(S_UNIT) : Math.round(12 * SCALE);
const PAD_R = AX_Y2 ? _labelRoom(B_UNIT) : Math.round(40 * SCALE);
// Header braucht oben eine Bandbreite; Wegpunkt-Labels ragen auch nach oben.
// Der Kopf ist reiner TEXT → mit TEXT_SCALE, sonst wird er im kleinen Overlay
// genauso unlesbar wie früher die Achsen.
const HEAD_H = SHOW_HEADER ? Math.round(58 * TEXT_SCALE) : 0;
const PAD_T = Math.round((WAYPOINTS.length ? 42 : 30) * SCALE) + HEAD_H + Math.round(30 * SCALE);
const PAD_B = AX_X ? Math.round(FONT_SIZE * 1.6) + AX_GAP : Math.round(14 * SCALE);
const PLOT_W = Math.max(20, W - PAD_L - PAD_R);
const PLOT_H = Math.max(20, H - PAD_T - PAD_B);
const AXES_FONT = `${{FONT_SIZE}}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
const STATS_FONT = `${{Math.round(22 * TEXT_SCALE)}}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;

// v0.9.400 — Glättung: gleitender Mittelwert über die Höhen (Radius r Punkte
// je Seite). SYNCHRON zu modules/heightanim/ui/module.js (_rzSmooth).
const SMOOTHING = {int(cfg.smoothing)};
function _rzSmooth(arr, r) {{
  r = Math.round(r || 0);
  if (r <= 0 || !arr || arr.length < 3) return (arr || []).slice();
  const n = arr.length, out = new Array(n);
  for (let i = 0; i < n; i++) {{
    let s = 0, c = 0;
    const lo = Math.max(0, i - r), hi = Math.min(n - 1, i + r);
    for (let j = lo; j <= hi; j++) {{ const v = arr[j]; if (v != null) {{ s += v; c++; }} }}
    out[i] = c ? s / c : arr[i];
  }}
  return out;
}}

// v0.9.402 — Fläche unter der Linie: füllen? Farbe? Deckkraft? Höhen-Farbzonen?
// SYNCHRON zu modules/heightanim/ui/module.js (_rzFillStops).
const AREA_FILL = {str(bool(cfg.area_fill)).lower()};
const AREA_COLOR = {json.dumps(cfg.area_color)};
const AREA_OP = {float(cfg.area_opacity) / 100.0};
const AREA_BANDS = {str(cfg.area_mode == "bands").lower()};
const FILL_STOPS = {json.dumps([{"ele": float(s.get("ele", 0)), "color": s.get("color", "#88cc66")} for s in (cfg.fill_stops or [])])};
// v0.9.403 — Höhen-Farbzonen für Hintergrund + Linie
const BG_BANDS = {str(cfg.bg_mode == "bands").lower()};
const BG_CLIP = {str(bool(cfg.bg_clip)).lower()};
const BG_STOPS = {json.dumps([{"ele": float(s.get("ele", 0)), "color": s.get("color", "#1a1a1a")} for s in (cfg.bg_stops or [])])};
const LINE_BANDS = {str(cfg.line_mode == "bands").lower()};
const LINE_STOPS = {json.dumps([{"ele": float(s.get("ele", 0)), "color": s.get("color", "#ff6b35")} for s in (cfg.line_stops or [])])};
function _rzFillStops(baseColor, stops, eHiV, eSpanV, bands) {{
  const pts = [];
  (stops || []).forEach(s => {{
    const e = +s.ele;
    if (!isFinite(e)) return;
    pts.push({{ off: Math.max(0, Math.min(1, (eHiV - e) / (eSpanV || 1))), color: s.color || "#ffffff" }});
  }});
  pts.push({{ off: 1, color: baseColor }});
  pts.sort((a, b) => a.off - b.off);
  if (!bands) return pts;
  const out = [];
  let prev = 0;
  for (let k = 0; k < pts.length; k++) {{
    out.push({{ off: prev, color: pts[k].color }});
    out.push({{ off: pts[k].off, color: pts[k].color }});
    prev = pts[k].off;
  }}
  return out;
}}

// Trim: virtuelles Distanz-Fenster
const dists = DATA.distances_m;
const elevs = _rzSmooth(DATA.elevations, SMOOTHING);
const N = dists.length;
const dMax = dists[N-1] || 1;
const dTrimStart = TRIM_S * dMax;
const dTrimEnd   = TRIM_E * dMax;
const dTrimSpan  = Math.max(1, dTrimEnd - dTrimStart);
function findIdxAtDist(d) {{
  if (d <= dists[0]) return 0;
  if (d >= dists[N-1]) return N-1;
  for (let i = 1; i < N; i++) if (dists[i] >= d) return i;
  return N - 1;
}}
const i0 = findIdxAtDist(dTrimStart);
const i1 = findIdxAtDist(dTrimEnd);
function eleAtDist(d) {{
  const idx = findIdxAtDist(d);
  if (idx <= 0) return elevs[0];
  const d0 = dists[idx - 1], d1 = dists[idx];
  const seg = d1 > d0 ? (d - d0) / (d1 - d0) : 0;
  return elevs[idx - 1] + (elevs[idx] - elevs[idx - 1]) * seg;
}}
let _eMin = Math.min(eleAtDist(dTrimStart), eleAtDist(dTrimEnd));
let _eMax = Math.max(eleAtDist(dTrimStart), eleAtDist(dTrimEnd));
for (let i = i0; i <= i1; i++) {{
  if (elevs[i] < _eMin) _eMin = elevs[i];
  if (elevs[i] > _eMax) _eMax = elevs[i];
}}
const eRange = Math.max(1, _eMax - _eMin);
// v0.9.97 — Y-Achse mit Pixel-genauem Bottom-Margin damit Marker und
// Stroke-Dicke nicht unter den Plot-Boden überstehen („unterirdisch").
const markerR = Math.max(8, LW * 2.5) * SCALE;
const bottomReservePx = Math.max(markerR + 2, LW * SCALE * 0.7 + 8);
const bottomPadFrac = Math.min(0.15, bottomReservePx / Math.max(60, PLOT_H));
const topPadFrac = 0.12;
const eSpan = (1 + topPadFrac) * eRange / Math.max(0.001, 1 - bottomPadFrac);
const eLo = _eMin - bottomPadFrac * eSpan;
const eHi = eLo + eSpan;

// Distanz-Achse: relativ zum Trim-Start (Anzeige beginnt bei 0)
function px(distM) {{
  return PAD_L + ((distM - dTrimStart) / dTrimSpan) * PLOT_W;
}}
function py(ele) {{
  return PAD_T + (1 - (ele - eLo) / eSpan) * PLOT_H;
}}

// ── Zweite Reihe (v0.9.438): eigene Werte, eigene Skala, eigene Achse ────────
// Bewusst getrennt von A: Puls (bpm) und Höhe (m) haben keinen gemeinsamen
// Wertebereich — nur so sind beide Kurven gleichzeitig lesbar.
const elevsB = HAS_B ? _rzSmooth(DATA.values_b, SMOOTHING) : [];
let bLo = 0, bSpanV = 1;
if (HAS_B) {{
  function bAtDist(d) {{
    const idx = findIdxAtDist(d);
    if (idx <= 0) return elevsB[0];
    const d0 = dists[idx - 1], d1 = dists[idx];
    const seg = d1 > d0 ? (d - d0) / (d1 - d0) : 0;
    return elevsB[idx - 1] + (elevsB[idx] - elevsB[idx - 1]) * seg;
  }}
  let _bMin = Math.min(bAtDist(dTrimStart), bAtDist(dTrimEnd));
  let _bMax = Math.max(bAtDist(dTrimStart), bAtDist(dTrimEnd));
  for (let i = i0; i <= i1; i++) {{
    if (elevsB[i] < _bMin) _bMin = elevsB[i];
    if (elevsB[i] > _bMax) _bMax = elevsB[i];
  }}
  const bRange = Math.max(1e-6, _bMax - _bMin);
  // gleiche Luft oben/unten wie bei A, damit beide Kurven optisch gleich sitzen
  bSpanV = (1 + topPadFrac) * bRange / Math.max(0.001, 1 - bottomPadFrac);
  bLo = _bMin - bottomPadFrac * bSpanV;
}}
function pyB(v) {{
  return PAD_T + (1 - (v - bLo) / bSpanV) * PLOT_H;
}}

const svg = document.getElementById("{_svgid}");

function svgNS(tag, attrs, text) {{
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  if (attrs) for (const k in attrs) el.setAttribute(k, attrs[k]);
  if (text != null) el.textContent = text;
  return el;
}}

// v0.9.403 — Zonen-Gradient nach Höhe (SYNCHRON zu module.js _zoneGradUrl). Baut
// eine vertikale <linearGradient> und gibt die url zurück (oder null bei keinen Zonen).
function _rzZoneGrad(id, stops, baseColor, bands) {{
  const valid = (stops || []).filter(s => isFinite(+s.ele));
  if (!valid.length) return null;
  const grad = svgNS("linearGradient", {{
    id: id, gradientUnits: "userSpaceOnUse",
    x1: PAD_L, x2: PAD_L, y1: py(eHi).toFixed(1), y2: py(eLo).toFixed(1),
  }});
  _rzFillStops(baseColor, valid, eHi, eSpan, bands).forEach(st => {{
    grad.appendChild(svgNS("stop", {{ offset: (st.off * 100).toFixed(2) + "%", "stop-color": st.color }}));
  }});
  let defs = svg.querySelector("defs.rz-zone-defs");
  if (!defs) {{ defs = svgNS("defs", {{ "class": "rz-zone-defs" }}); svg.insertBefore(defs, svg.firstChild); }}
  defs.appendChild(grad);
  return "url(#" + id + ")";
}}

// ── Profil-Stat-Helfer — SYNCHRON zu ui/js/util.js (rzProfile*) und
//    modules/heightanim/ui/module.js. Bei Änderung ALLE drei pflegen. ────────
function rzWindowGrad(ds, es, idx, win, lo0, hi0) {{
  const n = ds.length;
  const d0 = ds[idx];
  let lo = idx; while (lo > lo0 && d0 - ds[lo] < win) lo--;
  let hi = idx; while (hi < hi0 && ds[hi] - d0 < win) hi++;
  const dd = ds[hi] - ds[lo];
  if (dd <= 0) return 0;
  const eLo = es[lo] == null ? 0 : es[lo];
  const eHi = es[hi] == null ? 0 : es[hi];
  return (eHi - eLo) / dd * 100;
}}
function rzGradAtDist(ds, es, d, win) {{
  const n = ds.length;
  let lo = 0; while (lo < n - 1 && d - ds[lo] > win) lo++;
  let hi = n - 1; while (hi > 0 && ds[hi] - d > win) hi--;
  if (hi <= lo) {{ hi = Math.min(n - 1, lo + 1); }}
  const dd = ds[hi] - ds[lo];
  if (dd <= 0) return 0;
  const eLo = es[lo] == null ? 0 : es[lo];
  const eHi = es[hi] == null ? 0 : es[hi];
  return (eHi - eLo) / dd * 100;
}}
function rzHeaderStats(ds, es, i0, i1) {{
  let eMin = Infinity, eMax = -Infinity, eSum = 0, eCnt = 0;
  for (let i = i0; i <= i1; i++) {{
    const e = es[i]; if (e == null) continue;
    if (e < eMin) eMin = e; if (e > eMax) eMax = e; eSum += e; eCnt++;
  }}
  // Auf-/Abstieg: Glättung (±2) + 3-m-Hysterese-Referenz (wie core/gpx.py)
  const sm = [];
  for (let i = i0; i <= i1; i++) {{
    let s = 0, c = 0;
    for (let j = Math.max(i0, i - 2); j <= Math.min(i1, i + 2); j++) {{
      if (es[j] != null) {{ s += es[j]; c++; }}
    }}
    sm.push(c ? s / c : (es[i] || 0));
  }}
  let asc = 0, desc = 0, ref = sm[0] || 0;
  for (let k = 1; k < sm.length; k++) {{
    const dz = sm[k] - ref;
    if (Math.abs(dz) >= 3) {{ if (dz > 0) asc += dz; else desc += -dz; ref = sm[k]; }}
  }}
  // Steigungen (windowed, distanz-gewichtet)
  let gUpMax = 0, gDnMax = 0, gUpSum = 0, gUpW = 0, gDnSum = 0, gDnW = 0;
  for (let i = i0 + 1; i <= i1; i++) {{
    const w = Math.max(0, ds[i] - ds[i - 1]);
    const g = rzWindowGrad(ds, es, i, 60, i0, i1);
    if (g > 0.3) {{ if (g > gUpMax) gUpMax = g; gUpSum += g * w; gUpW += w; }}
    else if (g < -0.3) {{ if (g < -gDnMax) gDnMax = -g; gDnSum += (-g) * w; gDnW += w; }}
  }}
  return {{
    distM: Math.max(0, ds[i1] - ds[i0]),
    eleMin: eCnt ? eMin : 0, eleMax: eCnt ? eMax : 0,
    eleAvg: eCnt ? eSum / eCnt : 0,
    ascent: asc, descent: desc,
    gradAvgUp: gUpW ? gUpSum / gUpW : 0, gradAvgDown: gDnW ? gDnSum / gDnW : 0,
    gradMaxUp: gUpMax, gradMaxDown: gDnMax,
  }};
}}
const RZ_FIELD_LABELS_DE = {{
  distance: "Distanz", updown: "Höhe ↑ / ↓", avg_grad: "Ø-Steigung",
  max_grad: "Max. Steigung", ele_max: "Höhe max", ele_min: "Höhe min",
  ele_minmax: "Höhe min / max", ele_avg: "Ø-Höhe",
}};
function rzFieldLabel(id) {{
  // Bei einer Nicht-Höhen-Serie tragen die Min/Max/Ø-Felder deren Namen
  // („Herzfrequenz max" statt „Höhe max"). Die von der UI gelieferten
  // STATS_LABELS sagen für diese IDs „Höhe" — deshalb hier vorher abbiegen.
  if (!S_IS_ELE) {{
    switch (id) {{
      case "ele_max":    return S_LABEL + " max";
      case "ele_min":    return S_LABEL + " min";
      case "ele_minmax": return S_LABEL + " min / max";
      case "ele_avg":    return "Ø " + S_LABEL;
    }}
  }}
  return (STATS_LABELS && STATS_LABELS[id]) || RZ_FIELD_LABELS_DE[id] || id;
}}
function rzFieldValue(id, st) {{
  const r = Math.round;
  switch (id) {{
    case "distance":   return (st.distM / 1000).toFixed(2) + " km";
    // Auf-/Abstieg + Steigung sind höhen-semantisch — bei Puls/Tempo/… leer
    // (rzStatsFields() filtert sie ohnehin raus, das hier ist der Gürtel).
    case "updown":     return S_IS_ELE ? ("↑" + r(st.ascent) + " / ↓" + r(st.descent) + " m") : "";
    case "avg_grad":   return S_IS_ELE ? ("+" + st.gradAvgUp.toFixed(1) + " / −" + st.gradAvgDown.toFixed(1) + " %") : "";
    case "max_grad":   return S_IS_ELE ? ("+" + r(st.gradMaxUp) + " / −" + r(st.gradMaxDown) + " %") : "";
    // Min/Max/Ø rechnen auf der geplotteten Serie → generisch mit ihrer Einheit.
    case "ele_max":    return sFmt(st.eleMax);
    case "ele_min":    return sFmt(st.eleMin);
    case "ele_minmax": return sFmt(st.eleMin) + " / " + sFmt(st.eleMax);
    case "ele_avg":    return sFmt(st.eleAvg);
    default:           return "";
  }}
}}
const RZ_WP_KIND_LABEL_DE = {{
  peak: "⛰ Gipfel", valley: "▼ Tiefpunkt",
  steep_up: "◤ Steilster Anstieg", steep_down: "◢ Steilster Abstieg",
}};

function draw(progress) {{
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  // Background (nur wenn nicht transparent — sonst ist der body transparent)
  // v0.9.403 — optionale Höhen-Farbzonen als Hintergrund-Gradient.
  // v0.9.404 — BG_CLIP: Verlauf nur im Diagramm-Bereich (flache Basis füllt den Rest).
  if (!TRANSPARENT) {{
    const _bgUrl = _rzZoneGrad("rzBgGrad{_gsuf}", BG_STOPS, BG, BG_BANDS);
    if (_bgUrl && BG_CLIP) {{
      svg.appendChild(svgNS("rect", {{ x: 0, y: 0, width: W, height: H, fill: BG }}));
      svg.appendChild(svgNS("rect", {{ x: PAD_L, y: PAD_T, width: PLOT_W, height: PLOT_H, fill: _bgUrl }}));
    }} else {{
      svg.appendChild(svgNS("rect", {{ x: 0, y: 0, width: W, height: H, fill: _bgUrl || BG }}));
    }}
  }}

  // Hilfsgitter — folgt der eingestellten Achsen-Teilung, damit Linien und
  // Beschriftungen auf derselben Höhe sitzen (v0.9.447).
  if (SHOW_GRID) {{
    for (let i = 0; i <= AXIS_Y_TICKS; i++) {{
      const y = PAD_T + (i / AXIS_Y_TICKS) * PLOT_H;
      svg.appendChild(svgNS("line", {{
        x1: PAD_L, x2: PAD_L + PLOT_W, y1: y, y2: y,
        stroke: GRID_COLOR, "stroke-width": Math.max(1, Math.round(SCALE)),
        opacity: 0.4,
      }}));
    }}
    for (let i = 0; i <= AXIS_X_TICKS; i++) {{
      const x = PAD_L + (i / AXIS_X_TICKS) * PLOT_W;
      svg.appendChild(svgNS("line", {{
        x1: x, x2: x, y1: PAD_T, y2: PAD_T + PLOT_H,
        stroke: GRID_COLOR, "stroke-width": Math.max(1, Math.round(SCALE)),
        opacity: 0.4,
      }}));
    }}
  }}

  // Achsen — v0.9.447: jede Achse einzeln schaltbar, Anzahl der Werte einstellbar.
  // Ränder/Abstände hängen jetzt an FONT_SIZE statt an SCALE, damit größere
  // Schrift nicht abgeschnitten wird.
  if (AX_X) {{
    for (let i = 0; i <= AXIS_X_TICKS; i++) {{
      const x = PAD_L + (i / AXIS_X_TICKS) * PLOT_W;
      const distKm = (i / AXIS_X_TICKS) * (dTrimSpan / 1000);
      svg.appendChild(svgNS("text", {{
        x, y: H - PAD_B + Math.round(FONT_SIZE * 1.35),
        fill: LBL_COLOR, "font-size": FONT_SIZE,
        "text-anchor": "middle", "font-family": "-apple-system, sans-serif",
      }}, distKm.toFixed(1) + " km"));
    }}
  }}
  if (AX_Y) {{
    for (let i = 0; i <= AXIS_Y_TICKS; i++) {{
      const y = PAD_T + (i / AXIS_Y_TICKS) * PLOT_H;
      const ele = eHi - (i / AXIS_Y_TICKS) * eSpan;
      svg.appendChild(svgNS("text", {{
        x: PAD_L - AX_GAP, y: y + Math.round(FONT_SIZE * 0.34),
        fill: LBL_COLOR, "font-size": FONT_SIZE,
        "text-anchor": "end", "font-family": "-apple-system, sans-serif",
      }}, sFmt(ele)));
    }}
  }}
  // v0.9.438 — rechte Achse für Reihe B, in deren Linienfarbe damit klar ist
  // welche Achse zu welcher Kurve gehört.
  if (AX_Y2) {{
    for (let i = 0; i <= AXIS_Y_TICKS; i++) {{
      const y = PAD_T + (i / AXIS_Y_TICKS) * PLOT_H;
      const v = (bLo + bSpanV) - (i / AXIS_Y_TICKS) * bSpanV;
      svg.appendChild(svgNS("text", {{
        x: PAD_L + PLOT_W + AX_GAP, y: y + Math.round(FONT_SIZE * 0.34),
        fill: LC_B, "font-size": FONT_SIZE,
        "text-anchor": "start", "font-family": "-apple-system, sans-serif",
      }}, bFmt(v)));
    }}
  }}

  // Partial line bis zur aktuellen Position
  const dCurrent = dTrimStart + Math.max(0, Math.min(1, progress)) * dTrimSpan;
  let endIdx = i1;
  for (let i = i0; i <= i1; i++) {{
    if (dists[i] >= dCurrent) {{ endIdx = i; break; }}
  }}
  let endX, endY, curEle;
  if (endIdx <= i0 || progress <= 0) {{
    endX = px(dists[i0]); endY = py(elevs[i0]); curEle = elevs[i0]; endIdx = i0;
  }} else {{
    const d0 = dists[endIdx - 1], d1 = dists[endIdx];
    const seg = d1 > d0 ? (dCurrent - d0) / (d1 - d0) : 0;
    const eInterp = elevs[endIdx - 1] + (elevs[endIdx] - elevs[endIdx - 1]) * seg;
    endX = px(dCurrent); endY = py(eInterp); curEle = eInterp;
  }}

  let partialD = "";
  for (let i = i0; i <= Math.max(i0, endIdx - 1); i++) {{
    partialD += (i === i0 ? "M" : " L") + px(dists[i]).toFixed(1) + " " + py(elevs[i]).toFixed(1);
  }}
  if (progress > 0) {{
    if (!partialD) partialD = "M" + px(dists[i0]).toFixed(1) + " " + py(elevs[i0]).toFixed(1);
    partialD += " L" + endX.toFixed(1) + " " + endY.toFixed(1);
  }}

  // Fill (v0.9.402 — konfigurierbar: an/aus, Farbe, Deckkraft, Höhen-Farbzonen)
  if (progress > 0 && AREA_FILL && AREA_OP > 0) {{
    const baseline = PAD_T + PLOT_H;
    const fillD = partialD + " L" + endX.toFixed(1) + " " + baseline.toFixed(1)
                + " L" + px(dists[i0]).toFixed(1) + " " + baseline.toFixed(1) + " Z";
    const fillVal = _rzZoneGrad("rzFillGrad{_gsuf}", FILL_STOPS, AREA_COLOR, AREA_BANDS) || AREA_COLOR;
    svg.appendChild(svgNS("path", {{
      d: fillD, fill: fillVal, opacity: AREA_OP,
    }}));
  }}
  // Linie (v0.9.403 — optionale Höhen-Farbzonen als Stroke-Gradient)
  if (progress > 0) {{
    const lineStroke = _rzZoneGrad("rzLineGrad{_gsuf}", LINE_STOPS, LC, LINE_BANDS) || LC;
    svg.appendChild(svgNS("path", {{
      d: partialD, fill: "none", stroke: lineStroke,
      "stroke-width": LW * SCALE,
      "stroke-linejoin": "round", "stroke-linecap": "round",
    }}));
  }}

  // v0.9.438 — zweite Kurve auf der rechten Skala. Bewusst nur Linie (keine
  // Fläche, keine Farbzonen): zwei gefüllte Flächen übereinander wären nicht
  // mehr lesbar. Läuft synchron zur ersten bis dCurrent.
  let curB = null;
  if (HAS_B && progress > 0) {{
    let bD = "";
    for (let i = i0; i <= Math.max(i0, endIdx - 1); i++) {{
      bD += (i === i0 ? "M" : " L") + px(dists[i]).toFixed(1) + " " + pyB(elevsB[i]).toFixed(1);
    }}
    // Endpunkt exakt auf dCurrent interpolieren, damit A und B gleich weit sind
    if (endIdx <= i0) {{
      curB = elevsB[i0];
    }} else {{
      const d0 = dists[endIdx - 1], d1 = dists[endIdx];
      const seg = d1 > d0 ? (dCurrent - d0) / (d1 - d0) : 0;
      curB = elevsB[endIdx - 1] + (elevsB[endIdx] - elevsB[endIdx - 1]) * seg;
    }}
    if (!bD) bD = "M" + px(dists[i0]).toFixed(1) + " " + pyB(elevsB[i0]).toFixed(1);
    bD += " L" + endX.toFixed(1) + " " + pyB(curB).toFixed(1);
    svg.appendChild(svgNS("path", {{
      d: bD, fill: "none", stroke: LC_B,
      "stroke-width": LW_B * SCALE,
      "stroke-linejoin": "round", "stroke-linecap": "round",
    }}));
  }}

  // Marker-Punkt (konfigurierbar) — v0.9.405: eigener Schalter, unabhängig von der Info-Box
  if (MK_SHOW_DOT && progress > 0) {{
    svg.appendChild(svgNS("circle", {{
      cx: endX, cy: endY,
      r: MK_DOT_SIZE * 1.8 * SCALE,
      fill: MK_BORDER, opacity: 0.35,
    }}));
    const _dotAttrs = {{
      cx: endX, cy: endY, r: MK_DOT_SIZE * SCALE, fill: MK_DOT_COLOR,
    }};
    if (MK_BW > 0) {{ _dotAttrs.stroke = MK_BORDER; _dotAttrs["stroke-width"] = Math.max(1, MK_BW) * SCALE; }}
    svg.appendChild(svgNS("circle", _dotAttrs));
  }}

  // ── Wegpunkte auf der Strecke (erscheinen sobald die Linie sie passiert) ──
  if (WAYPOINTS && WAYPOINTS.length && progress > 0) {{
    for (const wp of WAYPOINTS) {{
      const wd = +wp.dist_m;
      if (!isFinite(wd) || wd < dTrimStart - 1 || wd > dTrimEnd + 1) continue;
      if (progress < 1 && dCurrent < wd) continue;   // erst zeigen wenn passiert
      const wx = px(wd);
      const we = (wp.ele != null) ? +wp.ele : eleAtDist(wd);
      const wy = py(we);
      const col = wp.color || "#ffb37a";
      const stemTop = wy - Math.round(20 * SCALE);
      svg.appendChild(svgNS("line", {{
        x1: wx, x2: wx, y1: wy, y2: stemTop,
        stroke: col, "stroke-width": Math.max(1, Math.round(1.5 * SCALE)),
      }}));
      svg.appendChild(svgNS("circle", {{
        cx: wx, cy: wy, r: Math.max(3, LW * 1.1) * SCALE,
        fill: col, stroke: (BG === "transparent" ? "#1a1a1a" : BG),
        "stroke-width": Math.max(1, Math.round(1.5 * SCALE)),
      }}));
      const label = (wp.label || "").toString();
      if (label) {{
        // v0.9.447 — Wegpunkt-Fahne ist Text → TEXT_SCALE (Stiel/Punkt bleiben
        // Geometrie und hängen weiter an SCALE).
        const fs = Math.round(13 * TEXT_SCALE);
        const tw = Math.round(label.length * fs * 0.62 + 16 * TEXT_SCALE);
        let bx = wx - tw / 2;
        bx = Math.max(PAD_L, Math.min(W - PAD_R - tw, bx));
        let by = stemTop - Math.round(18 * TEXT_SCALE);
        by = Math.max(HEAD_H + Math.round(8 * TEXT_SCALE), by);
        svg.appendChild(svgNS("rect", {{
          x: bx, y: by, width: tw, height: Math.round(18 * TEXT_SCALE),
          rx: Math.round(4 * TEXT_SCALE), fill: "#2a2a2a",
          stroke: col, "stroke-width": Math.max(1, Math.round(SCALE)),
        }}));
        svg.appendChild(svgNS("text", {{
          x: bx + tw / 2, y: by + Math.round(13 * TEXT_SCALE),
          fill: "#fff", "font-size": fs, "text-anchor": "middle",
          "font-family": "-apple-system, sans-serif",
        }}, label));
      }}
    }}
  }}

  // ── Sachliche Info-Leiste oben (immer sichtbar, über dem Plot) ────────────
  if (SHOW_HEADER && N >= 2) {{
    const _st = rzHeaderStats(dists, elevs, i0, i1);
    const fields = (STATS_FIELDS || []).filter(f => rzFieldValue(f, _st) !== "");
    const n = Math.max(1, fields.length);
    // v0.9.447 — Kopfleiste hängt an TEXT_SCALE (siehe HEAD_H).
    const labFs = Math.round(13 * TEXT_SCALE), valFs = Math.round(19 * TEXT_SCALE);
    const bandTop = Math.round(14 * TEXT_SCALE);
    const step = PLOT_W / n;
    for (let k = 0; k < fields.length; k++) {{
      const fx = PAD_L + k * step;
      if (k > 0) {{
        svg.appendChild(svgNS("line", {{
          x1: fx - Math.round(12 * TEXT_SCALE), x2: fx - Math.round(12 * TEXT_SCALE),
          y1: bandTop, y2: bandTop + Math.round(44 * TEXT_SCALE),
          stroke: GRID_COLOR, "stroke-width": Math.max(1, Math.round(SCALE)),
        }}));
      }}
      svg.appendChild(svgNS("text", {{
        x: fx, y: bandTop + labFs + Math.round(2 * TEXT_SCALE),
        fill: LBL_COLOR, opacity: 0.6, "font-size": labFs, "font-family": "-apple-system, sans-serif",
      }}, rzFieldLabel(fields[k])));
      svg.appendChild(svgNS("text", {{
        x: fx, y: bandTop + labFs + valFs + Math.round(8 * TEXT_SCALE),
        fill: LBL_COLOR, "font-size": valFs, "font-weight": "500",
        "font-family": "-apple-system, sans-serif",
      }}, rzFieldValue(fields[k], _st)));
    }}
  }}

  // ── Marker-Callout: konfigurierbar (Felder + Farben + Schriftgröße) ───────
  if (SHOW_MARKER && progress > 0) {{
    // Steigung ist höhen-semantisch — bei Puls/Tempo/… ergibt „↗ 5 %" keinen
    // Sinn, also aus der Marker-Box raus.
    const grad = (SHOW_GRAD && S_IS_ELE) ? rzGradAtDist(dists, elevs, dCurrent, 60) : null;
    const curDistKm = (dCurrent - dTrimStart) / 1000;
    // v0.9.447 — Marker-Callout ist Text → TEXT_SCALE.
    const fs = MK_FS * TEXT_SCALE;
    const lines = [];
    const _icon = (MK_SHOW_ICON && S_IS_ELE) ? "⛰" : "";
    const l1 = _icon + (MK_SHOW_ELE ? ((_icon ? " " : "") + sFmt(curEle)) : "");
    if (l1) lines.push({{ text: l1, size: fs, fill: LBL_COLOR, weight: "500" }});
    // v0.9.438 — zweite Reihe direkt darunter, in ihrer Linienfarbe (kein
    // eigener Schalter: wer B wählt, will B auch am Marker sehen).
    if (HAS_B && curB != null && MK_SHOW_ELE) {{
      lines.push({{ text: bFmt(curB), size: fs * 0.82, fill: LC_B, weight: "500" }});
    }}
    const p2 = [];
    if (grad != null) p2.push((grad >= 0 ? "↗ +" : "↘ −") + Math.abs(grad).toFixed(1) + " %");
    if (MK_SHOW_DIST) p2.push(curDistKm.toFixed(2) + " km");
    if (p2.length) lines.push({{ text: p2.join("  ·  "), size: fs * 0.72,
      fill: (grad != null && grad < 0) ? "#ff9e6b" : (grad != null ? "#ffcbb0" : LBL_COLOR), weight: "400" }});
    if (lines.length) {{
      const padX = Math.round(fs * 0.7), padTop = Math.round(fs * 0.9), lineGap = Math.round(fs * 1.15);
      const boxH = padTop + (lines.length - 1) * lineGap + Math.round(fs * 0.5);
      let maxTextW = 0;
      for (const l of lines) maxTextW = Math.max(maxTextW, l.text.length * l.size * 0.6);
      const boxW = Math.round(maxTextW + padX * 2);
      let boxX = endX + Math.round(14 * SCALE);
      if (boxX + boxW > W - PAD_R) boxX = endX - Math.round(14 * SCALE) - boxW;
      boxX = Math.max(PAD_L, boxX);
      let boxY = endY - boxH - Math.round(10 * SCALE);
      if (boxY < HEAD_H + Math.round(8 * SCALE)) boxY = endY + Math.round(14 * SCALE);
      const _boxAttrs = {{
        x: boxX, y: boxY, width: boxW, height: boxH, rx: Math.round(8 * TEXT_SCALE),
        fill: _rzRgba(MK_BG, MK_BG_OP),
      }};
      if (MK_BW > 0) {{ _boxAttrs.stroke = MK_BORDER; _boxAttrs["stroke-width"] = Math.max(1, MK_BW * SCALE); }}
      svg.appendChild(svgNS("rect", _boxAttrs));
      for (let i = 0; i < lines.length; i++) {{
        svg.appendChild(svgNS("text", {{
          x: boxX + padX, y: boxY + padTop + i * lineGap,
          fill: lines[i].fill, "font-size": lines[i].size, "font-weight": lines[i].weight,
          "font-family": "-apple-system, sans-serif",
        }}, lines[i].text));
      }}
    }}
  }}
}}

{_script_end}
</script></body></html>
"""


# ── Render-Pipeline ─────────────────────────────────────────────────────────


async def render(cfg: HeightConfig,
                 on_progress: Optional[Callable[[float, str], None]] = None,
                 on_preview: Optional[Callable[[str], None]] = None,
                 is_cancelled: Optional[Callable[[], bool]] = None) -> str:
    """Hauptrenderer für den Höhen-Animator. Async, analog zu animator.render().

    - on_progress(p: 0..1, status_text)
    - on_preview(b64_jpeg)
    - is_cancelled() → bool
    """
    def emit(p: float, msg: str) -> None:
        if on_progress:
            try: on_progress(p, msg)
            except Exception: pass

    def check_cancel() -> None:
        if is_cancelled and is_cancelled():
            raise RenderCancelled("Vom User abgebrochen")

    def push_preview(png_bytes: bytes) -> None:
        if not on_preview:
            return
        try:
            img = Image.open(io.BytesIO(png_bytes))
            img.thumbnail((1280, 1280), Image.LANCZOS)
            if img.mode in ("RGBA", "LA", "P"):
                img = img.convert("RGB")
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=72, optimize=False)
            b64 = base64.b64encode(buf.getvalue()).decode("ascii")
            on_preview(b64)
        except Exception as e:
            _log.debug("preview encode failed: %s", e)

    emit(0.0, "Lade GPX-Datei …")
    _log.info("heightanim.render() start · GPX=%s · output=%s", cfg.gpx_path, cfg.output_path)

    pts, stats = cgpx.parse_gpx(cfg.gpx_path)
    if len(pts) < 2:
        raise ValueError("GPX hat zu wenig Punkte (< 2)")
    # Downsample auf ~1000 für Render — Browser-Side SVG ist sonst zäh
    ds = cgpx.downsample(pts, 1000)
    distances_m = [p.dist_m for p in ds]
    # v0.9.437 (Daten-Animator) — geplottet wird die gewählte Serie (Höhe/Puls/
    # Tempo/…), nicht mehr fix die Höhe. Fehlt sie im Track, greift der Rückfall
    # — dann MUSS auch cfg.series_a mitziehen, damit die Achse nicht „Leistung"
    # an eine Höhenkurve schreibt.
    cfg.series_a, elevations = resolve_series(ds, getattr(cfg, "series_a", "ele"))
    # v0.9.438 — optionale zweite Reihe. Anders als bei A gibt es hier KEINEN
    # Rückfall: ist die gewünschte Reihe im Track nicht da, lassen wir B weg,
    # statt ersatzweise irgendeine andere Kurve zu zeigen.
    values_b = None
    _sid_b = (getattr(cfg, "series_b", "") or "").strip()
    if _sid_b and _sid_b != cfg.series_a:
        _hit_b = series_by_id(available_series(ds), _sid_b)
        if _hit_b is not None:
            values_b = list(_hit_b["values"])
        else:
            cfg.series_b = ""
    elif _sid_b:
        cfg.series_b = ""  # B == A ergibt keine zweite Achse

    html = _make_html(cfg, distances_m, elevations, values_b)

    # Frames
    anim_frames = max(1, cfg.duration_s * cfg.fps)
    hold_frames = max(0, cfg.hold_s * cfg.fps)
    total_frames = anim_frames + hold_frames

    emit(0.02, "Browser laden …")

    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        t_pw = time.time()
        try:
            browser = await p.chromium.launch(
                headless=True,
                args=["--use-angle=default", "--enable-webgl",
                      "--ignore-gpu-blocklist", "--disable-gpu-sandbox",
                      # v0.9.387 — kein macOS-„Lokales Netzwerk"-Dialog (Chromecast/mDNS aus).
                      "--disable-background-networking", "--disable-features=MediaRouter,DialMediaRouteProvider",
                      "--no-first-run", "--no-default-browser-check"],
            )
        except Exception as e:
            _log.error("Playwright/Chromium-Start fehlgeschlagen: %s", e)
            _log.error("Hinweis: ggf. `playwright install chromium` in der App-Venv ausführen.")
            raise
        _log.info("Chromium gestartet in %.1fs", time.time() - t_pw)

        page = await browser.new_page(
            viewport={"width": cfg.width, "height": cfg.height},
            device_scale_factor=1.0,
        )

        def _on_console(msg):
            try: _log.info("page.console [%s] %s", msg.type, msg.text)
            except Exception: pass

        def _on_pageerror(err):
            _log.error("page.pageerror: %s", err)

        page.on("console", _on_console)
        page.on("pageerror", _on_pageerror)

        await page.set_content(html)

        # SVG ist sofort fertig — kurz warten dass _ready gesetzt ist
        for _ in range(30):
            ready = await page.evaluate("window._ready === true")
            if ready:
                break
            await asyncio.sleep(0.1)

        emit(0.05, f"Rendere {total_frames} Frames …")

        # ── ffmpeg starten ─────────────────────────────────────────────
        ffmpeg_bin = find_ffmpeg()
        _log.info("ffmpeg: %s", ffmpeg_bin)
        codec = (cfg.codec or "h264").lower()
        alpha = cfg.transparent_background

        if alpha:
            ffmpeg_cmd = [
                ffmpeg_bin, "-y", "-loglevel", "error",
                "-f", "image2pipe", "-framerate", str(cfg.fps), "-i", "-",
                "-c:v", "prores_ks", "-profile:v", "4",
                "-pix_fmt", "yuva444p10le",
                "-vendor", "ap10",
            ]
        elif codec in ("prores", "prores4444"):
            ffmpeg_cmd = [
                ffmpeg_bin, "-y", "-loglevel", "error",
                "-f", "image2pipe", "-framerate", str(cfg.fps), "-i", "-",
                "-c:v", "prores_ks", "-profile:v", "4",
                "-pix_fmt", "yuv444p10le",
                "-vendor", "ap10",
            ]
        else:
            vcodec = "libx265" if codec in ("h265", "hevc") else "libx264"
            ffmpeg_cmd = [
                ffmpeg_bin, "-y", "-loglevel", "error",
                "-f", "image2pipe", "-framerate", str(cfg.fps), "-i", "-",
                "-c:v", vcodec, "-preset", "fast", "-crf", str(cfg.crf),
                # v0.9.388 — yuv420p (war yuv444p + high444-Profil): AVFoundation/
                # WKWebView/QuickTime dekodieren High-4:4:4 nicht → das Höhen-MP4 blieb
                # in der App-Vorschau und in QuickTime schwarz. Analog zum Animator-Fix
                # v0.9.157. Echtes 4:4:4 bleibt über den ProRes-Codec verfügbar.
                "-pix_fmt", "yuv420p", "-movflags", "+faststart",
            ]
            if vcodec == "libx265":
                ffmpeg_cmd += ["-tag:v", "hvc1"]

        ffmpeg_cmd.append(cfg.output_path)
        _log.info("ffmpeg-Cmd: %s", " ".join(ffmpeg_cmd))
        ff = subprocess.Popen(ffmpeg_cmd, stdin=subprocess.PIPE,
                              stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                              creationflags=_WIN_NO_WINDOW)
        _ff_err_th, _ff_err_buf = _drain_stderr(ff.stderr)  # v0.9.388 — Pipe-Deadlock verhindern

        try:
            preview_every = max(1, cfg.fps // 10)
            for frame in range(total_frames):
                check_cancel()

                if frame < anim_frames:
                    if anim_frames > 1:
                        progress = frame / (anim_frames - 1)
                    else:
                        progress = 1.0
                else:
                    progress = 1.0   # Hold-Phase

                await page.evaluate(f"window.advanceFrame({progress})")
                await page.evaluate("window.waitForRender()")
                shot = await page.screenshot(
                    type="png",
                    omit_background=cfg.transparent_background,
                )
                ff.stdin.write(shot)

                if frame % preview_every == 0:
                    push_preview(shot)
                emit(0.05 + 0.87 * (frame + 1) / total_frames,
                     f"Frame {frame + 1} / {total_frames}")
        except RenderCancelled:
            _log.info("Render abgebrochen — ffmpeg wird beendet und Output gelöscht.")
            try: ff.stdin.close()
            except Exception: pass
            try:
                ff.terminate()
                ff.wait(timeout=3)
            except Exception:
                try: ff.kill()
                except Exception: pass
            try: Path(cfg.output_path).unlink(missing_ok=True)  # type: ignore[arg-type]
            except Exception: pass
            try: await browser.close()
            except Exception: pass
            raise
        finally:
            try: ff.stdin.close()
            except Exception: pass

        emit(0.92, "ffmpeg finalisiert …")
        ff.wait()
        try: _ff_err_th.join(timeout=2)   # v0.9.388 — stderr-Drain-Thread abschließen
        except Exception: pass
        if ff.returncode != 0:
            err = bytes(_ff_err_buf).decode(errors="replace")
            _log.error("ffmpeg returncode=%s — stderr:\n%s", ff.returncode, err)
            raise RuntimeError(f"ffmpeg fehlgeschlagen (returncode={ff.returncode}): {err.strip()[:500]}")
        else:
            try:
                err = bytes(_ff_err_buf).decode(errors="replace").strip()
                if err:
                    _log.info("ffmpeg stderr (info-level): %s", err[:1500])
            except Exception:
                pass

        try:
            sz = Path(cfg.output_path).stat().st_size
            _log.info("Output OK: %s (%.1f MB)", cfg.output_path, sz / 1_000_000)
        except Exception as e:
            _log.warning("Konnte Output-Datei nicht stat()en: %s", e)

        await browser.close()

    emit(1.0, "Fertig.")
    return cfg.output_path


# ── Hilfen für die UI-Vorschau (sync, schnell) ───────────────────────────────


def downsample_for_preview(elevations: list, max_points: int = 400) -> list:
    """Reduziert die Höhen-Datenpunkte auf max_points für die Vorschau."""
    if not elevations:
        return []
    n = len(elevations)
    if n <= max_points:
        return list(elevations)
    step = max(1, n // max_points)
    out = [elevations[i] for i in range(0, n, step)]
    if out[-1] != elevations[-1]:
        out.append(elevations[-1])
    return out


# ── Wegpunkte + Auto-Marker (v0.9.394) ───────────────────────────────────────


def _haversine_m(lat1, lon1, lat2, lon2):
    from math import radians, sin, cos, atan2, sqrt
    R = 6371000.0
    p1, p2 = radians(lat1), radians(lat2)
    dp = radians(lat2 - lat1)
    dl = radians(lon2 - lon1)
    a = sin(dp / 2) ** 2 + cos(p1) * cos(p2) * sin(dl / 2) ** 2
    return 2 * R * atan2(sqrt(a), sqrt(1 - a))


def project_points_onto_track(points: list, track_pts: list) -> list:
    """Projiziert Punkte (lat/lon) auf die Strecke → dist_m + ele des nächsten
    Trackpunkts. Für GPX-Waypoints (haben nur lat/lon). Fotos bringen ihren
    Anchor-Index selbst mit — die werden nicht hier, sondern direkt aufgelöst.

    `points`: [{lat, lon, name?, ...}]  · `track_pts`: List[gpx.TrackPoint]
    Rückgabe: dieselben Dicts + `dist_m`, `ele` (ele aus Trackpunkt, damit der
    Pin exakt auf der Kurve sitzt). Punkte weiter als 250 m vom Track werden
    verworfen (gehören nicht zu dieser Tour).
    """
    if not track_pts:
        return []
    out = []
    for pt in points:
        try:
            lat = float(pt["lat"]); lon = float(pt["lon"])
        except (KeyError, TypeError, ValueError):
            continue
        best_i, best_d = -1, 1e18
        for i, tp in enumerate(track_pts):
            d = _haversine_m(lat, lon, tp.lat, tp.lon)
            if d < best_d:
                best_d, best_i = d, i
        if best_i < 0 or best_d > 250.0:
            continue
        tp = track_pts[best_i]
        merged = dict(pt)
        merged["dist_m"] = tp.dist_m
        merged["ele"] = tp.ele if tp.ele is not None else pt.get("ele")
        out.append(merged)
    return out


def _windowed_gradient(dists: list, elevs: list, i: int, window_m: float = 60.0) -> float:
    """Steigung in % um Index i über ein ±window Fenster (rausch-robuster als
    Punkt-zu-Punkt). Positiv = bergauf."""
    n = len(dists)
    if n < 2:
        return 0.0
    d0 = dists[i]
    lo = i
    while lo > 0 and d0 - dists[lo] < window_m:
        lo -= 1
    hi = i
    while hi < n - 1 and dists[hi] - d0 < window_m:
        hi += 1
    dd = dists[hi] - dists[lo]
    if dd <= 0:
        return 0.0
    e_lo = elevs[lo] if elevs[lo] is not None else 0.0
    e_hi = elevs[hi] if elevs[hi] is not None else 0.0
    return (e_hi - e_lo) / dd * 100.0


# ── Serien-Katalog (Daten-Animator) ─────────────────────────────────────────
# Der Daten-Animator plottet EINE beliebige Messreihe pro Achse. Zwei Quellen:
#   • abgeleitet — aus der Geometrie gerechnet (siehe core/sensors.py: Distanz/
#     Tempo/Steigung gehören bewusst NICHT in die Sensor-Registry)
#   • Sensoren  — TrackPoint.extra[key] (FIT/GPX-Extensions), Label+Einheit aus
#     sensors.FIELD_META (inkl. Projekt-Overrides via field_meta_ov)
# `available_series()` liefert nur, was der geladene Track WIRKLICH hergibt —
# die UI graut alles andere aus.
DERIVED_SERIES: dict[str, tuple[str, str]] = {
    "ele":   ("Höhe",     "m"),
    "speed": ("Tempo",    "km/h"),
    "grade": ("Steigung", "%"),
}


def _series_speed(points: list) -> list[float]:
    """Tempo [km/h] pro Punkt aus Distanz/Zeit, ±1 geglättet (ruhige Kurve)."""
    n = len(points)
    out = [0.0] * n
    for i in range(n):
        a = max(0, i - 1)
        b = min(n - 1, i + 1)
        dt = points[b].elapsed_s - points[a].elapsed_s
        dd = points[b].dist_m - points[a].dist_m
        out[i] = (dd / dt * 3.6) if dt > 0 else 0.0
    return out


def _series_grade(points: list) -> list[float]:
    """Steigung [%] pro Punkt über ein ±60-m-Fenster (rausch-robust)."""
    dists = [p.dist_m for p in points]
    elevs = [p.ele for p in points]
    return [_windowed_gradient(dists, elevs, i) for i in range(len(points))]


def _fill_gaps(vals: list) -> list[float]:
    """Lücken (None) mit dem letzten gültigen Wert füllen; führende mit dem
    ersten gültigen. Sensoren liefern nicht an jedem Punkt einen Wert."""
    out: list[float] = []
    last = None
    for v in vals:
        if isinstance(v, (int, float)):
            last = float(v)
        out.append(last if last is not None else 0.0)
    first = next((x for x in out if x != 0.0), None)
    if first is not None:
        for i, v in enumerate(out):
            if v == 0.0 and (vals[i] is None or not isinstance(vals[i], (int, float))):
                out[i] = first
            else:
                break
    return out


def available_series(points: list, overrides: dict | None = None) -> list[dict]:
    """Alle im Track nutzbaren Messreihen für den Daten-Animator.

    Rückgabe: [{"id","label","unit","values"}] — abgeleitet zuerst (Höhe,
    Tempo, Steigung), danach die Sensorfelder in stabiler Reihenfolge.
    """
    out: list[dict] = []
    if not points:
        return out

    has_ele = any(p.ele is not None for p in points)
    has_time = any(getattr(p, "time", None) for p in points) and points[-1].elapsed_s > 0

    if has_ele:
        lbl, unit = DERIVED_SERIES["ele"]
        out.append({"id": "ele", "label": lbl, "unit": unit,
                    "values": [(p.ele if p.ele is not None else 0.0) for p in points]})
    if has_time:
        lbl, unit = DERIVED_SERIES["speed"]
        out.append({"id": "speed", "label": lbl, "unit": unit,
                    "values": [round(v, 2) for v in _series_speed(points)]})
    if has_ele:
        lbl, unit = DERIVED_SERIES["grade"]
        out.append({"id": "grade", "label": lbl, "unit": unit,
                    "values": [round(v, 2) for v in _series_grade(points)]})

    # Sensorfelder: nur numerische, die mindestens einmal vorkommen. Bekannte
    # Felder (in FIELD_META) zuerst, danach unbekannte Hersteller-/Developer-
    # Felder (label == key) — sonst stehen „unknown_61" & Co. mitten zwischen
    # Puls und Temperatur. Innerhalb der Gruppen alphabetisch nach Label.
    keys: set[str] = set()
    for p in points:
        try:
            keys.update(getattr(p, "extra", None) or {})
        except Exception:
            pass
    sensors: list[dict] = []
    for k in keys:
        raw = [(p.extra or {}).get(k) for p in points]
        if not any(isinstance(v, (int, float)) for v in raw):
            continue
        label, unit = _sensors.field_meta_ov(k, overrides)
        sensors.append({"id": k, "label": label, "unit": unit,
                        "values": [round(v, 2) for v in _fill_gaps(raw)]})
    sensors.sort(key=lambda s: (s["id"] not in _sensors.FIELD_META, s["label"].lower()))
    out.extend(sensors)
    return out


def series_by_id(series: list, sid: str) -> dict | None:
    """Serie aus available_series()-Liste holen (oder None)."""
    for s in series or []:
        if s.get("id") == sid:
            return s
    return None


def resolve_series(points: list, sid: str, overrides: dict | None = None) -> tuple[str, list[float]]:
    """(effektive_id, werte) der Serie `sid` — mit Rückfall auf Höhe bzw. die
    erste verfügbare Reihe, damit ein Track ohne die gewünschte Serie (z.B.
    kein Puls aufgezeichnet) den Render nicht kippt.

    Gibt bewusst die EFFEKTIVE ID mit zurück: Wer beschriftet, muss sie nutzen —
    sonst steht „Leistung / W" an einer Höhenkurve.
    """
    ser = available_series(points, overrides)
    hit = series_by_id(ser, sid or "ele") or series_by_id(ser, "ele") or (ser[0] if ser else None)
    if hit is None:
        return (sid or "ele"), [0.0] * len(points)
    return hit["id"], list(hit["values"])


def _series_decimals(sid: str) -> int:
    """Sinnvolle Nachkommastellen je Serie — Puls/Höhe/Leistung ganzzahlig,
    Tempo/Steigung/Temperatur eine Stelle (sonst zappelt die Anzeige)."""
    return 1 if sid in ("speed", "grade", "temperature", "core_temp") else 0


def series_meta(sid: str, labels: dict | None = None, units: dict | None = None) -> tuple[str, str]:
    """(Label, Einheit) einer Serie. Reihenfolge: von der UI durchgereichte
    (lokalisierte) Werte → abgeleiteter Default → Sensor-Registry."""
    lbl = (labels or {}).get(sid)
    unit = (units or {}).get(sid)
    if lbl is None or unit is None:
        if sid in DERIVED_SERIES:
            d_lbl, d_unit = DERIVED_SERIES[sid]
        else:
            d_lbl, d_unit = _sensors.field_meta(sid)
        lbl = d_lbl if lbl is None else lbl
        unit = d_unit if unit is None else unit
    return lbl, unit


# ── Overlay-Diagramm für den Animator (v0.9.443) ─────────────────────────────
# Ein Animator-Diagramm-Overlay ist ein voll konfiguriertes Daten-Animator-Chart,
# das als transparentes <iframe srcdoc=_make_html> in den Video-Render (UND die
# Live-Vorschau) eingebettet wird. Diese Funktionen sind die EINE gemeinsame
# Quelle für beide Seiten → Render und Vorschau können nie auseinanderdriften.


def _hex_rgb(hexs: str, fallback=(26, 26, 26)):
    """(r,g,b) aus '#rrggbb'/'#rgb'; robust gegen Müll → fallback."""
    try:
        h = (hexs or "").strip().lstrip("#")
        if len(h) == 3:
            h = h[0] * 2 + h[1] * 2 + h[2] * 2
        if len(h) < 6:
            return fallback
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))
    except Exception:
        return fallback


def _overlay_heightcfg(style: dict, *, sid_a: str, sid_b: str,
                       width: int, height: int, transparent: bool,
                       bg_override: str | None = None,
                       fg_opacity: float = 1.0,
                       text_scale: float = 0.0) -> "HeightConfig":
    """Baut aus einem Style-Snapshot (Daten-Animator-Params) eine HeightConfig
    für ein Overlay-Chart. Tolerant gegen fehlende Keys; series_a/series_b werden
    von den aufgelösten (effektiven) IDs überschrieben. `bg_override` (z.B. eine
    rgba-Farbe) ersetzt background_color; `fg_opacity` → foreground_opacity."""
    g = lambda k, d: style.get(k, d) if isinstance(style, dict) else d
    return HeightConfig(
        gpx_path="", output_path="",
        width=int(width), height=int(height),
        transparent_background=bool(transparent),
        foreground_opacity=float(fg_opacity),
        series_a=sid_a or "ele",
        series_b=(sid_b or ""),
        line_color_b=g("line_color_b", "#2e86de"),
        line_width_b=float(g("line_width_b", 3.0) or 3.0),
        series_labels=g("series_labels", {}) or {},
        series_units=g("series_units", {}) or {},
        background_color=(bg_override if bg_override else g("background_color", "#1a1a1a")),
        line_color=g("line_color", "#ff6b35"),
        line_width=float(g("line_width", 4.0) or 4.0),
        grid_enabled=bool(g("grid_enabled", True)),
        show_axes=bool(g("show_axes", True)),
        # v0.9.447 — Achsen einzeln + Schriftgröße. `text_scale` kommt vom Aufrufer:
        # bei Overlays die Skala der VIDEO-Auflösung, damit die Beschriftung nicht
        # mit der kleinen Box mitschrumpft.
        axis_x_labels=bool(g("axis_x_labels", True)),
        axis_y_labels=bool(g("axis_y_labels", True)),
        axis_y2_labels=bool(g("axis_y2_labels", True)),
        axis_x_ticks=int(g("axis_x_ticks", 6) or 6),
        axis_y_ticks=int(g("axis_y_ticks", 5) or 5),
        axis_font_size=float(g("axis_font_size", 20.0) or 20.0),
        text_scale=float(text_scale or 0.0),
        show_marker=bool(g("show_marker", True)),
        marker_show_dot=bool(g("marker_show_dot", True)),
        grid_color=g("grid_color", "#3a3a3a"),
        label_color=g("label_color", "#cccccc"),
        smoothing=int(g("smoothing", 0) or 0),
        area_fill=bool(g("area_fill", True)),
        area_color=g("area_color", "#ff6b35"),
        area_opacity=int(g("area_opacity", 18)),
        area_mode=g("area_mode", "smooth"),
        fill_stops=g("fill_stops", []) or [],
        bg_mode=g("bg_mode", "smooth"),
        bg_clip=bool(g("bg_clip", False)),
        bg_stops=g("bg_stops", []) or [],
        line_mode=g("line_mode", "smooth"),
        line_stops=g("line_stops", []) or [],
        marker_dot_color=g("marker_dot_color", "#ffffff"),
        marker_dot_size=float(g("marker_dot_size", 6.0) or 6.0),
        marker_bg=g("marker_bg", "#000000"),
        marker_bg_opacity=float(g("marker_bg_opacity", 0.6) or 0.6),
        marker_border_color=g("marker_border_color", "#ff6b35"),
        marker_border_width=float(g("marker_border_width", 1.5) or 1.5),
        marker_font_size=float(g("marker_font_size", 16.0) or 16.0),
        marker_show_icon=bool(g("marker_show_icon", True)),
        marker_show_ele=bool(g("marker_show_ele", True)),
        marker_show_dist=bool(g("marker_show_dist", True)),
        show_stats_header=bool(g("show_stats_header", True)),
        stats_fields=list(g("stats_fields", None) or [
            "distance", "updown", "avg_grad", "max_grad", "ele_max"]),
        stats_labels=dict(g("stats_labels", None) or {}),
        show_gradient=bool(g("show_gradient", True)),
        waypoints=list(g("waypoints", None) or []),
        trim_start=float(g("trim_start", 0.0) or 0.0),
        trim_end=float(g("trim_end", 1.0) or 1.0),
    )


def resolve_overlay_chart(points: list, cum_dist: list[float], style: dict,
                          *, series_a: str, series_b: str = "",
                          width: int, height: int,
                          transparent: bool = True,
                          fg_opacity: float = 1.0, bg_opacity: float = 1.0,
                          overrides: dict | None = None,
                          inline_id: str = "",
                          text_scale: float = 0.0,
                          style_over: dict | None = None) -> str:
    """Fertige Chart-HTML für EIN Animator-Diagramm-Overlay.

    Löst die gewünschten Serien aus `points` auf (mit Rückfall), baut die
    HeightConfig aus `style` und ruft `_make_html` mit den Distanzen des
    Animator-Tracks (`cum_dist`). Wird identisch von Render (core/animator.py)
    und Live-Vorschau (Bridge in app.py) genutzt.

    Wichtig (WKWebView-tauglich): der Hintergrund wird als **rgba** IN das
    Chart-Dokument gebacken (nicht transparentes iframe + CSS-Container — das
    zeigt in WKWebView eine weiße iframe-Basis). Vorder- und Hintergrund-Deckkraft
    getrennt: bg → Alpha der Hintergrundfarbe, fg → SVG-Opacity (foreground_opacity).
    """
    # v0.9.447 — `style_over` sind Pro-Diagramm-Übersteuerungen (z.B. Achsen an/aus,
    # Schriftgröße) die der Karte im Animator gehören, nicht dem Daten-Animator-Stil.
    if style_over:
        style = dict(style or {})
        style.update({k: v for k, v in style_over.items() if v is not None})
    sid_a, vals_a = resolve_series(points, series_a or "ele", overrides)
    sid_b, vals_b = "", None
    if (series_b or "").strip():
        sid_b, vals_b = resolve_series(points, series_b, overrides)
    _bo = max(0.0, min(1.0, float(bg_opacity)))
    _fo = max(0.0, min(1.0, float(fg_opacity)))
    _base = (style or {}).get("background_color", "#1a1a1a") if isinstance(style, dict) else "#1a1a1a"
    _r, _g, _b = _hex_rgb(_base, (26, 26, 26))
    bg_rgba = f"rgba({_r},{_g},{_b},{round(_bo, 3)})"
    if inline_id:
        # Inline-Vorschau (kein iframe): SVG bleibt transparent — den Hintergrund
        # legt die Vorschau-JS als eigenes DIV mit `bg_rgba` HINTER das SVG. So
        # ist Vorder- von Hintergrund-Deckkraft entkoppelt (fg wirkt nur aufs SVG),
        # und die Karte scheint bei bg-Alpha < 1 direkt durch (DOM-Compositing).
        cfg = _overlay_heightcfg(style, sid_a=sid_a, sid_b=(sid_b if vals_b else ""),
                                 width=width, height=height, transparent=True,
                                 fg_opacity=_fo, text_scale=text_scale)
    else:
        # Render/iframe: Hintergrund als rgba IN das Dokument backen (Chromium
        # komponiert transparente iframes korrekt → Karte scheint durch).
        cfg = _overlay_heightcfg(style, sid_a=sid_a, sid_b=(sid_b if vals_b else ""),
                                 width=width, height=height, transparent=False,
                                 bg_override=bg_rgba, fg_opacity=_fo,
                                 text_scale=text_scale)
    return _make_html(cfg, list(cum_dist), list(vals_a),
                      list(vals_b) if vals_b else None, inline_id=inline_id)


def make_standalone_html(cfg: "HeightConfig", distances_m: list, elevations: list,
                         values_b: list | None = None,
                         *, replay_label: str = "↻ Neu", loop: bool = True) -> str:
    """v0.9.397 — In sich geschlossene, selbst-laufende HTML-Seite fürs Web/Blog.

    Nutzt EXAKT denselben Zeichen-Code wie der Video-Render (`_make_html`),
    transformiert die Seite aber:
      - responsive (SVG skaliert, kein Distort → `xMidYMid meet`),
      - selbst-laufende Animation (requestAnimationFrame-Loop treibt
        `window.advanceFrame` — dieselbe Funktion, die der Render Frame-für-
        Frame aufruft), optional Endlos-Loop mit Hold-Pause,
      - dezenter Replay-Button unten links.
    Reines HTML5 + Vanilla-JS, keine externen Abhängigkeiten.
    """
    import re as _re, html as _h
    page = _make_html(cfg, distances_m, elevations, values_b)
    bg = cfg.background_color if not cfg.transparent_background else "transparent"
    new_style = (
        "<style>"
        "html,body{margin:0;padding:0;height:100%;background:" + bg + ";overflow:hidden}"
        "body{position:relative}"
        "#svg{width:100%;height:100%;display:block}"
        "#rz-replay{position:absolute;left:14px;bottom:14px;z-index:5;"
        "font:600 13px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;"
        "color:#fff;background:rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.35);"
        "border-radius:8px;padding:7px 13px;cursor:pointer;opacity:.8}"
        "#rz-replay:hover{opacity:1}"
        "</style>"
    )
    page = _re.sub(r"<style>.*?</style>", lambda m: new_style, page, count=1, flags=_re.S)
    page = page.replace('preserveAspectRatio="none"', 'preserveAspectRatio="xMidYMid meet"', 1)
    page = page.replace("<title>height-render</title>", "<title>Datenprofil</title>", 1)
    dur_ms = max(100.0, float(cfg.duration_s) * 1000.0)
    hold_ms = max(0.0, float(cfg.hold_s) * 1000.0)
    end_behaviour = ("if(HOLD>0){held=ts;}else{t0=ts;}" if loop
                     else "cancelAnimationFrame(raf);return;")
    loop_js = (
        "\n(function(){"
        "var DUR=" + repr(dur_ms) + ",HOLD=" + repr(hold_ms) + ",t0=null,held=null,raf=null;"
        "function fr(ts){"
        "if(t0===null)t0=ts;"
        "if(held!==null){if(ts-held>=HOLD){held=null;t0=ts;window.advanceFrame(0);}raf=requestAnimationFrame(fr);return;}"
        "var p=DUR>0?Math.min(1,(ts-t0)/DUR):1;window.advanceFrame(p);"
        "if(p>=1){" + end_behaviour + "}"
        "raf=requestAnimationFrame(fr);}"
        "function start(){t0=null;held=null;if(raf)cancelAnimationFrame(raf);raf=requestAnimationFrame(fr);}"
        "var b=document.getElementById('rz-replay');if(b)b.addEventListener('click',start);start();"
        "})();\n"
    )
    btn = '<button id="rz-replay" type="button">' + _h.escape(replay_label) + '</button>'
    page = page.replace("</script></body></html>",
                        loop_js + "</script>\n" + btn + "\n</body></html>", 1)
    return page


def make_embed_snippet(standalone_html: str, cfg: "HeightConfig") -> str:
    """v0.9.397 — Fertiges <iframe srcdoc>-Snippet zum direkten Einfügen in einen
    Blogpost / WordPress-„Custom HTML"-Block. Die komplette Seite steckt im
    `srcdoc` → perfekte Isolation vom Theme-CSS, kein Upload nötig."""
    import html as _h
    w, h = int(cfg.width), int(cfg.height)
    esc = _h.escape(standalone_html, quote=True)
    return ('<iframe title="Datenprofil" loading="lazy" '
            'style="width:100%;max-width:' + str(w) + 'px;aspect-ratio:' + str(w) + '/' + str(h)
            + ';border:0;display:block;margin:1rem auto" '
            'srcdoc="' + esc + '"></iframe>')


def detect_auto_markers(track_pts: list) -> list:
    """Erkennt markante Punkte: höchster + tiefster Punkt, steilster An- und
    Abstieg. Rückgabe [{dist_m, ele, kind, label_key}] — die UI beschriftet.
    `kind`: 'peak' | 'valley' | 'steep_up' | 'steep_down'.
    """
    pts = [p for p in track_pts if p.ele is not None]
    if len(pts) < 2:
        return []
    dists = [p.dist_m for p in track_pts]
    elevs = [p.ele for p in track_pts]
    # Höchster / tiefster Punkt
    hi_i = max(range(len(track_pts)),
               key=lambda i: (elevs[i] if elevs[i] is not None else -1e18))
    lo_i = min(range(len(track_pts)),
               key=lambda i: (elevs[i] if elevs[i] is not None else 1e18))
    # Steilster An-/Abstieg (windowed)
    grads = [_windowed_gradient(dists, elevs, i) for i in range(len(track_pts))]
    up_i = max(range(len(grads)), key=lambda i: grads[i])
    dn_i = min(range(len(grads)), key=lambda i: grads[i])
    out = []
    seen = set()
    for i, kind in ((hi_i, "peak"), (lo_i, "valley"),
                    (up_i, "steep_up"), (dn_i, "steep_down")):
        if i in seen or elevs[i] is None:
            continue
        seen.add(i)
        out.append({
            "dist_m": dists[i],
            "ele": elevs[i],
            "kind": kind,
            "grad": round(grads[i], 1),
        })
    return out
