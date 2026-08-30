# GPS Studio — Standortbestimmung und Weg zum weltbesten Tour-Tool

**Erstellt:** 30.08.2026 · **Stand der App:** v0.9.628 · **Auftrag:** Marc — „das
weltweit beste Tool für die Nachbearbeitung aufgezeichneter Touren"

**Belegbasis:** fünf unabhängige Marktrecherchen (~600 Suchen und Direktabrufe),
zwei Code-/Doku-Audits, voller Testlauf inklusive echter Renders. Rohberichte mit
allen Quellen in `docs/recherche/`.

---

## Kurzfassung — was ich gefunden habe

**1. Die Position ist besser, als sie sich anfühlt.** Der Markt hat vier belastbare
Lücken. GPS Studio besetzt **drei davon bereits vollständig** und die vierte zur
Hälfte. Kein anderes Werkzeug weltweit kann diese Kombination:

| Marktlücke | Wer sie sonst füllt | GPS Studio |
|---|---|---|
| Lokales natives Rendern ohne Cloud | fast niemand (nur GPX Animator, 2D) | ✅ |
| MP4 statt WebM, in Schnittprogrammen brauchbar | die zwei stärksten Gratis-Tools liefern nur WebM | ✅ H.264/H.265/ProRes |
| Wasserzeichenfrei, 4K, kommerziell nutzbar | vier Tools weltweit; Google Earth Studio ist lizenzrechtlich raus | ✅ |
| 3D-Kamerafahrt **und** Telemetrie-Overlay in einem Werkzeug | **niemand** | 🟡 Kamerafahrt ja, Overlay-Modul fehlt |

**2. Der wichtigste strategische Satz der ganzen Recherche** stammt vom Ayvri-Gründer
(3D-Track-Visualisierung, 2022 abgeschaltet): Man habe nie ein Geschäftsmodell
gefunden, das die Investitionen rechtfertigte — der Umsatz kam von Geschäftspartnern,
nicht von Nutzern, und mit wachsender Community stiegen die **Cloud-Kosten**, während
die Erlöse fielen. Dazu, wörtlich von der bis heute online stehenden Abschiedsseite:
*„Ayvri has never provided the ability to download data or scenes."* Am 31.10.2022
waren zehn Jahre Community-Inhalt weg, ohne jede Exportmöglichkeit.

**Daraus folgt: Dass GPS Studio lokal rechnet, ist kein technisches Detail, sondern
der Geschäftsmodell-Vorteil.** Jeder neue Nutzer kostet dich nichts. Bei allen
Cloud-Konkurrenten verschlechtert jeder neue Nutzer die Bilanz.

**3. Es gibt keinen Vollsortimenter.** Bei der Track-*Reparatur* deckt kein einziges
Werkzeug alle sieben typischen Fälle ab. Selbst gpx.studio — mit 833.000 Besuchen in
drei Monaten das reichweitenstärkste kostenlose Werkzeug der Welt — hat **keine
automatische Ausreißererkennung**; sein „Clean" ist ein Rechteck zum Punkte-Löschen.

**4. Der Audit hat echte Defekte gefunden**, darunter einen kritischen Datenverlust-Pfad
im Projekt-Store und fünf weitere mit Verlustrisiko. **Sieben sind repariert und mit
Wächtern gedeckt** (Details in Abschnitt 5).

**5. Zur Finanzierung:** Der Fixkostensockel liegt bei **320–420 €/Jahr**. Alles, was
darüber hinaus als „Erlösmodell" gebaut wird, bringt mehr Supportlast als Geld —
außer Affiliate, und das gehört **nicht in die App**, sondern in deine Inhalte.

**Meine Kernempfehlung in einem Satz:** Nicht mehr Module bauen, sondern die drei
vorhandenen Alleinstellungsmerkmale **sichtbar** machen und die eine fehlende Lücke
(Overlay) schließen — das ist der kürzeste Weg von „mächtig, aber unbekannt" zu
„das nimmt man dafür".

---

## 1 · Anforderungsliste: Was ein Weltklasse-Tool können muss

Abgeleitet aus dem, was Nutzer nachweislich verlangen und was der Markt nicht liefert.
Die Spalte „GPS Studio" ist der verifizierte Ist-Stand (Code geprüft, nicht geraten).

### A · Daten hereinbekommen

| # | Anforderung | Warum | GPS Studio |
|---|---|---|---|
| A1 | **GPX 1.0/1.1** inkl. `TrackPointExtension` (hr, cad, atemp, power), toleranter Namespace | universeller Nenner | ✅ |
| A2 | **FIT** mit Sensordaten | einziger Container mit voller Sensorik; ohne FIT keine Garmin-/Wahoo-/Suunto-/Polar-/Coros-Nutzer | ✅ |
| A3 | **TCX** | Polar, Coros-Bulk, Fitbit | ✅ |
| A4 | **KML/KMZ** | einziger Weg für Garmin inReach | ✅ |
| A5 | **NMEA** | Altlogger, Dashcams, Marine | ✅ |
| A6 | **GeoJSON** | GIS-Umfeld | ✅ |
| A7 | **CSV mit Spalten-Zuordnung** | Auffangbecken für Withings, Zepp, Huawei-DSGVO-Auskunft, Fitbit-Takeout | ❌ |
| A8 | **IGC** (getrennte GPS-/Baro-Höhe) | Gleitschirm/Segelflug — die Ayvri-Waisen, dankbare Nische | ❌ |
| A9 | **GoPro GPMF direkt aus MP4** | Telemetrie-Overlay-Voraussetzung; vier freie Parser existieren | ❌ |
| A10 | **DJI `.SRT`** | Drohnen | ❌ |
| A11 | **Mehrere Dateien zu einer Tour verketten** | Akkuende, Mehrtagestour | ✅ (Zusammenführen) |
| A12 | **Kein API-Zwang** — Datei-Import als Hauptweg | Strava-API ist 2026 abo-pflichtig, nutzerbegrenzt und mit Anzeige-/Analyseverbot belegt; Garmin-API ist partner-only | ✅ bewusst so |

### B · Daten reparieren

| # | Anforderung | Wer kann es sonst | GPS Studio |
|---|---|---|---|
| B1 | **Ausreißer/Spikes automatisch erkennen** | nur 5 Werkzeuge; gpx.studio **nicht** | 🟡 Auto-Heilen vorhanden, Schwelle nicht erklärt |
| B2 | **Schwellenwerte offenlegen** | nur PeakLine | ❌ |
| B3 | **Mittelstück herausschneiden** | **keine einzige Plattform**; nur 5 Werkzeuge | ✅ A→B rausschneiden |
| B4 | **Höhe aus DEM korrigieren** | viele — aber fast alle *ersetzen* statt zu korrigieren | ✅ mit Mischregler (70 % Karte) |
| B5 | **Barometrische Drift herausrechnen** (Regression gegen DEM-Stützpunkte, statt alles zu ersetzen) | **niemand weltweit** | ❌ |
| B6 | **Brücken/Tunnel bei DEM-Korrektur beachten** | **niemand** (Valhalla liefert die Attribute) | ❌ |
| B7 | **Tunnel-Lücken sinnvoll füllen** statt Luftlinie | 5 Werkzeuge | ✅ Lücken-Routing |
| B8 | **Map-Matching auf Wege** | nur GpxFix und RouteConverter | ✅ |
| B9 | **Zeitstempel/Zeitzonen mit echter IANA-Logik** | **niemand** (GPS Visualizer bietet einen Stundenversatz) | ✅ 13 Szenarien im Wächter |
| B10 | **Zwei Geräte mergen mit Uhren-Sync** | nur 3 Werkzeuge | ❌ |
| B11 | **Pausen erkennen, Standzeit entfernen** | 3 Werkzeuge | 🟡 Pausen-Modi im Animator, nicht als Reparatur |
| B12 | **Vorher/Nachher der Kennzahlen zeigen** | nur 3 Werkzeuge — „billig zu schließendes Vertrauensproblem" | ✅ grau gestrichelt nach Heilen |
| B13 | **Sensordaten über Formatgrenzen erhalten** | fast keiner (Power geht bei FIT→GPX verloren) | ✅ Sidecar |
| B14 | **Nichts überschreiben, alles umkehrbar** | Strava-Crop ist **irreversibel** | ✅ Fassungen + Rollback |
| B15 | **Stapelverarbeitung** | nur GPSBabel-CLI und GoldenCheetah | ❌ |

### C · Daten zeigen (der Kern)

| # | Anforderung | Marktlage | GPS Studio |
|---|---|---|---|
| C1 | **Lokal rendern, keine Cloud** | fast niemand | ✅ |
| C2 | **MP4 (H.264/H.265)** | die stärksten Gratis-Tools liefern nur WebM | ✅ |
| C3 | **4K** | bei Gratis-Angeboten praktisch nirgends | ✅ |
| C4 | **Kein Wasserzeichen** | 4 Werkzeuge weltweit | ✅ |
| C5 | **Alpha-Kanal für den Schnitt** | sehr selten | ✅ ProRes 4444 |
| C6 | **Freie Kamerakontrolle mit Keyframes** | nur 4 Werkzeuge | ✅ |
| C7 | **Social-Formate 9:16, 1:1** | Standard bei Neuzugängen | ✅ |
| C8 | **Mehrere Touren gleichzeitig** (Gruppe/Rennen) | kaum — obwohl es *die* Ayvri-Funktion war | ✅ Schwarm, bis 96 Touren |
| C9 | **Fotos an GPS-Position einbetten** | bei den meisten Web-Diensten nicht | ✅ |
| C10 | **Höhenprofil animiert** | verbreitet | ✅ Daten-Animator |
| C11 | **Statische Karte (PNG) für Thumbnails** | selten als eigenes Werkzeug | ✅ Tour-Map |
| C12 | **Interaktive Karte fürs Blog** | GPSVisualizer-Territorium | ✅ Web Karte |
| C13 | **Telemetrie-Overlay über eigenes Videomaterial** | eigener Markt (bis 199 $) — **aber nie zusammen mit Kamerafahrt** | ❌ |
| C14 | **Klare kommerzielle Nutzungsrechte** | Google Earth Studio: **keine**; Mapimator: Enterprise nötig | ✅ |
| C15 | **Deutschsprachige Oberfläche** | 5 von ~40 Werkzeugen | ✅ DE/EN/ES |

### D · Drumherum

| # | Anforderung | GPS Studio |
|---|---|---|
| D1 | **Foto-Geotagging** inkl. RAW, Zeitversatz, Zeitzonen, Richtung, Ortsnamen | ✅ (Geotagger, stark) |
| D2 | **Video-Geotagging** | ✅ |
| D3 | **Archiv über hunderte Touren** mit Suche, Filter, Statistik | ✅ |
| D4 | **Projekte/Arbeitsmappen mit Historie** | ✅ (E1–E3) |
| D5 | **Eigene Cloud-Synchronisation ohne Fremdanbieter** | ✅ verschlüsselt über eigenen Server |
| D6 | **Läuft offline, telefoniert nicht nach Hause** | ✅ Update-Check abschaltbar |
| D7 | **Signiert und notarisiert** | ✅ macOS; ⚠️ Windows unsigniert |

**Bilanz: 39 von 50 Anforderungen erfüllt, 5 teilweise, 6 offen.** Kein anderes
Werkzeug im Markt kommt in die Nähe dieser Abdeckung.

---

## 2 · Marktlücken und Painpoints

### Die Painpoint-Rangliste (Auszug, vollständig in `docs/recherche/2026-08-30-painpoints.md`)

Der auffälligste Befund: **Derselbe Wunsch wird seit 2011 unverändert formuliert und
ist bis heute unerfüllt** — „meine aufgezeichnete Tour als Video, ohne sie
nachzuzeichnen". Belegt in deutschen Foren über 14 Jahre (mikemoto 2017, gs-forum
2017, naviboard 2020, cyclinguk 2020, trueadventure 2025). Jedes Werkzeug scheitert
an *einem* Punkt:

- **Relive** — App-Zwang, 960×540 gratis, Abo für HD, „ein Versuch pro Video"
- **GPX Animator** — tote Kachelquellen, Java-Konflikte, letztes Release 04/2023
- **Google Earth Studio** — animiert nur die Kamera, nicht die Route; **keine
  kommerzielle Lizenz**
- **Vasco da Gama** — 149 €, reduziert auf 100 Wegpunkte
- **BaseCamp** — animiert, **exportiert aber kein Video**; seit 03/2023 tot, nur Intel

**Wer alle fünf gleichzeitig erledigt, hat den Markt. GPS Studio erledigt alle fünf.**

### Die härtesten unerfüllten Wünsche (nach Häufigkeit × Schlechtigkeit der Lösung)

1. Track als Video, lokal, in Schnittqualität — **offen im Markt, gelöst bei uns**
2. Anbieter stirbt, Daten weg (Ayvri) — **strukturell gelöst bei uns**
3. Funktionen wandern hinter die Paywall — **gelöst bei uns**
4. Nur Handy, kein Desktop — **gelöst bei uns**
5. Auflösung gedeckelt — **gelöst bei uns**
6. Mittelstücke schneiden — **gelöst bei uns, von keiner Plattform**
7. Höhenprofil unbrauchbar (Barodrift) — **weltweit ungelöst** ← größte offene Chance
8. GPS-Spikes — teilweise gelöst, Schwelle nirgends erklärt
11. Geotagging-Zeitversatz — **gelöst bei uns**
13. Track soll nicht in die Cloud — **gelöst bei uns**
16. Video ↔ GPS-Synchronisation — **offen bei uns** ← zweite Chance
23. Mehrere Tracks gemeinsam animieren — **gelöst bei uns (Schwarm)**

### Was ich *nicht* bauen würde

Tracks zusammenfügen, Zeitstempel verschieben, Track ansehen: mehrfach und gut gelöst,
teils kostenlos und lokal. Als Bequemlichkeit im großen Werkzeug sinnvoll — **als
Verkaufsargument wertlos.**

---

## 3 · Was es noch gar nicht gibt

Vier Dinge sind mir in der Recherche aufgefallen, die **niemand** baut:

**3.1 Barometrische Drift herausrechnen statt das Höhenprofil zu ersetzen.**
Der heutige Stand ist binär: Entweder man glättet Einzelspitzen, oder man wirft das
ganze barometrische Profil weg und nimmt DEM-Werte. Beides ist falsch. Die
barometrische Kurve ist **relativ sehr genau** (sie sieht jede Stufe), aber sie
**driftet im Absolutwert** mit dem Wetter. Die richtige Lösung ist eine Regression der
Baro-Kurve gegen DEM-Stützpunkte, bei der nur der langsame Offset herausgerechnet wird
und die feine Struktur bleibt. Die Nachfrage ist massiv belegt (Garmin-Edge-830-Fall:
893 m aufgezeichnet statt 1.800 m real; Garmin gibt für seine Höhenmesser ±400 ft an).
Ein Web-Tool beschreibt das Problem sogar präzise — und ersetzt dann trotzdem beides.
**Das wäre eine echte Weltneuheit und passt exakt zu einem vorhandenen Modul.**

**3.2 Brücken und Tunnel bei der Höhenkorrektur.** DEM-Daten kennen keine Bauwerke:
Wer eine Talbrücke überquert, bekommt die Talsohle zugewiesen. Valhalla liefert mit
`edge.bridge` und `edge.tunnel` genau die nötigen Attribute — **kein Consumer-Tool
nutzt sie dafür.**

**3.3 Kamerafahrt und Telemetrie-Overlay im selben Werkzeug.** Die beiden Lager
berühren sich nirgends. Wer beides will, exportiert aus zwei Programmen und montiert
im Schnitt. **In diesem Markt liegt gleichzeitig das einzige echte Geld** (Telemetry
Overlay 199 $, GpxOverlay bis 179 $, StintBox bis 349 €) — und die Platzhirsche sind
verwahrlost: DashWare ist tot (DNS weg), VIRB Edit eingestellt mit kaputter
Kartenansicht, RaceRender seit 31.10.2019 eingefroren.

**3.4 Erklärte Reparatur.** Fast alle Reparaturwerkzeuge sind Blackboxes: Datei rein,
Datei raus, und was sich an Distanz und Höhenmetern geändert hat, sieht man erst
später. Genau daran wird der Veteran GOTOES im eigenen Forum kritisiert. GPS Studio
zeigt beim Heilen bereits Vorher/Nachher — **das ist ein Vorsprung, der nirgends
beworben wird.**

### Wie sich der Wettbewerb finanziert

| Modell | Wer | Beträge |
|---|---|---|
| **Abo mit Wasserzeichen/Auflösung als Schranke** | Relive, Mapimator, dddmaps, SkyViz, XCviewer | 25–60 €/Jahr |
| **Plattform-Abo, 3D als Beigabe** | Strava 74,99 €/J, Garmin Connect+ 89,99 €/J, Komoot 59,99 €/J | 60–90 €/Jahr |
| **Einmalkauf Desktop** | Telemetry Overlay 199 $, StintBox 349 €, GEOlayers 329,99 $ | 40–350 $ |
| **Pay-per-Render (Credits)** | AvoMap | ~1–3 $/Video |
| **Im Hardwarepreis enthalten** | **Coros 3D-Flyover (kostenlos!)**, Insta360 Studio | 0 € |
| **Spenden** | gpx.studio (~1.231 €/Monat), Statshunters | 0 € |
| **Auftragsproduktion** | mapdirector, Fiverr | 20–75 $+ |

**Das quer durch den Markt eingesetzte Instrument ist das Wasserzeichen** — genau das,
was du nicht willst und nicht brauchst.

**Zwei Warnsignale:** Coros verschenkt 3D-Flyover-Videos, weil die Hardware-Marge sie
trägt — das drückt die Zahlungsbereitschaft im ganzen Segment. Und im
Reparatur-Segment existiert **praktisch keine Zahlungsbereitschaft**: von 16 geprüften
Werkzeugen sind 14 kostenlos.

---

## 4 · Abgleich: Wo GPS Studio steht

### 4.1 Was ihr habt — und besser seid als alle

1. **Lokales Rendern in Schnittqualität** — MP4 H.264/H.265, ProRes 4444 **mit
   Alpha**, 4K, kein Wasserzeichen, unbegrenzt oft. Kombination gibt es sonst nicht.
2. **Der Schwarm** — bis 96 Touren gleichzeitig, mit Modi, Start-Verzögerungen und
   kumulierten Live-Statistiken. Das war *die* Funktion, für die Doarama/Ayvri geliebt
   wurde, und sie fehlt im Markt seit 2022.
3. **Zeitzonen richtig** — laut Recherche kann das „niemand" sauber; ihr habt
   13 Szenarien im Wächter, inklusive Nepal +5:45.
4. **Nichts ist endgültig** — Fassungen, byte-genauer Rollback, Sicherungen. Strava
   croppt **irreversibel**.
5. **Volle Werkzeugkette in einem Programm** — Archiv, Reparatur, Geotagging,
   Animation, statische Karte, Web-Karte, Datenvideo. Niemand sonst deckt die Kette
   ab; Nutzer stückeln sie aus vier bis sechs Werkzeugen zusammen.
6. **Datensouveränität** — lokal, eigene Cloud, Update-Check abschaltbar. Der
   Ayvri-Fall macht daraus ein Verkaufsargument, keine Fußnote.

### 4.2 Was ihr besser machen könnt

| Was | Warum | Aufwand |
|---|---|---|
| **Ausreißer-Schwellen offenlegen** („entfernt, weil 214 km/h zwischen zwei Punkten") | PeakLine gewinnt genau damit Vertrauen; ihr habt die Erkennung schon | klein |
| **Vorher/Nachher-Zahlen prominenter** | ihr habt es, es wird nicht als Alleinstellungsmerkmal verkauft | klein |
| **Windows signieren** | 50 % eurer Nutzer sind Windows (1.034 Download-Klicks: 519 Win / 463 Mac) und sehen eine SmartScreen-Warnung | 219 $/Jahr |
| **Sichtbarkeit** | die App kann mehr als alle — es weiß nur niemand | Content |
| **Handbuch aktualisieren** | Kapitel „Bekannte Einschränkungen" sagt „Beta v0.3.x" und behauptet, es ginge nur eine Tour pro Video — das ist heute euer Alleinstellungsmerkmal | mittel |

### 4.3 Was komplett fehlt

**Priorität 1 — Telemetrie-Overlay-Modul (C13).** Die einzige der vier Marktlücken,
die ihr nicht besetzt. Gleichzeitig der einzige Bereich mit echter Zahlungsbereitschaft
und mit toten Platzhirschen. Der Reiter „Overlay (bald)" existiert bereits im UI.
Bausteine sind da: Alpha-Export, Gauges im Daten-Animator, FIT-Sensorik, Kartenrender.
Es fehlen: GPMF/SRT aus dem Video lesen (A9/A10 — vier freie Parser existieren),
Zeit-Synchronisation auf die Videospur, Gauge-Vorlagen.

> ⚠️ **Aber Achtung — dein eigener Vorbehalt ist berechtigt.** Im Status-Gedächtnis
> steht „Telemetrie-Overlay verworfen, Telemetry Overlay ist ausgereift, wäre
> Nachbau". Das stimmt für einen *reinen* Nachbau. Die Recherche zeigt aber: Der
> Alleinstellungspunkt ist nicht das Overlay allein, sondern **Overlay + Kamerafahrt
> im selben Werkzeug** — und das hat niemand. Der Insta360-Bezug bleibt: Insta360
> Studio kann Stats **nicht bei 360°-Material** exportieren, zeigt Beschriftungen
> **nur auf Englisch**, hat keinen Gauge-Designer, kein Höhenprofil und keine
> Mehrfach-Tracks. Da ist Platz.

**Priorität 2 — Baro-Drift-Korrektur (B5) und Brücken/Tunnel (B6).** Weltneuheiten,
kleiner Umfang, direkt im vorhandenen Inspektor. Der stärkste „das kann sonst
niemand"-Satz, den ihr für wenig Aufwand bekommen könnt.

**Priorität 3 — Formatlücken.** CSV mit Spalten-Zuordnung (A7), IGC (A8). IGC bringt
die Gleitschirm-Szene, die seit dem Ayvri-Aus heimatlos ist und nachweislich zahlt
(5–7 €/Monat bei XCviewer/SkyViz).

**Nicht bauen:** Routenplanung (bewusst verworfen, Komoot-Territorium — bleibt
richtig), Cloud-Rendering (Ayvri-Falle), Stapelverarbeitung als Selbstzweck.

---

## 5 · Audit: Befunde und was repariert wurde

Voller Testlauf: **109 Tests, davon einer rot** — plus zwei Audits über Code,
Bedienung und Handbuch. Ruff, i18n-Prüfer, UI-Fallen-Prüfer, Modul-Abdeckung und
JS-Prüfer waren und sind grün.

### Sofort repariert (in v0.9.628, jeweils mit Wächter)

| # | Befund | Schwere |
|---|---|---|
| 1 | **Ghost-Spuren gingen beim Laden verloren.** Die Dubletten-Erkennung aus v0.9.625 baute ihren Schlüssel als `path \|\| ("#" + id)`. Ohne Pfad wurde daraus für *jede* solche Spur derselbe Wert `"#undefined"` — ab der zweiten galt jede als Dublette, wurde verworfen und das Ergebnis **sofort gespeichert**. Der Wächter `test_ghosts_beim_start.py` war deshalb rot. Deine eigenen 24 Spuren tragen alle einen Pfad und waren nicht betroffen. | **kritisch** |
| 2 | **Projekt-Store ungehärtet geschrieben.** `projekte.json`/`touren.json` — seit E1 der Ort *aller* Projekte, Keyframes, Schilder und Fassungsketten — wurden ohne `fsync` und mit festem `.tmp`-Namen geschrieben. Beide Härtungen hat `sessions.json` nach echten Vorfällen bekommen; beim Umbau wurden sie nicht mitgenommen. Folge im schlechten Fall: hartes Aus → 0-Byte-Datei → **alle Projekte weg**. | **kritisch** |
| 3 | **Debounce schrieb ins falsche Projekt.** Der 200-ms-Timer las Ziel-Session und -Projekt erst beim *Feuern*. Wer in dieser Zeit das Projekt wechselte oder „✕" drückte, schrieb seine Änderung ins falsche Projekt oder verlor sie kommentarlos. Jetzt wird das Ziel beim Einreihen festgehalten und bei Wechsel sofort weggeschrieben. | **hoch** |
| 4 | **Wiederholter `.rzproj`-Import überschrieb den eigenen Klon.** Der Ausweichname zählte je Aufruf bei 0 los, statt eine freie ID zu suchen — beim zweiten Import derselben Datei kam wieder `_imp1` heraus und überschrieb die Arbeit daran. | **hoch** |
| 5 | **Original-GPX wurde in-place überschrieben.** „Im Archiv ersetzen" öffnete die Nutzerdatei mit `"wb"` (kürzt sofort auf 0). Abbruch = Torso an der Stelle der Tour. Jetzt Temp + `fsync` + `os.replace`. | **hoch** |
| 6 | **`embed_rz_id` zerstörte reine `<rte>`-Routen** (Komoot, Outdooractive) durch ein **zweites `<metadata>`** und **stürzte bei `<metadata/>` ab**. Erreichbar über den Rollback-Weg. Reproduziert, gefixt, fünf Formen im neuen Wächter `test_rz_id_einbetten.py`. | mittel |
| 7 | **Ortssuche: Netzfehler wurden als „nichts gefunden" gemerkt** und blockierten den Suchbegriff für die restliche Sitzung; außerdem schlief die Drossel unter dem Cache-Lock und bremste alle anderen Abfragen. Beide Härtungen existierten in `reverse()` mit ausführlicher Begründung — `forward()` hatte sie nie bekommen. | mittel |
| 8 | **Stiller Rollback-Fehler.** Scheiterte die Rücksicherung nach fehlgeschlagenem Ersetzen (typisch: dieselbe volle Platte), wurde das verschluckt — der Nutzer sah „Speichern fehlgeschlagen", hatte eine beschädigte Tour und wusste nichts von `track_backups/`. Jetzt mit Pfad in der Meldung. | mittel |

**Roter Faden:** Vier der acht Befunde sind **Rückfälle in dokumentierte, bereits
einmal behobene Fehler** — die Härtung wurde beim jeweiligen Umbau nicht mitgenommen.
Das ist kein Zufall, sondern ein Muster, und es lohnt sich, bei jedem größeren Umbau
gezielt zu fragen: *Welche Härtung hatte der Vorgänger, die der Nachfolger nicht hat?*

### Offen, dokumentiert, nicht repariert (bewusst)

| Befund | Warum nicht sofort |
|---|---|
| **Drop-Pfade werden über den Dateinamen zugeordnet** — zieht man `100NIKON/DSC_0001.JPG` und `101NIKON/DSC_0001.JPG` gleichzeitig hinein, kollabieren beide auf denselben Pfad und **ein Foto verschwindet spurlos**. Dieselbe Fehlerklasse wie Befund 1. | Fix berührt Bridge-Vertrag und drei Module — zu groß für einen Nebenbei-Fix, gehört sauber geplant |
| **Zwei Hintergrundläufe haben eine Check-then-Act-Lücke** (`geotagger_autotag_start`, `library_places_start`): Prüfen und Belegen liegen auseinander, dazwischen Datei-I/O. Doppelklick kann zwei Worker starten. Die Schwestern machen es richtig. | klein, aber Nebenläufigkeit — will getestet sein |
| **Kaputter Projekt-Store wird stumm beiseitegelegt** — die App sieht danach aus wie frisch installiert, die Daten liegen als `.kaputt-<stamp>` daneben, aber nichts sagt es dem Nutzer | braucht UI-Meldung |
| **`stand_schreiben` schreibt die Stände-Historie nicht-atomar** | gleiche Klasse wie Befund 2 |
| **`frame_driver` schließt `ff.stderr` nie** — ein Deskriptor pro Render | kosmetisch |

### Bedienung und Handbuch — die gravierendsten Funde

1. **Das Handbuch schickt Nutzer ExifTool installieren, obwohl es seit v0.9.61
   mitgeliefert wird** — und widerspricht damit seinem eigenen Kapitel 1. Ein
   Canon-Fotograf installiert Homebrew für nichts.
2. **Kapitel 12 „Bekannte Einschränkungen (Beta v0.3.x)"** — bei App-Version 0.9.628.
   Behauptet „ein GPX pro Render, Multi-Track kommt später". **Das ist heute euer
   stärkstes Alleinstellungsmerkmal.** Wer als Skeptiker dort nachschaut, hört auf zu
   lesen.
3. **Der Anfängerleitfaden überspringt den Bildschirm, auf dem der Neuling landet.**
   Die App startet in der Projektliste; beim ersten Start ist sie leer und ihr einziger
   Hinweis enthält das undefinierte Wort „Schwarm".
4. **Die FAQ behauptet, die Tour-Map brauche einen Mapbox-Token** — genau das Modul,
   auf das die App ohne Token verweist.
5. **Die Modul-Übersicht nennt fünf von acht Modulen** — ausgerechnet das Archiv
   fehlt, in dem die App startet.

Vollständige Liste mit ausformulierten Textvorschlägen im Audit-Bericht.

---

## 6 · Konzept: Wie die Module zusammengehören

Heute sind acht Module gleichberechtigt nebeneinander. Das spiegelt die
Entstehungsgeschichte, nicht den Arbeitsablauf — und es ist der Grund, warum Neulinge
nicht wissen, wo sie anfangen sollen.

### Der Vorschlag: vier Phasen statt acht Kacheln

```
    SAMMELN            REPARIEREN           ANREICHERN            ZEIGEN
  ┌───────────┐      ┌────────────┐      ┌─────────────┐      ┌──────────────┐
  │  Archiv   │ ───▶ │ Inspektor  │ ───▶ │  Geotagger  │ ───▶ │  Animator    │
  │           │      │            │      │             │      │  Tour-Map    │
  │ einlesen  │      │ heilen     │      │ Fotos+GPS   │      │  Web-Karte   │
  │ suchen    │      │ Höhe       │      │ Schilder    │      │  Daten-Video │
  │ filtern   │      │ Zeit       │      │ Ghosts      │      │  Overlay ✱   │
  └───────────┘      └────────────┘      └─────────────┘      └──────────────┘
        └──────────────────── PROJEKT ────────────────────────────────┘
                    (hält den Stand, Fassungen, Historie)
```

**Die tragende Idee: Das Projekt ist die Klammer, nicht das Modul.** Das ist seit E1
technisch bereits so — die Oberfläche erzählt es nur noch nicht. Konkret:

1. **Die vier Phasen als Beschriftung über die Modulreiter legen.** Keine
   Umstrukturierung des Codes, nur eine Gruppierung in der Leiste. Der Nutzer sieht
   sofort: erst links, dann rechts.

2. **Übergaben sichtbar machen.** Jede Phase endet mit einem Knopf, der in die nächste
   führt („Track ist sauber → weiter zum Geotagger"). Die Wege existieren schon
   (Archiv→Animator, Geotagger→Animator, Inspektor→Übernehmen), sie sind nur nicht als
   Kette erzählt.

3. **Ein Statusband im Projekt.** Woran fehlt es dieser Tour noch? „Track hat 3
   Ausreißer · 47 Fotos ohne GPS · noch kein Video gerendert". Das macht aus acht
   Werkzeugen einen Arbeitsablauf und ist gleichzeitig die ehrlichste Form von
   Onboarding — es zeigt dem Neuling, was das Programm überhaupt für ihn tun kann.

4. **Das Overlay-Modul gehört in Phase 4** und schließt die Kette: Aus derselben Tour
   entstehen wahlweise Kamerafahrt, statische Karte, Blog-Karte, Datenvideo — oder
   eben Werte über dein eigenes Filmmaterial.

**Der Satz, der daraus die Positionierung macht:**
> *Eine Tour, ein Projekt — vom rohen Track bis zum fertigen Video, alles auf deinem
> Rechner.*

Das ist gleichzeitig die Antwort auf den Painpoint „Nutzer stückeln aus vier bis sechs
Werkzeugen zusammen, und an jeder Nahtstelle geht etwas kaputt".

---

## 7 · Bewertung: Wo ihr steht, wie es weitergeht

### Standortbestimmung

**Funktional seid ihr vorn.** Von 50 abgeleiteten Anforderungen erfüllt GPS Studio 39
voll und 5 teilweise. Der nächstbeste Kandidat im Markt — TrailReplay, kostenlos, Open
Source — erfüllt vielleicht 15, kann keine Reparatur, kein Geotagging, kein Archiv.
Die kommerziellen Anbieter sind entweder Cloud-gebunden (Relive, AvoMap, Mapimator)
oder auf ein Teilstück beschränkt (Telemetry Overlay).

**Bekanntheit ist das Problem, nicht Funktion.** 1.034 Download-Klicks seit Mai
verteilen sich auf 12 pro Tag. Relive hat 20 Millionen Nutzer mit einem Produkt, das
960×540 liefert und für HD Geld verlangt.

**Das größte technische Risiko ist Windows.** Die Hälfte eurer Nutzer läuft dort, die
Builds sind unsigniert (SmartScreen-Warnung), und es gibt einen Beta-Tester.

### Empfohlene Reihenfolge

**Jetzt (Tage):**
1. Handbuch-Korrekturen — die fünf Stellen, die aktiv falsche Auskunft geben. Reine
   Redaktionsarbeit, größter Effekt pro Aufwand. Besonders Kapitel 12: Es verkauft
   euer stärkstes Merkmal als fehlend.
2. Die restlichen Audit-Befunde abarbeiten (Drop-Pfade, Check-then-Act).
3. v0.9.628 releasen — es sind sechs ungetaggte Versionen aufgelaufen, darunter zwei
   kritische Datenverlust-Fixes.

**Kurzfristig (Wochen):**
4. **Baro-Drift-Korrektur** — die Weltneuheit mit dem besten Verhältnis von Aufwand zu
   Alleinstellung. Direkt im Inspektor, wo die Höhenkorrektur schon sitzt.
5. **Ausreißer-Schwellen offenlegen** — Vertrauensgewinn für sehr wenig Arbeit.
6. **Windows-Signatur** (219 $/Jahr) — beseitigt die größte Hürde für die Hälfte der
   Nutzer.
7. **Die vier Phasen in der Oberfläche** — macht aus acht Werkzeugen ein Programm.

**Mittelfristig (Monate):**
8. **Overlay-Modul** — die vierte Marktlücke, mit dem Insta360-Bezug als Zugabe. Ich
   würde es *nach* den schnellen Gewinnen angehen, aber es ist der Baustein, der die
   Alleinstellung vollständig macht.
9. **IGC** — holt die Gleitschirm-Szene, die seit 2022 heimatlos ist.
10. **CSV mit Spalten-Zuordnung** — das Auffangbecken für alle exotischen Exporte.

### Was den Unterschied zwischen „sehr gut" und „weltbestes Tool" macht

Nicht die nächsten zehn Funktionen. Sondern:

- **Dass man es findet.** Ein Video „Warum ich mein eigenes Relive gebaut habe" mit dem
  Ayvri-Fall als Aufhänger erreicht mehr als drei neue Module.
- **Dass es beim ersten Start funktioniert.** Der Neuling landet heute auf einem leeren
  Bildschirm mit dem Wort „Schwarm".
- **Dass man ihm glaubt.** Erklärte Schwellen, Vorher/Nachher-Zahlen, nichts ist
  endgültig — ihr habt das, es steht nur nirgends.

---

## 8 · Finanzierungskonzept

**Randbedingungen:** App bleibt kostenlos · wenig Support · keine Lizenzprobleme.

**Der zu deckende Betrag ist klein:** 99 $ Apple + 219 $ Windows-Signatur + 0–20 $
Karten = **320–420 €/Jahr**. Das ist die Schwelle, alles darüber ist Zugabe.

### Empfehlung: drei Wege, in dieser Reihenfolge

**1. Affiliate — außerhalb der App, nicht darin.** Die App ist kein Werbeträger,
sondern ein Reichweitengenerator: Sie erzeugt Videoaufrufe und Artikelaufrufe. Dort
stehen die Links. **Foto Erhardt (bis 7–8 %, 60 Tage Cookie)** und **Bergzeit Premium
(10 % verhandelbar)** schlagen Amazon (4,5 %, 24 h) bei Warenkorbwert deutlich;
**Insta360 (8 %)** passt zur bestehenden Kooperation. Komoot und Strava haben kein
Programm. Realistisch 10–80 € pro 1.000 Besucher — aber nur bei Kaufabsicht, und die
hat ein Artikelleser, kein Renderer. **Kein neuer Supportkanal, keine Serverkosten.**

**2. Ein einziger Unterstützungs-Button, zweckgebunden, ohne Gegenleistung.**
**Ko-fi oder Liberapay** (nicht beides), mit konkretem Zweck: *„Deckt
Apple-Entwicklerkonto, Windows-Code-Signing und Kartenkacheln."* Erwartungswert
50–800 €/Jahr — genug für den Sockel. **Ausdrücklich keine Perks:** Das spart
Umsatzsteuer-Diskussionen *und* die gesamte Verwaltungsarbeit. Wichtig: In Deutschland
sind solche Zahlungen **Betriebseinnahmen**, kein steuerfreies Geschenk.

**3. Sachleistungs-Sponsoring über Insta360.** Der HandBrake-Weg: **kein Geld, sondern
Sachleistung** — Testgeräte, Zubehör, ein Windows-Testrechner (löst gleichzeitig dein
größtes Qualitätsrisiko). Dazu ein dezenter „Unterstützt von"-Eintrag im About.
Zwei Bedingungen: Werbekennzeichnung einhalten, und **keine funktionale Abhängigkeit** —
die App muss ohne den Sponsor laufen. Das ist die Lehre aus DashWare, das starb, als
es GoPros Produktstrategie nicht mehr diente.

### Die drei Fallen

**Cloud-Rendering oder gehostete Karten.** Exakt das Ayvri-Muster: Community wächst,
Kosten wachsen, Erlöse nicht. Dazu die DSGVO-Verantwortung für fremde Standortdaten.
**Euer Desktop-Modell hat dieses Problem strukturell nicht — gebt den Vorteil nicht auf.**

**Pro-Version, Lizenzschlüssel, Abo.** Erzeugt genau die Supportkategorie, die du
vermeiden willst: Aktivierung, Geräte-/OS-Wechsel, Rückerstattungen, Umsatzsteuer im
EU-Ausland. Shotcut, Kdenlive und OpenShot beweisen die Gegenrichtung.

**Ein eigener zentraler Karten-Schlüssel in der App.** Extrahierbar, und die Rechnung
skaliert mit dem Erfolg. **Ihr macht das bereits richtig** (Nutzer-Token). Falls der
Mapbox-Pfad je stören sollte: MapLibre und Leaflet sind schon im Bundle.

### Lizenzlage — geprüft, unkritisch

| Komponente | Status |
|---|---|
| **MapLibre** (BSD-3), **Leaflet** (BSD-2), **pywebview** (BSD), **Playwright** (Apache 2.0) | unbedenklich |
| **PyInstaller** | GPL **mit Bundling-Ausnahme** — erzeugte Bundles dürfen jede Lizenz tragen |
| **ExifTool** (Artistic/GPL) | erlaubt, solange unverändert gebündelt, Lizenztext beiliegt, nicht separat verkauft — **so macht ihr es** |
| **FFmpeg** mit x264/x265 | GPL-Build. Da ihr ihn per **fork/exec** über die Kommandozeile aufruft, sind es getrennte Programme — **eure App wird nicht GPL**. Pflicht: Lizenztext + Quellenangebot für das Binary. Steht bereits im About |
| **Mapbox GL JS 3.12.0** | proprietär (ab v2), aber ihr nutzt den **vorgesehenen Weg** mit Nutzer-Token. In `ui/vendor/NOTICE.md` sauber dokumentiert. Kein akutes Problem |

**Ergebnis: Es gibt kein Lizenzproblem.** Das About-Modal deckt die Attributionspflichten
ab. Einziger empfohlener Zusatz: das schriftliche Quellenangebot für den GPL-FFmpeg-Build
explizit machen.

---

## 9 · Die ehrliche Antwort auf „muss jeder nutzen wollen"

Der Anspruch ist erreichbar, aber nicht über Funktionen — die habt ihr. Er entscheidet
sich an drei Sätzen, die heute niemand über GPS Studio sagen kann, obwohl sie stimmen:

1. **„Das rendert auf deinem Rechner, in 4K, ohne Wasserzeichen, so oft du willst."**
   — Kein anderes kostenloses Werkzeug kann das.
2. **„Deine Touren bleiben deine."** — Ayvri hat zehn Jahre Nutzerinhalte gelöscht,
   ohne dass jemand etwas exportieren konnte. Das ist eine Geschichte, die sich erzählt.
3. **„Es sagt dir, was es geändert hat, und du kannst alles zurücknehmen."** —
   Der Rest des Marktes ist eine Blackbox.

Wenn diese drei Sätze bei den Leuten ankommen, die heute Relive benutzen und sich über
960×540 ärgern, dann ist der Rest Fleißarbeit. Wenn sie nicht ankommen, hilft auch das
zehnte Modul nicht.

---

## Anhänge

- `docs/recherche/2026-08-30-animations-tools.md` — 40+ Visualisierungs-Werkzeuge, Preise, was gestorben ist
- `docs/recherche/2026-08-30-track-editoren.md` — Reparatur-Markt, die sieben Fälle, wer was kann
- `docs/recherche/2026-08-30-painpoints.md` — Nutzerstimmen mit Quellen, Painpoint-Rangliste
- `docs/recherche/2026-08-30-geraete-formate.md` — Geräte, Formate, Geotagging, API-Lage
- `docs/recherche/2026-08-30-finanzierung.md` — Geschäftsmodelle, Zahlen, Lizenzen
