#!/usr/bin/env python3
"""Test-Bibliothek befüllen (25.09.2026) — gehört zu scripts/testumgebung.sh.

Läuft mit RZ_APP_ORDNER=<Testwurzel>/App-Ordner: legt <Testwurzel>/Bibliothek an,
setzt den Zeiger, liest <Testwurzel>/Arbeit/archiv ins Archiv ein, legt zwei
Sammlungen an und schreibt <Testwurzel>/SOLL-ARCHIV.md — die Track-Check-Marken,
wie das Archiv sie zeigt (mit Aktivität und „geplant", anders als ein nackter Check).

Fasst NUR die Testwurzel an. Aufruf nur über testumgebung.sh.
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def main() -> None:
    sys.stdout.reconfigure(line_buffering=True)
    wurzel = Path(sys.argv[1]).expanduser().resolve()
    app_ordner = Path(os.environ.get("RZ_APP_ORDNER", "")).resolve()
    if not str(app_ordner).startswith(str(wurzel)):
        sys.exit("RZ_APP_ORDNER muss in der Testwurzel liegen — Abbruch.")
    from core import bibliothek as cbib, dateischutz as ds
    bib = wurzel / "Bibliothek"
    # Vor dem App-Import den Dateischutz kennen lassen, wo er schreiben darf (die App
    # setzt das erst beim Import, der Zeiger muss aber vorher stehen)
    ds.app_ordner_setzen(app_ordner)
    ds.bereich_anmelden("bibliothek", bib)
    cbib.anlegen(bib)
    cbib.ort_schreiben(app_ordner, bib)

    import app as A
    api = A.Api()
    if not A.BIB_BEREIT:
        sys.exit(f"Bibliothek nicht bereit: {A.BIB_PROBLEM}")
    try:
        r = api.library_add_folder(str(wurzel / "Arbeit" / "archiv"))
        print("Ordner:", r.get("ok"), r.get("error", ""))
        api.library_scan_start()
        for _ in range(1200):
            s = api.library_scan_status()
            if not s.get("running"):
                break
            time.sleep(1)
        conn = api._lib()
        zeilen = conn.execute("select path, filename, check_stufe, check_json, activity, planned "
                              "from tracks where haupt=1 order by filename").fetchall()
        print("Touren im Archiv:", len(zeilen))

        def pfade(teil: str) -> list:
            return [z[0] for z in zeilen if f"/{teil}/" in z[0]]
        for name, teil in (("Teneriffa Februar 2026", "08-teneriffa-woche"), ("Problemfälle", "04-trackcheck")):
            c = api.library_collection_create(name, pfade(teil))
            print("Sammlung", name, c.get("ok"), len(pfade(teil)))

        out = ["# Soll-Werte im Archiv (Track-Check-Marke je Tour)\n",
               "So zeigt das Archiv der vorbefüllten Test-Bibliothek die Touren an — erzeugt beim Befüllen.",
               "Marke: rot/gelb = Kachel-Marke, grau/— = keine Marke.\n",
               "| Ordner | Datei | Aktivität | geplant | Stufe | Befunde |", "|---|---|---|---|---|---|"]
        for path, fn, stufe, cj, akt, geplant in zeilen:
            try:
                bef = json.loads(cj or "[]")
            except ValueError:
                bef = []
            kurz = " ".join(f"{b.get('key')}:{b.get('n')}" for b in bef) or "—"
            out.append(f"| {Path(path).parent.name} | `{fn}` | {akt or '—'} | {'ja' if geplant else ''} | "
                       f"{stufe or '—'} | {kurz} |")
        (wurzel / "SOLL-ARCHIV.md").write_text("\n".join(out) + "\n", encoding="utf-8")
        print("✓", wurzel / "SOLL-ARCHIV.md")
    finally:
        try:
            cbib.sperre_freigeben(A.BIB)
        except Exception as e:  # noqa: BLE001
            print("Sperre freigeben:", e)
    sys.stdout.flush(); sys.stderr.flush()
    os._exit(0)   # Hintergrund-Fäden der App nicht abwarten


if __name__ == "__main__":
    main()
