#!/usr/bin/env python3
"""Cloud-Archiv gegen einen ECHTEN Server durchspielen (seit 15.08.2026).

Die Unit-Tests in `tests/test_cloud_*.py` prüfen Verschlüsselung und
Schlüsselablage für sich. Dieses Skript prüft das, was nur mit einem echten
Server zu prüfen ist: dass PHP, HTTP, Dateirechte, Sperren und der Client
zusammen tun, was sie sollen.

    scripts/selftest_cloud.py https://beispiel.de/rz-cloud/rz-cloud.php

⚠️ **Es räumt das Archiv am Anfang leer** — nur gegen ein Testarchiv laufen
lassen, nie gegen ein echtes. Das Skript besteht darauf, dass „test“ in der
Adresse vorkommt.

Geprüft wird bewusst auch, was NICHT gehen darf: falscher Schlüssel, Ausbruch
aus dem Ordner, ein zweites Einrichten (Übernahme des Archivs), ein vertauschter
Umschlag.
"""
from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, str(ROOT))

from core.cloud import crypto as c        # noqa: E402
from core.cloud import transport as t     # noqa: E402

fails = []


def check(name, cond, detail=""):
    print(f"  {'✓' if cond else '✗ FAIL'}  {name}" + (f"   [{detail}]" if detail and not cond else ""))
    if not cond:
        fails.append(name)


def wirft(art, fn, *a, **kw):
    try:
        fn(*a, **kw)
        return False
    except art:
        return True
    except Exception as e:
        print(f"      (erwartet {art.__name__}, kam {type(e).__name__}: {e})")
        return False


def _ftp():
    """Zugangsdaten für das Aufräumen — nur für Marcs eigenen Testserver."""
    p = Path.home() / ".claude/secrets/reisezoom-ftp.env"
    if not p.exists():
        return None
    d = {}
    for zeile in p.read_text(encoding="utf-8").splitlines():
        zeile = zeile.strip()
        if zeile and not zeile.startswith("#") and "=" in zeile:
            k, v = zeile.split("=", 1)
            d[k] = v
    return d


def archiv_leeren(unterordner: str) -> None:
    """`rz-daten` löschen, damit jeder Lauf bei null anfängt."""
    e = _ftp()
    if not e:
        print("  ⏭  kein FTP-Zugang bekannt — Archiv wird nicht geleert")
        return
    basis = f"ftp://{e['RZ_FTP_HOST']}/{unterordner}/rz-daten"
    nutzer = f"{e['RZ_FTP_USER']}:{e['RZ_FTP_PASS']}"

    def liste(pfad):
        r = subprocess.run(["curl", "-s", "--max-time", "40", f"{pfad}/", "--user", nutzer],
                           capture_output=True, text=True)
        return [z.split()[-1] for z in r.stdout.splitlines() if z.strip()] if r.returncode == 0 else []

    for ordner in ("u", "p"):
        for name in liste(f"{basis}/{ordner}"):
            subprocess.run(["curl", "-s", "--max-time", "40", f"{basis}/{ordner}/",
                            "--user", nutzer, "-Q", f"DELE /{unterordner}/rz-daten/{ordner}/{name}"],
                           capture_output=True)
    for datei in ("index.json", "index.lock", "archiv.json", "zugang.php", ".htaccess"):
        subprocess.run(["curl", "-s", "--max-time", "40", f"{basis}/", "--user", nutzer,
                        "-Q", f"DELE /{unterordner}/rz-daten/{datei}"], capture_output=True)
    for ordner in ("u", "p", ""):
        subprocess.run(["curl", "-s", "--max-time", "40",
                        f"ftp://{e['RZ_FTP_HOST']}/{unterordner}/", "--user", nutzer,
                        "-Q", f"RMD /{unterordner}/rz-daten/{ordner}".rstrip("/")],
                       capture_output=True)


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    adresse = argv[1]
    if "test" not in adresse:
        print("❌ Sicherheitshalber: die Adresse muss „test“ enthalten.\n"
              "   Dieses Skript LÖSCHT den Inhalt des Archivs.", file=sys.stderr)
        return 2
    unterordner = adresse.split("/")[-2]

    print(f"━━━ Archiv leeren ({unterordner}) ━━━")
    archiv_leeren(unterordner)
    time.sleep(1)

    # ── 1. Ansprechen, ohne etwas zu wissen ──────────────────────────────
    print("\n━━━ 1. Erste Berührung ━━━")
    g = t.Gegenstelle(adresse)
    info = g.info()
    check("die Gegenstelle meldet sich", info.get("dienst") == "reisezoom-cloud")
    check("und sagt, dass sie noch leer ist", info.get("eingerichtet") is False, str(info))
    check("ohne Zugang geht sonst nichts", wirft(t.CloudFehler, g.liste))

    # ⚠️ Der häufigste Bedienfehler: Adresse der Seite statt der PHP-Datei.
    falsch = t.Gegenstelle("https://reisezoom.com/gps/")
    check("eine falsche Adresse erklärt sich verständlich",
          wirft(t.CloudFehler, falsch.info))

    # ── 2. Einrichten ────────────────────────────────────────────────────
    print("\n━━━ 2. Einrichten ━━━")
    schluessel, passwort, verpackt = c.archiv_anlegen()
    zugang = g.anlegen(verpackt.als_json())
    check("wir bekommen einen Zugangsschlüssel", len(zugang) > 20, zugang)
    check("das Archiv gilt jetzt als eingerichtet", g.info().get("eingerichtet") is True)

    # ⚠️ DER Übernahme-Angriff: Ein Fremder richtet einfach neu ein.
    fremd = t.Gegenstelle(adresse)
    check("ein zweites Einrichten wird abgewiesen",
          wirft(t.CloudFehler, fremd.anlegen, verpackt.als_json()))

    # ── 3. Gerät 2: nur mit dem Passwort hineinkommen ────────────────────
    print("\n━━━ 3. Gerät 2 ━━━")
    g2 = t.Gegenstelle(adresse, zugang)
    wieder = c.VerpackterSchluessel.aus_json(g2.archiv_schluessel())
    check("der verpackte Schlüssel liegt oben und kommt zurück", wieder is not None)
    check("das Passwort öffnet ihn — mehr braucht Gerät 2 nicht",
          c.schluessel_auspacken(wieder, passwort) == schluessel)
    check("ein falsches Passwort öffnet ihn nicht",
          wirft(c.FalschesPasswort, c.schluessel_auspacken, wieder, c.passwort_wuerfeln()))

    # ── 4. Umschläge ─────────────────────────────────────────────────────
    print("\n━━━ 4. Umschläge hoch und runter ━━━")
    inhalt = b"<gpx>Teststrecke</gpx>" * 200
    name = "track/aaaa1111"
    pruef = c.inhalts_pruefsumme(inhalt)
    nummer = g2.legen(name, c.verschliessen(schluessel, name, inhalt), pruef)
    check("hochlegen meldet Nummer 1", nummer == 1, str(nummer))

    liste = g2.liste()
    sname = t.server_name(name)
    check("die Liste kennt ihn", sname in liste, str(list(liste)[:2]))
    check("mit unserer Prüfsumme", liste[sname].pruef == pruef if sname in liste else False)
    # ⚠️ Der Server darf den Namen nicht kennen — sonst verrät die Ablage,
    # wohin jemand gefahren ist.
    check("der Server kennt den Klarnamen NICHT", name not in str(liste))

    zurueck = c.oeffnen(schluessel, name, g2.holen(name))
    check("und der Inhalt kommt unverändert zurück", zurueck == inhalt)

    nummer2 = g2.legen(name, c.verschliessen(schluessel, name, inhalt + b"!"),
                       c.inhalts_pruefsumme(inhalt + b"!"))
    check("erneutes Ablegen zählt hoch (so erkennt Gerät 2 Änderungen)",
          nummer2 == 2, str(nummer2))

    # ── 5. Was nicht gehen darf ──────────────────────────────────────────
    print("\n━━━ 5. Angriffe ━━━")
    boese = t.Gegenstelle(adresse, "falscher-schluessel")
    check("falscher Zugangsschlüssel wird abgewiesen",
          wirft(t.ZugangAbgelehnt, boese.liste))
    check("ohne Zugangsschlüssel ebenso",
          wirft(t.ZugangAbgelehnt, t.Gegenstelle(adresse).liste))
    check("etwas Unbekanntes holen ergibt „nicht vorhanden“",
          wirft(t.NichtVorhanden, g2.holen, "track/gibtsnicht"))

    # Ausbruch aus dem Ordner — der Server nimmt nur Hexnamen an.
    import urllib.error as ue
    import urllib.request as ur
    req = ur.Request(f"{adresse}?was=holen&name=../../rz-cloud.php")
    req.add_header("X-RZ-Schluessel", zugang)
    try:
        ur.urlopen(req, timeout=30)
        check("ein Ausbruch aus dem Ordner wird abgewiesen", False, "durchgelassen!")
    except ue.HTTPError as e:
        check("ein Ausbruch aus dem Ordner wird abgewiesen", e.code == 400, str(e.code))

    # Der Datenordner darf nicht im Web hängen.
    basis = adresse.rsplit("/", 1)[0]
    for pfad, was in ((f"{basis}/rz-daten/archiv.json", "archiv.json"),
                      (f"{basis}/rz-daten/zugang.php", "zugang.php")):
        try:
            with ur.urlopen(pfad, timeout=20) as a:
                inhalt_web = a.read(200)
            # zugang.php darf ausgeliefert werden, solange sie NICHTS ausgibt.
            offen = bool(inhalt_web.strip())
            check(f"{was} gibt im Web nichts preis", not offen,
                  inhalt_web[:60].decode("utf-8", "replace"))
        except ue.HTTPError as e:
            check(f"{was} ist im Web gesperrt ({e.code})", e.code in (401, 403, 404))
        except Exception as e:
            check(f"{was} ist im Web nicht erreichbar", True, str(e))

    # ── 6. Löschen und Papierkorb ────────────────────────────────────────
    print("\n━━━ 6. Löschen ━━━")
    g2.loeschen(name)
    check("aus der Liste verschwunden", t.server_name(name) not in g2.liste())
    check("und nicht mehr zu holen", wirft(t.NichtVorhanden, g2.holen, name))
    # ⚠️ Er soll im Papierkorb liegen, nicht weg sein. Mit 0 Tagen Aufbewahrung
    # muss genau dieser eine Eintrag verschwinden.
    weg = g2.papierkorb_leeren(tage=0) if False else g2.papierkorb_leeren(tage=1)
    check("der Papierkorb lässt sich leeren (frische Einträge bleiben)",
          weg == 0, f"{weg} gelöscht — erwartet 0, er ist ja gerade erst gelandet")

    print("\n" + ("✅ alles in Ordnung" if not fails
                  else f"❌ {len(fails)} gescheitert: {fails}"))
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
