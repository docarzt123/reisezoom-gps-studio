# Reisezoom GPS Studio — Entwickler-Dokumentation

**Zielgruppe:** Mit-Entwickler, KI-Coding-Agents in zukünftigen Sessions.
**Pflicht:** Bei Architektur-Änderungen diese Datei aktualisieren.

---

## 1 · Architektur-Überblick

```
┌─────────────────────────────────────────────────────────────────────┐
│  Reisezoom GPS Studio  —  pywebview-App (macOS .app)                │
│                                                                     │
│  ┌─────────────────────────────┐    ┌─────────────────────────────┐ │
│  │  Frontend (WebView)         │    │  Backend (Python 3.14)      │ │
│  │                             │    │                             │ │
│  │  ui/index.html              │    │  app.py                     │ │
│  │  ui/css/app.css             │◀──▶│  └─ class Api               │ │
│  │  ui/js/{app,animator,       │ JS │     ├─ animator_* methods   │ │
│  │         geotagger,util}.js  │ ↔  │     └─ geotagger_* methods  │ │
│  │  Mapbox GL JS (via CDN)     │ Py │                             │ │
│  └─────────────────────────────┘    │  core/                      │ │
│                                     │    gpx.py     (Parser)      │ │
│                                     │    exif.py    (EXIF I/O)    │ │
│                                     │    geotag.py  (Match-Logik) │ │
│                                     │    backup.py  (ZIP)         │ │
│                                     │    animator.py (Render)     │ │
│                                     └─────────────────────────────┘ │
│                                                                     │
│  Render-Pipeline (Animator):                                        │
│  GPX → Python parses → Playwright (Chromium headless)               │
│      → Mapbox GL JS rendert Frame-für-Frame                         │
│      → PNG-Screenshots via stdin → ffmpeg → H.264 MP4               │
└─────────────────────────────────────────────────────────────────────┘
```

**Designprinzipien:**
- **Backend dumb, UI smart-ish**: Python liefert Daten + macht schwere Pipelines. UI macht Layouts, Karten, Live-Updates.
- **Keine Round-Trips während Live-Updates**: Match-Logik läuft sync im Python, UI bekommt fertige Marker-Liste.
- **State im Python**: `Api._gtg_track`, `_gtg_photos` halten den Session-State. JS hält nur die letzte Match-Antwort.
- **Schreibvorgänge irreversibel** → immer ZIP-Backup vorher (Default an).

---

## 2 · Verzeichnis-Struktur

```
Reisezoom-GPS-Studio/
├── app.py                   # pywebview-Entry, JS-Bridge (class Api)
├── core/                    # reine Python-Logik, keine GUI-Abhängigkeit
│   ├── __init__.py
│   ├── gpx.py               # GPX-Parser, Stats, Downsample
│   ├── exif.py              # piexif + exiftool Daemon (Read/Write)
│   ├── geotag.py            # Match-Algorithmus, Offset-Ableitung
│   ├── backup.py            # ZIP-Snapshots mit Retention
│   ├── animator.py          # Mapbox-+-Playwright-+-ffmpeg Pipeline
│   │                        #   (Video via render() + Standbild via render_frame() — auch für Tour-Map)
│   └── timeline.py          # Camera-Keyframe-Interpolation (v0.7.0)
├── modules/                 # Self-contained Module (UI + zukünftig Backend)
│   ├── animator/
│   │   ├── manifest.json    # {slug, name, icon, description, sort_order, status}
│   │   └── ui/
│   │       ├── module.css   # modul-eigene Styles
│   │       └── module.js    # registriert sich auf window.RZGPS_MODULES.animator
│   └── geotagger/
│       ├── manifest.json
│       └── ui/
│           ├── module.css   # Empty-State, Placeholder-Tiles
│           └── module.js
├── ui/                      # App-Frame (modul-übergreifend)
│   ├── index.html           # Top-Bar + Modul-Container + Modal-Overlay
│   ├── css/app.css          # Dark Theme, Top-Bar, alle Shared Components
│   ├── css/
│   │   ├── app.css         # Dark Theme, Top-Bar, alle Shared Components
│   │   └── timeline.css    # Camera-Keyframe-Timeline-Bar (v0.7.0)
│   └── js/
│       ├── app.js           # Modul-Routing aus window.RZGPS_MODULES
│       ├── util.js          # Format-Helfer, Toast, Modal, DnD, Settings
│       └── timeline.js      # mountTimelineBar() — Track-Event-Bar (v0.7.0)
├── tests/
│   ├── test_core.py             # 5 Unit-Smoke-Tests
│   ├── test_geotagger_e2e.py    # End-to-End mit Fixtures
│   ├── test_app_start.py        # Headless-Bridge-Test
│   ├── test_animator_render.py  # Mini-Render mit ffprobe-Check
│   ├── make_test_photos.py      # Fixture-Generator
│   └── fixtures/photos/         # 6 Test-JPGs + _meta.json
├── scripts/
│   └── backup.sh            # ZIP-Snapshot in _backups/ (20er-Retention)
├── docs/
│   ├── DEVELOPER.md         # diese Datei
│   └── USER_GUIDE.md        # Endnutzer-Doku
├── CHANGELOG.md             # Versions-Historie
├── README.md                # Top-Level Übersicht
├── requirements.txt         # Python-Deps
├── run.sh                   # Dev-Start
├── build.sh                 # PyInstaller-Build + Install
├── ReisezoomGPSStudio.spec  # PyInstaller-Konfig
├── .venv/                   # Python-venv (in .gitignore)
├── _renders/                # Animator-Output (Dev-Modus)
├── _backups_photos/         # Geotagger-Backups (Dev-Modus)
└── dist/                    # PyInstaller-Output (Dev-Modus)
```

**Zur Laufzeit (App-Bundle):**
- Source-Tree wird in `Resources/` gebündelt; `sys._MEIPASS` zeigt darauf
- Schreibbare Pfade werden umgeleitet auf `~/Library/Application Support/Reisezoom GPS Studio/`
  - `_renders/` — Animator-Output
  - `_backups_photos/` — ZIP-Snapshots vor EXIF-Write

**Render-Engine (Chromium) — gebündelt seit v0.9.229** (Windows-Bug-Report Peter
Straka). Animator/Tour-Map/Höhen-Render brauchen Playwright-Chromium. Statt
Download-on-first-render ist `chromium-headless-shell` jetzt im Bundle:
- **Build:** `build.sh` (lokal) + `release.yml` (CI, mac/win/linux) füllen
  `pw-browsers/` via `PLAYWRIGHT_BROWSERS_PATH=<repo>/pw-browsers playwright
  install chromium-headless-shell`. Die `.spec` walkt `pw-browsers/` in `datas`
  (wie exiftool). `.gitignore` schließt `pw-browsers/` aus (groß, Build-Artefakt).
- **Runtime:** `app.py` `_resolve_pw_browsers_path()` setzt `PLAYWRIGHT_BROWSERS_PATH`
  auf `sys._MEIPASS/pw-browsers` wenn vorhanden (sonst User-Cache-Fallback), und
  chmod't den `chrome-headless-shell` (+x, mac/linux — PyInstaller-`datas` bewahrt
  das Exec-Bit nicht garantiert). Beim Start loggt app.py den gewählten Pfad
  (`Playwright-Browser: … (gebündelt=True/False)`).
- **Linux:** kein Bundling — Download-Fallback (Marc-Regel „Linux = Doku").
- **Shared Render-Engine-Guard:** `ui/js/util.js` `showRenderEngineMissingModal`
  — EIN Download-Modal für alle 3 Render-Einstiege (Animator/Tour-Map/Höhe),
  ausgelöst über `error_code === "playwright_browser_missing"`. Greift nur noch
  als Sicherheitsnetz (korruptes/fehlendes Bundle).

### Editionen — Solo-Geotagger aus EINER Codebasis (seit v0.9.331)

Dieselbe Codebasis liefert zwei Desktop-Apps; **kein Code-Klon**, nur ein Schalter.

- **Erkennung** (`app.py` `_detect_edition()`): Priorität `RZ_EDITION`-Env > gebündelte
  `edition.txt` (`sys._MEIPASS/edition.txt`) > Default `"full"`. → `APP_EDITION`
  (`"full" | "geotagger"`) + `APP_NAME`. `get_app_info()` liefert `edition`+`name`,
  `main()` setzt den Fenstertitel daraus.
- **Frontend-Gating** (`ui/js/app.js`): Boot liest `get_app_info().edition` →
  `window.RZ_EDITION`. `getModules()` filtert via `editionModuleAllowed(slug)` —
  in `"geotagger"` bleibt NUR der Geotagger-Tab. ALLE `module.js` werden weiter
  geladen (index.html unverändert), gefiltert wird nur die Anzeige. Solo setzt
  zusätzlich `body.edition-geotagger`, Brand-Sub „Geotagger" und **überspringt den
  Mapbox-First-Run** (still `onboarding_done`+`force_osm=true` → OSM-Karte ohne
  Token/Kreditkarte; genau die Nutzer-Beschwerde).
- **Schlankes Bundle** (`ReisezoomGPSStudio.spec`, eine Spec, `_IS_GEO`-Zweige):
  Solo lässt **Chromium (`pw-browsers/`) + ffmpeg (`imageio_ffmpeg`) + playwright**
  weg (lazy-Imports in den Render-Funktionen, die der Tagger nie aufruft → in
  `excludes`), bäckt `edition.txt`, setzt eigenen Namen/BundleID/Icon
  (`Reisezoom Geotagger.app` / `com.reisezoom.geotagger`). **Ergebnis: ~68 MB
  statt ~440 MB.** Default (kein Env) = `full` → CI/`release.yml` unverändert.
- **Build:** `scripts/build_geotagger.sh` (setzt `RZ_EDITION=geotagger`, ohne
  Chromium-Setup, installiert die Solo-App parallel zur Vollversion).
- **Test:** `tests/test_edition_gating.py` (headless, beide Editionen — nur-1-Tab,
  OSM, kein Mapbox-Nag, Body-Flag).
- **Spiegelungs-Hinweis:** Studio bleibt komplett unberührt; alle Gates sind additiv.

### Web-Geotagger (`web-tagger/`) — JPEG-only, 100 % client-seitig (seit v0.9.331)

Statische Browser-App (kein Server, kein Upload, kein Mapbox). Eigene, schlanke
JS-Implementierung der Match-Logik (DRY zur Desktop-Semantik, aber separater Code,
weil der Browser kein ExifTool/Python hat).
- `index.html` lädt per CDN **exifr** (EXIF lesen), **piexifjs** (GPS in JPEG
  schreiben), **MapLibre GL** (OSM-Karte). `app.js` = State + Logik, `style.css`.
- Ablauf: GPX parsen (`parseGpx`) → Fotos lesen (`readPhoto` via exifr) → Zeit-Match
  (`nearestByTime`, binäre Suche; Kamera-Zeitzone + Fein-Offset wie Desktop) →
  Pins auf Karte → `writeGpsIntoJpeg()` (piexif DMS-Rationals) → Download
  `<name>_geotagged.jpg`. `window.__rzTagger` exponiert Helfer für Tests.
- **Grenzen (bewusst):** nur GPX als Track, nur JPEG schreiben (HEIC/RAW/Video =
  ExifTool → Desktop). Kein In-place (Browser) → Download-Kopie.
- **Test:** `tests/test_web_tagger.py` (echtes JPEG+GPX → Match → GPS geschrieben +
  zurückgelesen, headless).
- **Deploy:** statisch hostbar (z. B. `gps-studio.reisezoom.com/tagger`).

---

## 3 · Core-Module im Detail

### `core/imports.py` (seit v0.9.282) — universelle Track-Import-Schicht

**Zweck:** Fremde Track-Formate (FIT, NMEA, KML/KMZ, TCX, GeoJSON) werden beim Öffnen transparent nach GPX konvertiert. Damit arbeitet die **gesamte App weiter ausschließlich mit GPX** — kein Downstream-Code (Animator/Tour-Map/Geotagger/Höhen) muss Formate kennen.

**Öffentliche API:**
| Funktion | Zweck |
|---|---|
| `is_convertible(path)` | True wenn Endung in `IMPORT_EXTS` |
| `parse_points(path)` | dispatcht per Endung → `list[(lat, lon, ele|None, time_iso|None)]` |
| `write_gpx(points, out, name)` | schreibt GPX via gpxpy (lat/lon/ele/time) |
| `convert_to_gpx(src, out, name)` | `parse_points` + `write_gpx` |
| `ensure_gpx(path, cache_dir)` | `.gpx` → unverändert; sonst konvertieren + cachen, GPX-Pfad zurück |

**Pattern „ein Format = ein Parser":** `_DISPATCH` mappt Endung → Parser-Key, jeder `_parse_*` gibt die einheitliche Point-Liste zurück. Neues Format = `_parse_x` + Eintrag in `_DISPATCH`. `.txt`/`.json` sind mehrdeutig → Content-Sniffing (`_looks_like_nmea`/`_looks_like_geojson`).

**Caching:** `ensure_gpx` legt Konvertate in `APP_SUPPORT/_imports/<stem>-<sha1[:12]>.gpx` (Schlüssel = abspath+mtime+size). Re-Öffnen derselben Datei = Cache-Hit.

**Integration (app.py):** Bridge-Helper `Api._ensure_gpx(path)` ruft `cimports.ensure_gpx(path, IMPORTS_DIR)`. Eingehängt am **Anfang** von `animator_load_gpx`, `geotagger_load_gpx`, `heightanim_load_gpx` (Tour-Map delegiert an Animator). `animator_load_gpx` gibt zusätzlich `gpx_path` (aufgelöste GPX) zurück, damit Multi-Track-Render echte GPX nutzt. Fehler → `TrackImportError` → saubere UI-Meldung. Export: `Api.export_current_gpx()` (Menü „Als GPX exportieren…").

**FIT** braucht `fitdecode` (MIT, lazy import → in `.spec` hiddenimports). Semicircles → Grad: `deg = raw * 180/2³¹`. Die übrigen Parser nutzen Bordmittel (`xml.etree`, `json`, `zipfile`).

**Höhen-Animator — Info-Leiste + Steigung + Wegpunkte (v0.9.394):** `core/heightanim.py` `_make_html` rendert eine sachliche Kopf-Leiste (Distanz/↑↓/Ø-/Max-Steigung/Höhe), Steigung am Marker-Callout und beschriftete Wegpunkt-Pins. Die Stat-/Steigungs-Berechnung (`rzHeaderStats`, `rzWindowGrad`, `rzGradAtDist`) läuft **im eingebetteten JS über den Trim-Bereich** und ist **1:1 in `modules/heightanim/ui/module.js` gespiegelt** (Präfix `_rz…`, Kommentar „SYNCHRON zu core/heightanim.py" — bei Änderung beide pflegen). `HeightConfig` bekam `show_stats_header`, `stats_fields`, `stats_labels` (lokalisiert aus der UI, sonst DE-Fallback in `RZ_FIELD_LABELS_DE`), `show_gradient`, `waypoints` (bereits auf `dist_m`+`ele` aufgelöst). Wegpunkt-Quellen: **manuell** (`project.heightanim.waypoints`, `dist_frac`) und **Fotos** baut das Frontend aus dem Projekt-State (`buildWaypoints()`, Foto-Anker via `latlon` aus `heightanim_load_gpx`); **GPX-`<wpt>`** (`gpx.parse_waypoints` → `heightanim.project_points_onto_track`) und **Auto-Marker** (`heightanim.detect_auto_markers`: Peak/Valley/steilster An-/Abstieg) liefert die Bridge. Reveal-Logik: ein Wegpunkt erscheint, sobald `dCurrent >= wp.dist_m` (oder `progress>=1`). **v0.9.395:** zusätzlich `grid_color`/`label_color` in `HeightConfig` (Gitter- + Beschriftungsfarbe; Beschriftungsfarbe färbt Achsen/Header/Callout, im Backend über `GRID_COLOR`/`LBL_COLOR`, im Frontend über `#height-grid-color`/`#height-label-color`). **Undo:** der Höhen-Panel-Controller nutzt jetzt `extraSnapshot`/`extraApply` (`_haUndoCaptureState`/`_haUndoRestoreState`) für den JS-State (Info-Leiste, Wegpunkte, Quellen); reine JS-Aktionen (Punkt setzen/löschen/umbenennen/ausblenden, Feld-Checkbox ohne id, Wegpunkt-Farbe) pushen manuell via `_haPushUndo(label)` **vor** der Mutation. Dazu ein geteilter Bugfix in `ui/js/util.js` `rzMakePanelUndoController`: der `input`-Listener überspringt jetzt `checkbox`/`radio` (die committen nur über `change`) — vorher pushte eine Checkbox zwei Undo-Punkte (input + change) → erstes ⌘Z war ein No-Op. Betrifft alle Module positiv. **v0.9.396:** Marker vollständig konfigurierbar — `HeightConfig` +`marker_dot_color/dot_size/bg/bg_opacity/border_color/border_width/font_size/show_icon/show_ele/show_dist`; `_make_html` baut den Punkt (Glow=`MK_BORDER`, Füllung=`MK_DOT_COLOR`, r=`MK_DOT_SIZE`) und den Callout dynamisch aus Zeilen (Zeile 1 = Icon+Höhe, Zeile 2 = Steigung+Distanz; leere Box wird weggelassen; Box-BG via `_rzRgba(hex,opacity)`). Frontend spiegelt in `#height-marker-*`-Controls (eigene „Marker"-Sektion); `show_gradient`/`#height-gradient` von der Info-Leiste dorthin verschoben. Alle Marker-Controls haben `id` → automatisch vom Panel-Undo erfasst. **v0.9.397 — HTML-Export (Web/Blog):** `heightanim.make_standalone_html(cfg, dists, elevs)` nimmt die fertige Render-HTML (`_make_html`, exposes `window.advanceFrame`) und transformiert sie zu einer selbst-laufenden Seite: responsive (`preserveAspectRatio="xMidYMid meet"`, `#svg{width/height:100%}`), rAF-Loop treibt `advanceFrame(progress)` (Dauer/Hold aus `cfg`), dezenter `#rz-replay`-Button. `make_embed_snippet(html, cfg)` wickelt die komplette Seite in ein `<iframe srcdoc="…">` (via `html.escape(..., quote=True)`) → pastebar in einen WordPress-„Custom HTML"-Block, isoliert vom Theme, kein Upload. Bridge `Api.heightanim_export_html(params)` (kein Playwright — reiner String-Export) schreibt `.html` + `_iframe-snippet.txt` nach `RENDERS_DIR`, gibt `{output, snippet, snippet_path, bytes}` zurück. Die HeightConfig-Feldzuordnung aus den UI-Params liegt jetzt im geteilten `app._height_visual_cfg_kwargs(params)` (Video-Render UND HTML-Export nutzen ihn → kein Drift). Frontend: Button `#height-export-html`; `collectHeightParams()` sammelt die Params für beide Wege. **v0.9.399:** Export-Ergebnis erscheint als **zentriertes Modal** (`showHtmlExportModal` via `openModal`) statt Sidebar-Panel, mit **„Im Browser öffnen"** (Bridge `Api.heightanim_open_in_browser(path)` → `webbrowser.open(Path.as_uri())`, weil `open_url` nur http/https/mailto erlaubt und ein Finder-Doppelklick `.html` je nach LaunchServices in einem Editor öffnet), Snippet-Kopieren + Im-Finder-zeigen. **Control-Persistenz:** `_readHeightControls()` snapshottet alle `#height-panel`-Inputs, `restoreHeightControls()` spielt sie beim Mount SYNCHRON zurück (kein Event-Dispatch → keine Undo-/Draw-Nebenwirkung; `_refreshHeightSliderLabels()` setzt die Slider-Labels), Panel-`change`-Listener persistiert. **⚠️ Wichtig:** `sessions.update_project_settings` mit `module=None` macht **Shallow-Replace** von Projekt-Root-Keys (`p[k]=v`) → `heightanim` wird komplett ersetzt; `persistHeightWaypoints()` schreibt deshalb IMMER das vollständige `heightanim`-Objekt (trim + waypoint-state + controls), `persistTrim()` delegiert dahin. (Vorher überschrieben sich Trim-/Wegpunkt-Saves gegenseitig.) **v0.9.400 — Glättung:** `HeightConfig.smoothing: int = 0`; `_make_html` embeddet `const SMOOTHING` + `function _rzSmooth(arr, r)` (zentrierter gleitender Mittelwert, Radius r Punkte je Seite, null-tolerant, längenerhaltend) und leitet den **Master**-`elevs` durch `_rzSmooth(DATA.elevations, SMOOTHING)` — dadurch nutzen Linie, Fläche, Header-Stats, Steigung und Wegpunkt-Höhen automatisch die geglätteten Werte (WYSIWYG, gilt auch für `make_standalone_html`). Frontend spiegelt `_rzSmooth`/`_smoothingVal()` in `modules/heightanim/ui/module.js` (Slider `#height-smoothing`, 0–20, in der Optik-Sektion; in Redraw-Liste + `_refreshHeightSliderLabels`); `drawElevationSvg` und `buildWaypoints()` smoothen ihre `elevs` gleich. Plumbing: `collectHeightParams()` → `smoothing`, `app._height_visual_cfg_kwargs()` → `smoothing=int(params.get("smoothing", 0))`. Persistenz automatisch via `_readHeightControls()` (id-basiert). **v0.9.401 — Restore-Timing-Fix (Marc „merkt sich die Farben nicht"):** die v0.9.399-Control-Persistenz SPEICHERTE korrekt (Disk-`heightanim.controls` belegt), aber `restoreHeightControls()` lief nur EINMAL beim Modul-Mount — und beim Kaltstart mountet das Modul im DOMContentLoaded-Handler (`app.js` `renderMod()`) BEVOR die Session async geladen ist (`loadGlobalGpx` im nachgelagerten `setTimeout`), d.h. `getActiveProject()` ist beim Mount noch `null` → nichts wird angewandt, danach kein zweiter Versuch. Fix: der komplette Projekt-State-Load (Trim + Info-Leiste + Wegpunkte + `restoreHeightControls`) ist jetzt in **`reloadProjectStateFromActive({refreshUi})`** gebündelt (hoisted, idempotent, KEINE Persist-/Undo-Events) und wird ein zweites Mal in `applyGlobalGpxToHeightModule()` bei `res.ok` mit `refreshUi:true` aufgerufen — dort ist das Projekt garantiert da, weil `gpx-bar.js` `loadGlobalGpx` erst `await sessionActivate()` (setzt `_activeProject`) und DANN `notifyGpxLoaded()` feuert. `refreshUi:true` rendert Info-Felder/Wegpunkt-Liste/Trim-Balken neu; die fixen Checkboxen + Slider haben ids → werden von `restoreHeightControls` gesetzt. **v0.9.402 — Fläche + Höhen-Farbzonen:** `HeightConfig` +`area_fill/area_color/area_opacity(0..100)/area_mode("smooth"|"bands")/fill_stops[{ele,color}]`. Die Fläche unter der Linie ist jetzt konfigurierbar; bei ≥1 Farbzone baut sowohl `_make_html` als auch `drawElevationSvg` einen vertikalen `<linearGradient gradientUnits="userSpaceOnUse" y1=py(eHi) y2=py(eLo)>`, dessen Stops die geteilte Funktion **`_rzFillStops(baseColor, stops, eHi, eSpan, bands)`** liefert (SYNCHRON Backend↔Frontend): Offset je Zone = `clamp((eHi-ele)/eSpan,0,1)`, `area_color` als Basis unten (offset 1); `bands=true` verdoppelt die Stops an jeder Zonengrenze → harte Kanten, sonst weicher Verlauf. Ohne Zonen: flache `area_color`-Füllung. Die Fläche folgt der Höhe unabhängig vom X-Fortschritt (vertikaler Verlauf), funktioniert also mit der partiellen Reveal-Fläche. Frontend: eigene Sektion „Fläche" (`#height-area-fill/-color/-op/-mode`) + dynamischer Farbzonen-Editor `renderFillStops()` (Liste `_fillStops=[{id,ele,color}]`, wie `_manualWps`: add/delete/edit mit `_haPushUndo`, persistiert in `heightanim.fill_stops`, im Undo-Snapshot `fillStops`, in `reloadProjectStateFromActive` geladen). Plumbing via `collectHeightParams()` (`area_*`+`fill_stops`) → `app._height_visual_cfg_kwargs()`. **v0.9.403 — Zonen generisch für 3 Ziele + Generator:** die Farbzonen-Logik ist auf **Fläche / Hintergrund / Linie** verallgemeinert. Frontend: drei Listen `_fillStops/_bgStops/_lineStops` (gemeinsamer `_zoneSeq`), Deskriptor `_zoneCfg(key)` (liefert get/set/listId/modeId/stepsId/gradId/base), generische `renderZoneStops(key)`/`addZoneStop(key)`/`genZoneStops(key)` + `renderAllZones()`. `genZoneStops` teilt `[min,max]` der aktuellen `_currentData.elevations` in N gleiche Bänder (Input `#height-{area,bg,line}-steps`, 2–12) und färbt sie mit `_rzRampColor` (Terrain-Palette `_RZ_TERRAIN` via `_rzLerpHex`) — danach frei editierbar. In `drawElevationSvg` baut der lokale Helfer `_zoneGradUrl(gradId, stops, baseColor, bands)` einen vertikalen userSpaceOnUse-`<linearGradient>` (defs `class="rz-zone-defs"` als erstes svg-Kind) via `_rzFillStops`; angewandt auf Fläche (`areaColor`), Hintergrund (Overlay-Rect nach py-Berechnung, baseColor=`bg`) und Linien-Stroke (baseColor=`lc`). Backend spiegelt mit top-level `_rzZoneGrad(id, stops, baseColor, bands)` (nutzt module-level `eHi/eLo/eSpan/py/PAD_L`), angewandt auf Background-Rect (`BG_STOPS/BG_BANDS`), Fill (`FILL_STOPS`) und Linien-Stroke (`LINE_STOPS/LINE_BANDS`). `HeightConfig` +`bg_mode/bg_stops/line_mode/line_stops`; Persistenz `heightanim.{fill,bg,line}_stops`, Undo-Snapshot `{fill,bg,line}Stops`, Modes über `controls` (ids). Modes `#height-{bg,line}-mode` in der Redraw-Liste. **v0.9.404 — Hintergrund-Zonen optional nur im Diagramm:** Checkbox `#height-bg-clip` (`HeightConfig.bg_clip`, param `bg_clip`). Frontend zeichnet den flachen bg-Rect immer voll (W×H) und legt den Zonen-Verlauf als zweites Rect darüber — bei `bg_clip` mit den Plot-Maßen (`padL/padT/plotW/plotH`) statt Vollbild. Backend (`_make_html`) hat nur EIN bg-Rect, daher bei `BG_CLIP && _bgUrl` zwei Rects: flache Basis (W×H) + Verlauf im Plot (`PAD_L/PAD_T/PLOT_W/PLOT_H`); sonst wie bisher ein Vollbild-Rect. Der Verlaufs-Gradient ist ohnehin auf `py(eHi)..py(eLo)` (= Plot-Oberkante..Unterkante) verankert, deckt sich also exakt mit dem Plot-Rechteck. Checkbox in Redraw-Liste; persistiert automatisch (id → controls). **v0.9.405 — Punkt/Info-Box entkoppelt:** `SHOW_MARKER` (Checkbox `#height-marker`, jetzt Label „Info-Box zeigen") gatet NUR noch die Callout-/Info-Box; der laufende Punkt+Glow hat einen eigenen Schalter `MK_SHOW_DOT` (`HeightConfig.marker_show_dot`, Checkbox `#height-marker-dot` „Punkt zeigen", default true). Frontend: Punkt-Block `if (showDot && _progress>0)`, Callout-Block bleibt `showMarker`. Backend gespiegelt: Punkt-Block `if (MK_SHOW_DOT && progress>0)`, Callout `SHOW_MARKER`. `collectHeightParams` +`marker_show_dot`; Redraw-Liste +`height-marker-dot`; Punktfarbe/-größe (`#height-marker-dot-*`) gehören weiter zum Punkt.

**Frontend:** `window.TRACK_PICK_FILTER` (Datei-Dialog) + `window.TRACK_DROP_RE` (Drag&Drop-Regex) in `ui/js/gpx-bar.js`; Geotagger-/Animator-Drops nutzen dieselben. Drop-Persist auf `"binary"` (FIT/KMZ sind binär).

### `core/sensors.py` + Sensor-Datenschicht (seit v0.9.330 — IDEAS §15.2 Phase 1)

Zusatz-Messwerte pro Trackpunkt (FIT-HR/Power/Temp/E-Bike, GPX-Extensions). **Variante B**: kein GPX-Dialekt, sondern angereichertes internes Modell + Sidecar.
- **Modell:** `gpx.TrackPoint.extra: dict[str,float]` (Sensorwerte je Punkt), `gpx.TrackStats.sensor_fields` (`[{key,label,unit}]`). Geometrie/abgeleitet (Distanz/Tempo/Steigung) gehört NICHT in `extra`.
- **Registry `core/sensors.py`:** `FIELD_META` (Key→Label/Einheit, Fallback für Unbekanntes), `FIT_FIELD_MAP`/`FIT_SKIP` (FIT-record-Name→Key), `GPX_EXPORT`/`GPXTPX_READ` (Standard-Extensions), `describe_fields(keys)`.
- **Import (alles lesen):** `imports._parse_fit`/`_parse_tcx` liefern 5-Tupel `(lat,lon,ele,time,extra)`; `_split_rows()` trennt Geometrie/extra. `imports.ensure_gpx` schreibt beim Konvertieren **Geometrie-GPX + `<cache>.sensors.json`** (index-gleiche Reihen, ALLE Felder). `gpx.parse_gpx` liest gpxtpx/gpxpx-Extensions inline (Strava/Garmin-GPX) UND den Reisezoom-Logger-Namespace `rz:` (Android-App, `sensors.RZ_READ`: hdg→heading, pitch, lux, mag, hacc/vacc, batt→battery_soc, temp→temperature … namespace-agnostisch über lokalen Tag-Namen) UND mergt die Sidecar (`_load_sidecar_into`).
- **Export (alles, wofür GPX Felder hat):** `trackio.to_gpx_string` schreibt gpxtpx (hr/cad/atemp) + `<power>`; Nicht-Standard-Felder kann GPX nicht tragen → bleiben in der Sidecar.
- **Downsampling:** `extra` reist mit den TrackPoint-Objekten automatisch mit (wie `ele`).
- **Gotcha:** alte Cache-GPX (vor v0.9.330) haben keine Sidecar → Sensoren erst nach Cache-Invalidierung (Quelldatei re-touch / Cache leeren). Defekte/fehlende Sidecar kippt den Track-Load NIE (still no-op).
- **Tests:** `tests/test_fit_sensors.py` (FIT-Mapping, Export→Import-Roundtrip, Sidecar-Merge, Metadaten/Fallback) + Voll-Template-Smoke (`_make_html`/`_make_html_alpha` mit aktivem `sensor:<key>`).

**Phase 2a — Sensoren als Live-Overlay (seit v0.9.330):** Sensorfelder reihen sich als zusätzliche **Live-Felder** mit der ID `sensor:<key>` in den bestehenden Stats-Editor ein (nur Live-Box; Totals/Tour-Map bleiben unberührt, da zeit-animiert).
- **Bridge `app.animator_load_gpx`:** `series.sensors = {key: [wert_pro_ds_punkt]}` (index-gleich zu `coords`/`cumDistM`) + Top-Level `sensor_fields` (`[{key,label,unit}]`).
- **Render `core/animator.py`:** `_sensor_dom_id(key)`, `_overlay_sensor_series_json(ds_points, field_ids)`. `_overlay_live_rows`/`_overlay_live_update_js` erkennen `sensor:`-IDs (Label aus `sensors.field_meta`, Wert = `sensorSeries[key][idx]`, gerundet + Einheit, en-dash bei null). Beide Templates (`_make_html` + `_make_html_alpha`) berechnen `sensor_series_json` neben `speed_json` und injizieren `const sensorSeries = …` neben `gradePct`.
- **Frontend `modules/animator/ui/module.js`:** `_ovSensorFields` (aus `res.sensor_fields`), dynamischer Katalog `_ovCat("live") = static + sensor:<key>`, `_ovFieldLabel`/`_ovSensorUnit`/`_ovFieldValue`/`_ovUpdateLiveAt` behandeln `sensor:`-IDs. `_ovGetFields("live")` schickt sie als `overlay_live_fields` an den Render. Bei GPX-Wechsel/Reset wird `_ovSensorFields` mitgeleert.
- **Spiegelung:** Tour-Map (`modules/tourmap`) bekommt KEINE Sensor-Felder — Sensorwerte sind zeit-animiert (Live-Box), die Tour-Map ist ein Standbild. Analog zur bestehenden Live-Box-Ausnahme der Spiegelungs-Regel.
- **OFFEN:** Phase 2b (Diagramme/Aggregate pro Feld — Ø/Max-HF als Totals, HF-Zonen-Track-Färbung, Gauges), Phase 3 (Auto-Schilder §15.3).

### `core/gpx.py`

**Hauptfunktionen:**
| Funktion | Zweck |
|----------|-------|
| `parse_gpx(path) -> (List[TrackPoint], TrackStats)` | Liest GPX, kumuliert Distanz/Zeit/Auf-/Abstieg |
| `downsample(pts, target) -> List[TrackPoint]` | Gleichverteiltes Subsampling, behält Start/Ende |
| `to_json(pts, stats) -> dict` | Serializer fürs UI |

**Wichtige Details:**
- Alle Zeiten werden auf **UTC normalisiert** (Punkte ohne tz erhalten `timezone.utc`)
- `TrackPoint.dist_m` und `elapsed_s` sind **kumuliert** ab Track-Start
- Auf-/Abstieg mit 1-m-Schwellwert (Rausch-Filter, sonst zu hohe Werte bei verrauschten Höhendaten)
- Haversine-Formel für Distanz (R = 6371000 m)
- Bei GPX **ohne Zeit-Tags** wird `elapsed_s` aus dem vorherigen Wert übernommen (i.d.R. 0)

### App-Icon
- Source-Image: `assets/icon_1024.png` (von `scripts/make_icon.py` generiert)
- macOS-Format: `assets/icon.icns` (per `iconutil` aus 10-stufigem `.iconset`)
- PyInstaller-Spec: `app = BUNDLE(coll, name=..., icon="assets/icon.icns", ...)`
- Neu generieren: `python scripts/make_icon.py`
- Design: Squircle mit Gradient, Pin in `#ff6b35`, Track-Linie mit Glow

### Lokalisierung (i18n)
- **Sprachfiles**: `i18n/<code>.json`, flach key→value
  - `_meta.label_en` / `_meta.label_native` für Settings-Dropdown
  - Verfügbare Sprachen werden zur Laufzeit aus Verzeichnis gelesen
- **Backend** (`core/i18n.py`):
  - `set_i18n_dir(path)` — wird beim App-Start aufgerufen (PyInstaller-aware)
  - `detect_system_locale()` — macOS via `defaults`, Fallback `locale`, dann Default
  - `resolve(code)` — "auto" → System-Code
  - `get_strings(code)` — vollständig, gemergeded mit Default-Lang (en)
  - `available_locales()` — Liste der verfügbaren Sprachen
- **Bridge-API**:
  - `Api.i18n_get_strings()` → `{active, requested, strings, available}`
- **Frontend** (`ui/js/util.js`):
  - `await loadI18n()` beim App-Start
  - `t(key, params)` — Übersetzungs-Lookup mit `{name}`-Platzhaltern
  - `i18nMeta()` — Metadaten für UI (z.B. aktive Sprache anzeigen)
- **Settings**: `language` (`"auto" | "de" | "en" | "es"`)
- **Sprachwechsel zur Laufzeit**: Settings speichern → `loadI18n()` neu → `renderTabs()` + `renderMod()` neu rendern — kein Restart nötig
- **Module-Manifests** werden auch aus i18n überschrieben (`modules.<slug>.name`/`desc`)
- **Was übersetzt ist (v0.1.x)**: Modul-Tabs, Section-Titel, Buttons, Checkboxes,
  Tooltips, Empty-State, Drop-Hints, Banner, wichtigste Toasts, Modal-Titel
  (Confirm/Progress/Result werden aktuell noch teils auf Deutsch gerendert —
  Verfeinerung in nächster Iteration)

### Video-Geotagging (Phase 1)
**Was umgesetzt ist:**
- Endungen: `VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".qt", ".insv", ".insp", ".mts", ".m2ts", ".lrv", ".3gp", ".avi", ".mkv"}`
- Aufnahmezeit aus `MediaCreateDate` (Fallback `CreateDate`, `TrackCreateDate`) via exiftool-Daemon
- **Single-Position-GPS**: ein Punkt pro Video, geschrieben in 3 Tag-Familien parallel:
  - `Keys:GPSCoordinates` (ISO 6709 String — Apple-Standard, von Photos.app/iOS gelesen)
  - `UserData:GPSCoordinates` (Legacy QuickTime)
  - `GPSLatitude/LongitudeRef/Latitude/Longitude/Altitude/AltitudeRef` (klassisch, für Lightroom)
- Thumbnail via `ffmpeg -ss 1 -frames:v 1 -f image2pipe -vcodec mjpeg -` (640px breit, q=3)
- `_read_meta_fast()` in app.py routet auf `_exiftool_read_video_meta()` für Videos
- Frontend: Drop-Zone + Picker akzeptieren Video-Endungen, Tile bekommt `tile-video-badge` (▶)

**Phase 2 (nicht umgesetzt):** Frame-by-Frame GPS via GPMF-Stream (GoPro/Insta360). Würde ffmpeg-Custom-Encoding brauchen, ist für Standard-Apps (Photos.app etc.) eh nicht nötig.

### Zeitzonen-Handling beim Geotagging

EXIF `DateTimeOriginal` ist immer **lokale Aufnahmezeit ohne Zeitzonen-Info**.
Seit EXIF 2.31 (~2016) gibt es zusätzlich `OffsetTimeOriginal` (z.B. `+02:00`).
GPX-Tracks sind im Standard **UTC** (`<time>` mit Z-Suffix).

**Workflow im Reader (`_exiftool_read_meta` / `_piexif_read_datetime`):**
1. Naive Lokalzeit lesen
2. `OffsetTimeOriginal` lesen (Fallback: `OffsetTime`, `OffsetTimeDigitized`)
3. Wenn vorhanden: `dt_utc = dt_local - tz_offset` → naive UTC zurückgeben
4. Wenn nicht vorhanden: naive Lokalzeit zurückgeben (Match-Logik braucht dann
   einen User-Offset)

Die Match-Logik (`geotag.match_photos`) klebt `tzinfo=utc` an die naive datetime,
also funktioniert beides — TZ-known liefert direkt korrekte UTC, TZ-unknown
braucht den User-Offset.

**Manuelle Kamera-Zeitzone (v0.9.177):** Im „Genauen Offset"-Dialog (✎) gibt es
zusätzlich ein **Zeitzonen-Dropdown** (`#md-offset-tz`, TZ_OPTIONS −12..+14 inkl.
+5:30/+5:45 etc.), gespeichert in `geotagger.tz_offset_minutes`. Für Kameras OHNE
`OffsetTimeOriginal` (viele Olympus/OM, GoPro) lässt sich so die Kamera-Zeitzone
nachreichen (z.B. Vietnam UTC+7). **Wichtig — keine Doppelkorrektur:** pro Foto
wird `tz_known` mitgeführt (`cexif.read_datetime_with_tz()` / `_piexif_dt_and_tz()`
für JPEG/TIFF, `_exiftool_read_meta`-`tz_minutes` für RAW/Video). `match_photos(...,
tz_offset_seconds, tz_known_paths)` zieht die manuelle TZ **nur** bei Fotos OHNE
eingebetteten Offset ab → gemischte Batches (Handy mit TZ + Olympus ohne) bleiben
korrekt. TZ wirkt NUR aufs Matching, NICHT auf die geschriebene `DateTimeOriginal`.
Frontend: `tzOffsetMin`/`getTzOffsetMinutes()` → `geotagger_match(offset, gap, tzMin)`.
(Damit ist der frühere „Phase-2-TODO Zonen-Wechsel" für den Standard-Reisefall erledigt.)

**Import ergänzt statt ersetzt (v0.9.176):** `geotagger_register_photos` hängt neue
Pfade an `_gtg_photos` AN (dedupe by path) und gibt die VOLLE Liste zurück; Frontend
`_gtMergeRegistered()` erhält bestehende Objekte/Thumbs. Gilt für Drop/Pick/Ordner
(alle über dieselbe Bridge). RAW-ohne-exiftool-Warnung auch beim Drop. CI-Release
(`release.yml`) bündelt exiftool jetzt auch (mac: `setup_vendor_exiftool.sh`, win:
pwsh Expand-Archive) — vorher war exiftool NUR im lokalen Build, nicht im DMG.

### `core/exif.py`

**Drei Backends, automatisches Routing (seit v0.9.57):**
- **piexif** für JPEG (`.jpg/.jpeg/.jpe`) — schnell, in-process, kein Subprocess.
  **Lesen** auch für TIFF (`piexif.load()` kann TIFF).
- **pillow-heif** für HEIC/HEIF — in-process via Pillow-Plugin (bundlet libheif),
  liefert Thumbnails + EXIF-Bytes die piexif parst. Heißt: HEIC funktioniert OHNE
  exiftool — wichtig für User die keinen Homebrew/Standalone-ExifTool installiert
  haben. Routing-Helper `is_heif(path)`, neue Funktionen `_heif_read_datetime()`,
  `_heif_read_gps()`, `extract_heif_thumbnail()`.
- **exiftool** für RAW (CR3/CR2/NEF/ARW/RAF/RW2/ORF/DNG/PEF/RWL/SRW), für
  **TIFF-Schreiben** (siehe unten) und als Fallback wenn pillow-heif fehlt oder
  HEIC-GPS geschrieben werden soll (pillow-heif kann nicht in HEIC schreiben).

**⚠️ TIFF — getrenntes Lese-/Schreib-Routing (v0.9.154):** `.tif`/`.tiff` waren
bis v0.9.153 in `JPEG_LIKE_EXTS` und liefen beim Schreiben über `piexif.insert()`.
Das wirft bei TIFF aber **`InvalidImageDataError`** — `piexif.insert()` kann nur
echtes JPEG (SOI-Marker `\xff\xd8`). Im Real-Test scheiterten 11/11 Olympus-TIFFs.
Fix: eigene `TIFF_EXTS` + `is_tiff(path)`. **Lesen** (`read_datetime`/`read_gps`)
bleibt bei piexif (`is_jpeg_like(p) or is_tiff(p)` → `_piexif_read_*`, da
`piexif.load()` TIFF kann). **Schreiben** (`write_gps`, `shift_datetime`) geht für
TIFF über exiftool (wie RAW). Braucht also exiftool im Bundle (macOS/Win da, Linux
per Doku).

| Funktion | Zweck |
|----------|-------|
| `is_jpeg_like(path)` / `is_tiff(path)` / `is_raw(path)` / `is_photo(path)` | Format-Detection nach Endung |
| `find_exiftool() -> Optional[str]` | PATH + Homebrew-Pfad-Fallback. None wenn fehlt |
| `read_datetime(path) -> Optional[datetime]` | Routet auf piexif oder exiftool. Gibt **naive** datetime (Kamera-Lokalzeit) |
| `read_gps(path) -> Optional[(lat, lon, alt)]` | Routet ebenfalls |
| `write_gps(path, lat, lon, alt=None, ts_utc=None, img_direction=None)` | Schreibt **in-place** mit `-overwrite_original` (kein `_original`-Sidecar); `img_direction` (Grad, true north) → GPSImgDirection + GPSImgDirectionRef='T' |
| `extract_raw_preview(path) -> Optional[bytes]` | Liefert eingebettetes Preview-JPEG aus RAW (für Thumbnails). Versucht `PreviewImage` → `JpgFromRaw` → `ThumbnailImage` |
| `ExifToolMissingError` | Exception wenn RAW-Operation ohne exiftool |

**ExifTool-Daemon: ZWEI Instanzen (v0.9.151):**
- `_ExifToolDaemon` ist kein klassisches Singleton mehr, sondern hält **pro
  Rolle** einen Prozess: `get("read")` und `get("write")`. Jede Instanz hat
  einen **eigenen `subprocess` (`-stay_open True`) UND einen eigenen `Lock`**.
- `_ensure_daemon()` → **Read**-Daemon (Thumbnails/Meta-Reads, Vorschau-Worker).
  `_ensure_write_daemon()` → **Write**-Daemon (alle GPS-Schreibpfade:
  `_exiftool_write_gps`, `_exiftool_write_gps_video`, `shift_datetime`-RAW).
- **Warum:** vorher serialisierte EIN globaler Lock alle Reads UND Writes. Eine
  langsame/hängende Video-Vorschau (OM-`.mov`) hielt den Lock und hungerte den
  GPS-Write aus → „es werden keine GPS-Daten geschrieben". Mit getrennten
  Daemons kann eine blockierende Vorschau einen Write **nie mehr blockieren**
  (gemessen: 0,08 s statt 7,7 s hinter einem 8-s-Read-Lock). Plattform-
  unabhängig (macOS + Windows).
- `_ExifToolDaemon.shutdown()` schließt **beide** Prozesse (iteriert
  `_instances`), wird beim App-Close (`on_closing`) aufgerufen.

**Daemon-Lifecycle / kein Verwaisen (v0.9.190):**
- **Problem:** exiftool im `-stay_open`-Modus blieb bei App-Crash / Force-Quit /
  `os._exit` mit hängendem Worker als Zombie liegen und sammelte sich über
  Sessions an (08.06.: 6 Waisen seit 30.05., je ~435 MB virt.).
- **Eigene Process-Group:** Daemon startet mit `start_new_session=True` (POSIX)
  bzw. `CREATE_NEW_PROCESS_GROUP` (Windows). `_kill_proc_group(proc)` killt via
  `os.killpg(SIGKILL)` die ganze Gruppe (perl + evtl. Kindprozesse), nicht nur
  den direkten Child.
- **Reap-beim-Start** (`reap_orphan_daemons()`, POSIX): beim ersten
  `_ExifToolDaemon.get()` (Flag `_reaped`) werden via `pgrep -f "exiftool
  -stay_open"` + `ps -o command=` alle Prozesse gefunden, deren Cmdline UNSERE
  exiftool-Binary (`find_exiftool()`-Pfad) enthält, und per `SIGKILL` gekillt —
  **bevor** eigene Daemons starten. Das ist das eigentliche Sicherheitsnetz für
  den Crash-Fall, in dem kein In-Process-Handler (auch atexit nicht) läuft.
  Pfad-Match verhindert Fremd-Kills; Single-Instance-Annahme (zwei parallele
  App-Instanzen würden sich gegenseitig reapen — akzeptabel).
- **Gehärtetes `_close()`:** graceful `-stay_open False` + `stdin.close()` (EOF),
  2 s Wait (nicht 5 → Close-Handler hängt nicht), dann harter Group-Kill.
- **`atexit.register(_ExifToolDaemon.shutdown)`** fängt normale Interpreter-Exits
  (Ctrl+C im Dev, `sys.exit`, `webview.start()` kehrt zurück). Bei `os._exit()`
  + `SIGKILL` läuft atexit NICHT → dafür der explizite `shutdown()` im
  Close-Handler + Reap beim nächsten Start.
- **Session-Reset:** `geotagger_clear` (app.py) ruft `shutdown()` mit, damit beim
  Workspace-Leeren kein Daemon idle weiterläuft; Re-Spawn lazy beim nächsten
  Foto-Pick (~0,5 s).

**Wichtige Details:**
- **naive datetime** weil EXIF keine Zeitzone enthält → das ist die Kamera-Lokalzeit
- Sekunden-Genauigkeit beim Lesen, aber **0.0001 Grad** Schreib-Genauigkeit (deg/min/s mit 10000-Auflösung)
- `GPSDateStamp` + `GPSTimeStamp` werden in **UTC** geschrieben falls `timestamp_utc` übergeben
- **Gotcha bei exiftool**: `-n` (numerisch) hat Vorrang über `-d` (Date-Format) — wir lesen DateTime ohne `-n` und parsen das Standard-EXIF-Format `YYYY:MM:DD HH:MM:SS`
- **RAW-Schreibvorgang ändert die Datei minimal** (~0.5% Größenänderung bei CR3). Strukturell intakt, alle Bilddaten unangetastet — nur EXIF-IFDs erweitert
- Backup vor Write trotzdem Pflicht (große ZIPs! Plan: pro Foto 12-50 MB)

### `core/sun.py` (seit v0.9.333) — Lichtstempel + Blickrichtung

Reine Mathematik, keine Abhängigkeiten. **Eine Quelle der Wahrheit** fürs „Lichtstempel"-Gimmick — das Web-Tool (`gps-studio-web`) spiegelt dieselbe Logik in JS (SunCalc).
- `sun_position(dt_utc, lat, lon)` → (Höhe°, Azimut°), Azimut 0=N im Uhrzeigersinn (SunCalc-Port).
- `light_phase(alt_deg)` → `noon|day|golden|blue|dusk|night` (gleiche Schwellen wie Web).
- `bearing(lat1,lon1,lat2,lon2)` → Kompasskurs; `light_vs_dir(sun_az,cam_dir)` → `back|side|front`; `compass8_index(deg)`.
- **Verdrahtung:** `app.Api._enrich_geotag()` hängt an jeden in-range-Match `dir`/`dir_src` (EXIF-Kamerakurs via `cexif.read_img_direction()` bevorzugt, sonst Bewegungs-Bearing aus den Track-Nachbarn), `sun_alt`, `light_phase`, `light_vs_dir` an. `modules/geotagger/ui/module.js` rendert Chips (`gtChipsHtml`) + Richtungspfeil (`.pm-dir`) am Pin. i18n `geotagger.compass/.light.*/.dir.*/.lvd.*`.
- **EXIF-Richtung:** `cexif.read_img_direction()` liest `GPSImgDirection` nur aus JPEG/TIFF (piexif) — bewusst leichtgewichtig; RAW/HEIC/Video → None → Bewegungs-Fallback.
- **Test:** `tests/test_geotag_lichtstempel.py` (End-to-End über die echte `geotagger_match`-Bridge).

### `core/geotag.py`

**Hauptfunktionen:**
| Funktion | Zweck |
|----------|-------|
| `match_photos(photo_times, track, offset_s, max_gap_s)` | Für jedes Foto den zeitlich nächsten Trackpunkt finden |
| `derive_offset_from_reference(ref_photo_time, ref_lat, ref_lon, track)` | Aus Karten-Klick den Sekunden-Offset ableiten |

**Algorithmus `match_photos`:**
1. Track-Punkte ohne Zeit werden auf die letzte bekannte Zeit projiziert (falls nötig)
2. Sorted-Times-Liste wird mit `bisect_left` durchsucht (O(log n))
3. Vergleich: `photo_time_naive + offset` → ergibt **vergleichbare UTC-Zeit**
4. `in_range`: `max_gap_s` Toleranz vor Track-Start / nach Track-Ende

**Offset-Semantik:**
- `offset_seconds > 0` = **Track-Zeit ist später als Foto-Zeit** = Kamera-Uhr **geht vor**
- z.B. Foto-EXIF zeigt 11:30, Track-Punkt am Ort war 09:30 UTC → Offset = -7200 s = "Kamera 2 h zurück"

**Wichtig:** Die Offset-Konvention ist *additiv auf die Foto-Zeit*. UI multipliziert Sign × |Δ|.

### `core/backup.py`

**Hauptfunktion:**
| Funktion | Zweck |
|----------|-------|
| `make_photo_backup(paths, dir, label) -> zip_path` | ZIP mit Original-Kopien, kompr.-level 1 (schnell) |

**Wichtige Details:**
- Dateinamen werden flach ins ZIP gelegt (`arcname = basename`)
- Bei Namens-Konflikten geht der letzte Eintrag vor — Annahme: Geotagger lädt nie 2× gleichnamige Fotos
- Retention: max 20 ZIPs pro Backup-Dir, ältere werden gelöscht

### `core/route.py` (seit v0.9.205 — Animator „Route / Anreise")

Erzeugt eine Strecke aus Start+Ziel, die als **synthetisches GPX** geschrieben
und über `loadGlobalGpx` wie ein normaler Track durch die ganze Pipeline läuft
(Animator + Tour-Map + Höhe). **Kein neues Pip-Paket** — HTTP via `urllib`,
GPX-Schreiben via `gpxpy`.

| Symbol | Zweck |
|--------|-------|
| `geocode(query, token, limit)` | Adresse/Ort → `[{name, lon, lat}]` via Mapbox Geocoding API |
| `road_route(waypoints, token, profile, coarseness)` | Mapbox Directions API (`overview=full`, dann selbst vereinfacht). `coarseness` 0..1 → DP-Toleranz `coarseness*_MAX_SIMPLIFY_DEG` (0.06°≈6 km). → `{coords, distance_m, duration_s}` |
| `arc_route(waypoints, n_points)` | Flug-Route ohne API: echter **Großkreis** (Orthodrome) via `_great_circle_points()` (sphärische slerp + Antimeridian-Entwicklung) → korrekt polwärts gewölbt wie echte Langstrecke. `bulge` ungenutzt (v0.9.251, war Bézier) |
| `_simplify_dp(coords, tol)` | Douglas-Peucker (iterativ) — legt die groben Stützpunkte fest |
| `_catmull_rom(points, total)` | **Geschwungene Linie** (Catmull-Rom-Spline) DURCH die Stützpunkte → fließende Kurve statt eckiger Geraden; verdichtet auf ~`total` Punkte (flüssige Animation) |
| `_densify(coords, n)` | gleichmäßige Punkte nach Streckenlänge (Fallback bei <3 Punkten) |
| `write_gpx(coords, out, name, duration_s)` | GPX schreiben; bei `duration_s>0` Zeitstempel (Stats-Fahrtzeit) |
| `map_match(coords, token, profile)` | **v0.9.263** — Mapbox **Map Matching** API: verrauschte Spur `[[lon,lat],…]` aufs Wegenetz snappen → `{coords}`. Limit 100 Punkte/Request → `_match_chunk` + Chunking mit Überlappung (`_MATCH_MAX`/`_MATCH_OVERLAP`). „NoMatch" → Original-Koordinaten behalten (kein Abriss). |
| `directions_geometry(a, b, token, *, profile)` | **v0.9.268** — Mapbox **Directions** für GPX-Inspektor A→B: `overview=full`, snappt A/B auf nächste Straße, routet dazwischen → `{coords, matched}`. **Kein 50-m-Limit** (anders als Map Matching). |
| `RouteError` | Netzwerk-/Token-/keine-Route-Fehler |

**v0.9.261 — SSL/certifi (wichtig!):** alle HTTPS-Calls laufen über `_http_get_json`,
das jetzt `urlopen(..., context=_SSL_CTX)` mit `_SSL_CTX = ssl.create_default_context(cafile=certifi.where())`
nutzt. Im PyInstaller-Bundle findet Pythons OpenSSL die System-CA-Certs NICHT → vorher
starb JEDER Mapbox-Call (Geocoding/Directions/**Map Matching**) mit `CERTIFICATE_VERIFY_FAILED`
(nur im Bundle, nicht auf dem Dev-Mac → schwer zu finden). `certifi` kommt über `requests`
mit, `cacert.pem` ist im Bundle (PyInstaller-Hook).

**road_route-Pipeline:** Directions(full) → `_simplify_dp` (Grobheit) → `_catmull_rom`
(Schwung + Verdichtung auf ~500 Punkte). Das Nachverdichten entkoppelt „grob aussehen"
von „flüssig animieren" — der Marker gleitet immer.

**Bridge (`app.py`):** `route_geocode(query, limit)` und `route_compute(params)`
(`params = {waypoints, mode:"road"|"arc", profile, coarseness, name}`). Schreibt das
GPX nach `APP_SUPPORT/routes/<name>_<mode>_<sha1>.gpx` (Inhalts-Hash, kein `Date.now()`)
und gibt `gpx_path` zurück. Token via `_active_mapbox_token()`.

### Reiseroute-Modul (v0.9.207–214) — DRY-Klon des Animators

**Kein eigenes module.js.** `modules/animator/ui/module.js` registriert sich ZWEIMAL
in `RZGPS_MODULES` (`animator` + `reiseroute`); `mount: (b,h) => mountAnimator(b, h,
{ mode, moduleSlug })`. So wirkt jede Animator-Änderung automatisch in Reiseroute.

- **`_MODKEY`** (= `opts.moduleSlug`, Default `"animator"`) ist der eigene Namespace
  pro Tab: Settings (`_activeProject[_MODKEY]` via bindSetting/saveProjectSettings),
  Tab-State-Cache, Undo, Accordion-State. **Massenersetzung** `.animator`→`[_MODKEY]`
  (perl, `\b`-geschützt gegen `.animator_*`-Bridge-Calls). `util.js isProjectModule`
  kennt `reiseroute`.
- **`_SIGNS_KEY`** (= `animator?"signs":_MODKEY+"_signs"`) trennt Schilder/Fotos pro
  Modul (Animator behält `signs` für Back-Compat). `_animSignsList/Save` + Render-Param.
- **`_isReiseroute`** gated die modul-spezifische Logik. Sektionen werden je Modus
  per `querySelector(...).remove()` entfernt: Animator → `route` + `ghost-gpx` raus;
  Reiseroute → `overlays` raus.
- **GPX als Ghost + Route als Track:** in `applyGlobalGpx` leitet `_isReiseroute` das
  geladene GPX in `_ghostGpxCoords` (early return, NICHT `currentCoords`); `_routeCompute`
  lädt die Route via `loadGpxByPath` LOKAL (globales GPX unangetastet). Ghost-Layer
  `preview-ghost-gpx` (`_applyGhostGpx`, Config-Sektion „👻 GPX-Ghost" →
  `ghost_gpx_{show,color,opacity_pct,width,dashed}`). Render: `AnimatorConfig.ghost_gpx_*`
  + `_gpx_ghost_js` (gespiegelt zum bestehenden `track-ghost`-Layer).
- **Persistenz (v0.9.214):** `_routePersist`/`_routeRestore` speichern Start/Ziel-Text +
  -Koordinaten + mode + coarseness + profile + `route_gpx_path` in `_MODKEY`-Settings.
  `_routeRestoreGpx` (aus `onMapReady`) lädt die zuletzt berechnete Route-GPX
  (persistent in `APP_SUPPORT/routes/`) wieder als animierten Track.

**Mirroring-Ausnahme:** Reiseroute ist ein eigenständiges Modul (kein Tour-Map-Pendant).

### `core/gpxedit.py` + GPX-Inspektor-Modul (seit v0.9.233)

**Backend `core/gpxedit.py`:** `load_points(path)` liefert den **vollen Roh-Track** inkl. `ele`/`time` (kein Downsample, nutzt `core.gpx.parse_gpx`) als `{ok,points:[{i,lat,lon,ele,time}],count,has_time,has_ele,has_sensors,bbox}`. `save_points(points,out,name,src_path)` schreibt via gpxpy. `healed_output_path(src)` → `<name>_geheilt.gpx`. Bridges `gpxinspect_load`/`gpxinspect_save` in `app.py`.

**v0.9.334 — Inspektor erhält FIT/TCX-Sensoren (Nutzer-Bug):** Vorher schrieb `save_points` ein nacktes Geometrie-GPX → die Sidecar-Sensoren (HR/Temp/Cadence …) gingen verloren. Jetzt: jeder Frontend-Punkt trägt `oi` (Original-Index im Quell-Track; `load_points` gibt `i` zurück, `gpxinspect/module.js` reicht es als `oi` durch — geheilte/gezogene Punkte ändern in-place und behalten `oi`, splice-eingefügte/map-matchte Punkte haben `oi=undefined`). `save_points(...,src_path=…)` reparst die Quelle (`parse_gpx` mit gemergter Sidecar), mappt pro Ausgabepunkt `oi → src.extra`, interpoliert `oi=None`-Läufe linear (`_interp_none_runs`/`_interp_extra`, Ränder = nächster Wert) und schreibt `imports.write_sidecar(out_extra, out)`. Greift nur wenn die Quelle Sensoren hat (sonst No-Op, alte Geometrie-Heilung unverändert). End-to-end mit echter Suunto-FIT verifiziert (behaltene Punkte exakt, eingefügte interpoliert).

**v0.9.335 — „Speichern unter…" + Sensoren eingebettet + TCX (Nutzer-Feedback):** `save_points(points, out, *, name, src_path, fmt="gpx")` schreibt jetzt über `trackio.export_payload` statt rohem gpxpy → **gpxtpx HR/Cadence/Temp + `<power>` direkt im GPX**, bzw. **HeartRateBpm/Cadence nativ im TCX** (`fmt="tcx"`). `_reindex_extra` liefert die re-indizierten Extra-Dicts (vorher `_preserve_sensors`); sie werden an die Punkt-Dicts gehängt und für GPX zusätzlich als Sidecar geschrieben (exotische Felder verlustfrei). Bridge `gpxinspect_save(points, src_path, out_path="", fmt="gpx")` — `out_path` kommt aus dem `pick_save_path`-Dialog (Default-Ordner = Original-Datei via `_origPath` im Frontend, nicht der `_imports`-Cache). `trackio.to_tcx_string` schreibt jetzt HR+Cadence (gilt auch fürs normale TCX-Export). gpxpy-Import aus gpxedit.py entfernt (ungenutzt).

**v0.9.340 — Filterleiste oben + Karten-Filter (WYSIWYG):** Geotagger-Layout umgebaut: `<section class="canvas gt-content">` (flex column) mit `#gt-filterbar` oben (volle Breite) + innerem `.gt-layout` (Fotos+Karte). `renderFilterBar()` baut Chips (Kategorien `tagged/oor/notime/hasgps` + „Alle"=reset + je Kamera ein `📷`-Chip ab 2 Kameras), Klicks über gemeinsamen `_gtFilterClick` (an `#gt-summary` UND `#gt-filterbar` gebunden). `updateSummary` ruft `renderFilterBar()` und ist nur noch Zähler (interaktive Buttons/Kamera-Block raus). **Karten-Filter:** `_gtMatchInFilter(m)` (Kamera+Kategorie); `redrawMarkers` überspringt Marker, die nicht im Filter sind; `_gtSetFilter`/`_gtSetCamFilter` rufen jetzt zusätzlich `redrawMarkers()`; Kompass nur für sichtbares selektiertes Foto. CSS `.gt-content/.gt-filterbar/.gt-fchip/.gt-fsep` in module.css (lädt nach app.css → gewinnt über `.canvas`). UI-Smoke 0 pageerrors, Layout (Foto-Spalte+Karte) intakt. Chips/Karten-Filter live mit Fotos noch ungetestet (computer-use aus).

**v0.9.339 — „Nur Fehlendes ergänzen" + eigenes-GPS-Vorrang:** Schreib-Modus `write_mode` (`fill`|`overwrite`|`skip_existing`, Default fill) durch `geotagger_start_write`→Worker. **Zuordnung:** `geotagger_compute_positions` setzt bei `existing_gps` die Match-Position auf das eigene GPS (`m.lat/lon/alt`), `in_range=True`, `pos_src="exif"` → eigenes GPS schlägt die Zeit-Zuordnung, Marker/Geocoding nutzen den echten Standort. **Worker** (`_write_worker_run`): pro Foto `write_coords = overwrite or not has_gps`; im fill-Modus wird Richtung/Adresse vorher per `read_img_direction`/`has_location` geprüft und nur geschrieben, wenn sie fehlt; eigenes GPS bleibt → wenn `write_coords` False, nur `write_img_direction` (GPS unangetastet) + `write_location`. Filter lässt im fill/overwrite alle GPS-Fotos zu (nur `skip_existing` überspringt sie). exif.py neu: `read_location`/`has_location` (IPTC/XMP City/Country), `write_img_direction` (nur GPSImgDirection, ohne lat/lon). UI: `gt-write-mode`-Select (statt `gt-overwrite`-Checkbox), `bindSetting(..., "write_mode", {type:"string"})`, Bestätigungs-Modal zeigt modusabhängige Zeile; `runWriteWithProgress(... writeMode ...)` reicht `write_mode` als 8. Bridge-Arg. Headless verifiziert: 4 Szenarien (eigenes GPS bleibt + Adresse/Richtung ergänzt; kein GPS→alles; vorhandene Porto-Adresse+Richtung bleiben unangetastet; overwrite ersetzt GPS), Bausteine (has_location, write_img_direction behält GPS), UI-Smoke 0 pageerrors.

**v0.9.338 — Geocoding: Anbieter + 3-Stufen-Pyramide + automatisch:** `core/geocode.py` umgebaut: `resolve_provider(provider, token)` (auto→mapbox-wenn-`pk.`-Token-sonst-photon, off→None), `reverse(lat,lon,*,provider,mapbox_token,lang,zoom)` dispatcht auf `_nominatim`/`_photon`/`_mapbox` (Mapbox Geocoding v6, Photon komoot, Nominatim mit `zoom`), Cache per (provider,coord,zoom), Drossel je Anbieter (`_MIN_INTERVAL`). Clustering: `cell_key(lat,lon,cell_m)` + `cluster(points,cell_m)` (Gitter, Schwerpunkt je Zelle). Worker `geotagger_reverse_geocode_start` jetzt **Pyramide**: Stufe0 Schwerpunkt→`country/state` (1 Call, zoom5), Stufe1 1-km-Cluster→`city/state/country/postcode` (zoom10), Stufe2 60-m-Cluster→`street/postcode/…` (zoom18); `_overlay` merged coarse→fine, `total`=Call-Anzahl, Generation-Token `_geo_gen` bricht alte Läufe ab. Provider/`geocode_enabled`/Token aus Settings (Token bewusst roh, unabhängig von `force_osm`). Settings top-level `geocode_enabled`/`geocode_provider` (DEFAULT_SETTINGS), UI im globalen `openSettingsModal` (`ui/js/app.js`, Checkbox + Provider-Dropdown + Erklärtexte). Frontend `modules/geotagger/ui/module.js`: `_gtRunGeocode(opts)` (geteilt Button+Auto), `_gtMaybeAutoGeocode()` nach `updateMatches` (gated auf `_settingsCache.geocode_enabled`, `_gtGeoSeen` gegen Mehrfach-Trigger). Headless verifiziert (Photon+Nominatim live, Pyramide-Merge Berlin vs. Hohen Neuendorf, resolve/cluster, UI-Smoke 0 pageerrors). Mapbox-Pfad braucht Live-Test mit echtem Token.

**v0.9.337 — Karten-Kompass + Adresse + EXIF-Feldauswahl (Geotagger):** (1) **Interaktiver Kompass** (`modules/geotagger/ui/module.js`): `_gtShowCompass(m)` setzt beim Foto-Select einen eigenen `mapLib().Marker` (`_compassMarker`, getrennt von den Pin-Markern) mit drehbarem Ring; `bearingFromEvent` rechnet Screen→Kompasskurs (`atan2(dx,-dy)`, 0=N), `commit()` schreibt `_gtDir`-Map + `m.dir/dir_src="manual"`, ✕ = `dir=null/dir_off`. `_gtApplyManualDir` reapplied die manuelle Richtung nach jedem `geotagger_match`. CSS `.gt-compass*` in `module.css`. (2) **Reverse-Geocoding** `core/geocode.py` (Nominatim, gedrosselt 1.1 s + gecacht, kein Token) → Bridge `geotagger_reverse_geocode_start/_status` (Background-Thread, Polling); Frontend `_gtAddr`-Map, Adresse im Popup. EXIF: `exif.write_location(path, addr)` schreibt IPTC + XMP-photoshop + XMP-iptcExt (City/State/Country/Sub-location, immer exiftool — auch JPEG). (3) **Feldauswahl** `write_fields={gps,altitude,direction,address}` (persistiert `gt-wf-*`) → `geotagger_start_write(..., write_fields)` → Worker gated `altitude`/`direction`/`address`; `direction` schreibt jetzt bei `dir_src in (logged, manual)`. **Web-Tagger** (`web-tagger/app.js`): `rzExtVal` liest `rz:hdg`, `writeGpsIntoJpeg(...,hdg)` schreibt GPSImgDirection (piexifjs). Verifiziert: voller Backend-Chain headless (Vivo-GPX rz:hdg + manuelle 123° → EXIF), `write_location` (Berlin→City/Country), Web-Tagger-Playwright, UI-Smoke (geotagger mount 0 pageerrors). Live-UI-Klicktest stand aus (computer-use-Freigabedialog ungeklickt).

**v0.9.336 — Reisezoom-Logger-Heading → GPSImgDirection (Studio + Standalone):** Der Geotagger schreibt jetzt die im GPX geloggte Kamera-Blickrichtung ins Foto-EXIF. Kette: `sensors.RZ_READ` mappt rz:-localnames → kanonische Keys → `gpx._read_point_extensions` füllt `TrackPoint.extra["heading"]` (true north). `Api._enrich_geotag` Prioritäts-Kette **EXIF (`read_img_direction`) → geloggt (`extra["heading"]`, `dir_src="logged"`) → Bewegung (`csun.bearing`, `dir_src="move"`)**; `dir`/`dir_src` gehen via JS-Match-Objekt zurück. Im Write-Worker (`_write_worker_run` + Sync-Fallback `geotagger_write`) wird `img_direction` nur gesetzt, wenn `dir_src=="logged"` (nie die Bewegungs-Schätzung), und an `exif.write_gps(..., img_direction=)` durchgereicht. Backends: `_piexif_write_gps` (JPEG, GPSImgDirection als Rational + Ref='T'), `_build_gps_write_args`/`_exiftool_write_gps` (RAW/HEIC/TIFF), `_exiftool_write_gps_video` (MP4/MOV). UI-Chip zeigt Quelle „Kamera/geloggt/Bewegung“ (`geotagger.dir.{cam,logged,move}`). End-to-end mit echter Vivo-X300-Logger-GPX verifiziert (rz:hdg=74.1° → GPSImgDirection=74.1° zurückgelesen). Standalone-Geotagger teilt den Code → automatisch mit drin.

**Modul `modules/gpxinspect/`:** registriert `RZGPS_MODULES.gpxinspect` (icon 🔍, sort_order 25). **Layout-Gotcha:** nutzt das bewährte `.module-body`-Grid (`.panel`+`.canvas`) — ein eigener Display-Override kollabierte die Karten-Höhe auf 0. State: `_points` (editierbare Kopie), `_selA/_selB` (Anker), `_spikes`/`_spikeSet` (Despike), `_undo`.

**Edit-Mathematik:** *Heilen* legt Punkte zwischen A und B auf die Gerade (lat/lon/ele linear nach Index-Anteil), **lässt `time` unverändert** → Geschwindigkeit (Strecke ÷ Zeit) korrigiert sich selbst. *Füllen/Pfad-zeichnen* interpolieren ele+time linear über die kumulative Distanz. *Verschieben* (Drag des grünen Ankers) ändert nur lat/lon.

**Auto-Despike** (`detectSpikes`): markiert Punkte mit großem **Umweg über die Sehne** der Nachbarn (`dist(A,P)+dist(P,B) − dist(A,B)`), geometrisch + optionalem Speed-Gate; echte Lücken (gerader Sprung ohne Rückkehr) haben ~0 Umweg → unmarkiert. Empfindlichkeits-Slider (1–10) skaliert per `lerp` alle Schwellen (Faktor/Floor/SpeedCap).

**Schleifen-Schutz beim Routen/Matchen (v0.9.315):** Straßen-Profile (Wandern/Fahrrad/Auto) füllen Lücken über `gpxinspect_route_gaps`→`directions_geometry` bzw. matchen über `map_match`. Mapbox kann an Kreuzungen einen **Umweg/Kreisel** zurückrouten und so eine **Schleife in eine saubere Spur** schreiben (Marc-Bug: Teneriffa-Track, Punkt ~826 — im Original geradeaus, im `_geheilt` ein erfundener Abstecher; headless verifiziert: 0 Original-Punkte im Schleifen-Bereich). **Guard** `_routeIsDetour(coords, straightDist, maxRatio)` = Pfadlänge/Luftlinie > maxRatio (Floor 30 m gegen Überempfindlichkeit bei Mini-Lücken). Auto-Heilen: `maxRatio 2.5` → Route verworfen, **gerade gefüllt** (`_linearFillGap`), Zähler „Umwege verworfen" im Toast. Manuelles „Strecke A→B": `maxRatio 4.0` (Straßen sind legitim länger, nur grobe Schleifen blocken) → Warn-Toast statt anwenden. **„Ganzen Track snappen"** (`matchWhole`, überschreibt ALLE Punkte) hat jetzt 2-Klick-Bestätigung (`_matchWholeArm`, 4 s Fenster) + Warn-Toast. **Prinzip:** Heilen fügt nur in echte Lücken ein, fasst vorhandene Punkte nie über einen Umweg an.

**Undo:** via globalem `window.createUndoController` (s. „Undo/Redo-System"), registriert als `window.__rzUndoControllers.gpxinspect`, ⌘Z geroutet über die Panel-ID `gpxi-panel`.

**v0.9.263 — Zeitstempel + Map Matching:** (a) `_ptInfo(idx)` schreibt Index/Uhrzeit(lokal)/Höhe in die Auswahl-Zeile (`gpxi-sel`); bei A+B zusätzlich Dauer via `_fmtDur(tB-tA)`. (b) **Map Matching**: Buttons `gpxi-match-sel` (Bereich A→B, enabled wie `gpxi-fill`) + `gpxi-match-all` (ganzer Track) + Profil-Select `gpxi-mm-profile`. `_runMatch(start,end,label)` → Bridge **`gpxinspect_map_match(coords, profile)`** (app.py → `croute.map_match`, Token via `_active_mapbox_token()`) → `_applyMatchedRange()` ersetzt `_points[start..end]` durch die gematchte Linie, verteilt Zeit + Höhe **linear über die kumulative Streckenlänge** zwischen den Endpunkt-Werten (A.time→B.time, A.ele→B.ele). `_pushUndo` vor dem Ersetzen → ⌘Z möglich. `_mmBusy`-Flag sperrt die Buttons während des Requests. Fehler-Codes: `no_token`/`NoMatch`/Netz → eigene Toasts.

**v0.9.268 — A→B auf Directions umgestellt + Nachverdichten/Durchschnittsgeschwindigkeit:** Der **A→B**-Button (`gpxi-match-sel`) nutzt nicht mehr Map Matching (50-m-Radius-Limit, HTTP 422 darüber), sondern **Directions** via Bridge **`gpxinspect_route_ab([Alon,Alat],[Blon,Blat],profile)`** → `croute.directions_geometry(a,b,token,profile=…)` (`overview=full`, snappt A/B auf nächste Straße, routet dazwischen → kein Radius-Limit). `routeSelection()` ruft danach **`_applyRoutedRange(_selA,_selB,coords)`** (statt `_applyMatchedRange`): (1) **`_densifyLine(line,spacing)`** verdichtet die gefundene Route auf den **typischen (Median-)Punktabstand des ganzen Tracks** (5–50 m geclampt) — der Animator bewegt den Marker **index-basiert** (Punkt/Frame), also gibt mehr Punkte = proportional mehr Frames = realistisches Tempo. (2) Zeit wird über die **Durchschnittsgeschwindigkeit des Abschnitts** `v=dOrig/(tB-tA)` neu getaktet (statt in das alte A→B-Zeitfenster gequetscht); die längere Route braucht ehrlich mehr Zeit, **nachfolgende Zeitstempel werden um `delta=(dNew−dOrig)/v` mitverschoben**. Höhe linear A.ele→B.ele über die neue kumulative Länge. `matchWhole()` (ganzer Track) bleibt bei `_applyMatchedRange` (lineare Verteilung).

**v0.9.291/292 — Höhe korrigieren (DEM-Blend mit sichtbarem Profil):** Nutzer-Idee — GPS-`ele` ist verrauscht → zu viele Höhenmeter. v0.9.291 hatte nur einen „blinden" Button; v0.9.292 (Nutzer-Feedback „man sieht nicht was passiert") macht das Mischen **visuell**. In `onMapReady` wird (nur bei `isMapboxMode()`) ein `raster-dem`-Source `gpxi-dem` (`mapbox://mapbox.mapbox-terrain-dem-v1`, tileSize 512, maxzoom 14) + `map.setTerrain({source, exaggeration:1.0})` gesetzt (Optik bleibt top-down/pitch 0; `exaggeration:1.0` ⇒ `queryTerrainElevation` liefert reale Höhe ohne `{exaggerated:false}`).

Layout: Die Canvas-Section heißt jetzt `#gpxi-canvaswrap` (Flex-Spalte) — Karte `#gpxi-canvas` (`position:relative; flex:1`) oben, **Höhenprofil-Streifen `#gpxi-ele-profile`** (feste Höhe, `hidden` bis geladen) unten. Beim Ein-/Ausblenden des Streifens `map.resize()`.

Flow: **`loadEleProfile()`** (Button `gpxi-ele-load`) fährt `fitBounds(_trackBounds(),{animate:false})`, wartet auf `map.once("idle")` (9 s Fallback), samplet `map.queryTerrainElevation([lon,lat])` pro Punkt → `_demEles` (Array, null bei Miss), `jumpTo(cam)` zurück, blendet Profil ein, aktiviert Regler+Apply. **`drawEleProfile()`** zeichnet ein SVG (`#gpxi-eleprof-svg`, `viewBox 0 0 1000 150`, `preserveAspectRatio=none`, alle Linien `vector-effect:non-scaling-stroke`) mit drei `<path>`: GPS (`gpsArr`), DEM (`_demEles`), Ergebnis (`_blendEles(w)`); x = kumulative Distanz (`_cumDist`), y über min/max aller drei. Kein SVG-`<text>` (würde durch `preserveAspectRatio=none` horizontal verzerren) — Höhenspanne + Höhenmeter (GPS/Karte/Ergebnis via `_eleGain`) stehen in `#gpxi-eleprof-info`. Regler `gpxi-ele-weight` (`input`) ruft live `drawEleProfile()`. **`applyEleBlend()`** (Button `gpxi-ele-apply`) schreibt `_blendEles(w)` in `_points[].ele` (`_pushUndo`, `_dirty=true`, `renderAll/updateUI`). **`_eleInvalidate()`** verwirft `_demEles` + versteckt den Streifen; wird aus `loadTrack`/`clearTrack` und aus `renderAll()` bei Punktzahl-Änderung (`_demEles.length !== _points.length`) gerufen, da sich dann die Indizes verschieben. Gate: ohne Token Load-Button disabled + Hinweis. Korrigierte Höhe geht via bestehendes `gpxinspect_save` (payload enthält `ele`) ins GPX → propagiert in alle Module.

**v0.9.293 — Zoom-Sync Karte↔Profil + Punkt-Modal:** Das Höhenprofil rendert nur das Index-Fenster `[_profI0.._profI1]` (statt des ganzen Tracks). **Karte→Profil:** `map.on("moveend", onMapMoveSyncProfile)` → `_windowFromBounds()` (Punkte in `map.getBounds()` → min/max-Index) → `drawEleProfile()`. **Profil→Karte:** Mausrad (`onProfileWheel`→`_zoomProfileWindow`) und Drag (`onProfileMove`→`_panProfileWindow`) verändern das Fenster und rufen `_fitMapToWindow()` (`map.fitBounds` der Fenster-Punkte). Reentrancy-Schutz: `_syncing`-Flag + `map.once("moveend", …)` — programmatic moves syncen das Profil nicht zurück. `drawEleProfile` legt `_profDraw = {i0,i1,x0,span,W,cum}` für Hit-Testing ab; `_profileIdxAtClientX()` rechnet clientX→viewBox→kumulative Distanz→nächster Index. **Klick-Modell** (Marc-Wahl): Einzelklick (Karte `onPointClick` / Profil `onProfileClick`) zeigt **verzögert (240 ms)** ein leichtes Info-Feld am Punkt (dunkelt NICHT ab — Marc-Korrektur gegen das ursprüngliche `openModal`): **Karte** `showPointInfoMap(idx)` = natives `_maplib.Popup` (am lngLat, folgt der Karte), **Profil** `showPointInfoProfile(idx, clientX, clientY)` = absolute `<div class="gpxi-pinfo-float">` im `#gpxi-canvaswrap` an der Klickstelle. Inhalt aus gemeinsamem `_pointInfoHtml(idx)` (Tabelle aller Felder + DEM-Höhe), Buttons via `_wirePointInfo(idx, closeFn)`. Neuer Klick → Popup/Box wandert (alte wird via `_closeMapPopup`/`_closeProfileBox` entfernt; die beiden schließen sich gegenseitig). Box wird bei jedem `drawEleProfile()` geschlossen (Position sonst stale). **Doppelklick** (`onPointDblClick`/`onProfileDblClick`, mit `e.preventDefault()` gegen Karten-Zoom) cancelt den Timer und ruft `selectAnchor(idx)` direkt. Anker-Auswahl wurde aus `onPointClick` in `selectAnchor()` herausgezogen. Im Profil werden Punkte als `<circle>` gezeichnet, wenn ≤200 sichtbar; Anker A/B als vertikale Linien. Sidebar-`gpxi-sel` zeigt für Einzel-Anker nur noch `#N` (Detaildaten sind im Modal). Cleanup entfernt den window-`pointerup`-Listener + schließt offenes Modal.

**v0.9.294 — verknüpfter Hover-Cursor:** `setHover(idx)` setzt (a) den Ring-Marker auf der Karte (Source `gpxi-hover`, Layer `gpxi-hover-lyr`, transparenter Kreis + weißer Stroke) und (b) den vertikalen Balken `#gpxi-eleprof-cursor` (absolutes `<div>` im `.gpxi-eleprof`, Pixel-x aus `_profDraw` projiziert). **Karte→Profil:** `map.on("mousemove", onMapHover)` (rAF-gethrottelt via `_hoverRAF`) → `_nearestIdxToLngLat()` sucht im sichtbaren Fenster den nächsten Punkt (lon mit `cos(lat)` skaliert) → `setHover`. **Profil→Karte:** SVG-`mousemove` `onProfileHover` → `_profileIdxAtClientX` → `setHover`. `mouseout`/`mouseleave` → `setHover(null)`. Cursor wird in `drawEleProfile` versteckt (Position sonst stale), Marker in `_eleInvalidate` geleert; `_hoverRAF` im Cleanup gecancelt.

**v0.9.295 — Auto-Heilen (Ausreißer + Lücken) + Klick-Toleranz:** `detectGaps()` findet ungewöhnlich lange Segmente (Dropouts): Baseline = **p25** der Segmentlängen (robust, auch wenn der Track viele Lücken hat), Schwelle `max(GAP_FLOOR, base*GAP_FACTOR)` mit dem Empfindlichkeits-Slider (`lerp`), Segmente die einen Spike-Punkt berühren werden ausgeschlossen → `_gaps=[{a,b:a+1,dist}]`. `renderGaps()` zeichnet die Vorschau in **Magenta** auf neue Layer `gpxi-gapfill` (gestrichelte MultiLineString-Füll-Linie) + `gpxi-gapfill-pts` (Geister-Punkte, Budget 600). `runDespike()` ruft jetzt zusätzlich `detectGaps()`+`renderGaps()`; `healAllSpikes()` glättet erst die Spikes (in-place) und füllt dann die Lücken per `splice(g.a+1,0,…)` **von hinten nach vorne** (Index-Stabilität), Zeit/Höhe linear interpoliert. `clearSpikes()` leert auch `_gaps`+Layer. Slider `gpxi-spacing` rerendert die Geister-Punkte live. **Klick-Toleranz:** Map-Klicks sind nicht mehr layer-gebunden, sondern `map.on("click", onMapClick)`/`dblclick` → `_nearestIdxToPoint(px,py,18)` projiziert alle Punkte und nimmt den nächsten im 18-px-Radius (öffnet das Info-Feld schon „nah dran", nicht nur bei 100-%-Treffer). Headless-verifiziert (`/tmp/gaptest.js`: 1 Lücke @ idx20, 24 Füllpunkte, max. Segment danach 20 m).

**v0.9.296 — Inspektor lädt Fremdformate + Track-Fit ohne Fly-in (Beta-Feedback):** (1) `app.gpxinspect_load(path)` ruft jetzt zuerst `self._ensure_gpx(path)` (LOG/FIT/KML/… → GPX), parst den konvertierten Pfad und gibt ihn als `res["src"]` zurück; `loadTrack()` in `gpxinspect/module.js` setzt `_srcPath = res.src || path` (Heilung landet neben der konvertierten Datei). Vorher gab eine rohe `.LOG` `GPXXMLSyntaxException` — alle anderen Lade-Pfade (geotagger/animator) ensure_gpx'en längst, nur der Inspektor nicht. Headless verifiziert (NMEA-`.LOG` → roh wirft, mit ensure_gpx → 6 Punkte). (2) `drawPreview` (animator) und der Track-Load-Fit (tourmap, nach Stats) rufen jetzt `fitTrackPreview/fitTrackToView(false)` (Sprung) statt `(true)` (500/450-ms-Fly-in) + setzen `_lastFitTs=0` (Anti-Cascade-Guard umgehen) — sofortige Track-Ansicht, kein ruckelndes Reinzoomen von der Weltkugel auf schwachen Rechnern. Die 🌍-Welt-Buttons (`_centerWorld`) bleiben absichtlich `WORLD_ZOOM=0` (Kino-Globus).

**Mapbox-Expression-Falle (v0.9.240, schon bei Schildern aufgetreten):** ein zoom-`interpolate` darf NICHT in einem `case` verschachtelt sein (sonst wirft `addLayer` → still verschluckt → Layer/Punkte unsichtbar). Lösung: `interpolate` oben, der Feature-`case` ist der Output-Wert pro Zoom-Stop.

### `core/animator.py`

**Klassen + Funktionen:**
| Symbol | Zweck |
|--------|-------|
| `MAP_STYLES: dict` | 6 Map-Styles (Schlüssel → Mapbox-Style-URL) |
| `AnimatorConfig` | Render-Parameter (Pfade, Token, Style, Pitch, **`point_density`**, **`transparent_background`** etc.) |
| `find_ffmpeg() -> str` | PATH-Suche + Homebrew-Fallback + imageio-ffmpeg-Bundle |
| `_make_html(...)` | HTML-Generator — branch zu `_make_html_alpha` bei `transparent_background=True` |
| `_make_html_alpha(...)` | **Alpha-Variante** — kein Mapbox, nur SVG-Track auf transparent + Overlay-Boxen |
| `render(cfg, on_progress)` | Async-Pipeline (Video, ffmpeg), Progress-Callback |
| `render_frame(cfg, on_progress)` | **(v0.9.307)** EIN statischer PNG-Frame über dieselbe `_make_html`-Pipeline — Tour-Map = Standbild vom Animator |

#### Tour-Map = ein Standbild vom Animator (v0.9.307)

**Motivation:** früher hatte `core/tourmap.py` einen **eigenen, kompletten Render** (eigenes `_make_html`, eigene `TourmapConfig`, eigenes Foto-System) — doppelter Code, der ständig zum Animator nachgezogen werden musste (Spiegelungsregel) und auseinanderdriftete (z.B. Fotos = PhotoPins in Tour-Map, aber Schilder im Animator). **Jetzt:** Tour-Map rendert über die Animator-Pipeline.

- **`render_frame(cfg)`** baut das HTML mit `_make_html(cfg, …)` (identisch zum Video), wartet `isReady`, ruft **einmal** `advanceFrame(lastIdx, bearing, fitCenter, fitZoom, pitch)` (volle Strecke + alle Fotos/Schilder/Overlays via markerAnchor=1), blendet die bewegte `dot-*`-Ebene aus, greift **ein** PNG (`_grab_still_png`, immer PNG + SSAA-Downscale), Schwarz-Frame-Schutz wie Frame 0 im Video. **Kein** ffmpeg, **kein** Loop.
- **`AnimatorConfig`-Felder dafür:** `still_frame` (aktiviert den Pfad), `bearing` (fester Kamera-Bearing), `padding_pct` (Fit-Rand %), `show_pins` (Start/End-Pins). In `_make_html`: `SHOW_PINS`-JS-Konstante + Pin-Ebene (`pin-glow`/`pin-core`, 1:1 aus alter tourmap.py); Bounds-Fit nutzt bei `still_frame` `padding_pct`+`bearing`, sonst weiter `8 %`/`-10` → **Video-Pfad byte-gleich**.
- **Bridge:** Der Render läuft über `app.py::animator_start_render` mit `still_frame=True` (Worker-Branch ruft `canim.render_frame` statt `canim.render`). `overlay_live_enabled=False` (Standbild hat keine Live-Box).
- **v0.9.412 — Snapshot (Animator-Frame als PNG) + Kamera-Übernahme (Tour-Map):** `render_frame` bekam einen **Kamera-Override + Marker-Anker**: `AnimatorConfig.snapshot_center([lon,lat])/snapshot_zoom/snapshot_bearing/snapshot_pitch` ersetzen den Bounds-Fit; `snapshot_anchor` (0..1) setzt den Marker-Index (`round(a·(N-1))`) → **Teil-Track + laufender Punkt sichtbar** (Animator-Frame); ist er `None`, bleibt es der Voll-Strecke-Standbild-Modus (Punkt aus). `snapshot_time_s` treibt `__overlayTiming` (Live-Box-Zeitfenster). **Bridge:** `animator_start_render` erkennt `params.snapshot` → `_still=True` (PNG-Ausgabe) + setzt die `snapshot_*`-Felder auf `cfg`; Worker-Routing zu `render_frame` wenn `still_frame` ODER `snapshot_center` gesetzt. **Frontend (`modules/animator/ui/module.js`):** Buttons `#anim-snapshot` + `#anim-open-tourmap` (nur `!_isStaticFrame`). Snapshot: `_animCameraCorrected(w,h)` (center + `correctedZoom` + bearing + pitch) + `_snapshotAnchorAndTime()` (Scrubber-Timeline-Progress → Track-Anker + Video-Sekunde) → `_snapshotRequest` → normaler Render-Klick (Save-Dialog liefert `.png`, Params spreaden `_snapshotRequest`, Done-Handler zeigt Bild statt Video via `_lastRenderWasSnapshot`). „Als Tour-Map öffnen": RAW-Kamera → `window.__pendingCameraForTourMap` → `switchMod('tourmap')`. **Tour-Map-Übernahme:** `fitTrackPreview` wendet die pending Kamera EINMAL per `jumpTo` an, setzt `_tmCamActive=true` und **überspringt den Auto-Fit** solange aktiv (Re-Layout springt nicht zurück); `#anim-refit` (⤢) löscht `_tmCamActive`. Bei aktiver Freikamera spreaden die Render-Params `snapshot_center/zoom(correctedZoom)/bearing/pitch` aus der AKTUELLEN Tour-Map-Preview (WYSIWYG für die eigene Auflösung), und `collectTourmapExportParams` schickt `view_center([lat,lon])/view_zoom` → `tourmap_html` `map.setView(...)` statt `fitBounds`. Headless verifiziert (render_frame OSM + Kamera-Override + Anker → 668 KB PNG, 0 % schwarz; Generator setView-Pfad).
- **UI (P4, v0.9.308):** Es gibt **kein eigenes Tour-Map-Modul-JS mehr**. `modules/animator/ui/module.js` registriert `RZGPS_MODULES.tourmap` und mountet sich selbst per `mountAnimator(body, headerActions, { mode: "staticFrame", moduleSlug: "tourmap" })`. `_isStaticFrame` blendet alles Animations-Spezifische aus (Timeline, KF-Editor, Live-Stats, Trim, Flug, Rotation, FPS/Dauer …) und schaltet die Standbild-Kamera-Regler frei. Settings persistieren unter dem Projekt-Namespace `tourmap`.
- **Standbild-Kamera-Regler (P4-Ergänzung, v0.9.310):** `#anim-static-camera` (nur im `staticFrame`-Modus sichtbar) mit `anim-static-bearing` (Ausrichtung), `anim-static-padding` (Randabstand %) und `anim-static-pins` (Start/Ziel-Markierung). Persistiert als `static_bearing`/`static_padding`/`static_pins`. `fitTrackPreview` liest im `staticFrame` Bearing+Padding aus den Slidern (sonst `8 %`/`-10` wie der Video-Pfad → byte-gleich). `updateStaticPinsPreview()` zeichnet Start/Ziel-Pins (`preview-pin-glow`/`preview-pin-core`) live in die Vorschau, identisch zum Render-`SHOW_PINS`-Block. Die Params-Builder schicken die Slider-Werte als `bearing`/`padding_pct`/`show_pins`.
- **Status (v0.9.310):** `core/tourmap.py` und `modules/tourmap/ui/` (CSS+JS) sind **gelöscht**. Der `ctmap`-Import in `app.py` ist raus, `ui/index.html` lädt die Dateien nicht mehr. Der Projekt-Settings-Namespace `tourmap` (in `DEFAULT_SETTINGS`) bleibt — er ist jetzt der Settings-Store des `staticFrame`-Modus.

**Tour-Map → interaktiver Leaflet-HTML-Export (v0.9.406):** Neu neben dem PNG-Render. Ziel: eine eigenständige, tokenfreie Leaflet+OSM-Karte fürs Blog (wie `reisezoom.com/havelhoehenweg/`), WYSIWYG zur Vorschau.
- **v0.9.411 — Schilder als echte Bilder (nicht Punkte):** Ursprünglich rendered `signIcon` einen farbigen Punkt + Popup — kein WYSIWYG. Jetzt rastert das Frontend (`collectTourmapExportParams` in `modules/animator/ui/module.js`) jedes sichtbare Schild via `_animSignDrawImageData(s)` → `__rzDrawSign` (dieselbe Canvas-Engine wie Vorschau/Video) auf ein `<canvas>` → `toDataURL('image/png')` und schickt `{lat,lon,img,w,h,anchor}` (w/h = CSS-px = Bildpixel/dpr; anchor = calloutDir/Sprechblasen-Richtung). Bridge `tourmap_export_html` reicht das 1:1 durch (KEIN `_shrink_data_uri` → Schild bleibt scharf). Generator: `signIcon(s)` = `L.icon({iconUrl:s.img, iconSize:[w,h], iconAnchor:signAnchor(s)})`, `signAnchor` mappt bottom→[w/2,h]/top→[w/2,0]/left→[0,h/2]/right→[w,h/2]; Marker `interactive:false` (kein Popup). `signsColor`/`.rz-sign`-CSS sind Legacy/ungenutzt.
- **Generator `core/tourmap_html.py`** (kein Playwright, reiner String-Export, wie `heightanim.make_standalone_html`): `make_tourmap_html(params)` baut ein `<!doctype html>` mit Leaflet 1.9.4 (CDN unpkg), Inline-`D`-JSON, `build()` → `L.map` + `L.tileLayer` (Stil aus `OSM_TILE_STYLES`) + `L.polyline`(`fitBounds`) + Start/Ziel-`pinIcon` + Schilder-`signIcon` (farbiger Punkt, Popup Text+Bild) + Foto-`photoIcon` (📷, Popup Bild+Name). **Consent-Overlay** (optional): Div mit frei editierbarem Text + „Karte laden"-Button, der `build()` bis zum Klick aufschiebt (DSGVO — Kacheln/IP erst nach Zustimmung). `make_tourmap_embed_snippet(html,w,h)` wickelt in `<iframe srcdoc=…>` (WordPress-„Custom HTML"). **Python-`%`-Formatierung → literale CSS-`%` als `%%` escapen.**
- **`OSM_TILE_STYLES`** (osm/topo/cyclosm/humanitarian; label/url/sub/max/attr) ist **SYNCHRON zu `ui/js/util.js` `RZ_OSM_TILE_STYLES`** — bei Änderung beide pflegen. `util.js` hat zusätzlich `osmRasterStyle(id)` (baut ein GL-Style-8-Raster-Objekt; `{s}`-Subdomains → mehrere `tiles`-URLs, funktioniert mit mapboxgl UND maplibregl) + `isOsmStyleKey(id)`.
- **Bridge `Api.tourmap_export_html(params)`** (app.py): `cgpx.parse_gpx`+`downsample(1500)` → `track [[lat,lon]]`; Schilder→`{lat,lon,text,img}`, Fotos→`{lat,lon,img,name}`, Bilder durch **`_shrink_data_uri(uri,max_px=520,q=82)`** (PIL, JPEG, data-URI rein/raus) verkleinert und inline eingebettet → portable HTML. Schreibt `.html` + `_iframe-snippet.txt` nach `RENDERS_DIR`, gibt `{ok,output,snippet,snippet_path,bytes}`. `Api.tourmap_open_in_browser(path)` delegiert an `heightanim_open_in_browser` (webbrowser.open `file://`).
- **WYSIWYG-OSM-Vorschau (Frontend):** Der `#anim-style`-Selektor bekommt im `_isStaticFrame`-Modus eine `<optgroup>` mit den 4 OSM-Stilen — **auch bei gesetztem Mapbox-Token**. `applyStyle(styleKey)` erkennt OSM-Keys (`isOsmStyleKey`) und ruft `map.setStyle(osmRasterStyle(key))` (statt der Mapbox-URL) — läuft auf der bestehenden mapboxgl- ODER maplibregl-Instanz (Raster-Style-Objekt), kein Engine-Wechsel, `rebuildPreviewLayers` nach `style.load`. Persistierter OSM-Stil wird nach `map.once("load")` re-applied (createMap kann nur Mapbox-URLs bzw. OSM-Standard). Der PNG-Render fällt bei OSM-Keys backend-seitig auf `satellite` zurück (`MAP_STYLES.get(cfg.map_style, …["satellite"])`) — OSM-Stile gelten nur für Vorschau+HTML-Export. Die OSM-Sperr-IIFE (`applyOsmStyleLock`) hat eine `_isStaticFrame`-Ausnahme (Select bleibt aktiv, keine „Token nötig"-Sperre).
- **Export-UI (`modules/animator/ui/module.js`, `_isStaticFrame`-only):** Sektion `#tourmap-html-section` (Consent-Checkbox `#tourmap-consent-enabled` + editierbarer `#tourmap-consent-text`/`#tourmap-consent-button`, per `bindSetting` unter `tourmap.html_consent_*` persistiert, Standardtext-Prefill) + Button `#tourmap-export-html`. `collectTourmapExportParams()` sammelt gpx_path, `tile_style` (OSM-Key aus `#anim-style`, sonst „osm"-Fallback), Linie/Pins/Schilder/Fotos (aus `getActiveProject()[_SIGNS_KEY]`/`.photos` + `signs_show`/`photos_show` aus Projekt-Settings), Consent, w/h. `showTourmapHtmlExportModal(res)` = zentriertes Modal (Im-Browser-öffnen/Snippet/Reveal/Schließen), 1:1 gespiegelt vom Höhen-Animator (`heightanim` showHtmlExportModal). Headless verifiziert (Api instanziiert, echte Fixture, 52 KB HTML mit topo-Tiles+Consent+Schild+Foto+Polyline+iframe-Snippet).

**Overlay-Zeitfenster (v0.9.228, „Nutzer — ab Sek X bis Sek Y"):** Pro Stats-Box (`overlay-totals` / `overlay-live` / `overlay-bottom`) je `overlay_*_from_s` + `overlay_*_to_s` in `AnimatorConfig` (Video-Sekunden; `to<=0` = bis Ende; Default 0/0 = immer sichtbar). Backend-Helper: `_overlay_windows(cfg)` (ID→`[from,to]`), `_overlay_has_timing(cfg)` (gibt es überhaupt ein Fenster?), `_overlay_timing_js(cfg)` (`<script>` mit `window.__overlayTiming(tSek)` → setzt `visibility` pro Box). Das Script wird an **beide** `overlays_block`-Varianten (normal + alpha) angehängt. Der Single-Track-Render-Loop ruft `window.__overlayTiming(frame/fps)` pro Frame — **nur** wenn `_ov_timed` (= `_overlay_has_timing`) true ist (kein Perf-Overhead sonst). Frontend-WYSIWYG: `_animOverlayTimingPreview(tSek)` spiegelt das im Probelauf (`runTimelinePreview` step: `tSek = timelineProgress × (intro+anim+hold)`), Preview-Boxen sind via `data-ovbox="totals|live|ele"` taggbar; `tSek<0` blendet alle wieder ein. UI: zwei `number`-Inputs pro Box in der Sidebar-Overlay-Sektion (`anim-ov-{totals,live,ele}-{from,to}`), `bindSetting` `type:"number"`, projekt-bewusst.

**Ruhige Kamera / entkoppelte FreeCamera (v0.9.318, gegen Berg-Hüpfen):** Mapbox GL v3 setzt bei `setCenter([lon,lat])`/`jumpTo` mit aktivem Terrain die **Kamera-Höhe = Geländehöhe unter der Mitte + feste Flughöhe** → bei Keyframe-Flügen über bergiges Terrain „reitet" die Kamera 1:1 aufs Gelände und hüpft. **Mit Pixel-Messungen diagnostiziert** (Sandbox `camera-sandbox/camera_terrain.html`): Ursache ist NICHT die Interpolation (linear ist am ruhigsten), sondern die Terrain-Kopplung; das Wackeln skaliert mit der Überhöhung. Verworfen (kein Effekt): Spline/Monoton-Interpolation, DEM-Detailstufe (`maxzoom`).
- **Lösung (Marc/Nutzer-Idee, Sandbox-validiert):** Kamera vom Terrain **entkoppeln** = framing-treue FreeCamera. Pro Keyframe-Anker die **exakte 3D-Kamera** auslesen (`map.getFreeCameraOptions()` → `position` Mercator-x/y/z + `orientation`-Quaternion), und **zwischen** den Keyframes die **Position linear im Mercator-3D-Raum** + **Orientierung per nlerp** interpolieren → `setFreeCameraOptions()` pro Frame. An den Keyframes 1:1 das gewollte Bild, dazwischen ruhig. Sandbox @2× Überhöhung: gekoppelt Median-Ruck ~0,47 vs. entkoppelt ~0,16 (~3× ruhiger), echter Render-Median 0,078.
- **Config/Schalter:** `AnimatorConfig.smooth_camera_3d` (bool, **Default False**). Setting `smooth_camera_3d` im `animator`-Namespace, Bridge in `app.py`. **UI:** Checkbox `#anim-smooth-camera` („🎥 Ruhige Kamera (3D-Terrain)") ÜBER der Classic/KF-Umschaltung, `bindSetting type:"bool"`. Ersetzt den entfernten `follow_height_smooth`/`#anim-follow-height`-Regler (war seit v0.9.317 No-Op). `tourmap`-staticFrame blendet die Zeile aus (`#anim-smooth-camera-row`).
- **Render (`core/animator.py`):** `window.__camPrepFaithful(camList)` (liest pro KF die FreeCamera via jumpTo+getFreeCameraOptions), `window.__camFaithful(t)` (interpoliert + setFreeCameraOptions), `window.__nlerpQuat`. `advanceFrame(...,setCam)` — bei `setCam===false` wird die Kamera NICHT gesetzt (Linie/Punkt/Overlays laufen weiter), die FreeCamera übernimmt. Render-Loop: vor der Schleife KF-Anker sammeln (alle kamera-relevanten Lanes + 0/1), Params pro Anker via `interpolate_properties`, `__camPrepFaithful`; **Gate** `smooth_camera_3d` + ≥2 Anker (`_use_faithful`). Debug-Aus: `RZ_NOFAITHFUL=1`.
- **Preview (`modules/animator/ui/module.js`):** `runTimelinePreview` spiegelt das: Prep (gleiche Anker-/Param-Logik, KF-Center via `interpolateCameraJs`/Track-Punkt), Helper `_faithSeek`/`_nlerpQ`, `_savedCam`-Restore nach Prep (gegen Start-Flicker). Im `step` statt `map.jumpTo` → `_faithSeek(timelineProgress)`. **Nicht** in `scrubPreview` (statische Einzelposition = unkritisch).
- **Mapbox-API:** `getFreeCameraOptions/setFreeCameraOptions`, `MercatorCoordinate(x,y,z)`, `FreeCameraOptions.position/orientation`. Portierbar zu MapLibre (FreeCamera-API dort vorhanden; Konstanten ggf. nachjustieren).
- **Offen:** Edge-Cases mit aktiver Funktion (Welt-Anflug-Keyframes, Multi-Track) noch nicht voll durchgetestet; lineare Pos-Interpolation hat kleinen Eckknick an KF-Grenzen (Marc bevorzugt linearen Feel).

**Ghost-Track (v0.9.169/170):** `AnimatorConfig.ghost_track_enabled` + `ghost_track_opacity` (0..1) + `ghost_track_color` (eigener Color-Picker, v0.9.170, Default = Track-Farbe). Zeichnet die GANZE Route schwach im Hintergrund, während nur der animierte Teil (Source `track`, per `advanceFrame` getrimmt) voll darüber liegt. UI-Helper: `currentGhostColor()`, Persistenz-Key `ghost_track_color`; Toggle/Opacity/Color teilen sich `syncGhostUi` (Felder `anim-ghost-color-field` + `anim-ghost-opacity-field`).
- **Mapbox-Render (`_make_html`):** eigene Source `track-ghost` mit ALLEN `allCoords`, Layer `track-ghost` direkt nach der `track`-Source added = unterster Track-Layer. Statisch (nie animiert).
- **Alpha-SVG (`_make_html_alpha`):** `<polyline id="trk-ghost">` VOR der geshadowten `<g>`-Gruppe (kein Drop-Shadow), Punkte einmalig in `advanceFrame` aus `projected` gesetzt (`window._ghostSet`-Guard).
- **Preview (`modules/animator/ui/module.js`):** Source `preview-ghost` (volle `currentCoords`) + Layer `preview-ghost` vor `preview-shadow`; `applyGhost()` steuert visibility/opacity/color/width live; `currentGhostEnabled()`/`currentGhostOpacity()` (Slider %→0..1). Persistenz-Key `ghost_track_opacity_pct` (in %).
- **Nur Animator** (nicht Tour-Map): dort ist der ganze Track ohnehin statisch sichtbar → erlaubte Ausnahme von der Animator↔Tour-Map-Spiegelung.

**Wegpunkt-Schilder (v0.9.171):** Text-„Schilder" entlang der Route, erscheinen wenn der Marker den Punkt erreicht (gleiche `track_anchor`-Logik wie Foto-Pins, aber als **HTML-Marker** statt Symbol-Layer — wegen Sprechblasen-Styling + Zoom-Skalierung).
- **Datenmodell:** Projekt-Root `signs: [{lat, lon, text}]` (via `saveActiveProjectPatch`/`session_update_project_root`); `signs_show` + `signs_size_px` pro Modul (`saveProjectSettings("animator", …)`).
- **Render (`core/animator.py`):** `AnimatorConfig.signs/signs_show/signs_size_px`; `signs_block` baut `mapboxgl.Marker` (Element `.wp-sign`, `anchor:'bottom'`); `window.__signsUpdate(markerAnchor, zoom)` aus `advanceFrame` → opacity (erreicht?) + `scale = clamp(0.55..2.2, 2^((zoom-14)*0.45))`. CSS-Konstante `_WP_SIGN_CSS` (muss == Preview-CSS `.wp-sign*` in `modules/animator/ui/module.css`). Alpha-SVG-Modus: NICHT unterstützt (wie Foto-Pins) → Phase 3.
- **Preview (`modules/animator/ui/module.js`):** `_animSigns*`-Funktionen (Place-Mode via `map.on('click')` → nächster Track-Index → Text-Modal; Marker-Attach; `_animSignsApplyMarkerAnchor(real)` / `_animSignsUpdateAtAnchor(timeline)` aus scrubPreview+step). Exponiert als `window.__rzAnimSigns`.
- **Nur Animator** (Tour-Map: ganze Route statisch → erlaubte Spiegelungs-Ausnahme).
- **v0.9.172:** von HTML-Markern auf **GPU-Symbol-Layer mit Canvas-Bild** umgestellt (HTML-Marker drifteten bei Kamerafahrt). Bild via `_animSignDrawImageData` (Preview) bzw. `_SIGN_DRAW_JS`→`__drawSign` (Render) → `map.addImage(ImageData)` → Symbol-Layer `anim-signs-lyr` (`icon-anchor:bottom`, `icon-size` zoom-interpoliert, viewport-aligned = Billboard). Filter wie Foto-Pins (`__signsAnchorFilter`).
- **v0.9.173:** 4 Stile (`signs_style`: callout/banner/pin/signpost) + `signs_color`.
- **v0.9.179 — voll customizable + GEMEINSAME Engine (wichtig!):** die früher **zwei synchron gepflegten Zeichen-Kopien** sind durch EINE Quelle ersetzt: **`ui/js/sign_draw.js`** definiert `window.__rzDrawSign(opts)` / `__rzSignFrame(map,lyr,src,metas,M)` / `__rzSignMeta(sign,durSec)`. Das UI lädt die Datei als `<script>` (ui/index.html, vor module.js); der Render liest **dieselbe Datei** via `core/animator.py:_read_sign_draw_js()` (`Path(sys._MEIPASS or repo)/"ui/js/sign_draw.js"`, gecacht in `_sign_draw_js()`) und bettet sie inline ein. **Kein `_SIGN_DRAW_JS`-Klon mehr.** Per-Schild-Datenmodell (`_SIGN_DEFAULTS`/`_animSignNormalize` im UI, `_sg()`-Fallbacks im Render): style/color/bg/textColor/font/weight/italic/align/size/radius/padding/opacity/border{Color,Width}/shadow{,Color,Blur}/zoomScale/alwaysVisible/before/after/entry/anchorMode. Editor `_animSignsOpenEditor` = schwebendes Panel an `document.body` (über die Karte hinaus ziehbar, z-index 9999).
- **v0.9.181 — Mapbox-Expression-Gotchas (KOSTEN-mich-Stunden-Lehre):** Schild-Layer kam GAR NICHT (addLayer warf, im try/catch verschluckt). Zwei Regeln: (a) **`feature-state` NICHT in LAYOUT-Properties** (nur Paint) → Fade läuft über `icon-opacity` (paint) + `feature-state` `op`; (b) **`['zoom']`-Interpolate muss TOP-LEVEL sein**, nicht in `case` verschachtelt → `icon-size` ist top-level `interpolate`, die Pro-Schild-Umschaltung (`zoomScale`) steckt in den OUTPUT-Werten (`['case',['==',['get','zoomScale'],true],v,1.0]` je Stop). **Lehre: Layer-Expressions immer gegen echte MapLibre/Mapbox-Instanz testen** (`tests/` via playwright+maplibre-gl@unpkg, kein Token nötig) — nicht nur das Canvas-Zeichnen.
- **v0.9.185 — Leeren:** `clearGlobalGpx` (gpx-bar.js) ruft `window.__rzAnimSigns.clearAll()` (zeigt immer auf den LEBENDEN Mount → closure-sicher gegen veraltete Resetter) + löscht `last_gpx_path` (sonst lud der Auto-Restore das GPX beim Neustart wieder).
- **v0.9.187 — Timing-BUG-FIX (wichtig!):** in `_make_html` wurde `compute_track_anchors(..., coords)` mit der **nicht existierenden** Variable `coords` aufgerufen (Param heißt `ds_points`) → NameError still vom `except` verschluckt → `track_anchor` blieb 0 → Schilder UND Foto-Pins erschienen ab Frame 0. Fix: `ds_points` (= `allCoords`/Marker-Punkte). Anker = Index-Fraktion, Marker = `safe/(totalPoints-1)` (index-linear in Zeit via `rel=int(anim_frame*coords_per_frame)`) → konsistent.
- **v0.9.188:** `alwaysVisible` (ganze Zeit zeigen → `__rzSignMeta` gibt `{a_show:-1,a_hide:2}`) + Preview-Schalter `_animSignsPreviewAll` (nur Vorschau: alle zeigen, `setFilter ['all']` + op=1).
- **Render-Backend:** `AnimatorConfig.signs/signs_show/signs_size_px/signs_style/signs_color` (globale Fallbacks); `signs_block` baut per-Schild-Props (`signs_for_render`), Source `anim-signs-src` (feature `id:i`, props `a_show/a_hide/zoomScale`), Layer `anim-signs-lyr`, `window.__signsAnchorFilter(M)` → `window.__rzSignFrame`. **Alpha/SVG-Render-Modus: noch ohne Schilder** (TODO).
- **v0.9.255/256 — HYBRID-Rendering (wichtig, behebt Flacker↔Schwimm-Zielkonflikt):** Schilder rendern in der **Vorschau** jetzt modusabhängig (`_animSignEditMode`):
  - **Editier-Modus (Editor offen):** echte **HTML-Marker** (`mapboxgl/maplibregl.Marker`, Element gebaut+gestylt via NEU **`ui/js/sign_dom.js`** → `window.__rzSignDomBuild/Style/ZoomScale`). Live-Updates am stehenden Element = **kein Flackern** (kein addImage-Re-Upload). Kamera steht beim Editieren → **kein Schwimmen**. `_animSignsAttachDOM`, `_animSignsApplyDOM` (Change-Detection: nur display/opacity/scale bei Wechsel schreiben — sonst Jank), `_animSignsUpdateInPlace` (nur im DOM-Modus). Klick öffnet Editor via DOM-`click`-Listener am Wrap (kein `queryRenderedFeatures` mehr).
  - **GPU-Modus (Probelauf/Export/Ruhe):** der bestehende **Symbol-Layer mit Canvas-Bild** (`sign_draw.js` → `addImage`) — flüssig wie die Foto-Pins, **kein Schwimmen**. `_animSignsAttachGPU`, `_animSignsApplyGPU` (= `__rzSignFrame`).
  - **Dispatch:** `_animSignsAttachToMap`/`_animSignsApplyMarkerAnchor` verzweigen nach `_animSignEditMode`. Umschaltung in `_animSignsOpenEditor` (→DOM, `editMode=true`+reattach) / `_animSignsCloseEditor` + `window.__rzAnimSigns.beginPreview()` (→GPU). `_animSignsDetach` räumt BEIDE (Marker + Layer/Images).
  - **WICHTIG (Mapbox-Marker-Fallen):** (a) am Wrap **kein** `position`/`transform` setzen — Mapbox nutzt das selbst zur Positionierung; die Zoom-Skalierung läuft am INNEREN `.rz-sign`-Element (`__card`). (b) Marker-Anker `bottom`: der Wrap reserviert unten `padding-bottom` = Höhe der Dekoration (Sprechblasen-Spitze/Pfosten), damit die Spitze am Geo-Punkt sitzt und nicht „unter" dem Anker verschwindet.
  - **`beginPreview` (window.__rzAnimSigns):** Force-Modi (`_animSignForceIdx`, `_animSignsPreviewAll`) leben im Schild-Scope → von `runTimelinePreview` (anderer Scope) NUR über diese Methode zurücksetzbar (direkter Zugriff crasht „Can't find variable").
  - **Render bleibt unverändert GPU** (`core/animator.py`) → Probelauf (GPU) ist WYSIWYG zum Export.
- **v0.9.256 — `decoScale`** (Stangen-Länge, Default 0.5): Faktor der Box-Höhe für Banner-Pfosten/Wegweiser-Stange, in BEIDEN Pfaden (`sign_dom.js` + `sign_draw.js`). Editor-Slider `#se-deco` nur bei `style∈{banner,signpost}` sichtbar (Toggle bei `#se-style`-`change`).
- **v0.9.408 — Sprechblasen-Pfeilrichtung (`calloutDir`: bottom|top|left|right, Default bottom):** eigenes Feld (NICHT das signpost-`direction`, sonst kippten Bestands-Callouts nach „right"). Betrifft NUR `style==="callout"` (Tail-Deko). **`sign_draw.js`** (Canvas → GPU-Vorschau + Render): `tailUp/Left/Right`-Extents erweitern W/H bzw. verschieben `bx/by`, die Tail-Spitze wird an der jeweiligen Box-Kante gezeichnet, und `rzDrawSign` gibt `anchor` (= calloutDir für callout, sonst „bottom") zurück. **`sign_dom.js`** (DOM-Edit-Vorschau): 4 `.rz-sign--tail-{dir}::after`-Dreiecke, `style()` setzt Modifier-Klasse + `padding{Top/Bottom/Left/Right}` + `transformOrigin` auf die Spitzen-Seite; Helfer `__rzSignDomAnchor(o)`. **Anker mitführen:** DOM-Marker `anchor` = `_signMarkerAnchor(sn)` (in `module.js`); da mapbox-`Marker`-Anker nicht in-place änderbar ist, erzwingt `_animSignsUpdateInPlace` bei Anker-Wechsel (`mk.anchor !== …`) einen Full-Rebuild. GPU-Symbol-Layer + Backend-`anim-signs-lyr`: Feature-Property `iconAnchor` + `"icon-anchor":["coalesce",["get","iconAnchor"],"bottom"]` (data-driven — mapbox-gl v3.12 / maplibre 5.4 unterstützen das). Editor: `#se-cdir`-Select (4 Optionen, nur bei callout sichtbar, Show/Hide beim `#se-style`-`change`, in `apply()` gelesen). Backend `signs_for_render` reicht `calloutDir` (validiert) durch. Headless-Geometrie-Test (node-Canvas-Stub) bestätigt Anker + Bildmaße für alle 4 Richtungen.
- **v0.9.269 — `bg:"none"` (transparente Box, Nutzer):** Hintergrund-Picker im Editor hat neben „Auto" eine **„Keine"**-Option (`#se-bg-none`-Button, `data-none`-Flag am `#se-bg`; Save dreistufig `none`/`auto`/Farbe). `bg==="none"` → `boxTransparent` in BEIDEN Zeichenpfaden: in `sign_draw.js` werden Box-**Füllung** und Box-**Schatten** übersprungen (`if(!boxTransparent) ctx.fill()`, `setShadow(!boxTransparent)`), Rahmen/Deko/Bild bleiben; in `sign_dom.js` `background:transparent` + kein `boxShadow`. Zweck: Bild-Schild ohne farbigen Rand → kein „doppelter Rahmen" (Akzent-Band + Rahmen). Render nutzt dieselbe `sign_draw.js` → WYSIWYG automatisch. `bg` läuft bereits via `signs_for_render` (`_sg(s,"bg","auto")`) durch. CSS `.se-auto-btn.on` markiert den aktiven Button.
- **v0.9.270/271 — EINE Farbe statt Akzent+Hintergrund (Nutzer „blick den Unterschied nicht"):** Akzentfarbe (`color`/`#se-color`) **und** der Hintergrund-`Auto`-Knopf (`#se-bg-auto`) sind **aus dem Editor entfernt**. Es bleibt EIN Box-/Flächen-Farbpicker `#se-bg` + `#se-bg-none` („Keine"). Der Picker wird mit der **wirksamen** Farbe initialisiert: `bgResolved = (bg gesetzt) ? bg : (style∈{banner,signpost,plain} ? color : "#15171c")` — legacy `bg:"auto"` wird also nur noch zur Anzeige aufgelöst und beim ersten Speichern zu einer konkreten Farbe gebacken (Save: `bg = none ? "none" : se-bg.value`, **kein `color`/`auto` mehr**). `color` bleibt im Datenmodell nur als Fallback-Default fürs Auflösen. **Pin-Tropfen folgt `boxFill`** (nicht mehr `accent`): `sign_draw.js` (`ctx.fillStyle = boxTransparent ? "#15171c" : boxFill`), `sign_dom.js` (Pin-SVG `fill="var(--rz-box)"`). Rendering unverändert kompatibel (boxFill-Resolver mit Style-Default-Fallback war schon da). **Textfarbe** behält ihren `Auto`-Knopf (= automatischer Kontrast, anderer Zweck).
- **v0.9.259 — `timeAnchor` manuell setzbar** (löst Hin-und-zurück-Mehrdeutigkeit): Editor-Block „Auslöse-Zeitpunkt" → `#se-ta-set` setzt `sign.timeAnchor = _animPhotosMarkerAnchor(scrubber)`, `#se-ta-auto` löscht ihn. `timeAnchor` hat **schon immer** Vorrang vor der Positions-Anker-Berechnung — Vorschau (`_animSignsAttach*`/`UpdateInPlace`: `typeof sn.timeAnchor==="number" ? … : _animSignAnchorForLngLat`) UND Render (`core/animator.py`: nach `compute_track_anchors` überschreibt `_s["track_anchor"]=float(timeAnchor)`). Foto-Schilder setzen `timeAnchor` automatisch aus der Aufnahme-Zeit; manuelles Verschieben löscht ihn (`delete _moved.timeAnchor`).

**Alpha-Channel-Pipeline (v0.4):**

Bei `cfg.transparent_background=True` läuft eine **separate Render-Variante**:

- HTML enthält **keine Mapbox-Map** mehr. Stattdessen ein top-level
  `<svg>`-Element mit aspect-locked Projektion der Track-Bbox (kein
  Mercator-Korrekturfaktor — bei Track-typischen Bboxes <1% Fehler).
- Identische JS-API (`window.isReady`, `window.advanceFrame`,
  `window.waitForRender`) → `render()` muss keinen Sonderpfad nehmen.
- Playwright-Screenshot: `omit_background=True` → PNG mit transparentem
  Hintergrund.
- ffmpeg statt H.264/H.265 in MP4 jetzt:
  ```
  -c:v prores_ks -profile:v 4 -pix_fmt yuva444p10le -vendor ap10
  ```
  (ProRes 4444 mit 10-bit Farbe + Alpha, Apple-Vendor-ID damit auch
  strengere NLEs nicht meckern; Output ist `.mov` statt `.mp4`).
- Mapbox-Terrain-Wait (3s) wird übersprungen.
- `mapbox_token` muss leer sein dürfen — kein Token-Check im Alpha-Modus.

**Punkte-Dichte (v0.4):**

`AnimatorConfig.point_density` ∈ `"low"|"medium"|"high"|"max"` → wird im
`render()` zu Downsample-Target gemapped:
```python
density_map = {"low": 100, "medium": 250, "high": 500, "max": 10_000_000}
```
Default `"medium"` (250) statt früher 500 — spürbar schneller, Track
sieht für normale Touren identisch aus.

**Render-Phasen** (gezeigt in `on_progress` 0.0–1.0):
1. `0.00` GPX laden
2. `0.02` Karte initialisieren
3. `0.05` Karte bereit
4. `0.05–0.92` Frame-für-Frame-Rendering
5. `0.92–1.00` ffmpeg `+faststart`-Finalize *(siehe Gotcha unten)*

**Gotcha — ffmpeg `+faststart`:**
Nach allen Frames lädt ffmpeg die `moov`-Atom-Tabelle vom Datei-Ende an den Anfang ("faststart"). Bei großen Files **bleibt die Dateigröße konstant**, während die Datei in-place neu geschrieben wird. Das sieht wie ein Hänger aus, ist keiner. Erst nach **mehreren Minuten ohne `mtime`-Update + 0% CPU bei ffmpeg** darf man killen. Siehe auch `~/.claude/projects/-Users-docarzt-Claude-Masterblaster-GPX/memory/howto_gpx_render_not_hung.md`.

**Frame-Generierung:**
- Playwright (chromium-headless-shell) lädt HTML mit Mapbox GL JS
- 60 × 0.5 s Warten auf `window.isReady()` (Map + Style geladen)
- 3 s zusätzliches Sleep für Terrain-Tile-Loading
- Pro Frame: `window.advanceFrame(idx, bearing, lon, lat, zoom, pitch)` → `waitForRender()` → `page.screenshot(type="png")` → `ff.stdin.write(...)`
- Standard-Encode-Settings: `libx264 -preset medium -crf 20 -pix_fmt yuv420p -movflags +faststart`

**Drei-Phasen-Render-Loop (seit v0.9.59):**
Total-Frames = `(intro_s + duration_s + hold_s) * fps`. Pro Frame wird die Phase
ermittelt:

| Phase | Frame-Range | Marker auf Track | `timeline_progress` für KFs |
|---|---|---|---|
| **INTRO** | `0..intro_frames` | `_start_idx` (steht still) | linear `0 → _trim_start` |
| **ANIM** | `intro_frames..intro+anim_frames` | walkt `_start_idx → _end_idx` | linear `_trim_start → _trim_end` |
| **HOLD** | `intro+anim_frames..total_frames` | `_end_idx` (steht still) | linear `_trim_end → 1.0` |

KFs sind über die GESAMT-Track-Achse (0..1) verankert. Während der Intro-Phase
laufen also KFs im `[0, _trim_start]`-Range durch (= Anlauf-Setup), während ANIM
die KFs im Render-Bereich, während HOLD die KFs `[_trim_end, 1.0]`.

`render_start_anchor` + `render_end_anchor` (Track-Position, 0..1 vom realen
GPX-Track) cutten den Marker-Walk-Bereich. `intro_s` + `hold_s` sind die
ZEIT-Bestandteile. UI-Visualisierung: Trim-Handles werden visuell auf die
Anim-Region `[ti, tf]` der Timeline skaliert (`ti = intro/total`, `tf = (intro+dur)/total`).
Intro-Region rendert links (hellblau), Hold-Region rechts (orange).

**Multi-Track-Render — isolierter Pfad `_render_multi(...)` (seit v0.9.156):**

Mehrere Touren in einem Video laufen über eine **komplett getrennte
Coroutine** `_render_multi(cfg, emit, push_preview, check_cancel)`. Der
bewährte Single-Track-`render()` bleibt dadurch **byte-identisch** — keine
Risiko-Regression für den 99%-Fall.

- **Aktivierung:** `render()` dispatcht ganz am Anfang:
  ```python
  if getattr(cfg, "tracks", None) and len(cfg.tracks) >= 2:
      return await _render_multi(cfg, emit, push_preview, check_cancel)
  ```
  Bei <2 Touren passiert nichts — Single-Track-Pfad wie immer.
- **Datenmodell:** `AnimatorConfig.tracks: list` (Default `[]`) +
  `fly_duration_s: float = 3.0`. Jedes Listen-Element:
  `{gpx_path, line_color, name}`. `_render_multi` parst jede Tour via
  `core_parse_gpx`, downsampled mit `cfg.point_count`, überspringt Touren
  mit <2 Punkten.
- **HTML-Template:** `_make_html(..., tours=[{coords, color}])` emittiert bei
  ≥2 Touren N separate **`mtrack{i}`**-Sources + shadow/glow/line/highlight-
  Layer (statische Farb-Literale pro Tour). Die normale `track`-Source bleibt
  leer/unsichtbar. Neue JS-Helper im Template:
  - `window.advanceFrameMulti(tourIdx, localIdx, brg, lon, lat, zm, pt, showDot)`
    — zeichnet Touren `< tourIdx` voll, `== tourIdx` gesliced bis `localIdx`,
    `> tourIdx` leer; setzt Dot; `updateOverlays(TOUR_OFFSETS[tourIdx]+localIdx)`.
  - `window.fitTourView(coordsJson)` — `map.cameraForBounds(...)` →
    `{center, zoom}` für den Per-Tour-Blick.
- **Frame-Budget:** `intro_frames + Σ walk_frames_i + (N−1)·fly_frames +
  hold_frames`. `walk_frames_i` proportional zur Punktzahl der Tour.
  Segment-Maschine: `("intro",0,n)` / `("walk",i,n)` / `("fly",i,n)` /
  `("hold",last,n)`.
- **Kinoflug:** zwischen Tour `i` und `i+1` interpoliert
  `_van_wijk_interp(c1, c2, z1, z2, t)` (in `core/timeline.py`, rho=1.42) eine
  gekoppelte Center+Zoom-Kurve (rauszoomen → schwenken → reinzoomen);
  `t` über `_smoothstep(f/(seg_n-1))` geglättet. Während des Flugs ist der Dot
  aus (`showDot=false`).
- **Durchgehende Overlays:** kombinierte `cum_dist`/`cum_time`-Arrays über
  alle Touren (Distanz/Zeit wachsen tour-übergreifend weiter). `TOUR_OFFSETS`
  = kumulative Index-Basen in das kombinierte Punkte-Array. `total_stats`
  summiert Distanz/Dauer/Anstieg/Abstieg.
- **Phase-1-Einschränkung:** Foto-Pins im Multi-Modus deaktiviert
  (`cfg.photos=[]` rund um den `_make_html`-Call, im `finally` restauriert).
- **UI-Seite:** modul-lokaler State `_extraTours` in
  `modules/animator/ui/module.js` (KEIN Eingriff in die globale `gpx-bar.js`).
  Die global geladene GPX ist implizit „Tour 1". Live-Kartenvorschau zeichnet
  pro Extra-Tour eine farbige Linie (`_animDrawExtraToursPreview`), Refit über
  alle Touren (`_animFitAllTours`). Render-Params liefern `tracks` +
  `fly_duration_s` nur wenn `_extraTours.length > 0`.
- **Tour-Map:** Multi-Track ist dort noch nicht umgesetzt (Phase 2, dann per
  geteiltem Helper gemäß Spiegelungs-Regel).

**WYSIWYG-Zoom-Korrektur (v0.9.157) — Render-Zoom == Preview-Zoom:**

Mapbox-Zoom ist **relativ zur Viewport-Pixelbreite**: bei Zoom z zeigt eine
800-px-Preview einen anderen Geo-Ausschnitt als ein 1920–7680-px-Render bei
demselben z. `correctedZoom(map,W,H)` (in `ui/js/util.js`) korrigiert das für
einen einzelnen Zoom mit `+ log2(renderW/previewW)`.

- **Bug bis v0.9.156:** Der Render reproduzierte den **rohen** Preview-Zoom
  (`value_absolute`) ohne diese Korrektur — in BEIDEN Modi. Im KF-Modus wurde
  `correctedZoom` nie angewandt; im Classic-Modus hob die implizite Default-KF
  (`value_absolute = Slider-Zoom`) den `override_zoom`-Korrekturwert wieder auf
  (`frame_zoom = fit_base + (value_absolute − fit_base) = value_absolute`).
- **Fix:** Das Frontend sendet pro Render **einen** Delta-Wert
  `zoom_correction = correctedZoom(map,W,H) − map.getZoom() = log2(min(W/pw,
  H/ph))` (zoom-unabhängig, gilt für alle KFs). Der Render bildet
  `abs_shift = zoom_correction − log2(dsf)` (CSS-Viewport = `size/dsf`) und
  reicht ihn als `zoom_abs_shift` an `interpolate_properties(...)` durch.
  `_zoom_effective_offset` liefert dann `(value_absolute + abs_shift) −
  fit_zoom_base`, sodass `frame_zoom = fit_zoom_base + offset = value_absolute
  + abs_shift`. **`fit_zoom_base` kürzt sich raus → padding-unabhängig**,
  numerisch identisch zum bewährten Classic-`override_zoom`-Pfad. `abs_shift=0`
  (kein Wert / alte Projekte) = unverändertes v0.9.73-Verhalten.
- **Classic = 2 hidden KFs (v0.9.157):** Der alte `override_center`/
  `override_zoom`-Sonderpfad ist abgeschafft. `getEffectiveEvents()` liefert
  weiterhin 2 implizite KFs (`buildDefaultEvents`); beim Render snapshotted das
  Frontend die aktuelle Preview-Kamera (center bei Nicht-Track-Folgen, pitch,
  zoom `value_absolute = map.getZoom()`) in diese KFs. `override_*` wird `null`
  gesendet → Backend-Map-Init = bounds-fit, jeder Frame setzt Center/Zoom eh
  explizit aus den KFs. Ein einziger Render-Pfad für beide Modi.
- **Preview** bleibt unverändert (`_zoomEffectiveOffset` = `value_absolute −
  previewFitBase` → zeigt `value_absolute` im Preview-Viewport). Render zeigt
  `value_absolute + correction` im Render-Viewport = **dieselbe Geo-Framing**.
- **Tour-Map** hat keinen Per-Frame-KF-Pfad (statische PNG) und nutzt
  `correctedZoom` direkt für seinen einen Zoom — daher hier keine Spiegelung
  nötig.

**Track-Linien-Dicke = Preview (v0.9.158):** `line-width` ist CSS-px; der
Render-CSS-Viewport (`W/dsf`) ist breiter als die schmale Preview → gleiche
px-Linie wirkt relativ dünner (v.a. 4K). Frontend skaliert den `line_width`-
Render-Param mit `lineScale = 2^zoom_correction / dsf` (= Viewport-Ratio in
CSS-px, linearer Zwilling der log-Zoom-Korrektur). Glow/Schatten sind
`cfg.line_width * k` → skalieren proportional mit. Slider/Preview behalten den
Roh-Wert (nur der Render-Param wird skaliert). Dot-Radien noch fix.

**Codec / Pixelformat (v0.9.158):** h264/h265 rendern als **`yuv420p`** (High-
Profil), NICHT 4:4:4 — Apples AVFoundation/WKWebView kann H.264 High-4:4:4-
Predictive / H.265 main444 **nicht decodieren**, sonst bleibt das `<video
id="anim-video">` im Result-View (und QuickTime) schwarz. `hvc1`-Tag für H.265.
4:4:4-Farbtreue gibt's über den **ProRes**-Codec (Editing-Master, `yuv444p10le`
/ `yuva444p10le` für Alpha). Regel: h264/h265 = Deliverable/Preview (420),
ProRes = Master (444).

#### Render-Frame-Erfassung: JPEG statt PNG (v0.9.245) — ~10× schneller

Messung (`scripts/render_timing.py` + env `RZ_RENDER_TIMING=1`, das in der Frame-Schleife pro Phase `time.perf_counter()` summiert und am Ende einen Report loggt) ergab: **`page.screenshot(type="png")` war 96 % der Render-Zeit** (2349 ms/Frame @4K, M1 Max). GPU ist echtes Metal (kein SwiftShader), Tile-Warten 0,1 %, `waitForRender` 3,5 %. ⇒ Der OSM-/Tile-Cache-Gedanke bringt für Render-Speed nichts; der Flaschenhals ist das Abgreifen+Übertragen des Bildes über CDP.

**Fix:** Helper `_grab_frame(page, cfg)` greift den Frame je nach `cfg.frame_format`:
- `transparent_background` (Alpha) → **immer PNG** (JPEG kann kein Alpha).
- sonst `frame_format=="jpeg"` → `screenshot(type="jpeg", quality=cfg.jpeg_quality)` (q92 ≈ 16× schneller, ~147 ms/Frame).
- sonst PNG.

ffmpeg's `image2pipe`-Demuxer erkennt JPEG vs PNG automatisch. **Wichtig:** JPEG ist Full-Range → der h264/h265-Builder bekommt bei JPEG ein `-vf scale=in_range=full:out_range=tv`, damit der Output exakt `yuv420p`/`color_range tv` ist wie bei den bisherigen PNG-Renders (sonst `yuvj420p` = leichte Farbverschiebung). Gilt im **Single- und Multi-Track-Pfad** (beide `_grab_frame` + beide ffmpeg-Builder; `-preset` jetzt `cfg.encoder_preset`).

Neue `AnimatorConfig`-Felder: `frame_format` ("jpeg"|"png"), `jpeg_quality` (1–100), `encoder_preset`.

#### Supersampling (SSAA) gegen 4K-Flimmern (v0.9.286)

**Problem:** Marc meldete „leichtes Flimmern" in 4K-Videos („wie falsche Belichtungszeit bei Kunstlicht"). Isolations-Test (3× Screenshot eines exakt statischen Satelliten-Views) ergab **0,000 % Diff, bit-identisch** → der Render ist deterministisch, **kein** Render-Bug. Ursache = **Bewegungs-Aliasing**: feines Satelliten-Detail „kriecht" beim Kamera-Schwenk übers Pixelraster (klassisches Texture-Shimmer), bei 4K besonders sichtbar, weil dort das volle Detail 1:1 gezeigt wird.

**Zwei Gegenmaßnahmen:**
1. **`raster-fade-duration: 0`** (im `style.load`-Handler über alle Raster-Layer): schaltet den ~300 ms-Cross-Fade neu geladener Satelliten-Kacheln ab. Der Konstruktor-Param `fadeDuration:0` steuert nur Label-Fade, **nicht** Raster-Fade — daher der explizite Per-Layer-Loop. Beim Frame-für-Frame-Render traf sonst jeder Frame die Überblendung in anderem Mischzustand.
2. **Karten-Tiefpass (v0.9.286b, der eigentliche Flimmer-Killer):** ein dezenter
   `filter: blur(~1.3 Output-px)` liegt im ersten HTML-Template **nur** auf `#map canvas`
   (= WebGL-Satellit + Track-Linie), NICHT auf den Overlay-DOM-Geschwistern oder den
   `.mapboxgl-marker`-Foto-Pins. Marcs Befund war „zu scharf" — genau die hochfrequente
   Satelliten-Textur, die beim Schwenk „kriecht". Der Blur ist der optische Tiefpass
   (Anti-Moiré). Wert: in CSS-px = Ziel-Output-px / `_render_dsf` (CSS-blur wird im Capture
   `×dsf×ss`, nach `/ss`-Downscale `×dsf` → Output). Nur bei 4K (`_render_ss>1`). Text/Zahlen
   bleiben gestochen scharf, weil sie eigene DOM-Schicht sind. Der alpha-Modus (`_make_html_alpha`,
   transparent, „Ohne Karte") bekommt **keinen** Blur — kein Satellit.
   **Einstellbar** über `AnimatorConfig.map_smoothing` (Output-px, Default 1.3, 0 = aus) →
   UI-Regler „Karte glätten" (`anim-map-smoothing`) in den Video-Einstellungen, persistiert
   als Modul-Setting `map_smoothing`, im Render-Params-Objekt + `app.py`-Bridge (beide Pfade)
   durchgeschleift. Reiner Render-Param (keine Live-Preview — greift nur im 4K-Export).
3. **SSAA via `_render_ss(width, height)`** (gibt `1.25` ab längster Kante ≥ 3840 px, sonst `1.0`; früher `1.5` — runter, weil der Karten-Tiefpass die Hauptarbeit macht): Der Browser läuft mit `device_scale_factor = _render_dsf × _render_ss`, der CSS-Viewport (`W/_dsf × H/_dsf`) bleibt **unverändert**. Dadurch ist der Screenshot `SS×` größer als die Zielauflösung (4K → Capture 4800×2700). `_grab_frame` / `_downscale_frame` skalieren ihn per **`Image.BOX`** (Area-Averaging = korrekter SSAA-Resolve **und** schneller als Lanczos; Lanczos überschwingt/schärft sogar → kontraproduktiv gegen Shimmer) auf `cfg.width × cfg.height` runter. Sorgt für saubere Kanten an Track-Linie & Co.

**WYSIWYG bleibt exakt:** Eine `3.5`-CSS-px-Linie wird `3.5 × _dsf × SS` Device-px im Capture, nach `1/SS`-Downscale wieder `3.5 × _dsf` Output-px — identisch zum Nicht-SSAA-Pfad, weil der CSS-Viewport (der die Linienbreite bestimmt) gleich bleibt. Der Downscale kompensiert sich mathematisch raus.

**Frame-Format unter SSAA — WICHTIG (Perf-Falle, v0.9.286b):** `_grab_frame` greift den Screenshot im **normalen schnellen Format** (JPEG bleibt JPEG) und skaliert erst danach runter. Ein früher Versuch, unter SSAA verlustfrei als PNG zu greifen, machte 4K **~16× langsamer** (`page.screenshot(type="png")` ist lt. Messung ~16× teurer als JPEG) — die doppelte JPEG-Kompression (q92 → Downscale → q92) ist nach dem Verkleinern unsichtbar, der PNG-Grab dagegen tödlich. NIE auf PNG umschalten nur für SSAA.

**Spiegelung:** `core/tourmap.py` (`render_png`) nutzt dieselbe `_render_ss`-Logik — beim statischen 4K-Standbild gibt's kein Bewegungs-Aliasing, aber SSAA glättet das feine Detail trotzdem (schärferes Still). Dort wird der Screenshot bei `_ss>1` zu Bytes gegriffen, per PIL/Lanczos runterskaliert und geschrieben statt direkt `path=`. **Kein** Karten-Blur im Tour-Map — ein Standbild soll scharf sein.

**Perf-Hinweis:** SSAA bei 4K = **1,56× Render-Pixel** (SS=1.25) → Screenshot (eh 96 % der Render-Zeit) wächst entsprechend + `Image.BOX`-Downscale pro Frame (~80 ms @4K). Bewusst niedrig gehalten, weil der **Karten-Blur** die Haupt-Anti-Flimmer-Arbeit macht (GPU-günstig, kostet kaum Zeit) — so bleibt 4K erträglich. Verlauf: erst SS=1.5 (zu langsam: „brutaaaaal"), dann SS=1.25 + Blur.

#### Globale Render-Qualität (Settings statt Sidebar, v0.9.245)

`DEFAULT_SETTINGS["render"]` (top-level in `app.py`): `frame_format/jpeg_quality/codec/crf/encoder_preset`. Der Settings-Dialog **„Qualität & Export"** (`ui/js/app.js openSettingsModal`, gespeichert per `saveSettings({render:…})`) ist die einzige UI dafür. Die Render-Bridge liest sie server-seitig (`_load_settings().get("render")`) und setzt `cfg` — das **Codec-Dropdown ist aus der Animator-Sidebar entfernt**; Alpha (Stil „Ohne Karte") erzwingt weiter ProRes. (Der Höhen-Animator hat noch seinen eigenen Codec im `core/heightanim.py`-Pfad — offener Follow-up.)

### `core/timeline.py` (v0.7.0)

Event-System für den Animator. Aktuell unterstützt: Camera-Keyframes
(Pitch / Bearing / Zoom-Offset / optional `center`). Vorbereitet
für Photo-Inserts und Text-Overlays über das gemeinsame `kind`-Feld
im persistierten Schema — derselbe `timeline_events`-Array hält
später alle Event-Typen.

**Datenmodell:**
```python
@dataclass
class CameraKeyframe:
    anchor: float          # Seit v0.8.11: TIMELINE-Anteil (anim + hold),
                           # 0.0 = Render-Start, 1.0 = Render-Ende inkl. Hold
    pitch: float           # Grad, typ. 0 (top-down) bis 85 (max-tilt)
    bearing: float         # Grad, beliebig (mod 360, shortest-arc interpoliert)
    zoom_offset: float     # rel. zum auto-fit-zoom, typ. -3..+3
    center: list | None    # v0.8.7: optional [lon, lat] für freie Karten-Position
                           # None = Track-Folgen-Modus (Default)
    easing: str = "linear" # v0.7.0 nur linear; ease_in/out/in_out geplant für v0.9
```

Persistiert wird als dict mit `kind: "camera"` + den Feldern. Beim
Laden filtert `keyframes_from_events()` per `kind`-Feld, ignoriert
Photo/Text-Events (die kommen später).

**Hauptfunktion:**
```python
interpolate_camera(
    events: Iterable[dict] | None,
    progress: float,              # 0.0–1.0 (Timeline-Position)
    default_pitch: float,
    default_rotation: float,
    default_bearing_start: float = -10.0,
) -> tuple[float, float, float, list | None]
# (pitch, bearing, zoom_offset, center_or_None)
```

Verhalten:
- **Leere Events** → Legacy-Sweep (statischer Pitch + linearer
  Bearing von `default_bearing_start` nach `+ default_rotation`).
- **1 Keyframe** → konstant.
- **Vor/nach Endpunkten** → erster/letzter Keyframe-Wert konstant
  (kein Extrapolieren).
- **Zwischen 2 Keyframes** → stückweise Lerp, Bearing via shortest-arc
  (vermeidet 350°-Drehung wenn -10° gemeint war), `center` ebenfalls
  lerp wenn beide Endpunkte ein `center` haben.

**Im Render-Loop** (`core/animator.py`, seit v0.8.11):
```python
# Track-idx läuft nur in der Anim-Phase, klemmt am Ende.
if frame < anim_frames:
    idx = min(int(frame * coords_per_frame), len(points) - 1)
else:
    idx = len(points) - 1
# Anchor = TIMELINE-progress (über anim + hold), NICHT track_progress —
# damit Keyframes auch in der Hold-Phase Kamera-Bewegung steuern können.
timeline_progress = frame / max(1, total_frames - 1)
pitch_f, bearing, zoom_off, kf_center = _timeline.interpolate_camera(
    cfg.timeline_events, timeline_progress,
    default_pitch=cfg.pitch,
    default_rotation=cfg.rotation,
)
frame_zoom = zoom + zoom_off
# kf_center hat Vorrang über Track-Punkt (v0.8.7: freie Karten-Position).
frame_lon = kf_center[0] if kf_center else center[0]
frame_lat = kf_center[1] if kf_center else center[1]
await page.evaluate(
    f"window.advanceFrame({idx}, {bearing}, {frame_lon}, {frame_lat}, {frame_zoom}, {pitch_f})"
)
```

**Anchor-Semantik (⚠️ Breaking Change v0.8.10 → v0.8.11):**
- **Bis v0.8.10:** Anchor = Track-Anteil (`idx / len(points)`). In der
  Hold-Phase blieb der Anchor auf 1.0 geklemmt → Kamera fror auf dem
  letzten Keyframe ein.
- **Ab v0.8.11:** Anchor = Timeline-Anteil
  (`frame / total_frames`, mit `total_frames = anim_frames + hold_frames`).
  Damit kann der User in der Hold-Phase Keyframes setzen — Track-Endpunkt
  steht still, aber die Kamera interpoliert weiter (z.B. „am Ende auf
  die ganze Route rauszoomen").
- **Migration:** Bestehende Projekte werden bei UI-Load einmalig via
  `migrateTimelineAnchorsIfNeeded()` umskaliert: `new_anchor =
  old_anchor * dur / (dur + hold)`. Flag `timeline_anchor_v: 2` im
  Animator-Settings-Block markiert migrierte Projekte (idempotent).
  Bei Projekten mit `hold_s=0` ist `track_fraction=1.0` → keine
  Skalierung nötig, Anker bleiben identisch.

**Frontend-Spiegelung:** `ui/js/timeline.js` enthält eine JS-Version
von `interpolate_camera()` (`interpolateCameraJs()` im
`modules/animator/ui/module.js`). Synchron zur Python-Implementation
halten! Beide implementieren shortest-arc, `center`-Interpolation und
die gleiche Easing-Tabelle. Hilfsfunktion `trackIdxFromTimelineAnchor()`
mappt Timeline-Anker (für `scrubPreview`, `runTimelinePreview`,
`rebuildCameraKeyframePins`) auf den entsprechenden Track-Index.

### Welt-Drehung — abgewickelter Längengrad (Insta360-Modell, v0.9.136)

**⚠️ Breaking gegenüber v0.9.107–v0.9.135.** Die Welt-Drehung war bis
v0.9.135 eine **eigene Keyframe-Spur** (`kind: "rotation"`) mit eigenem
Slider — zusammen mit der `position`- und `center`-Spur drei sich
überlappende Steuerungen, die sich gegenseitig „verheddern" konnten
(Marc: „kommen 270° oder 400° durcheinander?"). Ab v0.9.136 ist die
Drehung **im abgewickelten Längengrad** der `center`-Position kodiert —
ein einziger Freiheitsgrad, wie bei der Insta360.

**Datenmodell:**
- `center.value = [lng, lat]`, wobei `lng` **abgewickelt** ist: Werte
  über ±180° kodieren volle Erd-Umdrehungen. `lng=370` = eine Umdrehung
  + Landung auf Längengrad 10. Mapbox normalisiert beim Rendern selbst.
- Die `rotation`-Spur ist **ersatzlos entfernt** aus `KF_LANES`
  (`["pitch","bearing","zoom","center","position"]`), `LANES` +
  `KF_KINDS` in `ui/js/timeline.js`, allen Handlern, und der
  Interpolation (`interpolate_properties` returnt jetzt ein **6-Tupel**
  mit `rotation=None`; `core/animator.py` nutzt `frame_lon =
  kf_center[0]` direkt ohne Rotations-Aufschlag).
- **NO MIGRATION** (Marc-Regel, frühes Stadium): Alte Projekte mit der
  alten `rotation`-Spur **laden** ohne Crash (die `rotation`-Events
  werden beim Filtern ignoriert), müssen aber nicht funktionieren. Kein
  Backwards-Compat-Code.

**Drag-Akkumulation (UI, `modules/animator/ui/module.js`):** Damit der
Längengrad beim Karten-Ziehen über die ±180°-Datumsgrenze sauber
weiterzählt statt zurückzuspringen, akkumulieren wir echte Mapbox-Drags:
- State `_lngAccum` (abgewickelter Wert) + `_lngAccumPrev` (letzter
  gewrappter Wert). Helfer: `_wrapLng(l)` (→ [−180,180)),
  `_seedLngAccum(lng)`, `_trackLngAccumFromMap()`.
- Listener: `map.on("dragstart", …)` seedet, `map.on("drag",
  _trackLngAccumFromMap)` misst gewrappte Deltas, erkennt ±180°-Sprünge
  (±360-Korrektur) und summiert auf.
- **Programmatische Moves** (`jumpTo`/`easeTo`/`setCenter`) feuern **kein**
  `drag`-Event → verfälschen den Akku nicht. Nach jedem programmatischen
  Sprung wird **re-seeded** (`scrubPreview`, `step`, `_applyKfCenter`,
  Welt-Button), damit der nächste User-Drag korrekt weiterzählt.
- `snapshotKeyframe` übernimmt den akkumulierten Wert wenn der gewrappte
  Akku zum aktuellen Karten-`lng` passt (Toleranz 0.01°).

**Winding-Entkopplung von van-Wijk** (gespiegelt in JS
`_maybeFlyToInterp` und Python `_maybe_flyto_interp`): Der van-Wijk-
Smooth-Zoom/Pan-Algorithmus (rho=1.42) arbeitet in Web-Mercator-[0,1]-
Koordinaten und darf **nicht** die rohe Multi-Turn-Differenz als
geografische Distanz sehen — sonst projiziert `_mercX(370°)` weit
außerhalb [0,1] und die Kurve will absurd weit rauszoomen (= „Wildflug").
Daher:
```
lonAW    = _wrapLng(lonA)          # gewrappter Start
baseOff  = lonA - lonAW            # ganze Drehungen im Start
rawD     = lonB - lonA            # rohe Differenz (kann >360 sein)
shortest = _wrapLng(rawD)          # geografische Kurz-Distanz ∈[-180,180)
winding  = rawD - shortest         # volle Drehungen (Vielfaches 360)
# van-Wijk bekommt NUR die echte Geo-Distanz:
mcA = merc(lonAW);  mcB = merc(lonAW + shortest)
… van-Wijk interpoliert (mcA, mcB, zoomA, zoomB, t) → result …
lng = _mercXInv(result) + baseOff + winding * t   # Drehungen linear obendrauf
```
Damit dreht sich die Welt gleichmäßig **während** des Flugs und landet
bei t=1 exakt auf `lonB` (Insta360-Verhalten), während Zoom/Pan sauber
bleiben. Der nicht-flyto-Pfad (`_interpolate_center_property` /
`_interpCenter`) lerpt `lng` ohnehin linear → Winding ist dort
automatisch korrekt.

**Analytisch verifiziert** (`core/timeline.py` direkt aufgerufen):
`lng 10→370` (zoom_offset 0→6) landet monoton steigend exakt auf 370;
`lng 10→380` trennt 10° echten Geo-Pan sauber von +360° Winding.

**Scope:** Welt-Drehung ist **Animator-only** — die Tour-Map ist ein
statisches PNG (kein Bewegungsmodell). Die sonst geltende
Animator↔Tour-Map-Spiegelung greift hier also nicht; `core/tourmap.py`
und `modules/tourmap/` bleiben unangetastet.

### `core/sessions.py` (v0.8.0)

Track-gebundenes Session-System. Jeder GPX-Track bekommt einen Hash
(SHA1 über gerundete Koordinaten) und damit eine eigene Session unter
`<user-data>/sessions/<track_hash>/`.

> **v0.9.380 → v0.9.382 (ZURÜCKGENOMMEN):** Kurzzeitig floss der Datei-Basename
> mit in den Hash (`compute_track_hash(coords, name)`), damit Umbenennen ein
> neues Projekt ergibt. Das brach jedoch, weil `session_open_for_track` pro Load
> **mehrfach** aufgerufen wird — teils mit `gpx_path`, teils ohne (Geotagger-Drop)
> → **zwei Sessions für denselben Track**, Speicher-Ziel (Tour-Map) und Render-
> Quelle (aktives Projekt) drifteten auseinander → „Aus Geotagger" zeigte nichts.
> Seit v0.9.382 wieder **reiner Koordinaten-Hash** (stabil, ein Track = eine
> Session). Der `name`-Parameter von `compute_track_hash` bleibt optional
> vorhanden, wird aber nicht mehr befüllt. „Umbenennen = neues Projekt" später
> über einen expliziten Button, nicht über den Hash.

Eine Session enthält:
- `gpx.gpx` — Snapshot der Original-GPX (für späteres Wiedereinladen)
- `projects.json` — Liste von Projekt-Varianten, jedes mit eigenem
  `animator`-/`tourmap`-/`geotagger`-Settings-Block.

**API** (alle in `app.py` als Bridge-Methoden exposed):
- `session_open_for_track(coords, gpx_path)` → erstellt/findet Session
- `session_create_project(track_hash, name, copy_from=None)` → Projekt anlegen
- `session_set_active_project(track_hash, project_id)` → aktivieren
- `session_delete_project`, `session_rename_project`,
  `session_update_project_settings(track_hash, project_id, module, patch)`

Frontend: `ui/js/util.js` hat die Wrapper `sessionActivate`,
`projectCreate/Delete/Rename/SetActive`, `saveProjectSettings`,
`bindSetting` (liest aus aktivem Projekt mit Fallback auf
`settings.json`), `rebindAllSettings` (re-bindet alle Settings nach
Projekt-Wechsel). Topbar-UI in `ui/js/projects.js`.

**Wichtige Garantie:** Eine Session hat IMMER mindestens 1 Projekt
(„Standard"). Wenn das letzte Projekt gelöscht wird, wird automatisch
ein neues „Standard" angelegt — sonst gäb's Race-Conditions.

**Eigene Standardwerte für neue Tracks (v0.9.287, Marc-Wunsch):** Neue Sessions
werden via `_project_from_defaults(name, global_defaults)` geseedet; `global_defaults`
kommt aus `Api._session_get_global_defaults()`. Das ist jetzt **`DEFAULT_SETTINGS`
+ `settings.json["user_defaults"]`** (deep-merge pro Modul). Bridges:
- `save_user_defaults(track_hash, project_id)` — nimmt den Look des angegebenen
  aktiven Projekts (Source-of-Truth aus `sessions.json`; Fallback `_load_settings()`
  wenn kein GPX offen) und schreibt `settings.json["user_defaults"]`. Übernimmt **nur**
  Keys, die in `DEFAULT_SETTINGS[modul]` existieren, **minus** einer Blacklist
  track-spezifischer Keys, die zwar in DEFAULT_SETTINGS als Leerwerte stehen
  (`animator`: `timeline_events`, `render_start/end_anchor`, `timeline_anchor_v`,
  `last_save_dir`; `geotagger`: `last_photos_dir/paths`). So vergiftet „Speichern"
  keine neuen Tracks mit Keyframes/Trim/Foto-Pfaden des aktuellen Tracks.
- `reset_user_defaults()` — entfernt `user_defaults` → zurück auf Werk.
- `get_user_defaults_info()` — `{has_custom, modules}` für die Settings-UI.

Bestehende Sessions/Projekte werden NICHT angefasst — der Merge greift nur beim
**Neu-Anlegen** einer Session. UI: zwei Buttons im Settings-Modal (`openSettingsModal`,
`md-save-defaults`/`md-reset-defaults`), wirken sofort (unabhängig von Speichern/Abbrechen).

**Migration alter Projekte** (UI-Schicht):
- v0.8.11: `migrateTimelineAnchorsIfNeeded` (Track-Anker → Timeline-Anker)
- v0.8.12: `migrateTrackStyleToLineStyleIfNeeded` (`track_style="tube"` →
  `line_style="tube"`, da Röhre jetzt einer der Linien-Stile ist)

Beide laufen idempotent via Flag-Felder (`timeline_anchor_v: 2`) bzw.
durch Defensiv-Checks (`track_style === "tube" && line_style !== "tube"`).
Gerufen werden sie aus `applyGlobalGpx` (nach `sessionActivate` →
`rebindAllSettings`) und aus `window._animOnProjectChanged`
(Projekt-Wechsel via Topbar).
Bei Backend-Änderung an einer Stelle die andere mit-pflegen.

---

## 4 · pywebview-Bridge-API

Alles in `class Api` in `app.py`. Aus JS via `window.pywebview.api.<method>(...)`.

### Allgemein

| Methode | Signatur | Zweck |
|---------|----------|-------|
| `get_mapbox_token()` | `→ str` | Liefert Mapbox-Public-Token |
| `pick_file(dialog_type, file_types?, multiple?)` | `→ List[str]` | Native Datei-Dialog (`"open"`, `"folder"`, `"save"`) — auf macOS via `NSOpenPanel` (PyObjC), Fallback auf pywebview's `create_file_dialog` |
| `pick_save_path(default_name, default_dir, file_types)` | `→ str` | Save-As-Dialog (`NSSavePanel` auf macOS), gibt absoluten Pfad oder leeren String bei Cancel zurück |
| `reveal_in_finder(path)` | `→ {ok}` | macOS: `open -R`, Win/Linux: pendant |
| `open_url(url)` | `→ {ok}` | URL im Default-Browser/Default-App öffnen (`open`/`xdg-open`/`startfile`). Auch für `mailto:`-URLs |
| `get_app_info()` | `{ok, name, version, python, app_support, log_path, tour_maps_dir, renders_dir}` | Über-Dialog-Daten + Pfade |
| `prepare_bug_report(context)` | `{ok, to, subject, body, mailto}` | Baut einen vorbefüllten Bug-Report (App-Version + OS + Log-Auszug). UI zeigt das Modal mit Copy-Buttons — funktioniert für Webmail-User OHNE lokales Mail-Programm. mailto-URL als optionaler Bequemlichkeits-Pfad. |
| `playwright_check()` | `{ok, browser_present, browsers_path, version?, executable?, error?}` | Prüft ob Chromium-Headless-Shell für Animator/Tour-Map verfügbar ist |
| `playwright_install_chromium()` | `{ok, log?, error?}` | Lädt Chromium über den gebundelten Playwright-Driver — wird vom UI nach `playwright_browser_missing`-Error angeboten |

### Logging

| Methode | Returns | Zweck |
|---------|---------|-------|
| `get_log_info()` | `{ok, path, exists, size}` | Pfad + Größe der Logdatei |
| `open_log()` | `{ok, path}` | Logdatei im Standard-Texteditor öffnen |
| `reveal_log_in_finder()` | `{ok}` | Logdatei im Finder zeigen |
| `get_log_tail(max_bytes=16000)` | `{ok, path, text, size}` | Letzte ~16 KB als Text (für Inline-Anzeige in Modalen) |

Setup-Modul: `core/logger.py` mit `setup_logging(app_support_dir)`.
Logdatei: `~/Library/Application Support/Reisezoom GPS Studio/logs/app.log`,
`RotatingFileHandler` mit 1 MB Rotation × 5 Backups.

Globale Excepthooks (`sys.excepthook`, `threading.excepthook`) sind installiert
— **alle** ungefangenen Exceptions, auch aus Worker-Threads, landen im Log.

### Animator

| Methode | Returns | Zweck |
|---------|---------|-------|
| `animator_load_gpx(path)` | `{ok, name, coords, bbox, stats}` | Liefert downsampled Coords + Stats |
| `animator_start_render(params)` | `{ok}` | Startet Render in Thread, Polling über `animator_status`. Params seit v0.4: `point_density: "low"|"medium"|"high"|"max"` und `transparent_background: bool` — Letzteres switched die Output-Endung automatisch auf `.mov`. |
| `animator_status()` | `{running, progress, status, output, error, log_path, preview_b64, cancel_requested, cancelled}` | Wird vom UI alle 350 ms gepollt |
| `animator_cancel()` | `{ok}` | Setzt `cancel_requested` → Worker bricht vor nächstem Frame ab |

**Render-Worker:**
- Eigener `threading.Thread` mit eigenem `asyncio.new_event_loop()`
- State in `self._render_state` dict, **nicht** thread-sicher per Lock — aber UI liest nur, Worker schreibt nur, Daten sind klein und konsistent.
- Bei Fehler: `error` enthält Multi-Line-Traceback; UI zeigt Fehler-Modal mit
  Traceback + Logfile-Tail (`get_log_tail()`) + Buttons „Log öffnen" / „Im Finder zeigen".
- **Logging während Render**: Konfiguration einmal komplett bei Start
  (`animator.render`-Logger), Progress nur bei ≥10 %-Schritten ODER neuem
  Status-Text. ffmpeg-stderr wird bei Fehler in den `RuntimeError` gepackt
  und ins Log geschrieben. Chromium-`page.console`/`pageerror` werden ins
  Log gespiegelt → Mapbox-Token-Fehler, WebGL-Errors etc. werden sichtbar.

### Tour-Map (statische PNG)

| Methode | Returns | Zweck |
|---------|---------|-------|
| `tourmap_load_gpx(path)` | `{ok, name, coords, elevations, bbox, stats}` | Wie `animator_load_gpx`, aber mit zusätzlichem `elevations`-Array für die Höhenprofil-Vorschau |
| `tourmap_render(params)` | `{ok, error_code?}` | Startet Render-Thread. `params` inkl. `output_path` (vom Save-Dialog), `override_center`/`override_zoom` (User-Pan/Zoom-WYSIWYG) |
| `tourmap_status()` | `{running, progress, status, output, error, cancelled, cancel_requested}` | Polling-State |
| `tourmap_cancel()` | `{ok}` | Cancel-Flag setzen |

**Konfig**: `core/tourmap.py.TourmapConfig` mit u.a. `override_center: Optional[tuple[float, float]]` + `override_zoom: Optional[float]`. Wenn beide gesetzt sind, baut `_make_html` die Mapbox-Map mit `center + zoom` statt `bounds + fitBoundsOptions` — damit landet der User-gepante Ausschnitt 1:1 im PNG (WYSIWYG).

### Geotagger

| Methode | Returns | Zweck |
|---------|---------|-------|
| `geotagger_load_gpx(path)` | `{ok, name, coords, bbox, n_points}` | Track laden, im Server-State halten |
| **`geotagger_clear()`** | `{ok}` | **Workspace-Clear**: leert `_gtg_track`, `_gtg_stats`, `_gtg_photos`. Settings bleiben unverändert. Wird vom „↺ Workspace leeren"-Button im UI gerufen. |
| **`geotagger_register_photos(paths)`** | `{ok, photos: [{path, name, is_raw}], warning?}` | **Phase 1**: sofortige Registrierung + Worker-Start, gibt nur Basis-Info zurück (kein Thumb!) |
| **`geotagger_poll_thumbs(known_paths)`** | `{ok, deltas: {path: {thumb, photo_time, existing_gps}}, progress: {total, done, running}}` | **Phase 3**: UI pollt regelmäßig, holt nur noch nicht bekannte Updates |
| `geotagger_load_photos(paths)` | `{ok, photos}` | Sync-Load (Fallback) — blockiert bis alles fertig |
| `geotagger_load_photos_from_folder(folder)` | wie `register_photos` | Findet JPG/RAW automatisch im Ordner, geht direkt in Lazy-Pfad |
| `geotagger_match(offset_s, max_gap_s)` | `{ok, matches: [{path, name, lat, lon, alt, track_index, time_delta_s, in_range, ...}]}` | Berechnet Marker-Positionen |
| `geotagger_compute_offset_from_reference(photo_path, ref_lat, ref_lon)` | `{ok, offset_seconds, human}` | User-Klick auf Karte → Sekunden-Offset |
| `geotagger_write(matches, make_backup=True)` | `{ok, written, skipped, errors, backup_path}` | EXIF-Schreibvorgang mit optionalem ZIP-Backup (Sync-Legacy) |
| `geotagger_start_write(matches, make_backup, overwrite_existing, adjust_photo_time, offset_seconds)` | `{ok, total, skipped_existing}` | **Async-Write** (Background-Worker, UI pollt `geotagger_write_status`). Filtert `matches`, setzt `_write_state["from_drops"]` wenn Pfade unter `DROPS_DIR`. Ausführliches Logging nach `logs/app.log` (v0.9.152). |
| **`geotagger_export_tagged(items, dest_folder)`** | `{ok, exported, skipped, errors, dest}` | **v0.9.152**: Kopiert getaggte Drag&Drop-Kopien (`items=[{src,name}]`) unter Original-Namen nach `dest_folder` (`shutil.copy2`). Nötig weil gedroppte Fotos in `_drops/` getaggt werden, nicht in den Originalen. |
| **`geotagger_remove_photos(paths)`** | `{ok}` | **v0.9.164**: Entfernt Fotos aus dem Server-State (`_gtg_photos`). Datei bleibt unangetastet. |
| **`geotagger_track_point_at(lon, lat)`** | `{ok, lat, lon, ele, time, dist_m}` | **v0.9.163/166/167**: Nächster Punkt **auf der gezeichneten Track-Linie** zu einer Karten-Position. Projiziert auf das nächste Segment (Lotfußpunkt, **nicht** nur nächster Vertex — v0.9.167), interpoliert Höhe/Zeit. Genutzt für Track-Klick-Info **und** „Auf Track einrasten" beim manuellen Platzieren. Projiziert auf `_gtg_display` (= die downsampled Linie, die auch gezeichnet wird), damit Pin == sichtbare Linie. |
| **`geotagger_photo_exif(path)`** | `{ok, key:{camera,lens,focal,focal35,iso,shutter,aperture,exposure_comp,flash}, all:{Tag:Wert,…}, readonly:[Tag,…]}` | **v0.9.341/343**: Volle EXIF eines Fotos für das Vorschau-Panel (Tabs Info/EXIF). Wrappt `core/exif.read_photo_details()` — **ein** ExifTool-Read (`read_tags_json(path, [], numeric=False)` = alle Tags, human-readable). `key` mappt die wichtigsten Felder (Make+Model → camera, LensModel/LensID/…, FocalLength + FocalLengthIn35mmFormat, ISO, ExposureTime, FNumber → `f/…`); `all` = alle Tags minus Binär-/Vorschaubild-Tags (`_PHOTO_BINARY_TAGS` + Wert-Länge>220 / „binary data"). `readonly` (v0.9.343) = Tags die nicht editierbar sind (`exif_tag_writable()` False). Frontend (`module.js`): `_gtExif`-Map cacht pro Pfad, `showPhotoPopup` → `_gtRenderExif`/`_gtFetchExif`, Tabs via `_gtSetPvTab` (`.gt-pv-tab[data-pvtab]`). |
| **`geotagger_write_exif_tag(path, tag, value)`** | `{ok, key, all, readonly}` oder `{ok:false, error}` | **v0.9.343**: Editiert EIN EXIF-Feld sofort (Einzelschreibung; seit v0.9.344 nutzt das Frontend stattdessen den gesammelten Pfad — Bridge bleibt für Einzelnutzung erhalten). Wrappt `core/exif.write_exif_tag()` (`exiftool -overwrite_original -{tag}={value}`; leerer Wert löscht; `_EXIF_TAG_READONLY`-Guard). |
| **Geotagger globale Felder (v0.9.346)** | — | Profil in Settings `geotagger_global_exif` (logische Keys: artist/copyright/usage/credit/source/website/email/keywords). Frontend `_GT_GLOBAL_FIELDS` mappt jeden Key auf mehrere ExifTool-Tags (z.B. artist→`Artist`+`XMP-dc:Creator`+`IPTC:By-line`). `_gtOpenGlobalFields()`-Modal (persistiert via `saveSettings({geotagger_global_exif}, {immediate})`), `_gtGlobalTags()` expandiert zu `{tag:value}`, `_gtGlobalTargetPhotos()` = `photos` mit Häkchen (`_gtPhotoChecked`) + im Filter (`_gtPhotoInFilter`). Im `gt-write`-Handler werden die globalen Tags in `exifEdits[path]` **gemergt** (Pro-Foto-Edit gewinnt) → derselbe Phase-C-Schreibpfad + Backup. `_gtRefreshWriteBtn` aktiviert den Button auch bei nur-globalen Feldern. Kein neuer Backend-Param nötig. |
| **`geotagger_start_write(matches, …, exif_edits)`** | `{ok, total, skipped_existing}` | **v0.9.344**: `exif_edits` = `{path: {tag: value}}` — gesammelte EXIF-Feld-Edits aus dem EXIF-Tab (seit v0.9.346 inkl. eingemergter globaler Felder). Werden im selben Schreibvorgang ins Foto geschrieben: **Backup-Pfade = Vereinigung** aus GPS-Fotos (`to_write`) + EXIF-editierten Fotos; `total = len(to_write) + len(ee_paths)`; läuft auch, wenn `to_write` leer ist (reine EXIF-Edits). Worker-**Phase C** (`_write_worker_run`) schreibt pro Pfad jedes Tag via `cexif.write_exif_tag`. Frontend: `_gtExifEdits`-Map (path→Map(tag→val)), Inline-Edit `_gtBeginExifEdit` setzt nur den Pending-State (gelb, `.gt-pending`, Hinweis-/„verwerfen"-Zeile), `gt-write`-Handler sammelt + reicht `exif_edits` durch, `_gtRefreshWriteBtn` aktiviert den Button auch bei reinen EXIF-Edits, nach erfolgreichem Write `_gtExifEdits`/`_gtExif` geleert. |

**Geotagger Auto-Tag / Bilderkennung (v0.9.349, nur macOS):** `core/autotag.py` nutzt **Apple Vision** (PyObjC: `import Vision` + `Foundation`, lazy & guarded) → `VNImageRequestHandler(URL)` + `VNClassifyImageRequest` liefert Szenen/Objekt-Labels. `is_available()` = darwin + Import ok (sonst False → UI blendet Button aus). `suggest_keywords(path, max_tags, min_conf, lang)`: Labels ≥ Konfidenz, Denylist (`_SKIP` generische Tags), DE-Übersetzung (`_DE`-Map, sonst bereinigtes Englisch). Bridge: `autotag_available`, `geotagger_autotag_start(paths)` (Thread-Worker `_autotag_worker_run` → `self._autotag_state.results` path→[kw]), `…_status`, `…_cancel`. Frontend: Button `#gt-autotag` (nur sichtbar wenn `autotag_available()`), `_gtRunAutotag` (Progress-Poll) → `_gtAutotagApply` legt Keywords als **ausstehende EXIF-Edits** (`_gtExifEdits[path]["Keywords"]`) ab → normaler Schreibpfad (Phase C + Backup). **PyInstaller:** `Vision` in den darwin-`hiddenimports` der Spec (lazy-Import würde sonst nicht gebündelt). Cross-Platform: Win/Linux ohne Feature (kein Bundling, Apple Vision ist OS-eigen).

**Geotagger Pin-Spiderfy (v0.9.347):** Übereinanderliegende Foto-Marker. `_gtMarkersNear(mk)` sammelt alle `markers` deren `map.project(lngLat)` ≤16px vom geklickten Pin liegt. Bei ≥2 → `_gtSpiderfy(group)`: pro Marker `setOffset([cos·R, sin·R])` (R=`min(78, 32+n·7)`, echte lngLat unverändert) + Leitlinien als GeoJSON-Source `gt-spider`/Layer `gt-spider-lines` (center→unproject(center+offset)). `_gtUnspiderfy` setzt Offsets auf 0 zurück + leert die Source. Marker-Click: aufgefächert → select+collapse; Stapel → spiderfy; einzeln → select. Collapse-Trigger: `onMapClick` (Leer-Klick), `map.on("movestart"/"zoomstart")`, jeder `redrawMarkers` (neue Marker-Objekte). CSS `.photo-marker.gt-spidered`.

**Geotagger-Spezial (v0.9.163–168):**
- **0/0-GPS verwerfen (v0.9.165):** `core/exif.py` `read_gps()` filtert lat≈lon≈0 („Null-Island") via `_gps_is_meaningful()` raus — sonst gälten leere GPS-Blöcke fälschlich als „hat schon GPS". Zentral, greift in allen Format-Pfaden (JPEG/TIFF/RAW/HEIC/Video).
- **Manuelles Platzieren (v0.9.166):** Frontend-only Pointer-Drag aus der Liste auf die Karte (`modules/geotagger/ui/module.js`, `_gtManual` Map path→{lat,lon,alt}, `_gtPlacePhoto`, `_gtMergeManual` re-merged nach jedem `updateMatches`). Snap-Toggle `#gt-snap-track` + ⌘ (`_gtSnapWanted(metaKey)`). Manuelle Matches: `in_range=true, manual=true` → in `_gtMatchTaggable` immer taggbar. Nur in-Memory (kein Persist über Tab-Wechsel).
- **Dynamische Linien-Dichte (v0.9.168):** `geotagger_load_gpx` downsampelt auf `ceil(km)*50` Punkte (statt fix 800), Cap 100 000 (reine Notbremse). `_gtg_display` hält genau diese Punkte; Snap projiziert darauf.

**Lazy-Loading Architektur (v0.1.1+):**
1. UI ruft `register_photos(paths)` → Python sammelt Basis-Info (Pfad, Name, RAW-Ja/Nein) und startet Background-Thread → returns sofort
2. Worker-Thread arbeitet Liste ab, schreibt fertige Daten in `_thumb_queue_ready` (Lock-geschützt) und führt `_thumb_progress` mit
3. UI pollt alle 250 ms `poll_thumbs(known)` mit Pfaden die schon eingerendert sind → Backend liefert nur die Deltas → UI updated Tiles incremental
4. Tiles starten als **Skelett** (Shimmer-Animation), bekommen Thumbnail eingeblendet wenn Worker fertig ist
5. Match-Recompute wird automatisch getriggert wenn Worker neue EXIF-Zeiten reingeschoben hat

**Cancel-Mechanismus:** neuer `register_photos`-Call setzt `_thumb_progress["running"] = False` → Worker prüft das pro Foto und beendet sich.

### Settings

| Methode | Returns | Zweck |
|---------|---------|-------|
| `settings_get()` | dict | Vollständige Settings (mit Defaults aufgefüllt) |
| `settings_set(patch)` | `{ok, settings}` | Tiefes Merge in `settings.json`. Patch kann z.B. `{"animator": {"pitch": 30}}` sein |
| `settings_reset_module(slug)` | `{ok, settings}` | Setzt EIN Modul auf DEFAULT_SETTINGS zurück. Wird aktuell nicht vom UI gerufen (Workspace-Clear-Button macht das nicht — der cleart nur Daten). Bleibt als Endpoint für eine spätere „Settings-Reset"-Funktion. |

**Storage:** `~/Library/Application Support/Reisezoom GPS Studio/settings.json`
**Default-Schema:** siehe `DEFAULT_SETTINGS` in `app.py`. Neue Keys werden bei Update automatisch gemerged (User-Settings überschreiben Defaults).
**Atomares Schreiben:** Schreibvorgang via `settings.json.tmp` + `os.rename` → kein korruptes File bei Crash.
**UI-Helper:** `bindSetting(elementId, section, key, opts?)` in `ui/js/util.js` bindet ein Form-Element bidirectional an einen Settings-Pfad (lädt initial, speichert bei `input`/`change` mit 200 ms Debounce).

### Drag & Drop

| Methode | Returns | Zweck |
|---------|---------|-------|
| `drop_session_start()` | `{ok, session_id, dir}` | Legt `_drops/<session>/` an |
| `drop_save_file(session_id, name, b64_content)` | `{ok, path, size}` | Speichert eine base64-codierte Binärdatei in die Session |
| `drop_save_text_file(session_id, name, content)` | `{ok, path, size}` | Speichert Plain-Text (kein base64) — für GPX |
| `list_jpegs_in_folder(folder)` | `{ok, files}` | Hilfsfunktion: alle JPGs in einem Ordner |
| **`consume_drop_paths()`** | `{ok, paths: {basename→fullpath}, count}` | **v0.9.153**: Liefert die echten Original-Pfade des letzten Drops (aus pywebviews `webview.dom._dnd_state['paths']`) und **leert** den Puffer dabei. Race-frei (Cocoa füllt `_dnd_state` synchron *vor* dem JS-Drop-Event). Pro Drop **genau einmal** aufrufen. Bei Fehler → `{ok:False, paths:{}}` → UI fällt auf base64-Kopie zurück. |

**v0.9.153 — Native Drop-Pfade (die echte Lösung):** pywebview 6.2.1 erfasst beim Drop nativ den vollständigen Pfad in `webview.dom._dnd_state['paths']` (Liste von `(name, fullpath)`-Tupeln), **sobald mindestens ein** Python-Drop-Listener registriert ist (`_dnd_state['num_listeners'] > 0`). Alle vier Backends implementieren das (cocoa/edgechromium/gtk/qt). Mechanik:
1. `_enable_native_drop()` (in `main()`, beim `_on_loaded`) registriert **genau einen** No-op-`DOMEventHandler` auf `win.dom.document.events.drop`. Allein das Registrieren aktiviert die native Erfassung app-weit (`num_listeners`++). Wir nutzen **keinen** echten pywebview-Drop-Handler, weil die bestehenden JS-Dropzones `e.stopPropagation()` rufen → ein document-Level-Handler würde nicht feuern.
2. JS ruft pro Drop einmal `consumeNativeDropMap()` (`util.js`) → `consume_drop_paths()` → bekommt `{basename → fullpath}` und reichert die gesammelten Files mit `nativePath` an.
3. Wo jede Datei einen `nativePath` hat, wird **nicht kopiert** — der Original-Pfad geht direkt in den Load-Pfad. Geotagger taggt damit **in-place**.

**Warum war es früher umständlich?** Vor v0.9.153 (bzw. als Fallback heute) bekommt JS vom WKWebView nur `File`-Objekte ohne `.path`. Fallback-Weg: JS liest mit `FileReader` (Text für GPX, base64 für JPGs), schickt durch die Bridge, Python schreibt in `_drops/<session>/<name>`. Greift, wenn `consume_drop_paths()` leer zurückkommt (altes OS, Ordner-Drop).

**Ordner-Traversierung:** `webkitGetAsEntry()` funktioniert in WKWebView und liefert `FileSystemDirectoryEntry`. `collectFilesFromItems()` in `util.js` traversiert rekursiv und liefert eine flache Liste `[{file, relPath}, ...]`. Slashes im `relPath` werden beim Speichern zu `_` (flat layout in `_drops/`).

**Wo `consume_drop_paths()` aufgerufen wird (je genau 1× pro Drop):** zentral in `setupDropZone` (`util.js`) + je einmal in den drei Custom-Handlern: `gpx-bar.js` (GPX-Drop), `animator/module.js` (Foto-Drop ~Z.4699), `tourmap/module.js` (Spiegelung). Doppel-Consume = Datenverlust (Puffer wird geleert) → niemals zweimal pro Drop.

**Synth-Fallback (Bonus-Fix):** Wenn die WebView ausnahmsweise **gar keine** `File`-Objekte liefert (sporadischer macOS-WKWebView-Bug „Drop enthielt keine Dateien"), rekonstruiert die UI den Import aus den nativen Pfaden allein. Damit ist auch dieser alte Bug entschärft.

**⚠️ Geotagging-Fallstrick — Historie (v0.9.152, jetzt gelöst):** Vor der nativen Lösung landeten gedroppte Fotos als **Kopien** in `_drops/`, `write_gps` taggte diese Kopien statt der Originale → sah aus wie „GPS wird nicht geschrieben". v0.9.152-Workaround: `_write_worker_run` setzt `_write_state["from_drops"]=True` und bietet im Modal **„Getaggte Fotos speichern …"** (`geotagger_export_tagged(items, dest_folder)`, `shutil.copy2`). Seit v0.9.153 greift dieser Pfad nur noch im seltenen Fallback (kein nativer Pfad); der Normalfall taggt in-place und `from_drops` bleibt False (native Pfade liegen nicht unter `DROPS_DIR`), der Export-Button erscheint also korrekterweise nicht.

**State-Management:**
- `_gtg_track`, `_gtg_stats`, `_gtg_photos` werden im `Api`-Objekt gehalten.
- Wenn die App geschlossen wird: weg. Speicherung im Filesystem nicht implementiert (MVP).
- `_gtg_photos` ist Liste von dicts (mit `thumb`-base64 — kann ~10 KB pro Foto sein, bei 500 Fotos = 5 MB im Speicher → ok).

---

## 5 · Frontend-Architektur

### Undo/Redo-System (seit v0.9.66/67)

**Generischer Controller** in `ui/js/util.js`:

```js
window.createUndoController({
  snapshot: () => ({...currentState}),
  apply:    (state) => { /* state zurückschreiben + DOM nachziehen */ },
  toast:    (msg)   => toast(msg, "info", 1000),  // optional
});
```

- **Stack-Größe:** 50 Schritte (Standard für Creative-Tools — Photoshop-Default).
- **Throttle:** 800 ms — verhindert dass Drag-Operationen (Slider, Trim-Handle) bei jedem Frame einen Snapshot pushen. Der erste Mutations-Frame in einer Drag-Sequenz erzeugt den „Vorher"-State, die folgenden werden geschluckt.
- **Reentrancy-Guard:** während `apply()` werden `push()`-Calls ignoriert. Wichtig, weil `apply()` selbst input-Events dispatched (z.B. um Slider-Werte zu synchronisieren) — sonst würde der Generic-Listener einen Push-Loop auslösen.
- **`force: true`-Option** für discrete Aktionen (KF-Snapshot, Delete, Checkbox-Click), die den Throttle umgehen.

**Modul-Registry:** `window.__rzUndoControllers = { animator, tourmap, geotagger }`. Jedes Modul registriert seinen Controller beim Mount.

**Globaler Keyboard-Listener** in `util.js` (capture-phase, damit Slider-Inputs den Shortcut nicht abfangen) routet `Cmd/Ctrl+Z` / `Cmd/Ctrl+Shift+Z` / `Ctrl+Y` zum aktuell sichtbaren Modul-Panel (Lookup via `offsetParent` auf `anim-panel` / `tmap-panel` / `gt-panel`).

**Stack-Reset bei Projekt-Wechsel:** Jedes Modul hookt sein eigenes `_animOnProjectChanged` / `_tmapOnProjectChanged` / `_geotaggerOnProjectChanged` und ruft `ctrl.reset()`. Damit: kein Undo über Projekt-Grenzen hinweg.

**Hook-Strategien:**

- **Animator** (KF-zentrische Mutationen): gezielte `_animPushUndo("label")`-Calls am Anfang jeder Mutationsfunktion (`snapshotKeyframe`, `deleteKeyframe`, `moveEvent`, `updateKeyframeFields`, …) + auf Trim-Drag-Callback + auf Slider-Input von intro/dur/hold + auf Master-Toggle-Change.
- **Tour-Map** + **Geotagger** (settings-zentrisch): generischer Event-Listener auf `#tmap-panel` / `#gt-panel` (`input` + `change`) → ruft `push()` für jedes Form-Element. Throttle für Slider/Range, `force` für Checkbox/Select/Radio/Color.

**Was NICHT undoable ist:**
- GPS-Schreibvorgänge in Foto-Dateien (destruktiv → würde Backup der EXIF-Daten brauchen, siehe Marc-Choice v0.9.67).
- Render-Ausgaben (das Video/PNG selbst — der User kann es löschen, nicht „rückgängig").
- Projekt-Anlegen/-Löschen (gehört zum Projekt-Lifecycle, nicht zum Editier-Workflow).

### Modul-Lifecycle

Module registrieren sich selbst über `window.RZGPS_MODULES`:
```js
// modules/<slug>/ui/module.js
(window.RZGPS_MODULES = window.RZGPS_MODULES || {}).animator = {
  manifest: { slug: "animator", name: "Animator", icon: "▶",
              description: "...", sort_order: 10 },
  mount: function (body, headerActions) {
    body.innerHTML = "...";
    // Listener binden, Map initialisieren, etc.
    return () => { /* Cleanup: Map.remove(), Timer abräumen, ... */ };
  },
};
```

`ui/js/app.js` baut beim Start die Top-Bar-Tabs aus diesen Manifests (sortiert
nach `sort_order`) und mountet das aktive Modul beim Tab-Klick. Aktives Modul
wird in den Settings persistiert (`settings.active_module`).

**Vorbereitung für späteres "split into apps":** Wenn jedes Modul später als
eigenständige `.app` ausgeliefert werden soll, kommt nur ein dünner App-Frame
dazu der `window.RZGPS_MODULES[<slug>]` lädt und sofort `mount()`-aufruft.
Der Modul-Code bleibt identisch.

### Mapbox-Karten

- Pro Modul **eigene Map-Instanz** im `#map-canvas`-Div
- Beim Modul-Wechsel: `map.remove()` (im Cleanup) → spart Memory
- Mapbox-Token aus Python via `api().get_mapbox_token()`

### State im Frontend

**Animator:** nur lokal in der Mount-Closure (currentGpx, pollTimer)
**Geotagger:** lokal: `photos[]`, `matches[]`, `selectedPath`, `refMode`, `markers[]`

Marker-Updates: bei jedem Offset-Wechsel werden **alle Marker entfernt + neu gezeichnet**. Bei <50 Fotos performant; ab 500+ wäre Marker-Pool sinnvoll (TODO).

### Debounce

Manuelle Offset-Inputs → `debounce(updateMatches, 80)` damit nicht bei jedem Tastendruck eine Match-Berechnung läuft.

### Workspace-Clear-Registry (v0.9.155)

Statt drei modul-eigener „↺ Workspace leeren"-Buttons gibt es **ein zentrales
rotes ✕** in der GPX-Bar (`ui/js/gpx-bar.js`, neben dem GPX-Namen). Mechanik:

- `window.__workspaceResetters` (Set) + `window.registerWorkspaceResetter(fn)` —
  jedes Modul registriert beim IIFE-Init seine Reset-Funktion
  (`_animClearWorkspace`, `_tmapClearWorkspace`, `_gtClearWorkspace`).
- `window.clearWorkspaceGlobal()` zeigt EIN Bestätigungs-Modal
  (`confirmClearWorkspace(null, …)` → `confirm_all`-Text), ruft dann **alle**
  Resetter (`await`, einzeln try/catch) und zum Schluss `clearGlobalGpx()`
  (leert GPX-Name + Session, triggert `onGpxLoaded` mit leerem Pfad).
- **Warum das auch für nicht-gemountete Module greift:** Modul-IIFEs werden nur
  1× geladen — beim Modul-Wechsel tauscht `app.js` nur das DOM, die Closures
  (inkl. `photos[]`, `currentGpx`, `map`) überleben. Die Resetter sind deshalb
  DOM-tolerant (`document.getElementById(...)?...` in try/catch), damit sie auch
  no-op-sauber durchlaufen wenn ihr DOM gerade nicht im Baum hängt.
- **Höhen-Animator** registriert keinen eigenen Resetter — er hängt am
  `onGpxLoaded`-Empty-Handler, der durch das abschließende `clearGlobalGpx()`
  feuert.

Der `data-gpxbar="clear"`-Pfad (alt: nur Track entfernen) bleibt als Legacy-
Fallback im `_bindEvents`-Switch erhalten, das Template nutzt jetzt aber
`data-gpxbar="clearws"` → `clearWorkspaceGlobal()`.

### Quelldatei-fehlt-Banner (v0.9.305)

**Problem:** Module holen den Track nicht einheitlich. `animator` zeichnet aus
den per `onGpxLoaded({path, data})` **gepushten** `data.coords` (robust gegen
fehlende Datei). `tourmap`/`heightanim`/`geotagger`/`gpxinspect` rufen dagegen
ihre eigene Bridge mit dem **Pfad** (`tourmap_load_gpx`, `heightanim_load_gpx`,
`geotagger_load_gpx`, `gpxinspect_load`) und re-lesen die Datei von der Platte.
Ist die Quelle weg (externe Platte ab, Datei verschoben), liefen diese Module
still in einen leeren/falsch wirkenden Zustand (Karte auf Europa, leeres
Höhenprofil, „Kein Track geladen", Stats „—").

**Lösung (Marc-Wahl „Lösung 3" = ehrliches Banner, kein stiller Snapshot-Fallback):**
- Globales Banner `#source-missing-banner` in `ui/index.html` (parallel zum
  `update-banner`), CSS warnend-orange in `ui/css/app.css`.
- Helper in `ui/js/gpx-bar.js` (global): `window.isMissingFileError(err)`
  (Regex auf ENOENT-Signaturen), `window.showSourceMissingBanner(path)`,
  `window.hideSourceMissingBanner()`. „Datei neu wählen" ruft `window.pickGpx()`.
- Verdrahtung: `loadGlobalGpx` (zentral, Erfolg → `hideSourceMissingBanner`,
  Fehler → bei Missing-File `show…` statt Toast) + die vier Modul-Load-Fehler-
  pfade. i18n-Key `app.source_missing` (de/en/es).
- **Hinweis für später (nicht umgesetzt):** Die saubere Variante wäre, alle
  Module auf die gepushten `data.coords` umzustellen (Single Source of Truth,
  wie `animator`) bzw. auf `gpx_snapshot_path` (jede Session legt eine lokale
  Kopie unter `sessions/<hash>.gpx` ab). Das Banner ist die bewusst gewählte,
  transparente Zwischenlösung.

---

## 6 · Build & Distribution

### Dev-Build (Source-Tree)
```bash
./run.sh        # erstes Mal: venv + pip + playwright; danach: app starten
```

### Release-Build (`.app`)
```bash
./build.sh
# → killt laufende App
# → pyinstaller spec → dist/Reisezoom GPS Studio.app
# → cp -R nach /Applications/
# → codesign --force --deep --sign -
# → xattr -dr com.apple.quarantine
```

### `ReisezoomGPSStudio.spec` Erklärung

**Wichtige Eintragspunkte:**
- `data_files` — `os.walk("ui")` sammelt alle UI-Files mit erhaltener Struktur, plus `docs/USER_GUIDE.html` (für in-App-Hilfe)
- **`collect_data_files("imageio_ffmpeg")`** — **packt das gebündelte ffmpeg-Binary mit ein** (~30 MB). Damit müssen Endnutzer kein eigenes ffmpeg installieren.
- `hidden` — plattform-conditional:
  - macOS: pywebview Cocoa + pyobjc-Frames (`Foundation`, `AppKit`, `WebKit`)
  - Windows: `webview.platforms.edgechromium`, `clr_loader`, `pythonnet`
  - Linux: `webview.platforms.gtk` / `webview.platforms.qt`
  - Universal: `playwright`, `imageio_ffmpeg`
- `excludes` — Müll aussortieren (tkinter, Qt, scipy, matplotlib)
- `BUNDLE` (nur macOS): Plist-Einträge:
  - `NSHighResolutionCapable: True` (Retina)
  - `NSRequiresAquaSystemAppearance: False` (Dark-Mode-fähig)
  - `NSAppTransportSecurity` → `NSAllowsArbitraryLoads: True` (Mapbox-CDN, gestreamte Tiles)
- **EXE-Icon**: `.ico` auf Windows, `.png` auf Linux (auto-detect via `_sys.platform`)

### Was im Bundle steckt (v0.3.3, macOS ~213 MB)
- Python 3.14 minimal + alle Deps (~120 MB)
- UI als Resource-Dateien (Source-Form, ohne Bundler)
- **ffmpeg-Binary** in `Contents/Frameworks/imageio_ffmpeg/binaries/ffmpeg-macos-aarch64-v7.1` (~30 MB)
- Playwright-Driver (~30 MB) — Chromium-Browser wird beim ersten Render nachgeladen (System-Cache `~/Library/Caches/ms-playwright/`)
- `docs/USER_GUIDE.html` (~30 KB) für die in-App-Hilfe
- KEIN Chromium (~92 MB) → wird beim ersten Render via `playwright_install_chromium()`-Bridge nachgeladen (~150 MB, einmalig, in den System-Cache)

**Resultat: 213 MB `.app`** seit v0.3.2 (vorher 166 MB; +47 MB durch ffmpeg-Bundling).

### Cross-Platform-Distribution (live seit v0.2.1)

#### GitHub-Actions-Workflow `.github/workflows/release.yml`
Bei jedem Tag-Push (`vX.Y.Z`) bauen drei Jobs parallel:
- `build-macos` auf `macos-14` (arm64) → DMG-Installer via `create-dmg`
- `build-windows` auf `windows-latest` → ZIP via `Compress-Archive`
- `build-linux` auf `ubuntu-22.04` → tar.gz

**Feste Dateinamen der Release-Artefakte:**
- `ReisezoomGPSStudio-macos.dmg`
- `ReisezoomGPSStudio-windows.zip`
- `ReisezoomGPSStudio-linux.tar.gz`

Der Workflow erstellt auf einen Versions-Tag (`vX.Y.Z`) automatisch ein GitHub Release mit diesen drei Artefakten. Die offiziellen Downloads werden vom Maintainer zusätzlich auf reisezoom.com gespiegelt (erreichbar über die `s.reisezoom.com`-Shortlinks).

### Codesigning (noch nicht produktiv)

Aktuell: **ad-hoc signiert** (`codesign --force --sign -`) — Gatekeeper warnt beim ersten Start, User muss Rechtsklick → Öffnen. SmartScreen unter Windows analog. Für reibungsfreie Distribution wäre nötig:
- **macOS**: Apple Developer ID Cert (99 $/Jahr) + Notarization
- **Windows**: Code Signing Certificate (~200 $/Jahr Sectigo/SSL.com)
- Beide: in CI-Pipeline via GitHub Secrets

---

## 7 · Tests

### Tests laufen lassen
```bash
source .venv/bin/activate
python tests/test_core.py
python tests/test_geotagger_e2e.py
python tests/test_app_start.py
python tests/test_animator_render.py    # ~30 s (echter Render!)
```

### Test-Fixtures regenerieren
```bash
python tests/make_test_photos.py
```
Erzeugt 6 JPGs mit EXIF-Zeitstempeln an exakten Track-Punkten + `_meta.json` mit erwarteten Lat/Lon-Werten.

### Linting (ruff)
Python-Code-Wächter mit **hohem Signal** (echte Bug-Fänger: ungenutzte Importe/
Variablen, undefinierte Namen/Tippfehler, bugbear) — **kein** Stil-Genörgel. Config:
`ruff.toml` (kompakte Einzeiler-Schreibweise ist Absicht und bleibt erlaubt).
```bash
.venv/bin/ruff check .          # prüfen
.venv/bin/ruff check . --fix    # sichere Funde automatisch beheben
```
Läuft auch in CI (`.github/workflows/lint.yml`) bei jedem Push — **separat** von
release.yml, blockiert also weder Build noch Release (nur ✗-Hinweis am Commit).

### CI-Stand
- **Release** (`release.yml`): Tag-Push → macOS-DMG + Windows-EXE → GitHub-Release.
- **Lint** (`lint.yml`): Push/PR → ruff (informativ, nicht-blockierend).
- **Win-Install-Smoke** (`test-windows-install.yml`).
Manuelle Test-Runs (oben) vor jedem Commit / Build weiterhin empfohlen.

---

## 8 · Pflicht-Regeln für Änderungen

1. **VOR Code-Änderung:** `./scripts/backup.sh` (außer bei trivialen Tippfehlern)
2. **NACH Funktions-Änderung:** `CHANGELOG.md` unter `[Unreleased]` ergänzen
3. **Bei Architektur-Änderungen:** Diese Datei (`DEVELOPER.md`) updaten
4. **Bei UI-/Workflow-Änderungen:** `docs/USER_GUIDE.md` aktualisieren
5. **Tests müssen grün bleiben** vor Build

---

## 9 · Gotchas & Lessons Learned

### `+faststart`-Hänger
Siehe Animator-Abschnitt oben. Wichtig: Dateigröße bleibt konstant in Finalize-Phase. Erst nach mehreren Minuten ohne mtime-Änderung + 0% CPU killen.

### EXIF-Zeitzone
EXIF hat *keine* Zeitzone (außer `OffsetTimeOriginal`, das viele Kameras nicht schreiben). Wir behandeln naive datetime als Kamera-Lokalzeit. Seit v0.9.177 kann der User die **Kamera-Zeitzone** im Offset-Dialog wählen (`geotagger.tz_offset_minutes`) — wird nur auf Fotos OHNE eingebetteten Offset angewandt (`tz_known`), siehe „Zeitzonen-Handling beim Geotagging" oben. **Noch offen:** Zonen-WECHSEL *innerhalb* eines Tracks (z.B. Track überquert eine Zeitzonengrenze) — aktuell gilt eine Zeitzone fürs ganze Foto-Set.

### Mapbox-Token public
Der `pk.*`-Token ist **kein Geheimnis** — er liegt sowieso im Browser sichtbar. Für externe Distribution besser:
- User-Eingabe + Speichern in App-Support
- ODER eigenen Tile-Proxy auf reisezoom.com

### Playwright auf macOS
Chromium-Headless-Shell wird in `~/Library/Caches/ms-playwright/` installiert. Auf einem frischen System nach `pip install playwright` zusätzlich `playwright install chromium` aufrufen.

**PyInstaller-Bundle-Falle**: PyInstaller packt zwar den Playwright-Driver
(`Contents/Resources/playwright/driver/package/`) ein, aber NICHT die
Browser-Binaries (~150 MB). Per Default sucht Playwright in
`<driver>/.local-browsers/` → nicht da → Render crasht mit
„Executable doesn't exist".

Lösung: `os.environ["PLAYWRIGHT_BROWSERS_PATH"]` in `app.py` GANZ FRÜH
(vor irgendeinem Playwright-Import) auf den System-Cache setzen:
- macOS: `~/Library/Caches/ms-playwright`
- Windows: `~/AppData/Local/ms-playwright`
- Linux: `~/.cache/ms-playwright`

Wenn dort nichts ist → `Api.playwright_install_chromium()` lädt's via
gebundeltem Driver runter. Die Bridge-Funktion ruft
`playwright._impl._driver.compute_driver_executable()` + `get_driver_env()`
auf und führt `<driver> install chromium-headless-shell` als subprocess aus.

### pywebview Python-3.14
Tested OK mit pywebview 6.2.1 + pyobjc 12.1. Bei Update vorher prüfen — pywebview hat in 5.x→6.x die Plattform-Module-Pfade verschoben.

### pywebview-Events laufen NICHT auf dem Cocoa-Main-Thread
**Anti-Intuitive Falle**: `window.events.loaded`, `events.shown` etc. werden von pywebview
auf einem Python-Worker-Thread (Thread-3 „execute") gefeuert. Jeder direkte PyObjC/Cocoa-
Zugriff aus diesen Callbacks (z. B. `NSWindow.setFrame_display_()`) crasht mit
**„Must only be used from the main thread"**-Assertion → BREAKPOINT.

**Symptom-Crash-Auszug:**
```
Application Specific Information: Must only be used from the main thread
Thread 17 "Thread-3 (execute)":
  -[NSWindow _setFrameCommon:display:fromServer:]
  NSWMWindowCoordinator performTransactionUsingBlock:
```

**Fix:** Cocoa-Aufrufe IMMER via `AppHelper.callAfter()` auf Main dispatchen.
```python
def _on_loaded():
    from PyObjCTools import AppHelper
    AppHelper.callAfter(_maximize_native_window)  # ← jetzt auf Main-Thread
win.events.loaded += _on_loaded
```

Gleiches gilt für jeden Bridge-API-Call der NSWindow/NSPanel/etc. anfassen will.

### WKWebView Cache-Problem für file:// CSS/JS
WKWebView cached `file://`-URLs (CSS, JS) sehr aggressiv über App-Starts hinweg.
Nach einem Rebuild zeigt die App oft noch das alte UI — selbst nach App-Restart und
WebKit-Cache-Löschen im Library-Ordner.

**Lösung (v0.1.1+) in `_prepare_html_with_cache_busting()`:**
1. Beim App-Start wird `ui/index.html` gelesen
2. Alle relativen Pfade in `<link href="css/...">` und `<script src="js/...">` werden ersetzt durch absolute `file://`-URLs mit `?v=<hash>`-Query
3. `<hash>` = Summe aller UI-File-Mtimes → ändert sich automatisch bei jeder Code-Änderung, bleibt sonst stabil
4. Resultierende HTML wird in eine Temp-Datei geschrieben (NamedTemporaryFile in `/tmp/`)
5. pywebview lädt diese Temp-URL statt direkt das Bundle
6. Beim App-Shutdown: Temp-Datei wird gelöscht

**Zusätzlich:** `webview.start(private_mode=True)` → WKWebView verwendet einen
nicht-persistenten `WKWebsiteDataStore`, kein Cache zwischen App-Starts.

### CSS aspect-ratio in WKWebView
WKWebView (das macOS-WebView von pywebview) respektiert `aspect-ratio` **nicht zuverlässig**
in Grid-Layouts wenn der Tile-Content (z.B. ein leeres `<img>` ohne src) eine
0×0-Intrinsic-Size hat. Das Tile kollabiert dann auf die Höhe des einzigen sichtbaren
Children (im Geotagger: `.ph-name` = ~20 px). Sobald das Thumbnail geladen wird, springt
das Layout sichtbar.

**Lösung:** klassischer Padding-Top-Trick.
```css
.tile {
  position: relative;
  /* keine aspect-ratio! */
}
.tile::before {
  content: "";
  display: block;
  padding-top: 75%;     /* = 3/4 → 4:3-Höhenreservierung */
}
.tile > img {
  position: absolute;
  inset: 0;
  width: 100%; height: 100%;
}
```
Das Pseudo-Element `::before` reserviert die volle Tile-Höhe unabhängig vom Inhalt.
Funktioniert in jedem WebView, jedem Browser, jeder Version.

### TDZ-Bug-Falle in Modul-Mount-Funktionen
**Symptom:** Modul rendert HTML, aber kein Click-Handler funktioniert.
**Ursache:** Wenn am Anfang der `mount`-Funktion ein `const` referenziert wird, das erst weiter unten definiert ist — JS wirft `ReferenceError: Cannot access 'foo' before initialization` (TDZ), die `mount`-Funktion bricht ab, alle nachfolgenden Listener-Bindings entfallen still.
**Fix:** alle hilfsfunktionen die in Event-Listenern als Referenz auftauchen, **vor** den Listener-Bindings definieren. Oder mit `function` statt `const` deklarieren (hoisted).
**Vorbeugend:** seit v0.1.1 ist ein globaler `window.addEventListener('error', ...)` aktiv, der JS-Fehler als Toast anzeigt. Damit erscheint dieser Fehler-Typ künftig sofort sichtbar.

### Debug-Mode
`webview.start(debug=True)` ist standardmäßig an. Right-Click auf der App öffnet "Element untersuchen" → Web-Inspector mit Console, Network, DOM. Für Distribution: vor Release `debug=False` setzen.

### pywebview `file_types` Regex
`parse_file_type` in `webview/util.py` benutzt
```
r'^([\w ]+)\((\*(?:\.(?:\w+|\*))*(?:;\*(?:\.(?:\w+|\*))*)*)\)$'
```
Die Beschreibung erlaubt **nur `\w` und Leerzeichen** — keine Bindestriche, keine deutschen Umlaute (`ö`, `ä` sind in `\w` nicht enthalten je nach Locale), keine Punkte.
Format daher immer: `'GPX (*.gpx)'`, `'Fotos (*.jpg;*.jpeg)'` — schlicht ASCII-Wörter + Endungen.
**Fallback bei Verstoß:** `create_file_dialog` wirft `ValueError` durch, JS-Bridge schluckt das stillschweigend → Dialog erscheint nie. War der Anlass für den File-Picker-Fix in v0.1.1.

### Drag & Drop — native Pfade seit v0.9.153 (Fallback: base64-Kopie)
WKWebView gibt **JS** bei Drop-Events kein `file.path`. Aber **pywebview Python-seitig** schon: `webview.dom._dnd_state['paths']` wird beim Drop nativ gefüllt, sobald ein Python-Drop-Listener registriert ist. Seit v0.9.153 holen wir den Original-Pfad pro Drop über die Bridge `consume_drop_paths()` und taggen/laden **direkt aus dem Original** — keine Kopie. Details siehe „API → Drag & Drop". Greift der native Pfad nicht (altes OS, Ordner-Drop, leeres `_dnd_state`), läuft der alte Weg: JS liest den Inhalt (`FileReader.readAsText` für GPX, `readAsDataURL` für Binär), schickt ihn durch die Bridge, Python schreibt nach `_drops/<session>/`, dann normaler Load-Pfad.

**Race-Freiheit:** Cocoas `performDragOperation_` füllt `_dnd_state` **synchron vor** dem DOM-Drop-Event → `consume_drop_paths()` aus dem JS-Drop-Handler findet die Pfade immer schon vor. `consume_drop_paths()` **leert** den Puffer → genau 1× pro Drop aufrufen.

**Performance-Gewinn:** Im Normalfall entfällt der base64-Roundtrip komplett (nur ein String-Mapping statt Datei-Inhalt über die Bridge). Der base64-Fallback bleibt langsam (~50 MB/s); für Massen-Importe via Fallback weiter Ordner-Picker empfehlen. Bei großen Datenmengen via Drop gibt's einen Progress (Mini-Box unten rechts).

### PyInstaller + Hidden Imports
pywebview-Cocoa-Module sind nicht voll auto-discoverable. Manuell in `hidden` listen (`webview.platforms.cocoa.*`). Bei Build-Fehler "ModuleNotFoundError" → `collect_submodules("webview")` und in `hidden` einfügen.

### macOS-Quarantine
Beim ersten Doppelklick auf eine ad-hoc-signierte App fragt Gatekeeper. `xattr -dr com.apple.quarantine "/Applications/..."` direkt im Build-Script entfernt das.

---

## 10 · Ausblick (siehe CHANGELOG für Details)

- HEIC/RAW-Support (`pyheif`, `exiftool`-CLI als Fallback)
- Drag & Drop in UI (`dragenter`/`drop`-Listener)
- Drei weitere Module: Overlay, Cleaner/Splitter, Tour-Karten-PNG
- Universal-Build arm64+x86_64
- App-Icon (.icns aus 1024 px PNG via `iconutil`)
- Notarisierte Distribution
- Freemium-License-Layer (kommt erst nach feature-completeness)
