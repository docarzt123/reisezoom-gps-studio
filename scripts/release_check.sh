#!/usr/bin/env bash
# ── Reisezoom GPS Studio · Pre-Release-Prüfung ──────────────────────────────
# EIN Kommando, das VOR jedem Release grün sein MUSS. Läuft die automatisierten
# Gates der Reihe nach; bricht mit Exit≠0 ab, sobald eines fehlschlägt.
#
#   ./scripts/release_check.sh          # alle Gates (Sekunden bis ~1 Min)
#   ./scripts/release_check.sh --fast   # nur statische Gates 1-4 (Sekunden, kein Playwright)
#   ./scripts/release_check.sh --full   # zusätzlich echte Video-Renders (langsam, braucht Token)
#
# Deckt NICHT ab: die visuelle Vorschau (Track sichtbar? WYSIWYG?). Das prüft
# der Mensch — siehe docs/TESTING.md, Teil B (Pflicht-Sichtprüfung).
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

FULL=0; FAST=0
case "${1:-}" in
  --full) FULL=1 ;;
  --fast) FAST=1 ;;   # nur Syntax/i18n/Invarianten — für build.sh-Iteration
esac
FAILED=()
step() { printf "\n\033[1m▶ %s\033[0m\n" "$1"; }
run()  { # run "<name>" <cmd...>
  local name="$1"; shift
  step "$name"
  if "$@"; then printf "  \033[32m✓ %s\033[0m\n" "$name"
  else printf "  \033[31m✗ %s FEHLGESCHLAGEN\033[0m\n" "$name"; FAILED+=("$name"); fi
}

# venv aktivieren (Playwright/Core-Imports)
[[ -f .venv/bin/activate ]] && source .venv/bin/activate

# 1) JS-Syntax aller UI-/Modul-Skripte
run "JS-Syntax (node --check)" bash -c '
  ok=1
  for f in ui/js/*.js modules/*/ui/module.js; do
    node --check "$f" || { echo "  Syntaxfehler: $f"; ok=0; }
  done
  [[ $ok == 1 ]]'

# 2) Python-Syntax (Backend + Skripte)
run "Python-Syntax (py_compile)" bash -c '
  python3 -m py_compile app.py core/*.py scripts/*.py 2>&1'

# 3) i18n-Konsistenz (DE/EN/ES deckungsgleich, keine fehlenden Keys)
run "i18n-Konsistenz" python3 scripts/check_i18n.py

# 4) Fix-Invarianten: kritische Regressions-Guards dürfen nicht verschwinden
run "Fix-Invarianten (Track + Probe-Lauf)" bash -c '
  grep -q "coords.length < 2" modules/animator/ui/module.js &&
  grep -q "_isStaticFrame) return true" modules/animator/ui/module.js &&
  grep -q "fitBase null + Karte still" modules/animator/ui/module.js'

if [[ $FAST == 1 ]]; then
  printf "\n\033[2m▶ --fast: Headless-Tests + Renders übersprungen (nur statische Gates)\033[0m\n"
else
  # 5) Headless-UI-Smoke: alle Module laden, 0 pageerrors
  run "UI-Smoke (selftest_ui)" python3 scripts/selftest_ui.py

  # 6) Headless-Tiefentest: jeder Regler/Akkordeon/Undo, 0 pageerrors
  run "UI-Tiefentest (selftest_deep)" python3 scripts/selftest_deep.py

  # 7) Track-Sichtbarkeit (best effort; SKIPt wenn Vorschau headless nicht füllbar)
  run "Track-Sichtbarkeit (selftest_track_visible)" python3 scripts/selftest_track_visible.py

  # 8) Optional: echte Video-Renders (nur mit --full; braucht Token + Fixtures)
  if [[ $FULL == 1 ]]; then
    run "Echte Renders (selftest_renders)" python3 scripts/selftest_renders.py
  else
    printf "\n\033[2m▶ Echte Renders übersprungen (--full für vollen Lauf)\033[0m\n"
  fi
fi

# ── Ergebnis ────────────────────────────────────────────────────────────────
echo ""
if [[ ${#FAILED[@]} -eq 0 ]]; then
  printf "\033[42m\033[30m  ALLE AUTOMATISCHEN GATES GRÜN  \033[0m\n"
  echo "→ Jetzt PFLICHT: die manuelle Sichtprüfung aus docs/TESTING.md (Teil B),"
  echo "  bevor getaggt/deployed wird."
  exit 0
else
  printf "\033[41m\033[37m  %d GATE(S) FEHLGESCHLAGEN:  \033[0m %s\n" "${#FAILED[@]}" "${FAILED[*]}"
  echo "→ Release blockiert, bis alle grün sind."
  exit 1
fi
