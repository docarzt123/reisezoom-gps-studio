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
import shutil
import subprocess
import sys
import tempfile
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
    "test_laufpunkt_logbuch_video.py": ("netz",),      # 19.10.2026: Symbol nach Aktivität in der Luft und im Szenen-Video
    "test_kachel_ausfall.py": ("netz",),               # 30.09.2026: Kartendienst fällt aus → Ersatz-Kachel, kein Warten, Hinweis
    "test_render_neustart.py": ("netz",),              # 16.10.2026: Render-Browser stirbt → Neustart, weiter beim selben Bild
    "test_vorlaeufer.py": ("netz", "langsam"),         # 30.09.2026: Vorläufer lädt beim Rendern voraus (kalter Render, Abbruch)
    "test_tempo_szene_render.py": ("netz", "langsam"),  # 08.09.2026: Tempo-Kurve über den Szenen-Render belegt (die schnelle Fassung ist test_tempo_wirkung.py)
    "test_render_matrix.py": ("netz", "langsam"),
    "test_weltumrundung_kamera.py": ("netz", "langsam"),
    "test_hochflug_kamera.py": ("netz",),               # 14.10.2026: Hochflug ruckelfrei, Kamera kreist, Seitenansicht
    "test_orte_nacheinander.py": ("netz",),
    "test_projekt_schliessen_etappe.py": ("netz",),
    "test_etappe_bedienung.py": ("netz",),
    "test_geotagger_paare.py": ("netz",),               # 14.10.2026: RAW+JPEG als Paar im Geotagger (Karte lädt Kacheln)             # 14.10.2026: Live-Höhe, Hinweis Übernehmen, Ortssuche parallel/abbrechen, Route bearbeiten     # 14.10.2026: Projekt schließen → Etappe → ✕ → neues Projekt bleibt leer             # 14.10.2026: Etappe nur mit Orten — Takt, ohne Linie, Schilder bleiben
    "test_wysiwyg_render.py": ("netz", "langsam"),   # 14.10.2026: Bildvergleich Editor ↔ Video (4 Fassungen, Schwelle)   # 14.10.2026: Weltumrundung Bild für Bild über −180° (Hänger, Sprung, Drehung)     # 06.09.2026 abends: Gelände-Matrix über die gemeinsame Szene (Marcs Archiv-Kopie): Wackeltest, Riss-Test, Kurzrender — NUR Release (langsam)
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
#: Vorlage für die Einstellungs-Kopie je Test (16.10.2026): was die Tests ohne Kopie benutzt hätten — der App-Ordner
#: ohne gebaute App ist das Repo (app.py: APP_SUPPORT = ROOT), mit RZ_APP_ORDNER dieser Ordner
EINSTELLUNGEN_VORLAGE = (Path(os.environ["RZ_APP_ORDNER"].strip()).expanduser() if (os.environ.get("RZ_APP_ORDNER") or "").strip()
                         else REPO) / "settings.json"

# 12.10.2026 (Marc: „zweieinhalb Stunden? das wird ja immer länger") — `--parallel=N`: die meisten Tests laufen zu N
# gleichzeitig (längste zuerst, Dauern aus dem letzten Lauf), danach EINZELN, was rendert oder Zeiten misst — deren
# Messungen sollen keine fremde Last sehen. Erkannt an „langsam“ und am Namen; bei Bedarf hier ergänzen.
ALLEIN_MUSTER = ("render", "szene", "vorwaermen", "kachel", "vorlaeufer", "tempo", "zeit", "haenger", "flimmer",
                 "wackel", "matrix", "bench", "timing", "dauer", "zwei_leser", "mount_haengt", "ladefeedback",
                 # warten auf kurze Zwischenzustände („wird eingelesen …“, Neustart) — unter dreifacher Last zu knapp
                 "fotos_startort", "etappe_ohne_gps", "videoassistent_vorschau",
                 # 23.10.2026 (Deploy-Gate 0.9.807 zweimal rot, einzeln grün; Marc: „entzerre die Tests in der Suite“) —
                 # UI-Läufe mit Zeitfenstern: Editor öffnen/Probelauf/„Oberfläche steht höchstens kurz“
                 "codexlauf3", "schilder_viele",
                 # 25.10.2026 — messen Bildabstände der Vorschau (gleichmäßiger Takt); unter dreifacher Last schaltet der Takt
                 # zu Recht um, die Prüfung „ohne Last jedes Bild“ gilt dann nicht
                 "takt")
# einzelne Dateien, deren Name kein Muster trägt: test_logbuch ändert globale Logbuch-Einstellungen (⌘Z-Prüfung) und
# fragt den POI-Dienst — zu dritt rot (12.10.2026), einzeln grün
ALLEIN_NAMEN = {"test_logbuch.py", "test_cli.py"}
DAUERN_DATEI = Path(__file__).resolve().parent.parent / "tests" / ".dauern.json"


#: 23.10.2026 (Marc: „Das müsste doch einfach nur langsam und fertig werden") — Programme, die die Grafikkarte belegen.
#: Läuft eins davon, warten die Browser-Tests länger (scripts/test_tempo_start.py), statt an festen Pausen zu scheitern.
SCHWERE_PROGRAMME = ("Blender", "Final Cut Pro", "DaVinci Resolve", "Compressor", "Motion")


def test_tempo() -> float:
    """Streckfaktor für feste Wartezeiten — nur von Hand (RZ_TEST_TEMPO_FEST=2.5), sonst 1."""
    v = (os.environ.get("RZ_TEST_TEMPO_FEST") or "").strip()
    if v:
        try:
            return max(1.0, min(5.0, float(v)))
        except ValueError:
            pass
    # Automatisch NICHT mehr (Deploy-Gate 0.9.808, 23.10.2026 abends): gestreckte Pausen halfen Tests, die auf etwas
    # Erscheinendes warten, verdarben aber die, die einen kurzen Zwischenzustand prüfen („läuft seit N s“ in der
    # Statusbox) — 12 statt 3–4 rote im Parallellauf. Unter Fremdlast hilft die Einzel-Nachprüfung am Ende.
    return 1.0


def allein(name: str) -> bool:
    # „…_schnell“ = Tempo-Messung; die Schnell-Video-Tests (Oberfläche) dürfen parallel
    return ("langsam" in BEDINGT.get(name, ()) or name in ALLEIN_NAMEN or any(m in name for m in ALLEIN_MUSTER)
            or bool(re.search(r"schnell(?!video)", name)))

# 11.10.2026 (Marc: „alles auf der externen Platte machen“) — auf dem Mac mini legen die Tests ihre Kopien auf der externen
# Platte an statt im System-Temp der kleinen Systemplatte. Die Testdateien erben TMPDIR (tempfile folgt ihm).
_EXT_TEMP = Path("/Volumes/MacMini 2TB Acasis/_tmp/gps-studio-tests")
# 26.10.2026 — Exit-Code eines Tests für „hier nicht messbar, übersprungen“ (wie bei automake/pytest-Konventionen 77)
UEBERSPRUNGEN = 77
if _EXT_TEMP.parent.parent.is_dir() and not os.environ.get("TMPDIR", "").startswith("/Volumes/"):
    _EXT_TEMP.mkdir(parents=True, exist_ok=True)
    os.environ["TMPDIR"] = str(_EXT_TEMP) + "/"


# 13.10.2026 — Netz-Konserve (core/netzkonserve.py): Photon/Nominatim/Overpass beantworten die Tests aus Aufnahmen statt
# übers Netz (langsames Photon machte die Suite rot). Ein gemeinsamer Ordner auf der externen Platte — Arbeitsordner und
# Nacht-Kopie (rsync --delete) nutzen dieselben Aufnahmen. `--live-netz` schaltet sie aus.
_KONSERVE = Path("/Volumes/MacMini 2TB Acasis/GPS-Studio-Testdaten/netz-konserve")
if not _KONSERVE.parent.parent.is_dir():
    _KONSERVE = REPO / "tests" / "netz_konserve"
# 24.10.2026 — „Neu in Version …“ und die Logbuch-Frage beim Start stören die Oberflächentests nicht (app.js)
os.environ.setdefault("RZ_KEIN_WILLKOMMEN", "1")
if "--live-netz" not in sys.argv and not os.environ.get("RZ_NETZ_KONSERVE"):
    os.environ["RZ_NETZ_KONSERVE"] = str(_KONSERVE)


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


def _ladeflagge_aufraeumen() -> None:
    """13.10.2026 — Im Quellbaum teilen sich alle Tests `ladevorgang.json`. Wurde ein Test mitten im Laden beendet
    (Zeitlimit, Absturz), stand dort „lädt" mit einer toten Prozessnummer, und JEDER folgende Oberflächen-Test sah beim
    Start die Nachfrage „Der letzte Ladevorgang wurde nicht fertig" (Suite 13.10.: 4 Tests rot, auch einzeln). Vor jedem
    Test: eine solche verwaiste Marke als abgebrochen kennzeichnen — eine von einem noch laufenden Test bleibt."""
    f = REPO / "ladevorgang.json"
    try:
        info = json.loads(f.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return
    if info.get("status") != "laedt":
        return
    try:
        pid = int(info.get("pid") or 0)
    except (TypeError, ValueError):
        pid = 0
    if pid > 0:
        try:
            os.kill(pid, 0)
            return                   # der Test läuft noch
        except PermissionError:
            return
        except OSError:
            pass
    info["status"] = "abgebrochen_im_test"
    try:
        f.write_text(json.dumps(info, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass


def main() -> int:
    argv = [a for a in sys.argv[1:]]
    nur_liste = "--list" in argv
    alles = "--alle" in argv
    # 09.10.2026 (Marc: „entweder du behebst alles, was rot ist oder übersprungen werden muss, oder du nimmst die Tests
    # raus“) — die echten Renders („langsam“) laufen in der Nacht-Suite mit; Netz/Schlüssel werden weiter geprüft
    mit_langsam = "--langsam" in argv
    if mit_langsam:
        os.environ["RZ_LANGSAM"] = "1"   # 13.10.2026 — Tests mit langsamem Zusatzteil (z. B. test_cli: echter Render) sehen es
    parallel = 1
    for a in argv:
        if a.startswith("--parallel="):
            try:
                parallel = max(1, min(8, int(a.split("=", 1)[1])))
            except ValueError:
                pass
    muster = [a for a in argv if not a.startswith("--")]

    # 04.10.2026 — Stempel „volle Suite grün für diesen Stand" (scripts/suite_stempel.py): ohne Namensfilter, HEAD und
    # offene Änderungen am Ende wie am Anfang. Das Upload-Skript spart sich dann die Wiederholung der Suite.
    # 15.10.2026 — auch mit offenen Änderungen (vorbereitete Versionsnummer): sie stehen mit Inhalt im Stempel.
    try:
        import suite_stempel as _st
        _st_kopf, _st_offen = _st.git("rev-parse", "HEAD"), _st.offen()
    except Exception:  # noqa: BLE001 — ohne Git (Paket, Kopie) einfach kein Stempel
        _st, _st_kopf, _st_offen = None, "", None

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
        tempo = test_tempo()
        _ladeflagge_aufraeumen()
        # 06.10.2026: ein Test hing in der Nacht-Suite fast 3 Stunden und kostete den Rest der Nacht. Zeitlimit je
        # Test (der längste braucht ~6 min); wer es reißt, ist rot und die Suite läuft weiter.
        # 16.10.2026 — eigene Kopie der Einstellungen je Test (RZ_SETTINGS_DATEI, siehe app.py). Vorlage ist die Datei, die
        # die Tests bisher gemeinsam benutzt haben (ohne gebaute App: settings.json im Repo, bzw. im RZ_APP_ORDNER).
        # Parallele Tests stellten sich dort sonst gegenseitig Werte um — die „nur parallel roten“ Wackeltests.
        einst_ordner = Path(tempfile.mkdtemp(prefix="einstellungen-" + d.stem[:30] + "-"))
        einst = einst_ordner / "settings.json"
        # 26.10.2026 — auch TMPDIR je Test in diesen Ordner: Tests, die ihre Kopien nicht wegräumen (abgebrochen, Zeitlimit,
        # kein atexit), ließen sie im gemeinsamen Temp liegen — 2970 Ordner, ~120 GB, die externe Platte lief voll.
        # Die Kachel-Vorlage (tests/szene_umgebung.py) bleibt im gemeinsamen Temp (RZ_TEST_VORLAGEN), sonst je Test 2,3 GB.
        test_tmp = einst_ordner / "tmp"
        test_tmp.mkdir()
        try:
            if EINSTELLUNGEN_VORLAGE.is_file():
                shutil.copy2(EINSTELLUNGEN_VORLAGE, einst)
        except OSError:
            pass
        try:
            # 23.10.2026 — über scripts/test_tempo_start.py: feste Wartezeiten der Browser-Tests × RZ_TEST_TEMPO (Fremdlast)
            r = subprocess.run([sys.executable, str(REPO / "scripts" / "test_tempo_start.py"), str(d)], cwd=str(REPO),
                               env=dict(os.environ, RZ_SETTINGS_DATEI=str(einst), RZ_TEST_TEMPO=f"{tempo:.2f}",
                                        TMPDIR=str(test_tmp) + "/", RZ_TEST_VORLAGEN=tempfile.gettempdir()),
                               capture_output=True, text=True, timeout=int(ZEITLIMIT_S * min(2.0, tempo)))
        except subprocess.TimeoutExpired as e:
            def _txt(v):
                return v.decode("utf-8", "replace") if isinstance(v, bytes) else (v or "")
            r = subprocess.CompletedProcess(e.cmd, 124, _txt(e.stdout) + f"\n⏱ Zeitlimit {ZEITLIMIT_S // 60} min überschritten — abgebrochen\n",
                                            _txt(e.stderr))
        finally:
            shutil.rmtree(einst_ordner, ignore_errors=True)   # eigener Temp-Ordner dieses Laufs
        return d, r, time.time() - t0

    dauern_alt = {}
    try:
        dauern_alt = json.loads(DAUERN_DATEI.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        pass
    dauern_neu = {}
    nur_parallel_rot: list = []
    sperre = threading.Lock()

    def melden(d, r, dauer):
        with sperre:
            dauern_neu[d.name] = round(dauer, 1)
            if r.returncode == 0:
                ok.append(d.name)
                print(f"{FARBE_OK}  ✓ {d.name}{FARBE_AUS}  ({dauer:.1f}s)", flush=True)
            elif r.returncode == UEBERSPRUNGEN:
                # 26.10.2026 — der Test selbst stellt fest, dass er hier nichts Gültiges messen kann (z. B. Zeitmessung auf
                # einem Rechner unter Dauerlast); Grund = seine letzte Ausgabezeile, steht in der Bilanz
                grund = ((r.stdout or "").strip().splitlines() or ["ohne Grund"])[-1].strip()
                sprung.append((d.name, grund))
                print(f"{FARBE_GRAU}  – {d.name}{FARBE_AUS}  ({dauer:.1f}s, übersprungen: {grund})", flush=True)
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
        if test_tempo() > 1.0:
            print(f"  feste Wartezeiten der Browser-Tests × {test_tempo():.1f} (RZ_TEST_TEMPO_FEST)", flush=True)
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
        # 23.10.2026 (Marc: „entzerre die Tests in der Suite“) — wer nur im Parallellauf rot war, läuft noch einmal ALLEIN.
        # Grün allein = Lastfrage, kein Fehler im Code: zählt als bestanden und steht ausdrücklich in der Bilanz (so hält
        # es die Nacht-Suite schon seit 12.10.); rot allein bleibt rot. Vorher brach das Deploy-Gate an solchen Tests ab.
        nach = [(n, r) for n, r in list(rot) if not allein(n)]
        if nach:
            print(f"\n  {len(nach)} nur im Parallellauf rot — noch einmal einzeln:", flush=True)
            for n, _r in nach:
                d = next((x for x in laufen if x.name == n), None)
                if d is None:
                    continue
                d2, r2, dauer2 = einer(d)
                if r2.returncode == 0:
                    rot[:] = [(a, b) for a, b in rot if a != n]
                    ok.append(n)
                    nur_parallel_rot.append(n)
                    dauern_neu[n] = round(dauer2, 1)
                    print(f"{FARBE_OK}  ✓ {n}{FARBE_AUS}  ({dauer2:.1f}s, einzeln)", flush=True)
                else:
                    rot[:] = [(a, (r2 if a == n else b)) for a, b in rot]
                    print(f"{FARBE_ROT}  ✗ {n}{FARBE_AUS}  ({dauer2:.1f}s, auch einzeln rot)", flush=True)
    try:
        DAUERN_DATEI.write_text(json.dumps(dict(dauern_alt, **dauern_neu), indent=0, sort_keys=True), encoding="utf-8")
    except OSError:
        pass

    print(f"\n{'═' * 62}")
    print(f"  {len(ok)} bestanden · {len(rot)} gescheitert · "
          f"{len(sprung)} übersprungen · {len(veraltet)} veraltet"
          f"   [{time.time() - beginn:.0f}s]")
    print(f"{'═' * 62}")

    if nur_parallel_rot:
        print(f"\n{FARBE_GRAU}Nur parallel rot, einzeln grün (Last, kein Code-Fehler): {', '.join(nur_parallel_rot)}{FARBE_AUS}")
    if rot:
        print(f"\n{FARBE_ROT}Gescheitert:{FARBE_AUS}")
        for name, r in rot:
            print(f"\n──── {name} " + "─" * (52 - len(name)))
            # 23.10.2026 — die roten Prüfungen samt Detail aus der GANZEN Ausgabe zeigen: im Gate-Log fehlten sie oft,
            # weil nach der FAIL-Zeile noch viele Zeilen kamen (nur die letzten 12 stehen unten)
            alle = (r.stdout or "").splitlines()
            rote = [z for z in alle if re.search(r"\[FAIL\]|^\s*FEHL |✗ FAIL|Traceback|Error: ", z)]
            for zeile in rote[:15]:
                print(f"  {FARBE_ROT}» {zeile.strip()[:400]}{FARBE_AUS}")
            hinten = (r.stdout or "").strip().splitlines()[-12:]
            for zeile in hinten:
                print(f"  {zeile}")
            if r.stderr and r.stderr.strip():
                for zeile in r.stderr.strip().splitlines()[-8:]:
                    print(f"  {FARBE_ROT}{zeile}{FARBE_AUS}")

    if sprung:
        print(f"\n{FARBE_GRAU}Übersprungen (Voraussetzung fehlt / nicht messbar):{FARBE_AUS}")
        for name, grund in sprung:
            print(f"  · {name} — {grund}")

    if veraltet:
        print(f"\n{FARBE_GRAU}Veraltet — offener Punkt, nicht vergessen:{FARBE_AUS}")
        for name in veraltet:
            print(f"  · {name}: {VERALTET[name]}")

    if _st is not None and _st_offen is not None and not rot and not muster and not nur_liste:
        try:
            if _st.git("rev-parse", "HEAD") == _st_kopf and _st.offen() == _st_offen:
                _st.schreiben(_st_kopf, len(ok), _st_offen)
                print(f"{FARBE_GRAU}Stempel: volle Suite grün für {_st_kopf[:7]}"
                      + (f" + {len(_st_offen)} offene Änderung(en)" if _st_offen else "") + f" (.rz_suite_gruen.json){FARBE_AUS}")
            else:
                print(f"{FARBE_GRAU}Kein Stempel: Arbeitsstand hat sich während des Laufs geändert{FARBE_AUS}")
        except Exception:  # noqa: BLE001
            pass

    return 1 if rot else 0


if __name__ == "__main__":
    sys.exit(main())
