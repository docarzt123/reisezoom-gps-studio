#!/usr/bin/env bash
# Signiert eine .app für die macOS-Distribution.
#   - Mit gesetzter $MACOS_SIGN_IDENTITY (aus dem Import-Schritt der CI):
#     Developer-ID-Signatur + Hardened Runtime + Entitlements (notarisierbar).
#   - Ohne Identität (keine Secrets hinterlegt): Ad-hoc-Signatur wie bisher,
#     damit bestehende Releases nicht brechen.
# Aufruf:  bash scripts/macos_sign.sh "dist/Reisezoom GPS Studio.app"
set -euo pipefail

APP="${1:?Pfad zur .app fehlt}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
ENT="$HERE/entitlements.plist"

if [ -z "${MACOS_SIGN_IDENTITY:-}" ]; then
  echo "ℹ️  Keine Signing-Identität gesetzt → Ad-hoc-Signatur: $APP"
  codesign --force --deep --sign - "$APP" || true
  exit 0
fi

echo "🔏 Developer-ID-Signatur: $MACOS_SIGN_IDENTITY"
echo "    App: $APP"

# 1) Verschachtelte Mach-O-Binaries zuerst signieren (robuster als nur --deep):
#    dylibs/.so + ausführbare Dateien in Frameworks/. codesign auf Nicht-Mach-O
#    (Skripte etc.) schlägt harmlos fehl → mit || true schlucken.
while IFS= read -r -d '' f; do
  codesign --force --timestamp --options runtime \
    --sign "$MACOS_SIGN_IDENTITY" "$f" >/dev/null 2>&1 || true
done < <(find "$APP/Contents" \( -name "*.dylib" -o -name "*.so" \) -print0 2>/dev/null)

# 2) Gesamte App signieren (Hardened Runtime + Entitlements). --deep als
#    Sicherheitsnetz für noch nicht erfasste verschachtelte Bundles.
codesign --force --deep --timestamp --options runtime \
  --entitlements "$ENT" \
  --sign "$MACOS_SIGN_IDENTITY" "$APP"

# 3) Prüfen.
codesign --verify --strict --verbose=2 "$APP"
echo "✅ Signatur ok: $APP"
