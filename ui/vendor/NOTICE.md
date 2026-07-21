# Mitgelieferte Karten-Bibliotheken (`ui/vendor/`)

Diese Dateien sind **unveränderte Distributions-Builds** der jeweiligen Projekte.
Sie liegen seit v0.9.446 lokal im Repository und werden mit der App ausgeliefert,
weil die App sie vorher bei **jedem Start vom CDN** nachlud — ohne Netz (oder mit
Firewall/DNS-Filter) blockierte das den Seiten-Parser und die App zeigte nur ein
weißes Fenster. Lokal gebündelt startet sie offline.

| Datei | Projekt | Version | Lizenz |
|---|---|---|---|
| `mapbox-gl.js`, `mapbox-gl.css` | [Mapbox GL JS](https://github.com/mapbox/mapbox-gl-js) | 3.12.0 | **Mapbox Terms of Service** (proprietär) — © Mapbox |
| `maplibre-gl.js`, `maplibre-gl.css` | [MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js) | 5.4.0 | BSD 3-Clause |
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

## Aktualisieren

Die Dateien stammen 1:1 von den offiziellen CDN-Pfaden:

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
