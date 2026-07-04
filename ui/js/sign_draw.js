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
  function rzDrawSign(o) {
    o = o || {};
    var dpr = 2;
    var fontPx = Math.max(8, Number(o.size) || 40);
    var fs = fontPx * dpr;
    var weight = Number(o.weight) || 700;
    var italic = o.italic ? "italic " : "";
    var FONT = italic + weight + " " + fs + "px " + fontStack(o.font);
    var text = String(o.text == null ? "" : o.text);
    var hasText = text.trim().length > 0;
    var lines = text.split("\n");
    var image = o.image || null;
    var hasImg = !!image;
    var style = o.style || "callout";
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
    var shadowBlur = (o.shadowBlur != null ? Number(o.shadowBlur) : 8) * dpr;
    var shadowStrength = (o.shadowStrength != null ? Math.max(0.05, Math.min(1, Number(o.shadowStrength))) : 0.55);
    // v0.9.254 (Nutzer-Bug #4) — etwas größerer vertikaler Schatten-Offset, damit der
    // Schatten auch bei geringer Weichheit (Blur) unter der Box hervorlugt. Vorher klebte
    // er bei 2px Offset hinter der opaken Box → die Stärke (Deckkraft) war unsichtbar,
    // bis man die Weichheit hochzog.
    var shOffY = Math.round(4 * dpr);

    // Stil-Defaults für Box-Füllung + auf welcher Fläche der Text sitzt.
    var boxFill, textSurface, decoration;
    if (style === "banner") { boxFill = accent; textSurface = accent; decoration = "poles"; }
    else if (style === "signpost") { boxFill = accent; textSurface = accent; decoration = "post"; }
    else if (style === "pin") { boxFill = "#15171c"; textSurface = "#15171c"; decoration = "pin"; }
    else if (style === "plain") { boxFill = accent; textSurface = accent; decoration = "none"; }
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
    var innerW = Math.max(maxw, imgW);
    var boxW = innerW + pad * 2 + arrowW;
    var boxH = (hasImg ? imgH + imgGap : 0) + textH + pad * 2;
    // Dekorations-Höhe unter der Box
    var decoH = 0, poleH = 0, postH = 0, tailH = 0, pinR = 0, pinGap = 0, pinTipH = 0;
    var decoScale = (o.decoScale != null && !isNaN(Number(o.decoScale))) ? Math.max(0.1, Math.min(2, Number(o.decoScale))) : 0.5;
    if (decoration === "poles") { poleH = Math.round(boxH * decoScale); decoH = poleH; }
    else if (decoration === "post") { postH = Math.round(boxH * decoScale); decoH = postH; }
    else if (decoration === "tail") { tailH = 8 * dpr; decoH = tailH; }
    else if (decoration === "pin") { pinR = Math.max(10 * dpr, fs * 0.42); pinGap = 7 * dpr; pinTipH = 16 * dpr; decoH = pinGap + pinR * 2 + pinTipH; }

    // Schatten-Rand (damit der Blur nicht abgeschnitten wird) — unten knapp,
    // damit die Anker-Spitze möglichst am Bildrand bleibt.
    var shPad = shadow ? Math.ceil(shadowBlur + 3 * dpr) : 0;
    // v0.9.254 — untere Marge muss den (größeren) Offset + halben Blur fassen, sonst
    // wird der nach unten versetzte Schatten am Canvas-Rand abgeschnitten.
    var ml = shPad, mt = shPad, mr = shPad, mb = shadow ? Math.ceil(shadowBlur * 0.5 + shOffY) : 0;

    var contentW = Math.max(boxW, pinR * 2);
    var W = contentW + ml + mr;
    var H = boxH + decoH + mt + mb;

    var c = document.createElement("canvas");
    c.width = Math.max(2, Math.ceil(W));
    c.height = Math.max(2, Math.ceil(H));
    var ctx = c.getContext("2d");
    ctx.font = FONT;
    ctx.textBaseline = "middle";

    // Box-Ursprung (zentriert horizontal im Content-Bereich)
    var bx = ml + (contentW - boxW) / 2;
    var by = mt;

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
        ctx.shadowOffsetX = 0;
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
      // Tropfen unten (Akzent)
      var cx = ml + contentW / 2;
      var cyc = by + boxH + pinGap + pinR;
      var tipY = H - mb;
      setShadow(true);
      ctx.beginPath();
      ctx.moveTo(cx, tipY);
      ctx.quadraticCurveTo(cx - pinR * 1.25, cyc + pinR * 0.35, cx - pinR, cyc);
      ctx.arc(cx, cyc, pinR, Math.PI, 0, false);
      ctx.quadraticCurveTo(cx + pinR * 1.25, cyc + pinR * 0.35, cx, tipY);
      ctx.closePath();
      // v0.9.270 — Tropfen folgt dem Hintergrund (boxFill), nicht mehr einer separaten
      // „Akzentfarbe". Bei transparenter Box ein dezentes Dunkel als Fallback, damit der
      // Tropfen sichtbar bleibt.
      ctx.fillStyle = boxTransparent ? "#15171c" : boxFill; ctx.fill();
      setShadow(false);
      ctx.lineWidth = 2 * dpr; ctx.strokeStyle = "#fff"; ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cyc, pinR * 0.42, 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill();
    } else {
      rr(bx, by, boxW, boxH, radius); if (!boxTransparent) ctx.fill();
      setShadow(false);
      if (borderW > 0 && borderC) { ctx.lineWidth = borderW; ctx.strokeStyle = borderC; rr(bx + borderW / 2, by + borderW / 2, boxW - borderW, boxH - borderW, radius); ctx.stroke(); }
      if (decoration === "tail" && !boxTransparent) {
        var tcx = ml + contentW / 2;
        ctx.beginPath();
        ctx.moveTo(tcx - 7 * dpr, by + boxH - 0.5);
        ctx.lineTo(tcx + 7 * dpr, by + boxH - 0.5);
        ctx.lineTo(tcx, by + boxH + tailH);
        ctx.closePath();
        ctx.fillStyle = boxFill; ctx.fill();
      }
    }

    // ── Bild (oben in der Box, cover-fit, abgerundet) ───────────────────
    if (hasImg) {
      setShadow(false);
      var ix = bx + pad + contentDX, iy = by + pad;
      var iwd = boxW - arrowW - pad * 2, ihd = imgH;
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
      setShadow(false);
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
      for (var k = 0; k < lines.length; k++) {
        ctx.fillText(lines[k], tx, ty0 + k * lineH);
      }
    }

    return { data: ctx.getImageData(0, 0, c.width, c.height), dpr: dpr };
  }

  // ── Pro-Frame: Sichtbarkeits-Fenster + Einblend-Animation ──────────────
  // metas[i] = { a_show, a_hide, fade, pop } (alles in Anchor-Einheiten 0..1).
  // M = aktuelle Marker-Position auf dem Track (0..1).
  // Sichtbarkeit via setFilter (Fenster), Fade/Pop via feature-state (op/scale).
  function rzSignApplyFrame(map, lyr, src, metas, M) {
    if (!map || !map.getLayer || !map.getLayer(lyr)) return;
    try {
      map.setFilter(lyr, ["all", ["<=", ["get", "a_show"], M], [">=", ["get", "a_hide"], M]]);
    } catch (_) {}
    if (!Array.isArray(metas)) return;
    for (var i = 0; i < metas.length; i++) {
      var m = metas[i] || {};
      var op = 1;
      // Fade (Ein-/Ausblenden) über icon-opacity = PAINT-Property → feature-state erlaubt.
      // (icon-size ist LAYOUT → dort ist feature-state NICHT erlaubt, daher kein Scale-Pop.)
      if (m.fade > 0) {
        op = Math.min((M - m.a_show) / m.fade, (m.a_hide - M) / m.fade, 1);
        op = Math.max(0, Math.min(1, op));
      }
      try { map.setFeatureState({ source: src, id: i }, { op: op }); } catch (_) {}
    }
  }

  // Sekunden → Anchor-Bruchteil (Marker läuft in `durationSec` über den Track).
  function rzSignSecToAnchor(sec, durationSec) {
    var d = Number(durationSec) || 12;
    return (Number(sec) || 0) / d;
  }

  // Aus einem Schild-Objekt + Track-Anchor + Animationsdauer die Frame-Meta bauen.
  function rzSignMeta(sign, durationSec) {
    // „Ganze Zeit anzeigen" → von Anfang bis Ende sichtbar, kein Timing-Fenster.
    if (sign.alwaysVisible) return { a_show: -1, a_hide: 2, fade: 0, pop: 0 };
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
    // Fade nutzt icon-opacity (paint, feature-state-fähig). „pop"/„both" werden
    // aktuell als Fade umgesetzt (Scale-Pop bräuchte feature-state auf icon-size
    // = LAYOUT, was Mapbox nicht erlaubt).
    var fadeSpan = (entry === "fade" || entry === "pop" || entry === "both")
      ? rzSignSecToAnchor(0.6, durationSec) : 0;
    return { a_show: aShow, a_hide: aHide, fade: fadeSpan, pop: 0 };
  }

  if (typeof window !== "undefined") {
    window.__rzDrawSign = rzDrawSign;
    window.__rzSignFrame = rzSignApplyFrame;
    window.__rzSignMeta = rzSignMeta;
  }
  if (typeof globalThis !== "undefined") {
    globalThis.__rzDrawSign = rzDrawSign;
    globalThis.__rzSignFrame = rzSignApplyFrame;
    globalThis.__rzSignMeta = rzSignMeta;
  }
})();
