"""GPX heilen — alles glattziehen, was einer Aufzeichnung nicht entspricht (08.09.2026).

Marc: „ich gehe davon aus, wenn ich im Inspektor auf Heilen klicke, dass so was alles
glattgezogen wird — und im Web ein „GPX heilen", das alles richtet, was dem Standard
nicht entspricht." Auslöser war ein Forumsfall: der GPX-Export von Insta360 Studio
(X4) ließ sich nicht an ein X6-Video importieren, eine Navi-Datei schon. Marcs eigene
Insta360-Dateien zeigten warum: zehn Punkte je Sekunde mit IDENTISCHEM Sekunden-
Zeitstempel (Nullabstände, Tempo unendlich) und `<bounds>` mit vorzeichenlosen
Längengraden. Beides ist nicht insta360-spezifisch — grobe Uhren, zusammengeklebte
Tracks und schlampige Exporte gibt es überall. Deshalb ein allgemeines Heilen.

Punkte sind Dicts wie aus `gpxedit.load_points` (lat, lon, ele, time, i, seg).

Schritte (jeder meldet, was er geändert hat):
  1. Punkte ohne Koordinaten oder auf (0, 0) raus.
  2. Exakte Doppelpunkte (gleiche Koordinaten UND gleiche Zeit) raus.
  3. Zeiten: mehrfach belegte Sekunden gleichmäßig über die Sekunde verteilen;
     Rückwärtssprünge auf die Zeitachse zurückholen; fehlende Zeiten zwischen
     bekannten interpolieren (davor/danach: fortschreiben).
  4. Tempo-Ausreißer wie „Bereinigen" (gpxsimplify.clean_outliers).
  5. Fehlende Höhen zwischen bekannten interpolieren.
`<bounds>` schreibt der verlustfreie Writer (core/gpxpatch) immer aus den Punkten neu.

Returns {ok, points, bericht: [{key, n}], stats: {...}}.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import List, Optional

from core import gpxsimplify


def _parse(t) -> Optional[datetime]:
    if not t:
        return None
    try:
        s = str(t).strip()
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        d = datetime.fromisoformat(s)
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return None


def _iso(d: datetime) -> str:
    d = d.astimezone(timezone.utc)
    if d.microsecond:
        return d.strftime("%Y-%m-%dT%H:%M:%S.") + f"{d.microsecond // 1000:03d}Z"
    return d.strftime("%Y-%m-%dT%H:%M:%SZ")


def _gueltig(p: dict) -> bool:
    try:
        la, lo = float(p.get("lat")), float(p.get("lon"))
    except (TypeError, ValueError):
        return False
    if not (-90.0 <= la <= 90.0 and -180.0 <= lo <= 180.0):
        return False
    return not (abs(la) < 1e-9 and abs(lo) < 1e-9)


SCHRITTE = ("no_coords", "duplicates", "spread_seconds", "backwards", "missing_time", "outliers", "missing_ele")


def analysieren(points: List[dict], *, max_speed_kmh: float = 250.0) -> dict:
    """Nur prüfen (Marc: „ein Analysieren-Knopf schlägt vor, was man glattziehen könnte, und
    man hakt an, was gemacht wird"). Liefert den Bericht wie `heilen`, ändert nichts."""
    r = heilen(points, max_speed_kmh=max_speed_kmh)
    return {"ok": True, "bericht": r["bericht"], "stats": r["stats"]}


def heilen(points: List[dict], *, max_speed_kmh: float = 250.0,
           ausreisser: bool = True, hoehen: bool = True,
           schritte: Optional[List[str]] = None) -> dict:
    """`schritte` = Auswahl der Berichts-Schlüssel (SCHRITTE), die angewendet werden; None = alle."""
    erlaubt = set(SCHRITTE) if schritte is None else {str(x) for x in schritte}
    if not ausreisser:
        erlaubt.discard("outliers")
    if not hoehen:
        erlaubt.discard("missing_ele")
    src = list(points or [])
    bericht: List[dict] = []
    n0 = len(src)

    # 1) Koordinaten
    pts = [dict(p) for p in src if _gueltig(p)] if "no_coords" in erlaubt else [dict(p) for p in src]
    if len(pts) != n0:
        bericht.append({"key": "no_coords", "n": n0 - len(pts)})

    # 2) exakte Doppelpunkte
    out, seen = [], set()
    for p in pts:
        k = (round(float(p["lat"]), 7), round(float(p["lon"]), 7), p.get("time") or "")
        if k in seen:
            continue
        seen.add(k)
        out.append(p)
    if len(out) != len(pts):
        bericht.append({"key": "duplicates", "n": len(pts) - len(out)})
        if "duplicates" in erlaubt:
            pts = out

    # 3) Zeiten
    times = [_parse(p.get("time")) for p in pts]
    hat = [t is not None for t in times]
    if any(hat):
        # 3a) mehrfach belegte Zeitstempel (identisch, in ganzen Sekunden) gleichmäßig verteilen
        spread_groups = 0
        i = 0
        while i < len(pts):
            if times[i] is None:
                i += 1
                continue
            j = i + 1
            while j < len(pts) and times[j] is not None and times[j] == times[i]:
                j += 1
            k = j - i
            if k > 1 and times[i].microsecond == 0:
                # nächste bekannte Zeit als Obergrenze; sonst eine Sekunde
                nxt = next((times[m] for m in range(j, len(pts)) if times[m] is not None), None)
                span = (nxt - times[i]).total_seconds() if nxt is not None and nxt > times[i] else 1.0
                span = min(span, 1.0) if nxt is None else span
                # Punkte der Sekunde zwischen t und t+span verteilen (der letzte bleibt vor nxt)
                for m in range(i, j):
                    times[m] = times[i] + timedelta(seconds=span * (m - i) / k)
                spread_groups += 1
            i = j
        if spread_groups:
            bericht.append({"key": "spread_seconds", "n": spread_groups})
            if "spread_seconds" not in erlaubt:
                times = [_parse(p.get("time")) for p in pts]   # zurücksetzen
        # 3b) Rückwärtssprünge: streng monoton machen (auf Vorgänger + 1 ms)
        back = 0
        last = None
        for m in range(len(pts)):
            if times[m] is None:
                continue
            if last is not None and times[m] <= last:
                times[m] = last + timedelta(milliseconds=1)
                back += 1
            last = times[m]
        if back:
            bericht.append({"key": "backwards", "n": back})
            if "backwards" not in erlaubt:
                times = [_parse(p.get("time")) for p in pts]
                if "spread_seconds" in erlaubt:   # verteilen erneut, ohne Rücksprung-Glättung
                    pass
        # 3c) fehlende Zeiten interpolieren (nach Streckenanteil) / fortschreiben
        fehlend = sum(1 for t in times if t is None)
        if fehlend:
            idx = [m for m in range(len(pts)) if times[m] is not None]
            for a, b in zip(idx, idx[1:]):
                if b - a < 2:
                    continue
                # Streckenanteile
                d = [0.0]
                for m in range(a + 1, b + 1):
                    d.append(d[-1] + gpxsimplify.haversine_m(pts[m - 1]["lat"], pts[m - 1]["lon"], pts[m]["lat"], pts[m]["lon"]))
                tot = d[-1] or 1.0
                span = (times[b] - times[a]).total_seconds()
                for m in range(a + 1, b):
                    times[m] = times[a] + timedelta(seconds=span * d[m - a] / tot)
            # vor dem ersten / nach dem letzten bekannten: 1 s Schritte
            if idx:
                for m in range(idx[0] - 1, -1, -1):
                    times[m] = times[m + 1] - timedelta(seconds=1)
                for m in range(idx[-1] + 1, len(pts)):
                    times[m] = times[m - 1] + timedelta(seconds=1)
            bericht.append({"key": "missing_time", "n": fehlend})
        if "missing_time" not in erlaubt:
            times = [t if p.get("time") else None for p, t in zip(pts, times)]
        for p, t in zip(pts, times):
            if t is None:
                continue
            alt = _parse(p.get("time"))
            if alt is None or alt != t:      # unveränderte Zeiten behalten ihre Schreibweise
                p["time"] = _iso(t)

    # 4) Tempo-Ausreißer
    if len(pts) >= 3:
        r = gpxsimplify.clean_outliers(pts, max_speed_kmh)
        if r.get("ok") and r.get("removed"):
            bericht.append({"key": "outliers", "n": int(r["removed"])})
            if "outliers" in erlaubt:
                pts = r["points"]

    # 5) Höhen
    if True:
        eles = [p.get("ele") for p in pts]
        fehl = sum(1 for e in eles if e is None)
        known = [m for m, e in enumerate(eles) if e is not None]
        if fehl and known:
            bericht.append({"key": "missing_ele", "n": fehl})
        if fehl and known and "missing_ele" in erlaubt:
            for a, b in zip(known, known[1:]):
                for m in range(a + 1, b):
                    pts[m]["ele"] = float(eles[a]) + (float(eles[b]) - float(eles[a])) * (m - a) / (b - a)
            for m in range(0, known[0]):
                pts[m]["ele"] = float(eles[known[0]])
            for m in range(known[-1] + 1, len(pts)):
                pts[m]["ele"] = float(eles[known[-1]])

    return {"ok": True, "points": pts, "bericht": bericht,
            "stats": {"before": n0, "after": len(pts), "changed": bool(bericht)}}
