#!/usr/bin/env bash
# Testumgebung für GPS Studio (25.09.2026) — der Mac mini ist der Testrechner.
#
#   scripts/testumgebung.sh einrichten                 Ordner + Testdaten + Fotoschutz anlegen
#   scripts/testumgebung.sh zuruecksetzen vorbefuellt   frische Arbeitskopien, Bibliothek mit Archiv
#   scripts/testumgebung.sh zuruecksetzen leer          frische Arbeitskopien, Erststart (Onboarding)
#   scripts/testumgebung.sh starten                    installierte App MIT dem Test-App-Ordner starten
#   scripts/testumgebung.sh vorne                      die Test-App nach vorne holen (nie die normale App)
#   scripts/testumgebung.sh oeffnen <datei>            Datei von außerhalb öffnen wie per Doppelklick im Finder
#   scripts/testumgebung.sh aufraeumen                 in _alt/ nur die letzten 2 Stände behalten
#   scripts/testumgebung.sh schutzprobe                Probeordner für GT-12 (außerhalb der Testwurzel)
#   scripts/testumgebung.sh cloud-einrichten <adresse>  Test-Cloud anlegen (eigener Server-Ordner)
#   scripts/testumgebung.sh status
#
# Alles liegt unter $RZ_TESTWURZEL (Vorgabe ~/GPS-Studio-Test). Die App bekommt über
# RZ_APP_ORDNER einen eigenen App-Ordner — Einstellungen, Bibliothek, Renders, Papierkorb,
# Cloud-Zugang: alles getrennt vom normalen App-Ordner dieses Rechners.
#
# Fotoschutz: `testrechner.json` im Test-App-Ordner UND im normalen App-Ordner. Dann
# verweigert GPS Studio jedes Löschen, Ersetzen und Foto-Überschreiben außerhalb der
# Testwurzel (core/dateischutz.py) — die Fotos auf dem NAS bleiben unberührt.
#
# Zurücksetzen legt den bisherigen Stand nach $RZ_TESTWURZEL/_alt/<Zeit>/; dort bleiben nur die letzten
# ALT_BEHALTEN (=2) Stände, Älteres löscht das Skript (Marc, 25.09.2026). `aufraeumen` tut das einzeln.
set -euo pipefail

WURZEL="${RZ_TESTWURZEL:-$HOME/GPS-Studio-Test}"
APP="${RZ_TEST_APP:-/Applications/Reisezoom GPS Studio.app}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
PY="$REPO/.venv/bin/python"
APP_ORDNER="$WURZEL/App-Ordner"
NORMALER_APP_ORDNER="$HOME/Library/Application Support/Reisezoom GPS Studio"

schutz_schreiben() {   # $1 = App-Ordner
  mkdir -p "$1"
  printf '{\n  "schreiben_nur_in": ["%s"],\n  "hinweis": "Testrechner (scripts/testumgebung.sh): Löschen/Ersetzen/Foto-Überschreiben nur in der Testwurzel."\n}\n' "$WURZEL" > "$1/testrechner.json"
}

laeuft_test_app() {   # -ax: App-Prozesse haben kein Terminal; -E zeigt die Umgebung (RZ_APP_ORDNER)
  ps -axEww -o command= | grep -F "RZ_APP_ORDNER=$APP_ORDNER" | grep -v grep >/dev/null 2>&1
}

ALT_BEHALTEN=2   # Marc, 25.09.2026: „behalte immer nur die letzten beiden Läufe"

alt_aufraeumen() {   # nur Stände der Form _alt/JJJJMMTT-HHMMSS, die neuesten $ALT_BEHALTEN bleiben
  [ -d "$WURZEL/_alt" ] || return 0
  local weg
  weg="$(ls -1 "$WURZEL/_alt" | grep -E '^[0-9]{8}-[0-9]{6}$' | sort -r | tail -n +$((ALT_BEHALTEN + 1)))"
  [ -n "$weg" ] || return 0
  while IFS= read -r d; do
    rm -rf -- "$WURZEL/_alt/$d"
  done <<< "$weg"
  echo "aufgeräumt: $(printf '%s\n' "$weg" | wc -l | tr -d ' ') alte Stände aus _alt/ gelöscht, $ALT_BEHALTEN behalten"
}

test_app_pid() {      # PID der Test-Instanz (nie die normale App)
  local p
  for p in $(pgrep -f "Reisezoom GPS Studio.app/Contents/MacOS" || true); do
    if ps -Eww -o command= -p "$p" | grep -qF "RZ_APP_ORDNER=$APP_ORDNER"; then echo "$p"; return 0; fi
  done
  return 1
}

nach_vorne() {        # Test-Instanz per PID nach vorne holen — „activate" per Name würde die normale App starten
  local p
  p="$(test_app_pid)" || { echo "Die Test-App läuft nicht — erst: $0 starten"; return 1; }
  osascript -e "tell application \"System Events\" to set frontmost of (first process whose unix id is $p) to true" >/dev/null
  echo "✓ Test-App (PID $p) ist vorne"
}

einstellungen_schreiben() {   # Kartenschlüssel aus den Einstellungen dieses Rechners übernehmen
  "$PY" - "$NORMALER_APP_ORDNER/settings.json" "$APP_ORDNER/settings.json" <<'EOF'
import json, sys
quelle, ziel = sys.argv[1], sys.argv[2]
try:
    s = json.load(open(quelle, encoding="utf-8"))
except Exception:
    s = {}
neu = {"onboarding_done": True, "language": "de"}
for k in ("maptiler_key", "mapbox_token"):
    if s.get(k):
        neu[k] = s[k]
json.dump(neu, open(ziel, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print("Einstellungen: Onboarding erledigt, Sprache de, Schlüssel:", ", ".join(k for k in ("maptiler_key", "mapbox_token") if k in neu) or "keine")
EOF
}

arbeit_anlegen() {
  local Q="$WURZEL/Quellen" A="$WURZEL/Arbeit"
  mkdir -p "$A/archiv" "$A/zum-oeffnen" "$A/fotos" "$WURZEL/Ausgaben" "$WURZEL/Berichte"
  for d in 03-touren 05-bewegung 07-doppelt 08-teneriffa-woche 09-logger; do cp -R "$Q/$d" "$A/archiv/"; done
  # Track-Check-Fälle ohne die Dateien, die schon in 03-touren liegen (sonst ungewollte Dubletten)
  mkdir -p "$A/archiv/04-trackcheck"
  for f in "$Q/04-trackcheck/"*; do
    n="$(basename "$f")"
    [ -e "$Q/03-touren/$n" ] || [ "$n" = "track_teide.gpx" ] || cp "$f" "$A/archiv/04-trackcheck/"
  done
  for d in 01-formate 02-fehlerfaelle 06-tagesdateien; do cp -R "$Q/$d" "$A/zum-oeffnen/"; done
  cp -R "$Q/10-fotos/"* "$A/fotos/"
  cp -R "$Q/11-reiseroute" "$A/reiseroute"
  cp "$Q/SOLL-WERTE.md" "$Q/soll-werte.json" "$WURZEL/"
}

case "${1:-}" in
  einrichten)
    mkdir -p "$WURZEL"
    [ -d "$WURZEL/Quellen" ] || "$PY" "$REPO/scripts/testdaten_bauen.py" --wurzel "$WURZEL"
    schutz_schreiben "$APP_ORDNER"
    schutz_schreiben "$NORMALER_APP_ORDNER"
    echo "✓ Fotoschutz im Test-App-Ordner und im normalen App-Ordner dieses Rechners"
    echo "  Weiter: $0 zuruecksetzen vorbefuellt"
    ;;
  zuruecksetzen)
    modus="${2:-vorbefuellt}"
    [ "$modus" = "vorbefuellt" ] || [ "$modus" = "leer" ] || { echo "Modus: vorbefuellt | leer"; exit 2; }
    if laeuft_test_app; then echo "Die Test-App läuft noch — erst beenden (⌘Q)."; exit 1; fi
    [ -d "$WURZEL/Quellen" ] || { echo "Erst: $0 einrichten"; exit 1; }
    stamp="$(date +%Y%m%d-%H%M%S)"
    for d in App-Ordner Bibliothek Arbeit Ausgaben; do
      if [ -e "$WURZEL/$d" ]; then mkdir -p "$WURZEL/_alt/$stamp"; mv "$WURZEL/$d" "$WURZEL/_alt/$stamp/"; fi
    done
    [ -d "$WURZEL/_alt/$stamp" ] && echo "bisheriger Stand → _alt/$stamp"
    alt_aufraeumen
    arbeit_anlegen
    schutz_schreiben "$APP_ORDNER"
    # Test-Cloud-Zugang (Datei-Ablage, RZ_CLOUD_ABLAGE=datei) in den neuen App-Ordner mitnehmen
    for f in cloud-zugang.json cloud_zustand.json; do
      [ -f "$WURZEL/_alt/$stamp/App-Ordner/$f" ] && cp -p "$WURZEL/_alt/$stamp/App-Ordner/$f" "$APP_ORDNER/" || true
    done
    : > "$APP_ORDNER/ui-zuruecksetzen"   # beim nächsten Start leert die App ihren Browser-Speicher (Filter, Klappzustände)
    if [ "$modus" = "vorbefuellt" ]; then
      einstellungen_schreiben
      RZ_APP_ORDNER="$APP_ORDNER" RZ_CLOUD=0 "$PY" "$REPO/scripts/testumgebung_befuellen.py" "$WURZEL"
    else
      echo "Erststart: kein Zeiger, keine Einstellungen — die App zeigt das Onboarding."
    fi
    echo "✓ zurückgesetzt ($modus). Starten: $0 starten"
    ;;
  starten)
    [ -d "$APP_ORDNER" ] || { echo "Erst: $0 zuruecksetzen vorbefuellt"; exit 1; }
    [ -f "$APP_ORDNER/testrechner.json" ] || schutz_schreiben "$APP_ORDNER"
    if laeuft_test_app; then nach_vorne; exit 0; fi
    # 26.09.2026 (Codex-Lauf 3): direkt nach ⌘Q meldete `open` zweimal „kLSNoExecutableErr: The
    # executable is missing" — die alte Instanz war noch im Abbau. Erst warten, bis kein
    # GPS-Studio-Prozess mehr da ist (max. 20 s); scheitert `open`, App neu anmelden und nochmal.
    for _ in $(seq 1 40); do pgrep -f "Reisezoom GPS Studio.app/Contents/MacOS" >/dev/null || break; sleep 0.5; done
    if ! open -n -a "$APP" --env "RZ_APP_ORDNER=$APP_ORDNER" --env "RZ_CLOUD_ABLAGE=datei" 2>/tmp/rz-open-fehler.txt; then
      echo "  open scheiterte ($(tr -d '\n' < /tmp/rz-open-fehler.txt | cut -c1-120)) — melde die App neu an und versuche es noch einmal …"
      /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP" 2>/dev/null || true
      sleep 2
      open -n -a "$APP" --env "RZ_APP_ORDNER=$APP_ORDNER" --env "RZ_CLOUD_ABLAGE=datei"
    fi
    echo "✓ gestartet mit App-Ordner $APP_ORDNER (oben rechts steht „· TEST“)"
    ;;
  vorne)
    nach_vorne ;;
  oeffnen)   # 25.09.2026 — AN-25/AL-02: eine Datei von außerhalb öffnen wie per Doppelklick im Finder (Apple-Event „odoc")
    DATEI="${2:-}"
    [ -f "$DATEI" ] || { echo "Datei fehlt oder gibt es nicht: $0 oeffnen <pfad>"; exit 2; }
    test_app_pid >/dev/null || { echo "Die Test-App läuft nicht — erst: $0 starten"; exit 1; }
    # Läuft daneben die normale App, könnte macOS die Datei ihr geben → dann lieber nichts tun.
    for p in $(pgrep -f "Reisezoom GPS Studio.app/Contents/MacOS" || true); do
      if ! ps -Eww -o command= -p "$p" | grep -qF "RZ_APP_ORDNER=$APP_ORDNER"; then
        echo "Die normale App läuft auch (PID $p) — erst beenden, sonst landet die Datei womöglich dort."; exit 1
      fi
    done
    open -a "$APP" "$DATEI"
    echo "✓ an die Test-App übergeben: $DATEI"
    nach_vorne ;;
  schutzprobe)   # GT-12: ein Ordner AUSSERHALB der Testwurzel mit einer Fotokopie — die App muss sich weigern
    PROBE="/tmp/rz-schutzprobe"
    mkdir -p "$PROBE" && cp "$WURZEL/Quellen/10-fotos/geotagger/A_01.jpg" "$PROBE/A_01.jpg"
    echo "✓ $PROBE/A_01.jpg angelegt (ohne GPS). In der App: Ordner laden, Zielordner = derselbe → muss verweigert werden."
    echo "  Prüfen danach: exiftool -gps:all $PROBE/A_01.jpg  (Soll: leer)" ;;
  aufraeumen)
    alt_aufraeumen; echo "  _alt: $(du -sh "$WURZEL/_alt" 2>/dev/null | cut -f1)" ;;
  cloud-einrichten)
    [ -n "${2:-}" ] || { echo "Adresse fehlt: $0 cloud-einrichten https://…/rz-cloud.php"; exit 2; }
    if laeuft_test_app; then echo "Die Test-App läuft noch — erst beenden (⌘Q)."; exit 1; fi
    RZ_APP_ORDNER="$APP_ORDNER" RZ_CLOUD_ABLAGE=datei "$PY" "$REPO/scripts/testumgebung_cloud.py" "$WURZEL" "$2"
    ;;
  status)
    echo "Testwurzel:  $WURZEL"
    echo "App:         $APP"
    for d in Quellen Arbeit App-Ordner Bibliothek Ausgaben Berichte _alt; do
      printf '  %-11s %s\n' "$d" "$( [ -e "$WURZEL/$d" ] && du -sh "$WURZEL/$d" | cut -f1 || echo '—')"
    done
    for o in "$APP_ORDNER" "$NORMALER_APP_ORDNER"; do
      printf '  Fotoschutz %s: %s\n' "$( [ "$o" = "$APP_ORDNER" ] && echo test || echo normal)" \
        "$( [ -f "$o/testrechner.json" ] && echo an || echo AUS)"
    done
    if [ -f "$APP_ORDNER/cloud_zustand.json" ]; then
      echo "  Cloud:      $("$PY" -c 'import json,sys; print(json.load(open(sys.argv[1])).get("adresse","?"))' "$APP_ORDNER/cloud_zustand.json")"
    else
      echo "  Cloud:      nicht eingerichtet"
    fi
    laeuft_test_app && echo "  Test-App läuft" || echo "  Test-App läuft nicht"
    ;;
  *)
    sed -n '2,20p' "$0"; exit 2 ;;
esac
