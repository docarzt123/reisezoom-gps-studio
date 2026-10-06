/* Gesamt-Looks (05.10.2026, Block 1 „Optik", IDEEN I-052).
 *
 * Ein Look ist eine ganze Bildsprache: Kartenstil + Kartenoptik, Linie (Farbe, Breite, Kontur, Leuchten),
 * dunkle Verläufe und Schrift/Farben der Einblendungen. Er setzt beim Wählen ALLE diese Werte (wie ein
 * Stil-Template der Container) — danach gehören sie dem Projekt, jeder Regler bleibt frei.
 *
 * Reine Daten + reine Funktion `anwenden(name, einstellungen)` → neuer Einstellungs-Block. Läuft in der App
 * und unter node (Wächter: vorher globalThis.window = globalThis). Das Schnell-Video wählt seinen Look über
 * dieselbe Liste (Vorlagen Weite → natuerlich, Tagebuch → reiseatlas, Puls → nachtkarte).
 *
 * Eigene Karten „Nachtkarte" und „Reiseatlas" = umgefärbtes OpenFreeMap Positron (core/kartenlook.py).
 * Videofarben hängen bewusst NICHT an den Farben der Oberfläche (app.css), sondern stehen hier fest.
 */
(function (root) {
  "use strict";
  const LOOKS = {
    natuerlich: {
      symbol: "🏔", karte: { map_style: "free_satellite", ortho_sat: 25, ortho_con: 8, ortho_bri: 0, ortho_hue: 0,
                             ortho_relief: 35, map_sharp: 15, map_haze: 15 },
      linie: { line_color: "#48d6c4", line_width: 3.5, kontur_breite: 1.5, kontur_farbe: "#0f1a20", glow_strength: 0 },
      hell: false, text: "#ffffff", hg: "#151b22", hg_deckkraft: 0.55, akzent: "#48d6c4", schrift: "plex", titel: "plex",
    },
    reiseatlas: {
      symbol: "🧭", karte: { map_style: "ofm_atlas", map_sat: 0, map_con: 0, map_bri: 0, map_hue: 0, map_sharp: 0, map_haze: 0 },
      linie: { line_color: "#b4432e", line_width: 4, kontur_breite: 2, kontur_farbe: "#fbf5e6", glow_strength: 0 },
      hell: true, text: "#4e3c2b", hg: "#fbf5e6", hg_deckkraft: 0.86, akzent: "#b4432e", schrift: "plex", titel: "caveat",
    },
    nachtkarte: {
      symbol: "🌙", karte: { map_style: "ofm_nacht", map_sat: 0, map_con: 0, map_bri: 0, map_hue: 0, map_sharp: 0, map_haze: 0 },
      linie: { line_color: "#d3e76b", line_width: 3, kontur_breite: 0, kontur_farbe: "#14231f", glow_strength: 4 },
      hell: false, text: "#f0f2eb", hg: "#0c1519", hg_deckkraft: 0.6, akzent: "#99d8c0", schrift: "plexmono", titel: "plex",
    },
    minimal: {
      symbol: "◻️", karte: { map_style: "ofm_positron", map_sat: 0, map_con: 0, map_bri: 0, map_hue: 0, map_sharp: 0, map_haze: 0 },
      linie: { line_color: "#1f2d31", line_width: 3, kontur_breite: 2, kontur_farbe: "#ffffff", glow_strength: 0 },
      hell: true, text: "#1f2d31", hg: "#ffffff", hg_deckkraft: 0.82, akzent: "#c8553d", schrift: "plex", titel: "plex",
    },
  };
  const NAMEN = Object.keys(LOOKS);
  const kopie = (x) => JSON.parse(JSON.stringify(x));

  /** Container im Look einfärben: mit Hintergrund → Look-Hintergrund + Text; ohne Hintergrund (frei/ohne) liegt
   *  die Schrift direkt auf der Karte → auf hellen Karten dunkel und ohne Schatten. Bilder (Logo) bleiben. */
  function containerImLook(c, L) {
    const o = Object.assign({}, c);
    const mitHg = (+o.hg_deckkraft || 0) > 0;
    o.schrift = o.vorlage === "titel" ? L.titel : L.schrift;
    o.textfarbe = L.text;
    o.akzent = L.akzent;
    if (mitHg) { o.hg_farbe = L.hg; o.hg_deckkraft = L.hg_deckkraft; }
    else o.textschatten = !L.hell;
    // Stilname bleibt: Stile sind Vorlagen beim Auswählen, die Werte gehören ohnehin dem Container
    // (so bleibt ein Schnell-Video von Hand nachbaubar, tests/test_schnellvideo_nachbau.py)
    o.zeilen = (o.zeilen || []).map((z) => {
      // eingebautes Logo: auf hellen Karten die dunkle Fassung (weiß verschwindet auf Papier/Positron)
      if (z.typ === "bild" && /^@lockup-(white|dark)$/.test(String(z.pfad || ""))) return Object.assign({}, z, { pfad: L.hell ? "@lockup-dark" : "@lockup-white" });
      if (z.typ !== "diagramm") return z;
      const zz = Object.assign({}, z);
      zz.linienfarbe = z.art === "karte" ? L.linie.line_color : L.text;
      return zz;
    });
    return o;
  }

  /** Look `name` auf einen Einstellungs-Block (animator) anwenden → neuer Block (Eingabe bleibt unverändert). */
  function anwenden(name, s) {
    const L = LOOKS[name];
    if (!L) return s;
    const o = kopie(s || {});
    Object.assign(o, L.karte, L.linie);
    o.ghost_track_color = L.linie.line_color;
    if (Array.isArray(o.container)) o.container = o.container.map((c) => containerImLook(c, L));
    const v = o.verlauf && typeof o.verlauf === "object" ? o.verlauf : { oben: { an: true, staerke: 0.62 }, unten: { an: true, staerke: 0.72 } };
    o.verlauf = { oben: Object.assign({}, v.oben || {}, { an: !L.hell }), unten: Object.assign({}, v.unten || {}, { an: !L.hell }) };
    return o;
  }

  /** Welcher Look passt zum Block (Kartenstil + Linienfarbe + Kontur)? Sonst "". */
  function erkennen(s) {
    if (!s) return "";
    for (const n of NAMEN) {
      const L = LOOKS[n];
      if (s.map_style === L.karte.map_style && String(s.line_color || "").toLowerCase() === L.linie.line_color
          && +s.kontur_breite === L.linie.kontur_breite) return n;
    }
    return "";
  }

  // 05.10.2026 (FRAGEN F-2, Marc: „da tendiere ich zu ja, aber es muss immer alles wählbar bleiben") — ein Look darf
  // den GRUNDSTIL der Schilder umstellen: nur einfache Text-/Foto-Schilder; Highlight-, Banner-, Wegweiser- und
  // Stecknadel-Schilder bleiben. Nichts wird gesperrt, jedes Schild bleibt einzeln änderbar; der Animator fragt vorher.
  const SCHILD_TEXT = { natuerlich: "callout", reiseatlas: "karte", nachtkarte: "pille", minimal: "plain" };
  const SCHILD_FOTO = { reiseatlas: "sofortbild" };
  const SCHILD_EINFACH = ["callout", "plain", "pille", "karte", "sofortbild"];
  /** → { liste, n }: neue Schilder-Liste (Kopien) und Zahl der umgestellten. */
  function schilderFuerLook(name, schilder) {
    let n = 0;
    const liste = (schilder || []).map((s0) => {
      const s = Object.assign({}, s0);
      const stil = s.style || "callout";
      if (!SCHILD_EINFACH.includes(stil)) return s;
      const foto = !!s.imageSrc;
      const ziel = foto ? (SCHILD_FOTO[name] || (stil === "sofortbild" ? stil : null)) : SCHILD_TEXT[name];
      if (ziel && ziel !== stil) { s.style = ziel; n++; }
      return s;
    });
    return { liste, n };
  }

  root.rzLooks = { LOOKS, NAMEN, anwenden, erkennen, containerImLook, schilderFuerLook };
})(typeof window !== "undefined" ? window : globalThis);
