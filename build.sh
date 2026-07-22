#!/usr/bin/env bash
# Reisezoom GPS Studio — App-Bundle bauen + nach /Applications/ installieren
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

if [ ! -d ".venv" ]; then
  echo "venv fehlt — erst ./run.sh ausführen für Erstaufsetzung."
  exit 1
fi
source .venv/bin/activate

# Pre-flight: pyinstaller drin?
if ! python -c "import PyInstaller" 2>/dev/null; then
  echo "Installiere pyinstaller …"
  pip install -q pyinstaller
fi

APPNAME="Reisezoom GPS Studio.app"

# Falls App schon offen ist → killen, sonst können wir nicht überschreiben
pkill -f ReisezoomGPSStudio 2>/dev/null || true
sleep 1

# v0.9.459 — i18n-Konsistenz prüfen (Warn-Gate, bricht den Build NICHT ab).
# Fängt fehlende Keys (roher Key in der UI) + Sprachen-Drift, bevor ausgeliefert
# wird. Kein harter Stopp, damit ein vergessener String kein Release blockiert.
echo "🌍  Prüfe i18n-Konsistenz …"
python3 scripts/check_i18n.py || echo "⚠️  i18n-Warnung (siehe oben) — Build läuft weiter."

# User-Guide-HTML aus Markdown generieren (für Hilfe-Menü)
echo "📖  Baue USER_GUIDE.html …"
python3 scripts/build_user_guide_html.py

# v0.9.61 — exiftool-Binary für macOS + Windows nachladen falls noch nicht da
if [ ! -f "vendor/exiftool/macos/exiftool" ] || [ ! -f "vendor/exiftool/windows/exiftool-13.58_64/exiftool.exe" ]; then
  echo "🔧  vendor/exiftool/ fehlt — Setup-Script läuft …"
  bash scripts/setup_vendor_exiftool.sh
fi

# v0.9.229 — Playwright-Chromium ins Bundle (pw-browsers/), damit auch lokale
# Builds out-of-box rendern. Nur ziehen wenn noch nicht da (Browser sind groß).
if [ -z "$(ls -d pw-browsers/chromium_headless_shell-* 2>/dev/null)" ]; then
  echo "🌐  Chromium-Headless-Shell ins Bundle laden (pw-browsers/) …"
  PLAYWRIGHT_BROWSERS_PATH="$PWD/pw-browsers" python3 -m playwright install chromium-headless-shell
fi

echo "🔨  Baue .app …"
rm -rf build dist
pyinstaller ReisezoomGPSStudio.spec --clean --noconfirm 2>&1 | tail -5

if [ ! -d "dist/$APPNAME" ]; then
  echo "❌ Build hat keine .app produziert. Logs siehe dist/."
  exit 1
fi

echo "📦  Installiere nach /Applications/ …"
rm -rf "/Applications/$APPNAME"
cp -R "dist/$APPNAME" /Applications/

# Ad-hoc Codesign (Gatekeeper-freundlicher als unsigned)
codesign --force --deep --sign - "/Applications/$APPNAME" 2>/dev/null || true
# Quarantine-Flag raus (sonst meckert macOS beim ersten Doppelklick)
xattr -dr com.apple.quarantine "/Applications/$APPNAME" 2>/dev/null || true

SIZE=$(du -sh "/Applications/$APPNAME" | cut -f1)
echo ""
echo "✅  Fertig: /Applications/$APPNAME  ($SIZE)"
echo "   Doppelklick zum Starten oder:  open \"/Applications/$APPNAME\""
