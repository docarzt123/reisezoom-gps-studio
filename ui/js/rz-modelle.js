/* rz-modelle.js — 3D-Modelle aller Verkehrsarten aus einfachen Körpern (08.11.2026, aus dem Prototyp der Web-Fassung)
 *
 * In der App: Laufpunkt mit „Fahrzeug-Aussehen: 3D-Modell“ — rz-figur3d.js zeichnet `mesh(art, phase)` als three.js-Körper
 * (Farben je Rolle, farbe/farbe2 aus den Symbolfarben), `vorschau(art, px, p)` malt die Auswahlkacheln.
 * Bei Änderungen an den Modellen: dieselbe Datei gibt es in der Web-Fassung — beide pflegen.
 *
 *
 * Marc, 08.11.2026: „bau jetzt ein detaillierteres Flugzeug, und zeige mir das von allen Seiten. Und mach gleich alle anderen
 * Fahrzeuge usw., die wir haben“ — die 20 Arten des Studios (studio.js ARTEN). Vorher: „lass mal so [einfache Körper], das
 * passt für den Anfang. So kann man auch einfach die Farbe ändern.“
 *
 * Jedes Modell wird in Metern gebaut (x rechts, y vorn, z oben) und dann auf Länge 1 (größte Ausdehnung) gebracht.
 * Bodenmodelle stehen mit z = 0 auf dem Boden, Luftmodelle (Flugzeug, Hubschrauber, Gleitschirm, Ballon) sind um ihre
 * Mitte gelegt. Jede Fläche trägt eine Rolle (farbe, farbe2, weiss, glas …) → Farbe erst beim Zeichnen.
 * Regel (Flimmern am Autodach, 08.11.2026): keine zwei sichtbaren Flächen in derselben Ebene.
 *
 *   const m = rzModelle.mesh("flugzeug");        // {pos: Float32Array, nor: Float32Array, rolle: [], luft: bool}
 *   rzModelle.mesh("wanderer", phase, ruhe)      // ruhe 0…1: in die Ruhepose (gerade stehen, Pedale waagrecht …)
 *   rzModelle.farbe("farbe", { farbe: "#48D6C4", farbe2: "#FF896B" })   // → [r, g, b] 0…1
 */
(function () {
  "use strict";
  const PI = Math.PI;

  // ── Baukasten ─────────────────────────────────────────────────────────────
  function Teile() { this.pos = []; this.nor = []; this.rolle = []; }
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const kreuz = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const mittel = (P) => [0, 1, 2].map((k) => P.reduce((s, p) => s + p[k], 0) / P.length);
  Teile.prototype.dreieck = function (a, b, c, rolle, mitte) {
    let n = norm(kreuz(sub(b, a), sub(c, a)));
    const f = sub(mittel([a, b, c]), mitte);
    if (n[0] * f[0] + n[1] * f[1] + n[2] * f[2] < 0) n = n.map((x) => -x);
    for (const p of [a, b, c]) { this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0], n[1], n[2]); this.rolle.push(rolle); }
  };
  Teile.prototype.viereck = function (a, b, c, d, rolle, mitte) { this.dreieck(a, b, c, rolle, mitte); this.dreieck(a, c, d, rolle, mitte); };
  /** Sechsflächner aus 8 Ecken: unten b0..b3, oben t0..t3 (gleiche Umlaufrichtung) */
  Teile.prototype.quader = function (P, rolle) {
    const m = mittel(P), [b0, b1, b2, b3, t0, t1, t2, t3] = P;
    this.viereck(b0, b1, b2, b3, rolle, m); this.viereck(t0, t1, t2, t3, rolle, m);
    this.viereck(b0, b1, t1, t0, rolle, m); this.viereck(b1, b2, t2, t1, rolle, m);
    this.viereck(b2, b3, t3, t2, rolle, m); this.viereck(b3, b0, t0, t3, rolle, m);
  };
  Teile.prototype.kasten = function (x0, x1, y0, y1, z0, z1, rolle) {
    this.quader([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], rolle);
  };
  /** Flügel/Leitwerk waagrecht: Wurzel (x0, Vorderkante y, Hinterkante y, z, Dicke) → Spitze (x1, …) */
  Teile.prototype.fluegel = function (x0, v0, h0, z0, d0, x1, v1, h1, z1, d1, rolle) {
    this.quader([[x0, v0, z0 - d0 / 2], [x0, h0, z0 - d0 / 3], [x1, h1, z1 - d1 / 2], [x1, v1, z1 - d1 / 2],
                 [x0, v0, z0 + d0 / 2], [x0, h0, z0 + d0 / 3], [x1, h1, z1 + d1 / 2], [x1, v1, z1 + d1 / 2]], rolle);
  };
  /** Flosse senkrecht: Fuß (z0, Vorderkante y, Hinterkante y, Dicke) → Spitze (z1, …) */
  Teile.prototype.flosse = function (z0, v0, h0, d0, z1, v1, h1, d1, rolle, x = 0) {
    this.quader([[x - d0 / 2, v0, z0], [x - d0 / 2, h0, z0], [x - d1 / 2, h1, z1], [x - d1 / 2, v1, z1],
                 [x + d0 / 2, v0, z0], [x + d0 / 2, h0, z0], [x + d1 / 2, h1, z1], [x + d1 / 2, v1, z1]], rolle);
  };
  /** Prisma: Umriss in der xy-Ebene, von z0 bis z1 */
  Teile.prototype.platte = function (umriss, z0, z1, rolle) {
    const A = umriss.map(([x, y]) => [x, y, z0]), B = umriss.map(([x, y]) => [x, y, z1]), m = mittel(A.concat(B)), n = umriss.length;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; this.viereck(A[i], A[j], B[j], B[i], rolle, m); }
    const ma = mittel(A), mb = mittel(B);
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; this.dreieck(ma, A[i], A[j], rolle, m); this.dreieck(mb, B[j], B[i], rolle, m); }
  };
  /** Rumpf aus Ringen entlang einer Achse: ringe = [{a (Lage auf der Achse), rx, rz, cx, cz}], rolleFn(w, a) je Fläche.
   *  Achse "y" (Standard): Ring in x/z; Achse "z": Ring in x/y (rz → y-Radius, cz → y-Mitte). w = Winkel ab +x, π/2 = oben/vorn. */
  Teile.prototype.rumpf = function (ringe, n, rolleFn, achse = "y", kappeRolle) {
    const P = ringe.map((r) => Array.from({ length: n }, (_, i) => {
      const w = i / n * 2 * PI, u = (r.cx || 0) + Math.cos(w) * r.rx, v = (r.cz || 0) + Math.sin(w) * r.rz;
      return achse === "z" ? [u, v, r.a] : [u, r.a, v];
    }));
    const mitteVon = (r) => achse === "z" ? [r.cx || 0, r.cz || 0, r.a] : [r.cx || 0, r.a, r.cz || 0];
    for (let k = 0; k + 1 < ringe.length; k++) {
      const m = mittel([mitteVon(ringe[k]), mitteVon(ringe[k + 1])]);
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, w = (i + 0.5) / n * 2 * PI;
        this.viereck(P[k][i], P[k][j], P[k + 1][j], P[k + 1][i], rolleFn(w, (ringe[k].a + ringe[k + 1].a) / 2), m);
      }
    }
    for (const k of [0, ringe.length - 1]) {
      const r = ringe[k]; if (r.rx < 1e-3 && r.rz < 1e-3) continue;
      const c = mitteVon(r), aussen = mittel([mitteVon(ringe[0]), mitteVon(ringe[ringe.length - 1])]);
      const innen = c.map((x, q) => x + (aussen[q] - x) * 0.01);
      for (let i = 0; i < n; i++) this.dreieck(c, P[k][i], P[k][(i + 1) % n], kappeRolle || rolleFn(PI / 2, r.a), innen);
    }
  };
  /** Rohr von a nach b (Radius r, am Ende r2) mit Deckeln */
  Teile.prototype.rohr = function (a, b, r, rolle, n = 8, r2) {
    const d = norm(sub(b, a)), hilf = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const u = norm(kreuz(d, hilf)), v = kreuz(d, u), rr = r2 == null ? r : r2;
    const ring = (p, rad) => Array.from({ length: n }, (_, i) => { const w = i / n * 2 * PI, c = Math.cos(w) * rad, s = Math.sin(w) * rad;
      return [p[0] + u[0] * c + v[0] * s, p[1] + u[1] * c + v[1] * s, p[2] + u[2] * c + v[2] * s]; });
    const A = ring(a, r), B = ring(b, rr), m = mittel([a, b]);
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; this.viereck(A[i], A[j], B[j], B[i], rolle, m); }
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; this.dreieck(a, A[i], A[j], rolle, m); this.dreieck(b, B[j], B[i], rolle, m); }
  };
  /** Kugel / Ellipsoid um c mit Halbachsen s = [sx, sy, sz] */
  Teile.prototype.kugel = function (c, s, rolle, nb = 6, nl = 10, rolleFn) {
    const p = (i, j) => { const th = i / nb * PI - PI / 2, ph = j / nl * 2 * PI; return [c[0] + Math.cos(th) * Math.cos(ph) * s[0], c[1] + Math.cos(th) * Math.sin(ph) * s[1], c[2] + Math.sin(th) * s[2]]; };
    for (let i = 0; i < nb; i++) for (let j = 0; j < nl; j++) {
      const r = rolleFn ? rolleFn(i, j) : rolle;
      if (i === 0) this.dreieck(p(0, 0), p(1, j + 1), p(1, j), r, c);
      else if (i === nb - 1) this.dreieck(p(i, j), p(i, j + 1), p(nb, 0), r, c);
      else this.viereck(p(i, j), p(i, j + 1), p(i + 1, j + 1), p(i + 1, j), r, c);
    }
  };
  /** Rad eines Autos/Motorrads: Reifen, Felge, 5 Speichen (drehen mit `dreh` Bogenmaß), Nabe */
  Teile.prototype.rad = function (x, y, z, r, breite, felge = "grau", dreh = 0) {
    this.rohr([x - breite / 2, y, z], [x + breite / 2, y, z], r, "reifen", 14);
    const s = Math.sign(x) || 1, a = x + s * breite / 2;
    this.rohr([a, y, z], [a + s * 0.006, y, z], r * 0.62, "dunkel", 12);                           // Felgenbett
    for (let k = 0; k < 5; k++) {
      const w = dreh + k / 5 * 2 * PI;
      this.rohr([a + s * 0.008, y, z], [a + s * 0.008, y + Math.cos(w) * r * 0.58, z + Math.sin(w) * r * 0.58], r * 0.07, felge, 4);
    }
    this.rohr([a + s * 0.004, y, z], [a + s * 0.02, y, z], r * 0.16, felge, 8);                      // Nabe
  };
  /** Fahrradlaufrad: Reifen als Ring aus kurzen Rohren (yz-Ebene), 8 Speichen (drehen mit `dreh`), Nabe */
  Teile.prototype.laufrad = function (y, z, r, dicke, dreh = 0) {
    const n = 18, P = Array.from({ length: n }, (_, i) => [0, y + Math.cos(i / n * 2 * PI) * r, z + Math.sin(i / n * 2 * PI) * r]);
    for (let i = 0; i < n; i++) this.rohr(P[i], P[(i + 1) % n], dicke, "reifen", 6);
    const Q = P.map((p) => [0, y + (p[1] - y) * 0.9, z + (p[2] - z) * 0.9]);
    for (let i = 0; i < n; i++) this.rohr(Q[i], Q[(i + 1) % n], dicke * 0.35, "grau", 4);          // Felge
    for (let k = 0; k < 8; k++) { const w = dreh + k / 8 * 2 * PI; this.rohr([0, y, z], [0, y + Math.cos(w) * r * 0.88, z + Math.sin(w) * r * 0.88], 0.006, "grau", 3); }
    this.rohr([-0.05, y, z], [0.05, y, z], 0.025, "dunkel", 6);
  };

  /** Prisma aus einem Seitenprofil: Umriss in der yz-Ebene (y vorn, z oben), von x0 bis x1 */
  Teile.prototype.profil = function (umriss, x0, x1, rolle) {
    const A = umriss.map(([y, z]) => [x0, y, z]), B = umriss.map(([y, z]) => [x1, y, z]), m = mittel(A.concat(B)), n = umriss.length;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; this.viereck(A[i], A[j], B[j], B[i], rolle, m); }
    const ma = mittel(A), mb = mittel(B);
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; this.dreieck(ma, A[i], A[j], rolle, m); this.dreieck(mb, B[j], B[i], rolle, m); }
  };
  /** Ein flaches Blatt (Rotor, Paddel) als Quader: Mitte c, Richtung d (Einheitsvektor), Länge, Breite, Dicke (z) */
  Teile.prototype.blatt = function (c, d, laenge, breite, dicke, rolle, quer) {
    const q = quer || norm(kreuz(d, [0, 0, 1])), h = laenge / 2, b = breite / 2, t2 = dicke / 2;
    const P = (s1, s2, s3) => [c[0] + d[0] * h * s1 + q[0] * b * s2, c[1] + d[1] * h * s1 + q[1] * b * s2, c[2] + d[2] * h * s1 + t2 * s3];
    this.quader([P(-1, -1, -1), P(1, -1, -1), P(1, 1, -1), P(-1, 1, -1), P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)], rolle);
  };

  // ── Mensch (Vorbild: Low-Poly-Figuren wie die freien CC0-Figuren von Quaternius) ───────────────────────────
  // Maße für 1,80 m: Bein 0,45 + 0,45, Hüfte 0,95, Rumpf 0,42 + 0,14, Arm 0,29 + 0,27. Winkel in Grad: Hüfte/Schulter 0 = senkrecht
  // nach unten, + = nach vorn; Knie + = Unterschenkel nach hinten gebeugt; Ellbogen + = Unterarm nach vorn/oben gebeugt.
  const BEIN = [0.45, 0.45], ARM = [0.29, 0.27];
  const glied = (start, w, beug, L, seit, ellbogen) => {   // Vorwärtsrechnung in der yz-Ebene (seit = Spreizung zur Seite, Grad)
    const a = w * PI / 180, s = (seit || 0) * PI / 180, b = (ellbogen ? w + beug : w - beug) * PI / 180;
    const k = [start[0] + Math.sin(s) * L[0], start[1] + Math.sin(a) * L[0] * Math.cos(s), start[2] - Math.cos(a) * L[0] * Math.cos(s)];
    const e = [k[0] + Math.sin(s) * L[1] * 0.3, k[1] + Math.sin(b) * L[1], k[2] - Math.cos(b) * L[1]];
    return [k, e];
  };
  /** Zwei Glieder zu einem Ziel (Fuß auf dem Pedal, Hand am Lenker). knick = Richtung, in die das Gelenk ausweicht. */
  const zweiGlied = (start, ziel, L, knick) => {
    let d = sub(ziel, start); const dist = Math.min(L[0] + L[1] - 1e-3, Math.max(1e-3, Math.hypot(d[0], d[1], d[2])));
    d = norm(d);
    const kd = norm(sub(knick, d.map((x) => x * (knick[0] * d[0] + knick[1] * d[1] + knick[2] * d[2]))));
    const a = (L[0] * L[0] - L[1] * L[1] + dist * dist) / (2 * dist), h = Math.sqrt(Math.max(0, L[0] * L[0] - a * a));
    const k = [start[0] + d[0] * a + kd[0] * h, start[1] + d[1] * a + kd[1] * h, start[2] + d[2] * a + kd[2] * h];
    return [k, [start[0] + d[0] * dist, start[1] + d[1] * dist, start[2] + d[2] * dist]];
  };
  /** o = {x, y, boden (Sohle auf dieser Höhe) | sitz (Hüfthöhe), neig, beine [{h, k, seit} | {ziel}], arme [{h, e, seit} | {ziel}],
   *       kleid, hose, schuhe, kopf: "haar" | "helm" | "muetze" | "kappe", helm (Rolle), rucksack (Rolle)} → Gelenke */
  Teile.prototype.mensch = function (o) {
    const ne = (o.neig || 0) * PI / 180, R = (v) => [v[0], v[1] * Math.cos(ne) + v[2] * Math.sin(ne), -v[1] * Math.sin(ne) + v[2] * Math.cos(ne)];
    const plus = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
    const hip = [o.x || 0, o.y || 0, o.sitz != null ? o.sitz : 0.95];
    const chest = plus(hip, R([0, 0, 0.42])), nack = plus(hip, R([0, 0, 0.56])), kopf = plus(hip, R([0, 0.01, 0.72]));
    const beine = (o.beine || [{ h: 0, k: 5 }, { h: 0, k: 5 }]).map((b, i) => {
      const st = plus(hip, [(i ? -1 : 1) * 0.095, 0, -0.03]);
      return b.ziel ? [st, ...zweiGlied(st, b.ziel, BEIN, [0, 1, 0.15])] : [st, ...glied(st, b.h, b.k, BEIN, (i ? -1 : 1) * (b.seit || 0))];
    });
    const arme = (o.arme || [{ h: 0, e: 10 }, { h: 0, e: 10 }]).map((a, i) => {
      const st = plus(chest, R([(i ? -1 : 1) * 0.2, 0, 0.07]));
      return a.ziel ? [st, ...zweiGlied(st, a.ziel, ARM, [(i ? -1 : 1) * 0.6, -0.3, -1])] : [st, ...glied(st, a.h, a.e, ARM, (i ? -1 : 1) * (a.seit != null ? a.seit : 8), true)];
    });
    // Auf den Boden stellen: tiefste Sohle auf o.boden
    let dz = 0;
    if (o.sitz == null) dz = (o.boden || 0) + 0.045 - Math.min(...beine.map((b) => b[2][2]));
    const v = (p) => [p[0], p[1], p[2] + dz];
    const kl = o.kleid || "farbe", ho = o.hose || "dunkel";
    this.kugel(v(hip), [0.165, 0.11, 0.1], ho, 4, 10);                                            // Becken
    this.rohr(v(plus(hip, R([0, 0, 0.04]))), v(plus(hip, R([0, 0, 0.24]))), 0.15, kl, 10, 0.16);    // Bauch
    this.rohr(v(plus(hip, R([0, 0, 0.24]))), v(chest), 0.16, kl, 10, 0.19);                         // Brust
    this.rohr(v(chest), v(nack), 0.19, kl, 10, 0.1);                                               // Schultern
    this.kugel(v(plus(chest, R([0, 0, 0.02]))), [0.21, 0.12, 0.08], kl, 4, 10);                     // Schulterpartie
    this.rohr(v(nack), v(plus(hip, R([0, 0, 0.63]))), 0.048, "haut", 6);                           // Hals
    this.kugel(v(kopf), [0.098, 0.108, 0.122], "haut", 6, 12);                                      // Kopf
    for (const s of [1, -1]) this.kugel(v(plus(kopf, R([s * 0.035, 0.1, 0.02]))), [0.012, 0.008, 0.014], "dunkel", 3, 5);   // Augen
    this.kugel(v(plus(kopf, R([0, 0.108, -0.01]))), [0.014, 0.02, 0.022], "haut", 3, 5);           // Nase
    const k = o.kopf || "haar";
    if (k === "helm") { this.kugel(v(plus(kopf, R([0, -0.01, 0.04]))), [0.118, 0.13, 0.1], o.helm || "farbe2", 5, 12); }
    else if (k === "muetze") { this.kugel(v(plus(kopf, R([0, -0.005, 0.05]))), [0.106, 0.114, 0.09], o.helm || "farbe2", 4, 12); this.kugel(v(plus(kopf, R([0, 0, 0.14]))), [0.03, 0.03, 0.03], o.helm || "farbe2", 3, 6); }
    else if (k === "kappe") { this.kugel(v(plus(kopf, R([0, -0.005, 0.05]))), [0.104, 0.112, 0.085], o.helm || "farbe2", 4, 12); this.blatt(v(plus(kopf, R([0, 0.12, 0.06]))), [0, 1, 0], 0.09, 0.15, 0.012, o.helm || "farbe2", [1, 0, 0]); }
    else { this.kugel(v(plus(kopf, R([0, -0.018, 0.04]))), [0.104, 0.112, 0.1], "haar", 4, 12); }
    for (const [st, kn, fu] of beine) {
      this.kugel(v(kn), [0.06, 0.06, 0.06], ho, 3, 6);
      this.rohr(v(st), v(kn), 0.078, ho, 8, 0.062); this.rohr(v(kn), v(fu), 0.06, ho, 8, 0.048);
      const vor = norm([0, 1, 0]);   // Schuh zeigt nach vorn
      this.kugel(v([fu[0], fu[1] + vor[1] * 0.05, fu[2] - 0.012]), [0.052, 0.115, 0.042], o.schuhe || "schuhe", 3, 8);
    }
    for (const [st, el, ha] of arme) {
      this.kugel(v(st), [0.06, 0.06, 0.06], kl, 3, 6);
      this.rohr(v(st), v(el), 0.054, kl, 7, 0.047); this.rohr(v(el), v(ha), 0.046, o.aermel === false ? "haut" : kl, 7, 0.038);
      this.kugel(v(ha), [0.042, 0.042, 0.05], "haut", 3, 6);
    }
    if (o.rucksack) {
      const rk = plus(hip, R([0, -0.2, 0.3]));
      this.kasten(rk[0] - 0.16, rk[0] + 0.16, rk[1] - 0.09, rk[1] + 0.09, rk[2] - 0.2 + dz, rk[2] + 0.2 + dz, o.rucksack);
      this.kugel(v(plus(rk, [0, 0, 0.2])), [0.16, 0.09, 0.06], o.rucksack, 3, 8);
      for (const s of [1, -1]) this.rohr(v(plus(chest, R([s * 0.12, -0.12, 0.08]))), v(plus(hip, R([s * 0.12, 0.13, 0.2]))), 0.02, "dunkel", 4);
    }
    return { hip: v(hip), chest: v(chest), kopf: v(kopf), haende: arme.map((a) => v(a[2])), fuesse: beine.map((b) => v(b[2])) };
  };

  // ── Bewegungsabläufe (Phase p = 0…1 je Zyklus) ─────────────────────────────
  const g = (p, m, b) => { let d = Math.abs(p - m); d = Math.min(d, 1 - d); return Math.exp(-(d * d) / (2 * b * b)); };
  /** Gehen (Ganganalyse: Hüfte +30° beim Aufsetzen bis −12°, Knie ~15° in der Standphase, ~60° im Schwung) */
  const gehen = (p) => ({ h: 9 + 21 * Math.cos(2 * PI * p), k: 3 + 15 * g(p, 0.15, 0.06) + 58 * g(p, 0.72, 0.1) });
  const laufen = (p) => ({ h: 12 + 34 * Math.cos(2 * PI * p), k: 12 + 28 * g(p, 0.2, 0.07) + 95 * g(p, 0.72, 0.12) });
  // 08.11.2026 (Marc: „bleibt ein Wanderer bei einer Pause stehen?“) — Ruhe r (0 = in Bewegung, 1 = steht): jede Figur
  // gleitet in ihre Ruhepose (gerade stehen, Pedale waagrecht, Paddel ruhig, Pferd steht). Fahrzeuge brauchen keine:
  // ihre Räder stehen, weil die Phase beim Halt stehen bleibt.
  const mix = (a, b, r) => a + (b - a) * r;
  const STEHEN = { h: 1, k: 3 };
  const bein = (b, r) => ({ h: mix(b.h, STEHEN.h, r), k: mix(b.k, STEHEN.k, r) });

  // ── Modelle (Meter) ───────────────────────────────────────────────────────
  const M = {};
  const LUFT = new Set(["flugzeug", "hubschrauber", "drohne", "drohne_mini", "drohne_fpv", "drohne_race", "drohne_360", "drohne_profi", "gleitschirm", "heissluftballon"]);
  /** Dauer eines Bewegungszyklus in Sekunden Fahrt (in der App: Videosekunden, in denen sich der Laufpunkt bewegt). Fehlt = keine Bewegung. */
  const ZYKLUS = { wanderer: 1.1, laeufer: 0.7, rad: 0.95, mountainbike: 1.05, reiter: 1.3, ski: 1.8, kajak: 1.5, sup: 2.2,
                   motorrad: 0.4, auto: 0.45, auto_klein: 0.45, auto_limousine: 0.45, auto_suv: 0.45, auto_sport: 0.45, auto_cabrio: 0.45, auto_pickup: 0.45, auto_van: 0.45, auto_gelaende: 0.45,
                   wohnmobil: 0.6, bus: 0.65, hubschrauber: 0.45, drohne: 0.3, drohne_mini: 0.3, drohne_fpv: 0.3, drohne_race: 0.3, drohne_360: 0.3, drohne_profi: 0.3, gleitschirm: 3.2, heissluftballon: 0.5 };
  M.flugzeug = (t) => {   // Mittelstreckenjet ~ 37 m, Spannweite 34 m
    const sw = (w) => Math.sin(w);
    t.rumpf([
      { a: 18.6, rx: 0.05, rz: 0.05, cz: -0.35 }, { a: 18.2, rx: 0.7, rz: 0.65, cz: -0.3 }, { a: 17.4, rx: 1.3, rz: 1.25, cz: -0.15 },
      { a: 16.2, rx: 1.75, rz: 1.75, cz: -0.03 },
      // Mittelteil in 0,9-m-Ringen: so lassen sich einzelne Fenster absetzen
      ...Array.from({ length: 27 }, (_, k) => ({ a: 14.5 - k * (23.5 / 26), rx: 2, rz: 2.02, cz: 0 })),
      { a: -12.5, rx: 1.78, rz: 1.75, cz: 0.2 }, { a: -15.5, rx: 1.15, rz: 1.05, cz: 0.75 }, { a: -17.8, rx: 0.5, rz: 0.45, cz: 1.25 }, { a: -18.6, rx: 0.12, rz: 0.12, cz: 1.4 },
    ], 28, (w, a) => {
      const z = sw(w);
      if (a > 16.3 && a < 17.6 && z > 0.25 && z < 0.7) return "glas";                     // Cockpitscheiben
      if (a > -9 && a < 14.3 && z > 0.18 && z < 0.34 && Math.round((a + 9) / (23.5 / 26)) % 2 === 0) return "glas";   // Fensterreihe
      if (a > -14 && a < 16 && z > -0.12 && z < 0.06) return "farbe";                      // Zierstreifen
      if (z < -0.55) return "grau";                                                        // Bauch
      return "weiss";
    }, "y", "weiss");
    for (const s of [1, -1]) {
      t.fluegel(1.8 * s, 2.5, -4.6, -1.15, 0.55, 16.6 * s, -6.9, -8.6, 0.55, 0.16, "weiss");   // Flügel mit V-Stellung
      t.flosse(0.5, -7.0, -8.7, 0.12, 2.4, -8.2, -9.1, 0.06, "farbe2", 16.7 * s);               // Winglet
      t.fluegel(0.5 * s, -12.8, -16.8, 1.1, 0.3, 6.4 * s, -17.0, -18.7, 1.6, 0.1, "weiss");     // Höhenleitwerk
      // Triebwerk unter dem Flügel
      t.rumpf([{ a: 1.9, rx: 0.92, rz: 0.92, cx: 5.9 * s, cz: -2.25 }, { a: 1.3, rx: 1.08, rz: 1.08, cx: 5.9 * s, cz: -2.25 },
               { a: -1.8, rx: 1.0, rz: 1.0, cx: 5.9 * s, cz: -2.25 }, { a: -3.1, rx: 0.55, rz: 0.55, cx: 5.9 * s, cz: -2.3 }],
              14, () => "farbe2", "y", "dunkel");
      t.kasten(5.75 * s - 0.15, 5.75 * s + 0.15, -2.6, 0.6, -1.3, -0.62, "grau");               // Pylon
    }
    t.flosse(1.6, -11.6, -17.6, 0.38, 7.6, -16.6, -19.0, 0.14, "farbe");                         // Seitenleitwerk
  };


  M.auto = (t, p) => {   // Kombi ~ 4,4 m (die Form, die Marc „für den Anfang“ abgenickt hat); Räder drehen
    const s = 4.4, dr = -p * 2 * PI;
    t.kasten(-0.22 * s, 0.22 * s, -0.5 * s, 0.48 * s, 0.07 * s, 0.25 * s, "farbe");
    t.quader([[-0.2 * s, -0.3 * s, 0.25 * s], [0.2 * s, -0.3 * s, 0.25 * s], [0.2 * s, 0.2 * s, 0.25 * s], [-0.2 * s, 0.2 * s, 0.25 * s],
              [-0.18 * s, -0.3 * s, 0.43 * s], [0.18 * s, -0.3 * s, 0.43 * s], [0.17 * s, 0.2 * s, 0.4 * s], [-0.17 * s, 0.2 * s, 0.4 * s]], "glas");
    t.kasten(-0.165 * s, 0.165 * s, -0.27 * s, 0.1 * s, 0.38 * s, 0.465 * s, "farbe2");
    for (const sx of [1, -1]) {
      for (const y of [0.31, -0.32]) t.rad(0.235 * sx * s, y * s, 0.1 * s, 0.1 * s, 0.07 * s, "grau", dr);
      t.kasten((0.11 * sx - 0.05) * s, (0.11 * sx + 0.05) * s, 0.48 * s, 0.495 * s, 0.17 * s, 0.21 * s, "licht");
      t.kasten((0.15 * sx - 0.04) * s, (0.15 * sx + 0.04) * s, -0.505 * s, -0.495 * s, 0.18 * s, 0.22 * s, "rot");
      t.kasten(0.2 * sx * s - 0.03, 0.2 * sx * s + 0.03, 0.17 * s, 0.2 * s, 0.33 * s, 0.37 * s, "farbe2");   // Außenspiegel
    }
  };

  // ── Auto-Varianten (Marc, 08.11.2026: „mach beim Auto ein paar verschiedene zur Auswahl“) ─────────────────
  // Alle aus demselben Bausatz: Unterteil = Seitenprofil (farbe), Glashaus (glas), Dach (farbe2, in das Glas versenkt —
  // Flimmer-Regel), Räder, Lichter, Spiegel. Keine echten Marken/Modelle nachgebaut, nur Fahrzeugklassen.
  /** o = {b (halbe Breite), unten [[y, z]] (Seitenprofil), haus [yh0, yv0, z0, yh1, yv1, z1, bu, bo] | null, dach (Rolle) | null,
   *       raeder [y …], r, rb, licht [z0, z1] (vorn, senkrechte Stirn), rueck [z0, z1] (hinten), spiegel [y, z] | null} */
  const wagen = (t, p, o) => {
    const dr = -p * 2 * PI, b = o.b, ys = o.unten.map((q) => q[0]), vorn = Math.max(...ys), hinten = Math.min(...ys);
    t.profil(o.unten, -b, b, o.koerper || "farbe");
    if (o.haus) {
      const [yh0, yv0, z0, yh1, yv1, z1, bu, bo] = o.haus;
      t.quader([[-bu, yh0, z0], [bu, yh0, z0], [bu, yv0, z0], [-bu, yv0, z0], [-bo, yh1, z1], [bo, yh1, z1], [bo, yv1, z1], [-bo, yv1, z1]], "glas");
      if (o.dach !== null) t.kasten(-bo - 0.02, bo + 0.02, yh1 - 0.02, yv1 + 0.02, z1 - 0.035, z1 + 0.03, o.dach || "farbe2");
    }
    for (const sx of [1, -1]) {
      for (const y of o.raeder) t.rad(sx * (b + o.rb * 0.12), y, o.r, o.r, o.rb, "grau", dr);
      const lb = Math.min(0.2, b * 0.24), lx = b - 0.1 - lb / 2;
      t.kasten(sx * lx - lb / 2, sx * lx + lb / 2, vorn - 0.04, vorn + 0.015, o.licht[0], o.licht[1], "licht");
      t.kasten(sx * lx - lb / 2, sx * lx + lb / 2, hinten - 0.015, hinten + 0.04, o.rueck[0], o.rueck[1], "rot");
      if (o.spiegel) t.kasten(sx * (b + 0.01), sx * (b + 0.13), o.spiegel[0] - 0.06, o.spiegel[0] + 0.06, o.spiegel[1], o.spiegel[1] + 0.1, "farbe2");
    }
  };
  M.auto_klein = (t, p) => wagen(t, p, {   // Kleinwagen ~ 3,8 m, kurze Haube, hohes Heck
    b: 0.86, unten: [[-1.9, 0.22], [1.9, 0.22], [1.9, 0.6], [1.75, 0.8], [1.0, 0.9], [-1.85, 0.93], [-1.9, 0.86]],
    haus: [-1.82, 0.98, 0.86, -1.6, -0.05, 1.48, 0.82, 0.7], raeder: [-1.25, 1.25], r: 0.3, rb: 0.2,
    licht: [0.46, 0.57], rueck: [0.62, 0.8], spiegel: [0.85, 0.9] });
  M.auto_limousine = (t, p) => wagen(t, p, {   // Limousine ~ 4,85 m, Stufenheck
    b: 0.92, unten: [[-2.42, 0.25], [2.42, 0.25], [2.42, 0.62], [2.3, 0.75], [1.1, 0.85], [-1.75, 0.88], [-2.38, 0.9], [-2.42, 0.82]],
    haus: [-1.75, 1.12, 0.83, -0.9, 0.25, 1.43, 0.88, 0.74], raeder: [-1.45, 1.45], r: 0.33, rb: 0.22,
    licht: [0.48, 0.6], rueck: [0.66, 0.8], spiegel: [1.0, 0.88] });
  M.auto_suv = (t, p) => {   // SUV ~ 4,7 m, hoch, Dachreling, dunkle Beplankung
    wagen(t, p, { b: 0.95, unten: [[-2.35, 0.32], [2.35, 0.32], [2.35, 0.8], [2.2, 0.98], [1.25, 1.05], [-2.3, 1.08], [-2.35, 1.0]],
      haus: [-2.25, 1.22, 1.02, -2.05, 0.2, 1.68, 0.9, 0.8], raeder: [-1.45, 1.45], r: 0.38, rb: 0.26,
      licht: [0.64, 0.76], rueck: [0.8, 0.96], spiegel: [1.1, 1.08] });
    t.kasten(-0.965, 0.965, -2.365, 2.365, 0.3, 0.5, "dunkel");                                     // Beplankung rundum
    for (const sx of [1, -1]) {
      t.rohr([0.62 * sx, -1.95, 1.8], [0.62 * sx, 0.1, 1.8], 0.025, "dunkel", 5);                   // Dachreling
      for (const y of [-1.9, 0.05]) t.rohr([0.62 * sx, y, 1.69], [0.62 * sx, y, 1.8], 0.02, "dunkel", 4);
    }
  };
  M.auto_sport = (t, p) => {   // Sportwagen ~ 4,45 m, flach, lange Haube, Heckflügel
    wagen(t, p, { b: 0.95, unten: [[-2.2, 0.14], [2.22, 0.14], [2.25, 0.4], [2.0, 0.56], [0.5, 0.72], [-1.6, 0.78], [-2.2, 0.75]],
      haus: [-1.7, 0.58, 0.7, -0.75, -0.15, 1.18, 0.85, 0.62], raeder: [-1.35, 1.3], r: 0.34, rb: 0.28,
      licht: [0.26, 0.36], rueck: [0.52, 0.66], spiegel: [0.45, 0.82] });
    t.kasten(-0.82, 0.82, -2.22, -1.95, 0.95, 0.99, "farbe2");                                      // Heckflügel
    for (const sx of [1, -1]) t.kasten(0.5 * sx - 0.03, 0.5 * sx + 0.03, -2.12, -2.04, 0.74, 0.96, "dunkel");
  };
  M.auto_cabrio = (t, p) => {   // Cabrio ~ 4,3 m, offen, mit Fahrerin/Fahrer
    wagen(t, p, { b: 0.88, unten: [[-2.15, 0.22], [2.15, 0.22], [2.15, 0.58], [2.0, 0.75], [0.7, 0.84], [-2.1, 0.86], [-2.15, 0.78]],
      haus: null, raeder: [-1.3, 1.3], r: 0.32, rb: 0.22, licht: [0.44, 0.55], rueck: [0.6, 0.75], spiegel: [0.62, 0.86] });
    t.quader([[-0.8, 0.66, 0.8], [0.8, 0.66, 0.8], [0.8, 0.72, 0.8], [-0.8, 0.72, 0.8],                    // Windschutzscheibe
              [-0.74, 0.32, 1.2], [0.74, 0.32, 1.2], [0.74, 0.38, 1.2], [-0.74, 0.38, 1.2]], "glas");
    for (const sx of [1, -1]) t.quader([[sx * 0.4 - 0.23, -0.62, 0.8], [sx * 0.4 + 0.23, -0.62, 0.8], [sx * 0.4 + 0.23, -0.5, 0.8], [sx * 0.4 - 0.23, -0.5, 0.8],
              [sx * 0.4 - 0.2, -0.74, 1.3], [sx * 0.4 + 0.2, -0.74, 1.3], [sx * 0.4 + 0.2, -0.63, 1.3], [sx * 0.4 - 0.2, -0.63, 1.3]], "dunkel");   // Lehnen
    t.kasten(-0.8, 0.8, -1.6, -1.05, 0.8, 0.97, "dunkel");                                          // gefaltetes Verdeck
    const lx = -0.4, lc = [lx, 0.2, 0.98], n = 14, P = [];                                          // Lenkrad, leicht geneigt
    for (let i = 0; i < n; i++) { const w = i / n * 2 * PI; P.push([lx + Math.cos(w) * 0.17, lc[1] + Math.sin(w) * 0.17 * 0.45, lc[2] + Math.sin(w) * 0.17 * 0.9]); }
    for (let i = 0; i < n; i++) t.rohr(P[i], P[(i + 1) % n], 0.018, "dunkel", 4);
    t.rohr(lc, [lx, 0.45, 0.82], 0.03, "dunkel", 5);
    t.mensch({ x: lx, y: -0.42, sitz: 0.5, neig: -14, beine: [{ ziel: [lx + 0.12, 0.85, 0.32] }, { ziel: [lx - 0.12, 0.85, 0.32] }],
               arme: [{ ziel: [lx + 0.15, 0.18, 1.02] }, { ziel: [lx - 0.15, 0.18, 1.02] }], kleid: "farbe2", hose: "dunkel", kopf: "haar" });
  };
  M.auto_pickup = (t, p) => {   // Pick-up ~ 5,3 m, Doppelkabine + offene Ladefläche
    wagen(t, p, { b: 0.98, unten: [[-2.65, 0.4], [2.65, 0.4], [2.65, 0.92], [2.5, 1.08], [1.4, 1.13], [-2.65, 1.13]],
      haus: [-0.55, 1.45, 1.08, -0.5, 0.45, 1.84, 0.93, 0.85], raeder: [-1.7, 1.75], r: 0.4, rb: 0.28,
      licht: [0.74, 0.86], rueck: [0.75, 0.95], spiegel: [1.3, 1.2] });
    for (const sx of [1, -1]) t.kasten(sx * 0.86, sx * 0.995, -2.66, -0.6, 1.08, 1.5, "farbe");     // Bordwände (außen 1,5 cm über der Flanke)
    t.kasten(-0.995, 0.995, -2.67, -2.56, 1.08, 1.5, "farbe");                                      // Heckklappe
    for (const sx of [1, -1]) t.kasten(sx * 0.85, sx * 1.005, -2.69, -0.58, 1.49, 1.53, "dunkel");   // Kante oben auf den Bordwänden
    t.kasten(-0.85, 0.85, -2.69, -2.55, 1.49, 1.53, "dunkel");
    t.kasten(-0.45, 0.45, -1.9, -1.2, 1.1, 1.5, "holz");                                           // Kiste
    t.kasten(-0.35, 0.35, -1.0, -0.65, 1.1, 1.38, "farbe2");                                       // Werkzeugkasten
  };
  M.auto_van = (t, p) => {   // Kleinbus ~ 4,9 m, zweifarbig (unten Farbe, oben Farbe 2)
    wagen(t, p, { b: 0.95, unten: [[-2.45, 0.3], [2.45, 0.3], [2.45, 0.9], [2.4, 1.05], [-2.45, 1.05]],
      haus: [-2.43, 2.35, 1.0, -2.4, 1.75, 1.92, 0.93, 0.88], dach: null, raeder: [-1.55, 1.6], r: 0.36, rb: 0.24,
      licht: [0.7, 0.84], rueck: [0.75, 0.98], spiegel: [2.0, 1.1] });
    const yf = (z) => 2.35 - 0.652 * (z - 1.0) + 0.025;                                            // 2,5 cm vor der Frontscheibe
    t.quader([[-0.915, -2.46, 1.6], [0.915, -2.46, 1.6], [0.915, yf(1.6), 1.6], [-0.915, yf(1.6), 1.6],
              [-0.9, -2.46, 1.97], [0.9, -2.46, 1.97], [0.9, yf(1.97), 1.97], [-0.9, yf(1.97), 1.97]], "farbe2");
    t.kasten(-0.6, 0.6, -1.6, 0.6, 1.95, 2.02, "weiss");                                            // Dachhaube
  };
  M.auto_gelaende = (t, p) => {   // Geländewagen ~ 4,5 m, kantig, Reserverad hinten, Kotflügel-Verbreiterung
    wagen(t, p, { b: 0.95, unten: [[-2.2, 0.42], [2.25, 0.42], [2.25, 1.0], [2.2, 1.12], [-2.2, 1.12]],
      haus: [-2.18, 1.2, 1.08, -2.16, 0.95, 1.9, 0.92, 0.88], raeder: [-1.4, 1.45], r: 0.4, rb: 0.3,
      licht: [0.82, 0.95], rueck: [0.75, 0.95], spiegel: [1.05, 1.15] });
    for (const sx of [1, -1]) for (const y of [-1.4, 1.45])
      t.kasten(sx * 0.9, sx * 1.04, y - 0.52, y + 0.52, 0.86, 0.94, "dunkel");                    // Kotflügel
    t.rohr([0, -2.21, 1.05], [0, -2.5, 1.05], 0.38, "reifen", 14); t.rohr([0, -2.49, 1.05], [0, -2.52, 1.05], 0.22, "farbe2", 10);   // Reserverad
    t.kasten(-1.0, 1.0, 2.25, 2.4, 0.5, 0.62, "dunkel");                                            // Stoßstange
    t.kasten(-0.75, 0.75, -1.9, 0.7, 1.98, 2.03, "dunkel");                                         // Dachträger
    for (const sx of [1, -1]) for (const y of [-1.8, 0.6]) t.rohr([0.7 * sx, y, 1.9], [0.7 * sx, y, 1.99], 0.02, "dunkel", 4);
  };

  M.motorrad = (t, p) => {   // Tourer ~ 2,2 m, mit Fahrer; Räder drehen
    const dr = -p * 2 * PI;
    for (const y of [0.72, -0.72]) t.rad(0, y, 0.33, 0.33, 0.13, "grau", dr);
    t.rohr([0, 0.72, 0.33], [0, 0.5, 1.0], 0.04, "grau");                                         // Gabel
    t.rohr([-0.38, 0.47, 1.05], [0.38, 0.47, 1.05], 0.025, "dunkel");                               // Lenker
    t.kasten(-0.17, 0.17, -0.15, 0.35, 0.35, 0.68, "grau");                                         // Motor
    t.kugel([0, 0.2, 0.86], [0.2, 0.34, 0.14], "farbe");                                            // Tank
    t.kasten(-0.15, 0.15, -0.6, -0.05, 0.78, 0.88, "dunkel");                                       // Sitz
    t.kasten(-0.13, 0.13, -0.95, -0.55, 0.6, 0.82, "farbe2");                                       // Heck
    t.rohr([0.2, -0.3, 0.45], [0.22, -0.95, 0.55], 0.06, "grau");                                   // Auspuff
    t.kugel([0, 0.62, 1.05], [0.12, 0.08, 0.1], "licht", 4, 8);                                     // Scheinwerfer
    t.kugel([0, 0.56, 1.22], [0.2, 0.04, 0.12], "glas", 3, 8);                                      // Windschild
    t.mensch({ y: -0.28, sitz: 0.95, neig: 28, beine: [{ ziel: [0.2, 0.15, 0.42] }, { ziel: [-0.2, 0.15, 0.42] }],
               arme: [{ ziel: [0.36, 0.45, 1.06] }, { ziel: [-0.36, 0.45, 1.06] }], kleid: "dunkel", hose: "dunkel", kopf: "helm", helm: "farbe2" });
  };

  M.wohnmobil = (t, p) => {   // Alkoven ~ 7 m; Räder drehen
    const dr = -p * 2 * PI;
    for (const sx of [1, -1]) for (const y of [-2.3, 2.3]) t.rad(1.05 * sx, y, 0.4, 0.4, 0.26, "grau", dr);
    const fenster = [[-3.5, -2.6, "weiss"], [-2.6, -1.4, "glas"], [-1.4, 0.2, "weiss"], [0.2, 1.1, "glas"], [1.1, 2.0, "weiss"]];
    t.kasten(-1.15, 1.15, -3.5, 2.0, 0.45, 1.25, "weiss");
    t.kasten(-1.15, 1.15, -3.5, 2.0, 1.25, 1.38, "farbe"); t.kasten(-1.15, 1.15, -3.5, 2.0, 1.38, 1.5, "farbe2");   // Zierband zweifarbig
    for (const [a, b, r] of fenster) t.kasten(-1.15, 1.15, a, b, 1.5, 2.25, r);
    t.kasten(-1.15, 1.15, -3.5, 2.0, 2.25, 3.0, "weiss");
    t.kasten(-1.12, 1.12, 2.0, 3.45, 0.45, 1.25, "weiss");                                           // Fahrerhaus
    t.quader([[-1.1, 2.0, 1.25], [1.1, 2.0, 1.25], [1.1, 3.4, 1.25], [-1.1, 3.4, 1.25],
              [-1.05, 2.0, 2.05], [1.05, 2.0, 2.05], [1.05, 2.55, 2.05], [-1.05, 2.55, 2.05]], "glas");
    t.kasten(-1.13, 1.13, 2.0, 2.95, 2.15, 2.95, "weiss");                                           // Alkoven
    for (const sx of [1, -1]) t.kasten(0.75 * sx - 0.15, 0.75 * sx + 0.15, 3.45, 3.48, 0.75, 0.95, "licht");
    t.kasten(-0.5, 0.5, -1.5, -0.5, 3.0, 3.25, "farbe2");                                            // Dachluke
  };

  M.bus = (t, p) => {   // Reisebus ~ 12 m; Räder drehen
    const dr = -p * 2 * PI;
    for (const sx of [1, -1]) for (const y of [-3.6, -2.4, 3.8]) t.rad(1.15 * sx, y, 0.5, 0.5, 0.3, "grau", dr);
    t.kasten(-1.27, 1.27, -6, 6, 0.35, 1.3, "farbe");
    t.kasten(-1.27, 1.27, -6, 6, 1.3, 1.45, "farbe2");
    for (let k = 0; k < 8; k++) { const y0 = -5.8 + k * 1.4; t.kasten(-1.27, 1.27, y0, y0 + 1.2, 1.45, 2.55, "glas"); t.kasten(-1.27, 1.27, y0 + 1.2, y0 + 1.4, 1.45, 2.55, "weiss"); }
    t.kasten(-1.27, 1.27, -6, -5.8, 1.45, 2.55, "weiss");
    t.kasten(-1.27, 1.27, 5.4, 6, 1.45, 2.55, "weiss");
    t.quader([[-1.25, 6, 1.0], [1.25, 6, 1.0], [1.25, 6.25, 1.0], [-1.25, 6.25, 1.0], [-1.25, 6, 3.0], [1.25, 6, 3.0], [1.2, 6.1, 3.0], [-1.2, 6.1, 3.0]], "glas");
    t.kasten(-1.27, 1.27, -6, 6, 2.55, 3.35, "weiss");
    for (const sx of [1, -1]) { t.kasten(0.9 * sx - 0.18, 0.9 * sx + 0.18, 6.0, 6.08, 0.6, 0.8, "licht"); t.rohr([1.27 * sx, 5.9, 2.6], [1.45 * sx, 6.3, 2.4], 0.04, "dunkel", 5); }
  };

  const fahrrad = (t, p, mtb, ru) => {   // ~ 1,8 m mit Fahrer; Kurbel dreht, Beine treten mit (Füße auf den Pedalen), Räder drehen
    const r = 0.34, d = mtb ? 0.05 : 0.028, th0 = p * 2 * PI, dr = -th0 * 2.2;
    const waag = Math.round((th0 - PI / 2) / PI) * PI + PI / 2, th = mix(th0, waag, ru || 0);   // Ruhe: Pedale waagrecht
    t.laufrad(0.53, r, r, d, dr); t.laufrad(-0.53, r, r, d, dr);
    const hinten = [0, -0.53, r], tret = [0, 0, 0.3], sattel = [0, -0.14, 0.86], steuer = [0, 0.38, 0.84];
    for (const [a, b] of [[hinten, tret], [tret, sattel], [sattel, steuer], [tret, steuer], [hinten, sattel]]) t.rohr(a, b, mtb ? 0.032 : 0.024, "farbe", 6);
    t.rohr(steuer, [0, 0.53, r], mtb ? 0.035 : 0.022, mtb ? "dunkel" : "grau", 6);                   // Gabel
    t.rohr([-0.24, 0.36, 0.95], [0.24, 0.36, 0.95], 0.018, "dunkel", 6); t.rohr(steuer, [0, 0.36, 0.95], 0.02, "grau", 6);
    t.kasten(-0.06, 0.06, -0.26, -0.04, 0.88, 0.93, "dunkel");
    t.rohr([-0.05, 0, 0.3], [0.05, 0, 0.3], 0.07, "grau", 10);                                        // Kettenblatt
    const pedal = [];
    for (const [s, w] of [[1, -th], [-1, -th + PI]]) {   // vorwärts treten: oben → vorn → unten (Marc 08.11.2026: „drehen rückwärts“)
      const pp = [0.09 * s, Math.sin(w) * 0.17, 0.3 - Math.cos(w) * 0.17];
      t.rohr([0.06 * s, 0, 0.3], pp, 0.012, "grau", 4);                                               // Kurbel
      t.kasten(pp[0] - 0.045, pp[0] + 0.045, pp[1] - 0.04, pp[1] + 0.04, pp[2] - 0.012, pp[2] + 0.012, "dunkel");
      pedal.push([pp[0] + 0.01 * s, pp[1], pp[2] + 0.06]);
    }
    t.mensch({ y: -0.16, sitz: 0.97, neig: mtb ? 32 : 38, beine: [{ ziel: pedal[0] }, { ziel: pedal[1] }],
               arme: [{ ziel: [0.22, 0.34, 0.97] }, { ziel: [-0.22, 0.34, 0.97] }], kleid: mtb ? "farbe2" : "farbe", hose: "dunkel",
               kopf: "helm", helm: mtb ? "farbe" : "farbe2", rucksack: mtb ? "farbe" : null });
  };
  M.rad = (t, p, r) => fahrrad(t, p, false, r);
  M.mountainbike = (t, p, r) => fahrrad(t, p, true, r);

  M.wanderer = (t, p, r = 0) => {
    const L = bein(gehen(p), r), Rr = bein(gehen((p + 0.5) % 1), r);
    const m = t.mensch({ boden: 0, neig: mix(6, 2, r), beine: [L, Rr],
      arme: [{ h: -0.75 * (L.h - 9) + 2, e: 18 }, { h: -0.75 * (Rr.h - 9) + 6, e: 30 }],
      kleid: "farbe", hose: "dunkel", kopf: "kappe", helm: "farbe2", rucksack: "farbe2" });
    const h = m.haende[1];   // Stock in der linken Hand, schwingt mit
    t.rohr([h[0], h[1] - 0.02, h[2] + 0.15], [h[0] + 0.02, h[1] + 0.22, Math.max(0, h[2] - 0.95)], 0.012, "grau", 5);
  };
  M.laeufer = (t, p, r = 0) => {
    const L = bein(laufen(p), r), Rr = bein(laufen((p + 0.5) % 1), r);
    t.mensch({ boden: 0.02 + 0.06 * Math.max(0, Math.sin(4 * PI * p)) * (1 - r), neig: mix(12, 3, r), beine: [L, Rr],
      arme: [{ h: -0.9 * (L.h - mix(12, 1, r)), e: mix(85, 25, r) }, { h: -0.9 * (Rr.h - mix(12, 1, r)), e: mix(85, 25, r) }],
      kleid: "farbe", hose: "dunkel", kopf: "kappe", helm: "farbe2", aermel: false });
  };
  M.reiter = (t, p, r = 0) => {   // Pferd ~ 2,4 m + Reiter; Schritt (Viertakt: hinten links, vorn links, hinten rechts, vorn rechts)
    const nick = Math.sin(4 * PI * p) * 0.03 * (1 - r);
    t.kugel([0, 0, 1.3 + nick * 0.5], [0.33, 0.85, 0.38], "fell", 6, 12);
    t.kugel([0, 0.55, 1.36 + nick * 0.5], [0.3, 0.3, 0.33], "fell", 5, 10);                           // Brust
    const kopfY = 1.18, kopfZ = 1.88 + nick;
    t.rohr([0, 0.62, 1.42], [0, 1.0, 1.95 + nick], 0.2, "fell", 8, 0.13);                             // Hals
    t.kugel([0, kopfY, kopfZ], [0.12, 0.3, 0.14], "fell", 5, 8);                                      // Kopf
    t.kugel([0, kopfY + 0.26, kopfZ - 0.05], [0.09, 0.08, 0.09], "dunkel", 3, 6);                     // Maul
    for (const s of [1, -1]) t.rohr([s * 0.06, 1.02, 2.0 + nick], [s * 0.07, 1.0, 2.12 + nick], 0.03, "fell", 4, 0.01);   // Ohren
    t.rohr([0, 0.7, 1.75], [0, 0.98, 2.08 + nick], 0.06, "dunkel", 6);                                // Mähne
    const beine = [[0.17, 0.52, 0.25], [-0.17, 0.52, 0.75], [0.17, -0.55, 0.0], [-0.17, -0.55, 0.5]];
    for (const [x, y, off] of beine) {
      const q = (p + off) % 1, a = 22 * Math.cos(2 * PI * q) * (1 - r), k = 8 + 55 * g(q, 0.7, 0.1) * (1 - r), vorn = y > 0;
      const [knie, huf] = glied([x, y, 1.15], a, vorn ? k : -k * 0.6, [0.55, 0.58], 0, false);
      t.rohr([x, y, 1.2], knie, 0.085, "fell", 6, 0.06); t.rohr(knie, huf, 0.055, "fell", 6, 0.048);
      t.kasten(huf[0] - 0.05, huf[0] + 0.05, huf[1] - 0.06, huf[1] + 0.06, huf[2] - 0.04, huf[2] + 0.02, "dunkel");
    }
    t.rohr([0, -0.8, 1.5], [0, -1.02, 0.95 + Math.sin(2 * PI * p) * 0.05 * (1 - r)], 0.07, "dunkel", 6, 0.03);   // Schweif
    t.kasten(-0.36, 0.36, -0.22, 0.2, 1.62, 1.72, "farbe");                                           // Satteldecke
    t.mensch({ sitz: 1.84 + nick * 1.5, neig: 4, beine: [{ ziel: [0.36, 0.12, 1.1] }, { ziel: [-0.36, 0.12, 1.1] }],
               arme: [{ ziel: [0.12, 0.55, 1.75] }, { ziel: [-0.12, 0.55, 1.75] }], kleid: "farbe2", hose: "dunkel", kopf: "helm", helm: "dunkel" });
    for (const s of [1, -1]) t.rohr([s * 0.12, 0.55, 1.75], [s * 0.1, kopfY + 0.15, kopfZ - 0.02], 0.01, "dunkel", 3);   // Zügel
  };
  M.ski = (t, p, r = 0) => {   // Skifahrer, wiegt sich und setzt die Stöcke abwechselnd
    const w = Math.sin(2 * PI * p) * (1 - r), sx = 0.06 * w;
    for (const s of [0.13, -0.13]) { t.kasten(s + sx - 0.05, s + sx + 0.05, -0.75, 0.9, 0.0, 0.03, "farbe2"); t.kasten(s + sx - 0.05, s + sx + 0.05, 0.9, 0.98, 0.03, 0.07, "farbe2"); }
    const m = t.mensch({ x: sx, boden: 0.03, neig: 28, beine: [{ h: 42, k: 62, seit: -3 * w }, { h: 42, k: 62, seit: -3 * w }],
      arme: [{ h: 25 + 25 * Math.max(0, w), e: 60 }, { h: 25 + 25 * Math.max(0, -w), e: 60 }], kleid: "farbe", hose: "dunkel", kopf: "helm", helm: "weiss" });
    m.haende.forEach((h, i) => { const vor = (i ? -w : w) > 0 ? 0.45 : -0.15;
      t.rohr(h, [h[0] * 1.5, h[1] + vor, 0.02], 0.012, "grau", 5); t.rohr([h[0] * 1.45, h[1] + vor * 0.92, 0.1], [h[0] * 1.45, h[1] + vor * 0.92, 0.11], 0.05, "dunkel", 6); });
  };

  M.kajak = (t, p, r = 0) => {   // ~ 4,8 m mit Paddler; Doppelpaddel taucht abwechselnd links und rechts ein
    t.rumpf([{ a: 2.4, rx: 0.02, rz: 0.05, cz: 0.22 }, { a: 1.6, rx: 0.22, rz: 0.15, cz: 0.18 }, { a: 0, rx: 0.32, rz: 0.18, cz: 0.17 },
             { a: -1.6, rx: 0.22, rz: 0.15, cz: 0.18 }, { a: -2.4, rx: 0.02, rz: 0.05, cz: 0.22 }], 12, () => "farbe", "y", "farbe");
    t.kugel([0, -0.1, 0.33], [0.22, 0.42, 0.04], "dunkel", 3, 10);                                   // Süll
    const a = 2 * PI * p, c = [0, 0.3, 0.88];
    const d0 = norm([Math.cos(0.5 * Math.sin(a)), 0.45 * Math.cos(a), -0.55 * Math.sin(a)]);         // Schaft: kippt und schwingt
    const d = norm([mix(d0[0], 1, r), mix(d0[1], 0, r), mix(d0[2], 0, r)]);                           // Ruhe: quer, waagrecht
    const hL = [c[0] + d[0] * 0.32, c[1] + d[1] * 0.32, c[2] + d[2] * 0.32], hR = [c[0] - d[0] * 0.32, c[1] - d[1] * 0.32, c[2] - d[2] * 0.32];
    t.mensch({ y: -0.1, sitz: 0.36, neig: 8, beine: [{ ziel: [0.12, 0.75, 0.3] }, { ziel: [-0.12, 0.75, 0.3] }],
               arme: [{ ziel: hL }, { ziel: hR }], kleid: "farbe2", kopf: "kappe", helm: "farbe" });
    const e1 = [c[0] + d[0] * 1.05, c[1] + d[1] * 1.05, c[2] + d[2] * 1.05], e2 = [c[0] - d[0] * 1.05, c[1] - d[1] * 1.05, c[2] - d[2] * 1.05];
    t.rohr(e1, e2, 0.016, "grau", 5);
    for (const e of [e1, e2]) t.blatt(e, d, 0.4, 0.15, 0.02, "dunkel", [0, 1, 0]);
  };
  M.sup = (t, p, r = 0) => {   // Board ~ 3,3 m mit Paddler; Paddelzug vorn → hinten, dann über Wasser zurück
    const n = 18, um = Array.from({ length: n }, (_, i) => { const w = i / n * 2 * PI; return [Math.cos(w) * 0.42 * (Math.sin(w) > 0 ? 1 - 0.35 * Math.sin(w) ** 6 : 1), Math.sin(w) * 1.65]; });
    t.platte(um, 0, 0.13, "farbe");
    t.platte(um.map(([x, y]) => [x * 0.75, y * 0.4 - 0.1]), 0.13, 0.14, "dunkel");
    // Paddel an der rechten Seite (Marc 08.11.2026: „SUP paddelt durch seinen Körper durch“): oberer Griff VOR der Brust,
    // Blatt neben dem Board — der Schaft bleibt außerhalb von Rumpf und Hüfte. Zug unter Wasser vorn → hinten, zurück darüber.
    const a = 2 * PI * p, zug = Math.cos(a) * (1 - r), unter = Math.sin(a) > 0 && r < 0.5;   // Ruhe: Paddel senkrecht neben dem Board
    const blatt = [0.62, 0.45 + 0.6 * zug, unter ? -0.04 : 0.32];
    const oben = [0.12, 0.5 + 0.18 * zug, 1.52], schaft = norm(sub(blatt, oben));
    const unterH = [oben[0] + schaft[0] * 0.58, oben[1] + schaft[1] * 0.58, oben[2] + schaft[2] * 0.58];
    t.mensch({ boden: 0.14, neig: mix(8, 3, r) + 10 * Math.max(0, zug), beine: [{ h: 6, k: 12 }, { h: -4, k: 10 }],
               arme: [{ ziel: unterH }, { ziel: [oben[0] - 0.02, oben[1] - 0.03, oben[2] - 0.02] }], kleid: "farbe2", kopf: "kappe", helm: "weiss" });
    t.rohr(oben, blatt, 0.016, "grau", 5);
    t.blatt(blatt, [0, 0, 1], 0.42, 0.18, 0.02, "dunkel", [1, 0, 0]);
    t.rohr([oben[0] - 0.08, oben[1], oben[2]], [oben[0] + 0.08, oben[1], oben[2]], 0.018, "dunkel", 5);
  };
  M.hubschrauber = (t, p) => {   // ~ 12 m mit Rotor; Haupt- und Heckrotor drehen
    const a = 2 * PI * p;
    t.kugel([0, 0.6, 1.5], [1.1, 2.3, 1.15], "farbe", 7, 14);
    t.kugel([0, 2.05, 1.7], [0.92, 0.95, 0.85], "glas", 5, 12);
    t.rohr([0, -1.4, 1.85], [0, -6.2, 2.25], 0.4, "farbe", 10, 0.15);
    t.flosse(2.1, -5.5, -6.5, 0.12, 3.4, -6.2, -6.8, 0.06, "farbe2");
    t.kasten(-0.9, 0.9, -5.6, -5.3, 2.15, 2.25, "farbe2");
    for (let k = 0; k < 2; k++) { const w = a * 2 + k * PI / 2; t.blatt([0.18, -6.3, 2.6], [0, Math.cos(w), Math.sin(w)], 1.2, 0.12, 0.03, "dunkel", [0, 0, 0]); }
    t.rohr([0, 0.6, 2.6], [0, 0.6, 3.05], 0.12, "grau", 8);
    for (let k = 0; k < 4; k++) { const w = a + k * PI / 2, d = [Math.cos(w), Math.sin(w), 0]; t.blatt([d[0] * 3.1, 0.6 + d[1] * 3.1, 3.12], d, 6.0, 0.4, 0.06, "dunkel"); }
    t.kugel([0, 0.6, 3.12], [0.25, 0.25, 0.12], "grau", 3, 8);
    for (const sx of [1, -1]) {
      t.rohr([0.95 * sx, -1.3, 0.08], [0.95 * sx, 2.4, 0.08], 0.06, "grau", 6);
      t.rohr([0.95 * sx, 2.4, 0.08], [0.95 * sx, 2.75, 0.3], 0.06, "grau", 6);
      for (const y of [-0.6, 1.6]) t.rohr([0.95 * sx, y, 0.08], [0.6 * sx, y, 0.75], 0.045, "grau", 5);
    }
  };
  M.drohne = (t, p) => {   // Quadrokopter ~ 0,35 × 0,42 m (Klapparme, Kamera-Gimbal vorn); vier Rotoren drehen paarweise gegenläufig
    // Marc, 10.11.2026: „wir brauchen noch eine Drohne als 3D-Modell“. Gebaut wie eine Reisedrohne, keine Marke nachgebaut.
    const a = 2 * PI * p;
    t.kugel([0, 0.0, 0.0], [0.075, 0.15, 0.045], "farbe", 5, 12);                                   // Rumpf
    t.kugel([0, -0.02, 0.03], [0.06, 0.11, 0.03], "farbe2", 3, 10);                                 // Deckel oben
    t.kugel([0, 0.13, 0.0], [0.05, 0.035, 0.03], "dunkel", 3, 8);                                   // Nase / Sensoren
    for (const sx of [1, -1]) t.kugel([0.025 * sx, 0.155, 0.006], [0.01, 0.006, 0.008], "glas", 2, 6);   // Hindernissensoren
    t.kugel([0, 0.115, -0.048], [0.026, 0.026, 0.026], "grau", 3, 8);                               // Gimbal
    t.kugel([0, 0.14, -0.05], [0.016, 0.006, 0.016], "glas", 3, 8);                                 // Objektiv
    t.kasten(-0.03, 0.03, -0.15, -0.13, -0.01, 0.01, "dunkel");                                    // Akku-Ende
    const motoren = [[0.16, 0.12], [-0.16, 0.12], [0.18, -0.12], [-0.18, -0.12]];
    motoren.forEach(([x, y], k) => {
      const vorn = y > 0, wurzel = [0.05 * Math.sign(x), vorn ? 0.07 : -0.07, vorn ? 0.0 : -0.012];
      const z = vorn ? 0.012 : -0.004;                                                              // hintere Arme tiefer (wie beim Klappen)
      t.rohr(wurzel, [x, y, z], 0.011, vorn ? "farbe2" : "farbe", 6, 0.009);                         // Arm, vordere in Zweitfarbe
      t.rohr([x, y, z - 0.018], [x, y, z + 0.022], 0.017, "grau", 8);                               // Motor
      t.rohr([x, y, z - 0.018], [x, y, z - 0.055], 0.005, "dunkel", 4);                             // Landefuß
      t.kugel([x, y, z - 0.004], [0.006, 0.006, 0.006], vorn ? "licht" : "rot", 2, 5);               // Lichter: vorn weiß, hinten rot
      const dreh = (k === 0 || k === 3 ? 1 : -1) * a * 3 + k;                                       // paarweise gegenläufig
      for (let b = 0; b < 2; b++) {
        const w = dreh + b * PI, d = [Math.cos(w), Math.sin(w), 0];
        t.blatt([x + d[0] * 0.062, y + d[1] * 0.062, z + 0.027], d, 0.12, 0.018, 0.003, "dunkel");
      }
      t.kugel([x, y, z + 0.027], [0.009, 0.009, 0.005], "grau", 2, 6);                              // Nabe
    });
  };
  M.hubschrauber = (t, p) => {   // ~ 12 m mit Rotor; Haupt- und Heckrotor drehen
    const a = 2 * PI * p;
    t.kugel([0, 0.6, 1.5], [1.1, 2.3, 1.15], "farbe", 7, 14);
    t.kugel([0, 2.05, 1.7], [0.92, 0.95, 0.85], "glas", 5, 12);
    t.rohr([0, -1.4, 1.85], [0, -6.2, 2.25], 0.4, "farbe", 10, 0.15);
    t.flosse(2.1, -5.5, -6.5, 0.12, 3.4, -6.2, -6.8, 0.06, "farbe2");
    t.kasten(-0.9, 0.9, -5.6, -5.3, 2.15, 2.25, "farbe2");
    for (let k = 0; k < 2; k++) { const w = a * 2 + k * PI / 2; t.blatt([0.18, -6.3, 2.6], [0, Math.cos(w), Math.sin(w)], 1.2, 0.12, 0.03, "dunkel", [0, 0, 0]); }
    t.rohr([0, 0.6, 2.6], [0, 0.6, 3.05], 0.12, "grau", 8);
    for (let k = 0; k < 4; k++) { const w = a + k * PI / 2, d = [Math.cos(w), Math.sin(w), 0]; t.blatt([d[0] * 3.1, 0.6 + d[1] * 3.1, 3.12], d, 6.0, 0.4, 0.06, "dunkel"); }
    t.kugel([0, 0.6, 3.12], [0.25, 0.25, 0.12], "grau", 3, 8);
    for (const sx of [1, -1]) {
      t.rohr([0.95 * sx, -1.3, 0.08], [0.95 * sx, 2.4, 0.08], 0.06, "grau", 6);
      t.rohr([0.95 * sx, 2.4, 0.08], [0.95 * sx, 2.75, 0.3], 0.06, "grau", 6);
      for (const y of [-0.6, 1.6]) t.rohr([0.95 * sx, y, 0.08], [0.6 * sx, y, 0.75], 0.045, "grau", 5);
    }
  };
  // ── Weitere Drohnen-Formen (10.11.2026, Marc: „such mal einfach verschiedene Drohnen-Modelle und dann baue das an“) ──
  // Bauformen, keine Marken nachgebaut: Mini mit Schutzkäfig (Handflächen-/Selfie-Drohne), FPV mit Ringen um die Rotoren
  // (Cinewhoop), FPV-Racer (X-Rahmen, offene Propeller), 360°-Drohne (je eine Linse oben und unten), Profi-Kameradrohne
  // (Arme schräg nach oben, große Kamera unten). Rotoren drehen paarweise gegenläufig wie bei der Reisedrohne.
  /** Ring in der xy-Ebene aus kurzen Rohren (Schutzbügel) */
  const ringXY = (t, c, r, dicke, rolle, n = 16) => {
    const P = Array.from({ length: n }, (_, i) => [c[0] + Math.cos(i / n * 2 * PI) * r, c[1] + Math.sin(i / n * 2 * PI) * r, c[2]]);
    for (let i = 0; i < n; i++) t.rohr(P[i], P[(i + 1) % n], dicke, rolle, 5);
  };
  /** Hohle Hülse um die senkrechte Achse durch c (Rotor-Ring): Innen-/Außenradius, Höhe h */
  const huelse = (t, c, ri, ra, h, rolle, n = 20) => {
    const z0 = c[2] - h / 2, z1 = c[2] + h / 2;
    const pt = (i, r, z) => { const w = i / n * 2 * PI; return [c[0] + Math.cos(w) * r, c[1] + Math.sin(w) * r, z]; };
    for (let i = 0; i < n; i++) {
      const j = i + 1, wm = (i + 0.5) / n * 2 * PI, aus = [c[0] + Math.cos(wm) * ra * 3, c[1] + Math.sin(wm) * ra * 3, c[2]];
      t.viereck(pt(i, ra, z0), pt(j, ra, z0), pt(j, ra, z1), pt(i, ra, z1), rolle, c);                            // außen
      t.viereck(pt(i, ri, z0), pt(j, ri, z0), pt(j, ri, z1), pt(i, ri, z1), rolle, aus);                          // innen
      t.viereck(pt(i, ri, z1), pt(j, ri, z1), pt(j, ra, z1), pt(i, ra, z1), rolle, [c[0], c[1], z0 - h]);          // Rand oben
      t.viereck(pt(i, ri, z0), pt(j, ri, z0), pt(j, ra, z0), pt(i, ra, z0), rolle, [c[0], c[1], z1 + h]);          // Rand unten
    }
  };
  /** Rotor mit n Blättern um (x, y, z), Radius r; `dreh` Bogenmaß */
  const rotor = (t, x, y, z, r, n, dreh, rolle = "dunkel") => {
    for (let b = 0; b < n; b++) {
      const w = dreh + b * 2 * PI / n, d = [Math.cos(w), Math.sin(w), 0];
      t.blatt([x + d[0] * r * 0.5, y + d[1] * r * 0.5, z], d, r * 0.96, r * 0.17, r * 0.03, rolle);
    }
    t.kugel([x, y, z + r * 0.02], [r * 0.13, r * 0.13, r * 0.07], "grau", 2, 6);
  };
  /** Drehwinkel des Rotors k (0…3) in Phase p — diagonal gegenüberliegende drehen gleich, Nachbarn gegenläufig */
  const rotorDreh = (p, k) => (k === 0 || k === 3 ? 1 : -1) * 2 * PI * p * 3 + k;
  M.drohne_mini = (t, p) => {   // Handflächen-Drohne ~ 0,15 × 0,16 m, Rotoren rundum im Schutzkäfig, Kamera vorn
    t.kugel([0, 0, 0], [0.034, 0.05, 0.02], "farbe", 4, 12);                                          // Rumpf
    t.kugel([0, -0.006, 0.014], [0.028, 0.038, 0.009], "farbe2", 3, 10);                              // Deckel
    t.kugel([0, 0.048, -0.003], [0.017, 0.012, 0.016], "dunkel", 3, 8);                               // Kamerakopf
    t.kugel([0, 0.058, -0.003], [0.009, 0.004, 0.009], "glas", 3, 8);                                 // Objektiv
    const Q = [[0.055, 0.052], [-0.055, 0.052], [0.055, -0.052], [-0.055, -0.052]];
    Q.forEach(([x, y], k) => {
      t.rohr([0.02 * Math.sign(x), 0.025 * Math.sign(y), 0], [x, y, 0.002], 0.006, "farbe", 6);       // Arm
      t.rohr([x, y, -0.006], [x, y, 0.008], 0.009, "grau", 8);                                      // Motor
      rotor(t, x, y, 0.011, 0.036, 2, rotorDreh(p, k));
      ringXY(t, [x, y, 0.016], 0.042, 0.0035, "farbe");                                             // Käfig oben
      ringXY(t, [x, y, -0.008], 0.042, 0.0035, "farbe");                                            // Käfig unten
      for (let s = 0; s < 4; s++) {                                                                  // Gitter oben + Streben
        const w = s * PI / 4 + PI / 8, d = [Math.cos(w) * 0.042, Math.sin(w) * 0.042];
        t.rohr([x - d[0], y - d[1], 0.017], [x + d[0], y + d[1], 0.017], 0.0018, "farbe", 4);
        t.rohr([x + d[0], y + d[1], -0.008], [x + d[0], y + d[1], 0.016], 0.0025, "farbe", 4);
      }
    });
  };
  M.drohne_fpv = (t, p) => {   // FPV mit Ringen um die Rotoren (Cinewhoop) ~ 0,18 × 0,2 m; gedrungen, Kamera vorn, Antennen hinten
    const D = [[0.064, 0.058], [-0.064, 0.058], [0.064, -0.058], [-0.064, -0.058]];
    // 12.11.2026 (Marc: „warum hat die Drohne eine schwarze Platte drunter!? weg damit“) — statt der Bodenplatte schmale Arme
    D.forEach(([x, y], k) => {
      t.rohr([0.018 * Math.sign(x), 0.03 * Math.sign(y), -0.006], [x, y, -0.006], 0.005, "grau", 6);   // Arm zum Motor
      huelse(t, [x, y, -0.002], 0.039, 0.045, 0.03, "farbe");                                         // Ring
      t.rohr([x, y, -0.016], [x, y, 0.0], 0.011, "grau", 8);                                          // Motor
      rotor(t, x, y, 0.003, 0.037, 3, rotorDreh(p, k));
    });
    t.kugel([0, 0, 0.012], [0.04, 0.07, 0.028], "farbe2", 4, 12);                                     // Rumpf
    t.kasten(-0.026, 0.026, -0.065, -0.01, 0.03, 0.05, "dunkel");                                     // Akku oben
    t.kugel([0, 0.07, 0.01], [0.022, 0.016, 0.02], "dunkel", 3, 8);                                   // Kamera
    t.kugel([0, 0.085, 0.01], [0.012, 0.004, 0.012], "glas", 3, 8);
    for (const sx of [1, -1]) t.rohr([0.012 * sx, -0.06, 0.04], [0.032 * sx, -0.095, 0.072], 0.0025, "grau", 4);   // Antennen
  };
  M.drohne_race = (t, p) => {   // FPV-Racer ~ 0,25 × 0,22 m: X-Rahmen aus Carbon, offene Dreiblatt-Propeller, Akku + Actioncam oben
    const R = [[0.095, 0.085], [-0.095, 0.085], [0.095, -0.085], [-0.095, -0.085]];
    R.forEach(([x, y], k) => {
      const l = Math.hypot(x, y), d = [x / l, y / l, 0];
      t.blatt([x / 2, y / 2, 0.003], d, l + 0.02, 0.02, 0.005, "dunkel");                              // Arm
      t.rohr([x, y, 0.005], [x, y, 0.026], 0.012, "grau", 8);                                         // Motor
      rotor(t, x, y, 0.03, 0.064, 3, rotorDreh(p, k), "farbe2");                                      // Propeller in Zweitfarbe
    });
    t.kasten(-0.03, 0.03, -0.06, 0.06, 0.0, 0.006, "dunkel");                                         // Unterplatte
    t.kasten(-0.03, 0.03, -0.055, 0.05, 0.032, 0.036, "dunkel");                                      // Oberplatte
    for (const [x, y] of [[0.026, 0.045], [-0.026, 0.045], [0.026, -0.05], [-0.026, -0.05]]) t.rohr([x, y, 0.006], [x, y, 0.032], 0.003, "grau", 5);
    t.kasten(-0.018, 0.018, -0.045, 0.03, 0.036, 0.066, "farbe");                                     // Akku
    t.kasten(-0.02, 0.02, -0.012, -0.004, 0.035, 0.068, "farbe2");                                    // Gurt
    t.kasten(-0.02, 0.02, 0.03, 0.058, 0.04, 0.074, "dunkel");                                        // Actioncam
    t.kugel([0, 0.06, 0.057], [0.01, 0.004, 0.01], "glas", 3, 8);
    t.kugel([0, 0.066, 0.018], [0.012, 0.01, 0.011], "dunkel", 3, 8);                                 // FPV-Kamera vorn
    t.kugel([0, 0.075, 0.018], [0.007, 0.003, 0.007], "glas", 3, 6);
    t.rohr([0, -0.055, 0.034], [0, -0.09, 0.07], 0.003, "grau", 4);                                   // Antenne
  };
  M.drohne_360 = (t, p) => {   // 360°-Drohne ~ 0,31 × 0,38 m: je eine Linse oben und unten (die Drohne verschwindet beim Zusammensetzen)
    t.kugel([0, 0, 0], [0.06, 0.09, 0.04], "farbe", 5, 12);                                           // Rumpf
    t.kugel([0, -0.01, 0.02], [0.05, 0.07, 0.022], "farbe2", 3, 10);                                  // Deckel
    t.rohr([0, 0, 0.035], [0, 0, 0.06], 0.026, "dunkel", 12);                                         // Linse oben: Fassung
    t.kugel([0, 0, 0.062], [0.022, 0.022, 0.018], "glas", 4, 10);                                     //               Glas
    t.rohr([0, 0, -0.035], [0, 0, -0.06], 0.026, "dunkel", 12);                                       // Linse unten
    t.kugel([0, 0, -0.062], [0.022, 0.022, 0.018], "glas", 4, 10);
    const A = [[0.15, 0.17], [-0.15, 0.17], [0.15, -0.17], [-0.15, -0.17]];
    A.forEach(([x, y], k) => {
      t.rohr([0.045 * Math.sign(x), 0.05 * Math.sign(y), 0], [x, y, 0], 0.01, "farbe", 6, 0.008);    // Arm
      t.rohr([x, y, -0.014], [x, y, 0.016], 0.016, "grau", 8);                                        // Motor
      t.kugel([x, y, 0.0], [0.006, 0.006, 0.006], y > 0 ? "licht" : "rot", 2, 5);
      rotor(t, x, y, 0.02, 0.07, 2, rotorDreh(p, k));
    });
  };
  M.drohne_profi = (t, p) => {   // Profi-Kameradrohne ~ 0,6 × 0,5 m: Arme schräg nach oben (Flugstellung), große Kamera am Gimbal unten
    t.kugel([0, 0, 0], [0.09, 0.17, 0.05], "farbe", 5, 14);                                           // Rumpf
    t.kugel([0, 0.02, 0.03], [0.07, 0.12, 0.025], "farbe2", 3, 12);                                   // Deckel
    t.kugel([0, 0.16, 0.0], [0.05, 0.03, 0.03], "dunkel", 3, 8);                                      // Nase / Sensoren
    t.rohr([0, 0.07, -0.04], [0, 0.07, -0.075], 0.012, "grau", 6);                                    // Gimbal-Aufhängung
    t.kasten(-0.045, 0.045, 0.03, 0.12, -0.14, -0.075, "dunkel");                                     // Kamera
    t.rohr([0, 0.12, -0.108], [0, 0.155, -0.108], 0.026, "dunkel", 12);                               // Objektiv
    t.kugel([0, 0.158, -0.108], [0.02, 0.004, 0.02], "glas", 3, 10);
    for (const sx of [1, -1]) {
      for (const sy of [1, -1]) {
        const k = (sx > 0 ? 0 : 1) + (sy > 0 ? 0 : 2), x = 0.3 * sx, y = 0.2 * sy, z = 0.1;
        t.rohr([0.06 * sx, 0.07 * sy, 0.0], [x, y, z], 0.016, "farbe", 8, 0.012);                   // Arm (Rohr, schräg hoch)
        t.rohr([x, y, z - 0.02], [x, y, z + 0.02], 0.024, "grau", 10);                               // Motor
        t.kugel([x, y, z - 0.024], [0.008, 0.008, 0.008], sy > 0 ? "licht" : "rot", 2, 5);
        rotor(t, x, y, z + 0.026, 0.15, 2, rotorDreh(p, k));
      }
      t.rohr([0.08 * sx, 0.06, -0.02], [0.13 * sx, 0.06, -0.16], 0.008, "grau", 6);                  // Landebeine
      t.rohr([0.08 * sx, -0.08, -0.02], [0.13 * sx, -0.08, -0.16], 0.008, "grau", 6);
      t.rohr([0.13 * sx, 0.12, -0.16], [0.13 * sx, -0.14, -0.16], 0.009, "grau", 6);                 // Kufe
    }
  };
  M.gleitschirm = (t, p, r = 0) => {   // Schirm ~ 11 m Spannweite, Pilot im Gurtzeug, Beine baumeln
    const N = 14, R = 6.2, H = 7.0, sp = 62;
    const pt = (i, y, d) => { const a = (-sp + i / N * 2 * sp) * PI / 180; return [Math.sin(a) * (R + d), y, H - R + Math.cos(a) * (R + d)]; };
    for (let i = 0; i < N; i++) {
      const v0 = 1.3, h0 = -1.3, d = 0.25, rolle = i % 2 ? "farbe2" : "farbe";
      t.quader([pt(i, v0, 0), pt(i, h0, 0.05), pt(i + 1, h0, 0.05), pt(i + 1, v0, 0), pt(i, v0, d), pt(i, h0, d * 0.4), pt(i + 1, h0, d * 0.4), pt(i + 1, v0, d)], rolle);
    }
    for (const i of [0, 3, 7, 11, 14]) for (const y of [0.7, -0.7]) { const q = pt(i, y, 0); t.rohr([Math.sign(q[0]) * 0.25, 0, 1.3], q, 0.012, "dunkel", 4); }
    const sw = 8 * Math.sin(2 * PI * p) * (1 - r);
    t.mensch({ sitz: 0.9, neig: -12, beine: [{ h: 70 + sw, k: 55 }, { h: 70 - sw, k: 55 }],
               arme: [{ ziel: [0.3, 0.05, 1.45] }, { ziel: [-0.3, 0.05, 1.45] }], kleid: "farbe", kopf: "helm", helm: "farbe2" });
    t.kasten(-0.3, 0.3, -0.4, 0.12, 0.7, 1.0, "dunkel");                                              // Gurtzeug
    t.kasten(-0.25, 0.25, -0.5, -0.38, 0.75, 1.35, "dunkel");                                         // Rückenteil
  };
  M.heissluftballon = (t, p) => {   // Hülle ~ 17 m, Korb mit Brenner; Flamme flackert
    const prof = [[4.5, 1.2], [6.0, 2.4], [9.0, 5.0], [12.5, 7.6], [16.0, 8.5], [19.5, 7.8], [22.5, 5.6], [24.6, 2.8], [25.5, 0.3]];
    t.rumpf(prof.map(([z, r]) => ({ a: z, rx: r, rz: r })), 16, (w) => ["farbe", "weiss", "farbe2", "weiss"][Math.floor(w / (2 * PI) * 16) % 4], "z", "farbe");
    t.kasten(-0.75, 0.75, -0.75, 0.75, 0, 1.15, "holz");
    t.kasten(-0.78, 0.78, -0.78, 0.78, 1.1, 1.2, "dunkel");                                          // Korbrand
    t.kasten(-0.3, 0.3, -0.3, 0.3, 2.4, 2.9, "grau");
    const fl = 0.6 + 0.4 * Math.abs(Math.sin(2 * PI * p * 2)) * (0.7 + 0.3 * Math.sin(2 * PI * p * 5));
    t.kugel([0, 0, 3.2 + fl * 0.4], [0.22 * fl, 0.22 * fl, 0.55 * fl], "flamme", 3, 6);
    for (const sx of [1, -1]) for (const sy of [1, -1]) {
      t.rohr([0.7 * sx, 0.7 * sy, 1.15], [0.28 * sx, 0.28 * sy, 2.6], 0.03, "dunkel", 4);
      t.rohr([0.28 * sx, 0.28 * sy, 2.6], [1.0 * sx, 1.0 * sy, 4.6], 0.03, "dunkel", 4);
    }
    for (const sx of [0.35, -0.35]) t.mensch({ x: sx, y: 0.1, s: 1, sitz: 1.5, neig: 0, beine: [{ h: 0, k: 0 }, { h: 0, k: 0 }], arme: [{ h: 10, e: 30 }, { h: 10, e: 30 }], kleid: sx > 0 ? "farbe2" : "farbe", kopf: "haar" });
  };

  M.zug = (t) => {   // Hochgeschwindigkeitszug, ein Wagen ~ 26 m
    t.rumpf([
      { a: 13.2, rx: 0.15, rz: 0.15, cz: 1.2 }, { a: 12.6, rx: 0.9, rz: 0.7, cz: 1.3 }, { a: 11.2, rx: 1.35, rz: 1.35, cz: 1.75 },
      ...Array.from({ length: 23 }, (_, k) => ({ a: 9.0 - k, rx: 1.48, rz: 1.75, cz: 2.15 })),
    ], 20, (w, a) => {
      const z = Math.sin(w);
      if (a > 10.6 && a < 12.4 && z > 0.25 && z < 0.8) return "glas";
      if (a < 8.8 && a > -12.8 && z > 0.1 && z < 0.45 && Math.round(a + 30) % 3 !== 0) return "glas";
      if (z > -0.35 && z < -0.15) return "farbe";
      if (z > -0.5 && z <= -0.35) return "farbe2";
      if (z < -0.75) return "grau";
      return "weiss";
    }, "y", "weiss");
    for (const y of [8.5, -10]) { t.kasten(-1.2, 1.2, y - 1.4, y + 1.4, 0.1, 0.55, "dunkel"); for (const sx of [1, -1]) for (const dy of [-0.9, 0.9]) t.rad(1.05 * sx, y + dy, 0.4, 0.38, 0.12, "dunkel"); }
    t.rohr([0, 2, 3.85], [0, 0.5, 4.6], 0.04, "dunkel", 5); t.rohr([0, 0.5, 4.6], [0, -1, 4.6], 0.03, "dunkel", 5);   // Stromabnehmer
  };

  const rumpfBoot = (t, L, B, H, oben, unten, wl) => t.rumpf([
    { a: L / 2, rx: 0.02, rz: H * 0.35, cz: H * 0.75 }, { a: L * 0.38, rx: B * 0.32, rz: H * 0.5, cz: H * 0.6 },
    { a: L * 0.15, rx: B * 0.5, rz: H * 0.55, cz: H * 0.5 }, { a: -L * 0.42, rx: B * 0.48, rz: H * 0.5, cz: H * 0.55 }, { a: -L / 2, rx: B * 0.42, rz: H * 0.4, cz: H * 0.65 },
  ], 16, (w) => Math.sin(w) < (wl == null ? -0.2 : wl) ? unten : oben, "y", "weiss");
  M.boot = (t) => {   // Motorboot ~ 8 m
    rumpfBoot(t, 8, 2.6, 1.3, "weiss", "farbe");
    t.kasten(-0.95, 0.95, -1.2, 1.2, 1.25, 1.75, "weiss");
    t.quader([[-0.95, 1.2, 1.75], [0.95, 1.2, 1.75], [0.95, 1.6, 1.75], [-0.95, 1.6, 1.75], [-0.9, 1.2, 2.25], [0.9, 1.2, 2.25], [0.9, 1.3, 2.25], [-0.9, 1.3, 2.25]], "glas");
    t.kasten(-0.95, 0.95, -1.2, 1.2, 1.75, 2.3, "weiss"); t.kasten(-0.9, 0.9, -1.0, 1.0, 2.3, 2.38, "farbe2");
    t.kasten(-0.3, 0.3, -4.35, -3.85, 0.5, 1.6, "dunkel");                                          // Außenborder
  };
  M.segelboot = (t) => {   // Segelyacht: Rumpf 10 m, Mast 13 m
    rumpfBoot(t, 10, 3.2, 1.4, "weiss", "farbe2");
    t.kasten(-1.0, 1.0, -2.2, 1.2, 1.35, 1.9, "weiss");
    t.rohr([0, 1.0, 1.4], [0, 1.0, 14.5], 0.09, "grau", 6);                                        // Mast
    t.rohr([0, 1.0, 2.6], [0, -3.8, 2.6], 0.07, "grau", 6);                                        // Baum
    t.quader([[-0.04, 0.85, 2.7], [-0.04, -3.7, 2.7], [-0.04, 0.8, 14.0], [-0.04, 0.85, 14.0], [0.04, 0.85, 2.7], [0.04, -3.7, 2.7], [0.04, 0.8, 14.0], [0.04, 0.85, 14.0]], "segel");   // Großsegel
    t.quader([[-0.03, 1.2, 1.8], [-0.03, 4.8, 1.6], [-0.03, 1.25, 12.8], [-0.03, 1.2, 12.8], [0.03, 1.2, 1.8], [0.03, 4.8, 1.6], [0.03, 1.25, 12.8], [0.03, 1.2, 12.8]], "farbe");     // Vorsegel
  };
  M.faehre = (t) => {   // Autofähre ~ 60 m
    const bug = (z0, z1, r, ein = 0) => t.platte([[-7 + ein, -30], [7 - ein, -30], [7 - ein, 20], [4 - ein, 27], [0, 30 - ein], [-4 + ein, 27], [-7 + ein, 20]], z0, z1, r);
    bug(0, 3.5, "farbe"); bug(3.5, 6, "weiss");
    t.kasten(-6.5, 6.5, -26, 16, 6, 9, "weiss");
    for (let k = 0; k < 12; k++) { const y0 = -25 + k * 3.4; t.kasten(-6.5, 6.5, y0, y0 + 2.4, 9, 10.4, "glas"); t.kasten(-6.5, 6.5, y0 + 2.4, y0 + 3.4, 9, 10.4, "weiss"); }
    t.kasten(-6.5, 6.5, -26, -25, 9, 10.4, "weiss"); t.kasten(-6.5, 6.5, 15.8, 16, 9, 10.4, "weiss");
    t.kasten(-6.5, 6.5, -26, 16, 10.4, 11.4, "weiss");
    t.kasten(-5, 5, 6, 14, 11.4, 14.0, "weiss"); t.kasten(-5.02, 5.02, 13.0, 14.0, 12.2, 13.6, "glas");   // Brücke
    t.kasten(-1.8, 1.8, -16, -11, 11.4, 17, "farbe2"); t.kasten(-1.8, 1.8, -16, -11, 17, 17.8, "dunkel");   // Schornstein
  };

  // ── Normieren + Zwischenspeicher ──────────────────────────────────────────
  const _cache = {};
  // Normierung je Art einmal aus Phase 0 — sonst würde das Modell mit jeder Haltung anders groß/versetzt
  const _norm = {};
  function bauen(art, p, r) { const t = new Teile(); (M[art] || M.auto)(t, p || 0, r || 0); return t; }
  /** Netz eines Modells in Phase p (0…1 des Bewegungszyklus, ZYKLUS[art] Sekunden). Bewegte Arten: 48 Stufen je Zyklus zwischengespeichert. */
  /** `ruhe` 0…1 (08.11.2026): 0 = in Bewegung, 1 = Ruhepose; in 8 Stufen zwischengespeichert. */
  function mesh(art, p, ruhe) {
    const bewegt = ZYKLUS[art] != null, stufe = bewegt ? ((Math.round((p || 0) * 48) % 48) + 48) % 48 : 0;
    const rs = bewegt ? Math.max(0, Math.min(8, Math.round((+ruhe || 0) * 8))) : 0, key = art + ":" + stufe + (rs ? ":r" + rs : "");
    if (_cache[key]) return _cache[key];
    if (!_norm[art]) {
      const P = bauen(art, 0).pos, n = P.length / 3, lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
      for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[3 * i + k]); hi[k] = Math.max(hi[k], P[3 * i + k]); }
      const luft = LUFT.has(art);
      _norm[art] = { s: 1 / Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]), c: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, luft ? (lo[2] + hi[2]) / 2 : 0],
                     luft, masse: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] };
    }
    const N = _norm[art], t = bauen(art, stufe / 48, rs / 8), P = t.pos, n = P.length / 3, pos = new Float32Array(P.length);
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) pos[3 * i + k] = (P[3 * i + k] - N.c[k]) * N.s;
    return (_cache[key] = { pos, nor: new Float32Array(t.nor), rolle: t.rolle, luft: N.luft, dreiecke: n / 3, masse: N.masse });
  }

  function rgb(hex, rueck) {
    let h = String(hex || rueck || "#48D6C4").replace("#", "");
    if (h.length === 3) h = h.replace(/(.)/g, "$1$1");
    return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
  }
  const FEST = { weiss: [0.94, 0.95, 0.96], grau: [0.62, 0.65, 0.68], dunkel: [0.17, 0.19, 0.22], glas: [0.13, 0.19, 0.25], reifen: [0.07, 0.07, 0.08],
                 licht: [1, 0.93, 0.7], rot: [0.85, 0.12, 0.1], holz: [0.55, 0.36, 0.2], haut: [0.93, 0.74, 0.6], fell: [0.45, 0.28, 0.16], segel: [0.97, 0.97, 0.95],
                 haar: [0.3, 0.2, 0.13], schuhe: [0.22, 0.2, 0.19], flamme: [1, 0.62, 0.15] };
  function farbe(rolle, p) {
    if (rolle === "farbe") return rgb(p && p.farbe, "#48D6C4");
    if (rolle === "farbe2") return rgb(p && p.farbe2, "#FF896B");
    return FEST[rolle] || [0.8, 0.8, 0.8];
  }
  const ARTEN = ["auto", "auto_klein", "auto_limousine", "auto_suv", "auto_sport", "auto_cabrio", "auto_pickup", "auto_van", "auto_gelaende",
                 "motorrad", "wohnmobil", "bus", "rad", "mountainbike", "wanderer", "laeufer", "reiter", "ski",
                 "zug", "boot", "segelboot", "faehre", "kajak", "sup", "flugzeug", "hubschrauber", "drohne", "drohne_mini", "drohne_fpv", "drohne_race", "drohne_360", "drohne_profi", "gleitschirm", "heissluftballon"];
  const NAMEN = { auto: "Auto · Kombi", auto_klein: "Auto · Kleinwagen", auto_limousine: "Auto · Limousine", auto_suv: "Auto · SUV",
                  auto_sport: "Auto · Sportwagen", auto_cabrio: "Auto · Cabrio", auto_pickup: "Auto · Pick-up", auto_van: "Auto · Kleinbus", auto_gelaende: "Auto · Geländewagen", motorrad: "Motorrad", wohnmobil: "Wohnmobil", bus: "Bus", rad: "Rad", mountainbike: "Mountainbike", wanderer: "zu Fuß",
                  laeufer: "Laufen", reiter: "Reiten", ski: "Ski", zug: "Zug", boot: "Boot", segelboot: "Segelboot", faehre: "Fähre", kajak: "Kajak",
                  sup: "SUP", flugzeug: "Flugzeug", hubschrauber: "Hubschrauber", drohne: "Drohne · Faltdrohne", drohne_mini: "Drohne · Mini mit Schutzkäfig", drohne_fpv: "Drohne · FPV mit Ringen",
                  drohne_race: "Drohne · FPV-Racer", drohne_360: "Drohne · 360°", drohne_profi: "Drohne · Profi-Kamera", gleitschirm: "Gleitschirm", heissluftballon: "Heißluftballon" };
  const LICHT = (() => { const l = [-0.45, 0.55, 0.75], n = Math.hypot(...l); return l.map((x) => x / n); })();   // Ost, Nord, oben
  /** Varianten je Verkehrsart (für eine spätere Auswahl im Studio: Art „auto“ → eine dieser Formen) */
  const VARIANTEN = { auto: ["auto", "auto_klein", "auto_limousine", "auto_suv", "auto_sport", "auto_cabrio", "auto_pickup", "auto_van", "auto_gelaende"],
                      drohne: ["drohne", "drohne_mini", "drohne_fpv", "drohne_race", "drohne_360", "drohne_profi"] };
  /** Vorschau als Bild (Auswahlkacheln): Ansicht schräg von vorn rechts oben, Maler-Verfahren (hinten zuerst), Licht wie
   *  im Studio. `p` = { farbe, farbe2, phase, ruhe }. Ergebnis: Canvas `px` × `px`, durchsichtiger Grund. */
  const _vorschauCache = new Map();
  function vorschau(art, px, p) {
    const ph = (p && +p.phase) || 0, ru = (p && +p.ruhe) || 0;
    const key = art + "|" + px + "|" + (p && p.farbe) + "|" + (p && p.farbe2) + "|" + ph + "|" + ru;
    if (_vorschauCache.has(key)) return _vorschauCache.get(key);
    const t = mesh(art, ph, ru), n = t.pos.length / 3, gier = 35 * PI / 180, kipp = 24 * PI / 180;
    const cg = Math.cos(gier), sg = Math.sin(gier), ck = Math.cos(kipp), sk = Math.sin(kipp);
    const sicht = (x, y, z) => { const x1 = x * cg + y * sg, y1 = -x * sg + y * cg; return [x1, y1 * sk + z * ck, y1 * ck - z * sk]; };   // rechts, oben, Tiefe
    const P = [], lo = [1e9, 1e9], hi = [-1e9, -1e9];
    for (let i = 0; i < n; i++) { const q = sicht(t.pos[3 * i], t.pos[3 * i + 1], t.pos[3 * i + 2]); P.push(q); lo[0] = Math.min(lo[0], q[0]); lo[1] = Math.min(lo[1], q[1]); hi[0] = Math.max(hi[0], q[0]); hi[1] = Math.max(hi[1], q[1]); }
    const s = 0.86 * px / Math.max(hi[0] - lo[0], hi[1] - lo[1], 1e-6), mx = (lo[0] + hi[0]) / 2, my = (lo[1] + hi[1]) / 2;
    const c = document.createElement("canvas"); c.width = c.height = px;
    const g2 = c.getContext("2d"), F = {}, D = [];
    for (let i = 0; i < n; i += 3) D.push([i, (P[i][2] + P[i + 1][2] + P[i + 2][2]) / 3]);
    D.sort((a, b) => b[1] - a[1]);
    for (const [i] of D) {
      const r = t.rolle[i], f = F[r] || (F[r] = farbe(r, p));
      const d = Math.max(0, t.nor[3 * i] * LICHT[0] + t.nor[3 * i + 1] * LICHT[1] + t.nor[3 * i + 2] * LICHT[2]);
      const h = 0.42 + 0.62 * d + (r === "licht" ? 0.4 : 0), col = "rgb(" + f.map((v) => Math.round(255 * Math.min(1, v * h))).join(",") + ")";
      g2.fillStyle = g2.strokeStyle = col; g2.lineWidth = 0.6; g2.beginPath();
      for (let k = 0; k < 3; k++) { const q = P[i + k], X = px / 2 + (q[0] - mx) * s, Y = px / 2 - (q[1] - my) * s; if (k) g2.lineTo(X, Y); else g2.moveTo(X, Y); }
      g2.closePath(); g2.fill(); g2.stroke();
    }
    if (_vorschauCache.size > 120) _vorschauCache.clear();
    _vorschauCache.set(key, c);
    return c;
  }
  window.rzModelle = { mesh, farbe, vorschau, ARTEN, NAMEN, LUFT, LICHT, ZYKLUS, VARIANTEN };
})();
