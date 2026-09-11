# -*- coding: utf-8 -*-
"""Highlights entlang eines Tracks → Schilder (Tour-Assistent Stufe 3,
docs/TOUR-ASSISTENT.md §4; Marc 11.09.2026: „lass erst mal nur POIs mit
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

import json
import logging
import math
import urllib.parse
import urllib.request
from typing import Callable, List, Optional

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
MIN_ABSTAND_ANTEIL = 0.03   # zwischen zwei Schildern mindestens 3 % der Strecke
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

    # Höchster Punkt nur, wenn OSM dort keinen Gipfel/Pass kennt
    hp = hoechster_punkt(points)
    if hp is not None:
        eles = [float(p["ele"]) for p in points if p.get("ele") is not None]
        hub = (max(eles) - min(eles)) if eles else 0.0
        frac = cum[hp["idx"]] / ges
        # Nur, wenn die Tour wirklich hinaufgeht (sonst „Höchster Punkt" auf dem
        # Dorfspaziergang), nicht am Rand, und nicht dort, wo OSM schon einen Gipfel kennt.
        if hub >= HUB_MIN_M and 0.05 < frac < 0.95 and not any(
                k.get("art") in ("gipfel", "pass") and abs(k["frac"] - frac) * ges < 300 for k in kand):
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


def _text(p: dict, hoechster_label: str) -> str:
    name = (p.get("name") or "").strip()
    ele = p.get("ele")
    if p.get("art") == "hoechster":
        name = hoechster_label
    if ele is not None and p.get("art") in ("gipfel", "pass", "hoechster", "huette"):
        try:
            return f"{name}\n{int(round(float(ele)))} m"
        except (TypeError, ValueError):
            pass
    return name


def schilder_bauen(gewaehlt: List[dict], *, stil: Optional[dict] = None,
                   hoechster_label: str = "Höchster Punkt",
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


def kurzliste(gewaehlt: List[dict], hoechster_label: str = "Höchster Punkt") -> str:
    teile = []
    for p in gewaehlt:
        nm = hoechster_label if p.get("art") == "hoechster" else (p.get("name") or "")
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
