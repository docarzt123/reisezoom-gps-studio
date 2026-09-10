"""Selbst-Installation auf dem Mac (10.09.2026, Marc: „das ist ein DAU-Problem — wie
könnte man das lösen?").

Der ganze Ärger beim Beta-Tester hing an einem Handgriff: das Symbol aus dem Download-
Fenster nach „Programme" ziehen. Wer stattdessen doppelklickt, bekommt von macOS eine
Kopie in einem gesperrten Zufalls-Ordner (App Translocation), die App findet ihre
Dateien nicht, und die Startfehler-Seite erklärt seitenweise, was zu tun wäre.

Ab jetzt nimmt die App ihm den Handgriff ab: Ein Knopf kopiert das Bundle nach
/Applications, ersetzt ältere Kopien, nimmt der Kopie die Quarantäne (sonst würde
macOS auch die Kopie in den Zufalls-Ordner schieben), wirft das Download-Image aus
und startet die neue Kopie. Muster wie bei LetsMove.

Alles hier ist so gebaut, dass es ohne laufende App prüfbar ist: reine Funktionen mit
Pfaden, die Aufrufe an `ditto`/`hdiutil`/`open` gehen durch `_run`, das der Prüfstand
austauscht.
"""
from __future__ import annotations

import os
import plistlib
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Callable, Optional

APP_NAME = "Reisezoom GPS Studio"
ZIEL_ORDNER = Path("/Applications")
_KOPIE_RE = re.compile(r"^Reisezoom GPS Studio( \d+)?\.app$")


def _run(cmd: list[str], timeout: float = 120.0) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)


def bundle_pfad(exe: Optional[str] = None) -> Optional[Path]:
    """…/Reisezoom GPS Studio.app aus dem Pfad der laufenden Programmdatei
    (…/X.app/Contents/MacOS/ReisezoomGPSStudio). None, wenn nicht gebündelt."""
    p = Path(exe or sys.executable or "")
    for anc in [p] + list(p.parents):
        if anc.suffix == ".app":
            return anc
    return None


def ist_translocation(pfad: Optional[Path]) -> bool:
    return bool(pfad) and "/AppTranslocation/" in str(pfad)


def in_programme(pfad: Optional[Path]) -> bool:
    try:
        return bool(pfad) and Path(pfad).resolve().parent == ZIEL_ORDNER.resolve()
    except OSError:
        return False


def kopien_in_programme(ordner: Path = ZIEL_ORDNER) -> list[Path]:
    """Alle „Reisezoom GPS Studio*.app" in Programme — inkl. „… 2.app" vom Doppel-Ziehen."""
    try:
        return sorted(p for p in ordner.iterdir() if _KOPIE_RE.match(p.name))
    except OSError:
        return []


def images_mit_app(hdiutil_plist: Optional[bytes] = None) -> list[Path]:
    """Eingehängte Disk-Images, die unsere App enthalten (= das Download-Image).
    `hdiutil info -plist` liefert je Image die Mount-Points; wir schauen nach, ob dort
    ein Reisezoom-Bundle liegt."""
    try:
        if hdiutil_plist is None:
            r = _run(["hdiutil", "info", "-plist"], timeout=20)
            if r.returncode != 0:
                return []
            hdiutil_plist = r.stdout.encode("utf-8")
        info = plistlib.loads(hdiutil_plist)
    except Exception:
        return []
    raus: list[Path] = []
    for img in info.get("images") or []:
        for ent in img.get("system-entities") or []:
            mp = ent.get("mount-point")
            if not mp:
                continue
            mp = Path(mp)
            try:
                if any(_KOPIE_RE.match(x.name) for x in mp.iterdir()):
                    raus.append(mp)
            except OSError:
                continue
    return sorted(set(raus))


def _quarantaene_weg(ziel: Path) -> None:
    _run(["xattr", "-dr", "com.apple.quarantine", str(ziel)], timeout=120)


def installieren(quelle: Path, ziel_ordner: Path = ZIEL_ORDNER, *,
                 papierkorb: Optional[Callable[[Path], None]] = None,
                 log: Optional[Callable[[str], None]] = None) -> dict:
    """Bundle nach `ziel_ordner` kopieren und dort zur einzigen Kopie machen.

    Reihenfolge, damit nie ein halber Zustand bleibt:
      1. nach „<ziel>.neu" kopieren (`ditto`: Signatur, Rechte, Ressourcen bleiben),
      2. Quarantäne von der Kopie nehmen,
      3. vorhandene Kopien (auch „… 2.app") in den Papierkorb,
      4. „.neu" auf den richtigen Namen umbenennen.
    Liefert {ok, ziel, ersetzt:[…]} oder {ok:False, error}."""
    say = log or (lambda _m: None)
    quelle = Path(quelle)
    if not quelle.exists() or quelle.suffix != ".app":
        return {"ok": False, "error": f"Quelle fehlt: {quelle}"}
    ziel = ziel_ordner / f"{APP_NAME}.app"
    if quelle.resolve() == ziel.resolve():
        return {"ok": True, "ziel": str(ziel), "ersetzt": [], "unveraendert": True}
    if not os.access(ziel_ordner, os.W_OK):
        return {"ok": False, "error": "Programme-Ordner nicht beschreibbar", "grund": "rechte"}
    tmp = ziel_ordner / f"{APP_NAME}.app.neu"
    if tmp.exists():
        shutil.rmtree(tmp, ignore_errors=True)
    say(f"kopiere {quelle} → {tmp}")
    r = _run(["ditto", str(quelle), str(tmp)], timeout=600)
    if r.returncode != 0 or not tmp.exists():
        shutil.rmtree(tmp, ignore_errors=True)
        return {"ok": False, "error": (r.stderr or "ditto fehlgeschlagen").strip()[:300]}
    _quarantaene_weg(tmp)
    ersetzt = []
    for alt in kopien_in_programme(ziel_ordner):
        if alt.resolve() == quelle.resolve():
            continue
        try:
            if papierkorb:
                papierkorb(alt)
            else:
                shutil.rmtree(alt)
            ersetzt.append(str(alt))
            say(f"alte Kopie weg: {alt}")
        except Exception as e:  # noqa: BLE001
            shutil.rmtree(tmp, ignore_errors=True)
            return {"ok": False, "error": f"Alte Kopie lässt sich nicht entfernen: {alt} ({e})"}
    tmp.rename(ziel)
    say(f"installiert: {ziel}")
    return {"ok": True, "ziel": str(ziel), "ersetzt": ersetzt}


def neu_starten_und_auswerfen(ziel: Path, images: list[Path]) -> None:
    """Die neue Kopie starten und die Download-Images auswerfen — aus einem
    abgekoppelten Shell-Prozess, denn das Auswerfen geht erst, wenn WIR weg sind."""
    teile = ["sleep 1", f'open -n "{ziel}"']
    for mp in images:
        teile.append(f'sleep 2; hdiutil detach "{mp}" -force >/dev/null 2>&1 || true')
    subprocess.Popen(["/bin/sh", "-c", "; ".join(teile)], start_new_session=True,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def auswerfen(images: list[Path]) -> list[str]:
    fehler = []
    for mp in images:
        r = _run(["hdiutil", "detach", str(mp)], timeout=30)
        if r.returncode != 0:
            r = _run(["hdiutil", "detach", str(mp), "-force"], timeout=30)
        if r.returncode != 0:
            fehler.append(f"{mp}: {(r.stderr or '').strip()[:120]}")
    return fehler
