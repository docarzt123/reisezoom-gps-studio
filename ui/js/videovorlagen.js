/* videovorlagen.js — zehn Videovorlagen aus ganz normalen Einblendungen (01.11.2026)
 *
 * Marc: „Bau die alle ein … bau alles so um, dass man sich das alles so in der Art bauen kann“ und „unser Editor muss so
 * sein, dass wir damit all die Vorlagen bauen können … alles universell einstellbar“. Deshalb ist eine Vorlage hier
 * nur eine LISTE von Einblendungen (ui/js/container.js) plus Linienfarben — dieselben Bausteine, die der Editor im
 * Animator anbietet (Gestaltung je Zeile, Akzentkante, Formen, Drehung, Fortschritt, Ring, am Laufpunkt …). Nach dem
 * Anwenden gehört alles dem Projekt und ist einzeln änderbar.
 *
 * Drei Filmphasen: Titel (Anfang), Unterwegs, Abschluss — als Zeiträume der Einblendungen.
 * Maße stammen aus einer Referenz von 1600 × 900; umgerechnet über die kurze Bildseite, damit Hoch- und Querformat
 * dieselben Proportionen haben. Fehlende Daten werden nicht erfunden: ohne Höhen zeigt das Profil den Fortschritt der
 * Strecke, Höhenwerte haben ein Ersatzfeld.
 *
 *   rzVideoVorlagen.LISTE                      → [{ id, name, kurz, palette }]
 *   rzVideoVorlagen.bauen(id, ctx)             → { container, verlauf, animator }
 *     ctx = { titel, unter, kicker, format: "16:9"|"9:16"|"1:1", intro_s, hold_s, t(key, fallback),
 *             logo: { an, anker } }
 */
(function () {
  "use strict";
  const FORMAT = { "16:9": [16, 9], "9:16": [9, 16], "1:1": [1, 1], "4:5": [4, 5], "4:3": [4, 3], "21:9": [21, 9] };
  const PAPIER = "#f4f1e9", TINTE = "#15242b";

  const LISTE = [
    { id: "fernweh", nr: "01", name: "Fernweh", palette: { route: "#ff896b", rest: "#f4f1e9", kante: "#17292d", breite: 5, akzent: "#ff896b" } },
    { id: "klartext", nr: "02", name: "Klartext", palette: { route: "#f4f1e9", rest: "#abb9c0", kante: "#14242d", breite: 4, akzent: "#f4f1e9" } },
    { id: "randnotiz", nr: "03", name: "Randnotiz", palette: { route: "#48d6c4", rest: "#f4f1e9", kante: "#18362f", breite: 5, akzent: "#48d6c4" } },
    { id: "unterwegs", nr: "04", name: "Unterwegs", palette: { route: "#ffd06b", rest: "#f4f1e9", kante: "#2e2920", breite: 5.5, akzent: "#ffd06b" } },
    { id: "feldbuch", nr: "05", name: "Feldbuch", palette: { route: "#e9ae76", rest: "#f2e8d4", kante: "#38291f", breite: 5, akzent: "#e9ae76" } },
    { id: "vorwaerts", nr: "06", name: "Vorwärts", palette: { route: "#c5f45d", rest: "#f4f1e9", kante: "#1b2b25", breite: 7, akzent: "#c5f45d" } },
    { id: "wegweiser", nr: "07", name: "Wegweiser", palette: { route: "#67d9f0", rest: "#f4f1e9", kante: "#133341", breite: 6, akzent: "#67d9f0" } },
    { id: "kino", nr: "08", name: "Kino", palette: { route: "#eacb82", rest: "#d7d2c8", kante: "#272a25", breite: 4.5, akzent: "#eacb82" } },
    { id: "reiseplakat", nr: "09", name: "Reiseplakat", palette: { route: "#b7a1ff", rest: "#f4f1e9", kante: "#27213b", breite: 6, akzent: "#b7a1ff" } },
    { id: "lichtglas", nr: "10", name: "Lichtglas", palette: { route: "#81e8ef", rest: "#e6f4f1", kante: "#14313b", breite: 5.5, akzent: "#81e8ef" } },
  ];

  /** Was eine Vorlage von Haus aus zeigt (für die Schalter des Assistenten beim Wählen). */
  function standard(id) {
    const r = bauen(id, {});
    return r ? { profil: r.container.some(c => c.vorlage === "hoehe"), uebersicht: r.container.some(c => c.vorlage === "uebersicht") } : { profil: false, uebersicht: false };
  }
  function bauen(id, ctx) {
    const C = window.rzContainer;
    if (!C) return null;
    const V = LISTE.find(v => v.id === id) || LISTE[0];
    ctx = ctx || {};
    const T = typeof ctx.t === "function" ? ctx.t : (k, d) => d;
    const [fw, fh] = FORMAT[ctx.format] || FORMAT["16:9"];
    const kurz = Math.min(fw, fh);
    // Referenz-Pixel (1600 × 900) → % der Breite / Höhe / Schrift in % der kurzen Seite
    const X = (px) => Math.round(px / 900 * kurz / fw * 100 * 1000) / 1000;
    const Y = (px) => Math.round(px / 900 * kurz / fh * 100 * 1000) / 1000;
    const F = (px) => Math.round(px / 9 * 1000) / 1000;
    const hoch = fh > fw;
    const P = V.palette, AK = P.akzent;
    const introS = Math.max(0, +ctx.intro_s || 0), holdS = Math.max(0, +ctx.hold_s || 0);
    const T1 = Math.max(introS, 3), E = Math.max(2.5, holdS - 1);
    const Z = {
      titel: { von: { art: "video_start", wert: 0 }, bis: { art: "video_start", wert: T1 } },
      live: { von: { art: "video_start", wert: T1 }, bis: { art: "video_ende", wert: E } },
      ende: { von: { art: "video_ende", wert: E }, bis: null },
    };
    const BL = {
      titel: { ein: "hoch", aus: "fade", ein_s: 0.7, aus_s: 0.4 },
      live: { ein: "fade", aus: "fade", ein_s: 0.5, aus_s: 0.4 },
      ende: { ein: "hoch", aus: "none", ein_s: 0.7, aus_s: 0.4 },
    };
    const titel = String(ctx.titel || T("container.v.titel_text", "Meine Tour"));
    const unter = String(ctx.unter || "");
    const kicker = String(ctx.kicker || "").toUpperCase();
    const txt = (text, o) => C.zeile("text", Object.assign({ text }, o || {}));
    const wert = (feld, bezug, o) => C.wert(feld, bezug, o || {});
    // Grundeinblendung: ohne Kasten, warmweiß, Manrope, weicher Textschatten, Lage fest (nie automatisch stapeln)
    // 01.11.2026 (Marc: „… teilweise nicht lesen … vielleicht eine Kontur … oder ein Schlagschatten“) — Text, der direkt auf
    // der Karte liegt, bekommt Schatten + Kontur (dunkel, automatisch); Einblendungen mit eigener Fläche keinen
    const box = (o) => C.normalisieren(Object.assign({
      textschutz: (o && (o.textschatten === false || +o.hg_deckkraft > 0.5)) ? "aus" : "beides", textschutz_st: 0.85,
      stil: "eigen", hg_deckkraft: 0, innen: 0, ecken: 0, schatten: false, textschatten: true, unschaerfe: false, rahmen_b: 0,
      gross: true, schrift: "manrope", schrift_fest: true, textfarbe: PAPIER, akzent: AK, lage_fest: true,
      beschriftung: "oben", anordnung: "unter", zeilenabstand: 0, spaltenabstand: 1, beschr_faktor: 0.3, einheit_faktor: 0.45,
      look_fest: true, vorlage: "vv",
    }, o));
    const liste = [];
    const dazu = (c) => { if (c) liste.push(c); return c; };

    // ── Logo statt „GPS STUDIO“ in der Kopfzeile (Marc: in allen Vorlagen an) + Kontext rechts ──
    const logoAn = !ctx.logo || ctx.logo.an !== false;
    const kopf = (o) => {
      o = o || {};
      if (logoAn) {
        // dunkles Logo im Papierband bleibt dort (auf der Karte wäre es unsichtbar)
        const an = o.dunkel ? "tl" : (ctx.logo && ctx.logo.anker) || o.logoAnker || "tl";
        dazu(box({ name: T("container.v.logo", "Logo"), vorlage: "logo", anker: an, x: an[1] === "c" ? 0 : X(o.lx == null ? 60 : o.lx), y: Y(o.ly == null ? 34 : o.ly),
          deckkraft: o.logoDeck || 0.95, textschatten: false, zeilen: [C.zeile("bild", { pfad: o.dunkel ? "@lockup-dark" : "@lockup-white", b: Math.round(X(o.lb || 150) * 100) / 100 })] }));
      }
      if (kicker && o.kicker !== false && !(logoAn && ctx.logo && ctx.logo.anker === "tr")) {
        dazu(box({ name: T("vv.kopfzeile", "Kopfzeile"), vorlage: "kopf", anker: "tr", x: X(60), y: Y(o.ky == null ? 37 : o.ky), schriftgroesse: F(o.kpx || 12),
          gewicht: 600, sperrung: o.ksp == null ? 0.25 : o.ksp, textfarbe: o.kfarbe || PAPIER, zeilen: [txt(kicker)] }));
      }
    };
    // ── Titelblock: Kicker, Titel, Unterzeile, Phasen-Hinweis (Gestaltung je Zeile) ──
    const titelBlock = (phase, o) => {
      const h1 = o.h1;
      const zeilen = [];
      const kick = phase === "ende" ? T("vv.geschafft", "Geschafft").toUpperCase() : kicker;
      if (kick && o.kicker !== false) zeilen.push(txt(kick, Object.assign({ gr: (o.kpx || 13) / h1, gewicht: 650, sperrung: o.ksp == null ? 0.24 : o.ksp, schrift: o.ktext || "manrope",
        farbe: o.kfarbe || null, dy: 0 }, o.kzeile || {})));
      zeilen.push(txt(titel, Object.assign({ gewicht: o.gew || 650, sperrung: o.sp == null ? -0.025 : o.sp, zh: o.zh || 1.02 }, o.h1zeile || {})));
      if (o.balken) zeilen.push(C.zeile("linie", { b: X(o.balken[0]), h: Y(o.balken[1]), dy: Y(o.balken[2] || 0) }));
      if (unter && phase !== "live" && o.unter !== false) zeilen.push(txt(unter, Object.assign({ gr: (o.upx || 19) / h1, gewicht: 400, sperrung: o.usp || 0, zh: 1.5, schrift: o.utext || "manrope",
        farbe: o.ufarbe || "#d2e0dd", versal: false }, o.uzeile || {})));
      if (o.phase) zeilen.push(txt({ titel: T("vv.phase.titel", "Der Anfang"), live: T("vv.phase.live", "Unterwegs"), ende: T("vv.phase.ende", "Geschafft") }[phase].toUpperCase(),
        Object.assign({ gr: (o.ppx || 11) / h1, gewicht: 600, sperrung: 0.27, farbe: o.pfarbe || AK, schrift: "manrope", kursiv: false }, o.pzeile || {})));
      // 03.11.2026 (Befund der iPhone-App: lange Titel liefen über Papierband, Notiz und Übersichtskarte) — Höchstbreite:
      // rechts bleibt Platz für Übersichtskarte, Ring oder Konturzahl; mittig gesetzte Titel halten zu beiden Seiten Abstand
      const lage = Object.assign({ anker: "tl", x: X(65) }, o.box || {});
      const maxB = lage.max_b != null ? lage.max_b : Math.max(20, lage.anker[1] === "c" ? 100 - 2 * X(65) : 100 - (+lage.x || 0) - X(280));
      return box(Object.assign({ name: T("container.v.titel", "Titel") + " · " + T("vv.phase." + phase, phase), vorlage: phase === "ende" ? "schluss" : "titel",
        anker: "tl", x: X(65), y: Y(100), schriftgroesse: F(h1), zeilenabstand: 0.12, zeit: Z[phase], blende: BL[phase],
        gross: false, schrift: o.schrift || "manrope", textfarbe: o.farbe || PAPIER }, o.box || {}, { max_b: Math.round(maxB * 100) / 100, zeilen }));
    };
    // ── Kennzahlen je Phase (Ersatzfelder statt erfundener Werte) ──
    // 01.11.2026 (Marc: „es müssen alle Möglichkeiten in dem Stil gehen“) — die Werte der Schlusskarte folgen der Auswahl
    // (ctx.felder, höchstens vier); ohne Auswahl die der Vorlage
    const endeFelder = Array.isArray(ctx.felder) && ctx.felder.length ? ctx.felder.slice(0, 4) : null;
    const wertZeilen = (phase, o) => phase === "ende"
      ? (endeFelder ? endeFelder.map(f => wert(f, "gesamt")) : [wert("dist_total", "gesamt"), wert("ele_high", "gesamt", { ersatz: "duration" })])
      : [wert("dist_done", "live"), wert("ele_now", "live", { ersatz: "pct_done" }), wert("dist_total", "gesamt")].slice(0, o && o.anzahl ? o.anzahl : 3);
    const werte = (phase, o) => box(Object.assign({ name: T("container.v.live", "Live-Werte") + " · " + T("vv.phase." + phase, phase), vorlage: phase === "ende" ? "schluss_werte" : "live",
      anker: "bl", x: X(65), y: Y(116), schriftgroesse: F(o.px || 40), anordnung: "neben", beschriftung: o.bes || "oben",
      spaltenabstand: (o.gap || 44) / (o.px || 40), beschr_faktor: (o.lpx || 11) / (o.px || 40), einheit_faktor: (o.upx || 18) / (o.px || 40),
      gewicht: o.gew || 650, zeit: Z[phase], blende: BL[phase === "ende" ? "ende" : "live"] }, o.box || {}, { zeilen: wertZeilen(phase, o).map((z, i) => Object.assign(z, (o.zeile && o.zeile(i, z)) || {})) }));
    const profil = (o) => box(Object.assign({ name: T("container.v.hoehe", "Höhenprofil"), vorlage: "hoehe", anker: "bl", x: X(65), y: Y(38), schriftgroesse: F(8),
      zeilenabstand: 0.6, sperrung: 0.2, gewicht: 600, zeit: o.zeit === undefined ? { von: Z.live.von, bis: null } : o.zeit, blende: BL.live,
      zeilen: [C.zeile("diagramm", { art: "hoehe", b: X(o.b || 430), h: Y(o.h || 69), fuellung: false, linienfarbe: o.farbe || AK }),   // gefahrener Teil in der Akzentfarbe (hebt sich ab)
               txt(T("vv.hoehenprofil", "Höhenprofil · GPX").toUpperCase(), { farbe: o.tfarbe || "#b7cdca", gr: 1 })] }, o.box || {}));
    const mini = (o) => box(Object.assign({ name: T("container.v.uebersicht", "Übersichtskarte"), vorlage: "uebersicht", anker: "tr", x: X(60), y: Y(95), schriftgroesse: F(o.cpx || 8),
      inhalt_h: "c", zeilenabstand: 0.6, sperrung: 0.22, gewicht: 600, textfarbe: o.tfarbe || "#d6e5df",
      zeilen: [C.zeile("diagramm", { art: "karte", b: X(o.b || 190), h: Y(o.h || 120), linienfarbe: P.route }), txt(T("vv.deine_strecke", "Deine Strecke").toUpperCase(), { gr: 1 })] }, o.box || {}));
    const ort = (o) => box(Object.assign({ name: T("vv.am_laufpunkt", "Am Laufpunkt"), vorlage: "laufpunkt", lage: "laufpunkt", anker: "tl", x: X(o.dx || 95), y: -Y(o.dy || 95),
      schriftgroesse: F(o.px || 24), kante: o.kante === undefined ? "links" : o.kante, kante_b: 2 / (o.px || 24), kante_farbe: AK, innen: 0, zeilenabstand: 0.18, gross: false,
      zeit: Z.live, blende: BL.live, fuehrung: o.fuehrung !== false, textschutz_st: 1.2,
      zeilen: [].concat(o.klein === false ? [] : [txt(T("vv.hier_sind_wir", "Hier sind wir").toUpperCase(), { gr: (o.kpx || 9) / (o.px || 24), farbe: o.kfarbe || AK, sperrung: 0.22, gewicht: 650, schrift: "manrope", kursiv: false })])
        .concat([C.wert("dist_done", "live", { label_aus: true }), ].map(z => Object.assign(z, o.wert || {})))
        .concat(o.unter === false ? [] : [txt(T("vv.zurueckgelegt", "zurückgelegt"), { gr: (o.upx || 12) / (o.px || 24), farbe: o.ufarbe || "#d4e3e0", gewicht: 450, schrift: o.utext || "manrope", kursiv: false })]) },
      o.box || {}));
    const fortschritt = (o) => box(Object.assign({ name: T("container.z.fortschritt", "Fortschritt"), vorlage: "fortschritt", anker: o.anker || "bl", x: X(60), y: Y(o.y || 56),
      schriftgroesse: F(10), zeit: { von: Z.live.von, bis: null }, blende: BL.live,
      zeilen: [C.zeile("fortschritt", { b: 100 - 2 * X(60), h: Y(o.h || 3), punkt: false, farbe: AK, grund: "#ffffff" })] }, o.box || {}));

    const P_ = {};   // Verlauf je Vorlage
    let verlauf = { oben: { an: false, staerke: 0.5 }, unten: { an: true, staerke: 0.55 }, links: { an: true, staerke: 0.38 } };

    // ── die zehn Vorlagen ──
    if (V.id === "fernweh") {
      kopf();
      const tb = { h1: 105, schrift: "cormorant", gew: 500, sp: -0.027, phase: true };
      dazu(titelBlock("titel", Object.assign({}, tb, { box: { y: Y(210) } })));
      dazu(titelBlock("live", Object.assign({}, tb, { h1: 67, box: { y: Y(90) } })));
      dazu(titelBlock("ende", Object.assign({}, tb, { box: { y: Y(100) } })));
      const w = { px: 51, gap: 40, gew: 500, box: { schrift: "cormorant", trenner: "linie", trenner_deckkraft: 0.31 }, zeile: () => ({ schrift: null }) };
      dazu(werte("live", w)); dazu(werte("ende", w));
      dazu(profil({}));
      dazu(mini({ b: 158, h: 100, box: { y: Y(110) } }));
      dazu(ort({ px: 31, wert: { schrift: "cormorant", gewicht: 600 } }));
    } else if (V.id === "klartext") {
      kopf({ ly: 46, ky: 50, kpx: 10 });
      verlauf = { oben: { an: true, staerke: 0.44 }, unten: { an: true, staerke: 0.67 }, links: { an: false, staerke: 0.4 } };
      const tb = { h1: 57, sp: -0.035, kpx: 11, unter: false, box: { anker: "bl", y: Y(135) } };
      dazu(titelBlock("titel", tb)); dazu(titelBlock("live", Object.assign({}, tb, { box: { anker: "bl", y: Y(143) } }))); dazu(titelBlock("ende", tb));
      const w = { px: 24, gap: 26, lpx: 10, upx: 13, bes: "nach", box: { y: Y(62) } };
      dazu(werte("live", w)); dazu(werte("ende", w));
      dazu(fortschritt({ anker: "tl", y: 32, h: 2 }));
      dazu(ort({ px: 17, kante: "keine", klein: false, unter: false, wert: { gewicht: 600 } }));
    } else if (V.id === "randnotiz") {
      verlauf = { oben: { an: false, staerke: 0.5 }, unten: { an: false, staerke: 0.5 }, links: { an: false, staerke: 0.4 } };
      // helles Papierband links über die ganze Höhe — eine Bildebene, sie verändert weder Karte noch Track
      dazu(box({ name: T("vv.papierband", "Papierband"), vorlage: "flaeche", anker: "tl", x: 0, y: 0, groesse: "fest", b: X(330), h: 100,
        hg_farbe: PAPIER, hg_deckkraft: 1, schatten: true, textschatten: false, zeilen: [], zeit: null, blende: { ein: "links", aus: "none", ein_s: 0.8, aus_s: 0.4 } }));
      kopf({ dunkel: true, lx: 35, ly: 40, lb: 130, kicker: false });
      const tb = { h1: 52, schrift: "cormorant", gew: 600, sp: -0.035, zh: 1, kpx: 9, ksp: 0.16, kfarbe: "#47636a", upx: 13, ufarbe: "#5e777a", phase: true, ppx: 9, pfarbe: "#438a7d",
        farbe: TINTE, box: { x: X(35), y: Y(106), textschatten: false, groesse: "auto", max_b: X(330) - 2 * X(35) } };   // Titel bleibt im Papierband
      dazu(titelBlock("titel", Object.assign({}, tb, { box: Object.assign({}, tb.box, { y: Y(160) }) })));
      dazu(titelBlock("live", tb));
      dazu(titelBlock("ende", Object.assign({}, tb, { h1: 48 })));
      const w = { px: 29, lpx: 9, upx: 13, bes: "links", box: { anordnung: "unter", anker: "tl", x: X(35), y: Y(385), textfarbe: TINTE, textschatten: false, trenner: "linie",
        trenner_farbe: "#2a4b50", trenner_deckkraft: 0.2, zeilenabstand: 0.72, groesse: "fest", b: X(255), h: Y(230), verteilen: true, inhalt_v: "t" } };
      dazu(werte("live", w)); dazu(werte("ende", w));
      dazu(mini({ b: 180, h: 118, cpx: 7, tfarbe: "#37605f", box: { anker: "bl", x: X(66), y: Y(40), textschatten: false } }));
      dazu(ort({ px: 19, klein: false, wert: { gewicht: 650 } }));
    } else if (V.id === "unterwegs") {
      kopf();
      const tb = { h1: 56, sp: -0.03, kpx: 10, ksp: 0.2, kfarbe: AK, upx: 15,
        box: { anker: "bl", y: Y(93), x: X(60), hg_farbe: "#14252b", hg_deckkraft: 0.94, innen: 0.45, kante: "links", kante_b: 7 / 56, textschatten: false } };
      dazu(titelBlock("titel", Object.assign({}, tb, { box: Object.assign({}, tb.box, { y: Y(110) }) })));
      dazu(titelBlock("live", tb));
      dazu(titelBlock("ende", Object.assign({}, tb, { h1: 43, box: Object.assign({}, tb.box, { kante_b: 7 / 43 }) })));
      const w = { px: 32, lpx: 9, box: { anordnung: "unter", anker: "tr", x: X(64), y: Y(100), inhalt_h: "r", kante: "oben", kante_b: 3 / 32, zeilenabstand: 0.69, innen: 0 } };
      dazu(werte("live", w)); dazu(werte("ende", w));
      dazu(mini({ b: 140, h: 85, box: { anker: "br", x: X(59), y: Y(100) } }));
      dazu(fortschritt({ y: 56, h: 3 }));
      dazu(ort({ px: 20, klein: false, unter: false, kante_b: 3 / 20, box: { hg_farbe: "#14252b", hg_deckkraft: 0.91, innen: 0.5, kante_b: 3 / 20, textschatten: false } }));
    } else if (V.id === "feldbuch") {
      kopf({ logoAnker: "tc" });
      verlauf = { oben: { an: false, staerke: 0.5 }, unten: { an: true, staerke: 0.5 }, links: { an: false, staerke: 0.4 } };
      const notiz = { hg_farbe: "#f3ecd9", hg_deckkraft: 1, innen: 0.42, schatten: true, drehung: -1.5, klebestreifen: true, textschatten: false, ecken: 0.03,
        groesse: "auto", x: X(64), y: Y(75) };
      const tb = { h1: 65, schrift: "cormorant", gew: 500, sp: -0.035, zh: 0.98, kpx: 9, ksp: 0.11, kfarbe: "#576c62", ktext: "plexmono", upx: 12, ufarbe: "#596a5c", utext: "plexmono",
        phase: true, ppx: 9, pfarbe: "#6e7862", farbe: "#2c413d", h1zeile: { kursiv: true }, box: notiz };
      dazu(titelBlock("titel", Object.assign({}, tb, { box: Object.assign({}, notiz, { y: Y(180) }) })));
      dazu(titelBlock("live", tb));
      dazu(titelBlock("ende", Object.assign({}, tb, { h1: 54 })));
      const w = { px: 30, gap: 36, lpx: 9, upx: 14, gew: 400, box: { y: Y(66), schrift: "plexmono" } };
      dazu(werte("live", w)); dazu(werte("ende", w));
      dazu(profil({ b: 325, box: { anker: "br", x: X(70), y: Y(56), schrift: "plexmono" } }));
      dazu(mini({ b: 136, h: 100, cpx: 7, tfarbe: "#304e47", box: { y: Y(72), x: X(70), drehung: 3, hg_farbe: "#f3ecd9", hg_deckkraft: 0.93, innen: 1.3, schatten: true, textschatten: false } }));
      dazu(ort({ px: 36, kante: "keine", klein: false, wert: { schrift: "cormorant", kursiv: true, gewicht: 500 }, utext: "plexmono", upx: 11, dx: 115, dy: 30 }));
    } else if (V.id === "vorwaerts") {
      kopf();
      const tb = { h1: 65, gew: 800, sp: -0.046, kpx: 11, ksp: 0.18, upx: 15, h1zeile: { versal: true },
        box: { x: X(70), y: Y(95), kante: "links", kante_b: 7 / 65, innen: 0, gross: false } };
      dazu(titelBlock("titel", Object.assign({}, tb, { box: Object.assign({}, tb.box, { y: Y(220) }) })));
      dazu(titelBlock("live", tb)); dazu(titelBlock("ende", tb));
      // erste Zahl groß auf einer schrägen Fläche in der Akzentfarbe, die übrigen auf dunklen Feldern
      const erste = (i) => i === 0 ? { hg_farbe: AK, hg_deckkraft: 1, form: "schraeg", innen: 0.3, gr: 83 / 34, farbe: "#162a30", gewicht: 800 }
        : { hg_farbe: "#12252b", hg_deckkraft: 0.91, innen: 0.6 };
      const w = { px: 34, gap: 0, lpx: 9, upx: 14, gew: 700, box: { x: X(70), y: Y(70), inhalt_v: "b", textschatten: false, spaltenabstand: 0 }, zeile: erste };
      dazu(werte("live", w)); dazu(werte("ende", w));
      dazu(box({ name: T("container.z.ring", "Fortschrittsring"), vorlage: "ring", anker: "tr", x: X(63), y: Y(80), schriftgroesse: F(30), hg_farbe: "#14272b", hg_deckkraft: 0.5,
        ecken: 99, innen: 0, gewicht: 800, zeit: { von: Z.live.von, bis: null }, blende: BL.live, zeilen: [C.zeile("ring", { d: F(155), dicke: 4, farbe: AK })] }));
      dazu(ort({ px: 22, kante: "keine", kfarbe: "#ffb19c", kpx: 8, unter: false, wert: { gewicht: 800 }, box: { hg_farbe: "#12252b", hg_deckkraft: 0.94, innen: 0.5, textschatten: false } }));
    } else if (V.id === "wegweiser") {
      kopf();
      const tb = { h1: 43, sp: -0.035, kpx: 10, ksp: 0.17, unter: false };
      dazu(titelBlock("titel", Object.assign({}, tb, { h1: 85, box: { y: Y(180) } })));
      dazu(titelBlock("live", Object.assign({}, tb, { box: { y: Y(90) } })));
      dazu(titelBlock("ende", Object.assign({}, tb, { h1: 68, box: { y: Y(100) } })));
      const w = { px: 27, gap: 30, lpx: 8, upx: 13, box: { anker: "bc", x: 0, y: Y(64), inhalt_h: "c", hg_farbe: "#14272b", hg_deckkraft: 0.95, ecken: 99, innen: 0.55,
        rahmen_b: 0.04, rahmen_farbe: "#3a4d51", schatten: true, textschatten: false } };
      dazu(werte("live", w)); dazu(werte("ende", w));
      dazu(mini({ b: 145, h: 95, box: { anker: "bl", x: X(64), y: Y(66) } }));
      // das Schild am Laufpunkt: Wegweiser-Form in der Akzentfarbe, an einer echten Projektionslinie befestigt
      dazu(ort({ px: 34, kante: "keine", kfarbe: "#2d635d", ufarbe: "#2a625d", upx: 13, dx: 45, dy: 150, wert: { gewicht: 800 },
        box: { form: "pfeil", hg_farbe: AK, hg_deckkraft: 1, innen: 0.55, textfarbe: "#143335", textschatten: false, schatten: true, fuehrung_farbe: "#c5eee5" } }));
    } else if (V.id === "kino") {
      verlauf = { oben: { an: false, staerke: 0.5 }, unten: { an: true, staerke: 0.3 }, links: { an: false, staerke: 0.4 } };
      const band = (an) => box({ name: T("vv.kinoband", "Kinoband"), vorlage: "flaeche", anker: an, x: 0, y: 0, groesse: "fest", b: 100, h: Y(74) + (an === "bl" ? Y(20) : 0),
        hg_farbe: "#080d12", hg_deckkraft: 1, textschatten: false, zeilen: [], zeit: null, blende: null });
      dazu(band("tl")); dazu(band("bl"));
      kopf({ ly: 28, ky: 32, kpx: 10, ksp: 0.4 });
      const tb = { h1: 110, schrift: "cormorant", gew: 500, sp: -0.01, kpx: 10, ksp: 0.5, upx: 17, usp: 0.12, uzeile: { versal: true },
        box: { anker: "cc", x: 0, y: 0, inhalt_h: "c" } };
      dazu(titelBlock("titel", Object.assign({}, tb, { box: Object.assign({}, tb.box), h1zeile: {} })));
      dazu(titelBlock("live", { h1: 47, schrift: "cormorant", gew: 500, kicker: false, box: { x: X(65), y: Y(123) } }));
      dazu(titelBlock("ende", Object.assign({}, tb, { h1: 100 })));
      const w = { px: 23, gap: 40, lpx: 8, upx: 12, bes: "nach", box: { anker: "bc", x: 0, y: Y(43), inhalt_h: "c", textschatten: false } };
      dazu(werte("live", w)); dazu(werte("ende", w));
      dazu(ort({ px: 24, kante: "keine", klein: false, unter: false, wert: { schrift: "cormorant", kursiv: true, gewicht: 500 } }));
    } else if (V.id === "reiseplakat") {
      kopf();
      const tb = { h1: 125, gew: 800, sp: -0.056, zh: 0.91, kpx: 10, ksp: 0.2, upx: 18, usp: 0.06, h1zeile: { versal: true }, balken: [105, 8, 0],
        box: { x: X(69), y: Y(83), zeilenabstand: 0.18 } };
      dazu(titelBlock("titel", Object.assign({}, tb, { h1: 150, box: Object.assign({}, tb.box, { y: Y(170) }) })));
      dazu(titelBlock("live", Object.assign({}, tb, { h1: 81 })));
      dazu(titelBlock("ende", Object.assign({}, tb, { h1: 94 })));
      // Konturzahl als grafisches Motiv (frei änderbar), senkrechte Randbeschriftung
      dazu(box({ name: T("vv.konturzahl", "Konturzahl"), vorlage: "deko", anker: "tr", x: X(70), y: Y(180), schriftgroesse: F(260), gewicht: 800, sperrung: -0.096,
        textschatten: false, deckkraft: 0.9, zeit: { von: Z.titel.von, bis: Z.live.bis }, blende: BL.live, zeilen: [txt(ctx.nummer || "01", { kontur: true, farbe: "#f4f1e9", zh: 1 })] }));
      dazu(box({ name: T("vv.konturzahl", "Konturzahl") + " · " + T("vv.phase.ende", "Geschafft"), vorlage: "deko", anker: "tr", x: X(70), y: Y(180), schriftgroesse: F(260), gewicht: 800,
        textschatten: false, deckkraft: 0.9, zeit: Z.ende, blende: BL.ende, zeilen: [txt("✓", { kontur: true, farbe: "#f4f1e9", zh: 1 })] }));
      dazu(box({ name: T("vv.randtext", "Randbeschriftung"), vorlage: "deko", anker: "tl", x: X(23), y: Y(268), schriftgroesse: F(9), sperrung: 0.44, gewicht: 600,
        zeit: Z.live, blende: BL.live, zeilen: [txt(T("vv.phase.live", "Unterwegs").toUpperCase(), { senkrecht: true })] }));
      const w = { px: 41, gew: 800, lpx: 10, upx: 16, bes: "links", box: { x: X(70), y: Y(64), groesse: "fest", b: 100 - 2 * X(70), h: Y(70), verteilen: true, kante: "oben",
        kante_b: 1 / 41, kante_farbe: "#c7c4bd", innen: 0, inhalt_v: "b", spaltenabstand: 1 } };
      dazu(werte("live", w)); dazu(werte("ende", w));
      dazu(ort({ px: 22, klein: false, upx: 10, wert: { gewicht: 800, versal: true } }));
    } else if (V.id === "lichtglas") {
      kopf();
      const tb = { h1: 69, gew: 750, sp: -0.036, kpx: 11, ksp: 0.18, kfarbe: "#a8e7dc", upx: 16, ufarbe: "#d4e8e0" };
      dazu(titelBlock("titel", Object.assign({}, tb, { box: { y: Y(220) } })));
      dazu(titelBlock("live", tb));
      dazu(titelBlock("ende", Object.assign({}, tb, { h1: 65 })));
      // ein gemeinsames Glasband unten: Kennzahlen links, das Profil rechts darauf
      const glas = { hg_farbe: "#d3eeea", hg_deckkraft: 0.17, hg_verlauf: true, hg_farbe2: "#12292e", hg_deckkraft2: 0.67, unschaerfe: true, unschaerfe_st: 0.45,
        rahmen_b: 0.026, rahmen_farbe: "#5d7377", ecken: 0.6, schatten: true, textschatten: false };
      dazu(box(Object.assign({ name: T("vv.glasband", "Glasband"), vorlage: "flaeche", anker: "bl", x: X(65), y: Y(62), groesse: "fest", b: 100 - 2 * X(65), h: Y(128),
        zeilen: [], zeit: { von: Z.live.von, bis: null }, blende: { ein: "hoch", aus: "none", ein_s: 0.6, aus_s: 0.4 } }, glas)));
      const w = { px: 38, gap: 40, lpx: 10, box: { x: X(97), y: Y(87), textschatten: false } };
      // 03.11.2026 (Befund der iPhone-App: im Quadrat lag das Profil auf dem dritten Wert) — im Quadrat zwei Werte, und das
      // Profil nur unterwegs, damit die Werte der Schlusskarte (bis zu vier) das Band für sich haben
      const quadrat = !hoch && fw / fh < 1.2;
      dazu(werte("live", Object.assign({}, w, { anzahl: quadrat ? 2 : 3 }))); dazu(werte("ende", w));
      dazu(profil({ b: 380, h: 66, box: { anker: "br", x: X(100), y: Y(85), textschatten: false }, zeit: { von: Z.live.von, bis: quadrat ? Z.live.bis : null } }));
      dazu(mini({ b: 155, h: 105, box: { y: Y(115), x: X(70) } }));
      dazu(ort({ px: 21, kante: "keine", kfarbe: "#aee7d9", kpx: 8, upx: 10, dx: 52, dy: 68,
        box: Object.assign({}, glas, { ecken: 0.66, innen: 0.55, rahmen_farbe: "#8a9a9c", hg_farbe: "#e1f6ed", hg_deckkraft: 0.19, hg_deckkraft2: 0.84, hg_farbe2: "#14262b" }) }));
    }
    // 01.11.2026 (Marc: „Kann man in jedem Stil ein Höhenprofil einblenden? … es müssen alle Möglichkeiten in dem Stil
    // gehen“) — jede Vorlage hat einen Platz für Höhenprofil und Übersichtskarte im eigenen Stil. ctx.profil/ctx.uebersicht:
    // true = dazu (falls die Vorlage sie nicht hat), false = weg, leer = wie die Vorlage.
    const PLATZ = {
      klartext:    { profil: { b: 380, h: 60, box: { anker: "br", x: X(60), y: Y(52) } }, mini: { b: 150, h: 95, box: { y: Y(85) } } },
      randnotiz:   { profil: { b: 260, h: 55, farbe: "#37605f", tfarbe: "#5c777b", box: { anker: "tl", x: X(35), y: Y(632), textschutz: "aus", textfarbe: TINTE } } },
      unterwegs:   { profil: { b: 330, h: 60, box: { anker: "br", x: X(230), y: Y(100) } } },
      vorwaerts:   { profil: { b: 420, h: 70, farbe: "#f4f1e9", box: { anker: "br", x: X(63), y: Y(70) } }, mini: { b: 150, h: 100, box: { y: Y(265), x: X(63) } } },
      wegweiser:   { profil: { b: 360, h: 60, box: { anker: "br", x: X(64), y: Y(66) } } },
      kino:        { profil: { b: 420, h: 55, box: { anker: "bl", x: X(65), y: Y(112) } }, mini: { b: 140, h: 90, box: { x: X(65), y: Y(100) } } },
      reiseplakat: { profil: { b: 420, h: 70, box: { anker: "br", x: X(70), y: Y(165) } }, mini: { b: 150, h: 100, box: { anker: "bl", x: X(70), y: Y(165) } } },
      fernweh: {}, feldbuch: {}, lichtglas: {},
    }[V.id] || {};
    const hat = (v) => liste.some(c => c.vorlage === v);
    if (ctx.profil === true && !hat("hoehe") && PLATZ.profil) dazu(profil(PLATZ.profil));
    if (ctx.uebersicht === true && !hat("uebersicht") && PLATZ.mini) dazu(mini(PLATZ.mini));
    for (let i = liste.length - 1; i >= 0; i--) {
      if ((ctx.profil === false && liste[i].vorlage === "hoehe") || (ctx.uebersicht === false && liste[i].vorlage === "uebersicht")) liste.splice(i, 1);
    }
    // Hochformat: Kennzahlen untereinander, wenn sie nebeneinander zu breit würden
    if (hoch) liste.forEach((c, i) => {
      if ((c.vorlage === "live" || c.vorlage === "schluss_werte") && c.anordnung === "neben" && c.groesse !== "fest" && c.zeilen.length > 2 && V.id !== "vorwaerts") {
        liste[i] = C.normalisieren(Object.assign({}, c, { anordnung: "unter", zeilenabstand: 0.4 }));
      }
    });
    const animator = {
      line_color: P.route, line_width: Math.round(P.breite * 0.7 * 10) / 10, kontur_breite: 1.5, kontur_farbe: P.kante,
      ghost_track_enabled: true, ghost_track_color: P.rest, ghost_track_opacity_pct: 55,
      linien_look: "klassisch", schweif_pct: 0,
      highlights_farbe: P.akzent, marker_dot_style: "leucht",
    };
    return { container: liste, verlauf, animator, palette: P, vorlage: V.id, hat: { profil: hat("hoehe") || !!PLATZ.profil, uebersicht: hat("uebersicht") || !!PLATZ.mini } };
  }

  window.rzVideoVorlagen = { LISTE, bauen, standard };
})();
