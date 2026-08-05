"""
Tour-Ebene aus FIT-Dateien (v0.9.501).

Bis hierher las `core/imports.py` ausschließlich `record`-Frames — also die
Werte, die an einer Koordinate hängen (Puls, Trittfrequenz, Leistung …). Alles,
was die **Tour als Ganzes** beschreibt, fiel weg: `session` (Ø/Max-Puls,
Kalorien, Temperatur), `sport` (Sportart und der frei vergebene Profilname),
`device_info` (womit wurde aufgezeichnet) und `weather_conditions` (Wetter zur
Aufnahmezeit).

Warum überhaupt roh mitspeichern statt nur eine Handvoll kuratierter Werte?
Weil der Neu-Import der teure Teil ist. Ein Beta-Tester hat 4835 Touren; die
noch einmal einzulesen, nur weil uns später Kalorien einfallen, ist der Fehler,
den man nicht mehr geradebiegt. Gemessen an vier echten Garmin-Dateien hat eine
`session` **23–50 belegte Felder** (nicht die 156 der Spezifikation) und der
gefilterte Rohblock wiegt **~1,2 KB pro Tour** — für ein komplettes Archiv rund
5,5 MB. Das Lesen ist billig; teuer ist das *Zeigen*, und das bleibt kuratiert
(siehe `ANZEIGE`).

Bewusst NICHT gelesen:
  * `user_profile` — Ruhepuls, Alter, Geschlecht, Größe, Gewicht. Das
    beschreibt den Menschen, nicht die Tour, steht in jeder Datei gleich und
    macht aus einem Tourenarchiv eine Gesundheitsdatenbank.
  * Trainingslehre — Zonen, Trainingseffekt, Normalized Power, TSS, HRV
    (`_TRAININGSLEHRE`). Interpretierte Werte gehören zu Garmin Connect; wir
    zeigen beschreibende.
  * `lap` — Rundenwerte. Eigenes Thema, eigene UI, hier noch nicht dran.
"""
from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Any, Dict, Optional

_log = logging.getLogger("rzgps.fitmeta")

# Diese Frame-Typen beschreiben die Tour als Ganzes und werden eingesammelt.
TOUR_FRAMES = ("session", "sport", "device_info", "weather_conditions")

# ── Was NICHT mitkommt ───────────────────────────────────────────────────────

# Trainingslehre: interpretierte Werte statt gemessener. Marc-Entscheidung
# 2026-08-05 — beschreibend ja, Trainingsauswertung nein.
_TRAININGSLEHRE = {
    "total_training_effect", "total_anaerobic_training_effect",
    "training_stress_score", "intensity_factor", "normalized_power",
    "threshold_power", "training_load_peak",
    "time_in_hr_zone", "time_in_speed_zone", "time_in_cadence_zone",
    "time_in_power_zone", "zone_count",
    "sdrr_hrv", "rmssd_hrv", "avg_stress", "current_stress",
    "workout_feel", "workout_rpe", "avg_vam", "total_work",
    # Pedal-Analytik: Leistungsmesser-Interpretation, dieselbe Schublade.
    "left_right_balance", "avg_left_torque_effectiveness",
    "avg_right_torque_effectiveness", "avg_left_pedal_smoothness",
    "avg_right_pedal_smoothness", "avg_combined_pedal_smoothness",
    "avg_left_pco", "avg_right_pco", "avg_left_power_phase",
    "avg_left_power_phase_peak", "avg_right_power_phase",
    "avg_right_power_phase_peak", "avg_power_position", "max_power_position",
    "avg_cadence_position", "max_cadence_position",
}

# Personenbezug — auch dort, wo es sich in `session`/`device_info` versteckt.
# `user_profile` lesen wir gar nicht erst; das hier ist die zweite Sicherung.
_PERSONENBEZUG = {
    "resting_heart_rate", "default_max_heart_rate",
    "default_max_running_heart_rate", "default_max_biking_heart_rate",
    "friendly_name", "gender", "age", "height", "weight",
    "user_running_step_length", "user_walking_step_length",
    # Geräte-Seriennummern sind dauerhafte Kennungen — die will niemand in
    # einer Datenbank haben, die exportiert und weitergegeben wird.
    "serial_number", "ant_device_number",
}

_RAUS = _TRAININGSLEHRE | _PERSONENBEZUG


# ── Kuratierte Anzeige ───────────────────────────────────────────────────────
# Nur diese Felder bekommen Label, Einheit und einen Platz im UI. Der Rohblock
# enthält mehr — hier zu ergänzen kostet keinen Neu-Import, genau dafür ist er da.
# Schlüssel = "<frame>.<feld>".
ANZEIGE: Dict[str, tuple] = {
    "session.avg_heart_rate":       ("Ø Puls",          "bpm"),
    "session.max_heart_rate":       ("Max. Puls",       "bpm"),
    "session.min_heart_rate":       ("Min. Puls",       "bpm"),
    "session.avg_cadence":          ("Ø Trittfrequenz", "rpm"),
    "session.max_cadence":          ("Max. Trittfrequenz", "rpm"),
    "session.avg_power":            ("Ø Leistung",      "W"),
    "session.max_power":            ("Max. Leistung",   "W"),
    "session.total_calories":       ("Kalorien",        "kcal"),
    "session.avg_temperature":      ("Ø Temperatur",    "°C"),
    "session.max_temperature":      ("Max. Temperatur", "°C"),
    "session.min_temperature":      ("Min. Temperatur", "°C"),
    "session.avg_respiration_rate": ("Ø Atemfrequenz",  "1/min"),
    "session.avg_spo2":             ("Ø SpO₂",          "%"),
    "sport.name":                   ("Profil",          ""),
    "sport.sport":                  ("Sportart",        ""),
    "sport.sub_sport":              ("Unterart",        ""),
    "device_info.manufacturer":     ("Hersteller",      ""),
    "device_info.product_name":     ("Gerät",           ""),
    "weather_conditions.temperature":           ("Wetter-Temperatur", "°C"),
    "weather_conditions.temperature_feels_like": ("Gefühlt",          "°C"),
    "weather_conditions.wind_speed":            ("Wind",              "m/s"),
    "weather_conditions.wind_direction":        ("Windrichtung",      "°"),
    "weather_conditions.condition":             ("Wetterlage",        ""),
    "weather_conditions.relative_humidity":     ("Luftfeuchte",       "%"),
}


# ── Sportart → unsere Fortbewegungsarten ─────────────────────────────────────
# ⚠️ Die Werte rechts müssen in `core.library.ACTIVITIES` existieren, sonst
# lehnt `set_activity` sie ab und die Statistik zeigt einen leeren Namen.
# `tests/test_fit_tourmeta.py` prüft genau das.

# Die Unterart ist genauer als die Sportart und gewinnt deshalb. Genau hier
# löst sich der Wunsch „Ich habe 3 Fahrräder unterteilt in Rennrad,
# Gravel/Trekking und E-Bike" auf — das Rad weiß selbst, welches es war.
_SUB_SPORT = {
    "road":             "rennrad",
    "gravel_cycling":   "gravel",
    "mixed_surface":    "gravel",
    "cyclocross":       "gravel",
    "mountain":         "mtb",
    "downhill":         "mtb",
    "bmx":              "mtb",
    "e_bike_fitness":   "ebike",
    "e_bike_mountain":  "ebike",
    "commuting":        "rad",
    "indoor_cycling":   "rad",
    "spin":             "rad",
    "casual_walking":   "spaziergang",
    "speed_walking":    "spaziergang",
    "indoor_walking":   "spaziergang",
    "trail":            "laufen",
    "street":           "laufen",
    "track":            "laufen",
    "treadmill":        "laufen",
    "indoor_running":   "laufen",
    "ultra":            "laufen",
    "backcountry":      "ski",
    "skate_skiing":     "ski",
    "resort":           "ski",
    "whitewater":       "boot",
    "open_water":       "boot",
    "motocross":        "motorrad",
    "atv":              "motorrad",
}

_SPORT = {
    "cycling":                  "rad",
    "e_biking":                 "ebike",
    "running":                  "laufen",
    "walking":                  "spaziergang",
    "hiking":                   "wandern",
    "mountaineering":           "wandern",
    "rock_climbing":            "wandern",
    "snowshoeing":              "wandern",
    "motorcycling":             "motorrad",
    "driving":                  "auto",
    "kayaking":                 "boot",
    "paddling":                 "boot",
    "rowing":                   "boot",
    "sailing":                  "boot",
    "boating":                  "boot",
    "surfing":                  "boot",
    "windsurfing":              "boot",
    "kitesurfing":              "boot",
    "rafting":                  "boot",
    "stand_up_paddleboarding":  "boot",
    "cross_country_skiing":     "ski",
    "alpine_skiing":            "ski",
    "snowboarding":             "ski",
    "snowmobiling":             "ski",
}

# Manche Geräte schreiben als Unterart schlicht „generic" — das ist keine
# Aussage und darf die Sportart nicht überstimmen.
_NICHTSSAGEND = {"generic", "all", "", None}


def aktivitaet(meta: Optional[dict]) -> str:
    """FIT-Sportart → unser Fortbewegungs-Schlüssel ("" wenn unbekannt).

    Unterart schlägt Sportart. `e_biking` schlägt beides, weil ein E-Bike auch
    dann eins bleibt, wenn die Unterart „generic" sagt.
    """
    if not meta:
        return ""
    sp = (meta.get("sport") or {})
    sport = sp.get("sport") or (meta.get("session") or {}).get("sport")
    sub = sp.get("sub_sport") or (meta.get("session") or {}).get("sub_sport")
    if isinstance(sport, str):
        sport = sport.strip().lower()
    if isinstance(sub, str):
        sub = sub.strip().lower()
    if sport == "e_biking":
        return "ebike"
    if sub not in _NICHTSSAGEND and sub in _SUB_SPORT:
        # Unterarten sind je Sportart eindeutig genug: „mountain" gibt es nur
        # beim Rad, „trail" nur beim Laufen. Eine Kreuzprüfung würde nur dann
        # etwas ändern, wenn ein Gerät Unsinn schreibt.
        return _SUB_SPORT[sub]
    if isinstance(sport, str) and sport in _SPORT:
        return _SPORT[sport]
    return ""


def profilname(meta: Optional[dict]) -> str:
    """Der frei vergebene Name des Geräteprofils („Commute", „Gravel", „Bike").

    Der wandert als automatisches Schlagwort mit, NICHT als Fortbewegungsart:
    er ist frei getippt, in der Sprache des Nutzers und nicht übersetzbar —
    als Kategorie würde er die Auswertung in hunderte Einzelfälle zersplittern.
    Als Schlagwort ist er dagegen genau das Richtige zum Suchen und Filtern.
    """
    if not meta:
        return ""
    for schluessel in (("sport", "name"), ("session", "sport_profile_name")):
        wert = (meta.get(schluessel[0]) or {}).get(schluessel[1])
        if isinstance(wert, str) and wert.strip():
            return wert.strip()[:40]
    return ""


# ── Einsammeln beim Import ───────────────────────────────────────────────────

def _brauchbar(wert: Any) -> bool:
    """Leere Werte draußen lassen — sonst bläht sich der Rohblock mit `null`
    und Tupeln aus lauter `None` auf (Garmin schreibt die reihenweise)."""
    if wert is None:
        return False
    if isinstance(wert, (tuple, list)):
        return any(x is not None for x in wert)
    if isinstance(wert, (bytes, bytearray)):
        return False
    if isinstance(wert, str) and not wert.strip():
        return False
    return True


def _sauber(wert: Any) -> Any:
    """In etwas verwandeln, das `json.dumps` verträgt."""
    if isinstance(wert, (datetime, date)):
        return wert.isoformat()
    if isinstance(wert, (tuple, list)):
        return [_sauber(x) for x in wert if x is not None]
    if isinstance(wert, (int, float, str, bool)):
        return wert
    return str(wert)


def sammle(frame, ziel: dict) -> None:
    """Ein FIT-Frame in den Tour-Block übernehmen, falls es einer der unseren ist.

    Wird aus der Frame-Schleife von `core.imports._parse_fit` heraus gerufen —
    also ohne zweiten Lesevorgang über die Datei. Bei einer 23000-Punkte-Datei
    ist das der Unterschied zwischen „kostet nichts" und „doppelte Importzeit".

    Der erste belegte Wert gewinnt: `device_info` kommt mehrfach vor (einmal je
    Sensor), und der erste Eintrag ist das aufzeichnende Gerät selbst.
    """
    name = getattr(frame, "name", None)
    if name not in TOUR_FRAMES:
        return
    block = ziel.setdefault(name, {})
    try:
        felder = frame.fields
    except Exception:       # pragma: no cover — kaputte Frames überspringen
        return
    for f in felder:
        k = getattr(f, "name", None)
        if not isinstance(k, str) or k.startswith("unknown_") or k in _RAUS:
            continue
        if k in block:
            continue
        wert = getattr(f, "value", None)
        if not _brauchbar(wert):
            continue
        try:
            block[k] = _sauber(wert)
        except Exception:   # pragma: no cover
            continue


def anzeige_paare(meta: Optional[dict]) -> list:
    """Der kuratierte Auszug fürs UI: [{key, label, unit, value}, …].

    Reihenfolge = die von `ANZEIGE`, damit die Detailansicht nicht bei jeder
    Datei anders sortiert ist.
    """
    if not meta:
        return []
    out = []
    for schluessel, (label, einheit) in ANZEIGE.items():
        frame, _, feld = schluessel.partition(".")
        wert = (meta.get(frame) or {}).get(feld)
        if wert is None or wert == "":
            continue
        eintrag = {"key": schluessel, "label": label,
                   "unit": einheit, "value": wert}
        # Bei Sportart und Unterart steht in der Datei ein Kennwort
        # („cycling", „commuting"), kein Anzeigetext. Es als `code` markieren,
        # damit die Oberfläche es übersetzen kann statt es roh hinzuschreiben —
        # sonst steht in einer deutschen Ansicht „Unterart: commuting".
        if schluessel in ("sport.sport", "sport.sub_sport",
                          "device_info.manufacturer",
                          "weather_conditions.condition"):
            eintrag["code"] = True
        out.append(eintrag)
    return out
