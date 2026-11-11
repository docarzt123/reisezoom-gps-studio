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
  /** 11.10.2026 (Marc: „für die Kamerabewegung brauchen wir kleine Videos, dass man sieht, was man da einstellt“) —
   *  kurze, stumme Endlos-Clips (Teide, 480 px) aus ui/media/kamera: fahrt · folgen · fest · panorama · nah · ruhig. */
  const kamClip = (k, cls) => `<video class="va-k-clip${cls ? " " + cls : ""}" src="${(window.__rzAssetBase || "")}media/kamera/${k}.mp4" autoplay loop muted playsinline preload="auto" aria-hidden="true"></video>`;
  // 26.10.2026 — Erklärclips hinter dem „?“ im Video-Assistenten (aus der Web-Version, ui/media/hilfe): Einstellung →
  // [Beschriftung (va.w.<k>, leer = keine), Datei]. Gleiche Zuordnung wie gps-studio-web assets/hilfe/clips/clips.json.
  const HILFE_CLIPS = {
    titel: [["", "titel-0"]], z_zahlen: [["", "z_zahlen-0"]], z_profil: [["", "z_profil-0"]], z_highlights: [["", "z_highlights-0"]], z_schluss: [["", "z_schluss-0"]],
    kamera: [["k_mitfliegen", "kamera-k-mitfliegen"], ["k_folgen_nord", "kamera-k-folgen-nord"], ["k_ganze_tour", "kamera-k-ganze-tour"]],
    laufpunkt: [["lp_pfeil", "laufpunkt-lp-pfeil"], ["lp_kugel", "laufpunkt-lp-kugel"], ["lp_fahrzeug", "laufpunkt-lp-fahrzeug"]],
    fotos_als: [["fa_sofortbild", "fotos_als-fa-sofortbild"], ["fa_gross", "fotos_als-fa-gross"], ["fa_pip", "fotos_als-fa-pip"]],
    kartenlook: ["natuerlich", "reiseatlas", "nachtkarte", "minimal", "schatzkarte", "topo", "seekarte", "pastell"].map(n => ["look_" + n, "kartenlook-look-" + n]),
    format: [["f_quer", "format-f-quer"], ["f_hoch", "format-f-hoch"], ["f_quadrat", "format-f-quadrat"]],
    gelaende: [["hilfe_an", "gelaende-hilfe-an"], ["hilfe_aus", "gelaende-hilfe-aus"]],
    beschriftung: [["hilfe_aus", "beschriftung-hilfe-aus"], ["hilfe_an", "beschriftung-hilfe-an"]],
  };
  /** Beschriftungen der Karte (wie die Schalter unter Karte → „Alle aus“ im Animator). */
  const VA_BESCHR = ["places", "roads", "poi", "transit", "admin"];
  const VA_BESCHR_KEY = { places: "show_place_labels", roads: "show_road_labels", poi: "show_poi_labels", transit: "show_transit_labels", admin: "show_admin_boundaries" };
  // wie gps-studio-web (studio.js LOOK_VORLAGE; Marc 07.10.2026: „der Unterschied zwischen Vorlage und Karte ist mir nicht klar“) —
  // im Assistenten nur EINE Wahl (Karte); die Vorlage (Schrift, Einblendungen) folgt daraus
  const LOOK_VORLAGE = { natuerlich: "weite", reiseatlas: "tagebuch", nachtkarte: "puls", minimal: "weite",
                         schatzkarte: "tagebuch", topo: "weite", seekarte: "weite", pastell: "tagebuch" };
  const VA_LINIE_FARBEN = ["#48d6c4", "#ff6b35", "#e63946", "#ffd166", "#ffffff", "#1f2d31", "#7b61ff", "#2a9d8f"];
  /** 11.10.2026 — Symbole der Assistenten-Liste als Strich-Symbol (rzIcon), keine Emojis. */
  const vaIc = (n, g) => (typeof rzIcon === "function" && rzIcon(n, { size: g || 15 })) || "";
  const I = (n, g) => (typeof rzIcon === "function" ? rzIcon(n, { size: g || 14 }) : "");

  const FORMATE = { "9:16": [1080, 1920], "16:9": [1920, 1080], "1:1": [1080, 1080] };
  const LAENGEN = { kurz: 20, normal: 40, lang: 60 };
  const SCHLUSS_FELDER = ["dist_total", "elev_gain", "elev_loss", "moving_time", "duration", "avg_speed", "date"];
  const SCHLUSS_STANDARD = ["dist_total", "elev_gain", "moving_time"];
  const INTRO_S = 3, HOLD_S = 4, FPS = 30;
  const QUALI_FAKTOR = { "1080": 1, "1440": 4 / 3, "4k": 2 }, FPS_WAHL = [25, 30, 60];   // 01.11.2026 — Auflösung/Bildrate im Assistenten
  // 21.10.2026 (Web-Version) — Halt am Ende nur mit Schlusskarte voll (sonst „das Bild am Ende sollte auch das
  // Ende sein“: 1 s); die Kamera fliegt in RUECK_S zurück in die Gesamtsicht, erst dann kommt die Schlusskarte — vorher
  // lag die km-Zahl 1,8 s lang auf Ziel und Laufpunkt
  const HOLD_OHNE_S = 1, RUECK_S = 1.2;
  // 01.11.2026 — Intro und Schluss im Assistenten einstellbar (w.introS / w.holdS, null = wie bisher)
  // 01.11.2026 (Marc: „Intro und Outro auch keins, also 0 Sekunden, und eigene“) — 0 bis 30 s
  const DAUER_MAX = 30;
  const holdS = (w) => (w && w.holdS != null && isFinite(+w.holdS)) ? Math.max(0, Math.min(DAUER_MAX, +w.holdS))
    : (w && w.schlussAn && (w.felder || []).length) ? HOLD_S : HOLD_OHNE_S;
  const introS = (w) => (w && w.introS != null && isFinite(+w.introS)) ? Math.max(0, Math.min(DAUER_MAX, +w.introS)) : INTRO_S;
  const VA_INTRO = [["keins", 0], ["kurz", 1.5], ["normal", INTRO_S], ["lang", 6], ["eigen", null]], VA_HOLD = [["keins", 0], ["kurz", 2], ["normal", HOLD_S], ["lang", 7], ["eigen", null]];
  /** welcher Knopf leuchtet: null = Normal, ein Wert ohne eigenen Knopf = Eigene */
  const vaDauerWahl = (x, liste) => x == null ? "normal" : ((liste.find(([, s_]) => s_ != null && Math.abs(s_ - +x) < 1e-6) || ["eigen"])[0]);
  const vaDauerText = (k, x) => k === "eigen" ? "…" : String(x).replace(".", ",") + " s";
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
  /** 01.11.2026 (Marc: „nach Format einen Reiter Stil … verschiedene Vorlagen mit verschiedenen Schriften, wie das alles
   *  aussieht, auch ob die Berge markiert sind“) — Stil-Vorlagen des Video-Assistenten. Je Vorlage: Anordnung der Zahlen
   *  (`vorlage` = Layout aus VORLAGEN), Stil und Schriften der Einblendungen (`einbl`), Highlight-Schilder, Bergnamen,
   *  Laufpunkt (`lp`) und Linie (`animator`), Zahlen/Profil an, feines Profil. Das Logo ist in allen an (Marc: „wenn die dann
   *  jemand rausmacht, ist okay, aber wenn sie keiner rausmacht, umso besser“). Danach bleibt alles einzeln änderbar. */
  // 01.11.2026 (Marc: zehn Videovorlagen aus den Entwürfen, „bau die alle ein“) — die Einblendungen baut
  // ui/js/videovorlagen.js (`vv`); hier stehen nur Schilder, Bergnamen, Laufpunkt und die Schriftprobe der Karte.
  // „Klassisch“ ist das bisherige Aussehen (Zahlen im Kasten).
  const VV = (vv, hl, bergnamen, lp, probe) => ({ vv, vorlage: "weite", einbl: null, hl, bergnamen, zahlen: true, profil: true, profilFein: true, lp: lp || "leucht", probe });
  const VA_STILE = {
    fernweh:     VV("fernweh", "hl_editorial", true, "leucht", { titel: "cormorant", gew: 500, farbe: "#f4f1e9" }),
    klartext:    VV("klartext", "hl_editorial", false, "dot", { titel: "manrope", gew: 650, farbe: "#f4f1e9" }),
    randnotiz:   VV("randnotiz", "hl_editorial", true, "leucht", { titel: "cormorant", gew: 600, farbe: "#15242b", papier: "links" }),
    unterwegs:   VV("unterwegs", "pille", true, "leucht", { titel: "manrope", gew: 650, farbe: "#f4f1e9", binde: true }),
    feldbuch:    VV("feldbuch", "hl_pinsel", true, "leucht", { titel: "cormorant", gew: 500, kursiv: true, farbe: "#2c413d", notiz: true }),
    vorwaerts:   VV("vorwaerts", "hl_form", false, "leucht", { titel: "manrope", gew: 800, versal: true, farbe: "#f4f1e9", block: true }),
    wegweiser:   VV("wegweiser", "pille", false, "leucht", { titel: "manrope", gew: 650, farbe: "#f4f1e9", schild: true }),
    kino:        VV("kino", "hl_editorial", true, "leucht", { titel: "cormorant", gew: 500, farbe: "#f4f1e9", baender: true, mitte: true }),
    reiseplakat: VV("reiseplakat", "hl_form", false, "leucht", { titel: "manrope", gew: 800, versal: true, farbe: "#f4f1e9", balken: true }),
    lichtglas:   VV("lichtglas", "hl_editorial", true, "leucht", { titel: "manrope", gew: 750, farbe: "#f4f1e9", glas: true }),
    klassisch: { vorlage: "weite", einbl: null, hl: "pille", hlFarbe: "#ffc21a", bergnamen: false, zahlen: true, profil: true, profilFein: false, lp: "arrow",
                 animator: { linien_look: "klassisch", schweif_pct: 0 },
                 probe: { titel: "plex", gew: 700, farbe: "#ffffff", kasten: true } },
  };
  const VA_STIL_STANDARD = "fernweh";
  let VA_STIL_NAMEN = Object.keys(VA_STILE);
  const VA_INTRO_FLUG = ["ueberblick", "erdkugel", "seite"];
  const VA_SCHLUSS_FLUG = ["gesamtsicht", "hoch", "kreisen", "stehen"];
  /** 01.11.2026 (Marc: „es fehlt noch ein Schalter für die verschiedenen Einheiten, also mi/kmh usw.“) — Einheiten des
   *  Projekts (dieselben Schlüssel wie im Animator: Strecke, Höhe, Tempo). Metrisch lässt das Tempo automatisch (Laufen → Pace). */
  const VA_EINHEITEN = {
    metrisch: { einheit_strecke: "km", einheit_hoehe: "m", tempo_als: "auto" },
    imperial: { einheit_strecke: "mi", einheit_hoehe: "ft", tempo_als: "mph" },
    nautisch: { einheit_strecke: "sm", einheit_hoehe: "m", tempo_als: "kn" },
  };
  /** Hat die Tour Zeitstempel? Ohne gibt es kein „Echtes Tempo“ (wie im Animator gesperrt). */
  const vaHatZeit = (v) => !!(v && +v.start_epoch && +v.end_epoch && +v.end_epoch > +v.start_epoch);
  const vaEinheitenAus = (a) => a && a.einheit_strecke === "mi" ? "imperial" : a && a.einheit_strecke === "sm" ? "nautisch" : "metrisch";
  /** 01.11.2026 — im Animator gemerkte Videovorlagen („★ Name“) als weitere Karten im Reiter „Stil“. */
  function vaEigeneVideovorlagen(liste) {
    Object.keys(VA_STILE).filter(k => k.startsWith("eigen:")).forEach(k => { delete VA_STILE[k]; });
    for (const E of (Array.isArray(liste) ? liste : [])) {
      if (!E || !E.id || !E.daten || !Array.isArray(E.daten.container)) continue;
      const A = E.daten.animator || {};
      // 09.11.2026 (Audit) — Werte eigener (auch importierter) Vorlagen landen im HTML der Stil-Kachel: nur #hex-Farben
      const hex = (x, std) => (typeof x === "string" && /^#[0-9a-f]{3,8}$/i.test(x)) ? x : std;
      VA_STILE["eigen:" + E.id] = { eigen: E, vorlage: "weite", einbl: null, hl: A.highlights_stil || "hl_editorial", hlFarbe: hex(A.highlights_farbe, "#ffc21a"),
        bergnamen: A.bergnamen_an !== false, zahlen: true, profil: true, profilFein: true, lp: A.marker_dot_style || "leucht",
        probe: { titel: "manrope", gew: 650, farbe: "#f4f1e9", route: hex(A.line_color, "#ff6b35"), akzent: hex(A.highlights_farbe, "#ffc21a") } };
    }
    VA_STIL_NAMEN = Object.keys(VA_STILE);
  }
  /** 14.10.2026 (Marc: „Bau verschiedene Kamerapositionen, also Presets wie bei MapDirector, für Schnell-Video und
   *  Assistent … coole Namen, anders als bei MapDirector“) — Flugstile der Kamerafahrt. Je Stil: `dz` Zoom gegenüber dem
   *  Begleiter (+ näher), `p` Neigung (0 = senkrecht von oben), `glatt` Faktor für die Ruhe der Kamerabahn, `kurs` = wie
   *  die Blickrichtung entsteht (module.js `_kursKeyframes`: Glättung, Fensterlänge, Kran-Schwenk, feste Richtung,
   *  Kreisen in Grad je Sekunde). Überblick, Anflug und Schlussblick bleiben bei allen gleich. */
  const FLUGSTILE = {
    begleiter:      { dz: 0,    p: 45, glatt: 1,   kurs: {} },
    tiefflieger:    { dz: 1.3,  p: 62, glatt: 0.6, kurs: { glatt_s: 0.7, fenster_f: 0.5 } },
    schwalbe:       { dz: 0.6,  p: 55, glatt: 0.4, kurs: { glatt_s: 0.4, fenster_f: 0.4, tol_grad: 1 } },
    kranschwenk:    { dz: 0.2,  p: 52, glatt: 1,   kurs: { glatt_s: 1.2, kran: 0.8 } },
    thermik:        { dz: -0.6, p: 48, glatt: 1.4, kurs: { glatt_s: 2.5 } },
    reiseflughoehe: { dz: -1.3, p: 38, glatt: 1.8, kurs: { glatt_s: 3.2, fenster_f: 2 } },
    pusteblume:     { dz: -0.7, p: 42, glatt: 2.2, kurs: { modus: "fest" } },
    falke:          { dz: -1.6, p: 12, glatt: 1.5, kurs: { modus: "kreisen", grad_s: 6 } },
    orbit:          { dz: -2.6, p: 0,  glatt: 2,   kurs: { modus: "kreisen", grad_s: 3 } },
    // 14.10.2026 (Marc: „so eine Art Orbit, was langsam immer um den Trackpunkt kreist“) — nah und schräg, eine Runde ≈ 20 s
    karussell:      { dz: 0.2,  p: 52, glatt: 1.2, kurs: { modus: "kreisen", grad_s: 18 } },
  };
  const FLUGSTIL_NAMEN = Object.keys(FLUGSTILE);
  // 01.11.2026 (Marc: „zu viele Kamerapositionen … nur ein Video dazu“; Web-Version: klar verschieden sind nur wenige) —
  // der Assistent zeigt vier, jeder mit Stichpunkten. Die übrigen kennt weiter die Kommandozeile (`--camera …`).
  const VA_FLUGSTILE = ["begleiter", "falke", "orbit", "karussell"];
  const VA_FLUG_PUNKTE = {
    begleiter: ["Fliegt hinter dir her", "Schräger Blick nach vorn", "Folgt weich jeder Kurve", "Passt zu jeder Tour"],
    falke: ["Hoch über der Strecke", "Fast senkrecht von oben", "Kreist langsam (eine Runde ≈ 1 min)", "Zeigt Gelände und Kurven"],
    orbit: ["Sehr hoch, senkrecht von oben", "Viel Umgebung im Bild", "Dreht sich ganz langsam (≈ 2 min je Runde)", "Für lange Strecken und Reisen"],
    karussell: ["Nah dran, schräg", "Kreist um deinen Punkt (eine Runde ≈ 20 s)", "Lebendig", "Für kurze Touren und Gipfel"],
  };
  const FLUGSTIL_TEXT = {
    begleiter: ["Begleiter", "Weich hinter dir her — der Klassiker"],
    tiefflieger: ["Tiefflieger", "Nah, tief, steil — jede Kurve spürbar"],
    schwalbe: ["Schwalbe", "Wendig und lebendig, kaum geglättet"],
    kranschwenk: ["Kranschwenk", "Schwenkt in Kurven nach außen wie ein Kamerakran"],
    thermik: ["Thermik", "Etwas höher, ruhig gleitend"],
    reiseflughoehe: ["Reiseflughöhe", "Hoch und flach, viel Landschaft"],
    pusteblume: ["Pusteblume", "Treibt in einer Richtung, ganz sanft"],
    falke: ["Falke", "Hoch von oben, kreist langsam"],
    orbit: ["Orbit", "Senkrecht aus großer Höhe, langsame Umkreisung"],
    karussell: ["Karussell", "Kreist nah und langsam um deinen Punkt"],
  };
  const flugstil = (w) => FLUGSTILE[(w && (w.flugFahrt || w.flug)) || "begleiter"] || FLUGSTILE.begleiter;   // flugFahrt: Assistent, Begleiter + Hoch = Reiseflughöhe
  /** Optionen für die Blickrichtung (window.__rzSchnellKamera) aus dem gewählten Flugstil. */
  const kursOpts = (w) => {
    const o = Object.assign({}, flugstil(w).kurs);
    // 14.10.2026 — Momente „umkreisen“ (Assistent): eine volle Runde um die Stelle, Bereich wie momentShots (±2d der Strecke)
    const mo = (w && w.kamOpt && Array.isArray(w.kamOpt.momente)) ? w.kamOpt.momente.filter(m => m && m.bewegung === "umkreisen" && isFinite(+m.bei)) : [];
    if (mo.length && o.modus !== "kreisen" && o.modus !== "fest") {
      const animS = Math.max(8, laengeS(w) - introS(w) - holdS(w)), d = Math.min(0.04, 2.5 / Math.max(1, animS));
      o.kreise = mo.map(m => ({ von: Math.max(0, +m.bei - 2 * d), bis: Math.min(1, +m.bei + 2 * d) }));
    }
    return o;
  };
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
      // 19.10.2026 — in der Ortszeit der Tour (`versatz_min` vom Backend), sonst in der dieses Rechners: eine Tour,
      // die um 00:44 Uhr in Norwegen begann, trug am Mac in New York sonst den Vortag im Titel
      const ort = typeof v.versatz_min === "number" && isFinite(v.versatz_min);
      const zeit = (ep) => new Date((ep + (ort ? v.versatz_min * 60 : 0)) * 1000);
      const z = ort ? { timeZone: "UTC" } : {};
      const a = zeit(v.start_epoch), voll = Object.assign({ day: "numeric", month: "long", year: "numeric" }, z);
      // 11.10.2026 (Testvideo Schottland) — Reisen über mehrere Tage: „5. Juli – 9. August 2026“
      if (v.end_epoch && v.end_epoch - v.start_epoch > 36 * 3600) {
        const e = zeit(v.end_epoch);
        const jahrA = ort ? a.getUTCFullYear() : a.getFullYear(), jahrE = ort ? e.getUTCFullYear() : e.getFullYear();
        if (jahrA === jahrE) return a.toLocaleDateString(lang, Object.assign({ day: "numeric", month: "long" }, z)) + " – " + e.toLocaleDateString(lang, voll);
        return a.toLocaleDateString(lang, voll) + " – " + e.toLocaleDateString(lang, voll);
      }
      return a.toLocaleDateString(lang, voll);
    } catch (_) { return ""; }
  }
  window.__rzSchnellDatumText = datumText;   // Prüfstand (19.10.2026)
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
  function kamerafahrt(bbox, animS, regie, opt, linie) {
    const hold = (opt && isFinite(+opt.hold_s)) ? +opt.hold_s : HOLD_S;
    const intro = (opt && isFinite(+opt.intro_s)) ? +opt.intro_s : INTRO_S;   // 01.11.2026 — Intro einstellbar (Assistent)
    const anker = (s) => s < intro ? -(intro - s) / animS
      : (s <= intro + animS ? (s - intro) / animS : 1 + (s - intro - animS) / animS);
    const mitte = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
    // 12.10.2026 (Web-Version: Weltumrundung „zoomt raus, die Weltkugel dreht sich komisch hin und her“) — umspannt die
    // Route ≥ 300° Länge, liegt die Mitte der Box auf der Gegenseite (oder irgendwo, bei −180…180): die Kugel dreht halb
    // herum. Dann Übersicht am Anfang über dem Start, am Ende über dem Ziel (Breite: Mitte der Box).
    const welt = (bbox[2] - bbox[0]) >= 300 && Array.isArray(linie) && linie.length > 1;
    const mitteAnfang = welt ? [+linie[0][0], mitte[1]] : mitte;
    const mitteEnde = welt ? [+linie[linie.length - 1][0], mitte[1]] : mitte;
    // 30.09.2026 (Marc, Vergleich mit Komoot: „die Kamera fliegt tiefer, mehr über den Track") — eine halbe Stufe
    // näher und 45° statt 55°: steiler von oben, kaum Horizont. Getestet: +1 Stufe war im steilen Gelände zu nah.
    const leb = (opt && isFinite(+opt.lebendig)) ? Math.max(0, Math.min(1, +opt.lebendig)) : 0.5;
    const fs = FLUGSTILE[(opt && opt.flug) || "begleiter"] || FLUGSTILE.begleiter;   // 14.10.2026 — Flugstil
    const zNah = Math.max(0.4, Math.max(1.5, Math.min(5, Math.log2(Math.max(0.5, diagonaleKm(bbox)) / 2) + 0.5)) + (leb - 0.5) * 1.2 + fs.dz);
    const NEIGUNG = Math.max(0, Math.min(70, Math.round(fs.p + (leb - 0.5) * 24)));
    // 23.10.2026 (Marc: „bessere Kartendarstellungen") — Schlussbild als Kulisse: flacher und aus der Richtung, aus der die
    // Strecke am besten zu sehen ist (Backend core/sichtkurs.py; ohne Höhen wie bisher 25° nach Norden)
    const kul = opt && isFinite(+opt.sichtkurs) && isFinite(+opt.kulisse_neigung);
    const endP = kul ? +opt.kulisse_neigung : 25, endB = kul ? +opt.sichtkurs : 0;
    // 01.11.2026 (Marc: „bau die Erdkugel am Anfang ruhig ein … ist eigentlich ein guter Punkt für den Assistenten“) —
    // „Von der Erdkugel“: erst die ganze Erde (Zoom ~1,6 absolut, senkrecht, Norden oben), dann ruhig hinunter auf den
    // Überblick der Tour; braucht ein Intro ab 3 s (der Assistent setzt beim Einschalten 6 s)
    // 01.11.2026 (Marc: „kann man verschiedene Intro- und Outro-Flüge im Assistenten wählen?“ — „ja“) — Anfang:
    // ueberblick (wie bisher) · erdkugel · seite (schräger Anflug); Schluss: gesamtsicht (wie bisher) · hoch (Abflug nach
    // oben bis zur Draufsicht auf die ganze Tour) · kreisen (einmal ums Ziel) · stehen (die Kamera bleibt am Ziel)
    const introArt = (opt && opt.intro_flug) || (opt && opt.erdkugel ? "erdkugel" : "ueberblick");
    const schlussArt = (opt && opt.schluss_flug) || "gesamtsicht";
    const kugel = introArt === "erdkugel" && intro >= 3;
    const seite = introArt === "seite" && intro >= 2;
    const punkte = [
      // 01.11.2026 — Intro 0 s: kein Überblick, das Video beginnt mit der Fahrt
      ...(seite ? [{ s: 0, c: mitteAnfang, z: -0.45, p: 68, b: -55, e: "linear" },
        { s: intro * 0.55, c: mitteAnfang, z: -0.2, p: 45, b: -20, e: "ease_in_out" }]
        : kugel ? [{ s: 0, c: mitteAnfang, za: 1.6, p: 0, b: 0, e: "linear" },
        { s: intro * 0.18, c: mitteAnfang, za: 1.6, p: 0, b: 0, e: "ease_in_out" },
        { s: intro * 0.7, c: mitteAnfang, z: -0.15, p: 25, b: 0, e: "linear" },
        { s: intro * 0.85, c: mitteAnfang, z: -0.15, p: 25, b: 0, e: "linear" }]
        : intro > 0.05 ? [{ s: 0, c: mitteAnfang, z: -0.15, p: 25, b: 0, e: "linear" },                 // Überblick
        { s: Math.min(1.2, intro * 0.4), c: mitteAnfang, z: -0.15, p: 25, b: 0, e: "linear" }] : []),   // … kurz stehen
      { a: 0, c: null, z: zNah, p: NEIGUNG, b: 0, e: "ease_in_out" },                    // hinein zum Start (Richtung: __rzSchnellKamera)
      { a: 1, c: null, z: zNah, p: NEIGUNG, b: 0, e: "linear" },                         // Ziel
      // 05.10.2026 (Auto-Regie §8.4 „Gipfel-Shot") — am höchsten Punkt kurz aufziehen und zum Horizont neigen:
      // Panorama statt Draufsicht, dann zurück in die Verfolgung (die Tempo-Regie verweilt dort)
      ...((opt && Array.isArray(opt.momente)) ? momentShots(opt.momente, zNah, NEIGUNG, animS) : gipfelShot(regie, zNah, NEIGUNG, animS)),
      // Schluss 0 s: keine Rückfahrt in die Gesamtsicht, das Video endet am Ziel
      ...(hold > 0.05 ? schlussPunkte(schlussArt, intro + animS, hold, { mitteEnde, endP, endB, zNah, NEIGUNG, endKurs: +(opt && opt.end_kurs) || 0 }) : []),
    ];
    const ev = [];
    for (const k of punkte) {
      const a = Math.round((k.a != null ? k.a : anker(k.s)) * 1e6) / 1e6;
      ev.push({ kind: "pitch", anchor: a, value: k.p, easing: k.e });
      if (k.b != null) ev.push({ kind: "bearing", anchor: a, value: k.b, easing: k.e });   // null = Richtung läuft weiter
      ev.push(k.za != null ? { kind: "zoom", anchor: a, value_absolute: k.za, value_offset: 0, easing: k.e } : { kind: "zoom", anchor: a, value_offset: k.z, easing: k.e });
      ev.push({ kind: "center", anchor: a, value: k.c ? k.c.slice() : null, easing: k.e });
    }
    return ev.sort((x, y) => x.anchor - y.anchor);
  }
  window.__rzKamerafahrt = (...a) => kamerafahrt(...a);   // Prüfstand (Clips der Anfangs- und Schluss-Flüge)
  /** Kamerapunkte nach dem Ziel (Schluss-Flug). T = Ende der Fahrt in Videosekunden. */
  function schlussPunkte(art, T, hold, k) {
    if (art === "hoch") return [{ s: T + hold * 0.45, c: null, z: k.zNah - 1.8, p: 25, b: null, e: "ease_in_out" },
      { s: T + hold, c: k.mitteEnde, z: -0.3, p: 0, b: 0, e: "ease_in_out" }];
    if (art === "kreisen") return [1, 2, 3, 4].map(i => ({ s: T + hold * i / 4, c: null, z: k.zNah - 0.4, p: Math.max(k.NEIGUNG, 50), b: Math.round((k.endKurs + 90 * i) * 100) / 100, e: "linear" }));
    if (art === "stehen") return [{ s: T + hold, c: null, z: k.zNah - 0.35, p: k.NEIGUNG, b: null, e: "ease_in_out" }];
    return [{ s: T + Math.min(RUECK_S, hold), c: k.mitteEnde, z: -0.15, p: k.endP, b: k.endB, e: "ease_in_out" }]   // zurück in die Gesamtsicht
      .concat(hold > RUECK_S ? [{ s: T + hold, c: k.mitteEnde, z: -0.15, p: k.endP, b: k.endB, e: "linear" }] : []);
  }
  /** Bewegungen je Moment (Assistent): panorama = aufziehen und zum Horizont neigen (wie der Gipfel-Shot), nah = näher
   *  heran und steiler, ruhig = nichts Eigenes. Momente, die zu dicht am Rand oder am vorigen liegen, entfallen. */
  const BEWEGUNGEN = ["panorama", "nah", "umkreisen", "ruhig"];   // 14.10.2026 + umkreisen (Marc: „an signifikanten Stellen einmal rumkreisen“)
  function momentShots(momente, zNah, neigung, animS) {
    const d = Math.min(0.04, 2.5 / Math.max(1, animS)), raus = [];
    let letzt = -1;
    for (const m of (momente || []).filter(x => x && isFinite(+x.bei)).sort((a, b) => a.bei - b.bei)) {
      const bei = +m.bei;
      if (m.bewegung === "ruhig" || !BEWEGUNGEN.includes(m.bewegung)) continue;
      if (bei - 2 * d <= 0.02 || bei + 2 * d >= 0.98 || bei - 2 * d < letzt) continue;
      const z = m.bewegung === "panorama" ? panoZ(zNah) : m.bewegung === "umkreisen" ? zNah + 0.3 : zNah + 0.9;
      const p = m.bewegung === "panorama" ? panoP(neigung) : m.bewegung === "umkreisen" ? Math.min(62, Math.max(45, neigung + 8)) : Math.min(62, neigung + 10);
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
  /** 14.10.2026 (Flugstile) — Panorama-Moment: aufziehen und zum Horizont kippen. Bei hohen Stilen (Orbit, Falke …) zog das
   *  sonst über den Überblick hinaus und kippte von senkrecht abrupt auf 62° — dort aufziehen höchstens bis knapp über den
   *  Überblick und sanfter kippen. */
  const panoZ = (zNah) => Math.max(zNah - 1.1, Math.min(zNah, 0.15));
  const panoP = (neigung) => neigung < 30 ? 45 : 62;
  function gipfelShot(regie, zNah, neigung, animS) {
    const h = (regie || []).find(r => r && r.art === "hoechster" && isFinite(+r.bei));
    if (!h) return [];
    const bei = +h.bei, d = Math.min(0.04, 2.5 / Math.max(1, animS));
    if (bei - 2 * d <= 0.02 || bei + 2 * d >= 0.98) return [];
    return [
      { a: bei - 2 * d, c: null, z: zNah, p: neigung, b: 0, e: "ease_in_out" },
      { a: bei - d / 3, c: null, z: panoZ(zNah), p: panoP(neigung), b: 0, e: "ease_in_out" },
      { a: bei + d / 3, c: null, z: panoZ(zNah), p: panoP(neigung), b: 0, e: "ease_in_out" },
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
  /** 01.11.2026 — Einblendungen einer Videovorlage (ui/js/videovorlagen.js) mit den Schaltern des Assistenten:
   *  Titel, Zahlen, Profil, Schluss und Logo lassen sich wie bisher abwählen; Gipfeltitel, Kapitel und Bild im Bild
   *  kommen wie gewohnt dazu. */
  function vvEinblendungen(w, C) {
    if (w.vvEigen) {   // eigene Vorlage: gemerkte Einblendungen, der alte Titel wird zum Titel dieser Tour
      const alt = String(w.vvEigen.daten.titel_alt || "");
      return w.vvEigen.daten.container.map(c => {
        const k = JSON.parse(JSON.stringify(c)); k.id = C.neueId("c");
        k.zeilen = (k.zeilen || []).map(z => Object.assign(z, { id: C.neueId("z") }, z.typ === "text" && alt && z.text === alt ? { text: w.titel || z.text } : {}));
        if (k.vorlage === "logo" && w.logoAn === false) return null;
        if (w.titelAn === false && k.vorlage === "titel") return null;
        return C.normalisieren(k);
      }).filter(Boolean);
    }
    const R = window.rzVideoVorlagen.bauen(w.vv, {
      titel: w.titel, unter: w.textMenge === "wenige" ? "" : w.unter, kicker: w.kicker || "", format: w.format,
      profil: !!w.profil, uebersicht: !!w.uebersicht, felder: w.schlussAn && Array.isArray(w.felder) && w.felder.length ? w.felder : null,
      intro_s: introS(w), hold_s: holdS(w), t: T,
      logo: { an: w.logoAn !== false, anker: { links: "tl", rechts: "tr" }[w.logoLage] || "tc" },
    });
    if (!R) return [];
    if (w.raster) R.container.forEach(c => (c.zeilen || []).forEach(z => { if (z.typ === "diagramm" && z.art === "hoehe") z.raster = true; }));
    return R.container.filter(c => {
      if (w.titelAn === false && (c.vorlage === "titel" || c.vorlage === "schluss")) return false;
      if (!w.zahlen && (c.vorlage === "live" || c.vorlage === "laufpunkt" || c.vorlage === "ring")) return false;
      if (!w.profil && c.vorlage === "hoehe") return false;
      if (!w.schlussAn && c.vorlage === "schluss_werte") return false;
      return true;
    });
  }
  function einblendungen(w) {
    const C = window.rzContainer;
    if (!C) return [];
    if ((w.vv || w.vvEigen) && window.rzVideoVorlagen) {
      const liste = vvEinblendungen(w, C);
      zusatzEinblendungen(w, C, liste);
      return liste;
    }
    const S = C.STILE, liste = [];
    const breit = { "9:16": 30, "1:1": 22, "16:9": 15 }[w.format] || 22;   // Logo-Breite in % der Bildbreite
    // 02.10.2026 (Marc: „wo kommt die dunkle Hinterlegung des Logos her? … das sieht blöd aus, lass das weg") —
    // Stil „Ohne" statt „Plakette"; wer auf heller Karte eine Unterlage will, stellt im Animator den Stil um.
    // 01.11.2026 (wie die iPhone-App) — Assistent: Logo links/Mitte/rechts oder ganz aus (w.logoAn, w.logoLage)
    const logoAn = w.logoAn !== false, logoAnker = { links: "tl", rechts: "tr" }[w.logoLage] || "tc";
    if (logoAn) {
      const logo = C.stilAnwenden(C.neu("logo", T), "ohne");
      Object.assign(logo, { anker: logoAnker, x: logoAnker === "tc" ? 0 : 3, y: 2.5, deckkraft: 1, innen: 0.5, schriftgroesse: 1.6 });
      logo.zeilen[0].b = breit;
      liste.push(C.normalisieren(logo));
    }
    const y2 = w.format === "16:9" ? 13 : w.format === "1:1" ? 12 : 9;   // unter der Plakette
    const vl = VORLAGEN[w.vorlage] ? w.vorlage : "weite";
    // 12.10.2026 (Web-Version, Marc: „Zahlen nach unten“) — Weite: frei unten mittig (über der Profil-Kopfzeile, wie Puls)
    // statt oben: dort tauchen die Highlight-Schilder der nächsten Höhepunkte auf und lagen auf den Zahlen
    if (w.zahlen && vl === "weite") liste.push(C.normalisieren(Object.assign({}, S.frei, {
      stil: "frei", vorlage: "live", name: T("container.v.live", "Live-Werte"), anker: "bc", x: 0,
      y: w.profil ? ({ "9:16": 14, "1:1": 19, "16:9": 21 }[w.format] || 17) : 4, inhalt_h: "c",
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
               C.zeile("diagramm", { art: "hoehe", b: profilB, h: 9, linienfarbe: "#ffffff", raster: !!w.raster })] })));
    // 02.10.2026 (Marc: „im 16:9 liegen Titel und Untertitel übereinander") — EINE Einblendung mit zwei Zeilen:
    // bricht der Titel um, rutscht der Untertitel mit (vorher zwei Einblendungen mit fester Höhe).
    const unter = w.textMenge === "wenige" ? "" : w.unter;   // 11.10.2026 — Assistent „Texte: wenige“ = nur der Titel
    // 01.11.2026 (Marc: „Titel komplett an/aus muss auch gehen“) — w.titelAn === false: keine Titel-Einblendung
    if (w.titelAn !== false && (w.titel || unter)) {
      const ti = C.neu("titel", T);
      ti.zeilen = [];
      if (w.titel) ti.zeilen.push(C.zeile("text", { text: w.titel }));
      if (unter) ti.zeilen.push(C.zeile("text", { text: unter, gr: w.titel ? 0.45 : 1 }));
      if (!w.titel) ti.schriftgroesse = 3.6;
      ti.zeilenabstand = 0.15;
      ti.zeit = { von: { art: "video_start", wert: 0 }, bis: { art: "video_start", wert: introS(w) } };
      liste.push(C.normalisieren(ti));
    }
    zusatzEinblendungen(w, C, liste, true);
    // 02.10.2026 — Zutat „Übersichtskarte": quadratisch, ~28 % der kurzen Bildseite, oben rechts
    if (w.uebersicht) {
      const [bw, bh] = FORMATE[w.format] || FORMATE["9:16"];
      const kante = 0.28 * Math.min(bw, bh);
      const ue = C.neu("uebersicht", T);
      // (02.10.2026 rückte die Karte hochkant/quadratisch unter die Weite-Zahlenreihe oben — seit 12.10.2026 stehen
      // die Zahlen unten, die Karte bleibt oben rechts)
      Object.assign(ue, { anker: (logoAn && logoAnker === "tr") ? "tl" : "tr", x: 3, y: 3 });   // Logo rechts → Übersicht links
      ue.zeilen[0].b = Math.round(kante / bw * 1000) / 10;
      ue.zeilen[0].h = Math.round(kante / bh * 1000) / 10;
      ue.zeilen[0].linienfarbe = "#ff6b35";
      liste.push(C.normalisieren(ue));
    }
    if (w.schlussAn && w.felder.length) {
      const sk = C.neu("schluss", T);
      sk.zeilen = w.felder.map(f => C.wert(f, "gesamt"));
      // 21.10.2026 (F-35) — erst wenn die Kamera in der Gesamtsicht steht (RUECK_S nach dem Ziel)
      sk.zeit = { von: { art: "video_ende", wert: Math.max(0.6, holdS(w) - RUECK_S) }, bis: null };
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
    zusatzEinblendungen(w, C, liste, false, true);
    liste.push(C.neu("nord", T));
    // 01.11.2026 — neue Videos aus dem Assistenten: Einblendungen im Editorial-Stil (ohne Kasten, warmweiß,
    // Titel in Cormorant Garamond, Zahlen in Manrope, weicher Schatten); Lage und Größe bleiben, alles bleibt änderbar
    // 01.11.2026 — Stil-Vorlage des Assistenten (Reiter „Stil“, VA_STILE): Schriften (Titel/Text) und ggf. Stil der Einblendungen
    const E = w.einbl;
    if (E) liste.forEach((c, i) => {
      if (["logo", "nord", "uebersicht", "foto"].includes(c.vorlage)) return;   // Bild im Bild behält seinen Rahmen
      const x = { schrift: c.vorlage === "titel" ? E.titel : E.text, schrift_fest: true };
      if (E.stil === "editorial") Object.assign(x, { stil: "editorial", hg_deckkraft: 0, unschaerfe: false, schatten: false, textschatten: true, beschr_faktor: 0.35, einheit_faktor: 0.48 });
      else if (E.stil === "ohne") Object.assign(x, { stil: "ohne", hg_deckkraft: 0, unschaerfe: false, schatten: false, textschatten: true });
      if (E.farbe) x.textfarbe = E.farbe;
      liste[i] = C.normalisieren(Object.assign({}, c, x));
      // feines Profil: nur die Linie
      if (w.profilFein && c.vorlage === "hoehe") liste[i].zeilen = liste[i].zeilen.map(z => z.typ === "diagramm" ? Object.assign({}, z, { fuellung: false }) : z);
    });
    return liste;
  }

  /** Kapitel- und Gipfeltitel (`titel`) bzw. Bild im Bild (`pip`) — für die Einblendungen des Assistenten und der Videovorlagen. */
  function zusatzEinblendungen(w, C, liste, nurTitel, nurPip) {
    const S = C.STILE;
    const y2 = w.format === "16:9" ? 13 : w.format === "1:1" ? 12 : 9;
    if (!nurPip) {
    // 11.10.2026 (Assistent „Texte“) — Kapiteltitel je Reisetag an der Stelle, an der der Tag beginnt (2,5 s)
    for (const k of (w.kapitelTitel || [])) {
      const kt = C.neu("titel", T);
      kt.name = k.text;
      kt.zeilen = [C.zeile("text", { text: k.text })];
      Object.assign(kt, { schriftgroesse: 4.4, y: 14 });
      const animS = Math.max(8, laengeS(w) - introS(w) - holdS(w));
      kt.zeit = { von: { art: "strecke", wert: k.bei }, bis: { art: "strecke", wert: Math.min(1, k.bei + 2.5 / animS) } };
      kt.blende = { ein: "fade", aus: "fade", ein_s: 0.5, aus_s: 0.5 };
      liste.push(C.normalisieren(kt));
    }
    // 01.11.2026 — großer Gipfeltitel: nur bei einem benannten Gipfel am höchsten Punkt (w.gipfel), groß in
    // Cormorant Garamond im freien oberen Bilddrittel, beim Vorbeifahren ~2,5 s (2,0–2,8 s, Ein 0,5 s, Aus 0,45 s)
    if (w.gipfel && w.gipfelTitelAn !== false && w.gipfel.name) {
      const animS = Math.max(8, laengeS(w) - introS(w) - holdS(w));
      const gt = C.neu("titel", T);
      gt.name = w.gipfel.name;
      gt.zeilen = [C.zeile("text", { text: w.gipfel.name })];
      if (w.gipfel.ele != null) gt.zeilen.push(C.zeile("text", { text: w.gipfel.ele + " m", gr: 0.34 }));
      Object.assign(gt, { schrift: "cormorant", schrift_fest: true, schriftgroesse: w.format === "9:16" ? 4.6 : 6.0, anker: "tl", x: 6, y: w.format === "9:16" ? 22 : 16,
                          zeilenabstand: 0.1 });
      gt.zeit = { von: { art: "strecke", wert: Math.max(0, w.gipfel.bei - 0.3 / animS) }, bis: { art: "strecke", wert: Math.min(1, w.gipfel.bei + 2.5 / animS) } };
      gt.blende = { ein: "fade", aus: "fade", ein_s: 0.5, aus_s: 0.45 };
      liste.push(C.normalisieren(gt));
    }
    }
    if (!nurTitel) {
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
    }
  }

  /** Blickrichtung am Ziel (letzter Richtungs-Keyframe der Fahrt) — Start fürs Kreisen am Schluss. */
  function endKurs() {
    try { const k = window.__rzKursKeyframes && window.__rzKursKeyframes({}); return k && k.length ? +k[k.length - 1].value || 0 : 0; } catch (_) { return 0; }
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
    const f = QUALI_FAKTOR[w.qualitaet] || 1;   // 01.11.2026 — auch 1440p (wie die iPhone-App)
    const gesamt = laengeS(w);
    const animS = Math.max(8, gesamt - introS(w) - holdS(w));
    return {
      width: Math.round(bw * f / 2) * 2, height: Math.round(bh * f / 2) * 2, fps: FPS_WAHL.includes(+w.fps) ? +w.fps : FPS,
      map_style: w.stil,
      intro_s: introS(w), hold_s: holdS(w), duration_s: animS,
      keyframes_enabled: true,
      kamera_vorgabe: "fahrt",   // 07.10.2026 (Klicktest) — Kamera-Pille zeigt „Kamerafahrt“, nicht ein altes „Start → Ziel“
      timeline_events: kamerafahrt(v.bbox, animS, w.tempoRegie ? v.regie : null, Object.assign({}, w.kamOpt || {}, { flug: w.flugFahrt || w.flug || "begleiter", intro_s: introS(w), hold_s: holdS(w), intro_flug: w.introFlug || (w.erdkugel ? "erdkugel" : "ueberblick"), schluss_flug: w.schlussFlug || "gesamtsicht",
        end_kurs: w.schlussFlug === "kreisen" ? endKurs() : 0, sichtkurs: v.sichtkurs, kulisse_neigung: v.kulisse_neigung }), v.linie),
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
      camera_follow_glatt_m: Math.round(Math.max(50, Math.min(4000, 0.35 * mProS(v, animS) * flugstil(w).glatt)) / 25) * 25,
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
      // 12.10.2026 — Assistent: die in „Die Geschichte“ gewählten Höhepunkte (Wegpunkte aus der GPX bleiben dabei)
      highlights_arten: w.hlArten ? [...w.hlArten, "wegpunkte"] : ["hoechster", "steilste", "schnellste", "halbe", "wegpunkte"],
      highlights_stil: w.hlStil || "pille", highlights_farbmodus: "eine", highlights_farbe: w.hlFarbe || "#ffc21a",   // 01.11.2026 — Assistent: Editorial-Pin
      // 02.10.2026 — Zutat „Musik": eigenes Stück der App (oder eigene Datei), Klick bei jedem Foto
      ton_musik_an: !!w.musikAn, ton_musik: w.musik || "builtin:unterwegs", ton_musik_laut: 70,
      // 03.10.2026 — Zutat „3D-Häuser" (Gebäude aus OpenStreetMap in Dachfarbe)
      gebaeude_3d: !!w.gebaeude, gebaeude_wachsen: false,
      // 05.10.2026 — Tempo-Regie (Höhepunkte + Fotos ohne Halt langsamer), nur wenn angehakt
      tempo_eintraege: w.tempoRegie ? tempoRegie(((v && v.regie) || []).map(r => r.bei).concat((w.pip || []).map(p => (p.von + p.bis) / 2)).concat(w.regieFotos || [])) : [],
      ton_musik_ein: 1, ton_musik_aus: Math.min(3, holdS(w)), ton_klick_an: !!w.klick, ton_klick_laut: 25, ton_klick_klang: w.vorlage && w.vorlage !== "weite" ? "builtin:klick_k" : "builtin:klick_a",   // Marc: A, „ganz subtil"; Tagebuch/Puls: weicher Einblendton
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
      // auf der Gesamtsicht und verdecken die Schlusskarte (01.10.2026, Teide-Demo). 18.10.2026 (Marc: „beim
      // Schnell-Video würde ich die Fotopins stehen lassen“) — „mini“: die Karte schrumpft zum runden Foto-Pin, der
      // bis zum Ende stehen bleibt (seit 17.10. folgt der Pin dem Ausblende-Verhalten, „pop“ hätte ihn weggenommen)
      entry: "pop", before: 0.6, after: 1.5, exit: "mini", exit_s: 0.4,
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
      entry: "pop", before: 0.6, after: 1.5, exit: "mini", exit_s: 0.4,   // 18.10.2026 — Pin bleibt stehen (wie Fotos)
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
  const manuellZuerst = (liste) => [...liste.filter(k => k.manuell), ...liste.filter(k => !k.manuell)];
  function stoppsWaehlen(fotos, clips, animS, mitTon, opt) {
    const budget = Math.max(0, animS * 0.5 * ((opt && opt.faktor) || 1));
    const kand = [].concat(
      (fotos || []).map(f => ({ art: "foto", f, kosten: STOPP_KOSTEN, wert: +f.wert || 0, bei: +f.bei, manuell: !!f.manuell })),
      (clips || []).map(c => ({ art: "clip", f: c, kosten: Math.min(CLIP_S, Math.max(0.5, +c.dauer || CLIP_S)), wert: (+c.wert || 0) + 1, bei: +c.bei })));
    kand.sort((a, b) => b.wert - a.wert || a.bei - b.bei);
    let summe = 0;
    const wahl = [];
    // 21.10.2026 (Web-Version) — von Hand gesetzte Fotos kommen zuerst ins Budget; bei „Kurz“ fiel ein selbst ans Ende
    // gesetztes Foto sonst gegen wertvollere weg
    for (const k of manuellZuerst(kapitelZuerst(kand, opt && opt.kapitel))) {
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
    const kand = (fotos || []).map(f => ({ f, bei: +f.bei, wert: +f.wert || 0, manuell: !!f.manuell })).filter(k => isFinite(k.bei))
      .sort((a, b) => b.wert - a.wert || a.bei - b.bei);
    const wahl = [], besetzt = (belegt || []).slice();
    for (const k of manuellZuerst(kapitelZuerst(kand, opt && opt.kapitel))) {
      if (wahl.length >= max) break;
      if (besetzt.some(b => Math.abs(b - k.bei) < 0.06)) continue;
      wahl.push(k); besetzt.push(k.bei);
    }
    const spanne = OHNE_HALT_S / Math.max(1, animS);
    return wahl.sort((a, b) => a.bei - b.bei).map(k => ({ f: k.f, bei: k.bei, von: Math.max(0, k.bei - 0.004), bis: Math.min(1, k.bei + spanne) }));
  }
  /** Sofortbild-Schild an der Strecke (wie ein neues Foto-Schild im Animator: aufpoppen, kurz groß, zum Mini schrumpfen). */
  // 07.10.2026 (Web-Version) — Größe des Sofortbilds wählbar (Standard 24: die Route bleibt sichtbar, Demo 05.10.)
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
  /** 13.10.2026 (Web-Feedback: „Beim Einfügen von Bildern ist das letzte Bild nur ganz kurz zu sehen. Besser wäre es, wenn
   *  das Bild zum Endpunkt länger stehen bleibt“; übernommen aus der Web-Fassung, damit beide gleich aussehen) — ein Sofortbild
   *  kurz vor dem Ziel stand 2,5 s und schrumpfte dann im Herauszoomen zur Schlusskarte. Jetzt: das letzte Sofortbild in den
   *  letzten 15 % erscheint spätestens 2 s vor dem Ziel und bleibt bis zum Ende stehen, dann blendet es weich aus.
   *  13.10.2026 abends (Testvideo): „bis zum Ende“ hieß durch die Schlusskarte hindurch — beim Herauszoomen rutschte das
   *  Foto an den oberen Rand, wurde abgeschnitten und lag über dem Logo (im Hochformat noch enger). Jetzt: spätestens 3 s
   *  vor dem Ziel da, steht bis zum Ziel und blendet aus, während die Schlusskarte kommt. */
  const LETZTES_FOTO_MIN_S = 3;
  function letztesFotoLaenger(schilder, animS) {
    let best = null;
    for (const x of schilder || []) if (x && x.style === "sofortbild" && x.imageSrc && isFinite(x.__bei) && (!best || x.__bei > best.__bei)) best = x;
    if (!best || best.__bei < 0.85 || !(animS > 0)) return null;
    const rest = (1 - best.__bei) * animS;   // Sekunden bis zum Ziel
    best.before = Math.max(+best.before || 0, Math.max(0, LETZTES_FOTO_MIN_S - rest));
    best.after = rest;   // bis zum Ziel = Beginn der Schlusskarte, nicht hinein
    best.exit = "fade"; best.exit_s = 0.5;
    return best;
  }
  window.__rzLetztesFotoLaenger = letztesFotoLaenger;   // Prüfstand
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
    const animS = Math.max(8, laengeS(w) - introS(w) - holdS(w));
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
                   // 17.10.2026 — Stelle in Metern ab Start: an Orten, an denen der Weg zweimal vorbeiführt, gilt die richtige Durchfahrt
                   ...(isFinite(+x.m) && x.m != null ? { strecke_m: +x.m } : {}),
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
                  "marker_dot_bild", "marker_dot_bild_form", "marker_dot_bild_drehen",
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
    // 06.10.2026 — Zahlen und Höhenprofil so angeordnet wie im Video (je Vorlage): Weite frei unten mittig (seit 12.10.2026),
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
      zEl.className = "sv-vk-zahlen art-" + vl + ((vl === "puls" || vl === "weite") && pAn ? " ueber-profil" : "");
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
   *  Lage gemerkt. Gleiche Schnittstelle wie openModal (`body`, `close`), dazu `onX` für das ✕.
   *  12.10.2026 (neue Optik) — links über den Werkzeugen, volle Höhe; die Karten-Fläche hält auf der Seite, die das Fenster
   *  überdeckt, Platz frei (vaPlatz) — die Vorschau rechts bleibt unverdeckt. */
  function vaFenster(o) {
    try { const alt = document.getElementById("va-fenster"); if (alt && alt.__zu) alt.__zu(); } catch (_) {}
    const f = document.createElement("div");
    f.id = "va-fenster"; f.className = "va-fenster"; f.setAttribute("role", "dialog");
    f.setAttribute("aria-label", T("va.titel", "Video-Assistent"));
    f.innerHTML = `<div class="va-f-kopf"><span class="va-f-griff" aria-hidden="true">${I("grip-vertical", 16)}</span><b class="va-f-titel">${esc(o.title || "")}</b>
        <span class="va-f-status muted" hidden><span class="spinner"></span> ${esc(T("va.traegt_ein", "wird eingetragen …"))}</span><span class="va-f-luecke"></span>
        <button type="button" class="va-f-knopf" data-va-klapp title="${esc(T("va.einklappen", "Einklappen"))}">${I("chevron-up", 16)}</button>
        <button type="button" class="va-f-knopf" data-va-x title="${esc(T("va.schliessen_tip", "Schließen — nimmt alles zurück, was der Assistent geändert hat"))}">${I("x", 17)}</button></div>
      <div class="va-f-rumpf">${o.body || ""}</div><div class="va-f-fuss">${o.footer || ""}</div>`;
    document.body.appendChild(f);
    const LAGE = "rz.va.lage2";
    const merken = () => { try { const r = f.getBoundingClientRect(); localStorage.setItem(LAGE, JSON.stringify({ x: r.left, y: r.top, zu: f.classList.contains("va-zu") })); } catch (_) {} };
    // Kartenfläche: auf der überdeckten Seite Platz lassen (links oder rechts), eingeklappt keinen
    const platz = () => {
      const c = document.querySelector("#mod-animator .anim-canvas") || document.querySelector(".anim-canvas");
      if (!c) return;
      c.style.removeProperty("--va-platz-l"); c.style.removeProperty("--va-platz-r");
      if (!f.isConnected || f.classList.contains("va-zu")) return;
      const r = f.getBoundingClientRect(), k = c.getBoundingClientRect();
      const links = Math.max(0, r.right + 14 - k.left), rechts = Math.max(0, k.right - (r.left - 14));
      if (r.right <= k.left || r.left >= k.right) return;   // liegt neben der Fläche
      const max = Math.max(0, k.width * 0.6);
      if ((r.left + r.right) / 2 < (k.left + k.right) / 2) c.style.setProperty("--va-platz-l", Math.min(links, max) + "px");
      else c.style.setProperty("--va-platz-r", Math.min(rechts, max) + "px");
    };
    const setzLage = (x, y) => {
      const b = f.getBoundingClientRect();
      x = Math.max(8, Math.min(window.innerWidth - Math.min(b.width, 200) - 8, x));
      y = Math.max(8, Math.min(window.innerHeight - (f.classList.contains("va-zu") ? 48 : 272), y));
      f.style.left = x + "px"; f.style.top = y + "px"; f.style.right = "auto";
    };
    try { const l = JSON.parse(localStorage.getItem(LAGE) || "null"); if (l && isFinite(l.x) && isFinite(l.y)) setzLage(l.x, l.y); if (l && l.zu) f.classList.add("va-zu"); } catch (_) {}
    if (!f.style.top) {   // erste Lage: oben bündig mit der Arbeitsfläche, links über den Werkzeugen
      const c = document.querySelector("#mod-animator .anim-canvas"), t_ = c ? c.getBoundingClientRect().top : 0;
      if (t_ > 40 && t_ < window.innerHeight - 300) f.style.top = Math.round(t_ + 8) + "px";
    }
    const kopf = f.querySelector(".va-f-kopf");
    kopf.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || e.target.closest("button")) return;
      e.preventDefault();
      const b = f.getBoundingClientRect(), dx = e.clientX - b.left, dy = e.clientY - b.top;
      f.classList.add("va-zieht");
      const zieh = (ev) => setzLage(ev.clientX - dx, ev.clientY - dy);
      const los = () => {
        window.removeEventListener("mousemove", zieh); window.removeEventListener("mouseup", los);
        f.classList.remove("va-zieht"); merken(); platz();
      };
      window.addEventListener("mousemove", zieh); window.addEventListener("mouseup", los);
    });
    const klapp = f.querySelector("[data-va-klapp]");
    klapp.onclick = () => {
      f.classList.toggle("va-zu");
      klapp.innerHTML = I(f.classList.contains("va-zu") ? "chevron-down" : "chevron-up", 16);
      merken(); platz();
    };
    if (f.classList.contains("va-zu")) klapp.innerHTML = I("chevron-down", 16);
    let zu = false;
    document.body.classList.add("va-offen");
    const beiGroesse = () => platz();
    window.addEventListener("resize", beiGroesse);
    requestAnimationFrame(platz); setTimeout(platz, 400);
    // 12.10.2026 (Marc: „wenn ich aus dem Animator rausgehe, soll der Videoassistent nicht mehr sichtbar sein“) — andere
    // Module: ausblenden; zurück im Animator: wieder zeigen (o.beimAnimator entscheidet, z. B. anderes Projekt → schließen)
    const beiModul = (e) => {
      const slug = e && e.detail && e.detail.slug;
      if (slug !== "animator") { f.hidden = true; document.body.classList.remove("va-offen"); return; }
      setTimeout(() => {
        if (zu) return;
        if (o.beimAnimator && o.beimAnimator() === false) return;
        f.hidden = false; document.body.classList.add("va-offen"); platz();
      }, 500);
    };
    window.addEventListener("rz-modul", beiModul);
    const api_ = {
      body: f.querySelector(".va-f-rumpf"), el: f, onX: null, platz,
      close() { if (zu) return; zu = true; f.remove(); document.querySelectorAll(".va-leuchtet").forEach(x => x.classList.remove("va-leuchtet"));
        document.body.classList.remove("va-offen"); window.removeEventListener("resize", beiGroesse); window.removeEventListener("rz-modul", beiModul); platz();
        try { if (window.__rzAnimSigns && window.__rzAnimSigns.alleZeigen) window.__rzAnimSigns.alleZeigen(false); } catch (e) { if (window.rzSwallow) rzSwallow(e, "assistent:alle_schilder_aus"); } if (o.onClose) try { o.onClose(); } catch (_) {} },
    };
    f.querySelector("[data-va-x]").onclick = () => (api_.onX ? api_.onX() : api_.close());
    f.__zu = () => api_.close();
    return api_;
  }
  /** Stufe → Bereich der Seitenleiste, der kurz aufleuchtet („Das findest du später hier“). */
  const VA_BEREICH = { 1: "format", 2: "camera", 3: "map", 4: "track", 5: "overlays", 6: "signs", 7: "signs", 8: "ton" };
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
    // 26.10.2026 (Klicktest) — ⌘Z nimmt den Assistenten zurück → der Bericht darüber gehört weg
    const nachUndo = (e) => {
      if (!p.isConnected) { window.removeEventListener("rz-undo", nachUndo); return; }
      if (e.detail && e.detail.richtung === "undo" && e.detail.label === T("va.undo_label", "Video-Assistent")) { p.remove(); window.removeEventListener("rz-undo", nachUndo); }
    };
    window.addEventListener("rz-undo", nachUndo);
    if (!(window.rzDetailSpalte && window.rzDetailSpalte.aufnehmen(p, T("va.titel", "Video-Assistent")))) document.body.appendChild(p);
  }

  // 26.10.2026 (Marc: „Video-Assistent und dann direkt Schnell-Video geklickt … dass das 2× gleichzeitig erstellt wird“) —
  // immer nur EIN Schnell-Video/Assistent: offen = Assistenten-Fenster oder Schnell-Video-Dialog im DOM; `_svStartet` deckt die
  // Zeit davor (Vorschlag wird geladen) und das Anlegen nach dem Schließen ab.
  let _svStartet = false;
  const svSchonOffen = () => _svStartet || !!document.getElementById("va-fenster")
    || !!document.querySelector("#modal-overlay:not([hidden]) #modal-body .sv-dialog");
  /** 01.11.2026 — Werte einer Stil-Vorlage in den Zustand des Assistenten (ohne Oberfläche; vaStilSetzen zeigt es an). */
  function vaStilWerte(w, id) {
    const V = VA_STILE[id] || VA_STILE[VA_STIL_STANDARD];
    w.stilId = VA_STILE[id] ? id : VA_STIL_STANDARD;
    const VB = V.vv && window.rzVideoVorlagen ? window.rzVideoVorlagen.bauen(V.vv, {}) : null;   // nur Linienfarben/Verlauf
    w.vv = V.vv || null; w.vvVerlauf = VB ? VB.verlauf : null; w.vvEigen = V.eigen || null;
    w.vorlage = V.vorlage; w.einbl = V.einbl; w.hlStil = V.hl; w.hlFarbe = VB ? VB.palette.akzent : V.hlFarbe; w.bergnamen = V.bergnamen;
    w.zahlen = V.zahlen; w.profil = V.profil; w.profilFein = V.profilFein; w.lp = V.lp; w.stilAnimator = VB ? VB.animator : V.animator;
    if (V.eigen) { w.stilAnimator = Object.assign({}, V.eigen.daten.animator || {}); w.vvVerlauf = V.eigen.daten.verlauf || null; }
    // 01.11.2026 — Höhenprofil und Übersichtskarte: vorgeschlagen, was die Vorlage von Haus aus zeigt; die Schalter gehen in jeder Vorlage
    if (V.vv && window.rzVideoVorlagen && window.rzVideoVorlagen.standard) { const st = window.rzVideoVorlagen.standard(V.vv); w.profil = st.profil; w.uebersicht = st.uebersicht; }
    if (V.fotoArt) w.fotoArt = V.fotoArt;
    w.logoAn = true;   // Logo in allen Vorlagen an
    vaDrohneHalten(w);
  }
  /** 10.11.2026 (Marc: „DJI-Erkennung und Anti-Gravity-Erkennung“) — Drohnenflug (schnellvideo_vorschlag.drohne): der
   *  Laufpunkt bleibt die Drohne, welcher Stil auch gewählt wird; „Aus“ bleibt aus. Von Hand gewählt gilt danach. */
  function vaDrohneHalten(w) {
    if (w && w.drohne && w.lp !== "aus") { w.lp = "fahrzeug"; w.lpFz = "drohne"; }
  }
  function vaStilName(k) {
    if (VA_STILE[k] && VA_STILE[k].eigen) return "★ " + VA_STILE[k].eigen.name;
    const V = window.rzVideoVorlagen && VA_STILE[k] && VA_STILE[k].vv ? window.rzVideoVorlagen.LISTE.find(x => x.id === VA_STILE[k].vv) : null;
    return V ? T("vv.name." + V.id, V.name) : T("va.stil_" + k, k === "klassisch" ? "Klassisch" : k);
  }
  /** 01.11.2026 — Karte einer Vorlage im Reiter „Stil“: kleine Schriftprobe mit Linie und Zahlen in den Farben der Vorlage. */
  function vaStilKarte(k, an) {
    const S = VA_STILE[k], P = S.probe || {};
    const V = S.vv && window.rzVideoVorlagen ? window.rzVideoVorlagen.LISTE.find(x => x.id === S.vv) : null;
    const hex = (x, std) => (typeof x === "string" && /^#[0-9a-f]{3,8}$/i.test(x)) ? x : std;   // 09.11.2026 — nie Fremdtext ins HTML
    const ak = hex(V ? V.palette.akzent : P.akzent, "#ffc21a"), route = hex(V ? V.palette.route : P.route, "#ff6b35");
    const fam = (x) => ({ cormorant: "'Cormorant Garamond', Georgia, serif", manrope: "Manrope, system-ui, sans-serif", plex: "'IBM Plex Sans', system-ui, sans-serif" })[x] || "system-ui";
    const kurz = T("vv.kurz." + (S.vv || k), V ? "" : T("va.stil_klassisch_k", "Zahlen im Kasten, Pillen-Schilder"));
    const titelSt = `font-family:${fam(P.titel)};font-weight:${P.gew || 600};color:${P.farbe};${P.kursiv ? "font-style:italic;" : ""}${P.versal ? "text-transform:uppercase;letter-spacing:-0.02em;" : ""}`;
    const kl = ["va-stil-probe", P.papier ? "mit-papier" : "", P.notiz ? "mit-notiz" : "", P.binde ? "mit-binde" : "", P.block ? "mit-block" : "", P.schild ? "mit-schild" : "",
      P.baender ? "mit-baendern" : "", P.mitte ? "titel-mitte" : "", P.glas ? "mit-glas" : "", P.kasten ? "mit-kasten" : ""].filter(Boolean).join(" ");
    // 01.11.2026 (Marc: „mach hübsche Bilder für die Vorlagen, am besten Screenshots … die Teide-Tour“) — echtes Standbild
    // der Vorlage auf der Teide-Tour (ui/img/vorlagen/<id>.jpg); eigene Vorlagen behalten die Schriftprobe
    if (V || k === "klassisch") return `<button type="button" class="va-bk va-stil-k${an ? " is-on" : ""}" data-va-stil="${k}" title="${esc(kurz)}">`
      + `<span class="va-bk-bild va-stil-bild"><img src="${(window.__rzAssetBase || "")}img/vorlagen/${esc(V ? V.id : k)}.jpg" alt="" loading="lazy" draggable="false"><span class="va-haken">${I("check", 13)}</span></span>`
      + `<b>${V ? `<small class="va-sp-nr">${esc(V.nr)}</small> ` : ""}${esc(vaStilName(k))}</b></button>`;
    return `<button type="button" class="va-bk va-stil-k${an ? " is-on" : ""}" data-va-stil="${k}" title="${esc(kurz)}">`
      + `<span class="va-bk-bild ${kl}" style="--vs-akzent:${ak}">`
      + `<svg class="va-sp-spur" viewBox="0 0 100 60" preserveAspectRatio="none"><path d="M8 52 C 26 40, 30 26, 48 30 S 74 44, 92 14" fill="none" stroke="${route}" stroke-width="2.2" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`
      + `<span class="va-sp-titel" style="${titelSt}">Teide${P.balken ? "<i></i>" : ""}</span>`
      + `<span class="va-sp-zahlen"><small>STRECKE</small>10,8<i>km</i></span>`
      + (S.bergnamen ? `<span class="va-sp-berg" style="font-family:${fam("cormorant")}">Pico Viejo<small>3135 m</small></span>` : "")
      + `<span class="va-haken">${I("check", 13)}</span></span>`
      + `<b>${V ? `<small class="va-sp-nr">${esc(V.nr)}</small> ` : ""}${esc(vaStilName(k))}</b></button>`;
  }
  async function rzSchnellVideo(pfad, opts) {
    if (!pfad) return;
    if (svSchonOffen()) {
      const f = document.getElementById("va-fenster");
      toast(f ? T("va.schon_offen", "Der Video-Assistent ist schon offen — erst ihn beenden.") : T("schnell.schon_offen", "Es wird gerade schon ein Video eingerichtet — erst diesen Dialog beenden."), "info", 4500);
      if (f && !f.hidden) { f.classList.add("va-blink"); setTimeout(() => f.classList.remove("va-blink"), 900); }
      try { applog("info", "[schnell] zweiter Start abgewiesen — schon offen"); } catch (_) {}
      return;
    }
    _svStartet = true;
    const P = (opts && opts.projekt && opts.projekt.id) ? opts.projekt : null;
    const ausAnimator = !!opts;   // aus dem Animator aufgerufen (das Archiv übergibt keine opts)
    const animS = (opts && +opts.animatorS > 0) ? Math.round(+opts.animatorS * 10) / 10 : 0;   // Länge im Animator (Intro + Animation + Halten)
    // 08.10.2026 — Video-Assistent: derselbe Dialog als Quiz in neun Seiten, schreibt ins offene Projekt
    const ASS = !!(opts && opts.assistent) && !!P;
    // 01.11.2026 (Marc: Schnell-Video und Assistent zusammenlegen) — aus dem Archiv/von der Tour-Seite gestartet: die Tour war
    // noch kein Projekt. Der Assistent legt eins an (vorläufig, „Automatisch angelegt“); „Ins Projekt übernehmen“ macht es
    // zum richtigen Projekt, „Abbrechen“ löscht es wieder, „Video erstellen“ lässt es wie früher das Schnell-Video stehen.
    const VORL = ASS && !!P.vorlaeufig;
    let v;
    try { v = await rzWarten("schnellvideo_vorschlag", () => api().schnellvideo_vorschlag(pfad)); }
    catch (e) { v = { ok: false, error: String(e) }; }
    if (!v || !v.ok) { _svStartet = false; toast((v && v.error) || T("common.error", "Fehler"), "error", 6000); return; }
    // 03.11.2026 — Kommandozeile `--template-file x.rzstyle`: die gelesene Vorlage kommt als weitere eigene dazu (nicht gespeichert)
    vaEigeneVideovorlagen((Array.isArray(v.videovorlagen_eigen) ? v.videovorlagen_eigen : []).concat(opts && opts.videovorlageEigen ? [opts.videovorlageEigen] : []));
    const L = v.letzte || {};
    const w = {
      format: FORMATE[L.format] ? L.format : "9:16",
      laenge: (LAENGEN[L.laenge] || (L.laenge === "eigen" && opts && opts.assistent)) ? L.laenge : "normal",   // 06.10.2026 — nur noch Kurz/Normal/Lang; der Assistent merkt sich auch „Eigene“
      eigenS: laengeKlemmen(L.eigen_s || 30), animatorS: animS,
      qualitaet: QUALI_FAKTOR[L.qualitaet] ? L.qualitaet : "1080",
      fps: FPS_WAHL.includes(+L.fps) ? +L.fps : FPS,
      einheiten: VA_EINHEITEN[L.einheiten] ? L.einheiten : null,   // 01.11.2026 — null = wie das Projekt
      pace: L.pace === "real" ? "real" : "even",   // 01.11.2026 — Verteilung über den Track (Marc: „muss in Punkt 1 mit rein“)
      stil: L.stil || (typeof mapDefaultStyle === "function" ? mapDefaultStyle() : "free_satellite"),
      zahlen: !!L.zahlen, profil: !!L.profil, raster: !!L.profil_raster,
      highlights: L.highlights !== false,   // 30.09.2026 — Standard an
      felder: Array.isArray(L.felder) ? L.felder.filter(f => SCHLUSS_FELDER.includes(f)) : SCHLUSS_STANDARD.slice(),
      titel: v.name || "", unter: [datumText(v), ortKurz(v.ort)].filter(Boolean).join(" · "), kicker: ortKurz(v.ort) || "",
      // 02.10.2026 — Zutaten unter „Mehr" (Marc: „beim Schnell-Video bleiben und eine erweiterte Option machen")
      mehrOffen: !!L.mehr_offen,
      fotosAn: L.fotos_an !== false, clipsAn: L.clips_an !== false, clipTon: !!L.clip_ton,
      logbuch: L.logbuch !== false, musikAn: false, musik: L.musik || "builtin:unterwegs", klick: L.klick !== false,   // 26.10.2026 (Marc: „mach Musik per Default überall aus“) — Musik jedes Mal aus, an nur per Klick
      uebersicht: !!L.uebersicht, schlussAn: L.schluss_an !== false,
      gebaeude: L.gebaeude,   // undefined = noch nie gewählt → vorwählen, wenn die Tour durch einen Ort führt
      // 05.10.2026 — Vorlage (Weite/Tagebuch/Puls) und Fotoart; „angepasst" = eine Zutat weicht von der Vorlage ab
      vorlage: VORLAGEN[L.vorlage] ? L.vorlage : "weite",
      fotoArt: FOTO_ARTEN.includes(L.foto_art) ? L.foto_art : null,
      sofortGroesse: sofortGroesse(L.sofort_groesse),               // 07.10.2026 (F-5)
      fotoPause: L.foto_pause === "stehen" ? "stehen" : "heran",    // 07.10.2026 (F-5) — Fotostopp mit/ohne Heranfahren
      angepasst: !!L.angepasst,
      tempoRegie: true,   // 06.10.2026 — immer an, kein Haken mehr
      flug: FLUGSTILE[L.flug] ? L.flug : "begleiter",   // 14.10.2026 — Flugstil der Kamerafahrt
      fotoKreisen: !!L.foto_kreisen,                      // 14.10.2026 — Kamera kreist im Fotostopp einmal ums Foto
      drohne: !!v.drohne,                                 // 10.11.2026 — Drohnenflug: Laufpunkt Drohne (vaDrohneHalten)
    };
    if (!VORLAGEN[L.vorlage]) {
      // Erster Aufruf mit Vorlagen: Weite vorbelegen (Q5) — eigene Musikdatei und Felder bleiben
      const V = VORLAGEN.weite;
      w.stil = vorlageStil("weite"); w.zahlen = V.zahlen; w.profil = V.profil; w.uebersicht = V.uebersicht;
      if (!L.musik || String(L.musik).startsWith("builtin:")) w.musik = V.musik;
    }
    if (!w.fotoArt) w.fotoArt = VORLAGEN[w.vorlage].fotoArt;
    // Der Assistent schlägt vor — Fotos, Highlights, Schlusskarte und Musik an, auch wenn das Schnell-Video zuletzt ohne lief
    if (ASS) { w.look = VORLAGEN[w.vorlage].look; w.kamera = "fahrt"; w.fotosAn = true; w.highlights = true; w.schlussAn = true; w.logbuch = true;
      // 26.10.2026 — Reiter wie im Web: Höhe, Laufpunkt, Linie (nur Eigenes über dem Look), Beschriftung/Gelände/Vorab-Strecke
      // (null = wie Look bzw. Projekt), Fotoart mit Vorgabe Sofortbild
      w.hoehe = "mittel"; w.lp = "arrow"; w.lpFz = "wanderer"; w.ls = {}; w.beschr = {}; w.gelaende = null; w.ghost = null; w.fotoArt = "sofortbild";
      // 01.11.2026 — der Assistent merkt sich seine letzte Wahl (wie früher das Schnell-Video); `va` = vom Assistenten gemerkt
      if (!VA_FLUGSTILE.includes(w.flug)) w.flug = "begleiter";   // im Assistenten nur vier Flugstile (s. VA_FLUGSTILE)
      // 01.11.2026 — neue Videos aus dem Assistenten: Highlights und Orte als Editorial-Hinweis-Pin
      // 01.11.2026 — Stil-Vorlage (Reiter „Stil“): gemerkte oder Editorial; setzt Schriften, Schilder, Bergnamen, Laufpunkt, Linie
      w.stilId = (L.va && VA_STILE[L.stil_id]) ? L.stil_id : VA_STIL_STANDARD;
      if (L.va) {
        if (["fahrt", "folgen", "fest"].includes(L.kamera)) w.kamera = L.kamera;
        if (["nah", "mittel", "hoch"].includes(L.hoehe)) w.hoehe = L.hoehe;
        if (FOTO_ARTEN.includes(L.foto_art)) w.fotoArt = L.foto_art;
        if (L.intro_s != null && isFinite(+L.intro_s)) w.introS = +L.intro_s;
        if (L.hold_s != null && isFinite(+L.hold_s)) w.holdS = +L.hold_s;
        if (L.titel_an === false) w.titelAn = false;
        if (L.logo_an === false) w.logoAn = false;
        if (["links", "mitte", "rechts"].includes(L.logo_lage)) w.logoLage = L.logo_lage;
        if (L.orte_an === false) w.orteAn = false;
        if (L.gipfel_titel === false) w.gipfelTitelAn = false;
        if (L.erdkugel) w.erdkugel = true;
        w.introFlug = VA_INTRO_FLUG.includes(L.intro_flug) ? L.intro_flug : (L.erdkugel ? "erdkugel" : "ueberblick");
        w.schlussFlug = VA_SCHLUSS_FLUG.includes(L.schluss_flug) ? L.schluss_flug : "gesamtsicht";
      } else w.uebersicht = false;
      // 26.10.2026 (Klicktest: ein 16:9-Projekt in 3840×2160 wurde beim Öffnen 9:16 in 1080 — das Format kam vom letzten
      // Schnell-Video) — Format und Auflösung des offenen Projekts bleiben, bis man sie im Reiter Kamera ändert
      if (!VORL) try {   // vorläufiges Projekt (frische Tour): das gemerkte Format
        const a_ = (window.rzReadModuleSettings && window.rzReadModuleSettings("animator")) || {};
        const bw = +a_.width, bh = +a_.height;
        if (bw > 0 && bh > 0) { const r = bw / bh; w.format = r > 1.2 ? "16:9" : r < 0.8 ? "9:16" : "1:1"; w.qualitaet = Math.max(bw, bh) >= 3000 ? "4k" : Math.max(bw, bh) >= 2400 ? "1440" : "1080";
          if (FPS_WAHL.includes(+a_.fps)) w.fps = +a_.fps; }
        if (!w.einheiten) w.einheiten = vaEinheitenAus(a_);
        if (a_.pace_mode === "real" || a_.pace_mode === "even") w.pace = a_.pace_mode;
      } catch (e) { if (window.rzSwallow) rzSwallow(e, "assistent:format"); }
    }
    // 07.10.2026 (Web-Version) — offizielle Parameter beim Aufruf (Web, Skripte): Fotoart, Größe des Sofortbilds,
    // Fotopause ohne Heranfahren. Der Dialog bleibt schlank (F-14: die Fotoart kommt sonst aus der Vorlage).
    if (ASS) vaStilWerte(w, w.stilId);
    // 03.11.2026 (Nutzer-Meldung: die Kommandozeile kannte nur die alten Schnell-Video-Vorlagen) — Videovorlage von außen
    // (Kommandozeile `--template wanderlust`, eigene ★ des Assistenten, .rzstyle): Einblendungen, Schilder, Linie wie im Assistenten
    if (!ASS && opts && opts.videovorlage && VA_STILE[opts.videovorlage]) vaStilWerte(w, opts.videovorlage);
    vaDrohneHalten(w);
    if (opts && FOTO_ARTEN.includes(opts.fotoArt)) w.fotoArt = opts.fotoArt;
    if (opts && FLUGSTILE[opts.flug]) w.flug = opts.flug;   // 14.10.2026 — Flugstil von außen (Kommandozeile, Web)
    if (opts && typeof opts.fotoKreisen === "boolean") w.fotoKreisen = opts.fotoKreisen;
    if (opts && opts.sofortGroesse != null) w.sofortGroesse = sofortGroesse(opts.sofortGroesse);
    if (opts && (opts.fotoPause === "stehen" || opts.fotoPause === "heran")) w.fotoPause = opts.fotoPause;
    const feldLabel = (f) => T("animator.statsfield." + f, f);
    // ── 12.10.2026 (Marc: „bau die Optik des Assistenten um … Bild, Grafiken,
    //    wo man richtig sehen muss, was passiert, kleine Videos. Das muss einfach zu verstehen sein, nicht überladen wirken,
    //    aber trotzdem all die Einstellmöglichkeiten bieten“) — eigener Rumpf für den Assistenten: je Schritt eine große Frage,
    //    Bildkarten statt Häkchenlisten, kurze Clips (ui/media/assistent, ui/media/kamera) und Grafiken aus der eigenen Tour
    //    (Linie, Höhenprofil, Zahlen, Titel). Feineres steckt in aufklappbaren „Details“. Die Bedienelemente tragen dieselben
    //    IDs wie im Schnell-Video — die Logik dahinter ist dieselbe. ──
    const sprache = (window.rzSprachCode ? window.rzSprachCode() : "de") || "de";
    const zahl = (x, st) => { try { return (+x).toLocaleString(sprache, { maximumFractionDigits: st == null ? 0 : st }); } catch (_) { return String(Math.round(+x)); } };
    const ruhig = (() => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (_) { return false; } })();
    /** Kurzer, stummer Endlos-Clip; bei „Bewegung reduzieren“ nur beim Darüberfahren. */
    const vaClip = (pfad, cls) => `<video class="va-clip${cls ? " " + cls : ""}" src="${(window.__rzAssetBase || "")}media/${pfad}"${ruhig ? "" : " autoplay"} loop muted playsinline preload="metadata" aria-hidden="true"></video>`;
    /** Die eigene Strecke als kleine Grafik (Linie, wahlweise ein Punkt an Stelle `bei` 0…1). */
    const routeSvg = (() => {
      const L = (Array.isArray(v.linie) ? v.linie : []).filter(p => Array.isArray(p) && isFinite(+p[0]) && isFinite(+p[1]));
      if (L.length < 2) return () => "";
      const schritt = Math.max(1, Math.floor(L.length / 180)), P_ = [];
      for (let i = 0; i < L.length; i += schritt) P_.push(L[i]);
      if (P_[P_.length - 1] !== L[L.length - 1]) P_.push(L[L.length - 1]);
      const lat0 = P_.reduce((s, p) => s + +p[1], 0) / P_.length, kx = Math.cos(lat0 * Math.PI / 180) || 1;
      const xs = P_.map(p => +p[0] * kx), ys = P_.map(p => -(+p[1]));
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const W_ = 160, H_ = 100, R_ = 12, s = Math.min((W_ - 2 * R_) / ((x1 - x0) || 1e-9), (H_ - 2 * R_) / ((y1 - y0) || 1e-9));
      const ox = (W_ - (x1 - x0) * s) / 2, oy = (H_ - (y1 - y0) * s) / 2;
      const pr = (p) => [ox + (+p[0] * kx - x0) * s, oy + (-(+p[1]) - y0) * s];
      const d = P_.map((p, i) => { const [x, y] = pr(p); return (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1); }).join("");
      const [ax, ay] = pr(P_[0]), [ex, ey] = pr(P_[P_.length - 1]);
      return (opt) => {
        const o = opt || {};
        let punkt = "";
        if (o.bei != null && isFinite(+o.bei)) { const [px, py] = pr(L[Math.max(0, Math.min(L.length - 1, Math.round(+o.bei * (L.length - 1))))]); punkt = `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="5" class="va-r-punkt"/>`; }
        return `<svg class="va-route" viewBox="0 0 ${W_} ${H_}" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><path d="${d}" class="va-r-schatten"/><path d="${d}" class="va-r-linie"/>`
          + `<circle cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="3" class="va-r-start"/><circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="3" class="va-r-ziel"/>${punkt}</svg>`;
      };
    })();
    /** Höhenprofil der Tour als Fläche. */
    const profilSvg = () => {
      const h = (Array.isArray(v.profil) ? v.profil : []).map(Number).filter(isFinite);
      if (h.length < 2) return "";
      const lo = Math.min(...h), hi = Math.max(...h), sp = (hi - lo) || 1;
      const pk = h.map((e, i) => `${(8 + i * 148 / (h.length - 1)).toFixed(1)} ${(88 - (e - lo) / sp * 64).toFixed(1)}`);
      return `<svg class="va-profil" viewBox="0 0 160 100" preserveAspectRatio="none" aria-hidden="true"><path d="M${pk[0]} L${pk.join(" L")} L156 92 L8 92 Z" class="va-p-flaeche"/>`
        + `<path d="M${pk.join(" L")}" class="va-p-linie"/></svg><span class="va-p-hi">${zahl(hi)} m</span><span class="va-p-lo">${zahl(lo)} m</span>`;
    };
    const km = isFinite(+v.distance_km) ? zahl(+v.distance_km, 1) + " km" : "";
    const aufM = v.zahlen && isFinite(+v.zahlen.aufstieg_m) ? zahl(+v.zahlen.aufstieg_m) + " m" : "";
    const hoechst = v.zahlen && isFinite(+v.zahlen.ele_max) ? zahl(+v.zahlen.ele_max) + " m" : "";
    /** 12.10.2026 (Marc: „Die besonderen Momente gehören eigentlich zu den Momenten, die man zeigen möchte … nicht zu den
     *  Overlays“) — die Höhepunkte der Strecke einzeln, Arten wie im Animator (highlights_arten), mit Stelle 0…1 und Wert. */
    const HL_ARTEN = ["hoechster", "steilste", "schnellste", "halbe"];
    const hlListe = (() => {
      let fertig = null;
      return () => {
        if (fertig) return fertig;
        const p_ = (art) => (v.pois || []).find(x => x && x.art === art && isFinite(+x.bei));
        const raus = [];
        const h = p_("hoechster"), hw = h ? +(h.ele != null ? h.ele : h.wert) : NaN;
        if (h) raus.push({ art: "hoechster", bei: +h.bei, ic: "mountain", wert: isFinite(hw) ? zahl(hw) + " m" : "" });
        const st = p_("steilster"); if (st) raus.push({ art: "steilste", bei: +st.bei, ic: "trending-up", wert: isFinite(+st.wert) ? zahl(+st.wert) + " %" : "" });
        const sc = p_("schnellster"); if (sc) raus.push({ art: "schnellste", bei: +sc.bei, ic: "gauge", wert: isFinite(+sc.wert) ? zahl(+sc.wert) + " km/h" : "" });
        // halbe Strecke: Stelle über die Distanz entlang der Linie
        const L = (Array.isArray(v.linie) ? v.linie : []).filter(q => Array.isArray(q) && isFinite(+q[0]) && isFinite(+q[1]));
        if (L.length > 2) {
          const hav = (a, b) => { const R = 6371, r_ = Math.PI / 180, dLa = (b[1] - a[1]) * r_, dLo = (b[0] - a[0]) * r_;
            const x = Math.sin(dLa / 2) ** 2 + Math.cos(a[1] * r_) * Math.cos(b[1] * r_) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.min(1, Math.sqrt(x))); };
          const cum = [0]; for (let i = 1; i < L.length; i++) cum.push(cum[i - 1] + hav(L[i - 1], L[i]));
          const ges = cum[cum.length - 1];
          if (ges > 0.2) { const i = cum.findIndex(c => c >= ges / 2); raus.push({ art: "halbe", bei: i / (L.length - 1), ic: "flag", wert: zahl((+v.distance_km || ges) / 2, 1) + " km" }); }
        }
        // Werte und Abstand aus der Rechnung des Animators — dieselben wie die Schilder im Video (Rand 3 %, Median-Höhe);
        // die Stelle bleibt die der Strecke (gleiche Grundlage wie die Logbuch-Momente). Was der Animator nicht setzt, fällt weg.
        let anim = null;
        try { anim = window.__rzHlVorschau ? window.__rzHlVorschau(HL_ARTEN) : null; } catch (e) { if (window.rzSwallow) rzSwallow(e, "assistent:hl"); }
        if (Array.isArray(anim) && anim.length) {
          const A = new Map(anim.map(h => [h.art, h]));
          const gemischt = raus.filter(h => A.has(h.art)).map(h => ({ ...h, wert: A.get(h.art).wert || h.wert, f: isFinite(+A.get(h.art).f) ? +A.get(h.art).f : h.bei }));
          fertig = gemischt.sort((a, b) => a.bei - b.bei);
          return fertig;
        }
        return raus.sort((a, b) => a.bei - b.bei);
      };
    })();
    if (ASS && w.hlArten == null) w.hlArten = new Set(w.highlights ? HL_ARTEN : []);
    const kopf = (h, sub) => `<h2 class="va-h">${esc(h)}${sub ? q(sub) : ""}</h2>`;
    /** Bildkarte: Bild/Clip oben, Häkchen bei Auswahl, Titel + eine Zeile. */
    const karte = (attr, bild, titel, text, an, tip) => `<button type="button" class="va-bk${an ? " is-on" : ""}" ${attr}${(tip || text) ? ` title="${esc(tip || text)}"` : ""}>`
      + `<span class="va-bk-bild">${bild}<span class="va-haken">${I("check", 13)}</span></span><b>${esc(titel)}</b></button>`;
    /** Gleich breite Wahlknöpfe (Format, Länge, Dauer …) — `attr` = data-Attribut der Gruppe. */
    const wahl = (huelle, attr, items, aktiv) => `<div class="va-wahl" ${huelle}>` + items.map(([wert, ic, l, sub]) =>
      `<button type="button" class="sv-wahl${wert === aktiv ? " is-on" : ""}" ${attr}="${esc(wert)}">${ic ? I(ic, 15) : ""}<span>${esc(l)}${sub ? `<small>${esc(sub)}</small>` : ""}</span></button>`).join("") + `</div>`;
    // 26.10.2026 — „?“ wie im Web: Hilfetext + kurze Clips (HILFE_CLIPS), aufgeklappt unter der Einstellung
    // 26.10.2026 (Marc beim Klicktest: „da ist zu viel Blabla-Text. mach sowas immer als ? Tooltip, wie an vielen anderen
    // Stellen auch“) — Erklärungen stehen nur noch hinter einem „?“ (rz-q: Tooltip beim Überfahren, util.js). Hat die
    // Einstellung Clips, klappt ein Klick aufs „?“ sie zusätzlich auf.
    const hilfeKnopf = (k) => k ? `<button type="button" class="rz-q va-hilfe-knopf" data-va-hilfe="${k}" data-tip="${esc(T("va.w.hilfe_" + k, ""))}" aria-expanded="false">?</button>` : "";
    const hilfeBox = (k) => k && HILFE_CLIPS[k] ? `<div class="va-hilfe" data-va-hilfe-box="${k}" hidden></div>` : "";
    /** „?“ mit Tooltip; leer = unsichtbar (wechselnde Hinweise setzen den Text später, siehe vaTipSpiegel). */
    const q = (text, id) => `<span class="rz-q va-q" tabindex="0"${id ? ` id="${id}"` : ""} data-tip="${esc(text || "")}"${text ? "" : " hidden"}>?</span>`;
    const schalter = (id, an_, titel, text, hk) => `<label class="va-schalter-zeile"><span class="va-sz-text"><b>${esc(titel)}${hk ? hilfeKnopf(hk) : (text ? q(text) : "")}</b></span>`
      + `<input type="checkbox" class="va-schalter" id="${id}"${an_ ? " checked" : ""}></label>${hilfeBox(hk)}`;
    // 01.11.2026 (Marc: „oben nur das Wesentliche, weiter unten die Detaileinstellungen, so dass man oben quasi ein
    // Schnellvideo hat“ — Q1 a) — je Reiter ein aufklappbares „Mehr Einstellungen“; offen/zu je Reiter gemerkt
    const mehrOffen = (n) => { try { return localStorage.getItem("rz_va_mehr_" + n) === "1"; } catch (_) { return false; } };
    const mehrAuf = (n) => `<details class="va-details va-mehr" data-va-mehr="${n}"${mehrOffen(n) ? " open" : ""}><summary>${I("sliders-horizontal", 15)}<span>${esc(T("va.mehr_einstellungen", "Mehr Einstellungen"))}</span><span class="va-details-n"></span></summary><div class="va-details-inhalt">`;
    const mehrZu = `</div></details>`;
    const details = (titel, inhalt, id, offen) => `<details class="va-details"${id ? ` id="${id}"` : ""}${offen ? " open" : ""}><summary>${I("chevron-down", 15)}<span>${esc(titel)}</span><span class="va-details-n"></span></summary><div class="va-details-inhalt">${inhalt}</div></details>`;
    const feldKopf = (ic, text, rechts, hk) => `<div class="va-feld-kopf">${ic ? I(ic, 16) : ""}<span>${esc(text)}</span>${hilfeKnopf(hk)}${rechts || ""}</div>${hilfeBox(hk)}`;
    /** Grafik „wie viel Text“: die eigene Linie, dein Titel, bei mehr Text ein Foto mit Unterschrift. */
    const textBild = (menge) => {
      const f0 = (w.fotos || []).find(f => f.thumb);
      const foto = menge === "wenige" ? "" : `<span class="va-gb-foto">${f0 ? `<img src="${f0.thumb}" alt="">` : I("image", 16)}</span>`
        + `<span class="va-gb-cap">${I("map-pin", 9)} ${esc(T("va.gb_ort", "Ort"))} · 10:42${menge === "viele" ? `<br>f/2.8 · 1/500 s` : ""}</span>`;
      // beim Aufbau gibt es das Fenster noch nicht — danach gelten die Eingabefelder
      try { w.titel = box.querySelector("#sv-titel")?.value ?? w.titel; w.unter = box.querySelector("#sv-unter")?.value ?? w.unter; } catch (_) {}
      return `<span class="va-gb va-gb-text">${routeSvg()}${menge === "viele" ? `<span class="va-gb-kapitel">${esc(T("va.g_tag", "Tag {n}", { n: 2 }))}</span>` : ""}${foto}`
        + `<span class="va-gb-titel"><b class="va-gb-t1">${esc(w.titel || v.name || "")}</b>${menge === "wenige" ? "" : `<small class="va-gb-t2">${esc(w.unter || "")}</small>`}</span></span>`;
    };
    const MUSIK = [["unterwegs", "Unterwegs (eingebaut)"], ["weite", "Weite — ruhig, filmisch"], ["gipfelsturm", "Gipfelsturm — treibend"],
      ["rast", "Rast — Lo-Fi, entspannt"], ["grat", "Grat — episch"], ["wanderlied", "Wanderlied — Folk, Gitarre"],
      ["panorama", "Panorama — weite Flächen, Piano"], ["tagebuch", "Tagebuch — gezupft, warm"], ["puls", "Puls — sportlich, elektronisch"]];
    const LOOK_KURZ = { natuerlich: T("va.lk_natuerlich", "Realistisches Luftbild"), reiseatlas: T("va.lk_reiseatlas", "Illustrierte Papierkarte"),
      nachtkarte: T("va.lk_nachtkarte", "Dunkel und reduziert"), minimal: T("va.lk_minimal", "Klar und aufgeräumt"), schatzkarte: T("va.lk_schatzkarte", "Pergament und Tinte"),
      topo: T("va.lk_topo", "Höhenlinien und Gelände"), seekarte: T("va.lk_seekarte", "Wasser in Tiefenstufen"), pastell: T("va.lk_pastell", "Sanfte Farben") };
    // 26.10.2026 (Marc: „baue den Assistenten so, wie es im Web ist … auch mit den Erklärvideos“) — acht Reiter wie die
    // Web-Version: Route · Kamera · Karte · Linie · Titel · Fotos · Infos · Video. Jeder Reiter ist jederzeit anklickbar,
    // alles ist vorbelegt; hinter dem „?“ stehen kurze Erklärclips (ui/media/hilfe, aus der Web-Version). Was es nur in der
    // App gibt (Momente aus dem Logbuch, Halte, Textmenge, Musik, eigene Vorlagen), sitzt im passenden Reiter.
    const vaLookLinie = () => { const L_ = window.rzLooks && window.rzLooks.LOOKS[w.look || (VORLAGEN[w.vorlage] || VORLAGEN.weite).look]; return (L_ && L_.linie) || { line_color: "#48d6c4", line_width: 3.5, kontur_breite: 1.5, glow_strength: 0 }; };
    const vaRumpf = () => `<div class="sv-dialog va-rumpf">
      <div class="sv-vorschau" id="sv-vorschau" hidden><div class="sv-vk" id="sv-vk"><div class="sv-vk-karte" id="sv-vk-karte"></div><div class="sv-vk-titel" id="sv-vk-titel"></div><div class="sv-vk-zahlen" id="sv-vk-zahlen" hidden></div><div class="sv-vk-profil" id="sv-vk-profil" hidden></div></div></div>
      <div class="va-kopf" id="va-kopf"></div>

      <section data-va="1">
        <!-- 01.11.2026 (Marc: „Mach doch einen Punkt 1, wo die Videolänge angegeben wird und das Format und auch Intro und Outro
             oder Hold, wie lang diese Szenen sein sollen“) — ersetzt die Seite „Route“ (zeigte nur die Strecke) -->
        ${kopf(T("va.fl_h", "Format und Länge"), T("va.fl_sub", "Das Format des Videos, seine Gesamtlänge und wie lange Anfang und Schluss stehen."))}
        ${feldKopf("monitor", T("schnell.format", "Format"), "", "format")}
        ${wahl('data-sv-gruppe="format"', "data-sv-wert", [["16:9", "monitor", T("va.w.f_quer", "16:9 quer")], ["9:16", "smartphone", T("va.w.f_hoch", "9:16 hochkant")], ["1:1", "square", T("va.w.f_quadrat", "1:1")]], w.format)}
        ${feldKopf("clock", T("schnell.laenge", "Länge"), "", "laenge")}
        ${wahl('data-sv-gruppe="laenge"', "data-sv-wert", [["kurz", "", T("schnell.kurz", "Kurz"), "20 s"], ["normal", "", T("schnell.normal", "Normal"), "40 s"], ["lang", "", T("schnell.lang", "Lang"), "60 s"], ["eigen", "", T("va.eigen", "Eigene"), "…"]]
          .concat(w.animatorS > 0 ? [["animator", "", T("va.wie_animator", "Wie im Animator"), Math.round(w.animatorS) + " s"]] : []), w.laenge)}
        <div class="sv-eigen-zeile" id="sv-eigen-zeile"${w.laenge === "eigen" ? "" : " hidden"}><input type="number" id="sv-eigen" class="lib-input" min="${LAENGE_MIN}" max="${LAENGE_MAX}" step="5" value="${w.eigenS}"> <span class="muted">${esc(T("schnell.eigen_laenge_s", "Sekunden ({min}–{max})", { min: LAENGE_MIN, max: LAENGE_MAX }))}</span></div>
${mehrAuf(1)}
        ${feldKopf("route", T("animator.field.pace_mode", "Verteilung über den Track"), q(T("animator.pace_mode.hint", "")))}
        ${wahl('data-va-pace', "data-va-pace-w", [["even", "", T("animator.pace.even", "Gleichmäßig")]].concat(vaHatZeit(v) ? [["real", "", T("animator.pace.real", "Echtes Tempo")]] : []), w.pace === "real" && vaHatZeit(v) ? "real" : "even")}
        ${feldKopf("monitor", T("va.aufloesung", "Auflösung"), `<span class="va-ausgabe" id="va-ausgabe"></span>`)}
        ${wahl('data-va-aufl', "data-va-aufl-w", [["1080", "", "1080p"], ["1440", "", "1440p"], ["4k", "", "4K"]], w.qualitaet)}
        ${feldKopf("gauge", T("va.bildrate", "Bildrate"))}
        ${wahl('data-va-fps', "data-va-fps-w", FPS_WAHL.map(x => [String(x), "", x + " fps"]), String(w.fps || FPS))}
        ${feldKopf("ruler", T("va.einheiten", "Einheiten"))}
        ${wahl('data-va-einheit', "data-va-einheit-w", [["metrisch", "", T("va.einheit_metrisch", "Metrisch"), "km · m · km/h"], ["imperial", "", T("va.einheit_imperial", "Imperial"), "mi · ft · mph"], ["nautisch", "", T("va.einheit_nautisch", "Nautisch"), "sm · m · kn"]], w.einheiten || "metrisch")}
        ${feldKopf("film", T("va.intro", "Intro"), q(T("va.intro_tip", "Der Anfang: die ganze Tour im Überblick mit dem Titel, bevor die Fahrt beginnt. Er zählt zur Gesamtlänge.")))}
        ${wahl('data-va-intro', "data-va-intro-s", VA_INTRO.map(([k, x]) => [k, "", T("va.d_" + k, { keins: "Keins", kurz: "Kurz", normal: "Normal", lang: "Lang", eigen: "Eigene" }[k]), vaDauerText(k, x)]), vaDauerWahl(w.introS, VA_INTRO))}
        <div class="sv-eigen-zeile" id="va-intro-eigen-zeile"${vaDauerWahl(w.introS, VA_INTRO) === "eigen" ? "" : " hidden"}><input type="number" id="va-intro-eigen" class="lib-input" min="0" max="${DAUER_MAX}" step="0.5" value="${w.introS != null ? w.introS : INTRO_S}"> <span class="muted">${esc(T("va.sekunden", "Sekunden"))}</span></div>
        ${feldKopf("milestone", T("va.schluss_dauer", "Schluss"), q(T("va.schluss_dauer_tip", "Das Ende: die Kamera zieht sich in die Gesamtsicht zurück, die Schlusskarte steht. Er zählt zur Gesamtlänge.")))}
        ${wahl('data-va-hold', "data-va-hold-s", VA_HOLD.map(([k, x]) => [k, "", T("va.d_" + k, { keins: "Keins", kurz: "Kurz", normal: "Normal", lang: "Lang", eigen: "Eigene" }[k]), vaDauerText(k, x)]), vaDauerWahl(w.holdS, VA_HOLD))}
        <div class="sv-eigen-zeile" id="va-hold-eigen-zeile"${vaDauerWahl(w.holdS, VA_HOLD) === "eigen" ? "" : " hidden"}><input type="number" id="va-hold-eigen" class="lib-input" min="0" max="${DAUER_MAX}" step="0.5" value="${w.holdS != null ? w.holdS : HOLD_S}"> <span class="muted">${esc(T("va.sekunden", "Sekunden"))}</span></div>
        <div class="muted sv-vl-stand" id="sv-vl-stand" hidden></div>
        <div class="sv-vorlagen" id="sv-vorlagen" hidden>${VORLAGE_NAMEN.map(n => `<button type="button" class="sv-vorlage${n === w.vorlage ? " is-on" : ""}" data-sv-vorlage="${n}"></button>`).join("")}</div>
        ${mehrZu}
      </section>

      <section data-va="9">
        <!-- 01.11.2026 (Marc: „nach Format einen Reiter Stil … verschiedene Vorlagen“) -->
        ${kopf(T("va.stil_h", "Wie soll es aussehen?"), T("va.stil_sub", "Eine Vorlage setzt Schriften, Einblendungen, Schilder, Bergnamen, Laufpunkt und Linie auf einmal. Danach kannst du alles einzeln ändern."))}
        <div class="va-karten va-karten-2 va-stile" id="va-stile">${VA_STIL_NAMEN.map(k => vaStilKarte(k, k === w.stilId)).join("")}</div>
        <!-- 02.11.2026 (Marc: Vorlagen vom Desktop ins iPhone übernehmen) — gewählten Stil als .rzstyle speichern / Dateien einlesen -->
        <div class="va-rzstyle">
          <button type="button" class="btn btn-small" data-va-rzstyle="export" title="${esc(T("rzstyle.export_tip", "Stil exportieren … — eine Videovorlage als .rzstyle-Datei speichern (z. B. für die iPhone-App)"))}"${VA_STILE[w.stilId] && (VA_STILE[w.stilId].vv || VA_STILE[w.stilId].eigen) ? "" : " disabled"}>${I("upload", 13)} ${esc(T("rzstyle.export", "Stil exportieren …"))}</button>
          <button type="button" class="btn btn-small" data-va-rzstyle="import" title="${esc(T("rzstyle.import_tip", "Stil importieren … — .rzstyle-Dateien als eigene Videovorlagen übernehmen"))}">${I("download", 13)} ${esc(T("rzstyle.import", "Stil importieren …"))}</button>
        </div>
      </section>

      <section data-va="2">
        ${kopf(T("va.w.s8_kamera_h", "Wie fliegt die Kamera?"), T("va.kamera_erkl2", "Wie die Kamera fliegt und wie hoch."))}
        ${feldKopf("video", T("va.l_kamera", "Kamera"), "", "kamera")}
        <div class="va-karten va-karten-3" id="va-kamera">
          ${karte('data-va-kamera="fahrt"', kamClip("fahrt"), T("va.w.k_mitfliegen", "Mitfliegen"), T("va.k_mitfliegen_k", "Hinter dem Laufpunkt her, mit Überblick und Schlussblick"), w.kamera === "fahrt")}
          ${karte('data-va-kamera="folgen"', kamClip("folgen"), T("va.w.k_folgen_nord", "Folgen (genordet)"), T("va.k_folgen_nord_k", "Über dem Laufpunkt, Norden bleibt oben"), w.kamera === "folgen")}
          ${karte('data-va-kamera="fest"', kamClip("fest"), T("va.w.k_ganze_tour", "Ganze Tour"), T("va.k_fest_k", "Die ganze Route im Blick"), w.kamera === "fest")}
        </div>
        <div id="va-k-fahrt"${w.kamera === "fahrt" ? "" : " hidden"}>
          ${feldKopf("plane", T("va.flugstil", "Flugstil"), q(T("va.flugstil_tip", "Wie die Kamera hinter dir herfliegt. Beim Darüberfahren zeigt jede Karte einen kurzen Clip; die Höhe darunter wirkt bei allen.")))}
          <div class="va-karten va-karten-2 va-flug" id="va-flug">${VA_FLUGSTILE.map(k => `<button type="button" class="va-bk${k === w.flug ? " is-on" : ""}" data-va-flug="${k}">`
            + `<span class="va-bk-bild"><video class="va-k-clip va-clip-hover" src="${(window.__rzAssetBase || "")}media/kamera/flug_${k}.mp4" loop muted playsinline preload="auto" aria-hidden="true"></video><span class="va-haken">${I("check", 13)}</span></span>`
            + `<b>${esc(T("schnell.flug." + k, FLUGSTIL_TEXT[k][0]))}</b><ul class="va-flug-punkte">${VA_FLUG_PUNKTE[k].map((x, i) => `<li>${esc(T("va.flug." + k + "_" + (i + 1), x))}</li>`).join("")}</ul></button>`).join("")}</div>
        </div>
        ${mehrAuf(2)}
        <div id="va-hoehe-feld">
          ${feldKopf("mountain", T("va.w.hoehe", "Höhe"), "", "hoehe")}
          ${wahl('id="va-hoehe"', "data-va-hoehe", [["nah", "", T("va.w.h_nah", "Nah")], ["mittel", "", T("va.w.h_mittel", "Mittel")], ["hoch", "", T("va.w.h_hoch", "Hoch")]], w.hoehe)}
        </div>
        ${feldKopf("plane-takeoff", T("va.intro_flug", "Anfang"), q(T("va.intro_flug_tip", "Wie das Video beginnt, bevor die Fahrt losgeht. Braucht ein Intro (Reiter Format).")))}
        <div class="va-karten va-karten-3" id="va-intro-flug">${VA_INTRO_FLUG.map(k => karte(`data-va-intro-flug="${k}"`, kamClip("anfang_" + k, "va-clip-hover"),
          T("va.if_" + k, { ueberblick: "Überblick", erdkugel: "Von der Erdkugel", seite: "Von der Seite" }[k]),
          T("va.if_" + k + "_k", { ueberblick: "Die ganze Tour von oben, dann hinein", erdkugel: "Die ganze Erde, dann ruhig hinunter", seite: "Schräger Anflug über die Landschaft" }[k]),
          (w.introFlug || "ueberblick") === k)).join("")}</div>
        ${feldKopf("flag", T("va.schluss_flug", "Schluss"), q(T("va.schluss_flug_tip", "Was die Kamera am Ziel macht. Braucht eine Schlusszeit (Reiter Format).")))}
        <div class="va-karten va-karten-2" id="va-schluss-flug">${VA_SCHLUSS_FLUG.map(k => karte(`data-va-schluss-flug="${k}"`, kamClip("schluss_" + k, "va-clip-hover"),
          T("va.sf_" + k, { gesamtsicht: "Zurück in die Gesamtsicht", hoch: "Abflug nach oben", kreisen: "Einmal ums Ziel kreisen", stehen: "Am Ziel stehen bleiben" }[k]),
          T("va.sf_" + k + "_k", { gesamtsicht: "Die Kamera zieht sich zurück, die ganze Tour im Bild", hoch: "Steigt senkrecht auf bis zur Draufsicht auf die Tour", kreisen: "Eine ruhige Runde um den Zielpunkt", stehen: "Die Kamera bleibt beim Ziel, nur etwas weiter weg" }[k]),
          (w.schlussFlug || "gesamtsicht") === k)).join("")}</div>
        ${mehrZu}
      </section>

      <section data-va="3">
        ${kopf(T("va.w.s8_look_h", "Welche Karte?"), T("va.w.s8_look_erkl", "Kartenstil, Gelände und Beschriftung — die Vorschau zeigt es sofort."))}
        ${feldKopf("map", T("va.l_karte", "Karte"), "", "kartenlook")}
        <div class="va-karten va-karten-4 va-looks" id="va-looks">${(window.rzLooks ? window.rzLooks.NAMEN : []).map(n =>
          karte(`data-va-look="${n}"`, `<img class="va-look-bild" src="${(window.__rzAssetBase || "")}media/assistent/look_${n}.jpg" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'va-look-bild rz-look-bild rz-look-${n}'}))">`,
            T("look." + n, n), LOOK_KURZ[n] || "", n === w.look, T("look." + n + ".tip", ""))).join("")}</div>
        <button type="button" class="va-link" data-va-mehr-looks>${esc(T("va.mehr_looks", "Weitere Kartenstile im Animator"))} ${I("arrow-right", 14)}</button>
        ${mehrAuf(3)}
        ${schalter("va-gelaende", false, T("va.w.gelaende", "3D-Gelände"), "", "gelaende")}
        ${schalter("va-bergnamen", true, T("va.bergnamen", "Bergnamen"), T("va.bergnamen_k", "Namen und Höhen der Gipfel im Bild, ohne Kasten"))}
        ${schalter("va-beschr", false, T("va.w.beschriftung", "Beschriftung"), "", "beschriftung")}
        ${details(T("va.w.beschr_mehr", "mehr"), `<div class="va-chips">${VA_BESCHR.map(k => `<label class="va-chip"><input type="checkbox" data-va-beschr="${k}"><span>${I("check", 13)}${esc(T("va.w.beschr_" + k, k))}</span></label>`).join("")}</div>`, "va-beschr-mehr")}
        ${schalter("sv-gebaeude", !!w.gebaeude, T("va.gebaeude", "3D-Häuser in Orten"), T("va.gebaeude_k", "Gebäude wachsen beim Heranfliegen aus der Karte."))}
        ${mehrZu}
      </section>

      <section data-va="4">
        ${kopf(T("va.w.s8_linie_h", "Wie sieht die Strecke aus?"), T("va.w.s8_linie_erkl", "Farbe und Stil der Linie und was über die Strecke läuft."))}
        ${feldKopf("navigation", T("va.laufpunkt", "Laufpunkt"), "", "laufpunkt")}
        ${wahl('id="va-lp"', "data-va-lp", [["k:kometpfeil", "sparkles", T("animator.kopf3d.kometpfeil", "Komet-Pfeil")], ["k:komet", "sparkles", T("animator.kopf3d.komet", "Komet")],
          ["k:pfeil", "", T("animator.kopf3d.pfeil", "3D-Pfeil")], ["k:puk", "", T("animator.kopf3d.puk", "3D-Puk")], ["arrow", "navigation", T("va.w.lp_pfeil", "Pfeil")], ["dot", "", T("va.w.lp_kugel", "Kugel")], ["leucht", "", T("va.lp_leucht", "Leuchtpunkt")], ["fahrzeug", "car", T("va.w.lp_fahrzeug", "Fahrzeug")], ["aus", "x", T("va.w.lp_aus", "Aus")]], w.lp)}
        <div class="va-lp-fz" id="va-lp-fz-zeile" hidden><select id="va-lp-fz" class="lib-select"></select></div>
        <!-- 06.11.2026 — Röhre + Nachglühen -->
        ${feldKopf("sparkles", T("va.r3_darstellung", "Darstellung"), q(T("va.r3_tip", "3D-Röhre: der Track schwebt als leuchtende Röhre knapp über dem Gelände, vorne läuft ein Komet. Geht nur mit den freien Karten — mit Mapbox wird die Linie flach gezeichnet.")))}
        ${wahl('id="va-r3"', "data-va-r3", [["flach", "", T("animator.linie3d.flach", "Flach")], ["roehre", "", T("animator.linie3d.roehre", "3D-Röhre")]], "")}
        ${schalter("va-glut", false, T("animator.nachgluehen", "Nachglühen"), T("va.glut_tip", "Die frisch gelaufene Strecke glüht hinter dem Laufpunkt kurz nach und kühlt dann zur Linienfarbe ab."))}
        ${mehrAuf(4)}
        <div id="va-r3-mehr">
        <!-- 08.11.2026 — der Kopf (Komet …) steht jetzt vorn in der Laufpunkt-Wahl -->
        <div class="va-regler-zeile"><span>${esc(T("animator.roehre.glanz", "Glanz"))}</span><input type="range" class="va-regler" id="va-r3-glanz" min="0" max="1" step="0.05" value="0.35"><span class="va-regler-wert" id="va-r3-glanz-v"></span></div>
        </div>
        <div id="va-glut-mehr">
        ${feldKopf("", T("animator.glut_look", "Glut-Farbe"))}
        ${wahl('id="va-glut-look"', "data-va-glut-look", [["linie", "", T("animator.glut_look.linie", "Aus der Linienfarbe")], ["koralle", "", T("animator.glut_look.koralle", "Koralle")], ["warmkalt", "", T("animator.glut_look.warmkalt", "Warm zu Kühl")], ["pink", "", T("animator.glut_look.pink", "Pink, Violett, Blau")]], "")}
        <div class="va-regler-zeile"><span>${esc(T("animator.nachgluehen", "Nachglühen"))}</span><input type="range" class="va-regler" id="va-glut-sek" min="0.5" max="5" step="0.25" value="1.5"><span class="va-regler-wert" id="va-glut-sek-v"></span></div>
        </div>
        ${feldKopf("route", T("va.w.linie_aussehen", "Linie"), `<button type="button" class="va-link va-link-klein" id="va-ls-zurueck">${esc(T("va.w.linie_zurueck", "↺ Wie die Karte"))}</button>`, "linie_aussehen")}
        <div class="va-farben" id="va-ls-farben"></div>
        ${wahl('id="va-ls-strich"', "data-va-strich", [["solid", "", T("animator.line_style.solid", "Durchgezogen")], ["dashed", "", T("animator.line_style.dashed", "Gestrichelt")], ["dotted", "", T("animator.line_style.dotted", "Gepunktet")], ["dashdot", "", T("animator.line_style.dashdot", "Strich-Punkt")]], "")}
        <div class="va-regler-zeile"><span>${esc(T("va.w.linie_breite", "Breite"))}</span><input type="range" class="va-regler" id="va-ls-breite" min="1" max="12" step="0.5" value="${vaLookLinie().line_width}"><span class="va-regler-wert" id="va-ls-breite-v"></span></div>
        ${details(T("va.w.linie_effekte", "Effekte"), schalter("va-ls-kontur", false, T("va.w.linie_kontur", "Kontur"))
          + schalter("va-ls-schatten", false, T("va.w.linie_schatten", "Schlagschatten")) + schalter("va-ls-leuchten", false, T("va.w.linie_leuchten", "Leuchten")), "va-ls-effekte")}
        ${schalter("va-ghost", true, T("va.w.ghost", "Strecke vorab zeigen"), "", "ghost")}
        ${mehrZu}
      </section>

      <section data-va="5">
        ${kopf(T("va.w.s8_titel_h", "Was steht am Anfang?"), T("va.w.s8_titel_erkl", "Titel und Unterzeile erscheinen am Anfang des Videos."))}
        ${feldKopf("type", T("schnell.titel", "Titel"), `<input type="checkbox" class="va-schalter" id="va-titel-an"${w.titelAn !== false ? " checked" : ""} title="${esc(T("va.titel_an_tip", "Titel am Anfang an oder aus"))}">`, "titel")}
        <div id="va-titel-teil"${w.titelAn !== false ? "" : " hidden"}>
        <input type="text" id="sv-titel" class="lib-input va-eingabe" value="${esc(w.titel)}" aria-label="${esc(T("schnell.titel", "Titel"))}">
        <div class="sv-titel-vorschlaege" id="sv-titel-vorschl"></div>
        <label class="va-feld-kopf" for="sv-unter"><span>${esc(T("va.untertitel", "Untertitel"))}</span></label>
        <input type="text" id="sv-unter" class="lib-input va-eingabe" value="${esc(w.unter)}">
        </div>
        ${mehrAuf(5)}
        ${feldKopf("", T("va.t_menge_frage", "Wie viel Text möchtest du?"), q("", "va-t-erkl-q"))}
        ${wahl('id="va-t-menge"', "data-va-t-menge", [["wenige", "", T("va.t_wenig_g", "Wenig"), T("va.t_wenig_k", "Nur der Titel")], ["normal", "", T("va.t_ausgewogen_g", "Ausgewogen"), T("va.t_ausgewogen_k2", "Mit Bildunterschriften")], ["viele", "", T("va.t_mehr_g", "Mehr"), T("va.t_mehr_k2", "Auch Kapitel")]], w.textMenge || "normal")}
        <span id="va-t-erkl" hidden></span>
        ${mehrZu}
      </section>

      <section data-va="6" class="sv-zutat" data-sv-zutat="fotos">
        ${kopf(T("va.w.s8_fotos_h", "Fotos von unterwegs"), T("va.w.s8_fotos_erkl", "Fotos mit Ort oder Uhrzeit landen an der richtigen Stelle der Strecke."))}
        <div class="sv-zutat-teil"><div class="sv-fotos va-fotos" id="sv-fotos"><span class="muted">${esc(T("schnell.fotos_suchen", "Fotos dieser Tour werden gesucht …"))}</span></div></div>
        <div class="va-zeile-info"><span id="va-f-lead"></span>
          <label class="va-schalter-mini" title="${esc(T("va.f_an_tip", "Fotos im Video zeigen"))}"><span>${esc(T("va.f_an", "Fotos im Video"))}</span><input type="checkbox" class="va-schalter" id="sv-fotos-an"${w.fotosAn ? " checked" : ""}></label>${hilfeKnopf("fotos_an")}</div>
        ${hilfeBox("fotos_an")}
        <div class="va-knoepfe">
          <button type="button" class="va-knopf" data-sv-alle title="${esc(T("schnell.alle_tip", "Alle Fotos und Videos dieser Tour ansehen und selbst auswählen"))}">${I("images", 16)}<span>${esc(T("va.f_alle", "Alle Medien"))}<span class="sv-alle-n"></span></span></button>
          <button type="button" class="va-knopf" data-sv-plus="dateien" title="${esc(T("schnell.fotos_plus_tip", "Eigene Fotos dazunehmen — sie werden der Strecke zugeordnet (GPS, sonst Aufnahmezeit)"))}">${I("plus", 16)}<span>${esc(T("va.f_plus", "Fotos dazu"))}</span></button>
          <button type="button" class="va-knopf" data-sv-plus="ordner" title="${esc(T("schnell.fotos_plus_tip", "Eigene Fotos dazunehmen — sie werden der Strecke zugeordnet (GPS, sonst Aufnahmezeit)"))}">${I("folder-plus", 16)}<span>${esc(T("va.f_ordner", "Ordner"))}</span></button>
        </div>
        <div class="sv-alle" id="sv-alle" hidden></div>
        <span class="sv-fotos-info" id="sv-fotos-info" hidden></span>
        <div class="sv-zutat-teil">
          ${feldKopf("images", T("va.f_anzahl", "Anzahl Fotos im Video"), q("", "sv-fotos-info-q"))}
          ${wahl('id="va-f-mengen"', "data-va-f-menge", [["0.1", "", T("va.f_wenige", "Wenige")], ["0.5", "", T("va.f_ausgewogen", "Ausgewogen")], ["0.9", "", T("va.f_viele", "Viele")]], "")}
        </div>
        ${mehrAuf(6)}
        ${feldKopf("image", T("va.fa_label", "Fotos als"), "", "fotos_als")}
        ${wahl('id="va-fa"', "data-va-fa", [["sofortbild", "", T("va.w.fa_sofortbild", "Sofortbild")], ["gross", "", T("va.w.fa_gross", "Groß mit Halt")], ["pip", "", T("va.w.fa_pip", "Bild im Bild")]], w.fotoArt)}
        <span id="va-h-lead" hidden></span>
        <label class="va-schalter-zeile"><span class="va-sz-text"><b>${esc(T("va.h_alle", "An allen Foto-Schildern anhalten"))}${q(T("va.h_alle_tip", "Damit man die Bilder in Ruhe ansehen kann. Aus: die Fahrt läuft weiter, das Foto steht kurz daneben."), "va-h-lead-q")}</b></span>
          <input type="checkbox" class="va-schalter" id="va-h-alle" checked></label>
        <div id="va-h-an-teil">
          ${feldKopf("timer", T("va.h_dauer_frage", "Wie lange bleiben die Bilder?"))}
          ${wahl('id="va-h-dauer"', "data-va-h-dauer", [["kurz", "", T("va.h_kurz_g", "Kurz"), "≈ 2 s"], ["normal", "", T("va.h_normal_g", "Normal"), "3 s"], ["lang", "", T("va.h_lang_g", "Lang"), "≈ 5 s"]], w.halteDauer || "normal")}
          ${schalter("va-h-heran", w.fotoPause !== "stehen", T("va.h_heran_t", "Zu den Fotos heranfahren"), T("va.h_heran_k", "Die Kamera nähert sich sanft."))}
          ${schalter("va-h-kreisen", !!w.fotoKreisen, T("va.h_kreisen_t", "Einmal ums Foto kreisen"), T("va.h_kreisen_k", "Während des Halts fliegt die Kamera eine Runde um den Fotoort."))}
        </div>
        ${mehrZu}
      </section>

      <section data-va="7">
        ${kopf(T("va.w.s8_infos_h", "Was wird eingeblendet?"), T("va.w.s8_infos_erkl", "Zahlen, Höhenprofil, Highlights und die Schlusskarte."))}
        <div class="va-zkarten">
          <label class="va-zk"><span class="va-zk-bild va-gb">${routeSvg()}<span class="va-gb-chip">${I("route", 11)} ${esc(km)}<i></i>${I("mountain", 11)} ${esc(aufM)}</span></span>
            <span class="va-zk-text"><b>${esc(T("va.e_zahlen_g", "Strecke & Höhe"))}${hilfeKnopf("z_zahlen")}</b></span>
            <input type="checkbox" class="va-schalter" id="sv-zahlen"${w.zahlen ? " checked" : ""}></label>
          <label class="va-zk"><span class="va-zk-bild va-gb va-gb-profil">${profilSvg()}</span>
            <span class="va-zk-text"><b>${esc(T("schnell.profil_kurz", "Höhenprofil"))}${hilfeKnopf("z_profil")}</b></span>
            <input type="checkbox" class="va-schalter" id="sv-profil"${w.profil ? " checked" : ""}></label>
        </div>
        ${hilfeBox("z_zahlen")}${hilfeBox("z_profil")}
        ${feldKopf("map-pin", T("va.i_momente", "Highlights und Momente"), "", "z_highlights")}
        <span id="va-g-lead" hidden>${esc(T("logbuch.laedt", "Logbuch wird geladen …"))}</span><span id="va-g-kapitel" hidden></span>
        <div class="va-g-liste" id="va-g-liste"></div>
        <label hidden><input type="checkbox" id="sv-logbuch"${w.logbuch ? " checked" : ""}></label>
        <label hidden><input type="checkbox" id="sv-highlights"${w.highlights ? " checked" : ""}></label>
        ${mehrAuf(7)}
        <div id="va-raster-zeile"${w.profil ? "" : " hidden"}>${schalter("va-raster", !!w.raster, T("va.raster", "Streckenraster im Höhenprofil"), T("va.raster_k", "Feine Linien mit km- bzw. Meilen-Angabe, damit man sieht, wo der Anstieg liegt."))}</div>
        ${schalter("sv-uebersicht", !!w.uebersicht, T("va.uebersicht", "Übersichtskarte in der Ecke"), T("va.uebersicht_k", "Die ganze Tour klein oben rechts, der gefahrene Teil wächst mit."))}
        <!-- 01.11.2026 (wie die iPhone-App) — wichtige Orte unterwegs: Städte, Dörfer und Pässe an der Strecke als kleine Schilder -->
        ${feldKopf("map-pinned", T("va.orte", "Wichtige Orte unterwegs"), `<input type="checkbox" class="va-schalter" id="va-orte-an"${w.orteAn !== false ? " checked" : ""} title="${esc(T("va.orte_tip", "Orte und Pässe, an denen die Tour vorbeiführt, als kleine Schilder"))}">`)}
        <div id="va-gipfel-feld" hidden>
        ${feldKopf("mountain", T("va.gipfeltitel", "Gipfeltitel"), `<input type="checkbox" class="va-schalter" id="va-gipfel-an"${w.gipfelTitelAn !== false ? " checked" : ""} title="${esc(T("va.gipfeltitel_tip", "Großer Titel, wenn die Tour über einen benannten Gipfel führt"))}">`)}
        <div class="va-orte-stand" id="va-gipfel-text"></div>
        </div>
        <div class="va-orte-stand" id="va-orte-text">${esc(T("va.orte_suchen", "Orte und Pässe an der Strecke werden gesucht …"))}</div>
        <div class="sv-zutat" data-sv-zutat="schluss">
          ${feldKopf("milestone", T("schnell.z.schluss", "Schlusskarte"), `<input type="checkbox" class="va-schalter" id="sv-schluss-an"${w.schlussAn ? " checked" : ""} title="${esc(T("va.schluss_an_tip", "Schlusskarte an oder aus"))}">`, "z_schluss")}
          <div class="sv-zutat-teil">
            <div class="va-chips">${["dist_total", "elev_gain", "moving_time"].map(f => `<label class="va-chip"><input type="checkbox" data-sv-feld="${f}"${w.felder.includes(f) ? " checked" : ""}><span>${I("check", 13)}${esc(feldLabel(f))}</span></label>`).join("")}</div>
            ${details(T("va.weitere_angaben", "Weitere Angaben"), `<div class="va-chips">${SCHLUSS_FELDER.filter(f => !["dist_total", "elev_gain", "moving_time"].includes(f)).map(f => `<label class="va-chip"><input type="checkbox" data-sv-feld="${f}"${w.felder.includes(f) ? " checked" : ""}><span>${I("check", 13)}${esc(feldLabel(f))}</span></label>`).join("")}</div>`, "va-felder-mehr", SCHLUSS_FELDER.some(f => !["dist_total", "elev_gain", "moving_time"].includes(f) && w.felder.includes(f)))}
          </div>
        </div>
        ${mehrZu}
      </section>

      <section data-va="8">
        ${kopf(T("va.v_h", "Dein Video"), T("va.v_sub", "Alles steht schon im Projekt. Übernimm es — oder erstelle das Video gleich.") + " " + T("va.s9_hinweis2", "Du kannst im Animator jederzeit weitergestalten. ⌘Z nimmt den ganzen Assistenten zurück."))}
        <div class="va-uebersicht" id="va-liste"></div>
        <div class="sv-zutat" data-sv-zutat="musik">
          ${feldKopf("music", T("schnell.z.musik", "Musik"), `<input type="checkbox" class="va-schalter" id="sv-musik-an"${w.musikAn ? " checked" : ""} title="${esc(T("va.musik_an_tip", "Musik an oder aus"))}">`)}
          <div class="sv-zutat-teil">
            <select id="sv-musik" class="lib-select" hidden>
              ${MUSIK.map(([k, d]) => `<option value="builtin:${k}"${w.musik === "builtin:" + k ? " selected" : ""}>${esc(T("animator.ton." + k, d))}</option>`).join("")}
              ${w.musik && !w.musik.startsWith("builtin:") ? `<option value="${esc(w.musik)}" selected>${esc(String(w.musik).split(/[\\/]/).pop())}</option>` : ""}
            </select>
            <button type="button" id="sv-musik-hoeren" hidden></button>
            <div class="va-musik-liste" id="va-musik-liste"></div>
            <div class="va-links"><button type="button" class="va-link" data-va-musik-alle>${I("list", 15)} ${esc(T("va.musik_alle", "Alle Musikstücke"))}</button>
              <button type="button" class="va-link" id="sv-musik-datei" title="${esc(T("animator.ton.datei_tip", "Eigene Musik wählen (MP3, M4A, WAV, FLAC …)"))}">${I("plus", 15)} ${esc(T("va.musik_eigene", "Eigene Musik"))}</button></div>
          </div>
        </div>
        ${mehrAuf(8)}
        ${schalter("sv-klick", w.klick !== false, T("va.klick", "Klick bei jedem Foto"), T("va.klick_k", "Ein leises Kamera-Klicken, wenn ein Foto erscheint."))}
        ${feldKopf("image", T("va.logo_lage", "Logo"), `<input type="checkbox" class="va-schalter" id="va-logo-an"${w.logoAn !== false ? " checked" : ""} title="${esc(T("va.logo_an_tip", "Logo im Video an oder aus"))}">`)}
        <div id="va-logo-teil"${w.logoAn !== false ? "" : " hidden"}>
        ${wahl('data-va-logo', "data-va-logo-w", [["links", "", T("va.links", "Links")], ["mitte", "", T("va.mitte", "Mitte")], ["rechts", "", T("va.rechts", "Rechts")]], w.logoLage || "mitte")}
        </div>
        <!-- 01.11.2026 (Marc: „Route brauchen wir doch gar nicht, das ist eh leer“) — der Reiter Route ist weg; die gemerkten
             Stile stehen hier, neben „Als Vorlage merken“ -->
        <div id="va-eigene-feld" hidden>
          ${feldKopf("star", T("va.v_eigene_anwenden", "Gemerkten Stil anwenden"))}
          <div class="va-karten va-karten-3" id="va-zweck"><span id="sv-eigene" class="sv-eigene"></span></div>
        </div>
        <button type="button" class="va-knopf va-knopf-rand" data-va-merken>${I("bookmark", 16)}<span>${esc(T("va.v_merken", "Als Vorlage merken"))}</span></button>
        <div class="va-vorlage-sp" id="va-vorlage-sp" hidden>
          <div class="va-vorlage-zeile"><input type="text" id="va-vorlage-name" class="lib-input" placeholder="${esc(T("va.v_name_ph", "Name, z. B. „Wandern hochkant“"))}">
          <button type="button" class="va-knopf" id="va-vorlage-speichern">${I("star", 15)}<span>${esc(T("va.v_speichern_k", "Merken"))}</span></button>${q(T("va.v_hinweis2", "Gemerkt wird nur der Stil (Format, Länge, Kamera, Karte, Linie, Einblendungen, Texte, Musik, Schluss) — beim Assistenten im Reiter „Route“ und beim Schnell-Video wählbar."))}</div>
        ${mehrZu}
        ${P.keyframes > 0 ? `<p class="va-klein va-info">${I("info", 14)} <span>${esc(T("schnell.kf_warnung", "Das Projekt hat schon {n} Keyframes — sie werden durch die Kamerafahrt ersetzt (⌘Z holt sie zurück).").replace("{n}", P.keyframes))}</span></p>` : ""}
      </section>
    </div>`;
    const m = (ASS ? vaFenster : openModal)({
      title: ASS ? T("va.titel", "Video-Assistent") : "🎬 " + T("schnell.titel_dialog", "Schnell-Video"),
      // zurück im Animator: anderes Projekt offen → schließen (Geschriebenes bleibt im vorigen Projekt), sonst die Stelle wieder zeigen
      beimAnimator: ASS ? () => {
        const zuJetzt = () => !m.el || !m.el.isConnected || m.el.hidden;
        let pid = null; try { pid = ((typeof getActiveProject === "function" ? getActiveProject() : null) || {}).id || null; } catch (_) {}
        if (pid && pid !== P.id) {
          m.close();
          toast(T("va.anderes_projekt", "Video-Assistent geschlossen — es ist ein anderes Projekt offen. Was er schon eingetragen hat, bleibt im vorigen Projekt."), "info", 6000);
          return false;
        }
        // warten, bis der Animator das Projekt wieder geladen hat, dann den Stand des Assistenten neu eintragen
        (async () => {
          // bereit = Projekt geladen UND Karte fertig (Stil, Gelände) — sonst trifft das Eintragen einen halb aufgebauten MapLibre
          for (let i = 0; i < 80; i++) {
            try { const k = window.__rzAnimMap && window.__rzAnimMap();
              if (window.__rzSchnellBereit && window.__rzSchnellBereit(P.id) && k && k.loaded() && k.isStyleLoaded() && !k.isMoving()) break; } catch (_) {}
            await new Promise(res => setTimeout(res, 250));
          }
          await new Promise(res => setTimeout(res, 800));
          if (zuJetzt()) return;
          try { if (vaSeiteJetzt > 1) vaLive(); else vaVorschauStelle(); } catch (e) { if (window.rzSwallow) rzSwallow(e, "assistent:zurueck"); }
        })();
        return true;
      } : null,
      body: ASS ? vaRumpf() : `<div class="sv-dialog">
        <p class="muted" style="margin:0 0 10px">${esc(T("schnell.intro", "Ein fertiges Video deiner Tour: Überblick, Flug entlang der Strecke, Schlussblick mit deinen Zahlen."))}</p>
        <!-- 06.10.2026 (Marc: „das Schnell-Video braucht eine Vorschau, dass man weiß, was man da einstellt: komplette Karte
             mit komplettem Track; wenn Fotos da sind, eins offen, die anderen zu; gleiches gilt für POIs") -->
        <div class="sv-vorschau" id="sv-vorschau"><div class="sv-vk" id="sv-vk"><div class="sv-vk-karte" id="sv-vk-karte"></div><div class="sv-vk-titel" id="sv-vk-titel"></div><div class="sv-vk-zahlen" id="sv-vk-zahlen" hidden></div><div class="sv-vk-profil" id="sv-vk-profil" hidden></div></div></div>
        <div class="sv-vorlagen" id="sv-vorlagen">${VORLAGE_NAMEN.map(n => `<button type="button" class="sv-vorlage${n === w.vorlage ? " is-on" : ""}" data-sv-vorlage="${n}">
          <span class="rz-look-bild rz-look-${VORLAGEN[n].look}"></span><span class="sv-vl-name">${esc(T("schnell.vl." + n, { weite: "Weite", tagebuch: "Tagebuch", puls: "Puls" }[n]))}</span>
          <span class="sv-vl-text">${esc(T("schnell.vl." + n + "_text", { weite: "Landschaft, Fotos groß, Zahlen am Schluss", tagebuch: "Orte und Erinnerungen, Fotos als Sofortbild", puls: "Strecke und Leistung, Datenleiste mit Profil" }[n]))}</span></button>`).join("")}${`<span id="sv-eigene" class="sv-eigene"></span>`}</div>
        <div class="muted sv-vl-stand" id="sv-vl-stand"></div>
        <label class="field-label">${esc(T("schnell.format", "Format"))}</label>
        ${knopfReihe("format", [["9:16", "9:16 " + T("schnell.format_hoch", "hochkant")], ["16:9", "16:9"], ["1:1", "1:1"]], w.format)}
        <label class="field-label">${esc(T("schnell.laenge", "Länge"))}</label>
        ${knopfReihe("laenge", [["kurz", T("schnell.kurz", "Kurz") + " · 20 s"], ["normal", T("schnell.normal", "Normal") + " · 40 s"], ["lang", T("schnell.lang", "Lang") + " · 60 s"]], w.laenge)}
        <label class="field-label">${esc(T("schnell.flugstil", "Flugstil der Kamera"))}</label>
        <div class="sv-reihe sv-flug" data-sv-gruppe="flug">${FLUGSTIL_NAMEN.map(k => `<button type="button" class="btn btn-small sv-wahl${k === w.flug ? " is-on" : ""}" data-sv-wert="${k}" title="${esc(T("schnell.flug." + k + "_k", FLUGSTIL_TEXT[k][1]))}">${esc(T("schnell.flug." + k, FLUGSTIL_TEXT[k][0]))}</button>`).join("")}</div>
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
              <button type="button" class="btn btn-small" data-sv-alle title="${esc(T("schnell.alle_tip", "Alle Fotos und Videos dieser Tour ansehen und selbst auswählen"))}">${vaIc("images", 13)} ${esc(T("schnell.alle", "Alle Medien der Tour"))}<span class="sv-alle-n"></span> …</button>
              <button type="button" class="btn btn-small" data-sv-plus="dateien" title="${esc(T("schnell.fotos_plus_tip", "Eigene Fotos dazunehmen — sie werden der Strecke zugeordnet (GPS, sonst Aufnahmezeit)"))}">+ ${esc(T("schnell.fotos_plus", "Fotos …"))}</button>
              <button type="button" class="btn btn-small" data-sv-plus="ordner" title="${esc(T("schnell.fotos_plus_tip", "Eigene Fotos dazunehmen — sie werden der Strecke zugeordnet (GPS, sonst Aufnahmezeit)"))}">+ ${esc(T("schnell.fotos_plus_ordner", "Ordner …"))}</button></div>
          <div class="sv-alle" id="sv-alle" hidden></div>
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
              <button type="button" class="btn btn-small" id="sv-musik-hoeren" title="${esc(T("schnell.musik_hoeren", "Probehören"))}">${vaIc("play", 14)}</button>
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
      footer: ASS ? `<button type="button" class="va-f-abbrechen" id="va-abbrechen" title="${esc(T("va.abbrechen_tip", "Alles, was der Assistent geändert hat, zurücknehmen"))}">${esc(T("common.cancel", "Abbrechen"))}</button>
          <span class="va-f-luecke"></span>
          <button type="button" class="va-knopf" id="va-zurueck" hidden>${I("arrow-left", 16)}<span>${esc(T("va.zurueck_k", "Zurück"))}</span></button>
          <button type="button" class="va-knopf" id="va-weiter"><span>${esc(T("va.weiter", "Weiter"))}</span>${I("arrow-right", 17)}</button>
          <button type="button" class="va-knopf" id="sv-uebernehmen" title="${esc(T("va.fertig_tip2", "Alles Gewählte bleibt im Projekt — ⌘Z nimmt den ganzen Assistenten zurück"))}">${I("check", 16)}<span>${esc(T("va.ins_projekt", "Ins Projekt übernehmen"))}</span></button>
          <button type="button" class="va-knopf va-knopf-cta" id="va-erstellen" title="${esc(T("va.erstellen_tip", "Übernehmen und gleich das Video exportieren"))}">${I("clapperboard", 16)}<span>${esc(T("schnell.erstellen", "Video erstellen …"))}</span></button>
          <button type="button" id="va-skip" hidden></button>`
      : (P ? `<button type="button" class="btn btn-primary" id="sv-uebernehmen">${esc(T("schnell.in_projekt", "In dieses Projekt übernehmen"))}</button>` : "")
        + `<button type="button" class="btn" id="sv-animator">${esc(P ? T("schnell.neues_projekt", "Neues Projekt") : T("schnell.im_animator", "Im Animator öffnen"))}</button>
               <button type="button" class="btn${P ? "" : " btn-primary"}" id="sv-rendern">🎬 ${esc(T("schnell.erstellen", "Video erstellen …"))}</button>`,
    });
    _svStartet = false;   // ab hier zeigt der Dialog selbst, dass einer offen ist
    if (VORL) { try { await api().projekt_herkunft_setzen(P.id, "assistent"); } catch (e) { try { applog("warn", "[assistent] vorläufig markieren: " + e); } catch (_) {} } }   // warte-ok: Millisekunden
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
    w.fotos = []; w.fotosAus = new Set(); w.fotosLaden = true;
    const animSJetzt = () => Math.max(8, laengeS(w) - introS(w) - holdS(w));
    const fotosInfo = () => {
      const z = box.querySelector("#sv-fotos-info"); if (!z) return;
      const an = w.fotos.filter((_, i) => !w.fotosAus.has(i));
      if (!w.fotos.length) { z.textContent = ""; return; }
      // 26.10.2026 (Klicktest) — Fotos ausgeschaltet: kein „0 Fotostopps … passen nicht alle“
      const fan = box.querySelector("#sv-fotos-an"); if (fan && !fan.checked) { z.textContent = ""; return; }
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
      if (!w.fotos.length && w.fotosLaden && !w.fotosWarten) {
        // 11.10.2026 (Marc-Log: die Suche dauert auf dem NAS bis 1 min) — noch am Suchen ≠ „keine Fotos“
        l.innerHTML = `<span class="muted sv-fotos-warten"><span class="spinner"></span> ${esc(T("schnell.fotos_suchen", "Fotos dieser Tour werden gesucht …"))}</span>`;
        fotosInfo(); return;
      }
      if (!w.fotos.length && w.fotosWarten) {
        // 11.10.2026 (Marc: „keine Fotos zu dieser Tour, was nicht stimmte … Ladesymbol, ‚Warten auf die Mediathek‘“)
        const n = w.fotosWarten.n_fehlt || 0;
        l.innerHTML = `<span class="muted sv-fotos-warten"><span class="spinner"></span> ${esc(T("schnell.fotos_warten", "Warten auf die Mediathek …"))}`
          + (n ? ` <small>${esc(T("schnell.fotos_warten_n", "{n} Fotos dieser Tour sind noch nicht erreichbar (Laufwerk wird verbunden)", { n }))}</small>`
               : w.fotosWarten.einlesen ? ` <small>${esc(T("schnell.fotos_warten_lesen", "die Fotos werden gerade eingelesen"))}</small>` : "") + `</span>`;
        fotosInfo(); return;
      }
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
        + (ASS ? (imVideo.has(f.path) ? `<span class="va-haken">${I("check", 13)}</span>` : "") + (imVideo.has(f.path) ? `<span class="va-foto-grund">${esc(fotoGrund(f) || T("va.f_im_video", "im Video"))}</span>` : "") : "") + `</button>`).join("");
      if (ASS) {
        const lead = box.querySelector("#va-f-lead");
        if (lead) lead.textContent = T("va.f_lead2", "{n} von {m} kommen ins Video", { n: imVideo.size, m: w.fotos.length })
          + (fotoOpt() && fotoOpt().kapitel ? " · " + T("va.f_kapitel2", "je Tag zuerst das beste") : "");
        // 12.10.2026 — Wenige/Ausgewogen/Viele mit der Zahl, die bei dieser Länge tatsächlich ins Video kommt
        const alt = w.fotoMenge, jetzt = isFinite(+alt) ? +alt : 0.5;
        box.querySelectorAll("[data-va-f-menge]").forEach(b => {
          const m_ = +b.dataset.vaFMenge; let n_ = 0;
          try { w.fotoMenge = m_; n_ = stoppsJetzt().filter(x => !x.clip).length + ohneHaltJetzt().length; } catch (_) {}
          let sm = b.querySelector("small"); if (!sm) { sm = document.createElement("small"); b.querySelector("span").appendChild(sm); }
          sm.textContent = n_ === 1 ? T("va.f_n1", "1 Foto") : T("va.f_n", "{n} Fotos", { n: n_ });
          b.classList.toggle("is-on", Math.abs(m_ - jetzt) < 0.21);
        });
        w.fotoMenge = alt;
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
    /** 11.10.2026 (Marc: „dass es direkt in den Editor geht, ist übertrieben — nur ein kleines Modal, wo es groß ist, und von
     *  dort einen Link zum Editor … kommt man da dann wieder zurück?“) — Lupe: Bild/Clip groß, ‹ › und ←/→ blättern, Esc oder
     *  Klick daneben schließt. „Im Foto-Editor öffnen“ legt den Editor DARÜBER; schließt man ihn, ist man wieder in der Lupe. */
    function lupe(pfad, liste) {
      const L_ = (liste || []).map(x => (typeof x === "string" ? x : x.path)).filter(Boolean);
      let i = Math.max(0, L_.indexOf(pfad)); if (!L_.length) L_.push(pfad);
      const alt = document.querySelector(".sv-lupe"); if (alt) alt.remove();
      const el = document.createElement("div");
      el.className = "sv-lupe"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true");
      el.innerHTML = `<div class="sv-lupe-karte"><div class="sv-lupe-buehne"></div>
          <div class="sv-lupe-leiste"><button type="button" class="btn btn-small" data-lupe="-1" title="←">${vaIc("chevron-left", 14)}</button>
            <span class="sv-lupe-name muted"></span>
            <button type="button" class="btn btn-small" data-lupe="1" title="→">${vaIc("chevron-right", 14)}</button>
            <button type="button" class="btn btn-small" data-lupe-editor title="${esc(T("schnell.lupe_editor_tip", "Im Foto-Editor bearbeiten — danach bist du wieder hier"))}">${vaIc("pencil", 13)} ${esc(T("schnell.lupe_editor", "Im Foto-Editor öffnen"))}</button>
            <button type="button" class="btn btn-small" data-lupe-zu title="${esc(T("common.close", "Schließen"))} (Esc)">${vaIc("x", 14)}</button></div></div>`;
      document.body.appendChild(el);
      let lauf = 0;
      const zeige = async () => {
        const lfd = ++lauf, p_ = L_[i], b = el.querySelector(".sv-lupe-buehne");
        el.querySelector(".sv-lupe-name").textContent = `${String(p_).split(/[\\/]/).pop()} · ${i + 1} / ${L_.length}`;
        b.innerHTML = `<span class="muted"><span class="spinner"></span> ${esc(T("common.loading", "Lädt …"))}</span>`;
        let r = null;
        try { r = await api().fotos_gross(p_); } catch (_) {}   // warte-ok: Ladeanzeige in der Lupe
        if (lfd !== lauf || !el.isConnected) return;
        if (!r || !r.url) { b.innerHTML = `<span class="muted">${esc(T("schnell.lupe_fehlt", "Dieses Bild lässt sich gerade nicht anzeigen."))}</span>`; return; }
        b.innerHTML = r.art === "video" || /\.(mp4|mov|m4v)(\?|$)/i.test(r.url)
          ? `<video src="${r.url}" controls autoplay muted playsinline></video>` : `<img src="${r.url}" alt="">`;
      };
      const zu = () => { el.remove(); document.removeEventListener("keydown", taste, true); };
      const blaettern = (d) => { i = (i + d + L_.length) % L_.length; zeige(); };
      const taste = (e) => {
        if (!el.isConnected) { document.removeEventListener("keydown", taste, true); return; }
        if (document.querySelector(".foto-gross")) return;   // der Editor liegt darüber und hat die Tasten
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); zu(); }
        else if (e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); blaettern(-1); }
        else if (e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); blaettern(1); }
      };
      // Capture: die Zeitleiste des Animators nimmt ←/→ sonst als „Bild vor/zurück“ (Klicktest 11.10.2026)
      document.addEventListener("keydown", taste, true);
      el.addEventListener("click", (e) => {
        if (e.target === el) { zu(); return; }
        const n = e.target.closest("[data-lupe]"); if (n) { blaettern(+n.dataset.lupe); return; }
        if (e.target.closest("[data-lupe-zu]")) { zu(); return; }
        if (e.target.closest("[data-lupe-editor]")) gross(L_[i], L_.map(x => ({ path: x })));
      });
      zeige();
      try { applog("info", `[schnell] Lupe: ${L_.length} Medien`); } catch (_) {}
    }
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
    /** 11.10.2026 (Marc: „Alle Medien der Tour anzeigen spinnt“) — nach einem Klick nur die Markierungen der Kacheln
     *  nachziehen; das Raster bleibt stehen (kein Neuaufbau, kein Sprung nach oben, kein Nachladen der Vorschaubilder). */
    function alleStand() {
      const el = box.querySelector("#sv-alle"); if (!el || el.hidden || !alleMedien) return false;
      const kacheln = el.querySelectorAll("[data-sv-alle-i]"); if (kacheln.length !== alleMedien.length) return false;
      const drin = new Set(w.fotos.filter((_, i) => !w.fotosAus.has(i)).map(f => f.path).concat(w.clips.filter((_, i) => !w.clipsAus.has(i)).map(c => c.path)));
      const video = imVideoPfade();
      kacheln.forEach(k => {
        const m = alleMedien[+k.dataset.svAlleI]; if (!m) return;
        k.classList.toggle("is-on", drin.has(m.path));
        k.classList.toggle("va-im-video", video.has(m.path));
        const h = k.querySelector(".sv-alle-haken");
        if (video.has(m.path) && !h) k.insertAdjacentHTML("beforeend", `<span class="sv-alle-haken">${vaIc("check", 12)}</span>`);
        if (!video.has(m.path) && h) h.remove();
      });
      return true;
    }
    function alleZeichnen() {
      if (alleStand()) return;
      const el = box.querySelector("#sv-alle"); if (!el || el.hidden) return;
      const altScroll = (el.querySelector(".sv-alle-raster") || {}).scrollTop || 0;
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
      const ra = el.querySelector(".sv-alle-raster"); if (ra && altScroll) ra.scrollTop = altScroll;
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
                             : await api().pick_file("open", ["Fotos (*.jpg;*.jpeg;*.heic;*.heif;*.png;*.tif;*.tiff;*.dng;*.arw;*.cr3;*.cr2;*.nef;*.raf;*.rw2;*.orf;*.pef)"], true);   // warte-ok: Systemdialog
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
      if (g) { const m = alleMedien[+g.dataset.svGrossAlle]; if (m) lupe(m.path, alleMedien.map(x => x.path)); return; }
      const b = e.target.closest("[data-sv-alle-i]"); if (!b || b.classList.contains("laedt")) return;
      const m = alleMedien[+b.dataset.svAlleI]; if (!m) return;
      b.classList.add("laedt");
      alleUmschalten(m).finally(() => b.classList.remove("laedt"));
    });
    box.querySelector("#sv-fotos")?.addEventListener("click", (e) => {
      const q = e.target.closest("[data-sv-fotoquelle]"); if (q) { fotosAusQuelle(q.dataset.svFotoquelle); return; }
      const g = e.target.closest("[data-sv-gross]");
      if (g) { const f = w.fotos[+g.dataset.svGross]; if (f) lupe(f.path, w.fotos.map(x => x.path)); return; }
      const b = e.target.closest("[data-sv-foto]"); if (!b) return;
      const i = +b.dataset.svFoto;
      if (w.fotosAus.has(i)) w.fotosAus.delete(i); else w.fotosAus.add(i);
      b.classList.toggle("is-on", !w.fotosAus.has(i));
      fotosInfo(); zutatenStand(); vorschau.inhalt();
    });
    box.querySelectorAll("[data-sv-gruppe='laenge']").forEach(r => r.addEventListener("click", () => setTimeout(() => { fotosInfo(); vorschau.inhalt(); }, 0)));
    box.querySelector("#sv-eigen")?.addEventListener("input", () => { w.eigenS = laengeKlemmen(box.querySelector("#sv-eigen").value || w.eigenS); fotosInfo(); });
    // 13.10.2026 — Kommandozeile (core/cli, `--length`): die klassische Ansicht hat nur Kurz/Normal/Lang — eine andere Länge
    // setzt der Aufrufer hierüber (wie „Eigene" im Assistenten). Nur solange dieser Dialog offen ist.
    window.__rzSchnellLaenge = (sek) => {
      w.laenge = "eigen"; w.eigenS = laengeKlemmen(sek);
      box.querySelectorAll("[data-sv-gruppe='laenge'] [data-sv-wert]").forEach(b => b.classList.toggle("is-on", b.dataset.svWert === "eigen"));
      const e = box.querySelector("#sv-eigen"); if (e) e.value = w.eigenS;
      fotosInfo(); vorschau.inhalt();
      return laengeS(w);
    };
    // 13.10.2026 — Kommandozeile: erst losschicken, wenn Fotos und Clips gefunden sind (sonst entstand das Video ohne Fotos)
    window.__rzSchnellGeladen = () => !w.fotosLaden && !w.fotosWarten && !!w.clipsGeladen;
    (async () => {
      // 11.10.2026 — Mediathek noch nicht bereit (Laufwerk/NAS wird verbunden, Einlesen läuft, Bibliothek öffnet):
      // „Warten auf die Mediathek …“ und alle 3 s neu fragen (höchstens 3 min), statt gleich „keine Fotos“ zu melden
      const wartet = (r) => !!(r && r.ok && !(r.fotos || []).length && (r.n_fehlt > 0 || r.einlesen || r.bib_bereit === false));
      let r = null;
      for (let versuch = 0; versuch < 60; versuch++) {
        r = null;
        try { r = await api().schnellvideo_fotos(pfad); } catch (_) {}   // warte-ok: Hintergrund, der Dialog ist schon bedienbar
        if (!box.isConnected) return;
        if (!wartet(r)) break;
        if (!w.fotosWarten) try { applog("info", `[schnell] warte auf die Mediathek (${r.n_fehlt || 0} nicht erreichbar, einlesen=${!!r.einlesen})`); } catch (_) {}
        w.fotosWarten = { n_fehlt: r.n_fehlt || 0, einlesen: !!r.einlesen };
        fotosZeigen();
        await new Promise(res => setTimeout(res, 3000));
      }
      const warteteVorher = !!w.fotosWarten;
      w.fotosWarten = null; w.fotosLaden = false;
      w.fotos = (r && r.ok && Array.isArray(r.fotos)) ? r.fotos : [];
      if (!w.fotos.length && L.fotos_an == null) { const c = box.querySelector("#sv-fotos-an"); if (c) c.checked = false; }
      if (w.fotos.length && warteteVorher) { const c = box.querySelector("#sv-fotos-an"); if (c && L.fotos_an == null) c.checked = true; }
      fotosZeigen();
      if (warteteVorher && ASS) { try { vaLive(); } catch (e) { if (window.rzSwallow) rzSwallow(e, "schnell:fotos_nach_warten"); } }
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
      // 19.10.2026 (Audit, zusammengeführte Mehrtagestour: „Reise Tag 1 (2026-08-10) + Reise Tag 2 … + Reise Tag 3 …“ lief
      // im Hochkant-Video über drei Zeilen, mitten im Datum umgebrochen) — auch im Schnell-Video, sobald der Name zu lang ist
      const zuLang = (x) => String(x || "").length > 40;
      if (ein && (ASS ? unhandlich(ein.value) : zuLang(ein.value))) { const k = kurzName(ein.value); if (k && !liste.includes(k)) liste.push(k); }
      // 19.10.2026 (Audit) — „Wer sieht die Schildkröte 🐢?“ und „Wer sieht die Schildkröte?“ standen nebeneinander:
      // Vorschläge, die sich nur durch Emojis/Satzzeichen unterscheiden, einmal zeigen
      { const schl = (x) => String(x || "").replace(EMOJI, " ").replace(/[\s?!.,:;…]+/g, " ").trim().toLowerCase();
        const gesehen = new Set([schl(ein && ein.value)]);
        for (let i = 0; i < liste.length; i++) { const k = schl(liste[i]); if (gesehen.has(k)) { liste.splice(i, 1); i--; } else gesehen.add(k); } }
      if (!box_ || !liste.length) return;
      // 08.10.2026 (Klicktest) — Assistent: steht noch der Dateiname im Feld („2023-05-05_Barranco … -1106845751“,
      // „24613993220_ACTIVITY“), gleich den ersten Vorschlag nehmen; der Dateiname bleibt als Chip wählbar
      const dateiname = (x) => /^\d{4}-\d{2}-\d{2}[_ ]|\d{7,}|_ACTIVITY|\.(gpx|fit|kml)$/i.test(String(x || ""))
        || (ASS && unhandlich(x));   // 11.10.2026 (Testvideo Teide) — auch lange Komoot-Namen mit Emojis
      if (ein && !ein.dataset.getippt && (ASS ? dateiname(ein.value) : zuLang(ein.value))) {
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
      // 12.10.2026 — nur die gewählten Höhepunkte belegen ihre Stelle
      const hlBei = hlListe().filter(h => w.hlArten.has(h.art)).map(h => h.bei);
      const amHoehepunkt = (x) => hlBei.some(b => Math.abs(b - x.bei) < 0.05);
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
      // 12.10.2026 (neue Optik) — je Moment ein Bild: das Foto, das dort entstand, sonst die eigene Linie mit dem Punkt
      const bildBei = (bei) => {
        if (!isFinite(+bei)) return `<span class="va-gb">${routeSvg()}</span>`;
        let best = null, d = 0.035;
        for (const f of (w.fotos || [])) if (f.thumb && isFinite(+f.bei) && Math.abs(+f.bei - +bei) < d) { d = Math.abs(+f.bei - +bei); best = f; }
        return best ? `<img src="${best.thumb}" alt="">` : `<span class="va-gb">${routeSvg({ bei })}</span>`;
      };
      const zeile = (key, icon, name, sub, an, aus, bei) => `<label class="va-moment${aus ? " va-g-aus" : ""}"><span class="va-m-bild">${bildBei(bei)}</span>`
        + `<span class="va-m-ic">${I(icon, 17)}</span><span class="va-g-text"><b>${esc(name)}</b><small>${esc(sub)}</small></span>`
        + `<input type="checkbox" class="va-haekchen" data-va-g="${key}"${an && !aus ? " checked" : ""}${aus ? " disabled" : ""}></label>`;
      const zeilen = [], weitere = [], oben = [];   // oben: gewählte, nach der Stelle auf der Strecke
      // 12.10.2026 — die besonderen Momente der Strecke (höchster Punkt, steilste Stelle, höchstes Tempo, halbe Strecke)
      // stehen zwischen den Logbuch-Momenten, jeder einzeln wählbar
      // wie der Animator: gewählte Höhepunkte näher als 6 % der Strecke → nur der erste (Vorrang hoechster, steilste, schnellste, halbe)
      const hlZuNah = {};
      { const bleibt = []; for (const a of HL_ARTEN) { const h = hlListe().find(x => x.art === a); if (!h || !w.hlArten.has(a)) continue;
          const vor = bleibt.find(b => Math.abs((b.f ?? b.bei) - (h.f ?? h.bei)) < 0.06); if (vor) hlZuNah[a] = vor.art; else bleibt.push(h); } }
      for (const h of hlListe()) {
        const zeit = h.art === "hoechster" && w.lbHoch ? [w.lbTage > 1 && w.lbHoch.tag ? T("va.g_tag", "Tag {n}", { n: w.lbHoch.tag }) : "", w.lbHoch.zeit] : [];
        const html = zeile("hl:" + h.art, h.ic, T("animator.hl." + h.art, h.art) + (h.wert ? " · " + h.wert : ""),
          zeit.concat([hlZuNah[h.art] ? T("va.g_hl_zu_nah", "zu nah an „{n}“ — im Video nur das eine Schild", { n: T("animator.hl." + hlZuNah[h.art], hlZuNah[h.art]) })
            : T("va.g_grund_hl", "besondere Stelle der Strecke")]).filter(Boolean).join(" · "), w.hlArten.has(h.art), false, h.bei);
        if (w.hlArten.has(h.art)) oben.push([h.bei, html]); else weitere.push(html);
      }
      const proTag = new Map();   // Mehrtagestour: Zeilen je Tag (= Kapitel) gruppieren
      w.lb.forEach((x, i) => {
        const grund = x.icon === "uebernachtung" ? T("va.g_grund_nacht", "Ende eines Tages") : x.art === "notiz" ? T("va.g_grund_notiz", "deine Notiz im Logbuch")
          : T("va.g_grund_pause", "{n} min Pause", { n: Math.round((+x.dauer_s || 0) / 60) });
        const tag = w.lbTage > 1 && x.tag ? T("va.g_tag", "Tag {n}", { n: x.tag }) : "";
        const belegt = sperrGrund(x);
        if (belegt) w.lbWahl.delete(i);
        const html = zeile(String(i), SYM[x.icon] || "map-pin", x.text,
          [w.lbTage > 1 ? "" : tag, x.zeit, belegt || grund].filter(Boolean).join(" · "), w.lbWahl.has(i), !!belegt, x.bei);
        if (w.lbTage > 1) { const k = +x.tag || 0; if (!proTag.has(k)) proTag.set(k, { html: [], n: 0, an: 0 }); const g = proTag.get(k); g.html.push(html); g.n++; if (w.lbWahl.has(i)) g.an++; }
        else if (w.lbWahl.has(i)) oben.push([+x.bei || 0, html]);   // gewählte oben, der Rest unter „Weitere Momente“
        else weitere.push(html);
      });
      zeilen.push(...oben.sort((a, b) => a[0] - b[0]).map(o => o[1]));
      for (const [k, g] of [...proTag.entries()].sort((a, b) => a[0] - b[0])) {
        zeilen.push(`<details class="va-details va-g-tag"${g.an ? " open" : ""}><summary>${I("chevron-down", 15)}<span>${esc(T("va.g_tag_kopf", "Tag {n} · {m} Momente{w}", { n: k || "?", m: g.n,
          w: g.an ? " · " + T("va.g_tag_gewaehlt", "{a} gewählt", { a: g.an }) : "" }))}</span></summary><div class="va-details-inhalt">${g.html.join("")}</div></details>`);
      }
      const warOffen = !!liste.querySelector("#va-g-weitere[open]");
      if (weitere.length) zeilen.push(`<details class="va-details" id="va-g-weitere"${warOffen ? " open" : ""}><summary>${I("chevron-down", 15)}<span>${esc(T("va.g_weitere", "Weitere Momente"))}</span>`
        + `<span class="va-details-n">${esc(T("va.g_weitere_n", "{n} weitere", { n: weitere.length }))}</span></summary><div class="va-details-inhalt">${weitere.join("")}</div></details>`);
      liste.innerHTML = zeilen.join("") || `<p class="muted">${esc(T("va.g_leer", "Im Logbuch dieser Tour gibt es keine längeren Pausen oder Notizen — der Assistent nimmt die Höhepunkte der Strecke."))}</p>`;
      const n = w.lb.length + hlListe().length;
      const lname = { kurz: T("va.g_kurz", "kurzes"), lang: T("va.g_lang", "langes") }[w.laenge] || T("va.g_normal", "normales");
      if (lead) lead.textContent = n ? T("va.g_lead2", "Die schönsten Stationen sind schon vorgeschlagen — {n} Momente gefunden, für ein {laenge} Video passen etwa {k}.",
        { n, laenge: lname, k: Math.min(n, ziel + hlListe().length) }) : T("va.h2_sub", "Die schönsten Stationen deiner Tour.");
      if (kap) kap.textContent = w.lbTage > 1 ? T("va.g_kapitel_n", "Je Tag ein Kapitel — {n} Kapitel.", { n: w.lbTage })
        : T("va.g_kapitel_1", "Diese Tour dauert einen Tag — Kapitel sind hier nicht nötig.");
      const lbcb = box.querySelector("#sv-logbuch");
      const sync = () => { if (lbcb) lbcb.checked = w.lbWahl.size > 0; };
      liste.querySelectorAll("[data-va-g]").forEach(cb => cb.addEventListener("change", () => {
        if (cb.dataset.vaG.startsWith("hl:")) {
          const art = cb.dataset.vaG.slice(3); if (cb.checked) w.hlArten.add(art); else w.hlArten.delete(art);
          const h = box.querySelector("#sv-highlights"), an_ = w.hlArten.size > 0;
          if (h && h.checked !== an_) { h.checked = an_; h.dispatchEvent(new Event("change", { bubbles: true })); }
          setTimeout(vaGeschichte, 0);   // Logbuch-Momente an dieser Stelle werden frei bzw. belegt
        }
        else { const i = +cb.dataset.vaG; if (cb.checked) w.lbWahl.add(i); else w.lbWahl.delete(i); }
        sync();
        try { applog("info", `[assistent] Geschichte: ${w.lbWahl.size} Momente + Höhepunkte ${[...w.hlArten].join(",") || "keine"}`); } catch (_) {}
        if (typeof vaLive === "function") vaLive();
      }));
      sync();
    }
    /** 26.10.2026 — Reiter „Karte“: Gelände (ohne eigene Wahl: wie im Projekt) und Beschriftung (ohne eigene Wahl: wie der Look). */
    function vaKarte() {
      const g = box.querySelector("#va-gelaende");
      if (g) g.checked = typeof w.gelaende === "boolean" ? w.gelaende : !!document.getElementById("anim-terrain")?.checked;
      // 01.11.2026 — Bergnamen: eigene Wahl, sonst wie im Animator (neue Projekte: an)
      const bn = box.querySelector("#va-bergnamen");
      if (bn) bn.checked = typeof w.bergnamen === "boolean" ? w.bergnamen : !!document.getElementById("anim-bn-an")?.checked;
      const st = VA_BESCHR.map(beschrStand);
      const b = box.querySelector("#va-beschr"); if (b) b.checked = st.some(Boolean);
      VA_BESCHR.forEach((k, i) => { const c = box.querySelector(`[data-va-beschr="${k}"]`); if (c) c.checked = st[i]; });
    }
    /** 26.10.2026 — Reiter „Linie“: zeigt, was gilt — die eigene Wahl (w.ls) oder sonst die Linie des Looks. */
    function vaLinie() {
      const LL = vaLookLinie(), ls = w.ls || {};
      const farbe = String(ls.farbe || LL.line_color || "#48d6c4").toLowerCase();
      const fb = box.querySelector("#va-ls-farben");
      if (fb) fb.innerHTML = VA_LINIE_FARBEN.map(f => `<button type="button" class="va-farbe${f === farbe ? " is-on" : ""}" data-va-farbe="${f}" style="background:${f}" aria-label="${f}" aria-pressed="${f === farbe}"></button>`).join("")
        + `<label class="va-farbe va-farbe-eigen${VA_LINIE_FARBEN.includes(farbe) ? "" : " is-on"}" title="${esc(T("va.w.linie_eigene", "Eigene Farbe"))}"><input type="color" id="va-ls-eigen" value="${esc(farbe)}"></label>`;
      const strich = ls.strich || document.getElementById("anim-line-style")?.value || "solid";
      box.querySelectorAll("[data-va-strich]").forEach(b => b.classList.toggle("is-on", b.dataset.vaStrich === strich));
      const breite = ls.breite != null && isFinite(+ls.breite) ? +ls.breite : (+LL.line_width || 3.5);
      const br = box.querySelector("#va-ls-breite"); if (br) br.value = String(breite);
      const bv = box.querySelector("#va-ls-breite-v"); if (bv) bv.textContent = breite.toFixed(1) + " px";
      const setz = (id, an_) => { const e = box.querySelector("#" + id); if (e) e.checked = !!an_; };
      setz("va-ls-kontur", ls.kontur != null ? ls.kontur : +LL.kontur_breite > 0);
      setz("va-ls-schatten", ls.schatten != null ? ls.schatten : +(document.getElementById("anim-shadow-strength")?.value || 0) > 0);
      setz("va-ls-leuchten", ls.leuchten != null ? ls.leuchten : +LL.glow_strength > 0);
      setz("va-ghost", typeof w.ghost === "boolean" ? w.ghost : true);
      // 08.11.2026 (Marc: „mit Röhre kann ich den Laufpunkt nicht mehr ändern“) — bei der Röhre stehen die Köpfe vorn in der
      // Laufpunkt-Wahl; ein Kopf gewählt → er ist an, sonst der Laufpunkt (Kopf „wie der Laufpunkt“)
      const r3_ = r3Stand(), kopfAn = r3_.roehre && r3_.kopf !== "punkt";
      box.querySelectorAll("[data-va-lp]").forEach(b => {
        const k = b.dataset.vaLp.startsWith("k:") ? b.dataset.vaLp.slice(2) : null;
        if (k) b.hidden = !r3_.roehre;
        b.classList.toggle("is-on", k ? (kopfAn && r3_.kopf === k) : (!kopfAn && b.dataset.vaLp === w.lp));
      });
      const sel = box.querySelector("#va-lp-fz");
      if (sel && !sel.options.length) {   // die Fahrzeuge des Animators (dieselben Namen wie dort)
        const q = document.getElementById("anim-dot-style");
        sel.innerHTML = (q ? [...q.options] : []).filter(o => !["dot", "leucht", "arrow", "bild"].includes(o.value))
          .map(o => `<option value="${esc(o.value)}">${esc(o.textContent)}</option>`).join("");
      }
      if (sel && w.lpFz) sel.value = w.lpFz;
      const fz = box.querySelector("#va-lp-fz-zeile"); if (fz) fz.hidden = w.lp !== "fahrzeug" || !(sel && sel.options.length);
      // 06.11.2026 — Röhre + Nachglühen: eigene Wahl (w.ls) oder sonst, was im Projekt steht
      const roehre = r3Stand().roehre, glutSek = r3Stand().sek;
      box.querySelectorAll("[data-va-r3]").forEach(b => b.classList.toggle("is-on", b.dataset.vaR3 === (roehre ? "roehre" : "flach")));
      setz("va-glut", glutSek > 0);
      const gl = r3Stand().glanz, gle = box.querySelector("#va-r3-glanz"); if (gle) gle.value = String(gl);
      const glv = box.querySelector("#va-r3-glanz-v"); if (glv) glv.textContent = Math.round(gl * 100) + " %";
      const look = r3Stand().look;
      box.querySelectorAll("[data-va-glut-look]").forEach(b => b.classList.toggle("is-on", b.dataset.vaGlutLook === look));
      const sekA = glutSek > 0 ? glutSek : 1.5, se = box.querySelector("#va-glut-sek"); if (se) se.value = String(sekA);
      const sv = box.querySelector("#va-glut-sek-v"); if (sv) sv.textContent = sekA.toLocaleString(window.rzSprachCode ? window.rzSprachCode() : undefined) + " s";
      const rm = box.querySelector("#va-r3-mehr"); if (rm) rm.hidden = !roehre;
      const gm = box.querySelector("#va-glut-mehr"); if (gm) gm.hidden = !(glutSek > 0);
    }
    /** 06.11.2026 — was für Röhre/Nachglühen gilt: die eigene Wahl im Assistenten (w.ls) oder sonst der Wert im Projekt. */
    function r3Stand() {
      const ls = w.ls || {}, wert = (id, std) => { const e = document.getElementById(id); return e ? e.value : std; };
      const pSek = parseFloat(wert("anim-nachgluehen", "0")) || 0;
      return { roehre: typeof ls.roehre === "boolean" ? ls.roehre : wert("anim-linie-3d", "flach") === "roehre",
               sek: typeof ls.glut === "boolean" ? (ls.glut ? (+ls.glutSek > 0 ? +ls.glutSek : (pSek > 0 ? pSek : 1.5)) : 0) : pSek,
               kopf: ls.kopf || (["komet", "kometpfeil", "pfeil", "puk", "punkt"].includes(wert("anim-kopf-3d", "kometpfeil")) ? wert("anim-kopf-3d", "kometpfeil") : "kometpfeil"),
               glanz: ls.glanz != null && isFinite(+ls.glanz) ? +ls.glanz : (parseFloat(wert("anim-roehre-glanz", "0.35")) || 0),
               look: ls.glutLook || wert("anim-glut-look", "linie") };
    }
    /** 11.10.2026 — Stufe „Halte“: an allen Foto-Schildern anhalten, Dauer, Heranfahren. */
    const HALT_FAKTOR = { kurz: 0.6, normal: 1, lang: 1.7 };
    /** Vorgabe nach der Foto-Art: große Fotos halten an, Sofortbilder/Bild im Bild fahren durch — bis man selbst wählt. */
    const halteAn = () => (typeof w.halteAlle === "boolean" ? w.halteAlle : (() => { try { return fotoArtJetzt() === "gross"; } catch (_) { return true; } })());
    function vaHalte() {
      let pip = false; try { pip = fotoArtJetzt() === "pip"; } catch (_) {}
      const cb = box.querySelector("#va-h-alle"); if (cb) { cb.checked = !pip && halteAn(); cb.disabled = pip; }
      // 12.10.2026 — zwei Bildkarten (Clip) statt Häkchen; Dauer und Heranfahren nur beim Anhalten
      box.querySelectorAll("[data-va-h-art]").forEach(b => { b.classList.toggle("is-on", (b.dataset.vaHArt === "an") === (!pip && halteAn())); b.disabled = pip; });
      const teil = box.querySelector("#va-h-an-teil"); if (teil) teil.hidden = pip || !halteAn();
      const lead = box.querySelector("#va-h-lead");
      if (lead) {
        let n = 0; try { n = stoppsJetzt().filter(x => x.imageSrc && !x.clip).length + (fotoArtJetzt() !== "gross" ? ohneHaltJetzt().length : 0); } catch (_) {}
        lead.textContent = pip ? T("va.h_lead_pip", "Bei „Bild im Bild“ laufen die Fotos in einer Ecke mit — das Video fährt durch.") : !halteAn() ? T("va.h_lead_aus", "Das Video fährt durch — die Fotos erscheinen unterwegs.")
          : n ? T("va.h_lead", "Das Video hält an {n} Foto-Schildern.", { n }) : T("va.h_lead_keine", "Es sind noch keine Fotos gewählt — Halte entstehen an den Fotos (Stufe „Fotos“).");
      }
      if (box.__vaHalteGebunden) return;
      box.__vaHalteGebunden = true;
      box.querySelector("#va-h-alle")?.addEventListener("change", (e) => { w.halteAlle = !!e.target.checked; vaHalte(); vaLive(); });
      box.querySelector("#va-h-art")?.addEventListener("click", (e) => {
        const b = e.target.closest("[data-va-h-art]"); if (!b || b.disabled) return;
        const cb = box.querySelector("#va-h-alle"), an_ = b.dataset.vaHArt === "an";
        if (cb && cb.checked !== an_) { cb.checked = an_; cb.dispatchEvent(new Event("change", { bubbles: true })); }
      });
      box.querySelector("#va-h-heran")?.addEventListener("change", (e) => { w.fotoPause = e.target.checked ? "heran" : "stehen"; vaLive(); });
      box.querySelector("#va-h-kreisen")?.addEventListener("change", (e) => { w.fotoKreisen = e.target.checked; vaLive(); });
      box.querySelector("#va-h-dauer")?.addEventListener("click", (e) => {
        const b = e.target.closest("[data-va-h-dauer]"); if (!b) return;
        w.halteDauer = b.dataset.vaHDauer;
        box.querySelectorAll("[data-va-h-dauer]").forEach(x => x.classList.toggle("is-on", x === b));
        vaLive();
      });
    }
    /** 11.10.2026 — Kamera-Stufe: ruhig↔lebendig und die Bewegung je Moment der Geschichte in Worten. */
    const BEW_TEXT = () => ({ panorama: T("va.k_b_panorama", "aufziehen und zum Horizont blicken"), nah: T("va.k_b_nah", "näher heran und steiler"),
                              umkreisen: T("va.k_b_umkreisen", "einmal herumkreisen"), ruhig: T("va.k_b_ruhig", "ruhig weiterfliegen") });
    function kamMomente() {
      const raus = [];
      const hoch = (v.regie || []).find(r => r && r.art === "hoechster" && isFinite(+r.bei));
      if (hoch && (w.hlArten ? w.hlArten.has("hoechster") : box.querySelector("#sv-highlights")?.checked)) raus.push({ key: "hoch", bei: +hoch.bei, name: T("va.g_hoch", "Höchster Punkt"), standard: "panorama" });
      if (w.lbWahl) w.lb.forEach((x, i) => { if (w.lbWahl.has(i)) raus.push({ key: String(i), bei: +x.bei, name: x.text, standard: x.icon === "uebernachtung" ? "ruhig" : "nah" }); });
      w.kamBew = w.kamBew || {};
      return raus.sort((a, b) => a.bei - b.bei).map(m => ({ ...m, bewegung: w.kamBew[m.key] || m.standard }));
    }
    function kamOptSetzen() {
      if (!ASS) return;
      // 01.11.2026 — Flugstil wieder frei wählbar (aus dem Schnell-Video); die Höhe verschiebt die Fahrt darüber (vaPatch).
      // Vorher (26.10.2026, wie im Web) setzte die Höhe den Flugstil: Hoch = „Reiseflughöhe“, sonst „Begleiter“.
      if (!VA_FLUGSTILE.includes(w.flug)) w.flug = "begleiter";
      // Begleiter + „Hoch“ = Reiseflughöhe (wie im Web: höher, flacher, ruhiger); bei Falke/Orbit/Karussell verschiebt die Höhe den Zoom
      w.flugFahrt = (w.flug === "begleiter" && w.hoehe === "hoch") ? "reiseflughoehe" : w.flug;
      w.kamOpt = w.kamera === "fahrt" ? { lebendig: isFinite(+w.kamLeb) ? +w.kamLeb : 0.5, momente: kamMomente().map(m => ({ bei: m.bei, bewegung: m.bewegung })) } : null;
    }
    function vaKamera() {
      const fahrt = box.querySelector("#va-k-fahrt"); if (fahrt) fahrt.hidden = w.kamera !== "fahrt";
      const hf = box.querySelector("#va-hoehe-feld"); if (hf) hf.hidden = w.kamera === "fest";
      const liste = box.querySelector("#va-k-momente");
      if (liste) {
        const ms = kamMomente(), BT = BEW_TEXT();
        liste.innerHTML = ms.length ? ms.map(m => `<div class="va-moment va-k-zeile"><span class="va-m-bild">${kamClip(m.bewegung, "va-k-mini")}</span><span class="va-g-text"><b>${esc(m.name)}</b><small>${esc(BT[m.bewegung])}</small></span>`
          + `<button type="button" class="va-knopf va-knopf-klein" data-va-k-anders="${esc(m.key)}">${I("refresh-cw", 14)}<span>${esc(T("va.k_anders", "andere Bewegung"))}</span></button></div>`).join("")
          : `<p class="va-klein">${esc(T("va.k_keine", "Keine Momente gewählt — die Kamera fliegt die Strecke entlang (Stufe „Die Geschichte“)."))}</p>`;
        const n_ = box.querySelector("#va-k-details .va-details-n"); if (n_) n_.textContent = ms.length ? T("va.k_n", "{n} Momente", { n: ms.length }) : "";
        liste.querySelectorAll("[data-va-k-anders]").forEach(b => b.onclick = () => {
          const m = kamMomente().find(x => x.key === b.dataset.vaKAnders); if (!m) return;
          w.kamBew[m.key] = BEWEGUNGEN[(BEWEGUNGEN.indexOf(m.bewegung) + 1) % BEWEGUNGEN.length];
          vaKamera(); kamOptSetzen(); vaLive();
        });
      }
      if (!box.__vaKamGebunden) {
        box.__vaKamGebunden = true;
        box.querySelector("#va-k-leb")?.addEventListener("change", (e) => { w.kamLeb = +e.target.value; kamOptSetzen(); vaLive(); });
        box.querySelectorAll("[data-va-flug]").forEach(b => b.addEventListener("click", () => {   // 14.10.2026 — Flugstil
          w.flug = b.dataset.vaFlug;
          box.querySelectorAll("[data-va-flug]").forEach(x => x.classList.toggle("is-on", x === b));
          kamOptSetzen(); vaLive();
        }));
      }
      kamOptSetzen();
    }
    /** 11.10.2026 — Stufe „Texte“: wenige (nur Titel) · normal (Titel, Unterzeile, Kapitel je Tag)
     *  · viele (dazu Ort, Uhrzeit und Kameradaten unter den Fotos). Kapiteltitel nur so dicht, dass jeder ~3,5 s Platz hat. */
    const KAPITEL_ABSTAND_S = 3.5;
    function kapitelTitel() {
      if (!ASS || (w.textMenge || "normal") === "wenige" || !(w.lbTage > 1) || !Array.isArray(w.lbKapitel)) return [];
      const animS = Math.max(8, laengeS(w) - introS(w) - holdS(w));
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
      box.querySelectorAll("[data-va-t-menge]").forEach(b => { const g = b.querySelector(".va-gb"); if (g) g.outerHTML = textBild(b.dataset.vaTMenge); });
      const e = box.querySelector("#va-t-erkl");
      if (e) {
        const n = kapitelTitel().length;
        e.textContent = { wenige: T("va.t_e_wenige", "Nur der Titel am Anfang."),
                          viele: T("va.t_e_viele", "Titel, Unterzeile, Kapitel je Tag und unter jedem Foto Ort, Uhrzeit und Kameradaten.") }[w.textMenge]
          || T("va.t_e_normal", "Titel und Unterzeile, unter den Fotos Ort und Uhrzeit.") + (n ? " " + T("va.t_e_kapitel", "Dazu {n} Kapiteltitel (Tag und Datum).", { n }) : "");
      }
      if (box.__vaTexteGebunden) return;
      box.__vaTexteGebunden = true;
      box.querySelector("#va-titel-an")?.addEventListener("change", (ev) => {   // 01.11.2026 — Titel ganz an/aus
        w.titelAn = !!ev.target.checked;
        const t_ = box.querySelector("#va-titel-teil"); if (t_) t_.hidden = !w.titelAn;
      });
      box.querySelector("#va-t-menge")?.addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-va-t-menge]"); if (!b) return;
        w.textMenge = b.dataset.vaTMenge;
        box.querySelectorAll("[data-va-t-menge]").forEach(x => x.classList.toggle("is-on", x === b));
        vaTexte(); vaLive();
      });
      ["#sv-titel", "#sv-unter"].forEach(sel => box.querySelector(sel)?.addEventListener("change", () => vaLive()));
      const mit = () => { const t1 = box.querySelector("#sv-titel")?.value || "", t2 = box.querySelector("#sv-unter")?.value || "";
        box.querySelectorAll(".va-gb-t1").forEach(e => { e.textContent = t1; }); box.querySelectorAll(".va-gb-t2").forEach(e => { e.textContent = t2; }); };
      ["#sv-titel", "#sv-unter"].forEach(sel => box.querySelector(sel)?.addEventListener("input", mit));
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
      const welle = (txt) => {   // gleichbleibendes Wellenbild je Stück (aus dem Namen), keine Dekofarbe
        let h = 7; for (const c of txt) h = (h * 31 + c.charCodeAt(0)) >>> 0;
        const st = []; for (let i = 0; i < 22; i++) { h = (h * 1103515245 + 12345) >>> 0; const a = 3 + (h % 1000) / 1000 * 13; st.push(`<rect x="${2 + i * 3.6}" y="${(20 - a).toFixed(1)}" width="2" height="${(2 * a).toFixed(1)}" rx="1"/>`); }
        return `<svg class="va-welle" viewBox="0 0 82 40" aria-hidden="true">${st.join("")}</svg>`;
      };
      const ops = [...sel.options], sicht = new Set([sel.value]);
      for (const o of ops) { if (sicht.size >= 4) break; sicht.add(o.value); }
      l.innerHTML = ops.map((o) => { const [name, stimmung] = String(o.textContent || "").replace(/^🎵\s*/, "").split(/\s+—\s+/);
        return `<div class="va-mu-zeile${o.value === sel.value ? " is-on" : ""}${sicht.has(o.value) ? "" : " va-mu-mehr"}" data-va-mu="${esc(o.value)}" role="button" tabindex="0">`
        + `<button type="button" class="va-mu-play" data-va-mu-play="${esc(o.value)}" title="${esc(T("schnell.musik_hoeren", "Probehören"))}">${vaIc(hoerenWert === o.value ? "pause" : "play", 15)}</button>`
        + welle(o.value) + `<span class="va-g-text"><b>${esc(name || "")}</b><small>${esc(stimmung || (o.value.startsWith("builtin:") ? "" : T("va.musik_eigen", "eigene Datei")))}</small></span>`
        + `<span class="va-radio" aria-hidden="true"></span></div>`; }).join("");
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
    box.querySelector("#sv-profil")?.addEventListener("change", (e) => { const r = box.querySelector("#va-raster-zeile"); if (r) r.hidden = !e.target.checked; });
    box.querySelector("#sv-titel")?.addEventListener("input", () => vorschau.titel());
    zutatenStand();
    const schilderJetzt = () => {
      const st = stoppsJetzt().concat(fotoArtJetzt() === "sofortbild" ? ohneHaltJetzt().map(k => sofortbildSchild(k, w.sofortGroesse)) : [])
        .sort((a, b) => a.__bei - b.__bei);
      if (w.fotoPause === "stehen") st.forEach(x => { if (x.stopp && !x.clip) x.stopp_kamera = false; });   // F-5: Pause ohne Heranfahren
      // 14.10.2026 — „Einmal ums Foto kreisen“: an jedem Fotostopp mit Kamera (nicht bei Clips)
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
      if (w.fotoKreisen) st.forEach(x => { if (x.stopp && !x.clip && x.stopp_kamera !== false) x.stopp_kreisen = true; });
      letztesFotoLaenger(st, animSJetzt());
      const lbListe = w.lbWahl ? w.lb.filter((x, i) => w.lbWahl.has(i)) : w.lb;
      const lbSchilder = (an("sv-logbuch") && lbListe.length) ? logbuchAnwenden(st, lbListe, (v.regie || []).map(r => r.bei), !!w.lbWahl, lbRand(w)) : [];
      return st.map(x => { const o = Object.assign({}, x); delete o.__bei; delete o.__eigenText; return o; }).concat(lbSchilder).concat(orteSchilder());
    };
    // ── 01.11.2026 — Wichtige Orte unterwegs (wie die iPhone-App): Städte, Dörfer und Pässe entlang der Strecke aus derselben
    // Suche wie das Highlights-Fenster (highlights_vorschlaege, Quelle „orte“); etwa ein Schild je 8 s Film, mindestens 6 % der
    // Strecke auseinander, nicht an Start/Ziel und nicht dort, wo schon ein Highlight steht. Pass vor Stadt vor Dorf.
    w.orte = null;   // null = wird gesucht
    const orteGewaehlt = () => {
      if (!ASS || w.orteAn === false || !Array.isArray(w.orte) || !w.orte.length) return [];
      const maxN = Math.max(2, Math.floor(laengeS(w) / 8));
      const hl = (w.highlights && w.hlArten) ? hlListe().filter(h => w.hlArten.has(h.art)).map(h => +h.bei) : [];
      const rang = (o) => o.art === "pass" ? 0 : (isFinite(+o.rang) ? +o.rang : 3);
      const kand = w.orte.filter(o => isFinite(+o.frac) && o.frac > 0.04 && o.frac < 0.96 && !hl.some(b => Math.abs(b - o.frac) < 0.03))
        .sort((a, b) => (rang(a) - rang(b)) || ((+a.abstand_m || 0) - (+b.abstand_m || 0)));
      const wahl = [];
      for (const o of kand) {
        if (wahl.length >= maxN) break;
        if (wahl.some(x => Math.abs(x.frac - o.frac) < 0.06)) continue;
        wahl.push(o);
      }
      return wahl.sort((a, b) => a.frac - b.frac);
    };
    const orteSchilder = () => (window.__rzOrteSchild ? orteGewaehlt().map(o => window.__rzOrteSchild(o, w.hlStil === "hl_editorial" ? { stil: "hl_editorial" } : null)).filter(Boolean) : []);
    const orteZeigen = () => {
      const e = box.querySelector("#va-orte-text"); if (!e) return;
      if (w.orte == null) { e.textContent = T("va.orte_suchen", "Orte und Pässe an der Strecke werden gesucht …"); return; }
      const g = orteGewaehlt();
      e.textContent = !w.orte.length ? T("va.orte_keine", "Keine Orte gefunden")
        : w.orteAn === false ? T("va.orte_aus", "{n} gefunden — aus", { n: w.orte.length })
        : g.map(o => o.name).join(" · ");
    };
    // 01.11.2026 — Gipfel am höchsten Punkt (höchstens 50 m daneben, Photon/OSM, ohne Netz: keiner)
    w.gipfel = null;
    const gipfelZeigen = () => {
      const f = box.querySelector("#va-gipfel-feld"), t_ = box.querySelector("#va-gipfel-text");
      if (f) f.hidden = !w.gipfel;
      if (t_ && w.gipfel) t_.textContent = w.gipfel.name + (w.gipfel.ele != null ? " · " + w.gipfel.ele + " m" : "");
    };
    if (ASS) {
      box.querySelector("#va-gipfel-an")?.addEventListener("change", (e) => { w.gipfelTitelAn = !!e.target.checked; });
      (async () => {
        const h = (v.pois || []).find(x => x && x.art === "hoechster" && isFinite(+x.lat) && isFinite(+x.lon) && isFinite(+x.bei));
        if (!h) return;
        let r = null;
        try { r = await api().ort_am_punkt(+h.lat, +h.lon, 50, true); } catch (_) { r = null; }   // warte-ok: Feld erscheint erst mit dem Ergebnis
        const o = r && r.ok ? r.ort : null;
        if (!o || o.art !== "gipfel" || !o.name || !box.isConnected) return;
        w.gipfel = { name: String(o.name), ele: isFinite(+o.ele) && +o.ele > 0 ? Math.round(+o.ele) : (isFinite(+h.ele) ? Math.round(+h.ele) : null), bei: +h.bei };
        try { applog("info", `[assistent] Gipfeltitel: ${w.gipfel.name} (${o.abstand_m} m neben dem höchsten Punkt)`); } catch (_) {}
        gipfelZeigen();
        if (w.gipfelTitelAn !== false) vaLive();
      })();
    }
    if (ASS) {
      box.querySelector("#va-orte-an")?.addEventListener("change", (e) => { w.orteAn = !!e.target.checked; orteZeigen(); });
      (async () => {
        let r = null;
        try { r = await api().highlights_vorschlaege(pfad, [], { osm: false, track: false, halte: false, orte: true }); } catch (_) { r = null; }   // warte-ok: Ladezeile im Reiter Infos
        w.orte = (r && r.ok) ? (r.vorschlaege || []).filter(x => x && x.grund === "orte") : [];
        try { applog("info", `[assistent] Orte unterwegs: ${w.orte.length} gefunden, ${orteGewaehlt().length} gewählt`); } catch (_) {}
        if (!box.isConnected) return;
        orteZeigen();
        if (w.orteAn !== false && orteGewaehlt().length) vaLive();
      })();
    }
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
        z.innerHTML = eigene.map(x => { const st = x.stil || {}, lk = st.look && window.rzLooks && window.rzLooks.LOOKS[st.look] ? st.look : "natuerlich";
          return `<button type="button" class="va-bk sv-vorlage-eigen${w.eigeneVorlage === x.id ? " is-on" : ""}" data-sv-eigen="${esc(x.id)}" title="${esc(T("va.v_eigen_tip", "Eigene Vorlage — Rechtsklick: löschen"))}">`
          + `<span class="va-bk-bild"><img class="va-look-bild" src="${(window.__rzAssetBase || "")}media/assistent/look_${lk}.jpg" alt=""><span class="va-stern">${I("star", 14)}</span><span class="va-haken">${I("check", 13)}</span></span>`
          + `<b>${esc(x.name)}</b><span class="va-bk-text">${esc([st.format, st.laenge === "eigen" ? (st.eigen_s + " s") : T("schnell." + (st.laenge || ""), st.laenge || "")].filter(Boolean).join(" · ") || T("va.v_eigen", "eigene Vorlage"))}</span></button>`; }).join("");
        { const ef = box.querySelector("#va-eigene-feld"); if (ef) ef.hidden = !eigene.length; }   // 01.11.2026 — im Reiter Video, gleich nach dem Merken sichtbar
        return;
      }
      z.innerHTML = eigene.map(x => `<button type="button" class="sv-vorlage sv-vorlage-eigen${w.eigeneVorlage === x.id ? " is-on" : ""}" data-sv-eigen="${esc(x.id)}" title="${esc(T("va.v_eigen_tip", "Eigene Vorlage — Rechtsklick: löschen"))}">`
        + `<span class="sv-vl-name">${vaIc("star", 13)} ${esc(x.name)}</span><span class="sv-vl-text">${esc(T("va.v_eigen", "eigene Vorlage"))}</span></button>`).join("");
    };
    const stilJetzt = () => {
      try { werteLesen(); } catch (_) {}
      const mu = box.querySelector("#sv-musik");
      return { vorlage: w.vorlage, format: w.format, laenge: w.laenge, eigen_s: w.eigenS, look: w.look || null, zahlen: an("sv-zahlen"), profil: an("sv-profil"),
               uebersicht: an("sv-uebersicht"), felder: w.felder.slice(), musik: mu ? mu.value : w.musik, kamera: w.kamera || null, flug: w.flug || null, foto_kreisen: !!w.fotoKreisen,
               kam_leb: isFinite(+w.kamLeb) ? +w.kamLeb : null, halte_dauer: w.halteDauer || null, halte_alle: typeof w.halteAlle === "boolean" ? w.halteAlle : null,
               text_menge: w.textMenge || null, foto_menge: isFinite(+w.fotoMenge) ? +w.fotoMenge : null, schluss_an: an("sv-schluss-an"),
               foto_art: w.fotoArt, highlights: an("sv-highlights"), hl_arten: w.hlArten ? [...w.hlArten] : null, gebaeude: an("sv-gebaeude"),
               // 26.10.2026 — Reiter wie im Web
               ...(ASS ? { hoehe: w.hoehe, laufpunkt: w.lp === "fahrzeug" ? w.lpFz : w.lp, linie: Object.assign({}, w.ls), beschriftung: Object.assign({}, w.beschr), gelaende: w.gelaende, ghost: w.ghost } : {}) };
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
        if (typeof st.foto_kreisen === "boolean") { w.fotoKreisen = st.foto_kreisen; const e = box.querySelector("#va-h-kreisen"); if (e) e.checked = w.fotoKreisen; }
        if (FLUGSTILE[st.flug]) { w.flug = st.flug; box.querySelectorAll("[data-va-flug]").forEach(b => b.classList.toggle("is-on", b.dataset.vaFlug === w.flug));
          box.querySelectorAll('[data-sv-gruppe="flug"] [data-sv-wert]').forEach(b => b.classList.toggle("is-on", b.dataset.svWert === w.flug)); }
        if (st.halte_dauer) { w.halteDauer = st.halte_dauer; box.querySelectorAll("[data-va-h-dauer]").forEach(b => b.classList.toggle("is-on", b.dataset.vaHDauer === w.halteDauer)); }
        if (typeof st.halte_alle === "boolean") w.halteAlle = st.halte_alle;
        if (st.text_menge) { w.textMenge = st.text_menge; box.querySelectorAll("[data-va-t-menge]").forEach(b => b.classList.toggle("is-on", b.dataset.vaTMenge === w.textMenge)); }
        if (st.foto_menge != null) w.fotoMenge = +st.foto_menge;
        if (ASS && Array.isArray(st.hl_arten)) w.hlArten = new Set(st.hl_arten.filter(a => HL_ARTEN.includes(a)));
        if (ASS) {
          if (["nah", "mittel", "hoch"].includes(st.hoehe)) { w.hoehe = st.hoehe; box.querySelectorAll("[data-va-hoehe]").forEach(b => b.classList.toggle("is-on", b.dataset.vaHoehe === w.hoehe)); }
          if (typeof st.laufpunkt === "string" && st.laufpunkt) { if (["arrow", "dot", "aus"].includes(st.laufpunkt)) w.lp = st.laufpunkt; else { w.lp = "fahrzeug"; w.lpFz = st.laufpunkt; } }
          vaDrohneHalten(w);   // 10.11.2026 — Drohnenflug behält die Drohne
          if (st.linie && typeof st.linie === "object") w.ls = Object.assign({}, st.linie);
          if (st.beschriftung && typeof st.beschriftung === "object") w.beschr = Object.assign({}, st.beschriftung);
          if (typeof st.gelaende === "boolean") w.gelaende = st.gelaende;
          if (typeof st.ghost === "boolean") w.ghost = st.ghost;
          if (st.foto_art) box.querySelectorAll("[data-va-fa]").forEach(b => b.classList.toggle("is-on", b.dataset.vaFa === w.fotoArt));
        }
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
      w.raster = !!box.querySelector("#va-raster")?.checked;   // 01.11.2026 — Streckenraster im Höhenprofil (wie die iOS-App)
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
      return { flug: w.flug || "begleiter", foto_kreisen: !!w.fotoKreisen, format: w.format, laenge: w.laenge === "animator" ? ((LAENGEN[L.laenge] || L.laenge === "eigen") ? L.laenge : "normal") : w.laenge, eigen_s: w.eigenS, qualitaet: w.qualitaet, stil: w.stil, zahlen: w.zahlen, profil: w.profil, profil_raster: !!w.raster, highlights: w.highlights, felder: w.felder,
               mehr_offen: w.mehrOffen, fotos_an: w.fotosAn, clips_an: w.clipsAn, clip_ton: w.clipTon, logbuch: w.logbuch,
               musik_an: w.musikAn, musik: w.musik, klick: w.klick, uebersicht: w.uebersicht, schluss_an: w.schlussAn, gebaeude: w.gebaeude,
               vorlage: w.vorlage, foto_art: w.fotoArt, sofort_groesse: w.sofortGroesse, foto_pause: w.fotoPause, angepasst: !!w.angepasst, tempo_regie: !!w.tempoRegie,
               ...(ASS ? { va: true, kamera: w.kamera, hoehe: w.hoehe, intro_s: w.introS, hold_s: w.holdS, erdkugel: w.introFlug === "erdkugel", intro_flug: w.introFlug || "ueberblick", schluss_flug: w.schlussFlug || "gesamtsicht", titel_an: w.titelAn !== false, fps: w.fps, einheiten: w.einheiten || null, pace: w.pace || "even",
                           logo_an: w.logoAn !== false, logo_lage: w.logoLage || "mitte", stil_id: w.stilId, orte_an: w.orteAn !== false, gipfel_titel: w.gipfelTitelAn !== false } : {}) };
    };
    // 26.10.2026 — was die Reiter Kamera (Höhe), Karte (Gelände, Beschriftung) und Linie (Laufpunkt, Linie, Vorab-Strecke)
    // gewählt haben, über den Look legen. Beschriftung ohne eigene Wahl: wie der Look (Satellit ohne Namen, die anderen mit).
    const beschrStand = (k) => (w.beschr && typeof w.beschr[k] === "boolean") ? w.beschr[k] : (w.look || (VORLAGEN[w.vorlage] || VORLAGEN.weite).look) !== "natuerlich";
    const VA_HOEHE_FAHRT = { nah: 1.0, mittel: 0, hoch: -1.0 }, VA_FOLGEN_HOEHE = { nah: 1.2, mittel: 0, hoch: -0.8 };   // wie gps-studio-web (studio.js HOEHE_NAH, FOLGEN_HOEHE)
    const vaPatch = (o) => {
      // Mitfliegen „Nah“/„Hoch“: die Fahrt eine Zoomstufe näher bzw. weiter weg (nicht Überblick/Schlussblick, die liegen
      // außerhalb 0…1 bzw. ≤ −0,1). 01.11.2026 — „Hoch“ ebenso über den Zoom, weil der Flugstil jetzt eigens gewählt wird
      const dh = (w.flug === "begleiter" && w.hoehe === "hoch") ? 0 : (VA_HOEHE_FAHRT[w.hoehe] || 0);   // Begleiter + Hoch = Reiseflughöhe (kamOptSetzen)
      if (w.kamera === "fahrt" && dh && Array.isArray(o.timeline_events)) {
        o.timeline_events = o.timeline_events.map(ev => (ev && ev.kind === "zoom" && typeof ev.value_offset === "number" && typeof ev.anchor === "number"
          && ev.anchor >= -1e-6 && ev.anchor <= 1 + 1e-6 && ev.value_offset > -0.1) ? Object.assign({}, ev, { value_offset: Math.round(Math.max(-2.4, ev.value_offset + dh) * 1e4) / 1e4 }) : ev);
      }
      if (w.stilAnimator) Object.assign(o, w.stilAnimator);   // 01.11.2026 — Linie der Stil-Vorlage; eigene Wahl (w.ls) gilt darüber
      if ((w.vv || w.vvEigen) && w.vvVerlauf) o.verlauf = JSON.parse(JSON.stringify(w.vvVerlauf));   // Verläufe der Videovorlage (oben/unten/links)
      if (typeof w.gelaende === "boolean") o.enable_terrain = w.gelaende;
      if (typeof w.bergnamen === "boolean") o.bergnamen_an = w.bergnamen;   // 01.11.2026
      VA_BESCHR.forEach(k => { o[VA_BESCHR_KEY[k]] = beschrStand(k); });
      if (w.lp === "aus") o.marker_dot_show = false;
      else { o.marker_dot_show = true; o.marker_dot_style = w.lp === "fahrzeug" ? (w.lpFz || "wanderer") : (w.lp || "arrow"); }
      const ls = w.ls || {}, LL = vaLookLinie();
      if (ls.farbe) o.line_color = ls.farbe;
      if (ls.breite != null && isFinite(+ls.breite)) o.line_width = +ls.breite;
      if (ls.strich) o.line_style = ls.strich;
      if (ls.kontur != null) o.kontur_breite = ls.kontur ? (+LL.kontur_breite || 2) : 0;
      if (ls.schatten != null) o.shadow_strength = ls.schatten ? 4 : 0;
      if (ls.leuchten != null) o.glow_strength = ls.leuchten ? 4 : 0;
      // 06.11.2026 — Röhre + Nachglühen
      if (typeof ls.roehre === "boolean") o.linie_3d = ls.roehre ? "roehre" : "flach";
      if (ls.kopf) o.kopf_3d = ls.kopf;
      if (ls.glanz != null && isFinite(+ls.glanz)) o.roehre_glanz = +ls.glanz;
      if (typeof ls.glut === "boolean" || ls.glutSek != null) o.nachgluehen_sek = r3Stand().sek;
      if (ls.glutLook) o.glut_look = ls.glutLook;
      if (typeof w.ghost === "boolean") o.ghost_track_enabled = w.ghost;
      if (w.einheiten && VA_EINHEITEN[w.einheiten]) Object.assign(o, VA_EINHEITEN[w.einheiten]);   // 01.11.2026 — Einheiten (gelten fürs ganze Projekt)
      o.pace_mode = (w.pace === "real" && vaHatZeit(v)) ? "real" : "even";   // 01.11.2026 — Verteilung über den Track
      return o;
    };
    /** Folgen (genordet): die App setzt je Tour eine Höhe (anim-zoom) — Nah/Hoch darauf. Die Basis nur neu lesen, wenn dort
     *  nicht mehr unser Wert steht (sonst wanderte „Hoch“ bei jedem Schreiben weiter nach oben; Klicktest Web 25.10.2026). */
    let fzBasis = null, fzGesetzt = null;
    const vaFolgenHoehe = () => {
      if (w.kamera !== "folgen") return;
      const z = document.getElementById("anim-zoom"); if (!z) return;
      if (fzBasis == null || fzGesetzt == null || Math.abs(+z.value - fzGesetzt) > 0.01) fzBasis = +z.value || 12;
      const soll = Math.max(+z.min || 0, Math.min(+z.max || 18, fzBasis + (VA_FOLGEN_HOEHE[w.hoehe] || 0)));
      fzGesetzt = soll;
      if (Math.abs(+z.value - soll) > 0.01) { z.value = String(soll); z.dispatchEvent(new Event("input", { bubbles: true })); z.dispatchEvent(new Event("change", { bubbles: true })); }
    };
    /** In das offene Projekt schreiben: ein ⌘Z-Schritt („Schnell-Video übernommen"), vorher ein Arbeitsstand.
     *  11.10.2026 — Video-Assistent: `modus = "live"` schreibt nach jeder Stufe OHNE ⌘Z-Schritt (das Fenster bleibt
     *  offen, der Animator zeigt es sofort); „Fertig" macht daraus EINEN Schritt vom Stand vor dem Assistenten. */
    const uebernehmen = async (modus) => {
      const live = ASS && modus === "live";
      // 01.11.2026 (Marc: „Scrubber hin und her geschoben, dann im Assistenten etwas geändert — der Scrubber springt zurück“)
      const tVorher = live && window.__rzTpZeit ? window.__rzTpZeit() : null;
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
      // 07.10.2026 (Web-Version) — neue Länge → die gespeicherte Raffung des vorigen Schnell-Videos verwerfen; sonst
      // rechnete die Tempo-Kurve mit ihr weiter und schrieb die alte Dauer zurück ins Feld (12,8 statt 33 s)
      voll.tempo_rate = null; voll.tempo_basis = null;
      if (ASS) vaPatch(voll);
      const patch = look ? nurAblauf(voll) : voll;
      if (!ASS) m.close();
      if (P.keyframes > 0 && !kfBestaetigt) {
        const ja = await window.rzConfirm(T("schnell.kf_frage_titel", "Keyframes ersetzen?"),
          T("schnell.kf_warnung", "Das Projekt hat schon {n} Keyframes — sie werden durch die Kamerafahrt ersetzt (⌘Z holt sie zurück).").replace("{n}", P.keyframes),
          T("schnell.kf_ersetzen", "Ersetzen"), true, { nurKnoepfe: ASS });
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
                     : await rzWarten("schnellvideo_uebernehmen", () => api().schnellvideo_uebernehmen(P.id, patch, letzte, schilder)); }   // 01.11.2026 — auch der Assistent merkt sich seine Wahl   // 08.10.2026 — der Assistent merkt sich nichts für das Schnell-Video (sonst startete das nächste Schnell-Video mit den Assistenten-Werten)
      catch (e) { r = { ok: false, error: String(e) }; }
      laeuft = false;
      if (st_) st_.hidden = true;
      if (!r || !r.ok) { toast((r && r.error) || T("common.error", "Fehler"), "error", 6000); return; }
      // 12.10.2026 — inzwischen ein anderes Modul offen: gespeichert ist es, den Rest (Animator anwenden, Blickrichtung,
      // Highlight-Schilder) holt die Rückkehr in den Animator nach (beimAnimator → vaLive); die Karte ist gerade abgebaut
      // 01.11.2026 — nach „Abbrechen“ nichts mehr nachschreiben (sonst landeten Highlight-Schilder in der frisch geladenen Tour)
      const imAnimator = () => !vaEnde && !(typeof window.getActiveMod === "function" && window.getActiveMod() !== "animator");
      if (live && !imAnimator()) return;
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
      if (live && !imAnimator()) return;
      // 27.10.2026 — Assistent mit Folgen (genordet) oder Ganze Tour: keine Blickrichtungs-Keyframes
      try { window.__rzUndoApplying = true; if (ASS) vaFolgenHoehe(); const n = (window.__rzSchnellKamera && !(ASS && w.kamera && w.kamera !== "fahrt")) ? window.__rzSchnellKamera(kursOpts(w)) : 0; applog("info", `[schnell] ${live ? "live" : "übernommen"} in ${P.id} · Look ${look ? "behalten" : "neu"} · Blickrichtung ${n} Keyframes`); }
      catch (e) { try { applog("warn", "[schnell] Blickrichtung: " + e); } catch (_) {} }
      finally { setTimeout(() => { window.__rzUndoApplying = false; }, 0); }
      // Highlight-Schilder abgleichen — bis der Track mit den neuen Einstellungen steht (max. ~6 s)
      // (ohne Highlights einmal abgleichen: entfernt vorhandene automatische Highlight-Schilder)
      if (!patch.highlights_enabled) { try { if (window.__rzHlAbgleichen) window.__rzHlAbgleichen(); } catch (_) {} }
      else {
        for (let i = 0; i < (live ? 4 : 12); i++) {
          if (live && !imAnimator()) return;
          let n = 0;
          try { n = window.__rzHlAbgleichen ? window.__rzHlAbgleichen() : 0; } catch (_) {}
          if (n > 0) { applog("info", `[schnell] ${n} Highlight-Schilder`); break; }
          await new Promise(res => setTimeout(res, 500));
        }
      }
      if (live) {
        try {
          // selbst geschoben (Zeit ≠ die Stelle, die der Assistent zuletzt angefahren hat) → dort bleiben, sonst die Stelle des Reiters
          const selbst = tVorher != null && isFinite(tVorher) && (!vaStelle || Math.abs(tVorher - vaStelle.t) > 0.1);
          if (selbst && window.__rzGeheZuZeit) window.__rzGeheZuZeit(tVorher); else vaVorschauStelle();
        } catch (e) { if (window.rzSwallow) rzSwallow(e, "assistent:stelle"); }
        return;
      }
      if (ASS) { m.close(); vaBericht(vaListe); toast(T("va.uebernommen", "Der Assistent hat dein Projekt eingerichtet — alles ist bearbeitbar, ⌘Z nimmt es zurück."), "success", 6000); return true; }
      else toast(T("schnell.uebernommen", "Schnell-Video übernommen — die Keyframes kannst du jetzt anpassen."), "success", 5000);
    };
    /** 11.10.2026 — Assistent abbrechen: den Stand von vorher zurückschreiben (ohne ⌘Z-Schritt) und das Fenster schließen. */
    const vaAbbrechen = async () => {
      vaEnde = true;
      clearTimeout(liveTimer);
      for (let i = 0; i < 100 && laeuft; i++) await new Promise(res => setTimeout(res, 100));
      const ctrl = window.__rzUndoControllers && window.__rzUndoControllers.animator;
      // 01.11.2026 — vorläufiges Projekt: nicht zurückschreiben (das Zurücksetzen speicherte abgeleitete Farben und legte
      // damit gleich wieder ein Projekt an), sondern löschen und die Tour frisch laden
      if (VORL) {
        ausgang = null;
        m.close();
        await vaVorlaeufigWeg();
        try { if (window.loadGlobalGpx) await window.loadGlobalGpx(pfad, { stumm: true }); } catch (e) { try { applog("warn", "[assistent] Tour neu laden: " + e); } catch (_) {} }
        // Nachzügler des verworfenen Stands (Highlight-Abgleich nach dem Laden) noch kurz abwarten, dann wieder normal speichern
        setTimeout(() => { try { if (window.rzFestschreibenFrei) window.rzFestschreibenFrei(); } catch (_) {} }, 3000);
        toast(T("va.abgebrochen_tour", "Abgebrochen — es wurde nichts gespeichert."), "info", 4000);
        return;
      }
      if (ausgang && ctrl && typeof ctrl.anwenden === "function") {
        ctrl.anwenden(JSON.parse(JSON.stringify(ausgang)));
        toast(T("va.abgebrochen", "Abgebrochen — dein Projekt steht wieder wie vorher."), "info", 4000);
        try { applog("info", "[assistent] abgebrochen · Stand vorher wiederhergestellt"); } catch (_) {}
      }
      ausgang = null;
      m.close();
    };
    /** 01.11.2026 — Abbrechen bei einer Tour aus dem Archiv: das vorläufige Projekt wieder löschen, die Tour bleibt offen
     *  wie vorher (schwebend, nichts gespeichert). */
    const vaVorlaeufigWeg = async () => {
      try {
        if (window.rzProjektLoslassen) window.rzProjektLoslassen(P.id, 15000);   // bis die Tour frisch geladen ist (s. vaAbbrechen)
        const r = await api().projekt_loeschen(P.id);   // warte-ok: Millisekunden
        applog("info", `[assistent] vorläufiges Projekt ${P.id} ${r && r.ok ? "gelöscht" : "nicht gelöscht: " + ((r && r.error) || "?")}`);
      } catch (e) { try { applog("warn", "[assistent] vorläufiges Projekt löschen: " + e); } catch (_) {} }
    };
    let vaEnde = false;   // „Abbrechen“ gedrückt — laufendes Live-Schreiben hört auf (s. uebernehmen)
    /** Nach einer Antwort kurz warten, dann in den Animator schreiben (mehrere Klicks = ein Schreibvorgang). */
    const vaLive = () => {
      if (!ASS) return;
      clearTimeout(liveTimer);
      liveTimer = setTimeout(() => { uebernehmen("live").catch((e) => { try { applog("warn", "[assistent] live: " + e); } catch (_) {} }); }, 250);
    };
    // 11.10.2026 (Marc: „Bei welche Momente sollen vorkommen sollten die Schilder auch direkt auf der Karte zu sehen sein“ ·
    // „bei wie soll das Video heißen bzw. bei der Schlusskarte muss der Scrubber dorthin springen, wo man sieht, was man
    // einstellt“) — je Stufe die passende Stelle im Animator: Geschichte/Fotos/Halte = Überblick mit allen Schildern,
    // Texte = Titel (1,5 s), Karte/Einblendungen = Mitte der Fahrt, Schluss = Schlusskarte (1 s vor Ende).
    let vaSeiteJetzt = 0;
    let vaStelle = null;   // die Zeit, die der Assistent zuletzt angefahren hat ({ t }) — weicht der Scrubber ab, hat man selbst geschoben
    /** Karte/Einblendungen: eine Stelle der Fahrt nahe der Mitte, an der kein Fotostopp das Bild verdeckt (Klicktest 12.10.2026). */
    const freieStelle = (ph) => {
      const fenster = (window.__rzFotostoppFenster ? window.__rzFotostoppFenster() : []) || [];
      for (const a of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.12, 0.9, 0.05]) {
        const t = ph.intro + ph.anim * a;
        if (!fenster.some(([v, b]) => t >= v && t <= b)) return t;
      }
      return ph.intro + 0.6;
    };
    const VA_ALLE_SCHILDER = { 1: true, 6: true, 7: true };
    const vaVorschauStelle = () => {
      if (!ASS || !vaSeiteJetzt) return;
      const S_ = vaSeiteJetzt;
      try { if (window.__rzAnimSigns && window.__rzAnimSigns.alleZeigen) window.__rzAnimSigns.alleZeigen(!!VA_ALLE_SCHILDER[S_]); } catch (e) { if (window.rzSwallow) rzSwallow(e, "assistent:alle_schilder"); }
      const ph = window.__rzVideoPhasen ? window.__rzVideoPhasen() : null;
      if (!ph || !window.__rzGeheZuZeit) return;
      // Geschichte/Fotos/Halte (Klicktest 12.10.2026: am Fahrtbeginn sah man nur den Start, die Schilder lagen außerhalb):
      // kurz vor Ende der Fahrt — die ganze Linie ist gezeichnet — und die Kamera auf die ganze Tour
      const ueberblick = !!VA_ALLE_SCHILDER[S_];
      const t = ueberblick ? Math.max(0, ph.intro + ph.anim - 0.2)
        : { 1: Math.min(1.5, ph.intro), 9: freieStelle(ph), 2: freieStelle(ph), 3: freieStelle(ph), 4: freieStelle(ph), 5: 1.5, 8: Math.max(0, ph.G - 1) }[S_];
      if (t != null) { window.__rzGeheZuZeit(Math.min(t, ph.G)); vaStelle = { t: (window.__rzTpZeit && window.__rzTpZeit()) ?? Math.min(t, ph.G) }; }
      if (ueberblick && window.__rzGesamtsicht) setTimeout(() => { if (vaSeiteJetzt === S_) window.__rzGesamtsicht(); }, 350);
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
    // 03.11.2026 — Videovorlage ohne Assistent (Kommandozeile): Linie, Verläufe, Bergnamen und Laufpunkt der Vorlage wie in
    // vaPatch; Kamera, Beschriftung und Gelände bleiben beim Schnell-Video (vaPatch setzt die nach den Reitern des Assistenten)
    const vorlagePatch = (o) => {
      if (ASS || !w.stilId) return o;
      if (w.stilAnimator) Object.assign(o, w.stilAnimator);
      if ((w.vv || w.vvEigen) && w.vvVerlauf) o.verlauf = JSON.parse(JSON.stringify(w.vvVerlauf));
      if (typeof w.bergnamen === "boolean") o.bergnamen_an = w.bergnamen;
      if (w.lp === "aus") o.marker_dot_show = false;
      else if (w.lp) { o.marker_dot_show = true; o.marker_dot_style = w.lp === "fahrzeug" ? (w.lpFz || "wanderer") : w.lp; }
      return o;
    };
    const los = async (rendern) => {
      if (laeuft) return; laeuft = true;
      _svStartet = true;   // Dialog geht gleich zu — bis das Projekt angelegt ist, keinen zweiten Start
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
        r = rendern ? await api().schnellvideo_anlegen(pfad, name, vorlagePatch(animatorPatch(w, v)), letzte, schilder)   // warte-ok: eigener Bildschirm zeigt den Schritt
          : await rzWarten("schnellvideo_anlegen", () => api().schnellvideo_anlegen(pfad, name, vorlagePatch(animatorPatch(w, v)), letzte, schilder));
      } catch (e) { r = { ok: false, error: String(e) }; }
      _svStartet = false;
      if (!r || !r.ok) {
        laeuft = false;
        if (B) { B.fehler((r && r.error) || T("common.error", "Fehler")); B.knopf("schliessen").onclick = () => B.zu(); }
        else toast((r && r.error) || T("common.error", "Fehler"), "error", 6000);
        return;
      }
      try { applog("info", `[schnell] Projekt ${r.project_id} · ${w.format} · ${w.laenge} · ${w.qualitaet} · ${w.stil}${w.stilId ? " · Videovorlage " + w.stilId : ""} · rendern=${rendern}`); } catch (_) {}
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
      try { const n = window.__rzSchnellKamera ? window.__rzSchnellKamera(kursOpts(w)) : 0; applog("info", `[schnell] Blickrichtung (${w.flug || "begleiter"}): ${n} Keyframes`); } catch (e) { try { applog("warn", "[schnell] Blickrichtung: " + e); } catch (_) {} }
      window.__rzSchnellFertig = { id: r.project_id, name: v.name || "" };   // 13.10.2026 — Kommandozeile (core/cli): Projekt steht, Animator bereit
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
    // 01.11.2026 — „Ins Projekt übernehmen“: ein vorläufiges Projekt (Tour aus dem Archiv) wird dabei zum richtigen Projekt
    if (P) document.getElementById("sv-uebernehmen").onclick = async () => {
      const ok = await uebernehmen("fertig");
      if (ok && VORL) { try { await api().projekt_herkunft_setzen(P.id, null); } catch (e) { try { applog("warn", "[assistent] Projekt festschreiben: " + e); } catch (_) {} } }   // warte-ok: Millisekunden
    };
    // 29.10.2026 (Marc: „Wenn ich rechts oben auf das X klicke, kann ich das Fenster nicht zumachen. Es geht nur durch
    // Verwerfen unten.“ → ✕ schließt und verwirft) — vorher fragte das ✕ unten in der Fußleiste „Assistent beenden?“, weit
    // weg vom ✕; das Fenster wirkte unschließbar. ✕ = „Abbrechen“: alles zurücknehmen, schließen. Behalten = „Übernehmen“.
    if (ASS) { document.getElementById("va-abbrechen").onclick = () => vaAbbrechen(); m.onX = () => vaAbbrechen(); }
    const svR = document.getElementById("sv-rendern"); if (svR) svR.onclick = () => los(true);

    // ── 08.10.2026 — Video-Assistent: Seite für Seite, jede überspringbar, am Ende ein ⌘Z-Schritt ──
    if (ASS) {
      // 11.10.2026 — „Die Geschichte“ direkt nach „Was für ein Video“, dann Fotos, dann der Look
      // 11.10.2026 — Reihenfolge: erst die Geschichte, dann Bild und Text, zum Schluss der Look
      // 26.10.2026 — die acht Reiter der Web-Version; wie dort beginnt es nach dem Laden bei „Kamera“
      const NAMEN = [null, T("va.fl_reiter", "Format"), T("va.w.s8_kamera", "Kamera"), T("va.w.s8_look", "Karte"), T("va.w.s8_linie", "Linie"),
                     T("va.w.s8_titel", "Titel"), T("va.w.s8_fotos", "Fotos"), T("va.w.s8_infos", "Infos"), T("va.w.s8_video", "Video")];
      const LETZTE = NAMEN.length - 1;
      NAMEN[9] = T("va.stil_reiter", "Stil");
      // 01.11.2026 — Reihenfolge der Reiter: Format, Stil (Seite 9), Kamera … Video (Seitennummern bleiben, Prüfstand/Tests)
      const ORDNUNG = [1, 9, 2, 3, 4, 5, 6, 7, 8];
      const naechste = (s) => ORDNUNG[ORDNUNG.indexOf(s) + 1];
      let seite = 1;   // 01.11.2026 — Start bei „Format“ (Punkt 1)
      const zusammenfassung = () => {
        try { werteLesen(); } catch (_) {}
        const stopps = (() => { try { return stoppsJetzt().length; } catch (_) { return 0; } })();
        const ohneHalt = (() => { try { return fotoArtJetzt() !== "gross" ? ohneHaltJetzt().length : 0; } catch (_) { return 0; } })();
        const artText = { gross: halteAn() ? T("va.fa_gross", "groß mit Halt") : T("va.fa_gross_ohne", "groß, ohne Halt"), sofortbild: T("va.fa_sofort", "als Sofortbild"), pip: T("va.fa_pip", "als Bild im Bild") }[(() => { try { return fotoArtJetzt(); } catch (_) { return "gross"; } })()] || "";
        const schilder = (() => { try { return schilderJetzt().length; } catch (_) { return stopps; } })();
        const einbl = [w.zahlen && T("va.e_zahlen", "Zahlen unterwegs"), w.profil && T("va.e_profil", "Höhenprofil")].filter(Boolean);
        const nHl = w.highlights && w.hlArten ? hlListe().filter(h => w.hlArten.has(h.art)).length : 0;
        const mu = box.querySelector("#sv-musik"), muText = mu && mu.selectedOptions && mu.selectedOptions[0] ? mu.selectedOptions[0].textContent.trim() : "";
        const kam = { fahrt: T("va.w.k_mitfliegen", "Mitfliegen"), folgen: T("va.w.k_folgen_nord", "Folgen (genordet)"), fest: T("va.w.k_ganze_tour", "Ganze Tour") }[w.kamera] || "";
        const lpText = w.lp === "fahrzeug" ? (box.querySelector("#va-lp-fz")?.selectedOptions?.[0]?.textContent || T("va.w.lp_fahrzeug", "Fahrzeug"))
          : { arrow: T("va.w.lp_pfeil", "Pfeil"), dot: T("va.w.lp_kugel", "Kugel"), leucht: T("va.lp_leucht", "Leuchtpunkt"), aus: T("va.w.lp_aus", "Aus") }[w.lp] || "";
        const r3L = r3Stand(), lpText2 = (r3L.roehre && r3L.kopf !== "punkt") ? T("animator.kopf3d." + r3L.kopf, r3L.kopf) : lpText;   // 08.11.2026 Kopf der Röhre
        vaListe = [
          ["tag", T("va.l_titel", "Titel"), [w.titel, w.unter].filter(Boolean).join(" · ") || "—"],
          ["clapperboard", T("va.l_format", "Format und Länge"), `${w.format} · ${laengeS(w)} s`],
          ["map", T("va.l_karte", "Karte"), T("look." + w.look, w.look) + (w.gebaeude ? " · " + T("va.gebaeude_kurz", "3D-Häuser") : "")],
          ["chart-column", T("va.l_einbl", "Einblendungen"), einbl.join(", ") || T("va.keine", "keine")],
          ["camera", T("va.l_fotos", "Fotos"), w.fotosAn ? T("va.l_fotos_n2", "{n} Fotos {art}", { n: stopps + ohneHalt, art: artText }) : T("va.aus", "aus")],
          ["flag", T("va.l_schilder", "Schilder"), (schilder === 1 ? T("va.l_schilder_1", "1 Schild an der Strecke") : T("va.l_schilder_n", "{n} Schilder an der Strecke", { n: schilder })) + (an("sv-logbuch") ? " · " + T("va.l_logbuch", "mit Logbuch") : "") + (nHl ? " · " + (nHl === 1 ? T("va.l_hl_1", "1 besonderer Moment") : T("va.l_hl_n", "{n} besondere Momente", { n: nHl })) : "")],
          ["pause", T("va.l_halte", "Halte"), !halteAn() ? T("va.l_halte_aus", "fährt durch") : T("va.l_halte_n", "an {n} Foto-Schildern · {d}", { n: stopps, d: T("va.h_" + (w.halteDauer || "normal"), w.halteDauer || "normal") })],
          ["video", T("va.l_kamera", "Kamera"), kam],
          ["music", T("va.l_musik", "Musik"), w.musikAn ? (muText || "✓") : T("va.aus", "aus")],
          ["milestone", T("va.l_schluss", "Schlusskarte"), w.schlussAn ? (w.felder.length + " " + T("va.l_werte", "Werte")) : T("va.aus", "aus")],
          ["route", T("va.laufpunkt", "Laufpunkt"), lpText2],   // 26.10.2026 — hinten anfügen: die Zeilen unten lesen die Liste nach Stelle
        ];
        // 12.10.2026 (neue Optik) — kurz, je Zeile ein Sprung zurück zum Schritt
        const [wTitel, , wKarte, , wFotos, wSchilder, wHalte, , wMusik] = vaListe.map(x => x[2]);
        const zeilen = [
          ["palette", T("va.stil_reiter", "Stil"), vaStilName(w.stilId || VA_STIL_STANDARD), 9],
          ["clapperboard", T("va.fl_h", "Format und Länge"), `${w.format} · ${laengeS(w)} s · ${T("va.intro", "Intro")} ${String(introS(w)).replace(".", ",")} s · ${T("va.schluss_dauer", "Schluss")} ${String(holdS(w)).replace(".", ",")} s`, 1],
          ["video", T("va.l_kamera", "Kamera"), [kam, w.kamera === "fahrt" && FLUGSTIL_TEXT[w.flug] ? T("schnell.flug." + w.flug, FLUGSTIL_TEXT[w.flug][0]) : "",   // 01.11.2026 — mit Flugstil
            w.kamera !== "fest" ? T("va.w.h_" + (w.hoehe || "mittel"), w.hoehe || "") : ""].filter(Boolean).join(" · "), 2],
          ["map", T("va.l_karte", "Karte"), wKarte, 3],
          ["route", T("va.w.linie_aussehen", "Linie"), lpText2, 4],
          ["type", T("va.u_texte", "Texte"), w.titelAn === false ? T("va.kein_titel", "ohne Titel") : wTitel, 5],
          ["image", T("va.l_fotos", "Fotos"), [wFotos, w.fotosAn ? wHalte : ""].filter(Boolean).join(" · "), 6],
          ["map-pin", T("va.w.s8_infos", "Infos"), [einbl.length ? einbl.join(", ") : "", wSchilder, w.schlussAn ? T("va.u_schluss", "Schlusskarte mit {n} Werten", { n: w.felder.length }) : ""].filter(Boolean).join(" · "), 7],
          ["music", T("va.l_musik", "Musik"), wMusik, 8],
        ];
        const ul = box.querySelector("#va-liste");
        if (ul) ul.innerHTML = zeilen.map(([ic, k, v2, s_]) => `<div class="va-u-zeile"><span class="va-u-ic">${I(ic, 18)}</span><span class="va-g-text"><b>${esc(k)}</b><small>${esc(v2 || "—")}</small></span>`
          + `<button type="button" class="va-link" data-va-geh="${s_}">${esc(T("va.aendern", "Ändern"))} ${I("chevron-right", 14)}</button></div>`).join("");
        ul && ul.querySelectorAll("[data-va-geh]").forEach(b => { b.onclick = () => { seite = +b.dataset.vaGeh; zeigen(); }; });
      };
      const zeigen = () => {
        box.querySelectorAll("[data-va]").forEach(e => e.classList.toggle("va-weg", +e.dataset.va !== seite));
        const k = box.querySelector("#va-kopf");
        if (k) k.innerHTML = `<div class="va-reiter" role="tablist">${ORDNUNG.map((s_, i) => `<button type="button" role="tab" class="va-reiter-k${s_ === seite ? " is-on" : ""}" aria-selected="${s_ === seite}" data-va-geh="${s_}"><span class="n">${i + 1}</span><span>${esc(NAMEN[s_])}</span></button>`).join("")}</div>`;
        k && k.querySelectorAll("[data-va-geh]").forEach(b => { b.onclick = () => { seite = +b.dataset.vaGeh; zeigen(); }; });
        const z = document.getElementById("va-zurueck"), wt = document.getElementById("va-weiter"), sk = document.getElementById("va-skip"), ue = document.getElementById("sv-uebernehmen");
        if (z) z.hidden = true;
        if (wt) { wt.hidden = seite === LETZTE; if (seite !== LETZTE) wt.innerHTML = `<span>${esc(T("va.w.s8_weiter", "Weiter: {s}", { s: NAMEN[naechste(seite)] }))}</span>${I("arrow-right", 17)}`; }
        // 01.11.2026 (Marc: „immer da“) — „Video erstellen …“ und „Ins Projekt übernehmen“ auf jedem Reiter
        const er = document.getElementById("va-erstellen"); if (er) er.hidden = false;
        if (sk) sk.hidden = true;
        if (ue) ue.hidden = false;
        // Clips nur auf der sichtbaren Seite abspielen
        box.querySelectorAll("video").forEach(vd => { try { if (!vd.closest(".va-weg") && !ruhig && !vd.classList.contains("va-clip-hover")) { const p_ = vd.play(); if (p_ && p_.catch) p_.catch(() => {}); } else vd.pause(); } catch (_) {} });
        box.scrollTop = 0;
        if (seite === LETZTE) zusammenfassung();
        if (seite === LETZTE) { const ef = box.querySelector("#va-eigene-feld"), se = box.querySelector("#sv-eigene"); if (ef) ef.hidden = !(se && se.children.length); }
        if (seite === 2) vaKamera();
        if (seite === 3) vaKarte();
        if (seite === 4) vaLinie();
        if (seite === 5) vaTexte();
        if (seite === 6) { try { fotosZeigen(); } catch (_) {} vaHalte(); }
        if (seite === 7) vaGeschichte();
        vaLive();
        vaLeuchten(seite);
        vaSeiteJetzt = seite; vaVorschauStelle();
        try { applog("info", `[assistent] Seite ${seite} · ${NAMEN[seite]}`); } catch (_) {}
      };
      // 01.11.2026 — Flugstil-Clips laufen nur unter der Maus (zehn Clips gleichzeitig wären zu viel)
      box.addEventListener("mouseover", (e) => { const vd = e.target.closest("[data-va-flug]")?.querySelector("video"); if (vd && !ruhig) { try { const p_ = vd.play(); if (p_ && p_.catch) p_.catch(() => {}); } catch (_) {} } });
      box.addEventListener("mouseout", (e) => { const b = e.target.closest("[data-va-flug]"); if (b && !b.contains(e.relatedTarget)) { try { b.querySelector("video").pause(); } catch (_) {} } });
      document.getElementById("va-zurueck").onclick = () => { if (seite > 1) { seite--; zeigen(); } };
      document.getElementById("va-weiter").onclick = () => { if (seite !== LETZTE) { seite = naechste(seite); zeigen(); } };
      document.getElementById("va-skip").onclick = () => { if (seite < LETZTE) { seite++; zeigen(); } };   // Vorschlag lassen, wie er ist (Prüfstand)
      // „Video erstellen …“: übernehmen (ein ⌘Z-Schritt), dann der Export-Dialog des Animators — wie „Video erstellen“ im Web
      document.getElementById("va-erstellen").onclick = async () => {
        await uebernehmen("fertig");
        for (let i = 0; i < 40; i++) {
          const q = document.getElementById("anim-render");
          if (q && !q.disabled && window.__rzExportDialogOeffnen) { window.__rzExportDialogOeffnen(); return; }
          await new Promise(res => setTimeout(res, 250));
        }
        toast(T("va.erstellen_spaeter", "Das Projekt ist eingerichtet — exportiere es oben rechts mit „Video exportieren“."), "info", 5000);
      };
      // ── 26.10.2026 — „?“: Hilfetext und Clips aufklappen (Capture, damit der Klick keinen Schalter umlegt und nichts schreibt) ──
      box.addEventListener("click", (e) => {
        const k = e.target.closest("[data-va-hilfe]"); if (!k) return;
        e.preventDefault(); e.stopPropagation();
        const key = k.dataset.vaHilfe, bx = box.querySelector(`[data-va-hilfe-box="${key}"]`); if (!bx) return;
        const auf = bx.hidden;
        if (auf && !bx.innerHTML) {   // der Text steht im Tooltip des „?“ — hier nur die Clips
          bx.innerHTML = `<div class="va-hilfe-clips">${(HILFE_CLIPS[key] || []).map(([cap, f]) =>
            `<figure><video src="${(window.__rzAssetBase || "")}media/hilfe/${f}.mp4"${ruhig ? " controls" : " autoplay"} loop muted playsinline preload="auto"></video>${cap ? `<figcaption>${esc(T("va.w." + cap, cap))}</figcaption>` : ""}</figure>`).join("")}</div>`;
        }
        bx.hidden = !auf; k.setAttribute("aria-expanded", String(auf)); k.classList.toggle("is-on", auf);
        bx.querySelectorAll("video").forEach(vd => { try { if (auf && !ruhig) { const p_ = vd.play(); if (p_ && p_.catch) p_.catch(() => {}); } else vd.pause(); } catch (_) {} });
      }, true);
      // Wechselnde Hinweise (Texte, Fotos, Halte, Momente) schreibt der Code weiter in versteckte Felder — hier landen sie
      // als Tooltip am passenden „?“
      const vaTipSpiegel = () => {
        const txt = (id) => ((box.querySelector("#" + id) || {}).textContent || "").trim();
        const setz = (el, t) => { if (el) { el.dataset.tip = t; el.hidden = !t; } };
        setz(box.querySelector("#va-t-erkl-q"), txt("va-t-erkl"));
        setz(box.querySelector("#sv-fotos-info-q"), txt("sv-fotos-info"));
        setz(box.querySelector("#va-h-lead-q"), [txt("va-h-lead"), T("va.h_alle_tip", "Damit man die Bilder in Ruhe ansehen kann. Aus: die Fahrt läuft weiter, das Foto steht kurz daneben.")].filter(Boolean).join(" "));
        const hk = box.querySelector('[data-va-hilfe="z_highlights"]');
        if (hk) hk.dataset.tip = [T("va.w.hilfe_z_highlights", ""), txt("va-g-lead"), txt("va-g-kapitel")].filter(Boolean).join(" ");
      };
      const spiegelBeob = new MutationObserver(vaTipSpiegel);
      ["va-t-erkl", "sv-fotos-info", "va-h-lead", "va-g-lead", "va-g-kapitel"].forEach(id => { const e = box.querySelector("#" + id); if (e) spiegelBeob.observe(e, { childList: true, characterData: true, subtree: true }); });
      vaTipSpiegel();
      // Kamera: Höhe
      box.querySelector("#va-hoehe")?.addEventListener("click", (e) => {
        const b = e.target.closest("[data-va-hoehe]"); if (!b) return;
        w.hoehe = b.dataset.vaHoehe;
        box.querySelectorAll("[data-va-hoehe]").forEach(x => x.classList.toggle("is-on", x === b));
        kamOptSetzen(); vaLive();
      });
      // Stil: Vorlage anwenden (01.11.2026) — setzt die Werte und zeigt sie in den übrigen Reitern
      box.querySelector("#va-stile")?.addEventListener("click", (e) => {
        const b = e.target.closest("[data-va-stil]"); if (!b) return;
        vaStilWerte(w, b.dataset.vaStil);
        box.querySelectorAll("[data-va-stil]").forEach(x => x.classList.toggle("is-on", x === b));
        const setz = (id, an_) => { const c = box.querySelector("#" + id); if (c) c.checked = !!an_; };
        setz("sv-zahlen", w.zahlen); setz("sv-profil", w.profil); setz("va-bergnamen", w.bergnamen); setz("va-logo-an", true); setz("sv-uebersicht", w.uebersicht);
        const rz = box.querySelector("#va-raster-zeile"); if (rz) rz.hidden = !w.profil;
        const lt = box.querySelector("#va-logo-teil"); if (lt) lt.hidden = false;
        box.querySelectorAll("[data-va-fa]").forEach(x => x.classList.toggle("is-on", x.dataset.vaFa === w.fotoArt));
        try { vaLinie(); vaKarte(); } catch (_) {}
        try { applog("info", `[assistent] Stil-Vorlage ${w.stilId}`); } catch (_) {}
        vaLive();
      });
      // 02.11.2026 — .rzstyle: gewählten Stil exportieren (eingebaut oder eigen; „Klassisch“ ist keine Videovorlage) / einlesen
      const vaRzKnopf = () => { const b = box.querySelector('[data-va-rzstyle="export"]'); if (b) b.disabled = !(VA_STILE[w.stilId] && (VA_STILE[w.stilId].vv || VA_STILE[w.stilId].eigen)); };
      box.querySelector("#va-stile")?.addEventListener("click", () => vaRzKnopf());
      box.querySelector(".va-rzstyle")?.addEventListener("click", async (e) => {
        const b = e.target.closest("[data-va-rzstyle]"); if (!b || !window.rzStyle) return;
        if (b.dataset.vaRzstyle === "export") {
          const S = VA_STILE[w.stilId]; if (!S) return;
          if (S.eigen) await window.rzStyle.exportieren({ eigen: S.eigen });
          else if (S.vv) await window.rzStyle.exportieren(S.vv);
          return;
        }
        const r = await window.rzStyle.importieren(w.format);
        if (r && Array.isArray(r.liste)) {
          vaEigeneVideovorlagen(r.liste);
          const st = box.querySelector("#va-stile");
          if (st) st.innerHTML = VA_STIL_NAMEN.map(k => vaStilKarte(k, k === w.stilId)).join("");
          vaRzKnopf();
        }
      });
      // Video: Logo an/aus und Lage (01.11.2026, wie die iPhone-App)
      box.querySelector("#va-logo-an")?.addEventListener("change", (e) => { w.logoAn = !!e.target.checked; const t_ = box.querySelector("#va-logo-teil"); if (t_) t_.hidden = !w.logoAn; });
      box.querySelector("[data-va-logo]")?.addEventListener("click", (e) => {
        const b = e.target.closest("[data-va-logo-w]"); if (!b) return;
        w.logoLage = b.dataset.vaLogoW;
        box.querySelectorAll("[data-va-logo-w]").forEach(x => x.classList.toggle("is-on", x === b));
      });
      // Format: Auflösung und Bildrate (01.11.2026, wie die iPhone-App) — der Export-Dialog zeigt sie danach vorbelegt
      const vaAusgabe = () => {
        const e = box.querySelector("#va-ausgabe"); if (!e) return;
        const [bw, bh] = FORMATE[w.format] || FORMATE["9:16"], f = QUALI_FAKTOR[w.qualitaet] || 1;
        e.textContent = `${Math.round(bw * f / 2) * 2} × ${Math.round(bh * f / 2) * 2} · ${w.fps || FPS} fps`;
      };
      [["data-va-aufl", "data-va-aufl-w", (x) => { w.qualitaet = x; }], ["data-va-fps", "data-va-fps-w", (x) => { w.fps = +x; }],
       ["data-va-einheit", "data-va-einheit-w", (x) => { w.einheiten = VA_EINHEITEN[x] ? x : "metrisch"; }],
       ["data-va-pace", "data-va-pace-w", (x) => { w.pace = x === "real" ? "real" : "even"; }]].forEach(([gr, attr, setz]) => {
        box.querySelector(`[${gr}]`)?.addEventListener("click", (e) => {
          const b = e.target.closest(`[${attr}]`); if (!b) return;
          setz(b.getAttribute(attr));
          box.querySelectorAll(`[${attr}]`).forEach(x => x.classList.toggle("is-on", x === b));
          vaAusgabe(); vaLive();
        });
      });
      box.querySelector('[data-sv-gruppe="format"]')?.addEventListener("click", () => setTimeout(vaAusgabe, 0));
      vaAusgabe();
      // Format und Länge: Intro und Schluss (01.11.2026)
      [["data-va-intro", "data-va-intro-s", "va-intro-eigen", VA_INTRO, "introS"], ["data-va-hold", "data-va-hold-s", "va-hold-eigen", VA_HOLD, "holdS"]].forEach(([gr, attr, eid, liste, feld]) => {
        const eigen = () => box.querySelector("#" + eid);
        box.querySelector(`[${gr}]`)?.addEventListener("click", (e) => {
          const b = e.target.closest(`[${attr}]`); if (!b) return;
          const k = b.getAttribute(attr);
          if (k === "eigen") { const x = +(eigen()?.value); w[feld] = isFinite(x) ? Math.max(0, Math.min(DAUER_MAX, x)) : null; }
          else w[feld] = k === "normal" ? null : (liste.find(([x]) => x === k) || [, null])[1];
          const z = box.querySelector("#" + eid + "-zeile"); if (z) z.hidden = k !== "eigen";
          if (k === "eigen") eigen()?.focus();
          box.querySelectorAll(`[${attr}]`).forEach(x => x.classList.toggle("is-on", x === b));
          vaLive();
        });
        eigen()?.addEventListener("change", (e) => { const x = +e.target.value; if (isFinite(x)) { w[feld] = Math.max(0, Math.min(DAUER_MAX, x)); e.target.value = w[feld]; vaLive(); } });
      });
      // Anfang und Schluss der Kamerafahrt (01.11.2026): „Von der Erdkugel“ braucht Zeit — unter 6 s Intro auf „Lang“ (6 s);
      // die anderen brauchen überhaupt ein Intro bzw. eine Schlusszeit
      box.querySelector("#va-intro-flug")?.addEventListener("click", (e) => {
        const b = e.target.closest("[data-va-intro-flug]"); if (!b) return;
        w.introFlug = b.dataset.vaIntroFlug; w.erdkugel = w.introFlug === "erdkugel";
        box.querySelectorAll("[data-va-intro-flug]").forEach(x => x.classList.toggle("is-on", x === b));
        const mind = w.introFlug === "erdkugel" ? 6 : w.introFlug === "seite" ? 3 : 0;
        if (introS(w) < mind) { const k = box.querySelector(`[data-va-intro-s="${mind >= 6 ? "lang" : "normal"}"]`); if (k) { k.click(); return; } w.introS = mind; }
        vaLive();
      });
      box.querySelector("#va-schluss-flug")?.addEventListener("click", (e) => {
        const b = e.target.closest("[data-va-schluss-flug]"); if (!b) return;
        w.schlussFlug = b.dataset.vaSchlussFlug;
        box.querySelectorAll("[data-va-schluss-flug]").forEach(x => x.classList.toggle("is-on", x === b));
        if (holdS(w) < 4 && w.schlussFlug !== "gesamtsicht") { const k = box.querySelector('[data-va-hold-s="normal"]'); if (k) { k.click(); return; } w.holdS = 4; }
        vaLive();
      });
      box.addEventListener("toggle", (e) => {   // „Mehr Einstellungen“ offen/zu je Reiter merken
        const d = e.target; if (!d || !d.matches || !d.matches("details[data-va-mehr]")) return;
        try { localStorage.setItem("rz_va_mehr_" + d.dataset.vaMehr, d.open ? "1" : "0"); } catch (_) {}
      }, true);
      // Karte: Gelände, Beschriftung (ein Schalter + „mehr“ mit fünf)
      box.querySelector("#va-gelaende")?.addEventListener("change", (e) => { w.gelaende = !!e.target.checked; vaLive(); });
      box.querySelector("#va-bergnamen")?.addEventListener("change", (e) => { w.bergnamen = !!e.target.checked; vaLive(); });
      box.querySelector("#va-beschr")?.addEventListener("change", (e) => { const an_ = !!e.target.checked; w.beschr = Object.fromEntries(VA_BESCHR.map(k => [k, an_])); vaKarte(); vaLive(); });
      box.querySelectorAll("[data-va-beschr]").forEach(c => c.addEventListener("change", () => { w.beschr = Object.assign({}, w.beschr, { [c.dataset.vaBeschr]: !!c.checked }); vaKarte(); vaLive(); }));
      // Linie: Laufpunkt, Farbe, Strich, Breite, Effekte, Vorab-Strecke, „Wie die Karte“
      box.querySelector("#va-lp")?.addEventListener("click", (e) => {
        const b = e.target.closest("[data-va-lp]"); if (!b) return;
        const v = b.dataset.vaLp;
        if (v.startsWith("k:")) { w.ls = Object.assign({}, w.ls, { kopf: v.slice(2) }); vaLinie(); vaLive(); return; }   // Kopf der Röhre
        w.lp = v;
        if (r3Stand().roehre) w.ls = Object.assign({}, w.ls, { kopf: "punkt" });   // der gewählte Laufpunkt fährt auf der Röhre
        vaLinie(); vaLive();
      });
      box.querySelector("#va-lp-fz")?.addEventListener("change", (e) => { w.lpFz = e.target.value; vaLive(); });
      const lsSetz = (patch_) => { w.ls = Object.assign({}, w.ls, patch_); vaLinie(); vaLive(); };
      box.querySelector("#va-ls-farben")?.addEventListener("click", (e) => { const b = e.target.closest("[data-va-farbe]"); if (b) lsSetz({ farbe: b.dataset.vaFarbe }); });
      box.querySelector("#va-ls-farben")?.addEventListener("change", (e) => { if (e.target.id === "va-ls-eigen") lsSetz({ farbe: e.target.value }); });
      box.querySelector("#va-ls-strich")?.addEventListener("click", (e) => { const b = e.target.closest("[data-va-strich]"); if (b) lsSetz({ strich: b.dataset.vaStrich }); });
      box.querySelector("#va-ls-breite")?.addEventListener("input", (e) => { const v_ = box.querySelector("#va-ls-breite-v"); if (v_) v_.textContent = (+e.target.value).toFixed(1) + " px"; });
      box.querySelector("#va-ls-breite")?.addEventListener("change", (e) => lsSetz({ breite: +e.target.value }));
      [["va-ls-kontur", "kontur"], ["va-ls-schatten", "schatten"], ["va-ls-leuchten", "leuchten"]].forEach(([id, k]) =>
        box.querySelector("#" + id)?.addEventListener("change", (e) => lsSetz({ [k]: !!e.target.checked })));
      box.querySelector("#va-ghost")?.addEventListener("change", (e) => { w.ghost = !!e.target.checked; vaLive(); });
      // 06.11.2026 — Röhre + Nachglühen
      box.querySelector("#va-r3")?.addEventListener("click", (e) => { const b = e.target.closest("[data-va-r3]"); if (b) lsSetz({ roehre: b.dataset.vaR3 === "roehre" }); });
      box.querySelector("#va-glut")?.addEventListener("change", (e) => lsSetz({ glut: !!e.target.checked }));

      box.querySelector("#va-glut-look")?.addEventListener("click", (e) => { const b = e.target.closest("[data-va-glut-look]"); if (b) lsSetz({ glutLook: b.dataset.vaGlutLook }); });
      box.querySelector("#va-r3-glanz")?.addEventListener("input", (e) => { const v_ = box.querySelector("#va-r3-glanz-v"); if (v_) v_.textContent = Math.round(+e.target.value * 100) + " %"; });
      box.querySelector("#va-r3-glanz")?.addEventListener("change", (e) => lsSetz({ glanz: +e.target.value }));
      box.querySelector("#va-glut-sek")?.addEventListener("input", (e) => { const v_ = box.querySelector("#va-glut-sek-v"); if (v_) v_.textContent = (+e.target.value).toLocaleString(window.rzSprachCode ? window.rzSprachCode() : undefined) + " s"; });
      box.querySelector("#va-glut-sek")?.addEventListener("change", (e) => lsSetz({ glut: true, glutSek: +e.target.value }));
      box.querySelector("#va-ls-zurueck")?.addEventListener("click", () => { w.ls = {}; w.ghost = null; vaLinie(); vaLive(); });
      // Fotos als: Sofortbild · Groß mit Halt · Bild im Bild (die Halte folgen der Art, bis man sie selbst ändert)
      box.querySelector("#va-fa")?.addEventListener("click", (e) => {
        const b = e.target.closest("[data-va-fa]"); if (!b) return;
        w.fotoArt = b.dataset.vaFa; delete w.halteAlle;
        box.querySelectorAll("[data-va-fa]").forEach(x => x.classList.toggle("is-on", x === b));
        try { fotosInfo(); zutatenStand(); vorschau.inhalt(); } catch (err) { if (window.rzSwallow) rzSwallow(err, "assistent:fotoart"); }
        vaHalte(); try { fotosZeigen(); } catch (_) {}
        vaLive();
      });
      // Bewegung reduzieren: Clips nur beim Darüberfahren
      if (ruhig) {
        box.addEventListener("mouseover", (e) => { const vd = e.target.closest(".va-bk, .va-moment")?.querySelector("video"); if (vd) { const p_ = vd.play(); if (p_ && p_.catch) p_.catch(() => {}); } });
        box.addEventListener("mouseout", (e) => { const vd = e.target.closest(".va-bk, .va-moment")?.querySelector("video"); if (vd && !vd.closest(".va-bk, .va-moment").contains(e.relatedTarget)) vd.pause(); });
      }
      box.querySelector("#va-f-mengen")?.addEventListener("click", (e) => {
        const b = e.target.closest("[data-va-f-menge]"); if (!b) return;
        w.fotoMenge = +b.dataset.vaFMenge; fotosZeigen();
      });
      box.querySelector("[data-va-mehr-looks]")?.addEventListener("click", () => {
        const sek = document.querySelector('#mod-animator [data-accordion-section="map"]');
        const h = sek && sek.querySelector(".section-collapse-header");
        if (h && h.getAttribute("aria-expanded") === "false") h.click();
        // das Fenster liegt über der Seitenleiste — einklappen, damit man den Bereich sieht
        if (m.el && !m.el.classList.contains("va-zu")) m.el.querySelector("[data-va-klapp]")?.click();
        vaLeuchten(3);
      });
      box.querySelector("[data-va-musik-alle]")?.addEventListener("click", () => box.querySelector("#va-musik-liste")?.classList.toggle("alle"));
      box.querySelector("[data-va-merken]")?.addEventListener("click", (e) => {
        const sp = box.querySelector("#va-vorlage-sp"); if (!sp) return;
        sp.hidden = !sp.hidden; e.currentTarget.classList.toggle("is-on", !sp.hidden);
        if (!sp.hidden) box.querySelector("#va-vorlage-name")?.focus();
      });
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
      box.querySelector("#va-looks")?.addEventListener("click", (e) => {
        const b = e.target.closest("[data-va-look]"); if (!b) return;
        w.look = b.dataset.vaLook;
        if (LOOK_VORLAGE[w.look] && !w.stilId) { w.vorlage = LOOK_VORLAGE[w.look]; w.eigeneVorlage = null; }   // 01.11.2026 — Stil-Vorlage bestimmt das Layout
        box.querySelectorAll("[data-va-look]").forEach(x => x.classList.toggle("is-on", x === b));
        vorschau.stil(); vaKarte(); vaLinie();   // Beschriftung und Linie ohne eigene Wahl folgen dem Look
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

  /** 01.11.2026 — Video-Assistent für eine Tour starten (Archiv, Tour-Seite, Import-Assistent): `oeffnen()` bringt die Tour
   *  in den Animator (false = abgebrochen), dann warten, bis der Animator die NEUE Fassung des Einstiegs hat und die Tour
   *  geladen ist (höchstens ~20 s), sonst ein Hinweis. Vorher stand diese Schleife dreimal in den Aufrufern. */
  async function rzVideoAssistentStarten(oeffnen) {
    window.__rzVideoAssistent = null;
    if ((await oeffnen()) === false) return false;
    for (let i = 0; i < 100; i++) {
      await new Promise(r => setTimeout(r, 200));
      const f = window.__rzVideoAssistent;
      if (typeof f !== "function") continue;
      let ok = false; try { ok = await f(true); } catch (_) { ok = false; }
      if (ok) return true;
    }
    toast(T("va.nicht_bereit", "Die Tour lädt noch — den Video-Assistenten findest du oben im Animator."), "info", 5000);
    return false;
  }
  window.rzVideoAssistentStarten = rzVideoAssistentStarten;
  window.rzSchnellVideo = rzSchnellVideo;
  window.__rzSchnellKamerafahrt = kamerafahrt;   // Prüfstand
  window.__rzFlugstile = { liste: FLUGSTIL_NAMEN.slice(), stil: (k) => FLUGSTILE[k] || null, kurs: (k) => kursOpts({ flug: k }),   // Prüfstand, CLI
    // 18.10.2026 (Fahrt neu erzeugen) — Name + Kurztext und Vorschau-Clip eines Flugstils für das Popup im Animator
    text: (k) => FLUGSTIL_TEXT[k] ? [T("schnell.flug." + k, FLUGSTIL_TEXT[k][0]), T("schnell.flug." + k + "_k", FLUGSTIL_TEXT[k][1])] : [k, ""],
    clip: (k) => kamClip("flug_" + k) };
  window.__rzSchnellPatch = animatorPatch;       // Prüfstand
  window.__rzSchnellAblauf = nurAblauf;          // Prüfstand
  window.__rzSchnellFotostopps = fotostoppSchilder;   // Prüfstand
  window.__rzSchnellStopps = stoppsWaehlen;            // Prüfstand (02.10.2026: Fotos + Clips teilen sich die Zeit)
  window.__rzSchnellLogbuch = logbuchAnwenden;         // Prüfstand
  window.__rzSchnellVorlagen = { VORLAGEN, einblendungen, fotosOhneHalt, sofortbildSchild, vorlageStil, tempoRegie, gipfelShot };   // Prüfstand (05.10.2026)
})();
