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

import hashlib
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
MENGE_PRAEFIX = "menge/"   # IDEAS §38 M5 — Kompositionen (Reise/Schwarm) am Mengen-Hash


def menge_name(mengen_hex: str) -> str:
    """Cloud-Name einer Komposition. `mengen_hex` OHNE das Sitzungs-Präfix
    `menge:` — der Doppelpunkt wäre im logischen Namen nur Stolperdraht."""
    return MENGE_PRAEFIX + mengen_hex


def mengen_bauen(sessions: dict | None) -> dict:
    """Alle Mengen-Sitzungen (Reise/Schwarm, IDEAS §38) als Cloud-Objekte.

    Bewusst OHNE `gpx_paths`: Wo die Dateien auf DIESEM Rechner liegen, geht
    kein anderes Gerät etwas an. Die Identität der Touren sind ihre
    `geo_hashes` — die Touren selbst reisen als track/-Umschläge mit, und das
    Zielgerät baut die Pfade aus seinem eigenen Archiv neu.

    Sitzungen ohne `geo_hashes` (Altbestand vor M5) werden übersprungen — das
    Feld wird beim nächsten Öffnen im Archiv nachgetragen.
    """
    raus = {}
    for schluessel, sess in ((sessions or {}).get("sessions") or {}).items():
        if not isinstance(schluessel, str) or not schluessel.startswith("menge:"):
            continue
        if not isinstance(sess, dict):
            continue
        ghs = sess.get("geo_hashes") or []
        if len(ghs) < 2:
            continue
        mh = schluessel.split(":", 1)[1]
        raus[mh] = {
            "schema": 1,
            "name": sess.get("name") or "",
            "ablauf": sess.get("ablauf") or "reise",
            "geo_hashes": sorted(set(ghs)),
            "active_project_id": sess.get("active_project_id") or "",
            "projects": sess.get("projects") or {},
        }
    return raus


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
    # IDEAS §38 M5 — Kompositionen: mengen_hex → Prüfsumme, Objekte fürs Hochladen
    mengen: dict[str, str] = field(default_factory=dict)
    mengen_objekte: dict[str, bytes] = field(default_factory=dict)
    neu_gebaut: int = 0     # wie viele Umschläge wirklich gebaut wurden (Diagnose)


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
    # `merged` kam erst am 23.08.2026 dazu — der Sync darf an einer älteren
    # Datenbank (oder einem schlanken Test-Schema) nicht sterben.
    if any(z[1] == "merged" for z in conn.execute("PRAGMA table_info(tracks)")):
        spalten += ", t.merged"
    verbund = ""
    if "track_meta" in hat:
        spalten += """, m.fav, m.tags, m.note, m.cover, m.display_name, m.hidden,
                      m.activity_user, m.color, m.recorded_user"""
        verbund = " LEFT JOIN track_meta m ON m.geo_hash = t.geo_hash"
    touren = {}
    for zeile in conn.execute(
            f"SELECT {spalten} FROM tracks t{verbund}"
            " WHERE t.geo_hash IS NOT NULL AND t.geo_hash <> ''"):
        d = {k: zeile[k] for k in zeile.keys()}
        gh = d.pop("geo_hash")
        # 23.08.2026 — merged (zusammengeführte Mehr-Touren-Tracks) muss mit,
        # sonst zählt so ein Track auf Gerät 2 doppelt in die Statistik.
        # Nur wenn gesetzt, damit die Verzeichnis-Prüfsumme für die vielen
        # normalen Touren unverändert bleibt.
        touren[gh] = {k: v for k, v in d.items()
                      if v is not None and not (k == "merged" and not v)}
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

# Schild-Bilder (22.08.2026, Marc: „mit rein"): größer als Foto-Vorschauen,
# weil sie im Video stehen — 1600 px reichen auch für 4K-Schilder.
BILD_KANTE = 1600

# Welche Projektfelder auf Bilddateien zeigen: (Liste im Projekt, Pfadfeld,
# ZIP-Ordner, Kantenlänge). `vorschau` im Eintrag nennt die Datei im ZIP;
# der Einspieler (app._umschlag_einspielen) biegt das Pfadfeld darauf um.
BILD_FELDER = (
    ("photos", "path", "fotos", FOTO_KANTE),
    ("signs", "imageSrc", "bilder", BILD_KANTE),
    ("tourmap_signs", "imageSrc", "bilder", BILD_KANTE),
)


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
            # Fotos: nur Vorschaubilder, nie Originale. Der Pfad wird durch den
            # Namen im ZIP ersetzt, damit Gerät 2 nichts sucht, was es nicht gibt.
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
            schreiben("projekte.json", json.dumps(kopie, ensure_ascii=False,
                                                  sort_keys=True).encode("utf-8"))
    return puffer.getvalue()


# ══════════════════════════════════════════════════════════════════════════
#  Was hat sich geändert?
# ══════════════════════════════════════════════════════════════════════════

def _umschlag_stempel(conn, geo_hash: str, projekte: dict | None) -> str | None:
    """Fingerabdruck der EINGABEN eines Umschlags, ohne ihn zu bauen.

    22.08.2026 — `bestand_aufnehmen` baute für JEDE Tour das komplette ZIP
    (GPX lesen, deflaten, Foto-Vorschauen rechnen), nur um die Prüfsumme zu
    kennen — alle 20 s im Wächter, bei 700 Touren Sekunden bis Minuten. Der
    Stempel fasst zusammen, wovon der Umschlag abhängt: Datei (Pfad, Größe,
    mtime), Archivzeile + Meta, Projekte (Text) und die Foto-Dateien der
    Projekte (Pfad, Größe, mtime). Gleicher Stempel ⇒ gleiches ZIP ⇒ gleiche
    Prüfsumme — das ZIP ist deterministisch (festes Datum). Die Server-
    Prüfsummen bleiben damit unverändert gültig, nichts wird neu hochgeladen.
    None, wenn die Datei nicht erreichbar ist (dann auch kein Umschlag)."""
    zeile = conn.execute(
        "SELECT * FROM tracks WHERE geo_hash = ? LIMIT 1", (geo_hash,)).fetchone()
    if zeile is None:
        return None
    quelle = Path(zeile["path"])
    try:
        st = quelle.stat()
    except OSError:
        return None
    if not quelle.is_file():
        return None
    meta = (conn.execute("SELECT * FROM track_meta WHERE geo_hash = ? LIMIT 1",
                         (geo_hash,)).fetchone()
            if "track_meta" in _tabellen(conn) else None)
    teile = [str(quelle), str(st.st_size), str(st.st_mtime_ns),
             json.dumps({k: zeile[k] for k in zeile.keys()}, sort_keys=True, default=str),
             json.dumps({k: meta[k] for k in meta.keys()}, sort_keys=True, default=str) if meta is not None else ""]
    if projekte:
        teile.append(json.dumps(projekte, sort_keys=True, ensure_ascii=False, default=str))
        for proj in (projekte.get("projects") or {}).values():
            for foto in (proj.get("photos") or []):
                pf = foto.get("path") if isinstance(foto, dict) else None
                if not pf:
                    continue
                try:
                    fs = Path(pf).stat()
                    teile.append(f"{pf}|{fs.st_size}|{fs.st_mtime_ns}")
                except OSError:
                    teile.append(f"{pf}|fehlt")
    return hashlib.sha256("\n".join(teile).encode("utf-8")).hexdigest()


def pruefsummen_cache_laden(pfad) -> dict:
    try:
        d = json.loads(Path(pfad).read_text("utf-8"))
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def pruefsummen_cache_schreiben(pfad, cache: dict) -> None:
    try:
        p = Path(pfad)
        tmp = p.with_suffix(p.suffix + ".tmp")
        tmp.write_text(json.dumps(cache, separators=(",", ":")), "utf-8")
        tmp.replace(p)
    except Exception:
        pass


def bestand_aufnehmen(conn, sessions: dict | None = None,
                      cache_pfad=None) -> Bestand:
    """Prüfsummen von allem, was hochgehört — ohne schon etwas zu übertragen.

    `cache_pfad` (22.08.2026): JSON-Datei geo_hash → {stempel, pruef}. Touren,
    deren Eingaben sich nicht geändert haben, werden nicht mehr als ZIP gebaut
    (siehe `_umschlag_stempel`)."""
    verzeichnis = verzeichnis_bauen(conn)
    sammlungen = sammlungen_bauen(conn)
    b = Bestand(verzeichnis=verzeichnis, sammlungen=sammlungen)
    # IDEAS §38 M5 — Kompositionen mitnehmen. Klein genug, um sie jedes Mal zu
    # bauen; ob hochgeladen wird, entscheidet die Prüfsumme im Abgleich. Die
    # Kurzinfos landen im Verzeichnis, damit das Zielgerät sie OHNE die
    # einzelnen Objekte auflisten kann.
    for mh, obj in mengen_bauen(sessions).items():
        by = json_bytes(obj)
        b.mengen[mh] = crypto.inhalts_pruefsumme(by)
        b.mengen_objekte[mh] = by
        verzeichnis.setdefault("mengen", {})[mh] = {
            "name": obj["name"], "ablauf": obj["ablauf"],
            "n_tours": len(obj["geo_hashes"]),
        }
    cache = pruefsummen_cache_laden(cache_pfad) if cache_pfad else {}
    neu_cache: dict = {}
    gebaut = 0
    for gh in list(verzeichnis["touren"]):
        projekte = _projekte_fuer(conn, gh, sessions)
        stempel = _umschlag_stempel(conn, gh, projekte) if cache_pfad else None
        if stempel is not None:
            alt = cache.get(gh)
            if isinstance(alt, dict) and alt.get("stempel") == stempel and alt.get("pruef"):
                b.touren[gh] = alt["pruef"]
                neu_cache[gh] = alt
                continue
        try:
            inhalt = umschlag_bauen(conn, gh, projekte=projekte)
        except FileNotFoundError:
            # Datei gerade nicht da (externe Platte, Netzlaufwerk): Tour aus
            # dem Bestand lassen → bleibt oben unverändert liegen, statt als
            # leerer Umschlag hochzugehen. Auch NICHT aus dem Verzeichnis
            # werfen — sonst würde sie als „lokal unbekannt" gelten.
            continue
        gebaut += 1
        b.touren[gh] = crypto.inhalts_pruefsumme(inhalt)
        if stempel is not None:
            neu_cache[gh] = {"stempel": stempel, "pruef": b.touren[gh]}
    if cache_pfad and (gebaut or len(neu_cache) != len(cache)):
        pruefsummen_cache_schreiben(cache_pfad, neu_cache)
    b.neu_gebaut = gebaut
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
