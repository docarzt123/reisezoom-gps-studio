"""
EXIF read/write für Fotos. Drei Backends:

1. **piexif** für JPEG/TIFF — schnell, in-process, kein Subprocess.
2. **pillow-heif** für HEIC/HEIF — in-process via Pillow-Plugin. Liefert
   Thumbnails direkt + EXIF-Bytes die wir mit piexif parsen. v0.9.57 (Marc/
   Beta-Tester-Bug): Vorher liefen HEIC durch exiftool — wenn das nicht installiert
   war (typisch auf Windows-User-Macs), blieben HEIC-Thumbnails leer.
3. **exiftool** für RAW-Formate (CR3, CR2, NEF, ARW, RAF, ORF, DNG, ...) und
   als HEIC-Fallback wenn pillow-heif fehlt.

`read_datetime()` / `read_gps()` / `write_gps()` routen automatisch auf das
richtige Backend basierend auf der Datei-Endung. Wenn exiftool fehlt UND
ein RAW-Format gelesen werden soll → ExifToolMissingError mit Hinweis.
"""
from __future__ import annotations

import atexit
import json
import logging
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from typing import Any, Optional

import piexif

# v0.9.274 (Beta-Tester-Bug) — Windows: Kindprozesse (exiftool-Daemon, ffmpeg) OHNE
# sichtbares Konsolenfenster starten. Auf POSIX 0 (kein Effekt).
_WIN_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0

_log = logging.getLogger("reisezoom.exif")

# v0.9.57 — pillow-heif als HEIC-Decoder registrieren (optional).
# Wenn pillow-heif nicht installiert/bundelt ist, fallen wir auf exiftool zurück.
_HEIF_AVAILABLE = False
try:
    import pillow_heif  # type: ignore
    pillow_heif.register_heif_opener()
    _HEIF_AVAILABLE = True
except Exception as _heif_err:
    _log.warning("pillow-heif nicht verfügbar — HEIC-Support nur via exiftool. (%s)", _heif_err)


# ── Konfiguration ─────────────────────────────────────────────────────────────

JPEG_LIKE_EXTS = {".jpg", ".jpeg", ".jpe"}
# v0.9.154 — TIFF aus JPEG_LIKE rausgezogen: piexif.insert() unterstützt NUR
# echtes JPEG (SOI-Marker) und wirft bei TIFF InvalidImageDataError. Lesen geht
# weiter über piexif.load() (kann TIFF), aber GESCHRIEBEN wird TIFF über exiftool
# (wie RAW). Ohne diese Trennung schlug das GPS-Taggen von .tif/.tiff (z.B.
# Olympus/OM-Kamera-TIFFs) komplett fehl.
TIFF_EXTS = {".tif", ".tiff"}
# v0.9.57 — HEIC/HEIF aus RAW_EXTS rausgezogen: separates Routing, weil
# pillow-heif (in-process) sie ohne exiftool öffnen kann.
HEIF_EXTS = {".heic", ".heif"}
RAW_EXTS = {".cr3", ".cr2", ".crw", ".nef", ".nrw", ".arw", ".srf", ".sr2",
            ".raf", ".rw2", ".orf", ".dng", ".pef", ".rwl", ".srw"}
# Videos: QuickTime/ISO-Container (MP4/MOV) + Action-Cam-Varianten.
# `.insv`/`.insp` (Insta360), `.mts`/`.m2ts` (AVCHD), `.lrv`/`.thm` (GoPro-Low-Res).
VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".qt", ".insv", ".insp",
              ".mts", ".m2ts", ".lrv", ".3gp", ".avi", ".mkv"}
ALL_PHOTO_EXTS = JPEG_LIKE_EXTS | TIFF_EXTS | HEIF_EXTS | RAW_EXTS
ALL_MEDIA_EXTS = ALL_PHOTO_EXTS | VIDEO_EXTS


class ExifToolMissingError(RuntimeError):
    pass


def is_raw(path: str) -> bool:
    return os.path.splitext(path)[1].lower() in RAW_EXTS


def is_heif(path: str) -> bool:
    """v0.9.57 — HEIC/HEIF separates Routing: pillow-heif statt exiftool."""
    return os.path.splitext(path)[1].lower() in HEIF_EXTS


def is_jpeg_like(path: str) -> bool:
    return os.path.splitext(path)[1].lower() in JPEG_LIKE_EXTS


def is_tiff(path: str) -> bool:
    """v0.9.154 — TIFF: lesen via piexif.load(), SCHREIBEN via exiftool."""
    return os.path.splitext(path)[1].lower() in TIFF_EXTS


def is_photo(path: str) -> bool:
    return os.path.splitext(path)[1].lower() in ALL_PHOTO_EXTS


def is_video(path: str) -> bool:
    return os.path.splitext(path)[1].lower() in VIDEO_EXTS


def is_media(path: str) -> bool:
    """Foto ODER Video."""
    return os.path.splitext(path)[1].lower() in ALL_MEDIA_EXTS


def _bundled_exiftool() -> Optional[str]:
    """v0.9.61 — Sucht das gebundlete exiftool zuerst (PyInstaller + Dev-Mode).
    macOS + Windows haben das Binary im App-Bundle, Linux nicht (per Marc-
    Regel: Linux-User installieren selbst via Paketmanager). Bei Dev-Mode
    suchen wir in `vendor/exiftool/{macos,windows/...}/` relativ zum Projekt."""
    import sys as _sys
    candidates = []
    # PyInstaller: sys._MEIPASS zeigt aufs Resources-Verzeichnis
    meipass = getattr(_sys, "_MEIPASS", None)
    if meipass:
        if _sys.platform == "darwin":
            candidates.append(os.path.join(meipass, "exiftool", "exiftool"))
        elif _sys.platform == "win32":
            candidates.append(os.path.join(meipass, "exiftool", "exiftool.exe"))
    # Dev-Mode: relativ zum Projekt-Root (vendor/exiftool/...)
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if _sys.platform == "darwin":
        candidates.append(os.path.join(here, "vendor", "exiftool", "macos", "exiftool"))
    elif _sys.platform == "win32":
        candidates.append(os.path.join(here, "vendor", "exiftool", "windows", "exiftool-13.58_64", "exiftool.exe"))
    for cand in candidates:
        if os.path.isfile(cand) and os.access(cand, os.X_OK):
            return cand
    return None


def find_exiftool() -> Optional[str]:
    """Sucht exiftool. Reihenfolge:
    1. Gebündeltes Binary (App-Bundle/Dev-vendor — macOS + Windows) — v0.9.61
    2. PATH (System-Install via Homebrew, apt, yum etc.)
    3. Typische macOS-Pfade (Fallback)
    None wenn nicht gefunden."""
    bundled = _bundled_exiftool()
    if bundled:
        return bundled
    p = shutil.which("exiftool")
    if p:
        return p
    for cand in ("/opt/homebrew/bin/exiftool", "/usr/local/bin/exiftool", "/usr/bin/exiftool"):
        if os.path.isfile(cand):
            return cand
    return None


# ── ExifTool Stay-Open-Daemon ─────────────────────────────────────────────────
#
# exiftool ist ein Perl-Skript. Jeder fresh-subprocess-Start braucht ~0.5–1 s
# allein für das Booten von Perl + Tabellen-Loading. Bei 200 RAWs × 3 Aufrufen
# pro Foto wären das ~10 Minuten Overhead.
#
# Lösung: exiftool kennt `-stay_open True -@ -`. Damit läuft genau EIN Prozess
# und nimmt Argumente über stdin entgegen, mit `-execute` als Trenner zwischen
# Aufrufen. Antworten kommen auf stdout, terminiert mit der Marker-Zeile
# `{ready}` (oder `{ready<N>}` wenn man eine ID mitschickt).
#
# Wir betreiben den Daemon Thread-safe als Singleton.

import threading as _threading


def _kill_proc_group(proc) -> None:
    """Killt einen Subprozess HART — inkl. seiner Process-Group auf POSIX.

    v0.9.190: Der Daemon wird mit `start_new_session=True` gestartet, ist also
    Leader einer eigenen Group (pgid == pid). `os.killpg(SIGKILL)` erwischt damit
    auch evtl. von exiftool/perl gestartete Kindprozesse. Fällt auf `proc.kill()`
    zurück, wenn killpg nicht verfügbar/anwendbar ist (Windows, race)."""
    if proc is None:
        return
    try:
        if os.name == "posix":
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass
        else:
            proc.kill()
    except Exception:
        pass
    # Zombie reapen, damit kein <defunct> hängen bleibt.
    try:
        proc.wait(timeout=3)
    except Exception:
        pass


def reap_orphan_daemons() -> int:
    """Killt verwaiste `exiftool -stay_open`-Daemons aus FRÜHEREN App-Sessions.

    v0.9.190: Das eigentliche Sicherheitsnetz für Marcs Bug. Wenn der explizite
    Shutdown NICHT lief — App-Crash, Force-Quit, `os._exit` mit hängendem Worker,
    `kill -9` — dann läuft KEIN In-Process-Handler (auch atexit nicht), und ein
    verwaister exiftool-Prozess bleibt liegen (Marc 2026-06-08: 6 Waisen seit
    30.05.). Beim nächsten App-Start räumen wir solche Reste auf, BEVOR wir
    eigene Daemons starten.

    POSIX-only (pgrep/ps). Matcht nur UNSERE exiftool-Binary (Bundle-/Repo-Pfad),
    damit ein evtl. eigenständig laufender exiftool-Prozess des Users (anderer
    Pfad) nicht abgeschossen wird. Edge-Case: zwei parallel laufende Instanzen
    der App würden sich gegenseitig die Daemons killen — in der Praxis ist die
    App single-instance, daher akzeptabel.
    """
    if os.name != "posix":
        return 0
    et = find_exiftool()
    if not et:
        return 0
    killed = 0
    try:
        out = subprocess.run(
            ["pgrep", "-f", "exiftool -stay_open"],
            capture_output=True, text=True, timeout=5,
        )
        me = os.getpid()
        for tok in out.stdout.split():
            if not tok.strip().isdigit():
                continue
            pid = int(tok)
            if pid == me:
                continue
            try:
                cmd = subprocess.run(
                    ["ps", "-o", "command=", "-p", str(pid)],
                    capture_output=True, text=True, timeout=3,
                ).stdout
            except Exception:
                continue
            # Nur UNSERE exiftool-Instanz killen (Pfad-Match verhindert Fremd-Kills).
            if et not in cmd:
                continue
            try:
                os.kill(pid, signal.SIGKILL)
                killed += 1
            except Exception:
                pass
        if killed:
            _log.info("reap_orphan_daemons: %d verwaiste exiftool-Daemon(s) gekillt", killed)
    except Exception as e:
        try:
            _log.debug("reap_orphan_daemons: %s", e)
        except Exception:
            pass
    return killed


class _ExifToolDaemon:
    """Persistenter exiftool-Prozess. Thread-safe.

    v0.9.151: Es gibt ZWEI separate Daemon-Instanzen mit je eigenem Prozess
    UND eigenem Lock:
      - role="read"  → Thumbnails/Meta-Reads (Vorschau-Worker)
      - role="write" → GPS-Schreibvorgänge (Geotagger-Write)
    Grund: vorher serialisierte EIN globaler Lock alles. Ein langsamer/hängender
    Video-Vorschau-Read (OM .mov) blockierte dann GPS-Writes für Stunden →
    „es werden keine GPS-Daten geschrieben". Mit getrennten Daemons kann eine
    blockierende Vorschau einen Write NIE mehr aushungern.
    """

    _instances: "dict[str, _ExifToolDaemon]" = {}
    _instance_lock = _threading.Lock()
    _reaped = False  # v0.9.190: Orphan-Reap nur einmal pro Prozess

    @classmethod
    def get(cls, role: str = "read") -> "Optional[_ExifToolDaemon]":
        """Daemon für eine Rolle holen ('read' | 'write'). None wenn exiftool fehlt."""
        with cls._instance_lock:
            # v0.9.190: Beim allerersten Daemon-Zugriff verwaiste Daemons aus
            # einer vorherigen (abgestürzten/force-gequitteten) Session reapen.
            # _instances ist hier garantiert leer → es gibt keine eigenen
            # Daemons, die wir versehentlich treffen könnten.
            if not cls._reaped:
                cls._reaped = True
                try:
                    reap_orphan_daemons()
                except Exception:
                    pass
            inst = cls._instances.get(role)
            if inst is None:
                et = find_exiftool()
                if not et:
                    _log.warning("ExifToolDaemon[%s]: exiftool NICHT gefunden", role)
                    return None
                inst = cls(et)
                cls._instances[role] = inst
                _log.info("ExifToolDaemon[%s]: Prozess gestartet (%s, pid=%s)",
                          role, et, getattr(inst._proc, "pid", "?"))
            return inst

    @classmethod
    def shutdown(cls) -> None:
        with cls._instance_lock:
            for inst in list(cls._instances.values()):
                try:
                    inst._close()
                except Exception:
                    pass
            cls._instances.clear()

    def __init__(self, exiftool_path: str) -> None:
        self._exiftool = exiftool_path
        # v0.9.190: Daemon in EIGENER Process-Group / Session starten, damit ein
        # harter Kill beim App-Close die ganze Gruppe (perl-Prozess + evtl.
        # Kindprozesse) erwischt — nicht nur den direkten Child. Verhindert
        # verwaiste `exiftool -stay_open`-Prozesse, die sonst über App-Sessions
        # hinweg liegen blieben (Marc-Bug 2026-06-08: 6 Waisen seit 30.05.).
        popen_kwargs = dict(
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        if os.name == "posix":
            # Neue Session → eigener Process-Group-Leader (pgid == pid).
            popen_kwargs["start_new_session"] = True
        elif os.name == "nt":
            # Windows: eigene Prozessgruppe (für sauberes terminate()) + KEIN
            # sichtbares Konsolenfenster (Beta-Tester-Bug: exiftool-Daemon öffnete ein
            # dauerhaft offenes CMD-Fenster).
            popen_kwargs["creationflags"] = (
                getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) | _WIN_NO_WINDOW)
        # bufsize=0 macht stdout zu raw FileIO (kein read1). Default-Buffered
        # gibt uns BufferedReader mit read1, was wir brauchen.
        self._proc = subprocess.Popen(
            [exiftool_path,
             "-stay_open", "True",
             "-@", "-",
             "-common_args",
             "-charset", "filename=utf8"],
            **popen_kwargs,
        )
        self._lock = _threading.Lock()
        self._req_counter = 0

    def _send_and_read_text(self, args: list[str]) -> str:
        """Sendet args + `-execute<N>`, sammelt stdout bis `{ready<N>}`-Marker."""
        with self._lock:
            self._req_counter += 1
            n = self._req_counter
            cmd = "\n".join(args) + f"\n-execute{n}\n"
            assert self._proc.stdin is not None
            self._proc.stdin.write(cmd.encode("utf-8"))
            self._proc.stdin.flush()
            marker = f"{{ready{n}}}".encode()
            buf = b""
            assert self._proc.stdout is not None
            while marker not in buf:
                chunk = self._proc.stdout.read1(65536)
                if not chunk:
                    break
                buf += chunk
            idx = buf.find(marker)
            return buf[:idx].rstrip(b"\r\n").decode("utf-8", errors="replace")

    def _send_and_read_binary(self, args: list[str]) -> bytes:
        """Wie oben aber gibt Bytes zurück (für `-b PreviewImage` etc.)."""
        with self._lock:
            self._req_counter += 1
            n = self._req_counter
            cmd = "\n".join(args) + f"\n-execute{n}\n"
            assert self._proc.stdin is not None
            self._proc.stdin.write(cmd.encode("utf-8"))
            self._proc.stdin.flush()
            marker = f"{{ready{n}}}".encode()
            buf = b""
            assert self._proc.stdout is not None
            while marker not in buf:
                chunk = self._proc.stdout.read1(65536)
                if not chunk:
                    break
                buf += chunk
            idx = buf.find(marker)
            return buf[:idx].rstrip(b"\r\n")

    def read_tags_json(self, path: str, tags: list[str], numeric: bool = True) -> Optional[dict]:
        """Liest mehrere Tags in einem Aufruf, gibt JSON-Dict zurück.
        numeric=True schaltet `-n` zu (Dezimalgrad statt 'X deg Y' …'-Format)."""
        args = [f"-{t}" for t in tags] + ["-j"]
        if numeric:
            args.append("-n")
        args.append(path)
        try:
            out = self._send_and_read_text(args)
            data = json.loads(out or "[]")
            return data[0] if data else None
        except Exception:
            return None

    def read_binary_tag(self, path: str, tag: str) -> Optional[bytes]:
        """Liest einen Binary-Tag (z.B. PreviewImage) als bytes."""
        try:
            out = self._send_and_read_binary([f"-{tag}", "-b", path])
            if out and len(out) > 500:
                return out
        except Exception:
            return None
        return None

    def write_args(self, args: list[str]) -> tuple[bool, str]:
        """Führt einen Schreibvorgang aus. args muss `-overwrite_original`,
        die Tag-Setzungen und am Ende den Pfad enthalten. Gibt (ok, message) zurück."""
        try:
            out = self._send_and_read_text(args)
            # exiftool gibt '1 image files updated' oder '0 image files updated' aus
            ok = ("error" not in out.lower()) and ("0 image files updated" not in out.lower())
            return ok, out.strip()
        except Exception as e:
            return False, str(e)

    def _close(self) -> None:
        """Beendet den exiftool-Daemon zuverlässig.

        v0.9.190: dreistufig & robust gegen hängende Worker:
          1. `-stay_open False` schicken (graceful) UND stdin schließen → exiftool
             beendet sich bei stdin-EOF selbst.
          2. Kurz (2 s) auf sauberen Exit warten — NICHT mehr 5 s, damit der
             Window-Close-Handler nicht hängt.
          3. Wenn dann noch am Leben (z.B. Worker hängt mitten in einem
             `-execute` an einer kaputten Datei): die ganze Process-Group hart
             killen, damit garantiert nichts verwaist liegen bleibt.
        """
        proc = self._proc
        if proc is None or proc.poll() is not None:
            return
        # 1) Graceful: -stay_open False + stdin schließen (forciert EOF).
        try:
            if proc.stdin is not None and not proc.stdin.closed:
                try:
                    proc.stdin.write(b"-stay_open\nFalse\n")
                    proc.stdin.flush()
                except Exception:
                    pass
                try:
                    proc.stdin.close()
                except Exception:
                    pass
        except Exception:
            pass
        # 2) Kurzer Wait auf sauberen Exit.
        try:
            proc.wait(timeout=2)
            return
        except Exception:
            pass
        # 3) Hart killen — komplette Process-Group (POSIX), sonst der Prozess.
        _kill_proc_group(proc)


# v0.9.190: atexit-Fallback. Greift bei JEDEM normalen Interpreter-Exit (auch
# Ctrl+C/KeyboardInterrupt im Dev-Modus, sys.exit, oder wenn webview.start()
# zurückkehrt). Stellt sicher, dass keine `exiftool -stay_open`-Daemons verwaisen,
# selbst wenn der explizite Shutdown im Window-Close-Handler nicht durchläuft.
# (Hinweis: bei `os._exit()` und SIGKILL läuft atexit NICHT — dafür sorgt der
# explizite `_ExifToolDaemon.shutdown()`-Call VOR dem os._exit im Close-Handler.)
atexit.register(_ExifToolDaemon.shutdown)


def _ensure_daemon():
    """Holt den ExifTool-READ-Daemon (Thumbnails/Meta) oder wirft ExifToolMissingError."""
    d = _ExifToolDaemon.get("read")
    if d is None:
        raise ExifToolMissingError(
            "exiftool nicht gefunden. Installation: 'brew install exiftool'"
        )
    return d


def _ensure_write_daemon():
    """Holt den ExifTool-WRITE-Daemon (GPS-Schreiben) oder wirft ExifToolMissingError.

    v0.9.151: Separater Prozess+Lock, damit ein hängender Vorschau-Read den
    GPS-Write nie blockiert."""
    d = _ExifToolDaemon.get("write")
    if d is None:
        raise ExifToolMissingError(
            "exiftool nicht gefunden. Installation: 'brew install exiftool'"
        )
    return d


# ── piexif-Backend (JPEG/TIFF) ────────────────────────────────────────────────

def _to_dms_rationals(deg_float: float) -> tuple[tuple[int, int], tuple[int, int], tuple[int, int]]:
    """Konvertiert Dezimalgrad zu EXIF-DMS-Triplet."""
    abs_deg = abs(deg_float)
    deg = int(abs_deg)
    rem = (abs_deg - deg) * 60
    minutes = int(rem)
    seconds = (rem - minutes) * 60
    sec_num = int(round(seconds * 10000))
    return ((deg, 1), (minutes, 1), (sec_num, 10000))


def _dms_to_decimal(dms, ref: str) -> float:
    deg = dms[0][0] / dms[0][1]
    minutes = dms[1][0] / dms[1][1]
    seconds = dms[2][0] / dms[2][1]
    val = deg + minutes / 60 + seconds / 3600
    if ref in ("S", "W"):
        val = -val
    return val


def _piexif_dt_and_tz(path: str) -> tuple[Optional[datetime], Optional[int]]:
    """Liest DateTimeOriginal/Digitized/DateTime + Zeitzonen-Offset (Minuten).
    Gibt (datetime_utc, tz_minutes) zurück; tz_minutes ist None, wenn die Kamera
    keinen OffsetTime-Tag gespeichert hat (dann ist datetime naive Lokalzeit)."""
    try:
        ex = piexif.load(path)
    except Exception:
        return None, None
    dt_naive = None
    for ifd_name, tag in (
        ("Exif", piexif.ExifIFD.DateTimeOriginal),
        ("Exif", piexif.ExifIFD.DateTimeDigitized),
        ("0th", piexif.ImageIFD.DateTime),
    ):
        raw = ex.get(ifd_name, {}).get(tag)
        if raw:
            try:
                s = raw.decode("ascii") if isinstance(raw, bytes) else raw
                dt_naive = datetime.strptime(s, "%Y:%m:%d %H:%M:%S")
                break
            except Exception:
                continue
    if dt_naive is None:
        return None, None
    # OffsetTimeOriginal (Tag 0x9011) — wenn vorhanden, zu UTC konvertieren
    # piexif kennt die Konstante als ExifIFD.OffsetTimeOriginal
    tz_min = None
    for tag_name in ("OffsetTimeOriginal", "OffsetTimeDigitized", "OffsetTime"):
        tag = getattr(piexif.ExifIFD, tag_name, None)
        if tag is None:
            continue
        raw = ex.get("Exif", {}).get(tag)
        if not raw:
            continue
        try:
            s = raw.decode("ascii") if isinstance(raw, bytes) else raw
            tz_min = _parse_exif_tz_minutes(s)
            if tz_min is not None:
                break
        except Exception:
            continue
    return _to_utc(dt_naive, tz_min), tz_min


def _piexif_read_datetime(path: str) -> Optional[datetime]:
    """Liest DateTimeOriginal/Digitized/DateTime. Wenn OffsetTimeOriginal vorhanden
    (EXIF 2.31+), wird die Zeit zu UTC konvertiert."""
    return _piexif_dt_and_tz(path)[0]


def _gps_is_meaningful(lat: Optional[float], lon: Optional[float]) -> bool:
    """True, wenn lat/lon eine echte Position sind.

    Viele Kameras/Programme schreiben einen *leeren* GPS-Block mit lat=lon=0
    (Position 0/0 = „Null-Island" im Golf von Guinea). Das ist KEIN echter
    Geotag — würde aber sonst als „Foto hat schon GPS" durchgehen und beim
    Taggen übersprungen. Solche Nullkoordinaten verwerfen wir.
    (Echte 0/0-Fotos gibt es im Outdoor-Kontext faktisch nie.)
    """
    if lat is None or lon is None:
        return False
    return not (abs(lat) < 1e-6 and abs(lon) < 1e-6)


def _piexif_read_gps(path: str) -> Optional[tuple[float, float, Optional[float]]]:
    try:
        ex = piexif.load(path)
    except Exception:
        return None
    gps = ex.get("GPS", {})
    lat_raw = gps.get(piexif.GPSIFD.GPSLatitude)
    lon_raw = gps.get(piexif.GPSIFD.GPSLongitude)
    if not lat_raw or not lon_raw:
        return None
    lat_ref = (gps.get(piexif.GPSIFD.GPSLatitudeRef, b"N") or b"N").decode("ascii")
    lon_ref = (gps.get(piexif.GPSIFD.GPSLongitudeRef, b"E") or b"E").decode("ascii")
    lat = _dms_to_decimal(lat_raw, lat_ref)
    lon = _dms_to_decimal(lon_raw, lon_ref)
    alt = None
    alt_raw = gps.get(piexif.GPSIFD.GPSAltitude)
    if alt_raw:
        alt_ref = gps.get(piexif.GPSIFD.GPSAltitudeRef, 0)
        alt = alt_raw[0] / alt_raw[1]
        if alt_ref == 1:
            alt = -alt
    return (lat, lon, alt)


def _piexif_write_gps(path: str, lat: float, lon: float,
                      alt: Optional[float] = None,
                      timestamp_utc: Optional[datetime] = None) -> None:
    try:
        ex = piexif.load(path)
    except Exception:
        ex = {"0th": {}, "Exif": {}, "GPS": {}, "1st": {}, "thumbnail": None}

    gps_ifd = {
        piexif.GPSIFD.GPSVersionID: (2, 3, 0, 0),
        piexif.GPSIFD.GPSLatitudeRef: b"N" if lat >= 0 else b"S",
        piexif.GPSIFD.GPSLatitude: _to_dms_rationals(lat),
        piexif.GPSIFD.GPSLongitudeRef: b"E" if lon >= 0 else b"W",
        piexif.GPSIFD.GPSLongitude: _to_dms_rationals(lon),
    }
    if alt is not None:
        gps_ifd[piexif.GPSIFD.GPSAltitudeRef] = 0 if alt >= 0 else 1
        gps_ifd[piexif.GPSIFD.GPSAltitude] = (int(round(abs(alt) * 100)), 100)

    if timestamp_utc is not None:
        t = timestamp_utc.astimezone(timezone.utc)
        gps_ifd[piexif.GPSIFD.GPSDateStamp] = t.strftime("%Y:%m:%d").encode("ascii")
        gps_ifd[piexif.GPSIFD.GPSTimeStamp] = (
            (t.hour, 1), (t.minute, 1), (t.second, 1),
        )

    ex["GPS"] = gps_ifd
    try:
        exif_bytes = piexif.dump(ex)
    except Exception as e:
        _log.exception("piexif.dump fehlgeschlagen für %s: %s", path, e)
        raise
    try:
        piexif.insert(exif_bytes, path)
    except Exception as e:
        _log.exception("piexif.insert fehlgeschlagen für %s: %s", path, e)
        raise
    _log.info("piexif GPS geschrieben: %s (%d GPS-Tags)", path, len(gps_ifd))


# ── exiftool-Backend (RAW + HEIC) ─────────────────────────────────────────────

_DATE_RE = re.compile(r"(\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2})")
_TZ_RE = re.compile(r"^([+-])(\d{2}):(\d{2})$")


def _parse_exif_datetime(v: Any) -> Optional[datetime]:
    if not v:
        return None
    m = _DATE_RE.match(str(v))
    if not m:
        return None
    try:
        return datetime.strptime(m.group(1), "%Y:%m:%d %H:%M:%S")
    except ValueError:
        return None


def _parse_exif_tz_minutes(v: Any) -> Optional[int]:
    """Parst 'OffsetTimeOriginal'-Werte wie '+02:00' / '-05:00' zu Minuten."""
    if not v:
        return None
    m = _TZ_RE.match(str(v).strip())
    if not m:
        return None
    sign = 1 if m.group(1) == "+" else -1
    return sign * (int(m.group(2)) * 60 + int(m.group(3)))


def _to_utc(dt_naive: Optional[datetime], tz_minutes: Optional[int]) -> Optional[datetime]:
    """Wenn ein TZ-Offset bekannt ist, konvertiere die naive lokale Zeit zu UTC
    (als naive datetime zurück — Match-Logik klebt sowieso `tzinfo=utc` an)."""
    if dt_naive is None:
        return None
    if tz_minutes is None:
        return dt_naive
    from datetime import timedelta
    return dt_naive - timedelta(minutes=tz_minutes)


def _exiftool_read_meta(path: str) -> dict:
    """Liest in EINEM Daemon-Call alle relevanten Tags: DateTime + GPS + TZ.
    Bei vorhandenem OffsetTimeOriginal/OffsetTime wird die Zeit zu UTC konvertiert.

    Rückgabe-Dict: 'datetime' (naive, UTC wenn TZ bekannt), 'tz_minutes',
    'lat', 'lon', 'alt'. Alle Optional."""
    daemon = _ensure_daemon()
    info = daemon.read_tags_json(path, [
        "DateTimeOriginal", "CreateDate", "ModifyDate",
        "OffsetTimeOriginal", "OffsetTime", "OffsetTimeDigitized",
        "GPSLatitude", "GPSLongitude", "GPSAltitude",
        "Make", "Model",  # v0.9.164 — Kamera-Modell für den Geotagger-Filter
    ], numeric=True) or {}
    dt = None
    for key in ("DateTimeOriginal", "CreateDate", "ModifyDate"):
        dt = _parse_exif_datetime(info.get(key))
        if dt:
            break
    tz_min = (_parse_exif_tz_minutes(info.get("OffsetTimeOriginal"))
              or _parse_exif_tz_minutes(info.get("OffsetTime"))
              or _parse_exif_tz_minutes(info.get("OffsetTimeDigitized")))
    dt_utc = _to_utc(dt, tz_min)
    lat = info.get("GPSLatitude")
    lon = info.get("GPSLongitude")
    alt = info.get("GPSAltitude")
    return {
        "datetime": dt_utc,
        "tz_minutes": tz_min,
        "lat": float(lat) if lat is not None else None,
        "lon": float(lon) if lon is not None else None,
        "alt": float(alt) if alt is not None else None,
        "camera": _camera_label(info.get("Make"), info.get("Model")),
    }


def _exiftool_read_datetime(path: str) -> Optional[datetime]:
    try:
        return _exiftool_read_meta(path)["datetime"]
    except ExifToolMissingError:
        return None


def _exiftool_read_gps(path: str) -> Optional[tuple[float, float, Optional[float]]]:
    try:
        meta = _exiftool_read_meta(path)
    except ExifToolMissingError:
        return None
    if meta["lat"] is None or meta["lon"] is None:
        return None
    return (meta["lat"], meta["lon"], meta["alt"])


def _build_gps_write_args(lat: float, lon: float,
                          alt: Optional[float] = None,
                          timestamp_utc: Optional[datetime] = None) -> list[str]:
    """Baut die `-GPSLatitude=…` Argument-Liste (ohne Pfad + `-overwrite_original`)."""
    args = [
        f"-GPSLatitude={abs(lat)}",
        f"-GPSLatitudeRef={'N' if lat >= 0 else 'S'}",
        f"-GPSLongitude={abs(lon)}",
        f"-GPSLongitudeRef={'E' if lon >= 0 else 'W'}",
    ]
    if alt is not None:
        args += [
            f"-GPSAltitude={abs(alt)}",
            f"-GPSAltitudeRef={'above' if alt >= 0 else 'below'}",
        ]
    if timestamp_utc is not None:
        t = timestamp_utc.astimezone(timezone.utc)
        args += [
            f"-GPSDateStamp={t.strftime('%Y:%m:%d')}",
            f"-GPSTimeStamp={t.strftime('%H:%M:%S')}",
        ]
    return args


def _exiftool_write_gps(path: str, lat: float, lon: float,
                        alt: Optional[float] = None,
                        timestamp_utc: Optional[datetime] = None) -> None:
    """Schreibt GPS-Tags via persistenten exiftool-WRITE-Daemon."""
    daemon = _ensure_write_daemon()
    args = ["-overwrite_original"] + _build_gps_write_args(lat, lon, alt, timestamp_utc) + [path]
    _log.info("exiftool-write args=%s", args)
    ok, msg = daemon.write_args(args)
    _log.info("exiftool-write Ergebnis: ok=%s msg=%r", ok, msg[:300])
    if not ok:
        raise RuntimeError(f"exiftool fehlgeschlagen: {msg[:300]}")


def shift_datetime(path: str, seconds: float) -> bool:
    """Verschiebt DateTimeOriginal/CreateDate/ModifyDate um `seconds` (positiv = nach vorne).

    Nutzt piexif für JPEG, exiftool für RAW/HEIC.
    Idempotent NICHT — jeder Aufruf addiert nochmal. UI muss das verhindern.
    Liefert True bei Erfolg.
    """
    sec = int(round(seconds))
    if sec == 0:
        return True

    if is_jpeg_like(path):
        # piexif: alte Werte lesen, addieren, alle drei Tags neu schreiben
        try:
            ex = piexif.load(path)
        except Exception:
            return False
        try:
            from datetime import timedelta
            delta = timedelta(seconds=sec)
            for ifd_name, tag in (
                ("Exif", piexif.ExifIFD.DateTimeOriginal),
                ("Exif", piexif.ExifIFD.DateTimeDigitized),
                ("0th",  piexif.ImageIFD.DateTime),
            ):
                raw = ex.get(ifd_name, {}).get(tag)
                if not raw:
                    continue
                s = raw.decode("ascii") if isinstance(raw, bytes) else raw
                try:
                    dt = datetime.strptime(s, "%Y:%m:%d %H:%M:%S")
                except ValueError:
                    continue
                new_dt = dt + delta
                new_raw = new_dt.strftime("%Y:%m:%d %H:%M:%S").encode("ascii")
                ex[ifd_name][tag] = new_raw
            piexif.insert(piexif.dump(ex), path)
            return True
        except Exception:
            return False

    if is_raw(path) or is_tiff(path):
        # exiftool: -AllDates+="HH:MM:SS" (negativ erlaubt mit Vorzeichen davor)
        # v0.9.154: TIFF mit dazu — piexif.insert() kann kein TIFF schreiben.
        try:
            daemon = _ensure_write_daemon()
        except ExifToolMissingError:
            return False
        # Format: +"H:M:S" oder -"H:M:S". exiftool akzeptiert eigentlich
        # auch nur Sekunden, aber wir bauen das saubere Format.
        abs_s = abs(sec)
        h = abs_s // 3600
        m = (abs_s % 3600) // 60
        s = abs_s % 60
        sign_op = "+=" if sec >= 0 else "-="
        duration = f"{h}:{m:02d}:{s:02d}"
        args = [
            "-overwrite_original",
            f"-AllDates{sign_op}{duration}",
            path,
        ]
        ok, msg = daemon.write_args(args)
        return ok
    return False


def _exiftool_read_video_meta(path: str) -> dict:
    """Liest Video-Metadaten (MP4/MOV/Insta360/etc.) — analog _exiftool_read_meta
    aber andere Tag-Quellen (QuickTime nicht EXIF).

    Wichtige Tags für Videos:
      - `MediaCreateDate` / `CreateDate` / `TrackCreateDate` — Aufnahmezeit
        (bei iPhone/GoPro/Insta360 i.d.R. in UTC)
      - `GPSCoordinates` (ISO 6709) — Single-Position-GPS
      - `GPSLatitude` / `GPSLongitude` — separat (manche Container)
    """
    daemon = _ensure_daemon()
    info = daemon.read_tags_json(path, [
        "MediaCreateDate", "CreateDate", "TrackCreateDate",
        "QuickTime:CreateDate",
        "OffsetTimeOriginal", "OffsetTime",
        "GPSLatitude", "GPSLongitude", "GPSAltitude",
        "GPSCoordinates",
        "Make", "Model",  # v0.9.164 — Kamera-Modell (Geotagger-Filter)
    ], numeric=True) or {}

    # DateTime: MediaCreateDate ist bei MP4/MOV der zuverlässigste Wert.
    # QuickTime-Spec sagt: UTC. exiftool kann via `-api QuickTimeUTC=1` das auch
    # interpretieren — wir bekommen es als UTC-naive zurück und behandeln es
    # entsprechend.
    dt = None
    for key in ("MediaCreateDate", "CreateDate", "TrackCreateDate"):
        dt = _parse_exif_datetime(info.get(key))
        if dt:
            break

    # Bei QuickTime gilt: Zeiten sind eigentlich UTC. Bei manchen Cams (iPhone)
    # schreibt exiftool's Default sie auch korrekt als UTC; ältere/falsch
    # konfigurierte Cams haben TZ-Offsets. Wir nehmen den Wert als naive UTC
    # an — falls TZ-Tag vorhanden, ziehen wir ab.
    tz_min = (_parse_exif_tz_minutes(info.get("OffsetTimeOriginal"))
              or _parse_exif_tz_minutes(info.get("OffsetTime")))
    if tz_min is not None and dt is not None:
        dt = _to_utc(dt, tz_min)

    lat = info.get("GPSLatitude")
    lon = info.get("GPSLongitude")
    alt = info.get("GPSAltitude")
    # Fallback: GPSCoordinates ist ein einzelner String "lat lon alt"
    if (lat is None or lon is None) and info.get("GPSCoordinates"):
        try:
            parts = str(info["GPSCoordinates"]).strip().split()
            if len(parts) >= 2:
                lat = float(parts[0])
                lon = float(parts[1])
                if len(parts) >= 3:
                    alt = float(parts[2])
        except Exception:
            pass

    return {
        "datetime": dt,
        "tz_minutes": tz_min,
        "lat": float(lat) if lat is not None else None,
        "lon": float(lon) if lon is not None else None,
        "alt": float(alt) if alt is not None else None,
        "camera": _camera_label(info.get("Make"), info.get("Model")),
    }


def _exiftool_write_gps_video(path: str, lat: float, lon: float,
                              alt: Optional[float] = None,
                              timestamp_utc: Optional[datetime] = None) -> None:
    """Schreibt GPS in einen Video-Container (MP4/MOV/Insta360).

    Strategie: setze sowohl `Keys:GPSCoordinates` (ISO 6709 String, der von
    Apple Photos / iOS / macOS Sequoia gelesen wird) als auch die expliziten
    `XMP-exif:GPS*`-Tags (für Lightroom / DAM-Software). Das deckt fast jede
    Endkonsumenten-Pipeline ab.
    """
    daemon = _ensure_write_daemon()
    # ISO 6709-String: "+52.5163+013.3777+035.000/" (Vorzeichen, Punkte als Trenner)
    def iso6709(v: float, deg: int) -> str:
        sign = "+" if v >= 0 else "-"
        fmt = f"%0{deg+1}.4f" if v >= 0 else f"-%0{deg+1}.4f"
        return f"{sign}{abs(v):0{deg+5}.4f}"
    coord_str = f"{iso6709(lat, 2)}{iso6709(lon, 3)}"
    if alt is not None:
        coord_str += f"{'+' if alt >= 0 else '-'}{abs(alt):0.3f}"
    coord_str += "/"

    args = ["-overwrite_original",
            # QuickTime Keys-Atom (Apple-Standard)
            f"-Keys:GPSCoordinates={coord_str}",
            f"-UserData:GPSCoordinates={coord_str}",
            # Klassische EXIF-GPS-Tags (für Lightroom etc.)
            f"-GPSLatitude={abs(lat)}",
            f"-GPSLatitudeRef={'N' if lat >= 0 else 'S'}",
            f"-GPSLongitude={abs(lon)}",
            f"-GPSLongitudeRef={'E' if lon >= 0 else 'W'}",
            ]
    if alt is not None:
        args += [
            f"-GPSAltitude={abs(alt)}",
            f"-GPSAltitudeRef={'above' if alt >= 0 else 'below'}",
        ]
    args.append(path)
    _log.info("exiftool-write-video args=%s", args)
    ok, msg = daemon.write_args(args)
    _log.info("exiftool-write-video Ergebnis: ok=%s msg=%r", ok, msg[:300])
    if not ok:
        raise RuntimeError(f"exiftool fehlgeschlagen (video): {msg[:300]}")


def extract_video_embedded_thumbnail(path: str) -> Optional[bytes]:
    """v0.9.147: Versucht ein bereits eingebettetes Vorschaubild aus den
    Video-Metadaten zu lesen (PreviewImage/ThumbnailImage). Viele Kameras/
    Phones (Insta360, DJI, manche iPhones) betten so ein JPEG ein → instant,
    kein ffmpeg-Decode nötig. Läuft über den persistenten exiftool-Daemon
    (kein Prozess-Spawn pro Video). Gibt None zurück wenn nichts eingebettet."""
    try:
        daemon = _ensure_daemon()
    except ExifToolMissingError:
        return None
    for tag in ("PreviewImage", "ThumbnailImage"):
        try:
            data = daemon.read_binary_tag(path, tag)
        except Exception:
            data = None
        if data and len(data) > 1000:
            return data
    return None


def extract_quicklook_thumbnail(path: str, size: int = 256) -> Optional[bytes]:
    """macOS-only: erzeugt ein Vorschaubild über **QuickLook** (`qlmanage -t`) —
    dieselbe Engine, die der Finder benutzt.

    v0.9.150: Marc-Wunsch „nimm doch einfach das, was der Finder ratz-fatz
    anzeigt". QuickLook ist genau das:
    - Nutzt den **System-Thumbnail-Cache** + hardware-beschleunigtes Decode
      (AVFoundation). Für Videos, die der Finder schon mal angezeigt hat, ist es
      quasi instant.
    - Läuft im **separaten System-Dienst** (com.apple.quicklook), nicht in
      unserem Prozess → **kein 250-%-CPU-Spike** wie bei ffmpeg, der GIL/Cocoa-
      Mainloop blockiert. Gemessen: ffmpeg ~0,67 s bei 257 % CPU vs. qlmanage
      ~0,3–0,5 s bei ~25 % CPU (bei OM-4K/C4K ist der ffmpeg-Decode noch deutlich
      teurer).
    Gibt PNG-bytes zurück oder None (kein qlmanage / Timeout / Fehler).
    """
    if sys.platform != "darwin":
        return None
    ql = shutil.which("qlmanage") or "/usr/bin/qlmanage"
    if not os.path.isfile(ql):
        return None
    tmpdir = tempfile.mkdtemp(prefix="rzql_")
    try:
        subprocess.run(
            [ql, "-t", "-s", str(size), "-o", tmpdir, path],
            capture_output=True, timeout=15,
        )
        # qlmanage legt "<dateiname>.png" in tmpdir ab. Robust: nimm das erste PNG.
        for fn in os.listdir(tmpdir):
            if fn.lower().endswith(".png"):
                fp = os.path.join(tmpdir, fn)
                try:
                    with open(fp, "rb") as fh:
                        data = fh.read()
                    if data and len(data) > 500:
                        return data
                except OSError:
                    pass
        return None
    except Exception:
        return None
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def extract_video_thumbnail(path: str) -> Optional[bytes]:
    """Extrahiert ein Vorschaubild für ein Video.
    Liefert bytes oder None bei Fehler.

    v0.9.149: **Eingebettetes Thumbnail wieder ZUERST** (Rolle rückwärts zu
    v0.9.148). Empirisch gemessen (exiftool 12.x):
    - exiftool `-b -PreviewImage`/`-ThumbnailImage` braucht auf einer 326-MB-.mov
      nur ~0,07–0,3 s und scannt die Datei NICHT komplett durch — die in v0.9.148
      vermutete „mehrere-GB-Vollscan"-Bremse existiert nicht.
    - OM-/Olympus-.mov betten (wie früher schon Olympus-Kameras) ein Vorschau-
      JPEG ein → exiftool liefert es praktisch instant, ganz ohne Decode. Genau
      DAS war der schnelle Pfad in v0.9.147; das Entfernen in v0.9.148 hat OM-
      .mov auf den langsamen ffmpeg-Frame-Decode (4K/C4K, hohe Bitrate) gezwungen
      → „dauert noch länger".
    - iPhone-.mov haben KEIN eingebettetes Thumbnail → fallen sauber auf ffmpeg
      zurück (dort ~0,7 s, völlig okay).
    v0.9.150: **QuickLook zuerst auf macOS** (Marc-Wunsch: „nimm das, was der
    Finder ratz-fatz zeigt"). Das ist der Finder-identische, gecachte, hardware-
    beschleunigte Pfad und vermeidet den teuren ffmpeg-CPU-Spike, der die App
    blockiert. Reihenfolge: (1) QuickLook [macOS], (2) eingebettetes Thumbnail
    via exiftool-Daemon, (3) ffmpeg-Seek [plattformübergreifender Fallback].
    """
    # 1) macOS QuickLook — exakt das, was der Finder anzeigt. Schnell + cache +
    #    läuft im System-Dienst (kein CPU-Spike in unserem Prozess).
    ql = extract_quicklook_thumbnail(path, size=256)
    if ql:
        return ql
    # 2) Eingebettetes Vorschau-JPEG (instant für OM/Olympus etc.; auch Windows).
    emb = extract_video_embedded_thumbnail(path)
    if emb:
        return emb
    # 3) Fallback: ffmpeg-Frame-Extraktion (für Videos ohne eingebettetes Thumb,
    #    z.B. iPhone-.mov auf Windows/Linux).
    # ffmpeg-Pfad robust suchen (gleiche Logik wie animator)
    ff = shutil.which("ffmpeg") \
         or ("/opt/homebrew/bin/ffmpeg" if os.path.isfile("/opt/homebrew/bin/ffmpeg") else None) \
         or ("/usr/local/bin/ffmpeg"   if os.path.isfile("/usr/local/bin/ffmpeg")   else None)
    if not ff:
        return None
    # v0.9.147 (Geotagger-Video-Speed): schnellere ffmpeg-Flags.
    #  -noaccurate_seek : springt zum nächsten Keyframe statt bis zur exakten
    #                     Sekunde zu dekodieren — für ein Thumbnail egal, spart
    #                     aber den ganzen Decode-Lauf vom Keyframe bis Sek. 1.
    #  -an -sn          : Audio-/Untertitel-Streams ignorieren (weniger Demux).
    #  scale max 384px  : Display zeigt ~220px → 384 reicht dick, PIL skaliert
    #                     final runter. Vorher 640 = doppelter Encode/Decode.
    common = [
        "-an", "-sn",
        "-frames:v", "1",
        "-q:v", "4",
        "-vf", "scale='min(384,iw)':-2",
        "-f", "image2pipe",
        "-vcodec", "mjpeg",
        "-",
    ]
    try:
        # 1 Sekunde rein-seeken (Keyframe-Seek, schnell)
        r = subprocess.run(
            [ff, "-noaccurate_seek", "-ss", "1", "-i", path, *common],
            capture_output=True, timeout=20, creationflags=_WIN_NO_WINDOW,
        )
        if r.returncode == 0 and r.stdout and len(r.stdout) > 500:
            return r.stdout
        # Fallback: Frame bei 0 sec (z.B. Videos kürzer als 1 s)
        r = subprocess.run(
            [ff, "-i", path, *common],
            capture_output=True, timeout=20, creationflags=_WIN_NO_WINDOW,
        )
        if r.returncode == 0 and r.stdout and len(r.stdout) > 500:
            return r.stdout
    except Exception:
        return None
    return None


def extract_raw_preview(path: str) -> Optional[bytes]:
    """Extrahiert das eingebettete Preview-JPEG aus einer RAW-Datei.
    Versucht in dieser Reihenfolge: PreviewImage, JpgFromRaw, ThumbnailImage."""
    try:
        daemon = _ensure_daemon()
    except ExifToolMissingError:
        return None
    for tag in ("PreviewImage", "JpgFromRaw", "ThumbnailImage"):
        data = daemon.read_binary_tag(path, tag)
        if data and len(data) > 1000:
            return data
    return None


# ── HEIC/HEIF-Backend (pillow-heif, kein exiftool nötig) ─────────────────────

def _heif_read_exif_dict(path: str) -> Optional[dict]:
    """v0.9.57 — Liest HEIC-EXIF via pillow-heif und parst mit piexif.
    Returns piexif-Dict oder None bei Fehlschlag/fehlendem Plugin."""
    if not _HEIF_AVAILABLE:
        return None
    try:
        heif = pillow_heif.read_heif(path)
        # EXIF kommt als bytes in heif.info["exif"] (mit oder ohne "Exif\x00\x00"-Prefix)
        exif_bytes = (heif.info or {}).get("exif")
        if not exif_bytes:
            return None
        # piexif erwartet keine "Exif\x00\x00"-Magic — falls vorhanden, abschneiden
        if isinstance(exif_bytes, (bytes, bytearray)) and exif_bytes[:6] == b"Exif\x00\x00":
            exif_bytes = bytes(exif_bytes[6:])
        return piexif.load(bytes(exif_bytes))
    except Exception as e:
        _log.debug("HEIF EXIF-Read fehlgeschlagen (%s): %s", path, e)
        return None


def _heif_read_datetime(path: str) -> Optional[datetime]:
    d = _heif_read_exif_dict(path)
    if not d:
        return None
    try:
        # DateTimeOriginal (36867) → ExifIFD; CreateDate (36868); ModifyDate (306) → 0th
        for ifd_key, tag in (("Exif", 36867), ("Exif", 36868), ("0th", 306)):
            v = d.get(ifd_key, {}).get(tag)
            if not v:
                continue
            if isinstance(v, bytes):
                v = v.decode("ascii", errors="ignore").rstrip("\x00").strip()
            dt = _parse_exif_datetime(v)
            if dt:
                # OffsetTime ggf. zu UTC umrechnen
                tz = None
                for ifd_key2, tz_tag in (("Exif", 36880), ("Exif", 36881), ("Exif", 36882)):
                    raw_tz = d.get(ifd_key2, {}).get(tz_tag)
                    if not raw_tz:
                        continue
                    if isinstance(raw_tz, bytes):
                        raw_tz = raw_tz.decode("ascii", errors="ignore").rstrip("\x00").strip()
                    tz = _parse_exif_tz_minutes(raw_tz)
                    if tz is not None:
                        break
                return _to_utc(dt, tz)
        return None
    except Exception as e:
        _log.debug("HEIF Datetime-Parse fehlgeschlagen (%s): %s", path, e)
        return None


def _heif_read_gps(path: str) -> Optional[tuple[float, float, Optional[float]]]:
    d = _heif_read_exif_dict(path)
    if not d:
        return None
    try:
        gps = d.get("GPS", {})
        if not gps:
            return None
        # piexif liefert GPS-Coords als ((deg_num,deg_den), (min_num,min_den), (sec_num,sec_den)) + Ref ('N'/'S'/'E'/'W')
        def _rat_to_deg(rats) -> float:
            d_ = rats[0][0] / rats[0][1]
            m_ = rats[1][0] / rats[1][1]
            s_ = rats[2][0] / rats[2][1]
            return d_ + m_ / 60 + s_ / 3600
        lat_rat = gps.get(2)   # GPSLatitude
        lat_ref = gps.get(1)   # 'N'/'S'
        lon_rat = gps.get(4)   # GPSLongitude
        lon_ref = gps.get(3)   # 'E'/'W'
        if not (lat_rat and lon_rat and lat_ref and lon_ref):
            return None
        lat = _rat_to_deg(lat_rat)
        lon = _rat_to_deg(lon_rat)
        if isinstance(lat_ref, bytes):
            lat_ref = lat_ref.decode("ascii", errors="ignore")
        if isinstance(lon_ref, bytes):
            lon_ref = lon_ref.decode("ascii", errors="ignore")
        if lat_ref.upper().startswith("S"):
            lat = -lat
        if lon_ref.upper().startswith("W"):
            lon = -lon
        alt = None
        alt_rat = gps.get(6)
        if alt_rat:
            alt = alt_rat[0] / alt_rat[1] if alt_rat[1] else None
            alt_ref = gps.get(5)  # 0=above, 1=below
            if alt is not None and alt_ref in (1, b"\x01"):
                alt = -alt
        return (lat, lon, alt)
    except Exception as e:
        _log.debug("HEIF GPS-Parse fehlgeschlagen (%s): %s", path, e)
        return None


def extract_heif_thumbnail(path: str, size: int = 220) -> Optional[bytes]:
    """v0.9.57 — Erzeugt ein Thumbnail-JPEG für HEIC/HEIF.
    Kein exiftool nötig — pillow-heif öffnet HEIC direkt mit Pillow."""
    if not _HEIF_AVAILABLE:
        return None
    try:
        from PIL import Image, ImageOps
        import io as _io
        img = Image.open(path)
        img = ImageOps.exif_transpose(img)
        img.thumbnail((size, size), Image.LANCZOS)
        if img.mode != "RGB":
            img = img.convert("RGB")
        buf = _io.BytesIO()
        img.save(buf, "JPEG", quality=78)
        return buf.getvalue()
    except Exception as e:
        _log.debug("HEIF Thumbnail-Generation fehlgeschlagen (%s): %s", path, e)
        return None


# ── Öffentliche API: Backend-Routing ──────────────────────────────────────────

# ── Kamera-Modell (v0.9.164 — für den Geotagger-Kamera-Filter) ────────────────
def _camera_label(make, model) -> Optional[str]:
    """Baut ein sauberes Kamera-Label aus EXIF Make + Model. Vermeidet
    Dopplungen wie „Canon Canon EOS R5" (wenn Make schon im Model steckt)."""
    def _clean(v):
        if v is None:
            return ""
        if isinstance(v, bytes):
            v = v.decode("ascii", "ignore")
        return str(v).replace("\x00", " ").strip()
    mk, md = _clean(make), _clean(model)
    if not md and not mk:
        return None
    if md and mk and mk.split(" ")[0].lower() not in md.lower():
        return f"{mk} {md}".strip()
    return md or mk


def _piexif_read_camera(path: str) -> Optional[str]:
    try:
        ex = piexif.load(path)
    except Exception:
        return None
    z = ex.get("0th", {})
    return _camera_label(z.get(piexif.ImageIFD.Make), z.get(piexif.ImageIFD.Model))


def read_camera(path: str) -> Optional[str]:
    """Liest das Kamera-Modell (Make/Model) format-abhängig. None wenn unbekannt."""
    try:
        if is_jpeg_like(path) or is_tiff(path):
            return _piexif_read_camera(path)
        if is_heif(path):
            try:
                return _exiftool_read_meta(path).get("camera")
            except ExifToolMissingError:
                return _piexif_read_camera(path)
        if is_raw(path):
            try:
                return _exiftool_read_meta(path).get("camera")
            except ExifToolMissingError:
                return None
        if is_video(path):
            try:
                return _exiftool_read_video_meta(path).get("camera")
            except ExifToolMissingError:
                return None
        return _piexif_read_camera(path)
    except Exception:
        return None


def read_datetime(path: str) -> Optional[datetime]:
    """Liest Aufnahmezeit. Returns naive datetime (UTC wenn TZ erkannt)."""
    # v0.9.154: TIFF wird via piexif.load() gelesen (funktioniert), nur das
    # Schreiben läuft über exiftool — daher hier mit JPEG zusammen.
    if is_jpeg_like(path) or is_tiff(path):
        return _piexif_read_datetime(path)
    # v0.9.57: HEIC/HEIF — erst pillow-heif (in-process), dann exiftool-Fallback
    if is_heif(path):
        dt = _heif_read_datetime(path)
        if dt is not None:
            return dt
        try:
            return _exiftool_read_datetime(path)
        except ExifToolMissingError:
            return None
    if is_raw(path):
        return _exiftool_read_datetime(path)
    if is_video(path):
        try:
            return _exiftool_read_video_meta(path).get("datetime")
        except ExifToolMissingError:
            return None
    # Unbekannte Endung → versuche beides
    try:
        return _piexif_read_datetime(path) or _exiftool_read_datetime(path)
    except Exception:
        return None


def read_datetime_with_tz(path: str) -> tuple[Optional[datetime], bool]:
    """Wie read_datetime, gibt zusätzlich zurück, OB die Kamera die Zeitzone
    selbst gespeichert hatte (OffsetTimeOriginal o.ä.).

    Rückgabe: (datetime_utc_oder_naive, tz_known).
    - tz_known=True  → datetime ist bereits auf UTC normiert.
    - tz_known=False → datetime ist die naive Kamera-Lokalzeit (hier greift die
                       manuelle Zeitzonen-Auswahl im Geotagger).

    Wird für den Geotagger gebraucht, damit eine manuell gesetzte Kamera-Zeitzone
    nur Fotos OHNE eingebetteten Offset verschiebt (sonst doppelte Korrektur)."""
    try:
        if is_jpeg_like(path) or is_tiff(path):
            dt, tz_min = _piexif_dt_and_tz(path)
            return dt, tz_min is not None
        if is_raw(path):
            try:
                m = _exiftool_read_meta(path)
                return m.get("datetime"), m.get("tz_minutes") is not None
            except ExifToolMissingError:
                return None, False
        if is_video(path):
            try:
                m = _exiftool_read_video_meta(path)
                return m.get("datetime"), m.get("tz_minutes") is not None
            except ExifToolMissingError:
                return None, False
        if is_heif(path):
            # pillow-heif liefert keine getrennte TZ-Info → konservativ unbekannt.
            # (Default-Zeitzone 0 ändert dann ohnehin nichts.)
            return read_datetime(path), False
    except Exception:
        return None, False
    # Unbekannte Endung
    return read_datetime(path), False


def read_gps(path: str) -> Optional[tuple[float, float, Optional[float]]]:
    gps = _read_gps_raw(path)
    # v0.9.165: leere 0/0-„Null-Island"-Blöcke als „kein GPS" behandeln,
    # damit der Geotagger sie nicht fälschlich als „hat schon GPS" überspringt.
    if gps is not None and not _gps_is_meaningful(gps[0], gps[1]):
        return None
    return gps


def _read_gps_raw(path: str) -> Optional[tuple[float, float, Optional[float]]]:
    # v0.9.154: TIFF-GPS via piexif.load() lesen (siehe read_datetime).
    if is_jpeg_like(path) or is_tiff(path):
        return _piexif_read_gps(path)
    # v0.9.57: HEIC/HEIF — pillow-heif zuerst, exiftool als Fallback
    if is_heif(path):
        gps = _heif_read_gps(path)
        if gps is not None:
            return gps
        try:
            return _exiftool_read_gps(path)
        except ExifToolMissingError:
            return None
    if is_raw(path):
        try:
            return _exiftool_read_gps(path)
        except ExifToolMissingError:
            return None
    if is_video(path):
        try:
            meta = _exiftool_read_video_meta(path)
            if meta["lat"] is None or meta["lon"] is None:
                return None
            return (meta["lat"], meta["lon"], meta["alt"])
        except ExifToolMissingError:
            return None
    return None


def write_gps(path: str, lat: float, lon: float,
              alt: Optional[float] = None,
              timestamp_utc: Optional[datetime] = None) -> None:
    # v0.9.152: ausführliches Logging, um „taggen geht nicht" zu diagnostizieren.
    _log.info("write_gps: path=%s lat=%s lon=%s alt=%s ts=%s | jpeg=%s tiff=%s heif=%s raw=%s video=%s",
              path, lat, lon, alt, timestamp_utc,
              is_jpeg_like(path), is_tiff(path), is_heif(path), is_raw(path), is_video(path))
    if is_jpeg_like(path):
        _piexif_write_gps(path, lat, lon, alt, timestamp_utc)
        _log.info("write_gps: piexif-Pfad fertig für %s", path)
        return
    # v0.9.154: TIFF — piexif.insert() kann KEIN TIFF (InvalidImageDataError),
    # deshalb exiftool (wie RAW). exiftool schreibt TIFF-EXIF nativ.
    if is_tiff(path):
        _exiftool_write_gps(path, lat, lon, alt, timestamp_utc)
        _log.info("write_gps: tiff/exiftool-Pfad fertig für %s", path)
        return
    # v0.9.57: HEIC/HEIF — pillow-heif kann nicht schreiben, deshalb exiftool
    # (= einzige Option). Wenn exiftool fehlt, ExifToolMissingError mit Hinweis.
    if is_heif(path):
        _exiftool_write_gps(path, lat, lon, alt, timestamp_utc)
        _log.info("write_gps: heif/exiftool-Pfad fertig für %s", path)
        return
    if is_raw(path):
        _exiftool_write_gps(path, lat, lon, alt, timestamp_utc)
        _log.info("write_gps: raw/exiftool-Pfad fertig für %s", path)
        return
    if is_video(path):
        _exiftool_write_gps_video(path, lat, lon, alt, timestamp_utc)
        _log.info("write_gps: video/exiftool-Pfad fertig für %s", path)
        return
    # Unbekannte Endung: erstmal piexif probieren, sonst exiftool
    _log.warning("write_gps: unbekannte Endung %s — versuche piexif, sonst exiftool", path)
    try:
        _piexif_write_gps(path, lat, lon, alt, timestamp_utc)
    except Exception as e:
        _log.warning("write_gps: piexif-Fallback fehlgeschlagen (%s) → exiftool", e)
        _exiftool_write_gps(path, lat, lon, alt, timestamp_utc)
