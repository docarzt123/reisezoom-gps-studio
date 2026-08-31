# Content-Plan: 10 Fragen, die GPS Studio heute schon beantwortet

**Erstellt:** 30.08.2026 · **Ziel:** Artikel auf reisezoom.com, die echte Suchfragen
beantworten und dabei zeigen, dass das Werkzeug dafür existiert.

## Grundlage

Abgeleitet aus der Painpoint-Recherche (`docs/recherche/2026-08-30-painpoints.md`)
plus gezielter Nachsuche nach den **tatsächlichen Formulierungen** in deutschen Foren.
**Jede Fähigkeit unten wurde vorher im Handbuch bzw. Code gegengeprüft** — hier steht
nichts, was die App nicht heute kann.

## Bestand auf reisezoom.com (wichtig!)

Zum GPS-Thema existieren bisher nur **zwei** Artikel:
- `reisezoom-gps-studio/` (21.05.2026) — die Tool-Vorstellung → wird der **Hub**,
  alle neuen Artikel verlinken dorthin und umgekehrt
- `geotags-zu-fotos-hinzufuegen/` (**06.03.2023**) — veraltet → **überarbeiten, nicht
  neu anlegen** (sonst Kannibalisierung auf das stärkste Keyword)

Dazu die Landingpage `reisezoom.com/gps/`. **Das Feld ist also praktisch leer** — es
gibt keinen Bestandsartikel, mit dem die neuen konkurrieren würden.

## Regel-Vorbehalt (CLAUDE.md)

> „Naheliegende Folgefragen im selben Artikel mitbeantworten — nie dafür dünne
> Extra-Seiten anlegen (= scaled content abuse)."

Die zehn unten sind bewusst so geschnitten, dass jede eine **eigene Suchintention**
hat. Was NICHT als eigener Artikel taugt, steht bei der jeweiligen Frage unter
„mitbeantworten". Wer daraus 20 Artikel macht, verstößt gegen die Regel.

---

## Die zehn Fragen

### 1. „Wie mache ich aus meiner Wanderung ein Video mit Karte?"
- **Beleg:** Der Dauerbrenner schlechthin — identisch formuliert von 2011 bis 2025
  (magix.info 2011/2013, mikemoto 2017, gs-forum 2017, naviboard 2020,
  cyclinguk 2020, trueadventure 09/2025). Jedes Werkzeug scheitert an *einem* Punkt.
- **Antwort im ersten Satz:** Track in den Animator laden, Kartenstil wählen,
  rendern — die Datei ist ein MP4, ohne Wasserzeichen, bis 4K.
- **Warum wir:** Läuft lokal, kein Konto, kein Abo, beliebig oft wiederholbar.
- **Mitbeantworten:** Wie lange dauert das Rendern? Welche Auflösung für YouTube?
  Was, wenn der Track keine Zeitstempel hat? Mehrere Touren gleichzeitig (Schwarm).
- **Potenzial:** ★★★ höchstes Suchvolumen, härtester Wettbewerb

### 2. „Relive kostet jetzt Geld — welche kostenlose Alternative gibt es?"
- **Beleg:** Acht Jahre konsistente Kritik in den App Stores (DE 18.04.2025: nicht mal
  Umbenennen ohne Abo; 27.08.2018: „9 Euro monatlich nahezu unverschämt"). Gratis
  liefert **960×540**, HD nur mit Plus. Videos **nur in der Handy-App**.
- **Antwort im ersten Satz:** Ja — und zwar ohne Auflösungsdeckel, weil auf dem
  eigenen Rechner gerechnet wird statt in der Cloud.
- **Andere Suchintention als Frage 1:** Hier sucht jemand einen *Vergleich*, dort eine
  *Anleitung*. Deshalb zwei Artikel — die sich gegenseitig verlinken.
- **Ehrlich bleiben:** Relive ist bequemer (Handy, automatisch aus Strava). Wer nur
  schnell eine Story will, ist dort richtig. Das gehört in den Artikel.
- **Mitbeantworten:** Was ist mit Komoot Route Video? (kostenlos, aber 720p, WebM und
  festes Branding) Was war Ayvri und warum ist es weg?
- **Potenzial:** ★★★

### 3. „Meine Höhenmeter stimmen nicht — wie korrigiere ich sie?"
- **Beleg:** Der am besten belegte Painpoint überhaupt — sechs unabhängige Foren:
  Garmin Forums (BaseCamp + fēnix 6), NaviBoard (zweimal), outdoorseiten.net,
  MTB-News, radforum.de, gpsforum.geospector.de. Zieht sich über ein Jahrzehnt.
- **Antwort im ersten Satz:** Im GPX-Inspektor „⛰ Höhe korrigieren" — er holt die
  Geländehöhe aus der Karte, zeigt beide Kurven übereinander und mischt sie per
  Regler; die Höhenmeter rechnen live mit, bevor man übernimmt.
- **Warum wir:** Der Mischregler ist der Unterschied. Fast alle anderen *ersetzen* das
  Profil komplett („will erase any existing altitude data" — GPS Visualizer).
- **Ehrlich bleiben:** Gegen langsame Wetterdrift hilft auch das nur begrenzt — das
  ist der Punkt, an dem später 43.1 ansetzt. **Nicht** versprechen, was noch fehlt.
- **Mitbeantworten:** Warum misst die Uhr überhaupt falsch? (Baro vs. GPS) Welche
  Uhren haben ein Barometer? Warum zeigen zwei Geräte auf derselben Tour
  unterschiedliche Werte?
- **Potenzial:** ★★★ bestbelegte Frage, klare Suchintention

### 4. „Ich habe vergessen, die Aufzeichnung zu stoppen"
- **Beleg:** Garmin-Forum („aktivität im nachhinein ändern/kürzen??"),
  Rennrad-News („GPX-Dateien editieren / Pausen rausschneiden"). Standardrat in den
  Foren ist BaseCamp — das seit März 2023 tot und nur noch Intel ist.
- **Antwort im ersten Satz:** Punkt anklicken, „Alles danach entfernen" — fertig.
- **Warum wir (echte Alleinstellung):** Wir schneiden auch **aus der Mitte**. Das kann
  **keine einzige Plattform** — Strava, Garmin Connect und Komoot kürzen nur die
  Ränder, und Stravas Crop ist zusätzlich **unumkehrbar**.
- **Mitbeantworten:** Mittagspause rausschneiden · zwei GPX nach Akkuwechsel
  zusammenfügen · warum das Original dabei erhalten bleibt.
- **Potenzial:** ★★★ konkrete Notlage, hohe Handlungsabsicht

### 5. „Mein Track hat Zickzack und springt durch die Gegend"
- **Beleg:** MTB-News „Fehlerbereinigung von GPS-Daten (GPX)" und „Nachbearbeiten,
  Auswerten und Archivieren von GPS-Tracks"; Garmin-Forum-Thread zu 250-km/h-Spitzen
  in der Gondel, ohne Antwort geschlossen.
- **Antwort im ersten Satz:** „🩹 Auto-Heilen" markiert die verdächtigen Stellen und
  zeigt als Vorschau, was es täte — man übernimmt einzeln oder alles.
- **Warum wir:** Zeitstempel bleiben erhalten, die Geschwindigkeit stimmt danach noch.
  Und Vorher/Nachher ist sichtbar — der Rest des Marktes ist eine Blackbox.
- **Mitbeantworten:** Woher kommen die Sprünge? (Häuserschluchten, Wald, Tunnel)
  Lücke im Tunnel schließen · Track auf den Weg schnappen lassen.
- **Potenzial:** ★★

### 6. „Wie bringe ich GPS-Koordinaten in meine Fotos?" → **ÜBERARBEITUNG**
- **Kein neuer Artikel.** `geotags-zu-fotos-hinzufuegen/` steht seit dem 06.03.2023
  und rankt vermutlich bereits. Ein zweiter Artikel zum selben Keyword würde ihn
  kannibalisieren.
- **Zu tun:** auf den Stand bringen — GeoSetter ist faktisch stehengeblieben,
  Lightrooms Kartenmodul hat 2018 und 2025 Brüche gehabt, Capture One kann es gar
  nicht. Und der eigene Geotagger dazu, inklusive RAW und Video.
- **Mitbeantworten (der Klassiker!):** „Meine Fotos liegen ein paar Stunden neben der
  Route" — Kamerazeit gegen Zeitzone. Das ist **die** meistgestellte Folgefrage und
  gehört als eigener Abschnitt hinein, nicht als eigene Seite.
- **Potenzial:** ★★★ Bestandsartikel mit Historie — größter Hebel pro Aufwand

### 7. „Wie hole ich meine Touren aus Strava, Komoot oder Garmin heraus?"
- **Beleg:** Strava hat die API zum 11.11.2024 drastisch eingeschränkt und macht das
  Entwicklerprogramm 2026 abo-pflichtig; Komoot gibt GPX nur für freigeschaltete
  Regionen; bei Bending Spoons wurde 2025 der Großteil des Teams entlassen. Das Thema
  „meine Daten aus der Plattform holen" hat gerade Konjunktur.
- **Antwort im ersten Satz:** Über den ganz normalen Datei-Export der Plattform — und
  danach liest GPS Studio GPX, FIT, TCX, KML/KMZ, GeoJSON und NMEA direkt ein.
- **Warum wir:** Wir hängen bewusst an **keiner API**. Was exportiert ist, bleibt
  lesbar, auch wenn ein Anbieter seine Bedingungen ändert.
- **Mitbeantworten:** Unterschied „Export GPX" und „Export Original" bei Strava ·
  Bulk-Export · was mit Apple Watch (HealthFit/RunGap) · warum FIT mehr enthält.
- **Potenzial:** ★★ aktuelles Thema, gute Gelegenheit für die Datensouveränitäts-Story

### 8. „Wie mache ich ein Bild meiner Tour für das YouTube-Thumbnail?"
- **Beleg:** Direkt aus Marcs Zielgruppe. Der naviboard-Thread nennt genau die
  Anforderungen: Nordausrichtung, lesbare Ortsnamen, kein fremdes Branding.
- **Antwort im ersten Satz:** Modul Tour-Map — Track laden, Format wählen, PNG
  speichern. Läuft **ohne Mapbox-Token** mit OpenStreetMap-Stilen.
- **Warum wir:** Kein Wasserzeichen, freie Größenwahl, Thumbnail-Format direkt dabei.
- **Mitbeantworten:** Welche Größe braucht YouTube? · Karte mit transparentem
  Hintergrund für die Montage · mehrere Etappen in einem Bild.
- **Potenzial:** ★★ kleines Suchvolumen, aber exakt Marcs Publikum

### 9. „Wie binde ich eine Karte meiner Tour in meinen Blog ein?"
- **Beleg:** Klassische Blogger-Frage; heute lösen es die meisten über eine
  Komoot-Einbettung — mit fremdem Branding, Cookie-Fragen und der Abhängigkeit davon,
  dass die Einbettung morgen noch funktioniert.
- **Antwort im ersten Satz:** Modul Web Karte erzeugt eine fertige HTML-Datei, die auf
  den eigenen Server kommt — ohne fremdes Skript, mit Einwilligungsknopf.
- **Warum wir:** Kein Drittanbieter im Frontend, damit auch keine DSGVO-Diskussion.
- **Mitbeantworten:** Mehrere Tracks in einer Karte · Höhenprofil dazu · was passiert,
  wenn der Kartenanbieter Preise ändert.
- **Potenzial:** ★★ dankbare Nische, wenig Wettbewerb

### 10. „Wie lege ich Tempo, Höhe oder Puls über mein Video?"
- **Beleg:** Creator-Bedarf; der bezahlte Markt dafür beginnt bei 199 USD
  (Telemetry Overlay). DashWare ist tot, Garmins VIRB Edit eingestellt.
- **Antwort im ersten Satz:** Der Daten-Animator rendert das Diagramm als Video mit
  **echtem Alpha-Kanal** (ProRes 4444) — im Schnittprogramm einfach darüberlegen.
- **Ehrlich bleiben:** Wir lesen die Werte aus dem **Track**, nicht aus der
  Videodatei. Wer GoPro-Telemetrie direkt aus dem MP4 will, braucht heute noch ein
  anderes Werkzeug. **Das ist die Wahrheit und gehört so in den Artikel** — sonst
  enttäuscht der erste Versuch.
- **Mitbeantworten:** Wie synchronisiere ich das mit dem Video? · Welche Werte gehen
  (Höhe, Tempo, Puls, Trittfrequenz, Leistung aus FIT)? · Overlay in Final Cut.
- **Potenzial:** ★★ hohe Kaufabsicht im Publikum (Kamera-Affiliate!)

---

## Reihenfolge

1. **Frage 6** zuerst — Bestandsartikel überarbeiten, größter Hebel pro Aufwand
2. **Fragen 3 und 4** — bestbelegte Notlagen, klare Suchintention, echte Alleinstellung
3. **Fragen 1 und 2** — höchstes Volumen, aber härtester Wettbewerb; profitieren davon,
   wenn vorher schon Artikel auf die Seite verlinken
4. **Fragen 5, 7** — solide Ergänzungen
5. **Fragen 8, 9, 10** — Nische, dafür exakt Marcs Publikum und Affiliate-tauglich

## Beim Schreiben beachten

- **Skill `reisezoom-content-style` ist Pflicht** für jeden dieser Artikel.
- **Absatzbau-Regel:** H2 als echte Nutzerfrage, Antwort im ersten Satz, jeder
  Abschnitt selbsttragend (Produkt beim Namen nennen), ~120 Wörter Richtwert.
- **Titelbild:** 16:9, mindestens 1200 px breit, kein Text im Bild.
- **Marc-Stimme:** eigene Erfahrung, eigene Tour, eigener Fehler. Kein Handbuchton.
  Die Artikel funktionieren nur, wenn eine echte Tour darin vorkommt.
- **Nicht überverkaufen.** Bei 3 und 10 stehen oben ausdrücklich die Grenzen — die
  gehören in den Text. Ein Artikel, der mehr verspricht, als die App hält, kostet
  mehr Vertrauen, als er Downloads bringt.

---

## Artikelaufbau (Marc-Vorgabe 30.08.2026)

**Problem formulieren → zeigen, wie GPS Studio es löst.** Dabei gilt:
**Wenn es im Browser geht, führt der Artikel über das Webtool** — keine Installation,
kein Konto, Ergebnis in zwei Minuten. Erst wenn das Webtool an seine Grenze kommt
(oder die Aufgabe nur die App kann), kommt der Download ins Spiel.

Das ist gleichzeitig ein sauberer Einstieg: Wer sein Problem im Browser gelöst
bekommt, hat einen Grund, sich die App anzusehen — statt umgekehrt erst installieren
zu müssen, um zu sehen, ob es hilft.

### Gliederung je Artikel

1. **H2 = die echte Nutzerfrage** (Absatzbau-Regel)
2. **Antwort im ersten Satz** — inklusive Aufwand: „Das geht im Browser, ohne
   Installation, in etwa zwei Minuten."
3. **Woran es liegt** — kurz, damit der Leser versteht statt nur klickt
4. **Der Weg im Browser** — Schritt für Schritt, mit Link auf `reisezoom.com/gps/`
5. **Wenn du mehr brauchst** — was die App zusätzlich kann, ehrlich abgegrenzt
6. **Folgefragen** im selben Artikel (nie als eigene dünne Seite)
7. **Marcs Tour** — der eigene Fall, an dem das Problem auftrat

### Was das Webtool auf `/gps/` heute kann (geprüft 30.08.2026)

**Track-Werkzeuge im Browser:** Zusammenfügen · Kürzen · Ausdünnen · Säubern ·
Teilen · Umkehren · Startpunkt · Höhen · Zeiten · Runden
**Dazu:** Karte ansehen · Höhenprofil · Tourdaten · Formate umwandeln
(GPX/KML/KMZ/TCX/GeoJSON/CSV) · Fotos verorten (`/gps/tagger/`) · Blog-Einbettung

**Nur in der App** (auf der Seite selbst mit „APP" gekennzeichnet):
Animator (Video) · Tour-Map (PNG) · Daten-Animator · Archiv · der **tiefe**
GPX-Inspektor (Ausreißer glätten, Lücken füllen, Höhe korrigieren mit Vorher/Nachher)

⚠️ **Sauber trennen:** „✨ Säubern" im Browser und „🩹 Auto-Heilen" in der App sind
nicht dasselbe, ebenso „⛰ Höhen" (holen) und „Höhe korrigieren" (Mischregler mit
Vorher/Nachher). Im Artikel nicht verwischen — sonst enttäuscht das Webtool.

### Zuordnung der zehn Fragen

| # | Frage | Weg | Anmerkung |
|---|---|---|---|
| 1 | Wanderung als Video | **App** | Animator — Kernfunktion, kein Webtool |
| 2 | Relive-Alternative | **App** | dito; Webtool als Vorgeschmack erwähnen |
| 3 | Höhenmeter korrigieren | **Gestuft** | Browser „⛰ Höhen" holt Kartenhöhen; App mischt mit Regler + Vorher/Nachher |
| 4 | Vergessen zu stoppen | **Browser ✅** | „✂ Kürzen" — sofort, ohne Installation |
| 5 | Zickzack und Sprünge | **Gestuft** | Browser „✨ Säubern"; App heilt gezielt mit Vorschau |
| 6 | Fotos geotaggen | **Browser ✅** | `/gps/tagger/` — Überarbeitung des Bestandsartikels |
| 7 | Touren aus Strava/Komoot | **Browser ✅** | Formate umwandeln, sechs Eingangsformate |
| 8 | Bild fürs Thumbnail | **App** | Tour-Map |
| 9 | Karte im Blog | **Browser ✅** | „🧩 Diese Tour auf deinem Blog" |
| 10 | Tempo/Puls über Video | **App** | Daten-Animator mit Alpha-Kanal |

**Fünf von zehn Fragen sind sofort im Browser lösbar** — das sind die Artikel mit der
niedrigsten Einstiegshürde und dem besten Verhältnis von Aufwand zu Wirkung.

## Sprachen (Beschluss 30.08.2026)

- **Deutsch im Blog** — Marcs Stimme, eigene Touren, zehn Jahre Domain-Autorität.
  Die belegte Nachfrage stammt aus deutschen Foren.
- **Englisch (später Spanisch) im `/gps/`-Bereich** — die Struktur steht bereits
  (`/gps/` = EN, `/gps/de/`, `/gps/es/`); die JS-Sprachweiche liegt nur auf `/gps/`
  selbst, Unterseiten wären davon nicht betroffen. WordPress hat **kein**
  Mehrsprachigkeits-Plugin und ist bewusst schlank — dort nichts nachrüsten.
- **Nicht übersetzen, neu schreiben:** Die englische Suchintention ist „gib mir den
  Schritt", nicht „erzähl mir deine Wanderung". Geschwister, keine Kopien.
- **Zuerst international**, weil die Konkurrenz dort eine belegte Fähigkeitslücke hat:
  Fragen **4** (Mitte schneiden — keine Plattform kann es, gpx.studio nur per Rechteck),
  **5** (automatische Ausreißererkennung — **gpx.studio kann das nicht**), **1/2**
  (Video lokal in 4K ohne Wasserzeichen) und die **ganze Kette** (kann keiner der fünf).
- Zur Einordnung: Von den fünf üblichen Gegnern ist nur **gpx.studio** groß
  (833k Besuche/Quartal) — und der macht etwas anderes. **TrailReplay hat 46
  GitHub-Sterne**, GpxFix/PeakLine/TrailBlender sind Ein-Personen-Projekte von
  2025/26 ohne Domain-Autorität.
