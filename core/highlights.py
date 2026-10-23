# -*- coding: utf-8 -*-
"""Highlights entlang eines Tracks → Schilder (Tour-Assistent Stufe 3;
Marc 11.09.2026: „lass erst mal nur POIs mit
Schildern markieren, mal sehen, wie gut das funktioniert").

Quellen
-------
1. OpenStreetMap über Overpass: benannte Gipfel, Pässe, Aussichtspunkte,
   Hütten, Wasserfälle, Quellen, Burgen, Ruinen, Denkmäler, Sehenswürdigkeiten
   in einem Korridor um den Track (`around:` mit Polylinie, Track vorher
   vereinfacht, damit die Abfrage kurz bleibt).
2. Der Track selbst: der höchste Punkt, wenn OSM dort keinen Gipfel kennt.
3. Start und Ziel: Ortsname vom Geocoder (Photon, kein Schlüssel).

Auswahl
-------
Rang nach Art (Gipfel/Pass vor Aussichtspunkt vor Hütte vor Rest), je Name
einmal, an den nächsten Trackpunkt gerastet, dann gleichmäßig über die Tour
verteilt (Mindestabstand als Anteil der Strecke), höchstens `max_n`.

Kein Netz → leere Liste, kein Fehler: der Assistent meldet es als Zeile.
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import re
import threading
import time
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Callable, List, Optional

from . import dateischutz as _ds
from . import gpxsimplify
from . import net as cnet

log = logging.getLogger("core.highlights")

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
KORRIDOR_M = 120.0          # so weit darf ein Ort neben dem Track liegen (Marc: „120 m passen schon — dann war da halt nix")
ORT_KORRIDOR_M = 400.0      # Dörfer/Städte: der Mittelpunkt liegt selten am Weg — weiter, und sie füllen nur Lücken
SEE_KORRIDOR_M = 60.0       # Seen: Abstand zum UFER (Rechteck der Fläche), nicht zur Mitte
MAX_POLYLINE_PUNKTE = 200   # (für _polylinie; die Abfrage nutzt seit 11.09.2026 die Bounding-Box)
OVERPASS_TIMEOUT_S = 20     # Server-Limit; der Client wartet 5 s länger
MAX_SCHILDER = 8            # Untergrenze; je 5 km ein Schild, höchstens MAX_SCHILDER_LANG
MAX_SCHILDER_LANG = 16
MIN_ABSTAND_ANTEIL = 0.03   # zwischen zwei Schildern mindestens 3 % der Strecke …
MIN_ABSTAND_M = 800.0       # … aber nie mehr als 800 m (70-km-Tour: sonst fielen die Track-Stellen weg)
HUB_MIN_M = 150.0           # „Höchster Punkt" nur ab so viel Höhenunterschied

#: OSM-Tags, die ein Highlight ausmachen → (Art, Rang: kleiner = wichtiger, Symbol)
ARTEN = {
    ("natural", "peak"): ("gipfel", 0, "⛰"),
    ("natural", "volcano"): ("gipfel", 0, "🌋"),
    ("mountain_pass", "yes"): ("pass", 1, "🏔"),
    ("natural", "saddle"): ("pass", 1, "🏔"),
    ("tourism", "viewpoint"): ("aussicht", 2, "👁"),
    ("natural", "waterfall"): ("wasserfall", 2, "💦"),
    ("natural", "cave_entrance"): ("hoehle", 3, "🕳"),
    ("natural", "spring"): ("quelle", 4, "💧"),
    ("natural", "glacier"): ("gletscher", 2, "🧊"),
    ("tourism", "alpine_hut"): ("huette", 3, "🏠"),
    ("tourism", "wilderness_hut"): ("huette", 3, "🏠"),
    ("amenity", "shelter"): ("huette", 5, "🏠"),
    ("historic", "castle"): ("burg", 1, "🏰"),
    ("historic", "ruins"): ("ruine", 3, "🏚"),
    ("historic", "monument"): ("denkmal", 4, "🗿"),
    ("historic", "memorial"): ("denkmal", 5, "🗿"),
    ("historic", "archaeological_site"): ("ruine", 4, "🏺"),
    ("tourism", "attraction"): ("sehenswert", 3, "⭐"),
    ("tourism", "artwork"): ("kunst", 5, "🎨"),
    ("tourism", "museum"): ("museum", 4, "🏛"),
    ("man_made", "lighthouse"): ("leuchtturm", 2, "🗼"),
    ("man_made", "tower"): ("turm", 5, "🗼"),
    ("natural", "water"): ("see", 2, "🌊"),       # nur Seen/Teiche (Flüsse/Kanäle werden ausgesiebt)
    ("place", "town"): ("ort", 6, "🏘"),
    ("place", "village"): ("ort", 6, "🏘"),
    ("place", "hamlet"): ("ort", 7, "🏘"),
}
KEIN_SEE = {"river", "canal", "stream", "ditch", "drain", "wastewater", "basin", "moat"}


def _haversine_m(lat1, lon1, lat2, lon2) -> float:
    return gpxsimplify.haversine_m(lat1, lon1, lat2, lon2)


# ── 1) Overpass ─────────────────────────────────────────────────────────────

def _polylinie(points: List[dict]) -> List[List[float]]:
    pts = [p for p in points if p.get("lat") is not None and p.get("lon") is not None]
    if not pts:
        return []
    tol = 5.0
    out = pts
    # Vereinfachen, bis die Abfrage kurz genug ist (Douglas-Peucker mit wachsender Toleranz)
    for _ in range(8):
        if len(out) <= MAX_POLYLINE_PUNKTE:
            break
        r = gpxsimplify.simplify_points(pts, tol_m=tol)
        out = r.get("points") or pts
        tol *= 2
    if len(out) > MAX_POLYLINE_PUNKTE:
        schritt = max(1, len(out) // MAX_POLYLINE_PUNKTE)
        out = out[::schritt] + [out[-1]]
    return [[float(p["lat"]), float(p["lon"])] for p in out]


BBOX_GROSS_GRAD2 = 0.05     # ab ~600 km² keine Dörfer/Weiler mehr abfragen (Tausende Treffer)


def overpass_abfrage(points: List[dict], radius_m: float = KORRIDOR_M) -> str:
    """Overpass-QL: benannte Highlights je Tag-Art in der Bounding-Box des Tracks
    (mit `radius_m` Rand). Die Box wird über den Tag-Index beantwortet — eine
    Korridor-Abfrage (`around:` mit Polylinie) lief bei einer 70-km-Tour in die
    Zeitüberschreitung (11.09.2026). Der Korridor wird danach LOKAL gefiltert."""
    pts = [p for p in points if p.get("lat") is not None and p.get("lon") is not None]
    if len(pts) < 2:
        return ""
    lats = [float(p["lat"]) for p in pts]
    lons = [float(p["lon"]) for p in pts]
    dlat = radius_m / 111_000.0
    dlon = radius_m / (111_000.0 * max(0.2, math.cos(math.radians(sum(lats) / len(lats)))))
    s, w, n, e = min(lats) - dlat, min(lons) - dlon, max(lats) + dlat, max(lons) + dlon
    bbox = f"{s:.5f},{w:.5f},{n:.5f},{e:.5f}"
    gross = (n - s) * (e - w) > BBOX_GROSS_GRAD2
    zeilen = [f'nwr["{k}"="{v}"]["name"]({bbox});' for (k, v) in ARTEN if not (gross and k == "place")]
    # `bb` = Rechteck der Fläche (Seen: Abstand zum Ufer), `center` für Punkte/Wege
    return f"[out:json][timeout:{OVERPASS_TIMEOUT_S}];(" + "".join(zeilen) + ");out center bb tags;"


#: Reihenfolge der Versuche: Hauptserver, noch einmal Hauptserver, dann Spiegel.
#: Der Hauptserver antwortet unter Last mit 504 (11.09.2026, 14:48 bei Marc).
OVERPASS_SERVER = (OVERPASS_URL, OVERPASS_URL, "https://overpass.kumi.systems/api/interpreter")


def _http_overpass_einmal(url: str, query: str, timeout: float) -> dict:
    data = urllib.parse.urlencode({"data": query}).encode("utf-8")
    req = urllib.request.Request(url, data=data,
                                 headers={"User-Agent": "ReisezoomGPSStudio", "Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=timeout, context=cnet.ssl_context()) as resp:
        return json.loads(resp.read().decode("utf-8", errors="replace"))


def _http_overpass(query: str, timeout: float = OVERPASS_TIMEOUT_S + 5) -> dict:
    """Mit Wiederholung: 504/Zeitüberschreitung → nächster Versuch. Wirft den
    letzten Fehler, wenn alle scheitern."""
    # 22.10.2026: zuerst die eigenen Ortsdaten-Kacheln (core/ortsdaten) — Overpass nur, wo es keine gibt
    try:
        from . import ortsdaten
        lokal = ortsdaten.antwort(query)
    except Exception as e:  # noqa: BLE001
        log.warning("Ortsdaten: %s", e)
        lokal = None
    if lokal is not None:
        return lokal
    letzter = None
    for i, url in enumerate(OVERPASS_SERVER):
        try:
            return _http_overpass_einmal(url, query, timeout)
        except Exception as e:  # noqa: BLE001
            letzter = e
            log.warning("Overpass Versuch %d/%d (%s): %s", i + 1, len(OVERPASS_SERVER), url.split("/")[2], str(e)[:80])
    raise letzter if letzter else RuntimeError("Overpass")


class KeinNetz(Exception):
    """Overpass nicht erreichbar (Netz, Zeitüberschreitung, Serverfehler)."""


# ── Benannter Ort an EINER Stelle (02.10.2026) ──────────────────────────────
# Marc (Teide-Demo): „Gipfel — da steht La Orotava. Dabei ist das wirklich ein super markanter Punkt … bei den höchsten
# Stellen könnte man gucken, welcher Gipfel das ist, und den direkt hinschreiben." Für die Bildunterschrift eines
# Fotostopps und den Gipfelnamen am „Höchsten Punkt". Nur markante Arten (Gipfel, Pass, Hütte, Aussicht, Burg …),
# keine Orte — den Ort kennt die Bildunterschrift schon.
PHOTON_REVERSE = "https://photon.komoot.io/reverse"
#: Photon-Filter je Stufe: erst Gipfel/Pässe (die markanten), dann der Rest. Symbol wie ARTEN.
PUNKT_STUFEN = (
    (("natural:peak", "gipfel", "⛰"), ("natural:volcano", "gipfel", "🌋"), ("natural:saddle", "pass", "🏔"),
     ("mountain_pass:yes", "pass", "🏔")),
    (("tourism:alpine_hut", "huette", "🏠"), ("tourism:wilderness_hut", "huette", "🏠"), ("tourism:viewpoint", "aussicht", "👁"),
     ("natural:waterfall", "wasserfall", "💦"), ("historic:castle", "burg", "🏰"), ("historic:ruins", "ruine", "🏚"),
     ("man_made:lighthouse", "leuchtturm", "🗼"), ("natural:glacier", "gletscher", "🧊"), ("natural:cave_entrance", "hoehle", "🕳")),
)


def _photon_reverse(lat: float, lon: float, radius_km: float, tags: List[str], timeout: float) -> List[dict]:
    q = [("lat", f"{lat:.6f}"), ("lon", f"{lon:.6f}"), ("radius", f"{radius_km:.3f}"), ("limit", "5")] + [("osm_tag", t) for t in tags]
    url = PHOTON_REVERSE + "?" + urllib.parse.urlencode(q)
    req = urllib.request.Request(url, headers={"User-Agent": "ReisezoomGPSStudio"})
    with urllib.request.urlopen(req, timeout=timeout, context=cnet.ssl_context()) as resp:
        return (json.loads(resp.read().decode("utf-8", errors="replace")) or {}).get("features") or []


def ort_am_punkt(lat: float, lon: float, radius_m: float = 350.0, nur_gipfel: bool = False,
                 http: Optional[Callable[[float, float, float, List[str]], List[dict]]] = None, timeout: float = 6.0) -> Optional[dict]:
    """Der markanteste benannte Ort im Umkreis: {name, art, symbol, abstand_m} oder None.
    Über Photon (komoot, wie die Ortsnamen im Logbuch) — Overpass war am 02.10.2026 minutenlang überlastet.
    Erst Gipfel/Pässe, dann Hütten, Aussichten, Burgen …; innerhalb einer Stufe der nächste. Ohne Netz: KeinNetz."""
    r_km = max(0.03, min(2.0, radius_m / 1000.0))
    abfrage = http or (lambda la, lo, rk, tags: _photon_reverse(la, lo, rk, tags, timeout))
    stufen = PUNKT_STUFEN[:1] if nur_gipfel else PUNKT_STUFEN
    for stufe in stufen:
        art_von = {t: (a, sym) for t, a, sym in stufe}
        try:
            feats = abfrage(float(lat), float(lon), r_km, list(art_von))
        except Exception as e:  # noqa: BLE001
            raise KeinNetz(str(e)) from e
        best = None
        for f in feats:
            pr = f.get("properties") or {}
            name = str(pr.get("name") or "").strip()
            co = (f.get("geometry") or {}).get("coordinates") or []
            a = art_von.get(f"{pr.get('osm_key')}:{pr.get('osm_value')}")
            if not name or len(co) < 2 or not a:
                continue
            d = _haversine_m(float(lat), float(lon), float(co[1]), float(co[0]))
            if d > radius_m * 1.05:
                continue
            if best is None or d < best[0]:
                best = (d, {"name": name, "art": a[0], "symbol": a[1], "abstand_m": round(d),
                            "osm": (str(pr.get("osm_type") or ""), pr.get("osm_id"))})
        if best:
            ort = best[1]
            osm = ort.pop("osm", None)
            # 02.10.2026 (Marc: „bei den Bildern an Gipfeln auch die Höhe") — Höhe aus dem OSM-Objekt selbst
            # (Teide: ele=3715; die GPS-Höhe im Foto sagte 3768). Nur Gipfel/Pässe; ohne Netz ohne Höhe.
            if http is None and ort["art"] in ("gipfel", "pass") and osm and osm[1]:
                ort["ele"] = _osm_ele(osm[0], osm[1], timeout)
            return ort
    return None


OSM_API = "https://api.openstreetmap.org/api/0.6"


def _osm_ele(typ: str, osm_id, timeout: float = 6.0) -> Optional[float]:
    art = {"N": "node", "W": "way", "R": "relation"}.get(str(typ).upper()[:1])
    if not art:
        return None
    try:
        req = urllib.request.Request(f"{OSM_API}/{art}/{int(osm_id)}.json", headers={"User-Agent": "ReisezoomGPSStudio"})
        with urllib.request.urlopen(req, timeout=timeout, context=cnet.ssl_context()) as resp:
            el = (json.loads(resp.read().decode("utf-8", errors="replace")).get("elements") or [{}])[0]
        v = str((el.get("tags") or {}).get("ele") or "").replace(",", ".").split()[0]
        return round(float(v)) if v else None
    except Exception as e:  # noqa: BLE001
        log.info("OSM-Höhe %s/%s: %s", art, osm_id, e)
        return None


def _kasten(points: List[dict], radius_m: float) -> Optional[tuple]:
    pts = [p for p in points if p.get("lat") is not None and p.get("lon") is not None]
    if not pts:
        return None
    lats = [float(p["lat"]) for p in pts]
    lons = [float(p["lon"]) for p in pts]
    dlat = radius_m / 111_000.0
    dlon = radius_m / (111_000.0 * max(0.2, math.cos(math.radians(sum(lats) / len(lats)))))
    return (min(lats) - dlat, min(lons) - dlon, max(lats) + dlat, max(lons) + dlon)


def overpass_abfrage_kaesten(kaesten: List[tuple]) -> str:
    """EINE Overpass-Abfrage für viele kleine Kästen (22.10.2026, Logbuch langer Touren: je Abschnitt eine eigene
    Abfrage brauchte über 10 min). Je Kasten eine Zeile pro OSM-Schlüssel mit Werte-Liste; ohne Orte (`place`) —
    die kommen im Logbuch aus der eigenen Orte-Abfrage."""
    werte: dict = {}
    for (k, v) in ARTEN:
        if k != "place":
            werte.setdefault(k, []).append(v)
    zeilen = []
    for (s, w, n, e) in kaesten:
        bbox = f"{s:.5f},{w:.5f},{n:.5f},{e:.5f}"
        for k, vs in werte.items():
            zeilen.append(f'nwr["{k}"~"^({"|".join(vs)})$"]["name"]({bbox});')
    return f"[out:json][timeout:{OVERPASS_TIMEOUT_S * 2}];(" + "".join(zeilen) + ");out center bb tags;"


def osm_pois_kaesten(kaesten: List[tuple], *, http: Optional[Callable[[str], dict]] = None) -> List[dict]:
    """Wie osm_pois, aber für viele Kästen in einer Anfrage.
    Kästen mit eigenen Ortsdaten-Kacheln (core/ortsdaten) werden daraus beantwortet, nur der Rest geht an Overpass.
    Scheitert Overpass, aber Kacheln lieferten etwas: KeinNetz mit `.teil` = die Treffer aus den Kacheln."""
    if not kaesten:
        return []
    lokal, rest = [], list(kaesten)
    if http is None:
        try:
            from . import ortsdaten
            lokal, rest = ortsdaten.teilantwort(kaesten)
        except Exception as e:  # noqa: BLE001
            log.warning("Ortsdaten: %s", e)
            lokal, rest = [], list(kaesten)
    pois = _pois_aus_antwort({"elements": lokal}) if lokal else []
    if not rest:
        return pois
    try:
        res = (http or (lambda q: _http_overpass(q, OVERPASS_TIMEOUT_S * 2 + 5)))(overpass_abfrage_kaesten(rest))
    except Exception as e:  # noqa: BLE001
        log.warning("Overpass nicht erreichbar: %s", e)
        fehler = KeinNetz(str(e))
        fehler.teil = pois
        raise fehler from e
    return pois + _pois_aus_antwort(res)


def osm_pois(points: List[dict], *, radius_m: float = KORRIDOR_M,
             http: Optional[Callable[[str], dict]] = None) -> List[dict]:
    """Highlights aus OSM: [{lat, lon, name, art, rang, symbol, ele, tags}]. `http`
    kann für Tests ersetzt werden. Ohne Netz: KeinNetz (kein Treffer ≠ kein Netz)."""
    q = overpass_abfrage(points, radius_m)
    if not q:
        return []
    try:
        res = (http or _http_overpass)(q)
    except Exception as e:  # noqa: BLE001
        log.warning("Overpass nicht erreichbar: %s", e)
        raise KeinNetz(str(e)) from e
    return _pois_aus_antwort(res)


def _pois_aus_antwort(res: dict) -> List[dict]:
    out = []
    for el in (res or {}).get("elements") or []:
        tags = el.get("tags") or {}
        name = str(tags.get("name") or "").strip()
        if not name:
            continue
        lat = el.get("lat", (el.get("center") or {}).get("lat"))
        lon = el.get("lon", (el.get("center") or {}).get("lon"))
        bounds = el.get("bounds") if isinstance(el.get("bounds"), dict) else None
        if (lat is None or lon is None) and bounds:
            lat = (float(bounds["minlat"]) + float(bounds["maxlat"])) / 2
            lon = (float(bounds["minlon"]) + float(bounds["maxlon"])) / 2
        if lat is None or lon is None:
            continue
        if tags.get("natural") == "water" and str(tags.get("water") or "").lower() in KEIN_SEE:
            continue
        art = None
        for (k, v), (a, rang, sym) in ARTEN.items():
            if tags.get(k) == v:
                if art is None or rang < art[1]:
                    art = (a, rang, sym)
        if not art:
            continue
        # Stolpersteine sind Denkmäler mit Personennamen — als Schild auf der Wanderung fehl am Platz.
        if "stolperstein" in (str(tags.get("memorial:type") or "") + str(tags.get("memorial") or "")).lower():
            continue
        ele = None
        try:
            ele = float(str(tags.get("ele") or "").replace(",", ".").split()[0])
        except Exception:  # noqa: BLE001
            ele = None
        eintrag = {"lat": float(lat), "lon": float(lon), "name": name, "art": art[0],
                   "rang": art[1], "symbol": art[2], "ele": ele, "osm_id": el.get("id")}
        if bounds and art[0] == "see":
            eintrag["bounds"] = {k: float(bounds[k]) for k in ("minlat", "minlon", "maxlat", "maxlon")}
        out.append(eintrag)
    return out


# ── 2) Track-eigene Highlights ─────────────────────────────────────────────
#
# Marc (11.09.2026): „sowas wie höchster Punkt, tiefster Punkt, höchste
# Geschwindigkeit, stärkste Steigung". Alle Rang 3 (ein benannter Ort gewinnt),
# Werte geglättet über ein Fenster, damit kein GPS-Sprung die schnellste Stelle wird.

TRACK_ARTEN = {"hoechster": "⛰", "tiefster": "🕳", "schnellster": "🚀", "steilster": "📐"}
TEMPO_FENSTER_S = 30.0      # Tempo über mindestens 30 s
STEIGUNG_FENSTER_M = 100.0  # Steigung über mindestens 100 m
TEMPO_MIN_KMH = 6.0         # darunter kein „schnellste Stelle"-Schild (Spaziergang)
STEIGUNG_MIN_PCT = 8.0      # darunter kein „steilste Stelle"-Schild


def _parse_t(s):
    from datetime import datetime
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00")).timestamp() if s else None
    except Exception:  # noqa: BLE001
        return None


def track_highlights(points: List[dict]) -> List[dict]:
    """Höchster/tiefster Punkt (nur bei ≥ HUB_MIN_M Höhenunterschied), schnellste
    Stelle (Tempo über ≥ 30 s), steilste Stelle (Steigung über ≥ 100 m)."""
    n = len(points)
    if n < 3:
        return []
    out = []
    eles = [(i, float(p["ele"])) for i, p in enumerate(points) if p.get("ele") is not None]
    if eles:
        hi = max(eles, key=lambda x: x[1]); lo = min(eles, key=lambda x: x[1])
        if hi[1] - lo[1] >= HUB_MIN_M:
            for art, (i, e) in (("hoechster", hi), ("tiefster", lo)):
                out.append({"lat": float(points[i]["lat"]), "lon": float(points[i]["lon"]), "idx": i,
                            "name": "", "art": art, "rang": 3, "symbol": TRACK_ARTEN[art], "ele": e, "wert": e})
    # Strecke und Zeit kumuliert
    cum = [0.0]
    for i in range(1, n):
        a, b = points[i - 1], points[i]
        cum.append(cum[-1] + _haversine_m(float(a["lat"]), float(a["lon"]), float(b["lat"]), float(b["lon"])))
    ts = [_parse_t(p.get("time")) for p in points]
    if all(t is not None for t in ts) and ts[-1] - ts[0] > TEMPO_FENSTER_S:
        best, bi = 0.0, -1
        j = 0
        for i in range(n):
            while j < n and ts[j] - ts[i] < TEMPO_FENSTER_S:
                j += 1
            if j >= n:
                break
            dt = ts[j] - ts[i]
            if dt > 0:
                v = (cum[j] - cum[i]) / dt * 3.6
                if v > best:
                    best, bi = v, (i + j) // 2
        if bi >= 0 and best >= TEMPO_MIN_KMH:
            out.append({"lat": float(points[bi]["lat"]), "lon": float(points[bi]["lon"]), "idx": bi,
                        "name": "", "art": "schnellster", "rang": 3, "symbol": TRACK_ARTEN["schnellster"],
                        "ele": None, "wert": best})
    if eles and len(eles) > 2 and cum[-1] > STEIGUNG_FENSTER_M:
        el = {i: e for i, e in eles}
        idx = [i for i, _ in eles]
        best, bi = 0.0, -1
        j = 0
        for a in range(len(idx)):
            i = idx[a]
            while j < len(idx) and cum[idx[j]] - cum[i] < STEIGUNG_FENSTER_M:
                j += 1
            if j >= len(idx):
                break
            k = idx[j]
            dd = cum[k] - cum[i]
            if dd > 0:
                g = (el[k] - el[i]) / dd * 100.0
                if g > best:
                    best, bi = g, (i + k) // 2
        if bi >= 0 and best >= STEIGUNG_MIN_PCT:
            out.append({"lat": float(points[bi]["lat"]), "lon": float(points[bi]["lon"]), "idx": bi,
                        "name": "", "art": "steilster", "rang": 3, "symbol": TRACK_ARTEN["steilster"],
                        "ele": None, "wert": best})
    return out


def hoechster_punkt(points: List[dict]) -> Optional[dict]:
    best, bi = None, -1
    for i, p in enumerate(points):
        e = p.get("ele")
        if e is None:
            continue
        try:
            e = float(e)
        except (TypeError, ValueError):
            continue
        if best is None or e > best:
            best, bi = e, i
    if bi < 0:
        return None
    return {"lat": float(points[bi]["lat"]), "lon": float(points[bi]["lon"]), "idx": bi,
            # Rang 3: ein benannter Ort (Gipfel, Aussicht, Burg) sagt mehr als „Höchster Punkt".
            "name": "", "art": "hoechster", "rang": 3, "symbol": "⛰", "ele": best}


# ── 3) Auswahl ──────────────────────────────────────────────────────────────

def _naechster_index(points: List[dict], lat: float, lon: float, schritt_hint: int = 1) -> tuple[int, float]:
    """Nächster Trackpunkt zu (lat, lon): (Index, Abstand m). Grob über jeden
    n-ten Punkt, dann fein im Umfeld — reicht für Korridor-Fragen."""
    n = len(points)
    if n == 0:
        return -1, float("inf")
    schritt = max(1, n // 2000)
    bi, bd = -1, float("inf")
    for i in range(0, n, schritt):
        p = points[i]
        d = _haversine_m(lat, lon, float(p["lat"]), float(p["lon"]))
        if d < bd:
            bd, bi = d, i
    lo, hi = max(0, bi - schritt), min(n, bi + schritt + 1)
    for i in range(lo, hi):
        p = points[i]
        d = _haversine_m(lat, lon, float(p["lat"]), float(p["lon"]))
        if d < bd:
            bd, bi = d, i
    return bi, bd


def max_schilder_fuer(laenge_m: float) -> int:
    """Je 5 km ein Schild, mindestens MAX_SCHILDER, höchstens MAX_SCHILDER_LANG."""
    return int(max(MAX_SCHILDER, min(MAX_SCHILDER_LANG, round(laenge_m / 5000.0))))


def _naechster_index_rechteck(points: List[dict], b: dict) -> tuple[int, float]:
    """Nächster Trackpunkt zum Rechteck (Seen: Ufer statt Mitte)."""
    n = len(points)
    if n == 0:
        return -1, float("inf")
    schritt = max(1, n // 2000)
    bi, bd = -1, float("inf")
    for i in range(0, n, schritt):
        p = points[i]
        la = min(max(float(p["lat"]), b["minlat"]), b["maxlat"])
        lo = min(max(float(p["lon"]), b["minlon"]), b["maxlon"])
        d = _haversine_m(float(p["lat"]), float(p["lon"]), la, lo)
        if d < bd:
            bd, bi = d, i
    return bi, bd


def auswaehlen(points: List[dict], pois: List[dict], *, max_n: Optional[int] = None,
               radius_m: float = KORRIDOR_M, min_abstand_anteil: float = MIN_ABSTAND_ANTEIL) -> List[dict]:
    # radius_m: Korridor beim Rasten an den Track (Orte: ORT_KORRIDOR_M, Seen: Ufer ≤ SEE_KORRIDOR_M).
    # Bewertung = Rang + Abstand/100 m, damit Nahes vor Fernem steht.
    """Rang, Eindeutigkeit, Korridor, Verteilung. Liefert die gewählten POIs mit
    `idx` (Trackpunkt) und `frac` (Anteil der Strecke), nach Strecke sortiert."""
    n = len(points)
    if n < 2:
        return []
    # kumulierte Strecke je Punkt
    cum = [0.0]
    for i in range(1, n):
        a, b = points[i - 1], points[i]
        cum.append(cum[-1] + _haversine_m(float(a["lat"]), float(a["lon"]), float(b["lat"]), float(b["lon"])))
    ges = cum[-1] or 1.0
    if max_n is None:
        max_n = max_schilder_fuer(ges)
    min_abstand_anteil = min(min_abstand_anteil, MIN_ABSTAND_M / ges)

    kand = []
    gesehen = set()
    for p in sorted(pois, key=lambda x: (x.get("rang", 9), x.get("name", ""))):
        key = (p.get("name") or "").strip().lower() or f"#{p.get('osm_id')}"
        if key in gesehen:
            continue
        if p.get("idx") is None:
            if p.get("art") == "see" and p.get("bounds"):
                idx, d = _naechster_index_rechteck(points, p["bounds"])
                grenze = SEE_KORRIDOR_M
            else:
                idx, d = _naechster_index(points, p["lat"], p["lon"])
                grenze = ORT_KORRIDOR_M if p.get("art") == "ort" else radius_m
            if idx < 0 or d > grenze:
                continue
            p = dict(p, idx=idx, abstand_m=d)
            if p.get("art") == "see":
                # Das Schild steht am Weg, wo er dem See am nächsten kommt — nicht mitten im Wasser.
                p["lat"], p["lon"] = float(points[idx]["lat"]), float(points[idx]["lon"])
        gesehen.add(key)
        p["frac"] = cum[p["idx"]] / ges
        p["score"] = float(p.get("rang", 9)) + float(p.get("abstand_m", 0.0)) / 100.0
        kand.append(p)

    # Track-eigene Highlights: nicht am Rand, und der höchste Punkt nicht dort,
    # wo OSM schon einen Gipfel/Pass kennt.
    for hp in track_highlights(points):
        frac = cum[hp["idx"]] / ges
        if not (0.03 < frac < 0.97):
            continue
        if hp["art"] == "hoechster" and any(
                k.get("art") in ("gipfel", "pass") and abs(k["frac"] - frac) * ges < 300 for k in kand):
            continue
        hp["frac"] = frac
        hp["score"] = float(hp["rang"])
        kand.append(hp)

    # Verteilen: nach Rang nehmen, aber Mindestabstand entlang der Strecke halten
    gewaehlt: List[dict] = []
    for p in sorted(kand, key=lambda x: (x.get("score", 9.0), x.get("name", ""))):
        if len(gewaehlt) >= max_n:
            break
        if any(abs(p["frac"] - g["frac"]) < min_abstand_anteil for g in gewaehlt):
            continue
        gewaehlt.append(p)
    gewaehlt.sort(key=lambda x: x["frac"])
    return gewaehlt


# ── 4) Schilder ─────────────────────────────────────────────────────────────

SCHILD_BASIS = {
    "style": "signpost", "color": "#ff6b35", "size": 16, "bg": "auto", "accent": "auto",
    "tailPos": "center", "textColor": "auto", "font": "system", "weight": 700, "italic": False,
    "align": "center", "minWidth": 0, "radius": 9, "padding": 7, "opacity": 1,
    "borderColor": "none", "borderWidth": 0, "decoScale": 0.5, "direction": "right",
    "calloutDir": "bottom", "shadow": False, "shadowColor": "#000000", "shadowBlur": 8,
    "shadowStrength": 0.55, "zoomScale": True, "before": 1, "after": 4, "entry": "fade",
    "alwaysVisible": False, "anchorMode": "track", "imageSrc": "", "imageSize": 60, "visible": True,
}


def _text(p: dict, labels) -> str:
    """`labels` = Text je Track-Art (dict) — oder nur der Text für „hoechster" (alt)."""
    if isinstance(labels, str):
        labels = {"hoechster": labels}
    labels = labels or {}
    art = p.get("art")
    name = (p.get("name") or "").strip()
    if art in TRACK_ARTEN:
        name = labels.get(art) or {"hoechster": "Höchster Punkt", "tiefster": "Tiefster Punkt",
                                   "schnellster": "Schnellste Stelle", "steilster": "Steilste Stelle"}[art]
        w = p.get("wert")
        if w is not None:
            if art in ("hoechster", "tiefster"):
                return f"{name}\n{int(round(float(w)))} m"
            if art == "schnellster":
                return f"{name}\n{float(w):.0f} km/h"
            if art == "steilster":
                return f"{name}\n{float(w):.0f} %"
        return name
    ele = p.get("ele")
    if ele is not None and art in ("gipfel", "pass", "huette"):
        try:
            return f"{name}\n{int(round(float(ele)))} m"
        except (TypeError, ValueError):
            pass
    return name


def schilder_bauen(gewaehlt: List[dict], *, stil: Optional[dict] = None,
                   hoechster_label="Höchster Punkt",
                   start: str = "", ziel: str = "", points: Optional[List[dict]] = None) -> List[dict]:
    """Schild-Dicts wie sie Animator/Tour-Map lesen (`signs`, `tourmap_signs`).
    `stil` überschreibt die Basis (z. B. style/size/color aus dem Projekt)."""
    basis = dict(SCHILD_BASIS)
    for k, v in (stil or {}).items():
        if v is not None:
            basis[k] = v
    out = []
    if start and points:
        out.append(dict(basis, lat=float(points[0]["lat"]), lon=float(points[0]["lon"]),
                        text=start, hl_art="start"))
    for p in gewaehlt:
        out.append(dict(basis, lat=float(p["lat"]), lon=float(p["lon"]),
                        text=_text(p, hoechster_label), hl_art=p.get("art", "")))
    if ziel and points:
        out.append(dict(basis, lat=float(points[-1]["lat"]), lon=float(points[-1]["lon"]),
                        text=ziel, hl_art="ziel"))
    return out


def kurzliste(gewaehlt: List[dict], hoechster_label="Höchster Punkt") -> str:
    teile = []
    for p in gewaehlt:
        nm = _text(p, hoechster_label).split("\n")[0] if p.get("art") in TRACK_ARTEN else (p.get("name") or "")
        teile.append(f"{p.get('symbol', '')} {nm}".strip())
    return ", ".join(teile)


def highlights_fuer_track(points: List[dict], *, max_n: Optional[int] = None,
                          http: Optional[Callable[[str], dict]] = None) -> dict:
    """Alles in einem: {pois, gewaehlt, netz, radius_m}. `netz` = False nur,
    wenn Overpass nicht antwortete (keine Treffer ≠ kein Netz)."""
    try:
        pois = osm_pois(points, radius_m=KORRIDOR_M, http=http)
    except KeinNetz:
        return {"pois": [], "gewaehlt": [], "netz": False, "radius_m": 0}
    gew = auswaehlen(points, pois, max_n=max_n, radius_m=KORRIDOR_M)
    return {"pois": pois, "gewaehlt": gew, "netz": True, "radius_m": KORRIDOR_M}


# ── 5) Halte-Punkte, Fotos, Vorschläge (Highlights-Fenster, 11.09.2026) ─────
#
# Marc: „man klickt auf highlights, da kommt ein modal, wo man einen fotoordner
# hinzufügen kann … er versucht highlights zu finden, über stehen bleiben + foto
# oder poi + foto … dann kriegt man eine liste mit dem, was gefunden wurde und
# was die app vorschlägt, das kann man an- oder abwählen und den text ändern."

HALT_MIN_S = 180.0          # so lange muss man stehen, damit es ein Halt ist
HALT_RADIUS_M = 40.0        # … innerhalb dieses Umkreises
FOTO_NAH_M = 300.0          # Foto gehört zu einem Highlight, wenn es so nah … (Ort bis 120 m neben dem Weg + Foto daneben)
FOTO_NAH_S = 20 * 60.0      # … und zeitlich so nah liegt
FOTO_GPS_MAX_M = 150.0      # GPS-Foto weiter weg vom Track → nach Zeit zuordnen
FOTO_NAEHE_ANTEIL, FOTO_NAEHE_MIN_M, FOTO_NAEHE_MAX_M = 0.02, 1000.0, 10000.0   # danach: nächster Punkt (F-30)
SERIE_S = 5 * 60.0          # Foto-Serie: mehrere Fotos in fünf Minuten …
SERIE_M = 100.0             # … am selben Fleck
NUR_MIT_FOTO = {"huette", "kunst", "denkmal", "museum", "ort", "turm", "quelle", "hoehle", "ruine", "sehenswert"}
ART_SYMBOL = {"halt": "⏸", "serie": "📷", "foto": "📷"}


def halte_punkte(points: List[dict], *, min_s: float = HALT_MIN_S, radius_m: float = HALT_RADIUS_M) -> List[dict]:
    """Stellen, an denen man ≥ min_s im Umkreis radius_m geblieben ist.
    [{idx, idx_a, idx_b, dauer_s, lat, lon, frac}] — ohne Anfang/Ende (3 %)."""
    n = len(points)
    ts = [_parse_t(p.get("time")) for p in points]
    if n < 3 or any(t is None for t in ts):
        return []
    out = []
    i = 0
    while i < n - 1:
        j = i + 1
        while j < n and _haversine_m(float(points[i]["lat"]), float(points[i]["lon"]),
                                     float(points[j]["lat"]), float(points[j]["lon"])) <= radius_m:
            j += 1
        dauer = ts[j - 1] - ts[i]
        if dauer >= min_s and j - 1 > i:
            m = (i + j - 1) // 2
            out.append({"idx": m, "idx_a": i, "idx_b": j - 1, "dauer_s": float(dauer),
                        "lat": float(points[m]["lat"]), "lon": float(points[m]["lon"])})
            i = j
        else:
            i += 1
    cum = _kumuliert(points)
    ges = cum[-1] or 1.0
    for h in out:
        h["frac"] = cum[h["idx"]] / ges
    return [h for h in out if 0.03 < h["frac"] < 0.97]


def _kumuliert(points: List[dict]) -> List[float]:
    cum = [0.0]
    for i in range(1, len(points)):
        a, b = points[i - 1], points[i]
        cum.append(cum[-1] + _haversine_m(float(a["lat"]), float(a["lon"]), float(b["lat"]), float(b["lon"])))
    return cum


def fotos_zuordnen(points: List[dict], fotos: List[dict], tz_off_min: int = 0) -> List[dict]:
    """Jedem Foto einen Trackpunkt geben: über GPS (≤ FOTO_GPS_MAX_M), sonst über
    die Aufnahmezeit (EXIF ist Ortszeit ohne Zone → mit dem Versatz der Tour nach
    UTC). Liefert Kopien mit idx/frac/epoch/abstand_m (idx None = kein Bezug)."""
    n = len(points)
    if n < 2:
        return [dict(f, idx=None) for f in fotos]
    cum = _kumuliert(points)
    ges = cum[-1] or 1.0
    ts = [_parse_t(p.get("time")) for p in points]
    hat_zeit = all(t is not None for t in ts) and ts[-1] > ts[0]
    out = []
    for f in fotos:
        g = dict(f, idx=None, frac=None, abstand_m=None)
        ep = None
        dt = f.get("datetime")
        if dt:
            try:
                from datetime import datetime, timezone
                d = datetime.fromisoformat(str(dt).replace("Z", "+00:00"))
                if d.tzinfo is None:
                    ep = d.replace(tzinfo=timezone.utc).timestamp() - int(tz_off_min) * 60
                else:
                    ep = d.timestamp()
            except Exception:  # noqa: BLE001
                ep = None
        g["epoch"] = ep
        if f.get("lat") is not None and f.get("lon") is not None:
            i, d = _naechster_index(points, float(f["lat"]), float(f["lon"]))
            if i >= 0 and d <= FOTO_GPS_MAX_M:
                g.update(idx=i, frac=cum[i] / ges, abstand_m=d)
        if g["idx"] is None and ep is not None and hat_zeit and ts[0] - 600 <= ep <= ts[-1] + 600:
            import bisect
            k = bisect.bisect_left(ts, ep)
            k = max(0, min(n - 1, k))
            if k > 0 and abs(ts[k - 1] - ep) < abs(ts[k] - ep):
                k -= 1
            g.update(idx=k, frac=cum[k] / ges, abstand_m=0.0, per_zeit=True)
        # 21.10.2026 (Web-Fund F-30, Rundreise mit geplanter Route ohne Uhrzeiten) — ein GPS-Foto 400 m … 1,5 km neben der
        # Straße blieb ohne Platz. Danach: an den nächsten Trackpunkt, wenn er innerhalb 2 % der Strecke liegt (1–10 km)
        if g["idx"] is None and f.get("lat") is not None and f.get("lon") is not None:
            i, d = _naechster_index(points, float(f["lat"]), float(f["lon"]))
            if i >= 0 and d <= max(FOTO_NAEHE_MIN_M, min(FOTO_NAEHE_MAX_M, FOTO_NAEHE_ANTEIL * ges)):
                g.update(idx=i, frac=cum[i] / ges, abstand_m=d, per_naehe=True)
        out.append(g)
    return out


def _nahes_foto(hl: dict, fotos: List[dict], points: List[dict], ts) -> Optional[dict]:
    """Das zeitlich/räumlich nächste Foto zu einem Highlight, oder None."""
    best, bd = None, None
    for f in fotos:
        if f.get("idx") is None or f.get("_verbraucht"):
            continue
        d = _haversine_m(float(hl["lat"]), float(hl["lon"]), float(points[f["idx"]]["lat"]), float(points[f["idx"]]["lon"]))
        if d > FOTO_NAH_M:
            continue
        if ts and f.get("epoch") is not None and ts[hl["idx"]] is not None and abs(f["epoch"] - ts[hl["idx"]]) > FOTO_NAH_S:
            continue
        if bd is None or d < bd:
            best, bd = f, d
    return best


def vorschlaege(points: List[dict], *, pois: Optional[List[dict]] = None, track: Optional[List[dict]] = None,
                halte: Optional[List[dict]] = None, fotos: Optional[List[dict]] = None,
                labels: Optional[dict] = None, halt_namen: Optional[dict] = None) -> List[dict]:
    """Die Vorschlagsliste fürs Fenster: Highlights (OSM + Track) mit passendem Foto,
    Halte-Punkte mit Fotos, Foto-Serien unterwegs, übrige Fotos. Sortiert nach
    Strecke. `empfohlen`: hoher Rang oder Foto dabei; niedriger Rang nur mit Foto."""
    cum = _kumuliert(points)
    ges = cum[-1] or 1.0
    ts = [_parse_t(p.get("time")) for p in points]
    if any(t is None for t in ts):
        ts = None
    fotos = [f for f in (fotos or []) if f.get("idx") is not None]
    out = []

    def _km(idx):
        return round(cum[idx] / 1000.0, 1)

    def _ep(idx):
        return ts[idx] if ts else None

    for p in (pois or []) + (track or []):
        idx = p.get("idx")
        if idx is None:
            continue
        f = _nahes_foto(p, fotos, points, ts)
        if f:
            f["_verbraucht"] = True
        art = p.get("art", "")
        text = _text(p, labels or {})
        out.append({"art": art, "symbol": p.get("symbol", ""), "text": text, "name": p.get("name", ""),
                    "lat": float(p["lat"]), "lon": float(p["lon"]), "idx": idx, "frac": cum[idx] / ges,
                    "km": _km(idx), "epoch": _ep(idx), "foto": (f.get("path") if f else None),
                    "grund": ("poi_foto" if (f and art not in TRACK_ARTEN) else "poi" if art not in TRACK_ARTEN else "track"),
                    "empfohlen": bool(f) or art not in NUR_MIT_FOTO})
    # Halte-Punkte: nur mit Fotos (Marc: „stehen bleiben + foto")
    for h in (halte or []):
        dabei = [f for f in fotos if not f.get("_verbraucht") and h["idx_a"] - 5 <= f["idx"] <= h["idx_b"] + 5]
        if not dabei:
            continue
        dabei.sort(key=lambda f: abs(f["idx"] - h["idx"]))
        f = dabei[0]
        for x in dabei:
            x["_verbraucht"] = True
        name = (halt_namen or {}).get(h["idx"], "")
        minuten = int(round(h["dauer_s"] / 60.0))
        text = name or (labels or {}).get("halt", "Pause") + f"\n{minuten} min"
        out.append({"art": "halt", "symbol": ART_SYMBOL["halt"], "text": text, "name": name,
                    "lat": h["lat"], "lon": h["lon"], "idx": h["idx"], "frac": h["frac"], "km": _km(h["idx"]),
                    "epoch": _ep(h["idx"]), "foto": f.get("path"), "grund": "halt_foto", "empfohlen": True,
                    "dauer_s": h["dauer_s"], "n_fotos": len(dabei)})
    # Serien: mehrere Fotos in SERIE_S/SERIE_M, nicht verbraucht
    rest = sorted([f for f in fotos if not f.get("_verbraucht")], key=lambda f: (f.get("epoch") or 0, f["idx"]))
    i = 0
    while i < len(rest):
        j = i + 1
        while j < len(rest):
            a, b = rest[i], rest[j]
            nah_t = (a.get("epoch") is None or b.get("epoch") is None or abs(b["epoch"] - a["epoch"]) <= SERIE_S)
            nah_m = _haversine_m(float(points[a["idx"]]["lat"]), float(points[a["idx"]]["lon"]),
                                 float(points[b["idx"]]["lat"]), float(points[b["idx"]]["lon"])) <= SERIE_M
            if nah_t and nah_m:
                j += 1
            else:
                break
        gruppe = rest[i:j]
        if len(gruppe) >= 2:
            f = gruppe[len(gruppe) // 2]
            for x in gruppe:
                x["_verbraucht"] = True
            idx = f["idx"]
            out.append({"art": "serie", "symbol": ART_SYMBOL["serie"], "text": "", "name": "",
                        "lat": float(points[idx]["lat"]), "lon": float(points[idx]["lon"]), "idx": idx,
                        "frac": cum[idx] / ges, "km": _km(idx), "epoch": _ep(idx), "foto": f.get("path"),
                        "grund": "serie", "empfohlen": True, "n_fotos": len(gruppe)})
        i = j
    # Übrige Fotos, abgewählt
    for f in fotos:
        if f.get("_verbraucht"):
            continue
        idx = f["idx"]
        out.append({"art": "foto", "symbol": ART_SYMBOL["foto"], "text": "", "name": "",
                    "lat": float(points[idx]["lat"]), "lon": float(points[idx]["lon"]), "idx": idx,
                    "frac": cum[idx] / ges, "km": _km(idx), "epoch": _ep(idx), "foto": f.get("path"),
                    "grund": "foto", "empfohlen": False})
    out.sort(key=lambda v: (v["frac"], v["art"]))
    for k, v in enumerate(out):
        v["id"] = f"v{k}"
    return out


# ── 6) Orte und Pässe entlang der Strecke (18.10.2026) ──────────────────────
#
# 18.10.2026 — Wunsch aus der Community (PR #11: „Highlights ja schon, aber die Ortsnamen nicht“): für einen Motorradtag
# die Städte und Dörfer, durch die man fährt, und die Pässe, über die man fährt. Die Highlights oben suchen dagegen die
# BESTEN Stellen (8–16 Schilder, Orte nur als Lückenfüller). Eigene Option im Highlights-Fenster, Standard aus.
#
# Abfrage: Orts-Knoten (`place` = city/town/village) und benannte Pässe (`mountain_pass=yes`) in kleinen Kästen
# entlang der Strecke (je 25 km), viele Kästen in EINER Overpass-Anfrage (je 250 km Strecke) — bei 500 km zwei
# Anfragen statt fünfzig. Jede Art bekommt nur den Rand, den sie braucht (Pass 200 m, Dorf 1,5 km, Stadt 5 km).
# Läuft über `_http_overpass` (Hauptserver, Wiederholung, Spiegel); jede Antwort wird einzeln gemerkt (Cache mit
# Obergrenze), ein Ausfall mittendrin kostet beim nächsten Mal nur die fehlenden Anfragen.
#
# Auswertung lokal: je Ort jede DURCHFAHRT (Weg kommt näher als der Radius); führt die Strecke zweimal vorbei (hin und
# zurück, zweimal über denselben Pass), gibt es zwei Einträge mit ihrer eigenen Stelle `strecke_m`.

ORTE_STADT_M = 5000.0        # city: so weit darf der Ortsmittelpunkt neben der Strecke liegen
ORTE_KLEINSTADT_M = 3000.0   # town
ORTE_DORF_M = 1500.0         # village (Weiler und Ortsteile bleiben draußen: zu viele, zu klein)
ORTE_PASS_M = 150.0          # ein Pass zählt, wenn die Strecke so nah an ihm vorbeiführt
ORTE_KASTEN_M = 25_000.0     # Strecke je Kasten (eng am Weg, wenig Beifang)
ORTE_ANFRAGE_M = 250_000.0   # Strecke je Overpass-Anfrage (die Kästen dazu gehen in eine Abfrage)
ORTE_TIMEOUT_S = 45          # Server-Limit je Anfrage; der Client wartet 5 s länger
ORTE_PAUSE_S = 1.0           # Pause zwischen zwei Anfragen (Rücksicht auf den freien Server)
ORTE_GLEICH_M = 2000.0       # gleicher Name an (fast) derselben Stelle der Strecke = derselbe Ort
ORTE_MAX_DURCHFAHRTEN = 3    # öfter als dreimal am selben Ort vorbei: nur die drei nächsten
ORTE_CACHE_VERSION = "orte1"
ORTE_CACHE_MAX = 60          # so viele Antworten bleiben gemerkt (die ältesten fallen heraus)
ORTE_CACHE_MAX_S = 30 * 86400.0
ORTE_ZELLE_M = 1500.0        # Raster für die Abstandssuche

#: place → (Art, Rang: kleiner = wichtiger, Radius)
ORTE_PLACE = {"city": ("stadt", 1, ORTE_STADT_M), "town": ("stadt", 2, ORTE_KLEINSTADT_M), "village": ("dorf", 3, ORTE_DORF_M)}
ORTE_PASS_RANG = 0
#: Linien-Symbol (Lucide-Name, ui/js/icons.js) je Art — die Oberfläche zeigt keine Bildzeichen
ORTE_ICON = {"stadt": "map-pinned", "dorf": "map-pin", "pass": "mountain-snow"}

_ORTE_CACHE_LOCK = threading.Lock()


def lokaler_name(tags: dict) -> Optional[str]:
    """Name wie vor Ort: der deutsche nur, wo er im Namen steckt („Meran - Merano“ → „Meran“); zweisprachige Namen
    („Passo Tre Croci - Son Zuógo“) nur der erste Teil. (Regel aus PR #11 übernommen.)"""
    name = str(tags.get("name") or "").strip()
    de = str(tags.get("name:de") or "").strip()
    if de and (not name or de in name):
        return de
    return re.split(r"\s+-\s+|\s*/\s*", name)[0].strip() or None


def gleicher_ort(name: str) -> str:
    """Schreibweisen eines Ortes gleich machen: „St. Ingbert“ und „Sankt Ingbert“. (Aus PR #11.)"""
    return re.sub(r"\bsankt\s+|\bst\.?\s+", "st. ", str(name or "").casefold()).strip()


def _orte_kaesten(points: List[dict], cum: List[float]) -> List[tuple]:
    """Rechtecke (s, w, n, e) der Strecke in Abschnitten von ORTE_KASTEN_M — OHNE Rand (den setzt die Abfrage je Art)."""
    kaesten = []
    i, n = 0, len(points)
    while i < n - 1:
        j = i
        while j < n - 1 and cum[j] - cum[i] < ORTE_KASTEN_M:
            j += 1
        seg = points[i:j + 1]
        la = [float(p["lat"]) for p in seg]
        lo = [float(p["lon"]) for p in seg]
        kaesten.append((min(la), min(lo), max(la), max(lo)))
        i = j
    return kaesten


def _kasten_rand(k: tuple, rand_m: float) -> str:
    s, w, n, e = k
    dlat = rand_m / 111_320.0
    dlon = rand_m / (111_320.0 * max(0.2, math.cos(math.radians(max(abs(s), abs(n))))))
    return f"({s - dlat:.5f},{w - dlon:.5f},{n + dlat:.5f},{e + dlon:.5f})"


def orte_abfrage(kaesten: List[tuple]) -> str:
    """Overpass-QL für mehrere Kästen in EINER Anfrage: Städte (city/town) mit 5 km Rand, Dörfer mit 1,5 km,
    benannte Pässe mit 200 m. `out body` — bei Knoten heißt das: Lage und Tags (`out tags` ließe die Lage weg)."""
    zeilen = []
    for k in kaesten:
        zeilen.append(f'node["place"~"^(city|town)$"]["name"]{_kasten_rand(k, ORTE_STADT_M)};')
        zeilen.append(f'node["place"="village"]["name"]{_kasten_rand(k, ORTE_DORF_M)};')
        zeilen.append(f'node["mountain_pass"="yes"]["name"]{_kasten_rand(k, ORTE_PASS_M + 50)};')
    return f"[out:json][timeout:{ORTE_TIMEOUT_S}];(" + "".join(zeilen) + ");out body qt;"


_ORTE_TAGS = ("name", "name:de", "place", "mountain_pass", "ele")


def _orte_knappe_elemente(antwort: dict) -> List[dict]:
    """Nur was die Auswertung braucht (der Cache bleibt klein): id, lat, lon, ausgewählte Tags."""
    out = []
    for el in (antwort or {}).get("elements") or []:
        if el.get("type", "node") != "node" or el.get("lat") is None or el.get("lon") is None:
            continue
        tags = el.get("tags") or {}
        out.append({"id": el.get("id"), "lat": float(el["lat"]), "lon": float(el["lon"]),
                    "tags": {k: tags[k] for k in _ORTE_TAGS if k in tags}})
    return out


def _orte_cache_lesen(pfad: Optional[Path], key: str) -> Optional[list]:
    if not pfad:
        return None
    with _ORTE_CACHE_LOCK:
        try:
            v = (json.loads(Path(pfad).read_text(encoding="utf-8")) or {}).get(key)
        except Exception:  # noqa: BLE001 — fehlende/kaputte Datei = kein Treffer
            return None
    if not (isinstance(v, dict) and isinstance(v.get("v"), list)):
        return None
    if time.time() - float(v.get("t") or 0) > ORTE_CACHE_MAX_S:
        return None
    return v["v"]


def _orte_cache_schreiben(pfad: Optional[Path], key: str, elemente: list) -> None:
    """Eintrag dazu; Abgelaufenes fliegt raus, und es bleiben höchstens ORTE_CACHE_MAX Einträge (die neuesten).
    Eigener, eindeutiger Temp-Name je Schreibvorgang (zwei Fenster schrieben sonst in dieselbe .tmp)."""
    if not pfad:
        return
    pfad = Path(pfad)
    with _ORTE_CACHE_LOCK:
        tmp = None
        try:
            try:
                cache = json.loads(pfad.read_text(encoding="utf-8")) if pfad.is_file() else {}
                if not isinstance(cache, dict):
                    cache = {}
            except Exception:  # noqa: BLE001
                cache = {}
            jetzt = time.time()
            cache[key] = {"t": jetzt, "v": elemente}
            cache = {k: v for k, v in cache.items()
                     if isinstance(v, dict) and jetzt - float(v.get("t") or 0) <= ORTE_CACHE_MAX_S}
            if len(cache) > ORTE_CACHE_MAX:
                neueste = sorted(cache, key=lambda k: float(cache[k].get("t") or 0), reverse=True)[:ORTE_CACHE_MAX]
                cache = {k: cache[k] for k in neueste}
            pfad.parent.mkdir(parents=True, exist_ok=True)
            tmp = pfad.with_name(f"{pfad.name}.{os.getpid()}.{uuid.uuid4().hex[:8]}.tmp")
            tmp.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
            _ds.ersetzen(tmp, pfad, "orte_cache", art=_ds.ART_CACHE)
            tmp = None
        except Exception as e:  # noqa: BLE001
            log.warning("Orte-Cache: %s", e)
        finally:
            if tmp is not None:
                try:
                    _ds.loeschen(tmp, "orte_cache:tmp", art=_ds.ART_CACHE)
                except Exception:  # noqa: BLE001 — eine liegengebliebene .tmp stört niemanden
                    pass


class _TrackRaster:
    """Trackpunkte in einem Gitter (Zellen ORTE_ZELLE_M) — „welche Punkte liegen im Radius um diesen Ort?“, ohne
    jeden Punkt der Strecke anzufassen (500 km mit 50 000 Punkten × ein paar tausend Orte)."""

    def __init__(self, points: List[dict]):
        self.lat = [float(p["lat"]) for p in points]
        self.lon = [float(p["lon"]) for p in points]
        cos_min = max(0.05, math.cos(math.radians(max(abs(x) for x in self.lat))))
        self.zl = ORTE_ZELLE_M / 111_320.0                 # Zellhöhe in Grad
        self.zo = ORTE_ZELLE_M / (111_320.0 * cos_min)     # Zellbreite am polnächsten Punkt gerechnet: deckt überall ab
        self.zellen: dict = {}
        for i, (la, lo) in enumerate(zip(self.lat, self.lon)):
            self.zellen.setdefault((int(math.floor(la / self.zl)), int(math.floor(lo / self.zo))), []).append(i)

    def im_radius(self, lat: float, lon: float, radius_m: float) -> List[tuple]:
        """[(Index, Abstand m)] aller Punkte bis `radius_m`, nach Index sortiert."""
        r = int(math.ceil(radius_m / ORTE_ZELLE_M))
        zy, zx = int(math.floor(lat / self.zl)), int(math.floor(lon / self.zo))
        kx = 111_320.0 * math.cos(math.radians(lat))
        out = []
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                for i in self.zellen.get((zy + dy, zx + dx), ()):
                    d = math.hypot((self.lon[i] - lon) * kx, (self.lat[i] - lat) * 111_320.0)
                    if d <= radius_m:
                        out.append((i, d))
        out.sort()
        return out


def _durchfahrten(treffer: List[tuple], cum: List[float], luecke_m: float) -> List[tuple]:
    """Treffer (Index, Abstand) in Durchfahrten teilen: liegt zwischen zwei Treffern mehr als `luecke_m` Strecke, ist es
    eine neue Durchfahrt. Je Durchfahrt der nächste Punkt. Höchstens ORTE_MAX_DURCHFAHRTEN (die nächsten)."""
    gruppen: List[tuple] = []
    best = None
    vorher = None
    for i, d in treffer:
        if vorher is not None and cum[i] - cum[vorher] > luecke_m:
            gruppen.append(best)
            best = None
        if best is None or d < best[1]:
            best = (i, d)
        vorher = i
    if best is not None:
        gruppen.append(best)
    if len(gruppen) > ORTE_MAX_DURCHFAHRTEN:
        gruppen = sorted(sorted(gruppen, key=lambda g: g[1])[:ORTE_MAX_DURCHFAHRTEN])
    return gruppen


def _orte_auswerten(points: List[dict], cum: List[float], knoten: dict) -> List[dict]:
    if not knoten:
        return []
    raster = _TrackRaster(points)
    ges = cum[-1] or 1.0
    roh = []
    for nid, kn in knoten.items():
        tags = kn.get("tags") or {}
        if tags.get("mountain_pass") == "yes":
            art, rang, radius = "pass", ORTE_PASS_RANG, ORTE_PASS_M
        elif tags.get("place") in ORTE_PLACE:
            art, rang, radius = ORTE_PLACE[tags["place"]]
        else:
            continue
        name = lokaler_name(tags)
        if not name:
            continue
        ele = None
        if art == "pass":
            m = re.search(r"\d+(?:[.,]\d+)?", str(tags.get("ele") or ""))
            ele = float(m.group().replace(",", ".")) if m else None
        treffer = raster.im_radius(float(kn["lat"]), float(kn["lon"]), radius)
        for idx, _d in _durchfahrten(treffer, cum, max(3000.0, radius)):
            q = points[idx]
            d = _haversine_m(float(kn["lat"]), float(kn["lon"]), float(q["lat"]), float(q["lon"]))
            dm = q.get("dist_m")
            roh.append({"art": art, "rang": rang, "name": name, "lat": float(kn["lat"]), "lon": float(kn["lon"]), "ele": ele,
                        "osm_id": nid, "place": tags.get("place") or "", "idx": idx, "frac": cum[idx] / ges,
                        "strecke_m": round(float(dm) if dm is not None else cum[idx], 1), "abstand_m": round(d)})
    # Doppelte: gleicher Name (auch „St.“/„Sankt“) an derselben Stelle der Strecke — z. B. ein Ort als town UND village
    # eingetragen. Der wichtigere (Pass vor Stadt vor Dorf), dann der nähere bleibt. Gleichnamige Orte weiter
    # auseinander (zwei „Neustadt“) bleiben beide.
    roh.sort(key=lambda e: (e["rang"], e["abstand_m"]))
    behalten: List[dict] = []
    for e in roh:
        key = gleicher_ort(e["name"])
        if any(gleicher_ort(b["name"]) == key and abs(b["strecke_m"] - e["strecke_m"]) < ORTE_GLEICH_M for b in behalten):
            continue
        behalten.append(e)
    behalten.sort(key=lambda e: (e["idx"], e["rang"]))
    return behalten


def orte_und_paesse(points: List[dict], *, http: Optional[Callable[[str], dict]] = None,
                    cache_pfad: Optional[Path] = None, pause_s: float = ORTE_PAUSE_S,
                    fortschritt: Optional[Callable[[int, int], None]] = None) -> dict:
    """Städte, Dörfer und Pässe entlang der Strecke: {eintraege, netz, unvollstaendig, anfragen}.
    eintraege = [{art: stadt|dorf|pass, rang, name, lat, lon, ele, osm_id, place, idx, frac, strecke_m, abstand_m}],
    nach Strecke sortiert. `netz` False: Overpass nicht erreichbar (was bis dahin kam, ist dabei). `unvollstaendig`:
    der Server hat eine Antwort abgebrochen (`remark`) — sie wird nicht gemerkt. `anfragen` = gestellte HTTP-Anfragen.
    `fortschritt(i, n)` vor jeder Anfrage (n kann wachsen, wenn eine zu große Anfrage geteilt wird)."""
    pts = [p for p in points if p.get("lat") is not None and p.get("lon") is not None]
    if len(pts) < 2:
        return {"eintraege": [], "netz": True, "unvollstaendig": False, "anfragen": 0}
    cum = _kumuliert(pts)
    kaesten = _orte_kaesten(pts, cum)
    je = max(1, int(round(ORTE_ANFRAGE_M / ORTE_KASTEN_M)))
    auftraege = [kaesten[k:k + je] for k in range(0, len(kaesten), je)]
    abfrage = http or (lambda q: _http_overpass(q, timeout=ORTE_TIMEOUT_S + 5))
    knoten: dict = {}
    netz, unvollstaendig, anfragen = True, False, 0
    i = 0
    while i < len(auftraege):
        teil = auftraege[i]
        if fortschritt:
            try:
                fortschritt(i + 1, len(auftraege))
            except Exception:  # noqa: BLE001 — eine Meldung darf die Suche nie stören
                pass
        q = orte_abfrage(teil)
        key = ORTE_CACHE_VERSION + "|" + hashlib.sha1(q.encode("utf-8")).hexdigest()[:20]
        elemente = _orte_cache_lesen(cache_pfad, key)
        if elemente is None:
            if anfragen and pause_s > 0:
                time.sleep(pause_s)
            anfragen += 1
            try:
                antwort = abfrage(q)
            except Exception as e:  # noqa: BLE001
                log.warning("Orte/Pässe: Overpass nicht erreichbar: %s", e)
                netz = False
                break    # der Server ist weg — nicht jede weitere Anfrage bis zum Zeitlimit warten lassen
            remark = str((antwort or {}).get("remark") or "")
            if remark and len(teil) > 1:
                # Overpass bricht bei Zeit-/Speichergrenze mit HTTP 200 und Teilergebnis ab: in zwei Hälften neu fragen
                log.warning("Orte/Pässe: Antwort unvollständig (%d Kästen), teile: %s", len(teil), remark[:160])
                h = len(teil) // 2
                auftraege[i:i + 1] = [teil[:h], teil[h:]]
                continue
            elemente = _orte_knappe_elemente(antwort)
            if remark:
                # ein einzelner Kasten: das Teilergebnis nehmen, aber nicht merken
                log.warning("Orte/Pässe: Antwort unvollständig: %s", remark[:160])
                unvollstaendig = True
            else:
                _orte_cache_schreiben(cache_pfad, key, elemente)
        for el in elemente:
            knoten.setdefault(el.get("id"), el)
        i += 1
    eintraege = _orte_auswerten(pts, cum, knoten)
    log.info("Orte/Pässe: %d Einträge aus %d Knoten, %d Anfragen (%d Abschnitte), netz=%s, unvollständig=%s",
             len(eintraege), len(knoten), anfragen, len(auftraege), netz, unvollstaendig)
    return {"eintraege": eintraege, "netz": netz, "unvollstaendig": unvollstaendig, "anfragen": anfragen}


def orte_als_vorschlaege(points: List[dict], eintraege: List[dict]) -> List[dict]:
    """Die Einträge als Zeilen fürs Highlights-Fenster (`grund` „orte“): Stadt/Dorf = Name, Pass = „Name\\n2094 m“.
    Alle vorgeschlagen; was davon gleichzeitig zu viel wäre, wählt die Oberfläche nach der Videolänge ab."""
    cum = _kumuliert(points)
    ges = cum[-1] or 1.0
    out = []
    for e in eintraege:
        idx = int(e["idx"])
        out.append({"art": e["art"], "symbol": "", "icon": ORTE_ICON.get(e["art"], "map-pin"), "text": _text(e, {}),
                    "name": e["name"], "lat": float(e["lat"]), "lon": float(e["lon"]), "idx": idx, "frac": cum[idx] / ges,
                    "km": round(cum[idx] / 1000.0, 1), "strecke_m": e.get("strecke_m"), "epoch": _parse_t(points[idx].get("time")),
                    "foto": None, "grund": "orte", "empfohlen": True, "abstand_m": e.get("abstand_m"), "rang": e.get("rang"),
                    "place": e.get("place", "")})
    return out


def ist_ort_dublette(poi: dict, eintraege: List[dict], nah_m: float = 1000.0) -> bool:
    """Ein OSM-Highlight, das schon als Ort/Pass dabei ist: gleicher Name UND höchstens `nah_m` entfernt. Nur der Name
    reicht nicht — ein Gipfel heißt oft wie das Dorf darunter (oder wie ein anderer Gipfel) und ist ein eigenes Ziel."""
    key = gleicher_ort(str(poi.get("name") or ""))
    if not key:
        return False
    return any(gleicher_ort(e["name"]) == key
               and _haversine_m(float(poi["lat"]), float(poi["lon"]), float(e["lat"]), float(e["lon"])) <= nah_m
               for e in eintraege)
