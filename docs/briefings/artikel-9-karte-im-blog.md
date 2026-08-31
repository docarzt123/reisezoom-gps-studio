# Artikel-Briefing: „Wie binde ich eine Karte meiner Tour in meinen Blog ein?“

**Artikel 9 von 10**
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

Klassische Blogger-Frage. Die meisten lösen es heute über eine **Komoot-Einbettung**
oder ein Strava-Widget — mit drei Nachteilen, die im Artikel benannt werden sollten:
fremdes Branding, ein Skript eines Drittanbieters im eigenen Blog (Cookie- und
DSGVO-Thema), und die Abhängigkeit davon, dass die Einbettung morgen noch funktioniert.

Dass Letzteres real ist, zeigen zwei Fälle: **Ayvri** löschte 2022 alle Szenen,
**FATMAP** wurde 2024 abgeschaltet — beide Male waren eingebettete Karten tot.

**Suchintention:** Umsetzung. Jemand schreibt gerade einen Tourenbericht.

## 3 · Der Lösungsweg — das geht komplett im Browser

**`reisezoom.com/gps/` → 🧩 Diese Tour auf deinem Blog**

Track laden, Kartenstil wählen, Knopf drücken — **der fertige HTML-Code liegt in der
Zwischenablage**. In WordPress in einen „Custom HTML"-Block einfügen, fertig.

**Wählbare Kartenstile:** OpenStreetMap · OpenTopoMap · CyclOSM · Humanitär

**Vier Bausteine stehen zur Wahl:** Karte · Höhenprofil · Tourdaten · Runden

**Der entscheidende Satz:** Das Ergebnis **läuft eigenständig, ohne Reisezoom-Server**.
Es ist kein Widget, das auf einen fremden Dienst zeigt — der Code gehört danach dir.
Wenn reisezoom.com morgen offline geht, funktioniert deine Karte weiter.

**Das ist der stärkste Punkt gegenüber Komoot- und Strava-Einbettungen** und
gleichzeitig das Datenschutz-Argument: kein Drittanbieter-Skript im eigenen Blog.

## 4 · Was die App zusätzlich kann

**Modul Web Karte.** Dasselbe Prinzip, aber:
- **Mehrere Tracks** in einer Karte
- Feinere Gestaltung (Farben, Linienstärke, Beschriftungen)
- **Einwilligungsknopf** für Kartenanbieter, die man erst nach Zustimmung laden will
- Fotos an ihrer Position in der Karte

Für einen einzelnen Tourenbericht reicht der Browser. Wer regelmäßig Berichte schreibt
oder mehrere Etappen zeigen will, nimmt die App.

## 5 · Was NICHT behauptet werden darf

- ❌ **Nicht:** „völlig DSGVO-frei" → Die Kartenkacheln kommen weiterhin von einem
  Kartenanbieter (OpenStreetMap und andere), und dabei wird die IP des Besuchers
  übertragen. **Das ist der ehrliche Stand** — der Unterschied ist, dass kein
  zusätzliches Tracking-Skript mitläuft. Wer ganz sicher gehen will, nimmt den
  Einwilligungsknopf aus der App
- ❌ Keine Rechtsberatung geben. Sachlich beschreiben, was technisch passiert
- ❌ Nicht behaupten, Komoot-Einbettungen seien „verboten" — sie haben andere Nachteile

## 6 · Folgefragen (im selben Artikel)

1. Funktioniert das auch außerhalb von WordPress? → ja, es ist reines HTML
2. Was passiert, wenn ich die Datei später ändere? → der Code ist eigenständig
3. Kann ich mehrere Touren zeigen? → in der App
4. Lädt das meine Seite langsam? → die Karte lädt erst, wenn sie sichtbar ist
5. Wie mache ich ein statisches Bild statt einer Karte? → Artikel 8, Tour-Map

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
