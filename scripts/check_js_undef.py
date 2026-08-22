#!/usr/bin/env python3
"""Nicht deklarierte Bezeichner im UI-JavaScript (22.08.2026).

Anlass: `writable is not defined` — im Audit in eine Funktion kopiert, in der
es die Variable nicht gab; `node --check` sieht so etwas nicht, ein Beta-Tester
schon (Schreib-Dialog blieb offen). ESLint `no-undef` über alle UI-Dateien;
erlaubt sind Browser-Globals und alles, was in IRGENDEINER UI-Datei auf oberster
Ebene deklariert ist (die Dateien teilen sich den Seiten-Scope). Alles andere
ist ein Fehler.

ESLint wird bei Bedarf in ~/.cache/rz-eslint installiert (npm nötig).
Aufruf:  .venv/bin/python scripts/check_js_undef.py
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = Path.home() / ".cache" / "rz-eslint"
DATEIEN = sorted(ROOT.glob("ui/js/*.js")) + sorted(ROOT.glob("modules/*/ui/module.js"))

BROWSER = set("""window document console navigator location performance history screen localStorage sessionStorage
setTimeout clearTimeout setInterval clearInterval requestAnimationFrame cancelAnimationFrame queueMicrotask
Math JSON Promise Map Set WeakMap WeakSet Date Number String Array Object Boolean Symbol BigInt Reflect Proxy
parseInt parseFloat isFinite isNaN Infinity NaN undefined globalThis self Error TypeError RangeError RegExp
encodeURIComponent decodeURIComponent encodeURI decodeURI escape unescape atob btoa structuredClone
Image Blob File FileReader URL URLSearchParams FormData Event CustomEvent KeyboardEvent MouseEvent PointerEvent
DragEvent HTMLElement HTMLCanvasElement Element Node NodeList DOMParser XMLSerializer DOMRect CSS Intl crypto
AbortController ResizeObserver MutationObserver IntersectionObserver getComputedStyle alert confirm prompt fetch
Audio AudioContext OffscreenCanvas createImageBitmap ImageData Path2D TextEncoder TextDecoder Uint8Array
Float32Array Float64Array Int32Array Uint32Array ArrayBuffer DataView devicePixelRatio innerWidth innerHeight
scrollTo matchMedia open close focus blur print DOMException Worker MessageChannel WebSocket XMLHttpRequest
mapboxgl maplibregl L pywebview""".split())


def eslint_bin() -> Path | None:
    b = CACHE / "node_modules" / ".bin" / "eslint"
    if b.exists():
        return b
    if not shutil.which("npm"):
        return None
    CACHE.mkdir(parents=True, exist_ok=True)
    (CACHE / "package.json").write_text('{"name":"rz-eslint","private":true}', encoding="utf-8")
    r = subprocess.run(["npm", "install", "eslint@9", "--silent", "--no-audit", "--no-fund"], cwd=CACHE,
                       capture_output=True, text=True)
    return b if b.exists() else None


def top_level_namen(src: str) -> set[str]:
    namen = set()
    for m in re.finditer(r"^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)", src, re.M):
        namen.add(m.group(1))
    for m in re.finditer(r"^(?:const|let|var)\s+([A-Za-z_$][\w$]*)", src, re.M):
        namen.add(m.group(1))
    for m in re.finditer(r"^(?:const|let|var)\s+\{([^}]*)\}", src, re.M):
        namen.update(x.strip().split(":")[0].strip() for x in m.group(1).split(",") if x.strip())
    for m in re.finditer(r"window\.([A-Za-z_$][\w$]*)\s*=", src):
        namen.add(m.group(1))
    return namen


def main() -> int:
    b = eslint_bin()
    if b is None:
        print("ESLint nicht verfügbar (npm fehlt) — übersprungen")
        return 0
    cfg = CACHE / "cfg.mjs"
    cfg.write_text('export default [{ files: ["**/*.js"], languageOptions: { ecmaVersion: 2022, sourceType: "script" }, rules: { "no-undef": "error" } }];\n', encoding="utf-8")
    erlaubt = set(BROWSER)
    for f in DATEIEN:
        erlaubt |= top_level_namen(f.read_text(encoding="utf-8"))
    env = dict(os.environ, NODE_PATH=str(CACHE / "node_modules"))
    r = subprocess.run([str(b), "--no-config-lookup", "-c", str(cfg), "-f", "json", *map(str, DATEIEN)],
                       cwd=ROOT, capture_output=True, text=True, env=env)
    try:
        bericht = json.loads(r.stdout)
    except Exception:
        bericht = None
    if bericht is None or r.returncode not in (0, 1):
        # ESLint selbst ist gescheitert (kaputte Installation o.ä.) — das darf
        # NIE als „alles sauber" durchgehen (22.08.2026: genau so blieb der
        # `writable`-Fehler beim ersten Lauf dieses Prüfers unsichtbar).
        print("❌ ESLint lief nicht:", (r.stderr or r.stdout).strip()[:400])
        return 1
    fehler = []
    for datei in bericht:
        for msg in datei.get("messages", []):
            m = re.match(r"'([^']+)' is not defined", msg.get("message", ""))
            if not m:
                if msg.get("fatal"):
                    fehler.append(f"{Path(datei['filePath']).relative_to(ROOT)}:{msg.get('line')}  PARSE: {msg.get('message')}")
                continue
            name = m.group(1)
            if name in erlaubt:
                continue
            fehler.append(f"{Path(datei['filePath']).relative_to(ROOT)}:{msg.get('line')}  '{name}'")
    if fehler:
        print("❌ nicht deklarierte Bezeichner:")
        for f in fehler:
            print("   " + f)
        return 1
    print(f"✅ keine nicht deklarierten Bezeichner in {len(DATEIEN)} UI-Dateien")
    return 0


if __name__ == "__main__":
    sys.exit(main())
