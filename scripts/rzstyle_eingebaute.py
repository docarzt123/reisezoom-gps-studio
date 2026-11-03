#!/usr/bin/env python3
"""Die zehn eingebauten Videovorlagen als .rzstyle-Dateien in einen Ordner schreiben — ohne App (02.11.2026).

Warum: Die iPhone-App bündelt die eingebauten Vorlagen als Dateien. In der App gibt es dafür „Stil exportieren …
→ Alle eingebauten in einen Ordner …“; dieses Skript macht dasselbe auf der Kommandozeile (z. B. nach einer Änderung an
ui/js/videovorlagen.js). Die Vorlagen baut Node mit denselben Dateien wie die App (container.js, videovorlagen.js,
rzstyle.js); Namen, Übersetzungen und Vorschaubild ergänzt core/rzstyle.py.

Aufruf:  .venv/bin/python scripts/rzstyle_eingebaute.py <ordner> [--ersetzen]
         ohne --ersetzen bricht es ab, wenn schon eine Datei gleichen Namens im Ordner liegt (nie still überschreiben).
Braucht: node im PATH, Pillow (für das Vorschaubild).
"""
from __future__ import annotations

import base64
import io
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from core import i18n as ci18n  # noqa: E402
from core import rzstyle as crzstyle  # noqa: E402

JS = r"""
global.window = global; global.document = { createElement: () => ({}) };
global.Image = function () { const o = {}; setTimeout(() => o.onerror && o.onerror(), 0); return o; };
const fs = require("fs"), vm = require("vm"), ui = process.argv[1];
for (const f of ["js/container.js", "js/videovorlagen.js", "js/rzstyle.js"]) vm.runInThisContext(fs.readFileSync(ui + "/" + f, "utf8"), { filename: f });
(async () => {
  const raus = [];
  for (const V of window.rzVideoVorlagen.LISTE) raus.push(await window.rzStyle.eingebaut(V.id));
  process.stdout.write(JSON.stringify(raus));
})().catch(e => { console.error(e); process.exit(1); });
"""


def app_version() -> str:
    m = re.search(r'^APP_VERSION = "([^"]+)"', (REPO / "app.py").read_text(encoding="utf-8"), re.M)
    return m.group(1) if m else ""


def vorschau(vid: str) -> str | None:
    """ui/img/vorlagen/<id>.jpg → 480 × 270 JPEG als data-URL (wie rzstyle.js in der App)."""
    pfad = REPO / "ui" / "img" / "vorlagen" / f"{vid}.jpg"
    if not pfad.is_file():
        return None
    from PIL import Image
    with Image.open(pfad) as im:
        klein = im.convert("RGB").resize((480, 270), Image.LANCZOS)
        puffer = io.BytesIO()
        klein.save(puffer, "JPEG", quality=82)
    return "data:image/jpeg;base64," + base64.b64encode(puffer.getvalue()).decode("ascii")


def bauen() -> list[dict]:
    node = shutil.which("node")
    if not node:
        raise SystemExit("node fehlt im PATH")
    r = subprocess.run([node, "-e", JS, str(REPO / "ui")], capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        raise SystemExit("Node-Fehler:\n" + r.stderr)
    ci18n.set_i18n_dir(REPO / "i18n")
    version, raus = app_version(), []
    for b in json.loads(r.stdout):
        stil = b["stil"]
        stil["preview"] = vorschau(stil["id"])
        raus.append(crzstyle.vervollstaendigen(stil, b["schluessel"], ci18n.uebersetzer, version))
    return raus


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 1:
        raise SystemExit(__doc__)
    ziel = Path(args[0]).expanduser()
    ziel.mkdir(parents=True, exist_ok=True)
    dateien = bauen()
    namen = [ziel / crzstyle.dateiname(d["id"]) for d in dateien]
    belegt = [p.name for p in namen if p.exists()]
    if belegt and "--ersetzen" not in sys.argv:
        raise SystemExit("schon vorhanden (mit --ersetzen überschreiben): " + ", ".join(belegt))
    for d, p in zip(dateien, namen):
        p.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"{p.name:24s} {p.stat().st_size // 1024:5d} KB  {', '.join(d['formats'])}  {d['names']['en']}")


if __name__ == "__main__":
    main()
