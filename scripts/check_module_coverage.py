#!/usr/bin/env python3
"""Steht jedes Modul, das es gibt, auch im Smoke-Test?

Der Anlass: `scripts/selftest_ui.py` führte eine **von Hand gepflegte** Liste der
zu prüfenden Module. `gpxinspect` und `webkarte` standen dort nie — beide wurden
also von keinem Test je geladen, und ein Aufbau- oder Syntaxfehler wäre erst beim
Nutzer aufgefallen. Genau die Sorte Lücke, die niemand bemerkt, weil alles grün
meldet.

Diese Prüfung vergleicht die Ordner unter `modules/` mit der Liste im Smoke-Test.

Aufruf:  .venv/bin/python scripts/check_module_coverage.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SMOKE = REPO / "scripts/selftest_ui.py"


def main() -> int:
    smoke = SMOKE.read_text(encoding="utf-8")
    fehlt, gefunden = [], []
    for d in sorted((REPO / "modules").iterdir()):
        js = d / "ui/module.js"
        if not js.is_dir() and js.exists():
            m = re.search(r'slug:\s*["\']([\w-]+)["\']', js.read_text(encoding="utf-8"))
            if not m:
                continue
            slug = m.group(1)
            gefunden.append(slug)
            if f'"{slug}"' not in smoke:
                fehlt.append((slug, d.name))

    if fehlt:
        print(f"❌ {len(fehlt)} Modul(e) stehen in keinem Smoke-Test:")
        for slug, ordner in fehlt:
            print(f"   • {slug}  (modules/{ordner}/)")
        print("\n   → in MODULES_TO_TEST UND in die panel_id-Abbildung eintragen")
        print(f"     ({SMOKE.relative_to(REPO)})")
        return 1

    print(f"✅ Alle {len(gefunden)} Module stehen im Smoke-Test: {', '.join(gefunden)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
