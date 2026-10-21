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
  weiss       −100 … +100 (Weißpunkt)       schwarz      −100 … +100 (Schwarzpunkt, + = Schwarz heller)
  struktur    −100 … +100 (feiner Lokalkontrast, kleiner als Klarheit)
  boost       0 … 100 (ein Regler für „mehr Bild“ — verteilt sich in `wirksam` auf Dynamik, Struktur, Tiefen …)
  schaerfen   0 … 150 (Unscharfmaske auf der Helligkeit, Radius 1 Pixel der Quelle — wie in Lightroom erst bei 100 % voll
              sichtbar)

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
    "weiss": (-100, 100), "schwarz": (-100, 100), "struktur": (-100, 100),   # 21.10.2026 Paket 2 (wie Lightroom)
    "boost": (0, 100),       # 21.10.2026 — ein Regler wie „Verstärken“ in Luminar; `wirksam` verteilt ihn auf andere
    "schaerfen": (0, 150),   # 21.10.2026 (Marc: „Schärfen fehlt auch noch“) — wie Lightroom „Betrag“, Radius 1 px
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
GEOMETRIE = ("drehen90", "gerade", "zuschnitt", "vertikal", "horizontal", "aspekt", "skala", "versatz_x", "versatz_y")
# 21.10.2026 (Marc: „stürzende Linien usw. korrigieren können, wie in LR“) — Transformieren wie Lightroom, alles −100…100
# (Skalieren −50…50 = 50 … 150 %). Die ganze Geometrie ist EINE Projektivmatrix (`geo_matrix`): Ausgabepunkt im Rahmen →
# Quellpunkt. So rechnen Grafikkarte (ui/js/entwickeln_gl.js) und PIL (PERSPECTIVE) dasselbe; der Zuschnitt bleibt
# automatisch im Bild (wie beim Geraderichten).
PERSPEKTIVE = {"vertikal": (-100, 100), "horizontal": (-100, 100), "aspekt": (-100, 100), "skala": (-50, 50),
               "versatz_x": (-100, 100), "versatz_y": (-100, 100)}


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
    for k, (lo, hi) in PERSPEKTIVE.items():
        try:
            v = max(lo, min(hi, float(rezept.get(k) or 0)))
        except (TypeError, ValueError):
            v = 0.0
        if abs(v) >= 0.01:
            raus[k] = round(v, 2)
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


def _mal(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]


def _invers(m):
    a, b, c = m[0]; d, e, f = m[1]; g, h, i = m[2]
    A, B, C = e * i - f * h, -(d * i - f * g), d * h - e * g
    det = a * A + b * B + c * C
    if abs(det) < 1e-12:
        return None
    return [[A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
            [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
            [C / det, -(a * h - b * g) / det, (a * e - b * d) / det]]


def hat_perspektive(werte: Optional[dict]) -> bool:
    return bool(werte) and any(abs(float(werte.get(k) or 0)) >= 0.01 for k in PERSPEKTIVE)


def geo_matrix(W: float, H: float, werte: Optional[dict]) -> list:
    """3×3-Matrix: Punkt im Rahmen (Pixel, nach den 90°-Drehungen) → Punkt in der Quelle (Pixel). Kette rückwärts:
    Geraderichten zurück → Versatz/Skalieren/Seitenverhältnis zurück → Perspektive (Vertikal/Horizontal). Bei Änderung
    `geoMatrix` in ui/js/entwickeln_gl.js mitpflegen."""
    w = werte or {}
    g = float(w.get("gerade") or 0)
    co, si = math.cos(math.radians(g)), math.sin(math.radians(g))
    cx, cy, R = W / 2, H / 2, max(W, H) / 2
    sx = 1 + float(w.get("aspekt") or 0) / 200          # + = breiter
    sk = 1 + float(w.get("skala") or 0) / 100
    ox, oy = float(w.get("versatz_x") or 0) / 200, float(w.get("versatz_y") or 0) / 200
    av, ah = -float(w.get("vertikal") or 0) / 200, -float(w.get("horizontal") or 0) / 200
    m = [[1, 0, -cx], [0, 1, -cy], [0, 0, 1]]
    m = _mal([[co, si, 0], [-si, co, 0], [0, 0, 1]], m)                 # Geraderichten zurück
    m = _mal([[1 / R, 0, 0], [0, 1 / R, 0], [0, 0, 1]], m)
    m = _mal([[1, 0, -ox], [0, 1, -oy], [0, 0, 1]], m)                   # Versatz
    m = _mal([[1 / (sk * sx), 0, 0], [0, 1 / sk, 0], [0, 0, 1]], m)     # Skalieren, Seitenverhältnis
    m = _mal([[1, 0, 0], [0, 1, 0], [-ah, -av, 1]], m)                   # Perspektive
    m = _mal([[R, 0, cx], [0, R, cy], [0, 0, 1]], m)
    return m


def _abbilden(m, x: float, y: float):
    w = m[2][0] * x + m[2][1] * y + m[2][2]
    if w <= 1e-9:
        return None
    return ((m[0][0] * x + m[0][1] * y + m[0][2]) / w, (m[1][0] * x + m[1][1] * y + m[1][2]) / w)


def passend(W: float, H: float, grad: float, seite: Optional[float] = None, werte: Optional[dict] = None) -> list:
    """Größtes Rechteck mit Seitenverhältnis `seite` (Breite/Höhe in Pixeln, Standard wie das Bild), mittig, das nach dem
    Geraderichten (und der Perspektive aus `werte`) ganz im Bild liegt — normiert [x, y, b, h]."""
    A = seite or (W / H)
    if hat_perspektive(werte):
        w = dict(werte or {}, gerade=grad)
        mi = _invers(geo_matrix(W, H, w))
        mitte = _abbilden(mi, W / 2, H / 2) if mi else None
        mx, my = (mitte[0] / W, mitte[1] / H) if mitte and 0 < mitte[0] < W and 0 < mitte[1] < H else (0.5, 0.5)
        b0 = min(W, H * A); h0 = b0 / A
        lo, hi = 0.0, 1.0
        for _ in range(26):
            t = (lo + hi) / 2
            k = [mx - b0 * t / W / 2, my - h0 * t / H / 2, b0 * t / W, h0 * t / H]
            lo, hi = (t, hi) if _drinnen(k, W, H, grad, w) else (lo, t)
        b, h = b0 * lo / W, h0 * lo / H
        x, y = max(0.0, min(1 - b, mx - b / 2)), max(0.0, min(1 - h, my - h / 2))
        return [x, y, b, h]
    t = abs(math.radians(grad or 0))
    c, s = math.cos(t), math.sin(t)
    b = min(W / (c + s / A), H / (s + c / A), W, H * A)
    h = b / A
    return [(W - b) / 2 / W, (H - h) / 2 / H, b / W, h / H]


def _drinnen(r: list, W: float, H: float, grad: float, werte: Optional[dict] = None) -> bool:
    eps = 1e-3 * max(W, H)
    if hat_perspektive(werte):
        m = geo_matrix(W, H, dict(werte or {}, gerade=grad))
        for px, py in ((r[0], r[1]), (r[0] + r[2], r[1]), (r[0], r[1] + r[3]), (r[0] + r[2], r[1] + r[3])):
            q = _abbilden(m, px * W, py * H)
            if q is None or q[0] < -eps or q[0] > W + eps or q[1] < -eps or q[1] > H + eps:
                return False
        return True
    th = math.radians(grad or 0)
    co, si = math.cos(th), math.sin(th)
    cx, cy = W / 2, H / 2
    for px, py in ((r[0], r[1]), (r[0] + r[2], r[1]), (r[0], r[1] + r[3]), (r[0] + r[2], r[1] + r[3])):
        dx, dy = px * W - cx, py * H - cy
        qx, qy = cx + dx * co + dy * si, cy - dx * si + dy * co
        if qx < -eps or qx > W + eps or qy < -eps or qy > H + eps:
            return False
    return True


def einpassen(r: list, W: float, H: float, grad: float, werte: Optional[dict] = None) -> list:
    """Zuschnitt so verkleinern (um seine Mitte, notfalls zur Bildmitte hin), dass er nach dem Geraderichten (und der
    Perspektive) im Bild liegt."""
    r = [float(v) for v in r]
    if _drinnen(r, W, H, grad, werte):
        return r
    mx, my = r[0] + r[2] / 2, r[1] + r[3] / 2
    if not _drinnen([mx, my, 0, 0], W, H, grad, werte):
        p = passend(W, H, grad, None, werte)
        mx, my = p[0] + p[2] / 2, p[1] + p[3] / 2
    lo, hi = 0.0, 1.0
    for _ in range(24):
        m = (lo + hi) / 2
        k = [mx - r[2] * m / 2, my - r[3] * m / 2, r[2] * m, r[3] * m]
        lo, hi = (m, hi) if _drinnen(k, W, H, grad, werte) else (lo, m)
    return [mx - r[2] * lo / 2, my - r[3] * lo / 2, r[2] * lo, r[3] * lo]


def geometrie(img, rezept: Optional[dict], rahmen: bool = False):
    """Drehen um 90°, Geraderichten, Zuschneiden. `rahmen` = der ganze gedrehte Rahmen (fürs Zuschneiden-Werkzeug)."""
    from PIL import Image
    r = _geo_sauber(rezept or {})
    d = r.get("drehen90", 0)
    if d:
        img = img.transpose({1: Image.Transpose.ROTATE_270, 2: Image.Transpose.ROTATE_180, 3: Image.Transpose.ROTATE_90}[d])
    g, z = r.get("gerade", 0.0), r.get("zuschnitt")
    persp = hat_perspektive(r)
    if not g and not z and not persp:
        return img
    W, H = img.size
    if rahmen:
        rect = [0.0, 0.0, 1.0, 1.0]
    else:
        rect = einpassen(z or passend(W, H, g, None, r), W, H, g, r)
    ow, oh = max(1, round(rect[2] * W)), max(1, round(rect[3] * H))
    ox, oy = rect[0] * W, rect[1] * H
    if not g and not persp:
        x0, y0 = round(ox), round(oy)
        return img.crop((x0, y0, x0 + ow, y0 + oh))
    if persp:
        m = _mal(geo_matrix(W, H, r), [[1, 0, ox], [0, 1, oy], [0, 0, 1]])
        n = m[2][2]
        daten = tuple(v / n for v in (m[0][0], m[0][1], m[0][2], m[1][0], m[1][1], m[1][2], m[2][0], m[2][1]))
        return img.transform((ow, oh), Image.Transform.PERSPECTIVE, daten, resample=Image.Resampling.BICUBIC,
                             fillcolor=(24, 24, 24))
    th = math.radians(g)
    co, si = math.cos(th), math.sin(th)
    cx, cy = W / 2, H / 2
    daten = (co, si, cx + (ox - cx) * co + (oy - cy) * si, -si, co, cy - (ox - cx) * si + (oy - cy) * co)
    return img.transform((ow, oh), Image.Transform.AFFINE, daten, resample=Image.Resampling.BICUBIC, fillcolor=(24, 24, 24))


# ── Upright (21.10.2026, wie Lightroom: Auto · Waagerecht · Senkrecht · Voll) ─────────────────────────────────────
# Gerade Kanten im Bild finden (Hough in numpy auf ≈ 800 px, nur fast senkrechte bzw. fast waagerechte Kanten) und
# daraus Drehen, Vertikal und Horizontal bestimmen. Modell aus `geo_matrix`: eine senkrechte Linie der Ausgabe bei
# x = c erscheint in der Quelle als x = c + c·av·y (normiert, Mitte 0, Radius = halbe lange Kante) — alle treffen sich im
# Fluchtpunkt (0, −1/av). Eine kleine Drehung kippt alle Linien gleich: Steigung b = r + av·a. Gewichtete Ausgleichsgerade
# über die gefundenen Linien liefert r (Drehung) und av (Vertikal); waagerecht entsprechend für Horizontal.

def _linien(g, fast_senkrecht: bool, R: float, maske=None):
    """Gerade Kanten einer Richtung: Liste (a, b, gewicht) mit x = a + b·y (bzw. y = a + b·x), normiert. `maske` =
    nur dort suchen (beim Nachmessen auf dem schon korrigierten Bild: nicht an den grauen Rändern)."""
    np = _np()
    h, w = g.shape
    gx = np.zeros_like(g); gy = np.zeros_like(g)
    gx[:, 1:-1] = g[:, 2:] - g[:, :-2]
    gy[1:-1, :] = g[2:, :] - g[:-2, :]
    if not fast_senkrecht:
        g, gx, gy = g.T, gy.T, gx.T
        h, w = w, h
        if maske is not None:
            maske = maske.T
    mag = np.hypot(gx, gy)
    if maske is not None:
        mag = mag * maske
    schwelle = max(0.04, float(np.percentile(mag, 92)))
    ys, xs = np.nonzero((mag > schwelle) & (np.abs(gx) > 2.2 * np.abs(gy)))
    if len(xs) < 50:
        return []
    if len(xs) > 60000:
        wahl = np.random.default_rng(1).choice(len(xs), 60000, replace=False)
        ys, xs = ys[wahl], xs[wahl]
    gew = mag[ys, xs]
    cx, cy = w / 2, h / 2
    xn, yn = (xs - cx) / R, (ys - cy) / R
    steig = np.linspace(-0.47, 0.47, 95)                     # ±25°
    x0_bins = int(w * 0.75)
    x0_lo, x0_hi = -w / 2 / R * 1.6, w / 2 / R * 1.6
    acc = np.zeros((len(steig), x0_bins), np.float32)
    for i, t in enumerate(steig):
        x0 = xn - t * yn
        k = ((x0 - x0_lo) / (x0_hi - x0_lo) * x0_bins).astype(np.int64)
        gut = (k >= 0) & (k < x0_bins)
        np.add.at(acc[i], k[gut], gew[gut])
    linien = []
    mind = float(np.median(gew)) * h * 0.12                  # mindestens ~12 % der Bildhöhe Kante
    a2 = acc.copy()
    for _ in range(24):
        i, k = np.unravel_index(int(np.argmax(a2)), a2.shape)
        wert = float(a2[i, k])
        if wert < mind:
            break
        linien.append((x0_lo + (k + 0.5) / x0_bins * (x0_hi - x0_lo), float(steig[i]), wert))
        a2[max(0, i - 6):i + 7, max(0, k - 8):k + 9] = 0      # Nachbarn derselben Kante weg
    return linien


def _ausgleich(linien):
    """Gewichtete Ausgleichsgerade b = r + v·a → (r, v); mit wenigen Linien nur r (Median)."""
    np = _np()
    if not linien:
        return None, None
    a = np.array([x[0] for x in linien]); b = np.array([x[1] for x in linien]); w = np.array([x[2] for x in linien])
    if len(linien) < 3 or float(np.ptp(a)) < 0.25:
        return float(np.average(b, weights=w)), None
    A = np.stack([np.ones_like(a), a], 1) * np.sqrt(w)[:, None]
    r, v = np.linalg.lstsq(A, b * np.sqrt(w), rcond=None)[0]
    return float(r), float(v)


def _upright_einmal(g, modus: str, maske=None) -> dict:
    h, w = g.shape
    R = max(w, h) / 2
    senk = _linien(g, True, R, maske)
    waag = _linien(g, False, R, maske)
    rs, vs = _ausgleich(senk)
    rw, vw = _ausgleich(waag)
    raus: dict = {}
    # Drehung: Senkrechte zählen mehr (Gebäude), Waagerechte stützen; Bild-Kippung = Linienneigung
    teile = [(rs, sum(x[2] for x in senk) * 1.5), (-rw if rw is not None else None, sum(x[2] for x in waag))]
    teile = [(r, wt) for r, wt in teile if r is not None and wt > 0]
    if modus == "waagerecht" and rw is not None:
        teile = [(-rw, 1.0)]
    if teile:
        r = sum(r * wt for r, wt in teile) / sum(wt for _, wt in teile)
        raus["gerade"] = math.degrees(math.atan(r))
    if modus in ("senkrecht", "voll", "auto") and vs is not None:
        raus["vertikal"] = -vs * 200
    if modus == "voll" and vw is not None:
        raus["horizontal"] = -vw * 200
    return raus


def upright(img, modus: str = "auto") -> dict:
    """Werte für Drehen/Vertikal/Horizontal (Rezeptschlüssel `gerade`, `vertikal`, `horizontal`) — Modus „auto“
    (ausgewogen: Vertikal gedämpft), „waagerecht“ (nur Drehen), „senkrecht“ (Drehen + Vertikal), „voll“ (+ Horizontal).
    Zwei Runden: messen, auf dem so korrigierten Bild (ganzer Rahmen, ohne Zuschnitt) nachmessen und den Rest dazu."""
    np = _np()
    from PIL import Image
    im = img.convert("RGB")
    im.thumbnail((800, 800), Image.Resampling.BILINEAR)
    g0 = np.asarray(im.convert("L"), np.float32) / 255.0
    werte = _upright_einmal(g0, modus)
    weiss = Image.new("L", im.size, 255)
    for _ in range(2):
        if not werte:
            break
        zw = {k: v for k, v in werte.items()}
        korr = geometrie(im, zw, rahmen=True)
        m = np.asarray(geometrie(weiss.convert("RGB"), zw, rahmen=True).convert("L"), np.float32) > 250
        # Rand der gültigen Fläche nicht als Kante zählen: Maske um 3 Pixel einschrumpfen
        m2 = m.copy()
        for _k in range(3):
            m2[1:, :] &= m2[:-1, :]; m2[:-1, :] &= m2[1:, :]; m2[:, 1:] &= m2[:, :-1]; m2[:, :-1] &= m2[:, 1:]
        rest = _upright_einmal(np.asarray(korr.convert("L"), np.float32) / 255.0, modus, m2.astype(np.float32))
        for k, v in rest.items():
            werte[k] = werte.get(k, 0.0) + v
    raus: dict = {}
    if "gerade" in werte and abs(werte["gerade"]) <= 15 and abs(werte["gerade"]) >= 0.05:
        raus["gerade"] = round(werte["gerade"], 1)
    for k in ("vertikal", "horizontal"):
        if k in werte:
            v = werte[k] * (0.7 if (modus == "auto" and k == "vertikal") else 1.0)
            if abs(v) >= 1:
                raus[k] = round(max(-100.0, min(100.0, v)), 0)
    return raus


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
    """Auto-Ton und Auto-Weißabgleich — übernommen aus LightCraft (crates/pipeline/src/auto.rs, MIT/Apache-2.0,
    © ArtCraft Team und LightCraft-Mitwirkende; in den Credits genannt), angepasst an unsere Regler (21.10.2026).

    Marc: „Auto macht es meist schlechter, die Tiefen werden zu weit angehoben.“ Vorher: Tiefen schon, wenn das dunkelste
    1 % fast schwarz war (bei 49 von 60 echten Fotos, im Mittel +26), Weißabgleich als einfache Graue Welt über alles.
    Jetzt wie LightCraft: Helligkeit in Blendenstufen um Mittelgrau (log2(Y/0,18)) auf einem 512-px-Abbild; Tiefen erst,
    wenn die dunkelsten 5 % mehr als 4 Stufen unter Mittelgrau absaufen; Weißabgleich nur aus neutralen, mittelhellen
    Bildteilen (bunte Flächen wie Abendhimmel, Wald, Meer zählen kaum)."""
    np = _np()
    klein = img.convert("RGB").copy()
    klein.thumbnail((512, 512))
    a = _linear(_zu_float(klein))
    y = _luma(a)
    ev = np.sort(np.log2(np.maximum(y, 1e-6) / 0.18).ravel())

    def pz(q):
        return float(ev[int((len(ev) - 1) * q)]) if len(ev) else 0.0
    w = {}
    belichtung = max(-2.0, min(2.0, -pz(0.5) * 0.85 - 0.1))
    p01, p05, p95, p995 = (pz(q) + belichtung for q in (0.01, 0.05, 0.95, 0.995))
    w["belichtung"] = belichtung
    lichter = -min(90.0, (p995 - 2.2) * 38.0) if p995 > 2.2 else 0.0
    tiefen = min(70.0, (-4.0 - p05) * 22.0) if p05 < -4.0 else 0.0
    kontrast = max(-20.0, min(30.0, (6.5 - (p95 - p05)) * 6.0))
    # LightCraft hat dazu eigene Regler für Weiß und Schwarz; wir haben sie (noch) nicht: zu dunkles Weiß hebt etwas
    # den Kontrast, ausfressendes Weiß drückt die Lichter, zu helles Schwarz gibt etwas Kontrast dazu
    weiss = ((1.8 - p995) * 25.0 if p995 < 1.8 else -max(0.0, p995 - 3.5) * 10.0)
    schwarz = -min(35.0, (p01 + 5.0) * 10.0) if p01 > -5.0 else 0.0
    if weiss > 0:
        kontrast += min(15.0, weiss * 0.4)
    elif weiss < 0:
        lichter += max(-30.0, weiss)
    if schwarz < 0:
        kontrast += min(10.0, -schwarz * 0.25)
    w["lichter"] = max(-100.0, lichter)
    w["tiefen"] = tiefen
    w["kontrast"] = max(-20.0, min(30.0, kontrast))
    # Weißabgleich: Graue Welt, gewichtet auf neutrale Mitten (LightCraft auto_wb)
    k2 = img.convert("RGB").copy()
    k2.thumbnail((256, 256))
    b = _linear(_zu_float(k2)).reshape(-1, 3)
    yb = b[:, 0] * 0.2126 + b[:, 1] * 0.7152 + b[:, 2] * 0.0722
    mx, mn = b.max(axis=1), b.min(axis=1)
    chroma = (mx - mn) / (mx + 1e-6)
    gew = (1.0 - chroma) ** 2 * (1.0 - np.minimum(1.0, np.abs(np.log2(np.maximum(yb, 1e-6)) + 2.5) / 4.0))
    gew = np.where((yb >= 0.01) & (yb <= 2.0), gew, 0.0)
    if float(gew.sum()) > 1e-3:
        r, g, bl = (float((b[:, i] * gew).sum() / gew.sum()) for i in range(3))
        if g > 1e-4:
            w["temperatur"] = max(-30.0, min(30.0, (bl - r) / g * 60))
            w["toenung"] = max(-20.0, min(20.0, ((r + bl) / 2 - g) / g * 60))
    w["dynamik"] = 12   # LightCraft gibt dazu +3 Sättigung — bei uns nicht: „SW“ (Sättigung −100) bliebe sonst leicht farbig
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
    _boost_verteilen(raus)
    for k in GEOMETRIE:
        if k in r:
            raus[k] = r[k]
    return sauber(raus)


# 21.10.2026 — „Boost“ (Marc: Regler wie „Verstärken“ in Luminar Neo, Name „Boost“), erste, regelbasierte Fassung: ein
# Regler verteilt sich auf Dynamik, Struktur, Tiefen, Lichter, Kontrast und Dunst. Später lernt ein Modell die Mischung
# je Foto. Bei Änderung `BOOST` in ui/js/entwickeln_gl.js mitpflegen.
BOOST = {"dynamik": 0.35, "struktur": 0.3, "tiefen": 0.25, "lichter": -0.3, "kontrast": 0.1, "dunst": 0.08, "schwarz": -0.05}


def _boost_verteilen(werte: dict) -> None:
    b = float(werte.pop("boost", 0) or 0)
    if not b:
        return
    for k, f in BOOST.items():
        werte[k] = werte.get(k, 0) + b * f


# ── Entwickeln ───────────────────────────────────────────────────────────────────────────

def anwenden(img, rezept: Optional[dict], rahmen: bool = False, gpu: bool = True):
    """PIL-Bild → entwickeltes PIL-Bild (RGB). `rezept` sind die wirksamen Werte (siehe `wirksam`): erst der Ton auf
    dem ganzen Bild, dann die Geometrie.

    21.10.2026 — zuerst auf der Grafikkarte (core/entwickeln_gpu: derselbe Code wie die Live-Vorschau, 24 MP in ~1 s
    statt 3–7 s). numpy unten ist nur noch der Ausweg ohne Grafikkarte und kennt nur die Grundregler; `gpu=False`
    erzwingt ihn (Abgleichstest)."""
    r = sauber(rezept)
    if not r:
        return img.convert("RGB")
    if gpu:
        from . import entwickeln_gpu
        aus = entwickeln_gpu.entwickeln(img, r, rahmen)
        if aus is not None:
            return aus
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

    # Schärfen: Detail der Quelle (Helligkeit minus 3×3-Gauß), am Ende auf die Farben addiert — wie entwickeln_gl.js
    scharf = None
    if r.get("schaerfen"):
        p_ = np.pad(l, 1, mode="edge")
        hh, ww = l.shape
        k3 = ((1, 2, 1), (2, 4, 2), (1, 2, 1))
        bl = sum(k3[j][i] * p_[j:j + hh, i:i + ww] for j in range(3) for i in range(3)) / 16.0
        scharf = (l - bl) * (r["schaerfen"] / 100.0 * 1.2)

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
    # Struktur: feines Detailband (Radius ≈ 1/350 der langen Kante), vor allem in den Mitten — wie entwickeln_gl.js
    if r.get("struktur"):
        k = r["struktur"] / 100.0
        detail = l - _weich(l, groesse / 350)
        mitten = np.clip(1 - np.abs(basis - 0.5) * 1.4, 0, 1)
        l = l + k * 1.6 * detail * mitten
    # Kontrast: S-Kurve um die Mitte
    if r.get("kontrast"):
        k = r["kontrast"] / 100.0
        x = np.clip(l, 0, 1)
        s = x * x * (3 - 2 * x)
        l = x + k * 1.6 * (s - x) if k > 0 else x + k * 0.6 * (x - 0.5)
    # Weiß- und Schwarzpunkt (linear umspannen)
    if r.get("weiss") or r.get("schwarz"):
        lo = -0.08 * r.get("schwarz", 0) / 100.0
        hi = 1 - 0.15 * r.get("weiss", 0) / 100.0
        l = (l - lo) / max(1e-3, hi - lo)

    # Helligkeitsänderung auf die Farben übertragen (Verhältnis, Farbton bleibt)
    # Helligkeitsänderung auf die Farben: als Faktor (Farbton bleibt) — in den tiefen Schatten aber additiv, sonst
    # explodiert der Faktor bei fast schwarzen Pixeln und färbt sie grell (Klicktest 09.10.: rote Flecken auf Steinen)
    lum0 = _luma(v)
    l = np.clip(l, 0, 1.2)
    faktor = np.clip(l / np.clip(lum0, 1e-4, None), 0, 3)[..., None]
    w = (1 - _glatt(lum0, 0.02, 0.18))[..., None]
    v = (v * faktor) * (1 - w) + (v + (l - lum0)[..., None]) * w
    if scharf is not None:
        v = v + scharf[..., None]
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
