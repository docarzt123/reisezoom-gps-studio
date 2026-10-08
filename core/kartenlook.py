"""Eigene Kartenstile durch Umfärben einer freien Vektorkarte (05.10.2026).

Es gibt keinen freien dunklen oder papierfarbenen Vektorstil. OpenFreeMap „Positron" ist dagegen fast
einfarbig grau — ideal als Vorlage: jede Farbe wird nach ihrer Helligkeit auf eine eigene Zweitonskala
gelegt (Duotone), Wasser und Grün bekommen eigene Töne, Schrift und Schriftrand feste Farben.

Ausgeliefert über die lokale Kachel-Weiche (`/stil/<name>.json`, app.py), damit Vorschau (WKWebView) und
Video (Chromium) denselben Stil laden. Die Vorlage wird einmal geholt und im Kachel-Speicher abgelegt —
ohne Netz bleibt der letzte Stand nutzbar.
"""
from __future__ import annotations

import colorsys
import copy
import json
import re
import threading
import time
import urllib.request
from pathlib import Path
from typing import Optional

from core import net as _net

BASIS_URL = "https://tiles.openfreemap.org/styles/positron"

# dunkel/hell = Enden der Zweitonskala; abstand = Nacht: Abstand zur Hintergrundhelligkeit statt Helligkeit
# (Straßen sind in Positron heller, Grenzen dunkler als der Grund — nachts sollen beide leicht heraustreten).
PALETTEN = {
    "nacht": {"dunkel": "#0c1519", "hell": "#6d8a8f", "abstand": 3.2,
              "wasser": "#122c35", "gruen": "#112420", "text": "#c3d2cd", "halo": "#0c1519"},
    "atlas": {"dunkel": "#4e3c2b", "hell": "#fbf5e6", "abstand": 0,
              "wasser": "#b9cdc6", "gruen": "#e3e3c6", "text": "#4e3c2b", "halo": "#f6eedb"},
}
NAMEN = tuple(PALETTEN)

_HEX = re.compile(r"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
_FUNK = re.compile(r"^(rgba?|hsla?)\(\s*([^)]*)\)$", re.I)
_BENANNT = {"white": (255, 255, 255), "black": (0, 0, 0)}


def farbe_lesen(s) -> Optional[tuple[float, float, float, float]]:
    """CSS-Farbe → (r, g, b, a) mit r/g/b 0…255, a 0…1; None, wenn es keine Farbe ist."""
    if not isinstance(s, str):
        return None
    t = s.strip()
    if t.lower() in _BENANNT:
        return (*_BENANNT[t.lower()], 1.0)
    if _HEX.match(t):
        h = t[1:]
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 1.0)
    m = _FUNK.match(t)
    if not m:
        return None
    art = m.group(1).lower()
    teile = [x.strip() for x in m.group(2).split(",")]
    if len(teile) not in (3, 4):
        return None
    try:
        a = float(teile[3]) if len(teile) == 4 else 1.0
        if art.startswith("rgb"):
            r, g, b = (float(x.rstrip("%")) for x in teile[:3])
            return (r, g, b, a)
        hh = float(teile[0]) / 360.0
        ss = float(teile[1].rstrip("%")) / 100.0
        ll = float(teile[2].rstrip("%")) / 100.0
        r, g, b = colorsys.hls_to_rgb(hh % 1.0, ll, ss)
        return (r * 255, g * 255, b * 255, a)
    except ValueError:
        return None


def _hex(c: str) -> tuple[float, float, float]:
    r = farbe_lesen(c)
    return (r[0], r[1], r[2]) if r else (0.0, 0.0, 0.0)


def _text(rgb, a: float) -> str:
    r, g, b = (int(round(max(0, min(255, v)))) for v in rgb)
    return f"rgba({r},{g},{b},{round(a, 3)})"


def _hell(r, g, b) -> float:
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0


def _mix(a, b, t: float):
    t = max(0.0, min(1.0, t))
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def _rolle(layer_id: str, eigenschaft: str) -> str:
    if eigenschaft == "text-color":
        return "text"
    if eigenschaft == "text-halo-color":
        return "halo"
    lid = layer_id.lower()
    if "water" in lid and "label" not in lid and "name" not in lid:
        return "wasser"
    if lid in ("park", "landcover_wood") or "wood" in lid or "park" in lid:
        return "gruen"
    return "flaeche"


def _umfaerben_wert(v, rolle: str, p: dict, bg_hell: float):
    if isinstance(v, list):
        return [_umfaerben_wert(x, rolle, p, bg_hell) for x in v]
    c = farbe_lesen(v)
    if c is None:
        return v
    r, g, b, a = c
    if rolle in ("text", "halo", "wasser", "gruen"):
        ziel = _hex(p[rolle])
        if rolle == "wasser":   # Wasser behält seine Abstufung (Fluss heller als See) — leicht
            ziel = _mix(ziel, _hex(p["hell"]), max(0.0, _hell(r, g, b) - 0.78) * 0.6)
        return _text(ziel, a)
    h = _hell(r, g, b)
    t = min(1.0, abs(h - bg_hell) * p["abstand"]) if p["abstand"] else h
    return _text(_mix(_hex(p["dunkel"]), _hex(p["hell"]), t), a)


def umfaerben(stil: dict, name: str) -> dict:
    """Positron-Stil → Look `name` (nacht|atlas). Gibt eine Kopie zurück."""
    p = PALETTEN[name]
    s = copy.deepcopy(stil)
    bg_hell = 0.95
    for lyr in s.get("layers", []):
        if lyr.get("type") == "background":
            c = farbe_lesen((lyr.get("paint") or {}).get("background-color"))
            if c:
                bg_hell = _hell(*c[:3])
    for lyr in s.get("layers", []):
        paint = lyr.get("paint")
        if not isinstance(paint, dict):
            continue
        for k in list(paint):
            if k.endswith("-color"):
                paint[k] = _umfaerben_wert(paint[k], _rolle(lyr.get("id", ""), k), p, bg_hell)
        if lyr.get("type") == "symbol" and "text-halo-color" not in paint and (lyr.get("layout") or {}).get("text-field"):
            paint["text-halo-color"] = _text(_hex(p["halo"]), 0.8)
            paint.setdefault("text-halo-width", 1)
    s["name"] = f"GPS Studio {name}"
    return s


_lock = threading.Lock()
_basis: dict = {}          # url → (zeit, stil)
BASIS_TTL = 7 * 86400


def _basis_laden(cache_dir: Optional[Path], timeout: float = 15.0) -> dict:
    with _lock:
        hit = _basis.get(BASIS_URL)
        if hit and time.time() - hit[0] < BASIS_TTL:
            return hit[1]
    datei = Path(cache_dir) / "stile" / "positron.json" if cache_dir else None
    stil = None
    if datei and datei.exists() and time.time() - datei.stat().st_mtime < BASIS_TTL:
        try:
            stil = json.loads(datei.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            stil = None
    if stil is None:
        try:
            req = urllib.request.Request(BASIS_URL, headers={"User-Agent": "ReisezoomGPSStudio"})
            with urllib.request.urlopen(req, timeout=timeout, context=_net.ssl_context()) as r:   # noqa: S310 — feste https-Adresse
                stil = json.loads(r.read().decode("utf-8"))
            if datei:
                datei.parent.mkdir(parents=True, exist_ok=True)
                datei.write_text(json.dumps(stil), encoding="utf-8")
        except Exception:  # noqa: BLE001
            if datei and datei.exists():   # ohne Netz: alter Stand
                stil = json.loads(datei.read_text(encoding="utf-8"))
            else:
                raise
    with _lock:
        _basis[BASIS_URL] = (time.time(), stil)
    return stil


def stil_json(name: str, cache_dir: Optional[Path] = None) -> bytes:
    """Fertiger Stil als JSON-Bytes für die Kachel-Weiche."""
    if name not in PALETTEN:
        raise KeyError(name)
    return json.dumps(umfaerben(_basis_laden(cache_dir), name), separators=(",", ":")).encode("utf-8")


def parse_pfad(pfad: str) -> Optional[str]:
    """`/stil/nacht.json` → "nacht" (nur bekannte Namen)."""
    m = re.fullmatch(r"/stil/([a-z]{2,20})\.json", pfad.split("?", 1)[0])
    return m.group(1) if m and m.group(1) in PALETTEN else None
