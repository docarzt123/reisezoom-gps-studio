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
    // 07.09.2026 (Marc, Teneriffa-Schwarm: „die Regler funktionieren nicht mehr" — in der
    // Übersicht liegt nur Sentinel, die Landesdienste blenden erst ab Zoom 12 ein): Sentinel
    // bekommt die Regler als ABWEICHUNG vom Werk (Werk 25/8/0/0 = Sentinel unverändert, sonst
    // wurde das Meer schwarz, 05.09.). Beide Ebenen bewegen sich damit gleichsinnig.
    const d = Object.assign({}, DEF, def || {});
    const pSen = paint(norm({ sat: a.sat - d.sat, con: a.con - d.con, bri: a.bri - d.bri, hue: a.hue - d.hue }, { sat: 0, con: 0, bri: 0, hue: 0 }));
    for (const l of layers) {
      if (l.type !== "raster" || !l.id.startsWith("rz-raster")) continue;
      hasRaster = true;
      const pp = (l.id === "rz-raster-sentinel") ? pSen : p;
      for (const k of Object.keys(ALL)) { try { map.setPaintProperty(l.id, k, (k in pp) ? pp[k] : ALL[k]); } catch (_) {} }
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
  /* 07.09.2026 (Marc, Teneriffa: "die ganze Insel ist unscharf") — Schärfe 0…100 %.
   * Sentinel-2 (EOX 2016) trägt bei z14 nicht mehr Detail als bei z13 (gemessen), da hilft
   * keine Kacheldichte — nur eine Unschärfemaske: Bild = (1+A)·Original − A·Weichzeichnung.
   * Erster Wurf war ein SVG-Filter per CSS auf der Leinwand: lief in Chromium (Render) und im
   * kopflosen WebKit, aber NICHT in der App (WKWebView legt die WebGL-Leinwand auf eine
   * beschleunigte Ebene, und dort ignoriert WebKit url()-Filter — Marc: "Schärfe geht nie").
   * Jetzt als Custom-Layer direkt hinter den Raster-Ebenen: kopiert den bis dahin gezeichneten
   * Framebuffer in eine Textur (copyTexImage2D) und zeichnet ihn geschärft zurück. Strecke,
   * Schilder, Beschriftung liegen darüber und bleiben unberührt; HTML-Overlays sowieso.
   * Radius = 1 CSS-Pixel (devicePixelRatio) — das Renderfenster ist in CSS-Pixeln die
   * Vorschau, also gleicher Look in Vorschau und Video. Bei 0 keine Ebene. */
  const SHARP_ID = "rz-sharpen", SHARP_MAX_A = 2.0;
  function sharpNorm(v) { const n = parseFloat(v); return isFinite(n) ? Math.max(0, Math.min(100, n)) : 0; }
  const SHARP_VS = "attribute vec2 a_pos; varying vec2 v_uv; void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }";
  const SHARP_FS = "precision mediump float; uniform sampler2D u_tex; uniform vec2 u_step; uniform float u_a; varying vec2 v_uv;"
    + " void main() { vec4 c = texture2D(u_tex, v_uv);"
    + " vec4 b = (texture2D(u_tex, v_uv + vec2(u_step.x, 0.0)) + texture2D(u_tex, v_uv - vec2(u_step.x, 0.0))"
    + " + texture2D(u_tex, v_uv + vec2(0.0, u_step.y)) + texture2D(u_tex, v_uv - vec2(0.0, u_step.y)) + c) / 5.0;"
    + " vec3 s = clamp(c.rgb * (1.0 + u_a) - b.rgb * u_a, 0.0, max(c.a, 0.0001));"
    + " gl_FragColor = vec4(s, c.a); }";
  function sharpLayer() {
    return {
      id: SHARP_ID, type: "custom", renderingMode: "2d", amount: 0,
      onAdd(map, gl) {
        this._map = map;
        const mk = (t, src) => { const sh = gl.createShader(t); gl.shaderSource(sh, src); gl.compileShader(sh); return sh; };
        const pr = gl.createProgram(); gl.attachShader(pr, mk(gl.VERTEX_SHADER, SHARP_VS)); gl.attachShader(pr, mk(gl.FRAGMENT_SHADER, SHARP_FS)); gl.linkProgram(pr);
        this._pr = pr; this._aPos = gl.getAttribLocation(pr, "a_pos");
        this._uTex = gl.getUniformLocation(pr, "u_tex"); this._uStep = gl.getUniformLocation(pr, "u_step"); this._uA = gl.getUniformLocation(pr, "u_a");
        this._buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this._buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        this._tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this._tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      },
      onRemove(map, gl) { try { gl.deleteProgram(this._pr); gl.deleteBuffer(this._buf); gl.deleteTexture(this._tex); } catch (_) {} },
      render(gl) {
        if (!(this.amount > 0) || !this._pr) return;
        const vp = gl.getParameter(gl.VIEWPORT), w = vp[2], h = vp[3];
        if (!(w > 0 && h > 0)) return;
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this._tex);
        gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, vp[0], vp[1], w, h, 0);
        const depth = gl.isEnabled(gl.DEPTH_TEST), blend = gl.isEnabled(gl.BLEND), stencil = gl.isEnabled(gl.STENCIL_TEST), cull = gl.isEnabled(gl.CULL_FACE);
        gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.STENCIL_TEST); gl.disable(gl.CULL_FACE);
        gl.useProgram(this._pr);
        const dpr = Math.max(1, Number(window.devicePixelRatio) || 1);
        gl.uniform1i(this._uTex, 0); gl.uniform2f(this._uStep, dpr / w, dpr / h); gl.uniform1f(this._uA, this.amount);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._buf); gl.enableVertexAttribArray(this._aPos); gl.vertexAttribPointer(this._aPos, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.disableVertexAttribArray(this._aPos);
        if (depth) gl.enable(gl.DEPTH_TEST); if (blend) gl.enable(gl.BLEND); if (stencil) gl.enable(gl.STENCIL_TEST); if (cull) gl.enable(gl.CULL_FACE);
      },
    };
  }
  /** Erste Ebene, die kein Raster mehr ist (Beschriftung, Strecke, Schilder) — die Schärfung liegt davor. */
  function firstNonRasterLayer(layers) {
    for (const l of layers) { if (l.id === SHARP_ID) continue; if (l.type !== "raster" && l.type !== "background" && l.type !== "hillshade") return l.id; }
    return undefined;
  }
  function applySharpen(map, pct) {
    if (!map || !map.getStyle || !map.addLayer) return;
    const v = sharpNorm(pct), A = v / 100 * SHARP_MAX_A;
    let layers = []; try { layers = (map.getStyle() || {}).layers || []; } catch (_) { return; }
    try {
      if (v <= 0) { if (map.getLayer(SHARP_ID)) map.removeLayer(SHARP_ID); map.__rzSharpen = 0; if (map.triggerRepaint) map.triggerRepaint(); return; }
      let lay = map.__rzSharpenLayer;
      if (!map.getLayer(SHARP_ID)) { lay = sharpLayer(); map.__rzSharpenLayer = lay; map.addLayer(lay, firstNonRasterLayer(layers)); }
      if (lay) lay.amount = A;
      map.__rzSharpen = v;
      if (map.triggerRepaint) map.triggerRepaint();
    } catch (e) { try { console.warn("rzApplyMapSharpen", e); } catch (_) {} }
  }
  window.rzMapSharpenNorm = sharpNorm;
  window.rzApplyMapSharpen = applySharpen;
  window.rzOrthoAdjustNorm = norm;
  window.rzMapAdjustPaint = function (adj, def) { return paint(norm(adj, def)); };   // nicht rzRasterAdjustPaint: util.js hat eine gleichnamige Funktion (globale Deklaration = window-Eigenschaft)
  window.rzApplyRasterAdjust = applyAdjust;
  window.rzApplyMapAdjust = applyAdjust;
})();
