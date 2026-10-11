/* Schnell-Video — fertiges Tourvideo mit wenigen Entscheidungen (29.09.2026).
 *
 * Marc: Einstieg im Archiv und im Animator; Format 9:16 vorgewählt,
 * Länge Kurz/Normal/Lang, Qualität 1080/4K, Kartenstil wählbar (Hinweis bei fehlender
 * Video-Freigabe, rendern geht trotzdem), Titel + Unterzeile änderbar, zwei Häkchen für
 * Zahlen unterwegs / Höhenprofil, Schlusskarte mit ankreuzbaren Werten. Zwei Knöpfe:
 * „Video rendern" (live sichtbar, danach Speichern … / Teilen) und „Im Animator öffnen".
 * Das Projekt wird immer gespeichert („<Tour> · Schnell-Video", unter „Automatisch angelegt").
 *
 * Ablauf: Vorschlag holen (Backend) → Dialog → Animator-Konfiguration inkl. erzeugter
 * Kamerafahrt (Keyframes: Überblick → Flug entlang der Strecke → Schlussblick) → Projekt
 * anlegen (Backend) → über das Archiv öffnen (wie der Tour-Assistent) → auf Wunsch rendern
 * (window.__rzSchnellRender im Animator, Zwischendatei statt Speichern-Dialog).
 */
(function () {
  "use strict";
  const T = (k, f, v) => (typeof t === "function" ? t(k, f, v) : f);   // 08.10.2026 — auch mit Platzhaltern ({n})
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  /** 11.10.2026 — Symbole der Assistenten-Liste als Strich-Symbol (rzIcon), keine Emojis. */
  const vaIc = (n, g) => (typeof rzIcon === "function" && rzIcon(n, { size: g || 15 })) || "";
  const I = (n, g) => (typeof rzIcon === "function" ? rzIcon(n, { size: g || 14 }) : "");

  const FORMATE = { "9:16": [1080, 1920], "16:9": [1920, 1080], "1:1": [1080, 1080] };
  const LAENGEN = { kurz: 20, normal: 40, lang: 60 };
  const SCHLUSS_FELDER = ["dist_total", "elev_gain", "elev_loss", "moving_time", "duration", "avg_speed", "date"];
  const SCHLUSS_STANDARD = ["dist_total", "elev_gain", "moving_time"];
  const INTRO_S = 3, HOLD_S = 4, FPS = 30;
  // 05.10.2026 (Marc: „drei Vorlagen fürs Schnell-Video … richtig schön") —
  // eine Vorlage belegt die Zutaten vor (Q1 a, „Mehr" bleibt zum Anpassen), setzt den Look samt Kartenstil (Q2 a,
  // ui/js/looks.js), die Fotoart (Q3) und die Schrift der Zahlen (Q4 über den Look). Standard: Weite (Q5).
  const VORLAGEN = {
    weite:    { look: "natuerlich", musik: "builtin:panorama", fotoArt: "gross",      zahlen: false, profil: false, uebersicht: false,
                felder: ["dist_total", "elev_gain", "moving_time"] },
    tagebuch: { look: "reiseatlas", musik: "builtin:tagebuch", fotoArt: "sofortbild", zahlen: true,  profil: false, uebersicht: false,
                felder: ["dist_total", "elev_gain", "date"] },
    puls:     { look: "nachtkarte", musik: "builtin:puls",     fotoArt: "pip",        zahlen: true,  profil: true,  uebersicht: false,
                felder: ["dist_total", "elev_gain", "moving_time", "avg_speed"] },
  };
  const VORLAGE_NAMEN = Object.keys(VORLAGEN);
  const FOTO_ARTEN = ["gross", "sofortbild", "pip"];
  /** Kartenstil des Looks einer Vorlage (Q2 a). */
  function vorlageStil(n) {
    const L = window.rzLooks && window.rzLooks.LOOKS[(VORLAGEN[n] || VORLAGEN.weite).look];
    return (L && L.karte.map_style) || "free_satellite";
  }
  /** 07.10.2026 — Kartenlook der Vorlage (Rollen-Farben) für die Vorschau; null bei Luftbild. */
  function vorlageKartenlook(n) {
    const L = window.rzLooks && window.rzLooks.LOOKS[(VORLAGEN[n] || VORLAGEN.weite).look];
    const id = L && L.karte.map_style === "kartenlook" ? L.karte.kartenlook : null;
    return (id && window.rzKartenlook && window.rzKartenlook.LOOKS[id]) || null;
  }
  /** 08.10.2026 (Video-Assistent, Seite „Karte“) — Kartenstil und Kartenlook eines frei gewählten Looks. */
  function lookStil(look) {
    const L = window.rzLooks && window.rzLooks.LOOKS[look];
    return (L && L.karte.map_style) || "free_satellite";
  }
  function lookKartenlook(look) {
    const L = window.rzLooks && window.rzLooks.LOOKS[look];
    const id = L && L.karte.map_style === "kartenlook" ? L.karte.kartenlook : null;
    return (id && window.rzKartenlook && window.rzKartenlook.LOOKS[id]) || null;
  }
  // 01.10.2026 (Marc) — eigene Länge: mindestens Intro + Halten + 8 s Fahrt, höchstens 10 Minuten
  const LAENGE_MIN = INTRO_S + HOLD_S + 8, LAENGE_MAX = 600;
  const laengeKlemmen = (x) => Math.max(LAENGE_MIN, Math.min(LAENGE_MAX, Math.round(+x || 0)));
  /** Gesamtlänge in Sekunden: kurz/normal/lang · „eigen" (w.eigenS) · „animator" (w.animatorS, aus dem Animator). */
  function laengeS(w) {
    if (w.laenge === "eigen") return laengeKlemmen(w.eigenS);
    if (w.laenge === "animator" && w.animatorS) return laengeKlemmen(w.animatorS);
    return LAENGEN[w.laenge] || 40;
  }

  function datumText(v) {
    if (!v || !v.start_epoch) return "";
    try {
      const lang = (window.rzSprachCode ? window.rzSprachCode() : "de") || "de";
      const a = new Date(v.start_epoch * 1000), voll = { day: "numeric", month: "long", year: "numeric" };
      // 11.10.2026 (Testvideo Schottland) — Reisen über mehrere Tage: „5. Juli – 9. August 2026“
      if (v.end_epoch && v.end_epoch - v.start_epoch > 36 * 3600) {
        const e = new Date(v.end_epoch * 1000);
        if (a.getFullYear() === e.getFullYear()) return a.toLocaleDateString(lang, { day: "numeric", month: "long" }) + " – " + e.toLocaleDateString(lang, voll);
        return a.toLocaleDateString(lang, voll) + " – " + e.toLocaleDateString(lang, voll);
      }
      return a.toLocaleDateString(lang, voll);
    } catch (_) { return ""; }
  }
  /** 11.10.2026 (Testvideo Schottland: „Norderstedt · Ludgershall · Dalnaspidal · … , Schleswig-Holstein · England · Schottland“)
   *  — Ort für die Unterzeile: kurz lassen, sonst die Gegend (nach dem Komma), höchstens die letzten zwei Teile. */
  function ortKurz(ort) {
    ort = String(ort || "").trim();
    if (ort.length <= 40) return ort;
    let k = ort.includes(", ") ? ort.slice(ort.lastIndexOf(", ") + 2) : ort;
    const teile = k.split(" · ");
    if (k.length > 40 || teile.length > 2) k = teile.slice(-2).join(" · ");
    return k.length > 40 ? k.slice(0, 40).replace(/\s+\S*$/, "") + " …" : k;
  }

  /** Diagonale der Tour in km (Haversine über die Bounding-Box). */
  function diagonaleKm(b) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b[3] - b[1]) * rad, dLon = (b[2] - b[0]) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(b[1] * rad) * Math.cos(b[3] * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  /** Kamerafahrt als Keyframes (Q7): Überblick → Flug entlang der Strecke → Schlussblick.
   *  Anker: 0…1 = Strecke, < 0 Intro, > 1 Halten (je Sekunde 1/Animationsdauer, wie im Animator).
   *  Zoom als Versatz zur Einpass-Kamera der Tour → passt für jedes Format. center null = Track-Punkt
   *  (mit „Kamera folgt Track"); gemischte Abschnitte blendet der Animator selbst über. */
  /** 11.10.2026 — `opt` nur aus dem Video-Assistenten: `momente` = [{bei, bewegung}] ersetzt den
   *  festen Gipfel-Shot (Bewegung je Moment: panorama · nah · ruhig), `lebendig` 0…1 (0,5 = wie bisher) macht die Fahrt
   *  näher und steiler bzw. weiter und flacher. */
  function kamerafahrt(bbox, animS, regie, opt) {
    const anker = (s) => s < INTRO_S ? -(INTRO_S - s) / animS
      : (s <= INTRO_S + animS ? (s - INTRO_S) / animS : 1 + (s - INTRO_S - animS) / animS);
    const mitte = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
    // 30.09.2026 (Marc, Vergleich mit Komoot: „die Kamera fliegt tiefer, mehr über den Track") — eine halbe Stufe
    // näher und 45° statt 55°: steiler von oben, kaum Horizont. Getestet: +1 Stufe war im steilen Gelände zu nah.
    const leb = (opt && isFinite(+opt.lebendig)) ? Math.max(0, Math.min(1, +opt.lebendig)) : 0.5;
    const zNah = Math.max(1.5, Math.min(5, Math.log2(Math.max(0.5, diagonaleKm(bbox)) / 2) + 0.5)) + (leb - 0.5) * 1.2;
    const NEIGUNG = Math.round(45 + (leb - 0.5) * 24);
    const punkte = [
      { s: 0, c: mitte, z: -0.15, p: 25, b: 0, e: "linear" },                       // Überblick
      { s: 1.2, c: mitte, z: -0.15, p: 25, b: 0, e: "linear" },                     // … kurz stehen
      { a: 0, c: null, z: zNah, p: NEIGUNG, b: 0, e: "ease_in_out" },                    // hinein zum Start (Richtung: __rzSchnellKamera)
      { a: 1, c: null, z: zNah, p: NEIGUNG, b: 0, e: "linear" },                         // Ziel
      // 05.10.2026 (Auto-Regie §8.4 „Gipfel-Shot") — am höchsten Punkt kurz aufziehen und zum Horizont neigen:
      // Panorama statt Draufsicht, dann zurück in die Verfolgung (die Tempo-Regie verweilt dort)
      ...((opt && Array.isArray(opt.momente)) ? momentShots(opt.momente, zNah, NEIGUNG, animS) : gipfelShot(regie, zNah, NEIGUNG, animS)),
      { s: INTRO_S + animS + 1.8, c: mitte, z: -0.15, p: 25, b: 0, e: "ease_in_out" }, // zurück in die Gesamtsicht
      { s: INTRO_S + animS + HOLD_S, c: mitte, z: -0.15, p: 25, b: 0, e: "linear" },
    ];
    const ev = [];
    for (const k of punkte) {
      const a = Math.round((k.a != null ? k.a : anker(k.s)) * 1e6) / 1e6;
      ev.push({ kind: "pitch", anchor: a, value: k.p, easing: k.e });
      ev.push({ kind: "bearing", anchor: a, value: k.b, easing: k.e });
      ev.push({ kind: "zoom", anchor: a, value_offset: k.z, easing: k.e });
      ev.push({ kind: "center", anchor: a, value: k.c ? k.c.slice() : null, easing: k.e });
    }
    return ev.sort((x, y) => x.anchor - y.anchor);
  }
  /** Bewegungen je Moment (Assistent): panorama = aufziehen und zum Horizont neigen (wie der Gipfel-Shot), nah = näher
   *  heran und steiler, ruhig = nichts Eigenes. Momente, die zu dicht am Rand oder am vorigen liegen, entfallen. */
  const BEWEGUNGEN = ["panorama", "nah", "ruhig"];
  function momentShots(momente, zNah, neigung, animS) {
    const d = Math.min(0.04, 2.5 / Math.max(1, animS)), raus = [];
    let letzt = -1;
    for (const m of (momente || []).filter(x => x && isFinite(+x.bei)).sort((a, b) => a.bei - b.bei)) {
      const bei = +m.bei;
      if (m.bewegung === "ruhig" || !BEWEGUNGEN.includes(m.bewegung)) continue;
      if (bei - 2 * d <= 0.02 || bei + 2 * d >= 0.98 || bei - 2 * d < letzt) continue;
      const z = m.bewegung === "panorama" ? zNah - 1.1 : zNah + 0.9, p = m.bewegung === "panorama" ? 62 : Math.min(62, neigung + 10);
      raus.push({ a: bei - 2 * d, c: null, z: zNah, p: neigung, b: 0, e: "ease_in_out" },
                { a: bei - d / 3, c: null, z, p, b: 0, e: "ease_in_out" },
                { a: bei + d / 3, c: null, z, p, b: 0, e: "ease_in_out" },
                { a: bei + 2 * d, c: null, z: zNah, p: neigung, b: 0, e: "ease_in_out" });
      letzt = bei + 2 * d;
    }
    return raus;
  }
  /** Keyframe-Punkte des Gipfel-Shots (leer ohne höchsten Punkt oder zu nah am Rand). Breite ~2,5 s Fahrt, höchstens
   *  4 % der Strecke; Zoom eine Stufe weiter, Neigung 62°. */
  function gipfelShot(regie, zNah, neigung, animS) {
    const h = (regie || []).find(r => r && r.art === "hoechster" && isFinite(+r.bei));
    if (!h) return [];
    const bei = +h.bei, d = Math.min(0.04, 2.5 / Math.max(1, animS));
    if (bei - 2 * d <= 0.02 || bei + 2 * d >= 0.98) return [];
    return [
      { a: bei - 2 * d, c: null, z: zNah, p: neigung, b: 0, e: "ease_in_out" },
      { a: bei - d / 3, c: null, z: zNah - 1.1, p: 62, b: 0, e: "ease_in_out" },
      { a: bei + d / 3, c: null, z: zNah - 1.1, p: 62, b: 0, e: "ease_in_out" },
      { a: bei + 2 * d, c: null, z: zNah, p: neigung, b: 0, e: "ease_in_out" },
    ];
  }

  /** 29.09.2026 — Spur glätten je nach Tourgröße. 30.09.2026 (Marc wählte im Vergleichsclip „rechts“): doppelt so
   *  stark wie zuerst (~40 m Wanderung … ~200 m lange Radtour), damit Linie und Pfeil dieselbe ruhige Form haben. */
  function spurGlattM(bbox) {
    return Math.max(30, Math.min(200, Math.round(28 * Math.sqrt(Math.max(0.1, diagonaleKm(bbox))) / 5) * 5));
  }

  /** Meter Strecke je Sekunde Animation (Streckenlänge aus dem Vorschlag, sonst Diagonale × 2,5). */
  function mProS(v, animS) {
    const m = (+v.distance_km > 0) ? +v.distance_km * 1000 : diagonaleKm(v.bbox) * 2500;
    return m / Math.max(1, animS);
  }

  /** 30.09.2026 (Marc: „das Schnell-Video muss ein ganz normales Animator-Projekt sein, das man
   *  langsam von Hand nachbauen kann") — die Einblendungen sind normale Container aus den Vorlagen
   *  des Animators (ui/js/container.js), nur vorbelegt: Logo-Plakette oben mittig, darunter die
   *  Werte (Stil „Frei"), Höhenprofil unten breit, Titel, Untertitel, Schlusskarte, Nordpfeil +
   *  Maßstab. Kurze Bildseite = 1080 px in allen Formaten → Maße in cqmin passen überall. */
  function einblendungen(w) {
    const C = window.rzContainer;
    if (!C) return [];
    const S = C.STILE, liste = [];
    const breit = { "9:16": 30, "1:1": 22, "16:9": 15 }[w.format] || 22;   // Logo-Breite in % der Bildbreite
    // 02.10.2026 (Marc: „wo kommt die dunkle Hinterlegung des Logos her? … das sieht blöd aus, lass das weg") —
    // Stil „Ohne" statt „Plakette"; wer auf heller Karte eine Unterlage will, stellt im Animator den Stil um.
    const logo = C.stilAnwenden(C.neu("logo", T), "ohne");
    Object.assign(logo, { anker: "tc", x: 0, y: 2.5, deckkraft: 1, innen: 0.5, schriftgroesse: 1.6 });
    logo.zeilen[0].b = breit;
    liste.push(C.normalisieren(logo));
    const y2 = w.format === "16:9" ? 13 : w.format === "1:1" ? 12 : 9;   // unter der Plakette
    const vl = VORLAGEN[w.vorlage] ? w.vorlage : "weite";
    if (w.zahlen && vl === "weite") liste.push(C.normalisieren(Object.assign({}, S.frei, {
      stil: "frei", vorlage: "live", name: T("container.v.live", "Live-Werte"), anker: "tc", x: 0, y: y2, inhalt_h: "c",
      zeilen: [C.wert("dist_done", "live"), C.wert("asc_done", "live"), C.wert("time_elapsed", "live")] })));
    // 05.10.2026 — Tagebuch: dezentes Kärtchen oben links (zwei Werte); Puls: flache Datenleiste unten über dem Profil
    if (w.zahlen && vl === "tagebuch") liste.push(C.normalisieren(Object.assign({}, S.kasten, {
      stil: "kasten", vorlage: "live", name: T("container.v.live", "Live-Werte"), anker: "tl", x: 4, y: y2 + 1,
      schriftgroesse: 2.6, beschriftung: "oben", anordnung: "neben", innen: 0.7, ecken: 0.4,
      zeilen: [C.wert("dist_done", "live"), C.wert("asc_done", "live")] })));
    if (w.zahlen && vl === "puls") liste.push(C.normalisieren(Object.assign({}, S.kasten, {
      stil: "kasten", vorlage: "live", name: T("container.v.live", "Live-Werte"), anker: "bc", x: 0,
      y: w.profil ? ({ "9:16": 14, "1:1": 19, "16:9": 21 }[w.format] || 17) : 3, inhalt_h: "c",   // über der Profil-Kopfzeile
      schriftgroesse: w.format === "16:9" ? 3.2 : 3.0, beschriftung: "oben", anordnung: "neben", innen: 0.6, ecken: 0.35,
      zeilen: [C.wert("dist_done", "live"), C.wert("asc_done", "live"), C.wert("speed", "live")]
        .concat(w.format === "9:16" ? [] : [C.wert("time_elapsed", "live")]) })));   // hochkant schmaler: drei Werte
    // Höhenprofil links unten, endet vor Nordpfeil + Maßstab rechts unten (Maßstab beginnt bei
    // ~76 % der Breite in 9:16, ~78 % in 1:1, ~87 % in 16:9 — gemessen im Render 30.09.2026)
    const profilB = { "9:16": 70, "1:1": 72, "16:9": 80 }[w.format] || 72;
    if (w.profil) liste.push(C.normalisieren(Object.assign({}, S.frei, {
      stil: "frei", vorlage: "hoehe", name: T("container.v.hoehe", "Höhenprofil"), anker: "bl", x: 3, y: 3, inhalt_h: "l",
      anordnung: "unter", beschriftung: "aus", schriftgroesse: 1.3, zeilenabstand: 0.4,
      zeilen: [C.zeile("text", { text: T("container.v.hoehe_kopf", "HÖHENPROFIL · Min {ele_low} · Max {ele_high}") }),
               C.zeile("diagramm", { art: "hoehe", b: profilB, h: 9, linienfarbe: "#ffffff" })] })));
    // 02.10.2026 (Marc: „im 16:9 liegen Titel und Untertitel übereinander") — EINE Einblendung mit zwei Zeilen:
    // bricht der Titel um, rutscht der Untertitel mit (vorher zwei Einblendungen mit fester Höhe).
    const unter = w.textMenge === "wenige" ? "" : w.unter;   // 11.10.2026 — Assistent „Texte: wenige“ = nur der Titel
    if (w.titel || unter) {
      const ti = C.neu("titel", T);
      ti.zeilen = [];
      if (w.titel) ti.zeilen.push(C.zeile("text", { text: w.titel }));
      if (unter) ti.zeilen.push(C.zeile("text", { text: unter, gr: w.titel ? 0.45 : 1 }));
      if (!w.titel) ti.schriftgroesse = 3.6;
      ti.zeilenabstand = 0.15;
      ti.zeit = { von: { art: "video_start", wert: 0 }, bis: { art: "video_start", wert: INTRO_S } };
      liste.push(C.normalisieren(ti));
    }
    // 11.10.2026 (Assistent „Texte“) — Kapiteltitel je Reisetag an der Stelle, an der der Tag beginnt (2,5 s)
    for (const k of (w.kapitelTitel || [])) {
      const kt = C.neu("titel", T);
      kt.name = k.text;
      kt.zeilen = [C.zeile("text", { text: k.text })];
      Object.assign(kt, { schriftgroesse: 4.4, y: 14 });
      const animS = Math.max(8, laengeS(w) - INTRO_S - HOLD_S);
      kt.zeit = { von: { art: "strecke", wert: k.bei }, bis: { art: "strecke", wert: Math.min(1, k.bei + 2.5 / animS) } };
      kt.blende = { ein: "fade", aus: "fade", ein_s: 0.5, aus_s: 0.5 };
      liste.push(C.normalisieren(kt));
    }
    // 02.10.2026 — Zutat „Übersichtskarte": quadratisch, ~28 % der kurzen Bildseite, oben rechts
    if (w.uebersicht) {
      const [bw, bh] = FORMATE[w.format] || FORMATE["9:16"];
      const kante = 0.28 * Math.min(bw, bh);
      const ue = C.neu("uebersicht", T);
      // Hochkant/quadratisch ist die Zahlenreihe so breit, dass sie oben rechts unter der Karte läge
      // (Teide-Demo 02.10.2026: „VERGANGEN" abgeschnitten) — dann unter die Zahlen rücken.
      const unterZahlen = w.zahlen && (w.format === "9:16" || w.format === "1:1");
      Object.assign(ue, { anker: "tr", x: 3, y: unterZahlen ? y2 + (w.format === "9:16" ? 5 : 7) : 3 });
      ue.zeilen[0].b = Math.round(kante / bw * 1000) / 10;
      ue.zeilen[0].h = Math.round(kante / bh * 1000) / 10;
      ue.zeilen[0].linienfarbe = "#ff6b35";
      liste.push(C.normalisieren(ue));
    }
    if (w.schlussAn && w.felder.length) {
      const sk = C.neu("schluss", T);
      sk.zeilen = w.felder.map(f => C.wert(f, "gesamt"));
      sk.zeit = { von: { art: "video_ende", wert: HOLD_S }, bis: null };
      // 05.10.2026 — Weite: wenige große Zahlen frei in einer ruhigen Zeile; Tagebuch: Fazit mit Titel (Handschrift
      // über den Look); Puls: kompakte Übersicht. Hochkant stehen die Werte bei Weite untereinander.
      if (vl === "weite") Object.assign(sk, S.frei, { stil: "frei", schriftgroesse: w.format === "9:16" ? 7.5 : 6.5,
        anordnung: w.format === "9:16" ? "unter" : "neben", beschriftung: "oben", inhalt_h: "c", textschatten: true, zeilenabstand: 0.5 });
      if (vl === "tagebuch") {
        if (w.titel) sk.zeilen.unshift(C.zeile("text", { text: w.titel, gr: 0.75 }));
        Object.assign(sk, { schriftgroesse: 4.4, anordnung: "unter", beschriftung: "links", zeilenabstand: 0.45, innen: 1 });
      }
      if (vl === "puls") Object.assign(sk, { schriftgroesse: w.format === "9:16" ? 4.2 : 4.6, anordnung: w.format === "9:16" ? "unter" : "neben",
        beschriftung: "oben", innen: 0.8 });
      liste.push(C.normalisieren(sk));
    }
    // 05.10.2026 — Puls: Fotos als kleines Bild im Bild oben rechts, ohne Halt (w.pip, aus pipFotos)
    for (const f of (w.pip || [])) {
      const breiteBild = { "9:16": 42, "1:1": 32, "16:9": 24 }[w.format] || 30;
      liste.push(C.normalisieren(Object.assign({}, S.kasten, {
        stil: "kasten", vorlage: "foto", name: T("schnell.pip_name", "Foto") + " · " + String(f.path).split(/[\\/]/).pop(),
        anker: "tr", x: 4, y: y2 + 1, innen: 0.25, ecken: 0.35, schatten: true, hg_deckkraft: 0.6, unschaerfe: false,
        zeilen: [C.zeile("bild", { pfad: f.path, b: breiteBild })].concat(f.ort ? [C.zeile("text", { text: f.ort, gr: 0.9 })] : []),
        schriftgroesse: 2.2, inhalt_h: "c", zeilenabstand: 0.25,
        zeit: { von: { art: "strecke", wert: Math.max(0, +f.von) }, bis: { art: "strecke", wert: Math.min(1, +f.bis) } },
        blende: { ein: "both", aus: "fade", ein_s: 0.35, aus_s: 0.4 } })));
    }
    liste.push(C.neu("nord", T));
    return liste;
  }

  /** Animator-Einstellungen des Schnell-Video-Projekts (Backend-Schlüssel, wie app.py sie kennt). */
  function animatorPatch(w, v) {
    const roh = animatorPatchRoh(w, v);
    // 05.10.2026 — der Look der Vorlage (Karte, Linie, Verläufe, Schrift/Farben der Einblendungen); der Kartenstil
    // bleibt, was im Dialog steht (die Vorlage hat ihn vorgewählt, Q2 a — wer ihn ändert, behält seine Wahl)
    const look = w.look || (VORLAGEN[w.vorlage] || VORLAGEN.weite).look;   // 08.10.2026 — Assistent: frei gewählter Look
    if (!window.rzLooks) return roh;
    const o = window.rzLooks.anwenden(look, roh);
    o.map_style = w.stil;
    return o;
  }
  function animatorPatchRoh(w, v) {
    const [bw, bh] = FORMATE[w.format] || FORMATE["9:16"];
    const f = w.qualitaet === "4k" ? 2 : 1;
    const gesamt = laengeS(w);
    const animS = Math.max(8, gesamt - INTRO_S - HOLD_S);
    return {
      width: bw * f, height: bh * f, fps: FPS,
      map_style: w.stil,
      intro_s: INTRO_S, hold_s: HOLD_S, duration_s: animS,
      keyframes_enabled: true,
      kamera_vorgabe: "fahrt",   // 07.10.2026 (Klicktest) — Kamera-Pille zeigt „Kamerafahrt“, nicht ein altes „Start → Ziel“
      timeline_events: kamerafahrt(v.bbox, animS, w.tempoRegie ? v.regie : null, w.kamOpt || null),
      camera_follow_track: true,
      // 08.10.2026 (Video-Assistent, Seite „Kamera“) — Folgen / Fest statt der Kamerafahrt
      ...(w.kamera === "folgen" ? { keyframes_enabled: false, kamera_vorgabe: "folgen", timeline_events: [], camera_follow_track: true } : {}),
      ...(w.kamera === "fest" ? { keyframes_enabled: false, kamera_vorgabe: "fest", timeline_events: [], camera_follow_track: false } : {}),
      // 29.09.2026 (Marc: „mach als Trackpunkt den Pfeil und flieg die Kamera immer dem Pfeil hinterher,
      // reduziere den Track, dass der Pfeil ruhig bleibt") — Pfeil mit größter Ruhe, geglättete Spur,
      // ruhige Kamera (dichte Stützstellen + Gelände-Tiefpass). Die Blickrichtung setzt der Animator
      // nach dem Öffnen aus der geglätteten Fahrtrichtung (window.__rzSchnellKamera).
      marker_dot_show: true, marker_dot_style: "arrow", marker_dot_size: 1.4, marker_dot_smooth: 10,
      spur_glaetten_m: spurGlattM(v.bbox),
      // Pfeilrichtung über ~0,4 s Fahrt geglättet, Kamera schaut auf eine Bahn über ~0,5 s Fahrt (gemessen: Karte zuckt 2,5–4 statt 16 ‰, Pfeil bleibt nahe der Mitte):
      // bei 20 s über 25 km fliegt der Pfeil ~60 m je Bild — eine feste Ruhe-Stufe reicht da nicht.
      // 30.09.2026 (Marc: „die Pfeilrichtung läuft manchmal nicht genau mit der Strecke, wirkt aufgesetzt … der muss
      // schön in die richtige Richtung gucken"): Richtung aus dem RÜCKBLICK auf die gezeichnete Linie (¾ der
      // Spur-Glättung, util.js kursRueckblickAn) — gemessen Abweichung zur Linie im Median < 1° (vorher 25°).
      // Kamerabahn etwas enger (~0,35 s Fahrt), weil die Kamera näher ist — sonst wandert der Pfeil weit aus der Mitte.
      marker_dot_rueckblick_m: Math.round(0.75 * spurGlattM(v.bbox)),
      camera_follow_glatt_m: Math.round(Math.max(50, Math.min(3000, 0.35 * mProS(v, animS))) / 25) * 25,
      smooth_camera_3d: true,
      // 29.09.2026 (Marc: „Straßen, Orte, Grenzen usw. alles ausblenden beim Schnell-Video") — nur Landschaft
      // und Strecke. Dieselben Schalter wie Karte → „Alle aus" im Animator (Straßen-/Bahnlinien inklusive).
      show_place_labels: false, show_road_labels: false, show_poi_labels: false,
      show_transit_labels: false, show_admin_boundaries: false,
      // Im Überblick sieht man sofort die ganze Runde: blass im Hintergrund, darüber zeichnet sich die Linie.
      ghost_track_enabled: true, ghost_track_opacity_pct: 50,
      // 30.09.2026 — Einblendungen als normale Container + dunkle Verläufe oben/unten
      container: einblendungen(w), container_v: 1,
      verlauf: { oben: { an: true, staerke: 0.62 }, unten: { an: true, staerke: 0.72 } },
      // 30.09.2026 — Highlights aus dem Track wie bei Komoot (Animator: _hlAnwenden)
      highlights_enabled: !!w.highlights,   // werden beim Öffnen zu Schildern (Animator: _hlSchilderAbgleichen)
      highlights_arten: ["hoechster", "steilste", "schnellste", "halbe", "wegpunkte"],
      highlights_stil: "pille", highlights_farbmodus: "eine", highlights_farbe: "#ffc21a",
      // 02.10.2026 — Zutat „Musik": eigenes Stück der App (oder eigene Datei), Klick bei jedem Foto
      ton_musik_an: !!w.musikAn, ton_musik: w.musik || "builtin:unterwegs", ton_musik_laut: 70,
      // 03.10.2026 — Zutat „3D-Häuser" (Gebäude aus OpenStreetMap in Dachfarbe)
      gebaeude_3d: !!w.gebaeude, gebaeude_wachsen: false,
      // 05.10.2026 — Tempo-Regie (Höhepunkte + Fotos ohne Halt langsamer), nur wenn angehakt
      tempo_eintraege: w.tempoRegie ? tempoRegie(((v && v.regie) || []).map(r => r.bei).concat((w.pip || []).map(p => (p.von + p.bis) / 2)).concat(w.regieFotos || [])) : [],
      ton_musik_ein: 1, ton_musik_aus: Math.min(3, HOLD_S), ton_klick_an: !!w.klick, ton_klick_laut: 25, ton_klick_klang: w.vorlage && w.vorlage !== "weite" ? "builtin:klick_k" : "builtin:klick_a",   // Marc: A, „ganz subtil"; Tagebuch/Puls: weicher Einblendton
    };
  }

  function stilOptionen(gewaehlt) {
    const cat = (typeof mapCatalog === "function" ? mapCatalog() : null) || {};
    const styles = (cat.styles || []).filter(s => s.available !== false && s.key !== "alpha");
    return styles.map(s => `<option value="${esc(s.key)}"${s.key === gewaehlt ? " selected" : ""}>${esc(T("mapstyle." + s.key, s.label || s.key))}</option>`).join("");
  }

  function knopfReihe(name, werte, aktiv) {
    return `<div class="sv-reihe" data-sv-gruppe="${name}">` + werte.map(([v, l]) =>
      `<button type="button" class="btn btn-small sv-wahl${v === aktiv ? " is-on" : ""}" data-sv-wert="${esc(v)}">${esc(l)}</button>`).join("") + "</div>";
  }

  async function warteAufAnimator(pid, sek) {
    const bis = Date.now() + sek * 1000;
    while (Date.now() < bis) {
      try { if (typeof window.__rzSchnellBereit === "function" && window.__rzSchnellBereit(pid)) return true; } catch (_) {}
      await new Promise(r => setTimeout(r, 400));
    }
    return false;
  }

  /** 30.09.2026 (Marc: „Wenn ich Schnell-Video mache, geht er kurz zum Animator … dann springt er zum
   *  Rendern, da haben wir ein großes schwarzes Loch … es sieht so aus, als müsste man da etwas tun"):
   *  eigener Bildschirm über der ganzen App — Titel, Kartenbild, Schritte, Live-Bild, am Ende Speichern /
   *  Teilen. Der Animator arbeitet unsichtbar dahinter (derselbe Render-Weg wie bisher). z-index unter den
   *  Modalen (1000), damit Fehler-Fenster und Systemdialoge darüber erscheinen. */
  function buehne(titel) {
    const el = document.createElement("div");
    el.className = "sv-buehne"; el.id = "sv-buehne";
    el.innerHTML = `<div class="sv-b-kopf">🎬 ${esc(T("schnell.titel_dialog", "Schnell-Video"))}<span>${esc(titel)}</span></div>
      <div class="sv-b-bild"><img alt="" hidden><video controls playsinline hidden></video><div class="sv-b-text"></div></div>
      <div class="sv-b-fuss">
        <div class="sv-b-balken"><div></div></div>
        <div class="sv-b-status"></div>
        <div class="sv-b-knoepfe">
          <button type="button" class="btn" data-b="abbrechen">⨯ ${esc(T("animator.btn.cancel", "Abbrechen"))}</button>
          <button type="button" class="btn btn-primary" data-b="speichern" hidden>💾 ${esc(T("schnell.speichern", "Speichern …"))}</button>
          <button type="button" class="btn" data-b="teilen" hidden>📤 ${esc(T("schnell.teilen", "Teilen"))}</button>
          <button type="button" class="btn" data-b="animator" hidden>${esc(T("schnell.im_animator", "Im Animator öffnen"))}</button>
          <button type="button" class="btn" data-b="schliessen" hidden>${esc(T("common.close", "Schließen"))}</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    const $ = (q) => el.querySelector(q);
    const img = $(".sv-b-bild img"), vid = $(".sv-b-bild video"), txt = $(".sv-b-text");
    const knopf = (k) => el.querySelector(`[data-b="${k}"]`);
    let hatLiveBild = false;
    const api_ = {
      el,
      schritt(text) { $(".sv-b-status").textContent = text || ""; if (!hatLiveBild) txt.textContent = text || ""; },
      fortschritt(p) { $(".sv-b-balken div").style.width = Math.round(Math.max(0, Math.min(1, p)) * 100) + "%"; },
      startbild(url) { if (!url || hatLiveBild) return; img.src = url; img.hidden = false; img.classList.add("ist-startbild"); },
      livebild(b64) { hatLiveBild = true; img.src = "data:image/jpeg;base64," + b64; img.hidden = false; img.classList.remove("ist-startbild"); txt.textContent = ""; },
      knopf,
      fertig(url) {
        txt.textContent = ""; img.hidden = true; vid.hidden = false; vid.src = url; try { const pr = vid.play(); if (pr && pr.catch) pr.catch(() => {}); } catch (_) {}
        knopf("abbrechen").hidden = true; ["speichern", "teilen", "animator", "schliessen"].forEach(k => { knopf(k).hidden = false; });
      },
      fehler(text) { txt.textContent = text; img.classList.add("ist-startbild"); knopf("abbrechen").hidden = true; knopf("schliessen").hidden = false; },
      zu() { try { vid.pause(); } catch (_) {} el.remove(); },
    };
    return api_;
  }

  /** 01.10.2026 (Marc: „das Schnell-Video wie bei Relive mit Fotos pimpen") — Fotostopps. Jedes gewählte Foto
   *  wird ein Foto-Schild mit Häkchen „Fotostopp" (dasselbe, was man im Animator von Hand setzt). Ein Stopp
   *  hält 3 s an (An- und Abflug laufen seit 02.10.2026 während der Fahrt) und wird von der Länge ABGEZOGEN
   *  (Marc, Q3) — deshalb höchstens so viele, dass für die Strecke die Hälfte der Animationszeit bleibt;
   *  bei Überzahl gehen die besten vor. */
  const STOPP = { sek: 3, anflug: 1, abflug: 1 };
  const STOPP_KOSTEN = STOPP.sek;   // nur der Halt verlängert; An-/Abflug während der Fahrt
  function fotostoppSchilder(fotos, animS) {
    const max = Math.max(0, Math.floor(animS * 0.5 / STOPP_KOSTEN));
    const wahl = (fotos || []).slice().sort((a, b) => (b.wert || 0) - (a.wert || 0) || a.bei - b.bei).slice(0, max)
      .sort((a, b) => a.bei - b.bei);
    return wahl.map(f => ({
      text: String(f.text || "").trim(), imageSrc: f.path, lat: f.lat, lon: f.lon, anchorMode: "track", style: "callout", imageSize: 44,
      // kleines Foto-Schild: kurz vorher auf, nach dem Stopp wieder weg — sonst stehen am Ende alle Karten
      // auf der Gesamtsicht und verdecken die Schlusskarte (01.10.2026, Teide-Demo)
      entry: "pop", before: 0.6, after: 1.5, exit: "pop", exit_s: 0.4,
      stopp: true, stopp_s: STOPP.sek, stopp_anflug_s: STOPP.anflug, stopp_abflug_s: STOPP.abflug, stopp_zoom: 1.5, stopp_schwenk: 2, stopp_ken: 8,
      stopp_ortzeit: true, stopp_exif: false,
      ...(String(f.text || "").trim() ? { __eigenText: true } : {}),   // F-5: eigene Unterschrift bleibt (Logbuch überschreibt nicht)
    }));
  }

  /** 02.10.2026 (Marc: „Videos wäre auch noch was") — ein Clip ist ein Fotostopp mit Bewegtbild: der Halt dauert
   *  so lange wie der Ausschnitt (höchstens 4 s, aus dem ersten Viertel des Clips), kein Ken-Burns. */
  const CLIP_S = 4;
  function clipSchild(c, mitTon) {
    const lang = Math.max(0.5, +c.dauer || CLIP_S);
    const dauer = Math.round(Math.min(CLIP_S, lang) * 10) / 10;
    const ab = Math.round(Math.max(0, (lang - dauer) * 0.25) * 10) / 10;
    return {
      text: "", imageSrc: c.standbild, lat: c.lat, lon: c.lon, anchorMode: "track", style: "callout", imageSize: 44,
      entry: "pop", before: 0.6, after: 1.5, exit: "pop", exit_s: 0.4,
      stopp: true, stopp_s: dauer, stopp_anflug_s: STOPP.anflug, stopp_abflug_s: STOPP.abflug, stopp_zoom: 1.5, stopp_schwenk: 1.5, stopp_ken: 0,
      stopp_ortzeit: true, stopp_exif: false,
      clip: { pfad: c.path, ab, dauer, laenge: lang, ton: !!(mitTon && c.ton), laut: 1 },
    };
  }
  /** Fotos und Clips teilen sich das Zeitbudget (die Hälfte der Animation): die besten zuerst (Clips +1),
   *  nie zwei Stopps direkt hintereinander (4 % der Strecke Abstand). `__bei` = Stelle, nur für die Zuordnung. */
  /** `opt` (Video-Assistent, 11.10.2026): `faktor` = weniger↔mehr (1 = bisher), `kapitel` = Anfänge der Reisetage —
   *  dann zuerst das beste Foto je Kapitel, damit kein Tag leer bleibt, danach wie bisher nach Wert. */
  function kapitelZuerst(kand, kapitel) {
    if (!Array.isArray(kapitel) || kapitel.length < 2) return kand;
    const grenzen = kapitel.slice().sort((a, b) => a - b).concat([1.0001]);
    const erste = [];
    for (let k = 0; k < grenzen.length - 1; k++) {
      const best = kand.filter(x => x.bei >= grenzen[k] && x.bei < grenzen[k + 1]).sort((a, b) => b.wert - a.wert)[0];
      if (best) erste.push(best);
    }
    return erste.sort((a, b) => b.wert - a.wert).concat(kand.filter(x => !erste.includes(x)));
  }
  function stoppsWaehlen(fotos, clips, animS, mitTon, opt) {
    const budget = Math.max(0, animS * 0.5 * ((opt && opt.faktor) || 1));
    const kand = [].concat(
      (fotos || []).map(f => ({ art: "foto", f, kosten: STOPP_KOSTEN, wert: +f.wert || 0, bei: +f.bei })),
      (clips || []).map(c => ({ art: "clip", f: c, kosten: Math.min(CLIP_S, Math.max(0.5, +c.dauer || CLIP_S)), wert: (+c.wert || 0) + 1, bei: +c.bei })));
    kand.sort((a, b) => b.wert - a.wert || a.bei - b.bei);
    let summe = 0;
    const wahl = [];
    for (const k of kapitelZuerst(kand, opt && opt.kapitel)) {
      if (summe + k.kosten > budget + 1e-6) continue;
      if (wahl.some(x => Math.abs(x.bei - k.bei) < 0.04)) continue;
      wahl.push(k); summe += k.kosten;
    }
    wahl.sort((a, b) => a.bei - b.bei);
    return wahl.map(k => Object.assign(k.art === "clip" ? clipSchild(k.f, mitTon) : fotostoppSchilder([k.f], 1e9)[0], { __bei: k.bei }));
  }
  /** 05.10.2026 (Vorlagen Tagebuch/Puls) — Fotos OHNE Halt: die Fahrt läuft weiter, das Foto steht ~3 s. Kostet keine
   *  Länge; damit es nicht wimmelt, höchstens eins je 4 s Animation und 6 % Strecke Abstand (auch zu Clip-Stopps).
   *  Liefert {f, bei, von, bis} — von/bis als Streckenanteil (für das Bild im Bild). */
  const OHNE_HALT_S = 3.2;
  function fotosOhneHalt(fotos, animS, belegt, opt) {
    const max = Math.max(0, Math.floor(animS / 4 * ((opt && opt.faktor) || 1)));
    const kand = (fotos || []).map(f => ({ f, bei: +f.bei, wert: +f.wert || 0 })).filter(k => isFinite(k.bei))
      .sort((a, b) => b.wert - a.wert || a.bei - b.bei);
    const wahl = [], besetzt = (belegt || []).slice();
    for (const k of kapitelZuerst(kand, opt && opt.kapitel)) {
      if (wahl.length >= max) break;
      if (besetzt.some(b => Math.abs(b - k.bei) < 0.06)) continue;
      wahl.push(k); besetzt.push(k.bei);
    }
    const spanne = OHNE_HALT_S / Math.max(1, animS);
    return wahl.sort((a, b) => a.bei - b.bei).map(k => ({ f: k.f, bei: k.bei, von: Math.max(0, k.bei - 0.004), bis: Math.min(1, k.bei + spanne) }));
  }
  /** Sofortbild-Schild an der Strecke (wie ein neues Foto-Schild im Animator: aufpoppen, kurz groß, zum Mini schrumpfen). */
  // 07.10.2026 (Web-Fund F-5) — Größe des Sofortbilds wählbar (Standard 24: die Route bleibt sichtbar, Demo 05.10.)
  const SOFORT_GROESSE = { std: 24, min: 16, max: 80 };
  const sofortGroesse = (x) => { const n = +x; return isFinite(n) && n > 0 ? Math.max(SOFORT_GROESSE.min, Math.min(SOFORT_GROESSE.max, Math.round(n))) : SOFORT_GROESSE.std; };
  function sofortbildSchild(k, groesse) {
    // 05.10.2026 — Ortszeile als Unterschrift (nur der Ortsname, ohne Region); ein Logbuch-Text ersetzt sie.
    // 07.10.2026 (F-5) — eigene Unterschrift je Foto (`text`) gilt so, wie sie ist (kein Kürzen am Komma), und bleibt
    const eigen = String(k.f.text || "").trim();
    const ort = String(k.f.ort || "").split(",")[0].trim();
    return { text: eigen || ort, imageSrc: k.f.path, lat: k.f.lat, lon: k.f.lon, anchorMode: "track", style: "sofortbild",
             imageSize: sofortGroesse(groesse),
             entry: "pop", entry_s: 0.5, before: 0.4, after: 2.5, exit: "mini", exit_s: 0.8, visible: true, __bei: k.bei,
             ...(eigen ? { __eigenText: true } : {}) };
  }
  /** 05.10.2026 — Gründe des Video-Assistenten (core/videoassistent.py) lesbar, für den Tooltip im Dialog. */
  function grundText(gr) {
    return (gr || []).map(g => {
      const m = /^bestes_von:(\d+)$/.exec(g);
      if (m) return T("schnell.grund.bestes_von", "bestes von {n}").replace("{n}", m[1]);
      if (String(g).startsWith("ausschuss:")) return "";
      return T("schnell.grund." + g, g);
    }).filter(Boolean);
  }
  /** 05.10.2026 (Auto-Regie §10 „interessante Stellen langsamer") — Tempo-Spur: um Höhepunkte (höchster
   *  Punkt, steilste Stelle) und Fotos ohne Halt läuft die Fahrt langsamer (Faktor 0,55); bei fester Länge holt die
   *  übrige Strecke das auf. Bereiche ±2,5 % der Strecke, überlappende zusammengelegt. Normale Tempo-Einträge des
   *  Animators (art „tempo", von/bis, faktor) — dort von Hand änderbar. */
  const REGIE_FAKTOR = 0.55, REGIE_BREITE = 0.025;
  function tempoRegie(punkte) {
    const b = (punkte || []).filter(x => isFinite(+x)).map(x => [Math.max(0, +x - REGIE_BREITE), Math.min(1, +x + REGIE_BREITE)])
      .sort((a, c) => a[0] - c[0]);
    const raus = [];
    for (const [von, bis] of b) {
      const l = raus[raus.length - 1];
      if (l && von <= l.bis) l.bis = Math.max(l.bis, bis);
      else raus.push({ von, bis });
    }
    return raus.map(r => ({ art: "tempo", von: Math.round(r.von * 1e5) / 1e5, bis: Math.round(r.bis * 1e5) / 1e5,
                            faktor: REGIE_FAKTOR, quelle: "regie" }));
  }
  const LB_SYMBOL = { pause: "☕", uebernachtung: "🌙", notiz: "✎" };
  /** 02.10.2026 — Zutat „Logbuch": liegt ein Stopp in einer Pause, steht deren Text unter dem Foto; weitere
   *  Notizen und lange Pausen (ab 10 min) werden kurze Schilder im Highlight-Look (höchstens 3). */
  /** `gewaehlt`: die Liste ist schon die Auswahl (Video-Assistent, „Die Geschichte“) — alle nehmen, ohne Mindestdauer und ohne Obergrenze 3. */
  /** 11.10.2026 (Testvideo Schottland: „Pause · 11 h 21“ über der Schlusskarte) — Momente direkt am Start (Titel) oder am
   *  Ziel (Schlusskarte) werden keine Schilder: das Schild stünde über Titel bzw. Schlusskarte. */
  //  Zweites Testvideo (Schottland, 40 s für 5 Wochen): das Schild steht 2,2 s nach dem Vorbeifahren noch da und lief
  //  so in die Schlusskarte. Darum: Momente kurz vor dem Ziel bleiben, ihr Schild endet aber 0,3 s vor dem Ende der
  //  Fahrt (= Beginn der Schlusskarte); gesperrt ist nur, was in der letzten halben Sekunde bzw. der ersten Sekunde liegt.
  function lbRand(w) {
    const animS = Math.max(8, laengeS(w) - INTRO_S - HOLD_S);
    return { start: Math.max(0.02, 1.0 / animS), ende: Math.max(0.02, 0.5 / animS), animS };
  }
  const LB_NACHLAUF_S = 2.2;
  const amRand = (x, rand) => { rand = rand || { start: 0.025, ende: 0.025 }; return +x.bei < rand.start || +x.bei > 1 - rand.ende; };
  function logbuchAnwenden(stopps, eintraege, belegt, gewaehlt, rand) {
    const benutzt = new Set();
    for (const s of stopps) {
      const i = (eintraege || []).findIndex((x, j) => !benutzt.has(j) && s.__bei >= x.von - 0.01 && s.__bei <= x.bis + 0.01);
      if (i >= 0 && !s.__eigenText) { const x = eintraege[i]; s.text = ((LB_SYMBOL[x.icon] || "") + " " + x.text).trim(); benutzt.add(i); }
    }
    return (eintraege || []).filter((x, j) => !benutzt.has(j) && (gewaehlt || x.art === "notiz" || +x.dauer_s >= 600)
                                             && !stopps.some(s => Math.abs(s.__bei - x.bei) < 0.05) && isFinite(+x.lat)
                                             // 05.10.2026 (Teide-Demo: „Pause · 17 min" über „Teide 3715 m") — nicht auf Höhepunkte
                                             && !(belegt || []).some(b => Math.abs(b - x.bei) < 0.05) && !amRand(x, rand))
      .sort((a, b) => (b.art === "notiz") - (a.art === "notiz") || b.dauer_s - a.dauer_s).slice(0, gewaehlt ? 99 : 3)
      .map(x => ({ text: x.text, lat: x.lat, lon: x.lon, anchorMode: "track", style: "pille", icon: x.icon,
                   color: { pause: "#e0a96d", uebernachtung: "#8fa8ff", notiz: "#f2d36b" }[x.icon] || "#e0a96d", size: 36,
                   before: 1.6, after: rand && rand.animS ? Math.max(0.5, Math.min(LB_NACHLAUF_S, Math.round(((1 - x.bei) * rand.animS - 0.3) * 10) / 10)) : LB_NACHLAUF_S, entry: "both", entry_s: 0.35, exit: "fade", exit_s: 0.35, zoomScale: false, visible: true }));
  }

  /** 01.10.2026 (Marc) — „Ablauf" des Schnell-Videos: was an der Tour hängt und bei „In dieses Projekt
   *  übernehmen" mit „Meinen Look behalten" übernommen wird. Alles andere (Format, Kartenstil, Beschriftungen,
   *  Einblendungen, Verläufe, Highlights, blasse Runde) ist Look und bleibt dann, wie es ist. */
  // Highlights (an/aus + welche) sind Inhalt an der Strecke → Ablauf (Marc 01.10.2026: „die Highlights müssen
  // doch als Schilder drin sein"); ihr Aussehen (Stil, Farben) bleibt Look.
  const ABLAUF = ["fps", "intro_s", "hold_s", "duration_s", "keyframes_enabled", "timeline_events", "camera_follow_track", "kamera_vorgabe", "tempo_eintraege", "tempo_rate", "tempo_basis",
                  "highlights_enabled", "highlights_arten",
                  "ton_musik_an", "ton_musik", "ton_musik_laut", "ton_musik_ein", "ton_musik_aus", "ton_klick_an", "ton_klick_laut", "ton_klick_klang",
                  "marker_dot_show", "marker_dot_style", "marker_dot_size", "marker_dot_smooth", "marker_dot_rueckblick_m",
                  "spur_glaetten_m", "camera_follow_glatt_m", "smooth_camera_3d"];
  function nurAblauf(patch) {
    const o = {};
    for (const k of ABLAUF) if (k in patch) o[k] = patch[k];
    return o;
  }

  /** opts.projekt = { id, keyframes, hatLook } — aus dem Animator mit offenem Projekt: dann gibt es
   *  zusätzlich „In dieses Projekt übernehmen". */
  /** 06.10.2026 — Vorschau im Dialog: ganze Karte im Stil der Vorlage, ganze Strecke, Titel; Fotos und Highlights:
   *  eines offen (groß, wie im Video), die übrigen als kleine Punkte. Seitenverhältnis wie gewählt. Keine Animation —
   *  es zeigt, WAS ins Video kommt, nicht wie es abläuft. */
  function svVorschau(box, v, w) {
    const hulle = box.querySelector("#sv-vk"), kc = box.querySelector("#sv-vk-karte"), titelEl = box.querySelector("#sv-vk-titel");
    let map = null, marker = [], stilJetzt = "";
    const an = (id, d) => { const e = box.querySelector("#" + id); return e ? !!e.checked : d; };
    const lookVon = () => { const L = window.rzLooks && window.rzLooks.LOOKS[w.look || (VORLAGEN[w.vorlage] || VORLAGEN.weite).look]; return L || null; };
    function format() {
      const [fw, fh] = FORMATE[w.format] || [16, 9];
      const H = 230, maxB = Math.max(160, (box.clientWidth || 520) - 4);
      let h = H, b = H * fw / fh;
      if (b > maxB) { b = maxB; h = b * fh / fw; }
      hulle.style.width = Math.round(b) + "px"; hulle.style.height = Math.round(h) + "px";
      if (map) { try { map.resize(); passen(); inhalt(); } catch (_) {} }   // Anker der offenen Pille hängt am Rahmen
    }
    function passen() {
      const bb = v.bbox; if (!map || !bb) return;
      try { map.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: 18, duration: 0, maxZoom: 15 }); } catch (_) {}
    }
    function linieZeichnen() {
      if (!map || !Array.isArray(v.linie) || v.linie.length < 2) return;
      const L = lookVon(), farbe = (L && L.linie && L.linie.line_color) || "#48d6c4", kontur = (L && L.linie && L.linie.kontur_farbe) || "#0f1a20";
      const daten = { type: "Feature", geometry: { type: "LineString", coordinates: v.linie } };
      try {
        if (map.getSource("sv-linie")) map.getSource("sv-linie").setData(daten);
        else map.addSource("sv-linie", { type: "geojson", data: daten });
        if (!map.getLayer("sv-kontur")) map.addLayer({ id: "sv-kontur", type: "line", source: "sv-linie", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": kontur, "line-width": 5 } });
        if (!map.getLayer("sv-linie")) map.addLayer({ id: "sv-linie", type: "line", source: "sv-linie", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": farbe, "line-width": 3 } });
        map.setPaintProperty("sv-linie", "line-color", farbe); map.setPaintProperty("sv-kontur", "line-color", kontur);
      } catch (_) {}
    }
    function stil() {
      const key = w.look ? lookStil(w.look) : vorlageStil(w.vorlage), look = w.look ? lookKartenlook(w.look) : vorlageKartenlook(w.vorlage);
      const merk = key + "|" + (look ? look.id : "");   // gleicher Stilname, anderer Look → neu zeichnen
      if (map && merk === stilJetzt) { linieZeichnen(); inhalt(); return; }
      stilJetzt = merk;
      if (map) {
        try {
          applyMapStyle(map, key, v.bbox || null, { terrain: false, look });
          map.once("style.load", () => { linieZeichnen(); passen(); });
        } catch (e) { if (typeof applog === "function") applog("warn", "[schnell] Vorschau-Stil: " + e); }
        inhalt(); return;
      }
      if (typeof createMap !== "function") return;
      try {
        const r = createMap({ container: kc, styleKey: key, look, bbox: v.bbox || null, quellenleiste: false,
                              common: { interactive: false, attributionControl: false } });
        map = r && r.map ? r.map : r;
        map.on("load", () => { linieZeichnen(); passen(); inhalt(); });
      } catch (e) { try { applog("warn", "[schnell] Vorschau: " + e); } catch (_) {} }
    }
    function punkt(lnglat, el, offen) {
      const lib = (map && map.__rzEngine === "mapbox") ? window.mapboxgl : window.maplibregl;
      if (!lib || !map) return;
      const m = new lib.Marker({ element: el, anchor: "bottom" }).setLngLat(lnglat).addTo(map);
      // Offene Pille/Bild um den Überstand zurückschieben, sonst ragt sie im schmalen 9:16-Rahmen über den Rand
      if (offen) requestAnimationFrame(() => {
        try {
          const r = el.getBoundingClientRect(), k = map.getContainer().getBoundingClientRect(), rand = 4;
          let dx = 0;
          if (r.right > k.right - rand) dx = (k.right - rand) - r.right;
          if (r.left + dx < k.left + rand) dx = (k.left + rand) - r.left;
          if (dx) el.style.marginLeft = Math.round(dx) + "px";
        } catch (_) {}
      });
      marker.push(m);
    }
    function inhalt() {
      einblendungen();
      if (!map) return;
      marker.forEach(m => { try { m.remove(); } catch (_) {} }); marker = [];
      // POIs (Highlights): eines offen als Pille, die anderen als Punkte
      if (an("sv-highlights", true)) {
        (v.pois || []).forEach((p, i) => {
          const el = document.createElement("div");
          if (i === 0) {
            el.className = "sv-vk-poi ist-offen";
            const wert = (p.art === "hoechster" || p.art === "tiefster") && p.ele != null ? " · " + Math.round(p.ele) + " m" : "";
            el.textContent = T("assistent.s_" + p.art, p.art) + wert;
          } else el.className = "sv-vk-poi";
          punkt([p.lon, p.lat], el, i === 0);
        });
      }
      // Fotos: das erste gewählte groß (in der Fotoart der Vorlage), die übrigen als kleine runde Bilder
      // genau die Fotos, die ins Video kommen (Länge begrenzt die Zahl — dieselbe Auswahl wie beim Erstellen)
      const fotos = (typeof w.__fotosImVideo === "function" ? w.__fotosImVideo() : []).filter(f => f.lat != null && f.lon != null);
      const art = w.fotoArt || (VORLAGEN[w.vorlage] || VORLAGEN.weite).fotoArt;
      fotos.forEach((f, i) => {
        const el = document.createElement("div");
        if (i === 0) {
          el.className = "sv-vk-foto ist-offen art-" + art;
          el.innerHTML = f.thumb ? `<img src="${f.thumb}" alt="">` : "📷";
        } else {
          el.className = "sv-vk-foto";
          el.innerHTML = f.thumb ? `<img src="${f.thumb}" alt="">` : "";
        }
        punkt([f.lon, f.lat], el, i === 0);
      });
    }
    // 06.10.2026 — Zahlen und Höhenprofil so angeordnet wie im Video (je Vorlage): Weite frei oben mittig,
    // Tagebuch Kärtchen oben links, Puls Datenleiste unten über dem Profil; Profil links unten.
    function einblendungen() {
      const zEl = box.querySelector("#sv-vk-zahlen"), pEl = box.querySelector("#sv-vk-profil");
      if (!zEl || !pEl) return;
      const vl = VORLAGEN[w.vorlage] ? w.vorlage : "weite", Z = v.zahlen || {};
      const zAn = an("sv-zahlen", !!w.zahlen), pAn = an("sv-profil", !!w.profil) && Array.isArray(v.profil) && v.profil.length > 1;
      const km = (+v.distance_km || 0), dS = +Z.dauer_s || 0;
      const zeit = dS ? (Math.floor(dS / 3600) + ":" + String(Math.round(dS % 3600 / 60)).padStart(2, "0") + " h") : "";
      const werte = [[T("animator.statsfield.dist_total", "Strecke"), km.toLocaleString(undefined, { maximumFractionDigits: 1 }) + " km"],
                     [T("animator.statsfield.elev_gain", "Aufstieg"), (Z.aufstieg_m || 0) + " m"]];
      if (vl !== "tagebuch" && zeit) werte.push([T("animator.statsfield.moving_time", "Zeit"), zeit]);
      zEl.hidden = !zAn;
      zEl.className = "sv-vk-zahlen art-" + vl + (vl === "puls" && pAn ? " ueber-profil" : "");
      zEl.innerHTML = werte.map(([l, x]) => `<span><i>${esc(l)}</i><b>${esc(x)}</b></span>`).join("");
      pEl.hidden = !pAn;
      if (pAn) {
        const h = v.profil, lo = Math.min(...h), hi = Math.max(...h), sp = (hi - lo) || 1;
        const pkte = h.map((e, i) => `${(i / (h.length - 1) * 100).toFixed(1)},${(30 - (e - lo) / sp * 28).toFixed(1)}`).join(" ");
        pEl.style.width = ({ "9:16": 70, "1:1": 72, "16:9": 80 }[w.format] || 72) + "%";
        pEl.innerHTML = `<div class="sv-vk-pkopf">${esc(T("schnell.vk_profil", "Höhenprofil"))} · Min ${Math.round(Z.ele_min ?? lo)} · Max ${Math.round(Z.ele_max ?? hi)}</div>
          <svg viewBox="0 0 100 30" preserveAspectRatio="none"><polyline points="0,30 ${pkte} 100,30" /></svg>`;
      }
    }
    function titel() { const t_ = box.querySelector("#sv-titel"); titelEl.textContent = (t_ && t_.value) || w.titel || ""; }
    function weg() { marker.forEach(m => { try { m.remove(); } catch (_) {} }); marker = []; if (map) { try { map.remove(); } catch (_) {} map = null; } }
    format(); titel(); einblendungen();
    setTimeout(stil, 30);   // erst wenn der Dialog steht (Größe)
    return { format, stil, inhalt, titel, weg, einblendungen };
  }

  /** 11.10.2026 — der Video-Assistent als schwebendes, verschiebbares Fenster über dem Animator (statt
   *  Dialog): man sieht hinter ihm, was jede Stufe bewirkt, und darf nebenbei im Animator arbeiten. Zusammenklappbar,
   *  Lage gemerkt. Gleiche Schnittstelle wie openModal (`body`, `close`), dazu `onX` für das ✕. */
  function vaFenster(o) {
    try { const alt = document.getElementById("va-fenster"); if (alt && alt.__zu) alt.__zu(); } catch (_) {}
    const f = document.createElement("div");
    f.id = "va-fenster"; f.className = "va-fenster"; f.setAttribute("role", "dialog");
    f.innerHTML = `<div class="va-f-kopf"><b class="va-f-titel">${esc(o.title || "")}</b>
        <span class="va-f-status muted" hidden><span class="spinner"></span> ${esc(T("va.traegt_ein", "wird eingetragen …"))}</span><span class="va-f-luecke"></span>
        <button type="button" class="va-f-knopf" data-va-klapp title="${esc(T("va.einklappen", "Einklappen"))}">${I("chevron-up", 15)}</button>
        <button type="button" class="va-f-knopf" data-va-x title="${esc(T("va.abbrechen_tip", "Alles, was der Assistent geändert hat, zurücknehmen"))}">${I("x", 15)}</button></div>
      <div class="va-f-rumpf">${o.body || ""}</div><div class="va-f-fuss">${o.footer || ""}</div>`;
    document.body.appendChild(f);
    const LAGE = "rz.va.lage";
    const setzLage = (x, y) => {
      const b = f.getBoundingClientRect();
      x = Math.max(8, Math.min(window.innerWidth - Math.min(b.width, 200) - 8, x));
      y = Math.max(8, Math.min(window.innerHeight - 48, y));
      f.style.left = x + "px"; f.style.top = y + "px"; f.style.right = "auto";
    };
    try { const l = JSON.parse(localStorage.getItem(LAGE) || "null"); if (l && isFinite(l.x) && isFinite(l.y)) setzLage(l.x, l.y); if (l && l.zu) f.classList.add("va-zu"); } catch (_) {}
    const kopf = f.querySelector(".va-f-kopf");
    kopf.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || e.target.closest("button")) return;
      e.preventDefault();
      const b = f.getBoundingClientRect(), dx = e.clientX - b.left, dy = e.clientY - b.top;
      const zieh = (ev) => setzLage(ev.clientX - dx, ev.clientY - dy);
      const los = () => {
        window.removeEventListener("mousemove", zieh); window.removeEventListener("mouseup", los);
        try { const r = f.getBoundingClientRect(); localStorage.setItem(LAGE, JSON.stringify({ x: r.left, y: r.top, zu: f.classList.contains("va-zu") })); } catch (_) {}
      };
      window.addEventListener("mousemove", zieh); window.addEventListener("mouseup", los);
    });
    const klapp = f.querySelector("[data-va-klapp]");
    klapp.onclick = () => {
      f.classList.toggle("va-zu");
      klapp.innerHTML = I(f.classList.contains("va-zu") ? "chevron-down" : "chevron-up", 15);
      try { const r = f.getBoundingClientRect(); localStorage.setItem(LAGE, JSON.stringify({ x: r.left, y: r.top, zu: f.classList.contains("va-zu") })); } catch (_) {}
    };
    if (f.classList.contains("va-zu")) klapp.innerHTML = I("chevron-down", 15);
    let zu = false;
    const api_ = {
      body: f.querySelector(".va-f-rumpf"), el: f, onX: null,
      close() { if (zu) return; zu = true; f.remove(); document.querySelectorAll(".va-leuchtet").forEach(x => x.classList.remove("va-leuchtet")); if (o.onClose) try { o.onClose(); } catch (_) {} },
    };
    f.querySelector("[data-va-x]").onclick = () => (api_.onX ? api_.onX() : api_.close());
    f.__zu = () => api_.close();
    return api_;
  }
  /** Stufe → Bereich der Seitenleiste, der kurz aufleuchtet („Das findest du später hier“). */
  const VA_BEREICH = { 1: "format", 2: "signs", 3: "signs", 4: "signs", 5: "camera", 6: "overlays", 7: "map", 8: "overlays", 9: "ton" };
  function vaLeuchten(seite) {
    document.querySelectorAll(".va-leuchtet").forEach(x => x.classList.remove("va-leuchtet"));
    document.querySelectorAll(".va-hier").forEach(x => x.remove());
    const sek = VA_BEREICH[seite] && document.querySelector(`#mod-animator [data-accordion-section="${VA_BEREICH[seite]}"], .anim-sidebar [data-accordion-section="${VA_BEREICH[seite]}"], [data-accordion-section="${VA_BEREICH[seite]}"]`);
    if (!sek || !sek.offsetParent) return;
    const kopf = sek.querySelector(".section-collapse-header") || sek;
    sek.classList.add("va-leuchtet");
    const h = document.createElement("span");
    h.className = "va-hier"; h.textContent = T("va.hier", "Das findest du später hier");
    kopf.appendChild(h);
    try { kopf.scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch (_) {}
    setTimeout(() => { sek.classList.remove("va-leuchtet"); h.remove(); }, 2600);
  }

  /** 08.10.2026 — nach dem Assistenten rechts: was er ins Projekt geschrieben hat (Marc: „Liste: Das hat der Assistent
   *  gemacht“). Alles bleibt bearbeitbar; ⌘Z nimmt den ganzen Schritt zurück. */
  function vaBericht(liste) {
    const p = document.createElement("div");
    p.className = "anim-track-editor sign-editor va-bericht";
    p.id = "va-bericht";
    p.innerHTML = `<div class="tm-kopf"><b>🧭 ${esc(T("va.bericht_titel", "Das hat der Assistent gemacht"))}</b><button type="button" class="sign-editor-x" title="${esc(T("common.close", "Schließen"))}">✕</button></div>
      <ul class="va-liste">${(liste || []).map(([ic, k, v2]) => `<li><span class="va-ic">${vaIc(ic)}</span><b>${esc(k)}</b><span>${esc(v2)}</span></li>`).join("")}</ul>
      <p class="muted" style="font-size:11.5px">${esc(T("va.bericht_hinweis", "Alles ist jetzt normal bearbeitbar: Schilder in der Zeitleiste, Kamera unter „Kamera“, Einblendungen unter „Overlays“. ⌘Z nimmt den ganzen Assistenten zurück."))}</p>`;
    p.querySelector(".sign-editor-x").onclick = () => p.remove();
    document.getElementById("va-bericht")?.remove();
    if (!(window.rzDetailSpalte && window.rzDetailSpalte.aufnehmen(p, T("va.titel", "Video-Assistent")))) document.body.appendChild(p);
  }

  async function rzSchnellVideo(pfad, opts) {
    if (!pfad) return;
    const P = (opts && opts.projekt && opts.projekt.id) ? opts.projekt : null;
    const ausAnimator = !!opts;   // aus dem Animator aufgerufen (das Archiv übergibt keine opts)
    const animS = (opts && +opts.animatorS > 0) ? Math.round(+opts.animatorS * 10) / 10 : 0;   // Länge im Animator (Intro + Animation + Halten)
    // 08.10.2026 — Video-Assistent: derselbe Dialog als Quiz in neun Seiten, schreibt ins offene Projekt
    const ASS = !!(opts && opts.assistent) && !!P;
    let v;
    try { v = await rzWarten("schnellvideo_vorschlag", () => api().schnellvideo_vorschlag(pfad)); }
    catch (e) { v = { ok: false, error: String(e) }; }
    if (!v || !v.ok) { toast((v && v.error) || T("common.error", "Fehler"), "error", 6000); return; }
    const L = v.letzte || {};
    const w = {
      format: FORMATE[L.format] ? L.format : "9:16",
      laenge: LAENGEN[L.laenge] ? L.laenge : "normal",   // 06.10.2026 — nur noch Kurz/Normal/Lang
      eigenS: laengeKlemmen(L.eigen_s || 30), animatorS: animS,
      qualitaet: L.qualitaet === "4k" ? "4k" : "1080",
      stil: L.stil || (typeof mapDefaultStyle === "function" ? mapDefaultStyle() : "free_satellite"),
      zahlen: !!L.zahlen, profil: !!L.profil,
      highlights: L.highlights !== false,   // 30.09.2026 — Standard an
      felder: Array.isArray(L.felder) ? L.felder.filter(f => SCHLUSS_FELDER.includes(f)) : SCHLUSS_STANDARD.slice(),
      titel: v.name || "", unter: [datumText(v), ortKurz(v.ort)].filter(Boolean).join(" · "),
      // 02.10.2026 — Zutaten unter „Mehr" (Marc: „beim Schnell-Video bleiben und eine erweiterte Option machen")
      mehrOffen: !!L.mehr_offen,
      fotosAn: L.fotos_an !== false, clipsAn: L.clips_an !== false, clipTon: !!L.clip_ton,
      logbuch: L.logbuch !== false, musikAn: L.musik_an !== false, musik: L.musik || "builtin:unterwegs", klick: L.klick !== false,
      uebersicht: !!L.uebersicht, schlussAn: L.schluss_an !== false,
      gebaeude: L.gebaeude,   // undefined = noch nie gewählt → vorwählen, wenn die Tour durch einen Ort führt
      // 05.10.2026 — Vorlage (Weite/Tagebuch/Puls) und Fotoart; „angepasst" = eine Zutat weicht von der Vorlage ab
      vorlage: VORLAGEN[L.vorlage] ? L.vorlage : "weite",
      fotoArt: FOTO_ARTEN.includes(L.foto_art) ? L.foto_art : null,
      sofortGroesse: sofortGroesse(L.sofort_groesse),               // 07.10.2026 (F-5)
      fotoPause: L.foto_pause === "stehen" ? "stehen" : "heran",    // 07.10.2026 (F-5) — Fotostopp mit/ohne Heranfahren
      angepasst: !!L.angepasst,
      tempoRegie: true,   // 06.10.2026 — immer an, kein Haken mehr
    };
    if (!VORLAGEN[L.vorlage]) {
      // Erster Aufruf mit Vorlagen: Weite vorbelegen (Q5) — eigene Musikdatei und Felder bleiben
      const V = VORLAGEN.weite;
      w.stil = vorlageStil("weite"); w.zahlen = V.zahlen; w.profil = V.profil; w.uebersicht = V.uebersicht;
      if (!L.musik || String(L.musik).startsWith("builtin:")) w.musik = V.musik;
    }
    if (!w.fotoArt) w.fotoArt = VORLAGEN[w.vorlage].fotoArt;
    // Der Assistent schlägt vor — Fotos, Highlights, Schlusskarte und Musik an, auch wenn das Schnell-Video zuletzt ohne lief
    if (ASS) { w.look = VORLAGEN[w.vorlage].look; w.kamera = "fahrt"; w.fotosAn = true; w.highlights = true; w.schlussAn = true; w.musikAn = true; w.logbuch = true; }
    // 07.10.2026 (Web-Fund F-5) — offizielle Parameter beim Aufruf (Web, Skripte): Fotoart, Größe des Sofortbilds,
    // Fotopause ohne Heranfahren. Der Dialog bleibt schlank (F-14: die Fotoart kommt sonst aus der Vorlage).
    if (opts && FOTO_ARTEN.includes(opts.fotoArt)) w.fotoArt = opts.fotoArt;
    if (opts && opts.sofortGroesse != null) w.sofortGroesse = sofortGroesse(opts.sofortGroesse);
    if (opts && (opts.fotoPause === "stehen" || opts.fotoPause === "heran")) w.fotoPause = opts.fotoPause;
    const feldLabel = (f) => T("animator.statsfield." + f, f);
    const m = (ASS ? vaFenster : openModal)({
      title: ASS ? "🧭 " + T("va.titel", "Video-Assistent") : "🎬 " + T("schnell.titel_dialog", "Schnell-Video"),
      body: `<div class="sv-dialog">
        ${ASS ? "" : `<p class="muted" style="margin:0 0 10px">${esc(T("schnell.intro", "Ein fertiges Video deiner Tour: Überblick, Flug entlang der Strecke, Schlussblick mit deinen Zahlen."))}</p>`}
        <!-- 06.10.2026 (Marc: „das Schnell-Video braucht eine Vorschau, dass man weiß, was man da einstellt: komplette Karte
             mit komplettem Track; wenn Fotos da sind, eins offen, die anderen zu; gleiches gilt für POIs") -->
        <div class="sv-vorschau" id="sv-vorschau"><div class="sv-vk" id="sv-vk"><div class="sv-vk-karte" id="sv-vk-karte"></div><div class="sv-vk-titel" id="sv-vk-titel"></div><div class="sv-vk-zahlen" id="sv-vk-zahlen" hidden></div><div class="sv-vk-profil" id="sv-vk-profil" hidden></div></div></div>
        ${ASS ? `<div class="va-kopf" id="va-kopf"></div>` : ""}
        <div data-va="1">
        ${ASS ? `<p class="va-frage">${esc(T("va.s2_frage_v", "Mit welcher Vorlage willst du starten?"))}</p>
          <p class="muted" style="font-size:11.5px;margin:-4px 0 8px">${esc(T("va.s2_hinweis", "Die Vorlage stellt alles passend ein — in den nächsten Schritten kannst du jedes Detail noch ändern."))}</p>
          <div class="va-karten" id="va-zweck">${[["erinnerung", "house", T("va.z_erinnerung", "Erinnerung"), T("va.z_erinnerung_t", "für dich und die Familie — Orte und Fotos, 16:9, eine Minute")],
              ["social", "smartphone", T("va.z_social", "Social"), T("va.z_social_t", "Reel oder Short — hochkant, kurz, mit Zahlen")],
              ["landschaft", "mountain-snow", T("va.z_landschaft", "Landschaft"), T("va.z_landschaft_t", "Luftbild, große Fotos, ruhig — 16:9, 40 Sekunden")]]
            .map(([k, ic, ti, tx]) => `<button type="button" class="va-karte" data-va-zweck="${k}"><span class="va-ic">${vaIc(ic, 22)}</span><b>${esc(ti)}</b><span>${esc(tx)}</span></button>`).join("")}<span id="sv-eigene" class="sv-eigene"></span></div>` : ""}
        <div class="sv-vorlagen" id="sv-vorlagen"${ASS ? " hidden" : ""}>${VORLAGE_NAMEN.map(n => `<button type="button" class="sv-vorlage${n === w.vorlage ? " is-on" : ""}" data-sv-vorlage="${n}">
          <span class="rz-look-bild rz-look-${VORLAGEN[n].look}"></span><span class="sv-vl-name">${esc(T("schnell.vl." + n, { weite: "Weite", tagebuch: "Tagebuch", puls: "Puls" }[n]))}</span>
          <span class="sv-vl-text">${esc(T("schnell.vl." + n + "_text", { weite: "Landschaft, Fotos groß, Zahlen am Schluss", tagebuch: "Orte und Erinnerungen, Fotos als Sofortbild", puls: "Strecke und Leistung, Datenleiste mit Profil" }[n]))}</span></button>`).join("")}${ASS ? "" : `<span id="sv-eigene" class="sv-eigene"></span>`}</div>
        <div class="muted sv-vl-stand" id="sv-vl-stand"></div>
        <label class="field-label">${esc(T("schnell.format", "Format"))}</label>
        ${knopfReihe("format", [["9:16", "9:16 " + T("schnell.format_hoch", "hochkant")], ["16:9", "16:9"], ["1:1", "1:1"]], w.format)}
        <label class="field-label">${esc(T("schnell.laenge", "Länge"))}</label>
        ${knopfReihe("laenge", [["kurz", T("schnell.kurz", "Kurz") + " · 20 s"], ["normal", T("schnell.normal", "Normal") + " · 40 s"], ["lang", T("schnell.lang", "Lang") + " · 60 s"]].concat(ASS ? [["eigen", T("schnell.eigen_laenge", "Eigene …")]] : []), w.laenge)}
        ${ASS ? `<div class="sv-eigen-zeile" id="sv-eigen-zeile"${w.laenge === "eigen" ? "" : " hidden"}><input type="number" id="sv-eigen" class="lib-input" min="${LAENGE_MIN}" max="${LAENGE_MAX}" step="5" value="${w.eigenS}"> <span class="muted">${esc(T("schnell.eigen_laenge_s", "Sekunden ({min}–{max})", { min: LAENGE_MIN, max: LAENGE_MAX }))}</span></div>` : ""}
        </div>
        <div data-va="6">${ASS ? `<p class="va-frage">${esc(T("va.s1_frage", "Wie soll dein Video heißen?"))}</p>` : ""}
        <label class="field-label" for="sv-titel">${esc(T("schnell.titel", "Titel"))}</label>
        <input type="text" id="sv-titel" class="lib-input" value="${esc(w.titel)}">
        <div class="sv-titel-vorschlaege" id="sv-titel-vorschl"></div>
        <label class="field-label" for="sv-unter">${esc(T("schnell.unterzeile", "Unterzeile"))}</label>
        <input type="text" id="sv-unter" class="lib-input" value="${esc(w.unter)}">
        ${ASS ? `<label class="field-label" style="margin-top:10px">${esc(T("va.t_menge", "Wie viel Text?"))}</label>
          <div class="sv-reihe" id="va-t-menge">${[["wenige", T("va.t_wenige", "wenige")], ["normal", T("va.t_normal", "normal")], ["viele", T("va.t_viele", "viele")]]
            .map(([k, l]) => `<button type="button" class="btn btn-sm sv-wahl${(w.textMenge || "normal") === k ? " is-on" : ""}" data-va-t-menge="${k}">${esc(l)}</button>`).join("")}</div>
          <p class="muted" id="va-t-erkl" style="font-size:11.5px;margin:6px 0 0"></p>` : ""}
        </div>
        <!-- 06.10.2026 (Marc: „Schnelle Videos müssen schon deutlich eingedampft werden … alles andere
             muss in den Assistenten“) — ein Bildschirm, kein „Mehr“: Fotos (+ eigene), Musik, Einblendungen, Schlusskarte.
             Kartenstil, Fotoart, Übersichtskarte und 3D-Häuser bringt die Vorlage mit; Qualität und Speicherort fragt
             der Export-Dialog (derselbe Weg wie im Animator). Clips, Logbuch, eigene Länge → Animator/Assistent. -->
        <div class="sv-zutat" data-sv-zutat="fotos" data-va="3">${ASS ? `<p class="va-frage">${esc(T("va.s5_frage", "Welche Fotos sollen ins Video? Ausgewählt nach Schärfe, Abwechslung und Verteilung über die Strecke — abwählen oder eigene dazunehmen."))}</p>` : ""}
          <label class="chk sv-zutat-kopf"><input type="checkbox" id="sv-fotos-an"${w.fotosAn ? " checked" : ""}><span>📸 ${esc(T("schnell.z.fotos", "Fotostopps"))}</span><span class="sv-zutat-stand muted" id="sv-fotos-an-stand"></span></label>
          ${ASS ? `<p class="va-lead" id="va-f-lead"></p>
            <label class="field-label">${esc(T("va.f_menge", "Wie viele Fotos?"))}</label>
            <input type="range" id="va-f-menge" min="0" max="1" step="0.05" value="${isFinite(+w.fotoMenge) ? w.fotoMenge : 0.5}" style="width:100%">
            <div class="muted" style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:6px"><span>${esc(T("va.f_weniger", "weniger"))}</span><span>${esc(T("va.f_mehr", "mehr"))}</span></div>` : ""}
          <div class="sv-zutat-teil">
            <div class="sv-fotos" id="sv-fotos"><span class="muted">${esc(T("schnell.fotos_suchen", "Fotos dieser Tour werden gesucht …"))}</span></div>
          </div>
          <!-- außerhalb des Klappteils: eigene Fotos auch dann, wenn das Archiv keine hat (Schalter dann aus) -->
          <div class="sv-fotos-fuss"><span class="muted sv-fotos-info" id="sv-fotos-info"></span>
              <button type="button" class="btn btn-small" data-sv-alle title="${esc(T("schnell.alle_tip", "Alle Fotos und Videos dieser Tour ansehen und selbst auswählen"))}">${vaIc("images", 13)} ${esc(T("schnell.alle", "Alle Medien der Tour"))}<span class="sv-alle-n"></span> …</button>
              <button type="button" class="btn btn-small" data-sv-plus="dateien" title="${esc(T("schnell.fotos_plus_tip", "Eigene Fotos dazunehmen — sie werden der Strecke zugeordnet (GPS, sonst Aufnahmezeit)"))}">+ ${esc(T("schnell.fotos_plus", "Fotos …"))}</button>
              <button type="button" class="btn btn-small" data-sv-plus="ordner" title="${esc(T("schnell.fotos_plus_tip", "Eigene Fotos dazunehmen — sie werden der Strecke zugeordnet (GPS, sonst Aufnahmezeit)"))}">+ ${esc(T("schnell.fotos_plus_ordner", "Ordner …"))}</button></div>
          <div class="sv-alle" id="sv-alle" hidden></div>
        </div>
        <div class="sv-zutat" data-sv-zutat="musik" data-va="9">${ASS ? `<p class="va-frage">${esc(T("va.s8_frage", "Wie endet dein Video — und mit welcher Musik?"))}</p>` : ""}
          <label class="chk sv-zutat-kopf"><input type="checkbox" id="sv-musik-an"${w.musikAn ? " checked" : ""}><span>🎵 ${esc(T("schnell.z.musik", "Musik"))}</span><span class="sv-zutat-stand muted" id="sv-musik-an-stand"></span></label>
          <div class="sv-zutat-teil">
            <div class="sv-musik-zeile">
              <select id="sv-musik" class="lib-select">
                ${[["unterwegs", "Unterwegs (eingebaut)"], ["weite", "Weite — ruhig, filmisch"], ["gipfelsturm", "Gipfelsturm — treibend"],
                   ["rast", "Rast — Lo-Fi, entspannt"], ["grat", "Grat — episch"], ["wanderlied", "Wanderlied — Folk, Gitarre"],
                   ["panorama", "Panorama — weite Flächen, Piano"], ["tagebuch", "Tagebuch — gezupft, warm"], ["puls", "Puls — sportlich, elektronisch"]]
                  .map(([k, d]) => `<option value="builtin:${k}"${w.musik === "builtin:" + k ? " selected" : ""}>${esc(T("animator.ton." + k, d))}</option>`).join("")}
                ${w.musik && !w.musik.startsWith("builtin:") ? `<option value="${esc(w.musik)}" selected>🎵 ${esc(String(w.musik).split(/[\\/]/).pop())}</option>` : ""}
              </select>
              <button type="button" class="btn btn-small" id="sv-musik-hoeren" title="${esc(T("schnell.musik_hoeren", "Probehören"))}">${vaIc("play", 14)}</button>
              <button type="button" class="btn btn-small" id="sv-musik-datei" title="${esc(T("animator.ton.datei_tip", "Eigene Musik wählen (MP3, M4A, WAV, FLAC …)"))}">…</button>
            </div>
            ${ASS ? `<div class="va-musik-liste" id="va-musik-liste"></div>` : ""}
          </div>
        </div>
        <div class="sv-zutat" data-sv-zutat="einblendungen" data-va="8">${ASS ? `<p class="va-frage">${esc(T("va.s4_frage", "Was soll unterwegs eingeblendet werden?"))}</p>` : ""}
          <label class="chk"><input type="checkbox" id="sv-zahlen"${w.zahlen ? " checked" : ""}><span>📊 ${esc(T("schnell.zahlen", "Zahlen unterwegs (Strecke und Höhe)"))}</span></label>
          <label class="chk"><input type="checkbox" id="sv-profil"${w.profil ? " checked" : ""}><span>⛰ ${esc(T("schnell.profil", "Höhenprofil"))}</span></label>
          <label class="chk"><input type="checkbox" id="sv-highlights"${w.highlights ? " checked" : ""}><span>⭐ ${esc(T("schnell.highlights", "Highlights (höchster Punkt, steilste Stelle, halbe Strecke …)"))}</span></label>
        </div>
        <div class="sv-zutat" data-sv-zutat="schluss" data-va="9">
          <label class="chk sv-zutat-kopf"><input type="checkbox" id="sv-schluss-an"${w.schlussAn ? " checked" : ""}><span>🏁 ${esc(T("schnell.z.schluss", "Schlusskarte"))}</span><span class="sv-zutat-stand muted" id="sv-schluss-an-stand"></span></label>
          <div class="sv-zutat-teil sv-felder">${SCHLUSS_FELDER.map(f => `<label class="chk"><input type="checkbox" data-sv-feld="${f}"${w.felder.includes(f) ? " checked" : ""}><span>${esc(feldLabel(f))}</span></label>`).join("")}</div>
        </div>
        ${ASS ? `
        <div data-va="4"><p class="va-frage">${esc(T("va.h_frage", "Wo soll das Video anhalten?"))}</p>
          <p class="va-lead" id="va-h-lead"></p>
          <label class="chk"><input type="checkbox" id="va-h-alle" checked><span>⏸ ${esc(T("va.h_alle", "An allen Foto-Schildern anhalten"))}</span></label>
          <p class="muted" style="font-size:11.5px;margin:2px 0 8px">${esc(T("va.h_alle_tip", "Damit man die Bilder in Ruhe ansehen kann. Aus: die Fahrt läuft weiter, das Foto steht kurz daneben."))}</p>
          <label class="field-label">${esc(T("va.h_dauer", "Wie lange?"))}</label>
          <div class="sv-reihe" id="va-h-dauer">${[["kurz", T("va.h_kurz", "kurz")], ["normal", T("va.h_normal", "normal")], ["lang", T("va.h_lang", "lang")]]
            .map(([k, l]) => `<button type="button" class="btn btn-sm sv-wahl${(w.halteDauer || "normal") === k ? " is-on" : ""}" data-va-h-dauer="${k}">${esc(l)}</button>`).join("")}</div>
          <label class="chk" style="margin-top:8px"><input type="checkbox" id="va-h-heran"${w.fotoPause !== "stehen" ? " checked" : ""}><span>🎥 ${esc(T("va.h_heran", "Kamera fährt an jedem Halt heran"))}</span></label>
          <p class="muted" style="font-size:11.5px;margin:6px 0 0">${esc(T("va.h_hinweis", "Später an der Schilder-Spur: ⏸ hält an allen Foto-Schildern; jedes Schild hat im Editor seinen eigenen Halt."))}</p></div>
        <div data-va="7"><p class="va-frage">${esc(T("va.s3_frage", "Welche Karte passt zu deiner Tour?"))}</p>
          <div class="rz-look-reihe va-looks" id="va-looks">${(window.rzLooks ? window.rzLooks.NAMEN : []).map(n => { const st = window.rzLooks.kachelStil ? window.rzLooks.kachelStil(n) : "";
            return `<button type="button" class="rz-look-knopf${n === w.look ? " is-on" : ""}" data-va-look="${n}" title="${esc(T("look." + n + ".tip", ""))}"><span class="rz-look-bild rz-look-${n}${st ? " rz-look-svg" : ""}"${st}></span><span>${esc(T("look." + n, n))}</span></button>`; }).join("")}</div>
          <label class="chk" style="margin-top:8px"><input type="checkbox" id="sv-gebaeude"${w.gebaeude ? " checked" : ""}><span>🏘 ${esc(T("va.gebaeude", "3D-Häuser in Orten"))}</span></label></div>
        <div data-va="2"><p class="va-frage">${esc(T("va.g_frage", "Die Geschichte: welche Momente sollen vorkommen?"))}</p>
          <p class="va-lead" id="va-g-lead">${esc(T("logbuch.laedt", "Logbuch wird geladen …"))}</p>
          <div class="va-g-liste" id="va-g-liste"></div>
          <div class="va-g-kapitel muted" id="va-g-kapitel"></div>
          <p class="muted" style="font-size:11.5px;margin:6px 0 0">${esc(T("va.g_hinweis", "Das findest du später in der Zeitleiste und bei den Schildern wieder. Fotostopps bekommen ihren Ort automatisch."))}</p>
          <label class="chk" hidden><input type="checkbox" id="sv-logbuch"${w.logbuch ? " checked" : ""}><span>📖</span></label></div>
        <div data-va="5"><p class="va-frage">${esc(T("va.s7_frage", "Wie soll sich die Kamera bewegen?"))}</p>
          <div class="va-karten" id="va-kamera">${[["fahrt", "video", T("einfach.k_fahrt", "Kamerafahrt"), T("va.k_fahrt_t", "Überblick, Flug entlang der Strecke, Blick auf die Höhepunkte, Schlussblick")],
              ["folgen", "navigation", T("einfach.k_folgen", "Folgen"), T("va.k_folgen_t", "die Kamera fliegt die ganze Zeit hinter dem Punkt her")],
              ["fest", "map", T("einfach.k_fest", "Fest"), T("va.k_fest_t", "die ganze Tour bleibt im Bild, nur die Linie wächst")]]
            .map(([k, ic, ti, tx]) => `<button type="button" class="va-karte${k === w.kamera ? " is-on" : ""}" data-va-kamera="${k}"><span class="va-ic">${vaIc(ic, 22)}</span><b>${esc(ti)}</b><span>${esc(tx)}</span></button>`).join("")}</div>
          <div id="va-k-fahrt">
            <label class="field-label" style="margin-top:10px">${esc(T("va.k_leb", "Wie lebendig?"))}</label>
            <input type="range" id="va-k-leb" min="0" max="1" step="0.05" value="${isFinite(+w.kamLeb) ? w.kamLeb : 0.5}" style="width:100%">
            <div class="muted" style="display:flex;justify-content:space-between;font-size:11px"><span>${esc(T("va.k_ruhig", "ruhig, weit"))}</span><span>${esc(T("va.k_lebendig", "lebendig, nah"))}</span></div>
            <p class="va-lead" style="margin-top:10px">${esc(T("va.k_momente", "An den Momenten der Geschichte:"))}</p>
            <div class="va-g-liste" id="va-k-momente"></div>
          </div></div>

        <div data-va="10"><p class="va-frage">${esc(T("va.s9_frage", "Fertig — das kommt in dein Projekt:"))}</p><ul class="va-liste" id="va-liste"></ul>
          <div class="va-vorlage-sp"><label class="field-label">${esc(T("va.v_speichern_frage", "Diesen Stil als Vorlage merken?"))}</label>
            <div style="display:flex;gap:6px"><input type="text" id="va-vorlage-name" class="lib-input" placeholder="${esc(T("va.v_name_ph", "Name, z. B. „Wandern hochkant“"))}" style="flex:1">
            <button type="button" class="btn btn-sm" id="va-vorlage-speichern">${vaIc("star", 14)} ${esc(T("va.v_speichern", "Als Vorlage speichern"))}</button></div>
            <p class="muted" style="font-size:11px;margin:4px 0 0">${esc(T("va.v_hinweis", "Gemerkt wird nur der Stil (Format, Länge, Look, Einblendungen, Kamera, Halte, Texte, Musik, Schluss) — beim Assistenten und beim Schnell-Video auf der ersten Seite wählbar."))}</p></div>
          <p class="muted" style="font-size:11.5px">${esc(T("va.s9_hinweis", "Alles landet bearbeitbar im Animator — ein ⌘Z nimmt den ganzen Assistenten zurück."))}${P.keyframes > 0 ? " " + esc(T("schnell.kf_warnung", "Das Projekt hat schon {n} Keyframes — sie werden durch die Kamerafahrt ersetzt (⌘Z holt sie zurück).").replace("{n}", P.keyframes)) : ""}</p></div>` : ""}
        ${P && !ASS ? `<div class="sv-projekt">
          <label class="field-label">${esc(T("schnell.in_projekt_titel", "In dieses Projekt übernehmen"))}</label>
          <label class="chk"><input type="checkbox" id="sv-look"${P.hatLook ? " checked" : ""}><span>${esc(T("schnell.look_behalten", "Meinen Look behalten — nur Kamerafahrt und Ablauf übernehmen"))}</span></label>
          <p class="muted" style="margin:2px 0 0;font-size:11.5px">${esc(T("schnell.look_hinweis", "Ohne Haken kommen auch Format, Kartenstil, Einblendungen, Titel und Schlusskarte des Schnell-Videos ins Projekt."))}</p>
          ${P.keyframes > 0 ? `<p class="sv-hinweis" style="margin-top:6px">⚠️ ${esc(T("schnell.kf_warnung", "Das Projekt hat schon {n} Keyframes — sie werden durch die Kamerafahrt ersetzt (⌘Z holt sie zurück).").replace("{n}", P.keyframes))}</p>` : ""}
        </div>` : ""}
      </div>`,
      footer: ASS ? `<button type="button" class="btn btn-ghost" id="va-abbrechen" title="${esc(T("va.abbrechen_tip", "Alles, was der Assistent geändert hat, zurücknehmen"))}">${esc(T("common.cancel", "Abbrechen"))}</button>
          <span class="va-f-luecke"></span>
          <button type="button" class="btn" id="va-zurueck">← ${esc(T("va.zurueck", "Zurück"))}</button>
          <button type="button" class="btn btn-ghost" id="va-skip">${esc(T("va.ueberspringen", "Überspringen"))}</button>
          <button type="button" class="btn btn-primary" id="va-weiter">${esc(T("va.weiter", "Weiter"))} →</button>
          <button type="button" class="btn btn-primary" id="sv-uebernehmen" title="${esc(T("va.fertig_tip", "Jetzt aufhören — alles bisher Gewählte bleibt, ⌘Z nimmt den ganzen Assistenten zurück"))}">✓ ${esc(T("va.fertig", "Fertig"))}</button>`
      : (P ? `<button type="button" class="btn btn-primary" id="sv-uebernehmen">${esc(T("schnell.in_projekt", "In dieses Projekt übernehmen"))}</button>` : "")
        + `<button type="button" class="btn" id="sv-animator">${esc(P ? T("schnell.neues_projekt", "Neues Projekt") : T("schnell.im_animator", "Im Animator öffnen"))}</button>
               <button type="button" class="btn${P ? "" : " btn-primary"}" id="sv-rendern">🎬 ${esc(T("schnell.erstellen", "Video erstellen …"))}</button>`,
    });
    const box = (m && m.body) || document.getElementById("modal-body");
    const vorschau = svVorschau(box, v, w);
    box.querySelectorAll("[data-sv-gruppe]").forEach(r => r.addEventListener("click", (e) => {
      const b = e.target.closest("[data-sv-wert]"); if (!b) return;
      w[r.dataset.svGruppe] = b.dataset.svWert;
      r.querySelectorAll("[data-sv-wert]").forEach(x => x.classList.toggle("is-on", x === b));
      if (r.dataset.svGruppe === "format") vorschau.format();
      if (r.dataset.svGruppe === "laenge") {
        const z = box.querySelector("#sv-eigen-zeile"); if (z) z.hidden = w.laenge !== "eigen";
        if (w.laenge === "eigen") box.querySelector("#sv-eigen")?.focus();
      }
    }));
    const rechte = () => {};   // 06.10.2026 — Kartenstil kommt aus der Vorlage, keine eigene Auswahl mehr

    // Fotostopps: Vorschlag aus dem Foto-Bestand, im Dialog abwählbar (Marc, Q1 „beides")
    w.fotos = []; w.fotosAus = new Set();
    const animSJetzt = () => Math.max(8, laengeS(w) - INTRO_S - HOLD_S);
    const fotosInfo = () => {
      const z = box.querySelector("#sv-fotos-info"); if (!z) return;
      const an = w.fotos.filter((_, i) => !w.fotosAus.has(i));
      if (!w.fotos.length) { z.textContent = ""; return; }
      let n;
      if (fotoArtJetzt() === "gross") {
        n = stoppsJetzt().filter(x => !x.clip).length;
        z.textContent = T("schnell.fotos_info", "{n} Fotostopps · je {s} s, von der Länge abgezogen").replace("{n}", n).replace("{s}", STOPP_KOSTEN);
      } else {
        n = ohneHaltJetzt().length;
        z.textContent = T("schnell.fotos_info_ohne", "{n} Fotos · ohne Halt, die Fahrt läuft weiter").replace("{n}", n);
      }
      z.textContent += (n < an.length ? " · " + T("schnell.fotos_zu_viele", "für diese Länge passen nicht alle — die besten kommen rein") : "");
      mehrKurz();
    };
    const fotosZeigen = () => {
      const l = box.querySelector("#sv-fotos"); if (!l) return;
      if (!w.fotos.length) {
        // 02.10.2026 (Marc: „wenn keine Fotos zu finden sind, biete die Möglichkeit, welche bereitzustellen")
        const satz = w.fotosEigen ? T("schnell.fotos_passen_nicht", "Keins der gewählten Fotos passt zur Tour (Ort oder Aufnahmezeit).")
                                  : T("schnell.fotos_keine", "Keine Fotos zu dieser Tour im Foto-Archiv.");
        l.innerHTML = `<span class="muted">${esc(satz)}</span>`;   // eigene Fotos: „+ Fotos …“ / „+ Ordner …“ darunter
        fotosInfo(); return;
      }
      let imVideo = new Set();
      if (ASS) try { stoppsJetzt().concat(ohneHaltJetzt().map(k => ({ imageSrc: k.f.path }))).forEach(x => x.imageSrc && imVideo.add(x.imageSrc)); } catch (_) {}
      l.innerHTML = w.fotos.map((f, i) => `<button type="button" class="sv-foto${w.fotosAus.has(i) ? "" : " is-on"}${f.eigen ? " ist-eigen" : ""}${imVideo.has(f.path) ? " va-im-video" : ""}" data-sv-foto="${i}" title="${esc([String(f.path).split(/[\\/]/).pop()].concat(f.eigen ? [T("schnell.foto_eigen", "eigenes Foto")] : grundText(f.grund)).join(" · "))}">`
        + (f.thumb ? `<img src="${f.thumb}" alt="">` : `<span class="sv-foto-leer">${vaIc("image", 18)}</span>`) + `<span class="sv-foto-zeit">${esc(f.zeit || "")}</span>`
        + `<span class="sv-foto-gross" data-sv-gross="${i}" title="${esc(T("schnell.foto_gross", "Groß ansehen"))}">${vaIc("maximize-2", 12)}</span>`
        + (ASS && imVideo.has(f.path) ? `<span class="va-foto-grund">✓ ${esc(fotoGrund(f) || T("va.f_im_video", "im Video"))}</span>` : "") + `</button>`).join("");
      if (ASS) {
        const lead = box.querySelector("#va-f-lead");
        if (lead) lead.textContent = T("va.f_lead", "{n} von {m} Fotos kommen ins Video.", { n: imVideo.size, m: w.fotos.length })
          + (fotoOpt() && fotoOpt().kapitel ? " " + T("va.f_kapitel", "Je Reisetag zuerst das beste.") : "");
      }
      fotosInfo();
      try { zutatenStand(); } catch (_) {}
      vorschau.inhalt();
      try { alleZeichnen(); } catch (e) { if (window.rzSwallow) rzSwallow(e, "schnell:alle_medien"); }
    };
    const fotoGrund = (f) => f.gewaehlt ? T("schnell.foto_gewaehlt", "von dir gewählt") : f.eigen ? T("schnell.foto_eigen", "eigenes Foto") : (grundText(f.grund)[0] || "");
    /** 11.10.2026 (Marc: „die Bilder groß machen können … sonst weiß man gar nicht, welche das sind“) — die Großansicht des
     *  Foto-Bereichs (fotos.js) mit Blättern durch die gezeigte Liste. */
    const gross = (pfad, liste) => { try { if (window.rzFotos && window.rzFotos.gross) window.rzFotos.gross(pfad, liste, { oben: true }); } catch (e) { try { applog("warn", "[schnell] Großansicht: " + e); } catch (_) {} } };
    /** Neues Medium in eine Liste (nach Stelle sortiert), die Abwahl-Menge (Indizes) bleibt bei ihren Dateien. */
    const listeDazu = (liste, aus, e) => {
      const ausPfade = new Set([...aus].map(i => liste[i] && liste[i].path));
      liste.push(e); liste.sort((a, b) => (a.bei || 0) - (b.bei || 0));
      const neu = new Set(); liste.forEach((f, i) => { if (ausPfade.has(f.path)) neu.add(i); });
      return neu;
    };
    // ── 11.10.2026 (Marc: „so wenige Bilder vorgeschlagen … alle Bilder/Videos, also Medien der Tour“) — „Alle Medien
    //    der Tour“: Raster aus `tour_medien` (alle Fotos und Videos im Zeitraum, der Strecke zugeordnet), Vorschaubilder
    //    häppchenweise; Klick nimmt ins Video oder heraus (selbst gewählt = Vorrang), ⤢ zeigt groß. ──
    let alleMedien = null, alleLaedt = false;
    const alleThumbs = new Map();
    const GEWAEHLT_WERT = 1000;
    const imVideoPfade = () => {
      const s_ = new Set();
      try { stoppsJetzt().forEach(x => { if (x.clip && x.clip.pfad) s_.add(x.clip.pfad); else if (x.imageSrc) s_.add(x.imageSrc); }); ohneHaltJetzt().forEach(k => s_.add(k.f.path)); } catch (_) {}
      return s_;
    };
    async function alleLaden() {
      if (alleMedien || alleLaedt) return;
      alleLaedt = true; alleZeichnen();
      let r = null;
      try { r = await api().tour_medien(pfad); } catch (_) {}   // warte-ok: Ladeanzeige im Raster
      alleLaedt = false;
      alleMedien = (r && r.ok && Array.isArray(r.medien)) ? r.medien : [];
      const k = box.querySelector("[data-sv-alle] .sv-alle-n"); if (k) k.textContent = alleMedien.length ? ` (${alleMedien.length})` : "";
      alleZeichnen(); alleThumbsNachholen();
    }
    function alleZeichnen() {
      const el = box.querySelector("#sv-alle"); if (!el || el.hidden) return;
      if (!alleMedien) { el.innerHTML = `<span class="muted"><span class="spinner"></span> ${esc(T("medien.laedt", "Medien der Tour werden gesucht …"))}</span>`; return; }
      if (!alleMedien.length) { el.innerHTML = `<span class="muted">${esc(T("medien.keine", "Keine Fotos oder Videos aus dem Zeitraum dieser Tour."))}</span>`; return; }
      const drin = new Set(w.fotos.filter((_, i) => !w.fotosAus.has(i)).map(f => f.path).concat(w.clips.filter((_, i) => !w.clipsAus.has(i)).map(c => c.path)));
      const video = imVideoPfade();
      el.innerHTML = `<div class="muted sv-alle-info">${esc(T("schnell.alle_info", "{n} Fotos und Videos dieser Tour · Klick: ins Video oder heraus · ⤢ groß", { n: alleMedien.length }))}</div>`
        + `<div class="sv-alle-raster">` + alleMedien.map((m, i) => {
          const th = alleThumbs.get(m.path);
          return `<button type="button" class="sv-foto sv-alle-bild${drin.has(m.path) ? " is-on" : ""}${video.has(m.path) ? " va-im-video" : ""}${m.art === "video" ? " ist-video" : ""}" data-sv-alle-i="${i}" title="${esc(String(m.path).split(/[\\/]/).pop())}">`
            + (th ? `<img src="${th}" alt="">` : `<span class="sv-foto-leer">${vaIc(m.art === "video" ? "film" : "image", 16)}</span>`)
            + (m.art === "video" ? `<span class="sv-clip-play">${vaIc("play", 10)}</span>` : "")
            + `<span class="sv-foto-gross" data-sv-gross-alle="${i}" title="${esc(T("schnell.foto_gross", "Groß ansehen"))}">${vaIc("maximize-2", 12)}</span>`
            + (video.has(m.path) ? `<span class="sv-alle-haken">${vaIc("check", 12)}</span>` : "") + `</button>`;
        }).join("") + `</div>`;
    }
    let alleHolt = false;
    async function alleThumbsNachholen() {
      if (alleHolt || !alleMedien) return; alleHolt = true;
      try {
        const offen = alleMedien.filter(m => !alleThumbs.has(m.path)).map(m => m.path);
        for (let i = 0; i < offen.length; i += 40) {
          if (!box.isConnected) break;
          let r = null;
          try { r = await api().fotos_thumbs(offen.slice(i, i + 40)); } catch (_) {}   // warte-ok: Hintergrund, das Raster füllt sich
          for (const [pf, url] of Object.entries((r && r.ok && r.thumbs) || {})) if (url) alleThumbs.set(pf, url);
          box.querySelectorAll("[data-sv-alle-i]").forEach(k => {
            const m = alleMedien[+k.dataset.svAlleI], url = m && alleThumbs.get(m.path);
            if (url && !k.querySelector("img")) { const l = k.querySelector(".sv-foto-leer"); if (l) l.remove(); k.insertAdjacentHTML("afterbegin", `<img src="${url}" alt="">`); }
          });
        }
      } finally { alleHolt = false; }
    }
    async function alleUmschalten(m) {
      const video = m.art === "video";
      const liste = video ? w.clips : w.fotos, aus = video ? w.clipsAus : w.fotosAus;
      const i = liste.findIndex(f => f.path === m.path);
      if (i >= 0) {
        if (aus.has(i)) { aus.delete(i); liste[i].gewaehlt = true; liste[i].wert = Math.max(+liste[i].wert || 0, GEWAEHLT_WERT); }
        else aus.add(i);
      } else {
        let r = null;
        try {
          r = video ? await api().schnellvideo_clips(pfad, 1, [m.path], true) : await api().schnellvideo_fotos(pfad, 1, [m.path], "foto", true);   // warte-ok: ein Medium, kurz
        } catch (_) {}
        const e = ((r && r.ok && (video ? r.clips : r.fotos)) || [])[0];
        if (!e) { toast(T("schnell.alle_passt_nicht", "Dieses Medium lässt sich der Strecke nicht zuordnen."), "info", 3000); return; }
        Object.assign(e, { gewaehlt: true, wert: GEWAEHLT_WERT });
        if (video) w.clipsAus = listeDazu(w.clips, w.clipsAus, e); else w.fotosAus = listeDazu(w.fotos, w.fotosAus, e);
        const c = box.querySelector("#sv-fotos-an"); if (c && !video && !c.checked) c.checked = true;
      }
      fotosZeigen();
    }
    const fotosAusQuelle = async (art) => {
      let q = [];
      try {
        q = art === "ordner" ? await api().pick_file("folder", [])   // warte-ok: Systemdialog
                             : await api().pick_file("open", ["Fotos (*.jpg;*.jpeg;*.heic;*.heif;*.png;*.dng;*.arw;*.cr3;*.nef)"], true);   // warte-ok: Systemdialog
      } catch (_) { q = []; }
      if (!q || !q.length) return;
      const l = box.querySelector("#sv-fotos");
      if (l) l.innerHTML = `<span class="muted">${esc(T("schnell.fotos_lesen", "Fotos werden gelesen und der Strecke zugeordnet …"))}</span>`;
      let r = null;
      // 06.10.2026 (F-14 Q9) — eigene Fotos kommen DAZU (alle gewählten, der Strecke zugeordnet), markiert als „eigene“
      try { r = await rzWarten("schnellvideo_fotos", () => api().schnellvideo_fotos(pfad, 60, q, "foto", true)); } catch (_) {}
      const neu = (r && r.ok && Array.isArray(r.fotos)) ? r.fotos : [];
      const da = new Set(w.fotos.map(f => f.path));
      for (const f of neu) if (!da.has(f.path)) w.fotos.push(Object.assign({}, f, { eigen: true }));
      w.fotos.sort((a, b) => (a.bei || 0) - (b.bei || 0));
      w.fotosAus = new Set();
      w.fotosEigen = true;
      const nicht = Math.max(0, ((r && r.n_gesamt) || 0) - neu.length);
      if (nicht) toast(T("schnell.fotos_passen_n", "{n} Fotos passen nicht zur Tour (Ort oder Aufnahmezeit).").replace("{n}", nicht), "info", 4000);
      const an_ = box.querySelector("#sv-fotos-an"); if (an_ && neu.length) an_.checked = true;
      fotosZeigen();
    };
    box.querySelectorAll("[data-sv-plus]").forEach(b => b.addEventListener("click", () => fotosAusQuelle(b.dataset.svPlus)));
    box.querySelector("[data-sv-alle]")?.addEventListener("click", () => {
      const el = box.querySelector("#sv-alle"); if (!el) return;
      el.hidden = !el.hidden;
      box.querySelector("[data-sv-alle]").classList.toggle("is-on", !el.hidden);
      if (!el.hidden) { alleZeichnen(); alleLaden(); }
    });
    box.querySelector("#sv-alle")?.addEventListener("click", (e) => {
      if (!alleMedien) return;
      const g = e.target.closest("[data-sv-gross-alle]");
      if (g) { const m = alleMedien[+g.dataset.svGrossAlle]; if (m) gross(m.path, alleMedien.map(x => ({ path: x.path }))); return; }
      const b = e.target.closest("[data-sv-alle-i]"); if (!b) return;
      const m = alleMedien[+b.dataset.svAlleI]; if (m) alleUmschalten(m);
    });
    box.querySelector("#sv-fotos")?.addEventListener("click", (e) => {
      const q = e.target.closest("[data-sv-fotoquelle]"); if (q) { fotosAusQuelle(q.dataset.svFotoquelle); return; }
      const g = e.target.closest("[data-sv-gross]");
      if (g) { const f = w.fotos[+g.dataset.svGross]; if (f) gross(f.path, w.fotos.map(x => ({ path: x.path }))); return; }
      const b = e.target.closest("[data-sv-foto]"); if (!b) return;
      const i = +b.dataset.svFoto;
      if (w.fotosAus.has(i)) w.fotosAus.delete(i); else w.fotosAus.add(i);
      b.classList.toggle("is-on", !w.fotosAus.has(i));
      fotosInfo(); zutatenStand(); vorschau.inhalt();
    });
    box.querySelectorAll("[data-sv-gruppe='laenge']").forEach(r => r.addEventListener("click", () => setTimeout(() => { fotosInfo(); vorschau.inhalt(); }, 0)));
    box.querySelector("#sv-eigen")?.addEventListener("input", () => { w.eigenS = laengeKlemmen(box.querySelector("#sv-eigen").value || w.eigenS); fotosInfo(); });
    (async () => {
      let r = null;
      try { r = await api().schnellvideo_fotos(pfad); } catch (_) {}   // warte-ok: Hintergrund, der Dialog ist schon bedienbar
      w.fotos = (r && r.ok && Array.isArray(r.fotos)) ? r.fotos : [];
      if (!w.fotos.length && L.fotos_an == null) { const c = box.querySelector("#sv-fotos-an"); if (c) c.checked = false; }
      fotosZeigen();
    })();
    // ── 02.10.2026 — Videoclips (gleicher Streifen wie die Fotos) ──
    w.clips = []; w.clipsAus = new Set(); w.clipsGeladen = false;
    const clipsZeigen = () => {
      const l = box.querySelector("#sv-clips"); if (!l) return;
      if (!w.clips.length) {
        l.innerHTML = `<span class="muted">${esc(w.clipsEigen ? T("schnell.clips_passen_nicht", "Keiner der gewählten Clips passt zur Tour (Ort oder Aufnahmezeit).")
                                                         : T("schnell.clips_keine", "Keine Videoclips zu dieser Tour im Foto-Archiv."))}</span>
          <span class="sv-fotos-knoepfe"><button type="button" class="btn btn-small" data-sv-clipquelle="ordner">📁 ${esc(T("schnell.fotos_ordner", "Ordner wählen …"))}</button>
          <button type="button" class="btn btn-small" data-sv-clipquelle="dateien">🎞 ${esc(T("schnell.clips_dateien", "Clips wählen …"))}</button></span>`;
      } else {
        l.innerHTML = w.clips.map((c, i) => `<button type="button" class="sv-foto sv-clip${w.clipsAus.has(i) ? "" : " is-on"}" data-sv-clip="${i}" title="${esc(String(c.path).split(/[\\/]/).pop())}">`
          + (c.thumb ? `<img src="${c.thumb}" alt="">` : `<span class="sv-foto-leer">🎞</span>`) + `<span class="sv-clip-play">▶</span>`
          + `<span class="sv-foto-zeit">${esc((Math.round(Math.min(CLIP_S, +c.dauer || 0) * 10) / 10).toString().replace(".", ",") + " s")}</span></button>`).join("");
      }
      zutatenStand();
    };
    const clipsAusQuelle = async (art) => {
      let q = [];
      try {
        q = art === "ordner" ? await api().pick_file("folder", [])   // warte-ok: Systemdialog
                             : await api().pick_file("open", ["Video (*.mp4;*.mov;*.m4v;*.mts;*.m2ts;*.mkv;*.avi)"], true);   // warte-ok: Systemdialog
      } catch (_) { q = []; }
      if (!q || !q.length) return;
      const l = box.querySelector("#sv-clips");
      if (l) l.innerHTML = `<span class="muted">${esc(T("schnell.clips_lesen", "Clips werden gelesen und der Strecke zugeordnet …"))}</span>`;
      let r = null;
      try { r = await rzWarten("schnellvideo_clips", () => api().schnellvideo_clips(pfad, 4, q)); } catch (_) {}
      w.clipsEigen = true; w.clipsAus = new Set();
      w.clips = (r && r.ok && Array.isArray(r.clips)) ? r.clips : [];
      clipsZeigen(); fotosInfo();
    };
    box.querySelector("#sv-clips")?.addEventListener("click", (e) => {
      const q = e.target.closest("[data-sv-clipquelle]"); if (q) { clipsAusQuelle(q.dataset.svClipquelle); return; }
      const b = e.target.closest("[data-sv-clip]"); if (!b) return;
      const i = +b.dataset.svClip;
      if (w.clipsAus.has(i)) w.clipsAus.delete(i); else w.clipsAus.add(i);
      b.classList.toggle("is-on", !w.clipsAus.has(i));
      fotosInfo(); zutatenStand();
    });
    (async () => {
      // 06.10.2026 — Clips gehören nicht mehr ins Schnell-Video (Animator → Ton & Clips)
      w.clips = [];
      w.clipsGeladen = true;
      // Q1-Prinzip: was gefunden wird, ist vorgewählt — nichts gefunden → Schalter aus (Wahl bleibt änderbar)
      if (!w.clips.length && L.clips_an == null) { const c = box.querySelector("#sv-clips-an"); if (c) c.checked = false; }
      clipsZeigen(); fotosInfo();
    })();
    box.querySelector("#sv-titel")?.addEventListener("keydown", (e) => { e.currentTarget.dataset.getippt = "1"; });
    const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\uFE0F\u200D]/gu;
    const EMOJI1 = new RegExp(EMOJI.source, "u");   // ohne g: .test() ohne lastIndex-Gedächtnis
    const unhandlich = (x) => { x = String(x || ""); return EMOJI1.test(x) || x.length > 40 || /\.\.\.|…/.test(x); };
    /** „Pico del Teide Brutal: Teleferico 🔄 Teide + Roques …“ → „Pico del Teide Brutal“ (ohne Emojis, bis zum ersten Trenner, ≤ 40 Zeichen). */
    const kurzName = (x) => {
      let k = String(x || "").replace(EMOJI, " ").replace(/\.\.\.|…/g, " ").replace(/\s*\([^)]*\)?/g, " ").replace(/\s+/g, " ").trim();
      if (k.length > 40) { const m = k.split(/\s*[:|+]\s*|\s[-–]\s/)[0].trim(); if (m.length >= 4) k = m; }
      if (k.length > 40) k = k.slice(0, 40).replace(/\s+\S*$/, "") + " …";
      return k;
    };
    // ── 05.10.2026 — Titel-Vorschläge (Video-Assistent): Gipfel, Start → Ziel, „Rund um …" — ein Klick übernimmt ──
    (async () => {
      let r = null;
      try { r = await api().schnellvideo_titel_vorschlaege(pfad); } catch (_) {}   // warte-ok: Hintergrund, das Feld ist schon bedienbar
      const box_ = box.querySelector("#sv-titel-vorschl"); const ein = box.querySelector("#sv-titel");
      const liste = ((r && r.titel) || []).filter(x => x && x !== (ein && ein.value));
      // 11.10.2026 (Testvideo Teide: „Pico del Teide Brutal: Teleferico 🔄 Teide + Roques de Garcia, …“ als Titel) —
      // im Assistenten die bereinigte Kurzform des Tournamens als Vorschlag dazu (vorn, wenn es sonst keinen gibt)
      if (ASS && ein && unhandlich(ein.value)) { const k = kurzName(ein.value); if (k && !liste.includes(k)) liste.push(k); }
      if (!box_ || !liste.length) return;
      // 08.10.2026 (Klicktest) — Assistent: steht noch der Dateiname im Feld („2023-05-05_Barranco … -1106845751“,
      // „24613993220_ACTIVITY“), gleich den ersten Vorschlag nehmen; der Dateiname bleibt als Chip wählbar
      const dateiname = (x) => /^\d{4}-\d{2}-\d{2}[_ ]|\d{7,}|_ACTIVITY|\.(gpx|fit|kml)$/i.test(String(x || ""))
        || (ASS && unhandlich(x));   // 11.10.2026 (Testvideo Teide) — auch lange Komoot-Namen mit Emojis
      if (ASS && ein && !ein.dataset.getippt && dateiname(ein.value)) {
        const alt = ein.value; ein.value = liste[0]; ein.dispatchEvent(new Event("input"));
        liste.splice(0, 1, alt);
      }
      box_.innerHTML = `<span class="muted">${esc(T("schnell.titel_vorschlag", "Vorschläge:"))}</span>` + liste.map(x => `<button type="button" class="sv-titel-chip" data-sv-titel="${esc(x)}">${esc(x)}</button>`).join("");
      box_.addEventListener("click", (e) => { const c = e.target.closest("[data-sv-titel]"); if (c && ein) { ein.value = c.dataset.svTitel; ein.dispatchEvent(new Event("input")); } });
    })();
    // ── Logbuch ──
    /** 11.10.2026 — Video-Assistent „Die Geschichte“: die Momente aus dem Logbuch zum Anhaken,
     *  Vorauswahl nach Videolänge (Übernachtungen und Notizen zuerst, dann die längsten Pausen), dazu der höchste Punkt
     *  (= Highlights der Strecke) und die Kapitel (je Reisetag eines). Gewählte Momente werden Schilder. */
    function vaGeschichte() {
      const liste = box.querySelector("#va-g-liste"), lead = box.querySelector("#va-g-lead"), kap = box.querySelector("#va-g-kapitel");
      if (!liste || !w.lbGeladen) return;
      const ziel = { kurz: 2, normal: 4, lang: 7 }[w.laenge] || 4;
      // Am Höhepunkt (Gipfel …) steht schon ein Schild — dort kein zweites (Teide-Fund 05.10.: „Pause über Teide 3715 m“).
      // Solche Momente bleiben sichtbar, aber nicht wählbar, solange die Höhepunkte an sind (vorher fielen sie still weg).
      const hlAn = !!box.querySelector("#sv-highlights")?.checked;
      const amHoehepunkt = (x) => hlAn && (v.regie || []).some(rg => Math.abs(rg.bei - x.bei) < 0.05);
      const rand = lbRand(w);
      const sperrGrund = (x) => amRand(x, rand) ? (+x.bei < 0.5 ? T("va.g_am_start", "am Start — dort steht der Titel") : T("va.g_am_ziel", "am Ziel — dort kommt die Schlusskarte"))
        : amHoehepunkt(x) ? T("va.g_am_hoehepunkt", "am Höhepunkt — dort steht schon ein Schild") : "";
      if (!w.lbWahl) {
        const rang = w.lb.map((x, i) => ({ i, p: (x.icon === "uebernachtung" ? 3 : x.art === "notiz" ? 2 : 1) * 1e7 + (+x.dauer_s || 0) }))
          .filter(o => !sperrGrund(w.lb[o.i])).sort((a, b) => b.p - a.p);
        if (w.lbTage > 1 && ziel > 1) {
          // Mehrtagestour: über die ganze Reise verteilen — je gleichmäßig verteilten Tag der beste Moment
          const proTag = new Map(); for (const o of rang) { const k = +w.lb[o.i].tag || 0; if (!proTag.has(k)) proTag.set(k, o.i); }
          const tage = [...proTag.keys()].sort((a, b) => a - b), wahl = new Set();
          for (let k = 0; k < ziel && k < tage.length; k++) wahl.add(proTag.get(tage[Math.round(k * (tage.length - 1) / Math.max(1, ziel - 1))]));
          w.lbWahl = wahl;
        } else w.lbWahl = new Set(rang.slice(0, ziel).map(x => x.i));
      }
      const SYM = { pause: "coffee", uebernachtung: "moon", notiz: "notebook-pen" };
      const zeile = (key, icon, name, sub, an, aus) => `<label class="va-g-zeile${aus ? " va-g-aus" : ""}"><input type="checkbox" data-va-g="${key}"${an && !aus ? " checked" : ""}${aus ? " disabled" : ""}>`
        + `<span class="va-g-ic">${I(icon, 15)}</span><span class="va-g-text"><b>${esc(name)}</b><small>${esc(sub)}</small></span></label>`;
      const zeilen = [];
      if (w.lbHoch) zeilen.push(zeile("hoch", "mountain", T("va.g_hoch", "Höchster Punkt") + (w.lbHoch.ele ? " · " + Math.round(+w.lbHoch.ele) + " m" : ""),
        [w.lbTage > 1 && w.lbHoch.tag ? T("va.g_tag", "Tag {n}", { n: w.lbHoch.tag }) : "", w.lbHoch.zeit, T("va.g_grund_hoch", "mit den anderen Höhepunkten der Strecke")].filter(Boolean).join(" · "),
        !!box.querySelector("#sv-highlights")?.checked));
      const proTag = new Map();   // Mehrtagestour: Zeilen je Tag (= Kapitel) gruppieren
      w.lb.forEach((x, i) => {
        const grund = x.icon === "uebernachtung" ? T("va.g_grund_nacht", "Ende eines Tages") : x.art === "notiz" ? T("va.g_grund_notiz", "deine Notiz im Logbuch")
          : T("va.g_grund_pause", "{n} min Pause", { n: Math.round((+x.dauer_s || 0) / 60) });
        const tag = w.lbTage > 1 && x.tag ? T("va.g_tag", "Tag {n}", { n: x.tag }) : "";
        const belegt = sperrGrund(x);
        if (belegt) w.lbWahl.delete(i);
        const html = zeile(String(i), SYM[x.icon] || "map-pin", x.text,
          [w.lbTage > 1 ? "" : tag, x.zeit, belegt || grund].filter(Boolean).join(" · "), w.lbWahl.has(i), !!belegt);
        if (w.lbTage > 1) { const k = +x.tag || 0; if (!proTag.has(k)) proTag.set(k, { html: [], n: 0, an: 0 }); const g = proTag.get(k); g.html.push(html); g.n++; if (w.lbWahl.has(i)) g.an++; }
        else zeilen.push(html);
      });
      for (const [k, g] of [...proTag.entries()].sort((a, b) => a[0] - b[0])) {
        zeilen.push(`<details class="va-g-tag"${g.an ? " open" : ""}><summary>${esc(T("va.g_tag_kopf", "Tag {n} · {m} Momente{w}", { n: k || "?", m: g.n,
          w: g.an ? " · " + T("va.g_tag_gewaehlt", "{a} gewählt", { a: g.an }) : "" }))}</summary>${g.html.join("")}</details>`);
      }
      liste.innerHTML = zeilen.join("") || `<p class="muted">${esc(T("va.g_leer", "Im Logbuch dieser Tour gibt es keine längeren Pausen oder Notizen — der Assistent nimmt die Höhepunkte der Strecke."))}</p>`;
      const n = w.lb.length + (w.lbHoch ? 1 : 0);
      const lname = { kurz: T("va.g_kurz", "kurzes"), lang: T("va.g_lang", "langes") }[w.laenge] || T("va.g_normal", "normales");
      if (lead) lead.textContent = n ? T("va.g_lead", "Ich habe {n} mögliche Momente gefunden. Für ein {laenge} Video passen etwa {k} gut.",
        { n, laenge: lname, k: Math.min(n, ziel + (w.lbHoch ? 1 : 0)) }) : "";
      if (kap) kap.textContent = w.lbTage > 1 ? T("va.g_kapitel_n", "Je Reisetag ein Kapitel — {n} Kapitel.", { n: w.lbTage })
        : T("va.g_kapitel_1", "Diese Tour dauert einen Tag — Kapitel sind hier nicht nötig.");
      const lbcb = box.querySelector("#sv-logbuch");
      const sync = () => { if (lbcb) lbcb.checked = w.lbWahl.size > 0; };
      liste.querySelectorAll("[data-va-g]").forEach(cb => cb.addEventListener("change", () => {
        if (cb.dataset.vaG === "hoch") { const h = box.querySelector("#sv-highlights"); if (h && h.checked !== cb.checked) h.click(); setTimeout(vaGeschichte, 0); }
        else { const i = +cb.dataset.vaG; if (cb.checked) w.lbWahl.add(i); else w.lbWahl.delete(i); }
        sync();
        try { applog("info", `[assistent] Geschichte: ${w.lbWahl.size} Momente${box.querySelector("#sv-highlights")?.checked ? " + Höhepunkte" : ""}`); } catch (_) {}
        if (typeof vaLive === "function") vaLive();
      }));
      sync();
    }
    /** 11.10.2026 — Stufe „Halte“: an allen Foto-Schildern anhalten, Dauer, Heranfahren. */
    const HALT_FAKTOR = { kurz: 0.6, normal: 1, lang: 1.7 };
    /** Vorgabe nach der Foto-Art: große Fotos halten an, Sofortbilder/Bild im Bild fahren durch — bis man selbst wählt. */
    const halteAn = () => (typeof w.halteAlle === "boolean" ? w.halteAlle : (() => { try { return fotoArtJetzt() === "gross"; } catch (_) { return true; } })());
    function vaHalte() {
      let pip = false; try { pip = fotoArtJetzt() === "pip"; } catch (_) {}
      const cb = box.querySelector("#va-h-alle"); if (cb) { cb.checked = !pip && halteAn(); cb.disabled = pip; }
      const lead = box.querySelector("#va-h-lead");
      if (lead) {
        let n = 0; try { n = stoppsJetzt().filter(x => x.imageSrc && !x.clip).length + (fotoArtJetzt() !== "gross" ? ohneHaltJetzt().length : 0); } catch (_) {}
        lead.textContent = pip ? T("va.h_lead_pip", "Bei „Bild im Bild“ laufen die Fotos in einer Ecke mit — das Video fährt durch.") : !halteAn() ? T("va.h_lead_aus", "Das Video fährt durch — die Fotos erscheinen unterwegs.")
          : n ? T("va.h_lead", "Das Video hält an {n} Foto-Schildern.", { n }) : T("va.h_lead_keine", "Es sind noch keine Fotos gewählt — Halte entstehen an den Fotos (Stufe „Fotos“).");
      }
      if (box.__vaHalteGebunden) return;
      box.__vaHalteGebunden = true;
      box.querySelector("#va-h-alle")?.addEventListener("change", (e) => { w.halteAlle = !!e.target.checked; vaHalte(); vaLive(); });
      box.querySelector("#va-h-heran")?.addEventListener("change", (e) => { w.fotoPause = e.target.checked ? "heran" : "stehen"; vaLive(); });
      box.querySelector("#va-h-dauer")?.addEventListener("click", (e) => {
        const b = e.target.closest("[data-va-h-dauer]"); if (!b) return;
        w.halteDauer = b.dataset.vaHDauer;
        box.querySelectorAll("[data-va-h-dauer]").forEach(x => x.classList.toggle("is-on", x === b));
        vaLive();
      });
    }
    /** 11.10.2026 — Kamera-Stufe: ruhig↔lebendig und die Bewegung je Moment der Geschichte in Worten. */
    const BEW_TEXT = () => ({ panorama: T("va.k_b_panorama", "aufziehen und zum Horizont blicken"), nah: T("va.k_b_nah", "näher heran und steiler"),
                              ruhig: T("va.k_b_ruhig", "ruhig weiterfliegen") });
    function kamMomente() {
      const raus = [];
      const hoch = (v.regie || []).find(r => r && r.art === "hoechster" && isFinite(+r.bei));
      if (hoch && box.querySelector("#sv-highlights")?.checked) raus.push({ key: "hoch", bei: +hoch.bei, name: T("va.g_hoch", "Höchster Punkt"), standard: "panorama" });
      if (w.lbWahl) w.lb.forEach((x, i) => { if (w.lbWahl.has(i)) raus.push({ key: String(i), bei: +x.bei, name: x.text, standard: x.icon === "uebernachtung" ? "ruhig" : "nah" }); });
      w.kamBew = w.kamBew || {};
      return raus.sort((a, b) => a.bei - b.bei).map(m => ({ ...m, bewegung: w.kamBew[m.key] || m.standard }));
    }
    function kamOptSetzen() {
      if (!ASS) return;
      w.kamOpt = w.kamera === "fahrt" ? { lebendig: isFinite(+w.kamLeb) ? +w.kamLeb : 0.5, momente: kamMomente().map(m => ({ bei: m.bei, bewegung: m.bewegung })) } : null;
    }
    function vaKamera() {
      const fahrt = box.querySelector("#va-k-fahrt"); if (fahrt) fahrt.hidden = w.kamera !== "fahrt";
      const liste = box.querySelector("#va-k-momente");
      if (liste) {
        const ms = kamMomente(), BT = BEW_TEXT();
        liste.innerHTML = ms.length ? ms.map(m => `<div class="va-g-zeile va-k-zeile"><span class="va-g-text"><b>${esc(m.name)}</b><small>${esc(BT[m.bewegung])}</small></span>`
          + `<button type="button" class="btn btn-sm" data-va-k-anders="${esc(m.key)}">${esc(T("va.k_anders", "andere Bewegung"))}</button></div>`).join("")
          : `<p class="muted" style="font-size:12px">${esc(T("va.k_keine", "Keine Momente gewählt — die Kamera fliegt die Strecke entlang (Stufe „Die Geschichte“)."))}</p>`;
        liste.querySelectorAll("[data-va-k-anders]").forEach(b => b.onclick = () => {
          const m = kamMomente().find(x => x.key === b.dataset.vaKAnders); if (!m) return;
          w.kamBew[m.key] = BEWEGUNGEN[(BEWEGUNGEN.indexOf(m.bewegung) + 1) % BEWEGUNGEN.length];
          vaKamera(); kamOptSetzen(); vaLive();
        });
      }
      if (!box.__vaKamGebunden) {
        box.__vaKamGebunden = true;
        box.querySelector("#va-k-leb")?.addEventListener("change", (e) => { w.kamLeb = +e.target.value; kamOptSetzen(); vaLive(); });
      }
      kamOptSetzen();
    }
    /** 11.10.2026 — Stufe „Texte“: wenige (nur Titel) · normal (Titel, Unterzeile, Kapitel je Tag)
     *  · viele (dazu Ort, Uhrzeit und Kameradaten unter den Fotos). Kapiteltitel nur so dicht, dass jeder ~3,5 s Platz hat. */
    const KAPITEL_ABSTAND_S = 3.5;
    function kapitelTitel() {
      if (!ASS || (w.textMenge || "normal") === "wenige" || !(w.lbTage > 1) || !Array.isArray(w.lbKapitel)) return [];
      const animS = Math.max(8, laengeS(w) - INTRO_S - HOLD_S);
      const sprache = (window.rzSprachCode ? window.rzSprachCode() : "de") || "de";
      const raus = []; let letzt = -1;
      for (const k of w.lbKapitel) {
        if (!isFinite(+k.bei) || +k.bei <= 0.001) continue;   // Tag 1 trägt der Titel
        if (letzt >= 0 && (+k.bei - letzt) * animS < KAPITEL_ABSTAND_S) continue;
        let d = "";
        try { d = k.datum ? new Date(k.datum + "T12:00:00").toLocaleDateString(sprache, { day: "numeric", month: "long" }) : ""; } catch (_) {}
        raus.push({ bei: +k.bei, text: [T("va.g_tag", "Tag {n}", { n: k.tag }), d].filter(Boolean).join(" · ") });
        letzt = +k.bei;
      }
      return raus;
    }
    function vaTexte() {
      const e = box.querySelector("#va-t-erkl");
      if (e) {
        const n = kapitelTitel().length;
        e.textContent = { wenige: T("va.t_e_wenige", "Nur der Titel am Anfang."),
                          viele: T("va.t_e_viele", "Titel, Unterzeile, Kapitel je Tag und unter jedem Foto Ort, Uhrzeit und Kameradaten.") }[w.textMenge]
          || T("va.t_e_normal", "Titel und Unterzeile, unter den Fotos Ort und Uhrzeit.") + (n ? " " + T("va.t_e_kapitel", "Dazu {n} Kapiteltitel (Tag und Datum).", { n }) : "");
      }
      if (box.__vaTexteGebunden) return;
      box.__vaTexteGebunden = true;
      box.querySelector("#va-t-menge")?.addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-va-t-menge]"); if (!b) return;
        w.textMenge = b.dataset.vaTMenge;
        box.querySelectorAll("[data-va-t-menge]").forEach(x => x.classList.toggle("is-on", x === b));
        vaTexte(); vaLive();
      });
      ["#sv-titel", "#sv-unter"].forEach(sel => box.querySelector(sel)?.addEventListener("change", () => vaLive()));
    }
    w.lb = []; w.lbGeladen = false;
    (async () => {
      let r = null;
      try { r = await api().schnellvideo_logbuch(pfad); } catch (_) {}   // warte-ok: Hintergrund
      w.lb = (r && r.ok && Array.isArray(r.eintraege)) ? r.eintraege : [];
      w.lbHinweis = (r && r.hinweis) || "";
      w.lbTage = (r && +r.tage) || 1; w.lbHoch = (r && r.hoechster) || null; w.lbKapitel = (r && Array.isArray(r.kapitel)) ? r.kapitel : [];
      w.lbGeladen = true;
      zutatenStand();
      if (ASS) try { vaGeschichte(); } catch (e) { try { applog("warn", "[assistent] Geschichte: " + e); } catch (_) {} }
    })();
    // ── Musik: eigene Datei, Probehören ──
    // 11.10.2026 (Marc: „die Musik müsste man anhören können, bevor man sie auswählt“) — ▶ wieder neben dem Klappmenü
    // (war seit 0.9.782 weg), im Assistenten zusätzlich eine Liste: jedes Stück mit eigenem ▶, Klick auf die Zeile wählt.
    let hoeren = null, hoerenWert = "";
    const hoerenStopp = () => {
      try { if (hoeren) hoeren.pause(); } catch (_) {}
      hoeren = null; hoerenWert = "";
      const b = box.querySelector("#sv-musik-hoeren"); if (b) b.innerHTML = vaIc("play", 14);
      musikListe();
    };
    const hoerenStart = async (d) => {
      hoerenStopp();
      if (!d) return;
      let url = "";
      try { const r = await api().ton_url(d); url = (r && r.ok && r.url) || ""; } catch (_) {}   // warte-ok: sofort
      if (!url) { toast(T("schnell.musik_hoeren_fehlt", "Dieses Stück lässt sich gerade nicht abspielen."), "info", 3000); return; }
      hoeren = new Audio(url); hoeren.volume = 0.7; hoerenWert = d;
      hoeren.addEventListener("ended", () => hoerenStopp());
      const p = hoeren.play(); if (p && p.catch) p.catch(() => {});
      const b = box.querySelector("#sv-musik-hoeren"); if (b && d === box.querySelector("#sv-musik")?.value) b.innerHTML = vaIc("pause", 14);
      musikListe();
    };
    function musikListe() {
      const l = box.querySelector("#va-musik-liste"), sel = box.querySelector("#sv-musik"); if (!l || !sel) return;
      l.innerHTML = [...sel.options].map(o => `<div class="va-mu-zeile${o.value === sel.value ? " is-on" : ""}" data-va-mu="${esc(o.value)}" role="button" tabindex="0">`
        + `<button type="button" class="va-mu-play" data-va-mu-play="${esc(o.value)}" title="${esc(T("schnell.musik_hoeren", "Probehören"))}">${vaIc(hoerenWert === o.value ? "pause" : "play", 14)}</button>`
        + `<span>${esc(String(o.textContent || "").replace(/^🎵\s*/, ""))}</span></div>`).join("");
    }
    box.querySelector("#va-musik-liste")?.addEventListener("click", (e) => {
      const pl = e.target.closest("[data-va-mu-play]");
      if (pl) { e.stopPropagation(); if (hoerenWert === pl.dataset.vaMuPlay) hoerenStopp(); else hoerenStart(pl.dataset.vaMuPlay); return; }
      const z = e.target.closest("[data-va-mu]"); if (!z) return;
      const sel = box.querySelector("#sv-musik"); if (!sel) return;
      sel.value = z.dataset.vaMu;
      const an = box.querySelector("#sv-musik-an"); if (an && !an.checked) { an.checked = true; an.dispatchEvent(new Event("change", { bubbles: true })); }
      const spielt = hoerenWert;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      if (spielt === sel.value) hoerenStart(spielt);   // gewählt, was gerade läuft: weiterhören
      musikListe();
    });
    box.querySelector("#sv-musik-datei")?.addEventListener("click", async () => {
      let r = null;
      try { r = await api().pick_file("open", ["Audio (*.mp3;*.m4a;*.aac;*.wav;*.flac;*.ogg;*.opus;*.aif;*.aiff)"]); } catch (_) {}   // warte-ok: Systemdialog
      const datei = Array.isArray(r) ? r[0] : r;
      if (!datei) return;
      const sel = box.querySelector("#sv-musik");
      let o = [...sel.options].find(x => x.value === datei);
      if (!o) { o = document.createElement("option"); o.value = datei; o.textContent = "🎵 " + String(datei).split(/[\\/]/).pop(); sel.appendChild(o); }
      sel.value = datei; hoerenStopp();
      const an = box.querySelector("#sv-musik-an"); if (an) an.checked = true;
      zutatenStand();
    });
    box.querySelector("#sv-musik")?.addEventListener("change", hoerenStopp);
    box.querySelector("#sv-musik-hoeren")?.addEventListener("click", () => {
      if (hoeren) { hoerenStopp(); return; }
      hoerenStart(box.querySelector("#sv-musik").value);
    });
    musikListe();
    const wache = setInterval(() => { if (!box.isConnected || !document.getElementById("sv-musik")) { hoerenStopp(); vorschau.weg(); clearInterval(wache); } }, 500);   // Dialog zu → Probehören aus
    // ── Stand je Zutat + Kurzfassung an „Mehr" ──
    // Schalter-Stand: aus dem Dialog, nach dem Schließen aus dem zuletzt gelesenen Stand (werteLesen) —
    // „Übernehmen" und „Rendern" schließen den Dialog, bevor die Schilder gebaut werden.
    const SCHALTER = ["sv-fotos-an", "sv-clips-an", "sv-clipton", "sv-logbuch", "sv-musik-an", "sv-klick", "sv-uebersicht", "sv-schluss-an", "sv-gebaeude"];
    // 06.10.2026 — Schalter, die nicht mehr im Dialog stehen: Übersichtskarte aus der Vorlage, 3D-Häuser automatisch
    // (Tour führt durch einen Ort), Klick wie zuletzt; Clips und Logbuch aus (→ Animator/Assistent).
    const stand = { "sv-uebersicht": !!VORLAGEN[w.vorlage].uebersicht, "sv-gebaeude": !!w.gebaeude, "sv-klick": w.klick,
                    "sv-clips-an": false, "sv-clipton": false, "sv-logbuch": false };
    const an = (id) => { const e = box.isConnected ? box.querySelector("#" + id) : null; return e ? !!e.checked : !!stand[id]; };
    const fotoArtJetzt = () => { const e = box.isConnected ? box.querySelector("#sv-fotoart") : null; return (e && e.value) || w.fotoArt || "gross"; };
    const fotosGewaehlt = () => an("sv-fotos-an") ? w.fotos.filter((_, i) => !w.fotosAus.has(i)) : [];
    function stoppsJetzt() {
      const fotos = fotoArtJetzt() === "gross" ? fotosGewaehlt() : [];
      // 11.10.2026 — Clips gibt es im Schnell-Video nicht mehr als Zutat; selbst gewählte („Alle Medien der Tour“) kommen rein
      const clips = (an("sv-clips-an") || w.clips.some(c => c.gewaehlt)) ? w.clips.filter((_, i) => !w.clipsAus.has(i) && (an("sv-clips-an") || w.clips[i].gewaehlt)) : [];
      return stoppsWaehlen(fotos, clips, animSJetzt(), an("sv-clipton"), fotoOpt());
    }
    /** 11.10.2026 — Assistent: weniger↔mehr und je Kapitel ein Foto. */
    function fotoOpt() {
      if (!ASS) return null;
      const m = isFinite(+w.fotoMenge) ? Math.max(0, Math.min(1, +w.fotoMenge)) : 0.5;
      return { faktor: 0.4 + 1.2 * m, kapitel: (w.lbTage > 1 && Array.isArray(w.lbKapitel)) ? w.lbKapitel.map(k => +k.bei).filter(isFinite) : null };
    }
    /** 05.10.2026 — Fotos ohne Halt (Sofortbild / Bild im Bild), mit Abstand zu den Clip-Stopps. */
    function ohneHaltJetzt() {
      if (fotoArtJetzt() === "gross") return [];
      return fotosOhneHalt(fotosGewaehlt(), animSJetzt(), stoppsJetzt().map(x => x.__bei), fotoOpt());
    }
    // für die Vorschau (svVorschau): die Fotos, die tatsächlich ins Video kommen
    w.__fotosImVideo = () => {
      try {
        const drin = new Set(stoppsJetzt().filter(x => !x.clip).map(x => x.imageSrc));
        for (const k of ohneHaltJetzt()) drin.add(k.f.path);
        return (w.fotos || []).filter(f => drin.has(f.path));
      } catch (_) { return []; }
    };
    function zutatenStand() {
      const st = stoppsJetzt();
      const setz = (id, txt) => { const e = box.querySelector("#" + id + "-stand"); if (e) e.textContent = txt || ""; };
      setz("sv-fotos-an", w.fotos.length ? `${st.filter(x => !x.clip).length + ohneHaltJetzt().length} / ${w.fotos.length}` : "—");
      setz("sv-clips-an", !w.clipsGeladen ? "…" : w.clips.length ? `${st.filter(x => x.clip).length} / ${w.clips.length}` : "—");
      const lbN = w.lb.length;
      setz("sv-logbuch", !w.lbGeladen ? "…" : lbN ? (lbN === 1 ? T("schnell.lb_stand_1", "1 Eintrag") : T("schnell.lb_stand", "{n} Einträge").replace("{n}", lbN)) : (w.lbHinweis ? "—" : T("schnell.lb_keine", "keine Pausen")));
      const mu = box.querySelector("#sv-musik");
      setz("sv-musik-an", !mu ? "" : mu.value && !mu.value.startsWith("builtin:") ? String(mu.value).split(/[\\/]/).pop()
                                    : String(mu.options[mu.selectedIndex]?.textContent || "").split(" — ")[0].replace(/ \(.*\)$/, ""));
      for (const [id, teil] of [["sv-fotos-an", "fotos"], ["sv-clips-an", "clips"], ["sv-musik-an", "musik"], ["sv-schluss-an", "schluss"], ["sv-logbuch", "logbuch"]]) {
        const z = box.querySelector(`[data-sv-zutat="${teil}"]`); if (z) z.classList.toggle("ist-aus", !an(id));
      }
      mehrKurz();
    }
    function mehrKurz() {
      const k = box.querySelector("#sv-mehr-kurz"); if (!k) return;
      const st = (() => { try { return stoppsJetzt(); } catch (_) { return []; } })();
      const nf = st.filter(x => !x.clip).length + (() => { try { return ohneHaltJetzt().length; } catch (_) { return 0; } })(), nc = st.filter(x => x.clip).length;
      const teile = [];
      if (an("sv-fotos-an") && nf) teile.push("📸 " + nf);
      if (an("sv-clips-an") && nc) teile.push("🎞 " + nc);
      if (an("sv-logbuch") && w.lb.length) teile.push("📖");
      if (an("sv-musik-an")) teile.push("🎵");
      if (an("sv-uebersicht")) teile.push("🗺");
      if (an("sv-gebaeude")) teile.push("🏠");
      if (an("sv-schluss-an")) teile.push("🏁");
      k.textContent = teile.join(" · ");
    }
    // Häuser: noch nie gewählt → vorwählen, wenn die Tour durch einen Ort führt (Photon, im Hintergrund)
    if (w.gebaeude === undefined || w.gebaeude === null) {
      (async () => {
        let r = null;
        try { r = await api().schnellvideo_bebaut(pfad); } catch (_) {}   // warte-ok: Hintergrund
        const c = box.querySelector("#sv-gebaeude");
        if (r && r.ok) { stand["sv-gebaeude"] = !!r.bebaut; if (c) c.checked = !!r.bebaut; zutatenStand(); }
      })();
    }
    box.querySelectorAll("#sv-fotos-an, #sv-clips-an, #sv-clipton, #sv-logbuch, #sv-musik-an, #sv-uebersicht, #sv-schluss-an, #sv-gebaeude")
      .forEach(e => e.addEventListener("change", () => { fotosInfo(); zutatenStand(); vorschau.inhalt(); }));
    box.querySelector("#sv-highlights")?.addEventListener("change", () => vorschau.inhalt());
    box.querySelectorAll("#sv-zahlen, #sv-profil").forEach(e => e.addEventListener("change", () => vorschau.einblendungen()));
    box.querySelector("#sv-titel")?.addEventListener("input", () => vorschau.titel());
    zutatenStand();
    const schilderJetzt = () => {
      const st = stoppsJetzt().concat(fotoArtJetzt() === "sofortbild" ? ohneHaltJetzt().map(k => sofortbildSchild(k, w.sofortGroesse)) : [])
        .sort((a, b) => a.__bei - b.__bei);
      if (w.fotoPause === "stehen") st.forEach(x => { if (x.stopp && !x.clip) x.stopp_kamera = false; });   // F-5: Pause ohne Heranfahren
      // 11.10.2026 — Assistent, Stufe „Halte“: an allen Foto-Schildern oder an keinem; Dauer kurz/normal/lang
      if (ASS) {
        const f = HALT_FAKTOR[w.halteDauer] || 1, an = halteAn(), menge = w.textMenge || "normal";
        st.forEach(x => {   // Texte: wenige = keine Unterschrift, viele = mit Kameradaten
          if (!x.imageSrc || x.clip) return;
          x.stopp_ortzeit = menge !== "wenige"; x.stopp_exif = menge === "viele";
          if (menge === "wenige" && x.style === "sofortbild" && !x.__eigenText) x.text = "";
        });
        st.forEach(x => {
          if (!x.imageSrc || x.clip) return;
          if (!an) { x.stopp = false; return; }
          // Sofortbilder halten dann auch an — und behalten am Halt ihr Aussehen (Fotostopp-Look „wie unterwegs“)
          if (!x.stopp) Object.assign(x, { stopp: true, stopp_s: STOPP.sek, stopp_anflug_s: STOPP.anflug, stopp_abflug_s: STOPP.abflug,
                                           stopp_zoom: 1.5, stopp_schwenk: 2, stopp_ken: 0, stopp_look: "schild", stopp_ortzeit: true, stopp_exif: false });
          x.stopp_s = Math.max(1, Math.round((+x.stopp_s || STOPP.sek) * f * 10) / 10);
        });
      }
      const lbListe = w.lbWahl ? w.lb.filter((x, i) => w.lbWahl.has(i)) : w.lb;
      const lbSchilder = (an("sv-logbuch") && lbListe.length) ? logbuchAnwenden(st, lbListe, (v.regie || []).map(r => r.bei), !!w.lbWahl, lbRand(w)) : [];
      return st.map(x => { const o = Object.assign({}, x); delete o.__bei; delete o.__eigenText; return o; }).concat(lbSchilder);
    };
    // ── 05.10.2026 — Vorlagen (Weite/Tagebuch/Puls): belegen Zutaten, Kartenstil, Fotoart und Musik vor ──
    const vlStand = () => {
      const e = box.querySelector("#sv-vl-stand"); if (!e) return;
      e.textContent = w.angepasst ? T("schnell.vl_angepasst", "Vorlage angepasst — ein Klick auf die Vorlage stellt sie wieder her.") : "";
      box.querySelectorAll("[data-sv-vorlage]").forEach(b => b.classList.toggle("is-on", !w.eigeneVorlage && b.dataset.svVorlage === w.vorlage));
      box.querySelectorAll("[data-sv-eigen]").forEach(b => b.classList.toggle("is-on", b.dataset.svEigen === w.eigeneVorlage));
    };
    let vlSetzt = false;   // während die Vorlage Felder setzt, nicht als „angepasst" zählen
    const vorlageSetzen = (n) => {
      const V = VORLAGEN[n]; if (!V) return;
      vlSetzt = true;
      try {
        w.vorlage = n; w.angepasst = false; w.fotoArt = V.fotoArt;
        if (ASS) { w.look = V.look; box.querySelectorAll("[data-va-look]").forEach(b => b.classList.toggle("is-on", b.dataset.vaLook === w.look)); }
        const setz = (id, an_) => { const e = box.querySelector("#" + id); if (e) e.checked = !!an_; };
        setz("sv-zahlen", V.zahlen); setz("sv-profil", V.profil); stand["sv-uebersicht"] = !!V.uebersicht;
        box.querySelectorAll("[data-sv-feld]").forEach(c => { c.checked = V.felder.includes(c.dataset.svFeld); });
        const st = box.querySelector("#sv-stil"); if (st) { st.value = vorlageStil(n); rechte(); }
        const fa = box.querySelector("#sv-fotoart"); if (fa) fa.value = V.fotoArt;
        const mu = box.querySelector("#sv-musik");
        if (mu && (!mu.value || mu.value.startsWith("builtin:"))) { mu.value = V.musik; hoerenStopp(); }
        try { applog("info", `[schnell] Vorlage ${n}`); } catch (_) {}
      } finally { vlSetzt = false; }
      fotosInfo(); zutatenStand(); vlStand();
      vorschau.stil();
    };
    // ── 11.10.2026 — eigene Videostil-Vorlagen: gemeinsam für Assistent und Schnell-Video ──
    let eigene = Array.isArray(v.eigene_vorlagen) ? v.eigene_vorlagen.slice() : [];
    const eigeneZeichnen = () => {
      const z = box.querySelector("#sv-eigene"); if (!z) return;
      if (ASS) {
        z.innerHTML = eigene.map(x => `<button type="button" class="va-karte sv-vorlage-eigen${w.eigeneVorlage === x.id ? " is-on" : ""}" data-sv-eigen="${esc(x.id)}" title="${esc(T("va.v_eigen_tip", "Eigene Vorlage — Rechtsklick: löschen"))}">`
          + `<span class="va-ic">${vaIc("star", 22)}</span><b>${esc(x.name)}</b><span>${esc([T("va.v_eigen", "eigene Vorlage"), (x.stil || {}).format, (x.stil || {}).laenge === "eigen" ? ((x.stil || {}).eigen_s + " s") : T("schnell." + ((x.stil || {}).laenge || ""), (x.stil || {}).laenge || "")].filter(Boolean).join(" · "))}</span></button>`).join("");
        return;
      }
      z.innerHTML = eigene.map(x => `<button type="button" class="sv-vorlage sv-vorlage-eigen${w.eigeneVorlage === x.id ? " is-on" : ""}" data-sv-eigen="${esc(x.id)}" title="${esc(T("va.v_eigen_tip", "Eigene Vorlage — Rechtsklick: löschen"))}">`
        + `<span class="sv-vl-name">${vaIc("star", 13)} ${esc(x.name)}</span><span class="sv-vl-text">${esc(T("va.v_eigen", "eigene Vorlage"))}</span></button>`).join("");
    };
    const stilJetzt = () => {
      try { werteLesen(); } catch (_) {}
      const mu = box.querySelector("#sv-musik");
      return { vorlage: w.vorlage, format: w.format, laenge: w.laenge, eigen_s: w.eigenS, look: w.look || null, zahlen: an("sv-zahlen"), profil: an("sv-profil"),
               uebersicht: an("sv-uebersicht"), felder: w.felder.slice(), musik: mu ? mu.value : w.musik, kamera: w.kamera || null,
               kam_leb: isFinite(+w.kamLeb) ? +w.kamLeb : null, halte_dauer: w.halteDauer || null, halte_alle: typeof w.halteAlle === "boolean" ? w.halteAlle : null,
               text_menge: w.textMenge || null, foto_menge: isFinite(+w.fotoMenge) ? +w.fotoMenge : null, schluss_an: an("sv-schluss-an"),
               foto_art: w.fotoArt, highlights: an("sv-highlights"), gebaeude: an("sv-gebaeude") };
    };
    const eigeneSetzen = (id) => {
      const E = eigene.find(x => x.id === id); if (!E) return;
      const st = E.stil || {};
      if (VORLAGEN[st.vorlage]) vorlageSetzen(st.vorlage);
      vlSetzt = true;
      try {
        const klick = (g, wert) => { if (wert) box.querySelector(`[data-sv-gruppe="${g}"] [data-sv-wert="${wert}"]`)?.click(); };
        klick("format", st.format); klick("laenge", st.laenge);
        if (st.laenge === "eigen" && st.eigen_s) { w.eigenS = laengeKlemmen(st.eigen_s); const e = box.querySelector("#sv-eigen"); if (e) e.value = w.eigenS; }
        const setz = (id_, an_) => { const e = box.querySelector("#" + id_); if (e && typeof an_ === "boolean") e.checked = an_; };
        setz("sv-zahlen", st.zahlen); setz("sv-profil", st.profil); setz("sv-schluss-an", st.schluss_an); setz("sv-highlights", st.highlights); setz("sv-gebaeude", st.gebaeude);
        if (typeof st.uebersicht === "boolean") { stand["sv-uebersicht"] = st.uebersicht; setz("sv-uebersicht", st.uebersicht); }
        if (Array.isArray(st.felder)) box.querySelectorAll("[data-sv-feld]").forEach(c => { c.checked = st.felder.includes(c.dataset.svFeld); });
        const mu = box.querySelector("#sv-musik"); if (mu && st.musik) { mu.value = st.musik; musikListe(); }
        if (st.look) { w.look = st.look; box.querySelectorAll("[data-va-look]").forEach(b => b.classList.toggle("is-on", b.dataset.vaLook === w.look)); }
        if (st.foto_art) w.fotoArt = st.foto_art;
        if (st.kamera) { w.kamera = st.kamera; box.querySelectorAll("[data-va-kamera]").forEach(b => b.classList.toggle("is-on", b.dataset.vaKamera === w.kamera)); }
        if (st.kam_leb != null) { w.kamLeb = +st.kam_leb; const e = box.querySelector("#va-k-leb"); if (e) e.value = w.kamLeb; }
        if (st.halte_dauer) { w.halteDauer = st.halte_dauer; box.querySelectorAll("[data-va-h-dauer]").forEach(b => b.classList.toggle("is-on", b.dataset.vaHDauer === w.halteDauer)); }
        if (typeof st.halte_alle === "boolean") w.halteAlle = st.halte_alle;
        if (st.text_menge) { w.textMenge = st.text_menge; box.querySelectorAll("[data-va-t-menge]").forEach(b => b.classList.toggle("is-on", b.dataset.vaTMenge === w.textMenge)); }
        if (st.foto_menge != null) { w.fotoMenge = +st.foto_menge; const e = box.querySelector("#va-f-menge"); if (e) e.value = w.fotoMenge; }
      } finally { vlSetzt = false; }
      w.eigeneVorlage = id; w.angepasst = false;
      box.querySelectorAll("[data-sv-vorlage]").forEach(b => b.classList.remove("is-on"));
      eigeneZeichnen();
      try { applog("info", `[schnell] eigene Vorlage ${E.name}`); } catch (_) {}
      try { fotosInfo(); zutatenStand(); vlStand(); vorschau.stil(); } catch (_) {}
      if (ASS) vaLive();
    };
    const vlBehaelter = ["#sv-vorlagen", "#va-zweck"].map(q => box.querySelector(q)).filter(Boolean);
    vlBehaelter.forEach(el => el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-sv-eigen]"); if (!b) return;
      eigeneSetzen(b.dataset.svEigen);
      box.querySelectorAll("[data-va-zweck]").forEach(x => x.classList.remove("is-on"));
    }));
    vlBehaelter.forEach(el => el.addEventListener("contextmenu", async (e) => {
      const b = e.target.closest("[data-sv-eigen]"); if (!b) return;
      e.preventDefault();
      const E = eigene.find(x => x.id === b.dataset.svEigen); if (!E) return;
      const ja = await window.rzConfirm(T("va.v_loeschen_titel", "Vorlage löschen?"), T("va.v_loeschen_text", "„{n}“ wird aus den eigenen Vorlagen entfernt.", { n: E.name }), T("common.delete", "Löschen"), true);
      if (!ja) return;
      let r = null; try { r = await api().videostil_vorlage_loeschen(E.id); } catch (_) {}   // warte-ok: Einstellungen, sofort
      if (r && r.ok) { eigene = r.liste || []; if (w.eigeneVorlage === E.id) w.eigeneVorlage = null; eigeneZeichnen(); }
    }));
    box.querySelector("#va-vorlage-speichern")?.addEventListener("click", async () => {
      const ein = box.querySelector("#va-vorlage-name"), name = (ein && ein.value || "").trim();
      if (!name) { if (ein) ein.focus(); toast(T("va.v_name_fehlt", "Bitte einen Namen für die Vorlage eingeben."), "info", 3000); return; }
      let r = null; try { r = await api().videostil_vorlage_speichern(name, stilJetzt()); } catch (e) { r = { ok: false, error: String(e) }; }   // warte-ok: Einstellungen, sofort
      if (!r || !r.ok) { toast((r && r.error) || T("common.error", "Fehler"), "error", 4000); return; }
      eigene = r.liste || eigene; w.eigeneVorlage = r.vorlage && r.vorlage.id; eigeneZeichnen();
      toast(T("va.v_gespeichert", "Vorlage „{n}“ gemerkt — beim nächsten Video auf der ersten Seite wählbar.", { n: name }), "success", 4000);
    });
    eigeneZeichnen();
    box.querySelector("#sv-vorlagen")?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-sv-vorlage]"); if (b) { w.eigeneVorlage = null; vorlageSetzen(b.dataset.svVorlage); eigeneZeichnen(); }
    });
    const angepasst = () => { if (vlSetzt) return; w.angepasst = true; vlStand(); };
    box.querySelectorAll("#sv-stil, #sv-zahlen, #sv-profil, #sv-uebersicht, #sv-musik, #sv-fotoart, [data-sv-feld]")
      .forEach(e => e.addEventListener("change", angepasst));
    box.querySelector("#sv-fotoart")?.addEventListener("change", () => { w.fotoArt = fotoArtJetzt(); fotosInfo(); zutatenStand(); vorschau.inhalt(); });
    vlStand();

    let laeuft = false;
    let ausgang = null, kfBestaetigt = false, liveTimer = 0;   // 11.10.2026 — Stand vor dem Assistenten, Keyframe-Frage einmal
    let vaListe = [];   // 08.10.2026 — „Das hat der Assistent gemacht“
    const werteLesen = () => {
      w.stil = w.look ? lookStil(w.look) : vorlageStil(w.vorlage);   // 06.10.2026 — Kartenstil aus der Vorlage (Assistent: aus dem Look)
      w.titel = box.querySelector("#sv-titel").value.trim();
      w.unter = box.querySelector("#sv-unter").value.trim();
      w.zahlen = box.querySelector("#sv-zahlen").checked;
      w.profil = box.querySelector("#sv-profil").checked;
      w.highlights = box.querySelector("#sv-highlights").checked;
      w.tempoRegie = true;
      w.felder = [...box.querySelectorAll("[data-sv-feld]:checked")].map(x => x.dataset.svFeld);
      w.mehrOffen = false;
      for (const id of SCHALTER) { const e = box.querySelector("#" + id); if (e) stand[id] = !!e.checked; }
      w.fotosAn = an("sv-fotos-an"); w.clipsAn = an("sv-clips-an"); w.clipTon = an("sv-clipton");
      w.logbuch = an("sv-logbuch"); w.musikAn = an("sv-musik-an"); w.klick = an("sv-klick");
      w.musik = box.querySelector("#sv-musik")?.value || "builtin:unterwegs";
      w.uebersicht = an("sv-uebersicht"); w.schlussAn = an("sv-schluss-an"); w.gebaeude = an("sv-gebaeude");
      w.fotoArt = fotoArtJetzt();
      w.pip = w.fotoArt === "pip" ? ohneHaltJetzt().map(k => ({ path: k.f.path, von: k.von, bis: k.bis, ort: String(k.f.text || "").trim() || String(k.f.ort || "").split(",")[0].trim() })) : [];
      w.regieFotos = w.fotoArt === "sofortbild" ? ohneHaltJetzt().map(k => k.bei) : [];
      hoerenStopp();
      w.eigenS = laengeKlemmen(box.querySelector("#sv-eigen")?.value || w.eigenS);
      // „Wie im Animator" gilt nur für dieses Projekt — gemerkt wird die vorige Wahl
      return { format: w.format, laenge: w.laenge === "animator" ? ((LAENGEN[L.laenge] || L.laenge === "eigen") ? L.laenge : "normal") : w.laenge, eigen_s: w.eigenS, qualitaet: w.qualitaet, stil: w.stil, zahlen: w.zahlen, profil: w.profil, highlights: w.highlights, felder: w.felder,
               mehr_offen: w.mehrOffen, fotos_an: w.fotosAn, clips_an: w.clipsAn, clip_ton: w.clipTon, logbuch: w.logbuch,
               musik_an: w.musikAn, musik: w.musik, klick: w.klick, uebersicht: w.uebersicht, schluss_an: w.schlussAn, gebaeude: w.gebaeude,
               vorlage: w.vorlage, foto_art: w.fotoArt, sofort_groesse: w.sofortGroesse, foto_pause: w.fotoPause, angepasst: !!w.angepasst, tempo_regie: !!w.tempoRegie };
    };
    /** In das offene Projekt schreiben: ein ⌘Z-Schritt („Schnell-Video übernommen"), vorher ein Arbeitsstand.
     *  11.10.2026 — Video-Assistent: `modus = "live"` schreibt nach jeder Stufe OHNE ⌘Z-Schritt (das Fenster bleibt
     *  offen, der Animator zeigt es sofort); „Fertig" macht daraus EINEN Schritt vom Stand vor dem Assistenten. */
    const uebernehmen = async (modus) => {
      const live = ASS && modus === "live";
      if (ASS) try { kamOptSetzen(); w.kapitelTitel = kapitelTitel(); } catch (_) {}
      if (laeuft) {
        if (live) return;
        for (let i = 0; i < 100 && laeuft; i++) await new Promise(res => setTimeout(res, 100));   // laufendes Live-Schreiben abwarten
      }
      const letzte = werteLesen();
      const look = !!box.querySelector("#sv-look")?.checked;
      const voll = animatorPatch(w, v);
      // Reise: Übergänge kommen zur Dauer dazu → abziehen, damit die gewählte Gesamtlänge stimmt
      if (P.uebergangS > 0) voll.duration_s = Math.max(8, Math.round((voll.duration_s - P.uebergangS) * 100) / 100);
      // 07.10.2026 (Web-Fund F-1) — neue Länge → die gespeicherte Raffung des vorigen Schnell-Videos verwerfen; sonst
      // rechnete die Tempo-Kurve mit ihr weiter und schrieb die alte Dauer zurück ins Feld (12,8 statt 33 s)
      voll.tempo_rate = null; voll.tempo_basis = null;
      const patch = look ? nurAblauf(voll) : voll;
      if (!ASS) m.close();
      if (P.keyframes > 0 && !kfBestaetigt) {
        const ja = await window.rzConfirm(T("schnell.kf_frage_titel", "Keyframes ersetzen?"),
          T("schnell.kf_warnung", "Das Projekt hat schon {n} Keyframes — sie werden durch die Kamerafahrt ersetzt (⌘Z holt sie zurück).").replace("{n}", P.keyframes),
          T("schnell.kf_ersetzen", "Ersetzen"), true);
        if (!ja) {
          toast(T("schnell.nichts_geaendert", "Nichts geändert."), "info", 3000);
          if (ASS) vaAbbrechen();
          return;
        }
        kfBestaetigt = true;
      }
      laeuft = true;
      let r;
      const schilder = schilderJetzt();
      // 11.10.2026 — live (Assistent) OHNE rzWarten: dessen Eingabesperre schluckte Klicks auf „Weiter“, während im Hintergrund
      // geschrieben wurde; der Fensterkopf zeigt stattdessen „wird eingetragen …“
      const st_ = live && m.el ? m.el.querySelector(".va-f-status") : null;
      if (st_) st_.hidden = false;
      try { r = live ? await api().schnellvideo_uebernehmen(P.id, patch, null, schilder)   // warte-ok: Ladeanzeige im Kopf des Assistenten-Fensters
                     : await rzWarten("schnellvideo_uebernehmen", () => api().schnellvideo_uebernehmen(P.id, patch, ASS ? null : letzte, schilder)); }   // 08.10.2026 — der Assistent merkt sich nichts für das Schnell-Video (sonst startete das nächste Schnell-Video mit den Assistenten-Werten)
      catch (e) { r = { ok: false, error: String(e) }; }
      laeuft = false;
      if (st_) st_.hidden = true;
      if (!r || !r.ok) { toast((r && r.error) || T("common.error", "Fehler"), "error", 6000); return; }
      const nachher = (r.nachher || {}).animator || {}, vorher = (r.vorher || {}).animator || null;
      try { window.rzSetModuleSettingsLocal("animator", nachher); } catch (_) {}
      // Fotostopps sind Schilder (Projekt-Wurzel): im selben ⌘Z-Schritt (Undo-Stand mit __signs)
      if (Array.isArray((r.nachher || {}).signs)) { nachher.__signs = r.nachher.signs; if (vorher) vorher.__signs = (r.vorher || {}).signs || []; }
      if (ASS && !ausgang && vorher) ausgang = JSON.parse(JSON.stringify(vorher));
      const ctrl = window.__rzUndoControllers && window.__rzUndoControllers.animator;
      const label = ASS ? T("va.undo_label", "Video-Assistent") : T("schnell.undo_label", "Schnell-Video übernommen");
      if (live) { if (ctrl && typeof ctrl.anwenden === "function") ctrl.anwenden(nachher); }
      else if (ctrl && typeof ctrl.applyState === "function") ctrl.applyState(nachher, label, ASS ? (ausgang || vorher) : vorher);
      // Blickrichtung aus der geglätteten Spur — gehört zum selben ⌘Z-Schritt (kein eigener)
      await new Promise(res => setTimeout(res, live ? 600 : 1200));
      try { window.__rzUndoApplying = true; const n = window.__rzSchnellKamera ? window.__rzSchnellKamera() : 0; applog("info", `[schnell] ${live ? "live" : "übernommen"} in ${P.id} · Look ${look ? "behalten" : "neu"} · Blickrichtung ${n} Keyframes`); }
      catch (e) { try { applog("warn", "[schnell] Blickrichtung: " + e); } catch (_) {} }
      finally { setTimeout(() => { window.__rzUndoApplying = false; }, 0); }
      // Highlight-Schilder abgleichen — bis der Track mit den neuen Einstellungen steht (max. ~6 s)
      // (ohne Highlights einmal abgleichen: entfernt vorhandene automatische Highlight-Schilder)
      if (!patch.highlights_enabled) { try { if (window.__rzHlAbgleichen) window.__rzHlAbgleichen(); } catch (_) {} }
      else {
        for (let i = 0; i < (live ? 4 : 12); i++) {
          let n = 0;
          try { n = window.__rzHlAbgleichen ? window.__rzHlAbgleichen() : 0; } catch (_) {}
          if (n > 0) { applog("info", `[schnell] ${n} Highlight-Schilder`); break; }
          await new Promise(res => setTimeout(res, 500));
        }
      }
      if (live) return;
      if (ASS) { m.close(); vaBericht(vaListe); toast(T("va.uebernommen", "Der Assistent hat dein Projekt eingerichtet — alles ist bearbeitbar, ⌘Z nimmt es zurück."), "success", 6000); }
      else toast(T("schnell.uebernommen", "Schnell-Video übernommen — die Keyframes kannst du jetzt anpassen."), "success", 5000);
    };
    /** 11.10.2026 — Assistent abbrechen: den Stand von vorher zurückschreiben (ohne ⌘Z-Schritt) und das Fenster schließen. */
    const vaAbbrechen = async () => {
      clearTimeout(liveTimer);
      for (let i = 0; i < 100 && laeuft; i++) await new Promise(res => setTimeout(res, 100));
      const ctrl = window.__rzUndoControllers && window.__rzUndoControllers.animator;
      if (ausgang && ctrl && typeof ctrl.anwenden === "function") {
        ctrl.anwenden(JSON.parse(JSON.stringify(ausgang)));
        toast(T("va.abgebrochen", "Abgebrochen — dein Projekt steht wieder wie vorher."), "info", 4000);
        try { applog("info", "[assistent] abgebrochen · Stand vorher wiederhergestellt"); } catch (_) {}
      }
      ausgang = null;
      m.close();
    };
    /** Nach einer Antwort kurz warten, dann in den Animator schreiben (mehrere Klicks = ein Schreibvorgang). */
    const vaLive = () => {
      if (!ASS) return;
      clearTimeout(liveTimer);
      liveTimer = setTimeout(() => { uebernehmen("live").catch((e) => { try { applog("warn", "[assistent] live: " + e); } catch (_) {} }); }, 250);
    };
    // 11.10.2026 (Marc: „Wenn ich bei Schritt 7 auf verschiedene Karten klicke, sehe ich keine Änderungen direkt in der
    // Vorschau“ · „Punkt 8 auch … wenn ich was anklicke, muss ich das sofort sehen“) — nicht je Knopf nachrüsten, sondern
    // EIN Zuhörer: jede Änderung und jeder Klick in einer Stufe schreibt (entprellt) ins Projekt. Die Knopf-Handler laufen
    // vorher (Bubbling), `vaLive` liest danach den neuen Stand.
    if (ASS) {
      const inStufe = (el) => !!(el && el.closest("[data-va]") && !el.closest("#va-vorlage-name, #va-vorlage-speichern"));
      box.addEventListener("change", (e) => { if (inStufe(e.target)) vaLive(); });
      box.addEventListener("click", (e) => { const b = e.target.closest("button, label, [data-sv-foto], [data-va-look]"); if (b && inStufe(b)) vaLive(); });
    }
    const los = async (rendern) => {
      if (laeuft) return; laeuft = true;
      const letzte = werteLesen();
      // 05.10.2026 (Audit K-1) — aus dem Animator gestartet: Ausgangsprojekt merken, ein Abbruch führt dorthin zurück
      let herkunft = null;
      try { herkunft = ausAnimator && typeof getActiveProject === "function" ? (getActiveProject() || {}).id || null : null; } catch (_) {}
      const name = (v.name || "Tour") + " · " + T("schnell.titel_dialog", "Schnell-Video");
      // Beim Rendern sofort den eigenen Bildschirm zeigen — der Animator arbeitet unsichtbar dahinter.
      let B = null;
      if (rendern) { m.close(); B = buehne(v.name || ""); B.schritt(T("schnell.b.anlegen", "Projekt wird angelegt …")); B.fortschritt(0.01); }
      let r;
      try {
        const schilder = schilderJetzt();
        r = rendern ? await api().schnellvideo_anlegen(pfad, name, animatorPatch(w, v), letzte, schilder)   // warte-ok: eigener Bildschirm zeigt den Schritt
          : await rzWarten("schnellvideo_anlegen", () => api().schnellvideo_anlegen(pfad, name, animatorPatch(w, v), letzte, schilder));
      } catch (e) { r = { ok: false, error: String(e) }; }
      if (!r || !r.ok) {
        laeuft = false;
        if (B) { B.fehler((r && r.error) || T("common.error", "Fehler")); B.knopf("schliessen").onclick = () => B.zu(); }
        else toast((r && r.error) || T("common.error", "Fehler"), "error", 6000);
        return;
      }
      try { applog("info", `[schnell] Projekt ${r.project_id} · ${w.format} · ${w.laenge} · ${w.qualitaet} · ${w.stil} · rendern=${rendern}`); } catch (_) {}
      if (!B) m.close();
      // Öffnen über das Archiv — derselbe Weg wie beim Tour-Assistenten.
      window.__rzProjektOeffnenId = r.project_id;
      window.__rzStartProjekte = true;
      if (typeof switchMod === "function") switchMod("library");
      window.dispatchEvent(new CustomEvent("rz-projekt-oeffnen", { detail: { id: r.project_id, modul: "animator" } }));
      if (B) { B.schritt(T("schnell.b.karte", "Karte wird geladen …")); B.fortschritt(0.02); }
      const bereit = await warteAufAnimator(r.project_id, 90);
      if (!bereit) {
        if (B) { B.fehler(T("schnell.nicht_bereit", "Der Animator ist noch nicht bereit — starte das Video dort mit „Video rendern“.")); B.knopf("schliessen").onclick = () => B.zu(); }
        return;
      }
      await new Promise(res => setTimeout(res, 1500));   // Karte, Kacheln und Tempo-Verteilung kurz ankommen lassen
      if (B && window.__rzKartenBild) { try { B.startbild(await window.__rzKartenBild()); } catch (_) {} }
      // Verfolger-Blickrichtung aus der geglätteten Spur (auch für „Im Animator öffnen")
      try { const n = window.__rzSchnellKamera ? window.__rzSchnellKamera() : 0; applog("info", `[schnell] Blickrichtung: ${n} Keyframes`); } catch (e) { try { applog("warn", "[schnell] Blickrichtung: " + e); } catch (_) {} }
      if (!rendern) return;
      await new Promise(res => setTimeout(res, 800));   // gespeicherte Keyframes ankommen lassen
      const dateiName = (v.name || "Tour") + " – " + T("schnell.titel_dialog", "Schnell-Video");
      // 06.10.2026 (Marc: „immer den selben Export-Weg“) — Qualität, ★-Vorlage und Speicherort fragt
      // derselbe Export-Dialog wie im Animator; das Video entsteht direkt am gewählten Ort (keine Zwischendatei).
      const starten = (pfad) => {
        B.schritt(T("schnell.b.start", "Video wird gestartet …")); B.fortschritt(0.03);
        if (typeof window.__rzSchnellRender === "function") window.__rzSchnellRender({ ziel: pfad, name: dateiName, buehne: true, amZiel: true });
        buehneVerfolgen(B, dateiName, ausAnimator, herkunft, true);
      };
      if (!window.rzExportDialog) {   // Rückfall: wie früher in eine Zwischendatei
        let ziel;
        try { ziel = await api().schnellvideo_ziel(name); } catch (_) { ziel = null; }   // warte-ok: sofort
        if (!ziel || !ziel.ok) { B.fehler((ziel && ziel.error) || T("common.error", "Fehler")); B.knopf("schliessen").onclick = () => B.zu(); return; }
        if (typeof window.__rzSchnellRender === "function") window.__rzSchnellRender({ ziel: ziel.path, name: dateiName, buehne: true });
        buehneVerfolgen(B, dateiName, ausAnimator, herkunft, false);
        return;
      }
      B.schritt(T("schnell.b.export", "Qualität und Speicherort wählen …"));
      window.rzExportDialog.oeffnen({ stamm: v.name || "Tour", starten,
        // Abbrechen im Export-Dialog: das Projekt ist angelegt und steht im Animator — dort weitermachen
        abbrechen: () => { B.zu(); toast(T("schnell.im_animator_offen", "Das Schnell-Video-Projekt ist im Animator offen."), "info", 3500); } });
    };
    const svA = document.getElementById("sv-animator"); if (svA) svA.onclick = () => los(false);
    if (P) document.getElementById("sv-uebernehmen").onclick = () => uebernehmen("fertig");
    if (ASS) { document.getElementById("va-abbrechen").onclick = () => vaAbbrechen(); m.onX = () => vaAbbrechen(); }
    const svR = document.getElementById("sv-rendern"); if (svR) svR.onclick = () => los(true);

    // ── 08.10.2026 — Video-Assistent: Seite für Seite, jede überspringbar, am Ende ein ⌘Z-Schritt ──
    if (ASS) {
      // 11.10.2026 — „Die Geschichte“ direkt nach „Was für ein Video“, dann Fotos, dann der Look
      // 11.10.2026 — Reihenfolge: erst die Geschichte, dann Bild und Text, zum Schluss der Look
      const NAMEN = [null, T("va.n2", "Was für ein Video"), T("va.n_geschichte", "Die Geschichte"), T("va.n5", "Fotos"), T("va.n_halte", "Halte"),
                     T("va.n7", "Kamera"), T("va.n_texte", "Texte"), T("va.n3", "Karte"), T("va.n4", "Einblendungen"), T("va.n8", "Schluss & Musik"), T("va.n9", "Fertig")];
      const LETZTE = NAMEN.length - 1;
      let seite = 1;
      const zusammenfassung = () => {
        try { werteLesen(); } catch (_) {}
        const stopps = (() => { try { return stoppsJetzt().length; } catch (_) { return 0; } })();
        const ohneHalt = (() => { try { return fotoArtJetzt() !== "gross" ? ohneHaltJetzt().length : 0; } catch (_) { return 0; } })();
        const artText = { gross: T("va.fa_gross", "groß mit Halt"), sofortbild: T("va.fa_sofort", "als Sofortbild"), pip: T("va.fa_pip", "als Bild im Bild") }[(() => { try { return fotoArtJetzt(); } catch (_) { return "gross"; } })()] || "";
        const schilder = (() => { try { return schilderJetzt().length; } catch (_) { return stopps; } })();
        const einbl = [w.zahlen && T("va.e_zahlen", "Zahlen unterwegs"), w.profil && T("va.e_profil", "Höhenprofil"), w.highlights && T("va.e_highlights", "Highlights")].filter(Boolean);
        const mu = box.querySelector("#sv-musik"), muText = mu && mu.selectedOptions && mu.selectedOptions[0] ? mu.selectedOptions[0].textContent.trim() : "";
        const kam = { fahrt: T("einfach.k_fahrt", "Kamerafahrt"), folgen: T("einfach.k_folgen", "Folgen"), fest: T("einfach.k_fest", "Fest") }[w.kamera] || "";
        vaListe = [
          ["tag", T("va.l_titel", "Titel"), [w.titel, w.unter].filter(Boolean).join(" · ") || "—"],
          ["clapperboard", T("va.l_format", "Format und Länge"), `${w.format} · ${laengeS(w)} s`],
          ["map", T("va.l_karte", "Karte"), T("look." + w.look, w.look) + (w.gebaeude ? " · " + T("va.gebaeude_kurz", "3D-Häuser") : "")],
          ["chart-column", T("va.l_einbl", "Einblendungen"), einbl.join(", ") || T("va.keine", "keine")],
          ["camera", T("va.l_fotos", "Fotos"), w.fotosAn ? T("va.l_fotos_n2", "{n} Fotos {art}", { n: stopps + ohneHalt, art: artText }) : T("va.aus", "aus")],
          ["flag", T("va.l_schilder", "Schilder"), (schilder === 1 ? T("va.l_schilder_1", "1 Schild an der Strecke") : T("va.l_schilder_n", "{n} Schilder an der Strecke", { n: schilder })) + (an("sv-logbuch") ? " · " + T("va.l_logbuch", "mit Logbuch") : "")],
          ["pause", T("va.l_halte", "Halte"), !halteAn() ? T("va.l_halte_aus", "fährt durch") : T("va.l_halte_n", "an {n} Foto-Schildern · {d}", { n: stopps, d: T("va.h_" + (w.halteDauer || "normal"), w.halteDauer || "normal") })],
          ["video", T("va.l_kamera", "Kamera"), kam],
          ["music", T("va.l_musik", "Musik"), w.musikAn ? (muText || "✓") : T("va.aus", "aus")],
          ["milestone", T("va.l_schluss", "Schlusskarte"), w.schlussAn ? (w.felder.length + " " + T("va.l_werte", "Werte")) : T("va.aus", "aus")],
        ];
        const ul = box.querySelector("#va-liste");
        if (ul) ul.innerHTML = vaListe.map(([ic, k, v2]) => `<li><span class="va-ic">${vaIc(ic)}</span><b>${esc(k)}</b><span>${esc(v2)}</span></li>`).join("");
      };
      const zeigen = () => {
        box.querySelectorAll("[data-va]").forEach(e => e.classList.toggle("va-weg", +e.dataset.va !== seite));
        const k = box.querySelector("#va-kopf");
        if (k) k.innerHTML = `<div class="va-schritt">${esc(T("va.schritt", "Schritt {n} von {m}", { n: seite, m: LETZTE }))} · <b>${esc(NAMEN[seite])}</b></div>
          <div class="va-punkte">${NAMEN.slice(1).map((n, i) => `<button type="button" class="va-punkt${i + 1 === seite ? " is-on" : ""}${i + 1 < seite ? " ist-fertig" : ""}" data-va-geh="${i + 1}" title="${esc(n)}"></button>`).join("")}</div>`;
        k && k.querySelectorAll("[data-va-geh]").forEach(b => { b.onclick = () => { seite = +b.dataset.vaGeh; zeigen(); }; });
        const z = document.getElementById("va-zurueck"), wt = document.getElementById("va-weiter"), sk = document.getElementById("va-skip"), ue = document.getElementById("sv-uebernehmen");
        if (z) z.disabled = seite <= 1;
        if (wt) wt.hidden = seite >= LETZTE;
        if (sk) sk.hidden = seite >= LETZTE;
        if (ue) ue.hidden = false;   // 11.10.2026 — „Fertig“ auf jeder Stufe
        if (seite === LETZTE) zusammenfassung();
        if (seite === 3) try { fotosZeigen(); } catch (_) {}
        if (seite === 4) vaHalte();
        if (seite === 5) vaKamera();
        if (seite === 6) vaTexte();
        if (seite === 2) vaGeschichte();
        if (seite > 1) vaLive();
        vaLeuchten(seite);
        try { applog("info", `[assistent] Seite ${seite} · ${NAMEN[seite]}`); } catch (_) {}
      };
      document.getElementById("va-zurueck").onclick = () => { if (seite > 1) { seite--; zeigen(); } };
      document.getElementById("va-weiter").onclick = () => { if (seite < LETZTE) { seite++; zeigen(); } };
      document.getElementById("va-skip").onclick = () => { if (seite < LETZTE) { seite++; zeigen(); } };   // Vorschlag lassen, wie er ist
      box.querySelector("#va-zweck")?.addEventListener("click", (e) => {
        const b = e.target.closest("[data-va-zweck]"); if (!b) return;
        const Z = { erinnerung: ["tagebuch", "16:9", "lang"], social: ["puls", "9:16", "kurz"], landschaft: ["weite", "16:9", "normal"] }[b.dataset.vaZweck];
        if (!Z) return;
        w.eigeneVorlage = null;
        vorlageSetzen(Z[0]);
        try { eigeneZeichnen(); } catch (e) { if (window.rzSwallow) rzSwallow(e, "assistent:eigene_vorlagen"); }
        for (const [g, wert] of [["format", Z[1]], ["laenge", Z[2]]]) box.querySelector(`[data-sv-gruppe="${g}"] [data-sv-wert="${wert}"]`)?.click();
        box.querySelectorAll("[data-va-zweck]").forEach(x => x.classList.toggle("is-on", x === b));
        try { applog("info", `[assistent] Zweck ${b.dataset.vaZweck}`); } catch (_) {}
      });
      box.querySelector("#va-f-menge")?.addEventListener("change", (e) => { w.fotoMenge = +e.target.value; fotosZeigen(); vaLive(); });
      box.querySelector("#va-looks")?.addEventListener("click", (e) => {
        const b = e.target.closest("[data-va-look]"); if (!b) return;
        w.look = b.dataset.vaLook;
        box.querySelectorAll("[data-va-look]").forEach(x => x.classList.toggle("is-on", x === b));
        vorschau.stil();
      });
      box.querySelector("#va-kamera")?.addEventListener("click", (e) => {
        const b = e.target.closest("[data-va-kamera]"); if (!b) return;
        w.kamera = b.dataset.vaKamera;
        box.querySelectorAll("[data-va-kamera]").forEach(x => x.classList.toggle("is-on", x === b));
        vaKamera(); vaLive();
      });
      zeigen();
      window.__rzVaSeite = (n) => { seite = n; zeigen(); };   // Prüfstand
    }
  }

  /** Fortschritt des Renders im eigenen Bildschirm zeigen (derselbe Status wie im Animator). */
  function buehneVerfolgen(B, dateiName, ausAnimator, herkunft, amZiel) {
    // 06.10.2026 (F-14 Q6) — über den Export-Dialog liegt das Video schon am gewählten Ort: „Im Finder zeigen“ statt „Speichern …“
    if (amZiel) { const k = B.knopf("speichern"); if (k) k.textContent = "📂 " + T("schnell.im_finder", "Im Finder zeigen"); }
    let aktuell = null, begonnen = false, zu = false;
    // „Schließen": aus dem Archiv gestartet → zurück ins Archiv; aus dem Animator → dort bleiben
    const zurueck = () => { zu = true; B.zu(); if (!ausAnimator && typeof switchMod === "function") switchMod("library"); };
    // 01.10.2026 (Marc: „vom Abbruch aus ist er im Archiv gelandet, was ja schon falsch war … dann war der
    // Animator ausgegraut") — nach dem Abbruch im Animator bleiben (das Projekt ist dort offen) und die
    // Render-Sperre selbst lösen; der Animator kann es nicht, wenn er inzwischen nicht mehr offen ist.
    // 05.10.2026 (Audit K-1, Marc: „nach dem Abbruch stand ich im Schnell-Video-Projekt und dachte, mein Projekt
    // sei kaputt") — war der Aufruf aus einem anderen Projekt, wird das wieder geöffnet; das Schnell-Video bleibt im Archiv.
    const abgebrochen = () => {
      zu = true; B.zu(); try { if (typeof setRenderingState === "function") setRenderingState(false); } catch (_) {}
      const jetzt = (typeof getActiveProject === "function" && getActiveProject()) || {};
      if (ausAnimator && herkunft && jetzt.id !== herkunft) {
        try { applog("info", `[schnell] Abbruch → zurück ins Projekt ${herkunft}`); } catch (_) {}
        window.__rzProjektOeffnenId = herkunft;
        if (typeof switchMod === "function") switchMod("library");
        window.dispatchEvent(new CustomEvent("rz-projekt-oeffnen", { detail: { id: herkunft, modul: "animator" } }));
      }
    };
    B.knopf("abbrechen").onclick = async () => {
      B.knopf("abbrechen").disabled = true; B.schritt(T("animator.cancel.requesting", "Wird abgebrochen …"));
      try { await api().animator_cancel(); } catch (_) {}   // warte-ok: setzt nur das Flag
    };
    B.knopf("schliessen").onclick = zurueck;
    B.knopf("animator").onclick = () => { zu = true; B.zu(); };   // der Animator steht schon dahinter
    B.knopf("speichern").onclick = async () => {
      if (amZiel) { try { await api().reveal_in_finder(aktuell); } catch (_) {} return; }   // warte-ok: öffnet nur den Finder
      const ziel = await api().pick_save_path(dateiName + ".mp4", "", ["MP4 (*.mp4)"]);   // warte-ok: Systemdialog
      if (!ziel) return;
      const r = await rzWarten("datei_speichern_unter", () => api().datei_speichern_unter(aktuell, ziel));
      if (r && r.ok) { aktuell = r.path; toast(T("schnell.gespeichert", "Gespeichert: {file}").replace("{file}", String(r.path).split(/[\\/]/).pop()), "success", 5000); }
      else toast((r && r.error) || T("common.error", "Fehler"), "error", 6000);
    };
    B.knopf("teilen").onclick = async () => {
      const r = await api().datei_teilen(aktuell);   // warte-ok: öffnet nur das System-Menü
      if (!r || !r.ok) toast((r && r.error) || T("common.error", "Fehler"), "error", 6000);
    };
    let letztesBild = "";
    const t0 = Date.now();
    const runde = async () => {
      if (zu) return;
      let s = null;
      try { s = await api().animator_status(); } catch (_) {}   // warte-ok: Statusabfrage
      if (s) {
        if (s.running) begonnen = true;
        if (!begonnen) {   // Stand eines früheren Renders — unserer läuft noch nicht
          if (Date.now() - t0 > 20000) { B.fehler(T("schnell.b.fehler", "Das Video konnte nicht erstellt werden. Details stehen im Fehlerfenster.")); return; }
          setTimeout(runde, 500); return;
        }
        if (s.status) B.schritt(s.status);
        B.fortschritt(Math.max(0.03, s.progress || 0));
        if (s.preview_b64 && s.preview_b64 !== letztesBild) { letztesBild = s.preview_b64; B.livebild(s.preview_b64); }
        if (s.cancelled) { abgebrochen(); toast(T("animator.cancel.toast", "Render abgebrochen"), "info", 4000); return; }
        if (s.error) { B.fehler(T("schnell.b.fehler", "Das Video konnte nicht erstellt werden. Details stehen im Fehlerfenster.")); return; }
        if (!s.running && (s.progress || 0) >= 1 && s.output) {
          aktuell = s.output;
          B.schritt(T("schnell.b.fertig", "✓ Dein Video ist fertig")); B.fortschritt(1);
          let url = null;
          try { const m = await api().serve_media(s.output); if (m && m.ok && m.url) url = m.url; } catch (_) {}   // warte-ok: sofort
          B.fertig(url || encodeURI("file://" + (/^[A-Za-z]:/.test(s.output) ? "/" : "") + String(s.output).replace(/\\/g, "/")));   // Audit D-9: file:///C:/…
          return;
        }
      }
      setTimeout(runde, 500);
    };
    setTimeout(runde, 300);
  }

  window.rzSchnellVideo = rzSchnellVideo;
  window.__rzSchnellKamerafahrt = kamerafahrt;   // Prüfstand
  window.__rzSchnellPatch = animatorPatch;       // Prüfstand
  window.__rzSchnellAblauf = nurAblauf;          // Prüfstand
  window.__rzSchnellFotostopps = fotostoppSchilder;   // Prüfstand
  window.__rzSchnellStopps = stoppsWaehlen;            // Prüfstand (02.10.2026: Fotos + Clips teilen sich die Zeit)
  window.__rzSchnellLogbuch = logbuchAnwenden;         // Prüfstand
  window.__rzSchnellVorlagen = { VORLAGEN, einblendungen, fotosOhneHalt, sofortbildSchild, vorlageStil, tempoRegie, gipfelShot };   // Prüfstand (05.10.2026)
})();
