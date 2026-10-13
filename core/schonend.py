"""Hintergrundarbeit schonend laufen lassen (13.10.2026, Marc: „braucht echt viele Ressourcen. Nebenher Videos schneiden
wird schwierig. Kann man das drosseln?").

`hintergrund()` setzt den AUFRUFENDEN Faden auf die Hintergrund-Stufe des Systems:
- macOS: QoS-Klasse „Background“ — Stromspar-Kerne, niedrigste Rechen- und Plattenpriorität; wer im Vordergrund
  arbeitet (Schnittprogramm, Animator), hat immer Vorrang. Neue Python-Fäden erben die Stufe NICHT — jeder Faden
  (auch Pool-Fäden, per `initializer=hintergrund`) setzt sie selbst.
- Windows: THREAD_MODE_BACKGROUND_BEGIN (niedrige Rechen-, Platten- und Speicherpriorität).
- Linux: nice 19 für diesen Faden.
Keine Einstellung, kein Pause-Knopf: das Einlesen tritt von selbst zurück, sobald jemand anderes Leistung braucht.
Schlägt etwas fehl, läuft der Faden einfach normal weiter.
"""
from __future__ import annotations

import logging
import os
import sys
import threading

log = logging.getLogger(__name__)

_QOS_CLASS_BACKGROUND = 0x09
_THREAD_MODE_BACKGROUND_BEGIN = 0x00010000
_lokal = threading.local()


def hintergrund() -> bool:
    """Den aktuellen Faden auf Hintergrund-Stufe setzen. True, wenn es geklappt hat (oder schon so war)."""
    if getattr(_lokal, "an", False):
        return True
    ok = False
    try:
        if sys.platform == "darwin":
            import ctypes
            libc = ctypes.CDLL("/usr/lib/libSystem.B.dylib", use_errno=True)
            f = libc.pthread_set_qos_class_self_np
            f.argtypes = [ctypes.c_uint, ctypes.c_int]
            f.restype = ctypes.c_int
            ok = f(_QOS_CLASS_BACKGROUND, 0) == 0
        elif sys.platform == "win32":
            import ctypes
            k32 = ctypes.windll.kernel32
            k32.GetCurrentThread.restype = ctypes.c_void_p
            k32.SetThreadPriority.argtypes = [ctypes.c_void_p, ctypes.c_int]
            ok = bool(k32.SetThreadPriority(k32.GetCurrentThread(), _THREAD_MODE_BACKGROUND_BEGIN))
        elif hasattr(os, "setpriority"):
            os.setpriority(os.PRIO_PROCESS, threading.get_native_id(), 19)
            ok = True
    except Exception as e:  # noqa: BLE001 — nie wegen der Drossel scheitern
        log.debug("[schonend] Hintergrund-Stufe nicht gesetzt: %s", e)
        ok = False
    _lokal.an = ok
    return ok


def stufe() -> str:
    """Nur für Tests/Diagnose: die QoS-Klasse des aktuellen Fadens auf macOS („background“, „default“ …), sonst ""."""
    if sys.platform != "darwin":
        return ""
    try:
        import ctypes
        libc = ctypes.CDLL("/usr/lib/libSystem.B.dylib")
        f = libc.pthread_get_qos_class_np
        f.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint), ctypes.POINTER(ctypes.c_int)]
        libc.pthread_self.restype = ctypes.c_void_p
        k, rel = ctypes.c_uint(0), ctypes.c_int(0)
        f(libc.pthread_self(), ctypes.byref(k), ctypes.byref(rel))
        return {0x21: "user-interactive", 0x19: "user-initiated", 0x15: "default", 0x11: "utility",
                0x09: "background", 0x00: "unspecified"}.get(k.value, hex(k.value))
    except Exception:  # noqa: BLE001
        return ""
