"""Die Cloud ist eine Kopie der Bibliothek (02.09.2026).

Beschlossen mit Marc am 02.09.2026 (`docs/UMBAU-BIBLIOTHEK.md`, Q29):
*„Die Cloud wäre eine Kopie der Bibliothek."* Vorher lud die App je Tour
einen eigenen Umschlag hoch, der Verzeichnis, Sammlungen, Projekte, Fotos
und Versionsketten in sich trug — ein zweites Datenmodell neben dem echten,
das bei jeder Änderung am ersten nachgezogen werden musste. Es ist ersatzlos
entfallen (`core/cloud/archiv.py` gelöscht).

## Was hochgeht

| Objekt | Inhalt |
|---|---|
| `bib/nutzerdaten` | alles, was **du** gesagt hast: Schlagworte, Favoriten, Notizen, eigene Namen, Farben, Fortbewegung, Sammlungen, beobachtete Ordner |
| `bib/projekte` | `projekte.json` |
| `bib/touren` | `touren.json` (Tour-Register mit den Versionsreihen) |
| `bib/track/<geo_hash>` | eine Version, genau die Datei aus dem Versionsspeicher |
| `bib/bild/<datei>` | selbst gewählte Titelbilder |

## Was NICHT hochgeht — und warum

* **`library.db`.** Der Index ist abgeleitet: Er entsteht aus den Touren und
  den Nutzerdaten. Ihn als 5-MB-Klotz hochzuladen hieße, ihn bei jeder
  Kleinigkeit neu zu übertragen und bei zwei Rechnern gegeneinander
  auszuspielen. Am zweiten Gerät wird er neu aufgebaut.
* **Vorschau- und Kartenbilder.** Kommen von Mapbox und entstehen dort neu.
  Titelbilder dagegen sind deine Wahl und gehen mit.
* **Fotos.** Die gehören dir und liegen in deinen Ordnern; GPS Studio hat
  sie nie besessen und lädt sie auch nicht hoch.

## Zwei-Geräte-Betrieb

Es wird **nie** automatisch gelöscht. „Liegt oben, aber nicht hier" heißt bei
zwei Rechnern meistens „vom anderen Rechner" — ein Aufräumer hätte die Geräte
gegeneinander ausgespielt. Die Zahl wird gezeigt, das Aufräumen ist eine
eigene, bewusste Handlung.
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Callable

from . import crypto

#: Feste Objektnamen.
#: `INHALT` ist das Inhaltsverzeichnis: die Liste aller logischen Namen.
#: Ohne es könnte ein frischer Rechner gar nicht wissen, was oben liegt — der
#: Server kennt nur Hash-Namen und gibt sie nicht preis. (Beim ersten
#: Live-Test genau daran gescheitert: Der zweite Rechner holte drei Objekte
#: und keine einzige Tour; der zweite Anlauf riet die Namen aus dem
#: Tour-Register und verfehlte 16 Versionen, die dort nicht stehen.)
INHALT = "bib/inhalt"
NUTZERDATEN = "bib/nutzerdaten"
PROJEKTE = "bib/projekte"
TOUREN = "bib/touren"

#: Tabellen mit Nutzer-Eingaben. Alles andere in der Datenbank ist abgeleitet.
NUTZER_TABELLEN = ("track_meta", "collections", "collection_items", "folders")


def track_name(geo_hash: str) -> str:
    return f"bib/track/{geo_hash}"


def bild_name(datei: str) -> str:
    return f"bib/bild/{datei}"


def json_bytes(d) -> bytes:
    """Immer gleich serialisieren — sonst ändert sich die Prüfsumme, obwohl
    sich nichts geändert hat, und die App lädt ewig alles neu hoch."""
    return json.dumps(d, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":")).encode("utf-8")


# ── Nutzerdaten aus der Datenbank ───────────────────────────────────────────

def nutzerdaten_export(conn: sqlite3.Connection) -> dict:
    """Alles, was der Nutzer gesagt hat — und nur das."""
    out: dict = {"schema": 1}
    vorhanden = {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    for tab in NUTZER_TABELLEN:
        if tab not in vorhanden:
            out[tab] = []
            continue
        spalten = [r[1] for r in conn.execute(f"PRAGMA table_info({tab})").fetchall()]
        zeilen = conn.execute(f"SELECT * FROM {tab}").fetchall()
        out[tab] = [dict(zip(spalten, z)) for z in zeilen]
    return out


def nutzerdaten_import(conn: sqlite3.Connection, daten: dict) -> dict:
    """Nutzerdaten zurückspielen — ergänzend, nie löschend.

    Bewusst `INSERT OR REPLACE`: Was hier ankommt, ist die Wahrheit für die
    Zeilen, die es nennt. Zeilen, die es NICHT nennt, bleiben unberührt —
    sonst würde ein Abgleich vom Zweitgerät lokale Arbeit wegräumen.
    """
    gesetzt = {}
    vorhanden = {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    for tab in NUTZER_TABELLEN:
        zeilen = daten.get(tab) or []
        if not zeilen or tab not in vorhanden:
            gesetzt[tab] = 0
            continue
        spalten = [r[1] for r in conn.execute(f"PRAGMA table_info({tab})").fetchall()]
        n = 0
        for z in zeilen:
            felder = [s for s in spalten if s in z]
            if not felder:
                continue
            conn.execute(
                f"INSERT OR REPLACE INTO {tab}({', '.join(felder)}) "
                f"VALUES({', '.join('?' * len(felder))})",
                [z[s] for s in felder])
            n += 1
        gesetzt[tab] = n
    conn.commit()
    return gesetzt


# ── Was lokal da ist ────────────────────────────────────────────────────────

def bestand(bib: Path, conn: sqlite3.Connection | None = None) -> tuple[dict, dict]:
    """(Prüfsummen je Objekt, Lieferant je Objekt).

    Der Lieferant ist eine Funktion, die den KLARTEXT liefert — erst beim
    Hochladen gerufen, damit nicht die ganze Bibliothek im Speicher landet.
    """
    bib = Path(bib)
    pruef: dict[str, str] = {}
    liefer: dict[str, Callable[[], bytes]] = {}

    def dazu(name: str, roh: bytes):
        pruef[name] = crypto.inhalts_pruefsumme(roh)
        liefer[name] = lambda r=roh: r

    def datei_dazu(name: str, pfad: Path):
        try:
            roh = pfad.read_bytes()
        except OSError:
            return
        pruef[name] = crypto.inhalts_pruefsumme(roh)
        liefer[name] = lambda p=pfad: p.read_bytes()

    if conn is not None:
        dazu(NUTZERDATEN, json_bytes(nutzerdaten_export(conn)))
    for name, datei in ((PROJEKTE, bib / "projekte.json"),
                        (TOUREN, bib / "touren.json")):
        if datei.is_file():
            datei_dazu(name, datei)

    touren = bib / "touren"
    if touren.is_dir():
        for f in sorted(touren.rglob("*.gpx.gz")):
            datei_dazu(track_name(f.name[:-len(".gpx.gz")]), f)

    titel = bib / "bilder" / "titel"
    if titel.is_dir():
        for f in sorted(titel.iterdir()):
            if f.is_file() and not f.name.startswith("."):
                datei_dazu(bild_name(f.name), f)

    # Das Inhaltsverzeichnis kommt ZULETZT — es zählt alles andere auf.
    dazu(INHALT, json_bytes({"schema": 1, "namen": sorted(pruef)}))
    return pruef, liefer


def zusammenfassung(pruef: dict) -> dict:
    """Was der Bestand enthält — für die Anzeige."""
    return {
        "objekte": len(pruef),
        "touren": sum(1 for n in pruef if n.startswith("bib/track/")),
        "bilder": sum(1 for n in pruef if n.startswith("bib/bild/")),
        "hat_projekte": PROJEKTE in pruef,
        "hat_nutzerdaten": NUTZERDATEN in pruef,
    }


# ── Zurückspielen ───────────────────────────────────────────────────────────

def ablegen(bib: Path, logischer_name: str, klartext: bytes) -> Path | None:
    """Ein heruntergeladenes Objekt an seinen Platz in der Bibliothek legen.

    Gibt den Pfad zurück — oder None, wenn das Objekt nicht als Datei gehört
    (Nutzerdaten gehen in die Datenbank, nicht auf die Platte).
    """
    bib = Path(bib)
    if logischer_name == NUTZERDATEN:
        return None
    if logischer_name == PROJEKTE:
        ziel = bib / "projekte.json"
    elif logischer_name == TOUREN:
        ziel = bib / "touren.json"
    elif logischer_name.startswith("bib/track/"):
        gh = logischer_name[len("bib/track/"):]
        ziel = bib / "touren" / gh[:2] / f"{gh}.gpx.gz"
    elif logischer_name.startswith("bib/bild/"):
        ziel = bib / "bilder" / "titel" / logischer_name[len("bib/bild/"):]
    else:
        return None
    ziel.parent.mkdir(parents=True, exist_ok=True)
    tmp = ziel.with_suffix(ziel.suffix + ".tmp")
    tmp.write_bytes(klartext)
    tmp.replace(ziel)
    return ziel
