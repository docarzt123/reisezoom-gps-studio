"""Videovorlagen als Datei: das Format `.rzstyle` (02.11.2026).

Warum: Die iPhone-App zeichnet dieselben Einblendungen (ui/js/container.js) und übernimmt die zehn Videovorlagen sowie
eigene Vorlagen als Dateien — Marc: „könnte man auf dem Desktop Vorlagen bauen und die ins iPhone übernehmen?“. Eine
Datei ist UTF-8-JSON mit englischen Schlüsseln; die Einblendungen selbst bleiben genau so, wie container.js sie
normalisiert. Texte stehen als Platzhalter drin, damit eine Vorlage für jede Tour und Sprache taugt:

    {title} {subtitle} {kicker}     Titel, Unterzeile, Kopfzeile der Tour
    {t:<key>}                       übersetzter Text, die Übersetzungen stehen unter "strings"
    in GROSSBUCHSTABEN ({KICKER}, {T:VV.GESCHAFFT}) → der eingesetzte Text wird groß geschrieben

Das Zusammenbauen der Einblendungen passiert im Browser (ui/js/rzstyle.js, mit rzVideoVorlagen.bauen); hier wird die
Datei vervollständigt (Namen, Übersetzungen), geprüft und beim Einlesen in eine eigene Vorlage zurückverwandelt.
Formatbeschreibung: docs/DEVELOPER.md, Abschnitt „rzstyle file format“.
"""
from __future__ import annotations

import json
import re
from typing import Callable

TYP = "rzstyle"
VERSION = 1
SPRACHEN = ("de", "en", "es")
FORMATE = ("16:9", "9:16", "1:1", "4:5", "4:3", "21:9")
MAX_BYTES = 8 * 1024 * 1024
MAX_CONTAINER = 60
# dieselbe Liste wie in app.py videovorlage_eigen_speichern — nur diese Linien-/Laufpunkt-Werte reisen mit
ANIMATOR_SCHLUESSEL = ("line_color", "line_width", "kontur_breite", "kontur_farbe", "ghost_track_enabled", "ghost_track_color",
                       "ghost_track_opacity_pct", "linien_look", "schweif_pct", "highlights_farbe", "highlights_stil",
                       "marker_dot_style", "bergnamen_an")
_PLATZHALTER = re.compile(r"\{(t:[A-Za-z0-9_.\-]+|title|subtitle|kicker)\}", re.IGNORECASE)
_KEY = re.compile(r"^[a-z0-9_.\-]{1,120}$")


class RzStyleFehler(ValueError):
    """Datei ist kein (lesbares) .rzstyle."""


def dateiname(name: str, standard: str = "Style") -> str:
    """Name → sicherer Dateiname mit Endung .rzstyle (Umlaute bleiben, Pfadzeichen nicht)."""
    s = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', " ", str(name or "")).strip(" .") or standard
    return s[:80] + ".rzstyle"


def vervollstaendigen(stil: dict, schluessel: dict, uebersetzer: Callable[[str], Callable[[str, str], str]],
                      app_version: str) -> dict:
    """Die vom Browser gebaute Vorlage zur Datei machen: Kopf, Namen in allen Sprachen (eingebaute), Übersetzungen
    aller benutzten Schlüssel. `schluessel` = {key: deutscher Ersatztext} aus dem Platzhalter-t;
    `uebersetzer(code)` liefert t(key, fallback) einer Sprache."""
    if not isinstance(stil, dict) or not isinstance(stil.get("formats"), dict) or not stil["formats"]:
        raise RzStyleFehler("formats fehlt")
    eingebaut = bool(stil.get("builtin"))
    vid = str(stil.get("id") or "").strip()[:60]
    name = str(stil.get("name") or vid or "Style").strip()[:60]
    keys = {str(k): str(v or "") for k, v in (schluessel or {}).items() if _KEY.match(str(k))}
    ts = {code: uebersetzer(code) for code in SPRACHEN}
    if eingebaut:
        keys.setdefault("vv.name." + vid, name)
    strings = {code: {k: ts[code](k, d) for k, d in sorted(keys.items())} for code in SPRACHEN}
    formats = {}
    for f, inhalt in stil["formats"].items():
        if f in FORMATE and isinstance(inhalt, dict) and isinstance(inhalt.get("container"), list):
            formats[f] = {"container": inhalt["container"][:MAX_CONTAINER],
                          "verlauf": inhalt.get("verlauf") if isinstance(inhalt.get("verlauf"), dict) else None}
    if not formats:
        raise RzStyleFehler("kein gültiges Format")
    vorschau = stil.get("preview")
    return {
        "type": TYP,
        "version": VERSION,
        "id": vid,
        "name": name,
        "names": {code: ts[code]("vv.name." + vid, name) for code in SPRACHEN} if eingebaut else None,
        "builtin": eingebaut,
        "app_version": str(app_version or ""),
        "palette": stil.get("palette") if eingebaut and isinstance(stil.get("palette"), dict) else None,
        "animator": {k: v for k, v in (stil.get("animator") or {}).items() if k in ANIMATOR_SCHLUESSEL},
        "formats": formats,
        "strings": strings,
        "fonts": sorted({str(x) for x in (stil.get("fonts") or []) if isinstance(x, str)}),
        "preview": vorschau if isinstance(vorschau, str) and vorschau.startswith("data:image/") and len(vorschau) < 400_000 else None,
    }


def lesen(roh: bytes | str) -> dict:
    """Datei-Inhalt → geprüftes dict. Wirft RzStyleFehler mit kurzem Grund."""
    if isinstance(roh, bytes):
        if len(roh) > MAX_BYTES:
            raise RzStyleFehler("zu groß")
        roh = roh.decode("utf-8-sig", errors="strict")
    try:
        d = json.loads(roh)
    except (ValueError, TypeError) as e:
        raise RzStyleFehler("kein JSON") from e
    if not isinstance(d, dict) or d.get("type") != TYP:
        raise RzStyleFehler("kein rzstyle")
    try:
        v = int(d.get("version") or 0)
    except (TypeError, ValueError):
        v = 0
    if v < 1 or v > VERSION:
        raise RzStyleFehler(f"Version {d.get('version')!r} unbekannt")
    if not isinstance(d.get("formats"), dict) or not any(
            isinstance(x, dict) and isinstance(x.get("container"), list) for x in d["formats"].values()):
        raise RzStyleFehler("formats fehlt")
    return d


def _ersetzen(text: str, strings: dict, sprache: str, frei: dict) -> str:
    """Platzhalter in einem Text einsetzen. `frei` = Werte für title/subtitle/kicker (None = Platzhalter stehen lassen)."""
    def ein(m):
        roh = m.group(1)
        gross = roh.isupper()
        k = roh.lower()
        if k.startswith("t:"):
            key = k[2:]
            wert = None
            for code in (sprache, "en", "de"):
                wert = (strings.get(code) or {}).get(key)
                if wert:
                    break
            wert = wert if wert else key
        else:
            if frei.get(k) is None:
                return m.group(0)
            wert = frei[k]
        return wert.upper() if gross else wert
    return _PLATZHALTER.sub(ein, text)


def als_eigene_vorlage(d: dict, sprache: str, format_wunsch: str = "") -> tuple[str, dict]:
    """Gelesene Datei → (Name, daten) für videovorlage_eigen_speichern. Gewählt wird das gewünschte Format, sonst 16:9,
    sonst das erste. Übersetzungen werden in `sprache` eingesetzt; Unterzeile/Kopfzeile gibt es bei eigenen Vorlagen
    nicht — Zeilen, die dadurch leer werden, fallen weg (und Einblendungen, die dadurch keine Zeile mehr haben).
    {title} bleibt als `titel_alt` stehen: beim Anwenden wird daraus der Titel der Tour."""
    formats = {f: x for f, x in d["formats"].items() if isinstance(x, dict) and isinstance(x.get("container"), list)}
    f = format_wunsch if format_wunsch in formats else ("16:9" if "16:9" in formats else next(iter(formats)))
    strings = d.get("strings") if isinstance(d.get("strings"), dict) else {}
    frei = {"title": None, "subtitle": "", "kicker": ""}

    def tief(x):
        if isinstance(x, str):
            return _ersetzen(x, strings, sprache, frei)
        if isinstance(x, list):
            return [tief(y) for y in x]
        if isinstance(x, dict):
            return {k: tief(v) for k, v in x.items()}
        return x

    container = []
    for c in formats[f]["container"][:MAX_CONTAINER]:
        if not isinstance(c, dict):
            continue
        zeilen_vorher = c.get("zeilen") if isinstance(c.get("zeilen"), list) else []
        neu = tief(c)
        zeilen = []
        for alt, z in zip(zeilen_vorher, neu.get("zeilen") or []):
            if (isinstance(z, dict) and z.get("typ") == "text" and isinstance(alt, dict)
                    and _PLATZHALTER.search(str(alt.get("text") or "")) and not str(z.get("text") or "").strip()):
                continue
            zeilen.append(z)
        if zeilen_vorher and not zeilen:
            continue
        neu["zeilen"] = zeilen
        container.append(neu)
    names = d.get("names") if isinstance(d.get("names"), dict) else {}
    name = str(names.get(sprache) or d.get("name") or "Style").strip()[:60]
    anim = {k: v for k, v in (d.get("animator") or {}).items() if k in ANIMATOR_SCHLUESSEL}
    verlauf = formats[f].get("verlauf")
    return name, {"container": container, "verlauf": verlauf if isinstance(verlauf, dict) else None,
                  "animator": anim, "titel_alt": "{title}", "format": f}
