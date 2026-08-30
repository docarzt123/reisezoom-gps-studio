# Nutzer-Painpoints bei der Nachbearbeitung von GPS-Touren

**Erhoben:** 30.08.2026 · **Methode:** ~40 Web-Suchen, ~20 Direktabrufe, Deutsch und Englisch

## Einschränkung der Quellenlage (wichtig für die Bewertung)

**Reddit war komplett gesperrt** (User-Agent-Blockade) — alle geplanten Subreddits
(r/hiking, r/bikepacking, r/Garmin, r/strava, r/gopro) fehlen. Ebenfalls nicht
abrufbar: mtb-news.de (403), Strava Community Hub (403, inkl. der Stimmenzahlen der
Ideen-Threads), Komoot-Support (403), paraglidingforum.com. YouTube-Kommentare sind
grundsätzlich nicht auslesbar.

**Konsequenz:** Die Häufigkeitsangaben unten stützen sich auf *Wiederholung über
Foren und Jahre hinweg*, nicht auf Upvote-Zahlen. Gut abrufbar waren Garmin Forums,
outdoorseiten.net, naviboard.de, gs-forum.eu, trueadventure.de, forum.mikemoto.de,
forum.cyclinguk.org, magix.info und die App Stores.

---

## 1 · Der Ayvri-Fall — die wichtigste Fallstudie

**Korrektur zur verbreiteten Annahme: Ayvri starb 2022, nicht 2023.**

Ablauf laut `ayvri.com/pages/about` (bis heute online):
- ab 05.09.2022 keine Pro-Abbuchungen und keine Upgrades mehr
- ab 01.10.2022 keine Uploads, keine neuen Szenen
- am 31.10.2022 Zugriff weg, **Nutzerdaten gelöscht**

Begründung des Anbieters: wegbrechende Erlöse von Geschäftspartnern bei gleichzeitig
steigenden Supportkosten. In Übernahmegesprächen schätzten Interessenten die Technik,
gaben der Nutzer-Community aber **keinen Wert**.

**Der entscheidende Satz für einen lokalen Konkurrenten** (Originalzitat von der
About-Seite): „Ayvri has never provided the ability to download data or scenes."
Lizenzbedingungen der Kartendaten verhinderten sowohl Offline-Zugriff als auch
Massenexport der 3D-Szenen als Video.

**Zehn Jahre Community-Inhalt** (Doarama ab 2013, Ayvri ab 2017) waren an einem
Stichtag weg, ohne jede Exportmöglichkeit. Das ist kein Feature-Painpoint, sondern
ein **Vertrauens-Painpoint** — und das stärkste Argument für „läuft lokal auf deinem
Rechner, deine Dateien bleiben deine".

**Wohin die Nutzer gingen:** Die Ayvri-Nutzerschaft war stark Gleitschirm-lastig und
wanderte in IGC-Nischenwerkzeuge ab (Gaggle, SkyViz, XCviewer, XCFinder, Ogoy).
**Für Wandern, Rad, Kajak und Motorrad gab es keinen Nachfolger.**

---

## 2 · Relive — acht Jahre konsistente Kritik

**Deutscher App Store:**
- 18.04.2025, 1 Stern: In der Gratisversion ist nicht einmal mehr das Ändern des
  Tournamens möglich
- 27.08.2018, 3 Sterne: Club-Mitgliedschaft für 9 €/Monat „nahezu unverschämt",
  fehlende iPad-App, fehlender Web-Zugang
- 03.02.2024, 4 Sterne: Sperrt das Gerät während der Bearbeitung, sind **alle
  bisherigen Schritte verloren** — kein Zwischenspeichern

**US App Store:** Funktionen, die früher gratis waren, wanderten in Relive Plus;
Tippfehler korrigieren verlangt ein Abo (19.10.2017); lange Renderzeiten trotz Abo
und gelegentlich scheiternde Video-Erzeugung (19.10.2023).

**Trustpilot:** Werbung mit 50 % Rabatt, danach automatische Abbuchung des vollen
Jahrespreises ohne Vorwarnung, Rückerstattung abgelehnt.

**Die präziseste Kritik kommt von einem Entwickler** (Peter Elmers,
`pelmers.com/gpx-replay/`), der für eine Eurovelo-6-Videoreihe ein eigenes Werkzeug
baute. Seine drei Gründe: (1) Anmeldung bedeutet E-Mail hergeben, danach wird man
„keine 24 Stunden in Ruhe gelassen"; (2) Videos nur über die **Handy-App**, nicht am
Rechner; (3) **ein einziger Versuch** pro Video, Ergebnis in **480p**, mehr Qualität
kostet 7 $/Monat.

Relives eigene Doku bestätigt den Qualitätsdeckel: ohne HD **960 × 540**; 1920 × 1080
ist Plus-Mitgliedern vorbehalten.

**Zwei oft übersehene Blocker:**
- Relive verlangt eine *vollständige* GPX mit Koordinaten, Höhe **und Zeitstempeln**.
  Wer eine **geplante** Route animieren will (aus einem Routenplaner, ohne
  Aufzeichnung), kommt nicht durch (forum.cyclinguk.org, Dezember 2020).
- Nur Smartphone-App — für alle, die am Desktop schneiden, fällt es aus
  (Africa-Twin-Forum, 24.09.2025).

**Zu Wasserzeichen:** Bei Relive **keine** belastbaren Beschwerden gefunden. Der
Schmerz dort ist Auflösung, Abo und App-Zwang. Wasserzeichen sind das Hauptthema bei
der neuen Generation von Web-Animatoren (Mapimator u. a.) und bei RaceRender.

---

## 3 · Zersplitterung statt Lösung — acht Jahre stabiles Bild

Deutsche Foren zeichnen von 2011 bis 2025 ein bemerkenswert konstantes Bild: Leute
wollen ihre Route als Animation ins Video bringen und scheitern reihum an allen
Werkzeugen.

| Quelle | Datum | Was scheiterte |
|---|---|---|
| forum.mikemoto.de | 06.06.2017 | BaseCamp „zappelnder Pfeil", Google Earth zu komplex, Doarama unbrauchbar, Relive kann kein GPX, GPX Animator veraltet; Vasco da Gama 149 € = „drei Tankfüllungen". Ernstgemeinter Rat eines Nutzers: 100+ Einzelbilder in GIMP bauen |
| gs-forum.eu | 05.03.2017 | Route Generator zwingt zum **Nachzeichnen**, Magix-Plugin zäh bei langen Routen, MapCreator 3 braucht Onlineanbindung, Vasco da Gama reduziert auf **100 Wegpunkte** |
| naviboard.de | 22.12.2020 | 400+ km: Relive nur Satellitenkarte **ohne Nordausrichtung**, After Effects zu komplex. Antwort: BaseCamp kann animieren, aber **nicht als Video exportieren** → Workaround Bildschirmrecorder |
| magix.info | 2011 + 2013 | Nur eine Karte, nur gerade Linien, sichtbare Kartenkante, keine Richtungssteuerung — über drei Programmversionen unverändert |
| trueadventure.de | 24./25.09.2025 | Google Earth Studio scheidet aus (Chrome + Google-Konto Pflicht); GPX Animator bricht mit Kartendatei-Fehler ab |

**GPX Animator** (das naheliegende freie Werkzeug) hat laut eigenen GitHub-Issues:
tote Kachelquellen (einzeln durchprobieren nötig), Java-Versionskonflikte
(`UnsupportedClassVersionError`), Kachel-Fehler bei OSM und Bing, Tracks die aus dem
Bild laufen, und im Moving-Map-Modus das Nachladen tausender Kacheln.

**Google Earth Studio** hat einen strukturellen Mangel: Es animiert **nur die
Kamera**, die Route liegt als statisches Overlay darüber. Für eine wachsende Linie
braucht man After Effects und **zwei Renderdurchgänge** (mit und ohne Pfad).

---

## 4 · Datenschutz — unterschätzt und wachsend

**Öffentlichkeit der Plattformen:** Strava-Heatmap-Vorfall 2018 (Militärbasen in
Afghanistan/Syrien). 2025 deckte eine schwedische Zeitung auf, dass Leibwächter des
Ministerpräsidenten über ihre Strava-Aktivitäten Wohnsitze, Hotels und Urlaubsziele
preisgaben. Strava schaltete **Flyby** im Oktober 2020 für alle ab und stellte auf
Opt-in um, nachdem Nutzerinnen berichteten, über die Funktion identifiziert und
belästigt worden zu sein.

**Die Datei selbst:** Ole Begemann (`oleb.net/2020/sanitizing-gpx/`) beschreibt, dass
GPX-Dateien weit mehr enthalten als Koordinaten — Extensions, Metadaten-Zeitstempel,
Geschwindigkeit, Kurs, Genauigkeitswerte —, jede App etwas anderes hineinschreibt und
eine allgemeingültige Bereinigung deshalb unpraktikabel ist.

**Marktreaktion:** Eine ganze Werkzeugklasse führt inzwischen „läuft komplett in
deinem Browser, nichts wird hochgeladen" als *Hauptverkaufsargument* — GPXto,
ViewMyGPX, GPXWay, GPX Edit Pro, TrailReplay, NeverChill. Das Open-Source-Projekt
**GeoReel** positioniert sich ausdrücklich als selbstgehostete Relive-Alternative.

**Datenschutz ist vom Nischenargument zum Standard-Verkaufsargument geworden** — aber
bislang nur bei *Viewern und Editoren*, im *Video-Rendering* praktisch unbesetzt.

---

## 5 · Content-Creator, Vereine, Guides

**Creator wollen:** MP4 statt interaktiver Webseite · kein Wasserzeichen · mindestens
1080p, besser 4K · Nordausrichtung und lesbare Ortsnamen · **transparente
Hintergründe** zum Einbetten in den Schnitt · **wiederholbare Erzeugung** (Relives
„ein Versuch, dann Schluss" ist für iteratives Schneiden unbrauchbar).

Ihr Elefant im Raum ist Aufwand: Ein Nutzer wollte eine Animation für eine 20-Tage-
Reise, nachdem er drei Tage manuell gebaut hatte — nicht skalierbar.

**Vereine, Guides, Veranstalter:** Ausbeute war dünn, und das ist selbst ein Befund.
Was existiert, dreht sich um **Auslieferung an Gäste** (Offline-Karten, GPX
bereitstellen, Outdooractive-Einbettung), nicht um Nachbearbeitung. Ein
zusammenhängendes, seit Ayvri unbedientes Bedürfnis: **mehrere Tracks gleichzeitig
animieren** (Gruppe, Rennen, Teilnehmerfeld). Belege: `gpx-player` beschreibt sich als
Alternative zu Strava Flyby (Konto-Zwang, Datenschutz), RallyGPXMerger existiert für
Sternfahrten.

---

## 6 · Rangliste der Painpoints

Sortiert nach *Häufigkeit × Schlechtigkeit der bestehenden Lösung*.
**[OFFEN]** = Marktlücke · **[TEIL]** = halbgar · **[GELÖST]** = kein Markteinstieg

| # | Painpoint | Häufigkeit | Status |
|---|---|---|---|
| 1 | Track als Video-Animation, aus echtem GPX, ohne Nachzeichnen, als MP4 | Dauerbrenner 2011–2025 | **[OFFEN]** |
| 2 | Cloud-Anbieter stirbt, Daten unwiederbringlich weg (Ayvri) | einmalig, prägend | **[OFFEN]** |
| 3 | Relive-Abo: Funktionen wandern hinter die Paywall | 8 Jahre | **[OFFEN]** |
| 4 | Nur Handy-App, kein Desktop | Dauerbrenner | **[OFFEN]** |
| 5 | Auflösung gedeckelt ohne Abo (960×540 / 480p) | Dauerbrenner | **[OFFEN]** |
| 6 | Mittelstücke aus einer Aufzeichnung entfernen (Komoot kann nur Anfang/Ende) | Dauerbrenner | **[OFFEN]** in Plattformen |
| 7 | Höhenprofil unbrauchbar (falsche Starthöhe, Luftdruckdrift, GPS-Sprünge) | Dauerbrenner | **[TEIL]** — SRTM-Ersatz ungenauer als Baro, GPSBabel kann nur konstant addieren |
| 8 | GPS-Spikes / absurde Maximalwerte (250 km/h in der Gondel) | Dauerbrenner | **[TEIL]** — nur Fremdtools, dabei gehen andere Daten verloren |
| 9 | Kartenanimatoren rosten weg (tote Kacheln, Java-Konflikte) | häufig | **[OFFEN]** |
| 10 | Google Earth Studio animiert die Route gar nicht | häufig | **[OFFEN]** |
| 11 | Geotagging: Zeitversatz Kamera ↔ GPS | Dauerbrenner | **[TEIL]** — HoudahGeo löst es (39 $, nur macOS) |
| 12 | Geotagging: Zeitzonen | häufig | **[TEIL]** |
| 13 | Track soll nicht in die Cloud | stark wachsend | **[TEIL]** — für Viewer gelöst, fürs **Rendern kaum** |
| 14 | GPX enthält mehr Privates als Koordinaten, kein Standard-Bereinigungsweg | nischig | **[OFFEN]** |
| 15 | Vergessen zu stoppen / Heimfahrt im Track | Dauerbrenner | **[TEIL]** |
| 16 | Video ↔ GPS-Synchronisation (typisch 3–4 s Versatz) | häufig bei Creators | **[TEIL]** |
| 17 | Wasserzeichen/Exportlimits der Web-Animatoren (Mapimator: 3 Projekte, 1× 720p/Monat) | neu, wachsend | **[OFFEN]** |
| 18 | Renderzeiten und Dateigrößen bei Video-Overlays (88 GiB für 5,5 h) | häufig | **[TEIL]** |
| 19 | Relive akzeptiert keine geplanten Routen (braucht Zeitstempel) | regelmäßig | **[OFFEN]** |
| 20 | Kein Video-Export aus Karten-Software (BaseCamp) | regelmäßig | **[OFFEN]** |
| 21 | Wegpunkt-Reduktion in Kaufsoftware (Vasco da Gama: 100 Punkte, 149 €) | regelmäßig | **[OFFEN]** |
| 22 | Kartenstil, Nordausrichtung, Ortsnamen nicht wählbar | regelmäßig | **[OFFEN]** |
| 23 | Mehrere Tracks / Gruppe gemeinsam animieren | regelmäßig | **[OFFEN]** für Wandern/Rad/Motorrad |
| 24 | Track-Lücken durch Tunnel/Wald → gerade Linien | häufig | **[TEIL]** |
| 25 | Fortschritt verloren, Rendering scheitert (Relive bei Gerätesperre) | regelmäßig | **[OFFEN]** |
| 26 | Onlinezwang / Kontozwang / Marketing-Mails | regelmäßig | **[OFFEN]** |
| 27 | Tracks zusammenfügen nach Akkuende | Dauerbrenner | **[GELÖST]** — gpx.studio, RouteConverter, GOTOES … |
| 28 | Zeitstempel/Zeitzone verschieben | häufig | **[GELÖST]** — GPX Time Editor, GOTOES, GPSBabel |
| 29 | GPX ansehen/analysieren | Dauerbrenner | **[GELÖST]** — Dutzende Viewer |
| 30 | FIT-Merge korrumpiert Dateien | nischig | **[OFFEN]**, kleine Zielgruppe |

---

## 7 · Die drei größten unbesetzten Felder

1. **Lokales Desktop-Rendering einer Tour-Animation als MP4.** Der Wunsch ist seit
   2011 identisch formuliert und unbefriedigt. Alle Anbieter scheitern an *einem*
   Punkt: Relive an App-Zwang, Auflösung und Abo; GPX Animator am Wartungszustand;
   Earth Studio an fehlender Routenanimation; Vasco da Gama an Preis und Detailgrad;
   BaseCamp am fehlenden Export. Wer alle fünf gleichzeitig erledigt, hat einen Markt.

2. **Datensouveränität als Produktversprechen, nicht als Fußnote.** Der Ayvri-Fall ist
   die perfekte Fallstudie, und dass der Anbieter selbst schreibt, ein Datenexport sei
   nie vorgesehen gewesen, ist ein Argument, das sich von selbst verkauft.

3. **Der Creator-Workflow als Ganzes.** Niemand deckt die Kette ab: Track säubern →
   Höhen korrigieren → Fotos geotaggen → Fotos in die Animation → 4K ohne Wasserzeichen
   → Overlay zum Video synchronisieren. Nutzer stückeln das aus vier bis sechs
   Werkzeugen zusammen, und an jeder Nahtstelle geht etwas kaputt.

**Wovon abzuraten ist:** GPX zusammenfügen, Zeitstempel verschieben, Track ansehen.
Mehrfach und gut gelöst, teils kostenlos und lokal. Als Bequemlichkeitsfunktion im
größeren Werkzeug sinnvoll — als Verkaufsargument wertlos.

---

## Quellen

[ayvri.com/pages/about](https://ayvri.com/pages/about) ·
[Crestline Soaring 07.09.2022](https://crestlinesoaring.org/topic/sad-news-incoming-ayvri/) ·
[pelmers.com/gpx-replay](https://pelmers.com/gpx-replay/) ·
[App Store DE Relive](https://apps.apple.com/de/app/relive-3d-videos-erstellen/id1201703657?see-all=reviews) ·
[App Store US Relive](https://apps.apple.com/us/app/relive-hike-ride-memories/id1201703657?see-all=reviews) ·
[Trustpilot relive.cc](https://www.trustpilot.com/review/www.relive.cc) ·
[Relive-Support Videoqualität](https://support.relive.com/kb/guide/en/what-is-the-video-quality-ckb9flOUdB/Steps/100395) ·
[Garmin Forums: Trim & GPS-Spikes](https://forums.garmin.com/apps-software/mobile-apps-web/f/garmin-connect-web/125119/trim-activities-remove-gps-spikes) ·
[outdoorseiten.net: Höhendaten anpassen](https://www.outdoorseiten.net/vb5/forum/rund-um-die-ausr%C3%BCstung/tipps-tricks-erfahrung/werkzeug-technik-messer-licht-gps-aa/87822-h%C3%B6hendaten-von-gps-tracks-anpassen) ·
[naviboard.de: Route animieren](https://www.naviboard.de/thread/65777-route-auf-karte-animieren/) ·
[forum.mikemoto.de](https://forum.mikemoto.de/viewtopic.php?t=6679) ·
[gs-forum.eu](https://www.gs-forum.eu/threads/tourenanimation-wie-kann-ich-die-route-zeichnen-lassen.133857/) ·
[trueadventure.de](https://trueadventure.de/forum/thread/16208-routen-animation-aus-gpx-datei-im-video/) ·
[forum.cyclinguk.org](https://forum.cyclinguk.org/viewtopic.php?t=142966) ·
[magix.info](https://www.magix.info/us/forum/is-travel-route-animation-really-this-limited--457226/) ·
[oleb.net: Sanitizing GPX](https://oleb.net/2020/sanitizing-gpx/) ·
[DC Rainmaker: Strava Flyby](https://www.dcrainmaker.com/2020/10/strava-flyby-feature.html) ·
[github.com/elegos/georeel](https://github.com/elegos/georeel) ·
[gpx-animator Issues](https://github.com/gpx-animator/gpx-animator/issues) ·
[Mapimator](https://mapimator.com/travel-map-animation)
