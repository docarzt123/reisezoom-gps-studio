"""
Foto-Backup vor EXIF-Schreibvorgängen. ZIP-Snapshot in projekt-eigenem Ordner.
"""
from __future__ import annotations

import zipfile
from datetime import datetime
from pathlib import Path
from typing import Callable, Iterable, Optional


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
        # Halbfertiges ZIP wegräumen
        try:
            zip_path.unlink()
        except OSError:
            pass
        raise

    # Retention: max 20 ZIPs pro Backup-Dir
    zips = sorted(bdir.glob("*.zip"), key=lambda p: p.stat().st_mtime, reverse=True)
    for old in zips[20:]:
        try:
            old.unlink()
        except OSError:
            pass

    return str(zip_path)
