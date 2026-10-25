"""Farbkorrektur der Luftbilder je Kachel (25.10.2026).

Marc (MacBook): „im Animator ruckelt irgendwie alles“ — mit Farbkorrektur 0 % flüssig. Bis 0.9.822 lag die Korrektur
als eigene Ebene in der Karte (ui/js/rz-mapadjust.js): bei JEDEM Bild das bisher Gezeichnete per `copyTexImage2D`
zurücklesen und neu einfärben. Auf den Grafikchips der Apple-Rechner zwingt das Zurücklesen mitten im Bild die GPU,
ihren Durchgang abzubrechen — bei Standard 70 % also immer. Jetzt rechnet die Kachel-Weiche die Korrektur einmal je
Luftbild-Kachel (`/tile/…?g=70`), danach kostet sie beim Abspielen nichts. Vorschau und Video holen dieselben Kacheln.

Die Formel ist die der bisherigen Ebene (Prototyp „GPS Studio Karten“, an elf Regionen abgestimmt): Dunst raus,
Belichtung, Tiefen aufhellen, gezielte Grün-Vibrance, Wärme, Kontrast im Log-Raum um Mittelgrau, weiche Schulter —
in linearem Licht (sRGB ≈ Gamma 2,2), `staerke` 0…1 mischt zwischen Original und Korrektur.
"""
from __future__ import annotations

from io import BytesIO

import numpy as np

_LUM = np.array([0.2126, 0.7152, 0.0722], np.float32)


def _smooth(e0: float, e1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _grade_linear(c: np.ndarray) -> np.ndarray:
    """rzGrade aus der früheren Shader-Ebene, auf linearem Licht (…×3, 0…1)."""
    c = np.maximum(c - 0.055 * 0.25, 0.0) / (1.0 - 0.055 * 0.25)
    c = c * 1.08
    l = c @ _LUM                                                         # noqa: E741
    c = c * (1.0 + 0.45 * (1.0 - _smooth(0.01, 0.16, l)) * 1.2)[..., None]
    l = c @ _LUM                                                         # noqa: E741
    r, g, b = c[..., 0], c[..., 1], c[..., 2]
    gd = _smooth(0.0, 0.06, g - np.maximum(r, b) * 0.92)
    mx = np.maximum(r, np.maximum(g, b))
    sn = (mx - np.minimum(r, np.minimum(g, b))) / np.maximum(mx, 1e-4)
    k = (1.12 + 0.30 * gd * (1.0 - sn))[..., None]
    c = np.maximum(l[..., None] + (c - l[..., None]) * k, 0.0)
    c = c * np.array([1.02, 1.0, 0.98], np.float32)
    c = 0.18 * np.power(c / 0.18 + 1e-5, 1.12)
    return c / (1.0 + np.maximum(c - 0.6, 0.0) * 1.3)


def anwenden(rgb: np.ndarray, staerke: float) -> np.ndarray:
    """RGB (uint8, …×3, nicht vormultipliziert) → korrigiert, gemischt mit `staerke` 0…1."""
    s = rgb.astype(np.float32) / 255.0
    if staerke <= 0:
        return rgb
    lin = np.power(s, 2.2)
    g = np.power(np.clip(_grade_linear(lin), 0.0, 1.0), 1.0 / 2.2)
    out = s + (g - s) * min(1.0, float(staerke))
    return np.clip(out * 255.0 + 0.5, 0, 255).astype(np.uint8)


def kachel(body: bytes, ct: str, prozent: float) -> tuple[bytes, str]:
    """Bild-Kachel (JPEG/PNG/WebP) korrigiert zurück; Alpha bleibt. Bei 0 % oder nicht lesbar: unverändert."""
    if not body or prozent <= 0:
        return body, ct
    from PIL import Image
    try:
        im = Image.open(BytesIO(body))
        im.load()
    except Exception:  # noqa: BLE001 — kein Bild (Fehlertext, leere Antwort): so lassen
        return body, ct
    alpha = None
    if im.mode in ("RGBA", "LA", "PA") or (im.mode == "P" and "transparency" in im.info):
        im = im.convert("RGBA")
        a = np.asarray(im)
        alpha = a[..., 3]
        rgb = a[..., :3]
    else:
        rgb = np.asarray(im.convert("RGB"))
    neu = anwenden(rgb, prozent / 100.0)
    out = BytesIO()
    if alpha is not None:
        Image.fromarray(np.dstack([neu, alpha]), "RGBA").save(out, "PNG", compress_level=1)
        return out.getvalue(), "image/png"
    Image.fromarray(neu, "RGB").save(out, "JPEG", quality=90)
    return out.getvalue(), "image/jpeg"
