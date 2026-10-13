#!/usr/bin/env python3
"""Symbole je Bewegungsart als einfärbbare SVGs (13.10.2026, Marc: „für jede Bewegungsart ein stilisiertes Bild von oben …
kann man die verschiedenen einfärben, ohne neue Symbole zu generieren?“).

Eingabe: Bögen mit 2×2 Symbolen (KI-erzeugt, Schiefer #2b3a40 + Mint #4fc9ab auf Weiß, Draufsicht, Richtung nach oben).
Ausgabe je Symbol ein SVG mit drei Ebenen, die sich getrennt einfärben lassen:
  <g class="rz-hell">   eingeschlossene helle Flächen (Deck, Scheiben) — Standard Weiß
  <g class="rz-dunkel"> Körper/Umriss — Standard #2b3a40
  <g class="rz-akzent"> Akzent — Standard #4fc9ab
Der Hintergrund (Weiß, das den Rand berührt) wird durchsichtig. Umwandlung in Kurven mit potrace (nur hier, nicht in der App).

  python3 scripts/bewegungsarten_svg.py <ordner-mit-boegen> <ausgabe-ordner>
  python3 scripts/bewegungsarten_svg.py js            # ui/img/bewegung/*.svg → ui/js/bewegung_pfade.js

Die App zeichnet die Symbole aus ui/js/bewegung_pfade.js (Pfade je Ebene) selbst auf Canvas bzw. als SVG — so färbt sie
sie ohne Bild-Laden ein, gleich in Vorschau, Video-Render und Web.
"""
from __future__ import annotations

import re
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

BOEGEN = {
    "1-": ["wanderer", "laeufer", "rad", "mountainbike"],
    "2-": ["motorrad", "auto", "wohnmobil", "bus"],
    "3-": ["zug", "segelboot", "motorboot", "faehre"],
    "4-": ["kajak", "flugzeug", "hubschrauber", "gleitschirm"],
    "5-": ["heissluftballon", "ski", "reiter", "sup"],
}
DUNKEL, AKZENT, HELL = "#2b3a40", "#4fc9ab", "#ffffff"
GROESSE = 512          # Kantenlänge der Arbeits-Bitmap je Symbol (Symbol mittig, Rand 4 %)


def klassen(rgb: np.ndarray) -> np.ndarray:
    """0 = weiß/hell, 1 = dunkel, 2 = Mint — je Bildpunkt die nächste der drei Farben."""
    ref = np.array([[255, 255, 255], [0x2b, 0x3a, 0x40], [0x4f, 0xc9, 0xab]], dtype=np.float32)
    d = ((rgb[..., None, :].astype(np.float32) - ref[None, None]) ** 2).sum(-1)
    return d.argmin(-1).astype(np.uint8)


def aussen(weiss: np.ndarray) -> np.ndarray:
    """Weiß, das mit dem Bildrand verbunden ist (Hintergrund) — Flutung über wiederholtes Ausdehnen."""
    a = np.zeros_like(weiss)
    a[0, :] = weiss[0, :]; a[-1, :] = weiss[-1, :]; a[:, 0] = weiss[:, 0]; a[:, -1] = weiss[:, -1]
    while True:
        n = a.copy()
        n[1:, :] |= a[:-1, :]; n[:-1, :] |= a[1:, :]; n[:, 1:] |= a[:, :-1]; n[:, :-1] |= a[:, 1:]
        n &= weiss
        if (n == a).all():
            return a
        a = n


def potrace_pfade(maske: np.ndarray) -> str:
    """Bitmap (True = Fläche) → SVG-Gruppeninhalt von potrace (Pfade samt Transform)."""
    with tempfile.TemporaryDirectory() as t:
        pbm = Path(t) / "m.pbm"
        Image.fromarray(((~maske) * 255).astype(np.uint8)).convert("1").save(pbm)
        svg = Path(t) / "m.svg"
        subprocess.run(["potrace", str(pbm), "-s", "-o", str(svg), "--flat", "-t", "6", "-a", "1.0", "-O", "0.4"], check=True)
        s = svg.read_text()
    m = re.search(r"<g transform=\"([^\"]+)\"[^>]*>(.*?)</g>", s, re.S)
    if not m:
        return ""
    pfade = re.findall(r"<path d=\"([^\"]+)\"", m.group(2))
    return f'<g transform="{m.group(1)}">' + "".join(f'<path d="{p}"/>' for p in pfade) + "</g>"


def symbol_svg(bild: Image.Image) -> str:
    rgb = np.asarray(bild.convert("RGB"))
    k = klassen(rgb)
    inhalt = k > 0
    # Trennlinien zwischen den Rasterfeldern im Bogen berühren den Feldrand — das Symbol selbst nicht: weg damit
    rand = aussen(inhalt)
    rgb = rgb.copy(); rgb[rand] = 255
    inhalt &= ~rand
    ys, xs = np.nonzero(inhalt)
    if not len(xs):
        return ""
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    seite = int(max(y1 - y0, x1 - x0) * 1.08)
    cy, cx = (y0 + y1) // 2, (x0 + x1) // 2
    kasten = (cx - seite // 2, cy - seite // 2, cx - seite // 2 + seite, cy - seite // 2 + seite)
    # Ragt das Quadrat über das Feld hinaus (hohe Symbole wie Bus/Zug), füllt crop() mit Schwarz → als Linie erkannt.
    # Deshalb auf eine weiße Fläche setzen.
    flaeche = Image.new("RGB", (seite, seite), (255, 255, 255))
    flaeche.paste(Image.fromarray(rgb), (-kasten[0], -kasten[1]))
    teil = flaeche.resize((GROESSE, GROESSE), Image.LANCZOS)
    k = klassen(np.asarray(teil))
    # Kantenglättung: Mischpixel zwischen Dunkel und Weiß liegen farblich nahe am Mint → dünne Mint-Säume an jedem Umriss.
    # Mint zählt nur, wo es eine echte Fläche ist (mindestens 2 Nachbarn je Richtung ebenfalls Mint), sonst Dunkel.
    m = k == 2
    kern = m.copy()
    for dy, dx in ((0, 2), (0, -2), (2, 0), (-2, 0)):
        kern &= np.roll(m, (dy, dx), axis=(0, 1))
    saum = m & ~kern
    for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0), (0, 2), (0, -2), (2, 0), (-2, 0)):
        saum &= ~np.roll(kern, (dy, dx), axis=(0, 1))
    k[saum] = 1
    weiss = k == 0
    hell = weiss & ~aussen(weiss)
    ebenen = [("rz-hell", HELL, hell), ("rz-dunkel", DUNKEL, k == 1), ("rz-akzent", AKZENT, k == 2)]
    teile = []
    for klasse, farbe, maske in ebenen:
        if maske.sum() < 20:
            continue
        teile.append(f'<g class="{klasse}" fill="{farbe}">{potrace_pfade(maske)}</g>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {GROESSE} {GROESSE}" width="{GROESSE}" height="{GROESSE}">'
            + "".join(teile) + "</svg>\n")


def main(ein: Path, aus: Path) -> int:
    aus.mkdir(parents=True, exist_ok=True)
    n = 0
    for bogen in sorted(ein.glob("*bewegungsarten-*.png")):
        schluessel = next((k for k in BOEGEN if f"bewegungsarten-{k}" in bogen.name), None)
        if not schluessel:
            continue
        b = Image.open(bogen)
        w, h = b.size
        for i, name in enumerate(BOEGEN[schluessel]):
            x, y = (i % 2) * w // 2, (i // 2) * h // 2
            svg = symbol_svg(b.crop((x, y, x + w // 2, y + h // 2)))
            if svg:
                (aus / f"{name}.svg").write_text(svg, encoding="utf-8")
                n += 1
                print(f"  {name}.svg  ({len(svg) // 1024} KB)")
    print(f"{n} Symbole nach {aus}")
    return 0 if n else 1


def js(svg_ordner: Path, ziel: Path) -> int:
    """SVGs → JS-Datei mit den Pfaden je Ebene: RZ_BEWEGUNG_PFADE[art] = {hell: [d…], dunkel: [d…], akzent: [d…]}.
    Alle SVGs haben dieselbe potrace-Transformation (translate(0,512) scale(0.1,-0.1)) — sie steht einmal in der Datei."""
    import json
    daten = {}
    for f in sorted(svg_ordner.glob("*.svg")):
        s = f.read_text(encoding="utf-8")
        eintrag = {}
        for klasse, inhalt in re.findall(r'<g class="rz-(hell|dunkel|akzent)"[^>]*>(.*?</g>)</g>', s, re.S):
            tr = re.search(r'transform="([^"]+)"', inhalt)
            if tr and tr.group(1) != "translate(0.000000,512.000000) scale(0.100000,-0.100000)":
                raise SystemExit(f"{f.name}: unerwartete Transformation {tr.group(1)}")
            eintrag[klasse] = [re.sub(r"\s+", " ", d).strip() for d in re.findall(r'<path d="([^"]+)"', inhalt)]
        daten[f.stem] = eintrag
    kopf = ("// Erzeugt von scripts/bewegungsarten_svg.py js aus ui/img/bewegung/*.svg — nicht von Hand ändern.\n"
            "// Pfade je Ebene in potrace-Koordinaten: translate(0,512) scale(0.1,-0.1) auf eine 512er-Fläche.\n")
    ziel.write_text(kopf + "window.RZ_BEWEGUNG_PFADE = " + json.dumps(daten, ensure_ascii=False, separators=(",", ":"))
                    + ";\n", encoding="utf-8")
    print(f"{len(daten)} Symbole nach {ziel} ({ziel.stat().st_size // 1024} KB)")
    return 0 if daten else 1


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "js":
        wurzel = Path(__file__).resolve().parent.parent
        sys.exit(js(wurzel / "ui" / "img" / "bewegung", wurzel / "ui" / "js" / "bewegung_pfade.js"))
    sys.exit(main(Path(sys.argv[1]), Path(sys.argv[2])))
