# Einblendungen als Container — Spezifikation (Grilling mit Marc, 30.09.2026)

Dieses Dokument ist die Wahrheit für den Umbau. Entstanden aus einem Grilling (Q1–Q29)
am 30.09.2026 abends; Marc: „leg direkt los … zieh alles durch".

## Grundidee
Es gibt für alles, was am **Bildschirm** klebt, genau einen Baustein: den **Container**.
Er ist frei platzierbar und enthält **Zeilen**. Schilder und Foto-Pins bleiben, wie sie
sind (sie hängen an der Karte). Ziel: vereinfachen UND universeller machen.

## Entscheidungen
| # | Entscheidung |
|---|---|
| Q1 | Container werden: Gesamt-/Live-/weitere Boxen, Höhenprofil, Diagramme, Nordpfeil, Maßstab, Titel & Schlusskarte, Wasserzeichen. Schilder nicht. |
| Q2 | Lage = **Anker** (9 Positionen) + **Abstand** in % der Bildfläche. Ziehen in der Vorschau mit Raster (2 %), Rand- und Mitten-Einrasten. Formatwechsel sind selten. |
| Q3/Q25 | Größe **automatisch** (nach Inhalt) oder **fest** (Breite/Höhe in % der Bildfläche) + Ausrichtung des Inhalts (links/mitte/rechts, oben/mitte/unten). Diagramm- und Bildzeilen haben eine eigene Breite (%) bzw. Höhe. |
| Q4 | Zeilentypen: **Wert** (alles, was wir an Daten haben — auch Datum/Uhrzeit, Sensoren, Schwarm), **Freitext**, **Diagramm**, **Bild**, **Nordpfeil**, **Maßstab**. |
| Q5 | Je Container: Zeilen **untereinander** oder **nebeneinander**. |
| Q6/Q15/Q28 | **Stil je Container.** Ein Stil ist ein **Template**: beim Auswählen setzt er alle Werte (Farben, Abstände, Ecken, Rahmen, Schatten, Beschriftung, Anordnung); danach gehören die Werte dem Container. Start-Stile: **Kasten**, **Frei**, **Plakette** (+ „ohne" fürs Logo). |
| Q7/Q23 | Zeitsteuerung **nur je Container** (Zeitleisten-Spur, Blende/Aufpoppen), **mehrere Zeiträume** bleiben. Zeitsteuerung je Zeile entfällt — wer Zeilen einzeln zeigen will, nimmt mehrere Container. |
| Q8 | Alte Projekte werden beim Öffnen **automatisch und verlustfrei** übersetzt (Sicherung vorher), kein Weg zurück; alter Code wird gelöscht. |
| Q9 | „+ Einblendung" mit Vorlagen: Live-Werte, Gesamtsumme, Höhenprofil, Titel, Schlusskarte, Logo, Nordpfeil + Maßstab, Rahmen/Vollbild, leer. |
| Q10/Q19 | **Eine Pipeline:** auch der transparente Export läuft über die Vorschau (Grundkarte/Gelände/Himmel aus, Hintergrund durchsichtig, ProRes 4444). Der klassische Render (Python-Nachbau) verschwindet. Look des Alpha-Exports = normales Video (Kamera, 3D, Schilder). 4K-Alpha darf langsam sein. |
| Q11 | Tour-Map (Standbild) nutzt dieselben Container, Werte zeigen den Endstand. |
| Q12 | Seitenleiste „Einblendungen" = Liste (an/aus, sortieren, ✎); ✎ öffnet ein Fenster (Stil, Anordnung, Größe, Zeilen hinzufügen/ziehen/löschen); Verschieben in der Vorschau; Zeiten in der Zeitleiste. |
| Q13 | Wert-Zeile: Beschriftung aus dem Feld, je Zeile umbenennbar/ausblendbar; Einheit automatisch klein. |
| Q14 | **Keine** Gestaltung je Zeile — im Container ist alles einheitlich. |
| Q16 | Dunkle **Verläufe oben/unten** = eigene Projekteinstellung (an/aus + Stärke), unabhängig von Containern. |
| Q17 | Diagramm = besondere Zeile mit eigener Größe; Überschrift/Min-Max sind normale Zeilen. Höhenprofil = Diagramm mit Datenreihe Höhe. |
| Q18 | Umbau **am Stück**, Übersetzung an Kopien aller Testprojekte geprüft (Vorher/Nachher). |
| Q20/Q29 | Container kann ein **Hintergrundbild** statt/über der Farbe haben (füllen/einpassen, Deckkraft). Damit geht auch Rahmen/Vollbild. |
| Q21 | Einstellungen je Container: Stil, Anordnung, Größe (auto/fest), Schrift, Schriftgröße, Textfarbe, Akzentfarbe, Hintergrund (Farbe + Deckkraft, Bild), Innenabstand, Zeilenabstand, Spaltenabstand, Beschriftung oben/links/aus; unter „Mehr": Ecken, Rahmen, Schatten. |
| Q22 | Wert-Zeile, Bezug: **läuft mit / Gesamt / je Etappe / je Bewegungsart** — je Zeile. |
| Q24 | Neue Projekte: Container „Logo" (GPS-Studio-Logo, Stil ohne, unten rechts). Frei/Schnell-Video: oben mittig als Plakette. |
| Q26 | Einheiten: **Schriftgröße in % der kurzen Bildseite** (cqmin), **Abstände in em**, Lage/feste Größe in % der Bildfläche. Umzug rechnet so um, dass alte Projekte gleich aussehen (auch 9:16). |

## Schnell-Video (Marc, 30.09.2026 nachts)
Das Schnell-Video muss ein **ganz normales Animator-Projekt** sein und sich „langsam von Hand"
mit den Bordmitteln des Animators nachbauen lassen: Container statt Titel-/Schlusskarte,
Highlights als Schilder, Kamera als Keyframes, Wasserzeichen als Logo-Container.

## Umsetzung (v0.9.752, 30.09.2026 nachts)
- Gebaut wie oben entschieden; Architektur in `docs/DEVELOPER.md`, Kapitel „Einblendungen als Container — eine Render-Pipeline“.
- **Q2:** Raster beim Ziehen **1 %** statt 2 % (feiner, Einrasten an Rand und Mitte bleibt).
- **Q8 (Sicherung):** Der Umzug schreibt nur `container`, `container_v`, `verlauf` dazu — die alten Schlüssel bleiben im Projekt stehen (werden nicht mehr gelesen). Damit ist jeder alte Stand wiederherstellbar, dazu die Projekt-Fassungen.
- **Zeitgruppe im Editor:** Zusätzlich zur Zeitleisten-Spur stehen die Zeiträume als Sekunden im Editor (von–bis, „＋ Zeitraum“, „ganzes Video“) und die Blenden (Art + Dauer) — damit das Schnell-Video Feld für Feld von Hand nachbaubar ist.
- **Schnell-Video:** `tests/test_schnellvideo_nachbau.py` baut jede Einblendung nur über die Oberfläche nach. Dabei gefunden und behoben: Pfeilrichtung „aus der gezeichneten Linie“ hatte kein Bedienelement; Verlauf-Regler konnte 62/72 % nicht (Schritt 5 → 1); getippte Zeiten genau am Animationsende landeten 0,08 s daneben.
- **Offen:** Python-Spiegel der Spur-Algorithmen in `core/animator.py` (nur noch von Tests genutzt); 4K-Alpha ist langsam (erlaubt, Q10).
