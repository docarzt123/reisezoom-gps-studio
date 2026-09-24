# Overlay-Boxen einzeln einstellen (23.09.2026)

**Anlass:** Beta-Tester (05./22.09.2026): „das Aussehen der Stats-Boxen ist bei allen
Einblendungen fast gleich … vielleicht ein leichtes Ein- und Ausblenden" und „ich möchte,
dass die Statistik zum Ende der Route für 10 s eingeblendet wird und dann wieder
ausgeblendet — habe alles ausprobiert, ohne Erfolg". Marc (Grilling 23.09.): Boxen UND
Zeilen einzeln einstellbar, mit Vererbung von global, Reset, alles rein, am Stück.

## 1. Entscheidungen (Grilling 23.09.2026)

| Frage | Entscheidung |
|---|---|
| Vererbung | drei Ebenen: global → Box → Zeile; jeder Wert unten hat „wie oben" (Standard) |
| Reset | „Diese Box zurücksetzen" + „Alle Boxen zurücksetzen" (beide mit Rückfrage) |
| Je Box | Hintergrundfarbe, Deckkraft, Textfarbe, Schrift, Ecken, Rahmen, Schatten, Einblendung, Ausblendung, Blende-Dauer, Zeit (Auslöser), Bezug |
| Je Zeile | Textfarbe, Größe (Faktor), fett, Zeit, Ein-/Ausblendung, Bezug — kein eigener Hintergrund |
| Auslöser | Sekunde · Prozent der Strecke · Etappenstart N · Etappenende N · Track-Start · Track-Ende; Ende alternativ als Dauer |
| Boxen je Tour | Boxen sind eine freie Liste (＋ Box, Typ Gesamt/Live, duplizieren, löschen); die drei heutigen sind die Startbelegung |
| Bezug | gesamt · laufende Etappe · Etappe N — Zahlen der Box folgen dem Bezug |
| Bedienung | Modal wie bei den Schildern; „Auf alle Boxen übernehmen"; Undo je Änderung |
| Vorschau | zeigt Blenden und Auslöser beim Probelauf (WYSIWYG; der Szene-Render fährt die Vorschau) |
| Standard | bleibt wie bisher (keine Blende, alle Boxen von Anfang bis Ende); nur einstellbar |

## 2. Datenmodell

Projekt-Einstellungen (Modul `animator`), alles optional — fehlt es, verhält sich die App
wie vor dem Umbau:

```
overlay_exit:          "none"|"fade"|"pop"|"both"   (global, Gegenstück zu overlay_entry)
overlay_blende_s:      0.5                          (global, Dauer je Blende)
overlay_radius:        12    overlay_border_w: 0    overlay_border_color: "#ffffff"
overlay_shadow:        true
overlay_boxen: [                                    (nur Abweichungen + Zusatzboxen)
  { id: "totals"|"live"|"ele"|"box_<zufall>",
    typ: "totals"|"live",            (nur Zusatzboxen; Standardboxen kennen ihren Typ)
    enabled, position, fields, titel (nur Zusatzboxen; Standardboxen lesen das aus den alten Feldern)
    stil:   { bg_color, bg_opacity, text_color, font, radius, border_w, border_color, shadow }   je Schlüssel optional
    blende: { ein, aus, dauer_s }                                                                 je Schlüssel optional
    zeit:   { von: {art, wert}, bis: {art, wert} | null, dauer_s }     art = s|pct|etappe_start|etappe_ende|start|ende
    bezug:  "gesamt"|"laufend"|<Etappennummer>
    zeilen: { <feld_id>: { text_color, groesse, fett, zeit, blende, bezug } }
  } ]
```

Die alten Felder `overlay_*_from_s/to_s` bleiben die Sekunden-Vorgabe der Standardboxen
(Auslöser `s`). Sobald eine Box `zeit` trägt, gilt das.

**Auflösung** (`core/overlayboxen.py` ↔ `ui/js/overlay_boxen.js`, wortgleiche Regeln,
Wächter vergleicht beide): `aufloesen(globale, boxen)` liefert je Box die wirksamen Werte
(Global < Box), je Zeile (Box < Zeile). Auslöser werden zu Bedingungen auf
`(t, idx, n, stageNr)` — Sekunden gegen t, Prozent/Etappe/Start/Ende gegen den Marker-
Index, damit Tempo-Kurven und Übergänge stimmen.

**Zeitsteuerung** (`ui/js/overlay_timing.js`, Render bettet die Datei ein): 
`rzOvTiming(root, boxen, t, idx, n, stageNr, ctx)` setzt je Box und je Zeile Sichtbarkeit,
Deckkraft (`opacity`) und Aufpoppen (`--rz-ov-pop`), Ein- UND Ausblende symmetrisch mit
`dauer_s`. Box weg = Zeilen weg. `ctx = {intro_s, anim_s, hold_s}` für Start/Ende.

**Bezug:** Gesamt-Werte je Etappe werden in Python vorgerechnet (`etappen_stats`) und als
`data-stage-values` an die Zeile gehängt; die Zeitsteuerung wählt nach `stageNr`.

## 3. Bedienung

Overlay-Sektion: globale Regler wie bisher + Ausblendung, Blende-Dauer, Ecken, Rahmen,
Schatten. Je Box ein ✎ (Standardboxen neben ihrer Überschrift, Zusatzboxen in der Liste
„Weitere Boxen" mit ＋ / ⧉ / ✕). Das Modal `_ovBoxModal(id)`: Aussehen · Blende · Zeit ·
Bezug · Zeilen (✎ je Zeile öffnet den Zeilen-Teil im selben Fenster) · Knöpfe „Auf alle
Boxen übernehmen", „Diese Box zurücksetzen", „Alle zurücksetzen". Jede Änderung = ein
Undo-Schritt, Vorschau folgt sofort.

## 4. Stand (23.09.2026: gebaut, v0.9.723 lokal)

Alle sechs Schritte aus §5.6 sind umgesetzt. Wächter:
`tests/test_overlay_boxen.py` (Modell, Vererbung, Auslöser, Parität Python/JS unter node,
Render-HTML, Alpha-Video mit dem Fall des Beta-Testers gemessen: 0 → 0,2 → 0,6 → 1 → 0,6 → 0,2 → 0),
`tests/test_overlay_boxen_ui.py` (WebKit, echte Brücke: Modal, Vorschau-Stil, Undo/Redo, ＋ Box,
Zeitpunkt „Ende des Tracks, Dauer", Blende, Bezug „laufend", Zeile 150 %, Probelauf im
Schrittmodus wie der Szene-Render, Duplizieren, Zurücksetzen mit Rückfrage, Löschen),
`tests/test_overlay_boxen_szene.py` (Szene-Render 4K + 1080p gemessen, nur Release).

**Abweichungen vom Plan, bewusst:**
- Zeitsteuerung steckt in derselben Datei wie die Auflösung (`ui/js/overlay_boxen.js`,
  `rzOverlayBoxen.anwenden`) statt in einer zweiten `overlay_timing.js` — eine Datei weniger
  zum Einbetten, gleiche Funktion.
- Zeitmodell: Zeit-Auslöser (Sekunde, Start, Ende) sind exakte Video-Sekunden; Strecken-
  Auslöser (Prozent, Etappe) gehen über den Streckenanteil des Laufpunkts und merken sich die
  Sekunde des Erreichens. Einblende ab „von", Ausblende ab „bis" (bei Dauer: von + Dauer).
- Bezug („Zahlen für") gibt es nur für Gesamt-Boxen; Live-Boxen haben dafür die Etappen-Felder
  („In dieser Etappe", „Zeit in der Etappe"). Kennzahlen je Etappe auf den VOLLEN Punkten.
- Zeilen mit eigenem Zeitpunkt behalten ihren Platz (visibility), damit die Box beim
  Einblenden einer Zeile nicht springt.
- Diagramme bekommen in der Vorschau Zeitfenster und Deckkraft, aber kein Aufpoppen (sie
  werden dort inline positioniert, nicht über die Positions-Klassen).
- Eine leere Feldliste bleibt leer (vorher zeigte der klassische Render dann die Standardfelder,
  die Vorschau keine Box).
- Vorlagen übernehmen die neuen Schlüssel automatisch (Sperrliste statt Positivliste).

**Aufgeräumt am 24.09.2026:** Die Zeitsteuerung (`zustand`, `ziel`, `erreichtBei`,
`etappenGrenzen`) gibt es nur noch in `ui/js/overlay_boxen.js`. Der Python-Zwilling in
`core/overlayboxen.py` lief nur im Paritätstest und ist weg; `tests/test_overlay_boxen.py`
prüft dieselben Fälle jetzt direkt in der JS-Datei (`tests/_node.py`). Wortgleich in beiden
Sprachen bleibt nur die **Auflösung** (`aufloesen`, `chart_boxen`, `zeit_normal`,
`hat_zeitsteuerung`) — Python baut damit das Render-HTML.

**Nebenbefunde, mit behoben:** Fade/Pop (v0.9.479) kam nie im Szene-Video an, weil die
Vorschau nur harte Zeitfenster kannte; die Vorschau lud die Google-Schriften der Boxen nie
(Vorschau und Szene-Video zeigten eine Ersatzschrift).

---

## 5. Bauanleitung (geschrieben vor dem Bau, 23.09.2026 — Stand siehe §4)

### 5.1 Was heute schon da ist (Befund aus dem Code)

- **Drei feste Boxen** mit eigenen Feldern in `AnimatorConfig` (`core/animator.py` ~Z. 280–320):
  Gesamt (`overlay_totals_*`), Live (`overlay_live_*`), Höhenprofil (`overlay_elevation_*`),
  jede mit `enabled`, `position`, `from_s`/`to_s`; Gesamt/Live zusätzlich `fields` (Auswahl +
  Reihenfolge) und `overlay_field_overrides` (Umbenennung je Feld). Diagramme (`charts`)
  sind eine eigene Liste mit `from_s`/`to_s`.
- **Globales Styling** für alle Boxen: `overlay_font`, `overlay_text_color`, `overlay_bg_color`,
  `overlay_bg_opacity`; Schatten fest (folgt `shadow_dir`, 9 px), Ecken fest 12 px, kein Rahmen.
- **Einblendung** gibt es seit v0.9.479: `overlay_entry` = none|fade|pop|both, Dauer fest 0,5 s,
  Sidebar-Select `#anim-ov-entry`. **Ausblendung gibt es nicht** (harter Schnitt am Fensterende).
- **Zeitfenster** nur in Video-Sekunden (`_overlay_windows`, `__overlayTiming(t)` in
  `_overlay_timing_js`); der Render ruft es nur, wenn `_overlay_has_timing(cfg)` (Z. ~1281).
  Der Nutzer muss also selbst ausrechnen, wann „Ende der Route" ist (Intro + Animation) —
  genau das, woran der Tester scheiterte.
- **Render-HTML** entsteht ZWEIMAL (MapLibre/Mapbox-HTML ~Z. 2620–2660 und Alpha-HTML
  ~Z. 4390–4410) mit identischen Box-Blöcken; Zeilen werden von `_overlay_totals_rows` /
  `_overlay_live_rows` gebaut, Live-Werte je Frame von `_overlay_live_update_js` per
  `getElementById('live-<fid>')` gesetzt → **Zusatz-Live-Boxen brauchen eigene Element-IDs**.
- **Vorschau** baut die Boxen in `_overlayBoxenRendern()` (module.js ~Z. 14240–14400) als
  `.ov-box[data-ovbox=totals|live]` / `.ov-ele-box[data-ovbox=ele]` mit Inline-Style aus den
  globalen Reglern; Zeitfenster im Probelauf über `_animOverlayTimingPreview(tSec)` (~Z. 14430),
  aufgerufen aus der Probelauf-Schleife (~Z. 8384) mit `timelineProgress × (intro+anim+hold)`.
  **Der Szene-Render fährt diese Vorschau** (core/szene.py) → alles, was das Video zeigen soll,
  muss in der Vorschau stehen (kein Render-Sonderweg).
- **Etappen-Daten** je Punkt: `core/gpx.etappen_reihen` → `nr`, `d0`, `t0`, `name`, `gesamt`
  (im Render als `STAGE_NR`, `STAGE_D0`, `STAGE_T0`; in der Vorschau `_ovSeries.stage`).
  Live-Felder `stage_dist`/`stage_time` rechnen damit „in dieser Etappe"; Gesamt-Werte je
  Etappe gibt es noch nicht.
- **Muster zum Abgucken:** Umbenennen-Modal `_ovRenameField` (openModal mit title/body/footer),
  Schild-Editor (`.sign-editor`), Diagramm-Liste `_chartsRenderList` (＋/✎/✕-Liste), Undo
  über `_animUndoCtrl.push(label, {force:true})`, geteilte JS-Dateien werden in den Render
  eingebettet wie `sign_draw.js` (`_sign_draw_js()`), Vorlagen kopieren Overlay-Schlüssel in
  `core/vorlagen.py`.

### 5.2 Neue Dateien

1. `core/overlayboxen.py` — reines Modell, keine App-Importe:
   - `STANDARD_IDS = ("totals", "live", "ele")`, `AUSLOESER = ("s","pct","etappe_start","etappe_ende","start","ende")`.
   - `global_defaults(cfg_dict)` liest die globalen Werte (alt + neu) mit Fallbacks.
   - `aufloesen(cfg_dict) -> list[Box]`: Standardboxen aus den alten Feldern + `overlay_boxen`-
     Abweichungen, Zusatzboxen vollständig; je Box `stil`, `blende`, `zeit`, `bezug`, `zeilen`
     aufgelöst (Global < Box < Zeile). Fehlende `zeit` → aus `from_s/to_s` (Art `s`).
   - `bedingung(zeit, ctx)` → `{von: (art, wert), bis: (art, wert)}` normalisiert (dauer_s → bis).
   - `etappen_stats(ds_points, etappen)` → `{nr: {distance_m, duration_s, moving_time_s,
     ascent_m, descent_m, ele_max, ele_min, max_speed_kmh, start_epoch, end_epoch}}` für den Bezug.
   - `hat_zeitsteuerung(cfg_dict)` ersetzt `_overlay_has_timing`.
2. `ui/js/overlay_boxen.js` — wortgleiche Auflösung in JS (`rzOvAufloesen(globale, boxen,
   kontext)`), Fensterobjekt `window.rzOverlayBoxen`. Wächter vergleicht Python/JS an
   Beispielkonfigurationen (node).
3. `ui/js/overlay_timing.js` — `rzOvTiming(root, boxenAufgeloest, t, idx, n, stageNr, ctx)`:
   je Box Element `[data-ovbox=<id>]` (Vorschau) bzw. `#overlay-<id>` (Render), je Zeile
   `[data-f=<fid>]`; setzt `visibility`, `opacity`, `--rz-ov-pop`; Ein- UND Ausblende mit
   `dauer_s`; Box unsichtbar → Zeilen unsichtbar; wählt bei `bezug` je Etappe den Wert aus
   `data-stage-values` (JSON `{nr: text}`) bzw. `laufend` = aktuelle `stageNr`.
   Beide Skripte kommen in `ui/index.html` und werden im Render eingebettet (Muster
   `_sign_draw_js`).

### 5.3 Änderungen Python (`core/animator.py`, `app.py`, `core/vorlagen.py`)

- Config: `overlay_boxen: list`, `overlay_exit="none"`, `overlay_blende_s=0.5`,
  `overlay_radius=12.0`, `overlay_border_w=0.0`, `overlay_border_color="#ffffff"`,
  `overlay_shadow=True`.
- `_overlay_css`: globale Ecken/Rahmen/Schatten aus cfg; danach je aufgelöster Box mit
  Abweichung eine Regel `#overlay-<id> { background; color; font-family; border-radius;
  border; box-shadow }` und je Zeile mit Abweichung `#overlay-<id> .stat-row[data-f=<fid>]
  { color; font-size-Faktor; font-weight }`.
- Overlay-HTML in EINE Funktion `_overlay_boxen_html(cfg, …)` ziehen, die beide HTML-Varianten
  aufrufen; Zusatzboxen (`typ` totals/live) mit `id="overlay-<id>"`; Zeilen bekommen
  `data-f="<fid>"`; Gesamt-Zeilen mit Bezug tragen `data-stage-values`.
- `_overlay_live_update_js(…, prefix)` je Live-Box aufrufen (Standard `live-<fid>`, Zusatz
  `<id>-live-<fid>`), `_overlay_live_rows(…, prefix)` entsprechend.
- Timing: `_overlay_timing_js` baut nur noch `window.__overlayTiming = (t, idx) =>
  rzOvTiming(document, BOXEN, t, idx, totalPoints, STAGE_NR[idx], CTX)`; Aufrufer (Z. ~5062
  Einzelbild, ~6246 Video-Loop) übergeben `idx` mit; `_ov_timed` aus `hat_zeitsteuerung`.
  Diagramme laufen weiter über ihre `from_s/to_s` (als Boxen der Art `chart` in die
  aufgelöste Liste aufnehmen, nur Zeit, kein Stil).
- `app.py` (~Z. 6660): neue Params durchreichen (`overlay_boxen`, `overlay_exit`,
  `overlay_blende_s`, `overlay_radius`, `overlay_border_w`, `overlay_border_color`,
  `overlay_shadow`).
- `core/vorlagen.py`: dieselben Schlüssel in die Vorlagen-Liste (Overlay-Block).

### 5.4 Änderungen Vorschau/Bedienung (`modules/animator/ui/module.js`, `module.css`)

- Sidebar Overlay-Sektion: neben `#anim-ov-entry` ein Select „Ausblendung" (`overlay_exit`),
  Zahl „Blende (s)", Regler „Ecken", „Rahmen" (Breite + Farbe), Häkchen „Schatten";
  ✎ neben den Überschriften Gesamt/Live/Höhenprofil; neue Liste „Weitere Boxen" mit
  ＋ (Typ wählen), ⧉ duplizieren, ✎, ✕ (Muster `_chartsRenderList`).
- `_overlayBoxenRendern`: baut auch Zusatzboxen; Inline-Style je Box aus `rzOvAufloesen`
  (statt eines gemeinsamen `boxStyle`); Zeilen mit `data-f`, Zeilenstil inline; Bezug-Werte
  aus `_ovFieldValue` je Etappe (Vorschau-Ruhezustand = Ende → letzte Etappe bei `laufend`).
- `_animOverlayTimingPreview(tSec)` → `(tSec, idx)`; die Probelauf-Schleife kennt den
  Marker-Index (dort, wo `timelineProgress` in den Track-Index umgerechnet wird) → mitgeben;
  ruft `rzOvTiming` mit `ctx = {intro_s, anim_s, hold_s}`; `tSec < 0` = alles zurücksetzen.
- Modal `_ovBoxModal(id)` (Aufbau wie `.sign-editor`): Kopf mit Name/Typ, Abschnitte
  Aussehen · Blende · Zeit · Bezug · Zeilen; jeder Regler mit Häkchen „wie global" (Zeile:
  „wie Box"); Zeilenliste = Felder der Box, ✎ öffnet den Zeilen-Teil; Fuß: „Auf alle Boxen
  übernehmen" (kopiert stil+blende, nicht zeit/bezug), „Diese Box zurücksetzen",
  „Alle zurücksetzen" (beide `rzConfirm`). Jede Änderung: `_animUndoCtrl.push(...)`,
  `saveProjectSettings(_MODKEY, {overlay_boxen})`, `renderOverlayPreview()`.
- Auslöser-Felder im Modal: Select Art + Wert (Sekunden / Prozent / Etappen-Dropdown aus
  `_ovSeries.stage.name`), „bis" wahlweise als Dauer. Für Standardboxen bei Art `s` in die
  alten Felder zurückschreiben (Sidebar und Modal zeigen dasselbe).
- Render-Params (~Z. 18277 und ~18834): neue Schlüssel mitgeben.
- Undo-Apply (`_animUndoNachziehen`): nichts zusätzlich nötig, `renderOverlayPreview()`
  läuft am Ende; das Modal muss bei Undo neu gezeichnet werden, falls offen.

### 5.5 Texte, Doku, Tests

- i18n de/en/es: ~40 Schlüssel (`animator.ovbox.*`: Modal-Titel, Abschnitte, „wie global",
  Auslöser-Arten, Bezug, Knöpfe, Rückfragen, Undo-Labels, Liste „Weitere Boxen").
- `tests/test_overlay_boxen.py`: Auflösung (Vererbung, Reset = Schlüssel weg), Parität
  Python/JS, `etappen_stats`, Zeitsteuerung per node — der Fall des Beta-Testers: `von {art:"ende"},
  dauer_s 10, blende fade` → unsichtbar bis Track-Ende, 0,5 s Fade rein, 10 s an, Fade raus;
  Render-HTML enthält Zusatzbox + Zeilen-`data-f` + Box-CSS; Live-Update-JS für Zusatzbox.
- `tests/test_overlay_boxen_ui.py` (WebKit-Mock): Modal öffnen, Box umfärben → Vorschau-Style,
  ⌘Z, Box hinzufügen/duplizieren/löschen, „Auf alle übernehmen", Reset mit Rückfrage,
  Probelauf zeigt der Fall des Beta-Testers.
- Bestehende Wächter anpassen: `test_ladefeedback`/`check_js_undef`/`test_ui_fallen`
  (leere catches), `test_vorlagen` (neue Schlüssel), Render-Wächter mit `__overlayTiming(t)`.
- Doku: CHANGELOG (md + 3 HTML), USER_GUIDE ×3 (+ HTML-Build), DEVELOPER (Modell + beide
  Render-Wege), HANDOVER.

### 5.6 Reihenfolge und Aufwand

1. Modell + Parität (Python/JS) + Wächter — ½ Tag.
2. Zeitsteuerung + Render-Einbindung (beide HTML-Wege) + der Fall des Beta-Testers im Render — ½ Tag.
3. Vorschau (Boxen, Zeilen, Timing im Probelauf) + Szene-Render-Probe in 4K — ½ Tag.
4. Modal, Liste, Sidebar-Regler, Undo, i18n — 1 Tag.
5. Bezug je Etappe (etappen_stats, data-stage-values, Vorschau) — ½ Tag.
6. Doku, volle Suite, lokaler Build, Marc-Test — ½ Tag.

Gesamt ≈ 3–4 Arbeitstage kopflos. Risiken: die zwei Render-HTML-Kopien (zusammenziehen
zuerst), Probelauf-Index für die Auslöser (Tempo-Kurve beachten), Modal-Größe in der
Sidebar-Breite (deshalb Vollfenster wie der Schild-Editor).

## 6. Overlay-Spur in der Timeline (Grilling 24.09.2026, gebaut 24.09.2026 als v0.9.724 lokal)

**Anlass:** Der Beta-Tester wollte die Gesamt-Stats ab Sekunde 25 zeigen und 2 s vor
Ende ausblenden. Er trug `Zeit 25 – 1 s` ein und meinte mit der 1 „kurz vor Ende".
Die Seitenleiste liest „bis Sekunde 1", also vor dem Start, und die Box erscheint nie.
„X s vor Ende" gab es gar nicht. Marc: Zeiträume gehören grafisch in die Timeline,
nicht eingetippt.

**Entscheidungen (Marc, 24.09.2026):**

| # | Frage | Entscheidung |
|---|---|---|
| 1 | Reihenfolge | Gleich die Timeline, kein Zwischen-Fix. Der Tester bekommt die fertige Version. |
| 2 | Was bekommt einen Balken | Nur Boxen (Gesamt, Live, Höhenprofil, weitere Boxen). Keine Zeilen, kein Nordpfeil/Maßstab. |
| 3 | Balkenende | Am Ende ist die Box **ganz weg**; die Blenden liegen **innerhalb** des Balkens. |
| 4 | Blenden | Ein- und Ausblendung mit **eigener Dauer** je Seite, als Schrägen **ziehbar**, höchstens bis sie sich treffen. |
| 5 | Einrasten | **Keins.** Ziehen, verschieben, fertig. |
| 6 | Woran ein Rand hängt | Wie die Keyframes, automatisch nach Bereich: im **Intro** Sekunden ab Videostart, in der **Animation** am **Trackpunkt** (bleibt bei Tempo-/Dauer-Änderung an seinem Ort), im **Nachlauf** Sekunden vor Videoende. Eine neue Box geht über das ganze Video (Videostart → Videoende). Prozent/Etappe entfallen als eigene Auslöser. |
| 7 | Aufbau | Aufklappbare Gruppe „Overlays", eine Zeile je Box; zugeklappt dünne Striche. Immer sichtbar, sobald eine Box an ist (die Leiste ist auch ohne Keyframe-Editor da). |
| 8 | Klicks | Klick wählt aus; **Doppel- und Rechtsklick** öffnen das Box-Fenster (dort die Werte als Zahlen). Abgeschaltete Box: grau gestrichelt, reagiert nicht; an/aus nur in Seitenleiste oder Fenster. |
| 9 | Ziehen | Vorschau springt an den gezogenen Rand, Statuszeile zeigt den Wert („Ende: Videoende − 2,0 s"). Undo wie überall (Stand vor dem Ziehen). |
| 10 | Alte Projekte | Eingetragene Zeiten bleiben; Etappe/Prozent werden auf den Trackpunkt umgerechnet; alte gemeinsame Blendendauer gilt für beide Seiten. Unterschied: die Ausblendung liegt jetzt im Balken (Box um die Blendendauer früher weg). |
| 11 | Sprachen | Zeitsteuerung nur in `ui/js/overlay_boxen.js`; Python liest nur die neuen Schlüssel und rechnet alte Projekte um. |
| 12 | Tour-Map | Keine Spur (Standbild, keine Zeit) — Ausnahme von der Spiegelungsregel. |
| 13 | Release | Erst mit der Timeline (0.9.724), 0.9.723 wird nicht einzeln veröffentlicht. |

**Fakten aus dem Code (24.09.2026):** Leiste `ui/js/timeline.js` (`mountTimelineBar`),
ziehbare Kacheln mit zwei Rändern gibt es schon (`_gruppenMausDruck`, Zeilen per
`_gruppenZeilenSicherstellen`), Achse 0–1 = Intro + Animation + Nachlauf
(`module.js` ~4030), Undo `_animPushUndo(label, {force})`.

**Stand 24.09.2026 — gebaut (v0.9.724 lokal, nicht getaggt).** Umsetzung wie oben; Architektur in
`docs/DEVELOPER.md` („Overlay-Spur in der Timeline"). Geprüft: Modell unter node (Beta-Tester-Fall
„ab 25 s, 2 s vor Ende ganz weg", Trackpunkt → Sekunde, getrennte Blenden, Kürzen), klassischer
Alpha-Render mit Trackpunkt-Ende gemessen, WebKit mit echter Maus (`tests/test_overlay_spur_ui.py`),
und in der echten App mit der Maus: Ränder, Schräge, Statuszeile, Probelauf (Box ab 104 % blendet aus,
bei 112 % = Balkenende weg). **In der App gefunden und behoben:** lange Box-Namen verschoben die Balken
gegen die Zeitachse (Beschriftungsspalte fest 84 px); Trackpunkt-Anker wurden aus auf 0,1 s gerundeter
Zeit gebildet (in einer Reise ≈ 2 km daneben).

**Bewusst so:** Ränder im Probelauf-Rundungsraster des Laufpunkts (ganze Punkte) — „am Trackpunkt 100 %"
kann ~0,01 s vor dem Anim-Ende liegen. Trackpunkt in einer Pause (Halt) = Anfang der Pause.
