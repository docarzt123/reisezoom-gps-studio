/* Reisezoom GPS Studio — Sternenhimmel hinter der Weltkugel.
 * 04.09.2026: festes 512×512-PNG (Beta-Tester: „in der Kugel-Ansicht fehlen die
 * schönen Sterne"). 05.09.2026 (Beta-Tester: „etwas groß geraten und nicht
 * animiert"): jetzt erzeugt, mit Reglern für Dichte und Größe und dezentem
 * Funkeln. Gleicher Zufallssamen → Vorschau und Render zeigen dieselben Sterne.
 * Wird in ui/index.html geladen und von core/animator.py ins Render-HTML
 * eingebettet; MapLibre hat keinen eigenen Himmel wie Mapbox Standard.
 *
 *   window.rzStarsApply(container, opts)   Hintergrund + Funkel-Ebenen setzen
 *   window.rzStarsTick(container, tSec)    Funkeln für einen Zeitpunkt (Render)
 *   opts = { enabled, density 0..100, size 0..100, twinkle }
 */
(function () {
  const DEF = { enabled: true, density: 50, size: 50, twinkle: true };
  const TILE = 512;
  function norm(o) {
    const r = Object.assign({}, DEF, o || {});
    r.enabled = r.enabled !== false && r.enabled !== "false" && r.enabled !== 0;
    r.twinkle = r.twinkle !== false && r.twinkle !== "false" && r.twinkle !== 0;
    r.density = Math.max(0, Math.min(100, +r.density || 0));
    r.size = Math.max(0, Math.min(100, +r.size || 0));
    return r;
  }
  // Mulberry32 — kleiner, deterministischer Zufall (gleiche Sterne überall).
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const cache = {};
  /** Kachel als data-URL. `layer` 0 = ruhiger Grundhimmel, 1..3 = Funkel-Teilmengen. */
  function tile(o, layer) {
    const key = [o.density, o.size, layer].join("|");
    if (cache[key]) return cache[key];
    const cv = document.createElement("canvas"); cv.width = cv.height = TILE;
    const ctx = cv.getContext("2d");
    if (layer === 0) { ctx.fillStyle = "#05070d"; ctx.fillRect(0, 0, TILE, TILE); }
    // Dichte 0..100 → 40..520 Sterne je Kachel; Größe 0..100 → Radius ×0.4..×1.6
    const n = Math.round(40 + o.density / 100 * 480);
    const k = 0.4 + o.size / 100 * 1.2;
    const r = rng(20260905 + layer * 7919);
    for (let i = 0; i < n; i++) {
      const x = r() * TILE, y = r() * TILE, u = r();
      const rad = (u < 0.85 ? 0.35 + r() * 0.5 : u < 0.97 ? 0.8 + r() * 0.6 : 1.3 + r() * 0.8) * k;
      const a = u < 0.85 ? 0.35 + r() * 0.4 : 0.7 + r() * 0.3;
      const warm = r();
      const col = warm < 0.2 ? "255,236,210" : warm < 0.35 ? "200,220,255" : "255,255,255";
      // Funkel-Ebenen: nur jeder dritte Stern, verteilt auf drei Phasen
      if (layer > 0 && (i % 3) !== (layer - 1)) continue;
      if (layer > 0 && u < 0.5) continue;   // die ganz schwachen funkeln nicht
      ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(" + col + "," + (layer > 0 ? Math.min(1, a + 0.3) : a).toFixed(2) + ")";
      ctx.fill();
    }
    return (cache[key] = cv.toDataURL("image/png"));
  }
  function css(o) {
    o = norm(o);
    if (!o.enabled) return "#05070d";
    return "#05070d url(" + tile(o, 0) + ") repeat";
  }
  const PERIOD = [2.3, 3.1, 4.7], PHASE = [0, 2.1, 4.2];
  function tick(container, tSec) {
    const st = container && container.__rzStars; if (!st || !st.layers) return;
    for (let i = 0; i < st.layers.length; i++) {
      const w = 0.5 + 0.5 * Math.sin(2 * Math.PI * tSec / PERIOD[i] + PHASE[i]);
      st.layers[i].style.opacity = (0.15 + 0.85 * w).toFixed(3);
    }
  }
  function apply(container, opts) {
    if (!container) return;
    const o = norm(opts);
    container.style.background = css(o);
    let st = container.__rzStars;
    if (!st) st = container.__rzStars = { layers: [], raf: 0 };
    const want = o.enabled && o.twinkle;
    if (!want) {
      st.layers.forEach(el => el.remove()); st.layers = [];
      if (st.raf) { cancelAnimationFrame(st.raf); st.raf = 0; }
      return;
    }
    if (!st.layers.length) {
      for (let i = 1; i <= 3; i++) {
        const el = document.createElement("div");
        el.className = "rz-stars-twinkle";
        el.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:0;background-repeat:repeat;";
        container.insertBefore(el, container.firstChild);
        st.layers.push(el);
      }
    }
    st.layers.forEach((el, i) => { el.style.backgroundImage = "url(" + tile(o, i + 1) + ")"; });
    // Vorschau: eigener Takt. Render (window.__rzStarsManual): advanceFrame ruft rzStarsTick.
    if (!window.__rzStarsManual && !st.raf) {
      const t0 = performance.now();
      const step = () => { if (!container.__rzStars || !container.__rzStars.layers.length) { st.raf = 0; return; }
        tick(container, (performance.now() - t0) / 1000); st.raf = requestAnimationFrame(step); };
      st.raf = requestAnimationFrame(step);
    }
    tick(container, 0);
  }
  window.rzStarsDefaults = DEF;
  window.rzStarsCss = css;
  window.rzStarsApply = apply;
  window.rzStarsTick = tick;
  // Kompatibilität (util.js / animator.py vor 05.09.2026)
  Object.defineProperty(window, "RZ_STARS_CSS", { get: () => css(window.__rzStarsOpts), configurable: true });
})();
