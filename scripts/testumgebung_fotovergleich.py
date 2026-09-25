#!/usr/bin/env python3
"""Getaggte Fotos mit den Soll-Positionen vergleichen (Testumgebung, 25.09.2026).

    .venv/bin/python scripts/testumgebung_fotovergleich.py ~/GPS-Studio-Test/Ausgaben/getaggt-echt

Liest GPS aus den Fotos im Ordner und vergleicht je Dateiname mit
~/GPS-Studio-Test/Quellen/10-fotos/echt-soll-positionen.json (Marcs Lightroom-Positionen).
Ausgabe je Kamera: Anzahl, ohne GPS, Median- und Höchstabstand. Soll: Median < 50 m.
"""
import json
import math
import statistics
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

ordner = Path(sys.argv[1]).expanduser()
soll = json.loads((Path.home() / "GPS-Studio-Test" / "Quellen" / "10-fotos" / "echt-soll-positionen.json")
                  .read_text(encoding="utf-8"))
r = subprocess.run(["exiftool", "-q", "-json", "-n", "-r", "-GPSLatitude", "-GPSLongitude", str(ordner)],
                   capture_output=True, text=True)
ist = {Path(x["SourceFile"]).name: x for x in json.loads(r.stdout or "[]")}
je = defaultdict(lambda: {"n": 0, "ohne": 0, "d": []})
for name, s in soll.items():
    x = ist.get(name)
    if x is None:
        continue
    k = je[s["kamera"]]
    k["n"] += 1
    if x.get("GPSLatitude") is None or s.get("lat") is None:
        k["ohne"] += 1
        continue
    dy = math.radians(x["GPSLatitude"] - s["lat"])
    dx = math.radians(x["GPSLongitude"] - s["lon"]) * math.cos(math.radians(s["lat"]))
    k["d"].append(6371000 * math.hypot(dx, dy))
if not je:
    sys.exit(f"Keine der Soll-Dateien in {ordner} gefunden.")
ok_alle = True
for kam, k in je.items():
    med = statistics.median(k["d"]) if k["d"] else float("nan")
    ok = bool(k["d"]) and med < 50 and k["ohne"] == 0
    ok_alle &= ok
    print(f"{'✅' if ok else '❌'} {kam}: {k['n']} Fotos, {k['ohne']} ohne GPS, "
          f"Median {med:.0f} m, max {max(k['d']) if k['d'] else float('nan'):.0f} m")
sys.exit(0 if ok_alle else 1)
