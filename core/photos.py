"""Foto-Pin-Loader für Animator + Tour-Map (Phase 1, v0.9.74).

Lädt eine Liste von Fotos (oder einen Ordner) und liefert für jedes Foto
mit EXIF-GPS eine kompakte Repräsentation:

    {
      "path": "/abs/path/to/IMG_4821.jpg",
      "lon": 11.521234,
      "lat": 47.123456,
      "elevation": 1842.0,        # optional
      "datetime": "2024-08-15T11:42:00",  # optional, ISO
      "thumb": "data:image/jpeg;base64,...",
    }

Fotos OHNE GPS werden still übersprungen — Caller kriegt `skipped_count`.

Thumbnails:
- 128×128 max, JPEG Q=78, base64 data-URL.
- Routing nach Format: JPEG via Pillow direkt, HEIC via pillow-heif,
  RAW via `extract_raw_preview` (eingebettetes Preview-JPEG) + Pillow-Resize.
- Disk-Cache pro Datei (path + mtime + size hash → SHA1).
  Cache-Dir: APP_SUPPORT/photo_thumb_cache/

Wird sowohl im Preview-UI (über `app.photos_load` Bridge) als auch im
Render-Backend (`core/animator.py` — auch im Standbild-Modus der Tour-Map —
über die gleichen data-URLs im HTML-Template) verwendet — gleiche Bytes,
echtes WYSIWYG.

Mirror-Hinweis: keine. Dieses Modul wird von beiden Modulen geteilt; UI
liest project.photos vom shared Project-Schema.
"""
from __future__ import annotations

import base64
import hashlib
import io
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Iterable, Optional

from . import exif as cexif

_log = logging.getLogger(__name__)

# Thumbnail-Defaults
_THUMB_MAX_PX = 128       # größte Kante; ergibt Retina-fähige Display-Größe bis ~64 CSS-px
_THUMB_JPEG_Q = 78

# Cache-Dir wird vom App-Setup gesetzt (siehe app.py / set_cache_dir).
_cache_dir: Optional[Path] = None


def set_cache_dir(path: Path) -> None:
    """Vom App-Setup gerufen; legt fest wo Thumbs zwischengespeichert werden.
    Wenn None gesetzt: kein Disk-Cache, jeder Aufruf rechnet neu."""
    global _cache_dir
    _cache_dir = path
    if _cache_dir is not None:
        try:
            _cache_dir.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            _log.warning("photo-thumb-cache nicht anlegbar: %s", e)
            _cache_dir = None


# ── Hilfen ───────────────────────────────────────────────────────────────────


def _file_fingerprint(path: str) -> Optional[str]:
    """SHA1 aus (abs path, mtime ns, size). Robust gegen Dateinamens-Reuse."""
    try:
        st = os.stat(path)
        h = hashlib.sha1()
        h.update(os.path.abspath(path).encode("utf-8"))
        h.update(str(st.st_mtime_ns).encode("ascii"))
        h.update(str(st.st_size).encode("ascii"))
        return h.hexdigest()
    except OSError:
        return None


def _cache_get(fp: str) -> Optional[bytes]:
    if _cache_dir is None or not fp:
        return None
    p = _cache_dir / f"{fp}.jpg"
    try:
        return p.read_bytes() if p.is_file() else None
    except OSError:
        return None


def _cache_put(fp: str, data: bytes) -> None:
    if _cache_dir is None or not fp or not data:
        return
    try:
        (_cache_dir / f"{fp}.jpg").write_bytes(data)
    except OSError as e:
        _log.debug("photo-thumb-cache-write fehlgeschlagen: %s", e)


def _pil_thumb_from_bytes(data: bytes, max_px: int = _THUMB_MAX_PX) -> Optional[bytes]:
    """Lädt JPEG/PNG-Bytes mit Pillow, dreht via EXIF, resized, returns JPEG."""
    try:
        from PIL import Image, ImageOps
        img = Image.open(io.BytesIO(data))
        img = ImageOps.exif_transpose(img)
        img.thumbnail((max_px, max_px), Image.LANCZOS)
        if img.mode != "RGB":
            img = img.convert("RGB")
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=_THUMB_JPEG_Q)
        return buf.getvalue()
    except Exception as e:
        _log.debug("PIL-Thumb-Resize fehlgeschlagen: %s", e)
        return None


def _pil_thumb_from_file(path: str, max_px: int = _THUMB_MAX_PX) -> Optional[bytes]:
    try:
        from PIL import Image, ImageOps
        img = Image.open(path)
        img = ImageOps.exif_transpose(img)
        img.thumbnail((max_px, max_px), Image.LANCZOS)
        if img.mode != "RGB":
            img = img.convert("RGB")
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=_THUMB_JPEG_Q)
        return buf.getvalue()
    except Exception as e:
        _log.debug("PIL-Thumb-Open fehlgeschlagen (%s): %s", path, e)
        return None


def _make_thumbnail_bytes(path: str) -> Optional[bytes]:
    """Erzeugt 128×128-JPEG für JPEG/HEIC/RAW. None wenn Format ungeeignet
    oder Decode-Fehler."""
    if cexif.is_jpeg_like(path):
        return _pil_thumb_from_file(path)
    if cexif.is_heif(path):
        # extract_heif_thumbnail liefert bereits ein JPEG (bis 220 px)
        data = cexif.extract_heif_thumbnail(path, size=_THUMB_MAX_PX)
        return data
    if cexif.is_raw(path):
        preview = cexif.extract_raw_preview(path)
        if preview is None:
            return None
        # Preview ist oft groß (1-4 MP) → auf Thumb-Größe schrumpfen
        return _pil_thumb_from_bytes(preview)
    # Videos werden hier nicht unterstützt — Phase 1 ist Foto-only
    if cexif.is_video(path):
        return None
    # v0.9.199 — TIFF/PNG/BMP/WebP/GIF u.ä.: direkt via PIL. Wichtig für TIFFs
    # (auch 16-bit), die exiftool/Finder GPS zeigen, aber vorher beim Thumb
    # durchfielen → Import meldete fälschlich „kein GPS". _pil_thumb_from_file
    # konvertiert nach RGB (JPEG-tauglich).
    return _pil_thumb_from_file(path)


def _to_data_url(jpeg_bytes: Optional[bytes]) -> Optional[str]:
    if not jpeg_bytes:
        return None
    b64 = base64.b64encode(jpeg_bytes).decode("ascii")
    return f"data:image/jpeg;base64,{b64}"


def thumbnail_data_url(path: str, max_px: int = 600) -> Optional[str]:
    """v0.9.189 — Öffentlicher Thumbnail→data-URL-Helper für „Schilder mit Bild".
    Höhere Auflösung als die Foto-Pin-Thumbs (Foto-Karten werden größer gezeigt).
    Unterstützt JPEG/PNG/WebP/GIF/BMP/TIFF (PIL), HEIC/HEIF, RAW (eingebettetes Preview)."""
    try:
        data = None
        if cexif.is_heif(path):
            data = cexif.extract_heif_thumbnail(path, size=max_px)
        elif cexif.is_raw(path):
            prev = cexif.extract_raw_preview(path)
            data = _pil_thumb_from_bytes(prev, max_px) if prev else None
        else:
            data = _pil_thumb_from_file(path, max_px)
        return _to_data_url(data)
    except Exception:
        return None


def _get_thumbnail_data_url(path: str) -> Optional[str]:
    """Cache-aware Wrapper. Liefert data-URL oder None."""
    fp = _file_fingerprint(path)
    if fp:
        cached = _cache_get(fp)
        if cached:
            return _to_data_url(cached)
    data = _make_thumbnail_bytes(path)
    if data is None:
        return None
    if fp:
        _cache_put(fp, data)
    return _to_data_url(data)


# ── Öffentliche API ──────────────────────────────────────────────────────────


def expand_paths(paths_or_folder) -> list[str]:
    """Akzeptiert: Liste von Dateien, ein Ordner-String, oder Mix.
    Returns sortierte Liste absoluter Datei-Pfade die wie Fotos aussehen.
    Rekursion bei Ordnern: nicht-rekursiv (Phase 1)."""
    if isinstance(paths_or_folder, str):
        paths_or_folder = [paths_or_folder]
    out: list[str] = []
    for p in (paths_or_folder or []):
        if not p:
            continue
        ap = Path(os.path.abspath(p))
        if ap.is_dir():
            for child in sorted(ap.iterdir()):
                if child.is_file() and cexif.is_photo(str(child)):
                    out.append(str(child))
        elif ap.is_file() and cexif.is_photo(str(ap)):
            out.append(str(ap))
    return out


def load_photos_with_gps(paths_or_folder,
                         existing_paths: Optional[Iterable[str]] = None
                         ) -> dict:
    """Hauptfunktion. Lädt eine Auswahl von Fotos / Ordner und gibt nur
    die mit GPS-Koordinaten zurück.

    Args:
        paths_or_folder: Datei-Liste, Ordner, oder Mix.
        existing_paths: bereits geladene Pfade — werden NICHT übersprungen,
            aber Caller kann später dedupen. (Defensiv: kein Skip hier,
            sonst User-Verwirrung warum Foto fehlt.)

    Returns:
        {
          "photos": [{"path", "lon", "lat", "elevation", "datetime", "thumb"}, ...],
          "skipped_count": int,           # ohne GPS
          "failed_count": int,            # Thumb-Erzeugung fehlgeschlagen
          "total": int,                   # alle versuchten
        }
    """
    paths = expand_paths(paths_or_folder)
    photos = []
    skipped = 0
    failed = 0

    for path in paths:
        gps = None
        try:
            gps = cexif.read_gps(path)
        except cexif.ExifToolMissingError:
            # RAW/Video ohne exiftool — geht nicht, aber kein Crash
            gps = None
        except Exception as e:
            _log.debug("read_gps fehlgeschlagen für %s: %s", path, e)
            gps = None

        if gps is None:
            skipped += 1
            continue

        lat, lon, ele = gps
        thumb_url = _get_thumbnail_data_url(path)
        if thumb_url is None:
            failed += 1
            continue

        dt = None
        try:
            dt_obj = cexif.read_datetime(path)
            if isinstance(dt_obj, datetime):
                dt = dt_obj.isoformat()
        except Exception:
            dt = None

        photos.append({
            "path": path,
            "lon": float(lon),
            "lat": float(lat),
            "elevation": float(ele) if ele is not None else None,
            "datetime": dt,
            "thumb": thumb_url,
        })

    _log.info("load_photos_with_gps: total=%d, mit_gps=%d, skipped=%d, failed=%d",
              len(paths), len(photos), skipped, failed)

    return {
        "photos": photos,
        "skipped_count": skipped,
        "failed_count": failed,
        "total": len(paths),
    }


def compute_track_anchors(photos: list, coords: list) -> None:
    """v0.9.79 (Phase 2) — Mutiert die photo-dicts in-place: setzt
    `photo["track_anchor"]` (0..1) = nearest-track-point-Index ÷ (n-1).

    Animator-Render nutzt das im HTML-Template als Mapbox-Filter:
        ["<=", ["get", "track_anchor"], current_marker_anchor]
    → Foto-Pin erscheint erst wenn Track-Marker an dieser Stelle vorbeikommt.

    Tour-Map ruft die Funktion NICHT auf — Tour-Map zeigt alle Fotos
    permanent (Phase-1-Verhalten).

    Distanz: Euklidisch auf lon/lat. Für Distanzen unter ~50 km ausreichend
    genau (Foto→nächster Track-Punkt ist typischerweise im m-Bereich).
    Mirrors JS `PhotoPins.computeTrackAnchors`.
    """
    if not photos or not coords or len(coords) < 2:
        for p in (photos or []):
            if isinstance(p, dict):
                p["track_anchor"] = 0.0
        return
    n = len(coords)
    for p in photos:
        if not isinstance(p, dict):
            continue
        lon = p.get("lon")
        lat = p.get("lat")
        if lon is None or lat is None:
            p["track_anchor"] = 0.0
            continue
        lon = float(lon)
        lat = float(lat)
        best_idx = 0
        best_sq = float("inf")
        for i, c in enumerate(coords):
            dlon = c[0] - lon
            dlat = c[1] - lat
            d = dlon * dlon + dlat * dlat
            if d < best_sq:
                best_sq = d
                best_idx = i
        p["track_anchor"] = best_idx / (n - 1)


def refresh_thumbs_only(paths: Iterable[str]) -> dict:
    """Hilfs-Funktion: für eine bereits bekannte Pfad-Liste nur die Thumbs
    + GPS frisch holen. Nutzbar nach Projekt-Reload — die persistierten
    `path/lon/lat`-Tupel müssen mit neuen `thumb`-URLs angereichert werden,
    weil base64 wir nicht persistieren (zu groß für settings.json).

    Returns dict wie load_photos_with_gps."""
    return load_photos_with_gps(list(paths))
