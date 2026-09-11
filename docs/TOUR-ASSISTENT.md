# Tour-Assistent & Vorlagen — Spezifikation (Stand 11.09.2026, mit Marc durchgesprochen)

Ergebnis einer Grilling-Runde am 11.09.2026 (Q1–Q22). Dieses Dokument ist die Wahrheit
für den Bau; wer hier weiterbaut, braucht den Chat nicht. Gebaut wird in Stufen, **Stufe 0
(Vorlagen) zuerst** — Marc: „lass uns das als aller erstes bauen.“

## 1. Zweck

Marc kommt von der Wanderung zurück, hat einen GPX-Track und Fotos, und will „überall eine
Standardgeschichte schnell raushaben“: Track repariert, Fotos verortet und ausgewählt, ein
Projekt mit allen Modulen gefüllt (Animator, Tour-Map, Daten-Animator, Geotagger), fertig
zum Feinschliff. Kein Export in dieser Ausbaustufe — „ich hab was in Animator, in Tourmap
usw.“ (Q6).

Der Assistent ist ein **Menüpunkt** („Tour-Assistent…“, ⌘⇧N), kein Auto-Popup (Q1: „man
will ja nicht ständig eine neue Tour machen“). Er läuft **vollautomatisch** (Q4) nach einer
**Vorlage** (Q5) und landet **im Animator** (Q12); die Übersichtsseite kommt später.

## 2. Vorlagen (Stufe 0)

### 2.1 Was eine Vorlage ist

Eine Vorlage ist ein **leeres Projekt**: alles, was ein Projekt an Gestaltung trägt, ohne
alles, was am Track hängt (Q10, Q22: „alles was irgendwie am track hängt kommt nicht in
die vorlage, alles andere schon“). Sie liegt neben den Projekten, nicht darin.

**Kommt in die Vorlage** (je Modul der Einstellungs-Block ohne die Sperrliste):

| Modul | Beispiele |
|---|---|
| Animator | Kartenstil + Karten-Regler (Helligkeit, Kontrast, Sättigung, Schärfe, Gelände, Überhöhung, Beschriftungen), Track-Form (Linienstil, Breite, Farbe, Glow, Schatten, Alterungsfarbe, Farbzonen-Modus/-Quelle), Laufpunkt, Kamera (Neigung, Drehung, Folgen, Trägheit, Flug, Intro/Hold), Tempo-Basis, Pausen-Modus, Overlays (Schrift, Farben, Hintergrund, Positionen, Felder, Höhenprofil, Nordpfeil, Maßstab), Schilder-Stil/-Größe, Foto-Größe, Sterne, Wasserzeichen, Render (Breite, Höhe, fps, Codec, Qualität, transparent) |
| Tour-Map | dasselbe Stilpaket plus Format, Rand, Pins, Web-Kachelstil, Einwilligungs-Knopf |
| Daten-Animator | Diagramm-Stil, Farben, Verläufe, Reihenwahl, Achsen, Kopfzeile, Statistik-Felder, Format |
| Geotagger | Kamera-Versätze, Zeit-aus-Track, Backup, Schlagwörter |
| Web-Karte | Kachelstil, Linienbreite, Beschriftungen, Einwilligung |
| Assistent (neu, Stufe 1+) | Fotoanzahl, Highlight-Arten |

**Nie in die Vorlage** — die Sperrliste `core/vorlagen.py: TRACKGEBUNDEN`, an einer Stelle
für Vorlagen UND „eigene Standardwerte“:

- Projekt-Kopf: id, name, status, auto, created_at, modified_at, kontext, ablauf,
  schwarm_modus, schwarm_pausen, geo_hashes, gpx_paths, letztes_modul
- Projekt-Wurzel: photos, signs, tourmap_signs, reiseroute, reiseroute_signs
- Animator: timeline_events, keyframes_enabled, render_start_anchor, render_end_anchor,
  timeline_*_v, manual_cam, static_zoom, trim_*, extra_tours, ghosts, ghost_gpx_path,
  gruppen, tempo_eintraege, tours_ablauf, tours_dezent, tours_dot_haupt, tours_fokus,
  tours_haupt_start_s, tour_colors, etappe1_dauer_s, etappe1_name, charts,
  track_color_stops, signs, photos, last_save_dir, open_sections, collapsed_sections
- Tour-Map: static_zoom, static_bearing, static_padding, static_pins, manual_cam,
  keyframes_enabled, signs, photos, last_save_dir, open_sections, collapsed_sections
- Daten-Animator: trim_start, trim_end, waypoints, wp_hidden, wp_sources, last_save_dir
- Geotagger: last_photos_dir, last_photos_paths, open_sections, collapsed_sections
- Web-Karte: tracks

### 2.2 Speicherung

`Bibliothek/vorlagen.json`:

```json
{"schema": 1,
 "vorlagen": {"<id>": {"id", "name", "created_at", "modified_at", "quelle": "<Projektname>",
                       "module": {"animator": {…}, "tourmap": {…}, "geotagger": {…},
                                  "heightanim": {…}, "webkarte": {…}}}},
 "standard": "<id>"}
```

- **„Reisezoom-Standard“** (`id = reisezoom-standard`) wird nicht gespeichert, sondern bei
  jedem Laden aus `DEFAULT_SETTINGS` erzeugt: nicht löschbar, nicht umbenennbar, nicht
  überschreibbar.
- **„Mein Standard“** ist der Stern (`standard`): die Vorlage, mit der jedes neue Projekt
  startet — beim Öffnen eines Tracks, beim Übergeben einer Sammlung, bei „Neues Projekt“
  ohne andere Wahl. Ohne Stern gilt Reisezoom-Standard.
- Die bisherigen **eigenen Standardwerte** (`settings.json["user_defaults"]`, v0.9.287)
  werden beim ersten Laden **einmalig** in eine Vorlage „Meine Standardwerte“ überführt,
  die den Stern bekommt; der alte Schlüssel wird entfernt. `save_user_defaults` schreibt
  ab jetzt die Stern-Vorlage (legt „Mein Standard“ an, falls der Stern auf der
  mitgelieferten liegt), `reset_user_defaults` setzt den Stern zurück.
- Der Standard-Kartenstil aus den Einstellungen („map_style_default“) gewinnt weiterhin
  gegen die Vorlage (Regel vom 04.09.2026).

### 2.3 Bedienung — vier Stellen, alle unabhängig vom Assistenten (Q21)

1. **Archiv → Reiter „Vorlagen“** neben „Touren“ und „Projekte“ (gleiche Filterzeile,
   Suche wirkt). Kacheln: Name, ★ wenn Standard, Kurzzeile (Kartenstil · Format ·
   Linienfarbe als Farbpunkt · Schrift), Datum. Knöpfe je Kachel: **★ Als Standard**,
   **➕ Neues Projekt daraus** (zuerst die Touren aus dem Archiv wählen — Marc: „muss
   direkt die auswahl der touren kommen“ —, dann Name, dann mit Track im Animator), **✎ Umbenennen**, **🗑 Löschen** (nicht bei mitgelieferter). Oben:
   **„➕ Neue Vorlage aus Projekt…“** (Projekt wählen, Name eingeben).
2. **Projekt-Kachel im Archiv**: Knopf **🧩** öffnet ein kleines Fenster mit zwei Teilen:
   „Vorlage anwenden“ (Auswahl + Knopf) und „Als neue Vorlage speichern“ (Name + Knopf).
3. **Projekt-Menü in der Kopfzeile** (der Projekt-Knopf): **„🧩 Vorlage anwenden…“** und
   **„🧩 Als Vorlage speichern…“**. „Neues Projekt“ bekommt im Namensfenster ein Feld
   **„Vorlage“**, vorbelegt mit dem Stern.
4. **Im Modul**: Animator, Tour-Map, Daten-Animator und Web-Karte haben oben in der
   Seitenleiste eine **Vorlagen-Leiste** („🧩 Vorlage anwenden…“ · 💾 „Als Vorlage speichern…“) für das laufende
   Projekt — bewusst ohne Auswahlfeld: eine Vorlage ist nur die Basis, kein Zustand.
5. **Automatisch**: jedes neue Projekt startet mit der Stern-Vorlage (siehe 2.2).

**Anwenden** überschreibt je Modul nur die Schlüssel, die in der Vorlage stehen; alles
Trackgebundene (Keyframes, Schilder, Fotos, Gruppen, Schnitt …) bleibt stehen.

### 2.4 Rückgängig (Marc: „undo muss wie immer überall gehen“)

- **Im Modul** (Kopfzeilen-Menü): Der Undo-Controller des offenen Moduls bekommt einen
  Schritt „Vorlage angewendet“ und stellt seinen Einstellungs-Block wieder her — genau
  wie jeder Regler-Schritt. Die anderen Module des Projekts werden im Hintergrund mit
  geändert; für sie sichert die App vor dem Anwenden einen **Arbeitsstand** (E3-Historie,
  ungedrosselt), sodass „Frühere Arbeitsstände“ den ganzen Zustand zurückholt.
- **Im Archiv** (Projekt-Kachel): Der Archiv-Undo (⌘Z im Archiv) stellt **alle** Module
  des Projekts auf den Stand vor dem Anwenden zurück (Brücke `projekt_module_schreiben`).
- Löschen einer Vorlage: Archiv-Undo legt sie wieder an. Stern setzen: Archiv-Undo setzt
  den vorherigen Stern.

### 2.5 Technik (Bauplan)

- `core/vorlagen.py`: `TRACKGEBUNDEN`, `MODULE`, `laden/speichern`, `liste`,
  `aus_projekt(p)`, `anlegen`, `aktualisieren`, `umbenennen`, `loeschen`,
  `standard_setzen`, `standard(daten)`, `anwenden(projekt, vorlage) -> vorher`,
  `defaults_mit_vorlage(base, vorlage)`, `migrieren_user_defaults(raw_settings)`.
- Brücken (`app.py`): `vorlagen_liste`, `vorlage_anlegen(name, project_id)`,
  `vorlage_aktualisieren(vid, project_id)`, `vorlage_umbenennen`, `vorlage_loeschen`,
  `vorlage_standard_setzen`, `vorlage_anwenden(project_id, vid)` → `{ok, vorher, nachher,
  project}`, `projekt_module_schreiben(project_id, module)` (Undo),
  `projekt_aus_vorlage_anlegen(name, vid)`; `session_create_project` bekommt `vorlage_id`.
- Neue Projekte: `_session_get_global_defaults(vorlage_id=None)` = DEFAULT_SETTINGS +
  Vorlage (Stern oder gewählte) + Standard-Kartenstil.
- UI: `ui/js/util.js` `createUndoController().applyState(state, label, before)`;
  `ui/js/vorlagen.js` (Auswahl-Fenster, Anwenden im Modul, Speichern);
  Archiv-Reiter in `modules/library/ui/module.js`; Kopfzeile in `ui/js/projects.js`.
- i18n: `vorlagen.*` in de/en/es.
- Tests: `tests/test_vorlagen.py` (Kern: Sperrliste, Standard, Migration, Anwenden lässt
  Trackgebundenes stehen), `scripts/selftest_vorlagen.py` + `tests/test_vorlagen_ui.py`
  (Reiter, Kachel-Knöpfe, Anwenden + Undo im Archiv).

## 3. Tour-Assistent — Stufe 1 (nach den Vorlagen)

Menü „Tour-Assistent…“ (⌘⇧N). Ein Fenster, drei Angaben, ein Knopf:

1. **Track**: Datei wählen oder aus dem Archiv (zuletzt importierte vorgeschlagen).
2. **Vorlage**: Auswahl, vorbelegt mit dem Stern.
3. **Projektname**: vorbelegt mit dem Tour-Namen.

Ablauf (Q3, Q13 „vielleicht fangen wir so sogar an und fügen die fotos erst im nächsten
schritt hinzu“):

1. **Track-Check** wie im Inspektor: alle roten und gelben Befunde reparieren (Lücken
   entlang der Wege nach Fortbewegungsart), Ergebnis als **neue Version** ins Archiv;
   „Ist so in Ordnung“-Befunde bleiben unangetastet.
2. **Ein Projekt** anlegen (Vorlage angewendet), alle Module gefüllt.
3. **Springen in den Animator** mit diesem Projekt.

Fortschritt als Zeilenliste im Fenster („Track geprüft: 2 Sprünge, 1 Lücke repariert“,
„Projekt angelegt“), am Ende „Im Animator öffnen“. Alles ohne Cloud.

## 4. Stufen 2–4 (beschlossen, später)

- **Stufe 2 — Fotos** (Q2, Q7, Q8, Q14 a+b+c): Fotoordner wählen; verorten wie der
  Geotagger; Auswahl in drei Schritten: Halte-Punkte des Tracks + Serien ausdünnen nach
  Zeit/Ort, dann Schärfe und Ähnlichkeit über Apple Vision (macOS; sonst nur Zeit/Ort),
  Obergrenze aus der Vorlage. Ausgewählte Fotos als Pins/Schilder in Animator und Tour-Map.
- **Stufe 3 — Highlights** (Q7): Gipfel/Pässe aus dem Track, POIs aus OpenStreetMap
  (Overpass), Namen über den Geocoder; als **Schilder** mit Foto, wenn ein Foto ≤ 200 m
  und ≤ 20 min entfernt liegt. Highlight-Arten kommen aus der Vorlage.
  **Entscheidung 11.09.2026 (Marc, nach dem Unterstand „Pilz“):** Sobald Fotos da sind (Stufe 2),
  kommen Orte mit niedrigem Rang (Unterstände, Kunst am Weg, Denkmäler, Museen, Dörfer) **nur
  mit Foto** als Schild; Gipfel, Pässe, Seen, Aussichtspunkte, Burgen und die Track-Stellen
  (höchster/tiefster Punkt, schnellste/steilste Stelle) bleiben auch ohne Foto.
- **Stufe 4 — Fotoordner überwachen** (Q2) wie die GPX-Ordner, dazu die Übersichtsseite
  (Q12).
- Nicht Teil des Assistenten: Export (Q6), Routenplanung (Nordstern-Grenze).

## 5. Stand der Umsetzung

- 11.09.2026 (Mittag): **Stufe 1 gebaut** — `Api.assistent_lauf`, `ui/js/assistent.js`, Menüpunkt
  Datei → „Tour-Assistent…“ (⌘⇧N). Abweichung: kein „zuletzt importierte vorgeschlagen“ (die
  Archiv-Auswahl ist sortiert genug); eine Datei von außen geht zuerst ins Archiv. Tests:
  `tests/test_assistent.py` (Wegwerf-Archiv), Browser-Schritt in `scripts/selftest_vorlagen.py`.
  Nicht in der echten App geprüft; Lücken-Routing braucht Netz (im Test keins → gerade gefüllt).
- 11.09.2026 (abends): **PAUSIERT, als experimentell markiert** (Marc: „an sich ganz ok, aber irgendwie gefällt es mir
  nicht … ein anderes mal weiter“). Stand und offene Ideen: docs/IDEAS.md §62.
- 11.09.2026 (später Nachmittag): **Highlights-Fenster im Animator** (Marc: „rolle das erst wieder über den
  Animator aus … komplettes Modal"): Fotoordner, Quellen, „Highlights finden", Vorschlagsliste mit Häkchen/Text,
  „Als Schilder übernehmen". Damit sind Teile von Stufe 2 (Fotos zuordnen, Serien) und Stufe 3 (Foto am Ort,
  Halt + Foto) gebaut — noch ohne Schärfe/Ähnlichkeit (Apple Vision) und noch nicht im Assistenten-Lauf.
- 11.09.2026 (Nachmittag): **Stufe 3 vorgezogen** (Marc: „lass erst mal nur POIs mit Schildern markieren") —
  `core/highlights.py`, Häkchen im Assistenten. Abweichung von §4: Schilder ohne Foto (Fotos = Stufe 2, offen);
  Highlight-Arten fest in `ARTEN`, noch nicht in der Vorlage. Praxis an vier Archiv-Touren: Gipfel mit Höhe,
  Miradores, Burg, Kunst am Weg — 1–10 Treffer je Tour in ~3 s.
- 11.09.2026: Spezifikation geschrieben. **Stufe 0 (Vorlagen) gebaut** (v0.9.689 lokal): `core/vorlagen.py`,
  Brücken, Archiv-Reiter, 🧩 auf der Projekt-Kachel, Kopfzeilen-Menü, Vorlagen-Feld bei „Neues Projekt“,
  Migration der alten `user_defaults`, Undo im Archiv und im Modul. Tests: Kern (49), Brücken (28), Browser (38).
  Stelle 4 (Marc: „Vorlagen müssen für alle module gelten wo man grafisch was baut"): Vorlagen-Leiste oben in der
  Seitenleiste von Animator, Tour-Map, Daten-Animator und Web-Karte (`rzVorlagenLeiste`: zwei Knöpfe, kein Auswahlfeld — Marc: „die Vorlage ist ja nur die Basis“). **Offen:**
  Anwenden im Modul in der echten App prüfen (nur kopflos/Mock geprüft); Block „Assistent“ (Fotoanzahl,
  Highlight-Arten) kommt mit Stufe 2/3.
