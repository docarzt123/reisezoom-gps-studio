"""Die Tour-Bibliothek — der Ort, an dem GPS Studio seine Daten hält.

Beschlossen mit Marc am 02.09.2026, Begründung in `docs/UMBAU-BIBLIOTHEK.md`.

**Die Bibliothek ist die Wahrheit, beobachtete Ordner sind nur Quellen.**
Jede aufgenommene Tour liegt als Kopie hier, eine Datei je Version,
gzip-komprimiert. Verschwindet die Quelldatei draußen, bleibt die Tour
vollständig. In fremde Dateien wird nie zurückgeschrieben.

Was in der Bibliothek liegt (Marc: „da wird alles gespeichert, außer eben
dem Pfad zur Bibliothek"):

    <Bibliothek>/
        bibliothek.json      Kennung + Schema-Stand (macht den Ordner erkennbar)
        library.db           Archiv-Datenbank
        projekte.json        Projekte
        touren.json          Tour-Register
        touren/aa/<id>.gpx.gz   die Trackdaten, je Version eine Datei
        bilder/              Vorschau-, Karten- und Titelbilder
        projekt_staende/     Arbeitsstand-Verlauf je Projekt
        sicherungen/         rollierende Kopien von library.db
        .sperre              belegt, solange eine App sie offen hat

Was NICHT hineingehört, weil es zum Rechner gehört und nicht zu den Daten:
Einstellungen (samt Mapbox-Konto), Protokolle, Renders, Umwandlungs-Cache,
Foto-Vorschaubilder. Das bleibt im App-Ordner.
"""
from __future__ import annotations

import gzip
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

SCHEMA_STAND = 1
KENNDATEI = "bibliothek.json"
SPERRDATEI = ".sperre"
# Wie lange eine Sperre gilt, deren Prozess nicht mehr lebt oder von einem
# anderen Rechner stammt. Kurz genug, dass ein Absturz nicht aussperrt.
SPERRE_VERFALL_S = 12 * 3600
# Sperren AUS ALTEN FASSUNGEN tragen keine Rechner-Kennung, nur den Namen. Weil
# der Name unter macOS mit dem Netz wechselt (08.09.2026: "MacBookPro.fritz.box"
# -> "MacBook-Pro-von-Marc-2.local"), galten sie als Sperre eines fremden Rechners
# und sperrten 12 Stunden aus. Solche Sperren verfallen darum schnell; sie gibt es
# nur bis zum naechsten Start dieser Fassung.
SPERRE_VERFALL_OHNE_KENNUNG_S = 15 * 60

# Rollierende Sicherungen der Datenbank — der Rettungsanker für Riegel 3.
SICHERUNGEN_MAX = 5


# ── Wo liegt die Bibliothek? ────────────────────────────────────────────────

def zeiger_datei(app_support: Path) -> Path:
    """Die einzige Datei außerhalb der Bibliothek: der Pfad zu ihr."""
    return Path(app_support) / "bibliothek.json"


def standard_ort(app_support: Path) -> Path:
    """Vorgabe für Leute, die sich nicht entscheiden wollen."""
    return Path(app_support) / "Bibliothek"


def ort_lesen(app_support: Path) -> Optional[Path]:
    """Der eingestellte Ort — oder None, wenn noch nie einer gewählt wurde.

    None heißt „Erststart": Die Oberfläche zeigt dann das Onboarding.
    """
    z = zeiger_datei(app_support)
    try:
        d = json.loads(z.read_text(encoding="utf-8"))
        p = str(d.get("pfad") or "").strip()
        return Path(p) if p else None
    except Exception:
        return None


VORHER_MAX = 5


def ort_schreiben(app_support: Path, ort: Path) -> None:
    """Den Zeiger setzen — und den bisherigen Ort MERKEN.

    09.09.2026 (Beta-Tester): Bei „Bibliothek ist bereits geöffnet" klickte er
    „Anderen Ort wählen", bekam eine leere Bibliothek und schrieb „nun ist
    alles leer". Seine Daten lagen unversehrt am alten Ort — nur wusste die
    App den nicht mehr. Deshalb steht der bisherige Ort ab jetzt als `vorher`
    im Zeiger, und die Oberfläche bietet ihn zum Zurückwechseln an.
    """
    z = zeiger_datei(app_support)
    z.parent.mkdir(parents=True, exist_ok=True)
    vorher: list = []
    try:
        d = json.loads(z.read_text(encoding="utf-8"))
        alt = str(d.get("pfad") or "").strip()
        vorher = [str(x) for x in (d.get("vorher") or []) if x]
        if alt:
            vorher.insert(0, alt)
    except Exception:
        pass
    gesehen = set()
    rein = []
    for x in vorher:
        if x == str(ort) or x in gesehen:
            continue
        gesehen.add(x)
        rein.append(x)
    tmp = z.with_suffix(f".tmp{os.getpid()}")
    tmp.write_text(json.dumps({"pfad": str(ort),
                               "gewaehlt_am": datetime.now().astimezone().isoformat(timespec="seconds"),
                               "vorher": rein[:VORHER_MAX]},
                              ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, z)


def vorherige_orte(app_support: Path) -> list:
    """Die zuletzt benutzten Orte, jüngster zuerst — je mit `da` (ist heute
    eine Bibliothek erreichbar) für die Oberfläche."""
    try:
        d = json.loads(zeiger_datei(app_support).read_text(encoding="utf-8"))
        raus = []
        for x in (d.get("vorher") or []):
            x = str(x or "").strip()
            if not x:
                continue
            try:
                da = ist_bibliothek(Path(x))
            except Exception:
                da = False
            raus.append({"pfad": x, "da": bool(da)})
        return raus
    except Exception:
        return []


# ── Riegel 1: keine Cloud-Sync-Ordner ───────────────────────────────────────
#
# Eine SQLite-Datenbank in einem Cloud-Sync-Ordner geht kaputt: Dropbox,
# iCloud Drive, OneDrive und Google Drive tauschen Dateien mitten im
# Schreibvorgang aus. Externe Platte und NAS sind unkritisch, solange nur
# eine Instanz die Bibliothek offen hat (dafür ist Riegel 2 da).
#
# Bewusst ABLEHNEN statt warnen (Marc, 02.09.2026): Eine Warnung, die man
# wegklickt, kostet später den ganzen Bestand.

_CLOUD_MUSTER = (
    "library/mobile documents",     # iCloud Drive (macOS, klein geschrieben)
    "/icloud drive", "icloud~", "com~apple~clouddocs",
    "/dropbox", "\\dropbox",
    "/onedrive", "\\onedrive",
    "/google drive", "\\google drive", "/googledrive", "/gdrive",
    "/pcloud", "/nextcloud", "/owncloud", "/mega", "/sync.com", "/tresorit",
    "/creative cloud files", "/box sync", "/boxdrive", "/idrive", "/jottacloud",
    "/yandex.disk", "/megasync", "/koofr", "/proton drive", "/protondrive",
)


def cloud_ordner_grund(ort: Path) -> str:
    """Nicht-leerer Rückgabewert = dieser Ort ist ein Cloud-Sync-Ordner.

    Der Rückgabewert ist der Name des Dienstes, damit die Meldung konkret
    werden kann („OneDrive") statt allgemein („ein Cloud-Ordner").
    """
    s = str(Path(ort)).replace("\\", "/").lower()
    treffer = {
        "library/mobile documents": "iCloud Drive",
        "/icloud drive": "iCloud Drive", "icloud~": "iCloud Drive",
        "com~apple~clouddocs": "iCloud Drive",
        "/dropbox": "Dropbox", "\\dropbox": "Dropbox",
        "/onedrive": "OneDrive", "\\onedrive": "OneDrive",
        "/google drive": "Google Drive", "\\google drive": "Google Drive",
        "/googledrive": "Google Drive", "/gdrive": "Google Drive",
        "/pcloud": "pCloud", "/nextcloud": "Nextcloud", "/owncloud": "ownCloud",
        "/mega": "MEGA", "/megasync": "MEGA", "/sync.com": "Sync.com",
        "/tresorit": "Tresorit", "/creative cloud files": "Creative Cloud",
        "/box sync": "Box", "/boxdrive": "Box", "/idrive": "IDrive",
        "/jottacloud": "Jottacloud", "/yandex.disk": "Yandex.Disk",
        "/koofr": "Koofr", "/proton drive": "Proton Drive",
        "/protondrive": "Proton Drive",
    }
    for muster, name in treffer.items():
        if muster in s:
            return name
    return ""


# ── Riegel 2: nur eine App je Bibliothek ────────────────────────────────────

def _sperre_lebt(d: dict) -> bool:
    """Gehört die Sperre einem Prozess, der noch läuft?

    Nur auf demselben Rechner beantwortbar. Von einem anderen Rechner (NAS!)
    zählt allein das Alter — deshalb der Verfall.
    """
    try:
        alter = time.time() - float(d.get("zeit") or 0)
    except Exception:
        alter = 0.0
    grenze = SPERRE_VERFALL_S if d.get("rechner_id") else SPERRE_VERFALL_OHNE_KENNUNG_S
    if alter > grenze:
        return False
    if not _gleicher_rechner(d):
        return True                      # fremder Rechner, noch nicht verfallen
    pid = int(d.get("pid") or 0)
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)                  # Signal 0 = „lebst du?"
        return True
    except (ProcessLookupError, ValueError):
        return False
    except PermissionError:
        return True                      # fremder Nutzer, aber am Leben


def _rechnername() -> str:
    try:
        import socket
        return socket.gethostname()
    except Exception:
        return "?"


_RECHNER_ID: Optional[str] = None


def _rechner_id() -> str:
    """Stabile Kennung DIESES Rechners — unabhaengig vom Namen.

    08.09.2026 (Marc: „Bibliothek ist bereits geoeffnet", obwohl nichts lief):
    Der Rechnername ist unter macOS nicht stabil. Im Fritzbox-Netz meldete der
    Mac „MacBookPro.fritz.box", spaeter „MacBook-Pro-von-Marc-2.local". Eine
    Sperre, die beim harten Beenden liegen blieb, galt damit als Sperre eines
    FREMDEN Rechners — und fremde Sperren werden nicht am Prozess geprueft,
    sondern erst nach 12 Stunden ungueltig. Ergebnis: 12 Stunden ausgesperrt.
    Deshalb identifizieren wir den Rechner ueber eine Kennung, die sich nicht
    mit dem Netzwerk aendert; der Name bleibt nur noch fuer die Anzeige.
    """
    global _RECHNER_ID
    if _RECHNER_ID:
        return _RECHNER_ID
    kennung = ""
    try:
        if sys.platform == "darwin":
            aus = subprocess.run(["/usr/sbin/ioreg", "-rd1", "-c", "IOPlatformExpertDevice"],
                                 capture_output=True, text=True, timeout=5).stdout
            m = re.search(r'"IOPlatformUUID"\s*=\s*"([^"]+)"', aus)
            if m:
                kennung = m.group(1)
        elif sys.platform.startswith("linux"):
            for pfad in ("/etc/machine-id", "/var/lib/dbus/machine-id"):
                try:
                    kennung = Path(pfad).read_text(encoding="utf-8").strip()
                    if kennung:
                        break
                except OSError:
                    pass
        elif sys.platform.startswith("win"):
            aus = subprocess.run(["reg", "query", r"HKLM\SOFTWARE\Microsoft\Cryptography",
                                  "/v", "MachineGuid"], capture_output=True, text=True, timeout=5).stdout
            m = re.search(r"MachineGuid\s+REG_SZ\s+(\S+)", aus)
            if m:
                kennung = m.group(1)
    except Exception:  # noqa: BLE001
        kennung = ""
    if not kennung:
        # Notnagel: MAC-Adresse. Aendert sich seltener als der Name, und wenn
        # sie fehlt, faellt die Pruefung sauber auf den Namen zurueck.
        try:
            kennung = f"mac-{uuid.getnode():x}"
        except Exception:  # noqa: BLE001
            kennung = ""
    _RECHNER_ID = kennung
    return kennung


def _gleicher_rechner(d: dict) -> bool:
    """Stammt die Sperre von DIESEM Rechner? Kennung schlaegt Name."""
    fremd_id = str(d.get("rechner_id") or "")
    eigen_id = _rechner_id()
    if fremd_id and eigen_id:
        return fremd_id == eigen_id
    return str(d.get("rechner") or "") == _rechnername()


def sperre_nehmen(ort: Path) -> dict:
    """{"ok": True} — oder {"ok": False, "belegt_von": {...}}."""
    ort = Path(ort)
    ort.mkdir(parents=True, exist_ok=True)
    s = ort / SPERRDATEI
    try:
        alt = json.loads(s.read_text(encoding="utf-8"))
        # Im Test aufgefallen: Ohne diese Zeile sperrt sich die App SELBST aus,
        # sobald sie die Sperre ein zweites Mal nimmt (Bibliothekswechsel,
        # Wiederverbinden nach „Bibliothek nicht erreichbar"). Die eigene
        # Sperre ist keine fremde.
        eigen = (int(alt.get("pid") or 0) == os.getpid()
                 and _gleicher_rechner(alt))
        if not eigen and _sperre_lebt(alt):
            return {"ok": False, "belegt_von": alt}
    except Exception:
        pass                             # keine, kaputte oder verfallene Sperre
    s.write_text(json.dumps({"pid": os.getpid(), "rechner": _rechnername(),
                             "rechner_id": _rechner_id(),
                             "zeit": time.time(),
                             "seit": datetime.now().astimezone().isoformat(timespec="seconds")},
                            ensure_ascii=False), encoding="utf-8")
    return {"ok": True}


def sperre_uebernehmen(ort: Path) -> dict:
    """Eine FREMDE Sperre auf ausdrücklichen Wunsch entfernen.

    09.09.2026 (Beta-Tester, v0.9.663): Die App war hart beendet worden, der
    Rechnername hatte gewechselt, die Sperre galt als fremd — und „Erneut
    suchen" half zwölf Stunden lang nicht. Wer sicher ist, dass kein anderes
    GPS Studio die Bibliothek offen hat, darf sie übernehmen; die Oberfläche
    fragt vorher nach und sagt, was passieren kann.
    """
    s = Path(ort) / SPERRDATEI
    try:
        alt = json.loads(s.read_text(encoding="utf-8"))
    except Exception:
        alt = {}
    try:
        s.unlink()
    except FileNotFoundError:
        pass
    except OSError as e:
        return {"ok": False, "error": str(e)}
    return {"ok": True, "war": alt}


def sperre_freigeben(ort: Path) -> None:
    """Nur die EIGENE Sperre lösen — sonst gäbe ein Absturz sie doppelt frei."""
    s = Path(ort) / SPERRDATEI
    try:
        d = json.loads(s.read_text(encoding="utf-8"))
        if int(d.get("pid") or 0) == os.getpid() and _gleicher_rechner(d):
            s.unlink()
    except Exception:
        pass


# ── Riegel 3: Datenbank prüfen und sichern ──────────────────────────────────

def db_pfad(ort: Path) -> Path:
    return Path(ort) / "library.db"


def sicherungen_ordner(ort: Path) -> Path:
    return Path(ort) / "sicherungen"


def db_heil(pfad: Path) -> bool:
    """`PRAGMA quick_check` — findet zerschossene Seiten, ohne Minuten zu kosten."""
    p = Path(pfad)
    if not p.is_file() or p.stat().st_size == 0:
        return True                      # gibt es noch nicht = in Ordnung
    try:
        con = sqlite3.connect(f"file:{p}?mode=ro", uri=True, timeout=5)
        try:
            zeile = con.execute("PRAGMA quick_check").fetchone()
            return bool(zeile) and str(zeile[0]).lower() == "ok"
        finally:
            con.close()
    except Exception:
        return False


def db_sichern(ort: Path) -> Optional[Path]:
    """Rollierende Kopie der Datenbank. Nutzt die SQLite-Sicherungs-API,
    damit auch eine geöffnete Datenbank konsistent kopiert wird."""
    quelle = db_pfad(ort)
    if not quelle.is_file():
        return None
    ziel_dir = sicherungen_ordner(ort)
    ziel_dir.mkdir(parents=True, exist_ok=True)
    ziel = ziel_dir / f'library-{time.strftime("%Y%m%d-%H%M%S")}.db'
    try:
        con = sqlite3.connect(str(quelle), timeout=10)
        zcon = sqlite3.connect(str(ziel))
        try:
            con.backup(zcon)
        finally:
            zcon.close()
            con.close()
    except Exception:
        return None
    alt = sorted(ziel_dir.glob("library-*.db"))
    for x in alt[:-SICHERUNGEN_MAX]:
        try:
            x.unlink()
        except OSError:
            pass
    return ziel


def sicherungen(ort: Path) -> list:
    """Verfügbare Sicherungen, neueste zuerst — für den Wiederherstellen-Dialog."""
    d = sicherungen_ordner(ort)
    if not d.is_dir():
        return []
    out = []
    for f in sorted(d.glob("library-*.db"), reverse=True):
        try:
            st = f.stat()
        except OSError:
            continue
        out.append({"datei": f.name, "pfad": str(f), "groesse": st.st_size,
                    "zeit": datetime.fromtimestamp(st.st_mtime).astimezone().isoformat(timespec="seconds"),
                    "heil": db_heil(f)})
    return out


def db_wiederherstellen(ort: Path, datei: str) -> dict:
    """Eine Sicherung zurückholen. Die kaputte Datenbank wird NICHT gelöscht,
    sondern beiseitegelegt — sie ist manchmal noch teilweise auslesbar."""
    quelle = sicherungen_ordner(ort) / Path(datei).name
    if not quelle.is_file():
        return {"ok": False, "grund": "sicherung_fehlt"}
    ziel = db_pfad(ort)
    try:
        if ziel.is_file():
            ziel.rename(ziel.with_name(f'library-defekt-{time.strftime("%Y%m%d-%H%M%S")}.db'))
        shutil.copy2(quelle, ziel)
        return {"ok": True}
    except OSError as e:
        return {"ok": False, "error": str(e)}


# ── Der Trackspeicher ───────────────────────────────────────────────────────
#
# Eine Datei je Version, gzip-komprimiert. GPX ist Text und schrumpft auf
# etwa ein Zehntel — 5 000 Touren landen bei rund 250 MB statt 2,5 GB.
# Zwei Zeichen Unterordner, damit kein Verzeichnis mit 10 000 Einträgen
# entsteht (das bremst jedes Dateisystem und jeden Finder).

def touren_ordner(ort: Path) -> Path:
    return Path(ort) / "touren"


def version_datei(ort: Path, version_id: str) -> Path:
    v = str(version_id)
    return touren_ordner(ort) / v[:2] / f"{v}.gpx.gz"


GZIP_MAGIE = b"\x1f\x8b"


def _sieht_nach_gpx_aus(kopf: bytes) -> bool:
    """Ist das der Anfang einer GPX-Datei?

    Gesucht wird das `<gpx`-Element, nicht bloß eine XML-Deklaration: TCX und
    KML fangen genauso mit `<?xml` an und wären sonst als GPX durchgegangen.
    """
    return b"<gpx" in kopf[:4096].lower()


def _format_raten(kopf: bytes) -> str:
    """Welche Endung passt zu diesen Bytes? ("" = unbekannt)

    Nur so genau, wie es für die Umwandlung nötig ist — `core.imports`
    entscheidet danach selbst.
    """
    if kopf[8:12] == b".FIT":
        return ".fit"
    k = kopf[:4096].lower()
    if b"<trainingcenterdatabase" in k:
        return ".tcx"
    if b"<kml" in k:
        return ".kml"
    if b"$gp" in k[:512] or b"$gn" in k[:512]:
        return ".nmea"
    if k.lstrip()[:1] == b"{" and b"coordinates" in k:
        return ".geojson"
    return ""


def _als_gpx(quelle: Path, cache: Optional[Path]) -> tuple[Path, Optional[str]]:
    """Eine Quelldatei als GPX bereitstellen. Rückgabe: (Pfad, Temp-Ordner).

    02.09.2026 — der Grund, warum das hier steht und nicht beim Aufrufer:
    Der Versionsspeicher heißt `.gpx.gz` und **muss** GPX enthalten. Vorher
    packte `version_ablegen` die Quelldatei byte-genau — bei einer `.fit` lag
    danach ein FIT-Block unter GPX-Namen in der Bibliothek. Die Kopie war
    damit wertlos: nicht lesbar für uns, nicht lesbar für den zweiten Rechner,
    und die Cloud spiegelte sie mit. Für Garmin- und Suunto-Nutzer hätte die
    Bibliothek ihr Kernversprechen nicht gehalten.

    Die Umwandlung gehört deshalb in die Ablage selbst und nicht in die Hände
    der vier Aufrufer — einer davon vergisst sie sonst wieder.
    """
    from . import imports as _imp        # spät, hält das Modul schlank
    if quelle.suffix.lower() == ".gpx" or not _imp.is_convertible(str(quelle)):
        return quelle, None
    tmpdir = None
    ziel_cache = cache
    if ziel_cache is None:
        tmpdir = tempfile.mkdtemp(prefix="rz-umwandlung-")
        ziel_cache = Path(tmpdir)
    return Path(_imp.ensure_gpx(str(quelle), ziel_cache)), tmpdir


def version_ablegen(ort: Path, quelle: Path, version_id: str,
                    umwandlung_cache: Optional[Path] = None) -> Path:
    """Eine Trackdatei in die Bibliothek übernehmen (komprimiert kopieren).

    Fremdformate (FIT, TCX, KML, NMEA …) werden **vorher nach GPX gewandelt** —
    siehe `_als_gpx`. Eine bereits gepackte Quelle (`.gpx.gz`) wird unverändert
    übernommen, statt ein zweites Mal gepackt zu werden.

    Bereits Vorhandenes wird NICHT überschrieben: Dieselbe Version hat
    denselben Inhalt — noch einmal zu schreiben kostet nur Zeit und bringt
    ein Risiko mit, wenn gerade jemand liest.
    """
    ziel = version_datei(ort, version_id)
    if ziel.is_file() and ziel.stat().st_size > 0:
        return ziel
    quelle = Path(quelle)
    ziel.parent.mkdir(parents=True, exist_ok=True)
    tmp = ziel.with_suffix(f".tmp{os.getpid()}")
    with open(quelle, "rb") as f:
        magie = f.read(2)
    if magie == GZIP_MAGIE:
        # Schon gepackt (unser Speicher, ein Strava-Export) — 1:1 übernehmen.
        shutil.copyfile(quelle, tmp)
        os.replace(tmp, ziel)
        return ziel
    gpx, tmpdir = _als_gpx(quelle, umwandlung_cache)
    try:
        with open(gpx, "rb") as f_in, gzip.open(tmp, "wb", compresslevel=6) as f_out:
            shutil.copyfileobj(f_in, f_out, length=1024 * 256)
        os.replace(tmp, ziel)
    finally:
        if tmpdir:
            shutil.rmtree(tmpdir, ignore_errors=True)
    return ziel


def version_ist_lesbar(ort: Path, version_id: str) -> bool:
    """Enthält diese Version wirklich GPX? (nur die ersten Bytes)"""
    p = version_datei(ort, version_id)
    if not p.is_file():
        return False
    try:
        with gzip.open(p, "rb") as f:
            # 4 KB, nicht 256 B: Manche Erzeuger schreiben lange
            # Namensraum-Listen vor das `<gpx`-Element.
            return _sieht_nach_gpx_aus(f.read(4096))
    except (OSError, EOFError):
        return False


def _aus_sich_selbst_heilen(ort: Path, vid: str, cache=None) -> bool:
    """Eine kaputte Version aus ihrem eigenen Inhalt retten.

    Im Speicher liegen (bis 02.09.2026) Rohaufzeichnungen unter GPX-Namen —
    die Daten fehlen also nicht, sie sind nur nicht umgewandelt. Das lässt
    sich ohne die Quelldatei richtigstellen, und das ist der Regelfall: Wer
    die Bibliothek auf einem zweiten Rechner hat, hat die `.fit` dort nie
    gehabt.
    """
    from . import imports as _imp
    try:
        roh = version_lesen(ort, vid)
    except (OSError, EOFError):
        return False
    endung = _format_raten(roh)
    if not endung:
        return False
    tmpdir = Path(tempfile.mkdtemp(prefix="rz-heilen-"))
    try:
        quelle = tmpdir / f"{vid}{endung}"
        quelle.write_bytes(roh)
        gpx = Path(_imp.ensure_gpx(str(quelle), cache or tmpdir))
        if gpx == quelle:
            return False
        version_weg(ort, vid)
        version_ablegen(ort, gpx, vid, umwandlung_cache=cache)
        return version_ist_lesbar(ort, vid)
    except Exception:           # noqa: BLE001
        return False
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def versionen_reparieren(ort: Path, quelle_fuer, umwandlung_cache=None) -> dict:
    """Kaputte Versionen aus ihrer Quelldatei neu ablegen.

    `quelle_fuer(version_id)` liefert den Pfad der Datei, aus der diese
    Version stammt, oder None. Was sich nicht reparieren lässt, bleibt
    **liegen** — gelöscht wird hier nichts, vielleicht ist die Platte nur
    gerade nicht angesteckt.

    Rückgabe: {"kaputt": [...], "repariert": n, "offen": [...]}.
    """
    kaputt = versionen_pruefen(ort)
    repariert, offen = 0, []
    for vid in kaputt:
        # 1. Versuch: aus dem, was schon da liegt. Bei einer `.fit` sind die
        #    Daten ja vorhanden — sie stehen nur im falschen Format. Das ist
        #    der wichtigere Weg: Die Quelldatei draußen ist oft längst weg
        #    (anderer Rechner, Ordner nicht mehr beobachtet).
        if _aus_sich_selbst_heilen(ort, vid, umwandlung_cache):
            repariert += 1
            continue
        try:
            quelle = quelle_fuer(vid)
        except Exception:       # noqa: BLE001
            quelle = None
        if not quelle or not Path(quelle).is_file():
            offen.append(vid)
            continue
        try:
            version_weg(ort, vid)
            version_ablegen(ort, Path(quelle), vid, umwandlung_cache=umwandlung_cache)
            if not version_ist_lesbar(ort, vid):
                offen.append(vid)
                continue
            repariert += 1
        except Exception:       # noqa: BLE001
            offen.append(vid)
    return {"kaputt": kaputt, "repariert": repariert, "offen": offen}


def versionen_pruefen(ort: Path) -> list[str]:
    """Alle Versionen durchsehen und die zurückgeben, die kein GPX enthalten.

    Läuft einmal je Bibliothek (Stempel in `bibliothek.json`), nicht bei
    jedem Start: Neue kaputte Versionen können seit dem 02.09.2026 nicht mehr
    entstehen, aber die vorher abgelegten liegen noch da.
    """
    kaputt = []
    for datei in sorted(touren_ordner(ort).rglob("*.gpx.gz")):
        vid = datei.name[:-len(".gpx.gz")]
        if not version_ist_lesbar(ort, vid):
            kaputt.append(vid)
    return kaputt


def version_bytes_ablegen(ort: Path, daten: bytes, version_id: str) -> Path:
    """Wie `version_ablegen`, nur aus dem Speicher — für frisch erzeugte
    Versionen (Heilen, Zuschneiden, Zusammenführen)."""
    ziel = version_datei(ort, version_id)
    ziel.parent.mkdir(parents=True, exist_ok=True)
    tmp = ziel.with_suffix(f".tmp{os.getpid()}")
    with gzip.open(tmp, "wb", compresslevel=6) as f_out:
        f_out.write(daten)
    os.replace(tmp, ziel)
    return ziel


def version_lesen(ort: Path, version_id: str) -> bytes:
    """Den Inhalt einer Version holen. Wirft FileNotFoundError, wenn sie fehlt."""
    return gzip.open(version_datei(ort, version_id), "rb").read()


def version_auspacken(ort: Path, version_id: str, ziel: Path) -> Path:
    """Eine Version als gewöhnliche .gpx an einen Ort legen — für alles, was
    einen Dateipfad braucht (Render, Export, fremde Werkzeuge)."""
    ziel = Path(ziel)
    ziel.parent.mkdir(parents=True, exist_ok=True)
    ziel.write_bytes(version_lesen(ort, version_id))
    return ziel


def version_weg(ort: Path, version_id: str) -> bool:
    try:
        version_datei(ort, version_id).unlink()
        return True
    except OSError:
        return False


# ── Name, Liste, ZIP-Sicherung (Marc, 12.09.2026) ───────────────────────────
#
# Anlass (Marc): „bei mir sind test- und arbeitsbibliothek im moment eins und
# das ist blöd." Wechseln konnte die App schon (`ort_schreiben` + `vorher`), es
# fehlten der NAME und die sichtbare Liste. Der Name liegt in der Kenndatei der
# Bibliothek, nicht im Zeiger — so zieht er mit, wenn der Ordner wandert.

# Ordner, die eine ZIP-Sicherung im Sparmodus auslässt: beide entstehen von
# selbst wieder. `bilder` sind Vorschau-/Kartenbilder, `sicherungen` sind die
# rollierenden Kopien von library.db (bei Marc 77 von 150 MB).
ZIP_SPARSAM_AUS = ("bilder", "sicherungen")


def name_lesen(ort: Path) -> str:
    """Der Anzeigename dieser Bibliothek — Rückfall: der Ordnername."""
    ort = Path(ort)
    try:
        n = str(stempel_lesen(ort, "name") or "").strip()
    except Exception:
        n = ""
    return n or ort.name or str(ort)


def name_setzen(ort: Path, name: str) -> str:
    """Namen in die Kenndatei schreiben. Leer = zurück zum Ordnernamen."""
    name = " ".join(str(name or "").split())[:60]
    stempel_setzen(Path(ort), "name", name)
    return name_lesen(ort)


def bekannte_orte(app_support: Path, aktiv: Optional[Path] = None) -> list:
    """Alle Bibliotheken, die diese App kennt — die aktive zuerst.

    Je Eintrag: `pfad`, `name`, `da` (liegt dort heute eine Bibliothek),
    `aktiv`. Für die Liste in den Einstellungen.
    """
    raus: list = []
    gesehen = set()

    def rein(pfad: str, ist_aktiv: bool) -> None:
        pfad = str(pfad or "").strip()
        if not pfad or pfad in gesehen:
            return
        gesehen.add(pfad)
        p = Path(pfad)
        try:
            da = ist_bibliothek(p)
        except Exception:
            da = False
        raus.append({"pfad": pfad, "name": name_lesen(p) if da else p.name,
                     "da": bool(da), "aktiv": bool(ist_aktiv)})

    if aktiv:
        rein(str(aktiv), True)
    for x in vorherige_orte(app_support):
        rein(x.get("pfad", ""), False)
    return raus


def ort_vergessen(app_support: Path, pfad: str) -> bool:
    """Einen Ort aus der Liste nehmen. Löscht NICHTS auf der Platte.

    Bewusst so: „löschen" in der Oberfläche heißt „aus meiner Liste", nie
    „Daten weg". Wer eine Bibliothek wirklich loswerden will, wirft den Ordner
    selbst in den Papierkorb — dann sieht er, was er wegwirft.
    """
    z = zeiger_datei(app_support)
    try:
        d = json.loads(z.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    pfad = str(pfad or "").strip()
    if not pfad or pfad == str(d.get("pfad") or "").strip():
        return False          # die aktive Bibliothek bleibt in der Liste
    vorher = [str(x) for x in (d.get("vorher") or []) if str(x).strip() and str(x) != pfad]
    d["vorher"] = vorher
    tmp = z.with_suffix(f".tmp{os.getpid()}")
    try:
        tmp.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, z)
    except OSError:
        return False
    return True


def zip_name_vorschlag(ort: Path) -> str:
    """Dateiname mit Zeitstempel — Regel: nie eine vorhandene Sicherung
    überschreiben (CLAUDE.md, Marc 28.06.2026)."""
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    roh = re.sub(r"[^\w\-]+", "-", name_lesen(ort), flags=re.UNICODE).strip("-")
    return f"{stamp}-Bibliothek-{roh or 'GPS-Studio'}.zip"


def zip_sichern(ort: Path, ziel: Path, alles: bool = False,
                fortschritt=None) -> dict:
    """Die Bibliothek als ZIP sichern.

    `alles=False` (Vorgabe) lässt `bilder/` und `sicherungen/` weg — beides
    entsteht neu. `alles=True` nimmt den Ordner vollständig, ohne die Sperre.
    `fortschritt(n, gesamt)` wird gelegentlich gerufen, für die Oberfläche.
    """
    import zipfile

    ort = Path(ort)
    ziel = Path(ziel)
    if not ist_bibliothek(ort):
        return {"ok": False, "error": "kein Bibliotheks-Ordner"}

    aus = () if alles else ZIP_SPARSAM_AUS

    def mitnehmen(rel: Path) -> bool:
        teile = rel.parts
        if not teile:
            return False
        if teile[0] == SPERRDATEI or teile[-1] == ".DS_Store":
            return False
        if teile[0].endswith(".zip"):
            return False
        return teile[0] not in aus

    dateien = []
    for f in ort.rglob("*"):
        if not f.is_file():
            continue
        try:
            rel = f.relative_to(ort)
        except ValueError:
            continue
        if mitnehmen(rel):
            dateien.append((f, rel))

    ziel.parent.mkdir(parents=True, exist_ok=True)
    tmp = ziel.with_name(ziel.name + f".teil{os.getpid()}")
    roh = 0
    try:
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
            for i, (f, rel) in enumerate(dateien):
                try:
                    roh += f.stat().st_size
                    z.write(f, str(rel))
                except OSError:
                    continue
                if fortschritt and (i % 50 == 0):
                    try:
                        fortschritt(i, len(dateien))
                    except Exception:
                        pass
        os.replace(tmp, ziel)
    except (OSError, ValueError) as e:
        try:
            tmp.unlink()
        except OSError:
            pass
        return {"ok": False, "error": str(e)}
    return {"ok": True, "pfad": str(ziel), "dateien": len(dateien),
            "bytes": ziel.stat().st_size, "roh_bytes": roh, "alles": bool(alles)}


def platz_bericht(ort: Path) -> dict:
    """Wie viel Platz braucht die Bibliothek? Für die Einstellungen."""
    n = roh = 0
    d = touren_ordner(ort)
    if d.is_dir():
        for f in d.rglob("*.gpx.gz"):
            try:
                roh += f.stat().st_size
                n += 1
            except OSError:
                pass
    return {"versionen": n, "bytes": roh}


# ── Öffnen, anlegen, umziehen ───────────────────────────────────────────────

def kenndatei(ort: Path) -> Path:
    return Path(ort) / KENNDATEI


def ist_bibliothek(ort: Path) -> bool:
    return kenndatei(ort).is_file()


def stempel_lesen(ort: Path, name: str):
    """Ein Merkzeichen aus `bibliothek.json` — für Läufe, die nur EINMAL je
    Bibliothek nötig sind (etwa die GPX-Prüfung der Versionen)."""
    try:
        return json.loads(kenndatei(ort).read_text(encoding="utf-8")).get(name)
    except (OSError, ValueError):
        return None


def stempel_setzen(ort: Path, name: str, wert) -> None:
    try:
        d = json.loads(kenndatei(ort).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        d = {"art": "gps-studio-bibliothek", "schema": SCHEMA_STAND}
    d[name] = wert
    try:
        kenndatei(ort).write_text(json.dumps(d, ensure_ascii=False, indent=2),
                                  encoding="utf-8")
    except OSError:
        pass


def anlegen(ort: Path) -> dict:
    """Eine leere Bibliothek erzeugen. Idempotent."""
    ort = Path(ort)
    grund = cloud_ordner_grund(ort)
    if grund:
        return {"ok": False, "cloud": grund}
    try:
        ort.mkdir(parents=True, exist_ok=True)
        touren_ordner(ort).mkdir(parents=True, exist_ok=True)
        (ort / "bilder").mkdir(parents=True, exist_ok=True)
        (ort / "projekt_staende").mkdir(parents=True, exist_ok=True)
        sicherungen_ordner(ort).mkdir(parents=True, exist_ok=True)
        if not ist_bibliothek(ort):
            kenndatei(ort).write_text(json.dumps(
                {"art": "gps-studio-bibliothek", "schema": SCHEMA_STAND,
                 "angelegt": datetime.now().astimezone().isoformat(timespec="seconds")},
                ensure_ascii=False, indent=2), encoding="utf-8")
        return {"ok": True, "pfad": str(ort)}
    except OSError as e:
        return {"ok": False, "error": str(e)}


def pruefen(ort: Path) -> dict:
    """Ist dieser Ort als Bibliothek brauchbar? Ohne etwas anzulegen.

    Für den Ordner-Auswahldialog im Onboarding und in den Einstellungen.
    """
    ort = Path(ort)
    grund = cloud_ordner_grund(ort)
    if grund:
        return {"ok": False, "cloud": grund}
    if ort.exists() and not ort.is_dir():
        return {"ok": False, "grund": "kein_ordner"}
    if ist_bibliothek(ort):
        return {"ok": True, "vorhanden": True}
    # Ein fremder, voller Ordner ist ein schlechter Ort — wir legen dort
    # Unterordner an und würden fremde Daten mit unseren mischen.
    try:
        if ort.is_dir() and any(ort.iterdir()):
            return {"ok": True, "vorhanden": False, "nicht_leer": True}
    except OSError as e:
        return {"ok": False, "error": str(e)}
    if not ort.exists():
        eltern = ort.parent
        if not eltern.is_dir():
            return {"ok": False, "grund": "eltern_fehlt"}
        if not os.access(eltern, os.W_OK):
            return {"ok": False, "grund": "kein_schreibrecht"}
        return {"ok": True, "vorhanden": False, "neu": True}
    if not os.access(ort, os.W_OK):
        return {"ok": False, "grund": "kein_schreibrecht"}
    return {"ok": True, "vorhanden": False}


def umziehen(alt: Path, neu: Path, melden=None) -> dict:
    """Die Bibliothek an einen anderen Ort verschieben — echt verschieben,
    nicht neu anfangen. Der alte Ort bleibt stehen, bis der neue vollständig
    ist; erst dann wird er entfernt."""
    alt, neu = Path(alt), Path(neu)
    if alt == neu:
        return {"ok": True, "pfad": str(neu)}
    grund = cloud_ordner_grund(neu)
    if grund:
        return {"ok": False, "cloud": grund}
    if neu.exists() and any(neu.iterdir() if neu.is_dir() else [1]):
        return {"ok": False, "grund": "ziel_nicht_leer"}
    try:
        if melden:
            melden("kopiere")
        shutil.copytree(alt, neu, dirs_exist_ok=True,
                        ignore=shutil.ignore_patterns(SPERRDATEI, "*.tmp*"))
        if not ist_bibliothek(neu) or not db_heil(db_pfad(neu)):
            shutil.rmtree(neu, ignore_errors=True)
            return {"ok": False, "grund": "kopie_unvollstaendig"}
        if melden:
            melden("raeume auf")
        shutil.rmtree(alt, ignore_errors=True)
        return {"ok": True, "pfad": str(neu)}
    except OSError as e:
        return {"ok": False, "error": str(e)}
