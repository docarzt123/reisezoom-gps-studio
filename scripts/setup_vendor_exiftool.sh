#!/usr/bin/env bash
# Reisezoom GPS Studio — exiftool-Binary für macOS + Windows ins
# vendor/-Verzeichnis laden, damit PyInstaller es ins App-Bundle einbacken kann.
#
# Wann benutzen:
#   - Erster Build auf einem frischen Checkout
#   - Wenn vendor/exiftool/ fehlt (durch git clean o.ä.)
#   - In CI (GitHub Actions) vor `pyinstaller`
#
# Marc-Regel 2026-05-25: Linux-User installieren ExifTool selbst via
# Paketmanager (siehe USER_GUIDE.md). Daher hier nur macOS + Windows.

set -e

# Version dynamisch von exiftool.org/ver.txt holen, aber von SourceForge LADEN.
# Grund: exiftool.org hostet nur die jeweils AKTUELLE Version (neue raus → alte
# URL 404 → CI-Build tot, v0.9.315). SourceForge archiviert ALLE Versionen → robust.
# Fallback-Version muss eine sein, die auf SF existiert.
EXIFTOOL_VERSION="$(curl -fsSL https://exiftool.org/ver.txt 2>/dev/null | tr -d '[:space:]')"
[ -z "$EXIFTOOL_VERSION" ] && EXIFTOOL_VERSION="13.59"
SF_BASE="https://downloads.sourceforge.net/project/exiftool"
echo "ℹ ExifTool-Version: ${EXIFTOOL_VERSION} (Download via SourceForge)"

# Projekt-Root finden (Script liegt in scripts/, vendor/ ist daneben)
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR="${DIR}/vendor/exiftool"

mkdir -p "${VENDOR}"
cd "${VENDOR}"

# ── macOS ────────────────────────────────────────────────────────────
# Image-ExifTool-X.YZ.tar.gz = Perl-Source-Distribution mit `exiftool`-Script
# + lib/-Modulen. Läuft auf macOS via System-Perl (/usr/bin/perl).
if [ ! -f "macos/exiftool" ]; then
  echo "📥 Lade ExifTool ${EXIFTOOL_VERSION} (macOS) …"
  TMP_TAR="macos-${EXIFTOOL_VERSION}.tar.gz"
  # 01.10.2026 — SourceForge fiel beim Release v0.9.754 mit 522/523 aus: erst mehrere
  # Versuche dort, dann das offizielle Repository auf GitHub (gleicher Perl-Inhalt).
  if ! curl -fsSL --retry 4 --retry-delay 10 --retry-all-errors "${SF_BASE}/Image-ExifTool-${EXIFTOOL_VERSION}.tar.gz" -o "${TMP_TAR}"; then
    echo "  ⚠ SourceForge nicht erreichbar — lade von GitHub (exiftool/exiftool, Tag ${EXIFTOOL_VERSION})"
    curl -fsSL --retry 3 --retry-delay 5 "https://github.com/exiftool/exiftool/archive/refs/tags/${EXIFTOOL_VERSION}.tar.gz" -o "${TMP_TAR}"
  fi
  rm -rf macos
  mkdir -p macos
  tar -xzf "${TMP_TAR}" -C macos --strip-components=1
  # Bloat raus — wir brauchen nur exiftool + lib/
  cd macos
  rm -rf t html Changes MANIFEST META.json META.yml Makefile.PL \
         README windows_exiftool config_files arg_files \
         perl-Image-ExifTool.spec fmt_files build_geolocation .github .pre-commit-hooks.yaml build_tag_lookup validate pp_build_exe.args windows_exiftool.txt 2>/dev/null || true
  cd ..
  rm -f "${TMP_TAR}"
  chmod +x macos/exiftool
  [ "$(macos/exiftool -ver)" = "${EXIFTOOL_VERSION}" ] || { echo "  ❌ falsche ExifTool-Version: $(macos/exiftool -ver)"; exit 1; }
  echo "  ✅ macOS ExifTool $(macos/exiftool -ver)"
else
  echo "  ✓ macOS ExifTool $(macos/exiftool -ver) (schon vorhanden)"
fi

# ── Windows ──────────────────────────────────────────────────────────
# exiftool-X.YZ_64.zip = portable .exe mit eingebautem Perl. Native Binary,
# keine Runtime-Abhängigkeit.
if [ ! -f "windows/exiftool-${EXIFTOOL_VERSION}_64/exiftool.exe" ]; then
  echo "📥 Lade ExifTool ${EXIFTOOL_VERSION} (Windows) …"
  TMP_ZIP="windows-${EXIFTOOL_VERSION}.zip"
  curl -fsSL "${SF_BASE}/exiftool-${EXIFTOOL_VERSION}_64.zip" -o "${TMP_ZIP}"
  rm -rf windows
  mkdir -p windows
  unzip -q "${TMP_ZIP}" -d windows
  # Windows-ZIP enthält "exiftool(-k).exe" — umbenennen zu "exiftool.exe"
  if [ -f "windows/exiftool-${EXIFTOOL_VERSION}_64/exiftool(-k).exe" ]; then
    mv "windows/exiftool-${EXIFTOOL_VERSION}_64/exiftool(-k).exe" \
       "windows/exiftool-${EXIFTOOL_VERSION}_64/exiftool.exe"
  fi
  # Bloat raus
  rm -f "windows/exiftool-${EXIFTOOL_VERSION}_64/README.txt"
  rm -f "${TMP_ZIP}"
  echo "  ✅ Windows ExifTool ${EXIFTOOL_VERSION}"
else
  echo "  ✓ Windows ExifTool ${EXIFTOOL_VERSION} (schon vorhanden)"
fi

echo "✅ vendor/exiftool/ ready ($(du -sh "${VENDOR}" | cut -f1))"
