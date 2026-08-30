# Geräte, Formate und Geotagging-Werkzeuge 2026

**Stand: 30.08.2026** · 55 Suchen/Abrufe · Unbestätigtes ist markiert

> Mehrere auffindbare „2026-Vergleichsseiten" (stamptivity.app, gpxchunk.com,
> trailblender.com, fitmesh.fit, geo-tag-it.com) sind SEO-Produktseiten mit eigenem
> Verkaufsinteresse — deren Aussagen sind hier nur übernommen, wo eine zweite Quelle
> sie stützt.

---

## Teil A · Was zeichnet auf, und was kommt heraus?

### A.1 Die vier Basisformate

| Format | Typ | Wer schreibt es | Sensordaten | Zeitbasis |
|---|---|---|---|---|
| **GPX** (1.0/1.1) | XML, offen | Handy-Apps, Portale, alle Exporte | Nur Lat/Lon/Ele/Time nativ. Sensorik nur über `TrackPointExtension` (Garmin-Namespace): `hr`, `cad`, `atemp`, `power` | **UTC**, verpflichtend |
| **FIT** | Binär, Garmin/ANT | Garmin, Wahoo, Suunto, Polar, Coros, Sigma, Hammerhead, Bryton, iGPSPORT | Vollständig: HF, Trittfrequenz, Leistung, L/R-Balance, Temperatur, Baro-Höhe, Gänge, Laps, Device-Info, Developer Fields | Sekunden seit **FIT-Epoche 31.12.1989 UTC** |
| **TCX** | XML, Garmin-Altlast | Polar, Coros-Bulk, Fitbit-Export | HF, Cadence, Distanz, Laps — kein Leistungsstandard | UTC |
| **KML/KMZ** | XML, Google | inReach, Coros, Gaia | praktisch keine | UTC |

Dazu **IGC** (Luftsport), **NMEA 0183** (Logger, Dashcams, Marine), **UBX**
(u-blox-Rohdaten), **SRT** (DJI-Untertitel-Telemetrie), **GPMF** (GoPro, im MP4-Track).

**Für die Architektur entscheidend: GPX ist der kleinste gemeinsame Nenner, FIT ist
der einzige Container mit voller Sensorik.** Wer nur GPX importiert, verliert bei
Sportlern systematisch Leistung, Trittfrequenz und die barometrische Höhe.

### A.2 Smartwatches und Sportuhren

| Marke | Format | Exportweg | Hürde |
|---|---|---|---|
| **Garmin** | FIT (Original), zusätzlich TCX/GPX/KML | Connect Web einzeln; Bulk über „Export Your Data" (ZIP, 24–48 h) | Bulk liefert Rohdatenwust; API nur über Partnerprogramm |
| **Apple Watch** | **kein natives GPX** | Nur über HealthKit-Drittapps: HealthFit, RunGap, WorkOutDoors; Apple-Health-Gesamtexport enthält Route-GPX im ZIP | **Größte Hürde im Konsumentenbereich.** Ohne Drittapp kein Dateizugriff |
| **Suunto** | FIT oder GPX | App → Workout → Drei-Punkte-Menü | Kein TCX/KML/CSV. Auf Android **kein GPX ohne GPS-Aufzeichnung**. Internes SML undokumentiert |
| **Polar** | TCX, CSV, FIT, GPX | Flow Web → Diary | vergleichsweise offen |
| **Coros** | GPX, TCX, FIT, KML | App einzeln; Training Hub für Bulk | gut; Community-Tools für Automatisierung |
| **Amazfit/Zepp** | GPX, TCX, FIT einzeln | pro Workout | **Bulk-Export liefert nur CSV** |
| **Samsung Health** | GPX, stark eingeschränkt | pro Aktivität, nur mit GPS | Export **nur Gehen, Wandern, Radfahren**; Laufen laut Community entfernt (**unbestätigt**). Automatisch erkannte Workouts: gar nicht |
| **Withings** | **offiziell nur CSV** | „Download my data" | Kein GPX/TCX/FIT ab Werk |
| **Fitbit/Google** | TCX; Vollexport via Takeout | Google-Konto | Legacy-Konten seit 2025 abgeschafft |
| **Huawei Health** | **praktisch gesperrt** | nur Aktivitäten mit Kartenspur; sonst DSGVO-Auskunft → JSON → externer Konverter | **Härtester Fall.** Seit **Juli 2024** Formatbruch: die Rohdaten, auf denen `Hitrava` aufsetzte, sind verschwunden |

### A.3 Radcomputer

FIT ist durchgängig Standard. **Garmin Edge** (auch per USB aus `/Activities/`),
**Wahoo** (FIT über Companion App, **kein direkter GPX-Export**), **Hammerhead Karoo**,
**Sigma ROX**, **Bryton**, **iGPSPORT** (von Insta360 Studio als Quelle unterstützt).

### A.4 Handy-Apps

**Strava** hat zwei verschiedene Exporte: „Export GPX" (mit Stravas *korrigierter*
Höhe) und „Export Original" (rohes FIT/TCX). **Komoot** exportiert GPX nur, wenn die
Startregion freigeschaltet ist — de-facto-Paywall. **OsmAnd** schreibt externe
Sensordaten vorbildlich im Garmin-`TrackPointExtension`-Schema. Dazu Locus, Gaia,
Outdooractive, Organic Maps, GPSLogger.

### A.5 Logger und Tracker

**Garmin inReach** — Export über `explore.garmin.com` als KML oder GPX; Fallstrick:
Punkte landen erst nach einem Sync im Portal, und es gibt zwei Spuren
(10-Minuten-MapShare vs. 1-Minuten-Detail-Log auf dem Gerät). **Bad Elf** loggt intern
UBX. **Qstarz, Columbus, Holux** — NMEA bzw. MTK-Binär, sauber von **GPSBabel** abgedeckt.

### A.6 Action-Cams

| System | Träger | Inhalt |
|---|---|---|
| **GoPro GPMF** | eigener Track im MP4 | `GPS5` (ältere Modelle), **`GPS9`** (neuere) zusätzlich mit DOP und Fix-Status; dazu `ACCL`, `GYRO`, `GRAV`, Temperatur |
| **Insta360** | `.insv`/`.insp` | GPS **nur mit GPS-Remote** oder importiert aus Uhr/Radcomputer. Studio bietet „Export GPX File" |
| **DJI** | **`.SRT`-Sidecar** (Drohnen), GPS im Stream (Osmo Action) | GPS, Höhe, Speed, Gimbal-Winkel |
| **Dashcams** | im MP4 | BlackVue schreibt „fast NMEA"; **Strom ~2 s versetzt zum Video** |

Freie Parser für GPMF: `gopro/gpmf-parser` (C), `gopro-telemetry` (JS),
`py-gpmf-parser`, `telemetrik` (reines Python, ohne FFmpeg-Abhängigkeit).

**Insta360 × Garmin:** Integration ursprünglich **Dezember 2023** angekündigt, seither
auf die ganze Linie ausgeweitet (Ace Pro 2, X4 Air, GO Ultra). Studio importiert GPX
oder FIT aus Garmin, Apple Health, COROS, iGPSPORT, Huawei (ab v5.7.6;
Garmin-Direktimport ab v5.8.6).

### A.7 Sonderwelten

**IGC** (Gleitschirm, Segelflug) — Textformat der FAI seit Dezember 1994. B-Records
enthalten Position plus **GPS- und barometrische Höhe getrennt**. Optionale digitale
Signatur (G-Record), prüfbar über den FAI-Validierungsserver. Erzeuger: Volkslogger,
LXNAV Nano, FLARM, XCTrack, XCSoar, LK8000.

**Tauchen** — Garmin Descent schreibt FIT; **Subsurface** kann es importieren, „nicht
ohne Probleme". Austauschformat der Szene ist **UDDF**; die Garmin-Dive-App akzeptiert
aber nur eigene FIT-Dateien.

### A.8 Die strategisch wichtigste Sektion: Plattform-APIs

**Strava — der Bruch vom 11.11.2024.** Drei Klauseln:
1. **Anzeigeverbot** — Drittanbieter dürfen Strava-Daten *nur dem Dateneigentümer
   selbst* zeigen; nicht Trainern, nicht in Feeds, nicht in Heatmaps.
2. **KI-Verbot** — keine Nutzung „for any model training related to artificial
   intelligence, machine learning or similar applications".
3. **Design-Klausel** — Stravas Look-and-Feel darf nicht nachgebaut werden.

Kritisiert wurde zusätzlich die Formulierung, Apps dürften Daten nicht verarbeiten
„for the purposes of … analytics, analyses, customer insights generation" — was
praktisch jede Auswertung trifft. Strava behauptete, weniger als 0,1 % der Apps seien
betroffen; faktisch traf es **Intervals.icu, VeloViewer, Relive, TrainerRoad, Xert,
Final Surge**. Partner bekamen ~30 Tage Frist, mitten in der Weihnachtszeit.

**Strava 2026 — Kostenpflicht.** Der **Standard Tier setzt ein aktives Strava-Abo
voraus** (11,99 USD/Monat); Stichtage **01.06.2026** für neue, **30.06.2026** für
bestehende Entwickler. Standard Tier soll auf **10 Nutzer** begrenzt sein
(**unbestätigt**). Ratelimits: 200 Requests/15 min, 2.000/Tag.

> **Fazit Strava: Als Datenquelle für ein Nachbearbeitungstool ist die API 2026
> strategisch tot** — abo-pflichtig, nutzerbegrenzt, mit Anzeige- und Analyseverboten
> belegt. Der einzig belastbare Weg ist der **manuelle Nutzer-Export**. Das ist keine
> Einschränkung, sondern die Empfehlung.

**Garmin.** Health und Activity API laufen nur über das partner-approval-only
Developer Program. Berichte, das Programm sei ausgesetzt und Gebühren lägen bei
~5.000 USD, stammen aus Sekundärquellen (**unbestätigt**). Inoffizielle Skripte
simulieren Browser-Sessions und brechen regelmäßig. **Auch hier: Datei-Import statt API.**

### A.9 Bekannte Datenfehler

- **Höhe.** GPS-Höhe irrt typisch um 10–30 m. Barometrische Höhenmesser sind präziser,
  **driften aber über lange Touren**. Direkt nach dem ersten Fix ist die Höhe oft grob
  falsch → charakteristischer Drift in den ersten Minuten.
- **Ausreißer.** Einzelne Punkte mit falschen Koordinaten erzeugen Phantom-Distanz.
  Praxis-Gegenmittel: gleitender 5-Punkte-Mittelwert für die Höhe, **MAD-Filter**
  (Median Absolute Deviation) gegen Einzelspitzen.
- **Urban Canyon / Tunnel.** Reflexion an Fassaden, Abschattung im Gebirge → „Teleports",
  schnurgerade 500-m-Linien durch den Wald.
- **Android Doze.** Häufigster Grund für Löcher in Handy-Tracks: Das System killt die
  Hintergrund-App. Energiesparmodi verschlechtern zusätzlich die GPS-Genauigkeit.

---

## Teil B · Foto- und Video-Geotagging

### B.1 Foto-Werkzeuge

| Tool | Plattform | Track-Formate | Zeitversatz/Zone | Richtung | Umkehr-Geokodierung | Preis (Stand) | Status |
|---|---|---|---|---|---|---|---|
| **ExifTool** (CLI) | alle | GPX, NMEA, KML, IGC, CSV u. v. m. | `Geosync`, `Geotime` mit expliziter Zone | ja | nein | frei | **Referenz, lebendig** |
| **HoudahGeo 7.2** | macOS | **GPX, NMEA, Garmin FIT, Wintec TES** | ja | ja | **5 Dienste, inkl. offline** | **39 USD** perpetual (2026) | aktiv, als GeoSetter-Nachfolger positioniert |
| **Lightroom Classic** | Win/macOS | **nur GPX** | Offset einstellbar | begrenzt | rudimentär | Abo | **lebt**, aber: Maps-View starb im ewigen LR 6.14 am 30.11.2018; nach einer Google-Änderung braucht die Suche **LrC ≥ 14.2**. **Lightroom Cloud hat gar kein Map-Modul** |
| **GeoTagNinja** | Windows | via ExifTool alles | ja | ja | ja | frei, OSS | aktiv (Build 07.06.2026) |
| **GeoSetter** | Windows | GPX u. a. | ja | ja | ja | frei | **nicht offiziell tot**, aber faktisch stehengeblieben |
| **digiKam** | alle | GPX | Zone + Offset, Toleranz 30 s | ja | ja | frei | aktiv |
| **darktable** | alle | GPX | Offset + Zonenfeld, **GPX ist immer UTC** | teilweise | nein | frei | aktiv |
| **Photo Mechanic Plus** | Win/macOS | GPS-Logs mit Offset **und Interpolation** | ja | ja | begrenzt | **149–249 USD/Jahr** | aktiv |
| **Capture One** | Win/macOS | — | — | — | — | Abo/Perpetual | **kann kein Geotagging.** GPS lässt sich nicht einmal zwischen Bildern kopieren |
| **Apple Fotos** | macOS/iOS | — | — | — | ja | frei | **schreibt in die Bibliotheks-DB, nicht ins Original** |

### B.2 Video-Overlay

| Tool | Status | Preis |
|---|---|---|
| **Telemetry Overlay** | **Marktführer, aktiv** — GoPro, DJI, Insta360, Garmin FIT, GPX, KML, NMEA, IGC, CSV, VBOX | **199 USD** einmalig + 1 Jahr Updates |
| **RaceRender 3** | aktiv, Motorsport-Fokus | unbestätigt |
| **Garmin VIRB Edit** | **tot.** End-of-Life; bekannter „Maps JavaScript API"-Fehler | — |
| **Dashware** | **tot.** Läuft nicht mehr unter Windows 11 / modernem macOS | — |
| **Insta360 Studio** | aktiv, aber begrenzt | frei |

**Nutzerkritik an Insta360 Studio:** Stats lassen sich **nur bei flachen Videos
exportieren, nicht bei 360°-Material**, und die Beschriftungen gibt es **nur auf
Englisch**. Außerdem: `.insv` wird von fast keinem Fremdtool direkt gelesen.

---

## Welche Import-Quellen ein Weltklasse-Tool 2026 beherrschen muss

**Priorität 1 — ohne das unbrauchbar**
1. **GPX 1.0/1.1** inkl. `TrackPointExtension` und toleranter Namespace-Behandlung
2. **FIT** (Decoder mit Profilen, Developer Fields, Laps) — ohne FIT keine Leistungs-,
   Trittfrequenz- und Barodaten, und keine Garmin-/Wahoo-/Suunto-/Polar-/Coros-Nutzer
3. **TCX** — Polar, Coros-Bulk, Fitbit
4. **GoPro GPMF** direkt aus dem MP4 (GPS5 *und* GPS9) — vier freie Parser existieren
5. **Insta360**: GPX-Beileger aus Studio **und** Extraktion aus `.insv` via ExifTool

**Priorität 2 — erwartet der ambitionierte Nutzer**
6. **DJI `.SRT`** · 7. **KML/KMZ** (einziger inReach-Weg) · 8. **CSV mit
konfigurierbarem Spalten-Mapping** (Auffangbecken für Withings, Zepp, Huawei, Fitbit,
RaceChrono) · 9. **NMEA 0183** · 10. **Apple-Health-Route-GPX**

**Priorität 3 — Differenzierung**
11. **IGC** inkl. getrennter GPS-/Baro-Höhe — kein Consumer-Tool kann das ordentlich,
Luftsportler sind eine dankbare Nische · 12. **UDDF/Descent-FIT** fürs Tauchen ·
13. **Multi-Datei-Verkettung** · 14. **GPSBabel als Fallback** für alles Exotische

**Bewusst NICHT bauen:** Strava-API (abo-pflichtig, nutzerbegrenzt, Anzeige- und
Analyseverbote), Garmin-Connect-API (partner-only), inoffizielle Scraper.
**Stattdessen: exzellenter Datei-Import mit Drag-and-Drop und Format-Autoerkennung** —
der einzige rechtssichere und dauerhaft stabile Weg.

---

## Wo die technischen Fallen sind

**Zeit — die größte Fehlerquelle**
1. **FIT-Epoche ist der 31.12.1989 UTC**, nicht Unix-Zeit. Wer Unix annimmt, liegt
   20 Jahre daneben.
2. **Lokalzeit im FIT** ist nur aus `local_timestamp` − `timestamp` ableitbar — es gibt
   kein Zeitzonenfeld.
3. **Bekannter Garmin-Bug:** Bei negativem Zeitzonen-Offset läuft `time_offset` über
   32 Bit über. Korrektur: 0x1000000 subtrahieren.
4. **GPX ist immer UTC**, Kamerazeit ist lokal — mit Sommerzeitversatz und Uhrendrift.
   Ein Geotagger braucht drei getrennte Stellschrauben: Kamera-Offset, Kamera-Zone,
   Toleranzfenster.
5. **BlackVue-Dashcams:** NMEA-Strom rund 2 s versetzt zum Video.

**Höhe und Position**
6. **Zwei Höhenquellen mit unterschiedlichem Charakter.** GPS rauscht (±10–30 m), Baro
   driftet über die Zeit. Beide dürfen nicht identisch behandelt werden — IGC führt sie
   bewusst getrennt.
7. **Der erste Fix ist unbrauchbar** — Höhendrift in den ersten Minuten.
8. **Ausreißer vor der Distanzberechnung filtern**, sonst summiert sich Phantomstrecke.
   MAD-Filter statt naivem Mittelwert, sonst werden echte Steilstücke plattgebügelt.
9. **Lücken sind Lücken, keine Geraden.** Tunnel und Doze-Ausfälle dürfen nicht linear
   interpoliert werden, ohne das kenntlich zu machen.

**Formate und Quellen**
10. **Strava „Export GPX" ≠ „Export Original".** Ersteres trägt Stravas *korrigierte*
    Höhe. Ein Tool sollte den Unterschied erkennen und benennen.
11. **`.insv` ist kein MP4** — Fremdtools brauchen den Studio-Export.
12. **Samsung und Huawei liefern strukturell unvollständig.**
13. **GPX-Sensordaten sind Extension, kein Standard.** Namespace-Präfixe variieren;
    Garmin Connect exportiert `ns3:hr` statt `gpxtpx:hr` — wer auf den Literal-String
    prüft, findet in Millionen intakter Dateien keine Herzfrequenz.

**Recht und Betrieb**
14. **Nominatim ist kein Massendienst:** max. 1 Request/Sekunde, aussagekräftiger
    User-Agent Pflicht, Bulk-Umkehrgeokodierung ausdrücklich unerwünscht.
15. **Google-Maps-Abhängigkeit ist ein Zeitbombenrisiko** — Adobe hat es zweimal
    getroffen (2018 Maps-View tot, 2025 Suche gebrochen).
16. **Schreiben ins Original vs. Sidecar.** Apple Fotos schreibt in die
    Bibliotheksdatenbank — Nutzer glauben, ihre Dateien seien getaggt, und sie sind es
    nicht. Bei RAW gilt XMP-Sidecar als sicherer Standard.
17. **Video-Geotagging ist nicht Foto-Geotagging.** ExifTool schreibt QuickTime-GPS an
    drei mögliche Orte (ItemList, UserData, Keys) — welcher gelesen wird, hängt vom
    Zielprogramm ab.
18. **Nicht auf tote Software aufsetzen.** VIRB Edit und Dashware sind End-of-Life.
