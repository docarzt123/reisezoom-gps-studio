# Track-Check — Spezifikation (Stand 10.09.2026, mit Marc durchgesprochen)

Ergebnis einer Grilling-Runde am 10.09.2026. Dieses Dokument ist die Wahrheit für den
Bau; wer hier weiterbaut, braucht den Chat nicht. Version: kommt in 0.9.688 (noch nicht
getaggt). Kern zuerst in `core/`, damit das Web ihn später übernehmen kann (Web: später).

## 1. Zweck

Die App sagt dem Nutzer, was an einem Track nicht stimmt, **bevor** er es im Video sieht,
und bietet mit einem Klick die Reparatur an. Drei Orte:

| Ort | Was er zeigt | Aktion |
|---|---|---|
| **Archiv, Kachel** | Warnschild oben links in der Marken-Reihe (neben ★, V2, 2×): rot oder gelb | Klick öffnet die Detailspalte |
| **Archiv, Detailspalte** | Zeile „Track-Check: 3 Sprünge, 1 Lücke“ + Knöpfe | „Im Inspektor reparieren“, „Prüfen“ (neu rechnen), je Befund „Ist so in Ordnung“ |
| **Inspektor, beim Öffnen** | Befund-Kasten ganz oben (ersetzt die heutige versteckte Analyse-Box) | Häkchen je Befund (vorbelegt), „Reparieren“, Vorher/Nachher, Speichern wie heute |
| **Animator, beim Laden** | Toast „Track-Check: 3 Sprünge, 1 Lücke. Im Inspektor reparieren“ | Knopf springt in den Inspektor; einmal je Tour und Sitzung, auch bei stummen Ladewegen |

Projekte bekommen **keinen** eigenen Hinweis (die Kachel zeigt die neueste Version; ein
Projekt auf einer alten Version bekommt schon heute „neuere Version“).

## 2. Die Befunde

Nur, was die App **reparieren** kann. Jede Zeile hat einen Reparaturschritt; die Liste
wächst mit neuen Schritten. Schwellen = „Heilen (automatisch)“ bei Empfindlichkeit **5**
(fest, kein zweiter Regler), damit Befund und Reparatur dasselbe sehen und der Befund
nach der Reparatur verschwindet.

| Stufe | Schlüssel | Befund (Wortlaut) | Erkennung | Reparatur | Danach |
|---|---|---|---|---|---|
| 🔴 | `spikes` | „{n} Sprünge“ | Sprung raus und zurück, Tempo weit über dem üblichen (heutige `detectSpikes`, Stufe 5) | Punkte auf die direkte Linie legen, Zeit bleibt | Linie ohne Zacken, Strecke minimal kürzer |
| 🔴 | `cold_start` | „Kaltstart-Ausreißer am Anfang“ | Erste Punkte liegen > 500 m und > 20× Median-Abstand neben dem Rest | Diese Punkte verwerfen | Start dort, wo der Fix stand |
| 🔴 | `ele_garbage` | „Höhen-Müll ({n} Werte)“ | Höhe < −500 m, > 9000 m, 0 m mitten in echten Werten, Sprung > 300 m zwischen Nachbarn | Werte durch Interpolation ersetzen; Vorschlag „Höhe aus Karte“ | Höhenprofil ohne Nadeln |
| 🔴 | `xml_broken` | „Datei beschädigt, reparierbar“ | Datei liest sich nicht, aber: abgeschnitten (letzter Punkt halb), unmaskiertes „&“/„<“ in Text, fehlende/falsche Kopfzeile | Letzten halben Punkt entfernen, Tags schließen, Zeichen maskieren, Kopf ergänzen; Ergebnis als neue Version | Datei lädt; heute steht dort „nicht lesbar“ |
| 🟡 | `gaps` | „{n} Lücken (größte {m} m)“ | **Räumlicher** Sprung ohne Punkte dazwischen (heutige `detectGaps`, Stufe 5). NICHT: Zeitpause am selben Ort (Wirtshaus), NICHT: Nachtpause > 2 h **und** viele km (Mehrtagestour, dort zieht die App bewusst keine Linie) | Punkte einfügen (Luftlinie, Abstand wie heute 20 m; wahlweise Wege-Profil) | Durchgehende Linie |
| 🟡 | `missing_ele` | „Höhe fehlt ({n} Punkte)“ | `ele` fehlt | Linear zwischen bekannten; Vorschlag „Höhe aus Karte“ | Profil vollständig |
| 🟡 | `tempo` | „Unmögliches Tempo ({n} Stellen)“ | Tempo über Schwelle bei dauerhaftem Versatz (heutiges `tempoEntzerren`) | Zeitstempel dort entzerren, Strecke bleibt | Ruhige Geschwindigkeit, Tour ein paar Sekunden länger |
| 🟡 | `backwards` | „Zeit läuft rückwärts ({n})“ | t[i] ≤ t[i−1] | Auf Vorgänger + 1 ms | Zeit monoton |
| 🟡 | `duplicates` | „{n} Doppelpunkte“ | Gleiche Position und gleiche Zeit | Entfernen | — |
| 🟡 | `spread_seconds` | „{n} Punkte mit gleicher Sekunde“ (der Insta360-X5-Fall, 10 Hz) | Gruppen identischer Ganzsekunden | Gleichmäßig über die Sekunde verteilen | Laufpunkt ruckelt nicht |
| 🟡 | `standstill` | „Standdrift ({n} Stellen, {min} min)“ | Minutenlang Zickzack bei Ø-Tempo ≈ 0 (Wirtshaus) | Punkte auf einen Ort zusammenziehen, Zeit bleibt (Pause bleibt Pause) | Kein zitternder Knäuel |
| 🟡 | `clock_off` | „Uhr steht falsch (Datum {jahr})“ | Datum vor 2000 oder in der Zukunft (Garmin-Bug) | Kein Automatismus: Sprung zu „Zeiten setzen“ im Inspektor | Nutzer setzt Startzeit |
| ⚪ | `no_time` | „Ohne Zeitstempel (geplante Route)“ | Keine `<time>` | „Zeitachse erzeugen“ (Ø-Tempo) | Nur im Inspektor, keine Kachel-Marke |
| ⚪ | `local_time` | „Zeiten ohne Zeitzone, als UTC übernommen“ | `<time>` ohne Z/Offset | Keine (Hinweis für den Geotagger) | Nur im Inspektor |

Nicht aufgenommen (bewusst): Privatzone am Start (eigene Funktion), lat/lon vertauscht,
Fix-Qualität aus hdop, Duplikat-Aktivität, Zeitpausen am selben Ort.

**Stufen:** Rot = sieht man im fertigen Video. Gelb = verschlechtert das Bild oder die
Daten. Grau = Information, kein Fehler. Kachel-Marke zeigt die höchste Stufe (rot vor
gelb), Grau nie auf der Kachel.

## 3. Bedienung

- **Abwählen:** Im Befund-Kasten (Inspektor) hat jede Zeile ein Häkchen; vorbelegt sind
  Rot und Gelb, Grau nicht. „Reparieren“ führt nur die angehakten Schritte aus. Danach
  Vorher/Nachher wie heute, Rückgängig geht.
- **„Ist so in Ordnung“:** je Tour **und** Befund-Art, in Detailspalte und Befund-Kasten.
  Gespeichert in der Bibliothek (`track_check_ok`, Liste der Schlüssel je geo_hash). Eine
  abgewählte Art erscheint nicht mehr, weder Kachel noch Toast; im Befund-Kasten steht sie
  grau mit „wieder anzeigen“. Eine neue Version wird frisch geprüft (eigener geo_hash).
- **Wann geprüft wird:** beim Import ins Archiv (Datei liegt dort sowieso im Speicher),
  beim Öffnen im Inspektor (auch Dateien außerhalb des Archivs, dann ohne Speichern), im
  Archiv auf Knopfdruck je Tour („Prüfen“) und „Alle prüfen“ (ganzes Archiv, Fortschritt
  im Kopf „Prüfe 120 von 830“, abbrechbar). **Nichts läuft ungefragt im Hintergrund.**
- **Nach dem Update:** einmal die Frage „Track-Check: Bestand jetzt prüfen? (etwa eine
  Minute für 1000 Touren)“ mit „Jetzt prüfen“ / „Später“. Bei „Später“ nie wieder fragen,
  aber sagen: „Du findest es im Archiv unter ⋯ → Alle Touren prüfen“.
- Gemessen 10.09.: Einlesen 12 ms + Analyse 2 ms je Tour; mit Sprung/Lücken-Suche im
  Kern ca. 30–40 s für 1000 Tagestouren.

## 4. Technik (Bauplan)

- `core/trackcheck.py` (neu): `pruefen(points, *, stufe=5) -> {"befunde": [{"key","stufe","n","detail"}], "hoechste": "rot|gelb|grau|"}`. Reine Zählung, kein Heil-Lauf (die heutige `gpxheal.analysieren` rechnet die Heilung mit — zu teuer für den Bestand). Sprung- und Lücken-Suche aus `modules/gpxinspect/ui/module.js` (`detectSpikes` :1632, `detectGaps` :1710, `tempoEntzerren` :740) nach Python portieren, Schwellen identisch (Stufe 5). Neu: `cold_start`, `ele_garbage`, `standstill`, `clock_off`, `local_time`.
- `core/gpxheal.py`: Schritte `spikes`, `cold_start`, `ele_garbage`, `standstill` ergänzen (heute nur im Browser); `SCHRITTE`-Reihenfolge festlegen.
- `core/gpxrepair.py` (neu): XML-Reparatur (abgeschnitten, `&`/`<` maskieren, Kopfzeile). Ergebnis als neue Datei/Version; Archiv-Fehlerart `broken_repairable`.
- Bibliothek (`core/library.py`): Spalten `check_json TEXT`, `check_stufe TEXT`, `check_ts`, `check_ok TEXT` (abgewählte Schlüssel). Prüfung in `_row_from_file()` (Punkte liegen dort vor) beim Import; Bestand nicht automatisch (siehe Frage nach dem Update). Brücken: `library_track_check(path)`, `library_track_check_alle()` (Thread, Fortschritt, Abbruch), `library_track_check_ok(geo_hash, key, ok)`.
- Archiv-UI: Marke in `badges(it)` (`modules/library/ui/module.js` :1364, Reihe links oben), Detailspalte-Zeile mit Knöpfen, Kopfzeile Fortschritt, Menüpunkt „Alle Touren prüfen“, Frage nach dem Update (Flag `track_check_gefragt` in settings).
- Inspektor: Befund-Kasten ersetzt `#gpxi-heal-analysis`; Häkchen = Schritte; „Reparieren“ = heutiges `runHeal` + `healTimesAndData` mit den gewählten Schlüsseln; Schwellen fix 5, Regler bleibt für Feinarbeit.
- Animator: in `ui/js/gpx-bar.js` `loadGlobalGpx` (auch `stumm`) einmal je Tour und Sitzung Toast mit Knopf → `window.loadGlobalGpx(path,{stumm:true}); switchMod("gpxinspect")` (Muster `openIn` im Archiv).
- Wächter: `tests/test_trackcheck.py` (Kern: jede Befund-Art mit synthetischem Track, Wirtshaus-Pause und Nachtpause werden NICHT gemeldet, Reparatur lässt Befund verschwinden), Mock-UI (Kachel-Marke, Befund-Kasten, Abwahl, „Ist so in Ordnung“, Toast einmalig). i18n de/en/es, Doku USER_GUIDE ×3, CHANGELOG md/html ×3, DEVELOPER.
- Echt-Test: Marcs Archiv „Alle prüfen“, ein X5-10-Hz-Track, ein Track mit Lücke, eine abgeschnittene Datei.

## 5. Offen / Reihenfolge

1. Kern + Wächter (halber Tag). 2. Archiv (Spalten, Marke, Detailspalte, Alle prüfen, Frage
nach Update). 3. Inspektor-Kasten. 4. Animator-Toast. 5. XML-Reparatur. 6. Doku, Build,
Echt-Test, Commit. Web-Übernahme später, eigener Schritt.

## 6. Stand der Umsetzung (10.09.2026 abends, v0.9.688 lokal)

Gebaut und mit Wächtern abgedeckt: Kern (`core/trackcheck.py`, 13 Punkt-Befunde), Heil-Schritte
(`core/gpxheal.py`), Archiv (Spalten, Kachel-Marke, Detailspalte, „Alle Touren prüfen", Frage nach
dem Update, „Ist so in Ordnung"), Inspektor-Befund-Kasten mit Häkchen und „Reparieren", Lade-Hinweis
mit Knopf, XML-Reparatur (`core/gpxrepair.py`, Fehlerliste „beschädigt, reparierbar"). Web später.

**Abweichungen von §2–§4, beim Bauen entschieden (an Marcs Archiv gemessen, 726 Touren):**

| Punkt | Spezifikation | Umgesetzt | Warum |
|---|---|---|---|
| Ort von „Alle prüfen" | ⋯-Menü | Knopf **„🩺 Alle Touren prüfen" links unten** neben „Doppelte finden" | Das Archiv hat kein ⋯-Menü; der Hinweis bei „Später" nennt diesen Ort |
| Lücken | detectGaps Stufe 5 (≈ 42 m) | zusätzlich **≥ 100 m**, nie bei **Pause ≥ 2 min mit ≤ 100 m Versatz** (Wirtshaus), nur bei Tracks **mit Zeit** | ab 42 m trugen 186 von 413 aufgezeichneten Touren die Marke, ab 100 m sind es 86; die Reparatur füllt genau diese, der Befund verschwindet. Geplante Routen ohne Zeit haben naturgemäß weite Abstände |
| Geplante Routen | nicht erwähnt | Aufzeichnungs-Befunde (Sprünge, Lücken, Tempo, Standdrift, Doppelpunkte, Sekunden, Zeit rückwärts, Uhr) **entfallen bei geplanten Routen**; Höhe/Zeit-Hinweise bleiben | Komoot-Planungen tragen Kunst-Zeiten: 303 von 313 geplanten Touren hätten „Lücken" gemeldet |
| Höhe fehlt | `ele` fehlt | nur wenn **teilweise** fehlt (bekannte Werte da) | ganz ohne Höhe gibt es nichts zu interpolieren, der Befund bliebe stehen |
| Standdrift | eigener Befund | wird **vor** den Sprüngen bestimmt, das Gezitter im Knäuel zählt nicht als Sprung | sonst meldete jede Pause zusätzlich Sprünge |
| Tempo | tempoEntzerren | Sprung-Gruppen werden eingeteilt: **raus und zurück = Sprung**, **dauerhafter Versatz = Tempo** | derselbe Punkt darf nicht doppelt zählen; die Reparatur ist eine andere (Position vs. Zeit) |
| Standdrift-Reparatur | Punkte auf einen Ort | plus **Rampe** zum nächsten Punkt im üblichen Tempo | sonst entstünde am Ende der Pause ein neuer Sprung |

**Gemessen (Marcs Archiv, 10.09.2026):** 726 Touren in 19–21 s (≈ 30 s je 1000). Marken: 16 rot,
146 gelb, 564 ohne. Arten: Lücken 86, Tempo 57, Standdrift 37, Sprünge 16, Doppelpunkte 8,
gleiche Sekunden 1. Ohne die Regeln oben: 515 gelb.

**Offen:** Echt-Test in der App (Marcs Archiv „Alle prüfen", X5-10-Hz-Track, Track mit Lücke,
abgeschnittene Datei) — nur mit Marcs Freigabe für den Rechner. Web-Übernahme.
