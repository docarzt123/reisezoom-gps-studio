#!/usr/bin/env python3
"""OpenFreeMap „Positron“ als mitgelieferte Vorlage der Kartenlooks (07.10.2026).

`ui/js/kartenlook.js` färbt diese Vorlage je Rolle um (Land, Wasser, Straßen …). Sie liegt als Skript bei
(`ui/vendor/ofm-positron.js` → `window.RZ_OFM_POSITRON`), damit App-Vorschau, Video und GPS Studio Web exakt denselben
Stil zeichnen — auch ohne Netz und ohne auf eine geänderte Vorlage im Netz hereinzufallen. Die Kacheln selbst kommen
weiter von OpenFreeMap (TileJSON `planet`).

Aufruf:  python3 scripts/update_ofm_positron.py            # holt die aktuelle Vorlage
         python3 scripts/update_ofm_positron.py datei.json # aus einer gespeicherten Datei

Stil-Lizenz: OpenMapTiles-Stile (Positron von CARTO/OpenMapTiles) — Code BSD-3-Clause, Gestaltung CC-BY 4.0;
Daten © OpenStreetMap-Mitwirkende (ODbL). Nennung in der Quellenzeile und im Über-Dialog.
"""
import json
import sys
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ZIEL = REPO / "ui" / "vendor" / "ofm-positron.js"
URL = "https://tiles.openfreemap.org/styles/positron"


def main() -> int:
    if len(sys.argv) > 1:
        stil = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    else:
        req = urllib.request.Request(URL, headers={"User-Agent": "ReisezoomGPSStudio"})
        with urllib.request.urlopen(req, timeout=30) as r:   # noqa: S310 — feste https-Adresse
            stil = json.loads(r.read().decode("utf-8"))
    if not any(l.get("id") == "water" for l in stil.get("layers", [])):
        print("❌ keine Positron-Vorlage (Ebene „water“ fehlt)")
        return 1
    kopf = ("/* OpenFreeMap „Positron“ — Vorlage der Kartenlooks (ui/js/kartenlook.js). Erzeugt von\n"
            " * scripts/update_ofm_positron.py, nicht von Hand ändern. Stil: OpenMapTiles/CARTO (BSD-3-Clause, Gestaltung\n"
            " * CC-BY 4.0); Daten © OpenStreetMap-Mitwirkende (ODbL), Kacheln OpenFreeMap. */\n")
    ZIEL.write_text(kopf + "(typeof window !== \"undefined\" ? window : globalThis).RZ_OFM_POSITRON = " + json.dumps(stil, ensure_ascii=False, separators=(",", ":")) + ";\n",
                    encoding="utf-8")
    print(f"✅ {ZIEL.relative_to(REPO)} ({len(stil['layers'])} Ebenen, {ZIEL.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
