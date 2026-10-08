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
  const T = (k, f) => (typeof t === "function" ? t(k, f) : f);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

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
      return new Date(v.start_epoch * 1000).toLocaleDateString(lang, { day: "numeric", month: "long", year: "numeric" });
    } catch (_) { return ""; }
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
  function kamerafahrt(bbox, animS, regie) {
    const anker = (s) => s < INTRO_S ? -(INTRO_S - s) / animS
      : (s <= INTRO_S + animS ? (s - INTRO_S) / animS : 1 + (s - INTRO_S - animS) / animS);
    const mitte = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
    // 30.09.2026 (Marc, Vergleich mit Komoot: „die Kamera fliegt tiefer, mehr über den Track") — eine halbe Stufe
    // näher und 45° statt 55°: steiler von oben, kaum Horizont. Getestet: +1 Stufe war im steilen Gelände zu nah.
    const zNah = Math.max(1.5, Math.min(5, Math.log2(Math.max(0.5, diagonaleKm(bbox)) / 2) + 0.5));
    const NEIGUNG = 45;
    const punkte = [
      { s: 0, c: mitte, z: -0.15, p: 25, b: 0, e: "linear" },                       // Überblick
      { s: 1.2, c: mitte, z: -0.15, p: 25, b: 0, e: "linear" },                     // … kurz stehen
      { a: 0, c: null, z: zNah, p: NEIGUNG, b: 0, e: "ease_in_out" },                    // hinein zum Start (Richtung: __rzSchnellKamera)
      { a: 1, c: null, z: zNah, p: NEIGUNG, b: 0, e: "linear" },                         // Ziel
      // 05.10.2026 (Auto-Regie §8.4 „Gipfel-Shot") — am höchsten Punkt kurz aufziehen und zum Horizont neigen:
      // Panorama statt Draufsicht, dann zurück in die Verfolgung (die Tempo-Regie verweilt dort)
      ...gipfelShot(regie, zNah, NEIGUNG, animS),
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
    if (w.titel || w.unter) {
      const ti = C.neu("titel", T);
      ti.zeilen = [];
      if (w.titel) ti.zeilen.push(C.zeile("text", { text: w.titel }));
      if (w.unter) ti.zeilen.push(C.zeile("text", { text: w.unter, gr: w.titel ? 0.45 : 1 }));
      if (!w.titel) ti.schriftgroesse = 3.6;
      ti.zeilenabstand = 0.15;
      ti.zeit = { von: { art: "video_start", wert: 0 }, bis: { art: "video_start", wert: INTRO_S } };
      liste.push(C.normalisieren(ti));
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
    const look = (VORLAGEN[w.vorlage] || VORLAGEN.weite).look;
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
      timeline_events: kamerafahrt(v.bbox, animS, w.tempoRegie ? v.regie : null),
      camera_follow_track: true,
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
  function stoppsWaehlen(fotos, clips, animS, mitTon) {
    const budget = Math.max(0, animS * 0.5);
    const kand = [].concat(
      (fotos || []).map(f => ({ art: "foto", f, kosten: STOPP_KOSTEN, wert: +f.wert || 0, bei: +f.bei })),
      (clips || []).map(c => ({ art: "clip", f: c, kosten: Math.min(CLIP_S, Math.max(0.5, +c.dauer || CLIP_S)), wert: (+c.wert || 0) + 1, bei: +c.bei })));
    kand.sort((a, b) => b.wert - a.wert || a.bei - b.bei);
    let summe = 0;
    const wahl = [];
    for (const k of kand) {
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
  function fotosOhneHalt(fotos, animS, belegt) {
    const max = Math.max(0, Math.floor(animS / 4));
    const kand = (fotos || []).map(f => ({ f, bei: +f.bei, wert: +f.wert || 0 })).filter(k => isFinite(k.bei))
      .sort((a, b) => b.wert - a.wert || a.bei - b.bei);
    const wahl = [], besetzt = (belegt || []).slice();
    for (const k of kand) {
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
  function logbuchAnwenden(stopps, eintraege, belegt) {
    const benutzt = new Set();
    for (const s of stopps) {
      const i = (eintraege || []).findIndex((x, j) => !benutzt.has(j) && s.__bei >= x.von - 0.01 && s.__bei <= x.bis + 0.01);
      if (i >= 0 && !s.__eigenText) { const x = eintraege[i]; s.text = ((LB_SYMBOL[x.icon] || "") + " " + x.text).trim(); benutzt.add(i); }
    }
    return (eintraege || []).filter((x, j) => !benutzt.has(j) && (x.art === "notiz" || +x.dauer_s >= 600)
                                             && !stopps.some(s => Math.abs(s.__bei - x.bei) < 0.05) && isFinite(+x.lat)
                                             // 05.10.2026 (Teide-Demo: „Pause · 17 min" über „Teide 3715 m") — nicht auf Höhepunkte
                                             && !(belegt || []).some(b => Math.abs(b - x.bei) < 0.05))
      .sort((a, b) => (b.art === "notiz") - (a.art === "notiz") || b.dauer_s - a.dauer_s).slice(0, 3)
      .map(x => ({ text: x.text, lat: x.lat, lon: x.lon, anchorMode: "track", style: "pille", icon: x.icon,
                   color: { pause: "#e0a96d", uebernachtung: "#8fa8ff", notiz: "#f2d36b" }[x.icon] || "#e0a96d", size: 36,
                   before: 1.6, after: 2.2, entry: "both", entry_s: 0.35, exit: "fade", exit_s: 0.35, zoomScale: false, visible: true }));
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
    const lookVon = () => { const L = window.rzLooks && window.rzLooks.LOOKS[(VORLAGEN[w.vorlage] || VORLAGEN.weite).look]; return L || null; };
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
      const key = vorlageStil(w.vorlage), look = vorlageKartenlook(w.vorlage);
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

  async function rzSchnellVideo(pfad, opts) {
    if (!pfad) return;
    const P = (opts && opts.projekt && opts.projekt.id) ? opts.projekt : null;
    const ausAnimator = !!opts;   // aus dem Animator aufgerufen (das Archiv übergibt keine opts)
    const animS = (opts && +opts.animatorS > 0) ? Math.round(+opts.animatorS * 10) / 10 : 0;   // Länge im Animator (Intro + Animation + Halten)
    let v;
    try { v = await rzWarten("schnellvideo_vorschlag", () => api().schnellvideo_vorschlag(pfad)); }
    catch (e) { v = { ok: false, error: String(e) }; }
    if (!v || !v.ok) { toast((v && v.error) || T("common.error", "Fehler"), "error", 6000); return; }
    const L = v.letzte || {};
    const w = {
      format: FORMATE[L.format] ? L.format : "9:16",
      laenge: LAENGEN[L.laenge] ? L.laenge : "normal",   // 06.10.2026 (F-14) — nur noch Kurz/Normal/Lang
      eigenS: laengeKlemmen(L.eigen_s || 30), animatorS: animS,
      qualitaet: L.qualitaet === "4k" ? "4k" : "1080",
      stil: L.stil || (typeof mapDefaultStyle === "function" ? mapDefaultStyle() : "free_satellite"),
      zahlen: !!L.zahlen, profil: !!L.profil,
      highlights: L.highlights !== false,   // 30.09.2026 — Standard an
      felder: Array.isArray(L.felder) ? L.felder.filter(f => SCHLUSS_FELDER.includes(f)) : SCHLUSS_STANDARD.slice(),
      titel: v.name || "", unter: [datumText(v), v.ort].filter(Boolean).join(" · "),
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
      tempoRegie: true,   // 06.10.2026 (F-14) — immer an, kein Haken mehr
    };
    if (!VORLAGEN[L.vorlage]) {
      // Erster Aufruf mit Vorlagen: Weite vorbelegen (Q5) — eigene Musikdatei und Felder bleiben
      const V = VORLAGEN.weite;
      w.stil = vorlageStil("weite"); w.zahlen = V.zahlen; w.profil = V.profil; w.uebersicht = V.uebersicht;
      if (!L.musik || String(L.musik).startsWith("builtin:")) w.musik = V.musik;
    }
    if (!w.fotoArt) w.fotoArt = VORLAGEN[w.vorlage].fotoArt;
    // 07.10.2026 (Web-Fund F-5) — offizielle Parameter beim Aufruf (Web, Skripte): Fotoart, Größe des Sofortbilds,
    // Fotopause ohne Heranfahren. Der Dialog bleibt schlank (F-14: die Fotoart kommt sonst aus der Vorlage).
    if (opts && FOTO_ARTEN.includes(opts.fotoArt)) w.fotoArt = opts.fotoArt;
    if (opts && opts.sofortGroesse != null) w.sofortGroesse = sofortGroesse(opts.sofortGroesse);
    if (opts && (opts.fotoPause === "stehen" || opts.fotoPause === "heran")) w.fotoPause = opts.fotoPause;
    const feldLabel = (f) => T("animator.statsfield." + f, f);
    const m = openModal({
      title: "🎬 " + T("schnell.titel_dialog", "Schnell-Video"),
      body: `<div class="sv-dialog">
        <p class="muted" style="margin:0 0 10px">${esc(T("schnell.intro", "Ein fertiges Video deiner Tour: Überblick, Flug entlang der Strecke, Schlussblick mit deinen Zahlen."))}</p>
        <!-- 06.10.2026 (Marc: „das Schnell-Video braucht eine Vorschau, dass man weiß, was man da einstellt: komplette Karte
             mit komplettem Track; wenn Fotos da sind, eins offen, die anderen zu; gleiches gilt für POIs") -->
        <div class="sv-vorschau" id="sv-vorschau"><div class="sv-vk" id="sv-vk"><div class="sv-vk-karte" id="sv-vk-karte"></div><div class="sv-vk-titel" id="sv-vk-titel"></div><div class="sv-vk-zahlen" id="sv-vk-zahlen" hidden></div><div class="sv-vk-profil" id="sv-vk-profil" hidden></div></div></div>
        <div class="sv-vorlagen" id="sv-vorlagen">${VORLAGE_NAMEN.map(n => `<button type="button" class="sv-vorlage${n === w.vorlage ? " is-on" : ""}" data-sv-vorlage="${n}">
          <span class="rz-look-bild rz-look-${VORLAGEN[n].look}"></span><span class="sv-vl-name">${esc(T("schnell.vl." + n, { weite: "Weite", tagebuch: "Tagebuch", puls: "Puls" }[n]))}</span>
          <span class="sv-vl-text">${esc(T("schnell.vl." + n + "_text", { weite: "Landschaft, Fotos groß, Zahlen am Schluss", tagebuch: "Orte und Erinnerungen, Fotos als Sofortbild", puls: "Strecke und Leistung, Datenleiste mit Profil" }[n]))}</span></button>`).join("")}</div>
        <div class="muted sv-vl-stand" id="sv-vl-stand"></div>
        <label class="field-label">${esc(T("schnell.format", "Format"))}</label>
        ${knopfReihe("format", [["9:16", "9:16 " + T("schnell.format_hoch", "hochkant")], ["16:9", "16:9"], ["1:1", "1:1"]], w.format)}
        <label class="field-label">${esc(T("schnell.laenge", "Länge"))}</label>
        ${knopfReihe("laenge", [["kurz", T("schnell.kurz", "Kurz") + " · 20 s"], ["normal", T("schnell.normal", "Normal") + " · 40 s"], ["lang", T("schnell.lang", "Lang") + " · 60 s"]], w.laenge)}
        <label class="field-label" for="sv-titel">${esc(T("schnell.titel", "Titel"))}</label>
        <input type="text" id="sv-titel" class="lib-input" value="${esc(w.titel)}">
        <div class="sv-titel-vorschlaege" id="sv-titel-vorschl"></div>
        <label class="field-label" for="sv-unter">${esc(T("schnell.unterzeile", "Unterzeile"))}</label>
        <input type="text" id="sv-unter" class="lib-input" value="${esc(w.unter)}">
        <!-- 06.10.2026 (Marc: „Schnelle Videos müssen schon deutlich eingedampft werden … alles andere
             muss in den Assistenten“) — ein Bildschirm, kein „Mehr“: Fotos (+ eigene), Musik, Einblendungen, Schlusskarte.
             Kartenstil, Fotoart, Übersichtskarte und 3D-Häuser bringt die Vorlage mit; Qualität und Speicherort fragt
             der Export-Dialog (derselbe Weg wie im Animator). Clips, Logbuch, eigene Länge → Animator/Assistent. -->
        <div class="sv-zutat" data-sv-zutat="fotos">
          <label class="chk sv-zutat-kopf"><input type="checkbox" id="sv-fotos-an"${w.fotosAn ? " checked" : ""}><span>📸 ${esc(T("schnell.z.fotos", "Fotostopps"))}</span><span class="sv-zutat-stand muted" id="sv-fotos-an-stand"></span></label>
          <div class="sv-zutat-teil">
            <div class="sv-fotos" id="sv-fotos"><span class="muted">${esc(T("schnell.fotos_suchen", "Fotos dieser Tour werden gesucht …"))}</span></div>
          </div>
          <!-- außerhalb des Klappteils: eigene Fotos auch dann, wenn das Archiv keine hat (Schalter dann aus) -->
          <div class="sv-fotos-fuss"><span class="muted sv-fotos-info" id="sv-fotos-info"></span>
              <button type="button" class="btn btn-small" data-sv-plus="dateien" title="${esc(T("schnell.fotos_plus_tip", "Eigene Fotos dazunehmen — sie werden der Strecke zugeordnet (GPS, sonst Aufnahmezeit)"))}">+ ${esc(T("schnell.fotos_plus", "Fotos …"))}</button>
              <button type="button" class="btn btn-small" data-sv-plus="ordner" title="${esc(T("schnell.fotos_plus_tip", "Eigene Fotos dazunehmen — sie werden der Strecke zugeordnet (GPS, sonst Aufnahmezeit)"))}">+ ${esc(T("schnell.fotos_plus_ordner", "Ordner …"))}</button></div>
        </div>
        <div class="sv-zutat" data-sv-zutat="musik">
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
              <button type="button" class="btn btn-small" id="sv-musik-datei" title="${esc(T("animator.ton.datei_tip", "Eigene Musik wählen (MP3, M4A, WAV, FLAC …)"))}">…</button>
            </div>
          </div>
        </div>
        <div class="sv-zutat" data-sv-zutat="einblendungen">
          <label class="chk"><input type="checkbox" id="sv-zahlen"${w.zahlen ? " checked" : ""}><span>📊 ${esc(T("schnell.zahlen", "Zahlen unterwegs (Strecke und Höhe)"))}</span></label>
          <label class="chk"><input type="checkbox" id="sv-profil"${w.profil ? " checked" : ""}><span>⛰ ${esc(T("schnell.profil", "Höhenprofil"))}</span></label>
          <label class="chk"><input type="checkbox" id="sv-highlights"${w.highlights ? " checked" : ""}><span>⭐ ${esc(T("schnell.highlights", "Highlights (höchster Punkt, steilste Stelle, halbe Strecke …)"))}</span></label>
        </div>
        <div class="sv-zutat" data-sv-zutat="schluss">
          <label class="chk sv-zutat-kopf"><input type="checkbox" id="sv-schluss-an"${w.schlussAn ? " checked" : ""}><span>🏁 ${esc(T("schnell.z.schluss", "Schlusskarte"))}</span><span class="sv-zutat-stand muted" id="sv-schluss-an-stand"></span></label>
          <div class="sv-zutat-teil sv-felder">${SCHLUSS_FELDER.map(f => `<label class="chk"><input type="checkbox" data-sv-feld="${f}"${w.felder.includes(f) ? " checked" : ""}><span>${esc(feldLabel(f))}</span></label>`).join("")}</div>
        </div>
        ${P ? `<div class="sv-projekt">
          <label class="field-label">${esc(T("schnell.in_projekt_titel", "In dieses Projekt übernehmen"))}</label>
          <label class="chk"><input type="checkbox" id="sv-look"${P.hatLook ? " checked" : ""}><span>${esc(T("schnell.look_behalten", "Meinen Look behalten — nur Kamerafahrt und Ablauf übernehmen"))}</span></label>
          <p class="muted" style="margin:2px 0 0;font-size:11.5px">${esc(T("schnell.look_hinweis", "Ohne Haken kommen auch Format, Kartenstil, Einblendungen, Titel und Schlusskarte des Schnell-Videos ins Projekt."))}</p>
          ${P.keyframes > 0 ? `<p class="sv-hinweis" style="margin-top:6px">⚠️ ${esc(T("schnell.kf_warnung", "Das Projekt hat schon {n} Keyframes — sie werden durch die Kamerafahrt ersetzt (⌘Z holt sie zurück).").replace("{n}", P.keyframes))}</p>` : ""}
        </div>` : ""}
      </div>`,
      footer: (P ? `<button type="button" class="btn btn-primary" id="sv-uebernehmen">${esc(T("schnell.in_projekt", "In dieses Projekt übernehmen"))}</button>` : "")
        + `<button type="button" class="btn" id="sv-animator">${esc(P ? T("schnell.neues_projekt", "Neues Projekt") : T("schnell.im_animator", "Im Animator öffnen"))}</button>
               <button type="button" class="btn${P ? "" : " btn-primary"}" id="sv-rendern">🎬 ${esc(T("schnell.erstellen", "Video erstellen …"))}</button>`,
    });
    const box = document.getElementById("modal-body");
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
    const rechte = () => {};   // 06.10.2026 (F-14) — Kartenstil kommt aus der Vorlage, keine eigene Auswahl mehr

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
      l.innerHTML = w.fotos.map((f, i) => `<button type="button" class="sv-foto${w.fotosAus.has(i) ? "" : " is-on"}${f.eigen ? " ist-eigen" : ""}" data-sv-foto="${i}" title="${esc([String(f.path).split(/[\\/]/).pop()].concat(f.eigen ? [T("schnell.foto_eigen", "eigenes Foto")] : grundText(f.grund)).join(" · "))}">`
        + (f.thumb ? `<img src="${f.thumb}" alt="">` : `<span class="sv-foto-leer">📷</span>`) + `<span class="sv-foto-zeit">${esc(f.zeit || "")}</span></button>`).join("");
      fotosInfo();
      try { zutatenStand(); } catch (_) {}
      vorschau.inhalt();
    };
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
    box.querySelector("#sv-fotos")?.addEventListener("click", (e) => {
      const q = e.target.closest("[data-sv-fotoquelle]"); if (q) { fotosAusQuelle(q.dataset.svFotoquelle); return; }
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
      // 06.10.2026 (F-14) — Clips gehören nicht mehr ins Schnell-Video (Animator → Ton & Clips)
      w.clips = [];
      w.clipsGeladen = true;
      // Q1-Prinzip: was gefunden wird, ist vorgewählt — nichts gefunden → Schalter aus (Wahl bleibt änderbar)
      if (!w.clips.length && L.clips_an == null) { const c = box.querySelector("#sv-clips-an"); if (c) c.checked = false; }
      clipsZeigen(); fotosInfo();
    })();
    // ── 05.10.2026 — Titel-Vorschläge (Video-Assistent): Gipfel, Start → Ziel, „Rund um …" — ein Klick übernimmt ──
    (async () => {
      let r = null;
      try { r = await api().schnellvideo_titel_vorschlaege(pfad); } catch (_) {}   // warte-ok: Hintergrund, das Feld ist schon bedienbar
      const box_ = box.querySelector("#sv-titel-vorschl"); const ein = box.querySelector("#sv-titel");
      const liste = ((r && r.titel) || []).filter(x => x && x !== (ein && ein.value));
      if (!box_ || !liste.length) return;
      box_.innerHTML = `<span class="muted">${esc(T("schnell.titel_vorschlag", "Vorschläge:"))}</span>` + liste.map(x => `<button type="button" class="sv-titel-chip" data-sv-titel="${esc(x)}">${esc(x)}</button>`).join("");
      box_.addEventListener("click", (e) => { const c = e.target.closest("[data-sv-titel]"); if (c && ein) { ein.value = c.dataset.svTitel; ein.dispatchEvent(new Event("input")); } });
    })();
    // ── Logbuch ──
    w.lb = []; w.lbGeladen = false;
    (async () => {
      let r = null;
      try { r = await api().schnellvideo_logbuch(pfad); } catch (_) {}   // warte-ok: Hintergrund
      w.lb = (r && r.ok && Array.isArray(r.eintraege)) ? r.eintraege : [];
      w.lbHinweis = (r && r.hinweis) || "";
      w.lbGeladen = true;
      zutatenStand();
    })();
    // ── Musik: eigene Datei, Probehören ──
    let hoeren = null;
    const hoerenStopp = () => { try { if (hoeren) hoeren.pause(); } catch (_) {} hoeren = null; const b = box.querySelector("#sv-musik-hoeren"); if (b) b.textContent = "▶"; };
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
    box.querySelector("#sv-musik-hoeren")?.addEventListener("click", async () => {
      if (hoeren) { hoerenStopp(); return; }
      const d = box.querySelector("#sv-musik").value;
      let url = "";
      try { const r = await api().ton_url(d); url = (r && r.ok && r.url) || ""; } catch (_) {}   // warte-ok: sofort
      if (!url) return;
      hoeren = new Audio(url); hoeren.volume = 0.7;
      const p = hoeren.play(); if (p && p.catch) p.catch(() => {});
      box.querySelector("#sv-musik-hoeren").textContent = "⏸";
    });
    const wache = setInterval(() => { if (!box.isConnected || !document.getElementById("sv-musik")) { hoerenStopp(); vorschau.weg(); clearInterval(wache); } }, 500);   // Dialog zu → Probehören aus
    // ── Stand je Zutat + Kurzfassung an „Mehr" ──
    // Schalter-Stand: aus dem Dialog, nach dem Schließen aus dem zuletzt gelesenen Stand (werteLesen) —
    // „Übernehmen" und „Rendern" schließen den Dialog, bevor die Schilder gebaut werden.
    const SCHALTER = ["sv-fotos-an", "sv-clips-an", "sv-clipton", "sv-logbuch", "sv-musik-an", "sv-klick", "sv-uebersicht", "sv-schluss-an", "sv-gebaeude"];
    // 06.10.2026 (F-14) — Schalter, die nicht mehr im Dialog stehen: Übersichtskarte aus der Vorlage, 3D-Häuser automatisch
    // (Tour führt durch einen Ort), Klick wie zuletzt; Clips und Logbuch aus (→ Animator/Assistent).
    const stand = { "sv-uebersicht": !!VORLAGEN[w.vorlage].uebersicht, "sv-gebaeude": !!w.gebaeude, "sv-klick": w.klick,
                    "sv-clips-an": false, "sv-clipton": false, "sv-logbuch": false };
    const an = (id) => { const e = box.isConnected ? box.querySelector("#" + id) : null; return e ? !!e.checked : !!stand[id]; };
    const fotoArtJetzt = () => { const e = box.isConnected ? box.querySelector("#sv-fotoart") : null; return (e && e.value) || w.fotoArt || "gross"; };
    const fotosGewaehlt = () => an("sv-fotos-an") ? w.fotos.filter((_, i) => !w.fotosAus.has(i)) : [];
    function stoppsJetzt() {
      const fotos = fotoArtJetzt() === "gross" ? fotosGewaehlt() : [];
      const clips = an("sv-clips-an") ? w.clips.filter((_, i) => !w.clipsAus.has(i)) : [];
      return stoppsWaehlen(fotos, clips, animSJetzt(), an("sv-clipton"));
    }
    /** 05.10.2026 — Fotos ohne Halt (Sofortbild / Bild im Bild), mit Abstand zu den Clip-Stopps. */
    function ohneHaltJetzt() {
      if (fotoArtJetzt() === "gross") return [];
      return fotosOhneHalt(fotosGewaehlt(), animSJetzt(), stoppsJetzt().map(x => x.__bei));
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
      const lbSchilder = (an("sv-logbuch") && w.lb.length) ? logbuchAnwenden(st, w.lb, (v.regie || []).map(r => r.bei)) : [];
      return st.map(x => { const o = Object.assign({}, x); delete o.__bei; delete o.__eigenText; return o; }).concat(lbSchilder);
    };
    // ── 05.10.2026 — Vorlagen (Weite/Tagebuch/Puls): belegen Zutaten, Kartenstil, Fotoart und Musik vor ──
    const vlStand = () => {
      const e = box.querySelector("#sv-vl-stand"); if (!e) return;
      e.textContent = w.angepasst ? T("schnell.vl_angepasst", "Vorlage angepasst — ein Klick auf die Vorlage stellt sie wieder her.") : "";
      box.querySelectorAll("[data-sv-vorlage]").forEach(b => b.classList.toggle("is-on", b.dataset.svVorlage === w.vorlage));
    };
    let vlSetzt = false;   // während die Vorlage Felder setzt, nicht als „angepasst" zählen
    const vorlageSetzen = (n) => {
      const V = VORLAGEN[n]; if (!V) return;
      vlSetzt = true;
      try {
        w.vorlage = n; w.angepasst = false; w.fotoArt = V.fotoArt;
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
    box.querySelector("#sv-vorlagen")?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-sv-vorlage]"); if (b) vorlageSetzen(b.dataset.svVorlage);
    });
    const angepasst = () => { if (vlSetzt) return; w.angepasst = true; vlStand(); };
    box.querySelectorAll("#sv-stil, #sv-zahlen, #sv-profil, #sv-uebersicht, #sv-musik, #sv-fotoart, [data-sv-feld]")
      .forEach(e => e.addEventListener("change", angepasst));
    box.querySelector("#sv-fotoart")?.addEventListener("change", () => { w.fotoArt = fotoArtJetzt(); fotosInfo(); zutatenStand(); vorschau.inhalt(); });
    vlStand();

    let laeuft = false;
    const werteLesen = () => {
      w.stil = vorlageStil(w.vorlage);   // 06.10.2026 (F-14) — Kartenstil aus der Vorlage
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
    /** In das offene Projekt schreiben: ein ⌘Z-Schritt („Schnell-Video übernommen"), vorher ein Arbeitsstand. */
    const uebernehmen = async () => {
      if (laeuft) return;
      const letzte = werteLesen();
      const look = !!box.querySelector("#sv-look")?.checked;
      const voll = animatorPatch(w, v);
      // Reise: Übergänge kommen zur Dauer dazu → abziehen, damit die gewählte Gesamtlänge stimmt
      if (P.uebergangS > 0) voll.duration_s = Math.max(8, Math.round((voll.duration_s - P.uebergangS) * 100) / 100);
      // 07.10.2026 (Web-Fund F-1) — neue Länge → die gespeicherte Raffung des vorigen Schnell-Videos verwerfen; sonst
      // rechnete die Tempo-Kurve mit ihr weiter und schrieb die alte Dauer zurück ins Feld (12,8 statt 33 s)
      voll.tempo_rate = null; voll.tempo_basis = null;
      const patch = look ? nurAblauf(voll) : voll;
      m.close();
      if (P.keyframes > 0) {
        const ja = await window.rzConfirm(T("schnell.kf_frage_titel", "Keyframes ersetzen?"),
          T("schnell.kf_warnung", "Das Projekt hat schon {n} Keyframes — sie werden durch die Kamerafahrt ersetzt (⌘Z holt sie zurück).").replace("{n}", P.keyframes),
          T("schnell.kf_ersetzen", "Ersetzen"), true);
        if (!ja) { toast(T("schnell.nichts_geaendert", "Nichts geändert."), "info", 3000); return; }
      }
      laeuft = true;
      let r;
      const schilder = schilderJetzt();
      try { r = await rzWarten("schnellvideo_uebernehmen", () => api().schnellvideo_uebernehmen(P.id, patch, letzte, schilder)); }
      catch (e) { r = { ok: false, error: String(e) }; }
      laeuft = false;
      if (!r || !r.ok) { toast((r && r.error) || T("common.error", "Fehler"), "error", 6000); return; }
      const nachher = (r.nachher || {}).animator || {}, vorher = (r.vorher || {}).animator || null;
      try { window.rzSetModuleSettingsLocal("animator", nachher); } catch (_) {}
      // Fotostopps sind Schilder (Projekt-Wurzel): im selben ⌘Z-Schritt (Undo-Stand mit __signs)
      if (Array.isArray((r.nachher || {}).signs)) { nachher.__signs = r.nachher.signs; if (vorher) vorher.__signs = (r.vorher || {}).signs || []; }
      const ctrl = window.__rzUndoControllers && window.__rzUndoControllers.animator;
      const label = T("schnell.undo_label", "Schnell-Video übernommen");
      if (ctrl && typeof ctrl.applyState === "function") ctrl.applyState(nachher, label, vorher);
      // Blickrichtung aus der geglätteten Spur — gehört zum selben ⌘Z-Schritt (kein eigener)
      await new Promise(res => setTimeout(res, 1200));
      try { window.__rzUndoApplying = true; const n = window.__rzSchnellKamera ? window.__rzSchnellKamera() : 0; applog("info", `[schnell] übernommen in ${P.id} · Look ${look ? "behalten" : "neu"} · Blickrichtung ${n} Keyframes`); }
      catch (e) { try { applog("warn", "[schnell] Blickrichtung: " + e); } catch (_) {} }
      finally { setTimeout(() => { window.__rzUndoApplying = false; }, 0); }
      // Highlight-Schilder abgleichen — bis der Track mit den neuen Einstellungen steht (max. ~6 s)
      // (ohne Highlights einmal abgleichen: entfernt vorhandene automatische Highlight-Schilder)
      if (!patch.highlights_enabled) { try { if (window.__rzHlAbgleichen) window.__rzHlAbgleichen(); } catch (_) {} }
      else {
        for (let i = 0; i < 12; i++) {
          let n = 0;
          try { n = window.__rzHlAbgleichen ? window.__rzHlAbgleichen() : 0; } catch (_) {}
          if (n > 0) { applog("info", `[schnell] ${n} Highlight-Schilder`); break; }
          await new Promise(res => setTimeout(res, 500));
        }
      }
      toast(T("schnell.uebernommen", "Schnell-Video übernommen — die Keyframes kannst du jetzt anpassen."), "success", 5000);
    };
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
    document.getElementById("sv-animator").onclick = () => los(false);
    if (P) document.getElementById("sv-uebernehmen").onclick = () => uebernehmen();
    document.getElementById("sv-rendern").onclick = () => los(true);
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
