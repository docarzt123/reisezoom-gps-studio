# Changelog

Alle nennenswerten Änderungen an **Reisezoom GPS Studio** werden hier dokumentiert.

Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionsschema: [Semantic Versioning](https://semver.org/lang/de/).

Bei jeder neuen Version:
- Datum im ISO-Format (`YYYY-MM-DD`)
- Kategorien: `Hinzugefügt`, `Geändert`, `Veraltet`, `Entfernt`, `Behoben`, `Sicherheit`
- Bei Breaking Changes deutlich markieren: **⚠️ Breaking**

---

## [Unreleased]

### Hinzugefügt (Leo-Feedback)

- **Kamera-Trägheit für „Kamera folgt Track".** Neuer Regler unter dem „🚶 Kamera folgt Track"-
  Häkchen: bei 0 % klebt die Kamera hart am aktuellen Punkt (kann bei GPS-Rauschen wackeln),
  je höher, desto **weicher zieht die Kamera nach** — ruhigeres Bild wie die „Trägheit" in
  GPX-Animator. Wirkt jetzt **live in der Vorschau UND im Video** (WYSIWYG, zeitbasiert
  abgestimmt). Höhere Werte sind deutlich träger als zuvor (quadratische Kurve). Default 0 %
  (= bisheriges Verhalten unverändert).

### Behoben (Leo-Feedback)

- **Anfang/Ende abschneiden (Trim) ging im Classic-Modus nicht.** Ohne aktivierte Keyframes
  war die Timeline ausgegraut — dadurch sahen die Trim-Handles „anders aus" und ließen sich
  nicht ziehen. Der Trim (Render-Anfang/-Ende) ist aber unabhängig vom Keyframe-Modus und
  ist jetzt **in beiden Modi voll bedienbar** (praktisch zum Anonymisieren von Start/Ziel,
  z.B. der Heim-Adresse).
- **„Kamera folgt Track" stürzte beim Rendern ab** (`'TrackPoint' object is not subscriptable`).
  Dieselbe Falle wie früher im Haupt-Render-Loop war im **Tile-Cache-Vorwärmen** übersehen
  worden (Tupel-Zugriff statt `.lon`/`.lat` auf das TrackPoint-Objekt). Jetzt rendert „Kamera
  folgt Track" wieder durch.

## [0.9.274] – 2026-06-13

### Behoben (Beta-Tester-Feedback)

- **Windows: kein extra Konsolenfenster mehr.** ExifTool (und ffmpeg) wurden unter
  Windows mit einem sichtbaren CMD-Fenster gestartet, das dauerhaft offen blieb. Jetzt
  laufen sie unsichtbar im Hintergrund (`CREATE_NO_WINDOW` für exiftool-Daemon + alle
  ffmpeg-Aufrufe in Geotagger, Animator und Höhen-Animator).
- **Schwarze Karten-Vorschau beim Reinzoomen.** Wenn man einen Tick zu weit hineinzoomte,
  wurde die Vorschau schwarz (Satellit hat in abgelegenen Gegenden oberhalb ~Zoom 18 keine
  Kacheln). Der maximale Zoom ist jetzt auf 18 begrenzt (Karte + Animator-Zoom-Regler) →
  der schwarze Zustand ist nicht mehr erreichbar.

### Geändert

- **Linux: aus Quellcode statt fertigem Binary (Beta-Tester-Bug).** Das gefrorene Linux-Binary
  startete nicht (pywebview fand keine GTK-/Qt-Bindings — die lassen sich nicht zuverlässig
  ins PyInstaller-Bundle packen). Da das Projekt jetzt Open Source ist, läuft Linux sauber
  **direkt aus dem Quellcode**: System-Pakete (GTK/WebKit + ffmpeg + ExifTool) + `python app.py`.
  Anleitung in README und USER_GUIDE. Das Linux-Binary entfällt aus der Release-Pipeline;
  macOS & Windows bleiben fertige Builds.

### Hinzugefügt

- **Reisezoom-Links in der App.** Oben rechts in der Titelleiste gibt es jetzt einen
  **▶ YouTube**- und einen **🌐 Blog**-Button (reisezoom.com), und der **Über**-Dialog
  zeigt beide prominent. So findet man leicht zu Marcs Kanal und Blog.
- **Open Source (GPLv3).** Das Projekt bekommt eine **LICENSE** (GNU GPLv3) und eine
  öffentliche **README** — Reisezoom GPS Studio wird freie Software.

### Behoben (Schilder)

- **Farb-Picker im Schild-Editor wieder klar sichtbar.** Die kleinen Farb-Quadrate hatten
  keinen Rahmen — bei einer dunklen Farbe (z.B. Sprechblase-Hintergrund) verschwand das
  Quadrat optisch im dunklen Editor und es wirkte, als gäbe es **gar keinen Color-Picker**.
  Jetzt haben alle Farb-Felder (Hintergrund, Rahmen, Text, Schatten) einen sichtbaren Rahmen.

### Geändert (Schilder — Farbsteuerung vereinfacht, Beta-Tester-Feedback)

- **Nur noch EINE Farbe: „Hintergrund".** Die verwirrende Doppelung aus **Akzentfarbe** +
  **Hintergrund** (die technisch beide dieselbe Fläche füllten) ist aufgelöst. Es gibt jetzt
  genau einen **„Hintergrund"-Picker** = die Box-/Blasenfarbe des Schilds, plus die Option
  **„Keine"** (transparent, für Bilder ohne Rahmen). **Akzentfarbe** und der **„Auto"-Knopf**
  sind **entfernt** — der Picker zeigt direkt die wirksame Farbe (kein verstecktes „Auto" mehr).
  Der **Stecknadel-Tropfen** folgt ebenfalls dieser einen Farbe. (Die **Textfarbe** behält ihren
  „Auto"-Knopf — dort heißt das „automatischer Kontrast zum Hintergrund", ein anderer Zweck.)

## [0.9.269] – 2026-06-12

### Hinzugefügt (Schilder — Beta-Tester-Feedback)

- **Hintergrund „Keine" (transparent) bei Schildern.** Im Schild-Editor lässt sich der
  Hintergrund jetzt neben „Auto" auch auf **Keine** stellen → die Schild-Box wird komplett
  transparent (kein farbiger „Akzent-Rahmen" mehr ums Bild, kein Box-Schatten). Damit
  verschwindet der **doppelte Rahmen** bei Bild-Schildern: nur noch das Foto + optionaler
  Rahmen. Wirkt in Vorschau (DOM) und Render (GPU) identisch. i18n de/en/es.

### Hinzugefügt (GPX-Inspektor — Beta-Tester-Feedback)

- **Zeitstempel beim Klick auf einen Track-Punkt.** Klick auf einen Punkt (Anker A)
  zeigt jetzt Index, **Uhrzeit (lokal)** und Höhe in der Auswahl-Zeile. Bei A+B
  zusätzlich die **Dauer** zwischen den beiden Ankern.
- **Track auf Straße/Weg legen — zwei Wege:**
  - **Strecke A→B (Straße folgen)** — findet die echte Straßen-/Wege-**Route** zwischen
    Anker A und B (Mapbox Directions). A/B werden auf die nächste Straße gesnappt, dazwischen
    geroutet → **robust gegen jede GPS-Drift, kein 50-m-Limit**. Ideal für einen Abschnitt,
    der einem Weg folgt.
  - **Ganzen Track snappen** — Mapbox **Map Matching** über die komplette Spur (folgt der
    Form der Spur, hält sich an nahe Wege). Mit **Snap-Radius** (5–50 m, Slider; Mapbox-
    Limit 50). Tracks > 100 Punkte werden automatisch in Stücke zerlegt.
  - Beide: Profil-Auswahl (Fuß/Rad/Auto), Zeit + Höhe über die neue Länge verteilt, voll
    **undo-bar**, ehrliche Meldung wenn kein Weg/keine Route in der Nähe. Die **Strecke A→B**
    wird zusätzlich auf die typische Punktdichte des Tracks **nachverdichtet** und mit der
    **Durchschnittsgeschwindigkeit** des Abschnitts neu getaktet (statt in die alte A→B-Zeit
    gequetscht) → im Animator stimmt die Geschwindigkeit; nachfolgende Zeitstempel werden
    konsistent mitverschoben. Nur für weg-/
    straßenbasierte Tracks sinnvoll (bei Querfeldein kann es die Spur verfälschen).

### Behoben (Schilder im Render)

- **Stangen-Länge (Banner/Wegweiser) wirkt jetzt auch im fertigen Video.** Der neue
  `decoScale`-Slider wurde nicht an den Render durchgereicht → der Export nahm immer
  den Default (0,5), egal was im Editor eingestellt war. Jetzt steht `decoScale` in
  `signs_for_render` → Render = Vorschau (WYSIWYG).

### Behoben / Geändert (Reiseroute + Track-Schatten — Beta-Tester/Marc-Feedback)

- **Reiseroute funktioniert wieder (SSL-Zertifikats-Fix) — der eigentliche Bug.**
  Im gebündelten App-Build fand Pythons OpenSSL die CA-Zertifikate nicht → JEDER
  HTTPS-Call (Mapbox Geocoding **und** Directions) starb mit `CERTIFICATE_VERIFY_FAILED:
  unable to get local issuer certificate`. Auf dem Entwickler-Mac fiel das nicht auf
  (System-Zertifikate vorhanden), bei Beta-Tester schon. Fix: `core/route.py` nutzt jetzt
  explizit das `certifi`-CA-Bundle (ist via `requests` mitgebündelt, `cacert.pem` liegt
  im App-Bundle). Mit Beta-Testers Koordinaten verifiziert (1537 Routenpunkte über das
  certifi-only-Bundle).
- **Reiseroute: klare Fehlermeldung statt pauschal „Start fehlt".** Bisher zeigte die
  Routenberechnung bei JEDEM Problem (Adresse nicht gefunden, Geocoding-Fehler,
  Netz-/Token-Problem) „Start fehlt — Adresse eingeben…" → irreführend (Beta-Tester-Bugreport
  v0.9.252). Jetzt pro Feld die echte Ursache: „Adresse nicht gefunden", „Adresssuche
  fehlgeschlagen (Internet/Token prüfen)" inkl. Detail, oder Token-Hinweis. (Backend
  Geocoding/Directions/Flugbogen mit Token verifiziert — funktionieren.)
- **Track-Schlagschatten in den Grundeinstellungen deutlich sichtbarer.** Der Schatten
  unter der Spur war im Default zu dezent; jetzt dunkler (Deckkraft 0,55 → 0,70) und
  breiter (×1,6 → ×2,2) — in Vorschau, Render und Alpha-Export.

### Hinzugefügt (Schilder)

- **Auslöse-Zeitpunkt manuell festnageln** (löst Hin-und-zurück-Mehrdeutigkeit). Im
  Schild-Editor unter „Verhalten & Timing" ein neuer Block **„Auslöse-Zeitpunkt"**:
  Scrubber auf den gewünschten Moment schieben → **🕐 „Auf Zeitleisten-Position"** →
  das Schild ist fest an diese Track-Stelle gebunden (`timeAnchor`), unabhängig davon,
  dass der Ort räumlich doppelt vorkommt. **„Auto"** stellt auf Positions-Erkennung
  zurück. WYSIWYG — Render und Vorschau ehren `timeAnchor` beide. (Bisher nur bei
  Foto-Schildern automatisch via Aufnahme-Zeit.)
- **Stangen-Länge einstellbar** (`decoScale`, Default 50 %) — Slider im Schild-Editor,
  nur bei **Zielbanner** und **Wegweiser** sichtbar. Steuert die Länge der Pfosten/
  Stange als Faktor der Box-Höhe; wirkt in Vorschau **und** Export.

### Geändert (Schilder — Render-Architektur: Hybrid DOM/GPU)

- **Schilder rendern jetzt modusabhängig** — die Architektur löst den alten Zielkonflikt
  „Flackern beim Editieren" ↔ „Schwimmen bei Kamerafahrt":
  - **Beim Editieren** (Editor offen): echte **HTML-Marker** (neu `ui/js/sign_dom.js`),
    Aussehen via CSS am stehenden Element → Größe/Ecken/Rahmen/Schatten/Text ändern
    **flackerfrei** (kein Neu-Rastern, kein Re-Upload). Die Kamera steht beim Editieren
    → kein Schwimmen.
  - **Bei Probelauf / Export / Ruhe:** **GPU-Symbol-Layer** (gerastertes Canvas-Bild,
    `sign_draw.js`) wie die Foto-Pins → flüssige Kamerafahrt ohne Schwimmen.
  - Umgeschaltet wird automatisch beim Öffnen/Schließen des Editors bzw. Probelauf-Start.
  Der **Export war immer GPU** → die Probelauf-Vorschau ist damit weiterhin WYSIWYG.

### Behoben (Bild-Schilder — Beta-Tester-Feedback)

- **Bild bleibt beim Bearbeiten erhalten.** Das gecachte Bild-Element ist intern
  non-enumerable und ging beim Übernehmen einer Einstellungs-Änderung (Ecken, Text …)
  verloren → das Bild verschwand. Es wird jetzt über den Neubau gerettet. (War auch
  die eigentliche Ursache des Flackerns: das Bild wurde bisher bei jeder Änderung
  weggeworfen und async neu geladen.)
- **Kein Flackern mehr beim Bearbeiten von Schildern.** Beim Ziehen der Slider
  (Bildgröße, Ecken, Rahmen, Schatten …) wurde bisher das komplette Karten-Symbol
  inkl. Layer + Quelle abgerissen und neu aufgebaut → sichtbares Flackern. Jetzt
  werden Änderungen live in-place angewendet (nur das Icon-Bild + die Quell-Daten),
  Layer/Quelle bleiben stehen.
- **Rahmen umschließt das Bild wieder vollständig.** Bei hoher Rahmenstärke war der
  Rahmen schmaler als das Bild (Bild lag über dem inneren Rahmenteil). Der
  Innenabstand wächst jetzt mit der Rahmenstärke mit.
- **Schlagschatten-Stärke wirkt jetzt auch ohne Weichheit.** Bei geringer Weichheit
  klebte der Schatten hinter der Box und war unsichtbar; der vertikale Versatz ist
  jetzt größer, sodass die Stärke sofort sichtbar ist.
- **Probe-Lauf der Route respektiert das Schild-Timing.** Ein gerade bearbeitetes
  Schild bzw. der „Alle Schilder zeigen"-Modus blieb beim Probe-Lauf dauerhaft
  sichtbar (Ein-/Ausblenden schien wirkungslos). Beim Start eines Probe-Laufs werden
  diese Force-Modi jetzt zurückgesetzt, sodass das echte Timing greift.

### Behoben (Animator-Schilder + Reiseroute-Projekte)

- **Schild „Ausblenden nach N Sekunden" greift jetzt auch im Hold-Bereich.**
  Bisher fror der Schild-Anker am Track-Ende ein, sodass ein Ausblende-Zeitpunkt,
  der in die Hold-Phase fällt, nie erreicht wurde. Jetzt läuft der Schild-Anker in
  der Hold-Phase über das Track-Ende hinaus weiter (gleiche Rate) — in Render
  **und** Probe-Lauf (WYSIWYG). Symmetrisch zum bestehenden Intro-Vorlauf.
- **Neues Projekt setzt die Reiseroute jetzt wirklich zurück** statt die alte Route
  zu übernehmen/duplizieren. `_animOnProjectChanged` stellt für die Reiseroute
  Start/Ziel + Route-Track jetzt überhaupt erst aufs neue Projekt um (fehlte
  komplett) und setzt bei einem frischen Projekt alles sauber zurück. (Außerdem
  ein vergessener Diagnose-Toast entfernt.)

### Behoben (In-App-Hilfe — Tabellen + Tastatur-Tasten)

- Der Markdown→HTML-Konverter der in-App-Hilfe (`scripts/build_user_guide_html.py`)
  kann jetzt **GFM-Tabellen** (vorher als roher `| … |`-Text dargestellt) und lässt
  `<kbd>`/`<br>` aus der Quelle durch (wurden vorher wörtlich angezeigt). Die
  Tastatur-Navigations-Tabelle & Co. sehen jetzt richtig aus, inkl. gestylter
  Tasten-Optik.


## [0.9.252] – 2026-06-11

### Geändert (Reiseroute — Label)

- Flug-Modus heißt wieder schlicht **„✈️ Flugroute"** (das „(Großkreis)" raus).
  Die Berechnung bleibt der echte Großkreis aus v0.9.251.

## [0.9.251] – 2026-06-11

### Geändert (Reiseroute — echter Großkreis statt Deko-Bogen)

- Der Flug-Modus der Reiseroute berechnet die Strecke jetzt als **echten
  Großkreis (Orthodrome)** — den kürzesten Weg auf der Kugel, genau wie echte
  Langstreckenflüge. Vorher war es eine flache Bézier-Kurve, die auf der Karte
  unrealistisch „unten rum" verlief. Jetzt wölbt sich z.B. Berlin→Orlando korrekt
  **nach Norden über den Nordatlantik** (auf der Mercator-Karte „oben rum",
  Scheitel ~55,6°N). `core/route.py`: neue `_great_circle_points()` (sphärische
  slerp-Interpolation + Antimeridian-Entwicklung), `arc_route()` nutzt sie. Modus
  heißt jetzt **„✈️ Flugroute (Großkreis)"**.

## [0.9.250] – 2026-06-11

### Geändert (Tab-Reihenfolge)

- Modul-Tabs neu sortiert: **Animator · Reiseroute · Höhen-Animator · Tour-Map ·
  Geotagger · GPX-Inspektor** (über `sort_order` in den Modul-Manifesten:
  10/20/30/40/50/60).

## [0.9.249] – 2026-06-11

### Geändert (OSM-Modus — Karten-Module klar ausgegraut)

- Im OSM-Modus (kein/abgeschalteter Mapbox-Token) zeigen **Animator, Reiseroute
  und Tour-Map** beim Öffnen jetzt direkt eine klare Meldung **„Nur mit
  Mapbox-Token"** über der Karten-Fläche (mit Button „Einstellungen öffnen") —
  statt einer nutzlosen OSM-Vorschau, die eh nicht renderbar ist. Die Karte wird
  im OSM-Modus gar nicht erst geladen. Diese drei Module sind Mapbox-only (Satellit,
  3D, Mapbox-Render-Backend); Geotagger und GPX-Inspektor funktionieren weiter
  ohne Token. Shared Helper `osmBlockOverlay()` in `ui/js/util.js`.

## [0.9.248] – 2026-06-11

### Geändert (Über-Dialog — Credits aufgeräumt)

- **ExifTool** sitzt im Open-Source-Credits-Block jetzt auf einer **eigenen
  Zeile** (war vorher in die Playwright/Chromium-Zeile gequetscht und umgebrochen).
- Credits-Text entgendert: „danke an alle Beitragenden" → **„danke für die tolle
  Arbeit"** (DE/EN/ES).

## [0.9.247] – 2026-06-11

### Hinzugefügt (Einstellungen — Karten-Engine Mapbox ↔ OSM umschalten, Test)

- Neuer Schalter im Einstellungen-Modal unter dem Mapbox-Token: **„Karten-Engine:
  OSM erzwingen (Test)"**. Aktiviert läuft die App, **als hätte sie keinen
  Mapbox-Token** — Standard-OSM-Karte, kein Satellit/3D, Video-Render deaktiviert
  (Hinweis-Modal). Der **gespeicherte Token bleibt erhalten**, wird nur nicht
  genutzt. Hauptsächlich zum Testen des OSM-Verhaltens, ohne den Token löschen zu
  müssen. Backend: globales `force_osm` in `DEFAULT_SETTINGS`,
  `_active_mapbox_token()` liefert bei `force_osm` leeren String → die ganze App
  (Karte + Render-Token) verhält sich token-los. Umschalten löst (wie ein
  Token-Wechsel) ein UI-Reload aus, damit die Map-Engine sauber neu init.

## [0.9.246] – 2026-06-11

### Behoben (Beta-Tester-Feedback — Zoom-Limit + Über-Logo)

- **Zoom-Limit:** Man konnte in der Karten-Vorschau endlos hineinzoomen, bis nur
  noch eine schwarze Fläche zu sehen war (besonders in entlegenen Outdoor-Gebieten,
  wo die Satelliten-Tiles früh enden). Jetzt ist die Vorschau begrenzt — Mapbox auf
  Zoom 20, OSM auf 19 (dort enden die Raster-Tiles). Module können das bei Bedarf
  überschreiben.
- **Über-Dialog:** Logo bekommt einen `onerror`-Fallback (falls das Icon mal nicht
  lädt, bleibt kein kaputtes Bild-Symbol stehen).

> Offen (Beta-Tester): macOS-Menü-Konvention („Über" + „Einstellungen ⌘," ins App-Menü,
> „Hilfe" nur Hilfe) + doppelter Über-Dialog — bewusst zurückgestellt (Kosmetik,
> plattformübergreifend zu lösen).

## [0.9.245] – 2026-06-11

### Geändert (Render ~10× schneller — JPEG-Frames + zentraler Qualitäts-Dialog)

- **Render-Speed:** Die Frame-Erfassung läuft jetzt standardmäßig über **JPEG
  statt PNG**. Eine Messung zeigte: der PNG-Screenshot war mit **96 % der
  Render-Zeit** der Flaschenhals (2349 ms/Frame @4K). JPEG (q92) ist
  **~16× schneller** pro Frame → der Render-Loop fällt von ~235 s auf ~24 s
  (≈ **10× schneller** insgesamt). Da das Video ohnehin verlustbehaftet zu
  H.264 codiert wird, ist q92-JPEG visuell deckungsgleich. Die Farb-Range wird
  auf Standard (yuv420p/tv) normalisiert → Output identisch zu vorher.
- **Neuer Einstellungen-Dialog „Qualität & Export"** (zentral statt verstreut in
  der Sidebar): Frame-Erfassung (JPEG schnell / PNG verlustfrei) + JPEG-Qualität,
  Video-Codec (H.264 / H.265 / ProRes 4444), Video-Qualität (CRF) und
  Encoder-Tempo. Gilt global für den Animator-Export.
- **Sidebar aufgeräumt:** Das Codec-Dropdown ist aus der Animator-Sidebar
  verschwunden (lebt jetzt in den Einstellungen). „Ohne Karte (Alpha)" bleibt als
  Stil in der Sidebar; Alpha erzwingt weiterhin automatisch ProRes 4444 mit
  verlustfreien PNG-Frames (Transparenz).

## [0.9.244] – 2026-06-10

### Geändert (GPX-Inspektor — Fadenkreuz beim Pfad zeichnen)

- Im Pfad-zeichnen-Modus ist der Mauszeiger jetzt ein **Fadenkreuz** (statt der
  Greif-Hand) — passt besser zum Punkte-Setzen und sieht sauberer aus. Wird beim
  Beenden/Abbrechen des Zeichnens wieder zurückgesetzt.

## [0.9.243] – 2026-06-10

### Hinzugefügt (GPX-Inspektor — einzelnen Punkt verschieben)

- Der **ausgewählte Punkt** (grüner Anker A, Einzel-Auswahl) lässt sich jetzt per
  **Drag auf der Karte verschieben** — z.B. um einen Punkt sauber auf den echten
  Weg zu ziehen, ohne ihn zu löschen. **Zeit und Höhe bleiben unverändert**, nur
  die Position ändert sich → die Geschwindigkeit bleibt korrekt. Per ⌘Z
  rückgängig. Bewusst nur der markierte Punkt ist ziehbar (Cursor wird zur Hand) —
  so verschiebt man auf dichten Tracks nicht versehentlich den falschen Punkt.

## [0.9.242] – 2026-06-10

### Hinzugefügt (GPX-Inspektor — Empfindlichkeit für Auto-Despike)

- Die Ausreißer-Erkennung hat jetzt einen **Empfindlichkeits-Regler** (1–10,
  Default 5). Niedrig = nur krasse Sprünge werden markiert, hoch = auch kleine
  Zacken. Der Regler steuert alle Schwellen gemeinsam (Vielfaches des mittleren
  Punktabstands, Mindest-Sprungweite, Geschwindigkeits-Limit). Wenn schon einmal
  gesucht wurde, **aktualisiert sich die Markierung live** während man den Regler
  zieht — so findet man schnell die richtige Stufe für seinen Track.

## [0.9.241] – 2026-06-10

### Hinzugefügt (GPX-Inspektor — einzelne Punkte löschen)

- Man kann jetzt **einzelne Track-Punkte** löschen: einen Punkt anklicken
  (Anker A, ohne B) → **🗑 Diesen Punkt löschen** oder einfach **Entf/Backspace**.
  Bisher ging nur „Punkte dazwischen löschen" (brauchte zwei Anker). Beides per
  ⌘Z rückgängig. Entf/Backspace löscht je nach Auswahl entweder den einzelnen
  Punkt (nur A) oder den Bereich (A+B) — feuert nicht beim Tippen in Eingabefelder.

## [0.9.240] – 2026-06-10

### Behoben (GPX-Inspektor — Punkte wieder sichtbar)

- Regression aus v0.9.239: nach Einbau der Ausreißer-Markierung verschwanden
  **alle Track-Punkte** (nur noch die Linie war zu sehen). Ursache: das
  `circle-radius` enthielt ein zoom-`interpolate` *innerhalb* eines `case` — das
  lehnt Mapbox ab, wodurch das ganze Punkt-Layer nicht angelegt wurde. Jetzt steht
  das Zoom-Interpolate wieder oben, die Spike-Vergrößerung steckt im Output pro
  Zoom-Stufe. Punkte sind wieder da, Ausreißer trotzdem dicker/orange.

## [0.9.239] – 2026-06-10

### Hinzugefügt (GPX-Inspektor — Auto-Despike: Ausreißer automatisch finden)

- Neuer Button **🔎 Ausreißer automatisch finden**: durchsucht den ganzen Track
  nach GPS-Ausreißern — Punkten, die **wegspringen und wieder zurückkommen**
  (Umweg über die direkte Verbindung der Nachbarpunkte). Erkennung ist geometrisch
  robust (funktioniert auch ohne Zeitstempel); wenn Zeit vorhanden ist, gibt es
  zusätzlich ein Geschwindigkeits-Gate (> 70 m/s ≈ 252 km/h) gegen Falsch-Positive
  bei echten scharfen Kurven. **Echte Lücken** (langer gerader Sprung ohne
  Rückkehr) werden bewusst **nicht** markiert — dafür ist „Lücke füllen".
- Gefundene Ausreißer werden **orange** auf der Karte markiert. Eine Navi-Box zeigt
  „Ausreißer 2/3", mit **‹ / Nächster ›** springt und zoomt man von einem zum
  nächsten (Anker A+B werden automatisch gesetzt — danach manuell **🩹 Heilen**
  möglich). **🩹 Alle heilen** glättet alle auf einmal (ein Undo-Schritt). Heilen
  behält die Zeitstempel → Geschwindigkeit korrigiert sich selbst.

## [0.9.238] – 2026-06-10

### Hinzugefügt (GPX-Inspektor — Rückgängig/Wiederherstellen)

- Jede Bearbeitung im GPX-Inspektor (Heilen, Lücke füllen, Pfad zeichnen & füllen,
  Punkte löschen) lässt sich jetzt **rückgängig machen** — per **⌘Z** (bzw. Strg+Z)
  oder über die neuen Buttons **↩︎ Rückgängig** / **↪︎ Wiederherstellen** in der
  Sidebar. Wiederherstellen via **⌘⇧Z** / **⌘Y**. Beim Laden eines neuen Tracks
  wird die Undo-Historie zurückgesetzt.

## [0.9.237] – 2026-06-10

### Hinzugefügt (GPX-Inspektor — „Pfad zeichnen & füllen")

- Beim Auffüllen einer Lücke kann man den Pfad jetzt **selbst auf der Karte
  zeichnen** statt nur die Luftlinie zu nehmen: Anker A+B wählen → **✏️ Pfad
  zeichnen & füllen** → Stützpunkte auf die Karte klicken (orange Vorschau-Linie
  A→Stützpunkte→B, „⤺ letzter Punkt zurück" / „✕ Abbrechen") → **✓ Pfad
  übernehmen**. Der Abschnitt wird **entlang des gezeichneten Pfads** aufgefüllt,
  Höhe und Zeit linear über die Pfad-Distanz interpoliert (Abstand wie bei der
  Luftlinien-Füllung einstellbar). Bestehendes „Lücke füllen" heißt jetzt
  „Lücke füllen (Luftlinie)".

## [0.9.236] – 2026-06-10

### Hinzugefügt (Neues Modul: 🔍 GPX-Inspektor — Track heilen, Phase 1)

> Hinweis: Karte erschien anfangs nicht (Modul-Layout kollabierte die Höhe auf 0).
> Behoben in v0.9.235/236 — das Modul nutzt jetzt das bewährte `module-body`-Grid
> (`.panel` + `.canvas`) wie alle anderen Module, plus `map.resize()`-Absicherung.


- Neues Modul **„GPX-Inspektor"** (Marc-Idee, deckt Beta-Tester-Wunsch (c) ab): zeigt
  **jeden einzelnen** GPS-Punkt des Tracks auf der Karte (voller Roh-Track, nicht
  das 800-Downsample). Man wählt zwei Anker A+B (Klick) und bearbeitet den
  Abschnitt dazwischen:
  - **🩹 Heilen** — Punkte zwischen A und B auf die direkte Linie legen (Position
    + Höhe interpoliert), **Zeitstempel bleiben** → Geschwindigkeit korrigiert
    sich von selbst (Reflektions-Spikes raus, ohne Speed/Höhe zu verfälschen).
  - **➕ Lücke füllen** — neue Zwischenpunkte einfügen (Position, Höhe **und Zeit**
    interpoliert, Abstand einstellbar) → für Tracks mit großen Lücken/Sprüngen.
  - **🗑 Punkte dazwischen löschen** + **Auswahl aufheben** + **Verwerfen**.
  - **💾 Speichern** schreibt `<name>_geheilt.gpx` neben das Original (Original
    bleibt unberührt) und lädt es gleich global → alle Module nutzen die saubere
    Version.
- Backend: `core/gpxedit.py` (`load_points` = voller Track inkl. ele+time,
  `save_points` = GPX schreiben via gpxpy), Bridges `gpxinspect_load`/`_save`.
- **Phase 2 (offen):** Auto-Despike-Vorschlag (Geschwindigkeits-Ausreißer),
  einzelne Punkte verschieben, Undo.

## [0.9.232] – 2026-06-10

### Hinzugefügt (Geotagger — manuell platziertes Foto wieder per Zeitstempel syncen, Beta-Tester-Wunsch)

- Manuell auf die Karte gezogene Fotos haben jetzt einen **↺-Button** (blau,
  neben dem roten ✕). Ein Klick **hebt die manuelle Platzierung auf** und matcht
  das Foto wieder über seine **Aufnahmezeit** gegen den Track — ohne es löschen
  und neu importieren zu müssen. Erscheint nur bei aktuell manuell platzierten
  Fotos. (`_gtResyncPhoto`: `_gtManual.delete()` + `updateMatches()`.)

## [0.9.231] – 2026-06-10

### Behoben (Reiseroute — „fein" war heimlich grob, Fußwege wurden zum Strich)

- **Detailgrad-Slider:** Auf der „fein"-Stellung (Wert 0) wurde wegen eines
  JS-Falsy-Zero-Bugs (`parseFloat(...) || 55`) in Wahrheit **coarseness 0.55**
  (der „grob"-Default) gesendet — `0` ist in JS falsy, also griff `|| 55`. Dadurch
  vereinfachte „fein" die Route mit ~3,3 km Toleranz; bei „zu Fuß" (ohnehin
  gröbere Mapbox-Geometrie) wurde die Strecke quasi ein gerader Strich. Jetzt
  `isNaN`-Guard → „fein" sendet echtes 0 → Route folgt jeder Kurve. Betraf
  Berechnen **und** Speichern des Detailgrads.

## [0.9.230] – 2026-06-10

### Behoben (Windows — GPX-Drag löste „Öffnen mit…"-Shell-Dialog aus, Bug-Report Peter Straka)

- **Datei-Drag&Drop auf Windows abgeschaltet.** Ursache: WebView2 (Edge) fängt
  einen Datei-Drop auf Control-Ebene ab (`AllowExternalDrop`, Default true) —
  noch vor dem DOM-`drop`-Handler. Da `.gpx` keine Web-Zuordnung hat, wirft
  Windows die Shell-Frage „Wählen Sie eine App…"; `preventDefault()` im JS
  greift zu spät. Fix: `EdgeChrome.on_webview_ready` wird (nur win32) gepatcht
  und setzt `AllowExternalDrop = False` → kein Shell-Dialog mehr, Drop läuft ins
  Leere. **Auf Windows lädt man GPX über den „Öffnen"-Button** (funktioniert
  unverändert). macOS/Linux: Drag&Drop bleibt voll funktionsfähig. Defensiv —
  schlägt der Patch fehl, bleibt das alte Verhalten (kein Crash).

## [0.9.229] – 2026-06-10

### Behoben / Geändert (Windows-Bug-Report Peter Straka v0.9.162)

- **Render-Engine (Chromium) wird jetzt MIT-GEBÜNDELT** (macOS + Windows) — kein
  Download mehr beim 1. Render, läuft out-of-box. Vorher musste Chromium beim
  ersten Render heruntergeladen werden; im Tour-Map-Modul war der Hinweis dazu
  verwirrend („geh in den Animator") und Peter kam nicht weiter. Umsetzung:
  `pw-browsers/` wird im Build befüllt (build.sh / release.yml), die `.spec`
  backt es ins Bundle, `app.py` setzt `PLAYWRIGHT_BROWSERS_PATH` zur Laufzeit auf
  den gebündelten Pfad (`sys._MEIPASS/pw-browsers`), Exec-Bit wird abgesichert.
  Linux: weiterhin Download-Fallback (Marc-Regel „Linux = Doku"). App ~190 MB
  größer.
- **Gemeinsamer Render-Engine-Guard** (`ui/js/util.js` `showRenderEngineMissingModal`):
  Animator, Tour-Map UND Höhen-Animator zeigen bei (theoretisch) fehlendem
  Browser jetzt **dasselbe** Download-Modal statt drei verschiedener Fehlerpfade.
  Behebt Peters Verwirrung und verhindert künftige Divergenz (Marc-Architektur-
  Hinweis). Greift als Sicherheitsnetz bei korruptem/fehlendem Bundle.
- **Start-Crash** `mkdir … Pictures\Reisezoom Tour Maps` (OneDrive: `Pictures`
  physisch nicht da): war bereits durch `parents=True, exist_ok=True` auf allen
  Start-Verzeichnissen behoben — kommt mit diesem Release zum User.
- Credits: **Chromium** (BSD-3-Clause) als gebündelte Render-Engine im About-Dialog ergänzt.

## [0.9.228] – 2026-06-10

### Hinzugefügt (Stats-Overlays — Zeitfenster pro Box, „ab Sek X bis Sek Y", Beta-Tester-Wunsch)

- Jede Overlay-Box (**Gesamt**, **Live**, **Höhenprofil**) hat jetzt in der
  Sidebar ein **⏱ Zeitfenster**: zwei Felder „ab … s" und „bis … s" (in
  Video-Sekunden, intro + anim + hold). Box wird nur in diesem Fenster
  eingeblendet. Leer / 0 = ab Start bzw. bis Ende → unverändert wie bisher.
- **Render:** `window.__overlayTiming(videoSekunde)` blendet die Boxen pro Frame
  ein/aus (`core/animator.py`, neuer `render_scale`-unabhängiger Helper). Nur
  aktiv wenn überhaupt ein Fenster gesetzt ist (kein Perf-Overhead sonst).
- **Probelauf-WYSIWYG:** die Vorschau-Boxen blenden im Probelauf nach derselben
  Logik ein/aus (`_animOverlayTimingPreview`), damit man's vor dem Rendern sieht.
- Pro Modul + projekt-bewusst gespeichert (`overlay_*_from_s`/`_to_s`).

## [0.9.227] – 2026-06-10

### Entfernt (Keyframe-Timeline — Marker- + Foto-Spuren raus)

- Die beiden Reserve-Spuren **„Marker" (🏷)** und **„Foto" (📷)** in der
  Keyframe-Timeline entfernt (Animator + Reiseroute). Schilder und Fotos werden
  längst über ihr eigenes **„Schilder und Fotos"-System** gesetzt, nicht über
  Keyframe-Events → die Spuren waren leer und kosteten nur vertikalen Platz.
  Timeline ist jetzt kompakter. (`ui/js/timeline.js` `LANES`, `ui/css/timeline.css`.)

## [0.9.226] – 2026-06-10

### Behoben (Reiseroute — Start/Ziel + Keyframes wurden nach Neustart nicht wiederhergestellt)

- **Scope-Bug (Kern-Ursache, v0.9.222):** Die Restore-Funktionen
  `_routeRestore`/`_routeRestoreGpx` leben im `whenApiReady()`-Closure, der
  `onGpxLoaded`-Handler aber eine Scope-Ebene höher → die Aufrufe waren stille
  `ReferenceError`s (vom `try/catch` verschluckt), d.h. der Restore lief **nie**.
  Behoben über Modul-Scope-Handles (`_rrRouteRestoreFn`/`_rrRouteRestoreGpxFn`),
  die im Closure gesetzt werden. Zusätzlich robuster Restore-mit-Retry
  (`_reiserouteRestoreWithRetry`, v0.9.221): pollt nach dem GPX-Laden, bis das
  aktive Projekt wirklich Reiseroute-Daten hat **und** die Funktionen bereit
  sind, dann einmalig alles wiederherstellen (Start/Ziel, Karten-Beschriftungen,
  Ghost, Route-Track + Keyframes). `applyGlobalGpx` im Handler abgesichert
  (v0.9.220), damit ein Ghost-Fehler den Restore nicht mehr abbricht.

### Behoben (Render — 1. Frame mit falscher Zoomstufe in Reiseroute / Animator nach Neustart)

- **v0.9.223:** Beim Rendern wurde `hasKfs` (gibt es echte Keyframes?) aus dem
  falschen Speicher (`_settingsCache`) gelesen. Nach einem Neustart liegen die
  Keyframes im **aktiven Projekt**, `_settingsCache` ist leer → `hasKfs` war
  fälschlich `false` → der Classic-Snapshot-Zweig überschrieb die echten
  Zoom-Keyframes mit dem aktuellen Karten-Zoom. Jetzt projekt-bewusst über
  `getTimelineEvents()`. Betraf auch den Animator nach Neustart.

### Behoben (Render — Schilder + Foto-Pins im 4K-Render kleiner als in der Vorschau)

- **v0.9.224/225 (WYSIWYG):** `icon-size` ist in CSS-px; der Render-CSS-Viewport
  (z. B. 1920 px bei 4K) ist breiter als die ~800 px-Vorschau → gleiche
  CSS-Größe wirkt im Render kleiner. Neuer `render_scale`
  (= Render-Breite/Vorschau-Breite, identisch zur Linienstärken-`lineScale`)
  wird in die `icon-size`-Stützwerte der Schilder und in den Foto-Pin-Faktor
  gerechnet. **Wichtig:** NICHT außen `['*', s, interpolate]` (verletzt Mapbox'
  „`['zoom']` muss top-level"-Regel → Layer verworfen → gar kein Schild), sondern
  in die OUTPUT-Werte. Probelauf bleibt 1.0 (unverändert).

## [0.9.216] – 2026-06-09

### Behoben (Reiseroute — Einstellungen wurden in die falsche Session gespeichert)

- **Karten-Beschriftungen (Orte/Straßen/POI …), Ghost-Einstellungen und
  Start/Ziel bleiben jetzt erhalten.** Eigentliche Ursache: das Laden der
  *berechneten Route* aktivierte eine Session anhand der Route-Koordinaten und
  bog damit die aktive Session vom geladenen GPX (der Wanderung) auf die Route
  um → alle Reiseroute-Einstellungen landeten in der falschen Session und gingen
  verloren. Jetzt aktiviert die berechnete Route keine eigene Session mehr (die
  Session bleibt die der geladenen Wanderung), und beim GPX-Laden werden alle
  Einstellungen sauber wiederhergestellt (`rebindAllSettings`).

## [0.9.215] – 2026-06-09

### Behoben (Reiseroute — 3 Bugs)

- **Start/Ziel + GPX-Ghost-Einstellungen werden nach Neustart nicht mehr
  vergessen.** Ursache: das Modul mountet beim App-Start, BEVOR das letzte GPX
  (und damit die Projekt-Settings) async geladen ist → das Wiederherstellen lief
  ins Leere. Jetzt wird Start/Ziel + Ghost + die letzte Route nachgeholt, sobald
  die Session geladen ist (`onGpxLoaded`).
- **Keine Stats-Overlays mehr im Reiseroute-Modul.** Die Overlay-Sektion ist dort
  entfernt; die Vorschau interpretierte die fehlenden Checkboxen als „an" und
  zeigte die Overlays trotzdem. Vorschau + Render erzwingen jetzt: in Reiseroute
  keine Overlays (+ null-sichere Reads).

## [0.9.214] – 2026-06-09

### Geändert (Reiseroute — geschwungene Route + Start/Ziel gespeichert)

- **„Grob" macht jetzt eine geschwungene Linie statt eckiger Geraden.** Die
  vereinfachte Strecke wird über einen Catmull-Rom-Spline gelegt → fließende
  Kurve, die sich grob an der Route orientiert (vorher: eckige Segmente).
- **Start/Ziel + Route-Einstellungen werden im Projekt gespeichert** und beim
  Neustart wiederhergestellt — inkl. der zuletzt berechneten Route (der animierte
  Track ist sofort wieder da, ohne neu zu berechnen).

## [0.9.213] – 2026-06-09

### Geändert (Reiseroute — „grob" reicht viel weiter)

- **Der Detailgrad-Slider kann jetzt viel gröber** (Vereinfachungs-Toleranz von
  ~600 m auf ~6 km erhöht) — bei hohem Wert wird die Route fast gerade.

## [0.9.212] – 2026-06-09

### Behoben (Reiseroute zeigte die Animator-Schilder)

- **Schilder/Fotos sind jetzt pro Modul getrennt.** Reiseroute hatte
  fälschlich die Schilder des Animators übernommen (beide lagen am Projekt-Root
  `signs`). Jetzt hat Reiseroute eigene Schilder (`reiseroute_signs`); der
  Animator behält seine unter `signs` (bestehende Projekte unverändert).

## [0.9.211] – 2026-06-09

### Hinzugefügt/Geändert (Reiseroute — GPX-Ghost konfigurierbar)

- **Neue Sektion „👻 GPX-Ghost"** in der Reiseroute-Seitenleiste mit allen
  Einstellungen für die Ghost-Linie: **anzeigen** (an/aus), **Farbe**,
  **Deckkraft**, **Linienbreite**, **gestrichelt** (an/aus). Wirkt live in der
  Vorschau und im gerenderten Video.
- **Stats-Overlays sind im Reiseroute-Modul raus** (dafür ist dort jetzt der
  GPX-Ghost). Im Animator bleiben die Overlays unverändert.

## [0.9.210] – 2026-06-09

### Hinzugefügt (Reiseroute Phase 2 — geladenes GPX als Ghost, Route animiert)

- **Im Reiseroute-Modul ist das geladene GPX (z.B. die Wanderung) jetzt ein
  Ghost** (schwache, gestrichelte Hintergrund-Linie), und **animiert wird die
  berechnete Route** statt des GPX. So lässt sich die Anreise als Intro bauen,
  mit der Wanderung sichtbar als Ziel/Kontext.
  - Das geladene GPX bleibt global unangetastet (Animator/Tour-Map zeigen weiter
    die Wanderung) — die Route wird im Reiseroute-Modul lokal als animierter
    Track geladen.
  - Ghost erscheint in Live-Vorschau **und** im gerenderten Video
    (Tab-Beschreibung „Reiseroute" in den Tabs nachgetragen).
  - Hinweis (v1): Die berechnete Route lebt im Speicher — nach einem Tab-Wechsel
    weg und zurück muss sie neu berechnet werden (das Ghost-GPX bleibt).

## [0.9.209] – 2026-06-09

### Behoben (Zoom-Sprung beim Probelauf eines frisch geladenen Tracks)

- **Der Probelauf springt nicht mehr auf einen zu nahen Zoom**, wenn ein Track
  frisch geladen ist und noch kein Zoom gewählt wurde. Bisher fliegt der
  Klassik-Modus-Probelauf auf den Default-Zoom (`static_zoom=12`), obwohl die
  Karte den ganzen Track (weiter herausgezoomt) zeigt → sichtbarer Sprung.
  Jetzt wird der Zoom-Slider nach dem Auto-Fit auf den Fit-Zoom gesetzt, solange
  der User für das Modul keinen eigenen Zoom gewählt hat. Fiel vor allem im
  neuen **Reiseroute**-Modul auf (eigener, anfangs leerer Settings-Namespace).
  Getunte Projekte und der Keyframe-Modus bleiben unverändert.

## [0.9.208] – 2026-06-09

### Geändert (Reiseroute-Modul — eigene Settings, Route raus aus Animator)

- **Reiseroute hat jetzt einen eigenen Settings-Namespace** — Animator und
  Reiseroute teilen sich nichts mehr (Keyframes, Dauer, Stil, Overlays,
  Akkordeon-Zustand, Undo alles getrennt: `_activeProject.animator` vs.
  `_activeProject.reiseroute`). Umgesetzt rein über den DRY-Modul-Key (`_MODKEY`),
  ohne Code zu doppeln — der Animator-Code bleibt eine einzige Quelle.
- **„Route / Anreise"-Sektion ist nur noch im Reiseroute-Modul**, nicht mehr im
  Animator.
- **Detailgrad-Slider umbenannt** (vorher „Grobheit"): heißt jetzt „Detailgrad"
  mit klaren Endpunkt-Labels **fein → grob**.

## [0.9.207] – 2026-06-09

### Hinzugefügt (neues Modul „Reiseroute" — Phase 1: DRY-Klon)

- **Neuer Tab „🛣 Reiseroute"** — ein voller Klon des Animators für Anreise-/
  Flug-Animationen. Technisch ist es **dieselbe `mountAnimator`-Funktion**, nur
  mit `mode:"reiseroute"` ein zweites Mal registriert — kein doppelter Code,
  Änderungen am Animator wirken automatisch im Reiseroute-Modul mit. Eigener
  Tab-State-Cache + Undo pro Tab. (v1 teilt sich den Projekt-Settings-Namespace
  mit dem Animator.)
- **Phase 2 (folgt):** das geladene GPX wird als **Ghost** angezeigt, und es
  wird die **Route** animiert statt des GPX.

## [0.9.206] – 2026-06-09

### Behoben / Geändert (Animator — Route „Straße folgen")

- **Kein Ruckeln mehr bei groben Routen.** Die berechnete Strecke wird jetzt
  immer auf ~500 gleichmäßig verteilte Punkte **nachverdichtet** — der Marker
  gleitet flüssig, auch wenn die Linie absichtlich grob ist. (Vorher animierte
  er über die wenigen Mapbox-Stützstellen → sichtbares Springen.)
- **„Grobheit"-Slider** (0–100 %) statt der Checkbox „Grobe Strecke": steuert,
  wie stark die Route optisch vereinfacht wird (eigenes Douglas-Peucker statt
  nur Mapbox' simplified/full). 0 % = folgt jeder Kurve, 100 % = fast gerade
  Etappen. Die Animation bleibt dabei immer flüssig (Nachverdichtung ist
  davon entkoppelt).

## [0.9.205] – 2026-06-09

### Hinzugefügt (Animator — Route / Anreise: Strecke aus Start + Ziel)

- **Neue Sektion „🛫 Route / Anreise"** in der Animator-Seitenleiste: Start und
  Ziel angeben → daraus wird eine Strecke berechnet und als synthetisches GPX
  geladen, das wie jeder andere Track animiert wird (Kamera-Flug, Schilder,
  Ghost-Track, Render — alles inklusive). Weil das GPX global gesetzt wird,
  sehen Tour-Map und Höhen-Animator dieselbe Strecke.
  - **Zwei Stile (umschaltbar):**
    - **🛣️ Straße folgen** — Mapbox Directions API, folgt echten Straßen.
      Profile **Auto / Zu Fuß / Fahrrad**. Schalter **„Grobe Strecke"**
      (`overview=simplified`) für eine bewusst vereinfachte Linie statt
      kleinteiliger Wander-Genauigkeit.
    - **✈️ Flug-Bogen** — abstrakter geschwungener Bogen direkt Punkt→Punkt
      (Bézier-Kurve, kein API-Call), wie eine Airline-Karte. Gut für weite
      Distanzen.
  - **Start/Ziel eingeben:** als **Adresse/Ort** (Mapbox Geocoding) ODER per
    **📍 Klick auf die Karte** ODER als `lat,lon`-Koordinaten.
  - Bei Straßen-Routen wird die geschätzte **Fahrtzeit** als Zeitstempel ins
    GPX geschrieben (Stats-Overlay zeigt sie). Status-Zeile meldet
    Distanz + Dauer nach dem Berechnen.
  - Backend: neues Modul `core/route.py` (Directions / Geocoding / Flug-Bogen /
    GPX-Schreiben), Bridges `route_compute` + `route_geocode` in `app.py`.
    Routen-GPX landen in `<App-Support>/routes/`. Token = bestehender
    Mapbox-Token aus den Einstellungen.

## [0.9.204] – 2026-06-09

### Behoben (Animator — Schild-Vorlauf reicht jetzt ins Intro)

- **Ein Schild am Track-Anfang mit „Vorlauf" (`before`) erscheint jetzt im
  Intro** statt erst aufzuploppen, wenn der Track losläuft. Bisher war der
  Einblende-Anker bei `−0.001` nach oben geklemmt und der Marker fror im Intro
  bei Anker `0` ein → der Vorlauf hatte keinen Platz nach hinten und ein
  eingestelltes Einblenden lief erst beim Track-Start. Jetzt bekommt der
  **Schild-Filter** im Intro einen negativ laufenden Anker
  (`−intro_s/anim_s → 0`), sodass `Vorlauf = N s` die Einblendung genau N
  Sekunden vor Track-Start (= in der letzten Intro-Sekunde) abspielt.
  `Vorlauf = 0` → Schild erscheint exakt am Track-Start (kein Intro-Auftritt),
  wie bisher. Die Hold/Outro-Seite war schon korrekt (greift gratis über den
  `aHide`-Default) und bleibt unverändert. Render + Live-Preview gespiegelt.

## [0.9.203] – 2026-06-08

### Behoben (Animator — Foto-Timing über die Aufnahmezeit)

- **Fotos erscheinen jetzt zur richtigen Zeit im Video** — auch auf Runden/
  Hin-und-Rück-Strecken. Bisher wurde der Zeitpunkt eines Fotos über die nächste
  Track-*Position* bestimmt; auf einem Track, der denselben Ort mehrfach passiert,
  ist das mehrdeutig (Foto rutschte an die falsche Vorbeifahrt). Jetzt wird das
  Timing über die **Aufnahme-Zeit des Fotos** gegen die GPX-Zeitstempel gematcht
  (wie der Geotagger) — eindeutig. Die Karten-Position bleibt das GPS des Fotos.
- Liegt die Foto-Zeit außerhalb der Track-Zeitspanne (z.B. falsche Kamera-Zeitzone),
  wird auf den Positions-Anker zurückgefallen — kein erzwungenes Falsch-Match.
- Beim manuellen **Verschieben** eines Fotos wird der Zeit-Anker verworfen → das
  Timing richtet sich dann wieder nach der neuen Position.

## [0.9.202] – 2026-06-08

### Geändert (Animator — Verschieben klarer)

- **Verschieben besser erklärt:** Beim „↔ Verschieben" (auch für Fotos) kommt
  jetzt ein deutlicher Hinweis-Toast „Klick auf die Karte/den Track für die neue
  Position". Foto-Schilder lassen sich frei verschieben (Klick irgendwo), auch
  wenn sie eigene GPS-Daten haben — Track-Schilder rasten auf den Track.

## [0.9.201] – 2026-06-08

### Behoben (Animator — Bildgröße bei „auf alle übertragen")

- **Bildgröße wird jetzt mit übertragen + sichtbar angewendet.** Der Wert war
  zwar in der Übertragung dabei, aber die Karten-Icons der anderen Einträge
  behielten ihr altes Bild im Cache. Bei „🎨 Stil + Verhalten auf alle" werden
  jetzt alle Bild-Icons sauber neu aufgebaut → die neue Bildgröße greift sofort.

## [0.9.200] – 2026-06-08

### Geändert (Animator — „auf alle übertragen" inkl. Verhalten)

- **„🎨 Stil + Verhalten auf alle"**: der Button im Editor überträgt jetzt nicht
  nur das Aussehen, sondern auch das **Verhalten** (Vorlauf/Nachlauf, Einblendung,
  Zoom-Skalierung, „ganze Zeit zeigen") auf alle anderen Einträge. Text, Bild,
  Position und das Sichtbar-Häkchen bleiben weiterhin pro Eintrag.

## [0.9.199] – 2026-06-08

### Behoben (Foto-Import — TIFFs mit GPS)

- **TIFFs werden nicht mehr fälschlich als „kein GPS" abgewiesen.** Der
  Foto-Pin-Thumbnail-Erzeuger kannte nur JPEG/HEIC/RAW — bei TIFF (auch 16-bit)
  fiel er durch, der Import zählte das als Fehler und meldete pauschal „kein GPS",
  obwohl die Koordinaten da waren (Finder/exiftool zeigen sie). Jetzt erzeugt er
  für TIFF/PNG/BMP/WebP/GIF den Thumb direkt via PIL (RGB-Konvertierung) → Import
  klappt. Außerdem unterscheidet die Meldung jetzt „kein GPS" von „Lesefehler".

## [0.9.198] – 2026-06-08

### Geändert (Animator — Schilder und Fotos vereint, Phase B)

- **Eine Sektion „🚩 Schilder und Fotos"** statt getrennter Schilder- + Foto-Sektion.
  Ein Foto ist jetzt einfach ein Schild mit Bild — gleiches System, gleiche Liste.
- **„📷 Fotos hinzufügen"** (Ordner/Dateien/Drag&Drop): legt für jedes Foto mit
  GPS automatisch ein Schild-mit-Bild an seinen Aufnahme-Koordinaten an. Auch
  „Aus Geotagger" übernimmt die dort geladenen Fotos.
- **Kombinierte Liste mit voller Kontrolle pro Eintrag:**
  - **⠿ Ziehen** zum Sortieren (Reihenfolge),
  - **☑ Häkchen** zum Anzeigen/Ausblenden (wirkt auf Karte + Render),
  - **✎ Stift** öffnet den Editor, **✕** löscht,
  - kleines Thumbnail bzw. 🚩-Icon pro Zeile, „Alle an/aus" als Massenschalter.
- **„🎨 Stil auf alle übertragen"** im Editor: kopiert das Aussehen (Form, Farben,
  Schrift, Schatten, Größe) auf alle anderen — Text/Bild/Position/Timing bleiben.
- Erklärtext raus → **„?"-Hilfe** wie in den anderen Sektionen.
- Die alten Foto-Pins (project.photos) werden im Animator nicht mehr gezeichnet
  (bleiben nur für die Tour-Map). Keine Migration (Marc-Regel).

## [0.9.197] – 2026-06-08

### Geändert (Animator — Bild-Schild-Code verschlankt)

- **Aufräumen statt Migration:** Die in den Bugfix-Iterationen entstandene
  Backwards-Compat-Cruft (Sanitize-Block + Self-Heal-Re-Save für alt-serialisierte
  Bild-Reste) ist raus. Stattdessen ein einziger `_animSignHasImg()`-Check, der ein
  Bild nur bei echtem geladenem Pixel-Inhalt (`naturalWidth > 0`) als „da" zählt.
  Dadurch laden auch Alt-Projekte ihr Bild sauber aus dem Thumb nach — ohne
  Migrationslogik. (Keine Abwärtskompatibilität nötig — Marc-Regel.)

## [0.9.196] – 2026-06-08

### Behoben (Animator — Bild-Schild: Bild wieder sichtbar)

- **Folgefehler von 0.9.195 behoben:** Das non-enumerable Bild-Element überlebte
  den `normalize`-Spread (`{...s}`) nicht und ging auf der Zeichen-Kopie verloren
  → Schild wurde text-only gezeichnet (Bild fehlte). Das Bild wird jetzt nach dem
  Normalisieren explizit auf die Kopie übertragen. Bild-Schilder zeigen das Bild
  wieder — auch nach Projektwechsel/Neustart.

## [0.9.195] – 2026-06-08

### Behoben (Animator — „schwarzes Loch", die WAHRE Ursache)

- **Root-Cause gefunden:** Das geladene Bild-Element (HTMLImageElement) wurde am
  Schild gespeichert und beim Projektwechsel mit-serialisiert — zu einem JSON-Objekt
  `{src:"data:…"}`. Beim Reload galt dieses Objekt als „geladenes Bild", war aber
  keins → `drawImage` scheiterte → dunkle Box. (Der Thumb selbst war immer korrekt.)
- **Fix:** Das Bild-Element wird jetzt **non-enumerable** ans Schild gehängt → es
  wird von JSON/Speicherung komplett ignoriert, kann also nie mehr ins Projekt
  leaken. Beim Attach werden zusätzlich alte, bereits verseuchte Projekte
  bereinigt (Pseudo-Bild + Lade-Flags raus → Bild sauber aus dem Thumb neu laden).
- Wirkung: Bild-Schilder überstehen Projektwechsel und App-Neustart jetzt sauber;
  die `sessions.json` bläht sich nicht mehr mit serialisierten Bildern auf.

## [0.9.194] – 2026-06-08

### Behoben (Animator — Bild-Schilder)

- **„Schwarzes Loch" endgültig weg.** Ein geladenes Bild gilt jetzt nur als
  gültig, wenn es echte Pixel hat (`naturalWidth > 0`). Vorher wurde ein
  leerer/kaputter Thumb als „geladen" akzeptiert und als dunkle Box gezeichnet.
  Ist der (gespeicherte) Thumb defekt, wird er **einmal frisch via Bridge erzeugt**;
  bleibt er kaputt, wird das Schild als fehlerhaft markiert statt schwarz gezeichnet.
- **Klare Fehler-Anzeige** in der Schild-Liste: rot mit „⚠" + Tooltip — entweder
  „Bild nicht mehr gefunden" (Datei verschoben/gelöscht) oder „Bild konnte nicht
  geladen werden" (Thumb defekt).
- **Modal springt nicht mehr zurück.** Klickt man ein Schild an, dessen Editor
  schon offen ist, bleibt das (evtl. verschobene) Modal an seiner Stelle — neu
  positioniert wird nur bei einem anderen Schild.

## [0.9.193] – 2026-06-08

### Behoben (Animator — „schwarzes Loch" bei Bild-Schildern, endgültig)

- **Thumb wird jetzt mit dem Projekt gespeichert.** Vorher wurde beim Reload nur
  der Bild-Pfad gespeichert und der Thumb über die Bridge neu erzeugt — das hakte
  in der WebView und führte zum „schwarzen Loch". Jetzt liegt der Thumb (data-URL)
  im Projekt, der Reload verhält sich identisch zum Erst-Hinzufügen (zuverlässig).
- **Fehler-Anzeige bei verschobener/gelöschter Bilddatei.** Beim Laden wird
  geprüft, ob die Original-Bilddatei noch existiert (der Render braucht sie). Fehlt
  sie, wird das Schild in der Liste rot mit „⚠" markiert (Tooltip mit Pfad) und es
  kommt ein Hinweis-Toast — statt stillschweigend kaputtzugehen.

## [0.9.192] – 2026-06-08

### Behoben (Animator — „schwarzes Loch" bei Bild-Schildern)

- **Bild-Schilder zeigen nach Projekt-/App-Neustart kein schwarzes Loch mehr.**
  Der Bild-Thumb wird beim Laden async nachgezogen; in der kurzen Zwischenzeit
  wurde ein Bild-Schild (ohne Text) als leere dunkle Box gezeichnet. Jetzt wird
  ein Bild-Schild ohne geladenes Bild übersprungen (bei Text: solange Text-only)
  und erst gezeichnet, wenn das Bild da ist. Plus Fehler-Flag gegen Endlos-Retry,
  falls die Bilddatei mal nicht mehr auffindbar ist.

## [0.9.191] – 2026-06-08

### Hinzugefügt (Animator — Schilder mit Bild, Feinschliff)

- **Eigener Bildgröße-Slider.** Die Bildbreite ist jetzt vom Schrift-Größe-Slider
  entkoppelt (eigener Regler in der Bild-Gruppe, erscheint sobald ein Bild gesetzt ist).
- **Schlagschatten stärker + regelbar.** Weichheit-Slider geht weiter hoch (bis 60)
  und ein neuer **Stärke-Slider** steuert die Schatten-Deckkraft (vorher fix 55 %).

## [0.9.190] – 2026-06-08

### Geändert (Animator — Schilder mit Bild, Marc-Feedback)

- **Bild und Form gehen jetzt zusammen.** Vorher ersetzte ein hinzugefügtes Bild
  das ganze Schild durch eine schlichte weiße Karte (Form/Akzent/Dekoration weg).
  Jetzt sitzt das Bild **oben in der Schild-Box**, darunter der Text — die Form
  (Sprechblase/Banner/Wegweiser/…), Akzentfarbe und Dekoration bleiben erhalten.
- **Textfläche nicht mehr fix weiß.** Der Bereich um/unter dem Bild ist die
  Schild-Füllung (Hintergrund- bzw. Stilfarbe), nicht mehr hartes Weiß.
- **Textfarbe ohne Häkchen.** Die Checkbox „eigene Farbe" vor Textfarbe und
  Hintergrund ist weg — eine Farbe zu wählen wirkt sofort. Ein neuer kleiner
  **„Auto"-Button** setzt auf automatisch zurück (Kontrast bzw. Stil-Standard).

### Behoben (Geotagger — verwaiste exiftool-Prozesse)

- **exiftool-Daemons bleiben nicht mehr als Zombies liegen.** Der Geotagger
  betreibt exiftool im Persistent-Modus (`-stay_open`). Bei App-Crash,
  Force-Quit oder hartem Beenden blieb der exiftool-Prozess bisher liegen und
  sammelte sich über Sessions an (gefunden am 08.06.: 6 Waisen seit dem 30.05.).
  Jetzt mehrstufig abgesichert:
  - Daemon läuft in **eigener Process-Group** (`start_new_session`) → ein
    harter Kill beim App-Close erwischt die ganze Gruppe (perl + Kindprozesse).
  - **Reap beim Start**: verwaiste exiftool-Daemons aus einer früheren
    (abgestürzten) Session werden beim nächsten App-Start automatisch gekillt,
    bevor neue starten — das eigentliche Sicherheitsnetz gegen Ansammlung.
  - Gehärtetes `_close()` (graceful `-stay_open False` + stdin-EOF, 2 s Wartezeit,
    dann harter Group-Kill) und `atexit`-Fallback für normale Interpreter-Exits.
  - Daemon wird zusätzlich beim **Session-Reset** (Workspace leeren) sauber
    heruntergefahren statt idle weiterzulaufen.

## [0.9.189] – 2026-06-08

### Neu (Animator — Schilder mit Bild)

- **Ein Schild kann jetzt ein Bild tragen.** Im Schild-Editor gibt es eine neue
  Gruppe „Bild" mit Dateiwähler („🖼 Bild hinzufügen") — das Schild wird dann als
  Foto-Karte gerendert (Bild oben, optionale Bildunterschrift unten). Schatten,
  Anzeigedauer (Vorlauf/Nachlauf), Zoom-Skalierung, „Ganze Zeit zeigen" und freie
  Platzierung mit Track-Anker gelten genauso wie bei Text-Schildern.
- Ein Schild **ohne** Bild bleibt das klassische Text-Schild — beides ist jetzt
  derselbe Mechanismus, nur mit oder ohne Bild. (Erster Schritt der Vereinheitlichung
  von Foto-Pins und Schildern; der Massen-Import von Fotos folgt als nächstes.)
- Schilder mit Bild erscheinen auch im **Render** zeitgenau (Bild wird vor dem
  ersten Frame geladen) und folgen demselben Timing wie in der Vorschau.

## [0.9.188] – 2026-06-07

### Neu (Animator — Schilder)

- **„Ganze Zeit zeigen" pro Schild** — neue Checkbox im Schild-Editor: das Schild
  ist dann vom ersten bis zum letzten Frame sichtbar (ignoriert Vorlauf/Nachlauf).
- **Vorschau-Schalter „Alle Schilder anzeigen"** in der Schilder-Sektion — zeigt
  in der Live-Vorschau alle Schilder gleichzeitig (unabhängig vom Abspiel-Punkt),
  praktisch zum Platzieren. Wirkt nur in der Vorschau; im Video erscheinen die
  Schilder weiter nach ihrem Timing.

## [0.9.187] – 2026-06-07

### Behoben (Render — Timing von Schildern & Foto-Pins)

- **Schilder erschienen im Render zu früh** (ab dem ersten Frame) statt erst,
  wenn der Marker ihre Stelle erreicht — und verschwanden bei gesetztem „Nachlauf"
  entsprechend zu früh. Ursache: im Render-HTML-Bau wurde der Anker („wann
  erscheint es") gegen eine **nicht existierende Variable** berechnet; der Fehler
  wurde still verschluckt, sodass der Anker immer 0 blieb. Jetzt wird er korrekt
  gegen die tatsächlichen Track-Punkte berechnet.
- **Gleicher Fehler betraf die Foto-Pins** — auch sie erschienen im fertigen Video
  ab dem ersten Frame statt beim Vorbeikommen. Jetzt ebenfalls korrekt.

## [0.9.186] – 2026-06-07

### Behoben (Animator — Schilder)

- **Textfarbe ließ sich nicht einstellen** — die gewählte Textfarbe (und ebenso
  die eigene Hintergrundfarbe) wurde ignoriert, solange man nicht zusätzlich das
  kleine „eigene Farbe"-Häkchen setzte. Jetzt aktiviert das Wählen einer Farbe
  den Haken automatisch.

## [0.9.185] – 2026-06-07

### Behoben (Animator — Leeren/Neustart)

- **Leeren räumt jetzt sauber Stück für Stück auf** (statt hinterher zu prüfen,
  ob noch was da ist). Beim Leeren/Schließen werden zuerst die Schilder (Ebene +
  Bilder + Daten + Editor) über einen *lebenden* Karten-Handle entfernt, dann der
  GPX-Track — closure-sicher, also auch wenn der alte Aufräum-Code auf eine tote
  Karten-Referenz zeigte. Das 0,5-s-Polling von v0.9.184 ist wieder raus.
- **App startet nach dem Leeren wirklich leer.** Vorher kam beim Neustart der
  zuletzt geladene GPX-Track (und damit die Schilder) automatisch zurück, obwohl
  alles geschlossen war — der gespeicherte „letzter GPX-Pfad" wurde beim Leeren
  nicht mitgelöscht. Jetzt schon.

## [0.9.184] – 2026-06-07

### Behoben (Animator)

- **Schilder blieben nach GPX-Entfernen hartnäckig auf der Karte** (auch nach
  v0.9.183, weil der Aufräum-Code in seltenen Fällen auf einer veralteten
  Karten-Referenz lief). Jetzt prüft ein laufendes Sicherheitsnetz alle 0,5 s
  gegen die globale GPX-Quelle: ist kein Track mehr geladen, aber die Schild-
  Ebene noch sichtbar, wird sie verlässlich abgehängt — unabhängig davon, über
  welchen Weg das GPX entfernt wurde.

## [0.9.183] – 2026-06-07

### Behoben (Animator)

- **Schilder blieben sichtbar, wenn der GPX-Track entfernt wurde** (verschwanden
  erst beim nächsten Zoomen/Verschieben der Karte). Jetzt werden die Schilder
  beim Schließen des GPX sofort von der Karte abgehängt; beim erneuten Laden
  kommen sie zurück.

## [0.9.182] – 2026-06-07

### Behoben (Animator)

- **Schilder blieben nach „Workspace leeren" auf der Karte stehen** — das rote ✕
  (Arbeitsbereich leeren) entfernt jetzt auch die Schild-Ebene von der Karte und
  leert die Schild-Liste.

## [0.9.181] – 2026-06-07

### Behoben (Animator — Schilder erschienen gar nicht)

- **Schilder waren komplett unsichtbar** (egal ob auf Track oder frei platziert,
  auch mit Text) — Ursache: zwei ungültige Mapbox-Karten-Ausdrücke in der neuen
  Schild-Ebene, die das Anlegen der Ebene scheitern ließen (im Hintergrund
  abgefangen → kein Schild). Konkret: (1) `feature-state` in `icon-size` ist
  nicht erlaubt (nur in Paint-Properties), (2) ein zoom-abhängiger Ausdruck darf
  nicht in einem `case` verschachtelt sein. Beides korrigiert; gegen eine echte
  Karten-Engine verifiziert. Schilder erscheinen jetzt zuverlässig.
- Der „Mit Zoom wachsen"-Schalter pro Schild funktioniert weiterhin (jetzt über
  feature-abhängige Größen-Stützwerte gelöst). Ein-/Ausblenden (Fade) läuft über
  `icon-opacity`. Hinweis: ein echter Scale-„Pop" ist auf GPU-Symbol-Ebenen
  technisch nicht möglich — die Einblendung „Aufpoppen" verhält sich daher wie
  „Einblenden".

## [0.9.180] – 2026-06-07

### Behoben (Animator — Schilder)

- **Schild war beim Setzen/Bearbeiten nicht sichtbar** — durch das neue
  Timing-Fenster wurde ein frisch gesetztes Schild versteckt, solange der
  Scrubber nicht an seiner Position stand. Jetzt wird das gerade bearbeitete
  Schild **immer angezeigt** (WYSIWYG), egal wo der Scrubber steht; nach dem
  Schließen des Editors gilt wieder das eingestellte Zeitfenster.
- **Editor lässt sich jetzt über die Karte hinaus ziehen** — das schwebende
  Panel hängt nicht mehr am Karten-Container, sondern am Fenster. Damit kann
  man es z.B. neben die Karte / auf die Sidebar parken, wenn es zu viel verdeckt.
- **Textfeld größer + frei in der Höhe ziehbar** (3 Zeilen Standard, größere
  Schrift, Resize-Griff unten).

## [0.9.179] – 2026-06-07

### Neu (Animator — Schilder voll customizable)

- **Schilder komplett gestaltbar** — der Schild-Editor (Klick aufs Schild) hat
  jetzt alle Stellschrauben: **Akzent- & Hintergrundfarbe, Textfarbe, Schriftart**
  (System / Rundlich / Schmal / Serif / Monospace / Plakativ — bewusst ohne Comic
  Sans), **Schriftgröße, -stärke, kursiv, Ausrichtung**, mehrzeiliger Text,
  **Eckenradius, Deckkraft, Rahmen** (Breite + Farbe) und **Schlagschatten**
  (an/aus, Farbe, Weichheit). Neue schlichte Box-Form „Plain" dazu.
- **Timing pro Schild** — „Vorlauf" (erscheint X Sekunden bevor der Marker den
  Punkt erreicht) und „Sichtbar nach" (verschwindet X Sekunden danach; 0 = bleibt
  bis zum Ende). Erfüllt den Wunsch, Schilder nur in einem Zeitfenster zu zeigen.
- **Einblend-Animation** wählbar: hart / einblenden (Fade) / aufpoppen / beides.
- **Mit Zoom mitwachsen** pro Schild an-/abschaltbar (fixe oder zoom-abhängige Größe).
- **Freie Platzierung** — neuer Button „📌 Frei platzieren": Schild irgendwo auf
  die Karte setzen (z.B. auf eine Sehenswürdigkeit abseits des Tracks). Der
  Zeitpunkt des Erscheinens richtet sich weiter nach dem nächsten Track-Punkt
  (Anker am Track + freier Koordinaten-Offset).
- **Technik:** Schild-Zeichnung jetzt in EINER gemeinsamen Engine
  (`ui/js/sign_draw.js`) für Live-Vorschau UND Render — Ende der früheren
  Doppelpflege (JS ↔ Python).

## [0.9.178] – 2026-06-07

### Geändert (Animator)

- **Schild-Editor frei verschiebbar** — das schwebende Editor-Panel (öffnet beim
  Klick auf ein Schild) lässt sich jetzt an der Kopfzeile **mit der Maus an eine
  beliebige Stelle ziehen**, falls es das Schild oder einen Kartenbereich
  verdeckt. Sobald man es selbst bewegt hat, bleibt es dort liegen (klebt nicht
  mehr automatisch am Schild). Ein Greif-Symbol (⠿) in der Kopfzeile zeigt das an.

## [0.9.177] – 2026-06-07

### Neu (Geotagger)

- **Kamera-Zeitzone im „Genauen Offset"-Dialog** — manche Kameras (viele
  Olympus/OM, GoPro) speichern nur die Lokalzeit ohne Zeitzonen-Angabe. Auf
  Reisen (z.B. Vietnam, UTC+7) lagen die Fotos dann um den Zeitzonen-Versatz
  neben dem Track. Jetzt lässt sich im Offset-Dialog (✎) zusätzlich die
  **Kamera-Zeitzone** wählen — einmal eingestellt sitzt alles richtig, ohne bei
  jedem Import nachgefragt zu werden. (Beta-Tester-Feedback, Bugreport-Punkt 4.)
- **Gemischte Batches bleiben korrekt** — Fotos, die ihre Zeitzone selbst im
  EXIF gespeichert haben (Handys etc.), werden von der manuellen Zeitzonen-Wahl
  **nicht** angefasst (sie sind schon auf UTC normiert). So lassen sich Handy-
  und Kamera-Fotos derselben Reise zusammen taggen, ohne falsche Koordinaten zu
  riskieren. Die gewählte Zeitzone wird unter dem Offset-Wert mit angezeigt.

## [0.9.176] – 2026-06-07

### Behoben (Geotagger / Release)

- **Fotos werden beim Reinziehen jetzt ergänzt statt ersetzt** — bisher hat ein
  neuer Drag&Drop (oder „Ordner laden") die bestehende Foto-Liste komplett
  überschrieben. Jetzt kommen die neuen Fotos **zur Liste dazu** (Dubletten mit
  gleichem Pfad werden übersprungen). Entfernen geht weiter per ✕/Backspace,
  Leeren über das rote ✕ in der GPX-Bar. (Beta-Tester-Feedback.)
- **RAW im veröffentlichten Build wieder taggbar** — die GitHub-Release-Pipeline
  hatte ExifTool **nicht** mitgebündelt (nur der lokale Build tat das), daher
  meldete das veröffentlichte DMG/Installer „exiftool fehlt" bei RAW/Video.
  ExifTool wird jetzt auch im CI-Release für macOS und Windows eingebacken.
- **Klare Meldung beim Reinziehen von RAW ohne ExifTool** — bisher wurden RAWs
  beim Drag&Drop still übersprungen; jetzt kommt derselbe Hinweis wie beim
  Datei-Picker.

## [0.9.175] – 2026-06-07

### Geändert (Animator)

- **Schild-Einstellungen als schwebendes Panel neben dem Schild** statt
  abdunkelndem Fenster — Karte und Schild bleiben sichtbar, sodass du **live
  siehst**, wie sich Text/Stil/Farbe/Größe auswirken. Das Panel klebt am Schild
  (folgt der Karte) und hat „↔ Verschieben" + „🗑 Löschen" direkt drin. Schließen
  per ✕ oder Esc.

## [0.9.174] – 2026-06-07

### Geändert (Animator)

- **Schild-Einstellungen jetzt im Modal statt in der Seitenleiste** — die
  Schilder-Sektion ist wieder schlank (nur „📍 Schild setzen" + Liste). Ein
  **Klick auf ein Schild** (in der Liste **oder** auf der Karte) öffnet ein
  **Einstellungs-Fenster** mit Text, Stil, Farbe und Größe — **pro Schild**
  einzeln. Dazu Buttons **„↔ Verschieben"** (Schild auf eine neue Track-Stelle
  setzen) und **„🗑 Löschen"**. Neue Schilder erben die zuletzt benutzten
  Eigenschaften.

## [0.9.173] – 2026-06-07

### Hinzugefügt (Animator)

- **Schild-Stile + Farbe** — die Wegpunkt-Schilder gibt's jetzt in **vier
  Optiken** (Dropdown in der „🚩 Schilder"-Sektion): **Sprechblase**,
  **Zielbanner** (zwei Stangen + Banner), **Stecknadel** (Karten-Pin mit
  Textfeld) und **Wegweiser** (Schild auf Pfosten). Dazu ein **Color-Picker**
  für die Akzentfarbe (Banner/Pin/Wegweiser). Die Textfarbe stellt sich je nach
  Farbe automatisch auf hell/dunkel für gute Lesbarkeit.

## [0.9.172] – 2026-06-07

### Behoben (Animator)

- **Wegpunkt-Schilder bleiben jetzt fest an ihrer Stelle** — die Schilder
  verrutschten bei Kamerafahrt, weil sie als HTML-Marker über JS-Events
  „nachgezogen" wurden. Jetzt werden sie wie die Foto-Pins als **GPU-Symbol-Layer**
  (Canvas-Bild) gerendert → exakt an die Geo-Position gebunden, kein Driften
  mehr, und das Vergrößern-beim-Reinzoomen läuft nativ über die Karte.

## [0.9.171] – 2026-06-07

### Hinzugefügt (Animator)

- **Wegpunkt-Schilder entlang der Route** — du kannst jetzt **Text-Schilder** auf
  die Route setzen (z.B. „Gipfel erreicht!", „Mittagspause"). Neuer Bereich
  **„🚩 Schilder"** in der Seitenleiste: **„📍 Schild setzen"** anklicken, dann
  auf den Track klicken (rastet auf die Strecke ein), Text eingeben — fertig. Im
  Video **erscheint das Schild als Sprechblase, sobald der animierte Marker den
  Punkt erreicht**. Die Schilder **stehen immer aufrecht zur Kamera** (auch bei
  gekippter 3D-Karte) und **werden größer, je näher die Kamera kommt**.
  Schriftgröße einstellbar, Liste zum Bearbeiten/Löschen. Wirkt in Vorschau und
  Render. *(Phase 1 — Ausblenden-nach-Zeit, mehrere Stile/Icons und der
  Alpha-Modus folgen.)*

### Behoben (Animator)

- **Ghost-Track-Farbe** zeigte hinter dem Hex-Wert „undefined" statt der Farbe —
  fällt jetzt sauber auf die gewählte Farbe zurück und aktualisiert live.

## [0.9.170] – 2026-06-07

### Hinzugefügt (Animator)

- **Eigene Farbe für den Ghost-Track** — der „Ghost-Track" (ganze Route schwach
  im Hintergrund) hat jetzt einen **eigenen Color-Picker**, unabhängig von der
  Haupt-Track-Farbe. So kann die Hintergrund-Route z.B. dezent grau sein,
  während der animierte Track in Signalfarbe darüberzieht. Die Funktion heißt in
  der Oberfläche jetzt durchgängig **„Ghost-Track"**.

## [0.9.169] – 2026-06-07

### Hinzugefügt (Animator)

- **Ghost-Track: ganze Route schwach vorgezeichnet** — neuer Schalter „Ganze
  Route schwach zeigen" in der Track-Sektion. Damit siehst du die **komplette
  Route** schon halbtransparent im Hintergrund, während nur der animierte Teil
  wie gewohnt voll deckend darüber gezeichnet wird. So ist von Anfang an
  erkennbar, wo es noch hingeht. Die **Deckkraft** der Hintergrund-Route ist per
  Slider einstellbar (5–80 %, Default 30 %). Wirkt in Live-Vorschau und Render
  (inkl. Alpha/Transparent-Modus). Standard aus — bestehende Animationen bleiben
  unverändert.

## [0.9.168] – 2026-06-07

### Geändert (Geotagger)

- **Track-Linie dynamisch fein statt fix gestaucht** — die Karten-Linie im
  Geotagger wurde bisher pauschal auf 800 Punkte reduziert, wodurch lange Tracks
  beim Reinzoomen ungenau wurden (Kurven „eckig"). Jetzt skaliert die Punktdichte
  mit der Streckenlänge: **50 Punkte pro Kilometer** (aufgerundet; harte
  Notbremse bei 100 000 nur gegen kaputte GPX). Ein kurzer Track bleibt fein,
  ein 100-km-Track bekommt entsprechend
  mehr Detail. Das „Auf Track einrasten" beim manuellen Platzieren wird dadurch
  ebenfalls genauer.

## [0.9.167] – 2026-06-07

### Behoben (Geotagger)

- **„Auf Track einrasten" sitzt jetzt exakt auf der Linie** — beim manuellen
  Platzieren rastete das Foto bisher auf den nächsten *aufgezeichneten* GPX-Punkt
  ein. Bei weiter auseinanderliegenden Punkten saß der Pin dadurch sichtbar
  **neben** der gezeichneten Track-Linie. Jetzt wird auf den nächsten Punkt der
  **Linie selbst** (zwischen zwei GPX-Punkten) eingerastet; Höhe und Zeit werden
  entlang des Segments interpoliert. (Gilt auch für die Track-Klick-Info.)

## [0.9.166] – 2026-06-07

### Hinzugefügt (Geotagger)

- **Fotos manuell auf der Karte platzieren** — du kannst ein Foto jetzt einfach
  **aus der Liste auf die Karte ziehen**, um seine GPS-Koordinaten festzulegen.
  Perfekt für Fotos, die sich über die Aufnahmezeit nicht zuordnen lassen (z.B.
  weil sie nur das Export-Datum tragen und damit „außerhalb der Track-Zeit"
  liegen) — oder zum Geotaggen ganz **ohne Track**.
  - **Frei platzieren** (Standard): Foto landet genau dort, wo du loslässt.
  - **Auf Track einrasten**: neuer Schalter „Auf Track einrasten" in der
    Seitenleiste setzt das Foto auf den nächstgelegenen Track-Punkt (inkl.
    dessen Höhe). **⌘ beim Ablegen** kehrt den Modus kurzzeitig um.
  - Manuell gesetzte Pins sind **blau** und lassen sich zum Feinjustieren
    **direkt auf der Karte verschieben**.
  - Beim Ziehen zeigt ein Hinweis-Balken auf der Karte an, ob frei oder auf den
    Track gesetzt wird.

## [0.9.165] – 2026-06-07

### Behoben (Geotagger)

- **Leere 0/0-GPS-Blöcke werden nicht mehr als „hat schon GPS" gewertet** —
  manche Kameras/Programme schreiben einen GPS-Block mit Position 0°/0° (=
  „Null-Island", Golf von Guinea). Das ist kein echter Geotag. Bisher hat der
  Geotagger solche Fotos fälschlich als bereits getaggt erkannt und beim Taggen
  übersprungen. Jetzt werden Nullkoordinaten verworfen → die Fotos werden
  normal zugeordnet und getaggt. (Marc-Fund am Malerweg-Ordner.)
- **Karte springt nicht mehr zum Track-Start** bei Klick auf ein Foto, das
  außerhalb der Track-Zeit liegt. Solche Fotos haben keinen echten Track-Punkt;
  die Karte bleibt jetzt einfach stehen.

### Geändert (Geotagger)

- **Grund-Hinweis direkt im Bild** statt Tooltip: nicht taggbare Fotos zeigen
  den Grund jetzt als Klartext-Balken im Foto („Außerhalb der Track-Zeit" /
  „Keine Aufnahmezeit" / „Hat schon GPS"), weil der bisherige Tooltip vom
  ✕-Entfernen-Hover verdeckt wurde.

## [0.9.164] – 2026-06-05

### Hinzugefügt (Geotagger)

- **Kamera-Filter in der Übersicht** — hast du Fotos von mehreren Kameras, listet
  die Übersicht jetzt jede **Kamera (Make/Model)** mit Anzahl + **„zeigen"**-
  Button auf. Ein Klick filtert die Liste auf genau diese Kamera. (Marc-Wunsch.)
- **Häkchen pro Foto (wird getaggt)** — jedes Foto hat oben links eine Checkbox,
  **per Default an**. Beim Schreiben werden **nur Fotos getaggt, die sichtbar
  (= durch den aktiven Filter) UND angehakt sind**. So taggst du z.B. mit einem
  Kamera-Filter gezielt nur die Bilder einer Kamera. (Marc-Wunsch.)
- **Fotos aus der Liste entfernen** — deutliches **rotes ✕** oben rechts auf dem
  Foto (beim Drüberfahren) ODER **Backspace/Entf** auf dem ausgewählten Foto.
  Nimmt das Foto nur aus der Liste/Karte — die Datei selbst bleibt unberührt.
- **Status-Badges mit Klartext-Tooltip** — die kleinen Symbole auf den Foto-
  Kacheln (● wird getaggt · ! außerhalb Track-Zeit · ? keine EXIF-Zeit · ✓ hatte
  schon GPS) zeigen beim Drüberfahren jetzt im Klartext, was sie bedeuten.
- **Nicht taggbare Fotos klar erkennbar** — Fotos, die gar nicht getaggt werden
  können (außerhalb der Track-Zeit oder ohne EXIF-Zeit), werden **abgedunkelt**,
  bekommen **kein Häkchen** mehr und zeigen den Grund als **Klartext direkt im
  Bild** (z.B. „Außerhalb der Track-Zeit" / „Keine Aufnahmezeit").

### Technik

- `core/exif.py`: Make/Model in `_exiftool_read_meta` + `_exiftool_read_video_meta`,
  `_piexif_read_camera` + `read_camera`-Dispatcher (`_camera_label` dedupliziert
  „Canon Canon EOS R5"). `app.py`: `_read_meta_fast` → `(dt,gps,camera)`, Worker +
  `geotagger_poll_thumbs` liefern `camera`; neue Bridge `geotagger_remove_photos`.
- `modules/geotagger/ui/module.js`: `_gtCamFilter` + `_gtUnchecked`-State,
  Kamera-Sektion in `updateSummary`, Checkbox + ✕ pro Tile, `_gtRemovePhoto`,
  Backspace-Handler, Write-Set = `m.in_range && sichtbar && angehakt`. CSS + i18n.

## [0.9.163] – 2026-06-05

### Hinzugefügt (Geotagger)

- **Klick auf den Track zeigt Punkt-Info** — ein Klick auf die Track-Linie öffnet
  ein kleines Popup mit GPS-Koordinaten, Höhe und Datum/Zeit der nächstgelegenen
  Track-Stelle, **sowohl in der System-Zeitzone (lokal) als auch in UTC**
  (GPX-Standard). (Marc-Wunsch.)
- **Filter-Buttons in der „Übersicht"** — hinter jeder Kategorie (werden getaggt /
  außerhalb Track-Zeit / ohne EXIF-Zeit / hatten schon GPS) gibt es jetzt einen
  kleinen **„zeigen"**-Button; ein Klick filtert die Foto-Liste auf genau diese
  Kategorie. **„Filter zurücksetzen"** zeigt wieder alle Fotos. (Marc-Wunsch.)

### Technik

- `app.py`: neue Bridge `geotagger_track_point_at(lon, lat)` → nächstgelegener
  Track-Punkt (lat/lon/ele/time) aus `self._gtg_track`.
- `modules/geotagger/ui/module.js`: `onMapClick` branched (Referenz-Modus vs.
  Track-Info-Popup via `mapLib().Popup`); `_gtFilter`-State + `_gtPhotoInFilter`
  filtert `renderPhotoGrid`; `updateSummary` rendert „zeigen"/Reset-Buttons,
  delegierter Klick-Handler auf `#gt-summary`. CSS + i18n (de/en/es).

## [0.9.162] – 2026-06-05

### Geändert

- **Multi-Track-Animator („Mehrere Touren") vorerst ausgeblendet** (Marc-
  Entscheidung — Feature noch nicht fertig). Die Sidebar-Sektion ist per
  `display:none` unsichtbar; der gesamte Multi-Track-Code (UI, `_extraTours`,
  `core/animator._render_multi`) bleibt im Repo, ist aber inaktiv (`_extraTours`
  bleibt leer → der Render nutzt nie den Multi-Track-Pfad). Reaktivieren später
  durch Entfernen des `style="display:none"` an der `tours`-Sektion. **Taucht
  bewusst NICHT im Endnutzer-Changelog (`docs/CHANGELOG.html`) auf.**
- **Release v0.9.162** — erster öffentlicher Build seit v0.9.155. Inhalt für
  Endnutzer: WYSIWYG-Zoom (Render = Vorschau, beide Modi), Track-Linien-Dicke
  = Vorschau, fertiges Video wieder im „Fertig"-Bereich abspielbar (eingebettet
  via lokalem HTTP-Server) + „▶ Abspielen"-Button.

## [0.9.161] – 2026-06-05

### Behoben

- **Multi-Track: „+ Tour hinzufügen" warf eine Fehlermeldung**
  (`ReferenceError: Can't find variable: escapeHtml`) und die Tour-Liste wurde
  nicht gerendert. Die Tour-Listen-Funktion nutzte `escapeHtml`, das nur als
  funktions-lokale Hilfsfunktion in zwei Modal-Funktionen existierte (nicht im
  Modul-Scope). Jetzt eigener modul-weiter Helfer `_animEscapeHtml` → Touren
  lassen sich wieder hinzufügen.

## [0.9.160] – 2026-06-03

### Behoben

- **Das fertige Video wird wieder direkt im „Fertig"-Bereich eingebettet
  abgespielt** (statt schwarzem Kästchen). Ursache war nicht der Codec
  (die Datei ist Standard-`h264 High / yuv420p` und läuft in QuickTime): der
  eingebettete Player (WKWebView) lädt `file://`-Videos von **externen
  Volumes/anderen Ordnern** nicht — pywebview erlaubt nur `file://`-Zugriff im
  selben Verzeichnisbaum, und `<video>`-Elemente sind strenger gesandboxt als
  Skripte/CSS. Das Video wird jetzt über einen **lokalen HTTP-Server**
  (127.0.0.1, Range-fähig) ausgeliefert → zuverlässige Inline-Wiedergabe,
  egal wo die Datei liegt. Bei Problemen greift weiterhin der `file://`-Fallback
  bzw. der „▶ Abspielen"-Button (QuickTime).

### Technik

- `app.py`: neuer Mini-HTTP-Media-Server (`_MediaRequestHandler` mit Range/206-
  Support, `ThreadingHTTPServer` auf `127.0.0.1:0`, lazy gestartet) + Bridge
  `serve_media(path)` → registriert die Datei unter einem Zufalls-Token und
  liefert `http://127.0.0.1:<port>/media/<token>`. Nur registrierte Tokens
  werden bedient (kein offener Datei-Zugriff), Registry auf 50 Einträge
  begrenzt. Range-Logik per Standalone-Test verifiziert (200/206/Suffix/404).
- `modules/animator/ui/module.js`: Done-Handler lädt das Video bevorzugt über
  `serve_media()` (Fallback `encodeURI("file://"…)`), ruft danach `v.play()`
  für zuverlässiges Autoplay.

## [0.9.159] – 2026-06-03

### Behoben

- **Fertiges Video lässt sich wieder im GPS Studio ansehen — jetzt wirklich.**
  Die `yuv420p`-Umstellung in v0.9.158 hat das Decodier-Problem behoben, aber
  der eingebettete Player blieb bei Pfaden mit **Umlauten/Leerzeichen** (z.B.
  `…/Köthen Tour/…`) schwarz: die `file://`-URL wurde **roh, ohne URL-Encoding**
  zusammengebaut → WKWebView fand die Datei nicht. Die URL wird jetzt korrekt
  encodiert (`encodeURI`).

### Hinzugefügt

- **Neuer „▶ Abspielen"-Button** im „Fertig"-Bereich: öffnet das gerenderte
  Video direkt im **System-Standard-Player** (z.B. QuickTime). Garantierter
  Abspiel-Weg, unabhängig vom eingebetteten Vorschau-Player.
- Schlägt der eingebettete Player doch mal fehl, erscheint jetzt ein klarer
  Hinweis (statt stumm schwarz zu bleiben) mit Verweis auf „▶ Abspielen".

### Technik

- `modules/animator/ui/module.js`: `<video>`-`src` via `encodeURI("file://" +
  output)`; `onerror`-Handler loggt den `MediaError.code` (3/4 = Codec, 2 =
  Datei/Pfad) + Toast. Neuer Button `#anim-play-video` → `api().open_path()`.
- `app.py`: neue Bridge `open_path(path)` → `_open_path_native` (öffnet im
  System-Default). i18n-Keys `animator.btn.play_video` /
  `animator.video_load_fail` (de/en/es).

## [0.9.158] – 2026-06-02

### Behoben

- **Fertiges Video lässt sich wieder direkt im GPS Studio abspielen.** Die
  H.264-/H.265-Ausgabe lief seit v0.9.22 mit **4:4:4-Chroma** (`yuv444p` +
  `high444`-Profil). Apples AVFoundation/WKWebView kann High 4:4:4 **nicht
  dekodieren** → das eingebettete `<video>` im „Fertig"-Bereich (und QuickTime)
  blieb schwarz. h264/h265 rendern jetzt wieder als **`yuv420p`** (universell
  abspielbar: In-App-Player, QuickTime, Web, YouTube). Wer maximale
  Farbtreue/4:4:4 fürs Editing braucht, nimmt den **ProRes-Codec** (Master,
  bleibt 4:4:4).
- **Track-Linie im Render ist jetzt so dick wie in der Vorschau** (vorher v.a.
  bei 4K spürbar dünner). `line-width` ist in CSS-Pixeln; der Render-Viewport
  ist breiter als die schmale Vorschau, wodurch dieselbe Pixel-Linie relativ
  dünner wirkte. Die Linie (samt Glow/Schatten) wird jetzt mit demselben
  Viewport-Verhältnis hochskaliert wie der Zoom (`2^zoom_correction / dsf`) →
  WYSIWYG.

### Technik

- `core/animator.py`: h264/h265-ffmpeg-Pfad (Single- + Multi-Track) auf
  `yuv420p`, `high444`-Profil entfernt; `hvc1`-Tag für H.265 bleibt. ProRes-
  Pfade unverändert (4:4:4 / 4444).
- `modules/animator/ui/module.js`: `lineScale = 2^zoom_correction / dsf` wird
  auf den `line_width`-Render-Parameter multipliziert (Slider/Preview behalten
  den Roh-Wert; Glow/Schatten skalieren im Backend proportional mit). Dot-
  Radien bleiben vorerst fix.

## [0.9.157] – 2026-06-02

### Behoben

- **Zoomstufe im Render passt jetzt exakt zur Vorschau — in BEIDEN Modi**
  (Keyframe- UND „normaler"/Classic-Modus). Bisher zeigte das fertige Video
  einen anderen (meist herausgezoomten) Kartenausschnitt als die Live-Vorschau,
  weil der Render den **rohen** Vorschau-Zoom reproduzierte, ohne die
  Viewport-Korrektur (`log2(Render-Breite / Vorschau-Breite)`). Mapbox-Zoom ist
  relativ zur Viewport-Pixelbreite — die Vorschau ist ~800 px breit, der Render
  1920–7680 px. Im Classic-Modus hob zusätzlich die implizite Default-Keyframe
  den `override_zoom`-Korrekturwert wieder auf; im KF-Modus wurde er nie
  angewandt.

### Geändert

- **Classic-Modus läuft jetzt intern über GENAU EINEN Render-Pfad** (2
  unsichtbare Start/End-Keyframes), identisch zum Keyframe-Modus. Der alte
  `override_center`/`override_zoom`-Sonderpfad ist abgeschafft — die aktuelle
  Vorschau-Kamera (Schwenk/Neigung/Zoom) wird beim Render direkt in die zwei
  versteckten Keyframes übernommen. Für den Nutzer ändert sich nichts an der
  Bedienung; intern gibt es keine zwei getrennten Zoom-Logiken mehr.

### Technik

- Neuer `AnimatorConfig.zoom_correction` (= `correctedZoom(map,W,H) −
  map.getZoom()`), durchgereicht via `app.py`. Im Render: `abs_shift =
  zoom_correction − log2(dsf)`, in `core/timeline.py` über
  `interpolate_properties(zoom_abs_shift=…)` →
  `_interpolate_zoom_offset`/`_zoom_effective_offset`/`_maybe_flyto_interp`
  bis auf den absoluten KF-Zoom addiert: `frame_zoom = value_absolute +
  abs_shift`. `fit_zoom_base` kürzt sich raus → padding-unabhängig, exakt wie
  der bewährte Classic-`correctedZoom`-Pfad. Default `abs_shift=0` =
  unverändertes Verhalten für alte Aufrufe.
- Tour-Map (statische PNG) nutzt `correctedZoom` weiterhin direkt für seinen
  einzelnen Zoom — kein Per-Frame-Interpolations-Pfad, daher keine Änderung.

## [0.9.156] – 2026-06-01

### Hinzugefügt

- **Mehrere Touren im Animator** – ein Video kann jetzt mehrere GPX-Touren
  nacheinander animieren. Im Animator-Sidebar gibt es den neuen Abschnitt
  **„🧭 Mehrere Touren"**: Die geladene Haupt-Tour ist automatisch „Tour 1",
  weitere Touren werden per **„+ Tour hinzufügen"** angehängt. Jede Tour
  bekommt eine **eigene Farbe** (Farbwähler pro Zeile), lässt sich per
  **↑/↓ umsortieren** und einzeln **entfernen**. Auf der Karte werden alle
  Touren sofort als farbige Linien in der Vorschau gezeigt (WYSIWYG).
- **Kinoflug zwischen Touren** – beim Übergang von einer Tour zur nächsten
  fliegt die Kamera in einem ruhigen, cineastischen Bogen (van-Wijk-Zoom:
  herauszoomen, schwenken, wieder hineinzoomen). Die Dauer dieses Flugs ist
  über den neuen Regler **„Kinoflug-Dauer"** (1–8 s) einstellbar. Die Overlays
  (Distanz, Zeit, Höhe) laufen über alle Touren hinweg durchgehend weiter.

### Technik

- Isolierter Render-Pfad `core/animator._render_multi(...)` – wird **nur** bei
  ≥2 Touren aktiv; der bewährte Single-Track-`render()` bleibt unverändert.
  N separate `mtrack{i}`-Sources/Layers mit statischer Tour-Farbe, neue
  `window.advanceFrameMulti(...)` + `window.fitTourView(...)` im HTML-Template.
- Frame-Budget: `intro + Σ walk_i + (N−1)·fly + hold`; van-Wijk-Interpolation
  via `core/timeline._van_wijk_interp(...)`. Kombinierte `cum_dist`/`cum_time`
  über alle Touren für durchgehende Overlays.
- UI modul-lokal im Animator (`_extraTours`-State), kein Eingriff in die globale
  GPX-Bar. Tour-Map-Multi-Track folgt in einer späteren Phase.

## [0.9.155] – 2026-05-30

### Geändert

- **„Workspace leeren" ist jetzt ein zentrales rotes ✕ neben dem GPX-Namen**
  (oben im Modul-Header) statt drei separater Buttons je Modul. Marc-Wunsch:
  Der alte „↺ Workspace leeren"-Button in Animator, Tour-Map und Geotagger ist
  entfallen. Ein Klick auf das rote ✕ (Tooltip „Workspace leeren") räumt nach
  einer Sicherheitsabfrage **alle Module gleichzeitig** — GPX-Track, Fotos,
  Match-Daten und Geotagger-Backend-State — **inklusive des GPX-Namens oben**.
  Vorher blieb der GPX-Name nach dem Leeren stehen.

### Technik

- Neue zentrale Reset-Registry in `ui/js/gpx-bar.js`: jedes Modul registriert
  beim Init seine Reset-Funktion via `registerWorkspaceResetter(fn)`,
  `window.clearWorkspaceGlobal()` zeigt EIN Bestätigungs-Modal und ruft alle
  Resetter + `clearGlobalGpx()`. Modul-Closures überleben Modul-Wechsel, daher
  greift der Reset auch für nicht gemountete Module (DOM-Zugriffe guarded).
  `confirmClearWorkspace(null, …)` nutzt den neuen `confirm_all`-Text.

## [0.9.154] – 2026-05-30

### Behoben

- **⚠️ Kritisch: GPS-Tagging von TIFF-Dateien (`.tif`/`.tiff`) schlug komplett
  fehl.** Das v0.9.152-Logging hat es im echten Einsatz aufgedeckt: 11/11
  Olympus-/OM-TIFFs scheiterten mit `piexif._exceptions.InvalidImageDataError`.
  Ursache: TIFF lief über `piexif.insert()`, das aber **nur echtes JPEG**
  (SOI-Marker) schreiben kann. **Fix:** TIFF in eine eigene `TIFF_EXTS`-Klasse
  getrennt — **Schreiben** läuft jetzt über **exiftool** (wie RAW, natives
  TIFF-EXIF), **Lesen** weiter über `piexif.load()` (kann TIFF problemlos). Damit
  greift auch der Zeit-Offset (`shift_datetime`) bei TIFF. End-to-End getestet:
  GPS wird geschrieben und korrekt zurückgelesen.

## [0.9.153] – 2026-05-30

### Hinzugefügt

- **Drag&Drop kennt jetzt die echten Original-Pfade — auf allen Plattformen.**
  pywebview 6.2.1 erfasst beim Drop nativ den vollständigen Dateipfad
  (`webview.dom._dnd_state['paths']`), sobald **ein** Python-Drop-Listener
  registriert ist. Die App registriert beim Fenster-Load genau einen No-op-
  Listener (`_enable_native_drop()`) und liest die Pfade pro Drop über die neue
  Bridge **`consume_drop_paths()`** race-frei aus (Cocoa füllt den Puffer
  synchron *vor* dem JS-Drop-Event). Funktioniert mit WKWebView (macOS),
  WebView2/EdgeChromium (Windows) und GTK/Qt (Linux).

### Behoben

- **⚠️ Kritisch (echte Lösung statt Workaround): Per Drag&Drop importierte Fotos
  werden jetzt direkt im Original getaggt — kein Export-Schritt mehr nötig.**
  Statt Wegwerf-Kopien unter `_drops/` zu schreiben (v0.9.152), löst der
  Geotagger über `consume_drop_paths()` den echten Original-Pfad auf und schreibt
  GPS **in-place** in die Quelldatei. Greift der native Pfad ausnahmsweise nicht
  (sehr altes OS, Ordner-Drop), fällt die App automatisch auf den bisherigen
  base64-Kopie-Weg (`_drops/` + Export-Button) zurück — voll abwärtskompatibel.
- **Sporadischer macOS-Bug „Drop enthielt keine Dateien (WKWebView-Bug?)"
  entschärft.** Wenn die WebView ausnahmsweise keine `File`-Objekte liefert,
  rekonstruiert die App den Import jetzt aus den nativen Pfaden (Synth-Fallback).
- **GPX-Bar, Animator- und Tour-Map-Foto-Drops** lösen ebenfalls echte Pfade auf
  (statt nur Dateinamen), wodurch GPX-/Foto-Imports per Drag&Drop zuverlässig den
  korrekten Quellpfad verwenden.

## [0.9.152] – 2026-05-30

### Behoben

- **⚠️ Kritisch: Per Drag&Drop importierte Fotos wurden scheinbar nicht
  getaggt.** Das Diagnose-Logging (s.u.) hat die wahre Ursache gezeigt: Der
  GPS-Write lief technisch fehlerfrei (11/11 Fotos, je 9 GPS-Tags, 0 Fehler) —
  **aber in die falschen Dateien.** Per Drag&Drop importierte Fotos liefert die
  WebView nur als Datei-**Inhalt** ohne Original-Pfad; die App legt sie deshalb
  als Wegwerf-Kopien unter `_drops/` ab. Der Geotagger schrieb GPS sauber in
  diese Kopien — die Originale (in Apple Fotos / im Quellordner) blieben
  unberührt. Daher der Eindruck „es wird nichts geschrieben".
  - **Fix:** Nach dem Taggen von Drag&Drop-Fotos bietet das „Fertig"-Modal jetzt
    **„Getaggte Fotos speichern …"** an → Zielordner wählen → die fertig
    getaggten Bilder werden unter ihrem Original-Namen dorthin exportiert
    (`geotagger_export_tagged`). Ein Hinweis im Modal erklärt das und empfiehlt
    für In-Place-Tagging den Weg über **„Ordner wählen"** (dort sind echte
    Pfade bekannt → Originale werden direkt getaggt, hat immer funktioniert).

### Geändert

- **Diagnose-Logging über den kompletten GPS-Schreibpfad.** Nachdem das
  Geotaggen in der echten App weiterhin keine GPS-Daten schrieb (auch nicht in
  JPEG, das gar nicht über den exiftool-Daemon läuft), ist der Daemon-Split aus
  v0.9.151 als alleinige Ursache widerlegt — es muss eine tiefere Ursache geben.
  Daher schreibt die App jetzt detaillierte Logs nach `logs/app.log`:
  - **`geotagger_start_write`**: Anzahl eingegangener Matches, Optionen
    (Backup/Overwrite/Zeit-Korrektur), Filter-Ergebnis (`to_write` /
    `skipped_existing` / `skipped_no_coords`), erstes Item (Pfad/Koordinaten/
    Zeit), jeder Früh-Abbruch mit Grund, Worker-Start.
  - **`_write_worker_run`**: Phase-A-Backup (Start/Ergebnis/Abbruch), Phase-B
    pro Foto (Pfad + Koordinaten + Zeitstempel vor `write_gps`, Erfolg/Fehler
    mit vollem Traceback), Abschluss-Zähler (done/skipped/errors).
  - **`core/exif.py`**: `write_gps` loggt erkannten Dateityp + Branch (JPEG/
    HEIC/RAW/Video); `_piexif_write_gps`, `_exiftool_write_gps` und
    `_exiftool_write_gps_video` loggen Argumente, Erfolg und Fehler mit
    Traceback; der ExifTool-Daemon loggt Prozess-Start bzw. „exiftool nicht
    gefunden".
  - Dient ausschließlich der Fehlersuche — keine Funktionsänderung am Schreiben.

## [0.9.151] – 2026-05-30

### Behoben

- **⚠️ Kritisch: Geotagger schrieb keine GPS-Daten mehr in die EXIFs (Fotos
  & Videos), wenn parallel Video-Vorschauen liefen.** Ursache war ein
  **einziger globaler Lock** auf den exiftool-Daemon: Lese-Zugriffe der
  Vorschau (Thumbnails/Meta) und das GPS-**Schreiben** teilten sich denselben
  Prozess + Lock. Eine langsame/hängende Video-Vorschau (z.B. OM-`.mov`) hielt
  den Lock → der GPS-Write wurde dahinter **ausgehungert** und kam scheinbar nie
  dran. Nachgemessen: ein Write wartete **7,7 s** hinter EINER blockierenden
  Vorschau (bei mehreren wuchs das ins Endlose → „es wird nichts geschrieben").
  - **Fix:** GPS-**Schreibvorgänge** laufen jetzt über einen **eigenen,
    zweiten exiftool-Daemon** (separater Prozess + separater Lock). Lesen
    (Vorschau) und Schreiben (Geotag) können sich damit **nie mehr gegenseitig
    blockieren**. Nach dem Fix: derselbe Write **0,08 s** statt 7,7 s, selbst
    während eine Vorschau 8 s den Lese-Lock hält.
  - Betrifft **JPEG** (piexif – war ohnehin separat) genauso wie **RAW/HEIC**
    (OM/ORF etc.) und **Video**-GPS — alle Schreibpfade nutzen jetzt den
    Write-Daemon.
  - **Plattformübergreifend** (macOS + Windows) — der Daemon-Split ist
    OS-unabhängig.

## [0.9.150] – 2026-05-30

### Geändert

- **Video-Vorschau im Geotagger nutzt jetzt QuickLook — exakt das, was der
  Finder anzeigt (macOS).** Marc-Wunsch: „nimm doch einfach das, was der Finder
  ratz-fatz zeigt." Genau das macht v0.9.150:
  - Vorschau via `qlmanage -t` (QuickLook) — **dieselbe Engine wie der Finder**,
    mit **System-Thumbnail-Cache** und hardware-beschleunigtem Video-Decode
    (AVFoundation). Für Videos, die der Finder schon angezeigt hat, quasi instant.
  - Läuft im **separaten System-Dienst**, nicht in unserem Prozess → **kein
    CPU-Spike**, der die App/das Fenster blockiert. Gemessen: ffmpeg ~0,67 s bei
    **257 % CPU** vs. QuickLook ~0,3 s bei **~25 % CPU** (bei OM-4K/C4K-`.mov`
    ist der ffmpeg-Decode noch deutlich teurer — das war die eigentliche Bremse).
  - Reihenfolge der Video-Vorschau: **(1) QuickLook [macOS]**, (2) eingebettetes
    Thumbnail via exiftool-Daemon, (3) ffmpeg-Keyframe-Seek (plattformüber-
    greifender Fallback — Windows/Linux nutzen weiter ffmpeg/Embedded).

## [0.9.149] – 2026-05-30

### Behoben

- **OM-/Olympus-`.mov`-Vorschau wieder schnell (Rolle rückwärts zu v0.9.148).**
  In v0.9.148 hatte ich den „eingebettetes Thumbnail zuerst"-Probe entfernt, in
  der Annahme er erzwinge einen Mehr-GB-Vollscan. **Falsch:** nachgemessen
  braucht `exiftool -b -PreviewImage` auf einer 326-MB-`.mov` nur ~0,07–0,3 s
  und scannt die Datei *nicht* komplett. OM-/Olympus-`.mov` betten ein
  Vorschau-JPEG ein → exiftool liefert es praktisch instant. Durch das Entfernen
  fielen OM-`.mov` auf den langsamen ffmpeg-Frame-Decode (4K/C4K, hohe Bitrate)
  zurück → „dauert noch länger". Jetzt wieder: **(1) eingebettetes Thumbnail via
  exiftool-Daemon zuerst, (2) ffmpeg-Keyframe-Seek nur als Fallback** (für
  Videos ohne eingebettete Vorschau, z.B. iPhone-`.mov`, dort ~0,7 s).
  Die schnellen ffmpeg-Flags aus v0.9.147/148 bleiben für den Fallback erhalten.
- Die abbrechbare Backup-Logik + das Stoppen des Thumbnail-Workers vor dem
  GPS-Schreiben (beides aus v0.9.148) bleiben unverändert erhalten.

## [0.9.148] – 2026-05-30

### Behoben

- **OM-/Olympus-`.mov` im Geotagger laden nicht mehr ewig.** Der in v0.9.147
  eingeführte „eingebettetes Thumbnail zuerst"-Probe war für OM-`.mov`
  kontraproduktiv: diese Dateien haben **kein** eingebettetes Vorschau-JPEG,
  also musste exiftool jedes Mal die **komplette** (mehrere GB große) Datei
  durchscannen — und das gleich zweimal (PreviewImage + ThumbnailImage) — bevor
  überhaupt auf ffmpeg zurückgefallen wurde. Der Probe-Aufruf ist jetzt aus
  `extract_video_thumbnail` entfernt; es greifen direkt die schnellen
  ffmpeg-Flags. (Die Funktion `extract_video_embedded_thumbnail` bleibt für
  künftige gezielte Nutzung definiert, wird aber nicht mehr automatisch
  aufgerufen.)
- **„Abbrechen" während des Backups wirkt jetzt sofort.** Vorher lief das
  Backup vor dem GPS-Schreiben unabbrechbar durch:
  - Es nutzte `ZIP_DEFLATE` und komprimierte mehrere GB Video — minutenlang,
    obwohl Fotos/Videos schon komprimiert sind. Jetzt **`ZIP_STORED`** (reines
    Byte-Kopieren, kein Verlust an Platz, drastisch schneller).
  - Es wurde **chunk-weise (8 MB)** geschrieben mit `should_cancel`-Check pro
    Chunk → Abbruch greift jetzt auch **mitten** in einer großen Datei, nicht
    erst nach der Datei. Bei Abbruch wird das halbfertige ZIP gelöscht.
  - Das UI zeigt jetzt **Backup-Fortschritt** (`Backup i/n: Dateiname`) statt
    nur „Backup wird erstellt …".
- **GPS Studio kommt während Backup/Schreiben wieder in den Vordergrund.** Der
  Thumbnail-Worker hält die (einzige) exiftool-Daemon-Sperre. Lief er noch,
  während „GPS schreiben" gestartet wurde, blockierte er den Schreibvorgang und
  die Cocoa-Hauptschleife. Der laufende Thumbnail-Worker wird jetzt **vor** dem
  Schreiben sauber gestoppt (max. 3 s join), bevor der Schreib-Worker startet.

## [0.9.147] – 2026-05-30

### Geändert

- **Video-Vorschaubilder im Geotagger deutlich schneller.** Videos gehen nicht
  über den JPEG-Schnellpfad (v0.9.146), sondern brauchten je einen vollen
  ffmpeg-Frame-Decode. Jetzt:
  - **Eingebettetes Thumbnail zuerst:** Viele Kameras/Phones (Insta360, DJI,
    diverse iPhones) betten ein Vorschau-JPEG in die Video-Metadaten ein. Das
    wird jetzt über den persistenten exiftool-Daemon gelesen (kein
    Prozess-Spawn, kein Decode) → praktisch instant, wenn vorhanden.
  - **Schnellere ffmpeg-Flags** als Fallback: `-noaccurate_seek` (springt zum
    nächsten Keyframe statt bis zur exakten Sekunde durchzudekodieren), `-an`
    `-sn` (ignoriert Audio-/Untertitel-Streams), und Ziel-Scale von 640→384 px
    (das UI zeigt ~220 px, der Rest war verschenkter Encode/Decode).

## [0.9.146] – 2026-05-30

### Behoben

- **Geotagger fror beim Laden der Vorschaubilder ein — Fenster ließ sich nicht
  mehr nach vorne holen.** Während im Hintergrund die Thumbnails generiert
  wurden, hielt der CPU-gebundene Decode-Worker-Thread den Python-GIL quasi
  durchgehend. Dadurch bekam die PyObjC/Cocoa-Main-Run-Loop von pywebview keine
  Zeit zum Pumpen → das App-Fenster reagierte nicht mehr und konnte aus dem
  Hintergrund nicht mehr aktiviert werden. Der Worker gibt jetzt pro Foto kurz
  den GIL frei (`time.sleep(0.004)`), sodass die UI-Loop flüssig weiterläuft.

### Geändert

- **Thumbnail-Generierung im Geotagger deutlich schneller.** Bisher wurde jedes
  Foto in voller Auflösung (z.B. 6000×4000) dekodiert und erst danach auf
  Vorschaugröße skaliert. Jetzt weist `img.draft()` den JPEG-Decoder an, gleich
  DCT-skaliert auf ~Zielgröße herunterzudecodieren — ein Bruchteil der
  Rechenzeit pro Foto. Zusätzlich ein In-Memory-Thumb-Cache (Key aus
  Pfad+mtime+Größe), der bei Tab-Wechsel / erneutem Registrieren derselben Fotos
  ein Neu-Dekodieren komplett spart. Nach einem GPS-Write (mtime ändert sich)
  wird der Cache automatisch invalidiert. Geotagger-only.

## [0.9.145] – 2026-05-29

### Behoben

- **Erster Keyframe bekam fälschlich die Werte, wenn man abseits eines
  Keyframes etwas änderte und dort einen neuen KF erstellte.** Wenn der
  Scrubber NICHT auf einem Keyframe stand, man die Karte verschob/zoomte und
  dann einen neuen KF setzte, wurde zwar korrekt ein neuer KF mit den aktuellen
  Einstellungen angelegt — gleichzeitig erhielt aber auch der 1. Keyframe diese
  Werte. Ursache: `_syncMapStateToUi` (Map-`moveend`-Sync) schrieb die
  aktuellen Karten-Werte in den *ausgewählten* KF (`_selectedKfIdx`, oft noch
  der 1. KF von einer früheren Auswahl), ohne zu prüfen, ob der Scrubber
  überhaupt auf diesem KF steht. Über `skipSelectionSync`-Pfade
  (KF-Editor-Toggle, Projekt-Restore) konnte eine veraltete Auswahl bestehen
  bleiben, während der Scrubber längst zwischen den KFs lag. Jetzt wird nur noch
  in den ausgewählten KF geschrieben, wenn der Scrubber **tatsächlich auf ihm
  steht** (`findKeyframeAtAnchor`-Check) — gleiche Klasse wie der v0.9.64-Fix
  (kein versehentliches KF-Vergiften mehr). Animator-only.

## [0.9.144] – 2026-05-29

### Behoben

- **Übergang „freie Position → Track-folgen" zeigte nur Weiß (Welt→Track).**
  Folgefix zu v0.9.143: Seit die Kamera beim frei→folgen-Wechsel tatsächlich
  pant (statt einzufrieren), flog sie bei einem großen Zoom-Sprung — typisch
  beim Welt-Drehung-Keyframe gefolgt von „jetzt dem Track folgen" — **linear**
  durch leeren Raum, sodass die Vorschau dazwischen nur weiße/leere Karte
  zeigte. Der van-Wijk-Kinoflug (sanftes Zoom-Out, Schwenk, Zoom-In) wurde
  übersprungen, weil der Track-folgen-Endpunkt `center=null` war. Jetzt löst
  auch der van-Wijk-Pfad den `null`-Endpunkt auf den echten Track-Punkt auf →
  der Welt→Track-Übergang ist wieder ein sauberer Kameraflug statt eines
  weißen Durchflugs. Vorschau und Render identisch (WYSIWYG), Animator-only.

## [0.9.143] – 2026-05-29

### Behoben

- **Übergang „freie Kamera-Position → Track-folgen"-Keyframe (Preview + Render).**
  Schaltete man von einem Keyframe mit fester Karten-Position (Track-folgen aus)
  auf einen Keyframe der wieder dem Track folgt (Track-folgen an, `center=null`),
  fror die Kamera in der Vorschau auf der freien Position ein und sprang erst am
  Folge-Keyframe schlagartig auf den Track. Ursache: ein gemischtes
  Center-Segment (ein Endpunkt fest, einer „folgt Track") gab über das ganze
  Segment den festen Wert zurück, statt zwischen freier Position und Track-Punkt
  zu interpolieren. Jetzt wird der „folgt Track"-Endpunkt auf den tatsächlichen
  Track-Punkt an seinem Zeitpunkt aufgelöst und die Kamera pant glatt dorthin —
  in der Vorschau **und** im Render identisch (WYSIWYG). Betrifft nur den
  Animator (Welt-Drehung/Kameraführung ist Animator-only).

## [0.9.142] – 2026-05-29

### Geändert

- **Welt-Drehungs-Overshoot-Fix aus v0.9.140 wieder zurückgenommen.** Der dort
  eingeführte Anim-Phasen-Remap (Kamera animiert nur im Fenster
  `[Intro-Ende, Anim-Ende]`) hatte einen unerwarteten Nebeneffekt: liegt der 2.
  Welt-Keyframe in der **Hold-Phase** (Marcs Setup, KF2 „am Ende vom Inhold"),
  dann begann die Drehung erst **nach** KF2 statt davor — das Gegenteil des
  gewünschten Verhaltens. Mathematisch ist der Remap für die KF-Interpolation
  ein No-Op, solange KF2 ≤ Anim-Ende liegt, und kippt das Timing nur dann, wenn
  KF2 in der Hold-Region steht. Damit war es der falsche Hebel. Zurück auf das
  bekannt funktionierende v0.9.139-Verhalten („Drehung geht"); der eigentliche
  Overshoot wird mit einem reproduzierbaren Testfall neu angegangen.

## [0.9.141] – 2026-05-29

### Behoben

- **Welt-Mitte sitzt jetzt vertikal mittig (nicht mehr zu hoch).** Der Welt-
  Button schob die Erde um Y=34 % nach oben — ein empirischer Wert aus der
  Zeit, als die Welt-Ansicht noch mit pitch=35° gerendert wurde. Seit die
  Welt-Ansicht flach von oben (pitch=0) steht, ist kein vertikaler Shift mehr
  nötig: Y=0 % zentriert die Erde korrekt im Viewport.

## [0.9.140] – 2026-05-29

### Behoben

- **Welt-Mitte-Button: kein Nachspringen mehr.** Nach „Welt → Mitte" sprang der
  Globus ~½ Sekunde später ein paar Pixel nach oben und wirkte „zu" (zu hoch).
  Ursache: das initiale `easeTo` hatte kein Padding, danach verschob ein
  `setPadding` im `moveend` die Karte schlagartig, plus ein 250 ms später
  feuerndes `jumpTo` ruckte erneut. Jetzt ist das Padding direkt in `easeTo`,
  `moveend`-`setPadding` und das `jumpTo` eingebacken (identischer Wert) → die
  Karte gleitet sauber in die finale Pose, ohne Nachsprung.

## [0.9.139] – 2026-05-29

### Behoben

- **Drehungszähler springt jetzt bei genau einer Umdrehung auf ±1.** Vorher
  zeigte der Counter den absoluten Längengrad ÷ 360 — eine volle Drehung von
  einem Track in Mitteleuropa (lng ≈ 13°) ergab nach Westen nur `-0.96↻`,
  also „unter 1". Marc musste mehr als einmal drehen bis der Zähler über 1
  sprang. Jetzt zählt der Counter **relativ zum Dreh-Ursprung** des Keyframes:
  eine volle Drehung in beide Richtungen ergibt exakt `±1.00↻`, unabhängig
  vom absoluten Längengrad des Tracks.
- **Welt-Drehung per Flick wird zuverlässig gespeichert (Probe-Lauf dreht in
  der aufgenommenen Richtung).** Mapbox-Drag hat Trägheit (Inertia): nach dem
  Loslassen eines Schwungs gleitet die Karte weiter und feuert `move`/`moveend`
  — aber **keine** `drag`-Events mehr. Der Längengrad-Akkumulator blieb so beim
  letzten Drag-Frame stehen, während die echte Kartenmitte weiterdriftete. Beim
  Speichern scheiterte dann der harte Toleranz-Check (`|accum − center| < 0.01`)
  → der **gewickelte** Wert landete im Keyframe → die volle Drehung ging
  verloren (beide Keyframes ≈ gleicher Längengrad → „dreht nicht / nicht wie
  aufgenommen"). Jetzt akkumulieren wir auch die nachlaufende Inertia (`move`-
  Events während einer aktiven Geste) und gleichen den Akkumulator beim
  Speichern robust auf die finale Mitte ab (Reconcile statt Toleranz-Gate).

## [0.9.138] – 2026-05-29

### Behoben

- **Welt-Drehung per Karten-Ziehen wird jetzt korrekt im Keyframe gespeichert
  (Probe-Lauf dreht endlich).** Der Drehungszähler zählte beim Ziehen zwar
  hoch (z.B. „1↻"), aber im Probe-Lauf passierte nichts. Ursache: der
  `moveend`-Handler schrieb nach dem Drag den **gewickelten** Längengrad
  (`map.getCenter().lng` ∈ [-180,180)) in den aktiven Keyframe — die volle
  Erd-Umdrehung steckt aber im **abgewickelten** Akkumulator (`_lngAccum`,
  z.B. 374°). Dadurch hatten Start- und End-Keyframe denselben Längengrad,
  die Differenz (= die Drehung im Insta360-Modell) war 0. Jetzt persistiert
  der Handler — identisch zum Snapshot — den abgewickelten Wert inkl. voller
  Umdrehungen. Eine Drehung am Globus landet damit wirklich im Keyframe und
  spielt im Probe-Lauf ab.

## [0.9.137] – 2026-05-29

### Hinzugefügt

- **Live-Drehungszähler im Animator-Viewport.** Oben rechts in der Karten-
  Vorschau zeigt ein kleiner Zähler (`↻ 370° (1↻)`) den aktuell abgewickelten
  Längengrad samt voller Erd-Umdrehungen — und zählt **live beim Karten-Ziehen**
  mit. So sieht man sofort, ob und wie die Welt-Drehung-Akkumulation
  (Insta360-Modell) greift.

### Behoben

- **Längen-/Breitengrad-Felder im Keyframe-Editor aktualisieren jetzt live.**
  Bisher schrieb das Drag-Tracking den abgewickelten Längengrad nur intern
  mit, ohne die sichtbaren Felder/Labels zu aktualisieren — beim Ziehen der
  Karte tat sich optisch nichts. Jetzt schreibt `_updateLngLiveDisplay()`
  beim Ziehen sowohl den Live-Zähler als auch (falls offen) die Lon/Lat-Felder
  des Keyframe-Editors fort.

## [0.9.136] – 2026-05-29

### Geändert

**Welt-Drehung komplett neu gedacht — Insta360-Modell (⚠️ Breaking für alte
Projekte, aber gewollt im frühen Stadium).** Die alte, fehleranfällige
Welt-Drehung mit drei sich überlappenden Steuerungen (eigene „Welt-Drehung"-
Spur + Slider) ist raus. Die Drehung steckt jetzt — wie bei der Insta360 —
direkt im **abgewickelten Längengrad** der Karten-Position: Ein Wert von z.B.
`lng = 370` bedeutet „eine volle Erd-Umdrehung und dann auf Längengrad 10
landen". So gibt es nur noch **eine** Quelle für Position + Drehung, und sie
können sich nicht mehr „verheddern".

- **Neu: Längen-/Breitengrad-Felder im Keyframe-Editor** (Slider + klick-
  editierbares Zahlenfeld, analog zu Pitch/Rotation/Zoom). Das Längen-Label
  zeigt zusätzlich die aufsummierten Umdrehungen an (z.B. `370° (1↻)`).
- **Karten-Ziehen zählt automatisch hoch:** Drehst du die Erde beim Ziehen
  über die Datumsgrenze hinaus, zählt der Längengrad sauber weiter (371°,
  372°, …) statt auf −180° zu springen. Umgesetzt über echte Mapbox-`drag`-
  Events; programmatische Kamerafahrten verfälschen den Zähler nicht.
- **Sauberer Kino-Flug trotz Mehrfach-Drehung:** Die vollen Umdrehungen
  werden vom van-Wijk-Zoom/Schwenk-Algorithmus entkoppelt — van-Wijk sieht
  nur die echte geografische Kurz-Distanz, die Drehungen werden gleichmäßig
  obendrauf gelegt. Kein „Wildflug" mehr bei großen Werten.
- **Entfernt:** die separate „Welt-Drehung"-Keyframe-Spur und ihr Slider.
  (Der Classic-Modus-Schwenk „Rotation" bleibt unverändert bestehen.)
- **Alte Projekte** mit der alten Welt-Drehung-Spur laden weiterhin ohne
  Absturz; die alten Drehungs-Events werden ignoriert. Keine Migration.

Umgesetzt in `core/timeline.py`, `core/animator.py`,
`modules/animator/ui/module.js`, `ui/js/timeline.js` und i18n DE/EN/ES.
(Animator-only — die Tour-Map ist ein statisches PNG.)

## [0.9.135] – 2026-05-29

### Behoben

**Welt-Drehung landet jetzt IMMER zentriert auf dem Track** (Marc-Frage:
„kommen 270° oder 400° durcheinander?"). Bisher musste der Rotationswert am
Track-Keyframe exakt ein Vielfaches von 360° sein (360°, 720°, …), sonst
endete die Erde um den „Rest" verdreht und der Track saß nicht mittig — die
Welt-Drehung „verhedderte" sich mit der Position. Jetzt rastet die Drehung
automatisch auf die nächste ganze Umdrehung ein und kommt **exakt auf dem
Track-Längengrad** raus, egal welcher Wert eingestellt ist:
270°/360°/400° → 1 Umdrehung, 540°/720° → 2 Umdrehungen. Der „Rest" wird
dabei gleichmäßig über den Flug abgezogen — der Start bleibt unverändert
(kein Versatz bei Keyframe 1), nur die Landung wird sauber gerundet.
Umgesetzt in `core/timeline.py` (`interpolate_properties`) und synchron in
der Live-Vorschau (`interpolateCameraJs` in `modules/animator/ui/module.js`).

## [0.9.134] – 2026-05-29

### Behoben

**Welt-Drehung: „wildes Umherfliegen zwischen Zoomstufe 4 und 8"**
(Marc-Test nach v0.9.133). Bei aktiver Erd-Drehung schlug die Kamera im
Zoom-Band 4–8 in Längsrichtung hin und her. Ursache: Die Welt-Drehung
(Rotation-Lane) wurde **doppelt** abgewickelt. Die Rotation interpoliert
ihren Wert ohnehin über den Fortschritt und landet beim Track-Keyframe
(rotation 0) glatt bei 0 — das ist bereits eine saubere, monotone Drehung.
Der seit v0.9.123 zusätzlich aufmultiplizierte `zoomFade` (Faktor 1→0 über
Zoom 4–8) war eine **zweite** Abwicklung, diesmal im Zoom-Raum. Während des
Kino-Anflugs rauscht der Zoom aber sehr schnell durch das 4–8-Band, sodass
dieser zweite Fade in ein winziges Zeitfenster gestaucht wurde → der
Längengrad-Offset schwang dort hin und her (A/B-Messung: bis ~19°/Frame
Sprung im Band statt gleichmäßiger ~7°/Frame). Fix: Rotation wird **nicht
mehr mit dem zoomFade gewichtet** — die Drehung wickelt sich jetzt
gleichmäßig über den ganzen Flug ab und kommt exakt auf dem Track raus.
Position/Padding nutzt den zoomFade unverändert weiter (verursacht keine
Flug-Wildheit). Synchron in Backend-Render (`core/animator.py`) und beiden
Live-Vorschau-Pfaden (`scrubPreview` + Playback-`step()` in
`modules/animator/ui/module.js`).

## [0.9.133] – 2026-05-29

### Behoben

**Welt→Track-Kamerafahrt „fiel runter und irrte im Tiefflug umher"**
(Marc-Test nach v0.9.132). Statt eines smoothen Kino-Flugs von der Weltkugel
in den Track sackte die Kamera schnell auf niedrige Höhe ab und schwenkte
dann im Tiefflug zum Track. Ursache: Seit v0.9.121 wurde der Kino-Flug-
Algorithmus (van-Wijk „Smooth and Efficient Zooming and Panning") bei jedem
Welt-Endpunkt (Zoom ≤ 3) **komplett übersprungen** → es blieb **lineare**
Interpolation (Zoom 0→12 gleichmäßig = bei der Hälfte schon Tiefflug,
während das Center erst halb beim Track ist). Der v0.9.121-Skip war selbst
nur ein Workaround für einen **Einheiten-Bug**: van-Wijk rechnete die
Distanz in rohen Lon/Lat-**Grad**, die Viewport-Breite aber in Welt-
Bruchteilen (`w = 1/2^z`) — bei Globe-Flügen (Δlat bis 47°) wollte der
Algorithmus dadurch absurd weit rauszoomen (= leere Karte).
Fix: van-Wijk rechnet jetzt in **Web-Mercator-projizierten** Koordinaten
`[0,1]` (einheiten-konsistent mit `w`), plus Mapbox-Min-Zoom-Clamp. Damit
ist der Skip überflüssig und entfernt — die Kamera bleibt am weiten Ende
oben (Welt-Sicht/Schwenk) und zoomt erst zum Schluss kontrolliert in den
Track rein = echter Kino-Flug. Backend (`core/timeline.py`) und Live-
Vorschau (`modules/animator/ui/module.js`) synchron gefixt.

## [0.9.132] – 2026-05-29

### Behoben

**Welt-zentrieren „Auf Mitte"-Button hatte keinen sichtbaren Effekt**
(Marc-Test nach v0.9.130). Beide Welt-Buttons schienen auf den Track-Start
zu zentrieren. Ursache: „Auf Mitte" war als Track-**Bbox-Mittelpunkt**
implementiert — bei voller Welt-Sicht (zoom 0) ist ein paar Kilometer
Versatz auf dem ganzen Globus aber komplett unsichtbar, also nicht vom
Startpunkt zu unterscheiden. Der eigentlich gewünschte Modus („so wie es
vorher war", vor v0.9.129) zentrierte die Erde auf **Greenwich/Äquator
`[10, 0]`** = klassische frontale Erd-Ansicht, bei der der Track off-center
sitzt und die Kamera beim Render dorthin reinfliegt. Fix: Der zweite Button
heißt jetzt **„🌍⌖ Welt-Mitte"** und macht genau das. „🌍📍 Auf Start"
bleibt unverändert (Erde um den Track-Startpunkt). i18n DE/EN/ES angepasst.

## [0.9.131] – 2026-05-29

### Behoben

**Tour-Map 4K: Vorschau ≠ Render (Zoom/Position stimmten nicht überein)**
(Beta-Tester-Bug). Beim Rendern in 4K war der gerenderte Ausschnitt um genau
eine Zoom-Stufe enger als die Vorschau — bei 1080p passte alles. Ursache:
Das Frontend rechnet den Vorschau-Zoom via `correctedZoom()` auf die volle
Render-Breite (z.B. 3840 px) hoch, der Headless-Render läuft aber mit einem
CSS-Viewport von Breite ÷ Device-Scale-Factor (bei 4K: 3840 ÷ 2 = 1920 px,
`device_scale_factor=2` macht nur die Pixeldichte schärfer, nicht den
geografischen Ausschnitt). Mapbox-Zoom ist relativ zu CSS-Pixeln → der Zoom
war um `log2(dsf)` zu hoch (4K: exakt +1 Stufe, 1080p: ±0). Fix: Im Backend
wird `override_zoom` jetzt um `log2(dsf)` korrigiert (`core/tourmap.py`,
spiegelbildlich auch `core/animator.py` für den WYSIWYG-Override-Pfad ohne
Kamera-Keyframes). Der Keyframe-Pfad war nie betroffen, weil er seine
Fit-Zoom-Basis im Render selbst am echten CSS-Viewport berechnet.

## [0.9.130] – 2026-05-29

### Geändert

**Welt-Zentrieren aufgeteilt in zwei Buttons nebeneinander**
(Marc-Wunsch nach Beta-Tester-Tests v0.9.129). Aktuelles Verhalten
(Track-Startpunkt) ist nicht für jeden Use-Case ideal — z.B. wenn
man die ganze Tour als Übersicht zeigen möchte, ist der Bbox-
Mittelpunkt besser. Jetzt sichtbar beide Optionen:

- **🌍📍 Auf Start** — Welt zentriert auf den Track-**Startpunkt**.
  Beim Reinzoomen bleibt der Startpunkt fixiert, die Erde dreht
  sich um ihn ohne lateral durch die Welt zu wandern. Ideal für
  „Erde → Track-Anfang"-Choreo.
- **🌍⌖ Auf Mitte** — Welt zentriert auf den Track-**Bbox-Mittel-
  punkt** (= klassisches Verhalten vor v0.9.129). Klassische
  Übersicht über die ganze Tour. Ideal wenn der ganze Track im Bild
  bleiben soll.

Beide nutzen die gemeinsame `_centerWorld(mode)`-Funktion und teilen
die Anti-Spring-Sicherung aus v0.9.129. Greenwich-Äquator bleibt als
Fallback wenn kein Track geladen ist.

## [0.9.129] – 2026-05-29

### Behoben

**Welt-Zentrieren-Button springt nicht mehr zurück + zentriert auf
Track-Startpunkt** (Beta-Tester-Bug-Report Beta v0.9.127). Zwei
zusammenhängende Probleme:

1. **„Welt zentrieren zieht in die Mitte und springt dann raus"** —
   nach dem 800ms-easeTo dispatchten die Slider-Bump-Events
   (Pitch/Zoom auf 0 setzen + Padding setzen + Snapshot) andere
   Listener (ResizeObserver, fitTrackPreview-Cascade, KF-Slider-
   Reactions), die die Map kurz an andere Stellen bewegten. Fix:
   nach 250 ms ein finales `map.jumpTo` mit den Welt-Werten als
   Sicherung — egal was andere Listener gemacht haben, die Welt-Pose
   ist danach garantiert korrekt.

2. **„Beim Zoomen auf den Startpunkt dreht sich die Erde, Startpunkt
   sollte fixiert sein"** — Welt-Button zentrierte bisher auf
   Greenwich-Äquator `[10, 0]` (= fixer Default). Beim Reinzoomen zu
   einem KF mit anderem Center (z.B. Track-Anfang in Island)
   interpolierte center linear durch die Welt → laterales Wandern.

   Fix: Welt-Button zentriert jetzt **auf den Track-Startpunkt**
   (`currentCoords[0]`). Wenn KF1 (Welt) und KF2 (Track-Detail) beide
   auf dem Startpunkt zentriert sind, bleibt center die ganze
   Animation fixiert — nur Zoom geht rein und die Welt-Drehung dreht
   um den Startpunkt. Greenwich-Äquator bleibt als Fallback wenn
   (noch) kein Track geladen ist.

## [0.9.128] – 2026-05-29

### Geändert

**Höhen-Animator-Layout an Animator angeglichen**. Anim-Bar (Play +
Trim-Handles + Zeit) sitzt jetzt **unter** dem Viewport statt darin
schwebend — der ganze Letterbox-Bereich gehört dem Höhenprofil, keine
Überlappung mehr.

**Preview-Viewport bekommt Aspect-Ratio der gewählten Auflösung**
(1920×1080, 3840×2160 etc.). Neue Funktion `updateHeightViewport()`
analog zu `updateAnimatorViewport()`: Letterbox-Berechnung mit
Container-Padding-Bottom (76 px für die Anim-Bar reserviert), Aspect-
Ratio matched die Render-Output-Dimensionen. ResizeObserver triggert
neu bei Container-Größenänderungen, Input-Listener auf `#height-w` /
`#height-h` bei Auflösungs-Change. Damit ist die Preview jetzt 1:1
WYSIWYG zur Render-Output-Form (anstatt vorher vollflächig egal welche
Auflösung).

## [0.9.127] – 2026-05-29

### Behoben

**Easing-Symbol-Klick öffnet jetzt zuverlässig das Modal** (Marc-Bug
v0.9.126: trotz pointer-events-Fix passierte beim Klick nichts). Echte
Ursache: `.timeline-track-overlay` (z-index 4 mit Scrubber + Trim-
Handles als children, pointer-events:auto auf den Children) lag im
Stacking-Context höher als die Cluster-Markers wo das Symbol drin
ist — der Scrubber-Handle/Trim-Handle fing den Klick ab. Plus
event-Delegation auf `host` reichte den Click nicht durch wenn
darunter ein anderer Listener `stopPropagation` machte.

Fix:
- `z-index: 50 !important` + `pointer-events: auto !important` direkt
  auf `.timeline-easing-symbol` → liegt jetzt **über allen anderen
  Overlay-Elementen**.
- `mousedown` + `click` Handler direkt **pro Symbol-Button** (statt
  Delegation), beide mit `stopPropagation` + `preventDefault`.

**Touchpad Zwei-Finger-Horizontal-Scroll pannt jetzt die Timeline**
(Marc-Bug v0.9.126: ohne Modifier kein Pan möglich). Wenn `deltaX`
größer als `deltaY` ist (= MacBook-Touchpad mit 2 Fingern horizontal),
wird das automatisch als Pan interpretiert — kein Shift mehr nötig.
Ctrl/Cmd + Wheel bleibt für Zoom, Shift + Wheel als expliziter Pan-
Fallback für klassische Maus mit nur einer Achse.

## [0.9.126] – 2026-05-29

### Geändert

**Easing-Picker als Modal mit iMovie-Stil-Icons** (Marc-Bug v0.9.125:
Klick auf Easing-Symbol hatte nichts geöffnet). Drei Ursachen:
(1) SVG-Pfade hatten 1.6 px Stroke und `pointer-events: visiblePainted`
→ Hit-Test traf fast nie. (2) Floating-Picker (`position: fixed`)
mit globalem document-click-Listener konnte sich selbst sofort
schließen. (3) Icons im alten Stil waren zu klein und nicht klar
unterscheidbar.

Neu:
- **SVG hat `pointer-events: none`**, der ganze Button-Bereich (26×26 px)
  ist Hit-Area → sicher klickbar.
- **Zentrales Modal mit Backdrop**, Klick außerhalb / ESC / Abbrechen-
  Button schließt. 4-Spalten-Grid mit großen 56-px-Icons + Labels.
- **Icons im iMovie-Stil**: zwei farbige Endpunkt-Marker (Kreise links
  unten + rechts oben) verbunden mit der jeweiligen Kurve (gerade Linie
  / Quadratic / Cubic). Marc-Spec aus Screenshot 2026-05-29.

**Timeline-Scrollbar + Zoom-Reset-Button**. Wenn Timeline-Zoom > 1×:
horizontale Scrollbar (9 px hoch) unter den Tick-Labels eingeblendet.
Thumb-Breite zeigt den Sichtbereich-Anteil, Drag pannt, Klick auf
leeren Bereich springt dort hin. Plus neuer Reset-Button `⤢` rechts
neben den `+/−`-Buttons setzt sofort auf 1× zurück (= ganzer Track).
Bei Zoom 1× ist der Reset-Button gedimmt.

## [0.9.125] – 2026-05-29

### Hinzugefügt

**Mapbox-Tile-Check + Smart-Retry im Render**. Bei großen Zoom-Sprüngen
(z.B. Welt → Track) konnte der 5-Sekunden-Hard-Cap von `waitForRender`
zuschnappen bevor Mapbox alle Tiles geladen hatte → weiße Flecken im
Frame. Jetzt prüft der Render-Loop nach `waitForRender` explizit
`map.areTilesLoaded()`. Wenn `false`: extra 2 s warten + erneuter
`waitForRender`, max 3 Versuche pro Frame. Sonst Frame mit Glitch
akzeptieren (statt hängen). Pro Retry ein Warn-Log-Eintrag mit
Frame-Nummer.

**Timeline zoombar** (Marc-Wunsch: präzise arbeiten bei vielen KFs).
In der Status-Zeile der Timeline gibt's drei neue Controls: `−` /
`1×` / `+`. Klick auf `+` zoomed um 2× rein, `−` raus, Klick auf
`1×` resettet auf ganzen Track. Maximaler Zoom 16×.
- **Mausrad-Zoom**: Ctrl/Cmd + Mausrad über der Timeline zoomed
  zentriert auf die Maus-Position.
- **Panning**: Shift + Mausrad pannt horizontal, Shift + Drag im
  Track-Bereich verschiebt den sichtbaren Ausschnitt.
- Alle Marker (Cluster, Lane-Marker, Trim-Handles, Scrubber, Intro-
  Region, Hold-Region) bleiben präzise an ihren Anker-Positionen.

**Easing-Kurven zwischen Keyframes** (Marc-Wunsch: Animation kann jetzt
„sanft starten" / „sanft enden" / „sanft in & aus"). Auf der Verbindung
zwischen je zwei Cluster-KFs sitzt mittig ein kleines Kurven-Symbol
das die aktuelle Easing-Methode zeigt:
- **Linear** (—) — Default, konstante Geschwindigkeit
- **Sanft starten** (`ease_in`, orange) — langsam loslaufen, schnell ankommen
  (Marc-„Sturzflug": Welt-Drehung bleibt lange, dann Schnellzoom rein)
- **Sanft enden** (`ease_out`, grün) — schnell starten, sanft auslaufen
- **Sanft in & aus** (`ease_in_out`, lila) — S-Kurve, klassisch cineastisch

Klick auf das Symbol öffnet einen Mini-Picker mit den vier Optionen.
Die Wahl wirkt auf alle Properties (Pitch, Bearing, Zoom, Center,
Welt-Pos, Welt-Dreh) des Ziel-KFs gleichzeitig. Default `"linear"`
für alle bestehenden Projekte (backward-compatible — Backend hatte
`_apply_easing` seit v0.7.2 als Forward-Compat-Stub bereits drin).

### Geändert

**USER_GUIDE-Sektion zu Welt-Drehung + Welt-Position** ergänzt
(stand seit v0.9.107 in der App, war aber nicht im Doku-Text).
Erklärt Workflow für „Erde dreht sich, dann Reinzoom" mit
konkreten KF-Werten, Slider-Tricks (Label-Klick, Rotation-Counter)
und das Smart-Fade-Verhalten zwischen Zoom 4 und 8.

## [0.9.124] – 2026-05-28

### Behoben

**Render-Crash im Classic-Modus mit Kameraverfolgung** (Bug-Report
Beta-Tester, v0.9.73 Windows): `TypeError: 'TrackPoint' object is not
subscriptable` in `core/animator.py` Zeile 1540. Beim Render mit
Classic-Modus + aktivem „Kamera folgt Track" greift der Code auf
`points[idx][0]` zu — aber `TrackPoint` ist ein `@dataclass` ohne
`__getitem__`. Korrekt: `points[idx].lon` / `points[idx].lat`.

Bug war seit v0.8.17 latent vorhanden, manifestiert sich aber nur in
der exakten Kombination: Classic-Modus (= keine KFs) **AND**
`camera_follow_track = True` **AND** Render läuft (Probelauf hatte den
Bug nicht). Erklärt Beta-Testers Bericht 1:1 — ohne Kameraverfolgung lief der
Render durch (else-Branch mit `center[0]`), mit Kameraverfolgung
crashte er sofort beim ersten Frame.

Tour-Map nicht betroffen (rendert statisches Bild, kein per-Frame
Camera-Follow).

## [0.9.123] – 2026-05-28

### Geändert

**Welt-Konzepte (Welt-Drehung + Welt-Position) als _additive_ Effekte
mit smooth Fade-Out zwischen Zoom 4 und 8** (Marc-Bug v0.9.122: „aber
einen zoom aus der drehung heraus kriege ich so halt nicht hin"). Der
Hard-Cut aus v0.9.122 (Welt-Effekte nur bei `zoom < 4`) hat zwar das
Track-Modus-Problem gelöst, aber den Use-Case kaputt gemacht in dem
Marc von einer drehenden Erde langsam in den Track reinzoomt — die
Drehung wurde abrupt abgeschnitten sobald zoom 4 überschritten war.

**Neue Semantik:**
- `zoomFade = clamp((8 - zoom) / 4, 0, 1)`
- **Rotation ist jetzt ein ADDITIVER lng-Offset** auf `center.lng`
  (statt Override). Wert wird mit `zoomFade` skaliert:
  - `zoom ≤ 4`: 100 % wirksam (volle Welt-Sicht, dreht wie konfiguriert)
  - `zoom 4..8`: linear ausfaden (Drehung verlangsamt sich)
  - `zoom ≥ 8`: 0 % (Track-Modus, kein Welt-Effekt mehr)
- **Padding** (Welt-X/Y) ebenfalls mit `zoomFade` gewichtet → läuft
  genauso sanft auf 0 aus.
- Die Welt dreht beim Reinzoomen also _weiter_ und kommt am Ende sauber
  bei der echten Track-`center.lng` raus. Kein Snap, kein abrupter Stopp.

**Gespiegelt** in `scrubPreview` (Editor-Scrubbing), `step` (Probelauf)
und `core/animator.py` (finaler Render). Animator + Tour-Map nutzen
denselben Code-Pfad in `core/timeline.py` (Linear-Interp der rotation-
Lane), also gilt die Änderung automatisch in beiden Modulen.

## [0.9.122] – 2026-05-27

### Geändert

**Welt-Konzepte (Welt-Drehung + Welt-Position) wirken nur noch bei
Welt-Zoom** (Marc-Spec: „die ganze Welt-Geschichte ist geil aber haut
sich mit Track-Modus"). Konkret: rotation + position werden nur
angewendet wenn der aktuelle absolute Zoom < 4 ist. Sobald die
Animation einen Track-Zoom-Bereich erreicht, werden beide ignoriert
und das Padding auf 0 zurückgesetzt.

**Fixt alle vier Beobachtungen:**
1. **„Weiß zwischendrin"** beim Welt→Track-Zoom — weil das padding
   weiter aktiv blieb während die Map an ungewohnte Stellen
   interpolierte und Mapbox keine Tiles bereit hatte.
2. **„Springt am Schluss an die richtige Stelle"** — padding-
   Interpolation zog die Map auf eine zwischenliegende Position; bei
   zoom > 4 wird padding jetzt rechtzeitig auf 0 gesetzt → kein Snap.
3. **„Bei vorheriger Weltdrehung: falsche Stelle"** — rotation
   überschrieb center.lng während des Zooms; jetzt sobald Track-
   Bereich erreicht, kommt center.lng nur noch aus dem `center`-Event.
4. **„Welt dreht beim Zoom mit"** — rotation-Interpolation zwischen
   zwei KFs zog die Erde während des Zoom-Reins mit; jetzt im Track-
   Bereich nicht mehr.

Frontend (scrubPreview + step) und Backend (`core/animator.py`)
gespiegelt. Welt-KFs (zoom=0) sehen weiter aus wie konfiguriert,
Track-KFs (zoom=12+) ignorieren rotation/position.

## [0.9.121] – 2026-05-27

### Behoben

**Welt→Track-Übergang zoomt erst aus** (Marc-Bug v0.9.120). Der van-
Wijk-Algorithmus für „cinematic" Camera-Bewegungen (v0.9.63+) fliegt
bei großem Zoom-Sprung erst weiter raus und dann rein — der berühmte
„fly-out-and-back" Bogen. Bei Welt→Track ist der Start aber schon
bei Mapbox-Min-Zoom (= ganze Erde sichtbar) → weiter rauszoomen geht
nicht, Mapbox zeigt nur eine leere Welt im Hintergrund.

Jetzt: van-Wijk wird **geskippt wenn ein Endpunkt bei absolutem Zoom
≤ 3 liegt** (= Welt-/Kontinent-Sicht). Stattdessen lineare
Interpolation — die Erde zoomt direkt in den Track rein. Threshold
unverändert (5 Zoom-Stufen) für alle anderen Track-zu-Track-Sprünge.

Gilt für Frontend (Live-Preview/Probelauf) UND Backend
(`core/timeline.py::_maybe_flyto_interp`).

## [0.9.120] – 2026-05-27

### Behoben

**KF1 wurde manchmal angepasst obwohl Marc nicht drauf war** (Marc-Bug
v0.9.119). Die Position/Rotation-Slider-Listener (`_applyKfPosition`,
`_applyKfRotation`) patchten den `_selectedKfIdx` — der hing aber
oft noch von einem früheren KF-Klick (oft KF1=0), auch wenn der
Scrubber inzwischen woanders stand. Slider-Move → KF1 wurde
silent-modifiziert.

Jetzt: zusätzlicher Scrubber-Anchor-Check vor dem Patch. Der Slider
modifiziert den KF NUR wenn der Scrubber tatsächlich auf dessen Anker
sitzt (Toleranz 0.005 = 0.5 %). Wenn der Scrubber dazwischen ist,
ändern die Slider nur die Map-Preview, kein KF wird gepatcht.

## [0.9.119] – 2026-05-27

### Behoben

**KFs mit Welt-Pos/Welt-Dreh landeten daneben** (Marc-Bug v0.9.118).
Root cause: `snapshotKeyframe` speichert beim NEUEN KF Defaults für
`position` (0,0) und `rotation` (0). Beim Anwenden im scrubPreview /
step() / Render war die Check `if (interp.rotation != null)` — aber
**0 ist nicht null**, also griff der Override und setzte `center.lng = 0`.
Effekt: Track-KFs in Berlin (lng=13.5) wurden auf die Greenwich-
Linie gezerrt. Marc sagte: nehme ich die Marker raus → stimmt's.

Jetzt: Rotation überschreibt `center.lng` nur wenn `|rot| > 0.01` —
also explizit non-trivial. rotation=0 bleibt als Marker in der
Timeline-Lane sichtbar, aber wirkt sich nicht aus. Gilt für:
- Frontend Preview (`scrubPreview`)
- Frontend Probelauf (`step()`)
- Backend Render (`core/animator.py`)

## [0.9.118] – 2026-05-27

### Behoben

**„Zoomt weiter raus als man einstellen kann"** (Marc-Bug v0.9.117).
Mein separater `map.setPadding({...})` Call NACH dem `easeTo` triggerte
Move-Events in Mapbox, die die `fitTrackPreview`-Cascade auslösten
(ResizeObserver + Layout-Guard-Retries aus v0.9.34) → Auto-Refit mit
neuem padding → Zoom-out.

Jetzt: `padding` wird direkt als Option in `easeArgs` mitgegeben:
```js
map.easeTo({ pitch, bearing, zoom, center, padding, duration: 80 });
```
Damit ist alles in EINER Map-Bewegung — keine Move-Event-Kaskade. Der
explizit angegebene `zoom`-Wert bleibt exakt erhalten.

## [0.9.117] – 2026-05-27

### Behoben

**Probelauf landete neben dem KF** (Marc-Bug v0.9.116). Klick auf einen
KF zeigte korrekte Pose, aber im Probelauf rutschte die Kamera
daneben — weil `scrubPreview` (= KF-Klick) nur pitch/bearing/zoom/center
auf die Map anwendete, NICHT aber das `padding` (Welt-Position) und
auch nicht `rotation` (Welt-Drehung-Override). `step()` im Probelauf
machte's korrekt → Desync.

Jetzt: `scrubPreview` wendet beide zusätzlich an, mit Reset-auf-0 wenn
das KF kein Position-/Rotation-Event hat (sonst hängt das Padding vom
vorherigen KF).

**„KF spinnt obwohl ich nichts mit Spin/Welt-Pos gemacht habe"**
(Marc-Bug v0.9.116). Snapshot eines neuen KFs hat die aktuellen Slider-
Werte (Position/Rotation) kopiert — wenn vorher der Welt-Button
gedrückt war, hingen die Slider bei (0, 34, 0) und der neue Track-KF
bekam das ungewollt mit. Animation interpoliert dann → „spinnt".

Jetzt: Bei NEUEM KF (= leerer Cluster am Anchor) werden Position und
Rotation als Defaults `0/0/0` gespeichert. Der Welt-Button ruft
`snapshotKeyframe(undefined, { preserveWorldSliders: true })` —
behält damit seine Welt-Werte für den Welt-KF.

Update an bestehendem KF (= über Editor-Slider) ändert weiterhin die
Werte — Marc kann Position/Rotation pro KF nachträglich setzen.

## [0.9.116] – 2026-05-27

### Behoben

**`ReferenceError: Can't find variable: _formatRotationLabel`**
(Marc-Screenshot zu v0.9.115). Die Helper-Funktion war lokal innerhalb
`bindKeyframeEditor` definiert, wurde aber an zwei weiteren Stellen
aufgerufen (`setSliderFromProps` + Welt-Button-Sync) — in beiden
Stellen anderer Closure-Scope. Funktion auf Modul-Scope hochgezogen
(direkt vor `let map = null`).

## [0.9.115] – 2026-05-27

### Hinzugefügt

**Drehungs-Counter im Welt-Drehung-Label** (Marc-Spec). Das Label
zeigt jetzt zusätzlich zur Grad-Zahl die Anzahl Umdrehungen mit
Komma-Genauigkeit:
- `0°` (kein Counter wenn nahe 0)
- `90° (0.25↻)` = Viertel-Drehung
- `360° (1↻)` = eine volle Drehung
- `540° (1.5↻)` = anderthalb Drehungen
- `720° (2↻)` = zwei Drehungen
- `1800° (5↻)` = fünf Drehungen
- `-360° (-1↻)` = Rückwärts-Drehung

So sieht man auf einen Blick was der absolute Wert in Drehungen
bedeutet — Mental-Modell „2 KFs mit unterschiedlicher Rotation =
Animation der Differenz" wird klarer.

### Behoben

**Label-Edit zeigt jetzt den ungeclampten Wert** als Ausgangswert.
Vorher: Slider auf 1440 (via Label-Edit) → Re-Klick aufs Label zeigte
720 (Slider-clamp) als Initialwert. Jetzt: liest erst
`slider.dataset.userValue`, fällt zurück auf `slider.value`. Re-Edits
behalten ihren ursprünglichen Wert.

## [0.9.114] – 2026-05-27

### Behoben

**Eingetipptes 720 sprang auf 180 zurück** (Marc-Bug zu v0.9.112).
Der Welt-Drehung-Slider hatte Range −180..+180 und der Apply-Handler
las `slider.value` (= geclamped auf 180), ignorierte den echten Wert.
Zwei Fixes:
- **Slider-Range erweitert:** −720..+720 (4 volle Drehungen als
  Slider, Schritte 1°). Häufige Drehungs-Werte greifen jetzt direkt
  ohne Clamp-Trick.
- **`dataset.userValue`-Override:** Beim Label-Edit speichert der
  generische util.js-Handler den ECHTEN eingegebenen Wert in
  `slider.dataset.userValue`. Der `_applyKfRotation`-Handler liest
  `userValue ?? slider.value` — Werte > 720 (z.B. 3600 = 10 Drehungen)
  werden somit ungeclampt persistiert.
- **Auto-Cleanup:** Wenn der User danach den Slider physisch zieht
  (= `e.isTrusted === true`), wird `dataset.userValue` gelöscht damit
  der Slider-Wert wieder Vorrang bekommt. Globaler Listener in util.js.

## [0.9.113] – 2026-05-27

### Behoben

**Label-Edit funktionierte nicht** (Marc-Bug zu v0.9.112). Der globale
Click-Listener in `util.js` suchte den Range-Input via
`labelEl.querySelector("input[type=range]")` — der `<input>` ist aber
**Geschwister** des `<label>`, nicht Kind. Daher wurde der Slider nie
gefunden und der Edit-Modus nie aktiviert.

Jetzt zwei Lookup-Pfade:
1. **ID-Heuristik:** Label-Span hat ID `xxx-v` / `xxx_v` → Slider hat
   ID `xxx`. Greift bei allen App-Slidern (Convention).
2. **Fallback:** nächster Range-Input im umgebenden `.field`,
   `[data-prop]`, `.row-2`, `.row-3`, `fieldset` oder `<label>`.

## [0.9.112] – 2026-05-27

### Hinzugefügt

**Slider-Werte click-to-edit** (Marc-Spec). Klick auf den Zahlenwert
neben einem Slider (z.B. `0°` oder `12.0`) macht ihn editierbar — als
Number-Input mit oranger Border. Enter / Blur committet, Escape
verwirft. Funktioniert generisch für alle `.label-val`-Spans neben
Range-Slidern in der App.
- **Eingabe ausserhalb der Slider-Range erlaubt** — der Slider clampt
  visuell, aber der echte Wert wird gespeichert. Custom-Event
  `slider-label-edit` mit `detail: { value, clamped, wasOutOfRange }`
  für Caller die mehr wollen.
- Globaler Click-Listener in `ui/js/util.js` — automatisch aktiv für
  alle Slider in Animator + Tour-Map + Geotagger + Höhen-Animator.

### Geändert

**Rotation (Welt-Drehung) interpoliert jetzt LINEAR statt wrap-aware**
(Marc-Spec). Damit ergibt z.B. KF1 = 0° und KF2 = 720° **zwei volle
Umdrehungen** der Erde zwischen den KFs. Vorher hätte die wrap-aware
Bearing-Logik den kürzesten Weg gewählt → 0° Differenz = keine Drehung.
- Frontend: `_interpScalar` statt `_interpBearing` für rotationEvs
- Backend `core/timeline.py`: `_interpolate_scalar` statt
  `_interpolate_bearing_property`
- Beim Mapbox-`setCenter` wird der Wert per modulo 360 auf [-180, 180]
  umgerechnet — Mapbox bekommt also gültige Werte, aber die KF-
  Interpolation läuft über den vollen Wertebereich

## [0.9.111] – 2026-05-27

### Behoben

**Welt-Dreh-Lane-Icon: ↻ statt 🌍** (Marc-Bug nach v0.9.110-Screenshot).
Das Globus-Emoji ist mehrfarbig (Apple-Default) und füllte den pinken
Marker-Kreis vollständig aus — wirkte uneinheitlich neben den anderen
Lane-Markern (monochrome Symbole auf farbigem Kreis-Hintergrund).
Jetzt monochromer Rotations-Pfeil ↻ — die Lane-Farbe bleibt sichtbar.
Im KF-Editor-Slider-Label (Sidebar, anderer Render-Kontext) bleibt
das 🌍 weil dort die Mehrfarbigkeit nicht stört.

## [0.9.110] – 2026-05-27

### Behoben

**Position + Rotation hatten keine Marker in der Timeline** (Marc-Bug
direkt nach v0.9.109). `timeline.js::computeClusters` filtert die
Events vor dem Cluster-Bauen über `KF_KINDS = ["pitch", "bearing",
"zoom", "center", "camera"]` — die neuen Lanes `position` und
`rotation` waren da nicht aufgenommen, also landeten ihre Events in
keinem Cluster, also wurden auch keine Marker gezeichnet.

Jetzt: `KF_KINDS` enthält auch `position` und `rotation`. Beim
Snapshot eines KF erscheinen damit alle 6 Lane-Marker (Pitch, Drehung,
Zoom, Karte, Welt-Pos, Welt-Dreh). Doppelklick auf eine der neuen
Lanes legt einen Per-Property-Keyframe nur in dieser Lane an.

## [0.9.109] – 2026-05-27

### Hinzugefügt

**Neue Rotation-Lane „🌍 Welt-Dreh" in der Timeline** (Marc-Spec). Eigene
Spur (pink, 🌍) zwischen Welt-Pos und Marker. Marker werden beim
Snapshot automatisch angelegt (jeder KF erhält einen Rotation-Event
mit dem aktuellen Welt-Drehung-Wert). Beim Render hat Rotation Vorrang
vor `center.lng` — d.h. wenn ein KF eine Rotation hat, wird die Erde
exakt auf diesen Längengrad gedreht.

### Geändert

**Welt-Drehung + Welt-Pos Slider sind jetzt im KF-Editor-Block**
(Marc-Spec „ziehe die slider zu den anderen KF slidern"). Direkt
unter dem Zoom-Slider:
- `anim-kf-rotation` (🌍 Welt-Drehung, ein Slider −180 bis +180°)
- `anim-kf-position-x` + `anim-kf-position-y` (↔↕ Welt X/Y, ±50%)

Die alten globalen Slider unter dem Welt-Button (`anim-world-shift-x/y`,
`anim-world-lng`) sind raus. Beim Welt-Button werden die KF-Slider
direkt gesetzt + Map-State live angewendet. Beim Snapshot werden
position- UND rotation-Events automatisch im KF gespeichert.

### Architektur

- `KF_LANES = [pitch, bearing, zoom, center, position, rotation]` (6)
- Neuer Event-Type `{kind:"rotation", value:Number}` (= absoluter
  Längengrad in Grad)
- `interpolateCameraJs` returnt jetzt `{..., position, rotation}`
- `core/timeline.py::interpolate_properties` returnt 6-Tuple
- `core/animator.py` Render-Loop: `kf_rotation` überschreibt
  `frame_lon` wenn gesetzt (mit lng-Wrap auf [-180, 180])

## [0.9.108] – 2026-05-27

### Hinzugefügt

**Timeline: neue „Welt-Pos"-Lane** (Marc-Spec, Nachzug zu v0.9.107).
Zwischen den existierenden Karte- und Marker-Spuren erscheint jetzt
eine eigene Spur mit Cyan-Marker (✥) für die Position-KF-Events.
Marker werden beim Snapshot automatisch angelegt (jeder KF erhält
einen Position-Event mit den aktuellen X/Y-%-Werten) und lassen sich
wie alle anderen Lane-Marker selektieren, draggen und löschen.

**Center-Lane umbenannt** „Position" → „Karte" (📍), damit klar wird:
- **Karte** = wo die Map-Kamera hinschaut (Geo-Koordinate lng+lat)
- **Welt-Pos** = wie das Map-Rendering im Viewport verschoben ist
  (Mapbox-padding X/Y in %)

i18n DE/EN/ES angepasst.

## [0.9.107] – 2026-05-27

### Geändert

**Großer Refactor: Spin raus, Position als KF-Lane** (Marc-Spec).
Die Velocity-basierte Spin-Mechanik war konzeptionell verwirrend
(Spin-deg/s wird über Zeit integriert, kollidiert mit center.lng).
Jetzt alles deklarativ pro KF:

- **Spin-Slider weg** (sowohl der globale in der Klassik-Sektion
  als auch der per-KF im KF-Editor)
- **Spin-Lane raus** (kind="spin" Events werden beim Laden silent
  ignoriert — kein Daten-Verlust, sondern „verlorene" Lane)
- **Neue Lane „position"** — Mapbox-padding X/Y in % pro KF,
  Eventschema `{kind:"position", value:{x,y}}`. Wird zwischen KFs
  linear interpoliert wie alle anderen Properties.
- **Welt-Drehung** kommt jetzt aus `center.lng` pro KF (= Welt-
  Drehung-Slider aus v0.9.106 setzt das direkt). 2 KFs mit
  unterschiedlichen Lng-Werten = Erde rotiert dazwischen.

**Konstante Erd-Rotation:** statt früher Spin=10°/s über 5s setzt
man jetzt KF1 (lng=0) + KF2 (lng=50). Effekt identisch, mathematisch
deklarativ.

### Architektur

- `KF_LANES = [pitch, bearing, zoom, center, position]` (= 5 statt 5
  mit spin)
- `interpolateCameraJs` returnt `{pitch, bearing, zoom_offset, center,
  position}` statt `{..., spin_dps}`
- `core/timeline.py::interpolate_properties` analog umgestellt
- `core/animator.py` Render-Loop: `_spin_state` weg, padding pro Frame
  als `map.setPadding(...)` (nur bei Änderung), nicht mehr einmal
  beim Map-Load
- Bridge sendet weiter `spin_dps: 0` (Backend ignoriert es)
- Alte Projekte mit Spin-Events bleiben kompatibel, Spin-Werte werden
  beim Laden ignoriert. Nach erstem Save sind sie persistent gelöscht.

### Notiz

Marc-Idee für später: **KF-Presets** statt Velocity-Slider — wenn man
oft „rotierende Erde im Hintergrund" will, generiert ein Preset z.B.
3 KFs mit passenden Werten. Status-Eintrag `gps-studio-kf-presets`
pausiert.

## [0.9.106] – 2026-05-26

### Hinzugefügt

**Neuer Slider „🌍 Welt-Drehung (Längengrad)"** im KF-Editor unter
den XY-Shift-Slidern (Marc-Spec). Range −180° bis +180°, Default 0°.
- Setzt direkt `center.lng` (Längengrad-Position der Erde unter der Kamera)
- Beim Slider-Move → `map.jumpTo({center: [lng, lat]})` + KF-`center`-
  Update (per-KF persistiert!)
- Beim Map-Drag → Slider wird automatisch mit dem aktuellen Längengrad
  synchronisiert
- Doppelklick = Reset auf 0° (Greenwich)

**Damit kann jetzt jeder KF eine eigene Erd-Drehposition haben:**
- KF1: Welt-Drehung = 0° (Greenwich/Europa mittig)
- KF2: Welt-Drehung = 90° (Asien mittig)
- Animation rotiert die Erde linear zwischen diesen Werten
- Spin-Slider (deg/s) bleibt als zusätzliche Drift obendrauf

**Welt-Button** setzt jetzt auch den Welt-Drehung-Slider auf 0°.

## [0.9.105] – 2026-05-26

### Geändert

**„🌍 Welt zentrieren"-Defaults: pitch=0, zoom=0**
(Marc-Feedback zu v0.9.104). Vorher pitch=35°/zoom=1.0 → die Erde
war noch zu nah und gekippt. Jetzt:
- **pitch = 0°** (Erde flach von oben gesehen)
- **zoom = 0** (maximal weit weg, ganze Welt sichtbar)
- center = [10°, 0°], Y-Shift = 34 %, X-Shift = 0 % (unverändert)

**Spin rotiert jetzt um die Polachse** (Marc-Bug). Bei Globe-Ansicht
hat der Spin-Slider die Karte um die Achse Kamera→Center gedreht
(= „lokale Rotation"), nicht um die Erd-Polachse. Aus Sicht der
Kamera sah das aus als ob sich die Erde um ihre Greenwich-Achse
dreht — falsch. Jetzt:
- **Globe-Mode** (pitch < 10° UND zoom < 4): Spin wird auf `center.lng`
  addiert → die Erde rotiert um die Nord-/Süd-Polachse, wie eine echte
  Globus-Drehung. Längengrad wird auf [−180°, +180°] umgebrochen.
- **Track-Mode** (höherer pitch oder zoom): Spin bleibt auf `bearing`
  → klassische Drohnen-Rotation um den Track-Punkt.

Gilt für Live-Preview, Probelauf UND Render-Pipeline (`core/animator.py`).
KF-Schema unverändert — die Spin-Akkumulation interpretiert nur ihren
Output anders.

## [0.9.104] – 2026-05-26

### Geändert

**„🌍 Welt zentrieren" setzt jetzt automatisch X=0 % / Y=34 %**
(Marc-empirischer Wert) zusätzlich zu pitch=35° + zoom=1.0. Damit
landet die Erde out-of-the-box mittig im Viewport — kein
Nachjustieren mehr nötig. Die XY-Shift-Slider werden synchron
gesetzt + persistiert.

### Behoben

**XY-Slider-Labels hatten doppelte Pfeile** („↔ Welt ↔") aus
v0.9.103. Jetzt sauber „Welt ↔ X" und „Welt ↕ Y". i18n DE/EN/ES.

## [0.9.103] – 2026-05-26

### Geändert

**XY-Slider verschieben jetzt die WELT, nicht nur die Center-Koordinaten**
(Marc-Korrektur zu v0.9.102). Bei Mapbox-Globe-Projection ist
`map.setCenter()` keine visuelle Translation, sondern eine sphärische
Rotation — die Erde dreht sich nur, das Erd-Objekt bleibt an derselben
Pixel-Position. **Lösung: Mapbox `setPadding`**, das verschiebt das
ganze Map-Rendering im Viewport.

- ↔ X-Slider: -50 % bis +50 % der Viewport-Breite → padding-left/-right
- ↕ Y-Slider: -50 % bis +50 % der Viewport-Höhe → padding-top/-bottom

**Persistierung:** als `animator.world_shift_x_pct` und
`world_shift_y_pct` pro Projekt (global, nicht per-KF — reicht für
den primären Use-Case „Welt-Ansicht-Intro").

**Render-Backend:** Bei jedem Render setzt das HTML-Template via
`map.once('load')` einmal `setPadding(...)` aus den Project-Settings.
Das Padding bleibt für alle Frames aktiv → Preview und Render zeigen
identisches Bild.

## [0.9.102] – 2026-05-26

### Hinzugefügt

**Animator: Zwei neue XY-Slider zum Welt-Verschieben**, direkt unter
dem „🌍 Welt zentrieren"-Button im KF-Editor:
- **↔ X (Lng)** — Slider von −180° bis +180°, schiebt den Map-Center
  horizontal (Longitude)
- **↕ Y (Lat)** — Slider von −85° bis +85°, schiebt den Map-Center
  vertikal (Latitude)

Marc-Feedback zu v0.9.101: Bei Mapbox-Globe-Projection ist Maus-Drag
sphärische Erd-Rotation, die wirkt visuell wie „die Welt dreht sich",
nicht wie „die Welt wird geschoben". Die Slider setzen das `center`
direkt — fühlt sich an wie schieben, weil man explizit Lng/Lat
verstellt. Funktioniert bei jedem Zoom-Level (nicht nur Globe).

**Verhalten:**
- Slider-Move → `map.jumpTo({center: [lng, lat]})` instant
- Bei aktivem KF-Modus → KF-Center-Feld wird sofort aktualisiert
- Map-Drag oder Welt-Button → Slider werden via `moveend` automatisch
  mit aktuellem Map-Center synchronisiert
- Doppelklick auf Slider = Reset auf 0° (globaler Slider-Reset-Listener
  aus v0.9.X)

## [0.9.101] – 2026-05-26

### Geändert

**„🌍 Welt zentrieren": padding-Trick raus, Marc darf selber pannen**
(Marc-Korrektur zu v0.9.100). Der padding-Trick aus v0.9.100 hat die
Erde anfangs gut zentriert, dann ist sie wieder nach unten gesprungen
(vermutlich weil unproject + jumpTo bei Globe-Projektion nicht
pixel-identisch sind). Vier Anläufe mit mathematischer Compensation
haben bestätigt: Mapbox-Globe lässt sich nicht zuverlässig „perfekt
zentrieren". Stattdessen jetzt der pragmatische Weg:
- Welt-Button setzt eine gute Start-Position (pitch=35°, zoom=1.0,
  center=[10°, 35°])
- **User pannt die Erde mit der Maus** dorthin wo's mittig sein soll
  — bei Mapbox-Globe ist Drag = Erd-Rotation, funktioniert horizontal
  UND vertikal
- Beim Loslassen feuert `moveend` mit User-Geste → der aktive KF wird
  automatisch über `_syncMapStateToUi` aktualisiert
- Toast-Hint nach Klick: „🌍 Erde sitzt zu tief? Einfach mit der Maus
  hochziehen — beim Loslassen wird der Keyframe automatisch aktualisiert."

i18n DE/EN/ES für den Hint-Toast gepflegt.

## [0.9.100] – 2026-05-26

### Behoben

**„🌍 Welt zentrieren": Erde sitzt nicht mehr zu tief** (Marc-Bug-Saga
v0.9.89-91, vierter Anlauf). Die empirische Latitude-Compensation aus
v0.9.91 hat nicht gereicht — Erde rutschte trotzdem in den unteren
Drittel. Jetzt mathematisch sauber via Mapbox-`padding-bottom`:
- `easeTo` mit `padding: { bottom: 30 % der Viewport-Höhe }` → der
  `center`-Punkt landet 15 % nach oben relativ zur Viewport-Mitte.
- Nach der Animation: `unproject(Pixel-Mitte)` liefert den Geo-Punkt
  der jetzt visuell in der Mitte liegt. Diesen als neuen `center`
  setzen + Padding zurück auf 0. Bild bleibt identisch (pixel-
  äquivalent), aber die Camera-Position ist jetzt sauber im
  Standard-Schema (kein padding-Feld in KF / Backend nötig).
- pitch=35°, zoom=1.0, bearing=0 wie gehabt.

Damit ist Marc's „Welt-Intro" (Erde dreht sich aus dem Weltall rein,
zoomt dann auf den Track) endlich produktionsfertig — kombiniert mit
dem Spin-Slider (v0.9.82/83) und Cinematic-Flyto (v0.9.84) hat man
jetzt komplett: Welt-KF mit Spin → Track-KF mit Camera-Animation.

## [0.9.99] – 2026-05-26

### Hinzugefügt

**Höhen-Animator: Auflösungs-Picker analog Animator.** In der Sidebar
unter „Allgemein" jetzt die Quick-Buttons **4K** / **1080p** / **4K↕**
/ **1080↕** (Hoch- und Querformat), darunter zwei Custom-Felder für
beliebige W/H-Werte. Aktiver Preset-Button wird highlighted wenn die
manuellen Werte exakt einem Preset entsprechen. Identische Optik und
Bedienung wie beim Animator + Tour-Map.

### Behoben

**Auto-Play nach Trim raus** (Marc-Bug v0.9.98). Wenn man die Trim-
Handles losließ, startete die Animation automatisch wieder. Jetzt
bleibt nach dem Loslassen das Render-Endbild (progress=1) stehen —
Marc startet die Animation manuell mit dem Play-Button.

## [0.9.98] – 2026-05-26

### Behoben

**Anim-Bar überlappte unteren Plot-Teil** (Marc-Bug v0.9.97). Die
Animations-Leiste mit Play-Button + Trim-Handles + Zeit lag mit
`position: absolute; bottom: 16px` ÜBER der SVG und hat den unteren
Bereich des Höhen-Plots verdeckt. Sah aus als ob die Linie
„unterirdisch" verschwindet, war aber nur Überlappung. SVG bekommt
jetzt `bottom: 76px` — die untere Plot-Kante endet exakt über der
Anim-Bar, nichts wird mehr verdeckt.

**Beim Trim-Drag kein Live-Update** (Marc-Bug v0.9.97). Beim Ziehen
der Trim-Handles wurde `_progress = 0` gesetzt → nur Achsen sichtbar,
keine Linie. Marc will aber **live das Endergebnis** sehen während
er trimmt. Jetzt:
- Während Trim-Drag: `_progress = 1` → volle Linie + Fill + Marker am
  Endpunkt + Stats-Box sichtbar (= Render-Endbild)
- Beim Loslassen: zurück auf `_progress = 0` und Animation startet
  automatisch neu

## [0.9.97] – 2026-05-26

### Geändert

**Höhen-Animator-Preview ist jetzt echtes WYSIWYG-Resultat-Preview**
(Marc-Korrektur zu v0.9.96). Ich hatte's missverstanden — Marc will
NICHT den gesamten Track als Skelett sehen, sondern beim Trimmen das
echte Render-Resultat: links/rechts vom Trim verschwindet, die
Y-Achse skaliert sich auf den Trim-Bereich neu, die X-Achse zeigt nur
die Trim-Länge in km.
- Y-/X-Skala richtet sich nach dem Trim-Bereich (inkl. interpolierter
  Endpunkte an Trim-Start und Trim-End, damit die Linie nirgends
  „rausragt").
- Skelett-Layer + Trim-Markierungen sind raus.
- Beim Ziehen der Trim-Handles passt sich die Skala live an — was du
  siehst, kommt 1:1 ins Video.

### Behoben

**„Unterirdisch laufen" endgültig gefixt** (Marc-Bug v0.9.95/v0.9.96).
Der eigentliche Bug war Pixel-Niveau: Linie und Marker haben Stroke-
Dicke + Radius, und wenn der niedrigste Höhenpunkt EXAKT auf der
unteren X-Achse landet, ragen Stroke + Marker-Kreis halb unter den
Plot-Boden. Lösung jetzt: ein **Pixel-genauer Bottom-Margin**
(`max(markerR + 2, lw * 0.7 + 8)` px) wird automatisch reserviert,
sodass die Linie + Marker garantiert immer im Plot bleiben. Das untere
Y-Achs-Label zeigt weiterhin den realen Trim-Tiefpunkt. Gilt für
Live-Preview UND Video-Render.

## [0.9.96] – 2026-05-26

### Geändert

**Höhen-Animator Live-Preview zeigt jetzt IMMER den ganzen Track**
(Marc-Spec: „sonst muss man das ja im Blindflug machen"). Die ganze
Höhenkurve ist als gedimmter Skelett-Layer (30 % Opacity, 60 % Strich-
Dicke) immer sichtbar — auch beim Trimmen. Der getrimmte Bereich
wird zusätzlich:
- Mit zwei gestrichelten gelben Vertikalen markiert (Trim-Anfang +
  -Ende),
- Mit einem dezenten gelben Hintergrund-Tint hervorgehoben,
- In voller Farbe + voller Strich-Dicke animiert während die
  Animation läuft.

So sieht man beim Trimmen immer den Gesamt-Kontext (= „wo bin ich im
Track?"), und die Trim-Auswahl ist klar visuell abgegrenzt.

### Behoben

**„Unterirdisch laufen" jetzt auch beim Trim sauber.** Y-Achse wird
jetzt aus dem GANZEN Track gerechnet (`_eMin`/`_eMax` über alle
Track-Punkte, nicht nur den Trim-Bereich). Damit kann nichts mehr
unter den unteren Plot-Rand dippen — egal wo der Trim sitzt. Vorher
waren `_eMin`/`_eMax` Trim-relativ: bei stark restrictiver Trim-
Auswahl konnte der außerhalb-Trim Track unter `eleLo` rutschen.

## [0.9.95] – 2026-05-26

### Geändert

**Höhen-Animator: Trim-Optik analog Animator** (Marc-Spec). Die separate
Trim-Bar mit Doppel-Slider ist weg. Stattdessen sitzen die Trim-Handles
jetzt **direkt auf der Animations-Bar** — vertikale gelbe Balken mit
Grip-Pille in der Mitte, exakt wie im Animator-Timeline-Trim. Außerhalb
des getrimmten Bereichs liegt ein halbtransparenter dunkler Shade-
Overlay (sehbar dass dieser Track-Abschnitt nicht animiert wird).
Drag (oder Touch) bewegt das Handle, Doppelklick setzt's auf 0 %
bzw. 100 % zurück.

### Behoben

**„Unterirdisch laufen" beim Trim** (Marc-Bug v0.9.94). Die Y-Achse
hatte ein 5 % Bottom-Padding — dadurch lag der niedrigste Track-Punkt
nicht direkt am unteren Plot-Rand, sondern darüber, und der Fill-
Bereich der Höhenkurve dippte in einen leeren Streifen unter der Linie
(„läuft unterirdisch"). Bottom-Padding ist jetzt 0 — der niedrigste
Punkt im Trim-Bereich sitzt exakt auf der unteren X-Achse. Wer trimmt,
bekommt automatisch einen neuen 0-Höhen-Punkt = niedrigster Punkt im
ausgewählten Track-Segment. Gilt für die Live-Vorschau **und** den
Video-Render (HTML-Template im Backend genauso gepatcht).

## [0.9.94] – 2026-05-26

### Hinzugefügt

**Höhen-Animator: Trim-Bar + komplette Render-Pipeline.** Damit ist
das Modul jetzt vollständig — analog zu Animator/Tour-Map.

- **Trim-Bar** (Doppel-Handle-Slider) über der Animations-Leiste in
  der Canvas. Definiert welcher Track-Bereich animiert wird (Start/Ende
  in %). X-Achse, Stats-Box und Marker-Animation richten sich danach.
  Persistiert pro Projekt (`heightanim.trim_start`, `heightanim.trim_end`).
- **Render-Pipeline** analog Animator:
  - Frame-by-Frame via Headless-Chromium (Playwright)
  - ffmpeg-Pipe mit vier Codec-Modi:
    - **MP4 (H.264)** — Standard, kompatibel, kleinste Datei
    - **MP4 (H.265 / HEVC)** — bis 40 % kleinere Datei
    - **ProRes 4444 (.mov)** — Master für YouTube + Color-Grading
    - **ProRes 4444 mit Alpha (.mov)** — transparenter Hintergrund
      fürs Overlay-Compositing in der Schnitt-Software (Final Cut,
      Premiere, DaVinci)
- **Render-Sektion in der Sidebar**: Codec-Dropdown mit Hint-Text,
  aktiver Render-Button, Live-Progress-Bar mit %-Anzeige + Status,
  Cancel-Button, „Im Finder zeigen"-Button wenn fertig.
- Output landet wie beim Animator in `~/Library/Application Support/
  Reisezoom GPS Studio/_renders/<gpx-name>_height.{mp4,mov}`.

### Geändert

- `core/heightanim.py::render_video` ist jetzt eine echte Pipeline statt
  des `NotImplementedError`-Stubs. `HeightConfig` bekommt neue Felder
  `transparent_background`, `trim_start`, `trim_end`, `show_marker`.
- `app.py::heightanim_start_render` startet einen Background-Thread
  analog zum Animator; Status-Polling via `heightanim_status`, Abbruch
  via `heightanim_cancel`.

## [0.9.93] – 2026-05-26

### Hinzugefügt

**Höhen-Animator: Animierte Vorschau**. Die Höhen-Kurve baut sich live
auf (Linie + gefüllter Bereich), ein Marker (Kreis + Glow) läuft am
aktuellen Punkt mit, und eine kleine Stats-Box oben rechts zeigt die
aktuelle Distanz (km) und Höhe (m). Unten im Canvas eine eigene
Animations-Leiste mit:
- **Play/Pause-Button** (▶ ⏸)
- **Scrub-Slider** (Drag → pausiert + springt zur Position)
- **Zeitanzeige** (aktuelle Sek. / Gesamtdauer)
Beim ersten GPX-Load startet die Animation automatisch und läuft im
Loop: vorwärts bis Ende → Hold (so lang wie eingestellt) → von vorn.
Tempo richtet sich nach den Settings „Animation (s)" + „Hold (s)" — die
gleichen Werte landen später im fertigen Video. Neue Checkbox „Marker
zeigen" in der Optik-Sektion zum Ein-/Ausschalten.

## [0.9.92] – 2026-05-26

### Behoben

**Höhen-Animator-Tab: Vorschau erschien nicht** (Hotfix #2 während v0.9.92-Test).
`.module-body` ist ein `360px 1fr`-Grid mit Sidebar links / Canvas
rechts. Mein Modul hatte alles in einen `<div class="anim-layout">`
gepackt, der landete als einziges Kind in der Sidebar-Spalte — Canvas
mit der SVG-Kurve hatte 0×0 Pixel. Jetzt zwei Top-Level-Kinder
(`<aside class="panel">` + `<section class="anim-canvas">`) wie Animator
und Tour-Map. Plus: `onGpxLoaded`-Callback bekommt `{path, data}`, nicht
String — Signatur akzeptiert beides.

**Höhen-Animator-Tab crasht direkt beim Öffnen** (Hotfix #1 während v0.9.92-Test).
`setupSectionAccordions` braucht `(moduleKey, rootElement)`, ich hatte
nur einen CSS-Selector reingegeben → `root.querySelectorAll` warf
`TypeError: undefined is not an object` und stoppte den Mount. Jetzt
korrekt `setupSectionAccordions("heightanim", document.getElementById("height-panel"))`.

### Hinzugefügt

**Neues Modul: Höhen-Animator** (Phase 1 — UI-Skelett + Live-Vorschau).
Vierter Modul-Tab in der App, sortiert zwischen Animator und Tour-Map.
- **Live-SVG-Höhenprofil**: Sobald ein GPX-Track geladen ist, zeigt das
  Modul die Höhenkurve mit Hilfsgitter, X-Achse in km, Y-Achse in
  Metern. Hintergrund-, Linien-Farbe und Liniendicke sind live im
  Sidebar-Panel konfigurierbar — Änderungen wirken sofort.
- **Settings vorbereitet** (Dauer, Hold, FPS, Breite, Höhe) persistieren
  pro Projekt im neuen `heightanim`-Bereich.
- **Render-Backend `core/heightanim.py`** mit `HeightConfig`-Datenklasse
  + `downsample_for_preview`-Helper. Der eigentliche Video-Render-Pfad
  ist Phase 2 (kommt in einer der nächsten Versionen) — der
  „Video rendern"-Button ist in Phase 1 deaktiviert und zeigt einen
  „in Arbeit"-Hinweis.
- Reagiert auf den globalen GPX-Picker — wer im Animator oder Tour-Map
  einen Track lädt, sieht direkt im Höhen-Animator-Tab das Profil.

### Geändert

- `Project`-Schema (in `core/sessions.py`) bekommt das neue Feld
  `heightanim: dict` — sind keine Modul-Settings da, wird automatisch
  aus `DEFAULT_SETTINGS["heightanim"]` befüllt. Alte Projekte bleiben
  kompatibel.
- Neue Bridge-Methoden in `Api`: `heightanim_load_gpx`,
  `heightanim_start_render`, `heightanim_status`, `heightanim_cancel`.

## [0.9.91] – 2026-05-26

### Behoben

**„🌍 Welt zentrieren" zeigte Erde nicht zentriert** (Marc-Bug v0.9.90, 3.
Iteration). Mapbox' Globe-Projektion hat einen prinzipiellen Konflikt:
- pitch = 0° → Erde flach von oben (sieht wie Polkappe aus)
- pitch > 0° → Kamera kippt, Erd-Mittelpunkt rutscht ins untere Drittel

**Fix:** pitch-aware Center-Compensation. Default-Werte:
- `pitch = 35°` (cinematischer 3D-Look ohne extreme Verzerrung)
- `zoom = 1.0` (ganze Erde sichtbar)
- `center = [10°, 35°]` — Greenwich-Mitte + Latitude-Compensation (= 1:1
  zum Pitch, empirisch ok). So landet der visuelle Erd-Mittelpunkt trotz
  Pitch-Kippung in der Viewport-Mitte.

Die kompensierten Werte werden direkt im KF gespeichert (nicht als
padding-Override), damit Probelauf + Render exakt das gleiche Bild
zeigen — kein „Re-Rutsch" der Erde im fertigen Video.

## [0.9.90] – 2026-05-26

### Behoben

**„🌍 Welt zentrieren" zeigte stereographische Pol-Sicht statt Welt-Karte**
(Marc-Bug v0.9.89). Ursache: bei festem `zoom=1.5` + `pitch=0` + `center=
Track-Mittelpunkt` rechnet Mapbox' Globe-Projektion eine „von genau oben
auf den Track-Punkt"-Sicht — bei Track-Latitude ~40° sah das aus wie eine
verkippte Polkappe (Marc-Wortlaut „nach Südpol").

**Fix:** statt fester Zoom-/Center-Werte nutzt der Button jetzt
`fitBounds` auf eine **Welt-Bbox** [`[-170,-60]…[170,75]`]. Mapbox
berechnet daraus den passenden Zoom + Center für den aktuellen Viewport
— ergibt zuverlässig eine klassische Welt-Karte mit Greenwich-Mitte und
allen Kontinenten sichtbar. Der berechnete Zoom landet im `anim-zoom`-
Slider; im KF-Modus wird der Snapshot mit dem Mapbox-Auto-Zoom angelegt.

## [0.9.89] – 2026-05-26

### Hinzugefügt

**Quick-Action „🌍 Welt zentrieren"** in der Animator-Kamera-Sektion
(Marc-Wunsch). Klick setzt die Map auf eine zentrierte Welt-Sicht:
- **pitch = 0°** (sonst kippt Mapbox die Erde nach unten weg, weil die
  Kamera von schräg oben guckt — Standardverhalten der globe-Projektion)
- **bearing = 0°**
- **zoom = 1.5** (ganze Erde sichtbar)
- **center = Track-Bbox-Mittelpunkt** (= dein Track in der Mitte der Erde)

Plus: globale Slider werden mit-aktualisiert (Pitch + Zoom). Im KF-Modus
wird zusätzlich ein „Welt-KF" am aktuellen Scrubber-Anchor angelegt —
perfekt als Start-KF für einen Globe-→-Track-Flug.

## [0.9.88] – 2026-05-26

### Geändert

**Cineastischer-Flug-Toggle nur im KF-Modus sichtbar** (Marc-Feedback).
Im Classic-Modus haben die impliziten Default-KFs (seit v0.9.86) identischen
Zoom → Δzoom=0 → van-Wijk wird nie aktiv → Toggle wäre nutzlos UI-Clutter.
Checkbox wird jetzt automatisch ein-/ausgeblendet wenn der Master-KF-Editor-
Toggle umgelegt wird.

## [0.9.87] – 2026-05-26

### Hinzugefügt

**Doppelklick auf einen Slider = Reset auf Default-Wert** (Marc-Wunsch,
klassisches UX-Pattern). Globaler Listener in `ui/js/util.js`, gilt für
**alle** Range-Slider in der App — Animator (Pitch, Rotation, Zoom, Spin,
Linienbreite, Glow, …), Tour-Map und Geotagger. Beim Doppelklick wird
der `defaultValue` (HTML-`value`-Attribut beim Mount) wiederhergestellt
und ein `input`+`change`-Event dispatcht, damit alle `bindSetting`/
`onChange`-Hooks reagieren wie bei einem manuellen Slider-Move.

## [0.9.86] – 2026-05-26

### Geändert

**Refactor: Classic-Modus = KF-Modus mit impliziten Default-KFs** (Marc-Idee
„intern nur ein Modus, der User hat weiterhin beide"). Bisher hatten wir
zwei getrennte Code-Pfade — Classic-Modus (globale Slider) und KF-Modus
(per-KF-Werte). Das führte regelmäßig zu Bugs wenn ein neues Feature
(Spin, van-Wijk, Cinematic-Flyto) nur im KF-Pfad eingebaut wurde und der
Classic-Pfad vergessen wurde (siehe v0.9.85 für den Zoom-Slider-Fall).

**Was sich intern ändert:**
- Neue `buildDefaultEvents()` baut 2 implizite Keyframes (anchor=0 + anchor=1)
  aus den globalen Slider-Werten (pitch, rotation, zoom, camera_follow).
- Neue `getEffectiveEvents()` returnt entweder User-KFs (wenn Editor an UND
  events vorhanden) oder die impliziten Defaults.
- `scrubPreview`, `runTimelinePreview` und die Render-Bridge nutzen alle
  `getEffectiveEvents()` — kein Sonderfall mehr für Classic.
- Bisher in v0.9.85 eingebaute Classic-Zoom-Special-Logik zurückgebaut
  (= einfacher).

**Was sich für den User ändert: nichts**
- UI-Toggle „Keyframe-Editor" bleibt unverändert.
- Im Classic-Modus wirken alle Slider (Pitch, Rotation, Zoom) exakt wie
  vorher — nur intern werden sie in 2 implizite KFs übersetzt.
- Bestehende Projekte ohne KFs funktionieren weiter (= Classic-Verhalten
  über die impliziten Defaults).

**Vorteile:**
- Bugs wie v0.9.85 (Slider im Classic-Modus ignoriert) können konzeptuell
  nicht mehr passieren.
- Neue KF-Features (Spin pro KF, van-Wijk-Flyto, Cinematic-Toggle) wirken
  jetzt automatisch auch im Classic-Modus über die impliziten Defaults.
- Render und Preview teilen sich exakt einen Interpolations-Pfad.

## [0.9.85] – 2026-05-26

### Behoben

**Classic-Modus ignorierte den Zoom-Slider im Probelauf** (Marc-Bug).
Wenn der KF-Editor aus war, hat `runTimelinePreview` (Probe-Lauf) und
`scrubPreview` (manueller Scrub) immer `_previewFitBase + interp.zoom_offset`
genommen. Im Classic-Modus gibt's keine KF-Zoom-Events → `zoom_offset = 0`
→ effektiv `zoom = _previewFitBase` (= Auto-Fit-Zoom). Der `anim-zoom`-Slider
in der Kamera-Sektion wurde komplett ignoriert.

**Fix:** Beide Code-Pfade unterscheiden jetzt zwischen Modi:
- **KF-Modus** (Editor an): `zoom = _previewFitBase + zoom_offset` (KF-driven, wie vorher).
- **Classic-Modus** (Editor aus): `zoom = parseFloat(anim-zoom.value)` (absoluter Mapbox-Zoom direkt vom Slider).

Wenn du jetzt den `anim-zoom`-Slider im Classic-Modus auf z.B. 14 setzt
und Probe-Lauf startest, hält die Karte den Zoom auf 14 (statt
auf Auto-Fit-Zoom zurückzufallen).

## [0.9.84] – 2026-05-26

### Behoben

**Probe-Lauf zoomt zwischen KFs noch weiter raus als der niedrigste KF-Zoom**
(Marc-Bug). Ursache: der **van-Wijk-Flug-Algorithmus** wird bei Δzoom>3 aktiv
und folgt einer **Bogen-Trajectory** — mathematisch korrekt (siehe Mapbox'
`flyTo`), aber die maximale Rauszoom-Tiefe kann **unter beide Endpunkte
gehen**. Bei extremen Sprüngen sieht das aus als „zoomt zu weit raus".

**Fixes:**

- **Threshold von 3 → 5**: van-Wijk wird jetzt nur noch bei wirklich
  extremen Zoom-Sprüngen aktiv (Globe→Detail). Bei normalen Übergängen
  (Δzoom 3-5) bleibt lineare Interpolation. Spürbar weniger „Hollywood-
  Rauszoom" bei typischen Track-Animationen.

- **Neuer Toggle „🎬 Cineastischer Flug"** in der Kamera-Sektion (default
  AN). Aus → keine van-Wijk-Bogen-Trajectory, immer strikte lineare
  Zoom-Interpolation. So kannst du selbst entscheiden:
  - **An** (Default): cineastischer Flug bei großen Sprüngen, wie YouTube-
    Travel-Channels.
  - **Aus**: strikt linear, Zoom geht nie unter den niedrigsten KF-Wert.

- `interpolate_properties` (Python) und `interpolateCameraJs` (JS) kriegen
  einen `cinematic_flyto`-Param; im UI wird der Toggle pro Projekt
  persistiert.

## [0.9.83] – 2026-05-26

### Hinzugefügt

**Spin als 5. KF-Property** (Marc-Spec): jeder Keyframe kriegt einen
eigenen Spin-Wert (°/s) im KF-Editor. Zwischen KFs wird linear interpoliert.
So sind pro Segment unterschiedliche Drehgeschwindigkeiten möglich —
KF1 schneller Spin (Globe-Phase), KF2 Spin=0 (am Track angekommen).

- **Neuer Event-Typ** `kind="spin"` mit `value` (deg/sec). Wird beim
  Snapshot automatisch mit dem aktuellen globalen Slider-Wert angelegt
  (oder 0 als Default).
- **Spin-Slider im KF-Editor** (-60…+60 °/s) — als 5. Slider nach
  Pitch/Bearing/Zoom.
- **Linear-Interpolation** zwischen KFs in `interpolateCameraJs` +
  `interpolate_properties` (Python).
- **Trapezregel-Integration** pro Frame in step() (Preview) und in
  `advanceFrame` (Render). `accumulated_spin += 0.5×(curr+prev)×dt`.
  Bearing wird mit dem akkumulierten Wert addiert.
- **Globaler Slider** bleibt als Fallback: wenn KEINE spin-Events da sind,
  wirkt der globale Spin wie vorher. Sobald ein KF einen spin-Wert hat,
  übernimmt der.

### Geändert

- `interpolate_properties` returnt jetzt 5-Tupel `(pitch, bearing,
  zoom_off, center, spin)`. Alle Caller in `core/animator.py` angepasst.
- `KF_LANES` um `"spin"` erweitert (= 5 Lanes statt 4 in der Multi-Lane-
  Timeline).
- `clusterPropsAt` packt jetzt auch das `spin`-Property pro KF aus.

## [0.9.82] – 2026-05-26

### Hinzugefügt

**Spin-Slider** (Beta-Tester-Idee „Erde dreht sich im Weltall"): neuer Setting
`Spin` in der Animator-Kamera-Sektion, Range −60…+60 °/s, Default 0.
Wirkt **generisch und phase-unabhängig** — wird in Intro, Animation und
Hold gleichermaßen pro Frame on top auf den Bearing addiert. Auf der
Globe-View sieht's wie eine rotierende Erde aus, auf Track-Level wie
eine schwenkende Drohne.

- Spin **addiert sich** zu KF-Bearings und zum bestehenden Rotation-Sweep
  (alle drei sind unabhängig kombinierbar).
- Positive Werte = im Uhrzeigersinn, negative = gegen.
- Wirkt sowohl im Preview-Probe-Lauf als auch im finalen Render (WYSIWYG).
- 30 °/s = eine volle Umdrehung in 12 Sekunden (cineastisch).

Tour-Map ignoriert das Setting (Single-Frame, kein Zeit-Begriff).

## [0.9.81] – 2026-05-26

### Behoben

**Phase-2-Foto-Pop-In funktionierte gar nicht im Probe-Lauf** (Marc-Bug
v0.9.80, 3-Schritte-Test):

1. App-Start, „Alle aus" → „Alle an" → Probe-Lauf → keine Fotos sichtbar
2. Stop in Mitte, „Alle aus" → „Alle an" → linke Pins sichtbar (gut)
3. Probe-Lauf weiterlaufen → keine NEUEN Pins erscheinen

Symptome erklärten sich durch: `setMarkerAnchor` wurde im Probe-Lauf
**nie** ausgeführt → der Filter blieb auf dem Wert vom letzten Re-Apply.

**Ursache:** Scope-Bug. Die `_animPhotos*`-Funktionen (`_animPhotosShow`,
`_animPhotosUpdateMarkerFilter`, …) sind innerhalb eines `if (...) { ... }`
-Blocks definiert, der wiederum in einem `onMapReady`-Callback steckt.
`runTimelinePreview` + `scrubPreview` + `drawPreview` liegen außerhalb
dieses Blocks — der Closure-Scope greift nicht, jeder Zugriff wirft
`ReferenceError`. Die umschließenden `try/catch (_) {}`-Blocks haben
den Error silent verschluckt → setMarkerAnchor wurde nie gerufen.

**Fix:** `window.__rzAnimPhotos = { show, list, applyToMap,
updateMarkerFilter, markerAnchorFromTimeline }` als globale API exposen,
und alle Call-Sites umstellen:
- `scrubPreview` ruft `window.__rzAnimPhotos.updateMarkerFilter(anchor)`
- `runTimelinePreview` step() ruft `PhotoPins.setMarkerAnchor` direkt
  mit dem schon berechneten `markerReal`, aber checkt `__rzAnimPhotos.show()`
- `drawPreview` (Track-Reload) ruft `__rzAnimPhotos.applyToMap()`
- Probe-Lauf-Ende restored Filter auf Scrubber-Position

Plus: alle `catch (_) {}`-Stellen sind jetzt `catch (e) { console.warn(…, e); }`
damit zukünftige Scope-/Type-Fehler nicht mehr stumm verschwinden.

## [0.9.80] – 2026-05-26

### Behoben

**Phase-2-Foto-Pop-In wirkte nicht** (Marc-Bug v0.9.79): „alle bilder zu sehen,
auch bevor der track vorbeikommt". Ursache: bei Foto-Load **bevor** der
Track-Coord-Array da war, blieben alle `track_anchor` auf 0 → der Filter
`["<=", 0, anyMarkerAnchor]` traf alle Pins ab Frame 0.

**Fixes:**
- `drawPreview` (= Track-Load-Pfad) ruft jetzt `_animPhotosApplyToMap()`
  nach 50 ms — sobald der Track da ist, werden die `track_anchor` neu
  berechnet und der Filter greift.
- `_animPhotosApplyToMap()` setzt jetzt NUR dann einen Filter wenn der
  Track wirklich da ist (`currentCoords.length >= 2`). Ohne Track:
  permanent sichtbar (Phase-1-Verhalten) statt blockierter Filter.
- Debug-Logs in DevTools-Console: `[anim-photos]` zeigt n_photos +
  n_coords + markerAnchor, `[photo-pins] computed track_anchors:` listet
  die berechneten Anchors pro Foto. Damit kannst du selbst diagnostizieren
  ob die Werte passen.
- `setMarkerAnchor` Fehler werden jetzt geloggt (vorher silent).

## [0.9.79] – 2026-05-26

### Hinzugefügt

**Foto-Pins erscheinen jetzt zeitlich passend zur Track-Animation (Phase 2)**
(Marc-Wunsch: „mach jetzt so, dass die fotos an der richtigen stelle erst
erscheinen"). Im **Animator-Preview + im Render-Output** ploppt jedes Foto
genau in dem Moment auf, in dem der Track-Marker an der Foto-Position vorbei
kommt — und bleibt danach sichtbar.

- **Foto→Track-Mapping**: pro Foto wird der nächstgelegene Track-Punkt
  bestimmt (Euklidische Distanz auf lon/lat → bei m-genauer Genauigkeit OK).
  Daraus ergibt sich der `track_anchor` ∈ [0, 1]. JS-Helper
  `PhotoPins.computeTrackAnchors` + Python-Helper `core/photos.py`.
- **Mapbox-Filter**: Symbol-Layer kriegt einen `["<=", ["get",
  "track_anchor"], markerAnchor]`-Filter. Live-Update über
  `PhotoPins.setMarkerAnchor(map, anchor)` — sehr günstig (GPU-Pass, kein
  Re-Attach).
- **Animator-Preview**: `scrubPreview` + `runTimelinePreview`-Step + Probe-
  Lauf-Ende rufen das Filter-Update mit der aktuellen Marker-Position.
  Beim manuellen Scrubben sieht man die Pop-Ins exakt da wo's später im
  Video passiert.
- **Animator-Render**: HTML-Template definiert `window.__photoPinsAnchorFilter`,
  `advanceFrame` ruft es mit `markerAnchor = safe/(totalPoints-1)` pro
  Frame. WYSIWYG zwischen Preview und Final-Video.
- **Tour-Map**: unverändert — Single-Frame-Output zeigt weiter alle Fotos
  permanent (Phase-1-Verhalten, weil's keine Zeit-Achse gibt).

### Architektur

- `core/photos.py::compute_track_anchors(photos, coords)` — mutiert die
  Photo-Dicts in-place mit `track_anchor`.
- `PhotoPins.attachToMap(map, photos, {coords, markerAnchor, sizePx})` —
  neue `coords`/`markerAnchor`-Felder im opts-Objekt. Wenn weggelassen
  (= Tour-Map-Modus), wird kein Filter gesetzt.
- Track-Anchor wird NICHT persistiert — Track-spezifisch, bei jedem
  attachToMap neu berechnet (sub-ms für 100 Fotos × 800 Punkte).

## [0.9.78] – 2026-05-26

### Behoben

**Foto-Visibility-Checkboxes hatten keine Wirkung in der Preview** (Marc-Bug
v0.9.77). Tatsächlich versteckter Wurzelbug seit v0.9.74:
`saveActiveProjectPatch` überschrieb `_activeProject.photos` immer mit der
stripped Variante (ohne base64-Thumbs, weil die zu groß für sessions.json
sind). Beim nächsten `attachToMap`-Call waren keine Thumbs mehr da → kein
Image lädt → loadedOk=0 → der Symbol-Layer wird gar nicht erst hinzugefügt
→ keine Pins auf der Karte.

**Fix:** neuer `persistOnly: true`-Modus in `saveActiveProjectPatch`. Die
Foto-Helper rufen die Funktion jetzt mit diesem Flag — der In-Memory-
Cache mit Thumbs bleibt erhalten, nur die Bridge bekommt die stripped
Version zur Persistierung.

Das war auch der Hauptgrund warum Pins in v0.9.74–v0.9.76 nicht sichtbar
waren (nicht die Race-Condition, die ich in v0.9.76 fixe — die hat
zusätzlich nicht geholfen). Jetzt: Toggle ändert sofort die Karten-Pins,
„Alle aus" leert sie, „Alle an" stellt sie wieder her, Slider-Move
behält sie.

## [0.9.77] – 2026-05-26

### Hinzugefügt

**Per-Foto-Sichtbarkeits-Checkbox + Master-Toggles** (Marc-Spec):

- **Checkbox links vor jedem Foto** in der Sidebar-Liste — togglet die
  Sichtbarkeit dieses einzelnen Fotos auf der Karte. Abgewähltes Foto
  bleibt in der Liste (leicht ausgegraut + grayscaled), aber Pin
  verschwindet aus Preview + Render.
- **„Alle an" / „Alle aus"** als kleine Link-Buttons über der Liste —
  Mass-Toggle für alle geladenen Fotos auf einmal.
- **Counter-Anzeige** zeigt jetzt „X von Y sichtbar" wenn nicht alle aktiv
  sind (sonst weiter „N Fotos").
- Klick auf die Row außerhalb der Checkbox bleibt der Map-Fly-To-Trigger
  (= zur Foto-Position zentrieren).

### Architektur

- Neues Datenfeld `photo.visible: bool` (Default `true` → Backward-Compat
  zu v0.9.74-v0.9.76-Projekten ohne das Feld).
- Persistierung in `project.photos[].visible` — beim Reload wird die
  Sichtbarkeits-Auswahl wiederhergestellt.
- `PhotoPins.attachToMap` filtert intern auf `visible !== false`, sowohl
  beim Image-Load (spart Memory bei abgewählten) als auch beim Symbol-Layer.
- Render-Backend (`core/animator.py` + `core/tourmap.py`) respektiert das
  Flag im JS-Template → WYSIWYG.
- `PhotoPins.renderList(..., onToggle)` neuer 4. Parameter für Checkbox-
  Change-Callback.

## [0.9.76] – 2026-05-26

### Behoben

**Foto-Liste: Zeilen waren unlesbar dünn** (Marc-Bug v0.9.75): Rows nur
2–3 px hoch, Namen und Koordinaten nicht erkennbar. Ursache: keine
`min-height` auf `.photos-list-row` + zu kleine Thumbnails (32×32). Fix:

- Thumbnail-Größe in der Liste **32 → 60 px**, Row-`min-height: 72 px`
- Padding 4 → 8 px, Gap 4 → 10 px, Liste-Max-Height 240 → 320 px
- Schriftgröße Name 12 → 13 px (fett), Koord 10 → 11 px
- **Fallback-Platzhalter** (📷-Tile in grau) wenn das Foto kein Thumb
  liefert (kaputte Datei, RAW ohne Preview etc.) — vorher kollabierte
  die Row ohne Image auf Null-Höhe.

**Foto-Pins waren nicht in der Preview sichtbar** (Marc-Bug v0.9.75):
beim ersten Apply schlug `addSource` / `addLayer` still fehl wenn der
Map-Style noch nicht fertig geladen war (Race-Condition zwischen
Mount + `setTimeout 100 ms`). Plus: Bei einem Map-Style-Wechsel
(Satellite ↔ Streets etc.) sind alle `addImage`/Source/Layer weg —
PhotoPins wusste das nicht und re-attachierte nicht. Fix in
`PhotoPins.attachToMap`:

- **`isStyleLoaded()`-Guard**: bei nicht fertigem Style wartet die
  Funktion via `map.once('idle', …)` und ruft sich selbst neu.
- **Per-Map-Cache** der letzten attach-Parameter + automatischer
  Re-Attach nach `style.load` (Mapbox-Style-Wechsel räumt Sources auf).
- **Beim Apply nach Mount**: `onMapReady(map, …)`-Hook + 200 ms Delay
  damit `sessionActivate` + `_activeProject` garantiert da sind.
- **Defensive zweite isStyleLoaded-Prüfung** nach Image-Load-Promise —
  zwischendurch kann der User einen Style-Wechsel angestoßen haben.
- **Loaded-Counter**: wenn KEIN Image durchkommt, wird der Symbol-Layer
  gar nicht erst hinzugefügt (sonst „Image not found"-Spam).

## [0.9.75] – 2026-05-26

### Behoben

**Layout-Shift in Sidebar nach Foto-Load** (Marc-Bug): nach dem Laden mehrerer
Fotos rutschte die Sidebar nach links und Inhalte wurden abgeschnitten.
Ursache: fehlendes `box-sizing: border-box` + `min-width: 0` auf jeder
Flex-Stufe der `.photos-list-*`-Hierarchie + `outline: dashed` als
Drop-Highlight (kann unter bestimmten Bedingungen das Section-Body über
den Panel-Rand schieben). Fix: hartes `width:100% + box-sizing:border-box +
overflow:hidden + min-width:0` durchgesetzt; Drop-Highlight nutzt jetzt
`box-shadow: inset` statt `outline`. Lange Pfade in der Foto-Liste werden
sauber mit Ellipsis abgeschnitten.

### Geändert

**Foto-Picker mit Wahl: Ordner oder einzelne Dateien** (Marc-Spec). Der
Button heißt jetzt **„📷 Fotos wählen"** und öffnet ein kleines Choice-Modal
mit zwei Optionen:
- **📂 Aus Ordner** — Native Folder-Picker, scannt rekursiv (nicht-rekursiv
  Phase 1) alle Fotos im gewählten Ordner.
- **📷 Einzelne Fotos** — Native File-Picker mit Multi-Select; Filter für
  JPEG/HEIC/RAW.

Modal schließt sich per Klick außerhalb oder ESC. „Aus Geotagger" bleibt
als separater Button daneben.

## [0.9.74] – 2026-05-25

### Hinzugefügt

**Foto-Pins auf der Karte (Phase 1)** — Marc-Wunsch: „Man lädt fotos rein,
und die die passen, erscheinen an der richtigen stelle super klein auf
dem track und bleiben da dann auch." Neue Sidebar-Sektion **📷 Fotos** in
Animator + Tour-Map (Spiegelung). Workflow:

- **Foto-Ordner wählen** (oder Drag&Drop in den Sektion-Bereich): Backend
  scannt alle Foto-Dateien (JPEG, HEIC, RAW: CR3/NEF/ARW/CR2/RAF/RW2/ORF/DNG),
  liest EXIF-GPS, erzeugt 128-px-Thumbnail als base64 data-URL.
- Fotos **mit** GPS erscheinen als kleines Thumbnail auf der Karte an ihrer
  EXIF-Position (auch off-track). Permanent sichtbar.
- Fotos **ohne** GPS werden still übersprungen — Toast „X von Y geladen".
- **📷 Aus Geotagger übernehmen** lädt die im Geotagger-Modul aktuell aktiven
  Fotos und liest deren (frisch geschriebene) GPS-Tags.
- **Größen-Slider** 24–80 px pro Modul (Animator + Tour-Map können
  unterschiedliche Größen haben).
- **Auf Karte anzeigen**-Checkbox pro Modul (Foto-Liste bleibt geladen).
- **Liste der Fotos** in der Sidebar (Thumbnail + Dateiname + Koordinaten);
  Klick auf einen Eintrag fliegt die Karte zur Foto-Position.

### Architektur

- **`project.photos`** (geteilt zwischen Animator + Tour-Map) — nur Pfade,
  GPS + Datum werden persistiert. Thumbnails werden NICHT in `sessions.json`
  gespeichert (würde bei 50 Fotos 5+ MB JSON erzeugen), sondern beim
  Projekt-Aktivieren über `photos_refresh_thumbs` aus dem Disk-Cache
  (`APP_SUPPORT/photo_thumb_cache/`) nachgezogen.
- **Per-Modul-Settings** (`animator.photos_size_px`/`photos_show`,
  `tourmap.photos_size_px`/`photos_show`).
- **Neue Bridge** `photos_load(paths_or_folder)`, `photos_from_geotagger()`,
  `photos_refresh_thumbs(paths)`, `session_update_project_root(patch)`.
- **Neuer Helper** `core/photos.py` (Foto-Loader + Thumbnail-Generator) +
  `ui/js/photos.js` (geteilter Map-Pin-Renderer für beide Module).
- **WYSIWYG** im Render: `core/animator.py` + `core/tourmap.py` injecten die
  Foto-Liste als Mapbox `addImage` + Symbol-Layer mit identischen Größen
  wie im Preview. Animator: permanent ab Frame 0 (keine Zeit-Steuerung in
  Phase 1).

### Geändert

- `update_project_settings(session, project_id, module=None, patch)` —
  `module=None` patcht jetzt direkt auf Projekt-Root (für die geteilte
  `photos`-Liste). Bisherige Modul-Patches unverändert.

## [0.9.73] – 2026-05-25

### Behoben

**Zoom-Keyframes nach Reload reload-stabil** (Marc-Bug "Erde nach Reload viel
kleiner als beim Setzen") — siehe weiter unten. **Erstes Release seit v0.9.40**
(25. Mai vormittags), bündelt alle v0.9.41–v0.9.72 Iterationen + diesen Final-
Fix in einem öffentlichen Build.

### Aus den Zwischenversionen v0.9.68–v0.9.72

- **v0.9.72 (verworfen, durch v0.9.73 abgelöst):** Erster Versuch das Drift-
  Problem zu fixen via `_previewFitBase`-Cache am Probe-Lauf-Anfang. Hat das
  Symptom nicht gelöst — die Ursache lag im persistierten Wert, nicht im
  Preview-Timing. Cache-Logik bleibt drin (verhindert Sprünge mid-flight).
- **v0.9.71 — Render vs. Preview KF-Positions-Match** (Marc-Bug „der render
  passt nicht zur preview"): Render-Backend hat `timeline_progress` als
  Track-Position interpretiert (in 3 Phasen segmentiert), Preview als reine
  Zeit-Position. Fix: `timeline_progress = frame / (total_frames - 1)` —
  KFs treffen jetzt in beiden Welten den gleichen Punkt.
- **v0.9.70 — Linker Trimmer kürzt jetzt auch Preview-Track** (Marc-Bug
  „schiebe ich den linken trimmer wird der track nicht kürzer"):
  `applyTrimToTrackPreview` ignoriert `show_pretrim_track` (das bleibt
  Render+Playback-only); statischer Trim-Drag-Preview slict immer
  `si..ei+1`.
- **v0.9.69 — Marker-Position phase-aware** (Marc-Bug „am ende der inhold zone
  ist schon ein track gezeichnet"): `trackIdxFromTimelineAnchor` bildet jetzt
  Intro/Anim/Hold-Phasen korrekt auf Trim-Region ab — intro→trimA,
  anim→linear interp, hold→trimB.
- **v0.9.68 — van-Wijk-Fluganimation aktiviert** (vorher seit v0.9.63 inaktiv
  durch zwei Formel-Bugs): (1) Vorzeichen in van-Wijk Eq. 9 falsch
  (`ln(b + sqrt(b²+1))` statt korrekt `ln(-b + sqrt(b²+1))`) → bei Δzoom>3
  wurde S negativ und der Defensive-Fallback auf lineare Interpolation
  griff. (2) Cosh-Konstante in Eq. 6 missbraucht (`cosh(rho·s+r0)` statt
  konstantem `cosh(r0)`) → Marker landete weit hinter dem Endpunkt. Nach
  diesen Fixes greift die echte van-Wijk-Kurve und Globe→Track sieht
  endlich aus wie Mapbox-flyTo.

### Behoben (v0.9.73-Kern)

**Zoom-Keyframes nach Reload reload-stabil** (Marc-Bug "Erde nach Reload viel
kleiner als beim Setzen"). Zoom-Events speichern jetzt zusätzlich zum
relativen `value_offset` einen absoluten `value_absolute` (= Mapbox-Zoom zur
Set-Zeit). Beim Anwenden wird `value_absolute` bevorzugt:
`effective_offset = value_absolute - currentFitBase`. So bleibt der vom User
gespeicherte Zoom-Punkt stabil, auch wenn `_fitZoomBase` zwischen Set- und
Reload-Zeit driftet (z.B. wegen Fenster-Größe, Container-Pixel-Ratio,
moveend-Timing). Vorher waren Reload und Projektwechsel ein Glücksspiel —
der gespeicherte relative Offset traf bei einer leicht anderen Auto-Fit-
Base auf einen ganz anderen absoluten Zoom-Punkt.

- `snapshotKeyframe` + `createSingleProperty(kind="zoom")` + KF-Zoom-Slider-
  Handler + From-Map-Button schreiben jetzt beide Felder.
- Neue Helfer `_zoomEffectiveOffset` / `_interpZoomOffset` (JS) +
  `_zoom_effective_offset` / `_interpolate_zoom_offset` (Python).
- `_maybeFlyToInterp` (JS) + `_maybe_flyto_interp` (Python) nutzen den
  effektiven Offset für die van-Wijk-Kurve.
- `updateKeyframeFields` füllt `zoom_offset` ↔ `zoom_absolute` beidseitig auf,
  damit alle Call-Sites kompatibel bleiben.
- Migration alter `camera`-Events: kein `value_absolute` (lazy beim ersten
  Apply auf Basis von `value_offset + fitBase` ergänzt). Erst nach manuellem
  Neu-Setzen eines KFs greift die Reload-Stabilität rückwirkend.

Spiegelt sich identisch im Render-Backend (`core/timeline.py`) damit Preview
und Render-Output WYSIWYG-übereinstimmen.

## [0.9.67] – 2026-05-25 22:55

### Hinzugefügt

**Undo/Redo in allen drei Modulen** (Marc-Idee, weiterentwickelt von v0.9.66):
50 Schritte pro Modul, Cmd/Ctrl+Z bzw. Cmd/Ctrl+Shift+Z (Mac) / Ctrl+Y (Win).
Globaler Keyboard-Listener in `ui/js/util.js` routet die Shortcuts zum aktuell
sichtbaren Modul-Panel.

- **Animator:** KFs, Trim-Handles, Intro/Dauer/Hold, Master-Toggle
- **Tour-Map:** komplette Settings (Farbe, Linien-Stil, Glow, Pin, Stats-Box…)
- **Geotagger:** Offset-Slider, Referenz-Path/Mode, Folder-Recursive — **OHNE**
  EXIF-Schreiben (destruktiv → separater Restore-Workflow, nicht in dieser Iter.)

### Geändert

**Architektur: generischer Undo-Controller** in `ui/js/util.js`
(`createUndoController(opts)`): Snapshot/Apply als Callbacks, 800 ms Throttle
für Drag-Operationen (= 1 Snapshot pro „Edit-Session"), Reentrancy-Guard
während `apply()` (verhindert dass eigene dispatched-Events einen neuen Push
auslösen). Modul-Registry: `window.__rzUndoControllers = { animator, tourmap,
geotagger }`. Pro Modul eigener Stack, Reset bei Projekt-Wechsel — kein Undo
über Projekt-Grenzen möglich.

## [0.9.66] – 2026-05-25 22:45

### Hinzugefügt

**Undo/Redo im Animator** (Marc: „wir haben ja gar kein Undo"): 50 Schritte
(Standard für Creative-Tools), Cmd/Ctrl+Z. Snapshot vor jeder Mutation;
800 ms-Throttle blockiert Rapid-Fire-Events bei Drag-Operationen → nur der
„Vorher"-State wird gespeichert.

Hooks: `snapshotKeyframe`, `createSingleProperty`, `deleteKeyframe`,
`deleteEventOne`, `clearAllKeyframes`, `moveEvent`, `updateKeyframeAnchor`,
`updateKeyframeFields`, `onTrimChange`, `anim-dur/hold/intro`-Slider,
`anim-kf-enabled` Master-Toggle. Toast-Feedback zeigt was rückgängig gemacht
wird („↶ Keyframe gesetzt", „↷ Trim verschoben", …).

## [0.9.65] – 2026-05-25 22:15

### Behoben

**van-Wijk-Flug-Kurve aus v0.9.63 rechnet mit falscher Skala** (Marc-Bug):
Die Formel ist NICHT translation-invariant in `w = 1/2^z` — sie braucht
ABSOLUTE Mapbox-Zoom-Werte (0–22), nicht unsere `zoom_offset` (relativ
zu Track-fit-base). Bisher gaben wir die Offsets rein → die Kurve hatte
falsche Krümmung, in der Praxis wirkte's wie kein van-Wijk.

Fix:
- `interpolateCameraJs` und `_maybeFlyToInterp` nehmen jetzt einen
  optionalen `fitZoomBase`-Parameter (= aktueller Track-Auto-Fit-Zoom)
- Konvertierung `absolute = offset + fitBase` für die van-Wijk-Berechnung,
  Ergebnis-Zoom zurück zu `offset = abs - fitBase`
- `scrubPreview` und `runTimelinePreview` reichen `effectiveFitZoomBase()`
  als 6. Argument durch
- Backend (`core/timeline.py`): `interpolate_properties` und
  `_maybe_flyto_interp` mit `fit_zoom_base: float | None = None`
- `core/animator.py` reicht `zoom` (= track-fit-base) bei beiden
  interpolate_properties-Aufrufen durch (Prewarm + Frame-Loop)

Ohne fit_zoom_base (None) → kein van-Wijk, lineare Interpolation wie
vor v0.9.63. Damit ist Backward-Compat gewährleistet.

## [0.9.64] – 2026-05-25 21:50

### Behoben

**Map-Bewegung schrieb ungewollt in KF1** (Beta-Tester/Marc-Bug): Beim
Animator-Mount oder Projektwechsel wurde der erste Keyframe automatisch
selektiert (via `autoSelectFirstKfIfNeeded` aus v0.9.17). Folge: jede
Map-Bewegung, jeder Pitch/Zoom-Slider triggerte `_syncMapStateToUi`, der
schrieb dann ungewollt in KF1.

Marc-Wortlaut: „Wenn man etwas ändert ohne einen KF angewählt zu haben,
soll sich kein KF ändern. Aber wenn man will kann man mit diesen
Änderungen einen KF erstellen."

Fix: `autoSelectFirstKfIfNeeded()` zu No-Op gemacht. Nach Mount /
Projekt-Load ist KEIN KF mehr selektiert — der KF-Editor zeigt seine
Empty-Hint („Klicke auf KF-Marker oder mache Snapshot"). Map-Bewegung
wirkt sich nur auf die Vorschau aus, nicht auf KFs.

Zum Editieren: User muss explizit
- auf einen KF-Marker in der Timeline-Bar klicken (selektiert → Map-Sync aktiv)
- oder „📍 Hier Keyframe"-Button drücken (legt neuen KF aus aktuellem Map-State an)

Die Marc-Beschwerde aus v0.9.17 („Slider nicht sichtbar nach Laden") ist
heute durch die polished Empty-Hint-UI (`#anim-kf-empty-hint`) entschärft.

## [0.9.63] – 2026-05-25 21:30

### Behoben

**„Erdkugel→Track"-Flug: Track rutscht aus dem Sichtfeld bis hoher Zoom**
(Marc-Bug): Zwei aufeinanderfolgende KFs (z.B. Globe `zoom=0` + Detail
`zoom=13`) wurden bisher **linear** in center + zoom interpoliert. Das
Problem: bei mittleren Zooms (≈6) ist die linear interpolierte Center-
Position weit weg vom Ziel-Track aber Mercator-Skala zeigt schon mehr
Detail → der Track ist außerhalb des Viewports. Erst bei hohem Zoom (≈11+)
nähert sich der Center genug an, dass der Track wieder reinkommt.

Fix: **van-Wijk-Algorithmus** (= Mapbox-`flyTo`-Verhalten) für gekoppelte
Interpolation. Bei Zoom-Sprung > 3 Levels zwischen zwei KFs mit beidem
center+zoom-Wert läuft die Kurve „Zoom-Out + Pan + Zoom-In" smooth durch,
sodass der Ziel-Punkt sichtbar bleibt. Reference: van Wijk + Nuij 2003,
„Smooth and Efficient Zooming and Panning".

Implementation in beiden Schichten:
- `modules/animator/ui/module.js`: neue Helper `_vanWijkInterp` +
  `_maybeFlyToInterp`. In `interpolateCameraJs` wenn beide KFs am selben
  Segment beides haben, gekoppelt interpolieren.
- `core/timeline.py`: gespiegelte Helper `_van_wijk_interp` +
  `_maybe_flyto_interp`. In `interpolate_properties` analog. Damit ist
  Render-WYSIWYG zur Preview gegeben.
- Threshold `rho = 1.42` (Mapbox-Default), `_FLYTO_ZOOM_DELTA_THRESHOLD = 3.0`.
- Kein Effekt bei kleinen Zoom-Sprüngen (≤ 3) — bisheriges lineares Verhalten.
- Per-Property-Edits (nur zoom oder nur center): linear wie bisher (van-Wijk
  braucht beide).

## [0.9.62] – 2026-05-25 20:50

### Behoben

**Intro-Region wurde bei Re-Mount / Projektwechsel nicht angezeigt**
(Marc-Bug): An zwei Stellen (`_animOnProjectChanged` Zeile 3194,
sessionActivate-Callback Zeile 3769) wurde `setTrackFraction(trackFraction())`
nur mit einem Argument gerufen — das zweite (`introFraction()`) war seit
v0.9.59 nötig, sonst bleibt `ti=0` und die Intro-Region wird nicht
gezeichnet.

Fix: beide Stellen auf `setTrackFraction(trackFraction(), introFraction())`
umgestellt — Intro-Region erscheint jetzt auch nach Tab-Wechsel +
Projektwechsel + App-Neustart korrekt.

## [0.9.61] – 2026-05-25 20:30

### Hinzugefügt

**ExifTool ist jetzt im App-Bundle drin (macOS + Windows)** — Out-of-Box-
Support für RAW-Foto-Metadaten + GPS-Schreiben in HEIC + Video-Metadaten,
ohne dass User extra was installieren müssen.

- macOS: ExifTool 13.58 Perl-Distribution (~20 MB) via System-Perl
- Windows: ExifTool 13.58 portable .exe mit eingebautem Perl (~34 MB)
- Linux: **kein Bundling** — Linux-User installieren via System-Paketmanager
  (`apt install libimage-exiftool-perl` / `dnf install perl-Image-ExifTool` /
  `pacman -S perl-image-exiftool`). Doku im `docs/USER_GUIDE.md` Linux-Sektion.

Marc-Regel 2026-05-25:
„Linux-User sind eh freaks, dann kriegen die nur eine Doku was sie machen
müssen, fertig aus." → gilt jetzt als globale Cross-Platform-Bundle-Strategie.

Implementation:
- `vendor/exiftool/{macos,windows}/` enthält die Binaries (NICHT in git,
  via `scripts/setup_vendor_exiftool.sh` lokal/CI nachgeladen).
- `ReisezoomGPSStudio.spec` packt plattform-spezifisch ein nach `exiftool/`
  im App-Bundle.
- `core/exif.py` neue `_bundled_exiftool()`-Funktion: sucht zuerst im
  PyInstaller-`sys._MEIPASS`, dann im Dev-`vendor/`-Pfad, dann erst im
  System (`shutil.which("exiftool")` + Homebrew-Fallbacks).
- `build.sh` ruft Setup-Script auf wenn `vendor/exiftool/` fehlt.
- Credits-Block im About-Modal um „gebündelt auf macOS + Windows" ergänzt,
  plus pillow-heif/libheif-Eintrag nachgereicht (war seit v0.9.57 fällig).

Bundle-Größe: macOS 223 MB → ~243 MB (+20 MB), Windows analog +34 MB.

## [0.9.60] – 2026-05-25 20:00

### Behoben

**KF-Marker direkt auf einem Trim-Handle nicht klickbar** (Marc-Bug):
Trim-Handles deckten die volle Timeline-Höhe ab (`top:0; height:100%`) mit
`z-index:7` — saß ein Cluster-Marker (in der oberen Cluster-Row, 26 px hoch)
direkt auf einem Trim-Handle-Anchor, fing das Handle den Click ab und der
KF konnte nicht selektiert werden.

Fix: `.timeline-trim-handle` startet jetzt erst UNTER der Cluster-Row
(`top: 30px; height: calc(100% - 30px)`). Cluster-Row bleibt für KF-Click
frei, Trim-Drag funktioniert weiterhin im Lane-Bereich darunter.

### Hinzugefügt

**Mini-Reset-Knopf „↺ 0°" neben dem Pitch-Slider im KF-Editor**
(Marc-Bug Erdkugel): Bei Welt-/Erdkugel-Sicht (Mapbox-Zoom < ~2) tilted
ein Pitch > 0 die Globe-Projection → die Erde erscheint im unteren
Drittel des Viewports. Der Knopf setzt Pitch auf 0 mit einem Klick, der
Slider-Event-Dispatch sorgt automatisch für KF-Update + Preview-Scrub.

Affected: `modules/animator/ui/module.js` Editor-HTML + Reset-Handler,
`modules/animator/ui/module.css` `.kf-reset-btn`-Styling, i18n DE/EN/ES
`animator.kf.pitch_reset_tip`.

## [0.9.59] – 2026-05-25 19:30

### Hinzugefügt

**Intro-Hold am Anfang, analog zum Outro-Hold** (Beta-Tester-Wunsch): Neuer
`intro_s`-Slider neben Dauer/Hold. Marker hält am `trim_start` für die
angegebenen Sekunden bevor die Anim-Phase losläuft. Erlaubt langsame
Setup-Shots / Kamera-Aufzüge (z.B. Erdkugel → Routenstart-Zoom) ohne
dass der Track schon weiterläuft.

Render-Output: `intro_s + dur_s + hold_s` Sekunden (vorher: `dur + hold`).

Timeline-Visuals (analog zur Hold-Region rechts):
- Hellblaue **Intro-Region** links auf der Timeline
- **Anim-Start-Trenner** (hellblau) bei `ti = intro/total` der virtuellen Achse
- Trim-Handles sitzen in der ANIM-REGION `ti..tf` (mit Intro: rücken nach rechts)
- Intro-Region füllt 0..linker_Trim-Handle (mirror der Hold-Region)

Affected:
- `core/animator.py`: `AnimatorConfig.intro_s: int = 0`, Frame-Loop läuft
  jetzt drei Phasen (intro → anim → hold). `timeline_progress` für KFs:
  intro 0..1 → 0 bis trim_start; anim 0..1 → trim_start bis trim_end;
  hold 0..1 → trim_end bis 1.0.
- `app.py`: `intro_s` in DEFAULT_SETTINGS + Bridge.
- `modules/animator/ui/module.js`: neuer `anim-intro`-Slider in `.row-3`,
  `introFraction()`-Helper, `runTimelinePreview`-Step rechnet drei Phasen,
  `setTrackFraction(tf, ti)`-API mit beiden Bruchteilen.
- `ui/js/timeline.js`: `_renderIntroUi()` + `tl-intro-region` +
  `tl-anim-start` Elements, `setTrimVisual` skaliert Handles in `ti..tf`,
  Drag-Constraint analog. `setTrackFraction(tf, ti)` neue Signatur.
- `ui/css/timeline.css`: `.timeline-intro-region` + `.timeline-anim-start`
  (hellblau statt orange).
- `ui/css/app.css`: `.row-3` für 3-Spalten-Slider-Reihe.
- i18n DE/EN/ES: `animator.field.intro`, `animator.timeline.anim_start_tip`.

## [0.9.58] – 2026-05-25 18:30

### Behoben

**Keyframe-Zoom-Slider sprang Scrubber zurück auf vorherigen KF**
(Beta-Tester-Bug-Report): Mit zwei KFs (z.B. KF1 = Erdkugel, KF2 = Routenstart)
verschob die Zoom-Slider-Bewegung den Scrubber **zurück auf KF1**, statt
auf dem aktiven KF zu bleiben.

Ursache: Zoom-Slider-Handler indexierte `getTimelineEvents()` mit
`_selectedKfIdx`, das aber ein **Cluster-Index** ist (= Index in
`clusterAnchors()`), nicht in der flachen Events-Liste. Pro KF gibt's
4 Events (pitch/bearing/zoom/center), also lief der Index falsch:
Cluster-Idx 1 traf `events[1]` = bearing-Event von KF1 (anchor=0),
und `scrubPreview(0)` schickte den Scrubber zurück zum KF1.

Jetzt: Lookup via `clusterAnchors()[idx]` wie bei Pitch/Bearing-Slider.

Affected: `modules/animator/ui/module.js` Zoom-Slider in
`bindKeyframeEditor()`.

## [0.9.57] – 2026-05-25 18:00

### Behoben

**HEIC-Fotos (iPhone) zeigten kein Thumbnail im Geotagger ohne installiertes
exiftool** (Beta-Tester-Bug-Report): Vorher liefen `.heic`/`.heif` durch
`extract_raw_preview()` → das braucht exiftool. Wenn User kein exiftool
hat (Default-Mac ohne Homebrew, Standard-Windows), blieben Tiles schwarz
und der Loader lief endlos.

Jetzt: **pillow-heif** (libheif-Plugin für Pillow) ist im Bundle drin,
damit funktionieren HEIC-Fotos out-of-the-box ohne exiftool.

- HEIC/HEIF aus `RAW_EXTS` rausgezogen → eigenes `HEIF_EXTS` + `is_heif()`-Check
- Neue Helfer `extract_heif_thumbnail()`, `_heif_read_datetime()`,
  `_heif_read_gps()` arbeiten direkt mit pillow-heif (in-process)
- Routing in `read_datetime`/`read_gps`: pillow-heif zuerst, exiftool als
  Fallback (z.B. wenn HEIF-Plugin doch nicht lädt)
- Thumbnail-Pipeline (`_photo_thumbnail_data_url`) nutzt für HEIC den
  dedizierten Pfad — direktes Pillow-Öffnen via pillow-heif
- Phase-1-Registrierung (`geotagger_register_photos`) skipt HEIC nicht
  mehr wegen fehlendem exiftool (HEIC braucht keins für Read)
- `pillow-heif>=0.16` in `requirements.txt` + `pillow_heif` in PyInstaller-
  `hiddenimports` + `collect_data_files("pillow_heif")` für native libheif

### Hinweis Schreiben

GPS in HEIC-Dateien zurück**schreiben** geht weiterhin nur mit exiftool —
pillow-heif kann das nicht. Wenn der User HEIC-Fotos geotaggen will und
kein exiftool installiert hat, kommt der bestehende `ExifToolMissingError`
mit Hinweis-Text. Read-Path ist aber jetzt unabhängig davon.

## [0.9.56] – 2026-05-25 17:10

### Behoben

**Preview zeigte Pre-Trim-Portion nie an, egal ob Checkbox an/aus war**
(Marc-Bug zu v0.9.55): `runTimelinePreview`-Step und `applyTrimToTrackPreview`
ignorierten das `show_pretrim_track`-Setting — Linie startete in der
Preview immer am Trim-Start, nie am Track-Anfang.

Jetzt:
- Neuer Helper `showPretrimTrack()` liest das Projekt-Setting.
- `runTimelinePreview`-Step: `startCoordIdx = showPretrim ? 0 : trim_start`
- `applyTrimToTrackPreview` (Rest-State): slict von 0 statt si wenn Setting an
- `refreshPreviewTrackData` + `scrubPreview` nutzen `lineStartCoordIdx()`-Helper
- Toggle der Checkbox triggert sofort `applyTrimToTrackPreview` (Live-Update)

Damit verhält sich die Preview jetzt identisch zum Render-Output.

## [0.9.55] – 2026-05-25 16:50

### Hinzugefügt

**Option „Track vor Trim-Start zeigen" für den Render** (Marc-Wunsch):
Im Render war die Track-Linie bisher IMMER vom Track-Anfang an sichtbar
(Pre-Trim-Portion = `coords[0..trim_start-1]` als Hintergrund-Linie).
Jetzt gibt's eine Checkbox dafür.

- UI: Neue Checkbox „Track vor Trim-Start zeigen" im Overlay-Settings,
  Default an = bisheriges Verhalten.
- Wenn aus: Linie startet erst am linken Trim-Handle (Pre-Trim-Portion
  komplett ausgeblendet).
- Wirkt auf den Render-Output (sowohl Mapbox- als auch Alpha-Modus).
- Persistiert pro Projekt als `animator.show_pretrim_track`.

Implementation:
- `core/animator.py`: `AnimatorConfig.show_pretrim_track: bool = True`,
  HTML-Template kennt jetzt `SHOW_PRETRIM_TRACK` + `TRIM_START_IDX` JS-
  Konstanten. `advanceFrame` slict ggf. erst ab `TRIM_START_IDX`.
- `app.py`: Default-Setting + Bridge-Param.
- `modules/animator/ui/module.js`: Checkbox `anim-show-pretrim` mit
  bindSetting. Wird beim Render mitgesendet.
- i18n DE/EN/ES: `animator.overlay.show_pretrim`(_tip).

## [0.9.54] – 2026-05-25 16:20

### Geändert

**Hold-Zone folgt dem rechten Trim-Handle** (Marc-Polish): Bisher saß
der Hold-Trenner fest bei `tf` und es gab eine graue Schraffur zwischen
rechtem Trim-Handle und Hold-Region wenn `trim_end_real < 1`. Sah komisch
aus.

Jetzt:
- Hold-Trenner sitzt visuell am rechten Trim-Handle (= `trim_end * tf`)
- Hold-Region füllt den Bereich vom rechten Trim-Handle bis zum
  Timeline-Ende (1.0)
- Bei Trim-Drag schiebt sich die Hold-Zone automatisch mit
- Rechte Schraffur (zwischen Trim-Ende und altem Hold-Start) entfällt

Konsistent mit dem Scrubber-Verhalten in v0.9.53 — der wandert auch
visuell vom rechten Trim-Handle bis zum Timeline-Ende während der
Hold-Phase.

## [0.9.53] – 2026-05-25 16:00

### Geändert

**Trim-Handles visuell auf Anim-Bereich (0..tf) skaliert, Hold ist
separate Anzeige** (Marc-Klärung — v0.9.52-Modell zurückgerollt):

Modell:
- Trim-Wert (`render_start_anchor`, `render_end_anchor`) = Position auf
  dem REALEN Track (0..1 von realem GPX-Track).
- Render-Output-Länge ist FIX = `dur + hold` Sekunden.
- Trim-Handles werden visuell auf den Anim-Bereich (`0..tf`) der Timeline
  gemapt. Default `tf=0.75` + `trim=[0,1]` → Handles bei 0 % und 75 %,
  rechtes Handle damit GENAU am Hold-Trenner.
- Trim-Handles können NICHT in die Hold-Region (`tf..1`) gezogen werden
  — der Hold-Bereich ist reine Anzeige.

Visueller Effekt:
- Default-Projekt: rechtes Trim-Handle sitzt an der Position wo der
  Hold beginnt (= am Hold-Trenner).
- Trim-Drag: Marker erreicht das rechte Trim-Handle visuell EXAKT zum
  Zeitpunkt wo die Anim-Phase endet — Scrubber wandert dabei durch
  beide Handles (nicht „mal früh, mal spät").

Implementation:
- `core/animator.py`: Frame-Loop wieder track-basiert wie v0.9.41:
  Anim-Phase wandert `_start_idx → _end_idx`, Hold-Phase bleibt am
  `_end_idx`. Total-Frames = `(dur + hold) * fps` (fix).
- `ui/js/timeline.js`: `setTrimVisual` skaliert Handle/Region-Position
  mit `_trackFraction`. `_bindTrimHandle` clampt Drag visuell auf
  `0..tf`. `setTrackFraction` rerendert Trim bei tf-Änderung.
- `modules/animator/ui/module.js` `runTimelinePreview`: Scrubber wandert
  visuell durch die Trim-Handles (`scrubberVis = marker_real * tf`
  während Anim), nicht mehr linear mit Zeit.
- `applyTrimToTrackPreview`: simpler Track-Position-Slice.

### Migration

Existierende Projekte mit nicht-default Trim behalten ihre Track-
Position-Werte. Die VISUELLE Position auf der Timeline ändert sich
(scaled to anim region) — das matched besser was der Render
tatsächlich macht. v0.9.52-Werte (interpretiert als Virtual-Position)
sind inkompatibel; bei Projekten die seit v0.9.52 mit veränderten Trim
gespeichert wurden bitte Trim neu setzen.

## [0.9.52] – 2026-05-25 15:30

### Geändert

**Trim + Hold leben auf der gleichen virtuellen Zeitachse**
(Marc-Idee „virtueller Track"): Bisher waren Trim-Handles auf der Track-
Position-Achse und der Hold-Trenner auf der Zeit-Achse — beides auf
derselben Timeline visualisiert, mit unangenehmem Versatz zwischen
Marker-Position und Trim-Handle in der Vorschau („mal zu früh, mal zu
spät").

Neues Modell:
- Die Timeline 0..1 = virtuelle Achse über die GESAMTE Render-Zeit
  (dur + hold).
- Real-Track liegt auf `0..tf` der virtuellen Achse, Hold-Extension
  `tf..1`, wobei `tf = dur / (dur + hold)`.
- Trim-Handles cutten eine Subrange dieser virtuellen Achse.
- Hold-Trenner sitzt bei `tf` — sichtbar auch bei vollem Track-Render.
- Render-Output-Länge = `(trim_end - trim_start) * (dur + hold)`
  Sekunden.

Visueller Effekt: Marker und Trim-Handles laufen jetzt auf derselben
Achse — der Marker erreicht das rechte Trim-Handle **visuell exakt**
zum Zeitpunkt, an dem das Trim-Ende durchquert wird. Kein Versatz mehr.

Implementation:
- `core/animator.py`: Frame-Loop rewritten — `virt_p = trim_start + frame_frac * trim_span`,
  `coord_idx = _virt_to_idx(virt_p)`. `total_frames = render_time_s * fps`.
- `modules/animator/ui/module.js` `runTimelinePreview`: gleiches Mapping;
  Scrubber zeigt virtuelle Position (= visuell konsistent mit Trim-Handles).
- `applyTrimToTrackPreview`: nutzt `idxAt(v)` mit Virtual→Real-Mapping.
- Bei dur/hold-Slider-Änderung wird Trim-Linie neu gerendert (tf-Wechsel
  ändert das Virtual→Real-Mapping).

### Migration

Existierende Projekte mit nicht-default Trim-Werten (`render_start_anchor`,
`render_end_anchor`) interpretieren die Werte jetzt als virtuelle
Positionen statt Track-Positionen. Für den Default-Fall (Trim=[0,1])
ändert sich nichts.

## [0.9.51] – 2026-05-25 13:20

### Behoben

**Hold-Trenner war fälschlich am End-Trim gepegt — Hold jetzt grafisch
sichtbar auch bei vollem Track-Render** (Marc-Korrektur zu v0.9.48):
Bei neuem Projekt mit Default-Hold (5 s) und Trim auf vollem Track [0,1]
saß der Hold-Trenner am rechten Rand → keine Hold-Region sichtbar.

Trim und Hold sind aber semantisch UNABHÄNGIG:
- **Trim-Handles** = welche Track-Position gerendert wird (Track-Anker)
- **Hold-Trenner** = wo in der ZEIT die Anim-Phase endet
  (= `tf = dur / (dur + hold)` der Gesamt-Timeline)

Beide sitzen auf derselben Timeline, aber an unterschiedlichen Stellen:
- Default-Projekt (trim=[0,1], dur=15 s, hold=5 s) → tf=0.75 → Hold-
  Trenner bei 75 %, Hold-Region 75–100 %, Trim-Handles bei 0/100 %.
- Mit Trim [0,0.6], hold=5 s → Hold-Trenner trotzdem bei 75 %,
  Trim-Ende-Handle bei 60 %.

Hold-Trenner bleibt **nicht draggable** (Hold-Dauer über Hold-Slider).

### Geändert

`timeline.js` führt jetzt `_trackFraction` als eigenen State (statt
`_trimEnd` für Hold-Position zu missbrauchen). `setTrimVisual` ruft
`_renderHoldUi()` nicht mehr — Trim-Drag bewegt den Hold-Trenner nicht
mehr versehentlich mit.

## [0.9.50] – 2026-05-25 12:55

### Behoben

**Track endete einen Coord-Schritt ÜBER dem rechten Trim-Handle**
(Marc-Followup zu v0.9.49): `Math.ceil(trimEnd * (n-1))` ergab den
nächsthöheren Coord-Index — sichtbar als „ein Stück in die Hold-Phase
rein". Auf den Trim-Handle genau treffen würde `floor` ergeben.

Jetzt sowohl in `runTimelinePreview` als auch in
`applyTrimToTrackPreview`: `Math.floor` statt `Math.ceil` für `trimEi`.
Der letzte gezeichnete Coord-Punkt liegt damit garantiert AUF oder
VOR dem rechten Trim-Handle, nicht mehr darüber hinaus.

## [0.9.49] – 2026-05-25 12:35

### Behoben

**Probe-Lauf endete am absoluten Track-Ende statt am rechten Trim-Handle**
(Marc-Bug): Im Animator-Preview wuchs die Track-Linie und der Marker bis
zum letzten Track-Punkt, auch wenn der rechte Trim-Handle weiter links
saß. Während der Hold-Phase blieb der Marker dann am echten Track-Ende
stehen — nicht am Trim-End. Damit stimmte die Vorschau nicht mit dem
gerenderten Video überein.

Jetzt:
- Während der Anim-Phase wandert der Marker von `trim_start` nach
  `trim_end` (statt 0..1 über GESAMT-Track).
- Während der Hold-Phase steht der Marker am `trim_end` — exakt wo
  auch das gerenderte Video stehen bleibt.
- Die Track-Linie wird nur innerhalb der Trim-Range aufgebaut, außer
  „Ganzer Track sichtbar" ist aktiviert.

`runTimelinePreview` in `modules/animator/ui/module.js` mappt jetzt
`trackProgress` durch die Trim-Range: `coordIdx = trimSi + round(trackProgress * (trimEi - trimSi))`.

## [0.9.48] – 2026-05-25 12:15

### Geändert

**Hold-Trenner nicht mehr ziehbar — sitzt visuell am End-Trim-Handle**
(Marc-Klarstellung nach v0.9.47): Trim ist Track-Position, Hold ist
Zeit — sie auf derselben Achse zu mischen war verwirrend. Jetzt:

- Der orangene senkrechte Trenner ist NICHT mehr draggable. Er sitzt
  immer exakt am rechten Trim-Handle und zeigt damit „hier beginnt die
  Hold-Phase".
- Die Hold-Region (transparenter Bereich rechts) ist sichtbar **sobald
  `hold_s > 0`** — beim Erhöhen des Hold-Sliders erscheint sie sofort.
- Steuerung der Hold-Dauer geht ausschließlich über den Hold-Slider in
  den Animator-Settings, nicht mehr über die Timeline.
- CSS-Drag-Styling (10 px breite, `cursor: ew-resize`, Hover-Highlight,
  `pointer-events: auto`) wieder entfernt → schlanker 2 px-Strich.
- `onHoldTrennerChange`-Callback im Animator-Modul entfernt (dead code).

## [0.9.47] – 2026-05-25 12:00

### Geändert

**Hold-Trenner kann nicht ins Trim hineinrutschen** (Marc-Klarstellung):
Hold-Phase ist Zeit, Trim ist Track-Position — semantisch sollten sie
nicht überlappen. Hold beginnt jetzt IMMER rechts vom Trim-Ende-Handle:

- Hold-Trenner-Drag: min ist `_trimEnd` (statt früherer 5 %). Wenn man
  ihn nach links drücken will, blockiert er beim rechten Trim-Handle.
- Trim-Ende-Drag: wenn der Handle den Hold-Trenner überholt, wird der
  Hold-Trenner mitgeschoben — d.h. Hold-Phase wird kürzer (bis 0).

So bleibt die Aufteilung intuitiv: Trim-Range = wo Track gerendert wird,
Bereich rechts vom Trim-End-Handle = wie lange der Track danach noch
steht (Hold-Phase).

## [0.9.46] – 2026-05-25 11:45

### Hinzugefügt

**Hold-Trenner direkt in der Timeline ziehbar** (Marc-Idee 2026-05-25):
der orangene senkrechte Trenner zwischen Anim- und Hold-Phase ist jetzt
ein Drag-Handle. Ziehen nach LINKS verlängert die Hold-Phase
(anim-Sekunden bleiben konstant, hold-Sekunden wachsen entsprechend).
Ziehen nach RECHTS verkürzt sie bis 0. So kann die Hold-Phase z.B.
in einen getrimmten Render-Bereich hineinragen, ohne dass die Track-
Animation schneller laufen muss.

Implementation:
- Trenner-Breite 2 → 10 px (= bessere Click-Fläche), Cursor `ew-resize`,
  Hover-Highlight, Pointer-Events explizit auf `auto` (Parent-Overlay
  hat sonst `none`).
- Callback `onHoldTrennerChange(newTf, committed)` im timeline.js.
- Animator-Modul: berechnet aus `newTf` neue `hold_s = anim_s/tf - anim_s`,
  clampt auf Slider-Max 20 s, setzt Slider-Wert + dispatcht
  `change`+`input`-Event damit bindSetting im Projekt persistiert.
- Auch bei tf=1.0 (= keine Hold-Phase) bleibt der Trenner sichtbar
  (dezent, opacity 0.5) damit man ihn am Anfang fassen kann.

## [0.9.45] – 2026-05-25 11:30

### Behoben

**Probe-Lauf-Stop zeigte immer den ganzen Track** (Marc-Bug-Report):
beim Stoppen (Klick auf Stop-Button, Space-Taste oder Auto-Ende) wurde
die Track-Linie blind auf `currentCoords` (= komplett) gesetzt — ohne
auf den Toggle „Ganzer Track" zu schauen. Mit Toggle aus erwartet der
User aber dass die Linie bei der Scrubber-Position abbricht.

Fix: beide Stop-Pfade in `runTimelinePreview()` rufen jetzt
`refreshPreviewTrackData()` — das ist der zentrale Helper der den
Toggle-State respektiert (Trim bis Scrubber wenn aus, kompletter
Track wenn an).

## [0.9.44] – 2026-05-25 11:15

### Behoben

**Trim-Position nicht gespeichert/wiederhergestellt** (Marc-Bug-Report
v0.9.43): in `projects.json` waren `render_start_anchor` / `..._end_anchor`
oft als 0.0/1.0 obwohl der User die Handles bewegt hatte. Plus: nach
App-Restart wieder bei 0–100 %.

Root cause: Race-Condition zwischen Mapbox-`onMapReady`-Callback und
`mountTimelineBar()`. Wenn der Style schon gecacht war (Tab-Wechsel,
oder gleicher Track wie vorher), feuerte `onMapReady`'s cb SYNCHRON
beim `register`-Call → `applyGlobalGpx` → `drawPreview` →
`sessionActivate().then(... applyTrimFromSettings())` lief — aber
`_tlBar` war zu dem Zeitpunkt noch `null` (mountTimelineBar kommt erst
weiter unten im Mount-Code). → `setTrim()` wurde geskipt, Handles
blieben auf 0/1, beim nächsten Drag wurde das vermeintliche 0/1 als
„aktueller Stand" gespeichert → vorherige User-Werte gingen verloren.

Fix: `applyTrimFromSettings()` wird jetzt ZUSÄTZLICH **direkt nach**
`mountTimelineBar()` aufgerufen — `_tlBar` ist da garantiert ein
echter Wert, die Trim-Bar bekommt die persistierten Anchor-Werte und
zeigt sie korrekt an.

## [0.9.43] – 2026-05-25 11:00

### Geändert

**Probe-Lauf startet an Scrubber-Position** (Marc-Spec): bisher fing
der Probe-Lauf immer bei 0 % an, egal wo der Scrubber stand. Jetzt
läuft er von der aktuellen Playhead-Position bis zum Ende. Nützlich
um z.B. einen bestimmten Übergang zwischen zwei KFs schnell zu prüfen
ohne von vorne durchsehen zu müssen. Wenn der Scrubber bei ≥ 98 % steht
(oder am Ende) → fängt automatisch wieder bei 0 an (sonst keine Animation).

## [0.9.42] – 2026-05-25 10:45

### Behoben

**Trim-Handles nicht greifbar** (Marc-Bug-Report v0.9.41):
`.timeline-track-overlay` hat `pointer-events: none` (damit die Lanes
drunter klickbar bleiben). Children müssen explizit `pointer-events:
auto` setzen — fehlte bei meinen Trim-Handles, daher kein Drag möglich.
Plus: Handle-Layout umgebaut — statt kleinem Knopf unter dem Overlay
jetzt vertikaler Balken über die volle Overlay-Höhe mit Grip-Indikator
in der Mitte. Click-Fläche ~10× größer.

## [0.9.41] – 2026-05-25 10:30

### Hinzugefügt

**Partial-Track-Render (Trim-Bereich auf der Timeline)** — Marc-Idee
2026-05-25. Auf der Timeline-Bar unten gibt's jetzt zwei Drag-Handles
(links + rechts) die den Render-Bereich definieren. Der nicht-gerenderte
Bereich wird gegrayed. Anchors bleiben 0..1 über den GESAMTEN Track —
KFs außerhalb des Trim-Bereichs werden gedimmt sichtbar gehalten und
wirken als **„Anlauf"-Bewegung**: die Kamera-Animation ist beim Render-
Start schon mittendrin (Pre-Roll-Effekt wie in NLE-Software).

Neue Felder in `AnimatorConfig` / `DEFAULT_SETTINGS.animator`:
- `render_start_anchor: float = 0.0`
- `render_end_anchor: float = 1.0`
- `stats_use_trim: bool = True`

Stats-Box (Distanz, Höhenmeter, Zeit) zeigt bei aktivem Trim die Werte
des Trim-Bereichs (Marc-Spec: wer 5 min vom 30-km-Track rendert, will
die 5-min-Werte sehen). Mit neuer Checkbox „Stats vom Trim-Bereich" in
den Overlay-Settings umschaltbar.

Track-Linie im Render zeigt nur den getrimmten Abschnitt (Marc-Spec).

Backend (`core/animator.py`):
- Frame-Loop mapped `timeline_progress` von `render_start_anchor` bis
  `render_end_anchor` über die Anim-Phase. Hold-Phase läuft von
  `render_end_anchor` bis `1.0` (= KFs zwischen Trim-Ende und 100 %
  wirken in Hold, bestehendes Verhalten).
- Track-idx wird im Trim-Range gemappt (start_idx bis end_idx).
- Stats (cum_dist/cum_time/ascent/descent/ele_min_max) für Trim-Bereich
  via `core/gpx._compute_ascent_descent` neu berechnet.

UI (`ui/js/timeline.js` + CSS):
- Zwei Trim-Handles (links + rechts) im timeline-track-overlay, dragbar
- Mindestabstand 2 % zwischen Handles
- Shade-Overlays für die Außenbereiche (rgba 55 %)
- KF-Marker außerhalb mit `.kf-outside-trim` (opacity 0.32 + saturate 0.5)
- Public API: `setTrim(start, end)`, `getTrim()`, `onTrimChange`-Callback

Persistiert pro Projekt in `projects.json`.

### Dokumentation

- IDEAS.md §1.1.A2 → 🟢 (Partial-Track-Render abgehakt)

## [0.9.40] – 2026-05-25 04:30

### Hinzugefügt

**License-Credits im About-Modal** (Beta-Tester-Hint 2026-05-25, FFmpeg-
LGPL-Redistribution-Pflicht): Im „Über"-Modal jetzt ein „Open-Source-
Komponenten"-Block mit klickbaren Links zu allen genutzten Bibliotheken:

- **FFmpeg** (LGPLv2.1+ / GPLv2+) → ffmpeg.org
- **Mapbox GL JS** (Mapbox Terms) → mapbox.com
- **pywebview** (BSD-3), **Pillow** (HPND), **gpxpy** (Apache-2.0),
  **Playwright** (Apache-2.0), **ExifTool** (Artistic)

i18n-Keys `about.credits.title` + `about.credits.intro` in DE/EN/ES.
Links öffnen im externen Browser via `open_url`-Bridge.

### Dokumentation

- `docs/IDEAS.md` §4.7 + §4.8 + §4.9: vollständige Bestandsaufnahme des
  gebundelten FFmpeg-Builds (47 MB, FFmpeg 7.1, `--enable-gpl` mit
  libx264/libx265 + Hardware-Encoder videotoolbox verfügbar).
- §4.8 dokumentiert den **bevorzugten Lösungsweg für kommerzielle
  Distribution**: First-Run-Wizard mit Auto-Download eines offiziellen
  LGPL-ffmpeg in App-Support (statt eigenen LGPL-Build maintainen).
  Eingeplant für Freemium-Iteration (§6.x).

## [0.9.39] – 2026-05-25 03:40

### Behoben

**Animator-Preview-Zoom falsch nach Tab-Wechsel / App-Restart bei KFs**
(Marc-Bug-Report; **echte** Root cause): Render war immer korrekt, nur
die Preview falsch. Damit kann's nicht an der Speicherung der KFs liegen
— es ist eine fehlerhafte Berechnung **in der Preview** beim Re-Mount.

Mein v0.9.36-Fix in `effectiveFitZoomBase()` war der Bug:
```js
if (currentBbox) {
  const cam = map.cameraForBounds(currentBbox, {...});
  return cam.zoom;   // ← falsch wenn Viewport noch klein
}
```
`cameraForBounds` rechnet mit dem **aktuellen Viewport**. Beim Re-Mount
ist der noch nicht final layoutet (oder Mapbox hat noch keine Tiles
geladen) → liefert kleineren Track-Fit-Zoom als der echte `_fitZoomBase`
(der nach `fitBounds`-moveend gesetzt wird). Resultat: KF-zoom_offset
wurde auf einen falschen Base aufaddiert → falscher Preview-Zoom.

Der Render kennt dieses Problem nicht: dort wird `_fitZoomBase` aus den
echten Render-Dimensionen gerechnet — synchron, ohne UI-Race.

Fix:
1. **`effectiveFitZoomBase()` returnt jetzt nur `_fitZoomBase`** (oder
   `null`) — kein cameraForBounds-Fallback mehr.
2. **`scrubPreview`** wartet wenn `_fitZoomBase == null`: hängt sich an
   `map.once("moveend")` und ruft sich nach dem moveend selbst nochmal
   mit dem queue'd Anchor auf. Kein Raten, kein falscher Zoom.
3. **`fitTrackPreview`'s moveend-Callback** triggert nach `_fitZoomBase = ...`
   einen scrubPreview wenn KFs aktiv sind — damit die Preview unmittelbar
   auf die echte KF-Pose springt.
4. **Display-/Schreib-Stellen** (`_syncMapStateToUi`, `renderKeyframeEditor`,
   Slider-Drag, snapshot, createSingleProperty) sind null-safe gemacht:
   skip-or-curZoom-fallback statt NaN-Schreiben.

`snapshotKeyframe` warnt mit Toast wenn der User vor moveend einen KF
setzt: „Karte noch nicht stabil — KF bitte gleich nochmal setzen". Sehr
selten weil User typisch nicht in <500 ms nach GPX-Load schon den KF-
Button klickt.

## [0.9.38] – 2026-05-25 03:10

### Behoben

**Keyframes mit duplizierten Events am gleichen Anchor** (Marc-Bug-Report
mit Live-JSON-Inspektion): in der `projects.json` der Hönower-Weg-Session
fanden sich für Anchor `1.0` **drei zoom-Events** mit verschiedenen Werten:

```json
{"kind": "zoom", "anchor": 1, "value_offset": -0.21}   ← User-Wert
{"kind": "zoom", "anchor": 1, "value_offset": 0}
{"kind": "zoom", "anchor": 1, "value_offset": 0}        ← Duplikat-Müll
```

`_interpScalar` nimmt bei `progress=1` und mehreren Events am letzten
Anchor das **letzte in der Liste** — also `value_offset=0` (Müll) statt
`-0.21` (User-Wert). Resultat: KF-Pose stimmt nicht.

Ursache der Duplikate: Snapshot-Filter-Toleranz war `< 0.001` — zu eng
für Float-Rundungsfehler beim Anchor-Vergleich (z.B. wenn ein Cluster
durch Drag minimal verschoben wurde und der nächste Snapshot mit dem
„runden" Anchor 1.0 daneben landete).

Fix in 3 Stellen:

1. **`_events_by_kind`** (Backend `core/timeline.py`): De-Dup pro Anchor
   beim Filtern. Spätere Events überschreiben frühere → letzter
   gespeicherter Wert gewinnt.
2. **`interpolateCameraJs`** (Frontend Animator): identische De-Dup-
   Logik — Preview + Render zeigen jetzt denselben Wert.
3. **Snapshot-Filter-Toleranz** (`snapshotKeyframe` + `createSingleProperty`):
   `0.001` → `0.005` (= 0.5 % der Timeline). Verhindert dass künftige
   Duplikate überhaupt entstehen.

⚠️ **Alte vergiftete KFs werden beim Laden automatisch bereinigt** — der
Dedup-Filter wirft die alten Duplikate raus, behält pro Anchor den
zuletzt gespeicherten (= User-intendierten) Wert. Nicht in der JSON-Datei,
sondern nur im Memory-Stream, also gehen die alten Werte nicht verloren
falls der Fix doch falsch sortiert.

## [0.9.37] – 2026-05-25 02:40

### Behoben

**KF-Zoom-Wert wurde beim Snapshot vergiftet** (Marc-Bug-Report, echte
Ursache!): wenn der User schnell einen Keyframe gesetzt hat BEVOR die
fitTrackPreview-Animation fertig durchgelaufen war (= `_fitZoomBase`
noch null), führte folgender Code zu falschen gespeicherten KFs:

```js
if (_fitZoomBase == null) {
  _fitZoomBase = curZoom;            // ← VERGIFTET den späteren Restore
}
const zoomOff = curZoom - _fitZoomBase;  // = 0 statt z.B. +0.5
```

Folge: der gespeicherte KF hatte `zoom_offset = 0`. Beim Anwenden in
einer späteren Session (mit korrekt initialisiertem `_fitZoomBase`,
z.B. 13.5): `zoom = 13.5 + 0 = 13.5` = Track-Extent. Der User hatte
aber z.B. auf 14.5 reingezoomt. → **„Karte ist immer rausgezoomt"**.

Fix: neuer Helper `effectiveFitZoomBase()` liefert immer einen korrekten
Track-Fit-Zoom:
1. Wenn `_fitZoomBase` schon vom moveend gesetzt → den
2. Sonst synchron via `map.cameraForBounds(...)` berechnen
3. Last resort: `map.getZoom()`

WICHTIG: **kein Seiteneffekt** mehr — `_fitZoomBase` wird nicht in
`effectiveFitZoomBase()` gesetzt. Damit überschreibt der spätere
moveend-Event den Wert sauber.

Alle 6 betroffenen Stellen umgestellt: `snapshotKeyframe`,
`createSingleProperty(zoom)`, `scrubPreview`, `_syncMapStateToUi` (×2),
`renderKeyframeEditor`, KF-Detail-Editor-Drag-Update, Probe-Lauf-RAF.

⚠️ **Bestehende KFs aus früheren Sessions sind nicht repariert** — wer
das Problem hatte (Snapshot vor `_fitZoomBase` gesetzt), muss seine
KFs einmal neu setzen. Neue Snapshots ab v0.9.37 sind korrekt.

## [0.9.36] – 2026-05-25 02:15

### Behoben

**Animator-Zoom rauszoomt bei KFs (root cause)** (Marc-Bug-Report):
v0.9.35's Fix war richtig — `applyKeyframesEnabled` ruft `scrubPreview` —
aber `scrubPreview` selbst hatte einen Bug. Es nutzt `_fitZoomBase` als
Basis-Zoom, wovon es den `zoom_offset` des Keyframes berechnet. Falls
`_fitZoomBase` noch nicht gesetzt war (= fitBounds-Animation läuft noch,
500 ms Dauer), fiel's auf `map.getZoom()` zurück. Beim frischen Re-Mount
ist `map.getZoom() = 1` (Weltansicht-Default) → `base + zoom_offset ≈ 1`
→ Karte landet auf Weltansicht.

`_fitZoomBase` wird erst nach dem `moveend`-Event der fitBounds-Animation
gesetzt. Sequenz im Re-Mount:
- `t=0`: fitTrackPreview(true) startet Animation
- `t=20-100`: sessionActivate.then() resolved → applyKeyframesEnabled →
  scrubPreview → `_fitZoomBase` IST NULL → Welt-Zoom
- `t=500`: moveend → `_fitZoomBase` wird gesetzt (zu spät)

Fix in `scrubPreview()`: wenn `_fitZoomBase == null` und `currentBbox`
vorhanden, berechnen wir den Track-Fit-Zoom synchron via Mapbox's
`map.cameraForBounds()` (= „würde ich jetzt fitBounds rufen, welcher
Zoom käme raus?"). Damit haben wir auch während laufender fitBounds-
Animation den richtigen Basis-Zoom.

Verbleibender Fallback (sehr unwahrscheinlich): `cameraForBounds`
existiert nicht oder schmeißt → `map.getZoom()` wie bisher.

## [0.9.35] – 2026-05-25 01:50

### Behoben

**Animator-Zoom falsch bei aktivem KF-Editor** (Marc-Bug-Report):
v0.9.34's ResizeObserver-Debounce + Animation-Guard fixten den Zoom für
den **klassischen Modus** (kein KF-Editor). Bei **aktivem KF-Editor mit
gesetzten KFs** war's aber weiterhin falsch — die Karte landete auf
Track-Extent (fitTrackPreview-Resultat) statt auf der KF-Map-Pose.

Ursache: beim Re-Mount läuft `drawPreview` → `fitTrackPreview(true)`,
dann später (in `sessionActivate.then()`) `applyKeyframesEnabled()` —
das rief am Ende auch nochmal `fitTrackPreview(false)`, statt die
Map auf den gerade selektierten Scrubber-Anchor zu scrubben.

Fix in zwei Stellen:

1. **`applyKeyframesEnabled()`**: bei aktivem KF-Editor MIT gesetzten KFs
   ruft am Ende `scrubPreview(scrubberAnchor)` statt `fitTrackPreview`.
   Damit zeigt die Karte die KF-Pose (Pitch/Bearing/Zoom/Center am
   aktuellen Anker) statt den Track-Extent.

2. **Cache-Restore (onMapReady-cb)**: setTimeout-Delay auf 1000 ms erhöht
   (damit sessionActivate-then komplett durch ist BEVOR Cache-Restore
   reinpfuscht). Nach `setScrubber(anchor)` wird jetzt zusätzlich
   `scrubPreview(anchor, {skipSelectionSync:true})` gerufen — sodass
   die Karte auf den vorher selektierten KF zoomt.

Test-Workflow: Animator mit gesetzten KFs → Scrubber bei 50 % → Tab
wechseln → zurück → Karte sollte exakt die KF-Pose bei 50 % zeigen,
nicht den Track-Extent.

## [0.9.34] – 2026-05-25 01:30

### Behoben

**Animator-Zoom „klappt nicht zuverlässig"** (Marc-Bug-Report):
v0.9.30's Layout-Guard fix war notwendig aber nicht hinreichend. Beim
Tab-Wechsel feuert die Layout-Cascade des Re-Mounts:
- DOM angehängt → ResizeObserver #1 → `fitTrackPreview(false)`
- CSS angewendet → ResizeObserver #2 (50 ms später) → `fitTrackPreview(false)`
- Timeline-Bar gemounted → ResizeObserver #3 (Timeline-Host-Observer)
  → `fitTrackPreview(false)`

Jeder dieser Calls unterbricht den vorherigen `map.fitBounds`-Aufruf (der
mit 500 ms Animations-Dauer läuft) → die Karte landet in einem Zwischen-
Zoom-State, oft mit Weltansicht als Endpunkt.

Fix in zwei Schichten (Animator + Tour-Map gespiegelt):

1. **ResizeObserver-Callbacks debounced (200 ms)**: feuern alle Observer
   innerhalb von 200 ms, läuft nur EINER. Der Refit kommt dann am Ende
   der Cascade auf stabilem Layout.

2. **Animations-Schutz in `fitTrackPreview()` / `fitTrackToView()`**:
   wenn der letzte erfolgreiche Fit < 700 ms her ist UND der neue Call
   ist `animated=false` (= ResizeObserver-Trigger, kein User-Action),
   skippen wir. Mapbox-Animations-Dauer ist 500 ms — so kann die
   laufende Animation in Ruhe zu Ende laufen.

3. **Retry-Period verlängert**: 10 × 200 ms = 2 s statt 5 × 100 ms = 500 ms.
   Damit überleben auch langsamere Re-Mount-Szenarien (z.B. erstes Tab-
   Wechseln nach Kaltstart).

## [0.9.33] – 2026-05-25 01:10

### Behoben

**GPX-Drop im Geotagger landete nicht im globalen Picker** (Marc-Feedback):
sowohl bei der Karten-Drop-Zone als auch beim neuen kombinierten Foto+GPX-
Drop wurde die GPX nur lokal im Geotagger geladen (`loadGpxByPath`). Der
GPX-Indikator in der Sub-Top-Bar oben blieb leer — als wäre kein Track
aktiv. Dasselbe galt für Session-Persistenz: nach App-Neustart war der
Track weg, weil `last_gpx_path` nie geschrieben wurde.

Fix: beide Drop-Zonen nutzen jetzt `loadGlobalGpx(path)` (analog zum Sub-
Top-Bar-File-Picker und zur Tour-Map-Drop-Zone, die das schon richtig
machten). `loadGlobalGpx` setzt den globalen State, aktiviert Session,
persistiert `last_gpx_path` und triggert via Listener-Pattern den Geotagger
lokal — damit sind alle Pfade konsistent.

## [0.9.32] – 2026-05-25 00:55

### Geändert

**GPX-Drop in der Foto-Drop-Zone (Marc-Feedback)**: bisher konnte man GPX
nur in die Karten-Drop-Zone ziehen — wer Fotos + Track gemeinsam aus dem
Finder in den linken Foto-Bereich zog, bekam einen „Falscher Dateityp"-
Toast (weil `gpx` nicht in der accept-Liste war). Jetzt akzeptiert die
Foto-Drop-Zone auch GPX. Im `onDrop` werden die Files sortiert: GPX zuerst
verarbeiten (über `loadGpxByPath`), dann Fotos (über `importDroppedPhotos`).
So passt der nachfolgende EXIF-Match-Lauf direkt mit dem frisch geladenen
Track.

Drop-Hint angepasst in DE/EN/ES: „Fotos, Ordner oder GPX hier loslassen".

## [0.9.31] – 2026-05-25 00:40

### Behoben

**„Session schließen" während Foto-Laden räumte Backend nicht auf**
(Marc-Bug-Report v0.9.30): wer „Session schließen" klickte WÄHREND der
Thumb-Worker noch lief (z.B. bei einem Ordner mit 200 RAW-Files), sah
weiter Thumbnails reinfliegen — der Backend-Worker arbeitete sich durch
die Liste. Frontend-State war geleert, aber:
- Backend-Thread `_thumb_worker_run` lief weiter
- Wenn der User dann eh in den Geotagger-Tab wechselte, kamen plötzlich
  wieder die Fotos auf (über `geotagger_get_state()` Tab-Wechsel-Restore)

Fix in zwei Schichten:

1. **Frontend** (`ui/js/projects.js`): close_session-Handler ruft jetzt
   `await api().geotagger_clear()` BEVOR `clearGlobalGpx()` und Settings-
   Cleanup laufen. Damit ist der Backend-Worker zuerst gestoppt.

2. **Frontend** (`modules/geotagger/ui/module.js`): der bestehende
   `onGpxLoaded({path: null})`-Listener räumte bisher nur das Label.
   Jetzt räumt er den kompletten State: `photos = []`, `matches = []`,
   `selectedPath`/`referencePath` reset, alle Marker entfernt, gt-track-
   Source geleert, alle Info/Summary-Labels versteckt, Loader weg,
   Photo-Grid auf Empty-State neu gerendert, `stopThumbPolling()`.
   Triggert automatisch wenn die Session geschlossen wird ODER der User
   das ✕ am GPX-Picker klickt.

3. **Backend** (`app.py::geotagger_clear`): zusätzlich `_thumb_queue_ready`
   geleert + `_thumb_progress` komplett zurückgesetzt (alle Counter auf
   0). Damit hat der nächste Foto-Pick saubere Start-Werte (sonst zeigte
   `pollThumbs` noch alte progress.done/total).

## [0.9.30] – 2026-05-25 00:15

### Behoben

- **„Ganz rausgezoomt"-Symptom bei wildem Tab-Klicken (Animator + Tour-Map)**:
  v0.9.29 reduzierte das Problem aber löste es nicht ganz. Echte Ursache:
  `fitTrackPreview()` bzw. `fitTrackToView()` werden vom ResizeObserver mehrfach
  in schneller Folge beim Re-Mount aufgerufen — wenn der Viewport-Container
  (`#anim-viewport` / `#tmap-viewport`) zu diesem Zeitpunkt noch nicht final
  layoutet ist (`clientWidth`/`clientHeight` = 0 oder sehr klein), zoomt
  `map.fitBounds` automatisch auf Weltansicht.
  
  Fix: Layout-Guard in beiden fit-Funktionen. Wenn `vpMin < 200`, wird der
  Fit auf den nächsten Frame verschoben (`setTimeout 100 ms`, max. 5 Re-Tries).
  So wartet die Logik auf einen stabilen Viewport bevor zoom-stuff passiert.

### Geändert

- **App-Restart-Foto-Restore raus.** v0.9.27 lud nach App-Neustart die letzten
  Fotos automatisch wieder (mit neuer EXIF-Generation). Bei größeren Foto-
  Sammlungen (200+ RAW-Files) dauerte das mehrere Sekunden und überraschte
  den User. Außerdem ist Foto-Laden ein bewusster Workflow-Schritt — nach
  Neustart will man meistens frisch anfangen.
  
  Was bleibt: Tab-Wechsel-Restore über `geotagger_get_state()` aus dem
  Backend-Memory. GPX-Track wird nach App-Neustart weiterhin auto-restored
  (passiv: Karte zoomt halt hin, kein neuer Workflow).

## [0.9.29] – 2026-05-24 23:50

### Behoben (Marc-Bug-Reports nach v0.9.28-Test)

- **Mapbox-Crash beim Tab-Wechsel während Thumb-Loading**: 
  `undefined is not an object (evaluating 'e.getCanvasContainer().appendChild')`
  trat auf, wenn der User in den Animator/Tour-Map wechselte während
  noch nicht alle Foto-Thumbs eingelesen waren. Ursache: in-flight
  `updateMatches()` und `pollThumbs()` versuchten nach dem Unmount noch
  `redrawMarkers()` aufzurufen, das wiederum `new Marker().addTo(map)`
  rief — `map` war aber bereits durch `map.remove()` zerstört.
  
  Fix in `modules/geotagger/ui/module.js`:
  - Neuer `isUnmounted`-Flag, sofort in der Cleanup-Function gesetzt
  - Alle async-Pfade (updateMatches, pollThumbs, loadGpxByPath, showTrack,
    geotagger_get_state-Restore) prüfen den Flag vor + nach jedem await
  - `redrawMarkers()` zusätzliche dreifache Sicherung: Flag + `map !== null`
    + `map.getCanvasContainer()` ist eine Function. Marker-Add im try/catch
  - Cleanup räumt jetzt zusätzlich `markers = []` und `map = null`

- **Animator/Tour-Map zoomt nach Tab-Wechsel raus**: v0.9.28's
  Map-Pose-Restore (700 ms nach Mount via `map.jumpTo(cache.pose)`) kam
  immer NACH dem `fitTrackPreview()` aus dem applyGlobalGpx-Pfad — bei
  manchen Races aber TROTZ Delay zwischen mehrere Refits gefangen.
  Effekt: Karte zoomte kurz auf Track an (richtig), dann auf den Cache-
  Wert zurück (falsch — Cache hatte oft den Zwischenstand einer
  Animation gespeichert).
  
  Fix: Map-Pose-Cache + Restore komplett raus aus allen 3 Modulen.
  Was bleibt:
  - Geotagger: Backend-Cache `geotagger_get_state()` für Foto-Liste +
    Thumbs (das ist der Hauptpunkt — keine neue EXIF-Generation)
  - Geotagger: `selectedPath` + `referencePath` werden gecached (kein
    Map-Konflikt)
  - Animator: `_selectedKfIdx` + `scrubberAnchor` (internal state,
    kein Map-Konflikt)
  - Tour-Map: nichts mehr gecacht — die Karte fittet ohnehin sauber
    auf den Track beim Re-Mount

## [0.9.28] – 2026-05-24 23:30

### Geändert

**Marc-Feedback nach v0.9.27-Test:**

- **Offset-Slider Snap komplett raus.** v0.9.27 hatte noch ein Magnet
  bei ≠-0-Stunden (±5 min während Drag, ±15 min beim Loslassen). Heißt:
  bei 1h 4min snappte's auf 1h. Jetzt bewegt sich der Slider stufenlos
  in 1-Min-Schritten — wer exakte Werte will, nutzt den ✎-Edit-Button
  (mit `4s`/`4m`/`1h30m`-Parser).

- **Fenster-Geometrie immer remembered.** Settings-Modal-Toggle ist raus,
  App merkt sich immer Größe + Position. Beim Erststart (noch keine
  Geometrie gespeichert) → maximiert. Danach: was du beim Beenden hattest.

- **Tab-Wechsel-State: alles bleibt erhalten.** Bisher: wenn du im
  Geotagger Fotos geladen hattest und auf Animator-Tab gewechselt + zurück,
  war die Liste weg. Jetzt:
  - Geotagger: neue Bridge `geotagger_get_state()` liefert das in-memory
    Foto-Set inkl. Thumbs + EXIF-Daten (`_gtg_photos` bleibt im Memory
    der Api-Instance zwischen Mounts). Beim Re-Mount sofort wieder da,
    KEIN neuer EXIF-Read nötig.
  - Animator + Tour-Map + Geotagger: Map-Pose (center/zoom/pitch/bearing)
    wird in `window.__rzgpsModuleCache.<module>` beim Unmount gespeichert
    und beim Re-Mount via `map.jumpTo()` wiederhergestellt (700 ms nach
    Init damit fitTrackPreview erst durchläuft).
  - Animator: zusätzlich `_selectedKfIdx` + `scrubberAnchor` im Cache.

- **„Session schließen" im Topbar-Projekt-Dropdown.** Eigener Eintrag
  unten im Menü. Leert globalen GPX-State + persistierten `last_gpx_path`
  + Geotagger-Foto-State. App ist dann „leer". So kann der User
  bewusst eine Session beenden statt darauf zu warten dass der GPX-Pfad
  beim nächsten Start verloren geht.

- **App-Restart-Restore räumt sauber auf.** Wenn die letzte GPX-Datei
  nicht mehr existiert (umbenannt, gelöscht, externe Platte ab), werden
  `last_gpx_path` UND `geotagger.last_photos_dir`/`paths` auf leer
  gesetzt. App startet leer statt mit „Geist-Daten".

### Behoben

- **i18n-Keys nachgepflegt** für die in v0.9.27 neu hinzugefügten UI-
  Elemente: Unterordner-Checkbox, GPX-Nearby-Modal-Texte, Offset-Edit-
  Modal-Beispiele, alle Restore-Toasts, „Session schließen"-Menüpunkt.
  In de.json + en.json + es.json. v0.9.27 zeigte teilweise rohe Keys
  (z.B. `geotagger.toggle.folder_recursive`) weil die Übersetzungen
  fehlten.

## [0.9.27] – 2026-05-24 22:30

### Hinzugefügt

**Beta-Tester-Feedback-Pack** (externe Bug-/UX-Mail von Beta-Tester, 2026-05-24).
Sieben Punkte aus seinem Geotagger-Test sind eingearbeitet:

- **Offset-Slider Tot-Zone behoben** (Beta-Tester-Punkt 4): `snapToHour()`
  snappt nicht mehr auf die 0-Stunde — bis v0.9.26 sprang der Slider
  bei ±5 min Magnetfeld immer auf 0, sodass man −4-Min-Offsets per
  Slider gar nicht eingeben konnte. Jetzt snappt nur noch zwischen
  ≠-0-Stunden (±1h / ±2h Übergänge).

- **Offset-Eingabe mit Time-Parser** (Punkt 5): Edit-Modal akzeptiert
  jetzt User-freundliche Formate statt nur Sekunden:
  - `4s`, `-4s`, reine Zahl `90` (= 90 s)
  - `4m`, `5m30s`, `-2m`
  - `1h`, `1h30m`, `-2h15m`
  - `1:30:00` = 1 h 30 m
  Mit Live-Validierung + Feedback-Zeile unter dem Input
  („→ +5m 30s (330 Sek.)").

- **Marker-Z-Order: Selektion nach vorn** (Punkt 7): in dichten
  Foto-Clustern war der selektierte Marker unter anderen verdeckt.
  `selectPhoto()` bringt das selektierte `<el>` jetzt per
  `appendChild` ans Ende des parent → Mapbox malt es zuletzt = obenauf.
  Plus deutlich verstärkter Selection-Style: 20px statt 16px, dickere
  Border, pulsierender Glow-Ring.

- **Auto-GPX-Detect im Foto-Ordner** (Punkt 2): bei Folder-Pick scannt
  das Backend (`geotagger_find_gpx_near`) den Ordner selbst, das Parent,
  und alle Geschwister-Ordner nach `*.gpx`-Dateien. Bei genau 1 Treffer:
  Toast-Modal „GPX gefunden: <name> — laden?". Bei mehreren: Modal mit
  Auswahl-Liste (sortiert nach Lokation + mtime). Wird nur angeboten
  wenn aktuell KEIN GPX geladen ist — sonst wäre's nervig.

- **Unterordner-Option beim Folder-Pick** (Punkt 3): neue Checkbox
  „Unterordner einbeziehen" unter dem Folder-Pick-Button. Backend
  `geotagger_load_photos_from_folder(folder, recursive=True)` mit
  Tiefen-Limit 3 (Performance-Schutz). State persistiert.

- **Geotagger State-Persistenz** (Punkt 6): letzter GPX-Pfad + Foto-
  Ordner / Foto-Liste werden persistiert. Nach Modul-Wechsel ODER
  App-Restart automatisch wiederhergestellt. Pfad-Existenz wird beim
  Restore geprüft — verschwundene Files führen zu sauberem Reset mit
  Toast „Letzter Foto-Ordner nicht mehr vorhanden". Neue Bridge:
  `path_exists(path)`. Neue Settings: `last_gpx_path` (global),
  `geotagger.last_photos_dir`, `geotagger.last_photos_paths`,
  `geotagger.folder_recursive`.

- **Fenster-Geometrie persistieren** (Punkt 8): neuer Toggle im
  Settings-Modal „Fenster-Größe und -Position merken". Default off
  (App startet wie bisher maximiert — Backward-Compat). Aktiviert:
  Größe + x/y werden beim Schließen gespeichert und beim Start
  wiederhergestellt. Für Curved-Monitor-User die nicht jedes Mal
  maximiert haben wollen. Settings-Block `window: {mode, width,
  height, x, y}` mit `mode = "maximized" | "remembered"`.

### Nicht angefasst

- Punkt 1 (Reihenfolge „Fotos vor GPS-Track" tauschen) ist seit v0.8.1
  schon erledigt: GPX-Picker ist global oben in der Sub-Top-Bar, die
  Geotagger-Sidebar fängt direkt mit der Foto-Sektion an. Beta-Tester hat
  eine ältere Version gesehen.

## [0.9.26] – 2026-05-24 21:15

### Behoben

**Freeze beim Schließen der App, Teil 2** (Marc-Repro, Bug-03 Follow-up):
v0.9.25's Closing-Handler hat zwar alle Background-Worker korrekt
gestoppt (Log-Beweis: „Background-Worker gestoppt — Window kann sauber
schließen"), aber die App hing trotzdem. Stack-Sample des eingefrorenen
Prozesses (PID 32355) hat den wahren Grund gezeigt:

```
_Py_Finalize
  wait_for_thread_shutdown
    ThreadHandle_join
      _PyParkingLot_Park
        _PySemaphore_Wait
          _pthread_cond_wait     ← hängt hier
```

Zwei Python-Threads (Thread-51 + Thread-52, beides pywebview-internal
Bridge-Call-Threads) hingen in `_PyMutex_LockTimed` — sie warteten auf
einen `threading.Lock` der nie freigegeben wurde. Python 3.13+ hat das
`wait_for_thread_shutdown` Verhalten geändert: `Py_Finalize` wartet jetzt
auf ALLE Threads (auch non-daemon, auch wenn sie ewig hängen). pywebview
spawnt seine Bridge-Threads ohne `daemon=True`, also helfen unsere
Daemon-Flags nicht.

Fix in `app.py::main`'s `_on_closing()`: nach dem regulären Worker-Stop
startet jetzt ein Watchdog-Thread, der nach 800 ms `os._exit(0)` ruft.
Das umgeht Py_Finalize komplett, macOS räumt den Prozess auf, daemon-
threads + exiftool-subprocesses werden vom System eingesammelt.
800 ms Delay ist Kompromiss zwischen „Logs sauber flushen" und „User
sieht keine spürbare Wartezeit beim Schließen".

## [0.9.25] – 2026-05-24 21:00

### Behoben

**Freeze beim Schließen der App** (Marc-Repro, Bug-03 erster Anlauf):
Wenn ein Track mit Animator-Session geladen war, der User in den Geotagger
wechselte, dort Fotos lud die NICHT auf dem Track lagen und dann das
Fenster mit dem roten X schloss — fror die App ein. Log endete abrupt nach
`[onMapReady] styleLoaded=true`, kein JS-Error, kein Python-Crash. Klassischer
WKWebView-Bridge-Stall: macOS wartet beim Window-Close auf alle in-flight
`window.pywebview.api.xxx()`-Calls. Wenn `geotagger_poll_thumbs` läuft
während der `_thumb_worker_run`-Background-Thread mit dem exiftool-Daemon
im `read1()`-Loop hängt, gibt's keinen Ausweg.

Fix in zwei Schichten:
- **Python (`app.py::main`)**: neuer `win.events.closing`-Handler setzt
  alle Worker-`running`-Flags auf False (Thumb-Worker, Write-Worker, Render-
  Threads für Animator + Tour-Map) und ruft `cexif._ExifToolDaemon.shutdown()`
  BEVOR pywebview die Bridge abräumt. Damit ist nichts mehr in-flight wenn
  WKWebView den Window-Teardown beginnt.
- **JS (`ui/js/util.js` + Module)**: neuer `window.__rzgpsShuttingDown`-Flag
  via `pagehide`/`beforeunload`-Listener. Geotagger-`pollThumbs`,
  Animator-`pollStatus`, Tour-Map-`pollStatus` prüfen den Flag vor jedem
  Bridge-Call und brechen ab → letzte Verteidigungslinie, falls der Python-
  Closing-Handler nicht früh genug feuert.
- **`onAppClose(cb)`-Helper** in `util.js` damit Module Cleanup-Callbacks
  registrieren können. Geotagger nutzt das um `stopThumbPolling()` zu
  triggern.

Hat keinen Einfluss auf normalen Modul-Wechsel — der Geotagger-Cleanup
(`stopThumbPolling`, `markers.remove`, `map.remove`) läuft weiter wie bisher.

## [0.9.24] – 2026-05-24 19:30

### Behoben (Headless-Selftest entdeckt 2 Bugs)

Marc-Auftrag: 2-Stunden-Selftest während er weg ist. 6 Renders über
3 GPX-Fixtures aus ~/Downloads/ (klein/teufelsmauer/teide), 5 Konfigs
(1080p classic, 4K glow+tube, shorts vertical, 1080p with keyframes,
alpha ProRes). Bridge-Audit + UI-Smoke + Static-Check parallel.

**BUG-01** (Stats bei Track ohne `<ele>`/`<time>`): track_klein.gpx hatte
keine Höhen- und Zeit-Daten. Render zeigte trotzdem alle Stat-Zeilen mit
„0 m" / „00:00" + leeres Höhenprofil-Overlay.

Fix in `core/animator.py` + `core/tourmap.py`:
- Stat-Rows werden jetzt per Python-Liste conditional aufgebaut
  (`has_time`/`has_ele`-Flags). Bei fehlenden Daten entfallen Zeit,
  Bergauf, Bergab, Max-Höhe (TL-Box) sowie Vergangen + Höhe (Live-Box).
- Höhenprofil-Overlay wird komplett weggelassen wenn keine Höhendaten
  vorhanden sind.
- Im JS analog `HAS_ELE`/`HAS_TIME`-Flags eingeführt, alle
  `getElementById(...).setAttribute(...)`-Calls null-safe gemacht.
  Sonst crasht das Render-JS sofort sobald das Höhenprofil-SVG fehlt
  → `window.isReady` wird nicht definiert → Render bleibt hängen.

**BUG-02** (prewarmTiles im Alpha-Modus): v0.9.19's Tile-Cache-Prewarm
war auch im Alpha-Modus (kein Mapbox) aufgerufen → `TypeError:
window.prewarmTiles is not a function`. Render lief best-effort durch
(try/except), aber Log-Spam.

Fix: `PREWARM_N = 0 if cfg.transparent_background else 12` — der Prewarm-
Block läuft nur noch im Mapbox-Pfad.

### Test-Infrastruktur

- Neu: `scripts/selftest_renders.py` — headless-Render-Driver mit
  Test-Matrix (Konfig × Fixture). Ruft `core/animator.py::render()` ohne
  UI-Bridge.
- Neu: `scripts/selftest_ui.py` — Playwright lädt `ui/index.html` mit
  gemockter `window.pywebview.api`, schaltet durch Module, sammelt
  console-errors + Screenshots.
- Neu: `scripts/retest_bugfixes.py` — gezielter Re-Test für die
  fixierten Bug-Szenarien (klein.gpx ohne ele + alpha).
- Test-Output liegt in `tests/output/`, Frames + Bericht in
  `tests/report/`, Bug-Log in `tests/bug_log.md`, finaler Bericht in
  `tests/SELFTEST_REPORT.md`.

## [0.9.23] – 2026-05-24 18:50

### Behoben (Session-Settings landen in der Sidebar, nicht in der Preview)

Marc:
> „öffnet man eine session/ein projekt neu. ist in der sidebar zwar die
> zuletzt gewählte trackfarbe drin, aber in der preview ist die default
> farbe."

Ursache: `rebindAllSettings()` setzt nach Session-Aktivierung die
`<input>`-Werte aller `bindSetting`-Bindings (anim-color, anim-lw,
anim-shadow-strength, anim-glow-strength, anim-line-style, …), aber
dispatcht KEIN `input`/`change`-Event. Die `applyXxxToLayers()`-Listener
hängen aber genau an `input`-Events — also bleibt die Mapbox-Preview auf
den letzten manuell gesetzten Werten hängen (oder Defaults beim
Erst-Mount). Sidebar zeigt korrekt, Preview ist veraltet.

Fix: Sammel-Helper **`applyAllPaintSettings()`** in beiden Modulen.
Ruft alle `applyXxxToLayers()`-Funktionen hintereinander auf —
Linienfarbe, -breite, Shadow, Glow, Line-Style, Track-Style,
Hide-Labels, Terrain, Alpha-Preview, Overlay-Preview (Tour-Map auch
Pins). Wird gerufen:
- Animator: in `applyGlobalGpx`'s `sessionActivate`-Callback (= echter
  GPX-Load-Pfad) UND in `_animOnProjectChanged` (Dropdown-Wechsel)
- Tour-Map: direkt nach `rebuildPreviewLayers()` im
  GPX-Load-Pfad

Trifft die ganze Familie von „Setting wird gespeichert aber Preview folgt
nicht beim Reopen": Trackfarbe (Marc-Bug), Linienbreite, Shadow-Stärke,
Glow-Stärke + -enabled, Linien-Stil, Linien-Spacing, Track-Stil.

## [0.9.22] – 2026-05-24 18:30

### Behoben (Track im Render blasser als in der Preview)

Marc:
> „im fertigen video ist der track irgendwie blasser als in der preview,
> das passt noch nicht 100%ig"

Ursache: **Chroma-Subsampling 4:2:0**. Der ffmpeg-Encoder lief mit
`-pix_fmt yuv420p` — pro 2×2-Pixel-Block wird nur EIN gemeinsamer
Chroma-Wert gespeichert. Bei einer schmalen, kräftig saturierten
Track-Linie heißt das: jedes Linien-Pixel teilt sich Farbe mit 3
Hintergrund-Pixeln → Sättigung wird gemittelt → Track wirkt deutlich
blasser im finalen Video. In der Browser-Preview gibt's diese Mittelung
nicht — Pro-Pixel-Farben.

Fix: H.264 / H.265 encoden jetzt mit **`yuv444p`** (kein Subsampling,
volle Chroma pro Pixel). Track-Sättigung im Video matched die Preview
1:1. Plus `-profile:v high444` für libx264 (das Default-„high"-Profil
unterstützt nur 4:2:0). libx265 nimmt mit yuv444p automatisch
`main444-8`.

Trade-off: File wird ~25–30 % größer. Im macOS-Ökosystem (QuickTime,
Final Cut, Premiere, VLC, Safari/Chrome `<video>`) voll unterstützt.
YouTube re-encodet ohnehin — mit besserem Source kommt auch dort ein
farbtreueres Ergebnis raus.

Tour-Map (PNG-Output) nicht betroffen — PNG hat sowieso volle
Chroma-Resolution.

## [0.9.21] – 2026-05-24 18:00

### Behoben (Trackpunkte-Slider wurde nicht persistiert)

Marc:
> „trackpunkte also wenn man reduziert, das wird nicht im projekt/in der
> session gespeichert"

Der Punkte-Slider (`#anim-pointcount`) war nirgendwo gebunden — `bindSetting`
hat ihn nicht erfasst, weil er initial disabled ist (kein GPX = keine
Punkte) und der `max` erst nach GPX-Load dynamisch gesetzt wird. Jeder
Track-Load resettete den Slider auf `max` (= alle Punkte).

Fix:
- Default `point_count: 0` in `DEFAULT_SETTINGS["animator"]` (`0` = „alle
  Punkte", konsistent mit Backend-Konvention).
- `configurePointCountSlider()` liest jetzt den persistierten Wert aus
  dem aktiven Projekt (oder globalen Settings als Fallback) und clamped
  auf `[10, nPoints]`. Wenn `stored == 0` → Slider auf max (= alle).
- Neuer `change`-Listener auf dem Slider speichert via
  `saveProjectSettings("animator", { point_count: ... })`. Bei Wert
  `>= max` wird 0 gespeichert (= „alle"), sonst exakter Wert.
- Preview wird beim Restore-mit-Reduktion sofort resampled.

## [0.9.20] – 2026-05-24 17:45

### Behoben (echtes WYSIWYG: Track-Dicke Preview = Render)

Marc:
> „der track soll 1:1 so im render aussehen, wie in der preview"

Beta-Tester:
> „Die Glow-Stärke hat bis 1.5 px Funktion, danach habe ich das Gefühl
> dass sie wieder abgeschaltet wird."

**Root-Cause WYSIWYG-Mismatch:** Mapbox interpretiert `line-width: 3.5`
als 3.5 **CSS-Pixel**. Browser-Preview im App läuft mit DPR=2 (Retina) →
3.5 CSS-px = 7 Device-Pixel. Playwright-Headless-Browser läuft mit
DPR=1 → 3.5 CSS-px = 3.5 Source-Pixel im 4K-Frame. Nach Downscale auf
Player erscheint die Linie deutlich dünner als in der Preview.

**Fix v0.9.20:**
- Playwright wird mit **`device_scale_factor = max(W, H) / 1920`**
  gestartet (4K → DSF=2, 1080p → DSF=1).
- Viewport-CSS-Size entsprechend skaliert (4K → 1920×1080 CSS), Output
  bleibt cfg.width × cfg.height physisch.
- Damit malt Mapbox auch im Render line-widths/blur/translate als CSS-
  Pixel — exakt wie im Browser-Preview auf Retina. 1:1-WYSIWYG.
- `_overlay_scale()` nutzt jetzt die CSS-Viewport-Höhe als Referenz,
  sonst würden Stats-Boxen bei 4K doppelt skalieren (CSS × DSF).

Tour-Map gleichberechtigt umgesetzt (Spiegelung).

### Geändert (Glow-Stärke wirkt jetzt über die ganze Slider-Range)

Bisher: `glow_strength` wurde 1:1 auf `line-blur` gemappt. Über
gs ≈ 1.5 hinaus sättigt Mapbox visuell weil die Gaussian-Peak-Alpha mit
zunehmendem Blur-Radius sinkt — Slider scheint „abgeschaltet".

Fix: Glow `line-width` skaliert jetzt mit gs:
```
line-width = lw × (2.0 + 0.21 × gs)
```

| gs | line-width | bisher | sichtbar |
|---|---|---|---|
| 0 | 2.0×lw | 2.85×lw | enger Halo |
| 1.5 | 2.31×lw | 2.85×lw | leichter Halo |
| **4 (Default)** | **2.84×lw** | **2.85×lw** | identisch zur bisherigen Default-Optik |
| 10 | 4.10×lw | 2.85×lw | deutlich breiterer Halo |

Backward-Compat bei Default 4, Slider hat jetzt sichtbare Wirkung über
den ganzen Range. Spiegelung Animator + Tour-Map (Preview + Render).

### Audit (Track-Style 1:1 Preview vs Render)

Alle Layer-Properties (Shadow, Glow, Main, Highlight) zwischen
`modules/animator/ui/module.js` und `core/animator.py` zeile-für-zeile
abgeglichen. Stand v0.9.20 sind **alle** Werte (line-color, line-width,
line-opacity, line-blur, line-translate, line-z-offset, dasharray,
layout, layer-order, DEM-Source, exaggeration) identisch. Verbleibender
Unterschied war nur der DSF — siehe oben.

## [0.9.19] – 2026-05-24 17:00

### Geändert (Render-Speed: drei Quality-neutrale Optimierungen)

Marc:
> „Punkt 3 [Render-Speed], ich will nichts machen, was irgendwie die
> Qualität beeinträchtigt."

Drei Tuning-Schritte ohne sichtbaren Quality-Impact:

1. **Tile-Cache-Prewarm** vor der Frame-Loop. Bevor der echte Frame-by-
   Frame-Render anläuft, fliegt der Renderer 12 evenly-spaced Kamera-
   Positionen durch + wartet pro Position auf `idle` → Mapbox lädt alle
   relevanten Tiles in den Browser-Cache. Die echte Loop trifft danach
   auf gecachte Tiles → `idle` feuert in ~50 ms statt ~1–3 s pro Frame.
   Vorlauf: ca. 5–15 s. Bei langen Renders (5+ Min) Netto-Speedup
   **20–40 %**. Best-Effort — bei Fehler fährt Render unverändert fort.
2. **`prefetchZoomDelta: 6`** in Mapbox-Init (Default 4). Mapbox lädt
   Tiles bis zu 6 Zoomstufen unter der aktuellen Ansicht vorab — Kamera-
   Schwenks treffen häufiger auf bereits geladene Tiles. **10–20 %**
   schneller, gratis.
3. **ffmpeg-Preset `medium` → `fast`** für H.264/H.265. CRF bleibt
   gleich (Constant-Rate-Factor), die Encode-Qualität ist deshalb
   unverändert. Encoder rechnet weniger lange an besseren
   Compression-Entscheidungen → **30–40 % schnellerer Encode**, File
   wird ca. 5–10 % größer. Marc-Quote: keine Quality-Auswirkung
   akzeptabel. ✓

Tour-Map nicht betroffen (rendert nur 1 Frame).

## [0.9.18] – 2026-05-24 16:35

### Behoben (Resolution-Buttons inkonsistent zum Eingabefeld)

Marc:
> „bei mir waren nach dem neustart 1080p angeklickt, in den feldern
> darunter stand aber die 4K auflösung. Die Auflösung in den Feldern
> muss gewinnen. Entspricht sie nicht einem der Vorwahl-Buttons, dann
> darf keiner ausgewählt sein."

Ursache: `bindSetting`/`rebindAllSettings` setzt nach Session-Load die
`anim-w`/`anim-h`-Inputs, aber der Quick-Picker (`.res-btn`) wurde nicht
neu synchronisiert — die Buttons standen auf dem Wert von vor dem Re-Bind.

Fix: `bindSetting`-Calls für `anim-w`/`anim-h` kriegen jetzt `onLoad` +
`onChange` Callbacks, die `updateResButtons()` triggern. Damit:
- Session-Load → Felder updated → Buttons folgen
- User tippt Wert manuell → Button-State aktualisiert (war schon vorher
  via `input`-Listener, jetzt redundant aber konsistent)
- Wert entspricht keinem Preset → KEIN Button aktiv (war schon korrekt
  durch `toggle("active", match)`, jetzt nur durchgängig konsistent)

## [0.9.17] – 2026-05-24 16:20

### Behoben (Keyframe-Slider nach Session-Load doch nicht sichtbar)

Marc:
> „keyframe slider sind in der sidebar nicht sicherbar nach dem laden"

v0.9.16 hatte die Auto-Select-Logik nur in `_animOnProjectChanged()`
eingebaut — das wird aber **nur beim Projekt-Wechsel via Dropdown**
gerufen, nicht beim normalen GPX-Load. Der eigentliche Pfad geht über
`applyGlobalGpx` → `sessionActivate` → der Callback dort setzte
hartkodiert `_selectedKfIdx = null` und überschrieb damit jeden
vorherigen Auto-Select.

Fix v0.9.17:
- Auto-Select-Logik in eigene Helper-Funktion `autoSelectFirstKfIfNeeded()`
  extrahiert
- Wird jetzt an drei Stellen gerufen: (1) am Ende von `mountAnimator`
  (App-Start mit aktiver Session), (2) am Ende von `_animOnProjectChanged`
  (Dropdown-Wechsel), (3) am Ende des `sessionActivate`-Callbacks
  in `applyGlobalGpx` (GPX-Load mit existierender Session)
- Sicherer No-Op wenn schon was selektiert ist, keine KFs vorhanden,
  oder Editor aus

## [0.9.16] – 2026-05-24 16:00

### Behoben (Keyframe-Editor leer nach Session-Load)

Marc:
> „hab neugestartet, einen track geladen = session geladen mit keyframes,
> checkbox für den keyframeditor war da, aber die keyframe regler fehlen."

`window._animOnProjectChanged()` hat `_selectedKfIdx = null` und
`_selectedEvent = null` gelassen → `renderKeyframeEditor()` zeigte den
Empty-Hint statt der Slider, obwohl in der Timeline-Bar Keyframes
sichtbar waren.

Fix: nach den Migrations + wenn der Editor an ist und ≥1 Cluster
vorhanden → automatisch den ersten Cluster selektieren (`_selectedKfIdx = 0`).
Scrubber wandert auf den ersten Anker, Editor zeigt die Property-Slider
mit Werten dieses Keyframes.

### Behoben (Track im Render dünner / WYSIWYG-Bruch bei Terrain)

Marc:
> „Der track ist viel dünner im fertigen video und auch in der render
> preview als auch in der normalen preview. Prüfe, dass das passt und
> die styles 1:1 übernommen werden."

Zwei Style-Mismatches zwischen Preview und Render gefunden:

1. **`line-z-offset: 150` fehlte in der Preview.** Der Render-Code
   (`core/animator.py` + `core/tourmap.py`) setzt bei aktivem Terrain
   auf Glow, Main-Line und Highlight ein z-offset von 150 m → Track
   schwebt über dem Boden. Die Preview hatte das nicht → Track lag
   am Boden, in pitched/tilted Views entsteht durch den Perspektiv-
   Wechsel der Eindruck einer dünneren Linie. Shadow bleibt
   bewusst ohne z-offset (Schatten am Boden, Linie schwebt — wirkt
   3D).
2. **Glow `line-opacity`** war Preview 0.4 / Render 0.35 — beide auf
   0.35 angeglichen.

`applyTerrain()` aktualisiert das z-offset jetzt dynamisch bei
Terrain-Toggle. Spiegelung Animator + Tour-Map (beide Module nutzen
die gleiche Preview-Layer-Logik).

## [0.9.15] – 2026-05-24 15:30

### Hinzugefügt (KF-Pins-Toggle für echtes WYSIWYG)

Marc:
> „man muss die keyfram dots, auf dem track ausblenden können, damit es
> wirklich wysiwyg ist"

- Neue Checkbox **„KF-Pins"** in den Timeline-Actions, parallel zu „Ganzer
  Track". Steuert die Sichtbarkeit der gelben Keyframe-Pins auf der
  Karten-Vorschau.
- **An (Default)**: Pins sichtbar — hilfreich beim Setzen + Bewegen von
  Keyframes, weil man sofort sieht wo auf dem Track sie liegen.
- **Aus**: Pins ausgeblendet — die Vorschau zeigt 1:1 was später im
  gerenderten Film zu sehen ist (das Render zeichnet die Pins nie).
- Persistiert pro Projekt als `animator.preview_show_kf_pins` (bool,
  Default true → backward-compat).
- `rebuildCameraKeyframePins()` checkt den Flag und entfernt
  Source+Layer wenn aus, oder rebuildet sie wenn wieder an.

## [0.9.14] – 2026-05-24 15:00

### Behoben (Render: Farb-/Helligkeits-Schwankungen + weiße Flächen)

Marc:
> „Der ausgerenderte Film weist einige Fehler auf Farb- und Helligkeits-
> schwankungen oder weiße Flächen. Ich hab das auch schon bemerkt. In der
> Preview ist es nicht. Also liegt es nicht an der Karte."

Ursache: in `core/animator.py` hat die Render-Loop pro Frame
`window.waitForRender()` aufgerufen, das auf das ALLERERSTE `render`-Event
nach `advanceFrame()` gewartet hat — mit nur 50 ms Settle und 1,5 s Hard-
Cap. Das Problem: Mapbox feuert `render` auch während Tiles noch laden.
Wenn der Screenshot zu früh fällt, hat ein Frame:

- halbtransparente oder weiße Placeholder-Tiles (= weiße Flächen),
- noch nicht angewendeter `lightPreset`-Übergang (= Helligkeits-Sprung),
- ein Teil der Map auf dem alten + ein Teil auf dem neuen Zoomlevel
  gerendert (= Farb-/Detail-Sprung).

Die Live-Preview sieht's nicht, weil sie nur den aktuellen Browser-Zustand
zeigt — sie wartet nicht aktiv auf ein „fertiges" Frame.

Fix: `waitForRender()` nutzt jetzt `map.on('idle')` statt `map.once('render')`.
`idle` feuert garantiert erst wenn **alle Tiles geladen**, **alle Anim-/
Move-/Zoom-/Ease-Operationen fertig** und **alles gerendert** ist. Wenn die
Map schon idle ist (Frame mit gecachten Tiles + keine Camera-Bewegung),
geht's sofort weiter — kein Performance-Regress. Hard-Cap angehoben auf
5 s pro Frame (nur theoretisch bei nicht-ladenden Tiles, in der Praxis ein
paar hundert ms bei un-cached Tiles, < 50 ms bei gecachten).

Tour-Map nicht betroffen (rendert nur ein Single-Frame, dort reicht der
initiale `idle`-Listener bereits).

## [0.9.13] – 2026-05-24 01:00

### Behoben (Bergauf/Bergab massiv überzählt)

Marc:
> „Bergauf/bergab in den gesamtstats stimmt nicht"

Der alte Algorithmus in `core/gpx.py` hat jeden positiven Höhenunterschied
zwischen zwei Sample-Punkten ≥ 1 m als Anstieg summiert (bzw. ≤ -1 m als
Abstieg). Bei typischem GPS-Rauschen von ±5–10 m pro Sample ergibt das
massive Überzählung — bei einem flachen Track gibt's so 300 m+ Bergauf
obwohl die Route flach ist.

Neuer Algorithmus (`_compute_ascent_descent`):

1. **Moving-Average-Smoothing** (Fenster 5) glättet Sample-zu-Sample-
   Rauschen.
2. **Hysterese-Bezugspunkt** mit 3 m Threshold (Strava-Stil): erst wenn
   die aktuelle Höhe um mindestens 3 m vom letzten bestätigten
   Bezugspunkt abweicht, zählt die Differenz und der Bezugspunkt wandert
   mit. Kleines Rauschen rund um den Bezugspunkt wird ignoriert.

Synthetik-Tests (siehe Commit-Beschreibung):
- Flacher Track mit ±5 m Rauschen: vorher 326 m falsch, jetzt 9 m
- Reiner 500-m-Anstieg: vorher 500 m, jetzt 495 m (1 % Underestimation
  durch Smoothing am Rand — akzeptabel)
- Hike 500 m hoch + 400 m ab + ±4 m Rauschen: jetzt 494/394 m
  (vorher 500/399 m — kein Problem, Marc-Tracks sind ohne Rauschen
  ohnehin sauber)

Animator + Tour-Map nutzen beide `core/gpx.parse_gpx_file` → kriegen
die Verbesserung automatisch.

## [0.9.12] – 2026-05-24 00:10

### Hinzugefügt (Render-Lock — UI sperren während Render läuft)

Marc:
> „während des renderns muss alles deaktiviert werden, module wechseln usw."

- Beim Render-Start (Animator + Tour-Map) setzt `setRenderingState(true)`
  die Klasse `body.is-rendering`.
- Globale CSS-Regel (ui/css/app.css) sperrt damit Topbar (Modul-Tabs,
  Projekt-Wechsel, Settings-Icons), Sidebar (`.panel`), Modul-Header
  (GPX-Picker), Timeline-Host, Refit-Button + Auflösungs-Badge. Alles
  via `pointer-events: none` + halbierter Opacity (visueller
  „disabled"-Eindruck).
- Cancel-Button + Progress-Overlay (inkl. Live-Preview) bleiben voll
  interaktiv — Marc kann Render jederzeit abbrechen.
- Bug-Report-Modal kann sich zwischenzeitlich öffnen (z.B. bei Crash)
  und bleibt bedienbar.
- Bei Done / Cancel / Error → `setRenderingState(false)` gibt UI frei.
- Tour-Map gleichberechtigt umgesetzt (Spiegelungs-Regel).

## [0.9.11] – 2026-05-23 23:45

### Hinzugefügt (Preview-Toggle „Ganzer Track")

Marc:
> „Toggle, um zu wählen, dass in der Preview der ganze Track angezeigt
> wird, egal, wo man sich auf der Timeline befindet. Ich würde neben
> 'Probelauf' einfach eine checkbox machen 'vollständigen Track
> anzeigen'."

- Neue Checkbox **„Ganzer Track"** in der Timeline-Bar neben Probe-Lauf.
  An: kompletter Track immer in der Vorschau sichtbar.
  Aus (Default): Track wird zur Scrubber-Position getrimmt (wie im
  finalen Render).
- Setting pro Projekt persistiert: `animator.preview_full_track` (bool).
- `scrubPreview()` honoriert den Toggle, `refreshPreviewTrackData()`
  triggert beim Umschalten ein sofortiges Re-Setup der Source-Daten.

### Hinzugefügt (Warnung beim Deaktivieren des Keyframe-Editors)

Marc:
> „was passiert eigentlich, wenn ich den keyframe editor deaktiviere und
> keyframes gesetzt sind? Da muss eine Warnung kommen 'Keyframes gehen
> verloren! Willst du den Keyframes Editor wirklich verlassen?'"

- Click-Handler auf `#anim-kf-enabled` interceptet den Toggle, BEVOR der
  Wert kippt. Wenn der User abschalten will und Camera-Property-Events
  vorhanden sind → Modal mit klarer Warnung + roter „Editor deaktivieren"-
  Button + „Abbrechen".
- Bei Bestätigung: alle Camera-Events werden gelöscht, Toggle kippt
  programmatisch, `applyKeyframesEnabled()` schaltet auf Classic-Modus
  zurück.
- Bei Abbruch: Toggle bleibt an, Keyframes bleiben unverändert.
- i18n-Keys DE/EN/ES für Titel + Body + Button-Label.

### Entfernt (Mapbox-Fullscreen-Button)

Marc:
> „Es gibt einen Fullscreen button rechts unten an der Map, der nix
> bewirkt. Blende den aus."

- Globale CSS-Regel in `ui/css/app.css` versteckt `.mapboxgl-ctrl-fullscreen`
  + jeden Bottom-right-Button mit aria-label „full screen" / „vollbild".
  Wir adden den Control nirgendwo explizit, je nach Style-Variante taucht
  er aber trotzdem auf.

## [0.9.10] – 2026-05-23 23:00

### Geändert (Karte passt sich der Timeline-Höhe dynamisch an)

Marc:
> „die karte muss sich der freien fläche anpassen. ohne keyframe editor
> hat die ja viel mehr platz"

Bisher hat `.anim-canvas` ein fixes `padding-bottom: 230 px` reserviert,
egal ob die Bar 250 px (Multi-Lane an) oder ~95 px (Classic-Modus) hoch
war. Folge: im Classic-Modus hatte die Karte 130 px mehr verfügbaren
Platz, hat ihn aber nicht genutzt.

Jetzt:
- `padding-bottom: var(--anim-tl-h, 230px)` — Variable wird von JS
  gesetzt.
- `.anim-refit-btn` und `.anim-resolution-badge` nutzen
  `bottom: calc(var(--anim-tl-h, 230px) + 16px)` → folgen mit.
- Neue Helper-Fn `syncTimelineHeight()` misst `.anim-timeline-host.offsetHeight`
  und setzt die Variable.
- Zusätzlicher `ResizeObserver` auf der Timeline-Bar feuert bei jeder
  Höhenänderung (KF-Editor-Toggle, ?-Hilfe öffnen/schließen, künftige
  dynamische Inhalte) → `--anim-tl-h` + `updateAnimatorViewport()` +
  `fitTrackPreview()` werden automatisch nachgezogen.
- `transition: padding-bottom 0.18s ease` für sanften Übergang.

Tour-Map nicht betroffen (kein Timeline-Bar dort).

## [0.9.9] – 2026-05-23 22:45

### Behoben (Keyframe-Editor aus → trotzdem die volle Multi-Lane-Timeline)

Marc:
> „die volle timeline wird jetzt angezeigt, auch wenn der keyframe editor
> aus ist, das ist falsch"

Bei deaktiviertem Keyframe-Editor (Master-Toggle aus) sollten die
Lanes + die Cluster-Zeile weg sein — wie vor v0.9.1, wo die Bar nur ein
schmaler Streifen mit Scrubber + Probe-Lauf war. Die CSS-Regel aus
v0.8.16 hat aber nur den alten `.timeline-markers`-Container versteckt,
nicht die seit v0.9.1 existierenden `.timeline-lanes`.

- `.anim-timeline-host--kf-off .timeline-lanes { display: none !important }`
  hinzugefügt.
- `.timeline-cluster-row` war seit v0.9.4 schon ausgeblendet (Regel
  weiter oben), passt also automatisch.
- Ersatz-Optik: `#tl-track` bekommt im kf-off-Modus `min-height: 28px`
  und einen schmalen Achsen-Strich per `::before` — Scrubber +
  Triangle-Handle sitzen wieder auf einem klar erkennbaren Track.

## [0.9.8] – 2026-05-23 22:20

### Hinzugefügt (Per-Lane-Keyframe via Doppelklick)

Marc:
> „man sollte irgendwie durch klick auf die entsprechende zeile der
> timeline nur für den entsprechenden wert dort einen keyframe setzen
> können. Oder geht das schon irgendwie? sonst hat man immer den ganzen
> cluster und muss alles was man nicht braucht rauslöschen."

- **Doppelklick auf eine Lane** (Pitch / Drehung / Zoom / Position) legt
  genau einen Property-Event für DIESE Lane an der Klick-Position an. Der
  Wert kommt aus der aktuellen Karten-Ansicht (Pitch aus `map.getPitch()`,
  Bearing aus `map.getBearing()`, Zoom-Δ relativ zum Fit-Base, Center aus
  `map.getCenter()`).
- **Doppelklick auf die Cluster-Zeile** legt wie bisher alle 4 Properties
  als Bündel an (= `snapshotKeyframe`).
- Nach dem Anlegen ist der neue Event direkt selektiert — der zugehörige
  Editor-Slider leuchtet auf (v0.9.5-Glow), Karten-Pin erscheint.
- Hint im Timeline-`?`-Tooltip aktualisiert (DE/EN/ES).

### Geändert (Playhead-Handle weg vom Cluster)

Marc:
> „Der playhead lässt sich nicht greifen, weil er zu dicht am cluster ist."

- Top-Dot des Scrubbers entfernt, stattdessen ein **Triangle-Handle UNTEN**
  am Scrubber (zwischen den Lanes und der Status-Zeile). Saß bisher direkt
  auf der Cluster-Marker-Höhe — bei Anker 0 % / 100 % deckte sich der Dot
  optisch mit dem Cluster-Marker und der Cluster-Marker fing den Klick.
- Handle hat eigene Mousedown-Bindung → klar greifbar, auch wenn Marker
  am selben Anker stehen.
- Optisch wie ein klassischer Playhead aus Filmschnitt-Programmen.

### Geändert (Auflösungs-Badge fadet aus)

Marc:
> „die auflösung steht immer noch drin."

- `.anim-resolution-badge` (+ analog `.tourmap-resolution-badge` per
  Spiegelungs-Regel) ist jetzt nur sichtbar wenn `is-visible` gesetzt
  ist. JS setzt das Flag bei jeder Resolution-Änderung und entfernt es
  nach **2,5 s** wieder.
- Default-Opacity ist 0, Übergang via CSS-Transition. Beim Mount erscheint
  die Badge einmal kurz mit den initialen Werten, fadet dann weg.

## [0.9.7] – 2026-05-23 21:50

### Behoben (Viewport zu hoch → Höhenprofil + Auflösungs-Badge im Bild)

Marc:
> „die Auflösung steht plötzlich wieder die ganze Zeit im Bild und das
> Höhenprofil ist in der Preview zu weit unten"

`updateAnimatorViewport()` hat die verfügbare Höhe nur als
`clientHeight - margin * 2` berechnet — aber `clientHeight` schließt
das `padding-bottom` (Platz für die Timeline-Bar, seit v0.9.2 230 px)
mit ein. Folge: der Viewport wurde zu hoch, sein unterer Rand ragte in
die Timeline-Region rein, Overlays am Boden (Höhenprofil, Stats-Box,
ggf. Logo) rutschten optisch IN die Timeline + die `.anim-resolution-
badge` (an `bottom: 246 px` der `.anim-canvas`) lag plötzlich INNERHALB
des Letterbox-Viewports.

Fix: `avH = clientHeight - margin*2 - padding-top - padding-bottom`.
Das Padding wird via `getComputedStyle` gelesen, ist also robust gegen
spätere CSS-Anpassungen der Reserve-Höhe.

Tour-Map ist nicht betroffen — `.tourmap-canvas` hat kein
padding-bottom (kein Timeline-Bereich darunter).

## [0.9.6] – 2026-05-23 20:10

### Geändert (Track-folgen-Hinweis als ?-Tooltip)

Marc:
> „der hilftext zu kamera folgt dem gps punkt muss noch durch ein ?
> ausgetauscht werden, ansonsten sieht das richtig gut aus."

Der Live-Hint-Text unter der „🚶 Kamera folgt dem Track"-Checkbox
(„Kamera folgt dem GPS-Punkt — Pan wird ignoriert" bzw. „Freier
Karten-Ausschnitt …") war Dauer-Text. Jetzt:

- Hilfetext liegt hinter einem `?`-Button neben der Checkbox.
- Klick togglet die Erklärung ein/aus — Pattern-Convention wie für
  Trackpunkte, Snapshot-Hilfe, Editor-Hilfe usw. (eingeführt in
  v0.8.19/20).
- Inhalt: `animator.kf.follow_tip` (deckt beide Modi gleichzeitig ab),
  spart die dynamische Live-Aktualisierung des Hint-Texts pro
  Checkbox-Toggle.

### Intern

- Wrapper-Div `.kf-follow-wrap` mit `data-prop="center"` umschließt
  Checkbox + ?-Button, damit der v0.9.5-Color-Strip + die
  Per-Property-Sichtbarkeit auch den Toggle-Block erfassen.
- Editor-CSS verallgemeinert: `[data-prop]` statt `.field[data-prop]` /
  `.checkbox-row[data-prop]`. Greift jetzt für alle drei Container-
  Typen (Slider-Field, Checkbox-Row, neuer Wrap-Div).
- Tote `followHint.textContent`-Updates aus `renderKeyframeEditor()`
  und dem `follow-track`-Change-Handler entfernt.

## [0.9.5] – 2026-05-23 19:55

### Geändert (Timeline Rand-Inset + Editor-Slider farb-codiert)

Marc:
> „ganz rechts ein bisschen rand lassen, wenn da keyframes sind, sieht
> man die nur noch zur hälfte"
> „und so richtig intuitiv ist das noch nicht. kannst du vielleicht den
> regler highlighten, der für den gewählten keyframe zuständig ist."

- **14 px Rand rechts in der Timeline-Bar.** Marker, Scrubber, Hold-Region
  und Anim-End-Trenner sind jetzt bündig zur inneren Track-Region (statt
  bis zum harten Container-Rand). Ein Keyframe an Anker = 1.0 sitzt jetzt
  voll sichtbar vor dem Rand, statt halb über die Kante zu schauen.
  - `.timeline-track-overlay { right: 14px; }`
  - `.lane-markers`, `.cluster-markers`, `.lane-axis`, `.cluster-axis`
    bekommen identisches Inset.
  - `anchorFromClientX()` nutzt das overlay-Rect direkt — Click-Mapping
    bleibt automatisch konsistent.

- **Detail-Editor: jeder Slider zeigt seine Lane-Farbe.** Pitch-Slider
  hat einen blauen Akzent-Streifen, Bearing grün, Zoom violett, Position
  orange, Anchor gelb — gleiche Farben wie die Timeline-Lanes. Sieht man
  auch im Cluster-Modus (alle 4 Slider sichtbar) auf einen Blick welcher
  Regler zu welcher Spur gehört.

- **Aktiver Slider mit Glow + fetter Beschriftung.** Wenn ein einzelner
  Lane-Marker selektiert ist (Per-Property-Modus), bekommt der zugehörige
  Slider zusätzlich einen farbigen Box-Shadow-Glow und seine Beschriftung
  wird hervorgehoben — damit klar ist „dieser Regler ist gerade
  zuständig". Realisiert via `.is-active`-Klasse die `renderKeyframeEditor()`
  setzt.

## [0.9.4] – 2026-05-23 19:30

### Hinzugefügt (Cluster-Handle über allen Lanes)

Marc:
> „mach doch oben drüber einen marker, um den cluster zu bewegen, das
> ist am intuitivsten"

Über den 6 Lane-Spuren der Timeline gibt's jetzt eine eigene Zeile —
„🎬 Cluster" — mit einem deutlich größeren Marker pro unique Anker:

- **Klick** auf den Cluster-Marker → ALLE 4 Properties am Anker werden
  selektiert (Editor zeigt wieder alle Slider, wie aus v0.9.1).
  Die zugehörigen Lane-Marker leuchten gleichzeitig mit auf — so sieht
  der User auf einen Blick, was zum Cluster gehört.
- **Drag** → alle 4 Property-Events am Anker wandern zusammen. Im
  Datenmodell wird der Anker für `pitch`, `bearing`, `zoom`, `center`
  synchron umgeschrieben.
- **Rechtsklick** → ganzer Cluster (alle 4 Properties) wird auf einmal
  gelöscht. (Wie der Delete-Button im Editor mit Cluster-Selektion.)

Die Lane-Marker bleiben wie in v0.9.3: für die feine, per-Property-Edit-
Arbeit. Der Cluster-Marker ist die intuitive Variante für „verschiebe
das ganze Snapshot-Paket".

### Behoben (Selektion blieb beim Drag nicht stehen)

Beim Verschieben eines Lane-Markers (v0.9.3) hat `scrubPreview` über
`syncScrubberSelection` die Per-Property-Selektion direkt wieder genullt.
`moveEvent()` ruft `scrubPreview()` jetzt mit `skipSelectionSync: true`
— die Selektion bleibt während des Drags stabil sichtbar.

## [0.9.3] – 2026-05-23 18:00

### Hinzugefügt (Per-Property-Edit — MVP-2b)

Marc:
> „wie kann ich einzelne properties auswählen? der nimmt immer gleich alles."

Bisher (v0.9.1) hat Click auf einen Lane-Marker immer den ganzen Cluster
(= alle 4 Camera-Properties am gleichen Anker) selektiert. Jetzt:

- **Click auf einen Lane-Marker** → nur diese eine Property ist ausgewählt.
  Detail-Editor zeigt **nur den passenden Slider**:
  - 📐 Pitch-Marker geklickt → nur Pitch-Slider sichtbar
  - 🧭 Bearing-Marker → nur Bearing
  - 🔍 Zoom-Marker → nur Zoom
  - 📍 Position-Marker → nur Follow-Track-Checkbox
- **Drag** eines Lane-Markers → bewegt nur diese eine Property, nicht
  den ganzen Cluster.
- **Rechtsklick** auf Lane-Marker → löscht nur diese eine Property.
- **„Mit aktueller Karte"-Button** updated nur die selektierte Property
  (oder alle 4 im Cluster-Modus).
- **Delete-Button** löscht entsprechend nur den Event oder den Cluster.

**Snapshot bleibt unverändert** (= setzt alle 4 Properties). Wer nur
eine Property updaten will, klickt direkt auf einen vorhandenen
Lane-Marker oder löscht die anderen 3.

**Scrubber-Bewegung** (Click auf Timeline-Region, Pfeiltasten etc.)
geht in den Cluster-Modus zurück — sodass mit `📍 Hier Keyframe`
oder „Mit aktueller Karte" weiterhin alle 4 Properties auf einmal
gesetzt werden, wenn der User das will.

Damit kann Marc jetzt z.B.:
- KF bei 0%, 50%, 100% mit Snapshot setzen (= 12 Events)
- Den mittleren Bearing-Event ALLEINE löschen → Bearing interpoliert
  durchgehend von 0% auf 100% während Pitch/Zoom/Position die
  Zwischenstation behalten

## [0.9.2] – 2026-05-23 17:30

### Behoben (Timeline-Bar überlappte die Karte)

Marc:
> „die auflösung oder so der sidebar geschoben, die jetzt ständig die
> timeline überlappt"

`.anim-canvas` hatte `padding-bottom: 140px` als Reserve für die alte
1-Spur-Timeline. Mit Multi-Lane ist die Bar jetzt ~220 px hoch → ragte
in die Karten-Sichtfläche. Padding auf 230 px erhöht; Refit-Button
Bottom-Offset entsprechend mit angepasst (276 → 246 px).

### Geändert (Timeline-Hilfetexte als ?-Tooltip)

Tastatur-Hinweise (`← →` GPS-Punkt, `Space` Stop usw.) und der Gesten-
Tipp (💡 Karte hinziehen + …) waren als Dauer-Text unterhalb der
Bar. Jetzt: zusammengefasst hinter einem **?-Icon** rechts neben der
Position-Anzeige. Klick togglet die Hilfe ein/aus — passt zur
Pattern-Convention aus v0.8.19/20.

### CI / Build (in 0.9.1 schon committet, hier dokumentiert)

- **GitHub-Actions-Storage-Sparmaßnahme** (Marc bekam Quota-Warnung 90%
  von 0.5 GB Free-Tier):
  - `release.yml` Trigger: vorher bei jedem main-Push, jetzt **nur noch
    bei Tag-Push** (`v*`) + manuell. Hat ~230 MB pro Push gespart.
  - `upload-artifact`-Retention von 90 → 7 Tagen.
  - 94 alte Artifacts (~8.1 GB akkumuliert) gelöscht.
  - Lokale Tests + lokaler `./build.sh` bleiben das Daily-Driver-Setup,
    Cloud-Build ist jetzt rein Release-fokussiert.

## [0.9.1] – 2026-05-23 17:00

### Hinzugefügt (Multi-Lane-Timeline-Anzeige — MVP-2a)

Marc gibt grünes Licht für Multi-Lane (2026-05-23). Die Timeline-Bar
zeigt jetzt **6 horizontale Spuren** statt einer:

| Lane     | Farbe        | Symbol | Inhalt |
|----------|--------------|--------|--------|
| Pitch    | blau         | 📐     | Kamera-Neigung |
| Drehung  | grün         | 🧭     | Kamera-Bearing |
| Zoom     | lila         | 🔍     | Zoom-Offset |
| Position | orange       | 📍     | Karten-Center |
| Marker   | gelb (~50%)  | 🏷      | Reserve für Karten-Marker (v0.9.2+) |
| Foto     | pink (~50%)  | 📷     | Reserve für Foto-Inserts (v0.9.2+) |

Pro Lane werden die Property-Events als kleine farbcodierte Pins
gerendert. Snapshot setzt weiterhin 4 Events gleichzeitig — also
ein Pin in jeder der vier Camera-Lanes.

Scrubber + Anim-/Hold-Trenner laufen durchgängig über alle Spuren.
Marker-/Foto-Lanes sind sichtbar (= „dort werden später Sachen
hinkommen") aber leicht ausgegraut, damit klar ist dass sie noch
nicht aktiv sind.

### Bekannt — kommt in v0.9.2 (MVP-2b)

- **Per-Property-Edit:** Aktuell ist ein Klick auf einen Lane-Marker
  noch Cluster-Selection (= alle 4 Properties am gleichen Anker im
  Editor). Soll werden: Klick selektiert nur diesen einen Event und
  der Editor zeigt nur den relevanten Slider.
- **Per-Lane-Snapshot:** kleinere Buttons pro Lane, um z.B. nur
  Bearing zu snapshotten.
- **Marker- und Foto-Workflows:** Klick auf Karte = Marker setzen,
  Foto drop = Foto-Event anlegen.

## [0.9.0] – 2026-05-23 16:30

### ⚠️ Geändert (Property-Event-Datenmodell — Vorbereitung für Multi-Track-Timeline)

Marc:
> „Ok, jetzt die multitrack timeline. lasse gleich platz für marker, die
> man auf der karte zu einer bestimmten zeit platzieren kann und fotos"

Bis v0.8.20 bündelte ein `{kind:"camera"}`-Event alle 4 Kamera-Properties
(pitch, bearing, zoom_offset, center). Mit Multi-Track-Timeline kriegt jede
Property eine eigene Spur — damit z.B. eine durchgehende 360°-Drehung
sauber über das ganze Video läuft, während dazwischen Pitch + Zoom mehrere
Keyframes haben können ohne die Drehung zu stören.

**Neues Datenmodell** (in `timeline_events`):
```js
{kind: "pitch",   anchor: 0.3, value: 45}
{kind: "bearing", anchor: 0.3, value: 90}
{kind: "zoom",    anchor: 0.3, value_offset: 0.5}
{kind: "center",  anchor: 0.3, value: [lon, lat]}   // null = follow track
```

Reservierte Event-Typen für später (Marc-Wunsch 2026-05-23):
```js
// Marker = beschriftete Karten-Pins, die zu einem Zeitpunkt auftauchen.
// `position` darf VOM TRACK ABWEICHEN (z.B. „Hotel" 500 m abseits).
{kind: "marker", anchor: 0.5, label: "Gipfel", icon: "🏔",
 position: [lon, lat] | null}   // null = am Track-Punkt zum anchor

// Foto = Bild-Insert für ein Zeitfenster. Zwei Positions-Modi:
//   - screen_pos: Picture-in-Picture in einer Ecke
//   - map_pos: AUF DER KARTE verankert (3D-Plane, kann auch abseits Track sein)
{kind: "photo", anchor_start, anchor_end, path,
 screen_pos: "tl"|"tr"|"bl"|"br"|"center" | null,
 map_pos: [lon, lat] | null}
```

**Backend** (`core/timeline.py`):
- Neue `interpolate_properties()` — pro Property unabhängig.
- Pro Property eigene Sortier-Liste, eigene Interpolation (shortest-arc für
  Bearing, lon/lat-Lerp für Center).
- Backward-Compat: wenn keine Property-Events vorhanden, fällt's auf
  `interpolate_camera()` mit alten camera-Events zurück.

**Render-Loop** (`core/animator.py`):
- Nutzt jetzt `interpolate_properties`. Pro Property eigener Default-Fallback:
  pitch → `cfg.pitch`, bearing → linearer Sweep über `cfg.rotation`,
  zoom_offset → 0, center → null (mit `camera_follow_track`-Toggle).

**Migration** (`migrateCameraToPropertyEventsIfNeeded` in animator/ui/module.js):
- Bestehende `kind:"camera"`-Events werden beim ersten Laden in 4 Property-
  Events am gleichen Anker gesplittet. Idempotent via Flag
  `timeline_schema_v: 2`.

### MVP-1: visuell wie heute, aber Datenmodell ist neu

Diese Version ist die **Datenmodell-Migration**. UX-mäßig bleibt's wie in
v0.8.20: ein Marker pro Keyframe-Cluster (unique anchor) auf der Timeline-
Bar, Detail-Editor zeigt alle 4 Properties zusammen, Snapshot setzt 4 Events
gleichzeitig.

Die echte **Multi-Lane-UI** mit horizontal gestapelten Property-Spuren
(Pitch/Bearing/Zoom/Center/Marker/Foto) kommt in v0.9.1 als **MVP-2**.
Damit kann Marc dann pro Spur einzeln Keyframes setzen/verschieben/löschen.

## [0.8.20] – 2026-05-23 15:45

### Geändert (Alle Hilfetexte als ?-Tooltip)

Marc:
> „statt keyframe hilfetext auch nur ein ? liest man auch nur 1x. mach
> das bei allen tipps so. durchsuche das projekt danach"

Bisher dauerhafte Hilfetexte sind jetzt unter Click-Toggles versteckt:

- **Trackpunkte**: ?-Icon (war schon in v0.8.19)
- **Karten-Elemente (Admin-Hinweis)** im Animator + Tour-Map: ?-Icon
- **Keyframe-Editor**: zwei Pill-Buttons „? Wie funktioniert das?" und
  „? Keyframe löschen — wie?" (statt zwei feste Text-Blöcke unterhalb
  der Buttons)

Pattern (`.field-help` mini-Icon und `.field-help-pill` mit Label) ist
global registriert in `ui/js/util.js` — funktioniert in jedem Modul.

### Hinzugefügt (Keyframe-Shortcuts)

Marc:
> „shortcut 'K' um keyframe an der stelle hinzuzufügen wo man ist.
> oder rechtsklick/doppel tap auf dem touchpad"

Zwei neue Wege Keyframes zu setzen (nur aktiv wenn Editor an):

- **Taste K** → setzt einen Keyframe an aktueller Scrubber-Position
  (entspricht „📍 Hier Keyframe"-Button). Vorher war K Stop zusammen
  mit Space — Stop bleibt auf Space alleine.
- **Rechtsklick / Zwei-Finger-Tap** auf die Karte → setzt einen Keyframe
  (über `map.on("contextmenu")`). Browser-Default-Kontextmenü wird
  unterdrückt.

Timeline-Bar-Tastatur-Hint zeigt die neue Belegung an.

### Behoben (Sidebar verschiebbar)

Marc:
> „die sidebar kann ich leicht links und rechts hin und herschieben.
> das sollte nicht sein."

Lag daran dass `.panel` (Sidebar) nur `overflow-y: auto` hatte und
horizontales Scrollen per Default `visible` war. Jetzt: `overflow-x:
hidden` + alle direkten Kinder bekommen `max-width: 100%` als Sicher-
heits-Cap, damit überlange Elemente das Panel nicht sprengen können.

## [0.8.19] – 2026-05-23 15:15

### Behoben (Preview folgte dem Track trotz „Kamera folgt Track" aus)

Marc:
> „keyframe editor aus, kamerafolgt track aus. sie folgt dem track
> trotzdem. zumindest in der preview."

`scrubPreview` und `runTimelinePreview` haben den `currentCoords[idx]`
immer als Center an `easeTo`/`jumpTo` übergeben, wenn kein Keyframe
einen expliziten Center hatte. Damit folgte die Kamera dem Track auch
im Classic-Modus, wenn der Toggle aus war. Jetzt: im Classic-Modus +
Toggle aus → `center` wird gar nicht erst übergeben, Map bleibt wo sie
ist. (Render macht das jetzt schon korrekt via Backend-`camera_follow_track`.)

### Geändert (Aufgeräumte Sidebar)

Marc: drei UI-Anpassungen für weniger Visuellem-Rauschen:

- **Punktabstand-Slider** wird komplett ausgeblendet bei durchgezogener
  Linie oder Röhre (vorher: nur `hidden` Attribut — durch `.field`-CSS
  evtl. nicht ganz weg. Jetzt zusätzlich explizites `style.display:none`.)
- **Schattenstärke-Slider** verschwindet komplett wenn Schlagschatten-
  Checkbox aus ist (vorher: nur ausgegraut + opacity 0.5).
- **Glow-Stärke-Slider** verschwindet komplett wenn Glow-Checkbox aus ist.

### Geändert (Hilfe-Texte als Fragezeichen-Tooltip statt Dauer-Anzeige)

Marc:
> „statt der info bei der trackpunkte ein kleines fragezeichen, klickt
> man darauf kommt der text als hilfe. das liest man einmal und dann
> nie wieder."

Bei „Trackpunkte" (Performance & Output) wird der lange Erklär-Text
nicht mehr permanent angezeigt. Stattdessen ein kleines **„?"-Icon**
neben der Bezeichnung — Klick togglet die Hilfe ein/aus. Sieht
unauffällig aus, ist aber jederzeit zugänglich für neue User.

Pattern ist wiederverwendbar (`<button class="field-help" data-help="...">`
+ `<div class="field-help-content" data-help-content="...">`) — kann
ich für andere lange Hint-Texte ausrollen wenn Marc das gut findet.

## [0.8.18] – 2026-05-23 14:45

### Behoben (Zoom-Slider im Keyframe-Editor)

Marc:
> „der schieberegler [Zoom] bei den keyframes funktioniert nicht richtig"

Zwei Bugs gleichzeitig:

1. **Backend-Clamp zu eng:** `zoom_offset` wurde auf `-5..+6` geklemmt.
   Der Slider erlaubt aber absolute Mapbox-Zoom 0–22, was bei einem
   typischen Auto-Fit-Zoom von 12 Offsets von `-12..+10` ergibt — die
   Hälfte wurde vom Render einfach ignoriert. Jetzt: `-22..+22` (= im
   Praxis nie eingreifend, da Mapbox intern eh auf 0–22 clamped).

2. **Bezugsgröße flackerte:** Der Slider rechnet absoluter Zoom →
   `zoom_offset = absZoom - fitBase`. Wenn `_fitZoomBase` null war,
   fiel der Code auf `map.getZoom()` zurück — was sich aber WÄHREND
   des Slider-Drags durch das easeTo des scrubPreview verschiebt.
   Race-Condition: jeder Slider-Drag rechnete gegen einen anderen
   Bezug. Jetzt: `fitBase` wird beim Auswählen eines KFs einmalig in
   `dataset.fitBase` des Sliders festgehalten und während des Drags
   konsistent verwendet.

### Hinzugefügt (Classic-Modus: Zoom-Stufe + Track-folgen)

Marc:
> „ohne keyframeeditor braucht noch zoomstufe […] und track folgen an aus."

Camera-Section (Classic-Modus) bekommt zwei neue Regler:

- **Zoom-Stufe** — Slider 0–22, setzt direkt den Map-Zoom (analog Pitch/
  Rotation). Beim Render wird der aktuelle Map-Zoom als `override_zoom`
  übernommen, also WYSIWYG.
- **Kamera folgt Track** — Checkbox. Wenn aktiv, zentriert die Render-
  Kamera bei jedem Frame auf den aktuellen Track-Punkt (statt statisch
  auf Bbox-Center). Neues Backend-Field `camera_follow_track` in
  `AnimatorConfig`, default false. Im Keyframe-Modus ignoriert — dort
  steuert pro Keyframe das `center`-Feld bzw. Follow-Toggle.

## [0.8.17] – 2026-05-23 14:15

### Geändert (Sidebar-Aufräumung: Kamera ↔ Kamera-Keyframe)

Marc:
> „Timeline nur ausblenden ist falsch. Die möglichkeit die vorschau
> abzuspielen muss ja auch bei disabled key frame bleiben. Und auch die
> sidebar aufräumen. Kamera Keyframe raus, wenn deaktiviert an die stelle
> kamera mit allen reglern. Ist keyframe aktiviert, wird kamera durch
> keyframe kamera ersetzt. So wirds übersichtlich."

Sidebar hat jetzt **eine** „Kamera"-Sektion, deren Inhalt zwischen zwei
Modi wechselt. Die separate „Camera-Keyframes"-Section ist weg:

- **Section-Header:** „Kamera" (▾)
- **Erste Zeile innen:** Checkbox „🎥 Keyframe-Editor" (Master-Toggle)
- **Classic-Modus** (Toggle aus): Pitch-Slider + Rotation-Slider
- **Keyframe-Modus** (Toggle an):
  - kein KF ausgewählt → Hinweistext „Setze einen Keyframe mit 📍 …"
  - KF ausgewählt → Anchor + Pitch + Bearing + Zoom + Follow-Track-Checkbox + From-Map-Button + Delete-Button

Timeline-Bar **bleibt sichtbar** auch im Disabled-Modus — nur die KF-
spezifischen Buttons (📍 Hier Keyframe, 🗑 Alle weg) + Marker + Hold/
Anim-Trenner sind versteckt. Scrubber + Probe-Lauf-Button funktionieren
weiterhin, damit man die klassische Animation durchspielen kann ohne
KFs zu aktivieren.

## [0.8.16] – 2026-05-23 13:45

### Geändert (Keyframe-Editor ist jetzt opt-in — schlankes Default-Setup)

Marc:
> „lass default ohne keyframe alles. also wenn ich ein neues projekt
> erstelle, dann ist das ganze keyframezeug in der sidebar und die timeline
> weg. es bleibt nur eine checkbox in der sidebar 'Keyframe Editor'. […]
> Sonst sieht gleich alles viel zu kompliziert aus"

Stimmt — die Timeline-Bar + Detail-Editor + Karten-Pins sind cinematische
Pro-Features, kein Default-Workflow. Neue Projekte starten jetzt mit:

- ✅ Klassische Sidebar (Pitch/Rotation/Terrain/Track-Stile etc.)
- ✅ **Nur eine Checkbox** „🎥 Keyframe-Editor" als Hinweis
- ❌ KEINE Timeline-Bar unter der Karte
- ❌ KEIN Detail-Editor in der Sidebar
- ❌ KEINE Karten-Pins für KFs

Wenn der User die Checkbox aktiviert:
- Timeline-Bar erscheint unter der Karte
- Detail-Editor wird zugänglich (sichtbar sobald ein KF ausgewählt ist)
- Karten-Pins werden gezeichnet
- Render nutzt die Keyframes für cinematische Kamera-Fahrten

**Toggle ist nicht-destruktiv:** Wer den Editor ausschaltet, behält seine
Keyframes — sie bleiben im Projekt gespeichert und werden beim Render
nur ignoriert. Wieder einschalten und alles ist da wie vorher.

**Migration:** Bestehende Projekte mit `timeline_events` werden beim
ersten Laden automatisch auf `keyframes_enabled: true` gesetzt (sonst
wäre's eine Regression für User die schon KFs hatten). Idempotent —
das Flag wird nicht überschrieben wenn schon explizit gesetzt.

## [0.8.15] – 2026-05-23 13:15

### Geändert (Abstand → Punktabstand, klarer was er macht)

Marc:
> „mal anders gefragt … was macht der abstand slider überhaupt?
> Ich dachte, man kann damit den track über der karte schweben lassen"

Das hat tatsächlich nichts mit Höhe zu tun, sondern mit dem Dash-Pattern.
Slider umbenannt zu **„Punktabstand"** + Tooltip: „Multipliziert die
Strich- bzw. Punkt-Längen im Linien-Muster. Nur aktiv bei
Gestrichelt/Gepunktet/Strich-Punkt."

Sichtbarkeit war schon korrekt (versteckt bei Durchgezogen/Röhre) — nur
die Beschriftung war missverständlich.

(Zwischenstand v0.8.15 hatte auch einen „Trackhöhe"-Slider für `line-z-offset` —
ist im Live-Test nicht überzeugend gewesen, daher wieder entfernt. Backend
bleibt beim bisherigen hardcoded 150 m über Terrain.)

## [0.8.14] – 2026-05-23 12:30

### Behoben (Abstand-Slider — Phase 2)

Der `null`-cycle aus v0.8.13 hat Mapbox-GL 3.x nicht überzeugt. Das
SDF für `line-dasharray` wird intern nur beim **Anlegen** des Layers
gebaut; spätere `setPaintProperty`-Aufrufe ändern den gespeicherten
Wert, aber der gerenderte Stroke bleibt unverändert.

**Echter Fix:** dasharray ist jetzt **direkt im Layer-Paint** beim
Anlegen drin (`rebuildPreviewLayers` liest `currentDasharray()` und
gibt's an `addLayer({paint:{…}})` weiter). Bei Live-Wechsel von
Linien-Stil oder Abstand werden die 3-4 betroffenen Layer
weggeworfen und über denselben `rebuildPreviewLayers` neu angelegt
— Mapbox baked dann ein neues SDF.

Animator + Tour-Map synchron.

### Geändert (Zoom im Keyframe-Editor ist jetzt absolut)

Marc:
> „was ist zoom rel zu Autofill? warum gibts keinen normalen zoom regler
> bei den keyframes?"

Bis v0.8.13 zeigte der Keyframe-Zoom-Slider einen **Offset zum
Auto-Fit-Zoom** (−3 bis +3, default 0). Verwirrend.

Jetzt: Slider zeigt **absoluten Mapbox-Zoom 0–22** (Default 12).
Intern speichern wir weiter `zoom_offset = absolute − fit_zoom`, damit
beim Auflösungs-Wechsel die WYSIWYG-Konsistenz bleibt (Auto-Fit-Zoom
ändert sich, Offset bleibt). Konversion passiert in
`renderKeyframeEditor` (anzeigen) + dem Zoom-Slider-onChange-Handler
(zurückspeichern).

## [0.8.13] – 2026-05-23 12:00

### Behoben (Abstand-Slider bewegt sich nichts in der Vorschau)

Marc:
> „wenn ich ‚abstand' verändere ändert sich nichts, zumindest in der
> preview nicht"

**Ursache:** Mapbox-GL 3.x cached die `line-dasharray`-SDF (Signed
Distance Field) intern. Wenn `setPaintProperty` mehrfach mit
unterschiedlichen Werten gerufen wird, ignoriert der Renderer ab dem
zweiten Aufruf manchmal die Änderung — die Linie sieht dann unverändert
aus, obwohl der Wert intern gesetzt ist.

**Fix:** Null-Cycle bei jedem Update — erst `line-dasharray` auf `null`,
dann auf den neuen Wert. Das erzwingt einen SDF-Re-Build. Synchron in
Animator + Tour-Map. Plus Debug-Log via JS→Python-Bridge zur Diagnose
falls's wiederkommt.

## [0.8.12] – 2026-05-23 11:45

### Geändert (Röhre wandert in den Linien-Stil-Dropdown)

Marc:
> „Der ‚Wurm' sieht cool aus, aber ist 2D ... packs in die 2D styles."

Stimmt — die Röhre ist immer noch ein 2D-Effekt (weißer Highlight-
Streifen oben auf der Linie, kein echtes 3D). Daher:

- Eigenes „Track-Optik"-Dropdown weg
- „Röhre" ist jetzt **fünfter Eintrag im Linien-Stil-Dropdown**
  (neben Durchgezogen, Gestrichelt, Gepunktet, Strich-Punkt)
- Wenn Linien-Stil = Röhre: Linie ist durchgezogen + Highlight-Streifen
  oben drauf. Abstand-Slider ist dann (wie bei „Durchgezogen") aus.
- Backend bleibt schlicht: `line_style="tube"` wird am Bridge-Boundary
  in `line_style="solid" + track_style="tube"` übersetzt, die Render-
  HTML-Logik in `core/animator.py` / `core/tourmap.py` ist unverändert.

**Migration:** Projekte mit altem `track_style="tube"` werden beim
Laden automatisch auf `line_style="tube"` umgeschrieben (idempotent).

## [0.8.11] – 2026-05-23 11:30

### Geändert (⚠️ Anker-Semantik: Keyframes können jetzt in die Hold-Phase reichen)

Marc:
> „die ‚hold' zeit muss natürlich mit in die timeline, sonst klappt
> Beta-Testers aufziehen nicht"

Bisher mappte ein Keyframe-Anker `0..1` auf die **Track-Position**:
1.0 = letzter Track-Punkt. In der Hold-Phase (am Ende des Renders) blieb
die Kamera dann eingefroren auf dem letzten Keyframe — ein Aufziehen auf
die ganze Route konnte man damit nicht machen.

**Neu:** Der Anker `0..1` mappt auf die **gesamte Timeline** (Animation
+ Hold). 1.0 = Ende des Holds. Das heißt:

- Anker `0..duration/(duration+hold)` = Track läuft (klassische Anim-Phase)
- Anker `duration/(duration+hold)..1.0` = Hold-Phase, Track-Endpunkt steht
  still, Kamera interpoliert aber weiter zwischen den Keyframes.

So lässt sich z.B. Beta-Testers Idee umsetzen: Keyframe bei 0% zum Start-Punkt
zoomen, Keyframe bei `track-end` mit normalem Zoom, Keyframe bei 100%
mit `center = Routen-Mitte` + negativem Zoom-Offset → die Kamera fährt
am Ende der Hold-Phase auf die volle Route raus.

**Timeline-Bar UI:**
- Senkrechter orangener Trenner markiert den Übergang Anim → Hold
- Hold-Bereich wird leicht schraffiert hinterlegt
- Position-Label zeigt „⏸ Hold" wenn der Scrubber rechts vom Trenner ist

**Migration:** Bestehende Projekte mit alten Track-Ankern werden beim
ersten Laden automatisch umskaliert (Faktor `dur/(dur+hold)`). Flag
`timeline_anchor_v: 2` im Animator-Settings-Block markiert sie als
migriert — idempotent. Projekte ohne Hold (`hold_s=0`) brauchen keine
Umrechnung, da Track- und Timeline-Anker identisch sind.

## [0.8.10] – 2026-05-23 11:00

### Hinzugefügt (Track-Optik „3D-Wurm" — Beta-Tester-Wunsch)

Beta-Tester (E-Mail):
> „Mit Rund bei der GPX Spur meine ich wie ein Wurm oder Schlange,
> sieht mehr nach 3D aus."

Neuer Selector **Track-Optik** in der Track-Sektion (Animator **und**
Tour-Map):

- **Flach (2D)** — wie bisher, klassische Linie.
- **3D-Wurm** — zusätzlicher weißer Highlight-Streifen oben auf der
  Track-Linie (0.35× Linien-Dicke, 55 % Deckkraft, leicht weich-
  gezeichnet). Simuliert eine zylindrische Oberfläche → wirkt
  plastischer, fast wie ein Schlauch über der Karte.

Folgt automatisch der eingestellten Linien-Dicke und dem Linien-Stil
(gestrichelt / gepunktet → Highlight folgt dem Muster). Live-Preview
+ Render sind synchron.

### Behoben (Neues Projekt erbte Settings vom vorherigen Projekt)

Marc:
> „ich hab ein neues projekt erstellt, das war dann nicht leer
> sondern hatte den inhalt vom 2. projekt"

**Ursache:** `_session_get_global_defaults()` lieferte die **aktuelle**
`settings.json` als Default-Basis für neue Projekte zurück — und die
spiegelt die zuletzt benutzten Werte des vorherigen Projekts wider.
Wenn Marc also Pitch=37°, line_color=#ff6a00 etc. in Projekt 2
eingestellt hatte, übernahm Projekt 3 diese Werte direkt.

**Jetzt:** `_session_get_global_defaults()` liefert eine Tiefenkopie
der pristinen `DEFAULT_SETTINGS`-Konstante zurück. Neue Projekte
starten immer mit denselben sauberen Default-Werten (Pitch=40°,
line_color=#ff6b35, etc.) — wie ein frisch ausgepackter
Reisezoom GPS Studio.

## [0.8.9] – 2026-05-23 10:25

### Geändert (Track-Trim bleibt nach Scrubber/Marker-Aktion sichtbar)

Marc:
> „wenn ich den marker in der timeline direkt per klick an eine neue
> position setze, dann soll in der preview der track genau bis zu der
> position sichtbar sein"

**Verhalten vorher:** Track wurde **während** des Scrubber-Drags auf
die aktuelle Position getrimmt, aber beim Loslassen sofort wieder
voll dargestellt (via `onScrubEnd`-Reset). Plus: Marker-Drag (Anchor
verschieben in der Timeline-Bar) trimmte den Track **gar nicht**.

**Jetzt:**
- **Scrubber-Klick / -Drag**: Track bleibt bis zur Scrubber-Position
  getrimmt, auch nach dem Loslassen. (onScrubEnd-Reset ist deaktiviert.)
- **Marker-Drag**: Der Scrubber wandert mit dem Marker mit + Track
  wird mit-getrimmt. `updateKeyframeAnchor` ruft zusätzlich
  `_tlBar.setScrubber()` + `scrubPreview()`.
- **„Komplette Linie wieder zeigen"** geht via:
  - Klick auf den Refit-Button ⤢ (unten rechts in der Karte) — der
    fittet jetzt zusätzlich die ganze Track-Linie zurück
  - Scrubber zum 100%-Ende ziehen (Klick rechts auf der Bar oder
    Pfeil/End-Taste)
  - Probe-Lauf (L) — am Ende wird der Track wieder voll gezeigt

So sieht Marc immer, wie weit der Track-Verlauf bis zur aktuell
betrachteten Stelle ist — und kann bewusst auf Volle-Linie zurück.

## [0.8.8] – 2026-05-23 10:10

### Hinzugefügt (Track-folgen-Toggle pro Keyframe — Marc-Frage zur Klarheit)

Marc:
> „sieht gut aus, die logik verstehe ich aber nicht, wann folgt er dem
> pfade und wann nicht?"

**Klarstellung:** Bisher implizit über das Vorhandensein des `center`-
Felds — User-unfreundlich. Jetzt expliziter Toggle im Detail-Editor.

**Neue Checkbox** „🚶 Kamera folgt dem Track" im Detail-Editor:
- **An** (`center: null`): Kamera bleibt am GPS-Punkt am Anchor-Punkt.
  Pitch/Bearing/Zoom des Keyframes greifen weiterhin individuell, aber
  Pan auf der Karte wird ignoriert. Klassisches Track-Folgen-Verhalten.
- **Aus** (`center: [lon, lat]`): Karten-Ausschnitt frei wählbar.
  Marc pant die Karte → der Pan bleibt persistent im Keyframe. Bei
  Probe-Lauf/Render schwebt die Kamera linear zwischen den definierten
  Karten-Punkten — folgt **nicht** dem Track.

**Default beim Snapshot**: Aus (= Frei). Wenn Marc explizit auf der
Karte was eingestellt hat (Pitch via Cmd+Drag etc.), will er meistens
genau diesen Ausschnitt — also Frei. Wer den Track verfolgen lassen
will, toggelt den Keyframe einzeln auf „Folgt Track".

**Hint-Text** unter der Checkbox erklärt das jeweilige Verhalten je
nach Toggle-Zustand.

**Logik in 3 Sätzen:**
- KEINE Keyframes → klassisch: Track-Folgen mit Sidebar-Pitch/Rotation
- Keyframe mit `center` (Frei) → Kamera fliegt zu diesem Karten-Punkt
- Keyframe ohne `center` (Track-folgen) → Kamera am Track-Punkt am Anchor

Bei Interpolation zwischen zwei Keyframes mischt der Code die Modi
sauber: wenn ein KF auf Frei steht und der nächste auf Track-folgen,
wird zwischen den Beiden geblendet (linear lerp wo center beide
gesetzt sind, einseitig sonst).

## [0.8.7] – 2026-05-23 09:55

### Hinzugefügt (Freie Karten-Position pro Keyframe — Marc-Wunsch)

Marc:
> „ach, egal wie ich positioniere ... die kamera ist immer auf den
> vorderste punkt des tracks gerichtet? also wandert immer mit dem
> track mit"

**Root Cause:** Im Render-Loop und in `scrubPreview`/`runTimelinePreview`
war `center = currentCoords[coordIdx]` hardcoded — die Kamera folgte
immer dem Track-Punkt am Anchor. Pan-Operationen auf der Karte wurden
beim nächsten Frame sofort überschrieben.

**Fix:** Camera-Keyframes haben jetzt ein optionales `center`-Feld
(`[lon, lat]`). Wenn gesetzt: die Kamera schaut **frei** von dieser
Position auf den Track — kein Track-Folgen mehr. Wenn nicht: Fallback
aufs klassische Track-Folgen (Backward-Compat für alte Keyframes ohne
center).

**Was passiert wo:**
- **`snapshotKeyframe`** speichert jetzt zusätzlich `map.getCenter()`
  im Keyframe.
- **`_syncMapStateToUi`** (Maus-Drag auf der Karte) speichert center
  im aktiven Keyframe — Pan wirkt live.
- **`core/timeline.py interpolate_camera`** returnt jetzt 4-Tuple inkl.
  `center` (linear gelerpt zwischen zwei Keyframes mit center; einseitig
  übernommen wenn nur einer; None wenn keiner → Track-Folgen).
- **`core/animator.py` Render-Loop**: `frame_lon/lat = kf_center if kf_center else track_center`.
- **Frontend `scrubPreview` + `runTimelinePreview`**: `center =
  interp.center || currentCoords[coordIdx]`.

**Marc-Workflow ab jetzt:**
1. Scrubber zur Wunsch-Stelle navigieren (mit ←/→ oder Klick auf Bar)
2. „📍 Hier Keyframe" → snapshottet aktuelle Karten-Ansicht inkl. Pan
3. Karte mit Maus pannen/kippen/zoomen → Keyframe-Werte werden live
   geupdated (Karte bleibt wo Marc sie hingezogen hat)
4. Probe-Lauf / Render → Kamera bleibt am gewählten Ausschnitt, folgt
   NICHT mehr automatisch dem Track-Punkt

Alte Keyframes (vor v0.8.7, ohne `center`-Feld) funktionieren weiterhin
mit dem klassischen Track-Folgen.

## [0.8.6] – 2026-05-23 09:30

### Hinzugefügt (Karten-Edits → Slider + Keyframe-Sync + JKL-Style Speed-Control)

Marc-Wunsch 2026-05-23:
> „Wenn ich auf der Karte in der Preview etwas ändere, muss sich das auf
> die Regler in der Sidebar auswirken. Ich will direkt in der Karte den
> ausschnitt einstellen können, der am jeweiligen keyframe angezeigt
> wird. nicht alles mit dem keyframe machen müssen."
>
> „mach play nicht nur space sondern auch L läuft die preview und drückt
> man nochmal L, läuft sie doppelt so schnell"

**Karten-Edits → UI-Sync (1):**
- Neuer `map.on("moveend", ...)`-Listener im Animator. Reagiert NUR auf
  `e.originalEvent` (= echte User-Geste, nicht unsere eigenen `easeTo`/
  `jumpTo`-Aufrufe).
- Bei User-Pan/Zoom/Cmd-Drag: aktuelle Karten-Werte (Pitch, Bearing,
  Zoom-Offset) werden gelesen + an die Sidebar-Slider verteilt:
  - Haupt-Pitch-Slider (`anim-pitch`) → updated + im Projekt gespeichert
  - Wenn aktiver Keyframe ausgewählt (`_selectedKfIdx != null`):
    Keyframe-Werte werden updated UND die Detail-Editor-Slider
    (Anchor/Pitch/Bearing/Zoom) bekommen die neuen Werte angezeigt
- Damit kann Marc den Cinematic an einem Keyframe **direkt auf der
  Karte einstellen** (Maus-Drag = Pan, Cmd-Drag = Pitch+Bearing,
  Scroll = Zoom), statt drei Slider in der Sidebar hin- und herziehen.
- Neue Helper-Funktion `_syncMapStateToUi()` (DRY zwischen moveend +
  evtl. zukünftigen Triggern).

**JKL-Style Speed-Control für Probe-Lauf (2):**
- **`L`-Taste**: startet den Probe-Lauf (wie bisher Space). Wenn der
  Lauf schon läuft → **verdoppelt den Speed** (1× → 2× → 4× → 8×, max).
- **`K`-Taste**: stoppt den laufenden Probe-Lauf (analog zu Premiere/
  Final Cut). Space stoppt weiterhin auch.
- Bei Stop wird der Speed wieder auf 1× zurückgesetzt.
- **t0-Adjustment bei Speed-Wechsel**: damit der Sprung in der
  Animation nicht passiert, wird `_previewT0 = now - virtualElapsed /
  newSpeed` neu berechnet. So bleibt die aktuelle Track-Position
  visuell stabil beim Beschleunigen.
- Button-Text zeigt aktuellen Speed: „⏸ Stopp (2×)" / „… (4×)" / „… (8×)".

**i18n** DE/EN/ES für die neuen Hint-Texte (`animator.timeline.keynav.play_l`,
`animator.timeline.keynav.stop`).

## [0.8.5] – 2026-05-23 09:10

### Behoben (Track-Verlust nach Modul-Wechsel — Mapbox isStyleLoaded-Fallback)

Marc nach v0.8.4-Test:
> „geht nicht. checke alle modulwechsel. teste das selbst"

**Diagnose via JS→Python-Log-Bridge** (`api.log_js` + `applog()` in
`util.js`): Im neu eingebauten `[applyGlobalGpx] mapReady=false` zeigte
sich klar das Problem.

**Root Cause:**
Mapbox-`map.isStyleLoaded()` ist intern unzuverlässig direkt nach dem
`load`-Event — gibt `false` zurück solange Source-Tiles noch fetched
werden. Code-Pfad:

```js
onMapReady(map, () => {           // ← ist im load-Callback
  rebuildPreviewLayers();
  applyGlobalGpx(...);
});

function applyGlobalGpx(path, res) {
  // ...
  if (map.isStyleLoaded()) drawPreview(res);        // ← false
  else map.once("load", () => drawPreview(res));    // ← load schon vorbei
}                                                    // → drawPreview nie
```

`map.once("load", drawPreview)` feuert nie, weil das `load`-Event
bereits vor diesem Code gefeuert wurde — `once` registriert nur für
ZUKÜNFTIGE Events. Resultat: `drawPreview` läuft nicht → kein
`setData()` → keine Track-Linie sichtbar.

**Fix:**
- **`applyGlobalGpx`** in Animator ruft `drawPreview` direkt ohne
  `isStyleLoaded()`-Check. Wir sind im `onMapReady`-Callback — `load`
  ist garantiert vorbei, `addSource`/`setData` funktionieren.
- **`drawPreview`** legt die Source via `rebuildPreviewLayers()` an
  falls sie nicht existiert (statt stillschweigend zu skippen).
- **Tour-Map** `loadGpxByPath`: gleiche Vereinfachung —
  `rebuildPreviewLayers()` direkt nach `fitTrackToView`.
- **Geotagger** `showTrack`: defensive Source-Re-Creation wenn nötig +
  Aufruf via `onMapReady` statt eigener `isStyleLoaded`-Loop.

**Bonus-Infrastruktur:**
- **`api.log_js(level, msg)`-Bridge** in `app.py`: JS schickt Logs an
  Python, landen in `app.log`. So sieht Marc/ich Debug-Output auch
  ohne DevTools-Konsole.
- **`window.applog(level, msg)`** in `ui/js/util.js` als Frontend-API
  + globale `window.onerror`- und `unhandledrejection`-Capture.
- Tracing-Logs an kritischen Stellen (`onMapReady`, `applyGlobalGpx`,
  `drawPreview`, Modul-Mounts) bleiben aktiv — kostet wenig
  Performance, hilft enorm beim Diagnose von Folge-Bugs.

## [0.8.4] – 2026-05-23 08:50

### Behoben (Track-Verlust bei Modul-Wechsel — Mapbox load-Event Race-Condition)

Marc nach v0.8.3-Test:
> „funktioniert nicht. checke alle modulwechsel."

**Root Cause (Mapbox-Race-Condition):**
`map.on("load", ...)` und `map.once("load", ...)` registrieren Listener
für DAS LOAD-EVENT, das pro Map-Instanz GENAU EINMAL feuert. Wenn der
Code-Pfad ist:

```js
const made = createMap({ ... });  // ← Mapbox kann hier 'load' bereits feuern
map.on("load", () => rebuildPreviewLayers());  // ← zu spät registriert
```

Bei Cache-Hit/schnellem Style-Load liegt der `load`-Event-Fire in der
JS-Event-Queue BEVOR unser Listener-Setup ankommt → Listener wird nie
gerufen → `rebuildPreviewLayers` läuft nicht → `preview-track`-Source
existiert nicht → `drawPreview` `setData` skipped → Track unsichtbar.

Beim Modul-Wechsel ist die Map-Instanz frisch (alte ist via
`activeCleanup` per `map.remove()` entfernt), und der Browser cached
Style-Daten → Race triggert leichter.

**Fix:**
Neuer Helper `onMapReady(map, cb)` in `ui/js/util.js`:

```js
function onMapReady(map, cb) {
  if (!map) return;
  if (map.isStyleLoaded()) { cb(); return; }   // ← Pre-Check
  map.once("load", cb);
}
```

Alle drei Module (Animator, Tour-Map, Geotagger) nutzen jetzt
`onMapReady(map, () => { rebuildPreviewLayers(); /* + GPX-Apply */ })`
statt `map.on("load", ...)`. Damit ist die Reihenfolge:

1. `createMap()` — Map-Instanz wird erstellt
2. `onMapReady(map, ...)` — Pre-Check oder once-Listener
3. Wenn Style schon da: Setup läuft SOFORT (sync)
4. Sonst: läuft beim ersten load-Event

In allen Fällen ist garantiert dass `rebuildPreviewLayers` läuft +
danach das globale GPX applied wird.

**Bonus:**
- Animator + Tour-Map: `rebuildPreviewLayers` und `applyGlobalGpx` /
  `loadGpxByPath` laufen jetzt in EINEM `onMapReady`-Callback —
  garantiert in der richtigen Reihenfolge.
- Geotagger: Track-Layer-Setup + GPX-Auto-Load in einem Callback.

## [0.8.3] – 2026-05-23 08:35

### Behoben (Track verschwindet beim Modul-Wechsel — Marc-Bug)

Marc nach v0.8.2-Test:
> „aber wenn ich jetzt zwischen den modulen wechsel geht der track
> irgendwie vorloren. komme ich zum animator zurück, sehe ich ihn
> nicht mehr"

**Root Cause:**
Beim Modul-Wechsel wird `mod.mount(body, headerActions)` neu gerufen
und das ganze Modul-DOM wird neu aufgebaut. Die Map wird via
`whenApiReady().then(async () => { createMap(...) })` ASYNC initialisiert.

Mein v0.8.1-Code, der das globale GPX beim Mount ans Modul anwendet,
lief aber SYNC noch BEVOR der whenApiReady-Block aufgerufen wurde:

```js
// sync, läuft vor whenApiReady
if (typeof getGlobalGpxData === "function") {
  ...
  if (cur.path && cur.data) applyGlobalGpx(cur.path, cur.data);
}
```

Zu diesem Zeitpunkt war `map` immer noch `null` → `applyGlobalGpx` ruft
`drawPreview()` → checkt `if (map && map.isStyleLoaded())` → false →
macht NICHTS. Track wurde nie auf der Karte gezeichnet.

**Fix:**
Der Initial-Apply-Block wandert IN den `whenApiReady().then()`-Block,
direkt NACH `createMap()` + Setup. Da existiert die Map und ist meist
schon mit „style.load" durch. Falls noch nicht style-loaded → wird's
defensiv via `map.once("load", ...)` nachgeholt.

Sowohl im **Animator** als auch im **Tour-Map** so umgebaut. Geotagger
hatte schon eine eigene wait-Logik (`setInterval` bis `map` da ist) und
funktioniert weiter.

## [0.8.2] – 2026-05-23 08:20

### Geändert (GPX-Picker in den Modul-Header statt eigene Bar — Marc-Korrektur)

Marc nach v0.8.1-Test:
> „jetzt hast du eine weitere topbar eingebaut. das wollte ich so nicht.
> packe den gpx chooser da hin, wo jetzt die überschrift des moduls steht.
> mach die überschrift raus. man sieht doch, wo man ist weil das ganz
> oben markiert ist."

**Änderung:**
- **Sub-Top-Bar entfernt** — kein extra Bar zwischen Topbar und Modul.
- **Modul-Überschrift entfernt** (`module-title` + `module-subtitle`) —
  der aktive Tab in der Haupt-Topbar zeigt schon, wo man ist.
- **GPX-Picker landet links im Modul-Header** an der Stelle, wo bisher
  die Überschrift war. Rechts bleiben modul-spezifische Header-Aktionen
  (jetzt aber leer, weil die Stats-Pills jetzt der GPX-Picker zeigt).
- **Stats-Pills aus Animator + Tour-Map headerActions raus** — wären
  doppelt zu denen in der GPX-Bar. Hidden Stub-Elemente bleiben damit
  bestehender Code (`document.getElementById("s-dist")` etc.) nicht
  crasht — DOM-Updates kommen ins Leere.

**Technisch:**
- `gpx-bar.js`: `renderGpxBarInto(container)`-API. Wird von `app.js`
  nach jedem Modul-Mount in den `#mod-header-gpx`-Slot eingesetzt.
  Event-Listener + Drag&Drop werden pro Render frisch gebunden.
- `app.js` `renderMod()`: Modul-Header-Template umgebaut, GPX-Slot links,
  Action-Slot rechts, kein Titel mehr.
- `app.css`: alte `.subtop-*`-Klassen → neue `.gpxbar-*`-Klassen, neue
  Layout-Regeln für integrierten Look im Modul-Header.

## [0.8.1] – 2026-05-23 08:00

### Geändert (globale Sub-Top-Bar für GPX-Quelle — Marc-Idee)

Marc:
> „mach den gps track „global", dass er für alle module gilt. Platziere
> das vielleicht auch anders. dass das für alle module an der gleichen
> stelle ist. am besten aus der sidebar raus in die sub top-bar. den
> namen des moduls muss man ja nicht 2x anzeigen, sieht man ja ganz oben
> schon was ausgewählt ist."

**Neu: Sub-Top-Bar** zwischen Haupt-Topbar und Modul-Inhalt. Eine
zentrale Stelle für die GPX-Auswahl, gilt für alle Module gleichzeitig.

**Verhalten:**
- **Ohne GPX**: kompakter „📂 GPX wählen …"-Button + Hint „… oder GPX
  hierher ziehen."
- **Mit GPX**: kleiner Picker-Button (für „anderes laden") + Dateiname +
  4 Stats (Distanz / Zeit / Aufstieg / Abstieg) + „✕"-Button zum
  Schließen
- **Drag & Drop**: GPX-Datei auf die Sub-Top-Bar ziehen lädt sie direkt
- Lädt ein einziges Mal via `animator_load_gpx`, verteilt an alle Module
  via `onGpxLoaded`-Listener-Pattern

**Module-Refactor:**
- „Quelle"-Akkordeon in Animator + Tour-Map raus (war ein Klick → Pick-
  Dialog, redundant zur neuen Bar)
- „GPX wählen"-Sektion im Geotagger raus
- Alle drei Module registrieren `onGpxLoaded`-Listener und übernehmen
  den Track automatisch beim Mount oder bei Wechsel
- Drag&Drop-Targets in den Canvas-Bereichen leiten jetzt an
  `loadGlobalGpx()` weiter

**Module-übergreifend funktioniert jetzt sauber:**
- GPX in Sub-Top-Bar laden → Animator zeigt's, Tour-Map zeigt's,
  Geotagger zeigt's
- Bei Modul-Wechsel: Track + Session + Projekt-Settings sind sofort da,
  kein Re-Load nötig

**Technisch:**
- Neue UI-Komponente `ui/js/gpx-bar.js` mit `loadGlobalGpx(path)`,
  `clearGlobalGpx()`, `onGpxLoaded(cb)`, `getGlobalGpxPath()`,
  `getGlobalGpxData()`. Plus Drag-Drop-Handler direkt auf der Bar.
- `_resetActiveSession()` in `util.js` für sauberes Schließen
- Sub-Top-Bar-HTML in `index.html` + Styling in `app.css`
- i18n: noch keine neuen Keys nötig (Stats verwenden bestehende
  Formatter, „GPX wählen" ist Inline-Text)

## [0.8.0] – 2026-05-23 07:40

### Hinzugefügt (Sessions + Projekte — Marc-Architektur)

Marc-Idee 2026-05-22:
> „Lass uns das ganze Dinger aber andersaufziehen. Wenn wir jetzt so viel
> einstellen können brauchen wir nämlich sessions und darunter dann
> projekte. Eine Session hängt an dem geladenen GPS File … D.h. lade ich
> im Animator, ist das auch schon in der Tour Map und im Tagger mir drin."

**Architektur (3 Ebenen):**

1. **Globale App-Settings** (`settings.json`) — bleiben wie sie sind:
   Mapbox-Token, Sprache, Onboarding-Status + Modul-Default-Werte (werden
   als Initial-Werte für ganz neue Projekte gezogen).

2. **Session** — neu, **intern**, an Track-Hash gebunden:
   - SHA1 über die GPS-Koordinaten (auf ~1 m gerundet) → zwei Exports
     des gleichen Tracks mit unterschiedlichen Dateinamen kriegen den
     gleichen Hash, Session wird wiedererkannt.
   - GPX-Snapshot wird automatisch nach `sessions/<hash>.gpx` kopiert —
     falls Marc das Original löscht, hat die App den Track noch.
   - Beim ersten Load einer Session: Default-Projekt „Standard" wird
     automatisch mit den aktuellen `settings.json`-Werten angelegt.

3. **Projekt** — Variation innerhalb einer Session, **sichtbar im
   Topbar-Dropdown**:
   - Alle Modul-Settings (Animator/Tour-Map/Geotagger) inkl. der
     Animator-Keyframes (`timeline_events`) hängen am aktiven Projekt.
   - Mindestens 1 Projekt pro Session (Löschen des letzten erzeugt
     automatisch ein neues „Standard").
   - Geotagger-Foto-Refs werden NICHT persistiert (Marc-Regel) — nur
     Settings wie Offset und Backup-Toggle.

**Modul-übergreifender GPX-Load:**
- Lade ein GPX im Animator → Session aktiv → wechselst du in Tour-Map,
  ist der Track + die Projekt-Settings dort sofort verfügbar (kein
  zweiter Load nötig).
- Genauso Geotagger: Track-Referenz da, Fotos bleiben außerhalb.

**Topbar-Dropdown** (sichtbar wenn Session aktiv):
- Format: `🗂 <Session-Name> · <Projekt-Name> ▾`
- Aktive Projekt mit ● markiert
- Aktionen: Neues Projekt · Aktuelles duplizieren · Umbenennen · Aktuelles löschen
- Mini-Modals für Name-Eingabe + Lösch-Bestätigung

**Storage:**
- Neue Datei `~/Library/Application Support/.../sessions.json`
- GPX-Snapshots in `~/Library/Application Support/.../sessions/<hash>.gpx`
- `settings.json` bleibt für globale App-Settings + Modul-Defaults

**Technisch:**
- Neues Backend-Modul `core/sessions.py` mit `compute_track_hash()`,
  `get_or_create_session()`, `create_project()`, `delete_project()`,
  `update_project_settings()` und Failsafe-Logik für „mindestens 1
  Projekt pro Session".
- Bridge in `app.py`: `session_open_for_track()`, `session_set_active_project()`,
  `session_create_project()`, `session_rename_project()`,
  `session_delete_project()`, `session_update_project_settings()`.
- Frontend-Layer in `ui/js/util.js`: `sessionActivate()`,
  `projectCreate()`/`projectRename()`/`projectDelete()`,
  `saveProjectSettings()` (debounced wie saveSettings),
  `rebindAllSettings()` für UI-Werte-Refresh bei Projekt-Wechsel.
- `bindSetting()` liest jetzt zuerst aus dem aktiven Projekt (wenn da),
  fällt zurück auf globale Defaults. Schreibt analog ans Projekt wenn
  Session aktiv, sonst an `settings.json`.
- Neues UI-Modul `ui/js/projects.js` mit Topbar-Dropdown + Mini-Modals.
- Animator: `setTimelineEvents` + `getTimelineEvents` arbeiten jetzt am
  Projekt-Layer. Beim GPX-Load wird die Session aktiviert + UI re-bound.
- Tour-Map + Geotagger: rufen `sessionActivate()` beim eigenen GPX-Load.

### Hinzugefügt (Mapbox-Verbrauchs-Link in Settings — Marc-Frage)

Marc:
> „kann man irgendwo auslesen, wie viel man von mapbox schon verbraucht hat?"

Im Settings-Modal (⚙) unter dem Token-Feld: neuer Link **„📊 Mapbox-
Verbrauch ansehen →"**. Öffnet `https://account.mapbox.com/statistics/`
im externen Browser (via neuer Bridge `open_external_url`). Hint dazu:
„Öffnet dein Mapbox-Dashboard im Browser. Free-Tier reicht für 50.000
Karten-Loads pro Monat."

## [0.7.9] – 2026-05-22 21:55

### Behoben (Render zoomt zu weit rein — Marc-Bug)

Marc nach v0.7.8-Test:
> „nee, sieht immer noch seltsam aus, als wäre er beim render viel zu sehr
> reingezoomt"

**Root Cause (Race-Condition mit `_fitZoomBase`):**
`_fitZoomBase` (= der Frontend-Auto-Fit-Zoom, relativ zu dem alle Keyframe-
`zoom_offset`s gespeichert werden) wurde nach `map.fitBounds()` via
`requestAnimationFrame` aktualisiert. rAF feuert aber SOFORT im
**ersten Frame der 500-ms-Animation** — `map.getZoom()` ist da noch der
Pre-Fit-Zoom (z.B. 4.5 von Initial-Setup), nicht der End-Fit-Zoom (z.B. 11.0).

Folge:
- Marc setzt Keyframe an der gefitteten View (kein Pan/Zoom): `curZoom = 11.0`
- `zoom_offset = curZoom - _fitZoomBase = 11.0 - 4.5 = 6.5` (statt 0!)
- Backend bounds-fit gibt zoom ≈ 12.5 (bei 1920px)
- `frame_zoom = 12.5 + 6.5 = 19.0` → extrem reingezoomt, Track-Punkt nimmt
  fast den ganzen Frame ein

**Fix:**
- `fitTrackPreview()`: `map.once("moveend", () => { _fitZoomBase = map.getZoom() })`
  statt `requestAnimationFrame`. `moveend` feuert garantiert nach Ende der
  fitBounds-Animation.
- `snapshotKeyframe()`: defensiv — wenn `_fitZoomBase` immer noch `null` ist
  (z.B. wenn snapshot vor erstem moveend gerufen wird), wird sofort
  `_fitZoomBase = map.getZoom()` gesetzt + Warning in Konsole.
- `console.warn` bei `Math.abs(zoom_offset) > 5` — verdächtige Werte sofort
  sichtbar in DevTools, statt stillem Über-Zoom.
- `core/animator.py`: Sanity-Clamp im Render-Loop, `zoom_off` wird auf
  `[-5.0, +6.0]` gekürzt. Falls trotz aller Fixes mal ein verrückter Wert
  durchrutscht (Backwards-Compat-Settings, neue Bugs), zerschießt das nicht
  den ganzen Render.

**Debug-Hilfe:** Marc sieht in der DevTools-Konsole jetzt:
- `[fit] _fitZoomBase = 11.234` nach jedem Bounds-Fit
- `[snapshot] zoom_offset 6.5 looks suspicious` falls's nochmal klemmt

## [0.7.8] – 2026-05-22 21:30

### Behoben (Render-WYSIWYG-Bruch mit Keyframes — Marc-Bug)

Marc nach v0.7.7-Test:
> „irgendwie hab ich jetzt was gebaut, dann das rendern gestartet, aber
> die preview während des renderns hat was ganz anderes gezeigt als die
> preview davor"

**Root Cause:**
Beim Render-Start hat das Frontend `override_center = map.getCenter()` und
`override_zoom = correctedZoom(map, ...)` UND `snapshotPitch = map.getPitch()`
aus dem aktuellen Karten-State gesnapped. Wenn Marc vorher den Scrubber
auf eine Keyframe-Position gestellt hat, war die Karte aber im **interpolierten**
Zustand dieses Anchors — also Pitch/Bearing/Zoom waren bereits durch die
Keyframes manipuliert.

Backend bekommt diese Werte als `override_center/zoom/pitch` und baut die
initiale Mapbox-View damit. Dann läuft der Render-Loop und `interpolate_camera()`
addiert NOCHMAL seinen Keyframe-Offset oben drauf:
- `frame_zoom = override_zoom + interp.zoom_offset` → doppelt rein
- `pitch_f = interp.pitch` (Keyframe-Wert) — passt nicht zu override_pitch

Plus: `override_center` war ein Track-Punkt (Scrubber-Position) und nicht
die Bbox-Mitte → der initiale Map-Viewport war an einer ganz anderen Stelle
als bei einem bounds-fit. Plus die zoom-Differenz zwischen Vorschau-Pixel-
Breite und Render-Pixel-Breite (siehe v0.6.1 correctedZoom) hat das nochmal
verschärft.

Resultat: Render-Output sah komplett anders aus als die Frontend-Live-Vorschau.

**Fix:**
Bei aktiven Camera-Keyframes übernimmt das Frontend `override_center`,
`override_zoom` und `snapshotPitch` NICHT aus dem aktuellen Karten-State —
diese drei bleiben `null` bzw. der Default-Slider-Wert. Das Backend macht
dann einen normalen Bounds-Fit (Bbox-Mitte als Center, fit-Zoom),
`interpolate_camera()` arbeitet relativ dazu wie es soll.

```js
const hasKfs = (_settingsCache?.animator?.timeline_events || [])
  .some(e => e && e.kind === "camera");
let overrideCenter = null, overrideZoom = null;
let snapshotPitch = parseFloat(document.getElementById("anim-pitch").value);
if (map && !hasKfs) {
  // Klassischer Pan-Workflow ohne Keyframes (unverändert)
  overrideCenter = [c.lng, c.lat];
  overrideZoom = window.correctedZoom?.(map, w, h) ?? map.getZoom();
  snapshotPitch = map.getPitch();
}
```

**Konsequenz für Marc-Workflow:**
- KEINE Keyframes → wie bisher, manuelles Panen wird im Render übernommen
- MIT Keyframes → Camera-Pfad wird komplett durch die Keyframes definiert,
  Marc's Scrubber-Position ist nur eine Vorschau, kein Render-Start-State.
  Für „Initial-View"-Steuerung mit Keyframes: einfach einen Keyframe bei
  Anchor 0 (Track-Start) setzen.

## [0.7.7] – 2026-05-22 21:00

### Behoben (Keyframes blieben über App-Neustarts erhalten — Marc-Bug)

Marc nach v0.7.6-Test:
> „hä? wenn ich jetzt starte sind schon keyframes drin??? sehr seltsam. das
> ist ein bug, aber merke dir für später, man muss projekte speichern können"

**Root Cause:**
`timeline_events` waren in `settings.json` persistiert wie alle anderen
Animator-Settings. Bei jedem App-Start wurden sie ins `_settingsCache`
geladen — und damit auch in die Timeline-Bar gerendert. Marc öffnet App
ohne GPX → sieht trotzdem 2 alte Keyframes drin.

Die Keyframes sind aber an konkrete **Track-Anker** gebunden (0.0–1.0 des
GPX-Tracks). Beim Wechsel des GPX oder beim Neustart ohne geladenes
GPX ergeben sie keinen Sinn → klar Bug.

**Fix:**
- **`_load_settings()`** in `app.py`: nach dem Load wird
  `result["animator"]["timeline_events"] = []` gesetzt. Damit liest jeder
  App-Start einen sauberen, leeren Stand.
- **`settings_set()`** filtert `animator.timeline_events` beim Speichern
  raus — sonst würden saveSettings-Calls die Events wieder in die Datei
  schreiben und beim NÄCHSTEN _load_settings würden wir sie zwar leeren,
  aber die Disk-Datei bliebe schmutzig.
- **`drawPreview()`** im Animator-UI leert `timeline_events` zusätzlich
  beim GPX-Wechsel (in laufender Session). So gehen Keyframes weg sobald
  ein anderes GPX geladen wird, statt mit beibehalten zu werden.
- Photo/Text-Events (zukünftige `kind != "camera"`) bleiben unberührt —
  die werden dann später nach gleichem Schema oder via Projekt-Speicher-
  System behandelt.
- Bereits persistierte Keyframes aus Marc's settings.json wurden via
  Migrations-Skript einmalig rausgeputzt (2 Stück), damit der erste
  v0.7.7-Start sofort sauber ist.

**TODO für später (Marc-Idee 2026-05-22):**
„Projekte speichern können" — eigenes Feature in v0.8+. Workflow: User
lädt GPX, setzt Keyframes, gibt einen Projekt-Namen → wird als
`.rzproj`-Datei (oder als Eintrag in einer DB) abgelegt mit:
- GPX-Datei-Pfad (oder eingebettete GPX-Kopie für Stabilität)
- Animator-Settings-Snapshot (Pitch/Rotation/Linien-Stil/Farbe/etc.)
- Timeline-Events (Camera/Photo/Text/...)
Beim Laden: GPX wird wieder geöffnet, Settings + Keyframes restored.
Macht den Render reproduzierbar wenn Marc auf ein Video später zurück
will.

## [0.7.6] – 2026-05-22 20:50

### Behoben (TDZ-Bug → Karte lädt nicht in v0.7.5 — Marc-Bug)

Marc nach v0.7.5-Test:
> „check mal das logfile, er konnte die karte gar nicht laden"

**Root Cause (klassischer Temporal-Dead-Zone-Fehler):**

In v0.7.5 hatte ich `bindKeyframeEditor()` direkt nach `setupSectionAccordions()`
aufgerufen (bei line ~495 in mountAnimator). Aber die State-Variablen
`_kfEditorBound`, `_selectedKfIdx`, `_tlBar`, `_previewRaf`, `_fitZoomBase`
waren erst weiter unten via `let` deklariert (line ~964+).

`let`-Variablen sind in JavaScript anders als `var` — sie haben einen
**Temporal Dead Zone** vom Block-Anfang bis zur tatsächlichen
Deklarations-Zeile. Zugriff in dieser Zone wirft einen `ReferenceError`.

Konsequenz: `bindKeyframeEditor()` warf den ReferenceError → `mountAnimator()`
brach genau dort ab → der gesamte folgende Init-Code wurde nicht ausgeführt
→ kein `whenApiReady().then(...)` → keine Map-Initialisierung → User sieht
eine leere App ohne Karte. Im Python-Log war nichts auffällig weil JS-Errors
nicht zu Python-Stderr durchgereicht werden.

**Fix:**
- Alle KF-bezogenen `let`-Deklarationen wandern an den Anfang von
  `mountAnimator()`, DIREKT vor den ersten `bindKeyframeEditor()`-Aufruf.
  Damit sind sie initialisiert wenn der Bind-Call kommt.
- Die alten Deklarationen weiter unten werden ersatzlos entfernt
  (`let _selectedKfIdx`, `let _tlBar`, `let _kfEditorBound`, `let _previewRaf`,
  `let _fitZoomBase` waren mehrfach deklariert → das hätte beim nächsten
  Parser-Lauf eh einen SyntaxError gegeben).

**Lesson learned**: function-declarations sind voll gehoisted, `let`/`const`
sind nicht. Wenn man eine Init-Funktion früh ruft, müssen alle ihre
free-variables aus dem umgebenden Scope schon im scope-fluss VOR dem
Call sein.

## [0.7.5] – 2026-05-22 20:40

### Behoben (Detail-Editor-Slider tot — Marc-Bug)

Marc nach v0.7.4-Test:
> „die schieber unter kamera keyframes gehen wieder nicht"

**Verdacht (Race-Condition mit `_kfEditorBound`-Flag):**
Die Slider-Listener wurden bisher LAZY beim ersten `renderKeyframeEditor()`
gebunden — mit einem `_kfEditorBound`-Flag als Guard. Wenn die Flag aus
irgendwelchen Gründen schon `true` war ohne dass die `el.addEventListener`-
Calls erfolgreich durchgelaufen sind (z.B. ein Element noch nicht im DOM,
ein Exception ohne Crash), gingen die Listener verloren — Slider total tot.

**Fix:**
- `bindKeyframeEditor()` wird jetzt **direkt nach `body.innerHTML`-Mount**
  aufgerufen (im `mountAnimator`-Init-Block, gleich nach
  `setupSectionAccordions`). Zu diesem Zeitpunkt sind alle Slider-Elemente
  garantiert im DOM, die Bindings können sicher angehängt werden.
- `console.log("[kf-editor] bindKeyframeEditor done — sliders are live")`
  nach erfolgreichem Bind. Wenn Marc öffnet die DevTools-Konsole, sollte
  diese Zeile bei jedem App-Start auftauchen — wenn nicht, sehen wir
  sofort wo's klemmt.
- `console.warn("[kf-editor] slider X moved but _selectedKfIdx is null")`
  falls ein Slider zwar reagiert aber kein Keyframe selektiert ist (Edge-
  Case, sollte nicht passieren).
- Missing-Element-Warns für die zwei Action-Buttons + Slider, damit man
  beim nächsten Mal sofort sieht ob ein ID-Tippfehler im Spiel ist.

## [0.7.4] – 2026-05-22 20:25

### Geändert (Detail-Editor folgt dem Scrubber — Marc-Bug)

Marc nach v0.7.3-Test:
> „wenn ich an einem punkt auf der timeline bin, wo es noch keinen
> keyframe gibt, ich aber irgendwas am bild ändere, also irgendeine
> einstellung, zoom, pitch, location … wie auch immer, dann soll nicht
> der LETZTE keyframe bearbeitet werden, der soll nur bearbeitet werden,
> wenn ich auf dem bin. wo anders, kann ich alles frei bewegen und wenn
> ich will einen keyframe dann mit diesen einstellungen hinzufügen."

**Root Cause:**
Der Detail-Editor blieb sticky am zuletzt-ausgewählten Keyframe — auch
wenn der User mit Scrubber/Pfeiltasten/Klick auf die Bar woanders hin
navigiert hat. Slider-Änderungen im Editor haben dann den FALSCHEN
Keyframe modifiziert (nämlich den ursprünglich selektierten, nicht den
„aktuellen" am Scrubber).

**Neue Logik:**
- Der Detail-Editor in der Sidebar wird **automatisch ein-/ausgeblendet**
  basierend auf der Scrubber-Position.
- **Scrubber AUF einem Keyframe** (Toleranz: ein halber GPS-Punkt-Abstand)
  → Editor erscheint, zeigt diesen Keyframe; Karten-Pin gelb hervorgehoben.
- **Scrubber irgendwo dazwischen** → Editor verschwindet. Karte ist
  jetzt **frei** — User kann mit Maus/Cmd-Drag pannen/kippen/zoomen ohne
  einen Keyframe zu modifizieren.
- **„📍 Hier Keyframe"-Button** kreiert dann an der aktuellen Scrubber-
  Position einen neuen Keyframe mit den eingestellten Karten-Werten.
- Wenn der User „Hier Keyframe" drückt während er nahe an einem bestehenden
  Keyframe steht, wird **dieser geupdated** statt einen Duplikat
  anzulegen (vermeidet versehentliches doppeltes Klicken).

**Status-Anzeige in der Bar:**
Die Position-Anzeige (vorher nur „Punkt 234 / 1500 · 15.6 %") zeigt
jetzt zusätzlich den Modus:
- `· 🎥 auf Keyframe #2` — Editor aktiv, Slider modifizieren diesen
- `· frei (📍 = neuer Keyframe)` — Karte freier Spielwiese, Button legt neu an

**Technisch:**
- Neuer Helper `findKeyframeAtAnchor(anchor)` — sucht den Keyframe der
  innerhalb der Toleranz liegt (default `max(0.5%, halber GPS-Punkt-
  Abstand)` damit jeder Track-Punkt eindeutig zu max. einem Keyframe
  gehört).
- Neuer Helper `syncScrubberSelection(anchor)` wird am Ende von
  `scrubPreview()` aufgerufen. Updated `_selectedKfIdx`, ruft
  `renderKeyframeEditor()` der dann die Sektion zeigt/versteckt.
- `selectKeyframe(idx)` vereinfacht: scrubbt nur zur Keyframe-Position
  und lässt `syncScrubberSelection()` den Editor-State ableiten.
- `snapshotKeyframe()`: wenn schon ein KF nah an der Scrubber-Pos
  existiert → updaten statt anlegen.
- i18n: `animator.timeline.on_keyframe`, `animator.timeline.free_mode`.

## [0.7.3] – 2026-05-22 20:10

### Geändert (Keyframes löschen wird auffindbar — Marc-Frage)

Marc:
> „wie löscht man einen keyframe?"

War in v0.7.0–v0.7.2 zwar bereits implementiert (3 Wege: Rechtsklick auf
Marker, 🗑-Button im Editor, „Alle weg" für alle), aber so versteckt dass
Marc als Power-User es nicht gefunden hat. UX-Cleanup:

- **Löschen-Button im Detail-Editor** — vorher nur ein 🗑-Icon ohne Text,
  jetzt mit klarem Text „🗑 Diesen Keyframe löschen". Volle Breite,
  roter Akzent (rot-orange Border + Text).
- **Hint-Block** direkt unter dem Hauptteil des Detail-Editors:
  „Schnell-Lösch-Wege: Rechtsklick auf den Marker · <kbd>Entf</kbd>-Taste
  wenn der Keyframe ausgewählt ist."
- **Marker-Tooltip** erweitert um „Klick: auswählen · Rechtsklick: löschen
  · Drag: verschieben" — hover über jeden Marker zeigt das jetzt.
- **<kbd>Del</kbd>/<kbd>Backspace</kbd>-Taste** löscht den aktuell
  selektierten Keyframe — analog zur Pfeiltasten-Navigation (Filter:
  nur wenn Animator aktiv und kein Input-Element fokussiert).
- **Tastatur-Hint** unter der Timeline-Bar erweitert um `Del`.

Keine neue Funktionalität, nur Discoverability-Fix.

## [0.7.2] – 2026-05-22 20:00

### Behoben (Detail-Editor wirkte sich nicht auf Preview aus — Marc-Bug)

Marc nach v0.7.1-Test:
> „Änderungen unter „Kamera Keyframe" wirken sich 0 auf die preview aus"

**Root Cause:**
Die Slider im Sidebar-Detail-Editor (Anchor, Pitch, Bearing, Zoom-Δ) haben
zwar `updateKeyframeFields()` aufgerufen (Daten wurden korrekt im Cache
gespeichert), aber für die **Karten-Live-Preview** habe ich nur einzelne
Properties via `map.easeTo({ pitch: v })` etc. gesetzt — ohne den
Camera-State an der Keyframe-Position zu re-interpolieren. Resultat:
optisch ist nichts sichtbar passiert weil:
- Beim Anchor-Slider wurde NUR das Feld geändert, aber der Karten-Center
  blieb wo er war (kein Track-Point-Sprung).
- Beim Pitch-Slider hat `map.easeTo({ pitch: v })` zwar das Pitch
  gesetzt, aber wenn der Scrubber gerade NICHT auf diesem Keyframe stand
  (z.B. auf 0%), interpolierte die Karte sofort wieder zurück zum
  Default-Wert von 0% — der User sah nur ein Flackern.

**Fix:**
- Jeder Slider-Change ruft jetzt `scrubPreview(anchor)` mit dem Anchor
  des aktuell ausgewählten Keyframes auf.
- `scrubPreview()` macht die volle Re-Interpolation: setzt center auf
  den GPS-Track-Punkt an dieser Position, plus pitch/bearing/zoom aus
  dem Camera-Interpolation-Algorithmus. So sieht Marc unmittelbar wie
  der gerade-eingestellte Wert im Cinematic wirkt.
- **Klick auf einen Keyframe-Marker (Bar oder Karten-Pin)** scrubbt jetzt
  ebenfalls sofort zur Keyframe-Position. Vorher wurde nur der
  Detail-Editor in der Sidebar geöffnet — aber die Karte zeigte noch
  was anderes. Verwirrend.

## [0.7.1] – 2026-05-22 19:50

### Geändert (Probe-Lauf realistisch + Pfeiltasten-Navigation — Marc-Feedback)

Marc nach v0.7.0-Test:
> „probelauf geht viel zu schnell. man sollte mit den pfeiltasten frame
> bzw. bei uns sind es ja gps punkte vor und zurücksrpingen können. also
> quasi in der timeline navigieren"

**Probe-Lauf realistisch:**
- Vorher hardcoded 5 s — viel zu schnell um den Camera-Flow zu beurteilen.
- Jetzt nutzt der Probe-Lauf die **eingestellte Animations-Dauer** (`cfg.duration_s`,
  Default 12 s) + die Hold-Phase (`cfg.hold_s`). So sieht der Vorschau-Run
  genauso aus wie der spätere Render — nur ohne ffmpeg-Output.
- **Toggle-Verhalten**: zweiter Klick auf „Probe-Lauf" stoppt sofort
  (Button wird zu „⏸ Stopp" während Playing). Space-Taste macht dasselbe.

**Pfeiltasten-Navigation:**
- **← / →** — ein GPS-Punkt vor/zurück (synchron zur Scrubber-Position)
- **Shift + ← / →** — 10-er-Sprung
- **Home / End** — zum Track-Anfang / -Ende
- **Space** — Probe-Lauf starten/stoppen
- Funktioniert nur wenn der Animator aktiv ist UND kein Input/Textarea/
  Select gerade Fokus hat (sonst würde z.B. Pfeiltaste im Number-Slider
  beide Aktionen auslösen)
- Hint mit den Tastatur-Shortcuts steht jetzt direkt unter der Timeline-Bar
  rechts neben der Position-Anzeige

**Position-Anzeige in der Timeline-Bar:**
- Neue Status-Zeile zeigt live `Punkt N / Total · X.X%` während du den
  Scrubber bewegst oder per Tastatur navigierst
- Macht's einfacher exakt zu wissen wo der Scrubber gerade auf dem Track
  steht — besonders nützlich für präzise Keyframe-Platzierung an
  spezifischen GPS-Punkten

**Technisch:**
- `ui/js/timeline.js`: Status-Row mit Label-Provider-Callback
  (`getPositionLabel(anchor) → string`). Animator-Modul liefert
  Label im Format `Punkt N / Total · X.X%`.
- Play-Button hat jetzt einen `is-playing`-Zustand mit orangener
  Hervorhebung + Icon-Wechsel ▶ → ⏸.
- `runTimelinePreview(forceStart)` — ohne `forceStart=true` toggle-Verhalten
  (zweiter Klick stoppt). Mit `forceStart=true` immer starten (Reserve für
  programmatisches Auslösen).
- `bindTimelineKeyNav()` einmalig idempotent gebunden beim ersten
  GPX-Load. Window-Level keydown-Listener mit Filter auf
  Input/Textarea/Select + contentEditable.
- `jumpTrackPoints(delta)` + `jumpToAnchor(anchor)` — neue Helfer, die
  Scrubber-Position + Map-Preview synchron updaten.
- i18n DE/EN/ES für alle neuen UI-Strings (timeline.stop, timeline.point,
  timeline.keynav.*).

## [0.7.0] – 2026-05-22 19:30

### Hinzugefügt (Camera-Keyframe-Timeline — Beta-Tester-Idee)

Beta-Tester:
> „Du legst ja ein Tempo vor, hier noch eine Idee bei Kamera Neigung und
> Rotation mit Keyframes beeinflussen."

Plus Marc-Erweiterung: „karte hin-ziehen wie ich möchte und sagen hier
jetzt keyframe" + „pitch per Geste" (kann Mapbox eh out-of-the-box mit
Cmd+Drag / Rechtsklick+Drag).

**Neue Komponente: Timeline-Bar unter der Karten-Vorschau** (~140 px hoch,
volle Breite). Bar zeigt Track-Position 0–100 % als Achse. Pro
Camera-Keyframe ein gelber 🎥-Marker an der Anker-Position. Plus drei
Action-Buttons:
- **📍 Hier Keyframe** — snapshottet pitch + bearing + zoom_offset der
  aktuellen Karten-Ansicht (siehe Snapshot-Workflow unten) an der
  aktuellen Scrubber-Position.
- **▶ Probe-Lauf** — spielt den ganzen Track in 5 s ab + interpoliert
  Camera-Werte synchron. Reines Vorschau-Feature, kein Render-Trigger.
- **🗑 Alle weg** — entfernt alle Camera-Keyframes. Pitch/Rotation-Slider
  in der Sidebar werden danach wieder als Master verwendet.

**Snapshot-Workflow (primäre UX):**
1. User bewegt die Karten-Vorschau ganz normal mit Maus-Gesten:
   - Drag → Pan
   - Scrollen → Zoom
   - `Cmd + Drag` (Mac) oder Rechtsklick + Drag → Pitch + Bearing
     gleichzeitig (Mapbox-Built-In)
   - Trackpad: zwei Finger vertikal → Pitch
2. User klickt „Hier Keyframe" → Karten-State wird snapshottet:
   - `pitch` = `map.getPitch()`
   - `bearing` = `map.getBearing()`
   - `zoom_offset` = `map.getZoom() - fitZoomBase` (rel. zum Auto-Fit-Zoom)
3. Anchor wird auf die aktuelle Scrubber-Position gesetzt (default 0).
4. Neuer Keyframe erscheint als 🎥-Marker auf der Timeline-Bar UND als
   gelber Pin direkt auf der Track-Linie in der Karte.
5. Im Sidebar-Akkordeon öffnet sich der **Detail-Editor** für diesen
   Keyframe mit 4 Slidern (Anchor, Pitch, Bearing, Zoom-Δ) zum
   Feintunen + Button „Mit aktueller Karten-Ansicht aktualisieren" zum
   Re-Snapshot.

**Interaktive Timeline-Bar:**
- **Klick auf Marker** → Keyframe ausgewählt, Detail-Editor öffnet,
  Karten-Pin gelb hervorgehoben.
- **Klick auf Karten-Pin** → analog (gleicher Effekt).
- **Drag Marker** → Anchor verschieben (live).
- **Rechtsklick Marker** → Löschen.
- **Klick / Drag auf der Bar (nicht auf einem Marker)** → Scrubber
  setzen + Live-Vorschau der Camera-Werte an dieser Position +
  Track-Linie wird bis zum Scrubber getrimmt.

**Backward-Compatibility (wichtig):**
- **0 Keyframes** → klassisches Verhalten 1:1 erhalten: statischer
  `cfg.pitch` + linearer Bearing-Sweep von -10° bis `(-10° + cfg.rotation)`.
- **Sobald 1 Keyframe** → die alten Pitch/Rotation-Slider in der Sidebar
  bekommen einen gelben Hinweis-Stripe „⏱ Wird durch Timeline-Keyframes
  gesteuert" und werden visuell als sekundär markiert. Die Slider-Werte
  funktionieren weiterhin als Defaults (Render fällt auf cfg.pitch / 
  cfg.rotation zurück wenn `interpolate_camera` keine Camera-Events
  findet — was nicht passiert solange Keyframes existieren).
- **„Alle weg"** → zurück zu klassisch.

**Technisch:**
- Neues Modul **`core/timeline.py`** — `CameraKeyframe`-Dataclass +
  `interpolate_camera()`-Helper. Shortest-arc bearing interpolation
  (350° → 10° dreht +20°, nicht -340°). Forward-Compat: Easing-Feld
  schon im Schema (`easing: linear|ease_in|ease_out|ease_in_out`),
  v0.7.0 implementiert nur linear, ease-Modi in v0.7.2.
- **`AnimatorConfig.timeline_events: list = field(default_factory=list)`**
  — persistierte Event-Liste (kind/anchor/payload). Forward-Compat-Schema
  für Foto-Events (v0.7.1) und Text-Overlays (v0.7.2) im gleichen
  Container.
- **Render-Loop in `core/animator.py`** ruft `interpolate_camera()` pro
  Frame statt linearem Sweep. Anchor = `idx / len(points)` (Track-Position,
  nicht Frame-Zeit) — Keyframes bleiben „am Gipfel" auch wenn die
  Anim-Dauer geändert wird.
- **`zoom_offset`** wird auf den Bbox-Auto-Fit-Zoom addiert → Render
  zoomt nahtlos in Hotspots rein.
- Neue UI-Komponente **`ui/js/timeline.js`** (wiederverwendbar) +
  **`ui/css/timeline.css`**. JS-Version von `interpolate_camera()`
  synchron zu `core/timeline.py` für die Live-Preview.
- Karten-Pin-Layer **`preview-kf-pins`** (Mapbox-Circle) zeigt die
  Keyframes auf der Track-Linie; klickbar zum Auswählen.
- Settings-Schema in `app.py`: `timeline_events: []` in `DEFAULT_SETTINGS["animator"]`.
- Bridge: `params.get("timeline_events", []) or []` durchgeschleift.
- i18n DE/EN/ES für alle neuen UI-Strings.

**Was NICHT in v0.7.0 ist (kommt später):**
- Foto-Inserts → v0.7.1
- Text-Overlays + Easing-Kurven → v0.7.2
- Off-Track-Position-Keyframes (Pan ohne Track-Folge) → v0.8 falls benötigt
- Tour-Map-Timeline — Tour-Map ist statisch, hat keine Animation. Die
  Modul-Spiegelungs-Regel gilt hier explizit nicht.

## [0.6.9] – 2026-05-22 15:50

### Behoben (Resolution-Persistenz: width/height-Swap bei Reload — Marc-Bug)

Marc-Repro:
> „Ich stelle 4K 16:9 ein, schließe die App, öffne sie wieder und sie geht
> mit 4K 9:16 auf."

**Root Cause (alter Bug, schon immer da, jetzt erst aufgefallen):**

In `ui/js/util.js` ist `saveSettings()` debounced (200 ms). Mehrere
aufeinanderfolgende Patches wurden NICHT zusammengeführt — der zweite
Patch hat den ersten **überschrieben**:

```
clearTimeout(_settingsSaveTimer);
_settingsSaveTimer = setTimeout(() => {
  api().settings_set(patch);  // ← nur der LETZTE patch
}, 200);
```

Wenn die Resolution-Buttons („4K", „1080p", etc.) klicken, dispatchen sie
sequentiell `input`-Events auf width+height — beide triggern `saveSettings`
mit ihrem jeweiligen Sub-Patch. Resultat:

1. `saveSettings({animator: {width: 3840}})` → Timer1 läuft mit Patch1
2. `saveSettings({animator: {height: 2160}})` → Timer1 CLEARED, Timer2 läuft mit Patch2
3. 200 ms später: `settings_set({animator: {height: 2160}})` — Width fehlt!
4. Backend lädt alte settings.json, merget nur height, schreibt. Width auf
   Disk bleibt auf altem Wert (z.B. 1280 von einem früheren 9:16-Versuch).
5. Beim nächsten App-Start: alte width × neue height = vertauschte
   Auflösung (z.B. 1280×2160 statt 3840×2160).

**Fix:**
- Neuer Module-Level-State `_settingsPendingPatch`, der ALLE Patches im
  Debounce-Fenster akkumuliert (tief-mergen pro Section).
- Bei Timer-Feuer wird der gesamte akkumulierte Patch ans Backend
  geschickt, dann auf `null` reset.
- Identische Logik im `{immediate:true}`-Pfad — auch der schickt jetzt
  den akkumulierten Patch (falls vorher noch was im Pending hing).

Side-effects: keine. Der `_settingsCache` wurde schon immer korrekt
gemerged — nur der API-Patch war kaputt.

## [0.6.8] – 2026-05-22 15:20

### Hinzugefügt (Glow konfigurierbar — Marc-Frage „wo regle ich den Glow?")

Marc nach v0.6.7-Test:
> „wo stelle ich den glow überhaupt ein? gibt's dafür eine regelung"

Bisher war der Glow (farbige Aura/Halo um die Track-Linie) komplett hardcoded:
`line-width = 2.85× Linien-Dicke`, `line-opacity = 0.35`, `line-blur = 4 px`. Kein
User-Control. Jetzt analog zum Schlagschatten-Pattern:

**Neue Konfiguration (Animator + Tour-Map):**
- `glow_enabled: bool = True` — Master-Toggle (Checkbox). Bei False wird der
  Glow-Layer komplett weggelassen (Render-HTML enthält ihn nicht).
- `glow_strength: float = 4.0` — Slider 0–10, regelt den `line-blur` der
  Aura. 4 = bisheriger Default. 0 oder Checkbox aus = nackte Linie ohne Glow.

**UI (Track-Akkordeon, direkt nach dem Schlagschatten-Block):**
- Checkbox „Glow um Track-Linie"
- Slider „Glow-Stärke" mit Live-Wert-Anzeige in px
- Slider grayed-out wenn Checkbox aus (analog Schlagschatten-UI)
- Live-Update in der Preview ohne Render-Trigger

**Render-Pfade:**
- `core/animator.py`: Mapbox-Render-HTML lässt `track-glow`-Layer weg wenn
  `glow_enabled=False`. `line-blur` kommt aus `cfg.glow_strength`.
- `core/tourmap.py`: gleiches für `track-glow` im Tour-Map-Render.
- `core/animator.py` SVG-Alpha-Pfad: `<polyline id="trk-glow">` wird nur
  gerendert wenn glow aktiv, `style="filter: blur({glow_strength}px);"`.
- JS-Animation in `_make_html`: `document.getElementById('trk-glow')` mit
  optional-chaining/null-check (Element kann fehlen wenn glow disabled).

**Bridge:**
- `app.py`: `glow_enabled` + `glow_strength` in beiden Render-Endpoints
  (Animator + Tour-Map) durchgeschleift.

**i18n DE/EN/ES:**
- `animator.toggle.glow`, `animator.glow.tooltip`, `animator.field.glow_strength`

## [0.6.7] – 2026-05-22 15:00

### Behoben (Punkt-Pattern + Glow-Bleed bei dashed/dotted — Marc-Test-Feedback)

Marc nach v0.6.6-Test:
> „nee funktioniert nicht richtig. wo ist die einstellung für den schlagschatten
> hin? punkte sind auch striche … viel zu lang. die linie ist halb durchsichtig
> überall zu sehen"

Zwei klare Bugs in v0.6.6 (war zu schnell rausgehauen ohne sauberen Visual-Check):

**1. „Linie ist halb durchsichtig überall zu sehen":**
Der `track-glow`-/`preview-glow`-Layer (der die farbige Aura um die Track-Linie
malt) hat NICHT die `line-dasharray`-Property bekommen — nur `track-line` und
`track-shadow`. Effekt: das eigentliche Strich-/Punkt-Muster ist da, aber der
Glow leuchtet durchgehend zwischen den Lücken → der Track sieht aus wie eine
solide halb-transparente Linie mit dunkleren Punkten/Strichen drauf statt
echter Punkte.

Fix:
- `core/animator.py`: `track-glow` bekommt jetzt auch `line-dasharray`
  (Mapbox-Render-HTML).
- `core/tourmap.py`: gleiches für `track-glow` im Tour-Map-Render.
- `modules/animator/ui/module.js`: `applyLineStyle()` setzt jetzt
  `line-dasharray` AUCH auf `preview-glow` (vorher nur preview-line +
  preview-shadow).
- `modules/tourmap/ui/module.js`: gleiches für `preview-glow`.
- (Im Alpha-SVG-Render war Glow schon korrekt mit `stroke-dasharray`
  versehen — der Render-Pfad war von Anfang an richtig.)

**2. „Punkte sind auch Striche … viel zu lang":**
Das Pattern `[0.4, 1.8]` für `dotted` kombiniert mit `line-cap: round`
(seit v0.6.5) ergibt mathematisch keine Kreise sondern Ovale: ein Dash der
Länge L mit Round-Cap wird visuell zu L+line_width (die Halbkreise an beiden
Enden verlängern um je line_width/2). Bei L=0.4 und line_width=4 → Dot wird
1.6+4 = 5.6 px lang × 4 px hoch = stark ovaler „Strich".

Fix: `_DASH_BASE["dotted"]` von `[0.4, 1.8]` auf `[0.1, 2]` korrigiert. Mit
dem Round-Cap-Trick wird der Dot jetzt zu 0.4+4 = 4.4 px lang × 4 px hoch =
fast perfekt rund. `dashdot` analog: zweite Punkt-Komponente `0.5 → 0.1`.

**3. „Wo ist die einstellung für den schlagschatten hin?":**
Die Checkbox + der Slider sind weiterhin im DOM im Track-Akkordeon. Marc hat
sie evtl. übersehen weil der Spacing-Slider darüber Platz frisst, oder weil
der gedashte Schatten (mit Blur) im Preview kaum noch erkennbar war. Mit dem
korrigierten Punkt-Pattern und dem ge-dashten Glow sollte das Visual jetzt
viel sauberer aussehen → Schlagschatten ist als separater Effekt wieder klar
zu erkennen.

## [0.6.6] – 2026-05-22 14:44

### Hinzugefügt (Pin-Preview im Tour-Map + Linien-Stil-Spacing — Marc-Feedback)

Marc nach v0.6.5-Test:
> „Start/End Pin sehe ich nicht in der Preview. Rendern habe ich noch nicht
> probiert. Mach noch einen Slider bei gepunktet, gestrichelt … um den
> abstand der punkte usw. so einzustellen"

**Pin-Preview (Tour-Map):**
- Vorher waren die Start/End-Pins nur im finalen PNG sichtbar.
- Jetzt zwei Mapbox-Circle-Layer (`preview-pin-glow` + `preview-pin-core`)
  als Source `preview-pins` direkt in der Live-Karte, synchron zur
  `tmap-pins`-Checkbox und zur Track-Farbe.
- Optik 1:1 zum Render: weißer Start-Punkt mit farbigem Border, farbiger
  End-Punkt mit weißem Border, beide mit Glow.
- Neuer Helper `rebuildPreviewPins()` in `modules/tourmap/ui/module.js`,
  wird vom `rebuildPreviewLayers()` mit aufgerufen. `applyPinsVisibility()`
  togglet Layer-`visibility` beim Checkbox-Klick.

**Spacing-Slider für Linien-Stil:**
- Neues Slider-Feld „Abstand" in der Track-Sektion (Animator + Tour-Map).
- Nur sichtbar wenn `line_style != "solid"` — bei durchgezogener Linie
  gibt's nichts zum Spacen.
- Range 0.5–5.0, Schritt 0.25, Default 1.0.
- Multipliziert ALLE Werte im dash-Pattern → 0.5 = halb so große Periode
  (dichteres Muster), 2.0 = doppelte Periode (weiteres Muster). Verhältnis
  Dash-zu-Gap bleibt gleich, nur die Pattern-Größe ändert sich.
- Live-Update in der Preview ohne Render-Trigger.

Technisch:
- `AnimatorConfig.line_style_spacing: float = 1.0` + `TourmapConfig.
  line_style_spacing: float = 1.0`.
- `_dasharray_mapbox()` und `_dasharray_svg()` nehmen jetzt `spacing` als
  zusätzlichen Parameter (Default 1.0, Backwards-Compat).
- `_DASH_BASE`-Dict als Single-Source-of-Truth für die Base-Pattern.
- Bridge schleift `line_style_spacing` durch.
- i18n DE/EN/ES für `animator.field.line_style_spacing`.

## [0.6.5] – 2026-05-22 14:28

### Hinzugefügt (Linien-Stil: solid / dashed / dotted / dashdot — Beta-Tester-Idee)

Beta-Tester:
> „Funktioniert hervorragend, noch eine Idee von mir, kann man die gpx
> Spur unterschiedlich einstellen? Zum Beispiel Rund oder gestrichelt?"

Neues Dropdown **„Linien-Stil"** in der Track-Sektion von Animator
UND Tour-Map. Vier Optionen:
- **Durchgezogen** (Default — wie bisher)
- **Gestrichelt** — `[3, 2]` Mapbox-Liniendicken
- **Gepunktet** — `[0.4, 1.8]` Mapbox-Liniendicken (mit round-caps werden's
  schöne runde Punkte)
- **Strich-Punkt** — `[3, 1.5, 0.5, 1.5]`

Mapbox-`line-dasharray` ist in Liniendicken-Einheiten — heißt der Stil
skaliert automatisch mit der Track-Dicke (dicke Linie → größere
Striche/Punkte, immer im selben Verhältnis).

Bonus: bei der Gelegenheit gleich `line-cap: round` und `line-join: round`
als Default auf ALLE Track-Layer (preview-shadow/preview-glow/preview-line
in der UI, track-shadow/track-glow/track-line im Render-HTML). Vorher
waren das Mapbox-Defaults `butt/miter` — kantig an Endungen und scharfen
Track-Knicken. Mit `round` sind die Track-Endungen jetzt schön
abgerundet (das ist möglicherweise was Beta-Tester ursprünglich mit „Rund"
meinte).

Technisch:
- Neue Helper `_dasharray_mapbox(line_style)` und `_dasharray_svg(
  line_style, line_width)` in `core/animator.py`.
- `AnimatorConfig.line_style: str = "solid"` + `TourmapConfig.line_style:
  str = "solid"`.
- Bridge schleift den Parameter durch.
- UI: `applyLineStyle()`-Helper in beiden Modulen — Live-Preview ohne
  Render-Trigger.
- Alpha-HTML (`_make_html_alpha`): SVG-`stroke-dasharray` für trk-glow +
  trk-line.
- i18n DE/EN/ES für 5 neue Strings (`animator.field.line_style` +
  `animator.line_style.{solid,dashed,dotted,dashdot}`).

## [0.6.4] – 2026-05-22 11:12

### Behoben (Karten-Position springt zurück beim Auflösungs-Wechsel — Marc-Bug)

Marc-Folge-Bug nach v0.6.3:
> „neee, der ändert die position in der karte, wenn ich bspw. von 4K auf
> 1080p stelle"

In v0.6.3 hatte ich den Refit-Timing-Bug via `requestAnimationFrame()`
gefixt — der Refit lief jetzt nach dem Resize. Aber: der Refit selbst war
ein `fitTrackPreview(true)` / `fitTrackToView(true)` auf den
**Track-Bbox**, nicht auf die aktuell sichtbare Karten-Position. Damit
wurde jeder manuelle Pan/Zoom des Users beim Auflösungs-Wechsel
zerstört.

Fix: vor dem Resize `map.getBounds()` einfangen (= aktuell sichtbarer
geographischer Bereich, unabhängig davon ob bounds-fit oder User-Pan)
und nach dem Resize via `map.fitBounds(savedBounds, {duration:0,
padding:0})` denselben Bereich wieder zeigen. Mapbox passt automatisch
die enger begrenzende Achse an — bei Aspect-Wechsel (16:9 → 9:16)
zeigt der neue Frame eben mehr Welt auf einer und weniger auf der
anderen Achse, aber der Track bleibt da wo er war.

Geändert an 2 Stellen (Animator + Tour-Map identisch):
- `modules/animator/ui/module.js` → `onAnimResolutionChange()`
- `modules/tourmap/ui/module.js` → `onResolutionOrPaddingChange()`

## [0.6.3] – 2026-05-22 10:47

### Behoben (Stats-Boxen wirken bei 4K winzig — Marc-Bug)

Marc:
> „die statts sollten immer gleich groß bleiben, egal welche auflösung"

Ursache: alle Pixel-Werte der Stats-Boxen waren hartcodiert auf
1080p-Maße (18 px Padding, 22 px Value-Font, 11 px Label-Font, 40 px
Position-Inset). Bei 4K-Render rendert ein 18-px-Padding nur 0.83 %
der Frame-Höhe — visuell winzig. Bei Shorts (1080×1920) das andere
Extrem: 18 px sind 1.67 % der vertikalen Achse, plus die Boxen
nehmen viel mehr Frame-Anteil ein.

Fix:
- Neue Helper-Funktion `_overlay_scale(render_height)` in
  `core/animator.py` → returnt `max(0.5, height / 1080)`.
- Neue Helper-Funktion `_overlay_css(cfg, alpha_mode=False)` generiert
  das gesamte Overlay-CSS mit auflösungs-skalierten Pixel-Werten.
  Wird sowohl in `_make_html` als auch `_make_html_alpha` aufgerufen.
- `core/tourmap.py` importiert `_overlay_css` aus animator.py
  (DRY — beide Module teilen die exakt gleiche Overlay-Optik).
- UI-Preview: `modules/animator/ui/module.css` und das identische
  `.overlay-preview-layer`-CSS (auch von Tour-Map genutzt) ersetzen
  alle hartcodierten px-Werte durch `calc(<basis>px * var(--overlay-
  scale))`. JS setzt `--overlay-scale` beim `updateAnimatorViewport()`
  bzw. `updateViewport()` auf den selben Wert wie das Backend.

Damit sind Render und Preview pixel-genau synchron, auf jeder
Auflösung. Sanity-Test:
- 1080p (base): scale 1.0 → Padding 18 px, Value-Font 22 px
- 4K (2160 hoch): scale 2.0 → Padding 36 px, Value-Font 44 px
- Shorts (1920 hoch): scale 1.78 → Padding ~32 px, Value-Font ~39 px

### Behoben (Karten-Ausschnitt verschiebt sich bei Auflösungs-Wechsel)

Marc:
> „wenn ich die auflösung ändere, verschiebt sich der kartenausschnitt"

Ursache: bei Resolution-Change wurde zuerst `updateAnimatorViewport()`
gerufen (löst `map.resize()` aus), direkt danach `fitTrackPreview(true)`.
Mapbox-`fitBounds` berechnet aber noch auf der alten Canvas-Größe weil
der `resize`-Tick noch nicht durch ist → Track sitzt einen Frame lang
verschoben.

Fix: Refit jetzt in `requestAnimationFrame()` gewrappt — läuft im
nächsten Browser-Frame, NACH dem Mapbox-Resize. In `onAnimResolution
Change` (Animator) und `onResolutionOrPaddingChange` (Tour-Map).

## [0.6.2] – 2026-05-22 10:17

### Entfernt (Windows-Portable-ZIP abgeschafft — Marc-Entscheidung)

Die ZIP-Variante hatte seit ihrer Einführung das Mark-of-the-Web-DLL-
Loading-Problem (siehe v0.4.2-Changelog). Der Installer umgeht das
vollständig und ist seit v0.4.3 die offiziell empfohlene Windows-
Variante. Mit v0.6.2 ist die ZIP komplett weg:

- `.github/workflows/release.yml` — Compress-Archive-Step + ZIP-Upload-
  Asset entfernt. Windows-Artifact ist jetzt nur noch die Setup.exe.
- `scripts/deploy_release.sh` — FILE_WIN nicht mehr verwendet,
  Sanity-Check + Upload-Block + Smoke-Test nur noch über die 3
  Distribution-Files (DMG, Setup.exe, tar.gz) + changelog.html.
- Der hartcodierte „⚠️  TODO Marc: Shortlink umstellen"-Hinweis im
  Skript-Output entfällt (Marc hat den Shortlink längst auf
  `setup.exe` umgestellt).
- `docs/USER_GUIDE.md` — Portable-ZIP-Schritt-für-Schritt-Sektion
  entfernt, Download-Tabelle auf 3 Zeilen reduziert.

Power-User die die App portabel brauchen können das Programme-
Verzeichnis nach dem Setup-Install kopieren — Inno Setup installiert
„xcopy-deployable" (alle Dateien in einem Ordner, keine Registry-
abhängigen Komponenten).

**Server-Aufräumung** (nicht im Code, separater Schritt im Deploy):
- `ReisezoomGPSStudio-windows.zip` per FTP gelöscht
- `ReisezoomGPSStudio-macos-fresh-20260521-1631.dmg` (alter Test-Upload
  vom oldwinkie-Vorfall) ebenfalls gelöscht

## [0.6.1] – 2026-05-22 09:58

### Behoben (WYSIWYG-Bug: Render-Zoom weicht von Vorschau-Zoom ab — Bug-Report Beta-Tester)

Beta-Tester meldete:
> „Beim fertigen exportierten Video stimmt der Kartenausschnitt nicht
> exakt mit dem Ausschnitt in der Vorschau überein. Im fertigen Video
> scheint die Zoomstufe niedriger."

Ursache: Mapbox-Zoom ist relativ zur Viewport-Pixel-Breite. Bei Zoom z
hat die Welt 2^z × 512 Pixel. Die Vorschau-Karte ist ~800 px breit,
der Render typischerweise 1920–7680 px. Bei gleichem `getZoom()`-Wert
zeigt der Render-Output 2.4× bis 9.6× mehr Welt als die Vorschau →
der Track wirkt herausgezoomt.

Fix: neuer Helper `correctedZoom(map, renderWidth, renderHeight)` in
`ui/js/util.js`, der den Faktor `log2(renderWidth / previewWidth)` zum
preview-Zoom addiert. Bei Letterbox-Aspect-Match sind width- und
height-Faktoren identisch; wir nehmen `Math.min(factorW, factorH)`
analog zu Mapbox' eigener fitBounds-Skalierung (enger begrenzende
Achse).

Test-Mathematik (mit Vorschau 800×450):
- Render 3840×2160, Vorschau-Zoom 12 → korrigierter Zoom 14.263
- Render 1920×1080, Vorschau-Zoom 12 → korrigierter Zoom 13.263
- Render 800×450,   Vorschau-Zoom 12 → korrigierter Zoom 12.000

Geändert an 2 Stellen:
- `modules/animator/ui/module.js` — `overrideZoom` beim Render-Start
- `modules/tourmap/ui/module.js` — analog

Wenn der User NICHT gepant/gezoomt hat (override null), läuft alles wie
gehabt: das Backend macht bounds-fit auf der Render-Canvas-Größe und
braucht keine Korrektur.

## [0.6.0] – 2026-05-21 22:40

### Geändert (Sidebar-Refactor — alles als Akkordeon, persistent)

Marc-Feedback nach v0.5.0:
> „Man sieht nicht so richtig, dass wir da ein akordeon haben.
> Nimm Karten Feinabstimmung raus und packe alles unter karte.
> das kann alles zugeklappt sein erst mal und dann merk dir, wie der
> user die app verlässt. also was ist aufgeklappt, was zu?"

Komplette Sidebar-Restrukturierung in Animator UND Tour-Map.

**Vorher** (v0.5.0): 7 flache Sektionen + 1 verstecktes Akkordeon.
Visuell schwer zu erkennen welche Sektion klickbar ist.

**Jetzt** (v0.6.0): 6 einheitliche Akkordeon-Sektionen, alle mit dem
selben klickbaren Header-Pattern (Pfeil ▸/▾ + Hover-Highlight).

#### Neue Sektions-Hierarchie

**Animator-Sidebar:**
- Quelle (GPX-Auswahl)
- **Karte** (zusammengefasst aus alter „Karte" + „Karten-Feinabstimmung"):
  - Stil (jetzt mit „Ohne Karte (Alpha-Kanal)" als 7. Option)
  - 3D-Terrain + Terrain-Übertreibung
  - Beleuchtung (dawn/day/dusk/night)
  - 5 Beschriftungs-Checkboxen
- **Track** (neu, aus „Karte" + „Performance" zusammengeführt):
  - Farbe, Dicke
  - Schlagschatten + Stärke
  - Track-Punkte-Detail-Slider
- Overlays (unverändert)
- **Kamera** (schlanker — Übertreibung ist jetzt in „Karte"):
  - Pitch, Rotation
- **Video-Einstellungen** (umbenannt von „Zeit & Größe"):
  - Animation/Hold-Dauer
  - Auflösung
  - FPS
  - Codec — **jetzt drei Optionen**: H.264, H.265, **ProRes 4444 (Master)**

**Tour-Map-Sidebar:** analoge Struktur, statt „Video-Einstellungen"
heißt es „Bild-Einstellungen" und enthält nur die Format-Presets.

#### Akkordeon-Persistenz

State pro Modul in `settings.json[<modul>].collapsed_sections` als Array
von Section-Slugs. Beim Mount: jede Sektion wird gemäß persistiertem
State geöffnet/zugeklappt; bei Klick: State wird sofort gespeichert.

Default beim ersten App-Start: alle Sektionen zu (Marc's Wunsch —
saubere Sidebar, User entscheidet was er aufgeklappt haben will).

#### Alpha-Kanal jetzt als Karten-Stil

Vorher eigene Checkbox unter „Performance". Jetzt 7. Wert im
Stil-Dropdown („Ohne Karte (Alpha-Kanal)"). Semantisch sauberer
weil's eine Karten-Variante ist (transparente Karte).

UI-Auto-Switch: bei Auswahl von „Ohne Karte" wird der Codec
automatisch auf ProRes 4444 forciert (H.264/H.265 in MP4 unterstützt
keinen Alpha-Kanal). Hinweis-Text zeigt das an.

Backend (`app.py.animator_start_render`): empfängt sowohl
`map_style="alpha"` als auch das alte `transparent_background=true`
und behandelt beides identisch (forciert ProRes + .mov-Output).
`cfg.map_style` wird auf default zurückgesetzt wenn `"alpha"`,
weil der MAP_STYLES-Lookup im Backend sonst auf den Default fällt.

#### ProRes 4444 als regulärer Codec (auch ohne Alpha)

ffmpeg-Pipeline hat jetzt drei Modi (vorher zwei):
1. Alpha+ProRes (`yuva444p10le`, .mov)
2. **NEU**: ProRes ohne Alpha (`yuv444p10le`, .mov) — Studio-Master
   für YouTube-Master-Cuts und Color-Grading
3. H.264/H.265 (`yuv420p`, .mp4)

`needs_mov` Variable in `animator_start_render` triggert .mov-Output
für ProRes oder Alpha; sonst .mp4.

#### Technisch

- Neue `util.js`-Funktion `setupSectionAccordions(moduleKey, root)` —
  generalisiert das Akkordeon-Pattern, wird vom Animator + Tour-Map
  aufgerufen.
- CSS: `.section-collapse-header` + `.section-collapse-body` jetzt
  für alle Sektionen genutzt (vorher nur für die eine
  Karten-Feinabstimmung). Mit Hover-Background-Effekt für klarere
  Klickbarkeit.
- Neuer `.sub-group-label` Style für Unter-Gruppen (z.B. Beschriftungen-
  Block innerhalb Karte).
- AnimatorConfig + TourmapConfig: `transparent_background` bleibt das
  Backend-Flag, aber UI sendet's automatisch basierend auf Stil-Wahl.
- i18n DE/EN/ES: neue Keys `animator.style.alpha`, `animator.style.
  alpha_hint`, `animator.section.track`, `animator.section.video`,
  `animator.codec.prores`, `animator.codec.prores_hint`,
  `tourmap.section.image_settings`.

## [0.5.0] – 2026-05-21 22:00

### Behoben (Windows: Playwright-Browser wird nach Install nicht erkannt — Bug-Report Beta-Tester)

Beta-Tester meldete:
> „chrome-headless-shell-binärdatei nicht im cache gefunden"
> (kleiner Toast unten rechts nach Klick auf „Chromium installieren")

Ursache: `playwright_check()` hatte den Cache-Pfad UND die Executable-
Subordner hartkodiert für macOS:
- `~/Library/Caches/ms-playwright/` (existiert auf Windows nicht — dort
  ist's `%LOCALAPPDATA%\ms-playwright`)
- `chrome-headless-shell-mac-arm64/chrome-headless-shell` (auf Windows
  heißt der Subordner `chrome-headless-shell-win64` und das Binary hat
  `.exe`-Suffix)

Auf Windows-Systemen lief der Install zwar durch, aber der nachfolgende
Check fand den Browser nicht → User sah „nicht im Cache" und konnte
nicht rendern.

Fix:
- Cache-Pfad jetzt plattform-spezifisch:
  - macOS: `~/Library/Caches/ms-playwright/`
  - Windows: `%LOCALAPPDATA%\ms-playwright\` (Fallback: `~\AppData\Local`)
  - Linux: `$XDG_CACHE_HOME/ms-playwright/` (Fallback: `~/.cache`)
- Executable-Suche mit plattform-spezifischem Subordner + Suffix:
  - macOS arm64: `chrome-headless-shell-mac-arm64/chrome-headless-shell`
  - macOS x86_64: `chrome-headless-shell-mac/chrome-headless-shell`
  - Windows: `chrome-headless-shell-win64\chrome-headless-shell.exe`
  - Linux: `chrome-headless-shell-linux/chrome-headless-shell`
- `PLAYWRIGHT_BROWSERS_PATH`-Env-Var überschreibt weiterhin alles
  (für Power-User mit Custom-Setup).
- Bessere Fehler-Message bei nicht-gefunden: nennt jetzt die konkreten
  Subordner, in denen gesucht wurde.

### Geändert (Akkordeon statt Modal nach Marc-Feedback)

Erster Wurf um 21:46 war ein Modal (`openMapConfigModal` in util.js)
mit Save/Cancel-Buttons. Marc-Feedback direkt danach:
> „das ist blöd, dass da ein modal kommt und man die karte nicht mehr
> sieht. Mach es besser ausklappbar in der sidebar und die preview muss
> sich live anpassen"

Modal komplett raus, stattdessen:
- Eigene **Akkordeon-Sektion** in der Sidebar (Animator + Tour-Map)
- Header klickbar mit Pfeil-Indikator (▸ / ▾)
- Default: collapsed (versteckt) — Sidebar bleibt aufgeräumt
- Beim Aufklappen sichtbar: Beleuchtungs-Dropdown + 5 Element-Checkboxen
  + „Alle aus" / „Alle an"-Quick-Buttons
- **Jedes Control ist via `bindSetting(..., {onChange: applyHideLabels})`
  gebunden** → Settings werden sofort gespeichert UND die Karten-Vorschau
  wird live aktualisiert. Kein Save-Button mehr nötig.
- Karte bleibt während des Konfigurierens komplett sichtbar.

Neue CSS-Klassen in `ui/css/app.css`:
- `.section-collapse-header` (klickbare Sektions-Überschrift mit Pfeil)
- `.section-collapse-body` (collapse-Bereich mit Fade-In-Animation)
- `.quick-toggle-row` (für die zwei „Alle ..."-Buttons)

`openMapConfigModal()` in `util.js` komplett entfernt (war ~80 Zeilen).

### Hinzugefügt (Karten-Feinabstimmung — Marc-Forderung)

Marc nach dem hide_labels-Fix:
> „können wir nicht irgendwie da richtig was aufklappen, um die Karte
> komplett zu konfigurieren. also was weiß ich grenzen noch rein raus
> ... alles was mapbox halt so bietet"

Neuer Button **„⚙ Karten-Feinabstimmung …"** in der Karten-Sektion
von Animator UND Tour-Map. Öffnet ein Modal mit allem was Mapbox
bei Standard-Stilen über Config-Properties UND bei klassischen
Stilen über Layer-Sichtbarkeit erlaubt:

- **Beleuchtung (Tageszeit)** — Dropdown mit Sonnenaufgang / Tag /
  Sonnenuntergang / Nacht. Wirkt nur bei Standard-Satellite-Stilen
  (mapbox standard-satellite). Klassische Styles haben fixe
  Beleuchtung. Sonnenuntergang = goldene Stunde Look → großer
  filmischer Effekt für Outdoor-YouTube-Tracks.
- **5 Element-Checkboxen**:
  - Ortsnamen (Städte, Dörfer, Berge)
  - Straßennamen
  - Sehenswürdigkeiten / POIs (Restaurants, Museen, …)
  - ÖPNV (Bahnhöfe, Flughäfen, Häfen)
  - Verwaltungsgrenzen (Länder, Bundesländer)
- **„Alle aus" / „Alle an"-Quick-Buttons** im Modal-Footer.
- **Live-Preview** aktualisiert sich nach Save.

Implementierung — zwei Mechanismen parallel:
1. `setConfigProperty("basemap", "lightPreset", …)` und
   `setConfigProperty("basemap", "showXxxLabels", …)` für die
   Mapbox-Standard-Style-Familie.
2. Layer-ID-Heuristik (Layer-Namen mit `admin*`/`road*`/`poi*`/
   `transit*`/`place*` matchen + `setLayoutProperty("visibility",
   …)`) für die klassischen `streets-v12`/`outdoors-v12`/`light-v11`/
   `dark-v11`-Stile.

Bei einem Style-Typ ist der jeweils andere Mechanismus No-Op (try/catch).

### Geändert (UI: hide_labels-Checkbox entfernt — durch Modal ersetzt)

Die einzelne „Karte ohne Beschriftungen"-Checkbox aus v0.4.4/v0.4.5
ist weg. Das Karten-Feinabstimmung-Modal ist feiner und kann das
Gleiche plus mehr. `hide_labels`-Feld in den Configs bleibt für
Backwards-Compatibility mit alten settings.json — wenn gesetzt,
werden alle 4 `show_*_labels` auf False gezwungen.

### Technisch

- Neue Bridge-Param-Felder: `light_preset`, `show_place_labels`,
  `show_road_labels`, `show_poi_labels`, `show_transit_labels`,
  `show_admin_boundaries`. Defaults: `"day"` + alle True.
- `AnimatorConfig` und `TourmapConfig` haben identische Field-Sätze.
- Settings-Persistenz: alle 6 Felder pro Modul-Subkey in
  `settings.json` (`animator.*` + `tourmap.*`).
- `openMapConfigModal(moduleKey, onApply)` in `ui/js/util.js` —
  zentrale Funktion, von beiden Modulen genutzt.
- i18n DE/EN/ES für `map_config.*` Keys.

## [0.4.5] – 2026-05-21 21:20

### Behoben (Karte ohne Beschriftungen wirkt jetzt auch auf Standard-Satellite)

Marc-Test direkt nach v0.4.4-Release:
> „ohne beschriftung kommt mal wieder nicht in der vorschau"

Ursache: Mapbox-GL JS 3.x mischt zwei Style-Architekturen.
- **Standard-Styles** (`mapbox://styles/mapbox/standard-satellite`,
  unser Default!) nutzen das neue „Style Fragments"-System. Die
  Beschriftungen liegen im importierten `basemap`-Fragment und
  sind NICHT als Top-Level-Layer in `map.getStyle().layers` zu sehen.
  Mein `setLayoutProperty(id, 'visibility', 'none')`-Trick aus v0.4.4
  fand also gar keine Symbol-Layer zum togglen — daher keine Wirkung
  in der Vorschau.
- **Klassische Styles** (`streets-v12`, `outdoors-v12`, `light-v11`,
  `dark-v11`, `satellite-streets-v12`) haben Symbol-Layer top-level
  und ließen sich mit dem v0.4.4-Code korrekt togglen.

Fix: **beide Mechanismen parallel** anwenden — die jeweils
andere Variante ist No-Op auf dem jeweils anderen Style-Typ.

```js
// 1) Standard-Style: Config-Properties am basemap-Fragment
['showPlaceLabels','showRoadLabels','showPointOfInterestLabels',
 'showTransitLabels'].forEach(k => {
  try { map.setConfigProperty('basemap', k, !want); } catch(_){}
});
// 2) Klassische Styles: Symbol-Layer Visibility
map.getStyle().layers.forEach(l => {
  if (l.type === 'symbol') {
    try { map.setLayoutProperty(l.id, 'visibility',
        want ? 'none' : 'visible'); } catch(_){}
  }
});
```

Geändert an 4 Stellen, beide Mechanismen jeweils:
- `modules/animator/ui/module.js` → `applyHideLabels()` (Live-Preview)
- `modules/tourmap/ui/module.js` → `applyHideLabels()` (Live-Preview)
- `core/animator.py` → `_make_html` Render-HTML
- `core/tourmap.py` → `_render_html` Render-HTML

## [0.4.4] – 2026-05-21 21:04

### Hinzugefügt (Karte ohne Beschriftungen — Bug-Report/Feature-Request Beta-Tester)

Beta-Tester nach v0.4.3-Test:
> „Hast du auch Einfluß auf das Kartenmaterial, wenn ja eine Karte ohne
> Schriften wie Ortschaften oder Straßennamen wär doch auch schön."

Klassischer Outdoor-Animations-Wunsch — Karte als reiner Hintergrund,
ohne ablenkende Texte. Implementiert über Mapbox-Style-Layer:

- **Neue Checkbox „Karte ohne Beschriftungen"** in der Karten-Sektion
  von **Animator UND Tour-Map**.
- **Technik**: nach jedem `style.load`-Event werden alle Style-Layer
  vom Typ `symbol` (Texte + Icons + POI-Beschriftungen) per
  `setLayoutProperty(id, 'visibility', 'none')` ausgeblendet.
  Gilt für alle Mapbox-Stile gleichermaßen.
- **Live-Preview**: beim Toggle der Checkbox sind die Beschriftungen
  sofort weg/da — keine erneute Render-Vorschau nötig.
- **Robust gegen Style-Wechsel**: `rebuildPreviewLayers()` ruft jetzt
  auch `applyHideLabels()` auf, sodass beim Style-Switch (z.B.
  Satellite → Outdoor) die Beschriftungen weiter ausgeblendet
  bleiben.
- **Backend-Pfad**: in `_make_html` (Animator) und `_render_html`
  (Tour-Map) wird der gleiche JS-Snippet im `style.load`-Callback
  ausgespielt. Beim Headless-Chromium-Render greift derselbe
  Mapbox-Visibility-Mechanismus.
- **Bridge**: `animator_start_render` und `tourmap_render` schleifen
  den neuen `hide_labels: bool`-Parameter durch.
- **AnimatorConfig + TourmapConfig**: Felder `hide_labels: bool = False`.
- **Settings-Persistenz**: `animator.hide_labels` + `tourmap.hide_labels`
  in `settings.json` gespeichert.
- i18n DE/EN/ES für `animator.toggle.hide_labels` + Tooltip.

### Geändert (CI: Smoke-Test bei JEDEM Code-Push — Marc-Forderung, 20:46)
- `release.yml`-Trigger erweitert: läuft jetzt nicht mehr nur bei
  `git tag v*`, sondern auch bei jedem `push` auf `main` **wenn
  App-Code geändert wurde** (Path-Filter: `app.py`, `core/`,
  `modules/`, `ui/`, `i18n/`, `assets/`, `requirements.txt`,
  `*.spec`, `installer/`, eigene Workflow-Files). Reine Doku-
  Pushes (nur `docs/` oder `*.md`) triggern bewusst NICHTS —
  spart CI-Minuten.
- `release`-Job bleibt `if: startsWith(github.ref, 'refs/tags/v')`
  → publiziert immer noch nur bei expliziten Tag-Pushes, kein
  versehentliches Release durch Code-Push.
- `test-windows-install.yml`: lädt jetzt das Build-Artifact aus
  dem konkreten Workflow-Run, nicht mehr das letzte GitHub-Release
  — damit funktioniert der Smoke-Test auch bei main-Push-Builds
  (vor denen es noch kein Release gibt) und nicht nur bei Tag-Builds.
- Marc bekommt damit nach JEDER Code-Änderung eine
  Bestätigung, dass die App auf echter Windows-VM startet —
  nicht erst beim nächsten Release-Tag.

## [0.4.3] – 2026-05-21 20:31

### Behoben (Cross-Platform App-Support-Pfade)

Bei der Implementierung des Windows-Install-CI-Smoke-Tests (s.u.)
fiel auf: die App nutzte auf ALLEN Plattformen den macOS-Pfad
`~/Library/Application Support/Reisezoom GPS Studio/`. Auf Windows
landete das daher unter `C:\Users\<name>\Library\Application Support\…`
— funktional, aber nicht Windows-konform. Endnutzer hätten ihre
Settings nicht da gefunden wo sie auf Windows üblicherweise sind.

Jetzt sauberer Standard-Pfad pro OS via neuer Helper-Funktion
`_app_support_dir()` in `app.py`:
- macOS:   `~/Library/Application Support/Reisezoom GPS Studio/` (unverändert)
- Windows: `%APPDATA%\Reisezoom GPS Studio\` (= `~/AppData/Roaming/…`)
- Linux:   `~/.local/share/Reisezoom GPS Studio/` (XDG-Standard)

**Migration für existierende Windows/Linux-User:** keine. Die alten
Pfade `~/Library/Application Support/Reisezoom GPS Studio/` werden
nicht mehr gelesen. Settings, Renders und Logs sind ab v0.4.3 an
einem neuen Ort. Im Praxis ist das egal — der Tester-Pool für Win/Linux
war zum Zeitpunkt des Releases noch sehr klein (Beta-Tester hat es noch
nicht zum Laufen bekommen).

### Hinzugefügt (CI-Smoke-Test des Windows-Installers)

Neuer Workflow `.github/workflows/test-windows-install.yml`. Läuft
nach jedem `Build & Release`-Workflow oder manuell:
1. Lädt die neueste `*-windows-setup.exe` aus dem GitHub-Release
2. Installiert silent in `C:\Program Files\Reisezoom GPS Studio\`
3. Prüft dass kritische DLLs vorhanden UND **NICHT** Mark-of-the-Web-
   markiert sind (das war Beta-Testers Crash-Ursache in v0.4.1)
4. Startet die App, wartet 25 s, prüft Process-State + Logdatei
5. Saubere Uninstallation via `unins000.exe /VERYSILENT`

Damit erkennen wir Crash-Regressions auf Windows automatisch, bevor
ein Tester es merkt.

## [0.4.2] – 2026-05-21 20:17

### Hinzugefügt (Mapbox-Kreditkarten-Hinweis in der App, 20:17)

- Marc-Feedback (nach Beta-Testers Mail): "Füge den Hinweis mit der
  Kreditkarte bei der Mapbox-Anleitung ein, sag aber, dass es bis
  50.000 nix kostet und dass das wirklich lange reicht."
- Neuer i18n-Key `mapbox_help.cc_info` (DE/EN/ES) — orangener
  Hinweis-Block mit ⚠️-Icon: *Mapbox verlangt seit Mitte 2026 eine
  Kreditkarte bei der Registrierung, auch fürs kostenlose Konto.
  Es wird nichts abgebucht solange du im Free-Tier bleibst.*
- `mapbox_help.tier_info` umformuliert — klarere Sprache: *50.000
  Karten-Loads pro Monat, kostenlos. Bei normaler Hobby-Nutzung
  wirst du nie eine Rechnung sehen — du müsstest schon richtig
  intensiv produzieren um an die Grenze zu kommen.*
- `openMapboxHelpModal()` in `ui/js/app.js`: cc_info als
  prominenter Orangener-Border-Block ZWISCHEN intro und der
  step-Liste (statt am Ende vergraben).
- First-Run-Modal: cc_info + tier_info beide DIRECT unter dem
  Token-Option-Titel, sodass User es liest BEVOR er sich
  bei Mapbox registriert.
- `docs/USER_GUIDE.md` analog: ⚠️-Block für Kreditkarte +
  💡-Block für Free-Tier-Klarstellung.

### Behoben (Inno-Setup-Skript-Fix, 20:05)
- v0.4.1-Build ist im CI gescheitert: `SignTool=` (leerer Wert) ist
  in Inno Setup ungültig. Direktive komplett weggelassen — wir
  haben keine Code-Signatur, brauchen die Direktive also gar nicht.
- v0.4.1-Tag bleibt unrelased im Git als „verbrannte" Versionsnummer,
  v0.4.2 ist der eigentliche Installer-Release.

### Hinzugefügt (Windows-Installer statt nur ZIP — Bug-Report Beta-Tester)

Beta-Tester meldete: ZIP-Download entpackt, doppelgeklickt,
sofort Crash mit `RuntimeError: Failed to resolve Python.Runtime.Loader.
Initialize from G:\…\Python.Runtime.dll`. Ursache: **Mark of the Web**
— Windows markiert alle Dateien aus einem aus dem Internet entpackten
ZIP mit einem Quarantäne-Stream. Bei nativen DLLs (pythonnet) blockiert
das den Load.

Workaround wäre PowerShell `Get-ChildItem … | Unblock-File` gewesen,
das ist aber inakzeptabel für Endnutzer. Drum: echter Installer.

- **Neuer Windows-Installer** (`ReisezoomGPSStudio-windows-setup.exe`,
  ~85 MB):
  - Setup-Wizard in Deutsch/Englisch (Inno Setup 6, modern style)
  - Default-Install-Pfad `C:\Program Files\Reisezoom GPS Studio\`
  - Start-Menü-Shortcut + optionaler Desktop-Shortcut (Checkbox im Wizard)
  - Saubere Uninstaller-Registrierung in der Windows-Systemsteuerung
  - Updates erkennen: gleiche AppId-GUID → bestehende Installation wird
    ersetzt, keine doppelten Einträge
  - **Mark of the Web bleibt nur auf der Setup.exe selbst** —
    die in `Program Files` installierten DLLs sind sauber und laden
    ohne PowerShell-Tricks
- **ZIP-Variante bleibt parallel** (`ReisezoomGPSStudio-windows.zip`)
  als Portable-Alternative für User, die nicht installieren wollen.
  Im Blogpost wird der Installer als empfohlener Weg präsentiert,
  ZIP als „Portable-Variante" daneben.
- Neue Datei `installer/windows_setup.iss` — Inno-Setup-Skript mit
  AppId-GUID, Version-Define aus `app.py.APP_VERSION` (single source
  of truth), Compression `lzma2/ultra64`.
- `.github/workflows/release.yml` erweitert: nach PyInstaller-Build
  läuft `ISCC.exe` und schreibt den Installer ins selbe `dist/`-Verz.
  Beide Artefakte (ZIP + setup.exe) landen im GitHub-Release.
- `scripts/deploy_release.sh` lädt zusätzlich die Setup.exe atomar
  hoch (analog zu DMG/ZIP/tar.gz/changelog.html — `put → mv`-Pattern).
  Smoke-Test geht durch alle 5 URLs.
- **Keine Code-Signatur** — wir haben keinen EV-Cert ($200-500/Jahr).
  SmartScreen zeigt beim ersten Installer-Start „Unbekannter
  Herausgeber" → User klickt „Weitere Informationen → Trotzdem
  ausführen". Sobald genug User das machen, lernt SmartScreen die
  EXE als vertrauenswürdig.

### Hinzugefügt (`assets/icon.ico` für Windows-Icon)

Erstmals eine echte `.ico`-Datei statt nur `.icns`/`.png`. Brauchten
wir für:
- PyInstaller-EXE-Icon (war vorher Default-Python-Icon)
- Inno-Setup-Installer-Icon
Generiert aus `icon_1024.png` mit Pillow, enthält die Größen
16/24/32/48/64/128/256 für die verschiedenen Windows-Kontexte
(Taskbar, Desktop, Datei-Manager).

## [0.4.0] – 2026-05-21 17:30

### Geändert (Track-Punkte: Dropdown → Slider mit Live-Preview, 17:30)

- Vorher: Dropdown mit 4 Stufen (low/medium/high/max), kein visuelles
  Feedback in der Preview. Marc-Feedback: „Mach Track-Glätte anders.
  Geh davon aus was man hat … und dann kann man auf einem Slider
  runterziehen und reduzieren. Der Track verändert sich dann live in
  der Preview."
- Jetzt:
  - **Slider** statt Dropdown, Range = `10` bis `n_points` (Original-
    Anzahl aus dem GPX). Default rechts = volle Anzahl (keine
    Reduktion).
  - **Label live**: „Track-Punkte: 250 / 470" — User sieht direkt
    wie viel reduziert wurde.
  - **Live-Preview**: bei jedem Slider-`input`-Event wird `preview-track`
    auf das resampelte Coord-Array umgeschaltet (`setData(...)`).
    User sieht in Echtzeit wie eckig oder rund die Linie wird.
  - **Backend**: `AnimatorConfig.point_density: str` ersetzt durch
    `point_count: int` (0 = alle Punkte, sonst exakte Zahl).
    Bridge `animator_start_render` mapped den Slider-Wert ehrlich
    durch — bei voller Position wird 0 gesendet (= keine Reduktion,
    schneller Render-Pfad ohne Downsample-Call).
  - **Slider deaktiviert** wenn kein GPX geladen oder Track <20
    Punkte (sonst wäre der Slider quatsch).
  - **Workspace-Clear** resettet Slider auf disabled „— / —".
- Settings-Persistenz für `point_count` bewusst NICHT — die absolute
  Punkte-Anzahl ist je Track unterschiedlich; ein gespeicherter
  Wert von „50" wäre bei einem 5000-Punkte-Track sinnvoll und bei
  einem 80-Punkte-Track sinnlos. Default „alle Punkte" passt immer.
- i18n DE/EN/ES für `animator.field.point_count` + `point_count.hint`,
  alte `animator.density.*`-Strings entfernt.

### Hinzugefügt (Live-Preview-Sync: Schatten + Alpha-Modus, 17:30)
- Die Mapbox-Animator-Vorschau war bisher „nicht ahnungsvoll" über die
  neuen Schatten- und Alpha-Modus-Settings. Marc hat im Test reported:
  „alles was du eingebaut hast wirkt sich bis jetzt nicht auf die preview
  aus". Behoben:
- **Schatten in der Vorschau**: neue `preview-shadow`-Mapbox-Layer wird
  parallel zu `preview-glow`/`preview-line` gerendert. Sichtbar gemacht
  per `setLayoutProperty("visibility", ...)` basierend auf der
  Checkbox + Slider — auf Toggle/Drag live aktualisiert.
- **Alpha-Modus in der Vorschau**: neue `alpha-bg`-Background-Layer wird
  ZWISCHEN Karten-Tiles und Track-Layer eingefügt (Mapbox `beforeId:
  "preview-shadow"`). Karte wird dunkel überdeckt, Track + Punkt
  bleiben sichtbar — visuelles Feedback dass der Render ohne Karte
  läuft.
- **Hint-Banner** oben in der Mitte des Canvas, in Akzent-Orange,
  sichtbar nur bei aktivem Alpha-Modus. Text DE/EN/ES.
- Neue JS-Helpers: `currentShadowEnabled()`, `currentShadowStrength()`,
  `currentAlphaEnabled()`, `applyShadowToLayers()`, `applyAlphaPreview()`.
- `rebuildPreviewLayers()` ruft beide neuen Apply-Functions am Ende auf —
  wichtig nach Style-Wechsel (`map.setStyle()`) damit der Schatten-Layer
  und Alpha-BG nicht verlorengehen.

### Hinzugefügt (User-facing Changelog-Seite — Marc-Workflow-Wunsch)

- Neue Datei `docs/CHANGELOG.html` — eine schlanke, schöne, auf
  Endnutzer zugeschnittene HTML-Variante des Changelogs im
  Reisezoom-Stil (weiß, sans-serif, Akzent-Orange `#ff6b35`).
- **Pflege-Regel**: vor jedem Release-Tag wird oben ein neuer
  `<article class="version latest">`-Block eingefügt; der vorige
  „latest" verliert die `.latest`-Klasse. Pro Version: 1 Tagline +
  1–3 Highlight-Boxen + Standard-Bullets in einfacher Sprache
  (keine Code-Internas).
- **Auto-Deploy via `scripts/deploy_release.sh`**: die HTML wird bei
  jedem `./scripts/deploy_release.sh vX.Y.Z` automatisch zusammen
  mit DMG/ZIP/tar.gz per FTP nach
  `reisezoom.com/downloads/gps-studio/latest/changelog.html`
  hochgeladen (atomic upload analog zu den Binaries — `.upload-tmp`
  → server-side `mv`).
- **Vor-Deploy-Check**: das Skript verifiziert dass der Tag (z.B.
  `v0.4.0`) im HTML auftaucht; wenn nicht, gibt's eine Warnung und
  einen Abbruch-Prompt — verhindert dass Marc mit veralteter
  Changelog deployed.
- Marc verlinkt aus dem Blogpost (`reisezoom.com/reisezoom-gps-studio/`)
  auf die feste URL — die ist nach jedem Deploy automatisch frisch.

### Hinzugefügt (Schlagschatten unter Track — DAU-Feedback Beta-Tester)

- Neue Checkbox „**Schlagschatten unter Track**" in der Karten-Sektion +
  Slider „**Schatten-Stärke**" (0–10 px, Default 4 px).
- **Mapbox-Modus**: separate `track-shadow`-Layer wird VOR `track-glow` ins
  Layer-Stack gepushed. `line-color: rgba(0,0,0,0.55)`, `line-width:
  line_width × 1.6`, `line-blur: shadow_strength`, `line-translate:
  [shadow_strength, shadow_strength]`. **Bewusst kein `z-offset`** —
  bei aktivem Terrain bleibt der Schatten auf dem Boden, während die
  Track-Linie 150 m darüber schwebt. Sieht wie eine echte 3D-Linie aus.
- **Alpha-Modus**: SVG-`<filter>` mit `<feDropShadow>` auf der ganzen
  Track-Gruppe (Glow + Line + Dot). `dx/dy = shadow_strength`,
  `stdDeviation = strength × 0.6`. Respektiert den Alpha-Kanal des
  Inputs → der Schatten kommt im NLE-Composit sauber mit.
- Neue Felder in `AnimatorConfig`: `shadow_enabled: bool = True`,
  `shadow_strength: float = 4.0`. Bridge `animator_start_render`
  durchschleift die Werte.
- i18n DE/EN/ES für `animator.toggle.shadow`, `animator.shadow.tooltip`,
  `animator.field.shadow_strength`.
- Default ist **aktiv** — bei der Default-Stärke (4 px) wirkt der Effekt
  dezent aber sichtbar, ohne aufdringlich zu sein.

### Hinzugefügt (Alpha-Kanal-Render + Punkte-Dichte — DAU-Feedback Beta-Tester)

Beta-Tester (470-Punkte-Tour) hat dreifach Feedback gegeben, das in
diesem Release komplett adressiert wird:

**1. Animation ohne Karte (Alpha-Kanal) — der große Wurf**
- Neue Checkbox „Animation ohne Karte (Alpha-Kanal)" in der neuen Sektion
  **Performance & Output**.
- Aktiviert → rendert NUR Track + Punkt + Stats-Overlays auf
  **transparentem Hintergrund**. Output ist eine **ProRes-4444-.mov**
  statt MP4. Diese lässt sich in Premiere/Final Cut/DaVinci/Resolve direkt
  als Overlay-Layer **über echtes Video** legen — der klassische
  YouTube-Workflow für Outdoor-Tracker-Animationen.
- Backend-Pipeline: separater HTML-Renderer (`_make_html_alpha` in
  `core/animator.py`) ohne Mapbox-Map, projiziert die Bbox aspect-locked
  als SVG. Playwright-Screenshot mit `omit_background=True`, ffmpeg mit
  `-c:v prores_ks -profile:v 4 -pix_fmt yuva444p10le` (10-bit Farbe +
  Alpha, Apple-Vendor-ID `ap10`).
- **Token-frei**: Im Alpha-Modus wird kein Mapbox-Token gebraucht
  (keine Karte). Damit funktioniert das Feature auch für User die noch
  keinen Token konfiguriert haben.
- Im Alpha-Modus werden Karten-Stil, Terrain, Pitch, Bearing und Codec
  ignoriert (würden ohne Karte keinen Sinn ergeben).

**2. Punkte-Dichte (Knotenpunkte reduzieren)**
- Neues Dropdown **„Track-Glätte (Punkte-Dichte)"**:
  - **Niedrig** (100 Punkte) — schnellster Render, gut für Vorschau
  - **Mittel** (250 Punkte) — neuer Default (vorher 500)
  - **Hoch** (500 Punkte) — feinere Kurven, alter Default
  - **Maximum** (alle GPX-Punkte) — kann viele Tausend sein, langsam
- **Default ist jetzt 250 statt 500** — spürbar schneller bei
  unverändertem Track-Erscheinungsbild für normale Touren.
- UI-Hinweis macht klar dass die GPX-Punkt-Anzahl **nicht** der
  Hauptkostentreiber ist (Render-Zeit ≈ Dauer × FPS × Auflösung).

**3. Höhere Auflösung war schon da**
- Default-Auflösung ist seit Langem **3840×2160 (4K)**, Custom bis
  7680×7680. Die UI-Sektion war nur visuell unklar — die neue Sektion
  „Performance & Output" und der explizite Hinweis-Text machen jetzt
  klar wo die Render-Zeit her kommt.

### Geändert
- `AnimatorConfig` um Felder `point_density: str = "medium"` und
  `transparent_background: bool = False` erweitert (Backwards-compatible
  Defaults).
- Bridge `animator_start_render` switcht Output-Endung automatisch auf
  `.mov` wenn `transparent_background=True`, sonst `.mp4`.
- Save-Dialog im Animator-UI bietet bei Alpha-Modus `.mov`-Filter, sonst
  `.mp4` wie bisher.
- Default-Filename beim Save-Dialog hat suffix `_alpha.mov` statt
  `_h264.mp4` wenn Alpha aktiv.

### Tests
- Neuer Smoke-Test `tests/test_animator_alpha.py` — verifiziert dass die
  ProRes-Pipeline durchläuft, Output Alpha-Channel hat (`yuva444p*`),
  Codec `prores` und Frame-Count stimmt. Läuft ohne Mapbox-Token und
  unter 10 Sekunden bei 640×360 / 2s / 24fps.
- `tests/test_animator_render.py`: Token-Import-Pfad gefixt
  (`MAPBOX_TOKEN` aus app.py → `_active_mapbox_token()`). Aus der CLI
  noch nicht voll funktional ohne app-support-settings — Folge-Task
  ist gespawned.

## [0.3.4] – 2026-05-21

### Hinzugefügt (OS im Logfile + Bug-Report)
- App-Start-Log enthält jetzt **eine OS-Zeile direkt nach der Logfile-
  Pfad-Zeile**, mit Format passend zur Plattform:
  - `macOS 14.6.1 (arm64) · Darwin 23.6.0`
  - `Windows 11 (AMD64) · build 22631`
  - `Linux Ubuntu 22.04 (x86_64) · kernel 5.15.0-91-generic`
- **Neue Public-Function `core/logger.get_os_label()`** — wird auch vom
  Bug-Report-Body (`prepare_bug_report`) genutzt, sodass beide Stellen
  konsistent das selbe Label zeigen.
- Bei Bug-Reports der Tester sieht Marc damit auf einen Blick welches
  System läuft (vorher: nur `Darwin 24` oder `Windows 10` — uninformativ).

## [0.3.3] – 2026-05-21

### Geändert (Bug-Report: Copy-Modal statt direkt mailto)
- Vorher öffnete der „📧 An Marc senden"-Button direkt einen `mailto:`-
  Link → funktioniert nur für User mit lokalem Mail-Programm. Marc selbst
  (und vermutlich ein Großteil der User) nutzt aber Webmail im Browser.
- Jetzt öffnet sich ein **Bug-Report-Modal** mit:
  - Empfänger (`marc@reisezoom.com`) + Copy-Button
  - Betreff + Copy-Button
  - Nachricht (Textarea mit dem fertigen Body inkl. App-Version, OS,
    Python und Log-Auszug) + Copy-Button
  - „✓ Kopiert"-Feedback nach Klick
- Optional unten links: „📧 Lokales Mail-Programm öffnen" — für die User
  die's haben (öffnet weiterhin `mailto:`)
- Bridge `send_bug_report` umbenannt zu `prepare_bug_report` (returnt
  jetzt `{ok, to, subject, body, mailto}` statt selber zu öffnen)
- Neue util.js-Funktion `openBugReportModal(context)` — wird vom
  Crash-Modal + vom Hilfe-Eintrag aufgerufen
- i18n DE/EN/ES für `bugreport.*`

## [0.3.2] – 2026-05-21

### Beta-Tester-Feedback (Beta-Tester): ffmpeg-Setup + fehlende FPS-Option

### Hinzugefügt (ffmpeg out-of-the-box — keine Installation nötig)
- **`imageio-ffmpeg`** als neue Dependency: liefert ein statisch gelinktes
  ffmpeg-Binary, das PyInstaller automatisch ins Bundle einbackt.
- `core/animator.py.find_ffmpeg()` sucht jetzt in dieser Reihenfolge:
  1. System-PATH (`shutil.which`)
  2. Typische Pfade (Homebrew, /usr/local, /usr/bin, C:\Program Files\ffmpeg)
  3. **Gebündeltes Binary aus imageio-ffmpeg** — Stufe 4 als Fallback
- App-Bundle ist von 166 MB auf ~213 MB gewachsen (+47 MB für das Binary).
  Im Gegenzug: Endnutzer müssen nichts mehr installieren.
- DAU-Feedback aus der ersten Beta hatte explizit gefragt: „wie installiere
  ich ffmpeg" — das ist jetzt obsolet.

### Hinzugefügt (FPS 25 — PAL-Standard)
- FPS-Dropdown im Animator hatte 24/30/50/60 — fehlte 25 (PAL-Europa-TV).
- Neue Auswahl: **24 (Kino) · 25 (PAL) · 30 · 50 (PAL HFR) · 60**.
- Beschriftungen helfen DAUs zu verstehen welcher Wert für was gut ist.

### Hinzugefügt (Crash-Modal: „📧 An Marc senden"-Button)
- Im Render-Fehler-Modal jetzt ein primärer Button der das Default-
  Mail-Programm mit vorbefüllter Bug-Report-Mail an `marc@reisezoom.com`
  öffnet. Body enthält:
  - App-Version, OS-Label, Python-Version
  - Letzte ~3 KB des App-Logs
  - Platzhalter „[hier deinen Text einfügen]" für die User-Beschreibung
- User muss nur etwas schreiben und „Senden" drücken — kein Logfile-Suchen,
  kein manuelles Copy-Paste.
- mailto-URL wird auf ~7,5 KB gecappt (manche Mail-Clients haben Längen-Limits);
  bei längerem Log gibt's eine Kurz-Variante mit Hinweis auf den Log-Pfad.
- Auch ein **Hilfe → „Feedback / Bug-Report an Marc"**-Eintrag öffnet das
  gleiche mailto, ohne dass ein Crash vorausgegangen ist.
- **Neuer Bridge-Endpoint**: `send_bug_report(context)`.
- i18n DE/EN/ES für `common.report_to_marc` + `help.feedback.*`.

## [0.3.1] – 2026-05-21

### Geändert (Reset-Button → „Workspace leeren" statt Settings-Reset)
- Der ↺-Button in jedem Modul setzt jetzt nur die **geladenen Daten** zurück
  (GPX, Fotos, Track-Preview, Marker), **nicht** die Settings.
- **Settings wie Mapbox-Token, Map-Style, Pitch, Padding, Codec etc.
  bleiben unverändert** — User muss sie nicht jedes Mal neu konfigurieren.
- **Animator + Tour-Map**: Track-Layer von der Map entfernt, Bbox-State
  geleert, Header-Stats zurück auf „Empty"-Hinweis, Render-Button disabled,
  Karte zurück auf Welt-Sicht. Kein App-Reload mehr nötig.
- **Geotagger**: zusätzlich Backend-Bridge `geotagger_clear()` cleart
  Track + Stats + Foto-Liste im Python-State. Frontend räumt Marker,
  Photo-Grid, Match-Summary, Selection.
- **Neuer Helper**: `confirmClearWorkspace(name, onConfirm)` in `util.js`
  — kapselt das Confirm-Modal, die Cleanup-Logik bleibt modul-lokal.
- Bridge `settings_reset_module` bleibt drin für mögliche zukünftige
  „Settings-Reset"-Funktion, wird aber vom Button nicht mehr aufgerufen.
- i18n DE/EN/ES: `common.reset_module.*` → `common.clear_workspace.*`.

## [0.3.0] – 2026-05-21

### Hinzugefügt (Reset-Button pro Modul)
- Jedes Modul (Animator, Tour-Map, Geotagger) hat jetzt einen dezenten
  „↺ Modul zurücksetzen"-Button am Ende des Settings-Panels.
- Confirm-Modal mit Modul-Name → setzt `settings.json[<slug>]` auf
  `DEFAULT_SETTINGS[<slug>]` → reloaded die App damit alle Bindings
  frische Werte ziehen.
- **Neuer Bridge-Endpoint**: `settings_reset_module(module_slug)`.
- **Neuer Helper** in `util.js`: `resetModuleSettings(slug, name)` —
  zeigt das Confirm-Modal, ruft die Bridge, triggert den Reload.
- CSS: neue Klasse `.btn-subtle` für sekundäre Aktionen (dezenter Border,
  gedämpfter Text, nicht akzentfarben).
- i18n DE/EN/ES für `common.reset_module.*`.

### Geändert (About-Modal: Tagline + größeres Logo)
- Logo zentral oben, **128×128 px** statt 72×72 inline. Dadurch wirkt
  das App-Icon deutlich präsenter.
- **Tagline geändert**: aus „Gebaut für Outdoor-YouTuber" wird
  „**Gebaut von Marc Arzt und Claude Code**" als separate Credits-Zeile
  in vollem Text-Kontrast.
- Tagline-Text selbst aktualisiert: „Native macOS-Suite" →
  „Native Cross-Plattform-Suite" (passt jetzt mit den Win/Linux-Builds).
- Layout zentriert statt links-bündig — wirkt wie ein klassisches
  „About"-Fenster.
- i18n DE/EN/ES für `about.credits`.

### Hinzugefügt (macOS-Menü: Reisezoom → Blog + YouTube)
- Im Reisezoom-Menü (oben links neben Apple-Logo) gibt's jetzt unter
  „Einstellungen…" zwei neue Einträge:
  - **🌐 Blog (reisezoom.com)** → öffnet `https://reisezoom.com`
  - **▶ YouTube-Kanal** → öffnet `https://www.youtube.com/@reisezoom`
- Beide nutzen die bestehende `open_url`-Bridge → öffnen im
  System-Default-Browser, nicht in der App.
- i18n DE/EN/ES für `menu.blog` + `menu.youtube`.

## [0.2.5] – 2026-05-20

### Geändert (Animator: Save-Dialog vor Render — analog Tour-Map)
- Render-Klick öffnet jetzt einen nativen Save-As-Dialog (NSSavePanel
  auf macOS) für den MP4-Output. User wählt Ordner + Dateinamen frei.
- **Default-Name**: `<gpx-stem>_<W>x<H>_<codec>.mp4` (z.B.
  `Oderlandweg_3840x2160_h265.mp4`) — Format und Codec direkt im Namen
- **Last-Save-Dir** wird in `settings.json` unter `animator.last_save_dir`
  persistiert — beim nächsten Render landet der Dialog wieder dort
- Cancel im Dialog = kein Render läuft (spart 5-15 Min Render-Zeit wenn
  man es sich anders überlegt)
- `.mp4`-Endung wird erzwungen falls User sie im Dialog rauslöscht
- Bestehender Bridge-Endpoint `pick_save_path()` wird wiederverwendet

## [0.2.4] – 2026-05-20

### Behoben (Pitch/Bearing-Slider warf manuelle Pan-Position zurück)
- Mit dem letzten WYSIWYG-Fix triggerten Pitch/Bearing-Slider einen
  `fitTrackPreview(false)` → die Map sprang auf die Bbox-Mitte zurück
  und überschrieb was der User manuell gepant hatte.
- **Fix**: Pitch/Bearing-Slider rufen jetzt nur noch `setPitch()` /
  `setBearing()` ohne Refit. Die manuelle Pan-Position bleibt erhalten.
  WYSIWYG ist trotzdem gesichert, weil der Render mit
  `override_center`+`override_zoom` aus dem aktuellen Preview-State läuft
  (Mapbox berechnet im Render nicht selbständig neuen Zoom).
- **Animator: neuer `⤢ Auf Track zoomen`-Button** unten rechts — analog
  zur Tour-Map. Wenn der User manuell pant und wieder auf den
  Track-Extent fitten will, ein Klick reicht. Format-Wechsel (W/H)
  fittet weiterhin automatisch (Aspect-Ratio-Änderung rechtfertigt
  einen Refit).

## [0.2.3] – 2026-05-20

### Behoben (Animator: Bearing-Sweep wirkte wie "erst am Ende")
- Während der Track-Anim-Phase rotierte die Kamera mit
  `rotation/anim_duration` °/s. Während der Hold-Phase rotierte sie mit
  HARDCODED `+3°/hold_duration` °/s — komplett unabhängig vom User-
  Rotation-Wert. Bei niedrigen Rotation-Werten (z.B. 2°) war die
  Hold-Sweep-Geschwindigkeit 3-5× höher als die Anim-Sweep-Geschwindigkeit
  → es wirkte als ob die Kamera erst nach dem Track-Ende anfängt zu
  schwenken.
- **Fix**: Bearing-Sweep läuft jetzt **gleichmäßig** über die gesamte
  Video-Länge (anim + hold). User-Rotation-Wert = Gesamt-Sweep. Damit ist
  die Rotations-Geschwindigkeit konstant von Start bis Ende → die Kamera
  schwenkt durchgehend ohne sichtbaren Übergangs-Sprung.

## [0.2.2] – 2026-05-20

### Behoben (User-Pan/Zoom in der Preview wurde beim Render ignoriert)
- Render rief immer Mapbox's `fitBounds(bbox)` auf — egal wie der User
  die Preview-Map verschoben oder gezoomt hatte. Track landete im Render
  wieder in der Mitte.
- **Fix**: Frontend snapshot't `map.getCenter()`, `map.getZoom()`,
  `map.getPitch()` (+ `map.getBearing()` bei Tour-Map) zum Render-Klick-
  Zeitpunkt und schickt sie als `override_center`/`override_zoom` an die
  Bridge.
- **Backend** (`core/tourmap.py` + `core/animator.py`) hat neue optionale
  Config-Felder `override_center` + `override_zoom`. Sind sie gesetzt,
  baut die Headless-Page die Mapbox-Map mit `center+zoom` statt mit
  `bounds + fitBoundsOptions`. Ergebnis: Render zeigt **exakt** den
  Ausschnitt aus der Preview — User-Pan/Zoom wird respektiert.
- Default-Verhalten (kein Override) bleibt unverändert: Bbox-Fit mit
  Padding-Slider. Wenn ein User die Map nicht angefasst hat, kommt
  trotzdem der saubere zentrierte Track raus.

### Behoben (Preview-Zoom falsch nach Pitch-Slider-Änderung)
- Pitch/Bearing-Slider triggerte nur `setPitch()`/`setBearing()` — **kein**
  Refit. Mapbox's `fitBounds()` berechnet den Zoom-Level abhängig von der
  Kamera-Geometrie: höherer Pitch = höherer Zoom passt rein. Ohne Refit
  zeigte die Vorschau bei pitch=52° denselben Zoom wie bei pitch=0° → die
  Bbox wurde visuell kleiner.
- Der Render rief `fitBounds()` mit dem aktuellen Pitch → höherer Zoom →
  „viel näher dran" als die Vorschau.
- **Fix**: Pitch/Bearing-Slider rufen jetzt `fitTrackPreview(false)`
  bzw. `fitTrackToView(false)` — instant ohne easeTo-Jitter beim Sliden.
  Sobald GPX geladen ist, bleibt der Track immer im Frame.
- **Bonus Animator**: `fitTrackPreview()` nutzt jetzt das **End-Bearing**
  (`-10 + rotation`) statt hardcoded `-10`. So sieht der User in der
  Vorschau wo die Kamera am Ende der Animation landet.

### Geändert (Overlay-Preview echt 1:1 zur Render-Auflösung)
- Bisheriges Preview-Overlay hatte eigene CSS-Werte (10px padding, 14px
  font, 100px elevation-box-height usw.) — kleiner als der Render
  (18px padding, 22px font, 170px elevation-box-height). Beim Wechsel
  zwischen Formaten (z.B. 4K↕ vs Shorts) sahen die Boxen in der Vorschau
  anders aus als im Render.
- **Fix**: Overlay-Preview-Layer wird in JS jetzt auf **Render-Pixel-
  Größe** gesetzt (`width: 1920px; height: 1080px;` z.B.) und per
  `transform: scale(letterbox_w / render_w)` auf die Letterbox-Größe
  verkleinert. `transform-origin: top left` damit Positionen stimmen.
- **CSS-Werte für Preview-Overlay** komplett auf Render-Werte angeglichen
  (Padding, Font-Größen, Position-Insets `top: 40px` etc., Höhenprofil-
  Höhe 170px, Eck-Boxen-Breite 480px).
- Resultat: Stats-Boxen + Höhenprofil sehen in der Vorschau exakt so aus
  wie im PNG/MP4 — egal bei welcher Auflösung.

### Geändert (Animator: Letterbox-Viewport für echtes WYSIWYG)
- Bisher hatte das Animator-Preview-Canvas eine andere Aspect-Ratio als
  die Render-Auflösung. Mapbox's `fitBounds()` rechnet Zoom-Level aus
  Viewport-Pixeln → identische Padding-Proportion ergibt nur dann den
  selben Zoom, wenn auch die Aspect-Ratio gleich ist. Resultat: Preview
  zeigte weiter rausgezoomt als der Render.
- **Fix**: Letterbox-Viewport `.animator-viewport` analog zur Tour-Map.
  JS dimensioniert den Viewport live auf die gewählte Render-Auflösung
  (16:9 / 9:16 / 4K↕ / 1080↕ / Custom). Drumrum schwarzer Off-Canvas-
  Rand. Format-Wechsel rotiert den Vorschau-Rahmen sofort.
- `updateAnimatorViewport()` getriggert von:
  - Mount (initial)
  - W/H-Input-Change (manuell oder via Resolution-Preset-Click)
  - ResizeObserver auf der Canvas-Section
- `fitTrackPreview()` nutzt jetzt den Letterbox-Viewport für die
  Padding-Berechnung statt `#map-canvas`. Resultat: identischer Zoom
  wie der Render bei gleicher 8 %-Padding-Formel.
- **Resolution-Badge** unten links zeigt aktuelles Format permanent
  (`1920×1080 · 16:9`).

### Behoben (Animator: Render-Crash „Invalid LngLat object: (NaN, …)")
- Im bounds-Fit-Refactor hatte sich ein **Python-Tupel-Parsing-Bug**
  eingeschlichen:
  ```python
  center = view.get("center") if isinstance(view, dict) else (bbox[0]+bbox[2])/2, (bbox[1]+bbox[3])/2
  ```
  Python parst das als `center = (<if-expression>, <expr>)` — also als
  Tupel `(<list>, <float>)` statt nur `<list>`. `center[0]` war damit das
  ganze Lon/Lat-Array statt einer einzigen Zahl → in `advanceFrame()`
  als ersten setCenter-Arg übergeben → `NaN`.
- Log-Beweis: `center=([14.008..., 52.7597...], 52.7596) zoom=11.36`
- Fix: ordentlicher `if/else`-Block + Sanity-Check ob `center` wirklich
  `[lon, lat]` ist (defensive Fallback auf Bbox-Midpoint falls Mapbox
  was Unerwartetes liefert).

## [0.2.1] – 2026-05-20

### Behoben (Windows-CI: UnicodeEncodeError beim User-Guide-Build)
- `scripts/build_user_guide_html.py` crashte auf Windows-Runner mit
  `UnicodeEncodeError: 'charmap' codec can't encode character '✅'`
  beim `print("✅ …")`. Windows-Default-Console-Encoding ist cp1252.
- **Fix Script-seitig**: `sys.stdout.reconfigure(encoding="utf-8")` ganz
  am Anfang. Funktioniert auf allen Plattformen, ist auf Unix ein No-Op.
- **Fix Workflow-seitig** (defensiv): `PYTHONIOENCODING=utf-8` und
  `PYTHONUTF8=1` als globale env-Vars in `.github/workflows/release.yml`
  — falls weitere Python-Scripts in CI Emojis printen.
- macOS + Linux Builds liefen schon grün (1m21s / 16m33s), nur Windows
  hängte.

### Behoben (Animator: gleiches Preview≠Render-Mismatch wie Tour-Map)
- Animator hatte das exakt gleiche Problem: Backend nutzte `_bounds_zoom()`
  mit `log2(360/max_diff) + log2(min(w,h)/512) - 0.8`, Frontend nutzte
  `fitBounds` mit hardcoded 60 px Padding. Resultat: leichter Zoom-Versatz
  zwischen Preview und Video.
- **Fix**: Backend's `_make_html()` nutzt jetzt `bounds + fitBoundsOptions`
  im Mapbox-Konstruktor (gleicher Approach wie Tour-Map). Mapbox berechnet
  Center+Zoom intern; nach Map-Idle liest die Headless-Page die Werte
  zurück und schreibt sie in `window._initialCenter` / `_initialZoom`.
  Python ruft `window.getInitialView()` ab Ready-Time auf und füttert
  diese Werte in `advanceFrame()` für jeden Frame (Map bleibt statisch
  im Animator, nur Track + Bearing wachsen).
- **Frontend**: neue Funktion `fitTrackPreview()` nutzt
  `PAD_FACTOR = 0.08` (8% der kürzeren Preview-Achse) — synchron zur
  Konstante in `core/animator.py`.
- **Caveat** (im Code dokumentiert): Animator-Preview hat KEINEN
  Letterbox-Viewport, also kann die Aspect-Ratio von Preview und Render
  abweichen. Der Track ist trotzdem korrekt eingerahmt; Pitch+Bearing-
  Sweep verändern eh permanent die Optik beim Render. Für 1:1-WYSIWYG
  müsste der Animator denselben Letterbox-Viewport bekommen wie die
  Tour-Map — separater Schritt, falls nötig.

### Behoben (Tour-Map: Preview-Zoom ≠ Render-Zoom)
- **Root-Cause**: Preview nutzte `map.fitBounds()` mit dynamischer Pixel-
  Padding-Berechnung, Backend nutzte eine eigene `log2(360/max_diff)`-
  Formel mit konstantem 0.8-Korrektur-Term. Die zwei Mathematik-Pfade
  ergaben unterschiedliche Zoom-Level → Vorschau näher, Render weiter weg.
- **Fix**: Backend (`core/tourmap.py._make_html`) nutzt jetzt Mapbox's
  `bounds` + `fitBoundsOptions`-Konstruktor-Optionen. Mapbox berechnet
  damit Center + Zoom intern — exakt der selbe Algorithmus wie
  `map.fitBounds()` im Frontend.
- **Synchronisierte Padding-Formel**: beide Seiten nutzen jetzt
  `pad_factor = 0.05 + padding_pct/100` (5%–30%), umgerechnet in Pixel
  via `pad_factor * min(viewport-axis)`. Weil Preview-Viewport und
  Render-Viewport die selbe Aspect-Ratio haben (Letterbox), ergibt
  Mapbox bei identischer Padding-Proportion automatisch denselben
  Zoom-Level — Pixelgröße ist egal.
- Resultat: **Preview zeigt jetzt exakt was im PNG landet**.
- `_bounds_zoom_with_padding()` bleibt im Backend für mögliche Fallback-
  Use-Cases drin, wird aber im Hauptpfad nicht mehr aufgerufen.

### Geändert (Tour-Map: Save-Dialog vor Render)
- **Render-Klick öffnet jetzt zuerst einen nativen Save-As-Dialog**
  (`NSSavePanel` auf macOS, `create_file_dialog(SAVE_DIALOG)` als
  Plattform-Fallback). User wählt Ordner + Dateinamen frei — kein
  Auto-Save mehr in `~/Pictures/Reisezoom Tour Maps/`.
- **Default-Name**: `<gpx-stem>_<W>x<H>.png` (z.B. `Oderlandweg_1920x1080.png`)
  — Format direkt im Namen, kein Datums-Suffix.
- **Last-Save-Dir** wird in `settings.json` unter `tourmap.last_save_dir`
  persistiert — beim nächsten Render landet der Dialog wieder dort, nicht
  jedes Mal im Default-Ordner.
- **Cancel im Dialog** = kein Render. Spart Playwright-Boot + Mapbox-Tile-
  Traffic wenn der User es sich anders überlegt.
- **`.png`-Endung wird erzwungen** falls User sie im Dialog löscht.
- **Neuer Bridge-Endpoint**: `pick_save_path(default_name, default_dir, file_types)`.

### Behoben (Tour-Map: Track-Fit funktionierte nicht)
- `currentBbox` war im JS als 4-Element-Array erwartet, das Backend liefert
  aber ein **Dict** `{min_lat, max_lat, min_lon, max_lon}` (gleiche
  Konvention wie der Animator). Mein `bbox.length !== 4`-Check schlug
  immer zu → `computeFitForBbox()` returnte `null` → Map blieb am
  Welt-Default stehen.
- Fix: `_bboxCorners()` erkennt beide Formate (Dict + Array) und gibt
  die Corners als Tupel zurück.
- Bonus: statt eigener Center+Zoom-Formel jetzt direktes
  `map.fitBounds()` mit Pixel-Padding-Skalierung — wie der Animator.
  Vorteil: Mapbox berücksichtigt Pitch/Bearing automatisch beim Fitten,
  der eigene Berechner hätte das nicht.

### Geändert (Tour-Map: echtes WYSIWYG-Preview)
- **Letterbox-Viewport**: Der Vorschau-Bereich zeigt jetzt einen Box mit
  exakt der gewählten Ziel-Aspect-Ratio (16:9 / 9:16 / 1:1 / Custom).
  Drumrum schwarzer Rand — sofort sichtbar, wie das finale PNG croppen
  wird. Aspect-Box passt sich live an wenn der User Width/Height ändert.
- **Backend-Formel im JS**: `computeFitForBbox()` repliziert die genaue
  `_bounds_zoom_with_padding`-Logik aus `core/tourmap.py`. Center + Zoom
  in der Vorschau sind damit **1:1 identisch** mit dem späteren Render —
  was du siehst landet so im PNG.
- **Live-Refit bei jeder relevanten Änderung**:
  - GPX-Load → fittet sofort auf Track-Extent
  - Width/Height-Input oder Preset-Klick → Viewport-Aspekt + Refit
  - Padding-Slider → Refit mit neuem Zoom
  - Section-Resize (Fenster ändern) → ResizeObserver → Refit
- **„⤢ Auf Track zoomen"-Button** schwebt unten rechts — nach manuellem
  Panen ein Klick → zurück auf perfekten Track-Fit.
- **Resolution-Badge** unten links: zeigt permanent `1920×1080 · 16:9`
  o.ä., damit klar ist welches Format gerade aktiv ist.
- ResizeObserver wird beim Modul-Unmount sauber abgemeldet.
- i18n DE/EN/ES für `tourmap.btn.refit`.

### Hinzugefügt (Distribution: DMG + Cross-Platform-CI)
- **`scripts/build_dmg.sh`**: erzeugt einen macOS-DMG-Installer mit
  Drag-to-Applications-Symbol unter `dist/dmg/ReisezoomGPSStudio-vX.Y.dmg`.
  Nutzt `create-dmg` wenn installiert (schickeres Layout), sonst `hdiutil`
  als Fallback. Ad-hoc signiert.
- **GitHub-Actions-Workflow `.github/workflows/release.yml`**: baut bei
  Git-Tag `v*` automatisch macOS-DMG, Windows-Zip + Linux-tar.gz und
  legt ein GitHub-Release mit allen drei Artefakten an. Auch manuell
  über „Run workflow" triggerbar (ohne Release).
- **Spec ist plattform-aware**: Hidden-Imports getrennt nach
  macOS (Cocoa/PyObjC) / Windows (EdgeChromium/clr_loader) / Linux
  (GTK/Qt). `BUNDLE`-Block nur unter macOS. Windows/Linux produzieren
  `dist/ReisezoomGPSStudio/`-Ordner mit Binary für CI-Verpackung.
- **`requirements.txt`** mit `sys_platform`-Markers: PyObjC nur auf
  Darwin, `pywebview[edge]` nur auf Windows, `pywebview[qt]` nur auf Linux.
- **`docs/DISTRIBUTION.md`**: kompletter Guide für lokale Builds +
  CI-Releases + Codesigning-Optionen (Apple Dev Cert / Windows Code Signing).

### Geändert (User-Guide als HTML statt Markdown)
- **`scripts/build_user_guide_html.py`**: Eigener Minimal-Markdown-Parser
  (keine pip-Dependency) konvertiert `docs/USER_GUIDE.md` zu schick
  formatiertem `docs/USER_GUIDE.html` mit eingebettetem Dark-Theme-CSS
  passend zur App-Optik. Header mit App-Icon, Anchor-IDs auf Headings für
  Sprung-Navigation, Code-Blocks mit Mono-Font, Blockquotes mit
  accent-Border. Wird in `build.sh` vor PyInstaller-Run automatisch
  aufgerufen.
- **Bridge `open_user_guide()`** öffnet jetzt `USER_GUIDE.html` im
  Default-Browser (Safari/Chrome/…) statt `.md` im TextEditor. User kann
  die Doku nebenher offen halten.
- **`ReisezoomGPSStudio.spec`** bundelt nur noch die HTML — `.md` ist
  Source, HTML ist Distribution. CHANGELOG.md raus aus dem Bundle.
- **Hilfe-Modal + macOS-Hilfe-Menü**: „Versionsverlauf"-Eintrag entfernt
  (Endnutzer-Doku wird in der HTML behandelt). i18n-Keys
  `menu.changelog` + `help.changelog.*` aus DE/EN/ES gelöscht.

### Hinzugefügt (Hilfe-Menü + Über-Dialog)
- **macOS-Top-Menü `Hilfe`** mit fünf Einträgen: Benutzerhandbuch,
  Versionsverlauf, Mapbox-Token-Anleitung, Logdatei öffnen, Über
  Reisezoom GPS Studio. Labels lokalisiert (DE/EN/ES). Triggert via
  `evaluate_js()` die JS-Wrapper im Frontend.
- **Topbar-Button „?"** (zwischen ⚙ und Version) öffnet das Hilfe-Modal
  inline — selbe fünf Einträge, jeweils als Klick-Karte mit Icon + Titel
  + Kurzbeschreibung. Modale Aktionen rufen die Bridge an.
- **Über-Modal**: App-Icon, Version + Python-Version, Tagline,
  Ausgabe-Pfade (App Support, Tour-Karten, Animator-Renders).
- **Neue Bridge-Endpoints**: `open_user_guide()`, `open_changelog()`,
  `get_app_info()`. `USER_GUIDE.md` und `CHANGELOG.md` werden im
  Bundle via `open <path>` im Standard-MD-Viewer (TextEdit, Marked, …)
  geöffnet. Pfad-Resolution: Bundle-Resources → Source-Tree-Fallback
  für Dev-Modus.
- **`ReisezoomGPSStudio.spec`**: Backt jetzt explizit `docs/USER_GUIDE.md`
  + `CHANGELOG.md` ins Bundle (nicht der ganze docs-Ordner — DEVELOPER.md
  und IDEAS.md bleiben außen vor).
- **App-Version-Konstante** `APP_VERSION = "0.2"` in `app.py` — Topbar +
  Über-Dialog ziehen sie via `get_app_info()`. Bumpen bei jedem Release.
- CSS: `.help-link` + `.help-links` — hover-bare Action-Karten mit Icon
  + Title + Body, accent-Border beim Hovern.

### Hinzugefügt (Modul: Tour-Karten-PNG-Generator)
- **Neues Modul `tourmap`** (Tab „🗺 Tour-Map") für statische Karten-PNG
  aus GPX-Dateien. Anders als der Animator: kein Video, ein einziges
  Frame, optimiert für YouTube-Thumbnails, Komoot-Cover-Bilder,
  Instagram-Posts.
- **Format-Presets**: YouTube 16:9 (1920×1080), 4K, Shorts 9:16
  (1080×1920), Instagram 1:1 (1080×1080), Custom-Eingabe.
- **Settings**: Map-Style (alle 6 Mapbox-Stile), Pitch, Bearing (Rotation),
  Padding (0–25 %), Terrain mit Exaggeration, Track-Farbe + Dicke,
  Start-/End-Pin-Toggle, Stats-Overlays (Totals + Höhenprofil, jeweils
  togglebar + 4-bzw-5-Slot-Position). Live-Vorschau direkt auf der
  Preview-Karte — wie im Animator.
- **Backend** `core/tourmap.py`: `TourmapConfig` + `render_png()`, nutzt
  die gleiche Playwright/Headless-Chromium-Pipeline wie der Animator.
  Komplette Spur wird sofort gezeichnet (kein `advanceFrame`), Screenshot
  als PNG. Ein Render dauert ~3-5 s.
- **Bridge-Endpoints**: `tourmap_load_gpx()`, `tourmap_render()`,
  `tourmap_status()`, `tourmap_cancel()` — gleiches Polling-Pattern wie
  der Animator, mit Pre-Flight-Checks (Token + Chromium).
- **Output**: `~/Pictures/Reisezoom Tour Maps/<gpx-name>_YYYYMMDD-HHMMSS.png`
- **Result-View** mit großer Bild-Vorschau + Buttons „Im Finder zeigen",
  „Pfad kopieren", „Neue Karte". Cache-Bust beim Bild-Reload.
- i18n DE/EN/ES für alle neuen Strings.

### Geändert (Render-Live-Preview deutlich größer)
- **Backend-JPEG**: Preview-Thumbnail von 720 → 1280 px longest edge.
  Auf Retina-Displays wirkte 720 gepixelt + klein. base64 bleibt mit
  q72 unter ~250 KB pro Frame.
- **CSS**: `.render-preview` hatte `max-width: 100%; max-height: 100%`
  ohne `width/height` → das `<img>` skalierte NIE über seine intrinsische
  Größe hinaus, der dunkle Container blieb groß aber das Bild war klein
  in der Mitte. Jetzt `width: 100%; height: 100%` mit `object-fit: contain`
  → Bild füllt den Container, hält Aspect-Ratio.
- `.render-preview-wrap` zusätzlich `flex: 1 1 0; min-height: 0;
  max-width: 100%` damit es korrekt expandiert (`min(1080px, 90%)` war
  unnötig eng).

### Geändert (Overlay-Konfig folgt Master-Toggle)
- Wenn die Checkbox „Stats-Overlays anzeigen" aus ist, werden die drei
  granularen Konfig-Zeilen (Totals/Live/Höhenprofil + Positionen) jetzt
  ausgeblendet. Vorher waren sie sichtbar aber wirkungslos, das hat
  verwirrt. `syncOverlayConfigVisibility()` setzt `hidden` auf den
  Wrapper bei jedem Master-Toggle-Change und beim Mount.

### Hinzugefügt (FPS-Wahl, Track-Dicke, konfigurierbare Overlays + Live-Vorschau)
- **FPS-Wahl** im Animator-Panel: 24 / 30 / 50 / 60 fps. Wird als
  `cfg.fps` an `render()` durchgereicht (war vorher hartcodiert auf 30).
- **Track-Dicke** (Line-Width) als Slider 1 – 10 px (Default 3.5). Wirkt
  live auf die Preview-Karte (`setPaintProperty("preview-line", "line-width")`)
  und auf den Render. Glow-Line wird auf 2,85× der Track-Dicke skaliert.
- **Konfigurierbare Stats-Overlays**: 3 unabhängige Boxen — Totals
  (Strecke/Zeit/Aufstieg/Abstieg/Max-Höhe), Live (Zurückgelegt/Vergangen/
  Höhe), Höhenprofil. Jede einzeln togglebar + Position (↖↗↙↘ bzw. ↧
  unten breit für das Profil). Settings persistiert in `animator.overlay_*`.
- **Live-Vorschau direkt auf der Karte**: Sobald man Overlays togglet
  oder die Position ändert, wird ein HTML-Layer auf der Preview-Karte
  sofort upgedated — mit echten Werten wenn GPX geladen ist, sonst als
  Platzhalter (`—`). Höhenprofil zeigt 50% gefüllt als Demo. Was du im
  Panel siehst landet 1:1 auch im finalen MP4.
- **Backend** (`core/animator.py.AnimatorConfig`): neue Felder
  `line_width`, `overlay_totals_enabled/position`, `overlay_live_*`,
  `overlay_elevation_*`. `_make_html` generiert pro Box dynamisch HTML +
  CSS-Position-Klassen (`pos-tl/tr/bl/br/bc`). Höhenprofil bekommt in den
  Ecken eine kompakte 480-px-Breite, bei `pos-bc` weiterhin Vollbreite.
- **Bridge `animator_load_gpx`** liefert jetzt zusätzlich `elevations`-
  Array (200 Punkte downsampled) für das Vorschau-Höhenprofil.
- i18n DE/EN/ES für alle neuen Labels (Position, Overlay-Namen, Stats-Labels).

### Hinzugefügt (Live-Preview + Cancel-Button beim Rendern)
- **Live-Preview**: Während des Renders sieht man jetzt direkt das gerade
  produzierte Frame als großes Bild im Progress-Overlay. Backend pusht
  alle ~3 Frames (bei 30 fps) ein downscaled JPEG (720 px longest edge,
  Quality 72) via base64 über die Bridge ins UI. So merkst du sofort,
  wenn die Konfiguration nicht passt — bevor das ganze Video durch ist.
- **Cancel-Button**: roter „⨯ Abbrechen"-Button im Progress-Overlay.
  Worker-Thread prüft das Cancel-Flag vor jedem Frame, wirft
  `RenderCancelled` → ffmpeg wird sauber beendet, die halb-fertige
  MP4-Datei wird gelöscht. Status springt auf „Abgebrochen", kein
  Fehler-Modal.
- **Neue Bridge-Endpoints**: `animator_cancel()` setzt das Flag.
- **Backend-Signatur erweitert**: `core/animator.py.render()` nimmt jetzt
  optional `on_preview(b64_jpeg)` und `is_cancelled()` Callbacks.
- **Neue Render-State-Felder**: `preview_b64`, `cancel_requested`, `cancelled`
  in `animator_status()`. UI flackert nicht weil sie nur bei B64-Änderung
  refreshed.
- i18n DE/EN/ES für Abbrechen, Preview-Start, Cancel-Toast.

### Hinzugefügt (App-Icon im Topbar-Brand)
- Das `assets/icon_1024.png` wird auf 96×96 gedownscaled als
  `ui/assets/icon.png` und im Topbar statt der „RZ"-Gradient-Box gezeigt.
- `_prepare_html_with_cache_busting()` hat jetzt auch eine `<img>`-Regex,
  damit Local-Image-Pfade in der Temp-HTML zu absoluten file://-URLs werden.
  Sonst lädt das Bild nicht (HTML liegt in `/tmp/` ohne assets-Ordner).
- `.brand-mark` CSS umgebaut: kein Gradient-Box mehr, sondern saubere
  Squircle-Image mit dezentem Drop-Shadow.

### Behoben (Render-Crash: Playwright-Browser nicht im Bundle gefunden)
- **Root-Cause**: PyInstaller bundelt zwar den Playwright-Driver, aber NICHT
  die Chromium-Browser-Binaries (~150 MB). Beim Render-Versuch ging
  Playwright in seinen Bundle-Pfad
  `.app/Contents/Resources/playwright/driver/package/.local-browsers/`
  und fand dort nichts → `BrowserType.launch: Executable doesn't exist`.
- **Fix**: `PLAYWRIGHT_BROWSERS_PATH` wird in `app.py` ganz früh auf den
  **System-Cache** `~/Library/Caches/ms-playwright` gesetzt (plattform-
  abhängige Pfade für Win/Linux ebenfalls). Wenn der User Playwright je
  installiert hat (`pip install playwright && playwright install`), wird
  der vorhandene Browser benutzt.
- **Neue Bridge-Endpoints**: `playwright_check()` prüft ob der
  Chromium-Headless-Shell-Browser auf der Platte ist;
  `playwright_install_chromium()` lädt ihn via gebundeltem Playwright-
  Driver herunter (~150 MB, einmalig).
- **Pre-Flight im Render**: `animator_start_render()` ruft vor dem
  Thread-Start `playwright_check()` auf. Fehlt der Browser →
  `error_code: "playwright_browser_missing"` mit dem Cache-Pfad.
- **UI**: Wenn der Render diesen Error-Code zurückgibt, statt generischem
  Fehler-Toast ein **„Browser jetzt herunterladen"**-Modal mit Erklärung,
  Cache-Pfad, indeterminate-Progress-Bar und Auto-Retry des Renders nach
  erfolgreicher Installation. Lokalisiert DE/EN/ES.

### Hinzugefügt (App-weites Logging + Fehler-Modal mit Log-Anzeige)
- **Neues Modul `core/logger.py`**: zentrales Python-Logging via
  `RotatingFileHandler`. Logdatei in
  `~/Library/Application Support/Reisezoom GPS Studio/logs/app.log`
  (1 MB Rotation, 5 Backups). Globale Excepthooks für `sys.excepthook`
  und `threading.excepthook` → ungefangene Exceptions aus Worker-Threads
  landen ebenfalls im Log.
- **Animator-Render schreibt jetzt detailliert ins Log**: Konfiguration
  (GPX, Output, Style, Codec, Auflösung, Pitch, Token-Status), Pipeline-
  Schritte (GPX-Parse, Chromium-Start, Map-Ready, ffmpeg-Cmd), Progress-
  Milestones (alle 10 %), Erfolgsmeldung mit Output-Größe.
- **Headless-Chromium-Console** wird ins App-Log gespiegelt — Mapbox-
  Token-Fehler („Unauthorized"), WebGL-Errors etc. werden jetzt sichtbar.
- **ffmpeg-stderr** wird sowohl bei Fehler (RuntimeError mit Auszug) als
  auch im Erfolgsfall (Warnungen) geloggt.
- **Render-Fehler-Modal** statt Toast: zeigt Kurzfehler + aufklappbares
  Traceback + aufklappbarer Logdatei-Tail (16 KB) + zwei Aktions-Buttons
  „Log öffnen" (öffnet im Texteditor) und „Im Finder zeigen". Lokalisiert
  DE/EN/ES.
- **Neue Bridge-Endpoints**: `get_log_info()`, `open_log()`,
  `reveal_log_in_finder()`, `get_log_tail(max_bytes)`.

### Behoben (Animator-Panel: Render-Button nicht erreichbar auf kleinen Screens)
- **`.main` hatte `height: 100vh`** — aber `.main` sitzt im `1fr`-Slot des
  Body-Grids unter der 56-px-Topbar. Das hat `.main` um 56 px über den
  Viewport-Boden hinaus gestreckt → Panel-Unterkante mitsamt Render-Button
  unsichtbar, `body { overflow: hidden }` blockte das Scrollen.
- Fix: `height: 100vh` raus, stattdessen `min-height: 0` auf `.main` +
  `.module-body` + `.panel`. Damit clippt das Body-Grid sauber und das
  Panel scrollt jetzt korrekt bei wenig Bildschirmhöhe (kleine MacBooks!).
- `.panel` zusätzlich `height: 100%`, damit es die volle Grid-Cell-Höhe
  beansprucht statt nur Content-Höhe.

### Geändert (Animator: GPX-Dateiname-Anzeige im Panel entfernt)
- Die kleine Dateiname-Label-Zeile unter dem „GPX-Datei auswählen"-Button
  ist raus — das Laden wird über den Toast + die Stats-Pills im Header
  bestätigt, der Pfad selbst war redundant und kostete vertikalen Platz
  (besonders relevant auf 13"-MacBooks).

### Geändert (Settings: Token-Save löst UI-Reload aus)
- **Mapbox-Token-Save im Settings-Modal triggert jetzt `window.location.reload()`.**
  Vorher wurde nur `renderMod()` gerufen, aber der Token-Cache in `util.js`
  (`window._RZGPS_MAPBOX_TOKEN`, `_mapMode`) bleibt dann auf dem Wert vom
  App-Start hängen → Map-Engine wechselt nicht, OSM-Notice verschwindet
  nicht, MapLibre/Mapbox-Lib-Wahl bleibt falsch.
- Reload-Sequenz: Toast „Token gespeichert" 700 ms anzeigen → Modal schließen
  → `location.reload()`. WebView lädt frisch, `initMapToken()` zieht den
  neuen Token, alles ist konsistent.
- Sprachwechsel macht weiterhin Hot-Reload ohne kompletten Reload (i18n
  ist reines DOM-Re-Rendering).

### Geändert (Animator: Style-Picker im OSM-Modus deaktiviert)
- **Style-Dropdown ist im OSM-Modus jetzt ausgegraut**, statt nur stumm den
  Wechsel-Versuch zu schlucken. Direkt unter dem Picker erscheint eine gelbe
  Notice-Box: „Nur OpenStreetMap aktiv — Ohne Mapbox-Token gibt es nur die
  OSM-Standardkarte (kein Satellit, kein 3D-Terrain, kein Stil-Wechsel).
  Render-Funktion ist ebenfalls deaktiviert."
- **CTA-Button** „🔑 Mapbox-Token hinzufügen" in der Notice öffnet das
  Settings-Modal direkt — kein Suchen im Menü mehr nötig.
- Lokalisiert in DE/EN/ES (neue Keys: `animator.style.osm_disabled_title|body|cta`).
- CSS-Klassen `.field.is-osm-disabled` + `.osm-disabled-notice` in
  `modules/animator/ui/module.css`.

### Behoben (NSWindow-Crash beim App-Start)
- **App stürzte beim Start ab** mit Crash-Report „Must only be used from the
  main thread". Ursache: `webview.events.loaded`-Callback läuft auf einem
  Python-Worker-Thread (Thread-3 „execute"), **NICHT** auf dem Cocoa-Main-Thread.
  Der direkte Aufruf von `NSWindow.setFrame_display_()` aus diesem Thread
  triggerte `NSWMWindowCoordinator performTransactionUsingBlock:` mit
  Main-Thread-Assertion → BREAKPOINT.
- **Fix:** NSWindow-Zugriff via `PyObjCTools.AppHelper.callAfter()` auf den
  echten Main-Thread dispatchen. Maximieren beim Start funktioniert jetzt
  ohne Crash.
- **Lesson learned** (zu `docs/DEVELOPER.md` ergänzt): pywebview-Events sind
  **nicht** garantiert Main-Thread. Jeder PyObjC/Cocoa-Zugriff aus Event-
  Callbacks **muss** über `AppHelper.callAfter()`.

### Hinzugefügt (OSM-Fallback ohne Token)
- **Karten funktionieren jetzt auch ohne Mapbox-Token.** MapLibre GL JS wird als
  zweite Engine geladen (CDN), bei leerem Token nutzt die App OpenStreetMap-Raster-Tiles
  (Standard-Karte, kein Satellite, kein 3D).
- **First-Run-Modal überarbeitet** mit **zwei deutlich getrennten Optionen**:
  1. "Mit Mapbox-Token" (volle Features) + Anleitung + Eingabefeld
  2. "Ohne Token (OSM)" für Sofortstart
  Plus Hinweis dass die Wahl jederzeit in den Einstellungen änderbar ist.
- **Map-Factory** in `ui/js/util.js`:
  - `createMap(opts)` — wählt Engine basierend auf gesetztem Token
  - `mapLib()` — gibt aktive Lib für Marker/Popup-Konstruktoren zurück
  - `isOsmMode()` / `isMapboxMode()` — Mode-Checks für Module
- **Animator-Render ist im OSM-Mode blockiert** mit klarem Modal: "Brauche Token,
  Einstellungen öffnen?" — kein leerer/kaputter Render-Versuch
- **Animator-Style-Wechsel im OSM-Mode**: zeigt Toast statt zu wechseln
- Settings-Schema: `onboarding_done` (neu), `mapbox_token` weiterhin leer = OSM
- i18n in DE/EN/ES erweitert (3 neue First-Run-Optionen, OSM-Hinweise)

### Hinzugefügt (Hochkant + Codec)
- **Hochkant-Auflösungen** für YouTube Shorts / Instagram Reels: zwei neue
  Quick-Buttons im Resolution-Picker: `4K↕` (2160×3840) und `1080↕` (1080×1920)
- **Codec-Auswahl** im Animator-Panel: H.264 (universell kompatibel, Default)
  oder H.265/HEVC (~30 % kleinere Dateigröße, Apple-Plattformen). H.265 bekommt
  automatisch `-tag:v hvc1` für QuickTime-Kompatibilität.
- Settings: `codec` (`"h264"|"h265"`), `crf` (default 20)

### Behoben (Modal-Footer-Layout)
- **First-Run-Modal-Footer ragte links über den Container raus** wenn 3 lange
  Buttons gleichzeitig drin waren. Fix: `.modal-footer` bekommt `flex-wrap: wrap`,
  Buttons keine starre `min-width` mehr, und Cancel/Skip-Buttons können mit
  Klasse `.btn-left` (margin-right: auto) nach links rücken — macOS-konvention.

### Behoben (i18n-Details)
- **Menü-Eintrag „Einstellungen…"** war hardcoded auf Deutsch. Jetzt aus i18n-Key
  `menu.settings` geholt (DE: „Einstellungen…", EN: „Settings…", ES: „Ajustes…").
  Wird beim App-Start aus der aktiven Sprache gesetzt (kann zur Laufzeit nicht
  geändert werden, pywebview-Limitation).
- **Sprach-Dropdown** zeigte in der Klammer fälschlich die aktuell **aktive**
  Sprache statt der **erkannten Systemsprache**. Jetzt korrekt:
  `"Systemsprache (de)"` zeigt immer die System-Detection an. Die manuellen
  Einträge zeigen nur noch den nativen Namen ohne Code-Klammer.
- Backend: `i18n_get_strings()` liefert jetzt `active` UND `system_locale`
  getrennt zurück.

### Behoben (Sprachwechsel hinkte hinterher)
- **Sprachwechsel im Settings-Modal hat den vorherigen Wert genommen** (DE→EN
  blieb auf DE, EN→ES zeigte EN, etc.). Race-Condition: `saveSettings` war 200 ms
  debounced — `loadI18n()` lief sofort danach und las `settings.json` noch mit
  altem Wert. Fix: neuer Modus `saveSettings(patch, {immediate: true})` schreibt
  direkt synchron durch die Bridge und kann awaited werden. Beide Settings
  (Sprache + Token) gehen in EINEM Bridge-Call raus.

### Geändert (Mapbox-Token: Onboarding + Menü)
- **Bundled Default-Token entfernt.** Die App liefert keinen eigenen Mapbox-Token
  mehr aus — jeder User trägt seinen eigenen ein. Persistiert in
  `settings.mapbox_token` und bleibt zwischen App-Starts erhalten.
- **First-Run-Modal beim ersten Start**: blockierend (kein ✕, kein ESC, kein
  Backdrop-Click), erklärt mit 5 Schritten wie man zum Token kommt, mit Buttons
  zum Mapbox-Sign-up und Dashboard direkt im System-Browser, Input-Feld mit
  Validierung (`pk.`-Prefix). Erst nach gültiger Eingabe läuft die App weiter.
- **„Einstellungen…"-Eintrag im macOS-Menü** (Reisezoom-Top-Menü) → öffnet
  das Settings-Modal. Implementiert via `pywebview.menu` + `evaluate_js`-Trigger
  auf `window.openSettingsModal()`.
- `Api.mapbox_token_info().is_configured` neu für UI-Check beim Bootstrap

### Hinzugefügt (Mapbox-Token in Settings)
- **Eigener Mapbox-Token im Settings-Modal** eintragbar. Default-Verhalten
  unverändert (bundled Token wird genutzt), aber wer die App weitergibt oder
  viel rendert, kann jetzt einen eigenen kostenlosen Token reinsetzen.
- **Hilfe-Modal** mit Schritt-für-Schritt-Anleitung wie man zum Token kommt
  (Mapbox-Account, Dashboard, Default Public Token kopieren). Links öffnen
  direkt im System-Browser via neuer Bridge-Methode `Api.open_url(url)`.
- Token-Status wird im Settings-Header angezeigt: grüner Dot = "Eigener Token
  aktiv", grauer Dot = "Standard-Token aktiv"
- Validierung: muss mit `pk.` beginnen, sonst Warn-Toast
- Bei Token-Wechsel rendert das aktive Modul automatisch neu (neue Map mit neuem Token)
- Bridge: `Api.get_mapbox_token()` (gibt aktiven zurück) + `Api.mapbox_token_info()` (Status für UI) + `Api.open_url(url)`
- Settings-Key: `mapbox_token` (Default: `""` → bundled Token)
- i18n in DE/EN/ES für alle neuen Strings (12 neue Schlüssel)

### Geändert (Performance: File-Picker)
- **File-Picker öffnet sich jetzt sofort** statt nach 0.5–1 s Verzögerung.
  Vorher ging pywebview's `create_file_dialog` über einen Bridge-Roundtrip
  (JS → Bridge → Main-Thread-Hop → NSOpenPanel), das addierte spürbar Latenz.
  Neu: direkter PyObjC-Call (`AppKit.NSOpenPanel`) via `AppHelper.callAfter`
  auf dem Main-Thread. Bei Fehler greift weiterhin pywebview als Fallback.
- Hilfsfunktion `_parse_extensions()` extrahiert `*.gpx` etc. aus den
  pywebview-Filter-Strings für `NSOpenPanel.setAllowedFileTypes_`.

### Geändert (Animator-Auflösung)
- **4K (3840×2160) ist jetzt der Default** statt 1920×1080
- **Quick-Picker** statt einzelner Width/Height-Inputs: zwei Buttons
  `[4K] [1080p]` direkt im Panel + ein `⋯`-Toggle für die manuelle Eingabe
  (Width/Height-Inputs werden dann eingeblendet, alles bis 8K möglich)
- Aktuell ausgewählte Standard-Auflösung wird im Picker farbig markiert
- Bei Werten die nicht zu 4K/1080p passen, klappt die Custom-Box automatisch auf

### Geändert (Animator-Layout + Fenster)
- **App startet jetzt maximiert** auf die volle Bildschirmgröße (`maximized=True`
  in `webview.create_window`)
- **Animator: Track-Statistiken sind aus der linken Sidebar raus** und werden
  als Glas-Leiste **am unteren Bildrand der Karte** angezeigt
  - Leer-Zustand: "Lade eine GPX-Datei — die Track-Statistiken erscheinen hier"
  - Geladen: 4 Stat-Pills (Strecke / Zeit / Bergauf / Bergab) horizontal
  - Bar ist immer sichtbar, mit Backdrop-Blur
  - Spart Höhe im linken Panel, Sidebar passt auf kleinere Bildschirme
- i18n-Schlüssel `animator.stats.empty_hint` für alle 3 Sprachen

### Hinzugefügt (Animator Live-Preview)
- **Live-Preview im Animator** — alle Einstellungs-Slider und das Style-Dropdown
  wirken sofort auf die Vorschau-Karte, kein Render mehr nötig zum Probieren:
  - **Map-Style** ändern → `map.setStyle()` lädt den Style neu, Track-Layer werden danach automatisch neu aufgebaut
  - **Neigung-Slider** → live `map.setPitch()`
  - **Rotation-Slider** → live `map.setBearing()` (zeigt End-Bearing des Sweeps, damit man "fühlt" wie weit gedreht wird)
  - **Terrain on/off** → `setTerrain()` toggelt 3D-Berge live
  - **Terrain-Übertreibung** → Exaggeration wird live übernommen
  - **Track-Farbe** → `setPaintProperty()` auf die Layer, Farbe wechselt sofort
- Initial-Style der Preview-Map kommt jetzt aus den Settings (statt fest "dark")

### Hinzugefügt (App-Icon + Lokalisierung)
- **Eigenes App-Icon** — gerundet-quadratisches Squircle mit GPS-Pin und Track-Linie
  in Akzent-Orange auf Dunkel-Hintergrund. Generator-Script `scripts/make_icon.py`
  produziert `assets/icon.icns` mit allen macOS-Größen (16–1024px). Wird über
  PyInstaller-Spec ins App-Bundle gepackt.
- **Lokalisierung mit 3 Sprachen**: Deutsch (Master), Englisch, Spanisch.
  - `core/i18n.py` lädt JSON-Sprachfiles aus `i18n/<code>.json`, erkennt
    System-Sprache via macOS `defaults read -g AppleLanguages` mit Fallback
    auf `locale.getlocale()` → letztendlich Englisch wenn nichts matched
  - Bridge-API `i18n_get_strings()` liefert das fertige Strings-Dict ans UI
  - JS-Helper `t(key, params)` mit `{name}`-Platzhalter-Support
  - Alle UI-Strings in Modulen, Modal-Titeln, Toasts, Tooltips, Empty-States,
    Section-Überschriften, Button-Labels, Modul-Manifests (Name+Beschreibung)
  - Fallback-Kette: gewählte Sprache → Englisch → Schlüsselname
  - 70+ Strings pro Sprache
- **Einstellungs-Modal** (⚙-Button rechts oben in der Top-Bar) mit
  Sprach-Dropdown: "Systemsprache" / "Deutsch" / "English" / "Español".
  Wechsel wirkt sofort (alle Module rendern neu), keine Restart-Pflicht.
- **Settings-Schlüssel** `language` (`"auto" | "de" | "en" | "es"`), Default `"auto"`.
- PyInstaller-Spec packt `i18n/` als Resource mit ein.

### Hinzugefügt (Video-Geotagging)
- **Video-Support im Geotagger.** Formate: `.mp4` `.mov` `.m4v` `.qt` `.insv` `.insp`
  (Insta360) `.mts` `.m2ts` `.lrv` `.3gp` `.avi` `.mkv`
  - Aufnahmezeit aus `MediaCreateDate` / `CreateDate` (QuickTime-Container, i.d.R. UTC)
  - GPS-Schreibvorgang setzt **mehrere Tags gleichzeitig**: `Keys:GPSCoordinates`
    (ISO 6709 String, Apple-Standard), `UserData:GPSCoordinates` (Legacy QT),
    `GPSLatitude/Longitude/Altitude` (für Lightroom & DAM-Tools) — deckt Photos.app,
    iOS, macOS Sequoia, Lightroom, Google Photos, Synology Photos etc. ab
  - **Thumbnail** via ffmpeg-Frame-Extract (`-ss 1 -frames:v 1`, Fallback 0s), gleicher
    Lazy-Loading-Flow wie bei Fotos
  - **Play-Icon-Badge** (▶) auf Video-Tiles unten links
  - **Status-Text** zeigt Aufschlüsselung: `47 Medien importiert (32 JPG + 8 RAW + 7 Videos)`
  - File-Picker hat eigene Filter: Medien / Fotos / Videos / JPEG / RAW
  - Drop-Zone akzeptiert alle Video-Endungen
- Bridge: `cexif.is_video()` / `is_media()` / `extract_video_thumbnail()` /
  `_exiftool_read_video_meta()` / `_exiftool_write_gps_video()`
- Test `tests/test_video_geotagging.py` — erzeugt Test-MP4 via ffmpeg, schreibt+verifiziert GPS

### Geändert (Panel-Kompaktierung)
- **Linke Steuerleiste auf "luftig-kompakt"** balanciert — passt auf 13"-MBA mit
  Spielraum und bleibt gut lesbar
  - Padding `22/24 → 20/22`, Section-Gap `22 → 20`, Section-Title `11 → 11.5px`
  - Buttons `10/14 Padding → 9/14`, Font `13 → 13.5px`
  - Checkboxes-Rows `font 13 → 13px` (1pt-Reduktion bei größerem Spacing)
  - Offset-Slider-Box: Display `22 → 20px`, Padding-Box etwas großzügiger
  - Range-Buttons + Skala-Labels 2pt größer
- **Empty-State-Labels komplett raus**: "Keine Datei geladen" / "Noch keine Fotos geladen"
  werden nicht mehr angezeigt. Labels erscheinen erst wenn was geladen ist (`hidden`-Attribut).
- **Hilfetexte als Tooltips** statt permanent sichtbarer Boxen:
  - Offset-Section: 3-Zeilen-Erklärung weg, Tooltip auf dem Section-Titel
  - Referenz-Foto-Help-Text weg, Tooltip auf dem Button selbst

### Geändert (Offset-UI)
- **Offset-Eingabe komplett neu**: statt vier verwirrender Felder (Stunden / Minuten /
  Sekunden / Vorzeichen) jetzt **ein Slider mit Bereichs-Schalter**.
  - Default-Bereich **±2h** (deckt Sommer-/Winterzeit + Kamera-Drift normalerweise ab) —
    Range-Buttons sind erstmal **versteckt**, statt dessen ein dezentes
    "+ mehr Stunden"-Link darunter
  - Klick auf "+ mehr Stunden" blendet die Auswahl ein: `±2h | ±3h | ±6h | ±12h`
  - Auto-Expand: wenn ein gespeicherter Wert oder ein Referenz-Foto-Offset > ±2h ist,
    erscheinen die Buttons automatisch (User hat sie ja gebraucht)
  - Slider-Step ist in allen Stufen 60s, damit das Snap-Verhalten konsistent flüssig ist
  - Auto-Range beim Init: wenn gespeicherter Offset größer als aktueller Range → Range expandiert
  - Auto-Range bei Referenz-Foto-Modus: berechneter Offset zu groß → Range klappt entsprechend auf
  - Live-Update: Marker auf der Karte bewegen sich **während** des Schiebens
  - **Snappy zu vollen Stunden**: Magnetfeld **±5 min während des Schiebens** (Slider rastet
    schon beim Drag ein), und **±15 min beim Loslassen** (auch wenn man knapp daneben war)
    — perfekt für Zeitzonen-Fixes wo man genau auf z.B. −1 h treffen will
  - Großer Wert-Anzeiger in der Mitte zeigt den aktuellen Offset (`+2h 15min` o.ä.)
  - **↺ Reset**-Button rechts setzt auf 0
  - **✎ Edit**-Button links öffnet Modal für Sekunden-genaue Eingabe
- Settings-Schema migriert: `offset_h/m/s/sign` werden beim ersten Lesen
  automatisch in `offset_seconds` zusammengefasst. Alte settings.json funktioniert weiter.

### Geändert (DnD-Performance)
- **Drop-Feedback jetzt direkt im Grid statt unten rechts.** Wenn man Fotos
  oder einen Ordner in den Geotagger zieht:
  1. **Sofort** (vor jedem Upload!) werden Skelett-Tiles mit den Dateinamen
     gerendert — User sieht direkt im Grid welche Dateien importiert werden
  2. Sticky-Loader-Header im Grid zeigt "Importiere Dateien: 12 / 200"
  3. Pro Tile läuft ein pulsendes ↑-Symbol während des Uploads, verschwindet
     wenn fertig
  4. **Upload jetzt parallel** mit Concurrency 4 (statt sequenziell) — ~4×
     schneller bei vielen Fotos
  5. Nach Upload: Backend-Registrierung + Lazy-Thumb-Loading wie bei File-Picker
  6. Fehlgeschlagene Uploads bekommen einen roten Tile-Border
- Drop-Progress-Box unten rechts entfernt (war oft vom Finder-Fenster verdeckt)

### Geändert (Layout)
- **Module-Navigation von Sidebar → Top-Bar.** Die 240-px-Seitenleiste links ist weg,
  Modul-Wechsel passiert jetzt über Tabs in einer 56-px-hohen Top-Bar. Das gibt jedem
  Modul die **volle Fenster-Breite** — besonders der Geotagger profitiert (Karte ist
  jetzt deutlich größer).
- **Modul-Refactor**: jedes Modul lebt jetzt in `modules/<slug>/` mit eigener
  `manifest.json`, `ui/module.html`, `ui/module.css`, `ui/module.js`. Module
  registrieren sich selbst über `window.RZGPS_MODULES[<slug>]` mit Manifest + Mount-Funktion.
  - app.js liest `window.RZGPS_MODULES` und baut Tabs daraus, sortiert nach `sort_order`
  - Vorbereitung für späteres "split into individual apps" — Suite bleibt vorerst Default
  - Cache-Buster und PyInstaller-Spec wurden auf `modules/` erweitert
- **Empty State im Geotagger**: wenn noch keine Fotos geladen sind, erscheint im
  Foto-Grid jetzt ein zentraler Hinweis (📷-Icon + "Hier kommen deine Fotos hin —
  zieh Fotos oder Ordner rein oder nutze die Buttons") + **8 gestrichelte Dummy-Tiles**
  als visuelle Vorschau. Beim Hover über die Dummy-Tiles werden sie heller, beim Drag
  über das Grid bekommen sie den Akzent-Rand — User weiß sofort wo Fotos hinkommen.

### Hinzugefügt
- **ExifTool Stay-Open-Daemon** — massive Performance-Verbesserung bei RAW-Verarbeitung.
  Vorher startete `exiftool` als frischer Perl-Subprozess **pro Operation pro Foto**
  (~0.5–1 s Startup-Overhead jedes Mal). Jetzt läuft ein **einziger persistenter
  Prozess** mit `-stay_open True -@ -`, der Argumente über stdin bekommt und mit
  `-execute<N>` / `{ready<N>}` Markern getrennt antwortet.
  - **Benchmark mit 20 CR3s**: 700 ms/Foto → 107 ms/Foto (≈ 8× schneller)
  - Daemon wird automatisch beim ersten Bedarf gestartet, beim App-Shutdown sauber beendet
  - DateTime + GPS werden jetzt in EINEM Daemon-Call gelesen (vorher 2 separate)
  - Thread-safe per Lock + Request-ID
- **Async-Write mit Live-Progress-Modal** — Schreibvorgang läuft jetzt in einem
  Background-Thread, das UI bleibt responsiv.
  - **Bestätigungs-Modal** vor dem Start mit Übersicht: wie viele werden getaggt,
    wie viele übersprungen, ob Backup angelegt wird
  - **Progress-Modal** während des Schreibens: Fortschrittsbalken, X/N-Counter,
    aktueller Dateiname als Monospace-Eintrag
  - **Abbrechen-Button** stoppt den Worker beim nächsten Foto
  - **Result-Modal** mit Summary (getaggt / Fehler / übersprungen / Backup-Pfad),
    Klick auf "Backup im Finder" zeigt das ZIP
- **Setting: "Foto-Aufnahmezeit ebenfalls mit Offset korrigieren"** — Default `false`.
  - Wenn aktiviert: zusätzlich zu den GPS-Tags werden `DateTimeOriginal`, `CreateDate` und
    `ModifyDate` um den eingestellten Offset verschoben. Sinnvoll bei "Kamera-Uhr war 2 h
    falsch" — danach stimmen auch Lightroom/Photos-Datumssortierung
  - Für JPEG via piexif (rechnet Datum in Python, schreibt zurück)
  - Für RAW via `exiftool -AllDates+="H:MM:SS"` (negativ mit `-=`)
  - Im Confirm-Modal sichtbar: "⏰ Foto-Aufnahmezeit anpassen: 47 × +2h"
  - Bridge: zwei neue Parameter in `geotagger_start_write`: `adjust_photo_time` + `offset_seconds`
- **Backup-Pfad sichtbar im Confirm-Modal** — bevor man "Schreiben starten" klickt, sieht
  man jetzt unter "📦 Backup-ZIP wird angelegt unter:" den vollen Pfad
  (`~/Library/Application Support/Reisezoom GPS Studio/_backups_photos/`).
  Außerdem Bridge `get_paths()` für UI-Anzeige aller wichtigen Speicherorte.
- **Setting: "Bestehende GPS-Daten überschreiben"** — Default `false`.
  - Fotos mit bereits gesetzten GPS-Tags werden standardmäßig übersprungen
    (z.B. wenn die Kamera schon einen built-in GPS hat oder das Foto schon mal getaggt wurde)
  - Im Bestätigungs-Modal wird klar angezeigt wie viele übersprungen werden
  - Bridge: `geotagger_start_write(matches, make_backup, overwrite_existing)` +
    `geotagger_write_status()` + `geotagger_write_cancel()`
- **Modal-System** (`openModal({title, body, footer, closable, onClose})`)
  - Globales Modal in `index.html`, gestylt im Dark-Theme
  - `openModal()` gibt Update-/Close-Handles zurück
  - ESC und Klick auf Backdrop schließen (wenn `closable !== false`)
- **Referenz-Foto klar markiert** — das aktuell für die Offset-Berechnung verwendete Foto
  bekommt jetzt einen orangen Glühring + 🎯-Pin oben links am Tile. Auf der Karte bekommt
  der zugehörige Marker einen gold-orangen Ring. Der Banner im Referenz-Modus zeigt jetzt
  den Dateinamen statt nur generischer Anleitung.
- **Foto-Vorschau-Panel oben rechts auf der Karte** — Klick auf einen Karten-Marker
  oder auf ein Foto-Tile in der Sidebar zeigt das Foto in einem festen Panel
  (280 × ~285 px) in der oberen rechten Karten-Ecke. Bleibt **dauerhaft sichtbar**
  (nicht wie Mapbox-Popups, die bei Karten-Bewegung Probleme machen) bis User es
  über ✕-Button schließt oder ein anderes Foto wählt. Zeigt Thumbnail + Dateiname
  (+ 🎯 wenn Referenz) + Aufnahmezeit + Koordinaten. Beim Sidebar-Klick scrollt das
  Tile zusätzlich in den sichtbaren Bereich.
- **Cache-Busting beim App-Start** — WKWebView cachet `file://`-CSS/JS-URLs aggressiv,
  was nach Code-Updates dazu führt, dass alte Versionen weiter angezeigt werden.
  Lösung: beim App-Start wird die `index.html` in eine Temp-Datei kopiert, dabei werden
  alle CSS/JS-Refs durch **absolute `file://`-URLs mit `?v=<hash>`-Query** ersetzt.
  Der Hash ist die Summe aller UI-File-Modification-Times → ändert sich bei jeder
  Code-Änderung automatisch, bleibt sonst stabil.
  Zusätzlich `webview.start(private_mode=True)` → WKWebView nutzt einen nicht-persistenten
  Datastore, kein Cache zwischen App-Starts. Ab jetzt bekommt jeder App-Start
  garantiert die aktuelle UI-Version.
- **Settings-Persistenz** in `~/Library/Application Support/Reisezoom GPS Studio/settings.json`:
  - Aktives Modul wird gemerkt — App startet immer dort wo du zuletzt warst
  - **Animator-Konfiguration:** Map-Style, Pitch, Rotation, Terrain-Übertreibung, Duration, Hold, Auflösung, Track-Farbe, Terrain on/off, Overlays on/off
  - **Geotagger:** Offset-Felder (h/m/s/sign) + Backup-Checkbox
  - Auto-Save 200 ms nach jedem Input-Change (debounced)
  - Atomares Schreiben (temp + rename) → kein korruptes File bei Crash
  - Bridge-API: `settings_get()`, `settings_set(patch)`
- **Lazy-Loading im Geotagger** (massiver Speed-Boost bei vielen Fotos)
  - **Phase 1**: `geotagger_register_photos(paths)` validiert und gibt sofort `[{path,name,is_raw}]` zurück (<100 ms auch bei 500 Fotos)
  - **Phase 2**: Background-Thread liest EXIF + Thumbnail pro Foto und legt Ergebnisse in Queue
  - **Phase 3**: UI pollt `geotagger_poll_thumbs(known)` alle 250 ms, holt Deltas, updated Tiles
  - **UI-Feedback**: Skelett-Tiles mit Shimmer-Animation während Lade-Phase, Sticky-Loader-Bar oben im Grid mit `Lade Thumbnails: 47 / 200` + Fortschrittsbalken
  - Tile bekommt das echte Thumbnail eingeblendet sobald aus dem Worker zurück
  - Match-Recompute wird automatisch getriggert wenn neue EXIF-Zeiten reinkommen
- **RAW-Foto-Support im Geotagger** über `exiftool`-Backend.
  Unterstützte Formate: `.cr3` (Canon), `.cr2`, `.crw`, `.nef` (Nikon), `.nrw`, `.arw` (Sony),
  `.srf`, `.sr2`, `.raf` (Fuji), `.rw2` (Panasonic), `.orf` (Olympus), `.dng` (Adobe/Universal),
  `.pef` (Pentax), `.rwl` (Leica), `.srw` (Samsung), `.heic`/`.heif` (Apple).
  - GPS-Tagging schreibt direkt in die RAW-Datei (kein XMP-Sidecar)
  - Thumbnail wird aus eingebettetem Preview-JPEG extrahiert (schnell, kein Demosaicing)
  - DateTime, GPS-read/write, Preview alles über `exiftool` (Goldstandard)
  - JPEG/TIFF weiterhin über `piexif` (schneller, in-process)
  - `is_raw` / `is_photo` / `is_jpeg_like` Hilfsfunktionen
  - Datei-Picker zeigt jetzt 3 Filter: kombiniert (Default), nur JPEG, nur RAW
  - Drop-Zone akzeptiert alle 20+ Endungen
  - Status-Meldung zeigt Anzahl JPG vs RAW (z.B. "127 Fotos geladen (97 JPG + 30 RAW)")
  - Wenn `exiftool` fehlt: graceful Warnung mit Install-Hinweis, JPGs werden weiter unterstützt
- **Drag & Drop** für GPX-Dateien, Fotos und ganze Ordner
  - Animator: GPX auf den Map-Canvas droppen
  - Geotagger: GPX auf die Karte, Fotos/Ordner auf das Foto-Grid
  - Visuelles Feedback (gestrichelter Akzent-Rand + Drop-Hinweis-Pill)
  - Bei Foto-Imports per Drop: Mini-Progress unten rechts (`X/Y: Dateiname`)
  - Ordner-Drop unterstützt rekursives Traversieren via `webkitGetAsEntry`
- Python-Bridge: `drop_session_start`, `drop_save_file` (base64), `drop_save_text_file` (utf-8 plain)
- Dropped-Files werden in `~/Library/Application Support/Reisezoom GPS Studio/_drops/<session>/` zwischengespeichert
- Test-Stage `[7]` in `tests/test_app_start.py` für Drop-Bridge

### Behoben
- **Karten-Marker waren bei Fotos mit Lokalzeit-EXIF + UTC-GPX um die Zeitzone verschoben.**
  Canon-/Sony-/Nikon-RAWs schreiben `DateTimeOriginal` ohne Zeitzonen-Info, aber zusätzlich
  ein `OffsetTimeOriginal` (z.B. `+02:00`) — viele GPX-Dateien sind dagegen UTC. Wir haben
  die Foto-Zeit als naive Lokalzeit gegen die UTC-Track-Zeit gematcht, was zu Versatz von
  bis zu 12 h führen konnte (je nach Zeitzone).
  Fix: `OffsetTimeOriginal` / `OffsetTime` / `OffsetTimeDigitized` werden jetzt **automatisch
  gelesen** (sowohl für RAW via exiftool als auch für JPEG via piexif) und die Aufnahmezeit
  **direkt zu UTC umgerechnet**. Damit stimmen die Marker out-of-the-box ohne dass der User
  einen Offset einstellen muss — solange die Kamera korrekt eine Zeitzone in EXIF speichert.
  Bei alten Fotos ohne `OffsetTime`-Tag verhält sich der Geotagger wie bisher
  (User-Offset nötig).
- **Drag & Drop mehrerer Fotos lieferte nur das erste.** Ursache: `dataTransfer.items`
  wird vom Browser nach dem ersten `await` im Drop-Handler invalidiert — wir hatten
  sequenziell `await traverseEntry(...)` pro Item gemacht, das zweite Item war dann
  schon weg.
  Fix: erst **synchroner Snapshot** aller `{entry, file}`-Refs in einem Array, dann
  erst async traversieren (parallel mit `Promise.all`). Plus erweiterte Dedup-Key
  (path + size + mtime statt nur path + size).
- **Geotagger-Tiles** komplett neu aufgebaut. Vorher: `<img>`+Overlays mit `aspect-ratio` →
  WKWebView ignorierte das aspect-ratio bei leerem `<img>` (kein src), Tile kollabierte
  auf ~20 px. Versucht: Padding-Top-Trick mit `::before` → griff in der Verschachtelung
  auch nicht. **Finale Lösung:** Tile als Flex-Container, fester `100px`-Thumb-Wrapper
  mit reservierter Höhe + Dateiname **als separater Strip drunter** (immer sichtbar,
  nicht mehr als Gradient-Overlay).
  - Vorteile: kein Layout-Sprung beim Thumbnail-Lazyload
  - Dateiname immer lesbar (Skelett-Zustand UND fertig)
  - Skelett-Pulsen wirkt nur auf den Thumb-Bereich
  - Foto-Grid auf `repeat(auto-fill, minmax(110px, 1fr))` umgestellt
  - Foto-Sidebar von 260 → 320 px verbreitert für mehr Platz pro Tile
- **File-Picker öffnete sich nicht.** Ursache: pywebview validiert `file_types`-Strings über einen Regex,
  der `\w` für die Beschreibung erlaubt — Bindestriche wie in `'GPX-Dateien (*.gpx)'` werden
  abgelehnt und der Dialog gar nicht erst gezeigt. Filter umbenannt zu `'GPX (*.gpx)'`,
  `'Fotos (*.jpg;*.jpeg)'`.
- **Geotagger reagierte auf keinen Klick.** Ursache: TDZ-Bug — `updateMatches` (const) wurde in den
  Offset-Input-Listener-Bindings referenziert, war an der Stelle aber noch nicht initialisiert.
  Wirft `ReferenceError`, **die `mount`-Funktion bricht ab, alle nachfolgenden Listener werden
  nie registriert**. Definitionsreihenfolge angepasst: `updateMatches`, `getOffsetSeconds`,
  `setOffsetFromSeconds` jetzt vor den Listener-Bindings.
- **DnD-Drop wurde fälschlich als "kein passender Dateityp" abgelehnt.** Ursache: in WKWebView gibt
  `webkitGetAsEntry()` für manche Drops `null` zurück, der Fallback auf `getAsFile()` lief nur
  wenn die Items-API komplett fehlte. Jetzt **3-stufige Strategie**: 1) Items + getAsEntry für
  Ordner-Support, 2) Items + getAsFile als Item-Level-Fallback, 3) `dataTransfer.files` als
  Browser-Fallback. Mit Dedup nach `name + size`. Fehler-Toast listet jetzt die gefundenen Dateinamen
  auf statt nur generischer Meldung.
- **Karten-Crash wenn GPX vor Mapbox-Init geladen wurde**: `loadGpxByPath` wartete nicht auf den
  Map-Init und crashte bei `map.isStyleLoaded()`. Jetzt mit Interval-Polling bis die Karte da ist.

### Geändert
- **DevTools/Web-Inspector werden nicht mehr automatisch beim App-Start geöffnet.**
  Standard ist jetzt `debug=False`. Bei Bedarf temporär aktivieren mit
  `REISEZOOM_DEBUG=1 open "/Applications/Reisezoom GPS Studio.app"`.
  Der globale JS-Error-Handler bleibt aktiv, fehlhafte Aufrufe erscheinen weiter als Toast.
- Globaler `window.onerror` + `unhandledrejection`-Handler zeigt jeden JS-Fehler als Toast
  statt stillschweigend zu schlucken

### Geplant
- Foto-Sortierung im Geotagger nach EXIF-Zeit
- Animator-Preview-Player (vor Render)
- Modul 3: Video-Overlay (aus `gps-overlay/` migrieren)
- Modul 4: GPX-Cleaner / Splitter
- Modul 5: Tour-Karten-Generator (PNG für YouTube-Thumbnails)
- Heatmap-Modus über mehrere Tracks
- HEIC/RAW-Support fürs Geotagging
- App-Icon (.icns)
- Notarisierte Distribution für andere Macs

---

## [0.1.0] — 2026-05-19

Erstes MVP. Animator + Geotagger funktional, native macOS-App-Bundle baubar.

### Hinzugefügt

**Projekt-Skelett**
- `pywebview`-basierte Suite-Architektur (`app.py` + `core/` + `ui/`)
- venv-Setup unter `.venv/`, Dependencies in `requirements.txt`
- `run.sh` für Dev-Start, `build.sh` für `.app`-Build, `scripts/backup.sh` für Snapshots

**Core-Module (`core/`)**
- `gpx.py` — `parse_gpx()`, `downsample()`, Kumulative Distanz + Zeit pro Punkt, `TrackStats`-Dataclass
- `exif.py` — `read_datetime()`, `read_gps()`, `write_gps()` via `piexif` (JPEG/TIFF)
- `geotag.py` — `match_photos()` mit Bisect-Suche, `derive_offset_from_reference()` (Karten-Klick → Sekunden-Offset)
- `backup.py` — `make_photo_backup()` mit 20er-Retention
- `animator.py` — Refactored aus `GPX/gpx_animator.py`, jetzt Config-Klasse + Progress-Callback + 6 Map-Styles
  - `find_ffmpeg()` mit Fallback auf `/opt/homebrew/bin/ffmpeg`

**Animator-Modul (UI + Backend)**
- 6 Map-Styles (Satellite 3D, Satellite + Streets, Outdoor, Streets, Light, Dark)
- Slider: Pitch (0–80°), Rotation (0–60°), Terrain-Übertreibung (0–4×)
- Optionen: 3D-Terrain on/off, Stats-Overlays on/off
- Inputs: Duration (s), Hold (s), Width, Height, Track-Color
- Live-Progress-Overlay (Prozent + Status-Text) mit Polling
- Nach Render: Inline-Video-Player + "Im Finder zeigen"-Button
- Renders landen in `~/Library/Application Support/Reisezoom GPS Studio/_renders/`

**Geotagger-Modul (UI + Backend)**
- GPX laden → Track auf Mapbox-Outdoor-Karte
- Fotos laden: Einzelauswahl oder ganzer Ordner
- Foto-Grid (260 px Sidebar) mit EXIF-Orientation-korrekten Thumbnails
- Status-Badges pro Foto: getaggt (orange), schon GPS (grün), Fehler (rot)
- 3 Offset-Modi:
  - **Auto** — direkt EXIF-Zeit gegen Track-Zeit, kein Offset
  - **Referenz-Foto** — Foto wählen + Karten-Klick → Sekunden-Offset
  - **Manuell** — H/M/S + Vorzeichen-Inputs, Live-Update
- Marker auf Karte synchron zum Offset, Klick auf Marker = Foto-Auswahl
- Übersichtskasten: `n Fotos werden getaggt, m außerhalb, k ohne EXIF-Zeit`
- Auto-Backup-Checkbox (ZIP nach `~/Library/Application Support/Reisezoom GPS Studio/_backups_photos/`)
- Schreibe-Bestätigung als Toast inkl. Backup-Pfad

**Suite-Frame & UI**
- Sidebar (240 px) mit Modul-Navigation
- Dark Theme, Akzentfarbe `#ff6b35` (matcht Track-Animation)
- System-Sans (-apple-system / Inter), Toasts unten rechts
- Tabular-Numerals für alle Zahlenwerte
- Mapbox GL JS v3.12.0 als Karten-Engine

**Tests (`tests/`)**
- `test_core.py` — 5 Smoke-Tests (GPX, EXIF-Roundtrip, Match, Offset, Backup)
- `test_geotagger_e2e.py` — End-to-End mit 6 generierten Test-Fotos, prüft Schreibvorgang per piexif-Verifikation
- `test_app_start.py` — Headless-Bridge-Test (alle JS-API-Methoden ohne Window)
- `test_animator_render.py` — Mini-Render (5 s, 540 p, dark) + `ffprobe`-Frame-Count-Check
- `make_test_photos.py` — generiert 6 JPGs mit EXIF an exakten Track-Punkten + `_meta.json`

**Build-Pipeline**
- `ReisezoomGPSStudio.spec` (PyInstaller)
- `build.sh` baut + signiert ad-hoc + installiert nach `/Applications/`
- 166 MB .app-Bundle, arm64-only
- Bundle-ID `com.reisezoom.gpsstudio`, Version 0.1.0

### Bekannte Limitationen
- Geotagging: JPEG/TIFF via `piexif`. RAW (CR3/NEF/ARW/RAF/DNG/HEIC etc.) via `exiftool` — siehe [Unreleased].
- Mapbox-Token public hardcoded — für externe Distribution muss das gegen User-Eingabe oder eigenen Server-Proxy ersetzt werden
- ffmpeg muss systemweit installiert sein (`brew install ffmpeg`)
- Playwright/Chromium muss einmalig vorhanden sein (wird beim Erst-Setup von `run.sh` installiert)
- Build nur für Apple Silicon (arm64). Universal-Build (auch x86_64) noch nicht eingerichtet.
- Kein App-Icon — Standard-Python-Bookmark wird angezeigt

### Tech-Stack
- Python 3.14 (system-`python3` aus Homebrew)
- pywebview 6.2.1 (Cocoa/WKWebView)
- gpxpy 1.6.2
- piexif 1.1.3
- Pillow 12.2.0
- Playwright 1.60.0 (chromium-headless-shell für Render)
- PyInstaller 6.20
- Mapbox GL JS 3.12.0 (CDN, WebView lädt zur Laufzeit)
