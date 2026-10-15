"""Import-Assistent: der Eingangsordner (15.10.2026).

Marc nach einer Wanderung: Komoot-Track, ein paar Fotos und Clips „einfach irgendwo nur hinlegen. Das alles wird
reingezogen …, die Fotos werden getaggt, vielleicht auch die Videos“. Der Nutzer bestimmt einen Eingangsordner und
startet den Assistenten von Hand. Hier liegt nur, was keine App-Zustände braucht:

  inhalt()          was liegt im Eingang (Tracks, Fotos, Videos, Sonstiges) — rekursiv, versteckte Dateien nicht
  zeiten_lesen()    Aufnahmezeit, Zeitzone bekannt?, eigenes GPS je Foto/Clip
  zuordnen()        Fotos/Clips per Zeit auf den Track (core/geotag), fehlende Kamera-Zeitzone aus dem Track errechnet
  tour_ordnername() „2026-10-14 Rund um Wenholthausen“ — Zielordner im Archiv, ohne Zeichen, die Dateisysteme stören
  frei()            ein freier Pfad (Name_2, Name_3 …), nie überschreiben

Verschieben, Schreiben und Einlesen macht app.py (`eingang_uebernehmen`) — dort sitzen Dateischutz und Archiv.
"""
from __future__ import annotations

import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from core import exif as cexif
from core import geotag as cgeo

# Track-Endungen wie beim Einlesen (core/imports._DISPATCH + .gpx), ohne die mehrdeutigen (.json/.txt/.log könnten alles
# sein — die gehören nicht ungefragt ins Archiv)
TRACK_EXTS = {".gpx", ".fit", ".tcx", ".kml", ".kmz", ".igc", ".nmea", ".geojson", ".srt"}
FOTO_EXTS = set(cexif.ALL_PHOTO_EXTS)
VIDEO_EXTS = set(cexif.VIDEO_EXTS)
# Begleiter, die mit ihrem Foto umziehen (Lightroom-/Kamera-Sidecar), aber selbst nichts zuordnen
BEGLEITER_EXTS = {".xmp", ".aae", ".thm", ".lrv"}


def art_von(pfad: str) -> str:
    e = os.path.splitext(pfad)[1].lower()
    if e in TRACK_EXTS:
        return "track"
    if e in VIDEO_EXTS:
        return "video"
    if e in FOTO_EXTS:
        return "foto"
    if e in BEGLEITER_EXTS:
        return "begleiter"
    return "sonst"


def inhalt(ordner: str) -> dict:
    """{tracks, fotos, videos, begleiter, sonst}: Pfade, sortiert. Versteckte Dateien/Ordner (.DS_Store, ._*) zählen nicht."""
    raus = {"tracks": [], "fotos": [], "videos": [], "begleiter": [], "sonst": []}
    wurzel = Path(ordner).expanduser()
    if not wurzel.is_dir():
        return raus
    for d, unter, dateien in os.walk(wurzel):
        unter[:] = sorted(u for u in unter if not u.startswith("."))
        for f in sorted(dateien):
            if f.startswith("."):
                continue
            p = str(Path(d) / f)
            a = art_von(p)
            raus[{"track": "tracks", "foto": "fotos", "video": "videos", "begleiter": "begleiter"}.get(a, "sonst")].append(p)
    return raus


def zeiten_lesen(pfade: list[str]) -> list[dict]:
    """Je Datei: {pfad, name, art, zeit (ISO, UTC wenn tz_bekannt, sonst Kamera-Lokalzeit), tz_bekannt, tz_min, gps}."""
    raus = []
    for p in pfade:
        dt, tz_min = None, None
        try:
            dt, tz_min = cexif.read_datetime_and_tz_min(p)
        except Exception:  # noqa: BLE001 — Datei ohne lesbare Zeit: bleibt dabei, nur ohne Zuordnung
            dt, tz_min = None, None
        gps = None
        try:
            g = cexif.read_gps(p)
            if g and g[0] is not None and g[1] is not None and not (abs(g[0]) < 1e-9 and abs(g[1]) < 1e-9):
                gps = {"lat": float(g[0]), "lon": float(g[1]), "alt": (float(g[2]) if g[2] is not None else None)}
        except Exception:  # noqa: BLE001
            gps = None
        raus.append({"pfad": p, "name": Path(p).name, "art": "video" if cexif.is_video(p) else "foto",
                     "zeit": dt.isoformat() if dt else None, "tz_bekannt": tz_min is not None, "tz_min": tz_min,
                     "gps": gps})
    return raus


def zeit(t) -> Optional[datetime]:
    """Trackpunkt-Zeit (ISO-Text oder datetime) → datetime mit Zeitzone (ohne Angabe: UTC)."""
    if t is None or t == "":
        return None
    try:
        d = t if isinstance(t, datetime) else datetime.fromisoformat(str(t).replace("Z", "+00:00"))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def _naiv(t: Optional[datetime]) -> Optional[datetime]:
    if t is None:
        return None
    return t.astimezone(timezone.utc).replace(tzinfo=None) if t.tzinfo else t


def zuordnen(medien: list[dict], punkte: list, *, versatz_s: float = 0.0, tz_min: Optional[float] = None,
             max_luecke_s: float = 600.0) -> dict:
    """Fotos/Clips (aus `zeiten_lesen`) per Aufnahmezeit auf den Track legen.

    Fehlt der Kamera die Zeitzone (tz_bekannt False), errechnet `zeitzone_raten` sie aus dem Track — dieselbe Logik wie
    im Geotagger. `tz_min` gibt sie fest vor. Ein Foto mit eigenem GPS behält seine Position (`quelle` "exif").
    Rückgabe: {zeitzone: {minuten, eindeutig, treffer, gesamt}, treffer: [{pfad, lat, lon, alt, im_track, quelle,
    zeit_utc}]}"""
    phs = [(m["pfad"], datetime.fromisoformat(m["zeit"]) if m.get("zeit") else None) for m in medien]
    bekannt = {m["pfad"] for m in medien if m.get("tz_bekannt")}
    zone = {"minuten": None, "eindeutig": False, "treffer": 0, "gesamt": 0}
    if tz_min is None:
        ohne = [(p, t) for p, t in phs if p not in bekannt and t is not None]
        if ohne and punkte:
            r = cgeo.zeitzone_raten(ohne, punkte, max_gap_seconds=max(300.0, max_luecke_s))
            zone = {k: r.get(k) for k in ("minuten", "eindeutig", "treffer", "gesamt")}
            tz_min = r.get("minuten")
    else:
        zone = {"minuten": tz_min, "eindeutig": True, "treffer": 0, "gesamt": 0}
    ms = cgeo.match_photos(phs, punkte, offset_seconds=float(versatz_s or 0), max_gap_seconds=max_luecke_s,
                           tz_offset_seconds=float(tz_min or 0) * 60.0, tz_known_paths=bekannt) if punkte else []
    nach_pfad = {m.path: m for m in ms}
    treffer = []
    for m in medien:
        pm = nach_pfad.get(m["pfad"])
        eigen = m.get("gps")
        if eigen:
            treffer.append({"pfad": m["pfad"], "lat": eigen["lat"], "lon": eigen["lon"], "alt": eigen.get("alt"),
                            "im_track": True, "quelle": "exif",
                            "zeit_utc": pm.matched_time_utc.isoformat() if pm and pm.matched_time_utc else None})
        elif pm and pm.in_range and pm.lat is not None:
            treffer.append({"pfad": m["pfad"], "lat": pm.lat, "lon": pm.lon, "alt": pm.alt, "im_track": True,
                            "quelle": "track", "zeit_utc": pm.matched_time_utc.isoformat() if pm.matched_time_utc else None})
        else:
            treffer.append({"pfad": m["pfad"], "lat": None, "lon": None, "alt": None, "im_track": False,
                            "quelle": "ohne_zeit" if not m.get("zeit") else "ausserhalb", "zeit_utc": None})
    return {"zeitzone": zone, "treffer": treffer}


_VERBOTEN = re.compile(r'[\\/:*?"<>|\x00-\x1f]+')


def tour_ordnername(datum: str, titel: str) -> str:
    """„2026-10-14 Rund um Wenholthausen“ — ohne Zeichen, die macOS/Windows/Cloud-Ordner stören, höchstens 80 Zeichen."""
    t = _VERBOTEN.sub(" ", str(titel or "")).strip().strip(".")
    t = re.sub(r"\s+", " ", t)[:80].strip()
    d = str(datum or "").strip()
    return (f"{d} {t}" if d and t else (d or t or "Tour")).strip()


def frei(pfad: Path) -> Path:
    """Freier Pfad: pfad, sonst Name_2, Name_3 … (Dateien und Ordner)."""
    p = Path(pfad)
    if not os.path.lexists(p):
        return p
    stamm, endung = (p.stem, p.suffix) if p.suffix and not p.is_dir() else (p.name, "")
    n = 2
    while True:
        q = p.with_name(f"{stamm}_{n}{endung}")
        if not os.path.lexists(q):
            return q
        n += 1


def begleiter_von(pfad: str, alle: list[str]) -> list[str]:
    """Sidecars, die zu einem Foto gehören: NAME.xmp / NAME.EXT.xmp / NAME.aae … im selben Ordner."""
    p = Path(pfad)
    raus = []
    for b in alle:
        q = Path(b)
        if q.parent != p.parent:
            continue
        s = q.name.lower()
        if s.startswith(p.stem.lower() + ".") and q.suffix.lower() in BEGLEITER_EXTS:
            raus.append(b)
    return raus
