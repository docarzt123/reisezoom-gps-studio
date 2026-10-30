#!/usr/bin/env python3
"""Handbuch-Bilder und -Clips (docs/img/handbuch, erzeugt von scripts/handbuch_bilder.py) an ihre Stellen in
docs/USER_GUIDE{,.en,.es}.md setzen (29.10.2026).

Je Bild ein Anker (regulärer Ausdruck auf den Zeilenanfang, in allen drei Sprachen gültig) und ob das Bild NACH oder
VOR der Ankerzeile steht. Schon vorhandene Bildzeilen werden nicht doppelt gesetzt — das Skript darf mehrfach laufen.
Danach: scripts/build_user_guide_html.py.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DATEIEN = {"de": REPO / "docs/USER_GUIDE.md", "en": REPO / "docs/USER_GUIDE.en.md", "es": REPO / "docs/USER_GUIDE.es.md"}

# (Name, Anker, nach/vor, Endung, Bildunterschrift de/en/es)
BILDER = [
    ("export-dialog", r"^### ⤓ ", "nach", "jpg",
     ("Der Export-Dialog: Vorlagen, Auflösung, Bildrate, Qualität und Speicherort.",
      "The export dialog: presets, resolution, frame rate, quality and where to save.",
      "El diálogo de exportación: plantillas, resolución, fotogramas, calidad y destino.")),
    ("render-wanderung", r"^\*\*(Während des Renderns|While rendering|Mientras se renderiza)", "nach", "mp4",
     ("Während des Renderns: die kleine Wanderung mit Sprüchen zur Lage.",
      "While rendering: the little hike with sayings for the moment.",
      "Durante el render: la pequeña caminata con frases para cada momento.")),
    ("animator-format", r"^### (Format & Ablauf|Format & timing|Formato y desarrollo)", "nach", "jpg",
     ("„Format & Ablauf“: Seitenverhältnis, Länge und Ablauf des Videos.",
      "“Format & timing”: aspect ratio, length and timing of the video.",
      "«Formato y desarrollo»: proporción, duración y desarrollo del vídeo.")),
    ("archiv-projekte", r"^### .*v0\.9\.617\)", "nach", "jpg",
     ("Deine Projekte im Archiv.", "Your projects in the library.", "Tus proyectos en el archivo.")),
    ("videoassistent", r"^### 🧭 (Video-Assistent|Video assistant|Asistente de vídeo)", "nach", "jpg",
     ("Der Video-Assistent fragt Schritt für Schritt — hier die Kamera.",
      "The video assistant asks step by step — here the camera.",
      "El asistente de vídeo pregunta paso a paso — aquí la cámara.")),
    ("schnellvideo", r"^### 🎬 ", "nach", "jpg",
     ("Schnell-Video: Look, Format, Länge und Kamera — mehr braucht es nicht.",
      "Quick video: look, format, length and camera — that is all it takes.",
      "Vídeo rápido: estilo, formato, duración y cámara — no hace falta más.")),
    ("archiv-touren", r"^## 2c · ", "nach", "jpg",
     ("Das Archiv: alle Touren mit Karte, Länge, Höhenmetern und Dauer.",
      "The library: every tour with map, distance, elevation gain and duration.",
      "El archivo: todas las rutas con mapa, distancia, desnivel y duración.")),
    ("archiv-tour-gewaehlt", r"^### 🗺📷 ", "nach", "jpg",
     ("Eine Tour angewählt: rechts ihre Karte, Werte, Track-Check und Beschreibung.",
      "A tour selected: on the right its map, figures, track check and description.",
      "Una ruta seleccionada: a la derecha su mapa, valores, revisión del track y descripción.")),
    ("animator-uebersicht", r"^## 3 · ", "nach", "jpg",
     ("Der Animator: links die Seitenleiste, in der Mitte die Vorschau, unten die Zeitleiste.",
      "The Animator: the sidebar on the left, the preview in the middle, the timeline below.",
      "El Animator: a la izquierda la barra lateral, en el centro la vista previa, abajo la línea de tiempo.")),
    ("animator-karte", r"^\*\*(Karte|Map|Mapa):\*\*\s*$", "vor", "jpg",
     ("Abschnitt „Karte“: Looks, Kartenstil und Farben.",
      "Section “Map”: looks, map style and colours.",
      "Sección «Mapa»: estilos, tipo de mapa y colores.")),
    ("animator-einblendungen", r"^\*\*(Größe je Textzeile|Size per text line|Tamaño por línea de texto)", "vor", "jpg",
     ("Abschnitt „Overlays“: Zahlen, Höhenprofil, Titel und Logo als Einblendungen.",
      "Section “Overlays”: numbers, elevation profile, title and logo as overlays.",
      "Sección «Overlays»: cifras, perfil de altura, título y logo como rótulos.")),
    ("animator-kamera", r"^\*\*(Kamera|Camera|Cámara):\*\*\s*$", "vor", "jpg",
     ("Abschnitt „Kamera“: Kameraführung, Höhe über dem Gelände und Neigung.",
      "Section “Camera”: camera mode, height above the terrain and tilt.",
      "Sección «Cámara»: modo de cámara, altura sobre el terreno e inclinación.")),
    ("animator-tracks", r"^\*\*(Der Laufpunkt selbst|The moving dot itself|El punto en sí)", "vor", "jpg",
     ("Abschnitt „Tracks“: der Stift öffnet den Track-Editor mit Linie und Laufpunkt.",
      "Section “Tracks”: the pencil opens the track editor with line and moving dot.",
      "Sección «Tracks»: el lápiz abre el editor del track con la línea y el punto móvil.")),
    ("vorschau-abspielen", r"^### .*v0\.9\.658\)", "nach", "mp4",
     ("Die Vorschau spielt das Video so ab, wie es gerendert wird — mit Schildern und Einblendungen.",
      "The preview plays the video exactly as it will be rendered — with signs and overlays.",
      "La vista previa reproduce el vídeo tal como se renderizará — con letreros y rótulos.")),
    ("animator-schilder", r"^### 📷 .*v0\.9\.74\)", "nach", "jpg",
     ("Abschnitt „Schilder und Fotos“: Highlights, eigene Schilder und Fotos an der Strecke.",
      "Section “Signs and photos”: highlights, your own signs and photos along the route.",
      "Sección «Letreros y fotos»: destacados, letreros propios y fotos a lo largo de la ruta.")),
    ("animator-ton", r"^\*\*🎵 ", "nach", "jpg",
     ("Abschnitt „Musik und Ton“.", "Section “Music and sound”.", "Sección «Música y sonido».")),
    ("reiseroute", r"^## 4 · ", "nach", "jpg",
     ("Die Reiseroute: Stationen der Anreise als Video.", "Travel route: the stops of your journey as a video.",
      "Ruta de viaje: las paradas del viaje como vídeo.")),
    ("tourmap", r"^## 5 · ", "nach", "jpg",
     ("Tour-Map: die Tour als Standbild.", "Tour-Map: the tour as a still image.", "Tour-Map: la ruta como imagen fija.")),
    ("webkarte", r"^## 5c · ", "nach", "jpg",
     ("Web Karte: die Tour als interaktive Karte fürs Blog.", "Web Map: the tour as an interactive map for your blog.",
      "Mapa web: la ruta como mapa interactivo para el blog.")),
    ("datenanimator", r"^## 5b · ", "nach", "jpg",
     ("Daten-Animator: Höhe, Tempo oder Puls als Video.", "Data Animator: elevation, speed or heart rate as a video.",
      "Animador de datos: altura, velocidad o pulso como vídeo.")),
    ("geotagger", r"^## 6 · ", "nach", "jpg",
     ("Der Geotagger: Fotos bekommen ihren Ort aus dem Track.", "The Geotagger: photos get their location from the track.",
      "El Geotagger: las fotos obtienen su lugar del track.")),
    ("gpx-inspektor", r"^## 7 · ", "nach", "jpg",
     ("Der GPX-Inspektor: Track prüfen, Ausreißer und Lücken reparieren, Logbuch.",
      "The GPX Inspector: check the track, repair outliers and gaps, logbook.",
      "El inspector GPX: revisar el track, reparar valores atípicos y huecos, cuaderno.")),
    ("animator-logbuch", r"^\*\*(Im Video|In the video|En el vídeo) \(", "nach", "jpg",
     ("Abschnitt „Logbuch im Video“: je Abschnitt zeigen, blass, raffen oder überspringen.",
      "Section “Logbook in the video”: show, fade, speed up or skip each section.",
      "Sección «Cuaderno en el vídeo»: mostrar, atenuar, acelerar u omitir cada tramo.")),
]
SPRACHE_I = {"de": 0, "en": 1, "es": 2}


def einsetzen(sprache: str, pfad: Path) -> list[str]:
    zeilen = pfad.read_text(encoding="utf-8").split("\n")
    fehlt = []
    for name, anker, wo, endung, texte in BILDER:
        datei = f"img/handbuch/{name}-{sprache}.{endung}"
        if not (REPO / "docs" / datei).exists():
            fehlt.append(f"{name}: Datei fehlt")
            continue
        if any(datei in z for z in zeilen):
            continue
        rx = re.compile(anker)
        i = next((k for k, z in enumerate(zeilen) if rx.search(z)), None)
        if i is None:
            fehlt.append(f"{name}: Anker nicht gefunden")
            continue
        block = ["", f"![{texte[SPRACHE_I[sprache]]}]({datei})", ""]
        if wo == "nach":
            zeilen[i + 1:i + 1] = block
        else:
            zeilen[i:i] = block[1:] + [""]
    pfad.write_text("\n".join(zeilen), encoding="utf-8")
    return fehlt


if __name__ == "__main__":
    ok = True
    for sp, pfad in DATEIEN.items():
        f = einsetzen(sp, pfad)
        print(f"{sp}: {len(BILDER) - len(f)} gesetzt/vorhanden" + (f", Probleme: {f}" if f else ""))
        ok = ok and not f
    sys.exit(0 if ok else 1)
