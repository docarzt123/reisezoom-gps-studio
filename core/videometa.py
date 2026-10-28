"""Herkunft im fertigen Video: womit, in welcher Ausgabe und Version gebaut (27.10.2026).

Anlass (Marc): Ein Nutzer schickte ein Video, das bei ihm nicht lief (4K auf seinen Geräten); aus der Datei allein war
nicht zu sehen, womit und mit welcher Version sie entstanden war. Gemeinsames Schema mit der Web-Version und iOS:

* ``©too`` (Software)  „GPS Studio by Reisezoom.com — Desktop 0.9.845 macOS“
* ``©cmt`` (Kommentar) „Erstellt mit GPS Studio by Reisezoom.com · reisezoom.com/gps · Desktop 0.9.845 · macOS 27.0 ·
  3840×2160 · 30 fps“ — nur Programm, System und Videowerte, nichts Persönliches
* ``©nam`` (Titel)     Titel der Tour, wenn einer gesetzt ist

ffmpeg schreibt ``©too`` immer mit seiner eigenen Kennung („Lavf…“) über; deshalb setzt ExifTool (liegt der App bei)
die drei Felder nach dem Rendern. Kommentar und Titel gibt schon ffmpeg mit (``ffmpeg_args``) — fehlt ExifTool (Linux
ohne Paket), steht die Herkunft so wenigstens im Kommentar.
"""
from __future__ import annotations

import logging
import platform
import subprocess
from pathlib import Path
from typing import Optional

log = logging.getLogger("rzgps.videometa")

MARKE = "GPS Studio by Reisezoom.com"
ADRESSE = "reisezoom.com/gps"
AUSGABE = "Desktop"
_ENDUNGEN = (".mp4", ".m4v", ".mov")


def _system() -> tuple[str, str]:
    """("macOS", "27.0") · ("Windows", "11") · ("Linux", "6.8")."""
    s = platform.system()
    if s == "Darwin":
        return "macOS", platform.mac_ver()[0] or ""
    if s == "Windows":
        return "Windows", platform.release() or ""
    return (s or "Linux"), (platform.release() or "").split("-")[0]


def software(version: str) -> str:
    return f"{MARKE} — {AUSGABE} {version} {_system()[0]}"


def kommentar(version: str, breite: int = 0, hoehe: int = 0, fps: float = 0) -> str:
    name, ver = _system()
    teile = [f"Erstellt mit {MARKE}", ADRESSE, f"{AUSGABE} {version}", f"{name} {ver}".strip()]
    if breite and hoehe:
        teile.append(f"{int(breite)}×{int(hoehe)}")
    if fps:
        teile.append(f"{fps:g} fps")
    return " · ".join(teile)


def titel_aus_animator(anim: Optional[dict]) -> str:
    """Titel der Tour aus dem Projekt: Titelkarte des Schnell-Videos, sonst die erste Titel-Einblendung."""
    a = anim if isinstance(anim, dict) else {}
    sk = a.get("schnellkarte") if isinstance(a.get("schnellkarte"), dict) else {}
    if sk.get("titel_an") and str(sk.get("titel") or "").strip():
        return str(sk["titel"]).strip()
    for c in a.get("container") or []:
        if isinstance(c, dict) and c.get("vorlage") == "titel" and c.get("an", True) is not False:
            for z in c.get("zeilen") or []:
                if isinstance(z, dict) and z.get("typ") == "text" and str(z.get("text") or "").strip():
                    return str(z["text"]).strip()
    return ""


def ffmpeg_args(pfad: str, version: str, breite: int, hoehe: int, fps: float, titel: str = "") -> list[str]:
    """`-metadata` für den ffmpeg-Aufruf (nur MP4/MOV) — Kommentar und Titel; ©too setzt erst `schreiben`."""
    # MOV nicht: ffmpeg schreibt dort UserData, ExifTool hängte seine Felder daneben (doppelter Kommentar) — bei MOV setzt
    # `schreiben` alles allein
    if Path(str(pfad)).suffix.lower() not in (".mp4", ".m4v"):
        return []
    args = ["-metadata", "comment=" + kommentar(version, breite, hoehe, fps)]
    if titel:
        args += ["-metadata", "title=" + titel]
    return args


def schreiben(pfad: str, version: str, breite: int, hoehe: int, fps: float, titel: str = "",
              exiftool: Optional[str] = None) -> bool:
    """Die drei Felder ins fertige Video (MP4/MOV) schreiben. Scheitert still — das Video ist ja fertig."""
    p = Path(str(pfad))
    if p.suffix.lower() not in _ENDUNGEN or not p.is_file():
        return False
    if exiftool is None:
        try:
            from core.exif import find_exiftool
            exiftool = find_exiftool()
        except Exception:  # noqa: BLE001
            exiftool = None
    if not exiftool:
        log.info("Video-Herkunft: kein ExifTool — nur Kommentar/Titel aus ffmpeg")
        return False
    try:
        from core import dateischutz as _ds
        # Das Video ist eben selbst gerendert, am vom Nutzer gewählten Ziel — es IST das Ergebnis, eine Sicherung davor
        # gäbe es nur von sich selbst (wie die Tonspur, core/tonspur.anlegen)
        _ds.nutzer_ziel(p)
        _ds.foto_schreiben_pruefen(p, gesichert=True)
    except Exception as e:  # noqa: BLE001 — Dateischutz sagt nein: Video bleibt, wie es ist
        log.warning("Video-Herkunft: %s", e)
        return False
    werte = {"Encoder": software(version), "Comment": kommentar(version, breite, hoehe, fps)}
    if titel:
        werte["Title"] = titel
    # Geschrieben wird die iTunes-Liste (ItemList, UTF-8). Bei MOV legt ffmpeg selbst UserData-©swr „Lavf…“ an, das
    # ffprobe/QuickTime dort zuerst lesen — wird gelöscht. Eigene UserData-Texte nicht: die liest ffprobe als MacRoman
    # („·“ wurde zu „¬∑“).
    cmd = [exiftool, "-overwrite_original", "-q", "-m", "-charset", "UTF8", "-charset", "QuickTime=UTF8"]
    cmd += [f"-ItemList:{k}={v}" for k, v in werte.items()]
    if p.suffix.lower() == ".mov":
        cmd += [f"-UserData:{k}=" for k in werte] + ["-UserData:SoftwareVersion="]   # ffmpeg: ©swr „Lavf…“
    cmd.append(str(p))
    try:
        kw = {}
        if platform.system() == "Windows":
            kw["creationflags"] = 0x08000000   # CREATE_NO_WINDOW
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=600, **kw)
        if r.returncode != 0:
            log.warning("Video-Herkunft: ExifTool %s: %s", r.returncode, (r.stderr or "")[-300:])
            return False
        return True
    except Exception as e:  # noqa: BLE001
        log.warning("Video-Herkunft: %s", e)
        return False
