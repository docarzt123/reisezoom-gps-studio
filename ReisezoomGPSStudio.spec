# PyInstaller spec for Reisezoom GPS Studio (macOS .app)
# Build:  source .venv/bin/activate && pyinstaller ReisezoomGPSStudio.spec --clean --noconfirm

import os
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

block_cipher = None

# UI + Module + i18n als Resource-Daten einsammeln (gleiche relative Struktur)
data_files = []
for top in ("ui", "modules", "i18n"):
    if not os.path.isdir(top):
        continue
    for root, dirs, files in os.walk(top):
        for f in files:
            src = os.path.join(root, f)
            dst = root
            data_files.append((src, dst))

# User-Doku ins Bundle einbacken. Wir liefern die HTML-Version aus
# (siehe scripts/build_user_guide_html.py — wird von build.sh aufgerufen)
# damit ein nativer Browser sie schick rendert. Die .md bleibt absichtlich
# außen vor — Endnutzer sollen die schöne Version sehen.
# DEVELOPER.md + IDEAS.md + CHANGELOG.md sind Entwickler-Material und
# kommen NICHT mit ins Bundle.
for doc in ("docs/USER_GUIDE.html",):
    if os.path.isfile(doc):
        dst_dir = os.path.dirname(doc) or "."
        data_files.append((doc, dst_dir))

# pywebview-Resources sind manchmal nötig
data_files += collect_data_files("webview")

# Gebündeltes ffmpeg-Binary aus imageio-ffmpeg — damit User KEIN
# System-ffmpeg installieren müssen (Animator-MP4-Encode funktioniert
# out-of-the-box). Binary ist ~30 MB statisch gelinkt.
data_files += collect_data_files("imageio_ffmpeg", include_py_files=False)

# v0.9.61 (Marc-Wunsch): exiftool plattform-spezifisch ins Bundle.
# macOS + Windows kriegen das Binary direkt, Linux-User installieren
# es via System-Paketmanager (siehe USER_GUIDE.md). vendor/exiftool/
# wird beim Build erwartet — siehe scripts/setup_vendor_exiftool.sh.
import sys as _spec_sys, os as _spec_os
_EXIFTOOL_SRC = None
if _spec_sys.platform == "darwin" and _spec_os.path.isdir("vendor/exiftool/macos"):
    _EXIFTOOL_SRC = "vendor/exiftool/macos"
elif _spec_sys.platform == "win32":
    # Versionsunabhängig: irgendein exiftool-*_64-Verzeichnis nehmen (der
    # exakte Versions-Ordnername kommt aus der dynamisch geholten Version).
    import glob as _spec_glob
    _win_dirs = sorted(_spec_glob.glob("vendor/exiftool/windows/exiftool-*_64"))
    if _win_dirs:
        _EXIFTOOL_SRC = _win_dirs[-1]
if _EXIFTOOL_SRC:
    for _root, _dirs, _files in _spec_os.walk(_EXIFTOOL_SRC):
        _rel = _spec_os.path.relpath(_root, _EXIFTOOL_SRC)
        _dst = "exiftool" if _rel == "." else _spec_os.path.join("exiftool", _rel)
        for _f in _files:
            data_files.append((_spec_os.path.join(_root, _f), _dst))

# v0.9.229 (Windows-Bug-Report Peter Straka) — Playwright-Chromium-Headless-Shell
# ins Bundle, damit Animator/Tour-Map/Höhen-Render OUT-OF-BOX laufen (kein
# Download beim 1. Render). `pw-browsers/` wird VOR dem PyInstaller-Lauf befüllt:
#   PLAYWRIGHT_BROWSERS_PATH=<repo>/pw-browsers playwright install chromium-headless-shell
# (lokal in build.sh, in CI in release.yml). app.py setzt zur Laufzeit
# PLAYWRIGHT_BROWSERS_PATH auf den gebündelten Pfad (sys._MEIPASS/pw-browsers).
# Fehlt der Ordner (z.B. Dev-Build ohne Install) → kein Bundling, Runtime nutzt
# den User-Cache-Fallback (Download-on-first-render bleibt als Sicherheitsnetz).
if _spec_os.path.isdir("pw-browsers"):
    for _root, _dirs, _files in _spec_os.walk("pw-browsers"):
        _rel = _spec_os.path.relpath(_root, "pw-browsers")
        _dst = "pw-browsers" if _rel == "." else _spec_os.path.join("pw-browsers", _rel)
        for _f in _files:
            data_files.append((_spec_os.path.join(_root, _f), _dst))

import sys as _sys

# Plattform-Unabhängige Hidden-Imports
hidden = [
    "webview",
    "PIL",
    "piexif",
    "gpxpy",
    # v0.9.282 — FIT-Import (Garmin/Wahoo). Lazy import in core/imports.py → muss
    # explizit als hidden-import rein, sonst fehlt's im PyInstaller-Bundle.
    "fitdecode",
    "playwright",
    "playwright.async_api",
    "imageio_ffmpeg",   # gebündeltes ffmpeg-Binary für Animator-MP4-Encode
    # v0.9.57 — pillow-heif für HEIC/HEIF-Support (Beta-Tester-Bug: iPhone-Fotos)
    "pillow_heif",
    "_pillow_heif_cffi",
]
# Native libheif/.dylib aus pillow-heif mitnehmen
data_files += collect_data_files("pillow_heif", include_py_files=False)

# Plattform-spezifische Imports
if _sys.platform == "darwin":
    hidden += [
        "webview.platforms.cocoa",
        "webview.platforms.cocoa.window",
        "webview.platforms.cocoa.utils",
        "webview.platforms.cocoa.gui",
        "Foundation",
        "AppKit",
        "WebKit",
        "objc",
    ]
elif _sys.platform == "win32":
    hidden += [
        "webview.platforms.edgechromium",
        "webview.platforms.winforms",
        "clr_loader",
        "pythonnet",
    ]
else:
    # Linux: GTK/QT-Backend von pywebview
    hidden += [
        "webview.platforms.gtk",
        "webview.platforms.qt",
    ]

# Auto-collect pywebview-Submodule (fallback)
hidden += collect_submodules("webview")
# Auto-collect playwright (große Library)
hidden += collect_submodules("playwright")


a = Analysis(
    ["app.py"],
    pathex=[],
    binaries=[],
    datas=data_files,
    hiddenimports=hidden,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Müll der die App aufbläht
        "tkinter", "PyQt5", "PyQt6", "PySide2", "PySide6",
        "matplotlib", "scipy", "numpy.tests",
        "test", "tests", "unittest",
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

# Windows-Icon falls vorhanden (PyInstaller verlangt .ico, nicht .png/.icns)
_exe_icon = None
if _sys.platform == "win32" and os.path.isfile("assets/icon.ico"):
    _exe_icon = "assets/icon.ico"
elif _sys.platform == "linux" and os.path.isfile("assets/icon_1024.png"):
    _exe_icon = "assets/icon_1024.png"

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="ReisezoomGPSStudio",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=_exe_icon,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="ReisezoomGPSStudio",
)

# macOS-spezifisches .app-BUNDLE — auf Windows/Linux übersprungen
# (PyInstaller produziert dann nur den `dist/ReisezoomGPSStudio/`-Ordner mit
# dem ausführbaren Binary, das wird in den Cross-Platform-Workflows verpackt).
if _sys.platform == "darwin":
    # Version aus app.py.APP_VERSION lesen, damit Info.plist im Bundle nicht
    # versehentlich auf einem alten Stand bleibt. Einziger Versions-Wahrheitsort
    # ist `APP_VERSION` in app.py.
    import re as _re
    _APP_VERSION = "0.0.0"
    try:
        with open("app.py", "r", encoding="utf-8") as _f:
            _m = _re.search(r'^APP_VERSION\s*=\s*"([^"]+)"', _f.read(), _re.M)
            if _m:
                _APP_VERSION = _m.group(1)
    except Exception:
        pass

    app = BUNDLE(
        coll,
        name="Reisezoom GPS Studio.app",
        icon="assets/icon.icns",
        bundle_identifier="com.reisezoom.gpsstudio",
        version=_APP_VERSION,
        info_plist={
            "CFBundleName": "Reisezoom GPS Studio",
            "CFBundleDisplayName": "Reisezoom GPS Studio",
            "CFBundleShortVersionString": _APP_VERSION,
            "CFBundleVersion": _APP_VERSION,
            "NSHumanReadableCopyright": "© 2026 Reisezoom",
            "NSHighResolutionCapable": True,
            "NSRequiresAquaSystemAppearance": False,  # Dark-Mode ok
            # WKWebView braucht in NSAppTransportSecurity oft erweiterte Rechte
            "NSAppTransportSecurity": {
                "NSAllowsArbitraryLoads": True,
            },
        },
    )
