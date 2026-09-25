#!/usr/bin/env python3
"""Testdaten für die Testumgebung bauen (25.09.2026).

Marc: „ich hätte gern ein testprotokoll für die ganze app, so dass ein unabhängiger
chat mit computer use sich durchklicken kann." Dieses Skript legt unter
<Testwurzel>/Quellen alles an, was das Protokoll (docs/TESTPROTOKOLL.md) braucht,
und schreibt je Datei die Soll-Werte dazu (Quellen/SOLL-WERTE.md + soll-werte.json).

Quellen ist die unveränderliche Vorlage. Getestet wird auf Kopien in <Testwurzel>/Arbeit,
die `scripts/testumgebung.sh zuruecksetzen` jedes Mal frisch hinlegt.

Aufruf:
    .venv/bin/python scripts/testdaten_bauen.py [--wurzel ~/GPS-Studio-Test] [--neu]

--neu legt eine vorhandene Quellen-Mappe erst nach <Testwurzel>/_alt/<Zeit>/ (nichts
wird gelöscht).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

FIX = ROOT / "tests" / "fixtures"
PRUEF = ROOT / "tests" / "pruefsammlung" / "dateien"
KOMOOT = Path("/Users/docarzt/Claude-Masterblaster/_daten/komoot-tracks")

# Die Teneriffa-Woche Februar 2026: fünf Touren an aufeinanderfolgenden Tagen
# (Reise, Schwarm, Web-Karte mit mehreren Tracks, Geotagger-Suche im Archiv).
TENERIFFA = ["2788827944", "2791782774", "2791796158", "2793044315", "2794475846"]   # Komoot-IDs
# Einziger Track mit Reisezoom-Logger-Erweiterungen (Blickrichtung, rz:hdg)
LOGGER = "962503252"


def komoot(kennung: str) -> Path:
    """Datei zu einer Komoot-ID — die Namen tragen Emojis, die sich nicht sicher abtippen lassen."""
    treffer = sorted(KOMOOT.glob(f"*-{kennung}.gpx"))
    if not treffer:
        raise FileNotFoundError(f"Komoot-Tour {kennung} fehlt in {KOMOOT}")
    return treffer[0]


# Fotos gehören zu Masca (05.05.2023) — dazu liefert Marc auch echte Fotos (Quellen/10-fotos/echt/).
# Im Mai gilt auf Teneriffa UTC+1; die Canon steht auf deutscher Sommerzeit (UTC+2).
FOTO_TOUR = "1106845751"
FOTO_ORT_H = 1        # Ortszeit = UTC+1
FOTO_CANON_H = 2      # Kamera-Uhr der Canon = UTC+2


def kopieren(quelle: Path, ziel: Path, name: str | None = None) -> Path:
    ziel.mkdir(parents=True, exist_ok=True)
    z = ziel / (name or quelle.name)
    shutil.copy2(quelle, z)
    return z


# ── Tracks ──────────────────────────────────────────────────────────────────

def formate(q: Path):
    d = q / "01-formate"
    for f in ("track_teide.gpx", "demo_bike_fenix5.fit", "demo_bike_edge820.fit", "demo_activity_nosensors.fit",
              "demo_ride_sensors.tcx", "demo_komoot.kml", "demo_route.kmz", "demo_track.geojson", "demo_track.nmea"):
        kopieren(FIX / f, d)


def fehlerfaelle(q: Path):
    d = q / "02-fehlerfaelle"
    d.mkdir(parents=True, exist_ok=True)
    (d / "leer.gpx").write_text('<?xml version="1.0"?>\n<gpx version="1.1" creator="test"></gpx>\n', encoding="utf-8")
    (d / "ein-punkt.gpx").write_text(
        '<?xml version="1.0"?>\n<gpx version="1.1" creator="test"><trk><trkseg>'
        '<trkpt lat="52.5" lon="13.4"><time>2026-01-01T10:00:00Z</time></trkpt>'
        '</trkseg></trk></gpx>\n', encoding="utf-8")
    (d / "kein-track.json").write_text('{"name": "keine Geodaten", "werte": [1, 2, 3]}\n', encoding="utf-8")
    (d / "abgeschnitten.gpx").write_text(
        (PRUEF / "track_teide.gpx").read_text(encoding="utf-8")[:4000], encoding="utf-8")
    (d / "kein-gpx.txt").write_text("Das ist einfach nur Text.\n", encoding="utf-8")


def touren(q: Path):
    d = q / "03-touren"
    for f in ("track_klein.gpx", "potsdam_probe.gpx", "track_teufelsmauer.gpx", "vilaflor_sombrero.gpx",
              "camino_etapa2.gpx", "zwei_etappen.gpx", "insta360_10hz.gpx"):
        kopieren(FIX / f, d)


def trackcheck(q: Path):
    d = q / "04-trackcheck"
    for f in sorted(PRUEF.iterdir()):
        if f.suffix in (".gpx", ".kml") and not f.name.startswith(("mischfall", "reise-", "unsicher-kurze")):
            kopieren(f, d)


def bewegung(q: Path):
    d = q / "05-bewegung"
    for f in ("mischfall-wanderung-mit-auto.gpx", "mischfall-lauf-mit-zug.gpx", "unsicher-kurze-faehre.gpx",
              "reise-womo-geory.gpx"):
        kopieren(PRUEF / f, d, "reise-5-wochen.gpx" if f.startswith("reise-") else None)


def tagesdateien(q: Path):
    """Drei aufeinanderfolgende Tage der großen Reise als einzelne Dateien — zum Verbinden."""
    import gpxpy
    import gpxpy.gpx
    d = q / "06-tagesdateien"
    d.mkdir(parents=True, exist_ok=True)
    g = gpxpy.parse((PRUEF / "reise-womo-geory.gpx").read_text(encoding="utf-8"))
    pts = [p for t in g.tracks for s in t.segments for p in s.points if p.time]
    tage: dict = {}
    for p in pts:
        tage.setdefault(p.time.date(), []).append(p)
    # die drei aufeinanderfolgenden Tage mit den meisten Punkten ab Tag 3
    folge = sorted(tage)
    beste = max(range(2, len(folge) - 3),
                key=lambda i: sum(len(tage[folge[i + k]]) for k in range(3))
                if all(folge[i + k] - folge[i] == dt.timedelta(days=k) for k in range(3)) else -1)
    for k in range(3):
        tag = folge[beste + k]
        neu = gpxpy.gpx.GPX()
        trk = gpxpy.gpx.GPXTrack(name=f"Reise Tag {k + 1} ({tag.isoformat()})")
        seg = gpxpy.gpx.GPXTrackSegment(points=tage[tag])
        trk.segments.append(seg)
        neu.tracks.append(trk)
        (d / f"reise-tag-{k + 1}-{tag.isoformat()}.gpx").write_text(neu.to_xml(), encoding="utf-8")


def doppelt(q: Path):
    d = q / "07-doppelt"
    kopieren(FIX / "track_teide.gpx", d, "Teide Original.gpx")
    kopieren(FIX / "track_teide.gpx", d, "Teide nochmal (anderer Name).gpx")


def teneriffa(q: Path):
    d = q / "08-teneriffa-woche"
    for f in TENERIFFA:
        kopieren(komoot(f), d)
    kopieren(komoot(LOGGER), q / "09-logger", "pico-viejo-mit-blickrichtung.gpx")
    kopieren(komoot(FOTO_TOUR), q / "03-touren")   # Masca: die Tour zu den Fotos


# ── Fotos ───────────────────────────────────────────────────────────────────

def _foto(pfad: Path, zeit: dt.datetime, marke: str, modell: str, farbe, text: str,
          gps: tuple | None = None, heic: bool = False, versatz: str = ""):
    from PIL import Image, ImageDraw, ImageFont
    import piexif
    img = Image.new("RGB", (1600, 1067), farbe)
    dr = ImageDraw.Draw(img)
    try:
        gross = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 72)
        klein = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 40)
    except OSError:
        gross = klein = ImageFont.load_default()
    dr.text((60, 60), text, font=gross, fill=(255, 255, 255))
    dr.text((60, 170), f"{marke} {modell} · {zeit:%Y-%m-%d %H:%M:%S}", font=klein, fill=(235, 235, 235))
    dr.text((60, 230), "TESTFOTO — GPS Studio Testumgebung", font=klein, fill=(255, 220, 120))
    s = zeit.strftime("%Y:%m:%d %H:%M:%S").encode()
    ex = {"0th": {piexif.ImageIFD.Make: marke.encode(), piexif.ImageIFD.Model: modell.encode(),
                  piexif.ImageIFD.DateTime: s},
          "Exif": {piexif.ExifIFD.DateTimeOriginal: s, piexif.ExifIFD.DateTimeDigitized: s},
          "GPS": {}, "1st": {}}
    if versatz:        # moderne Kamera: Zeitzone steht im Foto (OffsetTimeOriginal, Exif 2.31)
        ex["Exif"][piexif.ExifIFD.OffsetTimeOriginal] = versatz.encode()
    if gps:
        def dms(x):
            x = abs(x)
            g = int(x); m = int((x - g) * 60); sek = round(((x - g) * 60 - m) * 60 * 100)
            return ((g, 1), (m, 1), (sek, 100))
        la, lo = gps
        ex["GPS"] = {piexif.GPSIFD.GPSLatitudeRef: b"N" if la >= 0 else b"S", piexif.GPSIFD.GPSLatitude: dms(la),
                     piexif.GPSIFD.GPSLongitudeRef: b"E" if lo >= 0 else b"W", piexif.GPSIFD.GPSLongitude: dms(lo)}
    roh = piexif.dump(ex)
    if heic:
        import pillow_heif
        pillow_heif.register_heif_opener()
        img.save(pfad, format="HEIF", exif=roh, quality=80)
    else:
        img.save(pfad, "JPEG", quality=85, exif=roh)


def fotos(q: Path) -> dict:
    """Synthetische Fotos zur Tour Barranco de Masca (05.05.2023). EXIF-Zeiten sind
    Kamera-Uhrzeiten (naiv): Insta360/iPhone in Ortszeit UTC+1 MIT Zeitzonen-Feld, die
    Canon auf deutscher Sommerzeit UTC+2 OHNE Zeitzonen-Feld (alte Kamera, falsch gestellt)."""
    from core import gpx as G
    pts, _ = G.parse_gpx(str(komoot(FOTO_TOUR)))
    t0 = dt.datetime.fromisoformat(pts[0].time.replace("Z", "+00:00")).replace(tzinfo=None)
    t1 = dt.datetime.fromisoformat(pts[-1].time.replace("Z", "+00:00")).replace(tzinfo=None)
    dauer = (t1 - t0).total_seconds()
    ort, canon = dt.timedelta(hours=FOTO_ORT_H), dt.timedelta(hours=FOTO_CANON_H)
    vz = f"+{FOTO_ORT_H:02d}:00"
    d = q / "10-fotos" / "geotagger"
    d.mkdir(parents=True, exist_ok=True)
    liste = []

    def bei(anteil: float) -> dt.datetime:
        return (t0 + dt.timedelta(seconds=dauer * anteil)).replace(microsecond=0)

    def neu(name, zeit, marke, modell, farbe, text, **kw):
        _foto(d / name, zeit, marke, modell, farbe, text, **kw)
        liste.append({"datei": name, "zeit_exif": zeit.isoformat(), "zeitzone_im_foto": kw.get("versatz") or "—",
                      "kamera": f"{marke} {modell}", **{k: v for k, v in kw.items() if k in ("gps",)}, "text": text})

    for i in range(6):     # Kamera A: Ortszeit, Zeitzone im Foto
        neu(f"A_{i + 1:02d}.jpg", bei(0.08 + 0.16 * i) + ort, "Insta360", "X5", (40, 90 + 20 * i, 140),
            f"Kamera A · Foto {i + 1}", versatz=vz)
    for i in range(4):     # Kamera B: deutsche Sommerzeit, ohne Zeitzone
        neu(f"B_{i + 1:02d}.jpg", bei(0.15 + 0.2 * i) + canon, "Canon", "EOS R6", (150, 60, 40 + 25 * i),
            f"Kamera B (UTC+2, ohne Zone) · Foto {i + 1}")
    for i in range(3):     # drei Fotos in derselben Minute → Auffächern
        neu(f"C_gleiche_minute_{i + 1}.jpg", bei(0.5) + ort + dt.timedelta(seconds=10 * i), "Insta360", "X5",
            (90, 40, 120), f"Gleiche Minute · {i + 1}", versatz=vz)
    neu("D_nach_tourende.jpg", (t1 + dt.timedelta(hours=2)).replace(microsecond=0) + ort, "Insta360", "X5",
        (60, 60, 60), "2 h nach Tourende", versatz=vz)
    p = pts[len(pts) // 3]
    neu("E_hat_schon_gps.jpg", bei(1 / 3) + ort, "Apple", "iPhone 17 Pro", (30, 120, 60), "Hat schon GPS",
        gps=(p.lat, p.lon), versatz=vz)
    neu("F_heic.heic", bei(0.7) + ort, "Apple", "iPhone 17 Pro", (20, 100, 160), "HEIC-Foto", heic=True, versatz=vz)
    zv = bei(0.6)          # Video: QuickTime speichert UTC
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=teal:s=640x360:d=3",
                    "-metadata", f"creation_time={zv.isoformat()}Z", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                    str(d / "G_video.mp4")], check=True)
    liste.append({"datei": "G_video.mp4", "zeit_exif": zv.isoformat() + "Z", "zeitzone_im_foto": "UTC",
                  "kamera": "Video", "text": "3-s-Video"})

    # Foto-Bestand: Unterordner + ein Duplikat
    b = q / "10-fotos" / "bestand"
    for sub, namen in (("2023-05 Teneriffa/Masca Vormittag", ["A_01.jpg", "A_02.jpg", "A_03.jpg"]),
                       ("2023-05 Teneriffa/Masca Nachmittag", ["A_04.jpg", "B_01.jpg", "C_gleiche_minute_1.jpg"]),
                       ("Sonstiges", ["E_hat_schon_gps.jpg", "F_heic.heic"])):
        for n in namen:
            kopieren(d / n, b / sub)
    kopieren(d / "A_01.jpg", b / "Sonstiges", "A_01 Kopie.jpg")
    return {"tour": komoot(FOTO_TOUR).name, "tour_start_utc": t0.isoformat(), "tour_ende_utc": t1.isoformat(),
            "ortszeit": f"UTC+{FOTO_ORT_H}", "fotos": liste}


def echte_fotos(q: Path, wurzel: Path) -> dict:
    """Marcs echte Masca-Fotos (Rohmaterial/masca-fotos, einmal vom Schreibtisch kopiert).

    Befund 25.09.2026: Die Canon G5 X II lief auf Ortszeit (UTC+1), schreibt aber die Zeitzone
    +02:00 ins Foto. Die vorhandenen Lightroom-Positionen passen mit UTC+1 (Median ~23 m) —
    sie sind das Soll. Der Geotagger bekommt Kopien OHNE GPS (echt-ohne-gps), der Foto-Bestand
    die Originale (echt-mit-gps)."""
    roh = wurzel / "Rohmaterial" / "masca-fotos"
    if not roh.is_dir() or not any(roh.glob("*.jpg")):
        print("  (keine echten Fotos in", roh, "— übersprungen)")
        return {}
    mit, ohne = q / "10-fotos" / "echt-mit-gps", q / "10-fotos" / "echt-ohne-gps"
    for d in (mit, ohne):
        d.mkdir(parents=True, exist_ok=True)
    for f in sorted(roh.glob("*.jpg")):
        kopieren(f, mit)
        kopieren(f, ohne)
    subprocess.run(["exiftool", "-q", "-overwrite_original", "-gps:all=", "-xmp:GPSLatitude=", "-xmp:GPSLongitude=",
                    str(ohne)], check=True)
    r = subprocess.run(["exiftool", "-q", "-json", "-n", "-Model", "-DateTimeOriginal", "-OffsetTimeOriginal",
                        "-GPSLatitude", "-GPSLongitude", str(mit)], capture_output=True, text=True, check=True)
    soll = {Path(x["SourceFile"]).name: {"kamera": x.get("Model", ""), "zeit": x.get("DateTimeOriginal", ""),
                                         "zeitzone_im_foto": x.get("OffsetTimeOriginal", ""),
                                         "lat": x.get("GPSLatitude"), "lon": x.get("GPSLongitude")}
            for x in json.loads(r.stdout)}
    (q / "10-fotos" / "echt-soll-positionen.json").write_text(json.dumps(soll, ensure_ascii=False, indent=1),
                                                             encoding="utf-8")
    rest = subprocess.run(["exiftool", "-q", "-json", "-GPSLatitude", "-GPSLongitude", str(ohne)],
                          capture_output=True, text=True).stdout
    if any("GPSLatitude" in x or "GPSLongitude" in x for x in json.loads(rest or "[]")):
        raise SystemExit("GPS in echt-ohne-gps nicht vollständig entfernt — Abbruch")
    return soll


def sonstiges(q: Path):
    d = q / "11-reiseroute"
    d.mkdir(parents=True, exist_ok=True)
    (d / "stationen.txt").write_text(
        "Reiseroute — Stationen zum Eintippen (eine je Zeile):\n"
        "Berlin Hauptbahnhof\nWernigerode, Marktplatz\nSchierke\n", encoding="utf-8")


# ── Soll-Werte ──────────────────────────────────────────────────────────────

def soll_werte(q: Path, foto_info: dict) -> None:
    from core import library as L, trackcheck as TC, einteilung as E, logbuch as LB
    from core import dateischutz as DS
    cache = DS.temp_ordner("rz-soll-")   # eigener Temp-Ordner: dort darf die Umwandlung aufräumen
    zeilen, alle = [], {}
    for f in sorted(q.rglob("*")):
        if not f.is_file() or f.suffix.lower() not in (".gpx", ".fit", ".tcx", ".kml", ".kmz", ".geojson", ".nmea"):
            continue
        rel = str(f.relative_to(q))
        w = {"datei": rel}
        try:
            pts, st = L.punkte_lesen(str(f), cache)
            pts = list(pts)
            w.update({"punkte": len(pts), "strecke_km": round(st.distance_m / 1000, 2),
                      "dauer": _hms(st.duration_s), "bewegungszeit": _hms(st.moving_time_s),
                      "bergauf_m": round(st.ascent_m), "bergab_m": round(st.descent_m),
                      "start": pts[0].time if pts else None, "ende": pts[-1].time if pts else None})
            if len(pts) >= 2:
                r = TC.pruefen(pts, local_time_n=int(getattr(st, "zeit_ohne_zone", 0) or 0))
                w["check_stufe"] = r["hoechste"] or "—"
                w["check_kurz"] = TC.kurz(r["befunde"]) or "—"
            if f.parent.name in ("05-bewegung", "06-tagesdateien", "08-teneriffa-woche") and pts and pts[0].time:
                ber = E.berechnen_bewegung(pts)
                dicts = [{"lat": p.lat, "lon": p.lon, "ele": p.ele, "time": p.time} for p in pts]
                lb = LB.eintraege(ber, dicts)
                zaehl: dict = {}
                for e in lb["eintraege"]:
                    zaehl[e.get("anzeige_art") or e["art"]] = zaehl.get(e.get("anzeige_art") or e["art"], 0) + 1
                w["logbuch"] = dict(sorted(zaehl.items(), key=lambda kv: -kv[1]))
        except Exception as e:  # noqa: BLE001 — Fehlerfälle sollen genau hier auffallen
            w["fehler"] = f"{type(e).__name__}: {e}"[:160]
        alle[rel] = w
    (q / "soll-werte.json").write_text(json.dumps({"tracks": alle, "fotos": foto_info}, ensure_ascii=False, indent=2),
                                       encoding="utf-8")
    zeilen.append("# Soll-Werte der Testdaten\n")
    zeilen.append(f"Erzeugt am {dt.datetime.now():%d.%m.%Y %H:%M} von `scripts/testdaten_bauen.py` mit dem Code-Stand der App.")
    zeilen.append("Sie belegen, dass die Oberfläche dasselbe zeigt wie der Rechenkern — nicht, dass der Rechenkern recht hat.")
    zeilen.append("Toleranz: Strecke ±1 %, Zeiten ±1 min, Höhenmeter ±5 %.\n")
    zeilen.append("| Datei | Punkte | Strecke km | Dauer | Bewegt | ↑ m | Track-Check | Logbuch |")
    zeilen.append("|---|---|---|---|---|---|---|---|")
    for rel, w in alle.items():
        if "fehler" in w:
            zeilen.append(f"| `{rel}` | — | — | — | — | — | Lesefehler: {w['fehler']} | |")
            continue
        lbt = ", ".join(f"{k} {v}" for k, v in (w.get("logbuch") or {}).items())
        zeilen.append(f"| `{rel}` | {w['punkte']} | {w['strecke_km']} | {w['dauer']} | {w['bewegungszeit']} | "
                      f"{w['bergauf_m']} | {w.get('check_stufe', '—')} {w.get('check_kurz', '')} | {lbt} |")
    zeilen.append("\n## Fotos (10-fotos/geotagger)\n")
    zeilen.append(f"Tour: `{foto_info['tour']}` — {foto_info['tour_start_utc']} bis {foto_info['tour_ende_utc']} UTC "
                  f"(Ortszeit {foto_info['ortszeit']}).\n")
    zeilen.append("| Datei | Kamera | Aufnahmezeit (EXIF, Kamera-Uhr) | Zeitzone im Foto | Erwartung |")
    zeilen.append("|---|---|---|---|---|")
    erw = {"A_": "liegt sofort auf dem Track", "B_": "ohne Zeitzone, Uhr auf UTC+2 → erst mit Kamera-Zeitzone UTC+2 "
           "(Vorschlag „Aus dem Track gerechnet\") auf dem Track", "C_": "drei am selben Punkt → auffächern",
           "D_": "außerhalb der Tourzeit → keine/unsichere Position", "E_": "hat schon GPS → wird nicht verschoben",
           "F_": "HEIC wird gelesen und liegt auf dem Track", "G_": "Video (Zeit in UTC) liegt auf dem Track"}
    for x in foto_info["fotos"]:
        zeilen.append(f"| `{x['datei']}` | {x['kamera']} | {x['zeit_exif']} | {x['zeitzone_im_foto']} | "
                      f"{erw.get(x['datei'][:2], '')} |")
    echt = foto_info.get("echt") or {}
    if echt:
        from collections import Counter
        zaehl = Counter((v["kamera"], v["zeitzone_im_foto"]) for v in echt.values())
        zeilen.append("\n## Echte Fotos (10-fotos/echt-ohne-gps, echt-mit-gps)\n")
        zeilen.append(f"{len(echt)} Fotos von Marc, Masca 05.05.2023. Soll-Positionen (aus Lightroom) in "
                      "`10-fotos/echt-soll-positionen.json`; vergleichen mit "
                      "`.venv/bin/python scripts/testumgebung_fotovergleich.py <Ordner mit getaggten Fotos>`.\n")
        zeilen.append("| Kamera | Zeitzone im Foto | Anzahl | Erwartung |")
        zeilen.append("|---|---|---|---|")
        for (kam, zz), n in zaehl.most_common():
            erw = ("Uhr lief auf Ortszeit UTC+1, das Foto behauptet +02:00 → landet ~1 h daneben, bis die Kamera "
                   "mit Offset +1 h korrigiert wird (Kamera-Knopf Canon, Regler oder Referenzfoto); danach Median < 50 m "
                   "zum Soll (gemessen mit dem Rechenkern: 1,7 km → 17 m)") if zz == "+02:00" else \
                  "Zeitzone stimmt → liegt sofort auf dem Track, Median < 50 m zum Soll"
            zeilen.append(f"| {kam} | {zz or '—'} | {n} | {erw} |")
    (q / "SOLL-WERTE.md").write_text("\n".join(zeilen) + "\n", encoding="utf-8")


def _hms(s) -> str:
    s = int(round(float(s or 0)))
    return f"{s // 3600}:{s % 3600 // 60:02d}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--wurzel", default=str(Path.home() / "GPS-Studio-Test"))
    ap.add_argument("--neu", action="store_true")
    a = ap.parse_args()
    wurzel = Path(a.wurzel).expanduser()
    q = wurzel / "Quellen"
    if q.exists():
        if not a.neu:
            sys.exit(f"{q} gibt es schon — mit --neu wird es nach _alt/ gelegt und neu gebaut.")
        alt = wurzel / "_alt" / dt.datetime.now().strftime("%Y%m%d-%H%M%S")
        alt.mkdir(parents=True)
        shutil.move(str(q), str(alt / "Quellen"))
        print("alte Quellen →", alt)
    q.mkdir(parents=True)
    for schritt in (formate, fehlerfaelle, touren, trackcheck, bewegung, tagesdateien, doppelt, teneriffa):
        schritt(q)
        print("✓", schritt.__name__)
    fi = fotos(q)
    fi["echt"] = echte_fotos(q, wurzel)
    print("✓ fotos", f"(echt: {len(fi['echt'])})")
    sonstiges(q)
    soll_werte(q, fi)
    print("✓ soll-werte →", q / "SOLL-WERTE.md")


if __name__ == "__main__":
    main()
