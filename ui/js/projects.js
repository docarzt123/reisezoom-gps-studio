/* Reisezoom GPS Studio — Topbar-Projekt-Dropdown (v0.8.0)
 *
 * Hängt an `#topbar-project` und reagiert auf `onSessionChanged` aus util.js.
 * Sichtbar nur wenn eine Session aktiv ist (= GPX geladen).
 *
 * Aktionen:
 *   - Klick auf Projekt-Eintrag → wechseln
 *   - Neues Projekt → Mini-Modal mit Name-Eingabe (Default-Werte)
 *   - Duplizieren → Mini-Modal mit Name (Kopie des aktuellen)
 *   - Umbenennen → Mini-Modal mit aktuellem Namen vor-gefüllt
 *   - Löschen → Confirm-Modal
 */

(function() {
  "use strict";

  function init() {
    const wrap = document.getElementById("topbar-project");
    const btn = document.getElementById("topbar-project-btn");
    const menu = document.getElementById("topbar-project-menu");
    const label = document.getElementById("topbar-project-label");
    if (!wrap || !btn || !menu || !label) return;

    // Outside-Click schließt Menü
    document.addEventListener("click", (e) => {
      if (!wrap.contains(e.target)) {
        menu.hidden = true;
      }
    });
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
      if (!menu.hidden) renderMenu();
    });

    function renderLabel() {
      const session = (typeof getActiveSession === "function") ? getActiveSession() : null;
      const project = (typeof getActiveProject === "function") ? getActiveProject() : null;
      if (!session || !project) {
        wrap.hidden = true;
        return;
      }
      wrap.hidden = false;
      // Format: "Session-Name · Projekt-Name"
      const sname = session.name || "?";
      const pname = project.name || "Standard";
      label.textContent = `${sname} · ${pname}`;
      label.title = `Session: ${sname}\nAktives Projekt: ${pname}`;
    }

    function renderMenu() {
      const session = (typeof getActiveSession === "function") ? getActiveSession() : null;
      const project = (typeof getActiveProject === "function") ? getActiveProject() : null;
      const projects = (typeof getProjectsList === "function") ? getProjectsList() : [];
      if (!session || !project) {
        menu.innerHTML = `<div class="topbar-project-menu-info">${tT("topbar.project.no_session", "Lade ein GPX um Projekte zu nutzen.")}</div>`;
        return;
      }
      const stats = session.stats || {};
      const distKm = stats.distance_m ? (stats.distance_m / 1000).toFixed(1) + " km" : "";
      const nPts = stats.n_points ? `${stats.n_points} Punkte` : "";
      const statInfo = [distKm, nPts].filter(Boolean).join(" · ");

      let html = `<div class="topbar-project-menu-section-title">${tT("topbar.project.session_label", "Session")}</div>`;
      html += `<div class="topbar-project-menu-info">
                <strong>${escapeHtml(session.name)}</strong>${statInfo ? `<br><span>${escapeHtml(statInfo)}</span>` : ""}
              </div>`;
      html += `<div class="topbar-project-menu-section-title">${tT("topbar.project.projects_label", "Projekte")}</div>`;
      for (const p of projects) {
        const bullet = p.is_active ? "●" : "○";
        html += `<button type="button" class="topbar-project-menu-item${p.is_active ? " is-active" : ""}" data-action="switch" data-id="${escapeAttr(p.id)}">
                  <span class="item-bullet">${bullet}</span>
                  <span class="item-name">${escapeHtml(p.name)}</span>
                 </button>`;
      }
      html += `<div class="topbar-project-menu-sep"></div>`;
      html += `<button type="button" class="topbar-project-menu-item menu-action" data-action="new">+ ${tT("topbar.project.action_new", "Neues Projekt")}</button>`;
      html += `<button type="button" class="topbar-project-menu-item menu-action" data-action="duplicate">⎘ ${tT("topbar.project.action_duplicate", "Aktuelles duplizieren")}</button>`;
      html += `<button type="button" class="topbar-project-menu-item menu-action" data-action="rename">✎ ${tT("topbar.project.action_rename", "Umbenennen …")}</button>`;
      html += `<button type="button" class="topbar-project-menu-item menu-action menu-action-danger" data-action="delete">🗑 ${tT("topbar.project.action_delete", "Aktuelles löschen")}</button>`;
      // v0.9.28: Session komplett schließen — clearGlobalGpx leert Track,
      // Session-Aktivierung + persistierten last_gpx_path. App ist dann „leer".
      html += `<div class="topbar-project-menu-sep"></div>`;
      // 22.08.2026 — Projekt-Datei (.rzproj): Track + alle Projekte + Foto-Vorschauen, ohne Cloud
      html += `<button type="button" class="topbar-project-menu-item menu-action" data-action="export_project">⇪ ${tT("topbar.project.action_export", "Projekt exportieren (.rzproj)…")}</button>`;
      html += `<button type="button" class="topbar-project-menu-item menu-action" data-action="import_project">⇩ ${tT("topbar.project.action_import", "Projekt importieren (.rzproj)…")}</button>`;
      html += `<div class="topbar-project-menu-sep"></div>`;
      html += `<button type="button" class="topbar-project-menu-item menu-action" data-action="close_session">✕ ${tT("topbar.project.action_close_session", "Session schließen")}</button>`;
      menu.innerHTML = html;

      // Aktionen verdrahten
      menu.querySelectorAll("[data-action]").forEach(el => {
        el.addEventListener("click", async (e) => {
          e.stopPropagation();
          const action = el.dataset.action;
          if (action === "switch") {
            const id = el.dataset.id;
            if (id && id !== project.id) {
              await projectSetActive(id);
              if (typeof rebindAllSettings === "function") rebindAllSettings();
              // Animator-spezifisch: Pin-Layer + Editor neu
              if (typeof window._animOnProjectChanged === "function") window._animOnProjectChanged();
            }
            menu.hidden = true;
          } else if (action === "new") {
            menu.hidden = true;
            const name = await promptModal(
              tT("topbar.project.new_title", "Neues Projekt"),
              tT("topbar.project.new_msg", "Name für das neue Projekt:"),
              suggestName(projects, "Projekt"),
            );
            if (name) {
              await projectCreate(name, "");
              if (typeof rebindAllSettings === "function") rebindAllSettings();
              if (typeof window._animOnProjectChanged === "function") window._animOnProjectChanged();
            }
          } else if (action === "duplicate") {
            menu.hidden = true;
            const name = await promptModal(
              tT("topbar.project.dup_title", "Projekt duplizieren"),
              tT("topbar.project.dup_msg", "Name für das Duplikat:"),
              project.name + " (Kopie)",
            );
            if (name) {
              await projectCreate(name, project.id);
              if (typeof rebindAllSettings === "function") rebindAllSettings();
              if (typeof window._animOnProjectChanged === "function") window._animOnProjectChanged();
            }
          } else if (action === "rename") {
            menu.hidden = true;
            const name = await promptModal(
              tT("topbar.project.rename_title", "Projekt umbenennen"),
              tT("topbar.project.rename_msg", "Neuer Name:"),
              project.name,
            );
            if (name && name !== project.name) {
              await projectRename(project.id, name);
            }
          } else if (action === "delete") {
            menu.hidden = true;
            const ok = await confirmModal(
              tT("topbar.project.del_title", "Projekt löschen?"),
              tT("topbar.project.del_msg", "„{name}“ wirklich löschen? Das letzte verbleibende Projekt wird automatisch als „Standard“ wiederhergestellt.").replace("{name}", project.name),
              tT("topbar.project.del_confirm", "Löschen"),
              true,
            );
            if (ok) {
              await projectDelete(project.id);
              if (typeof rebindAllSettings === "function") rebindAllSettings();
              if (typeof window._animOnProjectChanged === "function") window._animOnProjectChanged();
            }
          } else if (action === "export_project") {
            menu.hidden = true;
            if (window.exportProject) await window.exportProject();
          } else if (action === "import_project") {
            menu.hidden = true;
            if (window.importProject) await window.importProject();
          } else if (action === "close_session") {
            // v0.9.28/31: Session schließen — räumt:
            //   1. Backend: laufender Thumb-Worker stoppen + _gtg_photos/track leeren
            //      (sonst läuft EXIF/Thumb-Generation weiter obwohl der User Session
            //      schon geschlossen hat — Marc-Bug-Report v0.9.30)
            //   2. globalen GPX-State + Session
            //   3. persistierten last_gpx_path + Geotagger-Settings
            //   4. Animator-Editor neu rendern (KFs der alten Session weg)
            //   Der GPX-clear-Listener im Geotagger räumt das Frontend
            //   (photos, markers, grid).
            menu.hidden = true;
            try { await api().geotagger_clear(); } catch (_) {}
            try { if (typeof clearGlobalGpx === "function") clearGlobalGpx(); } catch (_) {}
            try { if (typeof saveSettings === "function") saveSettings({ last_gpx_path: "", geotagger: { last_photos_dir: "", last_photos_paths: [] } }); } catch (_) {}
            try { if (typeof window._animOnProjectChanged === "function") window._animOnProjectChanged(); } catch (_) {}
          }
        });
      });
    }

    // Session-Listener
    if (typeof onSessionChanged === "function") {
      onSessionChanged(() => {
        renderLabel();
        if (!menu.hidden) renderMenu();
      });
    }
    // Initial
    renderLabel();
  }

  function suggestName(projects, base) {
    let n = (projects?.length || 0) + 1;
    const names = new Set((projects || []).map(p => p.name));
    while (names.has(`${base} ${n}`)) n++;
    return `${base} ${n}`;
  }

  // Mini-Prompt + Confirm Modals — nutzen den globalen #modal-overlay
  function promptModal(title, message, defaultValue) {
    return new Promise(resolve => {
      const overlay = document.getElementById("modal-overlay");
      const titleEl = document.getElementById("modal-title");
      const bodyEl = document.getElementById("modal-body");
      const footerEl = document.getElementById("modal-footer");
      const closeBtn = document.getElementById("modal-close");
      if (!overlay) return resolve(null);
      titleEl.textContent = title;
      bodyEl.innerHTML = `<p style="margin-bottom:12px; color:var(--text-dim); font-size:13px;">${escapeHtml(message)}</p>
                          <input type="text" id="prompt-modal-input" class="text-input" style="width:100%; padding:8px 12px; font-size:14px; border-radius:6px; background:var(--bg-2); color:var(--text); border:1px solid var(--border);" />`;
      const inp = bodyEl.querySelector("#prompt-modal-input");
      inp.value = defaultValue || "";
      footerEl.innerHTML = `<button class="btn" id="prompt-cancel">${tT("common.cancel","Abbrechen")}</button>
                            <button class="btn btn-primary" id="prompt-ok">${tT("common.ok","OK")}</button>`;
      overlay.hidden = false;
      setTimeout(() => { inp.focus(); inp.select(); }, 30);
      const cleanup = (val) => {
        overlay.hidden = true;
        resolve(val);
      };
      footerEl.querySelector("#prompt-cancel").onclick = () => cleanup(null);
      footerEl.querySelector("#prompt-ok").onclick = () => cleanup(inp.value.trim() || null);
      closeBtn.onclick = () => cleanup(null);
      inp.onkeydown = (e) => {
        if (e.key === "Enter") { e.preventDefault(); cleanup(inp.value.trim() || null); }
        else if (e.key === "Escape") { e.preventDefault(); cleanup(null); }
      };
    });
  }

  function confirmModal(title, message, confirmLabel, danger) {
    return new Promise(resolve => {
      const overlay = document.getElementById("modal-overlay");
      const titleEl = document.getElementById("modal-title");
      const bodyEl = document.getElementById("modal-body");
      const footerEl = document.getElementById("modal-footer");
      const closeBtn = document.getElementById("modal-close");
      if (!overlay) return resolve(false);
      titleEl.textContent = title;
      bodyEl.innerHTML = `<p style="color:var(--text-dim); font-size:13px;">${escapeHtml(message)}</p>`;
      const dangerClass = danger ? "btn-danger-solid" : "btn-primary";
      // Farbe über die Klasse, nicht per Inline-Stil: Vorher war das der
      // EINZIGE gefüllte Gefahr-Knopf der App (alle anderen sind Umriss-
      // Knöpfe) und trug einen sechsten Rotton. Ausgerechnet beim Löschen
      // sollte man wiedererkennen, was man vor sich hat.
      const dangerStyle = "";
      footerEl.innerHTML = `<button class="btn" id="confirm-cancel">${tT("common.cancel","Abbrechen")}</button>
                            <button class="btn ${dangerClass}" id="confirm-ok" style="${dangerStyle}">${escapeHtml(confirmLabel)}</button>`;
      overlay.hidden = false;
      // Escape und Klick daneben brechen ab. Vorher ging beides nicht — in
      // jedem anderen Dialog der App schon, und ausgerechnet beim Löschen fehlte
      // der Rückweg über die Tastatur ganz.
      const escHandler = (ev) => { if (ev.key === "Escape") cleanup(false); };
      document.addEventListener("keydown", escHandler);
      overlay.onclick = (ev) => { if (ev.target === overlay) cleanup(false); };
      const cleanup = (val) => {
        document.removeEventListener("keydown", escHandler);
        overlay.onclick = null;
        overlay.hidden = true;
        resolve(val);
      };
      footerEl.querySelector("#confirm-cancel").onclick = () => cleanup(false);
      footerEl.querySelector("#confirm-ok").onclick = () => cleanup(true);
      closeBtn.onclick = () => cleanup(false);
    });
  }
  // 22.08.2026 (Audit): für Module freigeben (Inspektor „Lücke füllen" u.a.)
  window.rzConfirm = confirmModal;

  function tT(key, fallback) {
    try {
      if (typeof t === "function") {
        const s = t(key);
        if (s && s !== key) return s;
      }
    } catch (_) {}
    return fallback;
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
