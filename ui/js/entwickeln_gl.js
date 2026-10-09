/* Fotos entwickeln in der Grafikkarte — Live-Vorschau der Lupe (09.10.2026).
 *
 * Dieselben Rechnungen wie core/entwickeln.py (`_ton`, `geometrie`, `passend`, `einpassen`) — bei Änderung beide
 * pflegen; test_entwickeln_gl vergleicht die Ergebnisse Pixel für Pixel. Python bleibt zuständig für alles, was
 * gespeichert wird (Raster, Export, Video), und springt ein, wenn WebGL 2 fehlt.
 *
 * Ablauf je Bild: Quelle → V1 (Weißabgleich, Belichtung) → [Dunst: Minimum-Kanal weich → V2] → Helligkeit weich
 * (Basis) → [Klarheit: Helligkeit nach Lichter/Tiefen weich] → Endpass mit Lichter, Tiefen, Klarheit, Kontrast,
 * Dynamik, Sättigung und der Geometrie (90°, Geraderichten, Zuschnitt). Weichzeichnen läuft verkleinert (÷ F).
 */
(function () {
  "use strict";

  const GEOMETRIE = ["drehen90", "gerade", "zuschnitt"];
  const REGLER = {
    belichtung: [-3, 3], kontrast: [-100, 100], lichter: [-100, 100], tiefen: [-100, 100], temperatur: [-100, 100],
    toenung: [-100, 100], dynamik: [-100, 100], saettigung: [-100, 100], klarheit: [-100, 100], dunst: [-100, 100],
  };

  // ── Rezept (wie entwickeln.sauber / wirksam) ────────────────────────────────────────────
  function geoSauber(rz) {
    const raus = {};
    const d = ((parseInt(rz && rz.drehen90, 10) || 0) % 4 + 4) % 4;
    if (d) raus.drehen90 = d;
    const g = Math.max(-45, Math.min(45, +((rz && rz.gerade) || 0) || 0));
    if (Math.abs(g) >= 0.01) raus.gerade = Math.round(g * 100) / 100;
    const z = rz && rz.zuschnitt;
    if (Array.isArray(z) && z.length === 4 && z.every(v => isFinite(+v))) {
      let [x, y, b, h] = z.map(Number);
      b = Math.max(0.02, Math.min(1, b)); h = Math.max(0.02, Math.min(1, h));
      x = Math.max(0, Math.min(1 - b, x)); y = Math.max(0, Math.min(1 - h, y));
      if (!(x < 1e-4 && y < 1e-4 && b > 0.9999 && h > 0.9999)) raus.zuschnitt = [x, y, b, h].map(v => Math.round(v * 1e5) / 1e5);
    }
    return raus;
  }
  /** Rezept + Auto-Werte + Voreinstellung → wirksame Werte (Ton + Geometrie). */
  function wirksam(rz, auto, voreinst) {
    rz = rz || {};
    const basis = (rz.stil && voreinst && voreinst[rz.stil]) || {};
    const raus = {};
    if ((rz.auto || basis.auto) && auto) Object.assign(raus, auto);
    Object.keys(REGLER).forEach(k => {
      const v = (+basis[k] || 0) + (+rz[k] || 0);
      if (v) raus[k] = (raus[k] || 0) + v;
    });
    Object.keys(REGLER).forEach(k => {
      if (raus[k] == null) return;
      const [lo, hi] = REGLER[k];
      raus[k] = Math.max(lo, Math.min(hi, raus[k]));
      if (Math.abs(raus[k]) <= 1e-6) delete raus[k];
    });
    return Object.assign(raus, geoSauber(rz));
  }

  // ── Geometrie (wie entwickeln.passend / _drinnen / einpassen) ────────────────────────────
  const rahmenMasse = (w, h, d) => ((d || 0) % 2 ? [h, w] : [w, h]);
  function passend(W, H, grad, seite) {
    const t = Math.abs((grad || 0) * Math.PI / 180), c = Math.cos(t), s = Math.sin(t);
    const A = seite || W / H;
    const b = Math.min(W / (c + s / A), H / (s + c / A), W, H * A), h = b / A;
    return [(W - b) / 2 / W, (H - h) / 2 / H, b / W, h / H];
  }
  function drinnen(r, W, H, grad) {
    const th = (grad || 0) * Math.PI / 180, co = Math.cos(th), si = Math.sin(th);
    const cx = W / 2, cy = H / 2, eps = 1e-3 * Math.max(W, H);
    for (const [px, py] of [[r[0], r[1]], [r[0] + r[2], r[1]], [r[0], r[1] + r[3]], [r[0] + r[2], r[1] + r[3]]]) {
      const dx = px * W - cx, dy = py * H - cy;
      const qx = cx + dx * co + dy * si, qy = cy - dx * si + dy * co;
      if (qx < -eps || qx > W + eps || qy < -eps || qy > H + eps) return false;
    }
    return true;
  }
  function einpassen(r, W, H, grad) {
    r = r.map(Number);
    if (drinnen(r, W, H, grad)) return r;
    let mx = r[0] + r[2] / 2, my = r[1] + r[3] / 2;
    if (!drinnen([mx, my, 0, 0], W, H, grad)) { mx = 0.5; my = 0.5; }
    let lo = 0, hi = 1;
    for (let i = 0; i < 24; i++) {
      const m = (lo + hi) / 2;
      if (drinnen([mx - r[2] * m / 2, my - r[3] * m / 2, r[2] * m, r[3] * m], W, H, grad)) lo = m; else hi = m;
    }
    return [mx - r[2] * lo / 2, my - r[3] * lo / 2, r[2] * lo, r[3] * lo];
  }
  /** Zuschnitt, der gerade gilt (ohne eigenen: der größte im Seitenverhältnis des Bildes). */
  function zuschnittWirksam(werte, W, H) {
    const g = werte.gerade || 0;
    return einpassen(werte.zuschnitt || passend(W, H, g), W, H, g);
  }

  // ── WebGL 2 ─────────────────────────────────────────────────────────────────────────────
  const VS = `#version 300 es
in vec2 p; out vec2 uv;
void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
  const KOPF = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv; out vec4 o;
float lin1(float v) { return v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4); }
vec3 lin(vec3 c) { return vec3(lin1(c.r), lin1(c.g), lin1(c.b)); }
float srgb1(float v) { v = max(v, 0.0); return v <= 0.0031308 ? v * 12.92 : 1.055 * pow(v, 1.0 / 2.4) - 0.055; }
vec3 srgb(vec3 c) { return vec3(srgb1(c.r), srgb1(c.g), srgb1(c.b)); }
float luma(vec3 c) { return c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722; }
float glatt(float x, float a, float b) { float t = clamp((x - a) / max(1e-6, b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
uniform float li, ti;
float tonLT(float l, float b) {
  if (li != 0.0) { float m = glatt(b, 0.45, 0.95); l = l + li * 0.35 * m * (li < 0.0 ? l : 1.0 - l); }
  if (ti != 0.0) { float m = 1.0 - glatt(b, 0.05, 0.55); l = l + ti * 0.4 * m * (ti > 0.0 ? 1.0 - l : l); }
  return l;
}
`;
  const FS = {
    // Weißabgleich + Belichtung (linear), zurück nach sRGB, abgeschnitten
    v1: KOPF + `uniform sampler2D q; uniform vec3 wb; uniform float bel;
void main() { vec3 a = lin(texture(q, uv).rgb) * wb * exp2(bel); o = vec4(clamp(srgb(a), 0.0, 1.0), 1.0); }`,
    // Verkleinern um F: 0 = Helligkeit, 1 = Minimum-Kanal, 2 = Punkt (rgb, für das Perzentil), 3 = Rot-Kanal
    klein: KOPF + `uniform sampler2D q; uniform int F; uniform int modus;
void main() {
  ivec2 b = ivec2(gl_FragCoord.xy) * F; ivec2 gr = textureSize(q, 0) - 1;
  if (modus == 2) { o = vec4(texelFetch(q, min(b, gr), 0).rgb, 1.0); return; }
  float s = 0.0;
  for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++) {
    if (x >= F || y >= F) continue;
    vec3 c = texelFetch(q, min(b + ivec2(x, y), gr), 0).rgb;
    s += modus == 1 ? min(c.r, min(c.g, c.b)) : (modus == 3 ? c.r : luma(c));
  }
  o = vec4(vec3(s / float(F * F)), 1.0);
}`,
    // Gauß, eine Richtung (sigma in Pixeln der verkleinerten Fläche)
    weich: KOPF + `uniform sampler2D q; uniform vec2 dir; uniform float sigma;
void main() {
  vec2 px = dir / vec2(textureSize(q, 0));
  float r = ceil(sigma * 3.0), s = 0.0, w = 0.0;
  for (int i = -90; i <= 90; i++) {
    float f = float(i); if (abs(f) > r) continue;
    float k = exp(-0.5 * f * f / (sigma * sigma));
    s += texture(q, uv + px * f).r * k; w += k;
  }
  o = vec4(vec3(s / w), 1.0);
}`,
    // Dunst über den weichen Dunkelkanal
    dunst: KOPF + `uniform sampler2D v1; uniform sampler2D dc; uniform float k; uniform float luft;
void main() {
  vec3 v = texture(v1, uv).rgb;
  if (k > 0.0) { float d = clamp(texture(dc, uv).r * 0.85 * k, 0.0, 0.9); v = (v - luft * d) / clamp(1.0 - d, 0.1, 1.0); }
  else { v = v * (1.0 + k * 0.35) + (-k) * 0.35 * luft; }
  o = vec4(clamp(v, 0.0, 1.0), 1.0);
}`,
    // Helligkeit nach Lichter/Tiefen — Grundlage der Klarheit
    l2: KOPF + `uniform sampler2D v2; uniform sampler2D basis;
void main() { vec3 v = texture(v2, uv).rgb; o = vec4(vec3(tonLT(luma(v), texture(basis, uv).r)), 1.0); }`,
    ende: KOPF + `uniform sampler2D v2; uniform sampler2D basis; uniform sampler2D detb;
uniform float kl, ko, sat, dyn, th, flip; uniform int d90; uniform vec4 rect; uniform vec2 rahmen;
void main() {
  vec2 u = vec2(uv.x, flip > 0.5 ? 1.0 - uv.y : uv.y);
  vec2 p = (rect.xy + u * rect.zw) * rahmen, c = rahmen * 0.5, d = p - c;
  float co = cos(th), si = sin(th);
  vec2 f = (c + vec2(d.x * co + d.y * si, -d.x * si + d.y * co)) / rahmen;
  if (f.x < 0.0 || f.y < 0.0 || f.x > 1.0 || f.y > 1.0) { o = vec4(vec3(24.0 / 255.0), 1.0); return; }
  vec2 s = d90 == 1 ? vec2(f.y, 1.0 - f.x) : (d90 == 2 ? vec2(1.0 - f.x, 1.0 - f.y) : (d90 == 3 ? vec2(1.0 - f.y, f.x) : f));
  vec3 v = texture(v2, s).rgb; float b = texture(basis, s).r;
  float l0 = luma(v), l = tonLT(l0, b);
  if (kl != 0.0) { float det = l - texture(detb, s).r; l = l + kl * 1.2 * det * clamp(1.0 - abs(b - 0.5) * 1.6, 0.0, 1.0); }
  if (ko != 0.0) { float x = clamp(l, 0.0, 1.0); float sm = x * x * (3.0 - 2.0 * x); l = ko > 0.0 ? x + ko * 1.6 * (sm - x) : x + ko * 0.6 * (x - 0.5); }
  l = clamp(l, 0.0, 1.2);
  float fk = clamp(l / max(l0, 1e-4), 0.0, 3.0), w = 1.0 - glatt(l0, 0.02, 0.18);
  v = clamp((v * fk) * (1.0 - w) + (v + (l - l0)) * w, 0.0, 1.0);
  float lum = luma(v), sk = 1.0 + sat;
  if (dyn != 0.0) { float sj = max(v.r, max(v.g, v.b)) - min(v.r, min(v.g, v.b)); sk *= 1.0 + dyn * (1.0 - clamp(sj * 1.6, 0.0, 1.0)); }
  o = vec4(clamp(lum + (v - lum) * sk, 0.0, 1.0), 1.0);
}`,
  };

  class EntwicklerGL {
    static geht() {
      try { const c = document.createElement("canvas"); const g = c.getContext("webgl2"); if (!g) return false; const e = g.getExtension("WEBGL_lose_context"); if (e) e.loseContext(); return true; }
      catch (_) { return false; }
    }
    constructor(canvas) {
      this.canvas = canvas || document.createElement("canvas");
      const gl = this.canvas.getContext("webgl2", { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: false, alpha: false });
      if (!gl) throw new Error("WebGL 2 fehlt");
      this.gl = gl;
      this.verloren = false;
      this.canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); this.verloren = true; });
      // halbe Gleitkommazahlen als Zwischenstufen, sonst 8 Bit
      this.fmt = gl.getExtension("EXT_color_buffer_float") ? [gl.RGBA16F, gl.HALF_FLOAT] : [gl.RGBA8, gl.UNSIGNED_BYTE];
      this.prog = {};
      Object.keys(FS).forEach(k => { this.prog[k] = this._programm(FS[k]); });
      const buf = this.buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      this.ziele = {};
      this.merk = {};
    }
    _programm(fs) {
      const gl = this.gl;
      const sh = (typ, src) => { const s = gl.createShader(typ); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      const p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
      gl.bindAttribLocation(p, 0, "p"); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      return { p, u: {} };
    }
    _tex(w, h, fmt) {
      const gl = this.gl, t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, fmt[0], w, h, 0, gl.RGBA, fmt[1], null);
      [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach(k => gl.texParameteri(gl.TEXTURE_2D, k, gl.LINEAR));
      [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(k => gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE));
      return t;
    }
    /** Zielfläche (Textur + Framebuffer), je Name gemerkt und bei neuer Größe neu angelegt. */
    _ziel(name, w, h, fmt) {
      const gl = this.gl;
      let z = this.ziele[name];
      if (z && z.w === w && z.h === h) return z;
      if (z) { gl.deleteTexture(z.t); gl.deleteFramebuffer(z.fb); }
      const t = this._tex(w, h, fmt || this.fmt), fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      z = this.ziele[name] = { t, fb, w, h };
      return z;
    }
    _pass(name, ziel, texturen, uniforms) {
      const gl = this.gl, pr = this.prog[name];
      gl.useProgram(pr.p);
      gl.bindFramebuffer(gl.FRAMEBUFFER, ziel ? ziel.fb : null);
      const w = ziel ? ziel.w : this.canvas.width, h = ziel ? ziel.h : this.canvas.height;
      gl.viewport(0, 0, w, h);
      let i = 0;
      Object.entries(texturen).forEach(([n, t]) => {
        gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t);
        gl.uniform1i(this._ort(pr, n), i); i++;
      });
      Object.entries(uniforms || {}).forEach(([n, v]) => {
        const ort = this._ort(pr, n); if (ort == null) return;
        if (n === "F" || n === "modus" || n === "d90") gl.uniform1i(ort, v);
        else if (Array.isArray(v)) gl[`uniform${v.length}fv`](ort, v);
        else gl.uniform1f(ort, v);
      });
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    _ort(pr, n) { if (!(n in pr.u)) pr.u[n] = this.gl.getUniformLocation(pr.p, n); return pr.u[n]; }

    /** Quelle setzen (Bild oder Canvas, sRGB, schon richtig gedreht). */
    quelle(bild) {
      const gl = this.gl;
      if (this.q) gl.deleteTexture(this.q);
      this.W = bild.naturalWidth || bild.width; this.H = bild.naturalHeight || bild.height;
      this.q = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.q);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bild);
      [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach(k => gl.texParameteri(gl.TEXTURE_2D, k, gl.LINEAR));
      [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(k => gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE));
      this.merk = {};
      const g = Math.max(this.W, this.H);
      this.F = g >= 1000 ? 4 : (g >= 500 ? 2 : 1);
    }

    /** Zwischenstufen bis vor den Endpass — nur neu, was sich geändert hat. */
    _stufen(w) {
      const W = this.W, H = this.H, F = this.F, g = Math.max(W, H);
      const kw = Math.max(1, Math.ceil(W / F)), kh = Math.max(1, Math.ceil(H / F));
      const t = (w.temperatur || 0) / 100, tn = (w.toenung || 0) / 100, bel = w.belichtung || 0;
      const k1 = [t, tn, bel].join(",");
      if (this.merk.v1 !== k1) {
        this._pass("v1", this._ziel("v1", W, H), { q: this.q }, { wb: [1 + 0.25 * t, 1 - 0.18 * tn, 1 - 0.25 * t], bel });
        this.merk = { v1: k1 };
      }
      let v2 = this.ziele.v1;
      const dunst = (w.dunst || 0) / 100;
      if (dunst) {
        const k2 = k1 + "|" + dunst;
        if (this.merk.v2 !== k2) {
          if (this.merk.luftVon !== k1) {   // Perzentil 99,5 des hellsten Kanals — aus einer Punkt-Stichprobe
            const pz = this._ziel("punkt", kw, kh, [this.gl.RGBA8, this.gl.UNSIGNED_BYTE]);
            this._pass("klein", pz, { q: this.ziele.v1.t }, { F, modus: 2 });
            const px = new Uint8Array(kw * kh * 4);
            this.gl.readPixels(0, 0, kw, kh, this.gl.RGBA, this.gl.UNSIGNED_BYTE, px);
            const zahl = new Uint32Array(256);
            for (let i = 0; i < px.length; i += 4) zahl[Math.max(px[i], px[i + 1], px[i + 2])]++;
            let rest = kw * kh * 0.005, v = 255;
            while (v > 0 && rest > zahl[v]) { rest -= zahl[v]; v--; }
            this.merk.luft = v / 255; this.merk.luftVon = k1;
          }
          const mn = this._ziel("min", kw, kh), mt = this._ziel("minT", kw, kh), dc = this._ziel("dc", kw, kh);
          const sig = g / 60 / F;
          this._pass("klein", mn, { q: this.ziele.v1.t }, { F, modus: 1 });
          this._pass("weich", mt, { q: mn.t }, { dir: [1, 0], sigma: sig });
          this._pass("weich", dc, { q: mt.t }, { dir: [0, 1], sigma: sig });
          this._pass("dunst", this._ziel("v2", W, H), { v1: this.ziele.v1.t, dc: dc.t }, { k: dunst, luft: this.merk.luft });
          this.merk.v2 = k2; this.merk.basis = null;
        }
        v2 = this.ziele.v2;
      } else if (this.merk.v2 !== null) { this.merk.v2 = null; this.merk.basis = null; }
      if (this.merk.basis !== this.merk.v2 + "|" + k1) {
        const lk = this._ziel("lk", kw, kh), lt = this._ziel("lt", kw, kh), b = this._ziel("basis", kw, kh);
        this._pass("klein", lk, { q: v2.t }, { F, modus: 0 });
        this._pass("weich", lt, { q: lk.t }, { dir: [1, 0], sigma: g / 90 / F });
        this._pass("weich", b, { q: lt.t }, { dir: [0, 1], sigma: g / 90 / F });
        this.merk.basis = this.merk.v2 + "|" + k1; this.merk.det = null;
      }
      const li = (w.lichter || 0) / 100, ti = (w.tiefen || 0) / 100;
      if ((w.klarheit || 0) && this.merk.det !== this.merk.basis + "|" + li + "|" + ti) {
        const l2 = this._ziel("l2", W, H), dk = this._ziel("dk", kw, kh), dt = this._ziel("dt", kw, kh), det = this._ziel("det", kw, kh);
        this._pass("l2", l2, { v2: v2.t, basis: this.ziele.basis.t }, { li, ti });
        this._pass("klein", dk, { q: l2.t }, { F, modus: 3 });
        this._pass("weich", dt, { q: dk.t }, { dir: [1, 0], sigma: g / 120 / F });
        this._pass("weich", det, { q: dt.t }, { dir: [0, 1], sigma: g / 120 / F });
        this.merk.det = this.merk.basis + "|" + li + "|" + ti;
      }
      return v2;
    }
    _ende(w, ziel, rahmen, flip) {
      const [Wr, Hr] = rahmenMasse(this.W, this.H, w.drehen90 || 0);
      const rect = rahmen ? [0, 0, 1, 1] : ((w.gerade || w.zuschnitt) ? zuschnittWirksam(w, Wr, Hr) : [0, 0, 1, 1]);
      const v2 = this._stufen(w);
      this._pass("ende", ziel, { v2: v2.t, basis: this.ziele.basis.t, detb: (this.ziele.det || this.ziele.basis).t }, {
        li: (w.lichter || 0) / 100, ti: (w.tiefen || 0) / 100, kl: (w.klarheit || 0) / 100, ko: (w.kontrast || 0) / 100,
        sat: (w.saettigung || 0) / 100, dyn: (w.dynamik || 0) / 100, th: (w.gerade || 0) * Math.PI / 180, flip: flip ? 1 : 0,
        d90: w.drehen90 || 0, rect, rahmen: [Wr, Hr],
      });
      return { rect, Wr, Hr };
    }
    /** Entwickeln ins Canvas. `rahmen` = der ganze gedrehte Rahmen (Zuschneiden-Werkzeug). Rückgabe Größe + Zuschnitt. */
    zeichnen(werte, opt) {
      opt = opt || {};
      const w = werte || {};
      const [Wr, Hr] = rahmenMasse(this.W, this.H, w.drehen90 || 0);
      const rect = opt.rahmen ? [0, 0, 1, 1] : ((w.gerade || w.zuschnitt) ? zuschnittWirksam(w, Wr, Hr) : [0, 0, 1, 1]);
      const bw = Math.max(1, Math.round(rect[2] * Wr)), bh = Math.max(1, Math.round(rect[3] * Hr));
      if (this.canvas.width !== bw) this.canvas.width = bw;
      if (this.canvas.height !== bh) this.canvas.height = bh;
      const r = this._ende(w, null, !!opt.rahmen, true);
      return { breite: bw, hoehe: bh, rect: r.rect, Wr, Hr };
    }
    /** Histogramm (64 Stufen je Kanal) des entwickelten Bildes — aus einer verkleinerten Fassung. */
    histogramm(werte, opt) {
      const gl = this.gl, w = werte || {};
      const [Wr, Hr] = rahmenMasse(this.W, this.H, w.drehen90 || 0);
      const s = Math.min(1, 320 / Math.max(Wr, Hr));
      const z = this._ziel("hist", Math.max(1, Math.round(Wr * s)), Math.max(1, Math.round(Hr * s)), [gl.RGBA8, gl.UNSIGNED_BYTE]);
      this._ende(w, z, !!(opt && opt.rahmen), false);
      const px = new Uint8Array(z.w * z.h * 4);
      gl.readPixels(0, 0, z.w, z.h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const h = { r: new Array(64).fill(0), g: new Array(64).fill(0), b: new Array(64).fill(0) };
      for (let i = 0; i < px.length; i += 4) { h.r[px[i] >> 2]++; h.g[px[i + 1] >> 2]++; h.b[px[i + 2] >> 2]++; }
      return h;
    }
    weg() {
      try { const e = this.gl.getExtension("WEBGL_lose_context"); if (e) e.loseContext(); } catch (_) {}
      this.ziele = {}; this.q = null;
    }
  }

  window.rzEntwickler = { wirksam, geoSauber, passend, drinnen, einpassen, zuschnittWirksam, rahmenMasse, GEOMETRIE, EntwicklerGL };
})();
