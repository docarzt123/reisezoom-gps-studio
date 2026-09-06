/* rz-dash.js — Strichelung als GEOMETRIE (06.09.2026, Marc: „gestrichelte Ghosts wandern")
 *
 * MapLibre rechnet `line-dasharray` je Kachel: wechselt unter der Linie die
 * Kachel (Kamerafahrt bei Neigung, Zoomwechsel), springt die Strichphase — im
 * Video wandern die Striche. Hier wird die Linie stattdessen einmal in Strich-
 * Stücke geschnitten (Meter am Boden), die dann als durchgezogene Stücke mit
 * runden Kappen gezeichnet werden: keine Phase, kein Wandern, in Vorschau und
 * Video dieselbe Geometrie (WYSIWYG). Strich-/Lückenlänge entsprechen
 * `line-dasharray` [2,2] × Linienbreite bei der Bezugs-Zoomstufe (Fit-Zoom des
 * Videos); beim Zoomen skalieren die Striche mit der Karte.
 */
(function () {
  "use strict";
  const R = 6371008.8;
  function distM(a, b) {
    const la1 = a[1] * Math.PI / 180, la2 = b[1] * Math.PI / 180;
    const dla = la2 - la1, dlo = (b[0] - a[0]) * Math.PI / 180;
    const h = Math.sin(dla / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dlo / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  /** Meter je CSS-Bildpunkt bei Zoom z und Breite lat (Web-Merkator, 512er Kacheln). */
  function metersPerPixel(zoom, lat) {
    return 156543.03392 * Math.cos((lat || 0) * Math.PI / 180) / Math.pow(2, zoom) / 2;
  }
  /** [strichM, lueckeM] wie `line-dasharray` [dash, gap] in Linienbreiten (CSS-px) bei der Bezugs-Zoomstufe. */
  function rzDashMeters(widthPx, dasharray, zoomVideo, lat) {
    const w = Math.max(0.5, +widthPx || 2.5), d = (dasharray && dasharray.length >= 2) ? dasharray : [2, 2];
    const mpp = metersPerPixel(+zoomVideo || 12, lat);
    return [Math.max(1, d[0] * w * mpp), Math.max(1, d[1] * w * mpp)];
  }
  /** LineString-Koordinaten → MultiLineString-Koordinaten (Strich-Stücke am Boden). */
  function rzDashGeometry(coords, dashM, gapM) {
    const out = [];
    if (!coords || coords.length < 2) return out;
    const period = dashM + gapM;
    let cur = [], acc = 0;      // acc = Strecke seit Musterbeginn
    let on = true; cur.push(coords[0]);
    for (let i = 1; i < coords.length; i++) {
      let a = coords[i - 1], b = coords[i];
      let seg = distM(a, b);
      let pos = 0;
      while (seg - pos > 1e-9) {
        const room = (on ? dashM : gapM) - acc;      // Rest im aktuellen Strich/Lücke
        if (seg - pos < room) { acc += seg - pos; pos = seg; if (on) cur.push(b); break; }
        const t = (pos + room) / seg;
        const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        if (on) { cur.push(p); if (cur.length >= 2) out.push(cur); cur = []; }
        else { cur = [p]; }
        on = !on; acc = 0; pos += room;
      }
    }
    if (on && cur.length >= 2) out.push(cur);
    return out;
  }
  const api = { rzDashMeters, rzDashGeometry, metersPerPixel };
  if (typeof window !== "undefined") Object.assign(window, api);
  if (typeof globalThis !== "undefined") Object.assign(globalThis, api);
})();
