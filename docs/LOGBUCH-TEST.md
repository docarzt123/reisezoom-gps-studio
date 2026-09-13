# Testauftrag: Logbuch der Tour (Stufe 1–4) und die Arbeit vom 13./14.09.2026

> Für einen eigenen Test-Chat. Ziel: **alles anschauen, was seit v0.9.703 entstanden ist**, Fehler
> finden, fixen, nachtesten — und am Ende einen ehrlichen Bericht schreiben. Wahrheit über das
> Logbuch ist `docs/LOGBUCH.md`; die Technik steht in `docs/DEVELOPER.md` („Logbuch der Tour",
> „Datei-Dialoge merken sich ihren Ordner", „Einteilungen einer Tour"); die Nutzersicht in
> `docs/USER_GUIDE.md` Abschnitt 7 („Das Logbuch der Tour"). Stand: v0.9.711, `main` 8b1f503.

## 0. Regeln (gelten unverändert)

- **Nur kopflos testen.** Den Rechner nicht übernehmen, keine echte App steuern, keine Screenshots
  des Bildschirms. Kopflos = Playwright **WebKit** (wie pywebview auf dem Mac) mit der **echten
  Brücke** (`app.Api` über `page.expose_function("rzBridge", …)`), eigene Testbibliothek in einem
  Temp-Ordner. Muster: `tests/test_logbuch.py` (Abschnitte 6–10) und `tests/test_ladefeedback.py`.
  Chromium nur, wenn WebGL-Last gemessen wird — und dann begründen.
- **Marcs Bibliothek und Projekte nicht anfassen.** Alles in Temp-Ordnern (`tempfile.mkdtemp`,
  `.resolve()` — das Archiv merkt sich `/private/var/…`). Nichts unter
  `~/Library/Application Support/Reisezoom GPS Studio/` verändern.
- **Das NAS (`/Volumes/Fotos`) nie abhängen.**
- **Nichts taggen, nichts deployen, keinen Test-Build hochladen.** Lokal `./build.sh` ist erlaubt
  (aktualisiert `/Applications/Reisezoom GPS Studio.app`).
- **Vor jedem Push:** `tests/test_keine_testernamen.py`, `~/.config/reisezoom/scan-secrets.sh .`,
  `.venv/bin/ruff check .`, `scripts/check_i18n.py`, `scripts/check_js_undef.py`,
  `tests/test_keine_hartkodierte_sprache.py`. Keine Tester-Vornamen in Code, Doku, Commits.
- **Backup vor Code-Änderungen:** `./scripts/backup.sh "anlass"`.
- **Jeder Fix bekommt:** Wächter (oder Erweiterung von `tests/test_logbuch.py`), CHANGELOG.md +
  `docs/CHANGELOG{,.en,.es}.html`, ggf. USER_GUIDE ×3 / DEVELOPER, Commit erst Englisch dann
  Deutsch, `Co-Authored-By`-Zeile.
- **Ehrlich berichten.** Was nicht geprüft werden konnte, steht als „nicht geprüft" im Bericht,
  nicht als grün.

## 1. Womit testen

| Datei (in `tests/pruefsammlung/dateien/`) | Was sie zeigt |
|---|---|
| `reise-womo-geory.gpx` | 38 Tage Wohnmobil, 27 034 Punkte, 2 Fähren, 144 benannte App-Halte, Übernachtungen; das Archiv rät „Rad" — Regel „langsame Fahrt" |
| `track_teide.gpx` | Tageswanderung, höchster Punkt 3 746 m, Pausen, viele POIs (Gipfel, Miradores) |
| `wirtshaus-und-kleine-luecken.gpx` | Wanderung mit Pausen ≥ 10 min und kurzen Halten (die aufgehen) |
| `mischfall-lauf-mit-zug.gpx` | Lauf mit 55 km Zugfahrt (Fahrt zwischen Gehen) |
| `unsicher-kurze-faehre.gpx`, `unsicher-freizeitpark.gpx` | unsichere Abschnitte (Q8) |
| `mischfall-wanderung-mit-auto.gpx` | Wanderung mit Autofahrt, Fahrt ohne Punkte |

Ein Track **außerhalb des Archivs** (Datei irgendwo im Temp-Ordner, nicht gescannt) muss den
ehrlichen Hinweis „nicht im Archiv" zeigen, kein Logbuch.

Testbibliothek anlegen wie in `tests/test_logbuch.py` Abschnitt 6 (`cbib.anlegen`, `APP.BIB…`,
`api.library_add_folder`, `library_scan_start` und auf `running=False` warten).

## 2. Was zuerst laufen muss (Wächter)

```bash
cd /Users/docarzt/Claude-Masterblaster/Reisezoom-GPS-Studio
.venv/bin/python -u tests/test_logbuch.py        # Stufe 1–4, ~8 min, braucht Netz für 6b/9c (sonst übersprungen)
.venv/bin/python tests/test_einteilung.py
.venv/bin/python tests/test_bewegung.py
.venv/bin/python tests/test_pruefsammlung.py     # Sperrklinke: nichts darf schlechter werden
.venv/bin/python tests/test_dialog_ordner.py     # Datei-Dialoge merken sich ihren Ordner (Windows-Weg nachgebaut)
.venv/bin/python tests/test_inspektor_trackcheck.py
.venv/bin/python tests/test_inspektor_web_werkzeuge.py
.venv/bin/python tests/test_ladefeedback.py
.venv/bin/python tests/test_ladeflagge.py
```

Alle müssen grün sein, bevor etwas geändert wird. Danach die **volle Suite** einmal am Ende:
`.venv/bin/python scripts/run_tests.py` (~12 min).

## 3. Was anzuschauen ist — Stufe für Stufe

Für jede Zeile: kopflos in WebKit ausführen, mit `page.screenshot` dokumentieren (Verkleinerung
mit `sips -Z 1400` vor dem Ansehen), Zustand über die Wächter-Zugänge auslesen:
`window.__rzGpxiLogbuch` (daten, auswahl, waehlen, laden, fenster, hover, zuIdx, hoverIdx),
`window.__rzGpxiLogbuchBearbeiten` (aktion, menue, bereichAB, punktModus, punktSetzen, einstellungen, stand),
`window.__rzGpxiLogbuchNetz` (orte, pois, nachladen, fenster, fensterEl, wahl, poiUebernehmen),
`window.__rzGpxiLogbuchSpuren` (befunde, eigene, eigeneLaden, zeilen, eigenBereich, an).

### Stufe 1 — Erzeugen, Zeitstrahl, Liste, Kopplung
1. Track aus dem Archiv im Inspektor öffnen (`switchMod('gpxinspect')`, `loadGlobalGpx(pfad, {stumm:true})`):
   Warte-Fenster „Logbuch wird erstellt" in der Mitte? Danach `#gpxi-logbuch` sichtbar, Kopfzeile mit Chips
   („4 Wanderungen · 3 Pausen · höchster Punkt 3.746 m"), Zeitstrahl **dunkel**, Liste **hell** mit
   Grau/Weiß-Wechsel und dunklen Linien (Marcs Wunsch).
2. Zeitstrahl: Spuren Tage · Bewegung (Farben Q15: Fahrt blau, Fähre türkis, Gehen grün, Rad orange, Laufen
   gelb, Pause grau, unsicher gestreift) mit **Höhenprofil als Silhouette darüber** · Punkte (▲ höchster,
   ● Start, ■ Ziel) · POIs · Achse in Ortszeit. Spur-Namen links, nichts überlappt.
3. Liste: Uhrzeit von–bis (Ortszeit der Tour!), Dauer, km, ↑Hm, Tempo; Zahlen im Format der App-Sprache
   (DE „5,2 km", EN „5.2 km"). Mehrtägig (Womo): Tagesköpfe „Tag 7 · Sa., 11.7." kleben oben; Tagestour:
   flache Liste.
4. Kopplung (Q16): Klick Eintrag → Track leuchtet (Saum + Farbe), Karte zoomt hin; Klick auf den Track
   (`zuIdx(i)`) → Eintrag gewählt, ohne Zoom; Hover (`hoverIdx(i)`) → Marke mit Uhrzeit im Strahl; **Esc** hebt
   auf; Doppelklick auf einen Tag / Klick auf Tageskopf zoomt den Tag, „⤢ Ganze Tour" zurück, Mausrad zoomt.
5. „alles zeigen": rohe Bereiche samt kurzer Halte, Badge „roh"; wieder aus → wie vorher.
6. Regeln prüfen (Womo): keine Pause unter 10 min außer benannten App-Halten; Übernachtungen; **kein
   „Rad"** (langsame Fahrt, Badge „vermutet"); `unsicher` nur, wo beide Nachbarn verschieden sind.
7. Sprache: Oberfläche auf `en` und `es` stellen (`settings_set({"ui_lang": "es"})` vor dem Laden) — kein
   deutscher Text im Logbuch, keine `{n}`-Platzhalter, kein „undefined".
8. Einklappen ▾ und wieder auf; Einstellung überlebt den Neustart (`gpxi_logbuch_zu`).

### Stufe 2 — Bearbeiten, Einstellungen, ⌘Z
9. ⋯-Menü (Liste, Rechtsklick Liste, Rechtsklick Block): Umbenennen, Notiz, Art ändern (8 Arten inkl.
   Wassersport), Aktivität teilen (hier / bei Anker A / bei Uhrzeit / in der Mitte), zusammenlegen, löschen
   (geht im Nachbarn auf — kein Loch, keine Überlappung: rohe Bereiche `t1 ≤ nächstes t0`).
10. **Teilen** an jeder Stelle: Schnitt sitzt genau dort (nicht „weiter hinten"), auch in einem aufgegangenen
    kurzen Halt; „Schnitt liegt nicht im Bereich" darf nie erscheinen, solange die Zeit im Eintrag liegt.
11. Grenzen ziehen im Zeitstrahl (pointerdown auf den Übergang, Cursor `col-resize`), Ergebnis in Daten.
12. ＋ A→B (Anker setzen mit `selectAnchor` über die Karte oder `__rzGpxiWerkzeug`-Wege) → Art wählen → neuer
    Eintrag; 📍 Punkt → Kartenklick → Name → eigener Punkt (🗑 im Menü löschbar).
13. ⚙: Werte je Tour / als Standard / Zurücksetzen; Netz-Schalter; Wirkung sofort (Pause ab 2 min →
    mehr Pausen). `logbuch_einstellungen` liefert `vorher`.
14. **⌘Z / ⌘⇧Z für jeden Schritt** (Knöpfe `#gpxi-undo/#gpxi-redo`): nach n Änderungen n-mal zurück = Ausgangs-
    stand (Kennungen und Namen vergleichen), Wiederherstellen geht. Handarbeit überlebt ↻ (neu erkennen).
15. Nach Bearbeitungen bleiben Undo des Tracks (Heilen, Umkehren) und Undo des Logbuchs im selben Stapel —
    Reihenfolge prüfen.

### Stufe 3 — Ortsnamen, POIs, großes Fenster (Netz)
16. Nach dem Laden: Kasten unten rechts „Logbuch: Namen und Orte" (Hintergrund, abbrechbar), dann Orte in
    der Liste („La Orotava, Kanarische Inseln"; Fahrten „von → nach"); zweiter Lauf aus dem Cache
    (`logbuch_orte(pfad, 0)` → `rufe: 0`). Ohne Netz: kein Fehler, kein Absturz, `offen > 0`.
17. POI-Spur: Marken mit Symbol, Beschriftung ohne Überlappung, wichtige (Gipfel/Pass/Burg, Pausen-Nähe)
    sind ⭐-Zeilen im Logbuch; Klick auf eine andere Marke übernimmt sie (⌘Z); Häkchen „POIs" blendet aus;
    ⚙ „POI-Spur zeigt höchstens" wirkt.
18. ⤢ Großes Fenster: verschiebbar (Kopfzeile), Größe änderbar, Tabelle sortierbar (jede Spalte, auf/ab),
    Mehrfachauswahl (Umschalt-Klick), Sammelleiste Art ändern / Zusammenlegen / Löschen, Doppelklick Name,
    Zeilenklick wählt auf der Karte; ✕ schließt, Lage bleibt (localStorage).

### Stufe 4 — Befunde, Eigene, Archiv
19. Befunde-Spur: eine Raute je Fundstelle (`_tc.befunde[].stellen`), Farbe nach Stufe, Klick springt hin und
    markiert wie „Zeigen"; Häkchen aus → Strahl wird flacher.
20. Eigene Spur: ＋ A→B → „Eigene Spur …" → Name → Abschnitt; Häkchen „Eigene" an; Rechtsklick: umbenennen,
    Abschnitt entfernen, ganze Spur entfernen; ⌘Z für alles; zwei Spuren in zwei Farben.
21. Archiv: Tour im Archiv anklicken → unter den Kennzahlen „📖 Logbuch" mit Chips (oder „noch kein
    Logbuch" vor dem ersten Öffnen im Inspektor). Prüfen, dass die Foto-Ansicht des Archivs nicht gestört wird.

### Rundherum (13.09.)
22. Datei-Dialoge (`pick_file`, `pick_save_path`) merken sich den Ordner je Zweck; verschwundener Ordner wird
    übergangen. Auf dem Mac nur die Brücke prüfen (NSOpenPanel ist kopflos nicht steuerbar).
23. Quellenzeile der Karte im Inspektor: schmale Leiste über die ganze Breite, 8,5 px; Hoverbox, Höhenprofil
    und Logbuch werden nicht verdeckt.
24. Warte-Fenster/Ladeflagge/sicherer Modus aus v0.9.704/705: `tests/test_ladefeedback.py`, `tests/test_ladeflagge.py`.

## 4. Randfälle, die gern kaputtgehen

- Track **ohne Zeitstempel** → Hinweis „ohne Uhrzeit", kein Logbuch, keine Fehler in der Konsole.
- Track mit **einem Punkt an einem Tag** (Womo hat so einen): Tage laufen in der Liste nie rückwärts.
- Zweimal dieselbe Tour öffnen, Inspektor verlassen und zurück (`switchMod`), Track wechseln während das Netz
  noch lädt (`_lbNetzLauf` muss das Alte verwerfen — keine Orte der falschen Tour).
- Undo, während ein Netz-Lauf läuft. Reparieren (Track-Check) und danach Logbuch — die Einträge hängen
  an Uhrzeiten, nicht an Punktnummern, müssen also stehen bleiben.
- „Workspace leeren" → Logbuch weg, Karte ohne Saum, kein Fehler; neues Laden → alles wieder da.
- Sehr kleine Fensterbreite (ResizeObserver): Strahl zeichnet neu, Cursor sitzt richtig.
- Sprache wechseln bei offenem Logbuch (Datum/Uhrzeit folgen `rzSprachCode()`).
- `pywebview`-Fehlerpfade: Brücke wirft → `rzWarten` schließt das Fenster, Toast statt Hänger.

## 5. Bericht

Am Ende in `HANDOVER.md` (lokal) und als Antwort im Chat:
1. Was grün ist (mit Zahlen: Einträge, Zeiten, Screenshots im Scratch-Ordner).
2. Gefundene Fehler mit Ursache, Fix, Wächter, Commit.
3. Was **nicht** geprüft werden konnte und warum (z. B. kein Netz, NSOpenPanel).
4. Offene Fragen an Marc — kurz, mit Empfehlung.
Status-Topic `gps-studio-logbuch` speichern (`python3 ~/.claude/status/status.py save …`).
