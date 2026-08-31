# Artikel-Briefing: „Meine Höhenmeter stimmen nicht — wie korrigiere ich sie?“

**Artikel 3 von 10**
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

**Der am besten belegte Painpoint der ganzen Recherche** — sechs unabhängige Foren,
über mehr als ein Jahrzehnt:
- Garmin Forums (deutsch): „Höhenmeter korrigieren — möglich?" (BaseCamp) und
  „Höhenmeter, Höhenmeterkorrektur etc." (fēnix 6)
- NaviBoard: „Höhenmeter korrigieren — möglich?" und **„Barometrische Höhendaten in
  gpx-Dateien nachjustieren?"**
- outdoorseiten.net: „Höhendaten von GPS-Tracks anpassen"
- MTB-News.de: „GPS — Ermittlung der zurückgelegten Höhenmeter ungenau"
- radforum.de: „Falsche Höhenangaben im Track"
- gpsforum.geospector.de: „Wie gpx-Höhendaten korrigieren?"

**Suchintention:** Konkretes Ärgernis mit hoher Handlungsabsicht. Typischer Fall:
1.800 Höhenmeter angezeigt, 1.400 waren es wirklich.

## 3 · Warum das passiert — gehört in den Artikel

Es gibt **zwei Arten**, Höhe zu messen:
- **GPS-Höhe**: aus den Satellitensignalen. Rauscht um 10–30 m, wandert aber nicht weg
- **Barometrische Höhe**: über den Luftdruck. Viel feiner, sieht jede Stufe — **aber
  der Luftdruck ändert sich auch mit dem Wetter**

Zieht während der Tour ein Tief durch, fällt der Druck, und die Uhr hält das für einen
Anstieg. Man startet auf 300 m, kommt am selben Punkt an, und die Uhr sagt 340 m.
Diese 40 m sind Wetter, kein Berg — verteilt über die Tour werden sie als Auf und Ab
mitgezählt. **Garmin gibt für seine Höhenmesser selbst ±120 m an.**

**Welche Uhren betroffen sind** (Faustregel: Outdoor- und Multisport-Linien haben ein
Barometer, Einsteigermodelle nicht):
- **Mit** Barometer: Garmin fēnix, Instinct, Epix, Forerunner 165/255/265, Venu 4,
  Venu/vívoactive 4; praktisch alle Radcomputer (Edge, Wahoo, Hammerhead); Suunto ab
  Core; Coros; Polar Vantage V3
- **Ohne**: Garmin Forerunner 55, Venu Sq 2, vívoactive 5 — die rechnen aus dem GPS
- **Suunto** schreibt „Baro" in den Modellnamen, wenn eines drin ist

## 4 · Der Lösungsweg — gestuft, und das ist wichtig

### Im Browser (`reisezoom.com/gps/` → 🛠 Track-Werkzeuge → ⛰ Höhen)

Zwei Einstellungen:
- **„Geländemodell"**: „Europa — fein (25 m)" oder „Weltweit (90 m)"
- **„Vorgehen"**: **„Nur fehlende ergänzen"** oder **„Alle ersetzen (entrauschen)"**

Knopf: **„Höhen holen"**.

**Das löst zwei Fälle vollständig:** eine Aufzeichnung ganz **ohne** Höhe (Handy ohne
Barometer, gezeichnete Route) und ein Profil, das so verrauscht ist, dass der Anstieg
unrealistisch wird.

⚠️ **Ehrlich sein: „Alle ersetzen" ist ein Tausch.** Die Kartenhöhe ist glatt und
absolut zuverlässig — aber sie ist grob gerastert und kennt **keine Brücken, keine
Tunnel, keine Hohlwege**. Wer über eine Talbrücke fährt, bekommt die Talsohle
zugewiesen. Man tauscht also Rauschen gegen Geländetreue.

### In der App (GPX-Inspektor → ⛰ Höhe korrigieren)

**Der Unterschied ist der Mischregler.** Die App holt dieselbe Geländehöhe, zeigt aber
**beide Kurven übereinander** und mischt sie stufenlos (Voreinstellung 70 % Karte).
Die Höhenmeter rechnen **live mit**, bevor man übernimmt — man sieht also vorher, was
herauskommt.

**Das ist der eigentliche Fortschritt gegenüber allen anderen Werkzeugen:** Fast alle
*ersetzen* das Profil komplett. GPS Visualizer sagt das sogar ausdrücklich
(„the elevation-adding feature will erase any existing altitude data"). Mit dem Regler
behält man die feine Struktur der eigenen Messung und nimmt nur so viel Karte dazu,
wie nötig ist.

Dazu in der App: Vorher/Nachher sichtbar, Undo, und das Original bleibt erhalten.

## 5 · Was NICHT behauptet werden darf

- ❌ **Nicht:** „Damit sind deine Höhenmeter exakt." → Sie werden *plausibler*.
  Absolute Wahrheit gibt es bei Höhenmetern nicht
- ❌ **Nicht:** „Wir korrigieren die Wetter-Drift." → **Das kann derzeit niemand**,
  auch wir nicht. Wir glätten und mischen mit Kartenhöhen; die langsame Drift über
  Stunden bleibt ein offenes Problem (steht auf unserer Liste, ist aber nicht gebaut)
- ❌ Nicht verschweigen, dass Kartenhöhen keine Brücken und Tunnel kennen

## 6 · Folgefragen (im selben Artikel)

1. Warum zeigen zwei Geräte auf derselben Tour verschiedene Werte? → verschiedene
   Sensoren, verschiedene Glättung, verschiedene Schwellen
2. Warum korrigiert Strava selbst? → Strava nutzt eine eigene Datenbank aus
   Barometer-Messungen der Community und zählt Anstiege erst ab 10 m
3. Welche Uhr misst genauer? → die mit Barometer, aber nur relativ (siehe oben)
4. Muss ich kalibrieren? → ja, wenn das Gerät es anbietet: am bekannten Startpunkt
5. Kann ich die Werte auch von Hand setzen? → in der App über den Inspektor

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
