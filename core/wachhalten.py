"""App Nap aus, solange lange Hintergrundarbeit läuft (05.10.2026).

Marc schickte das Log eines Nacht-Laufs (Fotos vom NAS einlesen): 200 Dateien brauchten 165 s, davon aber nur 33 s
für das Lesen vom NAS (exiftool läuft als eigener Prozess). Der Rest verschwand in der App selbst — und als er um
6:34 das MacBook weckte, sank derselbe Stapel sofort auf 95 s. Das ist App Nap: macOS drosselt Programme, deren Fenster
nicht sichtbar ist oder deren Bildschirm schläft.

`waehrend("…")` meldet dem System für die Dauer einer Arbeit „vom Nutzer angestoßen" (NSActivityUserInitiated…
AllowingIdleSystemSleep) — App Nap greift dann nicht. Der Mac darf trotzdem schlafen gehen, wenn er will; dann ruht
der Lauf und macht beim Aufwachen weiter. Auf Windows/Linux gibt es nichts Vergleichbares abzuschalten → nichts tun.
"""
from __future__ import annotations

import contextlib
import logging
import sys
import threading

log = logging.getLogger(__name__)

# NSActivityUserInitiatedAllowingIdleSystemSleep = NSActivityUserInitiated & ~NSActivityIdleSystemSleepDisabled
_USER_INITIATED_ALLOW_SLEEP = 0x00FFFFFF & ~(1 << 20)
_lock = threading.Lock()
_aktiv = 0
_token = None


def _an(grund: str) -> None:
    global _aktiv, _token
    with _lock:
        _aktiv += 1
        if _aktiv > 1 or sys.platform != "darwin":
            return
        try:
            from Foundation import NSProcessInfo
            _token = NSProcessInfo.processInfo().beginActivityWithOptions_reason_(_USER_INITIATED_ALLOW_SLEEP, grund)
            log.info("[wach] App Nap aus: %s", grund)
        except Exception as e:  # noqa: BLE001 — ohne pyobjc läuft es eben gedrosselt weiter
            _token = None
            log.info("[wach] App Nap nicht abschaltbar: %s", e)


def _aus() -> None:
    global _aktiv, _token
    with _lock:
        _aktiv = max(0, _aktiv - 1)
        if _aktiv or _token is None:
            return
        try:
            from Foundation import NSProcessInfo
            NSProcessInfo.processInfo().endActivity_(_token)
            log.info("[wach] App Nap wieder erlaubt")
        except Exception:  # noqa: BLE001
            pass
        _token = None


@contextlib.contextmanager
def waehrend(grund: str):
    """`with waehrend("Fotos einlesen"): …` — mehrere gleichzeitige Arbeiten zählen mit."""
    _an(grund)
    try:
        yield
    finally:
        _aus()


def aktiv() -> bool:
    return _aktiv > 0
