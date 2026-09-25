# Testprotokoll GPS Studio — Klicktest für einen unabhängigen Test-Chat

Stand: 25.09.2026 · App-Version 0.9.724 · Testrechner: Mac mini (dieser Rechner)

Dieses Dokument ist die Arbeitsanweisung für einen Chat **mit Computersteuerung**, der
GPS Studio von Anfang bis Ende durchklickt und einen Bericht schreibt. Es setzt kein
Vorwissen voraus. Wer es liest, soll ohne Rückfragen testen können — und wissen, wann er
aufhören und fragen muss.

---

## Teil A — Bevor du anfängst

### A1. Deine Rolle

Du bist Tester, nicht Entwickler. Du **änderst keinen Code**, keine Einstellungen außerhalb
der App und keine Dateien außerhalb von `~/GPS-Studio-Test`. Du klickst, beobachtest,
vergleichst mit dem Soll und schreibst auf, was du siehst. Ein Fehler, den du findest, ist
ein Erfolg deiner Arbeit — beschreibe ihn so, dass man ihn nachstellen kann.

### A2. Was du nie tust

| Tabu | Stattdessen |
|---|---|
| Einen **Fehlerbericht an Marc absenden** (Hilfe → Feedback / Bug-Report) | Fenster öffnen, prüfen, **Abbrechen** |
| Ein **macOS-Fenster** mit Berechtigungen, Passwort, „Erlauben", Schlüsselbund oder Installation bestätigen | Test anhalten, Screenshot, Marc fragen |
| **API-Schlüssel, Tokens, Passwörter** eintippen (Mapbox, MapTiler, Cloud-Passwort) | Die Test-App hat die Kartenschlüssel schon. Fragt die App danach: „kostenlos"/„später" wählen und notieren |
| Die **normale App** benutzen (ohne „· TEST" oben rechts) | Nur über `scripts/testumgebung.sh starten` starten |
| Dateien außerhalb von `~/GPS-Studio-Test` öffnen, speichern oder löschen — vor allem **nichts unter `/Volumes/Fotos`** | Speichern-Dialoge immer auf `~/GPS-Studio-Test/Ausgaben` stellen |
| Release, Tag, Deploy, eigene Uploads auf reisezoom.com (FTP, Browser …) | — |
| Cloud-Einstellungen ändern, trennen, mit einer anderen Adresse verbinden | Nur ansehen (Block CL) |

**Der automatische Cloud-Abgleich der Test-App ist erlaubt und gewollt.** Meldet die ☁-Anzeige
„Änderungen erkannt — Hochladen startet gleich“ oder lädt sie hoch, ist das die **Test-Cloud**
(`reisezoom.com/rz-cloud-testrechner/`) — kein Grund zum Anhalten. Prüfen kannst du das mit
`testumgebung.sh status` (Zeile „Cloud:“). Anhalten nur, wenn dort **nicht** `rz-cloud-testrechner`
steht oder die App eine andere Adresse anzeigt.

Zur Sicherheit verweigert die App auf diesem Rechner ohnehin jedes Löschen und
Überschreiben außerhalb von `~/GPS-Studio-Test` (Datei `testrechner.json` im App-Ordner).
Meldet sie „Dateischutz: … verweigert (testrechner)", hast du ein Ziel außerhalb gewählt —
das ist **kein Fehler der App**, sondern ein Hinweis, dass du den Ordner falsch gewählt hast.

### A3. Die Umgebung

Alles liegt unter `~/GPS-Studio-Test`:

| Ordner | Inhalt |
|---|---|
| `App-Ordner/` | Einstellungen, Logs (`logs/app.log`), Renders, Papierkorb der Test-App |
| `Bibliothek/` | Die Test-Bibliothek (Archiv-Datenbank, Projekte, Touren) |
| `Arbeit/archiv/` | Tracks, die im Archiv stehen (vorbefüllt) |
| `Arbeit/zum-oeffnen/` | Tracks, die **nicht** im Archiv sind: `01-formate`, `02-fehlerfaelle`, `06-tagesdateien` |
| `Arbeit/fotos/geotagger/` | Testfotos zur Tour „Barranco de Masca" (05.05.2023, Ortszeit UTC+1) |
| `Arbeit/fotos/echt-ohne-gps/` | 76 echte Fotos von Marc zur selben Tour (Canon G5 X II + Pixel 6 Pro), GPS entfernt — für den Geotagger |
| `Arbeit/fotos/echt-mit-gps/` | Dieselben 76 mit GPS (aus Lightroom) — für den Foto-Bestand |
| `Arbeit/fotos/echt-soll-positionen.json` | Soll-Position je echtem Foto |
| `Arbeit/fotos/bestand/` | Foto-Ordner mit Unterordnern und einem Duplikat |
| `Arbeit/reiseroute/stationen.txt` | Stationen für die Reiseroute |
| `Ausgaben/` | **Hierhin** speicherst du alles (Videos, PNGs, HTML, GPX, .rzproj) |
| `Berichte/` | Dein Bericht und deine Screenshots |
| `SOLL-WERTE.md` | Soll-Werte je Datei (Strecke, Dauer, Punkte, Track-Check, Logbuch) |
| `SOLL-ARCHIV.md` | Track-Check-Marke je Tour, wie das Archiv sie zeigen soll |
| `Quellen/` | Unveränderliche Vorlage — **nie** darin arbeiten |

Die Arbeitskopien werden bei jedem Zurücksetzen frisch aus `Quellen/` angelegt. Was du
kaputt machst, ist beim nächsten Zurücksetzen wieder heil; der vorige Stand liegt dann in
`_alt/<Zeit>/` — dort bleiben nur die letzten zwei Stände, Älteres räumt das Skript selbst weg.

### A4. Starten, Zurücksetzen, Beenden

Im Terminal (Arbeitsordner `…/Reisezoom-GPS-Studio`):

```bash
./scripts/testumgebung.sh zuruecksetzen vorbefuellt
```
```bash
./scripts/testumgebung.sh starten
```
```bash
./scripts/testumgebung.sh status
```
```bash
./scripts/testumgebung.sh vorne
```

- **vorbefuellt**: Archiv mit 35 Touren (39 Dateien), zwei Sammlungen („Teneriffa Februar 2026",
  „Problemfälle"), Kartenschlüssel gesetzt, Sprache Deutsch. Standard für alle Blöcke.
- **leer**: Erststart mit Onboarding, ohne Bibliothek und ohne Schlüssel. Nur für Block ER.
- Vor dem Zurücksetzen die Test-App mit **⌘Q** beenden, sonst bricht das Skript ab.
- `starten` holt eine schon laufende Test-App nach vorne statt sie ein zweites Mal zu starten; `vorne` tut nur das.
- Nach dem Start steht oben rechts **„v0.9.724 · TEST"** auf gelbem Grund. Fehlt das,
  sofort beenden — dann läuft die falsche App.

### A5. Dateien auswählen

Die App öffnet macOS-Dateidialoge. Am schnellsten: im Dialog **⌘⇧G** drücken, den Pfad
einfügen (z. B. `~/GPS-Studio-Test/Arbeit/zum-oeffnen/01-formate/`), Enter, Datei wählen.
Drag & Drop aus dem Finder geht ebenfalls.

### A6. Bericht

Lege zu Beginn `~/GPS-Studio-Test/Berichte/<JJJJMMTT-HHMM>/` an (Zeit mit
`date "+%Y%m%d-%H%M"`). Darin:

- `bericht.md` — die Tabelle aus Teil D, eine Zeile je Schritt-ID.
- Screenshots `<ID>.png` (z. B. `AN-07.png`), mindestens bei jedem **gescheitert** und bei
  jedem Schritt mit „📷" in der Tabelle. Bildschirmfoto: `screencapture -x <pfad>`.
- Bei gescheitert: die letzten 40 Zeilen aus `~/GPS-Studio-Test/App-Ordner/logs/app.log`
  in den Bericht kopieren (Namen von Personen daraus entfernen).

Ergebnis je Schritt: **✅ bestanden** · **❌ gescheitert** · **⚠️ auffällig** (geht, aber
etwas stimmt nicht: Text abgeschnitten, langsam, verwirrend) · **⏭ übersprungen** (mit Grund).

Zahlen vergleichst du mit `SOLL-WERTE.md` bzw. `SOLL-ARCHIV.md`. Toleranz: Strecke ±1 %,
Zeiten ±1 min, Höhenmeter ±5 %. Die Anzeige rundet — 35,7 km und 35,72 km sind gleich.

### A7. Wann du aufhörst und fragst

**Vorsicht, fremde Fenster:** Auf diesem Rechner laufen zeitweise andere Automationen (z. B. ein
Codex-Prüfauftrag alle 5 Minuten), die ein anderes Fenster nach vorne holen. Prüfe vor **jedem**
Klick per Screenshot, dass GPS Studio vorne ist (Titel „GPS Studio by reisezoom.com", gelbes „TEST").
Ist ein anderes Fenster vorne: nichts darin anklicken, die Test-App nach vorne holen mit
`"/Volumes/MacMini 2TB Acasis/Claude-Masterblaster/Reisezoom-GPS-Studio/scripts/testumgebung.sh" vorne`, neu fotografieren.

**Nie die App anders starten oder aktivieren** — nicht über Dock, Finder, Spotlight, `open -a` oder
`tell application "Reisezoom GPS Studio" to activate`. Das startet die **normale** App dieses Rechners
(mit Marcs echter Bibliothek). Erkennbar an fehlendem „TEST" oder an einem Fenster „Deine Daten sind
umgezogen" mit einem Pfad unter `~/Library/Application Support/…`: sofort ⌘Q, nichts darin anklicken,
dann `testumgebung.sh starten`.


- Ein macOS-Berechtigungs- oder Passwortfenster erscheint.
- Die App friert länger als 2 Minuten ein oder stürzt ab (dann: Log sichern, neu starten,
  weiter mit dem nächsten Block).
- Eine Aktion würde etwas außerhalb von `~/GPS-Studio-Test` verändern.
- Ein Schritt ist hier unklar beschrieben — dann ⏭ mit Notiz, nicht raten.

### A8. Aufwand

Kurztest (Teil B) ca. 30 min. Alle Blöcke (Teil C) ca. 5–6 h. Renders dauern: 10-s-Video
1–3 min, Tour-Map-PNG ~10 s. Wenn die Zeit knapp ist: Teil B, dann AR, IN, AN, GT, PR.

---

## Teil B — Kurztest (Smoke, 30 min)

Umgebung: `zuruecksetzen vorbefuellt`, `starten`.

| ID | Aktion | Erwartet |
|---|---|---|
| S-01 📷 | App starten, 20 s warten | Fenster offen, oben rechts „v0.9.724 · TEST", keine Fehlermeldung |
| S-02 | Reiter **📚 Archiv** → **Touren-Archiv** | 35 Touren; links Sammlungen „Problemfälle" (19) und „Teneriffa Februar 2026" (5) |
| S-03 | Suchfeld: `Teide` | Die Teide-Tour mit „2×" (angezeigt mit ihrem GPX-Titel „Pico del Teide Brutal …") über den Namen; dazu Treffer über die Gegend (Santiago del Teide, La Orotava). Der Hinweis nennt beide Zahlen (z. B. „4 Touren hier · 2 über den Namen") |
| S-04 | Tour **kaputt-mit-absicht** anklicken | Kachel mit rotem ⚠︎; rechts Track-Check mit Sprung, Höhen-Müll, Lücke, Zeit rückwärts |
| S-05 | Doppelklick auf **Wer sieht die Schildkröte 🐢** | Animator öffnet, Track auf der Karte, Strecke ≈ 15,8 km |
| S-06 | **Probe-Lauf** (oder Leertaste) | Punkt läuft die Strecke ab, Stats-Box zählt hoch, Leertaste stoppt |
| S-07 | Reiter **Tour-Map**, Seitenverhältnis 16:9 mit 1920×1080 wählen (die Bezeichnung in der Liste kann anders lauten), **Karte als PNG rendern** → `Ausgaben/` | PNG entsteht in ~10–20 s; die Ergebnisansicht „✓ Bild fertig“ **zeigt das Bild** (kein kaputtes Bildsymbol) |
| S-08 | Reiter **GPX-Inspektor** | Alle Punkte sichtbar, Befund-Kasten, Logbuch unten mit Einträgen |
| S-09 | Reiter **Geotagger**, Ordner `Arbeit/fotos/geotagger/` laden. **Keine** Vorschläge übernehmen (das kommt in GT) | 17 Dateien als Kacheln; links „17 Medien aus Ordner (15 JPG + 1 HEIC + 1 Video)“ |
| S-10 | Einstellungen (⚙) öffnen, Unterseiten MapTiler, Mapbox und Länder-Schlüssel ansehen, schließen. **„👁 Anzeigen“ nicht drücken** | Jedes Schlüsselfeld zeigt nur Punkte und hat daneben „👁 Anzeigen“; kein Schlüssel im Klartext |
| S-11 | Hilfe → Erste Schritte | Hilfe öffnet, lesbar |
| S-12 | Im Geotagger ist Masca geladen: App mit ⌘Q beenden, per `testumgebung.sh starten` neu starten, 20 s warten | Die App öffnet wieder den **Geotagger mit der Masca-Tour** (Fotos muss man neu laden — die gehören nicht zur Tour). Mit gespeichertem Projekt: dieses Projekt im letzten Modul |

---

## Teil C — Blöcke je Bereich

Wenn nicht anders angegeben: `zuruecksetzen vorbefuellt` vor dem Block ist **nicht** nötig,
es sei denn, ein vorheriger Block hat Daten verändert, die hier gebraucht werden.

### ER — Erststart und Onboarding

Umgebung: **`zuruecksetzen leer`**, dann `starten`. Danach für alle weiteren Blöcke wieder
`zuruecksetzen vorbefuellt`.

| ID | Aktion | Erwartet |
|---|---|---|
| ER-01 📷 | Starten | Onboarding „Wo soll deine Bibliothek liegen?" in drei Schritten |
| ER-02 | Ort wählen: `~/GPS-Studio-Test/Bibliothek` (neu anlegen) | Wird angenommen; keine Rückfrage nach Cloud-Ordnern |
| ER-03 | Frage nach Mapbox-Token / Kartenanbieter | **Kostenlos** wählen. Nichts eintippen |
| ER-04 | Archiv öffnen | Leere Fläche mit großem „+ Ordner hinzufügen" |
| ER-05 | Ordner `~/GPS-Studio-Test/Arbeit/archiv` hinzufügen | Einlesen läuft mit Fortschritt, am Ende 35 Touren (39 Dateien, 4 mehrfach) |
| ER-06 | Frage „Bestand prüfen?" (falls sie kommt) | Beantworten mit „Prüfen"; Marken wie in `SOLL-ARCHIV.md` |
| ER-07 | Animator mit einer Tour öffnen | Karte kostenlos (OSM/OpenFreeMap), Probe-Lauf geht |
| ER-08 | Beenden und neu starten | Kein Onboarding mehr, Bibliothek wieder offen |

### BI — Bibliothek und Einstellungen

| ID | Aktion | Erwartet |
|---|---|---|
| BI-01 | ⚙ → Bibliothek & Cloud: Name der Bibliothek auf `Test` setzen | Name erscheint oben im Archiv |
| BI-02 | **Sicherung erstellen …** → Ziel `Ausgaben/` | ZIP mit Zeitstempel im Namen; ein zweiter Klick überschreibt nicht |
| BI-03 | Sprache auf **English**, dann **Español**, dann zurück Deutsch | Oberfläche wechselt vollständig; keine deutschen Reste in Menüs/Knöpfen (📷 je Sprache vom Archiv) |
| BI-04 | Render-Qualität/Export-Einstellungen ansehen | Werte lesbar, Änderungen bleiben nach Neustart |
| BI-05 | „Einstellungen zurücksetzen und neu starten …" **nicht** ausführen, nur öffnen und abbrechen | Rückfrage erscheint, Abbrechen lässt alles wie es ist |

### AR — Archiv

| ID | Aktion | Erwartet |
|---|---|---|
| AR-01 📷 | Alle Touren, Rasteransicht | Kacheln mit Kartenbild, Datum, km; Marken rot/gelb wie `SOLL-ARCHIV.md` |
| AR-02 | Listenansicht (≡), nach Strecke sortieren | Längste oben: „reise-5-wochen" 5869 km |
| AR-03 | Filter: Arten → Rad | Nur Rad-Touren (u. a. fehlalarm-zitter-spike-rad) |
| AR-04 | Filter: Zeitraum 2026 / ab 20 km | Liste passt, **Filter zurücksetzen** stellt alles her |
| AR-05 | Sammlung **Teneriffa Februar 2026** öffnen | 5 Touren vom 17.–22.02.2026 |
| AR-06 | Neue Sammlung `Test-Sammlung`, 3 Touren per ⌘-Klick hinzufügen, umbenennen, löschen | Alles klappt; Löschen der Sammlung löscht **keine** Touren |
| AR-07 | Tour **Teide Original** favorisieren, Schlagwort `testwort` vergeben, Notiz schreiben | Favoriten-Zähler +1; Suche nach `testwort` findet sie |
| AR-08 | **Doppelte finden** | Findet die Teide-Dublette und Vilaflor (03-touren ↔ Teneriffa-Woche) |
| AR-09 | Tour **kaputt-mit-absicht**: Detail → Track-Check → bei „Zeit rückwärts" **Ist so in Ordnung** | Befund verschwindet, steht grau mit „wieder anzeigen"; Kachel-Marke bleibt rot (Sprung) |
| AR-10 | **🩺 Alle Touren prüfen** | Fortschritt oben, „Abbrechen" daneben; danach gleiche Marken |
| AR-11 | Übersichtskarte (🌍) | Alle Touren als Linien; Teneriffa, Brandenburg, Harz, Schottland/Nordsee erkennbar |
| AR-12 | Statistik (📊) | Summen plausibel (km, Stunden, Anzahl) |
| AR-13 | Fortbewegungsart von **mischfall-wanderung-mit-auto** auf „Wandern" setzen | Wird gespeichert, Filter „Wandern" findet sie |
| AR-14 | Tour anklicken → rechts **Versionen** | Genau eine Version; Knöpfe ⬇ (Export nach `Ausgaben/`) funktioniert |

### FO — Fotos im Archiv (Bestand)

| ID | Aktion | Erwartet |
|---|---|---|
| FO-01 | Archiv → **Fotos** → Ordner hinzufügen `Arbeit/fotos/bestand` | Zwei Durchgänge (Dateien suchen, Aufnahmedaten lesen) mit Fortschritt |
| FO-02 📷 | Rasteransicht | Nach Tagen gegliedert; 9 Dateien; HEIC mit Vorschaubild |
| FO-03 | Kartenansicht | Punkt nur für `E_hat_schon_gps.jpg` (die anderen haben keine Koordinate, Kachel-„!") |
| FO-04 | Ansicht **Nach Touren** | Fotos vom 05.05.2023 bei „Barranco de Masca" |
| FO-05 | Suche/Filter nach Kamera „Canon" | Nur B_01 |
| FO-07 📷 | Zweiten Ordner hinzufügen: `Arbeit/fotos/echt-mit-gps` | 76 Fotos; Kartenansicht: Punktwolke entlang Barranco de Masca; Klick in die Wolke nennt die Tour |
| FO-08 | Nach Touren → Barranco de Masca | 76 echte + die synthetischen Masca-Fotos |
| FO-06 | Ordner wieder entfernen | Verschwindet aus dem Bestand; Dateien in `Arbeit/fotos/bestand` bleiben (im Finder prüfen) |

### IN — GPX-Inspektor

| ID | Aktion | Erwartet |
|---|---|---|
| IN-01 | Archiv: **kaputt-mit-absicht** → **Im Inspektor reparieren** | Inspektor mit Befund-Kasten: Sprung, Lücke (~790 m), Zeit rückwärts, 3 Höhen −600 m |
| IN-02 | Im Befund-Kasten je Befund **Zeigen** | Karte springt zur Stelle |
| IN-03 📷 | **🩹 Auto-Heilen** | Vorschau: orange Ausreißer, magenta Lücke; noch nichts geändert |
| IN-04 | **Alle heilen**, dann ⌘Z, dann ⌘⇧Z | Heilen wirkt; Rückgängig stellt her; Wiederherstellen heilt wieder |
| IN-05 | **Speichern** / Version | Neue Version im Archiv („V2"), Originaldatei in `Arbeit/archiv` unverändert (Größe/Datum im Finder) |
| IN-06 | Tour **track_teufelsmauer**: Punkt anklicken → Punkt löschen; Anker A+B → Lücke füllen | Beides wirkt, Punktzahl ändert sich |
| IN-07 | Punkt anklicken → **Alles davor abschneiden** | Track beginnt dort; ⌘Z nimmt zurück |
| IN-08 | Nach Tempo einfärben | Farbskala sichtbar, schnelle Stellen andersfarbig |
| IN-09 | **Höhe korrigieren** (Karte statt GPS) | Läuft, Höhenprofil ändert sich plausibel |
| IN-10 | **Tracks verbinden**: `zum-oeffnen/06-tagesdateien/reise-tag-1-…gpx` öffnen, Tag 2 und Tag 3 „nach Uhrzeit" anhängen | Ein Track, drei Tage; Nahtstellen-Lücke wird angezeigt, nicht überbrückt |
| IN-11 | Geplante Route **geplant-2025-10-20_Rheinstei** öffnen | Keine roten Befunde; „Zeitachse erzeugen" nur, wenn keine Zeiten da sind |
| IN-12 | `zum-oeffnen/01-formate/demo_komoot.kml` öffnen → **Zeitachse erzeugen**, Wunschtempo 4 km/h | Dauer ≈ 175,7 km / 4 km/h ≈ 44 h |

**Logbuch (im Inspektor, unten):**

| ID | Aktion | Erwartet |
|---|---|---|
| IN-20 📷 | Tour **mischfall-wanderung-mit-auto** im Inspektor | Logbuch: Pausen, Spaziergänge, Fahrten, Rad, eine Überfahrt (Zahlen in `SOLL-WERTE.md`) |
| IN-21 | Eintrag einer **Fahrt**: ⋯ → Art ändern → Wanderung; dann ⌘Z | Art wechselt; Rückgängig stellt her |
| IN-22 | ⋯ → **Im Video → überspringen** | Eintrag trägt „⤼ überspringen"; ⌘Z nimmt es zurück |
| IN-23 | ⋯ → Umbenennen `Testname` | Name steht am Eintrag |
| IN-24 | Punkt-Modus: eigenen Punkt setzen, Name `Bank` | Punkt „Bank" in der Liste und auf der Karte |
| IN-25 | Großes Logbuch-Fenster öffnen, nach Dauer sortieren, Fenster verschieben | Sortierung stimmt; Fenster bleibt nach Schließen/Öffnen an seiner Stelle |
| IN-26 | Tour **reise-5-wochen** | Tagesköpfe (38 Tage), Klick auf einen Tag zoomt; keine Hänger > 10 s |

### AN — Animator

Vorher: Tour **Wer sieht die Schildkröte 🐢** im Animator.

| ID | Aktion | Erwartet |
|---|---|---|
| AN-01 | Kartenstile durchschalten (Satellit, Gelände, kostenlos) | Vorschau wechselt ohne schwarze Flächen |
| AN-02 | 3D an/aus, Neigung, Linienfarbe/-breite | Sofort sichtbar |
| AN-03 | Dauer auf 10 s, Intro 2 s, Hold 2 s | Zeitleiste zeigt INTRO / Animation / HOLD |
| AN-04 | Keyframe setzen („Hier Keyframe") an drei Stellen, Kamera dazwischen verändern | Probe-Lauf fliegt die Kamera durch die Keyframes |
| AN-05 | Tempo-Spur: Halt einfügen | Probe-Lauf hält dort an |
| AN-06 | Jede Spur der Zeitleiste mit ▾ klein klappen und wieder auf | Klappt; bleibt nach Neustart so |
| AN-07 📷 | Overlays: Gesamt-Stats an; unter „▸ Overlays" den Balken der Box auf 3–8 s ziehen | Box erscheint im Probe-Lauf bei 3 s, ist bei 8 s ganz weg |
| AN-08 | Doppelklick auf freie Stelle der Box-Zeile → zweiter Zeitraum | Zwei Balken; Rechtsklick öffnet das Fenster mit „Zeitraum 1, 2" |
| AN-09 | Box-Fenster: Rahmen, Schatten, Einblendung „Pop" | Vorschau zeigt es |
| AN-10 | Leertaste nach Tippen in ein Zahlenfeld | Probe-Lauf startet trotzdem |
| AN-11 | Fotos auf der Karte: `Arbeit/fotos/geotagger/E_hat_schon_gps.jpg` hinzufügen | Schild/Foto an der richtigen Stelle |
| AN-12 | **📸 Aktuellen Frame als Bild** → `Ausgaben/` | PNG entspricht der Vorschau |
| AN-13 📷 | **▶ Video rendern**, 1920×1080, H.264 → `Ausgaben/` | Fortschritt mit Live-Bild; MP4 ≈ 14 s (Intro+10+Hold); im QuickTime abspielbar, Box 3–8 s |
| AN-14 | Render abbrechen (zweiter Render, nach 20 %) | Bricht sauber ab, keine halbe Datei ohne Hinweis |

**Logbuch im Video / Zahlen je Bewegungsart** (Tour **mischfall-wanderung-mit-auto**):

| ID | Aktion | Erwartet |
|---|---|---|
| AN-20 | Sektion **📖 Logbuch im Video** öffnen | Liste der Abschnitte mit Uhrzeit und km; „Alle auf einmal" oben |
| AN-21 | Alle auf einmal: Fahrt → **überspringen** | Alle Fahrten durchgestrichen; im Probe-Lauf fehlt die Linie dort, der Punkt springt |
| AN-22 | Fahrt → **blass**, dann **raffen (×8)** | Blass: Linie schwach; raffen: Linie normal, Abschnitt deutlich schneller |
| AN-23 | Gesamt-Stats ✎ → Zahlen für: **nur Fahrt** | Box zeigt nur die Fahrt-Strecke (kleiner als 175,7 km), Max-Tempo nicht höher als bei „Ganze Strecke" |
| AN-24 | Zurück auf zeigen, Box auf „Ganze Strecke" | Alles wie vorher |
| AN-25 | Eine Datei **außerhalb** des Archivs öffnen: `zum-oeffnen/01-formate/track_teide.gpx` | Sektion sagt „Das Logbuch gibt es für Touren im Archiv." |

### RE — Mehrere Touren (Reise, Schwarm, Zusammenführen)

| ID | Aktion | Erwartet |
|---|---|---|
| RE-01 | Sammlung Teneriffa → alle 5 wählen → **Als Reise** in den Animator | Etappen 1–5 in Reihenfolge, Übergänge Kinoflug |
| RE-02 📷 | Probe-Lauf | Etappe für Etappe, Flug dazwischen, keine gerade Linie zwischen Etappen |
| RE-03 | Etappe 3 Dauer 4 s, Übergang 2→3 „Schnitt" | Wirkt im Probe-Lauf |
| RE-04 | Stats-Box „laufende Etappe" | Zahlen wechseln mit der Etappe |
| RE-05 | Dieselben 5 → **🌊 Als Schwarm animieren**, Modus „Echte Uhrzeit — mit Pausen" | Alle laufen gleichzeitig; Pausen = Punkt steht |
| RE-06 | Kamera folgt: einer bestimmten Tour | Kamera begleitet sie, bleibt an ihrem Ziel |
| RE-07 | Schwarm in der Tour-Map öffnen | Alle 5 in ihren Farben, PNG enthält alle |

### RR — Reiseroute

| ID | Aktion | Erwartet |
|---|---|---|
| RR-01 | Tour **Teide Original** laden, Reiter Reiseroute | Tour als Ghost sichtbar |
| RR-02 | Stationen aus `Arbeit/reiseroute/stationen.txt` eintippen, je Enter | Karte fliegt jeweils hin; Ort steht unter dem Feld |
| RR-03 | Straße folgen, Auto, **Route berechnen** | Route Berlin → Wernigerode → Schierke; km und Fahrzeit darunter |
| RR-04 | Stationen per ⠿ umsortieren, neu berechnen | Start/Ziel wandern mit |
| RR-05 | Stil **Flugroute (Großkreis)** | Gewölbte Linie ohne Straßen |
| RR-06 | Neustart | Stationen und Route sind wieder da |

### TM — Tour-Map

| ID | Aktion | Erwartet |
|---|---|---|
| TM-01 | Tour **Vilaflor** → Tour-Map, Format Instagram 1:1 | Vorschau quadratisch |
| TM-02 | Ausrichtung 90°, Randabstand 20 %, Start/Ziel-Markierung an | Sofort sichtbar |
| TM-03 | Kartenstil OpenTopoMap | Wechselt, Quellenzeile passt dazu |
| TM-04 📷 | **Karte als PNG rendern** → `Ausgaben/` | PNG 1080×1080, gleicher Ausschnitt wie Vorschau |
| TM-05 | Im Animator „🗺 Als Tour-Map öffnen" | Tour-Map übernimmt genau den Ausschnitt |

### WK — Web-Karte

| ID | Aktion | Erwartet |
|---|---|---|
| WK-01 | Tour **Cruz del Carmen** laden, Reiter Web Karte | Track eingepasst |
| WK-02 | Zwei Beschriftungen setzen, eine verschieben, eine löschen | Liste und Karte stimmen überein |
| WK-03 | Weitere Tracks: Haifischflosse hinzufügen | Zweiter Track in eigener Farbe |
| WK-04 | DSGVO-Button an, Leaflet „In HTML einbetten" | Optionen übernommen |
| WK-05 📷 | **Als HTML exportieren** → `Ausgaben/`, dann **Im Browser öffnen** | Karte erscheint erst nach Zustimmungs-Klick; beide Tracks + Beschriftungen |

### DA — Daten-Animator

| ID | Aktion | Erwartet |
|---|---|---|
| DA-01 | `01-formate/demo_ride_sensors.tcx` öffnen, Reiter Daten-Animator | Datenreihen: Höhe, Tempo, Steigung **und** Sensorwerte (Puls …) |
| DA-02 | Datenreihe Puls, zweite Reihe Höhe | Zwei Kurven, rechte Achse in Farbe der zweiten |
| DA-03 | `01-formate/track_teide.gpx`: nur Höhe/Tempo/Steigung wählbar | Keine Sensorreihen |
| DA-04 | Punkt aufs Profil setzen, Auto-Marker an | Höchster Punkt ≈ Teide-Gipfel beschriftet |
| DA-05 📷 | Video rendern, ProRes 4444 mit Alpha → `Ausgaben/` | .mov mit transparentem Hintergrund |

### GT — Geotagger

Fotos: `Arbeit/fotos/geotagger/` (Soll je Foto in `SOLL-WERTE.md`, Abschnitt Fotos).

| ID | Aktion | Erwartet |
|---|---|---|
| GT-01 | Geotagger leeren (✕ oben, bestätigen). Steht beim Versatz eine Kamera-Zeitzone (z. B. „UTC+2“), über ✎ auf UTC±0 zurückstellen. Dann Ordner `Arbeit/fotos/geotagger/` laden, **ohne** vorher einen Track zu laden | Archiv schlägt „Barranco de Masca" vor (Bestätigungsliste mit Fotozahl) |
| GT-02 | **Tracks verwenden** | Track auf der Karte, Fotos A_ liegen darauf |
| GT-03 📷 | Kamera-Knopf **Canon** | Fotos B_ liegen daneben (Kamera-Uhr UTC+2, Tour in UTC+1); Hinweis „ohne Zeitzone" für EOS R6, Vorschlag „Aus dem Track gerechnet: UTC+2". Versatz-Anzeige oben: Wert groß, Kamera klein in der zweiten Zeile, nichts läuft unter ✎ oder ↺ |
| GT-04 | Vorschlag **Übernehmen** (oder Kamera-Zeitzone UTC+2 von Hand), zurück auf „Alle" | B_ liegen jetzt auf dem Track; A_, C_, E_, F_ haben sich nicht bewegt (sie tragen ihre Zeitzone selbst) |
| GT-05 | C_gleiche_minute_1–3 | Drei Fotos am selben Punkt, auffächerbar |
| GT-06 | D_nach_tourende | Als unsicher/ohne Position gekennzeichnet |
| GT-07 | E_hat_schon_gps | Behält seine Position |
| GT-08 | F_heic.heic und G_video.mp4 | Werden gelesen und zugeordnet |
| GT-09 | Globale Felder: Urheber `Testumgebung` | Wird für alle übernommen |
| GT-10 📷 | **GPS in Fotos schreiben** → Zielordner **`~/GPS-Studio-Test/Ausgaben/getaggt`** | Kopien dort; Fertig-Dialog: **16 verortet** und **„Nur Angaben ergänzt (ohne Position)“ 1** (D_nach_tourende, bekam den Urheber aus GT-09, aber keine Position). Originale in `Arbeit/fotos/geotagger` unverändert (`exiftool -gps:all <datei>`: leer) |
| GT-11 | Zielordner = Ordner der Originale (`Arbeit/fotos/geotagger`) | Rückfrage „Originale überschreiben?" + ZIP-Sicherung; bestätigen ist hier erlaubt (Testkopien) |
| GT-12 | Schutzprobe: im Terminal `"/Volumes/MacMini 2TB Acasis/Claude-Masterblaster/Reisezoom-GPS-Studio/scripts/testumgebung.sh" schutzprobe` (legt `/tmp/rz-schutzprobe/A_01.jpg` an — das Skript darf das, du legst selbst nichts an). In der App diesen Ordner laden, **Zielordner = derselbe**, „Originale überschreiben“ bestätigen | Schreiben wird **verweigert** (Meldung mit „Dateischutz … testrechner“) — das ist Soll; `exiftool -gps:all /tmp/rz-schutzprobe/A_01.jpg` bleibt leer |

**Echte Fotos** (`Arbeit/fotos/echt-ohne-gps/`, 76 Stück; Soll in `SOLL-WERTE.md`, Abschnitt „Echte Fotos"):

| ID | Aktion | Erwartet |
|---|---|---|
| GT-20 | Geotagger leeren (✕), Ordner `echt-ohne-gps` laden | Archiv schlägt „Barranco de Masca" vor; 76 Fotos, zwei Kameras (Canon PowerShot G5 X Mark II, Pixel 6 Pro) |
| GT-21 📷 | Tracks verwenden, Karte und den Hinweis-Kasten unter dem Versatz ansehen | Die 3 Pixel-Fotos liegen am Weg. Für die Canon erscheint **⚠️ „Canon PowerShot G5 X Mark II: Die Zeitzone im Foto passt nicht zum Track — mit +1 h liegen 73 statt 58 von 73 Fotos im Track“** mit Knopf „Übernehmen“ (Zahlen dürfen leicht abweichen) |
| GT-22 | Im Hinweis **Übernehmen** klicken | Canon-Versatz +1 h (Kamera-Knopf Canon zeigt es), Canon-Fotos rücken auf den Weg, der Hinweis verschwindet; Pixel-Fotos bleiben, wo sie waren |
| GT-23 | Gegenprobe: Kamera-Knopf **Pixel 6 Pro** und **Alle** ansehen | Für das Pixel kommt **kein** Zeitzonen-Hinweis (seine Zone stimmt) |
| GT-24 | Ein Foto anklicken, dann **🔍 Auto-Tag (Bilderkennung)** | Rückfrage „Bilderkennung starten?“ mit Anzahl (76) und Dauer, Knöpfe „Nur dieses Foto“, „Abbrechen“, „76 Fotos erkennen“. **Nur dieses Foto** wählen → genau 1 Foto verschlagwortet (sinnvolle Wörter: Schlucht, Berg, Meer …). Danach noch einmal und **Abbrechen** → es startet nichts |
| GT-25 📷 | GPS in Fotos schreiben → Zielordner `~/GPS-Studio-Test/Ausgaben/getaggt-echt` | 76 Kopien mit GPS |
| GT-26 | Im Terminal: `.venv/bin/python scripts/testumgebung_fotovergleich.py ~/GPS-Studio-Test/Ausgaben/getaggt-echt` | Beide Kameras ✅, Median < 50 m (Rechenkern-Messung: Canon 17 m, Pixel 31 m) |

### PR — Projekte, Vorlagen, Tour-Assistent

| ID | Aktion | Erwartet |
|---|---|---|
| PR-01 | Tour öffnen, Änderung im Animator → Projekt entsteht automatisch | Archiv → Projekte zeigt es mit Kachel des letzten Stands |
| PR-02 | Projekte-Menü: Neues Projekt, Duplizieren, Umbenennen | Alles in der Liste, aktives markiert |
| PR-03 | **Als Vorlage speichern** `Test-Look`; andere Tour → **Vorlage anwenden** | Look übernommen, Track bleibt der neue |
| PR-04 | **Projekt exportieren (.rzproj)** → `Ausgaben/` | Datei entsteht |
| PR-05 | Projekt löschen, dann **Projekt importieren** aus `Ausgaben/` | Projekt ist wieder da, samt Keyframes |
| PR-06 | Tour-Assistent (Menü) mit einer Teneriffa-Tour | Führt bis zum fertigen Projekt |
| PR-07 | **Session schließen** | Leerer Animator, Projekt unverändert in der Liste |

### AL — Allgemeines

| ID | Aktion | Erwartet |
|---|---|---|
| AL-01 | Alle Dateien aus `01-formate` nacheinander per Drag & Drop öffnen | Jede lädt; Werte ≈ `SOLL-WERTE.md` |
| AL-02 | Frage „Soll die Tour ins Archiv?" beim Öffnen einer Datei von außerhalb | Erscheint; „Nein" lässt das Archiv unverändert |
| AL-03 | Menü **Als GPX / CSV / KML / GeoJSON exportieren** → `Ausgaben/` | Dateien entstehen, GPX lässt sich wieder öffnen |
| AL-04 | Undo/Redo über mehrere Module | Jeder Schritt einzeln rückgängig |
| AL-05 | Fenster klein ziehen (1280×720) und groß | Nichts überlappt, Seitenleisten scrollen |
| AL-06 | Hilfe-Menü: jede Seite einmal öffnen | Alles lesbar, Links öffnen den System-Browser |
| AL-07 | Über-Dialog | Version 0.9.724, Credits mit Lizenzen (FFmpeg, MapLibre …) |
| AL-08 | Feedback-Dialog öffnen, **Abbrechen** | Öffnet, nichts wird gesendet |

### FE — Fehlerfälle

| ID | Aktion | Erwartet |
|---|---|---|
| FE-01 | `02-fehlerfaelle/leer.gpx` öffnen | Verständliche Meldung („keine Trackpunkte"), App bleibt bedienbar |
| FE-02 | `ein-punkt.gpx` | Meldung zu wenige Punkte oder sinnvolle Anzeige, kein Absturz |
| FE-03 | `kein-track.json`, `kein-gpx.txt` | Werden abgelehnt mit Erklärung |
| FE-04 | `abgeschnitten.gpx` | „beschädigt, reparierbar" bzw. Reparaturangebot |
| FE-05 | Während eines Renders App beenden (⌘Q) | Rückfrage oder sauberer Abbruch; nach Neustart kein Hänger |
| FE-06 | Ohne Internet (WLAN aus — **nur wenn Marc es erlaubt**) | Kostenlose Karte zeigt Hinweis; Archiv/Inspektor gehen |

### CL — Test-Cloud (nur wenn eingerichtet)

Die Test-App ist mit der **Test-Cloud** `https://reisezoom.com/rz-cloud-testrechner/rz-cloud.php` verbunden
(Zugang als Datei im Test-App-Ordner, bleibt beim Zurücksetzen erhalten; Adresse auch in
`~/GPS-Studio-Test/TEST-CLOUD.txt`). Fehlt die Datei: Block ⏭. Passwort und Zugangsschlüssel
liegen nur bei Marc/Claude — du tippst nichts davon ein und trennst die Cloud nicht.

| ID | Aktion | Erwartet |
|---|---|---|
| CL-01 | ⚙ → Bibliothek & Cloud: Status | Zeigt `…/rz-cloud-testrechner/…`, **niemals** `reisezoom.com/rz-cloud/` (sonst sofort aufhören) |
| CL-02 | Tour ändern (Schlagwort), 2 min warten | Auto-Abgleich lädt hoch (☁-Anzeige) |
| CL-03 | Cloud-Übersicht | Anzahl oben ≈ Anzahl im Archiv |

---

## Teil D — Berichtsvorlage

```markdown
# Testbericht GPS Studio 0.9.724 — <Datum Uhrzeit>

Tester: <Chat-Bezeichnung> · Umgebung: vorbefuellt/leer · Dauer: <h>

## Zusammenfassung
- bestanden: n · gescheitert: n · auffällig: n · übersprungen: n
- Die drei wichtigsten Befunde: …

## Ergebnisse
| ID | Ergebnis | Beobachtung (bei ❌/⚠️: Schritte zum Nachstellen) | Screenshot |
|---|---|---|---|
| S-01 | ✅ | | S-01.png |

## Log-Auszüge
<je gescheitertem Schritt die letzten 40 Zeilen aus App-Ordner/logs/app.log>
```

---

## Pflege

- Neue Funktion → neue Zeile im passenden Block (ID fortlaufend, nie umnummerieren).
- Testdaten ändern: `scripts/testdaten_bauen.py` anpassen, dann
  `.venv/bin/python scripts/testdaten_bauen.py --neu`; Soll-Werte entstehen neu.
- Testrechner-Sperre und eigener App-Ordner: `core/dateischutz.py` (Abschnitt
  Testrechner), `app.py` (`RZ_APP_ORDNER`), Test `tests/test_testrechner.py`.
