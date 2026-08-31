# Roadmap — Reisezoom GPS Studio

Stand: 30.08.2026, nach Release v0.9.631. Beschlossen mit Marc am 30.08.2026.
Quellen: `STRATEGIE-2026-08.md` (Markt + Reihenfolge), `AUDIT-2026-08-30.md`
(offene Befunde), `IDEAS.md` §42/§43. **Bei Zielkonflikten gilt diese Datei;
Änderungen hier mit Datum nachtragen.**

**Marc-Grundsatz (30.08.2026):** *Keine Investitionen, die das Tool nicht
selbst trägt.* Konkret: Die Windows-Signatur (219 $/Jahr) wird erst gekauft,
wenn die Finanzierungs-Spur sie deckt — nicht vorher.

---

## Phase 1 — Projekte fertig machen + Nutzererlebnis (JETZT, Wochen)

Marc, 30.08.2026: „die projekte komplett richtig zu implementieren und
generell die user experience zu verbessern." Deckt sich mit dem
Strategie-Befund „Dass es beim ersten Start funktioniert" und Audit §D.

1. **Erstnutzer-Erlebnis (Audit D1)** — der Punkt, an dem Neulinge aussteigen:
   Die App startet in einer leeren Projektliste, deren einziger Hinweis das
   unerklärte Wort „Schwarm" enthält. Leerzustand neu (führt zum ersten
   Ordner/Track), `library.proj_leer` neu, Anfängerleitfaden beginnt auf dem
   Bildschirm, auf dem man wirklich landet.
2. **„Session" endgültig auflösen (D6)** — Topbar-Labels, `no_session`-Texte,
   Handbuch: seit v0.9.606/612 gibt es nur noch Projekte; die Oberfläche
   muss dieselbe Sprache sprechen.
3. **Begriffe erklären (Audit „Begriffe ohne Erklärung")** — Reise, Schwarm,
   Erdpunkt/Bildlage, Anchor, Cluster, geo_hash-Anzeige; unübersetzte
   Strings (Bearing/Pitch-Verwechslung!). Ein i18n-Durchgang, en/es spiegeln.
4. **Vorlagen (IDEAS §42)** — Farb-/Render-/Overlay-Einstellungen als Vorlage
   speichern und auf Projekte anwenden. Gehört logisch ZU den Projekten,
   deshalb hier und nicht später.
5. **Robustheit zu Ende (Audit B2–B4)** — Doppelklick-Race bei
   Hintergrundläufen, stummer Kaputt-Store bekommt eine UI-Meldung,
   `stand_schreiben` atomar.
6. **Rest-Handbuchpunkte (D2–D17)** — Widersprüche (Backup, Punkte-Regler),
   Kapitelnummerierung, README (beschreibt eine App von vor 40 Versionen).

**Fertig-Kriterium:** Ein Neuling kommt ohne Handbuch vom Download bis zum
ersten Video; kein Oberflächentext benutzt „Session" oder unerklärte
Fachwörter; Tester-Feedback (Dieter/Rafael/Keppler) zur neuen Projektwelt
eingearbeitet.

## Phase 2 — Finanzierung (parallel starten, klein)

Strategie §8, in dieser Reihenfolge — alles ohne Serverkosten, ohne
Supportkanal, App bleibt kostenlos:

1. **Affiliate außerhalb der App:** Artikel/Videos verlinken Foto Erhardt,
   Bergzeit, Insta360 — die App selbst bleibt werbefrei.
2. **Ein Unterstützungs-Button** (Ko-fi ODER Liberapay), zweckgebunden
   („deckt Entwicklerkonto, Windows-Signatur, Kartenkacheln"), keine Perks.
   In About + Download-Seite, dezent.
3. **Sachleistungs-Sponsoring Insta360** (HandBrake-Modell): Testgeräte,
   Windows-Testrechner — löst zugleich das größte Qualitätsrisiko. Keine
   funktionale Abhängigkeit, Werbekennzeichnung sauber.

**Auslöser für die Windows-Signatur:** sobald Spur 1+2 zusammen ~320 €/Jahr
decken. Vorher bleibt SmartScreen dokumentiert (Handbuch-Abschnitt).

## Phase 3 — Alleinstellung ausbauen (danach, Monate)

Reihenfolge aus Strategie §7 / IDEAS §43:

1. **43.1 Baro-Drift-Korrektur** ⭐⭐ (S–M) — Weltneuheit, bestes
   Aufwand/Alleinstellungs-Verhältnis; sitzt im Inspektor. Mit 43.2
   (Brücken/Tunnel-Stützpunkte) zusammen denken.
2. **43.3 Ausreißer-Schwellen offenlegen** (S) — Vertrauensgewinn, fast
   gratis.
3. **43.4 Die vier Phasen in der Oberfläche** (M) — aus 8 Werkzeugen wird
   1 Programm; baut auf Phase 1 auf.
4. **43.5 Telemetrie-Overlay-Modul** ⭐⭐ (L) — die vierte Marktlücke
   (Kamerafahrt + Telemetrie hat weltweit niemand). Voraussetzung: GoPro
   GPMF aus 43.6.
5. **43.6 Formatlücken** (IGC für die Gleitschirm-Szene, CSV mit
   Spalten-Zuordnung, GPMF).

**Nicht bauen** (43.8, bestätigt): Cloud-Rendering, Pro-Version/Abo,
zentraler Karten-Schlüssel, Routenplanung (Komoot-Grenze).

## Spur M — Marketing (offen, ohne Termin)

Marc, 30.08.2026: keine Videos geplant, „aber das ist ein guter punkt.
marketing." Strategie-Befund: Bekanntheit ist das Problem, nicht Funktion
(~12 Downloads/Tag bei funktionaler Marktführerschaft). Ideen gesammelt,
nichts terminiert:

- Video „Warum ich mein eigenes Relive gebaut habe" (Ayvri-Aufhänger)
- Baro-Drift und Overlay als Launch-Aufhänger, wenn sie kommen (Phase 3)
- Gleitschirm-/IGC-Community gezielt ansprechen (heimatlos seit 2022)
- Blog-Artikel auf reisezoom.com je Release (Changelog-Link existiert schon)

---

*Pflege: erledigte Punkte mit ✅ + Version markieren, nicht löschen.
Neue Ideen zuerst in `IDEAS.md`, hierher nur, was eingeplant ist.*
