/* Barometrische Drift herausrechnen (05.10.2026).
 *
 * Recherche: Höhenmesser in Uhren und Radcomputern messen feine Höhenänderungen sehr genau, ihr
 * absoluter Wert wandert aber mit dem Luftdruck (Wetter, Kalibrierung) — über Stunden oft 20–80 m. Bisher konnte man
 * die Höhe nur durch die Karte ERSETZEN (oder mischen) und verlor damit die Details des Barometers. Hier wird nur die
 * langsame Abweichung abgezogen:
 *
 *   Abweichung_i = GPS-/Baro-Höhe_i − Geländehöhe_i
 *   Drift(s)     = Median der Abweichungen in ±FENSTER_M um die Stelle s (Stützstellen alle SCHRITT_M, dazwischen linear)
 *   Ergebnis_i   = Höhe_i − Drift_i
 *
 * Der Median macht das robust gegen kurze Stücke, an denen das Gelände-Modell nicht die gelaufene Höhe zeigt
 * (Brücken, Tunnel, Brückenrampen): sie sind kürzer als das halbe Fenster und gehen im Median unter.
 * Rein und ohne DOM — läuft in der App (Inspektor) und unter node (Test).
 */
(function (root) {
  "use strict";
  const FENSTER_M = 1000, SCHRITT_M = 200;

  function median(a) {
    if (!a.length) return null;
    const s = a.slice().sort((x, y) => x - y), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /** gps, dem: Höhen je Punkt (null = fehlt); cum: Meter ab Start je Punkt.
   *  → { hoehen, drift, info: {anfang, ende, max, n} } oder null, wenn zu wenig Vergleichspunkte. */
  function korrigieren(gps, dem, cum, fensterM, schrittM) {
    const H = fensterM || FENSTER_M, S = schrittM || SCHRITT_M;
    const n = Math.min(gps.length, dem.length, cum.length);
    const idx = [];
    for (let i = 0; i < n; i++) if (gps[i] != null && isFinite(gps[i]) && dem[i] != null && isFinite(dem[i])) idx.push(i);
    if (idx.length < 10) return null;
    const L = cum[n - 1] || 0;
    // Stützstellen: Median der Abweichung im Fenster (zwei Zeiger über die sortierten Strecken)
    const stuetz = [];
    let a = 0, b = 0;
    for (let s = 0; s <= L + 1e-6; s += S) {
      while (a < idx.length && cum[idx[a]] < s - H) a++;
      while (b < idx.length && cum[idx[b]] <= s + H) b++;
      const d = [];
      for (let k = a; k < b; k++) { const i = idx[k]; d.push(gps[i] - dem[i]); }
      const m = median(d);
      if (m != null) stuetz.push([s, m]);
    }
    if (!stuetz.length) return null;
    const drift = new Array(n);
    let j = 0;
    for (let i = 0; i < n; i++) {
      const c = cum[i];
      while (j < stuetz.length - 2 && stuetz[j + 1][0] < c) j++;
      const [s0, m0] = stuetz[j], [s1, m1] = stuetz[Math.min(j + 1, stuetz.length - 1)];
      const t = s1 > s0 ? Math.max(0, Math.min(1, (c - s0) / (s1 - s0))) : 0;
      drift[i] = m0 + (m1 - m0) * t;
    }
    const hoehen = new Array(n);
    let max = 0;
    for (let i = 0; i < n; i++) {
      if (gps[i] != null && isFinite(gps[i])) hoehen[i] = Math.round((gps[i] - drift[i]) * 10) / 10;
      else hoehen[i] = (dem[i] != null && isFinite(dem[i])) ? dem[i] : null;
      if (Math.abs(drift[i]) > Math.abs(max)) max = drift[i];
    }
    return { hoehen, drift, info: { anfang: drift[0], ende: drift[n - 1], max, n: idx.length } };
  }

  root.rzHoehenDrift = { korrigieren, median, FENSTER_M, SCHRITT_M };
})(typeof window !== "undefined" ? window : globalThis);
