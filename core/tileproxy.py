"""Kachel-Weiche für die staatlichen Orthofotos — holt, speichert, reicht durch.

03.09.2026. Zwei Gründe, die Kacheln nicht direkt aus dem Browser zu laden:

  1. **CORS.** WebGL-Karten (MapLibre/Mapbox GL) laden Raster-Kacheln per
     `fetch()`; der Dienst muss dafür `Access-Control-Allow-Origin` senden.
     Schleswig-Holstein, Sachsen-Anhalt und Sachsen tun das nicht — die
     Vorschau blieb dort leer, obwohl die Kachel per curl kam.
  2. **Zwischenspeicher.** Vorschau und Render laden dieselben Kacheln; über
     die Weiche teilen sie sich einen Speicher (`_tilecache` im App-Support).
     MapTiler erlaubt ihn ausdrücklich, die OSM-Policy verlangt ihn.

Der lokale Media-Server der App (app.py, 127.0.0.1) beantwortet
`/tile/<region>/<z>/<x>/<y>[?t=1][&g=70][&s=100]` über `fetch_tile()`. `g` = Farbkorrektur in %, `s` = Nachschärfen in % (`fetch_tile_farbe`). `t=1` = PNG mit
Alpha (Stapel mehrerer Bundesländer). Die Adresse des Dienstes kennt nur diese
Datei — der Browser sieht nie die Original-URL.

Speicherformat je Datei: erste Zeile Content-Type, dann die Bytes — dasselbe
Format wie der Playwright-Zwischenspeicher in core/animator.py, damit beide
dieselben Dateien lesen.
"""
from __future__ import annotations

import hashlib
import logging
import math
import os
import time
import re
import urllib.request
from pathlib import Path
from typing import Optional

from . import mapstyles as ms
from . import dateischutz as _ds  # 14.09.2026: jeder Datei-Eingriff geprüft + gesichert

_log = logging.getLogger("rzgps.tileproxy")

# 30.09.2026 (Marc: 14-Minuten-Render, der spanische Luftbild-Dienst antwortete 140× mit 502) — gescheiterte
# Kacheln merken: statt bei JEDEM Bild neu zu versuchen (und bis zur Zeitgrenze zu warten), liefert die Weiche
# eine durchsichtige Ersatz-Kachel (darunter liegt Sentinel) und versucht es EINMAL im Hintergrund nach
# NACHHOLEN_S Sekunden — klappt es, liegt die Kachel für die nächsten Male im Speicher. Die Ersatz-Kachel trägt
# den Kopf ERSATZ_HEADER und wird NIE gespeichert (weder hier noch im Playwright-Speicher der Szene).
import threading as _threading
NACHHOLEN_S = 20.0
ERSATZ_HEADER = "X-RZ-Ersatz"
_LEER_PNG = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63606060600000000500017aa857500000000049454e44ae426082")   # 1×1 durchsichtig
_fehl_lock = _threading.Lock()
_fehl: dict = {}          # (region, z, x, y, t) → {"t": zeitpunkt, "nachgeholt": bool}
_stoerung: dict = {}      # region → {"name": str, "fehlend": set(), "nachgeholt": int}

# 05.10.2026 (Audit K-2/G-6: Luftbild Spanien 502 → jedes Bild wartete 1–8 s auf NEUE Kacheln, 0,5 fps, ~20 min statt
# ~2 min für 20 s Video) — Sicherung je Dienst: nach DIENST_TOT_NACH Fehlschlägen in Folge gilt der Dienst DIENST_TOT_S
# lang als ausgefallen; in der Zeit kommt sofort die Ersatz-Kachel (kein Netz, kein Warten), danach EIN Probeversuch.
# Klappt der, ist der Dienst wieder da. Je Render (stoerungen_zuruecksetzen) beginnt alles neu.
DIENST_TOT_NACH = 6
DIENST_TOT_S = 120.0
_dienst_serie: dict = {}  # region → Fehlschläge in Folge
_dienst_tot: dict = {}    # region → Zeitpunkt, bis zu dem er als ausgefallen gilt
# Audit E-5: Ersatzbilder mit Obergrenze (vorher ungebremst) und EIN Nachhol-Faden statt eines Timers je Kachel
ERSATZ_MAX = 500
_nachhol: dict = {}       # key → (fällig_um, funktion)
_nachhol_faden = None
FEHL_VERGESSEN_S = 600.0  # in der Vorschau (ohne Render) gemerkte Fehler nach 10 min neu versuchen
_ohne_abdeckung_gemeldet: set = set()   # 16.10.2026 — Region einmal je Sitzung loggen, wenn sie 404 (= keine Abdeckung) liefert
_geladen = {"bytes": 0, "kacheln": 0}   # 30.09.2026 — aus dem Netz geladen seit dem letzten Zurücksetzen (Log je Render)


class _Ersatz(bytes):
    """Ersatz-Kachel (nie speichern, nie im Browser zwischenspeichern)."""


_LEER_ERSATZ = _Ersatz(_LEER_PNG)


def _keine_abdeckung_png() -> bytes:
    """16.10.2026 — „hier kein Luftbild“ (Dienst antwortet 404): 256×256 durchsichtig. Bewusst NICHT das 1×1-PNG der
    Ersatz-Kachel: diese Kachel darf in den Speicher, und Prüfungen erkennen Ersatz-Kacheln dort an 1×1."""
    try:
        import io
        from PIL import Image
        b = io.BytesIO(); Image.new("RGBA", (256, 256), (0, 0, 0, 0)).save(b, "PNG", optimize=True)
        return b.getvalue()
    except Exception:  # noqa: BLE001
        return _LEER_PNG


_KEINE_ABDECKUNG_PNG = _keine_abdeckung_png()
_ersatz_bild: dict = {}   # key → _Ersatz (aus der Elternkachel geschnitten), solange die Kachel fehlt


def ist_ersatz(body: bytes) -> bool:
    return isinstance(body, _Ersatz)


_parallel_lock = _threading.Lock()
_parallel: dict = {}      # region → Semaphore (region["max_parallel"])


def _drossel(region: Optional[dict]):
    """Höchstens region["max_parallel"] Abrufe zugleich beim Dienst (30.09.2026, PNOA: viele zugleich → 502)."""
    n = int((region or {}).get("max_parallel") or 0)
    if n <= 0:
        return None
    with _parallel_lock:
        sem = _parallel.get(region["id"])
        if sem is None:
            sem = _parallel[region["id"]] = _threading.BoundedSemaphore(n)
    return sem


# 29.10.2026 (Lizenzprüfung: swisstopo erlaubt je Gerät 1.200 Abrufe pro Minute, sonst Kontakt VOR der Inbetriebnahme) —
# höchstens region["max_pro_minute"] Abrufe je Minute beim Dienst: die Abrufe starten im Abstand 60/n s. Gilt für alle
# Seiten eines Renders zusammen (Vorläufer + Bildschleife), weil alle über diese Weiche gehen.
_takt_lock = _threading.Lock()
_takt_naechster: dict = {}   # region → frühester Start des nächsten Abrufs (time.monotonic)


def _takt(region: Optional[dict]) -> float:
    """Wartet, bis der nächste Abruf beim Dienst erlaubt ist. Liefert die gewartete Zeit (s)."""
    n = int((region or {}).get("max_pro_minute") or 0)
    if n <= 0:
        return 0.0
    abstand = 60.0 / n
    with _takt_lock:
        jetzt = time.monotonic()
        start = max(jetzt, _takt_naechster.get(region["id"], 0.0))
        _takt_naechster[region["id"]] = start + abstand
    warte = start - jetzt
    if warte > 0:
        time.sleep(warte)
    return warte


def _cache_suffix(region: Optional[dict], z: int) -> str:
    return SEA_MASK_VERSION if (region is not None and region.get("sea_mask") and z <= SEA_MASK_MAX_Z) else ""


def _eltern_ersatz(region_id: str, z: int, x: int, y: int, transparent: bool, cache_dir) -> Optional[bytes]:
    """30.09.2026 (Marc: „die fehlenden Kacheln springen hin und her" — helle Sentinel-Flecken, die zwischen
    zwei Zoomstufen blinken): Ersatz aus der nächstgröberen Kachel DESSELBEN Dienstes, die schon im Speicher
    liegt (bis 4 Stufen), passendes Viertel/Sechzehntel ausgeschnitten und hochskaliert. Dasselbe Luftbild,
    nur weicher — keine Farbkante, kein Blinken."""
    if not cache_dir:
        return None
    region = next((r for r in ms.ORTHO_REGIONS if r["id"] == region_id), None)
    if region is None:
        return None
    for k in range(1, 5):
        pz = z - k
        if pz < 0:
            break
        px, py = x >> k, y >> k
        try:
            cp = cache_path(Path(cache_dir), upstream_url(region, pz, px, py, transparent) + _cache_suffix(region, pz))
            if not cp.exists():
                continue
            raw = cp.read_bytes(); nl = raw.index(b"\n")
            from io import BytesIO
            from PIL import Image
            im = Image.open(BytesIO(raw[nl + 1:])).convert("RGBA")
            w = im.size[0]; teil = w / (2 ** k)
            ox, oy = (x - (px << k)) * teil, (y - (py << k)) * teil
            aus = im.crop((int(round(ox)), int(round(oy)), int(round(ox + teil)), int(round(oy + teil)))).resize((w, w), Image.BILINEAR)
            out = BytesIO(); aus.save(out, format="PNG", compress_level=3)
            return out.getvalue()
        except Exception as e:      # noqa: BLE001
            _log.debug("Eltern-Ersatz z%d: %s", pz, e)
    return None


def _ersatz_fuer(key: tuple, cache_dir) -> bytes:
    b = _ersatz_bild.get(key)
    if b is None:
        e = _eltern_ersatz(key[0], key[1], key[2], key[3], key[4], cache_dir)
        b = _Ersatz(e) if e else _LEER_ERSATZ
        if e:
            with _fehl_lock:
                while len(_ersatz_bild) >= ERSATZ_MAX:          # ältestes zuerst raus (dict hält die Reihenfolge)
                    _ersatz_bild.pop(next(iter(_ersatz_bild)), None)
                _ersatz_bild[key] = b
    return b


def stoerungen() -> dict:
    """Region → {name, fehlend (Anzahl Kacheln, die gerade fehlen), nachgeholt}. Für Render-Hinweis und Log."""
    with _fehl_lock:
        return {r: {"name": v["name"], "fehlend": len(v["fehlend"]), "nachgeholt": v["nachgeholt"]} for r, v in _stoerung.items()}


def stoerungen_zuruecksetzen() -> None:
    """Zu Beginn jedes Renders: Zähler leeren UND gemerkte Fehler vergessen (der Dienst bekommt eine neue Chance)."""
    with _fehl_lock:
        _stoerung.clear()
        _fehl.clear()
        _ersatz_bild.clear()
        _dienst_serie.clear()
        _dienst_tot.clear()
        _nachhol.clear()
        _geladen["bytes"] = 0; _geladen["kacheln"] = 0


def geladen() -> dict:
    """Über die Weiche aus dem Netz geladen seit dem letzten Zurücksetzen: {"bytes", "kacheln"}."""
    with _fehl_lock:
        return dict(_geladen)


def _region_name(region_id: str) -> str:
    r = next((x for x in ms.ORTHO_REGIONS if x.get("id") == region_id), None)
    return ("Luftbild " + r["name"]) if (r and r.get("name")) else region_id


def _fehler_merken(key: tuple, nachholen) -> None:
    with _fehl_lock:
        neu = key not in _fehl
        _fehl[key] = {"t": time.time()}
        st = _stoerung.setdefault(key[0], {"name": _region_name(key[0]), "fehlend": set(), "nachgeholt": 0})
        st["fehlend"].add(key[1:])
    if neu:
        _nachholen_planen(key, nachholen)


def _nachholen_planen(key: tuple, nachholen) -> None:
    """Audit E-5 (05.10.2026): ein einziger Faden arbeitet die fälligen Nachholversuche ab — vorher lebte je
    gescheiterter Kachel ein eigener Timer-Faden 20 s lang (bei einem flächigen Ausfall Tausende gleichzeitig)."""
    global _nachhol_faden
    with _fehl_lock:
        _nachhol[key] = (time.time() + NACHHOLEN_S, nachholen)
        if _nachhol_faden is None or not _nachhol_faden.is_alive():
            _nachhol_faden = _threading.Thread(target=_nachhol_schleife, daemon=True, name="kachel-nachholen")
            _nachhol_faden.start()


def _nachhol_schleife() -> None:
    while True:
        time.sleep(1.0)
        jetzt = time.time()
        with _fehl_lock:
            faellig = [(k, fn) for k, (t, fn) in _nachhol.items() if t <= jetzt]
            for k, _fn in faellig:
                _nachhol.pop(k, None)
        for k, fn in faellig:
            if dienst_ausgefallen(k[0]):
                # Dienst gilt gerade als ausgefallen — kein Netz jetzt, aber auf das Ende der Sperre verschieben
                # (nicht verwerfen: sonst bliebe die Kachel bis zum nächsten Render Ersatz)
                with _fehl_lock:
                    _nachhol[k] = (_dienst_tot.get(k[0], jetzt) + 0.5, fn)
                continue
            try:
                fn()
            except Exception as e:  # noqa: BLE001
                _log.debug("Nachholen %s: %s", k, e)


def dienst_ausgefallen(region_id: str) -> bool:
    with _fehl_lock:
        bis = _dienst_tot.get(region_id)
    return bool(bis and time.time() < bis)


def _dienst_ergebnis(region_id: str, ok: bool) -> None:
    with _fehl_lock:
        if ok:
            if _dienst_tot.pop(region_id, None):
                _log.info("Kartendienst %s antwortet wieder", region_id)
            _dienst_serie[region_id] = 0
            return
        n = _dienst_serie[region_id] = _dienst_serie.get(region_id, 0) + 1
        if n >= DIENST_TOT_NACH and not (_dienst_tot.get(region_id, 0) > time.time()):
            _dienst_tot[region_id] = time.time() + DIENST_TOT_S
            _log.warning("Kartendienst %s: %d Fehlschläge in Folge — %d s lang Ersatz-Kacheln ohne Warten",
                         region_id, n, int(DIENST_TOT_S))
_UA = {"User-Agent": "ReisezoomGPSStudio (+https://reisezoom.com/gps)"}


def _bbox3857(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    n = 2 ** z
    r = 6378137.0 * math.pi
    return (x / n * 2 * r - r, r - (y + 1) / n * 2 * r, (x + 1) / n * 2 * r - r, r - y / n * 2 * r)


OVERSAMPLE_MAX = 4          # höchstens 4× (1024 px) je Kachel anfordern
TILE_OUT_PX = 512           # überabgetastete Kacheln auf diese Kantenlänge verkleinern


def oversample_factor(region: dict, z: int) -> int:
    """Wie viel größer (Faktor) eine WMS-Kachel angefordert wird, damit der
    Dienst das Mosaik der `scale_z`-Skala rendert (PNOA: sonst Farbkante)."""
    sz = region.get("scale_z")
    if not sz or not region.get("wms") or z >= sz:
        return 1
    if z < int(sz) - 2:            # z ≤ 11: selbst 4× reicht nicht mehr (gemessen), nur teuer — lassen
        return 1
    return int(min(OVERSAMPLE_MAX, 2 ** (int(sz) - z)))


def upstream_url(region: dict, z: int, x: int, y: int, transparent: bool = False) -> str:
    """Die echte Adresse einer Kachel — XYZ, TMS (y gespiegelt) oder WMS (bbox)."""
    tpl = ms.region_tiles(region, transparent=transparent)[0]
    yy = (2 ** z - 1 - y) if region.get("scheme") == "tms" else y
    u = tpl.replace("{z}", str(z)).replace("{x}", str(x)).replace("{y}", str(yy))
    if "{bbox-epsg-3857}" in u:
        u = u.replace("{bbox-epsg-3857}", ",".join(f"{c:.3f}" for c in _bbox3857(z, x, y)))
    f = oversample_factor(region, z)
    if f > 1:
        u = u.replace("WIDTH=256&HEIGHT=256", f"WIDTH={256 * f}&HEIGHT={256 * f}")
    return u


def wms_oversample_url(url: str):
    """Für den Render ohne Weiche (Playwright-Route): WMS-Adresse aus dem Stil
    → (ggf. vergrößerte Adresse, Faktor). Zoom aus der BBOX-Breite."""
    if "SERVICE=WMS" not in url or "WIDTH=256&HEIGHT=256" not in url:
        return url, 1
    region = next((r for r in ms.ORTHO_REGIONS if r.get("wms") and url.startswith(r["wms"]["base"])), None)
    if region is None or not region.get("scale_z"):
        return url, 1
    m = re.search(r"BBOX=([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)", url)
    if not m:
        return url, 1
    w = abs(float(m.group(3)) - float(m.group(1)))
    if w <= 0:
        return url, 1
    z = int(round(math.log2(2 * 6378137.0 * math.pi / w)))
    f = oversample_factor(region, z)
    if f <= 1:
        return url, 1
    return url.replace("WIDTH=256&HEIGHT=256", f"WIDTH={256 * f}&HEIGHT={256 * f}"), f


def downscale_tile(body: bytes, ct: str, size: int = TILE_OUT_PX) -> tuple[bytes, str]:
    """Überabgetastete Kachel auf `size` px verkleinern (PNG bleibt PNG mit Alpha)."""
    try:
        from io import BytesIO
        from PIL import Image
        im = Image.open(BytesIO(body))
        if max(im.size) <= size:
            return body, ct
        im = im.convert("RGBA" if "png" in ct else "RGB")
        im = im.resize((size, size), Image.LANCZOS)
        out = BytesIO()
        if "png" in ct:
            im.save(out, format="PNG", compress_level=3); return out.getvalue(), "image/png"
        im.save(out, format="JPEG", quality=88); return out.getvalue(), "image/jpeg"
    except Exception as e:      # noqa: BLE001
        _log.debug("downscale_tile: %s", e)
        return body, ct


# 04.09.2026 (Marc: „mach 90 Tage Cache"): Landesluftbilder werden neu
# beflogen, Geländedaten aktualisiert — eine Kachel gilt 90 Tage, danach wird
# sie neu geholt (Weiche, Render-Route) bzw. beim Aufräumen gelöscht.
TILE_CACHE_MAX_AGE_S = 90 * 86400


def cache_fresh(path: Path) -> bool:
    """Datei vorhanden und jünger als TILE_CACHE_MAX_AGE_S?"""
    try:
        return path.exists() and (time.time() - path.stat().st_mtime) < TILE_CACHE_MAX_AGE_S
    except OSError:
        return False


def cache_path(cache_dir: Path, url: str) -> Path:
    h = hashlib.sha1(url.encode("utf-8")).hexdigest()
    return cache_dir / h[:2] / (h + ".bin")


TERRARIUM_HOST = "elevation-tiles-prod/terrarium"
# 11.10.2026 (Marc: „probier direkt aus“) — Höhen von Mapterhorn (freie amtliche Geländemodelle: Deutschland 1 m,
# Alpenländer/Skandinavien/UK 0,5–2 m, Spanien 2 m, sonst 30 m) statt der AWS-Kacheln (meist 30–90 m, an Kachel-
# grenzen Nähte). Gleiche Terrarium-Kodierung, aber 512 px WebP — wir schneiden aus der Kachel eine Stufe tiefer das
# passende Viertel heraus und liefern es als 256er PNG: Stile, Kachelraster und Klemme bleiben unverändert.
# Antwortet Mapterhorn nicht, kommt die AWS-Kachel. `RZ_TERRAIN=aws` erzwingt die alte Quelle (Vergleiche).
# Nur das geklemmte Gelände: Meerestiefen (`terrain-aws-roh`, Seekarte) gibt es nur bei AWS.
MAPTERHORN_URL = "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp"


def terrain_quelle() -> str:
    return "aws" if os.environ.get("RZ_TERRAIN", "").strip().lower() == "aws" else "mapterhorn"


def _mapterhorn_viertel(z: int, x: int, y: int, cache_dir, timeout: float) -> Optional[bytes]:
    """256er Terrarium-PNG für z/x/y aus der 512er Mapterhorn-Kachel z-1 (oder None)."""
    if z < 1:
        return None
    from io import BytesIO
    from PIL import Image
    from . import net
    url = MAPTERHORN_URL.replace("{z}", str(z - 1)).replace("{x}", str(x // 2)).replace("{y}", str(y // 2))
    cp = cache_path(Path(cache_dir), url) if cache_dir else None
    roh = None
    if cp is not None and cache_fresh(cp):
        try:
            roh = cp.read_bytes()
        except OSError:
            roh = None
    if roh is None:
        for _versuch in range(2):
            try:
                req = urllib.request.Request(url, headers=_UA)
                with urllib.request.urlopen(req, timeout=timeout, context=net.ssl_context()) as resp:
                    roh = resp.read()
                break
            except Exception as e:  # noqa: BLE001
                code = getattr(e, "code", None)
                if code is not None and int(code) < 500:
                    return None              # 404: hier keine Kachel → AWS
                if _versuch == 1:
                    _log.info("Mapterhorn z%d/%d/%d: %s", z - 1, x // 2, y // 2, e)
                    return None
                time.sleep(1.0)
        with _fehl_lock:
            _geladen["bytes"] += len(roh); _geladen["kacheln"] += 1
        if cp is not None and len(roh) < 8_000_000:
            try:
                cp.parent.mkdir(parents=True, exist_ok=True)
                tmp = cp.with_name(cp.name + f".{os.getpid()}.tmp")
                tmp.write_bytes(roh)
                _ds.ersetzen(tmp, cp, "kachel", art=_ds.ART_CACHE)
            except OSError as e:
                _log.debug("Zwischenspeicher: %s", e)
    try:
        im = Image.open(BytesIO(roh)).convert("RGB")
        h = im.width // 2
        q = im.crop(((x % 2) * h, (y % 2) * h, (x % 2) * h + h, (y % 2) * h + h))
        if q.width != 256:
            q = q.resize((256, 256), Image.NEAREST)   # Terrarium nie mitteln (Farbkanäle sind Stellen einer Zahl)
        out = BytesIO(); q.save(out, format="PNG", compress_level=1)
        return out.getvalue()
    except Exception as e:  # noqa: BLE001
        _log.info("Mapterhorn-Kachel unlesbar z%d/%d/%d: %s", z - 1, x // 2, y // 2, e)
        return None
AWS_MAXZOOM = 15   # AWS-Terrarium hat keine feinere Stufe


def _gelaende_vergroessert(region_id: str, z: int, x: int, y: int, cache_dir, timeout: float) -> tuple[int, str, bytes]:
    """Geländekachel über AWS_MAXZOOM aus der Elternkachel z15: Ausschnitt, Höhen bilinear vergrößert (Terrarium erst
    entschlüsseln — die Farbkanäle sind Stellen einer Zahl, die darf man nicht mitteln)."""
    from io import BytesIO
    import numpy as _np
    from PIL import Image
    k = 1 << (z - AWS_MAXZOOM)
    st, ct, body = _fetch_tile_roh(region_id, AWS_MAXZOOM, x // k, y // k, False, cache_dir, timeout)
    if st != 200 or not body:
        return st, ct, body
    try:
        a = _np.asarray(Image.open(BytesIO(body)).convert("RGB"), _np.float32)
        h = a[..., 0] * 256.0 + a[..., 1] + a[..., 2] / 256.0 - 32768.0
        n = a.shape[0] // k
        ox, oy = (x % k) * n, (y % k) * n
        teil = Image.fromarray(h[oy:oy + n, ox:ox + n].astype(_np.float32), "F").resize((256, 256), Image.BILINEAR)
        v = _np.asarray(teil, _np.float64) + 32768.0
        r = _np.clip(_np.floor(v / 256.0), 0, 255); g = _np.clip(_np.floor(v - r * 256.0), 0, 255)
        b = _np.clip(_np.round((v - r * 256.0 - g) * 256.0), 0, 255)
        out = BytesIO()
        Image.fromarray(_np.stack([r, g, b], -1).astype(_np.uint8), "RGB").save(out, "PNG", compress_level=1)
        return 200, "image/png", out.getvalue()
    except Exception as e:  # noqa: BLE001
        _log.info("Gelände z%d/%d/%d vergrößern: %s", z, x, y, e)
        return st, ct, body


CLAMP_KEY_SUFFIX = "#clamp0"     # eigener Schlüssel: alte, ungeklemmte Kacheln bleiben liegen


def is_terrarium_url(url: str) -> bool:
    return TERRARIUM_HOST in url


def clamp_terrarium(body: bytes) -> bytes:
    """Terrarium-PNG: Höhe = R·256 + G + B/256 − 32768. Alles unter 0 m
    (R < 128, also Meeresboden) wird auf genau 0 m gesetzt (128,0,0) — sonst
    steht an jeder Küste eine Klippe bis zum Meeresgrund. Bei Fehlern
    kommt die Kachel unverändert zurück."""
    try:
        from io import BytesIO
        from PIL import Image
        im = Image.open(BytesIO(body)).convert("RGB")
        r = im.split()[0]
        mask = r.point(lambda v: 255 if v < 128 else 0)
        if not mask.getbbox():
            return body
        im.paste((128, 0, 0), mask=mask)
        out = BytesIO(); im.save(out, format="PNG", compress_level=1)
        return out.getvalue()
    except Exception as e:      # noqa: BLE001
        _log.debug("clamp_terrarium: %s", e)
        return body


SEA_MASK_DEPTH = -3.0      # tiefer als 3 m = Meer (Küsten-Rauschen im DEM bleibt Land)
# Meerestiefen stecken in AWS-Terrarium nur bis z10 (darüber ist das Meer 0 m,
# 04.09.2026 gemessen) → Maske immer aus der z10-Kachel (≈150 m/px) schneiden.
_TERRAIN_RAW_MAX_Z = 10
SEA_MASK_MAX_Z = 18        # alle Kacheln gleich behandeln — sonst Stufen zwischen den Zoomstufen


def _terrarium_raw(z: int, x: int, y: int, cache_dir, timeout: float = 30.0):
    """UNgeklemmte Terrarium-Kachel als PIL-RGB (oder None). Eigener Cache-Schlüssel."""
    from io import BytesIO
    from PIL import Image
    from . import net
    url = ms.TERRAIN["aws"]["tiles"][0].replace("{z}", str(z)).replace("{x}", str(x)).replace("{y}", str(y))
    cp = cache_path(Path(cache_dir), url + "#raw") if cache_dir else None
    body = None
    if cp is not None and cache_fresh(cp):
        try:
            raw = cp.read_bytes(); body = raw[raw.index(b"\n") + 1:]
        except Exception:
            body = None
    if body is None:
        try:
            req = urllib.request.Request(url, headers=_UA)
            with urllib.request.urlopen(req, timeout=timeout, context=net.ssl_context()) as resp:
                body = resp.read()
        except Exception as e:      # noqa: BLE001
            _log.debug("terrarium raw %d/%d/%d: %s", z, x, y, e)
            return None
        if cp is not None:
            try:
                cp.parent.mkdir(parents=True, exist_ok=True)
                tmp = cp.with_name(cp.name + f".{os.getpid()}.tmp"); tmp.write_bytes(b"image/png\n" + body)
                _ds.ersetzen(tmp, cp, "kachel", art=_ds.ART_CACHE)
            except OSError:
                pass
    try:
        return Image.open(BytesIO(body)).convert("RGB")
    except Exception:
        return None


def sea_mask_for(z: int, x: int, y: int, size: int, cache_dir):
    """PIL-L-Maske (255 = Land/behalten, 0 = Meer) in `size`×`size` für die
    Kachel z/x/y — aus der Terrarium-Kachel derselben Lage (bei z > 15 aus der
    Elternkachel ausgeschnitten). None, wenn keine Höhendaten kommen.
    Höhe = R·256 + G + B/256 − 32768; Meer (< −3 m) ⇔ R < 127 oder (R == 127 und G < 253)."""
    from PIL import Image
    zz, xx, yy, crop = z, x, y, None
    if z > _TERRAIN_RAW_MAX_Z:
        d = z - _TERRAIN_RAW_MAX_Z
        zz, xx, yy = _TERRAIN_RAW_MAX_Z, x >> d, y >> d
        n = 1 << d; sub = 256 // n
        crop = ((x % n) * sub, (y % n) * sub, (x % n) * sub + sub, (y % n) * sub + sub)
    im = _terrarium_raw(zz, xx, yy, cache_dir)
    if im is None:
        return None
    if crop:
        im = im.crop(crop)
    r, g, _b = im.split()
    land_r = r.point(lambda v: 255 if v >= 128 else 0)                 # R ≥ 128: sicher Land
    edge_r = r.point(lambda v: 255 if v == 127 else 0)                 # R == 127: −256…−1 m
    land_g = g.point(lambda v: 255 if v >= 253 else 0)                 # davon ≥ −3 m: Land
    from PIL import ImageChops
    mask = ImageChops.lighter(land_r, ImageChops.multiply(edge_r, land_g))
    if mask.size != (size, size):
        mask = mask.resize((size, size), Image.BILINEAR)
    return mask


# 25.09.2026 (Klicktest AN-01: „Satellit kostenlos zeigt über dem Meer dauerhaft kantige
# schwarze Flächen", Teneriffa/Los Cristianos) — die Meer-Maske kommt aus der z10-Terrarium-
# Kachel (≈150 m/px), und dort steht das Meer küstennah auf 0 m statt darunter. Ein bis zwei
# DEM-Pixel breit (bei z13 je 8×8 Kachelpixel) galt es deshalb als Land, PNOA blieb dort
# opak fast schwarz (gemessen RGB ≈ 7–12/12–23/18–29) → Treppen-Rechtecke vor der Küste.
# Die z10-Kachel ist dort zudem geglättet: offenes Meer 1 km vor Los Cristianos stand auf
# +35…60 m. Oberhalb z10 ist das Meer in Terrarium dagegen FLACH 0 m und die Küstenlinie
# scharf (z13 gemessen). Zusätzlich jetzt: wo die hochauflösende Terrarium-Kachel ≤ 0 m
# zeigt (Meer oder Strand auf Meereshöhe), werden PNOA-Pixel durchsichtig, die so dunkel
# und blaustichig sind wie dieses Meer — darunter liegen Sentinel-2 und Blue Marble.
# Helles Küstenwasser (türkis) bleibt, Land über 0 m bleibt unangetastet (dunkle Lava).
_KUESTE_RAW_MAX_Z = 15      # AWS-Terrarium reicht bis z15; darüber aus der Elternkachel
MEER_DUNKEL_MAX = 40        # hellster Kanal eines „Meer"-Pixels (0–255)
MEER_BLAU_MIN = 4           # Blau mindestens so viel über Rot (neutral-dunkle Schatten bleiben)
SEA_MASK_VERSION = "#sea2"  # Zwischenspeicher-Schlüssel — alte Kacheln (#sea1) neu rechnen


def kuesten_maske_for(z: int, x: int, y: int, size: int, cache_dir):
    """PIL-L-Maske (255 = DEM ≤ 0 m, also Meer/Meereshöhe) für z/x/y aus der Terrarium-
    Kachel DERSELBEN Zoomstufe (bis z15), weich hochskaliert. None ohne Höhendaten.
    Höhe < 1 m ⇔ R < 128 oder (R == 128 und G == 0)."""
    from PIL import Image, ImageChops
    zz, xx, yy, crop = z, x, y, None
    if z > _KUESTE_RAW_MAX_Z:
        d = z - _KUESTE_RAW_MAX_Z
        zz, xx, yy = _KUESTE_RAW_MAX_Z, x >> d, y >> d
        n = 1 << d; sub = 256 // n
        crop = ((x % n) * sub, (y % n) * sub, (x % n) * sub + sub, (y % n) * sub + sub)
    im = _terrarium_raw(zz, xx, yy, cache_dir)
    if im is None:
        return None
    if crop:
        im = im.crop(crop)
    r, g, _b = im.split()
    unter = r.point(lambda v: 255 if v < 128 else 0)
    genau = ImageChops.multiply(r.point(lambda v: 255 if v == 128 else 0),
                                g.point(lambda v: 255 if v == 0 else 0))
    mask = ImageChops.lighter(unter, genau)
    if mask.size != (size, size):
        mask = mask.resize((size, size), Image.BILINEAR)
    return mask


def meer_dunkel_maske(im):
    """PIL-L-Maske (255 = so dunkel und blaustichig wie PNOA-Meer) eines RGB(A)-Bilds."""
    from PIL import ImageChops
    r, g, b = im.convert("RGB").split()
    hellster = ImageChops.lighter(ImageChops.lighter(r, g), b)
    dunkel = hellster.point(lambda v: 255 if v <= MEER_DUNKEL_MAX else 0)
    blau = ImageChops.subtract(b, r).point(lambda v: 255 if v >= MEER_BLAU_MIN else 0)   # B > R
    return ImageChops.multiply(dunkel, blau)


def apply_sea_mask(body: bytes, ct: str, z: int, x: int, y: int, cache_dir) -> tuple[bytes, str]:
    """Orthofoto-Kachel: Meerpixel durchsichtig machen (PNG mit Alpha)."""
    try:
        from io import BytesIO
        from PIL import Image, ImageChops
        im = Image.open(BytesIO(body)).convert("RGBA")
        mask = sea_mask_for(z, x, y, im.size[0], cache_dir)
        kueste = kuesten_maske_for(z, x, y, im.size[0], cache_dir)
        weg = None
        if kueste is not None and kueste.getbbox():
            weg = ImageChops.multiply(kueste, meer_dunkel_maske(im))
            if not weg.getbbox():
                weg = None
        if (mask is None or mask.getextrema() == (255, 255)) and weg is None:
            return body, ct                       # keine Höhendaten / kein Meer in dieser Kachel
        alpha = im.split()[3]
        if mask is not None:
            alpha = ImageChops.multiply(alpha, mask)
        if weg is not None:
            alpha = ImageChops.multiply(alpha, ImageChops.invert(weg))
        im.putalpha(alpha)
        out = BytesIO(); im.save(out, format="PNG", compress_level=3)
        return out.getvalue(), "image/png"
    except Exception as e:      # noqa: BLE001
        _log.debug("apply_sea_mask: %s", e)
        return body, ct


# 14.09.2026 (Beta-Tester: „Access blocked – App is not following the tile usage policy of OSM's
# volunteer-run servers"): Die freien OSM-Rasterdienste verlangen eine erkennbare App-Kennung und
# sperren Anfragen ohne gültigen Referer — genau das schickt eine WebView (file://). In der App
# laufen diese Kacheln deshalb über die lokale Weiche: mit User-Agent, Zwischenspeicher und nur so
# vielen Anfragen, wie die Karte wirklich braucht. Exportierte Web-Karten laden weiter direkt.
RASTER_DIENSTE = {
    "osm": ("https://tile.openstreetmap.org/{z}/{x}/{y}.png", None),
    "topo": ("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", "abc"),
    "cyclosm": ("https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png", "abc"),
    "humanitarian": ("https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png", "abc"),
}


# 25.10.2026 — Sentinel-2 (EOX) auch über die Weiche: nur so bekommt es die Farbkorrektur je Kachel (core/farbkorrektur)
RASTER_DIENSTE["sentinel"] = (ms.SENTINEL_LAYER["tiles"][0], None)


def raster_dienst_url(dienst: str, z: int, x: int, y: int) -> Optional[str]:
    eintrag = RASTER_DIENSTE.get(dienst)
    if not eintrag:
        return None
    vorlage, subs = eintrag
    if subs:
        vorlage = vorlage.replace("{s}", subs[(x + y) % len(subs)])
    return vorlage.replace("{z}", str(z)).replace("{x}", str(x)).replace("{y}", str(y))


SCHATTEN_ID = "schatten"   # Weiche: /tile/schatten/{z}/{x}/{y} — Schlagschatten (core/schatten.py)


def fetch_tile(region_id: str, z: int, x: int, y: int, transparent: bool,
               cache_dir: Optional[Path], timeout: float = 30.0) -> tuple[int, str, bytes]:
    """(status, content_type, body). 404 bei unbekannter Region, 502 wenn der
    Dienst nicht antwortet. Erfolgreiche Bilder landen im Zwischenspeicher.
    `terrain-aws` = AWS-Terrarium mit Klemme (Meerestiefen → 0 m).
    Bild-Kacheln, die gescheitert sind: durchsichtige Ersatz-Kachel (`ist_ersatz`), einmal nachholen."""
    if region_id == SCHATTEN_ID:   # 23.10.2026 — Schlagschatten aus dem Höhenmodell (core/schatten.py)
        from . import schatten as _schatten
        try:
            return 200, "image/png", _schatten.kachel(z, x, y, cache_dir)
        except Exception as e:  # noqa: BLE001
            _log.warning("Schatten z%d/%d/%d: %s", z, x, y, e)
            return 200, "image/png", _schatten.leer()
    key = (region_id, z, x, y, bool(transparent))
    terrain_frage = region_id in (ms.TERRAIN_AWS_PROXY_ID, ms.TERRAIN_AWS_ROH_PROXY_ID)
    if not terrain_frage:
        with _fehl_lock:
            f = _fehl.get(key)
            if f is not None and time.time() - f.get("t", 0) > FEHL_VERGESSEN_S:
                _fehl.pop(key, None); f = None                         # alter Fehler: neue Chance
        if f is not None:
            return 200, "image/png", _ersatz_fuer(key, cache_dir)      # gemerkt: nicht erneut warten
        if dienst_ausgefallen(region_id):
            # Audit K-2: Dienst gilt als ausgefallen → Kachel aus dem Speicher, wenn sie dort liegt, sonst sofort Ersatz
            st0, ct0, body0 = _aus_speicher(region_id, z, x, y, transparent, cache_dir)
            if st0 == 200:
                return st0, ct0, body0
            _fehler_merken(key, _nachholer(key, cache_dir, timeout))
            return 200, "image/png", _ersatz_fuer(key, cache_dir)
    st, ct, body = _fetch_tile_roh(region_id, z, x, y, transparent, cache_dir, timeout)
    if not terrain_frage:
        _dienst_ergebnis(region_id, st != 502)
    if st == 502 and not terrain_frage:
        _fehler_merken(key, _nachholer(key, cache_dir, timeout))
        return 200, "image/png", _ersatz_fuer(key, cache_dir)
    return st, ct, body


def _nachholer(key: tuple, cache_dir, timeout: float):
    """Der eine Nachholversuch für eine gescheiterte Kachel (läuft im Nachhol-Faden)."""
    region_id, z, x, y, transparent = key

    def nachholen():
        s2, _c2, _b2 = _fetch_tile_roh(region_id, z, x, y, transparent, cache_dir, timeout)
        _dienst_ergebnis(region_id, s2 != 502)
        with _fehl_lock:
            if s2 == 200:
                _fehl.pop(key, None); _ersatz_bild.pop(key, None)
                sr = _stoerung.get(region_id)
                if sr is not None:
                    sr["fehlend"].discard(key[1:]); sr["nachgeholt"] += 1
            else:
                _fehl[key] = {"t": time.time()}
        _log.info("Kachel %s z%d/%d/%d nachgeholt: %s", region_id, z, x, y, "ok" if s2 == 200 else f"weiter Fehler {s2}")
    return nachholen


def _aus_speicher(region_id: str, z: int, x: int, y: int, transparent: bool, cache_dir) -> tuple:
    """Nur aus dem Zwischenspeicher (kein Netz) — (200, ct, body) oder (404, …)."""
    if not cache_dir:
        return 404, "text/plain", b""
    region = next((r for r in ms.ORTHO_REGIONS if r["id"] == region_id), None)
    if region is None:
        return 404, "text/plain", b""
    try:
        cp = cache_path(Path(cache_dir), upstream_url(region, z, x, y, transparent) + _cache_suffix(region, z))
        if cp.exists():
            raw = cp.read_bytes(); nl = raw.index(b"\n")
            return 200, raw[:nl].decode("ascii", "ignore") or "image/jpeg", raw[nl + 1:]
    except Exception:  # noqa: BLE001
        pass
    return 404, "text/plain", b""


def _fetch_tile_roh(region_id: str, z: int, x: int, y: int, transparent: bool,
                    cache_dir: Optional[Path], timeout: float = 30.0) -> tuple[int, str, bytes]:
    if z < 0 or z > 22:
        return 404, "text/plain", b"bad zoom"
    terrain = region_id in (ms.TERRAIN_AWS_PROXY_ID, ms.TERRAIN_AWS_ROH_PROXY_ID)
    klemmen = region_id == ms.TERRAIN_AWS_PROXY_ID   # roh (Kartenlook-Tiefen): Meeresboden bleibt
    region = None
    if region_id in RASTER_DIENSTE:
        url = raster_dienst_url(region_id, z, x, y)
    elif terrain:
        url = ms.TERRAIN["aws"]["tiles"][0].replace("{z}", str(z)).replace("{x}", str(x)).replace("{y}", str(y))
    else:
        region = next((r for r in ms.ORTHO_REGIONS if r["id"] == region_id), None)
        if region is None:
            return 404, "text/plain", b"unknown region"
        url = upstream_url(region, z, x, y, transparent)
    mh = klemmen and terrain_quelle() == "mapterhorn"   # roh (Meerestiefen der Seekarte) bleibt AWS: Mapterhorn hat keine
    if terrain and not mh and z > AWS_MAXZOOM:   # 23.10.2026 — AWS allein (RZ_TERRAIN=aws, Meerestiefen): aus z15
        return _gelaende_vergroessert(region_id, z, x, y, cache_dir, timeout)
    if mh:
        url = "mapterhorn:" + MAPTERHORN_URL.replace("{z}", str(z)).replace("{x}", str(x)).replace("{y}", str(y))
    if terrain:
        _suffix = CLAMP_KEY_SUFFIX if klemmen else ""   # geklemmt und roh liegen unter verschiedenen Schlüsseln
    else:
        _suffix = SEA_MASK_VERSION if (region is not None and region.get("sea_mask") and z <= SEA_MASK_MAX_Z) else ""
    cp = cache_path(Path(cache_dir), url + _suffix) if cache_dir else None   # eigener Schlüssel je Nachbearbeitung
    if cp is not None and cache_fresh(cp):
        try:
            raw = cp.read_bytes()
            nl = raw.index(b"\n")
            return 200, raw[:nl].decode("ascii", "ignore") or "image/jpeg", raw[nl + 1:]
        except Exception:
            pass
    from . import net
    body = b""; ct = ""; fehler = None
    if mh:
        body = _mapterhorn_viertel(z, x, y, cache_dir, timeout) or b""
        if body:
            ct = "image/png"
        elif z > AWS_MAXZOOM:   # 23.10.2026 — Feinstufe ohne Mapterhorn: AWS hat nur bis z15 → aus der z15-Kachel
            return _gelaende_vergroessert(region_id, z, x, y, cache_dir, timeout)
        else:   # keine Mapterhorn-Kachel → AWS (eigener Cache-Schlüssel wie bisher)
            url = ms.TERRAIN["aws"]["tiles"][0].replace("{z}", str(z)).replace("{x}", str(x)).replace("{y}", str(y))
            cp = cache_path(Path(cache_dir), url + _suffix) if cache_dir else None
            if cp is not None and cache_fresh(cp):
                try:
                    raw = cp.read_bytes(); nl = raw.index(b"\n")
                    return 200, raw[:nl].decode("ascii", "ignore") or "image/png", raw[nl + 1:]
                except Exception:  # noqa: BLE001
                    pass
    # 30.09.2026 (Marc, MacBook: der spanische Dienst antwortete bei vielen gleichzeitigen Anfragen mit 502 — zwei
    # Szene-Seiten × 16 Anfragen): höchstens region["max_parallel"] Abrufe zugleich, bei 5xx neuer Versuch nach 1 s / 2 s.
    _sem = _drossel(region)
    keine_abdeckung = False
    for _versuch in range(0 if body else 3):    # 04.09.2026: wiederholen — unter Last kippten einzelne Kacheln mit 502
        try:
            if _sem is not None:
                _sem.acquire()
            try:
                _takt(region)
                req = urllib.request.Request(url, headers=_UA)
                with urllib.request.urlopen(req, timeout=timeout, context=net.ssl_context()) as resp:
                    ct = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower()
                    body = resp.read()
            finally:
                if _sem is not None:
                    _sem.release()
            fehler = None
            with _fehl_lock:
                _geladen["bytes"] += len(body); _geladen["kacheln"] += 1
            break
        except Exception as e:      # noqa: BLE001
            fehler = e
            code = getattr(e, "code", None)
            if not terrain and code is not None and int(code) in (404, 410):
                # 16.10.2026 (Windows-Log, Tour an der deutsch-tschechischen Grenze): der tschechische Dienst
                # antwortet für Kacheln jenseits der Grenze mit 404 = „hier kein Luftbild“. Das wurde als Ausfall
                # gewertet (Ersatz, Nachholen, Dienst gesperrt, „antwortet nicht – 868 Kacheln fehlen“) und
                # erzeugte Hunderte unnötige Anfragen. Keine Abdeckung = durchsichtige Kachel, darunter die Grundkarte.
                keine_abdeckung = True; fehler = None
                break
            if _versuch < 2 and (code is None or int(code) >= 500):
                time.sleep(1.0 * (_versuch + 1))
    if keine_abdeckung:
        if region_id not in _ohne_abdeckung_gemeldet:
            _ohne_abdeckung_gemeldet.add(region_id)
            _log.info("Kartendienst %s: hier keine Abdeckung (404) — durchsichtige Kachel, z. B. z%d/%d/%d", region_id, z, x, y)
        ct, body = "image/png", _KEINE_ABDECKUNG_PNG
    if fehler is not None:
        _log.warning("Kachel %s z%d/%d/%d: %s", region_id, z, x, y, fehler)
        return 502, "text/plain", str(fehler).encode("utf-8", "ignore")
    if not ct.startswith("image/"):
        # WMS-Fehler kommen als XML mit Status 200 — nicht als Bild ausliefern
        return 502, "text/plain", body[:400]
    if terrain:
        if klemmen:
            body = clamp_terrarium(body)
    elif region is not None and not keine_abdeckung:
        if oversample_factor(region, z) > 1:
            body, ct = downscale_tile(body, ct)
        if region.get("sea_mask") and z <= SEA_MASK_MAX_Z:
            body, ct = apply_sea_mask(body, ct, z, x, y, cache_dir)
    if cp is not None and len(body) < 8_000_000:
        try:
            cp.parent.mkdir(parents=True, exist_ok=True)
            tmp = cp.with_name(cp.name + f".{os.getpid()}.tmp")
            tmp.write_bytes(ct.encode("ascii", "ignore") + b"\n" + body)
            _ds.ersetzen(tmp, cp, "kachel", art=_ds.ART_CACHE)
        except OSError as e:
            _log.debug("Zwischenspeicher: %s", e)
    return 200, ct, body


FARB_VERSION = "f1"   # Formel der Farbkorrektur (core/farbkorrektur) — ändert sie sich, neue Schlüssel


def farbe_aus_pfad(path: str) -> float:
    """`…?g=70` → 70.0 (Farbkorrektur in %), sonst 0."""
    _, _, q = path.partition("?")
    for teil in q.split("&"):
        if teil.startswith("g="):
            try:
                return max(0.0, min(100.0, float(teil[2:])))
            except ValueError:
                return 0.0
    return 0.0


def schaerfe_aus_pfad(path: str) -> float:
    """`…?s=100` → 100.0 (Nachschärfen in %, 100 = Stärke 1,0; 26.10.2026), sonst 0."""
    _, _, q = path.partition("?")
    for teil in q.split("&"):
        if teil.startswith("s="):
            try:
                return max(0.0, min(200.0, float(teil[2:])))
            except ValueError:
                return 0.0
    return 0.0


def fetch_tile_farbe(region_id: str, z: int, x: int, y: int, transparent: bool, prozent: float,
                     cache_dir: Optional[Path], timeout: float = 30.0, schaerfe: float = 0.0) -> tuple[int, str, bytes]:
    """Wie `fetch_tile`, Bild-Kacheln mit Farbkorrektur `prozent` (25.10.2026, statt der Leinwand-Ebene, die auf
    Apple-Grafik jedes Bild ausbremste). Ergebnis eigener Eintrag im Zwischenspeicher; Ersatz-Kacheln, Gelände und
    Schatten bleiben unverändert."""
    st, ct, body = fetch_tile(region_id, z, x, y, transparent, cache_dir, timeout)
    if ((prozent <= 0 and schaerfe <= 0) or st != 200 or not (ct or "").startswith("image/") or ist_ersatz(body)
            or region_id in (SCHATTEN_ID, ms.TERRAIN_AWS_PROXY_ID, ms.TERRAIN_AWS_ROH_PROXY_ID)):
        return st, ct, body
    sch = f":s{schaerfe:g}" if schaerfe > 0 else ""   # 26.10.2026 — Nachschärfen eigener Eintrag
    cp = cache_path(Path(cache_dir), f"farbe:{FARB_VERSION}:{prozent:g}{sch}:{region_id}/{z}/{x}/{y}/{int(bool(transparent))}") if cache_dir else None
    if cp is not None and cache_fresh(cp):
        try:
            raw = cp.read_bytes()
            nl = raw.index(b"\n")
            return 200, raw[:nl].decode("ascii", "ignore") or "image/jpeg", raw[nl + 1:]
        except (OSError, ValueError):
            pass
    from . import farbkorrektur
    body2, ct2 = farbkorrektur.kachel(body, ct, prozent, schaerfe)
    if cp is not None and body2 is not body:
        try:
            cp.parent.mkdir(parents=True, exist_ok=True)
            tmp = cp.with_name(cp.name + f".{os.getpid()}.tmp")
            tmp.write_bytes(ct2.encode("ascii", "ignore") + b"\n" + body2)
            _ds.ersetzen(tmp, cp, "kachel", art=_ds.ART_CACHE)
        except OSError as e:
            _log.debug("Zwischenspeicher (Farbe): %s", e)
    return 200, ct2, body2


def parse_request_path(path: str) -> Optional[tuple[str, int, int, int, bool]]:
    """`/tile/<region>/<z>/<x>/<y>[?t=1]` → (region, z, x, y, transparent) oder None."""
    p, _, q = path.partition("?")
    parts = p.strip("/").split("/")
    if len(parts) != 5 or parts[0] != "tile":
        return None
    try:
        z, x, y = int(parts[2]), int(parts[3]), int(parts[4])
    except ValueError:
        return None
    transparent = "t=1" in q.split("&")
    return parts[1], z, x, y, transparent
