"""„Frag GPS Studio“ — das Handbuch als Suchquelle (19.10.2026).

Die Hilfesuche in der Oberfläche (ui/js/fragen.js) durchsucht das Handbuch und die Beschriftungen der Knöpfe —
ohne Sprachmodell, ohne Netz. Dieses Modul liefert ihr das Handbuch in Absätzen: jede Überschrift mit ihrem Anker
(derselbe `id`, den der Handbuch-Sprung `open_user_guide(anker)` braucht) und ihrem Überschriften-Pfad, darunter die
Absätze, Listenpunkte, Hinweiskästen und Tabellenzeilen als reiner Text.

Quelle ist bewusst die **HTML-Fassung** (docs/USER_GUIDE[.en|.es].html): Nur sie liegt im fertigen App-Bündel, und
ihre Anker sind genau die, auf die der Sprung ins Handbuch zielt. Die Markdown-Quelle fehlt im Bündel.

Das Ergebnis wird je Datei und Änderungszeit zwischengespeichert — die Suche fragt einmal je Sitzung und Sprache.
"""
from __future__ import annotations

import re
from html.parser import HTMLParser
from pathlib import Path

# Bild-/Deko-Zeichen aus Überschriften (Emojis, Sterne, Pfeile) — für die Anzeige im Suchergebnis
_DEKO = re.compile("[\U0001F000-\U0001FAFF☀-➿⬀-⯿️‍←-⇿■-◿]")
_BLOCK = {"p", "li", "blockquote", "tr", "figcaption", "dd", "dt"}
_KOPF = {"h1": 1, "h2": 2, "h3": 3, "h4": 4, "h5": 5}
_LEER = re.compile(r"\s+")


def kopf_sauber(text: str) -> str:
    """Überschrift ohne Emojis/Deko, ohne doppelte Leerzeichen."""
    s = _DEKO.sub("", text or "")
    s = _LEER.sub(" ", s).strip(" \t·—-–")
    return s


class _Zerleger(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.abschnitte: list[dict] = []     # {"a": anker, "pfad": [h2, h3, …]}
        self.bloecke: list[list] = []        # [abschnitt_index, text]
        self._pfad: list[tuple[int, str]] = []
        self._in_main = 0
        self._skip = 0                       # <pre>, <script>, <style>, <aside>, <nav>
        self._kopf: tuple[int, str] | None = None
        self._kopf_text: list[str] = []
        self._text: list[str] = []
        self._tiefe = 0                      # offene Blöcke (verschachtelte Listen)

    # ── Hilfen ──
    def _abschliessen(self) -> None:
        txt = _LEER.sub(" ", "".join(self._text)).strip()
        self._text = []
        if len(txt) < 3 or not self.abschnitte:
            return
        self.bloecke.append([len(self.abschnitte) - 1, txt])

    def handle_starttag(self, tag, attrs):
        if tag == "main":
            self._in_main += 1
            return
        if not self._in_main:
            return
        if tag in ("pre", "script", "style", "aside", "nav"):
            self._skip += 1
            return
        if self._skip:
            return
        if tag in _KOPF:
            self._abschliessen()
            self._kopf = (_KOPF[tag], dict(attrs).get("id") or "")
            self._kopf_text = []
            return
        if tag in _BLOCK:
            self._abschliessen()            # Text eines umgebenden Listenpunkts vor der Unterliste
            self._tiefe += 1
        elif tag in ("td", "th"):
            self._text.append(" · " if self._text else "")
        elif tag == "br":
            self._text.append(" ")

    def handle_endtag(self, tag):
        if tag == "main":
            self._in_main = max(0, self._in_main - 1)
            return
        if not self._in_main:
            return
        if tag in ("pre", "script", "style", "aside", "nav"):
            self._skip = max(0, self._skip - 1)
            return
        if self._skip:
            return
        if tag in _KOPF and self._kopf:
            ebene, anker = self._kopf
            text = kopf_sauber("".join(self._kopf_text))
            self._pfad = [(e, t) for e, t in self._pfad if e < ebene] + [(ebene, text)]
            # Ebene 1 ist der Titel des Handbuchs — nur für die Einleitung davor sichtbar
            pfad = [t for e, t in self._pfad if e > 1] or [t for _e, t in self._pfad]
            self.abschnitte.append({"a": anker, "pfad": pfad})
            self._kopf = None
            return
        if tag in _BLOCK:
            self._abschliessen()
            self._tiefe = max(0, self._tiefe - 1)

    def handle_data(self, data):
        if not self._in_main or self._skip:
            return
        if self._kopf is not None:
            self._kopf_text.append(data)
        else:
            self._text.append(data)


def zerlegen(html: str) -> dict:
    """HTML-Handbuch → {"abschnitte": [{a, pfad}], "bloecke": [[abschnitt, text]]}."""
    z = _Zerleger()
    z.feed(html or "")
    z.close()
    z._abschliessen()
    return {"abschnitte": z.abschnitte, "bloecke": z.bloecke}


_SCHLUESSEL = re.compile(r"""["'`]([a-z][a-z0-9_]*(?:\.[A-Za-z0-9_]+)+)["'`]""")
_BENUTZT: dict[str, list] = {}


def benutzte_schluessel(wurzel: Path, vorrat: set) -> list:
    """i18n-Schlüssel, die im Oberflächen-Code wörtlich vorkommen (ui/js, modules/*/ui) — nur sie kommen als Knopf-
    Beschriftung für „Zeig mir“ in Frage. Verwaiste Einträge in den Sprachdateien führten sonst zu Treffern ohne
    Gegenstück in der App. Zusammengesetzte Schlüssel (`"look." + name`) fehlen hier; die wichtigen Stellen stehen in der
    Ziel-Tabelle von ui/js/fragen.js."""
    w = Path(wurzel)
    if str(w) in _BENUTZT:
        return _BENUTZT[str(w)]
    gefunden: set = set()
    for p in list((w / "ui" / "js").glob("*.js")) + list((w / "modules").glob("*/ui/*.js")):
        try:
            gefunden.update(_SCHLUESSEL.findall(p.read_text(encoding="utf-8")))
        except OSError:
            continue
    _BENUTZT[str(w)] = sorted(gefunden & set(vorrat))
    return _BENUTZT[str(w)]


_CACHE: dict[tuple[str, float], dict] = {}


def handbuch(pfad: Path) -> dict:
    """Zerlegtes Handbuch aus einer HTML-Datei (zwischengespeichert je Datei + Änderungszeit)."""
    p = Path(pfad)
    schluessel = (str(p.resolve()), p.stat().st_mtime)
    if schluessel not in _CACHE:
        _CACHE.clear()                       # nur die aktuelle Sprache behalten
        _CACHE[schluessel] = zerlegen(p.read_text(encoding="utf-8"))
    return _CACHE[schluessel]
