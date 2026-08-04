#!/usr/bin/env python3
"""Misst, wie lange das Archiv für seine Abfragen braucht.

Der Anlass: Ein Nutzer mit 4835 Touren meldete, dass Kacheln, Liste, Karte und
Statistik beim ersten Aufruf lange brauchen. Bevor irgendetwas „optimiert" wird,
muss klar sein, WO die Zeit hingeht — sonst repariert man das Falsche.

Baut eine Testdatenbank in der gemeldeten Größenordnung (Voreinstellung 5000
Touren mit echtem Streckenverlauf) und misst die Wege, die die Oberfläche geht.

Aufruf:
    .venv/bin/python scripts/bench_library.py           # 5000 Touren
    .venv/bin/python scripts/bench_library.py 10000     # größer
"""
from __future__ import annotations

import json
import random
import sys
import tempfile
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from core import library as clib   # noqa: E402

N = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 5000
ARTEN = ["wandern", "rad", "mtb", "rennrad", "laufen", "spaziergang", ""]


def bauen(conn, n: int) -> None:
    """Testdaten direkt in die Tabelle — schneller als n echte Dateien."""
    rnd = random.Random(42)
    for i in range(n):
        lat = 47.0 + rnd.random() * 8.0
        lon = 6.0 + rnd.random() * 9.0
        # Der Streckenverlauf ist der dicke Brocken: ~80 Punkte als JSON,
        # rund 1,6 KB je Tour. Genau der wird bei jeder Abfrage mitgeschleppt.
        geom = json.dumps([[round(lon + k * 0.001, 5), round(lat + k * 0.0007, 5)]
                           for k in range(80)])
        jahr = 2018 + (i % 8)
        conn.execute(
            "INSERT INTO tracks(path, folder, filename, name, started_at, year, "
            "distance_m, duration_s, moving_time_s, ascent_m, descent_m, "
            "avg_speed_kmh, max_speed_kmh, n_points, activity, geom, thumb, "
            "map_thumb, error, error_kind, mtime, size, recorded, hidden, fav, "
            "min_lat, max_lat, min_lon, max_lon, center_lat, center_lon, tags) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'','','','',0,0,1,0,?,?,?,?,?,?,?,?)",
            (f"/daten/tour{i:05d}.gpx", "/daten", f"tour{i:05d}.gpx",
             f"Tour {i} bei Ort{i % 400}", f"{jahr}-0{1 + i % 9}-1{i % 9}T08:00:00",
             jahr, 5000 + (i % 60) * 1000, 3600 + (i % 40) * 300,
             3400 + (i % 40) * 280, 100 + (i % 30) * 40, 100 + (i % 30) * 38,
             12.0 + (i % 20), 30.0 + (i % 15), 800 + i % 3000,
             ARTEN[i % len(ARTEN)], geom,
             1 if i % 7 == 0 else 0,
             lat - 0.05, lat + 0.05, lon - 0.05, lon + 0.05, lat, lon,
             "Berge,Sommer" if i % 5 == 0 else ""))
    conn.commit()


def messen(name: str, fn, runden: int = 3) -> float:
    zeiten = []
    for _ in range(runden):
        t0 = time.perf_counter()
        fn()
        zeiten.append(time.perf_counter() - t0)
    best = min(zeiten)
    marke = "  ⚠️" if best > 0.3 else ""
    print(f"  {name:<44} {best * 1000:7.1f} ms{marke}")
    return best


def main() -> int:
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        conn = clib.open_db(root / "bench.db")
        print(f"\nBaue {N} Touren …")
        t0 = time.perf_counter()
        bauen(conn, N)
        print(f"  fertig in {time.perf_counter() - t0:.1f} s"
              f"  ({(root / 'bench.db').stat().st_size / 1e6:.1f} MB)\n")

        print("Die Wege, die die Oberfläche geht:")
        gesamt = 0.0
        gesamt += messen("Kacheln (200 Stück, mit Bildern)",
                         lambda: clib.query(conn, limit=200))
        gesamt += messen("Liste, zweite Seite (offset 200)",
                         lambda: clib.query(conn, limit=200, offset=200))
        gesamt += messen("Karte (ALLE Touren mit Streckenverlauf)",
                         lambda: clib.query(conn, limit=0, with_geom=True))
        gesamt += messen("Statistik", lambda: clib.stats(conn))
        gesamt += messen("Suche nach Text", lambda: clib.query(conn, search="ort12", limit=200))
        gesamt += messen("Suche + Statistik (ein Tastendruck)",
                         lambda: (clib.query(conn, search="ort12", limit=200),
                                  clib.stats(conn, search="ort12")))
        gesamt += messen("Filter nach Jahr", lambda: clib.query(conn, year=2024, limit=200))
        gesamt += messen("Filter nach Fortbewegung",
                         lambda: clib.query(conn, activity="rad", limit=200))
        gesamt += messen("Kartenbilder-Warteschlange (5-s-Takt)",
                         lambda: clib.map_thumbs_pending_count(conn))
        gesamt += messen("Ortslauf-Warteschlange (5-s-Takt)",
                         lambda: clib.orte_fehlen_count(conn))

        print(f"\n  {'Summe':<44} {gesamt * 1000:7.1f} ms")
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
