# Artikel-Briefing: „Wie bringe ich GPS-Koordinaten in meine Fotos?“ (ÜBERARBEITUNG)

**Artikel 6 von 10**
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

## 2 · ⚠️ Sonderfall: das ist eine ÜBERARBEITUNG, kein neuer Artikel

Auf reisezoom.com steht seit dem **06.03.2023** der Artikel
**„Geotags zu Fotos hinzufügen — kostenlose Software für Mac & Win"**
(`reisezoom.com/geotags-zu-fotos-hinzufuegen/`).

**Er rankt vermutlich bereits.** Ein zweiter Artikel zum selben Keyword würde ihn
kannibalisieren. **Also: den bestehenden Artikel überarbeiten**, URL behalten,
Veröffentlichungsdatum aktualisieren.

**Erster Schritt für den schreibenden Chat:** den vorhandenen Artikel abrufen und
lesen. Was daran noch stimmt, bleibt — Marcs Stimme und seine Beispiele sind das
Wertvolle daran.

## 3 · Was seit 2023 veraltet ist (geprüft, Stand 08/2026)

- **GeoSetter** — nicht offiziell tot, aber faktisch stehengeblieben. Die Community
  weicht auf GeoTagNinja aus
- **Lightroom Classic** — das Kartenmodul hatte zwei Brüche: 2018 starb die Maps-View
  im ewigen LR 6.14, und nach einer Google-Änderung 2025 braucht die Suche
  **LrC ≥ 14.2**. **Lightroom Cloud hat gar kein Kartenmodul und keinen GPX-Import**
- **Capture One** — **kann kein Geotagging**, GPS lässt sich nicht einmal zwischen
  Bildern kopieren
- **HoudahGeo** — lebt, kostet **39 USD**, nur macOS
- **Apple Fotos** — schreibt in die Bibliotheksdatenbank, **nicht ins Bild**. Nutzer
  glauben, ihre Dateien seien getaggt, und sie sind es nicht. **Wichtiger Hinweis!**

## 4 · Der Lösungsweg

### Im Browser (`reisezoom.com/gps/tagger/`)

Track laden, Fotos laden, Zeitzone und Zeitversatz einstellen, „GPS in JPEGs
schreiben". **Alles im Browser — Fotos und Track werden nicht hochgeladen**, es gibt
keinen Server. Das ist bei Urlaubsfotos ein echtes Argument.

⚠️ **Die Grenze klar benennen: der Web-Tagger kann nur JPEG.**
Kein HEIC (also **keine iPhone-Fotos im Standardformat**), kein RAW, kein Video.
Als Track nur GPX. **Das muss im Artikel stehen** — sonst lädt jemand seine
iPhone-Bilder hoch und es passiert nichts.

### In der App (Modul Geotagger)

Hier liegt der eigentliche Funktionsumfang:
- **RAW** (CR3, CR2, NEF, ARW, RAF, RW2, ORF, DNG, PEF, RWL, SRW) und **HEIC/HEIF**
- **Videos** taggen
- **Ortsnamen** automatisch ergänzen (Umkehr-Geokodierung)
- **Aufnahmerichtung** setzen — über einen drehbaren Kompass auf der Karte
- **Fotos frei auf der Karte verschieben**, wenn die Zeitzuordnung danebenliegt
- **Mehrere Kameras** mit je eigenem Zeitversatz
- Auf dem Mac zusätzlich: **Auto-Tag per Bilderkennung**
- Schreibt in **Kopien**, das Original bleibt unangetastet

**ExifTool und der HEIC-Decoder stecken im Programm** — auf Mac und Windows muss
nichts nachinstalliert werden.

## 5 · Der Klassiker, der als eigener Abschnitt rein muss

**„Meine Fotos liegen ein paar Stunden neben der Route."**

Das ist die meistgestellte Folgefrage überhaupt. Ursache: **GPX-Zeiten sind immer
UTC**, Kamerazeiten sind lokal — dazu Sommerzeit und die Tatsache, dass Kamerauhren
über Monate wegdriften.

Drei Stellschrauben, die der Artikel erklären sollte: **Zeitzone**, **Zeitversatz**
(Kamera geht vor/nach) und **Toleranzfenster**. Der übliche Trick: ein Foto vom
Display einer Uhr mit bekannter Zeit machen, daraus den Versatz ablesen.

**Kein eigener Artikel dafür** — das gehört hierher.

## 6 · Was NICHT behauptet werden darf

- ❌ **Nicht:** „Der Web-Tagger nimmt alle Bildformate." → **Nur JPEG.**
- ❌ **Nicht:** „Du brauchst ExifTool auf dem System." → Es ist im Programm enthalten
  (dieser Fehler stand bis vor kurzem im eigenen Handbuch)
- ❌ Nicht behaupten, GeoSetter sei tot — es ist stehengeblieben, das ist ein
  Unterschied

## 7 · Folgefragen (im selben Artikel)

1. Werden meine Originale verändert? → nein, es entstehen Kopien
2. Was ist mit iPhone-Fotos (HEIC)? → App ja, Web-Tagger nein
3. Meine Kamera hat keine Uhr gestellt → Zeitversatz, siehe Abschnitt 5
4. Kann ich Videos taggen? → in der App ja
5. Sieht Google/Instagram meinen Standort? → ja, GPS steht in der Datei. Wer das nicht
   will, taggt bewusst nicht oder entfernt es wieder

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
