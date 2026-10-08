/* exportdialog.js — „⤓ Video exportieren“ / „⤓ Bild exportieren“ als Fenster in der Mitte (06.10.2026)
 *
 * Export (06.10.2026): Ein Klick auf die koralle Hauptaktion öffnet dieses Fenster.
 * Oben Vorlagen als Kacheln (eingebaut + eigene, ★ = Standard für neue Projekte), darunter Auflösung passend zum
 * Seitenverhältnis, Bildrate, Farbraum, Qualität; unter „Mehr“ freie Breite × Höhe und „Karte glätten“.
 * „Speichern in …“ zeigt den zuletzt benutzten Ordner und einen Namen mit Zeitstempel; „Exportieren“ legt sofort los,
 * „Ändern …“ öffnet den Systemdialog. Nie überschreiben (app.py export_ziel_freigeben hängt „-2“ an).
 *
 * Das Fenster hat keine eigenen Werte: Es schreibt in die (ausgeblendeten) Felder des Moduls — anim-w/-h/-fps/
 * -farbraum/-map-smoothing — und die speichern wie bisher je Projekt (bindSetting). Der Codec ist global
 * (Einstellungen → Qualität & Export). Eine Vorlage anwenden = EIN ⌘Z-Schritt, Seitenverhältnis inklusive.
 *
 *   rzExportDialog.oeffnen({ bild, stamm, ordnerHinweis, starten(pfad) })
 */
(function () {
  "use strict";
  const T = (k, d) => (typeof t === "function" ? t(k, d) : d);
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const FORMATE = [["16:9", 16, 9], ["9:16", 9, 16], ["1:1", 1, 1], ["4:5", 4, 5], ["4:3", 4, 3], ["21:9", 21, 9]];
  const STUFEN = [[2160, "4K"], [1440, "1440p"], [1080, "1080p"], [720, "720p"]];
  const gerade = (v) => Math.max(2, Math.round(v / 2) * 2);

  /** Breite × Höhe für ein Seitenverhältnis und die kurze Seite (1080 → 1920×1080, 9:16 → 1080×1920). */
  function groesse(format, kurz) {
    const f = FORMATE.find((x) => x[0] === format) || FORMATE[0];
    return f[1] >= f[2] ? [gerade(kurz * f[1] / f[2]), kurz] : [kurz, gerade(kurz * f[2] / f[1])];
  }
  function formatVon(w, h) {
    const f = FORMATE.find(([, a, b]) => Math.abs(a / b - w / Math.max(1, h)) < 0.01);
    return f ? f[0] : "";
  }

  function eingebaut() {
    const v = (id, name, format, kurz) => { const [w, h] = groesse(format, kurz); return { id, name, w, h, fps: 30, codec: "h264", farbraum: "sdr", fest: true }; };
    return [
      v("yt4k", T("exportdlg.v_yt4k", "YouTube 4K"), "16:9", 2160),
      v("yt1080", T("exportdlg.v_yt1080", "YouTube 1080p"), "16:9", 1080),
      v("reel", T("exportdlg.v_reel", "Instagram Reel 9:16"), "9:16", 1080),
      v("insta45", T("exportdlg.v_insta45", "Instagram 4:5"), "4:5", 1080),
      v("schnell", T("exportdlg.v_schnell", "Schnell ansehen 720p"), "16:9", 720),
    ];
  }
  const einst = () => { try { return (typeof _settingsCache !== "undefined" && _settingsCache) || {}; } catch (_) { return {}; } };
  const eigene = () => (Array.isArray(einst().export_vorlagen) ? einst().export_vorlagen : []);
  const alle = () => eingebaut().concat(eigene());
  const standardId = () => einst().export_vorlage_standard || "";
  function eigeneSpeichern(liste) { try { saveSettings({ export_vorlagen: liste }, { immediate: true }); } catch (_) {} }

  // ── Felder des Moduls ────────────────────────────────────────────────────────────────────────────
  function feld(id, wert) {
    const e = $(id); if (!e || wert == null) return;
    if (String(e.value) === String(wert)) return;
    e.value = String(wert);
    e.dispatchEvent(new Event("input", { bubbles: true }));
    e.dispatchEvent(new Event("change", { bubbles: true }));
  }
  const codecJetzt = () => (einst().render && einst().render.codec) || "h264";
  function codecSetzen(c) {
    if (!c || c === codecJetzt()) return;
    try { saveSettings({ render: Object.assign({}, einst().render || {}, { codec: c }) }); } catch (_) {}
  }
  function stand() {
    return { w: +($("anim-w") || {}).value || 1920, h: +($("anim-h") || {}).value || 1080,
             fps: +($("anim-fps") || {}).value || 30, farbraum: ($("anim-farbraum") || {}).value || "sdr",
             codec: codecJetzt(), glaettung: +($("anim-map-smoothing") || {}).value };
  }
  /** Mehrere Felder als EIN ⌘Z-Schritt (wie Looks: vorher einmal merken, dann gesammelt). */
  function alsEinSchritt(label, fn) {
    try { const uc = window.__rzUndoControllers && window.__rzUndoControllers[typeof activeMod !== "undefined" ? activeMod : "animator"]; if (uc) uc.push(label, { force: true }); } catch (_) {}
    window.__rzUndoSammeln = true;
    try { fn(); } finally { window.__rzUndoSammeln = false; window.__rzLastUndoEl = "rz-export"; }
  }
  function vorlageAnwenden(v, bild) {
    alsEinSchritt(T("exportdlg.undo_vorlage", "Export-Vorlage") + " " + v.name, () => {
      feld("anim-w", v.w); feld("anim-h", v.h);
      if (!bild) {
        feld("anim-fps", v.fps); feld("anim-farbraum", v.farbraum);
        if (v.glaettung != null && isFinite(v.glaettung)) feld("anim-map-smoothing", v.glaettung);
      }
    });
    if (!bild) codecSetzen(v.codec);
  }
  const passt = (v, s, bild) => v.w === s.w && v.h === s.h && (bild || (v.fps === s.fps && v.codec === s.codec && v.farbraum === s.farbraum));

  /** ★-Vorlage auf ein neues Projekt (nur Format/Größe/Ausgabe, ohne ⌘Z-Schritt — das Projekt ist frisch). */
  function standardAufNeuesProjekt(bild) {
    const v = alle().find((x) => x.id === standardId()); if (!v) return false;
    window.__rzUndoSammeln = true;
    try { feld("anim-w", v.w); feld("anim-h", v.h); if (!bild) { feld("anim-fps", v.fps); feld("anim-farbraum", v.farbraum); } }
    finally { window.__rzUndoSammeln = false; }
    if (!bild) codecSetzen(v.codec);
    return true;
  }

  // ── Fenster ──────────────────────────────────────────────────────────────────────────────────────
  let _offen = null;
  function zeitstempel() {
    const d = new Date(), z = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}`;
  }
  function endung(bild) {
    if (bild) return "png";
    const alpha = ($("anim-style") || {}).value === "alpha";
    return (alpha || String(codecJetzt()).startsWith("prores")) ? "mov" : "mp4";
  }
  const filter = (ext) => [ext.toUpperCase() + " (*." + ext + ")"];
  const trenner = (o) => (o.includes("\\") && !o.includes("/")) ? "\\" : "/";

  function schliessen(gestartet) {
    if (!_offen) return;
    try { document.removeEventListener("keydown", _offen.taste, true); } catch (_) {}
    const o = _offen; _offen = null;
    o.el.remove();
    // ohne „Exportieren“ zu: dem Aufrufer Bescheid geben (Schnell-Video schließt dann seinen Bildschirm)
    if (gestartet !== true && o.st && o.st.opt && typeof o.st.opt.abbrechen === "function") { try { o.st.opt.abbrechen(); } catch (_) {} }
  }

  async function oeffnen(opt) {
    schliessen();
    opt = opt || {};
    const bild = !!opt.bild;
    const ov = document.createElement("div");
    ov.className = "rz-exp-overlay";
    ov.innerHTML = `<div class="rz-exp" role="dialog" aria-modal="true" aria-labelledby="rz-exp-titel">
      <header class="rz-exp-kopf"><h3 id="rz-exp-titel">${esc(bild ? T("tourmap.hauptaktion", "⤓ Bild exportieren") : T("animator.hauptaktion", "⤓ Video exportieren"))}</h3>
        <button type="button" class="rz-exp-x" aria-label="${esc(T("common.close", "Schließen"))}">✕</button></header>
      <div class="rz-exp-inhalt"></div>
      <footer class="rz-exp-fuss">
        <div class="rz-exp-fuss-links"><button type="button" class="btn btn-ghost btn-sm" data-tat="merken">☆ ${esc(T("exportdlg.als_vorlage", "Als Vorlage speichern …"))}</button></div>
        <button type="button" class="btn" data-tat="abbrechen">${esc(T("common.cancel", "Abbrechen"))}</button>
        <button type="button" class="btn btn-cta" data-tat="los">⤓ ${esc(T("exportdlg.exportieren", "Exportieren"))}</button>
      </footer></div>`;
    document.body.appendChild(ov);
    const st = { bild, opt, ziel: { ordner: "", name: "" }, umbenennen: null, loeschen: null, merken: false };
    const taste = (e) => {
      if (e.key !== "Escape" || e.isComposing) return;
      const z = e.target; if (z && /^(INPUT|TEXTAREA)$/.test(z.tagName) && (st.umbenennen || st.merken)) return;
      e.preventDefault(); e.stopPropagation(); schliessen();
    };
    document.addEventListener("keydown", taste, true);
    _offen = { el: ov, taste, st };
    ov.addEventListener("pointerdown", (e) => { if (e.target === ov) schliessen(); });
    ov.querySelector(".rz-exp-x").onclick = () => schliessen();

    // Speicherort vorschlagen
    const ext = endung(bild);
    // Dateiname: ohne Emojis/Symbole aus dem Tournamen (🔁 …) und ohne Zeichen, die Dateisysteme nicht mögen
    const stamm = String(opt.stamm || "Tour").replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "")
      .replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 80) || "Tour";
    try {
      const r = await api().export_ziel_vorschlag(`${stamm}_${zeitstempel()}.${ext}`, filter(ext), opt.ordnerHinweis || "");   // warte-ok: Vorschlag, sofort
      if (r) st.ziel = { ordner: r.ordner || "", name: r.name || "" };
    } catch (_) {}
    if (!_offen || _offen.el !== ov) return;
    zeichnen();

    function zeichnen() {
      const s = stand(), fmt = formatVon(s.w, s.h);
      const liste = alle(), std = standardId();
      const karte = (v) => {
        const an = passt(v, s, bild), eig = !v.fest;
        const info = `${v.w}×${v.h}${bild ? "" : " · " + v.fps + " fps"}`;
        const name = st.umbenennen === v.id
          ? `<input type="text" class="rz-exp-name-ein" value="${esc(v.name)}" maxlength="40">`
          : `<span class="rz-exp-k-name">${esc(v.name)}</span>`;
        return `<div class="rz-exp-karte${an ? " is-on" : ""}" role="button" tabindex="0" data-v="${esc(v.id)}">
          ${name}<span class="rz-exp-k-info">${esc(info)}</span>
          <span class="rz-exp-k-tat">
            <span class="rz-exp-stern${std === v.id ? " is-std" : ""}" data-stern title="${esc(T("exportdlg.stern_tip", "Standard für neue Projekte"))}">${std === v.id ? "★" : "☆"}</span>
            ${eig ? `<span data-umb title="${esc(T("exportdlg.umbenennen", "Umbenennen"))}">✎</span>
            <span data-weg class="${st.loeschen === v.id ? "is-frage" : ""}" title="${esc(T("exportdlg.loeschen", "Löschen"))}">${st.loeschen === v.id ? esc(T("exportdlg.loeschen_frage", "Löschen?")) : "✕"}</span>` : ""}
          </span></div>`;
      };
      const stufen = STUFEN.map(([kurz, lab]) => {
        const [w, h] = groesse(fmt || "16:9", kurz);
        return `<button type="button" class="anim-pille${w === s.w && h === s.h ? " is-on" : ""}" data-res="${w}x${h}" ${fmt ? "" : "disabled"}>${esc(lab)} <span class="muted">${w}×${h}</span></button>`;
      }).join("");
      const sel = (id, werte, jetzt) => `<select id="${id}" class="select">${werte.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(jetzt) ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
      const alpha = ($("anim-style") || {}).value === "alpha";
      const ordnerKurz = st.ziel.ordner ? st.ziel.ordner.split(/[\\/]/).filter(Boolean).slice(-2).join("/") : "";
      const inhalt = ov.querySelector(".rz-exp-inhalt");
      inhalt.innerHTML = `
        <div class="rz-exp-abschnitt"><div class="rz-exp-label">${esc(T("exportdlg.vorlagen", "Vorlagen"))}</div>
          <div class="rz-exp-vorlagen">${liste.map(karte).join("")}</div></div>
        <div class="rz-exp-abschnitt">
          <div class="rz-exp-label">${esc(T("exportdlg.aufloesung", "Auflösung"))}
            <span class="rz-exp-format">${esc(fmt || T("exportdlg.frei", "frei"))} · <span class="muted">${esc(T("exportdlg.format_hinweis", "Seitenverhältnis in der Seitenleiste unter „Format & Ablauf“"))}</span></span></div>
          <div class="anim-pillen rz-exp-stufen">${stufen}</div></div>
        ${bild ? "" : `<div class="rz-exp-reihe">
          <label class="rz-exp-feld"><span class="rz-exp-label">${esc(T("animator.field.fps", "Bildrate"))}</span>
            ${sel("rz-exp-fps", [[24, "24 (Kino)"], [25, "25 (PAL)"], [30, "30"], [50, "50 (PAL HFR)"], [60, "60"]], s.fps)}</label>
          <label class="rz-exp-feld"><span class="rz-exp-label">${esc(T("animator.farbraum", "Farbraum"))}</span>
            ${sel("rz-exp-farbraum", [["sdr", T("animator.farbraum.sdr", "SDR (Standard)")], ["hlg", T("animator.farbraum.hlg", "HDR · HLG (empfohlen)")], ["pq", T("animator.farbraum.pq", "HDR · PQ (HDR10)")]], s.farbraum)}</label>
        </div>
        <label class="rz-exp-feld"><span class="rz-exp-label">${esc(T("exportdlg.qualitaet", "Qualität"))}</span>
          ${sel("rz-exp-codec", [["h264", T("settings.render.codec_h264", "H.264")], ["h265", T("settings.render.codec_h265", "H.265")], ["prores422", T("settings.render.codec_prores422", "ProRes 422 HQ")], ["prores", T("settings.render.codec_prores", "ProRes 4444")]], s.codec)}</label>
        ${alpha ? `<p class="muted rz-exp-hinweis">${esc(T("exportdlg.alpha", "Kartenstil „Alpha“: Das Video wird ProRes 4444 mit Transparenz (.mov), ohne HDR."))}</p>` : ""}`}
        <details class="anim-mehr rz-exp-mehr"${st.mehrOffen ? " open" : ""}><summary>${esc(T("animator.mehr", "Mehr"))}</summary>
          <div class="rz-exp-reihe">
            <label class="rz-exp-feld"><span class="rz-exp-label">${esc(T("animator.field.width", "Breite"))}</span><input type="number" id="rz-exp-w" min="320" max="7680" step="2" value="${s.w}"></label>
            <label class="rz-exp-feld"><span class="rz-exp-label">${esc(T("animator.field.height", "Höhe"))}</span><input type="number" id="rz-exp-h" min="320" max="7680" step="2" value="${s.h}"></label>
          </div>
          ${bild ? "" : `<label class="rz-exp-feld"><span class="rz-exp-label">${esc(T("animator.field.map_smoothing", "Karte glätten"))} <span class="muted" id="rz-exp-gl-v">${isFinite(s.glaettung) ? s.glaettung.toFixed(1) : "1.3"} px</span></span>
            <input type="range" id="rz-exp-glaettung" min="0" max="3" step="0.1" value="${isFinite(s.glaettung) ? s.glaettung : 1.3}"></label>`}
        </details>
        <div class="rz-exp-abschnitt"><div class="rz-exp-label">${esc(T("exportdlg.speichern_in", "Speichern in"))}</div>
          <div class="rz-exp-ziel"><span class="rz-exp-pfad" title="${esc(st.ziel.ordner + trenner(st.ziel.ordner || "/") + st.ziel.name)}">${esc(ordnerKurz ? "…/" + ordnerKurz + "/" : "")}<b>${esc(st.ziel.name)}</b></span>
            <button type="button" class="btn btn-sm" data-tat="aendern">${esc(T("exportdlg.aendern", "Ändern …"))}</button></div></div>`;
      // Fuß: „Als Vorlage speichern“ wird zum Namensfeld
      const fl = ov.querySelector(".rz-exp-fuss-links");
      fl.innerHTML = st.merken
        ? `<input type="text" class="rz-exp-name-neu" maxlength="40" placeholder="${esc(T("exportdlg.name_ph", "Name der Vorlage"))}"><button type="button" class="btn btn-sm" data-tat="merken-ok">${esc(T("common.ok", "OK"))}</button>`
        : `<button type="button" class="btn btn-ghost btn-sm" data-tat="merken">☆ ${esc(T("exportdlg.als_vorlage", "Als Vorlage speichern …"))}</button>`;
      const ne = fl.querySelector(".rz-exp-name-neu"); if (ne) setTimeout(() => ne.focus(), 0);
      const ue = inhalt.querySelector(".rz-exp-name-ein"); if (ue) setTimeout(() => { ue.focus(); ue.select(); }, 0);
      binden(inhalt);
    }

    function nameAnpassen() {
      // Endung folgt dem Codec (ProRes → .mov); der Stamm bleibt
      const e = endung(bild);
      if (st.ziel.name && !st.ziel.name.toLowerCase().endsWith("." + e)) st.ziel.name = st.ziel.name.replace(/\.[^.]+$/, "") + "." + e;
    }

    function binden(inhalt) {
      inhalt.querySelector(".rz-exp-mehr")?.addEventListener("toggle", (e) => { st.mehrOffen = e.target.open; });
      inhalt.querySelectorAll("[data-res]").forEach((b) => b.onclick = () => {
        const [w, h] = b.dataset.res.split("x").map(Number);
        alsEinSchritt(T("exportdlg.undo_aufloesung", "Auflösung"), () => { feld("anim-w", w); feld("anim-h", h); });
        zeichnen();
      });
      const an = (id, fn) => { const e = inhalt.querySelector("#" + id); if (e) e.onchange = () => { fn(e.value); nameAnpassen(); zeichnen(); }; };
      an("rz-exp-fps", (v) => feld("anim-fps", v));
      an("rz-exp-farbraum", (v) => feld("anim-farbraum", v));
      an("rz-exp-codec", (v) => codecSetzen(v));
      an("rz-exp-w", (v) => feld("anim-w", gerade(+v || 1920)));
      an("rz-exp-h", (v) => feld("anim-h", gerade(+v || 1080)));
      const gl = inhalt.querySelector("#rz-exp-glaettung");
      if (gl) {
        gl.oninput = () => { const l = inhalt.querySelector("#rz-exp-gl-v"); if (l) l.textContent = (+gl.value).toFixed(1) + " px"; };
        gl.onchange = () => feld("anim-map-smoothing", gl.value);
      }
      inhalt.querySelectorAll(".rz-exp-karte").forEach((k) => {
        const id = k.dataset.v;
        const v = alle().find((x) => x.id === id); if (!v) return;
        k.onclick = (e) => {
          if (e.target.closest("input")) return;
          if (e.target.closest("[data-stern]")) {
            try { saveSettings({ export_vorlage_standard: standardId() === id ? "" : id }, { immediate: true }); } catch (_) {}
            return zeichnen();
          }
          if (e.target.closest("[data-umb]")) { st.umbenennen = id; st.loeschen = null; return zeichnen(); }
          if (e.target.closest("[data-weg]")) {
            if (st.loeschen !== id) { st.loeschen = id; zeichnen(); setTimeout(() => { if (_offen && st.loeschen === id) { st.loeschen = null; zeichnen(); } }, 3000); return; }
            eigeneSpeichern(eigene().filter((x) => x.id !== id));
            if (standardId() === id) { try { saveSettings({ export_vorlage_standard: "" }); } catch (_) {} }
            st.loeschen = null; return zeichnen();
          }
          vorlageAnwenden(v, bild);
          try { saveProjectSettings(typeof activeMod !== "undefined" ? activeMod : "animator", { export_vorlage: id }); } catch (_) {}
          nameAnpassen(); zeichnen();
        };
        k.onkeydown = (e) => { if ((e.key === "Enter" || e.key === " ") && e.target === k) { e.preventDefault(); k.click(); } };
        const ein = k.querySelector(".rz-exp-name-ein");
        if (ein) {
          const fertig = (ok) => {
            if (st.umbenennen !== id) return;
            const n = ein.value.trim();
            if (ok && n) eigeneSpeichern(eigene().map((x) => x.id === id ? Object.assign({}, x, { name: n }) : x));
            st.umbenennen = null; zeichnen();
          };
          ein.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); fertig(true); } else if (e.key === "Escape") { e.preventDefault(); fertig(false); } };
          ein.onblur = () => fertig(true);
        }
      });
    }

    ov.querySelector(".rz-exp-fuss").addEventListener("click", async (e) => {
      const b = e.target.closest("[data-tat]"); if (!b) return;
      const tat = b.dataset.tat;
      if (tat === "abbrechen") return schliessen();   // ruft opt.abbrechen
      if (tat === "merken") { st.merken = true; return zeichnen(); }
      if (tat === "merken-ok") return neueVorlage();
      if (tat === "los") return los(b);
    });
    ov.querySelector(".rz-exp-fuss").addEventListener("keydown", (e) => {
      if (!e.target.classList.contains("rz-exp-name-neu")) return;
      if (e.key === "Enter") { e.preventDefault(); neueVorlage(); }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); st.merken = false; zeichnen(); }
    });
    ov.querySelector(".rz-exp-inhalt").addEventListener("click", async (e) => {
      if (!e.target.closest('[data-tat="aendern"]')) return;
      const e2 = endung(bild);
      let p = "";
      try { p = await api().pick_save_path(st.ziel.name, st.ziel.ordner, filter(e2)); } catch (_) {}   // warte-ok: Systemdialog
      if (!p || !_offen) return;
      const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
      st.ziel = { ordner: p.slice(0, i), name: p.slice(i + 1) };
      zeichnen();
    });

    function neueVorlage() {
      const ein = ov.querySelector(".rz-exp-name-neu");
      const name = (ein && ein.value.trim()) || "";
      if (!name) { if (ein) ein.focus(); return; }
      const s = stand();
      const v = { id: "e" + Date.now().toString(36), name, w: s.w, h: s.h, fps: s.fps, codec: s.codec, farbraum: s.farbraum,
                  glaettung: isFinite(s.glaettung) ? s.glaettung : undefined };
      eigeneSpeichern(eigene().concat([v]));
      st.merken = false; zeichnen();
      try { toast(T("exportdlg.gemerkt", "Vorlage gespeichert") + ": " + name, "success", 1800); } catch (_) {}
    }

    async function los(knopf) {
      if (!st.ziel.ordner || !st.ziel.name) { ov.querySelector('[data-tat="aendern"]')?.click(); return; }
      knopf.disabled = true;
      nameAnpassen();
      const e2 = endung(bild);
      let r = null;
      try { r = await api().export_ziel_freigeben(st.ziel.ordner + trenner(st.ziel.ordner) + st.ziel.name, filter(e2)); } catch (_) {}   // warte-ok: kurz
      if (!r || !r.ok) {
        knopf.disabled = false;
        const grund = r && r.fehler === "ordner_fehlt" ? T("exportdlg.ordner_fehlt", "Der Ordner ist nicht erreichbar — bitte „Ändern …“.")
                    : r && r.fehler === "nicht_schreibbar" ? T("exportdlg.nicht_schreibbar", "In diesen Ordner darf nicht geschrieben werden — bitte „Ändern …“.")
                    : T("exportdlg.ziel_fehler", "Speicherort ungültig — bitte „Ändern …“.");
        try { toast(grund, "warn", 4000); } catch (_) {}
        return;
      }
      schliessen(true);
      try { await opt.starten(r.pfad); } catch (err) { try { applog("warn", "[export] Start: " + err); } catch (_) {} }
    }
  }

  window.rzExportDialog = { oeffnen, schliessen, offen: () => !!_offen, groesse, formatVon, eingebaut, standardAufNeuesProjekt, FORMATE };
})();
