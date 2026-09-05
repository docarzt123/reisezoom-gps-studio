#!/usr/bin/env python3
"""Alle Tests aus `tests/` finden und ausführen — einer nach dem anderen.

Warum es das braucht
--------------------
In `tests/` lagen 18 Testdateien, von denen `release_check.sh` genau vier
aufrief. Die anderen 14 startete kein einziges Skript — sie liefen also auch
lokal nie, außer jemand tippte sie von Hand. Darunter die End-to-End-Tests fürs
Geotagging, also für den einzigen Programmteil, der fremde Dateien
**unwiderruflich überschreibt**. Beim Nachsehen war einer davon schon länger
rot, ohne dass es jemandem auffiel.

Die Tests brauchen kein pytest: Jede Datei ist ein eigenständiges Skript, das
mit `sys.exit(0)` oder `sys.exit(1)` endet. Genau das wird hier ausgewertet.

Einordnung statt Alles-oder-nichts
----------------------------------
Nicht jeder Test kann überall laufen. `BEDINGT` listet, was ein Test braucht —
fehlt es, wird er übersprungen statt fälschlich als Fehler gezählt. Was
übersprungen wurde, steht am Ende trotzdem da: Ein stiller Übersprung ist auch
nur ein Prüfer, der grün meldet, ohne zu prüfen.

Aufruf:
    .venv/bin/python scripts/run_tests.py            # alles, was laufen kann
    .venv/bin/python scripts/run_tests.py --list     # nur auflisten
    .venv/bin/python scripts/run_tests.py --alle     # auch die bedingten erzwingen
    .venv/bin/python scripts/run_tests.py test_core  # gezielt (Teilname genügt)
"""
from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
TESTS = REPO / "tests"

# Was ein Test zusätzlich braucht. Fehlt es, wird übersprungen — mit Grund.
#   "netz"     — braucht eine Internetverbindung
#   "token"    — braucht einen Mapbox-Zugang
#   "fixtures" — braucht Beispieldateien, die nicht im Repo liegen
#   "langsam"  — dauert Minuten (echte Renders)
BEDINGT = {
    "test_https_certificates.py": ("netz",),
    # ⚠️ Beide standen bis v0.9.503 auf „langsam" und liefen damit bei KEINEM
    # Release mit. Genau deshalb blieb der Render-Totalausfall vier Versionen
    # lang unentdeckt — `test_animator_render.py` hätte ihn beim ersten Lauf
    # gefunden. Jetzt laufen sie, sobald ihre Voraussetzungen da sind:
    #   · der MP4-Test braucht Karte und Token (~17 s)
    #   · der Alpha-Test rendert ohne Karte, braucht also gar nichts (~4 s)
    # Das kostet die Reihe etwa 20 Sekunden. Der Fehler kostete vier Releases.
    "test_animator_render.py": ("token", "netz"),
    "test_schwarm_m1_render.py": ("token", "netz"),   # 28.08.2026: Schwarm über den ANIMATOR-Pfad
    "test_render_alle_karten.py": ("netz",),          # 05.09.2026: JEDER Kartenstil rendert (Mapbox/MapTiler nur mit Schlüssel, sonst übersprungen)
    "test_animator_alpha.py": (),
    "test_geotagger_e2e.py": ("fixtures",),
    "test_raw_geotagging.py": ("fixtures",),
    "test_video_geotagging.py": ("fixtures",),
    "test_geotag_lichtstempel.py": ("fixtures",),
    "test_fit_sensors.py": ("fixtures",),
    "test_web_tagger.py": ("netz",),
}

# Bekannt veraltete Tests laufen NICHT mit und tauchen am Ende als offener
# Punkt auf — damit sie nicht in Vergessenheit geraten. Leer ist der Normalfall:
# Ein Test, der die Wirklichkeit nicht mehr abbildet, wird nachgezogen, nicht
# geduldet.
VERALTET: dict = {}

FARBE_OK = "\033[32m"
FARBE_ROT = "\033[31m"
FARBE_GRAU = "\033[2m"
FARBE_AUS = "\033[0m"


def netz_da() -> bool:
    import socket
    try:
        socket.create_connection(("1.1.1.1", 53), timeout=2).close()
        return True
    except OSError:
        return False


def token_da() -> bool:
    if os.environ.get("MAPBOX_TOKEN"):
        return True
    try:
        sys.path.insert(0, str(REPO))
        from app import _active_mapbox_token
        return bool(_active_mapbox_token())
    except Exception:       # noqa: BLE001
        return False


def fixtures_da() -> bool:
    """Beispielfotos/-tracks für die End-to-End-Tests."""
    return (TESTS / "fixtures").is_dir() and any((TESTS / "fixtures").iterdir())


def main() -> int:
    argv = [a for a in sys.argv[1:]]
    nur_liste = "--list" in argv
    alles = "--alle" in argv
    muster = [a for a in argv if not a.startswith("--")]

    dateien = sorted(TESTS.glob("test_*.py"))
    if muster:
        dateien = [d for d in dateien if any(m in d.name for m in muster)]
    if not dateien:
        print("Keine passenden Tests gefunden.")
        return 1

    # Voraussetzungen einmal prüfen, nicht je Test.
    hat = {}
    if not alles:
        noetig = {b for d in dateien for b in BEDINGT.get(d.name, ())}
        if "netz" in noetig:
            hat["netz"] = netz_da()
        if "token" in noetig:
            hat["token"] = token_da()
        if "fixtures" in noetig:
            hat["fixtures"] = fixtures_da()
        # „langsam" läuft nur auf ausdrücklichen Wunsch mit.
        hat["langsam"] = False

    if nur_liste:
        print(f"\n{len(dateien)} Testdateien in {TESTS}:\n")
        for d in dateien:
            marke = ""
            if d.name in VERALTET:
                marke = "  (veraltet — läuft nicht mit)"
            elif d.name in BEDINGT:
                marke = f"  (braucht: {', '.join(BEDINGT[d.name])})"
            print(f"  {d.name}{marke}")
        return 0

    print(f"\n{'═' * 62}")
    print(f"  {len(dateien)} Testdateien")
    print(f"{'═' * 62}")

    ok, rot, sprung, veraltet = [], [], [], []
    beginn = time.time()

    for d in dateien:
        if d.name in VERALTET and not alles:
            veraltet.append(d.name)
            print(f"{FARBE_GRAU}  ⊘ {d.name}  — veraltet{FARBE_AUS}")
            continue

        fehlt = [b for b in BEDINGT.get(d.name, ()) if not hat.get(b, True)]
        if fehlt and not alles:
            sprung.append((d.name, ", ".join(fehlt)))
            print(f"{FARBE_GRAU}  ⏭  {d.name}  — braucht {', '.join(fehlt)}{FARBE_AUS}")
            continue

        t0 = time.time()
        r = subprocess.run([sys.executable, str(d)], cwd=str(REPO),
                           capture_output=True, text=True)
        dauer = time.time() - t0
        if r.returncode == 0:
            ok.append(d.name)
            print(f"{FARBE_OK}  ✓ {d.name}{FARBE_AUS}  ({dauer:.1f}s)")
        else:
            rot.append((d.name, r))
            print(f"{FARBE_ROT}  ✗ {d.name}{FARBE_AUS}  ({dauer:.1f}s)")

    print(f"\n{'═' * 62}")
    print(f"  {len(ok)} bestanden · {len(rot)} gescheitert · "
          f"{len(sprung)} übersprungen · {len(veraltet)} veraltet"
          f"   [{time.time() - beginn:.0f}s]")
    print(f"{'═' * 62}")

    if rot:
        print(f"\n{FARBE_ROT}Gescheitert:{FARBE_AUS}")
        for name, r in rot:
            print(f"\n──── {name} " + "─" * (52 - len(name)))
            hinten = (r.stdout or "").strip().splitlines()[-12:]
            for zeile in hinten:
                print(f"  {zeile}")
            if r.stderr and r.stderr.strip():
                for zeile in r.stderr.strip().splitlines()[-8:]:
                    print(f"  {FARBE_ROT}{zeile}{FARBE_AUS}")

    if sprung:
        print(f"\n{FARBE_GRAU}Übersprungen (Voraussetzung fehlt):{FARBE_AUS}")
        for name, grund in sprung:
            print(f"  · {name} — {grund}")

    if veraltet:
        print(f"\n{FARBE_GRAU}Veraltet — offener Punkt, nicht vergessen:{FARBE_AUS}")
        for name in veraltet:
            print(f"  · {name}: {VERALTET[name]}")

    return 1 if rot else 0


if __name__ == "__main__":
    sys.exit(main())
