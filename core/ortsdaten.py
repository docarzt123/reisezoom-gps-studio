"""Ortsdaten-Kacheln: Sehenswürdigkeiten, Orte und Pässe ohne Overpass (22.10.2026).

Overpass ist ein freier Server, der abends oft überlastet ist (502, Zeitüberschreitung) — dann blieb das Logbuch ohne
Sehenswürdigkeiten. scripts/ortsdaten_bauen.py baut aus OpenStreetMap-Auszügen kleine Kacheln mit genau den Objekten,
die die App sonst bei Overpass abfragt, im selben Format wie eine Overpass-Antwort. Die Kacheln liegen als einfache
Dateien auf einem Webserver (`QUELLE`), die App lädt nur die, die eine Tour berührt, und behält sie.

`antwort(abfrage)` beantwortet eine der Overpass-Abfragen aus core/highlights aus den Kacheln: es liest die Kästen
`(s,w,n,e)` aus der Abfrage und liefert alle Elemente darin. Die Auswertung danach (Arten, Korridor, Orte) ist dieselbe
wie bei Overpass. Berührt ein Kasten eine nicht abgedeckte Kachel (außerhalb oder am Rand der Auszüge), fehlt eine Kachel oder ist der Server nicht
erreichbar → None, dann fragt core/highlights wie bisher Overpass.

Zwischenspeicher (`einrichten(ordner)`): Kacheln haben die Version im Pfad und ändern sich nie; `stand.json` wird
höchstens alle STAND_MAX_S neu geholt. Ohne `einrichten` wird nichts benutzt (Tests, Werkzeuge).
`RZ_ORTSDATEN_URL` setzt die Quelle (auch ein lokaler Ordner), `RZ_ORTSDATEN=0` schaltet die Kacheln ab.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import logging
import math
import os
import re
import threading
import time
import urllib.request
from pathlib import Path
from typing import Optional

from . import net as cnet

log = logging.getLogger("core.ortsdaten")

FORMAT = 1
KACHEL_GRAD = 0.5
QUELLE = "https://data.reisezoom.com/ortsdaten/"   # eigene Subdomain: Umzug (CDN, anderer Server) ohne App-Update
STAND_MAX_S = 7 * 86400.0       # so lange gilt ein geholter Stand
FEHLT_PAUSE_S = 6 * 3600.0      # Quelle nicht erreichbar / ohne Stand: so lange nicht neu versuchen
TIMEOUT_S = 15

_ordner: Optional[Path] = None
_lock = threading.Lock()
_stand_mem: Optional[dict] = None
_stand_zeit = 0.0
_fehlt_bis = 0.0
_KASTEN = re.compile(r"\((-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\)")


def einrichten(ordner) -> None:
    """Zwischenspeicher festlegen (die App: im Bibliotheksordner). None = Kacheln nicht benutzen."""
    global _ordner, _stand_mem, _stand_zeit, _fehlt_bis
    with _lock:
        _ordner = Path(ordner) if ordner else None
        _stand_mem, _stand_zeit, _fehlt_bis = None, 0.0, 0.0


def an() -> bool:
    return _ordner is not None and os.environ.get("RZ_ORTSDATEN", "1").strip() not in ("0", "nein", "aus")


def quelle() -> str:
    q = (os.environ.get("RZ_ORTSDATEN_URL") or QUELLE).strip()
    return q if q.endswith("/") else q + "/"


def kachel_name(lat: float, lon: float) -> str:
    return f"k_{math.floor(float(lat) / KACHEL_GRAD)}_{math.floor(float(lon) / KACHEL_GRAD)}.json.gz"


def _holen(pfad: str) -> bytes:
    q = quelle()
    if "://" not in q:                       # lokaler Ordner (Bauen/Testen)
        return (Path(q) / pfad).read_bytes()
    req = urllib.request.Request(q + pfad, headers={"User-Agent": "ReisezoomGPSStudio"})
    with urllib.request.urlopen(req, timeout=TIMEOUT_S, context=cnet.ssl_context()) as r:
        return r.read()


def stand() -> Optional[dict]:
    """Der aktuelle Stand (Version, Gebiete, Kacheln) — aus dem Speicher, sonst geholt; None = keine Kacheln."""
    global _stand_mem, _stand_zeit, _fehlt_bis
    if not an():
        return None
    jetzt = time.time()
    with _lock:
        if _stand_mem is not None and jetzt - _stand_zeit < STAND_MAX_S:
            return _stand_mem
        datei = _ordner / "stand.json"
        gemerkt = None
        try:
            gemerkt = json.loads(datei.read_text(encoding="utf-8"))
            if jetzt - datei.stat().st_mtime < STAND_MAX_S:
                _stand_mem, _stand_zeit = gemerkt, jetzt
                return gemerkt
        except Exception:  # noqa: BLE001
            pass
        if jetzt < _fehlt_bis:
            return gemerkt
        try:
            neu = json.loads(_holen("stand.json").decode("utf-8"))
            if int(neu.get("format") or 0) != FORMAT:
                raise ValueError(f"Format {neu.get('format')}")
            _ordner.mkdir(parents=True, exist_ok=True)
            tmp = datei.with_suffix(".tmp")
            tmp.write_text(json.dumps(neu), encoding="utf-8")
            os.replace(tmp, datei)   # dateischutz-ok: eigener Zwischenspeicher der Ortsdaten-Kacheln, nie Nutzerdaten
            _stand_mem, _stand_zeit = neu, jetzt
            return neu
        except Exception as e:  # noqa: BLE001
            log.info("Ortsdaten: kein Stand von %s (%s)%s", quelle(), str(e)[:80], " — nehme den gemerkten" if gemerkt else "")
            _fehlt_bis = jetzt + FEHLT_PAUSE_S
            if gemerkt:
                _stand_mem, _stand_zeit = gemerkt, jetzt
            return gemerkt


def _kachel(st: dict, name: str) -> Optional[list]:
    """Elemente einer Kachel ([] = leer); None = nicht zu bekommen."""
    summe = (st.get("kacheln") or {}).get(name)
    if summe is None:
        return []
    datei = _ordner / str(st.get("version")) / name
    roh = None
    try:
        roh = datei.read_bytes()
        if hashlib.sha1(roh).hexdigest()[:16] != summe:
            roh = None
    except Exception:  # noqa: BLE001
        roh = None
    if roh is None:
        try:
            roh = _holen(f"{st.get('version')}/{name}")
        except Exception as e:  # noqa: BLE001
            log.info("Ortsdaten: Kachel %s nicht geholt: %s", name, str(e)[:80])
            return None
        if hashlib.sha1(roh).hexdigest()[:16] != summe:
            log.warning("Ortsdaten: Kachel %s mit falscher Prüfsumme", name)
            return None
        try:
            datei.parent.mkdir(parents=True, exist_ok=True)
            tmp = datei.with_suffix(".tmp")
            tmp.write_bytes(roh)
            os.replace(tmp, datei)   # dateischutz-ok: eigener Zwischenspeicher der Ortsdaten-Kacheln, nie Nutzerdaten
        except Exception:  # noqa: BLE001
            pass
    try:
        return json.loads(gzip.decompress(roh).decode("utf-8")).get("elements") or []
    except Exception:  # noqa: BLE001
        return None


def _kacheln_im(k: tuple) -> list:
    s, w, n, e = k
    g = KACHEL_GRAD
    return [f"k_{i}_{j}.json.gz" for i in range(math.floor(s / g), math.floor(n / g) + 1)
            for j in range(math.floor(w / g), math.floor(e / g) + 1)]


def innen(ringe: list, lon: float, lat: float) -> bool:
    """Punkt in einer der Grenzen (Ringe aus (lon, lat), gerade-ungerade-Regel)."""
    drin = False
    for r in ringe:
        j = len(r) - 1
        for i in range(len(r)):
            (xi, yi), (xj, yj) = r[i], r[j]
            if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi:
                drin = not drin
            j = i
    return drin


def abgedeckt(st: dict, k: tuple) -> bool:
    """Kasten ganz innerhalb der Grenzen der Auszüge: alle Ecken drin und kein Grenzpunkt im Kasten."""
    s, w, n, e = k
    ringe = st.get("grenzen") or []
    if not ringe or not all(innen(ringe, x, y) for x, y in ((w, s), (e, s), (w, n), (e, n))):
        return False
    return not any(w < x < e and s < y < n for r in ringe for x, y in r)


def _lage(el: dict) -> tuple:
    if el.get("bounds"):
        b = el["bounds"]
        return b["minlat"], b["minlon"], b["maxlat"], b["maxlon"]
    c = el if el.get("lat") is not None else (el.get("center") or {})
    return c.get("lat"), c.get("lon"), c.get("lat"), c.get("lon")


def antwort(abfrage: str) -> Optional[dict]:
    """Overpass-Abfrage aus core/highlights → {"elements": [...]} aus den Kacheln, oder None (dann Overpass)."""
    kaesten = [tuple(float(x) for x in m) for m in _KASTEN.findall(abfrage or "")]
    if not kaesten:
        return None
    els, rest = teilantwort(kaesten, ohne_orte='"place"' not in abfrage)
    return None if rest else {"elements": els}


def teilantwort(kaesten: list, ohne_orte: bool = True) -> tuple:
    """Kästen (s, w, n, e) → (Elemente aus den Kacheln, Kästen ohne Kacheln — die fragt der Aufrufer bei Overpass)."""
    st = stand()
    if not st:
        return [], list(kaesten)
    gelesen: dict = {}
    raus, rest, gesehen = [], [], set()
    for (s, w, n, e) in kaesten:
        if not abgedeckt(st, (s, w, n, e)):
            rest.append((s, w, n, e))
            continue
        namen = _kacheln_im((s, w, n, e))
        for name in namen:
            if name not in gelesen:
                with _lock:
                    gelesen[name] = _kachel(st, name)
        if any(gelesen[nm] is None for nm in namen):
            rest.append((s, w, n, e))
            continue
        for name in namen:
            for el in gelesen[name]:
                a, b, c, d = _lage(el)
                if a is None or c < s or a > n or d < w or b > e:
                    continue
                if ohne_orte and (el.get("tags") or {}).get("place"):
                    continue
                key = (el.get("type"), el.get("id"))
                if key in gesehen:
                    continue
                gesehen.add(key)
                raus.append(el)
    if len(rest) < len(kaesten):
        log.info("Ortsdaten: %d von %d Kästen aus %d Kacheln → %d Elemente (Stand %s)",
                 len(kaesten) - len(rest), len(kaesten), len(gelesen), len(raus), st.get("version"))
    return raus, rest
