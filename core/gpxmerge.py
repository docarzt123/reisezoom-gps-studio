"""Mehrere Tracks zu EINEM durchgehenden Track verschmelzen (v0.9.456).

Nutzer-Wunsch aus dem Beta-Test: „Beschneiden klappt schon perfekt, jetzt
zwei GPX aneinanderhängen." Typischer Fall: die Uhr hat mittendrin gestoppt,
oder eine Mehrtagestour liegt als eine Datei pro Tag vor.

Das Modul arbeitet auf den **Editor-Punkten** des GPX-Inspektors
(`[{lat, lon, ele, time, oi, si}]`, siehe `core/gpxedit.load_points`) und nicht
auf `TrackPoint`, damit das Ergebnis direkt zurück in den Editor kann — inklusive
Undo, Heilen und Speichern.

Zwei Dinge, die hier bewusst NICHT passieren:

* **Die Lücke wird nicht automatisch überbrückt.** Zwischen dem Ende von A und
  dem Start von B liegt fast immer ein Sprung. Ihn stillschweigend mit einer
  geraden Linie zu füllen wäre eine erfundene Strecke. Der Inspektor hat mit
  „Heilen → Lücken füllen" bereits ein Werkzeug dafür, das der Nutzer bewusst
  auslöst und das entlang echter Wege routen kann.
* **Sensorwerte werden nicht vermischt.** Jeder Punkt behält über `si` die
  Nummer seiner Quelldatei, damit `gpxedit._reindex_extra` die Herzfrequenz aus
  A nicht in B hineininterpoliert.
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import List, Optional

# Reihenfolge-Modi
MODE_APPEND = "append"    # B hinten anhängen
MODE_PREPEND = "prepend"  # B vorne einfügen
MODE_TIME = "time"        # nach Startzeit sortieren (braucht Zeitstempel in beiden)


def _parse_iso(s: Optional[str]) -> Optional[datetime]:
    """ISO-String → aware datetime (UTC). None bei fehlend/unparsbar."""
    if not s:
        return None
    try:
        txt = str(s).strip().replace("Z", "+00:00")
        dt = datetime.fromisoformat(txt)
    except (TypeError, ValueError):
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _fmt_iso(dt: datetime) -> str:
    """datetime → ISO-UTC mit `Z`, so wie parse_gpx die Zeiten liefert."""
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _first_time(points: List[dict]) -> Optional[datetime]:
    for p in points:
        t = _parse_iso(p.get("time"))
        if t:
            return t
    return None


def _last_time(points: List[dict]) -> Optional[datetime]:
    for p in reversed(points):
        t = _parse_iso(p.get("time"))
        if t:
            return t
    return None


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _shift_times(points: List[dict], delta: timedelta) -> List[dict]:
    """Alle Zeitstempel um `delta` verschieben. Punkte ohne Zeit bleiben ohne."""
    out = []
    for p in points:
        q = dict(p)
        t = _parse_iso(p.get("time"))
        q["time"] = _fmt_iso(t + delta) if t else None
        out.append(q)
    return out


def merge(
    a_points: List[dict],
    b_points: List[dict],
    *,
    mode: str = MODE_APPEND,
    pause_s: float = 0.0,
    b_source_index: int = 1,
) -> dict:
    """Track B an Track A hängen.

    `a_points` sind die Punkte, die gerade im Editor liegen (können schon aus
    mehreren Quellen stammen — ihr `si` bleibt unangetastet). `b_points` kommen
    frisch aus `gpxedit.load_points` und bekommen hier `si = b_source_index`
    gesetzt; ihr `oi` (Index in der eigenen Quelldatei) bleibt erhalten.

    **Zeitlogik** — der Punkt, an dem ein naiver Merger falsch liegt:

    * Liegt B sauber *nach* A, bleiben alle Zeitstempel unverändert. Die echte
      Pause dazwischen ist eine Tatsache der Aufzeichnung und wird nicht
      wegretuschiert; `pause_s` wird dann ignoriert.
    * Überlappt B mit A (oder liegt davor), würde das Behalten zu einer
      rückwärts laufenden Zeitachse führen — Auswertungen wie Tempo oder Dauer
      wären Unsinn. Dann wird B komplett hinter A verschoben, mit `pause_s`
      Abstand.
    * Hat einer der beiden Tracks gar keine Zeiten, wird nichts verschoben —
      es gibt keine Bezugsgröße.

    Returns {ok, points, meta:{...}} bzw. {ok:False, error}.
    """
    if not a_points:
        return {"ok": False, "error": "Kein Track im Editor"}
    if not b_points or len(b_points) < 2:
        return {"ok": False, "error": "Der angehängte Track hat zu wenige Punkte"}

    mode = (mode or MODE_APPEND).lower()
    if mode not in (MODE_APPEND, MODE_PREPEND, MODE_TIME):
        mode = MODE_APPEND

    b = [dict(p) for p in b_points]
    for p in b:
        p["si"] = int(b_source_index)
        # `load_points` nummeriert mit `i`; das `oi` (Original-Index in der
        # Quelldatei) setzt sonst das Frontend. Ein frisch geladener Track hat
        # es noch nicht — ohne `oi` fände `_reindex_extra` beim Speichern keine
        # Sensorwerte und der angehängte Track käme ohne Puls/Power heraus.
        if not isinstance(p.get("oi"), int):
            oi = p.get("i")
            if isinstance(oi, int):
                p["oi"] = oi

    a_start, a_end = _first_time(a_points), _last_time(a_points)
    b_start, b_end = _first_time(b), _last_time(b)
    both_timed = bool(a_start and a_end and b_start and b_end)

    # „Nach Zeit" ist nur eine Vorentscheidung über die Reihenfolge — danach
    # gilt dieselbe Logik wie bei append/prepend.
    if mode == MODE_TIME:
        if not both_timed:
            return {"ok": False,
                    "error": 'Für „nach Zeit sortieren“ brauchen beide Tracks Zeitstempel'}
        mode = MODE_PREPEND if b_start < a_start else MODE_APPEND

    first, second = (a_points, b) if mode == MODE_APPEND else (b, a_points)
    first_end = _last_time(first)
    second_start = _first_time(second)

    time_mode = "none"       # keine Zeiten → nichts zu tun
    shifted_s = 0.0
    if both_timed:
        if second_start > first_end:
            time_mode = "kept"          # echte Reihenfolge, echte Pause
        else:
            # Überlappung/Rückwärtssprung → zweiten Track dahinter schieben.
            delta = (first_end - second_start) + timedelta(seconds=max(0.0, pause_s))
            second = _shift_times(second, delta)
            shifted_s = delta.total_seconds()
            time_mode = "shifted"

    merged = list(first) + list(second)

    # Lücke an der Nahtstelle beziffern, damit die UI sie benennen kann statt
    # sie zu verschweigen.
    j_prev, j_next = first[-1], second[0]
    gap_m = _haversine_m(float(j_prev["lat"]), float(j_prev["lon"]),
                         float(j_next["lat"]), float(j_next["lon"]))
    t_prev, t_next = _parse_iso(j_prev.get("time")), _parse_iso(j_next.get("time"))
    gap_s = (t_next - t_prev).total_seconds() if (t_prev and t_next) else None

    # Der Editor indiziert seine Punkte fortlaufend; `oi`/`si` bleiben davon
    # unberührt (die zeigen in die jeweilige Quelldatei).
    for i, p in enumerate(merged):
        p["i"] = i

    return {
        "ok": True,
        "points": merged,
        "meta": {
            "mode": mode,
            "time_mode": time_mode,     # kept | shifted | none
            "shifted_s": shifted_s,
            "gap_m": gap_m,
            "gap_s": gap_s,
            "seam_index": len(first),   # erster Punkt des zweiten Tracks
            "count_a": len(a_points),
            "count_b": len(b),
            "count": len(merged),
        },
    }
