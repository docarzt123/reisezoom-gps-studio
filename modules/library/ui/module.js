/* Tour-Archiv (v0.9.487) — der durchsuchbare Katalog aller Touren.
 *
 * Idee: Das Archiv ist die bessere Variante des Datei-Dialogs. Ein Klick auf
 * eine Tour macht exakt das, was sonst nach „Datei wählen" passiert — er ruft
 * `loadGlobalGpx(pfad)`. Deshalb braucht kein anderes Modul etwas davon zu
 * wissen; sie bekommen den Track über denselben Weg wie bisher.
 *
 * Aufbau (v0.9.487, Marc-Feedback): Filterleiste **über** den Touren, darunter
 * die gewählte Ansicht — Kacheln, Liste oder Karte. Rechts die Detailspalte.
 * Die Ordner-Verwaltung sitzt in einem Modal, weil man sie einmal einrichtet
 * und danach nie wieder braucht.
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
  let _items = [];
  let _total = 0;
  let _sel = null;
  let _stats = null;
  let _folders = [];
  let _scanTimer = null;
  let _mapsTimer = null;
  let _unmounted = false;
  let _map = null;            // Kartenansicht (nur solange sie sichtbar ist)
  let _mapReady = false;
  let _mapPopup = null;       // Info-Karte an der angeklickten Tour
  let _mapLib = null;         // mapboxgl oder maplibregl (für Popup-Konstruktor)

  // Farben der Übersichtskarte. Magenta statt Orange, weil die Karte selbst
  // orange Straßen und beige Flächen hat — darauf verschwand der Track. Magenta
  // kommt auf einer Outdoor-Karte praktisch nicht vor.
  const TRACK_COLOR = "#e5007d";
  const FAV_COLOR = "#ffb300";
  const SEL_COLOR = "#ff6b35";   // Auswahl in der Hausfarbe, mit weißer Kontur

  const PAGE = 200;
  const state = {
    search: "", year: 0, activity: "", fav_only: false, planned: null,
    sort: "date_desc", offset: 0, collection_id: 0,
  };
  let _collections = [];
  // Ansicht merken wir uns über Modulwechsel hinweg — sonst landet man nach
  // jedem Ausflug in den Animator wieder in den Kacheln.
  let view = (function () {
    try { return localStorage.getItem("rz.library.view") || "cards"; } catch (_) { return "cards"; }
  })();

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

  body.classList.add("lib-mode");

  body.innerHTML = `
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
        </select>
        <button class="lib-chip" id="lib-fav" type="button">★ ${T("library.fav_only", "Nur Favoriten")}</button>
        <button class="lib-chip" id="lib-recorded" type="button">${T("library.recorded_short2", "Nur gemachte")}</button>
        <select id="lib-col" class="lib-select"></select>
        <button class="lib-chip lib-chip-ghost" id="lib-reset" type="button">${T("library.reset", "Filter zurücksetzen")}</button>

        <span class="lib-bar-spacer"></span>

        <div class="lib-bar-right">
          <div class="lib-views" role="group">
            <button class="lib-view" data-view="cards" type="button" title="${T("library.view_cards", "Kacheln")}">▦</button>
            <button class="lib-view" data-view="list" type="button" title="${T("library.view_list", "Liste")}">☰</button>
            <button class="lib-view" data-view="map" type="button" title="${T("library.view_map", "Karte")}">🌍</button>
          </div>
          <button class="lib-chip lib-chip-ghost" id="lib-folders-btn" type="button">${T("library.folders_btn", "Ordner & Einlesen")}</button>
          <button class="lib-chip lib-chip-ghost" id="lib-dupes" type="button">${T("library.duplicates", "Doppelte finden")}</button>
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
      </div>
    </section>

    <aside class="panel lib-detail" id="lib-panel"></aside>
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
    const params = Object.assign({}, state, {
      limit: view === "map" ? 0 : PAGE,
      with_thumbs: view !== "map",
      with_geom: view === "map",
    });
    if (!params.year) delete params.year;
    if (params.planned === null) delete params.planned;
    if (!params.activity) delete params.activity;
    if (!params.collection_id) delete params.collection_id;
    const res = await api().library_query(params);
    if (_unmounted) return;
    if (!res.ok) { toast(res.error || "Archiv-Abfrage fehlgeschlagen", "error"); return; }
    _items = res.items || [];
    _total = res.total || 0;
    renderHead();
    renderView();
  }

  async function reloadStats() {
    _stats = await api().library_stats();
    if (_unmounted) return;
    fillYearOptions();
    fillActivityOptions();
    renderHead();
  }

  async function reloadCollections() {
    const res = await api().library_collections();
    if (_unmounted) return;
    _collections = (res && res.collections) || [];
    fillCollectionOptions();
  }

  function fillCollectionOptions() {
    const sel = $("lib-col");
    if (!sel) return;
    sel.innerHTML =
      `<option value="0">${T("library.all_collections", "Alle Sammlungen")}</option>` +
      _collections.map(c =>
        `<option value="${c.id}"${state.collection_id === c.id ? " selected" : ""}>${esc(c.name)} (${c.n})</option>`).join("") +
      `<option value="-1">${T("library.manage_collections", "Sammlungen verwalten …")}</option>`;
  }

  async function reloadFolders() {
    const res = await api().library_folders();
    if (_unmounted) return;
    _folders = (res && res.folders) || [];
  }

  // ── Kopfzeile ─────────────────────────────────────────────────────────
  function renderHead() {
    const s = _stats || {};
    const filtered = s.n_tracks && _total < s.n_tracks;
    $("lib-head").innerHTML = `
      <span class="lib-head-count">${_total} ${T("library.tours", "Touren")}</span>
      ${filtered ? `<span class="lib-head-sub">${T("library.of_total", "von")} ${s.n_tracks}</span>` : ""}
      ${s.total_km ? `<span class="lib-head-sub">· ${Math.round(s.total_km).toLocaleString()} km
        · ${Math.round(s.total_ascent_m).toLocaleString()} ${T("library.ascent", "Höhenmeter")}
        · ${Math.round(s.total_hours).toLocaleString()} ${T("library.hours", "Stunden")}</span>` : ""}
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
      acts.map(a =>
        `<option value="${esc(a.activity)}"${state.activity === a.activity ? " selected" : ""}>${esc(ACT_LABELS[a.activity] || a.activity)} (${a.n})</option>`).join("");
  }

  // ── Ansichten ─────────────────────────────────────────────────────────
  function renderView() {
    document.querySelectorAll(".lib-view").forEach(b =>
      b.classList.toggle("is-on", b.dataset.view === view));
    $("lib-grid").hidden = view !== "cards";
    $("lib-list").hidden = view !== "list";
    $("lib-mapwrap").hidden = view !== "map";
    if (view === "cards") renderGrid();
    else if (view === "list") renderList();
    else {
      renderMap();
      applyMapSelection();
      // Wer in Liste/Kacheln etwas ausgewählt hatte, sieht es hier gleich wieder.
      if (_sel && _sel.geom && _sel.geom.length && _mapReady) {
        const mid = _sel.geom[Math.floor(_sel.geom.length / 2)];
        showMapPopup(_sel, { lng: mid[0], lat: mid[1] });
      }
    }
  }

  function emptyHtml() {
    return `
      <div class="lib-empty">
        <div class="lib-empty-title">${_folders.length
          ? T("library.empty_filter", "Keine Tour passt zu diesen Filtern.")
          : T("library.empty_start", "Das Archiv ist noch leer.")}</div>
        <div class="lib-empty-text">${_folders.length
          ? T("library.empty_filter_hint", "Filter zurücksetzen oder neu einlesen.")
          : T("library.empty_start_hint", "Füge links den Ordner hinzu, in dem deine Tracks liegen — die App liest ihn dann ein.")}</div>
      </div>`;
  }

  function badges(it) {
    return `
      ${it.fav ? `<span class="lib-badge lib-badge-fav">★</span>` : ""}
      ${it.planned ? `<span class="lib-badge lib-badge-plan">${T("library.planned", "geplant")}</span>` : ""}
      ${it.has_session ? `<span class="lib-badge lib-badge-proj" title="${esc(T("library.has_project", "Für diese Tour gibt es gespeicherte Projekte"))}">●</span>` : ""}`;
  }

  function renderGrid() {
    if (!_items.length) { grid.innerHTML = emptyHtml(); return; }
    grid.innerHTML = _items.map((it, i) => `
      <button class="lib-card${_sel && _sel.path === it.path ? " is-sel" : ""}" data-i="${i}" type="button">
        <span class="lib-card-thumb">
          ${it.thumb_url ? `<img src="${it.thumb_url}" alt="" loading="lazy">` : `<span class="lib-card-nothumb">?</span>`}
          ${badges(it)}
        </span>
        <span class="lib-card-name">${esc(it.name || it.filename)}</span>
        <span class="lib-card-meta">
          <span>${fmtDate(it.started_at)}</span>
          <span>${fmtKmVal(it.distance_m || 0)}</span>
          <span>↑ ${Math.round(it.ascent_m || 0)} m</span>
        </span>
      </button>
    `).join("");
    bindItemClicks(grid);
  }

  function renderList() {
    const box = $("lib-list");
    if (!_items.length) { box.innerHTML = emptyHtml(); return; }
    box.innerHTML = `
      <div class="lib-row lib-row-head">
        <span></span>
        <span>${T("library.name", "Name")}</span>
        <span>${T("library.date", "Datum")}</span>
        <span>${T("library.distance", "Strecke")}</span>
        <span>${T("library.ascent", "Höhenmeter")}</span>
        <span>${T("library.duration", "Dauer")}</span>
        <span>${T("library.activity", "Fortbewegung")}</span>
      </div>
      ${_items.map((it, i) => `
        <button class="lib-row${_sel && _sel.path === it.path ? " is-sel" : ""}" data-i="${i}" type="button">
          <span class="lib-row-thumb">${it.thumb_url ? `<img src="${it.thumb_url}" alt="" loading="lazy">` : ""}</span>
          <span class="lib-row-name">${it.fav ? "★ " : ""}${esc(it.name || it.filename)}
            ${it.planned ? `<i class="lib-row-tag">${T("library.planned", "geplant")}</i>` : ""}
            ${it.has_session ? `<i class="lib-row-tag lib-row-tag-proj">●</i>` : ""}</span>
          <span>${fmtDate(it.started_at)}</span>
          <span>${fmtKmVal(it.distance_m || 0)}</span>
          <span>↑ ${Math.round(it.ascent_m || 0)} m</span>
          <span>${it.duration_s ? fmtDurVal(it.duration_s) : "—"}</span>
          <span>${esc(ACT_LABELS[it.activity] || it.activity || "—")}</span>
        </button>`).join("")}
    `;
    bindItemClicks(box);
  }

  function bindItemClicks(root) {
    root.querySelectorAll("[data-i]").forEach(btn => {
      btn.onclick = () => select(_items[parseInt(btn.dataset.i, 10)]);
      btn.ondblclick = () => openIn("animator");
    });
  }

  /** Übersichtskarte: alle gefilterten Touren als Linien, Klick wählt aus.
   *  Gezeichnet wird der beim Einlesen abgelegte, ausgedünnte Streckenverlauf —
   *  700 GPX-Dateien zur Anzeige zu öffnen wäre nicht machbar. */
  function renderMap() {
    const hint = $("lib-map-hint");
    const feats = _items
      .filter(it => it.geom && it.geom.length > 1)
      .map((it, i) => ({
        type: "Feature",
        properties: { i, path: it.path, name: it.name || it.filename, fav: it.fav ? 1 : 0 },
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
    if (_map) return;   // Karte baut gerade noch auf

    const created = createMap({
      container: "lib-map",
      mapboxStyle: "mapbox://styles/mapbox/outdoors-v12",
      common: { center: [10, 51], zoom: 3, attributionControl: true },
    });
    _map = created.map;
    _mapLib = created.lib;
    // Für die automatischen Tests greifbar (wie in den anderen Modulen üblich):
    // nur so lässt sich die Hervorhebung der Auswahl prüfen, ohne Pixel zu raten.
    window.__libMap = _map;
    _map.addControl(new created.lib.NavigationControl({ showCompass: false }), "top-right");
    _map.on("load", () => {
      _mapReady = true;
      _map.addSource("lib-tracks", { type: "geojson", data });
      // Weit draußen sind einzelne Touren nur noch Striche von Bruchteilen
      // eines Pixels — dann übernehmen Punkte, damit man überhaupt sieht, WO
      // etwas liegt. Beim Hineinzoomen blenden sie aus und die Linien zu.
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
      // dünne Strich sonst kaum zu sehen (Marc: „sieht man kaum").
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
      // Ausgewählte Tour: liegt ÜBER allen anderen, dicker und in Weiß mit
      // orangem Kern — sonst findet man die angeklickte Linie im Gewirr nicht
      // wieder (Marc: „müssen hervorgehoben werden").
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

  /** Hebt die ausgewählte Tour auf der Karte hervor. */
  function applyMapSelection(fly) {
    if (!_map || !_mapReady) return;
    const path = _sel ? _sel.path : "";
    for (const id of ["lib-tracks-sel-halo", "lib-tracks-sel"]) {
      if (_map.getLayer(id)) _map.setFilter(id, ["==", ["get", "path"], path]);
    }
    // Alles andere zurücknehmen, damit die Auswahl wirklich heraussticht.
    if (_map.getLayer("lib-tracks-line")) {
      // Nicht zu stark zurücknehmen: die anderen Touren sollen weiter erkennbar
      // bleiben (Marc: „sieht man kaum") — es reicht, dass die Auswahl vorne liegt.
      _map.setPaintProperty("lib-tracks-line", "line-opacity", path ? 0.55 : 0.95);
    }
    if (_map.getLayer("lib-tracks-casing")) {
      _map.setPaintProperty("lib-tracks-casing", "line-opacity", path ? 0.2 : 0.35);
    }
    if (!fly || !_sel || !_sel.geom || _sel.geom.length < 2) return;
    fitAll({ features: [{ geometry: { coordinates: _sel.geom } }] });
  }

  /** Info-Karte direkt auf der Karte: Name, die wichtigsten Zahlen und die
   *  zwei Dinge, die man dort tun will — öffnen oder einer Sammlung zuordnen.
   *  Ohne das müsste man für jede angeklickte Linie nach rechts schauen. */
  function showMapPopup(it, lngLat) {
    if (!_map || !_mapLib) return;
    closeMapPopup();
    const rows = [
      [T("library.distance", "Strecke"), fmtKmVal(it.distance_m || 0)],
      [T("library.ascent", "Höhenmeter"), "↑ " + Math.round(it.ascent_m || 0) + " m"],
      [T("library.duration", "Dauer"), it.duration_s ? fmtDurVal(it.duration_s) : "—"],
    ];
    const html = `
      <div class="lib-pop">
        <div class="lib-pop-title">${esc(it.name || it.filename)}</div>
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
      </div>`;
    _mapPopup = new _mapLib.Popup({
      closeButton: true, closeOnClick: false, maxWidth: "300px", offset: 12,
      className: "lib-popup",
    }).setLngLat(lngLat).setHTML(html).addTo(_map);
    const el = _mapPopup.getElement();
    if (!el) return;
    const open = el.querySelector('[data-pop="open"]');
    if (open) open.onclick = () => openIn("animator");
    const col = el.querySelector('[data-pop="col"]');
    if (col) col.onclick = () => addToCollectionDialog([it.path]);
  }

  function closeMapPopup() {
    if (_mapPopup) { try { _mapPopup.remove(); } catch (_) {} _mapPopup = null; }
  }

  function applyMapData(data) {
    const src = _map.getSource("lib-tracks");
    if (src) { src.setData(data); fitAll(data); }
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
    try {
      _map.fitBounds([[minLon, minLat], [maxLon, maxLat]], { padding: 40, duration: 0, maxZoom: 12 });
    } catch (_) { /* leere/entartete Bounds — dann bleibt der Ausschnitt wie er ist */ }
  }

  function select(it, opts) {
    _sel = it;
    if (view === "cards") renderGrid();
    else if (view === "list") renderList();
    else applyMapSelection(opts && opts.fly);
    renderDetail();
  }

  // ── Detailspalte ──────────────────────────────────────────────────────
  function renderDetail() {
    const box = $("lib-panel");
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
      <div class="lib-cover-row">
        <button class="btn btn-ghost btn-sm" id="lib-d-cover">${T("library.set_cover", "Eigenes Bild wählen")}</button>
        ${it.cover ? `<button class="btn btn-ghost btn-sm" id="lib-d-uncover">${T("library.clear_cover", "Bild entfernen")}</button>` : ""}
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

      <div class="field-label" style="margin-top:10px;">${T("library.recorded_label", "Gemacht oder geplant?")}</div>
      <div class="lib-seg" id="lib-d-rec">
        <button type="button" data-rec="1"${it.recorded_eff ? " class='is-on'" : ""}>${T("library.recorded_yes", "Gemacht")}</button>
        <button type="button" data-rec="0"${!it.recorded_eff ? " class='is-on'" : ""}>${T("library.recorded_no", "Geplant")}</button>
        <button type="button" data-rec="auto"${it.recorded_manual ? "" : " class='is-on'"}>${T("library.recorded_auto", "Automatisch")}</button>
      </div>
      <div class="lib-hint">${recSrcText(it)}</div>

      <div class="field-label" style="margin-top:10px;">${T("library.collections", "Sammlungen")}</div>
      <div id="lib-d-cols" class="lib-colchips"></div>

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
      renderView();
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
    $("lib-d-rec").querySelectorAll("[data-rec]").forEach(b => {
      b.onclick = async () => {
        const v = b.dataset.rec === "auto" ? null : b.dataset.rec === "1";
        const res = await api().library_set_recorded(it.path, v);
        if (res && res.ok && res.track) {
          Object.assign(it, res.track);
          renderDetail(); renderView(); reloadStats();
        }
      };
    });
    renderTrackCollections(it);
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
      it.cover = "";
      it.thumb_url = res.thumb_url || "";
      renderDetail(); renderView();
    };
    $("lib-d-forget").onclick = async () => {
      await api().library_forget(it.path);
      _sel = null;
      await reload(); await reloadStats(); renderDetail();
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

  /** Touren einer Sammlung zuordnen — bestehende wählen oder neue anlegen. */
  function addToCollectionDialog(paths) {
    const list = _collections.map(c =>
      `<button class="btn btn-sm lib-colpick" data-col="${c.id}">${esc(c.name)} <i>(${c.n})</i></button>`).join("");
    const m = openModal({
      title: paths.length > 1
        ? `${paths.length} ${T("library.col_add_many", "Touren zu einer Sammlung")}`
        : T("library.col_add", "Zu Sammlung"),
      body: `
        <div class="lib-fmodal">
          <div class="lib-actions">${list || `<span class="lib-hint">${T("library.col_none", "Noch keine Sammlung angelegt.")}</span>`}</div>
          <hr class="lib-hr">
          <label class="field-label" for="lib-newcol">${T("library.col_new", "Neue Sammlung")}</label>
          <div style="display:flex; gap:6px;">
            <input type="text" id="lib-newcol" class="lib-input" placeholder="${T("library.col_new_ph", "z. B. Märkischer Landweg")}">
            <button class="btn btn-primary btn-sm" id="lib-newcol-go">${T("library.col_create", "Anlegen")}</button>
          </div>
        </div>`,
    });
    document.querySelectorAll("#modal-body .lib-colpick").forEach(b => {
      b.onclick = async () => {
        await api().library_collection_add(parseInt(b.dataset.col, 10), paths);
        await api().library_collection_sort_by_date(parseInt(b.dataset.col, 10));
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
      if (res && res.ok) await api().library_collection_sort_by_date(res.id);
      m.close(); await reloadCollections();
      if (_sel) renderTrackCollections(_sel);
      toast(T("library.col_created", "Sammlung angelegt."), "info");
    };
  }

  /** Tour in ein Werkzeug übernehmen: derselbe Weg wie „Datei wählen". */
  async function openIn(slug) {
    if (!_sel) return;
    if (!_sel.exists) { toast(T("library.file_gone", "Die Datei liegt nicht mehr an diesem Ort."), "error"); return; }
    const ok = await window.loadGlobalGpx(_sel.path);
    if (ok !== false && typeof switchMod === "function") switchMod(slug);
  }

  // ── Ordner + Einlesen (Modal) ─────────────────────────────────────────
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
            <button class="lib-folder-x" data-folder="${esc(f.path)}"
                    title="${esc(T("library.remove_folder", "Ordner nicht mehr beobachten"))}">✕</button>
          </div>`).join("")
      : `<div class="lib-empty-hint">${T("library.no_folders", "Noch kein Ordner. Füge den Ordner hinzu, in dem deine GPX-Dateien liegen.")}</div>`;
    return `
      <div class="lib-fmodal">
        <div class="lib-folders">${list}</div>
        <div class="lib-actions" style="margin-top:10px;">
          <button class="btn btn-sm" id="lib-add-folder">${T("library.add_folder", "+ Ordner hinzufügen")}</button>
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
        await reloadFolders(); await reloadStats(); await reload();
        if (_foldersModal) _foldersModal.update({ body: foldersModalHtml() });
        bindFoldersModal();
      };
    });
    const add = $("lib-add-folder");
    if (add) add.onclick = async () => {
      const res = await api().library_add_folder("");
      if (res.cancelled) return;
      if (!res.ok) { toast(res.error || "Ordner konnte nicht hinzugefügt werden", "error"); return; }
      await reloadFolders();
      if (_foldersModal) _foldersModal.update({ body: foldersModalHtml() });
      bindFoldersModal();
      startScan(false);
    };
    const scan = $("lib-scan");
    if (scan) scan.onclick = () => startScan(false);
    const maps = $("lib-maps");
    if (maps) maps.onclick = startMapThumbs;
    const stop = $("lib-maps-stop");
    if (stop) stop.onclick = () => api().library_map_thumbs_stop();
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
        await reloadStats(); await reloadFolders(); await reload();
      }
    }, 400);
  }

  async function startMapThumbs() {
    const res = await api().library_map_thumbs_start();
    if (!res.ok) {
      const info = $("lib-maps-info");
      if (info) {
        info.innerHTML = `<div class="lib-warn">${res.error === "no_token"
          ? T("library.map_thumbs_no_token", "Dafür braucht es einen Mapbox-Token — ohne bleibt es bei der Linienzeichnung.")
          : esc(res.error || "")}</div>`;
      }
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

  /** Sammlungen verwalten: umbenennen, löschen, alle Etappen übernehmen. */
  async function openCollectionsModal() {
    await reloadCollections();
    const m = openModal({
      title: T("library.collections", "Sammlungen"),
      body: collectionsModalHtml(),
    });
    bindCollectionsModal(m);
  }

  function collectionsModalHtml() {
    if (!_collections.length) {
      return `<div class="lib-fmodal"><div class="lib-hint">${T("library.col_none_hint",
        "Noch keine Sammlung. Wähle eine Tour aus und lege über „+ Zu Sammlung“ die erste an — oder filtere (z. B. nach einem Namen) und nimm alle Treffer auf einmal.")}</div>
        ${collectionsAddAllHtml()}</div>`;
    }
    return `<div class="lib-fmodal">
      ${_collections.map(c => `
        <div class="lib-colrow" data-col="${c.id}">
          <input type="text" class="lib-input lib-colname" value="${esc(c.name)}" data-id="${c.id}">
          <span class="lib-colmeta">${c.n} · ${c.total_km} km · ↑ ${c.total_ascent_m} m</span>
          <button class="btn btn-sm" data-open="${c.id}">${T("library.col_open", "Anzeigen")}</button>
          <button class="btn btn-sm" data-anim="${c.id}">${T("library.col_animator", "Alle im Animator")}</button>
          <button class="btn btn-ghost btn-sm" data-del="${c.id}">${T("library.col_delete", "Löschen")}</button>
        </div>`).join("")}
      ${collectionsAddAllHtml()}
    </div>`;
  }

  function collectionsAddAllHtml() {
    if (!_total || _total > 60) return "";
    return `<hr class="lib-hr">
      <button class="btn btn-sm" id="lib-col-addall">
        ${T("library.col_add_filtered", "Alle")} ${_total} ${T("library.col_add_filtered2", "Treffer in eine Sammlung")}
      </button>
      <div class="lib-hint">${T("library.col_add_filtered_hint", "Nimmt genau das, was gerade gefiltert angezeigt wird.")}</div>`;
  }

  function bindCollectionsModal(m) {
    const root = document.getElementById("modal-body");
    if (!root) return;
    root.querySelectorAll(".lib-colname").forEach(inp => {
      inp.onchange = async () => {
        await api().library_collection_rename(parseInt(inp.dataset.id, 10), inp.value);
        await reloadCollections();
      };
    });
    root.querySelectorAll("[data-del]").forEach(b => {
      b.onclick = async () => {
        await api().library_collection_delete(parseInt(b.dataset.del, 10));
        if (state.collection_id === parseInt(b.dataset.del, 10)) {
          state.collection_id = 0; state.sort = "date_desc"; reload();
        }
        await reloadCollections();
        m.update({ body: collectionsModalHtml() }); bindCollectionsModal(m);
      };
    });
    root.querySelectorAll("[data-open]").forEach(b => {
      b.onclick = () => {
        state.collection_id = parseInt(b.dataset.open, 10);
        state.sort = "collection";
        fillCollectionOptions();
        m.close(); reload();
      };
    });
    root.querySelectorAll("[data-anim]").forEach(b => {
      b.onclick = () => { m.close(); openCollectionInAnimator(parseInt(b.dataset.anim, 10)); };
    });
    const all = document.getElementById("lib-col-addall");
    if (all) all.onclick = () => { m.close(); addToCollectionDialog(_items.map(i => i.path)); };
  }

  /** Ganze Sammlung an den Animator übergeben — erste Tour als Haupt-Track,
   *  der Rest als zusätzliche Touren (Multi-Track kann der Animator seit
   *  v0.9.156). Genau dafür hat eine Sammlung ihre Reihenfolge. */
  async function openCollectionInAnimator(cid) {
    const res = await api().library_collection_items(cid);
    const items = (res && res.items) || [];
    if (!items.length) { toast(T("library.col_empty", "Diese Sammlung ist leer."), "warn"); return; }
    const ok = await window.loadGlobalGpx(items[0].path);
    if (ok === false) return;
    if (typeof switchMod === "function") switchMod("animator");
    if (items.length > 1 && typeof window._animAddTourByPath === "function") {
      // Nacheinander, damit jede Tour ihre Vorschau-Koordinaten bekommt.
      for (const it of items.slice(1)) {
        try { await window._animAddTourByPath(it.path); } catch (_) {}
      }
      toast(`${items.length} ${T("library.col_loaded", "Touren geladen.")}`, "info");
    }
  }

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
    openModal({ title: T("library.duplicates", "Doppelte finden"), body: `<div class="lib-dupes">${html}</div>` });
  }

  // ── Ereignisse ────────────────────────────────────────────────────────
  $("lib-search").oninput = debounce(() => { state.search = $("lib-search").value; reload(); }, 250);
  $("lib-year").onchange = () => { state.year = parseInt($("lib-year").value, 10) || 0; reload(); };
  $("lib-act").onchange = () => { state.activity = $("lib-act").value; reload(); };
  $("lib-sort").onchange = () => { state.sort = $("lib-sort").value; reload(); };
  $("lib-fav").onclick = () => {
    state.fav_only = !state.fav_only;
    $("lib-fav").classList.toggle("is-on", state.fav_only);
    reload();
  };
  $("lib-recorded").onclick = () => {
    state.planned = state.planned === false ? null : false;
    $("lib-recorded").classList.toggle("is-on", state.planned === false);
    reload();
  };
  $("lib-reset").onclick = () => {
    state.search = ""; state.year = 0; state.activity = ""; state.fav_only = false;
    state.planned = null; state.collection_id = 0; state.sort = "date_desc";
    $("lib-search").value = "";
    fillCollectionOptions();
    $("lib-fav").classList.remove("is-on");
    $("lib-recorded").classList.remove("is-on");
    fillYearOptions(); fillActivityOptions();
    reload();
  };
  $("lib-col").onchange = () => {
    const v = parseInt($("lib-col").value, 10);
    if (v === -1) { fillCollectionOptions(); openCollectionsModal(); return; }
    state.collection_id = v || 0;
    // Innerhalb einer Sammlung ist ihre eigene Reihenfolge die sinnvolle
    // Sortierung (Etappe 1, 2, 3 …) — außerhalb wieder das Datum.
    state.sort = state.collection_id ? "collection" : "date_desc";
    reload();
  };
  $("lib-folders-btn").onclick = openFoldersModal;
  document.querySelectorAll(".lib-view").forEach(b => {
    b.onclick = () => {
      if (view === b.dataset.view) return;
      view = b.dataset.view;
      try { localStorage.setItem("rz.library.view", view); } catch (_) {}
      // Die Karte braucht den Streckenverlauf, die anderen Ansichten die
      // Bilder — die Abfrage unterscheidet sich also, es wird neu geladen.
      reload();
    };
  });

  // „Doppelte finden" sitzt bewusst in der Filterleiste und NICHT im
  // Modul-Kopf: dort machte der Knopf zusammen mit einem langen Dateinamen
  // die Seite breiter als das Fenster (siehe .main { min-width: 0 }).
  $("lib-dupes").onclick = showDuplicates;
  if (headerActions) headerActions.innerHTML = "";

  // ── Start ─────────────────────────────────────────────────────────────
  (async () => {
    await reloadFolders();
    await reloadCollections();
    await reloadStats();
    await reload();
    renderDetail();
  })();

  return function cleanup() {
    _unmounted = true;
    clearTimeout(_scanTimer);
    clearTimeout(_mapsTimer);
    closeMapPopup();
    if (_map) { try { _map.remove(); } catch (_) {} _map = null; _mapReady = false; }
    try { delete window.__libMap; } catch (_) { window.__libMap = null; }
    body.classList.remove("lib-mode");
  };
}
