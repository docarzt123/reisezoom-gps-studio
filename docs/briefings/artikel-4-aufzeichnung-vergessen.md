# Artikel-Briefing: „Ich habe vergessen, die Aufzeichnung zu stoppen"

**Für:** eigener Chat, der den Artikel schreibt
**Ziel-Website:** reisezoom.com (deutscher Blogpost)
**Erstellt:** 30.08.2026 · Grundlage: Painpoint-Recherche + Prüfung der Werkzeuge am Live-System

---

## 0 · Zuerst lesen (Pflicht)

1. **Skill `reisezoom-content-style` aufrufen** — er enthält den Stil-Leitfaden für
   reisezoom.com und ist für diesen Artikel verbindlich.
2. **`CLAUDE.md`**, Abschnitt „Artikel-Auffindbarkeit — Absatzbau" (Pflicht bei neuen
   Artikeln) und „Thumbnail-/Titelbild-Richtlinien".
3. Dieses Briefing.

**Wichtigste Stilregeln in Kurzform:**
- H2 als **echte Nutzerfrage** formulieren
- **Antwort im ersten Satz** — Begründung danach, kein Spannungsbogen
- Jeder Abschnitt **selbsttragend**: Produkt beim Namen nennen statt „es"/„sie",
  kein „wie oben beschrieben". Richtwert ~120 Wörter je Abschnitt
- **Marcs Stimme:** sehr persönlich, praxisnah, ehrlich inklusive eigener Fehler.
  Kein Labortest-Ton, kein Handbuchton
- Kein FAQ-Schema von Hand, kein HowTo-Schema (wird automatisch erzeugt)

---

## 1 · Das Thema

**Die Nutzerfrage:** Jemand war wandern oder Rad fahren, hat die Aufzeichnung laufen
lassen und erst zu Hause gemerkt, dass die Autofahrt mit im Track steckt. Die Tour
zeigt 140 km statt 22, das Höhenprofil ist ruiniert, die Durchschnittsgeschwindigkeit
sinnlos.

**Suchintention:** Konkrete Notlage, hohe Handlungsabsicht. Die Person will **jetzt**
eine Lösung, nicht Hintergrundwissen. Deshalb: Lösung nach vorn.

**Warum dieses Thema zuerst:** Es lässt sich im Browser lösen (keine Installation),
und wir können dabei etwas zeigen, das **keine der großen Plattformen kann**.

---

## 2 · Beleglage (echte Fundstellen, verifiziert)

Diese Quellen belegen, dass die Frage real und wiederkehrend ist. **Sie dürfen im
Artikel erwähnt werden, müssen aber nicht** — sie dienen vor allem der Sicherheit,
dass hier kein erfundenes Problem beschrieben wird.

- **Garmin Forums (deutsch):** Thread „aktivität im nachhinein ändern/kürzen??"
  https://forums.garmin.com/de/apps-und-software/mobile-apps-web/f/garmin-connect-mobile-web/31465/aktivitat-im-nachhinein-andern-kurzen
- **Rennrad-News.de:** „GPX-Dateien editieren / Pausen rausschneiden"
  https://www.rennrad-news.de/forum/threads/gpx-dateien-editieren-pausen-rausschneiden.114734/
- **NaviBoard:** Threads zu Trackaufzeichnung starten/beenden
- Der in Foren übliche Rat lautet bis heute **Garmin BaseCamp** — das ist seit
  **März 2023 eingefroren**, läuft auf dem Mac nur noch über Rosetta 2 als
  Intel-Software und hat keinen Nachfolger. Das ist ein guter Aufhänger.

**Was die Plattformen können — geprüft, Stand 08/2026:**

| Plattform | Was geht | Was nicht geht |
|---|---|---|
| **Strava** | Crop von Anfang und Ende | **Irreversibel.** Kein Schnitt aus der Mitte |
| **Garmin Connect** | Trim mit „Restore Original" (umkehrbar) | Kein Schnitt aus der Mitte. Die Änderung betrifft **nur die Anzeige** — die FIT-Datei auf dem Server bleibt unverändert |
| **Komoot** | Kürzen von Anfang/Ende, **nur im Web** | Alles andere. Komoot wörtlich: *„It isn't possible to change any of these coordinates retrospectively."* |

**Keine einzige Plattform kann ein Mittelstück entfernen.** Das ist die Lücke.

---

## 3 · Der Lösungsweg — exakt so, nicht anders

### 3.1 Im Browser (der Hauptteil des Artikels)

**URL:** https://reisezoom.com/gps/ — dort „Track laden" oder Datei hineinziehen.
Es gibt einen Beispiel-Track („Beispiel ansehen") zum Ausprobieren ohne eigene Datei.

**Werkzeug: „✂ Kürzen"** unter „🛠 Track-Werkzeuge".

Es hat **zwei Regler: „Von" und „Bis"** (0 bis 100). Man legt damit fest, welcher
**Ausschnitt erhalten bleibt** — die Karte zeigt die Auswahl live mit. Danach
„Ausschnitt übernehmen" und über die Download-Knöpfe exportieren.

**Export-Formate im Browser:** GPX · KML · KMZ · TCX · GeoJSON · CSV

**Für unseren Fall:** Die Heimfahrt hängt am Ende → den **„Bis"-Regler** nach links
ziehen, bis der Track am tatsächlichen Ziel endet. Anfahrt am Anfang → „Von"-Regler.

⚠️ **Ganz wichtig und nicht verwischen:** „Kürzen" behält einen **zusammenhängenden
Ausschnitt**. Man kann damit vorn und hinten wegschneiden, aber **kein Stück aus der
Mitte entfernen**. Wer das braucht (Mittagspause, Abstecher zum Auto und zurück),
braucht die App — siehe 3.2. **Das Webtool nicht schöner darstellen, als es ist**,
sonst probiert es jemand aus, scheitert und kommt gar nicht erst zur App.

**Weitere Browser-Werkzeuge, die im Artikel kurz vorkommen dürfen** (jeweils mit den
echten Beschriftungen):
- **„✂✂ Teilen"** — „Schnitt bei" plus Auswahl „Erster Teil" / „Zweiter Teil".
  Wenn Hin- und Rückweg getrennt werden sollen.
- **„＋ Zusammenfügen"** — mit Feld „Pause dazwischen" (Sekunden). Für den Fall
  Akkuwechsel: zwei Dateien, eine Tour.
- **„✨ Säubern"** — Regler „Genauigkeit" und „Höchstgeschwindigkeit". Gehört
  eigentlich zum Ausreißer-Artikel, hier nur als Hinweis.

**Der Datenschutz-Punkt gehört rein:** Der Track wird **nicht hochgeladen**, alles
passiert im Browser. Auf der Seite steht das beim Foto-Werkzeug ausdrücklich
(„im Browser, nichts wird hochgeladen"). Das ist ein echtes Argument gegenüber
Web-Diensten, die Uploads verlangen.

### 3.2 In der App (der Zusatz, ehrlich abgegrenzt)

**Download:** https://reisezoom.com/gps/ (Mac und Windows, kostenlos, kein Konto,
keine Testphase, keine Werbung)

**Modul GPX-Inspektor.** Was dort zusätzlich geht:

- **„✂️ Punkte zwischen A→B rausschneiden"** — zwei Punkte auf der Karte anklicken
  (A grün, B rot), alles dazwischen fliegt raus, die Linie verbindet A und B direkt.
  **Das ist der Schnitt aus der Mitte, den keine Plattform kann.**
- **„Diesen Punkt löschen"** für einzelne Ausreißer
- **Anfang bis hierher entfernen** / **Alles danach entfernen** — punktgenau statt
  über einen Prozentregler
- **Vorher/Nachher sichtbar**, Undo, und das Original bleibt erhalten (die App legt
  vor dem Ersetzen eine Sicherung an)

**Ehrlich bleiben:** Für „Heimfahrt am Ende weg" reicht das Webtool vollkommen. Die
App lohnt sich, wenn mehrere Stellen zu bearbeiten sind, wenn es punktgenau sein muss
oder wenn ohnehin noch andere Dinge anstehen (Fotos verorten, Video bauen).

---

## 4 · Was NICHT behauptet werden darf

- ❌ **Nicht:** „Mit dem Webtool schneidest du beliebige Stücke heraus." → Falsch,
  siehe 3.1. Nur ein zusammenhängender Ausschnitt.
- ❌ **Nicht:** „Strava und Garmin können das gar nicht." → Beide **können** Anfang
  und Ende kürzen. Der Unterschied liegt bei der **Mitte** und bei der
  Umkehrbarkeit (Strava: irreversibel; Garmin: ändert nur die Anzeige).
- ❌ **Nicht:** BaseCamp als aktuelle Empfehlung darstellen. Es ist seit März 2023
  eingefroren, Intel-only auf dem Mac.
- ❌ **Keine erfundenen Zahlen** zu Downloads, Nutzern oder Testergebnissen.
- ❌ **Keine erfundene Anekdote.** Siehe Abschnitt 7.

---

## 5 · Folgefragen, die in DIESEN Artikel gehören

Nicht als eigene Seiten anlegen (= scaled content abuse), sondern als eigene
Abschnitte mit passender H2/H3:

1. **„Wie schneide ich die Mittagspause raus?"** → App, A→B (siehe 3.2)
2. **„Mein Akku war leer, ich habe zwei Dateien"** → Browser, „＋ Zusammenfügen"
   mit „Pause dazwischen"
3. **„Bleibt mein Original erhalten?"** → Ja. Der Browser lädt eine neue Datei
   herunter, die Ursprungsdatei wird nicht angefasst; die App legt vor dem Ersetzen
   im Archiv eine Sicherung an
4. **„Stimmen die Zeiten danach noch?"** → Ja, die Zeitstempel der verbleibenden
   Punkte bleiben unverändert, deshalb stimmen Dauer und Geschwindigkeit
5. **„Kann ich das auch bei Strava-Aktivitäten machen?"** → Aktivität als GPX
   exportieren, bearbeiten, neu hochladen. **Ehrlich dazusagen:** Beim Neu-Hochladen
   sind Kudos, Kommentare und Segment-Platzierungen der alten Aktivität weg — das ist
   ein bekannter Nachteil und der Grund, warum viele kaputte Aktivitäten stehenlassen

---

## 6 · Aufbau

1. **Titel** — die Nutzerfrage oder die Situation. Vorschläge (bitte prüfen und
   verbessern): „Vergessen, die Aufzeichnung zu stoppen? So schneidest du die
   Heimfahrt aus dem Track" · „GPX kürzen: Anfahrt und Heimfahrt aus der Tour
   entfernen"
2. **Einstieg** — die Situation in zwei, drei Sätzen. Marcs eigener Fall (Abschnitt 7)
3. **Die Antwort sofort** — „Das geht im Browser, ohne Installation, in etwa zwei
   Minuten." Dann der Weg
4. **Schritt für Schritt im Browser** — mit den echten Beschriftungen aus 3.1
5. **Warum die Plattformen es nicht lösen** — die Tabelle aus Abschnitt 2, in Fließtext
   übersetzt. Hier gehört der BaseCamp-Punkt hin
6. **Wenn du mehr brauchst: die App** — A→B aus der Mitte, punktgenau, Vorher/Nachher
7. **Folgefragen** aus Abschnitt 5
8. **Abschluss** — kurzer Hinweis auf das Werkzeug, ohne Verkaufston

---

## 7 · Was Marc liefern muss (NICHT erfinden!)

Der Artikel funktioniert nur mit einer **echten eigenen Geschichte**. Der schreibende
Chat soll dafür **Platzhalter setzen und Marc gezielt fragen**, statt etwas zu
erfinden:

- [ ] **Der eigene Fall:** Welche Tour? Was ist passiert — Auto, Bahn, Heimweg? Was
      stand hinterher falsch in der Statistik?
- [ ] **Screenshots:** Track vorher (mit Heimfahrt) und nachher. Am besten aus dem
      Webtool, damit man die Regler sieht
- [ ] **Titelbild:** 16:9, **mindestens 1200 px breit** (Richtwert 1920 × 1080),
      **kein Text im Bild** (sonst schneidet Google Discover es zu)

---

## 8 · Verlinkung

**Aus dem Artikel heraus:**
- `https://reisezoom.com/gps/` — das Webtool (Hauptlink, mehrfach, kontextnah)
- `https://reisezoom.com/reisezoom-gps-studio/` — die Tool-Vorstellung (Hub)

**In den Artikel hinein:** Der Hub-Artikel `reisezoom-gps-studio/` sollte einen Link
auf diesen Artikel bekommen, sobald er steht.

**Nicht verlinken:** `geotags-zu-fotos-hinzufuegen/` ist thematisch weit weg.

---

## 9 · Einordnung im Gesamtplan

Dieser Artikel ist **Nummer 4 von 10** aus `docs/CONTENT-PLAN-2026-08.md`. Er ist
bewusst der erste, weil er eine konkrete Notlage trifft, im Browser lösbar ist und
eine echte Lücke der Konkurrenz zeigt.

**Später geplant, hier nur anreißen statt ausbreiten** (jeweils eigener Artikel):
Höhenmeter korrigieren · GPS-Ausreißer glätten · Tour als Video · Fotos verorten
