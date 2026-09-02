"""Umzug des Bestands in die Bibliothek (Schnitt 1, docs/UMBAU-BIBLIOTHEK.md).

Bis v0.9.635 lagen Daten und Arbeitskram gemeinsam im App-Ordner. Dieses
Modul holt die Daten dort heraus und legt sie in die Bibliothek.

**Es läuft von selbst**, einmal, beim ersten Start nach dem Update — Marc,
02.09.2026: *„100%ig sicherstellen, dass die Beta-Tester alles leicht
migriert kriegen."* Ein Werkzeug, das man erst finden muss, ist nicht leicht.

Vorsichtsregeln, die hier alle gelten:

* **Vorher sichern.** Die kleinen, unersetzlichen Dateien (Archiv-Datenbank,
  Projekte, Tour-Register) werden vorher kopiert. Sie sind zusammen wenige
  Megabyte — es gibt keinen Grund, das nicht zu tun.
* **Kopieren, dann erst wegräumen.** Nichts wird gelöscht, bevor die Kopie
  vollständig und die Datenbank lesbar ist.
* **Bei Zweifel abbrechen und alles lassen, wie es war.** Ein halber Umzug
  ist schlimmer als keiner.
* **Berichten, was passiert ist** — auch das, was nicht ging.
"""
from __future__ import annotations

import shutil
import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from typing import Callable, Optional

from . import bibliothek as bib

# Was aus dem App-Ordner in die Bibliothek gehört: (Quelle, Ziel unterhalb
# der Bibliothek). Alles andere bleibt, wo es ist — es gehört zum Rechner.
ZU_VERSCHIEBEN = [
    ("library.db",          "library.db"),
    ("projekte.json",       "projekte.json"),
    ("touren.json",         "touren.json"),
    # Sehr alte Installationen (vor E1) haben nur diese Datei; `core/projekte`
    # löst sie beim ersten Laden auf. Sie muss deshalb mit umziehen, sonst
    # sucht die Auflösung in der Bibliothek und findet nichts.
    ("sessions.json",       "sessions.json"),
    ("sessions",            "touren"),            # Sonderfall: wird komprimiert
    ("library_thumbs",      "bilder/vorschau"),
    ("library_mapthumbs",   "bilder/karten"),
    ("library_covers",      "bilder/titel"),
    ("projekt_staende",     "projekt_staende"),
]

# Diese Ordner enthalten Trackdateien, die die App selbst angelegt hat und
# die für manche Touren die EINZIGE Kopie sind. Sie bleiben vorerst liegen
# (der Bestand wird daraus in die Bibliothek aufgenommen) und verschwinden
# erst in Schnitt 3, wenn nichts mehr auf sie zeigt.
APP_EIGENE_QUELLEN = ("import", "zusammengefuehrt", "cloud_touren",
                      "projekt_importe", "_drops")


def noetig(app_support: Path) -> bool:
    """Liegt im App-Ordner noch Bestand, der umziehen muss?"""
    a = Path(app_support)
    return any((a / q).exists() for q, _ in ZU_VERSCHIEBEN)


def vorschau(app_support: Path) -> dict:
    """Was würde umziehen? Zahlen für den Bericht, ohne etwas anzufassen."""
    a = Path(app_support)
    posten, bytes_ges = [], 0
    for quelle, _ziel in ZU_VERSCHIEBEN:
        q = a / quelle
        if not q.exists():
            continue
        if q.is_dir():
            dateien = [f for f in q.rglob("*") if f.is_file()]
            groesse = sum(f.stat().st_size for f in dateien)
            posten.append({"was": quelle, "n": len(dateien), "bytes": groesse})
        else:
            groesse = q.stat().st_size
            posten.append({"was": quelle, "n": 1, "bytes": groesse})
        bytes_ges += groesse
    touren = 0
    db = a / "library.db"
    if db.is_file():
        try:
            con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=5)
            touren = con.execute("SELECT COUNT(*) FROM tracks").fetchone()[0]
            con.close()
        except Exception:
            pass
    return {"posten": posten, "bytes": bytes_ges, "touren": touren}


def _sicherung(app_support: Path) -> Optional[Path]:
    """Kopie der unersetzlichen Kleindateien, bevor irgendetwas passiert."""
    a = Path(app_support)
    ziel = a / "_umzug_sicherung" / time.strftime("%Y%m%d-%H%M%S")
    try:
        ziel.mkdir(parents=True, exist_ok=True)
        for name in ("library.db", "projekte.json", "touren.json"):
            q = a / name
            if q.is_file():
                shutil.copy2(q, ziel / name)
        return ziel
    except OSError:
        return None


def ausfuehren(app_support: Path, ziel_ort: Path,
               melden: Optional[Callable[[str, float], None]] = None) -> dict:
    """Den Bestand in die Bibliothek holen.

    `melden(text, anteil)` wird für den Fortschrittsbalken gerufen.
    Rückgabe: Bericht mit `ok`, `sicherung`, `verschoben`, `probleme`.
    """
    a, z = Path(app_support), Path(ziel_ort)

    def sag(t: str, anteil: float) -> None:
        if melden:
            try:
                melden(t, anteil)
            except Exception:
                pass

    bericht = {"ok": False, "sicherung": "", "verschoben": [], "probleme": [],
               "begonnen": datetime.now().astimezone().isoformat(timespec="seconds")}

    # Der Ort muss brauchbar sein, BEVOR wir irgendetwas anfassen.
    pr = bib.pruefen(z)
    if not pr.get("ok"):
        bericht["probleme"].append({"was": "ziel", "cloud": pr.get("cloud", ""),
                                    "grund": pr.get("grund") or "",
                                    "detail": pr.get("error") or ""})
        return bericht

    sag("sichern", 0.02)
    s = _sicherung(a)
    bericht["sicherung"] = str(s or "")
    if s is None:
        bericht["probleme"].append({"was": "sicherung", "grund": "sicherung_unmoeglich"})
        return bericht

    r = bib.anlegen(z)
    if not r.get("ok"):
        bericht["probleme"].append({"was": "anlegen", "cloud": r.get("cloud", ""),
                                    "grund": r.get("grund") or "", "detail": r.get("error") or ""})
        return bericht

    posten = [(q, t) for q, t in ZU_VERSCHIEBEN if (a / q).exists()]
    for i, (quelle, zielname) in enumerate(posten):
        q, t = a / quelle, z / zielname
        sag(quelle, 0.05 + 0.85 * (i / max(1, len(posten))))
        try:
            if quelle == "sessions":
                # Sonderfall: aus flachen .gpx wird der komprimierte
                # Versionsspeicher. Der Dateiname IST der geo_hash.
                n = 0
                for f in sorted(q.glob("*.gpx")):
                    try:
                        bib.version_ablegen(z, f, f.stem)
                        n += 1
                    except Exception:       # noqa: BLE001 — eine Datei hält den Umzug nicht auf
                        bericht["probleme"].append({"was": "sessions", "datei": f.name})
                bericht["verschoben"].append({"was": quelle, "n": n})
            elif q.is_dir():
                t.mkdir(parents=True, exist_ok=True)
                n = 0
                for f in q.rglob("*"):
                    if not f.is_file():
                        continue
                    ziel_datei = t / f.relative_to(q)
                    ziel_datei.parent.mkdir(parents=True, exist_ok=True)
                    if not ziel_datei.exists():
                        shutil.copy2(f, ziel_datei)
                    n += 1
                bericht["verschoben"].append({"was": quelle, "n": n})
            else:
                t.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(q, t)
                bericht["verschoben"].append({"was": quelle, "n": 1})
        except OSError as e:
            bericht["probleme"].append({"was": quelle, "grund": str(e)})

    # Die Datenbank muss danach lesbar sein — sonst war der Umzug umsonst und
    # wir lassen den alten Bestand ausdrücklich stehen.
    sag("pruefen", 0.92)
    neue_db = bib.db_pfad(z)
    if neue_db.is_file() and not bib.db_heil(neue_db):
        bericht["probleme"].append({"was": "library.db", "grund": "db_unlesbar"})
        return bericht

    # Bildpfade gleich hier umschreiben — sonst zeigt das Archiv nach dem
    # Umzug lauter Fragezeichen, weil die Dateien umgezogen sind und die
    # gespeicherten ABSOLUTEN Pfade nicht.
    if neue_db.is_file():
        try:
            con = sqlite3.connect(str(neue_db), timeout=10)
            try:
                r = bildpfade_richten(con, a, z)
                bericht["bildpfade"] = r.get("geaendert", 0)
            finally:
                con.close()
        except Exception as e:      # noqa: BLE001
            bericht["probleme"].append({"was": "bildpfade", "grund": "nicht_richtbar",
                                        "detail": str(e)})

    # Erst jetzt aufräumen: umbenennen statt löschen. Wer nach einem Monat
    # merkt, dass etwas fehlt, findet es noch.
    sag("aufraeumen", 0.96)
    stempel = time.strftime("%Y%m%d-%H%M%S")
    for quelle, _ in posten:
        q = a / quelle
        try:
            q.rename(a / f"{q.name}.umgezogen-{stempel}")
        except OSError as e:
            bericht["probleme"].append({"was": quelle, "grund": "nicht_wegraeumbar", "detail": str(e)})

    bib.ort_schreiben(a, z)
    bericht["ok"] = True
    bericht["ort"] = str(z)
    bericht["beendet"] = datetime.now().astimezone().isoformat(timespec="seconds")
    sag("fertig", 1.0)
    return bericht


# ── Bildpfade richten ───────────────────────────────────────────────────────

#: Wohin die Bilder gewandert sind. Die Datenbank speichert ABSOLUTE Pfade —
#: nach dem Umzug zeigen sie ins Leere, und im Archiv steht überall „?".
BILD_ORDNER = (("library_thumbs", "bilder/vorschau"),
               ("library_mapthumbs", "bilder/karten"),
               ("library_covers", "bilder/titel"))


def bildpfade_richten(conn: sqlite3.Connection, app_support: Path,
                      ort: Path) -> dict:
    """Gespeicherte Bildpfade auf die Bibliothek umschreiben.

    02.09.2026, nach dem ersten Umzug auf einem echten Rechner: Die Dateien
    waren umgezogen, die Pfade in der Datenbank nicht — 716 von 717 Kacheln
    zeigten ein Fragezeichen statt ihres Bildes.

    Läuft idempotent bei jedem Öffnen der Bibliothek; wenn nichts passt,
    kostet es drei UPDATEs, die null Zeilen treffen.
    """
    a, z = Path(app_support), Path(ort)
    geaendert = 0
    for alt_name, neu_rel in BILD_ORDNER:
        alt_pfad = str(a / alt_name) + "/"
        neu_pfad = str(z / neu_rel) + "/"
        for tabelle, spalten in (("tracks", ("thumb", "map_thumb", "cover")),
                                 ("track_meta", ("cover",))):
            for spalte in spalten:
                cur = conn.execute(
                    f"UPDATE {tabelle} SET {spalte} = REPLACE({spalte}, ?, ?) "
                    f"WHERE {spalte} LIKE ?", (alt_pfad, neu_pfad, alt_pfad + "%"))
                geaendert += cur.rowcount or 0
    if geaendert:
        conn.commit()
    return {"geaendert": geaendert}


# ── Bestand aufnehmen ───────────────────────────────────────────────────────

def bestand_aufnehmen(conn: sqlite3.Connection, ort: Path,
                      melden: Optional[Callable[[str, float], None]] = None) -> dict:
    """Jede Tour im Archiv bekommt eine Kopie in der Bibliothek.

    Das ist der Schritt, der aus dem Datei-Index eine Bibliothek macht: Bis
    hierher hing jede Tour an ihrer Datei irgendwo draußen. Danach ist sie
    vollständig hier — und das Löschen einer Quelldatei reißt nichts ein.

    Was nicht geht, wird gezählt und benannt, nicht verschwiegen: Touren,
    deren Datei gerade nicht erreichbar ist (externe Platte) und für die es
    auch keine Kopie gab.
    """
    ort = Path(ort)
    zeilen = conn.execute(
        "SELECT path, geo_hash FROM tracks WHERE geo_hash != '' AND error = ''"
    ).fetchall()
    neu = schon = fehlt = 0
    ohne_kopie = []
    offen = []
    for r in zeilen:
        gh = r["geo_hash"] if hasattr(r, "keys") else r[1]
        pfad = r["path"] if hasattr(r, "keys") else r[0]
        if bib.version_datei(ort, gh).is_file():
            schon += 1
            continue
        offen.append((Path(pfad), gh))
    ges = max(1, len(offen))

    def eine(auftrag):
        q, gh = auftrag
        if not q.is_file():
            return ("fehlt", str(q))
        try:
            # `version_ablegen` wandelt Fremdformate um und kann dabei auch an
            # einer kaputten Datei scheitern (TrackImportError, kein OSError).
            # EINE Datei darf den Umzug nicht anhalten.
            bib.version_ablegen(ort, q, gh)
            return ("neu", "")
        except Exception:       # noqa: BLE001
            return ("fehlt", str(q))

    # 02.09.2026 (Beta-Tester mit NAS: „die Migration dauert sehr lange"):
    # nebenläufig kopieren. Der Engpass ist nicht die Rechenzeit, sondern die
    # WARTEZEIT je Datei — über SMB kostet jedes Öffnen einen Netz-Roundtrip
    # (10–50 ms), und nacheinander summiert sich das bei 5 000 Touren auf
    # Viertelstunden. Acht Aufträge gleichzeitig füllen die Wartezeiten
    # gegenseitig auf; lokal (SSD) ändert es kaum etwas, schadet aber nicht.
    fertig = 0
    with ThreadPoolExecutor(max_workers=8) as pool:
        for art, wo in pool.map(eine, offen):
            fertig += 1
            if art == "neu":
                neu += 1
            else:
                fehlt += 1
                if len(ohne_kopie) < 50:
                    ohne_kopie.append(wo)
            if melden and fertig % 25 == 0:
                melden("aufnehmen", fertig / ges)
    if melden:
        melden("fertig", 1.0)
    return {"ok": True, "neu": neu, "schon_da": schon, "ohne_kopie": fehlt,
            "beispiele": ohne_kopie}
