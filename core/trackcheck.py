"""Track-Check — sagt, was an einem Track nicht stimmt, BEVOR man es im Video sieht
(10.09.2026, Spezifikation: docs/TRACK-CHECK.md — das Dokument ist die Wahrheit).

Reine Zählung, kein Heil-Lauf: die Bibliothek prüft damit beim Import jede Datei, das
Archiv auf Knopfdruck den ganzen Bestand (Marc: „nichts läuft ungefragt im Hintergrund").
Die Heilung selbst steckt in `core/gpxheal.heilen`, das dieselben Erkennungen hier
importiert — Befund und Reparatur sehen dasselbe, und nach der Reparatur verschwindet der
Befund. Schwellen = „Heilen (automatisch)" bei Empfindlichkeit 5 (`STUFE_STANDARD`);
die Sprung-, Lücken- und Tempo-Suche sind Portierungen aus dem Inspektor
(`modules/gpxinspect/ui/module.js`: detectSpikes, detectGaps, tempoEntzerren).

Punkte: Dicts wie aus `gpxedit.load_points` (lat, lon, ele, time, seg) ODER
`core.gpx.TrackPoint`. Rückgabe von `pruefen`:

    {"befunde": [{"key", "stufe", "n", "detail": {...}}, …],   # rot vor gelb vor grau
     "hoechste": "rot" | "gelb" | "grau" | "",
     "n_points": int, "ms": float}

Was NIE ein Befund ist (Marc): eine Zeitpause am selben Ort (Wirtshaus), eine Nachtpause
mit vielen Kilometern dazwischen (Mehrtagestour — dort zieht die App bewusst keine Linie)
und der Sprung über eine Etappengrenze.
"""
from __future__ import annotations

import math
import time as _time
from datetime import datetime, timezone
from typing import Dict, List, Optional, Sequence

STUFE_STANDARD = 5

# Schlüssel → Stufe. Reihenfolge = Anzeige-Reihenfolge (rot zuerst).
STUFEN: Dict[str, str] = {
    "spikes": "rot",
    "cold_start": "rot",
    "ele_garbage": "rot",
    "xml_broken": "rot",          # kommt aus core/gpxrepair, nicht aus den Punkten
    "gaps": "gelb",
    "missing_ele": "gelb",
    "tempo": "gelb",
    "backwards": "gelb",
    "duplicates": "gelb",
    "spread_seconds": "gelb",
    "standstill": "gelb",
    "clock_off": "gelb",
    "no_time": "grau",
    "local_time": "grau",
}
REIHENFOLGE = tuple(STUFEN.keys())
_RANG = {"rot": 3, "gelb": 2, "grau": 1, "": 0}

# Feste Größen (siehe Spezifikation §2)
LUECKE_ABSTAND_M = 20.0          # Füll-Abstand beim Lückenfüllen (wie der Inspektor)
NACHTPAUSE_S = 2 * 3600.0        # Pause > 2 h UND …
NACHTPAUSE_M = 2000.0            # … Sprung > 2 km = Mehrtagestour, keine Lücke
# Sichtbares Loch: Der Inspektor füllt beim Heilen alles ab ~42 m (Stufe 5); als BEFUND
# zählt erst, was man im Video sieht. Gemessen an Marcs 413 aufgezeichneten Touren
# (10.09.2026): ab 42 m hätten 186 Touren „Lücken" getragen, ab 100 m sind es 86 —
# und die Reparatur füllt genau diese, der Befund verschwindet also.
LUECKE_MIN_M = 100.0
PAUSE_S = 120.0                  # Pause ≥ 2 min UND …
PAUSE_M = 100.0                  # … höchstens 100 m weiter = Wirtshaus (Handy lag drinnen), keine Lücke
# Aufzeichnungs-Phänomene: bei GEPLANTEN Routen (Komoot-Planung trägt Kunst-Zeiten!) nie ein
# Befund — dort sind weite Punktabstände und krumme Zeiten die Natur der Sache. Gemessen an
# Marcs Archiv (10.09.2026): 303 von 313 geplanten Touren hätten „Lücken" gemeldet.
NUR_AUFZEICHNUNG = ("spikes", "cold_start", "gaps", "tempo", "backwards", "duplicates",
                    "spread_seconds", "standstill", "clock_off")
KALTSTART_MIN_M = 500.0
KALTSTART_FAKTOR = 20.0
KALTSTART_PUNKTE = 30
HOEHE_MIN, HOEHE_MAX = -500.0, 9000.0
HOEHE_SPRUNG_M = 300.0
HOEHE_NULL_NACHBAR_M = 20.0
STAND_RADIUS_M = 30.0
STAND_DAUER_S = 180.0
STAND_WEG_M = 100.0


# ── Hilfen ───────────────────────────────────────────────────────────────────

def _get(p, k, default=None):
    if isinstance(p, dict):
        return p.get(k, default)
    return getattr(p, k, default)


def _ts(t) -> Optional[float]:
    """ISO-Zeit → Sekunden (UTC) oder None."""
    if t is None or t == "":
        return None
    if isinstance(t, datetime):
        d = t if t.tzinfo else t.replace(tzinfo=timezone.utc)
        return d.timestamp()
    try:
        s = str(t).strip()
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        d = datetime.fromisoformat(s)
        if not d.tzinfo:
            d = d.replace(tzinfo=timezone.utc)
        return d.timestamp()
    except (ValueError, TypeError):
        return None


def _median(xs: Sequence[float]) -> float:
    if not xs:
        return 0.0
    s = sorted(xs)
    return s[len(s) // 2]


def _lerp(a: float, b: float, stufe: float) -> float:
    s = max(1.0, min(10.0, float(stufe or STUFE_STANDARD)))
    return a + (b - a) * (s - 1.0) / 9.0


_R = 6371000.0
_P = math.pi / 180.0


def _hav(la1, lo1, la2, lo2) -> float:
    dlat = (la2 - la1) * _P
    dlon = (lo2 - lo1) * _P
    a = math.sin(dlat / 2) ** 2 + math.cos(la1 * _P) * math.cos(la2 * _P) * math.sin(dlon / 2) ** 2
    return 2 * _R * math.asin(min(1.0, math.sqrt(a)))


class _Spur:
    """Normalisierte Sicht auf die Punkte: Reihen statt Dicts, einmal gerechnet."""

    def __init__(self, points):
        self.n = len(points)
        self.lat = [float(_get(p, "lat") or 0.0) for p in points]
        self.lon = [float(_get(p, "lon") or 0.0) for p in points]
        self.ele: List[Optional[float]] = []
        for p in points:
            e = _get(p, "ele")
            try:
                self.ele.append(None if e is None else float(e))
            except (TypeError, ValueError):
                self.ele.append(None)
        self.ts_roh = [_ts(_get(p, "time")) for p in points]
        self.seg = [int(_get(p, "seg", 0) or 0) for p in points]
        # Segmentlängen; None = Etappengrenze (wird nie bewertet)
        self.L: List[Optional[float]] = []
        for i in range(self.n - 1):
            if self.seg[i] != self.seg[i + 1]:
                self.L.append(None)
            else:
                self.L.append(_hav(self.lat[i], self.lon[i], self.lat[i + 1], self.lon[i + 1]))
        self.med_seg = _median([x for x in self.L if x is not None])
        self.hat_zeit = any(t is not None for t in self.ts_roh)
        self.alle_zeit = self.n > 0 and all(t is not None for t in self.ts_roh)
        # Geglättete Zeitachse für Tempo-Rechnungen: gleiche Sekunden verteilt,
        # Rücksprünge auf Vorgänger + 1 ms — sonst hätte ein 10-Hz-Track (X5)
        # lauter „unendliches Tempo" und jeder Punkt wäre ein Sprung.
        self.ts = _zeiten_glaetten(self.ts_roh)
        self.ausgeschlossen: set = set()   # Segment-Indizes, die nicht bewertet werden

    def d(self, i: int, j: int) -> float:
        return _hav(self.lat[i], self.lon[i], self.lat[j], self.lon[j])

    def dt(self, i: int, j: int) -> Optional[float]:
        a, b = self.ts[i], self.ts[j]
        if a is None or b is None:
            return None
        return b - a


def _zeiten_glaetten(ts: List[Optional[float]]) -> List[Optional[float]]:
    out = list(ts)
    n = len(out)
    i = 0
    while i < n:
        if out[i] is None:
            i += 1
            continue
        j = i + 1
        while j < n and out[j] is not None and out[j] == out[i]:
            j += 1
        k = j - i
        if k > 1:
            nxt = next((out[m] for m in range(j, n) if out[m] is not None), None)
            span = (nxt - out[i]) if (nxt is not None and nxt > out[i]) else 1.0
            span = min(span, 1.0) if nxt is None else span
            for m in range(i, j):
                out[m] = out[i] + span * (m - i) / k
        i = j
    last = None
    for m in range(n):
        if out[m] is None:
            continue
        if last is not None and out[m] <= last:
            out[m] = last + 0.001
        last = out[m]
    return out


# ── Erkennungen (liefern Indizes; `pruefen` zählt, `gpxheal` repariert) ──────

def kaltstart(sp: _Spur) -> Optional[dict]:
    """Die ersten Punkte liegen weit weg vom Rest (alter Fix aus einer anderen Stadt):
    Sprung innerhalb der ersten 30 Punkte > max(500 m, 20 × Median-Abstand), der Haufen
    davor ist kompakt, und der Track kommt dort nie wieder vorbei (sonst wäre es eine
    Lücke). → {"n": Anzahl Punkte, "dist": Sprungweite}."""
    n = sp.n
    if n < 5:
        return None
    thr = max(KALTSTART_MIN_M, KALTSTART_FAKTOR * sp.med_seg)
    limit = min(KALTSTART_PUNKTE, n - 2)
    for i in range(limit - 1, -1, -1):
        L = sp.L[i]
        if L is None or L <= thr:
            continue
        span = max(sp.d(0, k) for k in range(0, i + 1))
        if span > thr * 0.2:
            continue
        cla = sum(sp.lat[: i + 1]) / (i + 1)
        clo = sum(sp.lon[: i + 1]) / (i + 1)
        rest = range(i + 1, n)
        step = max(1, len(rest) // 400)
        nah = min(_hav(cla, clo, sp.lat[k], sp.lon[k]) for k in range(i + 1, n, step))
        if nah < thr * 0.5:
            continue
        return {"n": i + 1, "dist": L}
    return None


def median_tempo(sp: _Spur) -> float:
    """Typisches Tempo in m/s (Median aller bewerteten Segmente), 0 ohne Zeiten."""
    vs = []
    for i in range(sp.n - 1):
        L = sp.L[i]
        if L is None or i in sp.ausgeschlossen:
            continue
        dt = sp.dt(i, i + 1)
        if dt is not None and dt > 0:
            vs.append(L / dt)
    return _median(vs)


def sprung_gruppen(sp: _Spur, stufe: float = STUFE_STANDARD) -> dict:
    """Portierung von detectSpikes (Inspektor). Gruppen aufeinanderfolgender Ausreißer-
    Punkte {a, b, von, bis}: a/b sind die gesunden Nachbarn. Zusätzlich wird jede Gruppe
    eingeteilt: `spikes` springt raus UND zurück (Positionen auf die Linie legen),
    `tempo` ist ein dauerhafter Versatz (Track bleibt drüben; nur die Zeit lügt → Zeit
    entzerren, siehe tempoEntzerren im Inspektor)."""
    n = sp.n
    leer = {"spikes": [], "tempo": [], "flags": set(), "speed_thr": math.inf}
    if n < 3:
        return leer
    have_time = sp.alle_zeit
    SPIKE_FACTOR = _lerp(12, 2, stufe)
    FLOOR = _lerp(120, 15, stufe)
    ABS_JUMP = max(FLOOR, sp.med_seg * SPIKE_FACTOR)
    SPEED_CAP = _lerp(120, 25, stufe)
    med_speed = median_tempo(sp) if have_time else 0.0
    REL_SPEED = _lerp(12, 3, stufe)
    SPEED_THR = max(4.2, med_speed * REL_SPEED) if med_speed > 0 else math.inf
    flags = [False] * n
    for i in range(1, n - 1):
        inD, outD = sp.L[i - 1], sp.L[i]
        if inD is None or outD is None or (i - 1) in sp.ausgeschlossen or i in sp.ausgeschlossen:
            continue
        chord = sp.d(i - 1, i + 1)
        detour = inD + outD - chord
        big_jump = inD > ABS_JUMP or outD > ABS_JUMP
        returns = detour > ABS_JUMP * 0.8
        speed_bad = True
        v_in = v_out = 0.0
        if have_time:
            dt_in, dt_out = sp.dt(i - 1, i), sp.dt(i, i + 1)
            v_in = inD / dt_in if dt_in and dt_in > 0 else math.inf
            v_out = outD / dt_out if dt_out and dt_out > 0 else math.inf
            speed_bad = v_in > SPEED_CAP or v_out > SPEED_CAP
        if big_jump and returns and speed_bad:
            flags[i] = True
        elif have_time and (v_in > SPEED_THR or v_out > SPEED_THR):
            flags[i] = True
    spikes, tempo = [], []
    fl = set()
    i = 0
    while i < n:
        if flags[i]:
            j = i
            while j + 1 < n and flags[j + 1]:
                j += 1
            a, b = i - 1, j + 1
            if a >= 0 and b < n:
                g = {"a": a, "b": b, "von": i, "bis": j}
                weg = sum((sp.L[k] or 0.0) for k in range(a, b))
                chord = sp.d(a, b)
                (spikes if chord <= 0.5 * weg else tempo).append(g)
                fl.update(range(i, j + 1))
            i = j + 1
        else:
            i += 1
    return {"spikes": spikes, "tempo": tempo, "flags": fl, "speed_thr": SPEED_THR}


def luecken(sp: _Spur, stufe: float = STUFE_STANDARD, spacing: float = LUECKE_ABSTAND_M,
            flags: Optional[set] = None, min_m: float = LUECKE_MIN_M) -> List[dict]:
    """Portierung von detectGaps: Segment deutlich länger als der typische Punktabstand
    → sichtbares Loch. Nie: Etappengrenze, Nachtpause mit vielen km, Nachbar eines Sprungs."""
    n = sp.n
    # Geplante Routen (ohne Zeit) haben naturgemäß weite Punktabstände — ein
    # GPS-Aussetzer ist ein Aufzeichnungs-Phänomen. Ohne Zeit gibt es keine Lücken,
    # der Inspektor kann sie trotzdem von Hand füllen.
    if n < 2 or not sp.hat_zeit:
        return []
    flags = flags or set()
    spacing = max(2.0, min(500.0, float(spacing or LUECKE_ABSTAND_M)))
    median = sp.med_seg or (min(x for x in sp.L if x is not None) if any(x is not None for x in sp.L) else 0.0)
    dist_th = max(spacing * _lerp(2.5, 1.6, stufe), median * _lerp(3.5, 1.8, stufe), float(min_m or 0.0))
    out = []
    for i in range(n - 1):
        L = sp.L[i]
        if L is None or L <= dist_th or i in sp.ausgeschlossen:
            continue
        if i in flags or (i + 1) in flags:
            continue
        dt = sp.dt(i, i + 1)
        if dt is not None and dt > NACHTPAUSE_S and L > NACHTPAUSE_M:
            continue
        # Wirtshaus: minutenlang Pause, danach ein paar Meter weiter wieder Empfang.
        if dt is not None and dt >= PAUSE_S and L <= PAUSE_M:
            continue
        out.append({"a": i, "b": i + 1, "dist": L})
    return out


def hoehen_muell(sp: _Spur) -> List[int]:
    """Indizes unglaubwürdiger Höhen: außerhalb −500…9000 m, exakte 0 zwischen echten
    Werten, kurze Nadeln (> 300 m rauf UND wieder runter)."""
    e = sp.ele
    n = sp.n
    bad = set()
    for i in range(n):
        v = e[i]
        if v is not None and (v < HOEHE_MIN or v > HOEHE_MAX):
            bad.add(i)
    # Null-Läufe zwischen echten Werten
    i = 0
    while i < n:
        if e[i] is not None and e[i] == 0.0 and i not in bad:
            j = i
            while j + 1 < n and e[j + 1] is not None and e[j + 1] == 0.0:
                j += 1
            links = next((e[k] for k in range(i - 1, -1, -1) if e[k] is not None and k not in bad), None)
            rechts = next((e[k] for k in range(j + 1, n) if e[k] is not None and k not in bad), None)
            if links is not None and rechts is not None and abs(links) > HOEHE_NULL_NACHBAR_M and abs(rechts) > HOEHE_NULL_NACHBAR_M:
                bad.update(range(i, j + 1))
            i = j + 1
        else:
            i += 1
    # Nadeln: Sprung > 300 m und innerhalb von ≤ 10 Punkten Sprung > 300 m zurück
    known = [k for k in range(n) if e[k] is not None and k not in bad]
    kanten = []   # (Index des Punkts NACH der Kante, Richtung)
    for a, b in zip(known, known[1:]):
        if abs(e[b] - e[a]) > HOEHE_SPRUNG_M:
            kanten.append((b, 1 if e[b] > e[a] else -1))
    for (b1, r1), (b2, r2) in zip(kanten, kanten[1:]):
        if r1 != r2 and (b2 - b1) <= 10:
            bad.update(k for k in range(b1, b2) if e[k] is not None)
    return sorted(bad)


def standdrift(sp: _Spur) -> List[dict]:
    """Minutenlang Zickzack bei Ø-Tempo ≈ 0 (Wirtshaus): innerhalb von 30 m um einen
    Ankerpunkt vergehen ≥ 3 min und die Punkte laufen dabei ≥ 100 m Weg. → [{a, b, s}]."""
    n = sp.n
    if n < 3 or not sp.hat_zeit:
        return []
    cum = [0.0]
    for i in range(n - 1):
        cum.append(cum[-1] + (sp.L[i] or 0.0))
    out = []
    i = 0
    j = 0
    while i < n - 1:
        ti = sp.ts[i]
        if ti is None:
            i += 1
            continue
        if j < i:
            j = i
        while j < n - 1 and (sp.ts[j] is None or sp.ts[j] - ti < STAND_DAUER_S) and sp.seg[j + 1] == sp.seg[i]:
            j += 1
        if sp.ts[j] is None or sp.ts[j] - ti < STAND_DAUER_S or sp.seg[j] != sp.seg[i]:
            i += 1
            continue
        if cum[j] - cum[i] < STAND_WEG_M or sp.d(i, j) > STAND_RADIUS_M:
            i += 1
            continue
        # Stichproben dazwischen: bleibt der Haufen wirklich um den Anker?
        proben = range(i, j + 1, max(1, (j - i) // 8))
        if any(sp.d(i, k) > STAND_RADIUS_M for k in proben):
            i += 1
            continue
        # verlängern, solange die Punkte im Radius bleiben
        e = j
        while e + 1 < n and sp.seg[e + 1] == sp.seg[i] and sp.d(i, e + 1) <= STAND_RADIUS_M:
            e += 1
        out.append({"a": i, "b": e, "s": (sp.ts[e] or ti) - ti})
        i = e + 1
        j = i
    return out


def zeit_befunde(sp: _Spur) -> dict:
    """backwards, duplicates, spread_seconds, clock_off, no_time — aus den ROHEN Zeiten."""
    n = sp.n
    r = {"backwards": 0, "duplicates": 0, "spread_seconds": 0, "clock_off": None, "no_time": not sp.hat_zeit}
    if n == 0:
        return r
    # Doppelpunkte: gleiche Position UND gleiche Zeit (wie gpxheal)
    seen = set()
    dup = set()
    for i in range(n):
        k = (round(sp.lat[i], 7), round(sp.lon[i], 7), sp.ts_roh[i])
        if k in seen:
            dup.add(i)
        else:
            seen.add(k)
    r["duplicates"] = len(dup)
    if not sp.hat_zeit:
        return r
    ts = [None if i in dup else sp.ts_roh[i] for i in range(n)]
    # gleiche Sekunde (ganzzahlig), Gruppen ≥ 2
    i = 0
    while i < n:
        if ts[i] is None:
            i += 1
            continue
        j = i + 1
        while j < n and ts[j] is not None and ts[j] == ts[i]:
            j += 1
        if j - i > 1 and float(ts[i]).is_integer():
            r["spread_seconds"] += 1
        i = j
    # rückwärts: streng kleiner, oder gleich mit Sekundenbruchteil
    last = None
    for t in ts:
        if t is None:
            continue
        if last is not None and (t < last or (t == last and not float(t).is_integer())):
            r["backwards"] += 1
        last = t
    first = next((t for t in sp.ts_roh if t is not None), None)
    if first is not None:
        jahr = datetime.fromtimestamp(first, tz=timezone.utc).year
        if jahr < 2000 or first > _time.time() + 2 * 86400:
            r["clock_off"] = jahr
    return r


# ── Zählung ──────────────────────────────────────────────────────────────────

def pruefen(points, *, stufe: float = STUFE_STANDARD, local_time_n: int = 0,
            spacing: float = LUECKE_ABSTAND_M, geplant: bool = False) -> dict:
    """Alle Befunde eines Tracks zählen (keine Änderung an den Punkten).
    `geplant` = Route aus der Planung: nur Höhen- und Zeit-Hinweise (NUR_AUFZEICHNUNG entfällt)."""
    t0 = _time.perf_counter()
    sp = _Spur(list(points or []))
    b: List[dict] = []

    def add(key, n, **detail):
        if n and not (geplant and key in NUR_AUFZEICHNUNG):
            b.append({"key": key, "stufe": STUFEN[key], "n": int(n), "detail": detail})

    ks = kaltstart(sp)
    if ks:
        add("cold_start", ks["n"], dist_m=round(ks["dist"]))
        sp.ausgeschlossen.update(range(0, ks["n"]))
    # Standdrift VOR den Sprüngen: das Gezitter im Knäuel ist kein Sprung, es wird
    # als Ganzes zusammengezogen (gpxheal macht es in derselben Reihenfolge).
    sd = standdrift(sp)
    if sd:
        add("standstill", len(sd), min=round(sum(x["s"] for x in sd) / 60.0))
        for x in sd:
            sp.ausgeschlossen.update(range(x["a"], x["b"] + 1))
    sg = sprung_gruppen(sp, stufe)
    add("spikes", len(sg["spikes"]))
    add("tempo", len(sg["tempo"]))
    lk = luecken(sp, stufe, spacing, sg["flags"])
    if lk:
        add("gaps", len(lk), max_m=round(max(g["dist"] for g in lk)))
    hm = hoehen_muell(sp)
    add("ele_garbage", len(hm))
    fehlt = sum(1 for e in sp.ele if e is None)
    if fehlt and fehlt < sp.n:
        add("missing_ele", fehlt)
    z = zeit_befunde(sp)
    add("backwards", z["backwards"])
    add("duplicates", z["duplicates"])
    add("spread_seconds", z["spread_seconds"])
    if z["clock_off"] is not None:
        add("clock_off", 1, jahr=z["clock_off"])
    if z["no_time"] and sp.n:
        add("no_time", sp.n)
    if local_time_n and not z["no_time"]:
        add("local_time", int(local_time_n))

    b.sort(key=lambda x: REIHENFOLGE.index(x["key"]))
    return {"befunde": b, "hoechste": hoechste(b), "n_points": sp.n, "geplant": bool(geplant),
            "ms": round((_time.perf_counter() - t0) * 1000.0, 1)}


def hoechste(befunde: List[dict]) -> str:
    best = ""
    for x in befunde or []:
        s = str(x.get("stufe") or STUFEN.get(x.get("key"), ""))
        if _RANG.get(s, 0) > _RANG.get(best, 0):
            best = s
    return best


def filtern(befunde: List[dict], ok: Sequence[str]) -> dict:
    """„Ist so in Ordnung": abgewählte Befund-Arten ausblenden. Grau zählt nie
    für die Kachel-Marke (`marke`), bleibt aber im Inspektor sichtbar."""
    oks = {str(k) for k in (ok or [])}
    sichtbar = [x for x in (befunde or []) if x.get("key") not in oks]
    abgew = [x for x in (befunde or []) if x.get("key") in oks]
    marke = hoechste([x for x in sichtbar if x.get("stufe") in ("rot", "gelb")])
    return {"befunde": sichtbar, "abgewaehlt": abgew, "hoechste": hoechste(sichtbar), "marke": marke}


def kurz(befunde: List[dict]) -> str:
    """Kurzform fürs Log: `spikes:3 gaps:1(max 240 m)`."""
    teile = []
    for x in befunde or []:
        d = x.get("detail") or {}
        extra = ""
        if "max_m" in d:
            extra = f"(max {d['max_m']} m)"
        elif "jahr" in d:
            extra = f"({d['jahr']})"
        elif "min" in d:
            extra = f"({d['min']} min)"
        teile.append(f"{x['key']}:{x['n']}{extra}")
    return " ".join(teile)
