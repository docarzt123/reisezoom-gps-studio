"""
Reisezoom GPS Studio — pywebview-App.

Frame mit Sidebar (Animator, Geotagger) + Python-JS-Bridge.
Backend-Logik in core/*; UI in ui/.
"""
from __future__ import annotations

import asyncio
import base64
import io
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
import threading
import time
import traceback
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

# Playwright sucht Chromium-Browser per Default neben seinem Driver
# (`.../driver/package/.local-browsers/`). Im PyInstaller-Bundle landet
# der Driver dort, die Browser aber NICHT — Playwright bricht dann mit
# „Executable doesn't exist" ab. Muss VOR dem ersten Playwright-Import
# gesetzt werden, da Playwright diesen Pfad beim Driver-Init resolved.
#
# v0.9.229 (Windows-Bug-Report Peter Straka): Chromium ist jetzt MIT-GEBÜNDELT
# (siehe .spec `pw-browsers/`). Auflösung:
#   1) Gebündelt im Bundle (sys._MEIPASS/pw-browsers) → out-of-box, kein Download.
#   2) Sonst: User-Cache (Dev-Builds + Download-on-first-render-Fallback).
def _resolve_pw_browsers_path():
    _base = getattr(sys, "_MEIPASS", None)
    if _base:
        _bundled = Path(_base) / "pw-browsers"
        try:
            if _bundled.is_dir() and any(_bundled.glob("chromium_headless_shell-*")):
                return _bundled, True
        except Exception:
            pass
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Caches" / "ms-playwright", False
    elif sys.platform == "win32":
        return Path.home() / "AppData" / "Local" / "ms-playwright", False
    return Path.home() / ".cache" / "ms-playwright", False

_pw_path, _pw_bundled = _resolve_pw_browsers_path()
if _pw_bundled:
    # Bundle hat Vorrang — hart setzen (nicht setdefault), sonst greift ein
    # evtl. leerer User-Cache.
    os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(_pw_path)
    # PyInstaller-`datas` bewahrt das Exec-Bit nicht garantiert → für den
    # gebündelten chrome-headless-shell (mac/linux) nachziehen. Windows .exe
    # braucht kein Exec-Bit.
    if sys.platform != "win32":
        try:
            for _shell in _pw_path.glob("chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell"):
                _st = os.stat(_shell)
                os.chmod(_shell, _st.st_mode | 0o111)
        except Exception:
            pass
else:
    os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(_pw_path))

import webview
from PIL import Image, ImageOps

from core import gpx as cgpx
from core import imports as cimports  # v0.9.282: universelle Track-Import-Schicht
from core import exif as cexif
from core import geotag as cgeo
from core import sun as csun  # v0.9.333 — Sonnenstand + Blickrichtung (Lichtstempel)
from core import geocode as cgeocode  # v0.9.337 — Reverse-Geocoding (Adresse) via OSM
from core import autotag as cautotag  # v0.9.349 — Bilderkennung (Apple Vision, nur macOS)
from core import backup as cbak
from core import animator as canim
from core import sessions as _sessions  # v0.8.0: Sessions + Projekte
# v0.9.310 — core/tourmap.py entfernt: Tour-Map rendert jetzt über
# canim.render_frame() (Standbild-Modus des Animators). Kein ctmap mehr.
from core import i18n as ci18n
from core import logger as clog
from core import photos as cphotos  # v0.9.74: Foto-Pins für Animator + Tour-Map
from core import route as croute  # v0.9.205: Anreise/Flug-Route (Directions/Arc)
from core import heightanim as cheight  # v0.9.92: Höhen-Animator-Modul (Phase 1, Skelett)
from core import tourmap_html as ctourhtml  # v0.9.406: Tour-Map → interaktiver Leaflet-HTML-Export
from core import tourmap_leaflet as ctmleaflet  # v0.9.418: leichter Leaflet-Blog-Export (HTML-Modus)
from core import sign_raster as csignraster  # v0.9.418: serverseitige Schild-Rasterung (WYSIWYG)
from core import gpxedit as cgpxedit  # v0.9.233: GPX-Inspektor (Track heilen/füllen)
from core import trackio as ctrackio  # v0.9.297: Track→GPX/CSV-String (geteilt mit Web)


# Pfade: in PyInstaller-Bundle liegt UI in sys._MEIPASS, sonst im Source-Tree.
# Cross-Platform-Pfad für schreibbare User-Daten (Settings, Renders, Logs):
#   - macOS:   ~/Library/Application Support/Reisezoom GPS Studio/
#   - Windows: %APPDATA%\Reisezoom GPS Studio\   (= ~/AppData/Roaming/...)
#   - Linux:   ~/.local/share/Reisezoom GPS Studio/   (XDG_DATA_HOME)
# Vor v0.4.3 wurde auf ALLEN Plattformen `~/Library/Application Support/`
# verwendet — auf Win/Linux unkonventionell, aber funktional. Jetzt sauberer
# Standard-Pfad pro OS.
def _app_support_dir() -> Path:
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "Reisezoom GPS Studio"
    if sys.platform == "win32":
        # %APPDATA% ist auf Windows IMMER gesetzt — Fallback nur defensiv.
        appdata = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
        return Path(appdata) / "Reisezoom GPS Studio"
    # Linux + andere Unix: XDG-Standard
    xdg = os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
    return Path(xdg) / "Reisezoom GPS Studio"


if getattr(sys, "_MEIPASS", None):
    ROOT = Path(sys._MEIPASS)
    UI_DIR = ROOT / "ui"
    MODULES_DIR = ROOT / "modules"
    I18N_DIR = ROOT / "i18n"
    APP_SUPPORT = _app_support_dir()
else:
    ROOT = Path(__file__).resolve().parent
    UI_DIR = ROOT / "ui"
    MODULES_DIR = ROOT / "modules"
    I18N_DIR = ROOT / "i18n"
    # Dev-Modus: in den Projekt-Root schreiben (wie vorher).
    APP_SUPPORT = ROOT

# i18n-Lib mit unserem Sprachfile-Verzeichnis verbinden
ci18n.set_i18n_dir(I18N_DIR)

# App-Version — wird im Über-Dialog + im Topbar gezeigt. Bei Release bumpen.
APP_VERSION = "0.9.435"

# v0.9.431 — abschaltbarer „erstellt mit"-Backlink im Web-Karte-Export (Cross-Promo
# + SEO-Backlink zur Webversion). URL an EINER Stelle → bei URL-Wechsel (z.B. Umzug
# auf reisezoom.com/gps) hier ändern; alte Exporte fängt ein 301 auf dem Server ab.
WEBKARTE_CREDIT_TEXT = "erstellt mit Reisezoom GPS Studio"
WEBKARTE_CREDIT_URL = "https://reisezoom.com/gps/"

# ── Edition (v0.9.331) ───────────────────────────────────────────────────────
# Dieselbe Codebasis liefert zwei Apps:
#   "full"      → Reisezoom GPS Studio (alle Module: Animator, Tour-Map, Höhen,
#                 Reiseroute, GPX-Inspektor, Geotagger).
#   "geotagger" → Reisezoom Geotagger (NUR das Geotagger-Modul, OSM-Karte ohne
#                 Mapbox-Token/Kreditkarte, ohne Render-Ballast Chromium/ffmpeg).
# Quelle der Wahrheit (Priorität): Env RZ_EDITION > gebündelte edition.txt > "full".
# Der Solo-Build legt RZ_EDITION=geotagger an (build_geotagger.sh) und bäckt
# eine edition.txt ins Bundle (spec). Kein Code-Klon — nur dieser Schalter.
def _detect_edition() -> str:
    e = (os.environ.get("RZ_EDITION") or "").strip().lower()
    if e in ("geotagger", "full"):
        return e
    try:
        base = getattr(sys, "_MEIPASS", None) or os.path.dirname(os.path.abspath(__file__))
        marker = os.path.join(base, "edition.txt")
        if os.path.isfile(marker):
            with open(marker, "r", encoding="utf-8") as fh:
                v = fh.read().strip().lower()
            if v in ("geotagger", "full"):
                return v
    except Exception:
        pass
    return "full"

APP_EDITION = _detect_edition()
APP_NAME = "Reisezoom Geotagger" if APP_EDITION == "geotagger" else "Reisezoom GPS Studio"

# v0.9.280 (Nutzer-Wunsch) — In-App-Update-Check (Stufe 1: nur prüfen + Hinweis,
# kein Selbst-Update). Fragt die GitHub-Releases-API, vergleicht die Version und
# meldet dem UI, ob ein neueres Release da ist. Download bleibt manuell (Shortlink).
GITHUB_REPO = "docarzt123/reisezoom-gps-studio"
UPDATE_RELEASES_API = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"
UPDATE_DOWNLOAD_PAGE = f"https://github.com/{GITHUB_REPO}/releases/latest"
# Plattform-spezifische Direkt-Download-Shortlinks (Linux baut aus Quelle → Seite).
_UPDATE_SHORTLINKS = {
    "darwin": "https://s.reisezoom.com/gps-studio-mac",
    "win32": "https://s.reisezoom.com/gps-studio-win",
}
# v0.9.319 — „Was ist neu?": User-Changelog (deployed neben den Downloads). Mit
# ?since=<version> filtert die Seite auf die Versionen NEUER als die eigene.
UPDATE_CHANGELOG_URL = "https://reisezoom.com/downloads/gps-studio/latest/changelog.html"
# Netzwerk-Abfrage höchstens alle 12 h (sonst Cache aus Settings), außer force.
UPDATE_CHECK_THROTTLE_S = 12 * 3600

RENDERS_DIR = APP_SUPPORT / "_renders"
BACKUPS_DIR = APP_SUPPORT / "_backups_photos"


def _shrink_data_uri(uri: str, max_px: int = 520, quality: int = 82) -> str:
    """v0.9.406 — Verkleinert ein data:image-URI auf max_px längste Kante (JPEG),
    damit die exportierte Tour-Map-HTML mit vielen Fotos/Schildern nicht explodiert.
    Kein data-URI oder Fehler → Original unverändert zurück."""
    uri = str(uri or "")
    if not uri.startswith("data:image"):
        return uri
    try:
        import base64
        import io
        from PIL import Image
        _, b64 = uri.split(",", 1)
        im = Image.open(io.BytesIO(base64.b64decode(b64)))
        im.load()
        w, h = im.size
        if max(w, h) <= max_px:
            return uri
        scale = max_px / float(max(w, h))
        im = im.convert("RGB").resize((max(1, int(w * scale)), max(1, int(h * scale))))
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=quality)
        return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
    except Exception:
        return uri
DROPS_DIR = APP_SUPPORT / "_drops"      # für per-Drag&Drop importierte Files
# Tour-Karten landen im Pictures-Ordner, da User sie häufiger braucht
TOURMAPS_DIR = Path.home() / "Pictures" / "Reisezoom Tour Maps"
SETTINGS_FILE = APP_SUPPORT / "settings.json"
# v0.8.0: Sessions + Projekte (track-bound). Siehe core/sessions.py
SESSIONS_FILE = APP_SUPPORT / "sessions.json"
SESSIONS_GPX_DIR = APP_SUPPORT / "sessions"
# v0.9.282: gecachte GPX-Konvertate fremder Track-Formate (FIT/NMEA/KML/…)
IMPORTS_DIR = APP_SUPPORT / "_imports"
RENDERS_DIR.mkdir(parents=True, exist_ok=True)
BACKUPS_DIR.mkdir(parents=True, exist_ok=True)
DROPS_DIR.mkdir(parents=True, exist_ok=True)
TOURMAPS_DIR.mkdir(parents=True, exist_ok=True)
SESSIONS_GPX_DIR.mkdir(parents=True, exist_ok=True)
IMPORTS_DIR.mkdir(parents=True, exist_ok=True)

# v0.9.153: schützt den Zugriff auf pywebviews internen Drag&Drop-Pfad-Puffer
# (webview.dom._dnd_state['paths']) beim Auslesen via consume_drop_paths().
_drop_state_lock = threading.Lock()

# Logging früh aufsetzen, damit auch Import-/Init-Fehler nach dem Bridge-
# Import hier noch landen würden.
LOG_PATH = clog.setup_logging(APP_SUPPORT)
log = clog.get_logger("app")

# v0.9.229 — sichtbar machen, welcher Chromium-Pfad greift (gebündelt vs.
# User-Cache-Fallback). So lässt sich verifizieren, dass der Render out-of-box
# das mitgelieferte Chromium nutzt statt einen Download anzustoßen.
try:
    log.info("Playwright-Browser: %s (gebündelt=%s)", os.environ.get("PLAYWRIGHT_BROWSERS_PATH"), _pw_bundled)
except Exception:
    pass

# v0.9.74 — Foto-Pin Thumbnail-Cache (Phase 1). Pro Datei einmal erzeugt,
# danach aus Disk gezogen. Spart Sekunden pro Reload eines Projekts mit
# vielen Fotos.
cphotos.set_cache_dir(APP_SUPPORT / "photo_thumb_cache")

# Default-Settings — werden mit gespeicherten Werten gemerged
DEFAULT_SETTINGS = {
    "active_module": "animator",   # zuletzt aktives Modul
    "language": "auto",            # 'auto' | 'de' | 'en' | 'es'
    "mapbox_token": "",            # leer → OSM-Fallback; sonst User-Token
    # v0.9.247 — OSM-Modus erzwingen (Test): App läuft als hätte sie keinen
    # Token; der gespeicherte Token bleibt aber erhalten.
    "force_osm": False,
    # v0.9.338 — Adress-Suche (Reverse-Geocoding) im Geotagger
    "geocode_enabled": True,       # False = gar nicht ins Netz funken
    "geocode_provider": "auto",    # auto|mapbox|photon|nominatim (auto: Mapbox wenn Token, sonst Photon)
    # v0.9.348 — globale EXIF-Felder (Urheber/Copyright/…) als Profil über Sessions
    # hinweg gespeichert. Logische Keys → siehe _GT_GLOBAL_FIELDS im Geotagger-UI.
    "geotagger_global_exif": {},
    "onboarding_done": False,      # First-Run-Modal nicht mehr zeigen
    # v0.9.27 (Nutzer-Feedback): letzten GPX-Pfad über App-Restart persistieren
    "last_gpx_path": "",
    # v0.9.280 (Nutzer-Wunsch): In-App-Update-Check.
    "update_check_enabled": True,    # beim Start GitHub-Releases prüfen
    "update_last_check": "",         # ISO-Zeit der letzten Netzabfrage (Throttle)
    "update_latest_known": "",       # zuletzt gesehene Release-Version (Cache)
    "update_dismissed_version": "",  # vom User weggeklickte Version (nicht nochmal nerven)
    # v0.9.28 (Marc-Feedback): Fenster-Geometrie wird IMMER persistiert.
    # Erststart (x/y = -1) → maximiert. Danach merkt sich die App immer
    # die letzte Größe + Position. Kein Setting-Toggle mehr — wer das
    # nicht will, kann das Fenster vor dem Schließen einfach manuell
    # maximieren oder hat eh den Vollbild-Workflow.
    "window": {
        "width": -1,               # -1 = noch nichts gespeichert → Erststart
        "height": -1,
        "x": -1,
        "y": -1,
    },
    # v0.9.245 — Globale Render-/Export-Qualität (zentral im Einstellungen-
    # Dialog „Qualität & Export", nicht mehr verstreut in der Sidebar).
    # frame_format "jpeg" macht den Render ~10× schneller (PNG-Screenshot war
    # der Flaschenhals, 96% der Render-Zeit). Alpha-Renders erzwingen intern PNG.
    "render": {
        "frame_format": "jpeg",    # "jpeg" (schnell) | "png" (verlustfrei)
        "jpeg_quality": 92,        # 1..100, nur bei frame_format="jpeg"
        "codec": "h264",           # "h264" | "h265" | "prores"
        "crf": 20,                 # H.264/265-Qualität: niedriger = besser (16–28)
        "encoder_preset": "fast",  # libx264/265 Tempo↔Größe
    },
    "animator": {
        "map_style": "satellite",
        "duration_s": 12,
        "hold_s": 5,
        # v0.9.59 (Nutzer-Wunsch): Intro-Hold am Anfang. Default 0 = aus.
        "intro_s": 0,
        "fps": 30,
        "width": 3840,        # 4K default
        "height": 2160,
        "codec": "h264",      # "h264" | "h265"
        "crf": 20,
        "pitch": 40.0,
        "rotation": 20.0,
        # v0.9.82 — Spin (deg/sec). Generisch, wirkt in Intro/Anim/Hold.
        "spin_dps": 0.0,
        # v0.9.84 — Toggle für van-Wijk-Cinematic-Flug bei großen Zoom-Sprüngen.
        "cinematic_flyto": True,
        "exaggeration": 1.5,
        "enable_terrain": True,
        "show_overlays": True,
        "line_color": "#ff6b35",
        "line_width": 3.5,                         # Track-Dicke
        # v0.9.286b — Karte glätten (Anti-Flimmer-Tiefpass, nur 4K, Output-px)
        "map_smoothing": 1.3,
        # v0.8.10 — Track-Optik: "flat" (klassisch 2D) | "tube" (3D-Wurm, weißes Highlight oben)
        "track_style": "flat",
        # v0.8.17 — Classic-Modus: Kamera folgt Track-Punkt (an) oder bleibt
        # statisch auf Bbox-Center (aus, Default). Im KF-Modus ignoriert.
        "camera_follow_track": False,
        "camera_follow_inertia_pct": 0,  # v0.9.275 — Trägheit (0..100 %) beim Kamera-Folgen
        "smooth_camera_3d": False,  # v0.9.318 — Ruhige Kamera (entkoppelte FreeCamera gegen Berg-Hüpfen); Default AUS (alter, gut getesteter Modus). Ersetzt den toten follow_height_smooth_pct-Regler.
        # Stats-Overlays: pro Box enabled + Position (tl/tr/bl/br/bc)
        "overlay_totals_enabled": True,
        "overlay_totals_position": "tl",
        "overlay_live_enabled": True,
        "overlay_live_position": "tr",
        "overlay_elevation_enabled": True,
        "overlay_elevation_position": "bc",
        # v0.9.321 — Stats-Editor: wählbare/sortierbare Felder + globales Styling
        "overlay_live_fields": ["dist_done", "time_elapsed", "ele_now"],
        "overlay_totals_fields": ["dist_total", "moving_time", "avg_speed", "max_speed", "elev_gain", "elev_loss"],
        "overlay_field_overrides": {},   # v0.9.334 — pro-Projekt Umbenennung/Einheit
        "overlay_font": "system",
        "overlay_text_color": "#ffffff",
        "overlay_bg_color": "#000000",
        "overlay_bg_opacity": 0.55,
        # Zuletzt benutzter Save-Dir vom Render-Save-Dialog
        "last_save_dir": "",
        # v0.8.16: Master-Toggle für den Keyframe-Editor. Default false →
        # neue Projekte zeigen NICHT die Timeline-Bar + Detail-Editor (klassisch).
        # User schaltet's manuell ein wenn er die Pro-Features will.
        "keyframes_enabled": False,
        # v0.9.21: Track-Punkte-Anzahl (Slider). 0 = alle (Default), sonst exakte
        # Anzahl Punkte für den Render. Wird bei Slider-Drag persistiert, beim
        # GPX-Load aus dem aktiven Projekt restored.
        "point_count": 0,
        # v0.9.11 — Preview-Toggle: Vollständigen Track in der Vorschau zeigen
        # (kein Trim zur Scrubber-Position). Affects nur die Preview, nicht
        # das finale Render. Default false = klassisches Verhalten (Track
        # wird zur Scrubber-Position getrimmt).
        "preview_full_track": False,
        # v0.9.15 — Preview-Toggle: Keyframe-Pins (gelbe Dots auf dem Track)
        # in der Vorschau zeigen. Default true = hilfreiche Orientierung beim
        # Editieren. Aus → echtes WYSIWYG (Pins erscheinen nicht im finalen
        # Render). Marc-Spec: „man muss die keyfram dots, auf dem track
        # ausblenden können, damit es wirklich wysiwyg ist".
        "preview_show_kf_pins": True,
        # v0.7.0: Camera-Keyframe-Timeline (Liste von {kind, anchor, ...}-Dicts).
        # Leer = klassisches Verhalten (statischer pitch + linearer rotation sweep).
        "timeline_events": [],
        # v0.8.11: Anker-Semantik. 1 = Track-Anteil (alt, Render ignoriert Hold),
        # 2 = Timeline-Anteil (neu, anchor = 0..1 über gesamte Render-Dauer inkl.
        # Hold). Migration alter Projekte erfolgt in der UI beim ersten Laden.
        "timeline_anchor_v": 2,
        # v0.9.41 — Partial-Track-Render (Trim-Bereich). Anchor 0..1 über
        # GESAMT-Track. Default 0..1 = ganzer Track gerendert.
        "render_start_anchor": 0.0,
        "render_end_anchor": 1.0,
        # Stats-Box bei aktivem Trim: True = Trim-Werte (Default, Marc-Spec),
        # False = Gesamt-Track-Werte.
        "stats_use_trim": True,
        # v0.9.55 (Marc): Track-Linie VOR Trim-Start im Render zeigen?
        # True (Default) = ganzer Track als Hintergrund-Linie sichtbar.
        # False = Linie startet am Trim-Start (kein Pre-Trim).
        "show_pretrim_track": True,
        # v0.9.74 — Foto-Pin-Größe (Phase 1). Display-Pixel auf der Karte.
        # 24-80 px Slider. Geteilte Photo-Liste auf Projekt-Ebene, Größe
        # pro Modul separat damit Video + Print unterschiedliche Skala
        # haben können.
        "photos_size_px": 48,
        "photos_show": True,
    },
    "geotagger": {
        "offset_seconds": 0,                # Slider-Wert (-43200..+43200) — globaler Default
        "cam_offsets": {},                  # v0.9.354 — {Kamera-Modell: Offset-Sek} Override pro Kamera
        "ignore_gps": False,                # v0.9.364 — Foto-eigenes GPS ignorieren (globaler Default)
        "cam_ignore_gps": {},               # v0.9.364 — {Kamera-Modell: bool} Override pro Kamera
        "tz_offset_minutes": 0,             # v0.9.177 — Kamera-Zeitzone (UTC±, Minuten);
                                            # nur für Fotos OHNE eingebetteten TZ-Offset
        "make_backup": True,
        "overwrite_existing": False,
        "adjust_photo_time": False,
        # v0.9.281 (Nutzer): Aufnahmezeit (DateTimeOriginal) aus der Track-Zeit setzen.
        # v0.9.370 — jetzt für ALLE gematchten Fotos, pro Kamera schaltbar (globaler
        # Default + Override je Kamera). Nutzen: zwei Kameras mit falsch gestellter Uhr
        # laufen in Lightroom zeitlich synchron, GPS bleibt korrekt (Offset unberührt).
        "set_time_from_track": False,       # globaler Default
        "cam_set_time_from_track": {},      # v0.9.370 — {Kamera-Modell: bool} Override pro Kamera
        # v0.9.27 (Nutzer-Feedback): State-Persistenz über Modul-Wechsel + App-Restart
        "last_photos_dir": "",              # Letzter via Folder-Pick geladener Ordner
        "last_photos_paths": [],            # Letzte einzelne Foto-Pfade (Pick-Modus)
        "folder_recursive": False,          # Unterordner-Checkbox-State
    },
    "tourmap": {
        "map_style": "satellite",
        "width": 1920,
        "height": 1080,
        "pitch": 35.0,
        "bearing": -10.0,
        "padding_pct": 8.0,
        "exaggeration": 1.5,
        "enable_terrain": True,
        "line_color": "#ff6b35",
        "line_width": 4.5,
        # v0.8.10 — Track-Optik: "flat" | "tube" (synchron Animator)
        "track_style": "flat",
        "show_overlays": True,
        "overlay_totals_enabled": True,
        "overlay_totals_position": "tl",
        "overlay_elevation_enabled": False,
        "overlay_elevation_position": "bc",
        # v0.9.321 — Stats-Editor: Totals-Felder + globales Styling (gespiegelt)
        "overlay_totals_fields": ["dist_total", "moving_time", "avg_speed", "max_speed", "elev_gain", "elev_loss"],
        "overlay_font": "system",
        "overlay_text_color": "#ffffff",
        "overlay_bg_color": "#000000",
        "overlay_bg_opacity": 0.55,
        "show_pins": True,
        # v0.9.74 — Foto-Pin-Größe (Phase 1, gespiegelt zum Animator).
        "photos_size_px": 48,
        "photos_show": True,
    },
    # v0.9.92 — Höhen-Animator (4. Modul, Phase 1)
    "heightanim": {
        "duration_s": 12,
        "hold_s": 2,
        "fps": 30,
        "width": 1920,
        "height": 1080,
        "codec": "h264",
        "crf": 20,
        "background_color": "#1a1a1a",
        "line_color": "#ff6b35",
        "line_width": 4.0,
        "grid_enabled": True,
        "show_axes": True,
        "marker_radius": 8,
    },
}


def _migrate_settings(s: dict) -> dict:
    """Wendet Migrations-Schritte für ältere Settings-Versionen an."""
    g = s.get("geotagger") or {}
    # v0.1.x → v0.1.y: 4 Offset-Felder (h, m, s, sign) → 1 Slider-Wert (offset_seconds)
    if "offset_seconds" not in g and any(k in g for k in ("offset_h", "offset_m", "offset_s", "offset_sign")):
        sign = int(g.get("offset_sign", 1) or 1)
        h    = int(g.get("offset_h", 0) or 0)
        m    = int(g.get("offset_m", 0) or 0)
        sec  = int(g.get("offset_s", 0) or 0)
        g["offset_seconds"] = sign * (h * 3600 + m * 60 + sec)
        # Alte Felder weglassen
        for k in ("offset_h", "offset_m", "offset_s", "offset_sign"):
            g.pop(k, None)
        s["geotagger"] = g
    return s


def _version_tuple(v: str) -> tuple:
    """'0.9.280' → (0, 9, 280) für robusten Versionsvergleich. Nicht-numerische
    Teile (z.B. '-beta') werden ignoriert; fehlende Stellen zählen als 0."""
    out = []
    for part in str(v or "").lstrip("vV").split("."):
        num = ""
        for ch in part:
            if ch.isdigit():
                num += ch
            else:
                break
        out.append(int(num) if num else 0)
    return tuple(out)


def _load_settings() -> dict:
    """Liest settings.json. Failsafe: bei Korruption Defaults."""
    if not SETTINGS_FILE.exists():
        return json.loads(json.dumps(DEFAULT_SETTINGS))  # deep copy
    try:
        with open(SETTINGS_FILE, "r", encoding="utf-8") as fh:
            user = json.load(fh)
        # Tief mergen mit Defaults damit neue Keys nach Updates funktionieren
        result = json.loads(json.dumps(DEFAULT_SETTINGS))
        for k, v in user.items():
            if k in result and isinstance(result[k], dict) and isinstance(v, dict):
                result[k].update(v)
            else:
                result[k] = v
        # v0.8.0: timeline_events landen jetzt im Projekt-Layer
        # (sessions.json, track-gebunden). settings.json hält nur noch
        # globale Defaults; falls dort timeline_events drinstehen (von
        # v0.7.0–v0.7.6) → ausräumen, sonst würden sie alle Projekte
        # initial mit alten Anker-Werten überfluten.
        if "animator" in result and isinstance(result["animator"], dict):
            result["animator"].pop("timeline_events", None)
        return _migrate_settings(result)
    except Exception:
        return json.loads(json.dumps(DEFAULT_SETTINGS))


def _save_settings(data: dict) -> None:
    """Atomisch schreiben (temp + rename), damit ein Crash nicht die Datei korruptert."""
    tmp = SETTINGS_FILE.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
    tmp.replace(SETTINGS_FILE)


# ── Native macOS NSOpenPanel-Helper ──────────────────────────────────────────
# pywebview's create_file_dialog hat ~300–800 ms Bridge-Overhead. Wir umgehen
# das mit einem direkten PyObjC-Aufruf von NSOpenPanel auf dem Main-Thread.
# Funktioniert sofort.

def _parse_extensions(file_types: tuple[str, ...]) -> list[str]:
    """Extrahiert Datei-Endungen aus pywebview-Filter-Strings wie 'Fotos (*.jpg;*.jpeg)'."""
    exts = []
    for ft in file_types or ():
        m = re.search(r'\(([^)]+)\)', ft)
        if not m:
            continue
        for part in m.group(1).split(";"):
            part = part.strip().lower()
            if part.startswith("*."):
                ext = part[2:]
                if ext and ext != "*" and ext not in exts:
                    exts.append(ext)
    return exts


def _macos_pick(dialog_type: str, file_types: tuple[str, ...], multiple: bool) -> list[str]:
    """NSOpenPanel via PyObjC. Muss auf Main-Thread laufen."""
    from AppKit import (NSOpenPanel, NSModalResponseOK,  # type: ignore
                        NSApplication)
    from PyObjCTools import AppHelper  # type: ignore

    result: list[list[str]] = [[]]
    done = threading.Event()

    def show():
        try:
            panel = NSOpenPanel.openPanel()
            if dialog_type == "folder":
                panel.setCanChooseFiles_(False)
                panel.setCanChooseDirectories_(True)
                panel.setAllowsMultipleSelection_(False)
            else:
                panel.setCanChooseFiles_(True)
                panel.setCanChooseDirectories_(False)
                panel.setAllowsMultipleSelection_(bool(multiple))
                exts = _parse_extensions(file_types)
                if exts:
                    panel.setAllowedFileTypes_(exts)
            # App nach vorne holen damit der Modal-Dialog sichtbar ist
            try:
                NSApplication.sharedApplication().activateIgnoringOtherApps_(True)
            except Exception:
                pass
            if panel.runModal() == NSModalResponseOK:
                result[0] = [str(u.path()) for u in panel.URLs()]
        finally:
            done.set()

    # PyObjC-Threading: NSOpenPanel.runModal MUSS auf dem Main-Thread laufen.
    # callAfter queued das in die Main-RunLoop.
    AppHelper.callAfter(show)
    # Bis zu 5 Minuten warten (User braucht ja u.U. ewig zum Klicken)
    done.wait(timeout=300)
    return result[0]


def _macos_save_panel(default_name: str, default_dir: str,
                      file_types: tuple[str, ...]) -> str:
    """NSSavePanel via PyObjC für Save-As-Dialog. Returns absoluten Pfad
    oder leeren String wenn Cancel."""
    from AppKit import (NSSavePanel, NSModalResponseOK,  # type: ignore
                        NSApplication, NSURL)
    from PyObjCTools import AppHelper  # type: ignore

    result: list[str] = [""]
    done = threading.Event()

    def show():
        try:
            panel = NSSavePanel.savePanel()
            if default_name:
                panel.setNameFieldStringValue_(default_name)
            if default_dir:
                try:
                    url = NSURL.fileURLWithPath_(default_dir)
                    panel.setDirectoryURL_(url)
                except Exception:
                    pass
            exts = _parse_extensions(file_types)
            if exts:
                panel.setAllowedFileTypes_(exts)
            try:
                NSApplication.sharedApplication().activateIgnoringOtherApps_(True)
            except Exception:
                pass
            if panel.runModal() == NSModalResponseOK:
                url = panel.URL()
                if url is not None:
                    result[0] = str(url.path())
        finally:
            done.set()

    AppHelper.callAfter(show)
    done.wait(timeout=300)
    return result[0]

# Kein bundled Default-Token mehr — die App fordert beim ersten Start einen
# eigenen vom User an (First-Run-Modal). Settings-Key `mapbox_token` enthält
# den Public-Token, leer = nicht konfiguriert.
DEFAULT_MAPBOX_TOKEN = ""


def _active_mapbox_token() -> str:
    """Liefert den User-Mapbox-Token aus Settings. Leerer String wenn noch
    keiner konfiguriert ist — Aufrufer muss das vorher mit
    `is_mapbox_configured()` prüfen."""
    s = _load_settings()
    # v0.9.247 — OSM erzwungen (Test): so tun, als wäre kein Token da. Der
    # gespeicherte Token bleibt in den Settings, wird nur nicht genutzt.
    if s.get("force_osm"):
        return ""
    tok = (s.get("mapbox_token") or "").strip()
    if tok.startswith("pk.") and len(tok) > 20:
        return tok
    return ""


def _is_mapbox_configured() -> bool:
    return bool(_active_mapbox_token())


# ── Lokaler Media-HTTP-Server (v0.9.160) ──────────────────────────────────────
# WKWebView lädt <video src="file://…"> von externen Volumes/anderen Ordnern NICHT
# zuverlässig: pywebview setzt `allowFileAccessFromFileURLs` (deshalb laden CSS/JS
# cross-dir), aber NICHT `allowUniversalAccessFromFileURLs`, und Media-Elemente
# sind strenger gesandboxt als Scripts. Folge: das fertige Render-Video (z.B. auf
# `/Volumes/8TB …/…mp4`) blieb im eingebetteten Player schwarz.
# Lösung: das Video über einen winzigen localhost-HTTP-Server mit Range-Support
# (WKWebView verlangt 206-Antworten für `<video>`) ausliefern → zuverlässige
# Inline-Wiedergabe, unabhängig vom Pfad/Volume. Nur registrierte Tokens werden
# bedient (kein offener Datei-Zugriff). 127.0.0.1 + Port 0 (auto).
import http.server as _httpserver
import secrets as _secrets

_media_registry: dict[str, str] = {}   # token -> absoluter Dateipfad
_media_httpd = None
_media_port = 0
_media_lock = threading.Lock()


class _MediaRequestHandler(_httpserver.BaseHTTPRequestHandler):
    def log_message(self, *_a):  # kein Stdout-Spam pro Range-Request
        pass

    def _resolve(self) -> Optional[str]:
        parts = self.path.split("?", 1)[0].strip("/").split("/")
        if len(parts) == 2 and parts[0] == "media":
            return _media_registry.get(parts[1])
        return None

    def do_HEAD(self):
        self._serve(head_only=True)

    def do_GET(self):
        self._serve(head_only=False)

    def _serve(self, head_only: bool):
        fp = self._resolve()
        if not fp or not os.path.isfile(fp):
            try: self.send_error(404)
            except Exception: pass
            return
        try:
            fsize = os.path.getsize(fp)
            low = fp.lower()
            ctype = "video/quicktime" if low.endswith(".mov") else \
                    "video/webm" if low.endswith(".webm") else "video/mp4"
            start, end, status = 0, fsize - 1, 200
            rng = self.headers.get("Range")
            if rng and rng.startswith("bytes="):
                status = 206
                s, _, e = rng[6:].split(",")[0].strip().partition("-")
                if s.strip():
                    start = int(s)
                    if e.strip():
                        end = int(e)
                elif e.strip():            # Suffix-Range: bytes=-N
                    start = max(0, fsize - int(e))
                start = max(0, min(start, fsize - 1))
                end = max(start, min(end, fsize - 1))
            length = end - start + 1
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(length))
            if status == 206:
                self.send_header("Content-Range", f"bytes {start}-{end}/{fsize}")
            self.end_headers()
            if head_only:
                return
            with open(fp, "rb") as f:
                f.seek(start)
                remaining = length
                while remaining > 0:
                    chunk = f.read(min(262144, remaining))
                    if not chunk:
                        break
                    try:
                        self.wfile.write(chunk)
                    except (BrokenPipeError, ConnectionResetError):
                        return  # Player hat Verbindung gekappt (Seek/Close) — ok
                    remaining -= len(chunk)
        except Exception:
            try: self.send_error(500)
            except Exception: pass


def _ensure_media_server() -> int:
    """Startet den Media-Server lazy (einmalig) und liefert den Port."""
    global _media_httpd, _media_port
    with _media_lock:
        if _media_httpd is not None:
            return _media_port
        httpd = _httpserver.ThreadingHTTPServer(("127.0.0.1", 0), _MediaRequestHandler)
        httpd.daemon_threads = True
        _media_port = httpd.server_address[1]
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        _media_httpd = httpd
        log.info("Media-HTTP-Server läuft auf 127.0.0.1:%d", _media_port)
        return _media_port


def _height_visual_cfg_kwargs(params: dict) -> dict:
    """v0.9.397 — die visuellen HeightConfig-Felder aus den UI-Params. Von
    heightanim_start_render (Video) UND heightanim_export_html (HTML) genutzt,
    damit Render und Web-Export niemals auseinanderdriften. Enthält NICHT
    gpx_path/output_path/codec/crf/transparent_background (die setzt der Caller)."""
    return dict(
        duration_s=int(params.get("duration_s", 12)),
        hold_s=int(params.get("hold_s", 2)),
        fps=int(params.get("fps", 30)),
        width=int(params.get("width", 1920)),
        height=int(params.get("height", 1080)),
        background_color=params.get("background_color", "#1a1a1a"),
        line_color=params.get("line_color", "#ff6b35"),
        line_width=float(params.get("line_width", 4.0)),
        grid_enabled=bool(params.get("grid_enabled", True)),
        show_axes=bool(params.get("show_axes", True)),
        show_marker=bool(params.get("show_marker", True)),
        marker_show_dot=bool(params.get("marker_show_dot", True)),
        grid_color=params.get("grid_color", "#3a3a3a"),
        label_color=params.get("label_color", "#cccccc"),
        smoothing=int(params.get("smoothing", 0)),
        area_fill=bool(params.get("area_fill", True)),
        area_color=params.get("area_color", "#ff6b35"),
        area_opacity=int(params.get("area_opacity", 18)),
        area_mode=params.get("area_mode", "smooth"),
        fill_stops=params.get("fill_stops", []) or [],
        bg_mode=params.get("bg_mode", "smooth"),
        bg_clip=bool(params.get("bg_clip", False)),
        bg_stops=params.get("bg_stops", []) or [],
        line_mode=params.get("line_mode", "smooth"),
        line_stops=params.get("line_stops", []) or [],
        marker_dot_color=params.get("marker_dot_color", "#ffffff"),
        marker_dot_size=float(params.get("marker_dot_size", 6.0)),
        marker_bg=params.get("marker_bg", "#000000"),
        marker_bg_opacity=float(params.get("marker_bg_opacity", 0.6)),
        marker_border_color=params.get("marker_border_color", "#ff6b35"),
        marker_border_width=float(params.get("marker_border_width", 1.5)),
        marker_font_size=float(params.get("marker_font_size", 16.0)),
        marker_show_icon=bool(params.get("marker_show_icon", True)),
        marker_show_ele=bool(params.get("marker_show_ele", True)),
        marker_show_dist=bool(params.get("marker_show_dist", True)),
        show_stats_header=bool(params.get("show_stats_header", True)),
        stats_fields=list(params.get("stats_fields") or [
            "distance", "updown", "avg_grad", "max_grad", "ele_max"]),
        stats_labels=dict(params.get("stats_labels") or {}),
        show_gradient=bool(params.get("show_gradient", True)),
        waypoints=list(params.get("waypoints") or []),
        trim_start=float(params.get("trim_start", 0.0)),
        trim_end=float(params.get("trim_end", 1.0)),
    )


class Api:
    """JS-Bridge. Methoden hier sind aus dem WebView via window.pywebview.api.* aufrufbar."""

    def __init__(self) -> None:
        self._window: Optional[webview.Window] = None
        self._render_thread: Optional[threading.Thread] = None
        self._render_state = {"running": False, "progress": 0.0, "status": "", "output": "", "error": ""}
        # Tour-Karten-PNG-Worker (analog Animator, eigener Thread/State)
        self._tourmap_thread: Optional[threading.Thread] = None
        self._tourmap_state = {"running": False, "progress": 0.0, "status": "", "output": "", "error": ""}
        # Höhen-Animator-Worker (analog Animator, eigener Thread/State)
        self._height_render_thread: Optional[threading.Thread] = None
        self._height_render_state = {"running": False, "progress": 0.0, "status": "", "output": "", "error": ""}
        # Geotagger-State (im Speicher pro Session)
        self._gtg_track: list[cgpx.TrackPoint] = []
        self._gtg_display: list[cgpx.TrackPoint] = []  # v0.9.167 — gezeichnete (downsampled) Linie für Snap
        self._gtg_stats: Optional[cgpx.TrackStats] = None
        self._gtg_photos: list[dict] = []  # [{path, photo_time, ...}]
        # Lazy-Thumb-Worker
        self._thumb_worker: Optional[threading.Thread] = None
        self._thumb_queue_ready: dict = {}    # path → {thumb, photo_time, existing_gps, is_raw}
        self._thumb_progress = {"total": 0, "done": 0, "running": False}
        self._thumb_lock = threading.Lock()
        # v0.9.146: In-Memory-Thumb-Cache (path+mtime+size → data-url), damit
        # Tab-Wechsel / erneutes Registrieren derselben Fotos nicht jedes Mal
        # das volle JPEG neu dekodiert. Key enthält mtime → nach GPS-Write
        # (mtime ändert sich) automatisch Cache-Miss = korrektes Neu-Decode.
        self._thumb_cache: dict = {}
        # Async-Write-State
        self._write_worker: Optional[threading.Thread] = None
        self._write_state: dict = {
            "running": False, "total": 0, "done": 0,
            "current_name": None, "current_path": None,
            "errors": [], "skipped": 0,
            "backup_path": None, "completed": False, "cancel": False,
        }
        self._write_lock = threading.Lock()
        # v0.9.337 — Reverse-Geocoding (Adresse) im Hintergrund
        self._geo_lock = threading.Lock()
        self._geo_state = {"running": False, "total": 0, "done": 0,
                           "completed": False, "results": {}}
        self._geo_worker = None
        # v0.9.349 — Bilderkennung / Auto-Tag (Apple Vision, nur macOS)
        self._autotag_lock = threading.Lock()
        self._autotag_state = {"running": False, "total": 0, "done": 0,
                               "completed": False, "cancel": False,
                               "results": {}, "error": ""}
        self._autotag_worker = None

    def set_window(self, win: webview.Window) -> None:
        self._window = win

    # ── Common ────────────────────────────────────────────────────────────────

    def get_mapbox_token(self) -> str:
        return _active_mapbox_token()

    def mapbox_token_info(self) -> dict:
        """Liefert Status des aktuell gesetzten Tokens fürs Settings-UI."""
        s = _load_settings()
        user_tok = (s.get("mapbox_token") or "").strip()
        is_configured = bool(user_tok and user_tok.startswith("pk."))
        return {
            "is_configured": is_configured,
            "is_user_token": is_configured,
            "token_preview": (user_tok[:18] + "…" if user_tok else ""),
        }

    def open_url(self, url: str) -> dict:
        """Öffnet eine URL im Default-Browser (für Mapbox-Hilfeseite etc.) bzw.
        eine mailto:-Adresse im Default-Mail-Programm.
        v0.9.285 (Nutzer-Bug): mailto: war vorher nicht erlaubt → der „Lokales
        Mail-Programm öffnen"-Button (Bug-Report) tat unter Windows nichts."""
        import webbrowser
        try:
            if not url:
                return {"ok": False, "error": "Leere URL"}
            if url.startswith(("http://", "https://", "mailto:")):
                webbrowser.open(url, new=2)
                return {"ok": True}
            return {"ok": False, "error": "Ungültige URL"}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    # ── Update-Check (Nutzer-Wunsch v0.9.280) ──────────────────────────────────

    def check_for_update(self, force: bool = False) -> dict:
        """Prüft die GitHub-Releases-API auf eine neuere Version (Stufe 1: nur
        Hinweis, kein Selbst-Update). Throttelt Netzabfragen auf alle 12 h und
        cached das Ergebnis in den Settings, damit der App-Start nicht jedes Mal
        eine HTTP-Anfrage feuert. `force=True` (manueller „Suchen"-Button) umgeht
        Throttle UND das `update_check_enabled`-Flag.

        Rückgabe:
          ok               – Abfrage gelaufen (auch wenn aktuell)
          available        – True wenn latest > current
          current/latest   – Versions-Strings ohne „v"
          download_url     – plattformpassender Direkt-Download (Linux → Seite)
          page_url         – GitHub-Releases-Seite
          dismissed        – True wenn der User genau diese Version weggeklickt hat
          checked_network  – ob diesmal wirklich GitHub gefragt wurde
        """
        s = _load_settings()
        current = APP_VERSION
        page_url = UPDATE_DOWNLOAD_PAGE
        dl_url = _UPDATE_SHORTLINKS.get(sys.platform, UPDATE_DOWNLOAD_PAGE)

        if not force and not s.get("update_check_enabled", True):
            return {"ok": True, "available": False, "enabled": False,
                    "current": current, "checked_network": False}

        # Throttle: innerhalb von 12 h kein neuer Netz-Call → Cache aus Settings.
        latest = str(s.get("update_latest_known", "") or "")
        do_network = force
        if not do_network:
            last = str(s.get("update_last_check", "") or "")
            if not last:
                do_network = True
            else:
                try:
                    age = (datetime.now(timezone.utc)
                           - datetime.fromisoformat(last)).total_seconds()
                    do_network = age >= UPDATE_CHECK_THROTTLE_S
                except Exception:
                    do_network = True

        if do_network:
            try:
                import urllib.request
                import ssl
                # v0.9.316 (Nutzer-Bug Update-Check „keine Verbindung"): im
                # PyInstaller-Bundle findet Pythons OpenSSL die System-CA-Zertifikate
                # NICHT → urlopen gegen die GitHub-API starb mit
                # CERTIFICATE_VERIFY_FAILED, was die App als „keine Verbindung"
                # meldete. Gleiche Wurzel wie der Reiseroute-SSL-Fix (core/route.py).
                # certifi ist via requests gebündelt; cacert.pem liegt im Bundle.
                try:
                    import certifi
                    _ctx = ssl.create_default_context(cafile=certifi.where())
                except Exception:  # noqa: BLE001
                    _ctx = ssl.create_default_context()
                req = urllib.request.Request(
                    UPDATE_RELEASES_API,
                    headers={"User-Agent": f"ReisezoomGPSStudio/{current}",
                             "Accept": "application/vnd.github+json"},
                )
                with urllib.request.urlopen(req, timeout=5, context=_ctx) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                tag = str(data.get("tag_name") or "").lstrip("vV").strip()
                if tag:
                    latest = tag
                s["update_latest_known"] = latest
                s["update_last_check"] = datetime.now(timezone.utc).isoformat()
                _save_settings(s)
            except Exception as e:
                log.info("check_for_update: Netzabfrage fehlgeschlagen: %s", e)
                # Bei Fehler: still bleiben, nur Cache nutzen (kein UI-Fehler).
                return {"ok": False, "available": False, "current": current,
                        "latest": latest, "checked_network": True,
                        "error": str(e)}

        available = bool(latest) and _version_tuple(latest) > _version_tuple(current)
        dismissed = (str(s.get("update_dismissed_version", "") or "") == latest)
        return {
            "ok": True,
            "available": available,
            "current": current,
            "latest": latest,
            "download_url": dl_url,
            "page_url": page_url,
            "changelog_url": UPDATE_CHANGELOG_URL,  # v0.9.319 — „Was ist neu?"
            "dismissed": dismissed,
            "checked_network": do_network,
        }

    def update_dismiss(self, version: str) -> dict:
        """Merkt sich, dass der User diese Version weggeklickt hat — Banner kommt
        für genau diese Version nicht wieder (für die nächste schon)."""
        try:
            s = _load_settings()
            s["update_dismissed_version"] = str(version or "")
            _save_settings(s)
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    # ── Settings ──────────────────────────────────────────────────────────────

    def settings_get(self) -> dict:
        """Liefert alle persistierten Settings (mit Defaults aufgefüllt)."""
        return _load_settings()

    def get_paths(self) -> dict:
        """Wichtige Pfade für UI-Anzeige (Backup-Dir, Renders-Dir, App-Support)."""
        return {
            "renders": str(RENDERS_DIR),
            "backups_photos": str(BACKUPS_DIR),
            "app_support": str(APP_SUPPORT),
            "drops": str(DROPS_DIR),
        }

    # ── i18n ──────────────────────────────────────────────────────────────────

    def i18n_get_strings(self) -> dict:
        """Liefert das aktuelle Strings-Dict + Metadaten ans UI."""
        s = _load_settings()
        requested = s.get("language", "auto") or "auto"
        active = ci18n.resolve(requested)
        return {
            "active": active,                       # die UI-Sprache, die aktuell rendert
            "requested": requested,                 # 'auto' | 'de' | 'en' | …
            "system_locale": ci18n.detect_system_locale(),  # was Systemsprache wäre
            "strings": ci18n.get_strings(active),
            "available": ci18n.available_locales(),
        }

    def settings_set(self, patch: dict) -> dict:
        """Merget patch in die Settings und schreibt sie. Patch kann nur einzelne
        Sub-Keys enthalten (z.B. {"animator": {"pitch": 30}}).

        v0.8.0: `animator.timeline_events` landet jetzt im Projekt-Layer
        (sessions.json). Falls trotzdem hier reinkommt → rausfiltern."""
        try:
            current = _load_settings()
            for k, v in patch.items():
                if k in current and isinstance(current[k], dict) and isinstance(v, dict):
                    current[k].update(v)
                else:
                    current[k] = v
            # timeline_events nicht in settings.json — gehört ins Projekt
            if "animator" in current and isinstance(current["animator"], dict):
                current["animator"].pop("timeline_events", None)
            _save_settings(current)
            return {"ok": True, "settings": current}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def settings_reset_module(self, module_slug: str) -> dict:
        """Setzt alle Settings eines Moduls auf die DEFAULT-Werte zurück.
        `module_slug` z.B. 'animator', 'tourmap', 'geotagger'."""
        try:
            if module_slug not in DEFAULT_SETTINGS:
                return {"ok": False, "error": f"Unbekanntes Modul: {module_slug}"}
            current = _load_settings()
            # Deep-copy der Defaults damit ein nachträglicher Edit Defaults nicht verändert
            current[module_slug] = json.loads(json.dumps(DEFAULT_SETTINGS[module_slug]))
            _save_settings(current)
            log.info("settings_reset_module: %s zurückgesetzt", module_slug)
            return {"ok": True, "settings": current}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    # ── v0.8.0: Sessions + Projekte ────────────────────────────────────────

    def _session_get_global_defaults(self) -> dict:
        """Liefert die echten Modul-Default-Werte (`DEFAULT_SETTINGS`) als
        Basis für „Neues Projekt" — NICHT settings.json.

        v0.8.10-Marc-Bug: vorher wurde settings.json zurückgegeben.
        settings.json kann aber user-modifizierte Werte enthalten (z.B.
        wenn Marc Slider verstellt hat BEVOR er ein GPX geladen hat —
        dann landete der Wert in settings.json). Diese landeten dann
        als „Defaults" in jedem neuen Projekt → neues Projekt war nicht
        leer sondern hatte den letzten Stand der globalen Settings.
        Jetzt: echte Defaults aus DEFAULT_SETTINGS-Konstante.

        v0.9.287 (Marc-Wunsch „eigene Defaults"): Auf die Werks-Defaults werden
        die vom User gespeicherten Standardwerte (`settings.json["user_defaults"]`,
        gesetzt via `save_user_defaults`) draufgemergt. So startet jeder NEUE Track
        mit Marcs bevorzugtem Look statt mit den nackten Werkswerten. Bestehende
        Projekte bleiben unberührt (greift nur beim Neu-Anlegen einer Session)."""
        base = json.loads(json.dumps(DEFAULT_SETTINGS))
        try:
            raw = {}
            if SETTINGS_FILE.exists():
                with open(SETTINGS_FILE, "r", encoding="utf-8") as fh:
                    raw = json.load(fh)
            ud = raw.get("user_defaults") or {}
            for mod, vals in ud.items():
                if mod in base and isinstance(base[mod], dict) and isinstance(vals, dict):
                    base[mod].update(vals)
        except Exception:
            pass  # Defekte Defaults → still auf Werk zurückfallen
        return base

    def save_user_defaults(self, track_hash: str = "", project_id: str = "") -> dict:
        """Speichert den aktuellen Look als eigene Standardwerte für NEUE Tracks
        (Marc-Wunsch v0.9.287). Quelle: das angegebene aktive Projekt aus
        sessions.json (Source-of-Truth, immer aktuell, da saveProjectSettings
        sofort persistiert). Ohne Session → globale settings.json (Scratch-Stand
        bei keinem geladenen GPX).

        Es werden NUR Keys übernommen, die in DEFAULT_SETTINGS[modul] existieren —
        damit bleibt track-spezifischer Kram (Keyframes/`timeline_events`, Fotos,
        Route, Trim, Welt-Offsets) automatisch draußen und vergiftet keine neuen
        Tracks. Bestehende Projekte werden NICHT verändert."""
        try:
            source = {}
            if track_hash and project_id:
                data = _sessions.load_sessions(SESSIONS_FILE)
                sess = data.get("sessions", {}).get(track_hash)
                if sess:
                    source = sess.get("projects", {}).get(project_id) or {}
            if not source:
                source = _load_settings()  # Fallback: globaler Scratch-Stand
            # Track-spezifische Keys, die ZWAR in DEFAULT_SETTINGS stehen (als
            # leere Anfangswerte), aber NIEMALS als globaler Default taugen —
            # sonst bekäme jeder neue Track z.B. die Keyframes/Trim/Foto-Pfade
            # vom Track, auf dem „Speichern" geklickt wurde.
            blacklist = {
                "animator": {"timeline_events", "render_start_anchor",
                             "render_end_anchor", "timeline_anchor_v", "last_save_dir"},
                "geotagger": {"last_photos_dir", "last_photos_paths"},
            }
            ud = {}
            for mod, defaults in DEFAULT_SETTINGS.items():
                if not isinstance(defaults, dict):
                    continue
                src_mod = source.get(mod)
                if not isinstance(src_mod, dict):
                    continue
                bl = blacklist.get(mod, set())
                picked = {k: src_mod[k] for k in defaults.keys()
                          if k in src_mod and k not in bl}
                if picked:
                    ud[mod] = picked
            raw = {}
            if SETTINGS_FILE.exists():
                with open(SETTINGS_FILE, "r", encoding="utf-8") as fh:
                    raw = json.load(fh)
            raw["user_defaults"] = ud
            _save_settings(raw)
            return {"ok": True, "modules": list(ud.keys())}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def reset_user_defaults(self) -> dict:
        """Entfernt die eigenen Standardwerte → neue Tracks starten wieder mit
        den Werkseinstellungen. Bestehende Projekte bleiben unberührt."""
        try:
            raw = {}
            if SETTINGS_FILE.exists():
                with open(SETTINGS_FILE, "r", encoding="utf-8") as fh:
                    raw = json.load(fh)
            had = bool(raw.pop("user_defaults", None))
            _save_settings(raw)
            return {"ok": True, "had_custom": had}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def get_user_defaults_info(self) -> dict:
        """Status für die UI: gibt es eigene Standardwerte?"""
        try:
            raw = {}
            if SETTINGS_FILE.exists():
                with open(SETTINGS_FILE, "r", encoding="utf-8") as fh:
                    raw = json.load(fh)
            ud = raw.get("user_defaults") or {}
            return {"ok": True, "has_custom": bool(ud), "modules": list(ud.keys())}
        except Exception as e:
            return {"ok": False, "error": str(e), "has_custom": False}

    def session_open_for_track(self, coords: list, gpx_path: str = "") -> dict:
        """Aktiviert (oder erstellt) eine Session für die gegebenen
        Track-Koordinaten. Returns das aktive Projekt + Liste der Projekte.

        UI ruft das beim GPX-Load auf — danach kommen die Modul-Settings
        vom aktiven Projekt statt aus settings.json.

        Returns:
          {
            "ok": True,
            "track_hash": "...",
            "session": {"name": "...", "track_hash": "...", "stats": {...}},
            "active_project": {...},  # mit "animator"/"tourmap"/"geotagger"
            "projects": [{"id", "name", "is_active"}, ...],
          }
        """
        try:
            if not coords or len(coords) < 2:
                return {"ok": False, "error": "Track zu kurz für Session-Hash"}
            # v0.9.382 — Name-im-Hash (v0.9.380) ZURÜCKGENOMMEN: `session_open_for_track`
            # wird pro Load mehrfach aufgerufen, teils MIT gpx_path, teils ohne (z.B.
            # Geotagger-Drop). Mit Name im Hash ergab das ZWEI Sessions für denselben
            # Track → Speichern (Tour-Map, Session A) und Rendern (aktives Projekt aus
            # Session B) drifteten auseinander → „Aus Geotagger" zeigte nichts. Zurück
            # zum stabilen reinen Koordinaten-Hash. „Umbenennen = neues Projekt" lösen
            # wir separat + sicher (expliziter Button), nicht über den Hash.
            track_hash = _sessions.compute_track_hash(coords)
            data = _sessions.load_sessions(SESSIONS_FILE)
            defaults = self._session_get_global_defaults()
            sess, active_proj = _sessions.get_or_create_session(
                data, track_hash, coords, gpx_path or None,
                SESSIONS_GPX_DIR, defaults,
            )
            _sessions.save_sessions(SESSIONS_FILE, data)
            log.info("session_open_for_track: hash=%s name=%r active=%r",
                     track_hash, sess.get("name"), active_proj.get("name"))
            return {
                "ok": True,
                "track_hash": track_hash,
                "session": {
                    "track_hash": sess["track_hash"],
                    "name": sess["name"],
                    "stats": sess.get("stats", {}),
                    "gpx_snapshot_path": sess.get("gpx_snapshot_path", ""),
                },
                "active_project": active_proj,
                "projects": _sessions.list_projects(sess),
            }
        except Exception as e:
            log.exception("session_open_for_track failed")
            return {"ok": False, "error": str(e)}

    def session_get_active(self) -> dict:
        """Liefert die zuletzt aktive Session (für Modul-Wechsel ohne
        erneuten GPX-Load) — oder None wenn keine Session aktiv ist.

        Ein „aktive Session"-State wird nicht persistiert; wenn das UI
        die aktive Session braucht, hält sie das in JS-State."""
        # In dieser Version: keine globale aktive Session — UI verwaltet.
        return {"ok": True, "active": None}

    def session_list_projects(self, track_hash: str) -> dict:
        try:
            data = _sessions.load_sessions(SESSIONS_FILE)
            sess = (data.get("sessions") or {}).get(track_hash)
            if not sess:
                return {"ok": False, "error": "Session nicht gefunden"}
            return {
                "ok": True,
                "projects": _sessions.list_projects(sess),
                "active_project_id": sess.get("active_project_id"),
            }
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def session_set_active_project(self, track_hash: str, project_id: str) -> dict:
        try:
            data = _sessions.load_sessions(SESSIONS_FILE)
            sess = (data.get("sessions") or {}).get(track_hash)
            if not sess:
                return {"ok": False, "error": "Session nicht gefunden"}
            if not _sessions.set_active_project(sess, project_id):
                return {"ok": False, "error": "Projekt nicht gefunden"}
            _sessions.save_sessions(SESSIONS_FILE, data)
            active_proj = sess["projects"][project_id]
            log.info("session_set_active_project: hash=%s project=%r",
                     track_hash, active_proj.get("name"))
            return {
                "ok": True,
                "active_project": active_proj,
                "projects": _sessions.list_projects(sess),
            }
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def session_create_project(self, track_hash: str, name: str,
                                copy_from_id: str = "") -> dict:
        """Legt ein neues Projekt an. `copy_from_id` leer → Defaults aus
        settings.json. Gefüllt → Duplikat des angegebenen Projekts.
        Macht das neue Projekt automatisch zum aktiven."""
        try:
            data = _sessions.load_sessions(SESSIONS_FILE)
            sess = (data.get("sessions") or {}).get(track_hash)
            if not sess:
                return {"ok": False, "error": "Session nicht gefunden"}
            defaults = self._session_get_global_defaults()
            proj = _sessions.create_project(
                sess, name or _sessions.DEFAULT_PROJECT_NAME, defaults,
                copy_from_id=copy_from_id or None,
            )
            _sessions.save_sessions(SESSIONS_FILE, data)
            log.info("session_create_project: hash=%s name=%r dup_from=%s",
                     track_hash, proj.get("name"), copy_from_id or None)
            return {
                "ok": True,
                "active_project": proj,
                "projects": _sessions.list_projects(sess),
            }
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def session_rename_project(self, track_hash: str, project_id: str,
                                new_name: str) -> dict:
        try:
            data = _sessions.load_sessions(SESSIONS_FILE)
            sess = (data.get("sessions") or {}).get(track_hash)
            if not sess:
                return {"ok": False, "error": "Session nicht gefunden"}
            if not _sessions.rename_project(sess, project_id, new_name or "?"):
                return {"ok": False, "error": "Projekt nicht gefunden"}
            _sessions.save_sessions(SESSIONS_FILE, data)
            return {"ok": True, "projects": _sessions.list_projects(sess)}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def session_delete_project(self, track_hash: str, project_id: str) -> dict:
        try:
            data = _sessions.load_sessions(SESSIONS_FILE)
            sess = (data.get("sessions") or {}).get(track_hash)
            if not sess:
                return {"ok": False, "error": "Session nicht gefunden"}
            defaults = self._session_get_global_defaults()
            new_active = _sessions.delete_project(sess, project_id, defaults)
            _sessions.save_sessions(SESSIONS_FILE, data)
            log.info("session_delete_project: hash=%s id=%s → new-active=%r",
                     track_hash, project_id, new_active.get("name"))
            return {
                "ok": True,
                "active_project": new_active,
                "projects": _sessions.list_projects(sess),
            }
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def session_update_project_settings(self, track_hash: str, project_id: str,
                                         module: str, patch: dict) -> dict:
        """Patcht Settings des Projekts im angegebenen Modul. Modul ist
        z.B. 'animator', 'tourmap', 'geotagger'.

        v0.8.0: Geotagger-Foto-Refs werden NICHT akzeptiert — der Filter
        ist hier eine zweite Sicherheits-Ebene (Frontend sollte sie eh
        nicht senden)."""
        try:
            data = _sessions.load_sessions(SESSIONS_FILE)
            sess = (data.get("sessions") or {}).get(track_hash)
            if not sess:
                return {"ok": False, "error": "Session nicht gefunden"}
            # Geotagger: photo-Refs filtern
            if module == "geotagger" and isinstance(patch, dict):
                patch = {k: v for k, v in patch.items()
                         if k not in ("photos", "photo_paths", "loaded_photos")}
            # Auch animator: timeline_events landet aber jetzt im Projekt,
            # das ist OK (track-gebunden, ergibt Sinn)
            if not _sessions.update_project_settings(sess, project_id, module, patch):
                return {"ok": False, "error": "Projekt nicht gefunden"}
            _sessions.save_sessions(SESSIONS_FILE, data)
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def session_update_project_root(self, track_hash: str, project_id: str,
                                     patch: dict) -> dict:
        """v0.9.74: Patcht Felder auf Projekt-Root-Ebene (NICHT in einem
        Modul-Subkey). Aktuell genutzt für `photos: [...]` (geteilt zwischen
        Animator + Tour-Map). Reserved-Keys (id, created_at) werden vom
        Backend gefiltert."""
        try:
            data = _sessions.load_sessions(SESSIONS_FILE)
            sess = (data.get("sessions") or {}).get(track_hash)
            if not sess:
                return {"ok": False, "error": "Session nicht gefunden"}
            if not _sessions.update_project_settings(sess, project_id, None, patch):
                return {"ok": False, "error": "Projekt nicht gefunden"}
            _sessions.save_sessions(SESSIONS_FILE, data)
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def pick_save_path(self, default_name: str = "",
                       default_dir: str = "",
                       file_types: tuple[str, ...] = ()) -> str:
        """Save-As-Dialog. Returns ausgewählten absoluten Pfad oder leeren
        String bei Cancel.

        - `default_name`: Vorbefüllter Dateiname (z.B. "MeineTour.png")
        - `default_dir`: Ausgangs-Ordner
        - `file_types`: ["PNG (*.png)"] etc. — wie bei pick_file
        """
        if sys.platform == "darwin":
            try:
                return _macos_save_panel(default_name, default_dir, file_types)
            except Exception:
                traceback.print_exc()
        # Plattform-Fallback via pywebview
        if not self._window:
            return ""
        res = self._window.create_file_dialog(
            webview.SAVE_DIALOG,
            directory=default_dir or "",
            save_filename=default_name or "",
            file_types=file_types,
        )
        if not res:
            return ""
        if isinstance(res, (list, tuple)):
            return res[0] if res else ""
        return str(res)

    def pick_file(self, dialog_type: str = "open", file_types: tuple[str, ...] = (), multiple: bool = False) -> list[str]:
        """Native Datei-Dialog. Auf macOS direkt über PyObjC (`NSOpenPanel`) —
        spürbar schneller als pywebview's `create_file_dialog`, weil kein
        Bridge-Roundtrip nötig ist und der Dialog direkt im Main-Thread aufgeht.

        file_types: Liste à la `'Description (*.ext1;*.ext2)'`.
        """
        if sys.platform == "darwin":
            try:
                return _macos_pick(dialog_type, file_types, multiple)
            except Exception:
                # Bei jedem PyObjC-Fehler: Fallback auf pywebview's API
                traceback.print_exc()
        if not self._window:
            return []
        if dialog_type == "open":
            res = self._window.create_file_dialog(
                webview.OPEN_DIALOG, allow_multiple=multiple, file_types=file_types
            )
        elif dialog_type == "folder":
            res = self._window.create_file_dialog(webview.FOLDER_DIALOG)
        else:
            res = self._window.create_file_dialog(webview.SAVE_DIALOG, file_types=file_types)
        if not res:
            return []
        return list(res) if isinstance(res, (list, tuple)) else [res]

    # ── Schilder mit Bild (v0.9.189) ─────────────────────────────────────────

    def sign_pick_image(self) -> dict:
        """Bild-Datei auswählen + Thumbnail (data-URL) zurückgeben.
        Für „Schild mit Bild" — ein Schild kann optional ein Bild anzeigen."""
        try:
            types = ("Bilder (*.jpg;*.jpeg;*.png;*.heic;*.heif;*.webp;*.tif;*.tiff;*.gif;*.bmp)",)
            res = self.pick_file("open", types, False)
            if not res:
                return {"ok": True, "cancelled": True}
            path = res[0]
            thumb = self._photo_thumbnail_data_url(path, 600)
            if not thumb:
                return {"ok": False, "error": "Bild konnte nicht gelesen werden."}
            return {"ok": True, "path": path, "thumb": thumb}
        except Exception as e:
            return {"ok": False, "error": str(e), "trace": traceback.format_exc()}

    def photos_time_anchors(self, paths, gpx_path) -> dict:
        """v0.9.203 — Für jedes Foto den track_anchor (0..1) über die AUFNAHME-ZEIT
        gegen die GPX-Zeitstempel bestimmen (statt über die Position). Löst das
        Loop-Problem: derselbe Ort kommt mehrfach am Track vor → Position ist
        mehrdeutig, die Zeit nicht. Liegt die Foto-Zeit außerhalb der Track-Spanne
        (z.B. falsche Kamera-Zeitzone), wird das Foto weggelassen → Caller nutzt
        dann den Positions-Anker (kein falsches Zeit-Match erzwingen)."""
        import datetime as _dt
        try:
            from core import gpx as _cgpx
            res = _cgpx.parse_gpx(gpx_path)
            pts = res[0] if isinstance(res, tuple) else res
            n = len(pts)
            if n < 2:
                return {"ok": True, "anchors": {}}
            idx_times = []
            for i, p in enumerate(pts):
                tv = getattr(p, "time", None)
                if not tv:
                    continue
                try:
                    idx_times.append((i, _dt.datetime.fromisoformat(str(tv).replace("Z", "+00:00"))))
                except Exception:
                    pass
            if not idx_times:
                return {"ok": True, "anchors": {}}
            t0 = idx_times[0][1]
            t1 = idx_times[-1][1]
            margin = _dt.timedelta(minutes=15)
            out = {}
            for path in (paths or []):
                try:
                    et = cexif.read_datetime(path)
                except Exception:
                    et = None
                if not et:
                    continue
                etu = et if et.tzinfo else et.replace(tzinfo=_dt.timezone.utc)
                if etu < t0 - margin or etu > t1 + margin:
                    continue   # Zeitzonen-/Zeit-Schutz → Caller nimmt Positions-Anker
                best_i = min(idx_times, key=lambda it: abs((it[1] - etu).total_seconds()))[0]
                out[path] = best_i / (n - 1)
            return {"ok": True, "anchors": out}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def sign_image_exists(self, path: str) -> dict:
        """Prüft, ob die Original-Bilddatei eines Schilds noch existiert.
        Für die Fehler-Anzeige, wenn ein Bild verschoben/gelöscht wurde —
        der Render braucht die Originaldatei (Vorschau läuft aus dem Cache-Thumb)."""
        try:
            return {"ok": True, "exists": bool(path) and os.path.exists(path)}
        except Exception:
            return {"ok": True, "exists": False}

    def sign_image_thumb(self, path: str) -> dict:
        """Thumbnail für einen bekannten Bild-Pfad (neu) erzeugen — beim
        Projekt-Laden, da der Thumb nicht persistiert wird (nur der Pfad)."""
        try:
            if not path or not os.path.exists(path):
                return {"ok": False, "error": "not found"}
            thumb = self._photo_thumbnail_data_url(path, 600)
            return {"ok": bool(thumb), "thumb": thumb}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    # ── Foto-Pins (v0.9.74, geteilt zwischen Animator + Tour-Map) ─────────────

    def photos_load(self, paths_or_folder) -> dict:
        """Lädt eine Liste von Fotos oder einen Ordner. Liefert für jedes
        Foto mit EXIF-GPS einen Eintrag mit lon/lat + 128-px-Thumbnail als
        data-URL. Fotos ohne GPS werden still übersprungen.

        Returns:
            {photos: [...], skipped_count: N, failed_count: N, total: N}

        Verwendung in UI: nach Drop oder Ordner-Pick mit dem Resultat
        `project.photos` updaten + Mapbox-Symbol-Layer rendern.
        """
        try:
            return cphotos.load_photos_with_gps(paths_or_folder)
        except Exception as e:
            log.exception("photos_load fehlgeschlagen: %s", e)
            return {"photos": [], "skipped_count": 0, "failed_count": 0,
                    "total": 0, "error": str(e)}

    def photos_from_geotagger(self) -> dict:
        """Übernimmt die aktuell im Geotagger geladenen Fotos und liest deren
        EXIF-GPS frisch ein. Nützlich nach dem Geotagger-Write-Workflow:
        Fotos haben dann frische GPS-Tags und können hier sofort als Pins
        auf der Karte erscheinen.

        Returns wie photos_load. Fotos ohne (geschriebene) GPS werden
        übersprungen — also wenn der Write noch nicht passiert ist,
        kommen wenige zurück."""
        paths = [p.get("path") for p in self._gtg_photos if p.get("path")]
        if not paths:
            return {"photos": [], "skipped_count": 0, "failed_count": 0,
                    "total": 0}
        try:
            return cphotos.load_photos_with_gps(paths)
        except Exception as e:
            log.exception("photos_from_geotagger fehlgeschlagen: %s", e)
            return {"photos": [], "skipped_count": 0, "failed_count": 0,
                    "total": 0, "error": str(e)}

    def photos_refresh_thumbs(self, paths) -> dict:
        """Für eine Liste bereits bekannter Pfade nur Thumb + GPS frisch
        ziehen — z.B. nach Projekt-Reload (gespeichert ist nur `path/lon/lat`,
        nicht das Base64-Thumb, weil das settings.json aufblähen würde)."""
        if not paths:
            return {"photos": [], "skipped_count": 0, "failed_count": 0,
                    "total": 0}
        try:
            return cphotos.refresh_thumbs_only(paths)
        except Exception as e:
            log.exception("photos_refresh_thumbs fehlgeschlagen: %s", e)
            return {"photos": [], "skipped_count": 0, "failed_count": 0,
                    "total": 0, "error": str(e)}

    # ── Universelle Track-Import-Schicht (v0.9.282) ────────────────────────────

    def _ensure_gpx(self, path: str) -> str:
        """Macht aus beliebigen Track-Formaten (FIT/NMEA/KML/KMZ/TCX/GeoJSON)
        transparent eine GPX: `.gpx` bleibt unverändert, alles andere wird
        konvertiert + im `_imports`-Cache abgelegt und der GPX-Pfad
        zurückgegeben. So arbeitet die ganze App weiter ausschließlich mit GPX.
        Wirft `cimports.TrackImportError` bei kaputten/leeren Fremdformaten."""
        return cimports.ensure_gpx(path, IMPORTS_DIR)

    def export_current_gpx(self) -> dict:
        """v0.9.282 — „Als GPX exportieren" (Menü). Nimmt den aktuell geladenen
        Track (auch wenn er aus FIT/NMEA/KML/… stammt — dann liegt eine
        konvertierte GPX im Cache) und speichert ihn per Save-Dialog als echte
        .gpx-Datei. So bekommt z.B. Nutzer aus seiner Canon-NMEA-Datei eine
        saubere GPX, ohne externen Konverter."""
        try:
            s = _load_settings()
            src = str(s.get("last_gpx_path", "") or "")
            if not src or not os.path.exists(src):
                return {"ok": False, "error": "Kein Track geladen."}
            gpx_path = self._ensure_gpx(src)   # .gpx bleibt, Fremdformat → Cache-GPX
            default_name = os.path.splitext(os.path.basename(src))[0] + ".gpx"
            dest = self.pick_save_path(default_name, str(Path.home()),
                                       ["GPX (*.gpx)"])
            if not dest:
                return {"ok": False, "cancelled": True}
            if not dest.lower().endswith(".gpx"):
                dest += ".gpx"
            shutil.copyfile(gpx_path, dest)
            log.info("export_current_gpx: %s → %s", gpx_path, dest)
            return {"ok": True, "path": dest}
        except Exception as e:
            log.exception("export_current_gpx fehlgeschlagen")
            return {"ok": False, "error": str(e)}

    def export_current_csv(self) -> dict:
        """v0.9.297 — „Als CSV exportieren" (Menü). Nimmt den aktuell geladenen
        Track (auch aus FIT/NMEA/KML/…) und speichert ihn als CSV
        (index,lat,lon,ele,time). Nutzt core.trackio — dieselbe Funktion wie der
        Web-Endpoint (single source)."""
        try:
            s = _load_settings()
            src = str(s.get("last_gpx_path", "") or "")
            if not src or not os.path.exists(src):
                return {"ok": False, "error": "Kein Track geladen."}
            gpx_path = self._ensure_gpx(src)
            pts, _ = cgpx.parse_gpx(gpx_path)
            text = ctrackio.to_csv_string(pts)
            default_name = os.path.splitext(os.path.basename(src))[0] + ".csv"
            dest = self.pick_save_path(default_name, str(Path.home()), ["CSV (*.csv)"])
            if not dest:
                return {"ok": False, "cancelled": True}
            if not dest.lower().endswith(".csv"):
                dest += ".csv"
            with open(dest, "w", encoding="utf-8", newline="") as f:
                f.write(text)
            log.info("export_current_csv: %s → %s", gpx_path, dest)
            return {"ok": True, "path": dest}
        except Exception as e:
            log.exception("export_current_csv fehlgeschlagen")
            return {"ok": False, "error": str(e)}

    def export_current(self, fmt: str = "gpx") -> dict:
        """v0.9.317 — generischer Export des aktuell geladenen Tracks in JEDES
        unterstützte Zielformat: GPX · KML · KMZ · TCX · GeoJSON · CSV. Nimmt den
        zuletzt geladenen Track (auch aus FIT/NMEA/KML/… → Cache-GPX) und nutzt
        core.trackio.export_payload — dieselbe Single-Source wie der Web-Konverter.
        KMZ ist binär (gezipptes KML), daher wird immer als bytes geschrieben."""
        try:
            fmt = (fmt or "gpx").lower()
            if fmt not in ctrackio.SUPPORTED_EXPORT:
                fmt = "gpx"
            s = _load_settings()
            src = str(s.get("last_gpx_path", "") or "")
            if not src or not os.path.exists(src):
                return {"ok": False, "error": "Kein Track geladen."}
            gpx_path = self._ensure_gpx(src)
            pts, st = cgpx.parse_gpx(gpx_path)
            name = (getattr(st, "name", None) or os.path.splitext(os.path.basename(src))[0])
            data, _mime = ctrackio.export_payload(pts, fmt, name)
            label = fmt.upper()
            default_name = os.path.splitext(os.path.basename(src))[0] + "." + fmt
            dest = self.pick_save_path(default_name, str(Path.home()),
                                       [f"{label} (*.{fmt})"])
            if not dest:
                return {"ok": False, "cancelled": True}
            if not dest.lower().endswith("." + fmt):
                dest += "." + fmt
            with open(dest, "wb") as f:
                f.write(data if isinstance(data, (bytes, bytearray)) else str(data).encode("utf-8"))
            log.info("export_current[%s]: %s → %s", fmt, gpx_path, dest)
            return {"ok": True, "path": dest, "fmt": fmt}
        except Exception as e:
            log.exception("export_current[%s] fehlgeschlagen", fmt)
            return {"ok": False, "error": str(e)}

    # ── Animator ──────────────────────────────────────────────────────────────

    def animator_load_gpx(self, path: str) -> dict:
        """Lädt eine GPX, gibt downsampled GeoJSON + Stats fürs UI zurück.
        Andere Track-Formate werden vorher automatisch nach GPX konvertiert."""
        try:
            path = self._ensure_gpx(path)
            pts, stats = cgpx.parse_gpx(path)
            ds = cgpx.downsample(pts, 800)
            coords = [[p.lon, p.lat] for p in ds]
            # Höhenarray für das Overlay-Preview-Höhenprofil — etwas weiter
            # downsampled (200 Punkte) damit das SVG-Update flüssig bleibt.
            ele_ds = cgpx.downsample(pts, 200)
            elevations = [p.ele if p.ele is not None else 0.0 for p in ele_ds]
            # v0.9.325 — WYSIWYG-Live-Stats: dieselben Per-Punkt-Reihen, die der
            # Render pro Frame nutzt (index-gleich zu `coords`/`ds`), damit die
            # Vorschau-Live-Box beim Scrubben/Probelauf mitläuft wie im Video.
            has_time = bool(stats.duration_s)
            has_ele = stats.ele_max is not None and stats.ele_min is not None
            cum_dist = [p.dist_m for p in ds]
            cum_time = [p.elapsed_s for p in ds]
            eles_full = [p.ele if p.ele is not None else 0.0 for p in ds]
            _spd, _grd, _, _ = canim._overlay_compute_speed_grade(
                ds, cum_dist, cum_time, eles_full, has_time, has_ele)
            # v0.9.331 — FIT-Sensoren (HF/Trittfrequenz/Leistung/Temp/…) als
            # Per-Punkt-Reihen (index-gleich zu `ds`/coords), damit die Live-Box
            # sie wie Tempo/Höhe mitlaufen lassen kann. Nur vorhandene Felder.
            sensor_series = {}
            for f in stats.sensor_fields:
                k = f["key"]
                sensor_series[k] = [p.extra.get(k) for p in ds]
            # v0.9.435 — GPX-<wpt>-Wegpunkte auf den Track projizieren (km-Position),
            # für den Mehrfarben-Editor ("Farben an Wegpunkten"). Nächster ds-Punkt
            # per euklidischer Distanz (grob, reicht für die km-Grenze).
            wp_out = []
            try:
                for w in (cgpx.parse_waypoints(path) or []):
                    wlon, wlat = float(w["lon"]), float(w["lat"])
                    best_i, best_d2 = 0, None
                    for i, p in enumerate(ds):
                        d2 = (p.lon - wlon) ** 2 + (p.lat - wlat) ** 2
                        if best_d2 is None or d2 < best_d2:
                            best_d2, best_i = d2, i
                    wp_out.append({"name": w.get("name") or "", "km": round(cum_dist[best_i] / 1000.0, 3)})
            except Exception:
                wp_out = []
            series = {
                "cumDistM": cum_dist,
                "cumTimeS": cum_time,
                "speedKmh": [round(x, 2) for x in _spd],
                "gradePct": [round(x, 2) for x in _grd],
                "ele": [round(e, 1) for e in eles_full],
                "sensors": sensor_series,
                "total_dist_m": stats.distance_m,
                "total_time_s": stats.duration_s,
                "has_time": has_time,
                "has_ele": has_ele,
                "waypoints": wp_out,
            }
            return {
                "ok": True,
                "name": stats.name or Path(path).stem,
                # v0.9.282: aufgelöster GPX-Pfad (bei FIT/NMEA/… der Cache-GPX),
                # damit Multi-Track-Render echte GPX nutzt statt das Fremdformat.
                "gpx_path": path,
                "coords": coords,
                "elevations": elevations,
                "bbox": stats.bbox,
                "stats": {
                    "n_points": stats.n_points,
                    "distance_km": stats.distance_m / 1000,
                    "duration_s": stats.duration_s,
                    "ascent_m": stats.ascent_m,
                    "descent_m": stats.descent_m,
                    "ele_max": stats.ele_max,
                    "ele_min": stats.ele_min,
                    # v0.9.324: echte Bewegungszeit + Spitzentempo (voll aufgelöst)
                    # damit die Live-Vorschau echte Werte zeigt statt Schätz-Heuristik.
                    "moving_time_s": stats.moving_time_s,
                    "max_speed_kmh": stats.max_speed_kmh,
                },
                "series": series,
                # v0.9.331 — vorhandene Sensorfelder [{key,label,unit}] fürs UI.
                "sensor_fields": stats.sensor_fields,
            }
        except Exception as e:
            return {"ok": False, "error": str(e), "trace": traceback.format_exc()}

    # ── v0.9.205: Anreise/Flug-Route ──────────────────────────────────────────
    def route_geocode(self, query: str, limit: int = 5) -> dict:
        """Adresse/Ort → Treffer-Liste [{name, lon, lat}] (Mapbox Geocoding)."""
        try:
            token = _active_mapbox_token()
            if not token:
                return {"ok": False, "error": "no_token"}
            hits = croute.geocode(query, token, limit=int(limit))
            return {"ok": True, "results": hits}
        except croute.RouteError as e:
            return {"ok": False, "error": str(e)}
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "error": str(e), "trace": traceback.format_exc()}

    def route_compute(self, params: dict) -> dict:
        """Berechnet eine Route aus Start/Ziel (+ optionale Zwischenstopps),
        schreibt sie als GPX und gibt den Pfad zurück. Das Frontend lädt diesen
        Pfad via loadGlobalGpx → fließt wie ein normales GPX durch Animator/
        Tour-Map/Höhe.

        params = {
          waypoints: [[lon,lat], …]   # mind. 2 (Start … Ziel)
          mode:      "road" | "arc"
          profile:   "driving" | "walking" | "cycling"   (nur road)
          grob:      bool                                 (nur road, default True)
          name:      str                                  (GPX-/Track-Name)
        }
        Returns {ok, gpx_path, coords, distance_m, duration_s, name} oder {ok:False,error}.
        """
        try:
            wps_in = params.get("waypoints") or []
            waypoints = []
            for w in wps_in:
                if isinstance(w, (list, tuple)) and len(w) >= 2:
                    waypoints.append((float(w[0]), float(w[1])))
            if len(waypoints) < 2:
                return {"ok": False, "error": "need_two_points"}
            mode = (params.get("mode") or "road").lower()
            name = (params.get("name") or "Route").strip() or "Route"
            if mode == "arc":
                res = croute.arc_route(waypoints)
            else:
                token = _active_mapbox_token()
                if not token:
                    return {"ok": False, "error": "no_token"}
                _coarse = params.get("coarseness")
                res = croute.road_route(
                    waypoints, token,
                    profile=(params.get("profile") or "driving"),
                    grob=bool(params.get("grob", True)),
                    coarseness=(float(_coarse) if _coarse is not None else None),
                )
            # GPX in den App-Support-Ordner schreiben (persistent, eindeutig).
            routes_dir = APP_SUPPORT / "routes"
            stem = "".join(c if (c.isalnum() or c in "-_") else "_" for c in name)[:40] or "route"
            # Eindeutiger Name ohne Date.now() — Inhalts-Hash der Koordinaten.
            digest = hashlib.sha1(
                json.dumps(res["coords"], separators=(",", ":")).encode("utf-8")
            ).hexdigest()[:10]
            out_path = routes_dir / f"{stem}_{mode}_{digest}.gpx"
            croute.write_gpx(
                res["coords"], str(out_path),
                name=name, duration_s=res.get("duration_s", 0.0),
            )
            return {
                "ok": True,
                "gpx_path": str(out_path),
                "coords": res["coords"],
                "distance_m": res.get("distance_m", 0.0),
                "duration_s": res.get("duration_s", 0.0),
                "name": name,
            }
        except croute.RouteError as e:
            return {"ok": False, "error": str(e)}
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "error": str(e), "trace": traceback.format_exc()}

    def animator_start_render(self, params: dict) -> dict:
        """Startet Render im Hintergrund-Thread. Status pollen via animator_status()."""
        if self._render_state["running"]:
            return {"ok": False, "error": "Render läuft bereits"}

        # v0.9.156 — Multi-Track: UI kann `tracks` (Liste von
        # {gpx_path, line_color, name}) senden. ≥2 Einträge → Multi-Track-
        # Render. 0/1 Einträge → klassischer Single-Track via `gpx_path`.
        raw_tracks = list(params.get("tracks") or [])
        tracks = []
        for t in raw_tracks:
            tp = (t or {}).get("gpx_path", "")
            if tp:
                tracks.append({
                    "gpx_path": tp,
                    "line_color": t.get("line_color") or params.get("line_color", "#ff6b35"),
                    "name": t.get("name") or Path(tp).stem,
                })
        # Single-Track-Pfad benutzt weiter `gpx_path`. Bei Multi-Track nehmen
        # wir die erste Tour als Basis für Output-Namen etc.
        gpx_path = params.get("gpx_path", "") or (tracks[0]["gpx_path"] if tracks else "")
        if not gpx_path or not Path(gpx_path).exists():
            return {"ok": False, "error": "GPX-Datei fehlt oder existiert nicht"}
        # Multi-Track erst ab 2 Touren — sonst Single-Track-Pfad (tracks leeren).
        if len(tracks) < 2:
            tracks = []
        else:
            missing = [t["gpx_path"] for t in tracks if not Path(t["gpx_path"]).exists()]
            if missing:
                return {"ok": False, "error": "Tour-GPX fehlt: " + ", ".join(Path(m).name for m in missing)}

        # Pre-Flight: Chromium-Browser für Playwright vorhanden?
        # Sonst krieg der User einen kryptischen „Executable doesn't exist"-
        # Fehler erst nach 2s in der Render-Pipeline.
        pw = self.playwright_check()
        if not pw.get("ok") or not pw.get("browser_present"):
            return {
                "ok": False,
                "error_code": "playwright_browser_missing",
                "error": pw.get("error") or "Playwright Chromium-Browser nicht installiert.",
                "browsers_path": pw.get("browsers_path"),
            }

        # v0.6.0 — "Ohne Karte (Alpha)" ist jetzt ein Karten-Stil-Wert
        # statt eines separaten Toggles. Frontend kann beides senden:
        #   - map_style="alpha"  → wir setzen transparent_background=True
        #   - transparent_background=True → backwards-compat mit altem UI
        map_style = params.get("map_style", "satellite")
        alpha = bool(params.get("transparent_background", False)) or (map_style == "alpha")
        # v0.9.245 — Encoding-/Frame-Qualität kommt zentral aus den globalen
        # Settings (Dialog „Qualität & Export"), nicht mehr aus der Sidebar.
        _rq = _load_settings().get("render", {}) or {}
        _g_codec = (_rq.get("codec") or "h264").lower()
        _g_crf = int(_rq.get("crf", 20) or 20)
        _g_frame_format = (_rq.get("frame_format") or "jpeg").lower()
        _g_jpeg_quality = int(_rq.get("jpeg_quality", 92) or 92)
        _g_encoder_preset = (_rq.get("encoder_preset") or "fast").lower()
        # Wenn Alpha aktiv, MÜSSEN wir ProRes 4444 nutzen (H.264/H.265 in MP4
        # kann keinen Alpha-Kanal); sonst der global gewählte Codec.
        codec = "prores" if alpha else _g_codec
        needs_mov = alpha or codec in ("prores", "prores4444")
        # v0.9.309 — Standbild (Tour-Map) → PNG, kein Video-Container.
        # v0.9.412 — Snapshot (aktueller Animator-Vorschau-Frame) → ebenfalls EIN PNG.
        _snapshot = bool(params.get("snapshot", False))
        _still = bool(params.get("still_frame", False)) or _snapshot
        # v0.9.391 — OSM-Fallback: NUR die Tour-Map (Standbild) darf ohne
        # Mapbox-Token rendern (OSM-Raster-Karte). Ein Video braucht weiter einen
        # Token (das Frontend blockt den Video-Render im OSM-Modus). OSM-Karte ist
        # flach → Terrain aus, Pitch 0.
        _osm_render = _still and not _active_mapbox_token()
        target_ext = ".png" if _still else (".mov" if needs_mov else ".mp4")
        _valid_exts = (".png",) if _still else (".mp4", ".mov")

        # Output-Dateiname
        out_name = params.get("output_name") or (Path(gpx_path).stem + target_ext)
        # Falls Endung falsch → swap auf Ziel-Endung
        out_stem, out_ext = os.path.splitext(out_name)
        if out_ext.lower() not in _valid_exts or out_ext.lower() != target_ext:
            out_name = out_stem + target_ext
        # Pfad: User-Auswahl (Save-Dialog) oder Default in _renders/
        out_path = params.get("output_path") or str(RENDERS_DIR / out_name)
        # Endung auf Ziel-Format erzwingen
        out_path_stem, out_path_ext = os.path.splitext(out_path)
        if out_path_ext.lower() != target_ext:
            out_path = out_path_stem + target_ext

        # Bei alpha-Stil: map_style auf default zurück (Lookup würde sonst
        # auf "alpha" fehlschlagen). transparent_background trägt die Info.
        effective_map_style = "satellite" if map_style == "alpha" else map_style
        # v0.8.12 — UI hat „tube" als 2D-Linien-Stil (im selben Dropdown wie
        # solid/dashed/...). Backend hat aber weiter line_style + track_style
        # getrennt — wir übersetzen am Bridge-Boundary: tube → solid + tube-
        # Highlight-Layer.
        _ui_line_style = params.get("line_style", "solid")
        if _ui_line_style == "tube":
            _be_line_style = "solid"
            _be_track_style = "tube"
        else:
            _be_line_style = _ui_line_style
            _be_track_style = params.get("track_style", "flat")
        cfg = canim.AnimatorConfig(
            gpx_path=gpx_path,
            output_path=out_path,
            mapbox_token=_active_mapbox_token(),
            map_style=effective_map_style,
            # v0.9.391 — OSM-Fallback für die Tour-Map (kein Token → OSM-Raster).
            use_osm=_osm_render,
            # v0.9.308 — Standbild-Modus (Tour-Map = ein Frame vom Animator).
            # Wenn das UI still_frame=True schickt, rendert der Worker EIN PNG
            # via canim.render_frame statt eines Videos.
            still_frame=bool(params.get("still_frame", False)),
            bearing=float(params.get("bearing", -10)),
            padding_pct=float(params.get("padding_pct", 8)),
            show_pins=bool(params.get("show_pins", False)),
            duration_s=int(params.get("duration_s", 12)),
            hold_s=int(params.get("hold_s", 5)),
            intro_s=int(params.get("intro_s", 0)),  # v0.9.59
            fps=int(params.get("fps", 30)),
            width=int(params.get("width", 1920)),
            height=int(params.get("height", 1080)),
            # v0.9.391 — OSM-Raster ist flach: Pitch 0 + Terrain aus erzwingen.
            pitch=0.0 if _osm_render else float(params.get("pitch", 40)),
            rotation=float(params.get("rotation", 20)),
            spin_dps=float(params.get("spin_dps", 0) or 0),
            cinematic_flyto=bool(params.get("cinematic_flyto", True)),
            exaggeration=float(params.get("exaggeration", 1.5)),
            enable_terrain=(not _osm_render) and bool(params.get("enable_terrain", True)),
            line_color=params.get("line_color", "#ff6b35"),
            line_width=float(params.get("line_width", 3.5)),
            line_style=_be_line_style,
            line_style_spacing=float(params.get("line_style_spacing", 1.0)),
            track_style=_be_track_style,
            camera_follow_track=bool(params.get("camera_follow_track", False)),
            camera_follow_inertia=float(params.get("camera_follow_inertia", 0.0)),
            smooth_camera_3d=bool(params.get("smooth_camera_3d", False)),  # v0.9.318 — entkoppelte FreeCamera
            timeline_events=list(params.get("timeline_events", []) or []),
            show_overlays=bool(params.get("show_overlays", True)),
            overlay_totals_enabled=bool(params.get("overlay_totals_enabled", True)),
            overlay_totals_position=params.get("overlay_totals_position", "tl"),
            overlay_live_enabled=bool(params.get("overlay_live_enabled", True)),
            overlay_live_position=params.get("overlay_live_position", "tr"),
            overlay_elevation_enabled=bool(params.get("overlay_elevation_enabled", True)),
            overlay_elevation_position=params.get("overlay_elevation_position", "bc"),
            # v0.9.321 — Stats-Editor: wählbare/sortierbare Felder + globales Styling
            overlay_live_fields=(list(params.get("overlay_live_fields") or []) or None),
            overlay_totals_fields=(list(params.get("overlay_totals_fields") or []) or None),
            overlay_field_overrides=(params.get("overlay_field_overrides") or {}),
            overlay_font=params.get("overlay_font", "system"),
            overlay_text_color=params.get("overlay_text_color", "#ffffff"),
            overlay_bg_color=params.get("overlay_bg_color", "#000000"),
            overlay_bg_opacity=float(params.get("overlay_bg_opacity", 0.55) or 0.55),
            # v0.9.228 — Overlay-Zeitfenster (Nutzer „ab Sek X bis Sek Y")
            overlay_totals_from_s=float(params.get("overlay_totals_from_s", 0) or 0),
            overlay_totals_to_s=float(params.get("overlay_totals_to_s", 0) or 0),
            overlay_live_from_s=float(params.get("overlay_live_from_s", 0) or 0),
            overlay_live_to_s=float(params.get("overlay_live_to_s", 0) or 0),
            overlay_elevation_from_s=float(params.get("overlay_elevation_from_s", 0) or 0),
            overlay_elevation_to_s=float(params.get("overlay_elevation_to_s", 0) or 0),
            codec=codec,
            crf=_g_crf,
            frame_format=_g_frame_format,
            jpeg_quality=_g_jpeg_quality,
            encoder_preset=_g_encoder_preset,
            override_center=tuple(params["override_center"]) if params.get("override_center") else None,
            override_zoom=float(params["override_zoom"]) if params.get("override_zoom") is not None else None,
            zoom_correction=float(params.get("zoom_correction", 0.0) or 0.0),  # v0.9.157 WYSIWYG-Zoom
            point_count=int(params.get("point_count", 0)),
            transparent_background=alpha,
            shadow_enabled=bool(params.get("shadow_enabled", True)),
            shadow_strength=float(params.get("shadow_strength", 4.0)),
            glow_enabled=bool(params.get("glow_enabled", True)),
            glow_strength=float(params.get("glow_strength", 4.0)),
            map_smoothing=float(params.get("map_smoothing", 1.3)),
            ghost_track_enabled=bool(params.get("ghost_track_enabled", False)),
            ghost_track_opacity=float(params.get("ghost_track_opacity", 0.30)),
            ghost_track_color=str(params.get("ghost_track_color", "#ff6b35")),
            # v0.9.435 — Mehrfarbiger Track (Farbwechsel ab km/Marker/Wegpunkt)
            track_colors_enabled=bool(params.get("track_colors_enabled", False)),
            track_colors_mode=str(params.get("track_colors_mode", "hard")),
            track_color_stops=list(params.get("track_color_stops") or []),
            ghost_gpx_coords=(params.get("ghost_gpx_coords") or []),
            ghost_gpx_color=str(params.get("ghost_gpx_color", "#7fa8ff")),
            ghost_gpx_opacity=float(params.get("ghost_gpx_opacity", 0.60)),
            ghost_gpx_width=float(params.get("ghost_gpx_width", 2.5)),
            ghost_gpx_dashed=bool(params.get("ghost_gpx_dashed", True)),
            hide_labels=bool(params.get("hide_labels", False)),
            # v0.5.0 — Karten-Feinabstimmung
            light_preset=params.get("light_preset", "day"),
            show_place_labels=bool(params.get("show_place_labels", True)),
            show_road_labels=bool(params.get("show_road_labels", True)),
            show_poi_labels=bool(params.get("show_poi_labels", True)),
            show_transit_labels=bool(params.get("show_transit_labels", True)),
            show_admin_boundaries=bool(params.get("show_admin_boundaries", True)),
            # v0.9.41 — Partial-Track-Render (Trim-Bereich)
            render_start_anchor=float(params.get("render_start_anchor", 0.0)),
            render_end_anchor=float(params.get("render_end_anchor", 1.0)),
            stats_use_trim=bool(params.get("stats_use_trim", True)),
            show_pretrim_track=bool(params.get("show_pretrim_track", True)),
            # v0.9.103 — Welt-Verschiebung (Mapbox padding) für Globe-Ansicht
            world_shift_x_pct=float(params.get("world_shift_x_pct", 0.0)),
            world_shift_y_pct=float(params.get("world_shift_y_pct", 0.0)),
            # v0.9.74 — Foto-Pins (Phase 1). UI sendet die volle Liste inkl.
            # Thumb-data-URLs damit Backend dieselben Bytes wie der Preview
            # rendert (WYSIWYG).
            photos=list(params.get("photos") or []),
            photos_size_px=int(params.get("photos_size_px", 48) or 48),
            photos_show=bool(params.get("photos_show", True)),
            signs=list(params.get("signs") or []),
            signs_show=bool(params.get("signs_show", True)),
            signs_size_px=int(params.get("signs_size_px", 40) or 40),
            signs_style=str(params.get("signs_style", "callout") or "callout"),
            signs_color=str(params.get("signs_color", "#ff6b35") or "#ff6b35"),
            render_scale=float(params.get("render_scale", 1.0) or 1.0),  # v0.9.224 WYSIWYG Schild/Pin-Größe
            # v0.9.156 — Multi-Track
            tracks=tracks,
            fly_duration_s=float(params.get("fly_duration_s", 3.0) or 3.0),
        )

        # v0.9.412 — Snapshot: exakte Vorschau-Kamera + Marker-Anker → render_frame
        # rendert genau den aktuellen Animator-Frame (Teil-Track + laufender Punkt
        # + Overlays) als PNG. `snapshot_center` gesetzt = Kamera-Override aktiv.
        if _snapshot:
            _sc = params.get("snapshot_center")
            if isinstance(_sc, (list, tuple)) and len(_sc) == 2:
                cfg.snapshot_center = [float(_sc[0]), float(_sc[1])]
            if params.get("snapshot_zoom") is not None:
                cfg.snapshot_zoom = float(params.get("snapshot_zoom"))
            if params.get("snapshot_bearing") is not None:
                cfg.snapshot_bearing = float(params.get("snapshot_bearing"))
            if params.get("snapshot_pitch") is not None:
                cfg.snapshot_pitch = float(params.get("snapshot_pitch"))
            if params.get("snapshot_anchor") is not None:
                cfg.snapshot_anchor = max(0.0, min(1.0, float(params.get("snapshot_anchor"))))
            cfg.snapshot_time_s = float(params.get("snapshot_time_s", 0.0) or 0.0)
            # v0.9.417 — „ganze Route zeigen" (Vorschau-Toggle) → Snapshot voller Track.
            cfg.snapshot_full_track = bool(params.get("snapshot_full_track", False))

        self._render_state = {"running": True, "progress": 0.0, "status": "Starte …",
                              "output": out_path, "error": "", "log_path": str(LOG_PATH),
                              "preview_b64": "", "cancel_requested": False,
                              "cancelled": False}

        # Render-Start ins Log — full config + traceable.
        rlog = clog.get_logger("animator.render")
        rlog.info("─" * 60)
        rlog.info("Render gestartet")
        if cfg.tracks:
            rlog.info("  Multi-Track: %d Touren (%s), Flug %.1fs",
                      len(cfg.tracks), ", ".join(t["name"] for t in cfg.tracks), cfg.fly_duration_s)
        rlog.info("  GPX:        %s", gpx_path)
        rlog.info("  Output:     %s", out_path)
        if cfg.transparent_background:
            rlog.info("  Modus:      Alpha-Kanal (.mov, ProRes 4444 für NLE-Composit)")
        else:
            rlog.info("  Style:      %s   Codec: %s   CRF: %s", cfg.map_style, cfg.codec, cfg.crf)
        rlog.info("  Auflösung:  %dx%d @ %d fps   Track-Punkte: %s",
                  cfg.width, cfg.height, cfg.fps, cfg.point_count or "alle")
        rlog.info("  Dauer:      %ds intro + %ds anim + %ds hold", cfg.intro_s, cfg.duration_s, cfg.hold_s)
        rlog.info("  Kamera:     pitch=%.1f° rotation=%.1f° exag=%.2f terrain=%s",
                  cfg.pitch, cfg.rotation, cfg.exaggeration, cfg.enable_terrain)
        rlog.info("  Token:      %s",
                  ("user (pk.…" + cfg.mapbox_token[-6:] + ")") if (cfg.mapbox_token and len(cfg.mapbox_token) > 8) else "MISSING/EMPTY")

        def on_progress(p: float, msg: str) -> None:
            # Status für UI-Polling
            self._render_state["progress"] = p
            self._render_state["status"] = msg
            # Ins Log nur wenn neuer Schritt — nicht jeden Frame, sonst zumüllen wir das Log.
            # Heuristik: log wenn p sich um ≥1% geändert hat oder status-Text sich ändert.
            last_p = getattr(on_progress, "_last_logged_p", -1.0)
            last_msg = getattr(on_progress, "_last_logged_msg", "")
            if msg != last_msg or abs(p - last_p) >= 0.10:
                rlog.info("  [%5.1f%%] %s", p * 100, msg)
                on_progress._last_logged_p = p   # type: ignore[attr-defined]
                on_progress._last_logged_msg = msg  # type: ignore[attr-defined]

        def on_preview(b64: str) -> None:
            # Letzten Frame als JPEG-base64 fürs UI-Polling
            self._render_state["preview_b64"] = b64

        def is_cancelled() -> bool:
            return bool(self._render_state.get("cancel_requested", False))

        def worker() -> None:
            t0 = time.time()
            try:
                # Render in eigenem asyncio-Loop
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                try:
                    if getattr(cfg, "still_frame", False) or getattr(cfg, "snapshot_center", None) is not None:
                        # Standbild (Tour-Map) ODER Snapshot (Animator-Frame) — ein PNG, kein Video/ffmpeg.
                        loop.run_until_complete(canim.render_frame(
                            cfg, on_progress=on_progress, is_cancelled=is_cancelled,
                        ))
                    else:
                        loop.run_until_complete(canim.render(
                            cfg,
                            on_progress=on_progress,
                            on_preview=on_preview,
                            is_cancelled=is_cancelled,
                        ))
                finally:
                    loop.close()
                self._render_state["running"] = False
                self._render_state["progress"] = 1.0
                self._render_state["status"] = "Fertig."
                rlog.info("Render OK in %.1fs → %s", time.time() - t0, out_path)
            except canim.RenderCancelled:
                # Sauberer User-Abbruch — KEIN Fehler.
                self._render_state["running"] = False
                self._render_state["cancelled"] = True
                self._render_state["status"] = "Abgebrochen"
                self._render_state["error"] = ""
                rlog.info("Render abgebrochen vom User nach %.1fs", time.time() - t0)
            except Exception as e:
                tb = traceback.format_exc()
                self._render_state["error"] = str(e) + "\n" + tb
                self._render_state["status"] = "Fehler"
                self._render_state["running"] = False
                rlog.error("Render fehlgeschlagen nach %.1fs: %s", time.time() - t0, e)
                rlog.error("Traceback:\n%s", tb)

        self._render_thread = threading.Thread(target=worker, daemon=True)
        self._render_thread.start()
        return {"ok": True}

    def animator_status(self) -> dict:
        return dict(self._render_state)

    def animator_cancel(self) -> dict:
        """Bittet den laufenden Render um Abbruch. Der Worker prüft das Flag
        vor jedem Frame und wirft `RenderCancelled` → ffmpeg wird beendet
        und die halb-fertige Datei aufgeräumt."""
        if not self._render_state.get("running"):
            return {"ok": False, "error": "Kein Render läuft"}
        self._render_state["cancel_requested"] = True
        log.info("animator_cancel angefordert")
        return {"ok": True}

    # ── Tour-Karten-Generator (statische PNG) ────────────────────────────────

    def tourmap_load_gpx(self, path: str) -> dict:
        """GPX laden für den Tourmap-Modul-Preview. Gibt downsampled Coords +
        Stats zurück (gleiche Shape wie animator_load_gpx)."""
        return self.animator_load_gpx(path)

    def tourmap_render(self, params: dict) -> dict:
        """Rendert eine statische Tour-Karte als PNG. Async im Thread, gleiches
        Polling-Pattern wie der Animator."""
        if self._tourmap_state.get("running"):
            return {"ok": False, "error": "Tour-Karten-Render läuft bereits"}

        gpx_path = params.get("gpx_path", "")
        if not gpx_path or not Path(gpx_path).exists():
            return {"ok": False, "error": "GPX-Datei fehlt oder existiert nicht"}

        # Mapbox-Token-Check (Static-Map braucht zwingend Mapbox)
        token = _active_mapbox_token()
        if not token or not token.startswith("pk."):
            return {
                "ok": False,
                "error_code": "mapbox_token_missing",
                "error": "Tour-Karten brauchen einen Mapbox-Token (Settings → Mapbox-Token).",
            }

        # Pre-Flight: Chromium für Playwright vorhanden?
        pw = self.playwright_check()
        if not pw.get("ok") or not pw.get("browser_present"):
            return {
                "ok": False,
                "error_code": "playwright_browser_missing",
                "error": pw.get("error") or "Playwright Chromium-Browser nicht installiert.",
                "browsers_path": pw.get("browsers_path"),
            }

        # Output: bevorzugt der vom UI per Save-Dialog gewählte Pfad,
        # ansonsten Default in ~/Pictures/Reisezoom Tour Maps/
        out_name = params.get("output_name") or (
            Path(gpx_path).stem + "_" + datetime.now().strftime("%Y%m%d-%H%M%S") + ".png"
        )
        if not out_name.lower().endswith(".png"):
            out_name += ".png"
        out_path = params.get("output_path") or str(TOURMAPS_DIR / out_name)
        # Endung immer erzwingen — User könnte im Save-Dialog ".png" entfernt haben
        if not out_path.lower().endswith(".png"):
            out_path += ".png"

        # v0.8.12 — Bridge-Translation tube (synchron Animator).
        _ui_line_style = params.get("line_style", "solid")
        if _ui_line_style == "tube":
            _be_line_style = "solid"
            _be_track_style = "tube"
        else:
            _be_line_style = _ui_line_style
            _be_track_style = params.get("track_style", "flat")
        # v0.9.307 — Tour-Map = ein statischer Frame vom Animator. Statt der
        # eigenen TourmapConfig/render_png bauen wir eine AnimatorConfig mit
        # still_frame=True und rendern über canim.render_frame() → EINE
        # Render-Pipeline, kein Doppel-Code mehr. Felder 1:1 wie früher.
        cfg = canim.AnimatorConfig(
            gpx_path=gpx_path,
            output_path=out_path,
            mapbox_token=token,
            still_frame=True,
            map_style=params.get("map_style", "satellite"),
            width=int(params.get("width", 1920)),
            height=int(params.get("height", 1080)),
            pitch=float(params.get("pitch", 35)),
            bearing=float(params.get("bearing", -10)),
            padding_pct=float(params.get("padding_pct", 8)),
            exaggeration=float(params.get("exaggeration", 1.5)),
            enable_terrain=bool(params.get("enable_terrain", True)),
            hide_labels=bool(params.get("hide_labels", False)),
            light_preset=params.get("light_preset", "day"),
            show_place_labels=bool(params.get("show_place_labels", True)),
            show_road_labels=bool(params.get("show_road_labels", True)),
            show_poi_labels=bool(params.get("show_poi_labels", True)),
            show_transit_labels=bool(params.get("show_transit_labels", True)),
            show_admin_boundaries=bool(params.get("show_admin_boundaries", True)),
            line_color=params.get("line_color", "#ff6b35"),
            line_width=float(params.get("line_width", 4.5)),
            line_style=_be_line_style,
            line_style_spacing=float(params.get("line_style_spacing", 1.0)),
            track_style=_be_track_style,
            glow_enabled=bool(params.get("glow_enabled", True)),
            glow_strength=float(params.get("glow_strength", 4.0)),
            map_smoothing=float(params.get("map_smoothing", 1.3)),
            ghost_track_enabled=bool(params.get("ghost_track_enabled", False)),
            ghost_track_opacity=float(params.get("ghost_track_opacity", 0.30)),
            ghost_track_color=str(params.get("ghost_track_color", "#ff6b35")),
            # v0.9.435 — Mehrfarbiger Track (Farbwechsel ab km/Marker/Wegpunkt)
            track_colors_enabled=bool(params.get("track_colors_enabled", False)),
            track_colors_mode=str(params.get("track_colors_mode", "hard")),
            track_color_stops=list(params.get("track_color_stops") or []),
            ghost_gpx_coords=(params.get("ghost_gpx_coords") or []),
            ghost_gpx_color=str(params.get("ghost_gpx_color", "#7fa8ff")),
            ghost_gpx_opacity=float(params.get("ghost_gpx_opacity", 0.60)),
            ghost_gpx_width=float(params.get("ghost_gpx_width", 2.5)),
            ghost_gpx_dashed=bool(params.get("ghost_gpx_dashed", True)),
            show_overlays=bool(params.get("show_overlays", True)),
            overlay_totals_enabled=bool(params.get("overlay_totals_enabled", True)),
            overlay_totals_position=params.get("overlay_totals_position", "tl"),
            # Tour-Map (Standbild) hat keine Live-Box (zeit-animiert).
            overlay_live_enabled=False,
            overlay_elevation_enabled=bool(params.get("overlay_elevation_enabled", False)),
            overlay_elevation_position=params.get("overlay_elevation_position", "bc"),
            # v0.9.321 — Stats-Editor: Totals-Felder + globales Styling (gespiegelt)
            overlay_totals_fields=(list(params.get("overlay_totals_fields") or []) or None),
            overlay_field_overrides=(params.get("overlay_field_overrides") or {}),
            overlay_font=params.get("overlay_font", "system"),
            overlay_text_color=params.get("overlay_text_color", "#ffffff"),
            overlay_bg_color=params.get("overlay_bg_color", "#000000"),
            overlay_bg_opacity=float(params.get("overlay_bg_opacity", 0.55) or 0.55),
            show_pins=bool(params.get("show_pins", True)),
            # v0.9.74 — Foto-Pins (nummerierte Kreise im Standbild-Render)
            photos=list(params.get("photos") or []),
            photos_size_px=int(params.get("photos_size_px", 48) or 48),
            photos_show=bool(params.get("photos_show", True)),
            signs=list(params.get("signs") or []),
            signs_show=bool(params.get("signs_show", True)),
            signs_size_px=int(params.get("signs_size_px", 40) or 40),
            signs_style=str(params.get("signs_style", "callout") or "callout"),
            signs_color=str(params.get("signs_color", "#ff6b35") or "#ff6b35"),
            render_scale=float(params.get("render_scale", 1.0) or 1.0),
            override_center=tuple(params["override_center"]) if params.get("override_center") else None,
            override_zoom=float(params["override_zoom"]) if params.get("override_zoom") is not None else None,
        )

        self._tourmap_state = {"running": True, "progress": 0.0, "status": "Starte …",
                               "output": out_path, "error": "", "log_path": str(LOG_PATH),
                               "cancel_requested": False, "cancelled": False}

        tlog = clog.get_logger("tourmap.render")
        tlog.info("─" * 60)
        tlog.info("Tour-Karte-Render gestartet")
        tlog.info("  GPX:        %s", gpx_path)
        tlog.info("  Output:     %s", out_path)
        tlog.info("  Style:      %s   Auflösung: %dx%d", cfg.map_style, cfg.width, cfg.height)
        tlog.info("  Kamera:     pitch=%.1f° bearing=%.1f° padding=%.1f%%",
                  cfg.pitch, cfg.bearing, cfg.padding_pct)

        def on_progress(p: float, msg: str) -> None:
            self._tourmap_state["progress"] = p
            self._tourmap_state["status"] = msg
            tlog.info("  [%5.1f%%] %s", p * 100, msg)

        def is_cancelled() -> bool:
            return bool(self._tourmap_state.get("cancel_requested", False))

        def worker() -> None:
            t0 = time.time()
            try:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                try:
                    loop.run_until_complete(canim.render_frame(
                        cfg, on_progress=on_progress, is_cancelled=is_cancelled,
                    ))
                finally:
                    loop.close()
                self._tourmap_state["running"] = False
                self._tourmap_state["progress"] = 1.0
                self._tourmap_state["status"] = "Fertig."
                tlog.info("Tour-Karte OK in %.1fs → %s", time.time() - t0, out_path)
            except Exception as e:
                tb = traceback.format_exc()
                # Cancel landet als RuntimeError("Vom User abgebrochen") — als Cancel behandeln
                if "Vom User abgebrochen" in str(e):
                    self._tourmap_state["running"] = False
                    self._tourmap_state["cancelled"] = True
                    self._tourmap_state["status"] = "Abgebrochen"
                    self._tourmap_state["error"] = ""
                    tlog.info("Tour-Karte abgebrochen vom User nach %.1fs", time.time() - t0)
                else:
                    self._tourmap_state["error"] = str(e) + "\n" + tb
                    self._tourmap_state["status"] = "Fehler"
                    self._tourmap_state["running"] = False
                    tlog.error("Tour-Karte fehlgeschlagen nach %.1fs: %s", time.time() - t0, e)
                    tlog.error("Traceback:\n%s", tb)

        self._tourmap_thread = threading.Thread(target=worker, daemon=True)
        self._tourmap_thread.start()
        return {"ok": True}

    def tourmap_status(self) -> dict:
        return dict(self._tourmap_state)

    def tourmap_cancel(self) -> dict:
        if not self._tourmap_state.get("running"):
            return {"ok": False, "error": "Kein Render läuft"}
        self._tourmap_state["cancel_requested"] = True
        log.info("tourmap_cancel angefordert")
        return {"ok": True}

    # ── Höhen-Animator (v0.9.92, Phase 1 — UI-Skelett) ───────────────────────
    # Vorerst nur GPX-Load + Render-Stub. Render wirft NotImplementedError;
    # UI zeigt das als „in Arbeit"-Hinweis. Vollständige Implementation
    # kommt in v0.9.93+ (Phase 2: SVG-Frame-Render + ffmpeg).

    def heightanim_load_gpx(self, path: str) -> dict:
        """GPX-Load fürs Höhen-Modul. Liefert Höhen-Array + Distanz-Array
        (jeweils downsampled für UI-Performance) + Stats für die Live-
        Vorschau-Kurve."""
        try:
            path = self._ensure_gpx(path)   # v0.9.282: FIT/NMEA/KML/… → GPX
            pts, stats = cgpx.parse_gpx(path)
            # Downsample auf 800 Punkte (UI-Performance, sub-pixel-genau für
            # Standard-Viewport-Breiten).
            ds = cgpx.downsample(pts, 800)
            distances_m = [p.dist_m for p in ds]
            elevations  = [(p.ele if p.ele is not None else 0.0) for p in ds]
            # Track-Koordinaten (parallel zu distances_m) — damit das Frontend
            # Foto-Positionen ohne Karte auf die Strecke projizieren kann.
            latlon = [[round(p.lat, 6), round(p.lon, 6)] for p in ds]
            # v0.9.394 — Wegpunkt-Quellen fürs Höhenprofil:
            #   • Auto-Marker (höchster/tiefster/steilster Punkt)
            #   • GPX-<wpt>-POIs, auf die Strecke projiziert (dist_m + ele)
            # Fotos + manuelle Punkte baut das Frontend aus dem Projekt-State.
            try:
                auto_markers = cheight.detect_auto_markers(ds)
            except Exception as e:
                log.warning("auto_markers fehlgeschlagen: %s", e); auto_markers = []
            try:
                raw_wpts = cgpx.parse_waypoints(path)
                gpx_waypoints = cheight.project_points_onto_track(raw_wpts, pts)
            except Exception as e:
                log.warning("gpx_waypoints fehlgeschlagen: %s", e); gpx_waypoints = []
            return {
                "ok": True,
                "elevations": elevations,
                "distances_m": distances_m,
                "latlon": latlon,
                "auto_markers": auto_markers,
                "gpx_waypoints": gpx_waypoints,
                "stats": {
                    "n_points": len(pts),
                    "distance_m": stats.distance_m,
                    "ele_min": stats.ele_min,
                    "ele_max": stats.ele_max,
                    "ascent_m": stats.ascent_m,
                    "descent_m": stats.descent_m,
                    "bbox": stats.bbox,
                },
            }
        except Exception as e:
            log.exception("heightanim_load_gpx fehlgeschlagen: %s", e)
            return {"ok": False, "error": str(e)}

    def heightanim_start_render(self, params: dict) -> dict:
        """Startet Höhen-Animator-Render im Background-Thread.
        Status pollen via heightanim_status(); Abbruch via heightanim_cancel()."""
        if self._height_render_state.get("running"):
            return {"ok": False, "error": "Render läuft bereits"}

        gpx_path = params.get("gpx_path", "")
        if not gpx_path or not Path(gpx_path).exists():
            return {"ok": False, "error": "GPX-Datei fehlt oder existiert nicht"}

        # Pre-Flight: Playwright-Browser vorhanden?
        pw = self.playwright_check()
        if not pw.get("ok") or not pw.get("browser_present"):
            return {
                "ok": False,
                "error_code": "playwright_browser_missing",
                "error": pw.get("error") or "Playwright Chromium-Browser nicht installiert.",
                "browsers_path": pw.get("browsers_path"),
            }

        # Codec/Alpha-Logik analog Animator
        alpha = bool(params.get("transparent_background", False))
        codec = (params.get("codec") or "h264").lower()
        if alpha:
            codec = "prores"   # alpha braucht ProRes 4444
        needs_mov = alpha or codec in ("prores", "prores4444")
        target_ext = ".mov" if needs_mov else ".mp4"

        # Output-Dateiname: <gpx-stem>_height.<ext>
        out_name = params.get("output_name") or (Path(gpx_path).stem + "_height" + target_ext)
        out_stem, out_ext = os.path.splitext(out_name)
        if out_ext.lower() != target_ext:
            out_name = out_stem + target_ext
        out_path = params.get("output_path") or str(RENDERS_DIR / out_name)
        out_stem2, out_ext2 = os.path.splitext(out_path)
        if out_ext2.lower() != target_ext:
            out_path = out_stem2 + target_ext

        cfg = cheight.HeightConfig(
            gpx_path=gpx_path,
            output_path=out_path,
            codec=codec,
            crf=int(params.get("crf", 20)),
            transparent_background=alpha,
            **_height_visual_cfg_kwargs(params),   # v0.9.397 — geteilt mit HTML-Export
        )

        self._height_render_state = {
            "running": True, "progress": 0.0, "status": "Starte …",
            "output": out_path, "error": "", "log_path": str(LOG_PATH),
            "preview_b64": "", "cancel_requested": False, "cancelled": False,
        }

        rlog = clog.get_logger("heightanim.render")
        rlog.info("─" * 60)
        rlog.info("Höhen-Animator-Render gestartet")
        rlog.info("  GPX:        %s", gpx_path)
        rlog.info("  Output:     %s", out_path)
        rlog.info("  Modus:      %s", "Alpha (.mov, ProRes 4444)" if alpha else f"{codec.upper()} {target_ext}")
        rlog.info("  Auflösung:  %dx%d @ %d fps   Trim: %.2f..%.2f",
                  cfg.width, cfg.height, cfg.fps, cfg.trim_start, cfg.trim_end)
        rlog.info("  Dauer:      %ds anim + %ds hold", cfg.duration_s, cfg.hold_s)

        def on_progress(p: float, msg: str) -> None:
            self._height_render_state["progress"] = p
            self._height_render_state["status"] = msg
            last_p = getattr(on_progress, "_last_logged_p", -1.0)
            last_msg = getattr(on_progress, "_last_logged_msg", "")
            if msg != last_msg or abs(p - last_p) >= 0.10:
                rlog.info("  [%5.1f%%] %s", p * 100, msg)
                on_progress._last_logged_p = p   # type: ignore[attr-defined]
                on_progress._last_logged_msg = msg  # type: ignore[attr-defined]

        def on_preview(b64: str) -> None:
            self._height_render_state["preview_b64"] = b64

        def is_cancelled() -> bool:
            return bool(self._height_render_state.get("cancel_requested", False))

        def worker() -> None:
            t0 = time.time()
            try:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                try:
                    loop.run_until_complete(cheight.render(
                        cfg,
                        on_progress=on_progress,
                        on_preview=on_preview,
                        is_cancelled=is_cancelled,
                    ))
                finally:
                    loop.close()
                self._height_render_state["running"] = False
                self._height_render_state["progress"] = 1.0
                self._height_render_state["status"] = "Fertig."
                rlog.info("Render OK in %.1fs → %s", time.time() - t0, out_path)
            except cheight.RenderCancelled:
                self._height_render_state["running"] = False
                self._height_render_state["cancelled"] = True
                self._height_render_state["status"] = "Abgebrochen"
                self._height_render_state["error"] = ""
                rlog.info("Render abgebrochen vom User nach %.1fs", time.time() - t0)
            except Exception as e:
                tb = traceback.format_exc()
                self._height_render_state["error"] = str(e) + "\n" + tb
                self._height_render_state["status"] = "Fehler"
                self._height_render_state["running"] = False
                rlog.error("Render fehlgeschlagen nach %.1fs: %s", time.time() - t0, e)
                rlog.error("Traceback:\n%s", tb)

        self._height_render_thread = threading.Thread(target=worker, daemon=True)
        self._height_render_thread.start()
        return {"ok": True}

    def heightanim_status(self) -> dict:
        return dict(self._height_render_state)

    def heightanim_cancel(self) -> dict:
        if not self._height_render_state.get("running"):
            return {"ok": False, "error": "Kein Render läuft"}
        self._height_render_state["cancel_requested"] = True
        log.info("heightanim_cancel angefordert")
        return {"ok": True}

    def heightanim_export_html(self, params: dict) -> dict:
        """v0.9.397 — Höhenprofil als selbst-laufende HTML fürs Web/Blog exportieren.
        Kein Playwright, kein Video — reines HTML5 + Vanilla-JS. Liefert eine
        .html-Datei UND ein <iframe srcdoc>-Snippet zum direkten Einfügen in
        einen WordPress-„Custom HTML"-Block (ohne Upload)."""
        try:
            gpx_path = params.get("gpx_path", "")
            if not gpx_path or not Path(gpx_path).exists():
                return {"ok": False, "error": "GPX-Datei fehlt oder existiert nicht"}
            gpx_path = self._ensure_gpx(gpx_path)
            pts, _stats = cgpx.parse_gpx(gpx_path)
            if len(pts) < 2:
                return {"ok": False, "error": "GPX hat zu wenig Punkte (< 2)"}
            ds = cgpx.downsample(pts, 1000)
            distances_m = [p.dist_m for p in ds]
            elevations = [(p.ele if p.ele is not None else 0.0) for p in ds]

            out_name = params.get("output_name") or (Path(gpx_path).stem + "_hoehenprofil.html")
            if not out_name.lower().endswith(".html"):
                out_name += ".html"
            out_path = params.get("output_path") or str(RENDERS_DIR / out_name)

            cfg = cheight.HeightConfig(
                gpx_path=gpx_path, output_path=out_path,
                **_height_visual_cfg_kwargs(params),
            )
            replay = params.get("replay_label") or "↻ Neu starten"
            html_doc = cheight.make_standalone_html(
                cfg, distances_m, elevations, replay_label=replay, loop=True)
            Path(out_path).write_text(html_doc, encoding="utf-8")
            snippet = cheight.make_embed_snippet(html_doc, cfg)
            snip_path = os.path.splitext(out_path)[0] + "_iframe-snippet.txt"
            Path(snip_path).write_text(snippet, encoding="utf-8")
            log.info("HTML-Export OK: %s (%.0f KB) + Snippet %s",
                     out_path, len(html_doc.encode("utf-8")) / 1024, snip_path)
            return {
                "ok": True, "output": out_path, "snippet": snippet,
                "snippet_path": snip_path, "bytes": len(html_doc.encode("utf-8")),
            }
        except Exception as e:
            log.exception("heightanim_export_html fehlgeschlagen: %s", e)
            return {"ok": False, "error": str(e)}

    def heightanim_open_in_browser(self, path: str) -> dict:
        """v0.9.399 — öffnet die exportierte .html im DEFAULT-BROWSER. Nötig, weil
        ein Doppelklick im Finder .html je nach System in einem Editor öffnet
        (dann 'passiert nix' = nur Quelltext). `webbrowser.open` mit file://-URI
        nimmt den Standard-Browser."""
        import webbrowser
        try:
            p = Path(path)
            if not p.exists():
                return {"ok": False, "error": "Datei existiert nicht"}
            webbrowser.open(p.as_uri(), new=2)
            return {"ok": True}
        except Exception as e:
            log.exception("heightanim_open_in_browser fehlgeschlagen: %s", e)
            return {"ok": False, "error": str(e)}

    def tourmap_export_html(self, params: dict) -> dict:
        """v0.9.415 — Tour-Karte als interaktive HTML fürs Blog exportieren, mit
        derselben Karten-Engine wie Video/Standbild (MapLibre GL + __rzDrawSign) →
        echtes WYSIWYG. Baut EINE AnimatorConfig (wie tourmap_render) und lässt
        `canim.build_interactive_html()` daraus eine eigenständige, im Besucher-
        Browser laufende, frei zoom-/pan-bare Karte erzeugen (tokenfreie OSM-
        Kacheln, kein Playwright). Optional ein DSGVO-„Karte laden"-Gate.
        Liefert .html + <iframe srcdoc>-Snippet (WordPress-„Custom HTML")."""
        try:
            gpx_path = params.get("gpx_path", "")
            if not gpx_path or not Path(gpx_path).exists():
                return {"ok": False, "error": "GPX-Datei fehlt oder existiert nicht"}
            gpx_path = self._ensure_gpx(gpx_path)

            # Gewählter tokenfreier OSM-Kachelstil (Mapbox-Styles → OSM-Standard).
            style_key = params.get("tile_style") or params.get("map_style") or "osm"
            st = ctourhtml.tile_style(style_key if style_key in ctourhtml.OSM_TILE_STYLES else "osm")

            # Kamera aus der Live-Vorschau (snapshot_* = map.getCenter/Zoom/Bearing/
            # Pitch, ROH — gleiche Engine, keine correctedZoom/dsf-Korrektur nötig).
            _cam = params.get("snapshot_center")
            override_center = None
            override_zoom = None
            if isinstance(_cam, (list, tuple)) and len(_cam) == 2:
                override_center = (float(_cam[0]), float(_cam[1]))
                if params.get("snapshot_zoom") is not None:
                    override_zoom = float(params["snapshot_zoom"])
            _bearing = float(params.get("snapshot_bearing", params.get("bearing", 0)) or 0)
            _pitch = float(params.get("snapshot_pitch", 0) or 0)

            # line_style tube-Übersetzung (synchron zu tourmap_render).
            _ui_line_style = params.get("line_style", "solid")
            if _ui_line_style == "tube":
                _be_line_style = "solid"; _be_track_style = "tube"
            else:
                _be_line_style = _ui_line_style
                _be_track_style = params.get("track_style", "flat")

            w = int(params.get("width", 1120) or 1120)
            h = int(params.get("height", 640) or 640)

            cfg = canim.AnimatorConfig(
                gpx_path=gpx_path,
                output_path="",           # kein Playwright/Screenshot → ungenutzt
                mapbox_token="",          # OSM ist tokenfrei
                use_osm=True,
                interactive_export=True,
                still_frame=True,
                osm_tiles_url=st["url"],
                osm_max_zoom=int(st.get("max", 19) or 19),
                osm_attribution=st.get("attr"),
                map_style="osm",
                width=w, height=h,
                pitch=_pitch, bearing=_bearing,
                enable_terrain=False, hide_labels=False,
                line_color=params.get("line_color", "#ff6b35"),
                line_width=float(params.get("line_width", 4.5) or 4.5),
                line_style=_be_line_style,
                line_style_spacing=float(params.get("line_style_spacing", 1.0) or 1.0),
                track_style=_be_track_style,
                glow_enabled=bool(params.get("glow_enabled", True)),
                glow_strength=float(params.get("glow_strength", 4.0) or 4.0),
                # Overlays (Stats-Box) 1:1 wie in der Vorschau — WYSIWYG.
                show_overlays=bool(params.get("show_overlays", True)),
                overlay_totals_enabled=bool(params.get("overlay_totals_enabled", True)),
                overlay_totals_position=params.get("overlay_totals_position", "tl"),
                overlay_live_enabled=False,
                # v0.9.416 — Höhenprofil-Overlay explizit aus Params (Backend-Default
                # ist True → sonst erschien es im Export trotz ausgeschalteter Vorschau).
                overlay_elevation_enabled=bool(params.get("overlay_elevation_enabled", False)),
                overlay_elevation_position=params.get("overlay_elevation_position", "bc"),
                overlay_totals_fields=(list(params.get("overlay_totals_fields") or []) or None),
                overlay_field_overrides=(params.get("overlay_field_overrides") or {}),
                overlay_font=params.get("overlay_font", "system"),
                overlay_text_color=params.get("overlay_text_color", "#ffffff"),
                overlay_bg_color=params.get("overlay_bg_color", "#000000"),
                overlay_bg_opacity=float(params.get("overlay_bg_opacity", 0.55) or 0.55),
                show_pins=bool(params.get("show_pins", True)),
                photos=list(params.get("photos") or []),
                photos_size_px=int(params.get("photos_size_px", 48) or 48),
                photos_show=bool(params.get("photos_show", True)),
                signs=list(params.get("signs") or []),
                signs_show=bool(params.get("signs_show", True)),
                signs_size_px=int(params.get("signs_size_px", 40) or 40),
                signs_style=str(params.get("signs_style", "callout") or "callout"),
                signs_color=str(params.get("signs_color", "#ff6b35") or "#ff6b35"),
                override_center=override_center,
                override_zoom=override_zoom,
            )

            html_inner = canim.build_interactive_html(cfg)
            if bool(params.get("consent_enabled", False)):
                html_doc = ctourhtml.wrap_with_consent(
                    html_inner,
                    params.get("consent_text") or ctourhtml.DEFAULT_CONSENT_TEXT,
                    params.get("consent_button") or "Karte laden",
                )
            else:
                html_doc = html_inner

            out_name = params.get("output_name") or (Path(gpx_path).stem + "_tourkarte.html")
            if not out_name.lower().endswith(".html"):
                out_name += ".html"
            out_path = params.get("output_path") or str(RENDERS_DIR / out_name)
            RENDERS_DIR.mkdir(parents=True, exist_ok=True)
            Path(out_path).write_text(html_doc, encoding="utf-8")
            snippet = ctourhtml.make_tourmap_embed_snippet(html_doc, w, h)
            snip_path = os.path.splitext(out_path)[0] + "_iframe-snippet.txt"
            Path(snip_path).write_text(snippet, encoding="utf-8")
            log.info("Tour-Map HTML-Export OK (interaktiv/WYSIWYG): %s (%.0f KB) + Snippet %s",
                     out_path, len(html_doc.encode("utf-8")) / 1024, snip_path)
            return {"ok": True, "output": out_path, "snippet": snippet,
                    "snippet_path": snip_path, "bytes": len(html_doc.encode("utf-8"))}
        except Exception as e:
            log.exception("tourmap_export_html fehlgeschlagen: %s", e)
            return {"ok": False, "error": str(e)}

    def tourmap_open_in_browser(self, path: str) -> dict:
        """Öffnet die exportierte Tour-Karten-HTML im Default-Browser (wie heightanim)."""
        return self.heightanim_open_in_browser(path)

    # ── Tour-Map „HTML"-Modus: leichter Leaflet-Blog-Export ──────────────────
    # v0.9.418 — Eigener, minimaler Leaflet-Export (getrennt vom PNG/„Bild"-Modus,
    # der über die Animator-Engine läuft). Leicht (~0.2 MB), voller Track sofort,
    # WYSIWYG-Schilder (serverseitig gerastert), OSM-Kacheln, Consent. Keine Fotos,
    # kein 3D/Overlay. Eigene Leaflet-Vorschau in der App = exakt dieser Export.

    def tourmap_leaflet_prepare(self, params: dict) -> dict:
        """Daten für die Leaflet-Blog-VORSCHAU: voller Track als [lat,lon] +
        serverseitig gerasterte Schilder (WYSIWYG). Kein Screenshot, nur Sign-
        Rasterung (headless Chromium). Die Vorschau in der App zeichnet damit die
        IDENTISCHEN Bild-Marker wie der Export → echtes WYSIWYG."""
        try:
            gpx_path = params.get("gpx_path", "")
            track = []
            if gpx_path and Path(gpx_path).exists():
                gpx_path = self._ensure_gpx(gpx_path)
                pts, _stats = cgpx.parse_gpx(gpx_path)
                ds = cgpx.downsample(pts, 1500)
                track = [[p.lat, p.lon] for p in ds
                         if p.lat is not None and p.lon is not None]
            signs = csignraster.rasterize_signs(
                list(params.get("signs") or []),
                signs_show=bool(params.get("signs_show", True)))
            return {"ok": True, "track": track, "signs": signs}
        except Exception as e:
            log.exception("tourmap_leaflet_prepare fehlgeschlagen: %s", e)
            return {"ok": False, "error": str(e)}

    def tourmap_export_leaflet(self, params: dict) -> dict:
        """Leichter Leaflet-Blog-Export: eigenständige interaktive Karte (Leaflet +
        OSM), voller Track sofort, WYSIWYG-Schilder (serverseitig gerastert),
        optionaler DSGVO-Consent. Schreibt .html + <iframe srcdoc>-Snippet."""
        try:
            gpx_path = params.get("gpx_path", "")
            if not gpx_path or not Path(gpx_path).exists():
                return {"ok": False, "error": "GPX-Datei fehlt oder existiert nicht"}
            gpx_path = self._ensure_gpx(gpx_path)
            pts, _stats = cgpx.parse_gpx(gpx_path)
            if len(pts) < 2:
                return {"ok": False, "error": "GPX hat zu wenig Punkte (< 2)"}
            ds = cgpx.downsample(pts, 1500)
            track = [[p.lat, p.lon] for p in ds
                     if p.lat is not None and p.lon is not None]

            style_key = params.get("tile_style") or "osm"
            st = ctourhtml.tile_style(style_key if style_key in ctourhtml.OSM_TILE_STYLES else "osm")
            rsigns = csignraster.rasterize_signs(
                list(params.get("signs") or []),
                signs_show=bool(params.get("signs_show", True)))

            w = int(params.get("width", 1120) or 1120)
            h = int(params.get("height", 640) or 640)
            inner = ctmleaflet.make_leaflet_html({
                "track": track,
                "line_color": params.get("line_color", "#ff6b35"),
                "line_width": float(params.get("line_width", 4.5) or 4.5),
                "tile": st,
                "signs": rsigns,
                "show_pins": bool(params.get("show_pins", True)),
                "start_label": params.get("start_label", "Start"),
                "end_label": params.get("end_label", "Ziel"),
                "view_center": params.get("view_center"),
                "view_zoom": params.get("view_zoom"),
                "title": params.get("title") or (Path(gpx_path).stem + " — Tour-Karte"),
                "width": w, "height": h,
            })
            if bool(params.get("consent_enabled", False)):
                html_doc = ctourhtml.wrap_with_consent(
                    inner,
                    params.get("consent_text") or ctourhtml.DEFAULT_CONSENT_TEXT,
                    params.get("consent_button") or "Karte laden")
            else:
                html_doc = inner
            out_name = params.get("output_name") or (Path(gpx_path).stem + "_tourkarte.html")
            if not out_name.lower().endswith(".html"):
                out_name += ".html"
            out_path = params.get("output_path") or str(RENDERS_DIR / out_name)
            RENDERS_DIR.mkdir(parents=True, exist_ok=True)
            Path(out_path).write_text(html_doc, encoding="utf-8")
            snippet = ctourhtml.make_tourmap_embed_snippet(html_doc, w, h)
            snip_path = os.path.splitext(out_path)[0] + "_iframe-snippet.txt"
            Path(snip_path).write_text(snippet, encoding="utf-8")
            log.info("Tour-Map Leaflet-Export OK (leicht/Blog): %s (%.0f KB) + Snippet %s",
                     out_path, len(html_doc.encode("utf-8")) / 1024, snip_path)
            return {"ok": True, "output": out_path, "snippet": snippet,
                    "snippet_path": snip_path, "bytes": len(html_doc.encode("utf-8"))}
        except Exception as e:
            log.exception("tourmap_export_leaflet fehlgeschlagen: %s", e)
            return {"ok": False, "error": str(e)}

    # ── Web-Karte (eigener Tab): leichter Leaflet-Export mit Text-Labels ─────
    # v0.9.422 — Komplett getrennt von der Tour-Map. Kein Playwright/keine Schild-
    # Rasterung: nur Track (aus GPX) + freie Text-Beschriftungen als Leaflet-Labels.

    _LEAFLET_CACHE = None

    def _leaflet_assets(self):
        """(css, js) der gebündelten Leaflet-Dateien (ui/vendor/leaflet/) oder
        (None, None). Für den „inline“-Export + fürs Consent-Vorschaubild-Rendern."""
        if Api._LEAFLET_CACHE is not None:
            return Api._LEAFLET_CACHE
        css = js = None
        try:
            d = UI_DIR / "vendor" / "leaflet"
            fcss = d / "leaflet.css"
            fjs = d / "leaflet.js"
            if fcss.is_file() and fjs.is_file():
                css = fcss.read_text(encoding="utf-8")
                js = fjs.read_text(encoding="utf-8")
        except Exception as e:
            log.warning("Leaflet-Bundle konnte nicht gelesen werden: %s", e)
        Api._LEAFLET_CACHE = (css, js)
        return Api._LEAFLET_CACHE

    def webkarte_prepare(self, params: dict) -> dict:
        """Track für die Web-Karten-Vorschau: voller Track als [lat, lon]
        (downsampled). Sehr leicht, kein Screenshot/Playwright.
        §17 — Multi-Track: optionale `tracks:[{path,…}]` → je Track downsampled coords.
        Fallback: einzelner `gpx_path` (klassisch)."""
        try:
            tracks_in = params.get("tracks")
            if isinstance(tracks_in, list) and tracks_in:
                out = []
                for t in tracks_in:
                    tp = (t or {}).get("path") or ""
                    if not tp or not Path(tp).exists():
                        continue
                    try:
                        tgp = self._ensure_gpx(tp)
                        tpts, _ = cgpx.parse_gpx(tgp)
                        tds = cgpx.downsample(tpts, 1500)
                        coords = [[p.lat, p.lon] for p in tds
                                  if p.lat is not None and p.lon is not None]
                        if len(coords) < 1:
                            continue
                        out.append({"path": tp, "coords": coords, "name": str(t.get("name") or ""),
                                    "color": str(t.get("color") or "#ff6b35"),
                                    "width": float(t.get("width", 4.5) or 4.5),
                                    "show_pins": bool(t.get("show_pins", True))})
                    except Exception as te:
                        log.warning("webkarte_prepare: Track '%s' übersprungen: %s", tp, te)
                return {"ok": True, "tracks": out,
                        "track": (out[0]["coords"] if out else [])}
            gpx_path = params.get("gpx_path", "")
            if not gpx_path or not Path(gpx_path).exists():
                return {"ok": False, "error": "GPX-Datei fehlt oder existiert nicht"}
            gpx_path = self._ensure_gpx(gpx_path)
            pts, _stats = cgpx.parse_gpx(gpx_path)
            ds = cgpx.downsample(pts, 1500)
            track = [[p.lat, p.lon] for p in ds
                     if p.lat is not None and p.lon is not None]
            return {"ok": True, "track": track}
        except Exception as e:
            log.exception("webkarte_prepare fehlgeschlagen: %s", e)
            return {"ok": False, "error": str(e)}

    def webkarte_export(self, params: dict) -> dict:
        """Leichter Leaflet-Blog-Export der Web-Karte: Track + Text-Labels + OSM,
        optionaler DSGVO-Consent. Schreibt .html + <iframe srcdoc>-Snippet."""
        try:
            gpx_path = params.get("gpx_path", "")
            if not gpx_path or not Path(gpx_path).exists():
                return {"ok": False, "error": "GPX-Datei fehlt oder existiert nicht"}
            gpx_path = self._ensure_gpx(gpx_path)
            pts, _stats = cgpx.parse_gpx(gpx_path)
            if len(pts) < 2:
                return {"ok": False, "error": "GPX hat zu wenig Punkte (< 2)"}
            ds = cgpx.downsample(pts, 1500)
            track = [[p.lat, p.lon] for p in ds
                     if p.lat is not None and p.lon is not None]

            # §17 — Multi-Track: optionale `tracks:[{path,name,color,width,show_pins}]`.
            # Jeder Track wird aus seiner Datei geladen + downsampled. Fallback = der
            # eine globale Track (gpx_path) als Ein-Element-Liste → alte Projekte unverändert.
            tracks_cfg = []
            for t in (params.get("tracks") or []):
                tp = (t or {}).get("path") or ""
                if not tp or not Path(tp).exists():
                    continue
                try:
                    tgp = self._ensure_gpx(tp)
                    tpts, _ = cgpx.parse_gpx(tgp)
                    if len(tpts) < 2:
                        continue
                    tds = cgpx.downsample(tpts, 1500)
                    tcoords = [[p.lat, p.lon] for p in tds
                               if p.lat is not None and p.lon is not None]
                    if len(tcoords) < 2:
                        continue
                    tracks_cfg.append({
                        "coords": tcoords, "name": str(t.get("name") or ""),
                        "color": str(t.get("color") or params.get("line_color", "#ff6b35")),
                        "width": float(t.get("width", params.get("line_width", 4.5)) or 4.5),
                        "show_pins": bool(t.get("show_pins", True)),
                    })
                except Exception as te:
                    log.warning("webkarte_export: Track '%s' übersprungen: %s", tp, te)
            if not tracks_cfg:
                tracks_cfg = [{"coords": track, "name": "",
                               "color": params.get("line_color", "#ff6b35"),
                               "width": float(params.get("line_width", 4.5) or 4.5),
                               "show_pins": bool(params.get("show_pins", True))}]

            style_key = params.get("tile_style") or "osm"
            st = ctourhtml.tile_style(style_key if style_key in ctourhtml.OSM_TILE_STYLES else "osm")

            w = int(params.get("width", 1120) or 1120)
            h = int(params.get("height", 640) or 640)

            # v0.9.430 — Leaflet-Quelle: cdn | url | inline (self-contained).
            leaflet_mode = str(params.get("leaflet_mode") or "cdn").lower()
            _lcss, _ljs = self._leaflet_assets()
            leaflet_params = {"leaflet_mode": leaflet_mode,
                              "leaflet_url": str(params.get("leaflet_url") or "")}
            if leaflet_mode == "inline":
                if _lcss and _ljs:
                    leaflet_params["leaflet_css"] = _lcss
                    leaflet_params["leaflet_js"] = _ljs
                else:
                    leaflet_params["leaflet_mode"] = "cdn"
                    log.warning("Leaflet-Inline gewünscht, aber Bundle-Dateien fehlen → CDN-Fallback")

            # v0.9.431 — abschaltbarer „erstellt mit"-Backlink (Default an).
            credit_on = bool(params.get("attribution_enabled", True))
            credit_text = WEBKARTE_CREDIT_TEXT if credit_on else ""
            credit_url = WEBKARTE_CREDIT_URL if credit_on else ""
            credit_html = ctmleaflet.credit_link_html(credit_text, credit_url)

            base_cfg = {
                "track": track,
                "tracks": tracks_cfg,
                "line_color": params.get("line_color", "#ff6b35"),
                "line_width": float(params.get("line_width", 4.5) or 4.5),
                "tile": st,
                "labels": list(params.get("labels") or []),
                "show_pins": bool(params.get("show_pins", True)),
                "start_label": params.get("start_label", "Start"),
                "end_label": params.get("end_label", "Ziel"),
                "view_center": params.get("view_center"),
                "view_zoom": params.get("view_zoom"),
                "title": params.get("title") or (Path(gpx_path).stem + " — Karte"),
                "credit_text": credit_text, "credit_url": credit_url,
                "width": w, "height": h,
            }
            inner = ctmleaflet.make_leaflet_html({**base_cfg, **leaflet_params})
            if bool(params.get("consent_enabled", False)):
                # v0.9.426 — lokal eingebettetes Vorschaubild HINTER dem Consent-Gate,
                # damit es nicht leer wirkt. Karte einmal headless rendern → JPEG-data-URI.
                # v0.9.429 — optional (consent_preview): aus = schneller Export, leeres Gate.
                # v0.9.430 — Bild kleiner (560×320, q52) + zum RENDERN Leaflet inline
                # (funktioniert offline + unabhängig von der gewählten Export-Quelle).
                bg_uri = ""
                if bool(params.get("consent_preview", True)):
                    try:
                        prev_cfg = dict(base_cfg)
                        if _lcss and _ljs:
                            prev_cfg["leaflet_mode"] = "inline"
                            prev_cfg["leaflet_css"] = _lcss
                            prev_cfg["leaflet_js"] = _ljs
                        inner_prev = ctmleaflet.make_leaflet_html(prev_cfg)
                        png = ctmleaflet.render_preview_png(inner_prev, 560, 320, quality=52)
                        if png:
                            bg_uri = "data:image/jpeg;base64," + base64.b64encode(png).decode("ascii")
                            log.info("Web-Karte-Consent-Vorschaubild gerendert (%.0f KB)",
                                     len(png) / 1024)
                        else:
                            log.warning("Consent-Vorschaubild: Rendern lieferte nichts (Playwright/Chromium?)")
                    except Exception as e:
                        log.warning("Consent-Vorschaubild fehlgeschlagen: %s", e)
                html_doc = ctourhtml.wrap_with_consent(
                    inner,
                    params.get("consent_text") or ctourhtml.DEFAULT_CONSENT_TEXT,
                    params.get("consent_button") or "Karte laden",
                    bg_uri, credit_html)
            else:
                html_doc = inner
            out_name = params.get("output_name") or (Path(gpx_path).stem + "_webkarte.html")
            if not out_name.lower().endswith(".html"):
                out_name += ".html"
            out_path = params.get("output_path") or str(RENDERS_DIR / out_name)
            RENDERS_DIR.mkdir(parents=True, exist_ok=True)
            Path(out_path).write_text(html_doc, encoding="utf-8")
            snippet = ctourhtml.make_tourmap_embed_snippet(html_doc, w, h)
            snip_path = os.path.splitext(out_path)[0] + "_iframe-snippet.txt"
            Path(snip_path).write_text(snippet, encoding="utf-8")
            log.info("Web-Karte-Export OK: %s (%.0f KB) + Snippet %s",
                     out_path, len(html_doc.encode("utf-8")) / 1024, snip_path)
            return {"ok": True, "output": out_path, "snippet": snippet,
                    "snippet_path": snip_path, "bytes": len(html_doc.encode("utf-8"))}
        except Exception as e:
            log.exception("webkarte_export fehlgeschlagen: %s", e)
            return {"ok": False, "error": str(e)}

    # ── Drag & Drop ──────────────────────────────────────────────────────────
    #
    # v0.9.153 — NATIVE Pfade bei Drag&Drop (alle Plattformen):
    # pywebview 6.x liefert die ECHTEN Original-Pfade gedroppter Dateien über
    # `pywebviewFullPath` bzw. intern `webview.dom._dnd_state['paths']`. Die
    # native Plattform-Schicht (cocoa `performDragOperation_`, edgechromium,
    # gtk, qt) befüllt diese Liste bei JEDEM Drop — Voraussetzung ist nur, dass
    # mindestens EIN Python-Drop-Listener registriert ist (`num_listeners > 0`).
    # Diesen registrieren wir einmalig nach `loaded` (siehe _on_loaded →
    # _enable_native_drop). JS bekommt den Pfad NIE direkt vom Browser
    # (WKWebView/Security), holt ihn aber synchron über `consume_drop_paths()`.
    # → Geotagger taggt damit die ORIGINALE in-place (kein Wegwerf-Copy mehr).
    #
    # FALLBACK: Kann der native Pfad nicht ermittelt werden (alte OS-Version,
    # Ordner-Drop, Sonderfall), greift weiterhin der base64-Weg: JS liest die
    # Datei via FileReader und schickt sie als base64 hierher → `_drops/<sid>/`.

    def consume_drop_paths(self) -> dict:
        """v0.9.153: Liefert die echten Originalpfade der zuletzt gedroppten
        Dateien (pywebview `_dnd_state['paths']`) als Mapping basename→Pfad und
        leert dabei die Liste. Race-frei, weil die native Schicht die Pfade
        synchron VOR dem JS-Drop-Event befüllt. Bei Fehlern → leeres Mapping,
        die UI fällt dann automatisch auf den base64-Kopie-Weg zurück."""
        try:
            from webview.dom import _dnd_state  # type: ignore
            with _drop_state_lock:
                items = list(_dnd_state.get("paths", []))
                _dnd_state["paths"] = []
            out = {}
            for entry in items:
                try:
                    name, path = entry
                except Exception:
                    continue
                p = str(path)
                if not p:
                    continue
                out[os.path.basename(p)] = p
                if name:
                    out[os.path.basename(str(name))] = p
            return {"ok": True, "paths": out, "count": len(items)}
        except Exception as e:
            log.warning("consume_drop_paths fehlgeschlagen: %s", e)
            return {"ok": False, "error": str(e), "paths": {}}

    def drop_session_start(self) -> dict:
        """Legt einen neuen Drop-Session-Ordner an und gibt dessen Pfad zurück."""
        sid = uuid.uuid4().hex[:10]
        d = DROPS_DIR / sid
        d.mkdir(parents=True, exist_ok=True)
        return {"ok": True, "session_id": sid, "dir": str(d)}

    def drop_save_file(self, session_id: str, name: str, b64_content: str) -> dict:
        """Speichert eine einzelne droppe Datei in `_drops/<session>/`."""
        try:
            if not session_id or "/" in session_id or "\\" in session_id:
                return {"ok": False, "error": "Ungültige session_id"}
            # Namensbereinigung — keine Subpath-Tricks
            safe_name = os.path.basename(name) or f"unnamed_{uuid.uuid4().hex[:8]}"
            d = DROPS_DIR / session_id
            d.mkdir(parents=True, exist_ok=True)
            dst = d / safe_name
            # base64 → bytes
            raw = base64.b64decode(b64_content)
            with open(dst, "wb") as fh:
                fh.write(raw)
            return {"ok": True, "path": str(dst), "size": len(raw)}
        except Exception as e:
            return {"ok": False, "error": str(e), "trace": traceback.format_exc()}

    def drop_save_text_file(self, session_id: str, name: str, content: str) -> dict:
        """Speichert eine text-Drop-Datei (z.B. GPX) ohne base64-Overhead."""
        try:
            if not session_id or "/" in session_id or "\\" in session_id:
                return {"ok": False, "error": "Ungültige session_id"}
            safe_name = os.path.basename(name) or f"unnamed_{uuid.uuid4().hex[:8]}.txt"
            d = DROPS_DIR / session_id
            d.mkdir(parents=True, exist_ok=True)
            dst = d / safe_name
            with open(dst, "w", encoding="utf-8") as fh:
                fh.write(content)
            return {"ok": True, "path": str(dst), "size": len(content)}
        except Exception as e:
            return {"ok": False, "error": str(e), "trace": traceback.format_exc()}

    def path_exists(self, path: str) -> dict:
        """v0.9.27: simpler Existenz-Check für die UI (z.B. Auto-Restore
        des letzten GPX-Pfads nach App-Restart)."""
        try:
            if not path:
                return {"ok": True, "exists": False}
            p = Path(path)
            return {
                "ok": True,
                "exists": p.exists(),
                "is_file": p.is_file() if p.exists() else False,
                "is_dir": p.is_dir() if p.exists() else False,
            }
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def list_photos_in_folder(self, folder: str) -> dict:
        """Hilfsfunktion: gibt alle unterstützten Foto-Dateien (JPG + RAW) in einem Ordner zurück."""
        try:
            if not os.path.isdir(folder):
                return {"ok": False, "error": "Kein Ordner"}
            files = []
            for entry in sorted(os.listdir(folder)):
                full = os.path.join(folder, entry)
                if cexif.is_photo(full):
                    files.append(full)
            return {"ok": True, "files": files}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def reveal_in_finder(self, path: str) -> dict:
        try:
            import subprocess
            if sys.platform == "darwin":
                subprocess.run(["open", "-R", path], check=False)
            elif sys.platform == "win32":
                subprocess.run(["explorer", "/select,", path], check=False)
            else:
                subprocess.run(["xdg-open", str(Path(path).parent)], check=False)
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def open_external_url(self, url: str) -> dict:
        """Öffnet eine URL im Default-Browser (für externe Links wie z.B.
        Mapbox-Dashboard, Reisezoom-Blog etc.)."""
        try:
            import subprocess, webbrowser
            if sys.platform == "darwin":
                subprocess.run(["open", url], check=False)
            elif sys.platform == "win32":
                subprocess.run(["cmd", "/c", "start", "", url], shell=False, check=False)
            else:
                webbrowser.open(url)
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    # ── Logging ───────────────────────────────────────────────────────────────

    def log_js(self, level: str, msg: str) -> dict:
        """JS → Python-Log-Bridge (v0.8.4-Debug). Damit Marc auch ohne
        DevTools-Konsole sieht was im Frontend passiert — JS-Logs landen
        in app.log."""
        try:
            lvl = (level or "info").lower()
            if lvl == "error":
                log.error("[JS] %s", msg)
            elif lvl == "warn":
                log.warning("[JS] %s", msg)
            else:
                log.info("[JS] %s", msg)
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def get_log_info(self) -> dict:
        """Liefert Pfad + Existenz + Größe der Logdatei für die UI."""
        try:
            p = LOG_PATH
            exists = p.exists()
            size = p.stat().st_size if exists else 0
            return {"ok": True, "path": str(p), "exists": exists, "size": size}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def open_log(self) -> dict:
        """Öffnet die Logdatei im Standard-Texteditor."""
        try:
            import subprocess
            p = LOG_PATH
            if not p.exists():
                # Sicherheitshalber leere Datei anlegen, sonst meckert `open`.
                p.parent.mkdir(parents=True, exist_ok=True)
                p.touch()
            if sys.platform == "darwin":
                subprocess.run(["open", str(p)], check=False)
            elif sys.platform == "win32":
                subprocess.run(["notepad", str(p)], check=False)
            else:
                subprocess.run(["xdg-open", str(p)], check=False)
            log.info("open_log: %s", p)
            return {"ok": True, "path": str(p)}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def reveal_log_in_finder(self) -> dict:
        """Zeigt die Logdatei im Finder."""
        try:
            return self.reveal_in_finder(str(LOG_PATH))
        except Exception as e:
            return {"ok": False, "error": str(e)}

    # ── Doku / Hilfe / Über ───────────────────────────────────────────────────

    def _resolve_bundled_doc(self, name: str) -> Optional[Path]:
        """Findet eine Doku-Datei sowohl im PyInstaller-Bundle als auch im
        Source-Tree (für Dev-Modus). Returns Path oder None."""
        candidates: list[Path] = []
        # Bundle-Pfad: docs/<name>
        candidates.append(ROOT / "docs" / name)
        # Source-Tree-Fallback
        src_root = Path(__file__).resolve().parent
        candidates.append(src_root / "docs" / name)
        for c in candidates:
            if c.exists():
                return c
        return None

    def _open_path_native(self, p: Path) -> dict:
        """Plattformübergreifend eine Datei/URL im System-Default öffnen."""
        try:
            import subprocess
            if sys.platform == "darwin":
                subprocess.run(["open", str(p)], check=False)
            elif sys.platform == "win32":
                os.startfile(str(p))  # type: ignore[attr-defined]
            else:
                subprocess.run(["xdg-open", str(p)], check=False)
            return {"ok": True, "path": str(p)}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def open_path(self, path: str) -> dict:
        """v0.9.158 — Öffnet eine beliebige Datei im System-Default-Programm
        (z.B. fertiges Render-Video in QuickTime). Garantierter Abspiel-Weg,
        falls der eingebaute `<video>`-Player (WKWebView) das File:// nicht lädt.
        """
        try:
            p = Path(path)
            if not p.exists():
                return {"ok": False, "error": f"Datei nicht gefunden: {path}"}
            return self._open_path_native(p)
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def serve_media(self, path: str) -> dict:
        """v0.9.160 — Registriert eine Datei beim lokalen Media-HTTP-Server und
        liefert eine `http://127.0.0.1:<port>/media/<token>`-URL zurück. Das
        eingebettete `<video>` spielt darüber zuverlässig inline (file:// von
        externen Volumes blockt WKWebView). Bei Fehler nutzt das UI den
        file://-Fallback."""
        try:
            p = Path(path)
            if not p.exists():
                return {"ok": False, "error": f"Datei nicht gefunden: {path}"}
            port = _ensure_media_server()
            token = _secrets.token_urlsafe(16)
            _media_registry[token] = str(p.resolve())
            # Registry begrenzen (nur die letzten 50 Videos behalten)
            if len(_media_registry) > 50:
                for k in list(_media_registry.keys())[:-50]:
                    _media_registry.pop(k, None)
            return {"ok": True, "url": f"http://127.0.0.1:{port}/media/{token}"}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def open_user_guide(self) -> dict:
        """Öffnet die HTML-User-Guide im Default-Browser. Liefert schick
        formatierte Doku mit Anchor-Navigation."""
        p = self._resolve_bundled_doc("USER_GUIDE.html")
        if not p:
            return {"ok": False, "error": "USER_GUIDE.html nicht gefunden — `python3 scripts/build_user_guide_html.py` ausführen."}
        log.info("open_user_guide: %s", p)
        return self._open_path_native(p)

    def get_app_info(self) -> dict:
        """Über-Dialog-Daten: Version, Python, Paths."""
        return {
            "ok": True,
            "name": APP_NAME,
            "edition": APP_EDITION,   # v0.9.331 — "full" | "geotagger" (Frontend-Gating)
            "version": APP_VERSION,
            "python": sys.version.split()[0],
            "app_support": str(APP_SUPPORT),
            "log_path": str(LOG_PATH),
            "tour_maps_dir": str(TOURMAPS_DIR),
            "renders_dir": str(RENDERS_DIR),
        }

    def prepare_bug_report(self, context: str = "") -> dict:
        """Baut den vorbefüllten Bug-Report-Text (Subject + Body) und liefert
        ihn ans UI. UI zeigt's in einem Modal mit Copy-Buttons (User kopiert
        und fügt's in sein Webmail/Mailprogramm ein).

        Gibt zusätzlich eine `mailto:`-URL zurück, falls der User
        ein lokales Mail-Programm hat und es direkt nutzen will.

        - `context`: kurzer Frei-Text aus der UI (z.B. Crash-Modal-Titel)
        """
        try:
            import urllib.parse

            # Letzte ~3 KB Log einsammeln
            log_excerpt = "(kein Log vorhanden)"
            try:
                if LOG_PATH.exists():
                    sz = LOG_PATH.stat().st_size
                    with open(LOG_PATH, "rb") as fh:
                        if sz > 3000:
                            fh.seek(sz - 3000)
                            raw = fh.read()
                            nl = raw.find(b"\n")
                            if nl >= 0:
                                raw = raw[nl + 1:]
                            log_excerpt = "…(gekürzt)…\n" + raw.decode("utf-8", errors="replace")
                        else:
                            log_excerpt = fh.read().decode("utf-8", errors="replace")
            except Exception as e:
                log_excerpt = f"(Log konnte nicht gelesen werden: {e})"

            subject = f"[GPS Studio v{APP_VERSION}] Bug-Report"
            if context:
                subject += f" — {context[:60]}"

            # Selbe OS-Label-Funktion wie im App-Start-Log → konsistent
            os_label = clog.get_os_label()

            body = (
                "Hallo Marc,\n\n"
                "ich hatte mit Reisezoom GPS Studio ein Problem.\n"
                "Beschreibe hier kurz was du gemacht hast bevor der Fehler kam:\n\n"
                "[hier deinen Text einfügen]\n\n"
                "---\n"
                f"App-Version: {APP_VERSION}\n"
                f"OS: {os_label}\n"
                f"Python: {sys.version.split()[0]}\n"
                f"Log-Auszug (letzte 3 KB):\n\n"
                f"{log_excerpt}\n"
            )

            # mailto-URL als optionaler Bequemlichkeits-Pfad. Längen-cap bei
            # ~7,5 KB für Mail-Clients die das nicht packen.
            short_for_mailto = body
            if len(body) > 6000:
                short_for_mailto = (
                    "Hallo Marc,\n\n"
                    "[Beschreibe was du gemacht hast]\n\n"
                    "---\n"
                    f"App-Version: {APP_VERSION}\n"
                    f"OS: {os_label}\n\n"
                    f"Vollständiger Log liegt unter:\n{LOG_PATH}\n"
                    "(Hilfe → Logdatei öffnen + als Anhang dranhängen)"
                )
            mailto = (
                "mailto:marc@reisezoom.com"
                f"?subject={urllib.parse.quote(subject)}"
                f"&body={urllib.parse.quote(short_for_mailto)}"
            )

            log.info("prepare_bug_report: built (context=%s)", context[:60] if context else "")
            return {
                "ok": True,
                "to": "marc@reisezoom.com",
                "subject": subject,
                "body": body,
                "mailto": mailto,
            }
        except Exception as e:
            log.error("prepare_bug_report failed: %s", e)
            return {"ok": False, "error": str(e)}

    # ── Playwright / Chromium-Browser ─────────────────────────────────────────

    def playwright_check(self) -> dict:
        """Prüft ob der Chromium-Headless-Shell-Browser für Playwright auf der Platte ist.

        Cross-Platform-Pfade & Executable-Suffixe — vor v0.5.0 war das
        macOS-hartkodiert, deshalb sah Windows nach erfolgreichem Install
        weiterhin "Cache leer" (Beta-Tester-Bug-Report).

        Returns: {ok, browser_present, browsers_path, version?, executable?, error?}
        """
        try:
            # Cache-Pfad — pro OS unterschiedlich. Env-Var überschreibt alle.
            env_path = os.environ.get("PLAYWRIGHT_BROWSERS_PATH")
            if env_path:
                browsers_path = Path(env_path)
            elif sys.platform == "darwin":
                browsers_path = Path.home() / "Library" / "Caches" / "ms-playwright"
            elif sys.platform == "win32":
                # Windows: %USERPROFILE%\AppData\Local\ms-playwright
                local_appdata = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
                browsers_path = Path(local_appdata) / "ms-playwright"
            else:
                # Linux + andere Unix: ~/.cache/ms-playwright (XDG)
                xdg_cache = os.environ.get("XDG_CACHE_HOME") or str(Path.home() / ".cache")
                browsers_path = Path(xdg_cache) / "ms-playwright"

            result = {"ok": True, "browser_present": False, "browsers_path": str(browsers_path)}
            if not browsers_path.exists():
                result["error"] = f"Browser-Cache-Ordner existiert nicht: {browsers_path}"
                return result
            # Wir suchen den neuesten chromium_headless_shell-Eintrag
            candidates = sorted(
                [d for d in browsers_path.iterdir() if d.is_dir()
                 and d.name.startswith("chromium_headless_shell-")],
                key=lambda d: d.name, reverse=True,
            )
            if not candidates:
                result["error"] = f"Kein chromium_headless_shell in {browsers_path}"
                return result

            # Executable-Pfad — pro Plattform/Architektur unterschiedliches
            # Subdir + Suffix. Reihenfolge: erst die wahrscheinlichste Variante
            # für diese Plattform, dann Fallbacks.
            import platform as _plat
            arch = _plat.machine().lower()  # "x86_64", "arm64", "aarch64", "amd64", ...
            if sys.platform == "darwin":
                if arch in ("arm64", "aarch64"):
                    subdirs = ["chrome-headless-shell-mac-arm64", "chrome-headless-shell-mac"]
                else:
                    subdirs = ["chrome-headless-shell-mac", "chrome-headless-shell-mac-arm64"]
                exe_name = "chrome-headless-shell"
            elif sys.platform == "win32":
                subdirs = ["chrome-headless-shell-win64", "chrome-headless-shell-win32"]
                exe_name = "chrome-headless-shell.exe"
            else:
                # Playwright benennt den Linux-Unterordner "…-linux64" (bzw.
                # "…-linux-arm64"), NICHT "…-linux". Der alte Name fand den
                # Browser nie → Render schlug fehl. Danke @uli-heller.
                if arch in ("arm64", "aarch64"):
                    subdirs = ["chrome-headless-shell-linux-arm64", "chrome-headless-shell-linux64", "chrome-headless-shell-linux"]
                else:
                    subdirs = ["chrome-headless-shell-linux64", "chrome-headless-shell-linux-arm64", "chrome-headless-shell-linux"]
                exe_name = "chrome-headless-shell"

            for d in candidates:
                for sub in subdirs:
                    exe = d / sub / exe_name
                    if exe.exists():
                        result["browser_present"] = True
                        result["version"] = d.name
                        result["executable"] = str(exe)
                        return result
            result["error"] = (
                f"chrome-headless-shell-Binärdatei nicht im Cache gefunden "
                f"(gesucht in: {', '.join(subdirs)} unter {browsers_path})"
            )
            return result
        except Exception as e:
            return {"ok": False, "error": str(e), "trace": traceback.format_exc()}

    def playwright_install_chromium(self) -> dict:
        """Installiert chromium-headless-shell via gebundeltem Playwright-Driver.

        Läuft synchron — UI sollte vorher ein „Lade Browser …"-Modal zeigen.
        Returns: {ok, log?, error?}
        """
        try:
            import subprocess as _sp
            from playwright._impl._driver import compute_driver_executable, get_driver_env  # type: ignore

            driver_exe, driver_cli = compute_driver_executable()
            env = os.environ.copy()
            env.update(get_driver_env())

            log.info("playwright_install_chromium: driver=%s cli=%s", driver_exe, driver_cli)
            cmd = [driver_exe, driver_cli, "install", "chromium-headless-shell"]
            log.info("playwright_install_chromium: cmd=%s", " ".join(cmd))
            proc = _sp.run(cmd, env=env, capture_output=True, text=True, timeout=600)
            out = (proc.stdout or "") + "\n" + (proc.stderr or "")
            log.info("playwright_install_chromium: rc=%s\n%s", proc.returncode, out[:2000])
            if proc.returncode != 0:
                return {"ok": False, "error": f"Install fehlgeschlagen (rc={proc.returncode})", "log": out}
            return {"ok": True, "log": out}
        except Exception as e:
            log.error("playwright_install_chromium: %s\n%s", e, traceback.format_exc())
            return {"ok": False, "error": str(e), "trace": traceback.format_exc()}

    def get_log_tail(self, max_bytes: int = 16_000) -> dict:
        """Liefert die letzten `max_bytes` Bytes der Logdatei als Text — für
        Inline-Anzeige in einem Fehler-Modal, ohne Datei extern öffnen zu müssen."""
        try:
            p = LOG_PATH
            if not p.exists():
                return {"ok": True, "path": str(p), "text": "(Logdatei existiert noch nicht)"}
            size = p.stat().st_size
            with open(p, "rb") as fh:
                if size > max_bytes:
                    fh.seek(size - max_bytes)
                    raw = fh.read()
                    # Erste (möglicherweise unvollständige) Zeile verwerfen
                    nl = raw.find(b"\n")
                    if nl >= 0:
                        raw = raw[nl + 1:]
                    text = "…(gekürzt, ältere Einträge stehen im File)…\n" + raw.decode("utf-8", errors="replace")
                else:
                    text = fh.read().decode("utf-8", errors="replace")
            return {"ok": True, "path": str(p), "text": text, "size": size}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    # ── GPX-Inspektor (v0.9.233 — Track heilen/füllen) ────────────────────────

    def gpxinspect_load(self, path: str) -> dict:
        """Vollen Roh-Track laden (alle Punkte inkl. ele + time) für den Editor."""
        try:
            # v0.9.295 (Bug Beta-Tester): Fremdformate (.LOG/.fit/.kml/…) zuerst nach GPX
            # konvertieren — wie alle anderen Lade-Pfade. Sonst gibt gpxpy bei einer
            # rohen .LOG-Datei „not well-formed (invalid token)". Der konvertierte
            # Pfad wird zurückgegeben, damit „Geheiltes GPX speichern" daneben landet.
            gpx_path = self._ensure_gpx(path)
            res = cgpxedit.load_points(gpx_path)
            if isinstance(res, dict) and res.get("ok"):
                res["src"] = gpx_path
            return res
        except Exception as e:
            log.error("gpxinspect_load: %s\n%s", e, traceback.format_exc())
            return {"ok": False, "error": str(e)}

    def gpxinspect_route_ab(self, a: list, b: list, profile: str = "walking") -> dict:
        """v0.9.267 — Straßen-/Wege-Route zwischen zwei Punkten A,B (Directions). Robuster
        als Map Matching (kein 50-m-Limit): A/B werden auf die nächste Straße gesnappt,
        dazwischen geroutet. a/b = [lon,lat]. Returns {ok, coords, matched} oder {ok:False}."""
        try:
            token = _active_mapbox_token()
            if not token:
                return {"ok": False, "error": "no_token"}
            res = croute.directions_geometry(a, b, token, profile=str(profile or "walking"))
            return {"ok": True, "coords": res.get("coords", []), "matched": bool(res.get("matched"))}
        except croute.RouteError as e:
            return {"ok": False, "error": str(e)}
        except Exception as e:  # noqa: BLE001
            log.error("gpxinspect_route_ab: %s\n%s", e, traceback.format_exc())
            return {"ok": False, "error": str(e)}

    def gpxinspect_route_gaps(self, gaps: list, profile: str = "walking") -> dict:
        """v0.9.300 — Mehrere Lücken auf einmal entlang echter Wege/Straßen routen
        (Directions, Profile walking/cycling/driving). `gaps` = [[Alon,Alat,Blon,Blat], …].
        Returns {ok, routes:[{ok, coords}, …]} (gleiche Reihenfolge wie `gaps`). Lücken mit
        Luftlinie > 300 km (z. B. Flugbögen) werden übersprungen (ok:False) → Caller füllt
        sie linear. Pro Lücke ein Directions-Request; bei ~30 Lücken kurze Wartezeit."""
        try:
            token = _active_mapbox_token()
            if not token:
                return {"ok": False, "error": "no_token"}
            prof = str(profile or "walking")
            routes = []
            for g in (gaps or []):
                try:
                    alon, alat, blon, blat = float(g[0]), float(g[1]), float(g[2]), float(g[3])
                except Exception:  # noqa: BLE001
                    routes.append({"ok": False}); continue
                try:
                    dist = croute._haversine_m(alat, alon, blat, blon)
                except Exception:  # noqa: BLE001
                    dist = 0.0
                if dist > 300000:   # interkontinental → Mapbox routet das nicht
                    routes.append({"ok": False, "reason": "too_far"}); continue
                try:
                    res = croute.directions_geometry([alon, alat], [blon, blat], token, profile=prof)
                    cc = res.get("coords", [])
                    routes.append({"ok": bool(res.get("matched")) and len(cc) >= 2, "coords": cc})
                except Exception as e:  # noqa: BLE001
                    routes.append({"ok": False, "error": str(e)})
            return {"ok": True, "routes": routes}
        except Exception as e:  # noqa: BLE001
            log.error("gpxinspect_route_gaps: %s\n%s", e, traceback.format_exc())
            return {"ok": False, "error": str(e)}

    def gpxinspect_map_match(self, coords: list, profile: str = "walking", radius_m: int = 25) -> dict:
        """v0.9.263 — Koordinaten-Spur [[lon,lat], …] via Mapbox Map Matching auf
        das Wege-/Straßennetz snappen (Track glätten). `radius_m` = Such-Radius pro
        Punkt (1–50). Returns {ok, coords, matched} oder {ok:False, error}."""
        try:
            token = _active_mapbox_token()
            if not token:
                return {"ok": False, "error": "no_token"}
            try:
                _r = int(radius_m)
            except Exception:  # noqa: BLE001
                _r = 25
            res = croute.map_match(coords or [], token, profile=str(profile or "walking"), radius_m=_r)
            return {"ok": True, "coords": res.get("coords", []), "matched": bool(res.get("matched"))}
        except croute.RouteError as e:
            return {"ok": False, "error": str(e)}
        except Exception as e:  # noqa: BLE001
            log.error("gpxinspect_map_match: %s\n%s", e, traceback.format_exc())
            return {"ok": False, "error": str(e)}

    def gpxinspect_save(self, points: list, src_path: str,
                        out_path: str = "", fmt: str = "gpx") -> dict:
        """Editierten Track speichern. `out_path` = vom „Speichern unter…"-Dialog
        gewählter Pfad (leer → Default `<name>_geheilt.gpx` neben der Quelle).
        `fmt` ∈ {gpx, tcx}; Sensoren werden eingebettet (v0.9.335). Original bleibt
        unberührt."""
        try:
            out = out_path or cgpxedit.healed_output_path(src_path or "track.gpx")
            base = os.path.splitext(os.path.basename(out))[0]
            res = cgpxedit.save_points(points or [], out, name=base,
                                       src_path=src_path, fmt=fmt)
            if res.get("ok"):
                log.info("gpxinspect_save[%s]: %d Punkte → %s (Sensoren: %s)",
                         res.get("fmt"), res.get("count", 0), out, res.get("sensors_kept"))
            return res
        except Exception as e:
            log.error("gpxinspect_save: %s\n%s", e, traceback.format_exc())
            return {"ok": False, "error": str(e)}

    # ── Geotagger ─────────────────────────────────────────────────────────────

    def geotagger_load_gpx(self, path: str) -> dict:
        try:
            import math
            path = self._ensure_gpx(path)   # v0.9.282: FIT/NMEA/KML/… → GPX
            pts, stats = cgpx.parse_gpx(path)
            self._gtg_track = pts
            self._gtg_stats = stats
            # v0.9.168 — dynamische Punktdichte statt fix 800: 50 Punkte je km
            # (aufgerundet). So bleibt ein kurzer Track fein, ein 100-km-Track
            # bekommt entsprechend mehr Punkte (statt grob auf 800 gestaucht).
            # Obergrenze 100000 ist KEIN Qualitätslimit, sondern nur eine
            # Notbremse gegen kaputte/absurde GPX (Millionen Punkte würden die
            # WebView beim Übertragen einfrieren). Greift erst ab ~2000 km UND
            # entsprechend vielen Roh-Punkten — praktisch nie. `downsample` fügt
            # ohnehin nie Punkte hinzu: effektiv min(Ziel, echte Punktzahl).
            km = (stats.distance_m or 0) / 1000.0
            target = max(2, min(100000, math.ceil(km) * 50))
            ds = cgpx.downsample(pts, target)
            # Genau diese (downsampled) Punkte werden als Linie gezeichnet (siehe
            # coords unten). Beim „Auf Track einrasten" (v0.9.167) projizieren wir
            # auf EXAKT diese Linie, sonst sitzt der Pin neben der sichtbaren Linie.
            self._gtg_display = ds
            return {
                "ok": True,
                "name": stats.name or Path(path).stem,
                "coords": [[p.lon, p.lat] for p in ds],
                "bbox": stats.bbox,
                "time_start": pts[0].time,
                "time_end": pts[-1].time,
                "n_points": stats.n_points,
            }
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def geotagger_track_point_at(self, lon: float, lat: float) -> dict:
        """v0.9.163 — Liefert den nächstgelegenen Punkt AUF dem Track zu einer
        geklickten/abgelegten Karten-Position (lon/lat). Für die Track-Klick-
        Anzeige + das Einrasten beim manuellen Platzieren (v0.9.166).

        v0.9.167 — projiziert jetzt auf das nächste *Segment* (Lotfußpunkt
        zwischen zwei GPX-Punkten), nicht nur auf den nächsten Vertex. Sonst saß
        der eingerastete Pin bei weit auseinanderliegenden Track-Punkten sichtbar
        NEBEN der gezeichneten Linie. Höhe + Zeit werden entlang des Segments
        interpoliert."""
        try:
            import math
            # v0.9.167 — auf die GEZEICHNETE (downsampled) Linie projizieren,
            # damit der eingerastete Pin exakt auf der sichtbaren Linie sitzt.
            track = getattr(self, "_gtg_display", None) or getattr(self, "_gtg_track", None)
            if not track:
                return {"ok": False, "error": "Kein Track geladen"}
            flat, flon = float(lat), float(lon)
            clat = math.cos(math.radians(flat))  # Längengrad-Stauchung (equirect.)
            px, py = flon * clat, flat

            # Einzelpunkt-Track: direkt zurück
            if len(track) == 1:
                p = track[0]
                d2 = (px - p.lon * clat) ** 2 + (py - p.lat) ** 2
                return {"ok": True, "lat": p.lat, "lon": p.lon, "ele": p.ele,
                        "time": p.time, "dist_m": round(math.sqrt(d2) * 111320.0, 1)}

            best = None  # (d2, lat, lon, ele, time)
            for i in range(len(track) - 1):
                a, b = track[i], track[i + 1]
                ax, ay = a.lon * clat, a.lat
                bx, by = b.lon * clat, b.lat
                abx, aby = bx - ax, by - ay
                denom = abx * abx + aby * aby
                t = 0.0 if denom == 0 else ((px - ax) * abx + (py - ay) * aby) / denom
                if t < 0.0:
                    t = 0.0
                elif t > 1.0:
                    t = 1.0
                fx, fy = ax + t * abx, ay + t * aby
                d2 = (px - fx) ** 2 + (py - fy) ** 2
                if best is not None and d2 >= best[0]:
                    continue
                # Lotfußpunkt zurück in lon/lat
                foot_lat = fy
                foot_lon = fx / clat if clat != 0 else a.lon
                # Höhe interpolieren (wenn beide Endpunkte eine haben)
                if a.ele is not None and b.ele is not None:
                    ele = a.ele + t * (b.ele - a.ele)
                else:
                    ele = (b.ele if t >= 0.5 else a.ele)
                    if ele is None:
                        ele = a.ele if a.ele is not None else b.ele
                # Zeit interpolieren (ISO-8601)
                tm = self._interp_iso_time(a.time, b.time, t)
                best = (d2, foot_lat, foot_lon, ele, tm)

            if best is None:
                return {"ok": False, "error": "Track leer"}
            dist_m = math.sqrt(best[0]) * 111320.0  # grob: 1° ≈ 111.32 km
            return {
                "ok": True,
                "lat": best[1],
                "lon": best[2],
                "ele": best[3],         # m oder None
                "time": best[4],        # ISO-8601 UTC oder None
                "dist_m": round(dist_m, 1),
            }
        except Exception as e:
            return {"ok": False, "error": str(e)}

    @staticmethod
    def _interp_iso_time(ta, tb, t: float):
        """Interpoliert zwei ISO-8601-Zeitstempel linear (für Segment-Snap).
        Fällt auf den näheren Endpunkt zurück, wenn nur einer vorhanden/parsebar."""
        if not ta and not tb:
            return None
        if not ta:
            return tb
        if not tb:
            return ta
        try:
            da = datetime.fromisoformat(str(ta).replace("Z", "+00:00"))
            db = datetime.fromisoformat(str(tb).replace("Z", "+00:00"))
            mid = da + (db - da) * t
            return mid.isoformat()
        except Exception:
            return tb if t >= 0.5 else ta

    def _photo_thumbnail_data_url(self, path: str, size: int = 220) -> Optional[str]:
        """Erzeugt ein base64-Thumbnail.
        - JPEG/TIFF: direkt mit Pillow
        - RAW: eingebettetes Preview-JPEG (via exiftool)
        - Video: erster Frame via ffmpeg
        """
        # v0.9.146: Cache-Lookup (path+mtime+size). Spart Re-Decode bei Tab-
        # Wechsel / Re-Register. mtime im Key → nach GPS-Write korrekt invalidiert.
        cache_key = None
        try:
            st = os.stat(path)
            cache_key = f"{path}|{int(st.st_mtime)}|{st.st_size}|{size}"
            cached = self._thumb_cache.get(cache_key)
            if cached is not None:
                return cached
        except Exception:
            cache_key = None
        try:
            if cexif.is_video(path):
                preview = cexif.extract_video_thumbnail(path)
                if preview is None:
                    return None
                img = Image.open(io.BytesIO(preview))
            elif cexif.is_heif(path):
                # v0.9.57 (Nutzer-Bug): HEIC via pillow-heif öffnen — kein
                # exiftool nötig. Fallback auf RAW-Preview wenn pillow-heif
                # nicht installiert (z.B. alte Bundle-Version).
                preview = cexif.extract_heif_thumbnail(path, size=size)
                if preview is not None:
                    out = "data:image/jpeg;base64," + base64.b64encode(preview).decode("ascii")
                    if cache_key:
                        self._thumb_cache[cache_key] = out
                    return out
                preview = cexif.extract_raw_preview(path)
                if preview is None:
                    return None
                img = Image.open(io.BytesIO(preview))
            elif cexif.is_raw(path):
                preview = cexif.extract_raw_preview(path)
                if preview is None:
                    return None
                img = Image.open(io.BytesIO(preview))
            else:
                img = Image.open(path)
            # v0.9.146 (Geotagger-Speed): libjpeg DCT-skaliertes Schnell-Decode.
            # `draft()` weist den JPEG-Decoder an, gleich auf ~Zielgröße herunter-
            # zudecodieren statt das Bild voll (z.B. 6000×4000) zu dekodieren und
            # erst danach zu skalieren. Muss VOR dem ersten Pixel-Zugriff stehen
            # (exif_transpose lädt) und ist für Nicht-JPEG ein No-Op.
            try:
                img.draft("RGB", (size, size))
            except Exception:
                pass
            img = ImageOps.exif_transpose(img)
            img.thumbnail((size, size), Image.LANCZOS)
            if img.mode != "RGB":
                img = img.convert("RGB")
            buf = io.BytesIO()
            img.save(buf, "JPEG", quality=78)
            out = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
            if cache_key:
                self._thumb_cache[cache_key] = out
            return out
        except Exception:
            return None

    # ── Geotagger: 2-Phasen-Loading ───────────────────────────────────────────
    #
    # Bei vielen Fotos (z.B. 200+ Wander-RAWs) dauert Thumb-Generation + EXIF-Read
    # mehrere Minuten. Statt UI dafür blockieren:
    #
    # Phase 1: `geotagger_register_photos(paths)`
    #   - validiert Pfade, filtert nach is_photo, prüft exiftool für RAWs
    #   - gibt SOFORT zurück: nur path + name + is_raw, keine Thumbs/EXIF
    #   - UI rendert leere Tiles als Platzhalter, Mode-Counter "0/N geladen"
    #
    # Phase 2: Background-Thread `_thumb_worker_run`
    #   - geht durch die Liste, liest EXIF + Thumb pro Foto
    #   - schreibt fertige Ergebnisse in `_thumb_queue_ready`
    #   - aktualisiert `_thumb_progress`
    #
    # Phase 3: UI pollt `geotagger_poll_thumbs(known_paths)` alle ~250ms
    #   - holt die noch nicht bekannten Thumb-Updates
    #   - rendert sie in die Tiles ein

    def geotagger_get_state(self) -> dict:
        """v0.9.28 (Marc-Feedback): liefert den aktuellen Geotagger-State
        damit das Frontend beim Tab-Wechsel sofort wieder das vorherige
        Bild zeigen kann — Thumbs/EXIF müssen NICHT neu generiert werden,
        weil `_gtg_photos` im Memory bleibt zwischen Module-Mounts.

        Returns:
            {"ok": True, "has_state": bool,
             "photos": [...] mit thumb/photo_time/existing_gps/is_raw/is_video,
             "thumb_progress": {total, done, running}}
        """
        try:
            has_photos = len(self._gtg_photos) > 0
            return {
                "ok": True,
                "has_state": has_photos,
                "photos": [dict(p) for p in self._gtg_photos] if has_photos else [],
                "thumb_progress": dict(self._thumb_progress),
            }
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def geotagger_clear(self) -> dict:
        """Workspace-Clear: GPX-Track + Stats + alle registrierten Fotos
        zurücksetzen. Settings (Offset, Backup-Toggle etc.) bleiben unverändert.

        v0.9.31: zusätzlich `_thumb_queue_ready` clearen + `_thumb_progress`
        komplett zurücksetzen damit ein nachfolgender Foto-Pick saubere
        Start-Werte hat (sonst zeigt der nächste pollThumbs noch alte
        progress.done/total-Werte).
        """
        try:
            # Falls Thumbnail-Worker noch läuft → höflich stoppen
            with self._thumb_lock:
                if self._thumb_progress.get("running"):
                    self._thumb_progress["running"] = False
                # Queue + Progress komplett zurücksetzen
                self._thumb_queue_ready.clear()
                self._thumb_progress = {"total": 0, "done": 0, "running": False}
            self._gtg_track = []
            self._gtg_display = []
            self._gtg_stats = None
            self._gtg_photos = []
            # v0.9.190: exiftool-Daemons beim Session-Reset herunterfahren, damit
            # kein `-stay_open`-Prozess idle weiterläuft (und bei einem späteren
            # harten App-Quit verwaisen könnte). Re-Spawn passiert lazy beim
            # nächsten Foto-Pick (~0.5 s), kostet also praktisch nichts.
            try:
                cexif._ExifToolDaemon.shutdown()
            except Exception:
                pass
            log.info("geotagger_clear: Workspace geleert (Worker stopped, queue cleared, exiftool-Daemon beendet)")
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def geotagger_register_photos(self, paths: list[str]) -> dict:
        """Phase 1: schneller Scan, Backend startet Background-Thread für Phase 2."""
        try:
            # Falls ein vorheriger Worker noch läuft, höflich um Stop bitten
            if self._thumb_progress.get("running"):
                self._thumb_progress["running"] = False
                if self._thumb_worker and self._thumb_worker.is_alive():
                    self._thumb_worker.join(timeout=2)

            with self._thumb_lock:
                self._thumb_queue_ready.clear()

            # v0.9.176 (Nutzer-Feedback): Fotos ERGÄNZEN statt ersetzen + nach
            # Pfad deduplizieren. So fügt jeder Drop/Pick zur bestehenden Liste
            # hinzu (Entfernen geht via ✕/Backspace, Leeren via Workspace-✕).
            existing_paths = {p.get("path") for p in (self._gtg_photos or [])}
            registered = []          # nur die NEUEN Einträge
            skipped_no_exiftool = 0
            skipped_dupes = 0
            for p in paths:
                if not os.path.exists(p):
                    continue
                if not cexif.is_media(p):
                    continue
                if p in existing_paths:        # schon in der Liste → überspringen
                    skipped_dupes += 1
                    continue
                # RAW + Video brauchen beide exiftool
                needs_et = cexif.is_raw(p) or cexif.is_video(p)
                if needs_et and not cexif.find_exiftool():
                    skipped_no_exiftool += 1
                    continue
                existing_paths.add(p)
                registered.append({
                    "path": p,
                    "name": os.path.basename(p),
                    "is_raw": cexif.is_raw(p),
                    "is_video": cexif.is_video(p),
                })

            # Neue Platzhalter an die bestehende Liste ANHÄNGEN.
            self._gtg_photos = (self._gtg_photos or []) + [
                {**r, "photo_time": None, "photo_time_local": None, "existing_gps": None, "thumb": None, "camera": None, "tz_known": False}
                for r in registered
            ]

            with self._thumb_lock:
                self._thumb_progress = {
                    "total": len(registered),
                    "done": 0,
                    "running": len(registered) > 0,
                }

            # Worker nur für die NEUEN Pfade starten
            if registered:
                self._thumb_worker = threading.Thread(
                    target=self._thumb_worker_run,
                    args=([r["path"] for r in registered],),
                    daemon=True,
                )
                self._thumb_worker.start()

            return {
                "ok": True,
                "photos": list(self._gtg_photos),   # VOLLE Liste (alt + neu)
                "added": len(registered),
                "warning": (f"{skipped_no_exiftool} RAW-Datei(en) übersprungen — "
                            "ExifTool nicht gefunden. (macOS: 'brew install exiftool')")
                            if skipped_no_exiftool else None,
            }
        except Exception as e:
            return {"ok": False, "error": str(e), "trace": traceback.format_exc()}

    def geotagger_remove_photos(self, paths: list[str]) -> dict:
        """v0.9.164 — Entfernt Fotos aus dem Geotagger-Foto-State (Liste-
        Entfernen via ✕/Backspace). Tagged/verändert NICHTS an den Dateien,
        nimmt sie nur aus Liste + Match raus."""
        try:
            rm = set(paths or [])
            before = len(getattr(self, "_gtg_photos", []) or [])
            self._gtg_photos = [p for p in (self._gtg_photos or []) if p.get("path") not in rm]
            with self._thumb_lock:
                for p in rm:
                    self._thumb_queue_ready.pop(p, None)
            return {"ok": True, "removed": before - len(self._gtg_photos)}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def _read_meta_fast(self, path: str) -> tuple[Optional[datetime], Optional[dict], Optional[str], bool, Optional[int]]:
        """Liest DateTime + GPS + Kamera-Modell in EINEM Call (für RAW/Video:
        nutzt den Daemon). Gibt (datetime, gps_dict|None, camera|None, tz_known,
        tz_minutes) zurück. tz_known=True → die Foto-Zeit hatte einen eingebetteten
        Zeitzonen-Offset und ist bereits UTC (manuelle TZ-Auswahl gilt dann nicht).
        tz_minutes = roher Offset in Minuten (für die Lokalzeit-Anzeige, v0.9.361)."""
        if cexif.is_video(path):
            try:
                meta = cexif._exiftool_read_video_meta(path)
                gps = None
                if meta["lat"] is not None and meta["lon"] is not None:
                    gps = {"lat": meta["lat"], "lon": meta["lon"], "alt": meta["alt"]}
                return meta["datetime"], gps, meta.get("camera"), meta.get("tz_minutes") is not None, meta.get("tz_minutes")
            except Exception:
                return None, None, None, False, None
        if cexif.is_raw(path):
            try:
                meta = cexif._exiftool_read_meta(path)
                gps = None
                if meta["lat"] is not None and meta["lon"] is not None:
                    gps = {"lat": meta["lat"], "lon": meta["lon"], "alt": meta["alt"]}
                return meta["datetime"], gps, meta.get("camera"), meta.get("tz_minutes") is not None, meta.get("tz_minutes")
            except Exception:
                return None, None, None, False, None
        # JPEG/TIFF: piexif ist eh schon schnell, kein Daemon
        dt, tz_min = cexif.read_datetime_and_tz_min(path)
        gps_tuple = cexif.read_gps(path)
        gps = ({"lat": gps_tuple[0], "lon": gps_tuple[1], "alt": gps_tuple[2]}
               if gps_tuple else None)
        camera = cexif.read_camera(path)
        return dt, gps, camera, tz_min is not None, tz_min

    def _thumb_one(self, p: str) -> None:
        """Ein Foto: EXIF + Thumb generieren und in die Queue legen.
        Wird parallel aus dem Worker-Pool aufgerufen."""
        # Cancellation: wenn _thumb_progress.running auf False gesetzt, gleich raus
        with self._thumb_lock:
            if not self._thumb_progress.get("running"):
                return
        try:
            dt, gps, camera, tz_known, tz_min = self._read_meta_fast(p)
            thumb = self._photo_thumbnail_data_url(p)
            # v0.9.361 — Original-Kamera-Lokalzeit (Wanduhr) für die Anzeige; photo_time
            # bleibt UTC fürs Track-Matching.
            local_dt = cexif.local_datetime_from_utc(dt, tz_min)
            data = {
                "photo_time": dt.isoformat() if dt else None,
                "photo_time_local": local_dt.isoformat() if local_dt else None,
                "existing_gps": gps,
                "thumb": thumb,
                "camera": camera,      # v0.9.164 — Kamera-Modell
                "tz_known": tz_known,  # v0.9.177 — eingebetteter TZ-Offset?
            }
        except Exception as e:
            data = {"photo_time": None, "photo_time_local": None, "existing_gps": None,
                    "thumb": None, "camera": None, "tz_known": False, "error": str(e)}
        with self._thumb_lock:
            self._thumb_queue_ready[p] = data
            self._thumb_progress["done"] = self._thumb_progress.get("done", 0) + 1
            # Auch im Photo-State aktualisieren, damit match-Logik konsistent ist.
            # (Felder einzelner Items setzen — die Liste selbst wird nicht mutiert.)
            for ph in self._gtg_photos:
                if ph.get("path") == p:
                    ph["photo_time"] = data["photo_time"]
                    ph["photo_time_local"] = data["photo_time_local"]
                    ph["existing_gps"] = data["existing_gps"]
                    ph["thumb"] = data["thumb"]
                    ph["camera"] = data["camera"]
                    ph["tz_known"] = data.get("tz_known", False)
                    break

    def _thumb_worker_run(self, paths: list[str]) -> None:
        """Background-Thread: Thumbs + EXIF PARALLEL erzeugen (v0.9.358).
        Die Einzel-Calls sind latenz-gebunden (exiftool-Round-Trip, Datei-IO),
        nicht CPU-gebunden — ein kleiner Thread-Pool überlappt das Warten und
        macht das Laden ~10× schneller. exiftool-Daemon + PIL geben den GIL
        währenddessen frei, also bleibt die pywebview-Main-Loop responsiv."""
        import concurrent.futures
        n_workers = max(2, min(4, (os.cpu_count() or 4) - 1))
        try:
            with concurrent.futures.ThreadPoolExecutor(max_workers=n_workers) as ex:
                futures = [ex.submit(self._thumb_one, p) for p in paths]
                for _f in concurrent.futures.as_completed(futures):
                    # Abbruch (Session schließen / neuer Load) → keine neuen Tasks mehr
                    # rechnen lassen; bereits gestartete laufen kurz aus.
                    with self._thumb_lock:
                        if not self._thumb_progress.get("running"):
                            break
        finally:
            with self._thumb_lock:
                self._thumb_progress["running"] = False

    def geotagger_poll_thumbs(self, known_paths: Optional[list[str]] = None) -> dict:
        """Phase 3: liefert nur die noch nicht bekannten Thumbnail-Ergebnisse + Fortschritt.

        `known_paths`: Liste der Pfade die das UI schon hat → werden ausgespart.
        """
        try:
            known = set(known_paths or [])
            with self._thumb_lock:
                deltas = {p: data for p, data in self._thumb_queue_ready.items() if p not in known}
                prog = dict(self._thumb_progress)
            return {"ok": True, "deltas": deltas, "progress": prog}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    # ── Geotagger: vollständiger Sync-Load (Fallback + interner Use) ────────

    def geotagger_load_photos(self, paths: list[str]) -> dict:
        """Lädt mehrere Foto-Pfade, gibt Liste mit Thumb + Time + existierender GPS-Info zurück.
        Unterstützt JPEG/TIFF und RAW (CR3, NEF, ARW, RAF, DNG, HEIC, …)."""
        try:
            out = []
            skipped_no_exiftool = 0
            for p in paths:
                if not os.path.exists(p):
                    continue
                if not cexif.is_media(p):
                    continue
                needs_et = cexif.is_raw(p) or cexif.is_video(p)
                if needs_et and not cexif.find_exiftool():
                    skipped_no_exiftool += 1
                    continue
                dt, tz_min = cexif.read_datetime_and_tz_min(p)
                local_dt = cexif.local_datetime_from_utc(dt, tz_min)
                gps = cexif.read_gps(p)
                thumb = self._photo_thumbnail_data_url(p)
                out.append({
                    "path": p,
                    "name": os.path.basename(p),
                    "photo_time": dt.isoformat() if dt else None,
                    "photo_time_local": local_dt.isoformat() if local_dt else None,
                    "existing_gps": ({"lat": gps[0], "lon": gps[1], "alt": gps[2]} if gps else None),
                    "thumb": thumb,
                    "is_raw": cexif.is_raw(p),
                    "is_video": cexif.is_video(p),
                    "tz_known": tz_min is not None,
                })
            self._gtg_photos = out
            result = {"ok": True, "photos": out}
            if skipped_no_exiftool:
                result["warning"] = (
                    f"{skipped_no_exiftool} RAW-Dateien übersprungen — "
                    "exiftool fehlt. Installiere: 'brew install exiftool'"
                )
            return result
        except Exception as e:
            return {"ok": False, "error": str(e), "trace": traceback.format_exc()}

    def geotagger_load_photos_from_folder(self, folder: str, recursive: bool = False) -> dict:
        """Wie geotagger_register_photos, aber findet die Dateien selbst im Ordner.
        Unterstützt Fotos UND Videos.

        v0.9.27 (Nutzer-Feedback): `recursive=True` durchsucht Unterordner
        mit Tiefen-Limit 3 (Performance-Schutz). Default off.
        """
        try:
            files = []
            if recursive:
                # Path.rglob mit Tiefen-Limit 3 — verhindert dass wer aus
                # Versehen sein ganzes /Pictures-Verzeichnis durchscannt
                base = Path(folder)
                base_depth = len(base.parts)
                for p in base.rglob("*"):
                    if not p.is_file():
                        continue
                    rel_depth = len(p.parts) - base_depth
                    if rel_depth > 3:
                        continue
                    if cexif.is_media(str(p)):
                        files.append(str(p))
                files.sort()
            else:
                for entry in sorted(os.listdir(folder)):
                    full = os.path.join(folder, entry)
                    if cexif.is_media(full):
                        files.append(full)
            return self.geotagger_register_photos(files)
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def geotagger_find_gpx_near(self, folder: str) -> dict:
        """v0.9.27 (Nutzer-Feedback): sucht nach .gpx-Dateien in der Nähe
        eines Foto-Ordners. Reihenfolge:
          1. `folder/*.gpx`
          2. `folder/../*.gpx`           (z.B. Bilder in Jahr-Monat-Tag/jpeg/,
                                          GPX auf Datums-Ebene)
          3. Geschwister-Ordner mit *.gpx (`folder/../<sib>/*.gpx`)

        Gibt Liste der Treffer (max. 10) mit Pfad + Name + mtime + size zurück.
        UI entscheidet dann: 0 Treffer = Toast, 1 = direkt anbieten, >1 = Modal.
        """
        try:
            base = Path(folder)
            if not base.exists() or not base.is_dir():
                return {"ok": False, "error": "Kein gültiger Ordner"}

            seen: set[str] = set()
            results: list[dict] = []

            def _collect(path: Path):
                if str(path) in seen:
                    return
                seen.add(str(path))
                try:
                    if path.suffix.lower() == ".gpx" and path.is_file():
                        st = path.stat()
                        results.append({
                            "path": str(path),
                            "name": path.name,
                            "mtime": st.st_mtime,
                            "size": st.st_size,
                        })
                except Exception:
                    pass

            # 1) Im Ordner selbst
            try:
                for entry in sorted(base.iterdir()):
                    if entry.suffix.lower() == ".gpx" and entry.is_file():
                        _collect(entry)
            except PermissionError:
                pass

            # 2) Parent-Ordner
            parent = base.parent
            if parent != base:
                try:
                    for entry in sorted(parent.iterdir()):
                        if entry.suffix.lower() == ".gpx" and entry.is_file():
                            _collect(entry)
                except PermissionError:
                    pass

                # 3) Geschwister-Ordner — nur eine Ebene tief scannen,
                # damit wir bei /Volumes/Photos/2026-03-17/jpeg/ auch das
                # GPX in /Volumes/Photos/2026-03-17/tracks/ finden
                try:
                    for sib in sorted(parent.iterdir()):
                        if sib == base or not sib.is_dir():
                            continue
                        try:
                            for entry in sib.iterdir():
                                if entry.suffix.lower() == ".gpx" and entry.is_file():
                                    _collect(entry)
                        except PermissionError:
                            continue
                except PermissionError:
                    pass

            # Sortierung: erst nach Lokation (selber Ordner zuerst),
            # dann nach mtime absteigend (neueste zuerst)
            base_str = str(base)
            parent_str = str(parent)
            def _rank(r):
                p = str(Path(r["path"]).parent)
                if p == base_str: return 0
                if p == parent_str: return 1
                return 2
            results.sort(key=lambda r: (_rank(r), -r["mtime"]))

            return {"ok": True, "matches": results[:10]}
        except Exception as e:
            return {"ok": False, "error": str(e), "trace": traceback.format_exc()}

    def _build_offset_by_path(self, cam_offsets) -> dict:
        """v0.9.354 — baut aus {Kamera: Offset-Sekunden} eine {Pfad: Offset}-Map für
        die aktuell geladenen Fotos. Kamera-Key '—' für Fotos ohne Modell (wie im UI)."""
        out: dict = {}
        if not isinstance(cam_offsets, dict) or not cam_offsets:
            return out
        for p in self._gtg_photos:
            cam = p.get("camera") or "—"
            if cam in cam_offsets:
                try:
                    out[p["path"]] = float(cam_offsets[cam])
                except (TypeError, ValueError):
                    pass
        return out

    def _build_ignore_gps_paths(self, ignore_gps_default, cam_ignore_gps) -> set:
        """v0.9.364 — Menge der Foto-Pfade, deren eingebettetes GPS IGNORIERT werden
        soll (→ Position nach Aufnahmezeit aus dem Track). Pro Kamera: Override aus
        `cam_ignore_gps` (Kamera→bool), sonst der globale Default `ignore_gps_default`.
        Kamera-Key '—' für Fotos ohne Modell (wie im UI)."""
        out: set = set()
        cig = cam_ignore_gps if isinstance(cam_ignore_gps, dict) else {}
        for p in self._gtg_photos:
            cam = p.get("camera") or "—"
            eff = bool(cig[cam]) if cam in cig else bool(ignore_gps_default)
            if eff:
                out.add(p["path"])
        return out

    def _build_set_time_paths(self, set_time_default, cam_set_time) -> set:
        """v0.9.370 — Menge der Foto-Pfade, deren Aufnahmezeit (DateTimeOriginal) auf
        die getroffene Track-Zeit gesetzt werden soll. Pro Kamera: Override aus
        `cam_set_time` (Kamera→bool), sonst der globale Default `set_time_default`.
        Kamera-Key '—' für Fotos ohne Modell (wie im UI). Analog zu
        `_build_ignore_gps_paths`."""
        out: set = set()
        cst = cam_set_time if isinstance(cam_set_time, dict) else {}
        for p in self._gtg_photos:
            cam = p.get("camera") or "—"
            eff = bool(cst[cam]) if cam in cst else bool(set_time_default)
            if eff:
                out.add(p["path"])
        return out

    def geotagger_match(self, offset_seconds: float = 0.0, max_gap_seconds: float = 600.0,
                        tz_offset_minutes: float = 0.0, cam_offsets=None,
                        ignore_gps: bool = False, cam_ignore_gps=None) -> dict:
        """Berechnet die GPS-Position für jedes geladene Foto basierend auf Offset.

        tz_offset_minutes (v0.9.177): Zeitzone der Kamera-Uhr (UTC±, in Minuten).
        Wird nur auf Fotos angewandt, deren EXIF-Zeit KEINEN eingebetteten Offset
        hatte (`tz_known=False`) — so bleibt ein gemischter Batch (Handy mit TZ +
        Olympus ohne TZ) korrekt."""
        try:
            if not self._gtg_track or not self._gtg_photos:
                return {"ok": False, "error": "Track oder Fotos noch nicht geladen"}
            phs = [(p["path"],
                    datetime.fromisoformat(p["photo_time"]) if p["photo_time"] else None)
                   for p in self._gtg_photos]
            tz_known_paths = {p["path"] for p in self._gtg_photos if p.get("tz_known")}
            offset_by_path = self._build_offset_by_path(cam_offsets)
            matches = cgeo.match_photos(phs, self._gtg_track,
                                        offset_seconds=offset_seconds,
                                        max_gap_seconds=max_gap_seconds,
                                        tz_offset_seconds=float(tz_offset_minutes) * 60.0,
                                        tz_known_paths=tz_known_paths,
                                        offset_by_path=offset_by_path)
            # v0.9.364 — Kameras, deren eigenes Foto-GPS ignoriert werden soll (→ Zeit).
            ignore_gps_paths = self._build_ignore_gps_paths(ignore_gps, cam_ignore_gps)
            out = []
            for p, m in zip(self._gtg_photos, matches):
                # v0.9.339 — Hat das Foto schon eigenes GPS, hat DAS Vorrang vor der
                # Zeit-Zuordnung: Position = eigenes GPS, immer „platzierbar". Die
                # Zeit-Zuordnung (track_index, matched_time) bleibt nur als Info für
                # Richtung/Lichtstempel erhalten.
                # v0.9.364 — ES SEI DENN, diese Kamera ist auf „GPS ignorieren" → dann
                # bleibt die zeit-gematchte Track-Position (m.lat/lon aus match_photos),
                # und das Foto gilt als „kein eigenes GPS" (für Anzeige + Schreiben).
                eg = p.get("existing_gps")
                ignore = p["path"] in ignore_gps_paths
                pos_src = "track"
                if eg and not ignore and eg.get("lat") is not None and eg.get("lon") is not None:
                    m.lat = eg["lat"]
                    m.lon = eg["lon"]
                    if eg.get("alt") is not None:
                        m.alt = eg["alt"]
                    m.in_range = True
                    pos_src = "exif"
                d = {
                    "path": p["path"],
                    "name": p["name"],
                    "camera": p.get("camera"),   # v0.9.370 — für Pro-Kamera-Zählung im UI
                    "photo_time": p["photo_time"],
                    "photo_time_local": p.get("photo_time_local"),   # v0.9.361 — Anzeige
                    "matched_time_utc": m.matched_time_utc.isoformat() if m.matched_time_utc else None,
                    "lat": m.lat, "lon": m.lon, "alt": m.alt,
                    "track_index": m.track_index,
                    "time_delta_s": m.time_delta_s,
                    "in_range": m.in_range,
                    # Bei „GPS ignorieren" so behandeln, als hätte das Foto kein eigenes
                    # GPS → Track-Koordinaten werden auch tatsächlich geschrieben.
                    "existing_gps": None if ignore else p["existing_gps"],
                    "pos_src": pos_src,
                    "gps_ignored": ignore,   # v0.9.364 — für Anzeige/Badge
                }
                # v0.9.333 — Lichtstempel + Blickrichtung (Sonnenstand aus GPS+Zeit,
                # Kamerarichtung aus EXIF oder Bewegung). Nur für echte Treffer.
                self._enrich_geotag(d, p, m)
                out.append(d)
            return {"ok": True, "matches": out}
        except Exception as e:
            return {"ok": False, "error": str(e), "trace": traceback.format_exc()}

    def _enrich_geotag(self, d: dict, p: dict, m) -> None:
        """v0.9.333 — hängt Lichtstempel (Sonnenstand) + Blickrichtung an einen Match.
        Richtung: EXIF-Kamerakurs (GPSImgDirection) bevorzugt, sonst Bewegungsrichtung
        aus den Track-Nachbarpunkten. Logik in core/sun.py (gespiegelt vom Web-Tool)."""
        try:
            if m.lat is None or m.lon is None or not m.in_range or m.matched_time_utc is None:
                return
            # Kamerarichtung (EXIF, lazy gecached) ODER Bewegungsrichtung
            if "img_dir" not in p:
                try:
                    p["img_dir"] = cexif.read_img_direction(p["path"])
                except Exception:
                    p["img_dir"] = None
            # Priorität: 1) Kamera-EXIF (GPSImgDirection), 2) geloggte Blickrichtung
            # aus dem Reisezoom-Logger (rz:hdg → extra["heading"], true north),
            # 3) Bewegungsrichtung aus den Track-Nachbarpunkten (Schätzung).
            direction, dsrc = p.get("img_dir"), None
            if direction is not None:
                dsrc = "exif"
            elif m.track_index is not None and self._gtg_track:
                tr = self._gtg_track
                i = m.track_index
                logged = None
                if 0 <= i < len(tr):
                    logged = tr[i].extra.get("heading")
                if logged is not None:
                    try:
                        direction = float(logged) % 360.0
                        dsrc = "logged"
                    except (TypeError, ValueError):
                        direction = None
                if direction is None:
                    if i + 1 < len(tr) and (tr[i + 1].lat != tr[i].lat or tr[i + 1].lon != tr[i].lon):
                        direction = csun.bearing(tr[i].lat, tr[i].lon, tr[i + 1].lat, tr[i + 1].lon)
                        dsrc = "move"
                    elif i - 1 >= 0 and (tr[i - 1].lat != tr[i].lat or tr[i - 1].lon != tr[i].lon):
                        direction = csun.bearing(tr[i - 1].lat, tr[i - 1].lon, tr[i].lat, tr[i].lon)
                        dsrc = "move"
            # Sonnenstand → Lichtphase
            alt, az = csun.sun_position(m.matched_time_utc, m.lat, m.lon)
            d["sun_alt"] = round(alt, 1)
            d["light_phase"] = csun.light_phase(alt)
            if direction is not None:
                d["dir"] = round(direction)
                d["dir_src"] = dsrc
                if alt > -4:  # Sonne über/knapp unter Horizont → Lichtrichtung sinnvoll
                    d["light_vs_dir"] = csun.light_vs_dir(az, direction)
        except Exception:
            pass

    def geotagger_compute_offset_from_reference(self, photo_path: str, ref_lat: float, ref_lon: float) -> dict:
        """User hat ein Foto + dazu den Karten-Klick wo es tatsächlich war.
        → Offset berechnen, der angewendet werden muss."""
        try:
            if not self._gtg_track:
                return {"ok": False, "error": "Track noch nicht geladen"}
            ph = next((p for p in self._gtg_photos if p["path"] == photo_path), None)
            if not ph or not ph["photo_time"]:
                return {"ok": False, "error": "Foto hat keine EXIF-Zeit"}
            pt = datetime.fromisoformat(ph["photo_time"])
            off = cgeo.derive_offset_from_reference(pt, ref_lat, ref_lon, self._gtg_track)
            return {"ok": True, "offset_seconds": off,
                    "human": _format_offset(off)}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    # ── Geotagger: Reverse-Geocoding (Adresse) ───────────────────────────────
    #
    # Nominatim drosselt auf ~1 Anfrage/Sekunde → Background-Thread + Polling,
    # damit die UI nicht einfriert. Ergebnisse pro Pfad als Adress-Dict.

    def geotagger_reverse_geocode_start(self, items: list[dict], lang: str = "de") -> dict:
        """Startet das Adress-Lookup für `items` ([{path, lat, lon}]) als 3-Stufen-
        Pyramide im Hintergrund: Schwerpunkt→Land (1 Call), ~1-km-Cluster→Ort,
        ~60-m-Cluster→Straße. So sind alle Fotos nach wenigen Calls grob gefüllt,
        die Straße tröpfelt nach. Anbieter/an-aus kommen aus den Settings."""
        s = _load_settings()
        if not s.get("geocode_enabled", True):
            return {"ok": False, "error": "Adress-Suche ist in den Einstellungen deaktiviert",
                    "disabled": True}
        raw_token = (s.get("mapbox_token") or "").strip()  # bewusst unabhängig von force_osm (= nur Karten-Tiles)
        provider = cgeocode.resolve_provider(s.get("geocode_provider", "auto"), raw_token)
        if not provider:
            return {"ok": False, "error": "Kein Adress-Anbieter aktiv", "disabled": True}

        with self._geo_lock:
            if self._geo_state.get("running"):
                return {"ok": False, "error": "Adress-Lookup läuft bereits"}
            todo = [it for it in (items or [])
                    if it.get("lat") is not None and it.get("lon") is not None and it.get("path")]
            if not todo:
                return {"ok": False, "error": "Keine Fotos mit Koordinaten"}
            gen = self._geo_gen = self._geo_gen + 1 if hasattr(self, "_geo_gen") else 1
            # Call-Plan vorab zählen für die Fortschrittsanzeige
            pts = [(i, float(it["lat"]), float(it["lon"])) for i, it in enumerate(todo)]
            cells_city = cgeocode.cluster(pts, 1000.0)
            cells_street = cgeocode.cluster(pts, 60.0)
            total_calls = 1 + len(cells_city) + len(cells_street)
            self._geo_state = {"running": True, "total": total_calls, "done": 0,
                               "completed": False, "results": {}, "provider": provider}

        def _superseded():
            return getattr(self, "_geo_gen", gen) != gen

        def _rev(lat, lon, zoom):
            return cgeocode.reverse(lat, lon, provider=provider, mapbox_token=raw_token,
                                    lang=lang, zoom=zoom)

        def _bump(results):
            with self._geo_lock:
                self._geo_state["done"] = self._geo_state.get("done", 0) + 1
                self._geo_state["results"] = {p: dict(a) for p, a in results.items()}

        def _overlay(results, member_idxs, addr, fields):
            if not addr:
                return
            for idx in member_idxs:
                path = todo[idx]["path"]
                dst = results.setdefault(path, {})
                for f in fields:
                    v = addr.get(f)
                    if v:
                        dst[f] = v
                dst["country_code"] = addr.get("country_code", dst.get("country_code", ""))
                dst["display"] = ", ".join(x for x in (
                    dst.get("street"),
                    (f'{dst.get("postcode","")} {dst.get("city","")}'.strip() if dst.get("postcode") else dst.get("city")),
                    dst.get("country")) if x and x.strip())

        def _run():
            results: dict = {}
            try:
                # Stufe 0 — Land/Region (1 Call auf den Schwerpunkt aller Fotos)
                clat = sum(p[1] for p in pts) / len(pts)
                clon = sum(p[2] for p in pts) / len(pts)
                _overlay(results, [p[0] for p in pts], _rev(clat, clon, 5),
                         ["country", "state"])
                _bump(results)
                if _superseded():
                    return
                # Stufe 1 — Ort (1 Call je ~1-km-Cluster)
                for c in cells_city.values():
                    if _superseded():
                        return
                    _overlay(results, c["members"], _rev(c["lat"], c["lon"], 10),
                             ["city", "state", "country", "postcode"])
                    _bump(results)
                # Stufe 2 — Straße (1 Call je ~60-m-Cluster)
                for c in cells_street.values():
                    if _superseded():
                        return
                    _overlay(results, c["members"], _rev(c["lat"], c["lon"], 18),
                             ["street", "postcode", "city", "state", "country"])
                    _bump(results)
            except Exception:
                log.exception("reverse_geocode-Pyramide fehlgeschlagen")
            finally:
                with self._geo_lock:
                    if not _superseded():
                        self._geo_state["running"] = False
                        self._geo_state["completed"] = True
                log.info("reverse_geocode (%s): fertig, %d Adressen", provider, len(results))

        self._geo_worker = threading.Thread(target=_run, daemon=True)
        self._geo_worker.start()
        return {"ok": True, "total": total_calls, "provider": provider}

    def geotagger_reverse_geocode_status(self) -> dict:
        """Polling-Endpoint für das Adress-Lookup."""
        with self._geo_lock:
            return dict(self._geo_state)

    def geotagger_photo_exif(self, path: str) -> dict:
        """v0.9.341 — Volle EXIF-Daten eines Fotos für die Karten-Vorschau
        (Info-Tab Key-Felder + EXIF-Tab mit allen Tags). v0.9.343: `readonly`-Liste
        markiert nicht-editierbare (abgeleitete/Datei-)Tags fürs Frontend."""
        try:
            d = cexif.read_photo_details(path)
            ro = [k for k in (d.get("all") or {}) if not cexif.exif_tag_writable(k)]
            return {"ok": True, "readonly": ro, **d}
        except Exception as e:
            log.exception("geotagger_photo_exif fehlgeschlagen: %s", path)
            return {"ok": False, "error": str(e), "key": {}, "all": {}, "readonly": []}

    # ── Auto-Tag / Bilderkennung (Apple Vision, nur macOS) ─────────────────
    def autotag_available(self) -> bool:
        """True, wenn die Bilderkennung auf diesem System läuft (macOS + Vision)."""
        try:
            return bool(cautotag.is_available())
        except Exception:
            return False

    def geotagger_autotag_start(self, paths: list, max_tags: int = 8,
                                min_conf: float = 0.25) -> dict:
        """Startet die Bilderkennung für `paths` in einem Hintergrund-Thread.
        Ergebnisse (path → [keyword,…]) werden per `geotagger_autotag_status`
        abgeholt. Nur macOS — sonst {ok:False}."""
        if not self.autotag_available():
            return {"ok": False, "error": "Bilderkennung nur auf macOS verfügbar"}
        with self._autotag_lock:
            if self._autotag_state.get("running"):
                return {"ok": False, "error": "Bilderkennung läuft bereits"}
        items = [p for p in (paths or []) if p]
        if not items:
            return {"ok": False, "error": "Keine Fotos"}
        with self._autotag_lock:
            self._autotag_state = {"running": True, "total": len(items), "done": 0,
                                   "completed": False, "cancel": False,
                                   "results": {}, "error": ""}
        # v0.9.357 — Stichwort-Sprache folgt der App-Sprache (de/en/es).
        _lang = ci18n.resolve(_load_settings().get("language", "auto") or "auto")
        self._autotag_worker = threading.Thread(
            target=self._autotag_worker_run, args=(items, int(max_tags), float(min_conf), _lang),
            daemon=True)
        self._autotag_worker.start()
        log.info("geotagger_autotag_start: %d Fotos", len(items))
        return {"ok": True, "total": len(items)}

    def _autotag_worker_run(self, items: list, max_tags: int, min_conf: float,
                            lang: str = "de") -> None:
        for idx, path in enumerate(items):
            with self._autotag_lock:
                if self._autotag_state.get("cancel"):
                    break
            try:
                kws = cautotag.suggest_keywords(path, max_tags=max_tags,
                                                min_conf=min_conf, lang=lang)
            except Exception as e:
                kws = []
                log.exception("autotag: %s fehlgeschlagen", path)
                with self._autotag_lock:
                    self._autotag_state["error"] = str(e)
            with self._autotag_lock:
                if kws:
                    self._autotag_state["results"][path] = kws
                self._autotag_state["done"] = idx + 1
        with self._autotag_lock:
            self._autotag_state["running"] = False
            self._autotag_state["completed"] = True
        log.info("autotag: fertig — %d/%d mit Tags",
                 len(self._autotag_state.get("results", {})), len(items))

    def geotagger_autotag_status(self) -> dict:
        with self._autotag_lock:
            return dict(self._autotag_state)

    def geotagger_autotag_cancel(self) -> dict:
        with self._autotag_lock:
            if self._autotag_state.get("running"):
                self._autotag_state["cancel"] = True
                return {"ok": True}
            return {"ok": False}

    def geotagger_write_exif_tag(self, path: str, tag: str, value: str) -> dict:
        """v0.9.343 — Ein EXIF-Feld direkt aus der Vorschau editieren. Schreibt den
        Wert ins Foto und liefert die frisch gelesenen EXIF-Daten zurück."""
        try:
            cexif.write_exif_tag(path, tag, value)
            d = cexif.read_photo_details(path)
            ro = [k for k in (d.get("all") or {}) if not cexif.exif_tag_writable(k)]
            return {"ok": True, "readonly": ro, **d}
        except Exception as e:
            log.exception("geotagger_write_exif_tag fehlgeschlagen: %s %s", path, tag)
            return {"ok": False, "error": str(e)}

    # ── Geotagger: Async-Write ───────────────────────────────────────────────
    #
    # Schreiben war ein Blocker: bei vielen RAWs ohne Daemon ~1 s pro Foto.
    # Mit Daemon ~100 ms, aber UI darf trotzdem nicht hängen.
    # → Background-Thread + Polling.

    def geotagger_start_write(self, matches: list[dict],
                              make_backup: bool = True,
                              overwrite_existing: bool = False,
                              adjust_photo_time: bool = False,
                              offset_seconds: float = 0.0,
                              set_time_from_track: bool = False,
                              write_fields: Optional[dict] = None,
                              write_mode: str = "",
                              exif_edits: Optional[dict] = None,
                              cam_offsets=None,
                              cam_set_time_from_track=None,
                              dest_dir: str = "",
                              overwrite_originals: bool = False) -> dict:
        """Startet den Schreibvorgang in einem Background-Thread.
        - `dest_dir` (v0.9.372): Zielordner. Neues Modell — Originale werden NIE
          angefasst; alle getaggten Fotos landen als KOPIEN in `dest_dir` (die
          Originale sind damit selbst das Backup, kein ZIP mehr). Leer = Legacy-
          In-Place (nur noch interner Fallback).
        - `overwrite_originals` (v0.9.372): Nur wenn der Nutzer bewusst den Ordner
          seiner Originale als Ziel wählt → dann wird dort in-place getaggt (ohne
          Backup). Frontend fragt das vorher ab; ohne Bestätigung überspringt der
          Worker Fotos, die aufs eigene Original fallen würden.
        - `write_mode` (v0.9.339): 'fill' = vorhandene Werte behalten, nur Fehlendes
          ergänzen (Default); 'overwrite' = alles überschreiben; 'skip_existing' =
          Fotos mit vorhandenem GPS ganz auslassen. Leer → aus `overwrite_existing`
          abgeleitet (True→overwrite, sonst fill).
        - `matches`: Liste mit {path, lat, lon, alt, matched_time_utc, existing_gps?, manual?}
        - `make_backup`: vorher ZIP-Backup der Fotos
        - `overwrite_existing`: True = auch Fotos mit bereits gesetzten GPS-Tags überschreiben
        - `adjust_photo_time`: zusätzlich DateTimeOriginal um `offset_seconds` verschieben
        - `offset_seconds`: Wert wird auf alle Foto-Aufnahmezeiten addiert
        - `set_time_from_track` / `cam_set_time_from_track`: (v0.9.281, erweitert v0.9.370)
          die (lokale) Track-Zeit des getroffenen Punkts als Aufnahmezeitpunkt
          (DateTimeOriginal) setzen. Seit v0.9.370 für ALLE gematchten Fotos (nicht mehr
          nur manuell eingerastete) und PRO KAMERA schaltbar (`set_time_from_track` =
          globaler Default, `cam_set_time_from_track` = {Kamera: bool}-Override). Nutzen:
          zwei Kameras mit unterschiedlich gestellter Uhr laufen in Lightroom zeitlich
          synchron — das GPS bleibt korrekt, weil nur die Aufnahmezeit gesetzt wird
          (Offset/Position unberührt).
        """
        log.info("geotagger_start_write: %d matches eingegangen | make_backup=%s overwrite_existing=%s adjust_time=%s offset=%s",
                 len(matches) if matches else 0, make_backup, overwrite_existing, adjust_photo_time, offset_seconds)
        with self._write_lock:
            if self._write_state.get("running"):
                log.warning("geotagger_start_write: ABBRUCH — Schreibvorgang läuft bereits")
                return {"ok": False, "error": "Schreibvorgang läuft bereits"}

        # v0.9.339 — Schreib-Modus auflösen
        mode = (write_mode or "").strip().lower()
        if mode not in ("fill", "overwrite", "skip_existing"):
            mode = "overwrite" if overwrite_existing else "fill"

        # Filtern
        to_write = []
        skipped_existing = 0
        skipped_no_coords = 0
        for m in matches:
            if m.get("lat") is None or m.get("lon") is None:
                skipped_no_coords += 1
                continue
            # Nur im „skip_existing"-Modus werden Fotos mit vorhandenem GPS ausgelassen.
            # In „fill"/„overwrite" kommen sie mit — der Worker entscheidet pro Feld.
            if mode == "skip_existing" and m.get("existing_gps"):
                skipped_existing += 1
                continue
            to_write.append(m)

        log.info("geotagger_start_write: Filter → to_write=%d skipped_existing=%d skipped_no_coords=%d",
                 len(to_write), skipped_existing, skipped_no_coords)
        if to_write:
            _s = to_write[0]
            log.info("geotagger_start_write: erstes Item path=%s lat=%s lon=%s alt=%s matched_time_utc=%s existing_gps=%s",
                     _s.get("path"), _s.get("lat"), _s.get("lon"), _s.get("alt"),
                     _s.get("matched_time_utc"), _s.get("existing_gps"))

        # v0.9.344 — gesammelte EXIF-Feld-Edits (Tab „EXIF" in der Vorschau).
        # Werden mit demselben Schreibvorgang (inkl. Backup) ins Foto geschrieben.
        ee: dict = {}
        if isinstance(exif_edits, dict):
            for p, tags in exif_edits.items():
                if isinstance(tags, dict) and tags:
                    ee[p] = {str(k): ("" if v is None else str(v)) for k, v in tags.items()}
        ee_paths = list(ee.keys())
        log.info("geotagger_start_write: EXIF-Edits → %d Foto(s), %d Feld(er)",
                 len(ee_paths), sum(len(v) for v in ee.values()))

        if not to_write and not ee_paths:
            log.warning("geotagger_start_write: ABBRUCH — keine Fotos zum Schreiben (skipped_existing=%d skipped_no_coords=%d)",
                        skipped_existing, skipped_no_coords)
            return {"ok": False, "error": "Keine Fotos zum Schreiben",
                    "skipped_existing": skipped_existing}

        # Backup-Pfade = Vereinigung aus GPS-Fotos + EXIF-editierten Fotos
        backup_paths: list[str] = []
        _seen_bp: set[str] = set()
        for _p in [m["path"] for m in to_write] + ee_paths:
            if _p and _p not in _seen_bp:
                _seen_bp.add(_p)
                backup_paths.append(_p)
        # v0.9.353 — Gesamtzahl = DISTINKTE Fotos (Vereinigung GPS + EXIF-Edits),
        # nicht die Summe der Schreib-Schritte. Sonst zeigt der Fertig-Dialog z.B.
        # „80" obwohl nur 40 Fotos getaggt wurden (jedes 1× GPS + 1× EXIF-Felder).
        total = len(backup_paths)

        # v0.9.148: Laufenden Thumbnail-Worker stoppen, BEVOR wir schreiben.
        # Sonst blockiert der GPS-Write hinter dem Worker — beide teilen sich den
        # EINEN globalen exiftool-Daemon-Lock. Während der Worker z.B. ein OM-.mov
        # liest, käme der Write nicht dran und „Abbrechen" würde scheinbar hängen.
        if self._thumb_progress.get("running"):
            log.info("geotagger_start_write: stoppe laufenden Thumbnail-Worker vor Write …")
            self._thumb_progress["running"] = False
            if self._thumb_worker and self._thumb_worker.is_alive():
                self._thumb_worker.join(timeout=3)
                log.info("geotagger_start_write: Thumbnail-Worker gestoppt (alive=%s)",
                         self._thumb_worker.is_alive())

        # State zurücksetzen
        with self._write_lock:
            self._write_state = {
                "running": True,
                "total": total,
                "done": 0,
                "current_name": None,
                "current_path": None,
                "errors": [],
                "skipped": 0,
                "skipped_existing": skipped_existing,
                "backup_path": None,
                "completed": False,
                "cancel": False,
                "from_drops": False,
                "saved_dir": dest_dir or "",   # v0.9.372 — Zielordner der Kopien
            }

        # v0.9.337 — Feld-Auswahl: was wird geschrieben (Default: alles an).
        wf = {"gps": True, "altitude": True, "direction": True, "address": True}
        if isinstance(write_fields, dict):
            wf.update({k: bool(v) for k, v in write_fields.items()})

        # v0.9.354 — Pro-Kamera-Offset auch für die optionale Aufnahmezeit-Korrektur
        offset_by_path = self._build_offset_by_path(cam_offsets)
        # v0.9.370 — Pro-Kamera: für welche Fotos die Aufnahmezeit aus dem Track gesetzt wird.
        set_time_paths = self._build_set_time_paths(set_time_from_track, cam_set_time_from_track)
        log.info("geotagger_start_write: set_time_from_track für %d Foto(s)", len(set_time_paths))
        # Worker starten
        self._write_worker = threading.Thread(
            target=self._write_worker_run,
            args=(to_write, make_backup, adjust_photo_time, offset_seconds,
                  set_time_paths, wf, mode, ee, backup_paths, offset_by_path,
                  dest_dir or "", bool(overwrite_originals)),
            daemon=True,
        )
        self._write_worker.start()
        log.info("geotagger_start_write: Worker-Thread gestartet (total=%d, fields=%s)", total, wf)
        return {"ok": True, "total": total, "skipped_existing": skipped_existing}

    def _write_worker_run(self, items: list[dict], make_backup: bool,
                          adjust_photo_time: bool = False,
                          offset_seconds: float = 0.0,
                          set_time_paths: Optional[set] = None,
                          write_fields: Optional[dict] = None,
                          write_mode: str = "fill",
                          exif_edits: Optional[dict] = None,
                          backup_paths: Optional[list] = None,
                          offset_by_path: Optional[dict] = None,
                          dest_dir: str = "",
                          overwrite_originals: bool = False) -> None:
        """Background-Worker: erst Kopieren in den Zielordner, dann pro Foto schreiben.
        v0.9.372 — statt Backup-ZIP + In-Place: die Fotos werden als Kopien in
        `dest_dir` getaggt, Originale bleiben unangetastet (= das Backup selbst).
        `dest_dir` leer → Legacy-In-Place (interner Fallback)."""
        wf = write_fields or {"gps": True, "altitude": True, "direction": True, "address": True}
        mode = write_mode or "fill"
        set_time_paths = set_time_paths or set()   # v0.9.370 — Pfade mit „Zeit aus Track"
        log.info("_write_worker_run: START (items=%d make_backup=%s adjust_time=%s offset=%s set_time_paths=%d fields=%s mode=%s)",
                 len(items), make_backup, adjust_photo_time, offset_seconds, len(set_time_paths), wf, mode)
        try:
            # v0.9.372 — Phase 0: Fotos in den Zielordner KOPIEREN, dann die Kopien
            # taggen. Originale bleiben unangetastet (= das Backup selbst, kein ZIP).
            # dest_dir=="" → Legacy-In-Place. Alle Pfade (items + exif_edits +
            # set_time_paths + offset_by_path) werden auf die Kopien umgebogen, damit
            # Phase B/C automatisch dort schreiben.
            if dest_dir:
                import shutil as _sh
                src_list: list[str] = []
                _seen: set = set()
                for _m in items:
                    _p = _m.get("path")
                    if _p and _p not in _seen:
                        _seen.add(_p); src_list.append(_p)
                for _p in (exif_edits or {}):
                    if _p and _p not in _seen:
                        _seen.add(_p); src_list.append(_p)
                try:
                    os.makedirs(dest_dir, exist_ok=True)
                except Exception as e_mk:
                    log.exception("_write_worker_run: Zielordner nicht anlegbar")
                    with self._write_lock:
                        self._write_state["errors"].append(f"Zielordner nicht nutzbar: {e_mk}")
                path_map: dict = {}
                used_out: set = set()   # v0.9.388 — Basename-Kollisionen im selben Batch verhindern
                n_copy = len(src_list)
                for i_c, src in enumerate(src_list):
                    with self._write_lock:
                        if self._write_state.get("cancel"):
                            self._write_state["cancelled"] = True
                            log.info("_write_worker_run: Phase 0 — abgebrochen bei %d/%d", i_c, n_copy)
                            return
                        self._write_state["current_name"] = f"Kopiere {i_c + 1}/{n_copy} …"
                    out = os.path.join(dest_dir, os.path.basename(src))
                    if os.path.abspath(out) == os.path.abspath(src):
                        # Ziel == Original → nur mit ausdrücklicher Bestätigung in-place
                        if overwrite_originals:
                            path_map[src] = src
                        else:
                            path_map[src] = None
                            with self._write_lock:
                                self._write_state["errors"].append(
                                    f"{os.path.basename(src)}: würde Original überschreiben — übersprungen")
                        continue
                    # v0.9.388 — Namensgleichheit im selben Batch (zwei Kameras mit
                    # "IMG_0001.JPG", DCIM-Rollover 100CANON/101CANON, folder_recursive):
                    # eindeutigen Zielnamen mit Suffix suchen, sonst überschreibt die
                    # zweite Kopie die erste → ein Foto würde still im Output fehlen.
                    if out in used_out:
                        _stem, _ext = os.path.splitext(os.path.basename(out))
                        _k = 2
                        while os.path.join(dest_dir, f"{_stem}_{_k}{_ext}") in used_out:
                            _k += 1
                        out = os.path.join(dest_dir, f"{_stem}_{_k}{_ext}")
                    used_out.add(out)
                    try:
                        _sh.copy2(src, out)
                        path_map[src] = out
                    except Exception as e_cp:
                        log.exception("_write_worker_run: Kopie fehlgeschlagen: %s", src)
                        path_map[src] = None
                        with self._write_lock:
                            self._write_state["errors"].append(
                                f"{os.path.basename(src)}: Kopie fehlgeschlagen: {e_cp}")
                log.info("_write_worker_run: Phase 0 — %d/%d Foto(s) nach %s kopiert",
                         sum(1 for v in path_map.values() if v), n_copy, dest_dir)

                def _mp(p):
                    return path_map.get(p, p)
                items = [m for m in items if path_map.get(m.get("path")) is not None]
                for m in items:
                    m["path"] = path_map[m["path"]]
                if exif_edits:
                    exif_edits = {_mp(p): t for p, t in exif_edits.items()
                                  if path_map.get(p) is not None}
                set_time_paths = {_mp(p) for p in set_time_paths if path_map.get(p) is not None}
                if offset_by_path:
                    offset_by_path = {_mp(p): v for p, v in offset_by_path.items()
                                      if path_map.get(p) is not None}
            else:
                log.info("_write_worker_run: dest_dir leer → Legacy-In-Place (kein Kopieren)")

            # Phase B: pro Foto schreiben
            log.info("_write_worker_run: Phase B — schreibe GPS in %d Fotos", len(items))
            for idx, m in enumerate(items):
                # Cancel-Check
                with self._write_lock:
                    if self._write_state.get("cancel"):
                        log.info("_write_worker_run: Phase B — abgebrochen bei %d/%d", idx, len(items))
                        break
                    self._write_state["current_name"] = os.path.basename(m["path"])
                    self._write_state["current_path"] = m["path"]

                try:
                    ts = None
                    if m.get("matched_time_utc"):
                        ts = datetime.fromisoformat(m["matched_time_utc"])
                    path = m["path"]
                    has_gps = bool(m.get("existing_gps"))

                    # v0.9.336/337: Blickrichtung — nur geloggt (rz:hdg) ODER manuell
                    # gesetzt (nie reine Bewegungs-Schätzung).
                    img_dir = None
                    if wf.get("direction", True) and m.get("dir") is not None \
                            and m.get("dir_src") in ("logged", "manual"):
                        img_dir = float(m["dir"])
                    addr = m.get("address") if (wf.get("address", True) and isinstance(m.get("address"), dict)) else None
                    alt_val = float(m["alt"]) if (wf.get("altitude", True) and m.get("alt") is not None) else None

                    # v0.9.339 — „Nur Fehlendes ergänzen": vorhandene Werte unangetastet
                    # lassen. Im fill-Modus pro Feld prüfen, ob das Foto es schon hat.
                    if mode == "fill":
                        if img_dir is not None:
                            try:
                                if cexif.read_img_direction(path) is not None:
                                    img_dir = None
                            except Exception:
                                pass
                        if addr is not None:
                            try:
                                if cexif.has_location(path):
                                    addr = None
                            except Exception:
                                pass

                    # GPS schreiben? overwrite=immer; fill=nur wenn keins da; im
                    # skip_existing-Modus sind GPS-Fotos schon rausgefiltert.
                    write_coords = (mode == "overwrite") or (not has_gps)
                    if not write_coords:
                        alt_val = None  # eigenes GPS/Höhe bleiben unangetastet

                    if write_coords:
                        log.info("_write_worker_run: [%d/%d] write_gps(%s) → %s lat=%s lon=%s alt=%s dir=%s",
                                 idx + 1, len(items), mode, path, m.get("lat"), m.get("lon"), alt_val, img_dir)
                        cexif.write_gps(path, float(m["lat"]), float(m["lon"]), alt_val, ts,
                                        img_dir if img_dir is not None else None)
                    elif img_dir is not None:
                        # Eigenes GPS behalten, nur die Blickrichtung ergänzen.
                        log.info("_write_worker_run: [%d/%d] nur Richtung ergänzen → %s dir=%s",
                                 idx + 1, len(items), path, img_dir)
                        cexif.write_img_direction(path, img_dir)

                    # Adresse (IPTC/XMP) — getrennt, da formatübergreifend via exiftool.
                    if addr is not None:
                        try:
                            cexif.write_location(path, addr)
                        except Exception as e_addr:
                            log.exception("_write_worker_run: [%d/%d] write_location fehlgeschlagen für %s",
                                          idx + 1, len(items), path)
                            with self._write_lock:
                                self._write_state["errors"].append(
                                    f"{path}: Adresse schreiben fehlgeschlagen: {e_addr}")
                    log.info("_write_worker_run: [%d/%d] OK → %s (coords=%s dir=%s addr=%s)",
                             idx + 1, len(items), path, write_coords, img_dir is not None, addr is not None)
                    # v0.9.281 (Nutzer): Aufnahmezeit aus Track setzen. v0.9.370 — jetzt
                    # für ALLE gematchten Fotos dieser Kamera (nicht mehr nur manuell
                    # eingerastete), pro Kamera in `set_time_paths` vorentschieden. Nutzen:
                    # zwei Kameras mit falsch gestellter Uhr laufen in Lightroom synchron.
                    if m["path"] in set_time_paths and ts is not None:
                        try:
                            cexif.set_datetime(m["path"], ts)
                            log.info("_write_worker_run: [%d/%d] set_datetime aus Track OK → %s (%s)",
                                     idx + 1, len(items), m.get("path"), ts)
                        except Exception as e3:
                            log.exception("_write_worker_run: [%d/%d] set_datetime FEHLGESCHLAGEN für %s",
                                          idx + 1, len(items), m.get("path"))
                            with self._write_lock:
                                self._write_state["errors"].append(
                                    f"{m['path']}: Aufnahmezeit aus Track fehlgeschlagen: {e3}"
                                )
                    # Optionale Zeit-Korrektur (verschiebt DateTimeOriginal/CreateDate/ModifyDate)
                    # v0.9.354 — pro Kamera: eigener Offset des Fotos vor dem globalen.
                    _shift = (offset_by_path or {}).get(m["path"], offset_seconds)
                    if adjust_photo_time and _shift:
                        try:
                            cexif.shift_datetime(m["path"], _shift)
                        except Exception as e2:
                            log.exception("_write_worker_run: [%d/%d] Zeit-Korrektur FEHLGESCHLAGEN für %s",
                                          idx + 1, len(items), m.get("path"))
                            with self._write_lock:
                                self._write_state["errors"].append(
                                    f"{m['path']}: Zeit-Korrektur fehlgeschlagen: {e2}"
                                )
                    with self._write_lock:
                        self._write_state["done"] = self._write_state.get("done", 0) + 1
                except Exception as e:
                    log.exception("_write_worker_run: [%d/%d] write_gps FEHLGESCHLAGEN für %s",
                                  idx + 1, len(items), m.get("path"))
                    with self._write_lock:
                        self._write_state["errors"].append(f"{m['path']}: {e}")
                        self._write_state["skipped"] = self._write_state.get("skipped", 0) + 1

            # Phase C (v0.9.344): gesammelte EXIF-Feld-Edits aus dem EXIF-Tab schreiben.
            if exif_edits:
                log.info("_write_worker_run: Phase C — EXIF-Edits in %d Foto(s)", len(exif_edits))
                # v0.9.353 — Fotos, die schon in Phase B (GPS) gezählt wurden, hier NICHT
                # erneut hochzählen, damit `done` = distinkte Foto-Anzahl bleibt (nicht 2×).
                _phase_b_paths = {m.get("path") for m in items}
                for path, tags in exif_edits.items():
                    with self._write_lock:
                        if self._write_state.get("cancel"):
                            log.info("_write_worker_run: Phase C — abgebrochen")
                            break
                        self._write_state["current_name"] = os.path.basename(path)
                        self._write_state["current_path"] = path
                    # v0.9.369 — ALLE Felder eines Fotos in EINEM exiftool-Call
                    # statt Feld für Feld (früher: ein -execute pro Tag → bei RAW
                    # ein voller Datei-Rewrite je Tag, Hunderte Round-Trips, jeder
                    # eine Deadlock-Fläche → App-Freeze 2026-06-30). Jetzt: die
                    # Datei wird EINMAL geschrieben, mit Timeout im Daemon abgesichert.
                    try:
                        cexif.write_exif_tags(path, tags)
                        log.info("_write_worker_run: EXIF-Batch %d Feld(er) → %s",
                                 len(tags), path)
                    except Exception as e_ex:
                        log.exception("_write_worker_run: EXIF-Batch fehlgeschlagen für %s", path)
                        with self._write_lock:
                            self._write_state["errors"].append(
                                f"{path}: EXIF-Batch fehlgeschlagen: {e_ex}")
                    if path not in _phase_b_paths:
                        with self._write_lock:
                            self._write_state["done"] = self._write_state.get("done", 0) + 1
        except Exception:
            log.exception("_write_worker_run: UNERWARTETER Fehler im Worker")
        finally:
            with self._write_lock:
                done = self._write_state.get("done", 0)
                skipped = self._write_state.get("skipped", 0)
                nerr = len(self._write_state.get("errors", []))
                self._write_state["running"] = False
                self._write_state["completed"] = True
                self._write_state["current_name"] = None
                self._write_state["current_path"] = None
            log.info("_write_worker_run: ENDE — done=%d skipped=%d errors=%d", done, skipped, nerr)

    def geotagger_write_status(self) -> dict:
        """Wird vom UI alle ~200 ms gepollt während ein Schreibvorgang läuft."""
        with self._write_lock:
            return dict(self._write_state)

    def geotagger_write_cancel(self) -> dict:
        """User hat Abbrechen geklickt — Worker beendet sich beim nächsten Foto."""
        with self._write_lock:
            if self._write_state.get("running"):
                self._write_state["cancel"] = True
                return {"ok": True}
            return {"ok": False, "error": "Kein laufender Vorgang"}

    def geotagger_export_tagged(self, items: list[dict], dest_folder: str) -> dict:
        """v0.9.152: Kopiert getaggte Drag&Drop-Fotos in einen Zielordner.

        Hintergrund: Per Drag&Drop importierte Fotos liegen als Wegwerf-Kopien
        unter `_drops/` (die WebView liefert keinen Original-Pfad). Der GPS-Write
        landet daher in diesen Kopien — nicht in den Originalen. Damit der User
        die fertig getaggten Dateien trotzdem bekommt, exportiert diese Funktion
        sie unter ihrem Original-Dateinamen in einen frei gewählten Ordner.

        `items`: Liste mit {src: <_drops-Pfad>, name: <Original-Dateiname>}
        """
        import shutil
        try:
            if not dest_folder or not os.path.isdir(dest_folder):
                return {"ok": False, "error": "Kein gültiger Zielordner"}
            exported = 0
            skipped = 0
            errors: list[str] = []
            for it in items or []:
                src = it.get("src")
                name = os.path.basename(it.get("name") or (src or ""))
                if not src or not os.path.isfile(src) or not name:
                    skipped += 1
                    continue
                dst = os.path.join(dest_folder, name)
                try:
                    if os.path.abspath(dst) == os.path.abspath(src):
                        # Ziel == Quelle (sollte bei _drops nie passieren) → skip
                        skipped += 1
                        continue
                    shutil.copy2(src, dst)
                    exported += 1
                except Exception as e:
                    errors.append(f"{name}: {e}")
            log.info("geotagger_export_tagged: %d exportiert, %d übersprungen, %d Fehler → %s",
                     exported, skipped, len(errors), dest_folder)
            return {"ok": True, "exported": exported, "skipped": skipped,
                    "errors": errors, "dest": dest_folder}
        except Exception as e:
            log.exception("geotagger_export_tagged: unerwarteter Fehler")
            return {"ok": False, "error": str(e), "trace": traceback.format_exc()}

    # ── Geotagger: Sync-Write (Legacy, Fallback) ─────────────────────────────

    def geotagger_write(self, matches: list[dict], make_backup: bool = True) -> dict:
        """Schreibt GPS-Tags in die EXIF-Daten. Optional Backup vorher.
        `matches`: Liste mit {path, lat, lon, alt, matched_time_utc}."""
        try:
            written = 0
            skipped = 0
            errors = []
            backup_path = None
            if make_backup:
                photo_paths = [m["path"] for m in matches if m.get("lat") is not None]
                if photo_paths:
                    backup_path = cbak.make_photo_backup(photo_paths, str(BACKUPS_DIR),
                                                        label="geotag")
            for m in matches:
                if m.get("lat") is None or m.get("lon") is None:
                    skipped += 1
                    continue
                try:
                    ts = None
                    if m.get("matched_time_utc"):
                        ts = datetime.fromisoformat(m["matched_time_utc"])
                    img_dir = m.get("dir") if m.get("dir_src") == "logged" else None
                    cexif.write_gps(m["path"],
                                    float(m["lat"]), float(m["lon"]),
                                    float(m["alt"]) if m.get("alt") is not None else None,
                                    ts,
                                    float(img_dir) if img_dir is not None else None)
                    written += 1
                except Exception as e:
                    errors.append(f"{m['path']}: {e}")
                    skipped += 1
            return {"ok": True, "written": written, "skipped": skipped,
                    "errors": errors, "backup_path": backup_path}
        except Exception as e:
            return {"ok": False, "error": str(e), "trace": traceback.format_exc()}


def _format_offset(seconds: float) -> str:
    sign = "+" if seconds >= 0 else "-"
    s = int(abs(seconds))
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    parts = []
    if h: parts.append(f"{h}h")
    if m: parts.append(f"{m}m")
    if sec or not parts: parts.append(f"{sec}s")
    return sign + " ".join(parts)


def _prepare_html_with_cache_busting() -> str:
    """
    WKWebView cached file:// CSS/JS aggressiv über App-Restarts hinweg.
    Workaround: HTML in Temp-Datei kopieren, dabei alle relativen CSS/JS-Pfade
    durch absolute file://-URLs mit `?v=<build_hash>` Query ergänzen.
    Build-Hash = Modification-Time-Summe aller UI- + Modul-Files.
    """
    src_html = UI_DIR / "index.html"
    html = src_html.read_text(encoding="utf-8")

    # Hash über die Modification-Time aller UI- und Modul-Dateien
    modules_dir = ROOT / "modules"
    mtime_sum = 0
    for base in (UI_DIR, modules_dir):
        if not base.exists():
            continue
        for p in sorted(base.rglob("*")):
            if p.is_file():
                try:
                    mtime_sum += int(p.stat().st_mtime * 1000)
                except OSError:
                    pass
    bust = f"{mtime_sum & 0xFFFFFFFF:x}"

    def resolve_relative(path: str) -> Optional[Path]:
        """Auflöst Pfade relativ zur UI-HTML (ui/index.html als base)."""
        # path könnte 'css/app.css' oder '../modules/animator/ui/module.css' sein
        candidate = (UI_DIR / path).resolve()
        if candidate.exists():
            return candidate
        return None

    def patch_url(m: re.Match) -> str:
        prefix, path = m.group(1), m.group(2)
        full = resolve_relative(path)
        if full is None:
            return m.group(0)
        abs_url = full.as_uri()
        return f'{prefix}"{abs_url}?v={bust}"'

    # <link href="..."> mit href auf local file (kein https)
    html = re.sub(
        r'(<link[^>]+href=)"((?!https?:)[^"]+\.css)"',
        patch_url, html,
    )
    # <script src="...">
    html = re.sub(
        r'(<script[^>]+src=)"((?!https?:)[^"]+\.js)"',
        patch_url, html,
    )
    # <img src="..."> für Local-Assets (Brand-Icon, …) — sonst lädt das
    # Image nicht, weil die Temp-HTML in /tmp/ liegt und keine `assets/`
    # findet. Wir patchen auf absolute file://-URL aus dem Bundle.
    html = re.sub(
        r'(<img[^>]+src=)"((?!https?:|data:)[^"]+\.(?:png|jpg|jpeg|gif|webp|svg))"',
        patch_url, html, flags=re.IGNORECASE,
    )

    tmp = tempfile.NamedTemporaryFile(
        prefix="reisezoom_gps_", suffix=".html",
        delete=False, mode="w", encoding="utf-8",
    )
    tmp.write(html)
    tmp.close()
    return tmp.name


def main() -> None:
    api = Api()
    html_path = _prepare_html_with_cache_busting()

    # v0.9.28 (Marc-Feedback): Fenster-Geometrie wird IMMER aus Settings
    # wiederhergestellt. Beim Erststart (width/height = -1) → maximiert.
    _s_init = _load_settings()
    _win_cfg = _s_init.get("window") or {}
    _win_w = int(_win_cfg.get("width") if _win_cfg.get("width") is not None else -1)
    _win_h = int(_win_cfg.get("height") if _win_cfg.get("height") is not None else -1)
    _win_x = int(_win_cfg.get("x") if _win_cfg.get("x") is not None else -1)
    _win_y = int(_win_cfg.get("y") if _win_cfg.get("y") is not None else -1)
    _have_remembered = (_win_w > 200 and _win_h > 200)

    create_kwargs = dict(
        title=APP_NAME,   # v0.9.331 — editionsabhängig (Studio / Geotagger)
        url=Path(html_path).resolve().as_uri(),
        js_api=api,
        width=_win_w if _have_remembered else 1400,
        height=_win_h if _have_remembered else 900,
        min_size=(1100, 720),
        background_color="#0e1116",
        maximized=(not _have_remembered),
    )
    if _have_remembered and _win_x >= 0 and _win_y >= 0:
        create_kwargs["x"] = _win_x
        create_kwargs["y"] = _win_y

    # v0.9.230 (Windows-Bug-Report Peter Straka): Datei-Drag&Drop auf Windows
    # abschalten. Hintergrund: WebView2 (Edge) fängt einen Datei-Drop auf
    # CONTROL-Ebene ab (Property `AllowExternalDrop`, Default true) — VOR unserem
    # DOM-drop-Handler. Da `.gpx` keine Web-Zuordnung hat, wirft Windows die
    # Shell-Frage „Wählen Sie eine App…". `preventDefault()` im JS kommt zu spät.
    # Marc-Entscheidung: auf Windows D&D einfach aus (Öffnen-Button reicht).
    # `AllowExternalDrop=False` unterdrückt den Shell-Dialog UND lässt den Drop
    # ins Leere laufen (keine DOM-drop-Events mehr für externe Dateien).
    # macOS/Linux unberührt. Defensiv: schlägt der Patch fehl, bleibt alles wie
    # bisher (kein Crash). Verifizierbar via Log-Zeile in der Win-VM.
    if sys.platform == "win32":
        try:
            from webview.platforms import edgechromium as _edge  # type: ignore
            _orig_ready = _edge.EdgeChrome.on_webview_ready
            def _patched_ready(self, sender, args):
                _orig_ready(self, sender, args)
                try:
                    self.webview.AllowExternalDrop = False
                    log.info("WebView2: AllowExternalDrop=False — Datei-Drag&Drop auf Windows deaktiviert (kein Shell-Dialog)")
                except Exception as _e:
                    log.warning("WebView2 AllowExternalDrop nicht setzbar: %s", _e)
            _edge.EdgeChrome.on_webview_ready = _patched_ready
        except Exception as _e:
            log.warning("Edge-DnD-Patch nicht möglich (D&D bleibt wie bisher): %s", _e)

    win = webview.create_window(**create_kwargs)
    api.set_window(win)

    # Fenster nach Start auf volle Bildschirmgröße ziehen — pywebview's
    # `maximized=True` greift in 6.x auf macOS nicht zuverlässig. NSWindow-
    # Manipulationen MÜSSEN auf dem Main-Thread laufen, sonst crasht Cocoa.
    # ⚠️ Das `loaded`-Event von pywebview läuft auf einem PYTHON-WORKER-
    #    THREAD (Thread-3 „execute"), NICHT auf dem Cocoa-Main-Thread.
    #    Crash-Log: „Must only be used from the main thread" →
    #    Wir MÜSSEN über AppHelper.callAfter() auf den Main-Thread dispatchen.

    def _maximize_native_window():
        try:
            from AppKit import NSApplication, NSScreen  # type: ignore
            app = NSApplication.sharedApplication()
            for w in app.windows():
                try:
                    if w.isVisible() and "Reisezoom" in str(w.title()):
                        sc = w.screen() or NSScreen.mainScreen()
                        if sc:
                            w.setFrame_display_(sc.visibleFrame(), True)
                        return
                except Exception:
                    continue
        except Exception:
            pass

    def _enable_native_drop():
        # v0.9.153: Genau EIN Python-Drop-Listener auf dem document registrieren.
        # Das genügt, damit pywebviews native Schicht (alle Plattformen) bei
        # jedem Drop die echten Dateipfade in _dnd_state['paths'] schreibt
        # (Gate: num_listeners > 0). Den Inhalt holt JS via consume_drop_paths().
        # Der Handler selbst muss nichts tun — das Registrieren allein aktiviert
        # die native Pfad-Erfassung. prevent_default/stop_propagation = False,
        # damit die bestehenden JS-Dropzones unangetastet weiterlaufen.
        if getattr(api, "_native_drop_ready", False):
            return
        try:
            from webview.dom import DOMEventHandler  # type: ignore

            def _noop_drop(_e):
                pass

            win.dom.document.events.drop += DOMEventHandler(_noop_drop, False, False)
            api._native_drop_ready = True
            log.info("Native Drag&Drop-Pfaderfassung aktiviert (pywebview _dnd_state)")
        except Exception as e:
            log.warning("Native Drop-Registrierung fehlgeschlagen (Fallback _drops/): %s", e)

    def _on_loaded():
        # v0.9.153: native Drop-Pfade aktivieren (alle Plattformen, vor den
        # platform-spezifischen Fenster-Returns weiter unten).
        _enable_native_drop()
        # loaded läuft auf Python-Worker-Thread → callAfter dispatcht den
        # NSWindow-Zugriff sauber auf den Cocoa-Main-Thread.
        # Auf Windows/Linux: gibt's keinen NSWindow, pywebview maximized=True
        # funktioniert dort eh zuverlässig.
        # v0.9.28: nur beim Erststart maximieren (wenn noch keine Geometrie
        # gespeichert ist), sonst überschreiben wir den letzten Stand.
        if sys.platform != "darwin":
            return
        if _have_remembered:
            return
        try:
            from PyObjCTools import AppHelper  # type: ignore
            AppHelper.callAfter(_maximize_native_window)
        except Exception:
            pass
    try:
        win.events.loaded += _on_loaded
    except Exception:
        pass

    # v0.9.25/26 — Graceful Shutdown beim Fenster-Schließen (red X).
    # Hintergrund: Marc hat einen Freeze reproduziert wenn der X-Button
    # geklickt wird. Stack-Sample (v0.9.25) hat gezeigt: nach unserem
    # Cleanup-Handler hängt der Main-Thread in
    #   Py_Finalize → wait_for_thread_shutdown → ThreadHandle_join
    # weil 2 pywebview-Bridge-Call-Threads in `_PyMutex_LockTimed` hängen.
    # Das ist ein bekanntes Python-3.13+-Verhalten: Py_Finalize wartet auf
    # ALLE Threads (auch wenn sie ewig auf einen Lock warten den niemand
    # mehr freigibt). pywebview spawnt seine Bridge-Threads ohne Daemon-
    # Flag, also helfen unsere `daemon=True`-Marker nicht.
    #
    # Lösung: nach dem Cleanup hart raus via `os._exit(0)` — umgeht
    # Py_Finalize komplett. macOS räumt den Prozess + daemon-threads auf.
    #
    # ⚠️ v0.9.190: Die exiftool-Daemons werden NICHT zuverlässig „via
    # parent-death" eingesammelt (so die alte, falsche Annahme — daher liefen
    # Waisen über Sessions hinweg weiter, Marc-Bug 2026-06-08). Deshalb wird
    # `cexif._ExifToolDaemon.shutdown()` weiter unten EXPLIZIT und SYNCHRON vor
    # dem os._exit aufgerufen; shutdown() killt die ganze Process-Group hart.
    def _on_closing():
        try:
            log.info("Window closing → stoppe Background-Worker")
            # v0.9.28 (Marc-Feedback): Fenster-Geometrie wird IMMER gespeichert.
            # Beim nächsten Start kommt die App in derselben Position+Größe.
            try:
                _cur_settings = _load_settings()
                _wcfg = _cur_settings.get("window") or {}
                w = int(win.width or _win_w)
                h = int(win.height or _win_h)
                x = int(win.x if win.x is not None else _win_x)
                y = int(win.y if win.y is not None else _win_y)
                # Sanity-Check: nicht miniaturisierte / negative Werte
                if w >= 200 and h >= 200:
                    _wcfg["width"] = w
                    _wcfg["height"] = h
                    _wcfg["x"] = x
                    _wcfg["y"] = y
                    _cur_settings["window"] = _wcfg
                    _save_settings(_cur_settings)
                    log.info(f"Fenster-Geometrie gespeichert: {w}×{h} @ ({x},{y})")
            except Exception as e:
                try: log.warning(f"Fenster-Geometrie konnte nicht gespeichert werden: {e}")
                except Exception: pass
            # Geotagger Thumb-Worker
            try:
                with api._thumb_lock:
                    api._thumb_progress["running"] = False
            except Exception:
                pass
            # Geotagger Write-Worker (falls jemand mid-write den X klickt)
            try:
                with api._write_lock:
                    api._write_state["running"] = False
                    api._write_state["cancel"] = True
            except Exception:
                pass
            # Animator-Render-Worker
            try:
                api._render_state["running"] = False
                api._render_state["cancel_requested"] = True
            except Exception:
                pass
            # Tour-Map-Render-Worker
            try:
                api._tourmap_state["running"] = False
                api._tourmap_state["cancel_requested"] = True
            except Exception:
                pass
            # exiftool-Daemon herunterfahren — sonst kann ein laufender
            # _send_and_read_text()-Call im Thumb-Worker im read1() hängen
            # während pywebview den Prozess abbaut.
            try:
                cexif._ExifToolDaemon.shutdown()
            except Exception:
                pass
            log.info("Background-Worker gestoppt — Force-Exit via os._exit(0)")
        except Exception as e:
            try: log.error(f"_on_closing: {e}")
            except Exception: pass
        # Watchdog: 800ms warten damit Logs geflushed sind + macOS die
        # Window-Animation startet. Dann hart raus, bevor Py_Finalize
        # auf hängende Threads warten kann.
        def _force_exit():
            try:
                time.sleep(0.8)
                try: log.info("Force-Exit nach Window-Close")
                except Exception: pass
                # Stdout/Stderr/Logfile-Handles flushen, sonst gehen die
                # letzten Logzeilen verloren
                try:
                    import logging as _logging
                    _logging.shutdown()
                except Exception:
                    pass
                os._exit(0)
            except Exception:
                os._exit(1)
        threading.Thread(target=_force_exit, daemon=True).start()
    try:
        win.events.closing += _on_closing
    except Exception:
        pass

    # macOS-Top-Menü: "Reisezoom" → "Einstellungen…"
    # Labels werden aus den i18n-Strings der aktuellen Sprache geholt.
    # Wichtig: das Menü wird beim App-Start einmal erstellt; nach Sprachwechsel
    # zur Laufzeit bleibt das Label wie's beim Start war (pywebview-Limitation).
    try:
        from webview.menu import Menu, MenuAction, MenuSeparator  # type: ignore

        def _open_settings_from_menu():
            try:
                win.evaluate_js("window.openSettingsModal && window.openSettingsModal()")
            except Exception:
                pass

        def _trigger_js(snippet: str):
            try:
                win.evaluate_js(snippet)
            except Exception:
                pass

        def _open_user_guide_from_menu(): _trigger_js("window.pywebview && window.pywebview.api.open_user_guide()")
        def _open_log_from_menu():        _trigger_js("window.pywebview && window.pywebview.api.open_log()")
        def _open_about_from_menu():      _trigger_js("window.openAboutModal && window.openAboutModal()")
        def _open_mapbox_help_from_menu():_trigger_js("window.openMapboxHelpModal && window.openMapboxHelpModal()")

        # Marc's externe Web-Adressen — werden direkt im Standard-Browser geöffnet
        # (open_url-Bridge gibt's eh schon, ein Menu-Action kapselt das).
        def _open_blog():    _trigger_js("window.pywebview && window.pywebview.api.open_url('https://reisezoom.com')")
        def _open_youtube(): _trigger_js("window.pywebview && window.pywebview.api.open_url('https://www.youtube.com/@reisezoom')")
        # v0.9.282 — „Als GPX exportieren" (auch für importierte FIT/NMEA/KML-Tracks)
        def _export_gpx_from_menu(): _trigger_js("window.exportCurrentGpx && window.exportCurrentGpx()")
        # v0.9.297 — „Als CSV exportieren" (gleiche core.trackio-Logik wie das Web)
        def _export_csv_from_menu(): _trigger_js("window.exportCurrentCsv && window.exportCurrentCsv()")
        # v0.9.317 — weitere Zielformate (Kreuz-und-quer-Export, wie im Web-Konverter)
        def _export_kml_from_menu():     _trigger_js("window.exportCurrent && window.exportCurrent('kml')")
        def _export_kmz_from_menu():     _trigger_js("window.exportCurrent && window.exportCurrent('kmz')")
        def _export_tcx_from_menu():     _trigger_js("window.exportCurrent && window.exportCurrent('tcx')")
        def _export_geojson_from_menu(): _trigger_js("window.exportCurrent && window.exportCurrent('geojson')")
        # v0.9.288 — Topbar aufgeräumt → diese Aktionen leben jetzt im Menü.
        def _open_track_from_menu():    _trigger_js("window.pickGpx && window.pickGpx()")
        def _open_feedback_from_menu(): _trigger_js("window.openBugReportModal && window.openBugReportModal('Feedback (Menü)')")
        # v0.9.289 — Spenden/Unterstützen: öffnet den Über-Dialog (enthält den Block)
        def _open_support_from_menu():  _trigger_js("window.openAboutModal && window.openAboutModal()")

        _s = _load_settings()
        _active_lang = ci18n.resolve(_s.get("language", "auto") or "auto")
        _strings = ci18n.get_strings(_active_lang)
        _menu_file       = _strings.get("menu.file", "Datei")
        _menu_open_track = _strings.get("menu.open_track", "Track öffnen…")
        _menu_settings   = _strings.get("menu.settings", "Settings…")
        _menu_help       = _strings.get("menu.help", "Help")
        _menu_user_guide = _strings.get("menu.user_guide", "User Guide")
        _menu_log        = _strings.get("menu.open_log", "Open Log File")
        _menu_about      = _strings.get("menu.about", "About Reisezoom GPS Studio")
        _menu_mapbox     = _strings.get("menu.mapbox_help", "Mapbox Token Help")
        _menu_feedback   = _strings.get("menu.feedback", "Feedback / Fehler melden…")
        _menu_support    = _strings.get("menu.support", "Entwicklung unterstützen")
        _menu_blog       = _strings.get("menu.blog", "Blog – reisezoom.com")
        _menu_youtube    = _strings.get("menu.youtube", "YouTube-Kanal")
        _menu_export_gpx = _strings.get("menu.export_gpx", "Als GPX exportieren…")
        _menu_export_kml = _strings.get("menu.export_kml", "Als KML exportieren…")
        _menu_export_kmz = _strings.get("menu.export_kmz", "Als KMZ exportieren…")
        _menu_export_tcx = _strings.get("menu.export_tcx", "Als TCX exportieren…")
        _menu_export_geojson = _strings.get("menu.export_geojson", "Als GeoJSON exportieren…")
        _menu_export_csv = _strings.get("menu.export_csv", "Als CSV exportieren…")

        # v0.9.288 — aufgeräumte Menüstruktur (Marc): Dokument-Aktionen unter
        # „Datei", alles Hilfe/Web/Über unter „Hilfe" — mit Trennlinien gruppiert.
        menu = [
            Menu(_menu_file, [
                MenuAction(_menu_open_track, _open_track_from_menu),
                MenuAction(_menu_export_gpx, _export_gpx_from_menu),
                MenuAction(_menu_export_kml, _export_kml_from_menu),
                MenuAction(_menu_export_kmz, _export_kmz_from_menu),
                MenuAction(_menu_export_tcx, _export_tcx_from_menu),
                MenuAction(_menu_export_geojson, _export_geojson_from_menu),
                MenuAction(_menu_export_csv, _export_csv_from_menu),
                MenuSeparator(),
                MenuAction(_menu_settings, _open_settings_from_menu),
            ]),
            Menu(_menu_help, [
                MenuAction(_menu_user_guide, _open_user_guide_from_menu),
                MenuAction(_menu_mapbox, _open_mapbox_help_from_menu),
                MenuAction(_menu_feedback, _open_feedback_from_menu),
                MenuAction(_menu_log, _open_log_from_menu),
                MenuSeparator(),
                MenuAction(_menu_support, _open_support_from_menu),
                MenuAction(_menu_youtube, _open_youtube),
                MenuAction(_menu_blog, _open_blog),
                MenuSeparator(),
                MenuAction(_menu_about, _open_about_from_menu),
            ]),
        ]
    except Exception:
        menu = None

    debug = os.environ.get("REISEZOOM_DEBUG") == "1"
    if menu:
        webview.start(debug=debug, private_mode=True, menu=menu)
    else:
        webview.start(debug=debug, private_mode=True)
    # Cleanup beim Shutdown
    try:
        os.unlink(html_path)
    except OSError:
        pass
    try:
        cexif._ExifToolDaemon.shutdown()
    except Exception:
        pass


if __name__ == "__main__":
    main()
