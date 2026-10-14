"""Hochflug (14.10.2026) — Etappen-Abschnitte mit eigener Flughöhe.

Marc: „einen großen, hohen Flug angeben, obwohl es gar nicht so weit ist … die Kurve nicht nur horizontal, auch vertikal …
die Kamera folgt dem Track, und es wird quasi zu einer Weltkugel“. Ein Abschnitt trägt `hoch = {m, p}`: m = höchster Punkt in
Metern über Grund, p = [[u, h], …] Profil (u = Anteil der Strecke, h = Anteil der Höhe, je 0…1). Die Kurve läuft monoton
kubisch durch die Punkte (nie unter den Boden). Spiegel: ui/js/hoehenprofil.js `profil` — bei Änderung beide pflegen.
"""
from __future__ import annotations

import math
from typing import List, Optional

BOGEN = [[0.0, 0.0], [0.5, 1.0], [1.0, 0.0]]


def sortiert(p) -> List[List[float]]:
    q = [[max(0.0, min(1.0, float(x[0] or 0))), max(0.0, min(1.0, float(x[1] or 0)))] for x in (p if isinstance(p, list) else BOGEN)
         if isinstance(x, (list, tuple)) and len(x) >= 2]
    q.sort(key=lambda x: x[0])
    if not q or q[0][0] > 0:
        q.insert(0, [0.0, 0.0])
    if q[-1][0] < 1:
        q.append([1.0, 0.0])
    return q


def profil(p, u: float) -> float:
    """Höhe 0…1 an der Stelle u (0…1) — Fritsch-Carlson, wie die JS-Fassung."""
    q = sortiert(p)
    n = len(q)
    u = max(0.0, min(1.0, float(u or 0)))
    if n == 1:
        return q[0][1]
    d = []
    for k in range(n - 1):
        dx = q[k + 1][0] - q[k][0]
        d.append((q[k + 1][1] - q[k][1]) / dx if dx > 1e-9 else 0.0)
    m = [0.0] * n
    m[0], m[n - 1] = d[0], d[n - 2]
    for k in range(1, n - 1):
        m[k] = 0.0 if d[k - 1] * d[k] <= 0 else (d[k - 1] + d[k]) / 2
    for k in range(n - 1):
        if d[k] == 0:
            m[k] = m[k + 1] = 0.0
            continue
        a, b = m[k] / d[k], m[k + 1] / d[k]
        s = a * a + b * b
        if s > 9:
            t = 3 / math.sqrt(s)
            m[k], m[k + 1] = t * a * d[k], t * b * d[k]
    k = 0
    while k < n - 2 and u > q[k + 1][0]:
        k += 1
    x0, x1 = q[k][0], q[k + 1][0]
    h = x1 - x0
    if h <= 1e-9:
        return q[k + 1][1]
    t = (u - x0) / h
    t2, t3 = t * t, t * t * t
    v = ((2 * t3 - 3 * t2 + 1) * q[k][1] + (t3 - 2 * t2 + t) * h * m[k] + (-2 * t3 + 3 * t2) * q[k + 1][1]
         + (t3 - t2) * h * m[k + 1])
    return max(0.0, min(1.0, v))


def gueltig(hoch) -> Optional[dict]:
    if not isinstance(hoch, dict):
        return None
    try:
        m = float(hoch.get("m") or 0)
    except (TypeError, ValueError):
        return None
    if not (m > 0):
        return None
    return {"m": min(m, 2_000_000.0), "p": sortiert(hoch.get("p"))}


def hoehen(co: list, teile: list, abstand) -> List[float]:
    """Zusätzliche Höhe über Grund je Punkt von `co` (Meter). `teile` = [{von, bis, hoch}], `abstand(a, b)` = Meter zwischen
    zwei Punkten. Innerhalb eines Abschnitts zählt der Anteil der zurückgelegten Strecke."""
    n = len(co)
    plus = [0.0] * n
    for t in teile or []:
        h = gueltig(t.get("hoch") if isinstance(t, dict) else None)
        if not h:
            continue
        try:
            a, b = max(0, int(t.get("von", 0))), min(n - 1, int(t.get("bis", n - 1)))
        except (TypeError, ValueError):
            continue
        if b <= a:
            continue
        kum = [0.0]
        for i in range(a, b):
            kum.append(kum[-1] + abstand(co[i], co[i + 1]))
        ges = kum[-1] or 1.0
        for k, i in enumerate(range(a, b + 1)):
            plus[i] = max(plus[i], h["m"] * profil(h["p"], kum[k] / ges))
    return plus
