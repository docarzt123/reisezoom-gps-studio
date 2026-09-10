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
  4. Kaltstart-Ausreißer am Anfang verwerfen (core/trackcheck.kaltstart).
  5. Standdrift (Wirtshaus-Knäuel) auf den Ankerpunkt zusammenziehen, mit Rampe
     zum nächsten Punkt im üblichen Tempo; die Pause bleibt eine Pause.
  6. Sprünge (raus und zurück) auf die direkte Linie legen, Zeit bleibt.
  7. Unmögliches Tempo bei dauerhaftem Versatz: Zeitstempel entzerren (Portierung von
     tempoEntzerren aus dem Inspektor), Strecke bleibt.
  8. Tempo-Ausreißer wie „Bereinigen" (gpxsimplify.clean_outliers, 250 km/h).
  9. Lücken mit Luftlinien-Punkten füllen (Abstand 20 m wie im Inspektor).
 10. Höhen-Müll (Nadeln, Nullen, Unsinn) durch Interpolation ersetzen.
 11. Fehlende Höhen zwischen bekannten interpolieren.
`<bounds>` schreibt der verlustfreie Writer (core/gpxpatch) immer aus den Punkten neu.

10.09.2026 (Track-Check, docs/TRACK-CHECK.md): Erkennung und Schwellen kommen aus
`core/trackcheck` (Stufe 5) — derselbe Kern zählt im Archiv die Befunde. Deshalb
verschwindet ein Befund nach dem passenden Schritt; `tests/test_trackcheck.py` prüft das.

Returns {ok, points, bericht: [{key, n}], stats: {...}}.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import List, Optional

from core import gpxsimplify
from core import trackcheck as _tc


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


SCHRITTE = ("no_coords", "duplicates", "spread_seconds", "backwards", "missing_time",
            "cold_start", "standstill", "spikes", "tempo", "outliers", "gaps", "ele_garbage", "missing_ele")


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

    # 4) Kaltstart — erste Punkte weit weg vom Rest
    sp = _tc._Spur(pts)
    ks = _tc.kaltstart(sp)
    if ks:
        bericht.append({"key": "cold_start", "n": ks["n"]})
        if "cold_start" in erlaubt:
            pts = pts[ks["n"]:]
            sp = _tc._Spur(pts)
        else:
            sp.ausgeschlossen.update(range(ks["n"]))

    # 5) Standdrift zusammenziehen — vor den Sprüngen, das Gezitter im Knäuel ist kein Sprung
    sd = _tc.standdrift(sp)
    if sd:
        bericht.append({"key": "standstill", "n": len(sd)})
        if "standstill" in erlaubt:
            v_med = _tc.median_tempo(sp)
            for run in sd:
                _stand_zusammenziehen(pts, sp, run["a"], run["b"], v_med)
            sp = _tc._Spur(pts)
        else:
            for run in sd:
                sp.ausgeschlossen.update(range(run["a"], run["b"] + 1))

    # 6) Sprünge (raus und zurück) → Positionen auf die Linie zwischen den gesunden Nachbarn
    sg = _tc.sprung_gruppen(sp)
    if sg["spikes"]:
        bericht.append({"key": "spikes", "n": len(sg["spikes"])})
        if "spikes" in erlaubt:
            for g in sg["spikes"]:
                _geraderuecken(pts, g["a"], g["b"])
            sp = _tc._Spur(pts)

    # 7) Tempo entzerren — dauerhafte Versätze: die Strecke wurde gefahren, nur die Zeit lügt
    if sg["tempo"]:
        bericht.append({"key": "tempo", "n": len(sg["tempo"])})
        if "tempo" in erlaubt:
            if _tempo_entzerren(pts, sp, sg["speed_thr"]):
                sp = _tc._Spur(pts)

    # 8) Tempo-Ausreißer (harte Kappe)
    if len(pts) >= 3:
        r = gpxsimplify.clean_outliers(pts, max_speed_kmh)
        if r.get("ok") and r.get("removed"):
            bericht.append({"key": "outliers", "n": int(r["removed"])})
            if "outliers" in erlaubt:
                pts = r["points"]
                sp = _tc._Spur(pts)

    # 9) Lücken füllen (Luftlinie, 20 m)
    lk = _tc.luecken(sp, flags=_tc.sprung_gruppen(sp)["flags"])
    if lk:
        bericht.append({"key": "gaps", "n": len(lk)})
        if "gaps" in erlaubt:
            for g in sorted(lk, key=lambda g: -g["a"]):
                _luecke_fuellen(pts, g["a"], g["b"], g["dist"])
            sp = _tc._Spur(pts)

    # 10) Höhen-Müll → interpolieren
    hm = _tc.hoehen_muell(sp)
    if hm:
        bericht.append({"key": "ele_garbage", "n": len(hm)})
        if "ele_garbage" in erlaubt:
            for k in hm:
                pts[k]["ele"] = None
            _hoehen_interpolieren(pts, set(hm))

    # 11) Höhen
    if True:
        eles = [p.get("ele") for p in pts]
        fehl = sum(1 for e in eles if e is None)
        known = [m for m, e in enumerate(eles) if e is not None]
        if fehl and known:
            bericht.append({"key": "missing_ele", "n": fehl})
        if fehl and known and "missing_ele" in erlaubt:
            _hoehen_interpolieren(pts, None)

    return {"ok": True, "points": pts, "bericht": bericht,
            "stats": {"before": n0, "after": len(pts), "changed": bool(bericht)}}


# ── Hilfen für die Schritte 5–10 ───────────────────────────────────────────

def _geraderuecken(pts: List[dict], a: int, b: int) -> None:
    """Punkte a+1…b−1 auf die Linie A→B (Zeit bleibt → das Tempo richtet sich selbst)."""
    A, B = pts[a], pts[b]
    span = b - a
    for k in range(a + 1, b):
        tt = (k - a) / span
        pts[k]["lat"] = float(A["lat"]) + (float(B["lat"]) - float(A["lat"])) * tt
        pts[k]["lon"] = float(A["lon"]) + (float(B["lon"]) - float(A["lon"])) * tt
        if A.get("ele") is not None and B.get("ele") is not None:
            pts[k]["ele"] = float(A["ele"]) + (float(B["ele"]) - float(A["ele"])) * tt


def _tempo_entzerren(pts: List[dict], sp, thr: float) -> int:
    """Portierung von tempoEntzerren (Inspektor): Segmente über der Schwelle bekommen die
    Dauer, die das übliche Tempo der Umgebung (±15 Segmente) gebraucht hätte; alle
    späteren Zeitstempel rücken nach hinten. Positionen bleiben."""
    n = len(pts)
    if n < 3 or not sp.alle_zeit or not (thr < float("inf")):
        return 0
    orig = [_parse(p.get("time")) for p in pts]
    if any(t is None for t in orig):
        return 0
    L = sp.L
    vs = []
    for i in range(1, n):
        dt = (orig[i] - orig[i - 1]).total_seconds()
        if dt > 0 and L[i - 1] is not None:
            vs.append(L[i - 1] / dt)
    vs.sort()
    med = vs[len(vs) // 2] if vs else 0.0
    if med <= 0:
        return 0
    shift = 0.0
    fixed = 0
    for i in range(1, n):
        d = L[i - 1]
        if d is not None:
            dt = (orig[i] - orig[i - 1]).total_seconds()
            zu_schnell = (dt <= 0 and d > 1) or (dt > 0 and d / dt > thr)
            if zu_schnell:
                fenster = []
                for j in range(max(1, i - 15), min(n, i + 16)):
                    if L[j - 1] is None:
                        continue
                    ddt = (orig[j] - orig[j - 1]).total_seconds()
                    if ddt <= 0:
                        continue
                    vv = L[j - 1] / ddt
                    if vv <= thr:
                        fenster.append(vv)
                fenster.sort()
                ziel = max(0.5, fenster[len(fenster) // 2] if fenster else med)
                shift += d / ziel - max(0.0, dt)
                fixed += 1
        if shift > 0.0005:
            pts[i]["time"] = _iso(orig[i] + timedelta(seconds=shift))
    return fixed


def _luecke_fuellen(pts: List[dict], a: int, b: int, dist: float,
                    spacing: float = _tc.LUECKE_ABSTAND_M) -> int:
    """Luftlinien-Punkte zwischen a und b einfügen (Anzahl wie im Inspektor)."""
    A, B = pts[a], pts[b]
    k = max(1, min(2000, int(round(dist / spacing)) - 1))
    tA, tB = _parse(A.get("time")), _parse(B.get("time"))
    eA, eB = A.get("ele"), B.get("ele")
    neu = []
    for m in range(1, k + 1):
        f = m / (k + 1)
        q = {"lat": float(A["lat"]) + (float(B["lat"]) - float(A["lat"])) * f,
             "lon": float(A["lon"]) + (float(B["lon"]) - float(A["lon"])) * f,
             "ele": (float(eA) + (float(eB) - float(eA)) * f) if (eA is not None and eB is not None) else (float(eA) if eA is not None else None),
             "time": _iso(tA + (tB - tA) * f) if (tA is not None and tB is not None) else None,
             "seg": int(A.get("seg", 0) or 0)}
        neu.append(q)
    pts[a + 1:a + 1] = neu
    return k


def _stand_zusammenziehen(pts: List[dict], sp, a: int, b: int, v_med: float) -> None:
    """Knäuel a…b auf den Ankerpunkt a legen; die letzten Sekunden werden zur Rampe
    Richtung b+1, damit danach kein Sprung im Tempo steht. Zeiten bleiben."""
    n = len(pts)
    la0, lo0 = float(pts[a]["lat"]), float(pts[a]["lon"])
    ziel = b + 1 if b + 1 < n and sp.seg[b + 1] == sp.seg[a] else None
    rampe_s = 0.0
    t_ziel = None
    if ziel is not None and sp.ts[ziel] is not None and sp.ts[a] is not None:
        d = sp.d(a, ziel)
        rampe_s = d / max(0.5, v_med)
        rampe_s = min(rampe_s, max(0.0, (sp.ts[b] - sp.ts[a]) * 0.5))
        t_ziel = sp.ts[ziel]
    for k in range(a, b + 1):
        t = sp.ts[k]
        if t_ziel is not None and rampe_s > 0 and t is not None and t >= t_ziel - rampe_s:
            f = max(0.0, min(1.0, (t - (t_ziel - rampe_s)) / rampe_s))
            pts[k]["lat"] = la0 + (float(pts[ziel]["lat"]) - la0) * f
            pts[k]["lon"] = lo0 + (float(pts[ziel]["lon"]) - lo0) * f
        else:
            pts[k]["lat"], pts[k]["lon"] = la0, lo0


def _hoehen_interpolieren(pts: List[dict], nur: Optional[set]) -> None:
    """Fehlende Höhen (ele None) linear zwischen bekannten füllen, Ränder fortschreiben.
    `nur` = nur diese Indizes befüllen (Höhen-Müll), None = alle."""
    eles = [p.get("ele") for p in pts]
    known = [m for m, e in enumerate(eles) if e is not None]
    if not known:
        return
    def setz(m, v):
        if nur is None or m in nur:
            pts[m]["ele"] = v
    for a, b in zip(known, known[1:]):
        for m in range(a + 1, b):
            setz(m, float(eles[a]) + (float(eles[b]) - float(eles[a])) * (m - a) / (b - a))
    for m in range(0, known[0]):
        setz(m, float(eles[known[0]]))
    for m in range(known[-1] + 1, len(pts)):
        setz(m, float(eles[known[-1]]))
