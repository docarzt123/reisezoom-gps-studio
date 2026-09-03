// Reisezoom GPS Studio — gemeinsame Util-Funktionen

const api = () => window.pywebview && window.pywebview.api;

function fmtKm(m) {
  if (m == null) return "—";
  return (m / 1000).toFixed(1) + " km";
}
function fmtDur(s) {
  if (s == null) return "—";
  s = Math.floor(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = n => n < 10 ? "0" + n : "" + n;
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}
function fmtMeter(m) {
  if (m == null) return "—";
  return Math.round(m) + " m";
}
function fmtCoord(lat, lon) {
  if (lat == null || lon == null) return "—";
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}
function fmtSeconds(s) {
  if (s == null) return "—";
  const sign = s < 0 ? "-" : "+";
  const abs = Math.abs(Math.round(s));
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const sec = abs % 60;
  const parts = [];
  if (h) parts.push(h + "h");
  if (m) parts.push(m + "m");
  if (sec || !parts.length) parts.push(sec + "s");
  return sign + parts.join(" ");
}

/**
 * v0.9.27 (Nutzer-Feedback): User-freundlicher Parser für Zeit-Offsets.
 * Akzeptiert verschiedene Schreibweisen, gibt Sekunden zurück (oder null bei Fehler).
 *
 * Beispiele:
 *   "4s"      → 4
 *   "-4s"     → -4
 *   "90"      → 90       (reine Zahl ohne Suffix = Sekunden)
 *   "4m"      → 240
 *   "5m30s"   → 330
 *   "1h"      → 3600
 *   "1h30m"   → 5400
 *   "-2h"     → -7200
 *   "1:30:00" → 5400     (Doppelpunkt-Notation)
 *   "1:30"    → 5400     (h:m wenn ≥ 1h plausibel, sonst m:s)
 *
 * Gibt null zurück wenn der String nicht geparst werden kann.
 */
function parseTimeOffset(input) {
  if (typeof input !== "string") return null;
  const s = input.trim().toLowerCase();
  if (!s) return null;
  // Pure Zahl: als Sekunden interpretieren
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    return Math.round(parseFloat(s));
  }
  // Doppelpunkt-Notation: 1:30 oder 1:30:00
  const colonMatch = s.match(/^(-?)(\d+):(\d+)(?::(\d+))?$/);
  if (colonMatch) {
    const sign = colonMatch[1] === "-" ? -1 : 1;
    const a = parseInt(colonMatch[2]);
    const b = parseInt(colonMatch[3]);
    const c = colonMatch[4] != null ? parseInt(colonMatch[4]) : null;
    if (c != null) return sign * (a * 3600 + b * 60 + c);
    // ohne dritte Komponente: h:m
    return sign * (a * 3600 + b * 60);
  }
  // h/m/s-Notation: -1h30m45s, 5m, 4s, 4h
  // Sign erkennen + abschneiden, dann jede Komponente einzeln matchen
  let sign = 1;
  let rest = s;
  if (rest.startsWith("-")) { sign = -1; rest = rest.slice(1); }
  else if (rest.startsWith("+")) { rest = rest.slice(1); }
  const re = /(\d+(?:\.\d+)?)\s*(h|m|s)/g;
  let total = 0;
  let consumed = 0;
  let match;
  while ((match = re.exec(rest)) != null) {
    const n = parseFloat(match[1]);
    const unit = match[2];
    if (unit === "h") total += n * 3600;
    else if (unit === "m") total += n * 60;
    else total += n;
    consumed += match[0].length;
  }
  // Wenn nichts konsumiert oder nicht der ganze String → Fehler
  // (rest erlaubt Whitespace dazwischen)
  const restNoSpace = rest.replace(/\s+/g, "");
  const consumedNoSpace = rest.match(re) ? rest.match(re).join("").replace(/\s+/g, "") : "";
  if (!consumedNoSpace || consumedNoSpace !== restNoSpace) return null;
  return Math.round(sign * total);
}

// Globale Fehler abfangen, damit nichts stillschweigend verschwindet
// 22.08.2026 — Mapbox-Nachzügler: Eine Kachel wird fertig, nachdem die Karte
// beim Modulwechsel schon abgebaut wurde (`style` ist dann undefined →
// „reading 'getOwnLayer'"). Harmlos, nichts zu tun — aber als roter Toast
// hat es einen Beta-Tester neben einem echten Fehler verunsichert. Nur loggen.
function _rzMapboxNachzuegler(ev) {
  const msg = String(ev && (ev.message || (ev.error && ev.error.message)) || "");
  const datei = String(ev && ev.filename || "");
  return /getOwnLayer|_getDrapedTiles|terrain\._clearRenderCache/.test(msg) && /mapbox-gl|maplibre-gl/.test(datei);
}
window.addEventListener("error", (ev) => {
  if (_rzMapboxNachzuegler(ev)) { try { applog("warn", "[mapbox] Nachzügler nach Karten-Abbau (ignoriert): " + ev.message); } catch (_) {} ev.preventDefault(); return; }
  console.error("[JS-Fehler]", ev.error || ev.message, ev);
  try {
    toast(t("error.js", "JS-Fehler") + ": " + (ev.message || (ev.error && ev.error.message) || t("error.unknown", "unbekannt")), "error", 7000);
  } catch (_) {}
});
window.addEventListener("unhandledrejection", (ev) => {
  console.error("[Unhandled Promise]", ev.reason);
  try {
    const msg = (ev.reason && (ev.reason.message || ev.reason.toString())) || "unbekannt";
    toast(t("error.promise", "Promise-Fehler") + ": " + msg, "error", 7000);
  } catch (_) {}
});

// ── Kartenanbieter zur Auswahl (03.09.2026) ─────────────────────────────────
//
// Die Stilliste kommt aus core/mapstyles.py (Brücke `map_catalog`). Hier steht
// der Spiegel von `mapstyles.resolve()`: Stil-Schlüssel + Schlüssel + Track-Lage
// → Engine, Style, Gelände, Nennung. Bei Änderung BEIDE pflegen.
//
// Regel: Mapbox-Stile laufen in Mapbox GL JS (Token), ALLE anderen in MapLibre
// GL JS — Mapbox GL JS darf mit fremden Kacheln lizenzrechtlich nicht betrieben
// werden. Die Engine hängt damit am Stil; ein Wechsel über die Engine-Grenze
// baut die Karte neu (Modul-Remount, siehe `applyMapStyle`).

const OSM_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

// Notfall-Katalog, falls die Brücke noch nicht geantwortet hat (Start, Tests).
const _RZ_FALLBACK_CATALOG = {
  default: "free_satellite", default_style: "free_satellite", group_order: ["free"],
  styles: [
    { key: "free_satellite", provider: "gov", kind: "gov", group: "free", label: "Satellit (kostenlos)", terrain: "aws", badge: "free", available: true },
    { key: "osm", provider: "osm", kind: "raster", group: "free", label: "OpenStreetMap", terrain: "aws", badge: "free", available: true,
      tiles: [OSM_TILE_URL], tileSize: 256, maxzoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' },
  ],
  terrain: { aws: { tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 15, encoding: "terrarium", attribution: "Gelände: Mapzen/AWS Terrain Tiles" } },
  regions: [], keys: { mapbox: false, maptiler: false }, key_values: { mapbox: "", maptiler: "" },
};
window.RZ_MAP_CATALOG = null;
function mapCatalog() { return window.RZ_MAP_CATALOG || _RZ_FALLBACK_CATALOG; }
function mapStyleDef(key) { return mapCatalog().styles.find(s => s.key === key) || null; }
function mapStyleKnown(key) { return !!mapStyleDef(key); }
function mapDefaultStyle() { const c = mapCatalog(); return c.default_style || c.default || "free_satellite"; }
/** Kurzer Text zur Rechtelage eines Stils (für Listen und Hinweise). */
function mapStyleBadgeText(key) {
  const d = mapStyleDef(key); const b = d ? d.badge : "free";
  if (b === "video_rights") return t("mapstyle.badge.video_rights", "Video: Rechte nötig");
  if (b === "key") return t("mapstyle.badge.key", "Schlüssel nötig");
  return t("mapstyle.badge.free", "kostenlos");
}
function mapStyleLabel(key) {
  const d = mapStyleDef(key);
  return d ? t("mapstyle." + key, d.label) : key;
}
/** True, wenn der Stil ohne gekaufte Videorechte veröffentlicht werden darf. */
function mapStyleVideoOk(key) { const d = mapStyleDef(key); return !d || d.badge !== "video_rights"; }

// Mapbox-URL → Stil-Schlüssel (für alte Aufrufer, die noch `mapboxStyle` übergeben).
function _mapKeyFromMapboxUrl(url) {
  const d = mapCatalog().styles.find(s => s.style_url && s.style_url === url);
  return d ? d.key : null;
}

/** Die Orthofoto-Region für ein Track-Rechteck [lon_min, lat_min, lon_max, lat_max]
 *  — Mittelpunkt, kleinste Fläche gewinnt (Spiegel von mapstyles.region_for_bbox). */
/** Track-Rechteck in [lon_min, lat_min, lon_max, lat_max] — die Brücke liefert
 *  ein Objekt {min_lat, max_lat, min_lon, max_lon} (core/gpx.py), Module rechnen
 *  teils mit Arrays. Beides wird hier angenommen; null, wenn nichts Brauchbares. */
function mapBboxArray(b) {
  if (!b) return null;
  if (Array.isArray(b)) return (b.length >= 4 && b.every(v => isFinite(Number(v)))) ? b.slice(0, 4).map(Number) : null;
  if (typeof b === "object" && b.min_lon != null && b.min_lat != null) {
    const a = [Number(b.min_lon), Number(b.min_lat), Number(b.max_lon), Number(b.max_lat)];
    return a.every(v => isFinite(v)) ? a : null;
  }
  return null;
}
window.mapBboxArray = mapBboxArray;
function mapRegionsForBbox(bbox) {
  bbox = mapBboxArray(bbox);
  if (!bbox) return [];
  const cx = (Number(bbox[0]) + Number(bbox[2])) / 2, cy = (Number(bbox[1]) + Number(bbox[3])) / 2;
  if (!isFinite(cx) || !isFinite(cy)) return [];
  const hits = mapCatalog().regions.filter(r => r.bbox[0] <= cx && cx <= r.bbox[2] && r.bbox[1] <= cy && cy <= r.bbox[3]);
  hits.sort((a, b) => ((a.bbox[2]-a.bbox[0])*(a.bbox[3]-a.bbox[1])) - ((b.bbox[2]-b.bbox[0])*(b.bbox[3]-b.bbox[1])));
  return hits;
}
function mapRegionForBbox(bbox) { const h = mapRegionsForBbox(bbox); return h.length ? h[0] : null; }
/** Stapel (Spiegel von mapstyles.region_stack): in Deutschland alle Bundesländer
 *  um den Mittelpunkt, kleinste Fläche oben — die Dienste liefern außerhalb
 *  ihrer Grenzen durchsichtige PNGs. Sonst nur die eine Region. */
function mapRegionStack(bbox) {
  const h = mapRegionsForBbox(bbox);
  if (!h.length) return [];
  if (h[0].country === "DE") return h.filter(r => r.country === "DE").slice(0, 4);
  return [h[0]];
}
function _stackAttribution(stack) {
  const out = [];
  stack.forEach((r, i) => { let a = r.attribution || ""; if (i && a.startsWith("Luftbild: ")) a = a.slice(10); if (a && !out.includes(a)) out.push(a); });
  return out.join(" | ");
}
function _stackStyle(stack) {
  const transparent = stack.length > 1;
  const sources = {}, layers = [];
  const proxy = (mapCatalog().proxy_base || "").replace(/\/$/, "");
  // Untergrund (NASA Blue Marble) ganz unten: Meer, Ferne, Lücken der Landesdienste.
  const base = mapCatalog().base_layer;
  if (base && base.tiles) {
    sources["rz-base"] = { type: "raster", tiles: base.tiles.slice(), tileSize: base.tileSize || 256, maxzoom: base.maxzoom || 8, attribution: base.attribution || "" };
    layers.push({ id: "rz-base", type: "raster", source: "rz-base", minzoom: 0 });
  }
  const orthoMin = mapCatalog().ortho_minzoom || 7;
  for (const r of stack.slice().reverse()) {
    const sid = transparent ? "rz-raster-" + r.id : "rz-raster";
    // Über die lokale Kachel-Weiche (CORS + Zwischenspeicher), wenn die App sie anbietet.
    const tiles = proxy ? [proxy + "/tile/" + r.id + "/{z}/{x}/{y}" + (transparent ? "?t=1" : "")]
                        : (transparent ? (r.tiles_transparent || r.tiles) : r.tiles);
    const src = { type: "raster", tiles, tileSize: 256, minzoom: r.minzoom || orthoMin, maxzoom: r.maxzoom || 19, attribution: r.attribution || "" };
    if (r.scheme === "tms" && !proxy) src.scheme = "tms";
    sources[sid] = src; layers.push({ id: sid, type: "raster", source: sid, minzoom: 0 });
  }
  return { version: 8, sources, layers };
}

function _rasterStyle(tiles, tileSize, maxzoom, attribution, scheme) {
  const src = { type: "raster", tiles: tiles, tileSize: tileSize || 256, maxzoom: maxzoom || 19, attribution: attribution || "" };
  if (scheme === "tms") src.scheme = "tms";
  // KEIN Layer-maxzoom: über der letzten Kachelstufe wird hochskaliert, nicht schwarz.
  return { version: 8, sources: { "rz-raster": src }, layers: [{ id: "rz-raster", type: "raster", source: "rz-raster", minzoom: 0 }] };
}

function _terrainSource(name, maptilerKey) {
  const tdef = mapCatalog().terrain[name];
  if (!tdef) return null;
  const src = { type: "raster-dem", tileSize: tdef.tileSize, maxzoom: tdef.maxzoom };
  if (tdef.url) src.url = tdef.url;
  if (tdef.tiles) src.tiles = tdef.tiles.map(u => u.replace("{maptiler_key}", maptilerKey || ""));
  if (tdef.encoding) src.encoding = tdef.encoding;
  if (tdef.attribution) src.attribution = tdef.attribution;
  return src;
}

/**
 * Stil auflösen — Spiegel von core/mapstyles.resolve().
 * Liefert { key, requested, engine, style, terrain, attribution, region, notes[], badge, videoOk }.
 * `notes` sind Codes: no_mapbox_token | no_maptiler_key | no_coverage | unknown_style
 */
function resolveMapStyle(styleKey, bbox, wantTerrain) {
  const cat = mapCatalog();
  const keys = cat.key_values || { mapbox: window._RZGPS_MAPBOX_TOKEN || "", maptiler: "" };
  const notes = [];
  let key = mapStyleKnown(styleKey) ? styleKey : mapDefaultStyle();
  if (key !== styleKey) notes.push("unknown_style");
  let d = mapStyleDef(key);
  const tok = (keys.mapbox || "").trim(), mt = (keys.maptiler || "").trim();
  if (d.provider === "mapbox" && !(tok.startsWith("pk.") && tok.length > 20)) { notes.push("no_mapbox_token"); key = "free_satellite"; d = mapStyleDef(key) || d; }
  if (d.provider === "maptiler" && !mt) { notes.push("no_maptiler_key"); key = "free_satellite"; d = mapStyleDef(key) || d; }
  let region = null, stack = [];
  if (d.kind === "gov") {
    stack = mapRegionStack(bbox);
    region = stack.length ? stack[0] : null;
    if (!region) {
      if (mapBboxArray(bbox)) notes.push("no_coverage");
      key = mapStyleKnown("ofm_liberty") ? "ofm_liberty" : "osm"; d = mapStyleDef(key);
    }
  }
  let style;
  if (d.kind === "gov") style = _stackStyle(stack);
  else if (d.kind === "raster") style = _rasterStyle(d.tiles, d.tileSize, d.maxzoom, d.attribution);
  else style = String(d.style_url || "").replace("{maptiler_key}", mt);
  const engine = d.provider === "mapbox" ? "mapbox" : "maplibre";
  const terrain = (wantTerrain !== false) ? _terrainSource(d.terrain, mt) : null;
  const tdef = cat.terrain[d.terrain] || {};
  return { key, requested: styleKey, engine, style, terrain, attribution: (terrain && tdef.attribution) || "",
           region: region ? { id: region.id, name: stack.map(r => r.name).join("/"), ids: stack.map(r => r.id) } : null, notes,
           badge: d.badge, videoOk: d.badge !== "video_rights", provider: d.provider, kind: d.kind };
}

/** Lesbarer Vermerk zu einer Auflösung (leer, wenn nichts zu sagen ist). */
function mapStyleNoteText(spec) {
  if (!spec) return "";
  const parts = [];
  for (const n of spec.notes || []) {
    if (n === "no_mapbox_token") parts.push(t("mapstyle.note.no_mapbox_token", "Kein Mapbox-Token — Satellit (kostenlos) wird verwendet."));
    else if (n === "no_maptiler_key") parts.push(t("mapstyle.note.no_maptiler_key", "Kein MapTiler-Schlüssel — Satellit (kostenlos) wird verwendet."));
    else if (n === "no_coverage") parts.push(t("mapstyle.note.no_coverage", "Satellit für diesen Track nicht verfügbar — Karte (OpenFreeMap) wird verwendet."));
  }
  if (spec.region) parts.push(t("mapstyle.note.region", "Luftbild: {name}").replace("{name}", spec.region.name));
  return parts.join(" ");
}

/** <option>/<optgroup>-HTML der gemeinsamen Stilliste. opts.extraTop = HTML vor allem anderen. */
function mapStyleOptionsHtml(currentKey, opts) {
  opts = opts || {};
  const cat = mapCatalog();
  const groups = cat.group_order || ["free", "maptiler", "mapbox"];
  const gLabel = { free: t("mapstyle.group.free", "Kostenlos · Video erlaubt"),
                   maptiler: t("mapstyle.group.maptiler", "MapTiler · eigener Schlüssel"),
                   mapbox: t("mapstyle.group.mapbox", "Mapbox · Video nur mit gekauften Rechten") };
  let html = opts.extraTop || "";
  for (const g of groups) {
    const items = cat.styles.filter(s => s.group === g);
    if (!items.length) continue;
    html += `<optgroup label="${gLabel[g] || g}">`;
    for (const s of items) {
      const sel = (s.key === currentKey) ? " selected" : "";
      const miss = s.available ? "" : " · " + t("mapstyle.missing_key", "Schlüssel fehlt");
      html += `<option value="${s.key}"${sel}>${mapStyleLabel(s.key)} · ${mapStyleBadgeText(s.key)}${miss}</option>`;
    }
    html += `</optgroup>`;
  }
  if (opts.extraBottom) html += opts.extraBottom;
  return html;
}

// Bis 03.09.2026 die einzige tokenfreie Karte; Leaflet-Module (Web-Karte,
// Tour-Map-HTML) und alte Tests lesen die Liste noch. Sie wird nach dem
// Katalog-Laden um `free_satellite` ergänzt (`_syncOsmTileStyles`).
const OSM_STYLE = _rasterStyle([OSM_TILE_URL], 256, 19, '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>');
const RZ_OSM_TILE_STYLES = {
  osm:          { label: "OpenStreetMap", url: OSM_TILE_URL, sub: [], max: 19, attr: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' },
  topo:         { label: "OpenTopoMap",   url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",              sub: ["a","b","c"],    max: 17, attr: 'Kartendaten: © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende, SRTM | © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)' },
  cyclosm:      { label: "CyclOSM",       url: "https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png", sub: ["a","b","c"], max: 20, attr: '© <a href="https://www.cyclosm.org/">CyclOSM</a> | © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' },
  humanitarian: { label: "Humanitarian",  url: "https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",         sub: ["a","b","c"],    max: 20, attr: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> | Tiles: <a href="https://www.hotosm.org/">HOT</a>' },
};
function _syncOsmTileStyles() {
  RZ_OSM_TILE_STYLES.free_satellite = { label: t("mapstyle.free_satellite", "Satellit (kostenlos, Land wählt sich selbst)"), url: "", sub: [], max: 19, attr: "", gov: true };
}
/** Leaflet-Kachelebene für einen Stil der Web-Exporte; `bbox` = [lon_min, lat_min, lon_max, lat_max]. */
function rzLeafletTileLayer(styleId, bbox) {
  if (styleId === "free_satellite") {
    const stack = mapRegionStack(bbox);
    if (stack.length) {
      const transparent = stack.length > 1;
      const attr = _stackAttribution(stack);
      const orthoMin = mapCatalog().ortho_minzoom || 7;
      const mk = (r, a) => {
        const lf = (transparent && r.leaflet_transparent) ? r.leaflet_transparent : r.leaflet;
        const o = { maxZoom: 22, maxNativeZoom: lf.max || 19, minZoom: orthoMin, attribution: a };
        if (lf.wms) return L.tileLayer.wms(lf.wms.base, Object.assign(o, { layers: lf.wms.layers, format: lf.wms.format || "image/jpeg", version: "1.3.0", transparent: !!lf.wms.transparent }));
        return L.tileLayer(lf.url, Object.assign(o, { tms: !!lf.tms }));
      };
      const base = mapCatalog().base_layer;
      const layers = [];
      if (base && base.tiles) layers.push(L.tileLayer(base.tiles[0], { maxZoom: 22, maxNativeZoom: base.maxzoom || 8, attribution: base.attribution || "" }));
      const rev = stack.slice().reverse();          // groß → klein = unten → oben
      rev.forEach((r, i) => layers.push(mk(r, i === rev.length - 1 ? attr : "")));
      return L.layerGroup(layers);
    }
    styleId = "osm";
  }
  const s = RZ_OSM_TILE_STYLES[styleId] || RZ_OSM_TILE_STYLES.osm;
  const urls = (s.sub && s.sub.length) ? s.sub.map((d) => s.url.replace("{s}", d)) : [s.url];
  return L.tileLayer(urls[0], { maxZoom: s.max || 19, subdomains: (s.sub || []).join(""), attribution: s.attr || "" });
}
/** GL-Style-8-Objekt (raster) für einen OSM-Stil — beide Engines rendern das. */
function osmRasterStyle(id) {
  const s = RZ_OSM_TILE_STYLES[id] || RZ_OSM_TILE_STYLES.osm;
  const urls = (s.sub && s.sub.length) ? s.sub.map((d) => s.url.replace("{s}", d)) : [s.url];
  return _rasterStyle(urls, 256, s.max, s.attr);
}
/** True, wenn `key` ein OSM-Raster-Stil aus RZ_OSM_TILE_STYLES ist (ohne free_satellite). */
function isOsmStyleKey(key) { return !!(key && key !== "free_satellite" && Object.prototype.hasOwnProperty.call(RZ_OSM_TILE_STYLES, key)); }
window.RZ_OSM_TILE_STYLES = RZ_OSM_TILE_STYLES;
window.osmRasterStyle = osmRasterStyle;
window.isOsmStyleKey = isOsmStyleKey;
window.rzLeafletTileLayer = rzLeafletTileLayer;
window.resolveMapStyle = resolveMapStyle;
window.mapStyleOptionsHtml = mapStyleOptionsHtml;
window.mapStyleNoteText = mapStyleNoteText;
window.mapStyleVideoOk = mapStyleVideoOk;
window.mapStyleLabel = mapStyleLabel;
window.mapDefaultStyle = mapDefaultStyle;
window.mapCatalog = mapCatalog;
window.mapRegionForBbox = mapRegionForBbox;
window.mapRegionStack = mapRegionStack;

/** Engine der zuletzt gebauten Karte: "mapbox" | "osm" (= MapLibre). Historischer Name. */
let _mapMode = null;

/** Die GL-Bibliothek der zuletzt gebauten Karte (Marker/Popup-Konstruktoren). */
function mapLib() {
  return _mapMode === "osm" ? maplibregl : mapboxgl;
}
function getMapMode() { return _mapMode; }
function isOsmMode() { return _mapMode === "osm"; }
function isMapboxMode() { return _mapMode === "mapbox"; }

/**
 * Bis 03.09.2026 deckte das die Karten-Render-Module ohne Token ab. Seit der
 * Anbieterauswahl läuft alles auch ohne Token (kostenlose Stile) — die Sperre
 * ist Geschichte. Bleibt als No-op, damit alte Aufrufer nicht stolpern.
 */
function osmBlockOverlay(_targetEl) { return false; }
window.osmBlockOverlay = osmBlockOverlay;

/**
 * Erzeugt eine Karte passend zum Stil.
 *   opts.container, opts.common (Map-Optionen), opts.styleKey (bevorzugt),
 *   opts.mapboxStyle (alt: Mapbox-URL → Schlüssel), opts.bbox (Track-Rechteck für
 *   „Satellit (kostenlos)"), opts.terrain (true = Gelände des Stils gleich anhängen).
 * Returns: { map, engine: "mapbox"|"maplibre", lib, spec, styleKey }
 */
function createMap(opts) {
  let key = opts.styleKey || (opts.mapboxStyle && _mapKeyFromMapboxUrl(opts.mapboxStyle)) || mapDefaultStyle();
  // Gelände IMMER mit auflösen (spec.terrain) — `opts.terrain` sagt nur, ob es
  // hier gleich angehängt wird; der Animator hängt es selbst an (applyTerrain).
  const spec = resolveMapStyle(key, opts.bbox || null, true);
  let map, lib;
  if (spec.engine === "mapbox") {
    _mapMode = "mapbox";
    const token = (mapCatalog().key_values || {}).mapbox || window._RZGPS_MAPBOX_TOKEN || "";
    mapboxgl.accessToken = token;
    lib = mapboxgl;
    // v0.9.246/274: maxZoom 18 — sonst zoomt man ins Daten-Nichts (schwarz).
    map = new mapboxgl.Map(Object.assign({ container: opts.container, style: spec.style, maxZoom: 18 }, opts.common || {}));
  } else {
    _mapMode = "osm";
    lib = maplibregl;
    map = new maplibregl.Map(Object.assign({ container: opts.container, style: spec.style, maxZoom: 20 }, opts.common || {}));
  }
  map.__rzEngine = spec.engine;
  map.__rzSpec = spec;
  map.__rzStyleKey = spec.key;
  // „Stil fertig" im Mapbox-Sinn (Style-JSON geladen). MapLibres isStyleLoaded()
  // meldet erst true, wenn auch alle Kacheln da sind — bei Raster + Gelände in
  // Bewegung also fast nie; Warteschleifen im Animator drehten sich dann endlos.
  map.__rzStyleReady = false;
  try { map.on("style.load", () => { map.__rzStyleReady = true; }); } catch (_) {}
  if (opts.terrain === true) rzApplyMapTerrain(map, spec, opts.exaggeration);
  // 02.09.2026 — Prüfstand-Haken: die zuletzt gebaute Karte nach außen geben,
  // damit headless (Playwright) Kamera-Zustände auslesbar sind.
  try { window.__rzLetzteKarte = map; } catch (_) {}
  try { applog && applog("info", `[map] ${opts.container}: Stil ${spec.key} (gewünscht ${key}) · ${spec.engine}` + (spec.region ? ` · ${spec.region.name}` : "") + (spec.notes.length ? ` · ${spec.notes.join(",")}` : "")); } catch (_) {}
  return { map, engine: spec.engine, lib, spec, styleKey: spec.key };
}

/** Gelände des Stils an die Karte hängen (Quellname 'mapbox-dem' — historisch). */
function rzApplyMapTerrain(map, spec, exaggeration) {
  if (!map || !spec || !spec.terrain) return;
  const run = () => {
    try {
      // Nie mitten in einer Kamerafahrt (MapLibre: „reading 'wrap'"-Absturz).
      if (map.isMoving && map.isMoving()) { map.once("moveend", () => setTimeout(run, 30)); return; }
      if (!map.getSource("mapbox-dem")) map.addSource("mapbox-dem", spec.terrain);
      map.setTerrain({ source: "mapbox-dem", exaggeration: (exaggeration != null ? exaggeration : 1.0) });
    } catch (e) { try { applog("warn", "[map] Gelände: " + e); } catch (_) {} }
  };
  if (map.isStyleLoaded && map.isStyleLoaded()) run(); else map.once("style.load", run);
}
window.rzApplyMapTerrain = rzApplyMapTerrain;
/** Style-JSON geladen? (Mapbox-Semantik; s. createMap.) Für Guards vor addSource/addLayer. */
function rzStyleReady(map) {
  if (!map) return false;
  if (map.__rzStyleReady === true) return true;
  if (map.__rzStyleReady === false) return false;   // wird gerade gewechselt
  try { return !map.isStyleLoaded || map.isStyleLoaded(); } catch (_) { return false; }
}
window.rzStyleReady = rzStyleReady;

/**
 * Stil auf eine bestehende Karte anwenden. Bleibt die Engine gleich → setStyle;
 * sonst { needsRemount: true } — der Aufrufer speichert den Stil und ruft
 * `window.remountActiveModule()`.
 */
function applyMapStyle(map, styleKey, bbox, opts) {
  opts = opts || {};
  const spec = resolveMapStyle(styleKey, bbox || null, true);
  if (!map) return { needsRemount: true, spec };
  if (map.__rzEngine && spec.engine !== map.__rzEngine) return { needsRemount: true, spec };
  map.__rzSpec = spec; map.__rzStyleKey = spec.key;
  // MapLibre stolpert, wenn beim Stilwechsel noch Gelände aktiv ist (die
  // DEM-Quelle verschwindet unter dem Gelände weg → „_checkLoaded of undefined",
  // und das Gelände kam danach nie zurück). Erst abhängen, dann wechseln; der
  // Aufrufer hängt es nach `style.load` wieder an.
  // Laufende Kamerafahrt (fitBounds nach dem Track-Laden) erst anhalten: ein
  // setStyle mitten in der Fahrt ließ MapLibre in „Attempting to run(), but is
  // already running" hängen — die Karte war danach tot.
  try { if (map.stop) map.stop(); } catch (_) {}
  try { if (map.getTerrain && map.getTerrain()) map.setTerrain(null); } catch (_) {}
  map.__rzStyleReady = false;
  try { map.setStyle(spec.style, { diff: false }); } catch (e) { try { applog("warn", "[map] setStyle: " + e); } catch (_) {} }
  if (opts.terrain === true) rzApplyMapTerrain(map, spec, opts.exaggeration);
  return { needsRemount: false, spec };
}
window.applyMapStyle = applyMapStyle;

/**
 * Kleiner Stil-Schalter über der Karte (Geotagger, Inspektor, Archiv).
 *   o.section — Einstellungs-Abschnitt (Modul-Slug), o.getMap(), o.getBbox(),
 *   o.onApplied(spec) — nach setStyle (Layer neu aufbauen).
 */
function attachMapStyleControl(containerEl, o) {
  if (!containerEl) return null;
  const section = o.section;
  const cur = ((_settingsCache && _settingsCache[section] && _settingsCache[section].map_style) || mapDefaultStyle());
  const wrap = document.createElement("div");
  wrap.className = "rz-style-ctrl";
  wrap.innerHTML = `<select title="${t("animator.field.style", "Karten-Stil")}">${mapStyleOptionsHtml(cur)}</select><div class="rz-style-note muted"></div>`;
  containerEl.appendChild(wrap);
  const sel = wrap.querySelector("select"), note = wrap.querySelector(".rz-style-note");
  const showNote = (spec) => { const txt = mapStyleNoteText(spec); note.textContent = txt; note.hidden = !txt; };
  try { const m = o.getMap && o.getMap(); if (m && m.__rzSpec) showNote(m.__rzSpec); } catch (_) {}
  sel.addEventListener("change", () => {
    const v = sel.value;
    const patch = {}; patch[section] = { map_style: v };
    saveSettings(patch, { immediate: true });
    // Ein Stilwechsel wirft alle Quellen/Ebenen weg — statt jedes Modul seine
    // Ebenen nachbauen zu lassen, wird das Modul neu aufgebaut (dauert einen
    // Wimpernschlag und deckt auch den Engine-Wechsel Mapbox ↔ MapLibre ab).
    if (window.remountActiveModule) window.remountActiveModule();
  });
  return { el: wrap, refresh: (spec) => showNote(spec) };
}
window.attachMapStyleControl = attachMapStyleControl;

/** Katalog + Schlüssel vom Backend holen, damit die Kartenfabrik ohne async läuft. */
async function initMapToken() {
  try {
    const cat = await api().map_catalog();
    if (cat && cat.styles) window.RZ_MAP_CATALOG = cat;
    const tok = (cat && cat.key_values && cat.key_values.mapbox) || "";
    window._RZGPS_MAPBOX_TOKEN = tok;
    _mapMode = (tok && tok.startsWith("pk.")) ? "mapbox" : "osm";
  } catch (_) {
    try { const tok = await api().get_mapbox_token(); window._RZGPS_MAPBOX_TOKEN = tok || ""; } catch (__) { window._RZGPS_MAPBOX_TOKEN = ""; }
    _mapMode = (window._RZGPS_MAPBOX_TOKEN.startsWith("pk.")) ? "mapbox" : "osm";
  }
  try { _syncOsmTileStyles(); } catch (_) {}
}

// ── Modal-System ────────────────────────────────────────────────────────────

/**
 * Öffnet das globale Modal. Wenn schon offen, wird's einfach gefüllt.
 * options: { title, body (HTML), footer (HTML), closable (default true),
 *            onClose: () => void }
 *
 * Liefert ein Update-Objekt zurück mit `.update({title, body, footer})`
 * und `.close()`.
 */
/* Ein Dialog über dem anderen — mit Rückweg.
 *
 * Es gibt genau EIN Overlay im HTML. Bisher überschrieb jeder neue Dialog
 * dessen Inhalt, und beim Schließen war alles zu. Das traf einen ganz normalen
 * Weg: Einstellungen öffnen → Sprache und Qualität ändern → „Wie bekomme ich
 * einen Token?" anklicken → lesen → „OK" — und der **komplette
 * Einstellungsdialog war weg**, alle Änderungen verloren, ohne jede Meldung.
 * Ebenso über das Hilfe-Menü und den Über-Dialog.
 *
 * Jetzt merkt sich `_modalStack`, was vorher zu sehen war. Schließt der obere
 * Dialog, kommt der darunter zurück. Wer dabei seine Knöpfe wieder verdrahten
 * muss, gibt beim Öffnen des oberen Dialogs `restorePrevious` mit.
 */
const _modalStack = [];

function openModal(options = {}) {
  const overlay = document.getElementById("modal-overlay");
  const titleEl = document.getElementById("modal-title");
  const bodyEl  = document.getElementById("modal-body");
  const footEl  = document.getElementById("modal-footer");
  const closeEl = document.getElementById("modal-close");

  // `openModal({})` ist im ganzen Code das etablierte Idiom für „mach den
  // aktuellen Dialog zu" — es steht an 43 Stellen hinter OK- und
  // Abbrechen-Knöpfen. Ein Aufruf OHNE Inhalt ist also kein neuer Dialog und
  // darf nichts stapeln: Sonst legt er den offenen Dialog beiseite, und das
  // folgende `.close()` holt ihn sofort wieder hervor — das Fenster bleibt
  // offen, der Knopf wirkt tot. Genau so gemeldet („Über Reisezoom GPS Studio
  // hat der OK Button keine Funktion"), und es traf JEDEN dieser Knöpfe.
  const _hatInhalt = options.title !== undefined || options.body !== undefined
    || options.footer !== undefined;

  // Steht schon ein Dialog offen? Dann beiseitelegen statt überschreiben.
  if (!overlay.hidden && _hatInhalt) {
    // Was der Nutzer eingetippt oder angehakt hat, steht NUR in der
    // Eigenschaft, nicht im Markup — `innerHTML` würde es verlieren. Also
    // vorher ins Attribut spiegeln. Ohne das käme der Einstellungsdialog zwar
    // zurück, aber mit den Werten von vor der Bearbeitung: derselbe Verlust,
    // nur unauffälliger.
    try {
      bodyEl.querySelectorAll("input, textarea, select").forEach(el => {
        if (el.type === "checkbox" || el.type === "radio") {
          if (el.checked) el.setAttribute("checked", "");
          else el.removeAttribute("checked");
        } else if (el.tagName === "SELECT") {
          Array.from(el.options).forEach(o => {
            if (o.selected) o.setAttribute("selected", "");
            else o.removeAttribute("selected");
          });
        } else if (el.tagName === "TEXTAREA") {
          el.textContent = el.value;
        } else {
          el.setAttribute("value", el.value);
        }
      });
    } catch (e) { console.warn("Modal-Zustand sichern:", e); }

    _modalStack.push({
      title: titleEl.textContent,
      body: bodyEl.innerHTML,
      footer: footEl.innerHTML,
      closable: closeEl.style.visibility !== "hidden",
      restore: typeof options.restorePrevious === "function"
        ? options.restorePrevious : null,
    });
  }

  let onClose = options.onClose;
  let closable = options.closable !== false;

  function render(opts) {
    if (opts.title !== undefined) titleEl.textContent = opts.title;
    if (opts.body  !== undefined) bodyEl.innerHTML = opts.body;
    if (opts.footer !== undefined) footEl.innerHTML = opts.footer;
    if (opts.closable !== undefined) {
      closable = opts.closable;
      closeEl.style.visibility = closable ? "" : "hidden";
    }
    if (opts.onClose !== undefined) onClose = opts.onClose;
  }

  render(options);
  // 02.09.2026, beim Durchtesten gefunden: Ein neuer Dialog, der seine Knöpfe
  // im Rumpf mitbringt (z. B. „Ordner & Einlesen"), ließ die Fußzeile des
  // VORIGEN Dialogs stehen. Nach einem abgebrochenen Löschdialog stand
  // darunter plötzlich ein roter „Tour und diese Projekte löschen" — in einem
  // Fenster, das damit nichts zu tun hat.
  //
  // Nur beim ÖFFNEN leeren, nicht bei `update()`: Dort wird oft nur der Rumpf
  // erneuert, und die Fußzeile soll stehen bleiben.
  if (_hatInhalt && options.footer === undefined) footEl.innerHTML = "";
  overlay.hidden = false;

  function close() {
    const darunter = _modalStack.pop();
    if (darunter) {
      // Den vorherigen Dialog zurückholen statt alles zuzumachen.
      titleEl.textContent = darunter.title;
      bodyEl.innerHTML = darunter.body;
      footEl.innerHTML = darunter.footer;
      closeEl.style.visibility = darunter.closable ? "" : "hidden";
      closable = darunter.closable;
      overlay.hidden = false;
      if (typeof onClose === "function") {
        const fn = onClose; onClose = null;
        fn();
      }
      // Der Inhalt allein nützt nichts, wenn danach kein Knopf mehr reagiert:
      // `innerHTML` bringt die Ereignis-Handler nicht zurück.
      if (typeof darunter.restore === "function") {
        try { darunter.restore(); } catch (e) { console.warn("Modal-Restore:", e); }
      }
      return;
    }
    overlay.hidden = true;
    bodyEl.innerHTML = "";
    footEl.innerHTML = "";
    closeEl.style.visibility = "";
    closeEl.onclick = null;
    overlay.onclick = null;
    if (typeof onClose === "function") {
      const fn = onClose; onClose = null;
      fn();
    }
  }

  closeEl.onclick = () => { if (closable) close(); };
  overlay.onclick = (e) => { if (e.target === overlay && closable) close(); };

  return { update: render, close };
}

/** Alles zumachen — auch die darunterliegenden Dialoge. Für Abläufe, die
 *  wirklich beim Nullpunkt landen sollen.
 *
 *  Nicht über `openModal({}).close()`: Solange ein Dialog offen ist, legt
 *  `openModal` den aktuellen Zustand auf den Stapel — und `close()` holte ihn
 *  sofort wieder hervor. Das Fenster blieb offen. Also direkt aufräumen. */
function closeAllModals() {
  _modalStack.length = 0;
  const overlay = document.getElementById("modal-overlay");
  if (!overlay) return;
  const bodyEl = document.getElementById("modal-body");
  const footEl = document.getElementById("modal-footer");
  const closeEl = document.getElementById("modal-close");
  overlay.hidden = true;
  if (bodyEl) bodyEl.innerHTML = "";
  if (footEl) footEl.innerHTML = "";
  if (closeEl) { closeEl.style.visibility = ""; closeEl.onclick = null; }
  overlay.onclick = null;
}

function toast(msg, type = "info", durationMs = 3200) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "toast " + (type || "info");
  t.hidden = false;
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => { t.hidden = true; }, durationMs);
}

// Wartet auf pywebview-Bereitschaft
function whenApiReady() {
  return new Promise(resolve => {
    if (api()) return resolve();
    window.addEventListener("pywebviewready", () => resolve(), { once: true });
  });
}

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k === "html") e.innerHTML = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "style" && typeof v === "object") Object.assign(e.style, v);
    else e.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    if (typeof c === "string") e.appendChild(document.createTextNode(c));
    else e.appendChild(c);
  }
  return e;
}

function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ── i18n ───────────────────────────────────────────────────────────────────

let _i18nStrings = {};
let _i18nMeta = { active: "en", requested: "auto", system_locale: "en", available: [] };

async function loadI18n() {
  try {
    const res = await api().i18n_get_strings();
    _i18nStrings = res.strings || {};
    _i18nMeta = {
      active: res.active,
      requested: res.requested,
      system_locale: res.system_locale || res.active,
      available: res.available || [],
    };
  } catch (err) {
    console.warn("[i18n] load failed", err);
  }
  uebersetzeMarkup();
  // 31.08.2026 (Beta-Tester: „las pestañas salen en Alemán") — Bausteine, die VOR
  // den Sprachdateien gerendert haben (Topbar-Projekt-Knopf), rendern auf
  // dieses Signal hin neu, statt auf ihrem deutschen Fallback sitzenzubleiben.
  try { window.dispatchEvent(new CustomEvent("rz-i18n-ready")); } catch (_) {}
}

/** Übersetzt festes HTML anhand von `data-i18n`-Attributen.
 *
 * Warum es das gibt (28.08.2026): In `index.html` stehen ein paar
 * Beschriftungen fest im Markup, weil die Seite lädt, bevor die Sprachdateien
 * da sind — „Datei neu wählen", der Titel des Schließen-Knopfs. Die blieben
 * IMMER deutsch, auch in der spanischen Oberfläche; einem Beta-Tester fiel
 * genau das auf. Einzelne Zuweisungen in JS wären dieselbe Falle für die
 * nächste Beschriftung, deshalb ein allgemeiner Weg:
 *
 *   <button data-i18n="gpxbar.pick_again">Datei neu wählen</button>
 *   <button data-i18n-title="common.close" title="Schließen">✕</button>
 *
 * Der deutsche Text im HTML bleibt als Rückfall stehen — fehlt der Schlüssel
 * oder scheitert das Laden, steht dort weiterhin etwas Lesbares.
 */
function uebersetzeMarkup(wurzel) {
  const w = wurzel || document;
  try {
    w.querySelectorAll("[data-i18n]").forEach(el => {
      const wert = t(el.getAttribute("data-i18n"), el.textContent.trim());
      if (wert) el.textContent = wert;
    });
    w.querySelectorAll("[data-i18n-title]").forEach(el => {
      const wert = t(el.getAttribute("data-i18n-title"), el.getAttribute("title") || "");
      if (wert) el.title = wert;
    });
    w.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
      const wert = t(el.getAttribute("data-i18n-placeholder"), el.getAttribute("placeholder") || "");
      if (wert) el.placeholder = wert;
    });
  } catch (err) {
    console.warn("[i18n] Markup:", err);
  }
}

/**
 * Übersetzungs-Lookup mit `{name}`-Platzhaltern.
 *
 * v0.9.459 — zweites Argument darf jetzt ein **Fallback-Text** sein:
 *   t("some.key", "Deutscher Text")   → zeigt den Text, wenn der Key fehlt
 *   t("some.key", { name: x })        → Platzhalter (Alt-Signatur, unverändert)
 *   t("some.key", "Hallo {name}", { name: x }) → Fallback MIT Platzhaltern
 *
 * Der gesamte Code schrieb schon immer `t("key", "Text")` in der Annahme,
 * das zweite Argument sei ein Fallback — war es aber nie: der Text wurde als
 * (unbenutztes) Platzhalter-Objekt behandelt und bei fehlendem Key stand der
 * rohe Key in der UI. Diese Signatur schaltet ~780 vorhandene Fallbacks
 * scharf, ohne die 11 Platzhalter-Aufrufe zu brechen.
 */
function t(key, fallbackOrParams, maybeParams) {
  const store = _i18nStrings || {};
  const hasKey = Object.prototype.hasOwnProperty.call(store, key)
    && store[key] != null && store[key] !== "";
  let s, params;
  if (typeof fallbackOrParams === "string") {
    s = hasKey ? store[key] : fallbackOrParams;   // 2. Arg = Fallback-Text
    params = maybeParams;                          // 3. Arg (optional) = Platzhalter
  } else {
    s = hasKey ? store[key] : key;
    params = fallbackOrParams;                     // 2. Arg = Platzhalter (Alt-Signatur)
  }
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.split("{" + k + "}").join(String(v));
    }
  }
  return s;
}

function i18nMeta() { return _i18nMeta; }

/**
 * „?"-Erklärblasen (v0.9.501, aus dem GPX-Inspektor herausgelöst).
 *
 * Native `title`-Tooltips sind in einer WebView unzuverlässig — sie erscheinen
 * spät, mal gar nicht, und ihr Aussehen lässt sich nicht steuern. Deshalb ein
 * eigenes Popup mit `position: fixed`, das auch aus einem scrollbaren Panel
 * herausragen darf.
 *
 * Aufruf einmal je Modul-Mount mit dem Wurzelelement. Alles mit der Klasse
 * `rz-q` (oder `gpxi-q`, historisch) und einem `data-tip` bekommt die Blase.
 * Klick schaltet um, damit es auch ohne Maus (Touch) erreichbar bleibt.
 */
function initHelpTips(scope) {
  if (!scope) return;
  let tip = document.getElementById("rz-tip");
  if (!tip) {
    tip = document.createElement("div");
    tip.id = "rz-tip";
    tip.className = "rz-tip";
    document.body.appendChild(tip);
  }
  const treffer = (e) => e.target.closest && e.target.closest(".rz-q, .gpxi-q");
  function show(el) {
    const txt = el.getAttribute("data-tip");
    if (!txt) return;
    tip.textContent = txt;
    tip.style.display = "block";
    const r = el.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = r.left + r.width / 2 - tw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
    let top = r.top - th - 8;
    if (top < 8) top = r.bottom + 8;   // oben kein Platz → drunter
    tip.style.left = left + "px";
    tip.style.top = top + "px";
  }
  const hide = () => { tip.style.display = "none"; };
  scope.addEventListener("mouseover", (e) => { const q = treffer(e); if (q) show(q); });
  scope.addEventListener("mouseout", (e) => { if (treffer(e)) hide(); });
  scope.addEventListener("click", (e) => {
    const q = treffer(e);
    if (q) { e.preventDefault(); tip.style.display === "block" ? hide() : show(q); }
  });
}

/** Ein „?"-Symbol mit Erklärblase. `text` wird als Attribut gesetzt, also escapen. */
function helpTip(text) {
  const sicher = String(text).replace(/&/g, "&amp;").replace(/"/g, "&quot;")
    .replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<span class="rz-q" data-tip="${sicher}" role="button" tabindex="0">?</span>`;
}

/**
 * Zahl aus Nutzereingabe robust parsen (v0.9.459).
 *
 * Deutsche Tastaturen tippen das Dezimalkomma: `parseFloat("2,5")` liefert in
 * JS aber **2** (es stoppt am Komma) — der Nutzer wollte 2,5 und bekam
 * kommentarlos 2. `<input type="number">` filtert je nach macOS-Locale das
 * Komma unterschiedlich, deshalb kann es bis hierher durchrutschen. Wir
 * ersetzen das erste Komma durch einen Punkt und fallen bei Unparsbarem auf
 * `fallback` zurück (statt NaN, das sich stumm weiterfrisst).
 */
function parseNum(value, fallback = 0) {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (value == null) return fallback;
  // Nur das ERSTE Komma ist Dezimaltrenner; Tausenderpunkte gibt es in den
  // Feldern nicht (kleine Zahlen wie 2,5 / 45 / 1920).
  const n = parseFloat(String(value).trim().replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Öffnet das Bug-Report-Modal: zeigt Marc's Mail-Adresse + Subject + Body
 * mit Copy-Buttons. User kopiert was er braucht und fügt's in sein
 * Webmail/Mail-Programm ein. Für User die ein lokales Mail-Programm haben
 * gibt's zusätzlich einen Button der `mailto:` öffnet.
 *
 * @param {string} context - Optional, z.B. Crash-Kurzfehler
 */
async function openBugReportModal(context = "") {
  const r = await api().prepare_bug_report(context || "");
  if (!r || !r.ok) {
    toast(t("error.bugreport", "Bug-Report konnte nicht vorbereitet werden"), "error", 4000);
    return;
  }
  const escapeHtml = (s) => String(s ?? "").replace(/[&<>]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));

  openModal({
    title: t("bugreport.title"),
    body: `
      <p class="muted" style="margin:0 0 12px 0; font-size:12px; line-height:1.5;">
        ${t("bugreport.intro")}
      </p>

      <div style="display:flex; gap:8px; align-items:center; margin-bottom:8px;">
        <div style="flex:1; min-width:0;">
          <div style="font-size:11px; color:var(--text-muted); letter-spacing:0.5px; text-transform:uppercase;">${t("bugreport.label.to")}</div>
          <div style="font-family:ui-monospace,Menlo,monospace; font-size:13px; color:var(--accent); word-break:break-all;" id="br-to">${escapeHtml(r.to)}</div>
        </div>
        <button class="btn" data-copy="br-to">📋 ${t("bugreport.copy")}</button>
      </div>

      <div style="display:flex; gap:8px; align-items:center; margin-bottom:8px;">
        <div style="flex:1; min-width:0;">
          <div style="font-size:11px; color:var(--text-muted); letter-spacing:0.5px; text-transform:uppercase;">${t("bugreport.label.subject")}</div>
          <div style="font-size:13px; word-break:break-word;" id="br-subject">${escapeHtml(r.subject)}</div>
        </div>
        <button class="btn" data-copy="br-subject">📋 ${t("bugreport.copy")}</button>
      </div>

      <div style="margin-bottom:8px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <div style="font-size:11px; color:var(--text-muted); letter-spacing:0.5px; text-transform:uppercase;">${t("bugreport.label.body")}</div>
          <button class="btn" data-copy="br-body" style="padding:2px 8px; font-size:11px;">📋 ${t("bugreport.copy")}</button>
        </div>
        <textarea id="br-body" readonly
          style="width:100%; height:240px; padding:10px 12px; background:#0a0a0a;
                 border:1px solid var(--border); border-radius:6px;
                 font-family:ui-monospace,Menlo,monospace; font-size:11px;
                 line-height:1.5; color:var(--text-dim); resize:vertical;"
        >${escapeHtml(r.body)}</textarea>
      </div>

      <div style="margin-top:14px; padding:12px 14px; background:rgba(255,138,0,0.08);
                  border:1px solid var(--accent); border-radius:8px;">
        <div style="font-size:12px; line-height:1.5; margin-bottom:10px;">
          ${t("bugreport.dau.hint")}
        </div>
        <!-- 25.08.2026 (Beta-Tester): „¿cuándo tengo que generarlo?“ — er hielt
             das Protokoll für etwas, das nur bei einer Fehlermeldung entsteht,
             und schickte es deshalb NICHT, obwohl genau sein Fall drinstand.
             Der Fenstertitel („informe de errores“) legt das auch nahe. -->
        <div style="font-size:12px; line-height:1.5; margin-bottom:10px; opacity:.85;">
          ℹ️ ${t("bugreport.immer_mit", "Das Protokoll läuft immer mit — du brauchst keine Fehlermeldung abzuwarten. Schick es einfach, nachdem etwas nicht so lief wie erwartet.")}
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="btn btn-primary" id="br-desktop">📄 ${t("bugreport.btn.desktop")}</button>
          <button class="btn" id="br-copyfull">📋 ${t("bugreport.btn.copyfull")}</button>
        </div>
      </div>

      <p class="muted" style="margin:14px 0 0 0; font-size:11px; line-height:1.5;">
        ${t("bugreport.hint")}
      </p>
    `,
    footer: `
      <button class="btn btn-left" data-url="${escapeHtml(r.mailto)}" id="md-br-mailto">📧 ${t("bugreport.btn.mailto")}</button>
      <button class="btn btn-primary" id="md-br-ok">${t("common.ok")}</button>
    `,
  });

  // Copy-Buttons: nutzen navigator.clipboard.writeText
  document.querySelectorAll("[data-copy]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-copy");
      const src = document.getElementById(id);
      const text = (src.tagName === "TEXTAREA") ? src.value : src.textContent;
      try {
        await navigator.clipboard.writeText(text);
        // Brief feedback per Button-Text-Wechsel
        const old = btn.innerHTML;
        btn.innerHTML = "✓ " + t("bugreport.copied");
        setTimeout(() => { btn.innerHTML = old; }, 1500);
      } catch (e) {
        toast(t("bugreport.copy_failed"), "error", 3000);
      }
    });
  });

  // Optional mailto-Button — für die User die ein Mail-Programm haben
  document.getElementById("md-br-mailto").onclick = () => {
    api().open_url(r.mailto);
  };

  // v0.9.471 — DAU-sicherer Log-Versand: kompletten Log auf den Schreibtisch
  // legen (Nutzer zieht die Datei in die Mail). Behebt den Fall, dass nur der
  // Log-PFAD statt des Logs verschickt wurde.
  const brDesktop = document.getElementById("br-desktop");
  if (brDesktop) brDesktop.onclick = async () => {
    brDesktop.disabled = true;
    try {
      const res = await api().save_log_to_desktop();
      if (res && res.ok) {
        toast(t("bugreport.desktop_ok").replace("{name}", res.name || "Log.txt"), "success", 6000);
      } else {
        toast((res && res.error) ? res.error : t("bugreport.desktop_fail"), "error", 4000);
      }
    } catch (e) {
      toast(t("bugreport.desktop_fail"), "error", 4000);
    } finally {
      brDesktop.disabled = false;
    }
  };

  // v0.9.471 — kompletten Log (nicht nur 3 KB) in die Zwischenablage.
  const brCopyFull = document.getElementById("br-copyfull");
  if (brCopyFull) brCopyFull.onclick = async () => {
    try {
      const res = await api().get_full_log();
      if (!res || !res.ok || !res.text) { toast(t("bugreport.copy_failed"), "error", 3000); return; }
      await navigator.clipboard.writeText(res.text);
      const old = brCopyFull.innerHTML;
      brCopyFull.innerHTML = "✓ " + t("bugreport.copied");
      setTimeout(() => { brCopyFull.innerHTML = old; }, 1500);
    } catch (e) {
      toast(t("bugreport.copy_failed"), "error", 3000);
    }
  };

  document.getElementById("md-br-ok").onclick = () => openModal({}).close();
}
window.openBugReportModal = openBugReportModal;

/**
 * setupSectionAccordions — generalisiertes Akkordeon-Pattern für Modul-
 * Sidebars (v0.6.0). Findet alle `<section data-accordion-section="<slug>">`
 * unter einem Root-Element und macht ihre Header klickbar:
 *
 * Erwartete HTML-Struktur:
 *   <section class="section" data-accordion-section="map">
 *     <button class="section-collapse-header" aria-expanded="false">
 *       <span>${t(...)}</span><span class="collapse-arrow">▸</span>
 *     </button>
 *     <div class="section-collapse-body" hidden>
 *       ... Inhalt ...
 *     </div>
 *   </section>
 *
 * Persistenz: `settings.json[moduleKey].collapsed_sections` ist ein Array
 * von Slugs, die zugeklappt sind. Beim Klick wird der State sofort
 * gespeichert. Beim ersten App-Start sind ALLE Sektionen zu (Default).
 *
 * Aufruf am Ende des Modul-Mount, nachdem der DOM gerendert ist.
 *
 * @param {string} moduleKey   z.B. "animator", "tourmap"
 * @param {HTMLElement} root   z.B. .panel-Container des Moduls
 */
function setupSectionAccordions(moduleKey, root) {
  const sections = root.querySelectorAll("[data-accordion-section]");
  if (sections.length === 0) return;

  // Aktuellen Collapsed-State aus Settings holen — Array of section slugs.
  // Default: leer (alle Sektionen offen). Bei initialem App-Start setzt
  // app.py die Default-Settings; falls da nichts steht, ist Array undefined
  // → wir interpretieren das als "noch nie konfiguriert" und lassen alles offen.
  const cur = (_settingsCache && _settingsCache[moduleKey]) || {};
  const collapsed = new Set(Array.isArray(cur.collapsed_sections)
    ? cur.collapsed_sections
    : []);

  sections.forEach(section => {
    const slug = section.dataset.accordionSection;
    const header = section.querySelector(".section-collapse-header");
    const body = section.querySelector(".section-collapse-body");
    if (!header || !body) return;

    const isCollapsed = collapsed.has(slug);
    header.setAttribute("aria-expanded", String(!isCollapsed));
    body.hidden = isCollapsed;

    header.addEventListener("click", () => {
      const wasOpen = header.getAttribute("aria-expanded") === "true";
      header.setAttribute("aria-expanded", String(!wasOpen));
      body.hidden = wasOpen;
      // State aktualisieren + persistieren
      if (wasOpen) collapsed.add(slug);
      else collapsed.delete(slug);
      saveSettings({ [moduleKey]: { collapsed_sections: Array.from(collapsed) } });
    });
  });
}
window.setupSectionAccordions = setupSectionAccordions;

/**
 * correctedZoom(map, renderWidth, renderHeight)
 *
 * Rechnet den AKTUELLEN Mapbox-Zoom der Vorschau-Karte auf den Zoom-Wert um,
 * den der Render mit (renderWidth × renderHeight) Pixeln braucht, damit
 * derselbe Geographie-Ausschnitt sichtbar bleibt.
 *
 * Hintergrund (Bug-Report Beta-Tester, v0.6.1):
 *   Mapbox-Zoom ist relativ zur Viewport-Pixel-Breite: bei Zoom z hat die Welt
 *   2^z × 512 Pixel. Eine 800-px-Vorschau bei Zoom 12 zeigt 800/(2^12·512) der
 *   Welt. Wenn wir denselben Zoom 12 auf eine 3840-px-Render-Canvas anwenden,
 *   sehen wir 4,8× mehr Welt → der Track wirkt herausgezoomt.
 *
 *   Korrektur: zoom_render = zoom_preview + log2(renderWidth / previewWidth)
 *   Bei Letterbox-Aspect-Match liefert width oder height denselben Faktor.
 *
 * @param {object} map        Mapbox/MapLibre Map-Instanz
 * @param {number} renderWidth  Ziel-Render-Breite in Pixeln
 * @param {number} renderHeight Ziel-Render-Höhe in Pixeln (für Sanity-Check)
 * @returns {number} Korrigierter Zoom-Wert
 */
function correctedZoom(map, renderWidth, renderHeight) {
  if (!map) return 0;
  const baseZoom = map.getZoom();
  const container = map.getContainer();
  if (!container) return baseZoom;
  const previewW = container.clientWidth || renderWidth;
  const previewH = container.clientHeight || renderHeight;
  if (previewW <= 0 || renderWidth <= 0) return baseZoom;
  // Bei Letterbox-Aspect-Match sind beide Verhältnisse gleich. Bei minimaler
  // Abweichung (durch Rundung beim Letterbox-Resize) nehmen wir den kleineren
  // Faktor — analog zu Mapbox' eigener fitBounds-Logik, die nach der enger
  // begrenzenden Achse skaliert.
  const factorW = renderWidth / previewW;
  const factorH = renderHeight && previewH ? renderHeight / previewH : factorW;
  const factor = Math.min(factorW, factorH);
  return baseZoom + Math.log2(factor);
}
window.correctedZoom = correctedZoom;

/**
 * Generisches Confirm-Modal für „Workspace leeren" — räumt die geladenen
 * Daten (GPX, Fotos) im aktuellen Modul auf, OHNE Settings wie Mapbox-Token,
 * Map-Style oder Pitch zu ändern.
 *
 * Der eigentliche Cleanup-Code lebt im Modul (kennt seine State-Variablen).
 * Diese Funktion liefert nur das Bestätigungs-Modal.
 *
 * @param {string|null} moduleName - Anzeigename („Animator", …). null/"" =
 *   Workspace-übergreifend (alle Module) → confirm_all-Text.
 * @param {function} onConfirm - async () => Promise — wird gerufen wenn User OK klickt
 */
async function confirmClearWorkspace(moduleName, onConfirm) {
  // v0.9.155: moduleName leer → globaler Clear-Text (alle Module).
  const confirmText = moduleName
    ? t("common.clear_workspace.confirm").replace("{module}", moduleName)
    : t("common.clear_workspace.confirm_all");
  return new Promise(resolve => {
    openModal({
      title: t("common.clear_workspace"),
      body: `
        <p>${confirmText}</p>
        <p class="muted" style="margin-top:8px; font-size:11.5px;">
          ${t("common.clear_workspace.note")}
        </p>
      `,
      footer: `
        <button class="btn" id="md-clear-cancel">${t("common.cancel")}</button>
        <button class="btn btn-primary" id="md-clear-ok">${t("common.clear_workspace.confirm_btn")}</button>
      `,
    });
    document.getElementById("md-clear-cancel").onclick = () => {
      openModal({}).close();
      resolve(false);
    };
    document.getElementById("md-clear-ok").onclick = async () => {
      try { await onConfirm(); } catch (e) { console.warn("clearWorkspace:", e); }
      openModal({}).close();
      toast(t("common.clear_workspace.success"), "success", 2000);
      resolve(true);
    };
  });
}

/* ⏳ Touren-Lade-Modal (28.08.2026, Marc) — global, weil ZWEI Orte es brauchen:
 * Das ARCHIV öffnet es SOFORT beim Klick auf die Übergabe (Marcs Punkt 1: „das
 * modal kommt viel zu spät" — vorher erschien es erst im Animator-Handler,
 * nach Haupt-Track-Load, Modulwechsel und 1,2 s Wartezeit), der ANIMATOR tickt
 * hinein und schließt am Ende.
 *
 * Feste Maße gegen Marcs Punkt 2 („springt die ganze zeit hin und her"):
 * Der Inhalt hat eine feste Breite, Zähler und Tourname je eine eigene Zeile
 * mit fester Höhe; lange Namen werden mit … abgeschnitten statt das Modal zu
 * dehnen.
 */
let _tourenLadeOffen = false;
// 28.08.2026 (Marc): Abbrechen muss gehen — der Knopf setzt nur dieses Flag,
// die Ladeschleifen im Animator prüfen es pro Tour und räumen selbst auf
// (nichts Halbes wird gespeichert, es geht zurück ins Archiv).
let _tourenLadeAbbruch = false;
function tourenLadeModalAbgebrochen() { return _tourenLadeAbbruch; }
function tourenLadeModalZeigen() {
  if (_tourenLadeOffen) return false;
  _tourenLadeOffen = true;
  _tourenLadeAbbruch = false;
  openModal({
    title: "⏳ " + t("animator.tours.lade_titel", "Touren werden geladen"),
    body: `<div style="width:360px; max-width:100%; text-align:center; padding:14px 6px">
      <div id="rz-lade-zaehler" style="font-size:17px; font-weight:700; height:1.5em">${
        t("animator.tours.lade_vorbereiten", "Touren werden vorbereitet …")}</div>
      <div id="rz-lade-name" style="height:1.5em; line-height:1.5em; white-space:nowrap;
           overflow:hidden; text-overflow:ellipsis; opacity:.75; margin-bottom:8px"></div>
      <div class="hint" style="opacity:.8">${t("animator.tours.lade_warte",
        "Bitte warten — danach baut sich die Vorschau mit allen Touren auf.")}</div>
    </div>`,
    footer: `<button class="btn" id="rz-lade-abbruch">${t("common.cancel", "Abbrechen")}</button>`,
    closable: false,
  });
  const ab = document.getElementById("rz-lade-abbruch");
  if (ab) ab.onclick = () => {
    _tourenLadeAbbruch = true;
    ab.disabled = true;
    tourenLadeModalSchritt(t("animator.tours.lade_abbruch", "Wird abgebrochen …"));
    // Notausstieg (28.08.2026, Marc: „klick ich abbrechen hängt er"): das Flag
    // konsumieren nur die Ladeschleifen im Animator. Läuft keine (Modal beim
    // Boot geöffnet, Animator nie gemountet), wäre der Knopf wirkungslos und
    // das nicht schließbare Modal eine tote App. Konsumiert binnen 5 s niemand,
    // schließen wir hart — das Flag bleibt bewusst stehen, damit eine doch
    // noch laufende Schleife es beim nächsten Blick sieht.
    setTimeout(() => {
      if (_tourenLadeOffen && _tourenLadeAbbruch) {
        _tourenLadeOffen = false;
        try { openModal({}).close(); } catch (_) {}
      }
    }, 5000);
  };
  return true;
}
function tourenLadeModalTick(i, n, name) {
  const z = document.getElementById("rz-lade-zaehler");
  if (z) z.textContent = t("animator.tours.lade_text", "Lade Tour {i} von {n} …")
    .replace("{i}", i).replace("{n}", n);
  const nm = document.getElementById("rz-lade-name");
  if (nm) nm.textContent = name || "";
}
/** Schritt-Anzeige ohne Zähler — für die Phasen NACH dem Touren-Laden
 *  („Vorschau wird aufgebaut …", „Karte wird gezeichnet …"). Marc, 28.08.2026:
 *  „das modal muss so lange bleiben, bis man mit dem animator arbeiten kann …
 *  immer schön hinschreiben, was passiert." */
function tourenLadeModalSchritt(text) {
  const z = document.getElementById("rz-lade-zaehler");
  if (z) z.textContent = text || "";
  const nm = document.getElementById("rz-lade-name");
  if (nm) nm.textContent = "";
}
function tourenLadeModalOffen() { return _tourenLadeOffen; }
function tourenLadeModalZu() {
  if (!_tourenLadeOffen) return;
  _tourenLadeOffen = false;
  _tourenLadeAbbruch = false;
  try { openModal({}).close(); } catch (_) {}
}

// ── Settings ───────────────────────────────────────────────────────────────

let _settingsCache = null;
let _settingsSaveTimer = null;
// v0.6.9 — Pending-Patch akkumuliert ALLE Updates die innerhalb der
// 200 ms Debounce-Periode reinkommen. Bug-Fix: vorher hat der zweite
// saveSettings-Call den ersten Patch überschrieben (clearTimeout +
// neuer setTimeout mit nur dem zweiten Patch). Wenn z.B. die Resolution-
// Buttons width+height in zwei aufeinanderfolgenden dispatchEvents
// updaten, ging das erste Update verloren → auf der Disk landete
// alte width × neue height = vertauschte Auflösung.
let _settingsPendingPatch = null;

// v0.8.0: Aktive Session + Projekt. Wenn gesetzt, schreiben Module-
// Settings ans Projekt statt in die globale settings.json. Beim GPX-Load
// wird das über `sessionActivate()` gesetzt; Module-Code merkt nichts.
let _activeSession = null;       // { track_hash, name, stats }
let _activeProject = null;       // { id, name, animator, tourmap, geotagger }
let _projectsList = [];          // [{ id, name, is_active }]
let _projectSaveTimer = null;
let _projectPendingPatch = null; // { module: { key: val, ... } }
let _projectPendingZiel = null;  // { hash, id } — Ziel des offenen Patches

async function loadSettings() {
  if (_settingsCache) return _settingsCache;
  _settingsCache = await api().settings_get();
  return _settingsCache;
}

// ── v0.8.0: Sessions + Projekte ─────────────────────────────────────────

function getActiveSession() { return _activeSession; }
function getActiveProject() { return _activeProject; }
function getProjectsList()  { return _projectsList; }

/** Aktiviert eine Session anhand eines Track-Coord-Arrays. Wird beim
 *  GPX-Load gerufen. Lädt das aktive Projekt der Session und setzt es
 *  als Layer "über" den globalen Settings.
 *
 *  Module sollten danach `rebindAllSettings()` rufen damit ihre UI-
 *  Werte aus den Projekt-Settings neu geladen werden.
 */
async function sessionActivate(coords, gpxPath) {
  try {
    const res = await api().session_open_for_track(coords, gpxPath || "");
    if (!res || !res.ok) {
      console.warn("sessionActivate failed:", res);
      return null;
    }
    _activeSession = res.session;
    _activeProject = res.active_project;
    _projectsList = res.projects || [];
    // Notify UI-Listener (Topbar-Dropdown rendert sich neu)
    _notifySessionChanged();
    return res;
  } catch (err) {
    console.warn("sessionActivate error:", err);
    return null;
  }
}

/** Aktiviert die Sitzung einer TOURENMENGE (Reise/Schwarm, IDEAS §38).
 *
 *  Wird nach der Archiv-Übergabe gerufen, wenn alle Pfade bekannt sind. Die
 *  Menge ist die Identität (`menge:<hash>`), nicht die erste Tour — dieselben
 *  Touren wieder wählen heißt: die Arbeit ist wieder da. Alle Projekt-Brücken
 *  arbeiten danach unverändert mit dem Mengen-Schlüssel.
 */
async function sessionActivateMenge(gpxPaths, ablauf, modus, pausen) {
  try {
    const res = await api().session_open_for_menge(gpxPaths || [], ablauf || "reise",
      modus || "gleich", pausen !== false);
    if (!res || !res.ok) {
      console.warn("sessionActivateMenge failed:", res);
      return null;
    }
    _activeSession = res.session;
    _activeProject = res.active_project;
    _projectsList = res.projects || [];
    _notifySessionChanged();
    return res;
  } catch (err) {
    console.warn("sessionActivateMenge error:", err);
    return null;
  }
}

/** v0.9.612 — Frei-Kontext aktivieren (leeres Projekt ohne Track). */
async function sessionActivateFrei(kontext) {
  try {
    const res = await api().session_open_for_frei(kontext);
    if (!res || !res.ok) { console.warn("sessionActivateFrei failed:", res); return null; }
    _activeSession = res.session;
    _activeProject = res.active_project;
    _projectsList = res.projects || [];
    _notifySessionChanged();
    return res;
  } catch (err) {
    console.warn("sessionActivateFrei error:", err);
    return null;
  }
}

/** Wechselt das aktive Projekt der aktuellen Session. */
async function projectSetActive(projectId) {
  if (!_activeSession) return null;
  const res = await api().session_set_active_project(_activeSession.track_hash, projectId);
  if (!res || !res.ok) return null;
  _activeProject = res.active_project;
  _projectsList = res.projects || [];
  _notifySessionChanged();
  return res;
}

async function projectCreate(name, copyFromId) {
  if (!_activeSession) return null;
  const res = await api().session_create_project(_activeSession.track_hash, name || "", copyFromId || "");
  if (!res || !res.ok) return null;
  _activeProject = res.active_project;
  _projectsList = res.projects || [];
  _notifySessionChanged();
  return res;
}

async function projectRename(projectId, newName) {
  if (!_activeSession) return null;
  const res = await api().session_rename_project(_activeSession.track_hash, projectId, newName || "");
  if (!res || !res.ok) return null;
  _projectsList = res.projects || [];
  // Falls aktuell aktives Projekt umbenannt: lokales Cache-Name aktualisieren
  if (_activeProject && _activeProject.id === projectId) {
    _activeProject.name = newName;
  }
  _notifySessionChanged();
  return res;
}

async function projectDelete(projectId) {
  if (!_activeSession) return null;
  const res = await api().session_delete_project(_activeSession.track_hash, projectId);
  if (!res || !res.ok) return null;
  _activeProject = res.active_project;
  _projectsList = res.projects || [];
  _notifySessionChanged();
  return res;
}

/** v0.8.1: Aktive Session zurücksetzen (kein GPX mehr geladen).
 *  Wird von gpx-bar.js gerufen wenn der User „✕" drückt. */
function _resetActiveSession() {
  // Offene Patches gehören noch dem alten Projekt — erst wegschreiben,
  // sonst verschluckt der Timer sie (Audit 30.08.2026).
  try { _projectFlushNow(); _projectRootFlushNow(); } catch (e) { applog("warn", "[projekt] Flush beim Schliessen: " + e); }
  _activeSession = null;
  _activeProject = null;
  _projectsList = [];
  _notifySessionChanged();
}

/** v0.8.4: Wartet bis eine Mapbox-Map-Instanz fertig style-geladen ist.
 *  Robust gegen Race-Conditions: wenn `isStyleLoaded()` bereits true ist,
 *  wird `cb` sofort gerufen; sonst via `on("load")`. Mapbox's `load`-Event
 *  feuert nur EINMAL pro Instanz — wenn er schon vorbei ist BEVOR wir
 *  einen Listener registrieren, wird `once("load")` nie aufgerufen.
 *  Daher der `isStyleLoaded()`-Pre-Check.
 *
 *  Nutzung:
 *    onMapReady(map, () => { rebuildPreviewLayers(); applyGlobalGpx(...); });
 */
// Lebt diese Karte noch? Nach `map.remove()` ist `map.style` weg — ruft dann
// noch jemand eine Karten-Methode auf, wirft Mapbox intern
// „undefined is not an object (evaluating 'this.style.getOwnLayer')". Genau das
// stand im einem Nutzer-Bug-Report zu v0.9.495 mehrfach im Log. Beim Wechsel
// zwischen Modulen wird die alte Karte abgebaut, während ein `load`-Rückruf noch
// aussteht — der darf dann nicht mehr feuern.
function _mapLebt(map) {
  try { return !!(map && map.style && !map._removed); } catch (_) { return false; }
}

function onMapReady(map, cb) {
  if (!_mapLebt(map)) return;
  const styleReady = map.isStyleLoaded();
  applog("info", `[onMapReady] styleLoaded=${styleReady}`);
  if (styleReady) { try { cb(); } catch (err) { console.warn("onMapReady cb:", err); applog("error", "[onMapReady cb-sync] " + err); } return; }
  map.once("load", () => {
    if (!_mapLebt(map)) {
      applog("info", "[onMapReady] Karte war beim load-Event schon abgebaut — Rückruf übersprungen");
      return;
    }
    applog("info", "[onMapReady] load event fired, calling cb");
    try { cb(); } catch (err) { console.warn("onMapReady cb:", err); applog("error", "[onMapReady cb-load] " + err); }
  });
}

// v0.8.4: JS-Logger der in die Python-app.log schreibt — damit Marc
// auch ohne DevTools sieht was passiert. Bei großer Daten schicken wir
// nur ne Kurz-Zusammenfassung damit die log-Datei nicht explodiert.
// v0.8.20 — Globaler Help-Button-Click: jedes `.field-help` Element togglet
// das zugehörige `.field-help-content[data-help-content="<key>"]` ein/aus.
// Pattern wird durch die ganze App benutzt (Animator + Tour-Map + ggf. mehr).
// Single delegated listener auf document — funktioniert auch wenn die Buttons
// nach Mount dynamisch eingefügt werden.
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".field-help, .field-help-pill");
  if (!btn) return;
  e.preventDefault();
  const key = btn.dataset.help;
  if (!key) return;
  const content = document.querySelector(`.field-help-content[data-help-content="${key}"]`);
  if (!content) return;
  const willShow = content.hidden;
  content.hidden = !willShow;
  btn.classList.toggle("is-open", willShow);
});

// v0.9.12 — Render-Lock-Helper. Setzt/entfernt `body.is-rendering`
// damit der Render-Lock-Style (siehe app.css) greift. Module rufen das
// beim Start + bei Done/Cancel/Error. Idempotent.
function setRenderingState(on) {
  document.body.classList.toggle("is-rendering", !!on);
}

function applog(level, msg) {
  try {
    if (window.pywebview && window.pywebview.api && window.pywebview.api.log_js) {
      window.pywebview.api.log_js(level, String(msg).slice(0, 500));
    }
  } catch (_) {}
}

/**
 * Einen gefangenen Fehler NICHT stumm schlucken (v0.9.459).
 *
 * Der Code hat hunderte `catch (_) {}` — bewusst, weil einzelne Map-/Render-
 * Aussetzer die App nicht kippen sollen. Der Preis: wenn wirklich mal etwas
 * schiefläuft (fehlende Tour-Linien, verlorene Klicks), gibt es keine Spur.
 *
 * `rzSwallow` ist der explizite Ersatz für `catch (_) {}` an DIAGNOSE-relevanten
 * Stellen: standardmäßig genauso still, aber mit gesetztem Debug-Flag landet der
 * Fehler samt Kontext im app.log. Marc kann das ohne Rebuild einschalten:
 *   localStorage.setItem("rz_debug", "1")   (in der WebView-Konsole)
 * oder zur Laufzeit `window.__rzDebug = true`.
 *
 *   } catch (e) { rzSwallow(e, "applyLineStyle"); }
 */
function rzSwallow(err, context) {
  try {
    const on = window.__rzDebug
      || (window.localStorage && window.localStorage.getItem("rz_debug") === "1");
    if (on) applog("warn", `[swallow${context ? " " + context : ""}] ${err && err.message || err}`);
  } catch (_) {}
}
// Optional: globale Error-Capture
window.addEventListener("error", (e) => {
  if (_rzMapboxNachzuegler(e)) return;
  applog("error", `[window.onerror] ${e.message} @ ${e.filename}:${e.lineno}`);
});
window.addEventListener("unhandledrejection", (e) => {
  applog("error", `[unhandledrejection] ${e.reason}`);
});

// v0.9.25 — Shutdown-Flag: Module pollen mit setTimeout-Schleifen (Geotagger
// Thumbs, Animator Render-Status). Wenn der User den X-Button klickt, möchten
// wir, dass NIEMAND mehr `api().xxx()` aufruft — denn ein in-flight Bridge-Call
// während WKWebView die Bridge abräumt kann die App einfrieren lassen.
// `pagehide` feuert verlässlich auf macOS-WKWebView wenn das Fenster zugemacht
// wird, `beforeunload` als Fallback.
// v0.9.28 (Marc-Feedback): globaler Module-Cache für Tab-Wechsel-State.
// Module schreiben beim Unmount ihren live-State (Map-Pose, Selection, ...)
// rein, beim Mount lesen sie ihn (falls vorhanden). Bleibt bis App-Close.
window.__rzgpsModuleCache = window.__rzgpsModuleCache || {};

window.__rzgpsShuttingDown = false;
function _markShuttingDown() {
  if (window.__rzgpsShuttingDown) return;
  window.__rzgpsShuttingDown = true;
  // Bekannte UI-Module-Hooks: Modules können sich registrieren um beim Close
  // sauber zu stoppen (Polling, ResizeObserver, …).
  for (const cb of (window.__rzgpsCloseHandlers || [])) {
    try { cb(); } catch (err) { try { applog("warn", `closeHandler: ${err}`); } catch (_) {} }
  }
}
function onAppClose(cb) {
  window.__rzgpsCloseHandlers = window.__rzgpsCloseHandlers || [];
  window.__rzgpsCloseHandlers.push(cb);
}
window.addEventListener("pagehide", _markShuttingDown);
window.addEventListener("beforeunload", _markShuttingDown);

// Listener-Pattern für UI (Topbar-Dropdown). Mehrere Listener möglich
// damit z.B. auch der Animator beim Projekt-Wechsel re-bindet.
const _sessionListeners = new Set();
function onSessionChanged(cb) { _sessionListeners.add(cb); return () => _sessionListeners.delete(cb); }
function _notifySessionChanged() {
  for (const cb of _sessionListeners) {
    try { cb({ session: _activeSession, project: _activeProject, projects: _projectsList }); }
    catch (err) { console.warn("session listener threw:", err); }
  }
}

/** Speichert einen Patch im aktiven Projekt (debounced, 200 ms).
 *  `module` = "animator" | "tourmap" | "geotagger".
 *  Cache wird sofort aktualisiert. */
function saveProjectSettings(module, patch) {
  if (!_activeSession || !_activeProject) {
    // Kein Projekt aktiv → fallback auf globale settings.json
    // (z.B. ganz frische App ohne GPX)
    return saveSettings({ [module]: patch });
  }
  // Cache aktualisieren
  if (!_activeProject[module] || typeof _activeProject[module] !== "object") {
    _activeProject[module] = {};
  }
  _mergePatchInto(_activeProject[module], patch);

  // Pending-Patch akkumulieren (analog saveSettings)
  if (!_projectPendingPatch) _projectPendingPatch = {};
  if (!_projectPendingPatch[module]) _projectPendingPatch[module] = {};
  _mergePatchInto(_projectPendingPatch[module], patch);

  // Ziel JETZT festhalten, nicht erst beim Feuern (Audit 30.08.2026).
  // Vorher las der Timer `_activeSession`/`_activeProject` erst nach 200 ms —
  // wer in dieser Zeit das Projekt wechselte, ein neues anlegte oder „✕"
  // drückte, schrieb seine Änderung in das FALSCHE Projekt oder verlor sie
  // kommentarlos (`if (!session || !project) return;`).
  const ziel = { hash: _activeSession.track_hash, id: _activeProject.id };
  if (_projectPendingZiel && (_projectPendingZiel.hash !== ziel.hash
                              || _projectPendingZiel.id !== ziel.id)) {
    _projectFlushNow();          // anderes Ziel: Offenes erst wegschreiben
    if (!_projectPendingPatch) _projectPendingPatch = {};
    if (!_projectPendingPatch[module]) _projectPendingPatch[module] = {};
    _mergePatchInto(_projectPendingPatch[module], patch);
  }
  _projectPendingZiel = ziel;

  clearTimeout(_projectSaveTimer);
  _projectSaveTimer = setTimeout(_projectFlushNow, 200);
}

/** Offenen Projekt-Patch sofort an SEIN Ziel schicken (nicht ans gerade aktive). */
function _projectFlushNow() {
  clearTimeout(_projectSaveTimer);
  const toSend = _projectPendingPatch;
  const ziel = _projectPendingZiel;
  _projectPendingPatch = null;
  _projectPendingZiel = null;
  if (!toSend || !ziel) return;
  Object.entries(toSend).forEach(([mod, modPatch]) => {
    api().session_update_project_settings(ziel.hash, ziel.id, mod, modPatch)
      .catch(err => applog("warn", "[projekt] Speichern von " + mod
                           + " fehlgeschlagen: " + (err && err.message ? err.message : err)));
  });
}

/**
 * v0.9.74 — Schreibt einen Patch direkt auf Projekt-ROOT (= außerhalb der
 * `animator`/`tourmap`/`geotagger`-Subkeys). Genutzt für `photos`, die
 * zwischen Modulen geteilt sind. Anders als `saveProjectSettings`, das
 * eine Modul-Sektion erwartet.
 *
 * Throttling identisch (200 ms debounce).
 *
 * v0.9.78 — `opts.persistOnly: true` skippt den In-Memory-Apply. Das
 * brauchen wir für Fotos: die UI hält die Live-Liste MIT base64-Thumbs
 * im RAM, der Persistenz-Patch ist die STRIPPED Variante ohne Thumbs
 * (sonst würde sessions.json bei 50 Fotos auf 5+ MB explodieren). Ohne
 * persistOnly wurde `_activeProject.photos` auf die stripped Liste
 * überschrieben → Thumbs weg → nächstes attachToMap konnte keine Images
 * laden → keine Pins auf der Karte. Marc-Bug v0.9.77.
 */
let _projectRootPendingPatch = null;
let _projectRootPendingZiel = null;  // { hash, id } — Ziel des offenen Root-Patches
let _projectRootSaveTimer = null;
function saveActiveProjectPatch(patch, opts) {
  if (!_activeSession || !_activeProject) return;
  opts = opts || {};
  if (!opts.persistOnly) {
    // In-Memory direkt anwenden — UI darf sich auf _activeProject.<key> verlassen
    for (const [k, v] of Object.entries(patch || {})) {
      _activeProject[k] = v;
    }
  }
  // Ziel beim Einreihen festhalten — gleiche Begründung wie bei
  // `saveProjectSettings`: sonst landen Fotos/Pins im falschen Projekt.
  const zielR = { hash: _activeSession.track_hash, id: _activeProject.id };
  if (_projectRootPendingZiel && (_projectRootPendingZiel.hash !== zielR.hash
                                  || _projectRootPendingZiel.id !== zielR.id)) {
    _projectRootFlushNow();
    if (!_projectRootPendingPatch) _projectRootPendingPatch = {};
  }
  if (!_projectRootPendingPatch) _projectRootPendingPatch = {};
  Object.assign(_projectRootPendingPatch, patch);
  _projectRootPendingZiel = zielR;
  clearTimeout(_projectRootSaveTimer);
  _projectRootSaveTimer = setTimeout(_projectRootFlushNow, 200);
}

/** Offenen Projekt-ROOT-Patch sofort an SEIN Ziel schicken. */
function _projectRootFlushNow() {
  clearTimeout(_projectRootSaveTimer);
  const toSend = _projectRootPendingPatch;
  const ziel = _projectRootPendingZiel;
  _projectRootPendingPatch = null;
  _projectRootPendingZiel = null;
  if (!toSend || !ziel) return;
  api().session_update_project_root(ziel.hash, ziel.id, toSend)
    .catch(err => applog("warn", "[projekt] Speichern der Projektdaten fehlgeschlagen: "
                         + (err && err.message ? err.message : err)));
}

/** Tief-Merge des Patches in target (in-place). Sections werden objekt-merged. */
function _mergePatchInto(target, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      target[k] = Object.assign({}, target[k] || {}, v);
    } else {
      target[k] = v;
    }
  }
}

/** Persistente Settings für einen Bereich patchen.
 *  Default debounced (200 ms), für Slider/Inputs. Mehrere Aufrufe
 *  innerhalb der Debounce-Periode werden ZUSAMMENGEFÜHRT (nicht
 *  überschrieben) — wichtig wenn z.B. die Resolution-Buttons
 *  width+height nacheinander updaten.
 *
 *  Mit `{immediate:true}` sofort via Bridge schreiben — returns Promise.
 *  Cache wird in beiden Fällen sofort aktualisiert. */
function saveSettings(patch, opts) {
  // Cache sofort updaten, damit Re-Reads sofort konsistent sind
  if (_settingsCache) {
    _mergePatchInto(_settingsCache, patch);
  }
  // Pending-Patch akkumulieren (statt clearTimeout + neuer Patch)
  if (!_settingsPendingPatch) _settingsPendingPatch = {};
  _mergePatchInto(_settingsPendingPatch, patch);

  clearTimeout(_settingsSaveTimer);
  if (opts && opts.immediate) {
    // Sofort schreiben — gesamten akkumulierten Patch
    const toSend = _settingsPendingPatch;
    _settingsPendingPatch = null;
    return api().settings_set(toSend).catch(err => console.warn("settings_set", err));
  }
  _settingsSaveTimer = setTimeout(() => {
    const toSend = _settingsPendingPatch;
    _settingsPendingPatch = null;
    api().settings_set(toSend).catch(err => console.warn("settings_set", err));
  }, 200);
  return Promise.resolve();
}

/**
 * Bindet ein Form-Element an ein Settings-Feld.
 * - Initialisiert den Wert aus den Settings
 * - Speichert bei input/change
 *
 *   bindSetting("anim-pitch", "animator", "pitch", { type: "number", onChange: cb })
 */
// v0.8.0: Registry aller bindSetting-Calls — gebraucht für
// rebindAllSettings() bei Projekt-Wechsel ohne Modul-Re-Mount.
// Wird beim Mount eines Moduls implizit per `bindSetting()` befüllt;
// bei Re-Mount (anderes Modul, gleicher Tab) bleibt sie bestehen — die
// bindSetting-Calls werden dann mit DOM-Elementen vom neuen Modul
// überschrieben (gleiche elementId). Beim Re-Read wird via
// `document.getElementById()` immer das aktuelle Element gefunden.
const _bindRegistry = [];

function bindSetting(elementId, section, key, opts = {}) {
  const el = document.getElementById(elementId);
  if (!el || !_settingsCache) return;
  const type = opts.type || (el.type === "checkbox" ? "bool" : el.type === "number" ? "number" : "string");
  // v0.8.0: Wert kommt aus dem aktiven Projekt wenn vorhanden, sonst aus
  // den globalen Settings (settings.json). Schreibt auch dahin zurück
  // wo's herkam — Projekt wenn aktiv, sonst settings.json.
  const isProjectModule = (section === "animator" || section === "tourmap" || section === "geotagger" || section === "reiseroute" || section === "webkarte");

  const readCurrent = () => {
    const projectSection = (isProjectModule && _activeProject && _activeProject[section]) ? _activeProject[section] : null;
    const globalSection = _settingsCache[section] || {};
    return (projectSection && key in projectSection) ? projectSection[key] : globalSection[key];
  };

  const applyToElement = (cur) => {
    if (cur === undefined || cur === null) return;
    if (type === "bool") el.checked = !!cur;
    else el.value = String(cur);
    if (opts.onLoad) opts.onLoad(cur);
  };

  // Initial-Apply
  applyToElement(readCurrent());

  // In Registry eintragen (für rebindAllSettings bei Projekt-Wechsel).
  // v0.9.389 — existierenden Eintrag (gleiche elementId+section+key) ERSETZEN statt
  // blind anhängen. Sonst wächst die Registry pro Modul-Mount unbegrenzt und
  // rebindAllSettings() feuert `onLoad`-Closures längst entfernter Mounts (die auf
  // toten Maps operieren → Fehler + Speicher-Leak). Der Kommentar oben beschrieb das
  // Ersetzen schon als Absicht — der Code hängte bisher nur an.
  const _entry = { elementId, section, key, type, opts, isProjectModule };
  const _ri = _bindRegistry.findIndex((r) => r.elementId === elementId && r.section === section && r.key === key);
  if (_ri >= 0) _bindRegistry[_ri] = _entry; else _bindRegistry.push(_entry);

  const evName = (el.tagName === "SELECT") ? "change"
                 : (type === "bool") ? "change"
                 : "input";
  // v0.9.327 — Color-Inputs (macOS-Systempicker) feuern beim Ziehen sehr viele
  // 'input'-Events. Vorher löste JEDES einen Bridge-Save + vollen Overlay-Rebuild
  // aus → der Picker wurde träge/„klebrig" (Marc kam kaum raus). Für Color daher:
  // Live-Vorschau pro Animation-Frame gebündelt, Persistenz trailing-debounced.
  const isColor = (el.type === "color");
  let _colorRaf = 0, _colorSaveTimer = 0;
  el.addEventListener(evName, () => {
    let val;
    if (type === "bool") val = el.checked;
    else if (type === "number") val = parseNum(el.value, NaN);  // v0.9.459: Komma-Dezimal
    else val = el.value;
    if (isColor) {
      // Undo: ein Schritt pro Pick-Geste (Throttle, wie Slider).
      const _panelManaged = window.__rzPanelUndoSections && window.__rzPanelUndoSections.has(section);
      const _uc = window.__rzUndoControllers && window.__rzUndoControllers[section];
      if (_uc && !_panelManaged) {
        const diffEl = (window.__rzLastUndoEl !== elementId);
        try { _uc.push("Farbe", { force: diffEl }); } catch (_) {}
        window.__rzLastUndoEl = elementId;
      }
      // Live-Vorschau: pro Frame gebündelt (flüssig, kein Jank).
      if (opts.onChange && !_colorRaf) {
        _colorRaf = requestAnimationFrame(() => { _colorRaf = 0; try { opts.onChange(el.value); } catch (_) {} });
      }
      // Persistenz: trailing-debounced (nicht bei jedem Picker-Zucken).
      if (_colorSaveTimer) clearTimeout(_colorSaveTimer);
      _colorSaveTimer = setTimeout(() => {
        const v = el.value;
        if (isProjectModule && _activeSession && _activeProject) saveProjectSettings(section, { [key]: v });
        else saveSettings({ [section]: { [key]: v } });
      }, 140);
      return;
    }
    // v0.9.322 — Undo: VOR dem Speichern den aktuellen (= alten) Modul-Stand in
    // den Undo-Controller der Sektion pushen. Diskrete Controls (Select/Checkbox
    // = "change") als eigener Schritt (force), kontinuierliche (Slider/Color =
    // "input") per Throttle zu einem Schritt pro Geste gebündelt.
    const _panelManaged = window.__rzPanelUndoSections && window.__rzPanelUndoSections.has(section);
    const _uc = window.__rzUndoControllers && window.__rzUndoControllers[section];
    if (_uc && !_panelManaged) {
      // Eigener Undo-Schritt bei diskreten Controls ODER beim Wechsel auf ein
      // ANDERES Control; dasselbe Control kontinuierlich ziehen (Slider/Color) =
      // ein Schritt pro Geste (Throttle). (Bei panel-verwalteten Sektionen — z.B.
      // Geotagger — übernimmt der Panel-Controller das Pushen mit Pre-Change-Stand.)
      const diffEl = (window.__rzLastUndoEl !== elementId);
      try { _uc.push("Einstellung", { force: (evName === "change") || diffEl }); } catch (_) {}
      window.__rzLastUndoEl = elementId;
    }
    // Modul-Settings ans Projekt, Sonstige (z.B. "language") an settings.json
    if (isProjectModule && _activeSession && _activeProject) {
      saveProjectSettings(section, { [key]: val });
    } else {
      saveSettings({ [section]: { [key]: val } });
    }
    if (opts.onChange) opts.onChange(val);
  });
}

/** v0.8.0: liest alle DOM-Werte aus der bindRegistry neu — wird nach
 *  Projekt-Wechsel oder Session-Aktivierung gerufen. Nur die Werte
 *  werden gesetzt; Event-Listener bleiben (waren beim ersten Bind
 *  angehängt). */
function rebindAllSettings() {
  for (const r of _bindRegistry) {
    const el = document.getElementById(r.elementId);
    if (!el) continue;
    const projectSection = (r.isProjectModule && _activeProject && _activeProject[r.section]) ? _activeProject[r.section] : null;
    const globalSection = _settingsCache[r.section] || {};
    const cur = (projectSection && r.key in projectSection) ? projectSection[r.key] : globalSection[r.key];
    if (cur === undefined || cur === null) {
      // v0.9.322 — Beim Undo-Apply: ein im Ziel-Snapshot FEHLENDER Wert (z.B. eine
      // Einstellung, die vor der Änderung noch nie gesetzt war / altes Projekt)
      // soll das Control auf seinen HTML-Default zurücksetzen — sonst bliebe es auf
      // dem geänderten Wert hängen (Textfarbe-Bug). Ausserhalb von Undo: wie bisher
      // überspringen (Wert beibehalten).
      if (window.__rzUndoApplying) {
        let dv;
        if (r.type === "bool") { el.checked = el.defaultChecked; dv = el.checked; }
        else if (el.tagName === "SELECT") {
          const def = Array.from(el.options).find(o => o.defaultSelected) || el.options[0];
          if (def) el.value = def.value;
          dv = el.value;
        } else { el.value = el.defaultValue; dv = el.value; }
        if (r.opts.onLoad) { try { r.opts.onLoad(dv); } catch (_) {} }
      }
      continue;
    }
    if (r.type === "bool") el.checked = !!cur;
    else el.value = String(cur);
    if (r.opts.onLoad) {
      try { r.opts.onLoad(cur); } catch (_) {}
    }
  }
  // v0.9.322 — echter Projekt-/Session-Wechsel → Undo-Stacks leeren (man soll
  // nicht in den Stand eines anderen Projekts „zurück"-undoen). NICHT wenn der
  // Aufruf aus einem laufenden Undo-Apply kommt (Flag von createUndoController).
  if (!window.__rzUndoApplying && window.__rzUndoControllers) {
    for (const k in window.__rzUndoControllers) {
      try { window.__rzUndoControllers[k].reset(); } catch (_) {}
    }
  }
}

/** v0.9.322 — Undo-Helfer: nach dem Wiederherstellen eines Settings-Snapshots
 *  für JEDES geänderte Control der Sektion das native input/change-Event feuern,
 *  damit nicht nur der Wert, sondern auch die SICHTBARE Wirkung (z.B. Linienfarbe
 *  auf die Karte, Linienbreite, Overlay-Vorschau) neu angewendet wird — viele
 *  Module hängen ihre apply-Logik an einen separaten input-Listener, nicht an
 *  bindSetting.onChange. `prevSection` = Settings-Stand VOR dem Restore (zum
 *  Vergleich, damit nur tatsächlich geänderte Controls feuern). */
/** v0.9.322 — Liest/Schreibt den Settings-Block einer Modul-Sektion an der
 *  richtigen Stelle: aktives Projekt wenn vorhanden, sonst globale settings.json.
 *  Vom Undo-Controller genutzt, damit Undo auch ohne aktives Projekt greift. */
function _rzIsProjectSection(section) {
  return (section === "animator" || section === "tourmap" || section === "geotagger" || section === "reiseroute" || section === "webkarte");
}
window.rzReadModuleSettings = function (section) {
  if (_rzIsProjectSection(section) && _activeSession && _activeProject && _activeProject[section]) {
    return _activeProject[section];
  }
  return (_settingsCache && _settingsCache[section]) || {};
};
window.rzWriteModuleSettings = function (section, obj) {
  if (_rzIsProjectSection(section) && _activeSession && _activeProject) {
    _activeProject[section] = JSON.parse(JSON.stringify(obj));
    saveProjectSettings(section, obj);
  } else {
    if (_settingsCache) _settingsCache[section] = JSON.parse(JSON.stringify(obj));
    saveSettings({ [section]: obj });
  }
};

function rzReapplySection(section, prevSection) {
  const proj = window.rzReadModuleSettings(section);
  for (const r of _bindRegistry) {
    if (r.section !== section) continue;
    const el = document.getElementById(r.elementId);
    if (!el) continue;
    const before = prevSection ? prevSection[r.key] : undefined;
    const after = proj[r.key];
    if (JSON.stringify(before) === JSON.stringify(after)) continue;  // unverändert → kein Event
    const ev = (el.tagName === "SELECT" || el.type === "checkbox") ? "change" : "input";
    try { el.dispatchEvent(new Event(ev, { bubbles: true })); } catch (_) {}
  }
}

// ── Drag & Drop Lib ─────────────────────────────────────────────────────────

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // Format: "data:image/jpeg;base64,xxxx"
      const result = reader.result;
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function fileToText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, "utf-8");
  });
}

/**
 * Sammelt rekursiv alle Files aus einem DragEvent.
 *
 * WICHTIG: `dataTransfer.items` und seine Methoden sind nach dem ersten `await`
 * im Drop-Handler nicht mehr garantiert nutzbar — der Browser invalidiert die
 * Items nach Event-Ende. Wir machen daher **erst einen synchronen Snapshot**
 * aller Items, dann erst die async-Traversierung.
 *
 * Strategien:
 *   1) dataTransfer.items + webkitGetAsEntry (Ordner-Support)
 *   2) dataTransfer.items + getAsFile (kein Ordner-Support)
 *   3) dataTransfer.files (Browser-Fallback)
 *
 * Liefert: [{file: File, relPath: "subdir/foo.jpg"}, ...]
 */
async function collectFilesFromDrop(ev) {
  const dt = ev.dataTransfer;
  if (!dt) return [];

  // ── 1) SOFORT alle Refs synchron snapshot-en. Kein await dazwischen! ──
  const snapshot = [];           // [{entry, file}]
  if (dt.items && dt.items.length) {
    for (const item of dt.items) {
      if (item.kind !== "file") continue;
      let entry = null;
      try {
        entry = (typeof item.webkitGetAsEntry === "function")
                ? item.webkitGetAsEntry() : null;
      } catch (e) { console.warn("webkitGetAsEntry", e); }
      let file = null;
      try {
        file = item.getAsFile ? item.getAsFile() : null;
      } catch (e) { console.warn("getAsFile", e); }
      snapshot.push({ entry, file });
    }
  }
  // Zusätzlich dataTransfer.files (synchron lesbar, manche Plattformen
  // liefern hier mehr als über items).
  const filesSnapshot = dt.files ? Array.from(dt.files) : [];

  // ── 2) Jetzt async traversieren ────────────────────────────────────────
  const out = [];
  const seen = new Set();
  function add(file, relPath) {
    if (!file) return;
    const key = relPath + "::" + (file.size || 0) + "::" + (file.lastModified || 0);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ file, relPath });
  }

  function traverseEntry(entry, prefix = "") {
    if (!entry) return Promise.resolve();
    return new Promise(resolve => {
      if (entry.isFile) {
        entry.file(
          f => { add(f, prefix + entry.name); resolve(); },
          err => { console.warn("entry.file error", err); resolve(); }
        );
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        const collected = [];
        const readBatch = () => {
          reader.readEntries(
            async (entries) => {
              if (!entries.length) {
                // alle Kinder eingesammelt → rekursiv abarbeiten
                for (const e of collected) {
                  await traverseEntry(e, prefix + entry.name + "/");
                }
                resolve();
                return;
              }
              collected.push(...entries);
              readBatch();
            },
            err => { console.warn("readEntries error", err); resolve(); }
          );
        };
        readBatch();
      } else {
        resolve();
      }
    });
  }

  // Items in parallel verarbeiten — sequential wäre langsam bei vielen Ordnern
  await Promise.all(snapshot.map(async ({ entry, file }) => {
    if (entry) {
      await traverseEntry(entry);
    } else if (file) {
      add(file, file.name);
    }
  }));

  // Fallback: dataTransfer.files — hilft wenn .items leer war
  for (const f of filesSnapshot) {
    add(f, f.name);
  }

  console.log("[Drop] " + out.length + " Files gesammelt", out.map(c => c.relPath));
  return out;
}

// ── v0.9.153 — Native Drag-&-Drop-Pfade (pywebview pywebviewFullPath) ─────────
//
// WKWebView/WebView2/GTK/Qt geben JS NIE den echten Dateipfad eines Drops
// (Browser-Security). pywebview erfasst ihn aber auf der nativen Seite und legt
// ihn in `webview.dom._dnd_state` ab — wir holen ihn synchron über die Bridge
// `consume_drop_paths()`. Damit kann z.B. der Geotagger die ORIGINALE in-place
// taggen statt Wegwerf-Kopien in `_drops/` anzulegen.
//
// WICHTIG: `consume_drop_paths()` LEERT den Puffer → pro Drop genau 1× rufen!
// Deshalb konsumiert `setupDropZone` zentral einmal pro Drop und hängt das
// Ergebnis als `.nativePath` an jede gesammelte Datei. Eigene Drop-Handler
// (Animator/Tour-Map/GPX-Bar) rufen `consumeNativeDropMap()` selbst genau 1×.

/**
 * Holt EINMAL pro Drop die echten Originalpfade aus pywebview.
 * Liefert ein Mapping basename → vollständiger Pfad ({} bei Fehler/alt-OS).
 */
async function consumeNativeDropMap() {
  try {
    const a = (typeof api === "function") ? api() : null;
    if (a && typeof a.consume_drop_paths === "function") {
      const r = await a.consume_drop_paths();
      if (r && r.ok && r.paths) return r.paths;
    }
  } catch (e) { console.warn("consume_drop_paths fehlgeschlagen:", e); }
  return {};
}

/** Basename aus name/relPath → echter Pfad aus der Map, sonst null. */
function nativePathFromMap(map, nameOrRel) {
  if (!map) return null;
  const base = String(nameOrRel || "").split(/[\\/]/).pop();
  return (base && map[base]) || null;
}

/**
 * Hängt Drag-&-Drop-Handler an ein Element.
 * options: {
 *   target,                         // DOM-Element (oder Selector-String)
 *   accept: ["gpx", "jpg", "jpeg"], // erlaubte Endungen (lowercase, ohne Punkt)
 *   onDrop(droppedFiles, ev),       // async, bekommt [{file, relPath, nativePath}]
 *   highlightClass: "drop-active",
 * }
 * v0.9.153: Jede Datei in `droppedFiles` trägt zusätzlich `nativePath`
 * (echter Originalpfad | null). Ist er gesetzt, kann der Konsument die Datei
 * in-place verwenden statt sie nach `_drops/` zu kopieren.
 */
function setupDropZone(opts) {
  const target = typeof opts.target === "string" ? document.querySelector(opts.target) : opts.target;
  if (!target) return;
  const accept = (opts.accept || []).map(x => x.toLowerCase());
  const highlightClass = opts.highlightClass || "drop-active";
  let depth = 0;

  function matches(name) {
    if (!accept.length) return true;
    const lower = name.toLowerCase();
    return accept.some(ext => lower.endsWith("." + ext));
  }

  function setHighlight(on) {
    target.classList.toggle(highlightClass, on);
  }

  target.addEventListener("dragenter", e => {
    e.preventDefault(); e.stopPropagation();
    depth++;
    setHighlight(true);
  });
  target.addEventListener("dragover", e => {
    e.preventDefault(); e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  });
  target.addEventListener("dragleave", e => {
    e.preventDefault(); e.stopPropagation();
    depth = Math.max(0, depth - 1);
    if (depth === 0) setHighlight(false);
  });
  target.addEventListener("drop", async e => {
    e.preventDefault(); e.stopPropagation();
    depth = 0;
    setHighlight(false);

    const collected = await collectFilesFromDrop(e);

    // v0.9.153: echte Originalpfade EINMAL pro Drop holen und an jede Datei
    // hängen (nativePath). consume_drop_paths() leert den Puffer → nur 1× hier.
    const nativeMap = await consumeNativeDropMap();
    for (const c of collected) {
      c.nativePath = nativePathFromMap(nativeMap, c.relPath || (c.file && c.file.name));
    }

    // macOS-Auffang: WKWebView liefert dem JS gelegentlich GAR keine
    // File-Objekte. Die nativen Pfade haben wir trotzdem → daraus
    // synthetische Einträge bauen, damit Routing per Endung weiter klappt.
    if (!collected.length && nativeMap) {
      const seen = new Set();
      for (const k in nativeMap) {
        const p = nativeMap[k];
        if (!p || seen.has(p)) continue;
        seen.add(p);
        collected.push({ file: null, relPath: p.split(/[\\/]/).pop(), nativePath: p });
      }
    }

    if (!collected.length) {
      toast(t("error.drop_empty", "Drop enthielt keine Dateien (WKWebView-Bug?). Versuch File-Picker."), "warn", 6000);
      return;
    }
    const filtered = collected.filter(c => matches(c.relPath));
    if (!filtered.length) {
      const got = collected.slice(0, 4).map(c => c.relPath).join(", ");
      const extra = collected.length > 4 ? ` …und ${collected.length - 4} weitere` : "";
      toast(`Falscher Dateityp. Erwartet: ${accept.join(", ")}. Gefunden: ${got}${extra}`, "warn", 7000);
      return;
    }
    try {
      await opts.onDrop(filtered, e);
    } catch (err) {
      console.error(err);
      toast(t("error.drop", "Drop-Fehler") + ": " + (err.message || err), "error");
    }
  });
}

/**
 * Liefert nutzbare Pfade für gedroppte Dateien.
 * v0.9.153: Wo ein echter Originalpfad (`nativePath`) vorliegt, wird DIESER
 * direkt zurückgegeben (kein Copy → In-Place-Bearbeitung möglich). Nur für
 * Dateien OHNE nativen Pfad fällt es auf den base64-Weg nach `_drops/<sid>/`
 * zurück (alt-OS / Sonderfälle).
 */
async function persistDroppedFiles(droppedFiles, kind = "binary", onProgress) {
  // Schnellweg: alle haben echte Pfade → keine Drop-Session, keine Kopie.
  if (droppedFiles.length && droppedFiles.every(d => d.nativePath)) {
    const paths = droppedFiles.map(d => d.nativePath);
    if (onProgress) {
      droppedFiles.forEach((d, i) =>
        onProgress(i + 1, droppedFiles.length,
                   String(d.relPath || "").replace(/.*[\\/]/, "")));
    }
    return paths;
  }
  const ses = await api().drop_session_start();
  if (!ses.ok) throw new Error("Drop-Session fehlgeschlagen");
  const paths = [];
  for (let i = 0; i < droppedFiles.length; i++) {
    const { file, relPath, nativePath } = droppedFiles[i];
    // Slashes in Namen → Unterordner würden Python anlegen müssen. Wir flatten
    // zur Sicherheit und ersetzen / durch _.
    const safeName = String(relPath).replace(/[\\/]/g, "_");
    if (nativePath) {
      paths.push(nativePath);                    // Original in-place
    } else if (kind === "text") {
      const text = await fileToText(file);
      const r = await api().drop_save_text_file(ses.session_id, safeName, text);
      if (!r.ok) throw new Error(r.error || "Save Text fehl");
      paths.push(r.path);
    } else {
      const b64 = await fileToBase64(file);
      const r = await api().drop_save_file(ses.session_id, safeName, b64);
      if (!r.ok) throw new Error(r.error || "Save fehl");
      paths.push(r.path);
    }
    if (onProgress) onProgress(i + 1, droppedFiles.length, safeName);
  }
  return paths;
}

// ── v0.9.67 — Generischer Undo/Redo-Controller ──────────────────────────────
//
// Jedes Modul (Animator, Tour-Map, Geotagger) holt sich seinen eigenen
// Controller mit:
//   ctrl = createUndoController({
//     snapshot: () => ({...state}),
//     apply:    (state) => { /* DOM/Project nachziehen */ },
//     toast:    (msg) => toast(msg, "info", 1000),  // optional
//   });
//
// Mutations-Stellen rufen `ctrl.push("Label", {force?})` BEVOR sie das Projekt
// mutieren. Bei kontinuierlichen Edits (Drag) blockt der 800ms-Throttle alle
// bis auf den ersten Push pro „Edit-Session". Discrete Aktionen (Click, Delete)
// nutzen `{force: true}` und pushen immer.
//
// Globaler Keyboard-Listener weiter unten routet Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z
// zum aktiven Modul. Modul-Detection via `data-module`-Attribut auf dem
// sichtbaren Panel (Animator/Tour-Map/Geotagger).
//
// Stack-Größe 50 Schritte (= Photoshop-Default, solider Standard für
// Creative-Tools).
window.createUndoController = function(opts) {
  opts = opts || {};
  const MAX = opts.max || 50;
  const THROTTLE_MS = opts.throttleMs ?? 800;
  let undoStack = [];
  let redoStack = [];
  let lastSnapAt = 0;
  let isApplying = false;  // Reentrancy-Guard: während apply() KEINE Pushes
  function pushSnap(label, options) {
    if (isApplying) return;
    options = options || {};
    const now = performance.now();
    if (!options.force && now - lastSnapAt < THROTTLE_MS) return;
    // v0.9.322 — `options.state` erlaubt es, einen explizit VORHER erfassten Zustand
    // zu pushen (DOM-Snapshot-Controller: Wert ist beim input-Event schon geändert).
    const snap = (options.state !== undefined && options.state !== null)
      ? options.state
      : (opts.snapshot ? opts.snapshot() : null);
    if (snap == null) return;
    const top = undoStack[undoStack.length - 1];
    try {
      if (top && JSON.stringify(top.state) === JSON.stringify(snap)) return;
    } catch (_) { /* zyklische Daten unwahrscheinlich, ignorieren */ }
    undoStack.push({ label: label || "Bearbeitung", state: snap });
    if (undoStack.length > MAX) undoStack.shift();
    redoStack = [];
    lastSnapAt = now;
  }
  function _runApply(state) {
    if (!opts.apply) return;
    isApplying = true;
    // v0.9.322 — globaler Flag, damit rebindAllSettings den Undo-Stack NICHT
    // zurücksetzt, während ein Undo/Redo gerade angewendet wird (nur echte
    // Projekt-Wechsel sollen resetten).
    window.__rzUndoApplying = true;
    try { opts.apply(state); }
    finally {
      // Mikrotask-Delay, damit auch async-dispatched input-Events während
      // apply() den Guard noch sehen (input-Events laufen synchron im selben
      // Task, aber Defensive ist günstig).
      setTimeout(() => { isApplying = false; window.__rzUndoApplying = false; }, 0);
    }
  }
  function undo() {
    if (undoStack.length === 0) {
      if (opts.toast) opts.toast(t("undo.nothing_undo", "Nichts zum Rückgängig"));
      return false;
    }
    const current = opts.snapshot ? opts.snapshot() : null;
    const prev = undoStack.pop();
    if (current != null) redoStack.push({ label: prev.label, state: current });
    _runApply(prev.state);
    if (opts.toast) opts.toast("↶ " + (prev.label || t("undo.undo", "Rückgängig")));
    return true;
  }
  function redo() {
    if (redoStack.length === 0) {
      if (opts.toast) opts.toast(t("undo.nothing_redo", "Nichts zum Wiederherstellen"));
      return false;
    }
    const current = opts.snapshot ? opts.snapshot() : null;
    const next = redoStack.pop();
    if (current != null) undoStack.push({ label: next.label, state: current });
    _runApply(next.state);
    if (opts.toast) opts.toast("↷ " + (next.label || t("undo.redo", "Wiederherstellen")));
    return true;
  }
  function reset() {
    undoStack = [];
    redoStack = [];
    lastSnapAt = 0;
  }
  return {
    push: pushSnap,
    undo, redo, reset,
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    _stackSize: () => undoStack.length,
  };
};

// v0.9.322 — Universeller DOM-Snapshot-Undo-Controller für Module, die ihre
// Einstellungen NICHT über bindSetting/Settings-Dict führen, sondern direkt in den
// Controls halten (z.B. Geotagger, Höhen-Animator). Snapshot = alle input/select/
// textarea-Werte im Panel; apply = Werte zurücksetzen + native Events feuern, damit
// die modul-eigenen input/change-Listener (Neu-Zeichnen, Neuberechnen) anspringen.
//   opts.after(snap)  — optionaler Callback nach dem Restore (z.B. Redraw erzwingen)
window.__rzPanelUndoSections = window.__rzPanelUndoSections || new Set();
window.rzMakePanelUndoController = function (panelId, opts) {
  opts = opts || {};
  // Sektion als „panel-verwaltet" markieren → der bindSetting-Hook pusht für diese
  // Sektion NICHT zusätzlich (sonst Doppel-Push pre+post → Undo daneben).
  if (opts.section) window.__rzPanelUndoSections.add(opts.section);
  const readControls = () => {
    const root = document.getElementById(panelId);
    if (!root) return null;
    const o = {};
    root.querySelectorAll("input, select, textarea").forEach(el => {
      if (!el.id) return;
      o[el.id] = (el.type === "checkbox" || el.type === "radio") ? !!el.checked : el.value;
    });
    return o;
  };
  // v0.9.359 — optionaler Zusatz-Zustand (JS-State, der NICHT in DOM-Controls liegt,
  // z.B. Geotagger: manuelle Pin-Platzierungen, EXIF-Edits, Adressen, Häkchen …).
  // Rückwärtskompatibel: ohne `extraSnapshot` bleibt der Snapshot das flache
  // Controls-Objekt (Animator/Tour-Map/Inspektor unverändert).
  const _hasExtra = typeof opts.extraSnapshot === "function";
  const fullSnap = () => {
    const c = readControls();
    if (!_hasExtra) return c;
    let x = null;
    try { x = opts.extraSnapshot(); } catch (_) { x = null; }
    return { __rzc: c, __rzx: x };
  };
  const ctrl = window.createUndoController({
    snapshot: fullSnap,
    apply: (snap) => {
      if (!snap) return;
      const ctrlSnap = (_hasExtra && snap && snap.__rzc !== undefined) ? snap.__rzc : snap;
      if (ctrlSnap) Object.keys(ctrlSnap).forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if (el.type === "checkbox" || el.type === "radio") {
          if (el.checked !== ctrlSnap[id]) { el.checked = ctrlSnap[id]; el.dispatchEvent(new Event("change", { bubbles: true })); }
        } else if (el.value !== String(ctrlSnap[id])) {
          el.value = String(ctrlSnap[id]);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
      if (_hasExtra && snap && snap.__rzx !== undefined && typeof opts.extraApply === "function") {
        try { opts.extraApply(snap.__rzx); } catch (_) {}
      }
      _prev = fullSnap();  // neue Baseline nach Undo/Redo
      if (opts.after) { try { opts.after(snap); } catch (_) {} }
    },
    toast: opts.toast,
    throttleMs: opts.throttleMs,
  });
  /** Beschriftung für den Rückgängig-Balken zu einem Bedienelement.
   *
   *  ⚠️ Zweierlei war hier falsch (v0.9.508, beim Test in spanischer
   *  Oberfläche aufgefallen): der Text war fest deutsch („… geändert"), und er
   *  zeigte die technische Element-Kennung statt eines Namens — im Balken stand
   *  „gt-ignore-gps geändert". Jetzt wird die sichtbare Beschriftung des
   *  Elements gesucht; sie ist ohnehin schon übersetzt.
   */
  function _undoNameFuer(el) {
    const putzen = (x) => String(x || "").replace(/\s+/g, " ").trim().replace(/[:：]$/, "");
    // ⚠️ Beschriftungen enthalten oft einen Hilfe-Knopf („?") und den aktuellen
    // Wert („40°") — beides gehört nicht in den Rückgängig-Balken. Deshalb an
    // einer Kopie arbeiten und diese Teile vorher entfernen.
    const textOhneBeiwerk = (node) => {
      if (!node) return "";
      const klon = node.cloneNode(true);
      // ⚠️ `[class*="help"]` statt einer Liste einzelner Klassen: die
      // Hilfe-Marker heißen je Modul anders (`field-help`, `gt-help`,
      // `ov-help`, `rz-help`, `gpxi-stat-help`) — eine Aufzählung wäre schon
      // beim nächsten Modul unvollständig.
      klon.querySelectorAll('button, [class*="help"], .label-val, input, select, textarea')
          .forEach(x => x.remove());
      return putzen(klon.textContent);
    };
    let name = "";
    if (el) {
      const eigen = el.getAttribute && (el.getAttribute("aria-label") || el.getAttribute("title"));
      const zuId = el.id && document.querySelector(`label[for="${el.id}"]`);
      const umhuellt = el.closest && el.closest("label");
      const feld = el.closest && el.closest(".field");
      name = putzen(eigen)
          || textOhneBeiwerk(zuId)
          || textOhneBeiwerk(umhuellt)
          || textOhneBeiwerk(feld && feld.querySelector(".field-label"));
      // Bei umschließenden Labels klebt oft der Wert mit dran („Neigung 40°").
      if (name.length > 34) name = name.slice(0, 33).trimEnd() + "…";
    }
    if (!name) name = t("undo.wert", "Wert");
    return t("undo.x_geaendert", "{name} geändert").replace("{name}", name);
  }

  // Pre-Change-Erfassung: Beim input/change-Event ist der Wert SCHON geändert.
  // Deshalb erfassen wir den Zustand VOR der Änderung bei pointerdown/focusin/keydown
  // und pushen ihn beim input/change. `_prev` = letzter committeter Stand.
  let _prev = null;
  const _capture = () => { _prev = fullSnap(); };
  const _push = (ev, discrete) => {
    const tgt = ev.target;
    if (!tgt || !tgt.id || tgt.closest("#" + panelId) == null) return;
    const force = discrete || (window.__rzLastUndoEl !== tgt.id);
    ctrl.push(_undoNameFuer(tgt), { force, state: _prev });
    window.__rzLastUndoEl = tgt.id;
    _prev = fullSnap();  // ab jetzt ist DAS der „Vorher"-Stand für die nächste Änderung
  };
  function _wire() {
    const root = document.getElementById(panelId);
    if (!root) return false;
    if (root.dataset.rzPanelUndo === "1") return true;
    root.dataset.rzPanelUndo = "1";
    ["pointerdown", "focusin", "keydown"].forEach(evt =>
      root.addEventListener(evt, _capture, true));  // capture-Phase: VOR der Wertänderung
    root.addEventListener("input", (ev) => {
      // v0.9.394 — Checkbox/Radio feuern input UND change fast gleichzeitig; ein
      // Push auf beiden speichert den NACHHER-Zustand als 2. Eintrag → erstes Undo
      // wäre ein No-Op. Sie committen ausschließlich über 'change'.
      const ty = (ev.target && ev.target.type || "").toLowerCase();
      if (ty === "checkbox" || ty === "radio") return;
      _push(ev, false);
    });
    root.addEventListener("change", (ev) => {
      const ty = (ev.target && ev.target.type || "").toLowerCase();
      const tag = (ev.target && ev.target.tagName || "").toLowerCase();
      _push(ev, tag === "select" || ty === "checkbox" || ty === "radio");
    });
    _prev = fullSnap();  // Baseline
    return true;
  }
  // Panel ist evtl. noch nicht im DOM (Controller wird vor body.innerHTML erstellt) →
  // dann das Verdrahten per rAF nachholen, sobald das Panel da ist.
  if (!_wire()) {
    let _tries = 0;
    const _retry = () => { if (_wire() || ++_tries > 60) return; requestAnimationFrame(_retry); };
    requestAnimationFrame(_retry);
  }
  return ctrl;
};

// Modul-Registry: jedes Modul registriert seinen Controller hier beim Mount.
// Globaler Keyboard-Listener routet Cmd/Ctrl+Z zum aktiven Modul.
window.__rzUndoControllers = window.__rzUndoControllers || {};

function _rzActiveModuleForUndo() {
  // Modul-Panel-IDs in Reihenfolge prüfen — das erste mit offsetParent gewinnt.
  const candidates = [
    ["anim-panel", "animator"],
    ["tmap-panel", "tourmap"],
    ["gt-panel",   "geotagger"],
    ["gpxi-panel", "gpxinspect"],  // v0.9.238 — GPX-Inspektor (Track-Edits undoable)
    ["height-panel", "heightanim"],  // v0.9.322 — Höhen-Animator (Einstellungen undoable)
    ["lib-panel",  "library"],       // 28.08.2026 — Archiv (Sammlungs-Aktionen undoable)
  ];
  for (const [id, key] of candidates) {
    const el = document.getElementById(id);
    if (el && el.offsetParent) return key;
  }
  return null;
}

window.addEventListener("keydown", (e) => {
  const meta = e.metaKey || e.ctrlKey;
  if (!meta) return;
  const k = (e.key || "").toLowerCase();
  if (k !== "z" && k !== "y") return;
  const mod = _rzActiveModuleForUndo();
  if (!mod) return;
  const ctrl = window.__rzUndoControllers[mod];
  if (!ctrl) return;
  const wantRedo = (k === "y") || (k === "z" && e.shiftKey);
  e.preventDefault();
  if (wantRedo) ctrl.redo(); else ctrl.undo();
}, true);  // capture-phase damit Slider-Inputs den Shortcut nicht abfangen

// v0.9.112 — Click auf Slider-Wert-Label → editierbares Eingabefeld.
// Marc-Spec: „bei den slidern auch antippen und was reintippen können"
// (z.B. Welt-Drehung 720 für 2 volle Drehungen, auch ausserhalb der
// Slider-Range). Globaler Listener auf `.label-val`-Spans: erstes Click
// → in `<input type=number>` umwandeln; Enter/Blur → Wert speichern,
// auf den dazugehörigen Slider anwenden (gleiches `<label>`-Parent),
// `input`+`change` Events feuern.
//
// Wenn der eingegebene Wert ausserhalb [slider.min, slider.max] liegt:
// der Slider clampt visuell, aber wir speichern den ECHTEN Wert als
// `dataset.userValue` — dispatch ein Custom-Event `slider-label-edit`
// damit Caller mit dem ungeclampten Wert weiterarbeiten kann.
document.addEventListener("click", (e) => {
  const lbl = e.target.closest(".label-val");
  if (!lbl) return;
  if (lbl.querySelector("input")) return;  // schon im Edit-Modus
  // Slider finden — der `<input type=range>` ist Geschwister vom
  // `<label>` (nicht Kind), also via:
  //  (1) ID-Heuristik: label-id "xxx-v" → slider-id "xxx"
  //  (2) Fallback: nächster Range-Input im umgebenden .field/.row-Container
  let slider = null;
  if (lbl.id) {
    const sliderId = lbl.id.replace(/[-_]v$/, "");
    if (sliderId !== lbl.id) slider = document.getElementById(sliderId);
  }
  if (!slider) {
    const wrap = lbl.closest(".field, [data-prop], .row-2, .row-3, fieldset, label")
              || lbl.parentElement?.parentElement
              || lbl.parentElement;
    if (wrap) slider = wrap.querySelector("input[type=range]");
  }
  if (!slider) return;
  e.preventDefault();
  e.stopPropagation();
  // Aktuellen Wert aus Slider lesen. Wenn `dataset.userValue` gesetzt
  // (= ungeclampter Override vom letzten Label-Edit / Restore), den
  // bevorzugen — sonst sieht User beim Re-Edit nicht seinen vorher
  // eingegebenen 1440-Wert, sondern den geclampten 720-Wert.
  let curVal;
  if (slider.dataset.userValue != null && slider.dataset.userValue !== "") {
    curVal = parseFloat(slider.dataset.userValue);
  } else {
    curVal = parseFloat(slider.value);
  }
  if (!Number.isFinite(curVal)) return;
  // Original-Label-Inhalt für Wiederherstellung
  const origText = lbl.textContent;
  // Input-Element bauen
  const input = document.createElement("input");
  input.type = "number";
  input.value = String(curVal);
  // Step vom Slider übernehmen für Inkrement
  if (slider.step) input.step = slider.step;
  input.className = "label-val-edit";
  input.style.cssText = "width: 4.5em; font-size: inherit; font-family: inherit; "
                     + "background: rgba(255,255,255,0.08); border: 1px solid #ff6b35; "
                     + "border-radius: 3px; padding: 1px 4px; color: inherit; "
                     + "text-align: right; -moz-appearance: textfield;";
  lbl.textContent = "";
  lbl.appendChild(input);
  input.focus();
  input.select();
  let _committed = false;
  function commit() {
    if (_committed) return;
    _committed = true;
    const v = parseFloat(input.value);
    if (!Number.isFinite(v)) {
      lbl.textContent = origText;
      return;
    }
    // Slider auf den (geclampten) Wert setzen
    const lo = parseFloat(slider.min);
    const hi = parseFloat(slider.max);
    const clamped = Math.max(isNaN(lo) ? -Infinity : lo,
                              Math.min(isNaN(hi) ? Infinity : hi, v));
    slider.value = String(clamped);
    // Echten User-Wert für Caller speichern (= ungeclampt)
    slider.dataset.userValue = String(v);
    // Standard-Events dispatchen damit alle bindSetting/onChange-Hooks greifen
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    slider.dispatchEvent(new Event("change", { bubbles: true }));
    // Custom-Event für Caller die wissen wollen ob der Wert ausserhalb der
    // Range lag (z.B. Welt-Drehung 720 = 2 Umdrehungen)
    slider.dispatchEvent(new CustomEvent("slider-label-edit", {
      bubbles: true,
      detail: { value: v, clamped: clamped, wasOutOfRange: v !== clamped },
    }));
  }
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (ke) => {
    if (ke.key === "Enter") { ke.preventDefault(); commit(); input.blur(); }
    else if (ke.key === "Escape") {
      _committed = true;
      lbl.textContent = origText;
      input.blur();
    }
  });
});

// v0.9.114 — Wenn der User den Slider physisch zieht, dataset.userValue
// löschen damit der slider.value wieder als „Wahrheit" greift. Nur
// echte User-Events (e.isTrusted=true) — synthetische Events vom
// Label-Edit haben isTrusted=false und dürfen userValue nicht killen.
document.addEventListener("input", (e) => {
  const t = e.target;
  if (!t || t.tagName !== "INPUT" || t.type !== "range") return;
  if (!e.isTrusted) return;
  if (t.dataset.userValue != null) delete t.dataset.userValue;
}, true);

// v0.9.87 — Slider-Doppelklick = Reset auf Default-Wert (HTML `value`-Attribut).
// Marc-Spec: einheitliches UX-Pattern für alle Range-Slider in der App.
// dispatch input+change → alle bindSetting/onChange-Listener triggern wie
// bei manuellem Slider-Move.
document.addEventListener("dblclick", (e) => {
  const t = e.target;
  if (!t || t.tagName !== "INPUT" || t.type !== "range") return;
  // defaultValue ist das HTML-`value`-Attribut zum Mount-Zeitpunkt.
  // Falls leer (sollte nicht vorkommen): mid-point aus min/max nehmen.
  let dv = t.defaultValue;
  if (dv == null || dv === "") {
    const lo = parseFloat(t.min);
    const hi = parseFloat(t.max);
    if (!isNaN(lo) && !isNaN(hi)) dv = String((lo + hi) / 2);
    else return;
  }
  if (t.value === dv) return;  // bereits Default → kein Repaint nötig
  t.value = dv;
  // Beide Events feuern, damit:
  //   input  → Live-Updates (Label, Map-Preview)
  //   change → Persistierung über bindSetting
  t.dispatchEvent(new Event("input", { bubbles: true }));
  t.dispatchEvent(new Event("change", { bubbles: true }));
  e.preventDefault();
});

// ── v0.9.229 — Shared Render-Engine-Guard (Windows-Bug-Report eines Nutzers) ──
// Render (Animator / Tour-Map / Höhen-Animator) braucht Playwright-Chromium.
// Seit v0.9.229 ist der Browser MIT-GEBÜNDELT → dieser Fall tritt für normale
// User praktisch nicht mehr auf. Bleibt als Sicherheitsnetz (korruptes/fehlendes
// Bundle, Dev-Build) und behebt den alten Bug, dass NUR der Animator ein
// Download-Modal hatte und Tour-Map/Höhe nur einen verwirrenden Toast zeigten.
// EIN gemeinsamer Code-Pfad → kann nicht mehr divergieren.
//   browsersPath: Anzeige-Pfad (aus dem Render-Ergebnis `browsers_path`)
//   onSuccess:    Callback nach erfolgreichem Install (= Render-Retry des Aufrufers)
function showRenderEngineMissingModal(browsersPath, onSuccess) {
  const escapeHtml = (s) => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  openModal({
    title: t("animator.playwright_missing.title"),
    body: `
      <p style="margin:0 0 10px 0;">${t("animator.playwright_missing.body")}</p>
      <p class="muted" style="margin:0 0 12px 0; font-size:11.5px; line-height:1.5;">
        ${t("animator.playwright_missing.body2")}
      </p>
      <p class="muted" style="margin:0; font-size:11px; font-family:ui-monospace,Menlo,monospace; word-break:break-all;">
        ${escapeHtml(browsersPath || "")}
      </p>
      <div id="md-pwm-progress" hidden style="margin-top:14px;">
        <div class="muted" id="md-pwm-status" style="font-size:12px; margin-bottom:6px;">
          ${t("animator.playwright_missing.installing")}
        </div>
        <div class="progress-bar" style="height:6px; background:var(--bg-3); border-radius:3px; overflow:hidden;">
          <div class="progress-bar-indeterminate" style="width:40%; height:100%; background:var(--accent); animation: rzgps-indet 1.4s ease-in-out infinite;"></div>
        </div>
      </div>
      <style>
        @keyframes rzgps-indet {
          0%   { transform: translateX(-100%); }
          50%  { transform: translateX(150%); }
          100% { transform: translateX(250%); }
        }
      </style>
    `,
    footer: `
      <button class="btn" id="md-pwm-cancel">${t("common.cancel")}</button>
      <button class="btn btn-primary" id="md-pwm-install">${t("animator.playwright_missing.btn.install")}</button>
    `,
  });
  document.getElementById("md-pwm-cancel").onclick = () => openModal({}).close();
  document.getElementById("md-pwm-install").onclick = async () => {
    const btn = document.getElementById("md-pwm-install");
    const cancel = document.getElementById("md-pwm-cancel");
    const prog = document.getElementById("md-pwm-progress");
    btn.disabled = true; cancel.disabled = true;
    btn.textContent = t("animator.playwright_missing.installing");
    prog.hidden = false;
    const r = await api().playwright_install_chromium();
    if (r.ok) {
      toast(t("animator.playwright_missing.success"), "success", 4000);
      openModal({}).close();
      if (typeof onSuccess === "function") onSuccess();
    } else {
      btn.disabled = false; cancel.disabled = false;
      btn.textContent = t("animator.playwright_missing.btn.install");
      prog.hidden = true;
      toast(t("animator.playwright_missing.failed") + ": " + (r.error || ""), "error", 8000);
    }
  };
}

// v0.9.365 — Eigener Hilfe-Tooltip für die „?"-Badges (.gt-help) und alle Elemente
// mit [data-help]. Grund: pywebview/WKWebView zeigt native HTML-`title`-Tooltips
// NICHT an → die ganzen Hilfetexte kamen nie. Dieser schwebende Tooltip hängt am
// <body> (position:fixed, hoher z-index) und wird daher nicht von der Sidebar
// (overflow) abgeschnitten. Liest den Text aus `data-tip`/`title`/`aria-label`,
// verschiebt `title` einmalig nach `data-tip` (killt den toten nativen Tooltip).
(function rzHelpTooltip() {
  if (window.__rzHelpTipInit) return;
  window.__rzHelpTipInit = true;
  let tip = null;
  const SEL = ".gt-help, [data-help]";
  function ensure() {
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "rz-tip";
      tip.setAttribute("role", "tooltip");
      document.body.appendChild(tip);
    }
    return tip;
  }
  function textFor(el) {
    if (el.hasAttribute("title")) {           // einmalig umziehen → kein nativer (toter) Tooltip
      const t = el.getAttribute("title");
      if (t) el.setAttribute("data-tip", t);
      el.removeAttribute("title");
    }
    return el.getAttribute("data-tip") || el.getAttribute("data-help") || el.getAttribute("aria-label") || "";
  }
  function show(el) {
    const txt = textFor(el);
    if (!txt) return;
    const tEl = ensure();
    tEl.textContent = txt;
    tEl.style.display = "block";
    tEl.style.left = "-9999px";
    tEl.style.top = "0px";
    const r = el.getBoundingClientRect();
    const tw = tEl.offsetWidth, th = tEl.offsetHeight, pad = 8, m = 6;
    let left = r.left - tw - pad;                 // bevorzugt links (Sidebar ist links)
    if (left < m) left = r.right + pad;           // sonst rechts daneben
    if (left + tw > window.innerWidth - m) left = window.innerWidth - tw - m;
    if (left < m) left = m;
    let top = r.top + r.height / 2 - th / 2;
    if (top < m) top = m;
    if (top + th > window.innerHeight - m) top = window.innerHeight - th - m;
    tEl.style.left = left + "px";
    tEl.style.top = top + "px";
  }
  function hide() { if (tip) tip.style.display = "none"; }
  function near(e) { return (e.target && e.target.closest) ? e.target.closest(SEL) : null; }
  document.addEventListener("mouseover", (e) => { const el = near(e); if (el) show(el); });
  document.addEventListener("mouseout",  (e) => { if (near(e)) hide(); });
  document.addEventListener("focusin",   (e) => { const el = near(e); if (el) show(el); });
  document.addEventListener("focusout",  hide);
  window.addEventListener("scroll", hide, true);
  window.addEventListener("resize", hide);
})();

// ── v0.9.522 — Warte-Zustand sichtbar machen (alle Module) ─────────────────
// Marc-Regel vom 21.08.2026: JEDER Klick, hinter dem mehr als ein
// Wimpernschlag Arbeit stecken kann, sperrt seinen Knopf und sagt, was
// gerade passiert. Entstanden beim 20.000-Fotos-Test: Ordner-Scan und
// Schreib-Prüfung liefen bis zu einer Minute ohne Feedback, die Knöpfe
// blieben aktiv, und wiederholtes Klicken erzeugte Doppel-Flows.
//
//   const frei = knopfBeschaeftigt("mein-knopf", "modul.busy.x", "Rechne …");
//   if (!frei) return;              // läuft schon
//   await malPause();               // gesperrten Zustand malen lassen
//   try { … } finally { frei(); }
function knopfBeschaeftigt(id, textKey, textFallback) {
  const b = document.getElementById(id);
  if (!b || b.disabled) return null;
  const alt = b.innerHTML;
  b.disabled = true;
  b.innerHTML = "⏳ " + (typeof t === "function" ? t(textKey, textFallback) : textFallback);
  return () => { try { b.disabled = false; b.innerHTML = alt; } catch (_) {} };
}

/** Kurz ans DOM abgeben, damit der gesperrte Knopf auch GEMALT wird, bevor
 *  schwere Arbeit den Thread blockiert. */
function malPause() { return new Promise(r => setTimeout(r, 30)); }

// ── Höhenmeter — EINE Rechnung für die ganze App ─────────────────────────────
// 02.09.2026, Audit-Befund: Archiv, Inspektor und Höhen-Animator zeigten für
// dieselbe Tour drei verschiedene Zahlen. Das Archiv rechnete (richtig)
// geglättet mit 3-m-Schwelle je Etappe, der Inspektor summierte JEDEN
// positiven Höhenunterschied — bei GPS-Rauschen von ±5–10 m pro Punkt kommt
// dabei ein Vielfaches heraus. Wer beide Fenster offen hatte, musste die App
// für kaputt halten; welche Zahl stimmt, war nicht erkennbar.
//
// Diese Funktion ist die JS-Fassung von `core/gpx._compute_ascent_descent`
// samt Etappen-Trennung aus `parse_gpx`. Sie ist die einzige Stelle, an der
// die Oberfläche Höhenmeter rechnet. **Wer sie ändert, ändert core/gpx.py
// mit** — sonst laufen die Zahlen wieder auseinander.
function hoehenmeterAusReihe(eles, fenster, schwelle) {
  const win = Math.max(1, fenster == null ? 5 : fenster);
  const th = schwelle == null ? 3.0 : schwelle;
  if (!eles || eles.length < 2) return { asc: 0, desc: 0 };
  // Punkte OHNE Höhe bekommen den letzten gültigen Wert (wie Python) — sie
  // fallen nicht heraus, sonst verschiebt sich die Glättung.
  let letzte = null;
  const rein = eles.map(e => {
    if (e != null && isFinite(e)) letzte = +e;
    return letzte == null ? 0 : letzte;
  });
  if (rein.every(v => v === 0)) return { asc: 0, desc: 0 };
  const halb = win >> 1;
  const glatt = (win > 1 && rein.length >= win) ? rein.map((_, i) => {
    const lo = Math.max(0, i - halb), hi = Math.min(rein.length, i + halb + 1);
    let s = 0;
    for (let k = lo; k < hi; k++) s += rein[k];
    return s / (hi - lo);
  }) : rein.slice();
  let asc = 0, desc = 0, ref = glatt[0];
  for (let i = 1; i < glatt.length; i++) {
    const dz = glatt[i] - ref;
    if (dz >= th) { asc += dz; ref = glatt[i]; }
    else if (dz <= -th) { desc += -dz; ref = glatt[i]; }
  }
  return { asc, desc };
}

/** Höhenmeter einer Punktliste [{ele, seg}] — je Etappe getrennt, weil der
 *  Höhenunterschied zwischen dem Ende einer Etappe und dem Start der nächsten
 *  (anderes Tal!) kein Anstieg ist. Genau wie `core/gpx.parse_gpx`. */
function hoehenmeter(points) {
  let asc = 0, desc = 0, start = 0;
  const n = (points || []).length;
  for (let i = 1; i <= n; i++) {
    const grenze = (i === n) || ((points[i].seg || 0) !== (points[start].seg || 0));
    if (!grenze) continue;
    const r = hoehenmeterAusReihe(points.slice(start, i).map(p => p.ele));
    asc += r.asc; desc += r.desc;
    start = i;
  }
  return { asc, desc };
}

// ── Fahrtrichtung des Laufpunkt-Pfeils ──────────────────────────────────────
// 02.09.2026 (Marc: „wenn der laufpunkt ein pfeil ist, muss der geglättet
// werden, sonst springt der wie wild hin und her"): Die Richtung kam aus EINEM
// Wegstück. Bei sekündlicher Aufzeichnung sind das 1–3 m — genau die
// Größenordnung, in der GPS rauscht. Der Pfeil zeigte also halb ins Rauschen.
//
// Jetzt: Richtung aus einer Strecke von mindestens `basisM` UND mindestens
// `minPunkte` Punkten, gerechnet als Schwerpunkt der vorderen gegen den der
// hinteren Hälfte (Endpunkt gegen Endpunkt würde das volle Rauschen der beiden
// äußersten Punkte tragen). Ohne Gedächtnis über Bilder hinweg — dasselbe Bild
// sieht in Vorschau und Render gleich aus.
//
// ⚠️ Die Render-Seite hat eine eigene Kopie (`__rzKurs` in core/animator.py),
// weil die erzeugte Seite util.js nicht lädt. Bei Änderungen BEIDE pflegen.
function kursPeilung(a, b) {
  const rad = Math.PI / 180;
  const dLon = (b[0] - a[0]) * rad;
  const y = Math.sin(dLon) * Math.cos(b[1] * rad);
  const x = Math.cos(a[1] * rad) * Math.sin(b[1] * rad)
          - Math.sin(a[1] * rad) * Math.cos(b[1] * rad) * Math.cos(dLon);
  return (Math.atan2(y, x) / rad + 360) % 360;
}
function kursMeter(a, b) {
  const rad = Math.PI / 180, R = 6371000;
  return Math.hypot((b[1] - a[1]) * rad,
                    (b[0] - a[0]) * rad * Math.cos((a[1] + b[1]) / 2 * rad)) * R;
}
/** Regler 0–10 → (Basislänge in Metern, Mindestzahl Punkte). */
function kursGlaettung(stufe) {
  const v = Math.max(0, Math.min(10, +stufe || 0));
  const basis = 10 + v * 10;                   // 0 → 10 m, 5 → 60 m, 10 → 110 m
  return { basisM: basis, minPunkte: Math.max(2, Math.round(basis / 3)) };
}
function kursAusSpur(coords, i, basisM, minPunkte) {
  const n = coords ? coords.length : 0;
  if (n < 2) return 0;
  const BAS = basisM == null ? 60 : basisM;
  const MINP = minPunkte == null ? 20 : minPunkte;
  const mitte = Math.max(0, Math.min(n - 1, i));
  let a = mitte, b = mitte, weg = 0;
  const offen = () => (weg < BAS || (b - a + 1) < MINP);
  while (offen() && (a > 0 || b < n - 1)) {
    if (a > 0) { weg += kursMeter(coords[a - 1], coords[a]); a--; }
    if (offen() && b < n - 1) { weg += kursMeter(coords[b], coords[b + 1]); b++; }
  }
  if (a === b) return 0;
  if (kursMeter(coords[a], coords[b]) < 1 && n > 2) {
    a = Math.max(0, mitte - 25); b = Math.min(n - 1, mitte + 25);
    if (a === b) return 0;
  }
  const m = (a + b) >> 1;
  let x1 = 0, y1 = 0, c1 = 0, x2 = 0, y2 = 0, c2 = 0;
  for (let k = a; k <= m; k++) { x1 += coords[k][0]; y1 += coords[k][1]; c1++; }
  for (let k = m; k <= b; k++) { x2 += coords[k][0]; y2 += coords[k][1]; c2++; }
  if (!c1 || !c2) return kursPeilung(coords[a], coords[b]);
  return kursPeilung([x1 / c1, y1 / c1], [x2 / c2, y2 / c2]);
}
