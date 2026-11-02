/* einrasten.js — intelligente Hilfslinien beim Ziehen (01.11.2026)
 *
 * Marc: „Es muss ein spezieller Einraster sein, wenn man auf gleicher Höhe wie andere ist oder wenn man komplett in der
 * Mitte drin ist, also dass man richtig die Mitte trifft, sowohl horizontal als auch vertikal. Orientier dich da an
 * anderen Tools.“ — wie Keynote/Figma/Canva: Kanten und Mitten des gezogenen Elements rasten an der Bildmitte und an
 * Kanten/Mitten der anderen Elemente ein; gleiche Abstände zwischen drei Elementen nebeneinander bzw. übereinander;
 * beim Einrasten steht eine farbige Hilfslinie. ⌘ gedrückt = frei (der Aufrufer übergibt `frei`).
 *
 *   const r = rzEinrasten.rechnen({ box, ziele, rahmen: { w, h }, schwelle: 6 })
 *     box   = { l, t, r, b } des gezogenen Elements (Pixel im Rahmen), schon um die Mausbewegung verschoben
 *     ziele = [{ l, t, r, b }] der übrigen sichtbaren Elemente
 *   → { dx, dy, linien: [{ art: "v"|"h", pos, von, bis, mitte? }], abstaende: [{ art, von, bis, pos }] }
 *   rzEinrasten.zeichnen(ebene, r)   // Hilfslinien in eine Ebene (absolut, Pixel im Rahmen) zeichnen
 *   rzEinrasten.weg(ebene)
 */
(function () {
  "use strict";
  const FARBE = "#ff3ea5";

  function naechste(werte, ziele, schwelle) {
    // werte = [[name, px]] des gezogenen Elements, ziele = [[px, info]] → beste Verschiebung
    let best = null;
    for (const [name, w] of werte) {
      for (const [z, info] of ziele) {
        const d = z - w;
        if (Math.abs(d) <= schwelle && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, name, z, info };
      }
    }
    return best;
  }

  function rechnen(o) {
    const box = o.box, R = o.rahmen || { w: 0, h: 0 }, S = o.schwelle == null ? 6 : o.schwelle;
    const ziele = (o.ziele || []).filter(Boolean);
    const cx = (box.l + box.r) / 2, cy = (box.t + box.b) / 2;
    // senkrechte Linien (x): Bildmitte, Ränder anderer Elemente, deren Mitten
    const zx = [[R.w / 2, { mitte: true }]];
    const zy = [[R.h / 2, { mitte: true }]];
    for (const z of ziele) {
      zx.push([z.l, { z }], [(z.l + z.r) / 2, { z }], [z.r, { z }]);
      zy.push([z.t, { z }], [(z.t + z.b) / 2, { z }], [z.b, { z }]);
    }
    const bx = naechste([["l", box.l], ["c", cx], ["r", box.r]], zx, S);
    const by = naechste([["t", box.t], ["c", cy], ["b", box.b]], zy, S);
    let dx = bx ? bx.d : 0, dy = by ? by.d : 0;
    // gleiche Abstände (nur wenn keine Kante gegriffen hat): Nachbarn links/rechts bzw. oben/unten auf gleicher Höhe
    const abstaende = [];
    if (!bx) {
      const reihe = ziele.filter(z => z.b > box.t + dy && z.t < box.b + dy);
      const links = reihe.filter(z => z.r <= box.l).sort((a, b) => b.r - a.r)[0];
      const rechts = reihe.filter(z => z.l >= box.r).sort((a, b) => a.l - b.l)[0];
      if (links && rechts) {
        const soll = ((rechts.l - links.r) - (box.r - box.l)) / 2;   // gleicher Abstand zu beiden
        const d = (links.r + soll) - box.l;
        if (Math.abs(d) <= S) { dx = d; const y = (Math.max(box.t, links.t, rechts.t) + Math.min(box.b, links.b, rechts.b)) / 2 + dy;
          abstaende.push({ art: "h", von: links.r, bis: box.l + dx, pos: y }, { art: "h", von: box.r + dx, bis: rechts.l, pos: y }); }
      }
    }
    if (!by) {
      const spalte = ziele.filter(z => z.r > box.l + dx && z.l < box.r + dx);
      const oben = spalte.filter(z => z.b <= box.t).sort((a, b) => b.b - a.b)[0];
      const unten = spalte.filter(z => z.t >= box.b).sort((a, b) => a.t - b.t)[0];
      if (oben && unten) {
        const soll = ((unten.t - oben.b) - (box.b - box.t)) / 2;
        const d = (oben.b + soll) - box.t;
        if (Math.abs(d) <= S) { dy = d; const x = (Math.max(box.l, oben.l, unten.l) + Math.min(box.r, oben.r, unten.r)) / 2 + dx;
          abstaende.push({ art: "v", von: oben.b, bis: box.t + dy, pos: x }, { art: "v", von: box.b + dy, bis: unten.t, pos: x }); }
      }
    }
    // Hilfslinien: über die ganze Höhe/Breite bei der Bildmitte, sonst vom gezogenen bis zum Partner-Element
    const linien = [];
    if (bx) {
      const z = bx.info.z;
      linien.push(bx.info.mitte ? { art: "v", pos: bx.z, von: 0, bis: R.h, mitte: true }
        : { art: "v", pos: bx.z, von: Math.min(box.t + dy, z.t), bis: Math.max(box.b + dy, z.b) });
    }
    if (by) {
      const z = by.info.z;
      linien.push(by.info.mitte ? { art: "h", pos: by.z, von: 0, bis: R.w, mitte: true }
        : { art: "h", pos: by.z, von: Math.min(box.l + dx, z.l), bis: Math.max(box.r + dx, z.r) });
    }
    return { dx, dy, linien, abstaende };
  }

  function weg(ebene) { if (ebene) ebene.querySelectorAll(".rz-hilfslinie").forEach(e => e.remove()); }

  function zeichnen(ebene, r) {
    if (!ebene) return;
    weg(ebene);
    const linie = (stil) => { const d = document.createElement("div"); d.className = "rz-hilfslinie"; d.setAttribute("style", stil); ebene.appendChild(d); };
    // r.k = Vergrößerung der Ebene (Vorschau skaliert): Bildschirm-px → Ebenen-px
    const k = (r && +r.k > 0) ? +r.k : 1;
    r = Object.assign({}, r, {
      linien: ((r && r.linien) || []).map(l => Object.assign({}, l, { pos: l.pos / k, von: l.von / k, bis: l.bis / k })),
      abstaende: ((r && r.abstaende) || []).map(a2 => Object.assign({}, a2, { pos: a2.pos / k, von: a2.von / k, bis: a2.bis / k })),
    });
    for (const l of (r && r.linien) || []) {
      if (l.art === "v") linie(`position:absolute;left:${l.pos.toFixed(1)}px;top:${l.von.toFixed(1)}px;width:0;height:${Math.max(0, l.bis - l.von).toFixed(1)}px;border-left:1px ${l.mitte ? "solid" : "dashed"} ${FARBE};pointer-events:none;z-index:50`);
      else linie(`position:absolute;top:${l.pos.toFixed(1)}px;left:${l.von.toFixed(1)}px;height:0;width:${Math.max(0, l.bis - l.von).toFixed(1)}px;border-top:1px ${l.mitte ? "solid" : "dashed"} ${FARBE};pointer-events:none;z-index:50`);
    }
    for (const a of (r && r.abstaende) || []) {   // gleiche Abstände: kurze Maßlinien mit Enden
      if (a.art === "h") linie(`position:absolute;top:${a.pos.toFixed(1)}px;left:${a.von.toFixed(1)}px;height:6px;margin-top:-3px;width:${Math.max(0, a.bis - a.von).toFixed(1)}px;border:solid ${FARBE};border-width:0 1px;background:linear-gradient(${FARBE},${FARBE}) center/100% 1px no-repeat;pointer-events:none;z-index:50`);
      else linie(`position:absolute;left:${a.pos.toFixed(1)}px;top:${a.von.toFixed(1)}px;width:6px;margin-left:-3px;height:${Math.max(0, a.bis - a.von).toFixed(1)}px;border:solid ${FARBE};border-width:1px 0;background:linear-gradient(${FARBE},${FARBE}) center/1px 100% no-repeat;pointer-events:none;z-index:50`);
    }
  }

  window.rzEinrasten = { rechnen, zeichnen, weg, FARBE };
})();
