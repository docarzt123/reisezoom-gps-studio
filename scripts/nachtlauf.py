#!/usr/bin/env python3
"""Nacht-Suite: die volle Testsuite einmal pro Nacht, auf einer Kopie des Projekts (05.10.2026).

Marc: „kannst du einen Timer stellen, dass die Suite jede Nacht losläuft, wenn nicht am Tool gebaut wird? Muss
natürlich nur laufen, wenn sich was geändert hat." Rhythmus: tagsüber bauen + gezielte Tests, nachts volle Suite,
morgens Commit/Release.

Ablauf (gestartet von launchd um 3:00 — siehe `--einrichten`):
  1. Schon in dieser Nacht gelaufen? → Ende.
  2. Wird gerade gebaut (Datei jünger als RUHE_MIN, Build/Test läuft)? → bis BUILD_WARTEN_MIN warten, sonst fällt
     die Nacht aus (Mitteilung). Claude hört nachts gegen 2:00 auf (Marc, 05.10.2026).
  3. Fingerabdruck über Code + Tests gleich wie beim letzten Lauf → nichts zu tun.
  4. Projekt in einen eigenen Ordner spiegeln (rsync) und dort `scripts/run_tests.py` laufen lassen — der
     Arbeitsordner bleibt frei.
  5. Ergebnis (Zusammenfassung + Log) nach ZIEL, macOS-Mitteilung.

Aufrufe:
  python3 scripts/nachtlauf.py              # wie launchd (mit allen Prüfungen)
  python3 scripts/nachtlauf.py --jetzt      # ohne Uhrzeit-/Ruhe-Prüfung, z. B. zum Ausprobieren
  python3 scripts/nachtlauf.py --einrichten # launchd-Auftrag anlegen/erneuern (täglich 3:00)
  python3 scripts/nachtlauf.py --entfernen  # launchd-Auftrag entfernen
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import plistlib
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PYTHON = REPO / ".venv" / "bin" / "python"
SPIEGEL = Path.home() / "GPS-Studio-Nachtlauf" / "repo"
ZUSTAND = Path.home() / "GPS-Studio-Nachtlauf" / "zustand.json"
ZIEL = Path("/Volumes/MacMini 2TB Acasis/GPS Studio Final/Nachtlauf")
LABEL = "com.reisezoom.gpsstudio.nachtlauf"
PLIST = Path.home() / "Library" / "LaunchAgents" / f"{LABEL}.plist"
STUNDEN = (3,)             # Marc, 05.10.2026: um 3 starten, bis 5 fertig
RUHE_MIN = 45              # so lange darf keine Projektdatei geändert worden sein (Claude hört gegen 2:00 auf)
BUILD_WARTEN_MIN = 60      # so lange auf Ruhe / einen laufenden Build warten, dann fällt die Nacht aus
# Was in den Fingerabdruck und in die Kopie gehört — Code, Tests, Sprachen, Doku fürs Handbuch
CODE_ENDUNGEN = {".py", ".js", ".css", ".html", ".json", ".spec", ".sh", ".md", ".txt", ".plist"}
AUSLASSEN = {".git", ".venv", "node_modules", "__pycache__", "dist", "build", "_backups", "logs", "pw-browsers",
             "_renders", "_papierkorb", "photo_thumb_cache", "library_thumbs", "tests/_out", "tests/output"}


def _umgebung() -> dict:
    """Umgebung für die Suite. 06.10.2026: launchd startet mit PATH=/usr/bin:/bin:/usr/sbin:/sbin — node, ffmpeg,
    ffprobe (Homebrew) fehlten, 38 Tests wurden rot, ohne dass am Code etwas war. RZ_NACHTLAUF=1 sagt den Tests,
    dass niemand da ist (keine geschützten Ordner wie ~/Downloads — macOS fragt dann nach und der Test wartet)."""
    env = dict(os.environ)
    vorne = ["/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin"]
    rest = [x for x in env.get("PATH", "/usr/bin:/bin:/usr/sbin:/sbin").split(":") if x and x not in vorne]
    env["PATH"] = ":".join(vorne + rest)
    env.setdefault("LANG", "de_DE.UTF-8")
    env["RZ_NACHTLAUF"] = "1"
    return env


def _log(text: str) -> None:
    print(f"{dt.datetime.now():%Y-%m-%d %H:%M:%S} {text}", flush=True)


def _zustand() -> dict:
    try:
        return json.loads(ZUSTAND.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return {}


def _zustand_merken(z: dict) -> None:
    ZUSTAND.parent.mkdir(parents=True, exist_ok=True)
    ZUSTAND.write_text(json.dumps(z, indent=1, ensure_ascii=False), encoding="utf-8")


def _dateien():
    for wurzel, ordner, namen in os.walk(REPO):
        rel = Path(wurzel).relative_to(REPO).as_posix()
        ordner[:] = [o for o in ordner if o not in AUSLASSEN and f"{rel}/{o}".lstrip("./") not in AUSLASSEN
                     and not o.startswith(".")]
        for n in namen:
            p = Path(wurzel) / n
            if p.suffix.lower() in CODE_ENDUNGEN and not n.startswith("."):
                yield p


def fingerabdruck() -> tuple[str, float]:
    """(Prüfsumme über Inhalte, jüngste Änderungszeit)."""
    h = hashlib.sha256()
    juengste = 0.0
    for p in sorted(_dateien()):
        try:
            st = p.stat()
            juengste = max(juengste, st.st_mtime)
            h.update(p.relative_to(REPO).as_posix().encode())
            h.update(p.read_bytes())
        except OSError:
            continue
    return h.hexdigest(), juengste


def wird_gebaut() -> str:
    """Grund, warum gerade nicht getestet werden soll — oder "".

    05.10.2026 — Ruhe-Pflicht bleibt (Marc: „nachts hörst du irgendwann auf, damit die Suite laufen kann und wir
    einen vernünftigen Stand haben, sonst baust du vielleicht Folgefehler"): Claude hört gegen 2:00 auf zu bauen.
    Läuft noch ein App-Build oder Testlauf, wartet `lauf()` bis BUILD_WARTEN_MIN darauf."""
    try:
        ps = subprocess.run(["ps", "-axo", "command"], capture_output=True, text=True, timeout=10).stdout
    except Exception:  # noqa: BLE001
        ps = ""
    for merkmal in ("build.sh", "pyinstaller", "run_tests.py", "/tests/test_"):
        if merkmal in ps:
            return f"läuft gerade: {merkmal}"
    _, juengste = fingerabdruck()
    alter = (time.time() - juengste) / 60
    if alter < RUHE_MIN:
        return f"Projekt vor {alter:.0f} min geändert (Ruhe {RUHE_MIN} min)"
    return ""


def spiegeln() -> None:
    SPIEGEL.mkdir(parents=True, exist_ok=True)
    aus = []
    # .git kommt mit: Tests wie test_suite_stempel fragen Git (Commits, Tags)
    for a in sorted(AUSLASSEN - {".venv", ".git"}):
        aus += ["--exclude", f"/{a}"]
    subprocess.run(["rsync", "-a", "--delete", *aus, "--exclude", "/.venv", f"{REPO}/", f"{SPIEGEL}/"], check=True)
    # Die Kopie benutzt die Python-Umgebung des Projekts (kein zweites venv nötig)
    venv = SPIEGEL / ".venv"
    if not venv.exists():
        venv.symlink_to(REPO / ".venv")
    # 06.10.2026 — test_render_treiber_ende_zu_ende liest eine echte Tour aus ../GPX (Nachbarordner des Projekts);
    # in der Kopie fehlte er, der Test war dort immer rot. Verknüpfung, nur gelesen.
    gpx = SPIEGEL.parent / "GPX"
    if not gpx.exists() and (REPO.parent / "GPX").is_dir():
        gpx.symlink_to(REPO.parent / "GPX")


def mitteilen(titel: str, text: str) -> None:
    try:
        subprocess.run(["osascript", "-e", f'display notification "{text}" with title "{titel}"'], timeout=10)
    except Exception:  # noqa: BLE001
        pass


def lauf(jetzt: bool = False) -> int:
    z = _zustand()
    heute = (dt.datetime.now() - dt.timedelta(hours=12)).strftime("%Y-%m-%d")   # „Nacht" = Abend bis Morgen
    if not jetzt and z.get("nacht") == heute:
        _log("diese Nacht schon gelaufen — Ende")
        return 0
    if not jetzt:
        grund = wird_gebaut()
        bis = time.time() + BUILD_WARTEN_MIN * 60
        while grund and time.time() < bis:
            time.sleep(60)
            grund = wird_gebaut()
        if grund:
            _log(f"ausgefallen: {grund}")
            mitteilen("GPS Studio · Nacht-Suite", f"heute ausgefallen — {grund}")
            return 0
    fp, _ = fingerabdruck()
    if not jetzt and fp == z.get("fingerabdruck") and z.get("ergebnis") == "grün":
        _log("nichts geändert seit dem letzten grünen Lauf — Ende")
        z["nacht"] = heute
        _zustand_merken(z)
        return 0
    kopf = subprocess.run(["git", "-C", str(REPO), "log", "--oneline", "-1"], capture_output=True, text=True).stdout.strip()
    _log(f"starte Nacht-Suite ({kopf})")
    spiegeln()
    stempel = dt.datetime.now().strftime("%Y%m%d-%H%M")
    ZIEL.mkdir(parents=True, exist_ok=True)
    log_pfad = ZIEL / f"{stempel}-suite.log"
    t0 = time.time()
    with open(log_pfad, "w", encoding="utf-8") as fh:
        r = subprocess.run([str(PYTHON), "-u", "scripts/run_tests.py"], cwd=SPIEGEL, stdout=fh, stderr=subprocess.STDOUT,
                           env=_umgebung())
    dauer = time.time() - t0
    text = log_pfad.read_text(encoding="utf-8", errors="replace")
    import re
    sauber = re.sub(r"\x1b\[[0-9;]*m", "", text)
    # nur die Zeilen der Übersicht („✗ test_….py"), nicht die „✗ FAIL …" aus den Fehlerausgaben dahinter
    rot = [z_.strip()[2:].split("  ")[0] for z_ in sauber.splitlines() if re.match(r"\s*✗ test_\S+\.py", z_)]
    bilanz = next((z_.strip() for z_ in reversed(sauber.splitlines()) if "bestanden" in z_ and "gescheitert" in z_), "")
    ergebnis = "grün" if r.returncode == 0 and not rot else "rot"
    zusammenfassung = {"zeit": stempel, "stand": kopf, "ergebnis": ergebnis, "bilanz": bilanz, "rot": rot,
                       "dauer_min": round(dauer / 60), "log": log_pfad.name, "fingerabdruck": fp}
    (ZIEL / f"{stempel}-ergebnis.json").write_text(json.dumps(zusammenfassung, indent=1, ensure_ascii=False),
                                                     encoding="utf-8")
    (ZIEL / "LETZTER-LAUF.txt").write_text(
        f"Nacht-Suite {stempel} · Stand {kopf}\nErgebnis: {ergebnis.upper()} — {bilanz}\n"
        + (("Rot: " + ", ".join(rot) + "\n") if rot else "") + f"Dauer: {round(dauer / 60)} min · Log: {log_pfad.name}\n",
        encoding="utf-8")
    z.update({"nacht": heute, "fingerabdruck": fp, "ergebnis": ergebnis, "zeit": stempel})
    _zustand_merken(z)
    # alte Logs: nur die letzten 14 Nächte behalten
    alte = sorted(ZIEL.glob("*-suite.log"))[:-14]
    for p in alte:
        for q in (p, p.with_name(p.name.replace("-suite.log", "-ergebnis.json"))):
            try:
                q.unlink()
            except OSError:
                pass
    mitteilen("GPS Studio · Nacht-Suite", f"{ergebnis.upper()} — {bilanz}" + (f" · rot: {len(rot)}" if rot else ""))
    _log(f"fertig: {ergebnis} — {bilanz}")
    return 0


def einrichten() -> None:
    PLIST.parent.mkdir(parents=True, exist_ok=True)
    log = Path.home() / "GPS-Studio-Nachtlauf" / "launchd.log"
    log.parent.mkdir(parents=True, exist_ok=True)
    daten = {
        "Label": LABEL,
        "ProgramArguments": [str(PYTHON), str(Path(__file__).resolve())],
        "StartCalendarInterval": [{"Hour": h, "Minute": 0} for h in STUNDEN],
        "StandardOutPath": str(log), "StandardErrorPath": str(log),
        "WorkingDirectory": str(REPO),
    }
    subprocess.run(["launchctl", "unload", str(PLIST)], capture_output=True)
    PLIST.write_bytes(plistlib.dumps(daten))
    subprocess.run(["launchctl", "load", str(PLIST)], check=True)
    print(f"eingerichtet: {PLIST} — Versuche um " + ", ".join(f"{h}:00" for h in STUNDEN))


def entfernen() -> None:
    subprocess.run(["launchctl", "unload", str(PLIST)], capture_output=True)
    try:
        PLIST.unlink()
    except FileNotFoundError:
        pass
    print("entfernt")


if __name__ == "__main__":
    if "--einrichten" in sys.argv:
        einrichten()
    elif "--entfernen" in sys.argv:
        entfernen()
    else:
        sys.exit(lauf(jetzt="--jetzt" in sys.argv))
