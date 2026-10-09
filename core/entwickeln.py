"""Fotos entwickeln — Regler wie in Lightroom, ohne das Original anzufassen (09.10.2026).

Ein Foto bekommt ein REZEPT (dict, in der Bibliothek gespeichert); das Original bleibt, wie es ist. Export, „Als neue
Datei speichern“ und später Video/Animator rechnen das Rezept beim Ausgeben ein. Reglernamen angelehnt an die freien
Entwicklungsprogramme: später austauschbar, wenn ein schnellerer Kern (z. B. für RAW) kommt.

Rezept (alle Werte optional, 0 = neutral):
  belichtung  Blendenstufen  −3 … +3       kontrast     −100 … +100
  lichter     −100 … +100                  tiefen       −100 … +100
  temperatur  −100 … +100 (blau … gelb)    toenung      −100 … +100 (grün … magenta)
  dynamik     −100 … +100 (schont Hauttöne / Gesättigtes)
  saettigung  −100 … +100                  klarheit     −100 … +100 (Mitten-Kontrast)
  dunst       −100 … +100 (+ = Dunst weg)

Gerechnet wird in Gleitkomma auf dem ganzen Bild (numpy): Weißabgleich und Belichtung linear, Ton und Farbe auf der
wahrgenommenen Helligkeit. Lichter/Tiefen/Klarheit arbeiten mit einer weichgezeichneten Helligkeit (lokal, nicht nur
global) — dadurch der „Lightroom-Look“ ohne Halos an harten Kanten bei moderaten Werten.
"""
from __future__ import annotations

import hashlib
import io
import logging
import math
import os
from pathlib import Path
from typing import Optional

_log = logging.getLogger(__name__)
# 09.10.2026 — RAW über LibRaw/`rawpy`, einmal entwickelt und gemerkt: Ablage der halb
# großen Entwicklung fürs Bearbeiten (App-Ordner, setzt app.py). Ohne rawpy: wie bisher die eingebettete Vorschau.
RAW_SPEICHER: Optional[Path] = None


def raw_entwickelt(pfad: str, halb: bool = True):
    """RAW mit LibRaw entwickeln (Kamera-Weißabgleich, 8 Bit, Drehung aus der Datei). `halb` = halbe Kantenlänge
    (viermal schneller, fürs Bearbeiten) und gemerkt; voll für Speichern/Export. None ohne rawpy oder bei Fehler."""
    try:
        import rawpy
        from PIL import Image
    except ImportError:
        return None
    datei = None
    try:
        st = os.stat(pfad)
        if halb and RAW_SPEICHER:
            k = hashlib.sha1(f"{pfad}|{st.st_mtime_ns}|{st.st_size}".encode()).hexdigest()[:20]
            datei = Path(RAW_SPEICHER) / f"{k}.jpg"
            if datei.is_file():
                return Image.open(datei).convert("RGB")
        with rawpy.imread(str(pfad)) as raw:
            rgb = raw.postprocess(use_camera_wb=True, output_bps=8, half_size=bool(halb), no_auto_bright=False)
        img = Image.fromarray(rgb)
        if datei is not None:
            try:
                datei.parent.mkdir(parents=True, exist_ok=True)
                tmp = datei.with_suffix(".tmp")
                img.save(tmp, "JPEG", quality=94)
                from core import dateischutz as _ds
                _ds.ersetzen(tmp, datei, "raw_ablegen", art=_ds.ART_CACHE)
            except OSError as e:
                _log.info("[raw] ablegen: %s", e)
        return img
    except Exception as e:  # noqa: BLE001 — LibRaw kennt nicht jede Kamera
        _log.info("[raw] %s: %s", pfad, e)
        return None

REGLER = {
    "belichtung": (-3.0, 3.0), "kontrast": (-100, 100), "lichter": (-100, 100), "tiefen": (-100, 100),
    "temperatur": (-100, 100), "toenung": (-100, 100), "dynamik": (-100, 100), "saettigung": (-100, 100),
    "klarheit": (-100, 100), "dunst": (-100, 100),
}
# Voreinstellungen — „Natürlich“ = Auto
VOREINSTELLUNGEN = {
    "natuerlich": {"auto": True},
    "kraeftig": {"auto": True, "kontrast": 22, "dynamik": 35, "klarheit": 18, "dunst": 10},
    "matt": {"auto": True, "kontrast": -22, "tiefen": 30, "lichter": -15, "saettigung": -18},
    "sw": {"auto": True, "saettigung": -100, "kontrast": 25, "klarheit": 15},
}


def sauber(rezept: Optional[dict]) -> dict:
    """Nur bekannte Regler, in ihren Grenzen, ohne Nullen; `auto` und `stil` (Name der Voreinstellung) bleiben."""
    raus = {}
    for k, (lo, hi) in REGLER.items():
        try:
            v = float((rezept or {}).get(k, 0) or 0)
        except (TypeError, ValueError):
            v = 0.0
        v = max(lo, min(hi, v))
        if abs(v) > 1e-6:
            raus[k] = round(v, 2)
    if (rezept or {}).get("stil") in VOREINSTELLUNGEN:
        raus["stil"] = rezept["stil"]
    raus.update(_geo_sauber(rezept or {}))
    return raus


# ── Zuschneiden und Geraderichten (09.10.2026) ──────────────────────
# Rezept: `drehen90` (0–3 × 90° im Uhrzeigersinn), `gerade` (−45…45°, positiv = im Uhrzeigersinn) und `zuschnitt`
# [x, y, b, h] normiert im Rahmen NACH dem Drehen um 90°. Angewandt wird die Geometrie zuletzt (nach dem Ton), damit
# die Vorschau in der Grafikkarte (ui/js/entwickeln_gl.js) dieselben Rechnungen auf dem ganzen Bild machen kann —
# beide Seiten benutzen dieselben Formeln, bei Änderung beide pflegen.
GEOMETRIE = ("drehen90", "gerade", "zuschnitt")


def _geo_sauber(rezept: dict) -> dict:
    raus = {}
    try:
        d = int(rezept.get("drehen90") or 0) % 4
    except (TypeError, ValueError):
        d = 0
    if d:
        raus["drehen90"] = d
    try:
        g = max(-45.0, min(45.0, float(rezept.get("gerade") or 0)))
    except (TypeError, ValueError):
        g = 0.0
    if abs(g) >= 0.01:
        raus["gerade"] = round(g, 2)
    z = rezept.get("zuschnitt")
    if isinstance(z, (list, tuple)) and len(z) == 4:
        try:
            x, y, b, h = (float(v) for v in z)
            b, h = max(0.02, min(1.0, b)), max(0.02, min(1.0, h))
            x, y = max(0.0, min(1.0 - b, x)), max(0.0, min(1.0 - h, y))
            if not (x < 1e-4 and y < 1e-4 and b > 0.9999 and h > 0.9999):
                raus["zuschnitt"] = [round(x, 5), round(y, 5), round(b, 5), round(h, 5)]
        except (TypeError, ValueError):
            pass
    return raus


def rahmen_masse(w: int, h: int, drehen90: int = 0):
    return (h, w) if int(drehen90 or 0) % 2 else (w, h)


def passend(W: float, H: float, grad: float, seite: Optional[float] = None) -> list:
    """Größtes Rechteck mit Seitenverhältnis `seite` (Breite/Höhe in Pixeln, Standard wie das Bild), mittig, das nach dem
    Geraderichten ganz im Bild liegt — normiert [x, y, b, h]."""
    t = abs(math.radians(grad or 0))
    c, s = math.cos(t), math.sin(t)
    A = seite or (W / H)
    b = min(W / (c + s / A), H / (s + c / A), W, H * A)
    h = b / A
    return [(W - b) / 2 / W, (H - h) / 2 / H, b / W, h / H]


def _drinnen(r: list, W: float, H: float, grad: float) -> bool:
    th = math.radians(grad or 0)
    co, si = math.cos(th), math.sin(th)
    cx, cy, eps = W / 2, H / 2, 1e-3 * max(W, H)
    for px, py in ((r[0], r[1]), (r[0] + r[2], r[1]), (r[0], r[1] + r[3]), (r[0] + r[2], r[1] + r[3])):
        dx, dy = px * W - cx, py * H - cy
        qx, qy = cx + dx * co + dy * si, cy - dx * si + dy * co
        if qx < -eps or qx > W + eps or qy < -eps or qy > H + eps:
            return False
    return True


def einpassen(r: list, W: float, H: float, grad: float) -> list:
    """Zuschnitt so verkleinern (um seine Mitte, notfalls zur Bildmitte hin), dass er nach dem Geraderichten im Bild liegt."""
    r = [float(v) for v in r]
    if _drinnen(r, W, H, grad):
        return r
    mx, my = r[0] + r[2] / 2, r[1] + r[3] / 2
    if not _drinnen([mx, my, 0, 0], W, H, grad):
        mx, my = 0.5, 0.5
    lo, hi = 0.0, 1.0
    for _ in range(24):
        m = (lo + hi) / 2
        k = [mx - r[2] * m / 2, my - r[3] * m / 2, r[2] * m, r[3] * m]
        lo, hi = (m, hi) if _drinnen(k, W, H, grad) else (lo, m)
    return [mx - r[2] * lo / 2, my - r[3] * lo / 2, r[2] * lo, r[3] * lo]


def geometrie(img, rezept: Optional[dict], rahmen: bool = False):
    """Drehen um 90°, Geraderichten, Zuschneiden. `rahmen` = der ganze gedrehte Rahmen (fürs Zuschneiden-Werkzeug)."""
    from PIL import Image
    r = _geo_sauber(rezept or {})
    d = r.get("drehen90", 0)
    if d:
        img = img.transpose({1: Image.Transpose.ROTATE_270, 2: Image.Transpose.ROTATE_180, 3: Image.Transpose.ROTATE_90}[d])
    g, z = r.get("gerade", 0.0), r.get("zuschnitt")
    if not g and not z:
        return img
    W, H = img.size
    if rahmen:
        rect = [0.0, 0.0, 1.0, 1.0]
    else:
        rect = einpassen(z or passend(W, H, g), W, H, g)
    ow, oh = max(1, round(rect[2] * W)), max(1, round(rect[3] * H))
    ox, oy = rect[0] * W, rect[1] * H
    if not g:
        x0, y0 = round(ox), round(oy)
        return img.crop((x0, y0, x0 + ow, y0 + oh))
    th = math.radians(g)
    co, si = math.cos(th), math.sin(th)
    cx, cy = W / 2, H / 2
    daten = (co, si, cx + (ox - cx) * co + (oy - cy) * si, -si, co, cy - (ox - cx) * si + (oy - cy) * co)
    return img.transform((ow, oh), Image.Transform.AFFINE, daten, resample=Image.Resampling.BICUBIC, fillcolor=(24, 24, 24))


def ist_leer(rezept: Optional[dict]) -> bool:
    return not sauber(rezept)


# ── Bild ⇄ Gleitkomma ───────────────────────────────────────────────────────────────────

def _np():
    import numpy as np
    return np


def _zu_float(img):
    np = _np()
    return np.asarray(img.convert("RGB"), dtype=np.float32) / 255.0


def _zu_bild(a):
    from PIL import Image
    np = _np()
    return Image.fromarray((np.clip(a, 0, 1) * 255.0 + 0.5).astype(np.uint8), "RGB")


def _linear(v):
    np = _np()
    return np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)


def _srgb(v):
    np = _np()
    v = np.clip(v, 0, None)
    return np.where(v <= 0.0031308, v * 12.92, 1.055 * np.power(v, 1 / 2.4) - 0.055)


def _luma(a):
    return a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722


def _weich(l, radius_px: float):
    """Weichgezeichnete Helligkeit (Gauß über PIL — schnell auch bei 24 MP)."""
    from PIL import Image, ImageFilter
    np = _np()
    if radius_px < 0.5:
        return l
    # über 8 Bit — für eine Maske genau genug
    im8 = Image.fromarray((np.clip(l, 0, 1) * 255 + 0.5).astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(radius_px))
    return np.asarray(im8, dtype=np.float32) / 255.0


def _glatt(x, a, b):
    np = _np()
    t = np.clip((x - a) / max(1e-6, b - a), 0, 1)
    return t * t * (3 - 2 * t)


# ── Auto ─────────────────────────────────────────────────────────────────────────────────

def auto_werte(img) -> dict:
    """Auto-Ton und Auto-Weißabgleich aus den Perzentilen eines verkleinerten Bildes (wie die freien Programme:
    Mitte der Helligkeit auf ~18 % Grau, Spreizung der Lichter/Tiefen, Grauwelt in den Mitten)."""
    np = _np()
    klein = img.convert("RGB").copy()
    klein.thumbnail((512, 512))
    a = _linear(_zu_float(klein))
    l = _luma(a)
    p1, p50, p99 = (float(x) for x in np.percentile(l, [1, 50, 99]))
    w = {}
    if p50 > 1e-4:
        w["belichtung"] = max(-1.5, min(1.5, math.log2(0.18 / p50) * 0.55))
    hell = p99 * (2 ** w.get("belichtung", 0))
    if hell > 0.95:
        w["lichter"] = -min(60, (hell - 0.95) * 600 + 15)
    dunkel = p1 * (2 ** w.get("belichtung", 0))
    if dunkel < 0.01:
        w["tiefen"] = min(45, (0.01 - dunkel) * 2500 + 10)
    spreizung = _srgb(np.array([hell]))[0] - _srgb(np.array([dunkel]))[0]
    if spreizung < 0.75:
        w["kontrast"] = min(30, (0.75 - spreizung) * 80)
    # Weißabgleich: Grauwelt über die Mitten
    m = (l > 0.05) & (l < 0.8)
    if m.sum() > 500:
        r, g, b = (float(a[..., i][m].mean()) for i in range(3))
        if g > 1e-4:
            w["temperatur"] = max(-40, min(40, (b - r) / g * 60))
            w["toenung"] = max(-25, min(25, ((r + b) / 2 - g) / g * 60))
    w["dynamik"] = 12
    return sauber(w)


def wirksam(rezept: Optional[dict], img=None) -> dict:
    """Das Rezept mit Auto-Werten verrechnet (Auto zuerst, die eigenen Regler kommen dazu)."""
    r = dict(rezept or {})
    basis = {}
    if r.get("stil") in VOREINSTELLUNGEN:
        basis = dict(VOREINSTELLUNGEN[r["stil"]])
    auto = r.get("auto") or basis.get("auto")
    raus = {}
    if auto and img is not None:
        raus.update(auto_werte(img))
    for k in REGLER:
        v = float(basis.get(k, 0) or 0) + float(r.get(k, 0) or 0)
        if v:
            raus[k] = raus.get(k, 0) + v
    for k in GEOMETRIE:
        if k in r:
            raus[k] = r[k]
    return sauber(raus)


# ── Entwickeln ───────────────────────────────────────────────────────────────────────────

def anwenden(img, rezept: Optional[dict], rahmen: bool = False):
    """PIL-Bild → entwickeltes PIL-Bild (RGB). `rezept` sind die wirksamen Werte (siehe `wirksam`): erst der Ton auf
    dem ganzen Bild, dann die Geometrie."""
    r = sauber(rezept)
    ton = {k: v for k, v in r.items() if k in REGLER}
    aus = _ton(img, ton) if ton else img.convert("RGB")
    return geometrie(aus, r, rahmen) if any(k in r for k in GEOMETRIE) else aus


def _ton(img, r: dict):
    np = _np()
    a = _linear(_zu_float(img))
    h, w = a.shape[:2]
    groesse = max(h, w)

    # Weißabgleich (linear) — Temperatur zieht Rot/Blau gegeneinander, Tönung Grün gegen Magenta
    t, tn = r.get("temperatur", 0) / 100.0, r.get("toenung", 0) / 100.0
    if t or tn:
        a = a * np.array([1 + 0.25 * t, 1 - 0.18 * tn, 1 - 0.25 * t], dtype=np.float32)
    # Belichtung (linear)
    if r.get("belichtung"):
        a = a * (2.0 ** r["belichtung"])

    v = np.clip(_srgb(a), 0, 1)      # ab hier wahrgenommen (Lichter über 1 sind ausgefressen)
    l = _luma(v)

    # Dunst: Dunkelkanal verrät den Schleier — abziehen und Kontrast zurückgeben
    if r.get("dunst"):
        k = r["dunst"] / 100.0
        dc = _weich(v.min(axis=2), groesse / 60)
        luft = float(np.percentile(v.max(axis=2), 99.5))
        if k > 0:
            dichte = np.clip(dc * 0.85 * k, 0, 0.9)[..., None]
            v = (v - luft * dichte) / np.clip(1 - dichte, 0.1, 1)
        else:
            v = v * (1 + k * 0.35) + (-k) * 0.35 * luft
        v = np.clip(v, 0, 1)
        l = _luma(v)

    basis = _weich(l, groesse / 90)   # lokale Helligkeit
    # Lichter und Tiefen (lokal über die weiche Helligkeit)
    if r.get("lichter"):
        k = r["lichter"] / 100.0
        maske = _glatt(basis, 0.45, 0.95)
        l = l + k * 0.35 * maske * (l if k < 0 else (1 - l))
    if r.get("tiefen"):
        k = r["tiefen"] / 100.0
        maske = 1 - _glatt(basis, 0.05, 0.55)
        l = l + k * 0.4 * maske * ((1 - l) if k > 0 else l)
    # Klarheit: Detailband der Mitten
    if r.get("klarheit"):
        k = r["klarheit"] / 100.0
        detail = l - _weich(l, groesse / 120)
        mitten = 1 - np.abs(basis - 0.5) * 1.6
        l = l + k * 1.2 * detail * np.clip(mitten, 0, 1)
    # Kontrast: S-Kurve um die Mitte
    if r.get("kontrast"):
        k = r["kontrast"] / 100.0
        x = np.clip(l, 0, 1)
        s = x * x * (3 - 2 * x)
        l = x + k * 1.6 * (s - x) if k > 0 else x + k * 0.6 * (x - 0.5)

    # Helligkeitsänderung auf die Farben übertragen (Verhältnis, Farbton bleibt)
    # Helligkeitsänderung auf die Farben: als Faktor (Farbton bleibt) — in den tiefen Schatten aber additiv, sonst
    # explodiert der Faktor bei fast schwarzen Pixeln und färbt sie grell (Klicktest 09.10.: rote Flecken auf Steinen)
    lum0 = _luma(v)
    l = np.clip(l, 0, 1.2)
    faktor = np.clip(l / np.clip(lum0, 1e-4, None), 0, 3)[..., None]
    w = (1 - _glatt(lum0, 0.02, 0.18))[..., None]
    v = (v * faktor) * (1 - w) + (v + (l - lum0)[..., None]) * w
    v = np.clip(v, 0, 1)

    # Dynamik und Sättigung um die Helligkeit
    lum = _luma(v)[..., None]
    sat_k = 1 + r.get("saettigung", 0) / 100.0
    if r.get("dynamik"):
        sat_jetzt = (v.max(axis=2) - v.min(axis=2))[..., None]
        sat_k = sat_k * (1 + r["dynamik"] / 100.0 * (1 - np.clip(sat_jetzt * 1.6, 0, 1)))
    if not np.isscalar(sat_k) or sat_k != 1:
        v = lum + (v - lum) * sat_k
    return _zu_bild(np.clip(v, 0, 1))


# ── Laden und Ausgeben ───────────────────────────────────────────────────────────────────

def quelle_oeffnen(pfad: str, voll: bool = False):
    """Original öffnen (JPEG/PNG/HEIC; RAW über LibRaw entwickelt — fürs Bearbeiten halb groß und gemerkt, `voll` für
    Speichern/Export; ohne rawpy über das eingebettete Vorschaubild), richtig gedreht. Rückgabe (Bild, aus_vorschau)."""
    from PIL import Image, ImageOps
    from core import exif as cexif
    aus_vorschau = False
    if cexif.is_heif(pfad):
        try:
            from pillow_heif import register_heif_opener
            register_heif_opener()
        except Exception:  # noqa: BLE001
            pass
        img = Image.open(pfad)
    elif cexif.is_raw(pfad):
        entw = raw_entwickelt(pfad, halb=not voll)
        if entw is not None:
            return entw.convert("RGB"), False      # LibRaw hat schon gedreht
        prev = cexif.extract_raw_preview(pfad)
        img = Image.open(io.BytesIO(prev)) if prev else None
        # 09.10.2026 — LibRaw kann nicht alles (z. B. DNG mit JPEG-XL-Kompression aus Lightroom 7.2); ist die eingebettete
        # Vorschau dann zu klein zum Bearbeiten, macht macOS über QuickLook ein großes Bild
        if img is None or max(img.size) < 1200:
            merk = None
            try:
                st = os.stat(pfad)
                if RAW_SPEICHER:
                    merk = Path(RAW_SPEICHER) / (hashlib.sha1(f"{pfad}|{st.st_mtime_ns}|{st.st_size}|ql".encode()).hexdigest()[:20] + ".jpg")
            except OSError:
                pass
            if merk is not None and merk.is_file():
                img = Image.open(merk)
            else:
                ql = cexif.extract_quicklook_thumbnail(pfad, size=3000)
                if ql:
                    img = Image.open(io.BytesIO(ql)).convert("RGB")
                    if merk is not None:
                        try:
                            merk.parent.mkdir(parents=True, exist_ok=True)
                            img.save(merk, "JPEG", quality=94)
                        except OSError:
                            pass
        if img is None:
            raise ValueError("RAW ohne eingebettetes Vorschaubild")
        aus_vorschau = True
    else:
        img = Image.open(pfad)
    img = ImageOps.exif_transpose(img)
    return img.convert("RGB"), aus_vorschau


def histogramm(img, stufen: int = 64) -> dict:
    np = _np()
    a = np.asarray(img.convert("RGB"))
    raus = {}
    for i, k in enumerate("rgb"):
        h, _ = np.histogram(a[..., i], bins=stufen, range=(0, 256))
        raus[k] = h.astype(int).tolist()
    return raus


def jpeg(img, qualitaet: int = 90, icc: Optional[bytes] = None) -> bytes:
    buf = io.BytesIO()
    kw = {"quality": qualitaet, "optimize": False}
    if icc:
        kw["icc_profile"] = icc
    img.save(buf, "JPEG", **kw)
    return buf.getvalue()
