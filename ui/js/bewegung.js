// Symbole je Bewegungsart (13.10.2026) — Draufsicht, Richtung nach oben, drei Ebenen (hell / dunkel / akzent), die sich
// getrennt einfärben lassen. Die Pfade stehen in bewegung_pfade.js (erzeugt aus ui/img/bewegung/*.svg); gezeichnet wird
// hier selbst — auf Canvas für die Karte (Vorschau = Video-Render) und als SVG-Text für Knöpfe und Kacheln.
// Farbe: „linie“ = Linienfarbe der Tour mit passendem Akzent, „fest“ = zwei frei wählbare Farben (Vorgabe Schiefer/Mint).
(function () {
  "use strict";
  const PFADE = () => window.RZ_BEWEGUNG_PFADE || {};
  // Reihenfolge in der Oberfläche: Straße/Weg, Schiene, Wasser, Luft
  const ARTEN = ["auto", "motorrad", "wohnmobil", "bus", "rad", "mountainbike", "wanderer", "laeufer", "reiter", "ski",
                 "zug", "boot", "segelboot", "faehre", "kajak", "sup", "flugzeug", "hubschrauber", "gleitschirm", "heissluftballon"];
  const SYMBOL = { boot: "motorboot" };   // „Boot“ gab es schon vor den Symbolen — es zeigt das Motorboot
  const FEST = { dunkel: "#2b3a40", akzent: "#4fc9ab", hell: "#ffffff" };
  const EBENEN = ["hell", "dunkel", "akzent"];
  const TRANSFORM = "translate(0,512) scale(0.1,-0.1)";

  function symbolVon(art) { const s = SYMBOL[art] || art; return PFADE()[s] ? s : ""; }

  function _rgb(c) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(c || "").trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
  }
  function _hex(r) { return "#" + r.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join(""); }
  function _misch(a, b, t) { return [0, 1, 2].map(i => a[i] + (b[i] - a[i]) * t); }
  function _hell(r) { return (0.2126 * r[0] + 0.7152 * r[1] + 0.0722 * r[2]) / 255; }

  /** Farben der drei Ebenen. modus „fest“: dunkel/akzent wie gewählt (sonst Schiefer/Mint); sonst aus der Linienfarbe:
   *  Körper = Linienfarbe, Akzent = aufgehellt (dunkle Linie) bzw. abgedunkelt (helle Linie). Sehr helle Linienfarben
   *  (Weiß, Gelb) würden mit den hellen Flächen verschwimmen — dann wird der Körper abgedunkelt und die Linie zum Akzent. */
  function farben(modus, linie, dunkel, akzent) {
    if (modus === "fest") return { dunkel: _rgb(dunkel) ? dunkel : FEST.dunkel, akzent: _rgb(akzent) ? akzent : FEST.akzent, hell: FEST.hell };
    const l = _rgb(linie) || _rgb(FEST.akzent);
    const h = _hell(l);
    if (h > 0.78) return { dunkel: _hex(_misch(l, [0, 0, 0], 0.55)), akzent: _hex(l), hell: FEST.hell };
    return { dunkel: _hex(l), akzent: _hex(h < 0.5 ? _misch(l, [255, 255, 255], 0.55) : _misch(l, [0, 0, 0], 0.4)), hell: FEST.hell };
  }

  /** SVG-Text (für Knöpfe, Kacheln, Web). `px` = Kantenlänge; leer, wenn es kein Symbol gibt. */
  function svg(art, f, px) {
    const s = symbolVon(art);
    if (!s) return "";
    const p = PFADE()[s], fa = f || FEST, gr = px || 24;
    const teile = EBENEN.filter(e => p[e] && p[e].length)
      .map(e => `<g fill="${fa[e] || FEST[e]}" transform="${TRANSFORM}">${p[e].map(d => `<path d="${d}"/>`).join("")}</g>`);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${gr}" height="${gr}" aria-hidden="true">${teile.join("")}</svg>`;
  }

  /** Bild für die Karte ({width, height, data} wie map.addImage es nimmt) bzw. Canvas (opt.canvas): Symbol mit weißem
   *  Rand und weichem Schatten, damit es auf jeder Karte lesbar bleibt. `px` = Kantenlänge in Bildpunkten. */
  function bild(art, f, px, opt) {
    const s = symbolVon(art);
    if (!s) return null;
    const p = PFADE()[s], fa = f || FEST, w = Math.max(16, Math.round(px || 192));
    const c = document.createElement("canvas"); c.width = w; c.height = w;
    const g = c.getContext("2d");
    const rand = !(opt && opt.rand === false);
    const innen = rand ? 0.82 : 1;   // Platz für Rand und Schatten
    const k = (w / 512) * innen;
    const pf = {}, alle = new Path2D();
    EBENEN.forEach(e => { if (p[e] && p[e].length) { const pa = new Path2D(); p[e].forEach(d => pa.addPath(new Path2D(d))); pf[e] = pa; alle.addPath(pa); } });
    const setz = () => { g.setTransform(1, 0, 0, 1, 0, 0); g.translate(w * (1 - innen) / 2, w * (1 - innen) / 2); g.scale(k, k); g.translate(0, 512); g.scale(0.1, -0.1); };
    if (rand) {
      setz();
      g.lineJoin = "round"; g.lineWidth = 260; g.strokeStyle = "#ffffff"; g.fillStyle = "#ffffff";
      g.shadowColor = "rgba(0,0,0,0.38)"; g.shadowBlur = w * 0.05; g.shadowOffsetY = w * 0.01;
      g.stroke(alle); g.fill(alle);   // ein Umriss für alle Ebenen — sonst lägen Schatten in den Fugen
      g.shadowColor = "transparent";
    }
    setz();
    EBENEN.forEach(e => { if (pf[e]) { g.fillStyle = fa[e] || FEST[e]; g.fill(pf[e]); } });
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (opt && opt.canvas) return c;
    return { width: w, height: w, data: g.getImageData(0, 0, w, w).data };
  }

  window.RZ_BEWEGUNGEN = ARTEN;
  window.RZ_BEWEGUNG_FEST = FEST;
  window.rzBewegungSymbol = symbolVon;
  window.rzBewegungFarben = farben;
  window.rzBewegungSvg = svg;
  window.rzBewegungBild = bild;
})();
