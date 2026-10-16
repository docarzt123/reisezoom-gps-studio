/* Tempo-Farben: die gefahrene Strecke nach Geschwindigkeit färben (17.10.2026).
 *
 * Die Roh-Geschwindigkeit je Punkt springt (GPS-Rauschen, Stillstand). Hier wird sie über ein zentriertes
 * Zeitfenster aus Distanz und Zeit neu gerechnet:
 *
 *   v_i = (Strecke im Fenster) / (Zeit im Fenster) · 3,6      Fenster = [t_i − F/2, t_i + F/2], am Rand gekürzt
 *
 * Die Skala endet beim 98. Perzentil, damit einzelne Ausreißer nicht die ganze Linie blass machen.
 * Rein und ohne DOM — läuft in der App (Animator) und unter node (Test).
 */
(function (root) {
  "use strict";

  /** km/h je Punkt aus kumulierter Distanz (m) und Zeit (s); ohne Zeit im Fenster (Δt ≤ 0) 0. */
  function glaetten(cumDistM, cumTimeS, fensterS) {
    const F = (fensterS === undefined || fensterS === null) ? 15 : fensterS;
    const n = Math.min(cumDistM.length, cumTimeS.length);
    const aus = new Array(n);
    const halb = F / 2;
    let lo = 0, hi = 0;   // beide Fenstergrenzen wandern nur vorwärts (Zeit steigt monoton): das engt die Binärsuche ein
    for (let i = 0; i < n; i++) {
      const t = cumTimeS[i];
      // erster Index mit t >= t_i − F/2 (Binärsuche im Bereich [lo, i])
      let a = lo, b = i;
      while (a < b) { const m = (a + b) >> 1; if (cumTimeS[m] < t - halb) a = m + 1; else b = m; }
      lo = a;
      // letzter Index mit t <= t_i + F/2 (Binärsuche im Bereich [max(hi, i), n − 1])
      a = Math.max(hi, i); b = n - 1;
      while (a < b) { const m = (a + b + 1) >> 1; if (cumTimeS[m] > t + halb) b = m - 1; else a = m; }
      hi = a;
      const dt = cumTimeS[hi] - cumTimeS[lo];
      aus[i] = dt > 0 ? Math.max(0, (cumDistM[hi] - cumDistM[lo]) / dt * 3.6) : 0;
    }
    return aus;
  }

  /** p-Perzentil (0..100) mit linearer Interpolation; leer → 0. */
  function perzentil(werte, p) {
    const s = werte.filter(v => typeof v === "number" && isFinite(v)).sort((x, y) => x - y);
    if (!s.length) return 0;
    const pos = Math.max(0, Math.min(100, p)) * (s.length - 1) / 100;
    const u = Math.floor(pos), o = Math.min(s.length - 1, u + 1);
    return s[u] + (s[o] - s[u]) * (pos - u);
  }

  function hexZuRgb(h) {
    h = String(h || "#000").replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0];
  }
  function mitDeckkraft(hex, a) {
    const c = hexZuRgb(hex);
    return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")";
  }

  /** Farbstufen der Skala: „ampel“ grün → gelb → rot, „eigen“ blass → kräftig in der Linienfarbe. */
  function stufen(variante, vmax, linienFarbe) {
    if (variante === "ampel") {
      return [{ v: 0, color: "#2e9e44" }, { v: vmax / 2, color: "#f2c40f" }, { v: vmax, color: "#d7191c" }];
    }
    return [{ v: 0, color: mitDeckkraft(linienFarbe, 0.25) }, { v: vmax, color: mitDeckkraft(linienFarbe, 1) }];
  }

  /** Mischfarbe zweier Stufen: Hex wie bisher, bei „rgba(…)“ samt Deckkraft (für die „eigen“-Skala). */
  function mischen(a, b, f) {
    const lies = (c) => {
      const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(String(c));
      if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
      const x = hexZuRgb(c); return [x[0], x[1], x[2], 1];
    };
    const x = lies(a), y = lies(b);
    const w = [0, 1, 2].map(i => Math.round(x[i] + (y[i] - x[i]) * f));
    const al = Math.round((x[3] + (y[3] - x[3]) * f) * 1000) / 1000;
    return "rgba(" + w[0] + "," + w[1] + "," + w[2] + "," + al + ")";
  }

  root.rzTempoFarben = { glaetten, perzentil, stufen, mischen };
})(typeof window !== "undefined" ? window : globalThis);
