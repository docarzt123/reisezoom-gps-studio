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
  let _autoPlaces = null;   // läuft der Ortslauf gerade?
  // Mehrfachauswahl: Menge der gewählten Pfade. Ist mehr als eine Tour gewählt,
  // zeigt die rechte Spalte das Sammel-Panel statt der Einzel-Ansicht — Werkzeuge
  // öffnen geht dann nicht (welche Tour denn?), Eigenschaften setzen sehr wohl.
  let _multi = new Set();
  let _ankerIdx = -1;       // für Umschalt-Klick (Bereich wählen)
  let _ortAktiv = null;     // Liste zeigt gerade eine Gegend statt Textreffer
  let _ortAus = false;      // Nutzer will für diese Eingabe nur Textreffer
  let _scanTimer = null, _mapsTimer = null, _unmounted = false;
  let _map = null, _mapReady = false, _mapPopup = null, _mapLib = null;

  const store = {
    get(k, d) { try { return localStorage.getItem("rz.library." + k) || d; } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem("rz.library." + k, v); } catch (_) {} },
  };

  // „Bereich" ist die grobe Trennung links; die Filterleiste verfeinert nur noch.
  let scope = store.get("scope", "all");
  let view = store.get("view", "cards");

  /* Die Filterleiste überlebt den Modulwechsel (Beta-Tester: „Wenn man nach
   * Längste zuerst filtert, eine Datei im Animator anschaut und dann zurück
   * geht, springt er auf Neueste zuerst").
   *
   * Das Archiv wird bei jedem Betreten neu aufgebaut, `state` war also jedes Mal
   * wieder die Voreinstellung. Bereich und Ansicht lagen längst im Speicher, die
   * Filterleiste nicht — jetzt beides.
   *
   * NICHT gemerkt wird der Suchtext: Wer die App am nächsten Tag öffnet und ein
   * halbleeres Archiv sieht, sucht den Fehler im Archiv, nicht im Suchfeld. Und
   * eine gemerkte Eingabe würde beim Start eine Gegend-Abfrage auslösen.
   * `collection` ist kein echter Sortierwert, sondern die Reihenfolge INNERHALB
   * einer Sammlung — der darf hier nicht landen.
   */
  // Jede Spalte der Listenansicht in beiden Richtungen — die Kopfzeile ist
  // anklickbar (Wunsch Beta-Tester: „Wenn man in der Liste auf die einzelnen
  // Überschriften Name, Datum usw. klickt"). Muss deckungsgleich mit
  // `core/library._SORTS` bleiben, sonst fällt die Abfrage still auf
  // „Neueste zuerst" zurück und der Pfeil zeigt etwas anderes als die Liste.
  const SORTS_OK = ["name_desc", "asc_asc", "dur_asc", "speed_desc", "speed_asc",
                    "place_asc", "place_desc", "tags_asc", "tags_desc", "act_desc",
                    "date_desc", "date_asc", "dist_desc", "dist_asc",
                    "asc_desc", "dur_desc", "name_asc", "act_asc"];
  const gespeicherterSort = store.get("sort", "date_desc");
  const state = {
    search: "",
    year: parseInt(store.get("year", "0"), 10) || 0,
    activity: store.get("activity", ""),
    min_km: parseFloat(store.get("min_km", "")) || null,
    max_km: parseFloat(store.get("max_km", "")) || null,
    sort: SORTS_OK.includes(gespeicherterSort) ? gespeicherterSort : "date_desc",
    collection_id: 0,
  };

  /** Filterwert setzen und merken. */
  function setFilter(k, v) {
    state[k] = v;
    if (k === "sort" && !SORTS_OK.includes(v)) return;   // „collection" nicht merken
    store.set(k, String(v == null ? "" : v));
  }
  /** Die zuletzt gewählte echte Sortierung (ohne „collection"). */
  function gemerkterSort() {
    const s = store.get("sort", "date_desc");
    return SORTS_OK.includes(s) ? s : "date_desc";
  }
  /** Das Auswahlfeld auf den Zustand nachziehen. */
  function sortAnzeigen() {
    const sel = document.getElementById("lib-sort");
    if (sel && SORTS_OK.includes(state.sort)) sel.value = state.sort;
  }

  const ACT_LABELS = {
    wandern: T("library.act.wandern", "Wandern"),
    spaziergang: T("library.act.spaziergang", "Spaziergang"),
    laufen: T("library.act.laufen", "Laufen"),
    rad: T("library.act.rad", "Rad"),
    mtb: T("library.act.mtb", "Mountainbike"),
    rennrad: T("library.act.rennrad", "Rennrad"),
    ebike: T("library.act.ebike", "E-Bike"),
    gravel: T("library.act.gravel", "Gravel / Trekking"),
    motorrad: T("library.act.motorrad", "Motorrad"),
    auto: T("library.act.auto", "Auto"),
    boot: T("library.act.boot", "Boot"),
    ski: T("library.act.ski", "Ski"),
  };
  // Sammelposten — dieselbe Aufteilung wie in `core/library.ACT_GROUPS`.
  // ⚠️ Bei Änderungen BEIDE Seiten pflegen; der Filter rechnet im Backend,
  // die Vergleichstabelle hier.
  const ACT_GROUPS = {
    rad:  ["rad", "rennrad", "gravel", "mtb", "ebike"],
    fuss: ["wandern", "spaziergang", "laufen"],
  };
  const GROUP_LABELS = {
    rad:  T("library.act_group.rad", "Alles mit dem Rad"),
    fuss: T("library.act_group.fuss", "Alles zu Fuß"),
  };
  /** Zu welcher Gruppe gehört eine Art — oder sie selbst, wenn zu keiner. */
  const gruppeVon = (art) => {
    for (const [g, arten] of Object.entries(ACT_GROUPS)) {
      if (arten.includes(art)) return "grp:" + g;
    }
    return art;
  };
  const gruppenLabel = (schluessel) => schluessel.startsWith("grp:")
    ? GROUP_LABELS[schluessel.slice(4)] || schluessel
    : (ACT_LABELS[schluessel] || schluessel);

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
        <!-- Längen-Filter (Wunsch Beta-Tester: „Zeige mir alle Wanderungen über
             20 km in 2025"). Das Backend konnte das längst — es gab nur kein
             Feld dafür. Zusammen mit Art und Jahr ist die Frage jetzt in drei
             Handgriffen gestellt. -->
        <span class="lib-km" title="${T("library.km_range_tip", "Nur Touren in diesem Längenbereich")}">
          <input type="number" id="lib-kmmin" class="lib-kmfield" min="0" step="1"
                 placeholder="${T("library.km_from", "ab km")}">
          <span class="lib-km-dash">–</span>
          <input type="number" id="lib-kmmax" class="lib-kmfield" min="0" step="1"
                 placeholder="${T("library.km_to", "bis km")}">
        </span>
        <select id="lib-sort" class="lib-select">
          <option value="date_desc">${T("library.sort.date_desc", "Neueste zuerst")}</option>
          <option value="date_asc">${T("library.sort.date_asc", "Älteste zuerst")}</option>
          <option value="dist_desc">${T("library.sort.dist_desc", "Längste zuerst")}</option>
          <option value="dist_asc">${T("library.sort.dist_asc", "Kürzeste zuerst")}</option>
          <option value="asc_desc">${T("library.sort.asc_desc", "Meiste Höhenmeter")}</option>
          <option value="dur_desc">${T("library.sort.dur_desc", "Längste Dauer")}</option>
          <option value="name_asc">${T("library.sort.name_asc", "Name A–Z")}</option>
          <option value="name_desc">${T("library.sort.name_desc", "Name Z–A")}</option>
          <option value="dur_asc">${T("library.sort.dur_asc", "Kürzeste Dauer")}</option>
          <option value="asc_asc">${T("library.sort.asc_asc", "Wenigste Höhenmeter")}</option>
          <option value="speed_desc">${T("library.sort.speed_desc", "Schnellste zuerst")}</option>
          <option value="speed_asc">${T("library.sort.speed_asc", "Langsamste zuerst")}</option>
          <option value="place_asc">${T("library.sort.place_asc", "Startpunkt A–Z")}</option>
          <option value="tags_asc">${T("library.sort.tags_asc", "Schlagwort A–Z")}</option>
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
          <!-- Beides liegt AUF der Karte, nicht darunter: ein Balken darunter
               nimmt der Karte Höhe weg, und die ist hier das Wichtigste. -->
          <div class="lib-map-hint" id="lib-map-hint"></div>
          <button class="lib-map-png" id="lib-map-png" type="button"
                  title="${T("library.map_png", "Karte als PNG sichern")}">
            🖼 <span>${T("library.map_png_short", "PNG")}</span></button>
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
  // Zahlen in der Sprache der OBERFLÄCHE, nicht in der des Systems. Genau das
  // war bei `fmtDate` schon einmal ein Fund: Sonst steht in der deutschen
  // Oberfläche „1,200 km" (englische Schreibweise), weil macOS auf Englisch
  // läuft — oder umgekehrt „1.200" in der englischen.
  const num = (n) => {
    let loc;
    try { loc = (typeof i18nMeta === "function") ? i18nMeta().active : null; }
    catch (_) { loc = null; }
    return Math.round(n || 0).toLocaleString(loc || undefined);
  };

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
    if (p.min_km == null) delete p.min_km;
    if (p.max_km == null) delete p.max_km;
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
    if (p.min_km == null) delete p.min_km;
    if (p.max_km == null) delete p.max_km;
    if (!p.search) delete p.search;
    return p;
  }

  // ── Laden ─────────────────────────────────────────────────────────────

  /* Nachladen beim Scrollen (Wunsch Beta-Tester, 4787 Touren):
   * Kacheln und Liste holen die erste Seite (PAGE) und hängen beim Scrollen
   * weitere an — vorher war nach 200 einfach Schluss, ohne Hinweis, und an den
   * Rest kam man nur über Filter. Karte und Statistik laden weiter alles auf
   * einmal, die haben keine Seiten. */
  let _hatMehr = false;      // es gibt noch nicht geladene Treffer
  let _laedtMehr = false;    // eine Nachlade-Abfrage läuft gerade

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
    _ortAktiv = null;

    // Die Suche andersherum: Der Begriff wird zusätzlich als ORT nachgeschlagen,
    // und was in der Gegend liegt, wird **direkt gezeigt**.
    //
    // Zwei Anläufe waren nötig. Erst sprang die Ortssuche nur an, wenn die
    // Textsuche leer blieb — falsch, denn „Teneriffa" trifft über den Dateinamen
    // 8 Touren, und die 163 auf der Insel blieben unsichtbar. Dann stand sie als
    // Angebot daneben, das man erst anklicken musste — auch falsch: wer
    // „Teneriffa" eintippt, will die Touren von Teneriffa sehen, nicht ein
    // Angebot. Jetzt zeigt die Liste die Gegend; der Hinweis oben sagt, dass es
    // die Gegend ist, und schaltet auf Wunsch zurück auf reine Textsuche.
    if (!_ortAus && (state.search || "").trim().length >= 3) {
      const ort = await api().library_search_place(state.search.trim(), queryParams({
        limit: (view === "map" || view === "stats") ? 0 : PAGE,
        with_thumbs: view === "cards" || view === "list",
        with_geom: view === "map",
        search: "",
      }));
      if (_unmounted) return;
      // Nur übernehmen, wenn die Gegend MEHR liefert als der Text — sonst zeigt
      // „wanderung" die eine Tour bei einem Ort, der wirklich Wanderung heißt.
      if (ort && ort.ok && ort.found && (ort.total || 0) > _total) {
        _ortAktiv = { name: ort.place, total: ort.total, textTreffer: _total,
                      bbox: ort.bbox };
        _items = ort.items || [];
        _total = ort.total || 0;
      }
    }
    // Wer den Bereich wechselt, soll rechts nicht die Tour von vorhin sehen —
    // die steht dann in keiner Liste mehr und wirkt wie ein Geist.
    if (_sel && !_items.some(i => i.path === _sel.path)) _sel = null;
    // Beim Betreten des Moduls die zuletzt gewählte Tour zurückholen — aber nur,
    // wenn sie in der aktuellen Liste auch wirklich steht. Sonst zeigte die
    // Detailspalte eine Tour, zu der es keine sichtbare Kachel gibt.
    if (!_sel && !_multi.size) {
      const gemerkt = store.get("sel", "");
      if (gemerkt) {
        const treffer = _items.find(i => i.path === gemerkt);
        if (treffer) _sel = treffer;
      }
    }
    // Nach dem Gegend-Zweig rechnen, nicht davor — der tauscht _items/_total aus.
    _hatMehr = (view === "cards" || view === "list") && _items.length < _total;
    _laedtMehr = false;
    await reloadStats();
    renderHead();
    renderView();
    renderDetail();
  }

  /** Die nächste Seite holen und ANHÄNGEN — mit denselben Filtern wie die
   *  Liste, einschließlich einer aktiven Gegend-Suche (bbox statt Text). */
  async function nachladen() {
    if (!_hatMehr || _laedtMehr || _unmounted) return;
    if (view !== "cards" && view !== "list") return;
    _laedtMehr = true;
    const ort = _ortAktiv ? { search: "", bbox: _ortAktiv.bbox } : {};
    const res = await api().library_query(queryParams(Object.assign({
      limit: PAGE, offset: _items.length, with_thumbs: true,
    }, ort)));
    _laedtMehr = false;
    if (_unmounted || !res || !res.ok) return;
    const neu = res.items || [];
    if (!neu.length) { _hatMehr = false; return; }
    const start = _items.length;
    _items = _items.concat(neu);
    _hatMehr = _items.length < (res.total || _total);
    // Nur die neuen anhängen — ein voller Neuaufbau würde bei ein paar tausend
    // Kacheln mit jedem Nachladen teurer und ließe laufende Bild-Ladevorgänge
    // neu beginnen.
    if (view === "cards") {
      grid.insertAdjacentHTML("beforeend",
        neu.map((it, k) => cardHtml(it, start + k)).join(""));
      bindItemClicks(grid);
    } else {
      $("lib-list").insertAdjacentHTML("beforeend",
        neu.map((it, k) => rowHtml(it, start + k)).join(""));
      bindItemClicks($("lib-list"));
    }
  }

  /** Kurz vor dem Ende der Scrollbahn die nächste Seite anstoßen. */
  function scrollNachladen(el) {
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 600) nachladen();
  }

  async function reloadStats() {
    // ⚠️ Zeigt die Liste eine Gegend, muss die Statistik dieselbe Gegend meinen.
    // Erste Fassung ließ sie auf der Textsuche stehen: die Kacheln zeigten 89
    // Touren, die Seitenleiste behauptete 4, und die Kilometer daneben gehörten
    // zu den 4. Gemeldet mit Bildschirmfoto — und es sah aus wie ein Zählfehler,
    // war aber schlicht eine zweite, andere Abfrage.
    const ortFilter = _ortAktiv ? { search: "", bbox: _ortAktiv.bbox } : {};
    const [s, base] = await Promise.all([
      api().library_stats(queryParams(ortFilter)),
      api().library_stats(Object.assign(baseParams(), ortFilter)),
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
        // Beim Verlassen einer Sammlung zurück auf die gemerkte Sortierung,
        // nicht stumpf auf „Neueste zuerst".
        state.sort = state.collection_id ? "collection" : gemerkterSort();
        sortAnzeigen();
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
      ${_ortAktiv ? `<button class="lib-head-ort is-on" id="lib-ort-aus" type="button" title="${T("library.area_off", "Nur Treffer im Text zeigen")}">📍 ${T("library.found_area", "Gegend")}: <b>${esc(_ortAktiv.name.split(",")[0])}</b> — ${_total} ${T("library.tours_here", "Touren hier")}${_ortAktiv.textTreffer ? ` · ${_ortAktiv.textTreffer} ${T("library.by_name", "über den Namen")}` : ""} ✕</button>` : ""}
      ${_autoPlaces ? `<span class="lib-head-auto">📍 ${T("library.places_auto", "Gegenden werden benannt")} ${_autoPlaces.done || 0}/${_autoPlaces.total || "?"}</span>` : ""}
      ${s.n_failed ? `<button class="lib-head-warn${s.n_nogps === s.n_failed ? " is-calm" : ""}" id="lib-show-errors">${s.n_failed} ${
        // Ist ALLES nur „ohne Koordinaten" (Rolle, Halle, Kraftraum), dann ist
        // nichts kaputt — dann darf hier auch nicht „nicht lesbar" stehen.
        s.n_nogps === s.n_failed
          ? T("library.no_track_n", "Datei(en) ohne Strecke")
          : T("library.unreadable", "Datei(en) nicht lesbar")}</button>` : ""}
    `;
    const eb = $("lib-show-errors");
    // Nicht `= showErrors`: dann käme das Klick-Ereignis als erstes Argument an
    // und wäre als „auch weggeräumte zeigen" wahr.
    if (eb) eb.onclick = () => showErrors(false);
    const aus = $("lib-ort-aus");
    if (aus) aus.onclick = () => { _ortAus = true; reload(); };
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
      // Sammelposten zuerst, und nur wenn mindestens zwei Arten der Gruppe
      // wirklich vorkommen — bei jemandem mit nur einem Rad wäre „Alles mit dem
      // Rad" eine Zeile, die nichts zusätzlich beantwortet.
      Object.entries(ACT_GROUPS).map(([g, arten]) => {
        const treffer = acts.filter(a => arten.includes(a.activity));
        if (treffer.length < 2) return "";
        const n = treffer.reduce((x, a) => x + (a.n || 0), 0);
        const wert = "grp:" + g;
        return `<option value="${wert}"${state.activity === wert ? " selected" : ""}>${
          esc(GROUP_LABELS[g])} (${n})</option>`;
      }).join("") +
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

  // Karten- und Zeilen-HTML als Helfer: Voll-Render und Nachladen (Anhängen)
  // müssen exakt dasselbe erzeugen, sonst sehen nachgeladene Kacheln anders aus.
  function cardHtml(it, i) {
    return `
      <button class="lib-card${_multi.has(it.path) ? " is-multi" : (_sel && _sel.path === it.path ? " is-sel" : "")}" data-i="${i}" type="button">
        <span class="lib-card-thumb">
          ${it.thumb_url ? `<img src="${it.thumb_url}" alt="" loading="lazy">` : `<span class="lib-card-nothumb">?</span>`}
          ${badges(it)}
        </span>
        <span class="lib-card-name">${esc(it.name)}</span>
        <span class="lib-card-meta">
          <span>${fmtDate(it.started_at)}</span><span>${fmtKmVal(it.distance_m || 0)}</span><span>↑ ${num(it.ascent_m)} m</span>
        </span>
      </button>`;
  }

  /* Die Spalten der Listenansicht. `sort` ist das Grundwort der Sortierung,
   * `ab` die Richtung des ERSTEN Klicks — bei Zahlen „viel zuerst", bei Text
   * A–Z. Ein zweiter Klick dreht um. */
  const LIST_COLS = [
    { key: "",      label: () => "" },                       // Vorschaubild
    { key: "name",  label: () => T("library.name", "Name"),           sort: "name",  ab: false },
    { key: "date",  label: () => T("library.date", "Datum"),          sort: "date",  ab: true },
    { key: "dist",  label: () => T("library.distance", "Strecke"),    sort: "dist",  ab: true },
    { key: "asc",   label: () => T("library.ascent", "Höhenmeter"),   sort: "asc",   ab: true },
    { key: "dur",   label: () => T("library.duration", "Dauer"),      sort: "dur",   ab: true },
    { key: "speed", label: () => T("library.speed", "Schnitt"),       sort: "speed", ab: true },
    { key: "act",   label: () => T("library.activity", "Fortbewegung"), sort: "act", ab: false },
    { key: "place", label: () => T("library.startpoint", "Startpunkt"), sort: "place", ab: false },
    { key: "tags",  label: () => T("library.tags", "Schlagwörter"),   sort: "tags",  ab: false },
  ];

  /** Welche Sortierung ein Klick auf diese Spalte ergibt.
   *
   * ⚠️ Erst prüfen, ob die Spalte ÜBERHAUPT die aktive ist — und nur dann
   * umdrehen. Eine Abfrage bloß auf „_desc" reichte nicht: bei den Textspalten
   * (Name, Startpunkt, Schlagwort) ist der erste Klick aufsteigend, ein zweiter
   * traf die Bedingung dann nie und die Spalte ließ sich nicht umdrehen.
   */
  function naechsteSortierung(spalte) {
    if (!spalte.sort) return null;
    const jetzt = state.sort || "";
    if (jetzt === spalte.sort + "_asc") return spalte.sort + "_desc";
    if (jetzt === spalte.sort + "_desc") return spalte.sort + "_asc";
    return spalte.sort + "_" + (spalte.ab ? "desc" : "asc");
  }

  function sortPfeil(spalte) {
    if (!spalte.sort) return "";
    if (state.sort === spalte.sort + "_desc") return " ▼";
    if (state.sort === spalte.sort + "_asc") return " ▲";
    return "";
  }

  function rowHtml(it, i) {
    return `
        <button class="lib-row${_multi.has(it.path) ? " is-multi" : (_sel && _sel.path === it.path ? " is-sel" : "")}" data-i="${i}" type="button">
          <span class="lib-row-thumb">${it.thumb_url ? `<img src="${it.thumb_url}" alt="" loading="lazy">` : ""}</span>
          <span class="lib-row-name">${it.fav ? "★ " : ""}${esc(it.name)}
            ${it.recorded_eff ? "" : `<i class="lib-row-tag">${T("library.planned", "geplant")}</i>`}
            ${it.has_session ? `<i class="lib-row-tag lib-row-tag-proj">●</i>` : ""}</span>
          <span>${fmtDate(it.started_at)}</span>
          <span>${fmtKmVal(it.distance_m || 0)}</span>
          <span>↑ ${num(it.ascent_m)} m</span>
          <span>${it.duration_s ? fmtDurVal(it.duration_s) : "—"}</span>
          <span>${it.avg_speed_kmh ? it.avg_speed_kmh.toFixed(1) + " km/h" : "—"}</span>
          <span>${esc(ACT_LABELS[it.activity] || it.activity || "—")}</span>
          <span class="lib-row-ort" title="${esc(it.startort_lang || "")}">${esc(it.startort || "—")}</span>
          <span class="lib-row-tags">${(it.tag_list || []).length
            ? (it.tag_list || []).map(x => `<i class="lib-row-tag">${esc(x)}</i>`).join("")
            : "—"}</span>
        </button>`;
  }

  function renderGrid() {
    if (!_items.length) { grid.innerHTML = emptyHtml(); bindEmpty(); return; }
    grid.innerHTML = _items.map((it, i) => cardHtml(it, i)).join("");
    bindItemClicks(grid);
  }

  function renderList() {
    const box = $("lib-list");
    if (!_items.length) { box.innerHTML = emptyHtml(); bindEmpty(); return; }
    // In einer Sammlung gilt die von Hand gelegte Reihenfolge — dort wäre eine
    // anklickbare Kopfzeile eine Falle: der erste Klick würfe die Anordnung um,
    // die jemand gerade mühsam gelegt hat.
    const sortierbar = !state.collection_id;
    box.innerHTML = `
      <div class="lib-row lib-row-head">
        ${LIST_COLS.map(c => {
          if (!sortierbar || !c.sort) return `<span>${esc(c.label())}</span>`;
          const an = sortPfeil(c);
          return `<span class="lib-th${an ? " is-sort" : ""}" data-col="${c.key}"
            role="button" tabindex="0"
            title="${esc(T("library.sort_by_head", "Nach dieser Spalte sortieren"))}"
            >${esc(c.label())}<i class="lib-th-pfeil">${an}</i></span>`;
        }).join("")}
      </div>
      ${_items.map((it, i) => rowHtml(it, i)).join("")}`;
    box.querySelectorAll("[data-col]").forEach(th => {
      const spalte = LIST_COLS.find(c => c.key === th.dataset.col);
      const um = () => {
        const neu = naechsteSortierung(spalte);
        if (!neu) return;
        state.sort = neu;
        store.set("sort", neu);
        const sel = document.getElementById("lib-sort");
        if (sel) sel.value = neu;      // Auswahlfeld und Kopfzeile bleiben einig
        reload();
      };
      th.onclick = um;
      th.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); um(); }
      };
    });
    bindItemClicks(box);
  }

  function bindItemClicks(root) {
    root.querySelectorAll("[data-i]").forEach(btn => {
      btn.onclick = (e) => {
        const i = parseInt(btn.dataset.i, 10);
        const it = _items[i];
        if (!it) return;
        if (e.metaKey || e.ctrlKey) {
          // Einzeln dazu oder weg
          if (_multi.has(it.path)) _multi.delete(it.path); else _multi.add(it.path);
          if (_multi.size) _sel = it;
          _ankerIdx = i;
        } else if (e.shiftKey && _ankerIdx >= 0) {
          // Bereich vom Anker bis hier
          const [a2, b2] = _ankerIdx < i ? [_ankerIdx, i] : [i, _ankerIdx];
          for (let k = a2; k <= b2; k++) if (_items[k]) _multi.add(_items[k].path);
          _sel = it;
        } else {
          _multi.clear();
          _ankerIdx = i;
          select(it);
          return;
        }
        renderView();
        renderDetail();
      };
      btn.ondblclick = () => { if (_multi.size <= 1) openIn("animator"); };
    });
  }

  function multiItems() {
    return _items.filter(i => _multi.has(i.path));
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

  /* Vergleich der Fortbewegungsarten über Jahre oder Monate (Wunsch
   * Beta-Tester: „Vergleichen von Fortbewegungsarten Monat mit Monat und Jahr
   * mit Jahr — wie viel km und/oder Zeit ich gewandert, gelaufen und Fahrrad
   * gefahren bin").
   *
   * Eine Tabelle, keine Balken: Beim Vergleichen liest man Zahlen ab und
   * rechnet im Kopf nach — dafür sind Balken das falsche Werkzeug. Die stärkste
   * Zelle je Zeitraum ist hervorgehoben, damit man den Verlauf trotzdem sieht,
   * ohne jede Zahl zu lesen.
   */
  let _vglEbene = store.get("vgl_ebene", "year");   // "year" | "month"
  let _vglMass  = store.get("vgl_mass", "km");      // "km" | "hours" | "n"
  // Sortierung der Vergleichstabelle. Spalte "" = Zeitraum (chronologisch),
  // sonst der Schlüssel einer Fortbewegungsart oder "sum".
  let _vglSort  = store.get("vgl_sort", { spalte: "", ab: false });
  // Spalten zusammenfassen (Wunsch Beta-Tester). Wer drei Räder getrennt führt,
  // hat sonst fünf schmale Rad-Spalten, wo eine breite die Frage beantwortet:
  // wie viel war ich überhaupt mit dem Rad unterwegs?
  let _vglGrp   = store.get("vgl_grp", false);

  /** Eine klickbare Kopfzelle der Vergleichstabelle. */
  function vglKopf(spalte, text, extra) {
    const an = _vglSort.spalte === spalte;
    const pfeil = an ? (_vglSort.ab ? " ▲" : " ▼") : "";
    return `<th class="lib-vgl-th${an ? " is-sort" : ""}${extra ? " " + extra : ""}"
      data-vgl-sort="${esc(spalte)}" role="button" tabindex="0"
      title="${esc(T("library.stat_sort_hint", "Kopfzeile anklicken zum Sortieren"))}"
      >${esc(text)}<span class="lib-vgl-pfeil">${pfeil}</span></th>`;
  }

  function vergleichHtml(s) {
    const roh = _vglEbene === "year" ? (s.act_by_year || []) : (s.act_by_month || []);
    if (!roh.length) return "";

    // Zeiträume und Arten einsammeln — beides in der Reihenfolge, in der es
    // auftritt bzw. nach Gesamtgröße.
    const zeitraeume = [];
    const proArt = new Map();
    const zellen = new Map();      // "zeitraum|art" → Wert
    for (const r of roh) {
      if (!r.activity) continue;   // ohne erkannte Art hilft der Vergleich nicht
      const z = _vglEbene === "year" ? String(r.year) : r.month;
      if (!zeitraeume.includes(z)) zeitraeume.push(z);
      const wert = r[_vglMass] || 0;
      // Beim Zusammenfassen fallen mehrere Zeilen auf dieselbe Zelle — deshalb
      // addieren statt setzen. Ohne das gewänne die zuletzt gelesene Radart und
      // der Rest verschwände lautlos.
      const spalte = _vglGrp ? gruppeVon(r.activity) : r.activity;
      const schluessel = z + "|" + spalte;
      zellen.set(schluessel, (zellen.get(schluessel) || 0) + wert);
      proArt.set(spalte, (proArt.get(spalte) || 0) + wert);
    }
    if (!zeitraeume.length) return "";

    // Nur Arten zeigen, die überhaupt vorkommen — die stärksten zuerst.
    const arten = [...proArt.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]);
    // Früher endeten die Monate nach zwei Jahren („Bei Monat werden die Monate
    // für 2 Jahre angezeigt. Auch hier wäre es schön, wenn alle Jahre
    // berücksichtigt werden."). Jetzt sind alle drin; die Tabelle scrollt.
    const sichtbar = zeitraeume.slice();
    const wertVon = (z) => _vglSort.spalte === "sum"
      ? arten.reduce((n, a) => n + (zellen.get(z + "|" + a) || 0), 0)
      : (zellen.get(z + "|" + _vglSort.spalte) || 0);
    if (_vglSort.spalte) {
      sichtbar.sort((a, b) => wertVon(b) - wertVon(a));
    }
    if (_vglSort.ab) sichtbar.reverse();

    const einheit = _vglMass === "km" ? "km" : (_vglMass === "hours" ? "h" : "×");
    const zeige = (v) => !v ? "·" : (_vglMass === "n" ? num(v) : num(Math.round(v)));
    const label = (z) => _vglEbene === "year" ? z
      : `${MONTHS[parseInt(z.slice(5, 7), 10) - 1]} ${z.slice(2, 4)}`;

    // Je Zeitraum die stärkste Art hervorheben.
    const spitze = new Map();
    for (const z of sichtbar) {
      let best = 0, wer = "";
      for (const a of arten) {
        const v = zellen.get(z + "|" + a) || 0;
        if (v > best) { best = v; wer = a; }
      }
      if (wer) spitze.set(z, wer);
    }

    const summe = (a) => sichtbar.reduce((n, z) => n + (zellen.get(z + "|" + a) || 0), 0);

    return `
      <div class="lib-chart">
        <div class="lib-chart-title">
          ${T("library.stat_compare", "Fortbewegung im Vergleich")}
          <span class="lib-vgl-schalter">
            <button type="button" class="lib-vgl-btn${_vglEbene === "year" ? " is-on" : ""}" data-vgl-ebene="year">${T("library.stat_by_year", "Jahre")}</button>
            <button type="button" class="lib-vgl-btn${_vglEbene === "month" ? " is-on" : ""}" data-vgl-ebene="month">${T("library.stat_by_month", "Monate")}</button>
            <span class="lib-vgl-sep"></span>
            <button type="button" class="lib-vgl-btn${_vglMass === "km" ? " is-on" : ""}" data-vgl-mass="km">km</button>
            <button type="button" class="lib-vgl-btn${_vglMass === "hours" ? " is-on" : ""}" data-vgl-mass="hours">${T("library.stat_hours_short", "Std.")}</button>
            <button type="button" class="lib-vgl-btn${_vglMass === "n" ? " is-on" : ""}" data-vgl-mass="n">${T("library.stat_count_short", "Anzahl")}</button>
            <span class="lib-vgl-sep"></span>
            <button type="button" class="lib-vgl-btn${_vglGrp ? " is-on" : ""}"
              id="lib-vgl-grp"
              title="${esc(T("library.stat_group_help", "Fasst alle Rad-Arten zu einer Spalte zusammen und alles zu Fuß zu einer zweiten."))}"
              >${T("library.stat_group", "Zusammenfassen")}</button>
          </span>
        </div>
        <div class="lib-vgl-scroll">
          <table class="lib-vgl">
            <thead><tr>
              ${vglKopf("", _vglEbene === "year" ? T("library.year", "Jahr") : T("library.month", "Monat"))}
              ${arten.map(a => vglKopf(a, gruppenLabel(a))).join("")}
              ${vglKopf("sum", T("library.total", "Gesamt"), "lib-vgl-sum")}
            </tr></thead>
            <tbody>
              ${sichtbar.map(z => {
                const zeilenSumme = arten.reduce((n, a) => n + (zellen.get(z + "|" + a) || 0), 0);
                return `<tr>
                  <th>${esc(label(z))}</th>
                  ${arten.map(a => {
                    const v = zellen.get(z + "|" + a) || 0;
                    return `<td class="${spitze.get(z) === a ? "is-top" : ""}${v ? "" : " is-leer"}">${zeige(v)}</td>`;
                  }).join("")}
                  <td class="lib-vgl-sum">${zeige(zeilenSumme)}</td>
                </tr>`;
              }).join("")}
            </tbody>
            <tfoot><tr>
              <th>${T("library.total", "Gesamt")}</th>
              ${arten.map(a => `<td>${zeige(summe(a))}</td>`).join("")}
              <td class="lib-vgl-sum">${zeige(arten.reduce((n, a) => n + summe(a), 0))}</td>
            </tr></tfoot>
          </table>
        </div>
        <div class="lib-chart-hint">${T("library.stat_compare_hint", "Alle Zahlen in")} ${einheit} · ${
          T("library.stat_sort_hint", "Kopfzeile anklicken zum Sortieren")}</div>
      </div>`;
  }

  /** Die häufigsten Startpunkte (Wunsch Beta-Tester). Braucht den Ortslauf —
   *  ohne ihn steht in `place` nichts, und die Tabelle bliebe leer. */
  function startorteHtml(s) {
    const liste = s.startorte || [];
    if (!liste.length) return "";
    const max = liste[0].n || 1;
    return `
      <div class="lib-chart">
        <div class="lib-chart-title">${T("library.stat_startpoints", "Häufigste Startpunkte")}</div>
        <div class="lib-acts">
          ${liste.slice(0, 12).map(o => `
            <div class="lib-act-row">
              <span>${esc(o.ort)}</span>
              <div class="lib-act-bar"><i style="width:${(o.n / max) * 100}%"></i></div>
              <b>${o.n}</b><span class="lib-act-km">${num(o.km)} km</span>
            </div>`).join("")}
        </div>
      </div>`;
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

        ${vergleichHtml(s)}

        ${startorteHtml(s)}

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
    // Umschalter der Vergleichs-Tabelle. Die Wahl wird gemerkt — wer nach
    // Stunden vergleicht, will das beim nächsten Öffnen meist wieder.
    box.querySelectorAll("[data-vgl-ebene]").forEach(b => {
      b.onclick = () => {
        _vglEbene = b.dataset.vglEbene;
        store.set("vgl_ebene", _vglEbene);
        renderStats();
      };
    });
    {
      const g = document.getElementById("lib-vgl-grp");
      if (g) g.onclick = () => {
        _vglGrp = !_vglGrp;
        store.set("vgl_grp", _vglGrp);
        // Die Sortierung zeigte womöglich auf eine Spalte, die es jetzt nicht
        // mehr gibt („Rennrad" nach dem Zusammenfassen) — dann zurück auf
        // chronologisch, statt still nach etwas Verschwundenem zu sortieren.
        if (_vglSort.spalte && _vglSort.spalte !== "sum") {
          _vglSort = { spalte: "", ab: false };
          store.set("vgl_sort", _vglSort);
        }
        renderStats();
      };
    }
    box.querySelectorAll("[data-vgl-mass]").forEach(b => {
      b.onclick = () => {
        _vglMass = b.dataset.vglMass;
        store.set("vgl_mass", _vglMass);
        renderStats();
      };
    });
    // Sortieren per Kopfzeile: erst Klick = diese Spalte, nochmal = umdrehen.
    box.querySelectorAll("[data-vgl-sort]").forEach(th => {
      const um = () => {
        const sp = th.dataset.vglSort;
        _vglSort = (_vglSort.spalte === sp)
          ? { spalte: sp, ab: !_vglSort.ab }
          : { spalte: sp, ab: false };
        store.set("vgl_sort", _vglSort);
        renderStats();
      };
      th.onclick = um;
      th.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); um(); }
      };
    });
    box.querySelectorAll("[data-top]").forEach(b => {
      b.onclick = () => {
        const it = (s.longest || [])[parseInt(b.dataset.top, 10)];
        if (it) select(_items.find(x => x.path === it.path) || it);
      };
    });
  }

  // ── Karte ─────────────────────────────────────────────────────────────
  // Farben für die Übersichtskarte. Ohne Variation liegen bei 700 Touren alle
  // Linien in derselben Farbe übereinander und man erkennt keine einzelne mehr.
  // Die Farbe wird aus dem Streckenhash abgeleitet: gleich bleibend über
  // Sitzungen hinweg (keine springenden Farben beim Neuladen) und ohne dass
  // jemand sie pflegen muss. Eine eigene Farbe an der Tour schlägt sie.
  const MAP_PALETTE = [
    "#ff8a3d", "#4ea8ff", "#57d18a", "#ffd166", "#c792ea",
    "#ff6b9d", "#4fd6d2", "#f4845f", "#9ccc65", "#7aa2f7",
    "#ef9fbc", "#5bc8af",
  ];
  function autoColor(it) {
    const q = String(it.geo_hash || it.path || "");
    let h = 0;
    for (let i = 0; i < q.length; i++) h = (h * 31 + q.charCodeAt(i)) >>> 0;
    return MAP_PALETTE[h % MAP_PALETTE.length];
  }
  function trackColor(it) {
    return (it.color && /^#[0-9a-f]{6}$/i.test(it.color)) ? it.color : autoColor(it);
  }

  /** Die Karte als Bild sichern — WYSIWYG, also genau der Ausschnitt, die
   *  Zoomstufe und die Farben, die gerade zu sehen sind.
   *
   *  Damit `toDataURL()` überhaupt etwas liefert, muss die Karte mit
   *  `preserveDrawingBuffer` erzeugt worden sein: WebGL wirft den Puffer sonst
   *  nach jedem Bild weg, und man bekommt eine schwarze Fläche. Deshalb wird
   *  vorher noch einmal gezeichnet und auf `idle` gewartet — sonst fehlen
   *  Kacheln, die gerade noch laden. */
  async function saveMapPng() {
    const btn = $("lib-map-png");
    if (!_map || !_mapReady) return;
    const beschriftung = btn ? btn.querySelector("span") : null;
    const alt = beschriftung ? beschriftung.textContent : "";
    if (btn) { btn.disabled = true; if (beschriftung) beschriftung.textContent = "…"; }
    try {
      await new Promise(res => {
        if (_map.loaded() && !_map.isMoving()) { _map.once("idle", res); _map.triggerRepaint(); }
        else _map.once("idle", res);
        setTimeout(res, 4000);          // nicht ewig warten
      });
      _map.triggerRepaint();
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const url = _map.getCanvas().toDataURL("image/png");
      const name = _ortAktiv ? _ortAktiv.name.split(",")[0]
                 : (state.search || T("library.all_tours", "Alle Touren"));
      const r = await api().library_save_map_png(url, name);
      if (r && r.ok) toast(T("library.map_png_done", "Karte gesichert."), "info");
      else if (r && !r.cancelled) toast((r && r.error) || T("library.map_png_fail", "Konnte die Karte nicht sichern."), "error");
    } catch (e) {
      applog("error", "[Archiv] Karten-PNG: " + e);
      toast(T("library.map_png_fail", "Konnte die Karte nicht sichern."), "error");
    } finally {
      if (btn) { btn.disabled = false; if (beschriftung) beschriftung.textContent = alt; }
    }
  }

  function renderMap() {
    const hint = $("lib-map-hint");
    const feats = _items.filter(it => it.geom && it.geom.length > 1).map((it, i) => ({
      type: "Feature",
      properties: { i, path: it.path, name: it.name, fav: it.fav ? 1 : 0,
                    color: trackColor(it) },
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
      // `preserveDrawingBuffer`: ohne das liefert `toDataURL()` eine schwarze
      // Fläche — WebGL verwirft den Puffer nach jedem Bild. Kostet etwas
      // Zeichenleistung, aber ohne wäre der PNG-Export nicht möglich.
      common: { center: [10, 51], zoom: 3, attributionControl: true,
                preserveDrawingBuffer: true },
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
          "circle-color": ["get", "color"],
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
          // Favoriten behalten ihre Signalfarbe — sie sollen auffallen.
          "line-color": ["case", ["==", ["get", "fav"], 1], FAV_COLOR, ["get", "color"]],
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
        if (!hits.length) { closeMapPopup(); _sel = null; store.set("sel", ""); applyMapSelection(); renderDetail(); }
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
    // Die Auswahl merken (Wunsch Beta-Tester): Wer eine Tour markiert, ins
    // Werkzeug wechselt und zurückkommt, stand vorher wieder vor einer leeren
    // Detailspalte und musste die Tour erneut suchen. Der Pfad reicht — beim
    // nächsten Betreten wird die Tour daran wiedergefunden.
    store.set("sel", (it && it.path) || "");
    if (view === "cards") renderGrid();
    else if (view === "list") renderList();
    else if (view === "map") applyMapSelection(opts && opts.fly);
    renderDetail();
  }

  // ── Detailspalte ──────────────────────────────────────────────────────
  /** Sammel-Panel: mehrere Touren gewählt. Werkzeuge öffnen geht hier nicht —
   *  welche Tour sollte der Animator laden? — Eigenschaften setzen dafür für
   *  alle auf einmal. */
  function renderMulti() {
    const box = $("lib-detail");
    const n = _multi.size;
    box.innerHTML = `
      <div class="lib-multi-head">
        <b>${n}</b> ${T("library.selected", "Touren gewählt")}
        <button class="btn btn-ghost btn-sm" id="lib-m-clear" type="button">${T("library.clear_sel", "Auswahl aufheben")}</button>
      </div>

      <div class="field-label">${T("library.collections", "Sammlungen")}</div>
      <div class="lib-multi-cols" id="lib-m-cols"></div>

      <div class="field-label" style="margin-top:14px;">${T("library.activity", "Fortbewegung")}</div>
      <select id="lib-m-act" class="lib-select">
        <option value="">${T("library.keep", "unverändert lassen")}</option>
        <option value="__auto">${T("library.act_auto", "Automatisch erkannt")}</option>
        ${Object.keys(ACT_LABELS).map(k => `<option value="${k}">${esc(ACT_LABELS[k])}</option>`).join("")}
      </select>

      <div class="field-label" style="margin-top:14px;">${T("library.tags", "Schlagwörter")}</div>
      <div class="lib-multi-tags">
        <input type="text" id="lib-m-tags" class="lib-input" placeholder="${T("library.tags_ph", "z. B. urlaub, familie")}">
        <button class="btn btn-ghost btn-sm" id="lib-m-tags-add" type="button">${T("library.add", "Hinzufügen")}</button>
      </div>

      <div class="field-label" style="margin-top:14px;">${T("library.recorded", "Gemacht oder geplant")}</div>
      <div class="lib-seg" id="lib-m-rec">
        <button type="button" data-rec="1">${T("library.recorded_yes", "Gemacht")}</button>
        <button type="button" data-rec="0">${T("library.recorded_no", "Geplant")}</button>
        <button type="button" data-rec="auto">${T("library.recorded_auto", "Automatisch")}</button>
      </div>

      <div class="lib-actions" style="margin-top:16px;">
        <button class="btn btn-ghost btn-sm" id="lib-m-fav">★ ${T("library.fav_on", "Als Favorit")}</button>
        <button class="btn btn-ghost btn-sm" id="lib-m-unfav">${T("library.fav_off", "Favorit weg")}</button>
      </div>
      <div class="lib-actions lib-danger">
        <button class="btn btn-ghost btn-sm" id="lib-m-hide">${T("library.hide", "Ausblenden")}</button>
        <button class="btn btn-ghost btn-sm lib-btn-danger" id="lib-m-trash">${T("library.trash", "In den Papierkorb")}</button>
      </div>
      <div class="lib-hint" id="lib-m-status"></div>`;

    const pfade = () => multiItems().map(i => i.path);
    const status = (txt) => { const e = $("lib-m-status"); if (e) e.textContent = txt; };

    // Sammlungen als Knöpfe: hinzufügen zu jeder, N:N erlaubt beliebig viele.
    const cols = $("lib-m-cols");
    cols.innerHTML = _collections.length
      ? _collections.map(c => `<button class="lib-colchip" data-cid="${c.id}" type="button">+ ${esc(c.name)}</button>`).join("")
        + `<button class="lib-colchip lib-colchip-new" id="lib-m-col-new" type="button">+ ${T("library.new_collection", "Neue Sammlung")}</button>`
      : `<button class="lib-colchip lib-colchip-new" id="lib-m-col-new" type="button">+ ${T("library.new_collection", "Neue Sammlung")}</button>`;
    cols.querySelectorAll("[data-cid]").forEach(b => {
      b.onclick = async () => {
        const r = await api().library_collection_add(parseInt(b.dataset.cid, 10), pfade());
        status(r && r.ok ? `${r.added || 0} ${T("library.added", "hinzugefügt")}` : (r && r.error) || "");
        reloadCollections();
      };
    });
    const neu = $("lib-m-col-new");
    if (neu) neu.onclick = () => addToCollectionDialog(pfade());

    $("lib-m-clear").onclick = () => { _multi.clear(); renderView(); renderDetail(); };

    $("lib-m-act").onchange = async (e) => {
      const v = e.target.value;
      if (!v) return;
      const wert = v === "__auto" ? "" : v;
      let ok = 0;
      for (const p of pfade()) {
        const r = await api().library_set_activity(p, wert);
        if (r && r.ok) ok++;
        status(`${ok} / ${_multi.size}`);
      }
      e.target.value = "";
      reload();
    };

    $("lib-m-tags-add").onclick = async () => {
      const roh = ($("lib-m-tags").value || "").split(",").map(x => x.trim()).filter(Boolean);
      if (!roh.length) return;
      let ok = 0;
      for (const it of multiItems()) {
        const vorhanden = (it.tags || "").split(",").map(x => x.trim()).filter(Boolean);
        const neu2 = Array.from(new Set(vorhanden.concat(roh)));
        const r = await api().library_set_fields(it.path, null, neu2, null);
        if (r !== false) ok++;
        status(`${ok} / ${_multi.size}`);
      }
      $("lib-m-tags").value = "";
      reload();
    };

    $("lib-m-rec").querySelectorAll("[data-rec]").forEach(b => {
      b.onclick = async () => {
        const v = b.dataset.rec === "auto" ? null : b.dataset.rec === "1";
        let ok = 0;
        for (const p of pfade()) {
          const r = await api().library_set_recorded(p, v);
          if (r && r.ok) ok++;
          status(`${ok} / ${_multi.size}`);
        }
        reload();
      };
    });

    const favSetzen = async (an) => {
      let ok = 0;
      for (const p of pfade()) {
        await api().library_set_fields(p, an, null, null);
        status(`${++ok} / ${_multi.size}`);
      }
      reload();
    };
    $("lib-m-fav").onclick = () => favSetzen(true);
    $("lib-m-unfav").onclick = () => favSetzen(false);

    $("lib-m-hide").onclick = async () => {
      for (const p of pfade()) await api().library_set_hidden(p, true);
      _multi.clear(); reload();
    };
    $("lib-m-trash").onclick = async () => {
      if (!await frageTrash(_multi.size)) return;
      let ok = 0;
      for (const p of pfade()) {
        const r = await api().library_trash(p);
        if (r && r.ok) ok++;
        status(`${ok} / ${_multi.size}`);
      }
      _multi.clear(); reload();
    };
  }

  /* Werte, die nur die Aufzeichnung selbst kennt - Durchschnitts-/Maximalpuls,
   * Kalorien, Trittfrequenz, Geraet, Wetter. Sie stammen aus den `session`/
   * `sport`/`device_info`-Teilen einer FIT-Datei, die bis v0.9.500 komplett
   * verworfen wurden.
   *
   * Gezeigt wird ein kuratierter Auszug (`core/fitmeta.py` -> ANZEIGE); in der
   * Datenbank liegt mehr. Das ist Absicht: erweitern kostet dann nur eine Zeile
   * im UI und KEINEN Neu-Import - bei ein paar tausend Touren ist genau das der
   * teure Teil.
   */
  function fitBlockHtml(it) {
    const felder = it.fit_fields || [];
    if (!felder.length) return "";
    const mehr = (it.fit_raw_n || 0) - felder.length;
    // Kennwerte aus der Datei („cycling", „gravel_cycling") sind keine
    // Anzeigetexte. Übersetzen, mit dem Rohwert als Rückfall — die FIT-Norm
    // kennt 69 Sportarten und 89 Unterarten, wir benennen die gängigen.
    // Ohne Eintrag in der Sprachdatei wenigstens lesbar machen: die FIT-Norm
    // schreibt Kennwerte klein und mit Unterstrichen („garmin",
    // „wahoo_fitness") — so gehören sie nicht in eine Oberfläche.
    const lesbar = (v) => String(v).split("_")
      .map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(" ");
    const wertText = (f) => f.code
      ? T("library.fitval." + f.value, lesbar(f.value))
      : String(f.value);
    const zeile = (f) => `<div><span>${esc(T("library.fit." + f.key, f.label))}</span>`
      + `<b>${esc(wertText(f))}${f.unit ? " " + esc(f.unit) : ""}</b></div>`;
    const hinweis = mehr > 0
      ? `<div class="lib-hint">${T("library.fit_more",
          "{n} weitere Werte stehen in der Datenbank und lassen sich ohne Neu-Einlesen freischalten.")
          .replace("{n}", num(mehr))}</div>`
      : "";
    return `<div class="lib-fit">
        <div class="field-label">${T("library.fit_title", "Aus der Aufzeichnung")}</div>
        <div class="lib-detail-rows">${felder.map(zeile).join("")}</div>
        ${hinweis}
      </div>`;
  }

  function renderDetail() {
    const box = $("lib-detail");
    if (_multi.size > 1) { renderMulti(); return; }
    if (!_sel) {
      box.innerHTML = `<div class="lib-detail-empty">${T("library.pick_hint", "Tour auswählen — dann kannst du sie hier direkt in ein Werkzeug übernehmen.")}
        <div class="lib-hint" style="margin-top:10px">${T("library.multi_hint", "Mehrere wählen: ⌘/Strg-Klick einzeln, Umschalt-Klick für einen Bereich.")}</div></div>`;
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
      ${fitBlockHtml(it)}

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

      <div class="field-label" style="margin-top:10px;">${T("library.track_color", "Track-Farbe auf der Karte")}</div>
      <div class="lib-colorrow">
        <input type="color" id="lib-d-color" value="${it.color && /^#[0-9a-f]{6}$/i.test(it.color) ? it.color : trackColor(it)}">
        <button class="btn btn-ghost btn-sm" id="lib-d-color-auto">${T("library.color_auto", "Automatisch")}</button>
        <span class="lib-hint">${it.color ? T("library.color_manual", "von dir gewählt")
                                          : T("library.color_derived", "aus dem Streckenverlauf abgeleitet")}</span>
      </div>

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
        <span class="lib-act-paar">
          <button class="btn btn-ghost btn-sm" id="lib-d-hide">${it.hidden ? T("library.unhide", "Wieder einblenden") : T("library.hide", "Ausblenden")}</button>
          ${helpTip(T("library.hide_help", "Blendet die Tour nur aus der Liste aus. Sie bleibt im Archiv und liegt unter „Ausgeblendete“ — von dort holst du sie jederzeit zurück. An der Datei ändert sich nichts."))}
        </span>
        <span class="lib-act-paar">
          <button class="btn btn-ghost btn-sm" id="lib-d-forget">${T("library.forget", "Aus Archiv nehmen")}</button>
          ${helpTip(T("library.forget_help", "Entfernt nur den Eintrag aus dem Archiv — deine Datei bleibt unangetastet dort liegen, wo sie ist. Beim nächsten Einlesen taucht sie wieder auf, solange der Ordner noch beobachtet wird. Soll sie dauerhaft aus dem Archiv verschwinden, nimm den Ordner unter „Ordner & Einlesen“ heraus."))}
        </span>
        <span class="lib-act-paar">
          <button class="btn btn-ghost btn-sm lib-btn-danger" id="lib-d-trash">${T("library.trash", "In den Papierkorb")}</button>
          ${helpTip(T("library.trash_help", "Verschiebt die Datei wirklich — in den Papierkorb deines Systems, genau wie beim Löschen im Finder oder Explorer. Endgültig weg ist sie erst, wenn du den Papierkorb leerst; bis dahin kannst du sie dort zurückholen. GPS Studio löscht nie selbst etwas endgültig."))}
        </span>
      </div>`;

    box.querySelectorAll("[data-open]").forEach(b => { b.onclick = () => openIn(b.dataset.open); });
    initHelpTips(box);   // „?"-Erklärblasen der Detailspalte

    const nameInput = $("lib-d-name");
    const saveName = debounce(async () => {
      const v = nameInput.value.trim();
      // Wer den Datei-Namen wieder hinschreibt, will offensichtlich zurück.
      const res = await api().library_set_name(it.path, v === it.file_name ? "" : v);
      if (res && res.ok && res.track) { Object.assign(it, res.track); renderView(); }
    }, 600);
    nameInput.oninput = saveName;

    // Die Listendaten kennen weder `activity_user` (steht in track_meta) noch
    // die FIT-Werte (`fitmeta` ist aus der Listen-Abfrage bewusst ausgeschlossen,
    // ~1,2 KB je Tour). Beides haengt an DEMSELBEN Aufruf - eine zweite Runde
    // zum Backend waere reine Verschwendung.
    if (it.activity_user === undefined) {
      api().library_get_track(it.path).then(r => {
        if (r && r.ok && r.track && r.track.activity_user !== undefined) {
          it.activity_user = r.track.activity_user;
          it.fit_fields = r.track.fit_fields || [];
          it.fit_raw_n = r.track.fit_raw_n || 0;
          if (_sel && _sel.path === it.path) renderDetail();
        }
      }).catch(() => {});
    }

    const farbeSetzen = async (wert) => {
      const res = await api().library_set_color(it.path, wert);
      if (res && res.ok && res.track) {
        Object.assign(it, res.track);
        renderDetail();
        if (view === "map") renderMap();
      } else if (res && res.error) toast(res.error, "error");
    };
    $("lib-d-color").onchange = (e) => farbeSetzen(e.target.value);
    $("lib-d-color-auto").onclick = () => farbeSetzen("");

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
      _sel = null; store.set("sel", ""); renderDetail(); reload();
    };
    $("lib-d-forget").onclick = async () => {
      await api().library_forget(it.path);
      _sel = null; store.set("sel", ""); renderDetail(); reload();
    };
    $("lib-d-trash").onclick = () => confirmTrash(it);
  }

  /** Endgültig wirkende Aktionen fragen nach — hier geht es um eine fremde
   *  Datei, nicht um App-Daten. */
  /** Rückfrage vors Verschieben in den Papierkorb — für eine Tour wie für
   *  hundert. Liefert true, wenn der Nutzer zustimmt. */
  function frageTrash(n, pfad) {
    return new Promise((fertig) => {
      let beantwortet = false;
      const m = openModal({
        title: T("library.trash", "In den Papierkorb"),
        body: `<div class="lib-fmodal">
          <p>${n === 1
            ? T("library.trash_q", "Diese Datei in den Papierkorb legen?")
            : T("library.trash_many_q", "{n} Touren in den Papierkorb legen?")
                .replace("{n}", num(n))}</p>
          ${pfad ? `<p class="lib-hint">${esc(pfad)}</p>` : ""}
          <p class="lib-hint">${T("library.trash_note", "Die Tour verschwindet aus dem Archiv. Aus dem Papierkorb kannst du sie zurückholen, solange er nicht geleert ist.")}</p>
          <div class="lib-actions" style="margin-top:12px;">
            <button class="btn btn-sm" id="lib-trash-cancel">${T("library.cancel", "Abbrechen")}</button>
            <button class="btn btn-sm lib-btn-danger" id="lib-trash-ok">${T("library.trash_do", "In den Papierkorb")}</button>
          </div>
        </div>`,
        // Auch das ✕ oben und die Esc-Taste sind eine Antwort — sonst bliebe
        // das Versprechen offen und der Aufrufer hinge für immer.
        onClose: () => { if (!beantwortet) { beantwortet = true; fertig(false); } },
      });
      const ende = (wert) => {
        if (beantwortet) return;
        beantwortet = true;
        m.close();
        fertig(wert);
      };
      const cancel = document.getElementById("lib-trash-cancel");
      if (cancel) cancel.onclick = () => ende(false);
      const ok = document.getElementById("lib-trash-ok");
      if (ok) ok.onclick = () => ende(true);
    });
  }

  async function confirmTrash(it) {
    if (!await frageTrash(1, it.path)) return;
    const res = await api().library_trash(it.path);
    if (!res.ok) { toast(res.error || "Nicht möglich", "error"); return; }
    toast(T("library.trash_done", "In den Papierkorb gelegt."), "info");
    _sel = null; store.set("sel", ""); renderDetail(); reload();
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
      if (state.collection_id === cid) {
        state.collection_id = 0;
        state.sort = gemerkterSort();
        sortAnzeigen();
      }
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

  /* Dateien, aus denen keine Tour wurde.
   *
   * Zwei Dinge waren hier falsch (Beta-Tester, 61 FIT-Dateien):
   *   1. Alles hieß „nicht lesbar" — dabei waren es Hallen-Einheiten ohne GPS.
   *      Die Uhr schreibt für Rolle, Kraftraum und Bahnschwimmen ebenfalls eine
   *      FIT-Datei, nur eben ohne Koordinaten. Nichts daran ist kaputt.
   *   2. Man kam aus der Liste nicht wieder heraus: „man kann sie aber nicht
   *      löschen". Jetzt gibt es „Aus der Liste nehmen" — die Datei bleibt
   *      liegen, nur die Meldung verschwindet, und zwar dauerhaft.
   */
  async function showErrors(zeigeWeg) {
    // ⚠️ Erst zählen, dann laden. Ein Nutzer hatte 98692 Fehler-Zeilen; die
    // wurden vorher ALLE geholt und zu ebenso vielen Zeilen mit
    // Auswahlkästchen aufgebaut — die App fror ein („man kann das Programm auch
    // nicht mehr bedienen. Nach einer Zeit öffnet sich doch ein Fenster").
    // Jetzt kommt die Gesamtzahl aus einer Zählabfrage und die Liste gedeckelt.
    const zahlen = await api().library_errors_count(!!zeigeWeg);
    const res = await api().library_errors(!!zeigeWeg);
    const items = (res && res.items) || [];
    const ohne = items.filter(i => i.error_kind === "no_points");
    const kaputt = items.filter(i => i.error_kind !== "no_points");
    const gesamt = (zahlen && zahlen.gesamt) || items.length;
    const gekuerzt = gesamt > items.length;

    const zeile = (i) => `
      <label class="lib-dupe-item lib-dupe-pick">
        <input type="checkbox" class="lib-err-cb" data-path="${esc(i.path)}">
        <span class="lib-dupe-name">${esc(i.filename)}</span>
        ${i.hidden ? `<span class="lib-dupe-keep">${T("library.err_dismissed", "weggeräumt")}</span>` : ""}
      </label>`;
    const gruppe = (titel, hinweis, liste) => !liste.length ? "" : `
      <div class="lib-dupe-group">
        <div class="lib-dupe-head">${liste.length} · ${titel}</div>
        <p class="lib-dupe-intro">${hinweis}</p>
        ${liste.map(zeile).join("")}
      </div>`;

    openModal({
      title: kaputt.length
        ? T("library.unreadable", "Datei(en) nicht lesbar")
        : T("library.no_track_n", "Datei(en) ohne Strecke"),
      body: `<div class="lib-dupes">${items.length ? `
        <div class="lib-err-kopf">
          <p class="lib-dupe-intro"><b>${num(gesamt)}</b> ${
            gesamt === 1
              ? T("library.err_total_one", "Datei konnte nicht als Tour gelesen werden.")
              : T("library.err_total", "Dateien konnten nicht als Tour gelesen werden.")}
            ${gekuerzt ? `<br><span class="lib-err-gekuerzt">${
              T("library.err_shown", "Angezeigt sind die ersten {n} — bei dieser Menge hilft Anhaken nicht weiter, dafür sind die Knöpfe unten da.")
                .replace("{n}", num(items.length))}</span>` : ""}
          </p>
          <p class="lib-dupe-intro">${T("library.err_counts_note",
            "Diese Dateien zählen <b>nicht</b> in Kilometer, Zeit oder Fortbewegung — sie liefern ja keine Strecke. Für die Auswertungen ändert sich also nichts, wenn du sie wegräumst.")}</p>
          ${(zahlen && zahlen.ohne_strecke) ? `
            <button class="btn btn-sm" id="lib-err-all-nogps">
              ${zahlen.ohne_strecke === 1
                ? T("library.err_dismiss_one_nogps", "Die Datei ohne Strecke aus der Liste nehmen")
                : T("library.err_dismiss_all_nogps", "Alle {n} ohne Strecke aus der Liste nehmen")
                  .replace("{n}", num(zahlen.ohne_strecke))}</button>` : ""}
          ${(zahlen && zahlen.kaputt) ? `
            <button class="btn btn-sm" id="lib-err-all-broken">
              ${zahlen.kaputt === 1
                ? T("library.err_dismiss_one_broken", "Die nicht lesbare Datei aus der Liste nehmen")
                : T("library.err_dismiss_all_broken", "Alle {n} nicht lesbaren aus der Liste nehmen")
                  .replace("{n}", num(zahlen.kaputt))}</button>` : ""}
        </div>
        ${gruppe(T("library.err_no_track", "ohne Streckendaten"),
                 T("library.err_no_track_hint",
                   "Diese Dateien sind in Ordnung — sie enthalten nur keine Koordinaten. "
                   + "Typisch für Aufzeichnungen ohne GPS: Rolle, Kraftraum, Bahnschwimmen. "
                   + "Eine Tour lässt sich daraus nicht bauen."),
                 ohne)}
        ${gruppe(T("library.err_broken", "nicht lesbar"),
                 T("library.err_broken_hint",
                   "Diese Dateien konnten nicht gelesen werden — abgebrochene Übertragung, "
                   + "unbekanntes Format oder beschädigt."),
                 kaputt)}
        <div class="lib-dupe-actions">
          <button class="btn btn-ghost btn-sm" id="lib-err-all" type="button">
            ${T("library.err_all", "Alle auswählen")}</button>
          <button class="btn btn-primary" id="lib-err-go" type="button" disabled>
            ${zeigeWeg ? T("library.err_restore", "Wieder anzeigen")
                       : T("library.err_dismiss", "Aus der Liste nehmen")}
            <span id="lib-err-n"></span>
          </button>
          <span id="lib-err-status" class="lib-dupe-status"></span>
        </div>
        <p class="lib-dupe-intro">${zeigeWeg
          ? T("library.err_restore_hint", "Weggeräumte Meldungen kommen wieder zum Vorschein.")
          : T("library.err_dismiss_hint",
              "Es wird nichts gelöscht — weder die Datei noch der Eintrag. Nur die Meldung "
              + "verschwindet, auch nach dem nächsten Einlesen.")}</p>
        <label class="lib-dupe-pick" style="margin-top:10px">
          <input type="checkbox" id="lib-err-showall" ${zeigeWeg ? "checked" : ""}>
          <span>${T("library.err_show_dismissed", "Auch weggeräumte zeigen")}</span>
        </label>`
        : `<p>${T("library.no_errors", "Alle Dateien konnten gelesen werden.")}</p>`}</div>`,
    });

    if (!items.length) return;

    const boxen = () => Array.from(document.querySelectorAll(".lib-err-cb"));
    const zaehlen = () => {
      const n = boxen().filter(b => b.checked).length;
      const el = document.getElementById("lib-err-n");
      const btn = document.getElementById("lib-err-go");
      if (el) el.textContent = n ? `(${n})` : "";
      if (btn) btn.disabled = n === 0;
    };
    boxen().forEach(b => b.addEventListener("change", zaehlen));
    zaehlen();

    // „Alle wegräumen" — ohne den Umweg über 99000 Kästchen.
    const sammelWeg = async (art, knopf) => {
      if (!knopf) return;
      knopf.onclick = async () => {
        knopf.disabled = true;
        const r = await api().library_dismiss_all_errors(art);
        if (r && r.ok) {
          applog("info", `[Archiv] ${r.n} Fehler-Meldungen weggeräumt (${art || "alle"})`);
          await reload();
          // ⚠️ Erst den offenen Dialog schließen. `showErrors` ruft `openModal`
          // mit Inhalt — und das LEGT einen Dialog auf den vorhandenen, statt
          // ihn zu ersetzen. Ohne das Schließen stünde der Nutzer nach dem
          // Wegräumen vor zwei gestapelten Fenstern und müsste zweimal
          // schließen, wobei das untere den veralteten Stand zeigte.
          openModal({}).close();
          showErrors(zeigeWeg);
        } else {
          knopf.disabled = false;
        }
      };
    };
    await sammelWeg("no_points", document.getElementById("lib-err-all-nogps"));
    await sammelWeg("broken", document.getElementById("lib-err-all-broken"));

    const alle = document.getElementById("lib-err-all");
    if (alle) alle.onclick = () => {
      const an = boxen().some(b => !b.checked);
      boxen().forEach(b => { b.checked = an; });
      zaehlen();
    };

    const showall = document.getElementById("lib-err-showall");
    if (showall) showall.onchange = () => showErrors(showall.checked);

    const go = document.getElementById("lib-err-go");
    if (go) go.onclick = async () => {
      const pfade = boxen().filter(b => b.checked).map(b => b.dataset.path);
      if (!pfade.length) return;
      go.disabled = true;
      const r = await api().library_dismiss_errors(pfade, !zeigeWeg);
      const status = document.getElementById("lib-err-status");
      if (r && r.ok) {
        await reload();
        showErrors(zeigeWeg);
      } else if (status) {
        status.textContent = (r && r.error) || T("library.err_failed", "hat nicht geklappt");
        go.disabled = false;
      }
    };
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
  $("lib-search").oninput = debounce(() => {
    state.search = $("lib-search").value;
    _ortAus = false;           // neue Eingabe → Gegend wieder erlauben
    reload();
  }, 400);
  $("lib-year").onchange = () => { setFilter("year", parseInt($("lib-year").value, 10) || 0); reload(); };
  $("lib-act").onchange = () => { setFilter("activity", $("lib-act").value); reload(); };
  $("lib-sort").onchange = () => { setFilter("sort", $("lib-sort").value); reload(); };
  const kmLesen = (id) => {
    const v = parseFloat($(id).value);
    return (isFinite(v) && v > 0) ? v : null;
  };
  const kmGesetzt = debounce(() => {
    setFilter("min_km", kmLesen("lib-kmmin"));
    setFilter("max_km", kmLesen("lib-kmmax"));
    reload();
  }, 500);
  $("lib-kmmin").oninput = kmGesetzt;
  $("lib-kmmax").oninput = kmGesetzt;
  $("lib-reset").onclick = () => {
    state.search = "";
    setFilter("year", 0); setFilter("activity", ""); setFilter("sort", "date_desc");
    setFilter("min_km", null); setFilter("max_km", null);
    _ortAus = false; _ortAktiv = null;
    $("lib-search").value = "";
    $("lib-sort").value = "date_desc";
    $("lib-kmmin").value = ""; $("lib-kmmax").value = "";
    reload();
  };
  // Nachladen beim Scrollen — die Container leben über alle Re-Renders hinweg
  // (innerHTML tauscht nur die Kinder), einmal registrieren reicht. Beide
  // hängen am Modul-DOM und verschwinden mit ihm beim Unmount von selbst.
  grid.addEventListener("scroll", () => scrollNachladen(grid), { passive: true });
  $("lib-list").addEventListener("scroll", () => scrollNachladen($("lib-list")), { passive: true });
  $("lib-map-png").onclick = saveMapPng;
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
  // Jahr und Art bauen ihre Auswahl aus den Bestandszahlen und setzen `selected`
  // dabei selbst; die Sortierung steht fest im HTML und muss hier nachgezogen
  // werden — sonst zeigte das Feld „Neueste zuerst", während nach Länge
  // sortiert wird.
  sortAnzeigen();
  if (state.min_km) $("lib-kmmin").value = state.min_km;
  if (state.max_km) $("lib-kmmax").value = state.max_km;

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
    let st = null, ort = null;
    try { st = await api().library_map_thumbs_status(); } catch (_) { return; }
    try { ort = await api().library_places_status(); } catch (_) {}
    if (_unmounted) return;
    const wasRunning = !!_autoThumbs || !!_autoPlaces;
    _autoThumbs = (st && st.running) ? st : null;
    _autoPlaces = (ort && ort.running) ? ort : null;
    if (_autoThumbs || _autoPlaces) {
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
