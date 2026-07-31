/* Tour-Archiv (v0.9.486) — der durchsuchbare Katalog aller Touren.
 *
 * Idee: Das Archiv ist die bessere Variante des Datei-Dialogs. Ein Klick auf
 * eine Tour macht exakt das, was sonst nach „Datei wählen" passiert — er ruft
 * `loadGlobalGpx(pfad)`. Deshalb braucht kein anderes Modul etwas davon zu
 * wissen; sie bekommen den Track über denselben Weg wie bisher.
 *
 * Backend: `core/library.py` (SQLite-Index) über die `library_*`-Bridges.
 * Die Vorschaubilder kommen als data-URL mit der Trefferliste mit — sie sind
 * winzig (~2,5 KB), ein Nachladen pro Kachel wäre mehr Aufwand als Nutzen.
 */
(window.RZGPS_MODULES = window.RZGPS_MODULES || {}).library = {
  manifest: {
    slug: "library",
    name: "Archiv",
    description: "Alle Touren",
    icon: "📚",
    sort_order: 5,
  },
  mount: function (body, headerActions) { return mountLibrary(body, headerActions); },
};

function mountLibrary(body, headerActions) {
  const T = (typeof t === "function") ? t : (k, d) => d || k;
  let _items = [];
  let _total = 0;
  let _sel = null;          // aktuell ausgewählte Tour (Objekt)
  let _stats = null;
  let _folders = [];
  let _scanTimer = null;
  let _unmounted = false;

  const PAGE = 120;
  const state = {
    search: "", year: 0, activity: "", fav_only: false, planned: null,
    sort: "date_desc", offset: 0,
  };

  const ACT_LABELS = {
    wandern: T("library.act.wandern", "Wandern"),
    spaziergang: T("library.act.spaziergang", "Spaziergang"),
    laufen: T("library.act.laufen", "Laufen"),
    rad: T("library.act.rad", "Rad"),
    mtb: T("library.act.mtb", "Mountainbike"),
    rennrad: T("library.act.rennrad", "Rennrad"),
    motorrad: T("library.act.motorrad", "Motorrad"),
    auto: T("library.act.auto", "Auto"),
    boot: T("library.act.boot", "Boot"),
    ski: T("library.act.ski", "Ski"),
  };

  // Das Archiv braucht drei Spalten (Filter · Raster · Detail); die
  // Standard-Aufteilung des Modul-Bereichs kennt nur zwei. Die Klasse
  // schaltet in module.css auf drei um und wird beim Verlassen entfernt.
  body.classList.add("lib-mode");

  body.innerHTML = `
    <aside class="panel lib-side" id="lib-panel">
      <div class="section">
        <input type="search" id="lib-search" class="lib-search"
               placeholder="${T("library.search_ph", "Suchen — Name, Ort, Schlagwort …")}">
      </div>

      <div class="section">
        <label class="field-label" for="lib-year">${T("library.year", "Jahr")}</label>
        <select id="lib-year" class="lib-select"></select>

        <label class="field-label" for="lib-act" style="margin-top:10px;">${T("library.activity", "Fortbewegung")}</label>
        <select id="lib-act" class="lib-select"></select>

        <label class="field-label" for="lib-sort" style="margin-top:10px;">${T("library.sort", "Sortierung")}</label>
        <select id="lib-sort" class="lib-select">
          <option value="date_desc">${T("library.sort.date_desc", "Neueste zuerst")}</option>
          <option value="date_asc">${T("library.sort.date_asc", "Älteste zuerst")}</option>
          <option value="dist_desc">${T("library.sort.dist_desc", "Längste zuerst")}</option>
          <option value="dist_asc">${T("library.sort.dist_asc", "Kürzeste zuerst")}</option>
          <option value="asc_desc">${T("library.sort.asc_desc", "Meiste Höhenmeter")}</option>
          <option value="dur_desc">${T("library.sort.dur_desc", "Längste Dauer")}</option>
          <option value="name_asc">${T("library.sort.name_asc", "Name A–Z")}</option>
        </select>

        <label class="check-row" style="margin-top:12px;">
          <input type="checkbox" id="lib-fav"><span>${T("library.fav_only", "Nur Favoriten")}</span>
        </label>
        <label class="check-row">
          <input type="checkbox" id="lib-recorded"><span>${T("library.recorded_only", "Nur aufgezeichnete (keine geplanten)")}</span>
        </label>
        <button class="btn btn-ghost btn-sm" id="lib-reset" style="margin-top:10px; width:100%;">
          ${T("library.reset", "Filter zurücksetzen")}
        </button>
      </div>

      <div class="section">
        <div class="field-label">${T("library.folders", "Beobachtete Ordner")}</div>
        <div id="lib-folders" class="lib-folders"></div>
        <button class="btn btn-sm" id="lib-add-folder" style="width:100%; margin-top:8px;">
          ${T("library.add_folder", "+ Ordner hinzufügen")}
        </button>
        <button class="btn btn-ghost btn-sm" id="lib-scan" style="width:100%; margin-top:6px;">
          ${T("library.scan", "Neu einlesen")}
        </button>
        <div id="lib-scan-info" class="lib-scan-info"></div>
      </div>

      <div class="section" id="lib-stats-box"></div>
    </aside>

    <section class="lib-main">
      <div class="lib-head" id="lib-head"></div>
      <div class="lib-grid" id="lib-grid"></div>
    </section>

    <aside class="panel lib-detail" id="lib-detail"></aside>
  `;

  const $ = (id) => document.getElementById(id);
  const grid = $("lib-grid");

  // ── Hilfen ────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function fmtDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d)) return String(iso).slice(0, 10);
    // Bewusst die eingestellte App-Sprache, nicht die Browser-Voreinstellung:
    // sonst steht in der deutschen Oberfläche plötzlich 07/24/2026.
    let loc;
    try { loc = (typeof i18nMeta === "function") ? i18nMeta().active : null; } catch (_) { loc = null; }
    return d.toLocaleDateString(loc || undefined,
      { year: "numeric", month: "2-digit", day: "2-digit" });
  }
  function fmtKmVal(m) {
    return (typeof fmtKm === "function") ? fmtKm(m) : ((m / 1000).toFixed(1) + " km");
  }
  function fmtDurVal(s) {
    return (typeof fmtDur === "function") ? fmtDur(s) : Math.round(s / 60) + " min";
  }

  // ── Laden ─────────────────────────────────────────────────────────────
  async function reload() {
    const params = Object.assign({}, state, { limit: PAGE, with_thumbs: true });
    if (!params.year) delete params.year;
    if (params.planned === null) delete params.planned;
    if (!params.activity) delete params.activity;
    const res = await api().library_query(params);
    if (_unmounted) return;
    if (!res.ok) { toast(res.error || "Archiv-Abfrage fehlgeschlagen", "error"); return; }
    _items = res.items || [];
    _total = res.total || 0;
    renderHead();
    renderGrid();
  }

  async function reloadStats() {
    _stats = await api().library_stats();
    if (_unmounted) return;
    renderStats();
    fillYearOptions();
    fillActivityOptions();
  }

  async function reloadFolders() {
    const res = await api().library_folders();
    if (_unmounted) return;
    _folders = (res && res.folders) || [];
    renderFolders();
  }

  // ── Darstellung ───────────────────────────────────────────────────────
  function renderHead() {
    const shown = Math.min(_items.length, _total);
    const filtered = _stats && _total < (_stats.n_tracks || 0);
    $("lib-head").innerHTML = `
      <span class="lib-head-count">${_total} ${T("library.tours", "Touren")}</span>
      ${filtered ? `<span class="lib-head-sub">${T("library.of_total", "von")} ${_stats.n_tracks}</span>` : ""}
      ${shown < _total ? `<span class="lib-head-sub">· ${T("library.showing", "angezeigt")}: ${shown}</span>` : ""}
    `;
  }

  function renderStats() {
    const s = _stats || {};
    if (!s.n_tracks) { $("lib-stats-box").innerHTML = ""; return; }
    $("lib-stats-box").innerHTML = `
      <div class="field-label">${T("library.summary", "Gesamt")}</div>
      <div class="lib-sum">
        <div><b>${s.n_tracks}</b><span>${T("library.tours", "Touren")}</span></div>
        <div><b>${Math.round(s.total_km).toLocaleString()}</b><span>km</span></div>
        <div><b>${Math.round(s.total_ascent_m).toLocaleString()}</b><span>${T("library.ascent", "Höhenmeter")}</span></div>
        <div><b>${Math.round(s.total_hours).toLocaleString()}</b><span>${T("library.hours", "Stunden")}</span></div>
      </div>
      ${s.n_failed ? `<button class="lib-warn lib-warn-btn" id="lib-show-errors">${s.n_failed} ${T("library.unreadable", "Datei(en) nicht lesbar")}</button>` : ""}
    `;
    const eb = $("lib-show-errors");
    if (eb) eb.onclick = showErrors;
  }

  /** Unlesbare Dateien beim Namen nennen — sonst weiß niemand, welche fehlt. */
  async function showErrors() {
    const res = await api().library_errors();
    const items = (res && res.items) || [];
    openModal({
      title: T("library.unreadable", "Datei(en) nicht lesbar"),
      body: `<div class="lib-dupes">${items.length
        ? items.map(i => `<div class="lib-dupe-group">
             <div class="lib-dupe-item">${esc(i.filename)}</div>
             <div class="lib-dupe-head">${esc(i.error || "")}</div>
           </div>`).join("")
        : `<p>${T("library.no_errors", "Alle Dateien konnten gelesen werden.")}</p>`}</div>`,
    });
  }

  function fillYearOptions() {
    const sel = $("lib-year");
    const years = (_stats && _stats.years) || [];
    sel.innerHTML = `<option value="0">${T("library.all_years", "Alle Jahre")}</option>` +
      years.slice().reverse().map(y =>
        `<option value="${y.year}"${state.year === y.year ? " selected" : ""}>${y.year} (${y.n})</option>`).join("");
  }

  function fillActivityOptions() {
    const sel = $("lib-act");
    const acts = ((_stats && _stats.activities) || []).filter(a => a.activity);
    sel.innerHTML = `<option value="">${T("library.all_activities", "Alle Arten")}</option>` +
      acts.map(a =>
        `<option value="${esc(a.activity)}"${state.activity === a.activity ? " selected" : ""}>${esc(ACT_LABELS[a.activity] || a.activity)} (${a.n})</option>`).join("");
  }

  function renderFolders() {
    const box = $("lib-folders");
    if (!_folders.length) {
      box.innerHTML = `<div class="lib-empty-hint">${T("library.no_folders", "Noch kein Ordner. Füge den Ordner hinzu, in dem deine GPX-Dateien liegen.")}</div>`;
      return;
    }
    box.innerHTML = _folders.map(f => `
      <div class="lib-folder${f.exists ? "" : " is-missing"}" title="${esc(f.path)}">
        <span class="lib-folder-name">${esc(f.path.split("/").pop() || f.path)}</span>
        <span class="lib-folder-n">${f.n_tracks}</span>
        <button class="lib-folder-x" data-folder="${esc(f.path)}"
                title="${esc(T("library.remove_folder", "Ordner nicht mehr beobachten"))}">✕</button>
      </div>
    `).join("");
    box.querySelectorAll("[data-folder]").forEach(btn => {
      btn.onclick = async () => {
        await api().library_remove_folder(btn.dataset.folder, true);
        await reloadFolders(); await reloadStats(); await reload();
      };
    });
  }

  function renderGrid() {
    if (!_items.length) {
      grid.innerHTML = `
        <div class="lib-empty">
          <div class="lib-empty-title">${_folders.length
            ? T("library.empty_filter", "Keine Tour passt zu diesen Filtern.")
            : T("library.empty_start", "Das Archiv ist noch leer.")}</div>
          <div class="lib-empty-text">${_folders.length
            ? T("library.empty_filter_hint", "Filter zurücksetzen oder neu einlesen.")
            : T("library.empty_start_hint", "Füge links den Ordner hinzu, in dem deine Tracks liegen — die App liest ihn dann ein.")}</div>
        </div>`;
      return;
    }
    grid.innerHTML = _items.map((it, i) => `
      <button class="lib-card${_sel && _sel.path === it.path ? " is-sel" : ""}" data-i="${i}" type="button">
        <span class="lib-card-thumb">
          ${it.thumb_url ? `<img src="${it.thumb_url}" alt="" loading="lazy">` : `<span class="lib-card-nothumb">?</span>`}
          ${it.fav ? `<span class="lib-badge lib-badge-fav">★</span>` : ""}
          ${it.planned ? `<span class="lib-badge lib-badge-plan">${T("library.planned", "geplant")}</span>` : ""}
          ${it.has_session ? `<span class="lib-badge lib-badge-proj" title="${esc(T("library.has_project", "Für diese Tour gibt es gespeicherte Projekte"))}">●</span>` : ""}
        </span>
        <span class="lib-card-name">${esc(it.name || it.filename)}</span>
        <span class="lib-card-meta">
          <span>${fmtDate(it.started_at)}</span>
          <span>${fmtKmVal(it.distance_m || 0)}</span>
          <span>↑ ${Math.round(it.ascent_m || 0)} m</span>
        </span>
      </button>
    `).join("");
    grid.querySelectorAll("[data-i]").forEach(btn => {
      btn.onclick = () => select(_items[parseInt(btn.dataset.i, 10)]);
      btn.ondblclick = () => openIn("animator");
    });
  }

  function select(it) {
    _sel = it;
    renderGrid();
    renderDetail();
  }

  function renderDetail() {
    const box = $("lib-detail");
    if (!_sel) {
      box.innerHTML = `<div class="lib-detail-empty">${T("library.pick_hint", "Tour auswählen — dann kannst du sie hier direkt in ein Werkzeug übernehmen.")}</div>`;
      return;
    }
    const it = _sel;
    const rows = [
      [T("library.date", "Datum"), fmtDate(it.started_at)],
      [T("library.distance", "Strecke"), fmtKmVal(it.distance_m || 0)],
      [T("library.duration", "Dauer"), it.duration_s ? fmtDurVal(it.duration_s) : "—"],
      [T("library.ascent", "Höhenmeter"), `↑ ${Math.round(it.ascent_m || 0)} m · ↓ ${Math.round(it.descent_m || 0)} m`],
      [T("library.speed", "Schnitt"), it.avg_speed_kmh ? it.avg_speed_kmh.toFixed(1) + " km/h" : "—"],
      [T("library.points", "Punkte"), `${it.n_points || 0}${it.n_segments > 1 ? ` · ${it.n_segments} ${T("library.segments", "Etappen")}` : ""}`],
      [T("library.activity", "Fortbewegung"), ACT_LABELS[it.activity] || (it.activity || "—")],
      [T("library.file", "Datei"), it.filename],
    ];
    box.innerHTML = `
      <div class="lib-detail-thumb">
        ${it.thumb_url ? `<img src="${it.thumb_url}" alt="">` : ""}
      </div>
      <div class="lib-detail-title">${esc(it.name || it.filename)}</div>
      ${it.error ? `<div class="lib-warn">${T("library.file_error", "Diese Datei konnte nicht gelesen werden")}: ${esc(it.error)}</div>` : ""}
      ${!it.exists ? `<div class="lib-warn">${T("library.file_gone", "Die Datei liegt nicht mehr an diesem Ort.")}</div>` : ""}

      <div class="lib-actions">
        <button class="btn btn-primary btn-sm" data-open="animator">${T("library.open_animator", "Im Animator öffnen")}</button>
        <button class="btn btn-sm" data-open="tourmap">${T("library.open_tourmap", "Tour-Karte")}</button>
        <button class="btn btn-sm" data-open="heightanim">${T("library.open_height", "Daten-Animator")}</button>
        <button class="btn btn-sm" data-open="geotagger">${T("library.open_geotagger", "Fotos verorten")}</button>
        <button class="btn btn-sm" data-open="gpxinspect">${T("library.open_inspect", "Inspektor")}</button>
      </div>

      <div class="lib-detail-rows">
        ${rows.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}
      </div>

      <label class="check-row" style="margin-top:12px;">
        <input type="checkbox" id="lib-d-fav"${it.fav ? " checked" : ""}>
        <span>${T("library.favorite", "Favorit")}</span>
      </label>

      <label class="field-label" for="lib-d-tags" style="margin-top:8px;">${T("library.tags", "Schlagwörter")}</label>
      <input type="text" id="lib-d-tags" class="lib-input" value="${esc((it.tag_list || []).join(", "))}"
             placeholder="${T("library.tags_ph", "z. B. Mallorca, Testfahrt")}">

      <label class="field-label" for="lib-d-note" style="margin-top:8px;">${T("library.note", "Notiz")}</label>
      <textarea id="lib-d-note" class="lib-input" rows="3">${esc(it.note || "")}</textarea>

      <div class="lib-actions" style="margin-top:10px;">
        <button class="btn btn-ghost btn-sm" id="lib-d-reveal">${T("library.reveal", "Im Finder zeigen")}</button>
        ${it.source_url ? `<button class="btn btn-ghost btn-sm" id="lib-d-src">${T("library.open_source", "Bei Komoot ansehen")}</button>` : ""}
        <button class="btn btn-ghost btn-sm" id="lib-d-forget">${T("library.forget", "Aus Archiv nehmen")}</button>
      </div>
    `;

    box.querySelectorAll("[data-open]").forEach(b => { b.onclick = () => openIn(b.dataset.open); });
    $("lib-d-fav").onchange = async (e) => {
      await api().library_set_fields(it.path, e.target.checked, null, null);
      it.fav = e.target.checked ? 1 : 0;
      renderGrid();
    };
    const saveTags = debounce(async () => {
      const tags = $("lib-d-tags").value.split(",").map(s => s.trim()).filter(Boolean);
      await api().library_set_fields(it.path, null, tags, null);
      it.tag_list = tags;
    }, 500);
    $("lib-d-tags").oninput = saveTags;
    const saveNote = debounce(async () => {
      await api().library_set_fields(it.path, null, null, $("lib-d-note").value);
      it.note = $("lib-d-note").value;
    }, 500);
    $("lib-d-note").oninput = saveNote;
    $("lib-d-reveal").onclick = () => api().library_reveal(it.path);
    const srcBtn = $("lib-d-src");
    if (srcBtn) srcBtn.onclick = () => api().open_url(it.source_url);
    $("lib-d-forget").onclick = async () => {
      await api().library_forget(it.path);
      _sel = null;
      await reload(); await reloadStats(); renderDetail();
    };
  }

  /** Tour in ein Werkzeug übernehmen: derselbe Weg wie „Datei wählen". */
  async function openIn(slug) {
    if (!_sel) return;
    if (!_sel.exists) { toast(T("library.file_gone", "Die Datei liegt nicht mehr an diesem Ort."), "error"); return; }
    const ok = await window.loadGlobalGpx(_sel.path);
    if (ok !== false && typeof switchMod === "function") switchMod(slug);
  }

  // ── Einlesen ──────────────────────────────────────────────────────────
  async function startScan(force) {
    const res = await api().library_scan_start(!!force);
    if (!res.ok) { toast(res.error || "Einlesen läuft bereits", "warn"); return; }
    $("lib-scan").disabled = true;
    pollScan();
  }

  function pollScan() {
    clearTimeout(_scanTimer);
    _scanTimer = setTimeout(async () => {
      if (_unmounted) return;
      const st = await api().library_scan_status();
      const info = $("lib-scan-info");
      if (!info) return;
      if (st.running) {
        const pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
        info.innerHTML = `<div class="lib-progress"><i style="width:${pct}%"></i></div>
          <div class="lib-progress-txt">${st.done || 0} / ${st.total || "?"} · ${esc(st.current || "")}</div>`;
        pollScan();
      } else {
        const btn = $("lib-scan");
        if (btn) btn.disabled = false;
        const r = st.result || st;
        if (st.error) {
          info.innerHTML = `<div class="lib-warn">${esc(st.error)}</div>`;
        } else if (r && (r.added != null)) {
          info.innerHTML = `<div class="lib-scan-done">${T("library.scan_done", "Fertig")}: ` +
            `${r.added} ${T("library.new", "neu")} · ${r.updated} ${T("library.updated", "aktualisiert")}` +
            `${r.failed ? ` · ${r.failed} ${T("library.failed", "fehlerhaft")}` : ""}</div>`;
        } else {
          info.innerHTML = "";
        }
        await reloadStats(); await reloadFolders(); await reload();
      }
    }, 400);
  }

  // ── Ereignisse ────────────────────────────────────────────────────────
  $("lib-search").oninput = debounce(() => { state.search = $("lib-search").value; reload(); }, 250);
  $("lib-year").onchange = () => { state.year = parseInt($("lib-year").value, 10) || 0; reload(); };
  $("lib-act").onchange = () => { state.activity = $("lib-act").value; reload(); };
  $("lib-sort").onchange = () => { state.sort = $("lib-sort").value; reload(); };
  $("lib-fav").onchange = (e) => { state.fav_only = e.target.checked; reload(); };
  $("lib-recorded").onchange = (e) => { state.planned = e.target.checked ? false : null; reload(); };
  $("lib-reset").onclick = () => {
    state.search = ""; state.year = 0; state.activity = ""; state.fav_only = false; state.planned = null;
    $("lib-search").value = ""; $("lib-fav").checked = false; $("lib-recorded").checked = false;
    fillYearOptions(); fillActivityOptions();
    reload();
  };
  $("lib-add-folder").onclick = async () => {
    const res = await api().library_add_folder("");
    if (res.cancelled) return;
    if (!res.ok) { toast(res.error || "Ordner konnte nicht hinzugefügt werden", "error"); return; }
    await reloadFolders();
    startScan(false);       // frisch hinzugefügter Ordner wird gleich eingelesen
  };
  $("lib-scan").onclick = () => startScan(false);

  // Kopf-Aktion: Doppelte finden
  if (headerActions) {
    headerActions.innerHTML = `<button class="btn btn-ghost btn-sm" id="lib-dupes">${T("library.duplicates", "Doppelte finden")}</button>`;
    const db = document.getElementById("lib-dupes");
    if (db) db.onclick = showDuplicates;
  }

  async function showDuplicates() {
    const res = await api().library_duplicates();
    const groups = (res && res.groups) || [];
    const html = groups.length
      ? groups.map(g => `
          <div class="lib-dupe-group">
            <div class="lib-dupe-head">${g.n} ${T("library.same_route", "Dateien mit identischem Verlauf")}</div>
            ${g.items.map(i => `<div class="lib-dupe-item">${esc(i.filename)}</div>`).join("")}
          </div>`).join("")
      : `<p>${T("library.no_duplicates", "Keine doppelten Touren gefunden.")}</p>`;
    openModal({
      title: T("library.duplicates", "Doppelte finden"),
      body: `<div class="lib-dupes">${html}</div>`,
      width: 560,
    });
  }

  // ── Start ─────────────────────────────────────────────────────────────
  (async () => {
    await reloadFolders();
    await reloadStats();
    await reload();
    renderDetail();
  })();

  return function cleanup() {
    _unmounted = true;
    clearTimeout(_scanTimer);
    body.classList.remove("lib-mode");
  };
}
