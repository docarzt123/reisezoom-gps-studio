/* Einblendungen als Container (30.09.2026, docs/OVERLAY-CONTAINER.md).
 *
 * Ein Baustein für alles, was am Bildschirm klebt: frei platzierbar (Anker + Abstand),
 * mit Zeilen (Wert, Freitext, Diagramm, Bild, Nordpfeil, Maßstab). Diese Datei ist das
 * MODELL: Normalisieren, Stil-Templates, Einblendungs-Vorlagen, Umzug alter Projekte
 * und die Brücke zur gemeinsamen Zeitsteuerung (ui/js/overlay_boxen.js). Gezeichnet
 * wird im Animator (modules/animator/ui/module.js, Abschnitt „Container").
 *
 * Läuft in der App (Vorschau = Szene-Render) und unter node im Wächter
 * (vorher globalThis.window = globalThis setzen).
 *
 * Einheiten (Grilling Q26): Schriftgröße in % der kurzen Bildseite (cqmin), Abstände in
 * em (relativ zur Schrift des Containers), Lage und feste Größe in % der Bildfläche.
 *
 * window.rzContainer = { STILE, VORLAGEN, ANKER, normalisieren, liste, stilAnwenden,
 *                         neu, zeile, migrieren, timingBoxen, neueId }
 */
(function (root) {
  "use strict";
  const ANKER = ["tl", "tc", "tr", "ml", "cc", "mr", "bl", "bc", "br"];
  const ZEILEN_TYPEN = ["wert", "text", "diagramm", "bild", "nord", "massstab"];
  const SCHRIFTEN = ["system", "nunito", "quicksand", "fredoka", "oswald", "bebas"];
  const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  const istNix = (v) => v === null || v === undefined;
  const istDict = (x) => !!x && typeof x === "object" && !Array.isArray(x);
  const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
  const rund = (x, n) => { const f = Math.pow(10, n === undefined ? 4 : n); return Math.round(x * f) / f; };
  function num(v, def) {
    if (istNix(v) || v === "" || typeof v === "boolean") return def;
    const f = Number(v);
    return isFinite(f) ? f : def;
  }
  const farbe = (v, def) => { const s = String(v || "").trim(); return HEX.test(s) ? s.toLowerCase() : def; };
  const wahl = (v, liste, def) => (liste.indexOf(v) >= 0 ? v : def);
  let _zaehler = 0;
  function neueId(prefix) {
    _zaehler++;
    let r = "";
    try { r = Math.floor(Math.random() * 1e8).toString(36); } catch (_) { r = String(Date.now() % 1e8); }
    return (prefix || "c") + "_" + r + _zaehler.toString(36);
  }

  // ── Stil-Templates (Q6/Q15/Q28): setzen beim Auswählen ALLE Werte, danach gehören
  // sie dem Container. Werte aus dem bisherigen Look abgeleitet (Kasten = Stats-Box
  // 22 px Zahl @1080, Frei = Komoot-artig 40 px, Plakette = Logo-Pille). ──
  const STILE = {
    kasten: {
      schriftgroesse: 2.04, textfarbe: "#ffffff", akzent: "#ffc21a",
      hg_farbe: "#000000", hg_deckkraft: 0.55, unschaerfe: true,
      innen: 0.9, zeilenabstand: 0.36, spaltenabstand: 1.3, ecken: 0.55,
      rahmen_b: 0, rahmen_farbe: "#ffffff", schatten: true, textschatten: false,
      beschriftung: "links", anordnung: "unter", beschr_faktor: 0.5, einheit_faktor: 1, gross: true,
    },
    frei: {
      schriftgroesse: 3.7, textfarbe: "#ffffff", akzent: "#ffc21a",
      hg_farbe: "#000000", hg_deckkraft: 0, unschaerfe: false,
      innen: 0, zeilenabstand: 0.1, spaltenabstand: 0.9, ecken: 0,
      rahmen_b: 0, rahmen_farbe: "#ffffff", schatten: false, textschatten: true,
      beschriftung: "oben", anordnung: "neben", beschr_faktor: 0.35, einheit_faktor: 0.5, gross: true,
    },
    plakette: {
      schriftgroesse: 2.2, textfarbe: "#ffffff", akzent: "#ffc21a",
      hg_farbe: "#0e1016", hg_deckkraft: 0.62, unschaerfe: false,
      innen: 0.45, zeilenabstand: 0.1, spaltenabstand: 0.8, ecken: 99,
      rahmen_b: 0, rahmen_farbe: "#ffffff", schatten: false, textschatten: false,
      beschriftung: "links", anordnung: "neben", beschr_faktor: 0.5, einheit_faktor: 0.6, gross: true,
    },
    ohne: {
      schriftgroesse: 2.04, textfarbe: "#ffffff", akzent: "#ffc21a",
      hg_farbe: "#000000", hg_deckkraft: 0, unschaerfe: false,
      innen: 0, zeilenabstand: 0.2, spaltenabstand: 0.8, ecken: 0,
      rahmen_b: 0, rahmen_farbe: "#ffffff", schatten: false, textschatten: false,
      beschriftung: "links", anordnung: "unter", beschr_faktor: 0.5, einheit_faktor: 1, gross: true,
    },
  };
  const STIL_NAMEN = Object.keys(STILE);

  // ── Normalisieren ──
  function zeileNorm(z) {
    z = istDict(z) ? z : {};
    const typ = wahl(z.typ, ZEILEN_TYPEN, "text");
    const out = { id: String(z.id || neueId("z")), typ };
    if (typ === "wert") {
      out.feld = String(z.feld || "dist_total");
      // Bezug (Q22): live = läuft mit (Live-Katalog); gesamt / laufend (laufende Etappe) /
      // <Nummer> (Etappe) / art:<Art> (Bewegungsart) = Summen-Katalog.
      let bz = z.bezug;
      if (typeof bz === "number" && bz >= 1) bz = Math.trunc(bz);
      else if (typeof bz === "string" && /^\d+$/.test(bz)) bz = parseInt(bz, 10);
      else if (!(bz === "live" || bz === "gesamt" || bz === "laufend" || (typeof bz === "string" && /^art:[a-z_]{2,20}$/.test(bz)))) bz = "gesamt";
      out.bezug = bz;
      out.label = istNix(z.label) ? null : String(z.label).slice(0, 60);
      out.label_aus = !!z.label_aus;
    } else if (typ === "text") {
      out.text = String(istNix(z.text) ? "" : z.text).slice(0, 400);
    } else if (typ === "diagramm") {
      out.art = z.art === "daten" ? "daten" : "hoehe";
      out.b = rund(clamp(num(z.b, 40), 3, 100), 2);
      out.h = rund(clamp(num(z.h, 12), 2, 100), 2);
      out.bereich = z.bereich === "etappe" ? "etappe" : "reise";
      out.linienfarbe = farbe(z.linienfarbe, null);
      if (out.art === "daten") {
        const c = istDict(z.chart) ? z.chart : {};
        out.chart = {
          series: String(c.series || "ele"), series_b: String(c.series_b || ""),
          style: istDict(c.style) ? c.style : null,
          show_axes: c.show_axes !== false,
          axis_font_size: clamp(Math.round(num(c.axis_font_size, 20)), 6, 80),
          fg_opacity: clamp(Math.round(num(c.fg_opacity, 100)), 0, 100),
          bg_opacity: clamp(Math.round(num(c.bg_opacity, 0)), 0, 100),
        };
      }
    } else if (typ === "bild") {
      out.pfad = String(z.pfad || "");
      out.b = rund(clamp(num(z.b, 15), 1, 100), 2);
    }
    return out;
  }
  function normalisieren(c) {
    c = istDict(c) ? c : {};
    const stilName = wahl(c.stil, STIL_NAMEN.concat(["eigen"]), "kasten");
    const S = STILE[stilName] || STILE.kasten;
    const g = (k) => (istNix(c[k]) ? S[k] : c[k]);
    const out = {
      id: String(c.id || neueId("c")),
      name: String(istNix(c.name) ? "" : c.name).slice(0, 60),
      an: istNix(c.an) ? true : !!c.an,
      stil: stilName,
      anker: wahl(c.anker, ANKER, "tl"),
      x: rund(clamp(num(c.x, 3), -100, 100), 3),
      y: rund(clamp(num(c.y, 3), -100, 100), 3),
      groesse: c.groesse === "fest" ? "fest" : "auto",
      b: rund(clamp(num(c.b, 30), 1, 100), 2),
      h: rund(clamp(num(c.h, 20), 1, 100), 2),
      inhalt_h: wahl(c.inhalt_h, ["l", "c", "r"], "l"),
      inhalt_v: wahl(c.inhalt_v, ["t", "m", "b"], "t"),
      anordnung: g("anordnung") === "neben" ? "neben" : "unter",
      beschriftung: wahl(g("beschriftung"), ["oben", "links", "aus"], "links"),
      schrift: wahl(String(c.schrift || "system").toLowerCase(), SCHRIFTEN, "system"),
      schriftgroesse: rund(clamp(num(g("schriftgroesse"), 2), 0.3, 40), 3),
      textfarbe: farbe(g("textfarbe"), "#ffffff"),
      akzent: farbe(g("akzent"), "#ffc21a"),
      hg_farbe: farbe(g("hg_farbe"), "#000000"),
      hg_deckkraft: rund(clamp(num(g("hg_deckkraft"), 0.55), 0, 1), 3),
      hg_bild: String(c.hg_bild || ""),
      hg_bild_modus: c.hg_bild_modus === "einpassen" ? "einpassen" : "fuellen",
      hg_bild_deckkraft: rund(clamp(num(c.hg_bild_deckkraft, 1), 0, 1), 3),
      unschaerfe: !!g("unschaerfe"),
      innen: rund(clamp(num(g("innen"), 0.9), 0, 10), 3),
      zeilenabstand: rund(clamp(num(g("zeilenabstand"), 0.3), 0, 10), 3),
      spaltenabstand: rund(clamp(num(g("spaltenabstand"), 1.2), 0, 20), 3),
      ecken: rund(clamp(num(g("ecken"), 0.5), 0, 99), 3),
      rahmen_b: rund(clamp(num(g("rahmen_b"), 0), 0, 2), 3),
      rahmen_farbe: farbe(g("rahmen_farbe"), "#ffffff"),
      schatten: !!g("schatten"),
      textschatten: !!g("textschatten"),
      beschr_faktor: rund(clamp(num(g("beschr_faktor"), 0.5), 0.15, 2), 3),
      einheit_faktor: rund(clamp(num(g("einheit_faktor"), 1), 0.2, 1), 3),
      gross: istNix(g("gross")) ? true : !!g("gross"),
      deckkraft: rund(clamp(num(c.deckkraft, 1), 0, 1), 3),
      zeilen: (Array.isArray(c.zeilen) ? c.zeilen : []).map(zeileNorm),
    };
    if (!istNix(c.zeit)) out.zeit = c.zeit;
    if (istDict(c.blende)) out.blende = Object.assign({}, c.blende);
    if (c.vorlage) out.vorlage = String(c.vorlage);
    return out;
  }
  function liste(roh) {
    const gesehen = {};
    return (Array.isArray(roh) ? roh : []).filter(istDict).map(normalisieren).filter((c) => {
      if (gesehen[c.id]) c.id = neueId("c");
      gesehen[c.id] = true;
      return true;
    });
  }
  /** Stil-Template anwenden (Q28): alle Werte des Stils überschreiben die des Containers. */
  function stilAnwenden(c, stilName) {
    const S = STILE[stilName];
    if (!S) return normalisieren(c);
    return normalisieren(Object.assign({}, c, S, { stil: stilName }));
  }

  function zeile(typ, extra) { return zeileNorm(Object.assign({ typ }, extra || {})); }
  function wert(feld, bezug, extra) { return zeile("wert", Object.assign({ feld, bezug }, extra || {})); }

  // ── Einblendungs-Vorlagen (Q9): nur vorgefüllte Container. `t` = Übersetzer
  // (key, fallback) → Texte in der App-Sprache. ──
  const VORLAGEN = {
    live: (t) => normalisieren(Object.assign({}, STILE.kasten, { stil: "kasten", vorlage: "live", name: t("container.v.live", "Live-Werte"),
      anker: "tr", zeilen: [wert("dist_done", "live"), wert("time_elapsed", "live"), wert("ele_now", "live")] })),
    gesamt: (t) => normalisieren(Object.assign({}, STILE.kasten, { stil: "kasten", vorlage: "gesamt", name: t("container.v.gesamt", "Gesamtsumme"),
      anker: "tl", zeilen: ["dist_total", "moving_time", "avg_speed", "elev_gain", "elev_loss"].map((f) => wert(f, "gesamt")) })),
    hoehe: (t) => normalisieren(Object.assign({}, STILE.kasten, { stil: "kasten", vorlage: "hoehe", name: t("container.v.hoehe", "Höhenprofil"),
      anker: "bc", schriftgroesse: 1.05, beschriftung: "aus", zeilenabstand: 0.4,
      zeilen: [zeile("text", { text: t("container.v.hoehe_kopf", "HÖHENPROFIL · Min {ele_low} · Max {ele_high}") }),
               zeile("diagramm", { art: "hoehe", b: 25, h: 11 })] })),
    titel: (t) => normalisieren(Object.assign({}, STILE.ohne, { stil: "ohne", vorlage: "titel", name: t("container.v.titel", "Titel"),
      anker: "tc", y: 20, schriftgroesse: 8, textschatten: true, inhalt_h: "c",
      zeilen: [zeile("text", { text: t("container.v.titel_text", "Meine Tour") })],
      zeit: { von: { art: "video_start", wert: 0 }, bis: { art: "video_start", wert: 3 } },
      blende: { ein: "none", aus: "fade", ein_s: 0.6, aus_s: 0.6 } })),
    schluss: (t) => normalisieren(Object.assign({}, STILE.kasten, { stil: "kasten", vorlage: "schluss", name: t("container.v.schluss", "Schlusskarte"),
      anker: "cc", x: 0, y: 0, schriftgroesse: 6.4, beschriftung: "oben", anordnung: "neben", innen: 0.6, ecken: 0.45,
      hg_farbe: "#0c0e14", hg_deckkraft: 0.58, beschr_faktor: 0.4, einheit_faktor: 0.6, inhalt_h: "c",
      zeilen: ["dist_total", "elev_gain", "moving_time"].map((f) => wert(f, "gesamt")),
      zeit: { von: { art: "video_ende", wert: 2.5 }, bis: null },
      blende: { ein: "fade", aus: "none", ein_s: 0.6, aus_s: 0.6 } })),
    logo: (t) => normalisieren(Object.assign({}, STILE.ohne, { stil: "ohne", vorlage: "logo", name: t("container.v.logo", "Logo"),
      anker: "br", x: 2, y: 3, deckkraft: 0.65, zeilen: [zeile("bild", { pfad: "@lockup-white", b: 15 })] })),
    nord: (t) => normalisieren(Object.assign({}, STILE.ohne, { stil: "ohne", vorlage: "nord", name: t("container.v.nord", "Nordpfeil + Maßstab"),
      anker: "br", x: 2, y: 3, anordnung: "neben", spaltenabstand: 1, inhalt_v: "b",
      zeilen: [zeile("massstab"), zeile("nord")] })),
    rahmen: (t) => normalisieren(Object.assign({}, STILE.ohne, { stil: "ohne", vorlage: "rahmen", name: t("container.v.rahmen", "Rahmen / Vollbild"),
      anker: "cc", x: 0, y: 0, groesse: "fest", b: 100, h: 100, hg_bild_modus: "fuellen", zeilen: [] })),
    leer: (t) => normalisieren(Object.assign({}, STILE.kasten, { stil: "kasten", vorlage: "leer", name: t("container.v.leer", "Einblendung"),
      anker: "cc", x: 0, y: 0, zeilen: [zeile("text", { text: t("container.v.leer_text", "Text") })] })),
  };
  function neu(vorlage, t) {
    const f = VORLAGEN[vorlage] || VORLAGEN.leer;
    return f(typeof t === "function" ? t : (k, d) => d);
  }

  // ── Brücke zur Zeitsteuerung (overlay_boxen.js): Container → Box-Objekte für
  // rzOverlayBoxen.anwenden (DOM: [data-ovbox="<id>"], Wert-Zeilen mit Bezug je
  // Etappe als [data-f="<zeilen-id>"][data-stage-values]). ──
  function timingBoxen(cs) {
    const R = root && root.rzOverlayBoxen;
    return (cs || []).filter((c) => c && c.an).map((c) => {
      const zeiten = (R && R.zeitListe(c.zeit)) || null;
      const bl = istDict(c.blende) ? c.blende : {};
      const blende = {
        ein: ["none", "fade", "both"].indexOf(bl.ein === "pop" ? "both" : bl.ein) >= 0 ? (bl.ein === "pop" ? "both" : bl.ein) : "none",
        aus: ["none", "fade", "both"].indexOf(bl.aus === "pop" ? "both" : bl.aus) >= 0 ? (bl.aus === "pop" ? "both" : bl.aus) : "none",
        dauer_s: 0.5,
      };
      blende.ein_s = Math.max(0, num(bl.ein_s, num(bl.dauer_s, 0.5)));
      blende.aus_s = Math.max(0, num(bl.aus_s, num(bl.dauer_s, 0.5)));
      const zeilen = {};
      for (const z of c.zeilen || []) {
        if (z.typ === "wert" && z.bezug !== "live") zeilen[z.id] = { bezug: z.bezug, zeit: null };
      }
      return { id: c.id, typ: "container", enabled: true, zeiten: zeiten || [null], zeit: zeiten ? zeiten[0] : null,
               blende, bezug: "gesamt", zeilen };
    });
  }

  // ── Umzug alter Projekte (Q8) ──────────────────────────────────────────────
  // `a` = Einstellungs-Block des Moduls (animator/tourmap), `W×H` = Videoformat.
  // Gibt { container, verlauf, hinweise[] } zurück. Maße: alte Werte waren px bei
  // 1080 Videohöhe, skaliert mit Höhe/1080 → hier in % der kurzen Seite (cqmin)
  // bzw. em umgerechnet, so dass die Vorschau gleich aussieht (auch 9:16).
  function migrieren(a, W, H, t) {
    a = istDict(a) ? a : {};
    t = typeof t === "function" ? t : (k, d) => d;
    W = num(W, 1920) || 1920; H = num(H, 1080) || 1080;
    const R = root && root.rzOverlayBoxen;
    const kurz = Math.min(W, H);
    const pxZuCq = (px) => rund(px * (H / 1080) / kurz * 100, 3);      // Schrift px@1080 → cqmin
    const pxZuX = (px) => rund(px * (H / 1080) / W * 100, 3);          // Abstand px@1080 → % Breite
    const pxZuY = (px) => rund(px * (H / 1080) / H * 100, 3);          // → % Höhe
    const hinweise = [];
    const aus = [];
    const master = a.show_overlays !== false;
    const frei = String(a.overlay_skin || "kasten") === "frei";
    const posZuAnker = (p) => {
      const m = { tl: "tl", tc: "tc", tr: "tr", ml: "ml", cc: "cc", mr: "mr", bl: "bl", bc: "bc", br: "br", tcw: "tc", bcw: "bc" };
      return m[p] || "tl";
    };
    const randX = pxZuX(40), randY = pxZuY(40);
    const lage = (p) => {
      const an = posZuAnker(p);
      return { anker: an, x: an[1] === "c" ? 0 : randX, y: an[0] === "m" || an === "cc" ? 0 : randY };
    };
    const basisStil = (st) => {
      const S = frei ? STILE.frei : STILE.kasten;
      const px22 = frei ? 40 : 22;   // Zahl in px@1080 (Kasten 22, Frei 40)
      const e = (px) => rund(px / px22, 3);   // px@1080 → em (relativ zur Zahl)
      const o = Object.assign({}, S, { stil: frei ? "frei" : "kasten", schriftgroesse: pxZuCq(px22) });
      if (st) {
        o.schrift = st.font || "system";
        o.textfarbe = st.text_color || o.textfarbe;
        if (!frei) {
          o.hg_farbe = st.bg_color || o.hg_farbe;
          o.hg_deckkraft = istNix(st.bg_opacity) ? o.hg_deckkraft : st.bg_opacity;
          o.ecken = e(num(st.radius, 12));
          o.rahmen_b = e(num(st.border_w, 0));
          o.rahmen_farbe = st.border_color || o.rahmen_farbe;
          o.schatten = !!st.shadow;
        }
      }
      return o;
    };
    const blendeVon = (b) => {
      const bl = (b && b.blende) || {};
      return { ein: bl.ein || "none", aus: bl.aus || "none", ein_s: num(bl.ein_s, 0.5), aus_s: num(bl.aus_s, 0.5) };
    };
    // sprache-ok: Auslöser-Kürzel, kein sichtbarer Text
    const zeitVon = (b) => {
      const zs = (b && b.zeiten) || [];
      const echt = zs.filter((z) => z && !((z.von.art === "s" || z.von.art === "video_start") && z.von.wert <= 0 && !z.bis && !z.dauer_s));
      if (!echt.length) return null;
      return echt.length === 1 ? echt[0] : echt;
    };
    // 1) Stats-Boxen (Gesamt, Live, weitere) + Höhenprofil über das bisherige Modell auflösen
    const boxen = R ? R.aufloesen(a) : [];
    for (const b of boxen) {
      if (b.typ === "ele") {
        const o = Object.assign(basisStil(b.stil), lage(b.position), {
          id: neueId("c"), name: t("container.v.hoehe", "Höhenprofil"), vorlage: "hoehe",
          an: master && !!b.enabled, beschriftung: "aus", zeilenabstand: 0.4,
          schriftgroesse: pxZuCq(frei ? 14 : 11.5), zeit: zeitVon(b), blende: blendeVon(b),
        });
        const breit = b.position === "tcw" || b.position === "bcw";
        o.zeilen = [
          zeile("text", { text: t("container.v.hoehe_kopf", "HÖHENPROFIL · Min {ele_low} · Max {ele_high}") }),
          zeile("diagramm", { art: "hoehe", b: breit ? 80 : rund(pxZuX(480 - 44), 2), h: rund(pxZuY(170 - 24 - 30), 2),
                              bereich: a.overlay_elevation_scope === "etappe" ? "etappe" : "reise",
                              linienfarbe: frei ? "#ffffff" : null }),
        ];
        if (!frei) o.innen = rund(14 / 11.5, 3);
        aus.push(normalisieren(o));
        continue;
      }
      if (b.typ !== "totals" && b.typ !== "live") continue;
      const felder = (b.fields || []).filter(Boolean);
      if (!felder.length) continue;
      const bezugBox = b.typ === "live" ? "live" : (b.bezug || "gesamt");
      const mitZeit = [], ohneZeit = [];
      for (const f of felder) {
        const zl = (b.zeilen || {})[f];
        const bz = b.typ === "live" ? "live" : (zl && zl.bezug) || bezugBox;
        (zl && zl.zeit ? mitZeit : ohneZeit).push({ f, bz, zl });
      }
      const basis = Object.assign(basisStil(b.stil), lage(b.position), {
        name: b.titel || (b.typ === "live" ? t("container.v.live", "Live-Werte") : t("container.v.gesamt", "Gesamtsumme")),
        vorlage: b.typ === "live" ? "live" : "gesamt",
        an: master && !!b.enabled, blende: blendeVon(b),
        inhalt_h: (b.position || "").endsWith("r") ? "r" : ((b.position || "")[1] === "c" ? "c" : "l"),
      });
      if (ohneZeit.length || !mitZeit.length) {
        const o = Object.assign({}, basis, { id: neueId("c"), zeit: zeitVon(b),
          zeilen: (b.titel ? [zeile("text", { text: b.titel })] : []).concat(ohneZeit.map((x) => wert(x.f, x.bz))) });
        aus.push(normalisieren(o));
      }
      // Zeilen mit eigenem Zeitpunkt (Q7): je eigener Container darunter
      mitZeit.forEach((x, k) => {
        const o = Object.assign({}, basis, { id: neueId("c"), name: basis.name + " · " + x.f,
          y: rund(basis.y + (ohneZeit.length + k) * 2.4 * basis.schriftgroesse * kurz / H, 3),
          zeit: x.zl.zeit, blende: Object.assign(blendeVon(b), x.zl.blende || {}), zeilen: [wert(x.f, x.bz)] });
        aus.push(normalisieren(o));
        hinweise.push("zeile-mit-zeit:" + x.f);
      });
    }
    // 2) Diagramme
    (Array.isArray(a.charts) ? a.charts : []).forEach((ch) => {
      if (!istDict(ch)) return;
      const st = istDict(ch.style) ? ch.style : {};
      const bgOp = num(ch.bg_opacity, 100) / 100;
      const zt = (() => {
        const frm = Math.max(0, num(ch.from_s, 0)), to = num(ch.to_s, 0);
        if (frm <= 0 && to <= 0) return null;
        return { von: { art: "s", wert: frm }, bis: to > 0 ? { art: "s", wert: to } : null };
      })();
      aus.push(normalisieren(Object.assign({}, STILE.ohne, lage(ch.position || "br"), {
        id: neueId("c"), stil: "ohne", name: t("container.v.diagramm", "Diagramm"), vorlage: "diagramm", an: master,
        hg_farbe: farbe(st.background_color, "#1a1a1a"), hg_deckkraft: rund(clamp(bgOp, 0, 1), 3),
        zeit: zt, blende: R ? blendeVon({ blende: R.globalBlende(a) }) : null,
        zeilen: [zeile("diagramm", { art: "daten", b: rund(pxZuX(num(ch.width, 640)), 2), h: rund(pxZuY(num(ch.height, 300)), 2),
          chart: { series: ch.series, series_b: ch.series_b, style: ch.style, show_axes: ch.show_axes !== false,
                   axis_font_size: ch.axis_font_size, fg_opacity: num(ch.fg_opacity, num(ch.opacity, 100)), bg_opacity: 0 } })],
      })));
    });
    // 3) Nordpfeil + Maßstab (Standard an, wie bisher)
    const nordAn = a.overlay_north_enabled !== false, massAn = a.overlay_scale_enabled !== false;
    const nordPos = String(a.overlay_north_position || "br"), massPos = String(a.overlay_scale_position || "bl");
    const nsStil = Object.assign({}, STILE.ohne, { stil: "ohne", schriftgroesse: pxZuCq(22) });
    if (nordAn) aus.push(normalisieren(Object.assign({}, nsStil, lage(nordPos), { id: neueId("c"), name: t("container.v.nordpfeil", "Nordpfeil"),
      vorlage: "nord", an: master, zeilen: [zeile("nord")] })));
    if (massAn) aus.push(normalisieren(Object.assign({}, nsStil, lage(massPos), { id: neueId("c"), name: t("container.v.massstab", "Maßstab"),
      vorlage: "nord", an: master, zeilen: [zeile("massstab")] })));
    // 4) Wasserzeichen → Logo-Container (linke obere Ecke in %, Breite in % der Bildbreite)
    const wm = istDict(a.watermark) ? a.watermark : null;
    if (wm && wm.path) {
      const w = clamp(num(wm.w, 12), 2, 60);
      const o = Object.assign({}, frei ? STILE.plakette : STILE.ohne, {
        id: neueId("c"), stil: frei ? "plakette" : "ohne", name: t("container.v.logo", "Logo"), vorlage: "logo", an: true,
        anker: "tl", x: rund(clamp(num(wm.x, 86), 0, 98), 3), y: rund(clamp(num(wm.y, 80), 0, 98), 3),
        deckkraft: clamp(num(wm.op, 0.9), 0.05, 1), zeilen: [zeile("bild", { pfad: String(wm.path), b: w })],
      });
      if (frei) { o.schriftgroesse = rund(W / kurz, 3); o.innen = 0.9; }   // 1 em ≈ 1 % der Bildbreite (Pille 1,6/0,9 vw)
      aus.push(normalisieren(o));
    }
    // 5) Titel- und Schlusskarte des Schnell-Videos (§71)
    const sk = istDict(a.schnellkarte) ? a.schnellkarte : null;
    if (sk) {
      const ts = Math.max(0.5, num(sk.titel_s, 3));
      if (sk.titel_an && sk.titel) aus.push(normalisieren(Object.assign({}, STILE.ohne, {
        id: neueId("c"), stil: "ohne", name: t("container.v.titel", "Titel"), vorlage: "titel", anker: "tc", x: 0, y: 20,
        schriftgroesse: 8, textschatten: true, inhalt_h: "c", zeilen: [zeile("text", { text: sk.titel })],
        zeit: { von: { art: "video_start", wert: 0 }, bis: { art: "video_start", wert: ts } },
        blende: { ein: "none", aus: "fade", ein_s: 0.6, aus_s: 0.6 } })));
      if (sk.titel_an && sk.unter) aus.push(normalisieren(Object.assign({}, STILE.ohne, {
        id: neueId("c"), stil: "ohne", name: t("container.v.untertitel", "Untertitel"), vorlage: "titel", anker: "tc", x: 0,
        y: sk.titel ? 30 : 20, schriftgroesse: 3.6, textschatten: true, inhalt_h: "c", zeilen: [zeile("text", { text: sk.unter })],
        zeit: { von: { art: "video_start", wert: 0 }, bis: { art: "video_start", wert: ts } },
        blende: { ein: "none", aus: "fade", ein_s: 0.6, aus_s: 0.6 } })));
      const felder = (Array.isArray(sk.felder) ? sk.felder : []).filter(Boolean);
      if (sk.schluss_an && felder.length) {
        const hold = num(a.hold_s, 0);
        const map = { dist_total: "dist_total", elev_gain: "elev_gain", elev_loss: "elev_loss", moving_time: "moving_time",
                      duration: "duration", avg_speed: "avg_speed", date: "date" };
        const o = VORLAGEN.schluss(t);
        o.id = neueId("c");
        o.zeilen = felder.filter((f) => map[f]).map((f) => wert(map[f], "gesamt"));
        o.zeit = { von: { art: "video_ende", wert: Math.max(2.5, hold) }, bis: null };
        aus.push(normalisieren(o));
      }
    }
    const verlauf = frei
      ? { oben: { an: true, staerke: 0.62 }, unten: { an: true, staerke: 0.72 } }
      : { oben: { an: false, staerke: 0.62 }, unten: { an: false, staerke: 0.72 } };
    return { container: aus, verlauf, hinweise };
  }

  const api = { STILE, STIL_NAMEN, VORLAGEN, ANKER, ZEILEN_TYPEN, SCHRIFTEN,
                normalisieren, zeileNorm, liste, stilAnwenden, neu, zeile, wert, migrieren, timingBoxen, neueId };
  if (root) root.rzContainer = api;
})(typeof window !== "undefined" ? window : null);
