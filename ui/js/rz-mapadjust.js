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
      if (l.type !== "raster" || !l.id.startsWith("rz-raster")) continue;
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
  window.rzOrthoAdjustNorm = norm;
  window.rzMapAdjustPaint = function (adj, def) { return paint(norm(adj, def)); };   // nicht rzRasterAdjustPaint: util.js hat eine gleichnamige Funktion (globale Deklaration = window-Eigenschaft)
  window.rzApplyRasterAdjust = applyAdjust;
  window.rzApplyMapAdjust = applyAdjust;
})();
