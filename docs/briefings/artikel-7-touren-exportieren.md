# Artikel-Briefing: „Wie hole ich meine Touren aus Strava, Komoot oder Garmin heraus?“

**Artikel 7 von 10**
**Für:** eigener Chat, der den Artikel schreibt
**Ziel-Website:** reisezoom.com (deutscher Blogpost)
**Erstellt:** 31.08.2026 · Grundlage: Painpoint-Recherche + Prüfung am Live-System

---

## 0 · Zuerst lesen (Pflicht)

1. **Skill `reisezoom-content-style` aufrufen** — verbindlich für diesen Artikel.
2. **`CLAUDE.md`**, Abschnitte „Artikel-Auffindbarkeit — Absatzbau" und „Titelbilder".
3. Dieses Briefing.

**Stilregeln in Kurzform:** H2 als echte Nutzerfrage · **Antwort im ersten Satz** ·
jeder Abschnitt selbsttragend (Produkt beim Namen nennen, kein „wie oben beschrieben")
· Richtwert ~120 Wörter je Abschnitt · **Marcs Stimme**: persönlich, praxisnah, ehrlich
inklusive eigener Fehler, kein Handbuchton · kein FAQ-/HowTo-Schema von Hand.

---

## 1 · Die Kernbotschaft aller zehn Artikel

**Der Artikel löst das Problem des Lesers — und zeigt dabei, wo die Grenze liegt.**

Auf `reisezoom.com/gps/` gibt es Werkzeuge, die **direkt im Browser** laufen: kein
Download, kein Konto, nichts wird hochgeladen. Sie decken den häufigsten Fall ab.
**Die Download-App kann deutlich mehr** — sie ist das eigentliche Werkzeug, die
Webversion ist der schnelle Einstieg.

**So wird das erzählt:** erst die Lösung im Browser (wo es dort geht), dann ehrlich,
was die App zusätzlich kann. **Nicht** das Webtool schönreden — wer damit scheitert,
kommt nie zur App. Und **nicht** die App künstlich hochreden — die Grenze soll aus dem
Problem folgen, nicht aus dem Verkaufswunsch.

**Der Satz, der sinngemäß in jeden Artikel gehört:**
> Für den schnellen Fall reicht der Browser. Wer regelmäßig mit Touren arbeitet, nimmt
> die App — dort ist alles an einem Ort, und sie kann Dinge, die im Browser nicht gehen.

---

## 2 · Thema und Beleglage

Das Thema hat gerade Konjunktur, und zwar aus einem konkreten Grund:
- **Strava** hat zum **11.11.2024** die API-Bedingungen drastisch verschärft:
  Drittanbieter dürfen Daten nur noch dem Dateneigentümer selbst zeigen, kein
  KI-Training, keine „analytics". Betroffen waren unter anderem Intervals.icu,
  VeloViewer, Relive und TrainerRoad. **2026 wird das Entwicklerprogramm zusätzlich
  abo-pflichtig** (Stichtage 01.06. für neue, 30.06. für bestehende Entwickler)
- **Komoot** wurde im **März 2025** von Bending Spoons übernommen; berichtet wurde die
  Entlassung von 80–85 % der rund 250 Mitarbeiter. Neue Nutzer brauchen ein
  Premium-Abo (59,99 €/Jahr), um Routen an Geräte zu senden
- **Garmin** hat am **22.07.2026** TrainingPeaks übernommen

**Suchintention:** „Wie komme ich an meine eigenen Daten?" — teils aus Sorge, teils
weil jemand die Plattform wechseln will.

## 3 · Der Lösungsweg

### Schritt 1: Export bei der Plattform (gehört ausführlich in den Artikel)

- **Strava**: pro Aktivität „Export GPX" **oder** „Export Original".
  ⚠️ **Das ist nicht dasselbe** — „Export GPX" enthält Stravas *korrigierte* Höhe und
  weniger Daten; „Export Original" ist die rohe Datei vom Gerät (meist FIT).
  Für alles herunterladen: Kontoeinstellungen → Bulk-Export (ZIP)
- **Komoot**: Drei-Punkte-Menü → GPX. Nur bei freigeschalteten Regionen
- **Garmin Connect**: pro Aktivität, oder Bulk über „Export Your Data" (ZIP, 24–48 h
  Wartezeit)
- **Apple Watch**: **kein GPX ab Werk** — es braucht HealthFit, RunGap oder
  WorkOutDoors
- **Suunto, Polar, Coros**: Export in der jeweiligen App bzw. im Web
- **Huawei**: der schwierigste Fall — seit Juli 2024 gibt es einen Formatbruch, der
  den etablierten Konverterweg zerstört hat

### Schritt 2: Im Browser öffnen (`reisezoom.com/gps/`)

GPS Studio liest **GPX, FIT, TCX, KML, KMZ, GeoJSON und NMEA** — direkt im Browser,
ohne Upload. Und exportiert nach **GPX, KML, KMZ, TCX, GeoJSON und CSV**.

**Der wichtigste Punkt für diesen Artikel:** Wir hängen **an keiner API**. Es gibt
keinen „Mit Strava verbinden"-Knopf, der eines Tages abgeschaltet wird. Was du
exportiert hast, bleibt lesbar — auch wenn ein Anbieter seine Bedingungen ändert.
**Das ist eine bewusste Entscheidung, keine fehlende Funktion**, und der Artikel
sollte das genau so erklären.

### Schritt 3: In der App (was zusätzlich geht)

- **Archiv** — ganze Ordner einlesen, durchsuchen, nach Gegenden filtern, Statistik
  über Jahre. Genau das, was man nach einem Plattform-Export braucht: Ordnung in
  hunderte Dateien
- **FIT-Sensordaten** bleiben erhalten (Puls, Trittfrequenz, Leistung, Temperatur) —
  bei vielen Konvertern gehen sie verloren

## 4 · Was NICHT behauptet werden darf

- ❌ **Nicht:** „Wir holen deine Aktivitäten automatisch von Strava." → Es gibt
  **keine** API-Anbindung, und das ist Absicht
- ❌ **Nicht:** „Strava sperrt deine Daten." → Der Export für **eigene** Daten
  funktioniert. Verschärft wurde der **Drittanbieter-Zugriff**
- ❌ Keine Anleitungen erfinden — die Exportwege der Plattformen ändern sich; im
  Zweifel beschreiben, wo es ungefähr sitzt, statt Klickpfade zu behaupten

## 5 · Folgefragen (im selben Artikel)

1. Was ist der Unterschied zwischen GPX und FIT? → GPX ist der Nenner, FIT enthält
   die vollen Sensordaten
2. Warum ist meine Strava-Höhe anders als im Original? → Strava korrigiert selbst
3. Wie bekomme ich alles auf einmal? → Bulk-Export, dann Archiv
4. Was, wenn Strava/Komoot morgen zumacht? → exportierte Dateien bleiben lesbar
5. Kann ich die Dateien wieder hochladen? → ja, GPX nimmt jede Plattform

---

## Verlinkung

**Aus dem Artikel heraus:**
- `https://reisezoom.com/gps/` — das Webtool (Hauptlink, kontextnah, mehrfach)
- `https://reisezoom.com/reisezoom-gps-studio/` — die Tool-Vorstellung (Hub)

**In den Artikel hinein:** Der Hub-Artikel bekommt einen Link hierher, sobald er steht.

## Was Marc liefern muss (NICHT erfinden!)

- [ ] **Der eigene Fall** — welche Tour, was ist passiert, was war das Ergebnis
- [ ] **Screenshots** vorher/nachher
- [ ] **Titelbild:** 16:9, mindestens 1200 px breit, **kein Text im Bild**

Der schreibende Chat setzt dafür Platzhalter und **fragt gezielt nach**, statt eine
Anekdote zu erfinden. Ohne Marcs echte Geschichte ist es ein Handbuchtext — und genau
die Erfahrung unterscheidet uns von den Ein-Personen-Werkzeugen der Konkurrenz.

## Einordnung

Teil der Reihe aus `docs/CONTENT-PLAN-2026-08.md` (10 Artikel). Andere Themen der Reihe
hier nur anreißen, nicht ausbreiten — jedes hat einen eigenen Artikel.
