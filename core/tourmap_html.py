"""v0.9.415 — Tour-Map → interaktiver HTML-Export (WYSIWYG, gleiche Engine wie
Video/Standbild).

Ab v0.9.415 wird die interaktive Blog-Karte NICHT mehr in Leaflet nachgebaut,
sondern von `core.animator.build_interactive_html()` erzeugt — d.h. dieselbe
MapLibre-GL-Pipeline, Track-/Pin-/Schild-Zeichnung (`__rzDrawSign`) wie das
Video und das PNG-Standbild. Dadurch sind Schilder, Farben, Pins und Zoom im
Blog exakt wie in der Vorschau (echtes WYSIWYG). `__rzDrawSign` läuft im
Besucher-Browser (Safari/Chrome/Firefox), wo Canvas zuverlässig funktioniert —
im App-eigenen WKWebView war genau das die Fehlerquelle der alten Rasterung.

Dieses Modul liefert nur noch die „Rahmen"-Bausteine:
  * `OSM_TILE_STYLES` — tokenfreie OSM-Kachel-Stile (SYNCHRON zu ui/js/util.js
    RZ_OSM_TILE_STYLES); die Bridge übersetzt die Auswahl in die MapLibre-
    Kachelquelle (`cfg.osm_tiles_url/osm_max_zoom/osm_attribution`).
  * `wrap_with_consent()` — optionaler DSGVO-„Karte laden"-Gate, der die Karte
    (inkl. CDN + Kacheln) ERST auf Nutzer-Klick lädt (Karte steckt base64-kodiert
    in der Seite und wird in ein `<iframe srcdoc>` dekodiert).
  * `make_tourmap_embed_snippet()` — `<iframe srcdoc>`-Snippet für den
    WordPress-„Custom HTML"-Block (kein Upload nötig, isoliert vom Theme-CSS).
"""
from __future__ import annotations

import base64
import html as _html

# Tokenfreie OSM-Kachel-Stile. `sub` = a/b/c-Subdomains ("" = keine),
# `max` = maxZoom des Providers. Katalog ist SYNCHRON zu ui/js/util.js
# (RZ_OSM_TILE_STYLES) — bei Änderung beide pflegen.
OSM_TILE_STYLES = {
    "osm": {
        "label": "OpenStreetMap Standard",
        "url": "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        "sub": "", "max": 19,
        "attr": '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende',
    },
    "topo": {
        "label": "OpenTopoMap (Gelände)",
        "url": "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
        "sub": "abc", "max": 17,
        "attr": 'Kartendaten: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende, SRTM | Darstellung: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    },
    "cyclosm": {
        "label": "CyclOSM (Rad/Outdoor)",
        "url": "https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
        "sub": "abc", "max": 20,
        "attr": '<a href="https://www.cyclosm.org">CyclOSM</a> | &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende',
    },
    "humanitarian": {
        "label": "Humanitarian (hell)",
        "url": "https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
        "sub": "abc", "max": 20,
        "attr": '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende, Tiles: HOT',
    },
}

DEFAULT_CONSENT_TEXT = (
    "Zum Anzeigen der interaktiven Karte werden Kartenkacheln von OpenStreetMap "
    "geladen. Dabei wird deine IP-Adresse an den Kartenanbieter übertragen. "
    "Mit Klick auf „Karte laden“ stimmst du dem zu."
)


def tile_style(style_id: str) -> dict:
    return OSM_TILE_STYLES.get(style_id, OSM_TILE_STYLES["osm"])


def wrap_with_consent(inner_html: str, consent_text: str, consent_button: str,
                      bg_data_uri: str = "") -> str:
    """DSGVO-Gate um die interaktive Karte: die komplette Karten-Seite (inkl.
    CDN-Scripts + Kachel-Abrufe) wird ERST geladen, wenn der Nutzer „Karte laden"
    klickt. Die Karte steckt base64-kodiert in der Seite und wird beim Klick in ein
    `<iframe srcdoc>` dekodiert — kein Netzwerk-Zugriff vor der Einwilligung.

    `bg_data_uri` (optional): ein LOKAL eingebettetes Vorschaubild der Karte
    (data:-URI, z.B. serverseitig gerendertes JPEG). Es liegt geblurrt+abgedunkelt
    HINTER dem Zustimmungs-Text, damit das Gate nicht leer wirkt. Das Bild ist Teil
    der HTML (kein externer Abruf) → DSGVO-konform, es lädt nichts nach.
    """
    b64 = base64.b64encode(inner_html.encode("utf-8")).decode("ascii")
    txt = _html.escape(consent_text or DEFAULT_CONSENT_TEXT).replace("\n", "<br>")
    btn = _html.escape(consent_button or "Karte laden")
    has_bg = bool(bg_data_uri)
    if has_bg:
        bg_style = ("background-image:url('" + bg_data_uri + "');background-size:cover;"
                    "background-position:center;filter:blur(3px) brightness(.72);transform:scale(1.06)")
        inner_color = "color:#fff;text-shadow:0 1px 4px rgba(0,0,0,.6)"
    else:
        bg_style = "background:#eef1f5"
        inner_color = "color:#2a2f3a"
    return (
        "<!DOCTYPE html>\n"
        '<html lang="de"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        "<style>"
        "html,body{margin:0;height:100%}"
        ".rz-wrap{position:relative;width:100%;height:100vh;min-height:320px;overflow:hidden}"
        ".rz-consent{position:absolute;inset:0;overflow:hidden;display:flex;"
        "align-items:center;justify-content:center;"
        "font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}"
        ".rz-bg{position:absolute;inset:0;" + bg_style + "}"
        ".rz-consent-inner{position:relative;z-index:1;display:flex;flex-direction:column;"
        "align-items:center;justify-content:center;gap:16px;padding:24px;text-align:center;"
        + inner_color + "}"
        ".rz-consent-inner p{max-width:640px;margin:0}"
        ".rz-consent-inner button{padding:11px 22px;border:0;border-radius:9px;background:#ff6b35;"
        "color:#fff;font-size:15px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.35)}"
        ".rz-consent-inner button:hover{background:#ff5a1f}"
        ".rz-wrap iframe{border:0;width:100%;height:100%;display:block}"
        "</style></head><body>"
        '<div class="rz-wrap" id="rz-wrap">'
        '<div class="rz-consent" id="rz-consent">'
        '<div class="rz-bg"></div>'
        '<div class="rz-consent-inner"><p>' + txt + "</p>"
        '<button type="button" id="rz-load">' + btn + "</button>"
        "</div></div></div>"
        "<script>"
        'var __rzB64="' + b64 + '";'
        "function __rzUtf8(b){return decodeURIComponent(escape(b));}"
        'document.getElementById("rz-load").addEventListener("click",function(){'
        'var w=document.getElementById("rz-wrap");w.innerHTML="";'
        'var f=document.createElement("iframe");f.setAttribute("allowfullscreen","");'
        'f.srcdoc=__rzUtf8(atob(__rzB64));w.appendChild(f);'
        "});"
        "</script></body></html>"
    )


def make_tourmap_embed_snippet(standalone_html: str, width: int = 1120, height: int = 640) -> str:
    """Fertiges <iframe srcdoc>-Snippet für den WordPress-„Custom HTML"-Block.
    Isoliert vom Theme-CSS, kein Upload nötig — die komplette Karte steckt im srcdoc."""
    w, h = int(width or 1120), int(height or 640)
    esc = _html.escape(standalone_html, quote=True)
    return ('<iframe title="Tour-Karte" loading="lazy" allowfullscreen '
            'style="width:100%;max-width:' + str(w) + 'px;aspect-ratio:' + str(w) + '/' + str(h)
            + ';border:0;display:block;margin:1rem auto;border-radius:10px" '
            'srcdoc="' + esc + '"></iframe>')
