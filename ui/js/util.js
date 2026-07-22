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
window.addEventListener("error", (ev) => {
  console.error("[JS-Fehler]", ev.error || ev.message, ev);
  try {
    toast("JS-Fehler: " + (ev.message || (ev.error && ev.error.message) || "unbekannt"), "error", 7000);
  } catch (_) {}
});
window.addEventListener("unhandledrejection", (ev) => {
  console.error("[Unhandled Promise]", ev.reason);
  try {
    const msg = (ev.reason && (ev.reason.message || ev.reason.toString())) || "unbekannt";
    toast("Promise-Fehler: " + msg, "error", 7000);
  } catch (_) {}
});

// ── Map-Factory: Mapbox (mit Token) ODER MapLibre+OSM (ohne Token) ─────────
//
// Die Wahl der Engine wird beim Map-Erzeugen einmal festgelegt. Wenn ein
// Token gesetzt ist → Mapbox GL JS mit allen Premium-Features (Satellite,
// 3D-Terrain). Wenn nicht → MapLibre GL JS mit OpenStreetMap-Raster-Tiles.

const OSM_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

const OSM_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: [OSM_TILE_URL],
      tileSize: 256,
      // v0.9.359 (Bug schwarze Karte): Source-maxzoom = letzte verfügbare Kachel-
      // Ebene. Darüber SKALIERT MapLibre die letzte Kachel (Overzoom) statt eine
      // nicht-existente {z}-Kachel anzufordern → kein schwarzes Loch mehr.
      maxzoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    },
  },
  layers: [
    // KEIN Layer-maxzoom: vorher 19 == Map-maxZoom → bei Vollzoom verschwand der
    // Kachel-Layer (Layer-maxzoom ist exklusiv) → schwarz. Layer rendert jetzt
    // immer; die Source overzoomt sauber.
    { id: "osm-tiles", type: "raster", source: "osm", minzoom: 0 },
  ],
};

// v0.9.406 — Katalog wählbarer OSM-Raster-Stile für die Tour-Map (WYSIWYG-
// Vorschau + interaktiver HTML-Export). Anders als der Animator (Mapbox-only)
// darf die Tour-Map OSM-Stile anbieten, AUCH wenn ein Mapbox-Token gesetzt ist.
// SYNCHRON zu core/tourmap_html.py OSM_TILE_STYLES — bei Änderung beide pflegen.
const RZ_OSM_TILE_STYLES = {
  osm:          { label: "OpenStreetMap", url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",                sub: [],               max: 19, attr: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' },
  topo:         { label: "OpenTopoMap",   url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",              sub: ["a","b","c"],    max: 17, attr: 'Kartendaten: © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende, SRTM | © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)' },
  cyclosm:      { label: "CyclOSM",       url: "https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png", sub: ["a","b","c"], max: 20, attr: '© <a href="https://www.cyclosm.org/">CyclOSM</a> | © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' },
  humanitarian: { label: "Humanitarian",  url: "https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",         sub: ["a","b","c"],    max: 20, attr: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> | Tiles: <a href="https://www.hotosm.org/">HOT</a>' },
};

/**
 * Baut ein GL-Style-8-Objekt (raster) für einen OSM-Stil. Funktioniert mit
 * mapboxgl UND maplibregl — beide rendern Raster-Sources aus Tile-URLs. Das
 * {s}-Subdomain-Token (Leaflet-Syntax) wird zu mehreren tiles-URLs expandiert,
 * weil GL kein {s} kennt.
 */
function osmRasterStyle(id) {
  const s = RZ_OSM_TILE_STYLES[id] || RZ_OSM_TILE_STYLES.osm;
  const urls = (s.sub && s.sub.length) ? s.sub.map((d) => s.url.replace("{s}", d)) : [s.url];
  return {
    version: 8,
    sources: { osm: { type: "raster", tiles: urls, tileSize: 256, maxzoom: s.max, attribution: s.attr } },
    layers: [{ id: "osm-tiles", type: "raster", source: "osm", minzoom: 0 }],
  };
}
/** True, wenn `key` ein OSM-Raster-Stil aus RZ_OSM_TILE_STYLES ist. */
function isOsmStyleKey(key) { return !!(key && Object.prototype.hasOwnProperty.call(RZ_OSM_TILE_STYLES, key)); }
window.RZ_OSM_TILE_STYLES = RZ_OSM_TILE_STYLES;
window.osmRasterStyle = osmRasterStyle;
window.isOsmStyleKey = isOsmStyleKey;

/** Liefert den globalen Map-Modus: "mapbox" oder "osm" (kein Token). */
let _mapMode = null;

/** Liefert die aktive Map-GL-Library (mapboxgl oder maplibregl) für Marker/Popup-Konstruktoren. */
function mapLib() {
  return _mapMode === "osm" ? maplibregl : mapboxgl;
}
function getMapMode() { return _mapMode; }
function isOsmMode() { return _mapMode === "osm"; }
function isMapboxMode() { return _mapMode === "mapbox"; }

/**
 * v0.9.249 — Karten-Render-Module (Animator, Reiseroute, Tour-Map) sind
 * Mapbox-only. Im OSM-Modus (kein/ausgeschalteter Token) macht eine Vorschau
 * keinen Sinn → die Karten-Fläche mit einer klaren „Nur mit Mapbox-Token"-
 * Meldung deckend überdecken. `targetEl` muss position:relative sein (die
 * `.canvas`-Section ist das). Gibt true zurück wenn überdeckt (= OSM-Modus).
 */
function osmBlockOverlay(targetEl) {
  if (!targetEl || !isOsmMode()) return false;
  if (targetEl.querySelector(":scope > .osm-block-overlay")) return true;  // schon da
  const ov = document.createElement("div");
  ov.className = "osm-block-overlay";
  ov.innerHTML =
    '<div class="osm-block-card">' +
      '<div class="osm-block-icon">🛰️</div>' +
      '<div class="osm-block-title">' + t("osm_block.title", "Nur mit Mapbox-Token") + '</div>' +
      '<div class="osm-block-body">' + t("osm_block.body", "Dieses Modul braucht einen Mapbox-Token (für Satellit &amp; 3D). Im OSM-Modus ist Vorschau und Export hier deaktiviert.") + '</div>' +
      '<button class="btn btn-primary osm-block-cta">' + t("osm_block.cta", "Einstellungen öffnen") + '</button>' +
    '</div>';
  const cta = ov.querySelector(".osm-block-cta");
  if (cta) cta.addEventListener("click", () => { try { window.openSettingsModal && window.openSettingsModal(); } catch (_) {} });
  targetEl.appendChild(ov);
  return true;
}
window.osmBlockOverlay = osmBlockOverlay;

/**
 * Erzeugt eine Map-Instanz passend zum aktuellen Modus.
 * - opts.container, opts.center, opts.zoom, opts.pitch, opts.bearing, …
 * - opts.mapboxStyle = Mapbox-Style-URL (nur wenn Token da)
 * Returns: { map, engine: "mapbox"|"maplibre" }
 */
function createMap(opts) {
  const token = window._RZGPS_MAPBOX_TOKEN || "";
  if (token && token.startsWith("pk.")) {
    _mapMode = "mapbox";
    mapboxgl.accessToken = token;
    // v0.9.246/274 (Nutzer-Feedback): maxZoom begrenzen, sonst zoomt man bis ins
    // Daten-Nichts (schwarze Fläche), besonders in entlegenen Outdoor-Gebieten
    // wo Satellit-Tiles früh enden. 20 reichte noch nicht (Nutzer bekam weiter
    // Schwarz „einen Tick zu weit"), darum jetzt 18 — verhindert das Void zuverlässig.
    const map = new mapboxgl.Map(Object.assign({
      container: opts.container,
      style: opts.mapboxStyle || "mapbox://styles/mapbox/standard-satellite",
      maxZoom: 18,
    }, opts.common || {}));
    return { map, engine: "mapbox", lib: mapboxgl };
  }
  // OSM-Mode — OSM-Raster-Tiles enden bei z19, darüber wird's leer/schwarz.
  _mapMode = "osm";
  const map = new maplibregl.Map(Object.assign({
    container: opts.container,
    style: OSM_STYLE,
    maxZoom: 19,
  }, opts.common || {}));
  return { map, engine: "maplibre", lib: maplibregl };
}

/** Cached Token vom Backend, damit Map-Factory ohne async funktioniert. */
async function initMapToken() {
  try {
    const tok = await api().get_mapbox_token();
    window._RZGPS_MAPBOX_TOKEN = tok || "";
    _mapMode = (tok && tok.startsWith("pk.")) ? "mapbox" : "osm";
  } catch (_) {
    window._RZGPS_MAPBOX_TOKEN = "";
    _mapMode = "osm";
  }
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
function openModal(options = {}) {
  const overlay = document.getElementById("modal-overlay");
  const titleEl = document.getElementById("modal-title");
  const bodyEl  = document.getElementById("modal-body");
  const footEl  = document.getElementById("modal-footer");
  const closeEl = document.getElementById("modal-close");

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
  overlay.hidden = false;

  function close() {
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
    toast("Bug-Report konnte nicht vorbereitet werden", "error", 4000);
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
function onMapReady(map, cb) {
  if (!map) return;
  const styleReady = map.isStyleLoaded();
  applog("info", `[onMapReady] styleLoaded=${styleReady}`);
  if (styleReady) { try { cb(); } catch (err) { console.warn("onMapReady cb:", err); applog("error", "[onMapReady cb-sync] " + err); } return; }
  map.once("load", () => {
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

  clearTimeout(_projectSaveTimer);
  _projectSaveTimer = setTimeout(() => {
    const toSend = _projectPendingPatch;
    _projectPendingPatch = null;
    const session = _activeSession;
    const project = _activeProject;
    if (!session || !project) return;
    // Schicke jeden Modul-Patch separat — Bridge nimmt module + patch
    Object.entries(toSend).forEach(([mod, modPatch]) => {
      api().session_update_project_settings(session.track_hash, project.id, mod, modPatch)
        .catch(err => console.warn("session_update_project_settings", err));
    });
  }, 200);
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
  if (!_projectRootPendingPatch) _projectRootPendingPatch = {};
  Object.assign(_projectRootPendingPatch, patch);
  clearTimeout(_projectRootSaveTimer);
  _projectRootSaveTimer = setTimeout(() => {
    const toSend = _projectRootPendingPatch;
    _projectRootPendingPatch = null;
    const session = _activeSession;
    const project = _activeProject;
    if (!session || !project) return;
    api().session_update_project_root(session.track_hash, project.id, toSend)
      .catch(err => console.warn("session_update_project_root", err));
  }, 200);
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
      toast("Drop enthielt keine Dateien (WKWebView-Bug?). Versuch File-Picker.", "warn", 6000);
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
      toast("Drop-Fehler: " + (err.message || err), "error");
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
      if (opts.toast) opts.toast("Nichts zum Rückgängig");
      return false;
    }
    const current = opts.snapshot ? opts.snapshot() : null;
    const prev = undoStack.pop();
    if (current != null) redoStack.push({ label: prev.label, state: current });
    _runApply(prev.state);
    if (opts.toast) opts.toast("↶ " + (prev.label || "Rückgängig"));
    return true;
  }
  function redo() {
    if (redoStack.length === 0) {
      if (opts.toast) opts.toast("Nichts zum Wiederherstellen");
      return false;
    }
    const current = opts.snapshot ? opts.snapshot() : null;
    const next = redoStack.pop();
    if (current != null) undoStack.push({ label: next.label, state: current });
    _runApply(next.state);
    if (opts.toast) opts.toast("↷ " + (next.label || "Wiederherstellen"));
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
  // Pre-Change-Erfassung: Beim input/change-Event ist der Wert SCHON geändert.
  // Deshalb erfassen wir den Zustand VOR der Änderung bei pointerdown/focusin/keydown
  // und pushen ihn beim input/change. `_prev` = letzter committeter Stand.
  let _prev = null;
  const _capture = () => { _prev = fullSnap(); };
  const _push = (ev, discrete) => {
    const tgt = ev.target;
    if (!tgt || !tgt.id || tgt.closest("#" + panelId) == null) return;
    const force = discrete || (window.__rzLastUndoEl !== tgt.id);
    ctrl.push((tgt.id || "Wert") + " geändert", { force, state: _prev });
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

// ── v0.9.229 — Shared Render-Engine-Guard (Windows-Bug-Report Peter Straka) ──
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
