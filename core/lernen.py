"""Logbuch lernt aus Korrekturen — geteilt mit allen, die mitmachen (24.10.2026).

Marc: „Könnte man das auch so machen, dass man das geteilt macht mit anderen Usern … um es generell zu verbessern“ —
und „über teilen lernen, so kommen ja automatisch meine Sachen vom MacBook dazu“.

**Was geteilt wird — nur mit Zustimmung** (Einstellung `logbuch_lernen_teilen`, Standard aus): je Abschnitt, dessen Art
jemand von Hand gesetzt oder bestätigt hat, ein Satz **Zahlen** (`merkmale`): Dauer, Strecke, Tempoverteilung,
Stillstand, Anfahren/Bremsen, Steigung, Anteile der Wegarten (core/wegtyp), die Art der Tour als grobe Gruppe — und die
richtige Art. **Keine Koordinaten, keine Uhrzeiten, kein Datum, keine Namen, keine Tour-Kennung.** Daraus lässt sich
nicht ablesen, wo jemand war. Gesendet wird an data.reisezoom.com (`QUELLE`), jedes Beispiel nur einmal.

**Was zurückkommt:** ein kleines Modell (`modell.json`, Softmax-Regression über die normierten Merkmale), trainiert bei
uns (scripts/logbuch_lernen.py) und nur veröffentlicht, wenn es auf zurückgehaltenen Beispielen besser ist als die
Regeln. Die App greift damit ausschließlich bei Einträgen ein, die die Regeln nur vermuten oder offen lassen, und nur
bei hoher Sicherheit (`SCHWELLE`) — als „vermutet“ gekennzeichnet. Ohne Modell bleibt alles wie bisher.
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from . import net as _net

log = logging.getLogger("core.lernen")

QUELLE = "https://data.reisezoom.com/lernen/"
FORMAT = 1                      # Aufbau der Merkmale; der Server nimmt nur bekannte Formate an
SCHWELLE = 0.85                 # so sicher muss das Modell sein, bevor es eine Vermutung ersetzt
MAX_JE_SENDUNG = 200
ARTEN = ("fahrt", "rad", "laufen", "gehen", "uebersetzen", "wassersport")   # Lernziele (Wanderung/Spaziergang = gehen)
TOUR_GRUPPEN = ("wandern", "rad", "laufen", "fahrzeug", "wasser", "sonst")
WEG_KLASSEN = ("autobahn", "strasse", "weg", "pfad", "radweg", "faehre", "bahn", "")

MERKMALE = (["dauer_log", "strecke_log", "tempo_mittel", "tempo_p10", "tempo_p50", "tempo_p90", "stillstand",
             "beschl_p90", "auf_je_km", "ab_je_km", "steil_p90", "punktabstand_s"]
            + ["weg_" + (k or "unbekannt") for k in WEG_KLASSEN]
            + ["tour_" + g for g in TOUR_GRUPPEN])


def art_ziel(art: str) -> Optional[str]:
    a = (art or "").lower()
    if a in ("wanderung", "spaziergang", "gehen"):
        return "gehen"
    return a if a in ARTEN else None


def tour_gruppe(aktivitaet: str) -> str:
    a = (aktivitaet or "").lower()
    for g, woerter in (("wasser", ("boot", "kajak", "kanu", "paddel", "sup", "segel", "ruder", "wasser", "surf")),
                       ("rad", ("rad", "bike", "cycl", "fahrrad", "mtb", "gravel")),
                       ("laufen", ("lauf", "run", "jog", "trail")),
                       ("fahrzeug", ("auto", "motorrad", "wohnmobil", "car", "motor", "drive", "bus")),
                       ("wandern", ("wander", "hik", "trek", "spazier", "walk", "berg"))):
        if any(w in a for w in woerter):
            return g
    return "sonst"


def _q(werte: List[Tuple[float, float]], p: float) -> float:
    """Gewichtetes Quantil von (Wert, Gewicht)."""
    if not werte:
        return 0.0
    werte = sorted(werte)
    ges = sum(g for _, g in werte) or 1.0
    s = 0.0
    for v, g in werte:
        s += g
        if s >= p * ges:
            return float(v)
    return float(werte[-1][0])


def _pt(p):
    if isinstance(p, dict):
        return p.get("lat"), p.get("lon"), p.get("ele"), p.get("time")
    return getattr(p, "lat", None), getattr(p, "lon", None), getattr(p, "ele", None), getattr(p, "time", None)


class Punkte(list):
    """Punkte als (Zeit, lat, lon, Höhe), nach Zeit sortiert — einmal je Tour, dann je Abschnitt nur ein Ausschnitt."""


def punkte_vorbereiten(points) -> "Punkte":
    from .wegtyp import _epoch
    raus = Punkte()
    for p in points or []:
        la, lo, el, t = _pt(p)
        tt = _epoch(t)
        if la is not None and lo is not None and tt is not None:
            raus.append((tt, float(la), float(lo), None if el is None else float(el)))
    raus.sort()
    return raus


def merkmale(points, t0: float, t1: float, wege: Optional[Dict[str, float]] = None, aktivitaet: str = "") -> Optional[dict]:
    """Die Zahlen eines Abschnitts (t0…t1) — None, wenn zu wenig Punkte darin liegen. Keine Orte, keine Zeiten.
    `points` roh oder schon `punkte_vorbereiten` (lange Reisen: sonst je Abschnitt ein Durchgang über alle Punkte)."""
    import bisect
    from .wegtyp import _hav
    alle = points if isinstance(points, Punkte) else punkte_vorbereiten(points)
    a = bisect.bisect_left(alle, (t0 - 1,))
    b = bisect.bisect_right(alle, (t1 + 1, float("inf")))
    pts = alle[a:b]
    if len(pts) < 5:
        return None
    tempo, beschl, steil, abst = [], [], [], []
    strecke = auf = ab = still = 0.0
    letzte_v = None
    for (ta, la1, lo1, e1), (tb, la2, lo2, e2) in zip(pts, pts[1:]):
        dt = tb - ta
        if dt <= 0:
            continue
        d = _hav(la1, lo1, la2, lo2)
        strecke += d
        v = d / dt * 3.6
        if v > 250:                      # Sprung — zählt nicht
            continue
        tempo.append((v, dt))
        abst.append((dt, 1.0))
        if v < 1.5:
            still += dt
        if letzte_v is not None:
            beschl.append((abs(v - letzte_v) / 3.6 / dt, dt))
        letzte_v = v
        if e1 is not None and e2 is not None:
            dh = e2 - e1
            if dh > 0:
                auf += dh
            else:
                ab -= dh
            if d > 5:
                steil.append((abs(dh) / d * 100.0, d))
    dauer = max(1.0, t1 - t0)
    km = max(strecke / 1000.0, 0.01)
    m = {"dauer_log": math.log1p(dauer / 60.0), "strecke_log": math.log1p(strecke / 1000.0),
         "tempo_mittel": strecke / dauer * 3.6, "tempo_p10": _q(tempo, 0.1), "tempo_p50": _q(tempo, 0.5),
         "tempo_p90": _q(tempo, 0.9), "stillstand": still / dauer, "beschl_p90": min(_q(beschl, 0.9), 10.0),
         "auf_je_km": min(auf / km, 500.0), "ab_je_km": min(ab / km, 500.0), "steil_p90": min(_q(steil, 0.9), 100.0),
         "punktabstand_s": min(_q(abst, 0.5), 600.0)}
    wege = wege or {}
    bekannt = sum(v for k, v in wege.items() if k and not k.startswith("_"))
    for k in WEG_KLASSEN:
        m["weg_" + (k or "unbekannt")] = float(wege.get(k, 0.0)) if wege else (1.0 if k == "" else 0.0)
    if wege and bekannt == 0:
        m["weg_unbekannt"] = 1.0
    g = tour_gruppe(aktivitaet)
    for gg in TOUR_GRUPPEN:
        m["tour_" + gg] = 1.0 if gg == g else 0.0
    return {k: round(float(m[k]), 4) for k in MERKMALE}


def schluessel(tour: str, bid: str, art: str) -> str:
    """Kennung eines gesendeten Beispiels — bleibt lokal (gemerkt, was schon draußen ist), geht nie mit."""
    return hashlib.sha256(f"{tour}|{bid}|{art}".encode()).hexdigest()[:24]


# ── Lokal: was schon gesendet ist ────────────────────────────────────────────
SCHEMA = """
CREATE TABLE IF NOT EXISTS lern_gesendet (
    schluessel TEXT PRIMARY KEY,
    zeit       TEXT
);
"""


def gesendet(conn) -> set:
    conn.executescript(SCHEMA)
    return {r[0] for r in conn.execute("SELECT schluessel FROM lern_gesendet")}


def als_gesendet(conn, schluessel_: List[str]) -> None:
    conn.executescript(SCHEMA)
    jetzt = time.strftime("%Y-%m-%dT%H:%M:%S")
    conn.executemany("INSERT OR IGNORE INTO lern_gesendet (schluessel, zeit) VALUES (?, ?)", [(s, jetzt) for s in schluessel_])
    conn.commit()


# ── Netz ─────────────────────────────────────────────────────────────────────
def senden(beispiele: List[dict], app_version: str = "", quelle: str = QUELLE) -> dict:
    """POST an `einsenden.php`. Jedes Beispiel: {"format", "art", "auto_art", "merkmale": {…}}. → {"ok", "angenommen"}."""
    if not beispiele:
        return {"ok": True, "angenommen": 0}
    body = json.dumps({"format": FORMAT, "app": app_version, "beispiele": beispiele[:MAX_JE_SENDUNG]}).encode()
    req = urllib.request.Request(quelle + "einsenden.php", data=body, method="POST",
                                 headers={"Content-Type": "application/json", "User-Agent": "GPS Studio (reisezoom.com)"})
    try:
        with urllib.request.urlopen(req, timeout=20, context=_net.ssl_context()) as r:
            return json.loads(r.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        return {"ok": False, "error": f"HTTP {e.code}"}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e), "netz": False}


def modell_holen(ordner: Path, quelle: str = QUELLE, max_alter_s: float = 86400.0) -> Optional[dict]:
    """`modell.json` vom Server, höchstens einmal am Tag; sonst das gemerkte. None, wenn es keins gibt."""
    datei = Path(ordner) / "modell.json"
    try:
        if datei.exists() and time.time() - datei.stat().st_mtime < max_alter_s:
            return modell_lesen(datei)
        req = urllib.request.Request(quelle + "modell.json", headers={"User-Agent": "GPS Studio (reisezoom.com)"})
        with urllib.request.urlopen(req, timeout=15, context=_net.ssl_context()) as r:
            daten = r.read()
        m = json.loads(daten.decode("utf-8"))
        if _gueltig(m):
            datei.parent.mkdir(parents=True, exist_ok=True)
            datei.write_bytes(daten)
        return modell_lesen(datei)
    except urllib.error.HTTPError as e:
        if e.code == 404 and datei.exists():
            datei.touch()                 # noch kein Modell draußen — nicht jedes Mal fragen
        return modell_lesen(datei)
    except Exception as e:  # noqa: BLE001
        log.info("lernen: Modell nicht geholt (%s)", e)
        return modell_lesen(datei)


def _gueltig(m) -> bool:
    return (isinstance(m, dict) and m.get("format") == FORMAT and list(m.get("merkmale") or []) == list(MERKMALE)
            and len(m.get("klassen") or []) >= 2 and len(m.get("gewichte") or []) == len(m.get("klassen") or []))


def modell_lesen(datei: Path) -> Optional[dict]:
    try:
        m = json.loads(Path(datei).read_text())
        return m if _gueltig(m) else None
    except Exception:  # noqa: BLE001
        return None


# ── Modell: Softmax-Regression ───────────────────────────────────────────────
def vorhersagen(modell: dict, m: dict) -> Tuple[Optional[str], float]:
    """(Art, Wahrscheinlichkeit) — (None, 0) ohne Modell/Merkmale."""
    if not modell or not m:
        return None, 0.0
    mu, sd = modell["mittel"], modell["streuung"]
    x = [(float(m.get(k, 0.0)) - mu[i]) / (sd[i] or 1.0) for i, k in enumerate(MERKMALE)]
    z = [sum(w * xi for w, xi in zip(gw, x)) + b for gw, b in zip(modell["gewichte"], modell["achsen"])]
    zm = max(z)
    e = [math.exp(v - zm) for v in z]
    s = sum(e) or 1.0
    k = max(range(len(e)), key=lambda i: e[i])
    return modell["klassen"][k], e[k] / s


def trainieren(beispiele: List[dict], schritte: int = 3000, lern: float = 0.3, l2: float = 1e-3) -> Optional[dict]:
    """Softmax-Regression mit numpy (Gradientenabstieg, Klassen gewichtet nach Häufigkeit). Beispiele: {"art", "merkmale"}."""
    import numpy as np
    daten = [(art_ziel(b.get("art")), b.get("merkmale") or {}) for b in beispiele]
    daten = [(a, m) for a, m in daten if a and m]
    klassen = sorted({a for a, _ in daten})
    if len(klassen) < 2:
        return None
    X = np.array([[float(m.get(k, 0.0)) for k in MERKMALE] for _, m in daten], dtype=np.float64)
    y = np.array([klassen.index(a) for a, _ in daten])
    mu, sd = X.mean(axis=0), X.std(axis=0)
    sd[sd == 0] = 1.0
    Xn = (X - mu) / sd
    n, d, c = Xn.shape[0], Xn.shape[1], len(klassen)
    W, b = np.zeros((c, d)), np.zeros(c)
    Y = np.eye(c)[y]
    gewicht = (n / (c * np.bincount(y, minlength=c).clip(min=1)))[y]
    for _ in range(schritte):
        z = Xn @ W.T + b
        z -= z.max(axis=1, keepdims=True)
        p = np.exp(z); p /= p.sum(axis=1, keepdims=True)
        g = (p - Y) * gewicht[:, None] / n
        W -= lern * (g.T @ Xn + l2 * W)
        b -= lern * g.sum(axis=0)
    return {"format": FORMAT, "merkmale": list(MERKMALE), "klassen": klassen, "mittel": mu.round(6).tolist(),
            "streuung": sd.round(6).tolist(), "gewichte": W.round(6).tolist(), "achsen": b.round(6).tolist(),
            "beispiele": int(n), "schwelle": SCHWELLE, "erstellt": time.strftime("%Y-%m-%d")}
