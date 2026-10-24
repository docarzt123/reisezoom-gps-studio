/* Zeitstrahl des Logbuchs — EIN Baustein für die Tour-Seite und den GPX-Inspektor (24.10.2026).
 *
 * Marc (24.10.2026): „generell sollten wir ein Logbuch für alles haben? Könnten wir das zusammenfassen?“ — und „ja auch
 * auf die Tourseite“. Der Zeitstrahl stand bisher nur im Inspektor (modules/gpxinspect, seit 13.09.2026). Hier liegt das
 * Zeichnen: Spuren Tage · Bewegung (mit Höhenprofil) · Punkte · Zeitachse. Der Inspektor hängt seine Werkzeuge an
 * (eigene Spuren, Befunde, POI-Spur, Ziehen der Grenzen, Anker), die Tour-Seite nimmt `einbauen` (Klick wählt den
 * Eintrag, Mausrad zoomt, Doppelklick auf einen Tag zeigt nur ihn, Doppelklick daneben wieder alles).
 *
 *   rzLogbuchStrahl.svgHtml({ W, H, zeilen, spanne, tage, eintraege, punkte, profil, gewaehlt, tagAktiv, extra, kennung })
 *   const s = rzLogbuchStrahl.einbauen(box, { daten, eintraege, punkte, profil, gewaehlt, tagAktiv, onWahl })
 *   s.render() · s.zuTag(nr) · s.ganz()
 */
(function () {
  "use strict";
  const T = (k, f, p) => (typeof t === "function" ? t(k, f, p) : (f || k));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const LA = () => window.rzLogbuchAnsicht || {};
  const sprache = () => { try { return rzSprachCode(); } catch (_) { return undefined; } };

  /** Zeilen (y von–bis) wie im Inspektor — ohne POI-, Eigene- und Befund-Spur. */
  const ZEILEN = { tage: [3, 17], bewegung: [23, 87], punkte: [91, 109], achse: [113, 131] };
  const HOEHE = 134;

  /** Zeitspanne über Einträge und Punkte, mit etwas Rand. */
  function spanne(eintraege, punkte) {
    let t0 = Infinity, t1 = -Infinity;
    for (const e of eintraege || []) { t0 = Math.min(t0, e.t0); t1 = Math.max(t1, e.t1); }
    for (const p of punkte || []) { t0 = Math.min(t0, p.t); t1 = Math.max(t1, p.t); }
    if (!isFinite(t0)) return null;
    const pad = Math.max(60, (t1 - t0) * 0.01);
    return [t0 - pad, t1 + pad];
  }

  /** Höhenprofil als Silhouette in der Bewegungsspur; `paare` = [[Zeit, Höhe], …] (höchstens ~900 genügen). */
  function profilPfad(paare, X, f0, f1, yTop, yBot) {
    if (!paare || paare.length < 2) return "";
    const schritt = Math.max(1, Math.floor(paare.length / 900));
    let lo = Infinity, hi = -Infinity;
    const pts = [];
    for (let i = 0; i < paare.length; i += schritt) {
      const [tI, e] = paare[i];
      if (!isFinite(tI) || e == null || !isFinite(e) || tI < f0 || tI > f1) continue;
      pts.push([X(tI), e]); if (e < lo) lo = e; if (e > hi) hi = e;
    }
    if (pts.length < 2 || !isFinite(lo)) return "";
    if (hi - lo < 5) hi = lo + 5;
    const Y = (e) => yBot - 2 - ((e - lo) / (hi - lo)) * (yBot - yTop - 6);
    let d = `M${pts[0][0].toFixed(1)} ${(yBot - 2).toFixed(1)}`;
    for (const [x, e] of pts) d += ` L${x.toFixed(1)} ${Y(e).toFixed(1)}`;
    d += ` L${pts[pts.length - 1][0].toFixed(1)} ${(yBot - 2).toFixed(1)} Z`;
    return `<path d="${d}" class="gpxi-lb-profil"/>`;
  }

  function achse(X, f0, f1, W, versatz, y) {
    const L = LA(), span = f1 - f0;
    const stufen = [900, 1800, 3600, 7200, 10800, 21600, 43200, 86400, 172800, 604800, 1209600];
    let schritt = stufen[stufen.length - 1];
    for (const st of stufen) { if (W / (span / st) >= 78) { schritt = st; break; } }
    const off = (versatz || 0) * 60;
    let s = `<line x1="0" y1="${y}" x2="${W}" y2="${y}" class="gpxi-lb-achse"/>`;
    const start = Math.floor((f0 + off) / schritt) * schritt - off;
    const mitDatum = schritt >= 86400;
    for (let tt = start; tt <= f1; tt += schritt) {
      const x = X(tt); if (x < 0 || x > W) continue;
      const lok = new Date((tt + off) * 1000);
      const mitternacht = lok.getUTCHours() === 0 && lok.getUTCMinutes() === 0;
      const txt = mitDatum || mitternacht ? L.tagText(tt, versatz, { weekday: "short", day: "numeric", month: "numeric" }) : L.uhr(tt, versatz);
      s += `<line x1="${x.toFixed(1)}" y1="${y}" x2="${x.toFixed(1)}" y2="${y + 4}" class="gpxi-lb-achse"/>`
         + `<text x="${(x + 3).toFixed(1)}" y="${y + 14}" class="gpxi-lb-achse-txt${mitternacht ? " ist-tag" : ""}">${esc(txt)}</text>`;
    }
    return s;
  }

  /** Der ganze Strahl als SVG-Inhalt. `gewaehlt(id)` markiert Einträge/Punkte, `tagAktiv` den Tag, der gerade dran ist,
   *  `extra(X, W)` hängt weitere Spuren an (Inspektor), `kennung` macht die Muster-ID je SVG eindeutig. */
  function svgHtml(o) {
    const L = LA(), W = o.W, H = o.H || HOEHE, Z = o.zeilen || ZEILEN, [f0, f1] = o.spanne, span = Math.max(1, f1 - f0);
    const X = (tEpoch) => ((tEpoch - f0) / span) * W;
    const gew = o.gewaehlt || (() => false), kn = o.kennung || "lb";
    const versatz = ((o.eintraege || [])[0] || {}).versatz_min || ((o.tage || [])[0] || {}).versatz_min || 0;
    let s = `<defs><pattern id="${kn}-streifen" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
        <rect width="8" height="8" fill="#6b7280"/><rect width="4" height="8" fill="#9ca3af"/></pattern></defs>`;
    s += `<rect x="0" y="${Z.bewegung[0]}" width="${W}" height="${Z.bewegung[1] - Z.bewegung[0]}" class="gpxi-lb-spurbg"/>`;
    s += `<rect x="0" y="${Z.punkte[0]}" width="${W}" height="${Z.punkte[1] - Z.punkte[0]}" class="gpxi-lb-spurbg"/>`;
    // Tage
    (o.tage || []).forEach((d, k) => {
      const x0 = Math.max(0, X(d.t0)), x1 = Math.min(W, X(d.t1)); if (x1 <= 0 || x0 >= W) return;
      const w = Math.max(2, x1 - x0);
      const lang = w > 120 ? { weekday: "short", day: "numeric", month: "numeric" } : (w > 60 ? { day: "numeric", month: "numeric" } : null);
      const txt = lang ? T("logbuch.tag", "Tag {n}", { n: d.nr }) + " · " + L.tagText(d.t0, d.versatz_min, lang) : (w > 16 ? String(d.nr) : "");
      s += `<g class="gpxi-lb-tagblock${k % 2 ? " ist-zweiter" : ""}${o.tagAktiv === d.nr ? " ist-aktiv" : ""}" data-lb-tag="${d.nr}"><rect x="${x0.toFixed(1)}" y="${Z.tage[0]}" width="${w.toFixed(1)}" height="${Z.tage[1] - Z.tage[0]}" rx="3"/>`
         + (txt ? `<text x="${(x0 + 5).toFixed(1)}" y="${Z.tage[0] + 10.5}">${esc(txt)}</text>` : "")
         + `<title>${esc(T("logbuch.tag", "Tag {n}", { n: d.nr }) + " · " + L.tagText(d.t0, d.versatz_min, { weekday: "long", day: "numeric", month: "long", year: "numeric" }))}</title></g>`;
    });
    // Bewegung: ein Block je Eintrag
    const y0 = Z.bewegung[0] + 3, hB = Z.bewegung[1] - Z.bewegung[0] - 6;
    for (const e of o.eintraege || []) {
      const x0 = X(e.t0), x1 = X(e.t1); if (x1 < 0 || x0 > W) continue;
      const xa = Math.max(-2, x0), xb = Math.min(W + 2, x1), w = Math.max(1.5, xb - xa);
      const still = e.art === "pause" || e.art === "halt";
      const fill = e.anzeige_art === "unsicher" ? `url(#${kn}-streifen)` : L.farbe(e.anzeige_art || e.art);
      const cls = "gpxi-lb-block" + (still ? " ist-still" : "") + (gew(e.id) ? " ist-gewaehlt" : "") + (e.geraten ? " ist-geraten" : "");
      const name = e.name || L.artName(e.anzeige_art || e.art);
      const label = w > 34 ? name : "";
      const passt = label && (label.length * 6.4 + 10) < w;
      const zeile2 = w > 64 ? L.dauer(e.dauer_s) + (e.strecke_m > 950 && w > 96 ? " · " + L.km(e.strecke_m) : "") : "";
      s += `<g class="${cls}" data-lb="${esc(e.id)}"><rect x="${xa.toFixed(1)}" y="${y0}" width="${w.toFixed(1)}" height="${hB}" rx="4" fill="${fill}"/>`
         + (passt ? `<text class="gpxi-lb-bl1" x="${(xa + 6).toFixed(1)}" y="${y0 + 18}">${esc(label)}</text>`
                  : (w > 22 ? `<g class="gpxi-lb-blsym" transform="translate(${(xa + w / 2 - 6).toFixed(1)},${y0 + 8})">${L.symbolHtml(e.anzeige_art || e.art, 12)}</g>` : ""))
         + (zeile2 && passt ? `<text class="gpxi-lb-bl2" x="${(xa + 6).toFixed(1)}" y="${y0 + 36}">${esc(zeile2)}</text>` : "")
         + `<title>${esc(name + " · " + L.uhr(e.t0, e.versatz_min) + " – " + L.uhr(e.t1, e.versatz_min) + " · " + L.dauer(e.dauer_s) + (e.strecke_m > 50 ? " · " + L.km(e.strecke_m) : ""))}</title></g>`;
    }
    // Höhenprofil über den Blöcken (sonst deckt die Farbe es zu); nimmt keine Klicks an
    s += profilPfad(o.profil, X, f0, f1, Z.bewegung[0], Z.bewegung[1]);
    // Punkte
    const yP = (Z.punkte[0] + Z.punkte[1]) / 2;
    let letzteX = -Infinity;
    for (const p of (o.punkte || []).slice().sort((a, b) => a.t - b.t)) {
      const x = X(p.t); if (x < -4 || x > W + 4) continue;
      let form;
      if (p.art === "hoechster_punkt") form = `<path d="M${x.toFixed(1)} ${(yP - 6).toFixed(1)} l6 11 h-12 z" class="gpxi-lb-pt-hoch"/>`;
      else if (p.art === "start") form = `<circle cx="${x.toFixed(1)}" cy="${yP.toFixed(1)}" r="4.5" class="gpxi-lb-pt-start"/>`;
      else form = `<rect x="${(x - 4).toFixed(1)}" y="${(yP - 4).toFixed(1)}" width="8" height="8" rx="1.5" class="gpxi-lb-pt-ziel"/>`;
      const txt = p.art === "hoechster_punkt" && p.ele != null ? Math.round(p.ele).toLocaleString(sprache()) + " m" : "";
      const label = (txt && x - letzteX > 54) ? `<text x="${(x + 8).toFixed(1)}" y="${(yP + 4).toFixed(1)}" class="gpxi-lb-pt-txt">${txt}</text>` : "";
      if (txt) letzteX = x;
      s += `<g class="gpxi-lb-punkt${gew(p.id) ? " ist-gewaehlt" : ""}" data-lb="${esc(p.id)}">${form}${label}<title>${esc(L.artName(p.art) + (txt ? " · " + txt : "") + " · " + L.uhr(p.t, p.versatz_min))}</title></g>`;
    }
    if (o.extra) { try { s += o.extra(X, W); } catch (_) {} }
    s += achse(X, f0, f1, W, versatz, Z.achse[0]);
    return s;
  }

  /** Der Strahl als fertiges Bedienelement (Tour-Seite). `opt`: daten() → Logbuch der Brücke, eintraege() / punkte()
   *  → was gezeigt wird, profil() → [[Zeit, Höhe]] oder null, gewaehlt() → id, tagAktiv() → Tag, onWahl(id). */
  function einbauen(box, opt) {
    box.classList.add("lb-strahl");
    box.innerHTML = `<svg class="gpxi-lb-svg lb-strahl-svg" aria-hidden="true"></svg>`;
    const svg = box.querySelector("svg");
    let fenster = null;   // [t0, t1] — null = ganze Tour
    const ganzeSpanne = () => spanne(opt.eintraege(), opt.punkte());
    function render() {
      const d = opt.daten(); if (!d) { svg.innerHTML = ""; return; }
      const W = Math.max(80, Math.floor(box.clientWidth)), sp = fenster || ganzeSpanne();
      if (!sp || W < 100) { svg.innerHTML = ""; return; }
      svg.setAttribute("viewBox", `0 0 ${W} ${HOEHE}`); svg.setAttribute("width", W); svg.setAttribute("height", HOEHE);
      const id = opt.gewaehlt ? opt.gewaehlt() : null;
      svg.innerHTML = svgHtml({ W, H: HOEHE, spanne: sp, tage: d.mehrtaegig ? (d.tage || []) : [], eintraege: opt.eintraege(), punkte: opt.punkte(),
                                profil: opt.profil ? opt.profil() : null, gewaehlt: (x) => x === id, tagAktiv: opt.tagAktiv ? opt.tagAktiv() : null, kennung: "ts-lb" });
      svg.querySelectorAll("[data-lb]").forEach((g) => g.addEventListener("click", (ev) => { ev.stopPropagation(); if (opt.onWahl) opt.onWahl(g.dataset.lb); }));
      svg.querySelectorAll("[data-lb-tag]").forEach((g) => g.addEventListener("dblclick", (ev) => { ev.stopPropagation(); zuTag(parseInt(g.dataset.lbTag, 10), true); }));
    }
    function zuTag(nr, umschalten) {
      const d = opt.daten(), tg = d && (d.tage || []).find((x) => x.nr === nr); if (!tg) return;
      const rand = Math.max(120, (tg.t1 - tg.t0) * 0.02), neu = [tg.t0 - rand, tg.t1 + rand];
      fenster = (umschalten && fenster && Math.abs(fenster[0] - neu[0]) < 1 && Math.abs(fenster[1] - neu[1]) < 1) ? null : neu;
      render();
    }
    function ganz() { fenster = null; render(); }
    // Mausrad zoomt um die Stelle unter dem Zeiger (wie im Inspektor); bis ganz heraus = ganze Tour
    box.addEventListener("wheel", (ev) => {
      const sp = fenster || ganzeSpanne(), g = ganzeSpanne(); if (!sp || !g) return;
      ev.preventDefault();
      const r = box.getBoundingClientRect(), frac = Math.min(1, Math.max(0, (ev.clientX - r.left) / Math.max(1, r.width)));
      const mitte = sp[0] + frac * (sp[1] - sp[0]);
      let neu = (sp[1] - sp[0]) * (ev.deltaY > 0 ? 1.25 : 0.8);
      if (neu >= g[1] - g[0]) { ganz(); return; }
      neu = Math.max(600, neu);
      let a = mitte - frac * neu, b = a + neu;
      if (a < g[0]) { a = g[0]; b = a + neu; }
      if (b > g[1]) { b = g[1]; a = b - neu; }
      fenster = [a, b]; render();
    }, { passive: false });
    box.addEventListener("dblclick", () => ganz());
    let ro = null;
    try { ro = new ResizeObserver(() => render()); ro.observe(box); } catch (_) {}
    render();
    return { render, zuTag, ganz, fenster: () => fenster };
  }

  window.rzLogbuchStrahl = { svgHtml, einbauen, spanne, profilPfad, achse, ZEILEN, HOEHE };
})();
