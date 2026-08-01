/* Tour-Archiv (v0.9.491) — der durchsuchbare Katalog aller Touren.
 *
 * Idee: Das Archiv ist die bessere Variante des Datei-Dialogs. Ein Klick auf
 * eine Tour macht exakt das, was sonst nach „Datei wählen" passiert — er ruft
 * `loadGlobalGpx(pfad)`. Deshalb braucht kein anderes Modul etwas davon zu
 * wissen; sie bekommen den Track über denselben Weg wie bisher.
 *
 * Aufbau (v0.9.491, nach Marcs „gemacht und geplant durcheinander"):
 *
 *   [ Seitenleiste ]        [ Inhalt ]                 [ Detail ]
 *   Alle · Gemachte ·       Filterleiste               Umbenennen,
 *   Geplante · Favoriten    Kacheln/Liste/Karte/       Sammlungen,
 *   Ausgeblendete           Statistik                  gemacht/geplant,
 *   Sammlungen                                         ausblenden, Papierkorb
 *   „Ordner & Einlesen"
 *
 * Die Seitenleiste ist der Kern der Neuordnung: Gemachte und geplante Touren
 * liegen nicht mehr vermischt in einer Liste, sondern sind eine bewusste
 * Auswahl — und der Einstieg „wo lade ich meinen Ordner?" steht sichtbar unten
 * statt versteckt in einem Menü.
 *
 * Backend: `core/library.py` (SQLite-Index) über die `library_*`-Bridges.
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

  // Farben der Übersichtskarte. Magenta statt Orange, weil die Karte selbst
  // orange Straßen und beige Flächen hat — darauf verschwand der Track.
  const TRACK_COLOR = "#e5007d";
  const FAV_COLOR = "#ffb300";
  const SEL_COLOR = "#ff6b35";

  const PAGE = 200;

  let _items = [], _total = 0, _sel = null, _stats = null, _base = null, _folders = [], _collections = [];
  // Hintergrundlauf „Kartenbilder holen": läuft ohne Zutun, die Kacheln sollen
  // die eintröpfelnden Bilder von selbst zeigen.
  let _autoThumbs = null, _autoWatch = null, _autoTick = 0;
  let _scanTimer = null, _mapsTimer = null, _unmounted = false;
  let _map = null, _mapReady = false, _mapPopup = null, _mapLib = null;

  const store = {
    get(k, d) { try { return localStorage.getItem("rz.library." + k) || d; } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem("rz.library." + k, v); } catch (_) {} },
  };

  // „Bereich" ist die grobe Trennung links; die Filterleiste verfeinert nur noch.
  let scope = store.get("scope", "all");
  let view = store.get("view", "cards");
  const state = { search: "", year: 0, activity: "", sort: "date_desc", collection_id: 0 };

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
  const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

  body.classList.add("lib-mode");

  body.innerHTML = `
    <aside class="panel lib-nav" id="lib-panel">
      <div class="lib-nav-title">${T("library.section_library", "Bibliothek")}</div>
      <nav class="lib-scopes" id="lib-scopes"></nav>

      <div class="lib-nav-title" style="margin-top:14px;">${T("library.collections", "Sammlungen")}</div>
      <nav class="lib-cols" id="lib-cols"></nav>
      <button class="lib-nav-add" id="lib-col-new" type="button">+ ${T("library.col_new", "Neue Sammlung")}</button>

      <div class="lib-nav-foot">
        <button class="btn btn-primary btn-sm" id="lib-folders-btn" type="button">📂 ${T("library.folders_btn", "Ordner & Einlesen")}</button>
        <button class="btn btn-ghost btn-sm" id="lib-dupes" type="button">${T("library.duplicates", "Doppelte finden")}</button>
        <div class="lib-nav-hint" id="lib-nav-hint"></div>
      </div>
    </aside>

    <section class="lib-main">
      <div class="lib-bar">
        <input type="search" id="lib-search" class="lib-search"
               placeholder="${T("library.search_ph", "Suchen — Name, Ort, Schlagwort …")}">
        <select id="lib-year" class="lib-select"></select>
        <select id="lib-act" class="lib-select"></select>
        <select id="lib-sort" class="lib-select">
          <option value="date_desc">${T("library.sort.date_desc", "Neueste zuerst")}</option>
          <option value="date_asc">${T("library.sort.date_asc", "Älteste zuerst")}</option>
          <option value="dist_desc">${T("library.sort.dist_desc", "Längste zuerst")}</option>
          <option value="dist_asc">${T("library.sort.dist_asc", "Kürzeste zuerst")}</option>
          <option value="asc_desc">${T("library.sort.asc_desc", "Meiste Höhenmeter")}</option>
          <option value="dur_desc">${T("library.sort.dur_desc", "Längste Dauer")}</option>
          <option value="name_asc">${T("library.sort.name_asc", "Name A–Z")}</option>
          <option value="act_asc">${T("library.sort.act_asc", "Nach Fortbewegung")}</option>
        </select>
        <button class="lib-chip lib-chip-ghost" id="lib-reset" type="button">${T("library.reset", "Zurücksetzen")}</button>
        <span class="lib-bar-spacer"></span>
        <div class="lib-views" role="group">
          <button class="lib-view" data-view="cards" type="button" title="${T("library.view_cards", "Kacheln")}">▦</button>
          <button class="lib-view" data-view="list" type="button" title="${T("library.view_list", "Liste")}">☰</button>
          <button class="lib-view" data-view="map" type="button" title="${T("library.view_map", "Karte")}">🌍</button>
          <button class="lib-view" data-view="stats" type="button" title="${T("library.view_stats", "Statistik")}">📊</button>
        </div>
      </div>

      <div class="lib-head" id="lib-head"></div>

      <div class="lib-body">
        <div class="lib-grid" id="lib-grid"></div>
        <div class="lib-list" id="lib-list" hidden></div>
        <div class="lib-mapwrap" id="lib-mapwrap" hidden>
          <div class="lib-map" id="lib-map"></div>
          <div class="lib-map-hint" id="lib-map-hint"></div>
        </div>
        <div class="lib-stats" id="lib-stats" hidden></div>
      </div>
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
    return d.toLocaleDateString(loc || undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
  }
  const fmtKmVal = (m) => (typeof fmtKm === "function") ? fmtKm(m) : ((m / 1000).toFixed(1) + " km");
  const fmtDurVal = (s) => (typeof fmtDur === "function") ? fmtDur(s) : Math.round(s / 60) + " min";
  const num = (n) => Math.round(n || 0).toLocaleString();

  /** Der Bereich links entscheidet, WELCHE Touren überhaupt gemeint sind. */
  function scopeFilters() {
    const f = {};
    if (scope === "done") f.planned = false;
    else if (scope === "planned") f.planned = true;
    else if (scope === "fav") f.fav_only = true;
    else if (scope === "hidden") f.hidden_only = true;
    else if (scope === "missing") f.missing_only = true;
    return f;
  }

  function queryParams(extra) {
    const p = Object.assign({}, state, scopeFilters(), extra || {});
    if (!p.year) delete p.year;
    if (!p.activity) delete p.activity;
    if (!p.collection_id) delete p.collection_id;
    if (!p.search) delete p.search;
    return p;
  }

  /** Filter der Leiste OHNE Bereich und Sammlung — die Bestandszahlen neben
   *  den Bereichen dürfen sich nicht selbst wegfiltern („Geplante 0", während
   *  man im Bereich „Gemachte" steht). */
  function baseParams() {
    const p = Object.assign({}, state);
    delete p.collection_id;
    if (!p.year) delete p.year;
    if (!p.activity) delete p.activity;
    if (!p.search) delete p.search;
    return p;
  }

  // ── Laden ─────────────────────────────────────────────────────────────
  async function reload() {
    const res = await api().library_query(queryParams({
      limit: (view === "map" || view === "stats") ? 0 : PAGE,
      with_thumbs: view === "cards" || view === "list",
      with_geom: view === "map",
    }));
    if (_unmounted) return;
    if (!res.ok) { toast(res.error || "Archiv-Abfrage fehlgeschlagen", "error"); return; }
    _items = res.items || [];
    _total = res.total || 0;
    // Wer den Bereich wechselt, soll rechts nicht die Tour von vorhin sehen —
    // die steht dann in keiner Liste mehr und wirkt wie ein Geist.
    if (_sel && !_items.some(i => i.path === _sel.path)) _sel = null;
    await reloadStats();
    renderHead();
    renderView();
    renderDetail();
  }

  async function reloadStats() {
    const [s, base] = await Promise.all([
      api().library_stats(queryParams()),
      api().library_stats(baseParams()),
    ]);
    if (_unmounted) return;
    _stats = s;
    _base = base || s;
    fillYearOptions();
    fillActivityOptions();
    renderScopes();
  }

  async function reloadCollections() {
    const res = await api().library_collections();
    if (_unmounted) return;
    _collections = (res && res.collections) || [];
    renderCollections();
  }

  async function reloadFolders() {
    const res = await api().library_folders();
    if (_unmounted) return;
    _folders = (res && res.folders) || [];
    const hint = $("lib-nav-hint");
    if (hint) {
      hint.innerHTML = _folders.length
        ? _folders.map(f => `<div title="${esc(f.path)}">${esc(f.path.split("/").pop())} · ${f.n_tracks}</div>`).join("")
        : `<div class="lib-nav-warn">${T("library.no_folders_short", "Noch kein Ordner eingelesen")}</div>`;
    }
  }

  // ── Seitenleiste ──────────────────────────────────────────────────────
  function renderScopes() {
    const b = _base || _stats || {};
    const items = [
      ["all", "📚", T("library.scope_all", "Alle Touren")],
      ["done", "✅", T("library.scope_done", "Gemachte")],
      ["planned", "📝", T("library.scope_planned", "Geplante")],
      ["fav", "★", T("library.scope_fav", "Favoriten")],
    ];
    if ((b.n_hidden || 0) > 0) items.push(["hidden", "🚫", T("library.scope_hidden", "Ausgeblendete")]);
    // Nur zeigen, wenn es tatsächlich unerreichbare Touren gibt — sonst wäre es
    // ein Bereich, den niemand versteht, weil er immer leer ist.
    if ((b.n_missing || 0) > 0) items.push(["missing", "🔌", T("library.scope_missing", "Nicht erreichbar")]);
    // Die Zahlen sind Bestände, keine Trefferzahlen: sie kommen aus der
    // Statistik OHNE Bereichs-Filter und ändern sich deshalb nur, wenn oben
    // ein Jahr, eine Art oder eine Suche eingegrenzt wird.
    const count = (k) => {
      if (k === "all") return b.n_tracks != null ? b.n_tracks : "";
      if (k === "done") return b.done ? b.done.n : "";
      if (k === "planned") return b.planned ? b.planned.n : "";
      if (k === "fav") return b.n_fav || "";
      if (k === "hidden") return b.n_hidden || "";
      if (k === "missing") return b.n_missing || "";
      return "";
    };
    $("lib-scopes").innerHTML = items.map(([k, ico, label]) => `
      <button class="lib-nav-item${scope === k ? " is-on" : ""}" data-scope="${k}" type="button">
        <span class="lib-nav-ico">${ico}</span><span class="lib-nav-lbl">${esc(label)}</span>
        <span class="lib-nav-n">${count(k)}</span>
      </button>`).join("");
    $("lib-scopes").querySelectorAll("[data-scope]").forEach(b => {
      b.onclick = () => {
        scope = b.dataset.scope; store.set("scope", scope);
        state.collection_id = 0;
        renderCollections(); reload();
      };
    });
  }

  function renderCollections() {
    const box = $("lib-cols");
    box.innerHTML = _collections.length
      ? _collections.map(c => `
          <button class="lib-nav-item${state.collection_id === c.id ? " is-on" : ""}" data-col="${c.id}" type="button"
                  title="${esc(T("library.col_menu_hint", "Klick zeigt nur diese Sammlung · Rechtsklick öffnet die Verwaltung"))}">
            <span class="lib-nav-ico">📁</span>
            <span class="lib-nav-lbl">${esc(c.name)}</span>
            <span class="lib-nav-n">${c.n}</span>
          </button>`).join("")
      : `<div class="lib-nav-empty">${T("library.col_none", "Noch keine Sammlung angelegt.")}</div>`;
    box.querySelectorAll("[data-col]").forEach(b => {
      const id = parseInt(b.dataset.col, 10);
      b.onclick = () => {
        // Zweiter Klick auf dieselbe Sammlung hebt die Auswahl wieder auf.
        state.collection_id = state.collection_id === id ? 0 : id;
        state.sort = state.collection_id ? "collection" : "date_desc";
        renderCollections(); reload();
      };
      b.oncontextmenu = (e) => { e.preventDefault(); openCollectionMenu(id); };
    });
  }

  // ── Kopfzeile ─────────────────────────────────────────────────────────
  function scopeTitle() {
    const col = _collections.find(c => c.id === state.collection_id);
    if (col) return col.name;
    return scope === "done" ? T("library.scope_done", "Gemachte")
      : scope === "planned" ? T("library.scope_planned", "Geplante")
      : scope === "fav" ? T("library.scope_fav", "Favoriten")
      : scope === "hidden" ? T("library.scope_hidden", "Ausgeblendete")
      : scope === "missing" ? T("library.scope_missing", "Nicht erreichbar")
      : T("library.scope_all", "Alle Touren");
  }

  function renderHead() {
    const s = _stats || {};
    $("lib-head").innerHTML = `
      <span class="lib-head-count">${_total} ${T("library.tours", "Touren")}</span>
      <span class="lib-head-title">${esc(scopeTitle())}</span>
      ${s.total_km ? `<span class="lib-head-sub">${num(s.total_km)} km · ${num(s.total_ascent_m)} ${T("library.ascent", "Höhenmeter")} · ${num(s.total_hours)} ${T("library.hours", "Stunden")}</span>` : ""}
      ${(scope === "all" && s.planned && s.planned.n) ? `<span class="lib-head-mix">${s.done.n} ${T("library.done_short", "gemacht")} · ${s.planned.n} ${T("library.planned", "geplant")}</span>` : ""}
      ${_autoThumbs ? `<span class="lib-head-auto">🗺️ ${T("library.map_thumbs_auto", "Kartenbilder werden geladen")} ${_autoThumbs.done || 0}/${_autoThumbs.total || "?"}</span>` : ""}
      ${s.n_failed ? `<button class="lib-head-warn" id="lib-show-errors">${s.n_failed} ${T("library.unreadable", "Datei(en) nicht lesbar")}</button>` : ""}
    `;
    const eb = $("lib-show-errors");
    if (eb) eb.onclick = showErrors;
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
      acts.map(a => `<option value="${esc(a.activity)}"${state.activity === a.activity ? " selected" : ""}>${esc(ACT_LABELS[a.activity] || a.activity)} (${a.n})</option>`).join("");
  }

  // ── Ansichten ─────────────────────────────────────────────────────────
  function renderView() {
    document.querySelectorAll(".lib-view").forEach(b => b.classList.toggle("is-on", b.dataset.view === view));
    $("lib-grid").hidden = view !== "cards";
    $("lib-list").hidden = view !== "list";
    $("lib-mapwrap").hidden = view !== "map";
    $("lib-stats").hidden = view !== "stats";
    if (view === "cards") renderGrid();
    else if (view === "list") renderList();
    else if (view === "stats") renderStats();
    else {
      renderMap(); applyMapSelection();
      if (_sel && _sel.geom && _sel.geom.length && _mapReady) {
        const mid = _sel.geom[Math.floor(_sel.geom.length / 2)];
        showMapPopup(_sel, { lng: mid[0], lat: mid[1] });
      }
    }
  }

  function emptyHtml() {
    if (!_folders.length) {
      return `
        <div class="lib-empty">
          <div class="lib-empty-big">📂</div>
          <div class="lib-empty-title">${T("library.empty_start", "Das Archiv ist noch leer.")}</div>
          <div class="lib-empty-text">${T("library.empty_start_hint2", "Sag der App einmal, wo deine Track-Dateien liegen — sie liest den Ordner dann ein und zeigt hier jede Tour mit Bild und Zahlen.")}</div>
          <button class="btn btn-primary" id="lib-empty-add">📂 ${T("library.add_folder", "+ Ordner hinzufügen")}</button>
        </div>`;
    }
    return `
      <div class="lib-empty">
        <div class="lib-empty-title">${T("library.empty_filter", "Keine Tour passt zu dieser Auswahl.")}</div>
        <div class="lib-empty-text">${T("library.empty_filter_hint2", "Filter zurücksetzen oder links einen anderen Bereich wählen.")}</div>
      </div>`;
  }
  function bindEmpty() {
    const b = $("lib-empty-add");
    if (b) b.onclick = addFolder;
  }

  function badges(it) {
    return `
      ${it.fav ? `<span class="lib-badge lib-badge-fav">★</span>` : ""}
      ${it.recorded_eff ? "" : `<span class="lib-badge lib-badge-plan">${T("library.planned", "geplant")}</span>`}
      ${it.hidden ? `<span class="lib-badge lib-badge-hidden">${T("library.hidden_short", "aus")}</span>` : ""}
        ${it.missing_since ? `<span class="lib-badge lib-badge-missing" title="${esc(T("library.missing_hint", "Die Datei ist gerade nicht auffindbar — Platte nicht angeschlossen?"))}">🔌</span>` : ""}
      ${it.has_session ? `<span class="lib-badge lib-badge-proj" title="${esc(T("library.has_project", "Für diese Tour gibt es gespeicherte Projekte"))}">●</span>` : ""}`;
  }

  function renderGrid() {
    if (!_items.length) { grid.innerHTML = emptyHtml(); bindEmpty(); return; }
    grid.innerHTML = _items.map((it, i) => `
      <button class="lib-card${_sel && _sel.path === it.path ? " is-sel" : ""}" data-i="${i}" type="button">
        <span class="lib-card-thumb">
          ${it.thumb_url ? `<img src="${it.thumb_url}" alt="" loading="lazy">` : `<span class="lib-card-nothumb">?</span>`}
          ${badges(it)}
        </span>
        <span class="lib-card-name">${esc(it.name)}</span>
        <span class="lib-card-meta">
          <span>${fmtDate(it.started_at)}</span><span>${fmtKmVal(it.distance_m || 0)}</span><span>↑ ${num(it.ascent_m)} m</span>
        </span>
      </button>`).join("");
    bindItemClicks(grid);
  }

  function renderList() {
    const box = $("lib-list");
    if (!_items.length) { box.innerHTML = emptyHtml(); bindEmpty(); return; }
    box.innerHTML = `
      <div class="lib-row lib-row-head">
        <span></span><span>${T("library.name", "Name")}</span><span>${T("library.date", "Datum")}</span>
        <span>${T("library.distance", "Strecke")}</span><span>${T("library.ascent", "Höhenmeter")}</span>
        <span>${T("library.duration", "Dauer")}</span><span>${T("library.activity", "Fortbewegung")}</span>
      </div>
      ${_items.map((it, i) => `
        <button class="lib-row${_sel && _sel.path === it.path ? " is-sel" : ""}" data-i="${i}" type="button">
          <span class="lib-row-thumb">${it.thumb_url ? `<img src="${it.thumb_url}" alt="" loading="lazy">` : ""}</span>
          <span class="lib-row-name">${it.fav ? "★ " : ""}${esc(it.name)}
            ${it.recorded_eff ? "" : `<i class="lib-row-tag">${T("library.planned", "geplant")}</i>`}
            ${it.has_session ? `<i class="lib-row-tag lib-row-tag-proj">●</i>` : ""}</span>
          <span>${fmtDate(it.started_at)}</span>
          <span>${fmtKmVal(it.distance_m || 0)}</span>
          <span>↑ ${num(it.ascent_m)} m</span>
          <span>${it.duration_s ? fmtDurVal(it.duration_s) : "—"}</span>
          <span>${esc(ACT_LABELS[it.activity] || it.activity || "—")}</span>
        </button>`).join("")}`;
    bindItemClicks(box);
  }

  function bindItemClicks(root) {
    root.querySelectorAll("[data-i]").forEach(btn => {
      btn.onclick = () => select(_items[parseInt(btn.dataset.i, 10)]);
      btn.ondblclick = () => openIn("animator");
    });
  }

  // ── Statistik ─────────────────────────────────────────────────────────
  /** Balken ohne Fremdbibliothek — bei zwölf Monaten und ein paar Jahren wäre
   *  eine Chart-Bibliothek im Bundle reine Verschwendung. */
  function bars(rows, labelOf, valueOf, unit, sub) {
    const max = Math.max(1, ...rows.map(valueOf));
    return `<div class="lib-bars">${rows.map(r => {
      const v = valueOf(r);
      return `<div class="lib-cbar" title="${esc(labelOf(r))}: ${num(v)} ${unit}">
        <div class="lib-cbar-track"><i style="height:${Math.max(2, (v / max) * 100)}%"></i></div>
        <div class="lib-cbar-val">${v >= 1000 ? Math.round(v / 1000) + "k" : Math.round(v)}</div>
        <div class="lib-cbar-lbl">${esc(String(labelOf(r)))}</div>
        ${sub ? `<div class="lib-cbar-sub">${esc(sub(r))}</div>` : ""}
      </div>`;
    }).join("")}</div>`;
  }

  function renderStats() {
    const s = _stats || {};
    const box = $("lib-stats");
    if (!s.n_tracks) { box.innerHTML = emptyHtml(); bindEmpty(); return; }
    const tiles = [
      [T("library.tours", "Touren"), num(s.n_tracks), ""],
      [T("library.distance", "Strecke"), num(s.total_km), "km"],
      [T("library.ascent", "Höhenmeter"), num(s.total_ascent_m), "m"],
      [T("library.hours", "Stunden"), num(s.total_hours), "h"],
      [T("library.stat_avg", "Ø je Tour"), num(s.avg_km), "km"],
      [T("library.stat_longest", "Längste"), num(s.longest_km), "km"],
    ];
    // Der Balken beantwortet „wie viel davon bin ich wirklich gefahren?" —
    // im Bereich „Gemachte" oder „Geplante" ist die Antwort schon bekannt und
    // ein einfarbiger Balken mit „0 geplant" nur Lärm.
    const mixed = s.done && s.planned && s.done.n > 0 && s.planned.n > 0;
    const total = mixed ? s.done.n + s.planned.n : 0;
    box.innerHTML = `
      <div class="lib-stats-inner">
        <div class="lib-stats-head">
          <b>${esc(scopeTitle())}</b>
          ${s.year_min ? `<span>${s.year_min}–${s.year_max}</span>` : ""}
          ${state.search ? `<span>„${esc(state.search)}"</span>` : ""}
        </div>

        <div class="lib-tiles">
          ${tiles.map(([k, v, u]) => `<div class="lib-tile"><b>${v}<i>${u}</i></b><span>${esc(k)}</span></div>`).join("")}
        </div>

        ${total ? `
          <div class="lib-split">
            <div class="lib-split-bar">
              <i class="is-done" style="width:${(s.done.n / total) * 100}%"></i>
              <i class="is-plan" style="width:${(s.planned.n / total) * 100}%"></i>
            </div>
            <div class="lib-split-lbl">
              <span><b>${s.done.n}</b> ${T("library.done_short", "gemacht")} · ${num(s.done.km)} km</span>
              <span><b>${s.planned.n}</b> ${T("library.planned", "geplant")} · ${num(s.planned.km)} km</span>
            </div>
          </div>` : ""}

        ${s.years && s.years.length ? `
          <div class="lib-chart">
            <div class="lib-chart-title">${T("library.stat_per_year", "Kilometer je Jahr")}</div>
            ${bars(s.years, r => r.year, r => r.km, "km", r => r.n + " ×")}
          </div>` : ""}

        ${s.months && s.months.length ? `
          <div class="lib-chart">
            <div class="lib-chart-title">${T("library.stat_per_month", "Touren je Monat (über alle Jahre)")}</div>
            ${bars(s.months, r => MONTHS[(r.month || 1) - 1], r => r.n, "×", r => num(r.km) + " km")}
          </div>` : ""}

        ${s.activities && s.activities.filter(a => a.activity).length ? `
          <div class="lib-chart">
            <div class="lib-chart-title">${T("library.stat_per_activity", "Nach Fortbewegung")}</div>
            <div class="lib-acts">
              ${s.activities.filter(a => a.activity).map(a => `
                <div class="lib-act-row">
                  <span>${esc(ACT_LABELS[a.activity] || a.activity)}</span>
                  <div class="lib-act-bar"><i style="width:${(a.n / s.n_tracks) * 100}%"></i></div>
                  <b>${a.n}</b><span class="lib-act-km">${num(a.km)} km</span>
                </div>`).join("")}
            </div>
          </div>` : ""}

        ${s.longest && s.longest.length ? `
          <div class="lib-chart">
            <div class="lib-chart-title">${T("library.stat_top", "Die längsten Touren")}</div>
            <div class="lib-top">
              ${s.longest.map((it, i) => `
                <button class="lib-top-row" data-top="${i}" type="button">
                  <span class="lib-top-n">${i + 1}</span>
                  <span class="lib-top-name">${esc(it.name)}</span>
                  <span class="lib-top-km">${fmtKmVal(it.distance_m || (it.distance_km || 0) * 1000)}</span>
                  <span class="lib-top-date">${fmtDate(it.started_at)}</span>
                </button>`).join("")}
            </div>
          </div>` : ""}
      </div>`;
    box.querySelectorAll("[data-top]").forEach(b => {
      b.onclick = () => {
        const it = (s.longest || [])[parseInt(b.dataset.top, 10)];
        if (it) select(_items.find(x => x.path === it.path) || it);
      };
    });
  }

  // ── Karte ─────────────────────────────────────────────────────────────
  function renderMap() {
    const hint = $("lib-map-hint");
    const feats = _items.filter(it => it.geom && it.geom.length > 1).map((it, i) => ({
      type: "Feature",
      properties: { i, path: it.path, name: it.name, fav: it.fav ? 1 : 0 },
      geometry: { type: "LineString", coordinates: it.geom },
    }));
    hint.textContent = feats.length
      ? `${feats.length} ${T("library.on_map", "Touren auf der Karte")}`
      : T("library.map_no_geom", "Für diese Touren ist noch kein Streckenverlauf gespeichert — einmal „Neu einlesen“ genügt.");

    const data = { type: "FeatureCollection", features: feats };
    if (_map && _mapReady) {
      if (_sel && !feats.some(f => f.properties.path === _sel.path)) closeMapPopup();
      // Beim Ansichtswechsel war die Karte ausgeblendet — Mapbox merkt die neue
      // Größe erst, wenn man es ihm sagt.
      try { _map.resize(); } catch (_) {}
      applyMapData(data);
      return;
    }
    if (_map) return;

    const created = createMap({
      container: "lib-map",
      mapboxStyle: "mapbox://styles/mapbox/outdoors-v12",
      common: { center: [10, 51], zoom: 3, attributionControl: true },
    });
    _map = created.map; _mapLib = created.lib;
    // Für die automatischen Tests greifbar (wie in den anderen Modulen üblich).
    window.__libMap = _map;
    _map.addControl(new created.lib.NavigationControl({ showCompass: false }), "top-right");
    _map.on("load", () => {
      _mapReady = true;
      _map.addSource("lib-tracks", { type: "geojson", data });
      // Weit draußen sind einzelne Touren nur noch Striche von Bruchteilen
      // eines Pixels — dann übernehmen Punkte.
      _map.addLayer({
        id: "lib-tracks-dot", type: "circle", source: "lib-tracks",
        paint: {
          "circle-color": ["case", ["==", ["get", "fav"], 1], FAV_COLOR, TRACK_COLOR],
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 0, 1.8, 6, 2.6, 9, 0],
          "circle-opacity": ["interpolate", ["linear"], ["zoom"], 6, 0.9, 9, 0],
          "circle-blur": 0.25,
        },
      });
      // Dunkle Kontur unter jeder Linie: auf hellen Feldern und Straßen war der
      // dünne Strich sonst kaum zu sehen.
      _map.addLayer({
        id: "lib-tracks-casing", type: "line", source: "lib-tracks",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#0b0f14",
          "line-width": ["interpolate", ["linear"], ["zoom"], 4, 2.6, 8, 3.6, 12, 5.4, 16, 7.5],
          "line-opacity": 0.35,
        },
      });
      _map.addLayer({
        id: "lib-tracks-line", type: "line", source: "lib-tracks",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["case", ["==", ["get", "fav"], 1], FAV_COLOR, TRACK_COLOR],
          "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1.4, 8, 2.2, 12, 3.4, 16, 5],
          "line-opacity": 0.95,
        },
      });
      _map.addLayer({
        id: "lib-tracks-sel-halo", type: "line", source: "lib-tracks",
        filter: ["==", ["get", "path"], ""],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-width": 8, "line-opacity": 0.95 },
      });
      _map.addLayer({
        id: "lib-tracks-sel", type: "line", source: "lib-tracks",
        filter: ["==", ["get", "path"], ""],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": SEL_COLOR, "line-width": 4 },
      });
      _map.addLayer({
        id: "lib-tracks-hit", type: "line", source: "lib-tracks",
        paint: { "line-color": "#000", "line-width": 12, "line-opacity": 0 },
      });
      _map.on("click", "lib-tracks-hit", (e) => {
        const f = e.features && e.features[0];
        if (!f) return;
        const it = _items.find(x => x.path === f.properties.path);
        if (!it) return;
        select(it, { fly: false });
        showMapPopup(it, e.lngLat);
      });
      // Klick ins Leere schließt die Info-Karte und hebt die Hervorhebung auf.
      _map.on("click", (e) => {
        const hits = _map.queryRenderedFeatures(e.point, { layers: ["lib-tracks-hit"] });
        if (!hits.length) { closeMapPopup(); _sel = null; applyMapSelection(); renderDetail(); }
      });
      _map.on("mouseenter", "lib-tracks-hit", () => { _map.getCanvas().style.cursor = "pointer"; });
      _map.on("mouseleave", "lib-tracks-hit", () => { _map.getCanvas().style.cursor = ""; });
      fitAll(data);
      applyMapSelection();
    });
  }

  /** Info-Karte direkt auf der Karte: Name, die wichtigsten Zahlen und die zwei
   *  Dinge, die man dort tun will — öffnen oder einer Sammlung zuordnen. */
  function showMapPopup(it, lngLat) {
    if (!_map || !_mapLib) return;
    closeMapPopup();
    const rows = [
      [T("library.distance", "Strecke"), fmtKmVal(it.distance_m || 0)],
      [T("library.ascent", "Höhenmeter"), "↑ " + num(it.ascent_m) + " m"],
      [T("library.duration", "Dauer"), it.duration_s ? fmtDurVal(it.duration_s) : "—"],
    ];
    _mapPopup = new _mapLib.Popup({
      closeButton: true, closeOnClick: false, maxWidth: "300px", offset: 12, className: "lib-popup",
    }).setLngLat(lngLat).setHTML(`
      <div class="lib-pop">
        <div class="lib-pop-title">${esc(it.name)}</div>
        <div class="lib-pop-sub">${fmtDate(it.started_at)}
          ${it.activity ? " · " + esc(ACT_LABELS[it.activity] || it.activity) : ""}
          ${it.recorded_eff ? "" : " · " + T("library.planned", "geplant")}</div>
        <div class="lib-pop-stats">
          ${rows.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}
        </div>
        <div class="lib-pop-btns">
          <button class="btn btn-primary btn-sm" data-pop="open">${T("library.open_animator", "Im Animator öffnen")}</button>
          <button class="btn btn-sm" data-pop="col">+ ${T("library.col_add", "Zu Sammlung")}</button>
        </div>
      </div>`).addTo(_map);
    const el = _mapPopup.getElement();
    if (!el) return;
    const o = el.querySelector('[data-pop="open"]'); if (o) o.onclick = () => openIn("animator");
    const c = el.querySelector('[data-pop="col"]'); if (c) c.onclick = () => addToCollectionDialog([it.path]);
  }
  function closeMapPopup() {
    if (_mapPopup) { try { _mapPopup.remove(); } catch (_) {} _mapPopup = null; }
  }
  function applyMapData(data) {
    const src = _map.getSource("lib-tracks");
    if (src) { src.setData(data); fitAll(data); }
  }
  function applyMapSelection(fly) {
    if (!_map || !_mapReady) return;
    const path = _sel ? _sel.path : "";
    for (const id of ["lib-tracks-sel-halo", "lib-tracks-sel"]) {
      if (_map.getLayer(id)) _map.setFilter(id, ["==", ["get", "path"], path]);
    }
    // Nicht zu stark zurücknehmen: die anderen Touren sollen erkennbar bleiben.
    if (_map.getLayer("lib-tracks-line")) _map.setPaintProperty("lib-tracks-line", "line-opacity", path ? 0.55 : 0.95);
    if (_map.getLayer("lib-tracks-casing")) _map.setPaintProperty("lib-tracks-casing", "line-opacity", path ? 0.2 : 0.35);
    if (!fly || !_sel || !_sel.geom || _sel.geom.length < 2) return;
    fitAll({ features: [{ geometry: { coordinates: _sel.geom } }] });
  }
  function fitAll(data) {
    let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90, any = false;
    for (const f of data.features) {
      for (const c of f.geometry.coordinates) {
        any = true;
        if (c[0] < minLon) minLon = c[0];
        if (c[0] > maxLon) maxLon = c[0];
        if (c[1] < minLat) minLat = c[1];
        if (c[1] > maxLat) maxLat = c[1];
      }
    }
    if (!any) return;
    try { _map.fitBounds([[minLon, minLat], [maxLon, maxLat]], { padding: 40, duration: 0, maxZoom: 12 }); }
    catch (_) { /* entartete Bounds — Ausschnitt bleibt wie er ist */ }
  }

  function select(it, opts) {
    _sel = it;
    if (view === "cards") renderGrid();
    else if (view === "list") renderList();
    else if (view === "map") applyMapSelection(opts && opts.fly);
    renderDetail();
  }

  // ── Detailspalte ──────────────────────────────────────────────────────
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
      [T("library.ascent", "Höhenmeter"), `↑ ${num(it.ascent_m)} m · ↓ ${num(it.descent_m)} m`],
      [T("library.speed", "Schnitt"), it.avg_speed_kmh ? it.avg_speed_kmh.toFixed(1) + " km/h" : "—"],
      [T("library.points", "Punkte"), `${it.n_points || 0}${it.n_segments > 1 ? ` · ${it.n_segments} ${T("library.segments", "Etappen")}` : ""}`],
      [T("library.activity", "Fortbewegung"), ACT_LABELS[it.activity] || (it.activity || "—")],
      [T("library.file", "Datei"), it.filename],
    ];
    box.innerHTML = `
      <div class="lib-detail-thumb">${it.thumb_url
        ? `<img src="${it.thumb_url}" alt="">`
        // In der Kartenansicht werden die Vorschaubilder nicht mitgeladen (700
        // data-URLs neben einer Karte wären Unsinn). Ohne Platzhalter stünde
        // hier ein leerer heller Kasten.
        : `<div class="lib-card-nothumb">🗺️</div>`}</div>
      <div class="lib-cover-row">
        <button class="btn btn-ghost btn-sm" id="lib-d-cover">${T("library.set_cover", "Eigenes Bild wählen")}</button>
        ${it.cover ? `<button class="btn btn-ghost btn-sm" id="lib-d-uncover">${T("library.clear_cover", "Bild entfernen")}</button>` : ""}
      </div>

      <input type="text" id="lib-d-name" class="lib-input lib-title-input" value="${esc(it.name)}"
             title="${esc(T("library.rename_hint", "Eigener Name — leer lassen setzt den Namen aus der Datei zurück."))}">
      ${it.renamed ? `<div class="lib-hint">${T("library.renamed_from", "Datei-Name")}: ${esc(it.file_name)}</div>` : ""}
      ${it.error ? `<div class="lib-warn">${T("library.file_error", "Diese Datei konnte nicht gelesen werden")}: ${esc(it.error)}</div>` : ""}
      ${!it.exists ? `<div class="lib-warn">${it.missing_since
          ? T("library.missing_long", "Diese Datei ist gerade nicht auffindbar — vermutlich liegt sie auf einer Platte, die nicht angeschlossen ist. Die Tour bleibt im Archiv; sobald die Datei wieder da ist, geht alles weiter. Nach 90 Tagen ohne Wiedersehen verschwindet der Eintrag (deine Angaben dazu bleiben trotzdem erhalten).")
          : T("library.file_gone", "Die Datei liegt nicht mehr an diesem Ort.")}</div>` : ""}

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

      <div class="field-label" style="margin-top:10px;">${T("library.recorded_label", "Gemacht oder geplant?")}</div>
      <div class="lib-seg" id="lib-d-rec">
        <button type="button" data-rec="1"${it.recorded_eff ? " class='is-on'" : ""}>${T("library.recorded_yes", "Gemacht")}</button>
        <button type="button" data-rec="0"${!it.recorded_eff ? " class='is-on'" : ""}>${T("library.recorded_no", "Geplant")}</button>
        <button type="button" data-rec="auto"${it.recorded_manual ? "" : " class='is-on'"}>${T("library.recorded_auto", "Automatisch")}</button>
      </div>
      <div class="lib-hint">${recSrcText(it)}</div>

      <div class="field-label" style="margin-top:10px;">${T("library.activity", "Fortbewegung")}</div>
      <select id="lib-d-act" class="lib-select lib-d-act">
        <option value="">${T("library.act_auto", "Automatisch erkannt")}${
          it.activity_user ? "" : ` — ${ACT_LABELS[it.activity] || it.activity || T("library.act_none", "keine")}`}</option>
        ${Object.keys(ACT_LABELS).map(k =>
          `<option value="${k}"${it.activity_user === k ? " selected" : ""}>${esc(ACT_LABELS[k])}</option>`).join("")}
      </select>
      <div class="lib-hint">${it.activity_user
        ? T("library.act_manual", "Von dir gesetzt — gilt für alle Kopien dieser Tour.")
        : T("library.act_guessed", "Geschätzt aus Name und Tempo. Einmal ändern genügt, es bleibt.")}</div>

      <div class="field-label" style="margin-top:10px;">${T("library.collections", "Sammlungen")}</div>
      <div id="lib-d-cols" class="lib-colchips"></div>

      <label class="field-label" for="lib-d-tags" style="margin-top:10px;">${T("library.tags", "Schlagwörter")}</label>
      <input type="text" id="lib-d-tags" class="lib-input" value="${esc((it.tag_list || []).join(", "))}"
             placeholder="${T("library.tags_ph", "z. B. Mallorca, Testfahrt")}">

      <label class="field-label" for="lib-d-note" style="margin-top:8px;">${T("library.note", "Notiz")}</label>
      <textarea id="lib-d-note" class="lib-input" rows="3">${esc(it.note || "")}</textarea>

      <div class="lib-actions" style="margin-top:12px;">
        <button class="btn btn-ghost btn-sm" id="lib-d-reveal">${T("library.reveal", "Im Finder zeigen")}</button>
        ${it.source_url ? `<button class="btn btn-ghost btn-sm" id="lib-d-src">${T("library.open_source", "Bei Komoot ansehen")}</button>` : ""}
      </div>
      <div class="lib-actions lib-danger">
        <button class="btn btn-ghost btn-sm" id="lib-d-hide">${it.hidden ? T("library.unhide", "Wieder einblenden") : T("library.hide", "Ausblenden")}</button>
        <button class="btn btn-ghost btn-sm" id="lib-d-forget">${T("library.forget", "Aus Archiv nehmen")}</button>
        <button class="btn btn-ghost btn-sm lib-btn-danger" id="lib-d-trash">${T("library.trash", "In den Papierkorb")}</button>
      </div>`;

    box.querySelectorAll("[data-open]").forEach(b => { b.onclick = () => openIn(b.dataset.open); });

    const nameInput = $("lib-d-name");
    const saveName = debounce(async () => {
      const v = nameInput.value.trim();
      // Wer den Datei-Namen wieder hinschreibt, will offensichtlich zurück.
      const res = await api().library_set_name(it.path, v === it.file_name ? "" : v);
      if (res && res.ok && res.track) { Object.assign(it, res.track); renderView(); }
    }, 600);
    nameInput.oninput = saveName;

    // Die Listendaten kennen `activity_user` nicht (das steht in track_meta und
    // wird nur je Tour nachgeschlagen). Einmal nachladen, damit die Auswahl den
    // richtigen Zustand zeigt.
    if (it.activity_user === undefined) {
      api().library_get_track(it.path).then(r => {
        if (r && r.ok && r.track && r.track.activity_user !== undefined) {
          it.activity_user = r.track.activity_user;
          if (_sel && _sel.path === it.path) renderDetail();
        }
      }).catch(() => {});
    }

    $("lib-d-act").onchange = async (e) => {
      const res = await api().library_set_activity(it.path, e.target.value);
      if (res && res.ok && res.track) {
        Object.assign(it, res.track);
        renderDetail();
        // Der Filter „Fortbewegung" und die Statistik zählen jetzt anders.
        if (state.activity) reload(); else { renderView(); reloadStats(); }
      } else if (res && res.error) {
        toast(res.error, "error");
      }
    };

    $("lib-d-fav").onchange = async (e) => {
      await api().library_set_fields(it.path, e.target.checked, null, null);
      it.fav = e.target.checked ? 1 : 0;
      if (scope === "fav") reload(); else { renderView(); reloadStats(); }
    };
    $("lib-d-rec").querySelectorAll("[data-rec]").forEach(b => {
      b.onclick = async () => {
        const v = b.dataset.rec === "auto" ? null : b.dataset.rec === "1";
        const res = await api().library_set_recorded(it.path, v);
        if (res && res.ok && res.track) {
          Object.assign(it, res.track);
          renderDetail();
          // In „Gemachte"/„Geplante" kann die Tour jetzt herausfallen.
          if (scope === "done" || scope === "planned") reload();
          else { renderView(); reloadStats(); }
        }
      };
    });
    renderTrackCollections(it);

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

    $("lib-d-cover").onclick = async () => {
      const res = await api().library_set_cover(it.path, "");
      if (res.cancelled) return;
      if (!res.ok) { toast(res.error || "Bild konnte nicht gesetzt werden", "error"); return; }
      it.cover = (res.track && res.track.cover) || "";
      it.thumb_url = res.thumb_url || it.thumb_url;
      renderDetail(); renderView();
    };
    const unc = $("lib-d-uncover");
    if (unc) unc.onclick = async () => {
      const res = await api().library_clear_cover(it.path);
      if (!res.ok) return;
      it.cover = ""; it.thumb_url = res.thumb_url || "";
      renderDetail(); renderView();
    };

    $("lib-d-hide").onclick = async () => {
      await api().library_set_hidden(it.path, !it.hidden);
      _sel = null; renderDetail(); reload();
    };
    $("lib-d-forget").onclick = async () => {
      await api().library_forget(it.path);
      _sel = null; renderDetail(); reload();
    };
    $("lib-d-trash").onclick = () => confirmTrash(it);
  }

  /** Endgültig wirkende Aktionen fragen nach — hier geht es um eine fremde
   *  Datei, nicht um App-Daten. */
  function confirmTrash(it) {
    const m = openModal({
      title: T("library.trash", "In den Papierkorb"),
      body: `<div class="lib-fmodal">
        <p>${T("library.trash_q", "Diese Datei in den Papierkorb legen?")}</p>
        <p class="lib-hint">${esc(it.path)}</p>
        <p class="lib-hint">${T("library.trash_note", "Die Tour verschwindet aus dem Archiv. Aus dem Papierkorb kannst du sie zurückholen, solange er nicht geleert ist.")}</p>
        <div class="lib-actions" style="margin-top:12px;">
          <button class="btn btn-sm" id="lib-trash-cancel">${T("library.cancel", "Abbrechen")}</button>
          <button class="btn btn-sm lib-btn-danger" id="lib-trash-ok">${T("library.trash_do", "In den Papierkorb")}</button>
        </div>
      </div>`,
    });
    const cancel = document.getElementById("lib-trash-cancel");
    if (cancel) cancel.onclick = () => m.close();
    const ok = document.getElementById("lib-trash-ok");
    if (ok) ok.onclick = async () => {
      const res = await api().library_trash(it.path);
      m.close();
      if (!res.ok) { toast(res.error || "Nicht möglich", "error"); return; }
      toast(T("library.trash_done", "In den Papierkorb gelegt."), "info");
      _sel = null; renderDetail(); reload();
    };
  }

  /** Woran erkannt? — damit die Schätzung nachvollziehbar bleibt. */
  function recSrcText(it) {
    if (it.recorded_manual) return T("library.rec_src.user", "Von dir festgelegt.");
    const m = {
      sensors: T("library.rec_src.sensors", "Erkannt an aufgezeichneten Sensordaten (Puls, Trittfrequenz …) — sicher gemacht."),
      name: T("library.rec_src.name", "Erkannt am Namen der Tour."),
      notime: T("library.rec_src.notime", "Ohne Zeitstempel — das kann keine Aufzeichnung sein."),
      rhythm: T("library.rec_src.rhythm", "Geschätzt am Rhythmus der Aufzeichnung (Pausen, schwankendes Tempo). Stimmt meistens, aber nicht immer — hier korrigierbar."),
    };
    return m[it.recorded_src] || "";
  }

  async function renderTrackCollections(it) {
    const box = $("lib-d-cols");
    if (!box) return;
    const res = await api().library_collections_of(it.path);
    const mine = (res && res.collections) || [];
    box.innerHTML =
      mine.map(c => `<span class="lib-colchip">${esc(c.name)}<button data-rm="${c.id}" title="${esc(T("library.col_remove", "Aus der Sammlung nehmen"))}">✕</button></span>`).join("") +
      `<button class="lib-chip lib-chip-ghost" id="lib-d-addcol">+ ${T("library.col_add", "Zu Sammlung")}</button>`;
    box.querySelectorAll("[data-rm]").forEach(b => {
      b.onclick = async () => {
        await api().library_collection_remove(parseInt(b.dataset.rm, 10), [it.path]);
        await reloadCollections(); renderTrackCollections(it);
        if (state.collection_id) reload();
      };
    });
    const add = $("lib-d-addcol");
    if (add) add.onclick = () => addToCollectionDialog([it.path]);
  }

  // ── Sammlungen ────────────────────────────────────────────────────────
  function addToCollectionDialog(paths) {
    const many = paths.length > 1;
    const list = _collections.map(c =>
      `<button class="btn btn-sm lib-colpick" data-col="${c.id}">${esc(c.name)} <i>(${c.n})</i></button>`).join("");
    const m = openModal({
      title: many ? `${paths.length} ${T("library.col_add_many", "Touren zu einer Sammlung")}`
                  : (paths.length ? T("library.col_add", "Zu Sammlung") : T("library.col_new", "Neue Sammlung")),
      body: `<div class="lib-fmodal">
          ${paths.length ? `<div class="lib-actions">${list || `<span class="lib-hint">${T("library.col_none", "Noch keine Sammlung angelegt.")}</span>`}</div><hr class="lib-hr">` : ""}
          <label class="field-label" for="lib-newcol">${T("library.col_new", "Neue Sammlung")}</label>
          <div style="display:flex; gap:6px;">
            <input type="text" id="lib-newcol" class="lib-input" placeholder="${T("library.col_new_ph", "z. B. Märkischer Landweg")}">
            <button class="btn btn-primary btn-sm" id="lib-newcol-go">${T("library.col_create", "Anlegen")}</button>
          </div>
          ${!paths.length && _total && _total <= 60 ? `
            <hr class="lib-hr">
            <button class="btn btn-sm" id="lib-col-addall">${T("library.col_add_filtered", "Alle")} ${_total} ${T("library.col_add_filtered2", "Treffer in eine Sammlung")}</button>
            <div class="lib-hint">${T("library.col_add_filtered_hint", "Nimmt genau das, was gerade gefiltert angezeigt wird.")}</div>` : ""}
        </div>`,
    });
    document.querySelectorAll("#modal-body .lib-colpick").forEach(b => {
      b.onclick = async () => {
        const cid = parseInt(b.dataset.col, 10);
        await api().library_collection_add(cid, paths);
        await api().library_collection_sort_by_date(cid);
        m.close(); await reloadCollections();
        if (_sel) renderTrackCollections(_sel);
        if (state.collection_id) reload();
        toast(T("library.col_added", "Zur Sammlung hinzugefügt."), "info");
      };
    });
    const go = document.getElementById("lib-newcol-go");
    if (go) go.onclick = async () => {
      const name = (document.getElementById("lib-newcol") || {}).value || "";
      if (!name.trim()) return;
      const res = await api().library_collection_create(name.trim(), paths);
      if (res && res.ok && paths.length) await api().library_collection_sort_by_date(res.id);
      m.close(); await reloadCollections();
      if (_sel) renderTrackCollections(_sel);
      toast(T("library.col_created", "Sammlung angelegt."), "info");
    };
    const all = document.getElementById("lib-col-addall");
    if (all) all.onclick = () => { m.close(); addToCollectionDialog(_items.map(i => i.path)); };
  }

  function openCollectionMenu(cid) {
    const c = _collections.find(x => x.id === cid);
    if (!c) return;
    const m = openModal({
      title: c.name,
      body: `<div class="lib-fmodal">
        <label class="field-label" for="lib-cm-name">${T("library.name", "Name")}</label>
        <input type="text" id="lib-cm-name" class="lib-input" value="${esc(c.name)}">
        <div class="lib-hint" style="margin-top:6px;">${c.n} ${T("library.tours", "Touren")} · ${num(c.total_km)} km · ↑ ${num(c.total_ascent_m)} m</div>
        <div class="lib-actions" style="margin-top:12px;">
          <button class="btn btn-primary btn-sm" id="lib-cm-show">${T("library.col_open", "Anzeigen")}</button>
          <button class="btn btn-sm" id="lib-cm-anim">${T("library.col_animator", "Alle im Animator")}</button>
          <button class="btn btn-ghost btn-sm lib-btn-danger" id="lib-cm-del">${T("library.col_delete", "Löschen")}</button>
        </div>
        <div class="lib-hint" style="margin-top:8px;">${T("library.col_delete_note", "Löschen entfernt nur die Sammlung — die Touren bleiben im Archiv.")}</div>
      </div>`,
    });
    const nameEl = document.getElementById("lib-cm-name");
    if (nameEl) nameEl.onchange = async () => {
      await api().library_collection_rename(cid, nameEl.value);
      await reloadCollections();
    };
    const show = document.getElementById("lib-cm-show");
    if (show) show.onclick = () => {
      state.collection_id = cid; state.sort = "collection";
      m.close(); renderCollections(); reload();
    };
    const anim = document.getElementById("lib-cm-anim");
    if (anim) anim.onclick = () => { m.close(); openCollectionInAnimator(cid); };
    const del = document.getElementById("lib-cm-del");
    if (del) del.onclick = async () => {
      await api().library_collection_delete(cid);
      if (state.collection_id === cid) { state.collection_id = 0; state.sort = "date_desc"; }
      m.close(); await reloadCollections(); reload();
    };
  }

  /** Ganze Sammlung an den Animator übergeben — erste Tour als Haupt-Track,
   *  der Rest als zusätzliche Touren. Genau dafür hat sie eine Reihenfolge. */
  async function openCollectionInAnimator(cid) {
    const res = await api().library_collection_items(cid);
    const items = (res && res.items) || [];
    if (!items.length) { toast(T("library.col_empty", "Diese Sammlung ist leer."), "warn"); return; }
    // Die weiteren Etappen werden NICHT von hier aus hinzugefügt: der Animator
    // lädt beim Mounten seinen Projekt-State und würde sie sofort wieder
    // überschreiben. Er holt sie sich selbst ab, sobald er fertig ist.
    window.__rzPendingTours = items.slice(1).map(i => i.path);
    const ok = await window.loadGlobalGpx(items[0].path);
    if (ok === false) { window.__rzPendingTours = null; return; }
    if (typeof switchMod === "function") switchMod("animator");
    if (items.length > 1) {
      toast(`${items.length} ${T("library.col_loaded", "Touren geladen.")}`, "info");
    }
  }

  /** Tour in ein Werkzeug übernehmen: derselbe Weg wie „Datei wählen". */
  async function openIn(slug) {
    if (!_sel) return;
    if (!_sel.exists) { toast(T("library.file_gone", "Die Datei liegt nicht mehr an diesem Ort."), "error"); return; }
    const ok = await window.loadGlobalGpx(_sel.path);
    if (ok !== false && typeof switchMod === "function") switchMod(slug);
  }

  // ── Ordner + Einlesen ─────────────────────────────────────────────────
  let _foldersModal = null;

  async function openFoldersModal() {
    await reloadFolders();
    _foldersModal = openModal({
      title: T("library.folders_btn", "Ordner & Einlesen"),
      body: foldersModalHtml(),
      onClose: () => { _foldersModal = null; },
    });
    bindFoldersModal();
  }

  function foldersModalHtml() {
    const list = _folders.length
      ? _folders.map(f => `
          <div class="lib-folder${f.exists ? "" : " is-missing"}" title="${esc(f.path)}">
            <span class="lib-folder-name">${esc(f.path)}</span>
            <span class="lib-folder-n">${f.n_tracks}</span>
            <button class="lib-folder-x" data-folder="${esc(f.path)}" title="${esc(T("library.remove_folder", "Ordner nicht mehr beobachten"))}">✕</button>
          </div>`).join("")
      : `<div class="lib-empty-hint">${T("library.no_folders", "Noch kein Ordner. Füge den Ordner hinzu, in dem deine GPX-Dateien liegen.")}</div>`;
    return `
      <div class="lib-fmodal">
        <div class="lib-folders">${list}</div>
        <div class="lib-actions" style="margin-top:10px;">
          <button class="btn btn-primary btn-sm" id="lib-add-folder">📂 ${T("library.add_folder", "+ Ordner hinzufügen")}</button>
          <button class="btn btn-ghost btn-sm" id="lib-scan">${T("library.scan", "Neu einlesen")}</button>
        </div>
        <div id="lib-scan-info" class="lib-scan-info"></div>

        <hr class="lib-hr">
        <div class="field-label">${T("library.map_thumbs", "Vorschaubilder mit Karte")}</div>
        <div class="lib-hint">${T("library.map_thumbs_hint", "Statt der reinen Linie eine echte Karte hinter jeder Tour. Jedes Bild wird einmal von Mapbox geholt und liegt danach auf dem Rechner — die Ansicht bleibt also offline und kostenlos. Rund 5 Minuten für 700 Touren.")}</div>
        <div class="lib-actions" style="margin-top:8px;">
          <button class="btn btn-sm" id="lib-maps">${T("library.map_thumbs_start", "Kartenbilder holen")}</button>
          <button class="btn btn-ghost btn-sm" id="lib-maps-stop" hidden>${T("library.stop", "Anhalten")}</button>
        </div>
        <div id="lib-maps-info" class="lib-scan-info"></div>
      </div>`;
  }

  function bindFoldersModal() {
    document.querySelectorAll("#modal-body [data-folder]").forEach(btn => {
      btn.onclick = async () => {
        await api().library_remove_folder(btn.dataset.folder, true);
        await reloadFolders(); await reload();
        if (_foldersModal) { _foldersModal.update({ body: foldersModalHtml() }); bindFoldersModal(); }
      };
    });
    const add = $("lib-add-folder");
    if (add) add.onclick = addFolder;
    const scan = $("lib-scan");
    if (scan) scan.onclick = () => startScan(false);
    const maps = $("lib-maps");
    if (maps) maps.onclick = startMapThumbs;
    const stop = $("lib-maps-stop");
    if (stop) stop.onclick = () => api().library_map_thumbs_stop();
  }

  async function addFolder() {
    const res = await api().library_add_folder("");
    if (res.cancelled) return;
    if (!res.ok) { toast(res.error || "Ordner konnte nicht hinzugefügt werden", "error"); return; }
    await reloadFolders();
    if (_foldersModal) { _foldersModal.update({ body: foldersModalHtml() }); bindFoldersModal(); }
    else await openFoldersModal();
    startScan(false);
  }

  async function startScan(force) {
    const res = await api().library_scan_start(!!force);
    if (!res.ok) { toast(res.error || "Einlesen läuft bereits", "warn"); return; }
    const btn = $("lib-scan");
    if (btn) btn.disabled = true;
    pollScan();
  }

  function pollScan() {
    clearTimeout(_scanTimer);
    _scanTimer = setTimeout(async () => {
      if (_unmounted) return;
      const st = await api().library_scan_status();
      const info = $("lib-scan-info");
      if (st.running) {
        if (info) {
          const pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
          info.innerHTML = `<div class="lib-progress"><i style="width:${pct}%"></i></div>
            <div class="lib-progress-txt">${st.done || 0} / ${st.total || "?"} · ${esc(st.current || "")}</div>`;
        }
        pollScan();
      } else {
        const btn = $("lib-scan");
        if (btn) btn.disabled = false;
        const r = st.result || st;
        if (info) {
          if (st.error) info.innerHTML = `<div class="lib-warn">${esc(st.error)}</div>`;
          else if (r && r.added != null) {
            info.innerHTML = `<div class="lib-scan-done">${T("library.scan_done", "Fertig")}: ` +
              `${r.added} ${T("library.new", "neu")} · ${r.updated} ${T("library.updated", "aktualisiert")}` +
              `${r.failed ? ` · ${r.failed} ${T("library.failed", "fehlerhaft")}` : ""}</div>`;
          } else info.innerHTML = "";
        }
        await reloadFolders(); await reload();
      }
    }, 400);
  }

  async function startMapThumbs() {
    const res = await api().library_map_thumbs_start();
    if (!res.ok) {
      const info = $("lib-maps-info");
      if (info) info.innerHTML = `<div class="lib-warn">${res.error === "no_token"
        ? T("library.map_thumbs_no_token", "Dafür braucht es einen Mapbox-Token — ohne bleibt es bei der Linienzeichnung.")
        : esc(res.error || "")}</div>`;
      return;
    }
    const b = $("lib-maps"); if (b) b.disabled = true;
    const s = $("lib-maps-stop"); if (s) s.hidden = false;
    pollMapThumbs();
  }

  function pollMapThumbs() {
    clearTimeout(_mapsTimer);
    _mapsTimer = setTimeout(async () => {
      if (_unmounted) return;
      const st = await api().library_map_thumbs_status();
      const info = $("lib-maps-info");
      if (st.running) {
        if (info) {
          const pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
          info.innerHTML = `<div class="lib-progress"><i style="width:${pct}%"></i></div>
            <div class="lib-progress-txt">${st.done || 0} / ${st.total || "?"} · ${esc(st.current || "")}</div>`;
        }
        pollMapThumbs();
      } else {
        const b = $("lib-maps"); if (b) b.disabled = false;
        const s = $("lib-maps-stop"); if (s) s.hidden = true;
        if (info) {
          const r = st.result || st;
          info.innerHTML = st.error
            ? `<div class="lib-warn">${esc(st.error)}</div>`
            : `<div class="lib-scan-done">${T("library.map_thumbs_done2", "Kartenbilder geladen:")} ${r.ok || 0}` +
              `${st.pending ? ` · ${st.pending} ${T("library.map_thumbs_left", "offen")}` : ""}</div>`;
        }
        await reload();
      }
    }, 500);
  }

  // ── Listen für Fehler + Doppelte ──────────────────────────────────────
  async function showErrors() {
    const res = await api().library_errors();
    const items = (res && res.items) || [];
    openModal({
      title: T("library.unreadable", "Datei(en) nicht lesbar"),
      body: `<div class="lib-dupes">${items.length
        ? items.map(i => `<div class="lib-dupe-group">
             <div class="lib-dupe-item">${esc(i.filename)}</div>
             <div class="lib-dupe-head">${esc(i.error || "")}</div></div>`).join("")
        : `<p>${T("library.no_errors", "Alle Dateien konnten gelesen werden.")}</p>`}</div>`,
    });
  }

  // Doppelte finden UND gleich wegräumen (Wunsch Beta-Tester: „Doppelte finden
  // ist schön, gleich löschen noch schöner"). Bewusst mit Auswahl statt einem
  // „alle weg"-Knopf: welche der drei gleichen Dateien bleiben soll, weiß nur
  // der Nutzer. Vorbelegt ist die **erste** jeder Gruppe zum Behalten — das ist
  // die zuerst eingelesene. Und es geht in den **Papierkorb**, nicht ins Nichts.
  async function showDuplicates() {
    const res = await api().library_duplicates();
    const groups = (res && res.groups) || [];
    if (!groups.length) {
      openModal({ title: T("library.duplicates", "Doppelte finden"),
        body: `<p>${T("library.no_duplicates", "Keine doppelten Touren gefunden.")}</p>` });
      return;
    }
    const zeile = (i, gi, ii) => `
      <label class="lib-dupe-item lib-dupe-pick">
        <input type="checkbox" class="lib-dupe-cb" data-path="${esc(i.path)}"
               ${ii === 0 ? "" : "checked"}>
        <span class="lib-dupe-name">${esc(i.filename)}</span>
        ${ii === 0 ? `<span class="lib-dupe-keep">${T("library.dupe_first", "älteste Datei")}</span>` : ""}
      </label>`;
    openModal({
      title: T("library.duplicates", "Doppelte finden"),
      body: `<div class="lib-dupes">
        <p class="lib-dupe-intro">${T("library.dupe_intro",
          "Angehakt wird weggeräumt — in den Papierkorb, nicht endgültig gelöscht. Vorbelegt ist die älteste Datei jeder Gruppe zum Behalten.")}</p>
        ${groups.map((g, gi) => `<div class="lib-dupe-group">
            <div class="lib-dupe-head">${g.n} ${T("library.same_route", "Dateien mit identischem Verlauf")}</div>
            ${g.items.map((i, ii) => zeile(i, gi, ii)).join("")}</div>`).join("")}
        <div class="lib-dupe-actions">
          <button class="btn btn-danger" id="lib-dupe-go" type="button">
            ${T("library.dupe_trash", "Angehakte in den Papierkorb")}
            <span id="lib-dupe-n"></span>
          </button>
          <span id="lib-dupe-status" class="lib-dupe-status"></span>
        </div>
      </div>`,
    });

    const boxen = () => Array.from(document.querySelectorAll(".lib-dupe-cb"));
    const zaehlen = () => {
      const n = boxen().filter(b => b.checked).length;
      const el = document.getElementById("lib-dupe-n");
      const btn = document.getElementById("lib-dupe-go");
      if (el) el.textContent = n ? `(${n})` : "";
      if (btn) btn.disabled = n === 0;
    };
    boxen().forEach(b => b.addEventListener("change", zaehlen));
    zaehlen();

    const go = document.getElementById("lib-dupe-go");
    if (go) go.onclick = async () => {
      const pfade = boxen().filter(b => b.checked).map(b => b.dataset.path);
      if (!pfade.length) return;
      go.disabled = true;
      const status = document.getElementById("lib-dupe-status");
      let weg = 0, fehler = 0;
      for (const pfad of pfade) {
        if (status) status.textContent = `${weg + fehler + 1} / ${pfade.length}`;
        try {
          const r = await api().library_trash(pfad);
          if (r && r.ok) { weg++; } else { fehler++; }
        } catch (_) { fehler++; }
      }
      if (status) {
        status.textContent = fehler
          ? T("library.dupe_done_err", "{n} weggeräumt, {f} nicht")
              .replace("{n}", weg).replace("{f}", fehler)
          : T("library.dupe_done", "{n} in den Papierkorb gelegt").replace("{n}", weg);
      }
      applog("info", `[Archiv] Doppelte weggeräumt: ${weg} ok, ${fehler} Fehler`);
      reload();
    };
  }

  // ── Ereignisse ────────────────────────────────────────────────────────
  $("lib-search").oninput = debounce(() => { state.search = $("lib-search").value; reload(); }, 250);
  $("lib-year").onchange = () => { state.year = parseInt($("lib-year").value, 10) || 0; reload(); };
  $("lib-act").onchange = () => { state.activity = $("lib-act").value; reload(); };
  $("lib-sort").onchange = () => { state.sort = $("lib-sort").value; reload(); };
  $("lib-reset").onclick = () => {
    state.search = ""; state.year = 0; state.activity = ""; state.sort = "date_desc";
    $("lib-search").value = "";
    reload();
  };
  $("lib-folders-btn").onclick = openFoldersModal;
  $("lib-dupes").onclick = showDuplicates;
  $("lib-col-new").onclick = () => addToCollectionDialog([]);
  document.querySelectorAll(".lib-view").forEach(b => {
    b.onclick = () => {
      if (view === b.dataset.view) return;
      view = b.dataset.view; store.set("view", view);
      // Karte braucht den Streckenverlauf, Kacheln die Bilder, Statistik alles —
      // die Abfrage unterscheidet sich, also neu laden.
      reload();
    };
  });
  if (headerActions) headerActions.innerHTML = "";

  // ── Start ─────────────────────────────────────────────────────────────
  (async () => {
    await reloadFolders();
    await reloadCollections();
    await reload();
    renderDetail();
  })();

  /** Beobachtet den Hintergrundlauf und zieht die Ansicht nach, während die
   *  Bilder eintröpfeln — sonst müsste man das Modul neu öffnen, um etwas zu
   *  sehen. Bewusst selten (alle 5 s Status, alle 20 s die Liste). */
  async function watchAutoThumbs() {
    let st = null;
    try { st = await api().library_map_thumbs_status(); } catch (_) { return; }
    if (_unmounted) return;
    const wasRunning = !!_autoThumbs;
    _autoThumbs = (st && st.running) ? st : null;
    if (_autoThumbs) {
      renderHead();
      if (++_autoTick % 4 === 0) reload();
    } else if (wasRunning) {
      _autoTick = 0;
      reload();
    }
  }
  _autoWatch = setInterval(watchAutoThumbs, 5000);
  watchAutoThumbs();

  return function cleanup() {
    _unmounted = true;
    clearTimeout(_scanTimer);
    clearTimeout(_mapsTimer);
    clearInterval(_autoWatch);
    closeMapPopup();
    if (_map) { try { _map.remove(); } catch (_) {} _map = null; _mapReady = false; }
    try { delete window.__libMap; } catch (_) { window.__libMap = null; }
    body.classList.remove("lib-mode");
  };
}
