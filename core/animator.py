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
import time

# v0.9.274 (Nutzer-Bug) — Windows: ffmpeg ohne sichtbares Konsolenfenster starten.
_WIN_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0

# ffmpeg-Lebenslauf (Teildatei `.rzpart`, stderr-Drain, Tod-Diagnose, Warten mit
# Zeitgrenze) lebt seit 22.08.2026 EINMAL in core/frame_driver.py — vorher hier,
# im Mehrspur-Pfad und im Höhen-Animator je eine Kopie. Die Namen bleiben als
# Aliasse, weil Tests und Skripte sie kennen.
from .frame_driver import (TEIL as _TEIL, teildatei as _teildatei,   # noqa: E402, F401
                           fertigstellen as _fertigstellen, teil_wegraeumen as _teil_wegraeumen,
                           drain_stderr as _drain_stderr, ffmpeg_gestorben as _ffmpeg_gestorben)

from .frame_driver import muxer_fuer as _muxer_fuer   # noqa: E402, F401  (Tests importieren es von hier)


from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from PIL import Image



class RenderCancelled(Exception):
    """Wird vom Render geworfen, wenn `is_cancelled()` True liefert. Worker
    behandelt das als sauberen Abbruch (nicht als Fehler)."""
    pass

# Wir nutzen das Root-Logger-Setup aus `core.logger` (wird von app.py beim Start
# aufgerufen). Hier nur den Modul-Logger anlegen — wenn nichts konfiguriert ist
# (z.B. CLI-Test) fällt das auf den Default-Handler zurück.
_log = logging.getLogger("animator")


_FFMPEG_FILTER: dict = {}


def find_ffmpeg_mit(filtername: str) -> Optional[str]:
    """02.10.2026 — ein ffmpeg, das `filtername` kann (HDR braucht zscale; Homebrews ffmpeg hat es nicht, das
    gebündelte imageio-ffmpeg schon). Reihenfolge wie find_ffmpeg, dann das gebündelte. None, wenn keins."""
    kandidaten = [find_ffmpeg()]
    try:
        import imageio_ffmpeg
        kandidaten.append(imageio_ffmpeg.get_ffmpeg_exe())
    except Exception:  # noqa: BLE001
        pass
    for exe in kandidaten:
        key = (exe, filtername)
        if key not in _FFMPEG_FILTER:
            try:
                r = subprocess.run([exe, "-hide_banner", "-filters"], capture_output=True, text=True, timeout=20)
                _FFMPEG_FILTER[key] = any(z.split()[1:2] == [filtername] for z in r.stdout.splitlines() if z.strip())
            except Exception:  # noqa: BLE001
                _FFMPEG_FILTER[key] = False
        if _FFMPEG_FILTER[key]:
            return exe
    return None


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
    raise RuntimeError(_i18n.t_aktiv(
        "animator.err_ffmpeg_fehlt",
        "ffmpeg nicht gefunden — weder im System-PATH noch als gebündeltes Binary. "
        "Bitte einmalig installieren: `brew install ffmpeg` (macOS), "
        "https://ffmpeg.org/download.html (Windows), `apt install ffmpeg` (Linux)."
    ))

from .gpx import (parse_gpx as core_parse_gpx, downsample, TrackPoint, resample,
                  unsichtbare_bereiche as core_gpx_bereiche, laufpunkt_aus_bereiche as core_gpx_dot,
                  etappen_reihen as core_gpx_etappen, etappen_stats as core_gpx_etappen_stats,
                  arten_stats as core_gpx_arten_stats)
from . import dateischutz as _ds  # 14.09.2026: jeder Datei-Eingriff geprüft + gesichert
from . import i18n as _i18n
from . import zeitzone as _zeit   # 11.09.2026 — Datum/Uhrzeit in den Einblendungen


# 03.09.2026 — Die Stilliste lebt in core/mapstyles.py (Mapbox, MapTiler,
# staatliche Orthofotos, OpenFreeMap, OSM-Raster). `MAP_STYLES` bleibt als
# Mapbox-Teilmenge für ältere Aufrufer erhalten.
from . import mapstyles as _mapstyles
from . import tileproxy as _tileproxy
MAP_STYLES = _mapstyles.MAP_STYLES

# Kachel-Zwischenspeicher für den kopflosen Render (app.py setzt Pfad + Grenze).
# None = aus (Tests). Mapbox-Kacheln werden bewusst NICHT gespeichert — nur die
# Quellen, die es ausdrücklich erlauben (MapTiler) oder verlangen (OSM ≥ 7 Tage).
TILE_CACHE_DIR: Optional[Path] = None
TILE_CACHE_MAX_MB: int = 2048


def _zoff_on(cfg) -> bool:
    """`line-z-offset` gibt es nur in Mapbox GL v3. MapLibre lehnt die Eigenschaft
    ab und legt die Ebene dann gar nicht an — dort drapiert es die Linie ohnehin
    aufs Gelände. Also nur mit Mapbox-Engine UND Gelände."""
    return bool(cfg.enable_terrain and getattr(cfg, "map_engine", "mapbox") == "mapbox")


SIGN_ZOOM_BASE = 4.8 ** (1 / 12)   # Schildgröße: 0,5 bei Zoom 8 → 2,4 bei Zoom 20 (siehe sign_draw.js)


@dataclass
class AnimatorConfig:
    gpx_path: str
    output_path: str
    mapbox_token: str
    map_style: str = "satellite"        # Schlüssel in core/mapstyles.STYLES
    # 03.09.2026 — MapTiler-Schlüssel (Einstellungen → Kartenanbieter). Leer = die
    # MapTiler-Stile weichen auf „Satellit (kostenlos)" aus.
    maptiler_key: str = ""
    # Wird von _make_html aus dem aufgelösten Stil gesetzt: "mapbox" | "maplibre".
    # Entscheidet über Bibliothek, Token und Mapbox-only-Eigenschaften.
    map_engine: str = "mapbox"
    map_spec: Optional[dict] = None     # Ergebnis von mapstyles.resolve() (Log, Vermerke)
    # Lokale Kachel-Weiche der App (core/tileproxy.py); leer = direkt zum Dienst.
    tile_proxy_base: str = ""
    # v0.9.391 — OSM-Fallback (nur Tour-Map/Standbild ohne Mapbox-Token): Karte
    # aus OSM-Raster-Kacheln statt Mapbox-Style. Terrain/Pitch sind bei Raster
    # flach → app.py erzwingt im OSM-Modus enable_terrain=False, pitch=0.
    use_osm: bool = False
    duration_s: int = 12
    hold_s: int = 5
    # v0.9.59 (Nutzer-Wunsch): Intro-Hold analog zu hold_s, aber AM ANFANG.
    # Marker steht intro_s Sekunden am trim_start bevor die Anim-Phase beginnt.
    # Erlaubt langsame Setup-Shots/Kamera-Aufzüge vor dem Track-Start.
    intro_s: float = 0.0
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
    # v0.9.412 — Snapshot (Animator: aktueller Vorschau-Frame als PNG) + Kamera-
    # Übernahme (Tour-Map „aus Animator-Blickwinkel"). Ist `snapshot_center` gesetzt,
    # nutzt render_frame diese EXAKTE Kamera aus der Live-Vorschau statt Bounds-Fit.
    # `snapshot_anchor` (0..1) = Marker-Position: gesetzt → Teil-Track + laufender
    # Punkt (Animator-Frame); None → volle Strecke, Punkt aus (Tour-Map-Standbild).
    snapshot_center: Optional[list] = None      # [lon, lat]
    snapshot_zoom: Optional[float] = None
    snapshot_bearing: Optional[float] = None
    snapshot_pitch: Optional[float] = None
    snapshot_anchor: Optional[float] = None      # 0..1 Marker-Position; None = volle Strecke
    snapshot_time_s: float = 0.0                 # für Overlay-Zeitfenster
    # v0.9.417 — Snapshot bei „ganze Route zeigen" (Vorschau-Toggle preview_full_track):
    # GESAMTE Track-Linie zeichnen, Punkt bleibt an der Scrubber-Position → Snapshot 1:1
    # zur Vorschau (voller Track sichtbar statt nur bis zum Scrubber).
    snapshot_full_track: bool = False
    # v0.9.415 — Interaktiver HTML-Export der Tour-Karte fürs Blog. Dieselbe
    # _make_html-Pipeline wie Video/Standbild (identische Karte/Track/Pins/
    # Schilder via __rzDrawSign → echtes WYSIWYG), aber: KEIN Playwright/Screenshot,
    # sondern eine eigenständige HTML-Seite die im Besucher-Browser läuft, beim
    # Laden EINMAL auf die Vorschau-Kamera + volle Strecke springt (advanceFrame)
    # und danach frei zoom-/pan-bar bleibt. `use_osm` liefert die tokenfreie
    # OSM-Karte; die drei osm_*-Felder erlauben den gewählten OSM-Kachel-Stil.
    interactive_export: bool = False
    osm_tiles_url: Optional[str] = None          # {z}/{x}/{y}(+{s}); None = Standard-OSM
    osm_max_zoom: int = 19
    osm_attribution: Optional[str] = None        # Plain-Attribution für die Kachelquelle
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
    # 04.09.2026 — Luftbild-Optik, nur „Satellit (kostenlos)" (mapstyles.ORTHO_ADJUST_DEFAULT)
    ortho_sat: float = 25.0
    ortho_con: float = 8.0
    ortho_bri: float = 0.0
    ortho_hue: float = 0.0
    # 05.09.2026 — Karten-Optik für Raster-/Vektorkarten (nicht Luftbilder), Standard 0 = Stil wie geliefert
    map_sat: float = 0.0
    map_con: float = 0.0
    map_bri: float = 0.0
    map_hue: float = 0.0
    map_sharp: float = 0.0              # 07.09.2026 — Schärfe (Unschärfemaske auf der Leinwand), 0 = aus
    ortho_relief: float = 0.0          # 17.09.2026 — Relief (Hillshade) über den Luftbildern, nur „Satellit (kostenlos)"
    map_haze: float = 0.0               # 17.09.2026 — Dunst entfernen (Schwarzpunkt je Kanal auf der Leinwand), 0 = aus
    # 07.09.2026 (Marc, Konzept Kartenquellen §6) — Quellenzeile: "voll" = alle Nennungen im Bild (MapLibre baut sie
    # aus den Quellen), "kurz" = Kurznamen + «bearbeitet» + Link zu den vollständigen Angaben (attrib_link)
    attrib_mode: str = "voll"
    attrib_link: str = ""
    # 05.09.2026 — Sternenhimmel hinter der Weltkugel (MapLibre; Mapbox bringt seinen eigenen mit)
    stars_enabled: bool = True
    stars_density: float = 50.0
    stars_size: float = 50.0
    stars_twinkle: bool = True
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
    # 29.09.2026 — Spur glätten (Meter, 0 = aus), Spiegel der Vorschau (rzSpurGlaetten)
    spur_glaetten_m: float = 0.0
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
    # 23.08.2026 — Farbe je Etappe eines zusammengeführten Tracks: {"1": "#rrggbb", …}
    tour_colors: dict = field(default_factory=dict)
    show_overlays: bool = True          # Master-Schalter (Backwards-Compat)
    # 30.09.2026 — Einblendungen als Container (docs/OVERLAY-CONTAINER.md): Der Web-Karten-Export
    # bekommt sie als fertiges HTML aus der Vorschau (module.js _ctExportHtml), dazu die Verläufe.
    container_html: str = ""
    container_verlauf: dict = field(default_factory=dict)
    # 24.09.2026 (IDEAS §67 Q11) — Logbuch-Bereiche mit Anzeige im Video:
    # [{von, bis (Anteil 0..1 der Punkte), deckkraft}] — 0 = Linie unsichtbar
    # (überspringen), 0,25 = blass. Raffen/Überspringen-Tempo steckt in pace_map.
    logbuch_masken: list = field(default_factory=list)
    # 24.09.2026 (IDEAS §67 Q16) — Logbuch-Bereiche [{art, t0, t1}] für Zahlen je Bewegungsart
    bewegung_bereiche: list = field(default_factory=list)
    codec: str = "h264"                 # "h264" oder "h265" (HEVC, kleinere Files)
    crf: int = 20                       # Qualität: niedriger = besser, 18-22 typisch
    # v0.9.245 — Frame-Erfassung: JPEG ist ~16× schneller zu encoden+übertragen
    # als PNG (gemessen: 2349ms→147ms/Frame @4K). Video wird eh verlustbehaftet
    # zu H.264 codiert → q92-JPEG visuell deckungsgleich. Alpha erzwingt PNG
    # (JPEG kann keine Transparenz).
    frame_format: str = "jpeg"          # "jpeg" (schnell) | "png" (verlustfrei)
    jpeg_quality: int = 92              # 1..100, nur bei frame_format="jpeg"
    # 08.09.2026 — Verkleinern (SSAA) im ffmpeg statt in Python: der Lanczos-Schritt
    # in PIL kostete bei 4K gemessen 187 ms je Bild auf dem kritischen Weg; ffmpeg
    # macht dasselbe nebenher im eigenen Prozess (gemessen 745 -> 629 ms je Bild).
    # Nur die Video-Pfade setzen das; Standbilder skalieren weiter in Python.
    skalieren_in_ffmpeg: bool = False
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
    # v0.9.506 — Wie die Frames über den Track verteilt werden. Bis v0.9.505
    # zeigte Frame k schlicht Punkt k der Aufzeichnung; wie das aussah, entschied
    # damit allein das Gerät. Jetzt ist es eine Wahl:
    #   "even" — gleichmäßig über die STRECKE → sichtbar gleichbleibendes Tempo
    #   "real" — gleichmäßig über die ZEIT    → sichtbar das echte Tempo
    #   "raw"  — jeder n-te aufgezeichnete Punkt (Verhalten bis v0.9.505)
    # ⚠️ Vorgabe bleibt "raw": bestehende Projekte müssen aussehen wie bisher.
    # Neue Projekte setzt die Oberfläche auf "even".
    pace_mode: str = "raw"
    # 08.09.2026 — Tempo-Kurve: je Bild die Stelle auf der Strecke (0..1).
    # Kommt aus der Vorschau (core/tempo.py); leer = wie bisher verteilen.
    pace_map: Optional[list] = None
    # 29.08.2026 (Marc, Schorfheide): Haupt-Tour darf verzögert loslaufen —
    # sie bleibt Haupt (Schatten/Glow/Laufpunkt), der Schwarm läuft derweil
    # an der Videozeit. Renormiert: sie kommt trotzdem am Videoende an.
    schwarm_haupt_start_s: float = 0.0
    # 30.08.2026 (Marc: „eigene wasserzeichen … ein kleines bisschen mehr
    # marketing") — eigenes Logo im gerenderten Video/Bild. Pfad zu PNG/JPG/
    # WebP (leer = aus), Ecke, Breite in % der Videobreite, Deckkraft.
    # 31.08.2026 (Beta-Tester: „el poder seleccionar la flecha en todos los
    # tracks") — Zusatz-Touren übernehmen die Laufpunkt-Form der Haupt-Tour
    # (praktisch: Pfeil in Fahrtrichtung für den ganzen Schwarm).
    schwarm_dot_haupt_form: bool = False
    # Nur bei "real": was mit Standzeiten passiert. "show" (voll ausspielen),
    # "trim" (auf `pause_trim_s` kürzen) oder "skip" (ganz raus). Ohne
    # Behandlung wäre der ehrlichste Modus der langweiligste — bei einer
    # gemessenen Bergtour wären 63 von 232 Sekunden Standbild gewesen.
    pause_mode: str = "trim"
    pause_min_s: float = 120.0    # ab wann etwas als Pause gilt
    pause_trim_s: float = 5.0     # worauf sie gekürzt wird
    # v0.9.507 — Sprache der Beschriftungen IM RENDER (Overlay-Felder,
    # Höhenprofil-Titel, Fortschrittsmeldungen). Bis v0.9.506 waren sie deutsch
    # einprogrammiert: ein spanischer Nutzer bekam Videos mit „ZURÜCKGELEGT"
    # und „HÖHENPROFIL", während die Vorschau korrekt Spanisch zeigte.
    # Leer = Deutsch (die einprogrammierten Fallbacks).
    ui_lang: str = ""
    # 11.09.2026 — Zeitzone der Tour (aus dem Archiv-Land); leer = aus der Lage.
    tz_name: str = ""
    # v0.9.509 — Der Laufpunkt („die Kugel"), der die Strecke abfährt.
    # ⚠️ Bis v0.9.508 war er fest verdrahtet: im Video immer an, in der Vorschau
    # gar nicht vorhanden. Man konnte also erst nach dem Rendern sehen, wie er
    # aussieht. Jetzt: an/aus, Form und Größe — und die Vorschau zeigt dasselbe.
    #   "dot"   — weiße Kugel mit Rand in Track-Farbe (wie bisher)
    #   "arrow" — Pfeil, der in Fahrtrichtung zeigt
    marker_dot_show: bool = True
    marker_dot_style: str = "dot"
    marker_dot_size: float = 1.0        # Faktor auf die Grundgröße
    # 02.09.2026 — Ruhe des Pfeils, Regler 0–10 (siehe ui/js/util.js
    # `kursGlaettung`): 0 = folgt jeder Zuckung, 10 = zeigt die grobe Richtung.
    marker_dot_smooth: float = 5.0
    marker_dot_glatt_m: float = 0.0   # 29.09.2026 — σ der Pfeilrichtung entlang der Strecke (0 = aus Ruhe-Stufe)
    # Alpha-Channel-Modus: kein Karten-Background, nur Track + Punkt + Overlays
    # auf transparentem Hintergrund. Output ist dann eine ProRes-4444-.mov,
    # die in Premiere/Final Cut/DaVinci/Resolve direkt als Overlay-Layer
    # über echtes Video gelegt werden kann. Pitch/Bearing/Terrain werden
    # in diesem Modus ignoriert (2D top-down macht für Composit am meisten Sinn).
    transparent_background: bool = False
    # 02.10.2026 (Marc: „könnte man auch in HDR rendern", IDEAS §73) — "sdr" | "hlg" | "pq". HDR = SDR-Bild sauber
    # in BT.2020 mit HLG- bzw. PQ-Kurve, SDR-Weiß auf 203 nits (ITU-R BT.2408), 10 Bit HEVC oder ProRes.
    farbraum: str = "sdr"
    # Schlagschatten unter der Track-Linie. Macht den Track plastischer —
    # er sieht aus als würde er ein Stückchen über der Karte schweben.
    # `shadow_enabled` = Master-Toggle; `shadow_strength` ist die Offset-Distanz
    # in Pixeln (auch als Blur-Radius verwendet). 0 = aus, 4 = dezent
    # (Default), 10 = sehr stark.
    shadow_enabled: bool = True
    shadow_strength: float = 4.0
    # v0.9.478 — globale Schatten-RICHTUNG (Lichtquelle) in Grad, Bildschirm-Koordinaten
    # (0°=rechts, 90°=unten, 180°=links, 270°=oben). Gilt für Track-Schatten UND
    # Schild-Schatten → alle Schlagschatten fallen in dieselbe Richtung („eine Sonne").
    # Default 45° = unten-rechts (wie bisher hartcodiert `[strength, strength]`).
    shadow_dir: float = 45.0
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
    ghost_track_dashed: bool = False     # 06.10.2026 (A2) — kommender Weg gestrichelt (neue Projekte: an)
    # v0.9.435 — Mehrfarbiger Track (Marc-Idee): der Track kann die Farbe wechseln.
    # `track_colors_source` bestimmt WONACH eingefärbt wird:
    #   "distance"  → nach Distanz (Stop-Wert = km; aus km-Eingabe, Marker-Position
    #                 oder projizierten GPX-Wegpunkten)
    #   "elevation" → nach Höhe   (Stop-Wert = Meter)   — wie die Höhen-Farbzonen im Höhenprofil
    #   "speed"     → nach Tempo  (Stop-Wert = km/h)
    # `track_color_stops` ist eine Liste [{"v": float, "color": "#rrggbb"}] (Legacy:
    # "km" statt "v" wird weiter gelesen). `track_colors_mode` = "hard" (harter
    # Wechsel / Bänder) oder "gradient" (kontinuierlicher Verlauf). Umgesetzt als
    # Mapbox-line-gradient/-step. Bei distance ist der Wert linear in der gezeichneten
    # Distanz; bei elevation/speed wird pro Punkt die Metrik→Farbe gemappt (nicht-
    # monoton, deshalb feine Abtastung). `track_colors_enabled` = Master-Toggle.
    # Nur Single-Track.
    track_colors_enabled: bool = False
    track_colors_mode: str = "hard"
    track_colors_source: str = "distance"
    track_color_stops: list = field(default_factory=list)
    # v0.9.210/211 (Reiseroute) — zusätzlicher Ghost = geladenes Wander-GPX
    # (andere Linie als die animierte Route). [[lon,lat],…]; leer = aus.
    # 27.08.2026 (Marc) — BELIEBIG VIELE Ghost-Spuren, jede mit eigenem Aussehen.
    # Anwendungsfall: der offizielle Wanderweg als durchgehende Linie, die eigenen
    # geplanten Rundtouren dünn gestrichelt daneben, darüber die gelaufene Tour
    # animiert. Ein Eintrag:
    #   {"name": str, "coords": [[lon,lat], …], "color": "#rrggbb",
    #    "opacity": 0..1, "width": px, "dashed": bool, "show": bool}
    # Die alten Einzelfelder `ghost_gpx_*` gelten weiter (ältere Projekte) und
    # werden beim Rendern als erster Ghost geführt.
    ghosts: list = field(default_factory=list)
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
    # IDEAS §38 (28.08.2026): Ablauf der Mehr-Touren-Übergabe. "reise" =
    # nacheinander mit Kinoflügen (seit §60 nur noch über die Szene). "schwarm" =
    # alle gleichzeitig, gleiche Geschwindigkeit — läuft über den NORMALEN
    # Single-Track-Pfad (Haupt-Track = Zeitachse), die übrigen Touren wachsen
    # als Zusatz-Linien im selben Takt mit (schwarm_tours in _make_html).
    tracks_ablauf: str = "reise"
    # IDEAS §38 M3 — Geschwindigkeitsmodus des Schwarms (Wahl im Archiv):
    #   "gleich"  = alle gleich schnell (Standard, längste bestimmt die Dauer)
    #   "ziel"    = gleichzeitig im Ziel (Fotofinish: jede Tour skaliert)
    #   "uhrzeit" = echte Uhrzeit (aufgezeichnete Zeitstempel; gemeinsamer
    #               Start, die längste DAUER bestimmt die Zeitachse)
    schwarm_modus: str = "gleich"
    # "uhrzeit": zählen Pausen mit (True = wörtlich echte Uhrzeit, der Punkt
    # steht bei Rast) oder nur Bewegungszeit (False, Pausen rausgeschnitten)?
    schwarm_pausen: bool = True
    # 29.08.2026 (Marc: „ich will nicht, dass eine tour raussticht"): Haupt-
    # Tour im Schwarm dezent — Laufpunkt/Linie wie die Zusatz-Touren.
    schwarm_haupt_dezent: bool = False
    # IDEAS §38 M2 — Fokus-Tour im Schwarm (Marc, 28.08.2026: „kamera bleibt
    # stehen" wenn sie fertig ist). GPX-Pfad einer Zusatz-Tour; leer = die
    # Kamera folgt (falls eingeschaltet) wie bisher dem Haupt-Track.
    schwarm_fokus_gpx: str = ""
    # Dauer des Kino-Flugs zwischen zwei Touren (Sekunden). Während dieser
    # Zeit wächst keine Linie, der Marker ist ausgeblendet, die Kamera fliegt
    # von der einen Tour zur anderen.
    fly_duration_s: float = 3.0


def _shadow_dxdy(cfg) -> tuple:
    """v0.9.478 — Schatten-Versatz (dx, dy) in px aus globaler Richtung + Abstand.
    Bildschirm-Koordinaten (y nach unten). Default-Richtung 45° = unten-rechts
    (entspricht dem früheren hartcodierten `[strength, strength]` bis auf ~30 %
    kürzere Diagonale — visuell praktisch identisch)."""
    d = float(getattr(cfg, "shadow_strength", 4.0) or 0.0)
    a = math.radians(float(getattr(cfg, "shadow_dir", 45.0) or 0.0))
    return (d * math.cos(a), d * math.sin(a))






# 29.08.2026 (Marc: „gesamtstats beim schwarm sollten die summe anzeigen von
# allen touren") — im Schwarm zeigen die Gesamt-Felder die SUMME über alle
# Touren (Ø-Tempo = Schnitt aus den Summen, Max/Höchster/Tiefster = Extremwert).
# `_sw` greift auf die in render() vorberechneten swarm_*-Aggregate zu; ohne
# Schwarm (kein swarm_n) läuft alles unverändert über die Einzeltour.
def _sw(ts, key, sonst):
    return ts.get(key) if ts.get("swarm_n") and ts.get(key) is not None else sonst



DEFAULT_LIVE_FIELDS = ["dist_done", "time_elapsed", "ele_now"]
DEFAULT_TOTAL_FIELDS = ["dist_total", "moving_time", "avg_speed", "max_speed", "elev_gain", "elev_loss"]













def _overlay_sensor_series_json(ds_points, field_ids, extra_keys=None) -> str:
    """JSON `{key: [wert_pro_ds_punkt]}` für die im Overlay aktiven Sensor-Felder
    (`sensor:<key>`). Liest direkt aus `TrackPoint.extra` der ds-Punkte.

    v0.9.448 — `extra_keys`: Reihen, die zwar in keinem Overlay-Feld stecken, aber
    trotzdem gebraucht werden (z.B. die Reihe, nach der der Track eingefärbt wird).
    Ohne das wäre `sensorSeries` leer und die Puls-Einfärbung stumm wirkungslos.
    """
    keys = [fid.split(":", 1)[1] for fid in (field_ids or [])
            if isinstance(fid, str) and fid.startswith("sensor:")]
    for k in (extra_keys or []):
        if isinstance(k, str) and k and k not in keys:
            keys.append(k)
    if not keys:
        return "{}"
    out = {}
    for k in keys:
        out[k] = [(p.extra.get(k) if isinstance(getattr(p, "extra", None), dict) else None)
                  for p in ds_points]
    return json.dumps(out)






# ── Overlay-Boxen einzeln (23.09.2026, docs/OVERLAY-BOXEN.md) ────────────────
# EIN Baustein für beide Render-HTMLs (Karte + Alpha). Vorher stand der Box-Block
# zweimal da. Box = [data-ovbox="<id>"], Zeile = [data-f="<fid>"] — dieselben
# Selektoren wie die Vorschau, damit ui/js/overlay_boxen.js beide bedient.

































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










def ghost_liste(cfg) -> list:
    """Alle sichtbaren Ghost-Spuren in Zeichenreihenfolge (27.08.2026).

    Führt die alte Einzel-Fassung (`ghost_gpx_coords` + `ghost_gpx_*`) und die
    neue Liste (`ghosts`) zusammen, damit ältere Projekte unverändert aussehen.
    Spuren ohne mindestens zwei Punkte oder mit `show: False` fallen raus.
    """
    raus = []
    alt_coords = getattr(cfg, "ghost_gpx_coords", None) or []
    if len(alt_coords) > 1:
        raus.append({
            "name": "", "coords": alt_coords,
            "color": str(getattr(cfg, "ghost_gpx_color", "#7fa8ff")),
            "opacity": float(getattr(cfg, "ghost_gpx_opacity", 0.60)),
            "width": float(getattr(cfg, "ghost_gpx_width", 2.5)),
            "dashed": bool(getattr(cfg, "ghost_gpx_dashed", True)),
            "show": True,
        })
    for g in (getattr(cfg, "ghosts", None) or []):
        if not isinstance(g, dict) or not g.get("show", True):
            continue
        if len(g.get("coords") or []) > 1:
            raus.append(g)
    return raus


# Punkte-Deckel für gleichzeitig laufende Touren (Schwarm, IDEAS §38).
MAX_PUNKTE_GESAMT = 40_000     # Summe über alle Touren
MAX_PUNKTE_LAENGSTE = 800      # feiner braucht die längste Tour nie zu sein
MIN_ABSTAND_M = 2.0            # unter 2 m Punktabstand sieht niemand einen Unterschied


def punktabstand(l_max_m: float, l_sum_m: float) -> float:
    """Der eine Punktabstand `s` für ALLE Touren.

    Zwei Schranken, die strengere gewinnt:
    - Gesamtdeckel: Summe aller Punkte ≈ l_sum/s ≤ MAX_PUNKTE_GESAMT.
    - Auflösung: die längste Tour braucht nie mehr als MAX_PUNKTE_LAENGSTE.
    """
    s = max(l_sum_m / MAX_PUNKTE_GESAMT,
            l_max_m / MAX_PUNKTE_LAENGSTE,
            MIN_ABSTAND_M)
    return s


def resample_aequidistant(points, s_m: float) -> list:
    """Track auf festen Punktabstand bringen: [[lon, lat], …], Start und Ziel exakt.

    `points` sind geparste TrackPoints mit `lon`, `lat` und kumuliertem
    `dist_m`. Lineare Interpolation zwischen den Stützpunkten reicht — es geht
    um eine Linie auf der Karte, nicht um Vermessung.
    """
    if len(points) < 2:
        return [[p.lon, p.lat] for p in points]
    gesamt = points[-1].dist_m
    if gesamt <= 0:
        return [[points[0].lon, points[0].lat], [points[-1].lon, points[-1].lat]]
    n = max(2, int(math.floor(gesamt / s_m)) + 1)
    raus = []
    j = 0
    for i in range(n):
        ziel = min(gesamt, i * s_m)
        while j < len(points) - 2 and points[j + 1].dist_m < ziel:
            j += 1
        a, b = points[j], points[j + 1]
        spanne = b.dist_m - a.dist_m
        t = 0.0 if spanne <= 0 else (ziel - a.dist_m) / spanne
        raus.append([a.lon + (b.lon - a.lon) * t, a.lat + (b.lat - a.lat) * t])
    # Ziel exakt — sonst endet die Linie einen halben Schritt vor dem Zielort.
    if raus[-1] != [points[-1].lon, points[-1].lat]:
        raus.append([points[-1].lon, points[-1].lat])
    return raus


# IDEAS §38 M3 — „nur Bewegungszeit": Segment-Zeiten über diesem Deckel gelten
# als Pause und werden auf ihn gestutzt (übliche GPX-Aufzeichnung tickt ≤ 5 s;
# 20 s trennt „langsam" sauber von „steht"). Bewusst dieselbe einfache Regel
# wie bei Moving-Time-Schätzungen — es geht um die Video-Choreografie,
# nicht um Sportwissenschaft.
PAUSEN_DECKEL_S = 20.0


def resample_zeiten(points, s_m: float) -> "tuple[list | None, list | None]":
    """Zeitachsen passend zu `resample_aequidistant(points, s_m)`.

    Liefert (t_roh, t_bew) — je ein Array, INDEX-GLEICH zu den äquidistant
    abgetasteten Koordinaten: kumulierte Sekunden seit Tour-Start am jeweiligen
    Streckenpunkt. t_roh = echte Uhrzeit (Pausen zählen), t_bew = Bewegungszeit
    (Segment-dt auf PAUSEN_DECKEL_S gestutzt). (None, None), wenn die Tour
    keine Zeitstempel trägt.
    """
    if len(points) < 2 or points[-1].dist_m <= 0:
        return (None, None)
    if not any(p.elapsed_s for p in points):
        return (None, None)
    # Bewegungszeit je Stützpunkt einmal vorab kumulieren.
    bew = [0.0]
    for i in range(1, len(points)):
        dt = max(0.0, points[i].elapsed_s - points[i - 1].elapsed_s)
        bew.append(bew[-1] + min(dt, PAUSEN_DECKEL_S))
    gesamt = points[-1].dist_m
    n = max(2, int(math.floor(gesamt / s_m)) + 1)
    t_roh, t_bew = [], []
    j = 0
    letzte_koord = None
    for i in range(n):
        ziel = min(gesamt, i * s_m)
        while j < len(points) - 2 and points[j + 1].dist_m < ziel:
            j += 1
        a, b = points[j], points[j + 1]
        spanne = b.dist_m - a.dist_m
        t = 0.0 if spanne <= 0 else (ziel - a.dist_m) / spanne
        t_roh.append(a.elapsed_s + (b.elapsed_s - a.elapsed_s) * t)
        t_bew.append(bew[j] + (bew[j + 1] - bew[j]) * t)
        letzte_koord = [a.lon + (b.lon - a.lon) * t, a.lat + (b.lat - a.lat) * t]
    # Ziel exakt — WÖRTLICH dieselbe Bedingung wie der Extra-Punkt in
    # resample_aequidistant, sonst verrutschen die Indizes um eins.
    if letzte_koord != [points[-1].lon, points[-1].lat]:
        t_roh.append(points[-1].elapsed_s)
        t_bew.append(bew[-1])
    return ([round(x, 1) for x in t_roh], [round(x, 1) for x in t_bew])


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


def _dasharray_mapbox(line_style: str, spacing: float = 1.0, faktor: float = 1.0) -> str:
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
    # 07.09.2026 — `faktor` = Hauptlinienbreite / Ebenenbreite: breitere Ebenen (Schatten 2,2×,
    # Glow, Röhren-Streifen) bekommen so dieselbe Pixel-Länge der Striche wie die Hauptlinie.
    # Synchron zu modules/animator/ui/module.js (dasharrayFor).
    s = max(0.1, float(spacing)) * max(0.01, float(faktor))
    return "[" + ", ".join(f"{v * s:.2f}" for v in base) + "]"




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


def _vf_args(cfg) -> list[str]:
    """Bildfilter fuer ffmpeg: exakt auf die Zielgroesse bringen (SSAA-Verkleinern
    und Chromiums Rundung auf ungerade Hoehen) und JPEG-Vollbereich auf tv
    normalisieren. 08.09.2026 — vorher lief das Verkleinern in PIL auf dem
    kritischen Weg (gemessen 187 ms je Bild bei 4K)."""
    teile = []
    if getattr(cfg, "skalieren_in_ffmpeg", False):
        # In voller Farbaufloesung verkleinern: der JPEG-Strom kommt als yuvj420p
        # herein, und Lanczos auf halbierten Farbkanaelen weicht sichtbar von PIL
        # ab (gemessen 5 % weniger Kantenenergie). Ein Zwischenschritt nach RGB
        # kostet in ffmpeg nichts, weil der Prozess ohnehin nebenher laeuft.
        teile.append("format=rgba" if cfg.transparent_background else "format=rgb24")
        teile.append(f"scale={int(cfg.width)}:{int(cfg.height)}:flags=lanczos")
    if (cfg.frame_format or "jpeg").lower() == "jpeg" and not cfg.transparent_background:
        teile.append("scale=in_range=full:out_range=tv")
    return ["-vf", ",".join(teile)] if teile else []


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












def _chart_axis_over(ch: dict) -> dict:
    """v0.9.447 — Pro-Diagramm-Übersteuerungen der Achsen (Karte im Animator).

    Nur Keys die die Karte tatsächlich gesetzt hat; alles andere kommt weiter aus
    dem Daten-Animator-Stil. Wird von `resolve_overlay_chart(style_over=…)` über
    den Stil gelegt.
    """
    out: dict = {}
    if ch.get("show_axes") is not None:
        out["show_axes"] = bool(ch.get("show_axes"))
    if ch.get("axis_font_size") is not None:
        try:
            out["axis_font_size"] = max(6.0, min(80.0, float(ch.get("axis_font_size"))))
        except (TypeError, ValueError):
            pass
    return out








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


_MAPBOX_GL_CACHE: Optional[str] = None


# ── Kachel-Zwischenspeicher (kopfloser Render) ──────────────────────────────
# 03.09.2026. Jede Kachel, die der Render lädt, landet einmal auf der Platte;
# der nächste Render desselben Gebiets holt sie von dort. Mapbox bleibt außen
# vor (Nutzungsbedingungen), alle anderen Quellen erlauben oder verlangen den
# Zwischenspeicher. Aufbewahrt wird bis zur Größengrenze, die ältesten fliegen
# zuerst. Leeren-Knopf: Einstellungen → Kartenanbieter.

def tile_cache_size_bytes() -> int:
    if not TILE_CACHE_DIR:
        return 0
    total = 0
    try:
        for f in Path(TILE_CACHE_DIR).rglob("*.bin"):
            try: total += f.stat().st_size
            except OSError: pass
    except OSError:
        pass
    return total


def tile_cache_clear() -> int:
    """Alles weg. Liefert die Zahl gelöschter Dateien."""
    if not TILE_CACHE_DIR:
        return 0
    n = 0
    for f in list(Path(TILE_CACHE_DIR).rglob("*.bin")) + list(Path(TILE_CACHE_DIR).rglob("*.tmp")):
        try: _ds.loeschen(f, "kachelcache_leeren", art=_ds.ART_CACHE); n += 1
        except OSError: pass
    return n


def _tile_cache_prune(max_mb: int) -> None:
    """Älter als 90 Tage → löschen; über der Größengrenze: älteste zuerst, bis 90 % erreicht sind."""
    if not TILE_CACHE_DIR:
        return
    files = []
    alt = 0
    grenze = time.time() - _tileproxy.TILE_CACHE_MAX_AGE_S      # 04.09.2026: älter als 90 Tage → weg
    for f in Path(TILE_CACHE_DIR).rglob("*.bin"):
        try:
            st = f.stat()
            if st.st_mtime < grenze:
                _ds.loeschen(f, "kachelcache_aufraeumen", art=_ds.ART_CACHE); alt += 1; continue
            files.append((st.st_mtime, st.st_size, f))
        except OSError: pass
    if alt:
        _log.info("Kachel-Zwischenspeicher: %d Dateien älter als 90 Tage gelöscht", alt)
    total = sum(sz for _, sz, _ in files)
    limit = int(max_mb) * 1024 * 1024
    if total <= limit:
        return
    files.sort()
    ziel = int(limit * 0.9)
    n = 0
    for _, sz, f in files:
        if total <= ziel:
            break
        try: _ds.loeschen(f, "kachelcache_aufraeumen", art=_ds.ART_CACHE); total -= sz; n += 1
        except OSError: pass
    _log.info("Kachel-Zwischenspeicher: %d alte Dateien gelöscht (jetzt %.0f MB, Grenze %d MB)",
              n, total / 2**20, max_mb)


async def _install_tile_cache(page, cfg) -> Optional[dict]:
    """Playwright-Route: Kacheln aus dem Zwischenspeicher bedienen, neue ablegen.
    Liefert das Zähler-Dict (hit/miss/store) fürs Log, None wenn aus."""
    if getattr(cfg, "transparent_background", False):
        return None
    import hashlib
    # Die Route läuft AUCH ohne Zwischenspeicher (tile_cache_mb = 0 oder Test
    # ohne App): sie setzt die CORS-Freigabe auf jede Antwort. Ohne sie bleiben
    # Landesdienste ohne `Access-Control-Allow-Origin` (Schleswig-Holstein,
    # Sachsen-Anhalt, Sachsen) für die WebGL-Karte unerreichbar — der Render
    # brach dann mit „Failed to fetch" ab, obwohl die Kachel per curl kommt.
    d = Path(TILE_CACHE_DIR) if TILE_CACHE_DIR else None
    if d is not None:
        try:
            d.mkdir(parents=True, exist_ok=True)
            _tile_cache_prune(TILE_CACHE_MAX_MB)
        except OSError as e:
            _log.warning("Kachel-Zwischenspeicher nicht nutzbar: %s", e)
            d = None
    stats = {"hit": 0, "miss": 0, "store": 0, "fehler": {}, "ersatz": 0, "aus": {}}
    cors = {"Access-Control-Allow-Origin": "*"}
    # 30.09.2026 — gescheiterte Adressen merken (s. tileproxy): nach drei Fehlversuchen für NACHHOLEN_S
    # sofort abbrechen statt bei jedem Bild erneut mit Pausen zu versuchen. stats["aus"]: Dienst → Adressen.
    _fehl_url: dict = {}

    async def handler(route):
        req = route.request
        url = req.url
        if req.method != "GET" or "mapbox.com" in url or url.startswith("data:") or url.startswith("blob:"):
            await route.continue_(); return
        _terr = _tileproxy.is_terrarium_url(url)
        # 04.09.2026 — WMS-Kacheln mit `scale_z` (PNOA) vergrößert anfordern, dann auf 512 px verkleinern (s. tileproxy)
        url, _over = _tileproxy.wms_oversample_url(url)
        h = hashlib.sha1((url + (_tileproxy.CLAMP_KEY_SUFFIX if _terr else "")).encode("utf-8")).hexdigest()
        f = (d / h[:2] / (h + ".bin")) if d is not None else None
        _tf = _fehl_url.get(url)
        if _tf is not None and time.time() - _tf < _tileproxy.NACHHOLEN_S:
            try: await route.abort()
            except Exception: pass
            return
        if f is not None and _tileproxy.cache_fresh(f):     # 90-Tage-Frist, s. tileproxy
            try:
                raw = f.read_bytes()
                nl = raw.index(b"\n")
                stats["hit"] += 1
                await route.fulfill(status=200, content_type=raw[:nl].decode("ascii", "ignore"),
                                    body=raw[nl + 1:], headers=cors)
                return
            except Exception:
                pass
        # 07.09.2026 — Kachelserver drosseln (OSM 429, EOX/WMS 502/503): bis zu drei
        # Versuche mit Pause, statt die Kachel als „Fehler" stehen zu lassen — MapLibre
        # zeichnet dann nichts (leere Fläche im Video) und probiert es erst viel später.
        resp = None
        for _versuch in range(3):
            try:
                resp = await route.fetch(url=url) if _over > 1 else await route.fetch()
            except Exception:
                resp = None
                break
            if resp.status not in (429, 502, 503, 504):
                break
            stats["fehler"][str(resp.status)] = stats["fehler"].get(str(resp.status), 0) + 1
            await asyncio.sleep(0.5 * (2 ** _versuch))
        if resp is None:
            try: await route.abort()
            except Exception: pass
            return
        if resp.status >= 400:
            stats["fehler"][str(resp.status)] = stats["fehler"].get(str(resp.status), 0) + 1
            if resp.status in (429, 502, 503, 504):
                _fehl_url[url] = time.time()
                try:
                    from urllib.parse import urlparse as _up
                    stats["aus"].setdefault(_up(url).hostname or "?", set()).add(url)
                except Exception:
                    pass
        stats["miss"] += 1
        if (resp.headers.get(_tileproxy.ERSATZ_HEADER.lower()) or resp.headers.get(_tileproxy.ERSATZ_HEADER)):
            stats["ersatz"] += 1     # Ersatz-Kachel der Weiche: durchreichen, NIE speichern
            try: await route.fulfill(status=200, content_type="image/png", body=await resp.body(), headers=cors)
            except Exception: pass
            return
        try:
            ct = (resp.headers.get("content-type") or "").split(";")[0].strip().lower()
            body = await resp.body()
            if _terr and resp.status == 200:
                body = _tileproxy.clamp_terrarium(body)   # Meerestiefen → 0 m (s. tileproxy)
            elif _over > 1 and resp.status == 200 and ct.startswith("image/"):
                body, ct = _tileproxy.downscale_tile(body, ct)
            if (f is not None and resp.status == 200 and len(body) < 8_000_000
                    and (ct.startswith("image/") or "protobuf" in ct or "font" in ct
                         or ct == "application/octet-stream")):
                f.parent.mkdir(parents=True, exist_ok=True)
                tmp = f.with_name(f.name + f".{os.getpid()}.tmp")
                tmp.write_bytes(ct.encode("ascii", "ignore") + b"\n" + body)
                _ds.ersetzen(tmp, f, "kachel", art=_ds.ART_CACHE)
                stats["store"] += 1
            await route.fulfill(status=resp.status, headers={**{k: v for k, v in resp.headers.items()
                                                                 if k.lower() not in ("content-length", "content-encoding", "transfer-encoding")},
                                                              **cors}, body=body)
        except Exception:
            try: await route.fulfill(response=resp)
            except Exception: pass

    await page.route("**/*", handler)
    return stats


_MAPLIBRE_GL_CACHE: Optional[str] = None


def _maplibre_gl_head() -> str:
    """`<script>`/`<style>` für maplibre-gl — aus dem Bundle (ui/vendor), wie
    `_mapbox_gl_head()`. Fällt auf die CDN zurück, wenn die Dateien fehlen."""
    global _MAPLIBRE_GL_CACHE
    if _MAPLIBRE_GL_CACHE is None:
        try:
            base = Path(getattr(sys, "_MEIPASS", None)
                        or Path(__file__).resolve().parent.parent)
            js = (base / "ui" / "vendor" / "maplibre-gl.js").read_text(encoding="utf-8")
            css = (base / "ui" / "vendor" / "maplibre-gl.css").read_text(encoding="utf-8")
            cam = (base / "ui" / "js" / "maplibre-camera.js").read_text(encoding="utf-8")   # 04.09.2026 Kamera-Adapter
            stars = (base / "ui" / "js" / "rz-stars.js").read_text(encoding="utf-8")        # 04.09.2026 Sternenhimmel
            adj = (base / "ui" / "js" / "rz-mapadjust.js").read_text(encoding="utf-8")      # 05.09.2026 Karten-Optik
            l3d = (base / "ui" / "js" / "rz-line3d.js").read_text(encoding="utf-8")        # 06.09.2026 Linien über dem Gelände
            dash = (base / "ui" / "js" / "rz-dash.js").read_text(encoding="utf-8")          # 06.09.2026 Strichelung als Geometrie
            _MAPLIBRE_GL_CACHE = f"<style>{css}</style>\n<script>{js}</script>\n<script>{stars}</script>\n<script>{adj}</script>\n<script>{l3d}</script>\n<script>{dash}</script>\n<script>{cam}</script>"
            _log.info("maplibre-gl aus dem Bundle eingebettet (%.1f MB)", len(js) / 2**20)
        except Exception as e:
            _log.warning("maplibre-gl nicht im Bundle gefunden (%s) — CDN-Rückfall", e)
            _MAPLIBRE_GL_CACHE = (
                '<script src="https://unpkg.com/maplibre-gl@5.4.0/dist/maplibre-gl.js"></script>\n'
                '<link href="https://unpkg.com/maplibre-gl@5.4.0/dist/maplibre-gl.css" rel="stylesheet">'
            )
    return _MAPLIBRE_GL_CACHE


def _mapbox_gl_head() -> str:
    """`<script>`/`<style>` für mapbox-gl — aus dem Bundle statt aus dem Netz.

    ⚠️ Der Render lud die Bibliothek bisher bei JEDEM Lauf von
    `api.mapbox.com` nach, obwohl `ui/vendor/mapbox-gl.js` (1,5 MB, exakt
    dieselbe Fassung 3.12.0) mitgeliefert wird und die App-Oberfläche sie längst
    von dort nimmt. Wem eine Firewall oder ein Virenscanner den Netzzugriff
    verbietet, bekam `ERR_NETWORK_ACCESS_DENIED`, danach
    `mapboxgl is not defined` und einen Abbruch nach wenigen Sekunden — ohne
    dass am Track oder an den Einstellungen irgendetwas falsch war.

    Eingebettet statt verlinkt, weil die Render-Seite über `page.set_content()`
    entsteht und damit keine Basis-Adresse hat, an der ein `file://`-Verweis
    hängen könnte.

    Fällt auf die CDN zurück, wenn die Dateien fehlen — dann läuft es wie vorher
    statt gar nicht. Die Kartenkacheln kommen weiterhin von Mapbox; das hier
    spart den Download der Bibliothek und macht den Start unabhängig davon.
    """
    global _MAPBOX_GL_CACHE
    if _MAPBOX_GL_CACHE is None:
        try:
            base = Path(getattr(sys, "_MEIPASS", None)
                        or Path(__file__).resolve().parent.parent)
            js = (base / "ui" / "vendor" / "mapbox-gl.js").read_text(encoding="utf-8")
            css = (base / "ui" / "vendor" / "mapbox-gl.css").read_text(encoding="utf-8")
            _MAPBOX_GL_CACHE = f"<style>{css}</style>\n<script>{js}</script>"
            _log.info("mapbox-gl aus dem Bundle eingebettet (%.1f MB) — kein CDN-Abruf",
                      len(js) / 2**20)
        except Exception as e:
            _log.warning("mapbox-gl nicht im Bundle gefunden (%s) — falle auf die CDN "
                         "zurück; ohne Netz schlägt der Render fehl", e)
            _MAPBOX_GL_CACHE = (
                '<script src="https://api.mapbox.com/mapbox-gl-js/v3.12.0/mapbox-gl.js"></script>\n'
                '<link href="https://api.mapbox.com/mapbox-gl-js/v3.12.0/mapbox-gl.css" rel="stylesheet">'
            )
    return _MAPBOX_GL_CACHE


_SIGN_DRAW_JS_CACHE: Optional[str] = None


def _sign_draw_js() -> str:
    global _SIGN_DRAW_JS_CACHE
    if _SIGN_DRAW_JS_CACHE is None:
        _SIGN_DRAW_JS_CACHE = _read_sign_draw_js()
    return _SIGN_DRAW_JS_CACHE


# v0.9.435 — Mehrfarbiger Track: gemeinsamer JS-Helper, der aus (cum_dist [m],
# gezeichneter Spanne, Farb-Stops [km]) einen Mapbox-`line-gradient`/-`step`-
# Ausdruck baut. Farbe pro Punkt nach absoluter Distanz. `mode`='gradient' →
# kontinuierlicher Verlauf (interpolate); 'hard' → harter Wechsel (step, crisp).
# line-progress ist über die DISTANZ der gezeichneten Spanne normiert, deshalb pro
# Frame neu (die km-Grenzen wandern im progress-Raum, während die Linie wächst).
# Wird IDENTISCH in der Vorschau gespiegelt (modules/animator/ui/module.js →
# __rzColorGradient). Bei Änderung BEIDE pflegen.
# 23.08.2026 — Etappen-Maske: macht die Verbindungsstücke zwischen Etappen
# unsichtbar, indem sie im `line-gradient` durchsichtige Stützstellen bekommen.
# Bewusst über die Farbe statt über die Geometrie: die Linie bleibt EIN
# LineString, der eingespielte Renderpfad (Trim, Marker, Alterung) bleibt
# unangetastet. ⚠️ Mapbox kann `line-dasharray` und `line-gradient` nicht
# zusammen — wo eine Maske greift, entfällt der Strich-Stil.
# SYNCHRON zu `segMaskExpr` in modules/animator/ui/module.js.
_SEG_MASK_JS = r"""
window.__rzMitAlpha = function (c, d) {
  // 24.09.2026 — Farbe mit Deckkraft d (Logbuch „blass"): #rgb, #rrggbb, rgb(), rgba().
  if (d == null) return c;
  var s = String(c || "").trim(), r, g, b, a = 1, m;
  if (s.charAt(0) === "#") {
    var h = s.slice(1); if (h.length === 3) h = h.replace(/(.)/g, "$1$1");
    r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16);
  } else if ((m = s.match(/rgba?\(([^)]+)\)/))) {
    var t = m[1].split(",").map(function (x) { return parseFloat(x); });
    r = t[0]; g = t[1]; b = t[2]; if (t.length > 3 && isFinite(t[3])) a = t[3];
  } else return c;
  if (!isFinite(r) || !isFinite(g) || !isFinite(b)) return c;
  return "rgba(" + Math.round(r) + "," + Math.round(g) + "," + Math.round(b) + "," + (Math.round(a * d * 1000) / 1000) + ")";
};
window.__rzSegMask = function (cumGeo, i0, i1, segStarts, farbe, tourFarben, stageNr) {
  // `tourFarben` (optional): Farbe je Etappennummer — dann bekommt jede Tour
  // ihre eigene Farbe, die Verbindungen bleiben durchsichtig (23.08.2026).
  if (!segStarts || !segStarts.length || !cumGeo || i1 <= i0) return null;
  var g0 = cumGeo[i0], gT = cumGeo[i1] - g0;
  if (!(gT > 0)) return null;
  var luecken = [];
  for (var k = 0; k < segStarts.length; k++) {
    var a = segStarts[k][0], b = segStarts[k][1];
    if (b <= i0 || a >= i1) continue;             // Stück liegt außerhalb
    a = Math.max(a, i0); b = Math.min(b, i1);
    // dritter Wert = Deckkraft (Logbuch „blass", 24.09.2026); ohne = unsichtbar
    luecken.push([(cumGeo[a] - g0) / gT, (cumGeo[b] - g0) / gT, segStarts[k][0], segStarts[k][1],
                  segStarts[k].length > 2 ? +segStarts[k][2] : null]);
  }
  var farbeBei = function (idx) {
    if (!tourFarben || !stageNr) return farbe;
    var c = tourFarben[stageNr[Math.max(0, Math.min(stageNr.length - 1, idx))]];
    return c || farbe;
  };
  // 20.09.2026 — ohne Lücke in der Spanne gilt trotzdem die Etappenfarbe (vorher
  // allgemeine Track-Farbe, bis der erste Übergang kam). Synchron zu segMaskExpr.
  if (!luecken.length) {
    if (!tourFarben || !stageNr) return null;
    var c0 = farbeBei(i0), c1 = farbeBei(i1);
    if (c0 === farbe && c1 === farbe) return null;
    return ["interpolate", ["linear"], ["line-progress"], 0, c0, 1, c1];
  }
  var LEER = "rgba(0,0,0,0)", e = ["interpolate", ["linear"], ["line-progress"], 0, farbeBei(i0)], letzte = 0;
  var setz = function (p, c) {
    p = Math.max(0, Math.min(1, p));
    if (p <= letzte) p = letzte + 1e-6;
    if (p >= 1) return;
    letzte = p; e.push(p, c);
  };
  for (var l = 0; l < luecken.length; l++) {
    var vorIdx = luecken[l][2], nachIdx = luecken[l][3], dk = luecken[l][4];
    setz(luecken[l][0] - 1e-5, farbeBei(vorIdx));
    setz(luecken[l][0], dk == null ? LEER : window.__rzMitAlpha(farbeBei(vorIdx), dk));
    setz(luecken[l][1], dk == null ? LEER : window.__rzMitAlpha(farbeBei(nachIdx), dk));
    setz(luecken[l][1] + 1e-5, farbeBei(nachIdx));
  }
  e.push(1, farbeBei(i1));
  return e;
};
"""

# 20.09.2026 (am Rechner gefunden): „Mehrere Track-Farben" + zusammengeführter Track →
# der Verlauf ersetzte die Etappen-Maske, die unsichtbaren Verbindungen wurden als
# gerade Striche sichtbar. `__rzGradLuecken` stanzt die Verbindungsstücke durchsichtig
# in einen fertigen Verlauf. SYNCHRON zu `gradLueckenStanzen` in modules/animator/ui/module.js.
_GRAD_LUECKEN_JS = r"""
window.__rzGradLuecken = function (expr, cumGeo, i0, i1, segStarts) {
  var LERP = window.__rzLerpHex;
  if (!expr || !segStarts || !segStarts.length || !cumGeo || i1 <= i0) return expr;
  var g0 = cumGeo[i0], gT = cumGeo[i1] - g0;
  if (!(gT > 0)) return expr;
  var L = [];
  for (var k = 0; k < segStarts.length; k++) {
    var ra = segStarts[k][0], rb = segStarts[k][1];
    if (rb <= i0 || ra >= i1) continue;
    L.push([(cumGeo[Math.max(ra, i0)] - g0) / gT, (cumGeo[Math.min(rb, i1)] - g0) / gT,
            segStarts[k].length > 2 ? +segStarts[k][2] : null]);
  }
  if (!L.length) return expr;
  var MA = window.__rzMitAlpha;
  var P = [], C = [];
  for (var s = 3; s + 1 < expr.length; s += 2) { P.push(expr[s]); C.push(expr[s + 1]); }
  if (!P.length) return expr;
  var bei = function (p) {
    if (p <= P[0]) return C[0];
    if (p >= P[P.length - 1]) return C[C.length - 1];
    var j = 0; while (j < P.length - 2 && P[j + 1] <= p) j++;
    var sp = P[j + 1] - P[j];
    try { return LERP(C[j], C[j + 1], sp > 0 ? (p - P[j]) / sp : 0); } catch (e) { return C[j]; }
  };
  var EPS = 1e-5, LEER = "rgba(0,0,0,0)", roh = [];
  for (var q = 0; q < P.length; q++) {
    var drin = false, dkq = null;
    for (var l = 0; l < L.length; l++) if (P[q] > L[l][0] - EPS && P[q] < L[l][1] + EPS) { drin = true; dkq = L[l][2]; }
    if (!drin) roh.push([P[q], C[q]]);
    else if (dkq != null) roh.push([P[q], MA(C[q], dkq)]);     // blass: Stützstelle bleibt, nur durchsichtiger
  }
  for (var m = 0; m < L.length; m++) {
    var a = L[m][0], b = L[m][1], dk = L[m][2];
    if (a - EPS > 0) roh.push([a - EPS, bei(a - EPS)]);
    roh.push([Math.max(0, a), dk == null ? LEER : MA(bei(Math.max(0, a)), dk)]);
    roh.push([Math.min(1, b), dk == null ? LEER : MA(bei(Math.min(1, b)), dk)]);
    if (b + EPS < 1) roh.push([b + EPS, bei(b + EPS)]);
  }
  roh.sort(function (x, y) { return x[0] - y[0]; });
  var e = expr.slice(0, 3), letzte = -1;
  for (var r = 0; r < roh.length; r++) {
    var pp = Math.max(0, Math.min(1, roh[r][0]));
    if (pp <= letzte) pp = letzte + 1e-7;
    if (pp > 1) continue;
    e.push(pp, roh[r][1]); letzte = pp;
  }
  return e;
};
"""

_COLOR_GRADIENT_JS = r"""
window.__rzHex2rgb = function(h){ h=(h||'#000').replace('#',''); if(h.length===3)h=h[0]+h[0]+h[1]+h[1]+h[2]+h[2]; return [parseInt(h.slice(0,2),16)||0,parseInt(h.slice(2,4),16)||0,parseInt(h.slice(4,6),16)||0]; };
window.__rzRgb2hex = function(r,g,b){ function c(x){ x=Math.max(0,Math.min(255,Math.round(x))); var s=x.toString(16); return s.length<2?'0'+s:s; } return '#'+c(r)+c(g)+c(b); };
window.__rzLerpHex = function(a,b,f){ var x=window.__rzHex2rgb(a), y=window.__rzHex2rgb(b);
  return window.__rzRgb2hex(x[0]+(y[0]-x[0])*f, x[1]+(y[1]-x[1])*f, x[2]+(y[2]-x[2])*f); };
// CD: kumulierte Distanz [m] pro Punkt. i0..i1 = gezeichnete Spanne. stopsVal/stopsCol:
// nach Wert aufsteigend sortierte Farb-Stops. mode='hard'|'gradient'. metricArr (optional):
// Pro-Punkt-Metrik (Höhe [m] oder Tempo [km/h]); FEHLT sie → Distanz-Modus (Wert=km, linear
// in progress). Rückgabe: Mapbox-Ausdruck für 'line-gradient', oder null.
window.__rzColorGradient = function(CD, i0, i1, stopsVal, stopsCol, mode, metricArr){
  if(!CD || i1<=i0 || !stopsVal || !stopsVal.length) return null;
  var d0=CD[i0], dT=CD[i1]-d0; if(!(dT>0)) return null;
  var n=stopsVal.length;
  function colAtVal(v){
    if(v<=stopsVal[0]) return stopsCol[0];
    if(v>=stopsVal[n-1]) return stopsCol[n-1];
    var i=0; while(i<n-1 && stopsVal[i+1]<=v) i++;
    if(mode!=='gradient') return stopsCol[i];
    var span=stopsVal[i+1]-stopsVal[i]; var f=span>0?(v-stopsVal[i])/span:0;
    return window.__rzLerpHex(stopsCol[i], stopsCol[i+1], f);
  }
  function bandAtVal(v){
    if(v<=stopsVal[0]) return 0;
    if(v>=stopsVal[n-1]) return n-1;
    var i=0; while(i<n-1 && stopsVal[i+1]<=v) i++; return i;
  }
  // v0.9.439 — Eine Farbe über die ganze Linie. Rückgabe statt null: null würde
  // in der Vorschau den Verlauf ENTFERNEN (Spur springt auf die Basisfarbe) und
  // im Render den Verlauf des VORFRAMES stehen lassen (falsche Farben).
  function flat(c){ return ['interpolate',['linear'],['line-progress'], 0, c, 1, c]; }
  // --- DISTANZ-Modus: Wert = km, linear in progress; Kanten exakt an den Stops. ---
  if(!metricArr){
    var pOfKm=function(km){ return (km*1000 - d0)/dT; };
    if(mode==='gradient'){
      // v0.9.439 — Stützstellen EXAKT an den Farb-Stops statt an einem Raster
      // über die gezeichnete Länge. Die Farbe ist stückweise linear in km, also
      // ist das nicht nur exakt, sondern auch frame-stabil: die Stops liegen bei
      // festen Kilometern, ihr Interpolations-Anteil hängt nicht mehr davon ab,
      // wie lang die Linie gerade ist. (Vorher: 60 Stützstellen bei k/60 der
      // gezeichneten Linie → das Raster wanderte pro Frame über den Track und
      // die Farben schimmerten — als „Farben flackern" gemeldet.)
      var expr=['interpolate',['linear'],['line-progress'], 0, colAtVal(d0/1000)];
      var lastG=0;
      for(var s=0;s<n;s++){
        var p=pOfKm(stopsVal[s]);
        if(!(p>lastG) || p>=1) continue;
        lastG=p; expr.push(p, stopsCol[s]);
      }
      expr.push(1, colAtVal((d0+dT)/1000));
      return expr;
    }
    var e=['step',['line-progress'], colAtVal(d0/1000)], lastP=-1, anyS=false;
    for(var s2=0;s2<n;s2++){
      var p2=pOfKm(stopsVal[s2]);
      if(!(p2>0) || p2>=1) continue;
      if(p2<=lastP) p2=lastP+1e-6;
      lastP=p2; e.push(p2, stopsCol[s2]); anyS=true;
    }
    return anyS ? e : flat(colAtVal(d0/1000));
  }
  // --- METRIK-Modus (Höhe/Tempo): nicht-monoton. Stützstellen an TRACK-PUNKTEN,
  //     also an festen absoluten Distanzen. Entscheidend gegen das Flackern: der
  //     Interpolations-Anteil zwischen zwei Stützstellen kürzt dT weg
  //     ((x-CD[a])/(CD[b]-CD[a])) → die Farbe an einer Stelle bleibt konstant,
  //     egal wie weit die Linie schon gezeichnet ist. ---
  if(mode==='gradient'){
    // Schrittweite aus der GESAMT-Punktzahl → über alle Frames dieselbe.
    var NG=80, stride=Math.max(1, Math.ceil((CD.length-1)/NG));
    var g=['interpolate',['linear'],['line-progress'], 0, colAtVal(metricArr[i0])];
    var lastp=0;
    for(var i=i0+stride;i<i1;i+=stride){
      var pi=(CD[i]-d0)/dT;
      if(!(pi>lastp) || pi>=1) continue;
      lastp=pi; g.push(pi, colAtVal(metricArr[i]));
    }
    // Kopf: eigene Stützstelle. Nur im letzten Teilstück (< eine Schrittweite)
    // wandert die Farbe noch minimal mit dem Kopf — dort liegen die Werte aber
    // dicht beieinander, das fällt nicht auf.
    g.push(1, colAtVal(metricArr[i1]));
    return g;
  }
  // HART: Grenzen exakt dort, wo die Metrik das Band wechselt (am Track-Punkt) —
  // exakt statt abgetastet und ebenfalls an fester Distanz verankert.
  var st=['step',['line-progress'], colAtVal(metricArr[i0])];
  var prevBand=bandAtVal(metricArr[i0]), lastB=-1, anyB=false;
  for(var j=i0+1;j<=i1;j++){
    var vb=bandAtVal(metricArr[j]);
    if(vb===prevBand) continue;
    var p3=(CD[j]-d0)/dT;
    if(!(p3>0) || p3>=1){ prevBand=vb; continue; }
    // Verrauschte Daten (Tempo!) können um eine Bandgrenze zappeln. Grenzen unter
    // 10 m Abstand zusammenfassen — absolut gemessen, damit die Entscheidung nicht
    // wieder von der gezeichneten Länge abhängt.
    if(lastB>=0 && (p3-lastB)*dT < 10){ prevBand=vb; continue; }
    if(p3<=lastB) p3=lastB+1e-6;
    lastB=p3; st.push(p3, stopsCol[vb]); prevBand=vb; anyB=true;
  }
  return anyB ? st : flat(colAtVal(metricArr[i0]));
};
"""


# 01.09.2026 — Das eingebaute Wasserzeichen wird als SENTINEL gespeichert
# („@lockup-white"), nicht als Pfad: nur so überlebt die Wahl den Export auf
# einen anderen Rechner. Die Auflösung gehört HIERHER, nicht nur in app.py —
# sonst rendert jeder Aufrufer, der die Config selbst baut (Tests, Tour-Map,
# Snapshot), ohne Logo. Genau das ist beim ersten Testrender passiert.
WASSERZEICHEN_STANDARD = "wm-lockup-white.png"
WASSERZEICHEN_DUNKEL = "wm-lockup-dark.png"   # 05.10.2026 — für helle Looks


# ── Schild-Bilder für den Render (14.09.2026, Tester-Projekt mit 2830 Foto-
# Schildern) ────────────────────────────────────────────────────────────────
#
# Bis hierhin erzeugte jeder Render-Start für JEDES Bild-Schild ein frisches
# 600-px-Vorschaubild aus dem Original (photos.thumbnail_data_url, ohne Cache):
# bei 2830 Fotos zig Sekunden Rechnen, bevor der Browser überhaupt anfängt.
# Dabei trägt jedes Schild sein Vorschaubild schon als data-URL bei sich
# (module.js _animSignsSave speichert `thumb` mit ins Projekt). Reihenfolge jetzt:
#
#   1. Das gespeicherte `thumb` des Schilds wird genommen, wenn seine längere
#      Kante den Bedarf des Renders deckt (Regel: _sign_bild_bedarf_px).
#   2. Sonst kommt das Bild aus dem Platten-Cache der Fotos
#      (photos.thumb_data_url_gecacht: Schlüssel = Pfad+mtime+Größe@600 unter
#      APP_SUPPORT/photo_thumb_cache) — beim ersten Mal erzeugt, danach gelesen.
#   3. Fehlt die Datei und ist kein gespeichertes thumb da → kein Bild.
#
# Bedarf: sign_draw.js rastert das Bild mit max(80, imageSize·5)·dpr Pixeln
# Breite (dpr = rzSignDpr(Anzahl Bild-Schilder), 2 bei ≤ 200, darunter fallend).
# Das ist das Maß, gedeckelt auf SIGN_BILD_VOLL_PX — mehr hat noch nie jemand
# geliefert (sign_pick_image / sign_image_thumb erzeugen 600 px). Ein kleineres
# gespeichertes thumb (z. B. 220 px aus dem Geotagger-Import) reicht also bei
# vielen Schildern (dpr klein) und wird bei wenigen einmal nachgerechnet.
SIGN_BILD_VOLL_PX = 600
# 20.09.2026 (Beta-Tester: „Fotos im fertigen Video unscharf"): Im Render wird das
# Schild um render_scale vergrößert (4K gegen ~1080 px Vorschau ≈ 3,6×). Ein mit
# 600 px gerastertes Foto stand dann über 1000 px breit im Bild. Solange wenige
# Bild-Schilder da sind, rastert der Render deshalb feiner (Faktor _sign_schaerfe),
# gedeckelt je Schild auf SIGN_BILD_RENDER_MAX_PX Bildbreite. Das Pixel-Gesamtbudget
# (≈ 200 Schilder à 600 px) bleibt: Faktor² · Anzahl ≤ 200. Die Größe auf dem Bild
# ändert sich nicht (addImage pixelRatio = dasselbe Maß). Nur der Render — die
# Vorschau ist klein genug für 600 px. Spiegel im JS-Block unten (signs_block).
SIGN_BILD_RENDER_MAX_PX = 1440   # größer bläht den Symbol-Atlas je Kachel auf (Software-GL: 8192 px Grenze)
SIGN_BILD_VOLL_ANZAHL = 200      # synchron zu ui/js/sign_draw.js RZ_SIGN_BILD_VOLL
SIGN_JS_LADESTAPEL = 100         # Bilder je Ladestapel im Browser (statt einem Promise.all über alle)


def _sign_bild_dpr(anzahl_bildschilder: int) -> float:
    """Spiegel von rzSignDpr (ui/js/sign_draw.js) — bei Änderung beide pflegen."""
    n = int(anzahl_bildschilder or 0)
    if n <= SIGN_BILD_VOLL_ANZAHL:
        return 2.0
    return max(0.5, round(2 * math.sqrt(SIGN_BILD_VOLL_ANZAHL / n) * 100) / 100)


def _sign_schaerfe(anzahl_bildschilder: int, render_scale: float) -> float:
    """Wie viel feiner der Render Bild-Schilder rastert (1 = wie die Vorschau)."""
    n = max(1, int(anzahl_bildschilder or 0))
    try:
        ss = float(render_scale or 1.0)
    except (TypeError, ValueError):
        ss = 1.0
    return max(1.0, min(ss, math.sqrt(SIGN_BILD_VOLL_ANZAHL / n)))


def _sign_bild_dpr_fuer(s: dict, dpr: float, schaerfe: float = 1.0) -> float:
    """Pixelmaß für EIN Bild-Schild im Render: dpr · Schärfe, je Schild gedeckelt."""
    try:
        img_sz = float(s.get("imageSize") or 60)
    except (TypeError, ValueError):
        img_sz = 60.0
    breite = max(80.0, round(img_sz * 5))
    return max(float(dpr), min(float(dpr) * float(schaerfe), SIGN_BILD_RENDER_MAX_PX / breite))


def _sign_bild_bedarf_px(s: dict, dpr: float, schaerfe: float = 1.0) -> int:
    """Längste Kante, die der Render für dieses Schild braucht (siehe oben)."""
    try:
        img_sz = float(s.get("imageSize") or 60)
    except (TypeError, ValueError):
        img_sz = 60.0
    if schaerfe and schaerfe > 1.0:
        breite = max(80.0, round(img_sz * 5)) * _sign_bild_dpr_fuer(s, dpr, schaerfe)
        return int(min(SIGN_BILD_RENDER_MAX_PX, max(64, math.ceil(breite))))
    breite = max(80.0, round(img_sz * 5)) * float(dpr)
    return int(min(SIGN_BILD_VOLL_PX, max(64, math.ceil(breite))))


def _sign_cache_px(bedarf_px: int) -> int:
    """Cache-Größe für den Bedarf — wenige feste Stufen, damit je Datei nicht
    für jede Schildgröße ein eigener Eintrag entsteht."""
    for stufe in (SIGN_BILD_VOLL_PX, 1000, SIGN_BILD_RENDER_MAX_PX):
        if bedarf_px <= stufe:
            return stufe
    return SIGN_BILD_RENDER_MAX_PX


def _data_url_kante_px(data_url) -> Optional[int]:
    """Längere Kante eines Bildes in einer data-URL — ohne das Bild zu decodieren.

    PIL liest beim Öffnen nur den Kopf; unsere JPEG-Vorschaubilder haben den
    Größen-Marker in den ersten paar hundert Bytes, darum reicht meist der
    Anfang der base64-Daten. Erst wenn das scheitert, wird alles decodiert."""
    if not isinstance(data_url, str) or not data_url.startswith("data:image/"):
        return None
    komma = data_url.find(",")
    if komma < 0:
        return None
    b64 = data_url[komma + 1:]
    for anteil in (4096, None):
        try:
            roh = base64.b64decode(b64[:anteil - (anteil % 4)] if anteil else b64)
            with Image.open(io.BytesIO(roh)) as im:
                w, h = im.size
            return int(max(w, h))
        except Exception:
            continue
    return None


def _sign_thumb_fuer(s: dict, bedarf_px: int) -> Optional[str]:
    """Vorschaubild (data-URL) für EIN Schild nach der Regel oben."""
    from . import photos as _cphotos
    src = (s.get("imageSrc") or "").strip()
    eigenes = s.get("thumb") if isinstance(s.get("thumb"), str) else None
    if eigenes:
        kante = _data_url_kante_px(eigenes)
        if kante and kante >= bedarf_px:
            return eigenes
    if src:
        try:
            if os.path.exists(src):
                # Immer in voller Größe in den Cache — ein Eintrag je Datei, egal
                # wie viele Schilder gerade da sind (der Schlüssel enthält die Größe).
                aus_cache = _cphotos.thumb_data_url_gecacht(src, _sign_cache_px(bedarf_px))
                if aus_cache:
                    return aus_cache
        except Exception:
            pass
    # Datei weg / nicht lesbar: lieber das kleine gespeicherte Bild als gar keins.
    return eigenes or None


def sign_thumbs_vorbereiten(signs: list, render_scale: float = 1.0) -> dict:
    """Setzt `thumb` für jedes Schild mit Bild (in place) und zählt, woher es kam.

    Rückgabe: {"uebernommen": n, "cache": n, "keins": n, "sekunden": t} —
    fürs Log und für tests/test_schilder_render_thumbs.py."""
    t0 = time.time()
    mit_bild = [s for s in signs if (s.get("imageSrc") or "").strip() or s.get("thumb")]
    # dpr zählt wie der Browser (__signs.filter(s => s.imageSrc)): nur Schilder mit Pfad.
    dpr = _sign_bild_dpr(sum(1 for s in mit_bild if (s.get("imageSrc") or "").strip()))
    schaerfe = _sign_schaerfe(sum(1 for s in mit_bild if (s.get("imageSrc") or "").strip()), render_scale)
    zaehler = {"uebernommen": 0, "cache": 0, "keins": 0}
    for s in mit_bild:
        bedarf = _sign_bild_bedarf_px(s, dpr, schaerfe)
        vorher = s.get("thumb") if isinstance(s.get("thumb"), str) else None
        thumb = _sign_thumb_fuer(s, bedarf)
        s["thumb"] = thumb
        if not thumb:
            zaehler["keins"] += 1
        elif thumb is vorher:
            zaehler["uebernommen"] += 1
        else:
            zaehler["cache"] += 1
    zaehler["sekunden"] = round(time.time() - t0, 3)
    zaehler["dpr"] = dpr
    zaehler["schaerfe"] = schaerfe
    if mit_bild:
        _log.info("[schilder] %d Bild-Schilder: %d übernommen, %d aus Cache/erzeugt, %d ohne Bild (%.2f s, dpr %.2f, Schärfe ×%.2f)",
                 len(mit_bild), zaehler["uebernommen"], zaehler["cache"], zaehler["keins"],
                 zaehler["sekunden"], dpr, schaerfe)
    return zaehler


def wasserzeichen_pfad(pfad: str) -> str:
    """Sentinel → absoluter Pfad im Bundle; alles andere unverändert zurück."""
    roh = str(pfad or "")
    if not roh.startswith("@"):
        return roh
    # 05.10.2026 — „@lockup-dark" = dieselbe Form dunkel (helle Looks: Reiseatlas, Minimal)
    datei = WASSERZEICHEN_DUNKEL if roh == "@lockup-dark" else WASSERZEICHEN_STANDARD
    for basis in (Path(getattr(sys, "_MEIPASS", "") or "."),
                  Path(__file__).resolve().parent.parent):
        k = basis / "ui" / "assets" / datei
        if k.is_file():
            return str(k)
    return ""




_CONTAINER_CSS_CACHE: dict = {}


def _container_css() -> str:
    """CSS der Container aus modules/animator/ui/module.css (Abschnitt zwischen den
    Marken „CONTAINER-CSS (Anfang/Ende)") — dieselbe Datei wie in der App."""
    if "css" in _CONTAINER_CSS_CACHE:
        return _CONTAINER_CSS_CACHE["css"]
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent.parent))
    css = ""
    for pfad in (base / "modules" / "animator" / "ui" / "module.css",
                 Path(__file__).resolve().parent.parent / "modules" / "animator" / "ui" / "module.css"):
        try:
            t = pfad.read_text(encoding="utf-8")
        except OSError:
            continue
        a = t.find("/* ── CONTAINER-CSS (Anfang)")
        b = t.find("/* ── CONTAINER-CSS (Ende)")
        if a >= 0 and b > a:
            css = t[a:b]
            break
    if not css:
        _log.warning("Container-CSS nicht gefunden — Einblendungen im Export ohne Gestaltung")
    _CONTAINER_CSS_CACHE["css"] = css
    return css


def _container_block(cfg) -> str:
    """Einblendungen (Container) für den Web-Karten-Export: fertiges HTML aus der
    Vorschau in einem Layer über der Karte. Maße in cqmin/cqw/em → skaliert mit der
    Größe der eingebetteten Karte."""
    html = str(getattr(cfg, "container_html", "") or "")
    if not html or not cfg.show_overlays:
        return ""
    v = getattr(cfg, "container_verlauf", None) or {}
    kl = "overlay-preview-layer" + (" vl-oben" if (v.get("oben") or {}).get("an") else "") \
        + (" vl-unten" if (v.get("unten") or {}).get("an") else "")
    stil = (f"--vl-oben:{float((v.get('oben') or {}).get('staerke', 0.62) or 0):.3f};"
            f"--vl-unten:{float((v.get('unten') or {}).get('staerke', 0.72) or 0):.3f};")
    return (f'<div id="rz-container" class="{kl}" style="position:absolute;inset:0;pointer-events:none;z-index:5;{stil}">'
            + html + "</div>")


def _container_font_link(cfg) -> str:
    """Google-Schriften, die in den Containern vorkommen (Nunito, Oswald …)."""
    html = str(getattr(cfg, "container_html", "") or "")
    spec = {"Nunito": "Nunito:wght@400;600;700", "Quicksand": "Quicksand:wght@400;500;700",
            "Fredoka": "Fredoka:wght@400;500;600", "Oswald": "Oswald:wght@400;500;600", "Bebas Neue": "Bebas+Neue"}
    fam = [v for k, v in spec.items() if k in html]
    if not fam:
        return ""
    return ('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?'
            + "&".join("family=" + f for f in fam) + '&display=swap">')


def _north_scale_js() -> str:
    """Treiber für Nordpfeil/Maßstab. `map` ist im Render-HTML global; im Alpha-
    Render gibt es keine Karte → Bearing kommt als Argument aus advanceFrame."""
    return """
<script>
window.__rzNorthScale = function(brgOverride, m) {
  // 30.09.2026 — Container: alle .ov-north / .ov-scale (wie die Vorschau, _ovUpdateNorthScale)
  m = m || null;
  var brg = (typeof brgOverride === 'number') ? brgOverride : ((m && m.getBearing) ? (m.getBearing() || 0) : 0);
  document.querySelectorAll('.ov-north').forEach(function (n) { n.style.setProperty('--rz-north', (-brg) + 'deg'); });
  var ss = document.querySelectorAll('.ov-scale');
  if (!ss.length || !m || !m.getZoom) return;
  var lay = document.getElementById('rz-container');
  var maxW = 120 * Math.max(0.5, ((lay && lay.offsetHeight) || 1080) / 1080), dist = 0;
  try { var lat = m.getCenter().lat, zm = m.getZoom(); dist = 40075016.686 * Math.cos(lat * Math.PI / 180) / (512 * Math.pow(2, zm)) * maxW; } catch (_) { dist = 0; }
  if (!(dist > 0) || !isFinite(dist)) return;
  var p10 = Math.pow(10, Math.floor(Math.log(dist) / Math.LN10)), r = dist / p10;
  r = r >= 10 ? 10 : r >= 5 ? 5 : r >= 3 ? 3 : r >= 2 ? 2 : 1;
  var nice = r * p10;
  ss.forEach(function (s) {
    s.style.setProperty('--rz-scale-w', (maxW * nice / dist) + 'px');
    var txt = s.querySelector('.ov-scale-txt');
    if (txt) txt.textContent = nice >= 1000 ? (Math.round(nice / 100) / 10) + ' km' : Math.round(nice) + ' m';
  });
};
</script>"""








def _reihen_json(cfg, total_stats, ds_points, cum_dist, cum_time, eles, *, extra_keys):
    """Per-Punkt-Reihen der HTML-Seite (Tempo, Steigung, Sensoren — für die Einfärbung
    des Tracks) und ob Zeit/Höhe vorliegen. 30.09.2026: früher `_overlay_teile`, das auch
    die Stats-Boxen baute; die Einblendungen kommen jetzt als Container-HTML."""
    has_time = bool(total_stats.get('duration_s'))
    has_ele = total_stats.get('ele_max') is not None and total_stats.get('ele_min') is not None
    speed_kmh, grade_pct, _moving_s, _max_kmh = _overlay_compute_speed_grade(ds_points, cum_dist, cum_time, eles, has_time, has_ele)
    speed_json = json.dumps([round(x, 2) for x in speed_kmh])
    grade_json = json.dumps([round(x, 2) for x in grade_pct])
    sensor_series_json = _overlay_sensor_series_json(ds_points, [], extra_keys=extra_keys)
    return (speed_json, grade_json, sensor_series_json, has_time, has_ele)


def _stage_fb_json(cfg) -> str:
    """29.09.2026 — Name für Etappen ohne eigenen Namen, in der App-Sprache.
    Als JSON-Paar [vor, nach] um die Etappennummer (Vorlage „Etappe {n}")."""
    _t = _i18n.uebersetzer(getattr(cfg, "ui_lang", ""))
    vorlage = _t("animator.stage_fallback_name", "Etappe {n}") or "Etappe {n}"
    if "{n}" not in vorlage:
        vorlage = vorlage + " {n}"
    vor, nach = vorlage.split("{n}", 1)
    return json.dumps([vor, nach])


def _seg_masken(cfg, ds_points) -> list:
    """Unsichtbare Stücke (Etappen-Übergänge) + Logbuch-Masken als [[i, j]] bzw.
    [[i, j, deckkraft]] über die Render-Punkte (24.09.2026). Synchron zu
    `_segStartsSetzen` in modules/animator/ui/module.js."""
    out = [list(x) for x in core_gpx_bereiche(ds_points)]
    n = len(ds_points)
    for m in (getattr(cfg, "logbuch_masken", None) or []):
        try:
            a = int(round(max(0.0, min(1.0, float(m.get("von", 0)))) * (n - 1)))
            b = int(round(max(0.0, min(1.0, float(m.get("bis", 0)))) * (n - 1)))
            d = float(m.get("deckkraft", 0) or 0)
        except (TypeError, ValueError, AttributeError):
            continue
        if b > a:
            out.append([a, b] if d <= 0 else [a, b, round(max(0.0, min(1.0, d)), 3)])
    return out


def _make_html(cfg: AnimatorConfig, ds_points: list[TrackPoint], cum_dist: list[float],
               cum_time: list[float], total_stats: dict,
               bbox: tuple[float, float, float, float],
               tours: "list | None" = None,
               schwarm_tours: "list | None" = None) -> str:
    # Alpha-Modus: keine Mapbox-Map, nur Track + Punkt + Overlays auf
    # transparentem Hintergrund (für Composit über echtes Video in NLEs).
    # 03.09.2026 — Stil auflösen: Anbieter, Engine, Gelände und Nennung kommen
    # aus core/mapstyles.py. Ausweichen (kein Schlüssel, keine Abdeckung) wird
    # dort entschieden und hier nur noch protokolliert — nie abgebrochen.
    _osm = bool(getattr(cfg, "use_osm", False))
    if _osm and getattr(cfg, "osm_tiles_url", None):
        # Interaktiver HTML-Export mit ausdrücklich gewählter Kachelquelle
        # (Web-Karte/Tour-Map-HTML). `{s}` (Leaflet-Subdomains) expandieren,
        # MapLibre kennt das nicht.
        _osm_url = cfg.osm_tiles_url
        _tiles = ([_osm_url.replace("{s}", sd) for sd in ("a", "b", "c")]
                  if "{s}" in _osm_url else [_osm_url])
        _spec = {
            "key": "osm", "requested": cfg.map_style, "engine": "maplibre",
            "style": _mapstyles.raster_style(_tiles, maxzoom=int(getattr(cfg, "osm_max_zoom", 19) or 19),
                                             attribution=str(getattr(cfg, "osm_attribution", None)
                                                             or "&copy; OpenStreetMap contributors"),
                                             dpr=_render_dsf(cfg.width, cfg.height) * _render_ss(cfg.width, cfg.height)),
            "terrain": (_mapstyles.terrain_source("aws") if cfg.enable_terrain else None),
            "attribution": (_mapstyles.TERRAIN["aws"]["attribution"] if _zoff_on(cfg) else ""),
            "region": None, "notes": [], "badge": "free", "video_ok": True, "provider": "osm",
        }
    else:
        _spec = _mapstyles.resolve(
            cfg.map_style if (not _osm or cfg.map_style in _mapstyles.STYLE_BY_KEY) else "osm",
            mapbox_token=cfg.mapbox_token or "", maptiler_key=getattr(cfg, "maptiler_key", "") or "",
            bbox=bbox, want_terrain=bool(cfg.enable_terrain),
            proxy_base=getattr(cfg, "tile_proxy_base", "") or "",
            # 04.09.2026: Orte/Straßen/… als Vektor-Overlay über Rasterkarten (synchron zur Vorschau)
            labels={"places": bool(cfg.show_place_labels and not cfg.hide_labels),
                    "roads": bool(cfg.show_road_labels and not cfg.hide_labels),
                    "pois": bool(cfg.show_poi_labels and not cfg.hide_labels),
                    "transit": bool(cfg.show_transit_labels and not cfg.hide_labels),
                    "admin": bool(cfg.show_admin_boundaries)},
            ortho={"sat": getattr(cfg, "ortho_sat", 25.0), "con": getattr(cfg, "ortho_con", 8.0),
                   "bri": getattr(cfg, "ortho_bri", 0.0), "hue": getattr(cfg, "ortho_hue", 0.0),
                   "relief": getattr(cfg, "ortho_relief", 0.0)},   # 17.09.2026 — Relief-Ebene im Stapel
            # 07.09.2026: Kacheldichte am Pixelmaßstab des Renders (DSF × SSAA), s. mapstyles.tile_size_for
            dpr=_render_dsf(cfg.width, cfg.height) * _render_ss(cfg.width, cfg.height))
    cfg.map_engine = _spec["engine"]
    cfg.map_spec = _spec
    if not _spec["terrain"]:
        cfg.enable_terrain = False
    for _n in _spec["notes"]:
        _log.warning("Kartenstil: %s", _n)
    _log.info("Kartenstil: %s (gewünscht %s) · Engine %s · Gelände %s · Region %s",
              _spec["key"], _spec["requested"], _spec["engine"],
              "ja" if _spec["terrain"] else "nein",
              (_spec["region"] or {}).get("name", "–"))
    _osm = _spec["engine"] == "maplibre"    # alter Name, neue Bedeutung: MapLibre-Engine
    style_expr = (json.dumps(_spec["style"]) if isinstance(_spec["style"], dict)
                  else "'" + str(_spec["style"]).replace("'", "\\'") + "'")
    # Karten-Engine: Mapbox GL JS nur für Mapbox-Stile (verlangt Token und darf
    # mit fremden Kacheln nicht betrieben werden); alles andere MapLibre GL JS.
    # `mapboxgl` wird auf `maplibregl` aliased, damit der Render-JS-Code gleich bleibt.
    if _osm:
        gl_head = _maplibre_gl_head()
        gl_token_js = "window.mapboxgl = maplibregl;"
    else:
        gl_head = _mapbox_gl_head()
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
        _zoff_frag = ",'line-z-offset':150" if _zoff_on(cfg) else ""
        _layers = ["for (let i=0;i<TOUR_N;i++){", "  const __col = TOUR_COLORS[i];",
                   "  map.addSource('mtrack'+i, {type:'geojson', data:{type:'Feature',geometry:{type:'LineString',coordinates:[]}}});"]
        if cfg.shadow_enabled and cfg.shadow_strength > 0:
            _layers.append(
                "  map.addLayer({id:'mtrack'+i+'-shadow',type:'line',source:'mtrack'+i,"
                "layout:{'line-cap':'round','line-join':'round'},"
                "paint:{'line-color':'rgba(0,0,0,0.7)',"
                f"'line-width':{cfg.line_width * 2.2:.2f},'line-blur':{cfg.shadow_strength:.1f},"
                f"'line-translate':[{_shadow_dxdy(cfg)[0]:.1f}, {_shadow_dxdy(cfg)[1]:.1f}]{_dash_frag}}}}});")
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
            "  try { if (window.__rzStarsManual && window.rzStarsTick) rzStarsTick(map.getContainer(), (window.__rzStarsFrame++) / (window.__rzStarsFps || 30)); } catch(_){}\n"
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
            "  const g = (TOUR_OFFSETS[tourIdx]||0) + li;\n"
            "  window.__rzSetCam(brg, lon, lat, zm, pt, Math.max(0, Math.min(g, totalPoints-1)));\n"
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
    # 23.08.2026 — Etappengrenzen: Index jedes Punktes, an dem eine neue Etappe
    # beginnt (mehrere <trk>/<trkseg> in einer Datei, später auch die
    # zusammengefügten Mehr-Touren-Tracks). Das Verbindungsstück davor gehört zu
    # keiner Etappe und wird unsichtbar gezeichnet — sonst zieht sich ein Strich
    # quer über die Karte. Distanz und Zeit zählen es ohnehin nicht mit (gpx.py).
    seg_starts_json = json.dumps(_seg_masken(cfg, ds_points))
    dot_hidden_json = json.dumps(core_gpx_dot(ds_points))
    _etappen = core_gpx_etappen(ds_points, (total_stats or {}).get("seg_names"))
    stage_nr_json = json.dumps(_etappen["nr"])
    stage_d0_json = json.dumps([round(x, 2) for x in _etappen["d0"]])
    stage_t0_json = json.dumps([round(x, 2) for x in _etappen["t0"]])
    stage_name_json = json.dumps(_etappen["name"])
    stage_total_json = json.dumps(_etappen["gesamt"])
    stage_fb_json = _stage_fb_json(cfg)
    seg_mask_js = _SEG_MASK_JS + _GRAD_LUECKEN_JS
    eles = [p.ele if p.ele is not None else 0.0 for p in ds_points]
    elevations_json = json.dumps(eles)
    total_asc_json = json.dumps(round(float(total_stats.get("ascent_m") or 0), 1))
    total_desc_json = json.dumps(round(float(total_stats.get("descent_m") or 0), 1))
    cum_dist_json = json.dumps(cum_dist)
    cum_time_json = json.dumps(cum_time)
    # 11.09.2026 — absolute Zeit je Punkt + Zeitzone (Datum/Uhrzeit-Felder).
    _ep = [_zeit.epoch_von_iso(getattr(p, "time", None)) for p in ds_points]
    _ep_da = [e for e in _ep if e is not None]
    _e1, _e2 = (_ep_da[0], _ep_da[-1]) if _ep_da else (None, None)
    _mid = ds_points[len(ds_points) // 2] if ds_points else None
    _tzn = getattr(cfg, "tz_name", "") or _zeit.zone_fuer(getattr(_mid, "lat", None), getattr(_mid, "lon", None))
    _tz_off = _zeit.offset_min(_tzn, _e1)
    epoch_json = json.dumps(_ep)
    tz_off_json = json.dumps(_tz_off)
    lang_json = json.dumps(getattr(cfg, "ui_lang", "") or "de")
    zeit_js = _zeit.JS_FORMATE
    # v0.9.435 — Mehrfarbiger Track: Helper + Konstanten fürs Render-Template.
    # Quelle bestimmt, wonach eingefärbt wird (Distanz/Höhe/Tempo). Stop-Wert unter
    # "v" (Legacy: "km"). Stops nach Wert sortieren; bei Distanz Wert 0 mit line_color
    # seed'en (falls kein Stop bei 0). Metrik-Array-Name (elevations/speedKmh) wird als
    # 7. Arg an __rzColorGradient übergeben; bei Distanz → null.
    # v0.9.448 — Quelle ist JEDE Datenreihe des Tracks, nicht mehr nur Höhe/Tempo:
    # abgeleitet (ele/speed/grade) oder Sensor-Key (heart_rate, power, cadence, …).
    # "elevation" bleibt als Legacy-Alias lesbar (Projekte bis v0.9.447).
    _csrc = str(getattr(cfg, "track_colors_source", "distance") or "distance")
    if _csrc == "elevation":
        _csrc = "ele"

    def _stopv(s):
        return float(s.get("v", s.get("km", 0)) or 0)
    _stops = [s for s in (cfg.track_color_stops or [])
              if isinstance(s, dict) and ("v" in s or "km" in s) and "color" in s]
    _stops = sorted(_stops, key=_stopv)
    if _csrc == "distance" and _stops and _stopv(_stops[0]) > 0.0001:
        _stops = [{"v": 0.0, "color": cfg.line_color}] + _stops
    _colors_on = bool(cfg.track_colors_enabled) and len(_stops) >= 1
    color_gradient_js = _COLOR_GRADIENT_JS if _colors_on else "// track colors disabled"
    line_color_json = json.dumps(cfg.line_color)
    # 23.08.2026 — „Farbe je Tour": {Etappennummer: "#rrggbb"} aus dem Projekt.
    tour_colors_json = json.dumps(getattr(cfg, "tour_colors", None) or {})
    colors_on_js = "true" if _colors_on else "false"
    color_source_json = json.dumps(_csrc)
    # 🌊 Schwarm (IDEAS §38): Zusatz-Touren, die gleichzeitig mitlaufen.
    _sw = schwarm_tours or []
    schwarm_coords_json = json.dumps([t["coords"] for t in _sw])
    schwarm_colors_json = json.dumps([t.get("color") or cfg.line_color for t in _sw])
    schwarm_steps_json = json.dumps([max(0.5, float(t.get("step_m") or 1.0)) for t in _sw])
    # 29.08.2026 (Marc: „bergauf/bergab/vergangen zeigen nur den Haupttrack"):
    # Live-Felder summieren im Schwarm über ALLE Touren — je Tour anteilig
    # zum eigenen Fortschritt (exakt am Ziel, monoton dazwischen).
    schwarm_asc_json = json.dumps([round(float((t.get("stats") or {}).get("ascent_m") or 0), 1) for t in _sw])
    schwarm_desc_json = json.dumps([round(float((t.get("stats") or {}).get("descent_m") or 0), 1) for t in _sw])
    schwarm_dur_json = json.dumps([round(float((t.get("stats") or {}).get("duration_s") or 0), 1) for t in _sw])
    # 29.08.2026 (Marc): Start-Verzögerung je Tour — als ANTEIL der Animation
    # (Sekunden ÷ Animationsdauer), damit alle Modi dieselbe Sprache sprechen.
    _anim_dauer = max(0.1, float(getattr(cfg, "duration_s", 0) or 0) or 20.0)
    # 31.08.2026 (Beta-Tester): Pfeil-Form für alle Schwarm-Touren — nur wenn die
    # Haupt-Tour selbst den Pfeil nutzt UND das Häkchen gesetzt ist.
    # 09.09.2026 — die Form gehört jedem Track (stil.dot_style); „Pfeil für alle"
    # gibt es nicht mehr, der Schalter bleibt nur für alte Projekte lesbar.
    schwarm_dot_arrow_js = "false"
    schwarm_start_json = json.dumps([
        round(min(0.95, max(0.0, float(t.get("start_s") or 0) / _anim_dauer)), 4)
        for t in _sw])
    # M3 — gewählte Zeitachse je Tour (roh = mit Pausen, bew = gestutzt) und
    # gemeinsame Achse = längste Dauer (Haupt-Track zählt mit; er selbst läuft
    # als Zeitachse weiter linear — seine Pausen sind im Video geglättet).
    _modus = str(getattr(cfg, "schwarm_modus", "gleich") or "gleich")
    if _modus not in ("gleich", "ziel", "uhrzeit"):
        _modus = "gleich"
    _pausen = bool(getattr(cfg, "schwarm_pausen", True))
    _zeitkey = "t_roh" if _pausen else "t_bew"
    _zeiten = [t.get(_zeitkey) for t in _sw]
    _dauern = [(z[-1] if z else 0.0) for z in _zeiten]
    _haupt_dauer = float((total_stats.get("duration_s") if _pausen
                          else (total_stats.get("moving_time_s") or total_stats.get("duration_s"))) or 0.0)
    schwarm_modus_json = json.dumps(_modus)
    schwarm_t_json = json.dumps(_zeiten if _modus == "uhrzeit" else [None] * len(_sw))
    schwarm_t_axis_json = json.dumps(round(max([_haupt_dauer] + _dauern), 1) if _modus == "uhrzeit" else 0)
    _haupt_dezent = bool(_sw) and bool(getattr(cfg, "schwarm_haupt_dezent", False))
    # Dezent-Modus: cfg.line_width wurde oben schon auf Schwarm-Breite gesetzt —
    # die Zusatz-Touren nehmen dann 1:1 dieselbe Breite (sonst 0.8×).
    schwarm_line_width_json = json.dumps(round(max(0.5, float(cfg.line_width or 3.0)
                                                   * (1.0 if _haupt_dezent else 0.8)), 2))
    haupt_dezent_js = "true" if _haupt_dezent else "false"
    # 09.09.2026 — Breite je Tour (Aussehen je Track); ohne eigene Breite die
    # gemeinsame Schwarm-Breite von oben.
    _sw_basis = max(0.5, float(cfg.line_width or 3.0) * (1.0 if _haupt_dezent else 0.8))
    schwarm_widths_json = json.dumps([round(max(0.5, float(t.get("width") or _sw_basis)), 2) for t in _sw])
    # 09.09.2026 — Aussehen und Laufpunkt je Tour (Schatten, Glow, Muster, Röhre,
    # Kugel/Pfeil/Größe). Fehlt ein Feld, gilt die Haupt-Tour. Synchron zu
    # _swPrevBauen in module.js.
    def _sw_zahl(st, k, d):
        try:
            return float(st.get(k)) if st.get(k) not in (None, "") else float(d)
        except (TypeError, ValueError):
            return float(d)
    _sw_stil, _sw_dash_keys = [], {}
    for t in _sw:
        st = t.get("stil") or {}
        ls = str(st.get("line_style") or cfg.line_style or "solid")
        sp = _sw_zahl(st, "spacing", cfg.line_style_spacing or 1.0)
        base = _DASH_BASE.get(ls)
        dash = [round(v * max(0.1, sp), 2) for v in base] if base else None
        dk = f"{ls}|{sp:g}" if dash else "solid"
        _sw_dash_keys.setdefault(dk, dash)
        ds = st.get("dot_show")
        _sw_stil.append({
            "width": round(max(0.5, float(t.get("width") or _sw_basis)), 2),
            "shadow": _sw_zahl(st, "shadow", cfg.shadow_strength if cfg.shadow_enabled else 0),
            "glow": _sw_zahl(st, "glow", cfg.glow_strength if cfg.glow_enabled else 0),
            "dk": dk, "tube": 1 if ls == "tube" else 0,
            "dotShow": bool(cfg.marker_dot_show) if ds is None else bool(ds),
            "dotStyle": "arrow" if str(st.get("dot_style") or cfg.marker_dot_style) == "arrow" else "dot",
            "dotSize": max(0.1, _sw_zahl(st, "dot_size", cfg.marker_dot_size or 1.0)),
        })
    schwarm_stil_json = json.dumps(_sw_stil)
    schwarm_dash_json = json.dumps([{"key": k, "dash": d} for k, d in _sw_dash_keys.items()])
    _sw_schatten = [x["shadow"] for x in _sw_stil if x["shadow"] > 0]
    _sw_smittel = (sum(_sw_schatten) / len(_sw_schatten)) if _sw_schatten else 0.0
    _sw_sr = math.radians(float(getattr(cfg, "shadow_dir", 45.0) or 45.0))
    schwarm_shadow_tr_json = json.dumps([round(_sw_smittel * math.cos(_sw_sr), 2), round(_sw_smittel * math.sin(_sw_sr), 2)])
    # Bei 3D-Gelände brauchen die Linien denselben z-Offset wie der Haupt-Track,
    # sonst verschwinden sie im Berg.
    schwarm_zoff_frag = ", 'line-z-offset': 150" if _zoff_on(cfg) else ""
    color_stops_km_json = json.dumps([_stopv(s) for s in _stops])
    color_stops_col_json = json.dumps([str(s["color"]) for s in _stops])
    color_mode_json = json.dumps("gradient" if str(cfg.track_colors_mode) == "gradient" else "hard")
    # Metrik-JS-Ausdruck. Die abgeleiteten Reihen sind eigene Template-Konstanten,
    # alle übrigen liegen in `sensorSeries` (key → [werte], Lücken mit null). Für
    # Sensoren die Lücken hier im JS füllen — sonst reißt der Verlauf ab
    # (identisch zu `heightanim._fill_gaps` und `metricArrFor` in der Vorschau).
    if _csrc == "distance":
        color_metric_js = "null"
    elif _csrc in ("ele", "speed", "grade"):
        color_metric_js = {"ele": "elevations", "speed": "speedKmh", "grade": "gradePct"}[_csrc]
    else:
        color_metric_js = f"__rzFillGaps(sensorSeries[{json.dumps(_csrc)}])"
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
    # v0.9.448 — die Reihe, nach der eingefärbt wird, MUSS in `sensorSeries` landen,
    # auch wenn sie in keinem Overlay-Feld vorkommt (siehe _csrc oben).
    # 28.08.2026 (IDEAS §38 M2) — Schwarm-Felder nur im Mapbox-HTML.
    (speed_json, grade_json, sensor_series_json, has_time, has_ele) = _reihen_json(
        cfg, total_stats, ds_points, cum_dist, cum_time, eles,
        extra_keys=[_csrc] if _csrc not in ("distance", "ele", "speed", "grade") else [])
    # 30.09.2026 — Einblendungen: Container-HTML aus der Vorschau (Web-Karte); Videos laufen
    # alle über die Szene (core/szene.py) und brauchen diese Seite nicht mehr.
    live_update_js = ""
    overlays_block = _container_block(cfg) + _north_scale_js()
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
        # Geometrie-Schalter (synchron zur Vorschau, s. applyHideLabels):
        # Standard-Styles zeichnen Straßen/Wege/Fährrouten unabhängig von den
        # Label-Properties — nur showRoadsAndTransit blendet die Linien aus.
        "  try { map.setConfigProperty('basemap', 'showRoadsAndTransit', showRoad || showTransit); } catch(_){}"
        # Classic-Style Layer-ID-Heuristik
        "  const s = map.getStyle(); if(!s || !s.layers) return;"
        "  s.layers.forEach(l => {"
        "    if (l.type !== 'symbol' && l.type !== 'line') return;"
        "    const id = l.id.toLowerCase();"
        "    let want = null;"
        "    if (/^(preview-|track-|mtrack|schwarm|anim-|ghost|dot-|rz-dim|rz-north|rz-sign)/.test(id)) return;"
        "    if (id.startsWith('rz-ov-')) { want = ({places: showPlace, roads: showRoad, pois: showPoi, transit: showTransit, admin: showAdmin})[id.split('-')[2]];"
        "      if (want == null) return; try { map.setLayoutProperty(l.id, 'visibility', want ? 'visible' : 'none'); } catch(_){} return; }"
        "    if (id.includes('admin') || id.includes('boundary') || id.includes('country-boundary')) want = showAdmin;"
        "    else if (id.startsWith('label_') || id.startsWith('water_name') || id.startsWith('waterway_line_label')) want = showPlace;"
        # MapTiler-Stile (04.09.2026, Beta-Tester): 'City labels', 'Sport', 'Station', … — Namen in Klartext
        "    else if (/^(city|state|country|continent|town|village|capital city|place|peak|volcano|river|water|ocean|lake)\\b.* labels?( \\(us\\))?$/.test(id)) want = showPlace;"
        "    else if (/^(sport|food|tourism|culture|shopping|park( labels)?|healthcare|education|public|outdoor( shop| water)?|castle|housenumber)$/.test(id)) want = showPoi;"
        "    else if (/^(station|transport|gondola|aerialway labels|airport( gate)?|ferry)$/.test(id)) want = showTransit;"
        "    else if (id.startsWith('highway-name') || id.startsWith('highway-shield') || id.startsWith('road_shield')) want = showRoad;"
        # 05.09.2026 — Straßen-/Bahn-LINIEN auf OpenFreeMap/MapTiler mit ausblenden (synchron zu applyHideLabels)
        "    else if (l.type === 'line' && /^(road|highway|street|path|bridge|tunnel|footway|cycleway|motorway|trunk|primary|secondary|tertiary|minor|service|pedestrian)/.test(id)) want = showRoad;"
        "    else if (l.type === 'line' && /^(rail|railway|transit|ferry|aerialway|tram|subway)/.test(id)) want = showTransit;"
        "    else if (id.includes('road') || id.includes('street') || id.includes('path')) want = (l.type === 'line') ? null : showRoad;"
        "    else if (id.includes('poi')) want = showPoi;"
        "    else if (id.includes('transit') || id.includes('airport') || id.includes('rail') || id.includes('ferry')) want = showTransit;"
        "    else if (id.includes('place') || id.includes('settlement') || id.includes('country-label') || id.includes('state-label')) want = showPlace;"
        "    if (want === null) return;"
        "    try { map.setLayoutProperty(l.id, 'visibility', want ? 'visible' : 'none'); } catch(_){}"
        "  });"
        "})();"
    )
    # 03.09.2026 — Weltkugel auch in MapLibre (Style-URLs setzen sie nach dem
    # Laden; Raster-Stile tragen `projection` im JSON) + Weltraum-Hintergrund.
    # 05.09.2026 — Sterne mit Reglern (rz-stars.js, Takt je Bild aus advanceFrame) und
    # Karten-Optik (rz-mapadjust.js): Luftbilder tragen ortho_* schon im Stil, alle
    # anderen Stile bekommen map_* live — Raster als Paint, Vektor als Abdunkel-Ebene.
    _stars = {"enabled": bool(cfg.stars_enabled), "density": float(cfg.stars_density),
              "size": float(cfg.stars_size), "twinkle": bool(cfg.stars_twinkle)}
    _madj = {"sat": float(cfg.map_sat), "con": float(cfg.map_con), "bri": float(cfg.map_bri), "hue": float(cfg.map_hue)}
    globe_block = ("" if _spec["engine"] == "mapbox" else
                   "    try { const _pr = map.getProjection && map.getProjection();"
                   " if (map.setProjection && (!_pr || _pr.type !== 'globe')) map.setProjection({type:'globe'}); } catch(_){}\n"
                   f"    try {{ window.__rzStarsManual = true; window.__rzStarsOpts = {json.dumps(_stars)}; window.__rzStarsFps = {int(cfg.fps)};"
                   " window.__rzStarsFrame = 0; if (window.rzStarsApply) rzStarsApply(map.getContainer(), window.__rzStarsOpts);"
                   " else map.getContainer().style.background = '#05070d'; } catch(_){}\n"
                   + ("" if _spec.get("kind") == "gov" else
                      f"    try {{ if (window.rzApplyMapAdjust) rzApplyMapAdjust(map, {json.dumps(_madj)}, {{sat:0,con:0,bri:0,hue:0}}); }} catch(_){{}}\n"))
    # 07.09.2026 — Schärfe (Unschärfemaske, rz-mapadjust.js) auf der Leinwand, alle Engines (CSS-Filter)
    # 17.09.2026 — Dunst auf derselben Ebene (rzApplyMapLook = Schärfe + Dunst); rzApplyMapSharpen bleibt als Rückfall
    _haze = float(getattr(cfg, "map_haze", 0) or 0)
    sharp_block = ("" if (float(getattr(cfg, "map_sharp", 0) or 0) <= 0 and _haze <= 0) else
                   f"    try {{ if (window.rzApplyMapLook) rzApplyMapLook(map, {float(cfg.map_sharp):.1f}, {_haze:.1f});"
                   f" else if (window.rzApplyMapSharpen) rzApplyMapSharpen(map, {float(cfg.map_sharp):.1f}); }} catch(_){{}}\n")
    # Diagnose-Knöpfe (nur Env, Prüfstand): RZ_RTT_Q = Textur-Faktor der Gelände-Drapierung, RZ_MESH = Netzauflösung je Kachel
    # 06.09.2026 (Marc: „einzelne gezeichnete tracks flimmern", Teneriffa-Schwarm 4K):
    # MapLibre drapiert Linien AUF das Geländenetz — Grate verdecken sie stückweise,
    # bei Kamerabewegung wandert die Kante → Flimmern. Mit Gelände zeichnet der
    # Schwarm seine Linien deshalb über rz-line3d.js 150 m über dem Gelände (wie
    # Mapbox mit line-z-offset). Ohne Gelände bleibt die normale Linien-Ebene.
    # 09.09.2026 — mit Schatten/Glow/Muster je Tour drapiert wie die Hauptlinie (rz-line3d
    # kennt nur Farbe und Breite); synchron zu _swPrevGestaltet in module.js.
    _sw_gestaltet = any(x["shadow"] > 0 or x["glow"] > 0 or x["dk"] != "solid" for x in _sw_stil)
    sw3d_js = "true" if (cfg.enable_terrain and _spec.get("terrain") and getattr(cfg, "map_engine", "mapbox") != "mapbox" and not _sw_gestaltet) else "false"
    _rz_terrain_extra = ""
    if os.environ.get("RZ_RTT_Q"): _rz_terrain_extra += f", qualityFactor: {int(os.environ['RZ_RTT_Q'])}"
    _rz_terrain_extra += f", meshSize: {int(os.environ.get('RZ_MESH') or 128)}"   # 06.09.2026 — Vendor-Patches stitch/skirtoffset wirken auch hier
    terrain_block = ""
    if cfg.enable_terrain and _spec.get("terrain"):
        # Gelände hängt am Stil (Mapbox-DEM / MapTiler terrain-rgb / AWS terrarium).
        # Quellname bleibt 'mapbox-dem', weil der Render-JS-Code ihn so kennt.
        terrain_block = f"""
    map.addSource('mapbox-dem', {json.dumps(_spec["terrain"])});
    map.setTerrain({{ source: 'mapbox-dem', exaggeration: {cfg.exaggeration}{_rz_terrain_extra} }});
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
    # 03.09.2026 — Nennung nie einklappen: unter 640 px CSS-Breite (Hochkant-
    # Videos!) machen beide Bibliotheken aus der Nennung sonst ein „i"-Knöpfchen.
    # Mapbox wie MapTiler verlangen die sichtbare Nennung im Bild.
    _extra_attr = str(_spec.get("attribution") or "").replace("'", "\\'")
    # 07.09.2026 — Modus «kurz»: Quellen-Nennungen aus dem Stil nehmen, eine knappe Zeile aus dem Register setzen
    if str(getattr(cfg, "attrib_mode", "voll") or "voll") == "kurz":
        from core import kartenquellen as _kq
        _ids = [r for r in ((_spec.get("rights") or {}).get("quellen") or {}).keys()]
        if isinstance(_spec.get("style"), dict):
            for _src in (_spec["style"].get("sources") or {}).values():
                if isinstance(_src, dict) and "attribution" in _src:
                    _src["attribution"] = ""
            style_expr = json.dumps(_spec["style"])
        # 29.09.2026 — „bearbeitet"/„Quellen" stehen im Video: in der App-Sprache,
        # dieselben Schlüssel wie der JS-Spiegel rzKurzNennung (Vorschau = Render).
        _ta = _i18n.uebersetzer(getattr(cfg, "ui_lang", ""))
        _extra_attr = _kq.kurz_nennung(_ids, str(getattr(cfg, "attrib_link", "") or ""),
                                       bearbeitet=_ta("attrib.bearbeitet", "bearbeitet"),
                                       quellen_wort=_ta("attrib.quellen", "Quellen")).replace("'", "\\'")
    common_opts = (
        "  preserveDrawingBuffer:true, antialias:true, fadeDuration:0,\n"
        "  prefetchZoomDelta:6, attributionControl:false, maxPitch:85\n"   # maxPitch: MapLibre-Standard 60 klemmte Keyframes (04.09.2026)
    )
    attribution_init = (
        "map.addControl(new mapboxgl.AttributionControl({compact:false"
        + (f", customAttribution:'{_extra_attr}'" if _extra_attr else "")
        + "}), 'bottom-right');"
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
        # v0.9.415 — Interaktiver Export läuft mit derselben Karten-Engine und in
        # CSS-Pixeln (kein device_scale_factor wie beim Render) → KEINE dsf-Zoom-
        # Korrektur, und der Init-Bearing ist die echte Vorschau-Drehung (nicht der
        # Animations-Start -10). So springt der Export-Bootstrap auf exakt die
        # Vorschau-Kamera, ohne sichtbaren Dreh/Zoom beim Laden.
        if getattr(cfg, "interactive_export", False):
            _ov_zoom = cfg.override_zoom
            _init_bearing = float(cfg.bearing)
        else:
            _ov_zoom = cfg.override_zoom - (math.log2(_ov_dsf) if _ov_dsf > 0 else 0.0)
            _init_bearing = -10
        map_init = (
            f"const map = new mapboxgl.Map({{\n"
            f"  container:'map', style:{style_expr},\n"
            f"  center: [{ovc[0]}, {ovc[1]}],\n"
            f"  zoom: {_ov_zoom},\n"
            f"  pitch:{cfg.pitch}, bearing:{_init_bearing},\n"
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
        # 14.09.2026 — Vorschaubilder NICHT mehr je Render aus den Originalen
        # rechnen: gespeichertes `thumb` des Schilds oder Platten-Cache
        # (sign_thumbs_vorbereiten, oben). Setzt s["thumb"] in place.
        sign_thumbs_vorbereiten(_signs_input, float(getattr(cfg, "render_scale", 1.0) or 1.0))
        def _sign_thumb(s):
            th = s.get("thumb")
            return th if isinstance(th, str) and th else None
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
            "shadowDir": float(cfg.shadow_dir),   # v0.9.478 — globale Lichtquelle (Richtung)
            # Verhalten
            "zoomScale": bool(_sg(s, "zoomScale", True)),
            "alwaysVisible": bool(_sg(s, "alwaysVisible", False)),
            "before": float(_sg(s, "before", 0)),
            "after": float(_sg(s, "after", 0)),
            "entry": _sg(s, "entry", "none"),
            # 29.09.2026 — Blenden wie bei den Overlays (None = altes Verhalten in rzSignMeta)
            "entry_s": _sg(s, "entry_s", None),
            "exit": _sg(s, "exit", None),
            "exit_s": _sg(s, "exit_s", None),
            # v0.9.189 — Schild MIT Bild (= Foto-Karte). Thumb serverseitig erzeugen.
            "imageSrc": str(_sg(s, "imageSrc", "") or ""),
            "thumb": _sign_thumb(s),
            "imageSize": float(_sg(s, "imageSize", 60)),  # v0.9.190 — Bildbreite separat
            "minWidth": float(_sg(s, "minWidth", 0) or 0),  # v0.9.479 — feste Mindestbreite (px, 0=auto) → Text-Ausrichtung sichtbar
            "decoScale": float(_sg(s, "decoScale", 0.5)),  # v0.9.262 — Stangen-Länge (Banner/Wegweiser); fehlte → Render nahm immer 0.5
            "direction": ("left" if _sg(s, "direction", "right") == "left" else "right"),  # v0.9.387 — Wegweiser-Pfeilrichtung
            # v0.9.408 — Sprechblasen-Pfeilrichtung: bottom|top|left|right (Default bottom).
            "calloutDir": (_sg(s, "calloutDir", "bottom") if _sg(s, "calloutDir", "bottom") in ("top", "left", "right") else "bottom"),
            # v0.9.481 — Zeiger (Sprechblasen-Spitze / Stecknadel) getrennt vom
            # Hintergrund: eigene Farbe (`auto` = folgt der Box wie bisher) und
            # Position an der Kante. Beides gebeten von einem Beta-Tester, weil
            # der Zeiger bei „Kein Hintergrund" verschwand und mittig oft genau
            # auf der Spur saß.
            "accent": (str(_sg(s, "accent", "auto") or "auto")),
            "tailPos": (_sg(s, "tailPos", "center") if _sg(s, "tailPos", "center") in ("left", "right") else "center"),
            # 30.09.2026 — Symbol der Kennzahl-Stile (pille, hl_*; sign_draw.js RZ_HL_ICONS)
            "icon": str(_sg(s, "icon", "") or ""),
        } for s in _signs_input]
        # v0.9.224/225 — render_scale in die icon-size-Stützwerte gerechnet (s.u.).
        _ss = float(getattr(cfg, "render_scale", 1.0) or 1.0)
        # v0.9.479b — Aufpoppen: jeder Zoom-Stützwert wird mit dem per-Feature-`popScale`
        # multipliziert (Default 1). WICHTIG: der Multiplikator steht INNERHALB der
        # Interpolate-Stops, damit ['zoom'] top-level bleibt (sonst verwirft Mapbox den
        # Layer → gar kein Schild). rzSignApplyFrame schiebt popScale per setData rein.
        # ABER: der datengetriebene (property-abhängige) icon-size-Ausdruck lässt Mapbox
        # das Symbol beim Zoomen minimal anders rastern → „die Buchstaben tanzen" (Beta-
        # Tester, mehrfach gemeldet). v0.9.484: der Layer startet deshalb IMMER mit dem
        # reinen Zoom-Ausdruck; rzSignApplyFrame (in sign_draw.js, unten mit eingebettet)
        # legt den popScale-Faktor nur für die Dauer eines laufenden Aufpoppens drauf und
        # nimmt ihn danach sofort wieder weg. Dafür braucht die Engine den Render-Scale.

        def _sz(v):
            return f"['case',['==',['get','zoomScale'],true],{v * _ss:.4f},{1.0 * _ss:.4f}]"
        # 05.09.2026 — EIN Segment 8…20 (exponentiell): MapLibre klemmt die Größe an
        # den Stützwerten um die KACHEL-Zoomstufe; bei geneigter Kamera springt sie
        # sonst beim Kachelwechsel um ~3 % (Schorfheide). Synchron zu
        # ui/js/sign_draw.js rzSignIconSize — bei Änderung beide pflegen.
        _sign_icon_size = (
            f"['interpolate',['exponential',{SIGN_ZOOM_BASE:.6f}],['zoom'], "
            f"8,{_sz(0.5)}, 20,{_sz(2.4)}]"
        )
        # Gerätepixel-Sigma der Glättung: Ausgabe-px × Supersampling (siehe _map_blur_css unten).
        _signs_glaetten_sigma = (max(0.0, cfg.map_smoothing) * _render_ss(cfg.width, cfg.height)
                                 if _render_ss(cfg.width, cfg.height) > 1.0 else 0.0)
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
            # 14.09.2026 — Pixelmaß nach Zahl der Bild-Schilder, synchron zur Vorschau
            # (modules/animator/ui/module.js _animSignsAttachGPU, ui/js/sign_draw.js rzSignDpr).
            "  const __dprBild = window.__rzSignDpr ? window.__rzSignDpr(__signs.filter(s => s.imageSrc).length) : 2;\n"
            # 20.09.2026 — Render rastert Bild-Schilder feiner (siehe SIGN_BILD_RENDER_MAX_PX).
            f"  const __nBild = __signs.filter(s => s.imageSrc).length;\n"
            f"  const __schaerfe = Math.max(1, Math.min({_ss:.4f}, Math.sqrt({SIGN_BILD_VOLL_ANZAHL} / Math.max(1, __nBild))));\n"
            f"  const __dprFuer = (s) => {{ const w = Math.max(80, Math.round((Number(s.imageSize) || 60) * 5)); return Math.max(__dprBild, Math.min(__dprBild * __schaerfe, {SIGN_BILD_RENDER_MAX_PX} / w)); }};\n"
            "  const __loadImg = (src) => new Promise(res => { const im = new Image(); im.onload=()=>res(im); im.onerror=()=>res(null); im.src=src; });\n"
            # 14.09.2026 — Bilder in Stapeln (SIGN_JS_LADESTAPEL) laden und gleich
            # einhängen, statt EIN Promise.all über alle 2830 Bilder zu halten:
            # weniger gleichzeitig lebende Image-Objekte, Reihenfolge und das
            # Fertig-Signal (__signsReady) bleiben identisch. Das thumb wird nach
            # dem addImage freigegeben — die Karte hat ihre Kopie.
            f"  const __STAPEL = {SIGN_JS_LADESTAPEL};\n"
            "  const __feats = new Array(__signs.length);\n"
            "  for (let __von = 0; __von < __signs.length; __von += __STAPEL) {\n"
            "    const __bis = Math.min(__signs.length, __von + __STAPEL);\n"
            "    const __imgs = await Promise.all(__signs.slice(__von, __bis).map(s => s.thumb ? __loadImg(s.thumb) : Promise.resolve(null)));\n"
            "    for (let i = __von; i < __bis; i++) {\n"
            "      const s = __signs[i], __img = __imgs[i - __von];\n"
            "      const id = 'sign-img-'+i;\n"
            "      let __anchor='bottom';\n"  # v0.9.408 — Sprechblasen-Richtung → icon-anchor pro Schild
            "      try { const o = Object.assign({}, s); if (__img) o.image = __img; if (s.imageSrc) o.__dpr = __dprFuer(s); const im = window.__rzDrawSign(o); if (im && im.anchor) __anchor = im.anchor; if (!map.hasImage(id)) map.addImage(id, im.data, {pixelRatio: im.dpr}); } catch(_){}\n"
            "      s.thumb = null;\n"
            "      const meta = __signMetas[i];\n"
            "      __feats[i] = { type:'Feature', id:i, properties:{ imgId:id, zoomScale: !!s.zoomScale, a_show: meta.a_show, a_hide: meta.a_hide, iconAnchor: __anchor, popScale: 1 },\n"
            "                     geometry:{ type:'Point', coordinates:[s.lon, s.lat] } };\n"
            "    }\n"
            "  }\n"
            "  window.__signFC = {type:'FeatureCollection', features:__feats}; map.__rzSignFC = window.__signFC;\n"  # v0.9.479 — Pop-Scale via setData
            # v0.9.484 — Render-Scale für den Aufpopp-Umschalter (sonst schrumpfen die
            # Schilder im 4K-Render in dem Moment, in dem der popScale-Ausdruck greift).
            f"  map.__rzSignSizeScale = {_ss:.4f}; map.__rzSignPopMode = false;\n"
            "  if (!map.getSource('anim-signs-src')) map.addSource('anim-signs-src', {type:'geojson', data:window.__signFC});\n"
            "  if (!map.getLayer('anim-signs-lyr')) map.addLayer({ id:'anim-signs-lyr', type:'symbol', source:'anim-signs-src',\n"
            "    filter: ['all', ['<=',['get','a_show'], -1], ['>=',['get','a_hide'], -1]],\n"
            "    layout:{ 'icon-image':['get','imgId'],\n"
            # v0.9.224/225 — render_scale in die icon-size-Stützwerte gerechnet
            # (_sign_icon_size, oben). NICHT außen ['*', s, interpolate] — Mapbox
            # verlangt ['zoom'] top-level im interpolate, sonst wird der Layer
            # verworfen → gar kein Schild. WYSIWYG: Schild gleich groß wie Preview.
            f"      'icon-size':{_sign_icon_size},\n"
            "      'icon-anchor':['coalesce',['get','iconAnchor'],'bottom'], 'icon-allow-overlap':true, 'icon-ignore-placement':true,\n"
            "      'icon-pitch-alignment':'viewport', 'icon-rotation-alignment':'viewport' },\n"
            "    paint:{ 'icon-opacity':['coalesce', ['feature-state','op'], 1] }\n"
            "  });\n"
            # 20.09.2026 — „Karte glätten" (4K) trifft nur noch Karte + Strecke: Weichzeichner-
            # Ebene direkt UNTER den Schildern statt CSS-Filter über die ganze Leinwand
            # (ui/js/rz-mapadjust.js rzApplyMapSmooth). Klappt das nicht, greift der alte
            # CSS-Filter als Rückfall — lieber weiche Schilder als flimmernde Karte.
            f"  const __glSigma = {_signs_glaetten_sigma:.4f};\n"
            "  if (__glSigma > 0) { let __ok = false; try { __ok = !!(window.rzApplyMapSmooth && window.rzApplyMapSmooth(map, __glSigma, 'anim-signs-lyr')); } catch (_) {}\n"
            "    if (!__ok) { try { const c = map.getCanvas(); c.style.filter = 'blur(' + (__glSigma / (window.devicePixelRatio || 1)).toFixed(3) + 'px)'; } catch (_) {} } }\n"
            "  window.__signsReady = true;\n"
            "})();\n"
        )
    else:
        signs_block = "// no signs\n"

    # v0.9.210 (Reiseroute) — zusätzlicher Ghost = geladenes Wander-GPX (andere
    # Linie als die animierte Route). Faint + gestrichelt, als eigener Layer.
    # 27.08.2026 — Aus EINEM Ghost wurden beliebig viele. Jeder bekommt eine
    # eigene Quelle UND einen eigenen Layer: Farbe, Breite, Deckkraft und
    # Strichelung sind Paint-Eigenschaften des LAYERS und ließen sich in einem
    # gemeinsamen Layer nicht je Spur unterscheiden (dieselbe Falle wie bei der
    # Etappen-Maske, siehe __rzSegMask).
    _gpx_ghost_js = "// gpx-ghost off"
    _ghosts_alle = ghost_liste(cfg)
    if _ghosts_alle:
        _gg_zoff = ",'line-z-offset':150" if _zoff_on(cfg) else ""
        _teile = []
        for _i, _g in enumerate(_ghosts_alle):
            _koord = json.dumps([[float(c[0]), float(c[1])] for c in _g["coords"]])
            _dash = ""   # 06.09.2026: Strichelung als Geometrie (rz-dash.js) statt dasharray — s. __rzGhostDashRebuild
            _col = str(_g.get("color") or "#7fa8ff")
            _op = max(0.0, min(1.0, float(_g.get("opacity", 0.60))))
            _w = float(_g.get("width", 2.5))
            # Der erste heißt weiter `gpx-ghost` — auf diesen Namen prüfen
            # bestehende Tests und der Reiseroute-Pfad.
            _id = "gpx-ghost" if _i == 0 else f"gpx-ghost-{_i}"
            _teile.append(
                "map.addSource('" + _id + "',{type:'geojson',data:{type:'Feature',"
                "geometry:{type:'LineString',coordinates:" + _koord + "}}});"
                "map.addLayer({id:'" + _id + "',type:'line',source:'" + _id + "',"
                "layout:{'line-cap':'round','line-join':'round'},"
                "paint:{'line-color':'" + _col + "',"
                f"'line-width':{_w:.2f},'line-opacity':{_op:.2f}" + _dash + _gg_zoff + "}});")
        _reg = json.dumps([{"id": ("gpx-ghost" if _i == 0 else f"gpx-ghost-{_i}"), "width": float(_g.get("width", 2.5)),
                            "dashed": bool(_g.get("dashed", True))} for _i, _g in enumerate(_ghosts_alle)])
        _gpx_ghost_js = "".join(_teile) + (
            "window.__rzGhostDashReg = " + _reg + ";\n"
            # 06.09.2026 — Strichelung als Geometrie am Boden (rz-dash.js), Bezug = Fit-Zoom des Videos;
            # Python ruft das nach getInitialView() auf. Gleiche Stücke wie in der Vorschau (WYSIWYG).
            "window.__rzGhostDashRebuild = (zoomVideo) => { try { for (const r of (window.__rzGhostDashReg || [])) {\n"
            "  if (!r.dashed || !window.rzDashGeometry) continue; const src = map.getSource(r.id); const d = src && src._data; const co = d && d.geometry && d.geometry.coordinates;\n"
            "  if (!co || !co.length || d.geometry.type !== 'LineString') continue;\n"
            "  const [dM, gM] = window.rzDashMeters(r.width, [2, 2], zoomVideo, co[0][1]);\n"
            "  src.setData({ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: window.rzDashGeometry(co, dM, gM) } });\n"
            "} } catch (e) { console.warn('ghost dash: ' + e); } };\n")

    # v0.9.286b (Marc-Bug: 4K flimmert „zu scharf") — leichter Tiefpass NUR auf
    # die WebGL-Karte (#map canvas = Satellit + Track-Linie), NICHT auf Overlays/
    # Stats/Foto-Marker (eigene DOM-Geschwister bzw. .mapboxgl-marker außerhalb
    # der canvas) → wie der optische Anti-Moiré-Filter einer Kamera. Tötet das
    # hochfrequente Textur-Shimmer, das SSAA allein nicht wegbekam.
    # Wert in CSS-px; im Capture wird daraus css×dsf×ss px, nach /ss-Downscale
    # css×dsf Output-px. Ziel ~1.3 Output-px → css = 1.3/dsf. Nur bei 4K.
    _blur_dsf = _render_dsf(cfg.width, cfg.height)
    _blur_out_px = max(0.0, cfg.map_smoothing) if _render_ss(cfg.width, cfg.height) > 1.0 else 0.0
    # 20.09.2026 — mit Schildern glättet eine Ebene IN der Leinwand unter den Schildern
    # (signs_block oben); der CSS-Filter über alles bleibt nur für Renders ohne Schilder.
    _hat_schilder = signs_block != "// no signs\n"
    _map_blur_css = (f"  #map canvas {{ filter: blur({_blur_out_px / _blur_dsf:.3f}px); }}\n"
                     if _blur_out_px > 0 and not _hat_schilder else "")

    # v0.9.415 — Interaktiver Export: statischer WYSIWYG-Bootstrap (kein Playwright).
    # Springt beim Laden EINMAL auf die Init-Kamera + volle Strecke (advanceFrame),
    # blendet den Lauf-Punkt aus; danach bleibt die Karte frei zoom-/pan-bar. Da die
    # Schilder asynchron gerastert werden (__rzDrawSign im Besucher-Browser), nach
    # __signsReady erneut seeken, damit ihr Sichtbarkeits-Filter greift.
    # 02.09.2026 — Ruhe des Pfeils (Regler 0–10). Dieselbe Umrechnung wie
    # `kursGlaettung` in ui/js/util.js: 0 → 10 m, 5 → 60 m, 10 → 110 m, und
    # mindestens ein Drittel davon an Punkten. Bei Änderung BEIDE pflegen.
    _kurs_stufe = max(0.0, min(10.0, float(getattr(cfg, "marker_dot_smooth", 5.0) or 0.0)))
    _kurs_basis_m = 10 + _kurs_stufe * 10
    _kurs_min_punkte = max(2, round(_kurs_basis_m / 3))
    # 29.09.2026 — Glättung der Pfeilrichtung entlang der Strecke (σ); Schnell-Video: je nach Tempo
    _kurs_sigma_m = max(float(_kurs_basis_m), float(getattr(cfg, "marker_dot_glatt_m", 0.0) or 0.0))
    _interactive_boot_js = ""
    if getattr(cfg, "interactive_export", False):
        _interactive_boot_js = """
// ===== v0.9.415 Interaktiver Export (WYSIWYG, gleiche Engine wie Video/Standbild) =====
(function(){
  function seek(){
    try {
      var c = map.getCenter();
      window.advanceFrame(totalPoints - 1, map.getBearing(), c.lng, c.lat, map.getZoom(), map.getPitch());
      ['dot-core','dot-glow'].forEach(function(id){
        try { if (map.getLayer(id)) map.setLayoutProperty(id,'visibility','none'); } catch(_){}
      });
    } catch(e) { try { console.error('rz-export seek', e); } catch(_){} }
  }
  function boot(){
    seek();
    var n = 0;
    var iv = setInterval(function(){
      n++;
      if (window.__signsReady || n > 100) { clearInterval(iv); seek(); }
    }, 100);
  }
  if (map && map.loaded && map.loaded()) boot();
  else if (map) map.on('load', boot);
})();
"""

    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8">
{gl_head}
{_container_font_link(cfg)}
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body, html {{ width: 100%; height: 100%; overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }}
  #map {{ width: 100%; height: 100%; }}
{_map_blur_css}{_container_css()}
</style></head>
<body>
<div id="map"></div>
{overlays_block}
<script>
{gl_token_js}
const allCoords = {coords_json};
// 23.08.2026 — Etappen: Startindizes; dazu die GEOMETRISCHE Kumulativlänge
// (inkl. Verbindungsstücke) — `line-progress` misst gezeichnete Länge, während
// cumDistM Etappengrenzen bewusst NICHT mitzählt. Für die Maske brauchen wir
// die Geometrie, für Farbwerte weiterhin cumDistM.
const SEG_STARTS = {seg_starts_json};      // [[i,j], …] unsichtbare Stücke
const DOT_HIDDEN = {dot_hidden_json};      // [[i,j], …] dort ist der Laufpunkt aus
// 23.08.2026 — Etappen-Werte fürs Overlay (siehe gpx.etappen_reihen)
const STAGE_NR = {stage_nr_json}, STAGE_D0 = {stage_d0_json}, STAGE_T0 = {stage_t0_json};
const STAGE_NAME = {stage_name_json}, STAGE_TOTAL = {stage_total_json}, STAGE_FB = {stage_fb_json};
const cumGeoM = (() => {{
  const out = [0];
  for (let i = 1; i < allCoords.length; i++) {{
    const a = allCoords[i - 1], b = allCoords[i];
    const dy = (b[1] - a[1]) * 111320;
    const dx = (b[0] - a[0]) * 111320 * Math.cos((a[1] + b[1]) * Math.PI / 360);
    out.push(out[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }}
  return out;
}})();
{seg_mask_js}
const elevations = {elevations_json};
const cumDistM = {cum_dist_json};
const cumTimeS = {cum_time_json};
const epochS = {epoch_json};   // 11.09.2026 — absolute Zeit je Punkt (Datum/Uhrzeit-Felder)
const TZ_OFF_MIN = {tz_off_json};
const DATE_LANG = {lang_json};
const speedKmh = {speed_json};   // v0.9.321 — Stats-Editor: Pro-Punkt-Tempo
const gradePct = {grade_json};   // v0.9.321 — Pro-Punkt-Steigung %
const sensorSeries = {sensor_series_json};   // v0.9.330 — FIT-Sensorwerte pro Punkt (key → [werte])
// 29.08.2026 (Marc: „warum gibts da nicht auch bergauf bergab?") — kumulierte
// Höhenmeter je Punkt. Roh-Summen über die downsampled Höhen überschätzen
// (Rauschen), darum werden sie auf die GEGLÄTTETEN Gesamtwerte der Stats
// skaliert: das Live-Feld endet exakt beim „Bergauf"-Gesamtwert.
const TOTAL_ASC_M = {total_asc_json};
const TOTAL_DESC_M = {total_desc_json};
const cumAscM = [0], cumDescM = [0];
for (let i = 1; i < elevations.length; i++) {{
  const dE = elevations[i] - elevations[i - 1];
  cumAscM.push(cumAscM[i - 1] + Math.max(0, dE));
  cumDescM.push(cumDescM[i - 1] + Math.max(0, -dE));
}}
(function () {{
  const a = cumAscM[cumAscM.length - 1], b = cumDescM[cumDescM.length - 1];
  if (a > 0 && TOTAL_ASC_M > 0) {{ const f = TOTAL_ASC_M / a; for (let i = 0; i < cumAscM.length; i++) cumAscM[i] *= f; }}
  if (b > 0 && TOTAL_DESC_M > 0) {{ const f = TOTAL_DESC_M / b; for (let i = 0; i < cumDescM.length; i++) cumDescM[i] *= f; }}
}})();
const TOTAL_DIST_M = cumDistM.length ? cumDistM[cumDistM.length - 1] : 0;
// ⚠️ Die Schwarm-Konstanten MÜSSEN vor updateOverlays(0) stehen (28.08.2026:
// „Cannot access 'SCHWARM_N' before initialization" — das Overlay-Feld
// „Noch unterwegs" griff beim Initial-Aufruf auf sie zu, deklariert waren sie
// erst weiter unten beim advanceFrame).
// 🌊 Schwarm (IDEAS §38): weitere Touren, die GLEICHZEITIG mitlaufen. Jede ist
// äquidistant abgetastet (step_m); der Fortschritt wird aus der bereits
// zurückgelegten DISTANZ des Haupt-Tracks abgeleitet (cumDistM[safe] / step) —
// damit gilt „gleiche Geschwindigkeit" in JEDEM Verteilungs-Modus des
// Haupt-Tracks, und Trim/fullTrack verhalten sich von selbst richtig.
const SCHWARM_COORDS = {schwarm_coords_json};
const SCHWARM_COLORS = {schwarm_colors_json};
const SCHWARM_WIDTHS = {schwarm_widths_json};
const SCHWARM_STEPS = {schwarm_steps_json};
const SCHWARM_N = SCHWARM_COORDS.length;
const SCHWARM_3D = {sw3d_js};   // 06.09.2026 — Linien über dem Gelände (rz-line3d) statt drapiert
// 06.09.2026 (Marc, WYSIWYG): Haupt-Track/Ghosts bleiben DRAPIERT wie in der Vorschau — die
// 3D-Ebene sah dicker/kantiger aus als die Vorschau. Code bleibt für IDEAS §53 (Vorschau + Render
// gemeinsam umstellen), bis dahin aus.
const LINES_3D = false;
const TRACK_DASH = {_dasharray_mapbox(cfg.line_style, cfg.line_style_spacing) or 'null'};
if (typeof window !== 'undefined') window.__rzLine3dDebug = {'true' if os.environ.get('RZ_L3D_DEBUG') else 'false'};   // Node-Prüfstand (test_schwarm_m3) hat kein window
// IDEAS §38 M3 — Geschwindigkeitsmodus. 'gleich' = alle gleich schnell,
// 'ziel' = Fotofinish (jede Tour skaliert, alle enden mit dem Video),
// 'uhrzeit' = aufgezeichnete Zeitstempel (gemeinsamer Start; SCHWARM_T je
// Tour: Sekunden am jeweiligen Streckenpunkt, Achse = längste Dauer inkl.
// Haupt-Track; Touren OHNE Zeit laufen gleichmäßig mit — Marcs Entscheid).
const SCHWARM_MODUS = {schwarm_modus_json};
const SCHWARM_T = {schwarm_t_json};
const SCHWARM_T_AXIS = {schwarm_t_axis_json};
const SCHWARM_START = {schwarm_start_json};   // Start-Verzögerung je Tour (Anteil 0..1)
const SCHWARM_DOT_ARROW = {schwarm_dot_arrow_js};   // 31.08.2026 (Beta-Tester): Pfeil für alle Touren — seit 09.09.2026 je Tour (SCHWARM_STIL)
const SCHWARM_STIL = {schwarm_stil_json};
const SCHWARM_DASH = {schwarm_dash_json};
const SCHWARM_SHADOW_TR = {schwarm_shadow_tr_json};
function swarmIdx(i, dNow) {{
  const c = SCHWARM_COORDS[i];
  const frac0 = TOTAL_DIST_M > 0 ? Math.min(1, dNow / TOTAL_DIST_M) : 1;
  const s0 = SCHWARM_START[i] || 0;
  // 29.08.2026 (Marc): verzögerter Start. „Fotofinish" renormiert (kommt
  // trotzdem an), „gleich"/„uhrzeit" laufen mit ECHTER Geschwindigkeit los —
  // wer spät startet, ist am Ende ggf. noch unterwegs (ehrlich).
  if (SCHWARM_MODUS === 'ziel') {{
    const frac = s0 > 0 ? Math.max(0, Math.min(1, (frac0 - s0) / (1 - s0))) : frac0;
    return Math.round(frac * (c.length - 1));
  }}
  if (SCHWARM_MODUS === 'uhrzeit') {{
    const T = SCHWARM_T[i];
    const fracV = Math.max(0, frac0 - s0);
    if (T && T.length === c.length && SCHWARM_T_AXIS > 0) {{
      const t = fracV * SCHWARM_T_AXIS;
      let lo = 0, hi = T.length - 1;
      while (lo < hi) {{ const mid = (lo + hi + 1) >> 1; if (T[mid] <= t) lo = mid; else hi = mid - 1; }}
      return lo;
    }}
    return Math.round(Math.min(1, fracV / Math.max(1e-9, 1 - s0)) * (c.length - 1));
  }}
  const dEff = Math.max(0, dNow - s0 * TOTAL_DIST_M);
  return Math.max(0, Math.min(c.length - 1, Math.floor(dEff / SCHWARM_STEPS[i])));
}}
// „Fertig" mit einem Punkt Toleranz — sonst flackert der Zähler im letzten Frame.
function swarmFertig(i, dNow) {{ return swarmIdx(i, dNow) >= SCHWARM_COORDS[i].length - 2; }}
// 28.08.2026 (Marc): Schwarm-Summen fürs Overlay. SWARM_TOTAL_M = Strecke
// ALLER Touren; swarmDoneM(idx) = wie weit der ganze Schwarm bis jetzt
// gelaufen ist — jede Tour trägt höchstens ihre eigene Länge bei (wer im
// Ziel ist, läuft nicht weiter).
const SWARM_TOTAL_M = TOTAL_DIST_M
  + SCHWARM_COORDS.reduce((a, c, i) => a + (c.length - 1) * SCHWARM_STEPS[i], 0);
const SCHWARM_ASC_TOT = {schwarm_asc_json};
const SCHWARM_DESC_TOT = {schwarm_desc_json};
const SCHWARM_DUR = {schwarm_dur_json};
// 29.08.2026 (Marc): Bergauf/Bergab/Vergangen kumulieren über den ganzen
// Schwarm — jede Tour anteilig zu ihrem eigenen Fortschritt (swarmIdx).
// 29.08.2026 — verzögerter Haupt-Start: die Schwarm-Summen laufen an der
// UNVERZÖGERTEN Referenzachse (__rzSwarmRefIdx), nicht am wartenden Haupt.
function swarmRefD(idx) {{
  const r = (window.__rzSwarmRefIdx == null) ? idx : window.__rzSwarmRefIdx;
  return cumDistM[Math.max(0, Math.min(r, cumDistM.length - 1))] || 0;
}}
function swarmSum(tot, idx) {{
  const d = swarmRefD(idx);
  let s = 0;
  for (let i = 0; i < SCHWARM_N; i++) {{
    const n1 = SCHWARM_COORDS[i].length - 1;
    s += (n1 > 0 ? Math.min(1, swarmIdx(i, d) / n1) : 1) * (tot[i] || 0);
  }}
  return s;
}}
function swarmDoneM(idx) {{
  const d = swarmRefD(idx);
  let s = d;
  for (let i = 0; i < SCHWARM_N; i++) {{
    s += Math.min((SCHWARM_COORDS[i].length - 1) * SCHWARM_STEPS[i],
                  swarmIdx(i, d) * SCHWARM_STEPS[i]);
  }}
  return s;
}}

const TOTAL_TIME_S = cumTimeS.length ? cumTimeS[cumTimeS.length - 1] : 0;
function fmtKmJS(km){{ return km < 100 ? km.toFixed(1)+' km' : km.toFixed(0)+' km'; }}
function fmtDurJS(sec){{ sec=Math.max(0,Math.floor(sec)); var h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60,p=function(n){{return n<10?'0'+n:''+n;}}; return h>0?h+':'+p(m)+':'+p(s):p(m)+':'+p(s); }}
{zeit_js}
const totalPoints = allCoords.length;
const SHOW_OVERLAYS = {str(cfg.show_overlays).lower()};
// v0.9.55 (Marc): Pre-Trim-Sichtbarkeit. Wenn False, startet die gezeichnete
// Linie am Trim-Start statt am Track-Anfang (= „Pre-Trim"-Portion ausgeblendet).
const SHOW_PRETRIM_TRACK = {str(cfg.show_pretrim_track).lower()};
const TRIM_START_IDX = Math.max(0, Math.min(totalPoints - 1, Math.floor({float(cfg.render_start_anchor)} * (totalPoints - 1))));
const SHOW_PINS = {str(bool(cfg.show_pins)).lower()};  // v0.9.307 — Start/End-Pins (Standbild/Tour-Map-Erbe)
// v0.9.621 (Marc: „nicht, dass eine tour raussticht") — die Schwarm-Touren
// haben keine Start/End-Pins; im Dezent-Modus bekommt die Haupt-Tour auch keine.
const HAUPT_DEZENT = {haupt_dezent_js};
// v0.9.509 — Laufpunkt: sichtbar? welche Form? RENDER_SCALE hält ihn im
// 4K-Render optisch gleich groß wie in der Vorschau (dasselbe Prinzip wie bei
// Schildern und Foto-Pins seit v0.9.224).
const DOT_SHOW = {str(bool(cfg.marker_dot_show)).lower()};
const DOT_STYLE = {json.dumps(str(cfg.marker_dot_style or 'dot'))};
const RENDER_SCALE = {float(getattr(cfg, 'render_scale', 1.0) or 1.0)};

/** Kurs (Grad, 0 = Norden) zwischen zwei Koordinaten. */
function __rzPeilung(a, b) {{
  const rad = Math.PI / 180;
  const dLon = (b[0] - a[0]) * rad;
  const y = Math.sin(dLon) * Math.cos(b[1] * rad);
  const x = Math.cos(a[1] * rad) * Math.sin(b[1] * rad)
          - Math.sin(a[1] * rad) * Math.cos(b[1] * rad) * Math.cos(dLon);
  return (Math.atan2(y, x) / rad + 360) % 360;
}}

/** Grober Abstand zweier Koordinaten in Metern (reicht für die Basislänge). */
function __rzMeter(a, b) {{
  const rad = Math.PI / 180, R = 6371000;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad * Math.cos((a[1] + b[1]) / 2 * rad);
  return Math.hypot(dLat, dLon) * R;
}}

// Wie lang die Strecke sein muss, aus der die Fahrtrichtung abgelesen wird.
// 02.09.2026 (Marc: „wenn der laufpunkt ein pfeil ist, muss der irgendwie
// geglättet werden, sonst springt der wie wild hin und her"): Bei sekündlicher
// Aufzeichnung liegen die Punkte 1–3 m auseinander, und GPS rauscht in genau
// dieser Größenordnung. Die Richtung aus EINEM solchen Wegstück ist deshalb
// fast Zufall — der Pfeil zappelt. Über 25 m ist das Rauschen klein gegen die
// echte Bewegung, und der Pfeil zeigt dorthin, wo es wirklich hingeht.
const KURS_BASIS_M = {_kurs_basis_m};
// … und aus mindestens so vielen Punkten. Die Strecke allein genügt nicht:
// Liegen die Punkte 10 m auseinander (Masca-Tour), spannen 25 m gerade drei
// Punkte — da ist nichts zu mitteln. Mit neun Punkten fällt das Zappeln auf
// Marcs Masca-Aufzeichnung von 22,6° auf 7,0° je Bild (Sprünge über 30°:
// 23 % → 1,8 %). Mehr wäre glatter, würde aber echte Kehren verschlucken.
const KURS_MIN_PUNKTE = {_kurs_min_punkte};
const KURS_SIGMA_M = {_kurs_sigma_m};

/** Kurs (Grad, 0 = Norden) am Punkt `i` — aus einer Strecke von mindestens
 *  KURS_BASIS_M um den Punkt herum, nicht aus einem einzelnen Wegstück.
 *
 *  Bewusst OHNE Gedächtnis über Bilder hinweg: Das Ergebnis hängt nur vom
 *  Punkt ab, nicht davon, welche Bilder vorher gerendert wurden. Sonst sähe
 *  dasselbe Bild bei Vorschau, Neu-Rendern und Sprung an eine Stelle
 *  unterschiedlich aus. */
// 29.09.2026 — Spiegel von kursReihe/kursGlattAn (ui/js/util.js): Richtung je Punkt,
// abgewickelt, Gauß über die Streckenlänge (σ = KURS_BASIS_M) — an Spitzkehren dreht der Pfeil
// über ein Stück Weg statt umzuklappen. Zwischenspeicher je coords-Liste.
const __rzKursCache = new WeakMap();
function __rzKurs(coords, i) {{
  const n = coords ? coords.length : 0;
  if (n < 2) return 0;
  let r = __rzKursCache.get(coords);
  if (!r) {{
    const u = new Float64Array(n), cum = new Float64Array(n);
    for (let k = 0; k < n; k++) {{
      const h = __rzKursRoh(coords, k);
      if (k === 0) {{ u[0] = h; continue; }}
      let d = (h - u[k - 1]) % 360; if (d > 180) d -= 360; if (d < -180) d += 360;
      u[k] = u[k - 1] + d;
      cum[k] = cum[k - 1] + __rzMeter(coords[k - 1], coords[k]);
    }}
    const sig = Math.max(1, KURS_SIGMA_M);
    r = new Float64Array(n);
    let lo = 0, hi = 0;
    for (let k = 0; k < n; k++) {{
      while (cum[lo] < cum[k] - 3 * sig) lo++;
      if (hi < k) hi = k;
      while (hi + 1 < n && cum[hi + 1] <= cum[k] + 3 * sig) hi++;
      let sw = 0, sx = 0;
      for (let j = lo; j <= hi; j++) {{ const d = (cum[j] - cum[k]) / sig, w = Math.exp(-0.5 * d * d); sx += u[j] * w; sw += w; }}
      r[k] = sx / sw;
    }}
    __rzKursCache.set(coords, r);
  }}
  const x = Math.max(0, Math.min(n - 1, +i || 0)), k0 = Math.min(n - 2, Math.floor(x));
  const v = r[k0] + (r[k0 + 1] - r[k0]) * (x - k0);
  return ((v % 360) + 360) % 360;
}}
function __rzKursRoh(coords, i) {{
  const n = coords ? coords.length : 0;
  if (n < 2) return 0;
  const mitte = Math.max(0, Math.min(n - 1, i));
  let a = mitte, b = mitte, weg = 0;
  const offen = () => (weg < KURS_BASIS_M || (b - a + 1) < KURS_MIN_PUNKTE);
  // Abwechselnd nach hinten und vorn aufmachen, bis Länge UND Punktzahl stehen.
  while (offen() && (a > 0 || b < n - 1)) {{
    if (a > 0) {{ weg += __rzMeter(coords[a - 1], coords[a]); a--; }}
    if (offen() && b < n - 1) {{ weg += __rzMeter(coords[b], coords[b + 1]); b++; }}
  }}
  if (a === b) return 0;
  // Steht die Aufzeichnung praktisch still (Pause, Ampel), gibt es keine
  // sinnvolle Richtung — dann lieber die des größeren Umfelds als eine, die
  // aus zwei Zentimetern Rauschen entsteht.
  if (__rzMeter(coords[a], coords[b]) < 1 && n > 2) {{
    a = Math.max(0, mitte - 25); b = Math.min(n - 1, mitte + 25);
    if (a === b) return 0;
  }}
  // Nicht Endpunkt gegen Endpunkt: Die beiden äußersten Punkte tragen ihr
  // volles Rauschen, und weil sie bei jedem Bild andere sind, zappelt der
  // Pfeil trotz langer Basis weiter (gemessen: 13° im Mittel). Stattdessen
  // der SCHWERPUNKT der vorderen gegen den der hinteren Hälfte — über ein
  // Dutzend Punkte gemittelt bleibt vom Rauschen kaum etwas übrig (2°).
  const m = (a + b) >> 1;
  let x1 = 0, y1 = 0, c1 = 0, x2 = 0, y2 = 0, c2 = 0;
  for (let k = a; k <= m; k++) {{ x1 += coords[k][0]; y1 += coords[k][1]; c1++; }}
  for (let k = m; k <= b; k++) {{ x2 += coords[k][0]; y2 += coords[k][1]; c2++; }}
  if (!c1 || !c2) return __rzPeilung(coords[a], coords[b]);
  return __rzPeilung([x1 / c1, y1 / c1], [x2 / c2, y2 / c2]);
}}

/** Pfeil-Grafik als Bild — weiße Spitze mit Rand in Track-Farbe, damit sie auf
 *  hellen wie dunklen Karten steht. Wird einmal erzeugt und von Mapbox
 *  gedreht; deshalb zeigt sie hier nach oben (0° = Norden). */
function __rzPfeilBild(farbe) {{
  const d = 2, w = 34 * d, h = 34 * d;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.translate(w / 2, h / 2);
  g.beginPath();
  g.moveTo(0, -13 * d);            // Spitze
  g.lineTo(9.5 * d, 11 * d);       // rechts unten
  g.lineTo(0, 6 * d);              // Kerbe in der Mitte
  g.lineTo(-9.5 * d, 11 * d);      // links unten
  g.closePath();
  g.fillStyle = '#ffffff';
  g.strokeStyle = farbe || '#ff6b35';
  g.lineWidth = 3 * d;
  g.lineJoin = 'round';
  g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = 6 * d;
  g.fill();
  g.shadowColor = 'transparent';
  g.stroke();
  return {{ width: w, height: h, data: g.getImageData(0, 0, w, h).data }};
}}
window.__camStabAmt = {_cam_stab_amt};  // v0.9.314 — Kamera-Höhe halten (0=aus, 1=fest)
// v0.9.24 — Flags: bei Track ohne Höhe/Zeit fehlen die zugehörigen DOM-Nodes
// (Höhenprofil-SVG + live-Stats-Zeilen werden conditional erzeugt). Das JS
// muss das wissen, sonst crasht `getElementById(...).setAttribute(...)` mit
// null und der ganze Render bleibt hängen (window.isReady wird nie gesetzt).
const HAS_ELE = {str(has_ele).lower()};
const HAS_TIME = {str(has_time).lower()};
const SVG_W = 1000, SVG_H = 120, PAD_Y = 10;
// 28.08.2026 — `Math.min.apply(null, arr)` legt JEDES Element als Argument auf
// den Stack; ab ~100k Punkten (Marcs 96-Touren-Schwarm) stirbt das ganze Skript
// mit „Maximum call stack size exceeded", danach fehlt window.isReady und der
// Render bricht ab. Schleife statt apply — unspektakulär und unbegrenzt.
let eleMin = 0, eleMax = 1;
if (HAS_ELE && elevations.length) {{
  eleMin = eleMax = elevations[0];
  for (let i = 1; i < elevations.length; i++) {{
    const v = elevations[i];
    if (v < eleMin) eleMin = v; else if (v > eleMax) eleMax = v;
  }}
}}
const eleRange = (eleMax - eleMin) || 1;
function eleToY(e){{return SVG_H - PAD_Y - ((e - eleMin)/eleRange)*(SVG_H - PAD_Y*2);}}
function idxToX(i){{return (i / Math.max(1, totalPoints - 1)) * SVG_W;}}
if (SHOW_OVERLAYS && HAS_ELE) {{
  const bgPts = elevations.map((e,i)=>`${{idxToX(i).toFixed(2)}},${{eleToY(e).toFixed(2)}}`).join(' ');
  const bgLine = document.getElementById('ele-bg-line');
  if (bgLine) bgLine.setAttribute('points', bgPts);
}}
function updateOverlays(idx) {{
  window.__rzOvIdx = idx;   // 23.09.2026 — für __overlayTiming (Streckenanteil/Etappe)
  if (!SHOW_OVERLAYS) return;
  // 04.09.2026 Nordpfeil + Maßstab — updateOverlays(0) läuft VOR `const map` (TDZ) → dann ohne Karte.
  if (window.__rzNorthScale) {{ try {{ window.__rzNorthScale(undefined, map); }} catch (_) {{ window.__rzNorthScale(); }} }}
  // v0.9.443 — Daten-Diagramm-Overlays synchron treiben. distFrac = Distanz-
  // Anteil des aktuellen Punkts → Chart-Marker landet exakt unter dem Karten-
  // Punkt (korrekte km-Labels + Wert), unabhängig von der Punktdichte.
  if (window.__advanceCharts) {{
    const __cn = totalPoints;
    const __ci = Math.max(0, Math.min(idx, __cn - 1));
    const __csp = (typeof cumDistM !== 'undefined' && cumDistM.length === __cn)
                  ? (cumDistM[__cn - 1] - cumDistM[0]) : 0;
    const __cdf = __csp > 0 ? (cumDistM[__ci] - cumDistM[0]) / __csp
                            : (__cn > 1 ? __ci / (__cn - 1) : 0);
    window.__advanceCharts(__cdf);
  }}
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
{attribution_init}
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
  {globe_block}
  {sharp_block}
  {terrain_block}
  map.addSource('track', {{type:'geojson', lineMetrics:true, data:{{type:'Feature',geometry:{{type:'LineString',coordinates:[]}}}}}});
  if (SCHWARM_N) {{
    map.addSource('schwarm', {{ type: 'geojson', data: {{ type: 'FeatureCollection', features: [] }} }});
    // 09.09.2026 — Aussehen je Tour: Schatten, Glow, Linie je Muster, Röhre, Laufpunkt
    // als Kugel oder Pfeil — wortgleich zu _swPrevBauen (module.js).
    const __swLay = {{ 'line-join': 'round', 'line-cap': 'round' }};
    map.addLayer({{ id: 'schwarm-shadow', type: 'line', source: 'schwarm', filter: ['>', ['get', 'shadow'], 0], layout: __swLay,
      paint: {{ 'line-color': 'rgba(0,0,0,0.7)', 'line-width': ['*', ['get', 'width'], 2.2], 'line-blur': ['get', 'shadow'],
               'line-translate': SCHWARM_SHADOW_TR {schwarm_zoff_frag} }} }});
    map.addLayer({{ id: 'schwarm-glow', type: 'line', source: 'schwarm', filter: ['>', ['get', 'glow'], 0], layout: __swLay,
      paint: {{ 'line-color': ['get', 'color'], 'line-width': ['*', ['get', 'width'], ['+', 2.0, ['*', 0.21, ['get', 'glow']]]],
               'line-blur': ['get', 'glow'], 'line-opacity': 0.8 {schwarm_zoff_frag} }} }});
    SCHWARM_DASH.forEach((d, n) => {{
      const paint = {{ 'line-color': ['get', 'color'], 'line-width': ['coalesce', ['get', 'width'], Math.max(1, {schwarm_line_width_json})], 'line-opacity': 0.9 {schwarm_zoff_frag} }};
      if (d.dash) paint['line-dasharray'] = d.dash;
      map.addLayer({{ id: 'schwarm-lines' + (n ? '-' + n : ''), type: 'line', source: 'schwarm',
        filter: ['==', ['get', 'dk'], d.key], layout: __swLay, paint }});
    }});
    map.addLayer({{ id: 'schwarm-hl', type: 'line', source: 'schwarm', filter: ['==', ['get', 'tube'], 1], layout: __swLay,
      paint: {{ 'line-color': 'rgba(255,255,255,0.9)', 'line-width': ['*', ['get', 'width'], 0.35], 'line-opacity': 0.9 {schwarm_zoff_frag} }} }});
    map.addSource('schwarm-dots', {{ type: 'geojson', data: {{ type: 'FeatureCollection', features: [] }} }});
    // Pfeil je Tour in Tour-Farbe — immer bereit, jede Tour hat ihre eigene Form.
    // Größe: Regler je Tour × RENDER_SCALE (wie der Haupt-Pfeil rz-arrow).
    for (let i = 0; i < SCHWARM_N; i++) {{
      try {{ map.addImage('rz-sw-arrow-' + i, __rzPfeilBild(SCHWARM_COLORS[i]), {{pixelRatio: 2}}); }} catch (e) {{}}
    }}
    map.addLayer({{ id: 'schwarm-dots', type: 'circle', source: 'schwarm-dots',
      filter: ['all', ['get', 'dotShow'], ['!=', ['get', 'dotStyle'], 'arrow']],
      paint: {{ 'circle-color': ['get', 'color'],
               'circle-radius': ['*', ['get', 'dotSize'], ['max', 3, ['*', ['get', 'width'], 1.5]]],
               'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.2 }} }});
    map.addLayer({{ id: 'schwarm-dots-arrow', type: 'symbol', source: 'schwarm-dots',
      filter: ['all', ['get', 'dotShow'], ['==', ['get', 'dotStyle'], 'arrow']],
      layout: {{ 'icon-image': ['get', 'icon'], 'icon-size': ['*', ['get', 'dotSize'], RENDER_SCALE],
               'icon-rotate': ['get', 'brg'], 'icon-rotation-alignment': 'map',
               'icon-pitch-alignment': 'map', 'icon-allow-overlap': true,
               'icon-ignore-placement': true }} }});
    if (SCHWARM_3D && window.rzLine3d) {{
      // Linien 150 m über dem Gelände, Breite wie die drapierte Ebene; die drapierte
      // Ebene bleibt leer (setData übersprungen, s. __rzSchwarmAdvance).
      const __l3 = window.rzLine3d.create('schwarm-3d', {{ offsetM: 150 }});
      map.addLayer(__l3, 'schwarm-dots');
      __l3.setTracks(SCHWARM_COORDS.map((c, i) => ({{ coords: c, color: SCHWARM_COLORS[i],
                       width: Math.max(1, SCHWARM_WIDTHS[i] || {schwarm_line_width_json}), opacity: 0.9 }})));
      __l3.setCounts(SCHWARM_COORDS.map(() => 0));
      window.__rzSw3d = __l3;
    }}
  }}
  // v0.9.169 — Ghost-Track: die GANZE Route schwach/transparent als unterste
  // Track-Linie (eigene Source mit ALLEN Punkten, wird NIE animiert). Der
  // animierte Track (Source 'track') zeichnet voll deckend darüber. Zuerst
  // added = ganz unten im Layer-Stack.
  {("map.addSource('track-ghost', {type:'geojson', data:{type:'Feature',geometry:{type:'LineString',coordinates:allCoords}}});"
    "map.addLayer({id:'track-ghost',type:'line',source:'track-ghost',"
    "layout:{'line-cap':'round','line-join':'round'},"
    f"paint:{{'line-color':'{cfg.ghost_track_color}','line-width':{cfg.line_width:.2f},'line-opacity':{max(0.0, min(1.0, cfg.ghost_track_opacity)):.2f}"
    + (f",'line-dasharray':{_dasharray_mapbox(cfg.line_style, cfg.line_style_spacing)}" if _dasharray_mapbox(cfg.line_style, cfg.line_style_spacing)
       else (",'line-dasharray':[3,2]" if cfg.ghost_track_dashed else ""))   # synchron zu currentGhostDash() (module.js)
    + (",'line-z-offset':150" if _zoff_on(cfg) else "")
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
    f"'line-translate':[{_shadow_dxdy(cfg)[0]:.1f}, {_shadow_dxdy(cfg)[1]:.1f}]"
    + (f",'line-dasharray':{_dasharray_mapbox(cfg.line_style, cfg.line_style_spacing, 1 / 2.2)}" if _dasharray_mapbox(cfg.line_style, cfg.line_style_spacing) else "")
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
    + (f",'line-dasharray':{_dasharray_mapbox(cfg.line_style, cfg.line_style_spacing, 1 / (2.0 + 0.21 * cfg.glow_strength))}" if _dasharray_mapbox(cfg.line_style, cfg.line_style_spacing) and not _colors_on else "")
    + (",'line-z-offset':150" if _zoff_on(cfg) else "")
    + "}});") if cfg.glow_enabled and cfg.glow_strength > 0 else "// glow disabled"}
  map.addLayer({{id:'track-line',type:'line',source:'track',
    layout:{{'line-cap':'round','line-join':'round'}},
    paint:{{'line-color':'{cfg.line_color}','line-width':{cfg.line_width:.2f},'line-opacity':0.95{f",'line-dasharray':{_dasharray_mapbox(cfg.line_style, cfg.line_style_spacing)}" if _dasharray_mapbox(cfg.line_style, cfg.line_style_spacing) and not _colors_on else ""}{',\'line-z-offset\':150' if _zoff_on(cfg) else ''}}}}});
  {("map.addLayer({id:'track-highlight',type:'line',source:'track',"
    "layout:{'line-cap':'round','line-join':'round'},"
    f"paint:{{'line-color':'#ffffff','line-width':{cfg.line_width * 0.35:.2f},'line-opacity':0.55,'line-blur':0.6"
    + (f",'line-dasharray':{_dasharray_mapbox(cfg.line_style, cfg.line_style_spacing, 1 / 0.35)}" if _dasharray_mapbox(cfg.line_style, cfg.line_style_spacing) else "")
    + (",'line-z-offset':150" if _zoff_on(cfg) else "")
    + "}});") if cfg.track_style == "tube" else "// no tube highlight"}
  // 06.09.2026 — Linien über dem Gelände (MapLibre + 3D): die drapierten Ebenen
  // (Ghost-Route, GPX-Ghosts, Glow, Linie, Highlight) durch rz-line3d ersetzen.
  // Der Schatten bleibt bewusst drapiert (liegt auf dem Boden). Farben je Punkt
  // (Farbverlauf/Etappen) kommen aus __rzPointColors, das Wachstum über setRanges.
  window.__rzTrack3d = null;
  if (LINES_3D && window.rzLine3d) {{
    const __ghosts = [];
    for (const id of Object.keys(map.getStyle().sources || {{}})) {{
      if (!/^gpx-ghost(-[0-9]+)?$/.test(id) || !map.getLayer(id)) continue;
      const src = map.getSource(id), dat = src && src._data;
      const coords = dat && dat.geometry && dat.geometry.coordinates;
      if (!coords || coords.length < 2) continue;
      const g = (k, d) => {{ try {{ const v = map.getPaintProperty(id, k); return (v == null) ? d : v; }} catch (_) {{ return d; }} }};
      const da = g('line-dasharray', null);
      // Angleich an die drapierte Darstellung der Vorschau: MapLibre zeichnet drapierte
      // Ghost-Linien etwa halb so dick wie ihre CSS-Breite (gemessen 06.09.2026, 4K:
      // 6,5 → 9/6 px, 6 → 5 px). Entfällt, sobald die Vorschau ebenfalls rz-line3d nutzt.
      __ghosts.push({{ coords, color: g('line-color', '#7fa8ff'), width: +g('line-width', 2.5) * 0.55, opacity: +g('line-opacity', 0.6),
                      dash: (Array.isArray(da) && da.length >= 2) ? [da[0] * 5.0, da[1] * 1.8] : null }});   // Strich/Lücke wie drapiert: sichtbar ≈ 11 bzw. 2,6 Linienbreiten (gemessen 06.09.2026, runde Kappen eingerechnet)
      map.removeLayer(id);
    }}
    const __ghostRoute = map.getLayer('track-ghost') ? {{ coords: allCoords, color: '{cfg.ghost_track_color}', width: {cfg.line_width * 0.55:.2f},
                          opacity: {max(0.0, min(1.0, cfg.ghost_track_opacity)):.2f}, dash: TRACK_DASH }} : null;
    const __hadShadow = !!map.getLayer('track-shadow');
    for (const id of ['track-ghost', 'track-shadow', 'track-glow', 'track-line', 'track-highlight']) {{ if (map.getLayer(id)) map.removeLayer(id); }}
    // EINE Custom-Ebene für alles: die Zeichenreihenfolge der Spuren darin bestimmen wir
    // selbst (MapLibre ordnet mehrere 3D-Custom-Layer nicht verlässlich, gemessen 06.09.2026).
    // Reihenfolge = unten → oben: GPX-Ghosts, Gesamtroute, Schatten, Glow, Linie, Highlight.
    const __cols = window.__rzPointColors ? window.__rzPointColors() : null;
    const __base = __cols ? '#ffffff' : '{cfg.line_color}';
    const __spuren = [], __haupt = [];
    __ghosts.forEach((g, i) => {{ g.offsetM = 145 - i * 0.3; __spuren.push(g); }});
    if (__ghostRoute) {{ __ghostRoute.offsetM = 147; __spuren.push(__ghostRoute); }}
    if (__hadShadow) {{ __haupt.push(__spuren.length); __spuren.push({{ coords: allCoords, color: '#000000', opacity: 0.18, width: {cfg.line_width * 1.8:.2f},
                       feather: {cfg.line_width * 0.9:.1f}, translate: [{_shadow_dxdy(cfg)[0]:.1f}, {_shadow_dxdy(cfg)[1]:.1f}], dash: TRACK_DASH, offsetM: 149 }}); }}
    {("__haupt.push(__spuren.length); __spuren.push({ coords: allCoords, color: __base, colors: __cols, width: " + f"{cfg.line_width * (2.0 + 0.21 * cfg.glow_strength):.2f}" + ", opacity: 0.35, feather: " + f"{max(1.0, cfg.glow_strength * 1.5):.1f}" + ", dash: (COLORS_ON ? null : TRACK_DASH), offsetM: 150 });") if cfg.glow_enabled and cfg.glow_strength > 0 else "// glow disabled (3d)"}
    __haupt.push(__spuren.length); __spuren.push({{ coords: allCoords, color: __base, colors: __cols, width: {cfg.line_width:.2f}, opacity: 0.95, dash: ((COLORS_ON || SEG_STARTS.length) ? null : TRACK_DASH), offsetM: 150 }});
    {("__haupt.push(__spuren.length); __spuren.push({ coords: allCoords, color: '#ffffff', width: " + f"{cfg.line_width * 0.35:.2f}" + ", opacity: 0.55, feather: 1.2, dash: TRACK_DASH, offsetM: 150.5 });") if cfg.track_style == "tube" else "// no tube highlight (3d)"}
    const __l3 = window.rzLine3d.create('track-3d', {{ offsetM: 150 }});
    map.addLayer(__l3); __l3.setTracks(__spuren);
    window.__rzTrack3dHaupt = __haupt;
    __l3.setRanges(__spuren.map((_, i) => __haupt.includes(i) ? [0, 0] : null));
    window.__rzTrack3d = [__l3];
  }}
  // v0.9.156 — Multi-Track: N eigene Tour-Sources/Layer (leer wenn Single-Track).
  {multi_track_layers}
  // v0.9.509 — Laufpunkt: Kugel oder Pfeil, Größe wählbar, ein-/ausblendbar.
  // Die Quelle trägt `brg` (Fahrtrichtung in Grad) mit, damit der Pfeil sich
  // dreht. ⚠️ `icon-rotation-alignment:'map'` ist Pflicht: sonst dreht sich der
  // Pfeil mit der Kamera statt mit dem Weg.
  map.addSource('dot', {{type:'geojson',data:{{type:'Feature',properties:{{brg:0}},geometry:{{type:'Point',coordinates:allCoords[0]}}}}}});
  if (DOT_SHOW && DOT_STYLE === 'arrow') {{
    if (!map.hasImage('rz-arrow')) {{
      try {{ map.addImage('rz-arrow', __rzPfeilBild('{cfg.line_color}'), {{pixelRatio: 2}}); }} catch (e) {{}}
    }}
    map.addLayer({{id:'dot-arrow',type:'symbol',source:'dot',
      layout:{{'icon-image':'rz-arrow','icon-size':{cfg.marker_dot_size} * RENDER_SCALE,
        'icon-rotate':['get','brg'],'icon-rotation-alignment':'map',
        'icon-pitch-alignment':'map','icon-allow-overlap':true,'icon-ignore-placement':true}}}});
  }} else if (DOT_SHOW && {haupt_dezent_js}) {{
    // Marc (29.08.2026): Haupt-Laufpunkt im Schwarm-Stil — kleiner Kreis in
    // Tour-Farbe mit weißem Rand, exakt wie die schwarm-dots.
    // ⚠️ OHNE RENDER_SCALE — die schwarm-dots skalieren auch nicht mit;
    // mit Faktor war der Haupt-Punkt im 4K-Video riesig (Marc, 29.08.2026).
    map.addLayer({{id:'dot-core',type:'circle',source:'dot',
      paint:{{'circle-radius':Math.max(3, {schwarm_line_width_json} * 1.5),
             'circle-color':'{cfg.line_color}','circle-stroke-color':'#ffffff',
             'circle-stroke-width':1.2,'circle-pitch-alignment':'map'}}}});
  }} else if (DOT_SHOW) {{
    map.addLayer({{id:'dot-glow',type:'circle',source:'dot',
      paint:{{'circle-radius':10 * {cfg.marker_dot_size} * RENDER_SCALE,'circle-color':'#fff','circle-opacity':0.3,'circle-blur':0.8,'circle-pitch-alignment':'map'}}}});
    map.addLayer({{id:'dot-core',type:'circle',source:'dot',
      paint:{{'circle-radius':5 * {cfg.marker_dot_size} * RENDER_SCALE,'circle-color':'#fff','circle-opacity':0.95,'circle-stroke-color':'{cfg.line_color}','circle-stroke-width':2 * RENDER_SCALE,'circle-pitch-alignment':'map'}}}});
  }}
  // v0.9.307 — Start/End-Pins (aus der Tour-Map übernommen, Standbild-Modus).
  // Identische Optik wie früher core/tourmap.py: weißer Start, Track-farbiges Ende.
  if (SHOW_PINS && !HAUPT_DEZENT && allCoords.length >= 2) {{
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
// 22.08.2026 (Audit): Mapbox-Fehler (401/403 Token, Stil nicht ladbar) landeten
// nur als console-Zeile im Log, und der Render lief nach 30 s „trotzdem weiter"
// — Ergebnis: ein komplett schwarzes Video mit Status „Fertig". Fehler jetzt
// sammeln, Python bricht vor der Frame-Schleife hart ab.
window.__mapErrors = [];
map.on('error', (e) => {{
  try {{
    const err = e && e.error ? e.error : e;
    const txt = (err && (err.message || err.statusText || String(err))) || "Mapbox-Fehler";
    const status = err && (err.status || err.statusCode);
    window.__mapErrors.push({{ msg: txt, status: status || null }});
  }} catch (_) {{}}
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
window.isReady = () => window._mapReady === true && (typeof window.__chartsReady !== 'function' || window.__chartsReady());
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
// 04.09.2026 (Marc, Masca: „Zoom landet an der falschen Stelle") — MapLibre führt
// die Mittelpunkt-Höhe bei setCenter/jumpTo NICHT nach. Blieb sie bei 0 (Start
// auf der Weltkugel), schaute die Kamera bei 58° Neigung auf einen Punkt in
// 1000 m Höhe → sichtbarer Ausschnitt ~2,8 km daneben (kopflos gemessen, gleicher
// Effekt im Video). Jeder Frame bekommt jetzt die Höhe mit: Gelände, sonst
// GPX-Höhe × Überhöhung. Mapbox regelt das selbst (setCenter reicht).
window.__rzSetCam = (brg, lon, lat, zm, pt, idx) => {{
  zm = Math.max(map.getMinZoom ? map.getMinZoom() : 0, Math.min(map.getMaxZoom ? map.getMaxZoom() : 24, isFinite(zm) ? zm : 0));   // 05.09.2026 (Audit): nie negativ
  lat = Math.max(-85, Math.min(85, lat));
  const ml = (typeof map.getCenterClampedToGround === 'function');
  let e = null;
  if (ml) {{
    try {{ if (map.getTerrain && map.getTerrain()) {{ const q = map.queryTerrainElevation([lon, lat]); if (q != null && isFinite(q)) e = q; }} }} catch (_) {{}}
    if (e == null && typeof HAS_ELE !== 'undefined' && HAS_ELE && typeof elevations !== 'undefined' && idx != null && elevations[idx] != null) {{
      try {{ if (map.getTerrain && map.getTerrain()) e = elevations[Math.max(0, Math.min(elevations.length - 1, idx))] * (window.__RZ_EXAG || 1); }} catch (_) {{}}
    }}
  }}
  if (e != null) {{
    try {{ if (map.getCenterClampedToGround()) map.setCenterClampedToGround(false); }} catch (_) {{}}
    const o = {{ center: [lon, lat], bearing: brg, elevation: e }};
    if (zm !== undefined) o.zoom = zm;
    if (pt !== undefined) o.pitch = pt;
    map.jumpTo(o);
    return;
  }}
  map.setBearing(brg); map.setCenter([lon, lat]);
  if (zm !== undefined) map.setZoom(zm);
  if (pt !== undefined) map.setPitch(pt);
}};

// v0.9.318 — Entkoppelte FreeCamera gegen Berg-Hüpfen (in Sandbox validiert).
// Pro Keyframe die exakte 3D-Kamera auslesen (Position Mercator-x/y/z + Orientierung-
// Quaternion), zwischen Keyframes Position linear im 3D-Raum + Orientierung per nlerp
// interpolieren → Kamera reitet NICHT mehr aufs Gelände, framing-treu an den KFs.
window.__kfCams = null;
// 04.09.2026 (Marc: „ruhige Kamera auch in die anderen Stile") — Engine-Adapter.
// Mapbox: FreeCamera (Position Mercator + Orientierung-Quaternion). MapLibre 5:
// kein FreeCamera, aber `transform.getCameraLngLat()/getCameraAltitude()` zum
// Lesen und `calculateCameraOptionsFromCameraLngLatAltRotation()` zum Setzen —
// Kameraposition + Richtung/Neigung ergeben dieselbe Ansicht. Damit die Höhe
// NICHT wieder ans Gelände geklemmt wird (das wäre das Berg-Hüpfen), wird
// `centerClampedToGround` aus- und die berechnete `elevation` mitgegeben.
window.__rzMC = (typeof mapboxgl !== "undefined" && mapboxgl.MercatorCoordinate) ? mapboxgl.MercatorCoordinate : maplibregl.MercatorCoordinate;
window.__RZ_EXAG = {float(getattr(cfg, "exaggeration", 1.0) or 1.0) if getattr(cfg, "enable_terrain", False) else 1.0};
window.__rzCamRead = (elevM) => {{
  if (typeof map.getFreeCameraOptions === "function") {{
    const fc = map.getFreeCameraOptions(); const o = fc.orientation;
    return {{ pos: [fc.position.x, fc.position.y, fc.position.z], ori: [o[0], o[1], o[2], o[3]], bp: null }};
  }}
  const r = window.rzMlCamRead(map, elevM);   // ui/js/maplibre-camera.js (inline im Kopf); elevM = Geländehöhe (04.09.2026)
  return {{ pos: r.pos, ori: null, bp: r.bp }};
}};
window.__rzCamApply = (pos, ori, bp, eM) => {{
  if (typeof map.setFreeCameraOptions === "function") {{
    const fc = map.getFreeCameraOptions();
    fc.position = new window.__rzMC(pos[0], pos[1], pos[2]); fc.orientation = ori; map.setFreeCameraOptions(fc); return;
  }}
  window.rzMlCamApply(map, pos, bp, eM);   // eM: Geländehöhe der Stützstelle (04.09.2026)
}};
window.__rzLerpBP = (a, b, u) => {{
  let d = ((b[0] - a[0]) % 360 + 540) % 360 - 180;   // kürzester Drehweg
  return [a[0] + d * u, a[1] + (b[1] - a[1]) * u];
}};
window.__camPrepFaithful = async (camList, glattFenster) => {{
  try {{ if (map.setCenterClampedToGround) map.setCenterClampedToGround(false); }} catch (_) {{}}   // 08.09.2026: Aufbau ohne Boden-Klemmung (synchron zur Vorschau)
  // 25.08.2026 — VERSUCH: auf die Geländekacheln warten, bevor die Kamerahöhe
  // abgelesen wird. Ohne das springt die Karte hier in Millisekunden durch
  // Hunderte Positionen; `getFreeCameraOptions()` und `queryTerrainElevation()`
  // liefern dann Werte für Gelände, das noch gar nicht geladen ist. Beim
  // späteren Rendern sind die Kacheln da — und die vorbereitete Höhe passt
  // nicht mehr zum Zoom. Das erklärt, warum der Fehler mit der Überhöhung
  // wächst (jeder Geländefehler geht mal 3,3) und ohne Gelände verschwindet.
  const warteAufKacheln = async () => {{
    for (let i = 0; i < 40; i++) {{                    // höchstens ~400 ms je Bild
      try {{ if (map.areTilesLoaded()) return; }} catch (e) {{ return; }}
      await new Promise(r => setTimeout(r, 10));
    }}
  }};
  const roh = [];
  let letztEM = null;   // 04.09.2026 — letzte bekannte Geländehöhe (m)
  for (const k of camList) {{
    map.jumpTo({{ center: [k.lng, k.lat], zoom: k.zoom, pitch: k.pitch, bearing: k.bearing }});
    try {{ if (map._render) map._render(); }} catch (e) {{}}
    await warteAufKacheln();
    try {{ if (map._render) map._render(); }} catch (e) {{}}
    // Geländeanteil der Kamerahöhe (Höhe = Gelände unter der Bildmitte
    // + Flughöhe aus dem Zoom). Nur DIESER Anteil wird unten geglättet.
    let ez = null, eM = null;
    if (k.dem && k.ele != null && isFinite(k.ele)) {{
      // 08.09.2026 — feste Kachelstufe (core/demsample), synchron zur Vorschau
      eM = k.ele; letztEM = k.ele; try {{ ez = window.__rzMC.fromLngLat([k.lng, k.lat], k.ele).z; }} catch (_) {{}}
    }} else try {{
      let e = map.queryTerrainElevation([k.lng, k.lat]);
      // 08.09.2026: ohne Kacheln liefert MapLibre 0, nicht null → GPX-Höhe (synchron zur Vorschau)
      if (e === 0 && k.ele != null && Math.abs(k.ele) > 50) e = null;
      if (e != null && isFinite(e)) {{ ez = window.__rzMC.fromLngLat([k.lng, k.lat], e).z; eM = e; letztEM = e; }}
      else if (k.ele != null && isFinite(k.ele)) {{ eM = k.ele; letztEM = k.ele; try {{ ez = window.__rzMC.fromLngLat([k.lng, k.lat], k.ele).z; }} catch (_) {{}} }}
    }} catch (e) {{}}
    // 04.09.2026 — mit der ECHTEN Geländehöhe lesen und sie zur Stützstelle
    // speichern; __camFaithful setzt mit derselben Höhe → exakt umkehrbar.
    const cr = window.__rzCamRead(eM != null ? eM : letztEM);
    roh.push({{ t: k.t, pos: cr.pos, ori: cr.ori, bp: cr.bp, ez, eM: (eM != null ? eM : letztEM), g: (k.g == null ? 1 : k.g) }});
  }}
  // 22.08.2026 — Die Liste ist jetzt dicht (ein Eintrag je Bild). Das Berg-
  // Hüpfen steckt im GELÄNDEANTEIL der Kamerahöhe; nur der wird mit einem
  // gleitenden Mittelwert (~1 s) geglättet. Die Flughöhe aus dem Zoom bleibt
  // bildgenau wie in der Vorschau — ein Mittelwert über die ganze Höhe hatte
  // jeden Zoom-Wechsel um ein halbes Fenster verschleppt.
  const w = Math.max(1, Math.floor((glattFenster || 1) / 2));
  let letzt = 0;
  const ezs = roh.map(c => {{ if (c.ez != null) letzt = c.ez; return letzt; }});
  if (w > 0 && roh.length > 2 * w + 1 && ezs.some(v => v !== 0)) {{
    for (let i = 0; i < roh.length; i++) {{
      if (!roh[i].g) continue;                       // Abschnitt ohne „ruhig" → unverändert
      const lo = Math.max(0, i - w), hi = Math.min(roh.length - 1, i + w);
      let summe = 0;
      for (let j = lo; j <= hi; j++) summe += ezs[j];
      roh[i].pos[2] = roh[i].pos[2] + roh[i].g * (summe / (hi - lo + 1) - ezs[i]);
    }}
  }}
  // 08.09.2026 — eM um dieselbe Verschiebung wie pos[2] anheben (Mercator → Meter an der
  // Kamera-Breite): Zoom bleibt exakt der Keyframe-Zoom, unabhängig von geladenen Höhenkacheln.
  // Synchron zur Vorschau (module.js _faithBuild).
  if (w > 0 && roh.length > 2 * w + 1 && ezs.some(v => v !== 0)) {{
    const R = 6378137;
    for (let i = 0; i < roh.length; i++) {{
      if (!roh[i].g || roh[i].eM == null) continue;
      const lo = Math.max(0, i - w), hi = Math.min(roh.length - 1, i + w);
      let summe = 0;
      for (let j = lo; j <= hi; j++) summe += ezs[j];
      const dPos = roh[i].g * (summe / (hi - lo + 1) - ezs[i]);
      const camLat = 360 / Math.PI * Math.atan(Math.exp((180 - roh[i].pos[1] * 360) * Math.PI / 180)) - 90;
      const circ = 2 * Math.PI * R * Math.cos(camLat * Math.PI / 180);
      roh[i].eM = roh[i].eM + dPos * circ;
    }}
  }}
  window.__kfCams = roh;
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
  if (cams.length === 1) {{
    const c = cams[0];
    window.__rzCamApply(c.pos, c.ori, c.bp, c.eM); return;
  }}
  let lo = 0, hi = cams.length - 2;
  while (lo < hi) {{ const m = (lo + hi + 1) >> 1; if (cams[m].t <= t) lo = m; else hi = m - 1; }}
  const i = lo;
  const A = cams[i], B = cams[i+1];
  const span = (B.t - A.t) || 1e-6;
  const u = Math.max(0, Math.min(1, (t - A.t) / span));
  const px = A.pos[0] + (B.pos[0]-A.pos[0])*u, py = A.pos[1] + (B.pos[1]-A.pos[1])*u, pz = A.pos[2] + (B.pos[2]-A.pos[2])*u;
  const eM = (A.eM != null && B.eM != null) ? A.eM + (B.eM - A.eM) * u : (A.eM != null ? A.eM : B.eM);
  window.__rzCamApply([px, py, pz], A.ori ? window.__nlerpQuat(A.ori, B.ori, u) : null, A.bp ? window.__rzLerpBP(A.bp, B.bp, u) : null, eM);
  // 25.08.2026 — Prüfstelle für die Zoom-Meldung (siehe docs/IDEAS.md §36):
  // Übernimmt Mapbox die gesetzte Kamerahöhe, oder hebt es sie über das Gelände?
  // Gemessen: `hub` ist durchgehend 0 — Mapbox übernimmt sie exakt. Der
  // weggelaufene Zoom entsteht also NICHT beim Setzen, sondern steckt schon in
  // der vorbereiteten Höhe (`__camPrepFaithful`). Wird nur mit RZ_CAMDEBUG=1
  // geloggt (ein zusätzlicher Aufruf je Bild).
  try {{
    const nach = window.__rzCamRead();
    window.__camGesetzt = {{ soll_z: pz, ist_z: nach.pos[2],
                            hub: nach.pos[2] - pz, zoom: map.getZoom() }};
  }} catch (e) {{}}
}};
{color_gradient_js}
// v0.9.435 — Mehrfarbiger Track: Konstanten (aus AnimatorConfig).
const COLORS_ON = {colors_on_js};
const LINE_COLOR = {line_color_json};    // 23.08.2026 — Grundfarbe für die Etappen-Maske
const STAGE_COLORS = {tour_colors_json};  // Farbe je Etappennummer (leer = eine Farbe)
// ⚠️ NICHT „TOUR_COLORS" nennen: so heißt im Mehrspur-HTML schon die Farbliste
// des alten Pfads — die doppelte Deklaration ließ das ganze Skript sterben.
const COLOR_SOURCE = {color_source_json};
window.__rzSchwarmAdvance = (dNow) => {{
  if (!SCHWARM_N || !map.getSource('schwarm')) return;
  const linien = [], punkte = [];
  for (let i = 0; i < SCHWARM_N; i++) {{
    const c = SCHWARM_COORDS[i];
    const k = Math.max(0, Math.min(c.length - 1, swarmIdx(i, dNow)));
    const st = SCHWARM_STIL[i] || {{}};
    linien.push({{ type: 'Feature', properties: {{ color: SCHWARM_COLORS[i], width: SCHWARM_WIDTHS[i], shadow: st.shadow || 0, glow: st.glow || 0,
                                                dk: st.dk || 'solid', tube: st.tube || 0 }},
      geometry: {{ type: 'LineString', coordinates: k >= 1 ? c.slice(0, k + 1) : [c[0], c[0]] }} }});
    punkte.push({{ type: 'Feature',
      properties: {{ color: SCHWARM_COLORS[i], icon: 'rz-sw-arrow-' + i, width: SCHWARM_WIDTHS[i],
                   dotShow: st.dotShow !== false, dotStyle: st.dotStyle || 'dot', dotSize: st.dotSize || 1,
                   brg: (st.dotStyle === 'arrow') ? __rzKurs(c, k) : 0 }},
      geometry: {{ type: 'Point', coordinates: c[k] }} }});
  }}
  if (window.__rzSw3d) {{
    // 06.09.2026 — Linien über dem Gelände: nur die Zähler (Segmente je Tour) setzen,
    // die drapierte Linien-Ebene bleibt leer.
    window.__rzSw3d.setCounts(linien.map(l => l.geometry.coordinates.length - 1));
  }} else {{
    map.getSource('schwarm').setData({{ type: 'FeatureCollection', features: linien }});
  }}
  map.getSource('schwarm-dots').setData({{ type: 'FeatureCollection', features: punkte }});
}};
const COLOR_STOPS_VAL = {color_stops_km_json};
const COLOR_STOPS_COL = {color_stops_col_json};
const COLOR_MODE = {color_mode_json};
// v0.9.448 — Sensorreihen haben Lücken (null). Mit dem letzten gültigen Wert
// füllen, führende mit dem ersten — sonst reißt der Farbverlauf ab. SYNCHRON zu
// `metricArrFor` (modules/animator/ui/module.js) und `heightanim._fill_gaps`.
function __rzFillGaps(arr) {{
  if (!arr || !arr.length) return null;
  const out = new Array(arr.length);
  let last = null;
  for (let i = 0; i < arr.length; i++) {{
    const v = arr[i];
    if (typeof v === "number" && isFinite(v)) last = v;
    out[i] = last;
  }}
  const first = out.find(v => v != null);
  if (first == null) return null;
  for (let i = 0; i < out.length && out[i] == null; i++) out[i] = first;
  return out;
}}
const COLOR_METRIC = {color_metric_js};   // elevations | speedKmh | gradePct | Sensorreihe | null (Distanz)
// 06.09.2026 — Farbe je Track-Punkt für rz-line3d (Farbverlauf nach Distanz/Metrik
// oder Etappenfarben mit unsichtbaren Verbindungen). Gleiche Regeln wie
// __rzColorGradient / __rzSegMask, nur je Punkt statt als line-progress-Ausdruck.
window.__rzPointColors = () => {{
  const n = allCoords.length;
  const rgb = (h) => {{ const c = window.__rzHex2rgb(h); return [c[0] / 255, c[1] / 255, c[2] / 255, 1]; }};
  if (COLORS_ON && !(COLOR_SOURCE !== 'distance' && !COLOR_METRIC) && COLOR_STOPS_VAL && COLOR_STOPS_VAL.length) {{
    const sv = COLOR_STOPS_VAL, sc = COLOR_STOPS_COL, m = sv.length;
    const colAt = (v) => {{
      if (v <= sv[0]) return sc[0];
      if (v >= sv[m - 1]) return sc[m - 1];
      let i = 0; while (i < m - 1 && sv[i + 1] <= v) i++;
      if (COLOR_MODE !== 'gradient') return sc[i];
      const span = sv[i + 1] - sv[i]; return window.__rzLerpHex(sc[i], sc[i + 1], span > 0 ? (v - sv[i]) / span : 0);
    }};
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = rgb(colAt(COLOR_METRIC ? COLOR_METRIC[i] : (cumDistM[i] || 0) / 1000));
    return out;
  }}
  if (SEG_STARTS.length) {{
    const out = new Array(n);
    for (let i = 0; i < n; i++) {{
      const c = (STAGE_COLORS && STAGE_NR) ? (STAGE_COLORS[STAGE_NR[Math.max(0, Math.min(STAGE_NR.length - 1, i))]] || LINE_COLOR) : LINE_COLOR;
      out[i] = rgb(c);
    }}
    for (const m of SEG_STARTS) {{
      const a = m[0], b = m[1], dk = m.length > 2 ? +m[2] : null;   // Logbuch „blass" (24.09.2026)
      for (let i = Math.max(0, a); i <= Math.min(n - 1, b); i++) {{
        if (dk == null) out[i] = [0, 0, 0, 0];
        else if (Array.isArray(out[i])) {{ out[i] = out[i].slice(); out[i][3] = (out[i].length > 3 ? out[i][3] : 1) * dk; }}
      }}
    }}
    return out;
  }}
  return null;
}};
window.advanceFrame = (idx, brg, lon, lat, zm, pt, setCam, fullTrack) => {{
  try {{ if (window.__rzStarsManual && window.rzStarsTick) rzStarsTick(map.getContainer(), (window.__rzStarsFrame++) / (window.__rzStarsFps || 30)); }} catch(_){{}}
  const safe = Math.max(0, Math.min(idx, totalPoints-1));
  // v0.9.55: optional Pre-Trim-Portion (coords[0..TRIM_START_IDX-1]) ausblenden.
  // v0.9.417: `fullTrack` (Snapshot bei „ganze Route zeigen") → GESAMTE Linie
  // zeichnen (ab 0), Punkt bleibt aber an der Scrubber-Position `safe` — exakt wie
  // die Vorschau mit `preview_full_track`.
  const sliceStart = fullTrack ? 0 : (SHOW_PRETRIM_TRACK ? 0 : Math.min(TRIM_START_IDX, safe));
  const sliceEnd = fullTrack ? totalPoints : (safe+1);
  const coords = allCoords.slice(sliceStart, sliceEnd);
  if (coords.length >= 2) {{
    map.getSource('track').setData({{type:'Feature',geometry:{{type:'LineString',coordinates:coords}}}});
    if (window.__rzTrack3d) {{ const H = window.__rzTrack3dHaupt || []; for (const l of window.__rzTrack3d) l.setRanges(l._tracks.map((_, i) => H.includes(i) ? [sliceStart, sliceEnd - 1] : null)); }}
    // v0.9.435 — Mehrfarbiger Track: line-gradient setzen.
    // v0.9.448 — Quelle ist eine Messreihe, die dieser Track nicht hergibt
    // (z.B. Puls-Einfärbung + GPX ohne Puls) → gar keinen Verlauf setzen. Sonst
    // würden die Stop-Werte als Kilometer missdeutet und der Track bekäme
    // willkürliche Farben statt sauber einfarbig zu bleiben.
    if (!LINES_3D && COLORS_ON && !(COLOR_SOURCE !== 'distance' && !COLOR_METRIC)) {{
      let g = window.__rzColorGradient(cumDistM, sliceStart, sliceEnd-1, COLOR_STOPS_VAL, COLOR_STOPS_COL, COLOR_MODE, COLOR_METRIC);
      if (g && SEG_STARTS.length && window.__rzGradLuecken) g = window.__rzGradLuecken(g, cumGeoM, sliceStart, sliceEnd-1, SEG_STARTS);
      if (SEG_STARTS.length && map.getLayer('track-shadow')) {{
        const msG = window.__rzSegMask(cumGeoM, sliceStart, sliceEnd-1, SEG_STARTS, 'rgba(0,0,0,0.7)', null, null);
        try {{ map.setPaintProperty('track-shadow','line-gradient', msG || null); if (msG) map.setPaintProperty('track-shadow','line-dasharray', null); }} catch(e) {{}}
      }}
      if (g) {{ try {{ map.setPaintProperty('track-line','line-gradient',g); if (map.getLayer('track-glow')) map.setPaintProperty('track-glow','line-gradient',g); }} catch(e) {{}} }}
    }} else if (!LINES_3D && SEG_STARTS.length) {{
      // 23.08.2026 — Etappen: Verbindungsstücke unsichtbar (siehe __rzSegMask).
      const m = window.__rzSegMask(cumGeoM, sliceStart, sliceEnd-1, SEG_STARTS, LINE_COLOR, STAGE_COLORS, STAGE_NR);
      for (const id of ['track-line','track-glow','track-highlight']) {{
        if (!map.getLayer(id)) continue;
        try {{ map.setPaintProperty(id,'line-gradient', m || null); if (m) map.setPaintProperty(id,'line-dasharray', null); }} catch(e) {{}}
      }}
      // 24.08.2026, am Rechner gefunden: Der SCHATTEN lag nicht in dieser Liste
      // — die „unsichtbare" Verbindung zwischen zwei Touren zog dadurch einen
      // schwarzen Strich quer über die Karte (Berlin → Florida, gut sichtbar).
      // Er braucht eine eigene Maske in Schattenfarbe (nie Etappenfarben).
      if (map.getLayer('track-shadow')) {{
        const ms = window.__rzSegMask(cumGeoM, sliceStart, sliceEnd-1, SEG_STARTS, 'rgba(0,0,0,0.7)', null, null);
        try {{ map.setPaintProperty('track-shadow','line-gradient', ms || null); if (ms) map.setPaintProperty('track-shadow','line-dasharray', null); }} catch(e) {{}}
      }}
    }}
  }}
  if (SCHWARM_N) {{
    // 29.08.2026 — verzögerter Haupt-Start: Schwarm läuft an der
    // unverzögerten Referenzachse (__rzSwarmRefIdx), nicht am wartenden Haupt.
    const swSafe = (window.__rzSwarmRefIdx == null) ? safe
      : Math.max(0, Math.min(totalPoints - 1, window.__rzSwarmRefIdx));
    window.__rzSchwarmAdvance(fullTrack ? Number.MAX_SAFE_INTEGER : (cumDistM[swSafe] || 0));
  }}
  const head = allCoords[safe] || allCoords[0];
  // 23.08.2026 — Im unsichtbaren Übergang fliegt nur die Kamera: kein Laufpunkt
  // (sonst schwebt die Kugel über Land, wo gar keine Tour ist).
  const dotAus = DOT_HIDDEN.some(r => safe >= r[0] && safe <= r[1]);
  // Fahrtrichtung aus dem Wegstück VOR dem Punkt (am Anfang aus dem danach) —
  // nur der Pfeil braucht sie, die Kugel ignoriert sie.
  map.getSource('dot').setData(dotAus
    ? {{type:'FeatureCollection',features:[]}}
    : {{type:'Feature',
        properties:{{brg: __rzKurs(allCoords, safe)}},
        geometry:{{type:'Point',coordinates:head}}}});
  // v0.9.318 — setCam===false: Kamera NICHT hier setzen (entkoppelte FreeCamera
  // übernimmt das via __camFaithful). Linie/Punkt/Overlays laufen trotzdem.
  if (setCam !== false) {{
    window.__rzSetCam(brg, lon, lat, zm, pt, safe);   // 04.09.2026 — mit Mittelpunkt-Höhe (MapLibre)
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

// 31.08.2026 (gemeldete „Kachelbildung") — STRENGES Warten für Frames, in denen
// sich der ZOOM geändert hat. `waitForRender` nimmt die 60-ms-Abkürzung, sobald
// `areTilesLoaded()` true meldet — während eines Zoom-Flugs gilt aber auch die
// übergangsweise dargestellte ELTERN-Kachel (andere Zoomstufe = oft anderes
// Aufnahme-Datum!) als „geladen". Mit `raster-fade-duration: 0` (v0.9.286)
// stehen dann frisch geladene Ziel-Kacheln HART neben alten Eltern-Kacheln —
// das Schachbrett aus verschiedenfarbigen Kacheln im Video. Hier: Repaint
// erzwingen und IMMER auf echtes `idle` (= Ziel-Zoomstufe vollständig) warten.
window.waitForTilesStrict = () => new Promise(r => {{
  const settleMs = 60;
  const finish = () => setTimeout(r, settleMs);
  let done = false;
  const onIdle = () => {{
    if (done) return;
    done = true;
    map.off('idle', onIdle);
    finish();
  }};
  map.on('idle', onIdle);
  try {{ map.triggerRepaint && map.triggerRepaint(); }} catch (_) {{}}
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
    window.__rzSetCam(brg, lon, lat, zm, pt, null);
    // Pro Stützstelle auf `idle` warten (= alle Tiles für diese Ansicht geladen)
    await window.waitForRender();
  }}
}};
{_interactive_boot_js}
</script></body></html>"""


def build_interactive_html(cfg: AnimatorConfig) -> str:
    """v0.9.415 — Baut die eigenständige, INTERAKTIVE Tour-Karten-HTML fürs Blog.
    Nutzt exakt dieselbe `_make_html`-Pipeline wie Video/Standbild (gleiche Karte,
    Track, Pins, Schilder via `__rzDrawSign`) → echtes WYSIWYG. KEIN Playwright /
    Screenshot: die Seite läuft im Browser des Besuchers, springt beim Laden EINMAL
    auf die (Override-)Kamera + volle Strecke und bleibt danach frei zoom-/pan-bar.
    Erwartet `cfg.interactive_export=True` und i.d.R. `cfg.use_osm=True` (tokenfrei).
    Gibt den fertigen, in sich geschlossenen HTML-String zurück.
    """
    raw_points, total_stats = core_parse_gpx(cfg.gpx_path)
    if cfg.point_count <= 0 or cfg.point_count >= len(raw_points):
        points = raw_points
    else:
        points = downsample(raw_points, max(2, cfg.point_count))
    if len(points) < 2:
        raise ValueError(_i18n.uebersetzer(getattr(cfg, "ui_lang", ""))("animator.err_zu_wenige_tourkarte", "GPX hat zu wenige Punkte für die Tour-Karte."))
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
        # 23.08.2026 — Etappennamen fürs Overlay (zusammengeführte Touren)
        "seg_names": list(getattr(total_stats, "seg_names", []) or []),
        # 23.09.2026 — Kennzahlen je Etappe (Overlay-Bezug), auf den vollen Punkten
        "stage_stats": core_gpx_etappen_stats(raw_points),
        # 24.09.2026 (IDEAS §67 Q16) — Kennzahlen je Bewegungsart (Logbuch-Bereiche vom Animator)
        "art_stats": core_gpx_arten_stats(raw_points, getattr(cfg, "bewegung_bereiche", None) or []),
    }
    return _make_html(cfg, points, cum_dist, cum_time, total_stats_dict, bbox)




def spur_glaetten(coords, meter):
    """29.09.2026 — Spur glätten, Spiegel von `rzSpurGlaetten` (ui/js/util.js).

    `coords` = Liste von [lon, lat, …]. Gauß über die Streckenlänge (σ = meter/2),
    Fenster je Punkt symmetrisch auf den kürzeren Abstand zu Start/Ende gekürzt —
    Anfang und Ende bleiben exakt. Punktzahl bleibt. Abstand wie `kursMeter`.
    """
    n = len(coords or [])
    m = float(meter or 0)
    if n < 3 or m <= 0:
        return coords
    rad, R = math.pi / 180.0, 6371000.0

    def dist(a, b):
        return math.hypot((b[1] - a[1]) * rad, (b[0] - a[0]) * rad * math.cos((a[1] + b[1]) / 2 * rad)) * R
    cum = [0.0]
    for i in range(1, n):
        cum.append(cum[-1] + dist(coords[i - 1], coords[i]))
    sig, ges = m / 2.0, cum[-1]
    out = []
    lo = hi = 0
    for i in range(n):
        r = min(3 * sig, cum[i], ges - cum[i])
        if r <= 0:
            out.append(list(coords[i]))
            continue
        while cum[lo] < cum[i] - r:
            lo += 1
        hi = max(hi, i)
        while hi + 1 < n and cum[hi + 1] <= cum[i] + r:
            hi += 1
        sx = sy = sw = 0.0
        for k in range(lo, hi + 1):
            d = (cum[k] - cum[i]) / sig
            w = math.exp(-0.5 * d * d)
            sx += coords[k][0] * w
            sy += coords[k][1] * w
            sw += w
        p = list(coords[i])
        p[0], p[1] = sx / sw, sy / sw
        out.append(p)
    return out


def _punkte_verteilen(cfg, raw_points):
    """Verteilen (s. `_punkte_verteilen_roh`), danach ggf. Spur glätten (29.09.2026)."""
    pts = _punkte_verteilen_roh(cfg, raw_points)
    m = float(getattr(cfg, "spur_glaetten_m", 0.0) or 0.0)
    if m <= 0 or len(pts) < 3:
        return pts
    import dataclasses
    glatt = spur_glaetten([[p.lon, p.lat] for p in pts], m)
    return [dataclasses.replace(p, lon=g[0], lat=g[1]) for p, g in zip(pts, glatt)]


def _punkte_verteilen_roh(cfg, raw_points):
    """Punkte für den Render — Anzahl wie bisher, Verteilung nach Wahl.

    Die Frame-Schleife läuft über die Punkt-REIHENFOLGE
    (`coords_per_frame = n / anim_frames`). Verteilt man die Punkte also
    gleichmäßig entlang einer Achse, folgt die Animation dieser Achse — der
    ganze Umbau steckt in dieser einen Funktion, alles dahinter bleibt gleich.

    ⚠️ Auch bei „alle Punkte" (`point_count <= 0`) muss neu verteilt werden:
    die Rohpunkte stehen in Geräte-Reihenfolge, das IST der „raw"-Modus. Die
    Anzahl bleibt dabei gleich, nur die Verteilung ändert sich.
    """
    # 08.09.2026 — Liegt eine Tempo-Kurve bei (Halte, gebremste Abschnitte), ist
    # sie die Wahrheit: sie sagt für jedes Bild, wo auf der Strecke es steht.
    # Ohne sie bleibt alles wie bisher (core/tempo.py erzeugt für ein Projekt
    # ohne Einträge exakt dieselbe Verteilung — Wächter: test_tempo_kurve.py).
    karte = getattr(cfg, "pace_map", None)
    if karte:
        _log.info("Tempo-Kurve: %d Stellen aus der Vorschau übernommen", len(karte))
        from .gpx import punkte_nach_anteilen
        return punkte_nach_anteilen(raw_points, list(karte))

    modus = getattr(cfg, "pace_mode", "raw") or "raw"
    if cfg.point_count <= 0 or cfg.point_count >= len(raw_points):
        ziel = len(raw_points)
        # v0.9.510 — Ruckel-Fix (Marc: „wenn ich die länge des clips deutlich
        # verlängere, ruckelt es"). Der Renderer kennt nur ganze Trackpunkte;
        # hat die Animation MEHR Frames als der Track Punkte, steht der Punkt
        # mehrere Frames still und springt dann (gemessen: 629 Punkte × 50 s
        # × 30 fps = Sprung alle 79 ms — klar sichtbar). Deshalb wird auf
        # Frame-Anzahl hochgetastet: eine eigene Position je Frame.
        # ⚠️ NUR bei „alle Punkte": wer die Punktzahl am Regler bewusst
        # reduziert hat, hat sich gegen Glätte und für Tempo entschieden —
        # diese Wahl wird nicht heimlich übersteuert. Der Deckel begrenzt
        # Speicher und setData-Kosten bei sehr langen Videos.
        frames = int(round(float(getattr(cfg, "duration_s", 0) or 0)
                           * float(getattr(cfg, "fps", 30) or 30)))
        if frames > ziel:
            ziel = min(frames, 10000)
    else:
        ziel = max(2, cfg.point_count)

    if modus == "raw":
        if ziel <= len(raw_points):
            return raw_points if ziel >= len(raw_points) else downsample(raw_points, ziel)
        return resample(raw_points, ziel, achse="raw")

    return resample(
        raw_points, ziel,
        achse="time" if modus == "real" else "dist",
        pausen=getattr(cfg, "pause_mode", "trim") or "trim",
        pause_ab_s=float(getattr(cfg, "pause_min_s", 120.0) or 120.0),
        pause_auf_s=float(getattr(cfg, "pause_trim_s", 5.0) or 5.0),
    )


# 09.09.2026 (IDEAS §60, Phase 6) — `_render_multi` ist weg. Mehrere Touren
# rendern ausschließlich über die Szene (core/szene.py), die die Vorschau Bild
# für Bild abspielt: Kette, Übergänge, Füll-Halte, parallele Gruppen und
# Keyframes kommen dort aus EINER Rechnung (ui/js/spuren.js). Die frühere
# Verteilregel `_reise_segmente` und ihr Zwilling core/spuren.py liefen nur noch
# in Tests und sind seit 24.09.2026 weg; tests/test_spuren_modell.py hält ihre
# Etappenzeiten als Sollwerte fest.

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


async def _jpeg_direkt(page, q: int) -> bytes:
    """05.10.2026 — JPEG-Bild direkt über CDP `Page.captureScreenshot` statt `page.screenshot`.

    Marc: „wo bleibt die Zeit je Bild?" — gemessen im Szenen-Render (Prüfstand, warm, 120 Bilder):
    1080p Bild greifen 50 → 37 ms (Zeit je Bild 163 → 146 ms), 4K 150 → 121 ms (316 → 268 ms).
    Gleiches Bild: 1080p bytegleich, 4K PSNR 95 dB gegeneinander (nur das Sterne-Funkeln).
    Playwright macht je Aufnahme zusätzlich Layout-Abfrage, Schrift-/Caret-Vorbereitung in allen
    Frames — für eine stehende Szene unnötig. `optimizeForSpeed` bringt bei JPEG nichts (gemessen).

    ⚠️ Eigene CDP-Sitzung kennt die DSF-Emulation von Playwright nicht: ohne `clip.scale =
    devicePixelRatio` kommt nur ein Bild in CSS-Pixeln (960×540 statt 1920×1080). Deshalb wird
    die Größe beim ersten Bild geprüft; jede Abweichung oder jeder Fehler → zurück auf
    `page.screenshot` für diese Seite (nie ein unscharfes Video)."""
    z = getattr(page, "_rz_jpeg_direkt", None)
    if z is False:
        return await page.screenshot(type="jpeg", quality=q)
    try:
        if z is None:
            vs = page.viewport_size or {}
            dpr = float(await page.evaluate("() => window.devicePixelRatio"))
            z = {"cdp": await page.context.new_cdp_session(page), "w": int(vs["width"]), "h": int(vs["height"]), "dpr": dpr}
        r = await z["cdp"].send("Page.captureScreenshot", {
            "format": "jpeg", "quality": q, "captureBeyondViewport": False, "fromSurface": True,
            "clip": {"x": 0, "y": 0, "width": z["w"], "height": z["h"], "scale": z["dpr"]}})
        raw = base64.b64decode(r["data"])
        if getattr(page, "_rz_jpeg_direkt", None) is None:
            groesse = Image.open(io.BytesIO(raw)).size
            soll = (round(z["w"] * z["dpr"]), round(z["h"] * z["dpr"]))
            if abs(groesse[0] - soll[0]) > 1 or abs(groesse[1] - soll[1]) > 1:
                _log.warning("Bild greifen direkt: %dx%d statt %dx%d — zurück auf page.screenshot", *groesse, *soll)
                page._rz_jpeg_direkt = False
                return await page.screenshot(type="jpeg", quality=q)
            page._rz_jpeg_direkt = z
        return raw
    except Exception as e:   # noqa: BLE001
        _log.warning("Bild greifen direkt fehlgeschlagen (%s) — zurück auf page.screenshot", str(e)[:200])
        page._rz_jpeg_direkt = False
        return await page.screenshot(type="jpeg", quality=q)


async def _grab_frame(page, cfg: "AnimatorConfig") -> bytes:
    if os.environ.get("RZ_L3D_DEBUG") and not getattr(page, "_rz_l3d_dumped", False):
        page._rz_l3d_dumped = True
        try:
            info = await page.evaluate("""() => { try {
              const l = window.__rzSw3d; const a = window.__rzLine3dArgs || null;
              let sd = null; try { sd = a && a.shaderData; } catch (_) {}
              const l3 = (map.getStyle().layers || []).map(x => x.id).filter(id => /3d$|track|ghost|shadow|glow/.test(id));
              const tr = (window.__rzTrack3d || []).map(x => ({ id: x.id, bufs: x._bufs.map(b => ({ w: b.width, f: b.feather, t: b.translate, c: b.color, d: b.dash, segs: b.segs })) }));
              return { layers3: l3, track3d: tr, proj: (map.getProjection && map.getProjection()) || null, hasLayer: !!map.getLayer('schwarm-3d'), bufs: l ? l._bufs.length : -1,
                       tracks: l ? l._tracks.length : -1, counts: l && l._counts ? l._counts.slice(0, 5) : null, args: a, sw3d: (typeof SCHWARM_3D !== 'undefined') ? SCHWARM_3D : null,
                       zoom: map.getZoom() };
            } catch (e) { return { err: String(e) }; } }""")
            import sys as _sys; _sys.stderr.write("[l3ddbg] " + json.dumps(info)[:6000] + "\n"); _sys.stderr.flush()
        except Exception as _e:
            import sys as _sys; _sys.stderr.write("[l3ddbg] fehler " + str(_e) + "\n")
    if os.environ.get("RZ_SIGNDEBUG"):
        try:
            info = await page.evaluate("""() => { try {
              const sc = (map.style.sourceCaches && map.style.sourceCaches['anim-signs-src']) || (map.style._otherSourceCaches && map.style._otherSourceCaches['anim-signs-src']);
              const tiles = sc ? Object.values(sc._tiles).map(t => t.tileID.overscaledZ + '/' + t.tileID.canonical.z + (t.hasData && t.hasData() ? '' : '?')) : [];
              const lyr = map.getLayer('anim-signs-lyr');
              return { z: +map.getZoom().toFixed(4), pitch: +map.getPitch().toFixed(1), tiles, pop: !!map.__rzSignPopMode,
                       filter: JSON.stringify(map.getFilter('anim-signs-lyr')).slice(0, 60) };
            } catch (e) { return { err: String(e) }; } }""")
            import sys as _sys; _sys.stderr.write("[signdbg] " + json.dumps(info) + "\n"); _sys.stderr.flush()
        except Exception as _e:
            pass
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
        raw = await _jpeg_direkt(page, q)
    else:
        raw = await page.screenshot(type="png")

    # 08.09.2026 - Video-Pfade lassen ffmpeg verkleinern (siehe _vf_args): das Bild
    # geht so, wie es ist, in die Pipe (der PIL-Lanczos kostete bei 4K gemessen
    # 187 ms je Bild auf dem kritischen Weg). Standbilder gehen weiter durch PIL.
    if getattr(cfg, "skalieren_in_ffmpeg", False):
        return raw
    if _ss <= 1.0:
        # 07.09.2026 — Szene: Fenster = Vorschau-Viewport in CSS-px × DSF (Video ÷ Vorschau).
        # Chromium rundet die Bildhöhe (562 CSS × 1,92 = 1079,04 → 1079): ungerade Höhe, und
        # libx265 verweigert („Picture height must be an integer multiple of the chroma
        # subsampling") — der Render brach bei Bild 12 ab. Weicht die Bildgröße ab, exakt auf
        # cfg.width×cfg.height bringen (nur dann; der Kopfzeilen-Blick auf das Bild ist billig).
        try:
            import io as _io
            from PIL import Image as _Im
            if _Im.open(_io.BytesIO(raw)).size != (cfg.width, cfg.height):
                if not getattr(page, "_rz_size_logged", False):
                    page._rz_size_logged = True
                    try:
                        _sz = _Im.open(_io.BytesIO(raw)).size
                        _log.info("Frame-Größe %dx%d ≠ Ziel %dx%d — je Bild exakt skaliert", _sz[0], _sz[1], cfg.width, cfg.height)
                    except Exception:
                        pass
                return _downscale_frame(raw, cfg.width, cfg.height, cfg.transparent_background, q if is_jpeg else 0)
        except Exception:
            pass
        return raw
    return _downscale_frame(raw, cfg.width, cfg.height,
                            cfg.transparent_background, q if is_jpeg else 0)






def _schwarm_touren_vorbereiten(cfg: AnimatorConfig) -> list:
    """Die Zusatz-Touren des Schwarms parsen und äquidistant abtasten.

    Haupt-Track (cfg.gpx_path) wird ÜBERSPRUNGEN — er läuft über den normalen
    Single-Track-Pfad und ist die Zeitachse. Der Punktabstand kommt aus dem
    gemeinsamen Deckel (`punktabstand`), damit auch eine 154-Touren-Sammlung
    nicht das Bild erstickt. Unlesbare Dateien werden geloggt und übersprungen —
    eine kaputte Tour darf den Render nicht abbrechen (gleiche Regel wie im
    Archiv-Scan)."""
    try:
        haupt = str(Path(cfg.gpx_path).resolve())
    except Exception:
        haupt = str(cfg.gpx_path)
    geparst = []
    for t in (cfg.tracks or []):
        pfad = str((t or {}).get("gpx_path") or "")
        if not pfad:
            continue
        try:
            if str(Path(pfad).resolve()) == haupt:
                continue
        except Exception:
            if pfad == cfg.gpx_path:
                continue
        try:
            pts, _st = core_parse_gpx(pfad)   # _st fließt in die Schwarm-Summen
        except Exception as e:
            _log.warning("Schwarm: %s unlesbar (%s) — übersprungen", pfad, e)
            continue
        if len(pts) < 2 or pts[-1].dist_m <= 0:
            _log.warning("Schwarm: %s ohne Strecke — übersprungen", pfad)
            continue
        geparst.append({"points": pts, "laenge": pts[-1].dist_m,
                        "color": (t or {}).get("line_color") or "",
                        # 29.08.2026 (Marc, Schorfheide): „an jedem einzelnen
                        # schwarm track angeben, wie lange er warten soll"
                        "start_s": max(0.0, float((t or {}).get("start_s") or 0)),
                        # 29.08.2026 (Marc: Gesamt-Stats = Summe aller Touren)
                        "stats": {"duration_s": float(getattr(_st, "duration_s", 0) or 0),
                                  "moving_time_s": float(getattr(_st, "moving_time_s", 0) or 0),
                                  "ascent_m": float(getattr(_st, "ascent_m", 0) or 0),
                                  "descent_m": float(getattr(_st, "descent_m", 0) or 0),
                                  "max_speed_kmh": float(getattr(_st, "max_speed_kmh", 0) or 0),
                                  "ele_max": getattr(_st, "ele_max", None),
                                  "ele_min": getattr(_st, "ele_min", None)},
                        "gpx_path": pfad,
                        # 09.09.2026 — Aussehen je Track: Breite in der Linie, Punkte in %
                        "stil": ((t or {}).get("stil") if isinstance((t or {}).get("stil"), dict) else None)})
    if not geparst:
        return []
    l_max = max(t["laenge"] for t in geparst)
    l_sum = sum(t["laenge"] for t in geparst)
    s = punktabstand(l_max, l_sum)
    raus = []
    for t in geparst:
        # M3 „echte Uhrzeit": Zeitachsen index-gleich zu den Koordinaten
        # (t_roh inkl. Pausen, t_bew gestutzt); (None, None) ohne Zeitstempel.
        t_roh, t_bew = resample_zeiten(t["points"], s)
        coords = resample_aequidistant(t["points"], s)
        st = t.get("stil") or {}
        # Punktreduzierung je Tour (Prozent), Zeiten im Gleichschritt — wie
        # `_tourGeduennt` in der Vorschau.
        try:
            pct = max(10.0, min(100.0, float(st.get("reduce_pct") or 100)))
        except (TypeError, ValueError):
            pct = 100.0
        if pct < 100 and len(coords) >= 20:
            n = len(coords); ziel = max(10, round(n * pct / 100))
            idx = [round(i * (n - 1) / (ziel - 1)) for i in range(ziel)]
            coords = [coords[i] for i in idx]
            if t_roh and len(t_roh) == n: t_roh = [t_roh[i] for i in idx]
            if t_bew and len(t_bew) == n: t_bew = [t_bew[i] for i in idx]
        try:
            breite = float(st.get("width")) if st.get("width") not in (None, "") else None
        except (TypeError, ValueError):
            breite = None
        raus.append({"coords": coords,
                     "color": t["color"], "step_m": s, "width": breite, "stil": st,
                     "t_roh": t_roh, "t_bew": t_bew,
                     "stats": t["stats"],
                     "start_s": t.get("start_s", 0.0),
                     "gpx_path": t["gpx_path"]})
    _log.info("Schwarm: %d Zusatz-Touren · Abstand %.1f m · Punkte %d",
              len(raus), s, sum(len(t["coords"]) for t in raus))
    return raus


def fokus_koordinate(fokus: dict, cum_dist: list, idx: int) -> tuple:
    """Kamera-Ziel der Fokus-Tour bei der Distanz, die der Haupt-Track bei
    `idx` zurückgelegt hat (IDEAS §38 M2).

    Geklemmt ans Tour-Ende — Marcs Entscheidung wörtlich: „kamera bleibt
    stehen", wenn die Fokus-Tour fertig ist, während der Rest weiterläuft.
    """
    d = cum_dist[min(max(0, idx), len(cum_dist) - 1)] if cum_dist else 0.0
    coords = fokus["coords"]
    modus = str(fokus.get("modus") or "gleich")
    total = float(fokus.get("haupt_total_m") or 0.0)
    frac = min(1.0, d / total) if total > 0 else 1.0
    zeiten = fokus.get("t")
    if modus == "uhrzeit" and zeiten and len(zeiten) == len(coords) and fokus.get("t_axis"):
        # Position bei der Sekunde, die der Video-Fortschritt auf der
        # gemeinsamen Zeitachse bedeutet (synchron zu swarmIdx im Render-JS).
        t = frac * float(fokus["t_axis"])
        lo, hi = 0, len(zeiten) - 1
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if zeiten[mid] <= t:
                lo = mid
            else:
                hi = mid - 1
        k = lo
    elif modus in ("ziel", "uhrzeit"):
        # Fotofinish — bzw. Uhrzeit-Modus ohne Zeitstempel: gleichmäßig.
        k = int(round(frac * (len(coords) - 1)))
    else:
        k = int(d / max(0.5, float(fokus["step_m"])))
    k = min(len(coords) - 1, max(0, k))
    c = coords[k]
    return (c[0], c[1])


