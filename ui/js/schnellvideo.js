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
    const zNah = Math.max(1, Math.min(4.5, Math.log2(Math.max(0.5, diagonaleKm(bbox)) / 2)));
    const punkte = [
      { s: 0, c: mitte, z: -0.15, p: 25, b: 0, e: "linear" },                       // Überblick
      { s: 1.2, c: mitte, z: -0.15, p: 25, b: 0, e: "linear" },                     // … kurz stehen
      { a: 0, c: null, z: zNah, p: 55, b: 0, e: "ease_in_out" },                    // hinein zum Start
      { a: 0.5, c: null, z: zNah, p: 55, b: 20, e: "linear" },                      // Flug, leicht drehend
      { a: 1, c: null, z: zNah, p: 55, b: 0, e: "linear" },                         // Ziel
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

  /** Animator-Einstellungen des Schnell-Video-Projekts (Backend-Schlüssel, wie app.py sie kennt). */
  function animatorPatch(w, v) {
    const [bw, bh] = FORMATE[w.format] || FORMATE["9:16"];
    const f = w.qualitaet === "4k" ? 2 : 1;
    const gesamt = LAENGEN[w.laenge] || 40;
    const animS = Math.max(8, gesamt - INTRO_S - HOLD_S);
    return {
      width: bw * f, height: bh * f, fps: FPS,
      map_style: w.stil,
      intro_s: INTRO_S, hold_s: HOLD_S, duration_s: animS,
      keyframes_enabled: true,
      timeline_events: kamerafahrt(v.bbox, animS),
      camera_follow_track: true,
      // Im Überblick sieht man sofort die ganze Runde: blass im Hintergrund, darüber zeichnet sich die Linie.
      ghost_track_enabled: true, ghost_track_opacity_pct: 50,
      overlay_totals_enabled: false,
      overlay_live_enabled: !!w.zahlen,
      overlay_live_fields: ["dist_done", "ele_now"],
      overlay_elevation_enabled: !!w.profil,
      overlay_elevation_position: "bc",
      schnellkarte: { titel_an: !!(w.titel || w.unter), titel: w.titel, unter: w.unter, titel_s: INTRO_S,
                      schluss_an: w.felder.length > 0, felder: w.felder.slice() },
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

  async function rzSchnellVideo(pfad) {
    if (!pfad) return;
    let v;
    try { v = await rzWarten("schnellvideo_vorschlag", () => api().schnellvideo_vorschlag(pfad)); }
    catch (e) { v = { ok: false, error: String(e) }; }
    if (!v || !v.ok) { toast((v && v.error) || T("common.error", "Fehler"), "error", 6000); return; }
    const L = v.letzte || {};
    const w = {
      format: FORMATE[L.format] ? L.format : "9:16",
      laenge: LAENGEN[L.laenge] ? L.laenge : "normal",
      qualitaet: L.qualitaet === "4k" ? "4k" : "1080",
      stil: L.stil || (typeof mapDefaultStyle === "function" ? mapDefaultStyle() : "free_satellite"),
      zahlen: !!L.zahlen, profil: !!L.profil,
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
        ${knopfReihe("laenge", [["kurz", T("schnell.kurz", "Kurz") + " · 20 s"], ["normal", T("schnell.normal", "Normal") + " · 40 s"], ["lang", T("schnell.lang", "Lang") + " · 60 s"]], w.laenge)}
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
        <label class="field-label">${esc(T("schnell.schlusskarte", "Schlusskarte"))}</label>
        <div class="sv-felder">${SCHLUSS_FELDER.map(f => `<label class="chk"><input type="checkbox" data-sv-feld="${f}"${w.felder.includes(f) ? " checked" : ""}><span>${esc(feldLabel(f))}</span></label>`).join("")}</div>
      </div>`,
      footer: `<button type="button" class="btn" id="sv-animator">${esc(T("schnell.im_animator", "Im Animator öffnen"))}</button>
               <button type="button" class="btn btn-primary" id="sv-rendern">🎬 ${esc(T("schnell.rendern", "Video rendern"))}</button>`,
    });
    const box = document.getElementById("modal-body");
    box.querySelectorAll("[data-sv-gruppe]").forEach(r => r.addEventListener("click", (e) => {
      const b = e.target.closest("[data-sv-wert]"); if (!b) return;
      w[r.dataset.svGruppe] = b.dataset.svWert;
      r.querySelectorAll("[data-sv-wert]").forEach(x => x.classList.toggle("is-on", x === b));
    }));
    const rechte = () => {
      const s = box.querySelector("#sv-stil").value, h = box.querySelector("#sv-rechte");
      const ok = typeof mapStyleVideoOk === "function" ? mapStyleVideoOk(s) : true;
      h.hidden = ok;
      if (!ok) h.textContent = "⚠️ " + T("schnell.rechte", "Für diesen Kartenstil gibt es keine Freigabe für kommerzielle Videos. Für YouTube & Co. einen freigegebenen Stil wählen — rendern geht trotzdem.");
    };
    box.querySelector("#sv-stil").addEventListener("change", rechte);
    rechte();

    let laeuft = false;
    const los = async (rendern) => {
      if (laeuft) return; laeuft = true;
      w.stil = box.querySelector("#sv-stil").value;
      w.titel = box.querySelector("#sv-titel").value.trim();
      w.unter = box.querySelector("#sv-unter").value.trim();
      w.zahlen = box.querySelector("#sv-zahlen").checked;
      w.profil = box.querySelector("#sv-profil").checked;
      w.felder = [...box.querySelectorAll("[data-sv-feld]:checked")].map(x => x.dataset.svFeld);
      const letzte = { format: w.format, laenge: w.laenge, qualitaet: w.qualitaet, stil: w.stil, zahlen: w.zahlen, profil: w.profil, felder: w.felder };
      const name = (v.name || "Tour") + " · " + T("schnell.titel_dialog", "Schnell-Video");
      let r;
      try { r = await rzWarten("schnellvideo_anlegen", () => api().schnellvideo_anlegen(pfad, name, animatorPatch(w, v), letzte)); }
      catch (e) { r = { ok: false, error: String(e) }; }
      if (!r || !r.ok) { laeuft = false; toast((r && r.error) || T("common.error", "Fehler"), "error", 6000); return; }
      try { applog("info", `[schnell] Projekt ${r.project_id} · ${w.format} · ${w.laenge} · ${w.qualitaet} · ${w.stil} · rendern=${rendern}`); } catch (_) {}
      m.close();
      // Öffnen über das Archiv — derselbe Weg wie beim Tour-Assistenten.
      window.__rzProjektOeffnenId = r.project_id;
      window.__rzStartProjekte = true;
      if (typeof switchMod === "function") switchMod("library");
      window.dispatchEvent(new CustomEvent("rz-projekt-oeffnen", { detail: { id: r.project_id, modul: "animator" } }));
      if (!rendern) return;
      const bereit = await warteAufAnimator(r.project_id, 90);
      if (!bereit) { toast(T("schnell.nicht_bereit", "Der Animator ist noch nicht bereit — starte das Video dort mit „Video rendern“."), "warn", 8000); return; }
      await new Promise(res => setTimeout(res, 1500));   // Karte und Kacheln kurz ankommen lassen
      let ziel;
      try { ziel = await api().schnellvideo_ziel(name); } catch (_) { ziel = null; }   // warte-ok: sofort
      if (!ziel || !ziel.ok) { toast((ziel && ziel.error) || T("common.error", "Fehler"), "error", 6000); return; }
      if (typeof window.__rzSchnellRender === "function") window.__rzSchnellRender({ ziel: ziel.path, name: (v.name || "Tour") + " – " + T("schnell.titel_dialog", "Schnell-Video") });
    };
    document.getElementById("sv-animator").onclick = () => los(false);
    document.getElementById("sv-rendern").onclick = () => los(true);
  }

  window.rzSchnellVideo = rzSchnellVideo;
  window.__rzSchnellKamerafahrt = kamerafahrt;   // Prüfstand
  window.__rzSchnellPatch = animatorPatch;       // Prüfstand
})();
