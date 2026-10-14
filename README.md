# GPS Studio by reisezoom.com

<p align="center"><img src="logo-originale-mit-text/gps-studio-lockup-color.png" alt="GPS Studio by reisezoom.com" width="420"></p>


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

> Die macOS-App ist **von Apple signiert und notarisiert** — Doppelklick genügt. Die einmalige
> „Wirklich öffnen?"-Rückfrage zeigt macOS bei jeder geladenen App, auch bei signierten.
> Die Windows-Version ist (noch) **nicht** signiert; dort meldet sich SmartScreen einmalig.

## ✨ Was es kann

- **Animator** – GPX-Track als Video animieren: Kinokamera mit Keyframes, Welt-Drehung, Höhenprofil, Stats-Overlays, Wegpunkt-Schilder, Foto-Pins. Export als H.264/H.265/ProRes, optional mit Alpha (transparenter Hintergrund).
- **Tour-Map** – statische, hochauflösende Tourkarte als Bild.
- **Höhen-Animator** – animiertes Höhenprofil.
- **Geotagger** – Fotos per GPS-Zeit auf den Track setzen (inkl. RAW/HEIC, Kamera-Zeitzonen, Fotos manuell platzieren).
- **GPX-Inspektor** – Ausreißer glätten, Lücken füllen, Track aufs Wegenetz snappen, Zeitstempel ansehen.
- **Reiseroute** – aus Start/Ziel eine Anreise berechnen (Straße folgen oder Flugbogen) und animieren.

## 🗺️ Karten ohne Schlüssel

Karten und Luftbilder sind **ohne Schlüssel und ohne Account** dabei (freie Dienste wie OpenFreeMap, OpenTopoMap und EOX Sentinel-2 cloudless). Wer möchte, trägt unter **⚙ Einstellungen** optional einen eigenen **MapTiler**- oder **Mapbox**-Schlüssel ein und bekommt deren Kartenstile dazu — die Kosten laufen dann über *deinen* Account.

## 🔒 Datenschutz

Reisezoom GPS Studio läuft **komplett lokal** auf deinem Rechner. Deine Fotos, GPS-Tracks und Videos verlassen deinen Computer nicht (außer den Karten-Kacheln, die direkt vom jeweiligen Kartendienst geladen werden).

## 🛠️ Selbst bauen (Entwickler)

Python 3.11+, dann:

```bash
pip install -r requirements.txt
python app.py          # Dev-Start
./build.sh             # App bauen (PyInstaller)
```

Architektur, Module und Render-Pipeline: [`docs/DEVELOPER.md`](docs/DEVELOPER.md). Endnutzer-Anleitung: [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md). Versions-Historie: [`CHANGELOG.md`](CHANGELOG.md).

## 🐧 Linux (aus Quellcode)

Für Linux gibt es **keinen fertigen Download** — die App braucht dort die WebKit-/GTK-Bausteine des Systems, die sich nicht zuverlässig in eine einzelne Datei packen lassen. Sie läuft deshalb direkt aus dem (offenen) Quellcode. **Durchgespielt am 13.10.2026 auf Ubuntu 24.04 (x86_64):** Start, Bibliothek anlegen und ein fertiges Video.

**1. System-Pakete** (einmalig):

```bash
# Ubuntu / Debian (getestet: Ubuntu 24.04)
sudo apt install git python3 python3-venv python3-gi python3-gi-cairo \
                 gir1.2-webkit2-4.1 libwebkit2gtk-4.1-0 libimage-exiftool-perl

# Fedora (nicht getestet)
sudo dnf install git python3 python3-gobject gobject-introspection \
                 webkit2gtk4.1 python3-cairo perl-Image-ExifTool

# Arch (läuft — von Nutzern bestätigt, Oktober 2026)
sudo pacman -S git python python-gobject webkit2gtk-4.1 perl-image-exiftool
```

ffmpeg brauchst du nicht extra — es kommt in Schritt 2 mit.

**2. Herunterladen und einrichten:**

```bash
git clone https://github.com/docarzt123/reisezoom-gps-studio.git
cd reisezoom-gps-studio
python3 -m venv --system-site-packages .venv   # --system-site-packages → die venv sieht das System-GTK (gi)
source .venv/bin/activate
pip install -r requirements.txt
```

**3. Render-Browser einmalig installieren.** Unter **Ubuntu / Debian** in einem Schritt (fragt nach deinem `sudo`-Passwort, weil Chromium ein paar System-Bibliotheken braucht):

```bash
python -m playwright install --with-deps chromium-headless-shell
```

Unter **Arch** und **Fedora** geht `--with-deps` nicht — es ruft intern `apt-get` auf. Dort die Bibliotheken mit dem eigenen Paketmanager holen und den Browser ohne `--with-deps` installieren:

```bash
# Arch
sudo pacman -S --needed nss at-spi2-core libcups libdrm libxkbcommon libxcomposite libxdamage libxrandr mesa pango alsa-lib
# Fedora
sudo dnf install nss atk at-spi2-atk cups-libs libdrm libxkbcommon libXcomposite libXdamage libXrandr mesa-libgbm pango alsa-lib

python -m playwright install chromium-headless-shell
```

**4. Starten:**

```bash
python app.py
```

Beim ersten Start fragt die App, wo die Bibliothek liegen soll (Vorschlag: im Ordner `reisezoom-gps-studio/Bibliothek`). Danach jedes Mal: `cd reisezoom-gps-studio && source .venv/bin/activate && python app.py`.

**Aktualisieren:** im Ordner `git pull` und `pip install -r requirements.txt` — deine Bibliothek und Einstellungen bleiben dabei unberührt.

**Gut zu wissen:**
- **Nicht die Windows-Fassung unter Wine** — sie braucht WebView2 und .NET und läuft dort nicht. Der Weg oben ist der richtige.
- **Absturz direkt beim Start** mit `has invalid format` im Terminal: Das war ein Fehler mit dem Menü unter GTK, behoben seit 13.10.2026 — einfach aktualisieren (`git pull`).
- Ohne ExifTool funktionieren JPEG-, TIFF- und HEIC-Fotos trotzdem (eingebaut); nur RAW-Dateien (CR3, NEF, ARW, RAF, RW2, ORF, DNG, PEF, RWL, SRW), Video-Metadaten und GPS-Schreiben in HEIC brauchen exiftool.

## 📜 Lizenz & Credits

Reisezoom GPS Studio ist **freie Software unter der [GNU GPLv3](LICENSE)** – du darfst sie nutzen, weitergeben und verändern; weitergegebene Versionen müssen ebenfalls offen unter GPLv3 bleiben.

Es bündelt großartige Open-Source-Projekte: **FFmpeg** (LGPLv2.1+/GPLv2+, libx264/libx265 sind GPL-Komponenten), **MapLibre GL JS** (BSD-3), **Mapbox GL JS** (für optionale Mapbox-Stile), **pywebview** (BSD-3), **Pillow** (HPND), **gpxpy** (Apache-2.0), **Playwright** & **Chromium** (Apache-2.0 / BSD-3), **ExifTool** (Artistic License), **pillow-heif**/**libheif** (BSD-3 / LGPLv3). Volle Liste im **Über**-Dialog der App.

---

Made with ❤️ for the trail. **reisezoom.com**
