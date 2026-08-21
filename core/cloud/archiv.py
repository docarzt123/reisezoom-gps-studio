"""Aus dem lokalen Archiv wird ein Verzeichnis und werden Umschläge.

Entwurf: `docs/IDEAS.md` §26 (mit Marc am 15.08.2026 durchgesprochen).

## Drei Sorten Inhalt

| | Was drin ist | Wann es sich ändert |
|---|---|---|
| **Verzeichnis** | alle Touren mit ihren anzeigbaren Daten | bei jeder Änderung an einer Tour |
| **Sammlungen** | Sammlungen, Zuordnungen, Ordner | selten |
| **Umschlag je Tour** | GPX-Datei, Projekte, Foto-Vorschaubilder | wenn man an der Tour arbeitet |

⚠️ **Warum die anzeigbaren Daten ins Verzeichnis gehören und nicht in die
Umschläge:** Sonst müsste Gerät 2 alle 709 Umschläge herunterladen, nur um eine
Liste zu zeigen — und die Idee „der Server ist das Archiv, der Rechner holt sich,
was er braucht" wäre dahin. Das Verzeichnis ist mit gut 3 MB klein genug, um
immer vollständig dazuliegen.

⚠️ **Warum die Sammlungen NICHT ins Verzeichnis gehören** (Marc-Korrektur vom
15.08.2026): Eine Tour kann in mehreren Sammlungen liegen, und das Verzeichnis
ändert sich ohnehin bei jeder Kleinigkeit. Getrennt bleibt das Umgruppieren eine
winzige Übertragung statt einer großen.

## Der Umschlag ist ein ZIP

    track.gpx        die Aufzeichnung, unverändert
    tour.json        Name, Notiz, Schlagworte, Farbe … (aus `track_meta`)
    projekte.json    Animator, Tour-Map, Geotagger-Einstellungen
    fotos/0001.jpg   Vorschaubilder der im Projekt gesetzten Fotos

Ein ZIP, weil darin Binäres und Text nebeneinander liegen dürfen und man es im
Zweifel von Hand aufmachen und nachsehen kann.
"""
from __future__ import annotations

import io
import json
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

from . import crypto

# Vorschaubilder: 512 Pixel reichen auch für einen 4K-Render, weil ein Foto-Pin
# auf der Karte höchstens ein paar hundert Pixel groß wird. Gemessen am
# 15.08.2026: Original 0,7–0,8 MB, Vorschau bei 512 px rund 40 KB.
FOTO_KANTE = 512
FOTO_QUALITAET = 82

VERZEICHNIS = "verzeichnis"
SAMMLUNGEN = "sammlungen"


def track_name(geo_hash: str) -> str:
    """Der logische Name einer Tour — auch die Bindung des Umschlags."""
    return f"track/{geo_hash}"


@dataclass
class Bestand:
    """Was lokal da ist, in der Form, in der es hochgehört."""
    verzeichnis: dict = field(default_factory=dict)
    sammlungen: dict = field(default_factory=dict)
    # geo_hash → Prüfsumme des Umschlag-Klartexts
    touren: dict[str, str] = field(default_factory=dict)


# ══════════════════════════════════════════════════════════════════════════
#  Verzeichnis
# ══════════════════════════════════════════════════════════════════════════

def _tabellen(conn) -> set[str]:
    """Welche Tabellen gibt es hier wirklich?

    ⚠️ Nicht jedes Archiv hat alle: Eine Datenbank aus einer älteren Fassung
    kennt `track_meta`, `collections` und `collection_items` noch nicht. Ohne
    diese Prüfung stirbt der Abgleich mit „no such table" — bei genau den
    Nutzern, die am längsten dabei sind.
    """
    return {z[0] for z in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'")}


def verzeichnis_bauen(conn) -> dict:
    """Alle Touren mit ihren anzeigbaren Daten.

    Bewusst ohne `path`: Wo eine Datei auf DIESEM Rechner liegt, geht kein
    anderes Gerät etwas an — und wäre dort ohnehin falsch. Der Umschlag bringt
    die Datei mit, der Pfad entsteht auf dem Zielrechner neu.
    """
    hat = _tabellen(conn)
    spalten = """t.geo_hash, t.track_hash, t.filename, t.name, t.started_at,
                 t.ended_at, t.year, t.distance_m, t.duration_s, t.moving_time_s,
                 t.ascent_m, t.descent_m, t.ele_min, t.ele_max,
                 t.max_speed_kmh, t.avg_speed_kmh, t.size"""
    verbund = ""
    if "track_meta" in hat:
        spalten += """, m.fav, m.tags, m.note, m.cover, m.display_name, m.hidden,
                      m.activity_user, m.color, m.recorded_user, m.first_seen, m.last_seen"""
        verbund = " LEFT JOIN track_meta m ON m.geo_hash = t.geo_hash"
    touren = {}
    for zeile in conn.execute(
            f"SELECT {spalten} FROM tracks t{verbund}"
            " WHERE t.geo_hash IS NOT NULL AND t.geo_hash <> ''"):
        d = {k: zeile[k] for k in zeile.keys()}
        gh = d.pop("geo_hash")
        touren[gh] = {k: v for k, v in d.items() if v is not None}
    return {"format": 1, "touren": touren}


def sammlungen_bauen(conn) -> dict:
    """Sammlungen, Zuordnungen und beobachtete Ordner."""
    hat = _tabellen(conn)
    sammlungen = [dict(z) for z in conn.execute(
        "SELECT id, name, note, created_at FROM collections ORDER BY id")] \
        if "collections" in hat else []
    zuordnung = {}
    if "collection_items" in hat:
        for z in conn.execute(
                "SELECT collection_id, geo_hash, sort_index FROM collection_items"):
            zuordnung.setdefault(str(z["collection_id"]), []).append(
                {"geo_hash": z["geo_hash"], "sort": z["sort_index"]})
    ordner = [dict(z) for z in conn.execute(
        "SELECT path, added_at, recursive FROM folders")] if "folders" in hat else []
    return {"format": 1, "sammlungen": sammlungen,
            "zuordnung": zuordnung, "ordner": ordner}


# ══════════════════════════════════════════════════════════════════════════
#  Umschlag je Tour
# ══════════════════════════════════════════════════════════════════════════

def _foto_vorschau(pfad: str) -> bytes | None:
    """Ein Foto auf Vorschaugröße bringen. None, wenn es das Foto nicht gibt."""
    try:
        from PIL import Image
        p = Path(pfad)
        if not p.is_file():
            return None
        with Image.open(p) as im:
            im = im.convert("RGB")
            im.thumbnail((FOTO_KANTE, FOTO_KANTE))
            puffer = io.BytesIO()
            im.save(puffer, "JPEG", quality=FOTO_QUALITAET, optimize=True)
            return puffer.getvalue()
    except Exception:
        # ⚠️ Ein einzelnes unlesbares Foto darf nie den ganzen Umschlag
        # verhindern — die Tour ist wichtiger als ihr Vorschaubild.
        return None


def umschlag_bauen(conn, geo_hash: str, *, gpx_pfad: str | None = None,
                   projekte: dict | None = None) -> bytes:
    """Alles, was zu einer Tour gehört, als ZIP im Speicher."""
    zeile = conn.execute(
        "SELECT * FROM tracks WHERE geo_hash = ? LIMIT 1", (geo_hash,)).fetchone()
    if zeile is None:
        raise KeyError(f"Tour {geo_hash} steht nicht im Archiv.")
    meta = (conn.execute("SELECT * FROM track_meta WHERE geo_hash = ? LIMIT 1",
                         (geo_hash,)).fetchone()
            if "track_meta" in _tabellen(conn) else None)

    puffer = io.BytesIO()
    # ⚠️ Ohne feste Zeitstempel wäre jedes ZIP byteweise anders, obwohl sich
    # nichts geändert hat — und jede Prüfsumme wäre neu. Dann lüde die App
    # ewig alles hoch. Deshalb überall dasselbe Datum.
    festes_datum = (1980, 1, 1, 0, 0, 0)
    with zipfile.ZipFile(puffer, "w", zipfile.ZIP_DEFLATED) as z:
        def schreiben(name: str, daten: bytes):
            info = zipfile.ZipInfo(name, date_time=festes_datum)
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, daten)

        quelle = Path(gpx_pfad or zeile["path"])
        if quelle.is_file():
            schreiben("track.gpx", quelle.read_bytes())

        tour = {k: zeile[k] for k in zeile.keys() if k != "path"}
        if meta is not None:
            tour["meta"] = {k: meta[k] for k in meta.keys()}
        schreiben("tour.json", json.dumps(tour, ensure_ascii=False,
                                          sort_keys=True).encode("utf-8"))

        if projekte:
            # Fotos: nur Vorschaubilder, nie Originale. Der Pfad wird durch den
            # Namen im ZIP ersetzt, damit Gerät 2 nichts sucht, was es nicht gibt.
            kopie = json.loads(json.dumps(projekte))
            nummer = 0
            for proj in (kopie.get("projects") or {}).values():
                for fotos in (proj.get("photos"), ):
                    for foto in (fotos or []):
                        if not isinstance(foto, dict) or not foto.get("path"):
                            continue
                        bild = _foto_vorschau(foto["path"])
                        if bild is None:
                            foto["vorschau_fehlt"] = True
                            continue
                        nummer += 1
                        name = f"fotos/{nummer:04d}.jpg"
                        schreiben(name, bild)
                        foto["vorschau"] = name
            schreiben("projekte.json", json.dumps(kopie, ensure_ascii=False,
                                                  sort_keys=True).encode("utf-8"))
    return puffer.getvalue()


# ══════════════════════════════════════════════════════════════════════════
#  Was hat sich geändert?
# ══════════════════════════════════════════════════════════════════════════

def bestand_aufnehmen(conn, sessions: dict | None = None) -> Bestand:
    """Prüfsummen von allem, was hochgehört — ohne schon etwas zu übertragen."""
    verzeichnis = verzeichnis_bauen(conn)
    sammlungen = sammlungen_bauen(conn)
    b = Bestand(verzeichnis=verzeichnis, sammlungen=sammlungen)
    for gh in verzeichnis["touren"]:
        inhalt = umschlag_bauen(conn, gh,
                                projekte=_projekte_fuer(conn, gh, sessions))
        b.touren[gh] = crypto.inhalts_pruefsumme(inhalt)
    return b


def _projekte_fuer(conn, geo_hash: str, sessions: dict | None) -> dict | None:
    """Die Session (Projekte) dieser Tour.

    Seit v0.9.529 hängen Sessions am kanonischen `geo_hash` — demselben Hash,
    unter dem das Archiv die Tour führt und der Umschlag gebunden ist. Der
    frühere Umweg über `tracks.track_hash` fand NIE etwas: die Spalte enthält
    den Hash MIT Dateiname, die Sessions waren mit dem Hash der downsampled
    UI-Koordinaten geschlüsselt — drei verschiedene Werte für dieselbe Tour.
    Deshalb enthielten alle Umschläge nur track.gpx + tour.json, nie Projekte
    (entdeckt 21.08.2026 am Rechner-Test). `conn` bleibt in der Signatur, die
    Aufrufer reichen sie ohnehin durch.
    """
    if not sessions:
        return None
    return (sessions.get("sessions") or {}).get(geo_hash)


def json_bytes(d: dict) -> bytes:
    """Einheitlich serialisieren — sortiert, damit Prüfsummen stabil sind."""
    return json.dumps(d, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":")).encode("utf-8")
