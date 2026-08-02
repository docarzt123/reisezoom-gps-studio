#!/usr/bin/env python3
"""Download-Seite + Manifest aus den echten Build-Artefakten erzeugen.

Warum es das gibt: Die Download-Seite war handgeschrieben — und lag zweimal
daneben. Der Windows-Link zeigte auf einen Dateinamen, den es nicht gab, und ein
Linux-Paket wurde beworben, das nie existiert hat. Beides fiel erst einem
externen Audit auf. Seit v0.9.495 kommen Dateinamen, Größe und Prüfsumme aus den
Dateien selbst; eine Datei, die nicht da ist, kann gar nicht erst verlinkt werden.

Aufruf (macht `deploy_release.sh` automatisch):

    python3 scripts/make_download_page.py --version 0.9.484 \\
        --mac  /pfad/ReisezoomGPSStudio-macos.dmg \\
        --win  /pfad/ReisezoomGPSStudio-windows-setup.exe \\
        --out-html index.html --out-json manifest.json
"""
from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import subprocess
import sys
import tempfile

LINUX_DOCS = "https://github.com/docarzt123/reisezoom-gps-studio#-linux-aus-quellcode"


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def mb(n: int) -> str:
    return f"{n / 1_048_576:.0f} MB"


def mac_signatur_pruefen(dmg: str) -> tuple:
    """Ist die App im DMG wirklich signiert und notarisiert? — nachsehen.

    Vorher standen `signed` und `notarized` als feste `True` im Code, während
    die Seite dem Nutzer wörtlich zusicherte: „Mit Apple Developer ID signiert
    und von Apple notarisiert — Doppelklick genügt." Die Kette dahinter kann
    aber still durchfallen: Fehlt ein Signier-Geheimnis, signiert
    `macos_sign.sh` ad-hoc und endet mit Code 0; fehlen die Apple-Zugänge,
    überspringt `macos_notarize.sh` die Notarisierung und endet mit Code 0.
    Beim nächsten abgelaufenen Zertifikat hätte die Seite eine Zusage gegeben,
    die das Programm nicht einhält — der Nutzer bekäme „kann nicht auf
    Schadsoftware überprüft werden" auf einer Seite, die das Gegenteil behauptet.

    Rückgabe: `(signiert, notarisiert)`. Lässt es sich nicht feststellen (kein
    macOS, kein `spctl`), wird **nichts behauptet** — beides False.
    """
    if sys.platform != "darwin" or not os.path.exists(dmg):
        return (False, False)
    mnt = tempfile.mkdtemp(prefix="rz-dmg-")
    try:
        r = subprocess.run(["hdiutil", "attach", "-nobrowse", "-quiet",
                            dmg, "-mountpoint", mnt],
                           capture_output=True, timeout=300)
        if r.returncode != 0:
            return (False, False)
        try:
            apps = [p for p in os.listdir(mnt) if p.endswith(".app")]
            if not apps:
                return (False, False)
            app = os.path.join(mnt, apps[0])
            # `codesign` sagt, WER signiert hat — eine Developer-ID-Signatur
            # nennt die ausstellende Stelle, eine Ad-hoc-Signatur nicht.
            cs = subprocess.run(["codesign", "-dv", "--verbose=2", app],
                                capture_output=True, text=True, timeout=180)
            signiert = "Authority=Developer ID Application" in (cs.stderr + cs.stdout)
            # `spctl` sagt, ob Apple die App kennt — das ist die Notarisierung.
            sp = subprocess.run(["spctl", "-a", "-vvv", app],
                                capture_output=True, text=True, timeout=300)
            notarisiert = "source=Notarized Developer ID" in (sp.stderr + sp.stdout)
            return (signiert, notarisiert)
        finally:
            subprocess.run(["hdiutil", "detach", mnt, "-quiet"],
                           capture_output=True, timeout=180)
    except Exception as e:      # noqa: BLE001 — im Zweifel nichts behaupten
        print(f"⚠️  Signaturprüfung nicht möglich: {e}", file=sys.stderr)
        return (False, False)
    finally:
        try:
            os.rmdir(mnt)
        except OSError:
            pass


def build(version: str, mac: str, win: str, released: str) -> dict:
    out: dict = {"version": version, "released": released, "downloads": {},
                 "linux": {"packaged": False, "docs": LINUX_DOCS}}
    if mac and os.path.exists(mac):
        signiert, notarisiert = mac_signatur_pruefen(mac)
        if not (signiert and notarisiert):
            print(f"⚠️  macOS-Build: signiert={signiert}, notarisiert={notarisiert} "
                  f"— die Seite sagt es jetzt genauso.", file=sys.stderr)
        out["downloads"]["macos-arm64"] = {
            "file": os.path.basename(mac), "size": os.path.getsize(mac),
            "sha256": sha256(mac), "signed": signiert, "notarized": notarisiert,
            "min_os": "macOS 13", "arch": "Apple Silicon (arm64)",
        }
    if win and os.path.exists(win):
        out["downloads"]["windows-x64"] = {
            "file": os.path.basename(win), "size": os.path.getsize(win),
            "sha256": sha256(win), "signed": False, "notarized": False,
            "min_os": "Windows 10", "arch": "x64",
        }
    return out


def render(m: dict) -> str:
    d = m["downloads"]
    rel = datetime.date.fromisoformat(m["released"]).strftime("%d.%m.%Y")
    cards = []
    if "macos-arm64" in d:
        x = d["macos-arm64"]
        # Der Hinweis richtet sich nach der Messung, nicht nach der Hoffnung.
        # Ein unsignierter Build braucht eine andere Anleitung — und wer sie
        # nicht bekommt, steht vor „kann nicht auf Schadsoftware überprüft
        # werden" und hält die Seite für gelogen.
        if x["signed"] and x["notarized"]:
            hinweis = ("Mit Apple Developer ID signiert und von Apple notarisiert — "
                       "Doppelklick genügt. Die einmalige Rückfrage beim ersten Start "
                       "zeigt macOS bei jeder geladenen App.")
        elif x["signed"]:
            hinweis = ("Mit Apple Developer ID signiert, aber <b>nicht</b> notarisiert. "
                       "Beim ersten Start: Rechtsklick auf die App → „Öffnen“ → im "
                       "Dialog nochmal „Öffnen“.")
        else:
            hinweis = ("Dieser Build ist <b>nicht</b> signiert. Beim ersten Start: "
                       "Rechtsklick auf die App → „Öffnen“ → im Dialog nochmal "
                       "„Öffnen“. Erscheint die Meldung „ist beschädigt“, hilft "
                       "<code>xattr -dr com.apple.quarantine</code> auf der App.")
        cards.append(f'''  <a class="dl" href="{x["file"]}">
    <b>⬇ macOS</b>
    <span class="meta">{x["min_os"]} oder neuer · {x["arch"]} · DMG · {mb(x["size"])}</span>
    <div class="note">{hinweis}</div>
    <span class="hash">SHA-256: {x["sha256"]}</span>
  </a>''')
    if "windows-x64" in d:
        x = d["windows-x64"]
        cards.append(f'''  <a class="dl" href="{x["file"]}">
    <b>⬇ Windows</b>
    <span class="meta">{x["min_os"]}/11 · {x["arch"]} · Installer · {mb(x["size"])}</span>
    <div class="note">Dieser Build ist <b>nicht</b> codesigniert. Beim ersten Start meldet sich
      SmartScreen einmalig: „Weitere Informationen“ → „Trotzdem ausführen“.</div>
    <span class="hash">SHA-256: {x["sha256"]}</span>
  </a>''')
    return f'''<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reisezoom GPS Studio {m["version"]} — Download</title>
<meta name="description" content="Reisezoom GPS Studio herunterladen: GPS-Tracks als Video animieren, Tour-Karten erzeugen, Fotos verorten. Kostenlos für macOS und Windows.">
<link rel="canonical" href="https://reisezoom.com/downloads/gps-studio/latest/">
<meta name="robots" content="noindex, follow">
<style>
  :root{{--bg:#f4ede0;--paper:#fbf6ec;--ink:#1c1814;--muted:#7a6f60;--rule:#e3d9c5;--green:#2f8a3e}}
  *{{box-sizing:border-box}}html,body{{margin:0}}
  body{{background:var(--bg);color:var(--ink);font:400 17px/1.6 Manrope,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}}
  .wrap{{max-width:720px;margin:0 auto;padding:44px 20px 64px}}
  h1{{font-family:"Instrument Serif",Georgia,serif;font-weight:400;font-size:34px;line-height:1.15;margin:0 0 4px}}
  .ver{{color:var(--muted);margin:0 0 26px;font-size:15px}}
  a{{color:var(--green)}}
  .dl{{display:block;background:var(--paper);border:1px solid var(--rule);border-radius:14px;
      padding:16px 18px;margin:0 0 12px;text-decoration:none;color:var(--ink)}}
  .dl:hover{{border-color:var(--green)}}
  .dl b{{display:block;font-size:18px;margin-bottom:2px}}
  .dl .meta{{color:var(--muted);font-size:14px}}
  .dl .note{{font-size:13.5px;margin-top:6px}}
  .hash{{display:block;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;
        color:var(--muted);word-break:break-all;margin-top:6px}}
  .box{{background:var(--paper);border:1px solid var(--rule);border-radius:14px;padding:14px 18px;margin:0 0 12px}}
  .fine{{color:var(--muted);font-size:14px;line-height:1.6;margin-top:24px;border-top:1px solid var(--rule);padding-top:16px}}
</style>
</head>
<body>
<div class="wrap">
  <h1>Reisezoom GPS Studio</h1>
  <p class="ver">Version {m["version"]} · veröffentlicht am {rel} · kostenlos</p>

{chr(10).join(cards)}

  <div class="box">
    <b>Linux</b><br>
    <span class="meta">Kein fertiges Paket — die App läuft direkt aus dem Quellcode
    (Debian/Ubuntu, Fedora, Arch).</span><br>
    <a href="{m["linux"]["docs"]}">Anleitung auf GitHub</a>
  </div>

  <p class="fine">
    <b>Prüfsumme vergleichen</b> (freiwillig, aber empfohlen):<br>
    macOS: <code>shasum -a 256 ReisezoomGPSStudio-macos.dmg</code><br>
    Windows: <code>certutil -hashfile ReisezoomGPSStudio-windows-setup.exe SHA256</code><br>
    Stimmt der Wert mit dem oben überein, ist die Datei unverändert angekommen.
  </p>

  <p class="fine">
    <a href="changelog.html">Was ist neu in dieser Version?</a> ·
    <a href="user-guide.html">Handbuch</a> ·
    <a href="https://reisezoom.com/gps/">GPS Studio im Browser</a> ·
    <a href="https://github.com/docarzt123/reisezoom-gps-studio">Quellcode auf GitHub</a>
  </p>
</div>
</body>
</html>
'''


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", required=True)
    ap.add_argument("--mac", default="")
    ap.add_argument("--win", default="")
    ap.add_argument("--released", default=datetime.date.today().isoformat())
    ap.add_argument("--out-html", required=True)
    ap.add_argument("--out-json", required=True)
    a = ap.parse_args()

    m = build(a.version, a.mac, a.win, a.released)
    if not m["downloads"]:
        print("Kein einziges Artefakt gefunden — Seite wäre leer.", file=sys.stderr)
        return 1
    with open(a.out_json, "w", encoding="utf-8") as f:
        json.dump(m, f, indent=2, ensure_ascii=False)
        f.write("\n")
    with open(a.out_html, "w", encoding="utf-8") as f:
        f.write(render(m))
    for k, v in m["downloads"].items():
        print(f"  {k:14} {mb(v['size']):>8}  sha256 {v['sha256'][:16]}…")
    return 0


if __name__ == "__main__":
    sys.exit(main())
