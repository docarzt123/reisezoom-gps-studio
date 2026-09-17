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
  Vorhanden: alle 15 deutschen Flächenländer + Berlin/Bremen, LU, CH, NL, AT, CZ, EE, PT, FR, ES, IT, PL, JP, US.
- **Überall sonst** fällt die App auf **EOX Sentinel-2 cloudless 2016 (10 m)** zurück. Das ist der Grund für
  „matschig": ab etwa z13 kommt kein Detail mehr dazu, dazu ein blauer Dunstschleier und flaches Licht.
- Mapbox wirkt zusätzlich „schöner", weil Satellit dort mit Beschriftung, Relief und abgestimmter Farbgebung
  ausgeliefert wird — nicht nur wegen der Auflösung.

## 3. Plan: Optik selbst verbessern (nach Wirkung sortiert)

1. **Mehr Länder mit Orthofotos.** Fehlen u. a. DK, SE, NO, FI, BE, IE, UK, SI, HR, SK, LV, LT, IS, CA.
   Je Land: Dienst finden, Lizenz und `commercial_video` prüfen, Eintrag in `core/kartenquellen.py` +
   Rechteck in `core/mapstyles.py`. Wirkung: dort sofort besser als Mapbox. Aufwand: Recherche, gut portionierbar.
2. **Relief unter die Luftbilder.** Hillshade aus den ohnehin geladenen AWS/Mapzen-Geländedaten; gibt Sentinel
   Tiefe, keine neue Quelle, keine neue Lizenz.
3. **Fertige Looks statt sechs Regler.** Sättigung/Kontrast/Helligkeit/Farbton/Schärfe existieren schon
   (Luftbild-Optik). Drei Voreinstellungen je Quelle („Natürlich", „Kräftig", „Filmisch") holen aus demselben
   Bild mehr heraus, ohne dass jemand schrauben muss.
4. **Dunst raus, nachschärfen.** Feste Kurve gegen den blauen Schleier + Unsharp-Mask beim Rendern —
   bei 10-m-Material der größte sichtbare Gewinn.

**Nächster Schritt (offen, noch nicht gebaut):** Vergleichsrender derselben Tour — (a) Mapbox, (b) freier Pfad
wie heute, (c) freier Pfad mit Relief + neuer Kurve. Erst danach entscheiden, wie viel Aufwand in 1–4 fließt.

**Nicht tun:** Videorechte „für alle Nutzer" kaufen (Lizenz hängt am Nutzerkonto) · Mapbox-Kacheln
zwischenspeichern und ausliefern (Product Terms) · Esri/Bing/Google-Luftbilder ohne geprüften Vertrag
einbauen · CyclOSM/HOT für Video freigeben (Server-Regeln, nicht Lizenz).
