#!/usr/bin/env python3
"""Kompass je Kartenlook: ui/kompass/kompass-<look>.svg → ui/js/kompass.js (window.RZ_KOMPASS).

Die SVG-Dateien sind die eine Quelle — dieselben Bilder wie im Web-Studio (dort docs/kompass/), 1:1 übernommen,
damit App und Web gleich aussehen. Neuer Look oder geändertes Bild: SVG in ui/kompass/ ablegen und dieses Skript laufen
lassen; tests/test_kompass.py prüft, dass ui/js/kompass.js zu den Dateien passt.
"""
import json
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
QUELLE, ZIEL = REPO / "ui" / "kompass", REPO / "ui" / "js" / "kompass.js"


def tabelle() -> dict:
    return {p.stem.removeprefix("kompass-"): p.read_text(encoding="utf-8").strip() for p in sorted(QUELLE.glob("kompass-*.svg"))}


def js_text() -> str:
    zeilen = ",\n".join(f"    {json.dumps(k)}: {json.dumps(v, ensure_ascii=False)}" for k, v in tabelle().items())
    return f"""/* Kompass je Kartenlook — ERZEUGT von scripts/kompass_js.py aus ui/kompass/*.svg (nicht von Hand ändern).
 *
 * Dieselben Bilder wie das Web-Studio: viewBox 0 0 64 64, Norden oben, Mittelpunkt (32, 32); die App dreht den Pfeil
 * selbst (--rz-north). `rzKompassFuer(einstellungen)` liefert das SVG zum Look des Projekts (map_style „kartenlook“ +
 * kartenlook.id); Luftbild und alle anderen Karten behalten den Pfeil der App (RZ_NORTH_SVG = „natuerlich“).
 */
(function (root) {{
  "use strict";
  const KOMPASS = {{
{zeilen}
  }};
  function rzKompassFuer(e) {{
    const id = e && e.map_style === "kartenlook" && e.kartenlook ? (typeof e.kartenlook === "string" ? e.kartenlook : e.kartenlook.id) : null;
    return (id && KOMPASS[id]) || root.RZ_NORTH_SVG || KOMPASS.natuerlich;
  }}
  root.RZ_KOMPASS = KOMPASS;
  root.rzKompassFuer = rzKompassFuer;
}})(typeof window !== "undefined" ? window : globalThis);
"""


if __name__ == "__main__":
    ZIEL.write_text(js_text(), encoding="utf-8")
    print(f"{ZIEL.relative_to(REPO)}: {len(tabelle())} Kompasse")
