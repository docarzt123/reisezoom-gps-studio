"""Höhen-Animator (v0.9.94) — Höhenprofil als Video.

Render-Pipeline analog zum Animator:
- HTML-Page mit SVG-Höhenprofil + JS-`advanceFrame(progress)` Funktion
- Playwright Headless-Chromium-Browser, lädt diese HTML
- Frame-by-Frame Screenshot → ffmpeg-Pipe → MP4 / .mov

Codec-Modi:
- "h264" (Default)    → .mp4, yuv444p, +faststart
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
import time

# v0.9.274 (Beta-Tester-Bug) — Windows: ffmpeg ohne sichtbares Konsolenfenster starten.
_WIN_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
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
    # Visuelles
    background_color: str = "#1a1a1a"
    line_color: str = "#ff6b35"
    line_width: float = 4.0
    grid_enabled: bool = True
    show_axes: bool = True
    show_marker: bool = True
    # Trim
    trim_start: float = 0.0        # 0..1
    trim_end: float = 1.0          # 0..1


# ── HTML-Generator ──────────────────────────────────────────────────────────


def _make_html(cfg: HeightConfig, distances_m: list[float], elevations: list[float]) -> str:
    """Erzeugt die HTML-Seite die im Headless-Browser geladen wird.

    Die Seite zeichnet das Höhenprofil als SVG. Eine globale Funktion
    `window.advanceFrame(progress)` setzt den fortschritt 0..1 und löst
    ein synchrones Re-Render aus. Pro Frame: advanceFrame(p) → wait →
    screenshot.
    """
    data_json = json.dumps({
        "distances_m": distances_m,
        "elevations": elevations,
    })
    bg = cfg.background_color if not cfg.transparent_background else "transparent"
    grid_color = "#3a3a3a"
    label_color = "#cccccc"

    return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>height-render</title>
<style>
  html, body {{ margin: 0; padding: 0; background: {bg}; overflow: hidden; }}
  body {{ width: {cfg.width}px; height: {cfg.height}px; }}
  #svg {{ width: 100%; height: 100%; display: block; }}
</style></head>
<body>
<svg id="svg" width="{cfg.width}" height="{cfg.height}" viewBox="0 0 {cfg.width} {cfg.height}"
     preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"></svg>
<script>
const DATA = {data_json};
const W = {cfg.width}, H = {cfg.height};
const BG = {json.dumps(bg)};
const TRANSPARENT = {str(cfg.transparent_background).lower()};
const LC = {json.dumps(cfg.line_color)};
const LW = {float(cfg.line_width)};
const SHOW_GRID = {str(cfg.grid_enabled).lower()};
const SHOW_AXES = {str(cfg.show_axes).lower()};
const SHOW_MARKER = {str(cfg.show_marker).lower()};
const TRIM_S = {float(cfg.trim_start)};
const TRIM_E = {float(cfg.trim_end)};
const GRID_COLOR = {json.dumps(grid_color)};
const LBL_COLOR = {json.dumps(label_color)};

// Padding skaliert mit Höhe (für 4K-Render werden Achsenlabels größer)
const SCALE = H / 1080;
const PAD_L = Math.round(80 * SCALE);
const PAD_R = Math.round(40 * SCALE);
const PAD_T = Math.round(60 * SCALE);
const PAD_B = Math.round((SHOW_AXES ? 80 : 30) * SCALE);
const PLOT_W = Math.max(20, W - PAD_L - PAD_R);
const PLOT_H = Math.max(20, H - PAD_T - PAD_B);
const FONT_SIZE = Math.round(20 * SCALE);
const AXES_FONT = `${{FONT_SIZE}}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
const STATS_FONT = `${{Math.round(22 * SCALE)}}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;

// Trim: virtuelles Distanz-Fenster
const dists = DATA.distances_m;
const elevs = DATA.elevations;
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

const svg = document.getElementById("svg");

function svgNS(tag, attrs, text) {{
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  if (attrs) for (const k in attrs) el.setAttribute(k, attrs[k]);
  if (text != null) el.textContent = text;
  return el;
}}

function draw(progress) {{
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  // Background (nur wenn nicht transparent — sonst ist der body transparent)
  if (!TRANSPARENT) {{
    svg.appendChild(svgNS("rect", {{ x: 0, y: 0, width: W, height: H, fill: BG }}));
  }}

  // Hilfsgitter
  if (SHOW_GRID) {{
    for (let i = 0; i <= 5; i++) {{
      const y = PAD_T + (i / 5) * PLOT_H;
      svg.appendChild(svgNS("line", {{
        x1: PAD_L, x2: PAD_L + PLOT_W, y1: y, y2: y,
        stroke: GRID_COLOR, "stroke-width": Math.max(1, Math.round(SCALE)),
        opacity: 0.4,
      }}));
    }}
    for (let i = 0; i <= 6; i++) {{
      const x = PAD_L + (i / 6) * PLOT_W;
      svg.appendChild(svgNS("line", {{
        x1: x, x2: x, y1: PAD_T, y2: PAD_T + PLOT_H,
        stroke: GRID_COLOR, "stroke-width": Math.max(1, Math.round(SCALE)),
        opacity: 0.4,
      }}));
    }}
  }}

  // Achsen
  if (SHOW_AXES) {{
    for (let i = 0; i <= 6; i++) {{
      const x = PAD_L + (i / 6) * PLOT_W;
      const distKm = (i / 6) * (dTrimSpan / 1000);
      const t = svgNS("text", {{
        x, y: H - PAD_B + Math.round(28 * SCALE),
        fill: LBL_COLOR, "font-size": FONT_SIZE,
        "text-anchor": "middle", "font-family": "-apple-system, sans-serif",
      }}, distKm.toFixed(1) + " km");
      svg.appendChild(t);
    }}
    for (let i = 0; i <= 5; i++) {{
      const y = PAD_T + (i / 5) * PLOT_H;
      const ele = eHi - (i / 5) * eSpan;
      const t = svgNS("text", {{
        x: PAD_L - Math.round(12 * SCALE), y: y + Math.round(6 * SCALE),
        fill: LBL_COLOR, "font-size": FONT_SIZE,
        "text-anchor": "end", "font-family": "-apple-system, sans-serif",
      }}, ele.toFixed(0) + " m");
      svg.appendChild(t);
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

  // Fill
  if (progress > 0) {{
    const baseline = PAD_T + PLOT_H;
    const fillD = partialD + " L" + endX.toFixed(1) + " " + baseline.toFixed(1)
                + " L" + px(dists[i0]).toFixed(1) + " " + baseline.toFixed(1) + " Z";
    svg.appendChild(svgNS("path", {{
      d: fillD, fill: LC, opacity: 0.18,
    }}));
  }}
  // Linie
  if (progress > 0) {{
    svg.appendChild(svgNS("path", {{
      d: partialD, fill: "none", stroke: LC,
      "stroke-width": LW * SCALE,
      "stroke-linejoin": "round", "stroke-linecap": "round",
    }}));
  }}

  // Marker
  if (SHOW_MARKER && progress > 0) {{
    svg.appendChild(svgNS("circle", {{
      cx: endX, cy: endY,
      r: Math.max(8, LW * 2.5) * SCALE,
      fill: LC, opacity: 0.35,
    }}));
    svg.appendChild(svgNS("circle", {{
      cx: endX, cy: endY,
      r: Math.max(4, LW * 1.1) * SCALE,
      fill: "#fff", stroke: LC, "stroke-width": 2 * SCALE,
    }}));
  }}

  // Stats-Box oben rechts (live: km + m)
  if (progress > 0) {{
    const boxW = Math.round(220 * SCALE), boxH = Math.round(80 * SCALE);
    const boxX = W - PAD_R - boxW;
    const boxY = Math.round(20 * SCALE);
    svg.appendChild(svgNS("rect", {{
      x: boxX, y: boxY, width: boxW, height: boxH,
      rx: Math.round(10 * SCALE), ry: Math.round(10 * SCALE),
      fill: "rgba(0,0,0,0.55)", stroke: LC,
      "stroke-width": Math.max(1, Math.round(1.5 * SCALE)),
      opacity: 0.95,
    }}));
    const curDist = (dCurrent - dTrimStart) / 1000;
    svg.appendChild(svgNS("text", {{
      x: boxX + Math.round(18 * SCALE),
      y: boxY + Math.round(34 * SCALE),
      fill: "#fff", "font-size": Math.round(22 * SCALE),
      "font-family": "-apple-system, sans-serif",
    }}, "↗ " + curDist.toFixed(2) + " km"));
    svg.appendChild(svgNS("text", {{
      x: boxX + Math.round(18 * SCALE),
      y: boxY + Math.round(64 * SCALE),
      fill: "#fff", "font-size": Math.round(22 * SCALE),
      "font-family": "-apple-system, sans-serif",
    }}, "⛰ " + curEle.toFixed(0) + " m"));
  }}
}}

window.advanceFrame = function(progress) {{
  draw(progress);
}};
window.isReady = function() {{ return true; }};
window.waitForRender = function() {{ return new Promise(r => setTimeout(r, 0)); }};

// Initial frame (progress=0)
draw(0);
window._ready = true;
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
    elevations  = [(p.ele if p.ele is not None else 0.0) for p in ds]

    html = _make_html(cfg, distances_m, elevations)

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
                      "--ignore-gpu-blocklist", "--disable-gpu-sandbox"],
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
                "-pix_fmt", "yuv444p", "-movflags", "+faststart",
            ]
            if vcodec == "libx264":
                ffmpeg_cmd += ["-profile:v", "high444"]
            if vcodec == "libx265":
                ffmpeg_cmd += ["-tag:v", "hvc1"]

        ffmpeg_cmd.append(cfg.output_path)
        _log.info("ffmpeg-Cmd: %s", " ".join(ffmpeg_cmd))
        ff = subprocess.Popen(ffmpeg_cmd, stdin=subprocess.PIPE,
                              stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                              creationflags=_WIN_NO_WINDOW)

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
        if ff.returncode != 0:
            err = ff.stderr.read().decode(errors="replace")
            _log.error("ffmpeg returncode=%s — stderr:\n%s", ff.returncode, err)
            raise RuntimeError(f"ffmpeg fehlgeschlagen (returncode={ff.returncode}): {err.strip()[:500]}")
        else:
            try:
                err = ff.stderr.read().decode(errors="replace").strip()
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
