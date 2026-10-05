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
| `9460cb9`, `2f82908` | 04.09.2026 | `children()`-Abfragen unter Terrain absichern (TypeError `e[1].key`), `clearFadeHold` ohne Kachel |
| `1ab22b7` | 05.09.2026 | Terrain-Kachelstufe begrenzen |
| `569d5a0`, `19b1116`, `f5cc296`, `86e16ff` | 06.09.2026 | Terrain-Nähte: Shader-Stitching an Zoomgrenzen, Randhöhen der Nachbarkachel |
| `bd345b9`, `de001e7` | 07.09.2026 | Szene-Render (gemeinsame Szene), Render-Modus-Übergang |
| `31dc0f3`, `2d1d4cd`, `349aa95`, `2426576`, `40ad08f` | 08.09.2026 | Terrain-Vorschau: pixelRatio, LOD-Hysterese, abgedeckte Kacheln, Culling-Box |
| `35f8851` | 09.09.2026 | LOD-Hysterese hält nur eine Nachbarstufe |
| `b6c7125` | 04.10.2026 | 3D-Häuser: Tiefenversatz je Gebäude gegen Z-Fighting |

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
