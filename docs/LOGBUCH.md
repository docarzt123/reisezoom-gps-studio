# Logbuch der Tour — Plan und Stand (IDEAS §68)

> **Diese Datei ist die Wahrheit für das Logbuch.** Wer daran weiterbaut, liest sie zuerst
> und trägt jede neue Entscheidung hier ein (mit Datum und Grund). Entschieden mit Marc am
> 13.09.2026 in einer Grilling-Runde (Q1–Q21). Stand beim Schreiben: **nichts gebaut**,
> Stufe 1 ist der nächste Schritt.

## 1. Worum es geht

Marc: „wie wäre es, wenn der inspector eine art logbuch generiert, was wo war — zeit von bis:
fähre von bis, pause, fahrt von nach, spaziergang/wanderung usw. … höchster punkt … statt im
animator pois zu finden, machen wir das im inspector. wenn man einen eintrag anklickt, wird der
bereich des tracks hervorgehoben. man muss natürlich alles ändern können." — und: „als zeitstrahl
darstellen ist fast noch besser oder wir machen beides."

Das Logbuch erzählt eine Tour als Folge von Einträgen: Bereiche mit Zeit von–bis (Fahrt von–nach,
Fähre, Wanderung, Pause …) und Punkte (höchster Punkt, Start/Ziel, POIs). Zwei Ansichten auf
dieselben Daten: **Zeitstrahl** und **Liste**. Alles ist von Hand änderbar, mit ⌘Z.

**Zweck in dieser Reihenfolge (Q1):** (a) verstehen, was wann war · (b) Werkzeug zum Korrigieren
und Markieren · (c) Grundlage für Animator/Tour-Map/Video · (d) Reisetagebuch (IDEAS §69, später).

## 2. Was schon da ist (Grundlage aus IDEAS §67, Schritte 1–4, v0.9.702)

| Baustein | Datei | Was er liefert |
|---|---|---|
| Bewegungserkennung | `core/bewegung.py` — `erkennen(points, aktivitaet=…)`, `zusammenfassung()` | Bereiche `gehen/laufen/rad/fahrt/faehre/halt/pause/unsicher` mit Zeiten; Halte ≥ 3 min in 40 m; Pausen = Zeit, die der Weg nicht erklärt; benannte Halte aus Wegpunkten der Aufzeichnungs-App (`app_halte`) |
| Einteilungen | `core/einteilung.py`, Tabelle `einteilungen` in `library.db` | Je Tour mehrere Einteilungen (Tage, Bewegung, eigene) als Markierung **nach Uhrzeit** über dem unveränderten Track; Herkunft `auto/app/hand`; Handarbeit überlebt `neu_berechnen`; Aktionen `bereich_setzen/aendern/teilen/zusammenlegen/grenze_setzen/bereich_entfernen`; `stand()/stand_setzen()` für ⌘Z |
| Brücken | `app.py` — `einteilung_lesen/berechnen/aktion/eigen_anlegen/entfernen/stand_setzen` | Jede Aktion liefert den Stand davor (Undo) |
| Track-Check je Bewegungsart | `core/trackcheck.py`, `gpxinspect_track_check`, `gpxinspect_luecken` | Befunde ohne Fehlalarme; Lücken nach fehlender Bewegungszeit |
| Highlight-Suche (POIs) | Animator: `highlights_vorschlaege` (Brücke), Highlights-Fenster | OSM-Orte, Halte mit Fotos, Fotoserien — wird für die POIs in den Inspektor geholt |
| Geocoder | `core/geocode.py` (Photon, kostenlos) | Ortsnamen |
| Zeitleisten-Komponente | `ui/js/timeline.js` (Animator) | Muster für Spuren, Zoom, Ziehen |
| Prüfsammlung | `tests/pruefsammlung/` (+ `stand.json`, Ratsche), `tests/test_bewegung.py`, `tests/test_einteilung.py` | Erwartete Ergebnisse je Track-Art |

## 3. Entscheidungen (Q1–Q21, 13.09.2026)

**Daten**
- **Q2** Das Logbuch **ist** die Einteilung „Bewegung" (`core/einteilung.py`), ergänzt um
  **Punkt-Einträge**. Keine zweite Liste daneben.
- **Q4** Entsteht **automatisch beim Öffnen im Inspektor** (lokal, ohne Netz). Netzabhängiges
  (Ortsnamen, POIs) läuft danach im Hintergrund (Kasten unten rechts), abschaltbar.
- **Q5** Es gibt **keinen „Halt"** im Logbuch. Stillstand **ab 10 min wird Pause** (umbenennbar —
  intern bleibt die Art `pause`). Kürzeres geht im umgebenden Abschnitt auf. Schalter „alles zeigen";
  die Rohdaten der Erkennung bleiben.
- **Q7** „Gehen" bekommt einen Anzeigenamen: **Aktivität der Tour hat Vorrang**, sonst nach Länge /
  Höhenmetern **Wanderung** oder **Spaziergang**. Intern bleibt `gehen`. Schwellen einstellbar.
  Später evtl. aus freigegebenen Nutzerdaten lernen (§67 Q19).
- **Q8** `unsicher` wird dem passenden Nachbarn zugeschlagen; geht das nicht, eigener grauer
  Eintrag „Rad oder Laufen?" mit Auswahl.
- **Q9** Punkte, **in dieser Reihenfolge** bauen: höchster Punkt je Tag → Start/Ziel je Tag → POIs.
  Später Fotos (aus dem Foto-Bestand). Keine Grenzübertritte, keine tiefsten Punkte.
- **Q10** Ortsnamen: erst Namen aus der Aufzeichnungs-App, sonst Geocoder im Hintergrund,
  ohne Netz später nachgetragen. **Einstellbar** (an/aus). Grob „Ort, Gemeinde".
- **Q11** POIs: im Logbuch nur **in Pausen-Nähe + wichtige Orte am Weg** (Gipfel, große
  Sehenswürdigkeiten); zusätzlich eine **ausblendbare POI-Spur** im Zeitstrahl mit steuerbarer Menge;
  Klick übernimmt einen POI ins Logbuch.

**Oberfläche**
- **Q6** **Zeitstrahl unten** über die ganze Breite; **rechts daneben ein mitscrollendes Logbuch**;
  ein Knopf klappt es als **großes, verschiebbares Fenster** auf. Die Seitenleiste des Inspektors
  bekommt nichts dazu (ist schon zu voll).
- **Q3/Q14** Gliederung nach Tagen **nur bei mehrtägigen Touren**, sonst flache Liste.
- **Q15** Spuren von oben: **Tage** · **Bewegung** (farbige Bereiche = Logbuch, Höhenprofil als
  Hintergrund) · **Punkte** · **POIs** (ausblendbar) · **Eigene** (ausblendbar) · **Befunde** (Q18).
  Zoom ganze Reise → Tag per Doppelklick. Farben: Fahrt blau, Fähre türkis, Gehen grün, Rad orange,
  Laufen gelb, Pause grau, unsicher gestreift.
- **Q16** Kopplung: Klick auf Eintrag (Liste oder Zeitstrahl) → Bereich leuchtet auf der Karte,
  Karte zoomt hin · Klick auf den Track → Eintrag ausgewählt, Liste und Zeitstrahl springen hin ·
  Hover über dem Track → nur Markierung im Zeitstrahl, kein Sprung · Esc hebt auf.
- **Q17** Großes Fenster: mehr Platz, **Tabelle** (Dauer, km, Höhenmeter, Tempo) mit Sortieren,
  **Mehrfachauswahl** für Sammelaktionen, voll editierbar.
- **Q14** Eigene Einteilungen (z. B. „mit den Kindern") als **eigene Spur**, standardmäßig aus.

**Bearbeiten und Einstellungen**
- **Q12** Umbenennen · Art ändern · Grenzen im Zeitstrahl ziehen · teilen · zusammenlegen ·
  löschen (geht im Nachbarn auf) · eigenen Bereich anlegen (A/B auf dem Track) · eigenen Punkt setzen
  (Kartenklick) · Notiz je Eintrag. **Alles mit ⌘Z**; Handarbeit überlebt jede Neuberechnung.
- **Q13** Einstellungen **global als Standard, je Tour überschreibbar** (⚙ im Logbuch mit
  „als Standard für alle übernehmen").

**Rundherum**
- **Q18** Track-Check-Befunde als **eigene Spur „Befunde"** mit Sprung zur Reparatur. Eine als Pause
  erkannte Lücke ist kein Befund.
- **Q19** POI-Suche wandert **ganz in den Inspektor**. Der Animator übernimmt Einträge/POIs als
  Schilder und stimmt nur noch **Pausen und Bilder** ab. Anzeige je Eintrag (zeigen / blass / raffen /
  überspringen, §67 Q11) hängt am Logbuch-Eintrag.
- **Q20** **Kurzfassung im Archiv-Detail** („5 h Fahrt · 1 Fähre · 2 Wanderungen · höchster Punkt
  1.240 m"). Suche/Filter nach Arten und Reisetagebuch später (§69).

**Annahmen (nicht gefragt, bei Zweifel Marc fragen)**
- App zuerst, Web später.
- Ein Logbuch je Tour; Reisen aus mehreren Dateien (Mengen) später.
- Das Logbuch ersetzt „Schritt 5 — Inspektor-Leiste" aus §67.
- Punkt-Einträge liegen in derselben Einteilung wie die Bereiche (Bereich mit t0 = t1 plus eigene
  Koordinate für POIs neben dem Track) — technische Entscheidung, bei Bedarf hier ändern.

## 4. Stufen (Q21)

Jede Stufe für sich fertig: Code → kopflose Wächter (WebKit + echte Brücke, wo es geht) →
CHANGELOG (md + html ×3) → USER_GUIDE ×3 / DEVELOPER → Build → Commit/Push.
**Nach Stufe 1 schaut Marc in der echten App, bevor Stufe 2 beginnt.**

### Stufe 1 — Logbuch erzeugen, zeigen, koppeln
- Aus `bewegung.erkennen` + Einteilung „Bewegung": Pausen ≥ 10 min, kein Halt, `unsicher` nach Q8,
  Anzeigenamen Wanderung/Spaziergang nach Q7, höchster Punkt je Tag, Start/Ziel je Tag.
- Zeitstrahl unten im Inspektor (Spuren Tage, Bewegung mit Höhenprofil, Punkte), Zoom Reise → Tag.
- Mitscrollendes Logbuch rechts neben dem Zeitstrahl; Tagesgliederung nur bei mehrtägigen Touren.
- Kopplung nach Q16 (Klick Eintrag ↔ Karte ↔ Track, Hover, Esc).
- Wächter: erzeugte Einträge an der Prüfsammlung (Womo-Reise mit Fähren, Wanderung, Lauf mit
  Zugfahrt), Kopplung im WebKit-Prüfstand, i18n DE/EN/ES.

### Stufe 2 — Bearbeiten + Einstellungen
- Alle Handgriffe aus Q12 in Liste und Zeitstrahl, ⌘Z für jeden Schritt (`stand_setzen`).
- ⚙ je Tour + globale Standards (Q13): Pausen-Mindestdauer, Wanderung-Schwellen, Ortsnamen an/aus,
  POI-Menge.

### Stufe 3 — Ortsnamen, POIs, großes Fenster
- Ortsnamen im Hintergrund (App-Namen → Geocoder → später nachtragen).
- POIs nach Q11 (Highlight-Suche aus dem Animator in den Inspektor holen), POI-Spur.
- Großes verschiebbares Fenster mit Tabelle, Sortieren, Mehrfachauswahl (Q17).

### Stufe 4 — Befunde, Eigene, Archiv
- Befunde-Spur (Q18), Eigene-Spur (Q14), Kurzfassung im Archiv-Detail (Q20).

### Danach (nicht Teil dieses Plans)
- Animator liest das Logbuch (Q19), Reisetagebuch + Suche nach Arten (§69).

## 5. Regeln, die hier besonders gelten
- **Undo für alles**, Handarbeit überlebt Neuberechnung.
- **Keine Fehlalarme**: lieber ehrlich „unsicher" als falsch.
- **Warte-Fenster** für jeden Weg, auf den man wartet (`rzWarten` / `rzStatus`), Hintergrundarbeit
  im Kasten unten rechts.
- **Alles ohne Cloud und ohne Mapbox** nutzbar; Netz nur für Ortsnamen/POIs, abschaltbar.
- **Dreisprachig** (DE/EN/ES) von Anfang an; Datumsformate über `rzSprachCode()`.
- **Nur kopflos testen**, außer Marc lädt ausdrücklich an den Rechner ein.
- Keine Tester-Namen im Repo.

## 6. Änderungsprotokoll
- 13.09.2026 — Plan angelegt (Grilling Q1–Q21). Nichts gebaut.
