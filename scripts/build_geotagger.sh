#!/usr/bin/env bash
# STILLGELEGT am 15.08.2026 (Marc: sterben lassen).
#
# Der Solo-Geotagger wird nicht mehr gebaut, ausgeliefert oder verlinkt.
# Grund: Er existierte, damit man ohne Mapbox-Schlüssel Fotos verorten
# kann — und genau das kann die volle App längst selbst (`createMap()` in
# ui/js/util.js fällt ohne Schlüssel auf MapLibre mit OSM zurück). Übrig
# blieb die Dateigröße, gegen den Preis eines zweiten Signier-,
# Notarisierungs- und Testpfads für eine App, die an einer einzigen Stelle
# verlinkt war und für die es nie eine Messung gab.
#
# Das Skript bleibt liegen: der Edition-Schalter in app.py und
# ui/js/app.js ist weiterhin da, wer die Solo-App zurückholen will,
# braucht nur den Block in .github/workflows/release.yml wieder.
# Reisezoom Geotagger (Solo-Edition) — schlankes App-Bundle bauen + nach /Applications.
#
# Gleiche Codebasis wie Reisezoom GPS Studio, aber:
#   - RZ_EDITION=geotagger → UI zeigt NUR den Geotagger, Karte = OSM (kein Mapbox/Kreditkarte)
#   - die Spec lässt Chromium (pw-browsers/) + ffmpeg weg → ~220 MB kleiner
#   - eigenes Bundle „Reisezoom Geotagger.app" (com.reisezoom.geotagger)
#
# Aufruf:  ./scripts/build_geotagger.sh
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

if [ ! -d ".venv" ]; then
  echo "venv fehlt — erst ./run.sh ausführen für Erstaufsetzung."
  exit 1
fi
source .venv/bin/activate

if ! python -c "import PyInstaller" 2>/dev/null; then
  echo "Installiere pyinstaller …"
  pip install -q pyinstaller
fi

APPNAME="Reisezoom Geotagger.app"
export RZ_EDITION=geotagger

# Falls App schon offen ist → killen, sonst können wir nicht überschreiben
pkill -f ReisezoomGeotagger 2>/dev/null || true
sleep 1

# User-Guide-HTML (Hilfe-Menü) — gemeinsame Doku, ist im Bundle ohnehin klein
echo "📖  Baue USER_GUIDE.html …"
python3 scripts/build_user_guide_html.py

# exiftool-Binary (Pflicht fürs Tagging von RAW/HEIC/Video). Chromium NICHT —
# der Solo-Tagger rendert keine Videos.
if [ ! -f "vendor/exiftool/macos/exiftool" ]; then
  echo "🔧  vendor/exiftool/ fehlt — Setup-Script läuft …"
  bash scripts/setup_vendor_exiftool.sh
fi

echo "🔨  Baue Solo-Geotagger (.app, RZ_EDITION=geotagger) …"
rm -rf build dist
pyinstaller ReisezoomGPSStudio.spec --clean --noconfirm 2>&1 | tail -5

if [ ! -d "dist/$APPNAME" ]; then
  echo "❌ Build hat keine .app produziert. Logs siehe dist/."
  exit 1
fi

echo "📦  Installiere nach /Applications/ …"
rm -rf "/Applications/$APPNAME"
cp -R "dist/$APPNAME" /Applications/

# Ad-hoc Codesign + Quarantine raus (wie build.sh)
codesign --force --deep --sign - "/Applications/$APPNAME" 2>/dev/null || true
xattr -dr com.apple.quarantine "/Applications/$APPNAME" 2>/dev/null || true

SIZE=$(du -sh "/Applications/$APPNAME" | cut -f1)
echo ""
echo "✅  Fertig: /Applications/$APPNAME  ($SIZE)"
echo "   (Vollversion bleibt separat: /Applications/Reisezoom GPS Studio.app)"
echo "   Doppelklick zum Starten oder:  open \"/Applications/$APPNAME\""
