"""GPX-Datei reparieren, die sich nicht mehr lesen lässt (10.09.2026, docs/TRACK-CHECK.md,
Befund `xml_broken`: „Datei beschädigt, reparierbar").

Was draußen wirklich vorkommt und hier gerichtet wird:
  * abgeschnitten — Übertragung abgebrochen, Logger-Akku leer: der letzte Punkt ist halb,
    `</trkseg></trk></gpx>` fehlen;
  * unmaskiertes `&` oder `<` im Text (Tour-Name „Rad & Wandern", „A < B");
  * fehlende oder falsche Kopfzeile (`<?xml …?>` weg, `<gpx>` ohne Namensraum, oder gar
    nur nackte `<trkpt>`-Zeilen);
  * Bytes, die kein Text sind (Nullbytes am Ende, wie sie ein voller Speicher hinterlässt).

Nicht repariert wird, was keine Punkte mehr enthält — dann gibt es nichts zu retten.
Das Ergebnis ist eine NEUE Datei (die Bibliothek legt sie als Version ab), die Datei
des Nutzers bleibt unangetastet.

    analysieren(data) -> {"lesbar": bool, "reparierbar": bool, "gruende": [key…], "n_points": int}
    reparieren(data)  -> {"ok": bool, "data": bytes, "schritte": [key…], "n_points": int, "error"?}

Schlüssel der Gründe/Schritte: truncated, unescaped_amp, unescaped_lt, no_header,
no_root, no_namespace, binary_tail.
"""
from __future__ import annotations

import re
from typing import List, Optional

_AMP_ROH = re.compile(r"&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)")
_LT_ROH = re.compile(r"<(?![/?!a-zA-Z])")
_LETZTER_PUNKT = re.compile(r"</(?:trkpt|rtept|wpt)\s*>", re.IGNORECASE)
_XMLNS = "http://www.topografix.com/GPX/1/1"


def _dekodieren(data: bytes) -> Optional[str]:
    if not data:
        return None
    if data.startswith(b"\xef\xbb\xbf"):
        data = data[3:]
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        try:
            return data.decode("latin-1")
        except UnicodeDecodeError:
            return None


def _parsen(text: str) -> int:
    """Anzahl Punkte, wenn gpxpy die Datei liest — sonst −1."""
    try:
        import gpxpy
        g = gpxpy.parse(text)
    except Exception:  # noqa: BLE001
        return -1
    n = 0
    for t in g.tracks:
        for s in t.segments:
            n += len(s.points)
    for r in g.routes:
        n += len(r.points)
    return n


def _tags_schliessen(text: str) -> str:
    """Offene gpx/trk/trkseg/rte-Tags von innen nach außen schließen."""
    offen = []
    for tag in ("gpx", "trk", "trkseg", "rte"):
        auf = len(re.findall(rf"<{tag}\b", text))
        zu = len(re.findall(rf"</{tag}\s*>", text))
        if auf > zu:
            offen.append(tag)
    for tag in ("trkseg", "trk", "rte", "gpx"):
        if tag in offen:
            text += f"\n</{tag}>"
    return text


def reparieren(data: bytes) -> dict:
    schritte: List[str] = []
    text = _dekodieren(data)
    if text is None:
        return {"ok": False, "error": "kein Text", "schritte": [], "n_points": 0}

    # 1) Nullbytes / Steuerzeichen am Ende (voller Speicher, harter Reset)
    if "\x00" in text:
        text = text.replace("\x00", "")
        schritte.append("binary_tail")
    text = "".join(ch for ch in text if ch >= " " or ch in "\t\r\n")

    if "<trkpt" not in text and "<rtept" not in text and "<wpt" not in text:
        return {"ok": False, "error": "keine Punkte in der Datei", "schritte": schritte, "n_points": 0}

    # 2) Unmaskierte Zeichen im Text
    if _AMP_ROH.search(text):
        text = _AMP_ROH.sub("&amp;", text)
        schritte.append("unescaped_amp")
    if _LT_ROH.search(text):
        text = _LT_ROH.sub("&lt;", text)
        schritte.append("unescaped_lt")

    # 3) Kopf und Wurzel
    kopf_ok = text.lstrip().startswith("<?xml")
    if "<gpx" not in text:
        rumpf = text.lstrip()
        if kopf_ok:
            rumpf = rumpf[rumpf.index("?>") + 2:] if "?>" in rumpf else rumpf
        inner = rumpf
        # `<trk` allein träfe auch `<trkpt` — deshalb mit Wortgrenze prüfen
        if not re.search(r"<trk\b", inner):
            inner = "<trk><trkseg>" + inner
        elif not re.search(r"<trkseg\b", inner):
            inner = re.sub(r"(<trk\b[^>]*>)", r"\1<trkseg>", inner, count=1)
        text = _tags_schliessen(f'<gpx version="1.1" creator="Reisezoom GPS Studio" xmlns="{_XMLNS}">' + inner)
        schritte.append("no_root")
    else:
        m = re.search(r"<gpx\b[^>]*>", text)
        if m and "xmlns" not in m.group(0):
            neu = m.group(0)[:-1].rstrip("/") + f' xmlns="{_XMLNS}">'
            text = text[:m.start()] + neu + text[m.end():]
            schritte.append("no_namespace")
    if not text.lstrip().startswith("<?xml"):
        text = '<?xml version="1.0" encoding="UTF-8"?>\n' + text.lstrip()
        schritte.append("no_header")

    # 4) Abgeschnitten: hinter dem letzten vollständigen Punkt alles weg, Tags schließen
    n = _parsen(text)
    if n < 0:
        treffer = list(_LETZTER_PUNKT.finditer(text))
        m = treffer[-1] if treffer else None
        if m is None:
            return {"ok": False, "error": "kein vollständiger Punkt", "schritte": schritte, "n_points": 0}
        text = _tags_schliessen(text[:m.end()])
        schritte.append("truncated")
        n = _parsen(text)
    if n <= 0:
        return {"ok": False, "error": "nach der Reparatur nicht lesbar", "schritte": schritte, "n_points": max(n, 0)}
    return {"ok": True, "data": text.encode("utf-8"), "schritte": schritte, "n_points": n}


def analysieren(data: bytes) -> dict:
    """Liest sich die Datei? Wenn nicht: ließe sie sich reparieren, und woran lag es?"""
    text = _dekodieren(data)
    n = _parsen(text) if text is not None else -1
    if n > 0:
        return {"lesbar": True, "reparierbar": False, "gruende": [], "n_points": n}
    r = reparieren(data)
    return {"lesbar": False, "reparierbar": bool(r.get("ok")), "gruende": list(r.get("schritte") or []),
            "n_points": int(r.get("n_points") or 0)}


def befund(gruende: List[str], n_points: int = 0) -> list:
    """Der Track-Check-Befund für die Bibliothek (Schlüssel `xml_broken`, rot)."""
    return [{"key": "xml_broken", "stufe": "rot", "n": 1, "detail": {"gruende": list(gruende or []), "n_points": int(n_points or 0)}}]
