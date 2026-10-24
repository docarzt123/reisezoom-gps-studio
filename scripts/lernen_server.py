#!/usr/bin/env python3
"""Annahmestelle für geteilte Logbuch-Korrekturen auf data.reisezoom.com (24.10.2026, core/lernen.py).

    lernen_server.py bauen        → server/lernen/einsenden.php aus core/lernen (Arten, Merkmale, Format) erzeugen
    lernen_server.py hochladen    → einsenden.php + index.htm nach /lernen/, Sperre nach /_lernen_daten/.htaccess
    lernen_server.py holen ZIEL   → alle gesammelten *.jsonl aus /_lernen_daten/ nach ZIEL (fürs Training)
    lernen_server.py modell DATEI → modell.json nach /lernen/modell.json (veröffentlichen)

Zugang: FTP-Datei aus der Umgebung `RZ_DATEN_FTP` (Standard ~/.claude/secrets/daten-ftp.env, Schlüssel RZ_FTP_HOST/
USER/PASS) — nie im Repo. Die PHP-Datei nimmt nur bekannte Arten und genau die Merkmale aus core/lernen.MERKMALE an.
"""
from __future__ import annotations

import ftplib
import io
import json
import os
import ssl
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
from core import lernen as L  # noqa: E402

AUS = REPO / "server" / "lernen"
SPERRE = "Require all denied\n<IfModule !mod_authz_core.c>\nOrder deny,allow\nDeny from all\n</IfModule>\n"

PHP = r'''<?php
// GPS Studio — Logbuch-Korrekturen annehmen (24.10.2026, core/lernen.py). Erzeugt von scripts/lernen_server.py — nicht
// von Hand ändern. Angenommen werden NUR Zahlen zu einem Abschnitt und die richtige Art; keine Orte, Zeiten, Namen.
// Die IP-Adresse wird nicht gespeichert: zur Begrenzung (MAX_STUNDE Sendungen je Stunde) zählt eine Datei, deren Name
// ein Hash aus IP und Tagessalz ist; sie wird nach zwei Stunden gelöscht.
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
const FORMAT = __FORMAT__;
const MAX_STUNDE = 30;
const MAX_JE = __MAX__;
$ARTEN = __ARTEN__;
$MERKMALE = __MERKMALE__;
function nein($code, $grund) { http_response_code($code); echo json_encode(['ok' => false, 'error' => $grund]); exit; }
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') nein(405, 'nur POST');
$roh = file_get_contents('php://input', false, null, 0, 400000);
if ($roh === false || strlen($roh) >= 400000) nein(413, 'zu groß');
$d = json_decode($roh, true);
if (!is_array($d) || ($d['format'] ?? 0) !== FORMAT || !is_array($d['beispiele'] ?? null)) nein(400, 'Format');
$ordner = __DIR__ . '/../_lernen_daten';
if (!is_dir($ordner)) @mkdir($ordner, 0750, true);
$jetzt = time();
foreach (glob($ordner . '/limit-*') ?: [] as $alt) { if ($jetzt - @filemtime($alt) > 7200) @unlink($alt); }
$h = substr(hash('sha256', date('Y-m-d') . '|gps-studio|' . ($_SERVER['REMOTE_ADDR'] ?? '')), 0, 16);
$zf = $ordner . '/limit-' . date('YmdH') . '-' . $h;
$n = (int)@file_get_contents($zf);
if ($n >= MAX_STUNDE) nein(429, 'zu viele Sendungen');
@file_put_contents($zf, (string)($n + 1));
$app = substr(preg_replace('/[^0-9.]/', '', (string)($d['app'] ?? '')), 0, 12);
$zeilen = [];
foreach (array_slice($d['beispiele'], 0, MAX_JE) as $b) {
  if (!is_array($b)) continue;
  $art = (string)($b['art'] ?? '');
  if (!in_array($art, $ARTEN, true)) continue;
  $m = $b['merkmale'] ?? null;
  if (!is_array($m)) continue;
  $ok = [];
  foreach ($MERKMALE as $k) {
    $v = $m[$k] ?? null;
    if (!is_int($v) && !is_float($v)) continue 2;
    $v = (float)$v;
    if (!is_finite($v) || abs($v) > 1e6) continue 2;
    $ok[$k] = round($v, 4);
  }
  $zeilen[] = json_encode(['f' => FORMAT, 'art' => $art, 'app' => $app, 'm' => $ok]);
}
if ($zeilen) @file_put_contents($ordner . '/' . date('Y-m') . '.jsonl', implode("\n", $zeilen) . "\n", FILE_APPEND | LOCK_EX);
echo json_encode(['ok' => true, 'angenommen' => count($zeilen)]);
'''


def bauen() -> Path:
    AUS.mkdir(parents=True, exist_ok=True)
    php = (PHP.replace("__FORMAT__", str(L.FORMAT)).replace("__MAX__", str(L.MAX_JE_SENDUNG))
              .replace("__ARTEN__", json.dumps(list(L.ARTEN))).replace("__MERKMALE__", json.dumps(list(L.MERKMALE))))
    (AUS / "einsenden.php").write_text(php)
    (AUS / "index.htm").write_text("")
    return AUS / "einsenden.php"


def _ftp() -> ftplib.FTP_TLS:
    datei = Path(os.environ.get("RZ_DATEN_FTP", "~/.claude/secrets/daten-ftp.env")).expanduser()
    env = {}
    for zeile in datei.read_text().splitlines():
        zeile = zeile.strip()
        if zeile and not zeile.startswith("#") and "=" in zeile:
            k, v = zeile.split("=", 1)
            env[k.strip()] = v.strip()
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE      # All-Inkl-Zertifikat auf den Servernamen, nicht auf die Subdomain
    f = ftplib.FTP_TLS(env["RZ_FTP_HOST"], context=ctx, timeout=60)
    f.login(env["RZ_FTP_USER"], env["RZ_FTP_PASS"])
    f.prot_p()
    return f


def _mkd(f, pfad: str) -> None:
    try:
        f.mkd(pfad)
    except ftplib.error_perm:
        pass


def hochladen() -> None:
    bauen()
    f = _ftp()
    _mkd(f, "/lernen")
    _mkd(f, "/_lernen_daten")
    for name in ("einsenden.php", "index.htm"):
        with open(AUS / name, "rb") as d:
            f.storbinary(f"STOR /lernen/{name}", d)
    f.storbinary("STOR /_lernen_daten/.htaccess", io.BytesIO(SPERRE.encode()))
    f.storbinary("STOR /_lernen_daten/index.htm", io.BytesIO(b""))
    f.quit()
    print("hochgeladen: /lernen/einsenden.php, /_lernen_daten/.htaccess")


def holen(ziel: Path) -> list:
    ziel.mkdir(parents=True, exist_ok=True)
    f = _ftp()
    namen = [n for n in f.nlst("/_lernen_daten") if n.endswith(".jsonl")]
    raus = []
    for n in namen:
        p = ziel / Path(n).name
        with open(p, "wb") as d:
            f.retrbinary(f"RETR /_lernen_daten/{Path(n).name}", d.write)
        raus.append(p)
    f.quit()
    return raus


def modell_veroeffentlichen(datei: Path) -> None:
    m = json.loads(Path(datei).read_text())
    if not L._gueltig(m):
        raise SystemExit("Modell passt nicht zu core/lernen (Format/Merkmale)")
    f = _ftp()
    _mkd(f, "/lernen")
    with open(datei, "rb") as d:
        f.storbinary("STOR /lernen/modell.json", d)
    f.quit()
    print("veröffentlicht: /lernen/modell.json")


if __name__ == "__main__":
    was = sys.argv[1] if len(sys.argv) > 1 else ""
    if was == "bauen":
        print(bauen())
    elif was == "hochladen":
        hochladen()
    elif was == "holen" and len(sys.argv) > 2:
        for p in holen(Path(sys.argv[2])):
            print(p)
    elif was == "modell" and len(sys.argv) > 2:
        modell_veroeffentlichen(Path(sys.argv[2]))
    else:
        print(__doc__)
        sys.exit(2)
