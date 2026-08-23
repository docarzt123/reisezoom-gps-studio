"""
Geotagging-Logik: matched EXIF-Datetimes auf GPX-Trackpunkte (mit Zeitversatz).
"""
from __future__ import annotations

from bisect import bisect_left
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from math import radians, sin, cos, sqrt, atan2
from typing import List, Optional

from .gpx import TrackPoint


@dataclass
class PhotoMatch:
    path: str
    photo_time_local: Optional[datetime]  # naive lokalzeit aus EXIF (None falls fehlt)
    matched_time_utc: Optional[datetime]  # nach Offset auf UTC umgerechnet
    lat: Optional[float]
    lon: Optional[float]
    alt: Optional[float]
    track_index: Optional[int]  # Index in der Trackpunkt-Liste
    time_delta_s: Optional[float]  # Abstand zum nächsten Trackpunkt in Sekunden
    in_range: bool  # liegt innerhalb des Track-Zeitfensters?
    # ── Wie verlässlich ist diese Position? (v0.9.499) ─────────────────────
    # Fällt ein Foto in eine Aufzeichnungslücke, bekommt es trotzdem den
    # nächstgelegenen Punkt — und das ist meistens richtig: Wer ins Wirtshaus
    # geht, verliert drinnen den Empfang, und der letzte Punkt liegt am
    # Eingang. Genau dort war das Foto ja auch.
    #
    # Falsch wird es, wenn während der Lücke WEITERGEGANGEN wurde: Uhr mit
    # leerem Akku aus, zwei Stunden weiter, Uhr wieder an — oder Aufzeichnung
    # pausiert und mit der Seilbahn hoch. Dann liegt der zugeordnete Punkt
    # kilometerweit weg, und das Foto galt bisher trotzdem als sauber verortet.
    #
    # Unterschieden wird das nicht über die DAUER der Lücke, sondern über die
    # STRECKE zwischen dem Punkt davor und dem danach: Wirtshaus = fast null,
    # auch nach zwei Stunden. Seilbahn = Kilometer, auch nach zehn Minuten.
    unsicher: bool = False          # Position stammt aus einer Lücke mit Bewegung
    gap_seconds: float = 0.0        # Dauer der Lücke, in der das Foto liegt
    gap_meters: float = 0.0         # Luftlinie über diese Lücke hinweg


# Ab wann eine Zeitspanne zwischen zwei Punkten überhaupt als „Lücke" gilt.
# Ein Aufzeichnungstakt liegt bei 1–10 Sekunden; eine Minute Abstand ist schon
# ungewöhnlich. Darunter lohnt das Nachrechnen nicht.
GAP_MIN_SECONDS = 60.0

# Wie weit man sich in der Lücke bewegt haben darf, damit die Zuordnung noch
# als sicher gilt. 150 m sind ein Wirtshaus, ein Parkplatz, eine Gipfelrast —
# alles, wo man stehen bleibt und dort wieder herauskommt, wo man hineinging.
# Wer weiter kommt, war unterwegs — dann ist der nächstgelegene Punkt geraten.
GAP_MAX_METERS = 150.0


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371000.0
    p1, p2 = radians(lat1), radians(lat2)
    dp = radians(lat2 - lat1)
    dl = radians(lon2 - lon1)
    a = sin(dp / 2) ** 2 + cos(p1) * cos(p2) * sin(dl / 2) ** 2
    return 2 * R * atan2(sqrt(a), sqrt(1 - a))


def _track_times(points: List[TrackPoint]) -> list[datetime]:
    """ISO-Zeitstrings → datetime-Liste (UTC). Punkte ohne Time werden auf vorherigen Wert gesetzt."""
    out = []
    last = None
    for p in points:
        if p.time:
            last = datetime.fromisoformat(p.time)
        out.append(last)
    return out


def zeitzone_raten(photo_times, track, *, max_gap_seconds: float = 300.0) -> dict:
    """23.08.2026 (Beta-Tester) — Die fehlende Zeitzone aus dem Track ERRECHNEN,
    statt den Nutzer am Regler raten zu lassen.

    Ausgangslage: Kameras vor Exif 2.31 schreiben keinen `OffsetTimeOriginal`.
    Ihre Uhr ist richtig gestellt, es fehlt nur, wie weit sie von UTC weg war.
    Genau dieser Wert ist aber eine **Zeitzone** — ein glatter Vielfacher von
    15 Minuten zwischen −12 h und +14 h. Und der Track weiß, wann der Nutzer wo
    war. Also probieren wir alle Zeitzonen durch und nehmen die, bei der die
    Fotos am besten in den Track fallen.

    Rückgabe: {"minuten": int|None, "treffer": int, "gesamt": int,
               "eindeutig": bool, "kandidaten": [(minuten, treffer), …]}
    `eindeutig` ist False, wenn eine andere Zeitzone genauso gut passt — dann
    zeigt die Oberfläche den Vorschlag zurückhaltender an.
    """
    def _naiv_utc(t):
        # Echte GPX-Zeiten enden auf "Z" (aware), EXIF-Zeiten sind naive Lokalzeit.
        # Für den Vergleich alles auf naive UTC bringen — wie match_photos, nur
        # in die andere Richtung (dort wird die Fotozeit aware gemacht).
        return t.astimezone(timezone.utc).replace(tzinfo=None) if t.tzinfo else t

    zeiten = [_naiv_utc(t) for _p, t in photo_times if t is not None]
    tt = _track_times(track)
    if not zeiten or not tt or tt[0] is None:
        return {"minuten": None, "treffer": 0, "gesamt": len(zeiten), "eindeutig": False,
                "band": None, "kandidaten": []}
    t_von, t_bis = _naiv_utc(tt[0]), _naiv_utc(tt[-1])
    ergebnisse = []
    for minuten in range(-12 * 60, 14 * 60 + 1, 15):
        versatz = timedelta(minutes=minuten)
        treffer = 0
        summe = 0.0
        for z in zeiten:
            # Foto-Lokalzeit minus Zeitzone = UTC (wie in match_photos)
            u = z - versatz
            if t_von - timedelta(seconds=max_gap_seconds) <= u <= t_bis + timedelta(seconds=max_gap_seconds):
                treffer += 1
            else:
                summe += min(abs((u - t_von).total_seconds()), abs((u - t_bis).total_seconds()))
        ergebnisse.append((treffer, -summe, minuten))
    ergebnisse.sort(reverse=True)
    best = ergebnisse[0][0]
    leer = {"minuten": None, "treffer": 0, "gesamt": len(zeiten), "eindeutig": False,
            "band": None, "kandidaten": []}
    if best <= 0:
        return leer
    # Es passt nie GENAU eine Verschiebung, sondern immer ein Bereich: decken die
    # Fotos den ganzen Track ab, ist er schmal; stammen sie aus einer Stunde mitten
    # in einer Tagestour, ist er stundenbreit — dann ist jede Zahl geraten, und wir
    # schlagen lieber nichts vor, statt den Nutzer in die Irre zu schicken.
    gleich = sorted(m for tr, _s, m in ergebnisse if tr == best)
    band = gleich[-1] - gleich[0]
    if band > 120:
        leer["treffer"] = best
        leer["band"] = band
        return leer
    mitte = gleich[len(gleich) // 2]
    # Nur Verschiebungen anbieten, die es als Zeitzone GIBT: volle Stunden, halbe
    # (Indien +5:30, Iran +3:30) und :45 (Nepal, Chatham). :15 existiert nicht —
    # so eine Mitte entsteht nur durch eine leicht falsch gehende Uhr, dann ist
    # die nächste echte Zone die richtige Antwort. Unter den echten Zonen im
    # Bereich gewinnt die nächste an der Mitte; bei Gleichstand die "rundere".
    def _rang(m):
        return 0 if m % 60 == 0 else (1 if m % 30 == 0 else 2)
    echte = [m for m in gleich if m % 30 == 0 or m % 60 == 45] or gleich
    minuten = min(echte, key=lambda m: (abs(m - mitte), _rang(m), abs(m)))
    return {
        "minuten": minuten,
        "treffer": best,
        "gesamt": len(zeiten),
        "eindeutig": band <= 60,
        "band": band,
        "kandidaten": [(m, best) for m in gleich[:5]],
    }


def match_photos(
    photo_times: list[tuple[str, Optional[datetime]]],
    track: List[TrackPoint],
    offset_seconds: float = 0.0,
    max_gap_seconds: float = 600.0,
    tz_offset_seconds: float = 0.0,
    tz_known_paths: Optional[set] = None,
    offset_by_path: Optional[dict] = None,
) -> List[PhotoMatch]:
    """
    Matcht eine Liste von (Foto-Pfad, EXIF-Lokalzeit) gegen den Track.

    offset_seconds: positiv = Foto-Zeit liegt hinter der Track-Zeit (Kamera-Uhr nachgeht).
                    Wir addieren offset auf die Foto-Zeit, dann mit Track vergleichen.
                    Beispiel: Kamera ist 2 h zurück (TZ-Bug), Track ist UTC →
                    offset = +2 h, damit Foto-UTC stimmt.

    tz_offset_seconds: Zeitzonen-Versatz der KAMERA-Uhr (z.B. UTC+7 = +25200).
                    Wird von Fotos abgezogen, deren EXIF-Zeit KEINEN eingebetteten
                    Offset trug (Kamera speichert nur Lokalzeit, z.B. viele Olympus/
                    OM, GoPro). So wird die Lokalzeit auf die Track-UTC normiert,
                    ohne dass der User pro Import gefragt wird.
    tz_known_paths: Menge von Foto-Pfaden, deren EXIF-Zeit BEREITS auf UTC normiert
                    ist (hatte OffsetTimeOriginal o.ä.). Für die wird tz_offset
                    NICHT angewandt — sonst doppelte Korrektur → falsche GPS.

    max_gap_seconds: wenn nächster Trackpunkt > diesem Wert weg ist, in_range=False.
    """
    tzkn = tz_known_paths or set()
    tz_off = timedelta(seconds=tz_offset_seconds)
    times = _track_times(track)
    if not times or times[0] is None:
        # Track hat keine Zeiten — wir können nicht zuordnen
        return [
            PhotoMatch(
                path=p, photo_time_local=t, matched_time_utc=None,
                lat=None, lon=None, alt=None,
                track_index=None, time_delta_s=None, in_range=False,
            )
            for p, t in photo_times
        ]

    # Indexiere nur Punkte mit echter Zeit für bisect
    indexed = [(i, t) for i, t in enumerate(times) if t is not None]
    sorted_times = [t for _, t in indexed]
    sorted_indices = [i for i, _ in indexed]
    t_min, t_max = sorted_times[0], sorted_times[-1]

    matches: List[PhotoMatch] = []
    for path, ptime in photo_times:
        # v0.9.354 — Pro-Kamera-Offset: falls für diesen Pfad ein eigener Offset
        # vorliegt (Kamera-spezifisch), den nehmen, sonst den globalen Default.
        this_off_sec = offset_seconds
        if offset_by_path is not None and path in offset_by_path:
            this_off_sec = offset_by_path[path]
        off = timedelta(seconds=this_off_sec)
        if ptime is None:
            matches.append(PhotoMatch(
                path=path, photo_time_local=None, matched_time_utc=None,
                lat=None, lon=None, alt=None,
                track_index=None, time_delta_s=None, in_range=False,
            ))
            continue
        # Foto-Zeit + Offset = vergleichbare UTC-Zeit (Annahme: ptime naive = Kamera-Uhr,
        # offset bringt sie auf Track-UTC). Zusätzlich Zeitzonen-Versatz abziehen,
        # ABER nur wenn die Kamera die Zeitzone NICHT selbst gespeichert hat
        # (sonst ist ptime schon UTC → doppelte Korrektur = falsche Position).
        eff = off
        if tz_offset_seconds and path not in tzkn:
            eff = off - tz_off
        cmp_time = (ptime + eff).replace(tzinfo=timezone.utc)

        # bisect_left auf sorted_times — Vergleich datetime mit tz funktioniert wenn beide tz haben
        pos = bisect_left(sorted_times, cmp_time)
        # Kandidaten: pos-1 und pos
        cands = []
        if pos > 0:
            cands.append(pos - 1)
        if pos < len(sorted_times):
            cands.append(pos)
        if not cands:
            matches.append(PhotoMatch(
                path=path, photo_time_local=ptime, matched_time_utc=cmp_time,
                lat=None, lon=None, alt=None,
                track_index=None, time_delta_s=None, in_range=False,
            ))
            continue
        # nächster Punkt
        best = min(cands, key=lambda c: abs((sorted_times[c] - cmp_time).total_seconds()))
        delta = (sorted_times[best] - cmp_time).total_seconds()
        track_idx = sorted_indices[best]
        tp = track[track_idx]
        in_range = (t_min - timedelta(seconds=max_gap_seconds)) <= cmp_time <= (t_max + timedelta(seconds=max_gap_seconds))

        # Liegt das Foto ZWISCHEN zwei Aufzeichnungspunkten — also in einer
        # Lücke? Dann nachsehen, wie weit man in dieser Lücke gekommen ist.
        gap_s = 0.0
        gap_m = 0.0
        unsicher = False
        if in_range and pos > 0 and pos < len(sorted_times):
            vor_i, nach_i = sorted_indices[pos - 1], sorted_indices[pos]
            gap_s = (sorted_times[pos] - sorted_times[pos - 1]).total_seconds()
            if gap_s > GAP_MIN_SECONDS:
                a, b = track[vor_i], track[nach_i]
                gap_m = _haversine_m(a.lat, a.lon, b.lat, b.lon)
                # Kurze Strecke = Standzeit (Wirtshaus, Pause, Gipfelrast) →
                # der nächstgelegene Punkt ist die richtige Antwort.
                # Weite Strecke = es ging weiter → die Position ist geraten.
                unsicher = gap_m > GAP_MAX_METERS

        matches.append(PhotoMatch(
            path=path, photo_time_local=ptime, matched_time_utc=cmp_time,
            lat=tp.lat, lon=tp.lon, alt=tp.ele,
            track_index=track_idx, time_delta_s=delta, in_range=in_range,
            unsicher=unsicher, gap_seconds=gap_s if unsicher else 0.0,
            gap_meters=gap_m if unsicher else 0.0,
        ))
    return matches


def derive_offset_from_reference(
    reference_photo_time_local: datetime,
    reference_lat: float,
    reference_lon: float,
    track: List[TrackPoint],
) -> float:
    """
    User hat ein Referenz-Foto und klickt auf der Karte wo es WIRKLICH war.
    Wir suchen den Track-Punkt, der am nächsten an (lat,lon) liegt → seine Zeit.
    offset = track_time - photo_time → den müssen wir später auf alle Fotos addieren.

    Gibt offset in Sekunden zurück. Positiv = Kamera-Uhr geht nach.
    """
    times = _track_times(track)
    # Finde geographisch nächsten Trackpunkt mit Zeit
    best_idx = None
    best_d = float("inf")
    for i, p in enumerate(track):
        if times[i] is None:
            continue
        d = _haversine_m(reference_lat, reference_lon, p.lat, p.lon)
        if d < best_d:
            best_d = d
            best_idx = i
    if best_idx is None:
        raise ValueError("Track hat keine Punkte mit Zeitstempel")
    track_time = times[best_idx]
    # photo_time_local ist naive (Kamera-Uhr), wir behandeln sie als UTC-equivalent für die Differenz
    photo_as_utc = reference_photo_time_local.replace(tzinfo=timezone.utc)
    offset = (track_time - photo_as_utc).total_seconds()
    return offset
