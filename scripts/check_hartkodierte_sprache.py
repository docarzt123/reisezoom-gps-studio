#!/usr/bin/env python3
"""Findet sichtbaren Text, der an der Übersetzung vorbeigeht.

Anlass (Marc, 28.08.2026): „geh das ganze tool durch und stelle sicher, dass
nirgends sprache hardcodiert ist." Ausgelöst hat es ein Beta-Tester aus Spanien:
In seiner spanischen Oberfläche stand der Knopf „Track wählen …" auf Deutsch —
ihm „schon seit mehreren Versionen" aufgefallen, uns nie, weil wir die App auf
Deutsch benutzen.

Wie geprüft wird
----------------
Gesucht wird nach deutschen Zeichenketten, die als **sichtbarer Text** im
Markup landen: zwischen Tags (`>Text<`), in `title=`, `placeholder=`,
`aria-label=`, oder als Argument von `toast(...)`, `textContent = ...`.

Nicht gemeldet wird:
* der **zweite** Parameter von `t(...)` / `T(...)` — das ist der Rückfallwert,
  der genau dann greift, wenn eine Übersetzung fehlt; er MUSS deutsch sein.
* Kommentare (auch mehrzeilige) — der Code ist auf Deutsch dokumentiert.
* Zeichenketten ohne deutsche Merkmale (Zahlen, CSS, IDs, Emoji).

Aufruf:
    .venv/bin/python scripts/check_hartkodierte_sprache.py          # Bericht
    .venv/bin/python scripts/check_hartkodierte_sprache.py --strict # Exit 1 bei Fund
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

DATEIEN = (
    list((ROOT / "ui" / "js").glob("*.js"))
    + list((ROOT / "modules").glob("*/ui/*.js"))
    + [ROOT / "ui" / "index.html"]
)

# Deutsche Merkmale: Umlaut/ß ODER mindestens zwei typische Wörter.
_UMLAUT = re.compile(r"[äöüÄÖÜß]")
_WOERTER = re.compile(
    r"\b(der|die|das|den|dem|ein|eine|einen|einer|und|oder|nicht|kein|keine|"
    r"ist|sind|wird|wurde|werden|mit|für|von|zum|zur|beim|noch|schon|hier|"
    r"dann|wenn|kann|muss|soll|bitte|Datei|Ordner|Track|Karte|Fehler)\b",
    re.I)

# Was zählt als sichtbarer Text?
_STELLEN = (
    re.compile(r">([^<>{}\n]{3,120})<"),                                  # >Text<
    re.compile(r'(?:title|placeholder|aria-label|alt)\s*=\s*"([^"{}\n]{3,160})"'),
    re.compile(r"toast\(\s*\"([^\"{}\n]{3,200})\""),
    re.compile(r"toast\(\s*'([^'{}\n]{3,200})'"),
    re.compile(r"\.textContent\s*=\s*\"([^\"{}\n]{3,200})\""),
    re.compile(r"\.textContent\s*=\s*'([^'{}\n]{3,200})'"),
    re.compile(r"(?:title|body|footer)\s*:\s*\"([^\"{}\n]{3,200})\""),    # openModal({title: "…"})
)

# Der Rückfallwert von t()/T() darf deutsch sein — er ist die Notlösung, wenn
# ein Schlüssel fehlt. Solche Bereiche werden vor der Prüfung ausgeblendet.
# Zwei Schreibweisen kommen im Code vor:
#   t("schlüssel", "Rückfall")        — zweites Argument
#   t("schlüssel") || "Rückfall"      — ältere Stellen im Animator
_TFALL = re.compile(r"\b[tT]\(\s*(\"[^\"]*\"|'[^']*')\s*,\s*(\"[^\"]*\"|'[^']*')")
# `re.S`: Die Schreibweise steht oft über zwei Zeilen —
#   const s = (typeof t === "function" ? t("k") : null)
#          || "Deutscher Rückfall";
_TODER = re.compile(
    r"\b[tT]\(\s*(?:\"[^\"]*\"|'[^']*')\s*\)(?:\s*:\s*null\s*\))?\s*\|\|\s*"
    r"(?:\"[^\"]*\"|'[^']*')", re.S)
# Was NUR ins Log geht, ist Diagnose für uns — keine Oberfläche.
_NUR_LOG = re.compile(r"\b(console\.(log|warn|error|info|debug)|applog|_log|log_js)\s*\(")


def _ohne_kommentare(text: str) -> str:
    """Kommentare durch Leerzeichen ersetzen — Zeilennummern bleiben erhalten.

    Bewusst als kleiner Automat: Ein `//` in einer Zeichenkette (`"https://…"`)
    ist kein Kommentar, und ein `"` in einem Kommentar startet keine
    Zeichenkette. Eine Regex bekäme beides falsch.
    """
    raus = []
    i, n = 0, len(text)
    zustand = None            # None | '"' | "'" | '`' | '//' | '/*'
    while i < n:
        c = text[i]
        zwei = text[i:i + 2]
        if zustand is None:
            if zwei == "//":
                zustand = "//"; raus.append("  "); i += 2; continue
            if zwei == "/*":
                zustand = "/*"; raus.append("  "); i += 2; continue
            if c in "\"'`":
                zustand = c
            raus.append(c); i += 1; continue
        if zustand == "//":
            if c == "\n":
                zustand = None; raus.append(c)
            else:
                raus.append(" ")
            i += 1; continue
        if zustand == "/*":
            if zwei == "*/":
                zustand = None; raus.append("  "); i += 2; continue
            raus.append("\n" if c == "\n" else " "); i += 1; continue
        # in einer Zeichenkette
        if c == "\\" and i + 1 < n:
            raus.append(text[i:i + 2]); i += 2; continue
        if c == zustand:
            zustand = None
        raus.append(c); i += 1
    return "".join(raus)


# `data-i18n`, `data-i18n-title`, `data-i18n-placeholder`: Das Markup ist
# angemeldet, `uebersetzeMarkup()` ersetzt den Text beim Laden der Sprache. Der
# deutsche Wortlaut daneben ist der Rückfall und gehört genau dorthin.
_ANGEMELDET = re.compile(r"data-i18n(?:-title|-placeholder)?\s*=")


def _deutsch(s: str) -> bool:
    s = s.strip()
    if len(s) < 4 or s.startswith("${"):
        return False
    if _UMLAUT.search(s):
        return True
    return len(_WOERTER.findall(s)) >= 2


def pruefe() -> list:
    funde = []
    for pfad in DATEIEN:
        if not pfad.exists():
            continue
        roh = pfad.read_text(encoding="utf-8")
        text = roh if pfad.suffix == ".html" else _ohne_kommentare(roh)
        # Rückfallwerte ausblenden (beide Schreibweisen)
        text = _TFALL.sub(lambda m: "t(" + " " * (len(m.group(0)) - 2), text)
        text = _TODER.sub(lambda m: " " * len(m.group(0)), text)
        # Dateien, die ihre Texte nachweislich zur Laufzeit übersetzen, dürfen
        # sich mit `// sprache-ok: <Begründung>` selbst ausnehmen. Bewusst pro
        # DATEI und mit Begründung — eine stille Ausnahme wäre wertlos.
        if "sprache-ok:" in roh:
            continue
        # Bereichs-Ausnahme für die Stellen, die die Übersetzung SELBST bilden
        # (die Notfall-Tabelle in index.html). Bewusst mit Anfang und Ende statt
        # dateiweit — der Rest der Datei wird weiter geprüft.
        while "sprache-ok-anfang" in text and "sprache-ok-ende" in text:
            i = text.index("sprache-ok-anfang")
            j = text.index("sprache-ok-ende", i)
            text = text[:i] + re.sub(r"[^\n]", " ", text[i:j]) + text[j + len("sprache-ok-ende"):]
        for regex in _STELLEN:
            for m in regex.finditer(text):
                wert = m.group(1)
                if not _deutsch(wert):
                    continue
                # Nicht nur die Trefferzeile ansehen: `console.warn(` kann eine
                # Zeile höher stehen, der Text darunter.
                if _NUR_LOG.search(text[max(0, m.start() - 240):m.start()]):
                    continue
                # Steht das Element unter `data-i18n…`? Dann ist es versorgt.
                anfang = text.rfind("<", 0, m.start())
                if anfang >= 0 and _ANGEMELDET.search(text[anfang:m.start() + len(m.group(0))]):
                    continue
                zeile = text.count("\n", 0, m.start()) + 1
                funde.append((pfad.relative_to(ROOT), zeile, wert.strip()))
    return sorted(set(funde))


def main() -> int:
    funde = pruefe()
    if not funde:
        print("✅ kein hartkodierter deutscher Text in der Oberfläche")
        return 0
    print(f"⚠️  {len(funde)} Stelle(n) ohne Übersetzung:\n")
    for pfad, zeile, wert in funde:
        print(f"  {pfad}:{zeile}\n      {wert!r}")
    return 1 if "--strict" in sys.argv else 0


if __name__ == "__main__":
    raise SystemExit(main())
