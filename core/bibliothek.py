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
import shutil
import sqlite3
import tempfile
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

SCHEMA_STAND = 1
KENNDATEI = "bibliothek.json"
SPERRDATEI = ".sperre"
# Wie lange eine Sperre gilt, deren Prozess nicht mehr lebt oder von einem
# anderen Rechner stammt. Kurz genug, dass ein Absturz nicht aussperrt.
SPERRE_VERFALL_S = 12 * 3600

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


def ort_schreiben(app_support: Path, ort: Path) -> None:
    z = zeiger_datei(app_support)
    z.parent.mkdir(parents=True, exist_ok=True)
    tmp = z.with_suffix(f".tmp{os.getpid()}")
    tmp.write_text(json.dumps({"pfad": str(ort),
                               "gewaehlt_am": datetime.now().astimezone().isoformat(timespec="seconds")},
                              ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, z)


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
    if alter > SPERRE_VERFALL_S:
        return False
    if str(d.get("rechner") or "") != _rechnername():
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
                 and str(alt.get("rechner") or "") == _rechnername())
        if not eigen and _sperre_lebt(alt):
            return {"ok": False, "belegt_von": alt}
    except Exception:
        pass                             # keine, kaputte oder verfallene Sperre
    s.write_text(json.dumps({"pid": os.getpid(), "rechner": _rechnername(),
                             "zeit": time.time(),
                             "seit": datetime.now().astimezone().isoformat(timespec="seconds")},
                            ensure_ascii=False), encoding="utf-8")
    return {"ok": True}


def sperre_freigeben(ort: Path) -> None:
    """Nur die EIGENE Sperre lösen — sonst gäbe ein Absturz sie doppelt frei."""
    s = Path(ort) / SPERRDATEI
    try:
        d = json.loads(s.read_text(encoding="utf-8"))
        if int(d.get("pid") or 0) == os.getpid() and str(d.get("rechner") or "") == _rechnername():
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
