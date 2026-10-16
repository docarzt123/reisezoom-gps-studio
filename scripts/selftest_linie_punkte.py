#!/usr/bin/env python3
"""Punktzahl der Vorschau-Linie — reiner Python-Test, ohne Browser (synthetische Tracks).

Die Linie der Animator-Vorschau bestand bisher aus fest 800 Punkten. Bei einer 175-km-Tour sind
das rund 219 m zwischen zwei Linienpunkten: Serpentinen und Kehren werden abgeschnitten.
`core.gpx.linien_punktzahl()` wählt die Punktzahl stattdessen nach dem Punktabstand.

Geprüft wird die größte Abweichung eines Rohpunkts von der ausgedünnten Linie.

Aufruf:  .venv/bin/python scripts/selftest_linie_punkte.py
         .venv/bin/python scripts/selftest_linie_punkte.py --gpx-schreiben tour.gpx
         (schreibt die synthetische 500-km-Tour als GPX, z. B. für eine Handprüfung)
"""
from __future__ import annotations

import math
import sys
from pathlib import Path
from typing import List

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from core.gpx import (  # noqa: E402
    LINIE_MAX_PUNKTE,
    TrackPoint,
    downsample_ecken,
    linien_punktzahl,
)

fehler = 0

KEHRE_RADIUS_M = 40.0      # Radius der Serpentinen
KEHRE_ABSTAND_M = 2000.0   # alle 2 km eine volle Kehre
LAT0, LON0 = 48.0, 9.0


def sagen(ok: bool, text: str, zusatz: str = "") -> None:
    global fehler
    print(f"  [{'OK  ' if ok else 'FAIL'}] {text}" + (f"  {zusatz}" if zusatz else ""))
    if not ok:
        fehler += 1


def _position_m(s: float) -> tuple[float, float]:
    """Ort (x nach Osten, y nach Norden) in Metern nach `s` Metern Weg: Gerade mit einer Kehre je 2 km."""
    umfang = 2 * math.pi * KEHRE_RADIUS_M
    gerade = KEHRE_ABSTAND_M - umfang
    block, rest = divmod(s, KEHRE_ABSTAND_M)
    x0 = block * gerade
    if rest <= gerade:
        return x0 + rest, 0.0
    w = (rest - gerade) / KEHRE_RADIUS_M
    return (x0 + gerade + KEHRE_RADIUS_M * math.sin(w),
            KEHRE_RADIUS_M - KEHRE_RADIUS_M * math.cos(w))


def tour(laenge_m: float, n: int) -> List[TrackPoint]:
    """`n` gleich weit entlang des Wegs verteilte Punkte einer `laenge_m` langen Tour."""
    m_lat = 6371000.0 * math.pi / 180.0
    m_lon = m_lat * math.cos(math.radians(LAT0))
    pts = []
    for i in range(n):
        x, y = _position_m(laenge_m * i / (n - 1))
        pts.append(TrackPoint(lat=LAT0 + y / m_lat, lon=LON0 + x / m_lon, ele=None, time=None))
    return pts


def tour_1hz(laenge_m: float, kmh: float) -> List[TrackPoint]:
    """Tour mit einem Punkt je Sekunde bei gleichbleibender Geschwindigkeit."""
    n = int(laenge_m / (kmh / 3.6)) + 1
    return tour(laenge_m, n)


def max_abweichung_m(roh: List[TrackPoint], linie: List[TrackPoint]) -> float:
    """Größter Abstand eines Rohpunkts zu dem Linienstück, das seinen Abschnitt überspannt.
    `linie` muss aus Punkten von `roh` bestehen (wie bei `downsample_ecken`)."""
    pos = {id(p): i for i, p in enumerate(roh)}
    idx = [pos[id(p)] for p in linie]
    m_lat = 6371000.0 * math.pi / 180.0
    m_lon = m_lat * math.cos(math.radians(roh[len(roh) // 2].lat))
    xy = [(p.lon * m_lon, p.lat * m_lat) for p in roh]
    worst = 0.0
    for a, b in zip(idx, idx[1:]):
        (ax, ay), (bx, by) = xy[a], xy[b]
        dx, dy = bx - ax, by - ay
        ll = dx * dx + dy * dy
        for j in range(a + 1, b):
            px, py = xy[j]
            t = 0.0 if ll == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / ll))
            worst = max(worst, math.hypot(px - (ax + t * dx), py - (ay + t * dy)))
    return worst


def test_kurze_tour() -> None:
    print("kurze Tour (500 Punkte)")
    pts = tour(10_000.0, 500)
    n = linien_punktzahl(pts)
    sagen(n == 500, "alle Punkte bleiben", f"n={n}")


def test_referenzartig() -> None:
    print("referenzartige Tour (175 km, 6300 Punkte)")
    pts = tour(175_000.0, 6300)
    n = linien_punktzahl(pts)
    sagen(n == 6300, "alle 6300 Punkte bleiben", f"n={n}")
    abw = max_abweichung_m(pts, downsample_ecken(pts, n))
    sagen(abw == 0.0, "Abweichung 0 m", f"{abw:.2f} m")


def test_lange_tour() -> None:
    print("lange Tour (500 km, 1 Hz, 60 km/h)")
    pts = tour_1hz(500_000.0, 60.0)
    n = linien_punktzahl(pts)
    sagen(len(pts) > LINIE_MAX_PUNKTE, "Rohpunkte über dem Deckel", f"{len(pts)} Punkte")
    sagen(n == LINIE_MAX_PUNKTE, "Deckel greift", f"n={n}")
    abw = max_abweichung_m(pts, downsample_ecken(pts, n))
    sagen(abw < 5.0, "Abweichung unter 5 m", f"{abw:.2f} m")


def test_upstream_grenze() -> None:
    print("alte Grenze (800 Punkte) — der Test muss den Fehler sehen")
    pts = tour(175_000.0, 6300)
    abw = max_abweichung_m(pts, downsample_ecken(pts, 800))
    sagen(abw > 20.0, "Abweichung über 20 m", f"{abw:.2f} m")


def gpx_schreiben(ziel: str) -> None:
    pts = tour_1hz(500_000.0, 60.0)
    zeilen = ['<?xml version="1.0" encoding="UTF-8"?>',
              '<gpx version="1.1" creator="selftest_linie_punkte" xmlns="http://www.topografix.com/GPX/1/1">',
              "<trk><name>Selftest 500 km</name><trkseg>"]
    for i, p in enumerate(pts):
        h, rest = divmod(i, 3600)
        zeilen.append(f'<trkpt lat="{p.lat:.7f}" lon="{p.lon:.7f}"><time>2026-01-01T{h % 24:02d}:{rest // 60:02d}:{rest % 60:02d}Z</time></trkpt>')
    zeilen.append("</trkseg></trk></gpx>")
    Path(ziel).write_text("\n".join(zeilen), encoding="utf-8")
    print(f"{len(pts)} Punkte geschrieben: {ziel}")


def main() -> int:
    if len(sys.argv) == 3 and sys.argv[1] == "--gpx-schreiben":
        gpx_schreiben(sys.argv[2])
        return 0
    test_kurze_tour()
    test_referenzartig()
    test_lange_tour()
    test_upstream_grenze()
    print("RESULT: OK" if fehler == 0 else f"RESULT: FAIL ({fehler})")
    return 0 if fehler == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
