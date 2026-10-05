#!/usr/bin/env python3
"""„Volle Suite war für genau diesen Code-Stand grün" — Stempel für den Release (04.10.2026).

Marc: „warum dauert es so lang?" — das Upload-Skript wiederholte die komplette Suite (~80 min), die für denselben
Stand Minuten vorher grün gelaufen war. Jetzt:

    suite_stempel.py schreiben <commit> <bestanden>   # run_tests.py am Ende eines vollen, grünen Laufs
    suite_stempel.py pruefen <tag-oder-commit>        # deploy_release.sh: Exit 0 = Wiederholung entbehrlich

Gültig nur, wenn
  · der Lauf voll war (kein Namensfilter) und nichts scheiterte,
  · der Arbeitsstand am Anfang UND am Ende sauber war und HEAD sich nicht bewegt hat (prüft run_tests.py),
  · der Stempel höchstens STEMPEL_STUNDEN alt ist,
  · zwischen Stempel-Commit und Tag nur Doku geändert wurde (Changelog, Handbuch, HANDOVER, docs/*.md|html|xml).
Die eigenen Oberflächen-Selbsttests von release_check.sh laufen trotzdem (RZ_OHNE_SUITE=1 überspringt nur die Suite).
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
STEMPEL = REPO / ".rz_suite_gruen.json"
STEMPEL_STUNDEN = 72
DOKU = re.compile(r"^(CHANGELOG\.md|HANDOVER\.md|docs/.+\.(md|html|xml))$")


def git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True, check=True).stdout.strip()


# 05.10.2026 (Audit F-10): eine neue, noch nicht eingecheckte Code-Datei (z. B. core/inhalt.py) machte den Stand nicht
# „unsauber" — die Suite lief grün, weil die Datei auf der Platte lag, der Commit ohne sie wäre aber kaputt.
CODE_NEU = re.compile(r"^(app\.py|core/.+\.py|modules/.+\.(js|css|html)|ui/.+\.(js|css|html)|i18n/.+\.json|requirements\.txt|.+\.spec)$")


def sauber() -> bool:
    if git("status", "--porcelain", "--untracked-files=no") != "":
        return False
    neu = [z[3:] for z in git("status", "--porcelain", "--untracked-files=all").splitlines() if z.startswith("?? ")]
    return not any(CODE_NEU.match(f) for f in neu)


def schreiben(commit: str, bestanden: int) -> None:
    STEMPEL.write_text(json.dumps({"commit": commit, "bestanden": int(bestanden), "zeit": time.time(),
                                   "zeit_text": time.strftime("%Y-%m-%d %H:%M")}, indent=1), encoding="utf-8")


def pruefen(ref: str) -> tuple[bool, str]:
    if not STEMPEL.exists():
        return False, "kein Stempel einer grünen Suite"
    try:
        s = json.loads(STEMPEL.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        return False, f"Stempel unlesbar ({e})"
    alter_h = (time.time() - float(s.get("zeit") or 0)) / 3600
    if alter_h > STEMPEL_STUNDEN:
        return False, f"Stempel {alter_h:.0f} h alt (höchstens {STEMPEL_STUNDEN} h)"
    try:
        ziel = git("rev-list", "-n", "1", ref)
        # Audit F-10: ein Stempel von einem Seitenzweig gilt nicht, auch wenn der Netto-Unterschied zufällig nur Doku ist
        if subprocess.run(["git", "merge-base", "--is-ancestor", s["commit"], ziel], cwd=REPO).returncode != 0:
            return False, f"grüner Lauf ({s['commit'][:7]}) ist kein Vorfahre von {ref}"
        geaendert = [f for f in git("diff", "--name-only", s["commit"], ziel).splitlines() if f]
    except subprocess.CalledProcessError as e:
        return False, f"Git-Vergleich fehlgeschlagen ({(e.stderr or '').strip()[:120]})"
    code = [f for f in geaendert if not DOKU.match(f)]
    if code:
        return False, f"seit dem grünen Lauf ({s['commit'][:7]}) geändert: {', '.join(code[:5])}" + (" …" if len(code) > 5 else "")
    return True, (f"volle Suite grün für {s['commit'][:7]} ({s.get('bestanden')} Tests, {s.get('zeit_text')})"
                  + (f", seitdem nur Doku: {len(geaendert)} Datei(en)" if geaendert else ", identischer Stand"))


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "schreiben":
        schreiben(sys.argv[2], int(sys.argv[3]))
    elif len(sys.argv) >= 3 and sys.argv[1] == "pruefen":
        ok, grund = pruefen(sys.argv[2])
        print(grund)
        sys.exit(0 if ok else 1)
    else:
        print(__doc__)
        sys.exit(2)
