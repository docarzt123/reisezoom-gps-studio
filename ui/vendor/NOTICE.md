# Mitgelieferte Karten-Bibliotheken (`ui/vendor/`)

Mapbox GL JS und Leaflet sind **unveränderte Distributions-Builds**. **`maplibre-gl.js`
ist der Build 5.4.0 mit eigenen Patches** (siehe unten) — die BSD-3-Lizenz erlaubt das,
Copyright-Header und Lizenzhinweis bleiben erhalten.
Sie liegen seit v0.9.446 lokal im Repository und werden mit der App ausgeliefert,
weil die App sie vorher bei **jedem Start vom CDN** nachlud — ohne Netz (oder mit
Firewall/DNS-Filter) blockierte das den Seiten-Parser und die App zeigte nur ein
weißes Fenster. Lokal gebündelt startet sie offline.

| Datei | Projekt | Version | Lizenz |
|---|---|---|---|
| `mapbox-gl.js`, `mapbox-gl.css` | [Mapbox GL JS](https://github.com/mapbox/mapbox-gl-js) | 3.12.0 | **Mapbox Terms of Service** (proprietär) — © Mapbox |
| `maplibre-gl.js`, `maplibre-gl.css` | [MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js) | 5.4.0 **mit eigenen Patches** (nur `.js`) | BSD 3-Clause |
| `leaflet/leaflet.js`, `leaflet/leaflet.css`, `leaflet/images/*` | [Leaflet](https://github.com/Leaflet/Leaflet) | 1.9.4 | BSD 2-Clause |

## Hinweis zu Mapbox GL JS

Mapbox GL JS ab v2 steht **nicht** unter einer Open-Source-Lizenz, sondern unter den
[Mapbox Terms of Service](https://www.mapbox.com/legal/tos/). Die Auslieferung des
offiziellen Distributions-Builds innerhalb einer Anwendung, die damit **Mapbox-Dienste**
nutzt, ist der vorgesehene Einsatzweg — genau das tut GPS Studio: Karten werden über
Mapbox mit dem **Zugangs-Token des jeweiligen Nutzers** geladen (Einstellungen →
Mapbox-Token). Die Datei ist unverändert; Copyright-Header und Attribution-Control
bleiben erhalten.

Wer die App **ohne** Mapbox betreiben will, nutzt die OSM-Kartenstile — die laufen
über MapLibre bzw. Leaflet und brauchen keinen Mapbox-Token.

## Eigene Patches an `maplibre-gl.js` (Audit F-1, 05.10.2026)

Der minifizierte Build wurde in diesen Commits direkt geändert — bei einem Update auf eine
neue MapLibre-Version gehen sie verloren und müssen neu angewendet (oder gegenstandslos)
werden. `git show <commit> -- ui/vendor/maplibre-gl.js` zeigt jeweils die Stelle.

| Commit | Datum | Was |
|---|---|---|
| `2b0527e`, `b910702` | 04.09.2026 | `children()`-Abfragen unter Terrain absichern (TypeError `e[1].key`), `clearFadeHold` ohne Kachel |
| `fc1b30a` | 05.09.2026 | Terrain-Kachelstufe begrenzen |
| `22df27f`, `cf22d62`, `afafd22`, `8cb4230` | 06.09.2026 | Terrain-Nähte: Shader-Stitching an Zoomgrenzen, Randhöhen der Nachbarkachel |
| `03f84f1`, `67c3b24` | 07.09.2026 | Szene-Render (gemeinsame Szene), Render-Modus-Übergang |
| `45c3f3d`, `18be6b7`, `8a47733`, `4e1e9ed`, `10371d3` | 08.09.2026 | Terrain-Vorschau: pixelRatio, LOD-Hysterese, abgedeckte Kacheln, Culling-Box |
| `f960176` | 09.09.2026 | LOD-Hysterese hält nur eine Nachbarstufe |
| `1a2f658` | 04.10.2026 | 3D-Häuser: Tiefenversatz je Gebäude gegen Z-Fighting |

## Aktualisieren

⚠️ `maplibre-gl.js` nicht einfach ersetzen — erst die Patches oben neu anwenden.

Die Ausgangsdateien stammen von den offiziellen CDN-Pfaden:

```
https://api.mapbox.com/mapbox-gl-js/v3.12.0/mapbox-gl.js
https://api.mapbox.com/mapbox-gl-js/v3.12.0/mapbox-gl.css
https://unpkg.com/maplibre-gl@5.4.0/dist/maplibre-gl.js
https://unpkg.com/maplibre-gl@5.4.0/dist/maplibre-gl.css
https://unpkg.com/leaflet@1.9.4/dist/leaflet.js
https://unpkg.com/leaflet@1.9.4/dist/leaflet.css
https://unpkg.com/leaflet@1.9.4/dist/images/*.png
```

Bei einem Versions-Update: Dateien ersetzen, die Tabelle oben nachziehen und den
Credits-Block in `ui/js/app.js` (`openAboutModal()`) aktualisieren.

## `ofm-positron.js` — Vorlage der Kartenlooks (07.10.2026)

OpenFreeMap-Stil „Positron“ (Gestaltung CARTO / OpenMapTiles), als Skript mitgeliefert
(`window.RZ_OFM_POSITRON`, erzeugt von `scripts/update_ofm_positron.py`). `ui/js/kartenlook.js` färbt
ihn je Rolle um. Lizenz des Stils: Code BSD-3-Clause, Gestaltung CC BY 4.0; Kartendaten © OpenStreetMap-
Mitwirkende (ODbL), Kacheln von OpenFreeMap. Nennung in der Quellenzeile der Karte und im Über-Dialog.

