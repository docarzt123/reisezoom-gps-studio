/* Reisezoom GPS Studio — GPX-Picker im Modul-Header (v0.8.2)
 *
 * Globale GPX-Quelle für alle Module. Wird ins Module-Header-DOM
 * eingesetzt (statt dass jedes Modul seinen eigenen Picker in der
 * Sidebar hat). Modul-Überschriften sind raus — der aktive Modul-Tab
 * oben in der Topbar zeigt eh wo man ist.
 *
 * API (window):
 *   loadGlobalGpx(path)      — lädt + verteilt an alle Module
 *   clearGlobalGpx()          — schließt Track + leert Session
 *   getGlobalGpxPath()        — aktueller Pfad oder ""
 *   getGlobalGpxData()        — letzter Parse-Result (coords, stats, …)
 *   onGpxLoaded(cb)           — Listener für Module
 *   renderGpxBarInto(elem)    — fügt HTML + Event-Bindings in einen
 *                               Container ein (von app.js nach jedem
 *                               Modul-Mount gerufen)
 */

(function() {
  "use strict";

  // v0.9.282 — Universelle Track-Import-Schicht: nicht nur GPX, sondern auch
  // FIT/NMEA/KML/KMZ/TCX/GeoJSON öffnen — das Backend konvertiert beim Laden
  // transparent nach GPX. Filter (Picker) + Erkennungs-Regex (Drag&Drop).
  // Global auf window, damit Module (Geotagger) denselben Filter nutzen.
  // WICHTIG (Nutzer-Bug v0.9.285): pywebviews Windows-Backend validiert die
  // Filter-Beschreibung mit Regex `[\w ]+` — KEINE Sonderzeichen (Bindestrich!).
  // „Track-Dateien" crashte → daher „Track Dateien" (nur Buchstaben + Leerzeichen).
  window.TRACK_PICK_FILTER = [
    "Track Dateien (*.gpx;*.fit;*.nmea;*.log;*.kml;*.kmz;*.tcx;*.geojson;*.json)",
    "GPX (*.gpx)",
  ];
  // Drag&Drop: generische .json/.txt bewusst NICHT mitnehmen (zu mehrdeutig).
  window.TRACK_DROP_RE = /\.(gpx|fit|nmea|log|kml|kmz|tcx|geojson)$/i;

  // ── Globaler State ────────────────────────────────────────────────────
  let _gpxPath = "";
  let _gpxData = null;
  const _gpxListeners = new Set();

  window.getGlobalGpxPath = () => _gpxPath;
  window.getGlobalGpxData = () => _gpxData;
  window.onGpxLoaded = (cb) => { _gpxListeners.add(cb); return () => _gpxListeners.delete(cb); };

  function notifyGpxLoaded() {
    for (const cb of _gpxListeners) {
      try { cb({ path: _gpxPath, data: _gpxData }); }
      catch (err) { console.warn("gpx listener threw:", err); }
    }
  }

  // ── Quelldatei-fehlt-Banner (v0.9.305) ────────────────────────────────
  // Wenn die zuletzt geladene GPX-Datei nicht mehr lesbar ist (externe Platte
  // ab, Datei verschoben/gelöscht), zeigen wir EIN klares Banner statt jedes
  // Modul still in einen kaputt aussehenden Leer-Zustand laufen zu lassen.
  // Module rufen window.showSourceMissingBanner(path) in ihrem Load-Fehlerpfad.
  const _MISSING_FILE_RE = /no such file|errno\s*2|enoent|nicht gefunden|cannot find|file not found/i;
  window.isMissingFileError = (err) => _MISSING_FILE_RE.test(String(err || ""));
  let _smBannerBound = false;
  function _bindSourceMissingBanner() {
    if (_smBannerBound) return;
    const pick = document.getElementById("source-missing-banner-pick");
    const close = document.getElementById("source-missing-banner-close");
    if (!pick || !close) return;
    _smBannerBound = true;
    pick.onclick = () => { window.hideSourceMissingBanner(); if (typeof window.pickGpx === "function") window.pickGpx(); };
    close.onclick = () => window.hideSourceMissingBanner();
  }
  window.showSourceMissingBanner = function(path) {
    const bar = document.getElementById("source-missing-banner");
    const txt = document.getElementById("source-missing-banner-text");
    if (!bar || !txt) return;
    _bindSourceMissingBanner();
    const name = String(path || "").split("/").pop() || path || "";
    const tpl = (typeof t === "function")
      ? t("app.source_missing", "Quelldatei nicht gefunden: <b>{name}</b> — Laufwerk gemountet?")
      : "Quelldatei nicht gefunden: <b>{name}</b> — Laufwerk gemountet?";
    txt.innerHTML = tpl.replace("{name}", escapeHtml(name));
    bar.hidden = false;
  };
  window.hideSourceMissingBanner = function() {
    const bar = document.getElementById("source-missing-banner");
    if (bar) bar.hidden = true;
  };

  /** Lädt ein GPX einmal global. Master-Parse via animator_load_gpx
   *  (liefert die breiteste Stats-Sicht inkl. elevations). Aktiviert die
   *  Session, benachrichtigt alle Module. */
  window.loadGlobalGpx = async function(path) {
    if (!path) return false;
    try {
      if (window.applog) window.applog("info", `[loadGlobalGpx] start path=${path}`);
      const res = await api().animator_load_gpx(path);
      if (!res || !res.ok) {
        if (window.applog) window.applog("error", `[loadGlobalGpx] parse fail: ${res?.error}`);
        if (window.isMissingFileError(res?.error)) window.showSourceMissingBanner(path);
        else toast(res?.error || "GPX-Fehler", "error");
        return false;
      }
      window.hideSourceMissingBanner();
      if (window.applog) window.applog("info", `[loadGlobalGpx] parsed n_coords=${res.coords?.length}`);
      _gpxPath = path;
      _gpxData = res;
      if (typeof sessionActivate === "function") {
        try { await sessionActivate(res.coords, path); }
        catch (err) { console.warn("sessionActivate (gpx-bar):", err); }
      }
      // v0.9.27 (Nutzer-Feedback): letzten GPX-Pfad persistieren damit
      // er beim App-Restart automatisch wiederhergestellt werden kann.
      try { if (typeof saveSettings === "function") saveSettings({ last_gpx_path: path }); }
      catch (_) {}
      _renderCurrent();
      notifyGpxLoaded();
      return true;
    } catch (err) {
      console.warn("loadGlobalGpx error:", err);
      if (window.isMissingFileError(err)) window.showSourceMissingBanner(path);
      else toast("GPX konnte nicht geladen werden: " + err, "error");
      return false;
    }
  };

  window.clearGlobalGpx = function() {
    // v0.9.185 — beim Leeren ALLES explizit Stück für Stück abräumen (auf der
    // lebenden Karte), statt hinterher zu pollen ob noch was da ist:
    // 1) Schilder (Layer + Bilder + Daten + Editor) via lebenden Animator-Handle.
    //    window.__rzAnimSigns zeigt immer auf den aktiven Mount → closure-sicher.
    try { if (window.__rzAnimSigns && window.__rzAnimSigns.clearAll) window.__rzAnimSigns.clearAll(); } catch (_) {}
    // 2) GPX-Track-State
    _gpxPath = "";
    _gpxData = null;
    _renderCurrent();
    notifyGpxLoaded();
    // 3) persistierten Zustand leeren, damit der App-Neustart wirklich LEER
    //    hochkommt (sonst lädt app.js das zuletzt geladene GPX automatisch wieder).
    try { if (typeof saveSettings === "function") saveSettings({ last_gpx_path: "" }); } catch (_) {}
    if (typeof _resetActiveSession === "function") _resetActiveSession();
  };

  // ── v0.9.155: Globaler Workspace-Clear ────────────────────────────────
  // Marc-Wunsch: statt drei modul-eigener „Workspace leeren"-Buttons ein
  // einziges rotes ✕ neben dem GPX im Modul-Header. Ein Klick räumt ALLE
  // Module gleichzeitig (GPX-Track, Fotos, Match-Daten, Backend-State) und
  // leert auch den GPX-Namen oben.
  //
  // Jedes Modul registriert beim IIFE-Init seine eigene Reset-Funktion via
  // registerWorkspaceResetter(fn). Die Closures der Module bleiben über
  // Modul-Wechsel hinweg bestehen (IIFE wird nur 1× geladen, nur das DOM
  // wird ausgetauscht) — deshalb greifen die Resetter auch für gerade nicht
  // gemountete Module (DOM-Zugriffe sind dort guarded/no-op).
  window.__workspaceResetters = window.__workspaceResetters || new Map();
  window.registerWorkspaceResetter = function(fn, key) {
    // v0.9.389 — per Modul-Key deduplizieren (Map statt Set): bei Re-Mount ersetzt der
    // neue Resetter den alten, statt dass die Sammlung pro Tab-Wechsel wächst. Sonst lief
    // „Workspace leeren" N stale Resetter = N× Backend-Clear + N× saveSettings.
    if (typeof fn === "function") window.__workspaceResetters.set(key || fn, fn);
  };

  /** Zeigt EIN Bestätigungs-Modal, räumt dann alle Module + GPX-Bar. */
  window.clearWorkspaceGlobal = function() {
    // confirmClearWorkspace(null, …) → „alle Module"-Text (confirm_all)
    if (typeof confirmClearWorkspace !== "function") {
      // Fallback ohne Modal — sollte nie passieren
      _runAllResetters();
      window.clearGlobalGpx();
      return;
    }
    confirmClearWorkspace(null, async () => {
      await _runAllResetters();
      window.clearGlobalGpx();   // GPX-Name oben + Session leeren
    });
  };

  async function _runAllResetters() {
    for (const fn of window.__workspaceResetters.values()) {
      try { await fn(); }
      catch (err) { console.warn("workspace resetter threw:", err); }
    }
  }

  // ── HTML-Templates ────────────────────────────────────────────────────
  function templateEmpty() {
    return `
      <div class="gpxbar-empty">
        <button class="gpxbar-pick-btn" type="button" data-gpxbar="pick-empty">
          <span class="gpxbar-icon">📂</span>
          <span>Track wählen …</span>
        </button>
        <span class="gpxbar-hint">… oder Track (GPX/FIT/KML…) hierher ziehen.</span>
      </div>
    `;
  }
  function templateLoaded(name, fullPath, stats) {
    const dist = stats?.distance_km != null ? fmtKm(stats.distance_km * 1000) : "—";
    const time = stats?.duration_s != null ? fmtDur(stats.duration_s) : "—";
    const asc  = stats?.ascent_m   != null ? "↑ " + fmtMeter(stats.ascent_m)  : "—";
    const desc = stats?.descent_m  != null ? "↓ " + fmtMeter(stats.descent_m) : "—";
    return `
      <div class="gpxbar-loaded">
        <button class="gpxbar-pick-btn gpxbar-pick-btn-compact" type="button"
                data-gpxbar="pick" title="Anderen Track wählen">
          <span class="gpxbar-icon">📂</span>
        </button>
        <span class="gpxbar-filename" title="${escapeAttr(fullPath)}">${escapeHtml(name)}</span>
        <span class="gpxbar-sep">·</span>
        <span class="gpxbar-stat">${escapeHtml(dist)}</span>
        <span class="gpxbar-stat">${escapeHtml(time)}</span>
        <span class="gpxbar-stat">${escapeHtml(asc)}</span>
        <span class="gpxbar-stat">${escapeHtml(desc)}</span>
        <button class="gpxbar-close-btn gpxbar-clearws-btn" type="button" data-gpxbar="clearws"
                title="${escapeAttr((typeof t === "function" ? t("common.clear_workspace") : "Workspace leeren"))}">✕</button>
      </div>
    `;
  }

  // ── Mount/Render ──────────────────────────────────────────────────────
  let _container = null;

  /** Wird von app.js nach jedem Modul-Mount gerufen. Container ist der
   *  linke Bereich im module-header. Räumt vorherigen Inhalt + Listener
   *  weg und baut frisch auf. */
  window.renderGpxBarInto = function(container) {
    _container = container;
    _renderCurrent();
    _bindEvents();
    _setupDragDrop();
  };

  function _renderCurrent() {
    if (!_container) return;
    if (_gpxPath && _gpxData) {
      const name = _gpxData.name || _gpxPath.split("/").pop();
      _container.innerHTML = templateLoaded(name, _gpxPath, _gpxData.stats);
    } else {
      _container.innerHTML = templateEmpty();
    }
    _bindEvents();
  }

  function _bindEvents() {
    if (!_container) return;
    _container.querySelectorAll("[data-gpxbar]").forEach(el => {
      const action = el.dataset.gpxbar;
      el.onclick = (e) => {
        e.preventDefault();
        if (action === "pick-empty" || action === "pick") pickGpx();
        else if (action === "clearws") window.clearWorkspaceGlobal();
        else if (action === "clear") window.clearGlobalGpx();   // Legacy-Fallback
      };
    });
  }

  async function pickGpx() {
    const files = await api().pick_file("open", window.TRACK_PICK_FILTER, false);
    if (!files || !files.length) return;
    await window.loadGlobalGpx(files[0]);
  }
  // v0.9.288 — global exponiert, damit das macOS-Menü „Datei → Track öffnen…"
  // denselben Picker auslösen kann wie der Topbar-Button.
  window.pickGpx = pickGpx;

  function _setupDragDrop() {
    if (!_container || _container._gpxDndBound) return;
    _container._gpxDndBound = true;
    _container.addEventListener("dragover", (e) => {
      if (!e.dataTransfer?.types?.includes("Files")) return;
      e.preventDefault();
      _container.classList.add("is-drag-over");
    });
    _container.addEventListener("dragleave", (e) => {
      if (!_container.contains(e.relatedTarget)) _container.classList.remove("is-drag-over");
    });
    _container.addEventListener("drop", async (e) => {
      e.preventDefault();
      _container.classList.remove("is-drag-over");
      // v0.9.153: echten Originalpfad via pywebview holen (WKWebView gibt dem
      // JS nur den Namen, kein .path). consumeNativeDropMap() pro Drop 1× rufen.
      const nativeMap = (typeof consumeNativeDropMap === "function")
                        ? await consumeNativeDropMap() : {};
      const files = (e.dataTransfer && e.dataTransfer.files) || [];
      const gpx = Array.from(files).find(f => window.TRACK_DROP_RE.test(f.name));
      let path = null;
      if (gpx) {
        path = nativePathFromMap(nativeMap, gpx.name) || gpx.path || null;
      }
      // Auffang: JS bekam keine Files (WKWebView) → erster Track aus nativen Pfaden
      if (!path) {
        for (const k in nativeMap) {
          if (window.TRACK_DROP_RE.test(k)) { path = nativeMap[k]; break; }
        }
      }
      if (path) await window.loadGlobalGpx(path);
    });
  }

  // ── Utilities ─────────────────────────────────────────────────────────
  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }
})();
