# Reisezoom GPS Studio

**Animierte GPS-Karten-Videos aus deinen Touren – plus Foto-Geotagging. Kostenlos, für macOS & Windows (Linux aus dem Quellcode).**

Du lädst ein GPX-Track rein, und Reisezoom GPS Studio macht daraus ein **animiertes Karten-Video** (Marker fährt die Route ab, Kinokamera, Höhenprofil, Stats-Overlays, Wegpunkt-Schilder, Foto-Pins). Dazu gibt es einen **Geotagger** (Fotos anhand der GPS-Zeit auf den Track setzen), einen **GPX-Inspektor** (kaputte Tracks reparieren) und ein **Reiseroute**-Modul (An-/Abreise als Animation).

Gebaut von **Marc** (Reisezoom) und **Claude Code** – Outdoor, Fotografie & Kameras.

🌐 Blog & mehr: **https://reisezoom.com**  ·  ▶ YouTube: **https://www.youtube.com/@reisezoom**

---

## ⬇️ Download

Immer die neueste Version:

| Plattform | Download |
|-----------|----------|
| **macOS** | https://s.reisezoom.com/gps-studio-mac |
| **Windows** | https://s.reisezoom.com/gps-studio-win |
| **Linux** | aus dem Quellcode bauen → siehe [🐧 Linux](#-linux-aus-quellcode) |

> Die App ist nicht über ein Apple-/Microsoft-Entwicklerzertifikat signiert. macOS: beim ersten Start **Rechtsklick → Öffnen**.

## ✨ Was es kann

- **Animator** – GPX-Track als Video animieren: Kinokamera mit Keyframes, Welt-Drehung, Höhenprofil, Stats-Overlays, Wegpunkt-Schilder, Foto-Pins. Export als H.264/H.265/ProRes, optional mit Alpha (transparenter Hintergrund).
- **Tour-Map** – statische, hochauflösende Tourkarte als Bild.
- **Höhen-Animator** – animiertes Höhenprofil.
- **Geotagger** – Fotos per GPS-Zeit auf den Track setzen (inkl. RAW/HEIC, Kamera-Zeitzonen, Fotos manuell platzieren).
- **GPX-Inspektor** – Ausreißer glätten, Lücken füllen, Track aufs Wegenetz snappen, Zeitstempel ansehen.
- **Reiseroute** – aus Start/Ziel eine Anreise berechnen (Straße folgen oder Flugbogen) und animieren.

## 🗺️ Mapbox-Token (kostenlos)

Die Kartendarstellung nutzt **Mapbox**. Du brauchst einen **eigenen, kostenlosen** Mapbox-Token (großzügiges Gratis-Kontingent):

1. Account auf https://account.mapbox.com erstellen.
2. „Default public token" (beginnt mit `pk.…`) kopieren.
3. In der App unter **Einstellungen → Mapbox-Token** einfügen.

So laufen die Kartenkosten über *deinen* Account – die App selbst sammelt nichts und sendet nichts an uns. Geotagger und GPX-Inspektor funktionieren auch ganz ohne Token.

## 🔒 Datenschutz

Reisezoom GPS Studio läuft **komplett lokal** auf deinem Rechner. Deine Fotos, GPS-Tracks und Videos verlassen deinen Computer nicht (außer den Karten-Kacheln, die direkt von Mapbox mit deinem Token geladen werden).

## 🛠️ Selbst bauen (Entwickler)

Python 3.11+, dann:

```bash
pip install -r requirements.txt
python app.py          # Dev-Start
./build.sh             # App bauen (PyInstaller)
```

Architektur, Module und Render-Pipeline: [`docs/DEVELOPER.md`](docs/DEVELOPER.md). Endnutzer-Anleitung: [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md). Versions-Historie: [`CHANGELOG.md`](CHANGELOG.md).

## 🐧 Linux (aus Quellcode)

Für macOS und Windows gibt es fertige Builds (siehe oben). Für **Linux läuft die App direkt aus dem Quellcode** — das Karten-/Render-Backend (pywebview) braucht dort die System-GTK-/WebKit-Bindings, die sich nicht zuverlässig in ein einzelnes Binary packen lassen.

**1. System-Pakete installieren** (einmalig):

```bash
# Fedora
sudo dnf install git
sudo dnf install python3 python3-gobject gobject-introspection \
                 webkit2gtk4.1 python3-cairo ffmpeg

# Debian / Ubuntu
sudo apt install git
sudo apt install python3 python3-venv python3-gi python3-gi-cairo \
                 gir1.2-webkit2-4.1 libwebkit2gtk-4.1-0 ffmpeg
```

**2. Repo holen & starten:**

```bash
git clone https://github.com/docarzt123/reisezoom-gps-studio.git
cd reisezoom-gps-studio
python3 -m venv --system-site-packages .venv   # --system-site-packages → die venv sieht das System-GTK (gi)
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Den Mapbox-Token trägst du in der App unter ⚙ → Mapbox-Token ein (siehe oben).

## 📜 Lizenz & Credits

Reisezoom GPS Studio ist **freie Software unter der [GNU GPLv3](LICENSE)** – du darfst sie nutzen, weitergeben und verändern; weitergegebene Versionen müssen ebenfalls offen unter GPLv3 bleiben.

Es bündelt großartige Open-Source-Projekte: **FFmpeg** (LGPLv2.1+/GPLv2+, libx264/libx265 sind GPL-Komponenten), **Mapbox GL JS**, **pywebview** (BSD-3), **Pillow** (HPND), **gpxpy** (Apache-2.0), **Playwright** & **Chromium** (Apache-2.0 / BSD-3), **ExifTool** (Artistic License), **pillow-heif**/**libheif** (BSD-3 / LGPLv3). Volle Liste im **Über**-Dialog der App.

---

Made with ❤️ for the trail. **reisezoom.com**
