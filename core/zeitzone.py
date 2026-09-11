# -*- coding: utf-8 -*-
"""Zeitzone einer Tour + Datum/Uhrzeit-Formate für die Einblendungen
(11.09.2026, Marc: „in den Stats fehlt Datum und Uhrzeit — Datum für Gesamt,
Datum und Uhrzeit für Live, Gesamt ggf. ein Zeitraum").

Tracks tragen UTC. Ohne Zeitzonen-Bibliothek (nichts gebündelt) kommt die Zone
aus dem LAND der Tour (Archiv-Spalte `country`, deutscher Name aus dem
Ortslauf) plus Längengrad für Länder mit mehreren Zonen; ohne Land aus der
Lage (Europa → Berlin/London/Athen, sonst Längengrad → feste Stunde).
Die Formate sind bewusst simpel und in `ui/js` gespiegelt (fmtDateJS):
    de  12.08.2026   12.–14.08.2026   28.08.–02.09.2026
    en  12 Aug 2026  12–14 Aug 2026   28 Aug – 2 Sep 2026
    es  12/08/2026   12–14/08/2026    28/08 – 02/09/2026
Uhrzeit immer HH:MM (24 h).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

try:
    from zoneinfo import ZoneInfo
except Exception:  # noqa: BLE001 — pragma: no cover
    ZoneInfo = None  # type: ignore

#: Deutsche Ländernamen (wie der Ortslauf sie schreibt) → Zone. Länder mit
#: mehreren Zonen stehen in _MEHRZONEN und werden über den Längengrad aufgelöst.
LAND_ZONE = {
    "Deutschland": "Europe/Berlin", "Österreich": "Europe/Vienna", "Schweiz": "Europe/Zurich",
    "Liechtenstein": "Europe/Vaduz", "Luxemburg": "Europe/Luxembourg", "Niederlande": "Europe/Amsterdam",
    "Belgien": "Europe/Brussels", "Frankreich": "Europe/Paris", "Monaco": "Europe/Monaco",
    "Italien": "Europe/Rome", "San Marino": "Europe/Rome", "Vatikanstadt": "Europe/Rome",
    "Polen": "Europe/Warsaw", "Tschechien": "Europe/Prague", "Slowakei": "Europe/Bratislava",
    "Ungarn": "Europe/Budapest", "Slowenien": "Europe/Ljubljana", "Kroatien": "Europe/Zagreb",
    "Bosnien und Herzegowina": "Europe/Sarajevo", "Serbien": "Europe/Belgrade", "Montenegro": "Europe/Podgorica",
    "Nordmazedonien": "Europe/Skopje", "Albanien": "Europe/Tirane", "Kosovo": "Europe/Belgrade",
    "Dänemark": "Europe/Copenhagen", "Schweden": "Europe/Stockholm", "Norwegen": "Europe/Oslo",
    "Finnland": "Europe/Helsinki", "Estland": "Europe/Tallinn", "Lettland": "Europe/Riga", "Litauen": "Europe/Vilnius",
    "Island": "Atlantic/Reykjavik", "Irland": "Europe/Dublin", "Vereinigtes Königreich": "Europe/London",
    "Griechenland": "Europe/Athens", "Zypern": "Asia/Nicosia", "Bulgarien": "Europe/Sofia", "Rumänien": "Europe/Bucharest",
    "Moldau": "Europe/Chisinau", "Ukraine": "Europe/Kyiv", "Belarus": "Europe/Minsk", "Türkei": "Europe/Istanbul",
    "Malta": "Europe/Malta", "Andorra": "Europe/Andorra", "Georgien": "Asia/Tbilisi", "Armenien": "Asia/Yerevan",
    "Israel": "Asia/Jerusalem", "Jordanien": "Asia/Amman", "Ägypten": "Africa/Cairo", "Marokko": "Africa/Casablanca",
    "Tunesien": "Africa/Tunis", "Südafrika": "Africa/Johannesburg", "Namibia": "Africa/Windhoek", "Kenia": "Africa/Nairobi",
    "Tansania": "Africa/Dar_es_Salaam", "Vereinigte Arabische Emirate": "Asia/Dubai", "Oman": "Asia/Muscat",
    "Indien": "Asia/Kolkata", "Nepal": "Asia/Kathmandu", "Sri Lanka": "Asia/Colombo", "Thailand": "Asia/Bangkok",
    "Vietnam": "Asia/Ho_Chi_Minh", "Kambodscha": "Asia/Phnom_Penh", "Laos": "Asia/Vientiane", "Malaysia": "Asia/Kuala_Lumpur",
    "Singapur": "Asia/Singapore", "Philippinen": "Asia/Manila", "Japan": "Asia/Tokyo", "Südkorea": "Asia/Seoul",
    "Taiwan": "Asia/Taipei", "Hongkong": "Asia/Hong_Kong", "China": "Asia/Shanghai", "Neuseeland": "Pacific/Auckland",
    "Argentinien": "America/Argentina/Buenos_Aires", "Chile": "America/Santiago", "Peru": "America/Lima",
    "Kolumbien": "America/Bogota", "Ecuador": "America/Guayaquil", "Bolivien": "America/La_Paz", "Uruguay": "America/Montevideo",
    "Costa Rica": "America/Costa_Rica", "Kuba": "America/Havana", "Dominikanische Republik": "America/Santo_Domingo",
    "Kap Verde": "Atlantic/Cape_Verde", "Mauritius": "Indian/Mauritius", "Seychellen": "Indian/Mahe", "Malediven": "Indian/Maldives",
}

#: Länder mit mehreren Zonen: Liste (Längengrad-Obergrenze, Zone), aufsteigend nach Längengrad.
_MEHRZONEN = {
    "Spanien": [(-11.0, "Atlantic/Canary"), (999, "Europe/Madrid")],
    "Portugal": [(-24.0, "Atlantic/Azores"), (-14.0, "Atlantic/Madeira"), (999, "Europe/Lisbon")],
    "Vereinigte Staaten von Amerika": [(-158.0, "Pacific/Honolulu"), (-141.0, "America/Anchorage"),
                                       (-114.0, "America/Los_Angeles"), (-102.0, "America/Denver"),
                                       (-87.0, "America/Chicago"), (999, "America/New_York")],
    "Kanada": [(-120.0, "America/Vancouver"), (-102.0, "America/Edmonton"), (-90.0, "America/Winnipeg"),
               (-68.0, "America/Toronto"), (-60.0, "America/Halifax"), (999, "America/St_Johns")],
    "Mexiko": [(-110.0, "America/Tijuana"), (-105.0, "America/Hermosillo"), (999, "America/Mexico_City")],
    "Brasilien": [(-60.0, "America/Manaus"), (999, "America/Sao_Paulo")],
    "Australien": [(-999, "Australia/Perth"), (129.0, "Australia/Perth"), (141.0, "Australia/Adelaide"),
                   (999, "Australia/Sydney")],
    "Russland": [(37.0, "Europe/Moscow"), (52.0, "Europe/Samara"), (67.0, "Asia/Yekaterinburg"),
                 (82.0, "Asia/Omsk"), (97.0, "Asia/Krasnoyarsk"), (112.0, "Asia/Irkutsk"),
                 (127.0, "Asia/Yakutsk"), (999, "Asia/Vladivostok")],
    "Indonesien": [(113.0, "Asia/Jakarta"), (127.0, "Asia/Makassar"), (999, "Asia/Jayapura")],
    "Kasachstan": [(999, "Asia/Almaty")],
}


def zone_fuer(lat: Optional[float], lon: Optional[float], land: str = "") -> str:
    """Zonenname für eine Lage. `land` = deutscher Ländername (Archiv), darf leer sein."""
    land = (land or "").split("·")[0].strip()
    if land in _MEHRZONEN and lon is not None:
        for grenze, zone in _MEHRZONEN[land]:
            if float(lon) < grenze:
                return zone
    if land in LAND_ZONE:
        return LAND_ZONE[land]
    if lat is None or lon is None:
        return "UTC"
    lat, lon = float(lat), float(lon)
    # Europa ohne Land: drei Streifen reichen (WET / CET / EET).
    if 34.0 <= lat <= 72.0 and -12.0 <= lon <= 42.0:
        if 49.5 < lat < 61.0 and lon < 1.8:
            return "Europe/London"          # Britische Inseln
        if lon < -5.5:
            return "Europe/Lisbon"          # Portugal (Galicien wird dabei mitgenommen — selten)
        if lon > 22.5:
            return "Europe/Athens"
        return "Europe/Berlin"
    # Rest der Welt: feste Stunde aus dem Längengrad (keine Sommerzeit).
    h = int(round(lon / 15.0))
    if h == 0:
        return "UTC"
    return f"Etc/GMT{'-' if h > 0 else '+'}{abs(h)}"   # Etc-Zonen haben das Vorzeichen umgekehrt


def _tz(zone: str):
    if ZoneInfo is None or not zone:
        return timezone.utc
    try:
        return ZoneInfo(zone)
    except Exception:  # noqa: BLE001
        return timezone.utc


def offset_min(zone: str, epoch: Optional[float]) -> int:
    """Versatz zu UTC in Minuten zum Zeitpunkt `epoch` (Sommerzeit inklusive)."""
    if epoch is None:
        return 0
    try:
        d = datetime.fromtimestamp(float(epoch), tz=_tz(zone))
        off = d.utcoffset() or timedelta(0)
        return int(off.total_seconds() // 60)
    except Exception:  # noqa: BLE001
        return 0


def epoch_von_iso(s: Optional[str]) -> Optional[float]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00")).timestamp()
    except Exception:  # noqa: BLE001
        return None


# ── Formate (Spiegel: fmtDateJS in core/animator.py und modules/animator) ──

_MON_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _lokal(epoch: float, off_min: int) -> datetime:
    return datetime.fromtimestamp(float(epoch), tz=timezone.utc) + timedelta(minutes=int(off_min))


def fmt_datum(epoch: Optional[float], off_min: int = 0, lang: str = "de") -> str:
    if epoch is None:
        return "—"
    d = _lokal(epoch, off_min)
    if lang == "en":
        return f"{d.day} {_MON_EN[d.month - 1]} {d.year}"
    if lang == "es":
        return f"{d.day:02d}/{d.month:02d}/{d.year}"
    return f"{d.day:02d}.{d.month:02d}.{d.year}"


def fmt_uhrzeit(epoch: Optional[float], off_min: int = 0) -> str:
    if epoch is None:
        return "—"
    d = _lokal(epoch, off_min)
    return f"{d.hour:02d}:{d.minute:02d}"


def fmt_datum_uhrzeit(epoch: Optional[float], off_min: int = 0, lang: str = "de") -> str:
    if epoch is None:
        return "—"
    return f"{fmt_datum(epoch, off_min, lang)} {fmt_uhrzeit(epoch, off_min)}"


def fmt_zeitraum(e1: Optional[float], e2: Optional[float], off_min: int = 0, lang: str = "de") -> str:
    """Datum oder Datumsbereich (Mehrtagestour)."""
    if e1 is None:
        return "—"
    if e2 is None:
        return fmt_datum(e1, off_min, lang)
    a, b = _lokal(e1, off_min), _lokal(e2, off_min)
    if (a.year, a.month, a.day) == (b.year, b.month, b.day):
        return fmt_datum(e1, off_min, lang)
    if lang == "en":
        if (a.year, a.month) == (b.year, b.month):
            return f"{a.day}–{b.day} {_MON_EN[a.month - 1]} {a.year}"
        if a.year == b.year:
            return f"{a.day} {_MON_EN[a.month - 1]} – {b.day} {_MON_EN[b.month - 1]} {a.year}"
        return f"{fmt_datum(e1, off_min, lang)} – {fmt_datum(e2, off_min, lang)}"
    if lang == "es":
        if (a.year, a.month) == (b.year, b.month):
            return f"{a.day:02d}–{b.day:02d}/{a.month:02d}/{a.year}"
        if a.year == b.year:
            return f"{a.day:02d}/{a.month:02d} – {b.day:02d}/{b.month:02d}/{a.year}"
        return f"{fmt_datum(e1, off_min, lang)} – {fmt_datum(e2, off_min, lang)}"
    if (a.year, a.month) == (b.year, b.month):
        return f"{a.day:02d}.–{b.day:02d}.{a.month:02d}.{a.year}"
    if a.year == b.year:
        return f"{a.day:02d}.{a.month:02d}.–{b.day:02d}.{b.month:02d}.{a.year}"
    return f"{fmt_datum(e1, off_min, lang)} – {fmt_datum(e2, off_min, lang)}"


def fmt_uhrzeit_spanne(e1: Optional[float], e2: Optional[float], off_min: int = 0) -> str:
    if e1 is None:
        return "—"
    if e2 is None:
        return fmt_uhrzeit(e1, off_min)
    return f"{fmt_uhrzeit(e1, off_min)} – {fmt_uhrzeit(e2, off_min)}"


#: JavaScript-Spiegel der Formate (wird in Render-Vorlage und Vorschau eingebettet).
JS_FORMATE = r"""
function _rzLokal(epoch, offMin){ return new Date((epoch + (offMin||0)*60) * 1000); }
function _rz2(n){ return n < 10 ? '0' + n : '' + n; }
var _RZ_MON_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmtDateJS(epoch, offMin, lang){
  if (epoch == null) return '—';
  var d = _rzLokal(epoch, offMin), D = d.getUTCDate(), M = d.getUTCMonth(), Y = d.getUTCFullYear();
  if (lang === 'en') return D + ' ' + _RZ_MON_EN[M] + ' ' + Y;
  if (lang === 'es') return _rz2(D) + '/' + _rz2(M + 1) + '/' + Y;
  return _rz2(D) + '.' + _rz2(M + 1) + '.' + Y;
}
function fmtTimeJS(epoch, offMin){
  if (epoch == null) return '—';
  var d = _rzLokal(epoch, offMin);
  return _rz2(d.getUTCHours()) + ':' + _rz2(d.getUTCMinutes());
}
function fmtDateTimeJS(epoch, offMin, lang){ return epoch == null ? '—' : fmtDateJS(epoch, offMin, lang) + ' ' + fmtTimeJS(epoch, offMin); }
function fmtDateRangeJS(e1, e2, offMin, lang){
  if (e1 == null) return '—';
  if (e2 == null) return fmtDateJS(e1, offMin, lang);
  var a = _rzLokal(e1, offMin), b = _rzLokal(e2, offMin);
  var aD = a.getUTCDate(), aM = a.getUTCMonth(), aY = a.getUTCFullYear(), bD = b.getUTCDate(), bM = b.getUTCMonth(), bY = b.getUTCFullYear();
  if (aY === bY && aM === bM && aD === bD) return fmtDateJS(e1, offMin, lang);
  if (lang === 'en') {
    if (aY === bY && aM === bM) return aD + '–' + bD + ' ' + _RZ_MON_EN[aM] + ' ' + aY;
    if (aY === bY) return aD + ' ' + _RZ_MON_EN[aM] + ' – ' + bD + ' ' + _RZ_MON_EN[bM] + ' ' + aY;
    return fmtDateJS(e1, offMin, lang) + ' – ' + fmtDateJS(e2, offMin, lang);
  }
  if (lang === 'es') {
    if (aY === bY && aM === bM) return _rz2(aD) + '–' + _rz2(bD) + '/' + _rz2(aM + 1) + '/' + aY;
    if (aY === bY) return _rz2(aD) + '/' + _rz2(aM + 1) + ' – ' + _rz2(bD) + '/' + _rz2(bM + 1) + '/' + aY;
    return fmtDateJS(e1, offMin, lang) + ' – ' + fmtDateJS(e2, offMin, lang);
  }
  if (aY === bY && aM === bM) return _rz2(aD) + '.–' + _rz2(bD) + '.' + _rz2(aM + 1) + '.' + aY;
  if (aY === bY) return _rz2(aD) + '.' + _rz2(aM + 1) + '.–' + _rz2(bD) + '.' + _rz2(bM + 1) + '.' + aY;
  return fmtDateJS(e1, offMin, lang) + ' – ' + fmtDateJS(e2, offMin, lang);
}
function fmtTimeSpanJS(e1, e2, offMin){ if (e1 == null) return '—'; if (e2 == null) return fmtTimeJS(e1, offMin); return fmtTimeJS(e1, offMin) + ' – ' + fmtTimeJS(e2, offMin); }
"""
