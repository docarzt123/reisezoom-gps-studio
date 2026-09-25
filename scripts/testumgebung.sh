#!/usr/bin/env bash
# Testumgebung für GPS Studio (25.09.2026) — der Mac mini ist der Testrechner.
#
#   scripts/testumgebung.sh einrichten                 Ordner + Testdaten + Fotoschutz anlegen
#   scripts/testumgebung.sh zuruecksetzen vorbefuellt   frische Arbeitskopien, Bibliothek mit Archiv
#   scripts/testumgebung.sh zuruecksetzen leer          frische Arbeitskopien, Erststart (Onboarding)
#   scripts/testumgebung.sh starten                    installierte App MIT dem Test-App-Ordner starten
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
# Zurücksetzen löscht nichts: der bisherige Stand wandert nach $RZ_TESTWURZEL/_alt/<Zeit>/.
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

laeuft_test_app() {
  ps -Ewwo pid,command | grep -F "RZ_APP_ORDNER=$APP_ORDNER" | grep -v grep >/dev/null 2>&1
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
    arbeit_anlegen
    schutz_schreiben "$APP_ORDNER"
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
    open -n -a "$APP" --env "RZ_APP_ORDNER=$APP_ORDNER"
    echo "✓ gestartet mit App-Ordner $APP_ORDNER (oben rechts steht „· TEST“)"
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
    laeuft_test_app && echo "  Test-App läuft" || echo "  Test-App läuft nicht"
    ;;
  *)
    sed -n '2,20p' "$0"; exit 2 ;;
esac
