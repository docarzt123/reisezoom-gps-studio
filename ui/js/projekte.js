// ui/js/projekte.js — Projektmanager als EIGENE Vollbild-Ansicht (v0.9.601).
//
// Marc (29.08.2026): „das ist blöd, dass die projekte über die sidebar geöffnet
// werden, weil ja weiterhin die tourfilter usw da sind. mach den projektmanager
// nach oben links neben ‚anderen track wählen' und bau eine komplett neue
// ansicht für die projekte." — Die E1-Erstfassung (Q21) lag als Bereich in der
// Archiv-Seitenleiste; die Archiv-Filter (Jahr, Aktivität, Bereiche) standen
// daneben und wirkten, als gälten sie auch hier. Jetzt: Overlay über allem,
// erreichbar über den 🗂-Knopf in der Track-Leiste jedes Moduls; die App
// startet in dieser Ansicht (app.js ruft projektManagerOeffnen beim Boot).
//
// Öffnen-Logik (Q22) unverändert: Solo lädt die Tour und springt ins zuletzt
// benutzte Modul; Kompositionen gehen den bewährten Übergabe-Weg
// (__rzPendingTours + Lade-Modal) — Ablauf und Modus stecken im Projekt.
(() => {
  "use strict";

  const T = (k, fb) => (typeof t === "function" ? t(k, fb) : fb);

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d)) return String(iso).slice(0, 10);
    let loc;
    try { loc = (typeof i18nMeta === "function") ? i18nMeta().active : null; } catch (_) { loc = null; }
    return d.toLocaleDateString(loc || undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
  }

  let _projekte = [];
  let _filterGh = "";       // „nur Projekte dieser Tour" (Sprung aus dem Archiv)
  let _sucheTimer = null;

  function overlayBauen() {
    if (document.getElementById("pmgr-overlay")) return;
    const el = document.createElement("div");
    el.id = "pmgr-overlay";
    el.hidden = true;
    el.innerHTML = `
      <div class="pmgr-kopf">
        <span class="pmgr-titel">🗂 ${T("pm.title", "Projekte")}</span>
        <span class="pmgr-sub" id="pmgr-n"></span>
        <input type="search" id="pmgr-search" class="pmgr-search"
               placeholder="${esc(T("pm.search", "Projekte durchsuchen …"))}">
        <button type="button" class="pmgr-close" id="pmgr-close"
                title="${esc(T("common.close", "Schließen"))}">✕</button>
      </div>
      <div class="pmgr-body" id="pmgr-body"></div>`;
    document.body.appendChild(el);
    document.getElementById("pmgr-close").onclick = () => window.projektManagerZu();
    document.getElementById("pmgr-search").oninput = () => {
      clearTimeout(_sucheTimer);
      _sucheTimer = setTimeout(() => { renderProjekte().catch(() => {}); }, 200);
    };
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !el.hidden) window.projektManagerZu();
    });
  }

  window.projektManagerOeffnen = function(opts) {
    _filterGh = (opts && opts.filterGh) || "";
    overlayBauen();
    const el = document.getElementById("pmgr-overlay");
    // Die Topbar (Modul-Tabs, Projekt-Umschalter, Einstellungen) bleibt
    // sichtbar und bedienbar — das Overlay beginnt direkt darunter.
    const tb = document.querySelector(".topbar");
    if (tb) el.style.top = Math.round(tb.getBoundingClientRect().bottom) + "px";
    el.hidden = false;
    renderProjekte().catch(() => {});
    const s = document.getElementById("pmgr-search");
    if (s && !_filterGh) { try { s.focus(); } catch (_) {} }
  };

  window.projektManagerZu = function() {
    const el = document.getElementById("pmgr-overlay");
    if (el) el.hidden = true;
  };

  window.projektManagerOffen = function() {
    const el = document.getElementById("pmgr-overlay");
    return !!(el && !el.hidden);
  };

  async function renderProjekte() {
    const box = document.getElementById("pmgr-body");
    if (!box) return;
    const res = await api().projekte_liste();
    _projekte = (res && res.projekte) || [];
    const nEl = document.getElementById("pmgr-n");
    if (nEl) {
      const n = _projekte.filter(p => !p.auto).length;
      nEl.textContent = n ? T("pm.count", "{n} eigene").replace("{n}", n) : "";
    }
    const sEl = document.getElementById("pmgr-search");
    const suche = ((sEl && sEl.value) || "").trim().toLowerCase();
    const passt = (p) => (!_filterGh || (p.geo_hashes || []).includes(_filterGh))
      && (!suche
          || p.name.toLowerCase().includes(suche)
          || (p.tour_namen || []).some(n => n.toLowerCase().includes(suche)));
    const deine = _projekte.filter(p => !p.auto && passt(p));
    const autos = _projekte.filter(p => p.auto && passt(p));
    const rang = { aktiv: 0, idee: 1, fertig: 2 };
    deine.sort((a, b) => (rang[a.status] ?? 0) - (rang[b.status] ?? 0)
      || String(b.modified_at || "").localeCompare(String(a.modified_at || "")));
    autos.sort((a, b) => String(b.modified_at || "").localeCompare(String(a.modified_at || "")));
    const MODUL_CHIP = { animator: ["🎬", "Animator"], tourmap: ["🗺", "Tour-Map"],
                         geotagger: ["📷", "Geotagger"], heightanim: ["📈", T("library.proj_daten", "Daten")] };
    const karte = (p) => {
      const ablauf = p.ablauf === "schwarm"
        ? `🌊 ${T("schwarm.name", "Schwarm")} · ${p.n_touren} ${T("library.tours", "Touren")}`
        : p.ablauf === "reise"
          ? `🧵 ${T("library.proj_reise", "Reise")} · ${p.n_touren} ${T("library.tours", "Touren")}`
          : esc((p.tour_namen || [])[0] || "");
      const chips = (p.module || []).map(m => {
        const c = MODUL_CHIP[m] || ["▫", m];
        return `<button class="lib-proj-chip" data-open-modul="${m}" data-pid="${p.id}" title="${esc(c[1])}">${c[0]}</button>`;
      }).join("");
      const wann = fmtDate(p.modified_at);
      const fehlt = p.exists === false ? ` <span class="lib-proj-fehlt" title="${T("library.proj_fehlt_tip", "Tour-Datei nicht gefunden — Öffnen sucht sie im Archiv.")}">⚠️</span>` : "";
      return `<div class="lib-proj-karte${p.status === "fertig" ? " fertig" : ""}" data-pid="${p.id}">
        <div class="lib-proj-kopf">
          <span class="lib-proj-name">${esc(p.name)}</span>${fehlt}
          <select class="lib-proj-status" data-pid="${p.id}" title="${T("library.proj_status", "Status")}">
            <option value="aktiv"${p.status === "aktiv" ? " selected" : ""}>${T("library.proj_st_aktiv", "aktiv")}</option>
            <option value="idee"${p.status === "idee" ? " selected" : ""}>${T("library.proj_st_idee", "Idee")}</option>
            <option value="fertig"${p.status === "fertig" ? " selected" : ""}>${T("library.proj_st_fertig", "fertig")}</option>
          </select>
        </div>
        <div class="lib-proj-sub">${ablauf}</div>
        <div class="lib-proj-fuss">
          <span class="lib-proj-chips">${chips}</span>
          <span class="lib-proj-wann">${wann}</span>
          <span class="lib-proj-akt">
            <button class="btn btn-primary btn-sm" data-open="${p.id}">${T("library.proj_open", "Öffnen")}</button>
            <button class="btn btn-ghost btn-sm" data-ren="${p.id}" title="${T("library.rename", "Umbenennen")}">✎</button>
            <button class="btn btn-ghost btn-sm" data-dup="${p.id}" title="${T("library.col_duplicate", "Duplizieren")}">⎘</button>
            <button class="btn btn-ghost btn-sm lib-btn-danger" data-del="${p.id}" title="${T("library.proj_delete", "Projekt löschen")}">🗑</button>
          </span>
        </div>
      </div>`;
    };
    const filterChip = _filterGh
      ? `<div class="lib-proj-filter">${T("library.proj_filter_tour", "Nur Projekte dieser Tour")}
           <button type="button" id="pmgr-filter-x">✕</button></div>` : "";
    box.innerHTML = `${filterChip}
      <div class="lib-proj-liste pmgr-liste">${deine.map(karte).join("")
        || `<div class="lib-empty"><div class="lib-empty-title">${T("library.proj_leer", "Noch keine Projekte — öffne eine Tour oder starte einen Schwarm, dann entsteht hier dein Arbeitsstand.")}</div></div>`}
      </div>
      ${autos.length ? `<details class="lib-proj-autos"><summary>${T("library.proj_autos", "Automatisch angelegt")} (${autos.length})<span class="gpxi-q" data-tip="${T("library.proj_autos_tip", "Beim Öffnen einer Tour entsteht automatisch ein Arbeitsstand. Sobald du darin etwas baust oder ihn umbenennst, wandert er nach oben zu deinen Projekten.")}">?</span></summary>
        <div class="lib-proj-liste pmgr-liste">${autos.map(karte).join("")}</div></details>` : ""}`;
    if (typeof initHelpTips === "function") { try { initHelpTips(box); } catch (_) {} }
    { const fx = document.getElementById("pmgr-filter-x");
      if (fx) fx.onclick = () => { _filterGh = ""; renderProjekte(); }; }
    box.querySelectorAll("[data-open]").forEach(b => b.onclick = () => projektOeffnen(b.dataset.open));
    box.querySelectorAll("[data-open-modul]").forEach(b => b.onclick = (e) => {
      e.stopPropagation(); projektOeffnen(b.dataset.pid, b.dataset.openModul);
    });
    box.querySelectorAll(".lib-proj-status").forEach(sel => sel.onchange = async () => {
      await api().projekt_status_setzen(sel.dataset.pid, sel.value);
      renderProjekte();
    });
    box.querySelectorAll("[data-ren]").forEach(b => b.onclick = () => {
      const p = _projekte.find(x => x.id === b.dataset.ren);
      const m = openModal({
        title: "✎ " + T("library.rename", "Umbenennen"),
        body: `<input type="text" id="pmgr-neuname" class="lib-input" value="${esc((p || {}).name || "")}">`,
        footer: `<button class="btn" id="pmgr-ren-ab">${T("common.cancel", "Abbrechen")}</button>
                 <button class="btn btn-primary" id="pmgr-ren-ok">OK</button>`,
      });
      const ok = document.getElementById("pmgr-ren-ok");
      if (ok) ok.onclick = async () => {
        const v = (document.getElementById("pmgr-neuname") || {}).value || "";
        m.close();
        if (v.trim()) { await api().projekt_umbenennen(b.dataset.ren, v.trim()); renderProjekte(); }
      };
      const ab = document.getElementById("pmgr-ren-ab");
      if (ab) ab.onclick = () => m.close();
    });
    box.querySelectorAll("[data-dup]").forEach(b => b.onclick = async () => {
      await api().projekt_duplizieren(b.dataset.dup);
      renderProjekte();
    });
    box.querySelectorAll("[data-del]").forEach(b => b.onclick = () => {
      const p = _projekte.find(x => x.id === b.dataset.del);
      const m = openModal({
        title: "🗑 " + T("library.proj_delete", "Projekt löschen"),
        body: `<p>${T("library.proj_delete_frage", "Dieses Projekt löschen? Die Touren im Archiv bleiben unberührt — nur der Arbeitsstand (Keyframes, Einstellungen) geht verloren.")}</p>
               <div class="lib-hint">${esc((p || {}).name || "")}</div>`,
        footer: `<button class="btn" id="pmgr-del-ab">${T("common.cancel", "Abbrechen")}</button>
                 <button class="btn lib-btn-danger" id="pmgr-del-ok">${T("library.proj_delete", "Projekt löschen")}</button>`,
      });
      const ok = document.getElementById("pmgr-del-ok");
      if (ok) ok.onclick = async () => {
        m.close();
        await api().projekt_loeschen(b.dataset.del);
        renderProjekte();
        toast(T("library.proj_geloescht", "Projekt gelöscht."), "info");
      };
      const ab = document.getElementById("pmgr-del-ab");
      if (ab) ab.onclick = () => m.close();
    });
  }

  /** Öffnen (Q22): Solo lädt die Tour und springt ins zuletzt benutzte Modul;
   *  Kompositionen gehen den bewährten Übergabe-Weg (Pending + Lade-Modal). */
  async function projektOeffnen(pid, modulWunsch) {
    const info = await api().projekt_aktivieren(pid);
    if (!info || !info.ok) { toast((info && info.error) || "?", "error"); return; }
    const k = _projekte.find(x => x.id === pid) || {};
    const modul = modulWunsch || info.letztes_modul || "animator";
    if (info.ablauf === "reise" || info.ablauf === "schwarm") {
      const pfade = info.gpx_paths || [];
      if (pfade.length < 2 || k.pfade_ok === false) {
        toast(T("library.proj_pfade_fehlen", "Nicht alle Tour-Dateien der Komposition wurden gefunden."), "warn", 6000);
        return;
      }
      window.__rzPendingTours = pfade.slice(1);
      window.__rzPendingAblauf = info.ablauf;
      window.__rzPendingModus = info.schwarm_modus || "gleich";
      window.__rzPendingPausen = info.schwarm_pausen !== false;
      window.projektManagerZu();
      if (pfade.length >= 3 && typeof tourenLadeModalZeigen === "function") tourenLadeModalZeigen();
      const ok = await window.loadGlobalGpx(pfade[0], { stumm: true, menge: true });
      if (ok === false) {
        window.__rzPendingTours = null;
        if (typeof tourenLadeModalZu === "function") tourenLadeModalZu();
        return;
      }
      if (typeof switchMod === "function") switchMod("animator");
      return;
    }
    if (!k.haupt_pfad) {
      toast(T("library.proj_pfade_fehlen", "Nicht alle Tour-Dateien der Komposition wurden gefunden."), "warn", 6000);
      return;
    }
    window.projektManagerZu();
    const ok = await window.loadGlobalGpx(k.haupt_pfad, { stumm: true });
    if (ok === false) return;
    if (typeof switchMod === "function") switchMod(modul);
  }
})();
