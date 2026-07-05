"""
Animator-Backend: rendert GPX-Track als animiertes Video via Mapbox + Playwright + ffmpeg.

Konfigurierbare Map-Styles, Pitch, Rotation, Auflösung, Dauer, Farbe.
Progress-Callback für UI-Anbindung.
"""
from __future__ import annotations

import asyncio
import base64
import bisect
import io
import json
import logging
import math
import os
import shutil
import subprocess
import sys
import threading
import time

# v0.9.274 (Nutzer-Bug) — Windows: ffmpeg ohne sichtbares Konsolenfenster starten.
_WIN_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0


def _drain_stderr(pipe):
    """v0.9.388 — liest den stderr-Pipe eines Subprozesses (ffmpeg) fortlaufend in
    einem Thread leer. Sonst blockiert ffmpeg, sobald es mehr als ~64 KB auf stderr
    schreibt (klassisch: Platte voll → 'No space left on device' pro Frame), weil der
    Pipe-Puffer volläuft → ffmpeg liest stdin nicht mehr → `ff.stdin.write(frame)`
    hängt für immer (Render „friert" ein, Cancel greift nicht). Gibt (thread, bytearray)
    zurück; die bytearray füllt sich live und wird nach `ff.wait()` gelesen."""
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


class RenderCancelled(Exception):
    """Wird vom Render geworfen, wenn `is_cancelled()` True liefert. Worker
    behandelt das als sauberen Abbruch (nicht als Fehler)."""
    pass

# Wir nutzen das Root-Logger-Setup aus `core.logger` (wird von app.py beim Start
# aufgerufen). Hier nur den Modul-Logger anlegen — wenn nichts konfiguriert ist
# (z.B. CLI-Test) fällt das auf den Default-Handler zurück.
_log = logging.getLogger("animator")


def find_ffmpeg() -> str:
    """Sucht ffmpeg robust.

    Priorität:
    1. System-ffmpeg via PATH (`which ffmpeg`) — User hat's selbst installiert
    2. Typische macOS-/Linux-Pfade
    3. Typische Windows-Pfade
    4. **Gebündeltes Binary** aus `imageio-ffmpeg` — wird mit der App
       ausgeliefert, sodass User NICHTS extra installieren müssen.

    Erst ab Stufe 4 muss kein User je was machen — der Animator funktioniert
    out-of-the-box auf macOS/Win/Linux.
    """
    # 1. PATH
    p = shutil.which("ffmpeg")
    if p:
        return p
    # 2 + 3. Typische Fix-Pfade
    candidates = [
        "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg",
        r"C:\Program Files\ffmpeg\bin\ffmpeg.exe",
        r"C:\ffmpeg\bin\ffmpeg.exe",
    ]
    for cand in candidates:
        if os.path.isfile(cand):
            return cand
    # 4. Fallback: gebündeltes imageio-ffmpeg-Binary
    try:
        import imageio_ffmpeg  # type: ignore
        bundled = imageio_ffmpeg.get_ffmpeg_exe()
        if bundled and os.path.isfile(bundled):
            return bundled
    except Exception:
        pass
    raise RuntimeError(
        "ffmpeg nicht gefunden — weder im System-PATH noch als gebündeltes Binary. "
        "Bitte einmalig installieren: `brew install ffmpeg` (macOS), "
        "https://ffmpeg.org/download.html (Windows), `apt install ffmpeg` (Linux)."
    )

from .gpx import parse_gpx as core_parse_gpx, downsample, TrackPoint
from . import timeline as _timeline  # v0.7.0: Camera-Keyframe-Interpolation
from . import sensors as _sensors    # v0.9.331: FIT-Sensorfeld-Registry


MAP_STYLES = {
    "satellite":         "mapbox://styles/mapbox/standard-satellite",
    "satellite_streets": "mapbox://styles/mapbox/satellite-streets-v12",
    "streets":           "mapbox://styles/mapbox/streets-v12",
    "outdoors":          "mapbox://styles/mapbox/outdoors-v12",
    "light":             "mapbox://styles/mapbox/light-v11",
    "dark":              "mapbox://styles/mapbox/dark-v11",
}


@dataclass
class AnimatorConfig:
    gpx_path: str
    output_path: str
    mapbox_token: str
    map_style: str = "satellite"        # key in MAP_STYLES
    # v0.9.391 — OSM-Fallback (nur Tour-Map/Standbild ohne Mapbox-Token): Karte
    # aus OSM-Raster-Kacheln statt Mapbox-Style. Terrain/Pitch sind bei Raster
    # flach → app.py erzwingt im OSM-Modus enable_terrain=False, pitch=0.
    use_osm: bool = False
    duration_s: int = 12
    hold_s: int = 5
    # v0.9.59 (Nutzer-Wunsch): Intro-Hold analog zu hold_s, aber AM ANFANG.
    # Marker steht intro_s Sekunden am trim_start bevor die Anim-Phase beginnt.
    # Erlaubt langsame Setup-Shots/Kamera-Aufzüge vor dem Track-Start.
    intro_s: int = 0
    fps: int = 30
    width: int = 1920
    height: int = 1080
    pitch: float = 40.0                 # 0 = flat top-down, 85 = max
    rotation: float = 20.0              # Bearing-Sweep über Animation
    # v0.9.307 — Standbild-Modus (Tour-Map = ein statischer Frame vom Animator).
    # `still_frame` aktiviert render_frame(): EIN PNG, volle Strecke, alle
    # Fotos/Schilder/Overlays sichtbar, feste Kamera (kein Sweep/Spin/KFs).
    still_frame: bool = False
    bearing: float = -10.0              # Fester Kamera-Bearing im Standbild
    padding_pct: float = 8.0            # Fit-Rand in % der kürzeren Achse (Standbild)
    show_pins: bool = False             # Start/End-Pin-Ebene (Tour-Map-Erbe)
    # v0.9.82 (Nutzer-Idee „Erde rotiert in Globe-View") — Spin in deg/sec.
    # Wird PRO FRAME on top auf den interpolierten Bearing addiert, in ALLEN
    # Phasen (Intro/Anim/Hold). 0 = aus. Positive Werte = im Uhrzeigersinn,
    # negative = gegen den Uhrzeigersinn. Wirkt zusätzlich zu `rotation`
    # (= linear-Sweep über Anim) und KF-Bearings (= Per-KF-Werte).
    spin_dps: float = 0.0
    # v0.9.84 (Marc-Bug „zoomt weiter raus als eingestellt") — Toggle für
    # van-Wijk-Cinematic-Flug bei großen Zoom-Sprüngen. Default True (=
    # Mapbox-flyTo-Style mit Bogen-Trajectory). False → immer lineare
    # Zoom-Interpolation, kein „Hollywood-rauszoom".
    cinematic_flyto: bool = True
    exaggeration: float = 1.5           # Terrain-3D
    enable_terrain: bool = True         # bei flat-light-Karten oft False
    line_color: str = "#ff6b35"
    line_width: float = 3.5             # Track-Linien-Dicke in px (Glow = 3× davon)
    # Linien-Stil (v0.6.5, Nutzer-Feature-Request):
    # "solid"    — durchgezogene Linie (Default)
    # "dashed"   — gestrichelt
    # "dotted"   — gepunktet
    # "dashdot"  — Strich-Punkt-Strich-Punkt
    # Implementiert via Mapbox `line-dasharray` (in Liniendicken-Einheiten) für
    # die Mapbox-Variante und via SVG `stroke-dasharray` (in Pixeln) für Alpha.
    line_style: str = "solid"
    # Spacing-Faktor für dash/dotted/dashdot (v0.6.6, Nutzer-Folge-Idee).
    # Multipliziert alle Werte im dasharray-Pattern. 1.0 = Default, 0.5 =
    # dichter, 2.0 = weiter. Wirkt nicht bei "solid".
    line_style_spacing: float = 1.0
    # v0.8.10 — Nutzer-Wunsch „3D-Wurm-Look": Track-Linie kriegt
    # zusätzlich einen helleren Highlight-Streifen in der Mitte, der
    # die Linie zylindrisch aussehen lässt (wie eine 3D-Schlange).
    # "flat" (default): klassische 2D-Linie. "tube": mit Highlight oben.
    track_style: str = "flat"
    # v0.8.17 — Classic-Modus „Kamera folgt Track". Wenn True (und KEINE
    # Keyframes mit center gesetzt), zentriert sich die Render-Kamera bei
    # jedem Frame auf den aktuellen Track-Punkt — statt auf dem statischen
    # Bbox-Center zu bleiben. Im Keyframe-Modus wird pro Keyframe entschieden
    # (Field `center` im KF) und dieser globale Toggle wird ignoriert.
    camera_follow_track: bool = False
    # v0.9.275 (Nutzer) — Trägheit beim „Kamera folgt Track": 0 = hart am Punkt (wackelt
    # bei GPS-Rauschen), 1 = sehr träge/weich (Kamera zieht sanft nach). Exponentielle
    # Glättung des Folge-Zentrums über die Frames.
    camera_follow_inertia: float = 0.0
    # v0.9.311 (Marc) — Kamera-Höhe glätten bei „Kamera folgt Track" + Terrain:
    # 0 = aus (Kamera reitet 1:1 auf dem Gelände → hüpft bei starkem Pitch),
    # 0..1 = Tiefpass auf die Geländehöhe unter der Kamera-Mitte (1 = sehr ruhig).
    follow_height_smooth: float = 0.0
    # v0.9.318 — Ruhige Kamera (entkoppelte FreeCamera) gegen Berg-Hüpfen. Default AUS.
    # An = pro Keyframe die exakte 3D-Kamera auslesen + dazwischen interpolieren statt
    # setCenter-aufs-Gelände. Ersetzt das tote follow_height_smooth.
    smooth_camera_3d: bool = False
    # Timeline-Events (v0.7.0) — Liste von Dicts (kind/anchor/payload).
    # Aktuell unterstützt: kind="camera" mit anchor/pitch/bearing/zoom_offset.
    # Vorbereitet für: kind="photo" (v0.7.1), kind="text" (v0.7.2).
    # Leere Liste → klassisches Verhalten (statischer pitch + linearer
    # Bearing-Sweep über `rotation`). Siehe `core/timeline.py`.
    timeline_events: list = field(default_factory=list)
    show_overlays: bool = True          # Master-Schalter (Backwards-Compat)
    # Granulare Overlay-Steuerung (überschreibt show_overlays NICHT — Master bleibt führend).
    # Position: tl|tr|bl|br|bc (bc = bottom-center für volle Breite)
    overlay_totals_enabled: bool = True
    overlay_totals_position: str = "tl"
    overlay_live_enabled: bool = True
    overlay_live_position: str = "tr"
    overlay_elevation_enabled: bool = True
    overlay_elevation_position: str = "bc"
    # v0.9.228 — Zeitfenster pro Overlay-Box (Nutzer-Wunsch „anzeigen ab Sek X
    # bis Sek Y"). In VIDEO-Sekunden (intro + anim + hold). from_s default 0 =
    # ab Start; to_s default 0 = bis Ende (kein oberes Limit). Der Render-Loop
    # ruft window.__overlayTiming(videoSekunde) pro Frame → Box wird ein-/
    # ausgeblendet (visibility). Default 0/0 = ganze Zeit sichtbar (wie bisher).
    overlay_totals_from_s: float = 0.0
    overlay_totals_to_s: float = 0.0
    overlay_live_from_s: float = 0.0
    overlay_live_to_s: float = 0.0
    overlay_elevation_from_s: float = 0.0
    overlay_elevation_to_s: float = 0.0
    # v0.9.321 — Stats-Editor: wählbare + sortierbare Felder pro Box. Leere/None
    # Liste = Default-Felder (= bisheriges Verhalten, Backward-Compat). IDs siehe
    # OVERLAY_LIVE_FIELDS / OVERLAY_TOTAL_FIELDS.
    overlay_live_fields: list = field(default_factory=lambda: list(DEFAULT_LIVE_FIELDS))
    overlay_totals_fields: list = field(default_factory=lambda: list(DEFAULT_TOTAL_FIELDS))
    # v0.9.334 — projekt-eigene Umbenennung/Einheit für Sensorfelder:
    #   {key: {"label": str, "unit": str}}  (z.B. {"cadence": {"label":"Schrittfrequenz","unit":"spm"}})
    overlay_field_overrides: dict = field(default_factory=dict)
    # Globales Styling aller Stats-Boxen.
    overlay_font: str = "system"        # Key aus _OVERLAY_FONTS
    overlay_text_color: str = "#ffffff"
    overlay_bg_color: str = "#000000"
    overlay_bg_opacity: float = 0.55    # 0..1
    codec: str = "h264"                 # "h264" oder "h265" (HEVC, kleinere Files)
    crf: int = 20                       # Qualität: niedriger = besser, 18-22 typisch
    # v0.9.245 — Frame-Erfassung: JPEG ist ~16× schneller zu encoden+übertragen
    # als PNG (gemessen: 2349ms→147ms/Frame @4K). Video wird eh verlustbehaftet
    # zu H.264 codiert → q92-JPEG visuell deckungsgleich. Alpha erzwingt PNG
    # (JPEG kann keine Transparenz).
    frame_format: str = "jpeg"          # "jpeg" (schnell) | "png" (verlustfrei)
    jpeg_quality: int = 92              # 1..100, nur bei frame_format="jpeg"
    encoder_preset: str = "fast"        # libx264/265 -preset
    # OPTIONAL: UI-Viewport-Override (User hat in der Preview gepant/gezoomt).
    # Wenn None → Default: bounds-fit aus Track-Bbox.
    override_center: Optional[tuple[float, float]] = None
    override_zoom: Optional[float] = None
    # v0.9.157 — WYSIWYG-Zoom-Korrektur für KF-/Classic-Render. Das Frontend
    # liefert `correctedZoom(map,W,H) - map.getZoom()` = log2(min(W/pw, H/ph)),
    # also den Zoom-Delta der nötig ist damit der Render (volle Render-Breite)
    # denselben Geo-Ausschnitt zeigt wie die schmale Preview. Im Render-Loop:
    # `abs_shift = zoom_correction - log2(dsf)`, dann `frame_zoom =
    # value_absolute + abs_shift` (fit_zoom_base kürzt sich raus). 0 = aus.
    zoom_correction: float = 0.0
    # Punkte-Anzahl im Track. Höhere Anzahl = glattere Kurve, aber langsamer
    # zu rendern (jeder Frame baut die wachsende Polyline in Mapbox neu auf).
    # Special: 0 (Default) = alle Original-Punkte aus der GPX verwenden, keine
    # Reduktion. Sonst: downsample auf exakt diesen Wert.
    # UX-Wahl: Slider im UI von 10 bis n_points (Original-Anzahl). Default rechts
    # = alle Punkte. Marc kann nur reduzieren, nicht „erhöhen" (es gibt ja
    # keine Punkte „dazu zu erfinden").
    point_count: int = 0
    # Alpha-Channel-Modus: kein Karten-Background, nur Track + Punkt + Overlays
    # auf transparentem Hintergrund. Output ist dann eine ProRes-4444-.mov,
    # die in Premiere/Final Cut/DaVinci/Resolve direkt als Overlay-Layer
    # über echtes Video gelegt werden kann. Pitch/Bearing/Terrain werden
    # in diesem Modus ignoriert (2D top-down macht für Composit am meisten Sinn).
    transparent_background: bool = False
    # Schlagschatten unter der Track-Linie. Macht den Track plastischer —
    # er sieht aus als würde er ein Stückchen über der Karte schweben.
    # `shadow_enabled` = Master-Toggle; `shadow_strength` ist die Offset-Distanz
    # in Pixeln (auch als Blur-Radius verwendet). 0 = aus, 4 = dezent
    # (Default), 10 = sehr stark.
    shadow_enabled: bool = True
    shadow_strength: float = 4.0
    # Glow um die Track-Linie (v0.6.8, Marc-Frage „wo regle ich den Glow?").
    # `glow_enabled` = Master-Toggle (False → Glow-Layer wird nicht gerendert).
    # `glow_strength` = relative Stärke 0–10 (Default 4 = bisheriger Hardcoded-
    # Wert für `line-blur`). Wirkt auf den Blur des Glow-Layers. Width und
    # Opacity bleiben bei 2.85× bzw. 0.35 — Strength macht's „weicher/härter".
    glow_enabled: bool = True
    glow_strength: float = 4.0
    # === Karte glätten / Anti-Flimmer (v0.9.286b, Marc) ===
    # Leichter Tiefpass NUR auf den Satelliten-Canvas gegen Bewegungs-Aliasing
    # („zu scharf"-Flimmern) bei 4K. Wert in Output-Pixeln. 0 = aus (schärfste
    # Karte), Default 1.3 = guter Anti-Flimmer-Kompromiss. Greift nur ab 4K
    # (längere Kante ≥ 3840 px); bei kleineren Auflösungen wirkungslos.
    map_smoothing: float = 1.3
    # === Ghost-Track (v0.9.169) ===
    # Die GANZE Route schwach/transparent als Hintergrund-Linie vorzeichnen,
    # während nur der animierte Teil normal (voll deckend) darüber gezeichnet
    # wird. `ghost_track_enabled` = Master-Toggle, `ghost_track_opacity` = 0..1
    # Deckkraft der Hintergrund-Linie. Liegt UNTER allen anderen Track-Layern.
    ghost_track_enabled: bool = False
    ghost_track_opacity: float = 0.30
    ghost_track_color: str = "#ff6b35"   # v0.9.170 — eigene Farbe (Default = Track-Farbe)
    # v0.9.210/211 (Reiseroute) — zusätzlicher Ghost = geladenes Wander-GPX
    # (andere Linie als die animierte Route). [[lon,lat],…]; leer = aus.
    ghost_gpx_coords: list = field(default_factory=list)
    ghost_gpx_color: str = "#7fa8ff"
    ghost_gpx_opacity: float = 0.60
    ghost_gpx_width: float = 2.5
    ghost_gpx_dashed: bool = True
    # === Karten-Feinabstimmung (v0.5.0) ===
    # Mapbox-Standard-Style-Config-Properties (bei klassischen Styles greifen
    # die `setConfigProperty`-Calls einfach ins Leere, dafür gibt's einen
    # Symbol-Layer-Fallback im HTML-Block).
    #
    # `light_preset` — Beleuchtungs-Voreinstellung. Wirkt nur bei
    # Mapbox-Standard-Styles (standard, standard-satellite). Hammer-Effekt
    # für YouTube-Tracks: "dusk" = goldene Stunde Look.
    light_preset: str = "day"   # "dawn" | "day" | "dusk" | "night"
    show_place_labels: bool = True       # Ortsnamen
    show_road_labels: bool = True        # Straßennamen
    show_poi_labels: bool = True         # POIs / Sehenswürdigkeiten
    show_transit_labels: bool = True     # ÖPNV (Bahnhöfe, Flughäfen, …)
    show_admin_boundaries: bool = True   # Länder-/Bundesländer-/Bezirks-Grenzen
    # DEPRECATED ab v0.5.0 — vorher Master-Checkbox „Karte ohne Beschriftungen".
    # Wenn True, werden ALLE show_*_labels auf False gezwungen. Bleibt für
    # Backwards-Compat mit alten settings.json drin.
    hide_labels: bool = False
    # === Partial-Track-Render (v0.9.41) — Marc-Idee 2026-05-25 ===
    # Trim-Bereich auf der Timeline. Anchors sind 0..1 bezogen auf den GESAMTEN
    # Track (NICHT auf den getrimmten Bereich) — daher bleiben gesetzte
    # Keyframes track-anchor-bezogen wenn der User den Trim verschiebt.
    # render_start_anchor + render_end_anchor definieren NUR was gerendert wird.
    # KFs außerhalb dieses Bereichs wirken als „Anlauf"-Bewegung: die Kamera-
    # Interpolation berücksichtigt sie weiter, sodass am Render-Start die
    # Kamera schon in voller Bewegung sein kann.
    render_start_anchor: float = 0.0   # 0..1, Default = ganzer Track
    render_end_anchor: float = 1.0     # 0..1, Default = ganzer Track
    # Stats-Box (Distanz / Höhenmeter / Zeit) — vom Trim-Bereich oder
    # vom Gesamt-Track? True (Default) = Trim-Werte (Marc-Spec: wer 5 min
    # vom 30-km-Track rendert will die 5-min-Werte sehen).
    stats_use_trim: bool = True
    # v0.9.55 (Marc): Soll die Track-Linie VOR dem linken Trim-Handle im
    # Render sichtbar sein (= „Pre-Trim"-Portion = coords[0..trim_start-1])?
    # True (Default) = zeigen (= bisheriges Verhalten, ganzer Track als
    # Hintergrund-Linie). False = ausblenden, Linie startet am Trim-Start.
    show_pretrim_track: bool = True
    # v0.9.103 — Welt-Verschiebung (Mapbox padding). Verschiebt das
    # gerenderte Map-Objekt visuell im Viewport — bei Globe-Projektion
    # ist `center`-Setzen nur Rotation, padding ist die echte Translation.
    # Range −0.5..+0.5 (entspricht −50 %..+50 % der Viewport-Achse).
    world_shift_x_pct: float = 0.0
    world_shift_y_pct: float = 0.0
    # v0.9.74 — Foto-Pins (Phase 1). Liste von {path, lon, lat, thumb, ...}.
    # `thumb` ist eine base64 data-URL (`data:image/jpeg;base64,...`). Wird
    # vom Renderer in Mapbox als addImage + Symbol-Layer eingehängt.
    # `photos_size_px` ist die Display-Größe auf der Karte. Phase 1: Fotos
    # sind permanent sichtbar ab Frame 0 (keine Zeit-Steuerung).
    photos: list = field(default_factory=list)
    photos_size_px: int = 48
    photos_show: bool = True
    # === Wegpunkt-Schilder (v0.9.171) — Marc-Wunsch ===
    # Text-„Schilder" entlang der Route. Erscheinen sobald der animierte
    # Track-Marker den Punkt erreicht (track_anchor wie bei den Foto-Pins).
    # Als HTML-Marker gerendert (Billboard + skaliert mit Zoom). Jeder Eintrag:
    #   {lat, lon, text, track_anchor}
    signs: list = field(default_factory=list)
    signs_show: bool = True
    signs_size_px: int = 40       # Basis-Schriftgröße; skaliert zusätzlich mit Zoom
    signs_style: str = "callout"  # callout | banner | pin | signpost
    signs_color: str = "#ff6b35"  # Akzentfarbe (Banner/Pin/Wegweiser)
    # v0.9.224 — WYSIWYG-Größenkorrektur für Schilder + Foto-Pins. Wie
    # `line_width` (lineScale) ist die icon-size in CSS-px; der Render-CSS-
    # Viewport (W/dsf, z.B. 1920 bei 4K) ist breiter als die ~800px-Preview →
    # gleiche CSS-Größe wirkt im Render kleiner. Frontend liefert hier
    # renderCssWidth/previewWidth (= lineScale); icon-size wird damit
    # multipliziert, sodass Schild/Pin denselben Frame-Anteil wie in der
    # Preview hat. Default 1.0 = kein Eingriff (Probelauf/alte Aufrufer).
    render_scale: float = 1.0
    # === Multi-Track (v0.9.156) — Marc-Wunsch 2026-06-01 ===
    # Mehrere Touren hintereinander in EINEM Video. Jeder Eintrag:
    #   {"gpx_path": str, "line_color": "#rrggbb", "name": str}
    # Leere Liste ODER genau 1 Eintrag  → klassischer Single-Track-Pfad
    # (verwendet weiter `gpx_path`/`line_color`, Code 100 % unverändert).
    # ≥ 2 Einträge → Multi-Track-Pfad: Touren werden nacheinander animiert,
    # dazwischen ein Kino-Flug (van-Wijk) von Tour-Ende zu Tour-Start.
    # Phase 1 (v0.9.156): KEINE Keyframes im Multi-Modus (kommt Phase 3),
    # Kamera = Per-Tour-Bounds-Fit + Flug dazwischen. Overlays kumulieren
    # über alle Touren (Gesamt-Distanz/-Zeit wachsen durchgehend).
    tracks: list = field(default_factory=list)
    # Dauer des Kino-Flugs zwischen zwei Touren (Sekunden). Während dieser
    # Zeit wächst keine Linie, der Marker ist ausgeblendet, die Kamera fliegt
    # von der einen Tour zur anderen.
    fly_duration_s: float = 3.0


def _format_km(m: float) -> str:
    return f"{m / 1000:.1f} km" if m < 100000 else f"{m / 1000:.0f} km"


def _format_dur(s: float) -> str:
    s = int(s)
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    return f"{h}:{m:02d}:{sec:02d}" if h else f"{m:02d}:{sec:02d}"


# ─────────────────────────────────────────────────────────────────────────────
# Stats-Overlay-Feld-Katalog (v0.9.321) — wählbare + sortierbare Felder.
# Single source of truth fürs Backend; das Frontend (modules/animator/ui/module.js,
# `OVERLAY_FIELD_CATALOG`) spiegelt diese IDs/Labels/Requires — bei Änderung BEIDE
# pflegen. `requires`: "none" | "time" (braucht Zeitstempel) | "ele" (braucht Höhe).
#   LIVE-Feld `js`  = JS-Ausdruck der aus `idx` den Anzeige-String macht (im
#     per-Frame-updateOverlays). Verfügbare Symbole: cumDistM, cumTimeS, elevations,
#     speedKmh, gradePct, TOTAL_DIST_M, TOTAL_TIME_S, fmtKmJS(km), fmtDurJS(sec).
#   TOTAL-Feld `py` = Funktion(total_stats)->Wert-HTML (server-seitig statisch).
OVERLAY_LIVE_FIELDS = [
    {"id": "dist_done",    "requires": "none", "label": "Zur&uuml;ckgelegt", "accent": True,
     "js": "fmtKmJS(cumDistM[idx]/1000)"},
    {"id": "dist_left",    "requires": "none", "label": "Verbleibend",
     "js": "fmtKmJS(Math.max(0,(TOTAL_DIST_M-cumDistM[idx])/1000))"},
    {"id": "speed",        "requires": "time", "label": "Tempo",
     "js": "Math.round(speedKmh[idx])+' km/h'"},
    {"id": "time_elapsed", "requires": "time", "label": "Vergangen",
     "js": "fmtDurJS(cumTimeS[idx])"},
    {"id": "time_left",    "requires": "time", "label": "Restzeit",
     "js": "fmtDurJS(Math.max(0,TOTAL_TIME_S-cumTimeS[idx]))"},
    {"id": "ele_now",      "requires": "ele",  "label": "H&ouml;he",
     "js": "Math.round(elevations[idx])+' m'"},
    {"id": "grade",        "requires": "ele",  "label": "Steigung",
     "js": "(gradePct[idx]>=0?'+':'')+gradePct[idx].toFixed(0)+' %'"},
]
OVERLAY_TOTAL_FIELDS = [
    {"id": "dist_total", "requires": "none", "label": "Strecke",
     "py": lambda ts: _format_km(ts["distance_m"])},
    {"id": "duration",   "requires": "time", "label": "Zeit",
     "py": lambda ts: _format_dur(ts["duration_s"])},
    {"id": "moving_time", "requires": "time", "label": "Fahrzeit",
     "py": lambda ts: _format_dur(ts.get("moving_time_s") or ts.get("duration_s") or 0)},
    {"id": "avg_speed",  "requires": "time", "label": "&Oslash; Tempo",
     # v0.9.323 (Nutzer-Feedback): Ø aus FAHRZEIT (ohne Pausen), nicht aus Gesamtzeit. 1 Nachkomma.
     "py": lambda ts: (f'{ts["distance_m"] / (ts.get("moving_time_s") or ts["duration_s"]) * 3.6:.1f} km/h' if (ts.get("moving_time_s") or ts.get("duration_s")) else "—")},
    {"id": "avg_speed_total", "requires": "time", "label": "&Oslash; Tempo (gesamt)",
     # Ø aus GESAMTZEIT (inkl. Pausen) — wählbar als zweites Feld.
     "py": lambda ts: (f'{ts["distance_m"] / ts["duration_s"] * 3.6:.1f} km/h' if ts.get("duration_s") else "—")},
    {"id": "max_speed",  "requires": "time", "label": "Max. Tempo",
     "py": lambda ts: f'{ts.get("max_speed_kmh", 0):.1f} km/h'},
    {"id": "elev_gain",  "requires": "ele",  "label": "Bergauf",
     "py": lambda ts: f'&uarr; {ts["ascent_m"]:.0f} m'},
    {"id": "elev_loss",  "requires": "ele",  "label": "Bergab",
     "py": lambda ts: f'&darr; {ts["descent_m"]:.0f} m'},
    {"id": "ele_high",   "requires": "ele",  "label": "H&ouml;chster Punkt",
     "py": lambda ts: f'{ts["ele_max"]:.0f} m'},
    {"id": "ele_low",    "requires": "ele",  "label": "Tiefster Punkt",
     "py": lambda ts: f'{ts["ele_min"]:.0f} m'},
]
_OVERLAY_LIVE_BY_ID = {f["id"]: f for f in OVERLAY_LIVE_FIELDS}
_OVERLAY_TOTAL_BY_ID = {f["id"]: f for f in OVERLAY_TOTAL_FIELDS}
DEFAULT_LIVE_FIELDS = ["dist_done", "time_elapsed", "ele_now"]
DEFAULT_TOTAL_FIELDS = ["dist_total", "moving_time", "avg_speed", "max_speed", "elev_gain", "elev_loss"]

# Render-sichere Font-Auswahl. System = body-Default; alle anderen werden per
# Google-Fonts-<link> im Render-Head geladen (Headless-Chromium hat Netz). NIE
# Comic Sans/Chalkboard/Marker Felt (globale Projektregel).
_OVERLAY_FONTS = {
    "system":    (None, "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif"),
    "nunito":    ("Nunito:wght@400;600;700",      "'Nunito', sans-serif"),
    "quicksand": ("Quicksand:wght@400;500;700",   "'Quicksand', sans-serif"),
    "fredoka":   ("Fredoka:wght@400;500;600",     "'Fredoka', sans-serif"),
    "oswald":    ("Oswald:wght@400;500;600",      "'Oswald', sans-serif"),
    "bebas":     ("Bebas+Neue",                   "'Bebas Neue', sans-serif"),
}


def _overlay_field_available(requires: str, has_time: bool, has_ele: bool) -> bool:
    if requires == "time":
        return has_time
    if requires == "ele":
        return has_ele
    return True


def _overlay_totals_rows(field_ids, total_stats, has_time: bool, has_ele: bool) -> str:
    rows = []
    for fid in (field_ids or DEFAULT_TOTAL_FIELDS):
        f = _OVERLAY_TOTAL_BY_ID.get(fid)
        if not f or not _overlay_field_available(f["requires"], has_time, has_ele):
            continue
        try:
            val = f["py"](total_stats)
        except Exception:
            continue
        rows.append(f'<div class="stat-row"><span class="label">{f["label"]}</span><span class="value">{val}</span></div>')
    return "\n".join(rows)


def _sensor_dom_id(key: str) -> str:
    return "live-sensor-" + key


def _overlay_sensor_series_json(ds_points, field_ids) -> str:
    """JSON `{key: [wert_pro_ds_punkt]}` für die im Overlay aktiven Sensor-Felder
    (`sensor:<key>`). Liest direkt aus `TrackPoint.extra` der ds-Punkte."""
    keys = [fid.split(":", 1)[1] for fid in (field_ids or [])
            if isinstance(fid, str) and fid.startswith("sensor:")]
    if not keys:
        return "{}"
    out = {}
    for k in keys:
        out[k] = [(p.extra.get(k) if isinstance(getattr(p, "extra", None), dict) else None)
                  for p in ds_points]
    return json.dumps(out)


def _overlay_live_rows(field_ids, has_time: bool, has_ele: bool, overrides=None) -> str:
    rows = []
    for fid in (field_ids or DEFAULT_LIVE_FIELDS):
        # v0.9.331 — FIT-Sensorfeld (sensor:<key>) → Label aus der Registry.
        # v0.9.334 — projekt-eigene Umbenennung/Einheit (overrides) hat Vorrang.
        if isinstance(fid, str) and fid.startswith("sensor:"):
            key = fid.split(":", 1)[1]
            lbl, _u = _sensors.field_meta_ov(key, overrides)
            rows.append(f'<div class="stat-row"><span class="label">{lbl}</span>'
                        f'<span class="value" id="{_sensor_dom_id(key)}">&mdash;</span></div>')
            continue
        f = _OVERLAY_LIVE_BY_ID.get(fid)
        if not f or not _overlay_field_available(f["requires"], has_time, has_ele):
            continue
        accent = " accent" if f.get("accent") else ""
        rows.append(f'<div class="stat-row"><span class="label">{f["label"]}</span><span class="value{accent}" id="live-{fid}">&mdash;</span></div>')
    return "\n".join(rows)


def _overlay_live_update_js(field_ids, has_time: bool, has_ele: bool, overrides=None) -> str:
    """JS-Zeilen für updateOverlays(idx): pro aktivem Live-Feld ein textContent-Set.
    Wird als literaler Block in den per-Frame-Loop injiziert (kein f-string-Reparse)."""
    lines = []
    for fid in (field_ids or DEFAULT_LIVE_FIELDS):
        # v0.9.331 — Sensor-Live-Wert aus sensorSeries[key][idx] (gerundet + Einheit).
        if isinstance(fid, str) and fid.startswith("sensor:"):
            key = fid.split(":", 1)[1]
            _, unit = _sensors.field_meta_ov(key, overrides)
            unit_js = json.dumps((" " + unit) if unit else "")
            lines.append(
                f"  {{ var _e=document.getElementById('{_sensor_dom_id(key)}');"
                f" if(_e){{ var _v=(sensorSeries[{json.dumps(key)}]||[])[idx];"
                f" _e.textContent=(_v==null?'\\u2013':(Math.round(_v)+{unit_js})); }} }}")
            continue
        f = _OVERLAY_LIVE_BY_ID.get(fid)
        if not f or not _overlay_field_available(f["requires"], has_time, has_ele):
            continue
        lines.append(f"  {{ var _e=document.getElementById('live-{fid}'); if(_e) _e.textContent = {f['js']}; }}")
    return "\n".join(lines)


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Luftlinie zweier Lat/Lon-Punkte in Metern."""
    R = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(min(1.0, math.sqrt(a)))


def _overlay_compute_speed_grade(points, cum_dist, cum_time, eles, has_time: bool, has_ele: bool):
    """Pro-Punkt-Tempo (km/h, geglättet für Live-Anzeige) + Steigung (%) +
    Bewegungszeit (Fahrzeit) + echtes Max-Tempo.
    v0.9.323 — Pausenerkennung über gleitendes Zeitfenster (Nutzer-Feedback): ein
    Segment zählt nur dann zur Fahrzeit, wenn im ±60-s-Fenster NETTO (Luftlinie
    Anfang→Ende) echter Fortschritt gemacht wurde. So zählt langsames Steil-Gehen
    (~1 km/h, aber stetig) als Bewegung, nur echte Standzeiten als Pause."""
    n = len(cum_dist)
    speed = [0.0] * n   # ±2-geglättet → ruhige Live-Anzeige
    grade = [0.0] * n
    moving_time_s = 0.0
    max_speed_kmh = 0.0
    W = 2
    HW = 60.0             # halbes Zeitfenster (±60 s) für die Pausenerkennung
    FLOOR_MS = 0.6 / 3.6  # netto < 0,6 km/h Fortschritt im Fenster = Pause
    SPIKE_CAP_MS = 33.3   # ~120 km/h: darüber GPS-Ausreißer, nicht fürs Max
    if has_time and n > 1:
        for i in range(n):
            a, b = max(0, i - W), min(n - 1, i + W)
            dd = cum_dist[b] - cum_dist[a]
            dt = cum_time[b] - cum_time[a]
            speed[i] = (dd / dt * 3.6) if dt > 0 else 0.0
        # Max-Tempo: ±1-Fenster (~2 s) → einzelne GPS-Spikes raus, echte Peaks bleiben.
        for i in range(n):
            a, b = max(0, i - 1), min(n - 1, i + 1)
            dt = cum_time[b] - cum_time[a]
            if dt <= 0:
                continue
            v = (cum_dist[b] - cum_dist[a]) / dt  # m/s
            if v <= SPIKE_CAP_MS:
                max_speed_kmh = max(max_speed_kmh, v * 3.6)
        # Fahrzeit: Fenster-Methode (Netto-Fortschritt). Fallback auf Roh-Segment-
        # Tempo, falls keine Koordinaten vorliegen oder nicht ausgerichtet.
        use_window = bool(points) and len(points) == n
        for i in range(1, n):
            dt_seg = cum_time[i] - cum_time[i - 1]
            if dt_seg <= 0:
                continue
            if use_window:
                mid = 0.5 * (cum_time[i] + cum_time[i - 1])
                aa = max(0, min(bisect.bisect_left(cum_time, mid - HW), i - 1))
                bb = min(n - 1, max(bisect.bisect_right(cum_time, mid + HW) - 1, i))
                wdt = cum_time[bb] - cum_time[aa]
                if wdt <= 0:
                    continue
                net = _haversine_m(points[aa].lat, points[aa].lon, points[bb].lat, points[bb].lon)
                moving = (net / wdt) >= FLOOR_MS
            else:
                moving = ((cum_dist[i] - cum_dist[i - 1]) / dt_seg) >= FLOOR_MS
            if moving:
                moving_time_s += dt_seg
    if has_ele and n > 1 and eles:
        # v0.9.328 — Steigung glätten (Nutzer: „springt total hin und her").
        # GPS-Höhe rauscht ±5–10 m pro Sample; über nur 2 Nachbarpunkte (bei
        # dichtem Sampling oft nur wenige Meter Basis) explodiert die Steigung.
        # Daher: (1) Höhe leicht glätten, (2) Steigung über eine FESTE horizontale
        # Basis von ±120 m rechnen — unabhängig von der Punktdichte (kurze, dicht
        # gesampelte Tracks waren am schlimmsten), (3) Ergebnis leicht nachglätten.
        EW = 3
        sm = [0.0] * n
        for i in range(n):
            a, b = max(0, i - EW), min(n - 1, i + EW)
            sm[i] = sum(eles[a:b + 1]) / (b - a + 1)
        GRADE_HALF_M = 120.0
        raw_g = [0.0] * n
        for i in range(n):
            a = max(0, min(bisect.bisect_left(cum_dist, cum_dist[i] - GRADE_HALF_M), i))
            b = min(n - 1, max(bisect.bisect_right(cum_dist, cum_dist[i] + GRADE_HALF_M) - 1, i))
            dd = cum_dist[b] - cum_dist[a]
            raw_g[i] = ((sm[b] - sm[a]) / dd * 100.0) if dd > 0 else 0.0
        GW = 2
        for i in range(n):
            a, b = max(0, i - GW), min(n - 1, i + GW)
            grade[i] = sum(raw_g[a:b + 1]) / (b - a + 1)
    return speed, grade, moving_time_s, max_speed_kmh


def _overlay_font_link(cfg: "AnimatorConfig") -> str:
    """<link> zum Google-Font der gewählten Overlay-Schrift (oder "" für System)."""
    key = (getattr(cfg, "overlay_font", "") or "system").lower()
    spec = _OVERLAY_FONTS.get(key) or _OVERLAY_FONTS["system"]
    if not spec[0]:
        return ""
    return f'<link href="https://fonts.googleapis.com/css2?family={spec[0]}&display=swap" rel="stylesheet">'


def _overlay_font_family(cfg: "AnimatorConfig") -> str:
    key = (getattr(cfg, "overlay_font", "") or "system").lower()
    spec = _OVERLAY_FONTS.get(key) or _OVERLAY_FONTS["system"]
    return spec[1]


def _hex_to_rgb(hex_color: str, fallback=(0, 0, 0)) -> tuple[int, int, int]:
    try:
        h = (hex_color or "").lstrip("#")
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))
    except Exception:
        return fallback


def _bounds_zoom(points: list[TrackPoint], w: int, h: int) -> tuple[tuple[float, float, float, float], tuple[float, float], float]:
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
        zoom = max(8.0, min(17.0, zoom - 0.8))
    return (min_lon, min_lat, max_lon, max_lat), center, zoom


_DASH_BASE = {
    # Werte in Mapbox-Linien-Dicken-Einheiten (`line-width` = 1.0).
    # Wir nutzen `line-cap: round` → dadurch wird ein Dash von Länge L
    # visuell zu Länge L+1 (die zwei Halbkreise an den Enden addieren
    # je line-width/2 = 0.5). Genauso wird ein Gap von G zu G-1.
    #
    # Für "dotted" wollen wir KREIS-Punkte, nicht ovale Striche:
    # → dashLength ≈ 0 (nur Round-Cap-Kreis sichtbar, Durchmesser = line-width)
    # → gapLength = 2.0 (effektiv 1.0 line-width Abstand zwischen Kreisen)
    # 0.1 statt 0.0 weil Mapbox keine 0-Längen mag.
    "dashed":  [3, 2],
    "dotted":  [0.1, 2],
    "dashdot": [3, 1.5, 0.1, 1.5],
}


def _dasharray_mapbox(line_style: str, spacing: float = 1.0) -> str:
    """Liefert ein JS-Array-Literal für `line-dasharray` basierend auf dem
    Linien-Stil. Werte sind in Mapbox-Liniendicken-Einheiten — bei
    `line-width=4` ergibt `[3, 2]` z.B. 12px-Striche mit 8px-Lücken.

    `spacing` (Default 1.0) multipliziert alle Werte → größerer Spacing =
    weiteres Pattern, kleinerer = dichter. Wirkt nur bei nicht-solid.

    Rückgabe `""` (leer) bedeutet: keine dasharray-Property setzen
    (solid line). Sonst ein JS-Literal wie `[3,2]` das ins Mapbox-paint
    eingesetzt wird.
    """
    base = _DASH_BASE.get(line_style)
    if not base:
        return ""
    s = max(0.1, float(spacing))
    return "[" + ", ".join(f"{v * s:.2f}" for v in base) + "]"


def _dasharray_svg(line_style: str, line_width: float, spacing: float = 1.0) -> str:
    """Variante für SVG-Polylines im Alpha-Render. SVG-`stroke-dasharray`
    ist in absoluten Pixeln (nicht Liniendicken-Einheiten wie Mapbox),
    daher multiplizieren wir mit `line_width`. `spacing` analog Mapbox."""
    base = _DASH_BASE.get(line_style)
    if not base:
        return ""
    s = max(0.1, float(spacing))
    return ",".join(f"{v * line_width * s:.1f}" for v in base)


def _render_dsf(width: int, height: int) -> float:
    """Device-Scale-Factor für Playwright-Browser-Rendering. WYSIWYG-Fix
    v0.9.20: Mapbox versteht `line-width: 3.5` als 3.5 CSS-Pixel. Im
    Headless-Browser ohne DSF entspricht das 3.5 Device-Pixeln im 4K-Output —
    nach Downscale auf Player-Display sieht der Track dünn aus. Auf
    Retina-Preview hingegen ist DPR=2, dieselbe 3.5-px-Linie wird als 7
    Device-Pixel gemalt → wirkt deutlich dicker.
    Lösung: Playwright mit DSF = max(W,H)/1920 starten. Bei 4K (3840×2160) →
    DSF=2.0, Viewport = 1920×1080 CSS. Mapbox malt 3.5-Pixel-Linie als 7
    Device-Pixel im Output → identische Optik wie Retina-Preview, downscaled
    auf 1080p-Player ergibt wieder 3.5 sichtbare Pixel = Slider-Wert. WYSIWYG."""
    return max(1.0, max(width, height) / 1920.0)


def _render_ss(width: int, height: int) -> float:
    """Supersampling-(SSAA-)Faktor gegen Bewegungs-Aliasing/Flimmern (Marc-Bug
    v0.9.286). Bei 4K zeigt Mapbox feines Satelliten-Detail 1:1 — beim
    Frame-für-Frame-Schwenk „kriecht"/flimmert die scharfe Textur übers
    Pixelraster (klassisches Texture-Shimmer). Lösung: intern SS× größer rendern
    (device_scale_factor wird mit SS multipliziert) und jeden Frame per Lanczos
    auf die Zielauflösung runterskalieren → jeder Ausgabe-Pixel ist das Mittel
    mehrerer Samples → Detail geglättet, Flimmern weg.

    WYSIWYG bleibt exakt: der CSS-Viewport ändert sich NICHT (Linienbreiten
    werden in CSS-Pixeln gemalt), nur die Device-Auflösung steigt; der Downscale
    um 1/SS kompensiert sich mathematisch sauber raus.

    Schwelle: ab 4K (längere Kante ≥ 3840 px). Faktor 1.25 → 1.56× Render-Pixel.
    v0.9.286b: von 1.5 auf 1.25 reduziert, weil zusätzlich ein leichter Tiefpass
    direkt auf den Map-Canvas läuft (siehe `_make_html`, „zu scharf"-Fix) — der
    Blur erledigt jetzt die Haupt-Anti-Flimmer-Arbeit, daher reicht weniger SSAA
    (= schnellerer Render). Trade-off Marc: „zu langsam" + „flimmert, zu scharf"."""
    if max(width, height) >= 3840:
        return 1.25
    return 1.0


def _overlay_scale(render_height: int, dsf: float = 1.0) -> float:
    """Skalierungs-Faktor für die Stats-Boxen relativ zur Render-Höhe.
    Base = 1080 (Full HD, scale 1.0). Bei 4K (2160) ergibt das scale 2.0 →
    Pixel-Werte werden doppelt so groß, damit die Boxen optisch konsistent
    bleiben. Min 0.5 als Untergrenze für sehr kleine Test-Renders (z.B. 360p),
    sonst werden Texte unlesbar.
    Marc-Bug-Report v0.6.3: vorher waren alle CSS-Pixel hartkodiert → Boxen
    wirkten bei 4K winzig, bei Shorts (1080×1920) riesig.
    v0.9.20: Wenn der Render mit DSF>1 läuft (siehe `_render_dsf`), ist die
    effektive CSS-Höhe `render_height / dsf` — Skalierung muss DARAUF basieren,
    sonst werden Overlays bei 4K doppelt gescaled (CSS-Scale × DSF) und
    riesig."""
    css_height = render_height / max(dsf, 1.0)
    return max(0.5, css_height / 1080)


def _overlay_windows(cfg: "AnimatorConfig") -> dict:
    """Zeitfenster (in Video-Sekunden) pro Overlay-Box-ID. to<=0 = bis Ende."""
    return {
        "overlay-totals": [float(getattr(cfg, "overlay_totals_from_s", 0) or 0),
                           float(getattr(cfg, "overlay_totals_to_s", 0) or 0)],
        "overlay-live":   [float(getattr(cfg, "overlay_live_from_s", 0) or 0),
                           float(getattr(cfg, "overlay_live_to_s", 0) or 0)],
        "overlay-bottom": [float(getattr(cfg, "overlay_elevation_from_s", 0) or 0),
                           float(getattr(cfg, "overlay_elevation_to_s", 0) or 0)],
    }


def _overlay_has_timing(cfg: "AnimatorConfig") -> bool:
    """True wenn irgendeine Box ein nicht-triviales Zeitfenster hat (from>0 oder
    to>0). Nur dann ruft der Render-Loop window.__overlayTiming pro Frame."""
    for frm, to in _overlay_windows(cfg).values():
        if frm > 0 or to > 0:
            return True
    return False


def _overlay_timing_js(cfg: "AnimatorConfig") -> str:
    """<script> das die Overlay-Boxen nach Video-Sekunde ein-/ausblendet
    (Nutzer-Wunsch). Render-Loop ruft window.__overlayTiming(tSekunde) pro
    Frame. to<=0 = bis Ende; Default 0/0 = immer sichtbar (kein Eingriff)."""
    wins = _overlay_windows(cfg)
    return (
        "<script>window.__overlayTiming=function(t){var W="
        + json.dumps(wins) +
        ";for(var id in W){var el=document.getElementById(id);if(!el)continue;"
        "var w=W[id];var vis=(t>=w[0])&&(w[1]<=0||t<=w[1]);"
        "el.style.visibility=vis?'':'hidden';}};</script>"
    )


def _overlay_css(cfg: AnimatorConfig, alpha_mode: bool = False) -> str:
    """Liefert das CSS für die Stats-/Höhenprofil-Overlay-Boxen mit
    auflösungs-abhängiger Skalierung. Wird sowohl in `_make_html` als auch
    in `_make_html_alpha` aufgerufen.

    Im Alpha-Modus (kein Karten-Hintergrund) sind die Boxen etwas dunkler
    + Shadow etwas stärker, damit sie auf einem beliebigen NLE-Composit-
    Hintergrund noch lesbar sind.

    v0.9.20: Skalierung respektiert den Browser-DSF. Bei 4K-Render mit
    DSF=2 ist die effektive CSS-Höhe nur 1080, also overlay-scale=1.0 — die
    Boxen bleiben in CSS-Pixeln gleich groß wie bei 1080p, werden aber im
    physischen Output 2× größer (durch DSF). Resultat: gleicher visueller
    Anteil am Frame wie bisher, aber WYSIWYG zur Preview."""
    s = _overlay_scale(cfg.height, _render_dsf(cfg.width, cfg.height))
    def px(n: float) -> str:
        return f"{round(n * s, 1)}px"
    # v0.9.321 — Stats-Editor-Styling: BG-Farbe/Opacity, Textfarbe, Schrift aus cfg.
    _bgr, _bgg, _bgb = _hex_to_rgb(getattr(cfg, "overlay_bg_color", "#000000"), (0, 0, 0))
    _bg_a = max(0.0, min(1.0, float(getattr(cfg, "overlay_bg_opacity", 0.55) or 0.0)))
    if alpha_mode:
        _bg_a = min(1.0, _bg_a + 0.07)   # auf NLE-Composite etwas kräftiger
    bg_css = f"rgba({_bgr},{_bgg},{_bgb},{round(_bg_a, 3)})"
    sh_op = 0.45 if alpha_mode else 0.35
    _txt = getattr(cfg, "overlay_text_color", "#ffffff") or "#ffffff"
    _font = _overlay_font_family(cfg)
    return f"""
  .stats-box {{
    position: absolute; background: {bg_css};
    -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
    border-radius: {px(12)}; padding: {px(18)} {px(22)}; color: {_txt};
    font-family: {_font};
    min-width: {px(260)}; box-shadow: 0 {px(6)} {px(24)} rgba(0,0,0,{sh_op});
  }}
  /* Universal-Position-Slots (auch für #overlay-bottom). Margin in CSS-Pixel
     wird ebenfalls skaliert, damit der Abstand zum Frame-Rand relativ gleich
     bleibt — sonst kleben Boxen bei 4K am Rand. */
  .pos-tl {{ top: {px(40)}; left: {px(40)}; }}
  .pos-tr {{ top: {px(40)}; right: {px(40)}; text-align: right; }}
  .pos-bl {{ bottom: {px(40)}; left: {px(40)}; }}
  .pos-br {{ bottom: {px(40)}; right: {px(40)}; text-align: right; }}
  /* v0.9.283/284 (Nutzer-Wunsch) — mittige Positionen. Kompakte, zentrierte Boxen
     (nicht über volle Breite gestreckt), Inhalt zentriert:
       tc = oben mittig · bc = unten mittig · cc = Bildschirm-Mitte
       ml = links mittig · mr = rechts mittig (vertikal zentriert am Seitenrand)
     Volle Breite NUR fürs Höhenprofil (tcw/bcw = oben/unten breit). */
  .pos-tc {{ top: {px(40)}; left: 50%; transform: translateX(-50%); text-align: center; }}
  .pos-bc {{ bottom: {px(40)}; left: 50%; transform: translateX(-50%); text-align: center; }}
  .pos-cc {{ top: 50%; left: 50%; transform: translate(-50%, -50%); text-align: center; }}
  .pos-ml {{ top: 50%; left: {px(40)}; transform: translateY(-50%); }}
  .pos-mr {{ top: 50%; right: {px(40)}; transform: translateY(-50%); text-align: right; }}
  .pos-tcw {{ top: {px(40)}; left: 10%; right: 10%; }}
  .pos-bcw {{ bottom: {px(40)}; left: 10%; right: 10%; }}
  .stat-row {{ display: flex; justify-content: space-between; align-items: baseline; gap: {px(28)}; padding: {px(4)} 0; }}
  .pos-tr .stat-row, .pos-br .stat-row, .pos-mr .stat-row {{ justify-content: flex-end; gap: {px(18)}; }}
  .pos-tc .stat-row, .pos-cc .stat-row, .pos-bc .stat-row {{ justify-content: center; gap: {px(18)}; }}
  .label {{ font-size: {px(11)}; letter-spacing: 1.6px; text-transform: uppercase; opacity: 0.72; font-weight: 500; }}
  .value {{ font-size: {px(22)}; font-weight: 600; font-variant-numeric: tabular-nums; }}
  .accent {{ font-weight: 800; }}  /* v0.9.327: Akzent erbt die Textfarbe, hebt sich nur über Fettung ab (vorher hart line_color → Textfarbe wirkte nicht) */
  #overlay-bottom {{
    position: absolute;
    height: {px(170)}; background: {bg_css}; font-family: {_font};
    -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
    border-radius: {px(12)}; padding: {px(14)} {px(22)} {px(10)};
    box-shadow: 0 {px(6)} {px(24)} rgba(0,0,0,{sh_op});
    display: flex; flex-direction: column;
  }}
  /* Wenn das Höhenprofil in einer Ecke landet, kompaktere Breite (skaliert). */
  /* v0.9.284 (Nutzer) — Höhenprofil: schmal (feste Breite) bei allen normalen
     Positionen; nur „oben breit"/„unten breit" (tcw/bcw) gehen über volle Breite. */
  #overlay-bottom.pos-tl, #overlay-bottom.pos-tr, #overlay-bottom.pos-bl,
  #overlay-bottom.pos-br, #overlay-bottom.pos-tc, #overlay-bottom.pos-bc,
  #overlay-bottom.pos-cc, #overlay-bottom.pos-ml, #overlay-bottom.pos-mr {{ width: {px(480)}; }}
  .ele-header {{ display: flex; justify-content: space-between; align-items: center; margin-bottom: {px(6)}; color: {_txt}; }}
  .ele-title {{ font-size: {px(11)}; letter-spacing: 1.6px; text-transform: uppercase; opacity: 0.72; font-weight: 500; }}
  .ele-minmax {{ font-size: {px(12)}; opacity: 0.8; font-variant-numeric: tabular-nums; }}
  .ele-minmax .sep {{ margin: 0 {px(10)}; opacity: 0.4; }}
  #elevation-svg {{ flex: 1; width: 100%; display: block; }}
"""


# v0.9.171 — Schild als Canvas-Bild zeichnen, 4 Stile (callout/banner/pin/
# signpost) + Akzentfarbe. MUSS ZEICHEN-IDENTISCH zu _animSignDrawImageData in
# modules/animator/ui/module.js sein (WYSIWYG Preview↔Render) — bei Änderung
# BEIDE pflegen! Symbol-Layer-Bild → driftfrei + GPU + native Zoom-Skalierung.
def _read_sign_draw_js() -> str:
    """Liest die GEMEINSAME Schild-Zeichen-Engine (ui/js/sign_draw.js) — dieselbe
    Datei, die das UI per <script> lädt. So gibt es nur EINE Quelle für die
    Schild-Optik (kein doppelt gepflegter Render-Klon mehr).

    Definiert in der Datei: window.__rzDrawSign / __rzSignFrame / __rzSignMeta.
    """
    base = Path(getattr(sys, "_MEIPASS", None) or Path(__file__).resolve().parent.parent)
    p = base / "ui" / "js" / "sign_draw.js"
    return p.read_text(encoding="utf-8")


_SIGN_DRAW_JS_CACHE: Optional[str] = None


def _sign_draw_js() -> str:
    global _SIGN_DRAW_JS_CACHE
    if _SIGN_DRAW_JS_CACHE is None:
        _SIGN_DRAW_JS_CACHE = _read_sign_draw_js()
    return _SIGN_DRAW_JS_CACHE


def _make_html(cfg: AnimatorConfig, ds_points: list[TrackPoint], cum_dist: list[float],
               cum_time: list[float], total_stats: dict,
               bbox: tuple[float, float, float, float],
               tours: "list | None" = None) -> str:
    # Alpha-Modus: keine Mapbox-Map, nur Track + Punkt + Overlays auf
    # transparentem Hintergrund (für Composit über echtes Video in NLEs).
    if cfg.transparent_background:
        return _make_html_alpha(cfg, ds_points, cum_dist, cum_time, total_stats, bbox)
    style_url = MAP_STYLES.get(cfg.map_style, MAP_STYLES["satellite"])
    # v0.9.391 — OSM-Fallback (Tour-Map ohne Mapbox-Token). mapbox-gl-js rendert
    # ein Style-OBJEKT mit Raster-Source ohne Token (keine mapbox://-Ressourcen).
    # Identische Kachel-Quelle wie die Live-Karte (ui/js/util.js OSM_STYLE), damit
    # Vorschau = Render. Die Source trägt die Attribution → die Default-
    # AttributionControl zeigt automatisch „© OpenStreetMap". `style_expr` wird
    # OHNE Quotes direkt ins Map-Init injiziert.
    _osm = bool(getattr(cfg, "use_osm", False))
    if _osm:
        style_expr = (
            "{version:8,"
            "sources:{osm:{type:'raster',"
            "tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],"
            "tileSize:256,maxzoom:19,"
            "attribution:'\\u00A9 <a href=\\'https://www.openstreetmap.org/copyright\\'>OpenStreetMap</a>'}},"
            "layers:[{id:'osm-tiles',type:'raster',source:'osm',minzoom:0}]}"
        )
    else:
        style_expr = "'" + style_url + "'"
    # v0.9.391 — Karten-Engine wählen. Mapbox GL JS v3 VERLANGT einen gültigen
    # Token (wirft sonst „valid access token required" und die Karte bleibt leer)
    # — auch bei reinen Raster-Styles. Darum im OSM-Fall (kein Token) MapLibre GL
    # JS laden (braucht keinen Token), exakt wie die Live-Karte (ui/index.html).
    # MapLibre ist API-kompatibel für unsere Nutzung; wir aliasen `mapboxgl` darauf,
    # damit die restliche Render-JS unverändert bleibt.
    if _osm:
        gl_head = (
            '<script src="https://unpkg.com/maplibre-gl@5.4.0/dist/maplibre-gl.js"></script>\n'
            '<link href="https://unpkg.com/maplibre-gl@5.4.0/dist/maplibre-gl.css" rel="stylesheet">'
        )
        gl_token_js = "window.mapboxgl = maplibregl;"
    else:
        gl_head = (
            '<script src="https://api.mapbox.com/mapbox-gl-js/v3.12.0/mapbox-gl.js"></script>\n'
            '<link href="https://api.mapbox.com/mapbox-gl-js/v3.12.0/mapbox-gl.css" rel="stylesheet">'
        )
        gl_token_js = f"mapboxgl.accessToken = '{cfg.mapbox_token}';"
    # v0.9.156 — Multi-Track: `tours` = Liste von {"coords":[[lon,lat]..],"color":"#.."}.
    # Wenn ≥2 vorhanden, werden N eigene Track-Sources/Layer (`mtrack{i}`) plus
    # eine `advanceFrameMulti`-Funktion erzeugt; der Single-Track-Code bleibt
    # unverändert (seine `track`-Source bleibt in diesem Modus leer = unsichtbar).
    multi = bool(tours and len(tours) >= 2)
    multi_consts_js = ""
    multi_track_layers = ""
    multi_advance_js = ""
    if multi:
        _tour_coords = [t["coords"] for t in tours]
        _tour_colors = [t.get("color") or cfg.line_color for t in tours]
        _offsets, _acc = [], 0
        for _c in _tour_coords:
            _offsets.append(_acc)
            _acc += len(_c)
        multi_consts_js = (
            "const TOUR_COORDS = " + json.dumps(_tour_coords) + ";\n"
            "const TOUR_COLORS = " + json.dumps(_tour_colors) + ";\n"
            "const TOUR_OFFSETS = " + json.dumps(_offsets) + ";\n"
            "const TOUR_N = TOUR_COORDS.length;\n"
        )
        _dash = _dasharray_mapbox(cfg.line_style, cfg.line_style_spacing)
        _dash_frag = f",'line-dasharray':{_dash}" if _dash else ""
        _zoff_frag = ",'line-z-offset':150" if cfg.enable_terrain else ""
        _layers = ["for (let i=0;i<TOUR_N;i++){", "  const __col = TOUR_COLORS[i];",
                   "  map.addSource('mtrack'+i, {type:'geojson', data:{type:'Feature',geometry:{type:'LineString',coordinates:[]}}});"]
        if cfg.shadow_enabled and cfg.shadow_strength > 0:
            _layers.append(
                "  map.addLayer({id:'mtrack'+i+'-shadow',type:'line',source:'mtrack'+i,"
                "layout:{'line-cap':'round','line-join':'round'},"
                "paint:{'line-color':'rgba(0,0,0,0.7)',"
                f"'line-width':{cfg.line_width * 2.2:.2f},'line-blur':{cfg.shadow_strength:.1f},"
                f"'line-translate':[{cfg.shadow_strength:.1f}, {cfg.shadow_strength:.1f}]{_dash_frag}}}}});")
        if cfg.glow_enabled and cfg.glow_strength > 0:
            _layers.append(
                "  map.addLayer({id:'mtrack'+i+'-glow',type:'line',source:'mtrack'+i,"
                "layout:{'line-cap':'round','line-join':'round'},"
                f"paint:{{'line-color':__col,'line-width':{cfg.line_width * (2.0 + 0.21 * cfg.glow_strength):.2f},"
                f"'line-opacity':0.35,'line-blur':{cfg.glow_strength:.1f}{_dash_frag}{_zoff_frag}}}}});")
        _layers.append(
            "  map.addLayer({id:'mtrack'+i+'-line',type:'line',source:'mtrack'+i,"
            "layout:{'line-cap':'round','line-join':'round'},"
            f"paint:{{'line-color':__col,'line-width':{cfg.line_width:.2f},'line-opacity':0.95{_dash_frag}{_zoff_frag}}}}});")
        if cfg.track_style == "tube":
            _layers.append(
                "  map.addLayer({id:'mtrack'+i+'-highlight',type:'line',source:'mtrack'+i,"
                "layout:{'line-cap':'round','line-join':'round'},"
                f"paint:{{'line-color':'#ffffff','line-width':{cfg.line_width * 0.35:.2f},"
                f"'line-opacity':0.55,'line-blur':0.6{_dash_frag}{_zoff_frag}}}}});")
        _layers.append("}")
        multi_track_layers = "\n  ".join(_layers)
        multi_advance_js = (
            "window.advanceFrameMulti = (tourIdx, localIdx, brg, lon, lat, zm, pt, showDot) => {\n"
            "  for (let i=0;i<TOUR_N;i++){\n"
            "    let c;\n"
            "    if (i < tourIdx) c = TOUR_COORDS[i];\n"
            "    else if (i === tourIdx) c = TOUR_COORDS[i].slice(0, Math.max(0, localIdx)+1);\n"
            "    else c = [];\n"
            "    const src = map.getSource('mtrack'+i);\n"
            "    if (src) src.setData({type:'Feature',geometry:{type:'LineString',coordinates: c.length>=2 ? c : []}});\n"
            "  }\n"
            "  const cur = TOUR_COORDS[tourIdx] || [];\n"
            "  const li = Math.max(0, Math.min(localIdx, cur.length-1));\n"
            "  const head = cur[li] || cur[0] || [lon,lat];\n"
            "  const dsrc = map.getSource('dot'); if (dsrc) dsrc.setData({type:'Feature',geometry:{type:'Point',coordinates:head}});\n"
            "  const dvis = showDot ? 'visible' : 'none';\n"
            "  try { map.setLayoutProperty('dot-core','visibility',dvis); map.setLayoutProperty('dot-glow','visibility',dvis); } catch(_){}\n"
            "  try { map.setPaintProperty('dot-core','circle-stroke-color', TOUR_COLORS[tourIdx]); } catch(_){}\n"
            "  map.setBearing(brg); map.setCenter([lon,lat]);\n"
            "  if (zm !== undefined) map.setZoom(zm);\n"
            "  if (pt !== undefined) map.setPitch(pt);\n"
            "  const g = (TOUR_OFFSETS[tourIdx]||0) + li;\n"
            "  updateOverlays(Math.max(0, Math.min(g, totalPoints-1)));\n"
            "  if (map.triggerRepaint) map.triggerRepaint();\n"  # v0.9.286 — wie advanceFrame: statische Frames neu malen
            "};\n"
            # Per-Tour-Bounds-Fit über Mapbox (matched Single-Track-Genauigkeit).
            "window.fitTourView = (coords) => {\n"
            "  let a=Infinity,b=Infinity,c=-Infinity,d=-Infinity;\n"
            "  for (const p of coords){ if(p[0]<a)a=p[0]; if(p[0]>c)c=p[0]; if(p[1]<b)b=p[1]; if(p[1]>d)d=p[1]; }\n"
            f"  const cam = map.cameraForBounds([[a,b],[c,d]], {{padding: {max(2, int(round(0.08 * min(cfg.width, cfg.height))))}, pitch: {cfg.pitch:.1f}}});\n"
            "  if (!cam) return null;\n"
            "  return { center: [cam.center.lng, cam.center.lat], zoom: cam.zoom };\n"
            "};\n"
        )
    coords_json = json.dumps([[p.lon, p.lat] for p in ds_points])
    eles = [p.ele if p.ele is not None else 0.0 for p in ds_points]
    elevations_json = json.dumps(eles)
    cum_dist_json = json.dumps(cum_dist)
    cum_time_json = json.dumps(cum_time)
    ele_min = min(eles)
    ele_max = max(eles)
    min_lon, min_lat, max_lon, max_lat = bbox
    # Padding-Faktor: gleiche Formel wie Frontend (modules/animator/ui/module.js
    # → fitTrackPreview). 8 % der kürzeren Render-Achse ergibt einen
    # sinnvollen Track-Frame der nicht zu dicht am Rand klebt.
    PAD_FACTOR = 0.08
    px_pad = max(2, int(round(PAD_FACTOR * min(cfg.width, cfg.height))))
    # v0.9.311 — Kamera-Höhe glätten (Follow + Terrain): Per-Frame-Tiefpass-Faktor
    # für die Geländehöhe unter der Kamera-Mitte. Sonst reitet die Kamera 1:1 auf
    # dem Gelände → Hüpfen bei starkem Pitch. 0 = aus. Referenz 30 fps, damit die
    # Glättung in Sekunden konstant ist (Preview rechnet identisch, WYSIWYG).
    # v0.9.311/314 — Kamera-Höhe HALTEN (alle Kamera-Modi). 0 = Kamera reitet aufs
    # Gelände (Mapbox-Default, hüpft), 1 = feste Flughöhe (Gelände-Referenz wird beim
    # ersten Track-Frame eingefroren → Kamera bleibt auf der Höhe, egal was die Berge
    # machen). Werte dazwischen mischen linear. Kein Zeit-/fps-Faktor nötig.
    _cam_stab_amt = max(0.0, min(1.0, float(getattr(cfg, "follow_height_smooth", 0.0) or 0.0)))
    # Pos-Slot-Mapping → CSS-Klasse + Block-Reihenfolge
    # Master `show_overlays` bleibt führend. Einzelne `*_enabled` schalten Boxen aus.
    totals_html = ""
    live_html = ""
    ele_html = ""
    # v0.9.24 — Bei Track ohne Zeit/Höhe entsprechende Stat-Zeilen ausblenden
    # statt „0 m" / „00:00" anzuzeigen. Marc-Selftest 2026-05-24: track_klein.gpx
    # hat keine <ele>/<time>-Tags → Render zeigte trotzdem alle Zeilen mit
    # irreführenden Null-Werten + leeres Höhenprofil-Overlay.
    has_time = bool(total_stats.get('duration_s'))
    has_ele = total_stats.get('ele_max') is not None and total_stats.get('ele_min') is not None
    # v0.9.321/323 — Stats-Editor: Pro-Punkt-Speed/Grade + Fahrzeit + echtes Max-Tempo.
    speed_kmh, grade_pct, _moving_s, _max_kmh = _overlay_compute_speed_grade(ds_points, cum_dist, cum_time, eles, has_time, has_ele)
    speed_json = json.dumps([round(x, 2) for x in speed_kmh])
    grade_json = json.dumps([round(x, 2) for x in grade_pct])
    sensor_series_json = _overlay_sensor_series_json(ds_points, getattr(cfg, "overlay_live_fields", None))
    total_stats = dict(total_stats)
    # v0.9.324 — Max-Tempo + Fahrzeit kommen aus den VOLL aufgelösten Track-Stats
    # (TrackStats.max_speed_kmh/moving_time_s). Die ds_points-Werte sind nur
    # Fallback, falls der Aufrufer sie nicht mitliefert — Downsampling würde
    # den Tempo-Peak sonst wegglätten (Nutzer-Feedback: 43 km/h zu niedrig).
    if has_time:
        if not total_stats.get("max_speed_kmh"):
            total_stats["max_speed_kmh"] = _max_kmh
        if not total_stats.get("moving_time_s"):
            total_stats["moving_time_s"] = _moving_s
    else:
        total_stats["max_speed_kmh"] = 0.0
        total_stats["moving_time_s"] = 0.0
    live_update_js = _overlay_live_update_js(getattr(cfg, "overlay_live_fields", None), has_time, has_ele, getattr(cfg, "overlay_field_overrides", None))
    if cfg.show_overlays:
        if cfg.overlay_totals_enabled:
            _trows = _overlay_totals_rows(getattr(cfg, "overlay_totals_fields", None), total_stats, has_time, has_ele)
            if _trows:
                totals_html = f"""
<div id="overlay-totals" class="stats-box pos-{cfg.overlay_totals_position}">
  {_trows}
</div>"""
        if cfg.overlay_live_enabled:
            _lrows = _overlay_live_rows(getattr(cfg, "overlay_live_fields", None), has_time, has_ele, getattr(cfg, "overlay_field_overrides", None))
            if _lrows:
                live_html = f"""
<div id="overlay-live" class="stats-box pos-{cfg.overlay_live_position}">
  {_lrows}
</div>"""
        # Höhenprofil nur wenn echte Höhendaten vorhanden — sonst leerer Strich.
        if cfg.overlay_elevation_enabled and has_ele:
            ele_html = f"""
<div id="overlay-bottom" class="pos-{cfg.overlay_elevation_position}">
  <div class="ele-header">
    <span class="ele-title">H&ouml;henprofil</span>
    <span class="ele-minmax">Min {ele_min:.0f} m<span class="sep">&bull;</span>Max {ele_max:.0f} m</span>
  </div>
  <svg id="elevation-svg" viewBox="0 0 1000 120" preserveAspectRatio="none">
    <defs>
      <linearGradient id="ele-grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="{cfg.line_color}" stop-opacity="0.55"/>
        <stop offset="100%" stop-color="{cfg.line_color}" stop-opacity="0.02"/>
      </linearGradient>
    </defs>
    <polyline id="ele-bg-line" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
    <polygon id="ele-active-fill" fill="url(#ele-grad)"/>
    <polyline id="ele-active-line" fill="none" stroke="{cfg.line_color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle id="ele-dot" r="4.5" fill="#ffffff" stroke="{cfg.line_color}" stroke-width="2"/>
  </svg>
</div>"""
    overlays_block = totals_html + live_html + ele_html + _overlay_timing_js(cfg)
    # JS-Block für Karten-Feinabstimmung. Wird im `style.load`-Callback
    # ausgespielt. Zwei Mechanismen parallel:
    #
    # 1) Mapbox-Standard-Styles (standard, standard-satellite) → `setConfig
    #    Property('basemap', '…', …)` auf das `basemap`-Fragment. Die echten
    #    Symbol-Layer sind hier importiert und nicht direkt addressierbar.
    #
    # 2) Klassische Styles (streets-v12, outdoors-v12, …) → Layer-ID-Heuristik
    #    auf die Symbol-Layer. Wir matchen Layer-Namen wie `place-*`, `road-
    #    label-*`, `poi-*`, `transit-*`, `admin-*` und togglen die Visibility.
    #
    # Beide ausführen ist auf dem jeweils anderen Style-Typ No-Op (try/catch).
    # `hide_labels=True` wird wie alle-4-show_*_labels=False behandelt.
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
        # Standard-Style Config-Properties
        "  try { map.setConfigProperty('basemap', 'lightPreset', lightPreset); } catch(_){}"
        "  try { map.setConfigProperty('basemap', 'showPlaceLabels', showPlace); } catch(_){}"
        "  try { map.setConfigProperty('basemap', 'showRoadLabels', showRoad); } catch(_){}"
        "  try { map.setConfigProperty('basemap', 'showPointOfInterestLabels', showPoi); } catch(_){}"
        "  try { map.setConfigProperty('basemap', 'showTransitLabels', showTransit); } catch(_){}"
        "  try { map.setConfigProperty('basemap', 'showAdminBoundaries', showAdmin); } catch(_){}"
        # Classic-Style Layer-ID-Heuristik
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
    if cfg.enable_terrain and not _osm:
        terrain_block = f"""
    map.addSource('mapbox-dem', {{
        type: 'raster-dem',
        url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
        tileSize: 512,
        maxzoom: 14
    }});
    map.setTerrain({{ source: 'mapbox-dem', exaggeration: {cfg.exaggeration} }});
"""

    # Map-Init: User-Viewport-Override (Pan/Zoom in der Preview) hat Vorrang,
    # sonst bounds-fit. Bearing kommt vom UI-Slider als END-Bearing — der
    # Animator sweept von (end - rotation) bis end. So sieht die Preview
    # das selbe wie das letzte Render-Frame.
    # v0.9.19 — `prefetchZoomDelta: 6` (default 4): Mapbox lädt Tiles bis zu
    # 6 Zoomstufen unter dem aktuellen Zoom-Level vorab. Bei Kamera-Schwenks
    # über große Strecken sind die Tiles dann schon im Browser-Cache → der
    # per-Frame `idle`-Wait fällt drastisch. Keine Quality-Auswirkung, nur
    # initial etwas mehr Tile-Download.
    common_opts = (
        "  preserveDrawingBuffer:true, antialias:true, fadeDuration:0,\n"
        "  prefetchZoomDelta:6\n"
    )
    # v0.9.307 — Standbild-Modus: Bounds-Fit nutzt cfg.padding_pct + cfg.bearing
    # (Tour-Map-Parität). Im Video-Modus bleibt's bei 8 % / bearing -10.
    if cfg.still_frame:
        # v0.9.390 — WYSIWYG-Zoom-Fix: die Render-Map läuft im CSS-Viewport
        # cfg.width/dsf × cfg.height/dsf (bei 4K ist dsf=2 → 1920×1080). Das
        # Bounds-Fit-Padding muss sich auf DIESEN Viewport beziehen, nicht auf
        # die volle Pixel-Auflösung — sonst ist der Rand bei 4K doppelt so groß
        # wie in der 8%-Live-Vorschau (die im Letterbox-Viewport fittet) und der
        # Track wird zu klein gerahmt → „Zoom falsch". Padding durch dsf teilen.
        _fit_dsf = _render_dsf(cfg.width, cfg.height)
        _fit_pad = max(2, int(round((float(cfg.padding_pct) / 100.0) * (min(cfg.width, cfg.height) / _fit_dsf))))
        _fit_bearing = float(cfg.bearing)
    else:
        _fit_pad = px_pad
        _fit_bearing = -10
    if cfg.override_center is not None and cfg.override_zoom is not None:
        ovc = cfg.override_center
        # v0.9.131 — 4K-WYSIWYG-Fix (synchron zu tourmap.py). Das Frontend
        # rechnet override_zoom via correctedZoom() auf die VOLLE Render-Breite
        # (cfg.width) hoch, der Render läuft aber mit CSS-Viewport cfg.width/dsf.
        # Mapbox-Zoom ist relativ zu CSS-Pixeln → bei dsf>1 (4K=2) wäre der Zoom
        # um log2(dsf) zu hoch. Korrektur: override_zoom - log2(dsf).
        _ov_dsf = _render_dsf(cfg.width, cfg.height)
        _ov_zoom = cfg.override_zoom - (math.log2(_ov_dsf) if _ov_dsf > 0 else 0.0)
        map_init = (
            f"const map = new mapboxgl.Map({{\n"
            f"  container:'map', style:{style_expr},\n"
            f"  center: [{ovc[0]}, {ovc[1]}],\n"
            f"  zoom: {_ov_zoom},\n"
            f"  pitch:{cfg.pitch}, bearing:-10,\n"
            f"{common_opts}"
            f"}});"
        )
    else:
        map_init = (
            f"const map = new mapboxgl.Map({{\n"
            f"  container:'map', style:{style_expr},\n"
            f"  bounds: [[{min_lon}, {min_lat}], [{max_lon}, {max_lat}]],\n"
            f"  fitBoundsOptions: {{ padding: {_fit_pad}, pitch: {cfg.pitch}, bearing: {_fit_bearing} }},\n"
            f"{common_opts}"
            f"}});"
        )

    # v0.9.107 — Welt-Verschiebung läuft jetzt pro Frame über die
    # position-KF-Lane (siehe Render-Loop unten). Globales padding bei
    # Map-Load ist raus, weil interpoliertes Padding sich frame-by-frame
    # ändern können muss.

    # v0.9.74 — Foto-Pins-Snippet: JS-Code, der pro Foto ein Image lädt und
    # addImage + Symbol-Layer einhängt. Genau die gleiche Logik wie im
    # Preview-UI (`ui/js/photos.js`) damit der Render WYSIWYG mit dem
    # Preview übereinstimmt.
    if cfg.photos_show and cfg.photos:
        # v0.9.77 — per-Foto visible-Flag respektieren. Default true für
        # Backward-Compat (alte Projekte ohne das Feld).
        # v0.9.79 (Phase 2) — track_anchor für Pop-In im Animator-Render
        # berechnen, falls nicht schon vom UI mitgeliefert.
        from . import photos as _cphotos
        # v0.9.305 — visible + valide Koordinaten (Badge braucht keinen thumb mehr,
        # Spiegelung zu ui/js/photos.js das jetzt ALLE sichtbaren Fotos zeigt).
        _photos_input = [p for p in cfg.photos
                         if p.get("visible", True) is not False
                         and p.get("lon") is not None and p.get("lat") is not None]
        # In-place track_anchor setzen wenn coords + photos da sind. Mutiert
        # die Refs in cfg.photos — das ist für die Render-Dauer ok.
        try:
            # v0.9.187 — BUG-FIX: hier wurde `coords` benutzt, das in _make_html GAR
            # NICHT existiert (Parameter heißt `ds_points`) → NameError wurde vom
            # except still verschluckt → track_anchor blieb 0 → Foto-Pins erschienen
            # ab Frame 0. ds_points = exakt die Marker-Punkte (allCoords) → korrekt.
            track_coords = [[float(p.lon), float(p.lat)] for p in ds_points] if ds_points else []
            _cphotos.compute_track_anchors(_photos_input, track_coords)
        except Exception:
            pass
        # v0.9.305 — Nummerierung 1..N in Track-Reihenfolge (track_anchor),
        # exakt wie ui/js/photos.js._toGeoJson.
        _order = sorted(range(len(_photos_input)),
                        key=lambda k: float(_photos_input[k].get("track_anchor", 0) or 0))
        _num_by_idx = {k: rank + 1 for rank, k in enumerate(_order)}
        photos_for_render = [{
            "lon": float(p.get("lon", 0)),
            "lat": float(p.get("lat", 0)),
            "num": _num_by_idx[k],
            # Float-Cast für JS-Serialization-Safety
            "track_anchor": float(p.get("track_anchor", 0) or 0),
        } for k, p in enumerate(_photos_input)]
        photos_json_str = json.dumps(photos_for_render)
        # v0.9.224 — × render_scale (WYSIWYG: Foto-Pin gleich groß wie in Preview).
        # v0.9.305 — Basis /48 (Badge ist 24 CSS-px @ icon-size 1).
        photos_size_factor = (max(12, min(200, int(cfg.photos_size_px))) / 48.0) \
            * float(getattr(cfg, "render_scale", 1.0) or 1.0)
        photo_pins_block = (
            "function __mkBadge(num){\n"
            "  var S=48; var c=document.createElement('canvas'); c.width=S; c.height=S;\n"
            "  var ctx=c.getContext('2d'); var cx=S/2, cy=S/2, r=S/2-4;\n"
            "  ctx.save(); ctx.shadowColor='rgba(0,0,0,0.35)'; ctx.shadowBlur=4; ctx.shadowOffsetY=1;\n"
            "  ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fillStyle='#ff385c'; ctx.fill(); ctx.restore();\n"
            "  ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.lineWidth=3; ctx.strokeStyle='#ffffff'; ctx.stroke();\n"
            "  var label=String(num); var fs=label.length>=3?18:(label.length===2?22:26);\n"
            "  ctx.fillStyle='#ffffff'; ctx.textAlign='center'; ctx.textBaseline='middle';\n"
            "  ctx.font='bold '+fs+'px -apple-system, system-ui, Arial, sans-serif';\n"
            "  ctx.fillText(label,cx,cy+1); return ctx.getImageData(0,0,S,S);\n"
            "}\n"
            "const __photoPins = " + photos_json_str + ";\n"
            "window.__photoPinsAnchorFilter = (markerAnchor) => {\n"
            "  if (!map.getLayer('photo-pins-lyr')) return;\n"
            "  try { map.setFilter('photo-pins-lyr', ['<=', ['get', 'track_anchor'], Number(markerAnchor)]); }\n"
            "  catch(_) {}\n"
            "};\n"
            "if (__photoPins.length) {\n"
            "  __photoPins.forEach(p => { const id='photo-num-'+p.num; if(!map.hasImage(id)) map.addImage(id, __mkBadge(p.num), {pixelRatio:2}); });\n"
            "  map.addSource('photo-pins-src', {type:'geojson', data:{\n"
            "    type:'FeatureCollection',\n"
            "    features: __photoPins.map((p, i) => ({\n"
            "      type:'Feature', id:i,\n"
            "      properties:{ badgeId: 'photo-num-'+p.num, track_anchor: (typeof p.track_anchor === 'number' ? p.track_anchor : 0) },\n"
            "      geometry:{ type:'Point', coordinates:[p.lon, p.lat] }\n"
            "    }))\n"
            "  }});\n"
            "  map.addLayer({\n"
            "    id:'photo-pins-lyr', type:'symbol', source:'photo-pins-src',\n"
            "    // v0.9.79 (Phase 2) — Foto erscheint erst wenn Track-Marker dort vorbei.\n"
            "    // Default-Filter '<= -1' = nichts sichtbar; advanceFrame setzt den Filter pro Frame.\n"
            "    filter: ['<=', ['get', 'track_anchor'], -1],\n"
            "    layout:{\n"
            "      'icon-image': ['get', 'badgeId'],\n"
            f"      'icon-size': {photos_size_factor:.4f},\n"
            "      'icon-allow-overlap': true,\n"
            "      'icon-ignore-placement': true,\n"
            "      'icon-anchor': 'center'\n"
            "    }\n"
            "  });\n"
            "}\n"
        )
    else:
        photo_pins_block = "// no photo pins\n"

    # v0.9.171 — Wegpunkt-Schilder. Erscheinen sobald der Track-Marker den Punkt
    # erreicht (track_anchor). Als GPU-Symbol-Layer mit Canvas-Bild (driftfrei,
    # Billboard, skaliert nativ via icon-size) — exakt wie die Foto-Pins.
    if cfg.signs_show and cfg.signs:
        from . import photos as _cphotos2
        # v0.9.189 — Schild zählt wenn es Text ODER ein Bild hat.
        # v0.9.198 — ausgeblendete (visible:false) NICHT rendern.
        _signs_input = [s for s in cfg.signs
                        if ((s.get("text") or "").strip() or (s.get("imageSrc") or "").strip())
                        and s.get("visible") is not False]
        def _sign_thumb(s):
            src = (s.get("imageSrc") or "").strip()
            if not src:
                return None
            try:
                if not os.path.exists(src):
                    return None
                return _cphotos2.thumbnail_data_url(src, 600)
            except Exception:
                return None
        try:
            # v0.9.187 — BUG-FIX: `coords` existierte hier nicht (Parameter = `ds_points`)
            # → NameError still verschluckt → track_anchor blieb 0 → Schild ab Frame 0
            # sichtbar (Marc: „erscheint zu früh, bleibt zu kurz"). ds_points = Marker-Punkte.
            track_coords2 = [[float(p.lon), float(p.lat)] for p in ds_points] if ds_points else []
            _cphotos2.compute_track_anchors(_signs_input, track_coords2)
        except Exception:
            pass
        # v0.9.203 — gespeicherter Zeit-Anker (Foto-Import) hat Vorrang vor dem
        # Positions-Anker → löst Loop-Mehrdeutigkeit (gleicher Ort mehrfach am Track).
        for _s in _signs_input:
            _ta = _s.get("timeAnchor")
            if isinstance(_ta, (int, float)):
                _s["track_anchor"] = float(_ta)
        def _sg(s, key, default):
            v = s.get(key)
            return v if v is not None else default
        signs_for_render = [{
            "lon": float(s.get("lon", 0)),
            "lat": float(s.get("lat", 0)),
            "text": str(s.get("text", "")),
            "track_anchor": float(s.get("track_anchor", 0) or 0),
            # Form + Akzent (Fallback auf globale Defaults)
            "style": str(s.get("style") or cfg.signs_style or "callout"),
            "color": str(s.get("color") or cfg.signs_color or "#ff6b35"),
            "size": int(s.get("size") or cfg.signs_size_px or 40),
            # v0.9.179 — volle Customization
            "bg": _sg(s, "bg", "auto"),
            "textColor": _sg(s, "textColor", "auto"),
            "font": _sg(s, "font", "system"),
            "weight": int(_sg(s, "weight", 700)),
            "italic": bool(_sg(s, "italic", False)),
            "align": _sg(s, "align", "center"),
            "radius": float(_sg(s, "radius", 9)),
            "padding": float(_sg(s, "padding", 7)),
            "opacity": float(_sg(s, "opacity", 1)),
            "borderColor": _sg(s, "borderColor", "none"),
            "borderWidth": float(_sg(s, "borderWidth", 0)),
            "shadow": bool(_sg(s, "shadow", False)),
            "shadowColor": _sg(s, "shadowColor", "#000000"),
            "shadowBlur": float(_sg(s, "shadowBlur", 8)),
            "shadowStrength": float(_sg(s, "shadowStrength", 0.55)),
            # Verhalten
            "zoomScale": bool(_sg(s, "zoomScale", True)),
            "alwaysVisible": bool(_sg(s, "alwaysVisible", False)),
            "before": float(_sg(s, "before", 0)),
            "after": float(_sg(s, "after", 0)),
            "entry": _sg(s, "entry", "none"),
            # v0.9.189 — Schild MIT Bild (= Foto-Karte). Thumb serverseitig erzeugen.
            "imageSrc": str(_sg(s, "imageSrc", "") or ""),
            "thumb": _sign_thumb(s),
            "imageSize": float(_sg(s, "imageSize", 60)),  # v0.9.190 — Bildbreite separat
            "decoScale": float(_sg(s, "decoScale", 0.5)),  # v0.9.262 — Stangen-Länge (Banner/Wegweiser); fehlte → Render nahm immer 0.5
            "direction": ("left" if _sg(s, "direction", "right") == "left" else "right"),  # v0.9.387 — Wegweiser-Pfeilrichtung
        } for s in _signs_input]
        # v0.9.224/225 — render_scale in die icon-size-Stützwerte gerechnet (s.u.).
        _ss = float(getattr(cfg, "render_scale", 1.0) or 1.0)
        _sign_icon_size = (
            "['interpolate',['linear'],['zoom'], "
            f"8,['case',['==',['get','zoomScale'],true],{0.5*_ss:.4f},{1.0*_ss:.4f}], "
            f"12,['case',['==',['get','zoomScale'],true],{0.8*_ss:.4f},{1.0*_ss:.4f}], "
            f"16,['case',['==',['get','zoomScale'],true],{1.5*_ss:.4f},{1.0*_ss:.4f}], "
            f"20,['case',['==',['get','zoomScale'],true],{2.4*_ss:.4f},{1.0*_ss:.4f}]]"
        )
        signs_block = (
            "const __signs = " + json.dumps(signs_for_render) + ";\n"
            f"const __signDur = {max(1, int(cfg.duration_s))};\n"
            + _sign_draw_js() +
            "let __signMetas = [];\n"
            "window.__signsReady = false;\n"
            "window.__signsAnchorFilter = (markerAnchor) => {\n"
            "  if (window.__rzSignFrame) window.__rzSignFrame(map, 'anim-signs-lyr', 'anim-signs-src', __signMetas, Number(markerAnchor));\n"
            "};\n"
            "(async () => {\n"
            "  if (!__signs.length) { window.__signsReady = true; return; }\n"
            "  __signMetas = __signs.map(s => window.__rzSignMeta(s, __signDur));\n"
            "  const __loadImg = (src) => new Promise(res => { const im = new Image(); im.onload=()=>res(im); im.onerror=()=>res(null); im.src=src; });\n"
            "  const __imgs = await Promise.all(__signs.map(s => s.thumb ? __loadImg(s.thumb) : Promise.resolve(null)));\n"
            "  const __feats = __signs.map((s,i) => {\n"
            "    const id = 'sign-img-'+i;\n"
            "    try { const o = Object.assign({}, s); if (__imgs[i]) o.image = __imgs[i]; const im = window.__rzDrawSign(o); if (!map.hasImage(id)) map.addImage(id, im.data, {pixelRatio: im.dpr}); } catch(_){}\n"
            "    const meta = __signMetas[i];\n"
            "    return { type:'Feature', id:i, properties:{ imgId:id, zoomScale: !!s.zoomScale, a_show: meta.a_show, a_hide: meta.a_hide },\n"
            "             geometry:{ type:'Point', coordinates:[s.lon, s.lat] } };\n"
            "  });\n"
            "  if (!map.getSource('anim-signs-src')) map.addSource('anim-signs-src', {type:'geojson', data:{type:'FeatureCollection', features:__feats}});\n"
            "  if (!map.getLayer('anim-signs-lyr')) map.addLayer({ id:'anim-signs-lyr', type:'symbol', source:'anim-signs-src',\n"
            "    filter: ['all', ['<=',['get','a_show'], -1], ['>=',['get','a_hide'], -1]],\n"
            "    layout:{ 'icon-image':['get','imgId'],\n"
            # v0.9.224/225 — render_scale in die icon-size-Stützwerte gerechnet
            # (_sign_icon_size, oben). NICHT außen ['*', s, interpolate] — Mapbox
            # verlangt ['zoom'] top-level im interpolate, sonst wird der Layer
            # verworfen → gar kein Schild. WYSIWYG: Schild gleich groß wie Preview.
            f"      'icon-size':{_sign_icon_size},\n"
            "      'icon-anchor':'bottom', 'icon-allow-overlap':true, 'icon-ignore-placement':true,\n"
            "      'icon-pitch-alignment':'viewport', 'icon-rotation-alignment':'viewport' },\n"
            "    paint:{ 'icon-opacity':['coalesce', ['feature-state','op'], 1] }\n"
            "  });\n"
            "  window.__signsReady = true;\n"
            "})();\n"
        )
    else:
        signs_block = "// no signs\n"

    # v0.9.210 (Reiseroute) — zusätzlicher Ghost = geladenes Wander-GPX (andere
    # Linie als die animierte Route). Faint + gestrichelt, als eigener Layer.
    _gpx_ghost_js = "// gpx-ghost off"
    _gg_coords = getattr(cfg, "ghost_gpx_coords", None) or []
    if len(_gg_coords) > 1:
        _gg = json.dumps([[float(c[0]), float(c[1])] for c in _gg_coords])
        _gg_zoff = ",'line-z-offset':150" if cfg.enable_terrain else ""
        _gg_dash = ",'line-dasharray':[2,2]" if getattr(cfg, "ghost_gpx_dashed", True) else ""
        _gg_col = str(getattr(cfg, "ghost_gpx_color", "#7fa8ff"))
        _gg_op = max(0.0, min(1.0, float(getattr(cfg, "ghost_gpx_opacity", 0.60))))
        _gg_w = float(getattr(cfg, "ghost_gpx_width", 2.5))
        _gpx_ghost_js = (
            "map.addSource('gpx-ghost',{type:'geojson',data:{type:'Feature',geometry:{type:'LineString',coordinates:"
            + _gg + "}}});"
            "map.addLayer({id:'gpx-ghost',type:'line',source:'gpx-ghost',"
            "layout:{'line-cap':'round','line-join':'round'},"
            f"paint:{{'line-color':'{_gg_col}','line-width':{_gg_w:.2f},'line-opacity':{_gg_op:.2f}"
            + _gg_dash + _gg_zoff + "}});"
        )

    # v0.9.286b (Marc-Bug: 4K flimmert „zu scharf") — leichter Tiefpass NUR auf
    # die WebGL-Karte (#map canvas = Satellit + Track-Linie), NICHT auf Overlays/
    # Stats/Foto-Marker (eigene DOM-Geschwister bzw. .mapboxgl-marker außerhalb
    # der canvas) → wie der optische Anti-Moiré-Filter einer Kamera. Tötet das
    # hochfrequente Textur-Shimmer, das SSAA allein nicht wegbekam.
    # Wert in CSS-px; im Capture wird daraus css×dsf×ss px, nach /ss-Downscale
    # css×dsf Output-px. Ziel ~1.3 Output-px → css = 1.3/dsf. Nur bei 4K.
    _blur_dsf = _render_dsf(cfg.width, cfg.height)
    _blur_out_px = max(0.0, cfg.map_smoothing) if _render_ss(cfg.width, cfg.height) > 1.0 else 0.0
    _map_blur_css = (f"  #map canvas {{ filter: blur({_blur_out_px / _blur_dsf:.3f}px); }}\n"
                     if _blur_out_px > 0 else "")

    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8">
{gl_head}
{_overlay_font_link(cfg)}
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body, html {{ width: 100%; height: 100%; overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }}
  #map {{ width: 100%; height: 100%; }}
{_map_blur_css}{_overlay_css(cfg)}
</style></head>
<body>
<div id="map"></div>
{overlays_block}
<script>
{gl_token_js}
const allCoords = {coords_json};
const elevations = {elevations_json};
const cumDistM = {cum_dist_json};
const cumTimeS = {cum_time_json};
const speedKmh = {speed_json};   // v0.9.321 — Stats-Editor: Pro-Punkt-Tempo
const gradePct = {grade_json};   // v0.9.321 — Pro-Punkt-Steigung %
const sensorSeries = {sensor_series_json};   // v0.9.330 — FIT-Sensorwerte pro Punkt (key → [werte])
const TOTAL_DIST_M = cumDistM.length ? cumDistM[cumDistM.length - 1] : 0;
const TOTAL_TIME_S = cumTimeS.length ? cumTimeS[cumTimeS.length - 1] : 0;
function fmtKmJS(km){{ return km < 100 ? km.toFixed(1)+' km' : km.toFixed(0)+' km'; }}
function fmtDurJS(sec){{ sec=Math.max(0,Math.floor(sec)); var h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60,p=function(n){{return n<10?'0'+n:''+n;}}; return h>0?h+':'+p(m)+':'+p(s):p(m)+':'+p(s); }}
const totalPoints = allCoords.length;
const SHOW_OVERLAYS = {str(cfg.show_overlays).lower()};
// v0.9.55 (Marc): Pre-Trim-Sichtbarkeit. Wenn False, startet die gezeichnete
// Linie am Trim-Start statt am Track-Anfang (= „Pre-Trim"-Portion ausgeblendet).
const SHOW_PRETRIM_TRACK = {str(cfg.show_pretrim_track).lower()};
const TRIM_START_IDX = Math.max(0, Math.min(totalPoints - 1, Math.floor({float(cfg.render_start_anchor)} * (totalPoints - 1))));
const SHOW_PINS = {str(bool(cfg.show_pins)).lower()};  // v0.9.307 — Start/End-Pins (Standbild/Tour-Map-Erbe)
window.__camStabAmt = {_cam_stab_amt};  // v0.9.314 — Kamera-Höhe halten (0=aus, 1=fest)
// v0.9.24 — Flags: bei Track ohne Höhe/Zeit fehlen die zugehörigen DOM-Nodes
// (Höhenprofil-SVG + live-Stats-Zeilen werden conditional erzeugt). Das JS
// muss das wissen, sonst crasht `getElementById(...).setAttribute(...)` mit
// null und der ganze Render bleibt hängen (window.isReady wird nie gesetzt).
const HAS_ELE = {str(has_ele).lower()};
const HAS_TIME = {str(has_time).lower()};
const SVG_W = 1000, SVG_H = 120, PAD_Y = 10;
const eleMin = HAS_ELE ? Math.min.apply(null, elevations) : 0;
const eleMax = HAS_ELE ? Math.max.apply(null, elevations) : 1;
const eleRange = (eleMax - eleMin) || 1;
function eleToY(e){{return SVG_H - PAD_Y - ((e - eleMin)/eleRange)*(SVG_H - PAD_Y*2);}}
function idxToX(i){{return (i / Math.max(1, totalPoints - 1)) * SVG_W;}}
if (SHOW_OVERLAYS && HAS_ELE) {{
  const bgPts = elevations.map((e,i)=>`${{idxToX(i).toFixed(2)}},${{eleToY(e).toFixed(2)}}`).join(' ');
  const bgLine = document.getElementById('ele-bg-line');
  if (bgLine) bgLine.setAttribute('points', bgPts);
}}
function updateOverlays(idx) {{
  if (!SHOW_OVERLAYS) return;
{live_update_js}
  if (HAS_ELE) {{
    const pts = [], pairs = [];
    for (let i=0; i<=idx; i++) {{
      const x=idxToX(i).toFixed(2), y=eleToY(elevations[i]).toFixed(2);
      pts.push(`${{x}},${{y}}`); pairs.push([x,y]);
    }}
    const ps = pts.join(' ');
    const eleActiveLine = document.getElementById('ele-active-line');
    if (eleActiveLine) eleActiveLine.setAttribute('points', ps);
    if (pairs.length >= 2) {{
      const eleActiveFill = document.getElementById('ele-active-fill');
      if (eleActiveFill) eleActiveFill.setAttribute('points',
        `${{pairs[0][0]}},${{SVG_H}} ${{ps}} ${{pairs[pairs.length-1][0]}},${{SVG_H}}`);
    }}
    const dot = document.getElementById('ele-dot');
    if (dot) {{
      dot.setAttribute('cx', idxToX(idx).toFixed(2));
      dot.setAttribute('cy', eleToY(elevations[idx]).toFixed(2));
    }}
  }}
}}
updateOverlays(0);

{map_init}
{multi_consts_js}
let mapReady=false;
map.on('style.load', () => {{
  // v0.9.286 (Marc-Bug: Flimmern) — Raster-Kachel-Cross-Fade abschalten. Beim
  // Frame-für-Frame-Rendern blendet jede neu geladene Satelliten-Kachel ~300 ms mit
  // ihrer Eltern-Kachel über; jeder Frame trifft die Fade in anderem Mischzustand →
  // hochfrequentes Flimmern (besonders in 4K). raster-fade-duration=0 → Kacheln
  // erscheinen sofort ohne Überblenden → deterministische, flimmerfreie Frames.
  try {{
    (map.getStyle().layers || []).forEach(l => {{
      if (l.type === 'raster') {{
        try {{ map.setPaintProperty(l.id, 'raster-fade-duration', 0); }} catch (_) {{}}
      }}
    }});
  }} catch (_) {{}}
  {hide_labels_block}
  {terrain_block}
  map.addSource('track', {{type:'geojson', data:{{type:'Feature',geometry:{{type:'LineString',coordinates:[]}}}}}});
  // v0.9.169 — Ghost-Track: die GANZE Route schwach/transparent als unterste
  // Track-Linie (eigene Source mit ALLEN Punkten, wird NIE animiert). Der
  // animierte Track (Source 'track') zeichnet voll deckend darüber. Zuerst
  // added = ganz unten im Layer-Stack.
  {("map.addSource('track-ghost', {type:'geojson', data:{type:'Feature',geometry:{type:'LineString',coordinates:allCoords}}});"
    "map.addLayer({id:'track-ghost',type:'line',source:'track-ghost',"
    "layout:{'line-cap':'round','line-join':'round'},"
    f"paint:{{'line-color':'{cfg.ghost_track_color}','line-width':{cfg.line_width:.2f},'line-opacity':{max(0.0, min(1.0, cfg.ghost_track_opacity)):.2f}"
    + (f",'line-dasharray':{_dasharray_mapbox(cfg.line_style, cfg.line_style_spacing)}" if _dasharray_mapbox(cfg.line_style, cfg.line_style_spacing) else "")
    + (",'line-z-offset':150" if cfg.enable_terrain else "")
    + "}});") if cfg.ghost_track_enabled and cfg.ghost_track_opacity > 0 else "// ghost track disabled"}
  // v0.9.210 (Reiseroute) — geladenes Wander-GPX als zusätzlicher Ghost.
  {_gpx_ghost_js}
  // OPTIONAL: Schlagschatten-Layer. Wird vor der glow/line-Layer added,
  // damit er darunter liegt. Bewusst KEIN z-offset → bei aktivem Terrain
  // bleibt der Schatten auf dem Boden, während die Track-Linie 150 m
  // darüber schwebt — sieht wie eine echte 3D-Linie über der Karte aus.
  {("map.addLayer({id:'track-shadow',type:'line',source:'track',"
    "layout:{'line-cap':'round','line-join':'round'},"
    "paint:{'line-color':'rgba(0,0,0,0.7)',"
    f"'line-width':{cfg.line_width * 2.2:.2f},"
    f"'line-blur':{cfg.shadow_strength:.1f},"
    f"'line-translate':[{cfg.shadow_strength:.1f}, {cfg.shadow_strength:.1f}]"
    + (f",'line-dasharray':{_dasharray_mapbox(cfg.line_style, cfg.line_style_spacing)}" if _dasharray_mapbox(cfg.line_style, cfg.line_style_spacing) else "")
    + "}});") if cfg.shadow_enabled and cfg.shadow_strength > 0 else "// shadow disabled"}
  // Track-Layer: line-cap/line-join `round` für saubere Track-Endungen
  // statt Mapbox-Default `butt/miter` (kantig). Plus optionales
  // line-dasharray für gestrichelte/gepunktete Stile.
  {("map.addLayer({id:'track-glow',type:'line',source:'track',"
    "layout:{'line-cap':'round','line-join':'round'},"
    # v0.9.20 — Glow-line-width skaliert mit glow_strength (Nutzer-Feedback:
    # „ab 1.5px wieder abgeschaltet" — Mapbox-line-blur sättigt visuell bei
    # hohen Werten weil Peak-Alpha sinkt). Lösung: gs steuert jetzt auch die
    # Linien-Breite. Formel `(2.0 + 0.21 × gs)` ergibt bei gs=4 (Default)
    # ≈ 2.85 (= Backward-Compat zur alten festen 2.85), bei gs=10 → 4.10×
    # → spürbar breiterer Halo.
    f"paint:{{'line-color':'{cfg.line_color}','line-width':{cfg.line_width * (2.0 + 0.21 * cfg.glow_strength):.2f},'line-opacity':0.35,'line-blur':{cfg.glow_strength:.1f}"
    + (f",'line-dasharray':{_dasharray_mapbox(cfg.line_style, cfg.line_style_spacing)}" if _dasharray_mapbox(cfg.line_style, cfg.line_style_spacing) else "")
    + (",'line-z-offset':150" if cfg.enable_terrain else "")
    + "}});") if cfg.glow_enabled and cfg.glow_strength > 0 else "// glow disabled"}
  map.addLayer({{id:'track-line',type:'line',source:'track',
    layout:{{'line-cap':'round','line-join':'round'}},
    paint:{{'line-color':'{cfg.line_color}','line-width':{cfg.line_width:.2f},'line-opacity':0.95{f",'line-dasharray':{_dasharray_mapbox(cfg.line_style, cfg.line_style_spacing)}" if _dasharray_mapbox(cfg.line_style, cfg.line_style_spacing) else ""}{',\'line-z-offset\':150' if cfg.enable_terrain else ''}}}}});
  {("map.addLayer({id:'track-highlight',type:'line',source:'track',"
    "layout:{'line-cap':'round','line-join':'round'},"
    f"paint:{{'line-color':'#ffffff','line-width':{cfg.line_width * 0.35:.2f},'line-opacity':0.55,'line-blur':0.6"
    + (f",'line-dasharray':{_dasharray_mapbox(cfg.line_style, cfg.line_style_spacing)}" if _dasharray_mapbox(cfg.line_style, cfg.line_style_spacing) else "")
    + (",'line-z-offset':150" if cfg.enable_terrain else "")
    + "}});") if cfg.track_style == "tube" else "// no tube highlight"}
  // v0.9.156 — Multi-Track: N eigene Tour-Sources/Layer (leer wenn Single-Track).
  {multi_track_layers}
  map.addSource('dot', {{type:'geojson',data:{{type:'Feature',geometry:{{type:'Point',coordinates:allCoords[0]}}}}}});
  map.addLayer({{id:'dot-glow',type:'circle',source:'dot',
    paint:{{'circle-radius':10,'circle-color':'#fff','circle-opacity':0.3,'circle-blur':0.8,'circle-pitch-alignment':'map'}}}});
  map.addLayer({{id:'dot-core',type:'circle',source:'dot',
    paint:{{'circle-radius':5,'circle-color':'#fff','circle-opacity':0.95,'circle-stroke-color':'{cfg.line_color}','circle-stroke-width':2,'circle-pitch-alignment':'map'}}}});
  // v0.9.307 — Start/End-Pins (aus der Tour-Map übernommen, Standbild-Modus).
  // Identische Optik wie früher core/tourmap.py: weißer Start, Track-farbiges Ende.
  if (SHOW_PINS && allCoords.length >= 2) {{
    map.addSource('pins', {{type:'geojson', data:{{type:'FeatureCollection', features:[
      {{type:'Feature', properties:{{kind:'start'}}, geometry:{{type:'Point', coordinates: allCoords[0]}}}},
      {{type:'Feature', properties:{{kind:'end'}},   geometry:{{type:'Point', coordinates: allCoords[allCoords.length-1]}}}}
    ]}}}});
    map.addLayer({{id:'pin-glow', type:'circle', source:'pins',
      paint:{{'circle-radius':14,'circle-color':'#ffffff','circle-opacity':0.3,'circle-blur':0.7,'circle-pitch-alignment':'map'}}}});
    map.addLayer({{id:'pin-core', type:'circle', source:'pins',
      paint:{{'circle-radius':7,
        'circle-color':['match',['get','kind'],'start','#ffffff','end','{cfg.line_color}','#fff'],
        'circle-stroke-color':['match',['get','kind'],'start','{cfg.line_color}','end','#ffffff','#fff'],
        'circle-stroke-width':2.5,'circle-pitch-alignment':'map'}}}});
  }}
  // v0.9.74 — Foto-Pins (Phase 1): permanent sichtbar ab Frame 0.
{photo_pins_block}
  // v0.9.171 — Wegpunkt-Schilder (HTML-Marker, erscheinen bei Erreichen).
{signs_block}
  // v0.9.390 — Track + Overlays ÜBER die Karten-Beschriftungen legen. Im
  // Mapbox-Standard-Style (standard/standard-satellite) landen per addLayer OHNE
  // Slot eingehängte Layer UNTER den Style-Labels (Ortsnamen/Straßen/POI) →
  // „Beschriftung wird über den Track geschrieben". moveLayer(id) ohne beforeId
  // hebt unsere (ungeslotteten) Layer an die Spitze — über die Labels. Bei
  // klassischen Styles liegen sie ohnehin oben (praktisch No-Op).
  try {{
    var _rzTopPrefixes = ['track-','gpx-ghost','dot-','pin-','photo-pins','anim-signs','mtrack'];
    map.getStyle().layers.map(function(l){{return l.id;}}).forEach(function(_lid){{
      if (_rzTopPrefixes.some(function(p){{return _lid.indexOf(p)===0;}})) {{
        try {{ if (map.getLayer(_lid)) map.moveLayer(_lid); }} catch(_){{}}
      }}
    }});
  }} catch(_){{}}
}});
map.on('idle', () => {{
  if (!mapReady) {{
    mapReady = true;
    window._mapReady = true;
    // Initial Center + Zoom aus Mapbox's bounds-Fit cachen → Python liest die
    // gleich nach isReady aus und nutzt sie für advanceFrame.
    const c = map.getCenter();
    window._initialCenter = [c.lng, c.lat];
    window._initialZoom = map.getZoom();
  }}
}});
window.isReady = () => window._mapReady === true;
window.getInitialView = () => ({{
  center: window._initialCenter || [{(min_lon+max_lon)/2}, {(min_lat+max_lat)/2}],
  zoom: window._initialZoom || 12
}});
// v0.9.311 — Kamera-Höhe glätten (Follow + Terrain). Mapbox setzt die Kamera-Höhe
// = Geländehöhe unter der Mitte + feste Flughöhe. Folgt die Kamera dem Track über
// Berg und Tal, hüpft sie 1:1 mit dem Gelände. Wir tiefpassen die Geländehöhe und
// halten die Flughöhe (off) konstant → kein Hüpfen, Blickpunkt bleibt der Track.
// v0.9.317 — Höhe-Halten KOMPLETT deaktiviert (No-Op). Die alte Free-Camera-Logik
// (Gelände-Tiefpass) hat über bergigem Gelände gehüpft und wurde für einen sauberen
// Neuanfang entfernt. Die Kamera läuft jetzt rein über map.jumpTo/setCenter/setZoom/
// setPitch (= reitet auf dem Gelände, vorhersehbar). Neukonzept folgt separat.
window.__stabCamHeight = (lon, lat) => {{ return; }};

// v0.9.318 — Entkoppelte FreeCamera gegen Berg-Hüpfen (in Sandbox validiert).
// Pro Keyframe die exakte 3D-Kamera auslesen (Position Mercator-x/y/z + Orientierung-
// Quaternion), zwischen Keyframes Position linear im 3D-Raum + Orientierung per nlerp
// interpolieren → Kamera reitet NICHT mehr aufs Gelände, framing-treu an den KFs.
window.__kfCams = null;
window.__camPrepFaithful = (camList) => {{
  window.__kfCams = camList.map((k) => {{
    map.jumpTo({{ center: [k.lng, k.lat], zoom: k.zoom, pitch: k.pitch, bearing: k.bearing }});
    try {{ if (map._render) map._render(); }} catch (e) {{}}
    const fc = map.getFreeCameraOptions();
    const o = fc.orientation;
    return {{ t: k.t, pos: [fc.position.x, fc.position.y, fc.position.z], ori: [o[0], o[1], o[2], o[3]] }};
  }});
}};
window.__nlerpQuat = (a, b, t) => {{
  const dot = a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3];
  const bb = dot < 0 ? [-b[0], -b[1], -b[2], -b[3]] : b;
  const r = [a[0]+(bb[0]-a[0])*t, a[1]+(bb[1]-a[1])*t, a[2]+(bb[2]-a[2])*t, a[3]+(bb[3]-a[3])*t];
  const len = Math.hypot(r[0], r[1], r[2], r[3]) || 1;
  return [r[0]/len, r[1]/len, r[2]/len, r[3]/len];
}};
window.__camFaithful = (t) => {{
  const cams = window.__kfCams;
  if (!cams || cams.length === 0) return;
  const fc = map.getFreeCameraOptions();
  if (cams.length === 1) {{
    const c = cams[0];
    fc.position = new mapboxgl.MercatorCoordinate(c.pos[0], c.pos[1], c.pos[2]);
    fc.orientation = c.ori; map.setFreeCameraOptions(fc); return;
  }}
  let i = 0;
  while (i < cams.length - 2 && t > cams[i+1].t) i++;
  const A = cams[i], B = cams[i+1];
  const span = (B.t - A.t) || 1e-6;
  const u = Math.max(0, Math.min(1, (t - A.t) / span));
  const px = A.pos[0] + (B.pos[0]-A.pos[0])*u, py = A.pos[1] + (B.pos[1]-A.pos[1])*u, pz = A.pos[2] + (B.pos[2]-A.pos[2])*u;
  fc.position = new mapboxgl.MercatorCoordinate(px, py, pz);
  fc.orientation = window.__nlerpQuat(A.ori, B.ori, u);
  map.setFreeCameraOptions(fc);
}};
window.advanceFrame = (idx, brg, lon, lat, zm, pt, setCam) => {{
  const safe = Math.max(0, Math.min(idx, totalPoints-1));
  // v0.9.55: optional Pre-Trim-Portion (coords[0..TRIM_START_IDX-1]) ausblenden.
  const sliceStart = SHOW_PRETRIM_TRACK ? 0 : Math.min(TRIM_START_IDX, safe);
  const coords = allCoords.slice(sliceStart, safe+1);
  if (coords.length >= 2) {{
    map.getSource('track').setData({{type:'Feature',geometry:{{type:'LineString',coordinates:coords}}}});
  }}
  const head = coords[coords.length-1] || allCoords[0];
  map.getSource('dot').setData({{type:'Feature',geometry:{{type:'Point',coordinates:head}}}});
  // v0.9.318 — setCam===false: Kamera NICHT hier setzen (entkoppelte FreeCamera
  // übernimmt das via __camFaithful). Linie/Punkt/Overlays laufen trotzdem.
  if (setCam !== false) {{
    map.setBearing(brg); map.setCenter([lon,lat]);
    if (zm !== undefined) map.setZoom(zm);
    if (pt !== undefined) map.setPitch(pt);
    __stabCamHeight(lon, lat);
  }}
  updateOverlays(safe);
  // v0.9.79 (Phase 2) — Foto-Pins: Filter auf aktuelle Marker-Position.
  // markerAnchor = safe/(totalPoints-1) ist die Position im realen Track,
  // identisch zum UI-Preview-Filter.
  if (window.__photoPinsAnchorFilter) {{
    const markerAnchor = totalPoints > 1 ? (safe / (totalPoints - 1)) : 0;
    window.__photoPinsAnchorFilter(markerAnchor);
  }}
  // v0.9.171 — Wegpunkt-Schilder: Filter auf erreichte Position (wie Foto-Pins).
  if (window.__signsAnchorFilter) {{
    const markerAnchor = totalPoints > 1 ? (safe / (totalPoints - 1)) : 0;
    window.__signsAnchorFilter(markerAnchor);
  }}
  // v0.9.286 (Marc-Bug: erster Frame schwarz) — DETERMINISTISCHER Fix. Bei
  // statischen Frames (Intro-/End-Hold: identische setCenter/setZoom/setBearing)
  // überspringt Mapbox das Repaint (No-Op) → der WebGL-Buffer bleibt auf der
  // unfertigen Erst-Bemalung (schwarze, noch nicht geladene Kacheln) eingefroren,
  // und der Screenshot greift genau diesen schwarzen Buffer ab (im Log: 8× kein
  // Effekt). `triggerRepaint()` erzwingt bei JEDEM Frame ein Neu-Malen → sobald die
  // Kacheln da sind, erscheinen sie. Kein Mehraufwand (wir screenshotten eh jeden
  // Frame). Zusammen mit der Schwarz-Frame-Schleife unten = robust.
  if (map.triggerRepaint) map.triggerRepaint();
}};
{multi_advance_js}
// v0.9.14 — `idle`-Wait statt `render`-Wait.
// VORHER: `map.once('render', ...)` feuerte beim ALLERERSTEN render-Event nach
// advanceFrame(). Dieses Event kann aber noch IM Tile-Lade-Vorgang fallen —
// dann sieht der Screenshot weiße/halbtransparente Placeholder-Tiles. Marc +
// Nutzer haben das als „Farb-/Helligkeits-Schwankung + weiße Flächen" in den
// gerenderten Filmen gemeldet (Preview war OK, weil Preview ohne diese Wait-
// Mechanik nur den aktuellen Browser-State zeigt).
// JETZT: `map.on('idle')` feuert erst wenn alle Tiles geladen + alle Renders
// + alle Animationen fertig sind. Plus kleines Settle-Timeout damit der GPU-
// Frame wirklich gemalt ist. Hard-Cap 5 s pro Frame falls Tiles nie laden
// (besser ein leicht unsauberer Frame als hängender Render).
window.waitForRender = () => new Promise(r => {{
  const settleMs = 60;
  const finish = () => setTimeout(r, settleMs);
  // Bereits idle? → sofort.
  // v0.9.286 (Marc-Bug: erster Frame teils schwarz): ZUSÄTZLICH `areTilesLoaded()`
  // prüfen. Bei Frame 0 ist die Karte direkt nach dem instant `jumpTo` zwar
  // „nicht in Bewegung" (kein Animations-Flug), aber die Satelliten-Kacheln des
  // Startbilds sind noch nicht geladen → ohne diesen Check nahm waitForRender die
  // 60-ms-Abkürzung und der Screenshot wurde schwarz/halbleer aufgenommen. Mit dem
  // Kachel-Check fällt Frame 0 in den `idle`-Wait unten (feuert erst nach Tile-Laden).
  let _tilesOk = true;
  try {{ _tilesOk = map.areTilesLoaded(); }} catch (_) {{ _tilesOk = true; }}
  if (map.loaded() && _tilesOk && !map.isMoving() && !map.isZooming() && !map.isEasing()) {{
    return finish();
  }}
  let done = false;
  const onIdle = () => {{
    if (done) return;
    done = true;
    map.off('idle', onIdle);
    finish();
  }};
  map.on('idle', onIdle);
  setTimeout(() => {{
    if (done) return;
    done = true;
    map.off('idle', onIdle);
    finish();
  }}, 5000);
}});

// v0.9.19 — Tile-Cache-Prewarm. Wird VOR der Frame-Loop einmal aufgerufen
// und „durchfliegt" die Animation an N stützstellen, damit Mapbox die
// benötigten Tiles in seinen Browser-Cache zieht. Dann fliegt jeder echte
// Frame durch gecachte Tiles → `idle` fires in ~50 ms statt ~1–3 s.
// Kein Quality-Loss, nur initial einmal ~5–15 s Vorlauf gegen ggf.
// Minuten gespart in der Frame-Loop.
// Erwartet ein Array von [bearing, lon, lat, zoom, pitch]-Tupeln.
window.prewarmTiles = async (samples) => {{
  if (!samples || samples.length === 0) return;
  for (const s of samples) {{
    const [brg, lon, lat, zm, pt] = s;
    map.setBearing(brg);
    map.setCenter([lon, lat]);
    if (zm !== undefined) map.setZoom(zm);
    if (pt !== undefined) map.setPitch(pt);
    // Pro Stützstelle auf `idle` warten (= alle Tiles für diese Ansicht geladen)
    await window.waitForRender();
  }}
}};
</script></body></html>"""


def _make_html_alpha(cfg: AnimatorConfig, ds_points: list[TrackPoint], cum_dist: list[float],
                     cum_time: list[float], total_stats: dict,
                     bbox: tuple[float, float, float, float]) -> str:
    """Alpha-Channel-Variante: kein Mapbox, kein Terrain, nur SVG-Track auf
    transparentem Hintergrund. Identische window.advanceFrame() / window.isReady() /
    window.getInitialView()-API wie die Mapbox-Variante, damit `render()` keine
    Sonderbehandlung braucht.

    Projektion: simpel Bbox→Pixel (kein Mercator-Verzerrungs-Korrekturschritt — bei
    Track-typischen Bbox-Größen kaum sichtbar, und der User legt das eh als Overlay
    über echtes Video, wo perfekte Geo-Genauigkeit eh nicht das Ziel ist).
    """
    coords_json = json.dumps([[p.lon, p.lat] for p in ds_points])
    eles = [p.ele if p.ele is not None else 0.0 for p in ds_points]
    elevations_json = json.dumps(eles)
    cum_dist_json = json.dumps(cum_dist)
    cum_time_json = json.dumps(cum_time)
    ele_min = min(eles)
    ele_max = max(eles)
    min_lon, min_lat, max_lon, max_lat = bbox
    # Track-Bbox auf Frame projizieren mit 8 % Innen-Padding (gleicher Wert
    # wie Mapbox-Pfad). Aspect-Lock: Track-Aspect wird im Frame zentriert,
    # damit nichts verzerrt aussieht.
    PAD = 0.08
    glow_w = cfg.line_width * 2.85
    # Overlay-HTML wiederverwenden (identisches Layout)
    totals_html = ""
    live_html = ""
    ele_html = ""
    # v0.9.24 — Bei Track ohne Zeit/Höhe entsprechende Stat-Zeilen ausblenden
    # statt „0 m" / „00:00" anzuzeigen. Marc-Selftest 2026-05-24: track_klein.gpx
    # hat keine <ele>/<time>-Tags → Render zeigte trotzdem alle Zeilen mit
    # irreführenden Null-Werten + leeres Höhenprofil-Overlay.
    has_time = bool(total_stats.get('duration_s'))
    has_ele = total_stats.get('ele_max') is not None and total_stats.get('ele_min') is not None
    # v0.9.321/323 — Stats-Editor: Pro-Punkt-Speed/Grade + Fahrzeit + echtes Max-Tempo.
    speed_kmh, grade_pct, _moving_s, _max_kmh = _overlay_compute_speed_grade(ds_points, cum_dist, cum_time, eles, has_time, has_ele)
    speed_json = json.dumps([round(x, 2) for x in speed_kmh])
    grade_json = json.dumps([round(x, 2) for x in grade_pct])
    sensor_series_json = _overlay_sensor_series_json(ds_points, getattr(cfg, "overlay_live_fields", None))
    total_stats = dict(total_stats)
    # v0.9.324 — Max-Tempo + Fahrzeit kommen aus den VOLL aufgelösten Track-Stats
    # (TrackStats.max_speed_kmh/moving_time_s). Die ds_points-Werte sind nur
    # Fallback, falls der Aufrufer sie nicht mitliefert — Downsampling würde
    # den Tempo-Peak sonst wegglätten (Nutzer-Feedback: 43 km/h zu niedrig).
    if has_time:
        if not total_stats.get("max_speed_kmh"):
            total_stats["max_speed_kmh"] = _max_kmh
        if not total_stats.get("moving_time_s"):
            total_stats["moving_time_s"] = _moving_s
    else:
        total_stats["max_speed_kmh"] = 0.0
        total_stats["moving_time_s"] = 0.0
    live_update_js = _overlay_live_update_js(getattr(cfg, "overlay_live_fields", None), has_time, has_ele, getattr(cfg, "overlay_field_overrides", None))
    if cfg.show_overlays:
        if cfg.overlay_totals_enabled:
            _trows = _overlay_totals_rows(getattr(cfg, "overlay_totals_fields", None), total_stats, has_time, has_ele)
            if _trows:
                totals_html = f"""
<div id="overlay-totals" class="stats-box pos-{cfg.overlay_totals_position}">
  {_trows}
</div>"""
        if cfg.overlay_live_enabled:
            _lrows = _overlay_live_rows(getattr(cfg, "overlay_live_fields", None), has_time, has_ele, getattr(cfg, "overlay_field_overrides", None))
            if _lrows:
                live_html = f"""
<div id="overlay-live" class="stats-box pos-{cfg.overlay_live_position}">
  {_lrows}
</div>"""
        # Höhenprofil nur wenn echte Höhendaten vorhanden — sonst leerer Strich.
        if cfg.overlay_elevation_enabled and has_ele:
            ele_html = f"""
<div id="overlay-bottom" class="pos-{cfg.overlay_elevation_position}">
  <div class="ele-header">
    <span class="ele-title">H&ouml;henprofil</span>
    <span class="ele-minmax">Min {ele_min:.0f} m<span class="sep">&bull;</span>Max {ele_max:.0f} m</span>
  </div>
  <svg id="elevation-svg" viewBox="0 0 1000 120" preserveAspectRatio="none">
    <defs>
      <linearGradient id="ele-grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="{cfg.line_color}" stop-opacity="0.55"/>
        <stop offset="100%" stop-color="{cfg.line_color}" stop-opacity="0.02"/>
      </linearGradient>
    </defs>
    <polyline id="ele-bg-line" fill="none" stroke="rgba(255,255,255,0.45)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
    <polygon id="ele-active-fill" fill="url(#ele-grad)"/>
    <polyline id="ele-active-line" fill="none" stroke="{cfg.line_color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle id="ele-dot" r="4.5" fill="#ffffff" stroke="{cfg.line_color}" stroke-width="2"/>
  </svg>
</div>"""
    overlays_block = totals_html + live_html + ele_html + _overlay_timing_js(cfg)
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8">
{_overlay_font_link(cfg)}
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  html, body {{ width: {cfg.width}px; height: {cfg.height}px; overflow: hidden;
    background: transparent;
    font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }}
  #track-svg {{ position: absolute; top:0; left:0; width:100%; height:100%; }}
{_overlay_css(cfg, alpha_mode=True)}
</style></head>
<body>
<svg id="track-svg" viewBox="0 0 {cfg.width} {cfg.height}" preserveAspectRatio="none">
  <defs>
    <!-- OPTIONAL: Schlagschatten via feDropShadow. Wird über `filter`-Attribut
         auf die track-Polyline + Dot angewendet wenn shadow_enabled.
         Im Alpha-Modus ist das die saubere Lösung — feDropShadow respektiert
         den Alpha-Kanal des Inputs und schreibt halbtransparente Pixel,
         die im NLE-Composit korrekt mitziehen. -->
    <filter id="trk-shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="{cfg.shadow_strength:.1f}" dy="{cfg.shadow_strength:.1f}"
        stdDeviation="{cfg.shadow_strength * 0.6:.1f}"
        flood-color="#000000" flood-opacity="0.7"/>
    </filter>
  </defs>
  {(f'<polyline id="trk-ghost" fill="none" stroke="{cfg.ghost_track_color}" stroke-opacity="{max(0.0, min(1.0, cfg.ghost_track_opacity)):.2f}"'
     f' stroke-width="{cfg.line_width:.2f}" stroke-linejoin="round" stroke-linecap="round"'
     + (f' stroke-dasharray="{_dasharray_svg(cfg.line_style, cfg.line_width, cfg.line_style_spacing)}"' if _dasharray_svg(cfg.line_style, cfg.line_width, cfg.line_style_spacing) else "")
     + '/>') if cfg.ghost_track_enabled and cfg.ghost_track_opacity > 0 else '<!-- ghost track disabled -->'}
  <g {('filter="url(#trk-shadow)"' if cfg.shadow_enabled and cfg.shadow_strength > 0 else "")}>
    {(f'<polyline id="trk-glow" fill="none" stroke="{cfg.line_color}" stroke-opacity="0.35"'
       f' stroke-width="{glow_w:.2f}" stroke-linejoin="round" stroke-linecap="round"'
       + (f' stroke-dasharray="{_dasharray_svg(cfg.line_style, glow_w, cfg.line_style_spacing)}"' if _dasharray_svg(cfg.line_style, glow_w, cfg.line_style_spacing) else "")
       + f' style="filter: blur({cfg.glow_strength:.1f}px);"/>') if cfg.glow_enabled and cfg.glow_strength > 0 else '<!-- glow disabled -->'}
    <polyline id="trk-line" fill="none" stroke="{cfg.line_color}" stroke-opacity="0.95"
      stroke-width="{cfg.line_width:.2f}" stroke-linejoin="round" stroke-linecap="round"
      {(f'stroke-dasharray="{_dasharray_svg(cfg.line_style, cfg.line_width, cfg.line_style_spacing)}"' if _dasharray_svg(cfg.line_style, cfg.line_width, cfg.line_style_spacing) else "")}/>
    <circle id="trk-dot-glow" r="10" fill="#fff" fill-opacity="0.3"/>
    <circle id="trk-dot-core" r="5" fill="#fff" stroke="{cfg.line_color}" stroke-width="2"/>
  </g>
</svg>
{overlays_block}
<script>
const allCoords = {coords_json};
const elevations = {elevations_json};
const cumDistM = {cum_dist_json};
const cumTimeS = {cum_time_json};
const speedKmh = {speed_json};   // v0.9.321 — Stats-Editor: Pro-Punkt-Tempo
const gradePct = {grade_json};   // v0.9.321 — Pro-Punkt-Steigung %
const sensorSeries = {sensor_series_json};   // v0.9.330 — FIT-Sensorwerte pro Punkt (key → [werte])
const TOTAL_DIST_M = cumDistM.length ? cumDistM[cumDistM.length - 1] : 0;
const TOTAL_TIME_S = cumTimeS.length ? cumTimeS[cumTimeS.length - 1] : 0;
function fmtKmJS(km){{ return km < 100 ? km.toFixed(1)+' km' : km.toFixed(0)+' km'; }}
function fmtDurJS(sec){{ sec=Math.max(0,Math.floor(sec)); var h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60,p=function(n){{return n<10?'0'+n:''+n;}}; return h>0?h+':'+p(m)+':'+p(s):p(m)+':'+p(s); }}
const totalPoints = allCoords.length;
const SHOW_OVERLAYS = {str(cfg.show_overlays).lower()};
// v0.9.55 (Marc): Pre-Trim-Sichtbarkeit. Wenn False, startet die gezeichnete
// Linie am Trim-Start statt am Track-Anfang (= „Pre-Trim"-Portion ausgeblendet).
const SHOW_PRETRIM_TRACK = {str(cfg.show_pretrim_track).lower()};
const TRIM_START_IDX = Math.max(0, Math.min(totalPoints - 1, Math.floor({float(cfg.render_start_anchor)} * (totalPoints - 1))));
const W = {cfg.width}, H = {cfg.height};
const PAD = {PAD};
const BBOX = [{min_lon}, {min_lat}, {max_lon}, {max_lat}];
// Aspect-Lock-Projektion: Track-Bbox auf Frame mappen, dabei das Aspect
// erhalten (keine Verzerrung) und im Frame zentrieren. Mercator-Korrektur
// (cos(lat)) wäre für hohe Breiten besser, aber für Track-typische ~10 km
// Bboxes ist der Fehler unter 1 % und im Composit unsichtbar.
const innerW = W * (1 - 2*PAD);
const innerH = H * (1 - 2*PAD);
const trackW = BBOX[2] - BBOX[0];
const trackH = BBOX[3] - BBOX[1];
const scale = Math.min(innerW / Math.max(trackW, 1e-9), innerH / Math.max(trackH, 1e-9));
const offsetX = (W - trackW * scale) / 2;
const offsetY = (H - trackH * scale) / 2;
function projX(lon){{ return offsetX + (lon - BBOX[0]) * scale; }}
function projY(lat){{ return H - (offsetY + (lat - BBOX[1]) * scale); }}  // Y flippen (SVG)
const projected = allCoords.map(c => [projX(c[0]).toFixed(2), projY(c[1]).toFixed(2)]);

// v0.9.24 — Flags, siehe _make_html. Im Alpha-Modus kann der Track auch ohne
// ele/time kommen → DOM-Elemente fehlen dann conditional, JS muss null-safe sein.
const HAS_ELE = {str(has_ele).lower()};
const HAS_TIME = {str(has_time).lower()};
const SVG_W = 1000, SVG_H = 120, PAD_Y = 10;
const eleMin = HAS_ELE ? Math.min.apply(null, elevations) : 0;
const eleMax = HAS_ELE ? Math.max.apply(null, elevations) : 1;
const eleRange = (eleMax - eleMin) || 1;
function eleToY(e){{return SVG_H - PAD_Y - ((e - eleMin)/eleRange)*(SVG_H - PAD_Y*2);}}
function idxToX(i){{return (i / Math.max(1, totalPoints - 1)) * SVG_W;}}
if (SHOW_OVERLAYS && HAS_ELE) {{
  const bgLine = document.getElementById('ele-bg-line');
  if (bgLine) {{
    const bgPts = elevations.map((e,i)=>`${{idxToX(i).toFixed(2)}},${{eleToY(e).toFixed(2)}}`).join(' ');
    bgLine.setAttribute('points', bgPts);
  }}
}}
function updateOverlays(idx) {{
  if (!SHOW_OVERLAYS) return;
  // v0.9.325 — katalog-getriebene Live-Felder (identisch zu _make_html). VORHER
  // setzte der Alpha-Render noch die alten IDs live-dist/-time/-ele → seit dem
  // Stats-Editor (v0.9.321) blieben die Live-Stats im transparenten Video eingefroren.
{live_update_js}
  if (HAS_ELE) {{
    const elActive = document.getElementById('ele-active-line');
    if (elActive) {{
      const pts = [], pairs = [];
      for (let i=0; i<=idx; i++) {{
        const x=idxToX(i).toFixed(2), y=eleToY(elevations[i]).toFixed(2);
        pts.push(`${{x}},${{y}}`); pairs.push([x,y]);
      }}
      const ps = pts.join(' ');
      elActive.setAttribute('points', ps);
      if (pairs.length >= 2) {{
        const elFill = document.getElementById('ele-active-fill');
        if (elFill) elFill.setAttribute('points',
          `${{pairs[0][0]}},${{SVG_H}} ${{ps}} ${{pairs[pairs.length-1][0]}},${{SVG_H}}`);
      }}
      const dot = document.getElementById('ele-dot');
      if (dot) {{
        dot.setAttribute('cx', idxToX(idx).toFixed(2));
        dot.setAttribute('cy', eleToY(elevations[idx]).toFixed(2));
      }}
    }}
  }}
}}
window._ready = false;
window.isReady = () => window._ready === true;
window.getInitialView = () => ({{ center: [0, 0], zoom: 0 }});  // dummy fürs render-loop
window.advanceFrame = (idx, brg, lon, lat, zm, pt) => {{
  const safe = Math.max(0, Math.min(idx, totalPoints-1));
  // v0.9.55: optional Pre-Trim-Portion (projected[0..TRIM_START_IDX-1]) ausblenden.
  const sliceStart = SHOW_PRETRIM_TRACK ? 0 : Math.min(TRIM_START_IDX, safe);
  const ptsArr = projected.slice(sliceStart, safe+1);
  const ptsStr = ptsArr.map(p => p[0]+','+p[1]).join(' ');
  // Glow ist optional (v0.6.8) — Element kann fehlen wenn glow_enabled=False
  const _trkGlow = document.getElementById('trk-glow');
  if (_trkGlow) _trkGlow.setAttribute('points', ptsStr);
  // v0.9.169 — Ghost: ganze Route EINMAL setzen (statisch, voller Track).
  const _trkGhost = document.getElementById('trk-ghost');
  if (_trkGhost && !window._ghostSet) {{
    _trkGhost.setAttribute('points', projected.map(p => p[0]+','+p[1]).join(' '));
    window._ghostSet = true;
  }}
  document.getElementById('trk-line').setAttribute('points', ptsStr);
  const head = ptsArr[ptsArr.length-1] || projected[0];
  document.getElementById('trk-dot-glow').setAttribute('cx', head[0]);
  document.getElementById('trk-dot-glow').setAttribute('cy', head[1]);
  document.getElementById('trk-dot-core').setAttribute('cx', head[0]);
  document.getElementById('trk-dot-core').setAttribute('cy', head[1]);
  updateOverlays(safe);
}};
window.waitForRender = () => new Promise(r => setTimeout(r, 5));
// SVG ist sofort fertig — kein Map-Tile-Loading.
window.advanceFrame(0, 0, 0, 0, 0, 0);
requestAnimationFrame(() => {{ window._ready = true; }});
</script></body></html>"""


def _smoothstep(t: float) -> float:
    """Klassisches 3t²−2t³ Ease-in/out für 0..1."""
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


async def _render_multi(cfg: AnimatorConfig, emit, push_preview, check_cancel) -> str:
    """v0.9.156 — Isolierter Multi-Track-Renderpfad (Marc-Wunsch 2026-06-01).

    Läuft GETRENNT vom battle-tested Single-Track-`render()` damit dieser
    byte-identisch bleibt. Aktiviert NUR wenn `cfg.tracks` ≥ 2 Touren hat.

    Ablauf:
      1. Jede Tour einzeln parsen + downsamplen → eigene `coords`-Liste + Farbe.
      2. Overlay-Arrays (cum_dist/cum_time) über alle Touren KONTINUIERLICH
         aufsummieren (Gesamt-Distanz/-Zeit wachsen durchgehend weiter).
      3. `_make_html(..., tours=...)` baut N `mtrack{i}`-Sources/Layer +
         `advanceFrameMulti()` + `fitTourView()`.
      4. Segment-Maschine: intro → walk(0) → fly(0→1) → walk(1) → … → hold.
         Touren-Übergänge = van-Wijk-Kinoflug (Zoom-Out → Pan → Zoom-In).
    """
    emit(0.0, "Lade Touren …")
    tours_cfg = list(cfg.tracks)
    _log.info("Multi-Track-Render: %d Touren · fly=%.1fs", len(tours_cfg), cfg.fly_duration_s)

    # ── 1+2. Pro Tour parsen, downsamplen, Overlay-Arrays kombinieren ──────
    tours: list[dict] = []
    combined_points: list[TrackPoint] = []
    cum_dist: list[float] = []
    cum_time: list[float] = []
    _dist_acc = 0.0
    _time_acc = 0.0
    for ti, tc in enumerate(tours_cfg):
        gpx_path = tc["gpx_path"]
        raw_pts, st = core_parse_gpx(gpx_path)
        if cfg.point_count <= 0 or cfg.point_count >= len(raw_pts):
            pts = raw_pts
        else:
            pts = downsample(raw_pts, max(2, cfg.point_count))
        if len(pts) < 2:
            _log.warning("Tour %d (%s) hat <2 Punkte — übersprungen.", ti, gpx_path)
            continue
        coords = [[p.lon, p.lat] for p in pts]
        base_dist = pts[0].dist_m
        base_time = pts[0].elapsed_s
        for p in pts:
            combined_points.append(p)
            cum_dist.append(_dist_acc + (p.dist_m - base_dist))
            cum_time.append(_time_acc + (p.elapsed_s - base_time))
        _dist_acc = cum_dist[-1]
        _time_acc = cum_time[-1]
        tours.append({
            "coords": coords,
            "color": tc.get("line_color") or cfg.line_color,
            "name": tc.get("name") or Path(gpx_path).stem,
            "n": len(coords),
            "points": pts,
            "stats": st,
        })
        _log.info("  Tour %d: %s · %d Punkte · %.1f km", ti, tours[-1]["name"],
                  len(coords), st.distance_m / 1000.0)

    if len(tours) < 2:
        # Nicht genug valide Touren → an Single-Track delegieren wäre riskant
        # (kein gpx_path-Setup). Klare Fehlermeldung.
        raise RuntimeError("Multi-Track-Render braucht ≥2 ladbare Touren mit je ≥2 Punkten.")

    N = len(tours)
    if cum_time and cum_time[-1] == 0:
        # Keine Zeitstempel → linear über Distanz (analog Single-Track-Fallback)
        _dmax = cum_dist[-1] or 1.0
        cum_time = [d / _dmax for d in cum_dist]

    total_stats_dict = {
        "distance_m": sum(t["stats"].distance_m for t in tours),
        "duration_s": sum(t["stats"].duration_s for t in tours),
        "ascent_m":   sum(t["stats"].ascent_m for t in tours),
        "descent_m":  sum(t["stats"].descent_m for t in tours),
        "ele_min": min((t["stats"].ele_min for t in tours if t["stats"].ele_min is not None), default=0.0),
        "ele_max": max((t["stats"].ele_max for t in tours if t["stats"].ele_max is not None), default=0.0),
        "moving_time_s": sum(getattr(t["stats"], "moving_time_s", 0.0) for t in tours),
        "max_speed_kmh": max((getattr(t["stats"], "max_speed_kmh", 0.0) for t in tours), default=0.0),
    }

    all_lons = [c[0] for t in tours for c in t["coords"]]
    all_lats = [c[1] for t in tours for c in t["coords"]]
    bbox = (min(all_lons), min(all_lats), max(all_lons), max(all_lats))

    tours_for_html = [{"coords": t["coords"], "color": t["color"]} for t in tours]

    # Phase 1: Foto-Pins im Multi-Track-Modus deaktiviert (kommen später).
    _saved_photos = cfg.photos
    cfg.photos = []
    try:
        html = _make_html(cfg, combined_points, cum_dist, cum_time,
                          total_stats_dict, bbox, tours=tours_for_html)
    finally:
        cfg.photos = _saved_photos

    # ── 3. Frame-Budget + Segment-Liste ───────────────────────────────────
    intro_frames = max(0, int(getattr(cfg, "intro_s", 0))) * cfg.fps
    hold_frames = cfg.hold_s * cfg.fps
    fly_frames = max(1, int(round(float(cfg.fly_duration_s) * cfg.fps)))
    anim_total = max(N, cfg.duration_s * cfg.fps)  # Gesamt-„Geh"-Budget

    total_pts = sum(t["n"] for t in tours) or 1
    walk_frames: list[int] = []
    assigned = 0
    for i, t in enumerate(tours):
        if i == N - 1:
            wf = max(1, anim_total - assigned)
        else:
            wf = max(1, int(round(anim_total * t["n"] / total_pts)))
        walk_frames.append(wf)
        assigned += wf

    # Segmente: (kind, tour_idx, n_frames)
    segments: list[tuple[str, int, int]] = []
    if intro_frames > 0:
        segments.append(("intro", 0, intro_frames))
    for i in range(N):
        segments.append(("walk", i, walk_frames[i]))
        if i < N - 1:
            segments.append(("fly", i, fly_frames))
    if hold_frames > 0:
        segments.append(("hold", N - 1, hold_frames))
    total_frames = sum(s[2] for s in segments)
    _log.info("Multi-Track-Budget: total=%d frames (intro=%d, walks=%s, fly=%d×%d, hold=%d)",
              total_frames, intro_frames, walk_frames, N - 1, fly_frames, hold_frames)

    emit(0.02, f"Karte laden ({cfg.map_style}) …")

    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        t_pw = time.time()
        try:
            browser = await p.chromium.launch(
                headless=True,
                args=["--use-angle=default", "--enable-webgl", "--ignore-gpu-blocklist", "--disable-gpu-sandbox",
                      # v0.9.387 — unterdrückt Chromecast/DIAL/mDNS-Geräte-Suche → kein macOS-„Lokales
                      # Netzwerk"-Zugriffs-Dialog beim Render (wir brauchen nur normales Internet für Tiles).
                      "--disable-background-networking", "--disable-features=MediaRouter,DialMediaRouteProvider",
                      "--no-first-run", "--no-default-browser-check"],
            )
        except Exception as e:
            _log.error("Playwright/Chromium-Start fehlgeschlagen: %s", e)
            raise
        _log.info("Chromium gestartet in %.1fs", time.time() - t_pw)

        _dsf = _render_dsf(cfg.width, cfg.height)
        _ss = _render_ss(cfg.width, cfg.height)  # v0.9.286: SSAA bei 4K
        _vp_w = max(1, int(round(cfg.width / _dsf)))
        _vp_h = max(1, int(round(cfg.height / _dsf)))
        if _ss > 1.0:
            _log.info("SSAA aktiv (4K): SS=%.2f → Capture %dx%d device px, downscale auf %dx%d",
                      _ss, int(_vp_w * _dsf * _ss), int(_vp_h * _dsf * _ss), cfg.width, cfg.height)
        page = await browser.new_page(
            viewport={"width": _vp_w, "height": _vp_h},
            device_scale_factor=_dsf * _ss,
        )

        def _on_console(msg):
            try: _log.info("page.console [%s] %s", msg.type, msg.text)
            except Exception: pass

        def _on_pageerror(err):
            _log.error("page.pageerror: %s", err)

        page.on("console", _on_console)
        page.on("pageerror", _on_pageerror)

        await page.set_content(html)

        ready = False
        for _i in range(60):
            ready = await page.evaluate("window.isReady()")
            if ready:
                break
            await asyncio.sleep(0.5)
        if not ready:
            _log.warning("Map wurde innerhalb 30s nicht ready — render läuft trotzdem weiter.")
        else:
            _log.info("Map ready nach ~%.1fs", _i * 0.5)

        if not cfg.transparent_background:
            await asyncio.sleep(3)  # Terrain-Tiles nachladen

        # ── Per-Tour-Kamera-Views (center+zoom) via Mapbox cameraForBounds ──
        tour_views: list[tuple[list, float]] = []
        for t in tours:
            v = None
            try:
                v = await page.evaluate("window.fitTourView(" + json.dumps(t["coords"]) + ")")
            except Exception as e:
                _log.warning("fitTourView fehlgeschlagen: %s", e)
            if isinstance(v, dict) and v.get("center"):
                tour_views.append((list(v["center"]), float(v.get("zoom", 12))))
            else:
                _bb, _ctr, _zm = _bounds_zoom(t["points"], cfg.width, cfg.height)
                tour_views.append(([_ctr[0], _ctr[1]], _zm))
        _log.info("Tour-Views: %s", [(round(c[0], 3), round(c[1], 3), round(z, 1)) for c, z in tour_views])

        emit(0.05, "Karte bereit, rendere Frames …")

        # ── ffmpeg-Cmd (identisch zum Single-Track-Builder) ────────────────
        ffmpeg_bin = find_ffmpeg()
        _log.info("ffmpeg: %s", ffmpeg_bin)
        codec = (cfg.codec or "h264").lower()
        alpha = cfg.transparent_background
        if alpha:
            ffmpeg_cmd = [
                ffmpeg_bin, "-y", "-loglevel", "error",
                "-f", "image2pipe", "-framerate", str(cfg.fps), "-i", "-",
                "-c:v", "prores_ks", "-profile:v", "4",
                "-pix_fmt", "yuva444p10le", "-vendor", "ap10",
            ]
        elif codec in ("prores", "prores4444"):
            ffmpeg_cmd = [
                ffmpeg_bin, "-y", "-loglevel", "error",
                "-f", "image2pipe", "-framerate", str(cfg.fps), "-i", "-",
                "-c:v", "prores_ks", "-profile:v", "4",
                "-pix_fmt", "yuv444p10le", "-vendor", "ap10",
            ]
        else:
            vcodec = "libx265" if codec in ("h265", "hevc") else "libx264"
            # v0.9.157 — yuv420p (war yuv444p): AVFoundation/WKWebView-abspielbar
            # (siehe Single-Track-Pfad in render()). ProRes für 4:4:4-Master.
            ffmpeg_cmd = [
                ffmpeg_bin, "-y", "-loglevel", "error",
                "-f", "image2pipe", "-framerate", str(cfg.fps), "-i", "-",
                # v0.9.245 — JPEG-Frames sind Full-Range (→ yuvj420p). Auf Standard-
                # Limited-Range (tv) normalisieren, damit der Output farblich
                # identisch zu den bisherigen PNG-Renders bleibt.
                *(["-vf", "scale=in_range=full:out_range=tv"]
                  if (cfg.frame_format or "jpeg").lower() == "jpeg" else []),
                "-c:v", vcodec, "-preset", (cfg.encoder_preset or "fast"), "-crf", str(cfg.crf),
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

        def _bearing_at(gp: float) -> float:
            # Kontinuierlicher Sweep über das gesamte Video (wie Single-Track).
            return -10.0 + gp * cfg.rotation

        try:
            preview_every = max(1, cfg.fps // 10)
            pitch_f = cfg.pitch
            gframe = 0
            for kind, ti, seg_n in segments:
                for f in range(seg_n):
                    check_cancel()
                    gp = gframe / max(1, total_frames - 1)
                    brg = _bearing_at(gp)

                    if kind == "fly":
                        # Übergang Tour ti → ti+1: van-Wijk-Bogen, kein Dot.
                        c1, z1 = tour_views[ti]
                        c2, z2 = tour_views[ti + 1]
                        p01 = _smoothstep(f / max(1, seg_n - 1))
                        cc, zz = _timeline._van_wijk_interp(c1, c2, z1, z2, p01)
                        # Tour ti bleibt voll gezeichnet, Marker aus.
                        await page.evaluate(
                            "window.advanceFrameMulti("
                            f"{ti}, {tours[ti]['n'] - 1}, {brg}, {cc[0]}, {cc[1]}, {zz}, {pitch_f}, false)"
                        )
                    else:
                        ctr, zm = tour_views[ti]
                        n_i = tours[ti]["n"]
                        if kind == "intro":
                            local = 0
                        elif kind == "hold":
                            local = n_i - 1
                        else:  # walk
                            frac = f / max(1, seg_n - 1)
                            local = min(n_i - 1, int(round(frac * (n_i - 1))))
                        await page.evaluate(
                            "window.advanceFrameMulti("
                            f"{ti}, {local}, {brg}, {ctr[0]}, {ctr[1]}, {zm}, {pitch_f}, true)"
                        )

                    await page.evaluate("window.waitForRender()")
                    # Smart-Tile-Retry (analog Single-Track) — Flüge springen weit.
                    tile_retries = 0
                    while tile_retries < 3:
                        try:
                            tiles_ok = await page.evaluate("map.areTilesLoaded()")
                        except Exception:
                            tiles_ok = True
                        if tiles_ok:
                            break
                        tile_retries += 1
                        _log.warning("Frame %d: Tiles fehlen, Retry %d/3 — warte 2s …",
                                     gframe + 1, tile_retries)
                        await asyncio.sleep(2.0)
                        try: await page.evaluate("window.waitForRender()")
                        except Exception: pass

                    shot = await _grab_frame(page, cfg)
                    ff.stdin.write(shot)
                    if gframe % preview_every == 0:
                        push_preview(shot)
                    emit(0.05 + 0.87 * (gframe + 1) / total_frames,
                         f"Frame {gframe + 1} / {total_frames}")
                    gframe += 1
        except RenderCancelled:
            _log.info("Multi-Track-Render abgebrochen — ffmpeg beenden + Output löschen.")
            try: ff.stdin.close()
            except Exception: pass
            try:
                ff.terminate()
                ff.wait(timeout=3)
            except Exception:
                try: ff.kill()
                except Exception: pass
            try: Path(cfg.output_path).unlink(missing_ok=True)
            except Exception: pass
            try: await browser.close()
            except Exception: pass
            raise
        finally:
            try: ff.stdin.close()
            except Exception: pass

        emit(0.92, "ffmpeg finalisiert (+faststart, kann etwas dauern) …")
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
            _log.info("Multi-Track-Output OK: %s (%.1f MB)", cfg.output_path, sz / 1_000_000)
        except Exception as e:
            _log.warning("Konnte Output-Datei nicht stat()en: %s", e)

        await browser.close()

    emit(1.0, "Fertig.")
    return cfg.output_path


def _frame_black_ratio(img_bytes: bytes) -> float:
    """Anteil (0..1) nahezu schwarzer Pixel im Frame. v0.9.286 — dient dazu, einen
    halb-geladenen Satelliten-Frame zu erkennen: ungemalte Kacheln sind PURES
    Schwarz (#000), echte Kartenpixel (auch Nacht-Style) sind nie ganz schwarz.
    Downscale auf ~192 px für Tempo (JPEG+PNG via Pillow)."""
    try:
        import io
        from PIL import Image
        im = Image.open(io.BytesIO(img_bytes)).convert("L")
        im.thumbnail((192, 192))
        data = list(im.getdata())
        if not data:
            return 0.0
        return sum(1 for v in data if v < 12) / len(data)
    except Exception:
        return 0.0


def _downscale_frame(raw: bytes, target_w: int, target_h: int,
                     transparent: bool, jpeg_q: int) -> bytes:
    """Supersampling-Downscale (Marc-Bug v0.9.286): der Screenshot kommt bei
    aktivem SSAA in SS×-Auflösung rein; auf die Zielauflösung runterskalieren →
    Anti-Aliasing der feinen Satelliten-Textur. Filter = `BOX` (echtes
    Area-Averaging = der korrekte SSAA-Resolve, **und** deutlich schneller als
    Lanczos — relevant, weil das pro Frame läuft). Behält Alpha bei transparenten
    Renders. Re-encode im gleichen Format wie ohne SSAA."""
    import io
    from PIL import Image
    im = Image.open(io.BytesIO(raw))
    if im.size != (target_w, target_h):
        im = im.resize((target_w, target_h), Image.BOX)
    out = io.BytesIO()
    if transparent:
        im.save(out, format="PNG")
    elif jpeg_q > 0:
        im.convert("RGB").save(out, format="JPEG", quality=jpeg_q)
    else:
        im.save(out, format="PNG")
    return out.getvalue()


async def _grab_frame(page, cfg: "AnimatorConfig") -> bytes:
    """Einen Frame als Bild-Bytes greifen. Alpha → PNG (Transparenz), sonst je
    nach cfg.frame_format JPEG (schnell) oder PNG (verlustfrei). v0.9.245.
    ffmpeg's image2pipe-Demuxer erkennt JPEG vs PNG automatisch.

    v0.9.286: Bei 4K läuft der Browser mit erhöhtem device_scale_factor (SSAA,
    siehe _render_ss), d.h. der Screenshot ist SS× größer als cfg.width/height.
    Wir skalieren ihn dann auf die Zielauflösung runter → Flimmern der scharfen
    Satelliten-Textur geglättet. **Wichtig:** der Screenshot wird im NORMALEN
    schnellen Format gegriffen (JPEG bleibt JPEG) — NICHT auf PNG umschalten,
    sonst killt der ~16× langsamere PNG-Grab bei 4K die Render-Zeit. Die minimale
    Doppel-JPEG-Kompression (q92 → Downscale → q92) ist nach dem Verkleinern
    unsichtbar."""
    _ss = _render_ss(cfg.width, cfg.height)
    is_jpeg = (not cfg.transparent_background) and (cfg.frame_format or "jpeg").lower() == "jpeg"
    q = max(1, min(100, int(cfg.jpeg_quality or 92)))

    if cfg.transparent_background:
        raw = await page.screenshot(type="png", omit_background=True)
    elif is_jpeg:
        raw = await page.screenshot(type="jpeg", quality=q)
    else:
        raw = await page.screenshot(type="png")

    if _ss <= 1.0:
        return raw
    return _downscale_frame(raw, cfg.width, cfg.height,
                            cfg.transparent_background, q if is_jpeg else 0)


async def render_frame(
    cfg: AnimatorConfig,
    on_progress: Optional[Callable[[float, str], None]] = None,
    is_cancelled: Optional[Callable[[], bool]] = None,
) -> str:
    """v0.9.307 — Rendert EINEN statischen Frame als PNG (Tour-Map = ein
    Standbild vom Animator). Nutzt exakt dieselbe `_make_html`-Pipeline wie das
    Video → garantierte Optik-Parität (WYSIWYG), nur:
      - volle Strecke gezeichnet (advanceFrame auf letzten Punkt),
      - alle Fotos/Schilder/Overlays sichtbar (markerAnchor = 1.0),
      - feste Kamera (Bounds-Fit + pitch + bearing), kein Sweep/Spin/Keyframe,
      - kein ffmpeg, ein PNG.
    Gibt den Pfad zur PNG-Datei (cfg.output_path) zurück.
    """
    def emit(p: float, msg: str) -> None:
        if on_progress:
            try: on_progress(p, msg)
            except Exception: pass

    def check_cancel() -> None:
        if is_cancelled and is_cancelled():
            raise RenderCancelled("Vom User abgebrochen")

    emit(0.0, "Lade GPX-Datei …")
    _log.info("render_frame() start · GPX=%s · output=%s", cfg.gpx_path, cfg.output_path)
    if not cfg.transparent_background and not getattr(cfg, "use_osm", False) and (not cfg.mapbox_token or not cfg.mapbox_token.startswith("pk.")):
        _log.warning("Mapbox-Token fehlt/ungültig — Standbild-Render wird fehlschlagen.")

    raw_points, total_stats = core_parse_gpx(cfg.gpx_path)
    if cfg.point_count <= 0 or cfg.point_count >= len(raw_points):
        points = raw_points
    else:
        points = downsample(raw_points, max(2, cfg.point_count))
    if len(points) < 2:
        raise ValueError("GPX hat zu wenige Punkte für ein Standbild.")

    cum_dist = [0.0] + [points[i].dist_m for i in range(1, len(points))]
    cum_time = [0.0] + [points[i].elapsed_s for i in range(1, len(points))]
    if total_stats.duration_s == 0:
        cum_time = [(d / cum_dist[-1] if cum_dist[-1] else 0) for d in cum_dist]

    lons = [p.lon for p in points]; lats = [p.lat for p in points]
    bbox = (min(lons), min(lats), max(lons), max(lats))
    total_stats_dict = {
        "distance_m": total_stats.distance_m, "duration_s": total_stats.duration_s,
        "ascent_m": total_stats.ascent_m, "descent_m": total_stats.descent_m,
        "ele_min": total_stats.ele_min, "ele_max": total_stats.ele_max,
        "moving_time_s": getattr(total_stats, "moving_time_s", 0.0),
        "max_speed_kmh": getattr(total_stats, "max_speed_kmh", 0.0),
    }

    html = _make_html(cfg, points, cum_dist, cum_time, total_stats_dict, bbox)

    emit(0.1, "Karte rendern …")
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--use-angle=default", "--enable-webgl", "--ignore-gpu-blocklist", "--disable-gpu-sandbox",
                  # v0.9.387 — unterdrückt Chromecast/DIAL/mDNS-Geräte-Suche → kein macOS-„Lokales Netzwerk"-Dialog.
                  "--disable-background-networking", "--disable-features=MediaRouter,DialMediaRouteProvider",
                  "--no-first-run", "--no-default-browser-check"],
        )
        try:
            _dsf = _render_dsf(cfg.width, cfg.height)
            _ss = _render_ss(cfg.width, cfg.height)
            _vp_w = max(1, int(round(cfg.width / _dsf)))
            _vp_h = max(1, int(round(cfg.height / _dsf)))
            page = await browser.new_page(
                viewport={"width": _vp_w, "height": _vp_h},
                device_scale_factor=_dsf * _ss,
            )
            page.on("console", lambda m: _log.info("page.console [%s] %s", m.type, m.text))
            page.on("pageerror", lambda e: _log.error("page.pageerror: %s", e))
            await page.set_content(html)

            check_cancel()
            ready = False
            for _i in range(60):
                ready = await page.evaluate("window.isReady()")
                if ready: break
                await asyncio.sleep(0.5)
            if not ready:
                _log.warning("Standbild: Map nicht ready nach 30s — fahre fort.")
            # Auf Schild-Bilder warten (Foto-Karten), damit sie im Frame sind.
            if cfg.signs_show and cfg.signs:
                for _i in range(40):
                    try:
                        if await page.evaluate("window.__signsReady === true"): break
                    except Exception: break
                    await asyncio.sleep(0.25)
            if not cfg.transparent_background:
                await asyncio.sleep(3)  # Terrain-Tiles nachladen

            view = await page.evaluate("window.getInitialView()")
            if isinstance(view, dict):
                center = view.get("center") or [(bbox[0]+bbox[2])/2, (bbox[1]+bbox[3])/2]
                zoom = view.get("zoom", 12)
            else:
                center = [(bbox[0]+bbox[2])/2, (bbox[1]+bbox[3])/2]; zoom = 12

            # Volle Strecke + Endzustand: advanceFrame auf den letzten Punkt mit
            # fester Kamera (Bounds-Fit-Center/Zoom + cfg.pitch/cfg.bearing).
            last_idx = len(points) - 1
            await page.evaluate(
                f"window.advanceFrame({last_idx}, {float(cfg.bearing)}, "
                f"{float(center[0])}, {float(center[1])}, {float(zoom)}, {float(cfg.pitch)})"
            )
            # Den animierten „aktuelle-Position"-Punkt im Standbild ausblenden.
            await page.evaluate(
                "['dot-core','dot-glow'].forEach(id => { try { "
                "if (map.getLayer(id)) map.setLayoutProperty(id,'visibility','none'); } catch(_){} });"
            )
            try: await page.evaluate("window.waitForRender()")
            except Exception: pass

            shot = await _grab_still_png(page, cfg)
            # Schwarz-Frame-Schutz (wie im Video, Frame 0): triggerRepaint + neu greifen.
            for _bk in range(6):
                if cfg.transparent_background: break
                if _frame_black_ratio(shot) < 0.05: break
                _log.warning(f"Standbild ~schwarz — triggerRepaint + neu greifen ({_bk+1}/6) …")
                try: await page.evaluate("map.triggerRepaint && map.triggerRepaint()")
                except Exception: pass
                await asyncio.sleep(0.5)
                try: await page.evaluate("window.waitForRender()")
                except Exception: pass
                shot = await _grab_still_png(page, cfg)

            check_cancel()
            with open(cfg.output_path, "wb") as f:
                f.write(shot)
            _log.info("render_frame() fertig → %s (%d bytes)", cfg.output_path, len(shot))
            emit(1.0, "Fertig")
            return cfg.output_path
        finally:
            try: await browser.close()
            except Exception: pass


async def _grab_still_png(page, cfg: "AnimatorConfig") -> bytes:
    """PNG-Capture für das Standbild (immer PNG, SSAA-Downscale wie im Video)."""
    _ss = _render_ss(cfg.width, cfg.height)
    if cfg.transparent_background:
        raw = await page.screenshot(type="png", omit_background=True)
    else:
        raw = await page.screenshot(type="png")
    if _ss <= 1.0:
        return raw
    return _downscale_frame(raw, cfg.width, cfg.height, cfg.transparent_background, 0)


async def render(
    cfg: AnimatorConfig,
    on_progress: Optional[Callable[[float, str], None]] = None,
    on_preview: Optional[Callable[[str], None]] = None,
    is_cancelled: Optional[Callable[[], bool]] = None,
) -> str:
    """
    Hauptrenderer. Async, ruft Callbacks zur Kommunikation mit der UI:
    - on_progress(p:0..1, status_text:str)            → Fortschritt
    - on_preview(b64_jpeg:str)                        → kleines JPEG-Thumb der aktuell gerenderten Frame
    - is_cancelled() -> bool                          → wird vor jedem Frame geprüft;
                                                        liefert True → `RenderCancelled` wird geworfen

    Gibt Pfad zur Output-MP4 zurück.
    """
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
            img = Image.open(io.BytesIO(png_bytes))
            # Downscale auf max 1280×1280 (longest edge) — kompromiss aus
            # „sieht auf MacBook-Display gut aus" und „Bridge-base64 bleibt
            # unter ~250 KB pro Frame bei q72". 720 war zu klein und wirkte
            # auf Retina-Displays gepixelt.
            img.thumbnail((1280, 1280), Image.LANCZOS)
            # JPEG mag kein RGBA
            if img.mode in ("RGBA", "LA", "P"):
                img = img.convert("RGB")
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=72, optimize=False)
            b64 = base64.b64encode(buf.getvalue()).decode("ascii")
            on_preview(b64)
        except Exception as e:
            _log.debug("preview encode failed: %s", e)

    emit(0.0, "Lade GPX-Datei …")
    _log.info("render() start · GPX=%s · output=%s", cfg.gpx_path, cfg.output_path)
    if not cfg.transparent_background:
        # Token nur im Mapbox-Modus relevant. Im Alpha-Modus rendern wir ohne Karte.
        if not cfg.mapbox_token or not cfg.mapbox_token.startswith("pk."):
            _log.warning("Mapbox-Token fehlt oder ungültig — Mapbox-Render wird fehlschlagen.")
    # v0.9.156 — Multi-Track läuft in einem eigenen, isolierten Render-Pfad,
    # damit der battle-tested Single-Track-Code unverändert bleibt.
    if getattr(cfg, "tracks", None) and len(cfg.tracks) >= 2:
        return await _render_multi(cfg, emit, push_preview, check_cancel)
    raw_points, total_stats = core_parse_gpx(cfg.gpx_path)
    # Punkte-Anzahl auflösen:
    #   point_count == 0 oder >= n_raw  → alle Original-Punkte
    #   point_count <  2               → Minimum 2 (Linie braucht 2 Punkte)
    #   sonst                          → downsample auf exakt point_count
    if cfg.point_count <= 0 or cfg.point_count >= len(raw_points):
        target = len(raw_points)
        points = raw_points
    else:
        target = max(2, cfg.point_count)
        points = downsample(raw_points, target)
    _log.info("GPX geparst: %d Punkte → %d Punkte (point_count=%s), %.1f km, %ds, %.0f m↑ / %.0f m↓",
              len(raw_points), len(points), cfg.point_count or "all",
              total_stats.distance_m / 1000.0, total_stats.duration_s,
              total_stats.ascent_m, total_stats.descent_m)

    # cumulative arrays für downsampled points
    cum_dist = [0.0]
    cum_time = [0.0]
    for i in range(1, len(points)):
        # nutze einfach die schon kumulierten Werte
        cum_dist.append(points[i].dist_m)
        cum_time.append(points[i].elapsed_s)
    if total_stats.duration_s == 0:
        # Fallback: linear über Distanz
        cum_time = [(d / cum_dist[-1] * 1.0 if cum_dist[-1] else 0) for d in cum_dist]

    # Bbox aus den downsampled Track-Punkten — Mapbox in der Headless-Page
    # macht den Fit selbst (bounds + fitBoundsOptions im Map-Konstruktor).
    lons = [p.lon for p in points]
    lats = [p.lat for p in points]
    bbox = (min(lons), min(lats), max(lons), max(lats))

    total_stats_dict = {
        "distance_m": total_stats.distance_m,
        "duration_s": total_stats.duration_s,
        "ascent_m": total_stats.ascent_m,
        "descent_m": total_stats.descent_m,
        "ele_min": total_stats.ele_min,
        "ele_max": total_stats.ele_max,
        "moving_time_s": getattr(total_stats, "moving_time_s", 0.0),
        "max_speed_kmh": getattr(total_stats, "max_speed_kmh", 0.0),
    }

    # v0.9.41: bei stats_use_trim die Stats für den Trim-Bereich neu rechnen.
    # cum_dist + cum_time müssen relativ zum Trim-Start = 0 reskaliert werden
    # damit der Live-Counter im Render bei 0 m / 0:00 anfängt.
    # v0.9.53 (Marc-Klärung): Trim = Track-Position (0..1 von realem Track).
    # Render-Zeit ist FIX = dur + hold. Trim cuttet welcher Track-Abschnitt
    # während der Anim-Phase abgefahren wird. Hold hängt sich immer hinten dran.
    _trim_s = max(0.0, min(1.0, float(getattr(cfg, "render_start_anchor", 0.0))))
    _trim_e = max(0.0, min(1.0, float(getattr(cfg, "render_end_anchor", 1.0))))
    if _trim_e <= _trim_s:
        _trim_s, _trim_e = 0.0, 1.0
    _stats_start_idx = int(_trim_s * (len(points) - 1))
    _stats_end_idx   = int(_trim_e * (len(points) - 1))
    if getattr(cfg, "stats_use_trim", True) and (_trim_s > 0.0 or _trim_e < 1.0):
        # Distance/Time: kumulativ relativ zum Trim-Start
        _trim_dist_start = cum_dist[_stats_start_idx] if _stats_start_idx < len(cum_dist) else 0.0
        _trim_time_start = cum_time[_stats_start_idx] if _stats_start_idx < len(cum_time) else 0.0
        cum_dist = [max(0.0, d - _trim_dist_start) for d in cum_dist]
        cum_time = [max(0.0, t - _trim_time_start) for t in cum_time]
        # Trim-Subset für ele-Stats
        _trim_eles = [p.ele for p in points[_stats_start_idx:_stats_end_idx + 1] if p.ele is not None]
        _trim_dist = (cum_dist[_stats_end_idx] - cum_dist[_stats_start_idx]) if _stats_end_idx < len(cum_dist) else 0.0
        _trim_time = (cum_time[_stats_end_idx] - cum_time[_stats_start_idx]) if _stats_end_idx < len(cum_time) else 0.0
        # Ascent/Descent für den Trim-Bereich via core/gpx.compute-Helper
        try:
            from . import gpx as _gpx
            _asc, _dsc = _gpx._compute_ascent_descent([p.ele for p in points[_stats_start_idx:_stats_end_idx + 1]])
        except Exception:
            _asc = total_stats.ascent_m  # Fallback
            _dsc = total_stats.descent_m
        # Bewegungszeit + Max-Tempo für den Trim-Bereich auf VOLLER Auflösung
        # (raw_points-Subset nach Trim-Fraktion) — sonst glättet das Render-
        # Downsampling den Tempo-Peak weg.
        try:
            from . import gpx as _gpx
            _rs = int(_trim_s * (len(raw_points) - 1))
            _re = int(_trim_e * (len(raw_points) - 1))
            _trim_moving, _trim_max = _gpx.compute_moving_and_max(raw_points[_rs:_re + 1])
        except Exception:
            _trim_moving = getattr(total_stats, "moving_time_s", 0.0)
            _trim_max = getattr(total_stats, "max_speed_kmh", 0.0)
        total_stats_dict = {
            "distance_m": _trim_dist,
            "duration_s": _trim_time,
            "ascent_m": _asc,
            "descent_m": _dsc,
            "ele_min": min(_trim_eles) if _trim_eles else total_stats.ele_min,
            "ele_max": max(_trim_eles) if _trim_eles else total_stats.ele_max,
            "moving_time_s": _trim_moving,
            "max_speed_kmh": _trim_max,
        }
        _log.info("Stats (Trim %.0f%%-%.0f%%): %.1f km, %ds, %.0f m↑ / %.0f m↓",
                  _trim_s * 100, _trim_e * 100,
                  _trim_dist / 1000.0, _trim_time, _asc, _dsc)

    html = _make_html(cfg, points, cum_dist, cum_time, total_stats_dict, bbox)

    # v0.9.53 (Marc-Klärung): Trim-Range = welcher Abschnitt des REALEN Tracks
    # gerendert wird. Render-Output-Länge IMMER fix = intro + dur + hold Sekunden.
    # v0.9.59: intro_s erlaubt einen Hold am ANFANG (Marker steht am trim_start).
    intro_frames = max(0, int(getattr(cfg, "intro_s", 0))) * cfg.fps
    anim_frames = cfg.duration_s * cfg.fps
    hold_frames = cfg.hold_s * cfg.fps
    total_frames = intro_frames + anim_frames + hold_frames
    _trim_start = max(0.0, min(1.0, float(cfg.render_start_anchor)))
    _trim_end   = max(0.0, min(1.0, float(cfg.render_end_anchor)))
    if _trim_end <= _trim_start:
        _trim_start, _trim_end = 0.0, 1.0
    _trim_span = _trim_end - _trim_start
    _start_idx = int(_trim_start * (len(points) - 1))
    _end_idx   = int(_trim_end   * (len(points) - 1))
    _trim_n = max(1, _end_idx - _start_idx + 1)
    coords_per_frame = _trim_n / max(1, anim_frames)
    # v0.9.204 — Schild-Vorlauf reicht ins Intro. Im Intro friert der Marker am
    # trim_start ein (idx = _start_idx → markerAnchor = base_anchor). Der
    # Schild-FILTER bekommt aber pro Intro-Frame einen NEGATIV laufenden Anker
    # (base_anchor − (intro_frames − frame)/anim_frames), damit ein Schild mit
    # Vorlauf (`before`, aShow = A − before in Anim-Sekunden) seine Einblendung
    # über die letzte Intro-Sekunde abspielt statt erst am Track-Start
    # aufzuploppen. Rate 1/anim_frames pro Frame = 1/anim_s pro Sekunde, exakt
    # die Einheit von rzSignSecToAnchor → before=N s blendet N s vor Track-Start
    # ein. Hold-Seite unangetastet (greift gratis via aHide-Default 2.0).
    _sign_base_anchor = (_start_idx / (len(points) - 1)) if len(points) > 1 else 0.0
    # v0.9.253 — analog für die Hold-Phase: Schild-Anker läuft ÜBER das Track-
    # Ende hinaus weiter (gleiche Rate wie Anim), damit ein „Ausblenden nach N s"
    # das in den Hold fällt (aHide > end_anchor) auch wirklich erreicht wird.
    _sign_end_anchor = (_end_idx / (len(points) - 1)) if len(points) > 1 else 1.0

    # v0.9.143 (Marc-Bug „frei → Track-folgen"): Resolver Timeline-Anchor (0..1)
    # → Track-Punkt [lon, lat]. Spiegelt JS `trackIdxFromTimelineAnchor` +
    # `_trackPointAtAnchor`. Phasen: Intro = Stillstand am trim_start, Anim =
    # walk trim_start→end, Hold = Stillstand am trim_end. Wird an
    # interpolate_properties durchgereicht, damit ein gemischtes center-Segment
    # (ein KF frei, einer Track-folgen) glatt zwischen freier Position und
    # Track-Punkt pant statt einzufrieren + zu springen (WYSIWYG mit Preview).
    _ti_frac = intro_frames / max(1, total_frames)
    _tf_frac = (intro_frames + anim_frames) / max(1, total_frames)

    def _track_point_at(anchor):
        n = len(points)
        if n < 1:
            return None
        if n < 2:
            return [points[0].lon, points[0].lat]
        if anchor <= _ti_frac:
            marker_real = _trim_start
        elif anchor < _tf_frac:
            ap = (anchor - _ti_frac) / max(1e-4, _tf_frac - _ti_frac)
            marker_real = _trim_start + ap * (_trim_end - _trim_start)
        else:
            marker_real = _trim_end
        idx_tp = max(0, min(n - 1, round(marker_real * (n - 1))))
        return [points[idx_tp].lon, points[idx_tp].lat]

    emit(0.02, f"Karte laden ({cfg.map_style}) …")

    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        t_pw = time.time()
        try:
            browser = await p.chromium.launch(
                headless=True,
                args=["--use-angle=default", "--enable-webgl", "--ignore-gpu-blocklist", "--disable-gpu-sandbox",
                      # v0.9.387 — unterdrückt Chromecast/DIAL/mDNS-Geräte-Suche → kein macOS-„Lokales
                      # Netzwerk"-Zugriffs-Dialog beim Render (wir brauchen nur normales Internet für Tiles).
                      "--disable-background-networking", "--disable-features=MediaRouter,DialMediaRouteProvider",
                      "--no-first-run", "--no-default-browser-check"],
            )
        except Exception as e:
            _log.error("Playwright/Chromium-Start fehlgeschlagen: %s", e)
            _log.error("Hinweis: ggf. `playwright install chromium` in der App-Venv ausführen.")
            raise
        _log.info("Chromium gestartet in %.1fs", time.time() - t_pw)

        # v0.9.20 — DSF-skaliertes Viewport: Playwright bekommt CSS-Viewport
        # = cfg.size/dsf + device_scale_factor=dsf. Output-Canvas wird trotzdem
        # cfg.width × cfg.height physisch, aber Mapbox malt line-widths/blur/
        # font-sizes als CSS-Pixel → bei 4K mit DSF=2 wird eine 3.5-px-Linie
        # als 7 Device-Pixel im Output, matched die Retina-Preview-Optik.
        # v0.9.388 — Alpha/Transparent-Render: DSF & SSAA auf 1.0 erzwingen.
        # `_make_html_alpha` dimensioniert Body/SVG/Track-Projektion in
        # cfg.width×cfg.height CSS-Pixeln. Mit dem normalen DSF>1 (bei 4K =2) ist der
        # CSS-Viewport aber nur cfg.width/dsf → der Screenshot erfasste nur das linke
        # obere Viertel, rechts/unten platzierte Overlays lagen außerhalb des Bildes.
        # Bei DSF=1 gilt CSS-px == Device-px == cfg.width → volles, korrektes Bild.
        if cfg.transparent_background:
            _dsf = 1.0
            _ss = 1.0
        else:
            _dsf = _render_dsf(cfg.width, cfg.height)
            _ss = _render_ss(cfg.width, cfg.height)  # v0.9.286: SSAA gegen 4K-Flimmern
        _vp_w = max(1, int(round(cfg.width / _dsf)))
        _vp_h = max(1, int(round(cfg.height / _dsf)))
        _log.info("Playwright viewport=%dx%d CSS · DSF=%.2f · SSAA=%.2f · output=%dx%d device px",
                  _vp_w, _vp_h, _dsf, _ss, cfg.width, cfg.height)
        if _ss > 1.0:
            _log.info("SSAA aktiv (4K): Capture %dx%d → Lanczos-Downscale auf %dx%d",
                      int(_vp_w * _dsf * _ss), int(_vp_h * _dsf * _ss), cfg.width, cfg.height)
        page = await browser.new_page(
            viewport={"width": _vp_w, "height": _vp_h},
            device_scale_factor=_dsf * _ss,
        )

        # Console-Logs aus dem Headless-Chromium ins App-Log spiegeln —
        # dort landen z.B. Mapbox-Token-Fehler („Unauthorized") und WebGL-Errors.
        def _on_console(msg):
            try:
                _log.info("page.console [%s] %s", msg.type, msg.text)
            except Exception:
                pass

        def _on_pageerror(err):
            _log.error("page.pageerror: %s", err)

        page.on("console", _on_console)
        page.on("pageerror", _on_pageerror)

        await page.set_content(html)

        ready = False
        for _i in range(60):
            ready = await page.evaluate("window.isReady()")
            if ready:
                break
            await asyncio.sleep(0.5)
        if not ready:
            _log.warning("Map wurde innerhalb von 30s nicht ready — render läuft trotzdem weiter.")
        else:
            _log.info("Map ready nach ~%.1fs", _i * 0.5)

        # v0.9.189 — Auf geladene Schild-Bilder warten (Foto-Karten), damit sie
        # in JEDEM Frame da sind und nicht erst nach den ersten Frames auftauchen.
        if cfg.signs_show and cfg.signs:
            for _i in range(40):
                try:
                    if await page.evaluate("window.__signsReady === true"):
                        break
                except Exception:
                    break
                await asyncio.sleep(0.25)

        # Im Alpha-Modus gibt's kein Mapbox-Terrain → keine Wartezeit nötig.
        if not cfg.transparent_background:
            await asyncio.sleep(3)  # Terrain-Tiles nachladen

        # Center+Zoom aus Mapbox's Bounds-Fit auslesen — diese Werte nutzen wir
        # für advanceFrame() in jedem Frame (Map bleibt statisch über die
        # Animation, nur Bearing + Track wachsen).
        view = await page.evaluate("window.getInitialView()")
        if isinstance(view, dict):
            center = view.get("center") or [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]
            zoom = view.get("zoom", 12)
        else:
            center = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]
            zoom = 12
        # Defensive: ist center wirklich [lon, lat]?
        if not (isinstance(center, (list, tuple)) and len(center) == 2
                and all(isinstance(v, (int, float)) for v in center)):
            _log.warning("Unexpected center from Mapbox: %r → falling back to bbox-midpoint", center)
            center = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]
        _log.info("Initial view from Mapbox bounds-fit: center=[%.6f, %.6f] zoom=%.2f",
                  center[0], center[1], zoom)

        # v0.9.157 — WYSIWYG-Zoom-Korrektur. `cfg.zoom_correction` ist der vom
        # Frontend gelieferte Delta `correctedZoom(map,W,H) - map.getZoom()`
        # (= log2(min(W/pw, H/ph))). Der Render-CSS-Viewport ist cfg.size/dsf,
        # daher zusätzlich `- log2(dsf)`. interpolate_properties addiert das auf
        # den absoluten KF-Zoom (value_absolute), bevor der Offset gegen die
        # Fit-Base gebildet wird → frame_zoom = value_absolute + _zoom_abs_shift,
        # exakt wie der alte Classic-correctedZoom-Pfad. 0 wenn kein Wert kam.
        _zoom_abs_shift = float(getattr(cfg, "zoom_correction", 0.0) or 0.0) - (
            math.log2(_dsf) if _dsf and _dsf > 0 else 0.0
        )
        if _zoom_abs_shift:
            _log.info("Zoom-WYSIWYG-Korrektur: correction=%.3f dsf=%.2f → abs_shift=%.3f",
                      getattr(cfg, "zoom_correction", 0.0), _dsf, _zoom_abs_shift)

        # v0.9.19 — Tile-Cache-Prewarm: vor der eigentlichen Frame-Loop
        # 12 evenly-spaced Kamera-Positionen durchfliegen + auf `idle` warten.
        # Mapbox lädt damit die Tiles für alle Track-Abschnitte vorab in den
        # Browser-Cache. Die echte Frame-Loop fliegt anschließend durch
        # gecachte Tiles → per-Frame `idle` fires in ~50 ms statt ~1–3 s.
        # Kein Quality-Loss, nur initial ~5–15 s Vorlauf.
        # v0.9.24 — Alpha-Modus hat kein Mapbox → kein Tile-Cache zu prewarmen.
        # Skip statt späterer TypeError „prewarmTiles is not a function".
        prewarm_samples = []
        PREWARM_N = 0 if cfg.transparent_background else 12
        for i in range(PREWARM_N):
            tprog = i / max(1, PREWARM_N - 1)
            pitch_p, bearing_p, zoom_off_p, kf_c, _pos_p, _rot_p = _timeline.interpolate_properties(
                cfg.timeline_events, tprog,
                default_pitch=cfg.pitch, default_rotation=cfg.rotation,
                fit_zoom_base=zoom,  # v0.9.65: für van-Wijk-Flug-Kurve
                cinematic_flyto=cfg.cinematic_flyto,  # v0.9.84
                track_point_at=_track_point_at,  # v0.9.143
                zoom_abs_shift=_zoom_abs_shift,  # v0.9.157: WYSIWYG-Zoom-Korrektur
            )
            pw_pitch = pitch_p if pitch_p is not None else cfg.pitch
            pw_bearing = bearing_p if bearing_p is not None else (
                -10.0 + tprog * cfg.rotation
            )
            pw_zoom_off = zoom_off_p if zoom_off_p is not None else 0.0
            pw_zoom_off = max(-22.0, min(22.0, pw_zoom_off))
            pw_zoom = zoom + pw_zoom_off
            # Center: priority KF-center > camera_follow_track > bbox-center
            if kf_c:
                pw_lon, pw_lat = kf_c[0], kf_c[1]
            elif cfg.camera_follow_track and len(points) > 0:
                _idx = min(int(tprog * (len(points) - 1)), len(points) - 1)
                # v0.9.275 (Nutzer) — TrackPoint ist ein dataclass, NICHT subscriptable.
                # Dieselbe Falle wie v0.9.124 im Haupt-Loop, hier im Tile-Prewarm übersehen
                # → „'TrackPoint' object is not subscriptable" beim Render mit „Kamera folgt Track".
                pw_lon, pw_lat = points[_idx].lon, points[_idx].lat
            else:
                pw_lon, pw_lat = center[0], center[1]
            prewarm_samples.append([pw_bearing, pw_lon, pw_lat, pw_zoom, pw_pitch])
        if prewarm_samples:
            import json as _json
            emit(0.04, f"Tile-Cache vorwärmen ({PREWARM_N} Stützstellen) …")
            try:
                await page.evaluate(
                    f"window.prewarmTiles({_json.dumps(prewarm_samples)})"
                )
            except Exception as e:
                # Prewarm ist Best-Effort — bei Fehler einfach mit unprewarmer
                # Frame-Loop weitermachen (alte Geschwindigkeit, kein Render-Stop).
                _log.warning("Tile-Cache-Prewarm fehlgeschlagen, fahre fort: %s", e)

        emit(0.05, "Karte bereit, rendere Frames …")

        ffmpeg_bin = find_ffmpeg()
        _log.info("ffmpeg: %s", ffmpeg_bin)
        codec = (cfg.codec or "h264").lower()
        alpha = cfg.transparent_background
        # Drei Codec-Modi (Auswahl orthogonal zur Alpha-Frage):
        #   1) alpha       → ProRes 4444 MIT Alpha-Plane (yuva444p10le, .mov)
        #   2) prores      → ProRes 4444 OHNE Alpha (yuv444p10le, .mov) —
        #                    Master-Qualität für YouTube-Workflow
        #   3) h264/h265   → Standard MP4 (yuv420p, +faststart)
        # Wenn Alpha aktiv: User-Codec-Wahl wird auf prores forciert (UI sollte
        # das selbst tun, hier als Defensive). Output-Ext kommt von app.py.
        if alpha:
            ffmpeg_cmd = [
                ffmpeg_bin, "-y", "-loglevel", "error",
                "-f", "image2pipe", "-framerate", str(cfg.fps), "-i", "-",
                "-c:v", "prores_ks", "-profile:v", "4",
                "-pix_fmt", "yuva444p10le",
                "-vendor", "ap10",   # Apple-Vendor-ID (Premiere strenger als ffmpeg)
            ]
        elif codec in ("prores", "prores4444"):
            # ProRes 4444 ohne Alpha — Studio-Master für YouTube-Master-Cuts.
            # Sehr groß (~5–10× MP4), aber verlustfrei genug für Color-Grading.
            ffmpeg_cmd = [
                ffmpeg_bin, "-y", "-loglevel", "error",
                "-f", "image2pipe", "-framerate", str(cfg.fps), "-i", "-",
                "-c:v", "prores_ks", "-profile:v", "4",
                "-pix_fmt", "yuv444p10le",
                "-vendor", "ap10",
            ]
        else:
            vcodec = "libx265" if codec in ("h265", "hevc") else "libx264"
            # v0.9.19 — `-preset fast` statt `medium`: ~30–40 % schnellerer
            # Encode bei identischer Quality (CRF ist Constant-Rate-Factor,
            # ändert sich nicht mit Preset). File wird ca. 5–10 % größer.
            # v0.9.157 — ZURÜCK auf `yuv420p` (war v0.9.22–0.9.156 `yuv444p`).
            # Marc-Bug: „nach dem Rendern kann ich das Video nicht mehr im GPS
            # Studio abspielen". Ursache: H.264 High-4:4:4-Predictive (yuv444p
            # + `-profile:v high444`) bzw. H.265 main444 kann Apples
            # AVFoundation/WKWebView NICHT decodieren → das `<video>`-Element im
            # Result-View (und QuickTime) bleibt schwarz. `yuv420p` (High-
            # Profile) ist universell abspielbar (WKWebView, QuickTime, Web,
            # YouTube). Die 4:4:4-Farbtreue aus v0.9.22 bleibt über den
            # **ProRes-Codec** verfügbar (Editing-Master, oben). h264/h265 sind
            # die Deliverable-/Preview-Codecs → 4:2:0 ist hier korrekt.
            pix_fmt = "yuv420p"
            ffmpeg_cmd = [
                ffmpeg_bin, "-y", "-loglevel", "error",
                "-f", "image2pipe", "-framerate", str(cfg.fps), "-i", "-",
                # v0.9.245 — JPEG-Frames sind Full-Range (→ yuvj420p). Auf Standard-
                # Limited-Range (tv) normalisieren, damit der Output farblich
                # identisch zu den bisherigen PNG-Renders bleibt.
                *(["-vf", "scale=in_range=full:out_range=tv"]
                  if (cfg.frame_format or "jpeg").lower() == "jpeg" else []),
                "-c:v", vcodec, "-preset", (cfg.encoder_preset or "fast"), "-crf", str(cfg.crf),
                "-pix_fmt", pix_fmt, "-movflags", "+faststart",
            ]
            # hvc1-Tag für H.265 (sonst spielt QuickTime/Safari .mp4 nicht ab).
            if vcodec == "libx265":
                ffmpeg_cmd += ["-tag:v", "hvc1"]
        ffmpeg_cmd.append(cfg.output_path)
        _log.info("ffmpeg-Cmd: %s", " ".join(ffmpeg_cmd))
        ff = subprocess.Popen(ffmpeg_cmd, stdin=subprocess.PIPE,
                              stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                              creationflags=_WIN_NO_WINDOW)
        _ff_err_th, _ff_err_buf = _drain_stderr(ff.stderr)  # v0.9.388 — Pipe-Deadlock verhindern

        try:
            # Preview alle ~3 Frames pushen — bei 30fps reicht das für eine
            # flüssige Live-Vorschau und überlastet die Bridge nicht.
            preview_every = max(1, cfg.fps // 10)
            # Bearing-Sweep läuft GLEICHMÄSSIG über die GESAMTE Video-Länge
            # (anim + hold). Vorher gab's nach dem Track-Ende einen plötzlich
            # schnelleren Sweep (hardcoded +3°), was bei niedriger rotation
            # so wirkte als ob die Kamera erst dann anfängt zu schwenken.
            # v0.9.107 — Spin-Akkumulation entfernt. Drehung kommt jetzt
            # aus center.lng-Werten pro KF (= position-Lane).
            # Letzten applied padding cachen damit wir nicht jedem Frame
            # setPadding rufen wenn sich nichts ändert.
            _last_position_applied = None
            _ov_timed = _overlay_has_timing(cfg)  # v0.9.228 — Overlay-Zeitfenster aktiv?
            # ── Render-Timing-Diagnose (env RZ_RENDER_TIMING=1) ──────────────
            # Misst pro Frame, wo die Zeit draufgeht. Verändert den Render NICHT
            # (reine Messung). Summary wird am Ende geloggt. v0.9.245
            _rt = bool(os.environ.get("RZ_RENDER_TIMING"))
            _rt_acc = {"wait": 0.0, "tiles": 0.0, "shot": 0.0, "write": 0.0}
            _rt_frames = 0
            _rt_first = None
            if _rt:
                try:
                    _gpu = await page.evaluate(
                        "(()=>{try{const c=document.createElement('canvas');"
                        "const g=c.getContext('webgl')||c.getContext('experimental-webgl');"
                        "const d=g.getExtension('WEBGL_debug_renderer_info');"
                        "return d?g.getParameter(d.UNMASKED_RENDERER_WEBGL):g.getParameter(g.RENDERER);}"
                        "catch(e){return 'unknown';}})()"
                    )
                except Exception:
                    _gpu = "unknown"
                _log.warning("⏱ RENDER-TIMING aktiv | GPU-Renderer: %s | %dx%d @ %dfps | %d Frames",
                             _gpu, cfg.width, cfg.height, cfg.fps, total_frames)
            # v0.9.275 (Nutzer) — Trägheit beim „Kamera folgt Track": exponentielle Glättung
            # des Folge-Zentrums über die Frames. inertia 0 → k=1 (hart, wie bisher),
            # inertia 1 → k≈0.03 (sehr weich, Kamera zieht sanft nach).
            # v0.9.277 (Nutzer: „100 % zu wenig träge") — quadratische Kurve + tieferer Boden,
            # damit hohe Werte spürbar weicher ziehen (100 % ≈ k 0.005 → sehr träge).
            _foll_inertia = max(0.0, min(1.0, float(getattr(cfg, "camera_follow_inertia", 0.0))))
            _foll_k = max(0.005, (1.0 - _foll_inertia) ** 2)
            _foll_lon = None
            _foll_lat = None
            # v0.9.318 — Entkoppelte FreeCamera (gegen Berg-Hüpfen, Sandbox-validiert):
            # pro Keyframe-Anker die exakte 3D-Kamera (Pos+Orientierung) auslesen, im
            # Loop dazwischen interpolieren. Klassik/<2 KFs → unberührt (alter Pfad).
            _smooth_cam = bool(getattr(cfg, "smooth_camera_3d", False)) and os.environ.get("RZ_NOFAITHFUL") != "1"
            _use_faithful = False
            if _smooth_cam and total_frames > 2:
                _cam_kinds = ("center", "pitch", "zoom", "bearing", "position", "rotation")
                _anchors = {0.0, 1.0}
                for _ev in (cfg.timeline_events or []):
                    if _ev.get("kind") in _cam_kinds and _ev.get("value") is not None:
                        try:
                            _anchors.add(round(float(_ev.get("anchor", 0.0)), 6))
                        except Exception:
                            pass
                _anchors = sorted(a for a in _anchors if 0.0 <= a <= 1.0)
                if len(_anchors) >= 2:
                    def _idx_at_frame(_fr):
                        if _fr < intro_frames:
                            return _start_idx
                        if _fr < intro_frames + anim_frames:
                            _rel = int((_fr - intro_frames) * coords_per_frame)
                            return min(_start_idx + _rel, _end_idx)
                        return _end_idx
                    _kf_cam_list = []
                    for _a in _anchors:
                        _fr = round(_a * (total_frames - 1))
                        _pp, _bp, _zop, _kc, _kpos, _kr = _timeline.interpolate_properties(
                            cfg.timeline_events, _a,
                            default_pitch=cfg.pitch, default_rotation=cfg.rotation,
                            fit_zoom_base=zoom, cinematic_flyto=cfg.cinematic_flyto,
                            track_point_at=_track_point_at, zoom_abs_shift=_zoom_abs_shift,
                        )
                        _pf = _pp if _pp is not None else cfg.pitch
                        _bf = _bp if _bp is not None else (-10.0 + _a * cfg.rotation)
                        _zo = max(-22.0, min(22.0, _zop if _zop is not None else 0.0))
                        _idx = _idx_at_frame(_fr)
                        if _kc:
                            _lo, _la = _kc[0], _kc[1]
                        elif cfg.camera_follow_track and _idx < len(points):
                            _lo, _la = points[_idx].lon, points[_idx].lat
                        else:
                            _lo, _la = center[0], center[1]
                        _kf_cam_list.append({
                            "t": _a, "lng": _lo, "lat": _la,
                            "zoom": zoom + _zo, "pitch": _pf, "bearing": _bf,
                        })
                    await page.evaluate("(cams)=>window.__camPrepFaithful(cams)", _kf_cam_list)
                    _use_faithful = True
                    if _rt:
                        _log.info("🎥 entkoppelte FreeCamera aktiv (%d Keyframes)", len(_kf_cam_list))
            for frame in range(total_frames):
                # Cancel-Check VOR jeder teuren Frame-Operation
                check_cancel()
                # v0.9.71 (Marc-Bug): timeline_progress MUSS die Zeit-Position
                # (= 0..1 über gesamtes Output-Video) sein, damit der Render zur
                # Preview passt. Vorher wurde timeline_progress per Phase auf
                # [0, _trim_start] / [_trim_start, _trim_end] / [_trim_end, 1]
                # gemappt — das war die TRACK-Position, NICHT die Zeit. KFs
                # liegen aber auf der Timeline (= Zeit-Achse), nicht auf dem
                # Track. Preview rechnet timeline_progress = elapsed/totalMs ✓
                # — Render muss analog rechnen.
                #
                # idx (Marker-Position auf realem Track) bleibt per Phase
                # gemappt: INTRO = stillstand am _start_idx, ANIM = walk,
                # HOLD = stillstand am _end_idx.
                if total_frames > 1:
                    timeline_progress = frame / (total_frames - 1)
                else:
                    timeline_progress = 0.0
                if frame < intro_frames:
                    idx = _start_idx
                elif frame < intro_frames + anim_frames:
                    anim_frame = frame - intro_frames
                    rel = int(anim_frame * coords_per_frame)
                    idx = min(_start_idx + rel, _end_idx)
                else:
                    idx = _end_idx
                pitch_p, bearing_p, zoom_off_p, kf_center, kf_position, kf_rotation = _timeline.interpolate_properties(
                    cfg.timeline_events, timeline_progress,
                    default_pitch=cfg.pitch,
                    default_rotation=cfg.rotation,
                    fit_zoom_base=zoom,
                    cinematic_flyto=cfg.cinematic_flyto,
                    track_point_at=_track_point_at,
                    zoom_abs_shift=_zoom_abs_shift,  # v0.9.157: WYSIWYG-Zoom-Korrektur
                )
                pitch_f = pitch_p if pitch_p is not None else cfg.pitch
                bearing = bearing_p if bearing_p is not None else (
                    -10.0 + timeline_progress * cfg.rotation
                )
                zoom_off = zoom_off_p if zoom_off_p is not None else 0.0
                # v0.7.9: Sanity-Clamp gegen runaway zoom_offset.
                # v0.8.17: Range stark aufgeweitet (war -5..+6) — Slider im
                # KF-Editor erlaubt absoluten Mapbox-Zoom 0–22, d.h. der Offset
                # vom Auto-Fit kann größer werden als +6 wenn der Auto-Fit
                # niedrig liegt (z.B. großer Track, Auto-Fit-Zoom = 10, User
                # will Detail-Ansicht auf Zoom 18 → Offset = +8). Mapbox selbst
                # clamped intern auf 0–22 beim render → keine echte Gefahr.
                zoom_off = max(-22.0, min(22.0, zoom_off))
                frame_zoom = zoom + zoom_off
                # v0.8.7: Wenn Keyframe einen expliziten center hat, nutze ihn
                # statt Track-Punkt (Marc-Wunsch: freie Karten-Position pro
                # Keyframe). Sonst:
                # v0.8.17: Classic-Modus respektiert `camera_follow_track` — wenn
                # an, folgt die Kamera dem aktuellen Track-Punkt. Sonst bleibt
                # sie auf dem statischen Bbox-Center (was bis v0.8.16 Default war).
                if kf_center:
                    frame_lon = kf_center[0]
                    frame_lat = kf_center[1]
                elif cfg.camera_follow_track and idx < len(points):
                    # v0.9.124 — TrackPoint ist ein dataclass, NICHT subscriptable.
                    _tlon = points[idx].lon
                    _tlat = points[idx].lat
                    # v0.9.275 (Nutzer) — Trägheit: Folge-Zentrum glätten (gegen GPS-Wackeln).
                    if _foll_lon is None or _foll_k >= 0.999:
                        _foll_lon, _foll_lat = _tlon, _tlat
                    else:
                        _foll_lon += (_tlon - _foll_lon) * _foll_k
                        _foll_lat += (_tlat - _foll_lat) * _foll_k
                    frame_lon = _foll_lon
                    frame_lat = _foll_lat
                else:
                    frame_lon = center[0]
                    frame_lat = center[1]
                # v0.9.136 — Welt-Drehung-Lane abgeschafft (Insta360-Modell):
                # die Drehung steckt jetzt direkt in der abgewickelten
                # center.lng (interpolate_properties + van-Wijk-Entkopplung in
                # timeline.py). frame_lon kann daher Werte > 180 / < -180
                # annehmen (mehrere Umdrehungen) — Mapbox setCenter normalisiert
                # das beim Rendern automatisch, Frame-für-Frame entsteht so eine
                # gleichmäßige Erd-Drehung. Kein additiver kf_rotation-Offset
                # mehr (kf_rotation ist None). Position/Padding nutzt _zf_frame
                # weiterhin als Welt→Track Fade-Out.
                _zf_frame = max(0.0, min(1.0, (8.0 - frame_zoom) / 4.0))
                # v0.9.123 — Padding mit zoomFade gewichten (additive Welt-X/Y).
                if _zf_frame > 0 and kf_position is not None:
                    sx_eff = float(kf_position.get("x", 0)) * _zf_frame
                    sy_eff = float(kf_position.get("y", 0)) * _zf_frame
                    pos_key = (round(sx_eff, 2), round(sy_eff, 2))
                    if pos_key != _last_position_applied:
                        pad_js = (
                            "(() => { const vp = map.getCanvas(); "
                            f"const vpW = (vp && vp.clientWidth)  || {cfg.width}; "
                            f"const vpH = (vp && vp.clientHeight) || {cfg.height}; "
                            f"const sx = {sx_eff}; const sy = {sy_eff}; "
                            "const padX = Math.abs(sx) / 100 * vpW; "
                            "const padY = Math.abs(sy) / 100 * vpH; "
                            "map.setPadding({ "
                            "top: sy < 0 ? padY : 0, "
                            "bottom: sy > 0 ? padY : 0, "
                            "left: sx > 0 ? padX : 0, "
                            "right: sx < 0 ? padX : 0 }); })()"
                        )
                        try: await page.evaluate(pad_js)
                        except Exception: pass
                        _last_position_applied = pos_key
                elif _zf_frame <= 0 and _last_position_applied not in (None, (0, 0)):
                    # Track-Zoom: padding zurück auf 0
                    try: await page.evaluate("map.setPadding({top:0,bottom:0,left:0,right:0})")
                    except Exception: pass
                    _last_position_applied = (0, 0)

                _rt_t = time.perf_counter() if _rt else 0.0
                if _use_faithful:
                    # Daten (Linie/Punkt/Overlays) ohne Kamera, dann entkoppelte FreeCamera.
                    await page.evaluate(
                        f"window.advanceFrame({idx}, {bearing}, {frame_lon}, {frame_lat}, {frame_zoom}, {pitch_f}, false)"
                    )
                    await page.evaluate(f"window.__camFaithful({timeline_progress})")
                else:
                    await page.evaluate(
                        f"window.advanceFrame({idx}, {bearing}, {frame_lon}, {frame_lat}, {frame_zoom}, {pitch_f})"
                    )
                # v0.9.228 — Overlay-Zeitfenster (Nutzer): Box pro Video-Sekunde
                # ein-/ausblenden. Nur wenn überhaupt ein Fenster gesetzt ist.
                if _ov_timed:
                    await page.evaluate(
                        f"window.__overlayTiming && window.__overlayTiming({frame / max(1, cfg.fps):.3f})"
                    )
                # v0.9.204 — Intro: Schild-Filter mit negativem Anker übersteuern,
                # damit ein Schild-Vorlauf (`before`) ins Intro reicht. advanceFrame
                # hat den Filter gerade auf base_anchor gesetzt; hier overriden wir
                # NUR den Schild-Filter (Marker/Dot bleiben am trim_start eingefroren).
                if frame < intro_frames and anim_frames > 0:
                    _sign_intro_anchor = _sign_base_anchor - (intro_frames - frame) / anim_frames
                    await page.evaluate(
                        f"window.__signsAnchorFilter && window.__signsAnchorFilter({_sign_intro_anchor})"
                    )
                # v0.9.253 — Hold: Schild-Anker über das Track-Ende hinaus
                # weiterlaufen lassen (gleiche Rate), sonst friert er bei
                # end_anchor ein und „Ausblenden nach N s" im Hold greift nie.
                elif frame >= intro_frames + anim_frames and anim_frames > 0:
                    _sign_hold_anchor = _sign_end_anchor + (frame - intro_frames - anim_frames + 1) / anim_frames
                    await page.evaluate(
                        f"window.__signsAnchorFilter && window.__signsAnchorFilter({_sign_hold_anchor})"
                    )
                await page.evaluate("window.waitForRender()")
                # v0.9.286 (Marc-Bug: erster Frame teils schwarz) — Frame 0 extra
                # absichern: direkt nach dem instant `jumpTo` kann `areTilesLoaded()`
                # spurious `true` liefern (Tile-Requests des Startbilds sind noch
                # nicht registriert) → der Retry-Loop unten bräche sofort ab und der
                # Screenshot würde schwarz/halbleer. Einmal kurz settlen + neu
                # rendern, damit der Loop echte Tile-Stati sieht. Nur Frame 0 →
                # einmalig ~0,4 s, kein Quality-Loss.
                if frame == 0:
                    await asyncio.sleep(0.4)
                    try: await page.evaluate("window.waitForRender()")
                    except Exception: pass
                if _rt:
                    _now = time.perf_counter(); _rt_acc["wait"] += _now - _rt_t; _rt_t = _now
                # v0.9.125 — Smart-Tile-Retry. Bei großen Zoom-Sprüngen (z.B.
                # Welt → Track) kann der 5s-Hard-Cap von waitForRender zuschnappen
                # bevor Mapbox alle Tiles geladen hat → weiße Flecken im Frame.
                # Marc-Wunsch: prüfen und gezielt nochmal warten.
                # `map.areTilesLoaded()` gibt direkt zurück ob noch was in-flight ist.
                # Max 3 Versuche, dann Frame mit Glitch akzeptieren (besser als hängen).
                tile_retries = 0
                while tile_retries < 3:
                    try:
                        tiles_ok = await page.evaluate("map.areTilesLoaded()")
                    except Exception:
                        tiles_ok = True  # API fehlt → akzeptieren
                    if tiles_ok:
                        break
                    tile_retries += 1
                    _log.warning(
                        f"Frame {frame + 1}: Tiles fehlen, Retry {tile_retries}/3 — warte 2 s …"
                    )
                    await asyncio.sleep(2.0)
                    try:
                        await page.evaluate("window.waitForRender()")
                    except Exception: pass
                if _rt:
                    _now = time.perf_counter(); _rt_acc["tiles"] += _now - _rt_t; _rt_t = _now
                # Bei Alpha-Modus: omit_background=True → PNG mit transparentem
                # Hintergrund (sonst füllt Chromium den body mit Weiß).
                # ffmpeg's image2pipe-Decoder erkennt RGBA-PNGs automatisch.
                shot = await _grab_frame(page, cfg)
                # v0.9.286 (Marc-Bug: erster Frame teils schwarz) — robuster
                # Schwarz-Frame-Schutz für die ersten Frames. `areTilesLoaded()`
                # kann nach dem Start-Sprung `true` melden (Kacheln im Cache durchs
                # Prewarm), obwohl die Satelliten-Kacheln noch NICHT gemalt sind →
                # der Screenshot ist großflächig schwarz. Wir messen den Schwarz-
                # Anteil direkt am Bild und greifen neu, bis er sauber ist (max 8×1s).
                # Nur Frame 0–2 und nicht im Alpha-Modus (transparenter Hintergrund
                # liest sich sonst als „schwarz" → würde endlos retrien).
                if frame <= 2 and not cfg.transparent_background:
                    # ECHTE URSACHE (v0.9.286, Log-bestätigt): bei den statischen
                    # Intro-Frames (Stillstand, identische Kamera) macht Mapbox KEIN
                    # Repaint → der WebGL-Buffer bleibt auf der unfertigen Erst-
                    # Bemalung (noch nicht geladene = schwarze Kacheln) eingefroren.
                    # Bloßes Neu-Greifen half NICHT (8× kein Effekt im Log), weil
                    # immer derselbe eingefrorene Buffer abgegriffen wurde. Erst ein
                    # erzwungenes `triggerRepaint()` malt den Buffer mit den inzwischen
                    # geladenen Kacheln neu. Schwelle 5 % (sauber ≈ 0 %, kaputt >10 %).
                    for _bk in range(6):
                        _bratio = _frame_black_ratio(shot)
                        if _bratio < 0.05:
                            break
                        _log.warning(
                            f"Frame {frame + 1}: ~{int(_bratio * 100)}% schwarz "
                            f"(Buffer eingefroren) — triggerRepaint + neu greifen ({_bk + 1}/6) …"
                        )
                        try:
                            await page.evaluate(
                                "map.triggerRepaint && map.triggerRepaint()"
                            )
                        except Exception:
                            pass
                        await asyncio.sleep(0.5)
                        try:
                            await page.evaluate("window.waitForRender()")
                        except Exception:
                            pass
                        shot = await _grab_frame(page, cfg)
                if _rt:
                    _now = time.perf_counter(); _rt_acc["shot"] += _now - _rt_t; _rt_t = _now
                ff.stdin.write(shot)
                if _rt:
                    _now = time.perf_counter(); _rt_acc["write"] += _now - _rt_t
                    _rt_frames += 1
                    if _rt_first is None:
                        _rt_first = sum(_rt_acc.values())  # Frame 0 = inkl. Erst-Tile-Last
                # Live-Preview ans UI durchreichen (jeden N-ten Frame)
                if frame % preview_every == 0:
                    push_preview(shot)
                # 0.05–0.92 für die Render-Phase, 0.92–1.0 für ffmpeg-Finalize
                emit(0.05 + 0.87 * (frame + 1) / total_frames,
                     f"Frame {frame + 1} / {total_frames}")
            if _rt and _rt_frames > 0:
                _tot = sum(_rt_acc.values())
                _lines = ["", "════════ RENDER-TIMING-REPORT ════════",
                          f"Frames gemessen: {_rt_frames}  |  Auflösung: {cfg.width}x{cfg.height} @ {cfg.fps}fps",
                          f"Gesamt-Render-Zeit (nur Frame-Loop): {_tot:.1f}s  →  {_tot/_rt_frames*1000:.0f} ms/Frame im Schnitt",
                          f"Frame 0 (mit Erst-Tile-Last): {(_rt_first or 0):.2f}s",
                          "── Phasen (Summe / Anteil / ø pro Frame) ──"]
                for _k, _label in [("wait", "Kamera+Render-Settle (waitForRender)"),
                                   ("tiles", "Tile-Warten/Retries (areTilesLoaded)"),
                                   ("shot", "Screenshot (PNG-Encode+Transfer)"),
                                   ("write", "An ffmpeg pipen")]:
                    _v = _rt_acc[_k]; _pct = 100 * _v / _tot if _tot else 0
                    _lines.append(f"  {_label:<40} {_v:7.1f}s  {_pct:5.1f}%  {_v/_rt_frames*1000:6.0f} ms")
                _lines.append("══════════════════════════════════════")
                _log.warning("\n".join(_lines))
        except RenderCancelled:
            _log.info("Render abgebrochen — ffmpeg wird beendet und Output-Datei gelöscht.")
            try:
                ff.stdin.close()
            except Exception:
                pass
            try:
                ff.terminate()
                ff.wait(timeout=3)
            except Exception:
                try:
                    ff.kill()
                except Exception:
                    pass
            # Halb-fertige Datei aufräumen
            try:
                Path(cfg.output_path).unlink(missing_ok=True)  # type: ignore[arg-type]
            except Exception:
                pass
            try:
                await browser.close()
            except Exception:
                pass
            raise
        finally:
            try:
                ff.stdin.close()
            except Exception:
                pass

        emit(0.92, "ffmpeg finalisiert (+faststart, kann etwas dauern) …")
        ff.wait()
        try: _ff_err_th.join(timeout=2)   # v0.9.388 — stderr-Drain-Thread abschließen
        except Exception: pass
        if ff.returncode != 0:
            err = bytes(_ff_err_buf).decode(errors="replace")
            _log.error("ffmpeg returncode=%s — stderr:\n%s", ff.returncode, err)
            raise RuntimeError(f"ffmpeg fehlgeschlagen (returncode={ff.returncode}): {err.strip()[:500]}")
        else:
            # Auch im Erfolgsfall stderr loggen falls Warnungen drin sind
            try:
                err = bytes(_ff_err_buf).decode(errors="replace").strip()
                if err:
                    _log.info("ffmpeg stderr (info-level): %s", err[:1500])
            except Exception:
                pass

        # Output-Datei verifizieren
        try:
            sz = Path(cfg.output_path).stat().st_size
            _log.info("Output OK: %s (%.1f MB)", cfg.output_path, sz / 1_000_000)
        except Exception as e:
            _log.warning("Konnte Output-Datei nicht stat()en: %s", e)

        await browser.close()

    emit(1.0, "Fertig.")
    return cfg.output_path
