#!/usr/bin/env python3
"""Bibliotheks-Sperre: Lebendprüfung unter Windows und Freigabe beim Schließen (seit 18.10.2026).

Prüft zweierlei:

  A) Die Lebendprüfung der Sperre (`cbib._sperre_lebt`) und der Ladeflagge (`app._ladeflagge_haengt`)
     antwortet für einen lebenden und einen beendeten Prozess richtig, ohne Ausnahme und ohne dass ein
     Strg+C an den lebenden Prozess geht. (Unter Windows ist `os.kill(pid, 0)` ein Strg+C an die Konsole.)
     Dieser Teil läuft in einem eigenen Prozess mit eigener Konsole bzw. ganz ohne Konsole (wie die
     gefensterte App), damit ein Strg+C hier nie den Aufrufer trifft.
  B) `Api._bib_schliessen` löscht die eigene Sperre, und der Fenster-Schließ-Handler ruft es auf,
     bevor der Prozess hart beendet wird.

Alle App-Daten liegen in einem frischen Temp-Ordner (RZ_APP_ORDNER), der echte App-Ordner bleibt unberührt.

    python scripts/selftest_sperre.py
"""
from __future__ import annotations

import atexit
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

fails: list[str] = []


def check(name, cond, detail=""):
    print(f"  {'✓' if cond else '✗ FAIL'}  {name}" + (f"   [{detail}]" if detail and not cond else ""))
    if not cond:
        fails.append(name)


def _app_laden():
    """app importieren — mit frischem App-Ordner, der vor dem Import gesetzt wird."""
    ordner = Path(tempfile.mkdtemp(prefix="rz-sperre-"))
    os.environ["RZ_APP_ORDNER"] = str(ordner)
    atexit.register(shutil.rmtree, str(ordner), True)
    os.chdir(REPO)
    import app as APP
    return APP, ordner


def _schlaefer():
    return subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"],
                            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


# ── Teil A: im Kindprozess ────────────────────────────────────────────────────

def teil_a_kind(ergebnis: Path) -> None:
    """Läuft im eigenen Prozess; schreibt die Ergebnisse als JSON in `ergebnis`."""
    import signal
    res: dict = {}
    strg_c = []
    try:
        signal.signal(signal.SIGINT, lambda *_: strg_c.append(1))
    except Exception:
        pass
    APP, _ordner = _app_laden()
    from core import bibliothek as cbib

    def sperre(pid):
        return {"pid": pid, "rechner": cbib._rechnername(), "rechner_id": cbib._rechner_id(),
                "zeit": time.time(), "puls": True}

    def versuch(schluessel, fn):
        try:
            res[schluessel] = bool(fn())
        except BaseException as e:  # noqa: BLE001
            res[schluessel] = f"{type(e).__name__}: {e}"

    kind = _schlaefer()
    time.sleep(0.5)
    versuch("sperre_lebend", lambda: cbib._sperre_lebt(sperre(kind.pid)))
    versuch("flagge_lebend", lambda: APP._ladeflagge_haengt({"status": "laedt", "pid": kind.pid}))
    time.sleep(1.0)                                  # ein Strg+C käme spätestens jetzt an
    res["kind_ohne_strg_c"] = kind.poll() is None
    res["aufrufer_ohne_strg_c"] = not strg_c
    kind.kill()
    kind.wait()
    versuch("sperre_tot", lambda: cbib._sperre_lebt(sperre(kind.pid)))
    versuch("flagge_tot", lambda: APP._ladeflagge_haengt({"status": "laedt", "pid": kind.pid}))
    ergebnis.write_text(json.dumps(res), encoding="utf-8")


def teil_a(modus: str) -> None:
    ziel = Path(tempfile.mkdtemp(prefix="rz-sperre-erg-"))
    atexit.register(shutil.rmtree, str(ziel), True)
    erg = ziel / "erg.json"
    flags = 0
    si = None
    if sys.platform.startswith("win"):
        flags = subprocess.CREATE_NEW_CONSOLE if modus == "konsole" else subprocess.DETACHED_PROCESS
        si = subprocess.STARTUPINFO()
        si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        si.wShowWindow = 0
    p = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--teil-a", str(erg)],
                         creationflags=flags, startupinfo=si, stdin=subprocess.DEVNULL,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        p.wait(timeout=120)
    except subprocess.TimeoutExpired:
        p.kill()
    res = {}
    if erg.is_file():
        res = json.loads(erg.read_text(encoding="utf-8"))
    check(f"[{modus}] Prüfprozess lieferte Ergebnisse", bool(res), f"Exit {p.returncode}")
    check(f"[{modus}] Sperre eines lebenden Prozesses gilt als lebendig", res.get("sperre_lebend") is True,
          str(res.get("sperre_lebend")))
    check(f"[{modus}] Ladeflagge eines lebenden Prozesses hängt nicht", res.get("flagge_lebend") is False,
          str(res.get("flagge_lebend")))
    check(f"[{modus}] lebender Prozess bekam kein Strg+C", res.get("kind_ohne_strg_c") is True)
    check(f"[{modus}] Aufrufer bekam kein Strg+C", res.get("aufrufer_ohne_strg_c") is True)
    check(f"[{modus}] Sperre eines beendeten Prozesses gilt als tot, ohne Ausnahme",
          res.get("sperre_tot") is False, str(res.get("sperre_tot")))
    check(f"[{modus}] Ladeflagge eines beendeten Prozesses hängt", res.get("flagge_tot") is True,
          str(res.get("flagge_tot")))


# ── Teil B: Schließen gibt die Sperre frei ────────────────────────────────────

def teil_b() -> None:
    APP, ordner = _app_laden()
    from core import bibliothek as cbib

    ort = ordner / "bib-test"
    ort.mkdir()
    check("Sperre nehmen klappt", cbib.sperre_nehmen(ort).get("ok") is True)
    datei = ort / cbib.SPERRDATEI
    check("Sperrdatei liegt", datei.is_file())

    alt_ort, alt_bereit = APP.BIB, APP.BIB_BEREIT
    try:
        APP.BIB, APP.BIB_BEREIT = ort, True
        APP.Api._bib_schliessen(None)          # self wird nicht gebraucht
    finally:
        APP.BIB, APP.BIB_BEREIT = alt_ort, alt_bereit
    check("_bib_schliessen löscht die eigene Sperre (Dateischutz erlaubt es)", not datei.exists())

    # Fremde Sperre (anderer Rechner) bleibt unangetastet
    datei.write_text(json.dumps({"pid": os.getpid(), "rechner": "anderer", "rechner_id": "anderer-rechner",
                                 "zeit": time.time()}), encoding="utf-8")
    try:
        APP.BIB, APP.BIB_BEREIT = ort, True
        APP.Api._bib_schliessen(None)
    finally:
        APP.BIB, APP.BIB_BEREIT = alt_ort, alt_bereit
    check("fremde Sperre bleibt liegen", datei.exists())

    # Der Schließ-Handler (in main() verschachtelt, daher am Quelltext) ruft es vor dem Force-Exit auf.
    quelle = (REPO / "app.py").read_text(encoding="utf-8")
    m = re.search(r"    def _on_closing\(\):\n(.*?)\n    try:\n        win\.events\.closing \+= _on_closing", quelle, re.S)
    check("_on_closing im Quelltext gefunden", bool(m))
    if m:
        k = m.group(1)
        i_bib = k.find("_bib_schliessen")
        i_exit = k.find("threading.Thread(target=_force_exit")
        check("_on_closing ruft _bib_schliessen auf", i_bib >= 0)
        check("… und zwar vor dem Start des Force-Exit", 0 <= i_bib < i_exit > 0, f"{i_bib} / {i_exit}")


def main() -> int:
    if len(sys.argv) == 3 and sys.argv[1] == "--teil-a":
        teil_a_kind(Path(sys.argv[2]))
        return 0
    print("Teil A: Lebendprüfung")
    for modus in ("konsole", "ohne-konsole"):
        teil_a(modus)
    print("Teil B: Schließen")
    teil_b()
    if fails:
        print(f"RESULT: FAIL ({len(fails)})")
        return 1
    print("RESULT: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
