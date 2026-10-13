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

import json
import os
import re
import subprocess
import sys
import threading
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
    "test_render_alle_karten.py": ("netz",),          # 05.09.2026: JEDER Kartenstil rendert (Mapbox/MapTiler nur mit Schlüssel, sonst übersprungen)
    "test_reise_szene_render.py": ("netz", "langsam"),   # 09.09.2026: Etappenfolge über die Szene, Video == Vorschau
    "test_quellenzeile_szene.py": ("netz",),           # 29.09.2026: Quellenzeile Video == Vorschau auch bei Mindestbreite (9:16)
    "test_track_highlights.py": ("netz",),
    "test_container_szene.py": ("netz",),              # 30.09.2026: Container in der Szene, Alpha über die Szene, Web-Karte             # 30.09.2026: Highlights aus dem Track (Komoot) — Berechnung + Szene
    "test_schnellvideo_ruhe.py": ("netz",),            # 29.09.2026: Pfeil/Kamera ruhig im Szenen-Render, keine Einzelbild-Sprünge
    "test_vorwaermen.py": ("netz",),                   # 29.09.2026: Kacheln vorwärmen grob → fein, Budget, Abbrechen
    "test_punkte_regler.py": ("netz",),                # 30.09.2026: Punkte-Regler wirkt auch im Probelauf/Video
    "test_kachel_ausfall.py": ("netz",),               # 30.09.2026: Kartendienst fällt aus → Ersatz-Kachel, kein Warten, Hinweis
    "test_vorlaeufer.py": ("netz", "langsam"),         # 30.09.2026: Vorläufer lädt beim Rendern voraus (kalter Render, Abbruch)
    "test_tempo_szene_render.py": ("netz", "langsam"),  # 08.09.2026: Tempo-Kurve über den Szenen-Render belegt (die schnelle Fassung ist test_tempo_wirkung.py)
    "test_render_matrix.py": ("netz", "langsam"),     # 06.09.2026 abends: Gelände-Matrix über die gemeinsame Szene (Marcs Archiv-Kopie): Wackeltest, Riss-Test, Kurzrender — NUR Release (langsam)
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

ZEITLIMIT_S = int(os.environ.get("RZ_TEST_ZEITLIMIT_S", "1800"))   # je Testdatei

# 12.10.2026 (Marc: „zweieinhalb Stunden? das wird ja immer länger") — `--parallel=N`: die meisten Tests laufen zu N
# gleichzeitig (längste zuerst, Dauern aus dem letzten Lauf), danach EINZELN, was rendert oder Zeiten misst — deren
# Messungen sollen keine fremde Last sehen. Erkannt an „langsam“ und am Namen; bei Bedarf hier ergänzen.
ALLEIN_MUSTER = ("render", "szene", "vorwaermen", "kachel", "vorlaeufer", "tempo", "zeit", "haenger", "flimmer",
                 "wackel", "matrix", "bench", "timing", "dauer", "zwei_leser", "mount_haengt", "ladefeedback",
                 # warten auf kurze Zwischenzustände („wird eingelesen …“, Neustart) — unter dreifacher Last zu knapp
                 "fotos_startort", "etappe_ohne_gps", "videoassistent_vorschau")
# einzelne Dateien, deren Name kein Muster trägt: test_logbuch ändert globale Logbuch-Einstellungen (⌘Z-Prüfung) und
# fragt den POI-Dienst — zu dritt rot (12.10.2026), einzeln grün
ALLEIN_NAMEN = {"test_logbuch.py"}
DAUERN_DATEI = Path(__file__).resolve().parent.parent / "tests" / ".dauern.json"


def allein(name: str) -> bool:
    # „…_schnell“ = Tempo-Messung; die Schnell-Video-Tests (Oberfläche) dürfen parallel
    return ("langsam" in BEDINGT.get(name, ()) or name in ALLEIN_NAMEN or any(m in name for m in ALLEIN_MUSTER)
            or bool(re.search(r"schnell(?!video)", name)))

# 11.10.2026 (Marc: „alles auf der externen Platte machen“) — auf dem Mac mini legen die Tests ihre Kopien auf der externen
# Platte an statt im System-Temp der kleinen Systemplatte. Die Testdateien erben TMPDIR (tempfile folgt ihm).
_EXT_TEMP = Path("/Volumes/MacMini 2TB Acasis/_tmp/gps-studio-tests")
if _EXT_TEMP.parent.parent.is_dir() and not os.environ.get("TMPDIR", "").startswith("/Volumes/"):
    _EXT_TEMP.mkdir(parents=True, exist_ok=True)
    os.environ["TMPDIR"] = str(_EXT_TEMP) + "/"


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
    # 09.10.2026 (Marc: „entweder du behebst alles, was rot ist oder übersprungen werden muss, oder du nimmst die Tests
    # raus“) — die echten Renders („langsam“) laufen in der Nacht-Suite mit; Netz/Schlüssel werden weiter geprüft
    mit_langsam = "--langsam" in argv
    parallel = 1
    for a in argv:
        if a.startswith("--parallel="):
            try:
                parallel = max(1, min(8, int(a.split("=", 1)[1])))
            except ValueError:
                pass
    muster = [a for a in argv if not a.startswith("--")]

    # 04.10.2026 — Stempel „volle Suite grün für diesen Commit" (scripts/suite_stempel.py): nur bei sauberem
    # Arbeitsstand am Anfang und Ende, ohne Namensfilter, HEAD unverändert. Das Upload-Skript spart sich dann die
    # Wiederholung der Suite.
    try:
        import suite_stempel as _st
        _st_kopf, _st_sauber = _st.git("rev-parse", "HEAD"), _st.sauber()
    except Exception:  # noqa: BLE001 — ohne Git (Paket, Kopie) einfach kein Stempel
        _st, _st_kopf, _st_sauber = None, "", False

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
        hat["langsam"] = mit_langsam

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

    laufen = []
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
        laufen.append(d)

    def einer(d):
        t0 = time.time()
        # 06.10.2026: ein Test hing in der Nacht-Suite fast 3 Stunden und kostete den Rest der Nacht. Zeitlimit je
        # Test (der längste braucht ~6 min); wer es reißt, ist rot und die Suite läuft weiter.
        try:
            r = subprocess.run([sys.executable, str(d)], cwd=str(REPO),
                               capture_output=True, text=True, timeout=ZEITLIMIT_S)
        except subprocess.TimeoutExpired as e:
            def _txt(v):
                return v.decode("utf-8", "replace") if isinstance(v, bytes) else (v or "")
            r = subprocess.CompletedProcess(e.cmd, 124, _txt(e.stdout) + f"\n⏱ Zeitlimit {ZEITLIMIT_S // 60} min überschritten — abgebrochen\n",
                                            _txt(e.stderr))
        return d, r, time.time() - t0

    dauern_alt = {}
    try:
        dauern_alt = json.loads(DAUERN_DATEI.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        pass
    dauern_neu = {}
    sperre = threading.Lock()

    def melden(d, r, dauer):
        with sperre:
            dauern_neu[d.name] = round(dauer, 1)
            if r.returncode == 0:
                ok.append(d.name)
                print(f"{FARBE_OK}  ✓ {d.name}{FARBE_AUS}  ({dauer:.1f}s)", flush=True)
            else:
                rot.append((d.name, r))
                print(f"{FARBE_ROT}  ✗ {d.name}{FARBE_AUS}  ({dauer:.1f}s)", flush=True)
                if parallel > 1:   # sofort sehen, was los ist — nicht erst am Ende
                    for zeile in (r.stdout or "").strip().splitlines()[-6:]:
                        print(f"      {zeile}", flush=True)

    if parallel <= 1:
        for d in laufen:
            melden(*einer(d))
    else:
        # 12.10.2026 (Marc: „je schneller man Tests durchhat, desto früher weiß man, ob einer rot ist“) — die schnellsten
        # zuerst (früh Bescheid), aber EINE Bahn nimmt von hinten die langsamsten, damit die Riesen nicht am Ende allein
        # laufen. Danach einzeln (Render/Zeitmessung), ebenfalls kurze zuerst.
        dauer_von = lambda d: float(dauern_alt.get(d.name, 30))
        schlange = sorted((d for d in laufen if not allein(d.name)), key=dauer_von)
        einzeln = sorted((d for d in laufen if allein(d.name)), key=dauer_von)
        print(f"  {len(schlange)} zu {parallel} gleichzeitig (kurze zuerst, eine Bahn von hinten), danach {len(einzeln)} einzeln", flush=True)
        q_sperre = threading.Lock()

        def bahn(von_hinten):
            while True:
                with q_sperre:
                    if not schlange:
                        return
                    d = schlange.pop() if von_hinten else schlange.pop(0)
                melden(*einer(d))
        faeden = [threading.Thread(target=bahn, args=(i == 0,), daemon=True) for i in range(parallel)]
        for f in faeden:
            f.start()
        for f in faeden:
            f.join()
        for d in einzeln:
            melden(*einer(d))
    try:
        DAUERN_DATEI.write_text(json.dumps(dict(dauern_alt, **dauern_neu), indent=0, sort_keys=True), encoding="utf-8")
    except OSError:
        pass

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

    if _st is not None and not rot and not muster and not nur_liste and _st_sauber:
        try:
            if _st.git("rev-parse", "HEAD") == _st_kopf and _st.sauber():
                _st.schreiben(_st_kopf, len(ok))
                print(f"{FARBE_GRAU}Stempel: volle Suite grün für {_st_kopf[:7]} (.rz_suite_gruen.json){FARBE_AUS}")
            else:
                print(f"{FARBE_GRAU}Kein Stempel: Arbeitsstand hat sich während des Laufs geändert{FARBE_AUS}")
        except Exception:  # noqa: BLE001
            pass
    elif _st is not None and not rot and not muster and not nur_liste:
        print(f"{FARBE_GRAU}Kein Stempel: Arbeitsstand war beim Start nicht sauber (git status){FARBE_AUS}")

    return 1 if rot else 0


if __name__ == "__main__":
    sys.exit(main())
