"""v0.9.418 — Leichter Leaflet-Export der Tour-Karte fürs Blog („HTML"-Modus).

Bewusst schlank (kein MapLibre/keine Animations-Engine): Leaflet (~150 KB von
CDN) + OSM-Rasterkacheln + eine Polyline für den vollen Track + Schilder als
Bild-Marker (serverseitig via `core.sign_raster` gerastert → pixelgenau/WYSIWYG)
+ optionaler DSGVO-Consent-Gate. Kamera per `fitBounds` auf die Route oder ein
übergebener Ausschnitt (`view_center`/`view_zoom`). KEINE Fotos, keine Overlays,
kein 3D — das ist der „Spar"-Export für interaktive Blog-Einbettung.

`make_leaflet_html(params)` erwartet:
  track:        [[lat, lon], …]  (voller Track, wird SOFORT gezeichnet)
  line_color/line_width
  tile:         {url, sub, max, attr}  (aus tourmap_html.OSM_TILE_STYLES)
  signs:        [{lat, lon, img, w, h, anchor}]  (fertig gerastert, core.sign_raster)
  show_pins/start_label/end_label
  view_center:  [lat, lon] | None ; view_zoom: float | None  (sonst fitBounds)
  title/width/height
"""
from __future__ import annotations

import html as _html
import json

LEAFLET_VERSION = "1.9.4"


def render_preview_png(html: str, width: int = 1120, height: int = 640,
                       timeout_ms: int = 3500, quality: int = 72) -> bytes | None:
    """Rendert eine Leaflet-HTML headless (Playwright/Chromium) zu einem JPEG und
    gibt die Bytes zurück. Genutzt fürs DSGVO-Consent-Hintergrundbild der Web-Karte
    (ein lokal eingebettetes Standbild der Karte, damit das Gate nicht leer wirkt).
    Lädt OSM-Kacheln NUR hier beim Export auf dem Rechner des Erstellers — die
    exportierte HTML bettet danach nur das fertige Bild ein (kein Nachladen).
    Gibt None zurück, wenn Playwright/Chromium fehlt oder das Rendern scheitert."""
    import os
    import tempfile
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        return None
    tmp = None
    try:
        with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False, encoding="utf-8") as f:
            f.write(html)
            tmp = f.name
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={"width": int(width), "height": int(height)},
                                    device_scale_factor=1)
            page.goto("file://" + tmp, wait_until="load")
            page.wait_for_timeout(int(timeout_ms))  # Kacheln nachladen lassen
            shot = page.screenshot(type="jpeg", quality=int(quality))
            browser.close()
            return shot
    except Exception:
        return None
    finally:
        if tmp:
            try:
                os.unlink(tmp)
            except OSError:
                pass


def make_leaflet_html(params: dict) -> str:
    track = [[float(p[0]), float(p[1])] for p in (params.get("track") or [])
             if isinstance(p, (list, tuple)) and len(p) == 2]
    line_color = str(params.get("line_color", "#ff6b35"))
    line_width = float(params.get("line_width", 4.5) or 4.5)
    tile = params.get("tile") or {
        "url": "https://tile.openstreetmap.org/{z}/{x}/{y}.png", "sub": "", "max": 19,
        "attr": '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende',
    }
    show_pins = bool(params.get("show_pins", True))
    start_label = str(params.get("start_label", "Start"))
    end_label = str(params.get("end_label", "Ziel"))
    title = str(params.get("title", "Tour-Karte"))

    signs = []
    for s in (params.get("signs") or []):
        try:
            lat = float(s.get("lat")); lon = float(s.get("lon"))
        except (TypeError, ValueError):
            continue
        img = str(s.get("img") or "")
        if not img:
            continue
        anchor = s.get("anchor") if s.get("anchor") in ("top", "left", "right", "bottom") else "bottom"
        signs.append({"lat": lat, "lon": lon, "img": img,
                      "w": int(s.get("w", 40) or 40), "h": int(s.get("h", 40) or 40),
                      "anchor": anchor})

    # v0.9.422/428 — freie Text-Beschriftungen (Web-Karte): schlichte Leaflet-Labels,
    # kein Bild/Rastern. [{lat, lon, text, color, size}] — Farbe/Größe pro Label.
    labels = []
    for lb in (params.get("labels") or []):
        try:
            lat = float(lb.get("lat")); lon = float(lb.get("lon"))
        except (TypeError, ValueError):
            continue
        txt = str(lb.get("text") or "").strip()
        if not txt:
            continue
        color = str(lb.get("color") or "#15171c")
        try:
            size = int(float(lb.get("size", 13) or 13))
        except (TypeError, ValueError):
            size = 13
        labels.append({"lat": lat, "lon": lon, "text": txt, "color": color, "size": size})

    _vc = params.get("view_center")
    view = None
    if isinstance(_vc, (list, tuple)) and len(_vc) == 2 and params.get("view_zoom") is not None:
        try:
            view = {"center": [float(_vc[0]), float(_vc[1])], "zoom": float(params.get("view_zoom"))}
        except (TypeError, ValueError):
            view = None

    data = {
        "track": track, "signs": signs, "labels": labels, "view": view,
        "lineColor": line_color, "lineWidth": line_width,
        "showPins": show_pins, "startLabel": start_label, "endLabel": end_label,
        "tile": {"url": tile.get("url"), "sub": tile.get("sub", ""),
                 "max": int(tile.get("max", 19) or 19), "attr": tile.get("attr", "")},
    }
    D = json.dumps(data, ensure_ascii=False)

    # v0.9.430 — Leaflet-Einbindung wählbar: CDN (unpkg), selbst gehostet (eigene
    # Basis-URL) oder komplett in die HTML eingebettet (self-contained, kein externer
    # Abruf). Das % in Leaflets CSS/JS ist unkritisch: Python interpretiert % nur im
    # FORMAT-String, nicht in den eingesetzten WERTEN → leaflet_head wird als Wert
    # sicher übergeben.
    mode = str(params.get("leaflet_mode") or "cdn").lower()
    if mode == "inline" and params.get("leaflet_css") and params.get("leaflet_js"):
        leaflet_head = ("<style>" + str(params["leaflet_css"]) + "</style>\n"
                        "<script>" + str(params["leaflet_js"]) + "</script>")
    elif mode == "url" and str(params.get("leaflet_url") or "").strip():
        base = str(params["leaflet_url"]).strip()
        if not base.endswith("/"):
            base += "/"
        base = base.replace('"', "%22")
        leaflet_head = ('<link rel="stylesheet" href="' + base + 'leaflet.css">\n'
                        '<script src="' + base + 'leaflet.js"></script>')
    else:
        leaflet_head = ('<link rel="stylesheet" href="https://unpkg.com/leaflet@'
                        + LEAFLET_VERSION + '/dist/leaflet.css">\n'
                        '<script src="https://unpkg.com/leaflet@'
                        + LEAFLET_VERSION + '/dist/leaflet.js"></script>')

    return LEAFLET_TEMPLATE % {
        "title": _html.escape(title),
        "leaflet_head": leaflet_head,
        "data": D,
    }


LEAFLET_TEMPLATE = """<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>%(title)s</title>
%(leaflet_head)s
<style>
  html,body{margin:0;height:100%%}
  #rz-map{width:100%%;height:100vh;min-height:280px}
  .rz-sign{background:none;border:0}
  .leaflet-tooltip.rz-tip{background:none;border:0;padding:0;box-shadow:none;white-space:nowrap}
  .leaflet-tooltip.rz-tip:before{display:none}
</style></head><body>
<div id="rz-map"></div>
<script>
var D = %(data)s;
function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){
  return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]; }); }
function signAnchor(s){
  var w=s.w||40, h=s.h||40, d=s.anchor||'bottom';
  if(d==='top')   return [w/2, 0];
  if(d==='left')  return [0, h/2];
  if(d==='right') return [w, h/2];
  return [w/2, h];
}
function signIcon(s){ return L.icon({ iconUrl:s.img, iconSize:[s.w||40,s.h||40],
  iconAnchor:signAnchor(s), className:'rz-sign' }); }
function pinIcon(color){ return L.divIcon({ className:'rz-pin',
  html:'<span style="display:block;width:14px;height:14px;border-radius:50%%;'
     + 'background:'+color+';border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5)"></span>',
  iconSize:[20,20], iconAnchor:[10,10] }); }
(function(){
  var map = L.map('rz-map', { scrollWheelZoom:true });
  L.tileLayer(D.tile.url, { maxZoom:D.tile.max, subdomains:(D.tile.sub||''), attribution:D.tile.attr }).addTo(map);
  if (D.track && D.track.length > 1) {
    var line = L.polyline(D.track, { color:D.lineColor, weight:D.lineWidth, opacity:0.95,
      lineJoin:'round', lineCap:'round' }).addTo(map);
    if (D.view && D.view.center) { map.setView(D.view.center, D.view.zoom); }
    else { map.fitBounds(line.getBounds(), { padding:[26,26] }); }
    if (D.showPins) {
      L.marker(D.track[0], { icon:pinIcon('#2ecc71') }).bindPopup(esc(D.startLabel)).addTo(map);
      L.marker(D.track[D.track.length-1], { icon:pinIcon('#e74c3c') }).bindPopup(esc(D.endLabel)).addTo(map);
    }
  } else if (D.track && D.track.length === 1) {
    map.setView(D.track[0], 13);
  } else {
    map.setView([51.16, 10.45], 5);
  }
  (D.signs||[]).forEach(function(s){
    if (!s.img) return;
    L.marker([s.lat, s.lon], { icon:signIcon(s), interactive:false }).addTo(map);
  });
  // v0.9.425/428 — Web-Karte: Text-Labels als permanente Leaflet-Tooltips (zoom-stabil).
  // Pill mit PRO-LABEL Farbe/Größe (inline), Textfarbe automatisch nach Kontrast.
  function rzTextColor(bg){
    var m=/^#?([0-9a-f]{6})$/i.exec(String(bg||'').trim()); if(!m) return '#fff';
    var n=parseInt(m[1],16), r=(n>>16)&255, g=(n>>8)&255, b=n&255;
    return ((0.299*r+0.587*g+0.114*b)/255)>0.6 ? '#15171c' : '#fff';
  }
  function rzPill(l){
    var color=l.color||'#15171c', size=(+l.size>0)?+l.size:13;
    return '<span style="display:inline-block;white-space:nowrap;padding:4px 9px;border-radius:8px;'
      + 'font:600 '+size+"px/1.25 -apple-system,system-ui,'Segoe UI',Roboto,sans-serif;"
      + 'background:'+color+';color:'+rzTextColor(color)+';box-shadow:0 1px 4px rgba(0,0,0,.4)">'+esc(l.text)+'</span>';
  }
  (D.labels||[]).forEach(function(l){
    if (!l.text) return;
    L.tooltip({ permanent:true, direction:'top', className:'rz-tip', opacity:1,
      interactive:false, offset:[0,-2] }).setLatLng([l.lat, l.lon]).setContent(rzPill(l)).addTo(map);
  });
  setTimeout(function(){ map.invalidateSize(); }, 60);
})();
</script></body></html>"""
