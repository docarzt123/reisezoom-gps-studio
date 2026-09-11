/* Reisezoom GPS Studio — Tour-Assistent, Stufe 1 (11.09.2026, docs/TOUR-ASSISTENT.md §3)
 *
 * Menüpunkt „Tour-Assistent…" (⌘⇧N). Ein Fenster, drei Angaben, ein Knopf:
 * Track (Archiv oder Datei), Vorlage (vorbelegt ★), Projektname. Der Lauf ist
 * EINE Brücke (assistent_lauf): Track-Check-Reparatur als neue Version, Projekt
 * mit der Vorlage, dann Sprung in den Animator. Fortschritt als Zeilenliste.
 */
(function () {
  "use strict";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const tt = (k, f) => (typeof t === "function" ? t(k, f) : f);
  let _offen = false;

  async function openTourAssistent(vorgabe) {
    if (_offen) return;
    _offen = true;
    vorgabe = vorgabe || {};
    let pfad = vorgabe.path || "";
    const { liste, standard } = await window.rzVorlagenListe(true);
    const m = openModal({
      title: "🧭 " + tt("assistent.titel", "Tour-Assistent"),
      body: `<div class="lib-hint">${tt("assistent.intro", "Von der Tour zum fertigen Projekt: der Track wird geprüft und repariert (als neue Version im Archiv, „Ist so in Ordnung“ bleibt), dann entsteht ein Projekt mit der Vorlage, und du landest im Animator.")}</div>
        <div class="vorl-feld">${tt("assistent.track", "Track")}
          <div class="ass-track">
            <span id="ass-track-name" class="ass-track-name">${esc(pfad ? pfad.split("/").pop() : tt("assistent.track_keiner", "noch keiner gewählt"))}</span>
            <button type="button" class="btn btn-sm" id="ass-track-archiv">📚 ${tt("assistent.track_archiv", "Aus dem Archiv …")}</button>
            <button type="button" class="btn btn-ghost btn-sm" id="ass-track-datei">📂 ${tt("assistent.track_datei", "Datei …")}</button>
          </div></div>
        <label class="vorl-feld">${tt("vorlagen.feld", "Vorlage")}
          ${window.rzVorlageAuswahlHtml(liste, standard, "ass-vorlage")}</label>
        <label class="vorl-feld">${tt("assistent.name", "Projektname")}
          <input type="text" id="ass-name" class="lib-input" value="${esc(pfad ? pfad.split("/").pop().replace(/\.[^.]+$/, "") : "")}" placeholder="${esc(tt("assistent.name_ph", "leer = Name der Tour"))}"></label>
        <ol class="ass-schritte" id="ass-schritte" hidden></ol>
        <div class="lib-hint" id="ass-fehler" hidden></div>`,
      footer: `<button class="btn" id="ass-ab">${tt("common.cancel", "Abbrechen")}</button>
               <button class="btn btn-primary" id="ass-los" ${pfad ? "" : "disabled"}>🧭 ${tt("assistent.los", "Los")}</button>`,
      onClose: () => { _offen = false; },
    });
    const nameEl = document.getElementById("ass-name");
    const los = document.getElementById("ass-los");
    const setzePfad = (p) => {
      pfad = p || "";
      const n = document.getElementById("ass-track-name");
      if (n) n.textContent = pfad ? pfad.split("/").pop() : tt("assistent.track_keiner", "noch keiner gewählt");
      if (nameEl && !nameEl.value.trim() && pfad) nameEl.value = pfad.split("/").pop().replace(/\.[^.]+$/, "");
      if (los) los.disabled = !pfad;
    };
    const ba = document.getElementById("ass-track-archiv");
    if (ba) ba.onclick = async () => {
      if (typeof window.rzArchivTourenWaehlen !== "function") return;
      const pf = await window.rzArchivTourenWaehlen({ einzel: true, titel: tt("assistent.track_archiv_titel", "Tour für den Assistenten"), okText: tt("common.next", "Weiter") });
      if (pf && pf.length) setzePfad(pf[0]);
    };
    const bd = document.getElementById("ass-track-datei");
    if (bd) bd.onclick = async () => {
      const files = await api().pick_file("open", window.TRACK_PICK_FILTER, false);
      if (files && files.length) setzePfad(files[0]);
    };
    const ab = document.getElementById("ass-ab"); if (ab) ab.onclick = () => m.close();
    if (los) los.onclick = async () => {
      if (!pfad) return;
      const vid = (document.getElementById("ass-vorlage") || {}).value || "";
      const name = (nameEl && nameEl.value || "").trim();
      los.disabled = true; if (ba) ba.disabled = true; if (bd) bd.disabled = true;
      const ol = document.getElementById("ass-schritte");
      const fe = document.getElementById("ass-fehler");
      if (ol) { ol.hidden = false; ol.innerHTML = `<li class="ass-lauf">⏳ ${esc(tt("assistent.laeuft", "Track wird geprüft und repariert …"))}</li>`; }
      if (fe) fe.hidden = true;
      let r;
      try { r = await api().assistent_lauf(pfad, vid, name); } catch (e) { r = { ok: false, error: String(e), schritte: [] }; }
      if (ol) ol.innerHTML = (r && r.schritte || []).map(s => `<li class="${s.ok ? "ok" : "fehl"}">${s.ok ? "✅" : "⚠️"} ${esc(s.text)}</li>`).join("");
      if (!r || !r.ok) {
        if (fe) { fe.hidden = false; fe.textContent = tt("assistent.fehler", "Abgebrochen: {e}").replace("{e}", (r && r.error) || "?"); }
        los.disabled = false; if (ba) ba.disabled = false; if (bd) bd.disabled = false;
        return;
      }
      try { applog("info", "[assistent] fertig: Projekt " + r.project_id + " (" + (r.schritte || []).length + " Schritte)"); } catch (_) {}
      if (ol) ol.insertAdjacentHTML("beforeend", `<li class="ok">🎬 ${esc(tt("assistent.oeffnen", "Im Animator öffnen …"))}</li>`);
      // Öffnen über das Archiv — dort liegt der bewährte Weg (Solo/Reise/Version).
      setTimeout(() => {
        m.close();
        window.__rzProjektOeffnenId = r.project_id;
        window.__rzStartProjekte = true;
        if (typeof switchMod === "function") switchMod("library");
        window.dispatchEvent(new CustomEvent("rz-projekt-oeffnen", { detail: { id: r.project_id, modul: "animator" } }));
      }, 600);
    };
  }
  window.openTourAssistent = openTourAssistent;
  // ⌘⇧N / Strg+Umschalt+N
  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && String(e.key || "").toLowerCase() === "n") {
      e.preventDefault(); openTourAssistent();
    }
  }, true);
})();
