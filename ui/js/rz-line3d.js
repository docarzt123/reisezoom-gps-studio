/* rz-line3d.js — Linien ÜBER dem Gelände (MapLibre, 06.09.2026)
 *
 * Warum: MapLibre drapiert `line`-Ebenen auf das Geländenetz. Eine Spur liegt
 * dann exakt AUF der Oberfläche und wird von jedem Grat des groben Netzes
 * teilweise verdeckt; bei Kamerabewegung wandert die Verdeckungskante — im
 * Video flimmern einzelne Tracks (Marc, Teneriffa-Schwarm 4K, 05.09.2026).
 * Mapbox GL hob die Linien mit `line-z-offset` 150 m an; MapLibre kennt das
 * nicht (Linien-Shader ohne Höhe). Diese Ebene zeichnet die Spuren selbst:
 * jeder Punkt auf Geländehöhe + Versatz, Breite in Bildpunkten (wie eine
 * normale Linie), runde Enden/Verbindungen per Abstandsfeld, Tiefentest
 * gegen das Gelände (hinter dem Berg bleibt verdeckt).
 *
 * Nutzung:
 *   const lyr = rzLine3d.create("schwarm-3d", { offsetM: 150 });
 *   map.addLayer(lyr, beforeId);
 *   lyr.setTracks([{ coords: [[lng,lat],…], color: "#ff0000", width: 4, opacity: 0.9 }, …]);
 *   lyr.setCounts([k0, k1, …]);          // je Spur: bis zu welchem Punkt gezeichnet wird (Wachstum)
 *   lyr.refreshElevation();              // nach dem Laden der Geländekacheln (idle)
 *
 * Der Vertex-Shader rechnet in Bildkoordinaten (Breite bleibt beim Zoomen
 * konstant), das Abstandsfeld im Fragment-Shader liefert Kappen und Kanten mit
 * Antialiasing. Varyings werden mit w multipliziert, damit sie bildlinear
 * (nicht perspektivisch) interpoliert werden.
 */
(function () {
  "use strict";

  // Vertex-Shader-Rumpf. Davor kommen MapLibres `shaderData.define` und
  // `vertexShaderPrelude` (Globus: projectToSphere/interpolateProjection, dazu die
  // u_projection_*-Uniforms). Ohne Prelude (ältere API) deklarieren wir die Matrix selbst.
  const VS_BODY = `
in vec3 a_pos;       // Merkator xyz dieses Endpunkts (z in Merkator-Einheiten)
in vec3 a_other;     // Merkator xyz des anderen Endpunkts
in float a_elev;     // Höhe dieses Endpunkts in Metern (Globus)
in float a_elevOther;
in float a_side;     // -1 / +1
in float a_end;      // 0 = Segmentanfang, 1 = Segmentende
in float a_dist;     // Merkator-Strecke bis zum Segmentanfang (Strichelung)
in vec4 a_color;     // Farbe dieses Endpunkts (premultiplied im Fragment)
uniform vec2 u_res;     // Bildpunkte (Breite, Höhe)
uniform float u_halfw;  // halbe Linienbreite in Bildpunkten
uniform float u_pxPerMerc;   // Bildpunkte je Merkator-Einheit (Strichelung)
uniform float u_pxPerMercRef; // dito zur Zeit des Aufbaus (Bezug für die Strichlänge)
uniform vec2 u_translate;    // Versatz in Gerätepixeln (Schlagschatten)
out vec3 v_lw;          // (entlang, quer, Segmentlänge) × w
out float v_w;
out float v_dist;       // Bildpunkte bis zum Segmentanfang × w
out vec4 v_color;
vec4 rzProject(vec3 posMerc, float elevM) {
#ifdef GLOBE
  // Custom Layer: „Kachel" = ganze Welt (u_projection_tile_mercator_coords = 0,0,1,1)
  vec2 posInTile = posMerc.xy;
  vec3 sphere = projectToSphere(posInTile);
  return interpolateProjection(posInTile, sphere, elevM);
#else
  return u_projection_matrix * vec4(posMerc, 1.0);
#endif
}
void main() {
  vec4 p = rzProject(a_pos, a_elev);
  vec4 q = rzProject(a_other, a_elevOther);
  vec2 sp = p.xy / p.w * u_res * 0.5;
  vec2 sq = q.xy / q.w * u_res * 0.5;
  vec2 dd = sq - sp;
  float L = length(dd);
  vec2 d = (L > 0.0001) ? dd / L : vec2(1.0, 0.0);
  vec2 n = vec2(-d.y, d.x);
  // Kappe: um halfw über den Endpunkt hinaus, weg vom anderen Ende
  vec2 sp2 = sp + n * a_side * u_halfw - d * u_halfw + vec2(u_translate.x, -u_translate.y);
  gl_Position = vec4(sp2 / (u_res * 0.5) * p.w, p.z, p.w);
  float along = (a_end < 0.5) ? -u_halfw : (L + u_halfw);
  v_lw = vec3(along, a_side * u_halfw, L) * p.w;
  v_w = p.w;
  v_dist = a_dist * p.w;   // Merkator-Strecke bis zum Segmentanfang (× w)
  v_color = a_color;
}`;

  const FS = `#version 300 es
precision highp float;
in vec3 v_lw;
in float v_w;
in float v_dist;
in vec4 v_color;
uniform vec4 u_color;      // Grundfarbe (× Vertexfarbe)
uniform float u_halfw;
uniform float u_feather;   // weiche Kante in Bildpunkten (Glow); 0.8 = normal
uniform vec2 u_dash;       // (Strich, Lücke) in Bildpunkten zur Bezugs-Zoomstufe; x<=0 = durchgezogen
uniform float u_pxPerMerc;
uniform float u_pxPerMercRef;
out vec4 fragColor;
void main() {
  vec3 lw = v_lw / v_w;
  float along = lw.x, across = lw.y, L = lw.z;
  float dist;
  if (along < 0.0) dist = length(vec2(along, across));
  else if (along > L) dist = length(vec2(along - L, across));
  else dist = abs(across);
  float f = max(0.3, u_feather);
  float a = 1.0 - smoothstep(u_halfw - f, u_halfw + 0.6, dist);
  if (u_dash.x > 0.0) {
    // Strichelung entlang der ECHTEN Linie, am BODEN verankert (Merkator-Strecke):
    // beim Zoomen atmet das Muster, es wandert nicht (weder je Kachel noch vom
    // Linienanfang her). Bezugsgröße = Strichlänge zur Zoomstufe des Aufbaus.
    float dMerc = v_dist / v_w + clamp(along, 0.0, L) / u_pxPerMerc;
    float dashM = u_dash.x / u_pxPerMercRef, gapM = u_dash.y / u_pxPerMercRef;
    float period = dashM + gapM;
    float m = mod(dMerc, period);
    float edge = min(m, dashM - m) * u_pxPerMerc;   // Abstand zur Strichkante in Bildpunkten (negativ = in der Lücke)
    edge += u_halfw;                                 // runde Kappen: Strich wächst um halfw je Ende
    a *= smoothstep(-0.7, 0.7, edge);
  }
  if (a <= 0.002) discard;
  vec4 c = u_color * v_color;
  fragColor = vec4(c.rgb, c.a * a);
  fragColor.rgb *= fragColor.a;   // premultiplied (MapLibre-Blend)
}`;

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error("rz-line3d Shader: " + gl.getShaderInfoLog(s));
    return s;
  }

  function hexToRgba(hex, opacity) {
    let h = String(hex || "#ff0000").trim();
    if (h[0] === "#") h = h.slice(1);
    if (h.length === 3) h = h.split("").map(c => c + c).join("");
    const n = parseInt(h.slice(0, 6), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, opacity == null ? 1 : opacity];
  }

  function create(id, opts) {
    opts = opts || {};
    const offsetM = (opts.offsetM != null) ? opts.offsetM : 150;
    const layer = {
      id, type: "custom", renderingMode: "3d",
      _map: null, _gl: null, _prog: null, _tracks: [], _counts: null, _bufs: [],
      _depth: opts.depth !== false,
      onAdd(map, gl) {
        this._map = map; this._gl = gl;
        if (this._tracks.length) this._rebuild();
      },
      _compile(gl, sd) {
        const define = sd ? String(sd.define || "") : "";
        const prelude = sd ? String(sd.vertexShaderPrelude || "") : "uniform mat4 u_projection_matrix;\n";
        const src = "#version 300 es\nprecision highp float;\n" + define + "\n" + prelude + "\n" + VS_BODY;
        const vs = compile(gl, gl.VERTEX_SHADER, src), fs = compile(gl, gl.FRAGMENT_SHADER, FS);
        const p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("rz-line3d Link: " + gl.getProgramInfoLog(p));
        if (this._prog) { try { gl.deleteProgram(this._prog); } catch (_) {} }
        this._prog = p; this._define = define;
        const U = (n) => gl.getUniformLocation(p, n);
        this._loc = { pos: gl.getAttribLocation(p, "a_pos"), other: gl.getAttribLocation(p, "a_other"),
                      elev: gl.getAttribLocation(p, "a_elev"), elevOther: gl.getAttribLocation(p, "a_elevOther"),
                      side: gl.getAttribLocation(p, "a_side"), end: gl.getAttribLocation(p, "a_end"),
                      dist: gl.getAttribLocation(p, "a_dist"), color: gl.getAttribLocation(p, "a_color"),
                      matrix: U("u_projection_matrix"), fallback: U("u_projection_fallback_matrix"),
                      tileMerc: U("u_projection_tile_mercator_coords"), clip: U("u_projection_clipping_plane"),
                      transition: U("u_projection_transition"),
                      res: U("u_res"), halfw: U("u_halfw"), ucolor: U("u_color"),
                      feather: U("u_feather"), dash: U("u_dash"), pxPerMerc: U("u_pxPerMerc"), pxPerMercRef: U("u_pxPerMercRef"), translate: U("u_translate") };
      },
      onRemove(map, gl) {
        for (const b of this._bufs) { try { gl.deleteBuffer(b.vbo); gl.deleteBuffer(b.ibo); } catch (_) {} }
        this._bufs = [];
      },
      /** Spuren setzen: [{coords:[[lng,lat],…], color, width(px), opacity,
       *    colors: [[r,g,b,a]…] je Punkt (optional, 0..1), dash: [strich, lücke] in
       *    Linienbreiten (optional), feather: px (optional, Glow)}] */
      setTracks(tracks) {
        this._tracks = (tracks || []).map(t => ({
          coords: t.coords || [], color: hexToRgba(t.color, t.opacity), width: (t.width != null ? +t.width : 4),
          colors: t.colors || null, dash: (t.dash && t.dash.length >= 2) ? [+t.dash[0], +t.dash[1]] : null,
          feather: (t.feather != null) ? +t.feather : 0.8,
          translate: (t.translate && t.translate.length >= 2) ? [+t.translate[0], +t.translate[1]] : [0, 0],
          offsetM: (t.offsetM != null) ? +t.offsetM : null,
        }));
        this._counts = null;
        if (this._gl) this._rebuild();
        try { this._map && this._map.triggerRepaint(); } catch (_) {}
      },
      /** Wachstum: je Spur die Zahl gezeichneter Segmente ab dem Anfang; null = alles. */
      setCounts(counts) {
        this._counts = counts ? counts.slice() : null; this._ranges = null;
        try { this._map && this._map.triggerRepaint(); } catch (_) {}
      },
      /** Bereich je Spur: [[startIdx, endIdx]] (Punktindizes, inkl.); null = alles. */
      setRanges(ranges) {
        this._ranges = ranges ? ranges.map(r => r ? [r[0] | 0, r[1] | 0] : null) : null; this._counts = null;
        try { this._map && this._map.triggerRepaint(); } catch (_) {}
      },
      /** Geländehöhen neu abfragen (nach dem Laden der DEM-Kacheln). */
      refreshElevation() { if (this._gl) this._rebuild(); try { this._map && this._map.triggerRepaint(); } catch (_) {} },
      _elev(lng, lat) {
        try {
          const m = this._map;
          if (m && m.getTerrain && m.getTerrain() && m.queryTerrainElevation) {
            const e = m.queryTerrainElevation({ lng, lat });
            if (typeof e === "number" && isFinite(e)) return e;
          }
        } catch (_) {}
        return 0;
      },
      _rebuild() {
        const gl = this._gl, MC = (window.maplibregl && window.maplibregl.MercatorCoordinate);
        if (!MC) return;
        for (const b of this._bufs) { try { gl.deleteBuffer(b.vbo); gl.deleteBuffer(b.ibo); } catch (_) {} }
        this._bufs = [];
        for (const t of this._tracks) {
          const c = t.coords, n = c.length;
          const merc = new Array(n);
          for (let i = 0; i < n; i++) {
            const h = this._elev(c[i][0], c[i][1]) + ((t.offsetM != null) ? +t.offsetM : offsetM);
            const mc = MC.fromLngLat([c[i][0], c[i][1]], h);
            merc[i] = [mc.x, mc.y, mc.z, h];
          }
          // Glättung wie die Kachel-Vereinfachung der drapierten Linie: gleitendes Mittel
          // über so viele Punkte, wie in ~1,5 Bildpunkte passen (Indizes bleiben 1:1,
          // der Laufpunkt trifft weiter seinen Index). Erster/letzter Punkt bleiben.
          if (n > 4 && t.smooth !== false) {
            let ppm = 512 * Math.pow(2, this._map.getZoom());
            try { const tr = this._map.transform; if (tr && tr.worldSize) ppm = tr.worldSize; } catch (_) {}
            let segPx = 0; for (let i = 1; i < n; i++) segPx += Math.hypot(merc[i][0] - merc[i - 1][0], merc[i][1] - merc[i - 1][1]);
            segPx = segPx / (n - 1) * ppm;
            const w = Math.max(0, Math.min(12, Math.round(3.0 / Math.max(1e-6, segPx))));
            if (w >= 1) {
              const sm = new Array(n);
              for (let i = 0; i < n; i++) {
                const a0 = Math.max(0, i - w), b0 = Math.min(n - 1, i + w);
                let x = 0, y = 0, z = 0, hh = 0, k = 0;
                for (let j = a0; j <= b0; j++) { x += merc[j][0]; y += merc[j][1]; z += merc[j][2]; hh += merc[j][3]; k++; }
                sm[i] = (i === 0 || i === n - 1) ? merc[i] : [x / k, y / k, z / k, hh / k];
              }
              for (let i = 0; i < n; i++) merc[i] = sm[i];
            }
          }
          const segs = Math.max(0, n - 1);
          const cum = new Float64Array(n);   // Merkator-Strecke (xy) bis Punkt i
          for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(merc[i][0] - merc[i - 1][0], merc[i][1] - merc[i - 1][1]);
          const colAt = (i) => (t.colors && t.colors[i]) ? t.colors[i] : [1, 1, 1, 1];
          // je Segment 4 Vertices × (3 pos + 3 other + elev + elevOther + side + end + dist + rgba) = 16 Floats
          const verts = new Float32Array(segs * 4 * 16);
          const idx = new Uint32Array(segs * 6);
          for (let s = 0; s < segs; s++) {
            const a = merc[s], b = merc[s + 1];
            const base = s * 64, d0 = cum[s], ca = colAt(s), cb = colAt(s + 1);
            const put = (o, P, Q, side, end, col) => { verts.set([P[0], P[1], P[2], Q[0], Q[1], Q[2], P[3], Q[3], side, end, d0, col[0], col[1], col[2], col[3]], base + o); };
            put(0, a, b, -1, 0, ca); put(16, a, b, 1, 0, ca); put(32, b, a, 1, 1, cb); put(48, b, a, -1, 1, cb);
            // Am Ende ist d gespiegelt, deshalb dort die Seite getauscht (siehe put oben) →
            // Vertex 2 liegt geometrisch auf derselben Seite wie Vertex 0.
            const v = s * 4, o = s * 6;
            idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2;
            idx[o + 3] = v; idx[o + 4] = v + 2; idx[o + 5] = v + 3;
          }
          const vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
          const ibo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
          this._bufs.push({ vbo, ibo, segs, color: t.color, width: t.width, dash: t.dash, feather: t.feather, translate: t.translate });
        }
      },
      render(gl, args) {
        if (!this._tracks.length) return;
        // Geländehöhen nachziehen: einmal, sobald die DEM-Quelle geladen ist, und bei
        // jeder ganzen Zoomstufe (andere DEM-Auflösung). Der Aufbau läuft vor dem Zeichnen.
        try {
          const mp = this._map, z = Math.floor(mp.getZoom());
          const tr = mp.getTerrain && mp.getTerrain();
          let ok = true;
          if (tr && tr.source && mp.isSourceLoaded) { try { ok = !!mp.isSourceLoaded(tr.source); } catch (_) { ok = true; } }
          if (z !== this._lastZ || (ok && !this._elevOk) || !this._bufs.length) { this._lastZ = z; this._elevOk = ok; this._ppmRef = null; this._rebuild(); }
        } catch (_) {}
        if (!this._bufs.length) return;
        const m = (args && args.defaultProjectionData && args.defaultProjectionData.mainMatrix)
                  ? args.defaultProjectionData.mainMatrix : args;
        if (window.__rzLine3dDebug && !this._dbgOnce) { this._dbgOnce = true; try { const pd = args && args.defaultProjectionData; window.__rzLine3dArgs = { keys: args && Object.keys(args), pd: pd && Object.keys(pd), m: m && Array.from(m), fallback: pd && pd.fallbackMatrix && Array.from(pd.fallbackMatrix), tileMerc: pd && pd.tileMercatorCoords && Array.from(pd.tileMercatorCoords), transition: pd && pd.projectionTransition, clip: pd && pd.clippingPlane && Array.from(pd.clippingPlane), shaderData: args && args.shaderData ? { define: args.shaderData.define, prelude: String(args.shaderData.vertexShaderPrelude || '').slice(0, 3000) } : null, canvas: [gl.canvas.width, gl.canvas.height] }; } catch (e) { window.__rzLine3dArgs = { err: String(e) }; } }
        if (!m || m.length !== 16) return;
        const sd = args && args.shaderData;
        const define = sd ? String(sd.define || "") : "";
        if (!this._prog || this._define !== define) { try { this._compile(gl, sd); } catch (e) { console.warn(String(e)); return; } }
        const cv = gl.canvas, res = [cv.width, cv.height];
        const pr = (this._map && this._map.getPixelRatio) ? this._map.getPixelRatio() : (window.devicePixelRatio || 1);
        gl.useProgram(this._prog);
        gl.uniformMatrix4fv(this._loc.matrix, false, m);
        const pd = args && args.defaultProjectionData;
        if (pd) {
          if (this._loc.fallback && pd.fallbackMatrix) gl.uniformMatrix4fv(this._loc.fallback, false, pd.fallbackMatrix);
          if (this._loc.tileMerc && pd.tileMercatorCoords) gl.uniform4fv(this._loc.tileMerc, pd.tileMercatorCoords);
          if (this._loc.clip && pd.clippingPlane) gl.uniform4fv(this._loc.clip, pd.clippingPlane);
          if (this._loc.transition != null) gl.uniform1f(this._loc.transition, +pd.projectionTransition || 0);
        }
        gl.uniform2f(this._loc.res, res[0], res[1]);
        // Bildpunkte je Merkator-Einheit (Weltbreite in Gerätepixeln) — für die Strichelung
        let ppm = 512 * Math.pow(2, this._map.getZoom()) * pr;
        try { const t = this._map.transform; if (t && t.worldSize) ppm = t.worldSize * pr; } catch (_) {}
        if (this._loc.pxPerMerc) gl.uniform1f(this._loc.pxPerMerc, ppm);
        if (this._ppmRef == null) this._ppmRef = ppm;
        if (this._loc.pxPerMercRef) gl.uniform1f(this._loc.pxPerMercRef, this._ppmRef);
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        // Tiefe nur LESEN (gegen das Gelände). Schreiben ließe die überlappenden Segmente einer
        // Linie sich selbst zerschneiden (Flimmern, dünne Linie — gemessen 06.09.2026).
        if (this._depth) { gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(false); }
        else gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        const L = this._loc;
        for (let i = 0; i < this._bufs.length; i++) {
          const b = this._bufs[i];
          let segs = b.segs, first = 0;
          if (this._counts && this._counts[i] != null) segs = Math.max(0, Math.min(b.segs, Math.floor(this._counts[i])));
          if (this._ranges && this._ranges[i]) { const r = this._ranges[i]; first = Math.max(0, Math.min(b.segs, r[0])); segs = Math.max(0, Math.min(b.segs, r[1]) - first); }
          if (!segs) continue;
          gl.bindBuffer(gl.ARRAY_BUFFER, b.vbo);
          const ST = 64;
          gl.enableVertexAttribArray(L.pos); gl.vertexAttribPointer(L.pos, 3, gl.FLOAT, false, ST, 0);
          gl.enableVertexAttribArray(L.other); gl.vertexAttribPointer(L.other, 3, gl.FLOAT, false, ST, 12);
          if (L.elev >= 0) { gl.enableVertexAttribArray(L.elev); gl.vertexAttribPointer(L.elev, 1, gl.FLOAT, false, ST, 24); }
          if (L.elevOther >= 0) { gl.enableVertexAttribArray(L.elevOther); gl.vertexAttribPointer(L.elevOther, 1, gl.FLOAT, false, ST, 28); }
          gl.enableVertexAttribArray(L.side); gl.vertexAttribPointer(L.side, 1, gl.FLOAT, false, ST, 32);
          gl.enableVertexAttribArray(L.end); gl.vertexAttribPointer(L.end, 1, gl.FLOAT, false, ST, 36);
          if (L.dist >= 0) { gl.enableVertexAttribArray(L.dist); gl.vertexAttribPointer(L.dist, 1, gl.FLOAT, false, ST, 40); }
          if (L.color >= 0) { gl.enableVertexAttribArray(L.color); gl.vertexAttribPointer(L.color, 4, gl.FLOAT, false, ST, 44); }
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.ibo);
          const halfw = Math.max(0.5, b.width * pr * 0.5);
          gl.uniform1f(L.halfw, halfw);
          gl.uniform1f(L.feather, (b.feather != null ? b.feather : 0.8) * pr);
          if (L.translate) gl.uniform2f(L.translate, (b.translate ? b.translate[0] : 0) * pr, (b.translate ? b.translate[1] : 0) * pr);
          if (b.dash) gl.uniform2f(L.dash, b.dash[0] * b.width * pr, b.dash[1] * b.width * pr); else gl.uniform2f(L.dash, 0, 0);
          gl.uniform4f(L.ucolor, b.color[0], b.color[1], b.color[2], b.color[3]);
          gl.drawElements(gl.TRIANGLES, segs * 6, gl.UNSIGNED_INT, first * 6 * 4);
        }
        gl.disableVertexAttribArray(L.pos); gl.disableVertexAttribArray(L.other);
        if (L.elev >= 0) gl.disableVertexAttribArray(L.elev); if (L.elevOther >= 0) gl.disableVertexAttribArray(L.elevOther);
        if (L.dist >= 0) gl.disableVertexAttribArray(L.dist); if (L.color >= 0) gl.disableVertexAttribArray(L.color);
        gl.disableVertexAttribArray(L.side); gl.disableVertexAttribArray(L.end);
      },
    };
    return layer;
  }

  const api = { create, hexToRgba };
  if (typeof window !== "undefined") window.rzLine3d = api;
  if (typeof globalThis !== "undefined") globalThis.rzLine3d = api;
})();
