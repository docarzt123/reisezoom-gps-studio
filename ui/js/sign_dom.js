/* sign_dom.js — DOM/CSS-Schild-Engine (v0.9.255)
 * ------------------------------------------------------------------
 * Ersetzt das frühere Canvas→addImage-Rastern (sign_draw.js → __rzDrawSign).
 * Ein Schild ist jetzt ein echtes HTML-Element in einem mapboxgl.Marker.
 * Größe/Ecken/Rahmen/Schatten/Text = reine CSS-/Content-Updates am stehenden
 * Element → KEIN Neu-Rastern, KEIN Hochladen, KEIN Flackern (Nutzer-/Marc-Bug).
 *
 * GLEICHE Engine in Vorschau (modules/animator) UND Render (core/animator.py,
 * headless Playwright) → garantiertes WYSIWYG. Playwright-Screenshots fangen die
 * DOM-Marker mit ab.
 *
 * Öffentliche API (window.__rzSignDom*):
 *   __rzSignDomInjectCss()        — einmalig <style> einhängen
 *   __rzSignDomBuild()            — leeres Schild-Element bauen (div.rz-sign)
 *   __rzSignDomStyle(el, o)       — Aussehen + Inhalt anwenden (idempotent → Live-Update)
 *   __rzSignDomZoomScale(zoom, on)— Skalierungsfaktor für „mit Zoom wachsen"
 *
 * Timing (__rzSignMeta) bleibt in sign_draw.js und wird weiter genutzt.
 */
(function () {
  function hexToRgb(hex) {
    var h = String(hex || "").replace("#", "");
    if (h.length === 3) h = h.split("").map(function (x) { return x + x; }).join("");
    return { r: parseInt(h.slice(0, 2), 16) || 0, g: parseInt(h.slice(2, 4), 16) || 0, b: parseInt(h.slice(4, 6), 16) || 0 };
  }
  function lum(hex) { var c = hexToRgb(hex); return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255; }
  function rgba(hex, a) { var c = hexToRgb(hex); return "rgba(" + c.r + "," + c.g + "," + c.b + "," + a + ")"; }
  function ink(surfaceHex) { return lum(surfaceHex) > 0.62 ? "#15171c" : "#ffffff"; }
  function fontStack(key) {
    switch (key) {
      case "rounded":   return "ui-rounded, 'SF Pro Rounded', 'Hiragino Maru Gothic ProN', 'Varela Round', system-ui, sans-serif";
      case "serif":     return "Georgia, 'Iowan Old Style', 'Times New Roman', serif";
      case "mono":      return "ui-monospace, Menlo, 'SF Mono', Consolas, monospace";
      case "condensed": return "'Arial Narrow', 'Roboto Condensed', 'Helvetica Neue', system-ui, sans-serif";
      case "impact":    return "Impact, Haettenschweiler, 'Arial Black', system-ui, sans-serif";
      default:          return "-apple-system, system-ui, 'Segoe UI', Roboto, sans-serif";
    }
  }

  // ── CSS einmalig einhängen ───────────────────────────────────────────────
  // Dekorationen (Sprechblasen-Pfeil, Banner-Pfosten, Stecknadel, Wegweiser)
  // als CSS-Formen via Pseudo-Elementen. Dynamische Werte kommen über CSS-Vars
  // (--rz-accent, --rz-box, --rz-tail) aus __rzSignDomStyle.
  var CSS = `
/* WICHTIG: KEIN position am Wrapper — Mapbox/MapLibre setzt am Marker-Element
   .mapboxgl-marker { position:absolute } + transform:translate(...) für die
   Positionierung. Ein eigenes position:relative würde das überschreiben und das
   Schild landet an der falschen Stelle. Dekorationen hängen am inneren .rz-sign. */
.rz-sign-wrap { will-change: transform, opacity; pointer-events: auto; line-height: 0; }
.rz-sign {
  position: relative; display: inline-flex; flex-direction: column; align-items: stretch;
  box-sizing: border-box; line-height: 1.2; text-rendering: geometricPrecision;
  -webkit-font-smoothing: antialiased; user-select: none;
  background: var(--rz-box, #15171c); color: #fff;
}
.rz-sign__img { display: block; width: 100%; height: auto; object-fit: cover; }
.rz-sign__cap { white-space: pre-line; overflow-wrap: anywhere; }
/* Sprechblase: Schwänzchen unten Mitte */
.rz-sign--callout::after {
  content: ""; position: absolute; left: 50%; bottom: -7px; transform: translateX(-50%);
  border-left: 7px solid transparent; border-right: 7px solid transparent;
  border-top: 8px solid var(--rz-box, #15171c);
}
/* Stecknadel: Tropfen (Akzent) unter der Box */
.rz-sign--pin .rz-sign__pin {
  position: absolute; left: 50%; top: 100%; transform: translateX(-50%);
  width: var(--rz-pin, 22px); height: calc(var(--rz-pin, 22px) * 1.5); margin-top: 6px;
}
.rz-sign--pin .rz-sign__pin svg { display: block; width: 100%; height: 100%; }
/* Banner: zwei Pfosten unten */
.rz-sign--banner .rz-sign__poles, .rz-sign--signpost .rz-sign__poles {
  position: absolute; left: 0; top: 100%; width: 100%; height: 0; pointer-events: none;
}
.rz-sign--banner .rz-sign__poles::before, .rz-sign--banner .rz-sign__poles::after {
  content: ""; position: absolute; top: -2px; width: 4px; height: var(--rz-pole, 40px); background: #454b54;
}
.rz-sign--banner .rz-sign__poles::before { left: 5px; }
.rz-sign--banner .rz-sign__poles::after { right: 5px; }
.rz-sign--signpost .rz-sign__poles::before {
  content: ""; position: absolute; top: -2px; left: 50%; transform: translateX(-50%);
  width: 5px; height: var(--rz-post, 55px); background: #5a4632;
}
/* Wegweiser-Pfeilspitze (v0.9.387) — externe Spitze, Richtung per Modifier-Klasse */
.rz-sign__arrow {
  position: absolute; top: 0; height: 100%; width: var(--rz-arrow, 13px);
  background: var(--rz-box, #15171c); pointer-events: none;
}
.rz-sign--dir-right .rz-sign__arrow { left: calc(100% - 1px); clip-path: polygon(0 0, 100% 50%, 0 100%); }
.rz-sign--dir-left  .rz-sign__arrow { right: calc(100% - 1px); clip-path: polygon(100% 0, 0 50%, 100% 100%); }
`;
  function injectCss() {
    try {
      if (typeof document === "undefined") return;
      if (document.getElementById("rz-sign-dom-css")) return;
      var st = document.createElement("style");
      st.id = "rz-sign-dom-css";
      st.textContent = CSS;
      (document.head || document.documentElement).appendChild(st);
    } catch (_) {}
  }

  // ── Element bauen (leeres Grundgerüst) ───────────────────────────────────
  function build() {
    injectCss();
    var wrap = document.createElement("div");
    wrap.className = "rz-sign-wrap";
    var card = document.createElement("div");
    card.className = "rz-sign";
    var img = document.createElement("img");
    img.className = "rz-sign__img";
    img.alt = "";
    img.draggable = false;
    var cap = document.createElement("div");
    cap.className = "rz-sign__cap";
    card.appendChild(img);
    card.appendChild(cap);
    wrap.appendChild(card);
    // transiente Refs (nicht serialisiert)
    wrap.__card = card; wrap.__img = img; wrap.__cap = cap;
    return wrap;
  }

  // ── Stil + Inhalt anwenden (idempotent → flackerfreies Live-Update) ──────
  // `o` = normalisiertes Schild-Objekt (gleiche Felder wie sign_draw.js erwartet).
  // `scale` = zusätzlicher Pixel-Faktor (Render skaliert relativ zur Videohöhe;
  //           Vorschau nutzt 1). imageEl optional vorgeladenes HTMLImageElement/Url.
  function style(wrap, o, opts) {
    o = o || {}; opts = opts || {};
    var card = wrap.__card, img = wrap.__img, cap = wrap.__cap;
    if (!card) return;
    var unit = Number(opts.scale) || 1;                 // px-Multiplikator
    var px = function (v) { return (Number(v) * unit) + "px"; };

    var styleName = o.style || "callout";
    var accent = o.color || "#ff6b35";
    var boxFill;
    if (styleName === "banner" || styleName === "signpost" || styleName === "plain") boxFill = accent;
    else boxFill = "#15171c"; // callout / pin
    // v0.9.269 (Nutzer) — bg === "none": Box transparent (kein farbiger „Akzent-Rahmen"
    // ums Bild, kein Box-Schatten). Nur der optionale Rahmen bleibt → kein doppelter Rahmen.
    var boxTransparent = (o.bg === "none");
    if (o.bg && o.bg !== "auto" && o.bg !== "none") boxFill = o.bg;
    var textColor = (o.textColor && o.textColor !== "auto") ? o.textColor : ink(boxTransparent ? "#15171c" : boxFill);

    var radius = (o.radius != null ? Number(o.radius) : 9);
    var pad = (o.padding != null ? Number(o.padding) : 7);
    var borderW = (o.borderWidth != null ? Number(o.borderWidth) : 0);
    var borderC = (o.borderColor && o.borderColor !== "none") ? o.borderColor : null;
    var opacity = (o.opacity != null ? Math.max(0, Math.min(1, Number(o.opacity))) : 1);

    // Klassen (Stil-Dekoration)
    card.className = "rz-sign rz-sign--" + styleName;
    card.style.transformOrigin = "bottom center";   // für die Zoom-Skalierung (am Anker unten)
    card.style.setProperty("--rz-box", boxTransparent ? "transparent" : boxFill);
    card.style.setProperty("--rz-accent", accent);
    card.style.background = boxTransparent ? "transparent" : boxFill;
    card.style.color = textColor;
    card.style.borderRadius = px(radius);
    card.style.padding = px(pad);
    card.style.border = (borderW > 0 && borderC) ? (px(borderW) + " solid " + borderC) : "none";
    card.style.opacity = String(opacity);
    card.style.fontFamily = fontStack(o.font);
    card.style.fontWeight = String(Number(o.weight) || 700);
    card.style.fontStyle = o.italic ? "italic" : "normal";
    card.style.fontSize = px(Math.max(8, Number(o.size) || 40));
    var align = o.align || "center";
    card.style.textAlign = align;
    card.style.alignItems = (align === "left") ? "flex-start" : (align === "right" ? "flex-end" : "center");

    // Schatten (bei transparenter Box kein Box-Schatten — nichts, was ihn werfen könnte)
    if (o.shadow && !boxTransparent) {
      var sBlur = (o.shadowBlur != null ? Number(o.shadowBlur) : 8);
      var sStr = (o.shadowStrength != null ? Math.max(0.05, Math.min(1, Number(o.shadowStrength))) : 0.55);
      var sC = o.shadowColor || "#000000";
      card.style.boxShadow = "0 " + px(Math.max(2, sBlur * 0.35)) + " " + px(sBlur) + " " + rgba(sC, sStr);
    } else {
      card.style.boxShadow = "none";
    }

    // Bild
    var src = opts.imageUrl || (o.image && o.image.src) || o.thumb || "";
    if (o.imageSrc || src) {
      var imgW = Math.max(80, (Number(o.imageSize) || 60) * 5);
      img.style.display = "block";
      img.style.width = px(imgW);
      img.style.borderRadius = px(Math.max(0, radius - pad * 0.5));
      img.style.marginBottom = ((o.text || "").trim() ? px(Math.round(pad * 0.7)) : "0");
      if (src && img.getAttribute("src") !== src) img.setAttribute("src", src);
    } else {
      img.style.display = "none";
      if (img.getAttribute("src")) img.removeAttribute("src");
    }

    // Text (= Bildunterschrift wenn Bild da)
    var text = String(o.text == null ? "" : o.text);
    if (text.trim()) { cap.style.display = "block"; if (cap.textContent !== text) cap.textContent = text; }
    else { cap.style.display = "none"; cap.textContent = ""; }

    // ── Dekorationen + Anker ─────────────────────────────────────────────
    // Box-Höhe messen, sobald das Element im DOM hängt (für proportionale Stangen
    // wie im Canvas: Banner-Pfosten = 0.8×Box, Wegweiser-Pfosten = 1.1×Box). Solange
    // noch nicht gemessen werden kann (Build vor addTo), grob aus Schrift/Bild schätzen.
    var boxH = 0;
    try { boxH = card.offsetHeight || 0; } catch (_) {}
    if (!boxH) {
      var fsEst = Math.max(8, Number(o.size) || 40) * unit;
      var nLines = String(o.text || "").split("\n").length;
      boxH = ((o.text || "").trim() ? fsEst * 1.2 * nLines : 0) + pad * 2 * unit;
      if (o.imageSrc || src) boxH += Math.max(80, (Number(o.imageSize) || 60) * 5) * unit * 0.66;
    }
    // v0.9.256 — Stangen-Länge per Schild einstellbar (Faktor der Box-Höhe). Default 0.5.
    var decoScale = (o.decoScale != null && !isNaN(Number(o.decoScale))) ? Math.max(0.1, Math.min(2, Number(o.decoScale))) : 0.5;
    var poleLen = Math.round(boxH * decoScale);
    var postLen = Math.round(boxH * decoScale);
    var tailH = Math.round(8 * unit);
    card.style.setProperty("--rz-pole", poleLen + "px");
    card.style.setProperty("--rz-post", postLen + "px");

    // Stecknadel-Tropfen (Akzentfarbe) als eigenes SVG-Element
    var pin = card.querySelector(".rz-sign__pin");
    var poles = card.querySelector(".rz-sign__poles");
    var pinGap = Math.round(6 * unit);
    var pinW = Math.round(22 * unit);
    var pinH = Math.round(pinW * 1.5);
    var below = 0;   // wie weit die Dekoration UNTER die Box reicht (für den Anker)
    // v0.9.387 — Wegweiser-Richtungspfeil nur beim signpost; bei anderen Stilen entfernen.
    if (styleName !== "signpost") { var _oa = card.querySelector(".rz-sign__arrow"); if (_oa) _oa.remove(); }
    if (styleName === "pin") {
      if (!pin) {
        pin = document.createElement("div"); pin.className = "rz-sign__pin";
        pin.innerHTML = '<svg viewBox="0 0 24 36"><path d="M12 36 C4 22 0 16 0 11 A12 12 0 0 1 24 11 C24 16 20 22 12 36 Z" fill="var(--rz-box, #15171c)" stroke="#fff" stroke-width="2"/><circle cx="12" cy="11" r="5" fill="#fff"/></svg>';
        card.appendChild(pin);
      }
      card.style.setProperty("--rz-pin", pinW + "px");
      if (poles) poles.remove();
      below = pinGap + pinH;
    } else if (styleName === "banner") {
      if (pin) pin.remove();
      if (!poles) { poles = document.createElement("div"); poles.className = "rz-sign__poles"; card.appendChild(poles); }
      below = poleLen;
    } else if (styleName === "signpost") {
      if (pin) pin.remove();
      if (!poles) { poles = document.createElement("div"); poles.className = "rz-sign__poles"; card.appendChild(poles); }
      // v0.9.387 — Richtungs-Pfeil (externe Spitze) + Modifier-Klasse
      var arrow = card.querySelector(".rz-sign__arrow");
      if (!arrow) { arrow = document.createElement("div"); arrow.className = "rz-sign__arrow"; card.appendChild(arrow); }
      var sdir = (o.direction === "left") ? "left" : "right";
      card.classList.remove("rz-sign--dir-" + (sdir === "left" ? "right" : "left"));
      card.classList.add("rz-sign--dir-" + sdir);
      card.style.setProperty("--rz-arrow", Math.max(6, Math.round(13 * unit)) + "px");
      below = postLen;
    } else {
      if (pin) pin.remove();
      if (poles) poles.remove();
      if (styleName === "callout") below = tailH;   // Sprechblasen-Spitze
    }

    // Anker-Reservierung: das Marker-Element ist „bottom"-verankert (Unterkante am
    // Geo-Punkt). Damit die Dekoration (Spitze/Pfosten) UNTER der Box sichtbar bleibt
    // und ihre Spitze am Punkt sitzt (wie im Canvas), unten so viel Platz reservieren,
    // wie die Dekoration nach unten reicht. Ohne das verschwand z.B. die Sprechblasen-
    // Spitze „unter" dem Anker.
    wrap.style.paddingBottom = below ? (below + "px") : "0px";

    wrap.style.opacity = "1"; // Sichtbarkeits-Opacity steuert der Frame-Loop separat
  }

  // „Mit Zoom wachsen" — gleiche Stützpunkte wie die alte icon-size-Interpolation.
  function zoomScale(zoom, on) {
    if (!on) return 1;
    var z = Number(zoom) || 12;
    var pts = [[8, 0.5], [12, 0.8], [16, 1.5], [20, 2.4]];
    if (z <= pts[0][0]) return pts[0][1];
    if (z >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
    for (var i = 0; i < pts.length - 1; i++) {
      if (z >= pts[i][0] && z <= pts[i + 1][0]) {
        var t = (z - pts[i][0]) / (pts[i + 1][0] - pts[i][0]);
        return pts[i][1] + t * (pts[i + 1][1] - pts[i][1]);
      }
    }
    return 1;
  }

  var api = { injectCss: injectCss, build: build, style: style, zoomScale: zoomScale };
  if (typeof window !== "undefined") {
    window.__rzSignDomInjectCss = injectCss;
    window.__rzSignDomBuild = build;
    window.__rzSignDomStyle = style;
    window.__rzSignDomZoomScale = zoomScale;
    window.__rzSignDom = api;
  }
  if (typeof globalThis !== "undefined") { globalThis.__rzSignDom = api; }
})();
