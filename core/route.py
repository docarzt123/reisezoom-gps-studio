"""
Route-Berechnung für das Animator-„Anreise/Flug"-Feature (v0.9.205).

Zwei Stile, beide liefern eine Punktliste [[lon, lat], …], die als synthetische
GPX-Datei geschrieben und dann wie ein normaler Track animiert wird:

  • "road"  — Mapbox Directions API folgt echten Straßen. `overview=simplified`
              gibt absichtlich eine gröbere Linie (Marc: „nicht so sauber wie
              eine Wanderung"). Profile: driving / walking / cycling.
  • "arc"   — abstrakter Flug-Bogen (quadratische Bézier-Kurve mit seitlichem
              Bauch), KEIN API-Call. Für weite Distanzen / stilisierte Hops.

Zusätzlich Geocoding (Adresse → [lon, lat]) über die Mapbox Geocoding API,
damit Start/Ziel als Text eingegeben werden können statt nur per Karten-Klick.

Kein neues Pip-Paket: HTTP via urllib, GPX-Schreiben via gpxpy (schon da).
"""
from __future__ import annotations

import json
import math
import ssl
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional, Tuple

import gpxpy
import gpxpy.gpx

_MAPBOX_BASE = "https://api.mapbox.com"
_HTTP_TIMEOUT = 20  # Sekunden


# v0.9.261 (Nutzer-Bug) — SSL-CA-Bundle aus `certifi`. Im PyInstaller-Bundle findet
# Pythons OpenSSL die System-Zertifikate NICHT → jeder HTTPS-Call (Mapbox Geocoding +
# Directions) starb mit „CERTIFICATE_VERIFY_FAILED: unable to get local issuer
# certificate". `certifi` ist über `requests` mitgebündelt; sein cacert.pem liegt im
# Bundle und wird hier explizit als CA-Quelle gesetzt. Fallback = System-Default.
# Seit v0.9.496 steht die Logik in core/net.py — sie wurde vorher an drei
# Stellen einzeln gepflegt und fehlte an dreien.
from . import net


def _make_ssl_context() -> "ssl.SSLContext":
    return net.ssl_context()


_SSL_CTX = net.ssl_context()

# Profil-Mapping UI → Mapbox-Directions-Profil
_PROFILES = {
    "driving": "driving",
    "walking": "walking",
    "cycling": "cycling",
    # Aliase falls die UI andere Keys schickt
    "auto": "driving",
    "car": "driving",
    "foot": "walking",
    "bike": "cycling",
}


class RouteError(Exception):
    """Fehler bei Routen-Berechnung/Geocoding (Netzwerk, Token, keine Route)."""


def _http_get_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "ReisezoomGPSStudio"})
    with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT, context=_SSL_CTX) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
    return json.loads(raw)


# ── Geocoding (Adresse → Koordinate) ─────────────────────────────────────────
def geocode(query: str, token: str, *, limit: int = 1) -> List[dict]:
    """Adresse/Ort → Liste von Treffern [{name, lon, lat}]. Leere Liste wenn
    nichts gefunden. Wirft RouteError nur bei Netzwerk-/Token-Problemen."""
    q = (query or "").strip()
    if not q:
        return []
    if not token:
        raise RouteError("Mapbox-Token nicht konfiguriert")
    enc = urllib.parse.quote(q)
    url = (
        f"{_MAPBOX_BASE}/geocoding/v5/mapbox.places/{enc}.json"
        f"?limit={max(1, min(10, limit))}&language=de&access_token={token}"
    )
    try:
        data = _http_get_json(url)
    except Exception as e:  # noqa: BLE001
        raise RouteError(f"Geocoding fehlgeschlagen: {e}") from e
    out: List[dict] = []
    for feat in data.get("features", []):
        center = feat.get("center")
        if isinstance(center, list) and len(center) == 2:
            out.append({
                "name": feat.get("place_name") or feat.get("text") or q,
                "lon": float(center[0]),
                "lat": float(center[1]),
            })
    return out


def geocode_photon(query: str, *, limit: int = 1, lang: str = "de",
                   bias: Optional[Tuple[float, float]] = None) -> List[dict]:
    """Ort → Treffer über Photon (Komoot, OpenStreetMap-Daten, kein Token).
    07.09.2026 (Marc: „Berlin–Teneriffa fliegt einmal um die Welt"): Mapbox kennt
    deutsche Ortsnamen wie „Teneriffa", „Kapstadt" nicht und lieferte Teneriffe in
    Queensland. Photon versteht die Landessprache (de/en/fr/it) und findet die Insel.
    `bias` = (lon, lat) eines schon aufgelösten Wegpunkts: bevorzugt nahe Treffer.
    Liste [{name, lon, lat}], leer wenn nichts gefunden; RouteError bei Netzproblemen."""
    q = (query or "").strip()
    if not q:
        return []
    plang = lang if lang in ("de", "en", "fr", "it") else "en"
    params = {"q": q, "lang": plang, "limit": max(1, min(10, int(limit)))}
    if bias and len(bias) == 2:
        params["lon"] = f"{float(bias[0]):.5f}"; params["lat"] = f"{float(bias[1]):.5f}"
    try:
        data = _http_get_json("https://photon.komoot.io/api/?" + urllib.parse.urlencode(params))
    except Exception as e:  # noqa: BLE001
        raise RouteError(f"Geocoding (Photon) fehlgeschlagen: {e}") from e
    out: List[dict] = []
    seen = set()
    for feat in data.get("features", []) or []:
        geom = feat.get("geometry") or {}
        c = geom.get("coordinates")
        p = feat.get("properties") or {}
        if not (isinstance(c, list) and len(c) == 2):
            continue
        teile = [p.get("name") or q]
        for k in ("city", "state", "country"):
            v = p.get(k)
            if v and v not in teile:
                teile.append(v)
        name = ", ".join(teile)
        key = (name, round(float(c[0]), 3), round(float(c[1]), 3))
        if key in seen:
            continue
        seen.add(key)
        out.append({"name": name, "lon": float(c[0]), "lat": float(c[1])})
    return out


# ── Freie Router: OSRM (Auto, unbegrenzt) + Valhalla (Fuß/Rad, FOSSGIS) ──────
# 07.09.2026 (Marc: „wir sollten generell alles ohne mapbox machen"): Straßenroute,
# „Strecke A→B" und Map-Matching laufen zuerst über tokenfreie OpenStreetMap-Dienste,
# Mapbox nur noch als Rückfall, wenn ein Token hinterlegt ist.
#  • OSRM-Demo (router.project-osrm.org): nur das Auto-Profil (bike/foot liefern dort
#    dasselbe wie driving), keine Distanzgrenze, Map-Matching auf dem Straßennetz.
#  • Valhalla (valhalla1.openstreetmap.de, FOSSGIS e. V.): pedestrian ≤ 100 km,
#    bicycle ≤ 150 km, auto; trace_route = Map-Matching auf Wegen (auch Wanderwege).
# Beide sind „fair use" (keine Massenabfragen) — die App fragt je Klick einmal.
_OSRM_BASE = "https://router.project-osrm.org"
_VALHALLA_BASE = "https://valhalla1.openstreetmap.de"
_VALHALLA_COSTING = {"driving": "auto", "walking": "pedestrian", "cycling": "bicycle"}
_VALHALLA_MAX_M = {"pedestrian": 100_000.0, "bicycle": 150_000.0, "auto": 0.0}   # 0 = keine Grenze
_OSRM_SNAP_MAX_M = 5_000.0   # Wegpunkt weiter als 5 km von jeder Straße → kein Weg


def _http_post_json(url: str, body: dict) -> dict:
    req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"),
                                 headers={"User-Agent": "ReisezoomGPSStudio", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT, context=_SSL_CTX) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
    return json.loads(raw)


def _decode_polyline(s: str, precision: int = 6) -> List[List[float]]:
    """Google-Polyline → [[lon, lat], …]; Valhalla nutzt Präzision 1e6."""
    out: List[List[float]] = []
    idx = lat = lon = 0
    faktor = 10 ** precision
    n = len(s)
    while idx < n:
        for which in (0, 1):
            shift = result = 0
            while True:
                if idx >= n:
                    return out
                b = ord(s[idx]) - 63; idx += 1
                result |= (b & 0x1F) << shift; shift += 5
                if b < 0x20:
                    break
            d = ~(result >> 1) if (result & 1) else (result >> 1)
            if which == 0:
                lat += d
            else:
                lon += d
        out.append([lon / faktor, lat / faktor])
    return out


def _luftlinie_m(pts) -> float:
    return sum(_haversine_m(a[1], a[0], b[1], b[0]) for a, b in zip(pts, pts[1:]))


def _route_osrm(pts, profile: str) -> dict:
    coord_str = ";".join(f"{lon:.6f},{lat:.6f}" for lon, lat in pts)
    url = f"{_OSRM_BASE}/route/v1/driving/{coord_str}?geometries=geojson&overview=full"
    try:
        data = _http_get_json(url)
    except Exception as e:  # noqa: BLE001
        raise RouteError(f"OSRM nicht erreichbar: {e}") from e
    code = data.get("code")
    if code != "Ok":
        if code == "NoRoute":
            raise RouteError("no_route")
        raise RouteError(f"OSRM: {data.get('message') or code}")
    # OSRM snappt jeden Punkt auf die nächste Straße, egal wie weit (Mapbox meldete
    # dann NoRoute): liegt ein Wegpunkt weiter als _OSRM_SNAP_MAX_M vom Netz weg
    # (Meer, Wildnis), gilt das als „kein Weg" — sonst käme ein sinnloser Stummel.
    for wp in data.get("waypoints") or []:
        try:
            if float(wp.get("distance") or 0.0) > _OSRM_SNAP_MAX_M:
                raise RouteError("no_route")
        except (TypeError, ValueError):
            pass
    r0 = (data.get("routes") or [None])[0] or {}
    coords = [[float(c[0]), float(c[1])] for c in ((r0.get("geometry") or {}).get("coordinates") or []) if len(c) >= 2]
    if len(coords) < 2:
        raise RouteError("no_route")
    return {"coords": coords, "distance_m": float(r0.get("distance") or 0.0),
            "duration_s": float(r0.get("duration") or 0.0), "provider": "osrm"}


def _route_valhalla(pts, profile: str) -> dict:
    costing = _VALHALLA_COSTING.get(profile, "auto")
    grenze = _VALHALLA_MAX_M.get(costing, 0.0)
    if grenze and _luftlinie_m(pts) > grenze:
        raise RouteError("zu_weit")
    body = {"locations": [{"lon": lon, "lat": lat} for lon, lat in pts], "costing": costing, "units": "kilometers"}
    try:
        data = _http_post_json(f"{_VALHALLA_BASE}/route", body)
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read().decode("utf-8", "replace"))
        except Exception:  # noqa: BLE001
            msg = {}
        ec = msg.get("error_code")
        if ec in (442, 154, 171, 172):     # kein Weg / zu weit / Ortung fehlgeschlagen
            raise RouteError("no_route" if ec == 442 else "zu_weit") from e
        raise RouteError(f"Valhalla: {msg.get('error') or e}") from e
    except Exception as e:  # noqa: BLE001
        raise RouteError(f"Valhalla nicht erreichbar: {e}") from e
    trip = data.get("trip") or {}
    coords: List[List[float]] = []
    for leg in trip.get("legs") or []:
        seg = _decode_polyline(leg.get("shape") or "", 6)
        if coords and seg:
            seg = seg[1:]
        coords.extend(seg)
    if len(coords) < 2:
        raise RouteError("no_route")
    s = trip.get("summary") or {}
    return {"coords": coords, "distance_m": float(s.get("length") or 0.0) * 1000.0,
            "duration_s": float(s.get("time") or 0.0), "provider": "valhalla"}


def _route_mapbox(pts, prof: str, token: str) -> dict:
    coord_str = ";".join(f"{lon},{lat}" for lon, lat in pts)
    url = (f"{_MAPBOX_BASE}/directions/v5/mapbox/{prof}/{coord_str}"
           f"?geometries=geojson&overview=full&access_token={token}")
    try:
        data = _http_get_json(url)
    except Exception as e:  # noqa: BLE001
        raise RouteError(f"Directions-Anfrage fehlgeschlagen: {e}") from e
    code = data.get("code")
    if code != "Ok":
        if code == "NoRoute":
            raise RouteError("no_route")
        raise RouteError(f"Keine Route gefunden ({data.get('message') or code or 'Unbekannter Fehler'})")
    r0 = (data.get("routes") or [None])[0] or {}
    coords = [[float(c[0]), float(c[1])] for c in ((r0.get("geometry") or {}).get("coordinates") or []) if len(c) >= 2]
    if len(coords) < 2:
        raise RouteError("Route enthält zu wenige Punkte")
    return {"coords": coords, "distance_m": float(r0.get("distance") or 0.0),
            "duration_s": float(r0.get("duration") or 0.0), "provider": "mapbox"}


def route_geometry(pts, profile: str, token: str = "", *, provider: str = "auto") -> dict:
    """Rohe Straßen-/Wege-Geometrie durch `pts` — freie Dienste zuerst, Mapbox nur mit
    Token als Rückfall (oder zuerst bei provider="mapbox"). Wirft RouteError("no_route"),
    wenn keiner einen Weg kennt."""
    prof = _PROFILES.get((profile or "driving").lower(), "driving")
    kette = ["valhalla", "osrm"] if prof in ("walking", "cycling") else ["osrm", "valhalla"]
    if token:
        kette = ["mapbox"] + kette if provider == "mapbox" else kette + ["mapbox"]
    letzter: Optional[Exception] = None
    for p in kette:
        try:
            if p == "osrm":
                return _route_osrm(pts, prof)
            if p == "valhalla":
                return _route_valhalla(pts, prof)
            return _route_mapbox(pts, prof, token)
        except RouteError as e:
            letzter = e
            continue
    raise letzter or RouteError("no_route")


# ── Straßen-Route via Mapbox Directions ──────────────────────────────────────
# Maximale Vereinfachungs-Toleranz (Douglas-Peucker) in Grad bei coarseness=1.
# v0.9.213 — von 0.006 (~600 m) auf 0.06 (~6 km) angehoben, damit „grob" bis
# fast-gerade gehen kann (Marc: „grob kann noch viel gröber"). Die Animation
# bleibt durch das Nachverdichten trotzdem flüssig.
_MAX_SIMPLIFY_DEG = 0.06
# Zielanzahl Punkte nach dem Nachverdichten — genug für flüssige Animation
# (Marker gleitet statt zu springen), unter dem 800er-Downsample der GPX-Pipeline.
_SMOOTH_POINTS = 500


def road_route(
    waypoints: List[Tuple[float, float]],
    token: str = "",
    *,
    profile: str = "driving",
    grob: bool = True,
    coarseness: Optional[float] = None,
    provider: str = "auto",
) -> dict:
    """Berechnet eine Straßen-Route durch alle `waypoints` ([lon, lat]).

    Returns {"coords": [[lon,lat],…], "distance_m": float, "duration_s": float}.

    `coarseness` (0..1) steuert die **optische** Grobheit: 0 = fein (folgt jeder
    Kurve), 1 = stark vereinfacht (fast gerade Etappen). Unabhängig davon wird die
    Linie IMMER auf ~`_SMOOTH_POINTS` Punkte nachverdichtet → flüssige Animation
    auch bei grober Form (löst das „Ruckeln"). `grob` ist der Alt-Fallback wenn
    `coarseness` None: True→0.55, False→0.1. Mind. 2 Wegpunkte, max 25.
    """
    pts = [(float(lon), float(lat)) for lon, lat in waypoints]
    if len(pts) < 2:
        raise RouteError("Mindestens Start und Ziel nötig")
    if len(pts) > 25:
        raise RouteError("Maximal 25 Wegpunkte")
    if coarseness is None:
        coarseness = 0.55 if grob else 0.1
    coarseness = max(0.0, min(1.0, float(coarseness)))
    # IMMER volle Geometrie holen — wir simplifizieren selbst (volle Kontrolle über die
    # Grobheit via Slider). 07.09.2026: freie Router zuerst (OSRM/Valhalla), Mapbox nur
    # mit Token als Rückfall; „no_route" bleibt der stabile Code fürs Frontend
    # (v0.9.392: Rad-/Fußprofile haben Streckengrenzen — Valhalla 100/150 km, dann OSRM).
    r0 = route_geometry(pts, profile, token, provider=provider)
    coords = r0["coords"]
    # 1) optisch vereinfachen (Douglas-Peucker, Toleranz aus coarseness) — legt
    #    fest, WIE grob die Stützpunkte werden.
    if coarseness > 0:
        coords = _simplify_dp(coords, coarseness * _MAX_SIMPLIFY_DEG)
    # 2) GESCHWUNGENE Linie durch die Stützpunkte (Catmull-Rom-Spline) statt
    #    eckiger Geraden — fließende Kurve, die sich grob an der Route orientiert.
    #    Verdichtet gleichzeitig auf viele Punkte → flüssige Animation.
    coords = _catmull_rom(coords, _SMOOTH_POINTS)
    return {
        "coords": coords,
        "distance_m": float(r0.get("distance_m") or 0.0),
        "duration_s": float(r0.get("duration_s") or 0.0),
        "provider": r0.get("provider"),
    }


# ── Geometrie-Helfer: Vereinfachen (Douglas-Peucker) + Nachverdichten ─────────
def _perp_dist(p, a, b) -> float:
    """Senkrechter Abstand Punkt p von der Strecke a→b (in Grad-Ebene)."""
    ax, ay = a[0], a[1]; bx, by = b[0], b[1]; px, py = p[0], p[1]
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    cx, cy = ax + t * dx, ay + t * dy
    return math.hypot(px - cx, py - cy)


def _simplify_dp(coords: List[List[float]], tol: float) -> List[List[float]]:
    """Douglas-Peucker-Vereinfachung. `tol` = max. Querabweichung in Grad.
    Iterativ (kein Rekursions-Limit bei langen Routen)."""
    if tol <= 0 or len(coords) < 3:
        return coords
    keep = [False] * len(coords)
    keep[0] = keep[-1] = True
    stack = [(0, len(coords) - 1)]
    while stack:
        i0, i1 = stack.pop()
        if i1 <= i0 + 1:
            continue
        dmax, idx = 0.0, -1
        for i in range(i0 + 1, i1):
            d = _perp_dist(coords[i], coords[i0], coords[i1])
            if d > dmax:
                dmax, idx = d, i
        if dmax > tol and idx != -1:
            keep[idx] = True
            stack.append((i0, idx))
            stack.append((idx, i1))
    out = [c for c, k in zip(coords, keep) if k]
    return out if len(out) >= 2 else coords


def _catmull_rom(points: List[List[float]], total: int) -> List[List[float]]:
    """Geschwungene Linie: Catmull-Rom-Spline DURCH die `points` (Stützstellen).
    Erzeugt fließende Kurven statt eckiger Geraden — die Linie folgt grob der
    Route. `total` ≈ Zielanzahl Ausgabe-Punkte (gleichmäßig über die Segmente)."""
    pts = [[float(p[0]), float(p[1])] for p in points]
    n = len(pts)
    if n < 3:
        return _densify(pts, total)
    # Phantom-Endpunkte (Anfang/Ende verdoppeln), damit der Spline durch den
    # ersten und letzten echten Punkt läuft.
    P = [pts[0]] + pts + [pts[-1]]
    segs = n - 1
    per = max(2, int(round(total / segs)))
    out: List[List[float]] = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for k in range(per):
            t = k / per
            t2 = t * t
            t3 = t2 * t
            x = 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t
                       + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2
                       + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3)
            y = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t
                       + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2
                       + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
            out.append([x, y])
    out.append([pts[-1][0], pts[-1][1]])
    return out


def _densify(coords: List[List[float]], n: int) -> List[List[float]]:
    """Verteilt `n` Punkte gleichmäßig (nach Streckenlänge) entlang der Linie →
    flüssige Marker-Bewegung auch bei wenigen Stützstellen."""
    if n <= 2 or len(coords) < 2:
        return coords
    cum = [0.0]
    for a, b in zip(coords, coords[1:]):
        cum.append(cum[-1] + _haversine_m(a[1], a[0], b[1], b[0]))
    total = cum[-1]
    if total <= 0:
        return coords
    out: List[List[float]] = []
    seg = 0
    for i in range(n):
        d = total * i / (n - 1)
        while seg < len(cum) - 2 and cum[seg + 1] < d:
            seg += 1
        seg_len = cum[seg + 1] - cum[seg]
        t = 0.0 if seg_len <= 0 else (d - cum[seg]) / seg_len
        a, b = coords[seg], coords[seg + 1]
        out.append([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    return out


# ── Flug-Bogen (abstrakt, ohne API) ──────────────────────────────────────────
def _haversine_m(lat1, lon1, lat2, lon2) -> float:
    R = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _great_circle_points(lon0, lat0, lon1, lat1, n):
    """N+1 Punkte auf dem Großkreis (Orthodrome) von (lon0,lat0) nach
    (lon1,lat1), inklusive beider Endpunkte. Sphärische Interpolation (slerp):
    der kürzeste Weg auf der Kugel — wölbt sich auf der flachen Mercator-Karte
    automatisch zum Pol hin ('oben rum' bei Langstrecke). v0.9.251."""
    φ1, λ1 = math.radians(lat0), math.radians(lon0)
    φ2, λ2 = math.radians(lat1), math.radians(lon1)
    # Winkeldistanz (Haversine) zwischen den beiden Punkten.
    h = math.sin((φ2 - φ1) / 2) ** 2 + math.cos(φ1) * math.cos(φ2) * math.sin((λ2 - λ1) / 2) ** 2
    d = 2 * math.asin(min(1.0, math.sqrt(h)))
    out: List[List[float]] = []
    if d < 1e-12:
        return [[lon0, lat0], [lon1, lat1]]
    sind = math.sin(d)
    prev_lon = None
    for k in range(n + 1):
        f = k / n
        A = math.sin((1 - f) * d) / sind
        B = math.sin(f * d) / sind
        x = A * math.cos(φ1) * math.cos(λ1) + B * math.cos(φ2) * math.cos(λ2)
        y = A * math.cos(φ1) * math.sin(λ1) + B * math.cos(φ2) * math.sin(λ2)
        z = A * math.sin(φ1) + B * math.sin(φ2)
        lat = math.degrees(math.atan2(z, math.hypot(x, y)))
        lon = math.degrees(math.atan2(y, x))
        # Antimeridian-Entwicklung: Längengrad-Sprünge > 180° glätten, damit die
        # Linie nicht quer über die ganze Karte gezogen wird (Mapbox wrappt das).
        if prev_lon is not None:
            while lon - prev_lon > 180:
                lon -= 360
            while lon - prev_lon < -180:
                lon += 360
        prev_lon = lon
        out.append([lon, lat])
    return out


def arc_route(
    waypoints: List[Tuple[float, float]],
    *,
    n_points: int = 120,
    bulge: float = 0.18,  # v0.9.251 — ungenutzt (Großkreis braucht keinen Bauch)
) -> dict:
    """Flug-Route als echter **Großkreis** (Orthodrome) durch die Wegpunkte —
    der kürzeste Weg auf der Kugel, genau wie echte Langstreckenflüge. Auf der
    Mercator-Karte wölbt er sich korrekt polwärts ('oben rum'). KEIN API-Call.
    (Vor v0.9.251 war das eine flache Bézier-Kurve → unrealistisch 'unten rum'.)

    Returns {"coords": …, "distance_m": …, "duration_s": 0.0}.
    """
    pts = [(float(lon), float(lat)) for lon, lat in waypoints]
    if len(pts) < 2:
        raise RouteError("Mindestens Start und Ziel nötig")
    seg_count = len(pts) - 1
    per_seg = max(16, int(n_points / seg_count))
    coords: List[List[float]] = []
    for i in range(seg_count):
        lon0, lat0 = pts[i]
        lon1, lat1 = pts[i + 1]
        seg = _great_circle_points(lon0, lat0, lon1, lat1, per_seg)
        for k, c in enumerate(seg):
            if coords and k == 0:
                continue  # doppelte Vertices an Segmentgrenzen vermeiden
            coords.append(c)
    # Distanz aus der erzeugten Linie (für Stats).
    dist = 0.0
    for a, b in zip(coords, coords[1:]):
        dist += _haversine_m(a[1], a[0], b[1], b[0])
    return {"coords": coords, "distance_m": dist, "duration_s": 0.0}


# ── Directions zwischen 2 Punkten (für GPX-Inspektor „Strecke A→B") ───────────
def directions_geometry(
    a: List[float],
    b: List[float],
    token: str = "",
    *,
    profile: str = "walking",
    provider: str = "auto",
) -> dict:
    """Reine Straßen-/Wege-Route zwischen genau zwei Punkten (Directions, overview=full).
    Anders als Map Matching kennt das KEIN 50-m-Limit: A und B werden auf die nächste
    Straße gesnappt, dazwischen wird geroutet — egal wie weit die GPS-Spur gedriftet ist.
    Liefert die rohe Wege-Geometrie (keine Vereinfachung/Glättung).

    Returns {"coords": [[lon,lat], …], "matched": bool}. `matched`=False = keine Route
    gefunden (z.B. A/B zu weit weg von jeder Straße).
    """
    pts = [(float(a[0]), float(a[1])), (float(b[0]), float(b[1]))]
    try:
        r = route_geometry(pts, profile, token, provider=provider)
    except RouteError as e:
        if str(e) in ("no_route", "zu_weit"):
            return {"coords": [], "matched": False}
        raise
    return {"coords": r["coords"], "matched": True, "provider": r.get("provider")}


# ── Map Matching (Track auf Straßen/Wege snappen) ────────────────────────────
# Mapbox Map Matching API: nimmt eine (verrauschte) GPS-Spur und legt sie auf das
# Wege-/Straßennetz. Limit: 100 Koordinaten pro Request → längere Tracks werden in
# überlappende Fenster zerteilt und die gematchten Geometrien wieder aneinandergefügt.
_MATCH_MAX = 100          # Mapbox-Hardlimit pro Request
_MATCH_OVERLAP = 2        # Überlappung zwischen Chunks für nahtlosere Übergänge
# Such-Radius pro Punkt (Meter). Default der API ist ~5 m → driftet die Spur weiter
# weg vom Weg, kommt „NoMatch" und nichts wird gesnappt. 25 m gibt Spielraum für
# verrauschtes GPS, ohne gleich auf eine parallele Straße zu springen. (Mapbox-Max 50.)
_MATCH_RADIUS_M = 25


def _match_chunk_mapbox(coords, token: str, profile: str, r: int):
    coord_str = ";".join(f"{c[0]:.6f},{c[1]:.6f}" for c in coords)
    radiuses = ";".join(str(r) for _ in coords)
    url = (f"{_MAPBOX_BASE}/matching/v5/mapbox/{profile}/{coord_str}"
           f"?geometries=geojson&overview=full&tidy=true&radiuses={radiuses}&access_token={token}")
    try:
        data = _http_get_json(url)
    except Exception as e:  # noqa: BLE001
        raise RouteError(f"Map-Matching fehlgeschlagen: {e}") from e
    if data.get("code") != "Ok" or not data.get("matchings"):
        return list(coords), False
    out = ((data["matchings"][0] or {}).get("geometry") or {}).get("coordinates") or []
    return ([[float(p[0]), float(p[1])] for p in out], True) if len(out) >= 2 else (list(coords), False)


def _match_chunk_osrm(coords, r: int):
    coord_str = ";".join(f"{c[0]:.6f},{c[1]:.6f}" for c in coords)
    radiuses = ";".join(str(r) for _ in coords)
    url = f"{_OSRM_BASE}/match/v1/driving/{coord_str}?geometries=geojson&overview=full&tidy=true&radiuses={radiuses}"
    try:
        data = _http_get_json(url)
    except Exception as e:  # noqa: BLE001
        raise RouteError(f"OSRM-Matching nicht erreichbar: {e}") from e
    if data.get("code") != "Ok" or not data.get("matchings"):
        return list(coords), False
    out: List[List[float]] = []
    for m in data["matchings"]:      # bei Lücken liefert OSRM mehrere Teilstücke
        seg = ((m or {}).get("geometry") or {}).get("coordinates") or []
        out.extend([[float(p[0]), float(p[1])] for p in seg])
    return (out, True) if len(out) >= 2 else (list(coords), False)


def _match_chunk_valhalla(coords, profile: str, r: int):
    costing = _VALHALLA_COSTING.get(profile, "pedestrian")
    body = {"shape": [{"lon": c[0], "lat": c[1]} for c in coords], "costing": costing,
            "shape_match": "map_snap", "trace_options": {"search_radius": int(r)}}
    try:
        data = _http_post_json(f"{_VALHALLA_BASE}/trace_route", body)
    except urllib.error.HTTPError:
        return list(coords), False        # 400 = kein Match möglich (zu weit weg vom Wegenetz)
    except Exception as e:  # noqa: BLE001
        raise RouteError(f"Valhalla-Matching nicht erreichbar: {e}") from e
    out: List[List[float]] = []
    for leg in (data.get("trip") or {}).get("legs") or []:
        seg = _decode_polyline(leg.get("shape") or "", 6)
        if out and seg:
            seg = seg[1:]
        out.extend(seg)
    return (out, True) if len(out) >= 2 else (list(coords), False)


def _match_chunk(coords: List[List[float]], token: str, profile: str, radius_m: int = _MATCH_RADIUS_M,
                 provider: str = "auto"):
    """Ein Fenster (≤100 Punkte) matchen → (coords, ok). Bei „NoMatch" werden die
    EINGANGS-Koordinaten zurückgegeben (Track reißt nicht ab) und ok=False.
    07.09.2026: Valhalla (Wegenetz inkl. Wanderwege) zuerst, dann OSRM (Straßennetz),
    Mapbox nur mit Token als Rückfall."""
    if len(coords) < 2:
        return list(coords), False
    r = max(1, min(50, int(radius_m)))
    kette = ["valhalla", "osrm"] + (["mapbox"] if token else [])
    if token and provider == "mapbox":
        kette = ["mapbox", "valhalla", "osrm"]
    letzter: Optional[Exception] = None
    for p in kette:
        try:
            if p == "valhalla":
                out, ok = _match_chunk_valhalla(coords, profile, r)
            elif p == "osrm":
                out, ok = _match_chunk_osrm(coords, r)
            else:
                out, ok = _match_chunk_mapbox(coords, token, profile, r)
        except RouteError as e:
            letzter = e
            continue
        if ok:
            return out, True
    if letzter is not None and len(kette) == 1:
        raise letzter
    return list(coords), False


def map_match(
    coords: List[List[float]],
    token: str = "",
    *,
    profile: str = "walking",
    radius_m: int = _MATCH_RADIUS_M,
    provider: str = "auto",
) -> dict:
    """Eine Koordinaten-Spur [[lon,lat], …] auf das Wegenetz matchen.

    `radius_m` = Such-Radius pro Punkt (1–50 m). Größer = fängt mehr Drift, snapt aber
    eher auf parallele Wege. Returns {"coords": …, "matched": bool}. `matched`=False
    heißt, KEIN Stück konnte gesnappt werden. Wirft RouteError bei Token-/Netzfehler.
    """
    prof = _PROFILES.get(str(profile or "walking"), "walking")
    pts = [[float(c[0]), float(c[1])] for c in coords if isinstance(c, (list, tuple)) and len(c) >= 2]
    if len(pts) < 2:
        raise RouteError("Mindestens 2 Punkte zum Matchen nötig")

    if len(pts) <= _MATCH_MAX:
        out, ok = _match_chunk(pts, token, prof, radius_m, provider)
        return {"coords": out, "matched": ok}

    # Chunking mit Überlappung; gematchte Stücke aneinanderhängen (Naht-Duplikat droppen).
    result: List[List[float]] = []
    matched_any = False
    step = _MATCH_MAX - _MATCH_OVERLAP
    i = 0
    n = len(pts)
    while i < n - 1:
        window = pts[i:i + _MATCH_MAX]
        seg, ok = _match_chunk(window, token, prof, radius_m, provider)
        matched_any = matched_any or ok
        if result and seg:
            seg = seg[1:]  # erster Punkt überlappt mit vorigem Chunk-Ende
        result.extend(seg)
        if i + _MATCH_MAX >= n:
            break
        i += step
    return {"coords": result if len(result) >= 2 else pts, "matched": matched_any}


# ── GPX schreiben ────────────────────────────────────────────────────────────
def write_gpx(
    coords: List[List[float]],
    out_path: str,
    *,
    name: str = "Route",
    duration_s: float = 0.0,
) -> str:
    """Schreibt eine GPX-Datei aus [[lon,lat],…]. Wenn `duration_s > 0`, werden
    gleichmäßig verteilte Zeitstempel gesetzt (damit die Stats eine Fahrtzeit
    zeigen). Gibt den Pfad zurück."""
    gpx = gpxpy.gpx.GPX()
    trk = gpxpy.gpx.GPXTrack(name=name)
    seg = gpxpy.gpx.GPXTrackSegment()
    n = len(coords)
    t0 = datetime(2020, 1, 1, tzinfo=timezone.utc)
    for i, c in enumerate(coords):
        lon, lat = float(c[0]), float(c[1])
        tstamp: Optional[datetime] = None
        if duration_s and n > 1:
            tstamp = t0 + timedelta(seconds=duration_s * (i / (n - 1)))
        seg.points.append(gpxpy.gpx.GPXTrackPoint(lat, lon, time=tstamp))
    trk.segments.append(seg)
    gpx.tracks.append(trk)
    p = Path(out_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(gpx.to_xml(), encoding="utf-8")
    return str(p)
