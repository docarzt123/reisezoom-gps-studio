# Karten-Zukunft: Wettbewerb, was wir übernehmen, wie wir selbst bessere Karten bauen

*Stand 18.09.2026. Anlass (Marc): „guck dir mult.dev und mapanim.com an — was können wir lernen, was
übernehmen? Könnten wir nicht richtig gute Karten selber bauen, Unreal Engine oder ganz anders denken?
Wir wollen das beste Tool sein." Nordstern bleibt: **aufgezeichnete Tracks veredeln und erzählen** —
keine Routenplanung, kein Komoot-Wettbewerb. Diese Datei ist die Wahrheit zur Karten-Strategie; Rechte-
und Optik-Details stehen in `docs/KARTEN-OPTIK.md`.*

## 1. Was die beiden machen (recherchiert 18.09.2026)

**mult.dev** (App + Web, „Trip GPT"): Reise als Städteliste tippen → Video in einer Minute. 3D-Globus mit
Satellit und Gelände, 80 Fahrzeugmodelle (3D-Flieger, Autos, 2D-Icons), Fotos je Station, Titel, Musik,
Google-Maps-Import, GPX/KML/GeoJSON. Free: 5 Videos, 768p, Wasserzeichen; Pro als Einmalkauf (5/25/100
Videos, 1080p, 60 fps). Eigenwerbung: 20 000 Videos am Tag. Store-Rezensionen: Login-Probleme, Einfrieren,
knapper Gratistarif. Kern: **Reiseplan-Animation**, nicht Track-Aufbereitung.

**mapanim.com** (Web + iOS/Android, Shenzhen Tapyin): Routen-Animation, „3D-Flyover" mit Fahrzeugen,
GPX-Import, KI-Routen aus Text, Länder-Highlights, Globus, 4K-Export, 16:9/9:16/1:1, **lokale Verarbeitung
ohne Upload**. Free voll nutzbar mit Wasserzeichen; Pro „demnächst" (Satellit/Gelände, Premium-Stile, mehr
Fahrzeuge, Kamera-Kontrolle). Rendering-Technik nicht genannt (Optik spricht für Mapbox/MapLibre-Vektor +
eigene Fahrzeug-Sprites).

**Beide** verkaufen dasselbe Gefühl: null Einstellungen, in einer Minute ein hübsches Video fürs Handy.
Beide leben von Anbieter-Karten (Mapbox/Google) — die Video-Rechte tragen die Nutzer, nicht das Tool.

## 2. Was wir übernehmen (konkret, in dieser Reihenfolge)

1. **Fahrzeug auf der Strecke.** Ein kleines 3D-Modell (Wanderer, Rad, Auto, Boot, Flieger) läuft am
   Kopf der Linie mit, richtet sich nach Kurs und Steigung aus. MapLibre-Custom-Layer mit three.js, ein
   Modell je Tourart aus `einteilung`. Das ist der sichtbarste Unterschied in jedem Vergleichsvideo.
2. **Anreise aus Text.** Für die Reiseroute (nicht für Touren!): „Berlin → Tenerife (Flug) → Masca
   (Auto)" tippen, Photon/OSRM bauen die Anreise. Bleibt innerhalb des Nordsterns: die Tour selbst kommt
   immer aus dem Track.
3. **Ein Klick, fertig.** Vorlagen und Looks haben wir; es fehlt der Knopf „Mach mir ein Video" — Vorlage
   je Tourart, Look Natürlich, Schilder aus Highlights, 20 s, Hochkant + Quer gleichzeitig.
4. **Fotos an Stationen** sind unsere Schilder — mehr Automatik: Foto-Zeit → Stelle, Aufpoppen mit
   kleinem Rand, drei Schilder-Stile als Vorlage.
5. **Musik** mit Beat-Markern für Kamera-Schnitte (wir haben Keyframes; Beats setzen sie).
6. **Hochkant-first**: 9:16-Vorschau als Standardfall neben 16:9, Overlays für die Handykante gedacht.

Nicht übernehmen: Städte-Reiseplaner als Hauptfunktion, Cloud-Zwang, Wasserzeichen-Geschäftsmodell.

## 3. Richtig gute Karten selber bauen — die Optionen

### A. Unreal Engine 5 + Cesium
Fotoreal, Licht, Wolken, Wasser — die Referenz. **Aber:** Cesium World Terrain/Photogrammetrie kommt aus
Cesium ion (kommerziell kostenpflichtig), Google-3D-Tiles haben eigene Terms (Video-Nutzung prüfen, Earth
Studio ist nicht kommerziell), UE ist 30+ GB und nichts, was ein Tester mit dem Tool installiert. Realistisch
nur als **Marcs eigene Hero-Pipeline** (Kamerapfad-Export aus GPS Studio → UE), wie schon in der Vision
„Fotoreal-Rendering" festgehalten. Nicht als Produktkern.

### B. Blender als Render-Backend (kopflos)
Blender ist frei, skriptbar, läuft ohne Fenster. GPS Studio exportiert Gelände (DEM) + Luftbild + Track +
Kamerapfad als Szene, Blender rendert mit echter Sonne, Schatten, Nebel, Wolken, Wasser-Shader. Ergebnis
sieht aus wie ein Flug im Flugzeug, nicht wie eine Karte. Kosten: Nutzer installiert Blender (400 MB),
Renderzeit Minuten statt Sekunden, zweite Pipeline zu pflegen. **Als „Cinematic Render"-Knopf** für das
eine Hero-Video eines Kanals realistisch; für jedes Alltagsvideo zu schwer.

### C. Unser eigener Weg — die Karte im Tool zu Ende bauen (Empfehlung)
Wir haben, was keiner der beiden hat: **amtliche Luftbilder in 20 Ländern + freie Höhendaten + eigenen
Kompositor** — alles ohne fremde Video-Rechte. Der Abstand zu Google/Mapbox entsteht nicht an der Kachel,
sondern am **Licht** und an der **Höhe**. Vier Stufen, jede für sich sichtbar:

1. **Echtes Licht.** Sonne nach Datum/Uhrzeit des Tracks (core/sun.py kann das), **Schlagschatten** aus
   dem Gelände (Shadow-Map im Custom-Layer, wie die Schärfe), Dämmerung als Farbtemperatur. Ein Sonnen-
   untergang über dem Teide ist dann ein Sonnenuntergang. Aufwand: ein Shader, zwei Wochen.
2. **Höhe, die zum Luftbild passt.** AWS-Terrarium ist ~30 m; die Länder liefern 1-m-DGM frei (DE-Länder,
   AT, CH swissALTI3D, ES, DK, NL, NO …). Ein Weiche-Endpunkt `terrain-<land>` wie bei den Luftbildern:
   Felsen, Hohlwege, Deiche werden Form statt Textur. Ohne neue Lizenzfrage (dieselben Ämter).
3. **Atmosphäre.** Entfernungsdunst, Himmelskuppel mit Sonne, leichte Tiefenschärfe bei niedriger Kamera.
   Fünf Regler, ein Look „Filmisch" schaltet sie an.
4. **Dinge auf der Karte.** Gebäude aus OSM extrudiert (OpenFreeMap liefert die Höhen), Wald als Sprite-
   Feld aus landuse=forest, Wasser mit leichtem Glanz. Nicht fotoreal, aber „bewohnt".

Danach erst lohnt Stufe B (Blender) für die, die noch mehr wollen — und die Szene dafür fällt aus C ab.

### D. Ganz anders gedacht
- **KI-Hochskalierung der Sentinel-Kacheln** (lokal, einmal je Kachel, in den Zwischenspeicher): 10 m →
  gefühlt 2,5 m. Rechtlich sauber (CC BY, „bearbeitet"), technisch ein ESRGAN-Modell im Bundle. Löst das
  Problem genau dort, wo es wehtut (kein Landesdienst).
- **Eigene Satelliten-Jahrgänge:** Sentinel-2 2016 ist alt; aus Copernicus Open Access lässt sich ein
  wolkenfreies Mosaik selbst rechnen (Datenschutz null, Rechte CC BY). Serverlast auf unserer Seite —
  passt nur, wenn GPS Studio Geld verdient (Selbsttragend-Regel).
- **Höhenprofil-Schnitt als 3D-Kulisse:** die Tour als Band im Raum vor dem Gelände — ein Look, den
  niemand hat.

## 4. Was ich vorschlage
Reihenfolge nach Wirkung je Stunde: **2.1 Fahrzeug** → **3.C.1 Licht + Schatten** → **3.C.2 Landes-DGM**
→ **2.3 Ein-Klick-Video** → 3.C.3 Atmosphäre → 3.D KI-Hochskalierung → 3.C.4 Gebäude/Wald → 2.2 Anreise
aus Text. Blender/UE bleiben Marcs Hero-Pipeline, nicht Produktkern. Vor dem ersten Schritt: ein
Vergleichsvideo (mult.dev, mapanim, wir) derselben Tour — das ist die Messlatte für alles danach.
