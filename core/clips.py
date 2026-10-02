"""Videoclips im Video: Kenndaten, Standbild und Einzelbilder (02.10.2026).

Marc: „Videos wäre auch noch was" → ein Clip ist ein Fotostopp mit Bewegtbild. Das große „Foto" wächst wie
gewohnt aus dem Pin, im Halt laufen die Bilder des Clips.

Warum Einzelbilder statt <video>: Das Video entsteht Bild für Bild in Chromium (core/szene.py), und dessen
Playwright-Build spielt kein H.264/HEVC. Außerdem muss jedes Bild exakt zur Videozeit passen — ein
<video>-Element liefert beim Springen nicht verlässlich das richtige Bild. Also zerlegt ffmpeg den gewählten
Ausschnitt einmal in JPEGs (Cache), Vorschau und Render zeigen Bild n zur Zeit n/fps. Die Vorschau holt sie
über den lokalen Medien-Server (app.py, Pfad /clip/<token>/<n>.jpg).
"""
from __future__ import annotations

import hashlib
import logging
import os
import re
import subprocess
from pathlib import Path
from typing import Optional

from . import dateischutz as _ds

log = logging.getLogger(__name__)

CACHE_DIR: Optional[Path] = None          # setzt app.py (APP_SUPPORT/clip_cache)
# 360°-Rohdateien (Insta360 .insv) und Vorschau-Kopien (.lrv) sind als Clip nicht brauchbar
CLIP_ENDUNGEN = {".mp4", ".mov", ".m4v", ".mts", ".m2ts", ".avi", ".mkv", ".3gp", ".qt"}


def taugt(pfad: str) -> bool:
    return Path(str(pfad)).suffix.lower() in CLIP_ENDUNGEN


def _ffmpeg() -> str:
    from . import animator as A
    return A.find_ffmpeg()


def _kw() -> dict:
    return {"creationflags": 0x08000000} if os.name == "nt" else {}


def _schluessel(pfad: str) -> str:
    try:
        st = os.stat(pfad)
        roh = f"{os.path.abspath(pfad)}|{st.st_size}|{int(st.st_mtime)}"
    except OSError:
        roh = os.path.abspath(pfad)
    return hashlib.sha1(roh.encode("utf-8")).hexdigest()[:16]


def ordner(pfad: str) -> Path:
    base = CACHE_DIR or (Path.home() / ".rz_clip_cache")
    d = base / _schluessel(pfad)
    d.mkdir(parents=True, exist_ok=True)
    return d


def info(pfad: str) -> dict:
    """Länge, Bildgröße, Ton ja/nein — aus ffmpegs eigener Ausgabe (ffprobe ist nicht überall gebündelt)."""
    if not pfad or not os.path.isfile(pfad):
        return {"ok": False, "error": "Datei fehlt"}
    try:
        r = subprocess.run([_ffmpeg(), "-hide_banner", "-i", pfad], capture_output=True, text=True, timeout=60, **_kw())
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}
    t = r.stderr or ""
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", t)
    dauer = (int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))) if m else 0.0
    vm = re.search(r"Stream #[^\n]*Video:[^\n]*?(\d{2,5})x(\d{2,5})", t)
    w, h = (int(vm.group(1)), int(vm.group(2))) if vm else (0, 0)
    # Drehung (Hochkant-Handyvideos): ffmpeg dreht beim Dekodieren selbst — Maße entsprechend tauschen
    rot = re.search(r"rotation of (-?\d+(?:\.\d+)?) degrees|rotate\s*:\s*(-?\d+)", t)
    if rot:
        g = abs(int(float(rot.group(1) or rot.group(2)))) % 180
        if g == 90:
            w, h = h, w
    ton = bool(re.search(r"Stream #[^\n]*Audio:", t))
    if dauer <= 0 or not w:
        return {"ok": False, "error": "kein Video"}
    return {"ok": True, "dauer": round(dauer, 3), "breite": w, "hoehe": h, "ton": ton}


def standbild(pfad: str, t: float = 0.5) -> Optional[str]:
    """JPEG eines Bildes bei `t` Sekunden (Pin, Fotokarte vor dem Abspielen, Timeline). Gecacht."""
    z = ordner(pfad) / f"standbild_{int(round(t * 1000))}.jpg"
    if z.is_file() and z.stat().st_size > 0:
        return str(z)
    for tt in (t, 0.0):
        try:
            subprocess.run([_ffmpeg(), "-y", "-v", "error", "-ss", f"{max(0.0, tt):.3f}", "-i", pfad, "-frames:v", "1",
                            "-vf", "scale='min(1600,iw)':-2", "-q:v", "3", str(z)], capture_output=True, timeout=120, **_kw())
        except Exception as e:  # noqa: BLE001
            log.warning("Clip-Standbild %s: %s", pfad, e)
        if z.is_file() and z.stat().st_size > 0:
            return str(z)
    return None


def ton(pfad: str, ab: float, dauer: float) -> Optional[str]:
    """Ton des Ausschnitts als kleine WAV (48 kHz Stereo) — für die Vorschau (Web Audio). Gecacht; ohne Tonspur None."""
    ab = max(0.0, float(ab or 0)); dauer = max(0.2, float(dauer or 1))
    z = ordner(pfad) / f"ton_{int(ab * 1000)}_{int(dauer * 1000)}.wav"
    if z.is_file() and z.stat().st_size > 1000:
        return str(z)
    try:
        subprocess.run([_ffmpeg(), "-y", "-v", "error", "-ss", f"{ab:.3f}", "-t", f"{dauer:.3f}", "-i", pfad, "-vn", "-map", "0:a:0?",
                        "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", str(z)], capture_output=True, timeout=120, **_kw())
    except Exception as e:  # noqa: BLE001
        log.warning("Clip-Ton %s: %s", pfad, e)
    return str(z) if z.is_file() and z.stat().st_size > 1000 else None


def bilder(pfad: str, ab: float, dauer: float, fps: float, hoehe: int) -> dict:
    """Ausschnitt [ab, ab+dauer] als JPEG-Folge (000001.jpg …) mit `fps` Bildern/s, `hoehe` px hoch. Gecacht."""
    fps = max(1.0, min(60.0, float(fps or 25)))
    hoehe = int(max(120, min(2160, int(hoehe or 720))))
    hoehe -= hoehe % 2
    ab = max(0.0, float(ab or 0)); dauer = max(0.2, float(dauer or 1))
    d = ordner(pfad) / f"f_{int(ab * 1000)}_{int(dauer * 1000)}_{int(fps * 100)}_{hoehe}"
    soll = int(round(dauer * fps))
    fertig = d / "fertig"
    if fertig.is_file():
        n = len(list(d.glob("*.jpg")))
        return {"ok": True, "ordner": str(d), "n": n, "fps": fps}
    d.mkdir(parents=True, exist_ok=True)
    for f in d.glob("*.jpg"):   # halbfertiger Lauf von vorher (ohne „fertig") — Cache, neu erzeugbar
        try: _ds.loeschen(f, "clip_cache", art=_ds.ART_CACHE)
        except Exception as e:  # noqa: BLE001
            log.warning("Clip-Cache: %s", e)
    cmd = [_ffmpeg(), "-y", "-v", "error", "-ss", f"{ab:.3f}", "-t", f"{dauer:.3f}", "-i", pfad, "-an",
           "-vf", f"fps={fps},scale=-2:{hoehe}", "-q:v", "3", "-start_number", "1", str(d / "%06d.jpg")]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=600, **_kw())
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}
    n = len(list(d.glob("*.jpg")))
    if r.returncode != 0 or n == 0:
        return {"ok": False, "error": (r.stderr or "ffmpeg")[-300:]}
    fertig.write_text(str(n))
    log.info("Clip-Bilder: %s · %.1f–%.1f s · %d Bilder (%d erwartet) · %d px", Path(pfad).name, ab, ab + dauer, n, soll, hoehe)
    return {"ok": True, "ordner": str(d), "n": n, "fps": fps}
