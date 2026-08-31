# Artikel-Briefing: „Wie mache ich aus meiner Wanderung ein Video mit Karte?“

**Artikel 1 von 10**
**Für:** eigener Chat, der den Artikel schreibt
**Ziel-Website:** reisezoom.com (deutscher Blogpost)
**Erstellt:** 31.08.2026 · Grundlage: Painpoint-Recherche + Prüfung am Live-System

---

## 0 · Zuerst lesen (Pflicht)

1. **Skill `reisezoom-content-style` aufrufen** — verbindlich für diesen Artikel.
2. **`CLAUDE.md`**, Abschnitte „Artikel-Auffindbarkeit — Absatzbau" und „Titelbilder".
3. Dieses Briefing.

**Stilregeln in Kurzform:** H2 als echte Nutzerfrage · **Antwort im ersten Satz** ·
jeder Abschnitt selbsttragend (Produkt beim Namen nennen, kein „wie oben beschrieben")
· Richtwert ~120 Wörter je Abschnitt · **Marcs Stimme**: persönlich, praxisnah, ehrlich
inklusive eigener Fehler, kein Handbuchton · kein FAQ-/HowTo-Schema von Hand.

---

## 1 · Die Kernbotschaft aller zehn Artikel

**Der Artikel löst das Problem des Lesers — und zeigt dabei, wo die Grenze liegt.**

Auf `reisezoom.com/gps/` gibt es Werkzeuge, die **direkt im Browser** laufen: kein
Download, kein Konto, nichts wird hochgeladen. Sie decken den häufigsten Fall ab.
**Die Download-App kann deutlich mehr** — sie ist das eigentliche Werkzeug, die
Webversion ist der schnelle Einstieg.

**So wird das erzählt:** erst die Lösung im Browser (wo es dort geht), dann ehrlich,
was die App zusätzlich kann. **Nicht** das Webtool schönreden — wer damit scheitert,
kommt nie zur App. Und **nicht** die App künstlich hochreden — die Grenze soll aus dem
Problem folgen, nicht aus dem Verkaufswunsch.

**Der Satz, der sinngemäß in jeden Artikel gehört:**
> Für den schnellen Fall reicht der Browser. Wer regelmäßig mit Touren arbeitet, nimmt
> die App — dort ist alles an einem Ort, und sie kann Dinge, die im Browser nicht gehen.

---

## 2 · Thema und Beleglage

**Der Dauerbrenner schlechthin.** Nahezu identisch formuliert von 2011 bis 2025:
- magix.info (2011 + 2013): nur eine Karte, nur gerade Linien, keine Richtungssteuerung
- forum.mikemoto.de (06.06.2017): BaseCamp „zappelnder Pfeil", Doarama unbrauchbar,
  Relive kann kein GPX, GPX Animator veraltet. Ernstgemeinter Rat eines Nutzers:
  100+ Einzelbilder in GIMP bauen
- gs-forum.eu (05.03.2017): Route Generator zwingt zum **Nachzeichnen** der Route
- naviboard.de (22.12.2020): Relive nur Satellit **ohne Nordausrichtung**; BaseCamp
  animiert, **exportiert aber kein Video** → Workaround Bildschirmrecorder
- trueadventure.de (24.09.2025): Google Earth Studio verlangt Chrome + Google-Konto;
  GPX Animator bricht mit Kartendatei-Fehler ab

**Suchintention:** Anleitung. Der Leser will wissen, *wie* es geht — nicht, welches
Werkzeug das beste ist. Das ist Artikel 2.

## 3 · Der Lösungsweg — das ist ein App-Thema

**Video-Rendern gibt es im Browser nicht.** Hier führt der Artikel zum Download, und
das ist in Ordnung: Wer ein Video will, erwartet ein richtiges Programm.

**Modul Animator.** Track laden, Kartenstil wählen, Kamerafahrt einstellen, rendern.
Heraus kommt eine MP4-Datei.

**Die Punkte, die den Unterschied machen** — jeder ist ein belegtes Problem der oben
genannten Werkzeuge:
- **Läuft lokal** — kein Upload, keine Warteschlange, kein Konto
- **Bis 4K**, ohne Wasserzeichen, **beliebig oft wiederholbar**
- **Kartenstil frei wählbar**, Nordausrichtung möglich (das naviboard-Problem von 2020)
- **Kamerafahrt mit Keyframes** — das können weltweit nur vier Werkzeuge
- **Alpha-Kanal** (ProRes 4444): Animation ohne Karte rendern und im Schnittprogramm
  über eigenes Material legen
- **Mehrere Touren gleichzeitig** (Schwarm, bis 96) — die Funktion, für die Ayvri
  geliebt wurde und die seit dessen Aus 2022 im Markt fehlt

**Braucht einen Mapbox-Token** (kostenlos). Ehrlich sagen, erklären warum (3D-Gelände,
Satellitenbilder) und zeigen, wie man in zwei Minuten an einen kommt.

## 4 · Was der Browser hier beitragen kann

**Kein Video** — aber der Leser kann seinen Track sofort auf `reisezoom.com/gps/`
ansehen, das Höhenprofil prüfen und ihn **vorher säubern**. Das lohnt sich, weil
GPS-Ausreißer im fertigen Video als Zacken sichtbar werden. Der natürliche Übergang:
*„Erst im Browser schauen, ob der Track sauber ist — dann in der App rendern."*

## 5 · Was NICHT behauptet werden darf

- ❌ „Geht auch im Browser" → Video-Rendern gibt es nur in der App
- ❌ „Ohne Mapbox-Token" → für den Animator-Render wird er gebraucht
- ❌ **Keine Renderzeiten nennen, die nicht gemessen wurden.** Sie hängen an Dauer,
  Bildrate, Auflösung und Rechner — Marc soll einen echten Wert von sich beisteuern

## 6 · Folgefragen (im selben Artikel, nicht als eigene Seiten)

1. Wie lange dauert das Rendern? → echter Wert von Marcs Rechner
2. Welche Auflösung für YouTube? → 1080p reicht, 4K wenn das Material es hergibt
3. Was, wenn der Track keine Zeitstempel hat? → geht; die Animation läuft dann über
   die Punkte statt über die Uhr
4. Kann ich mehrere Touren zeigen? → ja, Schwarm
5. Wie kommt das Video ins Schnittprogramm? → MP4 direkt, oder Alpha-Export als Overlay

---

## Verlinkung

**Aus dem Artikel heraus:**
- `https://reisezoom.com/gps/` — das Webtool (Hauptlink, kontextnah, mehrfach)
- `https://reisezoom.com/reisezoom-gps-studio/` — die Tool-Vorstellung (Hub)

**In den Artikel hinein:** Der Hub-Artikel bekommt einen Link hierher, sobald er steht.

## Was Marc liefern muss (NICHT erfinden!)

- [ ] **Der eigene Fall** — welche Tour, was ist passiert, was war das Ergebnis
- [ ] **Screenshots** vorher/nachher
- [ ] **Titelbild:** 16:9, mindestens 1200 px breit, **kein Text im Bild**

Der schreibende Chat setzt dafür Platzhalter und **fragt gezielt nach**, statt eine
Anekdote zu erfinden. Ohne Marcs echte Geschichte ist es ein Handbuchtext — und genau
die Erfahrung unterscheidet uns von den Ein-Personen-Werkzeugen der Konkurrenz.

## Einordnung

Teil der Reihe aus `docs/CONTENT-PLAN-2026-08.md` (10 Artikel). Andere Themen der Reihe
hier nur anreißen, nicht ausbreiten — jedes hat einen eigenen Artikel.
