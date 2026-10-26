#!/usr/bin/env python3
"""Kamerafahrt eines GPS-Studio-Projekts Bild für Bild als JSON („rz-kamera/1“) — ohne Video.

    .venv/bin/python scripts/kamera_export.py --liste                      # Projekte: ID · Name
    .venv/bin/python scripts/kamera_export.py --liste masca                # … nur die mit „masca“ im Namen
    .venv/bin/python scripts/kamera_export.py PROJEKT_ID                   # → App-Ordner/kamera_export/<Zeit>-<Name>.json
    .venv/bin/python scripts/kamera_export.py PROJEKT_ID --ziel kamera.json --vorschau 960x540
    .venv/bin/python scripts/kamera_export.py --rzproj tour.rzproj [--ziel ordner/]   # exportiertes Projekt direkt

In der installierten App dasselbe: `gpsstudio camera-export --rzproj tour.rzproj [--out datei.json]` (core/cli.py).

`--rzproj`: spielt das Paket (Projekt → „Projekt exportieren (.rzproj)“) in einen eigenen, leeren App-Ordner im Temp-Ordner
ein — die Bibliothek der App bleibt unberührt — und exportiert das aktive Projekt des Pakets. Ziel ohne Angabe: neben der
.rzproj-Datei, gleicher Name mit „.kamera.json“.

Benutzt die Bibliothek der App (App-Ordner wie die App selbst, oder RZ_APP_ORDNER). Läuft durch dieselbe Szene wie der
Video-Render (core/szene.kamera_export): dieselbe Kamera wie im Video, nur ohne Bilder aufzunehmen. Die App darf dabei
offen sein (nur gelesen). Format und Felder: docs/DEVELOPER.md, Abschnitt „Kamera-Export“.
"""
import argparse
import json
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
os.chdir(REPO)
os.environ.setdefault("RZ_CLOUD", "0")   # kein Abgleich mit der Cloud aus diesem Aufruf


def main() -> int:
    ap = argparse.ArgumentParser(description="Kamerafahrt eines Projekts Bild für Bild als JSON (rz-kamera/1)")
    ap.add_argument("projekt", nargs="?", help="Projekt-ID (siehe --liste)")
    ap.add_argument("--liste", nargs="?", const="", metavar="SUCHE", help="Projekte auflisten (optional Namensfilter)")
    ap.add_argument("--ziel", default="", help="Zieldatei (.json); leer = App-Ordner/kamera_export/")
    ap.add_argument("--vorschau", default="", help="Vorschau-Größe in CSS-px wie beim Render aus der App, z. B. 960x540")
    ap.add_argument("--rzproj", default="", help="exportiertes Projekt (.rzproj) in eigenem App-Ordner einspielen und exportieren")
    a = ap.parse_args()
    if a.rzproj:
        return _aus_paket(a)

    import app as APP   # erst jetzt: App-Ordner steht fest
    from core import projekte as P
    if a.liste is not None:
        daten = P.laden(APP.DATEN_ORT)
        such = a.liste.lower()
        for pid, pj in sorted((daten.get("projects") or {}).items(), key=lambda kv: str(kv[1].get("name") or "")):
            name = str(pj.get("name") or "")
            if such in name.lower():
                print(f"{pid}\t{name}")
        return 0
    if not a.projekt:
        ap.error("Projekt-ID fehlt (siehe --liste)")
    w = h = 0
    if a.vorschau:
        w, h = (int(x) for x in a.vorschau.lower().split("x"))
    api = APP.Api()
    r = api.kamera_export(a.projekt, a.ziel, w, h)
    print(json.dumps(r, ensure_ascii=False))
    return 0 if r.get("ok") else 1


def _aus_paket(a) -> int:
    """Paket in einen frischen App-Ordner (Temp) einspielen, aktives Projekt exportieren."""
    import tempfile
    paket = Path(a.rzproj).expanduser().resolve()
    if not paket.is_file():
        print(json.dumps({"ok": False, "error": f"Datei fehlt: {paket}"}, ensure_ascii=False))
        return 1
    w = Path(tempfile.mkdtemp(prefix="rz-kamera-paket-")).resolve()
    __import__("atexit").register(__import__("shutil").rmtree, w, True)   # eingespielte Kopie nach dem Export wegräumen
    appo, bib = w / "App-Ordner", w / "Bibliothek"
    appo.mkdir(parents=True)
    (appo / "bibliothek.json").write_text(json.dumps({"pfad": str(bib), "vorher": []}))
    (appo / "testrechner.json").write_text(json.dumps({"schreiben_nur_in": [str(w)] + ([str(Path(a.ziel).expanduser().resolve().parent)] if a.ziel else [str(paket.parent)])}))
    (appo / "settings.json").write_text(json.dumps({"onboarding_done": True, "logbuch_lernen_gefragt": True, "update_check_enabled": False,
                                                    "willkommen_beim_start": False}))
    os.environ.update(RZ_APP_ORDNER=str(appo), RZ_CLOUD_ABLAGE="datei", RZ_KEIN_WILLKOMMEN="1")
    from core import bibliothek
    bibliothek.anlegen(bib)
    import app as APP
    from core import cli as CLI
    ziel = a.ziel or str(paket.parent / (paket.stem + ".kamera.json"))
    if a.ziel and Path(a.ziel).is_dir():
        ziel = str(Path(a.ziel) / (paket.stem + ".kamera.json"))
    w_, h_ = (int(x) for x in a.vorschau.lower().split("x")) if a.vorschau else (0, 0)
    r = CLI.kamera_aus_paket(APP, APP.Api(), paket, Path(ziel), w_, h_)   # dieselbe Funktion wie `gpsstudio camera-export`
    print(json.dumps(r, ensure_ascii=False))
    return 0 if r.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
