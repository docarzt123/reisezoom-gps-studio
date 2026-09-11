/* Reisezoom GPS Studio — Vorlagen (11.09.2026, docs/TOUR-ASSISTENT.md §2)
 *
 * Eine Vorlage ist ein leeres Projekt: alles Gestalterische, nichts, was am
 * Track hängt. Hier liegen die Bausteine, die Kopfzeile (projects.js) und
 * Archiv (modules/library) gemeinsam benutzen:
 *
 *   rzVorlagenListe()                       — Brücke, mit kurzem Cache
 *   rzVorlageAuswahlHtml(liste, selId, id)  — <select> mit ★ beim Standard
 *   rzNeuesProjektModal(vorschlag)          — Name + Vorlage → {name, vorlageId}
 *   rzVorlageSpeichernModal(pid, pname)     — „Als Vorlage speichern…"
 *   rzVorlageAnwendenModal(pid, pname, opt) — „Vorlage anwenden…" (Auswahl)
 *   rzVorlageAufAktivesProjekt(vid)         — im Modul anwenden, mit Undo-Schritt
 *
 * Undo (§2.4): Im Modul bekommt der Undo-Controller des offenen Moduls einen
 * Schritt „Vorlage angewendet" (applyState). Die übrigen Module ändert die
 * Brücke im Hintergrund; vor dem Anwenden sichert sie einen Arbeitsstand.
 */
(function () {
  "use strict";

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const tt = (k, f) => (typeof t === "function" ? t(k, f) : f);

  let _cache = null, _cacheAt = 0;
  async function rzVorlagenListe(frisch) {
    if (!frisch && _cache && performance.now() - _cacheAt < 2000) return _cache;
    let r = null;
    try { r = await api().vorlagen_liste(); } catch (e) { try { applog("warn", "[vorlagen] liste: " + e); } catch (_) {} }
    const liste = (r && r.ok && Array.isArray(r.vorlagen)) ? r.vorlagen : [];
    _cache = { liste, standard: (r && r.standard) || "reisezoom-standard" };
    _cacheAt = performance.now();
    return _cache;
  }
  window.rzVorlagenCacheLeeren = () => { _cache = null; };

  function rzVorlageAuswahlHtml(liste, selId, id) {
    return `<select id="${esc(id)}" class="lib-select vorl-select" style="width:100%">${
      liste.map(v => `<option value="${esc(v.id)}"${v.id === selId ? " selected" : ""}>${v.standard ? "★ " : ""}${esc(v.name)}</option>`).join("")}</select>`;
  }

  /** Kurzzeile einer Vorlage: Kartenstil · Format · Farbpunkt · Schrift. */
  function rzVorlageKurz(v) {
    const teile = [];
    if (v.map_style) teile.push(esc(v.map_style));
    if (v.format) teile.push(esc(v.format));
    if (v.font) teile.push(esc(v.font));
    const punkt = v.line_color ? `<span class="vorl-swatch" style="background:${esc(v.line_color)}"></span>` : "";
    return punkt + teile.join(" · ");
  }

  /** „Neues Projekt": Name + Vorlage in einem Fenster. Löst {name, vorlageId} oder null. */
  function rzNeuesProjektModal(vorschlag, titel, vorlageId) {
    return new Promise(async (resolve) => {
      const { liste, standard: stern } = await rzVorlagenListe();
      // Vorwahl: die mitgegebene Vorlage (Kachel „Neues Projekt daraus"), sonst der Stern.
      const standard = (vorlageId && liste.some(v => v.id === vorlageId)) ? vorlageId : stern;
      let fertig = false;
      const m = openModal({
        title: titel || tt("topbar.project.new_title", "Neues Projekt"),
        body: `<label class="vorl-feld">${tt("topbar.project.new_msg", "Name für das neue Projekt:")}
                 <input type="text" id="vorl-np-name" class="lib-input" value="${esc(vorschlag || "")}"></label>
               <label class="vorl-feld">${tt("vorlagen.feld", "Vorlage")}
                 ${rzVorlageAuswahlHtml(liste, standard, "vorl-np-vorlage")}</label>
               <div class="lib-hint">${tt("vorlagen.feld_hint", "★ = Mein Standard. Vorlagen verwaltest du im Archiv unter „Vorlagen“.")}</div>`,
        footer: `<button class="btn" id="vorl-np-ab">${tt("common.cancel", "Abbrechen")}</button>
                 <button class="btn btn-primary" id="vorl-np-ok">OK</button>`,
        onClose: () => { if (!fertig) { fertig = true; resolve(null); } },
      });
      const ok = document.getElementById("vorl-np-ok");
      const ab = document.getElementById("vorl-np-ab");
      const inp = document.getElementById("vorl-np-name");
      const go = () => {
        const name = (inp && inp.value || "").trim();
        const vid = (document.getElementById("vorl-np-vorlage") || {}).value || "";
        fertig = true; m.close();
        resolve(name ? { name, vorlageId: vid } : null);
      };
      if (ok) ok.onclick = go;
      if (inp) { inp.focus(); inp.select(); inp.onkeydown = (e) => { if (e.key === "Enter") go(); }; }
      if (ab) ab.onclick = () => { fertig = true; m.close(); resolve(null); };
    });
  }

  /** „Als Vorlage speichern…" für ein Projekt. Löst {id, name} oder null. */
  function rzVorlageSpeichernModal(projectId, projectName) {
    return new Promise((resolve) => {
      let fertig = false;
      const m = openModal({
        title: "🧩 " + tt("vorlagen.speichern_titel", "Als Vorlage speichern"),
        body: `<div class="lib-hint">${tt("vorlagen.speichern_hint", "Übernommen wird alles Gestalterische (Karte, Track-Form, Kamera, Overlays, Schilder, Render). Keyframes, Schilder-Positionen, Fotos, Gruppen und Schnitt bleiben beim Projekt.")}</div>
               <label class="vorl-feld">${tt("vorlagen.name", "Name der Vorlage")}
                 <input type="text" id="vorl-sp-name" class="lib-input" value="${esc(projectName || "")}"></label>`,
        footer: `<button class="btn" id="vorl-sp-ab">${tt("common.cancel", "Abbrechen")}</button>
                 <button class="btn btn-primary" id="vorl-sp-ok">${tt("vorlagen.speichern_btn", "Speichern")}</button>`,
        onClose: () => { if (!fertig) { fertig = true; resolve(null); } },
      });
      const inp = document.getElementById("vorl-sp-name");
      const go = async () => {
        const name = (inp && inp.value || "").trim();
        if (!name) return;
        fertig = true; m.close();
        const r = await api().vorlage_anlegen(name, projectId);
        if (r && r.ok) {
          window.rzVorlagenCacheLeeren();
          toast(tt("vorlagen.gespeichert", "Vorlage „{n}“ gespeichert.").replace("{n}", (r.vorlage || {}).name || name), "success");
          window.dispatchEvent(new CustomEvent("rz-vorlagen-geaendert"));
          resolve(r.vorlage || null);
        } else { toast((r && r.error) || "?", "error"); resolve(null); }
      };
      const ok = document.getElementById("vorl-sp-ok"); if (ok) ok.onclick = go;
      if (inp) { inp.focus(); inp.select(); inp.onkeydown = (e) => { if (e.key === "Enter") go(); }; }
      const ab = document.getElementById("vorl-sp-ab"); if (ab) ab.onclick = () => { fertig = true; m.close(); resolve(null); };
    });
  }

  /** „Vorlage anwenden…": Auswahl-Fenster. `opt.anwenden(vid, vorlage)` führt aus.
   *  Löst die gewählte Vorlagen-ID oder null. */
  function rzVorlageAnwendenModal(projectId, projectName, opt) {
    opt = opt || {};
    return new Promise(async (resolve) => {
      const { liste, standard } = await rzVorlagenListe(true);
      let fertig = false;
      const m = openModal({
        title: "🧩 " + tt("vorlagen.anwenden_titel", "Vorlage anwenden"),
        body: `<div class="lib-hint">${tt("vorlagen.anwenden_hint", "Auf „{p}“: Karte, Track-Form, Kamera, Overlays, Schilder-Stil und Render werden aus der Vorlage übernommen. Keyframes, Schilder, Fotos, Gruppen und Schnitt bleiben stehen. Rückgängig mit ⌘Z.").replace("{p}", esc(projectName || ""))}</div>
               <label class="vorl-feld">${tt("vorlagen.feld", "Vorlage")}
                 ${rzVorlageAuswahlHtml(liste, standard, "vorl-an-vorlage")}</label>
               <div class="lib-hint" id="vorl-an-kurz"></div>`,
        footer: `<button class="btn" id="vorl-an-ab">${tt("common.cancel", "Abbrechen")}</button>
                 <button class="btn btn-primary" id="vorl-an-ok">${tt("vorlagen.anwenden_btn", "Anwenden")}</button>`,
        onClose: () => { if (!fertig) { fertig = true; resolve(null); } },
      });
      const sel = document.getElementById("vorl-an-vorlage");
      const kurz = document.getElementById("vorl-an-kurz");
      const zeigeKurz = () => {
        const v = liste.find(x => x.id === (sel && sel.value)) || {};
        if (kurz) kurz.innerHTML = rzVorlageKurz(v);
      };
      if (sel) sel.onchange = zeigeKurz;
      zeigeKurz();
      const ok = document.getElementById("vorl-an-ok");
      if (ok) ok.onclick = async () => {
        const vid = (sel && sel.value) || "";
        fertig = true; m.close();
        if (opt.anwenden) await opt.anwenden(vid, liste.find(x => x.id === vid) || {});
        resolve(vid || null);
      };
      const ab = document.getElementById("vorl-an-ab"); if (ab) ab.onclick = () => { fertig = true; m.close(); resolve(null); };
    });
  }

  const MODUL_SEKTION = { animator: "animator", tourmap: "tourmap", heightanim: "heightanim", geotagger: "geotagger" };

  /** Vorlagen-Leiste oben in der Seitenleiste eines Gestaltungs-Moduls (Marc,
   *  11.09.2026: „im animator selber … Vorlagen müssen für alle module gelten wo
   *  man grafisch was baut"). Liefert HTML; die Knöpfe werden verdrahtet, sobald
   *  das Element im DOM steht (rAF-Wiederholung, wie rzMakePanelUndoController). */
  function rzVorlagenLeiste(prefix) {
    const sel = prefix + "-vorl-select", an = prefix + "-vorl-anwenden", sp = prefix + "-vorl-speichern";
    let tries = 0;
    const wire = () => {
      const s = document.getElementById(sel);
      if (!s) return false;
      rzVorlagenListe(true).then(({ liste, standard }) => {
        if (!document.getElementById(sel)) return;
        s.innerHTML = liste.map(v => `<option value="${esc(v.id)}"${v.id === standard ? " selected" : ""}>${v.standard ? "★ " : ""}${esc(v.name)}</option>`).join("");
      });
      const a = document.getElementById(an), b = document.getElementById(sp);
      if (a) a.onclick = () => rzVorlageAufAktivesProjekt(s.value || "");
      if (b) b.onclick = () => {
        const proj = (typeof getActiveProject === "function") ? getActiveProject() : null;
        if (!proj || !proj.id) { toast(tt("vorlagen.kein_projekt", "Kein Projekt aktiv."), "warn"); return; }
        rzVorlageSpeichernModal(proj.id, proj.name || "").then(v => { if (v) rzVorlagenLeisteAuffrischen(); });
      };
      return true;
    };
    const retry = () => { if (wire() || ++tries > 60) return; requestAnimationFrame(retry); };
    requestAnimationFrame(retry);
    return `<div class="vorl-leiste" id="${esc(prefix)}-vorl-leiste" title="${esc(tt("vorlagen.leiste_tip", "Vorlage = Karte, Track-Form, Kamera, Overlays, Schilder-Stil, Render — nichts Trackgebundenes. Anwenden ist ein ⌘Z-Schritt."))}">
      <span class="vorl-leiste-ico">🧩</span>
      <select id="${esc(sel)}" class="vorl-leiste-select"></select>
      <button type="button" class="btn btn-sm" id="${esc(an)}">${tt("vorlagen.anwenden_btn", "Anwenden")}</button>
      <button type="button" class="btn btn-ghost btn-sm" id="${esc(sp)}" title="${esc(tt("vorlagen.menu_speichern", "Als Vorlage speichern …"))}">💾</button>
    </div>`;
  }
  /** Alle sichtbaren Leisten neu füllen (nach Speichern/Umbenennen/Stern). */
  function rzVorlagenLeisteAuffrischen() {
    document.querySelectorAll(".vorl-leiste-select").forEach(s => {
      rzVorlagenListe(true).then(({ liste, standard }) => {
        const cur = s.value;
        s.innerHTML = liste.map(v => `<option value="${esc(v.id)}"${v.id === (liste.some(x => x.id === cur) ? cur : standard) ? " selected" : ""}>${v.standard ? "★ " : ""}${esc(v.name)}</option>`).join("");
      });
    });
  }
  window.addEventListener("rz-vorlagen-geaendert", rzVorlagenLeisteAuffrischen);

  /** Vorlage auf das AKTIVE Projekt legen — im Modul, mit Undo-Schritt. */
  async function rzVorlageAufAktivesProjekt(vid) {
    const proj = (typeof getActiveProject === "function") ? getActiveProject() : null;
    if (!proj || !proj.id) { toast(tt("vorlagen.kein_projekt", "Kein Projekt aktiv."), "warn"); return false; }
    const r = await api().vorlage_anwenden(proj.id, vid);
    if (!r || !r.ok) { toast((r && r.error) || "?", "error"); return false; }
    const nachher = r.nachher || {}, vorher = r.vorher || {};
    // 1) Speicher-Stand aller betroffenen Module nachziehen (Brücke hat gespeichert).
    for (const sec in nachher) { try { window.rzSetModuleSettingsLocal(sec, nachher[sec]); } catch (_) {} }
    // 2) Das offene Modul: Undo-Schritt + volle sichtbare Wirkung über sein eigenes apply.
    const mod = (typeof window.rzActiveModuleForUndo === "function") ? window.rzActiveModuleForUndo() : null;
    const sec = MODUL_SEKTION[mod];
    const ctrl = mod && window.__rzUndoControllers && window.__rzUndoControllers[mod];
    const label = tt("vorlagen.undo_label", "Vorlage angewendet");
    if (sec && nachher[sec] && ctrl && typeof ctrl.applyState === "function" && (mod === "animator" || mod === "tourmap")) {
      // Der Stand DAVOR muss den Sektions-Block sein, wie ihn das Modul kennt.
      ctrl.applyState(nachher[sec], label, vorher[sec] || null);
    } else {
      // Geotagger/Daten-Animator halten ihre Werte in den Feldern (DOM-Snapshot-Undo):
      // Stand davor sichern, dann gebundene Felder neu lesen.
      if (ctrl && typeof ctrl.push === "function") { try { ctrl.push(label, { force: true }); } catch (_) {} }
      try { window.__rzUndoApplying = true; if (typeof rebindAllSettings === "function") rebindAllSettings(); }
      finally { setTimeout(() => { window.__rzUndoApplying = false; }, 0); }
      // Daten-Animator und Web-Karte lesen ihr Projekt beim Sitzungs-Ereignis neu.
      try { if (typeof _notifySessionChanged === "function") _notifySessionChanged(); } catch (_) {}
      try { if (typeof window._animOnProjectChanged === "function") window._animOnProjectChanged(); } catch (_) {}
    }
    try { applog("info", "[vorlagen] angewendet: " + (r.vorlage || vid) + " auf " + proj.id + " (" + Object.keys(nachher).join(",") + ", Modul " + (mod || "-") + ")"); } catch (_) {}
    toast(tt("vorlagen.angewendet", "Vorlage „{n}“ angewendet.").replace("{n}", r.vorlage || ""), "success");
    return true;
  }

  window.rzVorlagenListe = rzVorlagenListe;
  window.rzVorlageAuswahlHtml = rzVorlageAuswahlHtml;
  window.rzVorlageKurz = rzVorlageKurz;
  window.rzNeuesProjektModal = rzNeuesProjektModal;
  window.rzVorlageSpeichernModal = rzVorlageSpeichernModal;
  window.rzVorlageAnwendenModal = rzVorlageAnwendenModal;
  window.rzVorlageAufAktivesProjekt = rzVorlageAufAktivesProjekt;
  window.rzVorlagenLeiste = rzVorlagenLeiste;
  window.rzVorlagenLeisteAuffrischen = rzVorlagenLeisteAuffrischen;
})();
