/* sichtausweichen.js — die automatische Kamera weicht Geländefalten aus (29.10.2026)
 *
 * Warum: Masca, ab Sekunde 6 — der Weg lief hinter eine kleine Falte (bis 15 m über der Sichtlinie), die Linie war dort
 * vom Gelände verdeckt, der Laufpunkt dahinter wieder frei: er wirkte „an die falsche Stelle gesprungen“. Marc: die
 * automatische Kamera soll so etwas gar nicht erst zeigen — erst steiler schauen, dann höher; früh und sanft anfangen,
 * damit es nicht auffällt; reicht es nicht, bleibt die Stelle verdeckt. Eigene Keyframes werden nie verändert.
 *
 * Rechnung (ohne MapLibre, prüfbar in node):
 *   kameraPos()   Kameraort aus Mitte, Höhe der Mitte, Zoom, Neigung, Blickrichtung — wie MapLibre (Abstand zur Mitte
 *                 = 0,5·Höhe/tan(fov/2) Bildpunkte, umgerechnet über die Weltbreite 512·2^Zoom).
 *   plan()        je Stützstelle: ist der Laufpunkt oder die Linie kurz dahinter verdeckt? Dann die kleinste Stufe aus
 *                 STUFEN (erst Neigung, dann Zoom), bei der alles frei ist. Danach weich verteilt: jede Stützstelle zieht
 *                 ihre Stufe `rampeS` Sekunden vorher an und lässt sie ebenso lange nachher wieder los (smoothstep).
 *   wert()        Wert der Kurve an der Zeit t (0…1).
 *   demLeser()    Geländehöhen aus den Höhenkacheln der Karte selbst (dieselbe Quelle, die MapLibre zeichnet — die
 *                 AWS-Kacheln von api.dem_hoehen weichen bei anderen Quellen um Dutzende Meter ab, Mapterhorn ↔ AWS).
 */
(function () {
  "use strict";

  const ERDE_M = 40075016.686;
  const M_GRAD = 111320;
  const FOV_STD = 36.8699;   // MapLibre: 2·atan(0,75)·180/π
  // Stufen: [weniger Neigung in Grad, weniger Zoom] — erst steiler, dann höher (Marc, Grilling 29.10.2026: Q4 d, Q10)
  const STUFEN = [[0, 0], [5, 0], [10, 0], [15, 0], [20, 0], [20, 0.25], [20, 0.5], [20, 0.75], [20, 1]];
  // frei heißt: das Gelände bleibt KLAR_M unter der Sichtlinie (Masca: mit 8 m fehlte noch ein Stück) (MapLibre zeichnet das Gelände als Dreiecksnetz — streift der
  // Blick die Falte nur knapp, fehlt dort trotzdem ein Stück Linie); nah am Ziel weniger (15 % des Abstands), dort läuft
  // die Sichtlinie ohnehin auf den Boden zu
  const UEBERSTAND_M = 0, KLAR_M = 15;
  const EIGEN_M = 12;        // die letzten Meter vor dem Ziel: der eigene Hang
  const SCHRITT_M = 8, SCHRITT_WACHS = 0.06;   // Abtastung der Sichtlinie

  function glatt(x) { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); }

  /** Kameraort { lng, lat, alt } (alt in m über dem Meer, wie die Höhen — Überhöhung schon eingerechnet). */
  function kameraPos(mitte, mitteH, zoom, neigung, richtung, hoehePx, fov) {
    const lat = mitte[1] * Math.PI / 180;
    const abstPx = 0.5 * hoehePx / Math.tan(((fov || FOV_STD) / 2) * Math.PI / 180);
    const mProPx = ERDE_M * Math.cos(lat) / (512 * Math.pow(2, zoom));
    const d = abstPx * mProPx, p = neigung * Math.PI / 180, b = richtung * Math.PI / 180;
    const waag = d * Math.sin(p);
    return {
      lng: mitte[0] - waag * Math.sin(b) / (M_GRAD * Math.max(0.05, Math.cos(lat))),
      lat: mitte[1] - waag * Math.cos(b) / M_GRAD,
      alt: mitteH + d * Math.cos(p),
    };
  }

  /** Größter Überstand (m) des Geländes über der Sichtlinie Kamera → Ziel, Sicherheitsabstand eingerechnet (> 0 = verdeckt);
   *  `hoehe(lng, lat)` liefert m (überhöht). */
  function ueberstand(kam, ziel, zielH, hoehe) {
    const cos = Math.max(0.05, Math.cos(ziel[1] * Math.PI / 180));
    const dx = (ziel[0] - kam.lng) * M_GRAD * cos, dy = (ziel[1] - kam.lat) * M_GRAD;
    const waag = Math.hypot(dx, dy);
    let schlimm = -Infinity;
    // vom Ziel rückwärts in festen Metern: nah alle SCHRITT_M, weiter weg wachsend (Falten liegen meist nah davor;
    // gleichmäßige Anteile übersprangen 60 m breite Grate)
    for (let s = EIGEN_M; s < waag; s += Math.max(SCHRITT_M, s * SCHRITT_WACHS)) {
      const t = 1 - s / waag;
      const lng = kam.lng + (ziel[0] - kam.lng) * t, lat = kam.lat + (ziel[1] - kam.lat) * t;
      const h = kam.alt + (zielH - kam.alt) * t;
      const g = hoehe(lng, lat);
      const u = (g != null && isFinite(g)) ? g - h + Math.min(KLAR_M, 0.15 * s) : -Infinity;
      if (u > schlimm) schlimm = u;
    }
    return schlimm;
  }

  /**
   * proben: [{ t (0…1), mitte [lng,lat], zoom, neigung, richtung, ziele: [[lng,lat], …] }] — gleichmäßig über die Zeit
   * opt: { hoehe(lng,lat) (überhöht), hoehePx, fov, dauerS (ganze Videolänge), rampeS (3) }
   * → { t: [...], dp: [...], dz: [...], verdeckt, geloest } (dp in Grad, dz in Zoomstufen)
   */
  function plan(proben, opt) {
    const n = proben.length, hoehe = opt.hoehe, H = opt.hoehePx || 1080;
    const need = proben.map(() => [0, 0]);
    let verdeckt = 0, geloest = 0;
    for (let i = 0; i < n; i++) {
      const p = proben[i];
      if (!p || !p.mitte || !p.ziele || !p.ziele.length) continue;
      const mitteH = hoehe(p.mitte[0], p.mitte[1]);
      if (mitteH == null || !isFinite(mitteH)) continue;
      const zielH = p.ziele.map((z) => { const h = hoehe(z[0], z[1]); return (h == null || !isFinite(h)) ? null : h + 2; });
      const frei = (dp, dz) => {
        const kam = kameraPos(p.mitte, mitteH, p.zoom - dz, Math.max(0, p.neigung - dp), p.richtung, H, opt.fov);
        for (let k = 0; k < p.ziele.length; k++) {
          if (zielH[k] == null) continue;
          if (ueberstand(kam, p.ziele[k], zielH[k], hoehe) > UEBERSTAND_M) return false;
        }
        return true;
      };
      if (frei(0, 0)) continue;
      verdeckt++;
      for (let s = 1; s < STUFEN.length; s++) {
        const [dp, dz] = STUFEN[s];
        if (dp > p.neigung + 1e-6 && dz === 0) continue;   // schon fast senkrecht: gleich zur Höhe
        if (frei(dp, dz)) { need[i] = [Math.min(dp, p.neigung), dz]; geloest++; break; }
      }
      // keine Stufe reicht → bleibt verdeckt (Marc: Vorgabe „verdeckt“, kein wildes Ausweichen)
    }
    // weich verteilen: früh anfangen, sanft zurück
    const rampe = Math.max(1e-6, (opt.rampeS != null ? opt.rampeS : 3) / Math.max(1e-6, opt.dauerS || 1));
    const dp = new Array(n).fill(0), dz = new Array(n).fill(0);
    for (let j = 0; j < n; j++) {
      if (!need[j][0] && !need[j][1]) continue;
      const tj = proben[j].t;
      for (let i = 0; i < n; i++) {
        const w = glatt(1 - Math.abs(proben[i].t - tj) / rampe);
        if (w <= 0) continue;
        if (need[j][0] * w > dp[i]) dp[i] = need[j][0] * w;
        if (need[j][1] * w > dz[i]) dz[i] = need[j][1] * w;
      }
    }
    return { t: proben.map((p) => p.t), dp, dz, verdeckt, geloest };
  }

  function wert(kurve, t) {
    if (!kurve || !kurve.t || kurve.t.length < 2) return null;
    const T = kurve.t, n = T.length, x = Math.max(T[0], Math.min(T[n - 1], +t || 0));
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= x) lo = m; else hi = m; }
    const u = (T[hi] - T[lo]) > 1e-12 ? (x - T[lo]) / (T[hi] - T[lo]) : 0;
    return { dp: kurve.dp[lo] + (kurve.dp[hi] - kurve.dp[lo]) * u, dz: kurve.dz[lo] + (kurve.dz[hi] - kurve.dz[lo]) * u };
  }

  /** Geländehöhen aus der Höhenquelle der Karte: `laden(punkte)` holt die nötigen Kacheln, danach `hoehe(lng, lat)`
   *  (m × Überhöhung, bilinear; ohne Kachel null). Null, wenn die Karte kein Gelände hat oder die Quelle unbekannt ist. */
  function demLeser(map) {
    let tr = null, src = null;
    try { tr = map.getTerrain && map.getTerrain(); src = tr && map.getSource(tr.source); } catch (_) {}
    const vorlage = src && ((src.tiles && src.tiles[0]) || (src._options && src._options.tiles && src._options.tiles[0]));
    if (!tr || !src || !vorlage) return null;
    const ueber = +tr.exaggeration || 1;
    const groesse = +src.tileSize || 512;
    // dieselbe Bildpunktdichte wie die nahen Geländekacheln der Karte (Zoom ~14 mit 256er Kacheln)
    const z = Math.max(0, Math.min(+src.maxzoom || 14, groesse >= 512 ? 13 : 14));
    const n = Math.pow(2, z);
    const enc = src.encoding || "mapbox";
    const dekod = enc === "terrarium" ? (r, g, b) => r * 256 + g + b / 256 - 32768
      : enc === "custom" ? (r, g, b) => (r * (+src.redFactor || 0) + g * (+src.greenFactor || 0) + b * (+src.blueFactor || 0)) - (+src.baseShift || 0)
        : (r, g, b) => -10000 + (r * 65536 + g * 256 + b) * 0.1;
    const kacheln = new Map();   // "x/y" → { w, h, d: Float32Array } | null
    const kachelVon = (lng, lat) => {
      const x = (lng + 180) / 360 * n;
      const s = Math.sin(lat * Math.PI / 180);
      const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
      return [x, y];
    };
    async function eineLaden(tx, ty) {
      const key = tx + "/" + ty;
      if (kacheln.has(key)) return;
      kacheln.set(key, null);
      let url = vorlage.replace("{z}", z).replace("{x}", tx).replace("{y}", ty);
      let headers;
      try { const rq = map._requestManager && map._requestManager.transformRequest(url, "Tile"); if (rq && rq.url) { url = rq.url; headers = rq.headers; } } catch (_) {}
      try {
        const r = await fetch(url, headers ? { headers } : undefined);
        if (!r.ok) return;
        const bmp = await createImageBitmap(await r.blob());
        const cv = (typeof OffscreenCanvas !== "undefined") ? new OffscreenCanvas(bmp.width, bmp.height) : Object.assign(document.createElement("canvas"), { width: bmp.width, height: bmp.height });
        const cx = cv.getContext("2d", { willReadFrequently: true });
        cx.drawImage(bmp, 0, 0);
        const px = cx.getImageData(0, 0, bmp.width, bmp.height).data;
        const d = new Float32Array(bmp.width * bmp.height);
        for (let i = 0; i < d.length; i++) d[i] = dekod(px[4 * i], px[4 * i + 1], px[4 * i + 2]);
        kacheln.set(key, { w: bmp.width, h: bmp.height, d });
      } catch (_) {}
    }
    async function laden(punkte) {
      const noetig = new Set();
      for (const p of punkte || []) {
        if (!p) continue;
        const [x, y] = kachelVon(p[0], p[1]);
        if (!isFinite(x) || !isFinite(y)) continue;
        noetig.add(((Math.floor(x) % n) + n) % n + "/" + Math.max(0, Math.min(n - 1, Math.floor(y))));
      }
      const offen = [...noetig].filter((k) => !kacheln.has(k));
      for (let i = 0; i < offen.length; i += 8) {
        await Promise.all(offen.slice(i, i + 8).map((k) => { const [a, b] = k.split("/").map(Number); return eineLaden(a, b); }));
      }
      return offen.length;
    }
    function roh(px, py) {   // Kachel-Bildpunkt über Kachelgrenzen hinweg
      const tx = Math.floor(px), ty = Math.floor(py);
      const k = kacheln.get((((tx % n) + n) % n) + "/" + ty);
      if (!k) return null;
      const ix = Math.min(k.w - 1, Math.max(0, Math.floor((px - tx) * k.w))), iy = Math.min(k.h - 1, Math.max(0, Math.floor((py - ty) * k.h)));
      return k.d[iy * k.w + ix];
    }
    function hoehe(lng, lat) {
      const [x, y] = kachelVon(lng, lat);
      const k = kacheln.get((((Math.floor(x) % n) + n) % n) + "/" + Math.floor(y));
      if (!k) return null;
      // bilinear über Bildpunktmitten (Nachbarkachel, wo nötig)
      const fx = x * k.w - 0.5, fy = y * k.h - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), u = fx - x0, v = fy - y0;
      const at = (ix, iy) => roh((ix + 0.5) / k.w, (iy + 0.5) / k.h);
      const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
      if (a == null || b == null || c == null || d == null) { const e = at(Math.round(fx), Math.round(fy)); return e == null ? null : e * ueber; }
      return ((a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v) * ueber;
    }
    return { laden, hoehe, z, ueberhoehung: ueber };
  }

  const api = { kameraPos, ueberstand, plan, wert, demLeser, STUFEN };
  if (typeof window !== "undefined") window.rzSichtAusweichen = api;
})();
