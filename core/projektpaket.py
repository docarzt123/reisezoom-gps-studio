"""Das Projekt-Paket (.rzproj) — eine Tour samt Projekten als ZIP.

02.09.2026 herausgelöst aus `core/cloud/archiv.py`, das mit dem Umbau der
Cloud auf „Kopie der Bibliothek" (`core/cloud/bibliothek.py`) entfallen ist.
Dieser Teil hat mit der Cloud nie etwas zu tun gehabt: Er baut die Datei,
die beim „Projekt exportieren" entsteht und die man jemandem schicken kann.

⚠️ Feste Zeitstempel im ZIP: Ohne sie wäre jedes Paket byteweise anders,
obwohl sich nichts geändert hat.
"""
from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

#: Kantenlängen der Bilder im Paket. Fotos werden kleiner gerechnet als
#: Schilder-Bilder — Fotos sind viele, Schilder wenige und formatfüllend.
FOTO_KANTE = 512
FOTO_QUALITAET = 82
BILD_KANTE = 1600

#: Welche Projektfelder auf Bilddateien zeigen: (Liste im Projekt, Pfadfeld,
#: ZIP-Ordner, Kantenlänge). `vorschau` im Eintrag nennt die Datei im ZIP;
#: der Einspieler (app._umschlag_einspielen) biegt das Pfadfeld darauf um.
BILD_FELDER = (
    ("photos", "path", "fotos", FOTO_KANTE),
    ("signs", "imageSrc", "bilder", BILD_KANTE),
    ("tourmap_signs", "imageSrc", "bilder", BILD_KANTE),
)


def _tabellen(conn) -> set[str]:
    """Welche Tabellen gibt es hier wirklich?

    ⚠️ Nicht jedes Archiv hat alle: Eine Datenbank aus einer älteren Fassung
    kennt `track_meta`, `collections` und `collection_items` noch nicht. Ohne
    diese Prüfung stirbt der Abgleich mit „no such table" — bei genau den
    Nutzern, die am längsten dabei sind.
    """
    return {z[0] for z in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'")}


def _foto_vorschau(pfad: str, kante: int = FOTO_KANTE) -> bytes | None:
    """Ein Foto auf Vorschaugröße bringen. None, wenn es das Foto nicht gibt."""
    try:
        from PIL import Image
        p = Path(pfad)
        if not p.is_file():
            return None
        with Image.open(p) as im:
            im = im.convert("RGB")
            im.thumbnail((kante, kante))
            puffer = io.BytesIO()
            im.save(puffer, "JPEG", quality=FOTO_QUALITAET, optimize=True)
            return puffer.getvalue()
    except Exception:
        # ⚠️ Ein einzelnes unlesbares Foto darf nie den ganzen Umschlag
        # verhindern — die Tour ist wichtiger als ihr Vorschaubild.
        return None


def umschlag_bauen(conn, geo_hash: str, *, gpx_pfad: str | None = None,
                   projekte: dict | None = None,
                   zeile_ersatz: dict | None = None) -> bytes:
    """Alles, was zu einer Tour gehört, als ZIP im Speicher.

    `zeile_ersatz` (22.08.2026, Projekt-Export): Tour-Daten für eine Datei,
    die NICHT im Archiv steht (direkt geladen). Dann braucht es keine
    Datenbank-Zeile; `conn` darf None sein. Reiner Helfer — keine Cloud,
    kein Schlüssel, kein Netz."""
    zeile = None
    meta = None
    if conn is not None:
        zeile = conn.execute(
            "SELECT * FROM tracks WHERE geo_hash = ? LIMIT 1", (geo_hash,)).fetchone()
        if zeile is not None and "track_meta" in _tabellen(conn):
            meta = conn.execute("SELECT * FROM track_meta WHERE geo_hash = ? LIMIT 1",
                                (geo_hash,)).fetchone()
    if zeile is None:
        if zeile_ersatz is None:
            raise KeyError(f"Tour {geo_hash} steht nicht im Archiv.")
        zeile = dict(zeile_ersatz)
        zeile.setdefault("geo_hash", geo_hash)

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
        # sqlite3.Row hat keys()/[]; ein dict ebenso — beide Wege unten gleich
        # ⚠️ Ohne Datei KEIN Umschlag (22.08.2026, Audit): Eine abgesteckte
        # Platte hätte sonst für alle Touren dort GPX-lose Umschläge gebaut,
        # deren Prüfsumme abweicht — und die guten Cloud-Kopien überschrieben.
        if not quelle.is_file():
            raise FileNotFoundError(f"Tour {geo_hash}: Datei nicht erreichbar ({quelle})")
        schreiben("track.gpx", quelle.read_bytes())

        tour = {k: zeile[k] for k in zeile.keys() if k != "path"}
        if meta is not None:
            tour["meta"] = {k: meta[k] for k in meta.keys()}
        schreiben("tour.json", json.dumps(tour, ensure_ascii=False,
                                          sort_keys=True).encode("utf-8"))

        if projekte:
            kopie = _bilder_einpacken(schreiben, projekte)
            schreiben("projekte.json", json.dumps(kopie, ensure_ascii=False,
                                                  sort_keys=True).encode("utf-8"))
    return puffer.getvalue()


def _bilder_einpacken(schreiben, projekte: dict) -> dict:
    """Fotos/Schild-Bilder als Vorschauen ins ZIP; liefert die Kopie der
    Projekte, in der die Pfade durch die ZIP-Namen ersetzt sind (05.09.2026
    aus umschlag_bauen herausgelöst, damit der Mengen-Umschlag dasselbe tut)."""
    kopie = json.loads(json.dumps(projekte))
    nummern: dict = {}
    schon: dict = {}          # gleiche Datei nur einmal ins ZIP
    for proj in (kopie.get("projects") or {}).values():
        if not isinstance(proj, dict):
            continue
        for liste, feld, ordner, kante in BILD_FELDER:
            for eintrag in (proj.get(liste) or []):
                if not isinstance(eintrag, dict) or not eintrag.get(feld):
                    continue
                quelle_bild = str(eintrag[feld])
                if (ordner, quelle_bild) in schon:
                    eintrag["vorschau"] = schon[(ordner, quelle_bild)]
                    continue
                bild = _foto_vorschau(quelle_bild, kante)
                if bild is None:
                    eintrag["vorschau_fehlt"] = True
                    continue
                nummern[ordner] = nummern.get(ordner, 0) + 1
                name = f"{ordner}/{nummern[ordner]:04d}.jpg"
                schreiben(name, bild)
                eintrag["vorschau"] = name
                schon[(ordner, quelle_bild)] = name
    return kopie


def menge_umschlag_bauen(pfade: list, hashes: list, projekte: dict | None,
                         meta: dict) -> bytes:
    """Mehr-Touren-Projekt (Schwarm/Reise) als ZIP (05.09.2026, Audit).

    Bisher exportierte `projekt_exportieren` nur die Sitzung EINER Tour — ein
    Schwarm-Projekt lebt aber unter dem Kontext `menge:…` und ging verloren
    (Beta-Tester-Pakete kamen leer an). Aufbau:
      tracks/01.gpx … tracks/NN.gpx   alle Touren in Projekt-Reihenfolge
      menge.json                      names, geo_hashes, ablauf, schwarm_modus,
                                      schwarm_pausen, active_project_id
      projekte.json                   Sitzungs-Sicht des Mengen-Kontexts
      fotos/ bilder/                  Vorschauen wie beim Einzel-Umschlag
    Zusätzlich track.gpx + tour.json der ERSTEN Tour, damit ältere
    Programmstände das Paket wenigstens als Einzeltour öffnen können."""
    puffer = io.BytesIO()
    festes_datum = (1980, 1, 1, 0, 0, 0)
    with zipfile.ZipFile(puffer, "w", zipfile.ZIP_DEFLATED) as z:
        def schreiben(name: str, daten: bytes):
            info = zipfile.ZipInfo(name, date_time=festes_datum)
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, daten)
        namen = []
        for i, pfad in enumerate(pfade):
            q = Path(pfad)
            if not q.is_file():
                raise FileNotFoundError(f"Tour {i + 1}: Datei nicht erreichbar ({q})")
            roh = q.read_bytes()
            schreiben(f"tracks/{i + 1:02d}.gpx", roh)
            namen.append(q.name)
            if i == 0:
                schreiben("track.gpx", roh)
                schreiben("tour.json", json.dumps({"geo_hash": (hashes[0] if hashes else ""),
                                                   "name": q.stem, "filename": q.name,
                                                   "menge": True}, ensure_ascii=False,
                                                  sort_keys=True).encode("utf-8"))
        m = dict(meta or {})
        m.update({"version": 1, "names": namen, "geo_hashes": list(hashes or [])})
        schreiben("menge.json", json.dumps(m, ensure_ascii=False, sort_keys=True).encode("utf-8"))
        if projekte:
            kopie = _bilder_einpacken(schreiben, projekte)
            schreiben("projekte.json", json.dumps(kopie, ensure_ascii=False,
                                                  sort_keys=True).encode("utf-8"))
    return puffer.getvalue()


def json_bytes(d: dict) -> bytes:
    """Einheitlich serialisieren — sortiert, damit Prüfsummen stabil sind."""
    return json.dumps(d, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":")).encode("utf-8")
