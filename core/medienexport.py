"""Fotos und Clips aus dem Archiv exportieren (08.10.2026).

Marc: „Bilder aus dem Archiv exportieren geht auch nicht, oder? Nur in Finder anzeigen.“ — Jetzt: markierte Medien (oder
alle einer Tour) in einen Ordner, als Original-Kopie oder verkleinert als JPEG, auf Wunsch ohne Ort- und Kameradaten (zum
Teilen), Dateiname wie das Original oder „Datum_Uhrzeit_Ort“. **Die Originale werden nie angefasst** — gelesen, kopiert,
nie verändert. Videos gehen immer als Original-Kopie.
"""
from __future__ import annotations

import io
import logging
import os
import re
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Optional

log = logging.getLogger(__name__)

ARTEN = ("original", "jpeg")
NAMEN = ("original", "datum_ort")


def _sauber(s: str) -> str:
    s = re.sub(r"[^\w\-. ]+", "_", str(s or ""), flags=re.UNICODE).strip(" ._")
    return re.sub(r"\s+", " ", s)[:80]


def zielname(pfad: str, zeile: Optional[dict], namen: str, endung: str) -> str:
    """Dateiname im Zielordner (ohne Pfad). `datum_ort`: 2023-05-05_0742_Masca (Lokalzeit der Aufnahme), sonst der
    Originalname — immer mit der Endung des Ergebnisses."""
    stamm = Path(pfad).stem
    if namen == "datum_ort" and zeile and zeile.get("aufnahme_utc") is not None:
        try:
            tz = timezone(timedelta(minutes=int(zeile.get("tz_minuten") or 0)))
            t = datetime.fromtimestamp(float(zeile["aufnahme_utc"]), tz)
            ort = zeile.get("ort") or zeile.get("tour") or zeile.get("region") or ""
            stamm = t.strftime("%Y-%m-%d_%H%M%S") + (("_" + _sauber(ort)) if ort else "")
        except (TypeError, ValueError, OverflowError):
            pass
    return _sauber(stamm) + endung


def frei(ordner: Path, name: str) -> Path:
    """Nie überschreiben: x.jpg → x-2.jpg, x-3.jpg …"""
    p = ordner / name
    if not p.exists():
        return p
    stamm, endung = os.path.splitext(name)
    for n in range(2, 10000):
        q = ordner / f"{stamm}-{n}{endung}"
        if not q.exists():
            return q
    raise OSError("kein freier Name")


def _oeffnen(pfad: str):
    """Ein Bild für Pillow — JPEG/PNG/TIFF direkt, HEIC über pillow-heif, RAW über die eingebettete Vorschau."""
    from PIL import Image
    from core import exif as cexif
    if cexif.is_heif(pfad):
        try:
            from pillow_heif import register_heif_opener
            register_heif_opener()
        except Exception:  # noqa: BLE001
            pass
        return Image.open(pfad)
    if cexif.is_raw(pfad):
        from core import entwickeln as cent      # 09.10.2026 — RAW über LibRaw in voller Größe, sonst Vorschau
        entw = cent.raw_entwickelt(pfad, halb=False)
        if entw is not None:
            return entw
        prev = cexif.extract_raw_preview(pfad)
        if not prev:
            raise ValueError("RAW ohne Vorschau")
        return Image.open(io.BytesIO(prev))
    return Image.open(pfad)


def verkleinert_jpeg(pfad: str, kante: int, qualitaet: int, ohne_meta: bool, rezept: Optional[dict] = None) -> bytes:
    """JPEG mit längster Kante ≤ `kante` (0 = volle Größe), richtig gedreht. Mit Metadaten: EXIF bleibt, die Drehung
    steht danach auf „normal“ (das Bild ist schon gedreht)."""
    from PIL import Image, ImageOps
    img = _oeffnen(pfad)
    exif = img.info.get("exif") if not ohne_meta else None
    icc = img.info.get("icc_profile")   # draft/thumbnail/transpose können `info` verlieren
    if kante and kante > 0:
        try:
            img.draft("RGB", (kante, kante))
        except Exception:  # noqa: BLE001
            pass
        img.thumbnail((kante, kante), Image.LANCZOS)
    img = ImageOps.exif_transpose(img)
    if img.mode != "RGB":
        img = img.convert("RGB")
    if rezept:   # 09.10.2026 — Bearbeitung (Rezept aus der Bibliothek) einrechnen
        from core import entwickeln as cent
        img = cent.anwenden(img, cent.wirksam(rezept, img))
    if exif:
        try:
            import piexif
            d = piexif.load(exif)
            d.get("0th", {})[piexif.ImageIFD.Orientation] = 1
            d.pop("thumbnail", None); d["1st"] = {}
            exif = piexif.dump(d)
        except Exception:  # noqa: BLE001 — lieber ohne EXIF als mit falscher Drehung
            exif = None
    buf = io.BytesIO()
    kw = {"quality": max(40, min(100, int(qualitaet or 90))), "optimize": True}
    if exif:
        kw["exif"] = exif
    # Farbprofil mitnehmen (iPhone/HEIC = Display P3, Adobe RGB) — sonst kommen die Farben verschoben und blass an.
    # Ort und Kameradaten stehen nie darin, es bleibt darum auch „ohne Metadaten“.
    if img.info.get("icc_profile") or icc:
        kw["icc_profile"] = img.info.get("icc_profile") or icc
    if ohne_meta:
        kw["comment"] = b""   # Pillow übernimmt den JPEG-Kommentar sonst von selbst (darin steht oft der Ort)
    img.save(buf, "JPEG", **kw)   # XMP/IPTC schreibt Pillow nur auf Zuruf — hier nie
    return buf.getvalue()


# JPEG-Abschnitte, die beim Export „ohne Metadaten“ wegfallen: APP1 (EXIF mit GPS, XMP mit Ort/Seriennummer),
# APP13 (IPTC/Photoshop: Stadt, Land, Stichworte), APP12 (Ducky/Kamera-Infos), COM (Kommentar). Es bleiben APP0 (JFIF),
# APP2 (Farbprofil), APP14 (Adobe-Farbkennung — ohne sie kippen CMYK/YCCK-JPEGs in den Farben) und die Bilddaten.
_WEG = {0xE1, 0xED, 0xEC, 0xFE}


def jpeg_ohne_metadaten(daten: bytes) -> bytes:
    """Metadaten-Abschnitte aus einem JPEG schneiden — die Bilddaten bleiben Byte für Byte."""
    if daten[:2] != b"\xff\xd8":
        raise ValueError("kein JPEG")
    raus = bytearray(b"\xff\xd8")
    i = 2
    while i + 4 <= len(daten):
        if daten[i] != 0xFF:
            raise ValueError("JPEG-Abschnitt kaputt")
        m = daten[i + 1]
        if m == 0xFF:            # Füllbyte
            i += 1; continue
        if m == 0xDA:            # Start of Scan: ab hier Bilddaten bis zum Ende
            raus += daten[i:]
            return bytes(raus)
        if 0xD0 <= m <= 0xD7 or m == 0x01:
            raus += daten[i:i + 2]; i += 2; continue
        laenge = int.from_bytes(daten[i + 2:i + 4], "big")
        if laenge < 2 or i + 2 + laenge > len(daten):
            raise ValueError("JPEG-Abschnitt kaputt")
        if m not in _WEG:
            raus += daten[i:i + 2 + laenge]
        i += 2 + laenge
    raise ValueError("JPEG ohne Bilddaten")


def _ausrichtung(daten: bytes) -> int:
    try:
        import piexif
        return int(piexif.load(daten).get("0th", {}).get(piexif.ImageIFD.Orientation, 1) or 1)
    except Exception:  # noqa: BLE001
        return 1


def ohne_metadaten_jpeg(quelle: str, qualitaet: int = 95) -> bytes:
    """Original-JPEG ohne Ort und Kameradaten (EXIF, XMP, IPTC) — verlustfrei. Steht die Drehung nur im EXIF
    (Hochformat vom Handy), wird das Bild einmal gedreht neu gespeichert; ohne EXIF läge es sonst quer."""
    daten = Path(quelle).read_bytes()
    if _ausrichtung(daten) != 1:
        return verkleinert_jpeg(quelle, 0, qualitaet, True)
    return jpeg_ohne_metadaten(daten)


def exportieren(pfade: list, ziel: str, art: str = "original", kante: int = 2048, qualitaet: int = 90,
                ohne_meta: bool = False, namen: str = "original", zeilen: Optional[dict] = None,
                schreiben: Optional[Callable[[Path, bytes], None]] = None,
                kopieren: Optional[Callable[[str, Path], None]] = None,
                fortschritt: Optional[Callable[[int, int, str], None]] = None,
                stopp: Optional[Callable[[], bool]] = None, rezepte: Optional[dict] = None) -> dict:
    """Medien nach `ziel` exportieren. `schreiben`/`kopieren` kommen aus der App (Dateischutz: nur in den gewählten
    Ordner); Standard sind einfache Datei-Operationen (Tests). Rückgabe: Zahlen und je Datei der Grund, falls nicht."""
    from core import exif as cexif
    art = art if art in ARTEN else "original"
    namen = namen if namen in NAMEN else "original"
    zeilen = zeilen or {}
    ordner = Path(ziel)
    ordner.mkdir(parents=True, exist_ok=True)
    schreiben = schreiben or (lambda p, b: p.write_bytes(b))
    kopieren = kopieren or (lambda q, p: shutil.copy2(q, p))
    ok, fehler, uebersprungen = 0, [], 0
    for i, q in enumerate(pfade):
        if stopp and stopp():
            break
        if fortschritt:
            fortschritt(i, len(pfade), os.path.basename(q))
        try:
            if not os.path.isfile(q):
                fehler.append({"pfad": q, "grund": "nicht_da"}); continue
            video = cexif.is_video(q)
            jpeg_quelle = cexif.is_jpeg_like(q) and Path(q).suffix.lower() in (".jpg", ".jpeg")
            rz = (rezepte or {}).get(q) if not video else None
            if rz and art == "original":
                # bearbeitet: das Original wäre unbearbeitet — also volle Größe, entwickelt, als JPEG
                ziel_p = frei(ordner, zielname(q, zeilen.get(q), namen, ".jpg"))
                schreiben(ziel_p, verkleinert_jpeg(q, 0, max(int(qualitaet or 90), 92), ohne_meta, rz))
            elif video or art == "original":
                if ohne_meta and not video and jpeg_quelle:
                    ziel_p = frei(ordner, zielname(q, zeilen.get(q), namen, Path(q).suffix.lower()))
                    schreiben(ziel_p, ohne_metadaten_jpeg(q))
                elif ohne_meta and not video:
                    # verlustfrei nur bei JPEG — sonst als JPEG in voller Größe ohne Metadaten
                    ziel_p = frei(ordner, zielname(q, zeilen.get(q), namen, ".jpg"))
                    schreiben(ziel_p, verkleinert_jpeg(q, 0, qualitaet, True))
                else:
                    ziel_p = frei(ordner, zielname(q, zeilen.get(q), namen, Path(q).suffix.lower()))
                    kopieren(q, ziel_p)
                    if video and ohne_meta:
                        uebersprungen += 1   # Video: Metadaten bleiben (Hinweis in der Oberfläche)
            else:
                ziel_p = frei(ordner, zielname(q, zeilen.get(q), namen, ".jpg"))
                schreiben(ziel_p, verkleinert_jpeg(q, int(kante or 0), qualitaet, ohne_meta, rz))
            ok += 1
        except Exception as e:  # noqa: BLE001
            log.warning("[medienexport] %s: %s", q, e)
            fehler.append({"pfad": q, "grund": str(e)[:160]})
    if fortschritt:
        fortschritt(len(pfade), len(pfade), "")
    return {"ok": True, "n_ok": ok, "n_fehler": len(fehler), "fehler": fehler[:50], "video_mit_meta": uebersprungen,
            "ziel": str(ordner)}
