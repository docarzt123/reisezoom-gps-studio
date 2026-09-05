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
uniform vec2 u_res;     // Bildpunkte (Breite, Höhe)
uniform float u_halfw;  // halbe Linienbreite in Bildpunkten
out vec3 v_lw;          // (entlang, quer, Segmentlänge) × w
out float v_w;
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
  vec2 sp2 = sp + n * a_side * u_halfw - d * u_halfw;
  gl_Position = vec4(sp2 / (u_res * 0.5) * p.w, p.z, p.w);
  float along = (a_end < 0.5) ? -u_halfw : (L + u_halfw);
  v_lw = vec3(along, a_side * u_halfw, L) * p.w;
  v_w = p.w;
}`;

  const FS = `#version 300 es
precision highp float;
in vec3 v_lw;
in float v_w;
uniform vec4 u_color;
uniform float u_halfw;
out vec4 fragColor;
void main() {
  vec3 lw = v_lw / v_w;
  float along = lw.x, across = lw.y, L = lw.z;
  float dist;
  if (along < 0.0) dist = length(vec2(along, across));
  else if (along > L) dist = length(vec2(along - L, across));
  else dist = abs(across);
  float a = 1.0 - smoothstep(u_halfw - 0.8, u_halfw + 0.6, dist);
  if (a <= 0.002) discard;
  fragColor = vec4(u_color.rgb, u_color.a * a);
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
                      matrix: U("u_projection_matrix"), fallback: U("u_projection_fallback_matrix"),
                      tileMerc: U("u_projection_tile_mercator_coords"), clip: U("u_projection_clipping_plane"),
                      transition: U("u_projection_transition"),
                      res: U("u_res"), halfw: U("u_halfw"), color: U("u_color") };
      },
      onRemove(map, gl) {
        for (const b of this._bufs) { try { gl.deleteBuffer(b.vbo); gl.deleteBuffer(b.ibo); } catch (_) {} }
        this._bufs = [];
      },
      /** Spuren setzen: [{coords:[[lng,lat],…], color, width(px), opacity}] */
      setTracks(tracks) {
        this._tracks = (tracks || []).map(t => ({
          coords: t.coords || [], color: hexToRgba(t.color, t.opacity), width: (t.width != null ? +t.width : 4),
        }));
        this._counts = null;
        if (this._gl) this._rebuild();
        try { this._map && this._map.triggerRepaint(); } catch (_) {}
      },
      /** Wachstum: je Spur der Index des letzten gezeichneten Punkts (inkl.); null = alles. */
      setCounts(counts) {
        this._counts = counts ? counts.slice() : null;
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
            const h = this._elev(c[i][0], c[i][1]) + offsetM;
            const mc = MC.fromLngLat([c[i][0], c[i][1]], h);
            merc[i] = [mc.x, mc.y, mc.z, h];
          }
          const segs = Math.max(0, n - 1);
          // je Segment 4 Vertices × (3 pos + 3 other + elev + elevOther + side + end) = 10 Floats
          const verts = new Float32Array(segs * 4 * 10);
          const idx = new Uint32Array(segs * 6);
          for (let s = 0; s < segs; s++) {
            const a = merc[s], b = merc[s + 1];
            const base = s * 40;
            const put = (o, P, Q, side, end) => { verts.set([P[0], P[1], P[2], Q[0], Q[1], Q[2], P[3], Q[3], side, end], base + o); };
            put(0, a, b, -1, 0); put(10, a, b, 1, 0); put(20, b, a, 1, 1); put(30, b, a, -1, 1);
            // Am Ende ist d gespiegelt, deshalb dort die Seite getauscht (siehe put oben) →
            // Vertex 2 liegt geometrisch auf derselben Seite wie Vertex 0.
            const v = s * 4, o = s * 6;
            idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2;
            idx[o + 3] = v; idx[o + 4] = v + 2; idx[o + 5] = v + 3;
          }
          const vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
          const ibo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
          this._bufs.push({ vbo, ibo, segs, color: t.color, width: t.width });
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
          if (z !== this._lastZ || (ok && !this._elevOk) || !this._bufs.length) { this._lastZ = z; this._elevOk = ok; this._rebuild(); }
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
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        if (this._depth) { gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(false); }
        else gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        const L = this._loc;
        for (let i = 0; i < this._bufs.length; i++) {
          const b = this._bufs[i];
          let segs = b.segs;
          if (this._counts && this._counts[i] != null) segs = Math.max(0, Math.min(b.segs, Math.floor(this._counts[i])));
          if (!segs) continue;
          gl.bindBuffer(gl.ARRAY_BUFFER, b.vbo);
          gl.enableVertexAttribArray(L.pos); gl.vertexAttribPointer(L.pos, 3, gl.FLOAT, false, 40, 0);
          gl.enableVertexAttribArray(L.other); gl.vertexAttribPointer(L.other, 3, gl.FLOAT, false, 40, 12);
          if (L.elev >= 0) { gl.enableVertexAttribArray(L.elev); gl.vertexAttribPointer(L.elev, 1, gl.FLOAT, false, 40, 24); }
          if (L.elevOther >= 0) { gl.enableVertexAttribArray(L.elevOther); gl.vertexAttribPointer(L.elevOther, 1, gl.FLOAT, false, 40, 28); }
          gl.enableVertexAttribArray(L.side); gl.vertexAttribPointer(L.side, 1, gl.FLOAT, false, 40, 32);
          gl.enableVertexAttribArray(L.end); gl.vertexAttribPointer(L.end, 1, gl.FLOAT, false, 40, 36);
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.ibo);
          gl.uniform1f(L.halfw, Math.max(0.5, b.width * pr * 0.5));
          gl.uniform4f(L.color, b.color[0], b.color[1], b.color[2], b.color[3]);
          gl.drawElements(gl.TRIANGLES, segs * 6, gl.UNSIGNED_INT, 0);
        }
        gl.disableVertexAttribArray(L.pos); gl.disableVertexAttribArray(L.other);
        if (L.elev >= 0) gl.disableVertexAttribArray(L.elev); if (L.elevOther >= 0) gl.disableVertexAttribArray(L.elevOther);
        gl.disableVertexAttribArray(L.side); gl.disableVertexAttribArray(L.end);
      },
    };
    return layer;
  }

  const api = { create, hexToRgba };
  if (typeof window !== "undefined") window.rzLine3d = api;
  if (typeof globalThis !== "undefined") globalThis.rzLine3d = api;
})();
