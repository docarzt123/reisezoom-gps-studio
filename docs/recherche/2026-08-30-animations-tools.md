# Marktbericht: GPS-Track-Visualisierung und -Animation

**Stand: 30.08.2026** · ~120 Suchen und Seitenabrufe, überwiegend Primärquellen
(Preisseiten, Support-Docs, GitHub-API, HTTP-Header, Wayback-Archiv) ·
Nicht Verifizierbares ist als **unbestätigt** markiert

## 1 · Die wichtigste Erkenntnis vorweg

Der Markt zerfällt in **fünf Lager**, die kaum überlappen — und **kein einziger
Anbieter deckt die naheliegende Kombination ab**: 3D-Kamerafahrt entlang eines Tracks
**plus** Telemetrie-Overlay **plus** lokal gerendertes, wasserzeichenfreies,
kommerziell nutzbares Video in wählbarem Format.

1. **Consumer-Plattformen** (Relive, Strava, Komoot, Coros, Outdooractive) — bequem,
   aber Cloud, ohne Kontrolle, meist ohne Dateiexport
2. **Neue Web-Dienste 2024–2026** (AvoMap, mapdirector, dddmaps, Mapimator,
   TrailReplay, Rumbo, gpxmap3d, MapAnim) — die eigentliche Konkurrenz, größtenteils
   Ein-Personen-Projekte
3. **Klassische Desktop-/OSS-Tools** (GPXSee, GpsPrune, Viking, GPX Animator) —
   technisch solide, aber bei 2D stehengeblieben
4. **Telemetrie-Overlay-Software** (Telemetry Overlay, RaceRender, StintBox,
   Insta360 Studio) — ein auffallend verwahrlostes Segment
5. **Google-Earth-Familie** — mächtig, aber lizenzrechtlich vermint, mit Ablaufdatum

---

## 2 · Was gestorben ist oder hinter eine Paywall wanderte

Der dynamischste und aussagekräftigste Teil des Marktes.

### Ayvri / Doarama — tot seit 31.10.2022 (über Wayback verifiziert)

Shutdown-Ankündigung am **07.09.2022** live. Ablauf: 5. September Pro-Abbuchungen
gestoppt · 1. Oktober keine Uploads · **31. Oktober alle Szenen und Consumer-Daten
gelöscht**. Historie: 2013 als Doarama von Chris Cooper, gefördert von NICTA und der
australischen Regierung bis 2017, dann ausgegründet.

Die Begründung des Gründers ist die strategisch wertvollste Passage der gesamten
Recherche: Man habe nie ein Geschäftsmodell gefunden, das die Investitionen
rechtfertigte. Der Umsatz kam überwiegend von Geschäftspartnern, nicht von Nutzern.
In Übernahmegesprächen wurde die Technologie geschätzt, **auf die Nutzer-Community
aber null Wert gelegt**.

**Kein Datenexport war je möglich** — Ayvri besaß keine Lizenzrechte, die 3D-Szenen
offline nutzbar zu machen. Die Website steht bis heute mit dem Shutdown-Banner
online, ein vier Jahre altes Mahnmal.

### FATMAP — abgeschaltet 01.10.2024

Von Strava übernommen (Strava sagt „2022", TechCrunch nennt Januar 2023 — **Quellen
widersprechen sich**), rund 20 Monate später eingestellt. Übertragbar waren nur
**Titel, Beschreibung und Routenlinie**. Verloren: Schwierigkeitsbewertungen, Fotos,
Adventures, Guidebooks, Waypoints, alle Nutzer-Metadaten. Die Technik lebt in Stravas
**Map Rendering Engine** weiter (angekündigt 06.03.2025).

### Weitere Paywall-Verschiebungen

- **Strava „Year in Sport"**: seit Debüt 2016 kostenlos, ab Ausgabe **Dezember 2025
  nur noch für Abonnenten**. Erhebliche Gegenreaktion.
- **Garmin Connect+** (März 2025): **8,99 €/Monat bzw. 89,99 €/Jahr** in Deutschland.
  Vorher kostenlose Funktionen wanderten hinein; die **3D-Karten** (November 2025)
  sind ausschließlich Abonnenten vorbehalten. Ein Boykott-Aufruf auf Reddit sammelte
  10.000 Upvotes.
- **Relive**: Free liefert **960×540**, Plus **1920×1080**; Free = ein Video pro
  Aktivität, keine Musik, kein Bearbeiten, Abspann bleibt, max. 12 h. Bemerkenswert:
  Mit dem Update vom **11.06.2026** wurden Titel/Aktivitätstyp ändern und Nutzer
  taggen wieder freigegeben — eine **partielle Rücknahme**.
- **Komoot**: **März 2025** von Bending Spoons für **300 Mio. €** übernommen,
  danach Entlassung von **80–85 % der rund 250 Mitarbeiter**, Gründer raus. Neue
  Nutzer brauchen seither **Premium (59,99 €/Jahr)**, um Routen an Geräte zu senden.

### Tote Werkzeuge

- **DashWare** — von GoPro übernommen (**Frühjahr 2015**, belegt bei DC Rainmaker;
  kursierende „2012"/„2016" sind falsch). `www.dashware.net` **löst im DNS nicht mehr
  auf**. Ein offizielles Einstellungsdatum hat GoPro nie kommuniziert.
- **Garmin VIRB Edit** — offiziell „Discontinued", letzte Version 5.4.3 (Ende 2018).
  Die **Kartenansicht funktioniert nicht mehr** (lief über eine eingebettete
  IE-Komponente). Kein Nachfolger, gesamte VIRB-Reihe eingestellt.
- **RaceRender** — **seit 31.10.2019 eingefroren** (HTTP-Header der Downloads direkt
  geprüft: Last-Modified 31.10.2019). Übernahme durch HP Tuners 08/2014; das
  Schwesterprodukt TrackAddict wird gepflegt, der Desktop-Renderer nicht.
- **Google Earth Pro (Desktop)** — am 08.07.2026 angekündigt: **ab 25.06.2027 kein
  Download mehr**. Damit verschwindet das einzige kostenlose Werkzeug mit echtem
  Tour-Recording.
- **MyGPSFiles** — letzter News-Eintrag 23.11.2018; die 3D-Funktion basierte auf dem
  Google-Earth-Browser-Plugin, das Google Ende 2015 abschaltete.
- **Trackprofiler** — Track-Liste liefert 401, Blog 525, letzter Post 09.11.2014.
- **rayshaderanimate** — letzter Commit 02.12.2021.
- **Goat Maps** (vom Gaia-GPS-Gründer) — Abschaltung Ende Dezember 2026 angekündigt.

---

## 3 · Die relevantesten Anbieter

### Consumer-Plattformen

**Relive** — 2016 gegründet, Rotterdam. Eigene Zahlen (04.02.2025): **über 20 Mio.
Nutzer, mehr als 1 Mrd. Aktivitäten**. Übernahm 02/2025 die Trainings-App JOIN.
Drittanbieter-Schätzung: 5,4 Mio. USD Umsatz 2025, 62 Mitarbeiter (**unbestätigt**) —
das wären rund **0,27 USD pro Nutzer und Jahr**. Preis **6,99 €/Monat, 38,99 €/Jahr**.
Bewertungen: iOS 4,8 aus 70.000 · Android **4,3 aus 364.000** — die Kluft ist
auffällig. Kritik: Renderzeiten bis 15 Minuten, zufällige Aufzeichnungs-Pausen.

**Strava Flyover** — 3D-Videorückblick seit 15.11.2023, nur Abonnenten, **nur in der
App**, und entscheidend: **kein Download einer Videodatei**. Dokumentierte Probleme:
Framerate fällt bei langen Fahrten auf **1 fps**, Stottern ab 15–20 km.
**Flyby** lebt, aber web-only und seit Oktober 2020 standardmäßig **deaktiviert**.

**Komoot Route Video** — der unterschätzte Angreifer: **WebM, 1280×720**,
Esri-Satellitenkacheln, **100 % lokal im Browser**, kostenlos, ohne Account. Enthält
Fortschrittsspur, Minikarte, HUD, animiertes Höhenprofil — **und fest eingebranntes
komoot-Branding**.

**Coros** — der bemerkenswerteste Fund bei den Uhrenherstellern: **3D-Flyover-Videos,
komplett kostenlos, ohne Abo**, seit 19.08.2025, im Juli 2026 um Videoclips
erweitert. Es entsteht eine **echte Videodatei**. Der CEO hat öffentlich erklärt,
Features kostenlos halten zu wollen, solange die Hardware-Margen das tragen.
Schwäche: Aufnahme über den Bildschirmrecorder → kein 4K, nur mit COROS-Hardware.

**Suunto** — 3D-Wiedergabe seit Januar 2022, **kein Video-Export**; verweist
stattdessen auf eine **offizielle Relive-Partnerseite**. **Polar** — kein 3D, kein
Video. **Garmin Connect** — 3D-Karten nur mit Connect+, **kein Video**.

**Outdooractive / alpenvereinaktiv** — Pro 29,99 €/J, Pro+ 59,99 €/J. Flyover-Preview
nur Pro+ und **nicht speicherbar**; Flyover-Video mit Pro nur über **YouTube-Zwang
ohne Download**, erst Pro+ erlaubt Download (Link 7 Tage gültig).

**Trailforks** — Pro 53,99 USD im ersten Jahr, 3D-Flyover ja, **Video-Export nein**.
Der offizielle Weg zum Video ist ein *Community-Tutorial für Google Earth*.

### Die neue Web-Konkurrenz 2024–2026

| Dienst | Preis (30.08.2026) | Kern |
|---|---|---|
| **AvoMap** | Editor gratis; Credits **9 $/5 · 29 $/20 · 59 $/50** | 4K@60fps, 12 Stile, White-Label, Strava/AllTrails-Integration |
| **mapdirector** | **„Free while in beta"** | 4K in jedem Seitenverhältnis, echter Sonnenstand aus Track-Datum. Geschäftsmodell: **Auftragsproduktion** |
| **dddmaps** | Free (Wasserzeichen) · **PRO 9,99 $/Mon** | MP4, GPX-Animation + Zoom + Travel-Route |
| **Mapimator** | Free (3 Projekte, **1 Export/Monat, 720p**, Wasserzeichen) · Pro **12 $/Mon · 99 $/J** | 4K@60fps, AI Director. **Free und Pro nur für persönliche Nutzung — TV/Werbung erfordert Enterprise** |
| **TrailReplay** | **Kostenlos, Open Source** (46 ⭐, Push 28.08.2026) | **MP4 und WebM in 16:9, 1:1, 9:16**, 3D-Terrain, Comparison Mode, Annotationen. **Stärkster Gratis-Kandidat** |
| **Rumbo** | Free (720p, 30 s, 3/Tag) · **Pro 25 €/J** | **2D**, MP4, GPX+FIT, deutsche Oberfläche. Eigene Angabe: **70.000+ Videos von 20.000+ Nutzern** seit 2021 |
| **gpxmap3d** | Kostenlos | Chase/Top-Down/Side, macOS-App (nur Apple Silicon, v0.1.0). **Nur WebM.** Domain **19.06.2026** registriert, **kein Impressum** |
| **MapAnim** | Aktuell kostenlos, Pro „Coming Soon" | Web + iOS + Android |
| **anim8map** | Free bis 15 Stops; 7 $ einmalig / 24 $ Monat (**unbestätigt**) | Kritik: **jedes erneute Rendern nach einer Änderung kostet erneut ein Credit** |

**Fiverr** bietet 2D/3D-Kartenanimation ab **20 USD**, fortgeschrittene
3D-Routenanimation ab **75 USD** — ein Preisanker für Auftragsarbeit.

### Open Source / Desktop

**GPX Animator** — Apache 2.0, 377 ⭐, Java. Repo sehr lebendig (Push 29.08.2026),
**aber das letzte getaggte Release ist v1.8.2 vom 09.04.2023** — über drei Jahre.
**Nur 2D.** Die Entwickler weisen offen darauf hin, dass die Installer **nicht
signiert** sind, weil sie sich die Zertifikate (~100 €/Jahr macOS, ~270 €/Jahr
Windows) nicht leisten können. Roadmap-Zitat zum eigenen UI: „we know, it's really
awful now".

**GPXSee** — v16.14 (28.08.2026), 1.232 ⭐, teils wöchentliche Releases,
konkurrenzlose Formatvielfalt. **Rein 2D, Export nur PNG und PDF.** Interessant:
GPXSee *liest* Telemetrie **aus** Videodateien (GoPro GPMF, DJI, Sony RTMD, CAMM,
Dashcams) — es schreibt nur kein Video.

**GpsPrune** — v27 (07/2026). **Für Windows und macOS gibt es keinen Installer**, nur
die .jar. 3D über Java3D mit dokumentierten Fehlern (Debian-Bug #1068172, Arch
FS#70698) — funktioniert bei vielen Nutzern nicht. POV-Ray-Export liefert
**Standbilder**, keine Animation.

**Mapbox „Cinematic route animations"** — offizielles Tutorial mit Code, die
technische Blaupause, auf der die meisten kommerziellen Anbieter aufsetzen.

### Telemetrie-Overlay

| Tool | Preis | Kern |
|---|---|---|
| **Telemetry Overlay** | **199 USD** einmalig (regulär 299) inkl. 1 Jahr Updates | GoPro, DJI, Insta360, Garmin FIT, GPX, Tesla, RaceBox. Trustpilot **4,8 aus 76**. Lob: Support unter zwei Stunden, kein Abo |
| **StintBox** | Free (1080p, max. 5 Min., Wasserzeichen) · 99 €/6 Mon · **179 €/J** · **349 € perpetual** | 57 Widgets, 4K, Batch, nach Aktivierung **voll offline** |
| **Stamptivity** | **kostenlos, kein Wasserzeichen** | 60+ Gauges, GPX/FIT, **transparenter WebM-Export mit echtem Alpha**. Vermarktet sich als DashWare-Nachfolger |
| **GaugeReel** | Free / 10 $/Mon / 20 $/Mon | **Nur Windows**, v0.5.0. Transparente PNG-Sequenz, ProRes 4444, VP9 Alpha |
| **GpxOverlay** | **39 $/3 Mon · 59 $/J · 179 $ Lifetime** | 29+ Widget-Typen, kein Wasserzeichen |
| **Insta360 Studio** | **kostenlos** (GPS Remote 185,99 €) | v6.0.2 (17.08.2026) — das **aktivste Tool im Vergleich**. Dashboard mit Routen-Minikarte; Quellen: GPS Remote, Handy, Smartwatch, **GPX/FIT-Import** |
| **GEOlayers 3** | **329,99 USD einmalig** | After-Effects-Plugin, Broadcast-Stufe |

**Insta360 Studios Einschränkungen sind erheblich:** Stats-Export **wird mit
360°-Videos nicht unterstützt** (erst reframen), nicht nutzbar bei
Timelapse/TimeShift/Slow Motion/Bullet Time, **Beschriftungen nur auf Englisch**,
Icon-Farben nicht änderbar, kein Gauge-Designer, kein Höhenprofil-Diagramm, keine
Mehrfach-Tracks, keine 3D-Kamerafahrt.

**DJI** — Dashboard-Overlays nur mit dem Osmo Action GPS Bluetooth Remote; DJI Fly
zeigt den Flugpfad nur in-app **ohne Overlay und ohne Export**, Telemetrie liegt als
**.SRT-Spur** daneben.

### Google-Earth-Familie

**Google Earth Studio** — kostenlos, aber **Antrag erforderlich**, **nur Chrome**.
Limits: 10.000 Features pro Import, 250.000 Vertices; lokaler Export nur als
**Bildsequenz**, Cloud-Rendering bis **4096×2304**, aber **18.000 Frames/Tag** und
10 Tage Aufbewahrung.

**Der kritische Punkt: keine kommerzielle Lizenz.** Googles eigene FAQ sagt sinngemäß,
man biete derzeit **keine Lizenz** für kommerzielle Nutzung von Google-Earth-Material
an. Erlaubt sind Forschung, Bildung, Film und Non-Profit, jeweils **mit dauerhaft
eingeblendeter Attribution**. Mehrere Drittseiten behaupten das Gegenteil; das ist
**unzutreffend**. **Für einen monetarisierten YouTube-Kanal mit Affiliate-Links ist
das eine reale Grauzone.**

### Gleitschirm-Nische nach Ayvri

Auffällig: **Alle verlangen 5–7 € bzw. CHF im Monat, alle haben ein großzügiges
Free-Tier — und bei allen ist der Video-Export das Bezahl-Feature.**
- **XCviewer** — Free bis 2 Flüge; **Pro 5,90 CHF/Monat** → 4K-Cinematic-Export mit
  eigenem **Keyframe-Kamerapfad-Editor samt Easing**, Vergleich von bis zu 10 Piloten
- **SkyViz** — Basic 0 €; **Pro 58,80 €/Jahr**; MP4 vertikal und horizontal.
  Ausdrücklich „built by just one person", Domain seit 26.05.2025

---

## 4 · Features, die fast jedes Tool hat

GPX-Import · eine bewegte Linie mit Fortschrittsmarker · Höhenprofil ·
Basis-Statistik (Distanz, Höhenmeter, Tempo, Dauer) · Straßen-/Satellitenkarte ·
**ein Free-Tier** (bei praktisch jedem kommerziellen Anbieter) ·
Social-Media-Seitenverhältnisse bei allen Neuzugängen ab ~2024 ·
Cloud-Rendering mit Warteschlange ·
**ein Wasserzeichen oder Abspann als zentrale Bezahlschranke** — quer durch den
gesamten Markt *das* Monetarisierungs-Instrument

## 5 · Features, die kaum eines hat

1. **Echter lokaler Video-Render ohne Cloud und ohne Bildschirmaufnahme.** Fast alle
   rendern serverseitig (Relive, Rumbo, AvoMap, dddmaps, Mapimator, SkyViz) oder
   greifen den Bildschirm ab (TrailReplay, gpxmap3d, Komoot, Coros, Outdooractive).
   Genuin lokal und nativ: GPX Animator (2D), SkyGlide (iOS), die Overlay-Fraktion.
   **Genau an diesen Cloud-Kosten ist Ayvri gestorben, und deshalb musste Wandrer den
   Preis um 33 % erhöhen.**
2. **3D-Kamerafahrt und Telemetrie-Overlay im selben Werkzeug.** Die beiden Lager
   berühren sich nirgends. Wer beides will, exportiert aus zwei Programmen.
3. **Freie Kamerakontrolle mit Keyframes.** Nur AvoMap, XCviewer, Google Earth Studio
   und GEOlayers 3. Alles andere ist „ein Regler für die Geschwindigkeit" oder nichts.
4. **Wasserzeichenfreier Gratis-Export.** Genau vier gefunden: TrailReplay,
   Stamptivity, GPX Animator, mapdirector (nur während der Beta). Komoot brennt sein
   Branding fest ein.
5. **4K.** Bei Gratis- und Plattform-Angeboten praktisch nirgends (Komoot 720p, Relive
   1080p, Mapimator free 720p). 4K nur gegen Geld oder bei Google Earth Studio mit
   Lizenzproblem.
6. **Batch-/CLI-Verarbeitung.** Nur GPX Animator, Telemetry Extractor, StintBox Pro.
7. **Fotos und Videoclips an der GPS-Position eingebettet.** Relive, Coros (Clips erst
   seit 07/2026), Outdooractive, mapdirector, TrailReplay.
8. **Mehrere Tracks im Rennen gegeneinander.** GPX Animator, TrailReplay, XCviewer
   (bis 10 Piloten). Sonst kaum — obwohl es genau die Funktion war, für die
   Doarama/Ayvri geliebt wurde.
9. **Klare kommerzielle Nutzungsrechte.** Google Earth Studio hat **keine**;
   Mapimator verlangt Enterprise für Werbung; die meisten kleinen Dienste äußern sich
   **gar nicht**.
10. **Deutschsprachige Oberfläche.** Nur Rumbo, gpxmap3d, Kurviger, Outdooractive und
    Komoot. Insta360 Studio zeigt Dashboard-Beschriftungen **nur auf Englisch**.
11. **Rechtliche Mindestausstattung.** gpxmap3d hat kein Impressum und keine
    Datenschutzseite; mapdirector nennt weder Firmennamen noch Adresse.

---

## 6 · Preis-Landkarte

| Modell | Anbieter | Betrag |
|---|---|---|
| Gratis, unbegrenzt | Komoot Route Video, TrailReplay, gpxmap3d, GPX Animator, Stamptivity | 0 € |
| Gratis, im Hardwarepreis | **Coros 3D Flyover**, Insta360 Studio | 0 € |
| Gratis, eng limitiert | Rumbo Free (720p/30 s), Mapimator Free (1 Export/Monat), StintBox Free | 0 € |
| Günstiges Jahresabo | **Rumbo Pro 25 €/J**, Whympr 24,99 €/J | 24–25 €/J |
| Mittleres Abo | Relive Plus 38,99 €/J · Wandrer 40 $/J · Outdooractive Pro+ 59,99 €/J · SkyViz 58,80 €/J | 39–60 €/J |
| Pay-per-Render | **AvoMap 9/29/59 $** für 5/20/50 Exporte (1,18–1,80 $ pro Video) | ~1–3 $/Video |
| Plattform-Abo, 3D als Beigabe | Strava 74,99 €/J · **Garmin Connect+ 89,99 €/J** (ohne Video) | 75–90 €/J |
| Einmalkauf Desktop | RaceRender 39,95–59,95 $ · **Telemetry Overlay 199 $** · StintBox 349 € · **GEOlayers 3 329,99 $** | 40–350 $ |
| Auftragsarbeit | Fiverr ab 20 $ (2D) / 75 $ (3D) | 20–75 $+ |

---

## 7 · Was das strategisch bedeutet

**Der Markt ist 2025/2026 in Bewegung geraten, nicht gesättigt.** Innerhalb von
18 Monaten kamen Coros 3D Flyover (kostenlos), Garmin 3D Maps (Abo), Komoot Route
Video (kostenlos), HiiKER Flyovers, gpxmap3d, mapdirector, MapAnim und Mapimator
dazu. Gleichzeitig sind die Etablierten verwundbar: Ayvri ist tot, FATMAP verdaut,
Relive verliert seine Uhrenhersteller-Nische an Coros und Strava, Komoot hat 85 %
seines Teams verloren.

**Vier belastbare Lücken:**

1. **Lokales, natives Rendern ohne Cloud-Kosten.** Kein Feature, sondern ein
   Geschäftsmodell-Vorteil — und die Ursache, an der Ayvri zugrunde ging.
2. **MP4 statt WebM.** Die beiden stärksten Gratis-Angebote (Komoot, gpxmap3d) liefern
   **nur WebM** — in Final Cut und Premiere unbrauchbar. Strava, Suunto, Trailforks
   und Garmin liefern **gar keine Datei**.
3. **Kamerafahrt plus Overlay in einem Werkzeug.** Existiert bei niemandem.
4. **Wasserzeichenfrei und rechtssicher kommerziell nutzbar.** Google Earth Studio
   scheidet lizenzrechtlich aus, Komoot brennt sein Logo ein, Mapimator verlangt
   Enterprise für Werbung.

**Preisanker für eine Positionierung:** 25 €/Jahr (Rumbo) unten, 39 €/Jahr (Relive)
Mitte, 60 €/Jahr (Outdooractive Pro+, SkyViz) oberes Consumer-Ende, 199 $ einmalig
(Telemetry Overlay) im Prosumer-Segment. Die gesamte Gleitschirm-Nische hat sich
unabhängig voneinander auf **5–7 € pro Monat mit großzügigem Free-Tier, bei dem der
Video-Export die Grenze ist** eingependelt.
