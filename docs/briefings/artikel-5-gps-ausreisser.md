# Artikel-Briefing: „Mein Track hat Zickzack und springt durch die Gegend“

**Artikel 5 von 10**
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

- **MTB-News.de**: „Fehlerbereinigung von GPS-Daten (GPX)" und „Nachbearbeiten,
  Auswerten und Archivieren von GPS-Tracks"
- **Garmin Forums**: Thread über 250-km/h-Spitzen in der Gondel — **ohne Antwort
  geschlossen**
- Typische Ursachen, die in den Artikel gehören: Häuserschluchten (Signal wird an
  Fassaden reflektiert), dichter Wald, Gebirgsflanken, Tunnel, und der erste Fix nach
  dem Einschalten

**Suchintention:** Der Track sieht kaputt aus — Zickzack, Sprünge quer über Häuser,
absurde Höchstgeschwindigkeit. Die Strecke ist dadurch zu lang.

## 3 · Der Lösungsweg — gestuft

### Im Browser (`reisezoom.com/gps/` → 🛠 Track-Werkzeuge → ✨ Säubern)

Eine Einstellung: **„Höchstgeschwindigkeit"** (Regler, Voreinstellung 250 km/h).
Alles, was schneller ist als dieser Wert, gilt als Ausrutscher und fliegt raus.

**Das ist ein echter Ausreißerfilter — und mehr, als der Marktführer kann:**
gpx.studio (833.000 Besuche im Quartal) hat **keine automatische Erkennung**; dort
zieht man ein Rechteck über die Karte und löscht die Punkte darin von Hand.

**Den Wert erklären, statt ihn nur zu nennen:** Für eine Wanderung sind 250 km/h
großzügig — man kann den Regler weit heruntersetzen (etwa 15–20 km/h beim Wandern),
dann greift der Filter feiner. Beim Radfahren, Skifahren oder im Auto entsprechend höher.
**Das ist der praktische Tipp, den kein anderer Artikel gibt.**

### In der App (GPX-Inspektor → 🩹 Auto-Heilen)

**Der Unterschied: Vorschau statt Vertrauen.** Die App markiert die verdächtigen
Stellen auf der Karte und **zeigt vorher, was sie tun würde** — man übernimmt einzeln
oder alles auf einmal. Dazu:
- **Vorher/Nachher direkt nebeneinander** (die alte Linie grau gestrichelt)
- **Lücken füllen** — etwa im Tunnel, mit einer sinnvollen Verbindung statt einer
  Luftlinie
- **Auf Straße/Weg matchen** — die Spur aufs echte Wegenetz legen
- **Einzelne Punkte** anklicken und löschen, wenn der Automatik etwas entgeht
- Undo, und das Original bleibt erhalten

**Wichtig für beide Wege:** Die **Zeitstempel bleiben erhalten**. Deshalb stimmen
Geschwindigkeit und Dauer hinterher noch — das ist bei vielen anderen Werkzeugen
nicht so, und in Foren wird genau das kritisiert („dabei geht alles außer den
GPS-Daten verloren").

## 4 · Was NICHT behauptet werden darf

- ❌ **Nicht:** „Damit ist der Track perfekt." → Ein Filter kann nur entfernen, was
  offensichtlich falsch ist. Er kann keine Daten erfinden, die nie aufgezeichnet wurden
- ❌ **Nicht:** „Lücken werden rekonstruiert." → Sie werden **überbrückt**. Was im
  Tunnel passiert ist, weiß niemand
- ❌ Nicht behaupten, die App erkenne Ausreißer „intelligenter" — sie zeigt sie
  **vorher an**, das ist der Unterschied

## 5 · Folgefragen (im selben Artikel)

1. Woher kommen die Sprünge überhaupt? → Reflexion, Abschattung, erster Fix
2. Warum ist meine Strecke zu lang? → jeder Ausreißer wird zweimal gezählt (hin und
   zurück), das summiert sich
3. Was mache ich mit der Lücke im Tunnel? → App, Lücken füllen
4. Mein Track läuft neben dem Weg → App, auf Straße/Weg matchen
5. Bleiben Puls und Trittfrequenz erhalten? → ja, die Sensordaten der übrigen Punkte
   bleiben unangetastet

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
