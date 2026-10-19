# -*- coding: utf-8 -*-
"""Aufnahmezeit vieler Fotos und Clips auf einmal ändern (19.10.2026).

Anlass: ein Nutzer hatte 66 Dateien, deren Kamera auf 2036 stand — der EXIF-Editor ändert nur eine Datei
nach der anderen. Vorbild ist Lightrooms „Aufnahmezeit bearbeiten":

  versatz  alle um dieselbe Zeitspanne verschieben (Jahre, Tage, Stunden, Minuten; früher oder später).
           Dateien ohne Aufnahmezeit bleiben unverändert — es gibt nichts zu verschieben.
  fest     auf ein Datum mit Uhrzeit setzen. Standard: die früheste Datei bekommt genau diese Zeit, alle anderen
           rücken um denselben Betrag mit (die Abstände zwischen den Aufnahmen bleiben). Dateien ohne Zeit bekommen
           genau die gewählte Zeit. Mit `gleich=True` bekommen alle genau diese Zeit.

Gerechnet wird mit der Uhrzeit, wie sie IN DER DATEI steht (EXIF DateTimeOriginal bzw. QuickTime CreateDate) —
also ohne Zeitzonen-Umrechnung. Die Datenbank kennt sie als `aufnahme_utc + tz_minuten` (core/fotos liest genau so
ein). Dieses Modul rechnet nur; geschrieben wird über `core/exif.aufnahmezeit_schreiben`.
"""
from __future__ import annotations

import calendar
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from . import exif as cexif

#: so viele Dateien höchstens in einem Lauf
MAX_DATEIEN = 5000
#: Zeilen in der Vorschau des Dialogs
VORSCHAU_N = 8
#: plausibler Bereich für das Ergebnis — 0001 oder 9999 ist ein Tippfehler, keine Aufnahme
JAHR_MIN, JAHR_MAX = 1900, 2100

#: Videos, deren Aufnahmezeit exiftool schreiben kann (QuickTime/MP4-Container). Insta360-Rohdateien bewusst nicht:
#: ihr Anhang mit Kreiseldaten gehört Insta360 Studio, das Risiko einer kaputten Rohdatei ist es nicht wert.
VIDEO_SCHREIBBAR = {".mp4", ".mov", ".m4v", ".qt", ".3gp", ".lrv"}


class RegelFehler(ValueError):
    """Ungültige Eingabe im Dialog. `schluessel` ist der i18n-Schlüssel der Meldung."""

    def __init__(self, schluessel: str, text: str):
        super().__init__(text)
        self.schluessel = schluessel


def _int(v, standard: int = 0) -> int:
    try:
        return int(round(float(v)))
    except (TypeError, ValueError):
        return standard


def regel_lesen(regel: dict) -> dict:
    """Eingabe des Dialogs prüfen und vereinheitlichen.

    versatz: {"art": "versatz", "richtung": "frueher"|"spaeter", "jahre", "tage", "stunden", "minuten", "sekunden"}
             (Werte ≥ 0; ein negativer Wert dreht die Richtung für dieses Feld — wie eingetippt)
    fest:    {"art": "fest", "datum": "JJJJ-MM-TT", "zeit": "HH:MM[:SS]", "gleich": bool}"""
    r = dict(regel or {})
    art = str(r.get("art") or "versatz")
    if art == "versatz":
        vz = -1 if str(r.get("richtung") or "spaeter") == "frueher" else 1
        out = {"art": "versatz"}
        for k in ("jahre", "tage", "stunden", "minuten", "sekunden"):
            out[k] = vz * _int(r.get(k))
        if abs(out["jahre"]) > 200 or abs(out["tage"]) > 100000 or abs(out["stunden"]) > 1000000 \
                or abs(out["minuten"]) > 10000000:
            raise RegelFehler("zeitaendern.err_zu_gross", "Die Zeitspanne ist zu groß.")
        return out
    if art == "fest":
        try:
            ziel = datetime.fromisoformat(f"{str(r.get('datum') or '').strip()}T{str(r.get('zeit') or '00:00').strip()}")
        except ValueError:
            raise RegelFehler("zeitaendern.err_datum", "Datum oder Uhrzeit ist nicht lesbar.") from None
        if ziel.tzinfo is not None:
            ziel = ziel.replace(tzinfo=None)
        if not (JAHR_MIN <= ziel.year <= JAHR_MAX):
            raise RegelFehler("zeitaendern.err_bereich", "Das Ergebnis liegt außerhalb von 1900 bis 2100.")
        return {"art": "fest", "ziel": ziel, "gleich": bool(r.get("gleich"))}
    raise RegelFehler("zeitaendern.err_art", "Unbekannte Art der Änderung.")


def _jahre_dazu(d: datetime, jahre: int) -> datetime:
    """Kalenderjahre addieren; der 29. Februar wird in Nicht-Schaltjahren der 28."""
    if not jahre:
        return d
    j = d.year + jahre
    if not 1 <= j <= 9999:
        raise ValueError("Jahr außerhalb")
    return d.replace(year=j, day=min(d.day, calendar.monthrange(j, d.month)[1]))


def verschieben(alt: datetime, regel: dict) -> datetime:
    neu = _jahre_dazu(alt, regel.get("jahre", 0))
    return neu + timedelta(days=regel.get("tage", 0), hours=regel.get("stunden", 0),
                           minutes=regel.get("minuten", 0), seconds=regel.get("sekunden", 0))


def alt_aus_zeile(z: dict) -> Optional[datetime]:
    """Uhrzeit, wie sie in der Datei steht, aus einer Zeile des Bestands (None = Datei hat keine)."""
    utc = (z or {}).get("aufnahme_utc")
    if utc is None:
        return None
    try:
        return (datetime.fromtimestamp(float(utc), timezone.utc) + timedelta(minutes=int(z.get("tz_minuten") or 0))
                ).replace(tzinfo=None)
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def art_der_datei(path: str) -> str:
    """'foto' | 'video' | 'nicht' (kann keine Aufnahmezeit speichern bzw. wird bewusst nicht angefasst)."""
    endung = os.path.splitext(str(path))[1].lower()
    if cexif.is_photo(path):
        return "foto"
    if endung in VIDEO_SCHREIBBAR:
        return "video"
    return "nicht"


def partner_finden(pfade: list) -> list:
    """RAW+JPG-Paare (gleicher Ordner, gleicher Name, eine RAW-Datei und ein Bild) — wie der Geotagger.
    Liefert die Partner, die NICHT schon in `pfade` stehen."""
    drin = {os.path.normcase(os.path.abspath(p)) for p in pfade}
    raus, gesehen = [], set()
    ordner_cache: dict = {}
    for p in pfade:
        d, name = os.path.split(str(p))
        stamm, endung = os.path.splitext(name)
        ist_raw = endung.lower() in cexif.RAW_EXTS
        ist_bild = endung.lower() in (cexif.JPEG_LIKE_EXTS | cexif.HEIF_EXTS | cexif.TIFF_EXTS)
        if not (ist_raw or ist_bild):
            continue
        if d not in ordner_cache:
            try:
                ordner_cache[d] = os.listdir(d)
            except OSError:
                ordner_cache[d] = []
        for n in ordner_cache[d]:
            s2, e2 = os.path.splitext(n)
            if s2 != stamm or n == name:
                continue
            e2 = e2.lower()
            passt = (e2 in (cexif.JPEG_LIKE_EXTS | cexif.HEIF_EXTS | cexif.TIFF_EXTS)) if ist_raw else (e2 in cexif.RAW_EXTS)
            if not passt:
                continue
            q = os.path.join(d, n)
            k = os.path.normcase(os.path.abspath(q))
            if k in drin or k in gesehen:
                continue
            gesehen.add(k)
            raus.append(q)
    return raus


def planen(eintraege: list, regel: dict) -> list:
    """eintraege = [{path, alt: datetime|None}] → je Datei {path, art, alt, neu, aktion}.

    aktion: 'verschieben' (Zeit vorhanden, wird um neu−alt verschoben), 'setzen' (keine Zeit, wird gesetzt),
            'gleich' (nichts zu tun), 'ohne_zeit' (Verschieben ohne Zeit), 'nicht' (Format kann es nicht),
            'bereich' (Ergebnis außerhalb 1900–2100)."""
    plan = []
    bezug = None
    if regel["art"] == "fest" and not regel.get("gleich"):
        zeiten = [e["alt"] for e in eintraege if e.get("alt") is not None and art_der_datei(e["path"]) != "nicht"]
        bezug = min(zeiten) if zeiten else None
    for e in eintraege:
        p, alt = e["path"], e.get("alt")
        art = art_der_datei(p)
        z = {"path": p, "art": art, "alt": alt, "neu": None, "aktion": ""}
        if art == "nicht":
            z["aktion"] = "nicht"
        elif regel["art"] == "versatz":
            if alt is None:
                z["aktion"] = "ohne_zeit"
            else:
                try:
                    z["neu"] = verschieben(alt, regel)
                except (ValueError, OverflowError):
                    z["neu"] = None
        else:
            if alt is None or regel.get("gleich") or bezug is None:
                z["neu"] = regel["ziel"]
            else:
                z["neu"] = alt + (regel["ziel"] - bezug)
        if not z["aktion"]:
            if z["neu"] is None or not (JAHR_MIN <= z["neu"].year <= JAHR_MAX):
                z["aktion"], z["neu"] = "bereich", None
            elif alt is None:
                z["aktion"] = "setzen"
            elif abs((z["neu"] - alt).total_seconds()) < 0.5:
                z["aktion"] = "gleich"
            else:
                z["aktion"] = "verschieben"
        plan.append(z)
    return plan


def text(d: Optional[datetime]) -> str:
    return d.strftime("%Y-%m-%d %H:%M:%S") if d else ""


def zusammenfassung(plan: list) -> dict:
    n = {"verschieben": 0, "setzen": 0, "gleich": 0, "ohne_zeit": 0, "nicht": 0, "bereich": 0}
    for z in plan:
        n[z["aktion"]] = n.get(z["aktion"], 0) + 1
    n["schreiben"] = n["verschieben"] + n["setzen"]
    n["video"] = sum(1 for z in plan if z["art"] == "video" and z["aktion"] in ("verschieben", "setzen"))
    return n
