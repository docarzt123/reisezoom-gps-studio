"""Tonspur fürs Video: Musik (geloopt, ein-/ausgeblendet), Foto-Klicks und Ton aus Videoclips (02.10.2026).

Marc: „Bereite auch die Musik vor … Klicksound, wenn ein Foto kommt … wir bräuchten also eine Audiospur."

Die Bilder entstehen Bild für Bild im Browser (core/szene.py); die Tonspur entsteht DANACH in einem Rutsch:
1. Die Seite liefert den Tonplan (`window.__rzTonPlan()`), alle Zeiten in Videosekunden — dieselben Zahlen, nach
   denen die Vorschau spielt (eine Wahrheit, kein Nachrechnen in Python).
2. `mischen()` dekodiert Musik/Klick/Clip-Ton mit ffmpeg zu Float-PCM, legt alles auf eine Zeitachse von genau
   Videolänge und schreibt eine WAV.
3. `anlegen()` hängt die WAV als Tonspur ans fertige Video (Bild wird nur kopiert, nicht neu kodiert).

Plan (alles optional):
  {"musik": {"datei": "builtin:unterwegs" | Pfad, "laut": 0..1.5, "ein_s": 1.0, "aus_s": 2.5, "ab_s": 0},
   "klicks": [{"t": 3.2, "laut": 0.8}], "klick_datei": "builtin:klick",
   "clips": [{"pfad": …, "ab": 0.5, "dauer": 4.0, "t": 12.3, "laut": 1.0}],
   "ducken": 0.35}            # Musik-Faktor, während ein Clip mit Ton läuft
"""
from __future__ import annotations

import logging
import os
import subprocess
import wave
from pathlib import Path
from typing import Optional

# 04.10.2026 (Tester-Meldung zu 0.9.778: „No module named 'numpy'" — jeder Render brach ab, weil szene.py dieses
# Modul beim Start lädt und die .spec numpy ausschloss). numpy ist jetzt im Bundle; fehlt es trotzdem, wird das
# Video stumm statt gar nicht gerendert.
try:
    import numpy as np
except ImportError:  # pragma: no cover — nur in einem kaputten Bundle
    np = None

from . import dateischutz as _ds

log = logging.getLogger(__name__)

SR = 48000
EINGEBAUT = {"unterwegs": "musik_unterwegs.flac", "weite": "musik_weite.flac", "gipfelsturm": "musik_gipfelsturm.flac",
             "rast": "musik_rast.flac", "grat": "musik_grat.flac", "wanderlied": "musik_wanderlied.flac",
             "klick": "foto_klick.wav", **{f"klick_{k}": f"foto_klick_{k}.wav" for k in "abcdefghij"}}
STUECKE = ("unterwegs", "weite", "gipfelsturm", "rast", "grat", "wanderlied")   # scripts/musik_komponieren.py, musik_stile.py
# Formate, die eine Tonspur tragen (GIF/Bildfolgen nicht)
MIT_TON = {".mp4": ("aac", ["-b:a", "192k"]), ".m4v": ("aac", ["-b:a", "192k"]), ".mov": ("aac", ["-b:a", "256k"]),
           ".mkv": ("aac", ["-b:a", "192k"]), ".webm": ("libopus", ["-b:a", "160k"])}


def ui_audio_dir() -> Path:
    import sys
    base = Path(getattr(sys, "_MEIPASS", "") or Path(__file__).resolve().parent.parent)
    return base / "ui" / "audio"


def datei_aufloesen(datei: str) -> Optional[Path]:
    """„builtin:<name>" → Datei im App-Bundle, sonst der Pfad selbst (wenn vorhanden)."""
    if not datei:
        return None
    if datei.startswith("builtin:"):
        name = EINGEBAUT.get(datei.split(":", 1)[1])
        p = ui_audio_dir() / name if name else None
    else:
        p = Path(datei).expanduser()
    return p if p and p.is_file() else None


def plan_leer(plan: Optional[dict]) -> bool:
    if not plan:
        return True
    m = plan.get("musik") or {}
    return not (m.get("datei") and float(m.get("laut", 0) or 0) > 0) and not plan.get("klicks") \
        and not any(float(c.get("laut", 0) or 0) > 0 for c in (plan.get("clips") or []))


def _dekodieren(ffmpeg: str, pfad: Path, ab: float = 0.0, dauer: Optional[float] = None) -> np.ndarray:
    """Datei → Float-Stereo (n, 2) bei SR. Ohne Tonspur → leeres Array."""
    cmd = [ffmpeg, "-v", "error"]
    if ab > 0:
        cmd += ["-ss", f"{ab:.3f}"]
    if dauer is not None:
        cmd += ["-t", f"{max(0.0, dauer):.3f}"]
    cmd += ["-i", str(pfad), "-vn", "-map", "0:a:0?", "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"]
    try:
        r = subprocess.run(cmd, capture_output=True, timeout=300, **_ohne_fenster())
    except Exception as e:  # noqa: BLE001
        log.warning("Tonspur: %s nicht lesbar: %s", pfad, e)
        return np.zeros((0, 2), np.float32)
    if r.returncode != 0 or not r.stdout:
        return np.zeros((0, 2), np.float32)
    a = np.frombuffer(r.stdout, dtype="<f4")
    return a[: len(a) // 2 * 2].reshape(-1, 2).copy()


def _ohne_fenster() -> dict:
    if os.name == "nt":
        return {"creationflags": 0x08000000}
    return {}


def _rampe(n: int, ein: int, aus: int) -> np.ndarray:
    g = np.ones(n, np.float32)
    if ein > 0:
        k = min(ein, n)
        g[:k] = np.linspace(0, 1, k, endpoint=False) ** 2
    if aus > 0:
        k = min(aus, n)
        g[n - k:] *= np.linspace(1, 0, k) ** 2
    return g


def mischen(plan: dict, dauer_s: float, ziel_wav: Path, ffmpeg: str) -> dict:
    """Plan → WAV mit genau `dauer_s` Länge. Gibt eine kleine Zusammenfassung zurück (für Log und Tests)."""
    n = max(1, int(round(dauer_s * SR)))
    mix = np.zeros((n, 2), np.float32)
    info = {"musik": False, "klicks": 0, "clips": 0}
    # Ton aus Clips zuerst (bestimmt, wo die Musik leiser wird)
    duck = np.ones(n, np.float32)
    for c in plan.get("clips") or []:
        laut = float(c.get("laut", 0) or 0)
        p = datei_aufloesen(str(c.get("pfad") or ""))
        if laut <= 0 or not p:
            continue
        x = _dekodieren(ffmpeg, p, float(c.get("ab", 0) or 0), float(c.get("dauer", 0) or 0))
        if not len(x):
            continue
        i0 = int(round(float(c.get("t", 0)) * SR))
        if i0 >= n:
            continue
        x = x[: n - max(0, i0)]
        if i0 < 0:
            x = x[-i0:]; i0 = 0
        x = x * _rampe(len(x), int(0.08 * SR), int(0.12 * SR))[:, None] * laut
        mix[i0:i0 + len(x)] += x
        d = float(plan.get("ducken", 0.35))
        weich = int(0.4 * SR)
        a, b = max(0, i0 - weich), min(n, i0 + len(x) + weich)
        hull = np.ones(b - a, np.float32)
        hull[:i0 - a] = np.linspace(1, d, i0 - a) if i0 > a else hull[:0]
        hull[i0 - a:i0 - a + len(x)] = d
        rest = b - (i0 + len(x))
        if rest > 0:
            hull[-rest:] = np.linspace(d, 1, rest)
        duck[a:b] = np.minimum(duck[a:b], hull)
        info["clips"] += 1
    # Musik: von vorn (ggf. ab Versatz), geloopt bis Videoende, ein-/ausgeblendet
    m = plan.get("musik") or {}
    p = datei_aufloesen(str(m.get("datei") or ""))
    laut = float(m.get("laut", 0) or 0)
    if p and laut > 0:
        x = _dekodieren(ffmpeg, p)
        if len(x):
            ab = int(max(0.0, float(m.get("ab_s", 0) or 0)) * SR) % len(x)
            reps = (n + ab) // len(x) + 1
            spur = np.tile(x, (reps, 1))[ab:ab + n]
            g = _rampe(n, int(float(m.get("ein_s", 1.0) or 0) * SR), int(float(m.get("aus_s", 2.5) or 0) * SR))
            mix += spur * (g * duck * laut)[:, None]
            info["musik"] = True
    # Klicks
    if plan.get("klicks"):
        kp = datei_aufloesen(str(plan.get("klick_datei") or "builtin:klick"))
        k = _dekodieren(ffmpeg, kp) if kp else np.zeros((0, 2), np.float32)
        if len(k):
            for c in plan["klicks"]:
                i0 = int(round(float(c.get("t", 0)) * SR))
                if not (0 <= i0 < n):
                    continue
                y = k[: n - i0] * float(c.get("laut", 0.8) or 0)
                mix[i0:i0 + len(y)] += y
                info["klicks"] += 1
    # sanft begrenzen (nur oberhalb −1 dBFS wirksam)
    grenze = 10 ** (-1 / 20)
    ueber = np.abs(mix) > grenze
    if ueber.any():
        mix[ueber] = np.sign(mix[ueber]) * (grenze + (1 - grenze) * np.tanh((np.abs(mix[ueber]) - grenze) / (1 - grenze)))
    ziel_wav.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(ziel_wav), "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((np.clip(mix, -1, 1) * 32767).astype("<i2").tobytes())
    info["spitze_db"] = round(float(20 * np.log10(max(1e-9, float(np.max(np.abs(mix)))))), 1)
    return info


def video_dauer(ffmpeg: str, video: Path) -> Optional[float]:
    """Länge über ffprobe (neben ffmpeg) oder, falls keins da, aus ffmpegs eigener Ausgabe."""
    probe = Path(ffmpeg).with_name("ffprobe" + (".exe" if os.name == "nt" else ""))
    if probe.is_file():
        try:
            r = subprocess.run([str(probe), "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(video)],
                               capture_output=True, text=True, timeout=60, **_ohne_fenster())
            return float(r.stdout.strip())
        except Exception:  # noqa: BLE001
            pass
    try:
        r = subprocess.run([ffmpeg, "-i", str(video)], capture_output=True, text=True, timeout=60, **_ohne_fenster())
        import re
        mt = re.search(r"Duration: (\d+):(\d+):([\d.]+)", r.stderr)
        if mt:
            return int(mt.group(1)) * 3600 + int(mt.group(2)) * 60 + float(mt.group(3))
    except Exception:  # noqa: BLE001
        pass
    return None


def anlegen(video: str, plan: Optional[dict], ffmpeg: str, dauer_s: Optional[float] = None) -> dict:
    """Tonspur ins fertige Video legen (Bild wird kopiert). Ohne Plan / ohne Ton → nichts tun."""
    v = Path(video)
    ext = v.suffix.lower()
    if plan_leer(plan) or ext not in MIT_TON or not v.is_file():
        return {"ok": True, "ton": False}
    if np is None:
        return {"ok": False, "ton": False, "error": "numpy fehlt im Programmpaket — Video bleibt stumm"}
    dauer = dauer_s or video_dauer(ffmpeg, v)
    if not dauer:
        return {"ok": False, "ton": False, "error": "Videolänge unbekannt"}
    wav = v.with_name(v.stem + ".ton.wav")
    tmp = v.with_name(v.stem + ".mitton" + v.suffix)
    try:
        info = mischen(plan or {}, dauer, wav, ffmpeg)
        codec, extra = MIT_TON[ext]
        cmd = [ffmpeg, "-y", "-v", "error", "-i", str(v), "-i", str(wav), "-map", "0:v:0", "-map", "1:a:0",
               "-c:v", "copy", "-c:a", codec, *extra]
        if ext in (".mp4", ".m4v", ".mov"):
            cmd += ["-movflags", "+faststart"]
        cmd += ["-shortest", str(tmp)]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=600, **_ohne_fenster())
        if r.returncode != 0 or not tmp.is_file():
            log.warning("Tonspur: ffmpeg fehlgeschlagen: %s", (r.stderr or "")[-400:])
            return {"ok": False, "ton": False, "error": (r.stderr or "ffmpeg")[-300:]}
        # Ziel = der gerade gerenderte Film am vom Nutzer gewählten Platz; das stumme Zwischenergebnis wird ersetzt
        # (eigene Zwischenstufe desselben Vorgangs → keine Sicherung)
        _ds.nutzer_ziel(v); _ds.nutzer_ziel(tmp)
        _ds.ersetzen(tmp, v, "tonspur", art=_ds.ART_TEMP)
        log.info("Tonspur angelegt: %s (%s)", v.name, info)
        return {"ok": True, "ton": True, **info}
    finally:
        for f in (wav, tmp):
            try:
                if os.path.lexists(f):
                    _ds.nutzer_ziel(f)
                    _ds.loeschen(f, "tonspur", art=_ds.ART_TEMP)
            except Exception:  # noqa: BLE001 — Aufräumen darf den echten Fehler nie verdecken
                pass
