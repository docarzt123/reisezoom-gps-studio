#!/usr/bin/env python3
"""three.js (npm-Paket) → ui/vendor/three.js als klassisches Skript mit window.THREE (02.11.2026).

Warum: Die App lädt ihre Seiten über file://. Chromium sperrt dort ES-Module, three.js gibt es seit r160 aber nur
noch als Modul (build/three.core.js + build/three.module.js). Dieses Skript ersetzt nur Import und Export durch
Funktionsrahmen — der Code bleibt sonst Zeichen für Zeichen unverändert.

Aufruf:  python3 scripts/three_klassisch.py <entpacktes npm-Paket>/package/build 0.187.0
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ZIEL = Path(__file__).resolve().parent.parent / "ui" / "vendor" / "three.js"


def _namen(zeile: str) -> list:
    namen = [n.strip() for n in zeile[zeile.index("{") + 1:zeile.index("}")].split(",") if n.strip()]
    for n in namen:
        if not re.fullmatch(r"[A-Za-z_$][\w$]*", n):   # „a as b“ kann dieser Umbau nicht
            raise SystemExit(f"Umbenennung im Import/Export, Umbau nicht möglich: {n}")
    return namen


def umbauen(build: Path, version: str) -> str:
    core = (build / "three.core.js").read_text(encoding="utf-8").split("\n")
    mod = (build / "three.module.js").read_text(encoding="utf-8").split("\n")
    i_core_export = [i for i, z in enumerate(core) if z.startswith("export {")]
    i_mod_import = [i for i, z in enumerate(mod) if z.startswith("import {")]
    i_mod_export = [i for i, z in enumerate(mod) if z.startswith("export {")]
    if len(i_core_export) != 1 or len(i_mod_import) != 1 or len(i_mod_export) != 2:
        raise SystemExit("unerwarteter Aufbau von three.core.js / three.module.js")
    if any("import(" in z or "import.meta" in z for z in core + mod):
        raise SystemExit("dynamische Importe — Umbau nicht möglich")
    weiter_i, eigen_i = i_mod_export   # erst „export {…} from './three.core.js'“, am Ende die eigenen
    core[i_core_export[0]] = "return { " + ", ".join(_namen(core[i_core_export[0]])) + " };"
    mod[i_mod_import[0]] = "const { " + ", ".join(_namen(mod[i_mod_import[0]])) + " } = __core;"
    weiter = _namen(mod[weiter_i])
    mod[weiter_i] = ""
    mod[eigen_i] = ("return Object.assign({ " + ", ".join(f"{n}: __core.{n}" for n in weiter) + " }, { "
                    + ", ".join(_namen(mod[eigen_i])) + " });")
    kopf = (f"/* three.js {version} (MIT, © 2010-2026 three.js authors, https://threejs.org) — als klassisches Skript für\n"
            " * GPS Studio: die App lädt Skripte über file://, dort sind ES-Module gesperrt. Unverändert aus\n"
            " * build/three.core.js + build/three.module.js des npm-Pakets; nur Import/Export durch Funktionsrahmen\n"
            " * ersetzt (scripts/three_klassisch.py). Ergebnis: window.THREE. Lizenz: ui/vendor/three-LICENSE.txt */\n")
    return (kopf + "(function () {\n\"use strict\";\nconst __core = (function () {\n" + "\n".join(core) + "\n})();\n"
            "window.THREE = (function (__core) {\n" + "\n".join(mod) + "\n})(__core);\n})();\n")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    ZIEL.write_text(umbauen(Path(sys.argv[1]), sys.argv[2]), encoding="utf-8")
    print(f"{ZIEL} geschrieben")
