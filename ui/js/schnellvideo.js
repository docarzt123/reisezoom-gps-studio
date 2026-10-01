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
    const logo = C.stilAnwenden(C.neu("logo", T), "plakette");
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
    if (w.titel) {
      const ti = C.neu("titel", T);
      ti.zeilen[0].text = w.titel;
      ti.zeit = { von: { art: "video_start", wert: 0 }, bis: { art: "video_start", wert: INTRO_S } };
      liste.push(C.normalisieren(ti));
    }
    if (w.unter) {
      const un = C.neu("titel", T);
      Object.assign(un, { name: T("container.v.untertitel", "Untertitel"), y: w.titel ? 31 : 20, schriftgroesse: 3.6 });
      un.zeilen[0].text = w.unter;
      un.zeit = { von: { art: "video_start", wert: 0 }, bis: { art: "video_start", wert: INTRO_S } };
      liste.push(C.normalisieren(un));
    }
    if (w.felder.length) {
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
   *  kostet 1 + 3 + 1 s und wird von der Länge ABGEZOGEN (Marc, Q3) — deshalb höchstens so viele, dass
   *  für die Strecke noch 40 % der Animationszeit bleiben; bei Überzahl gehen die besten vor. */
  const STOPP = { sek: 3, anflug: 1, abflug: 1 };
  const STOPP_KOSTEN = STOPP.sek + STOPP.anflug + STOPP.abflug;
  function fotostoppSchilder(fotos, animS) {
    const max = Math.max(0, Math.floor(animS * 0.6 / STOPP_KOSTEN));
    const wahl = (fotos || []).slice().sort((a, b) => (b.wert || 0) - (a.wert || 0) || a.bei - b.bei).slice(0, max)
      .sort((a, b) => a.bei - b.bei);
    return wahl.map(f => ({
      text: "", imageSrc: f.path, lat: f.lat, lon: f.lon, anchorMode: "track", style: "callout", imageSize: 44,
      entry: "pop", before: 0.6, after: 0,
      stopp: true, stopp_s: STOPP.sek, stopp_anflug_s: STOPP.anflug, stopp_abflug_s: STOPP.abflug, stopp_zoom: 1.5,
      stopp_ortzeit: true, stopp_exif: false,
    }));
  }

  /** 01.10.2026 (Marc) — „Ablauf" des Schnell-Videos: was an der Tour hängt und bei „In dieses Projekt
   *  übernehmen" mit „Meinen Look behalten" übernommen wird. Alles andere (Format, Kartenstil, Beschriftungen,
   *  Einblendungen, Verläufe, Highlights, blasse Runde) ist Look und bleibt dann, wie es ist. */
  // Highlights (an/aus + welche) sind Inhalt an der Strecke → Ablauf (Marc 01.10.2026: „die Highlights müssen
  // doch als Schilder drin sein"); ihr Aussehen (Stil, Farben) bleibt Look.
  const ABLAUF = ["fps", "intro_s", "hold_s", "duration_s", "keyframes_enabled", "timeline_events", "camera_follow_track",
                  "highlights_enabled", "highlights_arten",
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
        <label class="field-label">${esc(T("schnell.qualitaet", "Qualität"))}</label>
        ${knopfReihe("qualitaet", [["1080", "1080"], ["4k", "4K"]], w.qualitaet)}
        <label class="field-label" for="sv-stil">${esc(T("schnell.stil", "Kartenstil"))}</label>
        <select id="sv-stil" class="lib-select" style="width:100%">${stilOptionen(w.stil)}</select>
        <div class="sv-hinweis" id="sv-rechte" hidden></div>
        <label class="field-label" for="sv-titel">${esc(T("schnell.titel", "Titel"))}</label>
        <input type="text" id="sv-titel" class="lib-input" value="${esc(w.titel)}">
        <label class="field-label" for="sv-unter">${esc(T("schnell.unterzeile", "Unterzeile"))}</label>
        <input type="text" id="sv-unter" class="lib-input" value="${esc(w.unter)}">
        <label class="field-label">${esc(T("schnell.unterwegs", "Unterwegs"))}</label>
        <label class="chk"><input type="checkbox" id="sv-zahlen"${w.zahlen ? " checked" : ""}><span>${esc(T("schnell.zahlen", "Zahlen unterwegs (Strecke und Höhe)"))}</span></label>
        <label class="chk"><input type="checkbox" id="sv-profil"${w.profil ? " checked" : ""}><span>${esc(T("schnell.profil", "Höhenprofil"))}</span></label>
        <label class="chk"><input type="checkbox" id="sv-highlights"${w.highlights ? " checked" : ""}><span>${esc(T("schnell.highlights", "Highlights (höchster Punkt, steilste Stelle, halbe Strecke …)"))}</span></label>
        <label class="field-label">${esc(T("schnell.fotostopps", "📸 Fotostopps"))}</label>
        <div class="sv-fotos" id="sv-fotos"><span class="muted">${esc(T("schnell.fotos_suchen", "Fotos dieser Tour werden gesucht …"))}</span></div>
        <div class="muted sv-fotos-info" id="sv-fotos-info"></div>
        <label class="field-label">${esc(T("schnell.schlusskarte", "Schlusskarte"))}</label>
        <div class="sv-felder">${SCHLUSS_FELDER.map(f => `<label class="chk"><input type="checkbox" data-sv-feld="${f}"${w.felder.includes(f) ? " checked" : ""}><span>${esc(feldLabel(f))}</span></label>`).join("")}</div>
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
      const n = fotostoppSchilder(an, animSJetzt()).length;
      z.textContent = T("schnell.fotos_info", "{n} Fotostopps · je {s} s, von der Länge abgezogen").replace("{n}", n).replace("{s}", STOPP_KOSTEN)
        + (n < an.length ? " · " + T("schnell.fotos_zu_viele", "für diese Länge passen nicht alle — die besten kommen rein") : "");
    };
    const fotosZeigen = () => {
      const l = box.querySelector("#sv-fotos"); if (!l) return;
      if (!w.fotos.length) { l.innerHTML = `<span class="muted">${esc(T("schnell.fotos_keine", "Keine Fotos zu dieser Tour im Foto-Archiv."))}</span>`; fotosInfo(); return; }
      l.innerHTML = w.fotos.map((f, i) => `<button type="button" class="sv-foto${w.fotosAus.has(i) ? "" : " is-on"}" data-sv-foto="${i}" title="${esc(String(f.path).split(/[\\/]/).pop())}">`
        + (f.thumb ? `<img src="${f.thumb}" alt="">` : `<span class="sv-foto-leer">📷</span>`) + `<span class="sv-foto-zeit">${esc(f.zeit || "")}</span></button>`).join("");
      fotosInfo();
    };
    box.querySelector("#sv-fotos")?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-sv-foto]"); if (!b) return;
      const i = +b.dataset.svFoto;
      if (w.fotosAus.has(i)) w.fotosAus.delete(i); else w.fotosAus.add(i);
      b.classList.toggle("is-on", !w.fotosAus.has(i));
      fotosInfo();
    });
    box.querySelectorAll("[data-sv-gruppe='laenge']").forEach(r => r.addEventListener("click", () => setTimeout(fotosInfo, 0)));
    box.querySelector("#sv-eigen")?.addEventListener("input", () => { w.eigenS = laengeKlemmen(box.querySelector("#sv-eigen").value || w.eigenS); fotosInfo(); });
    (async () => {
      let r = null;
      try { r = await api().schnellvideo_fotos(pfad); } catch (_) {}   // warte-ok: Hintergrund, der Dialog ist schon bedienbar
      w.fotos = (r && r.ok && Array.isArray(r.fotos)) ? r.fotos : [];
      fotosZeigen();
    })();
    const schilderJetzt = () => fotostoppSchilder(w.fotos.filter((_, i) => !w.fotosAus.has(i)), animSJetzt());

    let laeuft = false;
    const werteLesen = () => {
      w.stil = box.querySelector("#sv-stil").value;
      w.titel = box.querySelector("#sv-titel").value.trim();
      w.unter = box.querySelector("#sv-unter").value.trim();
      w.zahlen = box.querySelector("#sv-zahlen").checked;
      w.profil = box.querySelector("#sv-profil").checked;
      w.highlights = box.querySelector("#sv-highlights").checked;
      w.felder = [...box.querySelectorAll("[data-sv-feld]:checked")].map(x => x.dataset.svFeld);
      w.eigenS = laengeKlemmen(box.querySelector("#sv-eigen")?.value || w.eigenS);
      // „Wie im Animator" gilt nur für dieses Projekt — gemerkt wird die vorige Wahl
      return { format: w.format, laenge: w.laenge === "animator" ? ((LAENGEN[L.laenge] || L.laenge === "eigen") ? L.laenge : "normal") : w.laenge, eigen_s: w.eigenS, qualitaet: w.qualitaet, stil: w.stil, zahlen: w.zahlen, profil: w.profil, highlights: w.highlights, felder: w.felder };
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
      buehneVerfolgen(B, dateiName, ausAnimator);
    };
    document.getElementById("sv-animator").onclick = () => los(false);
    if (P) document.getElementById("sv-uebernehmen").onclick = () => uebernehmen();
    document.getElementById("sv-rendern").onclick = () => los(true);
  }

  /** Fortschritt des Renders im eigenen Bildschirm zeigen (derselbe Status wie im Animator). */
  function buehneVerfolgen(B, dateiName, ausAnimator) {
    let aktuell = null, begonnen = false, zu = false;
    // „Schließen": aus dem Archiv gestartet → zurück ins Archiv; aus dem Animator → dort bleiben
    const zurueck = () => { zu = true; B.zu(); if (!ausAnimator && typeof switchMod === "function") switchMod("library"); };
    // 01.10.2026 (Marc: „vom Abbruch aus ist er im Archiv gelandet, was ja schon falsch war … dann war der
    // Animator ausgegraut") — nach dem Abbruch im Animator bleiben (das Projekt ist dort offen) und die
    // Render-Sperre selbst lösen; der Animator kann es nicht, wenn er inzwischen nicht mehr offen ist.
    const abgebrochen = () => { zu = true; B.zu(); try { if (typeof setRenderingState === "function") setRenderingState(false); } catch (_) {} };
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
          B.fertig(url || encodeURI("file://" + s.output));
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
})();
