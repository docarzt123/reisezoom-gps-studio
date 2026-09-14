"""Dateischutz — der EINE Weg, auf dem GPS Studio Dateien löscht, verschiebt oder ersetzt.

14.09.2026 (Marc, nach einer Nutzer-Meldung: Bibliotheks-Umzug hat die Videos einer
externen SSD mitgenommen): „Bau einen Wächter, dass bei allen Datei-Manipulationen,
egal was, 1. immer ein Backup gibt und 2. doppelt geprüft wird, dass nur das angefasst
wird, was GPS Studio braucht."

Regeln
======
1. **Doppelte Prüfung** vor jedem Löschen/Verschieben/Ersetzen (`pruefen`):
   a) *Bereich*: Der aufgelöste Pfad liegt in einem von GPS Studio angemeldeten Bereich
      (App-Ordner, Bibliothek, eigene Temp-Ordner) oder ist ein vom Nutzer für GENAU
      diesen Vorgang gewähltes Ziel (`nutzer_ziel`). In der Bibliothek zählen nur die
      eigenen Einträge (core.bibliothek.ist_eigener_eintrag) — fremde Dateien, die dort
      liegen, gehören nicht uns.
   b) *Sperrliste* (unabhängig davon): nie ein Laufwerks-/Volume-Wurzelordner, nie das
      Home-Verzeichnis oder dessen Standardordner selbst, nie ein Bereichs-Wurzelordner
      als Ganzes, kein Pfad, der erst über einen Symlink in einen Bereich hineinführt.
   Nur wenn BEIDE Prüfungen bestehen, passiert etwas. Sonst: DateischutzFehler + Log.
2. **Sicherung**: Was gelöscht oder überschrieben wird, wandert vorher in den Papierkorb
   von GPS Studio (`<App-Ordner>/_papierkorb/<Zeit>-<Aktion>/…`), 14 Tage bzw. bis zu
   einer Größengrenze aufbewahrt. Ausgenommen sind nur zwei ausdrücklich benannte Arten,
   die nie Nutzerdaten enthalten: ART_TEMP (eigene Zwischendateien desselben Vorgangs)
   und ART_CACHE (jederzeit neu erzeugbare Zwischenspeicher, z. B. Kartenkacheln).
   Häufig gespeicherte eigene Dateien (projekte.json …) werden gedrosselt gesichert:
   höchstens eine Sicherung je Datei alle SICHERUNG_ABSTAND_S Sekunden.
3. Alles wird ins Log geschrieben — auch Verweigerungen.

Der Wächter tests/test_dateischutz_waechter.py sucht im ganzen Python-Code nach
direkten Lösch-/Verschiebe-/Ersetz-Aufrufen außerhalb dieses Moduls und nach
exiftool `-overwrite_original` ohne Schutzprüfung und schlägt dann fehl.
"""
from __future__ import annotations

import logging
import os
import shutil
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Optional

log = logging.getLogger("dateischutz")

ART_NUTZERDATEN = "nutzerdaten"   # alles, was der Nutzer verlieren könnte → immer sichern
ART_TEMP = "temp"                 # eigene Zwischendatei desselben Vorgangs → nicht sichern
ART_CACHE = "cache"               # neu erzeugbar (Kacheln, Vorschaubilder) → nicht sichern

PAPIERKORB_NAME = "_papierkorb"
PAPIERKORB_TAGE = 14
PAPIERKORB_MAX_BYTES = 20 * 2**30
SICHERUNG_ABSTAND_S = 15 * 60

_LOCK = threading.RLock()
_bereiche: dict[str, dict] = {}        # name → {"pfad": Path, "nur_eigene": bool}
_nutzer_ziele: dict[str, float] = {}   # aufgelöster Pfad → Ablaufzeit
_temp_ordner: set[str] = set()
_app_ordner: Optional[Path] = None
_letzte_sicherung: dict[str, float] = {}


class DateischutzFehler(PermissionError):
    """Ein Datei-Eingriff wurde verweigert, weil er außerhalb dessen lag, was GPS Studio gehört."""


# ── Anmelden ────────────────────────────────────────────────────────────────

def _norm(p) -> Path:
    return Path(os.path.abspath(os.path.expanduser(str(p))))


def _aufgeloest(p) -> Path:
    try:
        return Path(os.path.realpath(os.path.expanduser(str(p))))
    except OSError:
        return _norm(p)


def _ziel(p) -> Path:
    """Der Pfad, auf den ein Eingriff wirklich wirkt: Elternordner aufgelöst (Symlinks auf dem Weg
    zählen — führt einer hinaus, liegt das Ziel außerhalb), der letzte Teil NICHT aufgelöst (ein
    Symlink selbst wird gelöscht/verschoben, nie sein Ziel)."""
    n = _norm(p)
    if n.parent == n:
        return n
    return _aufgeloest(n.parent) / n.name


def app_ordner_setzen(pfad) -> None:
    """Der App-Ordner (settings, Caches, Renders, Papierkorb). Ist zugleich ein Bereich."""
    global _app_ordner
    with _LOCK:
        _app_ordner = _norm(pfad)
        _bereiche["app"] = {"pfad": _app_ordner, "nur_eigene": False}


def bereich_anmelden(name: str, pfad, nur_eigene: bool = False) -> None:
    """Einen Ordner als GPS-Studio-Bereich anmelden. `nur_eigene`: nur Einträge, die
    core.bibliothek.ist_eigener_eintrag als eigene erkennt (die Bibliothek)."""
    with _LOCK:
        _bereiche[name] = {"pfad": _norm(pfad), "nur_eigene": bool(nur_eigene)}


def bereich_abmelden(name: str) -> None:
    with _LOCK:
        _bereiche.pop(name, None)


def temp_ordner(prefix: str = "rz-") -> Path:
    """Einen eigenen Temp-Ordner anlegen und als Bereich merken."""
    d = Path(tempfile.mkdtemp(prefix=prefix))
    with _LOCK:
        _temp_ordner.add(str(_aufgeloest(d)))
    return _aufgeloest(d)


def temp_ordner_merken(pfad) -> None:
    with _LOCK:
        _temp_ordner.add(str(_aufgeloest(pfad)))


def nutzer_ziel(pfad, gueltig_s: float = 600.0) -> Path:
    """Ein Pfad, den der Nutzer für GENAU diesen Vorgang gewählt hat (Speichern-Dialog,
    Export-Ziel, bewusst ausgewähltes Foto). Erlaubt Anlegen und Ersetzen — ein
    vorhandener Stand wird vorher gesichert."""
    p = _ziel(pfad)
    with _LOCK:
        _nutzer_ziele[str(p)] = time.time() + gueltig_s
    return p


# ── Die doppelte Prüfung ────────────────────────────────────────────────────

def _sperrliste_grund(p: Path, roh: Path) -> str:
    """Prüfung b — unabhängig von den Bereichen."""
    teile = p.parts
    # Laufwerks-/Volume-Wurzel: "/", "C:\\", "/Volumes/X", "/mnt/x", "/media/u/x"
    if len(teile) <= 1:
        return "wurzelordner"
    if teile[:2] == ("/", "Volumes") and len(teile) <= 3:
        return "volume"
    if len(teile) >= 2 and teile[1] in ("mnt", "media", "run") and len(teile) <= 4:
        return "volume"
    heim = _aufgeloest(Path.home())
    if p == heim or p in (heim / n for n in ("Desktop", "Documents", "Downloads", "Pictures", "Movies",
                                             "Music", "Videos", "Library", "AppData", "OneDrive")):
        return "home_standardordner"
    for b in list(_bereiche.values()):
        if p == _aufgeloest(b["pfad"]):
            return "bereichswurzel"
    return ""


def _liegt_in(p: Path, wurzel: Path) -> bool:
    try:
        return p.is_relative_to(wurzel)
    except (ValueError, AttributeError):
        return str(p).startswith(str(wurzel) + os.sep)


def _bereich_von(p: Path) -> Optional[tuple]:
    """Prüfung a — (name, eintrag) oder None."""
    jetzt = time.time()
    with _LOCK:
        for k in [k for k, bis in _nutzer_ziele.items() if bis < jetzt]:
            _nutzer_ziele.pop(k, None)
        if str(p) in _nutzer_ziele:
            return ("nutzer_ziel", {"pfad": p, "nur_eigene": False})
        for t in _temp_ordner:
            if _liegt_in(p, Path(t)):          # auch der eigene Temp-Ordner selbst darf weg
                return ("temp", {"pfad": Path(t), "nur_eigene": False})
        # der längste passende Bereich gewinnt (Bibliothek im App-Ordner)
        treffer = [(n, b) for n, b in _bereiche.items() if _liegt_in(p, _aufgeloest(b["pfad"]))]
    if not treffer:
        return None
    n, b = max(treffer, key=lambda nb: len(str(nb[1]["pfad"])))
    if b["nur_eigene"]:
        from . import bibliothek as _bib
        rel = p.relative_to(_aufgeloest(b["pfad"]))
        if not rel.parts or not _bib.ist_eigener_eintrag(rel.parts[0]):
            return None
    return (n, b)


def pruefen(pfad, aktion: str) -> Path:
    """Beide Prüfungen. Liefert den aufgelösten Pfad oder wirft DateischutzFehler."""
    roh, p = _norm(pfad), _ziel(pfad)
    bereich = _bereich_von(p)
    grund = "ausserhalb" if bereich is None else _sperrliste_grund(p, roh)
    if grund:
        warum = grund
        log.error("[dateischutz] VERWEIGERT %s: %s (%s)", aktion, p, warum)
        raise DateischutzFehler(f"Dateischutz: {aktion} verweigert für {p} ({warum})")
    return p


def erlaubt(pfad, aktion: str = "pruefen") -> bool:
    try:
        pruefen(pfad, aktion)
        return True
    except DateischutzFehler:
        return False


# ── Sicherung ────────────────────────────────────────────────────────────────

def papierkorb_ordner() -> Path:
    basis = _app_ordner or Path(tempfile.gettempdir()) / "Reisezoom GPS Studio"
    return basis / PAPIERKORB_NAME


def _sichern(p: Path, aktion: str, verschieben: bool) -> Optional[Path]:
    """Die Datei/den Ordner in den Papierkorb legen (verschieben) oder kopieren."""
    if not os.path.lexists(p):
        return None
    ziel_basis = papierkorb_ordner() / f"{time.strftime('%Y%m%d-%H%M%S')}-{aktion}-{uuid.uuid4().hex[:6]}"
    ziel_basis.mkdir(parents=True, exist_ok=True)
    ziel = ziel_basis / p.name
    if verschieben:
        shutil.move(str(p), str(ziel))
    elif p.is_dir():
        shutil.copytree(p, ziel, symlinks=True)
    else:
        shutil.copy2(p, ziel)
    (ziel_basis / "HERKUNFT.txt").write_text(str(p), encoding="utf-8")
    log.info("[dateischutz] gesichert (%s): %s → %s", aktion, p, ziel)
    return ziel


SICHERUNGEN_JE_DATEI = 10
_letzter_inhalt: dict[str, tuple] = {}


def _fingerabdruck(p: Path) -> tuple:
    import hashlib
    h = hashlib.sha1()
    with open(p, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return (p.stat().st_size, h.hexdigest())


def _sichern_gedrosselt(p: Path, aktion: str) -> None:
    """Häufig gespeicherte Dateien: höchstens alle SICHERUNG_ABSTAND_S, gleicher Inhalt nie
    doppelt, und je Datei bleiben nur die letzten SICHERUNGEN_JE_DATEI Stände (14.09.2026)."""
    jetzt = time.time()
    with _LOCK:
        if jetzt - _letzte_sicherung.get(str(p), 0) < SICHERUNG_ABSTAND_S:
            return
        _letzte_sicherung[str(p)] = jetzt
    try:
        fp = _fingerabdruck(p) if p.is_file() else None
    except OSError:
        fp = None
    if fp is not None and _letzter_inhalt.get(str(p)) == fp:
        return
    _sichern(p, aktion, verschieben=False)
    if fp is not None:
        _letzter_inhalt[str(p)] = fp
    try:   # ältere Stände derselben Datei (gleiche HERKUNFT) über die Grenze hinaus entfernen
        pk = papierkorb_ordner()
        eigene = []
        for d in pk.iterdir():
            h = d / "HERKUNFT.txt"
            if d.is_dir() and h.is_file() and h.read_text(encoding="utf-8") == str(p):
                eigene.append(d)
        for d in sorted(eigene, key=lambda d: d.name)[:-SICHERUNGEN_JE_DATEI]:
            if _liegt_in(_aufgeloest(d), _aufgeloest(pk)) and _aufgeloest(d) != _aufgeloest(pk):
                shutil.rmtree(d, ignore_errors=True)
    except OSError:
        pass


# ── Die Eingriffe ────────────────────────────────────────────────────────────

def loeschen(pfad, aktion: str, art: str = ART_NUTZERDATEN, fehlt_ok: bool = True) -> bool:
    """Eine Datei (oder einen Symlink) löschen. Nutzerdaten gehen in den Papierkorb."""
    p = pruefen(pfad, aktion)
    if not os.path.lexists(p):
        if fehlt_ok:
            return False
        raise FileNotFoundError(str(p))
    if p.is_dir() and not p.is_symlink():
        raise IsADirectoryError(f"{p} ist ein Ordner — ordner_loeschen benutzen")
    if art == ART_NUTZERDATEN:
        _sichern(p, aktion, verschieben=True)
    else:
        os.unlink(p)
        log.debug("[dateischutz] gelöscht (%s, %s): %s", aktion, art, p)
    return True


def ordner_loeschen(pfad, aktion: str, art: str = ART_NUTZERDATEN, ignore_errors: bool = False) -> bool:
    """Einen Ordner samt Inhalt entfernen — nur, wenn er uns gehört."""
    p = pruefen(pfad, aktion)
    if p.is_symlink():
        return loeschen(p, aktion, art=art)
    if not p.exists():
        with _LOCK:
            _temp_ordner.discard(str(p))
        return False
    try:
        if art == ART_NUTZERDATEN:
            _sichern(p, aktion, verschieben=True)
        else:
            shutil.rmtree(p)
            log.info("[dateischutz] Ordner entfernt (%s, %s): %s", aktion, art, p)
        with _LOCK:
            _temp_ordner.discard(str(p))
        return True
    except OSError:
        if ignore_errors:
            log.warning("[dateischutz] Ordner %s ließ sich nicht ganz entfernen", p)
            return False
        raise


def ersetzen(quelle, ziel, aktion: str, art: str = ART_NUTZERDATEN) -> None:
    """`quelle` (meist eine eigene tmp-Datei) atomar an die Stelle von `ziel` setzen.
    Ein vorhandener Stand von `ziel` wird bei Nutzerdaten gedrosselt gesichert."""
    q = pruefen(quelle, aktion + ":quelle")
    z = pruefen(ziel, aktion)
    if art == ART_NUTZERDATEN and z.exists():
        _sichern_gedrosselt(z, aktion)
    os.replace(q, z)


def verschieben(quelle, ziel, aktion: str, art: str = ART_NUTZERDATEN) -> Path:
    """Datei/Ordner verschieben. Beide Enden müssen uns gehören; ein vorhandenes Ziel
    wird vorher gesichert (Nutzerdaten) — nie still überschrieben."""
    q = pruefen(quelle, aktion + ":quelle")
    z = pruefen(ziel, aktion)
    if os.path.lexists(z):
        if art == ART_NUTZERDATEN:
            _sichern(z, aktion + ":ziel", verschieben=True)
        elif z.is_dir():
            shutil.rmtree(z)
        else:
            os.unlink(z)
    shutil.move(str(q), str(z))
    return z


def umbenennen(quelle, ziel, aktion: str) -> Path:
    """Wie verschieben, aber ein vorhandenes Ziel ist ein Fehler."""
    q = pruefen(quelle, aktion + ":quelle")
    z = pruefen(ziel, aktion)
    if os.path.lexists(z):
        raise FileExistsError(str(z))
    os.rename(q, z)
    return z


def foto_schreiben_pruefen(pfad, gesichert: bool) -> Path:
    """Vor einem exiftool-Schreiben IN eine Nutzerdatei (`-overwrite_original`):
    Die Datei muss ausdrücklich gewählt sein (nutzer_ziel oder eigener Bereich) UND es
    muss eine Sicherung geben (Geotagger-ZIP oder getaggte Kopie in eigenem Ordner)."""
    p = pruefen(pfad, "foto_schreiben")
    if not gesichert:
        log.error("[dateischutz] VERWEIGERT foto_schreiben ohne Sicherung: %s", p)
        raise DateischutzFehler(f"Dateischutz: {p} wird ohne Sicherung nicht verändert")
    return p


def papierkorb_aufraeumen(tage: int = PAPIERKORB_TAGE, max_bytes: int = PAPIERKORB_MAX_BYTES) -> dict:
    """Alte Sicherungen entfernen — nur innerhalb des eigenen Papierkorbs."""
    pk = papierkorb_ordner()
    if not pk.is_dir():
        return {"weg": 0}
    eintraege = sorted((e for e in pk.iterdir() if e.is_dir()), key=lambda e: e.name)
    groesse = {}
    for e in eintraege:
        try:
            groesse[e] = sum(f.stat().st_size for f in e.rglob("*") if f.is_file())
        except OSError:
            groesse[e] = 0
    grenze = time.time() - tage * 86400
    gesamt = sum(groesse.values())
    weg = 0
    for e in eintraege:
        try:
            alt = e.stat().st_mtime < grenze
        except OSError:
            alt = False
        if alt or gesamt > max_bytes:
            if _liegt_in(_aufgeloest(e), _aufgeloest(pk)) and _aufgeloest(e) != _aufgeloest(pk):
                shutil.rmtree(e, ignore_errors=True)
                gesamt -= groesse.get(e, 0)
                weg += 1
    if weg:
        log.info("[dateischutz] Papierkorb: %d alte Sicherungen entfernt", weg)
    return {"weg": weg}
