# Umbau: Bibliothek, Touren, Versionen, Projekte

**Beschlossen mit Marc am 02.09.2026** in einer Fragerunde (`/grilling`).
Auslöser: Eine neu importierte Masca-Tour meldete „steckt in 5 Projekten",
obwohl sie in keinem steckte. Die Ursache war kein Fehler, sondern das
Datenmodell — und das Durchdenken hat es als Ganzes aufgemacht.

**Dieses Dokument ist die Wahrheit für den Umbau.** Widerspricht ihm Code,
andere Doku oder Erinnerung, gilt es; der Widerspruch gehört behoben.
Änderungen hier mit Datum und Grund nachtragen.

---

## 0. Wo das Problem herkam

Die App kennt heute drei Identitäten und benutzt sie an verschiedenen
Stellen verschieden:

| Speicher | Datei | Schlüssel |
|---|---|---|
| Archiv (Datei-Index) | `library.db` | `tracks.path` — der **Dateipfad** |
| Tour-Register (Fakten + Kette) | `touren.json` | `geo_hash` — die **Geometrie** |
| Projekte | `projekte.json` | `kontext` (bei Solo = `geo_hash`) |

Daraus folgen die Symptome, die uns seit Wochen begegnen:

- **„Tour" bedeutet zweierlei.** Im Archiv ist eine Tour eine *Datei*, im
  Register eine *Fassung*. Dieselbe Strecke in drei Ordnern sind drei
  „Touren" im Archiv, aber eine in der Sammlungszählung.
- **Kein Import-Weg prüft die Geometrie.** Ordner-Scan vergleicht Pfad und
  Datum, `library_import_files` Name und Größe, der Archiv-Dialog Bytes.
  Der `geo_hash` wird berechnet und für „kenne ich das schon" nie benutzt.
- **Heilen erzeugte ein Projekt.** Das Öffnen einer Tour legt ein
  Auto-Projekt an; heilt man danach, hat dieses Projekt zwei geo_hashes —
  dieselbe Tour vorher und nachher. Daher „111 × Standard".
- **`track_backups/` wächst unbegrenzt** und wird beim Start über
  *Dateinamen* Fassungen zugeordnet. Bei Marcs Masca hat das richtig
  geraten. Geraten bleibt es.

---

## 1. Die Begriffe

| Begriff | Bedeutung | Vorher |
|---|---|---|
| **Tour** | Eine Strecke, im Archiv. Hat eine Reihe von Versionen. | hieß auch schon Tour, meinte aber eine Datei |
| **Version** | Ein Stand dieser Tour (aufgezeichnet, geheilt, zugeschnitten). | hieß **Fassung** |
| **Projekt** | Ein **Vorhaben**, aus dem mehrere Ausgaben entstehen. | hieß auch Projekt, meinte teils den Arbeitsstand |
| **Sammlung** | Eine Liste von Touren. | unverändert |
| **Arbeitsstand** | **Nur noch** ein Eintrag im 🕘-Verlauf eines Projekts. | meinte dreierlei |
| ~~Reise~~ | **Ersatzlos gestrichen.** Ein Projekt mit mehreren Touren ist ein Projekt. | stand unerklärt in der Oberfläche |

„Fassung" → „Version" ist eine Umbenennung in **DE, EN und ES**.

---

## 2. Datenseite und Projektseite

Marcs Formulierung, 02.09.2026: *„Archiv und Inspector arbeiten mit der
Tour, der Rest mit einem Projekt."*

**Datenseite** — arbeitet an Daten, erzeugt **nie** ein Projekt:
- **Archiv** — Touren finden, ordnen, löschen
- **Inspektor** — Werkstatt an der Tour, erzeugt **Versionen**
- **Geotagger** — Werkstatt an den Fotos, schreibt ins EXIF

**Projektseite** — braucht ein Projekt:
- Animator, Tour-Karte, Web-Karte, Höhen-Animator

**Ein Projekt entsteht beim Öffnen eines Produktionsmoduls** — sofort
sichtbar und nach der Tour benannt. Die heutige unsichtbare Zwischenstufe
(Auto-Projekt beim bloßen Öffnen, das „nach oben wandert", sobald man etwas
baut) fällt **ersatzlos** weg.

### Was hängt woran

**An der Tour** (Wiederfinden): Name, Favorit, Schlagworte, Notiz,
Aktivität, Sammlungen, Versionsreihe, „hinzugefügt am".
**An der Version**: Geometrie, „erstellt am", Herkunft.
**Im Projekt** (Aussehen): Farbe, Linien, Overlays, Schilder, Kamera,
Render-Einstellungen, Foto-Zuordnung.

> **Wichtig:** Diese Merkmale hängen an der **Tour-Identität**, nicht am
> `geo_hash`. Heute liegt `track_meta` am geo_hash, also an der Version —
> beim Heilen werden Schlagworte und Favorit der alten Version gelöscht
> (`core/library.py:2332 track_hash_migrieren`). Schlagworte müssen eine
> Heilung überleben.

### Der Geotagger

Er steht auf der Datenseite, weil sein Ergebnis in **fremden Dateien**
landet — derselbe Eingriff wie das Heilen. Er hat faktisch schon heute
keinen Projektzustand: `cam_offsets` und `tz_offset_minutes` liegen global
in `settings.json`, Fotoreferenzen speichert das Projekt bewusst nicht
(`core/sessions.py:279`).

- **Zeitversatz → an die Kamera.** Ein Fehler der Kamerauhr, der über
  Reisen hinweg derselbe bleibt (Marc-Regel: pro Kamera, nie global).
- **Zeitzone → am Track**, und ohnehin daraus errechenbar:
  `cgeo.zeitzone_raten` misst ohne Netz, welche Verschiebung die Fotos am
  besten in den Track legt.
- **Kein zweiter dauerhafter Speicher für Fotopositionen.** Die Zuordnung
  lebt während der Sitzung im Speicher; wer ohne Schreiben schließt,
  verliert sie. Ein dritter Ort neben EXIF und Projekt wäre genau die
  Doppelung, die wir hier abbauen.
- **Fotos bekommen (vorerst) kein Archiv.** Bewusst offen gelassen.

---

## 3. Die Bibliothek

**Die Bibliothek ist die Wahrheit. Beobachtete Ordner sind nur Quellen.**

Jede aufgenommene Tour liegt als Kopie in der Bibliothek, eine Datei je
Version, komprimiert (GPX ist Text und schrumpft auf etwa ein Zehntel:
5 000 Touren ≈ 250 MB statt 2,5 GB). Verschwindet die Quelldatei, bleibt
die Tour vollständig.

**Alles liegt in der Bibliothek, auch die Datenbank.** Außerhalb steht nur
der Pfad dorthin. Marc, 02.09.2026: *„wenn wir hier trennen haben wir schon
wieder mischmasch."* Daraus folgt, dass mehrere Bibliotheken möglich wären
und die Cloud nichts anderes ist als eine Kopie der Bibliothek.

### Drei Riegel

Eine SQLite-Datenbank in einem Cloud-Sync-Ordner **geht kaputt** — Dropbox,
iCloud Drive, OneDrive und Google Drive tauschen Dateien mitten im
Schreibvorgang aus. Externe Platte und NAS sind unkritisch, solange nur eine
Instanz die Bibliothek offen hat. Deshalb:

1. **Cloud-Sync-Ordner werden erkannt und als Ort abgelehnt** (mit
   Erklärung, nicht nur Warnung). Externe Platte und NAS bleiben erlaubt.
2. **Sperrdatei** — zwei GPS Studios können dieselbe Bibliothek nicht
   gleichzeitig öffnen.
3. **Prüfung beim Start**; bei Beschädigung wird die letzte Sicherung
   angeboten, statt kommentarlos neu anzufangen.

### Regeln

- **Nie in fremde Dateien zurückschreiben.** Heilen erzeugt eine Version in
  der Bibliothek. Wer die geheilte Fassung draußen haben will, **exportiert
  von Hand**. Damit entfallen `track_backups/`, die Adoptionslogik und das
  Raten über Dateinamen ersatzlos.
- **Externe Änderung an der Quelldatei: melden, nicht handeln.** Hinweis an
  der Tour „Die Quelldatei hat sich geändert — als neue Version übernehmen?"
  Heute entsteht stillschweigend eine Fassung `extern`.
- **Alles kopieren**, nicht nur Benutztes — sonst kommt der Mischmasch
  zurück.
- **Mehrere Bibliotheken: nur nicht verbauen.** Ein Ort, änderbar, fertig.
  Kein Umschalter, keine Zuletzt-benutzt-Liste, bis jemand danach fragt.
- **Die Cloud wird für den Umbau stillgelegt** und danach als eigenes Paket
  neu gebaut, dann als Bibliothekskopie. Sie ist ohnehin halb kaputt: Der
  Abgleich liest `sessions.json`, die es seit der Projekt-Umstellung nicht
  mehr gibt (`app.py:5741`), also enthalten hochgeladene Umschläge keine
  Projekte.

### Bibliothek nicht erreichbar

Anhalten und sagen, was los ist: Archiv im Nur-Lesen-Zustand mit dem
gemerkten Bestand, deutlicher Hinweis, Knopf „erneut suchen" und „anderen
Ort wählen". **Niemals stillschweigend eine leere neue Bibliothek anlegen** —
das ist der Moment, in dem Leute glauben, alles sei weg.

---

## 4. Versionen

- Ein Projekt merkt sich **je Tour eine Version**. Beim Anlegen die
  neueste; danach bleibt sie fest, auch wenn später Version 4 dazukommt.
  So fliegt nichts auseinander.
- **Die Version ist im Projekt jederzeit umstellbar**, mit Auswahl und
  Vorgabe „neueste".
- **Eine Inspektor-Sitzung ergibt genau eine Version.** Undo arbeitet
  innerhalb der Sitzung, die Version entsteht beim Übernehmen.
- **Version löschen: ja, wenn kein Projekt sie benutzt.** Sonst gesperrt,
  mit Angabe welches Projekt sie hält. Die neueste ist nie löschbar.
- **Zwischenstände werden überschrieben:** Wird die vorherige Version von
  keinem Projekt benutzt, ersetzt die neue sie stillschweigend.

---

## 5. Löschen

Nach dem Umbau sind es **zwei verschiedene Vorgänge**, die heute derselbe
sind:

**Datei im beobachteten Ordner gelöscht** → Die Tour **bleibt**, die Quelle
wird als fehlend vermerkt. Ein Archiv-Filter „Quelle fehlt" macht solche
Touren auffindbar, damit die Bibliothek keine Müllhalde wird. Das ist eine
Verhaltensänderung gegenüber heute (dort verschwindet die Tour beim nächsten
Einlesen) und braucht einen Satz im Onboarding und im Handbuch.

**Tour in der Bibliothek gelöscht, die in Projekten steckt** → **gesperrt**,
mit einem bewussten Zweitweg: Der Dialog nennt die Projekte und bietet
„Tour und diese 5 Projekte löschen" als eine Aktion an.

> Durchgehende Regel: **Ein Projekt hat immer seine Daten.** Es gibt keinen
> Zustand, in dem ein Projekt beim Öffnen ins Leere greift.

---

## 6. Import

Der Import erkennt die Tour an der Geometrie, **bevor** er kopiert:

- **Unbekannt** → aufnehmen, ohne Rückfrage.
- **Bekannt, liegt schon als Tour im Archiv** → *„Diese Tour ist schon da:
  ‹Name›, Version 1 von 2, geheilt am 29.08."* Standardknopf „Im Archiv
  zeigen", Zweitweg „Trotzdem als eigene Tour aufnehmen".
- **Bekannt, nur als Version** → *„Das ist die ungeheilte Version 0 dieser
  Tour."* mit „Version wiederherstellen", „Als eigene Tour aufnehmen",
  „Abbrechen".

Zusätzlich darf der Import **unscharf** erkennen (gleicher Start/Ziel,
ähnliche Länge, gleicher Tag) und ein Zusammenlegen **vorschlagen** — aber
niemals automatisch verketten. Exakte Geometrie bleibt das Einzige, was die
App von sich aus behauptet.

---

## 7. Das Archiv

- **Eine Karte je Tour**, nicht je Datei. Darauf klein „V3", nur wenn es
  mehr als eine Version gibt, und „hinzugefügt am".
- **Im Detail:** Versionsreihe (je Version „erstellt am" und Herkunft),
  Herkunft der Tour (aus welchen Quelldateien sie stammt), Sammlungen,
  Projekte.
- Die Herkunftsliste zeigt nur, wo etwas herkam, und bietet „im Finder
  zeigen". **Sie darf nicht zum zweiten Bedienweg werden**, sonst ist die
  Dateisicht durch die Hintertür zurück.
- **Sammlungen hängen an der Tour**, nicht an der Version. Welche Version
  benutzt wird, ist Sache des Projekts.

---

## 8. Onboarding beim ersten Start

Drei Schritte, **ohne Mapbox-Konto und ohne Cloud** — sonst steht ein
Neuling vor einer Anmeldung, bevor er die App gesehen hat.

1. **Wo soll die Bibliothek liegen?** Brauchbare Vorgabe, Hinweis „später
   änderbar".
2. **Welche Ordner sollen als Quelle beobachtet werden?** Überspringbar.
   Bei bestehenden Installationen sind die bereits beobachteten Ordner
   **vorausgewählt**.
3. **Fertig** — direkt ins Archiv mit einem großen „Touren aufnehmen".

Damit ist zugleich der Erstnutzer-Punkt aus `ROADMAP.md` Phase 1 (Audit D1)
erledigt.

---

## 9. Umzug des Bestands

Ein **Umzugstool**, das vorher zeigt, was es tun wird, und eine Sicherung
anlegt.

- **Das Archiv wird neu aufgebaut** — es ist abgeleitet und entsteht aus den
  Quellordnern.
- **Umziehen muss, was nicht wiederherstellbar ist:** Schlagworte,
  Favoriten, Notizen, Sammlungen, Versionsreihen und Projekte. Der Umzug
  läuft über den `geo_hash`, den es vorher und nachher gibt.
- **Auto-Projekte ohne Arbeit werden verworfen** — kein Modul mit
  Einstellungen, kein eigener Name. Die Prüfung existiert bereits
  (`core/projekte.modul_arbeit`). Damit ist die Liste von 111 ×
  „Standard" wieder lesbar. Alles mit echter Arbeit zieht mit um, samt
  gepinnter Version.

---

## 10. Der Umbau in Schnitten

**Stand 02.09.2026: Schnitt 1–4 umgesetzt.** Was jeder gebracht hat, steht
unten; die Wächter dazu sind in Klammern genannt.


Jeder Schnitt ist für sich lauffähig und auslieferbar.

**Schnitt 1 — Bibliothek einführen.** Ort wählbar, Onboarding, drei Riegel,
Datenbank zieht mit, jede Tour wird beim Aufnehmen kopiert, Umzugstool,
Cloud stilllegen. *Nach außen ändert sich fast nichts* — die Wahrheit liegt
danach in der Bibliothek.

**Schnitt 2 — Identität auf die Tour.** Tour-ID statt Dateipfad als
Schlüssel, Dateien werden zur Herkunft, eine Karte je Tour, Duplikate
verschmelzen, `track_meta` und Sammlungen von `geo_hash` auf Tour-ID,
„Fassung" → „Version" in DE/EN/ES. *Masca liegt danach einmal da.*

**Schnitt 3 — Nie zurückschreiben.** Inspektor „Im Archiv ersetzen" wird
„Als neue Version übernehmen"; `track_backups` und Adoptionslogik raus;
Versionen löschen mit Sperre; Zwischenstände überschreiben; Export von Hand;
externe Änderung melden statt handeln.

**Schnitt 4 — Projekte aufräumen.** Auto-Projekte weg, Projekt entsteht beim
Öffnen eines Produktionsmoduls, Versionsauswahl je Tour, Löschregeln aus
Abschnitt 5, Begriffe vereinheitlichen, „Reise" raus.

**Schnitt 5 — Geotagger auf die Datenseite.** Zeitversatz an die Kamera,
Zeitzone aus dem Track, kein Projektzustand mehr.

**Schnitt 6 — Cloud als Bibliothekskopie** (02.09.2026 gebaut). Das alte
Umschlag-Modell (`core/cloud/archiv.py`) ist ersatzlos entfallen; die Cloud
spiegelt jetzt die Bibliothek. Was hochgeht, steht in
`core/cloud/bibliothek.py`. Marc: *„alten cloud teil löschen, neuen
hochladen, fertig aus"* — dafür gibt es „Fremdes entfernen".

**Danach, als eigenes Paket:** Fotoarchiv (offen, siehe Abschnitt 2).

---

## Offen gelassen

- **Fotoarchiv** — Fotos sind Material einer Werkstatt, aber nirgends
  verzeichnet. Bewusst vertagt (eigenes Vorhaben: Vorschaubilder,
  Duplikate, Speicherplatz).
- **Umbenennung des Produktnamens** auf „GPS Studio" (siehe `IDEAS.md` §45)
  — technische Namen erst zu 1.0, hier nicht mitgezogen.


---

## 11. Was beim Bauen dazugelernt wurde (02.09.2026)

Sechs Dinge sind erst beim Umsetzen aufgefallen. Sie stehen hier, weil sie
Entscheidungen verändert oder geschärft haben.

**Die Bibliothek muss beim EINLESEN gefüllt werden, nicht nur beim Umzug.**
Zuerst kopierte nur das Umzugstool. Damit hing jede neu eingelesene Tour
weiter an ihrer Datei draußen — die Bibliothek war für sie kein Speicher,
sondern wieder nur ein Index. Jetzt läuft nach jedem Einlesen eine Aufnahme
(`AUFNAHME_HOOK` → `Api._archiv_aufnehmen`), die fehlende Kopien anlegt und
neue Touren registriert.

**Zwischenstände dürfen nur weggeworfen werden, wenn das WERKZEUG sie
erzeugt hat.** Die erste Fassung der Regel („was kein Projekt hält, wird
ersetzt") hätte beim ersten Heilen die eingelesene Ursprungsversion gelöscht.
Die Tour hätte damit ihren Anfang verloren, sobald jemand die Quelldatei
draußen wegräumt. Jetzt wird zusätzlich die Herkunft geprüft (`quelle ==
"werkzeug"`). — `tests/test_nie_zurueckschreiben.py`

**Wiederherstellen musste die Version ans Ende der Kette stellen.**
`fassung_anlegen` tut nichts, wenn die Version längst in der Kette steht —
der Rollback blieb dadurch wirkungslos, das Archiv zeigte weiter die geheilte
Fassung. Jetzt bekommt die zurückgeholte Version eine neue, höchste Nummer.
— `tests/test_inspektor_ersetzen.py`

**Eine neue Version erbt den Namen der TOUR, nicht den der Datei.**
Sonst hieß die geheilte Masca plötzlich „runde" statt „Barranco de Masca",
und die Suche fand sie nicht mehr.

**Die App hätte sich selbst aus ihrer Bibliothek aussperren können.**
Die Sperre (Riegel 2) prüfte nicht, ob der Halter der eigene Prozess ist.
Beim Bibliothekswechsel oder nach „erneut suchen" wäre die zweite Sperre
gescheitert. — `tests/test_bibliothek.py`

**`cloud_status()` verschwieg die Stilllegung.** Die Oberfläche erfuhr nur
„nicht sichtbar" und ließ den Cloud-Abschnitt kommentarlos weg — die
Erklärung wäre nie erschienen. — `tests/test_cloud_versteckt.py`

### Nachprüfung am 02.09.2026 (zweiter Durchgang)

**Der Versionsspeicher enthielt nicht immer GPX.** `version_ablegen` packte
die Quelldatei byte-genau — bei einer `.fit` lag danach ein FIT-Rohblock unter
dem Namen `<Version>.gpx.gz` in der Bibliothek. Nicht lesbar für uns, nicht
aufnehmbar für einen zweiten Rechner, und die Cloud spiegelte ihn mit. Die
Umwandlung sitzt jetzt **in der Ablage selbst** (`cbib._als_gpx`) und nicht
bei den vier Aufrufern — einer davon vergisst sie sonst wieder. Schon
abgelegte Rohdaten repariert ein einmaliger Lauf beim Start
(`cbib.versionen_reparieren`, angestoßen von `Api._versionen_gpx_pruefen`,
Stempel `gpx_geprueft` in `bibliothek.json`). Repariert wird **zuerst aus dem
Inhalt selbst** (`_aus_sich_selbst_heilen`): Die Daten fehlen ja nicht, sie
stehen nur im falschen Format — und die Quelldatei von damals ist auf einem
zweiten Rechner nie vorhanden. Erst danach wird die Quelle im Archiv gesucht.
Was sich weder so noch so retten lässt, **bleibt liegen**; gelöscht wird
nichts. Bei Marc: 2 von 762 Versionen, beide aus sich selbst geheilt.
— `tests/test_version_ist_gpx.py`

**Was der Start anstößt, muss vorher gebaut sein.** `_bib_oeffnen()` zieht das
Archiv auf, das Archiv startet seine Hintergrundläufe, und der erste davon
greift auf `self._start_lock` zu — das dreißig Zeilen später entstand. Ein
Wettlauf, der an drei von vier Starts verlor. Die Regel gilt allgemein,
deshalb prüft der Wächter sie allgemein: Jedes Feld, das ein Startlauf liest,
muss vor `_bib_oeffnen()` zugewiesen sein. — `tests/test_start_reihenfolge.py`

**„Ist das unsere Kopie?" darf nicht an der Endung hängen.** `.gpx.gz` war
das Erkennungsmerkmal des Versionsspeichers — bis beobachtete Ordner
ebenfalls `.gpx.gz` einlesen sollten (Strava-Exporte). Die Datei eines
Nutzers wäre als unser Speicher gezählt und beim Aufräumen sogar aus dem
Archiv gelöscht worden. Jetzt sagt es die Spalte `tracks.speicher`.

**Eine versprochene Funktion braucht einen Bedienweg.** `projekt_version_setzen`,
`tour_version_loeschen` und `tour_version_exportieren` gab es in `app.py`,
aufgerufen hat sie niemand. Aus Nutzersicht existierten sie nicht.
— `tests/test_bruecken_haben_aufrufer.py`

**Eine Tour, eine Zahl.** Archiv, Inspektor und Höhen-Animator rechneten
Höhenmeter jeder für sich; der Inspektor summierte jeden Höhenunterschied und
lag je nach Aufzeichnung 1 bis 35 Prozent zu hoch. Die Oberfläche rechnet
jetzt mit `hoehenmeter()` aus `ui/js/util.js` — der JS-Fassung von
`core/gpx._compute_ascent_descent`, samt Etappen-Trennung. **Wer die eine
ändert, ändert die andere mit.** — `tests/test_hoehenmeter_einig.py`

**„Doppelte finden" durfte die Bibliothekskopie anbieten.** Der Dialog wirft
Dateien des Nutzers in den System-Papierkorb — das ist in Ordnung und bleibt.
Nicht in Ordnung war, dass unsere eigene Kopie zur Auswahl stand: Wer sie
angehakt hätte, hätte der Tour die Grundlage genommen. Speicher-Zeilen sind
draußen, und `library_trash` weist Pfade im Versionsspeicher zurück.
— `tests/test_doppelte_nicht_bibliothek.py`

---

## 12. Wächter

| Datei | Was sie festhält |
|---|---|
| `tests/test_bibliothek.py` | die drei Riegel, Trackspeicher, Umzug an einen anderen Ort |
| `tests/test_umzug.py` | der Bestand zieht vollständig um; bei Zweifel bleibt alles liegen |
| `tests/test_nie_zurueckschreiben.py` | **die Quelldatei bleibt byte-genau unangetastet** |
| `tests/test_projekte_schnitt4.py` | Öffnen legt kein Projekt an; Versionswahl; Löschregeln; „Reise" ist weg |
| `tests/test_inspektor_ersetzen.py` | Kette, Pinning, Rollback — auf den neuen Vertrag umgestellt |
| `tests/test_keine_testernamen.py` | keine Tester-Namen im öffentlichen Repo |
| `tests/test_version_ist_gpx.py` | im Versionsspeicher liegt GPX, auch bei FIT/TCX/KML |
| `tests/test_start_reihenfolge.py` | Startläufe lesen nichts, was es noch nicht gibt |
| `tests/test_hoehenmeter_einig.py` | Python und Oberfläche rechnen dieselben Höhenmeter |
| `tests/test_doppelte_nicht_bibliothek.py` | „Doppelte finden" fasst unsere Kopie nicht an |
| `tests/test_bruecken_haben_aufrufer.py` | versprochene Brücken sind bedienbar |


---

## 13. Die Cloud (Schnitt 6, 02.09.2026)

**Die Cloud ist eine Kopie der Bibliothek** — kein zweites Datenmodell mehr.

| Objekt | Inhalt |
|---|---|
| `bib/inhalt` | Verzeichnis aller Objektnamen |
| `bib/nutzerdaten` | Schlagworte, Favoriten, Notizen, eigene Namen, Farben, Sammlungen, beobachtete Ordner |
| `bib/projekte` · `bib/touren` | `projekte.json`, `touren.json` |
| `bib/track/<geo_hash>` | eine Version, genau die Datei aus dem Versionsspeicher |
| `bib/bild/<datei>` | selbst gewählte Titelbilder |

**Nicht dabei:** `library.db` (abgeleitet — wird am zweiten Rechner neu
aufgebaut), Vorschau- und Kartenbilder (kommen von Mapbox), Fotos (gehören
dem Nutzer und lagen nie in der App).

**Das Inhaltsverzeichnis ist keine Bequemlichkeit, sondern nötig.** Der Server
kennt nur Hash-Namen und gibt keine Klartextnamen preis. Ohne `bib/inhalt`
könnte ein frischer Rechner nicht wissen, was oben liegt — genau daran sind
die ersten beiden Live-Versuche gescheitert (erst drei Objekte und keine
Tour, dann 746 von 762, weil die Namen aus dem Tour-Register geraten wurden).

**Es wird nie automatisch gelöscht.** „Liegt oben, kenne ich nicht" heißt bei
zwei Rechnern meistens „vom anderen Rechner". Aufräumen ist ein eigener,
zweifach bestätigter Knopf; Entferntes landet im Papierkorb des Servers.

**Ohne eingerichtete Cloud passiert nichts** — kein Netz, kein
Schlüsselbund, kein Wächter-Thread. Wächter: `tests/test_cloud_bibliothek.py`,
Abschnitt 1.

**Live geprüft am 02.09.2026** gegen den echten Server: 765 Objekte hoch
(22,5 MB, 140 s), 727 Objekte des alten Modells entfernt, ein zweiter,
leerer Rechner holte daraus 766 Objekte und hatte danach 762 Versionen,
742 Touren im Archiv, 4 Sammlungen mit 444 Zuordnungen und 79 Projekte.
Ein zweiter Abgleich übertrug **nichts** (alles unverändert).

`core/projektpaket.py` ist beim Aufräumen aus `core/cloud/archiv.py`
herausgelöst worden: Der `.rzproj`-Export hat mit der Cloud nie etwas zu tun
gehabt und wäre sonst mit gelöscht worden.
