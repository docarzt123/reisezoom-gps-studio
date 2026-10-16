/* rz-punkt3d.js — der Laufpunkt in der Luft (MapLibre, 15.10.2026)
 *
 * Warum: Bei „Flug in der Luft“ hängt die Linie in ihrer Flughöhe (rz-line3d). Der Laufpunkt am Boden ist dann aus
 * — MapLibre zeichnet Kreise und Symbole immer AUF dem Gelände. Bis hierher stand in der Luft ein Ersatz (kurze Linie
 * in Linienfarbe); Form, Symbol, Fahrzeugbild, eigenes Bild und Farbe des Laufpunkts kamen dort nicht an (Marc:
 * „wenn ich den Laufpunkt ändere, sehe ich die Änderung gar nicht in der Vorschau“). Diese Ebene zeichnet GENAU das
 * Bild des Laufpunkts am Boden als Viereck in Flughöhe:
 *   karte: true   flach in der Kartenebene, gedreht um `drehung` (Grad, im Uhrzeigersinn ab Nord) — wie
 *                 `icon-pitch-alignment: map` / `icon-rotation-alignment: map` (Symbol, Pfeil, Kugel)
 *   karte: false  aufrecht zur Kamera, feste Bildpunktgröße — wie `…-alignment: viewport` (Fahrzeugfoto, eigenes Bild)
 *
 *   const p = rzPunkt3d.create("flug-3d-laufpunkt"); map.addLayer(p);
 *   p.setPunkt({ lng, lat, agl, bild, bildKey, cssPx, drehung, karte, deckkraft });   // bild: {width,height,data} | Image | Canvas
 *   p.setPunkt(null);                                                                  // ausblenden
 *
 * Projektion wie rz-line3d (MapLibre-Prelude, auch Globus); keine Tiefenprüfung — der Punkt bleibt sichtbar wie vorher.
 */
(function () {
  "use strict";

  const VS_BODY = `
in vec2 a_ecke;              // -1…1 (x rechts, y oben im Bild)
uniform vec3 u_mitte;        // Merkator xyz der Mitte (z in Merkator-Einheiten)
uniform float u_hoehe;       // Höhe der Mitte in Metern (Globus)
uniform float u_halbMerc;    // halbe Kantenlänge in Merkator-Einheiten (karte)
uniform float u_halbPx;      // halbe Kantenlänge in Gerätepixeln (kamera)
uniform float u_dreh;        // Drehung im Bogenmaß, im Uhrzeigersinn ab Nord
uniform float u_karte;       // 1 = flach in der Karte, 0 = aufrecht zur Kamera
uniform vec2 u_res;
out vec2 v_uv;
vec4 rzProject(vec3 posMerc, float elevM) {
#ifdef GLOBE
  vec2 posInTile = posMerc.xy;
  vec3 sphere = projectToSphere(posInTile);
  return interpolateProjection(posInTile, sphere, elevM);
#else
  return u_projection_matrix * vec4(posMerc, 1.0);
#endif
}
void main() {
  v_uv = vec2((a_ecke.x + 1.0) * 0.5, (1.0 - a_ecke.y) * 0.5);
  if (u_karte > 0.5) {
    // Merkator-y wächst nach Süden: „oben“ im Bild = Norden = −y, gedreht im Uhrzeigersinn
    float s = sin(u_dreh), c = cos(u_dreh);
    vec2 rechts = vec2(c, s), oben = vec2(s, -c);
    vec2 off = (rechts * a_ecke.x + oben * a_ecke.y) * u_halbMerc;
    gl_Position = rzProject(u_mitte + vec3(off, 0.0), u_hoehe);
  } else {
    vec4 p = rzProject(u_mitte, u_hoehe);
    gl_Position = p + vec4(a_ecke * u_halbPx / (u_res * 0.5) * p.w, 0.0, 0.0);
  }
}`;

  const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_bild;
uniform float u_deckkraft;
out vec4 fragColor;
void main() {
  vec4 c = texture(u_bild, v_uv);
  float a = c.a * u_deckkraft;
  if (a <= 0.002) discard;
  fragColor = vec4(c.rgb * a, a);   // premultiplied (MapLibre-Blend)
}`;

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error("rz-punkt3d Shader: " + gl.getShaderInfoLog(s));
    return s;
  }

  function create(id) {
    const layer = {
      id, type: "custom", renderingMode: "3d",
      _map: null, _gl: null, _prog: null, _punkt: null, _tex: null, _texKey: null, _vbo: null,
      onAdd(map, gl) { this._map = map; this._gl = gl; },
      onRemove(map, gl) {
        try { if (this._tex) gl.deleteTexture(this._tex); if (this._vbo) gl.deleteBuffer(this._vbo); if (this._prog) gl.deleteProgram(this._prog); } catch (_) {}
        this._tex = this._vbo = this._prog = null;
      },
      /** p = {lng, lat, agl (m über Grund), bild, bildKey, cssPx (Kantenlänge in CSS-Pixeln), drehung, karte, deckkraft} | null */
      setPunkt(p) {
        this._punkt = p || null;
        try { this._map && this._map.triggerRepaint(); } catch (_) {}
      },
      _compile(gl, sd) {
        const define = sd ? String(sd.define || "") : "";
        const prelude = sd ? String(sd.vertexShaderPrelude || "") : "uniform mat4 u_projection_matrix;\n";
        const vs = compile(gl, gl.VERTEX_SHADER, "#version 300 es\nprecision highp float;\n" + define + "\n" + prelude + "\n" + VS_BODY);
        const fs = compile(gl, gl.FRAGMENT_SHADER, FS);
        const p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("rz-punkt3d Link: " + gl.getProgramInfoLog(p));
        if (this._prog) { try { gl.deleteProgram(this._prog); } catch (_) {} }
        this._prog = p; this._define = define;
        const U = (n) => gl.getUniformLocation(p, n);
        this._loc = { ecke: gl.getAttribLocation(p, "a_ecke"), matrix: U("u_projection_matrix"), fallback: U("u_projection_fallback_matrix"),
                      tileMerc: U("u_projection_tile_mercator_coords"), clip: U("u_projection_clipping_plane"), transition: U("u_projection_transition"),
                      mitte: U("u_mitte"), hoehe: U("u_hoehe"), halbMerc: U("u_halbMerc"), halbPx: U("u_halbPx"), dreh: U("u_dreh"),
                      karte: U("u_karte"), res: U("u_res"), bild: U("u_bild"), deckkraft: U("u_deckkraft") };
        if (!this._vbo) {
          this._vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this._vbo);
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        }
      },
      _textur(gl, p) {
        const key = p.bildKey || p.bild;
        // jedes Bild binden — MapLibre lässt auf Einheit 0 seine eigenen Texturen liegen
        if (this._tex && this._texKey === key) { gl.bindTexture(gl.TEXTURE_2D, this._tex); return true; }
        const b = p.bild;
        if (!b) return false;
        if (!this._tex) this._tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this._tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        try {
          if (b.data && b.width && b.height && !(window.HTMLImageElement && b instanceof window.HTMLImageElement)) {
            const d = b.data instanceof Uint8Array ? b.data : new Uint8Array(b.data.buffer, b.data.byteOffset || 0, b.width * b.height * 4);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, b.width, b.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, d);
          } else {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, b);
          }
        } catch (e) { console.warn("rz-punkt3d Bild: " + e); return false; }
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        this._texKey = key;
        return true;
      },
      _ueberhoehung() {
        try { const tr = this._map && this._map.getTerrain && this._map.getTerrain(); return (tr && +tr.exaggeration) || 1; } catch (_) { return 1; }
      },
      /** Höhe der Mitte in Metern: Gelände + Höhe über Grund × Überhöhung (mindestens ~3 Bildpunkte, wie rz-line3d) */
      hoeheBei(p) {
        const m = this._map;
        let boden = 0;
        try { if (m.getTerrain && m.getTerrain() && m.queryTerrainElevation) { const e = m.queryTerrainElevation({ lng: p.lng, lat: p.lat }); if (typeof e === "number" && isFinite(e)) boden = e; } } catch (_) {}
        let aglMin = 0;
        try { aglMin = 3 * 78271.517 * Math.cos(p.lat * Math.PI / 180) / Math.pow(2, m.getZoom()); } catch (_) {}
        return boden + Math.max(aglMin, Math.max(0, +p.agl || 0) * this._ueberhoehung());
      },
      render(gl, args) {
        const p = this._punkt, MC = window.maplibregl && window.maplibregl.MercatorCoordinate;
        if (!p || !MC || !this._map) return;
        const m = (args && args.defaultProjectionData && args.defaultProjectionData.mainMatrix) ? args.defaultProjectionData.mainMatrix : args;
        if (!m || m.length !== 16) return;
        const sd = args && args.shaderData, define = sd ? String(sd.define || "") : "";
        if (!this._prog || this._define !== define) { try { this._compile(gl, sd); } catch (e) { console.warn(String(e)); return; } }
        gl.useProgram(this._prog);
        gl.activeTexture(gl.TEXTURE0);
        if (!this._textur(gl, p)) return;
        const h = this.hoeheBei(p);
        const mc = MC.fromLngLat([p.lng, p.lat], h);
        const pr = (this._map.getPixelRatio) ? this._map.getPixelRatio() : (window.devicePixelRatio || 1);
        let welt = 512 * Math.pow(2, this._map.getZoom());   // Weltbreite in CSS-Pixeln
        try { const t = this._map.transform; if (t && t.worldSize) welt = t.worldSize; } catch (_) {}
        const L = this._loc, px = Math.max(1, +p.cssPx || 24);
        gl.uniformMatrix4fv(L.matrix, false, m);
        const pd = args && args.defaultProjectionData;
        if (pd) {
          if (L.fallback && pd.fallbackMatrix) gl.uniformMatrix4fv(L.fallback, false, pd.fallbackMatrix);
          if (L.tileMerc && pd.tileMercatorCoords) gl.uniform4fv(L.tileMerc, pd.tileMercatorCoords);
          if (L.clip && pd.clippingPlane) gl.uniform4fv(L.clip, pd.clippingPlane);
          if (L.transition != null) gl.uniform1f(L.transition, +pd.projectionTransition || 0);
        }
        gl.uniform3f(L.mitte, mc.x, mc.y, mc.z);
        gl.uniform1f(L.hoehe, h);
        gl.uniform1f(L.halbMerc, (px / 2) / welt);
        gl.uniform1f(L.halbPx, (px / 2) * pr);
        gl.uniform1f(L.dreh, (+p.drehung || 0) * Math.PI / 180);
        gl.uniform1f(L.karte, p.karte === false ? 0 : 1);
        gl.uniform2f(L.res, gl.canvas.width, gl.canvas.height);
        gl.uniform1i(L.bild, 0);
        gl.uniform1f(L.deckkraft, p.deckkraft == null ? 1 : +p.deckkraft);
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._vbo);
        gl.enableVertexAttribArray(L.ecke); gl.vertexAttribPointer(L.ecke, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.disableVertexAttribArray(L.ecke);
        this._gezeichnet = (this._gezeichnet || 0) + 1;   // Prüfstand
      },
    };
    return layer;
  }

  const api = { create };
  if (typeof window !== "undefined") window.rzPunkt3d = api;
})();
