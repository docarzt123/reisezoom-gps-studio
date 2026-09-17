# Karten-Optik und Veröffentlichungsrechte

*Stand 17.09.2026. Anlass (Marc): „User beschweren sich, dass die Karten nicht mehr so schön sind wie bei
Mapbox — sie wollen sie aber veröffentlichen." Diese Datei ist die Wahrheit zu beidem: was rechtlich gilt und
was wir an der Optik selbst machen können.*

## 1. Rechtslage (recherchiert 17.09.2026)

### Mapbox — Video ist ausgeschlossen, außer in zwei Fällen
Mapbox Product Terms, Fassung **1. Oktober 2025**, §1.7 „Print or Video Use":

> „Customer may not use any Licensed Map Content in any printed or video media except expressly as set forth
> in this Section. […] Video media are limited to video media distributed by Internet, cable, and satellite."

- **§1.7.1** — Video ist erlaubt, wenn es die **eigene Anwendung bewirbt** und die Karte darin nur
  *„only incidentally"* vorkommt. Ein GPS-Studio-Tutorial fällt darunter, eine Tour-Animation nicht.
- **§1.7.2** — Über Studio sind **100 hochauflösende Standbilder** je Konto erlaubt (Lebenszeit). Für Video
  gibt es kein solches Freikontingent.
- **§1.7.4** — Alles andere braucht **gekaufte Videorechte** über den Vertrieb
  (https://www.mapbox.com/contact/sales/), nicht im Self-Service.
- Gilt unabhängig von Monetarisierung: auch ein unmonetarisiertes YouTube-Video ist nicht abgedeckt.
- **Wenn Rechte da sind**, verlangt Mapbox im Video: Mapbox-Logo + „© Mapbox © OpenStreetMap", bei Satellit
  zusätzlich „© Maxar". Der „Improve this map"-Link darf im Video entfallen (Links nicht klickbar).
  Quelle: https://docs.mapbox.com/help/dive-deeper/attribution/

**Für die Nutzer heißt das:** Wir können keine Videorechte „für sie mitkaufen" — die Lizenz hängt am
jeweiligen Mapbox-Konto. Jeder Nutzer müsste selbst einen Vertrag schließen.

### MapTiler — die einzige bezahlbare Option mit ausdrücklichem Video-Recht
- **Flex, 30 $/Monat**: Videos für Internet-Kanäle **bis 100.000 Abonnenten**, Nennung sichtbar im Bild
  („Attribution is required unless exempted in a custom license").
- Gratistarif: **nicht** kommerziell. TV, Film, Streaming oder größere Kanäle: eigener Materialvertrag.
- Eigener API-Schlüssel ist Pflicht. Quellen: https://www.maptiler.com/cloud/geolayers/ ·
  https://www.maptiler.com/terms/cloud/
- GPS Studio unterstützt MapTiler bereits (Stil-Schlüssel `maptiler_*`).

### Was die App heute daraus macht
`core/kartenquellen.py` (38 Einträge) führt je Dienst Lizenz, Nennung, `commercial_video` und Prüfdatum;
`core/mapstyles.py` macht daraus die Abzeichen `free` / `key` / `video_rights` und `video_ok()`.
Mapbox und MapTiler stehen auf `license_required`, CyclOSM und HOT auf `video_no` (Server-Regeln),
alles andere auf `true`. Die Rechte-Tabelle steht in den Einstellungen → Karten → Überblick.

## 2. Warum die freien Karten stellenweise schlechter aussehen

- **Wo staatliche Orthofotos existieren, sind sie besser als Mapbox** (20–50 cm statt ~50 cm Maxar, aktueller).
  Vorhanden: alle 15 deutschen Flächenländer + Berlin/Bremen, LU, CH, NL, AT, CZ, EE, PT, FR, ES, IT, PL, JP, US;
  seit 17.09.2026 dazu BE (Flandern + Wallonien) und SK.
- **Überall sonst** fällt die App auf **EOX Sentinel-2 cloudless 2016 (10 m)** zurück. Das ist der Grund für
  „matschig": ab etwa z13 kommt kein Detail mehr dazu, dazu ein blauer Dunstschleier und flaches Licht.
- Mapbox wirkt zusätzlich „schöner", weil Satellit dort mit Beschriftung, Relief und abgestimmter Farbgebung
  ausgeliefert wird — nicht nur wegen der Auflösung.

## 3. Plan: Optik selbst verbessern (nach Wirkung sortiert)

1. **Mehr Länder mit Orthofotos.** Fehlen u. a. DK, SE, NO, FI, IE, UK, SI, HR, LV, LT, IS, CA (BE und SK seit 17.09. drin, s. §4).
   Je Land: Dienst finden, Lizenz und `commercial_video` prüfen, Eintrag in `core/kartenquellen.py` +
   Rechteck in `core/mapstyles.py`. Wirkung: dort sofort besser als Mapbox. Aufwand: Recherche, gut portionierbar.
2. **Relief unter die Luftbilder.** Hillshade aus den ohnehin geladenen AWS/Mapzen-Geländedaten; gibt Sentinel
   Tiefe, keine neue Quelle, keine neue Lizenz.
3. **Fertige Looks statt sechs Regler.** Sättigung/Kontrast/Helligkeit/Farbton/Schärfe existieren schon
   (Luftbild-Optik). Drei Voreinstellungen je Quelle („Natürlich", „Kräftig", „Filmisch") holen aus demselben
   Bild mehr heraus, ohne dass jemand schrauben muss.
4. **Dunst raus, nachschärfen.** Feste Kurve gegen den blauen Schleier + Unsharp-Mask beim Rendern —
   bei 10-m-Material der größte sichtbare Gewinn.

## 4. Gebaut am 17.09.2026 (Schritte 2–4)

**Vergleichsrender** (Teide-Tour, 1280×720, Einzelbilder aus `render_frame`; Kopien auf dem Schreibtisch
`20260917-*-Kartenvergleich_*.png`): (a) Mapbox Satellit, (b) frei wie bisher, (c) frei „Natürlich",
(d) frei „Kräftig"; dazu ein Sentinel-only-Ausschnitt (Geiranger, kein Landesdienst).
Befund: **Wo ein Landesdienst liegt (PNOA), ist der freie Pfad schon vorher schärfer als Mapbox** — die
Beschwerde betrifft die Sentinel-Gegenden. Dort bringt das Relief die Tiefe, der Dunst-Abzug nimmt den
blauen Schleier, die Schärfe den Matsch. Erster Wurf des Dunst-Abzugs machte das Meer schwarz → Schatten
unter ~6 % Helligkeit bleiben unangetastet (Einblendung bis 30 %).

Umgesetzt (Vorschau = Video, Undo überall, nicht in den Leaflet-Exporten):
- **Relief** — Hillshade-Ebene `rz-hillshade` aus der AWS-Geländequelle (Weiche, Meerestiefen geklemmt) über
  dem Luftbild-Stapel, unter der Beschriftung. Regler `ortho_relief`, Werk 0 (Marc 18.09.: „lass den, aber default ist 0" —
  das Gelände wirkte ihm mit Relief „runder"); die Looks stellen 35/50/60 %. `core/mapstyles.py`
  (`stack_style`, `relief_paint`), Spiegel `util.js/_stackStyle`, live `rz-mapadjust.js`.
- **Dunst entfernen** — Uniform `u_haze` im Schärfe-Shader (eine Ebene): Schwarzpunkt je Kanal
  (0,10/0,13/0,20 · Regler), Blau am stärksten. Regler `map_haze`, Werk 0, in beiden Optik-Gruppen.
- **Looks** — Auswahl „Natürlich / Kräftig / Filmisch / Eigene" über den Reglern; stellt alle sieben Regler,
  speichert nichts eigenes. Werte in `module.js/_LOOKS_()`; abgestimmt an den Vergleichsbildern.
- Wächter `tests/test_karten_optik_relief_dunst.py`; Doku CHANGELOG, USER_GUIDE ×3, DEVELOPER.

**Schritt 1 (mehr Länder), Stand 17.09.2026:** neu drin **BE-Flandern** (Digitaal Vlaanderen WMS OMWRGBMRVL,
Modellicentie Gratis Hergebruik, Vermerk „Bron: Luchtopnamen Digitaal Vlaanderen"), **BE-Wallonien** (SPW ORTHO_LAST,
CC BY 4.0, Dienstbedingungen LicServicesSPW.pdf: keine unverhältnismäßige Last, Vermerke nicht entfernen) und
**SK** (GKÚ Ortofotomozaika WMS Layer 1, CC BY 4.0 laut Capabilities; die Bedingungsseite geoportal.sk war wegen
Zertifikat nicht lesbar → Nennungsformel ist unsere, bei der nächsten Registerprüfung nachlesen). Alle drei per
GetMap geprüft (`scripts/check_map_sources.py`). **Geprüft und verworfen:** HR (DGU-INSPIRE-WMS 404), LV (LVM-Host
nicht auflösbar). **18.09.2026 (Marc: „weitere Länder, definitiv kostenlos, weltweit — baue die direkt ein"):** neu **SI** (GURS
DOF5-WMS, CC BY 4.0, Capabilities „Ni omejitev"), **AU-NSW**
(Spatial Services NSW_Imagery-Kacheln, CC BY 4.0). Geprüft und verworfen: TW (NLSC PHOTO2, OGDL 1.0 — Lizenz frei, aber TWCA-Zertifikat ohne Subject Key
Identifier, OpenSSL 3 in Python lehnt ab, die Weiche liefert nie), LT (WMS „non commercial use only"), HR
(Gebühr laut Capabilities), AU-VIC (Vicmap „licensed service, access fee"), AU-QLD (Planet-Material „all rights
reserved"), LV/LI (Dienst nicht erreichbar/404). **Frei, aber nur mit eigenem Schlüssel** (kein Kandidat für den
tokenfreien Pfad, wäre ein eigener „Schlüssel"-Eintrag wie MapTiler): DK Dataforsyningen, SE Lantmäteriet (CC0!),
FI NLS (CC BY 4.0), NZ LINZ (CC BY 4.0). Keine freien Luftbilder bekannt: NO, IE, UK, IS, CA, HU, sowie fast ganz
Südamerika/Afrika/Asien — dort bleibt Sentinel-2.

**Nicht tun:** Videorechte „für alle Nutzer" kaufen (Lizenz hängt am Nutzerkonto) · Mapbox-Kacheln
zwischenspeichern und ausliefern (Product Terms) · Esri/Bing/Google-Luftbilder ohne geprüften Vertrag
einbauen · CyclOSM/HOT für Video freigeben (Server-Regeln, nicht Lizenz).
