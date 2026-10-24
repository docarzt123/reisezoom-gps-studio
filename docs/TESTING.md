# Test-Protokoll — vor jedem Release

Läuft **vor jedem Release** durch. Zwei Teile:

- **Teil A — automatische Gates** (`./scripts/release_check.sh`): schnell, deterministisch, blockiert bei Fehler.
- **Teil B — manuelle Sichtprüfung** (Pflicht-Checkliste): fängt genau das, was Automatik nicht sieht — ob der Track am Bildschirm **sichtbar** ist, ob die Vorschau dem Render entspricht (WYSIWYG).

> **Warum beides?** Der v0.9.469-Bug („Track wird nicht gezeichnet") ist durch alle automatischen Tests durchgerutscht: Daten luden, Layer/Kamera/Farbe stimmten — nur die Vorschau-Linie hatte 1 Punkt und war unsichtbar. Headless lässt sich die Mapbox-Vorschau nicht zuverlässig befüllen (Token/WebGL/Timing). **Gefangen hätte den Bug nur ein Mensch, der einen Track lädt und hinschaut.** Deshalb ist Teil B kein „nice to have", sondern Release-Gate.

---

## Teil A — Automatische Gates

```bash
cd Reisezoom-GPS-Studio
./scripts/release_check.sh          # schnell (Sekunden–1 Min)
./scripts/release_check.sh --full   # zusätzlich echte Video-Renders (langsam, braucht Token)
```

Grün = alle Gates bestanden. Exit ≠ 0 = Release blockiert.

| # | Gate | Prüft |
|---|------|-------|
| 1 | JS-Syntax | `node --check` auf allen `ui/js/*.js` + `modules/*/ui/module.js` |
| 2 | Python-Syntax | `py_compile` auf `app.py`, `core/*.py`, `scripts/*.py` |
| 3 | i18n-Konsistenz | DE/EN/ES deckungsgleich, keine fehlenden Keys (`check_i18n.py`) |
| 4 | Fix-Invarianten | kritische Regressions-Guards noch im Code (z. B. Track-Sichtbarkeits-Fallback) |
| 5 | UI-Smoke | alle Module laden headless, 0 pageerrors (`selftest_ui.py`) |
| 6 | UI-Tiefentest | jeder Regler/Akkordeon/Undo, 0 pageerrors (`selftest_deep.py`) |
| 7 | Track-Sichtbarkeit | `preview-track`-Quelle ≥ 2 Punkte — *best effort*, SKIPt wenn headless nicht befüllbar (`selftest_track_visible.py`) |
| 8 | Echte Renders | nur mit `--full`: rendert echte Videos über `core/animator.py` (`selftest_renders.py`) |

**Eigene Einstellungen je Test (seit 16.10.2026):** Ohne gebaute App ist der App-Ordner das Repo — alle Tests
teilten sich die eine `settings.json` dort (gitignored). Bei `--parallel=3` stellte ein Test dem anderen Werte um
(Kartenschlüssel, „Fotos von selbst“, zuletzt geöffnete Tour) → Tests, die nur parallel rot und einzeln grün waren.
`scripts/run_tests.py` legt deshalb je Test eine Kopie dieser Datei in einen eigenen Temp-Ordner und übergibt sie mit
`RZ_SETTINGS_DATEI`; `app.py` nimmt dann diese Datei (nicht bei `RZ_APP_ORDNER` — dort ist sie schon getrennt).
Einzelwerte (`_einstellung_merken`) landen darin nach derselben Regel wie ohne Kopie: nicht, wenn der Test
`APP.APP_SUPPORT` umgeleitet hat (sonst setzte z. B. eine zweite Testseite das Projekt der ersten fort). Die Vorlage selbst ändert sich während der Suite nicht mehr.
Wer einen Test von Hand startet, benutzt weiter die gemeinsame Repo-Datei.

**Suite nicht doppelt (seit 04.10.2026):** `scripts/run_tests.py` schreibt nach einem vollen, grünen Lauf auf
sauberem Arbeitsstand (Anfang und Ende, HEAD unverändert, kein Namensfilter) den Stempel `.rz_suite_gruen.json`
(Commit, Anzahl, Zeit). `deploy_release.sh` prüft ihn mit `scripts/suite_stempel.py pruefen <tag>`: gilt er (≤ 72 h,
zwischen Stempel-Commit und Tag nur Doku — `CHANGELOG.md`, `docs/*.md|html|xml`), läuft
`release_check.sh` mit `RZ_OHNE_SUITE=1` — alle Gates außer der Suite-Wiederholung (~80 min gespart). Sonst wie
bisher komplett. Test `tests/test_suite_stempel.py`. Ablauf also: volle Suite → Changelog schließen → Tag → Deploy.

**Seit 15.10.2026 auch mit offenen Änderungen** (Marc: „die Suite lief doch schon grün! … ändere das, dass das nicht
immer 2× läuft“). Beim Release liegt die vorbereitete Versionsnummer (`app.py`, Changelogs) beim Suite-Lauf noch nicht
eingecheckt — früher gab es dann keinen Stempel und das Upload-Skript fuhr die Suite ein zweites Mal. Jetzt steht im
Stempel unter `offen` jede nicht eingecheckte Datei mit ihrem Git-Blob (`suite_stempel.offen()`); `run_tests.py`
schreibt ihn, wenn HEAD und `offen` am Ende wie am Anfang sind. `pruefen` lässt den Tag gelten, wenn jede seit dem
Stempel-Commit geänderte Datei Doku ist, beim Lauf schon mit genau diesem Inhalt offen lag oder in `app.py` nur die
Zeile `APP_VERSION = "…"` springt. Die Nacht-Suite (Kopie) stempelt nach Einzel-Nachprüfung ebenso und übergibt den
Stempel an den Arbeitsordner (`stempel_uebernehmen`). Tests: `test_suite_stempel.py`, `test_nachtlauf_stempel.py`.

**Entzerrt (seit 23.10.2026)** (Marc: „entzerre die Tests in der Suite“). Das Deploy-Gate für 0.9.807 brach zweimal
an UI-Tests ab, die einzeln grün waren — unter paralleler Last öffnete ein Editor nicht rechtzeitig, ein Probelauf
antwortete erst nach 10 s, ein fremder Höhendienst lieferte Lücken. Drei Regeln in `scripts/run_tests.py`:
1. **Einzel-Nachprüfung:** Wer im Parallellauf rot war, läuft am Ende noch einmal allein. Grün allein = Lastfrage, kein
   Code-Fehler — zählt als bestanden und steht in der Bilanz unter „Nur parallel rot, einzeln grün“ (wie die
   Nacht-Suite seit 12.10.). Rot allein bleibt rot.
2. **Rote Prüfungen sichtbar:** Bei einem roten Test zeigt der Runner alle `[FAIL]`/`FEHL`-Zeilen samt Detail aus der
   ganzen Ausgabe (`»`), nicht nur die letzten zwölf Zeilen — im Gate-Log fehlte sonst oft die Ursache.
3. **Mehr Tests einzeln** (`ALLEIN_MUSTER`): UI-Läufe mit Zeitfenstern (`codexlauf3`, `schilder_viele`).
4. **Gestreckte Wartezeiten nur von Hand** (`RZ_TEST_TEMPO_FEST=2.5`, über `scripts/test_tempo_start.py`): automatisch
   bei Blender-Last ausprobiert und wieder abgeschaltet — Tests, die einen kurzen Zwischenzustand prüfen („läuft seit
   N s“), verpassten ihn dann (12 statt 3–4 rote im Parallellauf).
5. **Kein Start-Dialog in Tests** (24.10.2026): `scripts/run_tests.py` und `tests/szene_umgebung.py` setzen
   `RZ_KEIN_WILLKOMMEN=1` — dann zeigt die App beim Start kein „Neu in GPS Studio …“ (das würde sonst jede Oberfläche
   mit gemerkter alter Version blockieren). `test_neu_in_version` nimmt die Variable bewusst weg.
In den Tests selbst: auf Zustände warten statt fester Pausen, Klicks mit kurzem Zeitlimit und direktem Auslösen als
Rückfall (Bildschirmfoto, was darüber lag), Zeitlimit für Seitenabfragen 30 s statt 10 s, fremde Dienste bis zu
dreimal fragen.

Gate 7 ist **selbst-kalibrierend**: kann die Umgebung die Vorschau nicht befüllen, meldet es SKIP + Manuell-Hinweis (kein falsches Grün). Deshalb ersetzt es **nicht** Teil B.

---

## Teil B — Manuelle Sichtprüfung (PFLICHT)

In der frisch gebauten `.app` (nicht Dev-Modus). Einen echten Track laden. Jede Zeile abhaken:

### B1 · Track-Sichtbarkeit — **wichtigster Punkt**
- [ ] **Animator:** Track laden → Linie ist **sofort sichtbar** auf der Karte
- [ ] Animator: „Ganzer Track" **AN** → ganze Linie sichtbar
- [ ] Animator: „Ganzer Track" **AUS** → Linie ab Scrubber-Position sichtbar (nicht verschwunden)
- [ ] Animator: Scrubber ganz nach links → Track bleibt sichtbar (nicht auf 1 Punkt kollabiert)
- [ ] **Tour-Map:** selben Track laden → Linie sichtbar (bleibt sichtbar, verschwindet nicht nach 1 s)
- [ ] **Höhen-Animator:** Track laden → Höhenprofil-Kurve sichtbar
- [ ] **Geotagger:** Track laden → Track auf Karte sichtbar

### B2 · Probelauf / Vorschau
- [ ] Animator: **Probelauf startet** und die Kamera bewegt sich (nicht „nichts passiert")
- [ ] Tour-Map: Standbild-Vorschau zeigt Track + Pins
- [ ] Höhen-Animator: Probelauf animiert die Kurve

### B3 · WYSIWYG (Vorschau = Render)
- [ ] Ein kurzes Video rendern → Track/Kamera/Overlays sehen aus **wie in der Vorschau**
- [ ] Stats-Box / Overlays an derselben Position wie in der Vorschau

### B4 · Grundfunktionen
- [ ] Modul-Wechsel (Animator ↔ Tour-Map ↔ Höhe ↔ Geotagger) → Track bleibt geladen
- [ ] Projekt/Session wechseln → richtige Einstellungen laden
- [ ] App neu starten → letzter Zustand kommt sauber zurück
- [ ] „Erste Schritte" öffnen → **„Ganzes Handbuch"**-Button öffnet das Handbuch
- [ ] Handbuch: **Sprache DE/EN/ES** umschalten funktioniert

### B5 · Multi-Track
- [ ] (aktuell versteckt — nur prüfen wenn wieder aktiviert) zweiter Track hinzufügbar + sichtbar

> Findet ein Punkt einen Fehler → **kein Release.** Fix, dann Teil A + B erneut.

---

## Workflow-Einordnung

```
Backup → Code-Änderung → Doku (CHANGELOG/USER/DEV) → Version-Bump
      → ./scripts/release_check.sh   (Teil A grün)
      → ./build.sh                   (frische .app)
      → Teil B manuell in der .app   (alle Häkchen)
      → Marc: „passt / release"
      → git tag + push (+ ggf. deploy_release.sh)
```

**Ohne grünen Teil A UND vollständigen Teil B wird nicht getaggt/deployed.**
