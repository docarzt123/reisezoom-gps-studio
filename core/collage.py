"""Collage aus mehreren Fotos einer Stelle (15.11.2026, synchron zur iPhone-App `Fotos.collage`).

Mehrere Fotos an derselben Stelle der Strecke zeigt ein Foto-Schild ohne Halt (Sofortbild, Bild im Bild) auf Wunsch als
EIN Bild. Aufbau wie in der iPhone-App:
  2 Fotos  → nebeneinander, 1200 × 800
  3 Fotos  → links eins groß (60 % der Breite), rechts zwei übereinander, 1200 × 1200
  4 Fotos  → 2 × 2, 1200 × 1200
Weiße Fugen (14 px bei 1200 px Breite), jedes Foto füllt seine Zelle (mittig zugeschnitten). Mehr als 4 Fotos werden nicht
gezeigt (JE_STELLE_MAX), eins allein bleibt, wie es ist.

Das Schild speichert weiter die echten Fotos (`imageSrc` + `weitere`); die Collage entsteht beim Anzeigen über
`sign_image_thumb("rzcollage:[…]")` — so bleibt sie in der Timeline bearbeitbar (Foto weg, Collage aus).
"""
from __future__ import annotations

import json

from PIL import Image, ImageOps

PRAEFIX = "rzcollage:"
JE_STELLE_MAX = 4
FUGE_BEI_1200 = 14


def quelle(pfade: list[str]) -> str:
    """Bildquelle für sign_image_thumb aus den Fotopfaden (Reihenfolge wie im Schild)."""
    return PRAEFIX + json.dumps([str(p) for p in pfade][:JE_STELLE_MAX], ensure_ascii=False)


def pfade_aus(src: str) -> list[str]:
    """Fotopfade aus einer `rzcollage:`-Quelle; leere Liste, wenn es keine ist."""
    if not isinstance(src, str) or not src.startswith(PRAEFIX):
        return []
    try:
        liste = json.loads(src[len(PRAEFIX):])
    except (ValueError, TypeError):
        return []
    return [str(p) for p in liste if isinstance(p, str) and p][:JE_STELLE_MAX]


def zellen(n: int, breite: int = 1200) -> tuple[tuple[int, int], list[tuple[int, int, int, int]]]:
    """(Größe der Collage, Zellen als (x, y, w, h)) für n Fotos — n = 2, 3 oder 4."""
    fuge = max(2, round(FUGE_BEI_1200 * breite / 1200))
    if n <= 2:
        hoehe = round(breite * 2 / 3)
        w = (breite - 3 * fuge) // 2
        h = hoehe - 2 * fuge
        return (breite, hoehe), [(fuge, fuge, w, h), (2 * fuge + w, fuge, breite - 3 * fuge - w, h)]
    hoehe = breite
    if n == 3:
        links = round((breite - 3 * fuge) * 0.6)
        rechts = breite - 3 * fuge - links
        h2 = (hoehe - 3 * fuge) // 2
        return (breite, hoehe), [(fuge, fuge, links, hoehe - 2 * fuge),
                                 (2 * fuge + links, fuge, rechts, h2),
                                 (2 * fuge + links, 2 * fuge + h2, rechts, hoehe - 3 * fuge - h2)]
    w = (breite - 3 * fuge) // 2
    h = (hoehe - 3 * fuge) // 2
    w2, h2 = breite - 3 * fuge - w, hoehe - 3 * fuge - h
    return (breite, hoehe), [(fuge, fuge, w, h), (2 * fuge + w, fuge, w2, h),
                             (fuge, 2 * fuge + h, w, h2), (2 * fuge + w, 2 * fuge + h, w2, h2)]


def collage(bilder: list[Image.Image], breite: int = 1200) -> Image.Image | None:
    """Collage aus 2–4 Bildern (mehr werden abgeschnitten); None bei weniger als zwei Bildern."""
    bilder = [b for b in bilder if b is not None][:JE_STELLE_MAX]
    if len(bilder) < 2:
        return None
    (cw, ch), z = zellen(len(bilder), breite)
    leinwand = Image.new("RGB", (cw, ch), (255, 255, 255))
    for b, (x, y, w, h) in zip(bilder, z):
        teil = ImageOps.fit(b.convert("RGB"), (w, h), method=Image.LANCZOS, centering=(0.5, 0.5))
        leinwand.paste(teil, (x, y))
    return leinwand
