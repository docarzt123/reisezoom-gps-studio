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

# Statische Release-Gates (schnell, Warn-Gate — bricht lokalen Build NICHT ab).
# `--fast` = JS-/Python-Syntax + i18n-Konsistenz + Fix-Invarianten (kein Playwright).
# Die vollen Headless-Tests laufen im harten Gate von deploy_release.sh sowie
# manuell via ./scripts/release_check.sh. Siehe docs/TESTING.md.
echo "🔎  Statische Release-Gates (schnell) …"
bash scripts/release_check.sh --fast || echo "⚠️  Gate-Warnung (siehe oben) — Build läuft weiter."

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
