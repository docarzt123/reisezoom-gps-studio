"""Mehrere Touren zu EINEM Track zusammenführen (23.08.2026, Marc).

Statt eines zweiten Renderpfads für „mehrere Touren" (der nie fertig wurde)
entsteht hier eine ganz normale GPX-Datei: **eine Etappe je Tour**, dazwischen
optional eine Übergangs-Etappe. Danach kann alles, was der Animator kann —
Keyframes, Zeitleiste, Schilder, Trim, Fotos —, ohne Sonderfall.

Warum das trägt:
  • `core/gpx.py` zählt über Etappengrenzen hinweg **weder Distanz noch Zeit**
    (v0.9.483, Sechs-Etappen-Bericht) → die Gesamtwerte stimmen von allein.
  • Die Linie zwischen zwei Etappen wird unsichtbar gezeichnet
    (`__rzSegMask`) → kein Strich quer über die Karte.

Übergangs-Stile:
  „kino"      – Punkte auf dem Großkreis, Etappe als **unsichtbar** markiert
                (`rz:uebergang` im Etappennamen). Man sieht nur die Kamera
                fliegen; die Linie wächst nicht mit.
  „luftlinie" – dieselben Punkte, aber **sichtbar** — die Verbindung wird
                gezeichnet („so ging's weiter").
  „strasse"   – vorberechnete Route (der Aufrufer liefert die Koordinaten),
                sichtbar. Das ist die Reiseroute zwischen zwei Etappen.
  „schnitt"   – gar keine Punkte: die nächste Tour beginnt sofort.

Die Zeit im Übergang ist erfunden (die Tour hat dort keine Aufzeichnung); sie
bekommt deshalb **keine** Zeitstempel. Für die Animationsdauer zählen die
Punkte, nicht die Uhr — und Strecke/Zeit lassen die Etappe ohnehin weg.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Optional

from . import gpx as _gpx

# Etappenname, an dem die App eine unsichtbare Übergangs-Etappe erkennt.
UEBERGANG_NAME = _gpx.UEBERGANG_NAME
STILE = ("kino", "luftlinie", "strasse", "schnitt")


@dataclass
class Uebergang:
    stil: str = "kino"
    dauer_s: float = 3.0
    coords: Optional[list] = None      # nur bei „strasse": [[lon, lat], …]


@dataclass
class Tour:
    path: str
    name: str = ""
    color: Optional[str] = None


@dataclass
class Ergebnis:
    gpx: str
    name: str
    etappen: list = field(default_factory=list)      # [{"name","punkte","distanz_m","farbe"}]
    uebergaenge: list = field(default_factory=list)  # [{"stil","punkte","sichtbar"}]
    punkte: int = 0


def _grosskreis(a: tuple, b: tuple, n: int) -> list:
    """n Zwischenpunkte auf dem Großkreis von a nach b (beide exklusive).
    Kurze Strecken sind praktisch gerade — die Formel deckt beides ab."""
    lon1, lat1 = math.radians(a[0]), math.radians(a[1])
    lon2, lat2 = math.radians(b[0]), math.radians(b[1])
    d = 2 * math.asin(math.sqrt(
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2))
    out = []
    if n <= 0:
        return out
    for k in range(1, n + 1):
        f = k / (n + 1)
        if d < 1e-9:
            out.append([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f])
            continue
        A = math.sin((1 - f) * d) / math.sin(d)
        B = math.sin(f * d) / math.sin(d)
        x = A * math.cos(lat1) * math.cos(lon1) + B * math.cos(lat2) * math.cos(lon2)
        y = A * math.cos(lat1) * math.sin(lon1) + B * math.cos(lat2) * math.sin(lon2)
        z = A * math.sin(lat1) + B * math.sin(lat2)
        out.append([math.degrees(math.atan2(y, x)),
                    math.degrees(math.atan2(z, math.sqrt(x * x + y * y)))])
    return out


def _xml(s: str) -> str:
    return (str(s).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


def _trkpt(lon: float, lat: float, ele=None, zeit: Optional[str] = None) -> str:
    t = [f'<trkpt lat="{float(lat):.7f}" lon="{float(lon):.7f}">']
    if ele is not None:
        try:
            t.append(f"<ele>{float(ele):.2f}</ele>")
        except (TypeError, ValueError):
            pass
    if zeit:
        try:
            dt = datetime.fromisoformat(str(zeit).replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            t.append("<time>" + dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") + "</time>")
        except (TypeError, ValueError):
            pass
    t.append("</trkpt>")
    return "".join(t)


def _punkte_fuer_dauer(dauer_s: float, punkte_je_sekunde: float) -> int:
    return max(2, int(round(max(0.2, float(dauer_s or 0)) * punkte_je_sekunde)))


def zusammenfuehren(touren: Iterable, uebergaenge: Optional[list] = None, *,
                    name: str = "", punkte_je_sekunde: float = 12.0,
                    max_punkte_je_tour: int = 1200) -> Ergebnis:
    """Touren (Reihenfolge = Erzähl-Reihenfolge) zu einer GPX zusammenführen.

    `uebergaenge[i]` beschreibt den Weg von Tour i nach i+1; fehlt er, gilt
    „kino" mit 3 s. `punkte_je_sekunde` bestimmt, wie fein ein Übergang
    aufgelöst wird — die Animation läuft die Punkte gleichmäßig ab, also ist
    das zugleich seine Dauer im Verhältnis zu den Touren.
    """
    tl = [t if isinstance(t, Tour) else Tour(**t) for t in touren]
    if len(tl) < 2:
        raise ValueError("Zum Zusammenführen braucht es mindestens zwei Touren.")
    ue = list(uebergaenge or [])
    while len(ue) < len(tl) - 1:
        ue.append(Uebergang())
    ue = [u if isinstance(u, Uebergang) else Uebergang(**u) for u in ue]

    teile: list = []
    erg = Ergebnis(gpx="", name=name or " + ".join(t.name or Path(t.path).stem for t in tl))
    letzter_punkt = None
    letzte_hoehe = None

    for i, tour in enumerate(tl):
        pts, stats = _gpx.parse_gpx(tour.path)
        if not pts:
            raise ValueError(f"{tour.name or Path(tour.path).name}: keine Punkte.")
        if len(pts) > max_punkte_je_tour:
            pts = _gpx.downsample(pts, max_punkte_je_tour)

        # Übergang VOR dieser Tour (außer vor der ersten)
        if i > 0:
            u = ue[i - 1]
            if u.stil != "schnitt" and letzter_punkt is not None:
                ziel = (pts[0].lon, pts[0].lat)
                if u.stil == "strasse" and u.coords:
                    zwischen = [[float(c[0]), float(c[1])] for c in u.coords]
                else:
                    zwischen = _grosskreis(letzter_punkt, ziel,
                                           _punkte_fuer_dauer(u.dauer_s, punkte_je_sekunde))
                if zwischen:
                    sichtbar = u.stil in ("luftlinie", "strasse")
                    nm = (f"{UEBERGANG_NAME}:{u.stil}" if not sichtbar
                          else f"{UEBERGANG_NAME}-sichtbar:{u.stil}")
                    # Höhe: konstant die des letzten Tour-Punkts. Ohne <ele> fiele
                    # das Höhenprofil im Übergang auf 0 m (im Render sichtbar);
                    # konstant heißt zugleich: der Übergang erzeugt keinen Anstieg.
                    teile.append(f"<trk><name>{_xml(nm)}</name><trkseg>"
                                 + "".join(_trkpt(c[0], c[1], letzte_hoehe) for c in zwischen)
                                 + "</trkseg></trk>")
                    erg.uebergaenge.append({"stil": u.stil, "punkte": len(zwischen), "sichtbar": sichtbar})
                    erg.punkte += len(zwischen)
            else:
                erg.uebergaenge.append({"stil": "schnitt", "punkte": 0, "sichtbar": False})

        nm = tour.name or stats.name or Path(tour.path).stem
        teile.append(f"<trk><name>{_xml(nm)}</name><trkseg>"
                     + "".join(_trkpt(p.lon, p.lat, p.ele, p.time) for p in pts)
                     + "</trkseg></trk>")
        erg.etappen.append({"name": nm, "punkte": len(pts),
                            "distanz_m": float(stats.distance_m or 0), "farbe": tour.color})
        erg.punkte += len(pts)
        letzter_punkt = (pts[-1].lon, pts[-1].lat)
        letzte_hoehe = next((q.ele for q in reversed(pts) if q.ele is not None), None)

    erg.gpx = ('<?xml version="1.0" encoding="UTF-8"?>\n'
               '<gpx version="1.1" creator="Reisezoom GPS Studio" '
               'xmlns="http://www.topografix.com/GPX/1/1">\n'
               f"<metadata><name>{_xml(erg.name)}</name></metadata>\n"
               + "\n".join(teile) + "\n</gpx>\n")
    return erg
