"""Fotos und Clips in einem anderen Programm öffnen („Öffnen mit …“, 08.10.2026).

Marc: Bilder einer Tour nacharbeiten, „ganz ohne hin- und herzuwechseln zwischen Tools“ — bis GPS Studio selbst
entwickeln kann, ist der kürzeste Weg: aus dem Archiv direkt ins Bildprogramm der Wahl (Lightroom, Photoshop,
Affinity, Pixelmator, Vorschau …).

  macOS    die Programme, die macOS für die Datei kennt (NSWorkspace), Standard markiert; öffnen mit `open -a`
  Windows  der System-Dialog „Öffnen mit“ (`os.startfile(pfad, "openas")`) — eine eigene Liste gibt es dort nicht
  Linux    keine Liste; `xdg-open` (Standardprogramm)

Gelesen und geöffnet wird nur — die App verändert die Datei dabei nicht.
"""
from __future__ import annotations

import logging
import os
import subprocess
import sys
from pathlib import Path

log = logging.getLogger(__name__)

# Nur echte, installierte Programme — nicht Testbrowser aus Caches oder Laufzeit-Kopien in versteckten Ordnern
_MAC_WURZELN = ("/Applications/", "/System/Applications/", "/System/Volumes/Preboot/Cryptexes/App/System/Applications/",
                str(Path.home() / "Applications") + "/")
MAX_APPS = 20


def _mac_apps(pfad: str) -> list[dict]:
    import AppKit  # noqa: PLC0415 — nur auf dem Mac vorhanden
    import Foundation  # noqa: PLC0415
    url = Foundation.NSURL.fileURLWithPath_(pfad)
    ws = AppKit.NSWorkspace.sharedWorkspace()
    fm = AppKit.NSFileManager.defaultManager()
    std = ws.URLForApplicationToOpenURL_(url)
    std_pfad = str(std.path()).rstrip("/") if std else ""
    raus, namen = [], set()
    for u in ws.URLsForApplicationsToOpenURL_(url) or []:
        p = str(u.path()).rstrip("/")
        if not p.endswith(".app") or not any(p.startswith(w) for w in _MAC_WURZELN):
            continue
        if any(t.startswith(".") for t in Path(p).parts):
            continue
        # der Name, den der Finder zeigt („Vorschau“, nicht „Preview“)
        name = str(fm.displayNameAtPath_(p) or Path(p).stem)
        name = name[:-4] if name.endswith(".app") else name
        if name in namen:
            continue
        namen.add(name)
        raus.append({"name": name, "pfad": p, "standard": p == std_pfad})
    return raus


def apps_fuer(pfad: str, zuletzt: list | None = None) -> dict:
    """{apps: [{name, pfad, standard, zuletzt}], system_dialog: bool}. Zuletzt benutzte zuerst, dann der Standard,
    dann nach Namen."""
    if sys.platform == "darwin":
        try:
            apps = _mac_apps(pfad)
        except Exception as e:  # noqa: BLE001
            log.info("[öffnen mit] Programmliste nicht lesbar: %s", e)
            apps = []
        zl = [str(z) for z in (zuletzt or [])]
        for a in apps:
            a["zuletzt"] = a["pfad"] in zl
        apps.sort(key=lambda a: (zl.index(a["pfad"]) if a["pfad"] in zl else 99, not a["standard"], a["name"].lower()))
        return {"apps": apps[:MAX_APPS], "system_dialog": False}
    return {"apps": [], "system_dialog": sys.platform.startswith("win")}


def oeffnen(pfade: list, app: str = "") -> dict:
    """Öffnet die Dateien im gewählten Programm (macOS) bzw. im System-Dialog „Öffnen mit“ (Windows, `app` leer)."""
    pfade = [str(p) for p in (pfade or []) if p and Path(p).exists()]
    if not pfade:
        return {"ok": False, "error": "nicht_da"}
    if sys.platform == "darwin":
        befehl = ["open", "-a", app, *pfade] if app else ["open", *pfade]
        r = subprocess.run(befehl, capture_output=True, text=True, timeout=30)
        if r.returncode != 0:
            return {"ok": False, "error": (r.stderr or r.stdout or "open").strip()[:300]}
        return {"ok": True, "n": len(pfade)}
    if sys.platform.startswith("win"):
        for p in pfade[:20]:
            if app:
                subprocess.Popen([app, p])  # noqa: S603 — vom Nutzer gewähltes Programm
            else:
                os.startfile(p, "openas")  # type: ignore[attr-defined]  # noqa: S606
        return {"ok": True, "n": min(len(pfade), 20)}
    for p in pfade[:20]:
        subprocess.Popen(["xdg-open", p])  # noqa: S603, S607
    return {"ok": True, "n": min(len(pfade), 20)}
