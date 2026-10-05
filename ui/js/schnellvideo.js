/* Schnell-Video — fertiges Tourvideo mit wenigen Entscheidungen (IDEAS §71, 29.09.2026).
 *
 * Marc (Grilling 29.09.2026): Einstieg im Archiv und im Animator; Format 9:16 vorgewählt,
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
  function kamerafahrt(bbox, animS) {
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
    if (w.zahlen) liste.push(C.normalisieren(Object.assign({}, S.frei, {
      stil: "frei", vorlage: "live", name: T("container.v.live", "Live-Werte"), anker: "tc", x: 0, y: y2, inhalt_h: "c",
      zeilen: [C.wert("dist_done", "live"), C.wert("asc_done", "live"), C.wert("time_elapsed", "live")] })));
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
    // 02.10.2026 — Zutat „Übersichtskarte" (IDEAS §78): quadratisch, ~28 % der kurzen Bildseite, oben rechts
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
      liste.push(C.normalisieren(sk));
    }
    liste.push(C.neu("nord", T));
    return liste;
  }

  /** Animator-Einstellungen des Schnell-Video-Projekts (Backend-Schlüssel, wie app.py sie kennt). */
  function animatorPatch(w, v) {
    const [bw, bh] = FORMATE[w.format] || FORMATE["9:16"];
    const f = w.qualitaet === "4k" ? 2 : 1;
    const gesamt = laengeS(w);
    const animS = Math.max(8, gesamt - INTRO_S - HOLD_S);
    return {
      width: bw * f, height: bh * f, fps: FPS,
      map_style: w.stil,
      intro_s: INTRO_S, hold_s: HOLD_S, duration_s: animS,
      keyframes_enabled: true,
      timeline_events: kamerafahrt(v.bbox, animS),
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
      ton_musik_ein: 1, ton_musik_aus: Math.min(3, HOLD_S), ton_klick_an: !!w.klick, ton_klick_laut: 25, ton_klick_klang: "builtin:klick_a",   // Marc: A, „ganz subtil"
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
      text: "", imageSrc: f.path, lat: f.lat, lon: f.lon, anchorMode: "track", style: "callout", imageSize: 44,
      // kleines Foto-Schild: kurz vorher auf, nach dem Stopp wieder weg — sonst stehen am Ende alle Karten
      // auf der Gesamtsicht und verdecken die Schlusskarte (01.10.2026, Teide-Demo)
      entry: "pop", before: 0.6, after: 1.5, exit: "pop", exit_s: 0.4,
      stopp: true, stopp_s: STOPP.sek, stopp_anflug_s: STOPP.anflug, stopp_abflug_s: STOPP.abflug, stopp_zoom: 1.5, stopp_schwenk: 2, stopp_ken: 8,
      stopp_ortzeit: true, stopp_exif: false,
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
  const LB_SYMBOL = { pause: "☕", uebernachtung: "🌙", notiz: "✎" };
  /** 02.10.2026 — Zutat „Logbuch": liegt ein Stopp in einer Pause, steht deren Text unter dem Foto; weitere
   *  Notizen und lange Pausen (ab 10 min) werden kurze Schilder im Highlight-Look (höchstens 3). */
  function logbuchAnwenden(stopps, eintraege) {
    const benutzt = new Set();
    for (const s of stopps) {
      const i = (eintraege || []).findIndex((x, j) => !benutzt.has(j) && s.__bei >= x.von - 0.01 && s.__bei <= x.bis + 0.01);
      if (i >= 0) { const x = eintraege[i]; s.text = ((LB_SYMBOL[x.icon] || "") + " " + x.text).trim(); benutzt.add(i); }
    }
    return (eintraege || []).filter((x, j) => !benutzt.has(j) && (x.art === "notiz" || +x.dauer_s >= 600)
                                             && !stopps.some(s => Math.abs(s.__bei - x.bei) < 0.05) && isFinite(+x.lat))
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
  const ABLAUF = ["fps", "intro_s", "hold_s", "duration_s", "keyframes_enabled", "timeline_events", "camera_follow_track",
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
      laenge: (LAENGEN[L.laenge] || L.laenge === "eigen") ? L.laenge : "normal",
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
    };
    const feldLabel = (f) => T("animator.statsfield." + f, f);
    const m = openModal({
      title: "🎬 " + T("schnell.titel_dialog", "Schnell-Video"),
      body: `<div class="sv-dialog">
        <p class="muted" style="margin:0 0 10px">${esc(T("schnell.intro", "Ein fertiges Video deiner Tour: Überblick, Flug entlang der Strecke, Schlussblick mit deinen Zahlen."))}</p>
        <label class="field-label">${esc(T("schnell.format", "Format"))}</label>
        ${knopfReihe("format", [["9:16", "9:16 " + T("schnell.format_hoch", "hochkant")], ["16:9", "16:9"], ["1:1", "1:1"]], w.format)}
        <label class="field-label">${esc(T("schnell.laenge", "Länge"))}</label>
        ${knopfReihe("laenge", [["kurz", T("schnell.kurz", "Kurz") + " · 20 s"], ["normal", T("schnell.normal", "Normal") + " · 40 s"], ["lang", T("schnell.lang", "Lang") + " · 60 s"],
                                ["eigen", T("schnell.eigen", "Eigene")]].concat(animS ? [["animator", T("schnell.wie_animator", "Wie im Animator") + " · " + String(animS).replace(".", ",") + " s"]] : []), w.laenge)}
        <div class="sv-eigen" id="sv-eigen-zeile"${w.laenge === "eigen" ? "" : " hidden"}>
          <input type="number" id="sv-eigen" class="lib-input" min="${LAENGE_MIN}" max="${LAENGE_MAX}" step="1" value="${w.eigenS}" style="width:90px">
          <span class="muted">${esc(T("schnell.eigen_einheit", "Sekunden gesamt (mindestens {n})").replace("{n}", LAENGE_MIN))}</span>
        </div>
        <label class="field-label" for="sv-titel">${esc(T("schnell.titel", "Titel"))}</label>
        <input type="text" id="sv-titel" class="lib-input" value="${esc(w.titel)}">
        <label class="field-label" for="sv-unter">${esc(T("schnell.unterzeile", "Unterzeile"))}</label>
        <input type="text" id="sv-unter" class="lib-input" value="${esc(w.unter)}">
        <details class="sv-mehr" id="sv-mehr"${w.mehrOffen ? " open" : ""}>
          <summary><span class="sv-mehr-titel">${esc(T("schnell.mehr", "Mehr"))}</span><span class="sv-mehr-kurz" id="sv-mehr-kurz"></span></summary>
          <div class="sv-mehr-inhalt">
          <div class="sv-zutat" data-sv-zutat="fotos">
            <label class="chk sv-zutat-kopf"><input type="checkbox" id="sv-fotos-an"${w.fotosAn ? " checked" : ""}><span>📸 ${esc(T("schnell.z.fotos", "Fotostopps"))}</span><span class="sv-zutat-stand muted" id="sv-fotos-an-stand"></span></label>
            <div class="sv-zutat-teil">
              <div class="sv-fotos" id="sv-fotos"><span class="muted">${esc(T("schnell.fotos_suchen", "Fotos dieser Tour werden gesucht …"))}</span></div>
              <div class="muted sv-fotos-info" id="sv-fotos-info"></div>
            </div>
          </div>
          <div class="sv-zutat" data-sv-zutat="clips">
            <label class="chk sv-zutat-kopf"><input type="checkbox" id="sv-clips-an"${w.clipsAn ? " checked" : ""}><span>🎞 ${esc(T("schnell.z.clips", "Videoclips"))}</span><span class="sv-zutat-stand muted" id="sv-clips-an-stand"></span></label>
            <div class="sv-zutat-teil">
              <div class="sv-fotos" id="sv-clips"><span class="muted">${esc(T("schnell.clips_suchen", "Videoclips dieser Tour werden gesucht …"))}</span></div>
              <label class="chk"><input type="checkbox" id="sv-clipton"${w.clipTon ? " checked" : ""}><span>${esc(T("schnell.clipton", "Originalton der Clips (Musik wird dabei leiser)"))}</span></label>
            </div>
          </div>
          <div class="sv-zutat" data-sv-zutat="logbuch">
            <label class="chk sv-zutat-kopf"><input type="checkbox" id="sv-logbuch"${w.logbuch ? " checked" : ""}><span>📖 ${esc(T("schnell.z.logbuch", "Logbuch"))}</span><span class="sv-zutat-stand muted" id="sv-logbuch-stand"></span></label>
            <div class="sv-zutat-teil muted sv-klein">${esc(T("schnell.logbuch_hint", "Pausen und Notizen aus dem Logbuch: unter dem Foto, wenn es in der Pause entstand, sonst als kurzes Schild an der Stelle."))}</div>
          </div>
          <div class="sv-zutat" data-sv-zutat="musik">
            <label class="chk sv-zutat-kopf"><input type="checkbox" id="sv-musik-an"${w.musikAn ? " checked" : ""}><span>🎵 ${esc(T("schnell.z.musik", "Musik"))}</span><span class="sv-zutat-stand muted" id="sv-musik-an-stand"></span></label>
            <div class="sv-zutat-teil">
              <div class="sv-musik-zeile">
                <select id="sv-musik" class="lib-select">
                  ${[["unterwegs", "Unterwegs (eingebaut)"], ["weite", "Weite — ruhig, filmisch"], ["gipfelsturm", "Gipfelsturm — treibend"],
                     ["rast", "Rast — Lo-Fi, entspannt"], ["grat", "Grat — episch"], ["wanderlied", "Wanderlied — Folk, Gitarre"]]
                    .map(([k, d]) => `<option value="builtin:${k}"${w.musik === "builtin:" + k ? " selected" : ""}>${esc(T("animator.ton." + k, d))}</option>`).join("")}
                  ${w.musik && !w.musik.startsWith("builtin:") ? `<option value="${esc(w.musik)}" selected>🎵 ${esc(String(w.musik).split(/[\\/]/).pop())}</option>` : ""}
                </select>
                <button type="button" class="btn btn-small" id="sv-musik-datei" title="${esc(T("animator.ton.datei_tip", "Eigene Musik wählen (MP3, M4A, WAV, FLAC …)"))}">…</button>
                <button type="button" class="btn btn-small" id="sv-musik-hoeren" title="${esc(T("schnell.musik_hoeren", "Probehören"))}">▶</button>
              </div>
              <label class="chk"><input type="checkbox" id="sv-klick"${w.klick ? " checked" : ""}><span>${esc(T("schnell.klick", "📷 Klick bei jedem Foto"))}</span></label>
            </div>
          </div>
          <div class="sv-zutat" data-sv-zutat="uebersicht">
            <label class="chk sv-zutat-kopf"><input type="checkbox" id="sv-uebersicht"${w.uebersicht ? " checked" : ""}><span>🗺 ${esc(T("schnell.z.uebersicht", "Übersichtskarte in der Ecke"))}</span><span class="sv-zutat-stand muted" id="sv-uebersicht-stand"></span></label>
          </div>
          <div class="sv-zutat" data-sv-zutat="schluss">
            <label class="chk sv-zutat-kopf"><input type="checkbox" id="sv-schluss-an"${w.schlussAn ? " checked" : ""}><span>🏁 ${esc(T("schnell.z.schluss", "Schlusskarte"))}</span><span class="sv-zutat-stand muted" id="sv-schluss-an-stand"></span></label>
            <div class="sv-zutat-teil sv-felder">${SCHLUSS_FELDER.map(f => `<label class="chk"><input type="checkbox" data-sv-feld="${f}"${w.felder.includes(f) ? " checked" : ""}><span>${esc(feldLabel(f))}</span></label>`).join("")}</div>
          </div>
          <div class="sv-zutat" data-sv-zutat="gebaeude">
            <label class="chk sv-zutat-kopf"><input type="checkbox" id="sv-gebaeude"${w.gebaeude ? " checked" : ""}><span>🏠 ${esc(T("schnell.z.gebaeude", "3D-Häuser"))}</span><span class="sv-zutat-stand muted" id="sv-gebaeude-stand"></span></label>
          </div>
            <label class="chk"><input type="checkbox" id="sv-zahlen"${w.zahlen ? " checked" : ""}><span>📊 ${esc(T("schnell.zahlen", "Zahlen unterwegs (Strecke und Höhe)"))}</span></label>
            <label class="chk"><input type="checkbox" id="sv-profil"${w.profil ? " checked" : ""}><span>⛰ ${esc(T("schnell.profil", "Höhenprofil"))}</span></label>
            <label class="chk"><input type="checkbox" id="sv-highlights"${w.highlights ? " checked" : ""}><span>⭐ ${esc(T("schnell.highlights", "Highlights (höchster Punkt, steilste Stelle, halbe Strecke …)"))}</span></label>
            <div class="sv-aussehen">
              <label class="field-label">${esc(T("schnell.qualitaet", "Qualität"))}</label>
              ${knopfReihe("qualitaet", [["1080", "1080"], ["4k", "4K"]], w.qualitaet)}
              <label class="field-label" for="sv-stil">${esc(T("schnell.stil", "Kartenstil"))}</label>
              <select id="sv-stil" class="lib-select" style="width:100%">${stilOptionen(w.stil)}</select>
              <div class="sv-hinweis" id="sv-rechte" hidden></div>
            </div>
          </div>
        </details>
        ${P ? `<div class="sv-projekt">
          <label class="field-label">${esc(T("schnell.in_projekt_titel", "In dieses Projekt übernehmen"))}</label>
          <label class="chk"><input type="checkbox" id="sv-look"${P.hatLook ? " checked" : ""}><span>${esc(T("schnell.look_behalten", "Meinen Look behalten — nur Kamerafahrt und Ablauf übernehmen"))}</span></label>
          <p class="muted" style="margin:2px 0 0;font-size:11.5px">${esc(T("schnell.look_hinweis", "Ohne Haken kommen auch Format, Kartenstil, Einblendungen, Titel und Schlusskarte des Schnell-Videos ins Projekt."))}</p>
          ${P.keyframes > 0 ? `<p class="sv-hinweis" style="margin-top:6px">⚠️ ${esc(T("schnell.kf_warnung", "Das Projekt hat schon {n} Keyframes — sie werden durch die Kamerafahrt ersetzt (⌘Z holt sie zurück).").replace("{n}", P.keyframes))}</p>` : ""}
        </div>` : ""}
      </div>`,
      footer: (P ? `<button type="button" class="btn btn-primary" id="sv-uebernehmen">${esc(T("schnell.in_projekt", "In dieses Projekt übernehmen"))}</button>` : "")
        + `<button type="button" class="btn" id="sv-animator">${esc(P ? T("schnell.neues_projekt", "Neues Projekt") : T("schnell.im_animator", "Im Animator öffnen"))}</button>
               <button type="button" class="btn${P ? "" : " btn-primary"}" id="sv-rendern">🎬 ${esc(T("schnell.rendern", "Video rendern"))}</button>`,
    });
    const box = document.getElementById("modal-body");
    box.querySelectorAll("[data-sv-gruppe]").forEach(r => r.addEventListener("click", (e) => {
      const b = e.target.closest("[data-sv-wert]"); if (!b) return;
      w[r.dataset.svGruppe] = b.dataset.svWert;
      r.querySelectorAll("[data-sv-wert]").forEach(x => x.classList.toggle("is-on", x === b));
      if (r.dataset.svGruppe === "laenge") {
        const z = box.querySelector("#sv-eigen-zeile"); if (z) z.hidden = w.laenge !== "eigen";
        if (w.laenge === "eigen") box.querySelector("#sv-eigen")?.focus();
      }
    }));
    const rechte = () => {
      const s = box.querySelector("#sv-stil").value, h = box.querySelector("#sv-rechte");
      const ok = typeof mapStyleVideoOk === "function" ? mapStyleVideoOk(s) : true;
      h.hidden = ok;
      if (!ok) h.textContent = "⚠️ " + T("schnell.rechte", "Für diesen Kartenstil gibt es keine Freigabe für kommerzielle Videos. Für YouTube & Co. einen freigegebenen Stil wählen — rendern geht trotzdem.");
    };
    box.querySelector("#sv-stil").addEventListener("change", rechte);
    rechte();

    // Fotostopps: Vorschlag aus dem Foto-Bestand, im Dialog abwählbar (Marc, Q1 „beides")
    w.fotos = []; w.fotosAus = new Set();
    const animSJetzt = () => Math.max(8, laengeS(w) - INTRO_S - HOLD_S);
    const fotosInfo = () => {
      const z = box.querySelector("#sv-fotos-info"); if (!z) return;
      const an = w.fotos.filter((_, i) => !w.fotosAus.has(i));
      if (!w.fotos.length) { z.textContent = ""; return; }
      const st = stoppsJetzt(), n = st.filter(x => !x.clip).length;
      z.textContent = T("schnell.fotos_info", "{n} Fotostopps · je {s} s, von der Länge abgezogen").replace("{n}", n).replace("{s}", STOPP_KOSTEN)
        + (n < an.length ? " · " + T("schnell.fotos_zu_viele", "für diese Länge passen nicht alle — die besten kommen rein") : "");
      mehrKurz();
    };
    const fotosZeigen = () => {
      const l = box.querySelector("#sv-fotos"); if (!l) return;
      if (!w.fotos.length) {
        // 02.10.2026 (Marc: „wenn keine Fotos zu finden sind, biete die Möglichkeit, welche bereitzustellen")
        const satz = w.fotosEigen ? T("schnell.fotos_passen_nicht", "Keins der gewählten Fotos passt zur Tour (Ort oder Aufnahmezeit).")
                                  : T("schnell.fotos_keine", "Keine Fotos zu dieser Tour im Foto-Archiv.");
        l.innerHTML = `<span class="muted">${esc(satz)}</span>
          <span class="sv-fotos-knoepfe"><button type="button" class="btn btn-small" data-sv-fotoquelle="ordner">📁 ${esc(T("schnell.fotos_ordner", "Ordner wählen …"))}</button>
          <button type="button" class="btn btn-small" data-sv-fotoquelle="dateien">🖼 ${esc(T("schnell.fotos_dateien", "Fotos wählen …"))}</button></span>`;
        fotosInfo(); return;
      }
      l.innerHTML = w.fotos.map((f, i) => `<button type="button" class="sv-foto${w.fotosAus.has(i) ? "" : " is-on"}" data-sv-foto="${i}" title="${esc(String(f.path).split(/[\\/]/).pop())}">`
        + (f.thumb ? `<img src="${f.thumb}" alt="">` : `<span class="sv-foto-leer">📷</span>`) + `<span class="sv-foto-zeit">${esc(f.zeit || "")}</span></button>`).join("");
      fotosInfo();
      try { zutatenStand(); } catch (_) {}
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
      try { r = await rzWarten("schnellvideo_fotos", () => api().schnellvideo_fotos(pfad, 8, q)); } catch (_) {}
      w.fotosEigen = true; w.fotosAus = new Set();
      w.fotos = (r && r.ok && Array.isArray(r.fotos)) ? r.fotos : [];
      fotosZeigen();
    };
    box.querySelector("#sv-fotos")?.addEventListener("click", (e) => {
      const q = e.target.closest("[data-sv-fotoquelle]"); if (q) { fotosAusQuelle(q.dataset.svFotoquelle); return; }
      const b = e.target.closest("[data-sv-foto]"); if (!b) return;
      const i = +b.dataset.svFoto;
      if (w.fotosAus.has(i)) w.fotosAus.delete(i); else w.fotosAus.add(i);
      b.classList.toggle("is-on", !w.fotosAus.has(i));
      fotosInfo(); zutatenStand();
    });
    box.querySelectorAll("[data-sv-gruppe='laenge']").forEach(r => r.addEventListener("click", () => setTimeout(fotosInfo, 0)));
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
      let r = null;
      try { r = await api().schnellvideo_clips(pfad); } catch (_) {}   // warte-ok: Hintergrund, der Dialog ist schon bedienbar
      w.clips = (r && r.ok && Array.isArray(r.clips)) ? r.clips : [];
      w.clipsGeladen = true;
      // Q1-Prinzip: was gefunden wird, ist vorgewählt — nichts gefunden → Schalter aus (Wahl bleibt änderbar)
      if (!w.clips.length && L.clips_an == null) { const c = box.querySelector("#sv-clips-an"); if (c) c.checked = false; }
      clipsZeigen(); fotosInfo();
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
    const wache = setInterval(() => { if (!box.isConnected || !document.getElementById("sv-mehr")) { hoerenStopp(); clearInterval(wache); } }, 500);   // Dialog zu → Probehören aus
    // ── Stand je Zutat + Kurzfassung an „Mehr" ──
    // Schalter-Stand: aus dem Dialog, nach dem Schließen aus dem zuletzt gelesenen Stand (werteLesen) —
    // „Übernehmen" und „Rendern" schließen den Dialog, bevor die Schilder gebaut werden.
    const SCHALTER = ["sv-fotos-an", "sv-clips-an", "sv-clipton", "sv-logbuch", "sv-musik-an", "sv-klick", "sv-uebersicht", "sv-schluss-an", "sv-gebaeude"];
    const stand = {};
    const an = (id) => { const e = box.isConnected ? box.querySelector("#" + id) : null; return e ? !!e.checked : !!stand[id]; };
    function stoppsJetzt() {
      const fotos = an("sv-fotos-an") ? w.fotos.filter((_, i) => !w.fotosAus.has(i)) : [];
      const clips = an("sv-clips-an") ? w.clips.filter((_, i) => !w.clipsAus.has(i)) : [];
      return stoppsWaehlen(fotos, clips, animSJetzt(), an("sv-clipton"));
    }
    function zutatenStand() {
      const st = stoppsJetzt();
      const setz = (id, txt) => { const e = box.querySelector("#" + id + "-stand"); if (e) e.textContent = txt || ""; };
      setz("sv-fotos-an", w.fotos.length ? `${st.filter(x => !x.clip).length} / ${w.fotos.length}` : "—");
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
      const nf = st.filter(x => !x.clip).length, nc = st.filter(x => x.clip).length;
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
        if (c && r && r.ok) { c.checked = !!r.bebaut; const st = box.querySelector("#sv-gebaeude-stand"); if (st) st.textContent = r.ort || ""; zutatenStand(); }
      })();
    }
    box.querySelectorAll("#sv-fotos-an, #sv-clips-an, #sv-clipton, #sv-logbuch, #sv-musik-an, #sv-uebersicht, #sv-schluss-an, #sv-gebaeude")
      .forEach(e => e.addEventListener("change", () => { fotosInfo(); zutatenStand(); }));
    zutatenStand();
    const schilderJetzt = () => {
      const st = stoppsJetzt();
      const lbSchilder = (an("sv-logbuch") && w.lb.length) ? logbuchAnwenden(st, w.lb) : [];
      return st.map(x => { const o = Object.assign({}, x); delete o.__bei; return o; }).concat(lbSchilder);
    };

    let laeuft = false;
    const werteLesen = () => {
      w.stil = box.querySelector("#sv-stil").value;
      w.titel = box.querySelector("#sv-titel").value.trim();
      w.unter = box.querySelector("#sv-unter").value.trim();
      w.zahlen = box.querySelector("#sv-zahlen").checked;
      w.profil = box.querySelector("#sv-profil").checked;
      w.highlights = box.querySelector("#sv-highlights").checked;
      w.felder = [...box.querySelectorAll("[data-sv-feld]:checked")].map(x => x.dataset.svFeld);
      w.mehrOffen = !!box.querySelector("#sv-mehr")?.open;
      for (const id of SCHALTER) stand[id] = !!box.querySelector("#" + id)?.checked;
      w.fotosAn = an("sv-fotos-an"); w.clipsAn = an("sv-clips-an"); w.clipTon = an("sv-clipton");
      w.logbuch = an("sv-logbuch"); w.musikAn = an("sv-musik-an"); w.klick = an("sv-klick");
      w.musik = box.querySelector("#sv-musik")?.value || "builtin:unterwegs";
      w.uebersicht = an("sv-uebersicht"); w.schlussAn = an("sv-schluss-an"); w.gebaeude = an("sv-gebaeude");
      hoerenStopp();
      w.eigenS = laengeKlemmen(box.querySelector("#sv-eigen")?.value || w.eigenS);
      // „Wie im Animator" gilt nur für dieses Projekt — gemerkt wird die vorige Wahl
      return { format: w.format, laenge: w.laenge === "animator" ? ((LAENGEN[L.laenge] || L.laenge === "eigen") ? L.laenge : "normal") : w.laenge, eigen_s: w.eigenS, qualitaet: w.qualitaet, stil: w.stil, zahlen: w.zahlen, profil: w.profil, highlights: w.highlights, felder: w.felder,
               mehr_offen: w.mehrOffen, fotos_an: w.fotosAn, clips_an: w.clipsAn, clip_ton: w.clipTon, logbuch: w.logbuch,
               musik_an: w.musikAn, musik: w.musik, klick: w.klick, uebersicht: w.uebersicht, schluss_an: w.schlussAn, gebaeude: w.gebaeude };
    };
    /** In das offene Projekt schreiben: ein ⌘Z-Schritt („Schnell-Video übernommen"), vorher ein Arbeitsstand. */
    const uebernehmen = async () => {
      if (laeuft) return;
      const letzte = werteLesen();
      const look = !!box.querySelector("#sv-look")?.checked;
      const voll = animatorPatch(w, v);
      // Reise: Übergänge kommen zur Dauer dazu → abziehen, damit die gewählte Gesamtlänge stimmt
      if (P.uebergangS > 0) voll.duration_s = Math.max(8, Math.round((voll.duration_s - P.uebergangS) * 100) / 100);
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
      let ziel;
      try { ziel = await api().schnellvideo_ziel(name); } catch (_) { ziel = null; }   // warte-ok: sofort
      if (!ziel || !ziel.ok) { B.fehler((ziel && ziel.error) || T("common.error", "Fehler")); B.knopf("schliessen").onclick = () => B.zu(); return; }
      B.schritt(T("schnell.b.start", "Video wird gestartet …")); B.fortschritt(0.03);
      const dateiName = (v.name || "Tour") + " – " + T("schnell.titel_dialog", "Schnell-Video");
      if (typeof window.__rzSchnellRender === "function") window.__rzSchnellRender({ ziel: ziel.path, name: dateiName, buehne: true });
      buehneVerfolgen(B, dateiName, ausAnimator, herkunft);
    };
    document.getElementById("sv-animator").onclick = () => los(false);
    if (P) document.getElementById("sv-uebernehmen").onclick = () => uebernehmen();
    document.getElementById("sv-rendern").onclick = () => los(true);
  }

  /** Fortschritt des Renders im eigenen Bildschirm zeigen (derselbe Status wie im Animator). */
  function buehneVerfolgen(B, dateiName, ausAnimator, herkunft) {
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
})();
