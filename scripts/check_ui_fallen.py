#!/usr/bin/env python3
"""Findet die vier Fallen, in die wir in dieser Oberfläche mehrfach getappt sind.

Warum es dieses Skript gibt: Alle vier stehen längst in docs/DEVELOPER.md §9 —
und trotzdem sind zwei davon innerhalb von drei Tagen ERNEUT passiert
(27.08.2026, Ghost-Spuren). Eine Notiz wird nur gelesen, wenn man schon weiß,
dass man sie braucht. Ein Prüfer meldet sich von selbst.

Gesucht wird:

1. **Stilles Aussteigen bei ladendem Kartenstil.** `if (!map.isStyleLoaded())
   return;` ohne `_whenStyleReady` heißt: Beim Öffnen passiert nichts, und
   niemand holt es nach. So verschwanden der Laufpunkt (v0.9.531) und die
   Ghost-Spuren (v0.9.549).
2. **`addLayer` mit festem `beforeId`.** Existiert der Bezugs-Layer nicht,
   wirft Mapbox — die Ebene fehlt kommentarlos. „preview-shadow" etwa gibt es
   nur mit eingeschaltetem Schlagschatten.
3. **Modul-Zustand vor seiner Deklaration benutzt** (TDZ). Der Zugriff wirft,
   ein leeres `catch` schluckt es, und ein Listener wird nie registriert —
   genau so verloren die Ghost-Spuren ihren Sitzungs-Listener.
4. **Leeres `catch (_) {}` um Lade-/Aufbau-Aufrufe.** Wo Zustand geladen oder
   Ebenen gebaut werden, muss ein Fehler ins Protokoll — sonst sucht man ihn
   später in einem Nutzer-Video.

Ausnahmen: `// ui-falle-ok: <Begründung>` in der Zeile darüber.
Aufruf: python3 scripts/check_ui_fallen.py [--strict]
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATEIEN = sorted(list((ROOT / "ui" / "js").glob("*.js")) +
                 list((ROOT / "modules").glob("*/ui/module.js")))

AUSNAHME = re.compile(r"//\s*ui-falle-ok")


def _zeilen(p: Path) -> list[str]:
    return p.read_text(encoding="utf-8").splitlines()


def _befreit(zeilen: list[str], i: int) -> bool:
    """Ausnahme in dieser oder der Zeile darüber?"""
    if AUSNAHME.search(zeilen[i]):
        return True
    return i > 0 and AUSNAHME.search(zeilen[i - 1]) is not None


def falle1_stiller_stil(p: Path, zeilen: list[str]) -> list[tuple[int, str]]:
    """isStyleLoaded()-Wächter ohne Nachholen."""
    treffer = []
    for i, z in enumerate(zeilen):
        if "isStyleLoaded" not in z or "return" not in z:
            continue
        if "_whenStyleReady" in z or _befreit(zeilen, i):
            continue
        # Steht in derselben Funktion ein _whenStyleReady? Dann ist es gedeckt.
        anfang = max(0, i - 25)
        if any("_whenStyleReady" in x for x in zeilen[anfang:i + 6]):
            continue
        treffer.append((i + 1, z.strip()[:110]))
    return treffer


def falle2_beforeid(p: Path, zeilen: list[str]) -> list[tuple[int, str]]:
    """addLayer mit festem beforeId, ohne dass jemand nachsieht."""
    treffer = []
    muster = re.compile(r"""addLayer\(.*,\s*["']([a-z0-9_-]+)["']\s*\)""", re.I)
    for i, z in enumerate(zeilen):
        m = muster.search(z)
        if not m or _befreit(zeilen, i):
            continue
        ziel = m.group(1)
        umfeld = "\n".join(zeilen[max(0, i - 12):i + 3])
        if f'getLayer("{ziel}")' in umfeld or f"getLayer('{ziel}')" in umfeld:
            continue
        treffer.append((i + 1, f'beforeId "{ziel}" ohne getLayer-Prüfung'))
    return treffer


def _im_direkten_ablauf(zeilen: list[str]) -> list[bool]:
    """Läuft diese Zeile SOFORT beim Mounten — oder erst später in einer Funktion?

    Nur der direkte Ablauf ist für TDZ gefährlich: Was in einer Funktion oder
    einem Callback steht, läuft später, wenn die Deklaration längst erledigt ist.
    Deshalb Klammern zählen statt Einrückung raten (Einrückung fing vorher jeden
    Funktionsrumpf mit ein und hat Fehlalarme produziert).

    Der Modulcode selbst steckt in `mountAnimator(...)`, also gilt: Tiefe ≤ 1
    Funktionsebene = direkter Ablauf.
    """
    raus = []
    tiefe = 0
    fn_stack: list[int] = []
    beginnt_fn = re.compile(r"(function\s*[A-Za-z0-9_]*\s*\(|=>\s*\{|\)\s*\{\s*$)")
    for z in zeilen:
        # Zustand GILT für diese Zeile, bevor sie selbst Klammern ändert.
        raus.append(len(fn_stack) <= 1)
        offen = z.count("{") - z.count("}")
        if beginnt_fn.search(z) and offen > 0:
            fn_stack.append(tiefe)
        tiefe += offen
        while fn_stack and tiefe <= fn_stack[-1]:
            fn_stack.pop()
    return raus


def falle3_tdz(p: Path, zeilen: list[str]) -> list[tuple[int, str]]:
    """Modul-Zustand benutzt, bevor `let`/`const` ihn deklariert.

    Genau dieser Fehler kostete die Ghost-Spuren ihren Sitzungs-Listener
    (27.08.2026): `_animSessionUnsubs.push(...)` stand 147 Zeilen über der
    Deklaration, der Zugriff warf, ein leeres `catch` schluckte es.
    """
    treffer = []
    deklariert: dict[str, int] = {}
    for i, z in enumerate(zeilen):
        m = re.match(r"\s{0,4}(?:let|const|var)\s+(_[A-Za-z0-9_]+)\s*[=;]", z)
        if m and m.group(1) not in deklariert:
            deklariert[m.group(1)] = i
    direkt = _im_direkten_ablauf(zeilen)
    for i, z in enumerate(zeilen):
        if not direkt[i] or _befreit(zeilen, i):
            continue
        if re.match(r"\s*(?:let|const|var|function|//|/\*|\*|<!--)", z):
            continue
        for name, zeile_dekl in deklariert.items():
            if i >= zeile_dekl:
                continue
            # Nach dem Punkt MUSS ein Bezeichner kommen. Sonst trifft das Muster
            # auch Fließtext in Kommentaren („… verschiebt _viewOffset.").
            if re.search(rf"\b{re.escape(name)}\s*(?:\.\s*[A-Za-z_$]|\[)", z):
                treffer.append((i + 1, f"{name} benutzt, deklariert erst in Zeile {zeile_dekl + 1}"))
                break
    return treffer


def falle4_stille_catches(p: Path, zeilen: list[str]) -> list[tuple[int, str]]:
    """Leeres catch um Laden/Aufbauen — Fehler verschwindet spurlos."""
    treffer = []
    verdaechtig = re.compile(r"(Laden|Lade|Aufbauen|Aufbau|Zeichnen|onSessionChanged|Sichern)\w*\s*\(")
    for i, z in enumerate(zeilen):
        if "catch (_) {}" not in z and "catch(_) {}" not in z:
            continue
        if _befreit(zeilen, i):
            continue
        if verdaechtig.search(z):
            treffer.append((i + 1, z.strip()[:110]))
    return treffer


PRUEFUNGEN = [
    ("stilles Aussteigen bei ladendem Kartenstil (→ _whenStyleReady)", falle1_stiller_stil),
    ("addLayer mit festem beforeId (→ getLayer prüfen)", falle2_beforeid),
    ("Modul-Zustand vor seiner Deklaration benutzt (TDZ)", falle3_tdz),
    ("leeres catch um Laden/Aufbauen (→ ins app.log schreiben)", falle4_stille_catches),
]


def main() -> int:
    streng = "--strict" in sys.argv
    gesamt = 0
    for titel, fn in PRUEFUNGEN:
        alle = []
        for p in DATEIEN:
            for zeile, text in fn(p, _zeilen(p)):
                alle.append((p.relative_to(ROOT), zeile, text))
        if alle:
            gesamt += len(alle)
            print(f"\n⚠️  {titel} — {len(alle)}×")
            for datei, zeile, text in alle[:12]:
                print(f"    {datei}:{zeile}  {text}")
            if len(alle) > 12:
                print(f"    … und {len(alle) - 12} weitere")
    if not gesamt:
        print("✅ keine der bekannten Oberflächen-Fallen gefunden")
        return 0
    print(f"\n{gesamt} Stelle(n). Erklärung je Falle: docs/DEVELOPER.md §9.")
    print("Bewusst so gewollt? Dann `// ui-falle-ok: <Begründung>` in die Zeile darüber.")
    return 1 if streng else 0


if __name__ == "__main__":
    sys.exit(main())
