#!/usr/bin/env bash
# Notarisiert ein DMG bei Apple und heftet (staple) das Ticket an.
# Braucht die Secrets APPLE_ID / APPLE_APP_PASSWORD / APPLE_TEAM_ID.
# Fehlen sie, wird sauber übersprungen (DMG bleibt un-notarisiert) → bestehende
# Releases brechen nicht.
# Aufruf:  bash scripts/macos_notarize.sh "dist/dmg/ReisezoomGPSStudio-macos.dmg"
set -euo pipefail

DMG="${1:?Pfad zum DMG fehlt}"

if [ -z "${APPLE_ID:-}" ] || [ -z "${APPLE_APP_PASSWORD:-}" ] || [ -z "${APPLE_TEAM_ID:-}" ]; then
  echo "ℹ️  Notarisierungs-Secrets fehlen (APPLE_ID/APPLE_APP_PASSWORD/APPLE_TEAM_ID)"
  echo "    → überspringe Notarisierung für $DMG"
  exit 0
fi

echo "📤 Notarisiere $DMG  (kann ein paar Minuten dauern) …"
xcrun notarytool submit "$DMG" \
  --apple-id "$APPLE_ID" \
  --password "$APPLE_APP_PASSWORD" \
  --team-id "$APPLE_TEAM_ID" \
  --wait

echo "📎 Staple Ticket an $DMG …"
xcrun stapler staple "$DMG"
xcrun stapler validate "$DMG"
echo "✅ Notarisiert + gestapelt: $DMG"
