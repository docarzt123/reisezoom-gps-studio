/* ──────────────────────────────────────────────────────────────────────────
 * Reisezoom GPS Studio — gemeinsame Schild-Zeichen-Engine (v0.9.179)
 *
 * EINE Quelle für UI-Vorschau UND Render. Früher gab es zwei synchron zu
 * pflegende Kopien (`_animSignDrawImageData` im UI + `_SIGN_DRAW_JS` in
 * core/animator.py) — jetzt liest der Render dieselbe Datei (siehe
 * core/animator.py `_read_sign_draw_js()`), das UI lädt sie als <script>.
 *
 * Exportiert `window.__rzDrawSign(o)` → { data: ImageData, dpr }.
 *
 * o = {
 *   text, size(px), font, weight, italic, align,         // Schrift
 *   style: callout|banner|pin|signpost|plain,            // Form
 *   color,            // Akzentfarbe — nur Fläche bei Banner/Wegweiser/Schlicht (sonst ungenutzt)
 *   bg,               // Box-Füllfarbe (Callout/Plain/Pin-Label) — 'auto' = Stil-Default
 *   textColor,        // Schriftfarbe — 'auto' = Kontrast zur Fläche
 *   opacity,          // Box-Deckkraft 0..1
 *   radius, padding,  // Eckenradius / Innenabstand (px)
 *   borderColor, borderWidth,
 *   shadow(bool), shadowColor, shadowBlur(px),
 * }
 * Alle Maße sind „logische" px (×dpr intern). Newlines im Text = mehrzeilig.
 * ────────────────────────────────────────────────────────────────────────── */
(function () {
  function hexToRgb(hex) {
    let h = String(hex || "").replace("#", "");
    if (h.length === 3) h = h.split("").map(function (x) { return x + x; }).join("");
    return {
      r: parseInt(h.slice(0, 2), 16) || 0,
      g: parseInt(h.slice(2, 4), 16) || 0,
      b: parseInt(h.slice(4, 6), 16) || 0,
    };
  }
  function lum(hex) { var c = hexToRgb(hex); return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255; }
  function rgba(hex, a) { var c = hexToRgb(hex); return "rgba(" + c.r + "," + c.g + "," + c.b + "," + a + ")"; }
  function ink(surfaceHex) { return lum(surfaceHex) > 0.62 ? "#15171c" : "#ffffff"; }

  function fontStack(key) {
    // v0.9.523 — installierte System-Schrift („sys:Familienname", Nutzer-Idee
    // aus Spanien): direkt als Familie verwenden. Anführungszeichen raus,
    // sonst zerbricht der Canvas-Font-String und der GANZE Font wird ignoriert.
    if (key && String(key).indexOf("sys:") === 0) {
      var fam = String(key).slice(4).replace(/["']/g, "");
      return "'" + fam + "', system-ui, sans-serif";
    }
    switch (key) {
      // bewusst KEIN Comic Sans/Chalkboard (globale Projektregel) — rundlich-freundlich:
      case "rounded":   return "ui-rounded, 'SF Pro Rounded', 'Hiragino Maru Gothic ProN', 'Varela Round', system-ui, sans-serif";
      case "serif":     return "Georgia, 'Iowan Old Style', 'Times New Roman', serif";
      case "mono":      return "ui-monospace, Menlo, 'SF Mono', Consolas, monospace";
      case "condensed": return "'Arial Narrow', 'Roboto Condensed', 'Helvetica Neue', system-ui, sans-serif";
      case "impact":    return "Impact, Haettenschweiler, 'Arial Black', system-ui, sans-serif";
      default:          return "-apple-system, system-ui, 'Segoe UI', Roboto, sans-serif";
    }
  }

  // ── Schild (mit ODER ohne Bild) ───────────────────────────────────────
  // Es gibt keine separaten „Fotos": ein Schild hat OPTIONAL ein Bild (o.image,
  // geladenes HTMLImageElement/ImageBitmap/Canvas). Ist eins gesetzt, wird es als
  // Inhalt OBEN IN die Schild-Box gezeichnet (Form/Akzent/Dekoration bleiben!),
  // darunter steht der Text (= Bildunterschrift). Die Fläche um/unter dem Bild ist
  // die Box-Füllung (Akzent-/Hintergrundfarbe), NICHT mehr fix weiß.
  // 14.09.2026 (Nachttest, Beta-Tester-Projekt mit 2830 Foto-Schildern): Jedes
  // Foto-Schild wurde mit Pixelmaß 2 gerastert (~650×480 px ≈ 1,25 MB). MapLibre hält
  // die Pixel mehrfach (Bildspeicher, Kopie je Kachel-Auftrag) — der WebView-Prozess
  // wuchs im Probelauf auf 32 GB und wurde vom System beendet. Ab vielen Bild-Schildern
  // wird deshalb mit kleinerem Pixelmaß gerastert: gleiche Größe auf dem Bild, weniger
  // Pixel, Gesamtbudget ≈ 200 Schilder in voller Schärfe. Vorschau und Render nutzen
  // dieselbe Rechnung (WYSIWYG).
  var RZ_SIGN_BILD_VOLL = 200;
  function rzSignDpr(anzahlBildSchilder) {
    var n = Number(anzahlBildSchilder) || 0;
    if (n <= RZ_SIGN_BILD_VOLL) return 2;
    return Math.max(0.5, Math.round(2 * Math.sqrt(RZ_SIGN_BILD_VOLL / n) * 100) / 100);
  }
  // ── Highlight-Schilder (30.09.2026, Marc: „mach das als Schilder … lass uns den
  // Komoot-Look auch behalten, dann haben wir gleich verschiedene Styles") ────────
  // Fünf Stile für Kennzahl-Schilder: Text = „Beschriftung\nWert", `icon` = Art
  // (hoechster|steilste|schnellste|halbe|wegpunkte). Entwürfe: pille (bisheriger
  // Look), hl_pin (Kasten über gelber Stecknadel), hl_rund (runder Pin, Karte rechts),
  // hl_form (Form je Art, gerahmte Karte), hl_pinsel (Pinselstrich-Banner).
  // Geometrie in einem Ortssystem mit dem Geo-Punkt bei (0,0); das Bild wird um die
  // senkrechte Achse symmetrisch angelegt, damit icon-anchor „bottom" (= Mitte unten)
  // genau auf der Stelle sitzt — auch wenn die Karte rechts vom Pin steht.
  var RZ_HL_STILE = { pille: 1, hl_pin: 1, hl_rund: 1, hl_form: 1, hl_pinsel: 1 };
  var RZ_HL_FARBEN = { hoechster: "#ffc21a", steilste: "#f2553d", schnellste: "#2fa8f0", halbe: "#4cc66a", wegpunkte: "#9b6bf2",
                       pause: "#e0a96d", uebernachtung: "#8fa8ff", notiz: "#f2d36b" };   // 02.10.2026 Logbuch im Schnell-Video
  var RZ_HL_ICONS = {
    hoechster: [["M1.5 21.5L9.2 9.6l3.9 5.6 2.6-3.6 6.8 9.9z", "f"], ["M9.2 10V2.6", "s", 1.8], ["M9.2 2.8h5.6l-1.7 2 1.7 2H9.2z", "f"]],
    steilste: [["M2 21.8L22 10.4v11.4z", "f"], ["M3.8 13.6L12.6 4.8", "s", 2.3], ["M8.4 4.4h4.6V9", "s", 2.3]],
    schnellste: [["M3.9 17.8a8.8 8.8 0 1 1 16.2 0", "s", 2.5], ["M12 15.3l4.8-5.8", "s", 2.5], ["M13.8 15.3a1.8 1.8 0 1 1-3.6 0a1.8 1.8 0 1 1 3.6 0z", "f"]],
    halbe: [["M20.6 12a8.6 8.6 0 1 1-17.2 0a8.6 8.6 0 1 1 17.2 0z", "s", 2.3], ["M12 3.4a8.6 8.6 0 0 0 0 17.2z", "f"]],
    wegpunkte: [["M12 22.6s-7.2-7.7-7.2-13.2a7.2 7.2 0 0 1 14.4 0c0 5.5-7.2 13.2-7.2 13.2zM14.7 9.4a2.7 2.7 0 1 0-5.4 0a2.7 2.7 0 1 0 5.4 0z", "fe"]],
    // 02.10.2026 — Logbuch: Tasse (Pause), Mond (Übernachtung), Stift (Notiz)
    pause: [["M3.5 9h13v5.5a5.5 5.5 0 0 1-5.5 5.5H9a5.5 5.5 0 0 1-5.5-5.5z", "f"], ["M16.5 11h1.8a2.7 2.7 0 0 1 0 5.4h-1.8", "s", 2], ["M8 2.8c-1.1 1.5 1.1 2.6 0 4.2M12 2.8c-1.1 1.5 1.1 2.6 0 4.2", "s", 1.6]],
    uebernachtung: [["M15.5 3.2a9 9 0 1 0 5.3 13.6A7.4 7.4 0 0 1 15.5 3.2z", "f"]],
    notiz: [["M4 20.2l1.2-4.6L16.4 4.4l3.4 3.4L8.6 19z", "f"], ["M3.5 21.5h17", "s", 1.8]],
  };
  var RZ_HL_FORM = { hoechster: "tri", steilste: "quad", schnellste: "kreis", halbe: "kreis", wegpunkte: "raute" };
  var RZ_HL_EINHEIT = /^(.*\d)(\s?)([A-Za-zµ°%\/²³]{1,5})$/;
  function rzHlIcon(ctx, art, cx, cy, gr, farbe) {
    var spec = RZ_HL_ICONS[art];
    if (!spec || typeof Path2D === "undefined") return;
    ctx.save();
    ctx.translate(cx - gr / 2, cy - gr / 2);
    ctx.scale(gr / 24, gr / 24);
    ctx.fillStyle = farbe; ctx.strokeStyle = farbe; ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (var i = 0; i < spec.length; i++) {
      var p = new Path2D(spec[i][0]);
      if (spec[i][1] === "s") { ctx.lineWidth = spec[i][2] || 2; ctx.stroke(p); }
      else ctx.fill(p, spec[i][1] === "fe" ? "evenodd" : "nonzero");
    }
    ctx.restore();
  }
  // Pseudo-Zufall aus dem Text (Pinselkanten sollen bei jedem Zeichnen gleich aussehen)
  function rzHlZufall(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return function () { h = Math.imul(h ^ (h >>> 15), 2246822507); h ^= h >>> 13; return ((h >>> 0) % 10000) / 10000; };
  }
  function rzDrawHighlight(o, dpr) {
    var st = o.style, u = Math.max(8, Number(o.size) || 26) * dpr, d = dpr;
    var akz = o.color || "#ffc21a";
    var art = RZ_HL_ICONS[o.icon] ? o.icon : "";
    var zl = String(o.text == null ? "" : o.text).split("\n");
    var label = zl.length > 1 ? zl[0].toUpperCase() : "";
    var wert = zl.length > 1 ? zl.slice(1).join(" ") : (zl[0] || "");
    var em = RZ_HL_EINHEIT.exec(wert), zahl = em ? em[1] : wert, einh = em ? em[3] : "";
    var ff = fontStack(o.font);
    var fL = "700 " + (0.4 * u) + "px " + ff, fZ = "800 " + u + "px " + ff, fE = "600 " + (0.52 * u) + "px " + ff;
    var mc = document.createElement("canvas").getContext("2d");
    mc.font = fL; var wL = label ? mc.measureText(label).width : 0;
    mc.font = fZ; var wZ = mc.measureText(zahl).width;
    mc.font = fE; var wE = einh ? mc.measureText(einh).width + 0.16 * u : 0;
    var tw = Math.max(wL, wZ + wE), hL = label ? 0.52 * u : 0, th = hL + 0.98 * u;
    // Text zeichnen: (x, yOben) = linke/mittige Oberkante des Textblocks
    function text(ctx, x, y, mitte, fLab, fWert) {
      ctx.textBaseline = "alphabetic";
      if (label) { ctx.font = fL; ctx.fillStyle = fLab; ctx.textAlign = mitte ? "center" : "left"; ctx.fillText(label, x, y + 0.4 * u); }
      var yb = y + hL + 0.8 * u, x0 = mitte ? x - (wZ + wE) / 2 : x;
      ctx.textAlign = "left"; ctx.font = fZ; ctx.fillStyle = fWert; ctx.fillText(zahl, x0, yb);
      if (einh) { ctx.font = fE; ctx.fillText(einh, x0 + wZ + 0.16 * u, yb); }
    }
    function rr(ctx, x, y, w, h, r) {
      r = Math.min(r, w / 2, h / 2);
      ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    }
    function schatten(ctx, an) {
      ctx.shadowColor = an ? "rgba(0,0,0,0.45)" : "rgba(0,0,0,0)"; ctx.shadowBlur = an ? 10 * d : 0;
      ctx.shadowOffsetX = 0; ctx.shadowOffsetY = an ? 3 * d : 0;
    }
    function tropfen(ctx, cy, R, tipY) {
      ctx.beginPath(); ctx.moveTo(0, tipY);
      ctx.quadraticCurveTo(-R * 1.2, cy + R * 0.55, -R, cy); ctx.arc(0, cy, R, Math.PI, 0, false);
      ctx.quadraticCurveTo(R * 1.2, cy + R * 0.55, 0, tipY); ctx.closePath();
    }
    function ring(ctx) {   // Leuchtring am Boden
      ctx.save(); ctx.shadowColor = akz; ctx.shadowBlur = 8 * d;
      ctx.beginPath(); ctx.ellipse(0, -0.2 * u, 0.5 * u, 0.18 * u, 0, 0, Math.PI * 2);
      ctx.lineWidth = 0.1 * u; ctx.strokeStyle = akz; ctx.stroke();
      ctx.restore();
      ctx.beginPath(); ctx.ellipse(0, -0.2 * u, 0.16 * u, 0.06 * u, 0, 0, Math.PI * 2); ctx.fillStyle = "#ffffff"; ctx.fill();
    }
    function stiel(ctx, y0, y1) {
      ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(0, y1); ctx.lineWidth = 0.08 * u; ctx.strokeStyle = akz; ctx.lineCap = "round"; ctx.stroke();
    }
    var DUNKEL = "#17191e";
    // Ausdehnung je Stil (links, rechts, oben) im Ortssystem
    var R = (st === "hl_pin" ? 1.3 : 1.15) * u, L = 0, Rr = 0, oben = 0, plan = {};
    if (st === "pille") {
      var pd = 1.5 * u, ins = 0.2 * u, gap = 0.34 * u, padR = 0.6 * u;
      var pw = ins + pd + gap + tw + padR, ph = pd + 2 * ins, py = -(0.55 * u) - ph;
      plan = { pw: pw, ph: ph, py: py, pd: pd, ins: ins, gap: gap };
      L = Rr = pw / 2; oben = -py;
    } else if (st === "hl_pin") {
      var tipY = -0.2 * u, cy = tipY - 1.8 * R, cw = tw + 1.0 * u, ch = th + 0.62 * u, cyTop = cy - R - 0.3 * u - ch;
      plan = { tipY: tipY, cy: cy, cw: cw, ch: ch, cyTop: cyTop };
      L = Rr = Math.max(cw / 2, R * 1.25); oben = -cyTop;
    } else {
      var stielH = 1.7 * u, cyc = -0.2 * u - stielH - R;
      var kx = R * 0.55, cx0 = R + 0.42 * u, ch2 = Math.max(th + 0.6 * u, R * 1.55);
      var cw2 = (cx0 - kx) + tw + 0.6 * u;
      if (st === "hl_pinsel") { ch2 = hL + 0.5 * u + 1.35 * u; cw2 = (cx0 - kx) + Math.max(wL + 0.7 * u, wZ + wE + 0.9 * u); }
      plan = { cyc: cyc, kx: kx, cx0: cx0, ch: ch2, cw: cw2, ky: cyc - ch2 / 2 };
      L = R * 1.2; Rr = kx + cw2 + 0.3 * u; oben = -(Math.min(cyc - R * 1.25, plan.ky - 0.25 * u));
    }
    var rand = 14 * d, halb = Math.max(L, Rr) + rand;
    var W = Math.ceil(halb * 2), H = Math.ceil(oben + rand);
    var c = document.createElement("canvas"); c.width = Math.max(2, W); c.height = Math.max(2, H);
    var ctx = c.getContext("2d");
    ctx.translate(W / 2, H);
    ctx.globalAlpha = (o.opacity != null ? Math.max(0, Math.min(1, Number(o.opacity))) : 1);
    if (st === "pille") {
      // Punkt auf der Stelle, darüber die dunkle Pille mit rundem Pin links
      ctx.beginPath(); ctx.arc(0, -0.3 * u, 0.26 * u, 0, Math.PI * 2); ctx.fillStyle = akz; ctx.fill();
      ctx.lineWidth = 0.1 * u; ctx.strokeStyle = DUNKEL; ctx.stroke();
      schatten(ctx, true); rr(ctx, -plan.pw / 2, plan.py, plan.pw, plan.ph, plan.ph / 2); ctx.fillStyle = "rgba(20,20,22,0.92)"; ctx.fill(); schatten(ctx, false);
      var px = -plan.pw / 2 + plan.ins + plan.pd / 2, pyc = plan.py + plan.ph / 2;
      ctx.beginPath(); ctx.arc(px, pyc, plan.pd / 2, 0, Math.PI * 2); ctx.fillStyle = akz; ctx.fill();
      rzHlIcon(ctx, art, px, pyc, plan.pd * 0.58, DUNKEL);
      text(ctx, px + plan.pd / 2 + plan.gap, pyc - th / 2, false, akz, "#ffffff");
    } else if (st === "hl_pin") {
      ring(ctx);
      schatten(ctx, true); tropfen(ctx, plan.cy, R, plan.tipY); ctx.fillStyle = akz; ctx.fill(); schatten(ctx, false);
      ctx.beginPath(); ctx.arc(0, plan.cy, R * 0.74, 0, Math.PI * 2); ctx.fillStyle = DUNKEL; ctx.fill();
      rzHlIcon(ctx, art, 0, plan.cy, R * 0.9, "#ffffff");
      schatten(ctx, true); rr(ctx, -plan.cw / 2, plan.cyTop, plan.cw, plan.ch, 0.28 * u); ctx.fillStyle = "rgba(22,24,28,0.94)"; ctx.fill(); schatten(ctx, false);
      ctx.lineWidth = 0.09 * u; ctx.strokeStyle = akz; ctx.stroke();
      text(ctx, 0, plan.cyTop + (plan.ch - th) / 2, true, "#ffffff", "#ffffff");
    } else {
      var p = plan, ky = p.ky;
      ring(ctx); stiel(ctx, -0.3 * u, p.cyc + R * 0.9);
      if (st === "hl_rund" || st === "hl_form") {
        // Karte rechts (hinter dem Pin), mit Farbe als Ecke (rund) bzw. Rahmen (form)
        schatten(ctx, true);
        ctx.beginPath();
        if (st === "hl_form") {
          var sch = 0.45 * u;
          ctx.moveTo(p.kx, ky); ctx.lineTo(p.kx + p.cw - sch, ky); ctx.lineTo(p.kx + p.cw, ky + sch);
          ctx.lineTo(p.kx + p.cw, ky + p.ch); ctx.lineTo(p.kx, ky + p.ch); ctx.closePath();
        } else rr(ctx, p.kx, ky, p.cw, p.ch, 0.22 * u);
        ctx.fillStyle = "rgba(18,20,24,0.9)"; ctx.fill(); schatten(ctx, false);
        if (st === "hl_form") { ctx.lineWidth = 0.07 * u; ctx.strokeStyle = akz; ctx.stroke(); }
        else { ctx.lineWidth = 1 * d; ctx.strokeStyle = "rgba(255,255,255,0.14)"; ctx.stroke();
               ctx.fillStyle = akz; ctx.fillRect(p.cx0 - 0.3 * u, ky - 0.16 * u, 0.22 * u, 0.58 * u); }
        text(ctx, p.cx0, ky + (p.ch - th) / 2, false, "#e3e6ea", "#ffffff");
        schatten(ctx, true);
        var form = st === "hl_form" ? (RZ_HL_FORM[art] || "kreis") : "kreis";
        ctx.beginPath();
        if (form === "tri") { ctx.moveTo(0, p.cyc - R * 1.2); ctx.lineTo(R * 1.15, p.cyc + R * 0.75); ctx.lineTo(0.18 * R, p.cyc + R * 0.75); ctx.lineTo(0, p.cyc + R * 1.15); ctx.lineTo(-0.18 * R, p.cyc + R * 0.75); ctx.lineTo(-R * 1.15, p.cyc + R * 0.75); ctx.closePath(); }
        else if (form === "quad") { rr(ctx, -R, p.cyc - R, 2 * R, 2 * R, 0.18 * R); ctx.moveTo(-0.28 * R, p.cyc + R - 1); ctx.lineTo(0, p.cyc + R * 1.35); ctx.lineTo(0.28 * R, p.cyc + R - 1); }
        else if (form === "raute") { ctx.moveTo(0, p.cyc - R * 1.2); ctx.lineTo(R * 1.1, p.cyc); ctx.lineTo(0, p.cyc + R * 1.2); ctx.lineTo(-R * 1.1, p.cyc); ctx.closePath(); }
        else if (st === "hl_form") { tropfen(ctx, p.cyc, R, p.cyc + R * 1.55); }
        else { ctx.arc(0, p.cyc, R, 0, Math.PI * 2); }
        ctx.fillStyle = akz; ctx.fill(); schatten(ctx, false);
        rzHlIcon(ctx, art, 0, p.cyc + (form === "tri" ? R * 0.18 : 0), R * (form === "tri" ? 0.95 : 1.05), DUNKEL);
      } else {   // hl_pinsel
        var zf = rzHlZufall(String(o.text || "") + art);
        var strich = function (x, y, w, h, farbe) {
          var n = Math.max(6, Math.round(w / (0.35 * u))), j = 0.07 * u, i;
          ctx.beginPath(); ctx.moveTo(x, y + zf() * j);
          for (i = 1; i <= n; i++) ctx.lineTo(x + w * i / n, y + (zf() - 0.3) * j * 1.6);
          for (i = 0; i < 5; i++) ctx.lineTo(x + w + (zf() * 0.5 + (i % 2 ? 0.1 : 0.45)) * u * 0.6, y + h * (i + 0.5) / 5);
          for (i = n; i >= 0; i--) ctx.lineTo(x + w * i / n, y + h - (zf() - 0.3) * j * 1.6);
          ctx.closePath(); ctx.fillStyle = farbe; ctx.fill();
        };
        schatten(ctx, true);
        var wy = ky + hL + 0.5 * u;
        strich(p.kx, wy - 0.12 * u, p.cw - 0.6 * u, 1.35 * u, akz);
        if (label) strich(p.kx + 0.3 * u, ky, wL + p.cx0 - p.kx + 0.2 * u, hL + 0.2 * u, "#f3f3f1");
        schatten(ctx, false);
        ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
        if (label) { ctx.font = fL; ctx.fillStyle = "#16181d"; ctx.fillText(label, p.cx0, ky + 0.47 * u); }
        ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 3 * d; ctx.shadowOffsetY = 1 * d;   // Weiß auf Gelb lesbar halten
        ctx.font = fZ; ctx.fillStyle = "#ffffff"; ctx.fillText(zahl, p.cx0, wy + 1.0 * u);
        if (einh) { ctx.font = fE; ctx.fillText(einh, p.cx0 + wZ + 0.16 * u, wy + 1.0 * u); }
        schatten(ctx, false);
        schatten(ctx, true);
        tropfen(ctx, p.cyc, R, p.cyc + R * 1.6); ctx.fillStyle = akz; ctx.fill(); schatten(ctx, false);
        ctx.beginPath(); ctx.arc(0, p.cyc, R * 0.76, 0, Math.PI * 2); ctx.fillStyle = DUNKEL; ctx.fill();
        rzHlIcon(ctx, art, 0, p.cyc, R * 0.95, "#ffffff");
      }
    }
    return { data: ctx.getImageData(0, 0, c.width, c.height), dpr: dpr, anchor: "bottom" };
  }

  // ── Sofortbild (05.10.2026) — Canvas-Zwilling von sign_dom.js „sofortbild": warmweißer Rahmen (unten breiter),
  // quadratischer Bildausschnitt, leicht schräg (gleiche Neigung wie im DOM: aus der Kennung, `o.dreh` überschreibt),
  // weicher Schatten, Unterschrift in Caveat. Diese Engine zeichnet Probelauf und Video — bei Änderung beide pflegen.
  function rzSofortbildDreh(o) {
    var dreh = Number(o.dreh);
    if (isFinite(dreh)) return dreh;
    var key = String(o.id || o.text || o.imageSrc || ""), h = 0;
    for (var ki = 0; ki < key.length; ki++) h = (h * 31 + key.charCodeAt(ki)) | 0;
    dreh = ((Math.abs(h) % 9) - 4) * 0.9;
    if (Math.abs(dreh) < 1) dreh = (h & 1) ? 1.8 : -1.8;
    return dreh;
  }
  function rzDrawSofortbild(o, dpr) {
    var pad = (o.padding != null ? Number(o.padding) : 7);
    var rand = Math.max(6, pad + 3) * dpr;
    var text = String(o.text == null ? "" : o.text).trim();
    var fs = Math.max(10, (Number(o.size) || 40) * 1.05) * dpr;
    var FONT = "600 " + fs + "px 'Caveat', 'Bradley Hand', 'Segoe Print', cursive";
    var image = o.image || null;
    var imgW = Math.max(80, (Number(o.imageSize) || 60) * 5) * dpr;
    var meas = document.createElement("canvas").getContext("2d"); meas.font = FONT;
    var lines = text ? text.split("\n") : [];
    var capW = 0; for (var i = 0; i < lines.length; i++) capW = Math.max(capW, meas.measureText(lines[i]).width);
    var lineH = Math.ceil(fs * 1.05);
    var capH = lines.length ? lines.length * lineH + Math.round(rand * 0.35) : 0;
    var innerW = Math.max(imgW, Math.ceil(capW));
    var cw = innerW + rand * 2;
    var ch = (image ? imgW : 0) + capH + rand + Math.round(rand * (text ? 1.4 : 3.2));
    var rad = rzSofortbildDreh(o) * Math.PI / 180;
    var sch = 18 * dpr;                                      // Platz für den Schatten
    var bw = Math.abs(cw * Math.cos(rad)) + Math.abs(ch * Math.sin(rad));
    var bh = Math.abs(cw * Math.sin(rad)) + Math.abs(ch * Math.cos(rad));
    var c = document.createElement("canvas");
    c.width = Math.ceil(bw + sch * 2); c.height = Math.ceil(bh + sch * 2);
    var ctx = c.getContext("2d");
    ctx.globalAlpha = (o.opacity != null ? Math.max(0, Math.min(1, Number(o.opacity))) : 1);
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(rad);
    ctx.translate(-cw / 2, -ch / 2);
    // Karte mit zwei Schatten (weit + eng), wie box-shadow im DOM
    ctx.shadowColor = "rgba(0,0,0,0.38)"; ctx.shadowBlur = 16 * dpr; ctx.shadowOffsetY = 5 * dpr;
    ctx.fillStyle = "#fbfaf5";
    ctx.fillRect(0, 0, cw, ch);
    ctx.shadowColor = "rgba(0,0,0,0.25)"; ctx.shadowBlur = 2 * dpr; ctx.shadowOffsetY = 1 * dpr;
    ctx.fillRect(0, 0, cw, ch);
    ctx.shadowColor = "rgba(0,0,0,0)"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    var ix = (cw - imgW) / 2, iy = rand;
    if (image) {
      var nw = image.naturalWidth || image.width || 1, nh = image.naturalHeight || image.height || 1;
      var seite = Math.min(nw, nh);                         // quadratischer Ausschnitt (object-fit: cover)
      try { ctx.drawImage(image, (nw - seite) / 2, (nh - seite) / 2, seite, seite, ix, iy, imgW, imgW); } catch (_) {}
    }
    if (lines.length) {
      ctx.font = FONT; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = (o.textColor && o.textColor !== "auto") ? o.textColor : "#25302c";
      var y0 = iy + (image ? imgW : 0) + Math.round(rand * 0.35) + lineH / 2;
      for (var j = 0; j < lines.length; j++) ctx.fillText(lines[j], cw / 2, y0 + j * lineH);
    }
    return { data: ctx.getImageData(0, 0, c.width, c.height), dpr: dpr, anchor: "bottom" };
  }

  // Mini-Bild für den Ausgang „mini": rundes Foto mit weißem Ring, RZ_MINI_PX Durchmesser (CSS-px), Anker unten.
  var RZ_MINI_PX = 64;
  function rzDrawSofortbildMini(o, dpr) {
    dpr = (Number(dpr) > 0) ? Number(dpr) : 2;
    var D = RZ_MINI_PX * dpr, ring = 4 * dpr, sch = 8 * dpr;
    var c = document.createElement("canvas");
    c.width = Math.ceil(D + sch * 2); c.height = Math.ceil(D + sch * 2);
    var ctx = c.getContext("2d");
    var cx = c.width / 2, cy = c.height / 2 - 2 * dpr, r = D / 2;
    ctx.shadowColor = "rgba(0,0,0,0.4)"; ctx.shadowBlur = 7 * dpr; ctx.shadowOffsetY = 2 * dpr;
    ctx.fillStyle = "#fbfaf5"; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.shadowColor = "rgba(0,0,0,0)"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    var image = o.image || null;
    if (image) {
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r - ring, 0, Math.PI * 2); ctx.clip();
      var nw = image.naturalWidth || image.width || 1, nh = image.naturalHeight || image.height || 1, seite = Math.min(nw, nh);
      try { ctx.drawImage(image, (nw - seite) / 2, (nh - seite) / 2, seite, seite, cx - r + ring, cy - r + ring, D - 2 * ring, D - 2 * ring); } catch (_) {}
      ctx.restore();
    }
    return { data: ctx.getImageData(0, 0, c.width, c.height), dpr: dpr, anchor: "bottom" };
  }

  function rzDrawSign(o) {
    o = o || {};
    var dpr = (Number(o.__dpr) > 0) ? Number(o.__dpr) : 2;
    if (RZ_HL_STILE[o.style]) return rzDrawHighlight(o, dpr);
    if (o.style === "sofortbild") return rzDrawSofortbild(o, dpr);
    var fontPx = Math.max(8, Number(o.size) || 40);
    var fs = fontPx * dpr;
    var weight = Number(o.weight) || 700;
    var italic = o.italic ? "italic " : "";
    var FONT = italic + weight + " " + fs + "px " + fontStack(o.font);
    // v0.9.523 — Canvas ERFINDET keinen Fettschnitt: Hat die Familie kein
    // echtes Fett (Impact, Rundlich — auf Windows fast alle Stacks), sah
    // „Fett"/„Extra-Fett" exakt aus wie Normal (Nutzer-Report mit Video,
    // vermessen: Rundlich 700 == 900, Impact 400 == 700 == 900). Erkennung:
    // Ändert das Gewicht die gemessene Textbreite nicht, gibt es keinen
    // Schnitt — dann ziehen wir die Glyphen mit einer Kontur in Textfarbe
    // nach. Wirkt identisch in Vorschau, Video und Web-Export, weil ALLE
    // durch diese eine Engine laufen.
    var kunstFett = 0;
    if (weight >= 600) {
      var m2 = document.createElement("canvas").getContext("2d");
      m2.font = "400 32px " + fontStack(o.font);
      var wNormal = m2.measureText("Mm0Ww").width;
      m2.font = weight + " 32px " + fontStack(o.font);
      var wFett = m2.measureText("Mm0Ww").width;
      if (wFett - wNormal < 0.4) {
        kunstFett = fs * (weight >= 800 ? 0.045 : 0.028);
      }
    }
    var text = String(o.text == null ? "" : o.text);
    var hasText = text.trim().length > 0;
    var lines = text.split("\n");
    var image = o.image || null;
    var hasImg = !!image;
    var style = o.style || "callout";
    // 05.10.2026 (PLAN §2 „Schilder wärmer: schlichte weiße Kärtchen mit Schatten") — „karte" = Sprechblase in
    // Warmweiß mit weichem Schatten; synchron zu sign_dom.js (beide Engines pflegen).
    var istKarte = (style === "karte");
    if (istKarte) {
      style = "callout";
      o = Object.assign({}, o, { shadow: true,
        shadowBlur: o.shadowBlur != null ? o.shadowBlur : 14, shadowStrength: o.shadowStrength != null ? o.shadowStrength : 0.3 });
    }
    var accent = o.color || "#ff6b35";
    var align = o.align || "center";
    var radius = (o.radius != null ? Number(o.radius) : 9) * dpr;
    var pad = (o.padding != null ? Number(o.padding) : 7) * dpr;
    var borderW = (o.borderWidth != null ? Number(o.borderWidth) : 0) * dpr;
    var borderC = (o.borderColor && o.borderColor !== "none") ? o.borderColor : null;
    // v0.9.254 (Nutzer-Bug #3) — der Innenabstand muss mindestens so groß wie der
    // Rahmen sein. Sonst wird der Inhalt (Bild/Text) mit nur `pad` Abstand gezeichnet,
    // der Rahmen aber bis `borderW` nach innen → das Bild liegt ÜBER dem inneren Teil
    // des Rahmens und der Rahmen wirkt „kleiner als das Bild". `pad` fließt in die
    // ganze Box-Geometrie ein, daher wächst die Box konsistent mit.
    if (borderW > 0) pad = Math.max(pad, borderW + 2 * dpr);
    var opacity = (o.opacity != null ? Math.max(0, Math.min(1, Number(o.opacity))) : 1);
    var shadow = !!o.shadow;
    var shadowC = o.shadowColor || "#000000";
    var shadowBlurRaw = (o.shadowBlur != null ? Number(o.shadowBlur) : 8);
    var shadowBlur = shadowBlurRaw * dpr;
    var shadowStrength = (o.shadowStrength != null ? Math.max(0.05, Math.min(1, Number(o.shadowStrength))) : 0.55);
    // v0.9.478 — Schatten-Versatz: RICHTUNG global (`o.shadowDir`, Grad, Bildschirm-
    // Koordinaten: 0°=rechts, 90°=unten). ABSTAND entkoppelt von der Weichheit — eigener
    // kräftiger Wert (Beta-Tester: „Weichheit 0 + Stärke 100% keine Wirkung", weil der Versatz
    // früher an die Weichheit gekoppelt war und bei Blur 0 quasi 0 wurde). Jetzt steht der
    // Schatten auch ohne Blur klar ab und die „Stärke" (Deckkraft) greift sichtbar.
    var shDistPx = (4 + shadowBlurRaw * 0.2) * dpr;
    var shRad = (isFinite(Number(o.shadowDir)) ? Number(o.shadowDir) : 45) * Math.PI / 180;
    var shOffX = Math.round(shDistPx * Math.cos(shRad));
    var shOffY = Math.round(shDistPx * Math.sin(shRad));

    // Stil-Defaults für Box-Füllung + auf welcher Fläche der Text sitzt.
    var boxFill, textSurface, decoration;
    if (style === "banner") { boxFill = accent; textSurface = accent; decoration = "poles"; }
    else if (style === "signpost") { boxFill = accent; textSurface = accent; decoration = "post"; }
    else if (style === "pin") { boxFill = "#15171c"; textSurface = "#15171c"; decoration = "pin"; }
    else if (style === "plain") { boxFill = accent; textSurface = accent; decoration = "none"; }
    else if (istKarte) { boxFill = "#fbf9f4"; textSurface = "#fbf9f4"; decoration = "tail"; }
    else { boxFill = "#15171c"; textSurface = "#15171c"; decoration = "tail"; } // callout
    // v0.9.269 (Nutzer) — bg === "none": Box komplett TRANSPARENT (kein Füll, kein
    // Box-Schatten). So liegt z.B. ein Bild ohne farbigen „Akzent-Rahmen" auf der Karte;
    // nur der optionale Rahmen bleibt → behebt den „doppelten Rahmen" bei Bild-Schildern.
    var boxTransparent = (o.bg === "none");
    if (o.bg && o.bg !== "auto" && o.bg !== "none") { boxFill = o.bg; textSurface = o.bg; }
    var textColor = (o.textColor && o.textColor !== "auto") ? o.textColor : ink(textSurface);

    // ── Text messen ─────────────────────────────────────────────────────
    var meas = document.createElement("canvas").getContext("2d");
    meas.font = FONT;
    var maxw = 2;
    for (var i = 0; i < lines.length; i++) maxw = Math.max(maxw, meas.measureText(lines[i] || " ").width);
    maxw = Math.ceil(maxw);
    var lineH = Math.ceil(fs * 1.2);
    var textH = hasText ? lines.length * lineH : 0;

    // ── Bild-Block (optional, oben in der Box) ──────────────────────────
    // Bildbreite skaliert mit der Schriftgröße (Größe-Slider steuert beides).
    var imgNW = 0, imgNH = 0, imgW = 0, imgH = 0, imgGap = 0;
    if (hasImg) {
      imgNW = (image.naturalWidth || image.width) || 4;
      imgNH = (image.naturalHeight || image.height) || 3;
      // v0.9.190 — Bildbreite über EIGENEN imageSize-Wert (entkoppelt von Schriftgröße).
      var imgSz = Number(o.imageSize) || 60;
      imgW = Math.max(80 * dpr, Math.round(imgSz * 5) * dpr);
      imgH = Math.round(imgW * (imgNH / imgNW));
      var maxImgH = 460 * dpr;
      if (imgH > maxImgH) { imgH = maxImgH; imgW = Math.round(imgH * (imgNW / imgNH)); }
      imgGap = hasText ? Math.round(pad * 0.7) : 0;
    }

    // ── Box-Geometrie ───────────────────────────────────────────────────
    var arrowW = (style === "signpost") ? 13 * dpr : 0;     // Pfeilspitze-Breite
    // v0.9.387 — Wegweiser-Richtung: Pfeil zeigt nach links oder rechts.
    var signDir = (style === "signpost" && o.direction === "left") ? "left" : "right";
    var contentDX = (signDir === "left") ? arrowW : 0;      // Inhalt nach rechts rücken, wenn Pfeil links
    // v0.9.479 — feste Mindestbreite (o.minWidth in CSS-px, 0 = auto). Erweitert die
    // Inhaltsfläche, sodass Links/Mitte/Rechts (unten, textAreaW) den Text sichtbar
    // verschieben — auch bei einzeiligem Text. WYSIWYG zu sign_dom.js.
    var minWpx = Math.max(0, Number(o.minWidth) || 0) * dpr;
    var innerW = Math.max(maxw, imgW, minWpx - pad * 2 - arrowW);
    var boxW = innerW + pad * 2 + arrowW;
    var boxH = (hasImg ? imgH + imgGap : 0) + textH + pad * 2;
    // v0.9.408 — Sprechblasen-Pfeilrichtung (nur callout/tail): unten|oben|links|rechts.
    // Eigenes Feld `calloutDir` (NICHT `direction`, das gehört dem Wegweiser/signpost).
    // v0.9.481 — Zeiger (Sprechblasen-Spitze / Stecknadel) hat jetzt eine EIGENE
    // Farbe und eine wählbare Position an der Kante. Vorher erbte er die Boxfarbe
    // und verschwand mit „Kein Hintergrund"; mittig saß er oft genau auf der Spur.
    // `accent: "auto"` = altes Verhalten.
    var tailPos = (o.tailPos === "left" || o.tailPos === "right") ? o.tailPos : "center";
    var calloutDir = "bottom";
    if (decoration === "tail") {
      var _cd = o.calloutDir;
      calloutDir = (_cd === "top" || _cd === "left" || _cd === "right") ? _cd : "bottom";
    }
    var tailUp = (decoration === "tail" && calloutDir === "top");
    var tailLeft = (decoration === "tail" && calloutDir === "left");
    var tailRight = (decoration === "tail" && calloutDir === "right");
    // Dekorations-Höhe unter der Box
    var decoH = 0, poleH = 0, postH = 0, tailH = 0, pinR = 0, pinGap = 0, pinTipH = 0;
    var decoScale = (o.decoScale != null && !isNaN(Number(o.decoScale))) ? Math.max(0.1, Math.min(2, Number(o.decoScale))) : 0.5;
    if (decoration === "poles") { poleH = Math.round(boxH * decoScale); decoH = poleH; }
    else if (decoration === "post") { postH = Math.round(boxH * decoScale); decoH = postH; }
    else if (decoration === "tail") { tailH = 8 * dpr; decoH = (calloutDir === "bottom") ? tailH : 0; }
    else if (decoration === "pin") { pinR = Math.max(10 * dpr, fs * 0.42); pinGap = 7 * dpr; pinTipH = 16 * dpr; decoH = pinGap + pinR * 2 + pinTipH; }
    // Zusatz-Rand für nicht-untenliegende Sprechblasen-Spitzen (oben/links/rechts).
    var tExtraTop = tailUp ? tailH : 0;
    var tExtraLeft = tailLeft ? tailH : 0;
    var tExtraRight = tailRight ? tailH : 0;

    // Schatten-Rand (damit der Blur nicht abgeschnitten wird) — unten knapp,
    // damit die Anker-Spitze möglichst am Bildrand bleibt.
    // v0.9.478 — Schatten kann jetzt in JEDE Richtung fallen (globaler Winkel). Seiten-/
    // Oberrand großzügig (Blur + max. Versatz), damit nichts abschneidet — das VERSCHIEBT
    // das Schild NICHT, weil der Marker per icon-anchor am UNTEREN Rand sitzt (nur `mb`
    // bestimmt die vertikale Lage). `mb` bleibt daher klein und fasst nur den nach UNTEN
    // gerichteten Versatz-Anteil (max(0, shOffY)) + halben Blur — wie bisher.
    var shReach = shadow ? Math.ceil(shadowBlur + Math.max(Math.abs(shOffX), Math.abs(shOffY)) + 3 * dpr) : 0;
    var ml = shReach, mt = shReach, mr = shReach;
    var mb = shadow ? Math.ceil(Math.max(0, shOffY) + shadowBlur * 0.5 + 3 * dpr) : 0;

    var contentW = Math.max(boxW, pinR * 2);
    var W = contentW + ml + mr + tExtraLeft + tExtraRight;
    var H = boxH + decoH + mt + mb + tExtraTop;

    var c = document.createElement("canvas");
    c.width = Math.max(2, Math.ceil(W));
    c.height = Math.max(2, Math.ceil(H));
    var ctx = c.getContext("2d");
    ctx.font = FONT;
    ctx.textBaseline = "middle";

    // Box-Ursprung (zentriert horizontal im Content-Bereich). tExtraLeft/Top
    // schieben die Box ein, damit links/oben Platz für die Sprechblasen-Spitze bleibt.
    var bx = ml + tExtraLeft + (contentW - boxW) / 2;
    var by = mt + tExtraTop;

    var rr = function (x, y, w, h, rad) {
      rad = Math.min(rad, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + rad, y);
      ctx.arcTo(x + w, y, x + w, y + h, rad);
      ctx.arcTo(x + w, y + h, x, y + h, rad);
      ctx.arcTo(x, y + h, x, y, rad);
      ctx.arcTo(x, y, x + w, y, rad);
      ctx.closePath();
    };

    var setShadow = function (on) {
      if (on && shadow) {
        ctx.shadowColor = rgba(shadowC, shadowStrength);
        ctx.shadowBlur = shadowBlur;
        ctx.shadowOffsetX = shOffX;   // v0.9.478 — globaler Richtungs-Versatz (X)
        ctx.shadowOffsetY = shOffY;
      } else {
        ctx.shadowColor = "rgba(0,0,0,0)";
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
      }
    };

    ctx.globalAlpha = opacity;

    // ── Dekoration ZUERST (hinter der Box), ohne Schatten ───────────────
    setShadow(false);
    if (decoration === "poles") {
      var pw = 4 * dpr;
      ctx.fillStyle = "#454b54";
      ctx.fillRect(bx + 4 * dpr, by + boxH - 2 * dpr, pw, poleH);
      ctx.fillRect(bx + boxW - 4 * dpr - pw, by + boxH - 2 * dpr, pw, poleH);
    } else if (decoration === "post") {
      var sw = 5 * dpr;
      ctx.fillStyle = "#5a4632";
      ctx.fillRect(ml + contentW / 2 - sw / 2, by + boxH - 2 * dpr, sw, postH);
    }

    // ── Box mit Schatten ────────────────────────────────────────────────
    // v0.9.269 — boxTransparent: Box-Füllung + Box-Schatten weglassen, Rahmen/Deko/Bild bleiben.
    setShadow(!boxTransparent);
    ctx.fillStyle = boxFill;
    if (decoration === "post") {
      // Pfeil-Form (Spitze links oder rechts — v0.9.387)
      var ax = bx, ay = by, aw = boxW, ah = boxH;
      ctx.beginPath();
      if (signDir === "left") {
        ctx.moveTo(ax + arrowW, ay);
        ctx.lineTo(ax + aw, ay);
        ctx.lineTo(ax + aw, ay + ah);
        ctx.lineTo(ax + arrowW, ay + ah);
        ctx.lineTo(ax, ay + ah / 2);
      } else {
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax + aw - arrowW, ay);
        ctx.lineTo(ax + aw, ay + ah / 2);
        ctx.lineTo(ax + aw - arrowW, ay + ah);
        ctx.lineTo(ax, ay + ah);
      }
      ctx.closePath();
      if (!boxTransparent) ctx.fill();
      setShadow(false);
      if (borderW > 0 && borderC) { ctx.lineWidth = borderW; ctx.strokeStyle = borderC; ctx.stroke(); }
    } else if (decoration === "pin") {
      // Label-Box oben
      rr(bx, by, boxW, boxH, radius); if (!boxTransparent) ctx.fill();
      setShadow(false);
      if (borderW > 0 && borderC) { ctx.lineWidth = borderW; ctx.strokeStyle = borderC; rr(bx + borderW / 2, by + borderW / 2, boxW - borderW, boxH - borderW, radius); ctx.stroke(); }
      // Tropfen unten — Position links/mittig/rechts, damit er die Spur nicht verdeckt
      var pinInset = pinR + 6 * dpr;
      var cx = tailPos === "left" ? (ml + pinInset)
             : tailPos === "right" ? (ml + contentW - pinInset)
             : (ml + contentW / 2);
      var cyc = by + boxH + pinGap + pinR;
      var tipY = H - mb;
      setShadow(true);
      ctx.beginPath();
      ctx.moveTo(cx, tipY);
      ctx.quadraticCurveTo(cx - pinR * 1.25, cyc + pinR * 0.35, cx - pinR, cyc);
      ctx.arc(cx, cyc, pinR, Math.PI, 0, false);
      ctx.quadraticCurveTo(cx + pinR * 1.25, cyc + pinR * 0.35, cx, tipY);
      ctx.closePath();
      // v0.9.481 — eigene Zeigerfarbe schlägt alles; ohne sie wie bisher: Tropfen
      // folgt dem Hintergrund, bei transparenter Box dezentes Dunkel als Fallback.
      ctx.fillStyle = (o.accent && o.accent !== "auto") ? o.accent
                    : (boxTransparent ? "#15171c" : boxFill);
      ctx.fill();
      setShadow(false);
      ctx.lineWidth = 2 * dpr; ctx.strokeStyle = "#fff"; ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cyc, pinR * 0.42, 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill();
    } else {
      rr(bx, by, boxW, boxH, radius); if (!boxTransparent) ctx.fill();
      setShadow(false);
      if (borderW > 0 && borderC) { ctx.lineWidth = borderW; ctx.strokeStyle = borderC; rr(bx + borderW / 2, by + borderW / 2, boxW - borderW, boxH - borderW, radius); ctx.stroke(); }
      var tailCol = (o.accent && o.accent !== "auto") ? o.accent : boxFill;
      if (decoration === "tail" && (!boxTransparent || (o.accent && o.accent !== "auto"))) {
        // v0.9.408 — Sprechblasen-Spitze in gewählter Richtung. Die Spitze sitzt
        // an der Box-Kante der jeweiligen Seite und ragt um tailH nach außen; ihr
        // äußerster Punkt fällt (per icon-anchor unten/oben/links/rechts) auf den Geo-Punkt.
        var half = 7 * dpr;
        var tIns = half + 9 * dpr;                       // Abstand zur Ecke
        var cxT = tailPos === "left" ? (bx + tIns)
                : tailPos === "right" ? (bx + boxW - tIns) : (bx + boxW / 2);
        var cyT = tailPos === "left" ? (by + tIns)
                : tailPos === "right" ? (by + boxH - tIns) : (by + boxH / 2);
        ctx.beginPath();
        if (calloutDir === "top") {
          ctx.moveTo(cxT - half, by + 0.5); ctx.lineTo(cxT + half, by + 0.5); ctx.lineTo(cxT, by - tailH);
        } else if (calloutDir === "left") {
          ctx.moveTo(bx + 0.5, cyT - half); ctx.lineTo(bx + 0.5, cyT + half); ctx.lineTo(bx - tailH, cyT);
        } else if (calloutDir === "right") {
          ctx.moveTo(bx + boxW - 0.5, cyT - half); ctx.lineTo(bx + boxW - 0.5, cyT + half); ctx.lineTo(bx + boxW + tailH, cyT);
        } else {
          ctx.moveTo(cxT - half, by + boxH - 0.5); ctx.lineTo(cxT + half, by + boxH - 0.5); ctx.lineTo(cxT, by + boxH + tailH);
        }
        ctx.closePath();
        ctx.fillStyle = tailCol; ctx.fill();
      }
    }

    // ── Bild (oben in der Box, cover-fit, abgerundet) ───────────────────
    if (hasImg) {
      ctx.globalAlpha = 1;   // v0.9.478 — „Deckkraft" fadet nur den Hintergrund, NICHT Bild/Text
      var ix = bx + pad + contentDX, iy = by + pad;
      var iwd = boxW - arrowW - pad * 2, ihd = imgH;
      // v0.9.473 — bei transparenter Box (Bild ohne Rahmen) wirft das Bild selbst einen
      // Schatten entlang seiner Kontur: Schatten-Caster hinter dem cover-fit-Bild zeichnen
      // (das opake Bild deckt den Caster ab, sichtbar bleibt nur der Schatten am Rand).
      if (boxTransparent && shadow) {
        setShadow(true);
        rr(ix, iy, iwd, ihd, Math.max(0, radius - pad * 0.5));
        ctx.fillStyle = "#000"; ctx.fill();
        setShadow(false);
      } else {
        setShadow(false);
      }
      ctx.save();
      rr(ix, iy, iwd, ihd, Math.max(0, radius - pad * 0.5));
      ctx.clip();
      var sc = Math.max(iwd / imgNW, ihd / imgNH);
      var dw = imgNW * sc, dh = imgNH * sc;
      try {
        ctx.drawImage(image, ix + (iwd - dw) / 2, iy + (ihd - dh) / 2, dw, dh);
      } catch (_) {
        ctx.fillStyle = "#2a2f37"; ctx.fillRect(ix, iy, iwd, ihd);
      }
      ctx.restore();
    }

    // ── Text (= Bildunterschrift wenn ein Bild da ist) ──────────────────
    if (hasText) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = textColor;
      ctx.font = FONT;
      ctx.textBaseline = "middle";
      var textAreaW = boxW - arrowW - pad * 2;
      var tx, anchorAlign;
      if (align === "left") { ctx.textAlign = "left"; tx = bx + pad + contentDX; anchorAlign = "left"; }
      else if (align === "right") { ctx.textAlign = "right"; tx = bx + pad + contentDX + textAreaW; anchorAlign = "right"; }
      else { ctx.textAlign = "center"; tx = bx + pad + contentDX + textAreaW / 2; anchorAlign = "center"; }
      var ty0 = by + pad + (hasImg ? imgH + imgGap : 0) + lineH / 2;
      var drawLines = function () {
        for (var k = 0; k < lines.length; k++) {
          ctx.fillText(lines[k], tx, ty0 + k * lineH);
          if (kunstFett > 0) {
            // Kunst-Fett: Kontur in Textfarbe über die Füllung.
            ctx.save();
            ctx.strokeStyle = ctx.fillStyle;
            ctx.lineWidth = kunstFett;
            ctx.lineJoin = "round";
            ctx.strokeText(lines[k], tx, ty0 + k * lineH);
            ctx.restore();
          }
        }
      };
      // v0.9.475 — bei transparenter Box wirft der Text selbst den Schatten (Kontur der
      // Glyphen). Kräftiger als v0.9.473 (Beta-Tester: „Schatten zu schwach"): zwei Schatten-
      // Pässe (weicher Halo + enge dunkle Kante, Deckkraft angehoben), dann die scharfen
      // Glyphen OHNE Schatten obendrauf — ein Schatten auf dünnen Kanten wirkt sonst zu
      // schwach. Mit Box übernimmt die Box den Schatten, Text dann ohne Eigenschatten.
      if (boxTransparent && shadow) {
        // 22.08.2026 (Audit): X-Versatz mitnehmen — die DOM-Vorschau (sign_dom.js)
        // nutzt _sox/_soy in voller Richtung, das Video setzte X fix auf 0 →
        // bei Schatten-Richtung 0°/180° ohne Box: Vorschau mit Versatz, Video ohne.
        var _ts = function (blur, offX, offY, a) {
          ctx.shadowColor = rgba(shadowC, Math.min(1, a)); ctx.shadowBlur = blur;
          ctx.shadowOffsetX = offX; ctx.shadowOffsetY = offY;
        };
        _ts(shadowBlur, shOffX, shOffY, shadowStrength + 0.28); drawLines();
        _ts(Math.max(1 * dpr, shadowBlur * 0.4), Math.round(shOffX * 0.5), Math.round(shOffY * 0.5), shadowStrength + 0.22); drawLines();
        setShadow(false);
        drawLines();
      } else {
        setShadow(false);
        drawLines();
      }
    }

    // anchor = auf welchen Bildrand der Geo-Punkt fällt (Sprechblasen-Spitze).
    // Für alle Nicht-Callout-Stile bleibt es "bottom" (calloutDir default).
    // 18.10.2026 — `text`: wo der Text im Bild steht (CSS-px ab der linken oberen Bildecke). Das HTML-Schild im Editor
    // zeigt dieses Bild und legt seinen tippbaren Text unsichtbar genau darüber (Schreibmarke an der richtigen Stelle).
    return { data: ctx.getImageData(0, 0, c.width, c.height), dpr: dpr, anchor: calloutDir,
             text: { x: (bx + pad + contentDX) / dpr, y: (by + pad + (hasImg ? imgH + imgGap : 0)) / dpr,
                     w: (boxW - arrowW - pad * 2) / dpr, h: Math.max(textH, lineH) / dpr, zeile: lineH / dpr,
                     px: fontPx, ausrichtung: align, farbe: textColor, schrift: FONT.replace(fs + "px", fontPx + "px") } };
  }

  // ── Pro-Frame: Sichtbarkeits-Fenster + Einblend-Animation ──────────────
  // metas[i] = { a_show, a_hide, fade, pop } (alles in Anchor-Einheiten 0..1).
  // M = aktuelle Marker-Position auf dem Track (0..1).
  // Sichtbarkeit via setFilter (Fenster), Fade/Pop via feature-state (op/scale).
  // v0.9.479 — Aufpopp-Kurve: easeOutBack (wächst von 0, überschwingt leicht auf ~1.1,
  // pendelt sich auf 1 ein). t in [0..1].
  function rzPopScale(t) {
    if (t >= 1) return 1;
    if (t <= 0) return 0;
    var c1 = 1.70158, c3 = c1 + 1, p = t - 1;
    return 1 + c3 * p * p * p + c1 * p * p;
  }

  // v0.9.484 — icon-size-Ausdruck an EINER Stelle. `withPop=true` hängt den
  // datengetriebenen popScale-Faktor an jeden Zoom-Stützwert. Wichtig: der
  // Multiplikator steht INNERHALB der Stops, damit ['zoom'] top-level bleibt —
  // sonst verwirft Mapbox den Layer und es erscheint gar kein Schild.
  //
  // Warum umschaltbar: der datengetriebene Ausdruck lässt Mapbox das Symbol beim
  // Zoomen minimal anders rastern → „die Buchstaben tanzen" (Beta-Tester, mehrfach).
  // Deshalb ist der Layer im Normalfall rein zoom-abhängig (scharf) und bekommt den
  // popScale-Faktor nur für die paar Zehntelsekunden, in denen ein Schild wirklich
  // aufpoppt. rzSignApplyFrame schaltet unten hin und zurück.
  var RZ_SIGN_ZOOM_BASE = Math.pow(4.8, 1 / 12);   // 0,5 bei Zoom 8 → 2,4 bei Zoom 20
  function rzSignIconSize(withPop, scale) {
    var s = Number(scale) || 1;
    function sz(v) {
      var base = ["case", ["==", ["get", "zoomScale"], true], v * s, 1 * s];
      return withPop ? ["*", base, ["coalesce", ["get", "popScale"], 1]] : base;
    }
    // 05.09.2026 (Marc: „kleiner Skalierungssprung bei den Schildern" im Schorfheide-
    // Render): MapLibre wertet eine zoomabhängige icon-size NICHT beim aktuellen
    // Zoom aus, sondern zwischen den beiden Stützwerten, die die ZOOMSTUFE DER
    // KACHEL einrahmen — und klemmt dort. Bei geneigter Kamera liegt ein Schild im
    // Nahfeld oft in einer Kachel, die feiner ist als der Kartenzoom (z12-Kachel bei
    // Zoom 11,7): Rahmen 12–16, geklemmt auf den Wert bei 12 → 3 % zu groß. Wechselt
    // die Kachel unter dem Schild (Kamerafahrt, Filter, Aufpoppen), springt die
    // Größe. Mit EINEM Segment 8…20 ist der Rahmen für jede Kachelstufe derselbe,
    // die Auswertung exakt und stetig; Kamera- und Aufpopp-Ausdruck liefern
    // identische Werte. Kurve: exponentiell 0,5 → 2,4 (Basis 4,8^(1/12)), nahe an
    // den alten Stützwerten (bei 12: 0,84 statt 0,80; bei 16: 1,42 statt 1,50).
    return ["interpolate", ["exponential", RZ_SIGN_ZOOM_BASE], ["zoom"], 8, sz(0.5), 20, sz(2.4)];
  }
  // 18.10.2026 (Marc: „Wir brauchen WYSIWYG. Überall.“) — derselbe Wert wie der icon-size-Ausdruck oben, als Zahl: für den
  // Randversatz und für das HTML-Schild im Editor (sign_dom.js, module.js). Vorher rechnete der Editor mit den alten
  // Stützwerten (bei Zoom 12: 0,80 statt 0,84) — das Schild war dort ein paar Prozent anders groß als im Video.
  function rzSignZoomGroesse(zoom) {
    var z = Math.max(8, Math.min(20, Number(zoom) || 0));
    return 0.5 * Math.pow(RZ_SIGN_ZOOM_BASE, z - 8);
  }
  /** Größenfaktor eines Schilds auf der Karte (= icon-size der Schild-Ebene ohne Aufpoppen). */
  function rzSignGroesse(map, zoomScale) {
    var skal = (map && map.__rzSignSizeScale) || 1;
    return zoomScale === true ? rzSignZoomGroesse(map && map.getZoom ? map.getZoom() : 12) * skal : skal;
  }

  // 18.10.2026 — Objekt eines Schilds über seine id (= Schild-Index), nicht über seine Stelle in der Liste. Die Liste
  // enthält nicht jedes Schild (ausgelassen: Fotostopp „Foto groß“, ausgeblendete, noch ohne Bild) und beim Fotostopp
  // „eigene Gestaltung“ zusätzlich die Halt-Fassung (id 1000000 + Index) direkt hinter ihrem Schild. Über die Stelle
  // gelesen landeten Aufpoppen, Mini-Bild und Randversatz beim falschen Objekt. Merker je Liste in einer WeakMap (nicht
  // an der Liste selbst — die geht per setData an MapLibre).
  var _rzFeatNachId = (typeof WeakMap !== "undefined") ? new WeakMap() : null;
  function rzSignFeat(fc, k) {
    if (!fc || !fc.features) return null;
    var e = _rzFeatNachId ? _rzFeatNachId.get(fc) : null;
    if (!e || e.n !== fc.features.length) {
      e = { n: fc.features.length, m: {} };
      for (var i = 0; i < fc.features.length; i++) { var f = fc.features[i]; if (f && f.id != null && !(f.id in e.m)) e.m[f.id] = f; }
      if (_rzFeatNachId) _rzFeatNachId.set(fc, e);
    }
    if (e.m[k]) return e.m[k];
    var g = fc.features[k];   // Objekte ohne id (Prüfstände): Stelle = Index
    return (g && g.id == null) ? g : null;
  }

  /** 25.10.2026 (Marc, Masca: „die gelben POI-Punkte gucken durch das Gelände durch, der Track ist verdeckt … wenn man den
   *  Track nicht sieht, sollte man die Punkte auch nicht sehen“) — Schilder stehen am Bildschirm ausgerichtet über ihrem
   *  Ankerpunkt; MapLibre prüft dabei nicht, ob ein Berg davor liegt (die Linie liegt dagegen AUF dem Gelände und wird
   *  verdeckt). Hier der Sichtstrahl Kamera → Ankerpunkt am Boden: ragt das Gelände dazwischen darüber, ist das Schild
   *  verdeckt. Weich über ÜBERSTAND_M Meter (kein Flackern am Grat), je Bild aus Kamera und Gelände gerechnet — Vorschau
   *  und Video gleich. 1 = frei, 0 = verdeckt; ohne Gelände immer 1. */
  var RZ_SICHT_PROBEN = 28, RZ_SICHT_UEBERSTAND_M = 40;
  function rzSignSicht(map, lng, lat) {
    try {
      if (!map || !map.getTerrain || !map.getTerrain() || !map.queryTerrainElevation) return 1;
      // unter Zoom 9 zeichnet die Karte (teils) als Kugel (mapstyles.PROJECTION) — die Merkator-Rechnung hier gilt dann nicht
      if (map.getZoom && map.getZoom() < 9) return 1;
      var MC = (typeof window !== "undefined") && ((window.maplibregl && window.maplibregl.MercatorCoordinate) || (window.mapboxgl && window.mapboxgl.MercatorCoordinate));
      if (!MC) return 1;
      // Kamera: MapLibre 5 über transform (Höhe in m über dem Meer, Gelände eingerechnet), Mapbox über FreeCamera
      // (transform.getCameraAltitude() ist in dieser MapLibre-Fassung NaN — _pixelPerMeter fehlt —, darum rzMlCamRead aus
      // ui/js/maplibre-camera.js, dieselbe Rechnung wie Keyframes und Render)
      var cam = null;
      if (typeof map.getFreeCameraOptions === "function") {
        cam = map.getFreeCameraOptions().position;
      } else if (typeof window.rzMlCamRead === "function") {
        var rc = window.rzMlCamRead(map);
        if (rc && rc.pos) cam = new MC(rc.pos[0], rc.pos[1], rc.pos[2]);
      }
      if (!cam || !isFinite(cam.x) || !isFinite(cam.y) || !isFinite(cam.z)) return 1;
      var boden = map.queryTerrainElevation({ lng: lng, lat: lat });
      if (typeof boden !== "number" || !isFinite(boden)) return 1;
      var ziel = MC.fromLngLat({ lng: lng, lat: lat }, boden + 3);
      var schlimm = 0;
      for (var k = 1; k < RZ_SICHT_PROBEN; k++) {
        var t = k / RZ_SICHT_PROBEN;
        if (t > 0.97) break;   // die letzten Meter vor dem Anker: der eigene Hang
        var x = cam.x + (ziel.x - cam.x) * t, y = cam.y + (ziel.y - cam.y) * t, z = cam.z + (ziel.z - cam.z) * t;
        var p = new MC(x, y, 0), ll = p.toLngLat();
        var hoehe = z / p.meterInMercatorCoordinateUnits();
        var gel = map.queryTerrainElevation(ll);
        if (typeof gel === "number" && isFinite(gel) && gel - hoehe > schlimm) schlimm = gel - hoehe;
      }
      return Math.max(0, Math.min(1, 1 - schlimm / RZ_SICHT_UEBERSTAND_M));
    } catch (_) { return 1; }
  }
  if (typeof window !== "undefined") window.rzSignSicht = rzSignSicht;

  function rzSignApplyFrame(map, lyr, src, metas, M) {
    if (!map || !map.getLayer || !map.getLayer(lyr)) return;
    // 22.08.2026 (Audit): Filter nur setzen, wenn sich M spürbar bewegt hat —
    // der Aufruf läuft pro Animationsframe (rAF); bei 700 Foto-Schildern war
    // jeder Frame ein Filter-Rebuild, auch wenn gar nichts passierte.
    var Mq = Math.round(M * 100000) / 100000;
    // Layer/Quelle neu aufgebaut (neue FeatureCollection)? → alle Caches verwerfen,
    // sonst bliebe der Filter aus und die Feature-States wären nie gesetzt.
    if (map.__rzSignCacheFC !== map.__rzSignFC) {
      map.__rzSignCacheFC = map.__rzSignFC;
      map.__rzSignLastM = null; map.__rzSignOpLast = null; map.__rzSignVisKey = null;
    }
    // 14.09.2026 (Nachttest, 2830 Foto-Schilder): Jeder Filterwechsel lässt MapLibre
    // alle Kacheln der Ebene neu aufbauen, und jede Kachel kopiert dabei ALLE sichtbaren
    // Schild-Bilder (je Auftrag >100 MB). Die Aufträge stauten sich — 18 GB in 8 s, der
    // WebView-Prozess wurde beendet. Bei vielen Schildern bleibt der Filter deshalb offen
    // und die Sichtbarkeit läuft über die Deckkraft (feature-state = Paint, kein Neubau).
    var viele = Array.isArray(metas) && metas.length > RZ_SIGN_BILD_VOLL;
    if (viele) {
      if (map.__rzSignVisKey !== "__alle__" || map.__rzSignLastLyr !== lyr) {
        map.__rzSignVisKey = "__alle__"; map.__rzSignLastLyr = lyr; map.__rzSignLastM = Mq;
        try { map.setFilter(lyr, null); } catch (_) {}
      }
    }
    // 04.09.2026 (Marc: „läuft flüssig los und ruckelt dann mehr und mehr …
    // Schild kommt erst nach dem Stopp"): Bisher bekam die Ebene JEDEN Frame
    // einen neuen Filter mit dem laufenden Anker M. Ein Filterwechsel lässt
    // MapLibre/Mapbox die Kacheln der Ebene im Worker neu bauen — je Frame ein
    // Auftrag, der länger dauert als ein Frame → die Warteschlange wächst mit
    // der Laufzeit (immer träger), und das Symbol wird nie fertig platziert
    // (erscheint erst, wenn der Filter Ruhe hat = nach dem Stopp). Jetzt wird
    // die sichtbare Menge auf dem Hauptfaden bestimmt und der Filter nur
    // gesetzt, wenn sie sich ändert (ein paar Mal je Lauf statt 60× je Sekunde).
    var vis = [];
    if (Array.isArray(metas) && !viele) {
      for (var q = 0; q < metas.length; q++) {
        var mq = metas[q] || {};
        var aS = (mq.a_show == null) ? -1 : mq.a_show, aH = (mq.a_hide == null) ? 2 : mq.a_hide;
        if (M >= aS && M <= aH) vis.push(q);
      }
    }
    var visKey = vis.join(",");
    if (!viele && (map.__rzSignVisKey !== visKey || map.__rzSignLastLyr !== lyr)) {
      map.__rzSignVisKey = visKey; map.__rzSignLastLyr = lyr; map.__rzSignLastM = Mq;
      try {
        // Vorschau-Features tragen `signIdx`, die Render-Features (core/animator.py)
        // nur die Feature-`id` — beide sind der Index. (04.09.2026 abends, Marc:
        // „nach dem Rendern fehlen die Schilder": der erste Wurf filterte nur
        // auf `signIdx` → im Video kein einziges Schild.)
        const _key = ["coalesce", ["get", "signIdx"], ["id"]];
        map.setFilter(lyr, vis.length ? ["in", _key, ["literal", vis]] : ["==", _key, -1]);
      } catch (_) {}
    }
    if (!Array.isArray(metas)) return;
    // Pop (icon-size · popScale) über setData ins Feature — nur wenn sich ein Wert
    // spürbar ändert (kein setData-Sturm). Danach op-States wieder setzen, weil
    // setData den feature-state resetten kann.
    var fc = map.__rzSignFC;
    var popDirty = false;
    // 13.10.2026 (Web-Fund F-20: im Hochformat ragten Schilder und Sofortbilder halb über den Bildrand) — ein sichtbares
    // Schild, das über den Rand ragen würde, wird per icon-offset ins Bild geschoben (8 px Rand). Ausgerechnet aus Ort,
    // Bildgröße und icon-size; geschrieben nur, wenn sich der Versatz ändert (in 4er-Schritten, kein setData-Sturm).
    var randDirty = rzSignRandVersatz(map, fc, vis, metas);
    if (randDirty) popDirty = true;
    // 14.10.2026 (Bildvergleich Editor ↔ Video) — nach einem Sprung im Editor lief diese Rechnung, bevor die Kamera
    // angekommen war (alte Projektion → Schild galt als „ganz draußen“ und blieb abgeschnitten); im Video kommt die Kamera
    // vor jedem Bild an. Darum nach jeder Kamerabewegung mit dem letzten Stand nachrechnen.
    map.__rzSignRandArgs = { vis: vis, metas: metas, src: src };
    if (!map.__rzSignRandHook && map.on) {
      map.__rzSignRandHook = true;
      map.on("moveend", function () {
        var A = map.__rzSignRandArgs, F = map.__rzSignFC;
        if (!A || !F) return;
        try {
          if (rzSignRandVersatz(map, F, A.vis, A.metas)) {
            var ops = map.__rzSignOpLast ? map.__rzSignOpLast.slice() : null;
            map.getSource(A.src).setData(F);
            // setData setzt die Feature-States zurück → letzte Deckkraft wieder schreiben
            if (ops) for (var i = 0; i < ops.length; i++) if (ops[i] != null) map.setFeatureState({ source: A.src, id: i }, { op: ops[i] });
          }
        } catch (_) {}
      });
    }
    // v0.9.479b — nur anfassen, wenn wirklich ein Schild Aufpoppen nutzt. Sonst KEIN
    // setData/popScale (die icon-size ist dann der reine Zoom-Ausdruck → scharf, kein Zittern).
    var anyPop = false;
    for (var j = 0; j < metas.length; j++) { if (metas[j] && (metas[j].pop > 0 || metas[j].popOut > 0 || metas[j].miniId)) { anyPop = true; break; } }
    var popRunning = false;   // poppt in DIESEM Frame gerade etwas auf?
    if (anyPop && fc && fc.features) {
      if (!map.__rzSignPopLast) map.__rzSignPopLast = [];
      for (var k = 0; k < metas.length; k++) {
        var mk = metas[k] || {};
        var ps = 1;
        // 05.10.2026 — Ausgang „mini": großes Bild schrumpft weich, auf halbem Weg Wechsel aufs runde Mini-Bild
        // (gleiche Breite im Wechsel-Moment), danach bleibt das Mini stehen. Aus dem Anker berechnet → Video = Vorschau.
        var bild = null;
        if (mk.miniId && mk.mini != null) {
          var mW = mk.miniW || 200, t = RZ_MINI_PX / mW;
          var mp = M > mk.mini ? Math.max(0, Math.min(1, (M - mk.mini) / (mk.miniSpan || 1e-6))) : 0;
          mp = mp * mp * (3 - 2 * mp);
          var sF = 1 + (t - 1) * mp;
          if (mp <= 0) bild = mk.fullId;
          else if (mp < 0.5) { bild = mk.fullId; ps = sF; popRunning = true; }
          else { bild = mk.miniId; ps = sF / t; if (mp < 1) popRunning = true; }
          var fk = rzSignFeat(fc, k);   // 18.10.2026 — über die id (siehe rzSignFeat)
          if (bild && fk && fk.properties && fk.properties.imgId !== bild) {
            fk.properties.imgId = bild; popDirty = true;
          }
        }
        // Nur INNERHALB des Aufpopp-Fensters skalieren. Davor (Schild noch
        // ausgefiltert) und danach bleibt der Wert 1 — sonst stünde der
        // datengetriebene Ausdruck die halbe Animation lang unnötig an.
        if (bild) {
          // Mini-Ausgang hat den Faktor oben schon gesetzt
        } else if (mk.popOut > 0 && M > mk.a_hide - mk.popOut && M <= mk.a_hide) {
          ps = rzPopScale((mk.a_hide - M) / mk.popOut);   // Wegpoppen = Aufpoppen rückwärts
          popRunning = true;
        } else if (mk.pop > 0 && M >= mk.a_show && M < mk.a_show + mk.pop) {
          ps = rzPopScale((M - mk.a_show) / mk.pop);
          // Ganzes Fenster, nicht „ps ≠ 1": easeOutBack schwingt kurz über 1 hinaus und
          // läuft durch die 1 hindurch. Am Fenster festzumachen verhindert, dass mitten
          // im Aufpoppen zurückgeschaltet wird (sichtbarer Sprung).
          popRunning = true;
        }
        var prev = map.__rzSignPopLast[k];
        if (prev == null || Math.abs(prev - ps) > 0.004) {
          popDirty = true;
          map.__rzSignPopLast[k] = ps;
          var fp = rzSignFeat(fc, k);   // 18.10.2026 — über die id (siehe rzSignFeat)
          if (fp && fp.properties) fp.properties.popScale = ps;
        }
      }
      if (popDirty) {
        try { map.getSource(src).setData(fc); } catch (_) {}
        map.__rzSignOpLast = null;   // setData kann Feature-States zurücksetzen → neu schreiben
      }
    }
    if (randDirty && !anyPop) {
      try { map.getSource(src).setData(fc); } catch (_) {}
      map.__rzSignOpLast = null;
    }
    // v0.9.484 — den datengetriebenen icon-size-Ausdruck NUR während des laufenden
    // Aufpoppens anlegen und sofort danach wieder abnehmen. Ergebnis: es poppt auf
    // UND die Schrift bleibt beim Zoomen scharf (kein „Buchstabentanzen").
    if (map.__rzSignPopMode !== popRunning) {
      map.__rzSignPopMode = popRunning;
      try {
        map.setLayoutProperty(lyr, "icon-size", rzSignIconSize(popRunning, map.__rzSignSizeScale));
      } catch (_) {}
    }
    // Deckkraft pro Schild nur schreiben, wenn sie sich geändert hat (sonst
    // N Feature-State-Writes pro Frame, fast immer mit demselben Wert).
    if (!map.__rzSignOpLast || map.__rzSignOpLast.length !== metas.length || map.__rzSignOpSrc !== src) {
      map.__rzSignOpLast = new Array(metas.length); map.__rzSignOpSrc = src;
    }
    var sichtN = 0;
    for (var i = 0; i < metas.length; i++) {
      var m = metas[i] || {};
      var op = 1;
      if (viele) {
        var vS = (m.a_show == null) ? -1 : m.a_show, vH = (m.a_hide == null) ? 2 : m.a_hide;
        if (!(M >= vS && M <= vH)) op = 0;
      }
      // Fade (Ein-/Ausblenden) über icon-opacity = PAINT-Property → feature-state erlaubt.
      if (op > 0) op = Math.max(0, Math.min(1, rzSignDeckkraft(m, M)));
      // 25.10.2026 — hinter einem Berg (Sichtstrahl zum Anker) ausblenden, s. rzSignSicht. Höchstens 60 Schilder je Bild
      // (Projekte mit Tausenden Foto-Schildern: sonst Tausende Strahlen je Bild) — darüber bleibt es wie bisher.
      if (op > 0 && ++sichtN <= 60) {
        var fs = rzSignFeat(fc, i), gk = fs && fs.geometry && fs.geometry.coordinates;
        if (gk && gk.length >= 2) op *= rzSignSicht(map, +gk[0], +gk[1]);
      }
      var opq = Math.round(op * 1000) / 1000;
      if (map.__rzSignOpLast[i] === opq) continue;
      map.__rzSignOpLast[i] = opq;
      try { map.setFeatureState({ source: src, id: i }, { op: op }); } catch (_) {}
    }
  }

  // Versatz je sichtbarem Schild, damit es ganz im Bild bleibt (F-20). true = Eigenschaften geändert (setData nötig).
  /** 14.10.2026 (Flugstile, 3×3-Vergleich: „Halbe Strecke“ von oben hereingeschoben lag über dem GPS-Studio-Logo) —
   *  Flächen, die ein hereingeschobenes Schild nicht überdecken soll: das Logo (Einblendung mit @lockup-Bild), in
   *  Bildpunkten der Karte. Vorschau und Video zeichnen dieselbe Seite → gleiche Lage. */
  function rzSchutzFlaechen(map) {
    var out = [];
    try {
      if (typeof document === "undefined" || !document.querySelectorAll) return out;
      var cv = map.getCanvas(), cr = cv.getBoundingClientRect(), W = cv.clientWidth || cv.width;
      var sk = cr.width ? W / cr.width : 1;
      var bilder = document.querySelectorAll('#anim-overlay-preview img.ct-bild[data-bild^="@lockup"]');
      for (var i = 0; i < bilder.length; i++) {
        var r = bilder[i].getBoundingClientRect();
        if (!(r.width > 0 && r.height > 0)) continue;
        out.push({ x0: (r.left - cr.left) * sk, x1: (r.right - cr.left) * sk, y0: (r.top - cr.top) * sk, y1: (r.bottom - cr.top) * sk });
      }
    } catch (_) {}
    return out;
  }
  var RAND_ANTEIL = 1 / 3;   // höchstens so viel der Schildgröße wird hereingeschoben (siehe rzSignRandVersatz)
  /** 18.10.2026 — die Randregel für EINEN Kasten (Bildschirm-px: Ort p, Breite w, Höhe h, Anker a, Größenfaktor gr) →
   *  Versatz [x, y] in Symbol-Bildpunkten (wie icon-offset, nach außen auf 4er gerundet). Genutzt von rzSignRandVersatz
   *  (Schild-Ebene, Video) und rzSignRandPx (HTML-Schild im Editor) — eine Regel, kein Nachbau. */
  function rzSignRandSymbol(W, H, p, w, h, a, gr, schutz) {
    var RAND = 8;
    var x0 = p.x - (a.indexOf("left") >= 0 ? 0 : a.indexOf("right") >= 0 ? w : w / 2);
    var y0 = p.y - (a.indexOf("top") >= 0 ? 0 : a.indexOf("bottom") >= 0 ? h : h / 2);
    // Nur Schilder, die schon (teilweise) im Bild stehen, werden hereingeschoben. Liegt der Kasten komplett draußen
    // (Ort weit weg, oder die Projektion stammt noch von der Kamera vor einem Sprung), wird nichts hereingezogen.
    // 14.10.2026 (Flugstil Kranschwenk: Schild lief mit der Kamera aus dem Bild und blieb dann groß in der Ecke hängen) —
    // ganz draußen geht der Versatz auf 0 (vorher blieb der letzte stehen). Und damit es nicht springt: ganz
    // hereingeschoben, solange mindestens ein Viertel im Bild läge (F-20: halb überstehend → ganz herein); darunter
    // nimmt das Schieben gleichmäßig ab, das Schild gleitet hinaus.
    var dx = 0, dy = 0;
    var drin = !(x0 + w <= 0 || x0 >= W || y0 + h <= 0 || y0 >= H);
    if (drin) {
      // 15.10.2026 (Marc, Video „Linum“: „Das Schild ‚Fasane‘ wandert immer weiter runter. Das hält scheinbar immer den
      // gleichen Abstand zum Rand, anstatt dass es einfach über den Rand rausgeht.“) — höchstens ein Drittel der
      // Schildgröße wird hereingeschoben (RAND_ANTEIL). Steht ein Schild knapp über dem Rand, kommt es ganz herein (F-20);
      // trägt die Kamera es weiter hinaus, wandert es nach diesem Drittel mit der Karte über den Rand, statt am Rand zu
      // kleben. Nie mehr, als vom Schild noch im Bild läge — so gleitet es am Ende weich hinaus. Ohne Gedächtnis
      // gerechnet: Editor (Scrubben) und Video (Bild für Bild) zeigen dasselbe.
      var randAchse = function (lo, groesse, gesamt) {
        if (groesse + 2 * RAND > gesamt) return 0;
        var max = groesse * RAND_ANTEIL;
        if (lo < RAND) return Math.min(RAND - lo, max, Math.max(0, lo + groesse));
        if (lo + groesse > gesamt - RAND) return -Math.min(lo + groesse - (gesamt - RAND), max, Math.max(0, gesamt - lo));
        return 0;
      };
      dx = randAchse(x0, w, W); dy = randAchse(y0, h, H);
      // von oben hereingeschoben und läge dann über dem Logo → unter das Logo
      if (dy > 0) {
        for (var z = 0; z < schutz.length; z++) {
          var S = schutz[z], nx0 = x0 + dx, ny0 = y0 + dy;
          if (nx0 < S.x1 && nx0 + w > S.x0 && ny0 < S.y1 && ny0 + h > S.y0 && S.y1 + RAND + h <= H) dy += (S.y1 + RAND) - ny0;
        }
      }
    }
    // icon-offset wird mit icon-size multipliziert → in Symbol-Bildpunkte, auf 4er-Schritte gerundet
    var g = Math.max(0.05, gr);
    var schritt = function (d) { var x = d / g / 4; return (x < 0 ? Math.floor(x) : Math.ceil(x)) * 4; };   // nach außen runden: ganz im Bild
    var ox = schritt(dx), oy = schritt(dy);
    return [ox, oy];
  }
  function rzSignRandVersatz(map, fc, vis, metas) {
    if (!fc || !fc.features || !vis || !map.project || !map.getCanvas) return false;   // auch ohne sichtbare Schilder: zurücksetzen (unten)
    var cv = map.getCanvas(), W = cv.clientWidth || cv.width, H = cv.clientHeight || cv.height;
    if (!(W > 0 && H > 0)) return false;
    var skal = map.__rzSignSizeScale || 1;
    var zs = rzSignGroesse(map, true);   // 18.10.2026 — eine Rechnung für Ebene und Editor
    var geaendert = false, gesehen = {};
    var schutz = map.__rzSchutzTest || rzSchutzFlaechen(map);
    // 18.10.2026 (Beta-Tester, Fotostopp „eigene Gestaltung“: „se mezclan dos tipos de bocadillo“) — alle Objekte der
    // sichtbaren Schilder, über `signIdx` (Render-Objekte: id) statt über die Stelle in der Liste: die Halt-Fassung
    // (zweites Objekt desselben Schilds) blieb sonst ohne Versatz und stand im Halt halb über dem Rand, in der
    // Überblendung neben der verschobenen Unterwegs-Fassung; Schilder dahinter bekamen den Versatz eines Nachbarn.
    var visMenge = {};
    for (var v = 0; v < vis.length; v++) visMenge[vis[v]] = 1;
    for (var n = 0; n < fc.features.length; n++) {
      var f = fc.features[n];
      if (!f || !f.geometry || !f.properties) continue;
      var pr = f.properties, img = null;
      var k = (pr.signIdx != null) ? pr.signIdx : (f.id != null ? f.id : n);
      if (!visMenge[k]) continue;
      // Das runde Mini nach dem Sofortbild markiert den Aufnahmeort an der Route — es bleibt an seinem Ort (kein Versatz)
      var mm = metas && metas[k];
      if (mm && mm.miniId && pr.imgId === mm.miniId) continue;
      // 14.10.2026 (Orte nacheinander: „da wandert Madrid mit“) — ein Ortsschild steht für seinen Ort, es wird nie verschoben
      if (pr.randFest === true) continue;
      gesehen[n] = 1;   // 18.10.2026 — Stelle in der Liste (wie das Zurücksetzen unten), nicht Schild-Index
      try { img = map.getImage ? map.getImage(pr.imgId) : null; } catch (_) { img = null; }
      if (!img) { try { img = map.style && map.style.getImage ? map.style.getImage(pr.imgId) : null; } catch (_) { img = null; } }
      if (!img || !img.data || !img.data.width) continue;
      var pop = Number(pr.popScale) || 1;   // 18.10.2026 — Aufpopp-Faktor dieses Objekts (die Halt-Fassung poppt nicht)
      var gr = (pr.zoomScale === true ? zs : skal) * (map.__rzSignPopMode ? pop : 1);
      var w = img.data.width / (img.pixelRatio || 1) * gr, h = img.data.height / (img.pixelRatio || 1) * gr;
      var p = map.project(f.geometry.coordinates), a = String(pr.iconAnchor || "bottom");
      if (!p || !isFinite(p.x) || !isFinite(p.y)) continue;
      var oxy = rzSignRandSymbol(W, H, p, w, h, a, gr, schutz);   // 18.10.2026 — Regel in eine Funktion (auch fürs HTML-Schild im Editor)
      var ox = oxy[0], oy = oxy[1];
      var alt = pr.rzOff || [0, 0];
      if (alt[0] !== ox || alt[1] !== oy) { pr.rzOff = [ox, oy]; geaendert = true; }
    }
    // nicht mehr sichtbare Schilder zurück auf 0 (beim nächsten Erscheinen frisch)
    for (var i = 0; i < fc.features.length; i++) {
      var q = fc.features[i] && fc.features[i].properties;
      if (q && q.rzOff && !gesehen[i] && (q.rzOff[0] || q.rzOff[1])) { q.rzOff = [0, 0]; geaendert = true; }
    }
    return geaendert;
  }
  /** 18.10.2026 (Marc: „Wir brauchen WYSIWYG. Überall. Im Editor muss man die Kamera halt verschieben, wenn man das Schild
   *  sehen will.“) — Randversatz für das HTML-Schild im Editor, in Bildschirm-px (Marker-offset). Dieselbe Regel und
   *  Rundung wie die Schild-Ebene (rzSignRandSymbol × Größenfaktor), damit das bearbeitete Schild genau dort steht, wo
   *  es im Video steht. ll = [lon, lat], w/h = Kasten auf dem Bildschirm (Bild × Größenfaktor), anker wie icon-anchor.
   *  opts: { anzahl: Zahl der Schild-Metas (bei vielen Schildern schiebt auch die Ebene nicht, siehe rzSignApplyFrame),
   *  randFest: Ortsschild — nie verschieben }. */
  function rzSignRandPx(map, ll, w, h, anker, gr, opts) {
    opts = opts || {};
    if (!map || !map.project || !map.getCanvas || opts.randFest === true) return [0, 0];
    if (Number(opts.anzahl) > RZ_SIGN_BILD_VOLL) return [0, 0];
    var cv = map.getCanvas(), W = cv.clientWidth || cv.width, H = cv.clientHeight || cv.height;
    if (!(W > 0 && H > 0) || !(w > 0 && h > 0)) return [0, 0];
    var p = map.project(ll);
    if (!p || !isFinite(p.x) || !isFinite(p.y)) return [0, 0];
    var o = rzSignRandSymbol(W, H, p, w, h, String(anker || "bottom"), gr, map.__rzSchutzTest || rzSchutzFlaechen(map));
    var g = Math.max(0.05, gr);
    return [o[0] * g, o[1] * g];
  }

  // Deckkraft eines Schilds beim Anker M aus Ein- und Ausblenden (getrennt; alte Metas: `fade` beidseitig).
  function rzSignDeckkraft(m, M) {
    var fi = (m.fadeIn != null) ? m.fadeIn : (m.fade || 0);
    var fo = (m.fadeOut != null) ? m.fadeOut : (m.fade || 0);
    var op = 1;
    if (fi > 0) op = Math.min(op, (M - m.a_show) / fi);
    if (fo > 0) op = Math.min(op, (m.a_hide - M) / fo);
    return op;
  }

  // Sekunden → Anchor-Bruchteil (Marker läuft in `durationSec` über den Track).
  function rzSignSecToAnchor(sec, durationSec) {
    var d = Number(durationSec) || 12;
    return (Number(sec) || 0) / d;
  }

  // Aus einem Schild-Objekt + Track-Anchor + Animationsdauer die Frame-Meta bauen.
  function rzSignMeta(sign, durationSec) {
    // „Ganze Zeit anzeigen" → von Anfang bis Ende sichtbar, kein Timing-Fenster.
    if (sign.alwaysVisible) return { a_show: -1, a_hide: 2, fade: 0, pop: 0, fadeIn: 0, fadeOut: 0, popOut: 0 };
    var A = (typeof sign.track_anchor === "number") ? sign.track_anchor : 0;
    var before = rzSignSecToAnchor(sign.before, durationSec);
    var after = Number(sign.after) || 0;
    var entry = sign.entry || "none";
    // v0.9.204 — KEIN Clamp auf -0.001 mehr. aShow darf negativ werden, damit
    // ein Schild mit Vorlauf (`before`) am Track-Anfang seinen Einblende-Anker
    // VOR den Track-Start (= ins Intro) legen kann. Render/Preview füttern den
    // Schild-Filter im Intro mit einem negativen Anker (bis -intro_s/anim_s),
    // sodass die Einblendung über die letzte Intro-Sekunde läuft statt erst beim
    // Track-Start aufzuploppen. before=0 → aShow=A → erscheint exakt am Anker
    // (kein Intro-Auftritt). Hold-Seite bleibt unangetastet (aHide-Default 2.0).
    var aShow = A - before;
    var aHide = after > 0 ? (A + rzSignSecToAnchor(after, durationSec)) : 2.0;
    // v0.9.479 — Einblendung differenziert (Beta-Tester: „die 3 Animationen sind gleich"):
    //   fade  → nur Deckkraft-Einblendung (icon-opacity via feature-state, PAINT).
    //   pop   → nur Skalier-Aufpoppen (icon-size · popScale via setData, LAYOUT-Trick).
    //   both  → beides gleichzeitig.
    // Scale-Pop geht NICHT über feature-state (icon-size = LAYOUT), daher fährt
    // rzSignApplyFrame den popScale per setData ins Feature (nur im kurzen Fenster).
    // 29.09.2026 (Marc: „Blende wie bei den Overlays") — Ein- und Ausblenden getrennt, mit eigener Dauer:
    //   entry / entry_s  (Einblenden; ohne entry_s: 0,6 s Einblenden bzw. 0,5 s Aufpoppen wie bisher)
    //   exit  / exit_s   (Ausblenden: none | fade | pop | both; ohne `exit` gilt das alte Verhalten —
    //                     wer einblendet, blendet auch 0,6 s aus, Aufpoppen ohne Ausblenden)
    // `fade`/`pop` bleiben als Einblende-Spannen erhalten (ältere Aufrufer).
    var exit = (sign.exit == null || sign.exit === "") ? ((entry === "fade" || entry === "both") ? "fade" : "none") : String(sign.exit);
    var inS = (sign.entry_s != null && sign.entry_s !== "" && isFinite(Number(sign.entry_s))) ? Math.max(0, Number(sign.entry_s)) : null;
    var outS = (sign.exit_s != null && sign.exit_s !== "" && isFinite(Number(sign.exit_s))) ? Math.max(0, Number(sign.exit_s)) : 0.6;
    var fadeSpan = (entry === "fade" || entry === "both") ? rzSignSecToAnchor(inS == null ? 0.6 : inS, durationSec) : 0;
    var popSpan  = (entry === "pop"  || entry === "both") ? rzSignSecToAnchor(inS == null ? (entry === "pop" ? 0.5 : 0.6) : inS, durationSec) : 0;
    var bisEnde = !(aHide < 1.5);
    var fadeOut = (!bisEnde && (exit === "fade" || exit === "both")) ? rzSignSecToAnchor(outS, durationSec) : 0;
    var popOut  = (!bisEnde && (exit === "pop"  || exit === "both")) ? rzSignSecToAnchor(outS, durationSec) : 0;
    // Passen beide Blenden nicht ins Fenster, werden sie anteilig gekürzt (wie bei den Overlay-Boxen).
    var fenster = Math.max(0, aHide - aShow), rein = Math.max(fadeSpan, popSpan), raus = Math.max(fadeOut, popOut);
    if (!bisEnde && rein + raus > fenster && rein + raus > 0) {
      var f = fenster / (rein + raus); fadeSpan *= f; popSpan *= f; fadeOut *= f; popOut *= f;
    }
    // 05.10.2026 (Sofortbild) — Ausgang „mini": statt zu verschwinden schrumpft das Schild nach „Bleibt sichtbar"
    // zum runden Mini-Bild und bleibt bis zum Ende stehen. `mini` = Anker, ab dem es schrumpft; `miniSpan` = Dauer.
    if (exit === "mini") {
      var aMini = A + rzSignSecToAnchor(after > 0 ? after : 3, durationSec);
      return { a_show: aShow, a_hide: 2.0, fade: fadeSpan, pop: popSpan, fadeIn: fadeSpan, fadeOut: 0, popOut: 0,
               mini: aMini, miniSpan: Math.max(1e-6, rzSignSecToAnchor(outS, durationSec)) };
    }
    return { a_show: aShow, a_hide: aHide, fade: fadeSpan, pop: popSpan, fadeIn: fadeSpan, fadeOut: fadeOut, popOut: popOut };
  }

  if (typeof window !== "undefined") {
    window.__rzDrawSign = rzDrawSign;
    window.__rzDrawSofortbildMini = rzDrawSofortbildMini;
    window.__rzSignFrame = rzSignApplyFrame;
    window.__rzSignMeta = rzSignMeta;
    window.__rzSignDeckkraft = rzSignDeckkraft;
    window.__rzSignIconSize = rzSignIconSize;
    window.__rzSignRandVersatz = rzSignRandVersatz;   // Prüfstand (F-20)
    window.__rzSignRandPx = rzSignRandPx;             // 18.10.2026 — HTML-Schild im Editor (module.js)
    window.__rzSignGroesse = rzSignGroesse;
    window.__rzSignZoomGroesse = rzSignZoomGroesse;
    window.__rzSignDpr = rzSignDpr;
    window.__rzHlStile = RZ_HL_STILE;
    window.__rzHlFarben = RZ_HL_FARBEN;
    // 02.10.2026 — Symbol als kleines SVG (Zeitleiste: Highlight-Pille zeigt ihr Zeichen im Balken)
    window.__rzHlIconSvg = function (art, farbe) {
      var spec = RZ_HL_ICONS[art];
      if (!spec) return "";
      var f = /^#[0-9a-f]{3,8}$/i.test(String(farbe || "")) ? farbe : "#ffc21a";
      return '<svg viewBox="0 0 24 24" width="100%" height="100%">' + spec.map(function (x) {
        return x[1] === "s" ? '<path d="' + x[0] + '" fill="none" stroke="' + f + '" stroke-width="' + (x[2] || 2) + '" stroke-linecap="round" stroke-linejoin="round"/>'
                            : '<path d="' + x[0] + '" fill="' + f + '"' + (x[1] === "fe" ? ' fill-rule="evenodd"' : "") + "/>";
      }).join("") + "</svg>";
    };
  }
  if (typeof globalThis !== "undefined") {
    globalThis.__rzDrawSign = rzDrawSign;
    globalThis.__rzSignFrame = rzSignApplyFrame;
    globalThis.__rzSignMeta = rzSignMeta;
    globalThis.__rzSignIconSize = rzSignIconSize;
    globalThis.__rzSignDpr = rzSignDpr;
  }
})();
