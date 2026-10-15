#!/usr/bin/env python3
"""„Volle Suite war für genau diesen Code-Stand grün" — Stempel für den Release (04.10.2026).

Marc: „warum dauert es so lang?" — das Upload-Skript wiederholte die komplette Suite (~80 min), die für denselben
Stand Minuten vorher grün gelaufen war. Jetzt:

    suite_stempel.py schreiben <commit> <bestanden>   # run_tests.py am Ende eines vollen, grünen Laufs
    suite_stempel.py pruefen <tag-oder-commit>        # deploy_release.sh: Exit 0 = Wiederholung entbehrlich

Gültig nur, wenn
  · der Lauf voll war (kein Namensfilter) und nichts scheiterte,
  · HEAD und die nicht eingecheckten Änderungen am Ende dieselben waren wie am Anfang (prüft run_tests.py),
  · der Stempel höchstens STEMPEL_STUNDEN alt ist,
  · der Tag genau den getesteten Stand enthält: zwischen Stempel-Commit und Tag nur Doku geändert (Changelog, Handbuch,
    docs/*.md|html|xml), der reine Versionssprung `APP_VERSION` in app.py, oder Dateien, die beim Lauf schon mit GENAU
    diesem Inhalt (Git-Blob) im Arbeitsordner lagen.

15.10.2026 (Marc: „die Suite lief doch schon grün! … ändere das, dass das nicht immer 2× läuft“) — vorher galt der
Stempel nur bei sauberem Arbeitsstand. Der Release-Ablauf ist aber: Versionsnummer + Changelog vorbereiten, Suite,
grün → Commit + Tag. Die Suite lief also immer mit nicht eingecheckter Versionsnummer → kein Stempel → das Upload-Skript
fuhr die Suite (~75 min) ein zweites Mal. Jetzt merkt sich der Stempel die offenen Änderungen samt Inhalt.
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
DOKU = re.compile(r"^(CHANGELOG\.md|docs/.+\.(md|html|xml))$")


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


def offen() -> dict:
    """Nicht eingecheckte Änderungen gegen HEAD: {Pfad: Git-Blob des Inhalts auf der Platte ("" = gelöscht)} — geänderte
    eingecheckte Dateien und neue, nicht eingecheckte Code-Dateien (CODE_NEU)."""
    pfade = [f for f in git("diff", "HEAD", "--name-only").splitlines() if f]
    pfade += [z[3:] for z in git("status", "--porcelain", "--untracked-files=all").splitlines()
              if z.startswith("?? ") and CODE_NEU.match(z[3:])]
    out = {}
    for f in sorted(set(pfade)):
        out[f] = git("hash-object", "--", f) if (REPO / f).is_file() else ""
    return out


def _blob(ref: str, pfad: str) -> str:
    r = subprocess.run(["git", "rev-parse", "-q", "--verify", f"{ref}:{pfad}"], cwd=REPO, capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else ""


VERSION_ZEILE = re.compile(r'^[+-]APP_VERSION = "[0-9.]+"\s*$')


def _nur_versionssprung(a: str, b: str, pfad: str) -> bool:
    """Unterscheiden sich a und b in `pfad` nur in der Zeile APP_VERSION = "…"?"""
    if pfad != "app.py":
        return False
    zeilen = [z for z in git("diff", "-U0", a, b, "--", pfad).splitlines()
              if z[:1] in "+-" and not z.startswith(("+++", "---"))]
    return bool(zeilen) and all(VERSION_ZEILE.match(z) for z in zeilen)


def schreiben(commit: str, bestanden: int, offen_: dict | None = None) -> None:
    STEMPEL.write_text(json.dumps({"commit": commit, "bestanden": int(bestanden), "zeit": time.time(),
                                   "zeit_text": time.strftime("%Y-%m-%d %H:%M"), "offen": offen_ or {}}, indent=1),
                       encoding="utf-8")


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
    getestet = s.get("offen") or {}
    code = []
    for f in sorted(set(geaendert) | set(getestet)):
        if DOKU.match(f):
            continue
        if f in getestet:
            if _blob(ziel, f) != getestet[f]:
                code.append(f)   # im Tag ein anderer Inhalt als beim Lauf
            continue
        if not _nur_versionssprung(s["commit"], ziel, f):
            code.append(f)
    if code:
        return False, f"seit dem grünen Lauf ({s['commit'][:7]}) geändert: {', '.join(code[:5])}" + (" …" if len(code) > 5 else "")
    return True, (f"volle Suite grün für {s['commit'][:7]}" + (f" + {len(getestet)} offene Änderung(en)" if getestet else "")
                  + f" ({s.get('bestanden')} Tests, {s.get('zeit_text')})"
                  + ((f", seitdem nur Doku: {len(geaendert)} Datei(en)" if all(DOKU.match(f) for f in geaendert)
                      else f", Tag enthält genau den getesteten Stand ({len(geaendert)} Datei(en) seitdem: Doku, Version, Getestetes)")
                     if geaendert else ", identischer Stand"))


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "schreiben":
        schreiben(sys.argv[2], int(sys.argv[3]), offen())
    elif len(sys.argv) >= 3 and sys.argv[1] == "pruefen":
        ok, grund = pruefen(sys.argv[2])
        print(grund)
        sys.exit(0 if ok else 1)
    else:
        print(__doc__)
        sys.exit(2)
