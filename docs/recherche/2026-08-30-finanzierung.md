# Finanzierung kostenloser Outdoor- und Nischen-Desktop-Software

**Stand: 30.08.2026** · 40+ Suchen und Direktabrufe · öffentliche Kassenbücher, wo verfügbar

## 0 · Die Kernzahl vorweg

Bevor man über Erlöse redet, muss man wissen, welchen Betrag man decken muss. Für eine
kostenlose Cross-Platform-Desktop-App ist der Fixkostensockel erstaunlich klein:

| Posten | Kosten/Jahr |
|---|---|
| Apple Developer Program (Signierung + Notarisierung) | 99 $ |
| Windows Code-Signing OV (Sectigo/Comodo, günstigster öffentlich vertrauter Anbieter) | ab 219 $ (EV ab 296,65 $; DigiCert 400 $ OV / 507 $ EV) |
| Kartenkacheln bei Selbsthosting (Protomaps/PMTiles auf S3+CDN) | 0–20 $ |
| **Summe realistisch** | **ca. 320–420 €/Jahr** |

**Das ist die Schwelle. Alles darüber ist Gewinn, nicht Überleben.**

Zum Vergleich, was passiert, wenn man sie *nicht* erreicht: **GPXSee** — ein direkt
vergleichbares GPS-Tool — signiert seine Windows- und Mac-Installer bis heute
**selbstsigniert**, ausdrücklich „due to lack of project funding". Nutzer bekommen
SmartScreen- und Gatekeeper-Warnungen. Genau die Supportlast, die man vermeiden will:
Jede Warnung erzeugt eine E-Mail.

**Termin beachten:** Ab **1. März 2026** begrenzt das CA/Browser Forum die Laufzeit
öffentlich vertrauter Code-Signing-Zertifikate auf **458 Tage**.

---

## 1 · Spenden — die harten Zahlen

| Projekt | Eingenommen | Kontext |
|---|---|---|
| **gpx.studio** (Open Collective) | **11.810,36 €** gesamt, Jahresbudget ~**14.771 €** (≈1.231 €/Monat), **1.255 Beitragende** | Web-Tool mit hoher Reichweite, 5 Jahre Ko-fi-Vorlauf. Autor ist **Vincent Coppé** (nicht „Rafael Verbuggen") |
| **Organic Maps** | **14.537 $** eingesammelt, **158 Beiträge** | Projekt selbst: „far from achieving any sort of financial sustainability" |
| **KeePassXC** (Liberapay) | **197 $/Woche von 376 Patrons ≈ 10.266 $/Jahr** | plus Open Collective und GitHub Sponsors |
| **Krita** | ≈ **2.623 $/Monat von 233 Unterstützern** (~31 k$/Jahr) | plus Store-Erlöse, plus Einmal-Grants (50.000 $ FLOSS/fund 2025) |
| **Blender Foundation** | **3,1 Mio. € 2024**, Kleinspenden 618.000 € = 20 %, ~40 % von Firmen | **trotzdem Verlustjahr 2024**, Warnung vor niedrigen Rücklagen |
| **Signal** | ~50 Mio. $/Jahr ab 2025 | Startkapital: 105-Mio.-$-Darlehen von Brian Acton |

### Die Konversionsrate — die ehrliche Antwort

Marketing-Quellen behaupten „1–5 % spenden". Die Empirie sagt anderes:

- Studie zu Open Collective (Zhang et al., *JSEP*, 2025): **nur 26,61 % der Projekte
  erhalten überhaupt Spenden**, und **64,38 % davon bleiben kumuliert unter 50.000 $**
  — nicht pro Jahr, sondern insgesamt.
- **Median: 343 $** für firmengestützte, **79 $** für individuengestützte Collectives.
  Einzelspenden typisch **5–10 $**.
- **GitHub Sponsors**: 100+ Mio. $ kumuliert. Durchschnittliches Einzel-Sponsoring
  **8 $/Monat**, Organisations-Sponsoring **200 $/Monat** — Organisationen machen ~40 %
  des Volumens bei einem Bruchteil der Anzahl.

**Realistisch für eine deutschsprachige Nischen-Desktop-App:** 0,2–0,8 % der aktiven
Nutzer zahlen, im Schnitt 5–15 € einmalig. **Bei 3.000 aktiven Nutzern: 6–36 Zahler,
50–500 €/Jahr.** Das deckt den Fixkostensockel — mehr nicht.

### Plattformgebühren (2026)

| Plattform | Gebühr |
|---|---|
| **Liberapay** | 0 % Plattformgebühr — günstigste Option |
| **Ko-fi** | 0 % auf einmalige Trinkgelder (Free-Tier); 5 % auf Memberships/Shop |
| **Buy Me a Coffee** | 5 % pauschal, keine Reduktion möglich |
| **Patreon** | 8–12 % plus Abwicklung → **effektiv 11–17 %** |
| **App Stores** | 30 % |

### Der deutsche Steuer-Fallstrick

**Freiwillige Zahlungen an Selbstständige und Unternehmen sind Betriebseinnahmen** und
einkommensteuerpflichtig. Dass man sie „Spende" nennt, ändert nichts. Steuerfreie
Spenden gibt es nur bei gemeinnützigen Körperschaften (e. V., Stiftung, gGmbH).

**Umsatzsteuer** fällt an, sobald es eine **Gegenleistung** gibt. Reine Unterstützung
ohne Perks ist in der Regel kein Leistungsaustausch — aber „Supporter bekommen
Beta-Zugang" oder „Name im About-Dialog" macht es dazu.
**Praktische Konsequenz: keine Perks anbieten.** Das spart Umsatzsteuer *und* die
gesamte Supportlast, die aus Perks entsteht.

---

## 2 · Kartenkosten 2026 (direkt von den Anbieterseiten)

**Mapbox** — Web Map Loads: **50.000/Monat gratis**, dann **5,00 $/1.000** (50–100 k),
4,00 $ (100–200 k), 3,00 $ (200 k–1 M). Static Images: 50.000 gratis, dann 1,00 $/1.000.
Vector Tiles: 200.000 gratis, dann 0,25 $/1.000. Directions: 100.000 gratis, dann 2,00 $/1.000.

**MapTiler Cloud** — Free: 5.000 Map Sessions, **ausdrücklich „for testing, personal or
non-commercial use"**. Flex: **30 $/Monat**.

**Thunderforest** — für dieses Profil der interessanteste Anbieter:
**Hobby: kostenlos, 150.000 Tile-Requests/Monat**, keine Surge-Charges, **keine
Nicht-kommerziell-Klausel** — nur Attributionspflicht. Solo Developer 125 $/Monat.

**Stadia Maps** — Free: 200.000 Credits, **kommerzielle Nutzung ausdrücklich nicht
erlaubt**. Starter 20 $/Monat.

**Google Maps Platform** — seit März 2025 umgestellt: **Der 200-$-Universalkredit ist
weg**, stattdessen pro SKU eigene Freikontingente (10.000 Essentials, 5.000 Pro).
Dynamic Maps **7,00 $/1.000** darüber.

**OpenStreetMap-Tileserver** — für eine Desktop-App faktisch unbrauchbar: Die Policy
verbietet **explizit** Bulk-Download, Pre-Seeding, Offline-Archive und „Download for
offline use"-Funktionen. Verstöße werden „ohne Vorwarnung" geblockt.

### Die Lösung: BYOK oder Selbsthosting

Ein **zentraler API-Key in einer verteilten Desktop-App ist eine tickende Rechnung** —
er lässt sich aus dem Bundle extrahieren, und die Kosten skalieren mit dem Erfolg,
während die Einnahmen es nicht tun. Zwei saubere Auswege:

1. **Bring Your Own Key (BYOK)** — der Nutzer trägt seinen eigenen Schlüssel ein. Bei
   den Freikontingenten (Mapbox 50 k, Thunderforest 150 k) zahlt ein privater Nutzer
   nie etwas. Nachteil: Onboarding-Hürde und dadurch Supportanfragen.
2. **Selbstgehostete Vektorkacheln (Protomaps/PMTiles)** — technisch und
   wirtschaftlich die beste Option. Eine PMTiles-Datei liegt als **einzelnes Archiv**
   auf S3/R2 + CDN, **ohne Tile-Server**. Reale Kostenerfahrung aus der Praxis:
   **1,67 $ im ersten Monat, danach voraussichtlich 0 $.** Alternativen:
   **OpenFreeMap** (kostenlos, ohne Limits, ohne Registrierung) und **VersaTiles**.

---

## 3 · Affiliate im Outdoor- und Fotobereich

| Programm | Provision | Cookie | Anmerkung |
|---|---|---|---|
| **Amazon PartnerNet DE** | Sport/Fitness **4,0 %**, Outdoor **4,5 %** | **24 Stunden** | Zum 23.06.2025 gesenkt (Sport von 7 % auf 4 %). Vorteil: Provision auf den **gesamten Warenkorb** |
| **Bergfreunde** (Awin) | 7–15 % je nach Quelle | 30 Tage | |
| **Bergzeit** (Awin) | Standard **8 %**, **Premium 10 %** (Contentpartner nach Rücksprache) | 30 Tage | Premium ist für einen etablierten Kanal realistisch |
| **Globetrotter** | 5 % (teils 8 %) | 30 Tage | **Achtung:** Tracking ist ein Marketing-Cookie → funktioniert **nur mit Consent-Opt-in** |
| **Foto Erhardt** (Awin) | bis 7–8 % | **60 Tage** | Längste Cookie-Laufzeit im Feld, hohe Warenkörbe |
| **Garmin** | bis 8 % (netzwerkabhängig teils nur 2 %) | 20 Tage | |
| **Insta360** | ~5 % Ø, **8 % für Affiliate-Partner**, Boni ab 10 k Monatsumsatz | 30 Tage | |
| **Komoot** | **kein Affiliate-Programm** — ausdrücklich | — | fällt aus |
| **Strava** | **kein öffentliches Cash-Programm** | — | fällt praktisch aus |
| **AllTrails** (Impact) | 1 $/Registrierung, **10 % pro Abo** | — | einziges der Tour-Apps mit echtem Programm |

**Was verdient man pro 1.000 Besuchern?** Belastbare Branchenzahlen sind rar; einziger
klarer Benchmark: **eBay-EPC 0,05–0,10 $ pro Klick**. Modellrechnung (Schätzung):
1.000 Besucher → 3–8 % Klickrate (30–80 Klicks) → 2–5 % Conversion (1–4 Käufe) →
Ø-Warenkorb Foto/Outdoor 150–400 € → 4–8 % Provision → **10–80 € pro 1.000 Besucher**,
Schwerpunkt eher am unteren Ende.

Zur Einordnung: Deutscher YouTube-RPM **1–12 €/1.000 Views**, realistisch 1–2 €.
Affiliate schlägt AdSense in Technik-Nischen deutlich — **aber nur, wenn der Traffic in
Kaufabsicht steht.** Ein Nutzer, der gerade seinen Track rendert, hat keine. Ein Leser
von „Welche GPS-Kamera für Wanderungen" hat sie.

**Die entscheidende Konsequenz: Affiliate-Links gehören nicht in die App, sondern in
die Inhalte, zu denen die App den Traffic schickt.**

---

## 4 · Gescheiterte Modelle — die Lehre

**Ayvri** ist der direkteste Präzedenzfall: 3D-Visualisierung von GPS-Tracks, 2013 als
Doarama gegründet, **September 2022 abgeschaltet**. Begründung im Original: *„We were
never able to find a business model which justified the amount of investment."* Der
Mechanismus: Der Umsatz kam von **Geschäftspartnern**, nicht von der Community. Als die
Community wuchs, stiegen die Betriebskosten — während die B2B-Erlöse fielen. In
Übernahmegesprächen wurde der Nutzer-Community **kein Wert** beigemessen.

**DashWare:** 2010 entstanden, von GoPro übernommen, kostenlos, Standardwerkzeug der
Action-Cam-Szene. GoPro verlagerte den Fokus auf Quik, **2022 eingestellt**. Lehre:
**Ein kostenloses Tool im Besitz eines Hardwareherstellers lebt genau so lange, wie es
dessen Produktstrategie dient.**

**MeshCentral** (öffentlicher Server, 2023 abgeschaltet): ~280 $/Monat auf Azure — davon
nur ~50 $ die Instanz, der Rest **Traffic**.

**Die gemeinsame Lehre in einem Satz:** Bei kostenlosen Tools mit Serverkomponente sind
**Erfolg und Kosten positiv korreliert, Erfolg und Einnahmen nicht**. Jeder neue Nutzer
verschlechtert die Bilanz. **Ein reines Desktop-Tool ohne eigene Serverkomponente hat
dieses Problem strukturell nicht — ein enormer, oft unterschätzter Vorteil.**

---

## 5 · Lizenzrisiken — der wichtigste Abschnitt

### Grün: unbedenklich frei verteilbar

| Komponente | Lizenz | Auflage |
|---|---|---|
| **MapLibre GL JS** | BSD-3 | Copyright-Hinweis belassen. Ausdrücklich für Closed-Source und App-Store-Apps geeignet |
| **Leaflet** | BSD-2 | Hinweis belassen |
| **pywebview** | BSD | sauberste GUI-Option |
| **Playwright** | Apache 2.0 | Lizenzhinweise behalten; bundelt Chromium → Drittanbieter-Notices mitliefern |
| **PyInstaller** | GPL 2.0 **mit Bundling-Ausnahme** | Die erzeugten Bundles dürfen **jede beliebige Lizenz** tragen |

### Gelb: nutzbar, mit Pflichten

**ExifTool** (Artistic-1.0-Perl ODER GPL-1.0+) — Bündeln ist erlaubt, solange man es
**unverändert** mitliefert, den **Lizenztext beilegt**, den Code **nicht in den eigenen
einbaut** und **nicht separat dafür Geld verlangt**.

**FFmpeg** — der komplizierteste Punkt:
- Kern ist **LGPL-2.1+**; ein reiner LGPL-Build ist closed-source-tauglich.
- **libx264 und libx265 sind GPL-2.0+.** Wer sie einbindet, baut mit `--enable-gpl` —
  **damit ist der gesamte FFmpeg-Build GPL**.
- **Der Ausweg:** FSF-GPL-FAQ und ifrOSS sind sich einig — startet das Hauptprogramm
  ein GPL-Programm per **fork/exec** und kommuniziert nur über **Kommandozeile, Dateien
  oder Pipes**, sind es **getrennte Programme**. Die eigene App wird *nicht* GPL. Die
  Grenze: „intimate communication" (geteilte Datenstrukturen, Shared Memory).
- **Aber:** Wer den GPL-FFmpeg-Build **mitverteilt**, muss für *dieses Binary* die GPL
  erfüllen — Lizenztext beilegen und Quellcode bzw. schriftliches Quellenangebot
  bereitstellen. Die eigene App bleibt proprietär, das FFmpeg-Binary bleibt GPL.
- **Separat davon: Patente.** H.264/H.265 unterliegen Patentpools, unabhängig von der
  Lizenzfrage. Bei kostenloser Verteilung praktisch geduldet, aber ein Restrisiko.

### Rot: Finger weg

**Mapbox GL JS ab v2.0** (Dezember 2020) — **nicht mehr Open Source**. Erfordert aktive
kommerzielle Lizenz und Abo-Vereinbarung mit Mapbox, und **jede Initialisierung eines
`Map`-Objekts ist ein abrechenbarer Map Load**. Die letzte BSD-lizenzierte Version ist
**1.13** — davon ist **MapLibre GL JS** der Community-Fork.

> **Einordnung für GPS Studio:** Die App bündelt Mapbox GL JS 3.12.0, lädt Karten aber
> ausschließlich mit dem **Token des jeweiligen Nutzers** (BYOK) — das ist der von
> Mapbox vorgesehene Einsatzweg, und das Abrechnungsrisiko liegt beim Nutzerkonto, nicht
> beim Entwickler. Die Datei ist unverändert, Copyright-Header und Attribution bleiben.
> Dokumentiert in `ui/vendor/NOTICE.md`. **Kein akutes Problem, aber ein strategischer
> Klumpen:** Wer den Mapbox-Pfad eines Tages ganz verlassen will, hat mit MapLibre +
> Leaflet bereits beide Alternativen im Bundle.

**MapTiler Free und Stadia Free für kommerzielle Nutzung** — ausdrücklich untersagt.
**Thunderforest Hobby hat diese Einschränkung nicht.**

---

## 6 · Wie andere kostenlose Desktop-Tools mit Video-Export es machen

| Tool | Modell |
|---|---|
| **Shotcut / Kdenlive / OpenShot** | Vollständig kostenlos, kein Wasserzeichen, kein Feature-Gate. Spenden **rein optional und ändern nichts am Funktionsumfang** |
| **HandBrake** | Radikalste Variante: **keine juristische Person, keine Sponsoren, keine Geldspenden angenommen**. Infrastruktur als **Sachleistung** (MacStadium stellt einen Mac mini). **Null Supportlast durch Geldflüsse** |
| **DaVinci Resolve (free)** | Kein Spendenmodell, sondern **Hardware-Funnel**: kostenlose Vollversion als Einstieg ins Blackmagic-Ökosystem |
| **Telemetry Overlay** (direkter Wettbewerber) | **Bezahlt**: ~199 $ einmalig, Lizenz pro OS, ein Gerät, nicht übertragbar. Trial: 3 Tage, Wasserzeichen |
| **OsmAnd** | Abo statt Werbung: **5,99 €/Jahr** OsmAnd+. Google nimmt 30 % |

**Muster:** Die Tools mit dem geringsten Supportaufwand sind die, die **gar kein Geld
direkt vom Nutzer nehmen** (HandBrake) oder es **komplett vom Produkt entkoppeln**
(Blackmagic verkauft Hardware). Jede Form von Lizenzschlüssel, Aktivierung oder Trial
erzeugt genau die Supportkategorie, die man nicht will.

---

## 7 · Bewertungsmatrix

| Modell | Erlös/Jahr | Aufwand | Supportlast | Risiko |
|---|---|---|---|---|
| **Affiliate über Kanal + Website** | **500–5.000 €** | gering (Inhalte entstehen ohnehin) | **sehr gering** | gering: Consent, Kennzeichnung, Ratenkürzungen |
| **Freiwillige Unterstützung ohne Perks** | **50–800 €** | sehr gering | **sehr gering** | gering: Betriebseinnahme, steuerpflichtig |
| **Marken-/Hersteller-Sponsoring** | Sachleistung + evtl. 4-stellig | gering | sehr gering | **mittel**: Abhängigkeit, DashWare-Szenario |
| **Print-on-Demand-Poster** | 200–2.000 € | mittel | **hoch** (Retouren, Versand) | mittel: Handelsrecht, Widerruf |
| **Freemium / Pro-Version** | 1.000–15.000 € | **hoch** | **hoch** (Keys, Erstattung) | hoch: widerspricht „bleibt kostenlos" |
| **Cloud-Rendering / Hosting** | 0–3.000 € | hoch | **hoch** | **sehr hoch**: Ayvri-Muster, DSGVO |
| **Vereins-/Firmenlizenzen** | 0–5.000 € | **sehr hoch** | hoch | mittel: scheitert an der Gratisversion |

---

## 8 · Empfehlung

### Die drei passenden Wege

**1. Affiliate — ausschließlich außerhalb der App.** Die App ist kein Werbeträger,
sondern ein **Reichweitengenerator**: Sie erzeugt Videoaufrufe, Artikelaufrufe und
Suchtraffic. Dort stehen die Links. Nach Attraktivität: **Foto Erhardt (bis 7–8 %,
60 Tage)** und **Bergzeit Premium (10 % verhandelbar)** schlagen Amazon (4–4,5 %, 24 h)
bei Warenkorbwert deutlich; **Insta360 (8 %)** passt zur bestehenden Kooperation.
Der Wert: **kein neuer Supportkanal, keine Serverkosten.**

**2. Ein einziger, zweckgebundener Unterstützungs-Button ohne Gegenleistung.**
**Ko-fi oder Liberapay** (nicht beides), mit **konkretem, nachprüfbarem Zweck**:
*„Deckt Apple-Entwicklerkonto (99 $), Windows-Code-Signing (219 $) und Kartenkacheln."*
Ehrlich, niedrig, erreichbar — und beantwortet „wofür?" bevor die Frage kommt.
**Ausdrücklich keine Perks.** Erwartungswert 50–800 €/Jahr: genug für den
Fixkostensockel. Steuerlich als Betriebseinnahme verbuchen.

**3. Sachleistungs-Sponsoring durch den bestehenden Herstellerpartner.** Der
HandBrake/MacStadium-Weg ist unterschätzt: **kein Geld, sondern Sachleistung** —
Testgeräte, Zubehör, ggf. ein Windows-Testrechner. Dazu ein dezenter „Unterstützt
von"-Eintrag. Zwei Bedingungen: **Werbekennzeichnung** einhalten und **keine funktionale
Abhängigkeit** aufbauen — die App muss ohne den Sponsor weiterlaufen. Das ist die Lehre
aus DashWare.

### Die drei Fallen

**Falle 1: Ein eigener, zentraler Karten-API-Schlüssel in der verteilten App.** Der
Schlüssel liegt im Bundle, ist extrahierbar, die Rechnung skaliert mit dem Erfolg. Bei
Mapbox sind nach 50.000 Map Loads **5,00 $ je weitere 1.000** fällig — ein einziges gut
laufendes Video kann das sprengen. **Lösung: BYOK (schon umgesetzt) plus optional
selbstgehostete PMTiles.**

**Falle 2: Jede Form von eigenem Serverdienst** — Cloud-Rendering, geteilte Karten,
Hosting. Exakt das Ayvri-Muster. Dazu bei GPS-Tracks die **DSGVO-Verantwortung für
fremde Standortdaten**. Ein reines Desktop-Tool hat dieses Problem strukturell nicht;
dieser Vorteil sollte nicht freiwillig aufgegeben werden.

**Falle 3: Pro-Version, Lizenzschlüssel oder Abo.** Erzeugt genau die Supportkategorie,
die vermieden werden soll: Aktivierung, Geräte-/OS-Wechsel, Rückerstattungen,
Umsatzsteuer, OSS-Meldungen im EU-Ausland. Shotcut, Kdenlive und OpenShot beweisen die
Gegenrichtung — **kein Wasserzeichen, kein Feature-Gate, Spenden ändern nichts** — und
genau deshalb leisten sie kaum Lizenz-Support.

**Zusatzfalle: Print-on-Demand-Poster.** Marge sieht gut aus (Mapiful verkauft für 60 $,
Printful druckt ab ~9 $), aber jede Bestellung ist ein Handelsvorgang mit
Widerrufsrecht, Versandrisiko und Kundenkommunikation.
