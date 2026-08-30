# Marktbericht: GPS-Track-Bearbeitung, -Reparatur und -Analyse

**Stand: 30.08.2026** · ~200 Suchen und Direktabrufe · Unbestätigtes ist markiert

## Quellenwarnung vorab

Ein erheblicher Teil der 2026er-„Best-of"-Listen zu GPX-Editoren ist maschinell
erzeugt und sachlich falsch (Beispiele: `merge-json-files.com` und
`worldmetrics.org` nennen GPS Track Editor „web-based" — es ist eine
Windows-Desktop-Anwendung; StintBox beschreibt GpxOverlay als „open-source
command-line tool, free" — es ist ein browserbasiertes Bezahlprodukt für 39–179 USD).
**Solche Sekundärquellen sind für Wettbewerbsanalysen unbrauchbar.** Reddit war
gesperrt; Nutzerstimmen stammen aus Garmin Forums, Strava Community Hub, Suunto
Community, OSM-Forum, NaviBoard, MTB-News und outdoorseiten.net.

---

## 1 · Der zentrale Befund

Der Markt zerfällt in sechs Cluster, die einander kaum überlappen. **Kein einziges
Werkzeug deckt alle sieben typischen Reparaturfälle ab und beherrscht gleichzeitig
eine breite Formatpalette.** Es gibt keinen Vollsortimenter.

---

## 2 · Die Cluster im Überblick

### 2.1 Desktop, Open Source — mächtig, alt, unbedient

**GPSBabel 1.10.0** (23.12.2024, GPL-2.0, 546 Sterne) — Formatstandard mit 70+
Formaten. `track`-Filter: pack, split, merge, move, start/stop, **faketime**,
discard, segment. Dazu simplify (Douglas-Peucker), interpolate, resample.
**Entscheidende Grenze: Der `height`-Filter kann nur eine Konstante addieren und
Geoid subtrahieren — kein DEM-Lookup.** Zweite Grenze: FIT→GPX verliert die
Leistungsmessung (Issue #397).

**GpsPrune v27** (Juli 2026, GPL, Java) — Punkt-Editor der OSM-Community. Punkte
verschieben, komprimieren, Duplikate entfernen, Fotos per EXIF korrelieren. Kein
Routing, keine Ausreißerautomatik. Java-Abhängigkeit ist Hauptkritikpunkt.

**GPXSee 16.14** (28.08.2026, GPL-3.0, 1,2k Sterne) — **breiteste Leseunterstützung
des ganzen Feldes**: GPX, TCX, FIT, KML, NMEA, IGC, CUP, SIGMA SLF, Suunto SML,
OziExplorer, TomTom, Velocitek, dazu GoPro-GPMF-, DJI-, Sony-RTMD- und
Dashcam-Videos. **Aber bewusst read-only — exportiert keine korrigierten Tracks.**
Bester Betrachter im Markt, kein Editor.

**QMapShack V_1.21.0** (21.08.2026) — der eigentliche Gewinner unter den freien
Desktop-Werkzeugen: voller Editor mit unbegrenztem Undo/Redo, Filterset für
Glättung, Resampling, Geschwindigkeit, Höhe und Zeitstempel, eigenständige DEMs mit
Hillshading. Native ARM64-macOS-Builds über den Fork `exxaxxxx/qmapshack`. Kritik:
steile Lernkurve.

**GoldenCheetah 3.7 SP1 / 3.8 RC2** — **das mächtigste Reparaturwerkzeug des
gesamten Marktes**. Data Processors: Fix GPS errors, Fix Gaps in Recording, Fix
Elevation (Open-Elevation.com), Fix Power/HR Spikes, Fix Speed from Distance,
Filter R-R Outliers u. v. m. Jeder Processor auf *None / On Import / On Save*
stellbar — echte Automatisierung. Der **Merge Wizard synchronisiert beim
Zusammenführen zweier Dateien die Zeitstempel**. Ride Editor markiert Anomalien mit
roter Wellenlinie. Schwäche: Fokus auf Leistungs- statt Kartendaten, hohe
Einstiegshürde.

**MyTourbook 26.8** — „Adjust Altitude" mit SRTM-Profilen, lokale Tourdatenbank,
Suunto-Cloud-Anbindung. Der Community-Standardweg für Suunto-Nutzer.

### 2.2 Windows-Freeware und Kaufsoftware

**RouteConverter** (kostenlos, Open Source, Java) — 90+ Formate, SRTM-Höhen,
BRouter-Snap, Trimmen, Vereinfachen, Mergen. Läuft lokal, kein Konto.
**GPS-Track-Analyse.NET 6.0.0.4** (Freeware, deutschsprachig) — SRTM-Import,
Trackpunkte auf Satellitenbild-Basis verschieben.
**GPS Track Editor 1.15.141** — Zombie: Website nur über **unverschlüsseltes HTTP**
erreichbar, Versionsdaten widersprüchlich (2015 vs. 2024, unbestätigt).
**Adze** — 20 USD, automatische Rastplatz-Erkennung mit Track-Split, kein Smoothing.
**Fit File Repair Tool** — 39 € / 45 € / 49 € (direkt verifiziert; die kursierenden
19,95 € sind veraltet). Tiefstes FIT-Werkzeug: Batch-Reparatur, Merge **mit
Zeitstempel-Synchronisation**, Zellen-Editing mit Neuberechnung.
**Erfordert Windows plus Microsoft Access.**

### 2.3 Web-Editoren — hohe Reichweite, schwache Reparatur

**gpx.studio** (MIT, 1,2k Sterne) — Reichweitenführer mit **833,8k Besuchen in drei
Monaten** (SimilarWeb, Juli 2026), Deutschland drittstärkstes Land mit 7,69 %.
Routing über GraphHopper/BRouter, Zeitwerkzeug (Start/Ende/Dauer/Tempo gekoppelt),
Höhen über **Mapterhorn**, Merge, Crop & Split, Minify mit Live-Vorschau.
**Die entscheidende Schwäche: „Clean" ist ein Rechteck-Werkzeug** — man zieht einen
Rahmen und löscht Punkte darin. **Eine automatische Ausreißererkennung existiert
nicht.** Der meistgenutzte kostenlose GPX-Editor der Welt kann die häufigste
Reparatur nicht automatisch. Dazu: kein FIT-Export (Issue #247).

**GPS Visualizer** (seit 2002) — **beste Höhenkorrektur des Marktes**: acht
DEM-Quellen (NED13, NED1, ODP1/Sonny, NASADEM, ASTER, NED2, ODP3, SRTM3) mit
„best available"-Automatik, 500+ GB Rohdaten lokal. Liest GPX, KML, FIT, TCX, NMEA,
IGC, Garmin GDB, Suunto X9, TomTom, u-blox, CSV. Seit 21.01.2025 überleben
Geschwindigkeit und Kurs als `gpxtpx`-Extension die Konvertierung.
**Aber: Die Höhenfunktion ersetzt, sie korrigiert nicht** — wörtlich „will erase any
existing altitude data". Kein Smoothing, keine Ausreißererkennung, keine
Pausenerkennung. Finanzierung über AdSense und Spenden.

Daneben: Trackprofiler, MyGPSFiles (browser-lokal), utrack (nur PDF-Reports),
viewmygpx (100 % clientseitig), dincalculator (Spikes über >150 km/h).

### 2.4 Die neue Welle: Web-Reparatur-Spezialisten (2025/2026)

Die dynamischste Ecke — überwiegend Ein-Personen-Projekte, browser-lokal, kostenlos.

**GpxFix** (letzte Änderung 19.08.2026) — Vollsortimenter: Höhenkalibrierung, Zeit
ändern, Combine, Compare, **Crop und Cut inklusive Mittelstücke**, Fix GPS issues,
Fix HR errors, **Remove still time**, Resample, Reverse, **Smoothen mit vier Stufen
inklusive Snap-to-Road**, Strip/Minify. GPX, TCX, FIT. **Lückenerkennung zwischen
30 s und 10 min, gefüllt mit interpolierten Punkten inkl. Höhe und Herzfrequenz.**
Derzeit kostenlos; ein Blogeintrag „Why We Are Introducing Subscription" ist
verlinkt, Preise noch nicht veröffentlicht.

**GPX Rescue** — Missing Segment Replicator, Routes Merger, Time Adjuster,
**„Restaurant Justifier"** (Stopps erkennen, oszillierende Standpunkte tilgen),
Smoother (Spikes auf interpolierte Positionen, Extensions bleiben erhalten).

**TrailBlender** — erkennt automatisch GPS-Spikes, Tunnel-Lücken und
Cold-Start-Wander, markiert jede Anomalie **mit Typ und Schweregrad** und überlässt
die Entscheidung dem Nutzer. Tunnel werden „based on your speed and heading"
interpoliert, nicht per Luftlinie.

**PeakLine** — einziges Projekt, das **seine Schwellenwerte öffentlich
dokumentiert**: sportartabhängige Obergrenzen (Rad 35 m/s, Laufen 7 m/s),
Anchor-Outlier bei >500 m *und* >20× Median-Punktdistanz, MAD-Filter gegen
Höhenspikes, bis zu fünf Durchläufe.

**GOTOES** (© 2015–2026) — Veteran. Merge kombiniert HF, Leistung, Position,
Trittfrequenz, Höhe, Distanz, Temperatur und repariert korrupte FIT-Dateien; GPS
Race Repair rekonstruiert fehlende Renndaten aus einer Kursdatei. Limits: 14 MB je
Datei frei, Höhen-Lookups 1/Tag frei, 10/Tag für Spender. **Kritik im eigenen
Support-Forum:** Bewegungszeit sinkt nach Verarbeitung unveränderter Dateien,
Höhenmeter beim Mergen überschätzt.

### 2.5 FIT-Spezialisten — die dünnste, am schnellsten wachsende Nische

**FIT File Tools** — Time Adjuster, File Combiner, **Field Merger**, Section
Remover, **Break Remover**, **Corrupt Time Fixer**, Start Extender, Device/Sport
Changer, FIT→GPX/TCX/JSON/CSV. **Korrektur: Der „Elevation Setter" setzt nur den
Gesamt-Höhenmeterwert — es gibt keine DEM-basierte Höhenkorrektur.**

**fitfileeditor.com** — „the whole activity sits on one timeline, like a video editor
for your workout", **schneidet auch aus der Mitte**, kappt HF-Spitzen, zieht
abgeirrte GPS-Punkte zurück auf die Straße. **Kostenlos, komplett lokal im Browser
über das offizielle Garmin FIT JavaScript SDK.**

**Der strukturelle Grund für die Dünne dieser Nische:** Die verbreiteten
Python-Bibliotheken `fitparse` und `fitdecode` sind **reine Decoder**. Zum gültigen
Zurückschreiben braucht man das offizielle Garmin FIT SDK. Deshalb existiert **keine
Open-Source-CLI, die FIT-Sensordaten editiert und wieder schreibt** — alle Editoren
sind Browser-Werkzeuge, Batch-Verarbeitung ist praktisch unmöglich.

### 2.6 Plattformen — können fast nichts, verdienen am meisten

| Plattform | Preis (08/2026) | Was geht | Was nicht |
|---|---|---|---|
| **Strava** | EU **€10,99/Mon · €74,99/Jahr** | Crop (Rand, **irreversibel**), Split, Correct Distance, Correct Elevation (**nur Baro-Geräte**) | Mitte schneiden, Höhe manuell, Merge, Punkte, Zeitstempel |
| **Garmin Connect** | kostenlos | **Trim mit „Restore Original"** (umkehrbar) | Merge (Feature-Request seit 2012), Punkte, Mitte. **Edits ändern nur die Anzeige — die FIT-Datei bleibt unverändert** |
| **Komoot** | **€59,99/Jahr** | Croppen Anfang/Ende, nur Web | Alles andere. Wörtlich: *„It isn't possible to change any of these coordinates retrospectively."* |

Strava nutzt für die Höhenkorrektur **keine externe DEM, sondern eine eigene
Datenbank aus aggregierten Barometer-Messungen der Community**.

**Garmin BaseCamp ist tot.** Letzte Versionen 03/2023, Cloud seit 2018 abgeschaltet.
Die macOS-Version ist **reine Intel-Software und läuft nur über Rosetta 2**; unter
macOS Tahoe berichten Nutzer bereits von Startproblemen. Weder Portierung noch
Nachfolger angekündigt. **Das ist die größte offene Lücke im Markt.**

### 2.7 Trainingsanalyse

**Runalyze** — hostet eigene SRTM-Dateien, lässt **Algorithmus und Schwellenwert für
die Höhenberechnung wählen**, „Merge file into activity" ist der sauberste
Zwei-Geräte-Merge unter den Webdiensten.
**Intervals.icu** (Supporter $4/Mon) — „Fix Data" für Dropouts, Höhenkorrektur über
OpenTopoData. **Bekannte Lücke: keine Abdeckung nördlich 60° Breite.**
**TrainingPeaks** — zeigt als einzige **eine Vorschau als roten Vergleichsgraphen**
vor dem Anwenden der Höhenkorrektur. **Am 22.07.2026 von Garmin übernommen.**
**WKO5** — 169 USD einmalig, offline, aber kein Track-Editing.

### 2.8 Map-Matching und Höhen-APIs

**Valhalla/Meili** (HMM + Viterbi) ist selbst hostbar und kostenlos — und liefert mit
`edge.tunnel` und `edge.bridge` genau die Attribute, die für Tunnel-Lücken und
Brücken-Höhenfehler gebraucht werden. Mapbox: 100k Requests/Monat frei, dann
2,00 USD/1.000. **Google Roads: ~10 USD/1.000 bei max. 100 Punkten pro Request — ein
achtstündiger Track mit 1-Sekunden-Sampling kostet dort ~2,88 USD**, wirtschaftlich
unbrauchbar.

Höhen-APIs: OpenTopoData (frei, selbst hostbar; SRTM, ASTER, **EU-DEM 25 m**, NED
10 m), Open-Elevation (frei, Docker), GPXZ (kommerziell, 1-m-LiDAR).

---

## 3 · Die sieben Reparaturfälle: wer kann was

✅ vollständig · 🟡 eingeschränkt/manuell · ❌ nein · ❔ unbestätigt

| Werkzeug | Drift/Sprünge | Falsche Höhe | Zeitstempel | Verseh. Pause | Zwei Geräte | Verg. Stopp | Tunnel |
|---|---|---|---|---|---|---|---|
| **GpxFix** | ✅ inkl. Snap | ✅ Kalibrierung | ✅ | ✅ | ✅ | ✅ auch Mitte | ✅ 30 s–10 min |
| **GoldenCheetah** | ✅ | ✅ Open-Elev. | 🟡 | 🟡 | ✅ **mit Zeit-Sync** | ✅ | ✅ |
| **GPX Rescue** | ✅ | ❌ geplant | ✅ | ✅ | 🟡 | ✅ | ✅ |
| **TrailBlender** | ✅ typisiert | 🟡 | ❌❔ | ❌ | ❌ | 🟡 | ✅ speed/heading |
| **PeakLine** | ✅ dokumentiert | 🟡 MAD | 🟡 | ❌ | ❌ | ❌ | 🟡 gerade Linie |
| **GOTOES** | 🟡❔ | ✅ 1–10/Tag | ✅ | 🟡❔ | ✅ alle Kanäle | 🟡❔ | ✅ Race Repair |
| **FIT File Tools** | ❌ | 🟡 nur Summe | ✅ | ✅ | ✅ | ✅ | 🟡 nur Anfang |
| **gpx.studio** | 🟡 Rechteck | ✅ Mapterhorn | ✅ | 🟡 | 🟡 | 🟡 | 🟡 |
| **GPS Visualizer** | ❌ | ✅ **8 DEM** | 🟡 Std-Offset | ❌ | 🟡 | ❌ | ❌ |
| **QMapShack** | 🟡 Filter | ✅ eigene DEM | ✅ | ❌❔ | ✅ | ✅ | 🟡 |
| **GPSBabel** | 🟡 discard hdop | ❌ **kein DEM** | ✅ faketime | ❌ | ✅ | ✅ | ✅ interpolate |
| **GPXSee** | ❌ read-only | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Strava** | 🟡 | 🟡 nur an/aus | ❌ | ❌ | ❌ | 🟡 nur Rand | ❌ |
| **Garmin Connect** | ❌ | 🟡 an/aus | ❌ | ❌ | ❌ | 🟡 nur Anzeige | ❌ |
| **Komoot** | ❌ | ❌ | ❌ | ❌ | ❌ | 🟡 Rand | ❌ |

---

## 4 · Wird von fast allen abgedeckt (kein Markteinstieg)

GPX lesen/schreiben · Merge · Split · Anfang/Ende abschneiden · Punkte reduzieren
(Douglas-Peucker) · Umkehren · Höhe komplett durch DEM ersetzen · Formate
GPX↔KML↔TCX · Einzelpunkte löschen · Wegpunkte verwalten

## 5 · Kann fast keiner — die eigentlichen Lücken

1. **Barometrische Drift korrigieren.** Es gibt nur zwei Angebote: Einzelspitzen
   glätten oder das ganze Profil durch DEM ersetzen. **Niemand** regressiert die
   barometrische Kurve — relativ sehr genau, im Absolutwert driftend — gegen
   DEM-Stützpunkte und rechnet nur den langsamen Offset heraus. nzelevationtools
   formuliert das Problem selbst präzise und ersetzt dann trotzdem beides. Nachfrage
   massiv belegt (Garmin-Edge-830: 893 m aufgezeichnet statt 1.800 m real).
2. **Brücken und Tunnel bei der DEM-Korrektur berücksichtigen.** DEM kennt keine
   Bauwerke — wer eine Talbrücke überquert, bekommt die Talsohle. Valhalla liefert
   `edge.bridge`/`edge.tunnel`; **kein Consumer-Tool nutzt sie dafür.**
3. **Mittelstücke herausschneiden.** Keine einzige Plattform kann es. Nur GpxFix,
   fitfileeditor.com, jasonkuperberg, GoldenCheetah, TrainingPeaks.
4. **Ausreißer automatisch erkennen und die Schwelle erklären.** Nur PeakLine,
   TrailBlender, dincalculator, GpxFix, GoldenCheetah. **gpx.studio kann es nicht.**
5. **Map-Matching auf Wege im Consumer-Tool.** Nur GpxFix und RouteConverter.
6. **Zeitzonen mit echter IANA-Datenbank und Sommerzeitlogik. Niemand.** GPS
   Visualizer bietet einen Stunden-Offset, alle anderen nichts.
7. **Zwei Geräte mergen mit automatischer Uhren-Synchronisation.** Nur
   GoldenCheetah, Fit File Repair Tool, Runalyze.
8. **Echte Stapelverarbeitung.** Web-Tools sind ausnahmslos Ein-Datei-Workflows.
9. **FIT-Sensordaten editieren und gültig zurückschreiben — skriptbar.** Existiert
   als Open Source nicht.
10. **Pausen erkennen und Standzeit entfernen.** Nur GpxFix, GPX Rescue, FIT File Tools.
11. **Tunnel-Lücken sinnvoll interpolieren statt Luftlinie.** Nur TrailBlender,
    GpxFix, GPX Rescue, GOTOES, GoldenCheetah.
12. **Vorher/Nachher der Kennzahlen zeigen.** Fast alle sind Blackboxes. Nur
    TrailBlender, PeakLine und TrainingPeaks machen es transparent. **Das ist ein
    billig zu schließendes Vertrauensproblem** — und genau der Punkt, an dem GOTOES
    im eigenen Forum kritisiert wird.
13. **Sensordaten über Formatgrenzen erhalten.** Leistung geht bei FIT→GPX fast
    überall verloren. Zusatzfalle: Garmin Connect exportiert `ns3:hr` statt
    `gpxtpx:hr` — wer auf den Literal-String prüft, findet in Millionen intakter
    Dateien keine Herzfrequenz.
14. **In-Place-Update auf der Plattform. Niemand.** Jede externe Reparatur endet mit
    „Original löschen, neu hochladen" — Kudos, Kommentare, Fotos, Segment-
    Platzierungen und Streaks sind weg. Der meistgenannte Grund, eine kaputte
    Aktivität kaputt zu lassen.
15. **Offline-Reparatur mit zeitgemäßer Oberfläche.** Offline können nur die
    Desktop-Open-Source-Werkzeuge — und die haben ausnahmslos alte Oberflächen
    (Java-Swing, GTK, Qt-Altbestand).

---

## 6 · Preisrealität

**Zahlungsbereitschaft im Reparatursegment existiert praktisch nicht.** gpx.studio,
GPS Visualizer, FIT File Tools, GpxFix, GPX Rescue, TrailBlender, viewmygpx,
PeakLine, MyGPSFiles, GPSBabel, GpsPrune, QMapShack, GoldenCheetah, GOTOES — alle
kostenlos. Die einzigen echten Preise: Fit File Repair Tool 39 €, Adze 20 USD,
WKO5 169 USD, GPX Editor macOS 4,99 USD, tapiriik 2 USD/Jahr, HealthFit 6,99 USD.

**Geld verdient wird ausschließlich** mit Plattform-Abos (Strava 74,99 €/Jahr,
Komoot 59,99 €/Jahr, TrainingPeaks ~125 USD/Jahr) und im angrenzenden
**Video-Overlay-Markt** (Telemetry Overlay 199 USD, GpxOverlay bis 179 USD,
StintBox bis 349 €, RaceRender bis 80 USD).

**Der Kontrast ist der wichtigste Befund dieses Berichts:** Für dieselben Daten in
einem Video zahlen Nutzer bis 199 USD — für die Reparatur derselben Daten praktisch
nichts.

**Konsolidierung:** Bending Spoons übernimmt Komoot (03/2025, danach 75–85 %
Personalabbau). **Garmin übernimmt TrainingPeaks und TrainHeroic am 22.07.2026** —
damit gehören Garmin Connect, TrainingPeaks und WKO5 einem Konzern.

**Wachstumsecke** ist die browser-lokale Reparatur: sechs bis acht Projekte sind
2025/2026 entstanden, alle mit demselben Pitch („kostenlos, kein Login, your file
never leaves your browser"). Der Wettbewerbsvorteil verschiebt sich dort bereits von
der Funktion zur **Transparenz**.

---

## 7 · Ausdrücklich unbestätigt

Formales BaseCamp-Enddatum · GpxFix-Preise nach Abo-Einführung ·
Trackprofiler-Premium · Kurviger (15/30 € vs. 29,99 € vs. 39,99 €) · Runalyze 2026
(Website blockt) · GPS Track Editor Release-Datum · tapiriik-Zuverlässigkeit 2026
(letzter Commit 24.11.2023) · GPX-Export bei GoldenCheetah · FIT-Import bei
gpx.studio · HERE-/Google-Preise für Map-Matching
