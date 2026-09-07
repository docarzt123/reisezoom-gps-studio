"""Verlustfreie GPX-Ausgabe (07.09.2026, FOSSGIS-Testfall route-3.gpx).

Die Werkzeuge (Höhen ergänzen, Kürzen, Ausdünnen, Säubern, Zeiten, …) arbeiten auf
Punkt-Dicts und schrieben das Ergebnis bisher als NEUE GPX (ein Track, ein Segment,
creator „Reisezoom GPS Studio"). Dabei gingen `<metadata>` (Name, Zeit, Links,
Copyright, Lizenz), Track-Namen, Wegpunkte, Routen, fremde Namensräume und Punkt-
Erweiterungen verloren — beim FOSSGIS-Test flog so die OpenStreetMap-Lizenzangabe
raus. Marc, 07.09.2026: „das gilt vermutlich für alle Webdienste, korrigieren".

Zwei Wege, beide auf der ORIGINALDATEI:
  A) Punktmenge unverändert (gleiche Zahl, gleiche Koordinaten, gleiche Reihenfolge):
     nur `<ele>`/`<time>` an den Punkten setzen — alles andere bleibt Byte für Byte
     dieselbe Struktur (Kommentare fallen dem XML-Parser zum Opfer).
  B) Punktmenge verändert (Kürzen, Ausdünnen, Umkehren, Zusammenfügen, Teilen):
     Wurzel, `<metadata>`, `<wpt>`, `<rte>`, `<extensions>` und der Kopf des ersten
     Tracks (Name, Beschreibung, Typ, Erweiterungen) bleiben; die Punkte werden
     neu gesetzt — Punkte, die es im Original gab (Index `i` + Koordinaten), werden
     samt ihrer Erweiterungen übernommen, Segmentgrenzen aus `seg` gebildet.
Kein GPX als Original (FIT/KML/…): der Aufrufer nimmt den bisherigen Weg.
"""
from __future__ import annotations

import copy
import re
import xml.etree.ElementTree as ET
from datetime import timezone
from typing import Optional

from . import trackio as _tio

GPX_NS = "http://www.topografix.com/GPX/1/1"
_TOL = 1e-6          # Koordinaten-Toleranz (7 Nachkommastellen im Schreiber)
_KOPF_TAGS = ("name", "cmt", "desc", "src", "link", "number", "type", "extensions")   # Reihenfolge laut GPX 1.1
_PUNKT_ORDER = ("ele", "time", "magvar", "geoidheight", "name", "cmt", "desc", "src", "link", "sym", "type",
                "fix", "sat", "hdop", "vdop", "pdop", "ageofdgpsdata", "dgpsid", "extensions")


def ist_gpx(raw) -> bool:
    try:
        head = (raw if isinstance(raw, str) else raw.decode("utf-8", "ignore"))[:4000]
    except Exception:  # noqa: BLE001
        return False
    return "<gpx" in head


def _register(raw: str) -> None:
    for prefix, uri in re.findall(r'xmlns:([\w.-]+)="([^"]+)"', raw):
        try:
            ET.register_namespace(prefix, uri)
        except ValueError:
            pass
    ET.register_namespace("", GPX_NS)


def _ns(root) -> str:
    m = re.match(r"\{([^}]+)\}", root.tag)
    return m.group(1) if m else ""


def _q(ns: str, tag: str) -> str:
    return f"{{{ns}}}{tag}" if ns else tag


def _local(tag: str) -> str:
    return tag.split("}", 1)[1] if "}" in tag else tag


def _setze_kind(el, ns: str, tag: str, text: Optional[str]) -> None:
    """Kind `tag` setzen/ersetzen/entfernen — an der Stelle, die das GPX-Schema vorsieht."""
    k = _q(ns, tag)
    vorhanden = el.find(k)
    if text is None:
        if vorhanden is not None:
            el.remove(vorhanden)
        return
    if vorhanden is not None:
        vorhanden.text = text
        return
    neu = ET.Element(k)
    neu.text = text
    rang = _PUNKT_ORDER.index(tag) if tag in _PUNKT_ORDER else len(_PUNKT_ORDER)
    pos = 0
    for i, kind in enumerate(list(el)):
        lt = _local(kind.tag)
        r = _PUNKT_ORDER.index(lt) if lt in _PUNKT_ORDER else len(_PUNKT_ORDER)
        if r <= rang:
            pos = i + 1
    el.insert(pos, neu)


def _ele_text(v) -> Optional[str]:
    if v is None:
        return None
    try:
        return f"{float(v):.2f}"
    except (TypeError, ValueError):
        return None


def _time_text(v) -> Optional[str]:
    dt = _tio._parse_iso(v) if v else None
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if dt is not None else None


def _koord(el):
    try:
        return float(el.get("lat")), float(el.get("lon"))
    except (TypeError, ValueError):
        return None


def _gleich(a, b) -> bool:
    return a is not None and b is not None and abs(a[0] - b[0]) < _TOL and abs(a[1] - b[1]) < _TOL


def _punkt_aktualisieren(el, ns: str, p: dict, *, zeit_setzen: bool) -> None:
    ele = _ele_text(p.get("ele"))
    if ele is not None:
        _setze_kind(el, ns, "ele", ele)
    if zeit_setzen:
        t = _time_text(p.get("time"))
        if t is not None:
            _setze_kind(el, ns, "time", t)


def _neuer_punkt(ns: str, p: dict):
    el = ET.Element(_q(ns, "trkpt"), {"lat": f"{float(p['lat']):.7f}", "lon": f"{float(p['lon']):.7f}"})
    ele = _ele_text(p.get("ele"))
    if ele is not None:
        ET.SubElement(el, _q(ns, "ele")).text = ele
    t = _time_text(p.get("time"))
    if t is not None:
        ET.SubElement(el, _q(ns, "time")).text = t
    ext = _tio._point_extensions(p)
    if ext:
        try:
            frag = ET.fromstring(ext.replace("<extensions>", f'<extensions xmlns:gpxtpx="{_tio._GPXTPX_NS}" xmlns:gpxpx="{_tio._GPXPX_NS}">', 1))
            frag.tag = _q(ns, "extensions")
            el.append(frag)
        except ET.ParseError:
            pass
    return el


def gpx_mit_punkten(original, points, *, name: Optional[str] = None, creator: Optional[str] = None,
                    zeit_setzen: bool = True) -> str:
    """Original-GPX mit den Ergebnispunkten zurückgeben (Weg A oder B, s. Modulkopf).
    `name` überschreibt den Track-Namen nur, wenn angegeben. Wirft ValueError, wenn das
    Original kein GPX ist — der Aufrufer fällt dann auf trackio.to_gpx_string zurück."""
    raw = original.decode("utf-8", "replace") if isinstance(original, (bytes, bytearray)) else str(original)
    if "<gpx" not in raw[:4000]:
        raise ValueError("kein GPX")
    _register(raw)
    root = ET.fromstring(raw.encode("utf-8"))
    ns = _ns(root)
    if _local(root.tag) != "gpx":
        raise ValueError("kein GPX")
    pts = [p for p in points if p.get("lat") is not None and p.get("lon") is not None]
    alle = list(root.iter(_q(ns, "trkpt")))

    unveraendert = len(alle) == len(pts) and all(_gleich(_koord(el), (float(p["lat"]), float(p["lon"]))) for el, p in zip(alle, pts))
    if unveraendert:
        for el, p in zip(alle, pts):
            _punkt_aktualisieren(el, ns, p, zeit_setzen=zeit_setzen)
        if name:
            trk = root.find(_q(ns, "trk"))
            if trk is not None:
                _setze_kind(trk, ns, "name", name)
    else:
        # Weg B: Kopf übernehmen, Punkte neu setzen, Originalpunkte (Index + Koordinaten) mitnehmen
        trks = root.findall(_q(ns, "trk"))
        kopf = []
        if trks:
            for kind in list(trks[0]):
                if _local(kind.tag) in _KOPF_TAGS:
                    kopf.append(copy.deepcopy(kind))
        for trk in trks:
            root.remove(trk)
        trk = ET.SubElement(root, _q(ns, "trk"))
        for kind in kopf:
            trk.append(kind)
        if name:
            _setze_kind(trk, ns, "name", name)
        elif trk.find(_q(ns, "name")) is None:
            _setze_kind(trk, ns, "name", "Track")
        seg_el = None
        letzte_seg = None
        for p in pts:
            s = p.get("seg")
            if seg_el is None or (s is not None and s != letzte_seg):
                seg_el = ET.SubElement(trk, _q(ns, "trkseg"))
                letzte_seg = s
            i = p.get("i")
            orig = alle[i] if isinstance(i, int) and 0 <= i < len(alle) else None
            if orig is not None and _gleich(_koord(orig), (float(p["lat"]), float(p["lon"]))):
                el = copy.deepcopy(orig)
                _punkt_aktualisieren(el, ns, p, zeit_setzen=zeit_setzen)
            else:
                el = _neuer_punkt(ns, p)
            seg_el.append(el)
    if creator:
        root.set("creator", creator)
    elif not root.get("creator"):
        root.set("creator", "Reisezoom GPS Studio")
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding="unicode") + "\n"
