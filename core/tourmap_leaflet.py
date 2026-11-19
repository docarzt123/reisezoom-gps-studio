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
  link_klick (15.11.2026): "schild" (Standard) = Klick zeigt ein Schild mit Name + Link wie am Pin, "sofort" = Klick öffnet.
  tracks[].link / link_ziel (08.11.2026): Track mit Link ist anklickbar — Überfahren zeigt den Namen, ein Klick öffnet die
                Seite (link_ziel "_top" = Fenster der einbettenden Seite, "_blank" = neuer Tab). Nur http(s)-, mailto- und
                relative Adressen; alles andere (javascript:, data: …) fällt weg.
"""
from __future__ import annotations

import html as _html
import json
from core.northarrow import north_svg_fuer
from core import dateischutz as _ds  # 14.09.2026: jeder Datei-Eingriff geprüft + gesichert
from core import i18n as _i18n  # 29.09.2026 — Exportseite in der App-Sprache

LEAFLET_VERSION = "1.9.4"


def tour_name(name) -> str:
    """Anzeigename eines Tracks. 15.11.2026 (Nutzer-Meldung Windows): die Web-Karte nahm beim Hinzufügen den Dateinamen
    mit `split("/")` — unter Windows (Pfade mit `\\`) blieb so der ganze Pfad „C:\\Users\\…\\import\\Tour“ als Name stehen und
    stand in der fertigen Karte. Ein Name, der wie ein ganzer Pfad aussieht, wird auf seinen letzten Teil gekürzt
    (repariert bestehende Projekte); gewöhnliche Namen mit „/“ („Tag 1/2“) bleiben unverändert."""
    s = str(name or "").strip()
    if len(s) > 2 and ((s[1] == ":" and s[2] in "\\/") or s.startswith("\\\\") or (s.startswith("/") and s.count("/") > 1)):
        s = s.replace("\\", "/").rstrip("/").split("/")[-1]
    return s


def sicherer_link(url) -> str:
    """08.11.2026 — Link eines Tracks für die exportierte Karte: http(s), mailto oder relativ (z. B. „tour.html“);
    Adressen mit anderem Schema (javascript:, data:, file: …) werden verworfen — die Karte landet auf fremden Seiten."""
    import re as _re
    u = str(url or "").strip()
    if not u or any(c in u for c in "\r\n\t\x00"):
        return ""
    m = _re.match(r"^([a-zA-Z][a-zA-Z0-9+.\-]*):", u)
    if m and m.group(1).lower() not in ("http", "https", "mailto"):
        return ""
    return u


def render_preview_png(html: str, width: int = 1120, height: int = 640,
                       timeout_ms: int = 3500, quality: int = 72) -> bytes | None:
    """Rendert eine Leaflet-HTML headless (Playwright/Chromium) zu einem JPEG und
    gibt die Bytes zurück. Genutzt fürs DSGVO-Consent-Hintergrundbild der Web-Karte
    (ein lokal eingebettetes Standbild der Karte, damit das Gate nicht leer wirkt).
    Lädt OSM-Kacheln NUR hier beim Export auf dem Rechner des Erstellers — die
    exportierte HTML bettet danach nur das fertige Bild ein (kein Nachladen).
    Gibt None zurück, wenn Playwright/Chromium fehlt oder das Rendern scheitert."""
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        return None
    tmp = tmp_dir = None
    try:
        # Eigener, beim Dateischutz gemerkter Temp-Ordner statt NamedTemporaryFile.
        tmp_dir = _ds.temp_ordner("rz-leaflet-")
        tmp = str(tmp_dir / "karte.html")
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(html)
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
        if tmp_dir:
            try:
                # Temp-Wurzeln selbst lässt der Dateischutz nicht löschen → genau diesen
                # eigenen Ordner als Ziel dieses Vorgangs anmelden.
                _ds.nutzer_ziel(tmp_dir)
                _ds.ordner_loeschen(tmp_dir, "leaflet_vorschau", art=_ds.ART_TEMP, ignore_errors=True)
            except OSError:
                pass


def make_leaflet_html(params: dict) -> str:
    track = [[float(p[0]), float(p[1])] for p in (params.get("track") or [])
             if isinstance(p, (list, tuple)) and len(p) == 2]
    line_color = str(params.get("line_color", "#ff6b35"))
    line_width = float(params.get("line_width", 4.5) or 4.5)
    tile = params.get("tile") or {
        "url": "https://tile.openstreetmap.org/{z}/{x}/{y}.png", "sub": "", "max": 19,
        "attr": '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }
    show_pins = bool(params.get("show_pins", True))
    # 29.09.2026 — Rückfälle in der App-Sprache (app.py liefert sie meist schon mit)
    start_label = str(params.get("start_label") or _i18n.t_aktiv("webkarte.start", "Start"))
    end_label = str(params.get("end_label") or _i18n.t_aktiv("webkarte.ziel", "Ziel"))
    title = str(params.get("title") or _i18n.t_aktiv("tourmap.export.iframe_titel", "Tour-Karte"))

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

    # §17 — Multi-Track: N Polylines mit eigener Farbe/Breite/Pins/Name.
    # Fallback (Single-Track): der klassische `track` wird zu einer 1-Element-Liste,
    # sodass alte Aufrufe (und alte Projekte) unverändert weiterlaufen.
    tracks_in = params.get("tracks")
    tracks_norm = []
    if isinstance(tracks_in, list) and tracks_in:
        for t in tracks_in:
            c = [[float(p[0]), float(p[1])] for p in (t.get("coords") or [])
                 if isinstance(p, (list, tuple)) and len(p) == 2]
            if not c:
                continue
            tracks_norm.append({
                "c": c, "col": str(t.get("color") or line_color),
                "w": float(t.get("width", line_width) or line_width),
                "pins": bool(t.get("show_pins", True)),
                "name": tour_name(t.get("name")),
                "link": sicherer_link(t.get("link")),
            })
    if not tracks_norm and track:
        tracks_norm = [{"c": track, "col": line_color, "w": line_width,
                        "pins": show_pins, "name": ""}]

    data = {
        "track": track, "tracks": tracks_norm, "signs": signs, "labels": labels, "view": view,
        "lineColor": line_color, "lineWidth": line_width,
        "showPins": show_pins, "startLabel": start_label, "endLabel": end_label,
        "linkZiel": "_blank" if params.get("link_ziel") == "_blank" else "_top",
        # 15.11.2026 — Klick auf einen Track: erst Schild mit Name + Link (Standard) oder sofort öffnen
        "linkKlick": "sofort" if params.get("link_klick") == "sofort" else "schild",
        "linkText": _i18n.t_aktiv("webkarte.link_oeffnen", "Zur Tour →"),
        # 04.09.2026 — Maßstabsleiste + Nordpfeil (Beta-Tester), Standard an
        "showScale": bool(params.get("show_scale", True)), "showNorth": bool(params.get("show_north", True)),
        "pfeile": bool(params.get("richtungspfeile", False)),   # 18.11.2026 — Richtungspfeile entlang der Tracks
        "northSvg": north_svg_fuer(params),   # 25.10.2026 — Kompass je Look (sonst der Pfeil)
        # 15.09.2026 (Marc) — Quellenangabe: "ecke" (Leaflet-Standard) oder "voll" (schmale Leiste unten)
        "attribVoll": str(params.get("quellenangabe") or "ecke") == "voll",
        "tile": {"url": tile.get("url"), "sub": tile.get("sub", ""),
                 "max": int(tile.get("max", 19) or 19), "attr": tile.get("attr", ""),
                 # 03.09.2026 — staatliche Orthofotos: WMS-Angaben / TMS-Flag durchreichen
                 **({"wms": tile["wms"]} if tile.get("wms") else {}),
                 **({"tms": True} if tile.get("tms") else {}),
                 **({"stack": tile["stack"]} if tile.get("stack") else {}),
                 **({"adjust": dict(tile["adjust"])} if isinstance(tile.get("adjust"), dict) else {})},
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

    # v0.9.431 — abschaltbarer „erstellt mit"-Backlink auf der Karte (Cross-Promo +
    # SEO-Backlink zur Webversion). Nur wenn Text UND URL da sind.
    credit_html = credit_link_html(params.get("credit_text"), params.get("credit_url"))

    return LEAFLET_TEMPLATE % {
        "lang": _html.escape(_i18n.sprache_aktiv(), quote=True),
        "title": _html.escape(title),
        "leaflet_head": leaflet_head,
        "credit": credit_html,
        "data": D,
    }


def credit_link_html(text, url) -> str:
    """Kleiner „erstellt mit …"-Link (Cross-Promo/Backlink), absolut unten-links.
    Leerer String, wenn Text oder URL fehlt."""
    t = str(text or "").strip()
    u = str(url or "").strip()
    if not t or not u:
        return ""
    return ('<a class="rz-credit" href="' + _html.escape(u, quote=True)
            + '" target="_blank" rel="noopener">' + _html.escape(t) + "</a>")


LEAFLET_TEMPLATE = """<!DOCTYPE html>
<html lang="%(lang)s"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>%(title)s</title>
%(leaflet_head)s
<style>
  html,body{margin:0;height:100%%}
  #rz-map{width:100%%;height:100vh;min-height:280px}
  .rz-credit{position:absolute;left:8px;bottom:8px;z-index:600;background:rgba(255,255,255,.88);
    color:#1c1814;font:600 11px/1 -apple-system,system-ui,'Segoe UI',Roboto,sans-serif;
    padding:5px 8px;border-radius:6px;text-decoration:none;box-shadow:0 1px 3px rgba(0,0,0,.3)}
  .rz-credit:hover{background:#fff}
  .rz-attrib-voll .leaflet-bottom.leaflet-right{left:0;right:0}
  .rz-attrib-voll .leaflet-bottom.leaflet-right .leaflet-control-attribution{float:none;margin:0;width:100%%;box-sizing:border-box;
    text-align:center;font-size:8.5px;line-height:1.3;padding:1px 10px;background:rgba(0,0,0,.45);color:rgba(255,255,255,.85);border-radius:0}
  .rz-attrib-voll .leaflet-control-attribution a{color:inherit;opacity:.85}
  .rz-attrib-voll ~ .rz-credit, .rz-attrib-voll .rz-credit{bottom:22px}
  .rz-north{width:40px;height:40px;pointer-events:none}
  .rz-north svg{width:100%%;height:100%%;display:block;filter:drop-shadow(0 1px 3px rgba(0,0,0,.5))}
  .rz-sign{background:none;border:0}
  .leaflet-tooltip.rz-tip{background:none;border:0;padding:0;box-shadow:none;white-space:nowrap}
  .leaflet-tooltip.rz-tip:before{display:none}
  .rz-link{cursor:pointer}
  .leaflet-tooltip.rz-link-tip{font:600 12px/1.3 -apple-system,system-ui,'Segoe UI',Roboto,sans-serif}
</style></head><body>
<div id="rz-map"></div>
%(credit)s
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
  if (D.attribVoll) document.getElementById('rz-map').classList.add('rz-attrib-voll');
  var map = L.map('rz-map', { scrollWheelZoom:true });
  // 03.09.2026 — staatliche Orthofotos: WMS (L.tileLayer.wms) oder TMS-Kacheln
  function rzTile(t, attr){
    // maxNativeZoom: darüber wird hochskaliert statt leer; minZoom: Orthofotos
    // erst ab z7 (darunter liefern manche Dienste Rausch-Muster) — der Blue-
    // Marble-Untergrund (t.base) füllt Meer und Ferne.
    var o = { maxZoom:22, maxNativeZoom:t.max, minZoom:(t.min||0), attribution:attr };
    if (!t.base && D.tile.adjust) o.className = 'rz-ortho';   // Luftbild-Optik (s. Style-Block unten)
    return t.wms
      ? L.tileLayer.wms(t.wms.base, Object.assign(o, { layers:t.wms.layers, format:(t.wms.format||'image/jpeg'),
          version:'1.3.0', transparent:!!t.wms.transparent }))
      : L.tileLayer(t.url, Object.assign(o, { subdomains:(t.sub||''), tms:!!t.tms }));
  }
  // Stapel (mehrere Bundesländer, unten → oben): nur die oberste trägt die Nennung
  if (D.tile.adjust) {   // 04.09.2026 — Luftbild-Optik wie in der App (Sättigung/Kontrast/Helligkeit/Farbton)
    var A = D.tile.adjust, st = document.createElement('style');
    st.textContent = '.rz-ortho{filter:saturate(' + (1 + (A.sat||0) / 100).toFixed(2) + ') contrast(' + (1 + (A.con||0) / 100).toFixed(2)
      + ') brightness(' + (1 + (A.bri||0) / 100 * 0.5).toFixed(2) + ') hue-rotate(' + (A.hue||0).toFixed(0) + 'deg)}';
    document.head.appendChild(st);
  }
  if (D.tile.stack && D.tile.stack.length) {
    D.tile.stack.forEach(function(t, i){ rzTile(t, i === D.tile.stack.length - 1 ? D.tile.attr : '').addTo(map); });
  } else {
    rzTile(D.tile, D.tile.attr).addTo(map);
  }
  // 08.11.2026 — Track mit Link: breite unsichtbare Klickfläche (die dünne Linie trifft man schlecht), Überfahren hebt den
  // Track hervor und zeigt den Namen, Klick öffnet die Seite — eingebettet im Fenster der einbettenden Seite (_top).
  function rzOeffnen(url){
    var a = document.createElement('a'); a.href = url; a.target = D.linkZiel || '_top'; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
  }
  function rzPopup(t, text){
    var h = esc(text);
    if (t.link) h += (h ? '<br>' : '') + '<a href="' + esc(t.link) + '" target="' + (D.linkZiel || '_top') + '" rel="noopener">' + esc(D.linkText || '→') + '</a>';
    return h;
  }
  // 15.11.2026 (Nutzer-Meldung) — Name beim Überfahren lief mit der Maus mit (sticky) und blieb stehen, wenn die Maus
  // die Karte verließ: hit.bringToFront() hängte die Klickfläche während des Überfahrens im SVG um, dann fehlte dem
  // Browser das „mouseout“. Jetzt: Klickflächen in eigener Ebene über den Linien (nichts wird umgehängt), der Name
  // steht fest dort, wo die Maus den Track erreicht, und verschwindet beim Verlassen von Track und Karte.
  var rzTips = [];
  function rzHitPane(){
    if (!map.getPane('rzHit')) { map.createPane('rzHit').style.zIndex = 450; }
    return 'rzHit';
  }
  function rzTipsZu(){ rzTips.forEach(function(x){ map.closeTooltip(x); }); }
  map.getContainer().addEventListener('mouseleave', rzTipsZu);
  var rzPopOffen = false;   // offenes Schild (Pin oder Track) → kein zusätzlicher Name beim Überfahren
  map.on('popupopen', function(){ rzPopOffen = true; rzTipsZu(); });
  map.on('popupclose', function(){ rzPopOffen = false; });
  function rzLinkTrack(t, line){
    var w = t.w, hit = L.polyline(t.c, { weight:Math.max(16, w + 10), opacity:0, className:'rz-link',
      pane:rzHitPane() }).addTo(map);
    var tip = null;
    if (t.name) {
      tip = L.tooltip({ direction:'top', className:'rz-link-tip', offset:[0,-10], interactive:false }).setContent(esc(t.name));
      rzTips.push(tip);
    }
    hit.on('mouseover', function(e){
      line.setStyle({ weight:w + 3 }); line.bringToFront();
      if (tip && !rzPopOffen) { rzTipsZu(); tip.setLatLng(e.latlng); map.openTooltip(tip); }
    });
    hit.on('mouseout', function(){ line.setStyle({ weight:w }); if (tip) map.closeTooltip(tip); });
    // 15.11.2026 (Marc: „Wenn man direkt draufklickt und dann sofort rausspringt, ist das irgendwie doof“) — Standard:
    // Klick zeigt an der Klickstelle dasselbe Schild wie am Pin (Name + „Zur Tour →“), erst der Link öffnet die Seite.
    function klick(e){
      if (D.linkKlick === 'sofort') { rzOeffnen(t.link); return; }
      rzTipsZu();
      L.popup({ className:'rz-link-pop', autoPan:true }).setLatLng(e.latlng).setContent(rzPopup(t, t.name || '')).openOn(map);
    }
    hit.on('click', klick);
    line.on('click', klick);
  }
  // 18.11.2026 (Nutzer-Wunsch) — Richtungspfeile in festem Bildschirmabstand, nach jedem Zoomen/Verschieben neu.
  // SYNCHRON zu modules/web-karte/ui/module.js (rzPfeile in der Vorschau) — bei Änderung beide pflegen.
  function rzPfeile(line, col, w){
    var grp = L.layerGroup().addTo(map);
    function zeichnen(){
      grp.clearLayers();
      var ll = line.getLatLngs();
      if (ll.length < 2 || !map.getBounds().intersects(line.getBounds())) return;
      var abst = Math.max(80, w * 16), s = Math.round(Math.max(18, w * 4)), b = map.getBounds().pad(0.1);
      var acc = abst / 2, n = 0, p0 = map.latLngToLayerPoint(ll[0]);
      for (var i = 1; i < ll.length && n < 300; i++){
        var p1 = map.latLngToLayerPoint(ll[i]);
        var dx = p1.x - p0.x, dy = p1.y - p0.y, d = Math.sqrt(dx * dx + dy * dy), t = 0;
        while (d > 0 && acc <= d - t){
          t += acc; acc = abst;
          var pos = map.layerPointToLatLng([p0.x + dx * t / d, p0.y + dy * t / d]);
          if (!b.contains(pos)) continue;
          var wink = Math.atan2(dy, dx) * 180 / Math.PI;
          grp.addLayer(L.marker(pos, { interactive:false, keyboard:false, icon:L.divIcon({ className:'rz-pfeil', iconSize:[s,s], iconAnchor:[s/2,s/2],
            html:'<svg width="' + s + '" height="' + s + '" viewBox="0 0 10 10" style="display:block;transform:rotate(' + wink.toFixed(1) + 'deg)"><path d="M2 1.6 L8.6 5 L2 8.4 L3.9 5 Z" fill="#fff" stroke="' + esc(col) + '" stroke-width="1.2" stroke-linejoin="round"/></svg>' }) }));
          n++;
        }
        acc -= (d - t);
        p0 = p1;
      }
    }
    map.on('zoomend moveend', zeichnen);
    map.whenReady(zeichnen);
  }
  // §17 — mehrere Tracks: pro Track eine Polylinie, fitBounds über die Vereinigung.
  var allB = null;
  (D.tracks||[]).forEach(function(t){
    var c = t.c || [];
    if (c.length > 1) {
      var line = L.polyline(c, { color:t.col, weight:t.w, opacity:0.95,
        lineJoin:'round', lineCap:'round' }).addTo(map);
      var b = line.getBounds();
      allB = allB ? allB.extend(b) : L.latLngBounds(b.getSouthWest(), b.getNorthEast());
      if (t.link) rzLinkTrack(t, line);
      if (D.pfeile) rzPfeile(line, t.col, t.w);
      if (t.pins) {
        L.marker(c[0], { icon:pinIcon('#2ecc71') }).bindPopup(rzPopup(t, t.name || D.startLabel)).addTo(map);
        L.marker(c[c.length-1], { icon:pinIcon('#e74c3c') }).bindPopup(rzPopup(t, t.name || D.endLabel)).addTo(map);
      }
    } else if (c.length === 1) {
      var ll = L.latLng(c[0][0], c[0][1]);
      allB = allB ? allB.extend(ll) : L.latLngBounds(ll, ll);
    }
  });
  // 08.11.2026 — Ausschnitt: das „else“ hing an „Nordpfeil an“ statt am gespeicherten Ausschnitt — ohne übergebenen
  // Ausschnitt und mit Nordpfeil blieb die Karte ohne Ansicht (leer). Jetzt: Ausschnitt, sonst alle Tracks, sonst Deutschland.
  if (D.view && D.view.center) { map.setView(D.view.center, D.view.zoom); }
  else if (allB && allB.isValid()) { map.fitBounds(allB, { padding:[26,26] }); }
  else { map.setView([51.16, 10.45], 5); }
  // 04.09.2026 — Maßstabsleiste + Nordpfeil (Leaflet: Norden ist immer oben)
  if (D.showScale) { L.control.scale({ imperial:false, metric:true, position:'bottomright' }).addTo(map); }
  if (D.showNorth) {
    var RzNorth = L.Control.extend({ onAdd: function(){ var d = L.DomUtil.create('div','rz-north'); d.innerHTML = D.northSvg; return d; } });
    new RzNorth({ position:'topright' }).addTo(map);
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
