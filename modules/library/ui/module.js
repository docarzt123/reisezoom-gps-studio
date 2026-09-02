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
  // 30.08.2026 (Marc-OK): Track-Datei aufs Archiv ziehen = importieren.
  // setupDropZone/persistDroppedFiles (util.js) liefern echte Pfade oder
  // _drops-Kopien; die Bridge kopiert in den beobachteten Import-Ordner.
  try {
    setupDropZone({
      target: body,
      accept: ["gpx", "fit", "tcx", "kml", "kmz", "geojson", "nmea"],
      onDrop: async (files) => {
        const paths = await persistDroppedFiles(files, "binary");
        if (paths && paths.length && typeof importSingleFiles === "function") {
          importSingleFiles(paths);
        }
      },
    });
  } catch (e) { applog && applog("warn", "[Archiv] Dropzone: " + e); }
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
    // 22.08.2026 (Audit): bool/Objekt-Werte — `String(false)` war „false" (truthy),
    // ein Sortier-Objekt wurde zu „[object Object]". Eigener JSON-Kanal.
    getJson(k, d) {
      try { const r = localStorage.getItem("rz.library.json." + k); return r == null ? d : JSON.parse(r); }
      catch (_) { return d; }
    },
    setJson(k, v) { try { localStorage.setItem("rz.library.json." + k, JSON.stringify(v)); } catch (_) {} },
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
    // 02.09.2026 (Marc: „wenn ich einen Suchbegriff eingebe, das Modul wechsle
    // und zurückkomme, ist der Suchbegriff weg — das Archiv soll so aussehen,
    // wie ich es verlassen habe"): Jahr, Art, Zeitraum, Länge, Sortierung und
    // Ansicht wurden längst gemerkt, ausgerechnet die Suche nicht. Sie steht
    // sichtbar im Feld — niemand sucht später ratlos nach fehlenden Touren.
    search: store.get("search", ""),
    year: parseInt(store.get("year", "0"), 10) || 0,
    activity: store.get("activity", ""),
    von: store.get("von", "") || null,
    bis: store.get("bis", "") || null,
    min_km: parseFloat(store.get("min_km", "")) || null,
    max_km: parseFloat(store.get("max_km", "")) || null,
    sort: SORTS_OK.includes(gespeicherterSort) ? gespeicherterSort : "date_desc",
    // 02.09.2026 (Marc: „im Archiv sollen ALLE Filter erhalten bleiben"): auch
    // die gewählte Sammlung. Sie stand als einzige fest auf 0 — wer in einer
    // Sammlung arbeitete, stand nach jedem Modulwechsel wieder im ganzen
    // Bestand.
    collection_id: parseInt(store.get("collection_id", "0"), 10) || 0,
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

  /* Zeitraum-Voreinstellungen (v0.9.505). Marc: „kann man nicht einfach einen
   * Datumsbereich einstellen, und innerhalb dem die Auflösung angeben?" — genau
   * dafür. Ohne Voreinstellungen wird ein Datumsbereich schnell lästig, weil
   * man für jede Frage zweimal ein Datum tippt.
   *
   * ⚠️ Die Rechnung läuft über die LOKALE Zeit, nicht über UTC: „dieses Jahr"
   * muss dasselbe meinen wie der Kalender an der Wand.
   */
  const _iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    + `-${String(d.getDate()).padStart(2, "0")}`;
  const ZEITRAEUME = [
    { id: "", label: () => T("library.range.all", "Alle Zeiträume"), bereich: () => [null, null] },
    { id: "jahr", label: () => T("library.range.year", "Dieses Jahr"),
      bereich: () => {
        const h = new Date();
        return [_iso(new Date(h.getFullYear(), 0, 1)), _iso(h)];
      } },
    { id: "m12", label: () => T("library.range.m12", "Letzte 12 Monate"),
      bereich: () => {
        const h = new Date(), v = new Date(h);
        v.setMonth(v.getMonth() - 12);
        return [_iso(v), _iso(h)];
      } },
    { id: "w12", label: () => T("library.range.w12", "Letzte 12 Wochen"),
      bereich: () => {
        const h = new Date(), v = new Date(h);
        v.setDate(v.getDate() - 7 * 12);
        return [_iso(v), _iso(h)];
      } },
    { id: "eigen", label: () => T("library.range.custom", "Eigener Zeitraum …"), bereich: null },
  ];

  // v0.9.507 — Monatskürzel aus der Sprachdatei: „Mär/Okt/Dez" sind deutsch,
  // im Spanischen heißt es „Ene/Abr/Ago/Dic". Ein Schlüssel als Kommaliste,
  // damit nicht zwölf einzelne gepflegt werden müssen.
  const MONTHS = T("library.months_short", "Jan,Feb,Mär,Apr,Mai,Jun,Jul,Aug,Sep,Okt,Nov,Dez").split(",");

  body.classList.add("lib-mode");

  body.innerHTML = `
    <aside class="panel lib-nav" id="lib-panel">
      <!-- v0.9.606 (Marc: „touren und projekte werden ähnlich organisiert"):
           die Seitenleiste hat ZWEI Gesichter — Touren-Filter oder
           Projekt-Bereiche, je nach Umschalter in der Filterzeile. -->
      <div id="lib-nav-projekte" hidden>
        <div class="lib-nav-title">${T("pm.title", "Projekte")}</div>
        <nav class="lib-scopes" id="lib-proj-scopes"></nav>
        <button class="lib-nav-add" id="lib-proj-new" type="button">+ ${T("library.proj_new", "Neues Projekt")}</button>
      </div>
      <div id="lib-nav-touren">
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
      </div>
    </aside>

    <section class="lib-main">
      <div class="lib-bar">
        <!-- v0.9.603 (Marc): oberste Zeile = Wahl zwischen Projekten und
             Touren-Archiv. Hier ist das Archiv aktiv; „Projekte" öffnet den
             Vollbild-Manager (ui/js/projekte.js). -->
        <div class="pmgr-seg" role="group">
          <button type="button" class="pmgr-seg-btn" id="lib-seg-projekte">🗂 ${T("pm.title", "Projekte")}</button>
          <button type="button" class="pmgr-seg-btn is-on" id="lib-seg-touren">📚 ${T("pm.seg_archive", "Touren-Archiv")}</button>
        </div>
        <input type="search" id="lib-search" class="lib-search"
               value="${esc(state.search || "")}"
               placeholder="${T("library.search_ph", "Suchen — Name, Ort, Schlagwort …")}">
        <select id="lib-year" class="lib-select"></select>
        <select id="lib-act" class="lib-select"></select>
        <!-- Längen-Filter (Wunsch Beta-Tester: „Zeige mir alle Wanderungen über
             20 km in 2025"). Das Backend konnte das längst — es gab nur kein
             Feld dafür. Zusammen mit Art und Jahr ist die Frage jetzt in drei
             Handgriffen gestellt. -->
        <!-- Zeitraum (v0.9.505). Voreinstellungen decken die häufigen Fälle ab;
             „Eigener Zeitraum" blendet die beiden Datumsfelder ein. Der Bereich
             wirkt auf ALLES — Liste, Karte und Statistik — weil er in
             _build_where aufgelöst wird. -->
        <select id="lib-range" class="lib-select"
                title="${T("library.range_tip", "Nur Touren aus diesem Zeitraum")}">
          ${ZEITRAEUME.map(z => `<option value="${z.id}">${esc(z.label())}</option>`).join("")}
        </select>
        <span class="lib-km" id="lib-range-fields" hidden>
          <input type="date" id="lib-von" class="lib-datefield"
                 title="${T("library.range_from", "von")}">
          <span class="lib-km-dash">–</span>
          <input type="date" id="lib-bis" class="lib-datefield"
                 title="${T("library.range_to", "bis")}">
        </span>
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
          <option value="maxspeed_desc">${T("library.sort.maxspeed_desc", "Höchstes Max-Tempo")}</option>
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
        <div class="lib-projwrap" id="lib-projwrap" hidden></div>
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
    else if (scope === "merged") f.merged_only = true;   // 23.08.2026 — zusammengeführte Tracks
    return f;
  }

  function queryParams(extra) {
    const p = Object.assign({}, state, scopeFilters(), extra || {});
    if (!p.year) delete p.year;
    if (!p.activity) delete p.activity;
    if (!p.von) delete p.von;
    if (!p.bis) delete p.bis;
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
    if (!p.von) delete p.von;
    if (!p.bis) delete p.bis;
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

  // 22.08.2026 (Audit): Sequenznummer — zwei überlappende reload()s (Tippen +
  // Orts-Geocoding, Auto-Tick) ließen die ÄLTERE Antwort gewinnen.
  let _reloadSeq = 0;
  // Karte: Obergrenze für Geometrien über die Brücke (bei 100k Touren wären
  // das ~160 MB JSON); Statistik braucht gar keine Zeilen.
  const MAP_CAP = 5000;
  const _ortCache = new Map();   // Suchtext+Params → Antwort (Session)
  async function _ortSuche(text, params) {
    const key = text + "|" + JSON.stringify(params);
    if (_ortCache.has(key)) return _ortCache.get(key);
    const r = await api().library_search_place(text, params);
    if (r && r.ok) _ortCache.set(key, r);
    return r;
  }
  async function reload() {
    const seq = ++_reloadSeq;
    const res = await api().library_query(queryParams({
      limit: view === "map" ? MAP_CAP : (view === "stats" ? 1 : PAGE),
      with_thumbs: false,          // 22.08.2026: Bilder holt das Fenster gezielt (library_thumbs)
      with_geom: view === "map",
    }));
    if (_unmounted || seq !== _reloadSeq) return;
    if (!res.ok) { toast(res.error || T("library.abfrage_fehler", "Archiv-Abfrage fehlgeschlagen"), "error"); return; }
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
      const ort = await _ortSuche(state.search.trim(), queryParams({
        limit: view === "map" ? MAP_CAP : (view === "stats" ? 1 : PAGE),
        with_thumbs: false,
        with_geom: view === "map",
        search: "",
      }));
      if (_unmounted || seq !== _reloadSeq) return;
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
    if (_unmounted || seq !== _reloadSeq) return;
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
      limit: PAGE, offset: _items.length, with_thumbs: false,
    }, ort)));
    _laedtMehr = false;
    if (_unmounted || !res || !res.ok) return;
    const neu = res.items || [];
    if (!neu.length) { _hatMehr = false; return; }
    const start = _items.length;
    _items = _items.concat(neu);
    _hatMehr = _items.length < (res.total || _total);
    // 22.08.2026: Fenster-Rendering — nur der sichtbare Ausschnitt steht im DOM,
    // ein Neuaufbau ist deshalb billig; der untere Platzhalter wächst mit.
    void start;
    if (view === "cards") renderGrid(); else renderList();
  }

  /** Kurz vor dem Ende der Scrollbahn die nächste Seite anstoßen. */
  function scrollNachladen(el) {
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 600) nachladen();
  }

  async function reloadStats() {
    // ⚠️ Zeigt die Liste eine Gegend, muss die Statistik dieselbe Gegend meinen.
    // Erste Version ließ sie auf der Textsuche stehen: die Kacheln zeigten 89
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
    // Gemerkte Sammlung, die es nicht mehr gibt (gelöscht, andere Bibliothek):
    // zurück in den ganzen Bestand, statt eine leere Liste zu zeigen, deren
    // Grund niemand sieht.
    if (state.collection_id && !_collections.some(c => c.id === state.collection_id)) {
      state.collection_id = 0;
      store.set("collection_id", "0");
      if (state.sort === "collection") setFilter("sort", gemerkterSort());
    }
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
    // 23.08.2026 — Zusammengeführte Mehr-Touren-Tracks: eigener Bereich, damit
    // ihre Kilometer nicht ein zweites Mal in Liste und Statistik landen.
    if ((b.n_merged || 0) > 0) items.push(["merged", "🧭", T("library.scope_merged", "Zusammengefügt")]);
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
      if (k === "merged") return b.n_merged || "";
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
        store.set("collection_id", "0");
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
            <span class="lib-nav-menu" data-colmenu="${c.id}" title="${esc(T("library.col_manage", "Sammlung verwalten"))}">⋯</span>
          </button>`).join("")
      : `<div class="lib-nav-empty">${T("library.col_none", "Noch keine Sammlung angelegt.")}</div>`;
    box.querySelectorAll("[data-col]").forEach(b => {
      const id = parseInt(b.dataset.col, 10);
      b.onclick = () => {
        // Zweiter Klick auf dieselbe Sammlung hebt die Auswahl wieder auf.
        state.collection_id = state.collection_id === id ? 0 : id;
        store.set("collection_id", String(state.collection_id));
        // Beim Verlassen einer Sammlung zurück auf die gemerkte Sortierung,
        // nicht stumpf auf „Neueste zuerst".
        state.sort = state.collection_id ? "collection" : gemerkterSort();
        sortAnzeigen();
        renderCollections(); reload();
      };
      b.oncontextmenu = (e) => { e.preventDefault(); openCollectionMenu(id); };
    });
    // 28.08.2026 (Marc: „rechtsklick geht nicht"): Verwaltung zusätzlich über
    // einen sichtbaren ⋯-Knopf — Rechtsklick bleibt, ist aber nicht mehr der
    // einzige (und unauffindbare) Weg. stopPropagation, sonst würde der Klick
    // die Sammlung zugleich als Filter ein-/ausschalten.
    box.querySelectorAll("[data-colmenu]").forEach(sp => {
      sp.onclick = (e) => { e.stopPropagation(); openCollectionMenu(parseInt(sp.dataset.colmenu, 10)); };
    });
  }

  // ── Kopfzeile ─────────────────────────────────────────────────────────
  function scopeTitle() {
    const col = _collections.find(c => c.id === state.collection_id);
    if (col) return col.name;
    return scope === "merged" ? T("library.scope_merged", "Zusammengefügt")
      : scope === "done" ? T("library.scope_done", "Gemachte")
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

  /* ══ PROJEKTE-Ansicht (E1 + v0.9.606) ═══════════════════════════════════
   * Marc, 29.08.2026: „lass den [Umschalter] immer da unten … wechsel nur die
   * ansicht da unten. die projekte können ja auch filter gebrauchen …
   * touren und projekte werden ähnlich organisiert." — Projekte sind eine
   * gleichwertige Archiv-Ansicht: gleiche Filterzeile (Suche wirkt), eigene
   * Bereiche links (Status statt Jahr/Art), Karten-Raster rechts.
   * Öffnen springt ins zuletzt benutzte Modul (Q22). */
  let _projView = false;
  const _projMulti = new Set();   // 31.08.2026 (Beta-Tester): Mehrfachauswahl zum Löschen
  let _projekte = [];
  let _projScope = "alle";  // alle | aktiv | idee | fertig | auto
  const _projThumbCache = {};   // pid → data-URL (Sitzungs-Cache)
  let _projSel = "";            // v0.9.623 — gewähltes Projekt (Detailspalte)
  let _projFilterGh = "";   // Detailspalte: „Projekte dieser Tour" zeigen

  function projViewSetzen(an) {
    _projView = !!an;
    // 02.09.2026 (Marc): Was zuletzt offen war, soll beim nächsten Start
    // wieder offen sein. Gemerkt wird beim Umschalten, nicht beim Verlassen —
    // so überlebt es auch einen Absturz.
    store.setJson("projview", _projView);
    const bar = document.querySelector(".lib-bar");
    if (bar) bar.classList.toggle("proj-mode", _projView);
    const sp = document.getElementById("lib-seg-projekte");
    const st = document.getElementById("lib-seg-touren");
    if (sp) sp.classList.toggle("is-on", _projView);
    if (st) st.classList.toggle("is-on", !_projView);
    const np = document.getElementById("lib-nav-projekte");
    const nt = document.getElementById("lib-nav-touren");
    if (np) np.hidden = !_projView;
    if (nt) nt.hidden = _projView;
    renderView();
  }

  function renderProjNav() {
    const box = document.getElementById("lib-proj-scopes");
    if (!box) return;
    const eigene = _projekte.filter(p => !p.auto);
    const n = (st) => eigene.filter(p => p.status === st).length;
    const eintraege = [
      ["alle", "🗂", T("library.projects_all", "Alle Projekte"), eigene.length],
      ["aktiv", "🟢", T("library.proj_st_aktiv", "aktiv"), n("aktiv")],
      ["idee", "💡", T("library.proj_st_idee", "Idee"), n("idee")],
      ["fertig", "✅", T("library.proj_st_fertig", "fertig"), n("fertig")],
      ["auto", "⚙️", T("library.proj_autos", "Automatisch angelegt"),
       _projekte.filter(p => p.auto).length],
    ];
    box.innerHTML = eintraege.map(([k, ico, lbl, anz]) => `
      <button class="lib-nav-item${_projScope === k ? " is-on" : ""}" data-pscope="${k}" type="button">
        <span class="lib-nav-ico">${ico}</span><span class="lib-nav-lbl">${esc(lbl)}</span>
        <span class="lib-nav-n">${anz || ""}</span>
      </button>`).join("");
    box.querySelectorAll("[data-pscope]").forEach(b => {
      b.onclick = () => { _projScope = b.dataset.pscope; renderProjekte(); };
    });
  }

  async function renderProjekte() {
    const box = $("lib-projwrap");
    if (!box) return;
    const res = await api().projekte_liste();
    _projekte = (res && res.projekte) || [];
    renderProjNav();
    const suche = (state.search || "").trim().toLowerCase();
    const passt = (p) => (!_projFilterGh || (p.geo_hashes || []).includes(_projFilterGh))
      && (_projScope === "alle" ? true
          : _projScope === "auto" ? !!p.auto : (!p.auto && p.status === _projScope))
      && (!suche
          || p.name.toLowerCase().includes(suche)
          || (p.tour_namen || []).some(nm => nm.toLowerCase().includes(suche)));
    const deine = _projekte.filter(p => !p.auto && passt(p));
    const autos = _projekte.filter(p => p.auto && passt(p));
    const rang = { aktiv: 0, idee: 1, fertig: 2 };
    deine.sort((a, b) => (rang[a.status] ?? 0) - (rang[b.status] ?? 0)
      || String(b.modified_at || "").localeCompare(String(a.modified_at || "")));
    autos.sort((a, b) => String(b.modified_at || "").localeCompare(String(a.modified_at || "")));
    const MODUL_CHIP = { animator: ["🎬", "Animator"], tourmap: ["🗺", "Tour-Map"],
                         geotagger: ["📷", "Geotagger"], heightanim: ["📈", T("library.proj_daten", "Daten")] };
    const karte = (p) => {
      const ablauf = p.frei
        ? `🆕 ${T("library.proj_frei", "Noch keine Touren — mit ➕ hinzufügen oder leer öffnen (Reiseroute, Kartenflug)")}`
        : p.ablauf === "schwarm"
        ? `🌊 ${T("schwarm.name", "Schwarm")} · ${p.n_touren} ${T("library.tours", "Touren")}`
        : p.ablauf === "reise"
          ? `🧵 ${T("library.proj_reise", "Reise")} · ${p.n_touren} ${T("library.tours", "Touren")}`
          : esc((p.tour_namen || [])[0] || "");
      // 02.09.2026 (Marc: „wenn unten im Projekt zusätzlich die ganzen Icons
      // für Animator, Tour-Map usw. sind, damit man das Projekt schnell darin
      // öffnen kann"): ALLE Module anbieten — nicht nur die, in denen schon
      // etwas liegt. Die mit Arbeit bleiben hervorgehoben, der Rest ist
      // blasser: So sieht man weiterhin, wo etwas gebaut wurde, kann aber
      // überall direkt hineinspringen.
      const drin = new Set(p.module || []);
      const chips = Object.keys(MODUL_CHIP).map(m => {
        const c = MODUL_CHIP[m];
        const hat = drin.has(m);
        return `<button class="lib-proj-chip${hat ? " hat-arbeit" : " ist-leer"}"
          data-open-modul="${m}" data-pid="${p.id}"
          title="${esc(hat ? c[1] + " — " + T("library.proj_chip_arbeit", "hier liegt Arbeit")
                           : T("library.proj_chip_leer", "Projekt hier öffnen") + ": " + c[1])}">${c[0]}</button>`;
      }).join("");
      const wann = fmtDate(p.modified_at);
      const fehlt = p.exists === false ? ` <span class="lib-proj-fehlt" title="${T("library.proj_fehlt_tip", "Tour-Datei nicht gefunden — Öffnen sucht sie im Archiv.")}">⚠️</span>` : "";
      // E2 (Q16a): gepinnte Version, neuere vorhanden → bewusster Klick.
      const up = p.neuere_fassung
        ? ` <button class="lib-proj-up" data-up="${p.id}" title="${T("library.fassung_up_tip", "Neuere Version der Tour verfügbar — Projekt per Klick aktualisieren")}">⬆ ${T("library.fassung_up", "neuere Version")}</button>` : "";
      return `<div class="lib-proj-karte${p.status === "fertig" ? " fertig" : ""}" data-pid="${p.id}">
        <div class="lib-proj-thumb" data-pthumb="${p.id}">${p.frei ? "🗂" : "🗺"}</div>
        <div class="lib-proj-kopf">
          <span class="lib-proj-name">${esc(p.name)}</span>${fehlt}${up}
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
            <button class="btn btn-ghost btn-sm" data-st="${p.id}" title="${T("library.staende", "Frühere Arbeitsstände")}">🕘</button>${p.frei ? `
            <button class="btn btn-ghost btn-sm" data-addtours="${p.id}" title="${T("library.proj_addtours", "Touren aus dem Archiv hinzufügen")}">➕</button>` : ""}
            <button class="btn btn-ghost btn-sm lib-btn-danger" data-del="${p.id}" title="${T("library.proj_delete", "Projekt löschen")}">🗑</button>
          </span>
        </div>
      </div>`;
    };
    const filterChip = _projFilterGh
      ? `<div class="lib-proj-filter">${T("library.proj_filter_tour", "Nur Projekte dieser Tour")}
           <button type="button" id="lib-proj-filter-x">✕</button></div>` : "";
    const autoBlock = _projScope === "auto"
      ? `<div class="lib-proj-liste pmgr-liste">${autos.map(karte).join("")
          || `<div class="lib-empty"><div class="lib-empty-title">${T("library.proj_leer", "Noch keine Projekte — öffne eine Tour oder starte einen Schwarm, dann entsteht hier dein Arbeitsstand.")}</div></div>`}</div>`
      : `${autos.length && _projScope === "alle" ? `<details class="lib-proj-autos"><summary>${T("library.proj_autos", "Automatisch angelegt")} (${autos.length})<span class="gpxi-q" data-tip="${T("library.proj_autos_tip", "Beim Öffnen einer Tour entsteht automatisch ein Arbeitsstand. Sobald du darin etwas baust oder ihn umbenennst, wandert er nach oben zu deinen Projekten.")}">?</span></summary>
        <div class="lib-proj-liste pmgr-liste">${autos.map(karte).join("")}</div></details>` : ""}`;
    box.innerHTML = `${filterChip}
      ${_projScope !== "auto" ? `<div class="lib-proj-liste pmgr-liste">${deine.map(karte).join("")
        || `<div class="lib-empty"><div class="lib-empty-title">${T("library.proj_leer", "Noch keine Projekte — öffne eine Tour oder starte einen Schwarm, dann entsteht hier dein Arbeitsstand.")}</div></div>`}
      </div>` : ""}
      ${autoBlock}`;
    initHelpTips(box);
    // v0.9.615 (Marc: „kann man da nicht auch eine karte anzeigen?") —
    // Karten-Vorschau je Projekt: Solo = echtes Karten-Thumbnail der Tour,
    // Komposition = gezeichnete Linien aller Mitglieder.
    const thumbsHolen = async () => {
      const det = box.querySelector(".lib-proj-autos");
      const offen = det ? det.open : true;
      const pids = [];
      box.querySelectorAll("[data-pthumb]").forEach(el => {
        const pid = el.dataset.pthumb;
        if (_projThumbCache[pid]) {
          el.innerHTML = `<img src="${_projThumbCache[pid]}" alt="">`;
          return;
        }
        const p = _projekte.find(x => x.id === pid) || {};
        const imAuto = !!el.closest(".lib-proj-autos");
        if (p.frei || (imAuto && !offen)) return;
        pids.push(pid);
      });
      if (!pids.length) return;
      try {
        const r = await api().projekt_thumbs(pids);
        const th = (r && r.thumbs) || {};
        Object.keys(th).forEach(pid => {
          _projThumbCache[pid] = th[pid];
          const el = box.querySelector(`[data-pthumb="${pid}"]`);
          if (el) el.innerHTML = `<img src="${th[pid]}" alt="">`;
        });
      } catch (_) {}
    };
    thumbsHolen();
    { const det = box.querySelector(".lib-proj-autos");
      if (det) det.addEventListener("toggle", () => { if (det.open) thumbsHolen(); }); }
    { const fx = document.getElementById("lib-proj-filter-x");
      if (fx) fx.onclick = () => { _projFilterGh = ""; renderProjekte(); }; }
    // v0.9.623 (Marc: „komplette Projekt-Detail-Seite … wie bei den Touren"):
    // Klick auf die Karte (nicht auf Knöpfe) wählt sie aus → rechte Spalte.
    // 02.09.2026 (Marc: „wie wäre es, wenn Doppelklick aufs Bild das gleiche
    // macht wie Öffnen"): genau das — auf der Karte wie auf dem Bild.
    box.querySelectorAll(".lib-proj-karte").forEach(k => k.ondblclick = (e) => {
      if (e.target.closest("button, select, input, a")) return;
      const pid = k.dataset.pid;
      if (pid) projektOeffnen(pid);
    });
    box.querySelectorAll(".lib-proj-karte").forEach(k => k.onclick = (e) => {
      if (e.target.closest("button, select, input, a")) return;
      // 31.08.2026 (Beta-Tester: „no puedo seleccionar los que quiera para
      // borrarlos") — ⌘/Strg-Klick sammelt Projekte für Sammel-Aktionen,
      // exakt wie die Mehrfachauswahl im Touren-Archiv.
      if (e.metaKey || e.ctrlKey) {
        const pid = k.dataset.pid;
        if (_projMulti.has(pid)) _projMulti.delete(pid); else _projMulti.add(pid);
        renderProjekte();
        return;
      }
      if (_projMulti.size) { _projMulti.clear(); renderProjekte(); }
      _projSel = k.dataset.pid;
      box.querySelectorAll(".lib-proj-karte").forEach(x =>
        x.classList.toggle("is-sel", x.dataset.pid === _projSel));
      renderProjektDetail(_projSel);
    });
    box.querySelectorAll(".lib-proj-karte").forEach(k =>
      k.classList.toggle("is-multi", _projMulti.has(k.dataset.pid)));
    { const d = $("lib-detail");
      if (d) {
        if (_projMulti.size) renderProjMultiPanel();
        else if (_projSel) renderProjektDetail(_projSel);
        else d.innerHTML = `<div class="lib-detail-empty" style="padding:14px">${
          T("library.proj_detail_hint", "Projekt anklicken — dann erscheinen hier Details, Touren und frühere Arbeitsstände. Mehrere wählen: ⌘/Strg-Klick.")}</div>`;
      } }
    { const ba = document.getElementById("lib-proj-multi-alle");
      // 02.09.2026 (Beta-Tester: „alle ausgewählt, es nahm nur zwei"): Der
      // Knopf nimmt genau das, was gerade sichtbar ist — und der Satz
      // darunter sagt, was das NICHT einschließt.
      if (ba) ba.onclick = () => {
        box.querySelectorAll(".lib-proj-karte").forEach(k => {
          if (k.dataset.pid) _projMulti.add(k.dataset.pid);
        });
        renderProjekte();
      };
      const bx = document.getElementById("lib-proj-multi-x");
      if (bx) bx.onclick = () => { _projMulti.clear(); renderProjekte(); };
      const bd = document.getElementById("lib-proj-multi-del");
      if (bd) bd.onclick = async () => {
        const n = _projMulti.size;
        const ok = await (window.rzConfirm
          ? rzConfirm("🗑 " + T("library.proj_delete_multi", "Ausgewählte löschen"),
              T("library.proj_delete_multi_frage", "{n} Projekte löschen? Die Touren im Archiv bleiben unberührt.").replace("{n}", String(n)),
              T("library.proj_delete_multi", "Ausgewählte löschen"), true)
          : Promise.resolve(confirm(n + "?")));
        if (!ok) return;
        // 02.09.2026 (Beta-Tester: drei ausgewählt, nur zwei gelöscht): Hier
        // lief eine Schleife einzelner Aufrufe, und JEDER Fehler wurde
        // verschluckt — gemeldet wurde trotzdem die volle Zahl. Jetzt ein
        // Aufruf für alle, und die Meldung sagt, was wirklich weg ist.
        const ids = Array.from(_projMulti);
        let r = null;
        try { r = await api().projekte_loeschen(ids); } catch (e) { r = { ok: false, error: String(e) }; }
        for (const pid of ids) if (_projSel === pid) _projSel = null;
        _projMulti.clear();
        if (r && r.ok) {
          const weg = r.geloescht || 0;
          const offen = r.fehlgeschlagen || [];
          toast(offen.length
            ? T("library.proj_delete_multi_teil", "{n} von {m} gelöscht — nicht möglich: {liste}")
                .replace("{n}", weg).replace("{m}", ids.length).replace("{liste}", offen.join(", "))
            : T("library.proj_delete_multi_ok", "Projekte gelöscht") + ` (${weg})`,
            offen.length ? "warn" : "info");
        } else {
          toast((r && r.error) || "?", "error");
        }
        renderProjekte();
        renderProjNav();
      };
    }
    if (_projSel) {
      const k = box.querySelector(`.lib-proj-karte[data-pid="${_projSel}"]`);
      if (k) k.classList.add("is-sel");
    }
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
        body: `<input type="text" id="lib-proj-neuname" class="lib-input" value="${esc((p || {}).name || "")}">`,
        footer: `<button class="btn" id="lib-pr-ab">${T("common.cancel", "Abbrechen")}</button>
                 <button class="btn btn-primary" id="lib-pr-ok">OK</button>`,
      });
      const ok = document.getElementById("lib-pr-ok");
      if (ok) ok.onclick = async () => {
        const v = (document.getElementById("lib-proj-neuname") || {}).value || "";
        m.close();
        if (v.trim()) { await api().projekt_umbenennen(b.dataset.ren, v.trim()); renderProjekte(); }
      };
      const ab = document.getElementById("lib-pr-ab");
      if (ab) ab.onclick = () => m.close();
    });
    box.querySelectorAll("[data-dup]").forEach(b => b.onclick = async () => {
      await api().projekt_duplizieren(b.dataset.dup);
      renderProjekte();
    });
    // E3: Arbeitsstand-Historie — Liste + Wiederherstellen (der jetzige
    // Stand wird vorher selbst gesichert).
    box.querySelectorAll("[data-st]").forEach(b => b.onclick = async (e) => {
      e.stopPropagation();
      const res = await api().projekt_staende(b.dataset.st);
      const st = (res && res.staende) || [];
      const zeile = (x) => `<div class="lib-fassung">
          <span class="lib-fassung-info">${esc(fmtDate(x.ts))} ${esc(String(x.ts).slice(11, 16))} · 🎬 ${x.keyframes} · 🚩 ${x.schilder} · 📷 ${x.fotos}</span>
          <button class="btn btn-ghost btn-sm" data-strb="${esc(x.ts)}">↩︎</button>
        </div>`;
      const m = openModal({
        title: "🕘 " + T("library.staende", "Frühere Arbeitsstände"),
        body: st.length
          ? `<div class="lib-hint">${T("library.staende_hint", "Beim Arbeiten wird höchstens alle 10 Minuten ein Stand gesichert. Wiederherstellen sichert den jetzigen Stand vorher automatisch.")}</div>`
            + st.slice().reverse().map(zeile).join("")
          : `<p>${T("library.staende_leer", "Noch keine gesicherten Stände — sie entstehen beim Arbeiten von selbst.")}</p>`,
        footer: `<button class="btn" id="lib-st-zu">${T("common.close", "Schließen")}</button>`,
      });
      const zu = document.getElementById("lib-st-zu");
      if (zu) zu.onclick = () => m.close();
      document.querySelectorAll("[data-strb]").forEach(rb => rb.onclick = async () => {
        m.close();
        const r = await api().projekt_stand_wiederherstellen(b.dataset.st, rb.dataset.strb);
        if (r && r.ok) toast(T("library.stand_done", "Arbeitsstand wiederhergestellt."), "info");
        else toast((r && r.error) || "?", "error");
        renderProjekte();
      });
    });
    // v0.9.612: Touren aus dem Archiv in ein leeres Projekt legen.
    box.querySelectorAll("[data-addtours]").forEach(b => b.onclick = async (e) => {
      e.stopPropagation();
      // Abnahme 29.08.2026: die Suche fragt jetzt das ARCHIV (vorher wurden
      // nur die ersten 300 geladenen Zeilen clientseitig gefiltert — Treffer
      // außerhalb fehlten). Gewählte Touren überleben die Suche (Pfad-Set).
      const gewaehlt = new Set();
      let items = [];
      const liste = () => (items.map((it) => `
        <label class="lib-fassung" style="cursor:pointer;">
          <input type="checkbox" data-tpath="${esc(it.path)}"${gewaehlt.has(it.path) ? " checked" : ""}>
          <span class="lib-fassung-info">${esc(it.name || it.filename || it.path)}</span>
        </label>`).join("")
        || `<p>${T("library.keine_treffer", "Keine Treffer.")}</p>`);
      const laden = async (q) => {
        const res = await api().library_query({ search: q || "", limit: 300, with_thumbs: false });
        items = (res && res.items) || [];
        const el = document.getElementById("lib-tp-liste");
        if (el) {
          el.innerHTML = liste();
          el.querySelectorAll("[data-tpath]").forEach(cb => cb.onchange = () => {
            if (cb.checked) gewaehlt.add(cb.dataset.tpath);
            else gewaehlt.delete(cb.dataset.tpath);
          });
        }
      };
      const m = openModal({
        title: "➕ " + T("library.proj_addtours", "Touren aus dem Archiv hinzufügen"),
        body: `<input type="search" id="lib-tp-such" class="lib-input" placeholder="${esc(T("library.search_ph", "Suchen — Name, Ort, Schlagwort …"))}" style="margin-bottom:8px;">
               <div style="max-height:50vh;overflow-y:auto;" id="lib-tp-liste"></div>`,
        footer: `<button class="btn" id="lib-tp-ab">${T("common.cancel", "Abbrechen")}</button>
                 <button class="btn btn-primary" id="lib-tp-ok">${T("library.proj_addtours_ok", "Hinzufügen")}</button>`,
      });
      await laden("");
      const such = document.getElementById("lib-tp-such");
      if (such) such.oninput = debounce(() => { laden(such.value.trim()); }, 300);
      const ok = document.getElementById("lib-tp-ok");
      if (ok) ok.onclick = async () => {
        const pfade = [...gewaehlt];
        if (!pfade.length) {
          // Abnahme 29.08.2026: leeres Bestätigen endete STUMM.
          toast(T("library.proj_addtours_leer", "Nichts angehakt — erst Touren auswählen."), "warn", 2600);
          return;
        }
        m.close();
        const r = await api().projekt_touren_setzen(b.dataset.addtours, pfade);
        if (r && r.ok) { toast(T("library.proj_tours_gesetzt", "{n} Tour(en) hinzugefügt.").replace("{n}", pfade.length), "info"); renderProjekte(); }
        else toast((r && r.error) || "?", "error");
      };
      const ab = document.getElementById("lib-tp-ab");
      if (ab) ab.onclick = () => m.close();
    });
    box.querySelectorAll("[data-up]").forEach(b => b.onclick = (e) => {
      e.stopPropagation();
      const p = _projekte.find(x => x.id === b.dataset.up) || {};
      const nf = p.neuere_fassung || {};
      const m = openModal({
        title: "⬆ " + T("library.fassung_up", "neuere Version"),
        body: `<p>${T("library.fassung_up_frage", "Dieses Projekt auf die neueste Version der Tour heben (Version {a} → {b})? Die Geometrie hat sich geändert — Keyframes und Schilder können danach anders auf der Strecke liegen. Das Projekt bleibt sonst unverändert; die alte Version bleibt im Archiv erhalten.")
          .replace("{a}", nf.eigene_nr || "?").replace("{b}", nf.nr || "?")}</p>`,
        footer: `<button class="btn" id="lib-up-ab">${T("common.cancel", "Abbrechen")}</button>
                 <button class="btn btn-primary" id="lib-up-ok">${T("library.fassung_up_ok", "Aktualisieren")}</button>`,
      });
      const ok = document.getElementById("lib-up-ok");
      if (ok) ok.onclick = async () => {
        m.close();
        const r = await api().projekt_fassung_aktualisieren(b.dataset.up);
        if (r && r.ok) toast(T("library.fassung_up_done", "Projekt auf die neueste Version gehoben."), "info");
        else toast((r && r.error) || "?", "error");
        renderProjekte();
      };
      const ab = document.getElementById("lib-up-ab");
      if (ab) ab.onclick = () => m.close();
    });
    box.querySelectorAll("[data-del]").forEach(b => b.onclick = () => {
      const p = _projekte.find(x => x.id === b.dataset.del);
      const m = openModal({
        title: "🗑 " + T("library.proj_delete", "Projekt löschen"),
        body: `<p>${T("library.proj_delete_frage", "Dieses Projekt löschen? Die Touren im Archiv bleiben unberührt — nur der Arbeitsstand (Keyframes, Einstellungen) geht verloren.")}</p>
               <div class="lib-hint">${esc((p || {}).name || "")}</div>`,
        footer: `<button class="btn" id="lib-pd-ab">${T("common.cancel", "Abbrechen")}</button>
                 <button class="btn lib-btn-danger" id="lib-pd-ok">${T("library.proj_delete", "Projekt löschen")}</button>`,
      });
      const ok = document.getElementById("lib-pd-ok");
      if (ok) ok.onclick = async () => {
        m.close();
        await api().projekt_loeschen(b.dataset.del);
        renderProjekte();
        toast(T("library.proj_geloescht", "Projekt gelöscht."), "info");
      };
      const ab = document.getElementById("lib-pd-ab");
      if (ab) ab.onclick = () => m.close();
    });
  }

  async function renderProjektDetail(pid) {
    const box = $("lib-detail");
    if (!box) return;
    const res = await api().projekt_detail(pid);
    if (!res || !res.ok) { box.innerHTML = ""; return; }
    const p = res.projekt;
    const kartenInfo = _projekte.find(x => x.id === pid) || {};
    const MODUL_LBL = { animator: ["🎬", "Animator"], reiseroute: ["🧭", "Reiseroute"],
                        tourmap: ["🗺", "Tour-Map"], geotagger: ["📷", "Geotagger"],
                        heightanim: ["📈", T("library.proj_daten", "Daten")] };
    const ablauf = p.frei ? T("library.proj_frei_kurz", "Leeres Projekt")
      : p.ablauf === "schwarm" ? `🌊 ${T("schwarm.name", "Schwarm")} · ${T("animator.pace." + (p.schwarm_modus === "gleich" ? "even" : p.schwarm_modus), p.schwarm_modus)}`
      : p.ablauf === "reise" ? `🧵 ${T("library.proj_reise", "Reise")}`
      : T("library.proj_solo", "Einzeltour");
    const tourZeile = (t2) => `
      <div class="lib-fassung lib-projd-tour" data-tpfad="${esc(t2.path)}" ${t2.exists ? "" : 'style="opacity:.55"'}>
        <span class="lib-fassung-info">${t2.haupt ? "⭐ " : ""}${esc(t2.name)}${
          t2.distance_km ? ` · ${(+t2.distance_km).toFixed(1)} km` : ""}${
          t2.exists ? "" : " · ⚠️"}${
          t2.neuere_fassung ? ` <span class="lib-proj-fehlt">⬆</span>` : ""}</span>
      </div>`;
    const standZeile = (x) => `
      <div class="lib-fassung">
        <span class="lib-fassung-info">${esc(fmtDate(x.ts))} ${esc(String(x.ts).slice(11, 16))} · 🎬 ${x.keyframes} · 🚩 ${x.schilder} · 📷 ${x.fotos}</span>
        <button class="btn btn-ghost btn-sm" data-pd-strb="${esc(x.ts)}">↩︎</button>
      </div>`;
    box.innerHTML = `
      <div class="lib-proj-thumb" data-pdthumb style="height:150px;margin:0 0 10px;border-radius:8px;">${p.frei ? "🗂" : "🗺"}</div>
      <div style="font-weight:700;font-size:15px;margin-bottom:2px;">${esc(p.name)}</div>
      <div class="lib-hint">${ablauf}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin:10px 0;">
        <button class="btn btn-primary btn-sm" data-pd-open>${T("library.proj_open", "Öffnen")}</button>
        ${(kartenInfo.module || []).map(m => {
          const c = MODUL_LBL[m] || ["▫", m];
          return `<button class="btn btn-ghost btn-sm" data-pd-modul="${m}" title="${esc(c[1])}">${c[0]}</button>`;
        }).join("")}
        <button class="btn btn-ghost btn-sm" data-pd-ren title="${T("library.rename", "Umbenennen")}">✎</button>
        <button class="btn btn-ghost btn-sm" data-pd-dup title="${T("library.col_duplicate", "Duplizieren")}">⎘</button>
        <button class="btn btn-ghost btn-sm lib-btn-danger" data-pd-del title="${T("library.proj_delete", "Projekt löschen")}">🗑</button>
      </div>
      <div class="field-label">${T("library.proj_status", "Status")}</div>
      <select class="lib-select" data-pd-status style="width:100%;">
        <option value="aktiv"${p.status === "aktiv" ? " selected" : ""}>${T("library.proj_st_aktiv", "aktiv")}</option>
        <option value="idee"${p.status === "idee" ? " selected" : ""}>${T("library.proj_st_idee", "Idee")}</option>
        <option value="fertig"${p.status === "fertig" ? " selected" : ""}>${T("library.proj_st_fertig", "fertig")}</option>
      </select>
      <div class="field-label" style="margin-top:12px;">${T("library.proj_touren", "Touren")} (${res.touren.length})${p.frei ? ` <button class="btn btn-ghost btn-sm" data-pd-add>➕</button>` : ""}</div>
      ${res.touren.map(tourZeile).join("")
        || `<div class="lib-hint">${T("library.proj_frei", "Noch keine Touren — mit ➕ hinzufügen oder leer öffnen (Reiseroute, Kartenflug)")}</div>`}
      <div class="field-label" style="margin-top:12px;">${T("library.staende", "Frühere Arbeitsstände")} (${res.staende.length})</div>
      ${res.staende.slice().reverse().map(standZeile).join("")
        || `<div class="lib-hint">${T("library.staende_leer", "Noch keine gesicherten Stände — sie entstehen beim Arbeiten von selbst.")}</div>`}
      <div class="lib-hint" style="margin-top:12px;">${T("library.proj_angelegt_am", "Angelegt")}: ${esc(fmtDate(p.created_at))} · ${T("library.proj_geaendert_am", "Zuletzt")}: ${esc(fmtDate(p.modified_at))}</div>`;
    // Vorschau-Bild (Cache des Rasters mitbenutzen).
    { const el = box.querySelector("[data-pdthumb]");
      if (el && _projThumbCache[pid]) el.innerHTML = `<img src="${_projThumbCache[pid]}" alt="">`;
      else if (el && !p.frei) {
        api().projekt_thumbs([pid]).then(r => {
          const u = r && r.thumbs && r.thumbs[pid];
          if (u) { _projThumbCache[pid] = u; el.innerHTML = `<img src="${u}" alt="">`; }
        }).catch(() => {});
      } }
    box.querySelector("[data-pd-open]").onclick = () => projektOeffnen(pid);
    box.querySelectorAll("[data-pd-modul]").forEach(b => b.onclick = () => projektOeffnen(pid, b.dataset.pdModul));
    box.querySelector("[data-pd-status]").onchange = async (e) => {
      await api().projekt_status_setzen(pid, e.target.value);
      renderProjekte();
    };
    box.querySelectorAll(".lib-projd-tour").forEach(z => z.onclick = () => {
      const pf = z.dataset.tpfad;
      if (!pf) return;
      // Zur Tour ins Touren-Archiv springen (gleiche Auswahl-Mechanik).
      store.set("sel", pf);
      _sel = null;
      projViewSetzen(false);
      reload();
    });
    box.querySelectorAll("[data-pd-strb]").forEach(b => b.onclick = async () => {
      const r = await api().projekt_stand_wiederherstellen(pid, b.dataset.pdStrb);
      if (r && r.ok) toast(T("library.stand_done", "Arbeitsstand wiederhergestellt."), "info");
      else toast((r && r.error) || "?", "error");
      renderProjekte();
      renderProjektDetail(pid);
    });
    { const b = box.querySelector("[data-pd-ren]");
      if (b) b.onclick = () => { const k = document.querySelector(`[data-ren="${pid}"]`); if (k) k.click(); }; }
    { const b = box.querySelector("[data-pd-dup]");
      if (b) b.onclick = () => { const k = document.querySelector(`[data-dup="${pid}"]`); if (k) k.click(); }; }
    { const b = box.querySelector("[data-pd-del]");
      if (b) b.onclick = () => { const k = document.querySelector(`[data-del="${pid}"]`); if (k) k.click(); }; }
    { const b = box.querySelector("[data-pd-add]");
      if (b) b.onclick = () => { const k = document.querySelector(`[data-addtours="${pid}"]`); if (k) k.click(); }; }
  }

  /** Öffnen (Q22): Solo lädt die Tour und springt ins zuletzt benutzte Modul;
   *  Kompositionen gehen den bewährten Übergabe-Weg (Pending + Lade-Modal). */
  async function projektOeffnen(pid, modulWunsch) {
    const info = await api().projekt_aktivieren(pid);
    if (!info || !info.ok) { toast((info && info.error) || "?", "error"); return; }
    const k = _projekte.find(x => x.id === pid) || {};
    const modul = modulWunsch || info.letztes_modul || "animator";
    // v0.9.612 (Q1): leeres Projekt — kein Track zu laden, Sitzung direkt
    // aktivieren und ins Modul springen (leere Karte; Reiseroute & Co.
    // speichern ihre Arbeit dann am Projekt).
    if (info.frei) {
      try { if (typeof clearGlobalGpx === "function") clearGlobalGpx(); } catch (_) {}
      if (typeof sessionActivateFrei === "function") await sessionActivateFrei(info.kontext);
      if (typeof switchMod === "function") switchMod(modul);
      return;
    }
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
    const ok = await window.loadGlobalGpx(k.haupt_pfad, { stumm: true });
    if (ok === false) return;
    if (typeof switchMod === "function") switchMod(modul);
  }

  // ── Ansichten ─────────────────────────────────────────────────────────
  function renderView() {
    document.querySelectorAll(".lib-view").forEach(b => b.classList.toggle("is-on", b.dataset.view === view));
    const pv = _projView;
    $("lib-projwrap").hidden = !pv;
    $("lib-head").hidden = pv;
    // v0.9.623: rechte Spalte bleibt — sie zeigt im Projekt-Modus das Projekt.
    // 31.08.2026 (Testrunde): Die Spalte je Modus IMMER neu bestücken —
    // vorher blieb beim Umschalten der Inhalt des anderen Modus stehen
    // (Touren-Hinweis im Projekte-Modus, Projekt-Mehrfachauswahl im Archiv).
    { const d = $("lib-detail");
      if (d) {
        d.hidden = false;
        if (pv) {
          if (_projMulti.size) renderProjMultiPanel();
          else if (_projSel) renderProjektDetail(_projSel);
          else d.innerHTML = `<div class="lib-detail-empty" style="padding:14px">${
            T("library.proj_detail_hint", "Projekt anklicken — dann erscheinen hier Details, Touren und frühere Arbeitsstände. Mehrere wählen: ⌘/Strg-Klick.")}</div>`;
        } else {
          try { renderDetail(); } catch (_) {}
        }
      } }
    $("lib-grid").hidden = pv || view !== "cards";
    $("lib-list").hidden = pv || view !== "list";
    $("lib-mapwrap").hidden = pv || view !== "map";
    $("lib-stats").hidden = pv || view !== "stats";
    if (pv) { renderProjekte(); return; }
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
    // ⚠️ JEDES Merkmal hier ist absolut positioniert (siehe .lib-badge im CSS)
    // und braucht eine eigene Ecke. Zwei ohne eigene Position liegen exakt
    // übereinander — genau so verschwand „V2" unter „2×" (02.09.2026, auf
    // Marcs Rechner gesehen). Deshalb sitzen die Merkmale oben links jetzt in
    // EINER Reihe nebeneinander statt jedes für sich.
    const linksOben = [
      it.fav ? `<span class="lib-badge-in lib-badge-fav">★</span>` : "",
      // 02.09.2026, vom Waechter gefunden (Altfehler): "nicht auffindbar" sass
      // in derselben Ecke wie "hat Projekte" — eine Tour mit beidem zeigte nur
      // eines davon. In der Reihe kann das nicht mehr passieren.
      it.missing_since ? `<span class="lib-badge-in lib-badge-missing" title="${esc(
          T("library.missing_hint", "Die Datei ist gerade nicht auffindbar — Platte nicht angeschlossen?"))}">🔌</span>` : "",
      (it.n_versionen || 1) > 1 ? `<span class="lib-badge-in lib-badge-ver" title="${esc(
          T("library.versionen_titel", "Diese Tour hat {n} Versionen — die neueste wird gezeigt.")
            .replace("{n}", it.n_versionen))}">V${it.n_versionen}</span>` : "",
      (it.n_dateien || 1) > 1 ? `<span class="lib-badge-in lib-badge-orte" title="${esc(
          T("library.orte_titel", "Diese Tour stammt aus {n} Dateien. Sie liegt vollständig in deiner Bibliothek.")
            .replace("{n}", it.n_dateien))}">${it.n_dateien}×</span>` : "",
    ].filter(Boolean).join("");
    return `
      ${linksOben ? `<span class="lib-badge-grp">${linksOben}</span>` : ""}
      ${it.recorded_eff ? "" : `<span class="lib-badge lib-badge-plan">${T("library.planned", "geplant")}</span>`}
      ${it.hidden ? `<span class="lib-badge lib-badge-hidden">${T("library.hidden_short", "aus")}</span>` : ""}
      ${it.has_session ? `<span class="lib-badge lib-badge-proj" title="${esc(T("library.has_project", "Für diese Tour gibt es gespeicherte Projekte"))}">●</span>` : ""}`;
  }

  // Karten- und Zeilen-HTML als Helfer: Voll-Render und Nachladen (Anhängen)
  // müssen exakt dasselbe erzeugen, sonst sehen nachgeladene Kacheln anders aus.
  function cardHtml(it, i) {
    return `
      <button class="lib-card${_multi.has(it.path) ? " is-multi" : (_sel && _sel.path === it.path ? " is-sel" : "")}" data-i="${i}" type="button">
        <span class="lib-card-thumb">
          ${thumbImg(it, "card")}
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
          <span class="lib-row-thumb">${thumbImg(it, "row")}</span>
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

  // ── 22.08.2026 — Fenster-Rendering („virtualisierte Liste") ──────────────
  // Es stehen nur die sichtbaren Kacheln/Zeilen (± Puffer) im DOM; davor und
  // dahinter halten zwei Platzhalter die Scrollhöhe. Vorher wuchs das DOM mit
  // jedem Nachladen (10.000 Touren = 10.000 Kacheln mit Bild), und jede
  // Auswahl baute alles neu auf. Vorschaubilder kommen jetzt gezielt für das
  // Fenster (library_thumbs), nicht mehr als Teil jeder Abfrage.
  const _fenster = { cards: { h: 0, cols: 1 }, list: { h: 0 } };
  const PUFFER_ZEILEN = 6;
  let _fensterRaf = 0;

  function fensterMessen(el, art) {
    const f = _fenster[art];
    const probe = el.querySelector(art === "cards" ? ".lib-card" : ".lib-row:not(.lib-row-head)");
    if (probe) f.h = Math.max(1, probe.getBoundingClientRect().height + (art === "cards" ? 12 : 0));
    if (art === "cards") {
      try { f.cols = Math.max(1, getComputedStyle(el).gridTemplateColumns.split(" ").length); } catch (_) {}
    }
    return f;
  }

  function fensterBereich(el, art) {
    const f = _fenster[art];
    const cols = art === "cards" ? f.cols : 1;
    const h = f.h || (art === "cards" ? 200 : 34);
    const kopf = art === "list" ? 26 : 0;
    const top = Math.max(0, el.scrollTop - kopf);
    const zeilen = Math.ceil(el.clientHeight / h) + PUFFER_ZEILEN * 2;
    const ersteZeile = Math.max(0, Math.floor(top / h) - PUFFER_ZEILEN);
    const gesamtZeilen = Math.ceil(_items.length / cols);
    const letzteZeile = Math.min(gesamtZeilen, ersteZeile + zeilen);
    return {
      start: ersteZeile * cols, end: Math.min(_items.length, letzteZeile * cols),
      oben: ersteZeile * h, unten: Math.max(0, (gesamtZeilen - letzteZeile) * h),
    };
  }

  function fensterHtml(el, art, inhalt) {
    const b = fensterBereich(el, art);
    const span = art === "cards" ? "grid-column:1/-1;" : "";
    const teile = [];
    for (let i = b.start; i < b.end; i++) teile.push(inhalt(_items[i], i));
    el._fensterBereich = b;
    return `<div class="lib-platz" style="${span}height:${b.oben}px"></div>` +
      teile.join("") + `<div class="lib-platz" style="${span}height:${b.unten}px"></div>`;
  }

  let _messungLaeuft = false;
  function fensterNachMessung(el, art) {
    if (_messungLaeuft) return;          // nie rekursiv nachmessen
    const vorher = _fenster[art].h, colsVorher = _fenster[art].cols;
    const f = fensterMessen(el, art);
    // Nur bei echter Änderung (> 1 px / andere Spaltenzahl) EINMAL neu setzen.
    // WebKit lieferte beim Umschalten der Scrollleiste minimal andere Höhen —
    // ohne Schwelle baute sich das Fenster endlos neu (99 % CPU, 4 GB).
    if (Math.abs(vorher - f.h) > 1 || (art === "cards" && colsVorher !== f.cols)) {
      _messungLaeuft = true;
      try { if (art === "cards") renderGrid(); else renderList(); }
      finally { _messungLaeuft = false; }
    }
  }

  /** Beim Scrollen: nur neu bauen, wenn sich das Fenster verschoben hat. */
  function fensterAktualisieren(el, art) {
    if (_fensterRaf) return;
    _fensterRaf = requestAnimationFrame(() => {
      _fensterRaf = 0;
      if (_unmounted || !el.isConnected || !_items.length) return;
      const b = fensterBereich(el, art), alt = el._fensterBereich;
      if (alt && alt.start === b.start && alt.end === b.end) return;
      if (art === "cards") renderGrid(); else renderList();
    });
  }

  // Vorschaubilder nur fürs Fenster holen; Vorrat begrenzen, damit 10.000
  // Touren nicht 10.000 data-URLs im Speicher halten.
  const THUMB_VORRAT = 900;
  let _thumbAnfrage = 0;
  async function fensterThumbs(el) {
    const b = el._fensterBereich; if (!b) return;
    const fehlt = [];
    for (let i = b.start; i < b.end; i++) {
      const it = _items[i];
      if (it && it.image && !it.thumb_url && it.thumb_url !== "") fehlt.push(it.image);
    }
    if (!fehlt.length) return;
    const meine = ++_thumbAnfrage;
    const res = await api().library_thumbs(fehlt.slice(0, 400));
    if (_unmounted || !res || !res.ok) return;
    for (let i = b.start; i < b.end; i++) {
      const it = _items[i];
      if (!it || !it.image || it.thumb_url) continue;
      if (res.thumbs[it.image] === undefined) continue;
      it.thumb_url = res.thumbs[it.image] || "";
      const img = el.querySelector(`[data-i="${i}"] img[data-lazy]`);
      if (img && it.thumb_url) { img.src = it.thumb_url; img.removeAttribute("data-lazy"); }
      else if (img && !it.thumb_url) img.remove();
    }
    // Vorrat stutzen: weit weg vom Fenster vergessen
    let vorrat = 0;
    for (const it of _items) if (it.thumb_url) vorrat++;
    if (vorrat > THUMB_VORRAT) {
      for (let i = 0; i < _items.length; i++) {
        if (i >= b.start - 300 && i < b.end + 300) continue;
        if (_items[i].thumb_url) { delete _items[i].thumb_url; if (--vorrat <= THUMB_VORRAT) break; }
      }
    }
    if (meine !== _thumbAnfrage) return;
  }

  function thumbImg(it, klasse) {
    if (it.thumb_url) return `<img src="${it.thumb_url}" alt="" loading="lazy">`;
    if (it.thumb_url === "" || !it.image) return klasse === "card" ? `<span class="lib-card-nothumb">?</span>` : "";
    return `<img data-lazy="1" alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==">`;
  }

  function renderGrid() {
    if (!_items.length) { grid.innerHTML = emptyHtml(); bindEmpty(); return; }
    grid.innerHTML = fensterHtml(grid, "cards", (it, i) => cardHtml(it, i));
    bindItemClicks(grid);
    fensterNachMessung(grid, "cards");
    fensterThumbs(grid);
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
      ${fensterHtml(box, "list", (it, i) => rowHtml(it, i))}`;
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
    fensterNachMessung(box, "list");
    fensterThumbs(box);
  }

  function bindItemClicks(root) {
    root.querySelectorAll("[data-i]").forEach(btn => {
      btn.onclick = (e) => {
        const i = parseInt(btn.dataset.i, 10);
        const it = _items[i];
        if (!it) return;
        if (e.metaKey || e.ctrlKey) {
          // Einzeln dazu oder weg. ⚠️ Die zuerst NORMAL angeklickte Tour steht
          // nur in `_sel`, nie in `_multi` — ein ⌘-Klick auf genau sie hätte
          // sie deshalb HINZUGEFÜGT statt abgewählt („ich muss falsch
          // ausgewählte wieder abwählen können", Marc 28.08.2026). Darum wird
          // die Einzel-Auswahl beim ersten ⌘-Klick erst Teil der Menge — wie
          // im Finder.
          if (!_multi.size && _sel) _multi.add(_sel.path);
          if (_multi.has(it.path)) _multi.delete(it.path); else _multi.add(it.path);
          if (_multi.size) {
            _sel = _multi.has(it.path) ? it : (multiItems()[0] || null);
          } else {
            _sel = null;             // alles abgewählt → auch die Detailspalte leeren
          }
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
      btn.ondblclick = () => {
        if (_multi.size > 1) return;
        // Im Ghost-Modus heißt Doppelklick „diese hier" — NICHT „öffnen", was den
        // Haupt-Track ersetzen würde (Marc, 27.08.2026).
        const dbl = _items[parseInt(btn.dataset.i, 10)];
        if (_ghostModus()) { if (dbl) alsGhost([dbl.path]); return; }
        openIn("animator");
      };
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
  let _vglSort  = store.getJson("vgl_sort", { spalte: "", ab: false });
  // Spalten zusammenfassen (Wunsch Beta-Tester). Wer drei Räder getrennt führt,
  // hat sonst fünf schmale Rad-Spalten, wo eine breite die Frage beantwortet:
  // wie viel war ich überhaupt mit dem Rad unterwegs?
  let _vglGrp   = store.getJson("vgl_grp", false);

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
    const roh = _vglEbene === "year" ? (s.act_by_year || [])
      : _vglEbene === "week" ? (s.act_by_week || [])
      : (s.act_by_month || []);
    if (!roh.length) return "";

    // Zeiträume und Arten einsammeln — beides in der Reihenfolge, in der es
    // auftritt bzw. nach Gesamtgröße.
    const zeitraeume = [];
    const proArt = new Map();
    const zellen = new Map();      // "zeitraum|art" → Wert
    for (const r of roh) {
      if (!r.activity) continue;   // ohne erkannte Art hilft der Vergleich nicht
      const z = _vglEbene === "year" ? String(r.year)
        : _vglEbene === "week" ? r.week : r.month;
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
    const label = (z) => {
      if (_vglEbene === "year") return z;
      // ISO-Woche kommt als „2025-W23" — daraus wird „KW 23 '25".
      if (_vglEbene === "week") return `KW ${z.slice(6)} '${z.slice(2, 4)}`;
      return `${MONTHS[parseInt(z.slice(5, 7), 10) - 1]} ${z.slice(2, 4)}`;
    };

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
            <button type="button" class="lib-vgl-btn${_vglEbene === "week" ? " is-on" : ""}" data-vgl-ebene="week"
              title="${esc(T("library.stat_by_week_tip", "Nach ISO-Kalenderwochen. Am sinnvollsten zusammen mit einem eingestellten Zeitraum — sonst werden es sehr viele Zeilen."))}"
              >${T("library.stat_by_week", "Wochen")}</button>
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
              ${vglKopf("", _vglEbene === "year" ? T("library.year", "Jahr")
                : _vglEbene === "week" ? T("library.week", "Woche")
                : T("library.month", "Monat"))}
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
          T("library.stat_sort_hint", "Kopfzeile anklicken zum Sortieren")}${
          // Wochen über Jahre hinweg sind hunderte Zeilen. Statt sie zu
          // deckeln (und damit still etwas wegzulassen) sagen wir, was hilft.
          (_vglEbene === "week" && sichtbar.length > 60 && !state.von && !state.bis)
            ? " · " + T("library.stat_week_hint",
                "{n} Wochen — mit einem Zeitraum oben wird die Tabelle lesbar.")
                .replace("{n}", num(sichtbar.length))
            : ""}</div>
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
        store.setJson("vgl_grp", _vglGrp);
        // Die Sortierung zeigte womöglich auf eine Spalte, die es jetzt nicht
        // mehr gibt („Rennrad" nach dem Zusammenfassen) — dann zurück auf
        // chronologisch, statt still nach etwas Verschwundenem zu sortieren.
        if (_vglSort.spalte && _vglSort.spalte !== "sum") {
          _vglSort = { spalte: "", ab: false };
          store.setJson("vgl_sort", _vglSort);
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
        store.setJson("vgl_sort", _vglSort);
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
        if (!it) return;
        // ⚠️ Das Objekt aus der geladenen Liste ist das richtige (an ihm hängen
        // Auswahl und spätere Änderungen), aber in Karten- und Statistikansicht
        // wird OHNE Vorschaubilder geladen — es hat dort kein `thumb_url`. Die
        // Statistik liefert eins mit; ohne diese Übergabe stünde im Detail der
        // Platzhalter 🗺️, den ein Nutzer zu Recht für ein kaputtes Bild hielt.
        const treffer = _items.find(x => x.path === it.path);
        if (treffer && !treffer.thumb_url && it.thumb_url) treffer.thumb_url = it.thumb_url;
        select(treffer || it);
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
  /**
   * Karten-Bild samt Quellenangabe.
   *
   * ⚠️ `getCanvas().toDataURL()` liefert NUR die WebGL-Fläche — die
   * Quellenangabe („© Mapbox © OpenStreetMap") ist ein HTML-Element daneben und
   * fehlte im gesicherten Bild komplett. Das ist kein Schönheitsfehler:
   * Mapbox verlangt die Nennung vertraglich, OpenStreetMap-Daten stehen unter
   * einer Lizenz, die sie ebenfalls verlangt.
   *
   * Der Text wird aus der Karte selbst gelesen, nicht fest eingetragen — so
   * stimmt er automatisch, egal ob gerade Mapbox oder der OSM-Rückfall läuft.
   */
  async function mitQuellenangabe(karte) {
    const quelle = karte.getCanvas();
    const roh = quelle.toDataURL("image/png");
    let text = "";
    try {
      const el = document.querySelector(".mapboxgl-ctrl-attrib-inner, .maplibregl-ctrl-attrib-inner");
      text = (el ? el.textContent : "").replace(/\s+/g, " ").trim();
    } catch (_) {}
    if (!text) return roh;              // nichts gefunden → lieber das Bild als gar nichts

    const bild = await new Promise((ok, fehler) => {
      const i = new Image();
      i.onload = () => ok(i); i.onerror = fehler; i.src = roh;
    });
    const c = document.createElement("canvas");
    c.width = bild.width; c.height = bild.height;
    const g = c.getContext("2d");
    g.drawImage(bild, 0, 0);

    // Am Bild skalieren, damit die Zeile bei großen Karten nicht winzig wird.
    const gr = Math.max(11, Math.round(bild.width / 110));
    g.font = `${gr}px -apple-system, "Segoe UI", Roboto, sans-serif`;
    const breite = g.measureText(text).width;
    const pad = Math.round(gr * 0.55), hoehe = Math.round(gr * 1.9);
    const x = bild.width - breite - pad * 2, y = bild.height - hoehe;
    g.fillStyle = "rgba(255,255,255,0.75)";
    g.fillRect(x, y, breite + pad * 2, hoehe);
    g.fillStyle = "#333";
    g.textBaseline = "middle";
    g.fillText(text, x + pad, y + hoehe / 2);
    return c.toDataURL("image/png");
  }

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
      const url = await mitQuellenangabe(_map);
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
        <div class="lib-pop-title" title="${esc(T("library.pop_drag", "Zum Verschieben ziehen"))}">${esc(it.name)}</div>
        <div class="lib-pop-sub">${fmtDate(it.started_at)}
          ${it.activity ? " · " + esc(ACT_LABELS[it.activity] || it.activity) : ""}
          ${it.recorded_eff ? "" : " · " + T("library.planned", "geplant")}</div>
        <div class="lib-pop-stats">
          ${rows.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}
        </div>
        <div class="lib-colchips lib-pop-cols"></div>
        <div class="lib-pop-btns">
          ${_ghostModus()
            ? `<button class="btn btn-primary btn-sm" data-pop="ghost">👻 ${T("library.ghost.take", "Als Ghost-Spur übernehmen")}</button>`
            : `<button class="btn btn-primary btn-sm" data-pop="open">${T("library.open_animator", "Im Animator öffnen")}</button>
          <button class="btn btn-sm" data-pop="ghost">👻 ${T("library.ghost.take_short", "Als Ghost-Spur")}</button>
          <button class="btn btn-sm" data-pop="col">+ ${T("library.col_add", "Zu Sammlung")}</button>`}
        </div>
      </div>`).addTo(_map);
    const el = _mapPopup.getElement();
    if (!el) return;
    const o = el.querySelector('[data-pop="open"]'); if (o) o.onclick = () => openIn("animator");
    const g = el.querySelector('[data-pop="ghost"]'); if (g) g.onclick = () => alsGhost([it.path]);
    const c = el.querySelector('[data-pop="col"]'); if (c) c.onclick = () => addToCollectionDialog([it.path]);
    const cb = el.querySelector(".lib-pop-cols");
    if (cb) renderColChips(cb, it, { popup: true });
    // 28.08.2026 (Marc): Die Info-Karte muss verschiebbar sein — sie verdeckt
    // sonst genau die Touren, die man vergleichen will. Anfassen am Titel;
    // das Popup bleibt an einer Karten-Koordinate verankert (unproject), zieht
    // beim Schwenken/Zoomen also weiter korrekt mit.
    const kopf = el.querySelector(".lib-pop-title");
    if (kopf) {
      kopf.style.cursor = "grab";
      kopf.onmousedown = (ev) => {
        ev.preventDefault();
        const start = _map.project(_mapPopup.getLngLat());
        const sx = ev.clientX, sy = ev.clientY;
        kopf.style.cursor = "grabbing";
        const ziehen = (m) => {
          if (!_mapPopup) return;
          _mapPopup.setLngLat(_map.unproject([start.x + (m.clientX - sx), start.y + (m.clientY - sy)]));
        };
        const loslassen = () => {
          document.removeEventListener("mousemove", ziehen);
          document.removeEventListener("mouseup", loslassen);
          kopf.style.cursor = "grab";
        };
        document.addEventListener("mousemove", ziehen);
        document.addEventListener("mouseup", loslassen);
      };
    }
  }
  function closeMapPopup() {
    if (_mapPopup) { try { _mapPopup.remove(); } catch (_) {} _mapPopup = null; }
  }
  // 28.08.2026 (Marc): Verschwindet eine Tour von der Karte (aus der
  // Sammlung genommen), soll die Kamera stehen bleiben — nicht auf die
  // Default-Zoomstufe aller Touren zurückspringen. Einmal-Flag, vom
  // Chip-✕ gesetzt, beim nächsten Daten-Update verbraucht.
  let _mapKeepCamera = false;
  function applyMapData(data) {
    const src = _map.getSource("lib-tracks");
    if (src) {
      src.setData(data);
      if (_mapKeepCamera) _mapKeepCamera = false;
      else fitAll(data);
    }
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
    // (Das Vorschaubild holt `renderDetail()` — auf jedem Weg dorthin.)
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
  /** 23.08.2026 (Marc) — Mehrere Touren zu EINEM Video-Track zusammenführen.
   *  Reihenfolge per Griff (⠿, wie in der Reiseroute), Übergangs-Stil je Lücke.
   *  Ergebnis ist eine normale GPX unter „Zusammengefügt" — der Animator braucht
   *  dafür keinen Sonderfall (siehe core/merge.py). */
  function openMergeDialog(items) {
    if (!items || items.length < 2) { toast(T("library.merge.min2", "Mindestens zwei Touren auswählen (⌘-Klick)."), "warn"); return; }
    // Vorgabe: nach Datum, das ist fast immer die Erzähl-Reihenfolge.
    let liste = items.slice().sort((a, b) => String(a.started_at || "").localeCompare(String(b.started_at || "")));
    const stile = [
      ["kino", T("library.merge.style_kino", "Kino-Flug (Verbindung unsichtbar)")],
      ["luftlinie", T("library.merge.style_arc", "Luftlinie (sichtbar)")],
      ["strasse", T("library.merge.style_road", "Straße folgen (echte Anreise)")],
      ["schnitt", T("library.merge.style_cut", "Harter Schnitt (ohne Übergang)")],
    ];
    const zeilen = () => liste.map((it, i) => `
      <div class="lib-merge-row" data-i="${i}">
        <span class="lib-merge-handle" title="${T("route.drag", "Ziehen, um die Reihenfolge zu ändern")}">⠿</span>
        <span class="lib-merge-n">${i + 1}</span>
        <span class="lib-merge-name">${esc(it.display_name || it.name || "")}</span>
        <span class="lib-merge-meta">${fmtDate(it.started_at)} · ${fmtKmVal(it.distance_m || 0)}</span>
      </div>`).join("");
    const m = openModal({
      title: T("library.merge.title", "Touren zusammenführen"),
      body: `
        <p class="muted" style="font-size:12px; line-height:1.45; margin:0 0 10px;">${T("library.merge.hint", "")}</p>
        <div class="field"><label class="field-label">${T("library.merge.order", "Reihenfolge (ziehen zum Sortieren)")}</label>
          <div id="lib-merge-list" class="lib-merge-list">${zeilen()}</div></div>
        <div class="field"><label class="field-label">${T("library.merge.transition", "Übergang zwischen den Touren")}</label>
          <select id="lib-merge-stil" class="lib-select">${stile.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join("")}</select></div>
        <div class="field" id="lib-merge-dauer-field"><label class="field-label">${T("library.merge.duration", "Dauer je Übergang")} <span class="label-val" id="lib-merge-dauer-v">3.0 s</span></label>
          <input type="range" id="lib-merge-dauer" min="1" max="8" step="0.5" value="3"></div>
        <div class="field"><label class="field-label">${T("library.merge.name", "Name")}</label>
          <input type="text" id="lib-merge-name" class="lib-input" value=""></div>
        <div class="lib-hint" id="lib-merge-status"></div>`,
      footer: `<button class="btn" id="lib-merge-cancel">${T("common.cancel", "Abbrechen")}</button>
               <button class="btn btn-primary" id="lib-merge-go">${T("library.merge.go", "Zusammenführen und öffnen")}</button>`,
    });
    const host = () => document.getElementById("lib-merge-list");
    const namensfeld = () => document.getElementById("lib-merge-name");
    const nameVorschlag = () => liste.map(x => x.display_name || x.name || "").filter(Boolean).slice(0, 3).join(" + ")
      + (liste.length > 3 ? " …" : "");
    const neuZeichnen = () => {
      const h = host(); if (!h) return;
      h.innerHTML = zeilen();
      binden();
      const nf = namensfeld();
      if (nf && !nf._userEdited) nf.value = nameVorschlag();
    };
    let ziehtVon = -1;
    const binden = () => {
      host().querySelectorAll(".lib-merge-row").forEach((row) => {
        const i = +row.dataset.i;
        const griff = row.querySelector(".lib-merge-handle");
        if (griff) griff.addEventListener("mousedown", () => { row.draggable = true; });
        row.addEventListener("dragstart", (ev) => {
          ziehtVon = i; row.classList.add("dragging");
          try { ev.dataTransfer.effectAllowed = "move"; ev.dataTransfer.setData("text/plain", String(i)); } catch (_) {}
        });
        row.addEventListener("dragend", () => {
          row.draggable = false; row.classList.remove("dragging");
          host().querySelectorAll(".drag-over").forEach(r => r.classList.remove("drag-over"));
        });
        row.addEventListener("dragover", (ev) => { if (ziehtVon < 0) return; ev.preventDefault(); ev.stopPropagation(); row.classList.add("drag-over"); });
        row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
        row.addEventListener("drop", (ev) => {
          // stopPropagation: sonst fängt die Archiv-Import-Dropzone das
          // interne Sortier-Drag ab und meldet „keine Dateien".
          ev.preventDefault(); ev.stopPropagation(); row.classList.remove("drag-over");
          if (ziehtVon < 0 || ziehtVon === i) { ziehtVon = -1; return; }
          const [x] = liste.splice(ziehtVon, 1); liste.splice(i, 0, x); ziehtVon = -1;
          neuZeichnen();
        });
      });
    };
    binden();
    const nf = namensfeld();
    if (nf) { nf.value = nameVorschlag(); nf.addEventListener("input", () => { nf._userEdited = true; }); }
    const stil = document.getElementById("lib-merge-stil");
    const dauer = document.getElementById("lib-merge-dauer");
    const dauerV = document.getElementById("lib-merge-dauer-v");
    const dauerFeld = document.getElementById("lib-merge-dauer-field");
    const syncStil = () => { if (dauerFeld) dauerFeld.style.display = (stil.value === "schnitt") ? "none" : ""; };
    stil.addEventListener("change", syncStil); syncStil();
    dauer.addEventListener("input", () => { if (dauerV) dauerV.textContent = (+dauer.value).toFixed(1) + " s"; });
    document.getElementById("lib-merge-cancel").onclick = () => m.close();
    document.getElementById("lib-merge-go").onclick = async () => {
      const st = document.getElementById("lib-merge-status");
      const knopf = document.getElementById("lib-merge-go");
      const frei = knopfBeschaeftigt("lib-merge-go", "library.merge.running", "Wird zusammengeführt …");
      if (st) st.textContent = "";
      const uebergaenge = liste.slice(1).map(() => ({ stil: stil.value, dauer_s: +dauer.value || 3 }));
      let r;
      try {
        r = await api().library_merge({ paths: liste.map(x => x.path), name: (nf && nf.value) || "", uebergaenge });
      } catch (e) { r = { ok: false, error: String(e) }; }
      if (frei) frei();
      if (!r || !r.ok) { if (st) st.textContent = "⚠ " + ((r && r.error) || "?"); void knopf; return; }
      m.close();
      _multi.clear();
      toast(T("library.merge.done", "Zusammengeführt: {n} Touren").replace("{n}", liste.length), "success", 5000);
      scope = "merged"; store.set("scope", scope);
      await reload(); renderScopes();
      // Direkt im Animator öffnen — der Track ist ab jetzt ein ganz normaler.
      try {
        const ok = await window.loadGlobalGpx(r.path, { stumm: true });
        // Farbe je Tour ins (frisch angelegte) Projekt des zusammengeführten Tracks.
        if (ok !== false && r.farben && typeof saveProjectSettings === "function") {
          try { saveProjectSettings("animator", { tour_colors: r.farben }); } catch (_) {}
        }
        if (ok !== false && typeof switchMod === "function") switchMod("animator");
      } catch (e) { console.warn("merge open", e); }
    };
  }

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
        ${_ghostModus() ? "" : `<button class="btn btn-primary btn-sm" id="lib-m-merge" style="width:100%;">${T("library.merge.action", "🧭 Zu einem Video zusammenführen …")}</button>`}
        ${_ghostModus() ? "" : `<button class="btn btn-sm" id="lib-m-schwarm" style="width:100%;margin-top:6px;" title="${
          esc(T("schwarm.hint", "Alle markierten Touren starten gleichzeitig und laufen nebeneinander — die längste bestimmt die Videodauer."))
        }">🌊 ${T("schwarm.action", "Als Schwarm animieren …")}</button>`}
      <!-- 27.08.2026 — Markierte Touren als Ghost-Spuren in den Animator: nicht
           animiert, sondern als Hintergrundlinien (offizieller Weg, Planungen …).
           Gleicher Übergabeweg wie „Alle im Animator" (window.__rzPendingGhosts). -->
      <button class="btn ${_ghostModus() ? "btn-primary" : ""} btn-sm" id="lib-m-ghosts" style="width:100%;margin-top:6px;">${
        _ghostModus() ? `👻 ${T("library.ghost.take_n", "Diese {n} als Ghost-Spuren übernehmen").replace("{n}", _multi.size)}`
                      : T("library.ghosts.action", "👻 Als Ghost-Spur in den Animator")}</button>
      </div>
      ${_ghostModus() ? "" : `<div class="lib-actions">
        <button class="btn btn-ghost btn-sm" id="lib-m-fav">★ ${T("library.fav_on", "Als Favorit")}</button>
        <button class="btn btn-ghost btn-sm" id="lib-m-unfav">${T("library.fav_off", "Favorit weg")}</button>
      </div>
      <div class="lib-actions lib-danger">
        <button class="btn btn-ghost btn-sm" id="lib-m-hide">${T("library.hide", "Ausblenden")}</button>
        <button class="btn btn-ghost btn-sm lib-btn-danger" id="lib-m-trash">${T("library.trash", "In den Papierkorb")}</button>
      </div>`}
      <div class="lib-hint" id="lib-m-status"></div>`;
    box.innerHTML = _ghostBannerHtml() + box.innerHTML;
    _ghostBannerBinden();

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
    const mMerge = $("lib-m-merge");
    if (mMerge) mMerge.onclick = () => openMergeDialog(multiItems());
    const mSchwarm = $("lib-m-schwarm");
    if (mSchwarm) mSchwarm.onclick = () => alsSchwarmInDenAnimator(multiItems());
    const ghostBtn = $("lib-m-ghosts");
    if (ghostBtn) {
      ghostBtn.onclick = () => {
        alsGhost(multiItems().map(i => i.path));
      };
    }

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
    const mFav = $("lib-m-fav"), mUnfav = $("lib-m-unfav");
    if (mFav) mFav.onclick = () => favSetzen(true);
    if (mUnfav) mUnfav.onclick = () => favSetzen(false);

    const mHide = $("lib-m-hide");
    if (mHide) mHide.onclick = async () => {
      for (const p of pfade()) await api().library_set_hidden(p, true);
      _multi.clear(); reload();
    };
    const mTrash = $("lib-m-trash");
    if (mTrash) mTrash.onclick = async () => {
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
      box.innerHTML = _ghostBannerHtml() + `<div class="lib-detail-empty">${T("library.pick_hint", "Tour auswählen — dann kannst du sie hier direkt in ein Werkzeug übernehmen.")}
        <div class="lib-hint" style="margin-top:10px">${T("library.multi_hint", "Mehrere wählen: ⌘/Strg-Klick einzeln, Umschalt-Klick für einen Bereich.")}</div></div>`;
      _ghostBannerBinden();
      return;
    }
    const it = _sel;
    // 02.09.2026, Audit („das Detail-Vorschaubild fehlt"): Das Bild wurde nur
    // in `select()` nachgeladen. Wer die Tour NICHT anklickt — gemerkte
    // Auswahl beim Betreten, `reload()` nach einem Rollback — landete hier
    // ohne `thumb_url`, und zwar dauerhaft: Der Platzhalter 🗺️ blieb stehen,
    // obwohl das Bild auf der Platte lag. Deshalb wird es dort geholt, wo es
    // gebraucht wird, nicht nur auf dem einen Weg dorthin.
    if (it.image && it.thumb_url === undefined && !it._thumbLaeuft) {
      it._thumbLaeuft = true;
      api().library_thumbs([it.image]).then(r => {
        it._thumbLaeuft = false;
        if (_unmounted || !r || !r.ok) { it.thumb_url = ""; return; }
        it.thumb_url = r.thumbs[it.image] || "";
        if (_sel === it) renderDetail();
      }).catch(() => { it._thumbLaeuft = false; it.thumb_url = ""; });
    }
    const rows = kennzahlen(it);
    box.innerHTML = _ghostBannerHtml() + `
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
        ${_ghostModus()
          ? `<button class="btn btn-primary btn-sm lib-ghost-take" data-ghost="1" style="width:100%">👻 ${
              T("library.ghost.take", "Als Ghost-Spur übernehmen")}</button>`
          : `<button class="btn btn-primary btn-sm" data-open="animator">${T("library.open_animator", "Im Animator öffnen")}</button>
        <button class="btn btn-sm" data-open="tourmap">${T("library.open_tourmap", "Tour-Karte")}</button>
        <button class="btn btn-sm" data-open="heightanim">${T("library.open_height", "Daten-Animator")}</button>
        <button class="btn btn-sm" data-open="geotagger">${T("library.open_geotagger", "Fotos verorten")}</button>
        <button class="btn btn-sm" data-open="gpxinspect">${T("library.open_inspect", "Inspektor")}</button>
        <button class="btn btn-sm" data-ghost="1" title="${esc(T("library.ghost.hint",
            "Legt die Tour als unbewegte Hintergrundlinie in den Animator — der Haupt-Track bleibt, wie er ist."))
          }">👻 ${T("library.ghost.take_short", "Als Ghost-Spur")}</button>`}
      </div>

      <div class="lib-detail-rows" id="lib-d-rows">
        ${rows.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}
      </div>
      <!-- 02.09.2026 (Marc): Die Versionen gehören DIREKT unter die Kennzahlen —
           beim Anklicken zeigt die Tabelle darüber die Werte dieser Version.
           Sonst sind zwei Versionen derselben Tour nicht unterscheidbar. -->
      <div id="lib-d-fassungen" style="margin-top:8px;"></div>
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
      <div id="lib-d-projekte" class="lib-hint" style="margin-top:6px;"></div>

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
    box.querySelectorAll("[data-ghost]").forEach(b => { b.onclick = () => alsGhost(_sel ? [_sel.path] : []); });
    _ghostBannerBinden();
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
    // E1 (Q21): Von der Tour zu ihren Projekten springen.
    (async () => {
      const el = document.getElementById("lib-d-projekte");
      if (!el) return;
      try {
        const res = await api().projekte_liste();
        // Abnahme 29.08.2026: über die GANZE Versions-Kette zählen — ein auf
        // Version 1 gepinntes Projekt gehört auch zu dieser Tour.
        let kette = [it.geo_hash];
        try {
          const fs = await api().tour_fassungen(it.geo_hash);
          if (fs && fs.ok && fs.fassungen && fs.fassungen.length)
            kette = fs.fassungen.map(f => f.geo_hash);
        } catch (_) {}
        const meine = ((res && res.projekte) || [])
          .filter(p => !p.auto && (p.geo_hashes || []).some(g => kette.includes(g)));
        if (!meine.length) { el.textContent = ""; return; }
        el.innerHTML = `🎬 <a href="#" id="lib-d-proj-link">${
          T("library.proj_in", "steckt in {n} Projekt(en) — ansehen").replace("{n}", meine.length)}</a>`;
        const a2 = document.getElementById("lib-d-proj-link");
        if (a2) a2.onclick = (e) => {
          e.preventDefault();
          _projFilterGh = it.geo_hash;
          projViewSetzen(true);
        };
      } catch (_) { el.textContent = ""; }
    })();

    // E3 (IDEAS §39): Versions-Kette der Tour — jede Heilung/Ersetzung/extern
    // erkannte Änderung ist eine Version; Rollback holt sie byte-genau zurück.
    (async () => {
      const el = document.getElementById("lib-d-fassungen");
      if (!el) return;
      try {
        const res = await api().tour_fassungen(it.geo_hash);
        const fs = (res && res.fassungen) || [];
        if (fs.length < 2) { el.innerHTML = ""; return; }
        const QUELLE = { import: T("library.fq_import", "eingelesen"),
                         werkzeug: T("library.fq_werkzeug", "geheilt/ersetzt"),
                         extern: T("library.fq_extern", "extern geändert"),
                         rollback: T("library.fq_rollback", "wiederhergestellt"),
                         backup: T("library.fq_backup", "aus Sicherung") };
        el.innerHTML = `<div class="field-label">${T("library.fassungen", "Versionen")} (${fs.length})</div>`
          + `<div class="lib-hint" id="lib-d-vhint" hidden></div>`
          // 02.09.2026 (Marc: „das hab ich jetzt nicht geblickt") — Versionen
          // ohne Datei standen bisher aussehen-wie-alle-anderen in der Liste,
          // nur ohne Knopf. Wer sie zurückholen wollte, fand einfach nichts
          // und wusste nicht warum. Sie sind Zwischenstände, die beim
          // nächsten Heilen verworfen wurden, weil kein Projekt sie hielt.
          // Jetzt sagen sie das selbst.
          + fs.slice().reverse().map(f => {
            const weg = !f.snapshot && !f.aktuell;
            return `
            <div class="lib-fassung${f.aktuell ? " is-on" : ""}${weg ? " is-weg" : ""}" data-gh="${f.geo_hash}"${
              weg ? ` title="${esc(T("library.version_weg_tip", "Dieser Zwischenstand wurde beim nächsten Heilen verworfen, weil ihn kein Projekt benutzt hat. Er lässt sich nicht mehr zurückholen."))}"` : ""}>
              <span class="lib-fassung-nr">${f.nr}</span>
              <span class="lib-fassung-info">${esc(fmtDate(f.erstellt))} · ${esc(QUELLE[f.quelle] || f.quelle)}${
                f.distance_km ? ` · ${(+f.distance_km).toFixed(1)} km` : ""}${
                f.aktuell ? ` · <b>${T("library.fassung_aktuell", "aktuell")}</b>` : ""}${
                weg ? ` · <i>${T("library.version_weg", "nicht mehr vorhanden")}</i>` : ""}</span>
              ${f.snapshot ? `<button class="btn btn-ghost btn-sm" data-fvp="${f.geo_hash}" data-fvn="${f.nr}" title="${T("library.vproj_tip", "Ein Projekt auf diese Version stellen")}" hidden>🎬</button>` : ""}
              ${!f.aktuell && f.snapshot ? `<button class="btn btn-ghost btn-sm" data-frb="${f.geo_hash}" title="${T("library.fassung_rb_tip", "Diese Version als Datei ins Archiv zurückholen (die jetzige bleibt als Version erhalten)")}">↩︎</button>` : ""}
              ${f.snapshot ? `<button class="btn btn-ghost btn-sm" data-fex="${f.geo_hash}" title="${T("library.version_export_tip", "Diese Version als GPX-Datei exportieren")}">⬇</button>` : ""}
              ${!f.aktuell && f.snapshot ? `<button class="btn btn-ghost btn-sm" data-fdel="${f.geo_hash}" data-fdn="${f.nr}" title="${T("library.version_loeschen_tip", "Diese Version löschen (die neueste bleibt immer erhalten)")}">🗑</button>` : ""}
            </div>`; }).join("");
        // 02.09.2026 (Marc): Eine Version anklicken zeigt IHRE Kennzahlen in
        // der Tabelle darüber. Ohne das sehen zwei Versionen derselben Tour
        // gleich aus — sie tragen ja denselben Namen.
        el.querySelectorAll(".lib-fassung[data-gh]").forEach(z => {
          z.onclick = async (ev) => {
            if (ev.target.closest("[data-frb],[data-fvp],[data-fex],[data-fdel]")) return;
            const gh = z.dataset.gh;
            el.querySelectorAll(".lib-fassung").forEach(x => x.classList.remove("is-gezeigt"));
            const r = await api().tour_version_daten(gh);
            if (!r || !r.ok) {
              toast(r && r.error ? r.error
                : T("library.fassung_kein_snapshot", "Für diese Version liegt keine Kopie mehr vor."), "warn");
              kennzahlenSetzen(_sel);   // zurück auf die aktuelle
              return;
            }
            z.classList.add("is-gezeigt");
            kennzahlenSetzen(r.daten);
            const hin = document.getElementById("lib-d-vhint");
            if (hin) {
              const aktuell = z.classList.contains("is-on");
              hin.hidden = aktuell;
              hin.textContent = aktuell ? "" : T("library.version_gezeigt",
                "Oben stehen die Werte dieser Version. Dein Projekt benutzt weiterhin die, an der es hängt.");
            }
          };
        });
        // 02.09.2026, Audit: „Ein Projekt hängt an einer Version und lässt
        // sich jederzeit auf eine andere stellen" stand im Changelog, die
        // Brücke gab es auch — nur kein Weg dorthin. Hier ist er: Der
        // 🎬-Knopf erscheint an jeder Version, sobald ein Projekt an dieser
        // Tour hängt, und öffnet die Liste dieser Projekte.
        (async () => {
          let pr = [];
          try {
            const rp = await api().tour_projekte(it.path);
            pr = ((rp && rp.projekte) || []).filter(p => p.gh);
          } catch (_) { return; }
          if (!pr.length) return;
          el.querySelectorAll("[data-fvp]").forEach(b => {
            b.hidden = false;
            b.onclick = () => {
              const zielGh = b.dataset.fvp, zielNr = b.dataset.fvn;
              const zeilen = pr.map(p => {
                const hier = p.gh === zielGh;
                return `<div class="lib-fassung${hier ? " is-on" : ""}">
                  <span class="lib-fassung-info">🎬 ${esc(p.name)} · ${
                    T("library.vproj_v", "Version {n}").replace("{n}", p.version || "?")}</span>
                  ${hier ? `<span class="muted">${T("library.vproj_hier", "benutzt diese Version")}</span>`
                         : `<button class="btn btn-sm" data-vpid="${esc(p.id)}" data-vpalt="${p.gh}">${
                             T("library.vproj_setzen", "Umstellen")}</button>`}
                </div>`;
              }).join("");
              const m = openModal({
                title: "🎬 " + T("library.vproj_titel", "Projekt auf diese Version stellen"),
                body: `<p class="muted">${T("library.vproj_hilfe",
                        "Das Projekt rechnet danach mit Version {n} dieser Tour. Die Tour selbst und alle anderen Projekte bleiben, wie sie sind.")
                        .replace("{n}", zielNr)}</p>` + zeilen,
                footer: `<button class="btn" id="lib-vp-zu">${T("common.close", "Schließen")}</button>`,
              });
              const zu = document.getElementById("lib-vp-zu");
              if (zu) zu.onclick = () => m.close();
              document.querySelectorAll("[data-vpid]").forEach(k => k.onclick = async () => {
                const r = await api().projekt_version_setzen(k.dataset.vpid, k.dataset.vpalt, zielGh);
                if (r && r.ok) {
                  m.close();
                  toast(T("library.vproj_done", "Projekt auf Version {n} gestellt.")
                          .replace("{n}", zielNr), "info");
                  renderDetail();
                } else toast((r && r.error) || "?", "error");
              });
            };
          });
        })();

        // Exportieren: der einzige Weg nach draußen, seit die App nicht mehr
        // in fremde Dateien zurückschreibt.
        el.querySelectorAll("[data-fex]").forEach(b => b.onclick = async () => {
          const r = await api().tour_version_exportieren(b.dataset.fex);
          if (r && r.cancelled) return;
          if (r && r.ok) toast(T("library.version_export_done", "Version exportiert."), "info");
          else toast((r && r.error) || "?", "error");
        });

        // Löschen: gesperrt, solange ein Projekt sie hält — die Brücke sagt,
        // welche das sind, und genau das zeigen wir dann an.
        el.querySelectorAll("[data-fdel]").forEach(b => b.onclick = () => {
          const m = openModal({
            title: "🗑 " + T("library.version_loeschen", "Version löschen"),
            body: `<p>${T("library.version_loeschen_frage",
              "Version {n} dieser Tour endgültig entfernen? Die Tour und alle anderen Versionen bleiben.")
              .replace("{n}", b.dataset.fdn)}</p>`,
            footer: `<button class="btn" id="lib-fdel-ab">${T("common.cancel", "Abbrechen")}</button>
                     <button class="btn btn-danger" id="lib-fdel-ok">${T("library.version_loeschen", "Version löschen")}</button>`,
          });
          const ab = document.getElementById("lib-fdel-ab");
          if (ab) ab.onclick = () => m.close();
          const ok = document.getElementById("lib-fdel-ok");
          if (ok) ok.onclick = async () => {
            const r = await api().tour_version_loeschen(b.dataset.fdel);
            m.close();
            if (r && r.ok) {
              toast(T("library.version_geloescht", "Version gelöscht."), "info");
              _sel = null; reload();
              return;
            }
            // `tour_version_loeschen` liefert die Halter als Namen (Strings).
            const namen = ((r && r.projekte) || [])
              .map(p => (typeof p === "string" ? p : (p.name || p.id || "?")));
            const m2 = openModal({
              title: T("library.version_haelt_titel", "Diese Version wird noch gebraucht"),
              body: `<p>${namen.length
                ? T("library.version_haelt", "Diese Projekte hängen an der Version: {liste}. Stelle sie erst auf eine andere Version (🎬), dann lässt sie sich löschen.")
                    .replace("{liste}", namen.map(esc).join(", "))
                : esc((r && r.error) || "?")}</p>`,
              footer: `<button class="btn" id="lib-fdel-zu">${T("common.close", "Schließen")}</button>`,
            });
            const zu = document.getElementById("lib-fdel-zu");
            if (zu) zu.onclick = () => m2.close();
          };
        });

        el.querySelectorAll("[data-frb]").forEach(b => b.onclick = () => {
          const m = openModal({
            title: "↩︎ " + T("library.fassung_rb", "Version wiederherstellen"),
            body: `<p>${T("library.fassung_rb_frage", "Die Archiv-Datei durch diese Version ersetzen? Die jetzige Geometrie bleibt als Version in der Kette (nichts geht verloren); gepinnte Projekte bleiben unberührt.")}</p>`,
            footer: `<button class="btn" id="lib-frb-ab">${T("common.cancel", "Abbrechen")}</button>
                     <button class="btn btn-primary" id="lib-frb-ok">${T("library.fassung_rb", "Version wiederherstellen")}</button>`,
          });
          const ok = document.getElementById("lib-frb-ok");
          if (ok) ok.onclick = async () => {
            m.close();
            const r = await api().tour_fassung_wiederherstellen(b.dataset.frb);
            if (r && r.ok) {
              toast(T("library.fassung_rb_done", "Version wiederhergestellt."), "info");
              // Abnahme 29.08.2026: die Detailspalte zeigte sonst weiter die
              // alte Version als „aktuell" — Auswahl-Objekt verwerfen, reload
              // findet die Tour über den gemerkten PFAD mit frischen Daten.
              _sel = null;
              reload();
            }
            else toast((r && r.error) || "?", "error");
          };
          const ab = document.getElementById("lib-frb-ab");
          if (ab) ab.onclick = () => m.close();
        });
      } catch (_) { el.innerHTML = ""; }
    })();

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
      const vorher = !!it.hidden;
      const pfad = it.path;
      await api().library_set_hidden(pfad, !vorher);
      _libUndoPush(vorher ? T("library.undo.unhide", "Tour wieder eingeblendet")
                          : T("library.undo.hide", "Tour ausgeblendet"),
        async () => { await api().library_set_hidden(pfad, vorher); },
        async () => { await api().library_set_hidden(pfad, !vorher); });
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
    let res = await api().library_trash(it.path);
    // 02.09.2026 (Q35): Steckt die Tour in Projekten, verweigert das Backend
    // und nennt sie. Der zweite Weg ist ein bewusster Klick — nie automatisch.
    if (res && res.grund === "benutzt") {
      const liste = (res.projekte || []).join(", ");
      // rzConfirm(titel, text, knopf, gefahr) — Beschriftung und Gefahr-Kennung
      // sind Pflicht, sonst steht dort ein leerer Knopf (Fehler vom 31.08.).
      const weiter = await rzConfirm(
        "🗑 " + T("library.tour_mit_projekten", "Tour und diese Projekte löschen"),
        T("library.tour_loeschen_frage",
          "„{name}“ löschen? Sie wird von diesen Projekten benutzt: {liste}")
          .replace("{name}", it.display_name || it.name || "")
          .replace("{liste}", liste),
        T("library.tour_mit_projekten", "Tour und diese Projekte löschen"), true);
      if (!weiter) return;
      res = await api().library_trash(it.path, true);
    }
    if (!res.ok) { toast(res.error || "Nicht möglich", "error"); return; }
    toast(T("library.trash_done", "In den Papierkorb gelegt."), "info");
    _sel = null; store.set("sel", ""); renderDetail(); reload();
  }

  /** Woran erkannt? — damit die Schätzung nachvollziehbar bleibt. */
  /** Die Kennzahlen-Zeilen einer Tour ODER einer einzelnen Version.
   *  `q` sind rohe Werte aus der Datenbank (siehe `tour_version_daten`). */
  function kennzahlen(q) {
    return [
      [T("library.date", "Datum"), fmtDate(q.started_at)],
      [T("library.distance", "Strecke"), fmtKmVal(q.distance_m || 0)],
      [T("library.duration", "Dauer"), q.duration_s ? fmtDurVal(q.duration_s) : "—"],
      [T("library.ascent", "Höhenmeter"), `↑ ${num(q.ascent_m)} m · ↓ ${num(q.descent_m)} m`],
      [T("library.speed", "Schnitt"), q.avg_speed_kmh ? (+q.avg_speed_kmh).toFixed(1) + " km/h" : "—"],
      [T("library.maxspeed", "Max. Tempo"), q.max_speed_kmh ? (+q.max_speed_kmh).toFixed(1) + " km/h" : "—"],
      [T("library.points", "Punkte"), `${q.n_points || 0}${q.n_segments > 1 ? ` · ${q.n_segments} ${T("library.segments", "Etappen")}` : ""}`],
      [T("library.activity", "Fortbewegung"), ACT_LABELS[q.activity] || (q.activity || "—")],
      [T("library.file", "Datei"), q.filename || "—"],
    ];
  }

  function kennzahlenSetzen(q) {
    const el = document.getElementById("lib-d-rows");
    if (!el) return;
    el.innerHTML = kennzahlen(q).map(([k, v]) =>
      `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("");
  }

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

  /* ── Undo (Cmd/Strg+Z) — 28.08.2026, Marc: „hatten wir nicht mal gesagt,
   *  dass undo überall gehen soll?" Das Archiv war das einzige Modul ohne
   *  Controller. Seine Aktionen sind DB-Operationen, kein DOM-Zustand — darum
   *  ein KOMMANDO-Stack (jede Aktion bringt ihr eigenes undo/redo mit) statt
   *  des Snapshot-Controllers der anderen Module. Nicht im Stack: Papierkorb
   *  (System-Papierkorb ist das Undo) und „Aus Archiv nehmen" (kommt beim
   *  nächsten Einlesen wieder — ein Undo müsste die Datei neu scannen). */
  const _libUndoStack = [], _libRedoStack = [];
  function _libUndoPush(label, undoFn, redoFn) {
    _libUndoStack.push({ label, undoFn, redoFn });
    if (_libUndoStack.length > 50) _libUndoStack.shift();
    _libRedoStack.length = 0;
  }
  async function _libUndoLauf(von, nach, fn, pfeil, leerKey, leerTxt) {
    const a = von.pop();
    if (!a) { toast(T(leerKey, leerTxt), "info"); return false; }
    try { await a[fn](); }
    catch (e) { von.push(a); toast(T("library.undo.fehl", "Rückgängig ging schief: {e}").replace("{e}", String(e)), "error"); return false; }
    nach.push(a);
    await reloadCollections();
    reload();
    if (_sel) renderDetail();
    toast(pfeil + " " + a.label, "info");
    return true;
  }
  window.__rzUndoControllers = window.__rzUndoControllers || {};
  window.__rzUndoControllers.library = {
    push: _libUndoPush,
    undo: () => _libUndoLauf(_libUndoStack, _libRedoStack, "undoFn", "↶", "undo.nothing_undo", "Nichts zum Rückgängig"),
    redo: () => _libUndoLauf(_libRedoStack, _libUndoStack, "redoFn", "↷", "undo.nothing_redo", "Nichts zum Wiederherstellen"),
    reset: () => { _libUndoStack.length = 0; _libRedoStack.length = 0; },
    canUndo: () => _libUndoStack.length > 0,
    canRedo: () => _libRedoStack.length > 0,
  };

  async function renderTrackCollections(it) { return renderColChips($("lib-d-cols"), it, {}); }

  /** Sammlungs-Chips einer Tour — Detailspalte UND Karten-Info-Karte (Marc,
   *  28.08.2026: in der Kartenansicht fehlten sie ganz). Das ✕ nimmt die Tour
   *  aus der Sammlung; verlässt sie dabei die gerade ANGEZEIGTE Sammlung,
   *  springt die Ansicht zur Sammlungs-Übersicht zurück — vorher „blieb man
   *  auf der tour, obwohl ich sie aus der sammlung haben wollte". */
  async function renderColChips(box, it, opts) {
    if (!box) return;
    const imPopup = !!(opts && opts.popup);
    const res = await api().library_collections_of(it.path);
    const mine = (res && res.collections) || [];
    box.innerHTML =
      mine.map(c => `<span class="lib-colchip">${esc(c.name)}<button data-rm="${c.id}" data-rmname="${esc(c.name)}" title="${esc(T("library.col_remove", "Aus der Sammlung nehmen"))}">✕</button></span>`).join("") +
      (imPopup && !mine.length ? `<span class="lib-hint">${T("library.col_in_none", "In keiner Sammlung.")}</span>` : "") +
      (imPopup ? "" : `<button class="lib-chip lib-chip-ghost" id="lib-d-addcol">+ ${T("library.col_add", "Zu Sammlung")}</button>`);
    box.querySelectorAll("[data-rm]").forEach(b => {
      b.onclick = async (e) => {
        e.stopPropagation();
        const cid = parseInt(b.dataset.rm, 10);
        const vorher = await api().library_collection_items(cid);
        const ordnung = ((vorher && vorher.items) || []).map(x => x.path);
        await api().library_collection_remove(cid, [it.path]);
        _libUndoPush(T("library.undo.col_remove", "Aus Sammlung genommen"),
          async () => { await api().library_collection_add(cid, [it.path]);
                        await api().library_collection_set_order(cid, ordnung); },
          async () => { await api().library_collection_remove(cid, [it.path]); });
        await reloadCollections();
        toast(T("library.col_removed_toast", "Aus „{col}“ genommen — die Tour bleibt im Archiv.")
          .replace("{col}", b.dataset.rmname || ""), "info", 4000);
        if (state.collection_id === cid) {
          _sel = null; store.set("sel", "");
          closeMapPopup();
          renderDetail();
          if (view === "map") _mapKeepCamera = true;
          reload();
        } else {
          renderColChips(box, it, opts);
          if (state.collection_id) {
            if (view === "map") _mapKeepCamera = true;
            reload();
          }
        }
      };
    });
    const add = imPopup ? null : box.querySelector("#lib-d-addcol");
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
        const vorher = await api().library_collection_items(cid);
        const ordnung = ((vorher && vorher.items) || []).map(x => x.path);
        await api().library_collection_add(cid, paths);
        await api().library_collection_sort_by_date(cid);
        _libUndoPush(T("library.undo.col_add", "Zur Sammlung hinzugefügt"),
          async () => { await api().library_collection_remove(cid, paths);
                        await api().library_collection_set_order(cid, ordnung); },
          async () => { await api().library_collection_add(cid, paths);
                        await api().library_collection_sort_by_date(cid); });
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
      if (res && res.ok) {
        let lebendId = res.id;   // Redo legt neu an → neue ID merken
        _libUndoPush(T("library.undo.col_create", "Sammlung angelegt"),
          async () => { await api().library_collection_delete(lebendId); },
          async () => { const r = await api().library_collection_create(name.trim(), paths);
                        if (r && r.ok) { lebendId = r.id;
                          if (paths.length) await api().library_collection_sort_by_date(lebendId); } });
      }
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
          <button class="btn btn-sm" id="lib-cm-schwarm">🌊 ${T("schwarm.action", "Als Schwarm animieren …")}</button>
          <button class="btn btn-sm" id="lib-cm-dup">⎘ ${T("library.col_duplicate", "Duplizieren")}</button>
          <button class="btn btn-ghost btn-sm lib-btn-danger" id="lib-cm-del">${T("library.col_delete", "Löschen")}</button>
        </div>
        <div class="lib-hint lib-warnhint" id="lib-cm-filterhint" hidden style="margin-top:8px;"></div>
        <div class="lib-hint" style="margin-top:8px;">${T("library.col_delete_note", "Löschen entfernt nur die Sammlung — die Touren bleiben im Archiv.")}</div>
      </div>`,
    });
    // Aktive Archiv-Filter? Dann VOR dem Klick sagen, was eine Übergabe nimmt.
    let _cmMenge = null;
    sammlungGefiltert(cid).then(m => {
      _cmMenge = m;
      const h = document.getElementById("lib-cm-filterhint");
      if (h && m.reduziert) {
        h.hidden = false;
        const filter = aktiveFilterText();
        h.textContent = T("library.col_filterhint",
          "Archiv-Filter aktiv: {n} von {m} Touren sichtbar — „Alle im Animator“ und „Als Schwarm“ nehmen genau diese {n}.")
          .replace(/\{n\}/g, String(m.gefiltert.length)).replace("{m}", String(m.alle.length))
          + (filter ? " " + T("library.col_filterhint_filter",
              "Aktive Filter: {f}.").replace("{f}", filter) : "");
      }
    }).catch(() => {});
    const nameEl = document.getElementById("lib-cm-name");
    if (nameEl) nameEl.onchange = async () => {
      const alterName = (_collections.find(x => x.id === cid) || {}).name || c.name;
      const neuerName = nameEl.value;
      await api().library_collection_rename(cid, neuerName);
      _libUndoPush(T("library.undo.col_rename", "Sammlung umbenannt"),
        async () => { await api().library_collection_rename(cid, alterName); },
        async () => { await api().library_collection_rename(cid, neuerName); });
      await reloadCollections();
    };
    const show = document.getElementById("lib-cm-show");
    if (show) show.onclick = () => {
      state.collection_id = cid; state.sort = "collection";
      m.close(); renderCollections(); reload();
    };
    const anim = document.getElementById("lib-cm-anim");
    if (anim) anim.onclick = async () => {
      m.close();
      const menge = _cmMenge || await sammlungGefiltert(cid);
      const items = (menge.reduziert && menge.gefiltert.length >= 1) ? menge.gefiltert : menge.alle;
      openCollectionInAnimator(cid, items);
    };
    const dup = document.getElementById("lib-cm-dup");
    if (dup) dup.onclick = async () => {
      dup.disabled = true;
      const r = await api().library_collection_duplicate(cid);
      if (!r || !r.ok) { dup.disabled = false; toast((r && r.error) || "Fehler", "error"); return; }
      let kopieId = r.id;
      _libUndoPush(T("library.undo.col_dup", "Sammlung dupliziert"),
        async () => { await api().library_collection_delete(kopieId); },
        async () => { const r2 = await api().library_collection_duplicate(cid);
                      if (r2 && r2.ok) kopieId = r2.id; });
      m.close();
      await reloadCollections();
      toast(T("library.col_duplicated", "Sammlung kopiert — die Kopie kannst du jetzt frei umbauen."), "success", 5000);
    };
    const schwarm = document.getElementById("lib-cm-schwarm");
    if (schwarm) schwarm.onclick = async () => {
      m.close();
      const menge = _cmMenge || await sammlungGefiltert(cid);
      if (menge.reduziert && menge.gefiltert.length >= 2) {
        alsSchwarmInDenAnimator(menge.gefiltert);
        return;
      }
      const r = await api().library_collection_items(cid);
      alsSchwarmInDenAnimator((r && r.items) || []);
    };
    const del = document.getElementById("lib-cm-del");
    if (del) del.onclick = async () => {
      const itemsRes = await api().library_collection_items(cid);
      const pfade = ((itemsRes && itemsRes.items) || []).map(x => x.path);
      const gelName = (_collections.find(x => x.id === cid) || {}).name || c.name;
      await api().library_collection_delete(cid);
      let lebendId = null;   // Undo legt neu an → für Redo die neue ID merken
      _libUndoPush(T("library.undo.col_delete", "Sammlung gelöscht"),
        async () => { const r = await api().library_collection_create(gelName, pfade);
                      if (r && r.ok) lebendId = r.id; },
        async () => { if (lebendId != null) await api().library_collection_delete(lebendId); });
      if (state.collection_id === cid) {
        state.collection_id = 0;
        store.set("collection_id", "0");
        state.sort = gemerkterSort();
        sortAnzeigen();
      }
      m.close(); await reloadCollections(); reload();
    };
  }

  /* 🌊 Schwarm (28.08.2026, IDEAS §33 → Marc: „die längste bestimmt die
   * videodauer. bau das so"): Alle markierten Touren starten GLEICHZEITIG,
   * gleiche Geschwindigkeit, Kamera steht still über allen. Ein eigener
   * schlanker Modus — bewusst KEIN Umweg über den Animator, dessen Overlays,
   * Keyframes und Kameraflüge hier keinen Sinn ergeben.
   *
   * Der Render läuft über die BESTEHENDE Brücke (animator_start_render mit
   * `schwarm: true`) — damit gelten „Render läuft bereits", animator_status()
   * und animator_cancel() unverändert.
   */
  /* 🌊 Schwarm-Übergabe (M4, 28.08.2026 — Marcs Beschluss aus dem Grilling:
   * „weg sobald der animator steht"): Der frühere Schnell-Render-Dialog mit
   * eigenem Renderer ist abgebaut. Das Archiv komponiert nur noch — die Menge
   * geht direkt in den Animator (längste Tour als Haupt-Track = Zeitachse),
   * wo alle Werkzeuge und der EINE Renderpfad leben.
   */
  /** IDEAS §38 M3 — Geschwindigkeitsmodus VOR der Übergabe wählen (das Archiv
   *  komponiert). Letzte Wahl wird gemerkt; „Los" reicht Modus + Pausen-Wahl
   *  als Pending an den Animator, der Rest läuft wie bisher. */
  function alsSchwarmInDenAnimator(items) {
    const gute = (items || []).filter(i => i && i.path && i.exists !== false);
    if (gute.length < 2) {
      toast(T("schwarm.zu_wenig", "Für einen Schwarm mindestens 2 Touren markieren."), "warn");
      return;
    }
    // Marc, 29.08.2026: VIER Radios statt drei + Pausen-Häkchen — die
    // Checkbox galt zwar nur für „Echte Uhrzeit" (sonst ausgegraut), aber
    // vier explizite Optionen sind eindeutiger.
    const merkModus = (typeof _settingsCache === "object" && _settingsCache
                       && ["gleich", "ziel", "uhrzeit"].includes(_settingsCache.schwarm_modus))
                      ? _settingsCache.schwarm_modus : "gleich";
    const merkPausen = !(typeof _settingsCache === "object" && _settingsCache
                         && _settingsCache.schwarm_pausen === false);
    const merkWahl = merkModus === "uhrzeit" ? (merkPausen ? "uhrzeit" : "uhrzeit_bew") : merkModus;
    const radio = (wert, titel, hint) => `
      <label class="lib-modus-zeile"><input type="radio" name="lib-sw-modus" value="${wert}"${wert === merkWahl ? " checked" : ""}>
        <span><strong>${titel}</strong><br><span class="lib-hint">${hint}</span></span></label>`;
    const m = openModal({
      title: "🌊 " + T("schwarm.action", "Als Schwarm animieren …"),
      body: `<div class="lib-fmodal">
        <div class="field-label">${T("schwarm.modus_titel", "Wie schnell laufen die Touren?")}</div>
        ${radio("gleich", T("schwarm.modus_gleich", "Alle gleich schnell"),
                T("schwarm.modus_gleich_hint", "Die längste Tour bestimmt die Videodauer, kürzere sind früher im Ziel."))}
        ${radio("ziel", T("schwarm.modus_ziel", "Gleichzeitig im Ziel"),
                T("schwarm.modus_ziel_hint", "Fotofinish: jede Tour wird skaliert, alle kommen mit dem Videoende an."))}
        ${radio("uhrzeit", T("schwarm.modus_uhrzeit", "Echte Uhrzeit — mit Pausen"),
                T("schwarm.modus_uhrzeit_hint", "Jede Tour läuft nach ihren Zeitstempeln (gemeinsamer Start); bei einer Rast steht der Punkt still. Touren ohne Zeitstempel laufen gleichmäßig mit."))}
        ${radio("uhrzeit_bew", T("schwarm.modus_uhrzeit_bew", "Echte Uhrzeit — ohne Pausen"),
                T("schwarm.modus_uhrzeit_bew_hint", "Wie oben, aber Pausen werden herausgeschnitten — verglichen wird das reine Tempo."))}
      </div>`,
      footer: `<button class="btn" id="lib-sw-abbruch">${T("common.cancel", "Abbrechen")}</button>
               <button class="btn btn-primary" id="lib-sw-los">🌊 ${T("schwarm.los", "Los")}</button>`,
    });
    const ab = document.getElementById("lib-sw-abbruch");
    if (ab) ab.onclick = () => m.close();
    const los = document.getElementById("lib-sw-los");
    if (los) los.onclick = () => {
      const wahl = (document.querySelector('input[name="lib-sw-modus"]:checked') || {}).value || "gleich";
      const modus = wahl === "uhrzeit_bew" ? "uhrzeit" : wahl;
      const pausen = wahl !== "uhrzeit_bew";
      try { saveSettings({ schwarm_modus: modus, schwarm_pausen: pausen }); } catch (_) {}
      m.close();
      _schwarmStarten(gute, modus, pausen);
    };
  }

  async function _schwarmStarten(gute, modus, pausen) {
    const sortiert = gute.slice().sort((x, y) => (y.distance_m || 0) - (x.distance_m || 0));
    window.__rzPendingTours = sortiert.slice(1).map(i => i.path);
    window.__rzPendingAblauf = "schwarm";
    window.__rzPendingModus = modus || "gleich";
    window.__rzPendingPausen = pausen !== false;
    // Lade-Modal SOFORT (Marc: „das modal kommt viel zu spät").
    if (sortiert.length >= 3 && typeof tourenLadeModalZeigen === "function") tourenLadeModalZeigen();
    const ok = await window.loadGlobalGpx(sortiert[0].path, { stumm: true, menge: true });
    if (ok === false) {
      window.__rzPendingTours = null; window.__rzPendingAblauf = null;
      if (typeof tourenLadeModalZu === "function") tourenLadeModalZu();
      return;
    }
    if (typeof switchMod === "function") switchMod("animator");
    toast(`🌊 ${sortiert.length} ${T("schwarm.an_animator", "Touren als Schwarm im Animator.")}`, "success");
  }

  /** Ganze Sammlung an den Animator übergeben — erste Tour als Haupt-Track,
   *  der Rest als zusätzliche Touren. Genau dafür hat sie eine Reihenfolge. */
  /** Sammlung in ihrer Reihenfolge, PLUS dieselbe Sammlung durch die gerade
   *  aktiven Archiv-Filter gesehen (Bereich „Gemachte", Suche, Jahr, Art, km).
   *  Marc, 28.08.2026 („große verwirrung"): Er stand im Bereich „Gemachte",
   *  startete den Schwarm — und bekam die GANZE Sammlung samt geplanter
   *  Touren. Übergaben nehmen jetzt das, was die Filter zeigen; ohne aktive
   *  Filter bleibt es die ganze Sammlung. Abgleich über geo_hash, weil
   *  dieselbe Tour als mehrere Dateien im Archiv liegen kann. */
  /** v0.9.617 (Marc: „ist es zufall, dass genau fünfzig …?" — es war der
   *  übersehene Jahr-Filter 2023): die aktiven Filter beim Namen nennen,
   *  damit klar ist, WARUM eine Übergabe weniger nimmt als die Sammlung hat. */
  function aktiveFilterText() {
    const teile = [];
    const SCOPE_LBL = { done: T("library.scope_done", "Gemachte"),
                        planned: T("library.scope_planned", "Geplante"),
                        fav: T("library.scope_fav", "Favoriten"),
                        merged: T("library.scope_merged", "Zusammengefügt"),
                        hidden: T("library.scope_hidden", "Ausgeblendete") };
    if (scope !== "all" && SCOPE_LBL[scope]) teile.push(SCOPE_LBL[scope]);
    if (state.year) teile.push(T("library.filter_jahr", "Jahr {j}").replace("{j}", String(state.year)));
    if (state.activity) teile.push(ACT_LABELS[state.activity] || state.activity);
    if (state.von || state.bis) teile.push(`${state.von || "…"} – ${state.bis || "…"}`);
    if (state.min_km != null || state.max_km != null)
      teile.push(`${state.min_km != null ? state.min_km : 0}–${state.max_km != null ? state.max_km : "∞"} km`);
    if ((state.search || "").trim()) teile.push(`„${state.search.trim()}“`);
    if (_ortAktiv) teile.push(T("library.filter_gegend", "Gegend auf der Karte"));
    return teile.join(" · ");
  }

  async function sammlungGefiltert(cid) {
    const alleRes = await api().library_collection_items(cid);
    const alle = ((alleRes && alleRes.items) || []);
    let gefiltert = alle;
    try {
      const r = await api().library_query(queryParams({
        collection_id: cid, sort: "collection", limit: 100000, offset: 0,
        with_thumbs: false, with_geom: false,
      }));
      if (r && r.ok && Array.isArray(r.items)) {
        const drin = new Set(r.items.map(i => i.geo_hash));
        gefiltert = alle.filter(i => drin.has(i.geo_hash));
      }
    } catch (_) {}
    return { alle, gefiltert, reduziert: gefiltert.length < alle.length };
  }

  async function openCollectionInAnimator(cid, itemsOpt) {
    let items = itemsOpt;
    if (!items) {
      const res = await api().library_collection_items(cid);
      items = (res && res.items) || [];
    }
    if (!items.length) { toast(T("library.col_empty", "Diese Sammlung ist leer."), "warn"); return; }
    // Die weiteren Etappen werden NICHT von hier aus hinzugefügt: der Animator
    // lädt beim Mounten seinen Projekt-State und würde sie sofort wieder
    // überschreiben. Er holt sie sich selbst ab, sobald er fertig ist.
    window.__rzPendingTours = items.slice(1).map(i => i.path);
    window.__rzPendingAblauf = "reise";   // IDEAS §38: Ablauf wird HIER gewählt
    if (items.length >= 3 && typeof tourenLadeModalZeigen === "function") tourenLadeModalZeigen();
    const ok = await window.loadGlobalGpx(items[0].path, { stumm: true, menge: true });
    if (ok === false) {
      window.__rzPendingTours = null;
      if (typeof tourenLadeModalZu === "function") tourenLadeModalZu();
      return;
    }
    if (typeof switchMod === "function") switchMod("animator");
    if (items.length > 1) {
      toast(`${items.length} ${T("library.col_loaded", "Touren geladen.")}`, "info");
    }
  }

  /** Tour in ein Werkzeug übernehmen: derselbe Weg wie „Datei wählen". */
  /* 👻 Ghost-Spuren aus dem Archiv — der Weg, den Marc am 27.08.2026 gesucht hat.
   *
   * Sein Ablauf: Im Animator „Aus dem Archiv …", im Archiv die Tour suchen, und
   * dann stand dort nur „Im Animator öffnen" — womit sie **der Haupt-Track**
   * wurde statt eine Ghost-Spur. Die Übergabe gab es zwar, aber ausschließlich
   * über die Mehrfach-Auswahl (⌘-Klick), von der der Knopf nichts sagte.
   *
   * Jetzt gibt es sie dort, wo man sie sucht: an der einzelnen Tour. Und wer aus
   * dem Animator kommt, sieht oben, wonach das Archiv gerade fragt.
   */
  function _ghostModus() { try { return !!window.__rzGhostAuswahl; } catch (_) { return false; } }

  function alsGhost(pfade) {
    const gute = (pfade || []).filter(Boolean);
    if (!gute.length) return;
    window.__rzPendingGhosts = gute;
    window.__rzGhostAuswahl = false;
    toast(T("library.ghosts.sent", "{n} Spur(en) an den Animator übergeben.")
      .replace("{n}", gute.length), "success");
    if (typeof switchMod === "function") switchMod("animator");
  }

  /** Hinweisleiste im Detail-Bereich, solange das Archiv für den Animator eine
   *  Ghost-Spur sucht. Bewusst DORT, wo auch der Knopf sitzt — eine Leiste über
   *  dem Gitter würde das Layout verschieben und beim ersten Klick verschwinden. */
  function _ghostBannerHtml() {
    if (!_ghostModus()) return "";
    return `<div class="lib-ghost-bar" id="lib-ghost-bar">
      <span>👻 ${T("library.ghost.mode",
        "Ghost-Spur auswählen: Tour anklicken und „Als Ghost-Spur übernehmen“ (oder Doppelklick). Mehrere gehen mit ⌘/Strg-Klick. Die anderen Werkzeuge sind so lange ausgeblendet.")}</span>
      <button class="btn btn-ghost btn-sm" id="lib-ghost-bar-x" type="button">${T("common.cancel", "Abbrechen")}</button>
    </div>`;
  }

  function _ghostBannerBinden() {
    const x = document.getElementById("lib-ghost-bar-x");
    if (x) x.onclick = () => { window.__rzGhostAuswahl = false; renderDetail(); };
  }

  async function openIn(slug) {
    if (!_sel) return;
    if (!_sel.exists) { toast(T("library.file_gone", "Die Datei liegt nicht mehr an diesem Ort."), "error"); return; }
    const ok = await window.loadGlobalGpx(_sel.path, { stumm: true });
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
    // Läuft schon ein Scan (aus einem früheren Besuch)? Dann Fortschritt zeigen.
    try {
      const st = await api().library_scan_status();
      if (st && st.running) {
        const btn = $("lib-scan"); if (btn) btn.disabled = true;
        const stop = $("lib-scan-stop"); if (stop) stop.hidden = false;
        pollScan();
      }
    } catch (_) {}
  }

  function foldersModalHtml() {
    const list = _folders.length
      ? _folders.map(f => `
          <div class="lib-folder${f.exists ? "" : " is-missing"}" title="${esc(f.path)}">
            <span class="lib-folder-name">${esc(f.path)}</span>
            <span class="lib-folder-n">${f.n_tracks}</span>
            <button class="lib-folder-rescan" data-folder="${esc(f.path)}" title="${esc(T("library.rescan_folder", "Nur diesen Ordner neu einlesen"))}">🔄</button>
            <button class="lib-folder-x" data-folder="${esc(f.path)}" title="${esc(T("library.remove_folder", "Ordner nicht mehr beobachten"))}">✕</button>
          </div>`).join("")
      : `<div class="lib-empty-hint">${T("library.no_folders", "Noch kein Ordner. Füge den Ordner hinzu, in dem deine GPX-Dateien liegen.")}</div>`;
    return `
      <div class="lib-fmodal">
        <div class="lib-folders">${list}</div>
        <div class="lib-actions" style="margin-top:10px;">
          <button class="btn btn-primary btn-sm" id="lib-add-folder">📂 ${T("library.add_folder", "+ Ordner hinzufügen")}</button>
          <button class="btn btn-sm" id="lib-import-file">📄 ${T("library.import_file", "+ Einzelne Track-Datei …")}</button>
          <button class="btn btn-ghost btn-sm" id="lib-scan">${T("library.scan", "Neu einlesen")}</button>
          <button class="btn btn-ghost btn-sm" id="lib-scan-stop" hidden>${T("library.scan_stop", "Anhalten")}</button>
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
        // 30.08.2026 (Beta-Tester: „X angeklickt, nichts passiert") — bei
        // 100k Tracks dauert das Löschen spürbar, und ein Fehler blieb
        // vorher komplett stumm. Deshalb: Knopf sperren + Ergebnis prüfen.
        btn.disabled = true; btn.textContent = "…";
        const res = await api().library_remove_folder(btn.dataset.folder, true);
        await reloadFolders(); await reload();
        if (!(res && res.ok)) {
          toast(((res && res.error) || T("library.remove_folder_fail", "Ordner konnte nicht entfernt werden")), "error");
        } else if (_folders.some(f => f.path === btn.dataset.folder)) {
          toast(T("library.remove_folder_fail", "Ordner konnte nicht entfernt werden"), "error");
        }
        if (_foldersModal) { _foldersModal.update({ body: foldersModalHtml() }); bindFoldersModal(); }
      };
    });
    const add = $("lib-add-folder");
    if (add) add.onclick = addFolder;
    // 30.08.2026 (Marc-OK): einzelne Track-Dateien direkt ins Archiv.
    const imp = $("lib-import-file");
    if (imp) imp.onclick = () => importSingleFiles();
    const scan = $("lib-scan");
    if (scan) scan.onclick = () => startScan(false);
    // 22.08.2026 (Audit): Die Brücke library_scan_stop gab es, aber keinen Knopf —
    // ein versehentlich gestarteter 103k-Scan war nur per App-Neustart zu stoppen.
    const stopScan = $("lib-scan-stop");
    if (stopScan) stopScan.onclick = () => { stopScan.disabled = true; api().library_scan_stop(); };
    // v0.9.528 (Beta-Tester-Wunsch): nur EINEN Ordner neu einlesen — bei ihm
    // liegen 103.535 Dateien in einem Ordner und 28 neue in einem anderen.
    document.querySelectorAll(".lib-folder-rescan").forEach(btn => {
      btn.onclick = () => startScan(false, btn.dataset.folder);
    });
    const maps = $("lib-maps");
    if (maps) maps.onclick = startMapThumbs;
    const stop = $("lib-maps-stop");
    if (stop) stop.onclick = () => api().library_map_thumbs_stop();
  }

  /** 31.08.2026 (ein Beta-Tester, Mehrfachauswahl): Sammel-Aktionen leben in der
   *  rechten Detailspalte — wie beim Touren-Archiv. Eine Leiste ÜBER der
   *  Liste verschob beim ⌘-Klicken die Karten unter dem Mauszeiger. */
  function renderProjMultiPanel() {
    const d = $("lib-detail");
    if (!d) return;
    d.innerHTML = `
      <div class="lib-multi-head" style="padding:12px">
        <b>${_projMulti.size}</b> ${T("library.proj_multi_n", "Projekte ausgewählt")}
      </div>
      <div style="padding:0 12px; display:flex; flex-direction:column; gap:8px;">
        <button class="btn btn-ghost" id="lib-proj-multi-alle">${
          T("library.proj_multi_alle", "Alle sichtbaren auswählen")}</button>
        <button class="btn lib-btn-danger" id="lib-proj-multi-del">🗑 ${T("library.proj_delete_multi", "Ausgewählte löschen")}</button>
        <button class="btn btn-ghost" id="lib-proj-multi-x">${T("library.clear_sel", "Auswahl aufheben")}</button>
      </div>
      <p class="muted bib-klein" style="padding:0 12px">${T("library.proj_multi_hinweis",
        "Ausgewählt wird nur, was gerade in der Liste steht. Automatisch angelegte Arbeitsstände liegen im zugeklappten Bereich darunter — die musst du erst aufklappen.")}</p>`;
  }

  /** 30.08.2026 (Marc-OK, der Komoot-Fall eines Beta-Testers): einzelne Track-Dateien ins
   *  Archiv — kopiert in den app-verwalteten Import-Ordner (automatisch
   *  beobachtet), danach liest der normale Ein-Ordner-Scan sie ein. */
  /* 02.09.2026 (docs/UMBAU-BIBLIOTHEK.md, Abschnitt 6) — der Import erkennt
   * die Tour, BEVOR er kopiert. Vorher rutschte eine längst bekannte Strecke
   * stillschweigend durch und tauchte als weitere Version auf, ohne dass
   * jemand davon wusste.
   *
   * ⚠️ Bewusst NICHT `rzConfirm`: Das maskiert seinen Text (die Dateiliste
   * käme als roher HTML-Quelltext an) und hat eine feste Beschriftung für
   * „Abbrechen". Hier braucht es beides — eine Liste und zwei Knöpfe, die
   * sagen, was sie tun.
   *
   * Rückgabe: true = auch die bekannten aufnehmen, false = nur die neuen.
   */
  function importFrage(bekannt, neu) {
    return new Promise((fertig) => {
      let beantwortet = false;
      const zeilen = bekannt.map(e => {
        const nam = esc(e.tour_name || e.name);
        const was = e.art === "im_archiv"
          ? T("library.imp_im_archiv", "liegt schon im Archiv als „{tour}“").replace("{tour}", nam)
          : T("library.imp_nur_version", "ist Version {nr} von {n} der Tour „{tour}“ — nicht die neueste")
              .replace("{nr}", e.version_nr == null ? "?" : e.version_nr)
              .replace("{n}", e.versionen == null ? "?" : e.versionen)
              .replace("{tour}", nam);
        return `<li><b>${esc(e.name)}</b><br><span class="lib-hint">${was}</span></li>`;
      }).join("");
      const m = openModal({
        title: "📥 " + T("library.imp_titel", "Diese Touren kennt GPS Studio schon"),
        body: `<div class="lib-fmodal">
          <p>${bekannt.length === 1
                ? T("library.imp_text_1", "Eine der gewählten Dateien ist bereits bekannt — der Streckenverlauf stimmt genau überein.")
                : T("library.imp_text", "Von den gewählten Dateien sind {n} bereits bekannt — der Streckenverlauf stimmt genau überein.")
                    .replace("{n}", num(bekannt.length))}</p>
          <ul class="lib-imp-liste">${zeilen}</ul>
          <p class="lib-hint">${T("library.imp_hinweis", "Nimmst du sie trotzdem auf, kommen sie als weitere Datei derselben Tour dazu — eine zweite Tour entsteht nicht. Ältere Versionen kannst du im Archiv unter „Versionen“ wiederherstellen.")}</p>
          <div class="lib-actions" style="margin-top:12px;">
            <button class="btn btn-sm" id="lib-imp-nur">${
              neu === 1 ? T("library.imp_nur_neue_1", "Nur die neue aufnehmen")
              : neu ? T("library.imp_nur_neue", "Nur die {n} neuen aufnehmen").replace("{n}", num(neu))
                    : T("library.cancel", "Abbrechen")}</button>
            <button class="btn btn-sm" id="lib-imp-alle">${T("library.imp_trotzdem", "Trotzdem alle aufnehmen")}</button>
          </div>
        </div>`,
        onClose: () => { if (!beantwortet) { beantwortet = true; fertig(false); } },
      });
      const ende = (wert) => {
        if (beantwortet) return;
        beantwortet = true;
        m.close();
        fertig(wert);
      };
      const nur = document.getElementById("lib-imp-nur");
      if (nur) nur.onclick = () => ende(false);
      const alle = document.getElementById("lib-imp-alle");
      if (alle) alle.onclick = () => ende(true);
    });
  }

  async function importSingleFiles(paths) {
    let liste = paths || null;
    if (!liste) {
      const w = await api().library_dateien_waehlen();
      if (!w || w.cancelled) return;
      if (!w.ok) { toast(w.error || T("library.import_fail", "Import fehlgeschlagen"), "error"); return; }
      liste = w.paths;
    }
    try {
      const pr = await api().library_import_pruefen(liste);
      if (pr && pr.ok && pr.bekannt) {
        const bekannt = pr.dateien.filter(e => e.art !== "neu");
        const neue = pr.dateien.filter(e => e.art === "neu").map(e => e.pfad);
        if (!await importFrage(bekannt, neue.length)) {
          if (!neue.length) return;      // es blieb nichts übrig
          liste = neue;
        }
      }
    } catch (e) {
      applog && applog("warn", "[Archiv] Import-Prüfung: " + e);
    }
    const res = await api().library_import_files(liste);
    if (!res || res.cancelled) return;
    if (!res.ok) { toast(res.error || T("library.import_fail", "Import fehlgeschlagen"), "error"); return; }
    if (!res.kopiert && !res.uebersprungen) {
      toast(T("library.import_none", "Keine Track-Dateien erkannt"), "warn");
      return;
    }
    toast(T("library.import_done", "Dateien importiert — Einlesen läuft")
      + ` (${res.kopiert}${res.uebersprungen ? " · " + res.uebersprungen + " " + T("library.import_skip", "schon da") : ""})`);
    await reloadFolders();
    if (_foldersModal) { _foldersModal.update({ body: foldersModalHtml() }); bindFoldersModal(); }
    startScan(false, res.folder);
  }

  async function addFolder() {
    const res = await api().library_add_folder("");
    if (res.cancelled) return;
    if (!res.ok) { toast(res.error || T("library.add_folder_fehler", "Ordner konnte nicht hinzugefügt werden"), "error"); return; }
    await reloadFolders();
    if (_foldersModal) { _foldersModal.update({ body: foldersModalHtml() }); bindFoldersModal(); }
    else await openFoldersModal();
    // 22.08.2026 (Audit): nur den NEUEN Ordner einlesen — vorher lief der
    // Voll-Scan über alle (beim Tester: 103k Dateien für 28 neue).
    startScan(false, res.path || res.folder || "");
  }

  async function startScan(force, folder) {
    const res = await api().library_scan_start(!!force, folder || "");
    if (!res.ok) { toast(res.error || T("library.scan_laeuft", "Einlesen läuft bereits"), "warn"); return; }
    const btn = $("lib-scan");
    if (btn) btn.disabled = true;
    const stop = $("lib-scan-stop");
    if (stop) { stop.hidden = false; stop.disabled = false; }
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
          if (st.phase === "zaehlen") {
            // 22.08.2026: Zähl-Phase sichtbar machen (stand vorher minutenlang „0 / ?")
            info.innerHTML = `<div class="lib-progress"><i style="width:0%"></i></div>
              <div class="lib-progress-txt">${T("library.scan_zaehlt", "Dateien werden gezählt …")} ${num(st.gefunden || 0)}</div>`;
          } else {
            const pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
            info.innerHTML = `<div class="lib-progress"><i style="width:${pct}%"></i></div>
              <div class="lib-progress-txt">${st.done || 0} / ${st.total || "?"} · ${esc(st.current || "")}</div>`;
          }
        }
        pollScan();
      } else {
        const btn = $("lib-scan");
        if (btn) btn.disabled = false;
        const stop = $("lib-scan-stop");
        if (stop) stop.hidden = true;
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
    /** Nur der Ordner, in dem die Datei liegt — der Dateiname steht darüber. */
    const _ordnerVon = (pfad) => {
      const teile = String(pfad || "").split(/[\\/]/);
      teile.pop();
      return teile.slice(-2).join("/") || String(pfad || "");
    };
    const items = (res && res.items) || [];
    const ohne = items.filter(i => i.error_kind === "no_points");
    const kaputt = items.filter(i => i.error_kind !== "no_points");
    const gesamt = (zahlen && zahlen.gesamt) || items.length;
    const gekuerzt = gesamt > items.length;

    // 02.09.2026 (Beta-Tester: „es wäre schön, wenn man die Datei vor
    // dem Löschen ansehen kann, zum Beispiel zeigen im Finder. Erspart langes
    // Suchen."): Der Dateiname allein sagt nicht, WO die Datei liegt — bei
    // gleichnamigen Exporten aus mehreren Ordnern hilft er gar nicht. Jetzt
    // steht der Ordner darunter, und ein Knopf zeigt die Datei im Finder
    // (Windows: Explorer), ohne sie anzufassen.
    const zeile = (i) => `
      <div class="lib-err-zeile">
        <label class="lib-dupe-item lib-dupe-pick">
          <input type="checkbox" class="lib-err-cb" data-path="${esc(i.path)}">
          <span class="lib-dupe-name">${esc(i.filename)}
            <span class="lib-err-ordner">${esc(_ordnerVon(i.path))}</span></span>
          ${i.hidden ? `<span class="lib-dupe-keep">${T("library.err_dismissed", "weggeräumt")}</span>` : ""}
        </label>
        <button class="btn btn-ghost btn-sm lib-err-zeigen" data-zeigen="${esc(i.path)}"
                title="${T("library.err_reveal_tip", "Die Datei im Finder zeigen — sie wird nicht verändert")}">📁</button>
      </div>`;
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

    // Die Datei im Finder zeigen, bevor man über sie entscheidet.
    document.querySelectorAll("[data-zeigen]").forEach(b => {
      b.onclick = (ev) => {
        ev.preventDefault(); ev.stopPropagation();   // nicht das Kästchen umschalten
        api().library_reveal(b.dataset.zeigen);
      };
    });

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
    // v0.9.522 — vorher der einzige Knopf im Archiv OHNE Warte-Zustand:
    // Bei vielen Touren vergehen hier Sekunden, und nichts zeigte das an.
    const frei = knopfBeschaeftigt("lib-dupes", "library.dupes_working", "Suche Doppelte …");
    if (!frei) return;
    await malPause();
    let res;
    try { res = await api().library_duplicates(); }
    finally { frei(); }
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
        <p class="lib-dupe-intro">${T("library.dupe_intro2",
          "Diese Touren liegen mehrfach auf deiner Platte. Für GPS Studio ist das kein Problem — es ist jeweils EINE Tour, das Archiv schreibt nur \u201E2\u00D7 Dateien\u201C daran. Wegräumen lohnt sich also nur, wenn du Platz sparen willst.")}</p>
        <p class="lib-dupe-intro">${T("library.dupe_intro3",
          "Angehakte Dateien wandern in den Papierkorb deines Systems — es sind DEINE Dateien, GPS Studio löscht nichts endgültig. Die Tour bleibt in jedem Fall: Die Bibliothek hat ihre eigene Kopie.")}</p>
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
  { const np = document.getElementById("lib-proj-new");
    if (np) np.onclick = () => {
      const m = openModal({
        title: "🆕 " + T("library.proj_new", "Neues Projekt"),
        body: `<p class="lib-hint">${T("library.proj_new_hint", "Startet leer — Touren kannst du später mit ➕ hinzufügen oder es gleich ohne Tour öffnen (Reiseroute, Kartenflug).")}</p>
               <input type="text" id="lib-proj-newname" class="lib-input" value="${esc(T("topbar.project.new_empty_default", "Neues Projekt"))}">`,
        footer: `<button class="btn" id="lib-pn-ab">${T("common.cancel", "Abbrechen")}</button>
                 <button class="btn btn-primary" id="lib-pn-ok">OK</button>`,
      });
      const ok = document.getElementById("lib-pn-ok");
      if (ok) ok.onclick = async () => {
        const v = (document.getElementById("lib-proj-newname") || {}).value || "";
        m.close();
        if (!v.trim()) return;
        const r = await api().projekt_frei_anlegen(v.trim());
        if (typeof applog === "function") applog("info", "[PM] Neues leeres Projekt via SEITENLEISTE: " + JSON.stringify(!!(r && r.ok)));
        if (r && r.ok) {
          // v0.9.613 (Marc: „sollte doch gleich in der liste erscheinen"):
          // aktiver Bereich (z. B. „fertig"/„Automatisch") oder Suchtext
          // filterte das frische Projekt unsichtbar — nach dem Anlegen
          // immer auf „Alle" springen und Filter leeren.
          _projScope = "alle";
          _projFilterGh = "";
          const su = $("lib-search");
          if (su && su.value) { su.value = ""; setFilter("search", ""); }
          toast(T("library.proj_angelegt", "Projekt angelegt."), "info");
          renderProjekte();
        }
        else toast((r && r.error) || "?", "error");
      };
      const ab = document.getElementById("lib-pn-ab");
      if (ab) ab.onclick = () => m.close();
    }; }
  { const sp = document.getElementById("lib-seg-projekte");
    const st = document.getElementById("lib-seg-touren");
    if (sp) sp.onclick = () => { if (!_projView) projViewSetzen(true); };
    if (st) st.onclick = () => { if (_projView) projViewSetzen(false); }; }
  // Q19/Q21: Ein AUSDRÜCKLICHER Sprung („Alle Projekte …" im Topbar-Menü)
  // setzt diese Flagge; hier wird sie genau einmal verbraucht.
  // 02.09.2026: Ohne Flagge entscheidet das Gedächtnis — die Ansicht, die
  // zuletzt offen war. Beim allerersten Start sind das die Projekte
  // („woran war ich dran?"); die Playwright-Selbsttests wollen die Touren.
  if (window.__rzStartProjekte) {
    window.__rzStartProjekte = false;
    projViewSetzen(true);
  } else {
    const zuletzt = window.__rzKeinPmBoot ? false : store.getJson("projview", true);
    if (zuletzt !== _projView) projViewSetzen(zuletzt);
  }
  // v0.9.611: „Alle Projekte …" im Topbar-Dropdown, wenn das Archiv SCHON
  // offen ist (switchMod re-mountet dann nicht — die Flagge bliebe liegen).
  window.addEventListener("rz-projekte-anzeigen", () => {
    if (_unmounted) return;
    window.__rzStartProjekte = false;
    if (!_projView) projViewSetzen(true);
  });
  // v0.9.614: Topbar hat ein leeres Projekt angelegt — offene Liste auffrischen.
  window.addEventListener("rz-projekt-angelegt", () => {
    if (_unmounted || !_projView) return;
    _projScope = "alle";
    _projFilterGh = "";
    const su = $("lib-search");
    if (su && su.value) { su.value = ""; setFilter("search", ""); }
    renderProjekte();
  });
  $("lib-search").oninput = debounce(() => {
    setFilter("search", $("lib-search").value);
    _ortAus = false;           // neue Eingabe → Gegend wieder erlauben
    if (_projView) { renderProjekte(); return; }
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

  // ── Zeitraum (v0.9.505) ──────────────────────────────────────────────────
  function zeitraumAnzeigen() {
    const eigen = $("lib-range").value === "eigen";
    $("lib-range-fields").hidden = !eigen;
    $("lib-von").value = state.von || "";
    $("lib-bis").value = state.bis || "";
    // Jahr und Zeitraum meinen dasselbe — beide gleichzeitig wäre ein
    // Widerspruch, den niemand auflösen kann. Der Zeitraum gewinnt, das
    // Jahres-Feld wird solange gesperrt und sichtbar geleert.
    const aktiv = !!(state.von || state.bis);
    const jahr = $("lib-year");
    if (jahr) {
      jahr.disabled = aktiv;
      jahr.title = aktiv
        ? T("library.range_year_off", "Ein Zeitraum ist eingestellt — das Jahr richtet sich danach.")
        : "";
    }
  }

  function zeitraumSetzen(von, bis) {
    setFilter("von", von || null);
    setFilter("bis", bis || null);
    if (von || bis) setFilter("year", 0);   // sonst filtern zwei Dinge dasselbe
    zeitraumAnzeigen();
    reload();
  }

  $("lib-range").onchange = () => {
    const gewaehlt = ZEITRAEUME.find(z => z.id === $("lib-range").value);
    if (!gewaehlt) return;
    if (!gewaehlt.bereich) { zeitraumAnzeigen(); return; }   // „eigener“
    const [v, b] = gewaehlt.bereich();
    zeitraumSetzen(v, b);
  };
  const datumGesetzt = debounce(() => {
    zeitraumSetzen($("lib-von").value || null, $("lib-bis").value || null);
  }, 500);
  $("lib-von").oninput = datumGesetzt;
  $("lib-bis").oninput = datumGesetzt;
  // Beim Öffnen den gespeicherten Stand zeigen.
  if (state.von || state.bis) $("lib-range").value = "eigen";
  zeitraumAnzeigen();
  $("lib-reset").onclick = () => {
    setFilter("search", "");
    setFilter("year", 0); setFilter("activity", ""); setFilter("sort", "date_desc");
    setFilter("von", null); setFilter("bis", null);
    // ⚠️ Nicht nur den Wert zurücksetzen, sondern auch die Anzeige: sonst
    // bleiben die beiden Datumsfelder mit den alten Daten stehen, obwohl sie
    // nichts mehr filtern — und das Jahres-Feld bliebe gesperrt.
    if ($("lib-range")) { $("lib-range").value = ""; zeitraumAnzeigen(); }
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
  grid.addEventListener("scroll", () => { fensterAktualisieren(grid, "cards"); scrollNachladen(grid); }, { passive: true });
  $("lib-list").addEventListener("scroll", () => { fensterAktualisieren($("lib-list"), "list"); scrollNachladen($("lib-list")); }, { passive: true });
  // Fenstergröße ändert Spaltenzahl/Zeilenhöhe → Fenster neu messen
  try {
    let _roRaf = 0;
    const _ro = new ResizeObserver((eintraege) => {
      if (_unmounted || !_items.length) return;
      // Nur auf echte Breitenänderungen reagieren (Spaltenzahl) — Höhen
      // und Scrollleisten ändern sich beim Rendern selbst und würden sonst
      // eine Endlosschleife Render → Resize → Render auslösen.
      let breiteNeu = false;
      for (const e of eintraege) {
        const w = Math.round(e.contentRect.width);
        if (e.target._fensterBreite !== undefined && Math.abs(e.target._fensterBreite - w) > 2) breiteNeu = true;
        e.target._fensterBreite = w;
      }
      if (!breiteNeu || _roRaf) return;
      _roRaf = requestAnimationFrame(() => {
        _roRaf = 0;
        if (_unmounted) return;
        if (view === "cards") renderGrid(); else if (view === "list") renderList();
      });
    });
    _ro.observe(grid); _ro.observe($("lib-list"));
  } catch (_) {}
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
    // 02.09.2026 (Marc: „die App merkt sich den Stand nicht beim Schließen,
    // sondern startet immer wieder im Archiv"): Beim ERSTEN Betreten nach dem
    // Programmstart dort weitermachen, wo zuletzt gearbeitet wurde — dasselbe
    // Projekt, dieselbe Tour, dasselbe Modul. Danach nie wieder, sonst käme
    // man aus dem Archiv nicht mehr heraus.
    if (!window.__rzFortsetzenGeprueft) {
      window.__rzFortsetzenGeprueft = true;
      try {
        const r = await api().letzte_sitzung();
        if (r && r.ok && r.weiter && r.projekt_id) {
          await projektOeffnen(r.projekt_id, r.modul || undefined);
        }
      } catch (e) {
        try { applog("warn", "[bib] Fortsetzen: " + e); } catch (_) {}
      }
    }
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
    // 22.08.2026 (Audit): nie mitten ins Tippen (Notiz/Schlagworte) hinein neu
    // rendern — der Auto-Tick ersetzte die Textarea und fraß die Eingabe.
    const tippt = (() => {
      const a = document.activeElement;
      return !!(a && (a.tagName === "TEXTAREA" || a.tagName === "INPUT") && body.contains(a));
    })();
    if (_autoThumbs || _autoPlaces) {
      renderHead();
      if (++_autoTick % 4 === 0 && !tippt) reload();
    } else if (wasRunning) {
      _autoTick = 0;
      if (!tippt) reload();
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
