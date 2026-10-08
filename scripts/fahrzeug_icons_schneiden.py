#!/usr/bin/env python3
"""Fahrzeug-Icons aus den Sammelbildern schneiden (07.10.2026).

Je Fahrzeug ein Bild mit 5 × 2 Icons in zehn Zeichenstilen (immer dieselbe Reihenfolge, s. STILE), Draufsicht, Front nach
oben, transparenter Hintergrund. Das Skript schneidet jede Zelle auf ihren sichtbaren Inhalt zu, setzt ihn mittig auf ein
quadratisches Feld und speichert `ui/img/fahrzeuge/<fahrzeug>_<stil>.png` (192 px, in der App mit pixelRatio 4 = 48 px).

Aufruf:  python3 scripts/fahrzeug_icons_schneiden.py <ordner-mit-den-sammelbildern>
Erwartete Dateinamen: rz-icons-<auto|motorrad|fahrrad|wanderer|zug|boot|flugzeug>-stile.png — fehlende werden übersprungen.
"""
import sys
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent
ZIEL = REPO / "ui" / "img" / "fahrzeuge"
# Dateiname im Sammelbild → Schlüssel in der App (FAHRZEUGE in modules/animator/ui/module.js)
FAHRZEUGE = {"auto": "auto", "motorrad": "motorrad", "fahrrad": "rad", "wanderer": "wanderer",
             "zug": "zug", "boot": "boot", "flugzeug": "flugzeug"}
# Reihenfolge im Raster: oben links → rechts, dann unten (so stand es im Prompt)
STILE = ["foto", "aquarell", "comic", "piktogramm", "kupferstich", "neon", "pixel", "blaupause", "papier", "knete"]
GROESSE = 192
RAND = 0.06          # Luft um das Icon (Anteil der Kantenlänge)
ALPHA_MIN = 24       # schwächere Pixel (weicher Schatten) bestimmen den Zuschnitt nicht


def schneiden(quelle: Path, fz: str) -> int:
    bild = Image.open(quelle).convert("RGBA")
    w, h = bild.size
    n = 0
    for k, stil in enumerate(STILE):
        sp, ze = k % 5, k // 5
        zelle = bild.crop((round(sp * w / 5), round(ze * h / 2), round((sp + 1) * w / 5), round((ze + 1) * h / 2)))
        maske = zelle.getchannel("A").point(lambda a: 255 if a >= ALPHA_MIN else 0)
        box = maske.getbbox()
        if not box:
            print(f"  ! {fz}/{stil}: Zelle leer — übersprungen")
            continue
        teil = zelle.crop(box)
        kante = max(teil.size)
        feld = Image.new("RGBA", (round(kante * (1 + 2 * RAND)),) * 2, (0, 0, 0, 0))
        feld.paste(teil, ((feld.width - teil.width) // 2, (feld.height - teil.height) // 2))
        feld = feld.resize((GROESSE, GROESSE), Image.NEAREST if stil == "pixel" else Image.LANCZOS)
        ZIEL.mkdir(parents=True, exist_ok=True)
        feld.save(ZIEL / f"{fz}_{stil}.png", optimize=True)
        n += 1
    return n


def main() -> int:
    ordner = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.cwd()
    gesamt = 0
    for name, fz in FAHRZEUGE.items():
        q = ordner / f"rz-icons-{name}-stile.png"
        if not q.is_file():
            print(f"– {name}: kein Sammelbild ({q.name})")
            continue
        n = schneiden(q, fz)
        print(f"✓ {name}: {n} Icons")
        gesamt += n
    print(f"{gesamt} Icons in {ZIEL}")
    return 0 if gesamt else 1


if __name__ == "__main__":
    sys.exit(main())
