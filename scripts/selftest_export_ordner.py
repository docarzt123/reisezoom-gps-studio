#!/usr/bin/env python3
"""Export-Dialog: Vorschlagsordner ohne gemerkten Ordner.

Der Anlass
----------
`export_ziel_vorschlag` schlug ohne gemerkten Ordner immer `~/Movies` vor. Den
Ordner gibt es nur auf dem Mac; unter Windows und Linux heißt er `Videos`.
Folge: Der erste Video-Export landete direkt im Benutzerordner, und der wurde
danach als Dialog-Ordner gemerkt.

Geprüft wird mit einem temporären Benutzerordner; der gemerkte Dialog-Ordner
ist leer gemockt, es wird nichts im echten Benutzer- oder App-Ordner angelegt.

Aufruf:  .venv/bin/python scripts/selftest_export_ordner.py
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path
from unittest import mock

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
os.chdir(REPO)

import app as APP   # noqa: E402

fehler = 0


def sagen(ok: bool, text: str, zusatz: str = "") -> None:
    global fehler
    print(f"  [{'OK  ' if ok else 'FAIL'}] {text}" + (f"  {zusatz}" if zusatz else ""))
    if not ok:
        fehler += 1


def vorschlag(heim: Path, plattform: str, dateitypen: tuple[str, ...]) -> str:
    """Ordner des Vorschlags bei leerem Merkplatz, gegebener Plattform und Benutzerordner."""
    with mock.patch.object(APP, "_dialog_ordner_lesen", return_value=""), \
            mock.patch.object(APP.Path, "home", return_value=heim), \
            mock.patch.object(sys, "platform", plattform):
        return APP.Api().export_ziel_vorschlag("Export", dateitypen)["ordner"]


def main() -> int:
    with tempfile.TemporaryDirectory() as t:
        basis = Path(t)

        print("Windows/Linux: Video-Export → Videos")
        heim = basis / "win"
        (heim / "Videos").mkdir(parents=True)
        (heim / "Pictures").mkdir()
        for plattform in ("win32", "linux"):
            o = vorschlag(heim, plattform, ("Video (*.mp4)",))
            sagen(o == str(heim / "Videos"), f"{plattform}: Videos", o)

        print("macOS: Video-Export → Movies")
        heim = basis / "mac"
        (heim / "Movies").mkdir(parents=True)
        (heim / "Pictures").mkdir()
        o = vorschlag(heim, "darwin", ("Video (*.mp4)",))
        sagen(o == str(heim / "Movies"), "darwin: Movies", o)

        print("Ordner fehlt → Benutzerordner")
        heim = basis / "leer"
        heim.mkdir()
        o = vorschlag(heim, "win32", ("Video (*.mp4)",))
        sagen(o == str(heim), "win32 ohne Videos: Benutzerordner", o)

        print("PNG-Export → Pictures (unverändert)")
        heim = basis / "bild"
        (heim / "Pictures").mkdir(parents=True)
        for plattform in ("win32", "darwin"):
            o = vorschlag(heim, plattform, ("Bild (*.png)",))
            sagen(o == str(heim / "Pictures"), f"{plattform}: Pictures", o)

    print("RESULT: " + ("OK" if fehler == 0 else f"FAIL ({fehler})"))
    return 1 if fehler else 0


if __name__ == "__main__":
    sys.exit(main())
