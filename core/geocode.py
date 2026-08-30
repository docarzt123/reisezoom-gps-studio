"""
Reverse-Geocoding (Koordinaten → Adresse) mit auswählbarem Anbieter.

Anbieter:
  - **nominatim** — OpenStreetMap, kein Token, aber nur ~1 Anfrage/Sekunde
    (offizielle Nutzungsregel). Mit der Cluster-Pyramide (siehe app.py) reicht das.
  - **photon** — Komoot, ebenfalls OSM-basiert, kein Token, deutlich großzügiger.
  - **mapbox** — schnell (~10/s, 100k/Monat gratis), braucht aber den Mapbox-Token,
    den der Nutzer ggf. eh schon für die 3D-Karten hinterlegt hat.

`resolve_provider("auto", token)` wählt **Mapbox wenn ein Token da ist, sonst Photon**.
Alle Anbieter liefern dieselbe normalisierte Adresse:
  {display, street, city, state, country, country_code, postcode}

Ergebnisse werden pro (Anbieter, gerundete Koordinate) gecacht; pro Anbieter gibt es
eine Mindest-Pause zwischen echten HTTP-Anfragen (Drossel).
"""
from __future__ import annotations

import json
import logging
import math
import threading
import time
import urllib.parse
import urllib.request
from typing import Optional

log = logging.getLogger("reisezoom.geocode")

_UA = "ReisezoomGeotagger/1.0 (https://reisezoom.com; geotagger)"

# Mindest-Pause zwischen echten Anfragen je Anbieter (Sekunden).
_MIN_INTERVAL = {"nominatim": 1.1, "photon": 0.4, "mapbox": 0.12}

_CACHE: dict[tuple, Optional[dict]] = {}
_LOCK = threading.Lock()
_last_call: dict[str, float] = {}
# Je Anbieter ein eigener Drossel-Lock. Nominatim darf eine Anfrage je Sekunde,
# Mapbox rund zehn — mit einem gemeinsamen Lock hätte der langsame Anbieter den
# schnellen ausgebremst, und zwar über die gesamte Wartezeit (siehe `reverse`).
_THROTTLE_LOCKS: dict[str, threading.Lock] = {}


# ── Anbieterwahl ─────────────────────────────────────────────────────────────

def resolve_provider(provider: str, mapbox_token: str = "") -> Optional[str]:
    """Effektiver Anbieter. 'auto' → mapbox wenn Token, sonst photon. 'off' → None."""
    p = (provider or "auto").strip().lower()
    if p in ("off", "none", "disabled"):
        return None
    if p == "auto":
        return "mapbox" if (mapbox_token or "").strip().startswith("pk.") else "photon"
    if p in ("nominatim", "photon", "mapbox"):
        return p
    return "photon"


# ── Clustering: Fotos in Gitterzellen gruppieren (Pyramide) ──────────────────

def cell_key(lat: float, lon: float, cell_m: float) -> tuple[int, int]:
    """Gitterzellen-Schlüssel für eine ungefähre Kantenlänge `cell_m` (Meter).
    Grob, aber für Clustering völlig ausreichend (1° lat ≈ 111 km)."""
    dlat = cell_m / 111_000.0
    dlon = cell_m / (111_000.0 * max(0.2, math.cos(math.radians(lat))))
    return (int(math.floor(lat / dlat)), int(math.floor(lon / dlon)))


def cluster(points: list[tuple], cell_m: float) -> dict[tuple, dict]:
    """`points` = [(idx, lat, lon), …] → {cellkey: {"members":[idx…], "lat":c, "lon":c}}.
    `lat/lon` der Zelle ist der Schwerpunkt ihrer Mitglieder."""
    cells: dict[tuple, dict] = {}
    for idx, lat, lon in points:
        k = cell_key(lat, lon, cell_m)
        c = cells.setdefault(k, {"members": [], "_lat": 0.0, "_lon": 0.0})
        c["members"].append(idx)
        c["_lat"] += lat
        c["_lon"] += lon
    for c in cells.values():
        n = len(c["members"])
        c["lat"] = c["_lat"] / n
        c["lon"] = c["_lon"] / n
        del c["_lat"], c["_lon"]
    return cells


# ── Öffentliche Reverse-Funktion ─────────────────────────────────────────────

# ── Letzter Fehlgrund, damit die Oberfläche etwas sagen kann ────────────────
_LETZTER_FEHLER: dict = {"art": "", "text": ""}


def merke_fehler(e: BaseException) -> None:
    """Einen Fehlschlag in eine Ursache übersetzen, die man anzeigen kann."""
    t = f"{e.__class__.__name__}: {e}"
    if "CERTIFICATE_VERIFY_FAILED" in t:
        art = "zertifikat"
    elif "Name or service not known" in t or "nodename nor servname" in t \
            or "Temporary failure in name resolution" in t:
        art = "offline"
    elif "timed out" in t.lower() or "timeout" in t.lower():
        art = "langsam"
    elif "HTTP Error 401" in t or "HTTP Error 403" in t:
        art = "zugang"
    elif "HTTP Error 429" in t:
        art = "gedrosselt"
    else:
        art = "unbekannt"
    with _LOCK:
        _LETZTER_FEHLER["art"] = art
        _LETZTER_FEHLER["text"] = t[:200]


def letzter_fehler() -> dict:
    """Was zuletzt schiefging — leer, wenn nichts schiefging."""
    with _LOCK:
        return dict(_LETZTER_FEHLER)


def fehler_zuruecksetzen() -> None:
    with _LOCK:
        _LETZTER_FEHLER["art"] = ""
        _LETZTER_FEHLER["text"] = ""


def reverse(lat: float, lon: float, *, provider: str = "nominatim",
            mapbox_token: str = "", lang: str = "de", zoom: int = 18,
            timeout: float = 8.0) -> Optional[dict]:
    """Eine Koordinate → normalisierte Adresse (oder None). Gecacht + gedrosselt.
    `zoom` wirkt nur bei Nominatim (3=Land … 18=Hausnummer)."""
    prov = (provider or "nominatim").lower()
    key = (prov, round(lat, 4), round(lon, 4), zoom if prov == "nominatim" else 0)
    with _LOCK:
        if key in _CACHE:
            return _CACHE[key]

    # Drossel pro Anbieter — mit einem EIGENEN Lock je Anbieter.
    #
    # Vorher lief das Warten unter `_LOCK`, und der schützt zugleich den
    # Zwischenspeicher. Effekt: Solange der Archiv-Ortslauf im Hintergrund
    # tickte (Nominatim, 1,1 s Zwangspause), wartete JEDE andere Abfrage auf
    # denselben Lock — auch eine Mapbox-Anfrage, die 0,12 s dürfte, und auch
    # jeder Tastendruck im Archiv-Suchfeld. Aus 48 Sekunden Geotagger-Arbeit
    # wurden so bis zu acht Minuten. Die Drossel ist absichtlich pro Anbieter;
    # ein gemeinsamer Lock machte sie faktisch global.
    interval = _MIN_INTERVAL.get(prov, 1.0)
    with _LOCK:
        drossel = _THROTTLE_LOCKS.setdefault(prov, threading.Lock())
    with drossel:
        wait = interval - (time.monotonic() - _last_call.get(prov, 0.0))
        if wait > 0:
            time.sleep(wait)
        _last_call[prov] = time.monotonic()

    try:
        if prov == "photon":
            addr = _photon(lat, lon, lang, timeout)
        elif prov == "mapbox":
            addr = _mapbox(lat, lon, mapbox_token, lang, timeout)
        else:
            addr = _nominatim(lat, lon, lang, zoom, timeout)
    except Exception as e:
        log.warning("reverse(%s) fehlgeschlagen %.5f,%.5f: %s", prov, lat, lon, e)
        # Den Grund merken. Vorher wurde der Fehler nur ins Log geschrieben, und
        # die Oberfläche meldete am Ende „fertig, 0 Adressen" — ein Fehlschlag,
        # der wie ein Erfolg aussieht. Genau daran hat sich ein Nutzer (v0.9.495)
        # aufgerieben: alle drei Dienste durchprobiert, keiner sagte warum.
        merke_fehler(e)
        # Und NICHT merken: Ein Netzfehler ist keine Aussage über diesen Ort.
        # Vorher landete er im selben Zwischenspeicher wie ein echtes „hier gibt
        # es nichts". Fiel das WLAN während eines Laufs kurz aus, waren die
        # betroffenen Punkte damit dauerhaft abgehakt — beim zweiten Anlauf
        # antwortete der Speicher, es entstand gar kein Fehler mehr, und die
        # Anzeige meldete erneut „fertig, 0 Adressen", diesmal sogar ohne Grund.
        # Genau der Fehlschlag-der-wie-Erfolg-aussieht, den v0.9.496 abstellen
        # sollte — nur eben beim zweiten Versuch.
        return None

    with _LOCK:
        _CACHE[key] = addr
    return addr


def _fetch_json(url: str, timeout: float) -> dict:
    # v0.9.496 (Nutzer-Bug-Report): OHNE eigenen TLS-Kontext findet Pythons
    # OpenSSL im PyInstaller-Bundle keine Zertifikate — jede Adressabfrage starb
    # mit CERTIFICATE_VERIFY_FAILED, und der Geotagger meldete stumm
    # „0 Adressen". Siehe core/net.py.
    from . import net
    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    with urllib.request.urlopen(req, timeout=timeout, context=net.ssl_context()) as resp:
        return json.loads(resp.read().decode("utf-8"))


# ── Anbieter-Implementierungen (jeweils → normalisiertes Dict) ───────────────

def _nominatim(lat: float, lon: float, lang: str, zoom: int, timeout: float) -> Optional[dict]:
    params = urllib.parse.urlencode({
        "format": "jsonv2", "lat": f"{lat:.6f}", "lon": f"{lon:.6f}",
        "zoom": str(zoom), "addressdetails": "1", "accept-language": lang,
    })
    data = _fetch_json(f"https://nominatim.openstreetmap.org/reverse?{params}", timeout)
    if not data or data.get("error"):
        return None
    a = data.get("address", {}) or {}
    city = (a.get("city") or a.get("town") or a.get("village") or a.get("municipality")
            or a.get("hamlet") or a.get("suburb") or "")
    street = a.get("road") or ""
    house = a.get("house_number") or ""
    return _norm(
        display=data.get("display_name", ""),
        street=(f"{street} {house}".strip() if street else (a.get("suburb") or "")),
        city=city, state=a.get("state") or a.get("state_district") or "",
        county=a.get("province") or a.get("county") or a.get("island") or "",
        country=a.get("country") or "", country_code=(a.get("country_code") or ""),
        postcode=a.get("postcode") or "",
    )


def _photon(lat: float, lon: float, lang: str, timeout: float) -> Optional[dict]:
    # Photon kennt nur de/en/fr/it als Sprachen — sonst Default.
    plang = lang if lang in ("de", "en", "fr", "it") else "en"
    params = urllib.parse.urlencode({"lat": f"{lat:.6f}", "lon": f"{lon:.6f}", "lang": plang})
    data = _fetch_json(f"https://photon.komoot.io/reverse?{params}", timeout)
    feats = (data or {}).get("features") or []
    if not feats:
        return None
    p = feats[0].get("properties", {}) or {}
    street = p.get("street") or p.get("name") or ""
    house = p.get("housenumber") or ""
    city = (p.get("city") or p.get("district") or p.get("locality")
            or p.get("county") or p.get("name") or "")
    return _norm(
        display=", ".join([x for x in (
            (f"{street} {house}".strip() if street else p.get("name") or ""),
            p.get("postcode"), city, p.get("country")) if x]),
        street=(f"{street} {house}".strip() if street else ""),
        city=city, state=p.get("state") or "", country=p.get("country") or "",
        country_code=(p.get("countrycode") or ""), postcode=p.get("postcode") or "",
    )


def _mapbox(lat: float, lon: float, token: str, lang: str, timeout: float) -> Optional[dict]:
    if not (token or "").strip().startswith("pk."):
        return None
    params = urllib.parse.urlencode({
        "longitude": f"{lon:.6f}", "latitude": f"{lat:.6f}",
        "access_token": token, "language": lang,
    })
    data = _fetch_json(f"https://api.mapbox.com/search/geocode/v6/reverse?{params}", timeout)
    feats = (data or {}).get("features") or []
    if not feats:
        return None
    pr = feats[0].get("properties", {}) or {}
    ctx = pr.get("context", {}) or {}

    def cv(key):
        return (ctx.get(key) or {}).get("name") or ""
    street = cv("street") or cv("address")
    house = (ctx.get("address") or {}).get("address_number") or ""
    cc = (ctx.get("country") or {}).get("country_code") or ""
    return _norm(
        display=pr.get("full_address") or pr.get("name_preferred") or pr.get("name") or "",
        street=(f"{street} {house}".strip() if street else ""),
        city=cv("place") or cv("locality") or cv("district"),
        state=cv("region"), country=cv("country"),
        country_code=cc, postcode=cv("postcode"),
    )


def _norm(*, display, street, city, state, country, country_code, postcode,
          county="") -> dict:
    return {
        "display": (display or "").strip(),
        "street": (street or "").strip(),
        "city": (city or "").strip(),
        "state": (state or "").strip(),
        # Bei Inseln und Landkreisen steht hier der Name, der die Gegend
        # wirklich benennt — „Santa Cruz de Tenerife", während `state` nur
        # „Kanarische Inseln" sagt. Für die Ortssuche ist das der Unterschied
        # zwischen „findet die Insel" und „findet sie nicht".
        "county": (county or "").strip(),
        "country": (country or "").strip(),
        "country_code": (country_code or "").strip().upper(),
        "postcode": (postcode or "").strip(),
    }


def cache_size() -> int:
    with _LOCK:
        return len(_CACHE)


# ── Ortsname → Koordinaten (die Suche andersherum) ──────────────────────────
#
# Die Textsuche im Archiv findet nur, was jemand hingeschrieben hat. „Teneriffa"
# steht aber in keiner Datei — die Touren wissen bloß, WO sie liegen. Also wird
# der Suchbegriff selbst nachgeschlagen: Nominatim liefert zu „Teneriffa" ein
# Rechteck, und das Archiv zeigt alles, was darin liegt. Damit braucht es keine
# handgepflegte Liste von Inselnamen — es funktioniert für jeden Ort, in jeder
# Sprache, auch für Namen, die in keiner Tour vorkommen.

_FWD_CACHE: dict = {}


def forward(query: str, *, lang: str = "de", timeout: float = 10.0) -> Optional[dict]:
    """Ortsname → {name, lat, lon, bbox}. None, wenn nichts gefunden wurde.

    Das Rechteck kommt vom Dienst und ist die eigentliche Nutzlast: für eine
    Insel ist es die Insel, für eine Stadt die Stadt. Genau danach filtert das
    Archiv anschließend.
    """
    q = (query or "").strip()
    if len(q) < 3:
        return None
    key = (q.lower(), lang)
    with _LOCK:
        if key in _FWD_CACHE:
            return _FWD_CACHE[key]

    # Drossel mit EIGENEM Lock — dieselbe Begründung wie bei `reverse()` oben:
    # `_LOCK` schützt zugleich den Zwischenspeicher. Wer hier bis zu 1,1 s unter
    # `_LOCK` schläft, hält jede andere Abfrage auf, auch die schnellen
    # Mapbox-Aufrufe des Geotaggers. Beim Tippen im Archiv-Suchfeld während
    # eines laufenden Ortslaufs war genau das der Fall.
    interval = _MIN_INTERVAL.get("nominatim", 1.0)
    with _LOCK:
        drossel = _THROTTLE_LOCKS.setdefault("nominatim", threading.Lock())
    with drossel:
        wait = interval - (time.monotonic() - _last_call.get("nominatim", 0.0))
        if wait > 0:
            time.sleep(wait)
        _last_call["nominatim"] = time.monotonic()

    out = None
    try:
        params = urllib.parse.urlencode({
            "format": "jsonv2", "q": q, "limit": "1",
            "accept-language": lang, "addressdetails": "1",
        })
        data = _fetch_json(f"https://nominatim.openstreetmap.org/search?{params}", timeout)
        if data:
            d = data[0]
            bb = d.get("boundingbox") or []
            if len(bb) == 4:
                out = {
                    "name": d.get("display_name", "") or q,
                    "lat": float(d.get("lat") or 0.0),
                    "lon": float(d.get("lon") or 0.0),
                    "typ": d.get("type", ""),
                    "bbox": {"min_lat": float(bb[0]), "max_lat": float(bb[1]),
                             "min_lon": float(bb[2]), "max_lon": float(bb[3])},
                }
    except Exception as e:
        log.warning("forward(%r) fehlgeschlagen: %s", q, e)
        merke_fehler(e)
        # NICHT merken — wie bei `reverse()`: Ein Netzfehler ist keine Aussage
        # über diesen Suchbegriff. Vorher fiel der Fehlerpfad in das Schreiben
        # unten durch und legte `None` ab; ein kurzer WLAN-Aussetzer beim ersten
        # Tippen von „Teneriffa" lieferte dann für den Rest der Sitzung ein
        # leeres Ergebnis — ohne dass überhaupt noch ein Fehler entstand.
        return None

    with _LOCK:
        _FWD_CACHE[key] = out
    return out
