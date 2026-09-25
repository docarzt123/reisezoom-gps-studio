#!/usr/bin/env python3
"""Test-Cloud für die Testumgebung einrichten (25.09.2026) — gehört zu scripts/testumgebung.sh.

Läuft mit RZ_APP_ORDNER=<Testwurzel>/App-Ordner und RZ_CLOUD_ABLAGE=datei: legt auf
der angegebenen Gegenstelle (eigener Ordner, NIE die echte Cloud) ein neues Archiv an,
merkt Zugang + Schlüssel in <App-Ordner>/cloud-zugang.json, schreibt das einmalig
ausgegebene Passwort und den Zugangsschlüssel nach ~/.claude/secrets/gps-studio-testcloud.env
(0600) und die Adresse nach <Testwurzel>/TEST-CLOUD.txt. Danach ein erster Abgleich.

Aufruf: testumgebung.sh cloud-einrichten https://…/rz-cloud-testrechner/rz-cloud.php
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
ECHTE_CLOUD = "reisezoom.com/rz-cloud/"


def main() -> None:
    sys.stdout.reconfigure(line_buffering=True)
    wurzel, adresse = Path(sys.argv[1]).expanduser().resolve(), sys.argv[2].strip()
    if ECHTE_CLOUD in adresse:
        sys.exit("Das ist die echte Cloud — Abbruch.")
    if os.environ.get("RZ_CLOUD_ABLAGE") != "datei" or not os.environ.get("RZ_APP_ORDNER"):
        sys.exit("Nur über testumgebung.sh (RZ_APP_ORDNER + RZ_CLOUD_ABLAGE=datei).")
    import app as A
    from core import bibliothek as cbib
    api = A.Api()
    try:
        r = api.cloud_einrichten(adresse)
        if not r.get("ok"):
            sys.exit(f"Einrichten gescheitert: {r.get('error')}")
        geheim = Path.home() / ".claude" / "secrets" / "gps-studio-testcloud.env"
        geheim.parent.mkdir(parents=True, exist_ok=True)
        geheim.write_text(f"# Test-Cloud der GPS-Studio-Testumgebung — NICHT die echte Cloud\n"
                          f"TESTCLOUD_ADRESSE={adresse}\nTESTCLOUD_ZUGANG={r['zugang']}\n"
                          f"TESTCLOUD_PASSWORT={r['passwort']}\n", encoding="utf-8")
        os.chmod(geheim, 0o600)
        (wurzel / "TEST-CLOUD.txt").write_text(
            f"Test-Cloud: {adresse}\nZugang und Passwort: ~/.claude/secrets/gps-studio-testcloud.env (nur Marc/Claude)\n",
            encoding="utf-8")
        print("✓ Archiv angelegt, Zugang in", geheim)
        if A.BIB_BEREIT:
            a = api.cloud_abgleichen()
            print("Erster Abgleich:", {k: a.get(k) for k in ("ok", "hoch", "anzahl", "mb", "error") if k in a})
        else:
            print("Bibliothek gerade belegt — der Abgleich läuft, sobald die Test-App etwas ändert.")
    finally:
        try:
            if A.BIB_BEREIT:
                cbib.sperre_freigeben(A.BIB)
        except Exception as e:  # noqa: BLE001
            print("Sperre freigeben:", e)
    sys.stdout.flush()
    os._exit(0)


if __name__ == "__main__":
    main()
