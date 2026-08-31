# Artikel-Briefing: „Wie lege ich Tempo, Höhe oder Puls über mein Video?“

**Artikel 10 von 10**
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

Creator-Bedarf mit echtem Marktwert: Der bezahlte Markt für Telemetrie-Overlays
beginnt bei **199 USD** (Telemetry Overlay). Gleichzeitig sind die früheren
Platzhirsche verschwunden:
- **DashWare** — von GoPro übernommen, eingestellt; die Domain löst nicht mehr auf
- **Garmin VIRB Edit** — eingestellt, und die **Kartenansicht funktioniert nicht mehr**
  (sie lief über eine eingebettete Internet-Explorer-Komponente)
- **RaceRender** — die Downloads sind seit dem **31.10.2019** unverändert

**Suchintention:** Jemand hat Videomaterial von einer Tour und will Werte einblenden.

## 3 · Der Lösungsweg — App, mit einer wichtigen Einschränkung

**Modul Daten-Animator.** Er rendert Höhe, Tempo, Puls, Trittfrequenz oder Leistung
als animiertes Diagramm — **mit echtem Alpha-Kanal** (ProRes 4444). Im
Schnittprogramm einfach über das eigene Material legen, fertig.

⚠️ **Die Einschränkung gehört ganz nach vorn, nicht ans Ende:**
**Wir lesen die Werte aus dem Track, nicht aus der Videodatei.** Wer GoPro-Telemetrie
direkt aus dem MP4 auslesen will, braucht dafür heute noch ein anderes Werkzeug.

**Warum das trotzdem für die meisten reicht:** Die wenigsten haben eine Kamera mit
GPS. Die üblichen Aufnahmen entstehen mit dem Handy oder einer Kamera ohne
Standortdaten — und **die Uhr am Handgelenk hat den Track ohnehin aufgezeichnet**.
Der praktische Weg ist also: Track aus der Uhr, Video aus der Kamera, beides über die
Uhrzeit zusammenbringen.

**Was für den Artikel wichtig ist:** die **Synchronisation** erklären. Video und Track
müssen zeitlich zueinander passen; der übliche Trick ist ein markanter Moment (Start,
Gipfel, Pause), an dem man beides ausrichtet.

## 4 · Was der Browser beitragen kann

**Kein Video-Overlay** — aber die Werte lassen sich vorher prüfen: Höhenprofil und
Tourdaten auf `reisezoom.com/gps/` zeigen sofort, ob der Track überhaupt Puls oder
Leistung enthält. Das erspart die Enttäuschung, in der App ein leeres Diagramm zu sehen.

**Ein praktischer Hinweis:** FIT-Dateien enthalten die volle Sensorik, GPX oft nicht.
Wer Puls oder Leistung einblenden will, sollte die **Originaldatei** exportieren
(bei Strava „Export Original") statt der GPX-Fassung.

## 5 · Was NICHT behauptet werden darf

- ❌ **Nicht:** „Wir lesen GoPro-Telemetrie aus dem Video." → **Können wir nicht.**
  Das ist die wichtigste Abgrenzung dieses Artikels
- ❌ **Nicht:** „Ersetzt Telemetry Overlay." → Für Kamera-Telemetrie ist das ein
  anderes und ausgereiftes Werkzeug. Wir sind die Lösung für den Fall
  *Track + Videomaterial*, nicht für *Telemetrie im Video*
- ❌ Keine automatische Synchronisation versprechen — die Ausrichtung ist Handarbeit

## 6 · Folgefragen (im selben Artikel)

1. Welche Werte gehen? → Höhe, Tempo, Puls, Trittfrequenz, Leistung, Temperatur —
   soweit sie im Track stehen
2. Wie kriege ich Puls in den Track? → Brustgurt oder Uhr, und FIT statt GPX exportieren
3. Wie synchronisiere ich das mit dem Video? → über einen markanten Moment
4. Welches Format fürs Schnittprogramm? → ProRes 4444 mit Alpha (Final Cut, Premiere,
   Resolve)
5. Geht auch ein Kartenausschnitt als Overlay? → ja, Animator mit Alpha-Export
   (Artikel 1)

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
