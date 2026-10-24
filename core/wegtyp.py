"""Wegtyp unter dem Track — Autobahn, Straße, Feldweg, Pfad, Radweg, Fährlinie (24.10.2026).

Marc: „Könnte man mit einer lokalen KI die Auswertung im Logbuch verbessern?“ — und auf den Vorschlag „bau“. Die
Bewegungserkennung (core/bewegung) kennt nur Tempo und Zeit; Stau auf der Autobahn sieht aus wie ein Radler, eine
Fähre wie eine langsame Fahrt. Was unter dem Track liegt, entscheidet das ohne Raten: Auf der Autobahn fährt niemand
Rad, auf einer Fährlinie fährt man Fähre.

**Quelle:** die Vektor-Kacheln, aus denen die App ihre Karten zeichnet (OpenFreeMap, OpenMapTiles-Schema, Ebene
`transportation` mit `class`/`subclass`). Kein neuer Dienst, kein Schlüssel, keine Trackdaten gehen raus — nur die
Kachelnummern wie beim Kartenzeigen. Gelesen wird Zoom 14 (volle Wegdetails); jede Kachel nur einmal, danach aus dem
Zwischenspeicher. Den Inhalt einer Kachel (Protocol Buffers) liest ein kleiner eigener Leser — keine Abhängigkeit.

**Ergebnis je Tour:** eine Liste von Proben `[Zeit, Klasse]` etwa alle SCHRITT_M Meter; `anteile(proben, t0, t1)`
sagt, wie viel eines Abschnitts auf welcher Klasse lag. Die Regeln dazu stehen in core/logbuch.py (`wege_anwenden`).
"""
from __future__ import annotations

import gzip
import json
import logging
import math
import os
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from . import net as _net   # mitgelieferte Zertifikate — im gebauten Programm findet OpenSSL die System-Zertifikate nicht

log = logging.getLogger("core.wegtyp")

TILEJSON = "https://tiles.openfreemap.org/planet"
Z = 14
Z_STUFEN = (14, 12, 10)   # lange Reisen gröber: Autobahn und Fährlinien gibt es auch in 12 und 10, Radwege nur in 14
SCHRITT_M = 60.0          # Probenabstand entlang des Tracks
NAH_M = 22.0              # weiter weg liegt kein Weg „unter“ dem Track (GPS-Streuung + Straßenbreite)
NAH_M_JE_ZOOM = {14: 22.0, 12: 45.0, 10: 90.0}   # gröbere Stufe = stärker vereinfachte Linien
MAX_KACHELN = 300         # die erste Stufe, die darunter bleibt (Schottland, 5 900 km: Zoom 14 ~3 600, 12: 909, 10: ~240)
VERSION = 2               # Klassen/Regeln geändert → neu rechnen (2: Proben mit Strecke, Anteile nach Strecke)
LUECKE_M = 300.0          # weiter ohne Punkt (Aufzeichnungslücke): der Rest der Strecke zählt als „unbekannt“

# OpenMapTiles `transportation.class` (und `subclass` bei path) → unsere Klassen
KLASSEN = {"motorway": "autobahn", "trunk": "autobahn",
           "primary": "strasse", "secondary": "strasse", "tertiary": "strasse", "minor": "strasse", "service": "strasse",
           "track": "weg", "path": "pfad", "ferry": "faehre", "rail": "bahn", "transit": "bahn"}
PFAD_RAD = ("cycleway",)


# ── Kachel-Mathe ──────────────────────────────────────────────────────────────
def _kachel_xy(lon: float, lat: float, z: int = Z) -> Tuple[float, float]:
    n = 1 << z
    x = (lon + 180.0) / 360.0 * n
    la = max(-85.0511, min(85.0511, lat))
    y = (1.0 - math.asinh(math.tan(math.radians(la))) / math.pi) / 2.0 * n
    return x, y


def _hav(lat1, lon1, lat2, lon2) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


# ── Vektor-Kachel lesen (Mapbox Vector Tile 2.1, nur was wir brauchen) ──────────
def _varint(b: bytes, i: int) -> Tuple[int, int]:
    r = s = 0
    while True:
        c = b[i]; i += 1
        r |= (c & 0x7F) << s
        if c < 0x80:
            return r, i
        s += 7


def _felder(b: bytes):
    """(Feldnummer, Typ, Wert) eines Protobuf-Blocks; Wert = int oder bytes."""
    i, n = 0, len(b)
    while i < n:
        k, i = _varint(b, i)
        f, t = k >> 3, k & 7
        if t == 0:
            v, i = _varint(b, i)
        elif t == 2:
            ln, i = _varint(b, i)
            v = b[i:i + ln]; i += ln
        elif t == 1:
            v = b[i:i + 8]; i += 8
        elif t == 5:
            v = b[i:i + 4]; i += 4
        else:
            raise ValueError(f"Protobuf-Typ {t}")
        yield f, t, v


def _gepackt(b: bytes) -> List[int]:
    out, i = [], 0
    while i < len(b):
        v, i = _varint(b, i)
        out.append(v)
    return out


def _wert(b: bytes):
    for f, _t, v in _felder(b):
        if f == 1:
            return v.decode("utf-8", "replace")
        return v
    return None


def linien(pbf: bytes, ebene: str = "transportation") -> Tuple[int, List[Tuple[str, List[List[Tuple[int, int]]]]]]:
    """(extent, [(klasse, [Linie aus (x, y)-Kachelpunkten], …)]) der Ebene `ebene`; Klasse schon übersetzt."""
    for f, _t, lb in _felder(pbf):
        if f != 3:
            continue
        name, keys, vals, feats, extent = None, [], [], [], 4096
        for g, _t, v in _felder(lb):
            if g == 1:
                name = v.decode()
            elif g == 2:
                feats.append(v)
            elif g == 3:
                keys.append(v.decode())
            elif g == 4:
                vals.append(_wert(v))
            elif g == 5:
                extent = v
        if name != ebene:
            continue
        raus = []
        for fb in feats:
            tags, geo, typ = [], [], 0
            for g, _t, v in _felder(fb):
                if g == 2:
                    tags = _gepackt(v)
                elif g == 3:
                    typ = v
                elif g == 4:
                    geo = _gepackt(v)
            if typ != 2:          # nur Linien
                continue
            p = {keys[tags[k]]: vals[tags[k + 1]] for k in range(0, len(tags) - 1, 2)}
            kl = KLASSEN.get(str(p.get("class") or ""))
            if not kl:
                continue
            if kl == "pfad" and str(p.get("subclass") or "") in PFAD_RAD:
                kl = "radweg"
            stuecke, cx, cy, i, akt = [], 0, 0, 0, None
            while i < len(geo):
                cmd, cnt = geo[i] & 7, geo[i] >> 3
                i += 1
                for _ in range(cnt):
                    if cmd in (1, 2):
                        dx, dy = geo[i], geo[i + 1]; i += 2
                        cx += (dx >> 1) ^ -(dx & 1)
                        cy += (dy >> 1) ^ -(dy & 1)
                        if cmd == 1:
                            akt = [(cx, cy)]; stuecke.append(akt)
                        elif akt is not None:
                            akt.append((cx, cy))
            raus.append((kl, [s for s in stuecke if len(s) > 1]))
        return extent, raus
    return 4096, []


# ── Kacheln holen (mit Zwischenspeicher) ─────────────────────────────────────
_URL_VORLAGE: Dict[str, object] = {"url": None, "zeit": 0.0}


def _vorlage(cache_dir: Optional[Path]) -> Optional[str]:
    """Kachel-URL aus der TileJSON (enthält die Datenversion); einen Tag gemerkt, auf Platte als Rückfall."""
    jetzt = time.time()
    if _URL_VORLAGE["url"] and jetzt - float(_URL_VORLAGE["zeit"]) < 86400:
        return str(_URL_VORLAGE["url"])
    datei = (Path(cache_dir) / "wegtyp" / "tilejson.json") if cache_dir else None
    try:
        req = urllib.request.Request(TILEJSON, headers={"User-Agent": "GPS Studio (reisezoom.com)"})
        with urllib.request.urlopen(req, timeout=15, context=_net.ssl_context()) as r:
            tj = json.loads(r.read().decode("utf-8"))
        url = (tj.get("tiles") or [None])[0]
        if url:
            _URL_VORLAGE.update(url=url, zeit=jetzt)
            if datei:
                datei.parent.mkdir(parents=True, exist_ok=True)
                datei.write_text(json.dumps({"url": url}))
            return url
    except Exception as e:  # noqa: BLE001
        log.info("wegtyp: TileJSON nicht erreichbar (%s)", e)
    try:
        return json.loads(datei.read_text())["url"] if datei and datei.exists() else None
    except Exception:  # noqa: BLE001
        return None


class KeinNetz(Exception):
    pass


def _kachel(x: int, y: int, cache_dir: Optional[Path], url: str, z: int = Z) -> Optional[bytes]:
    teil = url.split("/planet/")[-1].split("/")[0] if "/planet/" in url else "x"
    datei = (Path(cache_dir) / "wegtyp" / teil / str(z) / str(x) / f"{y}.pbf") if cache_dir else None
    if datei and datei.exists():
        return datei.read_bytes()
    try:
        req = urllib.request.Request(url.replace("{z}", str(z)).replace("{x}", str(x)).replace("{y}", str(y)),
                                     headers={"User-Agent": "GPS Studio (reisezoom.com)", "Accept-Encoding": "gzip"})
        with urllib.request.urlopen(req, timeout=20, context=_net.ssl_context()) as r:
            daten = r.read()
            if r.headers.get("Content-Encoding") == "gzip" or daten[:2] == b"\x1f\x8b":
                daten = gzip.decompress(daten)
    except urllib.error.HTTPError as e:
        if e.code == 404:          # Meer, leere Gegend
            daten = b""
        else:
            raise KeinNetz(str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise KeinNetz(str(e)) from e
    if datei:
        datei.parent.mkdir(parents=True, exist_ok=True)
        tmp = datei.with_suffix(".tmp")
        tmp.write_bytes(daten)
        os.replace(tmp, datei)   # dateischutz-ok: eigener Kachel-Zwischenspeicher
    return daten


# ── Proben entlang des Tracks ────────────────────────────────────────────────
def _pt(p):
    if isinstance(p, dict):
        return p.get("lat"), p.get("lon"), p.get("time")
    return getattr(p, "lat", None), getattr(p, "lon", None), getattr(p, "time", None)


def _epoch(t) -> Optional[float]:
    if t is None:
        return None
    if isinstance(t, (int, float)):
        return float(t)
    if hasattr(t, "timestamp"):
        return float(t.timestamp())
    try:
        from datetime import datetime
        return datetime.fromisoformat(str(t).replace("Z", "+00:00")).timestamp()
    except Exception:  # noqa: BLE001
        return None


def proben_orte(points, schritt_m: float = SCHRITT_M) -> List[Tuple[float, float, float, float]]:
    """(Zeit, lat, lon, Meter seit der letzten Probe) etwa alle `schritt_m` Meter — nur Punkte mit Zeit.
    Die Meter gewichten die Anteile: eine Aufzeichnungslücke über 500 km ist EINE Probe, darf aber nicht weniger
    zählen als ein dicht aufgezeichneter Kilometer Fähre (Schottland: 592 km Fahrt sonst als „Fähre“)."""
    raus, letzte, rest = [], None, 0.0
    for p in points or []:
        la, lo, t = _pt(p)
        tt = _epoch(t)
        if la is None or lo is None or tt is None:
            continue
        if letzte is None:
            raus.append((tt, float(la), float(lo), 0.0)); letzte = (float(la), float(lo)); continue
        rest += _hav(letzte[0], letzte[1], la, lo)
        letzte = (float(la), float(lo))
        if rest >= schritt_m:
            raus.append((tt, float(la), float(lo), rest)); rest = 0.0
    return raus


def _abstand2(px, py, ax, ay, bx, by) -> float:
    dx, dy = bx - ax, by - ay
    l2 = dx * dx + dy * dy
    u = 0.0 if l2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / l2))
    qx, qy = ax + u * dx - px, ay + u * dy - py
    return qx * qx + qy * qy


def berechnen(points, cache_dir: Optional[Path] = None, fortschritt=None) -> dict:
    """Wegklasse unter dem Track. → {"version", "proben": [[Zeit, Klasse], …], "kacheln", "ohne_netz"}.
    Klasse "" = nichts in der Nähe. Bei fehlendem Netz: `ohne_netz` True und so viele Proben, wie es gab."""
    url = _vorlage(cache_dir)
    if not url:
        return {"version": VERSION, "proben": [], "kacheln": 0, "ohne_netz": True}
    orte = proben_orte(points)
    if not orte:
        return {"version": VERSION, "proben": [], "kacheln": 0, "ohne_netz": False}
    z = Z_STUFEN[-1]
    for stufe in Z_STUFEN:
        if len({(int(x), int(y)) for x, y in (_kachel_xy(o[2], o[1], stufe) for o in orte)}) <= MAX_KACHELN:
            z = stufe
            break
    return berechnen_aus(orte, cache_dir, url, z, fortschritt)


def berechnen_aus(orte, cache_dir, url, z: int = Z, fortschritt=None) -> dict:
    """`fortschritt(fertig, gesamt)` nach jeder Kachel — für die Anzeige beim Warten (Marc: „wenn man warten muss,
    muss halt Feedback dazu kommen“)."""
    je_kachel: Dict[Tuple[int, int], List[int]] = {}
    for k, (_t, la, lo, *_m) in enumerate(orte):
        x, y = _kachel_xy(lo, la, z)
        je_kachel.setdefault((int(x), int(y)), []).append(k)
    klasse = [""] * len(orte)
    ohne_netz = False
    for nr, ((kx, ky), idx) in enumerate(je_kachel.items()):
        if fortschritt:
            try:
                fortschritt(nr, len(je_kachel))
            except Exception:  # noqa: BLE001
                pass
        try:
            pbf = _kachel(kx, ky, cache_dir, url, z)
        except KeinNetz as e:
            log.info("wegtyp: Kachel %s/%s nicht geladen (%s)", kx, ky, e)
            ohne_netz = True
            break
        if not pbf:
            continue
        extent, ls = linien(pbf)
        # Raster über die Kachel, damit nicht jede Probe jede Linie prüft
        zelle = extent / 32.0
        gitter: Dict[Tuple[int, int], List[Tuple[str, int, int, int, int]]] = {}
        for kl, stuecke in ls:
            for s in stuecke:
                for (ax, ay), (bx, by) in zip(s, s[1:]):
                    for gx in range(int(min(ax, bx) // zelle) - 1, int(max(ax, bx) // zelle) + 2):
                        for gy in range(int(min(ay, by) // zelle) - 1, int(max(ay, by) // zelle) + 2):
                            gitter.setdefault((gx, gy), []).append((kl, ax, ay, bx, by))
        for k in idx:
            _t, la, lo = orte[k][:3]
            x, y = _kachel_xy(lo, la, z)
            px, py = (x - kx) * extent, (y - ky) * extent
            m_je_einheit = 40075016.686 * math.cos(math.radians(la)) / (1 << z) / extent
            grenze2 = (NAH_M_JE_ZOOM.get(z, NAH_M) / m_je_einheit) ** 2
            best, beste = grenze2, ""
            for s in gitter.get((int(px // zelle), int(py // zelle)), ()):
                d2 = _abstand2(px, py, s[1], s[2], s[3], s[4])
                if d2 < best:
                    best, beste = d2, s[0]
            # In Zoom 10 fehlen die kleinen Straßen — der nächste Weg ist dann fast immer eine große Straße (Schottland:
            # 60 % „Autobahn“). Dort zählen nur Fährlinien und Bahn; Autobahn erst ab Zoom 12.
            klasse[k] = beste if (z >= 12 or beste in ("faehre", "bahn")) else ""
    return {"version": VERSION, "proben": [[round(orte[k][0], 1), klasse[k], round(orte[k][3] if len(orte[k]) > 3 else SCHRITT_M)]
                                           for k in range(len(orte))],
            "kacheln": len(je_kachel), "zoom": z, "ohne_netz": ohne_netz}


def anteile(proben: List[list], t0: float, t1: float) -> Dict[str, float]:
    """Anteil je Klasse an der STRECKE zwischen t0 und t1 (auch "" = kein Weg/unbekannt); leer ohne Proben dort.
    Jede Probe steht für die Meter seit der vorigen; was über LUECKE_M hinausgeht (Lücke), zählt als unbekannt.
    `_n` = Zahl der Proben."""
    teil = [(p[1], float(p[2]) if len(p) > 2 else SCHRITT_M) for p in (proben or []) if t0 <= p[0] <= t1]
    if not teil:
        return {}
    meter: Dict[str, float] = {}
    for k, m in teil:
        m = max(m, 1.0)
        meter[k] = meter.get(k, 0.0) + min(m, LUECKE_M)
        if m > LUECKE_M:
            meter[""] = meter.get("", 0.0) + (m - LUECKE_M)
    ges = sum(meter.values()) or 1.0
    raus = {k: v / ges for k, v in meter.items()}
    raus["_n"] = float(len(teil))
    return raus


# ── Gemerkt je Tour in der Bibliothek ─────────────────────────────────────────
SCHEMA = """
CREATE TABLE IF NOT EXISTS logbuch_wege (
    tour      TEXT PRIMARY KEY,
    daten     TEXT NOT NULL,
    geaendert TEXT
);
"""


def schema_anlegen(conn) -> None:
    conn.executescript(SCHEMA)


def lesen(conn, tour: str) -> Optional[dict]:
    schema_anlegen(conn)
    r = conn.execute("SELECT daten FROM logbuch_wege WHERE tour = ?", (tour,)).fetchone()
    if not r:
        return None
    try:
        d = json.loads(r[0])
        return d if int(d.get("version") or 0) == VERSION else None
    except Exception:  # noqa: BLE001
        return None


def merken(conn, tour: str, daten: dict) -> None:
    schema_anlegen(conn)
    conn.execute("INSERT OR REPLACE INTO logbuch_wege (tour, daten, geaendert) VALUES (?, ?, ?)",
                 (tour, json.dumps({"version": daten.get("version", VERSION), "proben": daten.get("proben") or []}),
                  time.strftime("%Y-%m-%dT%H:%M:%S")))
    conn.commit()
