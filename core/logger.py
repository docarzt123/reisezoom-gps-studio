"""Zentrales Logging für Reisezoom GPS Studio.

- Logdatei in `~/Library/Application Support/Reisezoom GPS Studio/logs/app.log`.
- `RotatingFileHandler` mit 1 MB pro Datei, 5 Backups (`app.log.1` … `app.log.5`).
- Zusätzlich auf stderr, damit man's auch beim Dev-Start sieht.
- `setup_logging(app_support_dir)` wird in `app.py` einmal beim App-Start aufgerufen.
- Ungehandelte Exceptions (sys.excepthook + threading.excepthook) werden ebenfalls
  ins Log geschrieben, damit auch Worker-Thread-Crashes auffindbar sind.
- `get_log_path()` liefert den absoluten Pfad, damit UI/Bridge ihn ausspielen können.
"""
from __future__ import annotations

import logging
import logging.handlers
import sys
import threading
import traceback
from pathlib import Path
from typing import Optional


_LOG_PATH: Optional[Path] = None
_INITIALIZED = False


def _format_traceback(exc_type, exc_value, exc_tb) -> str:
    return "".join(traceback.format_exception(exc_type, exc_value, exc_tb))


def setup_logging(app_support_dir: Path, level: int = logging.INFO) -> Path:
    """Initialisiert das globale Logging. Idempotent — mehrfach gerufen ist safe.

    Returns: Pfad zur Logdatei (auch wenn das Setup fehlschlägt, wird ein
    sinnvoller Pfad zurückgegeben).
    """
    global _LOG_PATH, _INITIALIZED

    logs_dir = app_support_dir / "logs"
    log_path = logs_dir / "app.log"
    _LOG_PATH = log_path

    if _INITIALIZED:
        return log_path

    try:
        logs_dir.mkdir(parents=True, exist_ok=True)
    except Exception:
        # Wenn der Ordner nicht angelegt werden kann (z.B. Read-Only-Volume),
        # geben wir wenigstens stderr-Logging zurück.
        pass

    root = logging.getLogger()
    root.setLevel(level)

    # Doppelte Handler vermeiden bei Re-Init
    for h in list(root.handlers):
        root.removeHandler(h)

    fmt = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # File-Handler (Rotating, ~1 MB × 5)
    try:
        fh = logging.handlers.RotatingFileHandler(
            log_path, maxBytes=1_000_000, backupCount=5, encoding="utf-8"
        )
        fh.setFormatter(fmt)
        fh.setLevel(level)
        root.addHandler(fh)
    except Exception as e:
        # Wenn File-Handler scheitert (Permissions?), trotzdem weitermachen.
        sys.stderr.write(f"[logger] WARN: file handler init failed: {e}\n")

    # Stderr-Handler (Dev-Konsole + Console.app)
    sh = logging.StreamHandler(sys.stderr)
    sh.setFormatter(fmt)
    sh.setLevel(level)
    root.addHandler(sh)

    # Globale Excepthooks → ungefangene Exceptions ins Log
    def _excepthook(exc_type, exc_value, exc_tb):
        logging.getLogger("uncaught").error(
            "Unhandled exception:\n%s", _format_traceback(exc_type, exc_value, exc_tb)
        )
        # Default-Hook weiter ausführen, damit's auch auf stderr landet
        sys.__excepthook__(exc_type, exc_value, exc_tb)

    sys.excepthook = _excepthook

    # threading.excepthook ist seit Python 3.8 verfügbar
    def _thread_excepthook(args):
        logging.getLogger("uncaught.thread").error(
            "Unhandled exception in thread %s:\n%s",
            args.thread.name if args.thread else "?",
            _format_traceback(args.exc_type, args.exc_value, args.exc_traceback),
        )

    try:
        threading.excepthook = _thread_excepthook  # type: ignore[assignment]
    except Exception:
        pass

    _INITIALIZED = True

    log = logging.getLogger("logger")
    log.info("─" * 60)
    log.info("Reisezoom GPS Studio gestartet — Logdatei: %s", log_path)
    log.info("OS: %s", get_os_label())
    log.info("Gerät: %s", get_hardware_label())
    log.info("Python %s · pid=%s", sys.version.split()[0], _safe_pid())

    return log_path


def get_hardware_label() -> str:
    """Hardware-Kurzinfo fürs Log — ersetzt das „Über diesen Mac"-Nachfragen
    beim Support. Beispiel:
      iMac21,1 · Apple M1 · 16 GB
      MacBookPro16,1 · Intel(R) Core(TM) i7-9750H · 16 GB · unter Rosetta

    Bewusst fehlertolerant: schlägt etwas fehl, steht da eben weniger — das
    Logging darf daran niemals scheitern.
    """
    import platform
    if platform.system() != "Darwin":
        return "%s (%s)" % (platform.machine() or "?", platform.system() or "?")

    def _sysctl(key: str) -> str:
        try:
            import subprocess
            out = subprocess.run(["/usr/sbin/sysctl", "-n", key],
                                 capture_output=True, text=True, timeout=5)
            return (out.stdout or "").strip()
        except Exception:
            return ""

    parts = []
    model = _sysctl("hw.model")                     # z.B. iMac21,1 / Mac14,7
    if model:
        parts.append(model)
    chip = _sysctl("machdep.cpu.brand_string")      # z.B. "Apple M1"
    if chip:
        parts.append(chip)
    mem = _sysctl("hw.memsize")
    if mem.isdigit():
        parts.append("%d GB" % round(int(mem) / (1024 ** 3)))
    # Läuft ein arm64-Build unter Rosetta? (1 = ja) — erklärt seltsames Verhalten
    if _sysctl("sysctl.proc_translated") == "1":
        parts.append("unter Rosetta")
    return " · ".join(parts) if parts else (platform.machine() or "?")


def get_os_label() -> str:
    """Liefert ein lesbares OS-Label fürs Log und Bug-Reports.
    Beispiele:
      - macOS 14.6.1 (arm64) · Darwin 23.6.0
      - Windows 11 (AMD64) · build 22631
      - Linux Ubuntu 22.04 (x86_64) · 5.15.0-91-generic
    """
    try:
        import platform
        system = platform.system()
        machine = platform.machine()
        if system == "Darwin":
            # Mac-Version aus mac_ver, Kernel-Version via release()
            mac_ver = platform.mac_ver()[0] or "?"
            kernel = platform.release() or "?"
            return f"macOS {mac_ver} ({machine}) · Darwin {kernel}"
        elif system == "Windows":
            # win32_ver liefert (release, version, csd, ptype) — release ist '10' / '11'
            win_ver = platform.win32_ver()
            release = win_ver[0] or platform.release() or "?"
            build = win_ver[1] or "?"
            return f"Windows {release} ({machine}) · build {build}"
        elif system == "Linux":
            # freedesktop_os_release nur in 3.10+, fallback auf platform.release()
            distro = "?"
            try:
                info = platform.freedesktop_os_release()  # type: ignore[attr-defined]
                distro = f"{info.get('NAME', '')} {info.get('VERSION_ID', '')}".strip() or "?"
            except Exception:
                pass
            kernel = platform.release() or "?"
            return f"Linux {distro} ({machine}) · kernel {kernel}"
        else:
            # BSD, Solaris, irgendwas exotisches
            return f"{system} {platform.release()} ({machine})"
    except Exception as e:
        return f"(OS-Detection fehlgeschlagen: {e})"


def _safe_pid() -> str:
    try:
        import os as _os
        return str(_os.getpid())
    except Exception:
        return "?"


def get_log_path() -> Path:
    """Liefert den aktuellen Logfile-Pfad. Vor `setup_logging()` ein Fallback."""
    if _LOG_PATH is not None:
        return _LOG_PATH
    # Bestmöglicher Fallback — sollte in der Praxis nicht passieren, weil
    # `setup_logging()` ganz am Anfang von app.py läuft.
    return Path.home() / "Library" / "Application Support" / "Reisezoom GPS Studio" / "logs" / "app.log"


def get_logger(name: str) -> logging.Logger:
    """Convenience-Wrapper, damit Module nicht direkt `logging` importieren müssen."""
    return logging.getLogger(name)
