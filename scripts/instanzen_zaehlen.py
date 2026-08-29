#!/usr/bin/env python3
"""Wie viele GPS-Studio-Instanzen laufen weltweit? (Marc, 29.08.2026)

Seit v0.9.624 fragt der Update-Check der App
`https://reisezoom.com/downloads/gps-studio/latest/manifest.json` ab
(höchstens alle 12 h pro Instanz). Die NORMALEN All-Inkl-Server-Logs
zählen diese Abrufe mit — keine IDs, keine Telemetrie, nur Standard-
Weblogs. Dieses Skript lädt die Logs per FTP und rechnet daraus:

  · eindeutige IPs pro Tag  ≈ laufende Instanzen (Größenordnung!)
  · Plattform-Verteilung    (User-Agent: macOS / Windows / Linux)
  · Versions-Verteilung     (User-Agent: ReisezoomGPSStudio/<version>)

⚠️ Voraussetzung: Im KAS müssen die Logfiles für reisezoom.com einmalig
aktiviert sein (KAS → Domain → Logfiles) — sonst ist `logs/` leer.

Aufruf:
  ./.venv/bin/python scripts/instanzen_zaehlen.py            # letzte 14 Tage
  ./.venv/bin/python scripts/instanzen_zaehlen.py --tage 60

Zugang: ~/.claude/secrets/reisezoom-ftp.env (KEY=VALUE, mode 0600).
"""
from __future__ import annotations

import argparse
import ftplib
import gzip
import io
import re
import sys
from collections import defaultdict
from pathlib import Path

MARKER = "/downloads/gps-studio/latest/manifest.json"
UA_RE = re.compile(r"ReisezoomGPSStudio/([0-9.]+)(?:\s*\(([^)]+)\))?")
# Apache Combined: IP - - [Datum] "GET pfad HTTP/…" Status Größe "Referer" "UA"
ZEILE_RE = re.compile(
    r'^(\S+) \S+ \S+ \[([^\]:]+)[^\]]*\] "(?:GET|HEAD) ([^ "]+)[^"]*" \d+ \S+ "[^"]*" "([^"]*)"')


def env_laden() -> dict:
    pfad = Path.home() / ".claude/secrets/reisezoom-ftp.env"
    return {l.split("=", 1)[0]: l.split("=", 1)[1]
            for l in (x.strip() for x in open(pfad))
            if l and not l.startswith("#") and "=" in l}


def logs_holen(tage: int) -> list[bytes]:
    env = env_laden()
    f = ftplib.FTP_TLS(env["RZ_FTP_HOST"])
    f.login(env["RZ_FTP_USER"], env["RZ_FTP_PASS"])
    f.prot_p()
    try:
        namen = [n for n in f.nlst("logs") if not n.endswith((".", ".."))]
    except ftplib.all_errors:
        namen = []
    if not namen:
        print("⚠️  logs/ ist leer — im KAS die Logfiles für reisezoom.com "
              "aktivieren (KAS → Domain → Logfiles), dann morgen wieder probieren.")
        f.quit()
        sys.exit(1)
    namen = sorted(namen)[-max(1, tage):]
    rohe = []
    for n in namen:
        puf = io.BytesIO()
        try:
            f.retrbinary(f"RETR {n}", puf.write)
        except ftplib.all_errors as e:
            print(f"  (überspringe {n}: {e})")
            continue
        daten = puf.getvalue()
        if n.endswith(".gz"):
            try:
                daten = gzip.decompress(daten)
            except OSError:
                continue
        rohe.append(daten)
        print(f"  · {n} ({len(daten) // 1024} KB)")
    f.quit()
    return rohe


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tage", type=int, default=14)
    a = ap.parse_args()
    print(f"Lade bis zu {a.tage} Log-Dateien von reisezoom.com …")
    rohe = logs_holen(a.tage)

    je_tag: dict[str, set] = defaultdict(set)
    plattform: dict[str, set] = defaultdict(set)
    version: dict[str, set] = defaultdict(set)
    treffer = 0
    for blob in rohe:
        for zeile in blob.decode("utf-8", errors="replace").splitlines():
            if MARKER not in zeile:
                continue
            m = ZEILE_RE.match(zeile)
            if not m:
                continue
            ip, datum, _pfad, ua = m.groups()
            uam = UA_RE.search(ua or "")
            if not uam:      # Browser/Crawler zählen nicht als Instanz
                continue
            treffer += 1
            je_tag[datum].add(ip)
            version[uam.group(1)].add(ip)
            plattform[(uam.group(2) or "unbekannt").strip()].add(ip)

    if not treffer:
        print("Keine App-Abrufe des Manifests in den Logs gefunden — "
              "läuft schon eine v0.9.624+ da draußen, und sind die Logs aktiv?")
        return 1

    alle_ips = set().union(*je_tag.values())
    print(f"\n━━━ {treffer} Update-Checks · {len(alle_ips)} eindeutige IPs "
          f"über {len(je_tag)} Tag(e) ━━━")
    print("\nInstanzen (eindeutige IPs) pro Tag:")
    for tag in sorted(je_tag):
        n = len(je_tag[tag])
        print(f"  {tag}  {'█' * min(60, n)} {n}")
    print("\nPlattformen (eindeutige IPs, ganzer Zeitraum):")
    for k in sorted(plattform, key=lambda x: -len(plattform[x])):
        print(f"  {k:<10} {len(plattform[k])}")
    print("\nVersionen (eindeutige IPs, ganzer Zeitraum):")
    for k in sorted(version, reverse=True):
        print(f"  v{k:<10} {len(version[k])}")
    print("\n(Größenordnung, keine exakte Zahl: NAT fasst Instanzen zusammen, "
          "dynamische IPs zählen doppelt.)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
