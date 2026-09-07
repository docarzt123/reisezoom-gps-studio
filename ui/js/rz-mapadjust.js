/* Reisezoom GPS Studio — Karten-Optik (05.09.2026, Beta-Tester: „kann der
 * Kontrastregler auch auf die anderen zu hellen Karten angepasst werden?").
 * Vorher nur die amtlichen Luftbilder (rz-raster-*). Jetzt:
 *   Raster-Stile (Luftbilder, OSM, OpenTopoMap, …) → raster-*-Paint auf jeder
 *     Ebene, deren Name mit „rz-raster" beginnt (der Blue-Marble-Untergrund
 *     bleibt unberührt).
 *   Vektor-Stile (OpenFreeMap, MapTiler) → Helligkeit über eine Abdunkel-Ebene
 *     (rz-dim) direkt unter Strecke und Overlays. Sättigung/Kontrast/Farbton
 *     gibt es dort nicht (kein Raster).
 * In ui/index.html geladen und in core/animator.py ins Render-HTML eingebettet —
 * eine Quelle, Vorschau und Video gleich. */
(function () {
  const DEF = { sat: 25, con: 8, bri: 0, hue: 0 }, LIM = { sat: 100, con: 100, bri: 100, hue: 180 };
  function norm(adj, def) {
    const out = Object.assign({}, DEF, def || {});
    if (adj && typeof adj === "object") for (const k of Object.keys(out)) { const v = parseFloat(adj[k]); if (isFinite(v)) out[k] = v; }
    for (const k of Object.keys(out)) out[k] = Math.max(-LIM[k], Math.min(LIM[k], out[k]));
    return out;
  }
  function paint(a) {
    const p = {};
    if (a.sat) p["raster-saturation"] = +(a.sat / 100).toFixed(3);
    if (a.con) p["raster-contrast"] = +(a.con / 100).toFixed(3);
    if (a.bri > 0) p["raster-brightness-min"] = +(a.bri / 100 * 0.5).toFixed(3);
    if (a.bri < 0) p["raster-brightness-max"] = +(1 + a.bri / 100 * 0.5).toFixed(3);
    if (a.hue) p["raster-hue-rotate"] = +a.hue.toFixed(1);
    return p;
  }
  const ALL = { "raster-saturation": 0, "raster-contrast": 0, "raster-brightness-min": 0, "raster-brightness-max": 1, "raster-hue-rotate": 0 };
  const WORLD = { type: "Feature", geometry: { type: "Polygon", coordinates: [[[-180, -85.06], [180, -85.06], [180, 85.06], [-180, 85.06], [-180, -85.06]]] } };
  /** Erste eigene Ebene (Strecke, Ghost, Schwarm, Schilder) — die Abdunklung liegt darunter. */
  function firstOwnLayer(layers) {
    for (const l of layers) {
      const id = l.id;
      if (/^(preview-|track|mtrack|schwarm|anim-|ghost|dot-|rz-ov-|rz-north|rz-sign)/.test(id)) return id;
    }
    return undefined;
  }
  /** Live anwenden. `hasRaster` wird aus dem Stil gelesen: Raster → Paint, sonst Abdunkel-Ebene. */
  function applyAdjust(map, adj, def) {
    if (!map || !map.getStyle) return;
    const a = norm(adj, def), p = paint(a);
    let layers = [];
    try { layers = (map.getStyle() || {}).layers || []; } catch (_) { return; }
    let hasRaster = false;
    for (const l of layers) {
      if (l.type !== "raster" || !l.id.startsWith("rz-raster") || l.id === "rz-raster-sentinel") continue;   // Sentinel bleibt natürlich
      hasRaster = true;
      for (const k of Object.keys(ALL)) { try { map.setPaintProperty(l.id, k, (k in p) ? p[k] : ALL[k]); } catch (_) {} }
    }
    const op = hasRaster ? 0 : Math.min(0.85, Math.abs(a.bri) / 100 * 0.8);
    const color = a.bri < 0 ? "#000000" : "#ffffff";
    try {
      if (op <= 0) { if (map.getLayer("rz-dim")) map.removeLayer("rz-dim"); return; }
      if (!map.getSource("rz-dim")) map.addSource("rz-dim", { type: "geojson", data: WORLD });
      if (!map.getLayer("rz-dim")) map.addLayer({ id: "rz-dim", type: "fill", source: "rz-dim", paint: { "fill-color": color, "fill-opacity": op } }, firstOwnLayer(layers));
      else { map.setPaintProperty("rz-dim", "fill-color", color); map.setPaintProperty("rz-dim", "fill-opacity", op); }
    } catch (_) {}
  }
  /* 07.09.2026 (Marc, Teneriffa: „die ganze Insel ist unscharf") — Schärfe 0…100 %.
   * Sentinel-2 (EOX 2016) trägt bei z14 nicht mehr Detail als bei z13 (gemessen), da hilft
   * keine Kacheldichte — nur eine Unschärfemaske: Bild = (1+A)·Original − A·Weichzeichnung.
   * Als SVG-Filter per CSS auf der WebGL-Leinwand: greift in der Vorschau wie im Video
   * (page.screenshot nimmt die gefilterte Leinwand), nicht auf HTML-Overlays (Zahlen,
   * Profil, Quellenzeile). Radius in CSS-Pixeln — das Renderfenster ist in CSS-Pixeln
   * genau die Vorschau, also gleicher Look. Bei 0 kein Filter (keine Kosten). */
  const SHARP_ID = "rz-sharpen", SHARP_MAX_A = 1.5, SHARP_RADIUS = 1.0;
  function sharpNorm(v) { const n = parseFloat(v); return isFinite(n) ? Math.max(0, Math.min(100, n)) : 0; }
  function sharpFilter(doc) {
    let f = doc.getElementById(SHARP_ID);
    if (f) return f;
    const NS = "http://www.w3.org/2000/svg";
    const svg = doc.createElementNS(NS, "svg");
    svg.setAttribute("width", "0"); svg.setAttribute("height", "0"); svg.setAttribute("aria-hidden", "true");
    svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
    f = doc.createElementNS(NS, "filter"); f.setAttribute("id", SHARP_ID); f.setAttribute("color-interpolation-filters", "sRGB");
    f.setAttribute("x", "0"); f.setAttribute("y", "0"); f.setAttribute("width", "100%"); f.setAttribute("height", "100%");
    const b = doc.createElementNS(NS, "feGaussianBlur"); b.setAttribute("in", "SourceGraphic"); b.setAttribute("stdDeviation", String(SHARP_RADIUS)); b.setAttribute("result", "b");
    const c = doc.createElementNS(NS, "feComposite"); c.setAttribute("in", "SourceGraphic"); c.setAttribute("in2", "b"); c.setAttribute("operator", "arithmetic");
    c.setAttribute("k1", "0"); c.setAttribute("k2", "1"); c.setAttribute("k3", "0"); c.setAttribute("k4", "0");
    f.appendChild(b); f.appendChild(c); svg.appendChild(f); (doc.body || doc.documentElement).appendChild(svg);
    return f;
  }
  function applySharpen(map, pct) {
    let cv = null; try { cv = map && map.getCanvas ? map.getCanvas() : map; } catch (_) {}
    if (!cv || !cv.style) return;
    const v = sharpNorm(pct), A = v / 100 * SHARP_MAX_A;
    if (v <= 0) { cv.style.filter = ""; return; }
    const f = sharpFilter(cv.ownerDocument || document), c = f.querySelector("feComposite");
    c.setAttribute("k2", String(+(1 + A).toFixed(3))); c.setAttribute("k3", String(+(-A).toFixed(3)));
    cv.style.filter = "url(#" + SHARP_ID + ")";
  }
  window.rzMapSharpenNorm = sharpNorm;
  window.rzApplyMapSharpen = applySharpen;
  window.rzOrthoAdjustNorm = norm;
  window.rzMapAdjustPaint = function (adj, def) { return paint(norm(adj, def)); };   // nicht rzRasterAdjustPaint: util.js hat eine gleichnamige Funktion (globale Deklaration = window-Eigenschaft)
  window.rzApplyRasterAdjust = applyAdjust;
  window.rzApplyMapAdjust = applyAdjust;
})();
