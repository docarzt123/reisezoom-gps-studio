"""
Foto-Backup vor EXIF-Schreibvorgängen. ZIP-Snapshot in projekt-eigenem Ordner.
"""
from __future__ import annotations

import json
import logging
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Callable, Iterable, Optional

from . import dateischutz as _ds  # 14.09.2026: Löschen nur über das Tor

log = logging.getLogger(__name__)

# 15.09.2026 (Marc) — Neben jedem ZIP liegt die Liste der gesicherten Originale (absolute Pfade).
# Damit erkennt GPS Studio doppelte Sicherungen derselben Fotos; ältere ZIPs ohne Liste werden
# über ihre Dateinamen verglichen.
QUELLEN_SUFFIX = ".quellen.json"
WARN_AB = 20   # ab so vielen Sicherungen warnt die App beim Start (nichts wird automatisch gelöscht)


class BackupCancelled(Exception):
    """Wird geworfen, wenn der Backup-Vorgang per should_cancel abgebrochen wird."""


# Lese-/Schreib-Blockgröße. Klein genug, dass ein Cancel mitten in einer
# großen Datei (z.B. mehrere GB OM-.mov) schnell greift, groß genug für
# ordentlichen Durchsatz.
_CHUNK = 8 * 1024 * 1024  # 8 MB


def make_photo_backup(
    photo_paths: Iterable[str],
    backup_dir: str,
    label: str = "geotag",
    should_cancel: Optional[Callable[[], bool]] = None,
    on_progress: Optional[Callable[[int, int, str], None]] = None,
) -> str:
    """
    Erstellt ein ZIP mit Originalkopien aller Fotos/Videos.
    Gibt den Pfad zum ZIP zurück.

    v0.9.148:
    - **ZIP_STORED statt ZIP_DEFLATED**: Fotos (JPEG/RAW) und Videos (.mov/.mp4)
      sind bereits komprimiert — DEFLATE kostet bei mehreren GB Video viel Zeit
      und spart praktisch nichts. STORED kopiert nur die Bytes.
    - **Chunk-weises Schreiben + should_cancel**: Der Cancel-Check greift jetzt
      auch MITTEN in einer großen Datei (alle 8 MB), nicht erst nach der Datei.
      Bei Abbruch wird das halbfertige ZIP gelöscht und BackupCancelled geworfen.
    - **on_progress(i, total, name)**: erlaubt dem UI, den Backup-Fortschritt
      anzuzeigen (vorher sah man nur „Backup wird erstellt …" ohne Bewegung).
    """
    bdir = Path(backup_dir)
    bdir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    zip_path = bdir / f"{label}_{stamp}.zip"

    paths = [Path(p) for p in photo_paths]
    total = len(paths)

    # Schon vergebene Namen im Archiv. Zwei Fotos dürfen gleich heißen: Bei
    # Canon und Nikon springt der Zähler nach 9999 zurück, und wer zwei
    # Kartenordner zusammen verarbeitet, hat garantiert zweimal `DSC_0142.JPG`.
    # Vorher bekam das ZIP zwei Einträge desselben Namens, beim Entpacken blieb
    # einer übrig — und das hier ist der Stand VOR dem EXIF-Schreiben. Das
    # verlorene Original wäre unwiederbringlich gewesen.
    _vergeben: dict = {}

    def _eindeutig(name: str) -> str:
        if name not in _vergeben:
            _vergeben[name] = 1
            return name
        _vergeben[name] += 1
        stamm, punkt, endung = name.rpartition(".")
        n = _vergeben[name]
        return f"{stamm}_{n}{punkt}{endung}" if punkt else f"{name}_{n}"

    try:
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_STORED) as zf:
            for i, pth in enumerate(paths):
                if should_cancel is not None and should_cancel():
                    raise BackupCancelled()
                if not pth.exists():
                    continue
                if on_progress is not None:
                    try:
                        on_progress(i, total, pth.name)
                    except Exception:
                        pass
                # arcname: nur Dateiname (keine Ordnerstruktur), aber eindeutig
                with zf.open(_eindeutig(pth.name), "w") as dst, open(pth, "rb") as src:
                    while True:
                        if should_cancel is not None and should_cancel():
                            raise BackupCancelled()
                        chunk = src.read(_CHUNK)
                        if not chunk:
                            break
                        dst.write(chunk)
    except BackupCancelled:
        # Halbfertiges ZIP wegräumen — eigene Zwischendatei desselben Vorgangs.
        # backup_dir liegt in der App (BACKUPS_DIR = APP_SUPPORT/_backups_photos).
        try:
            _ds.loeschen(zip_path, "fotobackup_abbruch", art=_ds.ART_TEMP)
        except OSError:
            pass
        raise

    try:
        Path(str(zip_path) + QUELLEN_SUFFIX).write_text(
            json.dumps({"quellen": [str(p.resolve()) for p in paths if p.exists()]}, ensure_ascii=False),
            encoding="utf-8")
    except OSError:
        log.exception("Fotosicherung: Quellenliste nicht geschrieben")
    try:
        doppelte_aufraeumen(bdir)
    except Exception:
        log.exception("Fotosicherung: doppelte aufräumen")

    # 15.09.2026 (Marc): Die alte Grenze „max. 20 ZIPs, älteste weg" ist raus — sie löschte still
    # genau die unberührten Originale. Stattdessen warnt die App beim Start ab WARN_AB Sicherungen.
    return str(zip_path)


# ── 15.09.2026 (Marc): Sicherungen verwalten ────────────────────────────────────────────────

def _eintrag(zp: Path) -> Optional[dict]:
    try:
        st = zp.stat()
    except OSError:
        return None
    quellen: list = []
    art = "namen"
    side = Path(str(zp) + QUELLEN_SUFFIX)
    try:
        if side.exists():
            quellen = list(json.loads(side.read_text(encoding="utf-8")).get("quellen") or [])
            art = "pfade"
    except (OSError, ValueError):
        quellen = []
    if art == "namen":
        try:
            with zipfile.ZipFile(zp) as zf:
                quellen = zf.namelist()
        except (OSError, zipfile.BadZipFile):
            quellen = []
    return {
        "name": zp.name, "pfad": str(zp), "zeit": st.st_mtime, "bytes": st.st_size,
        "anzahl": len(quellen), "quellen": quellen,
        "schluessel": (art, tuple(sorted(quellen))),
    }


def sicherungen_liste(backup_dir) -> list:
    """Alle Foto-Sicherungen eines Ordners, älteste zuerst."""
    bdir = Path(backup_dir)
    if not bdir.is_dir():
        return []
    # rglob: auch die Einzel-Sicherungen aus dem EXIF-Editor (Unterordner exif_einzeln)
    out = [e for e in (_eintrag(z) for z in bdir.rglob("*.zip")) if e and e["anzahl"]]
    out.sort(key=lambda e: e["zeit"])
    return out


def _entfernen(e: dict, aktion: str) -> bool:
    zp = Path(e["pfad"])
    ok = _ds.loeschen(zp, aktion)   # Nutzerdaten → Papierkorb von GPS Studio (verschoben, nicht kopiert)
    try:
        _ds.loeschen(Path(str(zp) + QUELLEN_SUFFIX), aktion, art=_ds.ART_CACHE)
    except OSError:
        pass
    return ok


def doppelte_aufraeumen(backup_dir) -> list:
    """Mehrere Sicherungen derselben Fotos: die ÄLTESTE bleibt (unberührte Originale, vor dem
    ersten Schreiben), die NEUESTE bleibt (letzter Stand), alles dazwischen geht in den
    Papierkorb von GPS Studio. Gibt die Namen der entfernten ZIPs zurück."""
    gruppen: dict = {}
    for e in sicherungen_liste(backup_dir):
        gruppen.setdefault(e["schluessel"], []).append(e)
    weg = []
    for liste in gruppen.values():
        for e in liste[1:-1]:
            try:
                if _entfernen(e, "fotobackup_doppelt"):
                    weg.append(e["name"])
            except OSError:
                log.exception("Fotosicherung: doppelte nicht entfernt: %s", e["name"])
    if weg:
        log.info("Fotosicherung: %d doppelte Sicherung(en) entfernt: %s", len(weg), ", ".join(weg))
    return weg


def fremde_sicherungen(backup_dir, aktuelle_pfade: Iterable[str]) -> list:
    """Sicherungen früherer Touren: keine der aktuellen Fotos ist darin enthalten."""
    akt_pfade = set()
    akt_namen = set()
    for p in aktuelle_pfade or []:
        try:
            akt_pfade.add(str(Path(p).resolve()))
        except OSError:
            akt_pfade.add(str(p))
        akt_namen.add(Path(p).name)
    out = []
    for e in sicherungen_liste(backup_dir):
        art = e["schluessel"][0]
        treffer = (set(e["quellen"]) & akt_pfade) if art == "pfade" else (set(e["quellen"]) & akt_namen)
        if not treffer:
            out.append({k: e[k] for k in ("name", "zeit", "bytes", "anzahl")})
    return out


def sicherungen_loeschen(backup_dir, namen: Iterable[str]) -> dict:
    """Ausgewählte Sicherungen (nur Dateinamen aus diesem Ordner) in den Papierkorb von GPS Studio."""
    bdir = Path(backup_dir)
    erlaubt = {e["name"]: e for e in sicherungen_liste(bdir)}   # Namen tragen Art + Sekunde, eindeutig
    geloescht, frei = [], 0
    for n in namen or []:
        e = erlaubt.get(Path(str(n)).name)
        if not e:
            continue
        if _entfernen(e, "fotobackup_nutzer_loescht"):
            geloescht.append(e["name"]); frei += e["bytes"]
    log.info("Fotosicherung: %d Sicherung(en) auf Wunsch entfernt (%.1f GB)", len(geloescht), frei / 1e9)
    return {"ok": True, "geloescht": geloescht, "frei_bytes": frei}


def uebersicht(backup_dir) -> dict:
    """Für die Warnung beim Start: Anzahl, Größe und Liste (älteste zuerst)."""
    liste = [{k: e[k] for k in ("name", "zeit", "bytes", "anzahl")} for e in sicherungen_liste(backup_dir)]
    return {"anzahl": len(liste), "bytes": sum(e["bytes"] for e in liste), "warn_ab": WARN_AB,
            "warnen": len(liste) > WARN_AB, "sicherungen": liste}
