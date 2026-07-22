#!/usr/bin/env python3
"""Reisezoom GPS Studio — i18n-Konsistenz-Check (v0.9.459).

Findet zwei Fehlerklassen, bevor sie im gebauten Programm auftauchen:

1. **Fehlende Übersetzungen:** Ein `t("key", ...)`-Aufruf im Code, dessen Key
   in `i18n/de.json` fehlt. Ohne Fallback-Text (2. Argument) sieht der Nutzer
   den rohen Key. Genau das passierte mit den Export-Toasts (`export.done`).

2. **Sprachen driften auseinander:** Ein Key existiert in `de`, aber nicht in
   `en`/`es` (oder umgekehrt) — dann bekommt ein englischsprachiger Nutzer
   deutschen Text oder den Key.

Aufruf (Exit 0 = sauber, 1 = Probleme):
    python3 scripts/check_i18n.py           # nur harte Fehler kippen den Exit
    python3 scripts/check_i18n.py --strict  # auch ungenutzte Keys als Warnung

Der Build ruft das ohne `--strict` als Warn-Gate auf: Fehler werden gezeigt,
brechen den Build aber nicht ab (damit ein vergessener Key kein Release
blockiert, aber sichtbar ist).
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
LANGS = ("de", "en", "es")

# Fallbacks für Keys, die dynamisch zusammengesetzt werden (Präfix + Variable)
# und deshalb nie als vollständiges String-Literal im Code stehen. Nur exakte
# Präfixe — verhindert Fehlalarme, ohne echte Lücken zu verstecken.
DYNAMIC_PREFIXES = (
    "animator.statsfield.", "animator.pos.", "geotagger.dir.", "geotagger.light.",
    "geotagger.lvd.", "heightanim.statfield.", "heightanim.auto.",
)

# Nur ein echtes t("...")-Literal zählt — nicht get(...), getContext(...) usw.
T_CALL = re.compile(r"""(?<![A-Za-z0-9_.$])t\(\s*["']([a-z][a-z0-9_.]*[a-z0-9])["']""")
# Kommentare vorher entfernen — sonst zählen JSDoc-Beispiele wie
# `t("some.key", ...)` als echte (fehlende) Aufrufe.
_BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.DOTALL)
_LINE_COMMENT = re.compile(r"(?m)^\s*//.*$|(?<=\S)\s+//.*$")


def _strip_comments(src: str) -> str:
    src = _BLOCK_COMMENT.sub(" ", src)
    return _LINE_COMMENT.sub("", src)


def used_keys() -> set[str]:
    keys: set[str] = set()
    roots = [REPO / "modules", REPO / "ui/js"]
    for root in roots:
        for p in root.rglob("*.js"):
            for m in T_CALL.finditer(_strip_comments(p.read_text(encoding="utf-8"))):
                keys.add(m.group(1))
    # app.py nutzt _strings.get("key", ...)
    for m in re.finditer(r"""_strings\.get\(\s*["']([a-z][a-z0-9_.]*[a-z0-9])["']""",
                         (REPO / "app.py").read_text(encoding="utf-8")):
        keys.add(m.group(1))
    return keys


def main(strict: bool) -> int:
    langs = {}
    for lg in LANGS:
        langs[lg] = json.loads((REPO / f"i18n/{lg}.json").read_text(encoding="utf-8"))
    de = langs["de"]

    problems = 0

    # 1) Benutzt, aber in de.json nicht vorhanden.
    used = used_keys()
    missing = sorted(k for k in used
                     if k not in de and not any(k.startswith(pre) for pre in DYNAMIC_PREFIXES))
    if missing:
        problems += len(missing)
        print(f"❌ {len(missing)} im Code benutzte Keys fehlen in de.json:")
        for k in missing:
            print(f"   • {k}")

    # 2) Sprachen-Diff gegen de (Referenz).
    for lg in ("en", "es"):
        only_de = sorted(set(de) - set(langs[lg]))
        only_lg = sorted(set(langs[lg]) - set(de))
        if only_de:
            problems += len(only_de)
            print(f"❌ {len(only_de)} Keys fehlen in {lg}.json (in de vorhanden):")
            for k in only_de[:25]:
                print(f"   • {k}")
            if len(only_de) > 25:
                print(f"   … und {len(only_de) - 25} weitere")
        if only_lg:
            problems += len(only_lg)
            print(f"❌ {len(only_lg)} Keys nur in {lg}.json (nicht in de):")
            for k in only_lg[:25]:
                print(f"   • {k}")

    # 3) Optional: ungenutzte Keys (nur Info, kippt Exit nur bei --strict).
    if strict:
        unused = sorted(k for k in de if k not in used
                        and not any(k.startswith(pre) for pre in DYNAMIC_PREFIXES))
        if unused:
            print(f"ℹ️  {len(unused)} Keys in de.json werden im Code nicht (direkt) benutzt.")

    if problems == 0:
        print(f"✅ i18n konsistent — {len(de)} Keys, {len(used)} im Code benutzt, "
              f"de/en/es deckungsgleich.")
        return 0
    print(f"\n⚠️  {problems} i18n-Problem(e) gefunden.")
    return 1


if __name__ == "__main__":
    sys.exit(main("--strict" in sys.argv))
