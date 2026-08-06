"""
Aufräumen der Drag-&-Drop-Ablage (v0.9.502).

Warum es das braucht
--------------------
Beim Ziehen einer Datei ins Fenster kann die Oberfläche nicht auf den echten
Pfad zugreifen — sie liest den Inhalt und schickt ihn als base64 an das Backend,
das ihn unter `_drops/<id>/` ablegt. Diese Kopie blieb bis v0.9.501 **für immer**
liegen: es gab keine Stelle im Code, die sie je wieder entfernt hätte.

Auf dem Rechner des Entwicklers waren das nach knapp drei Monaten **110 Ordner
mit 392 GB** — bei einer zu 94 % vollen Platte. Das ist nicht nur Verschwendung,
es hat Folgen: Ist die Platte voll, lagert macOS iCloud-Dateien aus, und dann
verschwinden Touren scheinbar aus dem Archiv.

Was gelöscht wird — und was nicht
---------------------------------
Gelöscht wird ein Ordner nur, wenn **beides** zutrifft:

  1. **Keine Sitzung verweist auf ihn.** Ein Projekt kann eine gezogene Datei
     dauerhaft benutzen; dann ist die Kopie unter `_drops/` die einzige, die es
     noch gibt. Die Verweise werden direkt aus `sessions.json` gelesen, nicht
     geraten — der Ordnername ist NICHT die Sitzungs-ID (10 vs. 16 Zeichen),
     ein Namensvergleich hätte alles gelöscht.
  2. **Er ist älter als `KARENZ_TAGE`.** Zwischen dem Anlegen des Ordners und
     dem Speichern der Sitzung liegen Sekunden. Ohne diese Frist könnte ein
     Aufräumen genau dazwischen die Dateien einer Sitzung wegräumen, die es
     gleich geben wird.

Endgültig gelöscht, nicht in den Papierkorb: es sind Arbeitskopien von Dateien,
die der Nutzer anderswo hat — und 300 GB in den Papierkorb zu schieben gäbe den
Platz gerade NICHT frei, was der ganze Zweck ist.
"""
from __future__ import annotations

import logging
import os
import re
import shutil
import time
from pathlib import Path

log = logging.getLogger("rzgps.drops")

# Wie lange ein unreferenzierter Ordner mindestens liegen bleibt.
KARENZ_TAGE = 2

# Findet `_drops/<id>/` in beliebig verschachteltem JSON — egal, unter welchem
# Schlüssel der Pfad steht. Bewusst über den Rohtext statt über die Struktur:
# ein neues Feld mit einem Drop-Pfad würde sonst still übersehen und die Datei
# dahinter gelöscht.
_VERWEIS = re.compile(r"_drops[/\\]{1,2}([0-9A-Za-z_-]{4,64})[/\\]")


def _referenzierte_ids(sessions_datei: Path) -> set:
    """Alle Drop-Ordner, auf die irgendeine Sitzung verweist."""
    try:
        roh = Path(sessions_datei).read_text(encoding="utf-8", errors="replace")
    except OSError:
        # Keine Sitzungsdatei lesbar → im Zweifel NICHTS löschen. Lieber
        # Speicher verschwenden als die Dateien eines Projekts wegräumen.
        log.warning("drops: sessions.json nicht lesbar — Aufräumen übersprungen")
        return None          # type: ignore[return-value]
    return set(_VERWEIS.findall(roh))


def _groesse(p: Path) -> int:
    n = 0
    for wurzel, _, dateien in os.walk(p):
        for d in dateien:
            try:
                n += os.path.getsize(os.path.join(wurzel, d))
            except OSError:
                pass
    return n


def _alter_tage(p: Path) -> float:
    """Alter des JÜNGSTEN Eintrags im Ordner, in Tagen.

    Bewusst der jüngste: der Ordner selbst behält oft sein ursprüngliches
    Datum, während weiter Dateien hineinkommen. Nach dem Ordnerdatum zu gehen
    hieße, einen aktiv benutzten Ordner für alt zu halten.
    """
    neuster = 0.0
    try:
        neuster = p.stat().st_mtime
    except OSError:
        return 0.0
    for wurzel, _, dateien in os.walk(p):
        for d in dateien:
            try:
                neuster = max(neuster, os.path.getmtime(os.path.join(wurzel, d)))
            except OSError:
                pass
    return (time.time() - neuster) / 86400.0


def analysiere(drops_dir, sessions_datei) -> dict:
    """Was läge an, ohne etwas anzufassen. Für Vorschau und Test."""
    drops_dir = Path(drops_dir)
    ids = _referenzierte_ids(Path(sessions_datei))
    if ids is None:
        return {"ok": False, "grund": "sessions_unlesbar",
                "loeschbar": [], "behalten": [], "bytes": 0}
    if not drops_dir.is_dir():
        return {"ok": True, "loeschbar": [], "behalten": [], "bytes": 0}

    loeschbar, behalten, summe = [], [], 0
    for p in sorted(drops_dir.iterdir()):
        if not p.is_dir():
            continue
        if p.name in ids:
            behalten.append({"name": p.name, "grund": "in Benutzung"})
            continue
        tage = _alter_tage(p)
        if tage < KARENZ_TAGE:
            behalten.append({"name": p.name, "grund": "zu frisch"})
            continue
        b = _groesse(p)
        summe += b
        loeschbar.append({"name": p.name, "bytes": b, "tage": round(tage, 1)})
    return {"ok": True, "loeschbar": loeschbar, "behalten": behalten,
            "bytes": summe}


def aufraeumen(drops_dir, sessions_datei, wirklich: bool = True) -> dict:
    """Verwaiste Drop-Ordner entfernen. Gibt zurück, was tatsächlich wegging."""
    plan = analysiere(drops_dir, sessions_datei)
    if not plan["ok"]:
        return {"ok": False, "grund": plan["grund"], "geloescht": 0, "bytes": 0}
    if not wirklich:
        return {"ok": True, "vorschau": True, "geloescht": len(plan["loeschbar"]),
                "bytes": plan["bytes"]}

    drops_dir = Path(drops_dir)
    weg, frei, fehler = 0, 0, 0
    for eintrag in plan["loeschbar"]:
        ziel = drops_dir / eintrag["name"]
        try:
            shutil.rmtree(ziel)
            weg += 1
            frei += eintrag["bytes"]
        except OSError as e:
            fehler += 1
            log.warning("drops: %s ließ sich nicht entfernen: %s", ziel.name, e)
    if weg:
        log.info("drops: %d verwaiste Ordner entfernt, %.1f GB frei",
                 weg, frei / 2**30)
    return {"ok": True, "geloescht": weg, "bytes": frei, "fehler": fehler,
            "behalten": len(plan["behalten"])}
