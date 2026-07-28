"""Track-Operationen: umkehren · teilen · Startpunkt drehen · Zeiten setzen · Runden.

App-first (Marc-Regel): die Logik lebt hier in `core/`, damit Desktop-App **und**
`reisezoom.com/gps` (via `api/tools.py`) exakt dasselbe rechnen.

Alle Funktionen arbeiten auf den Punkt-Dicts aus `gpxedit.load_points()`
({i, lat, lon, ele, time, …}) und geben Punkte **derselben Struktur** zurück.
Zusatzfelder (Sensorik, `si`/`oi`) werden mitgeschleift und nie umgeschrieben —
einzige Ausnahme ist `retime_points`, das per Auftrag genau `time` neu setzt.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import List, Optional

from .gpxsimplify import haversine_m

__all__ = [
    "reverse_points", "split_points", "rotate_start",
    "retime_points", "km_splits", "track_length_m",
]


# ── Hilfen ───────────────────────────────────────────────────────────────────

def track_length_m(points: List[dict]) -> float:
    """Streckenlänge in Metern (Summe der Punkt-Abstände)."""
    total = 0.0
    for a, b in zip(points, points[1:]):
        total += haversine_m(a["lat"], a["lon"], b["lat"], b["lon"])
    return total


def _parse(t: Optional[str]) -> Optional[datetime]:
    """ISO-Zeit robust lesen (mit/ohne Z, mit/ohne Sekundenbruchteile)."""
    if not t:
        return None
    s = str(t).strip().replace("Z", "+00:00")
    try:
        d = datetime.fromisoformat(s)
    except ValueError:
        for f in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"):
            try:
                d = datetime.strptime(str(t)[:19], f)
                break
            except ValueError:
                continue
        else:
            return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def _iso(d: datetime) -> str:
    """Immer UTC mit Z — so wie GPX-Schreiber es erwarten."""
    return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _renum(points: List[dict]) -> List[dict]:
    """Fortlaufende `i` vergeben, Rest der Punkt-Daten unverändert lassen."""
    out = []
    for n, p in enumerate(points):
        q = dict(p)
        q["i"] = n
        out.append(q)
    return out


# ── Umkehren ─────────────────────────────────────────────────────────────────

def reverse_points(points: List[dict]) -> dict:
    """Track rückwärts laufen lassen.

    Die Zeitstempel werden **gespiegelt**, nicht einfach mitgedreht: Der neue
    erste Punkt startet zur ursprünglichen Startzeit, und die Abstände zwischen
    den Punkten bleiben in umgekehrter Reihenfolge erhalten. Sonst liefe die Zeit
    rückwärts und jedes Auswertungsprogramm würde die Datei ablehnen.
    """
    if len(points) < 2:
        return {"ok": False, "error": "zu wenige Punkte", "points": points}

    rev = list(reversed(points))
    times = [_parse(p.get("time")) for p in points]
    if all(t is not None for t in times) and times[0] is not None:
        # Abstände von hinten nach vorn wieder aufaddieren
        gaps = [(times[n + 1] - times[n]).total_seconds() for n in range(len(times) - 1)]
        cur = times[0]
        out = []
        for n, p in enumerate(rev):
            q = dict(p)
            q["time"] = _iso(cur)
            out.append(q)
            if n < len(gaps):
                cur = cur + timedelta(seconds=gaps[len(gaps) - 1 - n])
        rev = out

    return {"ok": True, "points": _renum(rev), "count": len(rev),
            "times_mirrored": all(t is not None for t in times)}


# ── Teilen ───────────────────────────────────────────────────────────────────

def split_points(points: List[dict], at_index: Optional[int] = None,
                 at_km: Optional[float] = None) -> dict:
    """Track an einer Stelle in zwei Teile schneiden.

    Die Stelle kommt entweder als Punkt-Index (`at_index`) oder als Kilometer ab
    Start (`at_km`). Der Schnittpunkt gehört zu **beiden** Teilen — so bleiben die
    Hälften lückenlos aneinander und ergeben zusammengesetzt wieder das Original.
    """
    n = len(points)
    if n < 4:
        return {"ok": False, "error": "zu wenige Punkte zum Teilen"}

    if at_index is None:
        if at_km is None:
            at_index = n // 2
        else:
            target = float(at_km) * 1000.0
            run = 0.0
            at_index = n // 2
            for k in range(1, n):
                run += haversine_m(points[k - 1]["lat"], points[k - 1]["lon"],
                                   points[k]["lat"], points[k]["lon"])
                if run >= target:
                    at_index = k
                    break

    at_index = max(1, min(n - 2, int(at_index)))
    a = _renum(points[:at_index + 1])
    b = _renum(points[at_index:])
    return {
        "ok": True, "at_index": at_index,
        "parts": [a, b],
        "counts": [len(a), len(b)],
        "lengths_m": [round(track_length_m(a), 1), round(track_length_m(b), 1)],
    }


# ── Startpunkt drehen (Rundtouren) ───────────────────────────────────────────

def rotate_start(points: List[dict], at_index: int,
                 close_loop: bool = True) -> dict:
    """Bei einer Rundtour woanders anfangen lassen.

    Der Track wird ab `at_index` neu aufgereiht und vorne wieder angehängt. Das
    ergibt nur bei geschlossenen Runden Sinn — liegen Start und Ziel weit
    auseinander, wird das im Ergebnis mit `gap_m` offen ausgewiesen, statt die
    Naht stillschweigend zu verstecken.
    """
    n = len(points)
    if n < 4:
        return {"ok": False, "error": "zu wenige Punkte"}
    at_index = max(0, min(n - 1, int(at_index)))
    if at_index == 0:
        return {"ok": True, "points": _renum(points), "count": n, "gap_m": 0.0,
                "unchanged": True}

    gap_m = haversine_m(points[0]["lat"], points[0]["lon"],
                        points[-1]["lat"], points[-1]["lon"])
    rot = points[at_index:] + points[:at_index]
    if close_loop:
        # sauber zumachen: der neue Startpunkt beendet die Runde auch wieder
        rot = rot + [dict(points[at_index])]

    # Zeiten neu vergeben, sonst springt die Uhr an der Naht zurück.
    times = [_parse(p.get("time")) for p in points]
    if all(t is not None for t in times):
        gaps = [(times[k + 1] - times[k]).total_seconds() for k in range(len(times) - 1)]
        gaps_rot = gaps[at_index:] + [max(1.0, sum(gaps) / max(1, len(gaps)))] + gaps[:at_index]
        cur = times[0]
        out = []
        for k, p in enumerate(rot):
            q = dict(p)
            q["time"] = _iso(cur)
            out.append(q)
            if k < len(gaps_rot):
                cur = cur + timedelta(seconds=max(0.0, gaps_rot[k]))
        rot = out

    return {"ok": True, "points": _renum(rot), "count": len(rot),
            "gap_m": round(gap_m, 1), "is_loop": gap_m < 250.0}


# ── Zeitstempel ──────────────────────────────────────────────────────────────

def retime_points(points: List[dict], mode: str = "shift",
                  shift_s: float = 0.0,
                  start_iso: Optional[str] = None,
                  duration_s: Optional[float] = None,
                  speed_kmh: Optional[float] = None) -> dict:
    """Zeitstempel verschieben, neu setzen oder überhaupt erst erzeugen.

    Modi:
      * `shift`     — alle Zeiten um `shift_s` Sekunden verschieben (Kamera-Sync,
                      Zeitzone, vergessene Sommerzeit).
      * `start`     — Track behält sein Tempo, beginnt aber zu `start_iso`.
      * `duration`  — Track auf `duration_s` Gesamtdauer stauchen/strecken.
      * `speed`     — Zeiten aus einer Wunschgeschwindigkeit `speed_kmh` neu
                      rechnen (verteilt nach echter Streckenlänge, nicht nach
                      Punktanzahl — sonst wären dichte Passagen künstlich langsam).

    `start` und `duration` brauchen vorhandene Zeiten; `speed` erzeugt sie auch
    für Tracks ganz ohne Zeitstempel (typisch bei geplanten oder gezeichneten
    Strecken, die eine Uhr brauchen, um in Auswertungen zu laufen).
    """
    n = len(points)
    if n < 2:
        return {"ok": False, "error": "zu wenige Punkte"}

    times = [_parse(p.get("time")) for p in points]
    has_all = all(t is not None for t in times)
    mode = str(mode or "shift").lower()

    if mode in ("shift", "start", "duration") and not has_all:
        return {"ok": False, "error": "no_times",
                "hint": "Dieser Track hat keine Zeiten — mit Modus 'speed' welche erzeugen."}

    out: List[dict] = []

    if mode == "shift":
        d = timedelta(seconds=float(shift_s or 0))
        for p, t in zip(points, times):
            q = dict(p); q["time"] = _iso(t + d); out.append(q)

    elif mode == "start":
        base = _parse(start_iso)
        if base is None:
            return {"ok": False, "error": "start_iso fehlt oder unlesbar"}
        d = base - times[0]
        for p, t in zip(points, times):
            q = dict(p); q["time"] = _iso(t + d); out.append(q)

    elif mode == "duration":
        want = float(duration_s or 0)
        have = (times[-1] - times[0]).total_seconds()
        if want <= 0:
            return {"ok": False, "error": "duration_s muss > 0 sein"}
        if have <= 0:
            return {"ok": False, "error": "Track hat keine messbare Dauer"}
        k = want / have
        for p, t in zip(points, times):
            q = dict(p)
            q["time"] = _iso(times[0] + timedelta(seconds=(t - times[0]).total_seconds() * k))
            out.append(q)

    elif mode == "speed":
        v = float(speed_kmh or 0)
        if v <= 0:
            return {"ok": False, "error": "speed_kmh muss > 0 sein"}
        base = _parse(start_iso) or (times[0] if has_all else datetime.now(timezone.utc)
                                     .replace(microsecond=0))
        mps = v / 3.6
        cur = base
        prev = None
        for p in points:
            if prev is not None:
                d = haversine_m(prev["lat"], prev["lon"], p["lat"], p["lon"])
                cur = cur + timedelta(seconds=d / mps)
            q = dict(p); q["time"] = _iso(cur); out.append(q)
            prev = p

    else:
        return {"ok": False, "error": f"unbekannter Modus: {mode}"}

    t0, t1 = _parse(out[0]["time"]), _parse(out[-1]["time"])
    dur = (t1 - t0).total_seconds() if (t0 and t1) else 0.0
    dist = track_length_m(points)
    return {
        "ok": True, "points": _renum(out), "count": len(out),
        "start": out[0]["time"], "end": out[-1]["time"],
        "duration_s": round(dur, 1),
        "avg_kmh": round((dist / dur) * 3.6, 2) if dur > 0 else None,
        "created_times": not has_all,
    }


# ── Runden / Kilometer-Splits ────────────────────────────────────────────────

def km_splits(points: List[dict], every_km: float = 1.0) -> dict:
    """Zwischenzeiten je Kilometer — die klassische Runden-Tabelle.

    Liefert pro Abschnitt Distanz, Dauer, Tempo und Höhenmeter. Ohne Zeitstempel
    kommen immerhin die Höhen-Werte, damit die Tabelle nicht leer bleibt.
    """
    if len(points) < 2:
        return {"ok": False, "error": "zu wenige Punkte"}
    step = max(0.1, float(every_km or 1.0)) * 1000.0

    rows = []
    run = 0.0          # Strecke im laufenden Abschnitt
    up = dn = 0.0
    seg_start = points[0]
    last_ele = points[0].get("ele")

    def close(seg_end):
        t0, t1 = _parse(seg_start.get("time")), _parse(seg_end.get("time"))
        dur = (t1 - t0).total_seconds() if (t0 and t1) else None
        rows.append({
            "km": round((sum(r["dist_m"] for r in rows) + run) / 1000.0, 2),
            "dist_m": round(run, 1),
            "duration_s": (round(dur, 1) if dur is not None else None),
            "kmh": (round((run / dur) * 3.6, 2) if dur and dur > 0 else None),
            "up_m": round(up, 1), "down_m": round(dn, 1),
        })

    for a, b in zip(points, points[1:]):
        run += haversine_m(a["lat"], a["lon"], b["lat"], b["lon"])
        e = b.get("ele")
        if e is not None and last_ele is not None:
            d = e - last_ele
            if abs(d) >= 3.0:               # 3-m-Schwelle wie überall im Projekt
                if d > 0:
                    up += d
                else:
                    dn += -d
                last_ele = e
        elif e is not None and last_ele is None:
            last_ele = e
        if run >= step:
            close(b)
            run = 0.0; up = dn = 0.0
            seg_start = b

    if run > 1.0:                            # Rest-Stück ausweisen
        close(points[-1])

    return {"ok": True, "splits": rows, "every_km": step / 1000.0,
            "total_km": round(track_length_m(points) / 1000.0, 2)}
