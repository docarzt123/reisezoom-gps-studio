// Reisezoom GPS Studio — GPX-Inspektor-Modul (v0.9.233)
// Marc-Idee + Nutzer-Bug-Report (c): Track Punkt-für-Punkt zeigen und „heilen".
// Phase 1: alle Punkte auf der Karte, 2 Anker wählen → Heilen (Sprung glätten,
// Position+Höhe interpolieren, Zeit behalten → Speed korrigiert sich selbst)
// ODER Lücke füllen (neue Punkte mit interpolierter Position/Höhe/Zeit einfügen).
// Editierter Track wird als <name>_geheilt.gpx gespeichert.

(window.RZGPS_MODULES = window.RZGPS_MODULES || {}).gpxinspect = {
  manifest: {
    slug: "gpxinspect",
    name: "GPX-Inspektor",
    description: "Track heilen",
    icon: "🔍",
    sort_order: 60,
  },
  mount: function (body, headerActions) { return mountGpxInspect(body, headerActions); },
};

function mountGpxInspect(body, headerActions) {
  let map = null;
  let isUnmounted = false;
  let _points = [];        // editierbare Kopie: [{lat,lon,ele,time}]
  let _srcPath = null;
  let _hasTime = false, _hasEle = false;
  let _selA = null, _selB = null;   // Anker-Indizes (a <= b)
  let _dirty = false;
  let _drawMode = false;            // Pfad-zeichnen-Modus aktiv?
  let _drawPts = [];                // selbst gesetzte Stützpunkte [{lat,lon}]
  // v0.9.239 — Auto-Despike: erkannte Ausreißer-Gruppen + Navigations-State.
  let _spikes = [];                 // [{a,b,from,to}] a=Anker vor, b=Anker nach
  let _spikeSet = new Set();        // Punkt-Indizes die als Ausreißer markiert sind
  let _spikeIdx = -1;               // aktuell anvisierter Ausreißer (für Navigation)
  let _gaps = [];                   // v0.9.294 — erkannte Lücken [{a,b,dist}] (b=a+1) für Auto-Heilen
  let _despikeRan = false;          // wurde schon mind. 1× gesucht? (Slider live-Update)
  let _dragging = false;            // ziehe gerade den ausgewählten Punkt? (v0.9.243)
  let _dragMoved = false;           // hat sich beim Ziehen wirklich was bewegt?
  let _demEles = null;              // v0.9.292 — gesampelte Mapbox-Gelände-Höhe pro Punkt (oder null)
  // v0.9.293 — Höhenprofil-Zoom (Fenster in Punkt-Indizes) + Karten-Sync + Punkt-Modal
  let _profI0 = 0, _profI1 = 0;     // sichtbares Index-Fenster im Profil
  let _syncing = false;             // Reentrancy-Schutz Karte<->Profil
  let _profDraw = null;             // letzte Zeichen-Parameter fürs Hit-Testing
  let _maplib = null;               // Karten-Lib (mapboxgl/maplibregl) für Popup
  let _aMarker = null, _bMarker = null;   // v0.9.304 — deutliche A/B-Anker-Pins
  let _ptPopup = null;              // Mapbox-Popup mit Punkt-Info (Karte)
  let _clickTimer = null;           // Einzel-/Doppelklick-Entscheidung

  // v0.9.238 — Undo/Redo (Cmd+Z / Cmd+Shift+Z) für ALLE Track-Edits.
  // Snapshot/Restore auf der kompletten _points-Liste. Vor jeder Operation
  // wird der Stand gepusht (force, kein Throttle — jede Aktion ist diskret).
  const _undo = (typeof window.createUndoController === "function") ? window.createUndoController({
    snapshot: () => ({ points: JSON.parse(JSON.stringify(_points)), dirty: _dirty }),
    apply: (snap) => {
      _points = JSON.parse(JSON.stringify((snap && snap.points) || []));
      _dirty = !!(snap && snap.dirty);
      // A/B-Auswahl ist UI-Zustand (keine Daten) → nach Undo/Redo behalten, solange die
      // Anker-Indizes noch im Track liegen. Nur ungültige (out of range) verwerfen.
      const _n = _points.length;
      if (_selA != null && _selA >= _n) _selA = null;
      if (_selB != null && _selB >= _n) _selB = null;
      if (_selA == null) _selB = null;
      _drawMode = false; _drawPts = [];
      clearSpikes();
      renderAll(); renderDraw(); updateUI();
    },
    toast: (m) => { try { toast(m, "info", 1000); } catch (_) {} },
    throttleMs: 0,
  }) : null;
  if (_undo) window.__rzUndoControllers.gpxinspect = _undo;
  function _pushUndo(label) { if (_undo) _undo.push(label, { force: true }); }

  body.innerHTML = `
    <div class="panel gpxi-side">
        <div class="gpxi-empty" id="gpxi-empty">${t("gpxinspect.empty", "Lade ein GPX über die Leiste oben — dann erscheint hier jeder einzelne Track-Punkt.")}</div>
        <div class="gpxi-panel" id="gpxi-panel" hidden>
          <div class="gpxi-stat" id="gpxi-stat"></div>
          <div class="gpxi-mm-title">🩹 ${t("gpxinspect.heal_title", "Heilen (automatisch)")}<span class="gpxi-q" data-tip="${t("gpxinspect.heal_help", "Findet automatisch GPS-Ausreißer und Lücken und behebt sie. Bereich und Aktionen wählen, dann Heilen. Rückgängig jederzeit.")}">?</span></div>
          <div class="gpxi-segrow" role="radiogroup">
            <label class="gpxi-seg"><input type="radio" name="gpxi-heal-scope" id="gpxi-scope-track" value="track" checked> ${t("gpxinspect.scope_track", "Ganzer Track")}</label>
            <label class="gpxi-seg"><input type="radio" name="gpxi-heal-scope" id="gpxi-scope-ab" value="ab"> ${t("gpxinspect.scope_ab", "Abschnitt A→B")}</label>
          </div>
          <label class="gpxi-check"><input type="checkbox" id="gpxi-heal-spikes" checked> ${t("gpxinspect.heal_opt_spikes", "Ausreißer/Sprünge glätten")}</label>
          <label class="gpxi-check"><input type="checkbox" id="gpxi-heal-gaps" checked> ${t("gpxinspect.heal_opt_gaps", "Lücken mit Punkten füllen")}</label>
          <div class="gpxi-fillrow" id="gpxi-profilerow">
            <label>${t("gpxinspect.profile", "Lücken füllen als")}<span class="gpxi-q" data-tip="${t("gpxinspect.profile_help", "Luftlinie = gerade Linie zwischen den Punkten. Wandern/Fahrrad/Auto = die echte Route auf dem Wegenetz suchen (Mapbox, Internet + Token) und der Track folgt den Wegen. Sehr große Lücken (z. B. Flüge) bleiben immer gerade.")}">?</span></label>
            <select id="gpxi-profile">
              <option value="linear" selected>📏 ${t("gpxinspect.profile_linear", "Luftlinie (gerade)")}</option>
              <option value="walking">🚶 ${t("gpxinspect.mm_walking", "Zu Fuß / Wandern")}</option>
              <option value="cycling">🚴 ${t("gpxinspect.mm_cycling", "Fahrrad")}</option>
              <option value="driving">🚗 ${t("gpxinspect.mm_driving", "Auto")}</option>
            </select>
          </div>
          <div class="gpxi-fillrow gpxi-sensrow">
            <label>${t("gpxinspect.sens", "Empfindlichkeit")}<span class="gpxi-q" data-tip="${t("gpxinspect.sens_help", "Wie streng gesucht wird. Niedrig = nur krasse Ausreißer und große Lücken, hoch = auch kleine.")}">?</span></label>
            <input type="range" id="gpxi-sens" min="1" max="10" step="1" value="5">
            <span id="gpxi-sens-val" class="gpxi-sensval">5</span>
          </div>
          <div class="gpxi-fillrow">
            <label>${t("gpxinspect.spacing", "Abstand beim Füllen")}</label>
            <input type="number" id="gpxi-spacing" min="2" max="500" step="1" value="20"> m
          </div>
          <div class="gpxi-sel" id="gpxi-sel">${t("gpxinspect.sel_none", "Keine Auswahl")}</div>
          <button class="btn btn-primary gpxi-act" id="gpxi-heal-run">🩹 ${t("gpxinspect.heal_run", "Heilen")}</button>
          <div class="gpxi-undorow">
            <button class="btn" id="gpxi-undo" disabled title="⌘Z">↩︎ ${t("gpxinspect.undo", "Rückgängig")}</button>
            <button class="btn" id="gpxi-redo" disabled title="⌘⇧Z">↪︎ ${t("gpxinspect.redo", "Wiederherstellen")}</button>
          </div>

          <hr class="gpxi-hr">
          <details class="gpxi-manual" open>
            <summary class="gpxi-mm-title">✏️ ${t("gpxinspect.manual_title", "Manuell bearbeiten (A→B)")}<span class="gpxi-q" data-tip="${t("gpxinspect.manual_help", "Zwei Punkte auf der Karte klicken (A grün, B rot), dann eine Aktion für den Abschnitt dazwischen wählen — z. B. Punkte dazwischen löschen.")}">?</span></summary>
            <button class="btn gpxi-act" id="gpxi-heal" disabled
              title="${t("gpxinspect.heal_tip", "Die Punkte zwischen A und B auf die direkte Linie legen (Position + Höhe interpoliert). Zeitstempel bleiben → Geschwindigkeit wird wieder realistisch.")}">
              🩹 ${t("gpxinspect.heal", "Sprung glätten (A→B gerade)")}</button>
            <button class="btn gpxi-act" id="gpxi-fill" disabled
              title="${t("gpxinspect.fill_tip", "Zwischen A und B neue Punkte einfügen (Position, Höhe und Zeit interpoliert).")}">
              ➕ ${t("gpxinspect.fill", "Lücke füllen (Luftlinie)")}</button>
            <button class="btn gpxi-act" id="gpxi-match-sel" disabled
              title="${t("gpxinspect.match_sel_tip", "Findet die echte Straßen-/Wege-Route zwischen A und B (Wege-Profil oben). Robust gegen GPS-Drift.")}">
              🛣 ${t("gpxinspect.match_sel", "Strecke A→B (Straße folgen)")}</button>
            <button class="btn gpxi-act" id="gpxi-drawfill" disabled
              title="${t("gpxinspect.drawfill_tip", "Pfad zwischen A und B selbst auf der Karte zeichnen. Wird mit Position, Höhe und Zeit aufgefüllt.")}">
              ✏️ ${t("gpxinspect.drawfill", "Pfad zeichnen & füllen")}</button>
            <div class="gpxi-drawbox" id="gpxi-drawbox" hidden>
              <div class="gpxi-drawhint" id="gpxi-drawhint"></div>
              <button class="btn btn-primary gpxi-act" id="gpxi-draw-apply" disabled>✓ ${t("gpxinspect.draw_apply", "Pfad übernehmen")}</button>
              <button class="btn gpxi-act" id="gpxi-draw-undo" disabled>⤺ ${t("gpxinspect.draw_undo", "Letzten Punkt zurück")}</button>
              <button class="btn gpxi-act" id="gpxi-draw-cancel">✕ ${t("gpxinspect.draw_cancel", "Zeichnen abbrechen")}</button>
            </div>
            <button class="btn gpxi-act gpxi-del" id="gpxi-delete-one" disabled
              title="${t("gpxinspect.delete_one_tip", "Den ausgewählten Punkt (Anker A) entfernen. Geht auch mit Entf/Backspace.")}">
              🗑 ${t("gpxinspect.delete_one", "Diesen Punkt löschen")}</button>
            <button class="btn gpxi-act gpxi-del" id="gpxi-delete" disabled
              title="${t("gpxinspect.delete_tip", "Die Punkte zwischen A und B ganz entfernen (Schleifen/Abstecher rausschneiden). A und B bleiben, die Linie verbindet sie direkt.")}">
              ✂️ ${t("gpxinspect.delete", "Punkte zwischen A→B rausschneiden")}</button>
            <button class="btn gpxi-clear" id="gpxi-clearsel" disabled>${t("gpxinspect.clear_sel", "Auswahl aufheben")}</button>
          </details>
          <hr class="gpxi-hr">
          <div class="gpxi-mm-title">⛰ ${t("gpxinspect.ele_title", "Höhe korrigieren")}<span class="gpxi-q" data-tip="${t("gpxinspect.ele_help", "GPS-Höhe ist verrauscht. Lädt das Höhenprofil aus der Karte; darunter mischst du GPS und Karte mit dem Regler. Braucht Mapbox-Token + Internet.")}">?</span></div>
          <button class="btn gpxi-act" id="gpxi-ele-load">🗺 ${t("gpxinspect.ele_load", "Höhenprofil aus Karte laden")}</button>
          <div class="gpxi-fillrow gpxi-sensrow">
            <label>${t("gpxinspect.ele_weight", "GPS ⟷ Karte")}</label>
            <input type="range" id="gpxi-ele-weight" min="0" max="100" step="5" value="70" disabled>
            <span id="gpxi-ele-weight-val" class="gpxi-sensval">70 %</span>
          </div>
          <button class="btn btn-primary gpxi-act" id="gpxi-ele-apply" disabled>⛰ ${t("gpxinspect.ele_apply", "Diese Höhe übernehmen")}</button>
          <div class="gpxi-note muted" id="gpxi-ele-result"></div>
          <hr class="gpxi-hr">
          <button class="btn btn-primary" id="gpxi-save" disabled>💾 ${t("gpxinspect.save", "Geheiltes GPX speichern")}</button>
          <button class="btn gpxi-reset" id="gpxi-reset" disabled>↩︎ ${t("gpxinspect.reset", "Änderungen verwerfen")}</button>
          <div class="gpxi-note muted" id="gpxi-note"></div>
        </div>
    </div>
    <section class="canvas" id="gpxi-canvaswrap">
      <div id="gpxi-canvas"></div>
      <div id="gpxi-hoverbox" class="gpxi-hoverbox gpxi-pinfo" hidden></div>
      <div id="gpxi-ele-profile" class="gpxi-eleprof" hidden>
        <div class="gpxi-eleprof-head">
          <span class="gpxi-eleprof-title">⛰ ${t("gpxinspect.ele_profile_title", "Höhenprofil")}</span>
          <span class="gpxi-eleleg"><i class="gpxi-sw gpxi-sw-gps"></i>${t("gpxinspect.ele_leg_gps", "GPS (Original)")}</span>
          <span class="gpxi-eleleg"><i class="gpxi-sw gpxi-sw-dem"></i>${t("gpxinspect.ele_leg_map", "Karte (Mapbox)")}</span>
          <span class="gpxi-eleleg"><i class="gpxi-sw gpxi-sw-res"></i>${t("gpxinspect.ele_leg_res", "Ergebnis")}</span>
          <span class="gpxi-eleprof-info" id="gpxi-eleprof-info"></span>
        </div>
        <svg class="gpxi-eleprof-svg" id="gpxi-eleprof-svg" viewBox="0 0 1000 150" preserveAspectRatio="none" aria-hidden="true"></svg>
      </div>
    </section>
  `;

  // ── Map ──────────────────────────────────────────────────────────────────
  whenApiReady().then(async () => {
    if (isUnmounted) return;
    let made;
    try {
      made = createMap({
        container: "gpxi-canvas",
        mapboxStyle: "mapbox://styles/mapbox/outdoors-v12",
        common: { center: [10, 51], zoom: 4 },
      });
    } catch (e) {
      applog && applog("error", "[gpxinspect] createMap warf: " + e);
      return;
    }
    map = made.map;
    _maplib = made.lib;   // v0.9.293 — für Punkt-Info-Popup
    try { map.addControl(new made.lib.NavigationControl(), "top-right"); } catch (_) {}
    onMapReady(map, () => {
      if (isUnmounted) return;
      // Falls die Karte bei 0-Größe erzeugt wurde (Layout noch nicht fertig):
      try { map.resize(); } catch (_) {}
      const emptyLine = { type: "Feature", geometry: { type: "LineString", coordinates: [] } };
      const emptyFC = { type: "FeatureCollection", features: [] };
      try {
        map.addSource("gpxi-line", { type: "geojson", data: emptyLine });
        map.addLayer({ id: "gpxi-line-lyr", type: "line", source: "gpxi-line",
          paint: { "line-color": "#3aa0ff", "line-width": 2.4, "line-opacity": 0.85 } });
        // v0.9.294 — Lücken-Heil-Vorschau (andersfarbig): gestrichelte Füll-Linie + Geister-Punkte.
        map.addSource("gpxi-gapfill", { type: "geojson", data: emptyLine });
        map.addLayer({ id: "gpxi-gapfill-lyr", type: "line", source: "gpxi-gapfill",
          paint: { "line-color": "#e879f9", "line-width": 3, "line-dasharray": [1.5, 1.2], "line-opacity": 0.95 } });
        map.addSource("gpxi-gapfill-pts", { type: "geojson", data: emptyFC });
        map.addLayer({ id: "gpxi-gapfill-pts-lyr", type: "circle", source: "gpxi-gapfill-pts", paint: {
          "circle-radius": 3, "circle-color": "#e879f9", "circle-opacity": 0.55,
          "circle-stroke-width": 1, "circle-stroke-color": "#86198f",
        } });
        map.addSource("gpxi-pts", { type: "geojson", data: emptyFC });
        map.addLayer({ id: "gpxi-pts-lyr", type: "circle", source: "gpxi-pts", paint: {
          // Zoom-Interpolate MUSS oben stehen (Mapbox erlaubt kein zoom-interpolate
          // innerhalb eines case) — die Spike-Vergrößerung steckt im Output pro Stop.
          "circle-radius": ["interpolate", ["linear"], ["zoom"],
            9,  ["case", ["boolean", ["get", "spike"], false], 4,  2.2],
            14, ["case", ["boolean", ["get", "spike"], false], 7,  4.5],
            18, ["case", ["boolean", ["get", "spike"], false], 10, 7]],
          "circle-color": ["case",
            ["==", ["get", "sel"], "a"], "#22c55e",
            ["==", ["get", "sel"], "b"], "#ef4444",
            ["boolean", ["get", "spike"], false], "#f59e0b",
            "#cfe6ff"],
          "circle-stroke-width": ["case",
            ["boolean", ["get", "spike"], false], 2.4,
            ["boolean", ["get", "anchor"], false], 2.2, 0.6],
          "circle-stroke-color": ["case",
            ["==", ["get", "sel"], "a"], "#0a7a32",
            ["==", ["get", "sel"], "b"], "#a11",
            ["boolean", ["get", "spike"], false], "#7c4a02",
            "#1f6fc4"],
        } });
        // v0.9.237 — Pfad-Zeichnen: Preview-Linie A→Stützpunkte→B + Stützpunkt-Marker.
        map.addSource("gpxi-draw", { type: "geojson", data: emptyLine });
        map.addLayer({ id: "gpxi-draw-lyr", type: "line", source: "gpxi-draw",
          paint: { "line-color": "#ff9f1c", "line-width": 2.6, "line-dasharray": [2, 1.4], "line-opacity": 0.95 } });
        map.addSource("gpxi-draw-pts", { type: "geojson", data: emptyFC });
        map.addLayer({ id: "gpxi-draw-pts-lyr", type: "circle", source: "gpxi-draw-pts", paint: {
          "circle-radius": 5.5, "circle-color": "#ff9f1c",
          "circle-stroke-width": 2, "circle-stroke-color": "#fff",
        } });
        // v0.9.294 — Hover-Marker (verknüpft mit dem Höhenprofil-Cursor).
        map.addSource("gpxi-hover", { type: "geojson", data: emptyFC });
        map.addLayer({ id: "gpxi-hover-lyr", type: "circle", source: "gpxi-hover", paint: {
          "circle-radius": 7, "circle-color": "rgba(255,255,255,0.0)",
          "circle-stroke-width": 3, "circle-stroke-color": "#ffffff",
        } });
      } catch (e) { applog && applog("warn", "[gpxinspect] layer add: " + e); }
      // v0.9.291 — Terrain-DEM für die Höhenkorrektur (queryTerrainElevation).
      // Nur mit Mapbox-Token (raster-dem ist mapbox://). Bei pitch 0 (Top-Down)
      // ändert das die Optik nicht — wir brauchen's nur als Höhen-Datenquelle.
      if (typeof isMapboxMode === "function" && isMapboxMode()) {
        try {
          if (!map.getSource("gpxi-dem")) {
            map.addSource("gpxi-dem", { type: "raster-dem",
              url: "mapbox://mapbox.mapbox-terrain-dem-v1", tileSize: 512, maxzoom: 14 });
          }
          map.setTerrain({ source: "gpxi-dem", exaggeration: 1.0 });
        } catch (e) { applog && applog("warn", "[gpxinspect] terrain: " + e); }
      }
      // v0.9.294 — tolerante Klicks: nächster Punkt im Pixel-Radius (statt layer-gebunden).
      map.on("click", onMapClick);
      map.on("dblclick", onMapDbl);   // Doppelklick = Anker setzen
      // v0.9.293 — Karte bewegt/zoomt → Höhenprofil auf den sichtbaren Abschnitt syncen.
      map.on("moveend", onMapMoveSyncProfile);
      // v0.9.294 — Maus über der Karte → Position im Höhenprofil zeigen (verknüpfter Cursor).
      map.on("mousemove", onMapHover);
      map.on("mouseout", () => setHover(null));
      // Ausgewählten Punkt (Anker A, Einzel-Auswahl) per Drag verschieben (v0.9.243).
      map.on("mousedown", "gpxi-pts-lyr", onPointMouseDown);
      map.on("mousemove", onDragMove);
      map.on("mouseup", onDragEnd);
      map.on("mouseenter", "gpxi-pts-lyr", (e) => {
        if (_drawMode) { _setCursor("crosshair"); return; }   // Zeichnen-Modus: Fadenkreuz behalten
        const f = e.features && e.features[0];
        const grab = f && _selB === null && f.properties.i === _selA;
        _setCursor(grab ? "grab" : "pointer");
      });
      map.on("mouseleave", "gpxi-pts-lyr", () => {
        if (_drawMode) { _setCursor("crosshair"); return; }
        if (!_dragging) _setCursor("");
      });
      // Schon ein globales GPX geladen?
      const cur = (typeof getGlobalGpxPath === "function") ? getGlobalGpxPath() : null;
      if (cur) loadTrack(cur);
      // Nachträgliches Resize, falls das Layout erst nach onMapReady steht.
      setTimeout(() => { if (!isUnmounted && map) { try { map.resize(); } catch (_) {} } }, 350);
    });
  });

  if (typeof onGpxLoaded === "function") {
    onGpxLoaded(({ path }) => {
      if (isUnmounted) return;
      if (path) loadTrack(path); else clearTrack();
    });
  }

  // ── Laden / Anzeige ────────────────────────────────────────────────────────
  async function loadTrack(path) {
    let res;
    try { res = await api().gpxinspect_load(path); } catch (e) { res = { ok: false, error: String(e) }; }
    if (isUnmounted) return;
    if (!res || !res.ok) {
      if (window.isMissingFileError && window.isMissingFileError(res && res.error)) window.showSourceMissingBanner(path);
      else toast((res && res.error) || "GPX-Fehler", "error", 5000);
      return;
    }
    if (window.hideSourceMissingBanner) window.hideSourceMissingBanner();
    _points = (res.points || []).map(p => ({ lat: p.lat, lon: p.lon, ele: p.ele, time: p.time }));
    _srcPath = res.src || path;   // v0.9.295 — konvertierter GPX-Pfad (Fremdformate), sonst Original
    _hasTime = !!res.has_time; _hasEle = !!res.has_ele;
    _selA = _selB = null; _dirty = false;
    _drawMode = false; _drawPts = [];
    clearSpikes();
    _eleInvalidate();   // v0.9.292 — neues Track → altes Höhenprofil verwerfen
    if (_undo) _undo.reset();
    renderAll();
    try { renderDraw(); } catch (_) {}
    fitTrack(res.bbox);
    updateUI();
  }

  function clearTrack() {
    _points = []; _srcPath = null; _selA = _selB = null; _dirty = false;
    try { if (map && map.getSource("gpxi-line")) map.getSource("gpxi-line").setData({ type: "Feature", geometry: { type: "LineString", coordinates: [] } }); } catch (_) {}
    try { if (map && map.getSource("gpxi-pts")) map.getSource("gpxi-pts").setData({ type: "FeatureCollection", features: [] }); } catch (_) {}
    _eleInvalidate();
    updateUI();
  }

  function renderAll() {
    if (!map) return;
    // v0.9.292 — DEM-Profil wird ungültig sobald sich die Punktzahl ändert (Indizes verschieben sich).
    if (_demEles && _demEles.length !== _points.length) _eleInvalidate();
    try {
      const line = { type: "Feature", geometry: { type: "LineString", coordinates: _points.map(p => [p.lon, p.lat]) } };
      if (map.getSource("gpxi-line")) map.getSource("gpxi-line").setData(line);
    } catch (_) {}
    renderPoints();
  }

  function renderPoints() {
    if (!map || !map.getSource("gpxi-pts")) return;
    const feats = new Array(_points.length);
    for (let i = 0; i < _points.length; i++) {
      const p = _points[i];
      const sel = (i === _selA) ? "a" : (i === _selB) ? "b" : "";
      feats[i] = {
        type: "Feature",
        properties: { i: i, sel: sel, anchor: (sel !== ""), spike: _spikeSet.has(i) },
        geometry: { type: "Point", coordinates: [p.lon, p.lat] },
      };
    }
    try { map.getSource("gpxi-pts").setData({ type: "FeatureCollection", features: feats }); } catch (_) {}
    renderAnchorMarkers();
  }
  // v0.9.304 — Deutliche A/B-Anker als Pin-Badges (statt nur etwas größerer Kreise).
  function _mkAnchorEl(lab, cls) {
    // WICHTIG: kein CSS-transform am Marker-Element selbst — Mapbox/MapLibre setzt dort
    // sein eigenes translate fürs Positionieren und würde es überschreiben. Runder Badge.
    const el = document.createElement("div");
    el.className = "gpxi-anchor-mk " + cls;
    el.textContent = lab;
    return el;
  }
  function renderAnchorMarkers() {
    if (!map || !_maplib || typeof _maplib.Marker !== "function") return;
    try {
      if (_aMarker) { _aMarker.remove(); _aMarker = null; }
      if (_bMarker) { _bMarker.remove(); _bMarker = null; }
      if (_selA != null && _points[_selA]) {
        _aMarker = new _maplib.Marker({ element: _mkAnchorEl("A", "gpxi-anchor-a") })
          .setLngLat([_points[_selA].lon, _points[_selA].lat]).addTo(map);
      }
      if (_selB != null && _points[_selB]) {
        _bMarker = new _maplib.Marker({ element: _mkAnchorEl("B", "gpxi-anchor-b") })
          .setLngLat([_points[_selB].lon, _points[_selB].lat]).addTo(map);
      }
    } catch (_) {}
  }

  function fitTrack(bbox) {
    if (!map || !_points.length) return;
    try {
      let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
      for (const p of _points) {
        if (p.lon < minLon) minLon = p.lon; if (p.lon > maxLon) maxLon = p.lon;
        if (p.lat < minLat) minLat = p.lat; if (p.lat > maxLat) maxLat = p.lat;
      }
      map.fitBounds([[minLon, minLat], [maxLon, maxLat]], { padding: 60, duration: 600, maxZoom: 17 });
    } catch (_) {}
  }

  // ── Auswahl ─────────────────────────────────────────────────────────────────
  // v0.9.294 — Klick-Toleranz (Marc): nicht nur exakt auf dem Punkt, sondern auch
  // wenn man nah dran ist. Wir suchen den nächsten Punkt im Pixel-Radius statt das
  // Klick-Event an den Punkt-Layer zu binden. Einzelklick = Info-Feld (verzögert),
  // Doppelklick = Anker direkt.
  const _HIT_TOL_PX = 18;
  function _nearestIdxToPoint(px, py, tolPx) {
    if (!map || !_points.length) return -1;
    const tol2 = tolPx * tolPx;
    let best = -1, bestD = tol2;
    for (let i = 0; i < _points.length; i++) {
      let sp; try { sp = map.project([_points[i].lon, _points[i].lat]); } catch (_) { continue; }
      const dx = sp.x - px, dy = sp.y - py, d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }
  function onMapClick(e) {
    if (_drawMode) { onMapClickDraw(e); return; }
    if (_dragMoved) { _dragMoved = false; return; }   // Klick direkt nach Drag schlucken
    // v0.9.305 (Nutzer-Feedback): Anker-Klick wählt IMMER den nächstgelegenen
    // Track-Punkt — egal wie weit der Klick entfernt ist (kein 18px-Limit mehr).
    // Man klickt grob hin, der nächste Punkt wird gesetzt.
    const i = _nearestIdxToPoint(e.point.x, e.point.y, Infinity);
    if (i < 0) return;
    if (_clickTimer) { clearTimeout(_clickTimer); _clickTimer = null; }
    // v0.9.303 — Einzelklick setzt direkt Anker A/B (Daten gibt's live in der Hover-Box).
    _clickTimer = setTimeout(() => { _clickTimer = null; selectAnchor(i); }, 240);
  }
  function onMapDbl(e) {
    if (_drawMode) return;
    const i = _nearestIdxToPoint(e.point.x, e.point.y, _HIT_TOL_PX);
    if (i < 0) return;
    try { e.preventDefault(); } catch (_) {}   // kein Karten-Doppelklick-Zoom, wenn ein Punkt nah ist
    if (_clickTimer) { clearTimeout(_clickTimer); _clickTimer = null; }
    selectAnchor(i);
  }
  // Anker-Logik (A → B → neu), aus onPointClick herausgezogen.
  function selectAnchor(i) {
    if (_selA === null) { _selA = i; }
    else if (_selB === null) {
      if (i === _selA) return;
      _selB = i;
      if (_selB < _selA) { const tmp = _selA; _selA = _selB; _selB = tmp; }
    } else { _selA = i; _selB = null; }
    renderPoints(); updateUI();
    if (_profDraw) drawEleProfile();   // Anker-Marker im Profil mitziehen
  }

  function clearSelection() { _selA = _selB = null; renderPoints(); updateUI(); if (_profDraw) drawEleProfile(); }

  // ── Punkt verschieben (Drag, v0.9.243) ───────────────────────────────────────
  // Nur der ausgewählte grüne Anker A (Einzel-Auswahl) ist ziehbar. Zeit + Höhe
  // bleiben, nur die Position ändert sich → Geschwindigkeit bleibt korrekt.
  function onPointMouseDown(e) {
    if (_drawMode || _selB !== null) return;
    const f = e.features && e.features[0];
    if (!f || f.properties.i !== _selA) return;
    e.preventDefault();                       // Karte nicht mitziehen
    _dragging = true; _dragMoved = false;
    try { map.getCanvas().style.cursor = "grabbing"; } catch (_) {}
  }
  function onDragMove(e) {
    if (!_dragging || _selA === null) return;
    if (!_dragMoved) { _pushUndo(t("gpxinspect.move", "Punkt verschieben")); _dragMoved = true; }
    _points[_selA].lat = e.lngLat.lat;
    _points[_selA].lon = e.lngLat.lng;
    renderAll();                              // Linie + Punkte aktualisieren
  }
  function onDragEnd() {
    if (!_dragging) return;
    _dragging = false;
    try { map.getCanvas().style.cursor = ""; } catch (_) {}
    if (_dragMoved) { _dirty = true; clearSpikes(); renderAll(); updateUI(); }
  }

  // ── Edit-Operationen ─────────────────────────────────────────────────────────
  function healSegment() {
    if (_selA === null || _selB === null || _selB <= _selA + 1) return;
    _pushUndo(t("gpxinspect.heal", "Heilen"));
    const A = _points[_selA], B = _points[_selB];
    const span = _selB - _selA;
    for (let k = _selA + 1; k < _selB; k++) {
      const tt = (k - _selA) / span;
      _points[k].lat = A.lat + (B.lat - A.lat) * tt;
      _points[k].lon = A.lon + (B.lon - A.lon) * tt;
      if (A.ele != null && B.ele != null) _points[k].ele = A.ele + (B.ele - A.ele) * tt;
      // Zeit ABSICHTLICH unverändert → Geschwindigkeit korrigiert sich selbst.
    }
    _dirty = true; clearSpikes(); clearSelection();
    renderAll(); updateUI();
    toast(t("gpxinspect.healed", "Abschnitt geglättet — Zeit behalten, Geschwindigkeit korrigiert."), "success", 2200);
  }

  function _haversine(a, b) {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const la1 = a.lat * rad, la2 = b.lat * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // v0.9.315 — Plausi-Check gegen erfundene Umwege/Schleifen beim Routen/Matchen.
  // Mapbox routet an Kreuzungen schon mal über Ausfahrt+Kreisel zurück — eine saubere
  // GPS-Spur darf dadurch NICHT verbogen werden. ratio = Pfadlänge / Luftlinie A→B.
  // Liegt sie über maxRatio, ist es ein Umweg/Schleife → Caller verwirft die Route.
  function _routePathLen(coords) {
    let L = 0;
    for (let i = 1; i < coords.length; i++) {
      L += _haversine({ lon: coords[i - 1][0], lat: coords[i - 1][1] }, { lon: coords[i][0], lat: coords[i][1] });
    }
    return L;
  }
  function _routeIsDetour(coords, straightDist, maxRatio) {
    if (!Array.isArray(coords) || coords.length < 2) return false;
    const L = _routePathLen(coords);
    const ref = Math.max(straightDist || 0, 30);   // kleine Lücken nicht überempfindlich
    return L > ref * maxRatio;
  }

  function fillGap() {
    if (_selA === null || _selB === null || _selB <= _selA) return;
    _pushUndo(t("gpxinspect.fill", "Lücke füllen"));
    const A = _points[_selA], B = _points[_selB];
    let spacing = parseFloat((document.getElementById("gpxi-spacing") || {}).value) || 20;
    spacing = Math.max(2, Math.min(500, spacing));
    const dist = _haversine(A, B);
    let n = Math.max(1, Math.min(2000, Math.round(dist / spacing) - 1));
    const tA = A.time ? Date.parse(A.time) : null;
    const tB = B.time ? Date.parse(B.time) : null;
    const inserted = [];
    for (let k = 1; k <= n; k++) {
      const tt = k / (n + 1);
      const np = {
        lat: A.lat + (B.lat - A.lat) * tt,
        lon: A.lon + (B.lon - A.lon) * tt,
        ele: (A.ele != null && B.ele != null) ? (A.ele + (B.ele - A.ele) * tt) : (A.ele != null ? A.ele : null),
        time: (tA != null && tB != null) ? new Date(tA + (tB - tA) * tt).toISOString() : null,
      };
      inserted.push(np);
    }
    // Alles strikt zwischen A und B durch die neuen Punkte ersetzen.
    _points.splice(_selA + 1, (_selB - _selA - 1), ...inserted);
    _dirty = true; clearSpikes(); clearSelection();
    renderAll(); updateUI();
    toast(t("gpxinspect.filled", "Lücke gefüllt: ") + inserted.length + " " + t("gpxinspect.points", "Punkte"), "success", 2200);
  }

  // ── Zeit-/Punkt-Info (Nutzer-Wunsch v0.9.263): beim Klick auf einen Punkt
  //    Index, Zeitstempel (lokal) und Höhe zeigen. _ptInfo wird in updateUI in die
  //    Auswahl-Zeile geschrieben.
  function _fmtPtTime(iso) {
    if (!iso) return t("gpxinspect.no_time", "ohne Zeit");
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    try { return d.toLocaleString(); } catch (_) { return iso; }
  }
  function _fmtDur(ms) {
    if (ms == null || !isFinite(ms)) return "";
    let s = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60); s -= m * 60;
    return (h ? h + "h " : "") + (m || h ? m + "m " : "") + s + "s";
  }
  function _ptInfo(idx) {
    const p = _points[idx];
    if (!p) return "";
    let s = "#" + (idx + 1);
    if (p.time) s += " · 🕑 " + _fmtPtTime(p.time);
    if (p.ele != null) s += " · " + Math.round(p.ele) + " m";
    return s;
  }

  // ── Map Matching (Track auf Straße/Weg snappen) ──────────────────────────────
  let _mmBusy = false;
  function _applyMatchedRange(startIdx, endIdx, matched) {
    const A = _points[startIdx], B = _points[endIdx];
    const tA = A.time ? Date.parse(A.time) : null;
    const tB = B.time ? Date.parse(B.time) : null;
    const eA = (A.ele != null) ? A.ele : null, eB = (B.ele != null) ? B.ele : null;
    const pts = matched.map(c => ({ lon: c[0], lat: c[1] }));
    // Kumulative Länge der gematchten Linie → Zeit/Höhe linear über die Strecke verteilen.
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + _haversine(pts[i - 1], pts[i]));
    const total = cum[cum.length - 1] || 1;
    const newPts = pts.map((p, i) => {
      const f = cum[i] / total;
      return {
        lat: p.lat, lon: p.lon,
        ele: (eA != null && eB != null) ? (eA + (eB - eA) * f) : eA,
        time: (tA != null && tB != null) ? new Date(tA + (tB - tA) * f).toISOString() : null,
      };
    });
    _points.splice(startIdx, (endIdx - startIdx + 1), ...newPts);
  }

  // v0.9.268 — Eine Linie [{lon,lat}] auf ~spacingM Punktabstand nachverdichten.
  function _densifyLine(line, spacingM) {
    if (line.length < 2) return line.slice();
    const sp = Math.max(2, spacingM || 20);
    const out = [{ lon: line[0].lon, lat: line[0].lat }];
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i];
      const d = _haversine(a, b);
      const steps = Math.max(1, Math.round(d / sp));
      for (let k = 1; k <= steps; k++) {
        const tt = k / steps;
        out.push({ lon: a.lon + (b.lon - a.lon) * tt, lat: a.lat + (b.lat - a.lat) * tt });
      }
    }
    return out;
  }

  // v0.9.268 — Routen-Ergebnis (Strecke A→B) einsetzen MIT:
  //  (1) Nachverdichtung auf die Punktdichte des Original-Abschnitts → der Animator
  //      (der die Marker-Bewegung pro Punkt-Index verteilt) gibt dem längeren Stück
  //      proportional mehr Frames → Geschwindigkeit stimmt wieder.
  //  (2) Zeit über die DURCHSCHNITTSGESCHWINDIGKEIT des Original-Abschnitts (Marc-Idee):
  //      die längere Route bekommt entsprechend mehr Zeit, statt ins alte A→B-Fenster
  //      gequetscht zu werden (= zu schnell). Alle nachfolgenden Zeitstempel werden um
  //      die Differenz mitverschoben, damit der Track zeitlich konsistent bleibt.
  function _applyRoutedRange(startIdx, endIdx, rawCoords) {
    const A = _points[startIdx], B = _points[endIdx];
    // Original-Abschnitt vermessen (Distanz für die Durchschnittsgeschwindigkeit).
    let dOrig = 0;
    for (let i = startIdx + 1; i <= endIdx; i++) dOrig += _haversine(_points[i - 1], _points[i]);
    // Nachverdicht-Abstand = TYPISCHER (Median-)Punktabstand des ganzen Tracks, NICHT der
    // (oft spiky/spärliche) Original-Abschnitt → die geheilte Strecke kriegt dieselbe Dichte
    // wie der Rest und läuft im Animator nicht zu schnell.
    const _gaps = [];
    for (let i = 1; i < _points.length; i++) { const g = _haversine(_points[i - 1], _points[i]); if (g > 0.01) _gaps.push(g); }
    _gaps.sort((a, b) => a - b);
    const _med = _gaps.length ? _gaps[Math.floor(_gaps.length / 2)] : 20;
    const spacing = Math.max(5, Math.min(50, _med || 20));
    let pts = rawCoords.map(c => ({ lon: c[0], lat: c[1] }));
    pts = _densifyLine(pts, spacing);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + _haversine(pts[i - 1], pts[i]));
    const dNew = cum[cum.length - 1] || 1;
    const tA = A.time ? Date.parse(A.time) : null;
    const tB = B.time ? Date.parse(B.time) : null;
    const eA = (A.ele != null) ? A.ele : null, eB = (B.ele != null) ? B.ele : null;
    let timeAt, delta = 0;
    if (tA != null && tB != null && tB > tA && dOrig > 0) {
      const v = dOrig / (tB - tA);          // m pro ms = Durchschnittsgeschwindigkeit des Abschnitts
      timeAt = (i) => tA + cum[i] / v;       // konstante Geschwindigkeit über die neue Länge
      delta = (tA + dNew / v) - tB;          // ≥ 0: längere Route braucht mehr Zeit
    } else if (tA != null && tB != null) {
      timeAt = (i) => tA + (tB - tA) * (cum[i] / dNew);   // Fallback: linear (kein dOrig)
    } else {
      timeAt = () => null;
    }
    const newPts = pts.map((p, i) => {
      const f = cum[i] / dNew;
      const tt = timeAt(i);
      return {
        lat: p.lat, lon: p.lon,
        ele: (eA != null && eB != null) ? (eA + (eB - eA) * f) : eA,
        time: (tt != null) ? new Date(tt).toISOString() : null,
      };
    });
    // Nachfolgende Punkte zeitlich mitverschieben (vor dem Splice, Original-Indizes).
    if (delta > 0.5) {
      for (let i = endIdx + 1; i < _points.length; i++) {
        if (_points[i].time) _points[i].time = new Date(Date.parse(_points[i].time) + delta).toISOString();
      }
    }
    _points.splice(startIdx, (endIdx - startIdx + 1), ...newPts);
  }
  async function _runMatch(startIdx, endIdx, label) {
    if (_mmBusy || _drawMode) return;
    if (endIdx - startIdx < 1) return;
    let profile = (document.getElementById("gpxi-profile") || {}).value || "walking"; if (profile === "linear") profile = "walking";
    const radius = parseInt((document.getElementById("gpxi-mm-radius") || {}).value, 10) || 25;
    const coords = _points.slice(startIdx, endIdx + 1).map(p => [p.lon, p.lat]);
    _mmBusy = true; updateUI();
    toast(t("gpxinspect.matching", "Matche auf das Wegenetz …"), "info", 2000);
    let res;
    try { res = await api().gpxinspect_map_match(coords, profile, radius); }
    catch (e) { res = { ok: false, error: String(e) }; }
    _mmBusy = false;
    if (!res || !res.ok) {
      const err = res && res.error;
      if (err === "no_token") toast(t("gpxinspect.match_no_token", "Kein Mapbox-Token konfiguriert (siehe Einstellungen)."), "error", 3500);
      else toast(t("gpxinspect.match_failed", "Matching fehlgeschlagen: ") + (err || ""), "error", 3500);
      updateUI(); return;
    }
    const matched = res.coords || [];
    // res.matched===false → die API konnte NICHTS auf einen Weg legen (Spur zu weit weg).
    // Dann NICHT anwenden (sonst stiller No-Op = „passiert nix") — klare Meldung geben.
    if (matched.length < 2 || res.matched === false) {
      toast(t("gpxinspect.match_nomatch", "Kein Weg/keine Straße in der Nähe gefunden — Track liegt zu weit weg."), "warn", 3500);
      updateUI(); return;
    }
    _pushUndo(label);
    _applyMatchedRange(startIdx, endIdx, matched);
    _dirty = true; clearSpikes(); clearSelection();
    renderAll(); updateUI();
    toast(t("gpxinspect.matched", "Auf das Wegenetz gelegt: ") + matched.length + " " + t("gpxinspect.points", "Punkte"), "success", 2500);
  }
  // v0.9.267 — A→B per DIRECTIONS-Route (Straße folgen) statt Map Matching: kein
  // 50-m-Radius-Limit, A/B werden auf die nächste Straße gesnappt + dazwischen geroutet.
  // Robust gegen jede GPS-Drift. Ersetzt die mittleren Punkte durch die echte Wege-Route,
  // Zeit/Höhe linear über die neue Länge verteilt (wie Map Matching).
  async function routeSelection() {
    if (_selA === null || _selB === null || _selB <= _selA) return;
    if (_mmBusy || _drawMode) return;
    let profile = (document.getElementById("gpxi-profile") || {}).value || "walking"; if (profile === "linear") profile = "walking";
    const A = _points[_selA], B = _points[_selB];
    _mmBusy = true; updateUI();
    toast(t("gpxinspect.routing", "Suche Route zwischen A und B …"), "info", 2000);
    let res;
    try { res = await api().gpxinspect_route_ab([A.lon, A.lat], [B.lon, B.lat], profile); }
    catch (e) { res = { ok: false, error: String(e) }; }
    _mmBusy = false;
    if (!res || !res.ok) {
      const err = res && res.error;
      if (err === "no_token") toast(t("gpxinspect.match_no_token", "Kein Mapbox-Token konfiguriert (siehe Einstellungen)."), "error", 3500);
      else toast(t("gpxinspect.route_failed", "Route konnte nicht berechnet werden: ") + (err || ""), "error", 3500);
      updateUI(); return;
    }
    const coords = res.coords || [];
    if (coords.length < 2 || res.matched === false) {
      toast(t("gpxinspect.route_nomatch", "Keine Route gefunden — A oder B liegt zu weit von einer Straße entfernt."), "warn", 3500);
      updateUI(); return;
    }
    // v0.9.315 — Schleifen-Schutz: Straßen sind legitim länger als die Luftlinie, aber
    // ein grober Umweg/eine Schleife (z. B. Mapbox routet über Ausfahrt+Kreisel zurück)
    // wird NICHT angewendet. Nutzer kann dann „Luftlinie" oder „Pfad zeichnen" nehmen.
    if (_routeIsDetour(coords, _haversine(A, B), 4.0)) {
      toast(t("gpxinspect.route_detour", "Die gefundene Route macht einen großen Umweg/eine Schleife — nicht angewendet. Nimm „Lücke füllen (Luftlinie)“ oder „Pfad zeichnen & füllen“."), "warn", 5000);
      updateUI(); return;
    }
    _pushUndo(t("gpxinspect.match_sel", "Strecke A→B"));
    _applyRoutedRange(_selA, _selB, coords);
    _dirty = true; clearSpikes(); clearSelection();
    renderAll(); updateUI();
    toast(t("gpxinspect.routed", "Strecke A→B auf die Straße gelegt: ") + coords.length + " " + t("gpxinspect.points", "Punkte"), "success", 2500);
  }
  // v0.9.315 — „Ganzen Track snappen" entschärft: überschreibt ALLE Punkte mit Mapbox-
  // Straßengeometrie (kann an Kreuzungen Umwege/Schleifen erzeugen). Bewusste 2-Klick-
  // Bestätigung statt stiller Ausführung. Für nur Lücken/Ausreißer → „Heilen" nutzen.
  let _matchWholeArm = 0;
  function matchWhole() {
    if (_points.length < 2) return;
    const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : 0;
    if (now - _matchWholeArm > 4000) {
      _matchWholeArm = now;
      toast(t("gpxinspect.match_all_warn", "Achtung: legt den GANZEN Track auf Mapbox-Straßen und überschreibt deine aufgezeichneten Punkte — an Kreuzungen können Umwege/Schleifen entstehen. Für nur Lücken/Ausreißer lieber „Heilen“. Zum Bestätigen nochmal klicken."), "warn", 4000);
      return;
    }
    _matchWholeArm = 0;
    _runMatch(0, _points.length - 1, t("gpxinspect.match_all", "Ganzen Track matchen"));
  }

  // ── Pfad zeichnen & füllen (v0.9.237) ────────────────────────────────────────
  function _setCursor(c) { try { if (map) map.getCanvas().style.cursor = c || ""; } catch (_) {} }
  function startDraw() {
    if (_selA === null || _selB === null || _selB <= _selA) return;
    _drawMode = true; _drawPts = [];
    _setCursor("crosshair");                 // Fadenkreuz fürs Punkte-Setzen
    renderDraw(); updateUI();
    toast(t("gpxinspect.draw_started", "Klick auf die Karte, um den Pfad zu zeichnen."), "info", 2500);
  }
  function onMapClickDraw(e) {
    if (!_drawMode) return;
    _drawPts.push({ lat: e.lngLat.lat, lon: e.lngLat.lng });
    _setCursor("crosshair");                 // nach Klick wieder absichern
    renderDraw(); updateUI();
  }
  function undoDrawPoint() { if (_drawPts.length) { _drawPts.pop(); renderDraw(); updateUI(); } }
  function cancelDraw() { _drawMode = false; _drawPts = []; _setCursor(""); renderDraw(); updateUI(); }
  function renderDraw() {
    if (!map) return;
    const A = (_selA != null) ? _points[_selA] : null;
    const B = (_selB != null) ? _points[_selB] : null;
    const path = (_drawMode && A && B) ? [A, ..._drawPts, B] : [];
    try { if (map.getSource("gpxi-draw")) map.getSource("gpxi-draw").setData({ type: "Feature", geometry: { type: "LineString", coordinates: path.map(p => [p.lon, p.lat]) } }); } catch (_) {}
    try {
      const feats = _drawMode ? _drawPts.map((p, i) => ({ type: "Feature", properties: { i }, geometry: { type: "Point", coordinates: [p.lon, p.lat] } })) : [];
      if (map.getSource("gpxi-draw-pts")) map.getSource("gpxi-draw-pts").setData({ type: "FeatureCollection", features: feats });
    } catch (_) {}
  }
  function applyDrawnPath() {
    if (!_drawMode || _selA === null || _selB === null || _selB <= _selA) return;
    const A = _points[_selA], B = _points[_selB];
    const path = [A, ..._drawPts, B];
    // Kumulative Distanzen entlang des gezeichneten Pfads.
    const cum = [0];
    for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + _haversine(path[i - 1], path[i]));
    const total = cum[cum.length - 1];
    if (total <= 0) { cancelDraw(); return; }
    let spacing = parseFloat((document.getElementById("gpxi-spacing") || {}).value) || 20;
    spacing = Math.max(2, Math.min(500, spacing));
    const n = Math.max(1, Math.min(5000, Math.round(total / spacing) - 1));
    _pushUndo(t("gpxinspect.drawfill", "Pfad füllen"));
    const tA = A.time ? Date.parse(A.time) : null, tB = B.time ? Date.parse(B.time) : null;
    const inserted = [];
    let seg = 0;
    for (let k = 1; k <= n; k++) {
      const d = total * k / (n + 1);
      while (seg < cum.length - 2 && cum[seg + 1] < d) seg++;
      const segLen = cum[seg + 1] - cum[seg];
      const tt = segLen <= 0 ? 0 : (d - cum[seg]) / segLen;
      const a = path[seg], b = path[seg + 1];
      const frac = d / total;   // Höhe + Zeit linear A→B über die Pfad-Distanz
      inserted.push({
        lat: a.lat + (b.lat - a.lat) * tt,
        lon: a.lon + (b.lon - a.lon) * tt,
        ele: (A.ele != null && B.ele != null) ? (A.ele + (B.ele - A.ele) * frac) : (A.ele != null ? A.ele : null),
        time: (tA != null && tB != null) ? new Date(tA + (tB - tA) * frac).toISOString() : null,
      });
    }
    _points.splice(_selA + 1, (_selB - _selA - 1), ...inserted);
    _dirty = true;
    _drawMode = false; _drawPts = [];
    clearSpikes();
    clearSelection();           // ruft renderPoints + updateUI
    renderDraw();               // Zeichen-Layer leeren
    renderAll();
    toast(t("gpxinspect.drawfilled", "Pfad aufgefüllt: ") + inserted.length + " " + t("gpxinspect.points", "Punkte"), "success", 2400);
  }

  // Einzelnen ausgewählten Punkt (Anker A, ohne B) löschen. (v0.9.241)
  function deletePoint() {
    if (_selA === null || _selB !== null) return;
    if (_points.length <= 2) { toast(t("gpxinspect.too_few", "Zu wenige Punkte zum Löschen."), "warning", 2200); return; }
    _pushUndo(t("gpxinspect.delete_one", "Punkt löschen"));
    _points.splice(_selA, 1);
    _dirty = true; clearSpikes(); clearSelection();
    renderAll(); updateUI();
    toast(t("gpxinspect.deleted", "Punkte gelöscht: ") + 1, "success", 1600);
  }

  function deleteBetween() {
    if (_selA === null || _selB === null || _selB <= _selA + 1) return;
    _pushUndo(t("gpxinspect.delete", "Punkte löschen"));
    const cnt = _selB - _selA - 1;
    _points.splice(_selA + 1, cnt);
    _dirty = true; clearSpikes(); clearSelection();
    renderAll(); updateUI();
    toast(t("gpxinspect.deleted", "Punkte gelöscht: ") + cnt, "success", 1800);
  }

  // ── Auto-Despike (v0.9.239) ──────────────────────────────────────────────────
  // Findet GPS-Ausreißer: Punkte, die weit wegspringen UND wieder zurückkommen
  // (Umweg über die Sehne A→C). Geometrisch robust (kein Zeitstempel nötig);
  // wenn Zeit da ist, zusätzlich Geschwindigkeits-Gate gegen Falsch-Positive bei
  // echten scharfen Kurven. Echte Lücken (langer gerader Sprung ohne Rückkehr)
  // werden NICHT markiert — der Umweg ist dort ~0.
  function detectSpikes() {
    const P = _points, n = P.length;
    if (n < 3) return [];
    const seg = new Array(n - 1);
    for (let i = 0; i < n - 1; i++) seg[i] = _haversine(P[i], P[i + 1]);
    const sorted = [...seg].sort((a, b) => a - b);
    const medSeg = sorted[Math.floor(sorted.length / 2)] || 0;
    const haveTime = _hasTime && P.every(p => p.time);
    // Empfindlichkeit 1..10 (Slider) → Schwellen. 1 = nur krasse Sprünge,
    // 10 = auch kleine Zacken. lerp über den Slider-Bereich.
    const sens = Math.max(1, Math.min(10, parseFloat((document.getElementById("gpxi-sens") || {}).value) || 5));
    const lerp = (a, b) => a + (b - a) * (sens - 1) / 9;
    const SPIKE_FACTOR = lerp(12, 2);              // Vielfaches des mittleren Punktabstands
    const FLOOR = lerp(120, 15);                    // Mindest-Sprungweite in m
    const ABS_JUMP = Math.max(FLOOR, medSeg * SPIKE_FACTOR);
    const SPEED_CAP = lerp(120, 25);               // m/s; 120≈432 km/h … 25≈90 km/h
    const flags = new Array(n).fill(false);
    for (let i = 1; i < n - 1; i++) {
      const inD = seg[i - 1], outD = seg[i];
      const chord = _haversine(P[i - 1], P[i + 1]);
      const detour = inD + outD - chord;           // wie weit der Punkt aus der Sehne ragt
      const bigJump = (inD > ABS_JUMP || outD > ABS_JUMP);
      const returns = detour > ABS_JUMP * 0.8;     // springt raus UND zurück
      let speedBad = true;
      if (haveTime) {
        const dtIn = (Date.parse(P[i].time) - Date.parse(P[i - 1].time)) / 1000;
        const dtOut = (Date.parse(P[i + 1].time) - Date.parse(P[i].time)) / 1000;
        const vIn = dtIn > 0 ? inD / dtIn : Infinity;
        const vOut = dtOut > 0 ? outD / dtOut : Infinity;
        speedBad = (vIn > SPEED_CAP || vOut > SPEED_CAP);
      }
      if (bigJump && returns && speedBad) flags[i] = true;
    }
    // Aufeinanderfolgende markierte Punkte zu einer Ausreißer-Gruppe zusammenfassen.
    const groups = [];
    let i = 0;
    while (i < n) {
      if (flags[i]) {
        let j = i; while (j + 1 < n && flags[j + 1]) j++;
        const a = i - 1, b = j + 1;
        if (a >= 0 && b < n) groups.push({ a, b, from: i, to: j });
        i = j + 1;
      } else i++;
    }
    return groups;
  }

  function clearSpikes() {
    _spikes = []; _spikeSet = new Set(); _spikeIdx = -1; _despikeRan = false;
    _gaps = []; try { renderGaps(); } catch (_) {}
  }

  // v0.9.294 — Lücken erkennen: ungewöhnlich lange Segmente (GPS-Dropouts), die KEINE
  // Ausreißer sind. Baseline = unteres Perzentil der Abstände (robust, auch wenn der
  // Track viele Lücken hat). Schwelle skaliert mit dem Empfindlichkeits-Slider.
  function detectGaps() {
    const P = _points, n = P.length;
    if (n < 2) return [];
    // v0.9.299 — Lücke = Segment, das DEUTLICH länger ist als der typische Punktabstand
    // des Tracks (= sichtbares Loch, egal wie groß). Robust über den Median, und die
    // Schwelle ist an den FÜLL-Abstand gekoppelt: ein Loch muss deutlich größer sein als
    // die Punkte, mit denen wir füllen — sonst hätte Füllen keinen Effekt und das geheilte
    // Stück würde sofort wieder als Loch zählen. So bleibt nach „Heilen" nichts übrig.
    const seg = new Array(n - 1);
    for (let i = 0; i < n - 1; i++) seg[i] = _haversine(P[i], P[i + 1]);
    const sd = [...seg].sort((a, b) => a - b);
    const median = sd[Math.floor(sd.length / 2)] || sd[0] || 0;   // typischer Abstand (Abtast-Kadenz)
    const spacing = _gapSpacing();
    const sens = Math.max(1, Math.min(10, parseFloat((document.getElementById("gpxi-sens") || {}).value) || 5));
    const lerp = (a, b) => a + (b - a) * (sens - 1) / 9;
    // Empfindlich: niedrig = nur große Löcher, hoch = auch kleine Abweichungen vom Takt.
    const distTH = Math.max(spacing * lerp(2.5, 1.6), median * lerp(3.5, 1.8));
    const gaps = [];
    for (let i = 0; i < n - 1; i++) {
      if (seg[i] > distTH && !_spikeSet.has(i) && !_spikeSet.has(i + 1)) {
        gaps.push({ a: i, b: i + 1, dist: seg[i] });
      }
    }
    return gaps;
  }
  // Wie viele Punkte würden in eine Lücke eingefügt (für Vorschau-Zähler + Anwenden).
  function _gapFillCount(dist, spacing) {
    return Math.max(1, Math.min(2000, Math.round(dist / spacing) - 1));
  }
  function _gapSpacing() {
    let s = parseFloat((document.getElementById("gpxi-spacing") || {}).value) || 20;
    return Math.max(2, Math.min(500, s));
  }
  // Vorschau der Lücken-Füllung auf die Karte (gestrichelte Linie + Geister-Punkte).
  function renderGaps() {
    if (!map || !map.getSource("gpxi-gapfill")) return;
    const lines = [], ghosts = [];
    const spacing = _gapSpacing();
    let ghostBudget = 600;   // Geister-Punkte gesamt begrenzen (Performance)
    for (const g of _gaps) {
      const A = _points[g.a], B = _points[g.b];
      if (!A || !B) continue;
      lines.push([[A.lon, A.lat], [B.lon, B.lat]]);
      if (ghostBudget > 0) {
        const n = Math.min(_gapFillCount(g.dist, spacing), ghostBudget, 120);
        for (let k = 1; k <= n; k++) {
          const tt = k / (n + 1);
          ghosts.push({ type: "Feature", geometry: { type: "Point", coordinates: [A.lon + (B.lon - A.lon) * tt, A.lat + (B.lat - A.lat) * tt] } });
        }
        ghostBudget -= n;
      }
    }
    try {
      map.getSource("gpxi-gapfill").setData(lines.length
        ? { type: "Feature", geometry: { type: "MultiLineString", coordinates: lines } }
        : { type: "Feature", geometry: { type: "LineString", coordinates: [] } });
      map.getSource("gpxi-gapfill-pts").setData({ type: "FeatureCollection", features: ghosts });
    } catch (_) {}
  }

  // v0.9.302 — EIN „Heilen" (Automatik), gesteuert über Bereich (ganzer Track / Abschnitt
  // A→B) + Checkboxen: Ausreißer glätten · Lücken füllen (optional an Wege anpassen) ·
  // ganzen Track snappen (nur Bereich = Track).
  function _healScope() {
    return ((document.getElementById("gpxi-scope-ab") || {}).checked) ? "ab" : "track";
  }
  async function runHeal() {
    if (_drawMode || !_points.length || _mmBusy) return;
    const scope = _healScope();
    const doSpikes = !!((document.getElementById("gpxi-heal-spikes") || {}).checked);
    const doGaps = !!((document.getElementById("gpxi-heal-gaps") || {}).checked);
    if (!doSpikes && !doGaps) {
      toast(t("gpxinspect.heal_nothing_sel", "Nichts ausgewählt — hak an, was geheilt werden soll."), "info", 2800);
      return;
    }
    let lo = 0, hi = _points.length - 1;
    if (scope === "ab") {
      if (_selA === null || _selB === null || _selB <= _selA) {
        toast(t("gpxinspect.heal_need_ab", "Bereich „Abschnitt A→B“: erst zwei Punkte auf der Karte setzen (A grün, B rot)."), "warn", 3600);
        return;
      }
      lo = _selA; hi = _selB;
    }
    // 1) Ausreißer glätten + Lücken füllen (je nach Checkbox, evtl. nur im Bereich).
    if (doSpikes || doGaps) {
      let groups = doSpikes ? detectSpikes() : [];
      if (scope === "ab") groups = groups.filter((g) => g.from >= lo && g.to <= hi);
      _spikes = groups; _spikeIdx = -1;
      _spikeSet = new Set();
      for (const g of groups) for (let k = g.from; k <= g.to; k++) _spikeSet.add(k);
      let gaps = doGaps ? detectGaps() : [];
      if (scope === "ab") gaps = gaps.filter((g) => g.a >= lo && g.b <= hi);
      _gaps = gaps;
      _selA = _selB = null;
      if (_spikes.length || _gaps.length) {
        await healAllSpikes();   // füllt Lücken laut Profil (Luftlinie oder Route)
      } else {
        toast(t("gpxinspect.heal_none", "Nichts zu heilen gefunden 👍"), "info", 2800);
      }
    }
    // Übersicht: ganzen Track zeigen.
    try { map.fitBounds(_trackBounds(), { padding: 50, duration: 600 }); } catch (_) {}
  }
  function _zoomToGap(k) {
    const g = _gaps[k]; if (!g || !map) return;
    const A = _points[g.a], B = _points[g.b];
    try {
      map.fitBounds([[Math.min(A.lon, B.lon), Math.min(A.lat, B.lat)], [Math.max(A.lon, B.lon), Math.max(A.lat, B.lat)]],
        { padding: 120, duration: 500, maxZoom: 17 });
    } catch (_) {}
  }

  function gotoSpike(k) {
    if (!_spikes.length) return;
    _spikeIdx = Math.max(0, Math.min(_spikes.length - 1, k));
    const g = _spikes[_spikeIdx];
    _selA = g.a; _selB = g.b;
    renderPoints();
    // Auf die Ausreißer-Region zoomen (Anker + dazwischen).
    try {
      let mnLon = Infinity, mnLat = Infinity, mxLon = -Infinity, mxLat = -Infinity;
      for (let k2 = g.a; k2 <= g.b; k2++) {
        const p = _points[k2];
        if (p.lon < mnLon) mnLon = p.lon; if (p.lon > mxLon) mxLon = p.lon;
        if (p.lat < mnLat) mnLat = p.lat; if (p.lat > mxLat) mxLat = p.lat;
      }
      map.fitBounds([[mnLon, mnLat], [mxLon, mxLat]], { padding: 120, duration: 500, maxZoom: 18 });
    } catch (_) {}
    updateUI();
  }

  async function healAllSpikes() {
    if (!_spikes.length && !_gaps.length) return;
    _pushUndo(t("gpxinspect.heal_all", "Auto-Heilen"));
    // 1) Ausreißer geraderücken — verschiebt nur (kein Splice) → Indizes bleiben gültig.
    for (const g of _spikes) {
      const A = _points[g.a], B = _points[g.b], span = g.b - g.a;
      for (let k = g.a + 1; k < g.b; k++) {
        const tt = (k - g.a) / span;
        _points[k].lat = A.lat + (B.lat - A.lat) * tt;
        _points[k].lon = A.lon + (B.lon - A.lon) * tt;
        if (A.ele != null && B.ele != null) _points[k].ele = A.ele + (B.ele - A.ele) * tt;
        // Zeit bleibt → Geschwindigkeit korrigiert sich selbst.
      }
    }
    const nS = _spikes.length;
    const nG = _gaps.length;
    const spacing = _gapSpacing();
    // Füll-Art direkt aus dem Profil: 'linear' (Luftlinie) ODER walking/cycling/driving (Route).
    const fillMode = (document.getElementById("gpxi-profile") || {}).value || "linear";

    // 2) Lücken füllen — von HINTEN nach VORNE, damit Indizes gültig bleiben.
    if (fillMode !== "linear" && nG) {
      // Route-Modus: jede Lücke entlang echter Wege/Straßen (Profil) routen.
      const gapsAB = _gaps.map((g) => [_points[g.a].lon, _points[g.a].lat, _points[g.b].lon, _points[g.b].lat]);
      _mmBusy = true; updateUI();
      toast(t("gpxinspect.gap_routing", "Suche Routen für %g Lücken …").replace("%g", nG), "info", 4000);
      let res;
      try { res = await api().gpxinspect_route_gaps(gapsAB, fillMode); }
      catch (e) { res = { ok: false, error: String(e) }; }
      _mmBusy = false;
      if (res && res.error === "no_token") {
        toast(t("gpxinspect.match_no_token", "Kein Mapbox-Token konfiguriert (siehe Einstellungen) — fülle linear."), "warn", 3500);
      }
      const routes = (res && res.ok && Array.isArray(res.routes)) ? res.routes : [];
      let routed = 0, fillPts = 0, detour = 0;
      const order = _gaps.map((g, i) => ({ g, i })).sort((x, y) => y.g.a - x.g.a);
      for (const { g, i } of order) {
        const r = routes[i];
        // v0.9.315 — nur anwenden, wenn die Route KEIN Umweg/Schleife ist (sonst gerade
        // füllen). Schützt saubere Spuren davor, an Kreuzungen verbogen zu werden.
        if (r && r.ok && Array.isArray(r.coords) && r.coords.length >= 2 && !_routeIsDetour(r.coords, g.dist, 2.5)) {
          _applyRoutedRange(g.a, g.b, r.coords);   // ersetzt [a..b] durch die Wege-Route
          routed++;
        } else {
          if (r && r.ok && Array.isArray(r.coords) && r.coords.length >= 2) detour++;  // war Route, aber Umweg
          fillPts += _linearFillGap(g, spacing);   // Fallback: gerade Linie (Flugbögen ODER verworfener Umweg)
        }
      }
      _dirty = true; clearSpikes(); _selA = _selB = null;
      renderAll(); updateUI();
      const msg = t("gpxinspect.heal_done_route", "Geheilt: %s Ausreißer · %r Lücken an Route angepasst, %l gerade gefüllt")
        .replace("%s", nS).replace("%r", routed).replace("%l", nG - routed)
        + (detour ? " (" + detour + " " + t("gpxinspect.heal_detour", "Umwege verworfen") + ")" : "");
      toast(msg, "success", 4000);
      return;
    }

    // Linear-Modus (Standard).
    let fillPts = 0;
    const gapsDesc = [..._gaps].sort((a, b) => b.a - a.a);
    for (const g of gapsDesc) fillPts += _linearFillGap(g, spacing);
    _dirty = true; clearSpikes(); _selA = _selB = null;
    renderAll(); updateUI();
    toast(t("gpxinspect.heal_done", "Geheilt: %s Ausreißer, %g Lücken (+%p Punkte)")
      .replace("%s", nS).replace("%g", nG).replace("%p", fillPts), "success", 3200);
  }
  // Eine Lücke mit gerade interpolierten Punkten füllen (Position/Höhe/Zeit linear). Gibt
  // die Anzahl eingefügter Punkte zurück. b = a+1 → reines Einfügen bei a+1.
  function _linearFillGap(g, spacing) {
    const A = _points[g.a], B = _points[g.b];
    if (!A || !B) return 0;
    const dist = _haversine(A, B);
    const n = _gapFillCount(dist, spacing);
    const tA = A.time ? Date.parse(A.time) : null;
    const tB = B.time ? Date.parse(B.time) : null;
    const inserted = [];
    for (let k = 1; k <= n; k++) {
      const tt = k / (n + 1);
      inserted.push({
        lat: A.lat + (B.lat - A.lat) * tt,
        lon: A.lon + (B.lon - A.lon) * tt,
        ele: (A.ele != null && B.ele != null) ? (A.ele + (B.ele - A.ele) * tt) : (A.ele != null ? A.ele : null),
        time: (tA != null && tB != null) ? new Date(tA + (tB - tA) * tt).toISOString() : null,
      });
    }
    _points.splice(g.a + 1, 0, ...inserted);
    return inserted.length;
  }

  // ── Höhe korrigieren: Höhenprofil GPS vs. Karte zeigen + live mischen ────────
  // v0.9.292 (Nutzer-Feedback zu v0.9.291: „man sieht nicht was passiert") —
  // Einmal die Gelände-Höhe pro Punkt samplen (queryTerrainElevation) und unter
  // der Karte GPS- + Karten-Linie übereinander zeichnen; der Regler mischt live
  // eine fette Ergebnis-Linie. „Übernehmen" schreibt sie in _points[].ele.
  function _eleGain(eles) {
    // Geglättet (Fenster 5) + 3-m-Schwelle, analog core/gpx.py.
    const v = eles.filter(e => e != null && isFinite(e));
    if (v.length < 2) return 0;
    const sm = v.map((_, i) => {
      let s = 0, n = 0;
      for (let k = Math.max(0, i - 2); k <= Math.min(v.length - 1, i + 2); k++) { s += v[k]; n++; }
      return s / n;
    });
    let g = 0, ref = sm[0];
    for (let i = 1; i < sm.length; i++) {
      const d = sm[i] - ref;
      if (d > 3) { g += d; ref = sm[i]; }
      else if (d < -3) { ref = sm[i]; }
    }
    return g;
  }
  function _trackBounds() {
    let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
    for (const p of _points) {
      if (p.lon < mnx) mnx = p.lon; if (p.lat < mny) mny = p.lat;
      if (p.lon > mxx) mxx = p.lon; if (p.lat > mxy) mxy = p.lat;
    }
    return [[mnx, mny], [mxx, mxy]];
  }
  let _eleBusy = false;
  function _eleWeight() {
    const wEl = document.getElementById("gpxi-ele-weight");
    return Math.max(0, Math.min(1, (parseFloat(wEl && wEl.value) || 0) / 100));
  }
  function _blendEles(w) {
    return _points.map((p, i) => {
      const gps = (p.ele == null || !isFinite(p.ele)) ? null : p.ele;
      const dem = _demEles ? _demEles[i] : null;
      if (dem == null || !isFinite(dem)) return gps;   // kein DEM → GPS behalten
      if (gps == null) return dem;
      return (1 - w) * gps + w * dem;
    });
  }
  function _cumDist() {
    const out = new Array(_points.length); out[0] = 0;
    for (let i = 1; i < _points.length; i++) out[i] = out[i - 1] + _haversine(_points[i - 1], _points[i]);
    return out;
  }
  // Profil ungültig machen (z. B. wenn Punkte sich ändern → Indizes passen nicht mehr).
  function _eleInvalidate() {
    _demEles = null; _profDraw = null;
    _closeProfileBox(); _closeMapPopup();
    try { setHover(null); } catch (_) {}
    const prof = document.getElementById("gpxi-ele-profile");
    if (prof && !prof.hidden) { prof.hidden = true; try { if (map) map.resize(); } catch (_) {} }
    setDisabled("gpxi-ele-weight", true);
    setDisabled("gpxi-ele-apply", true);
  }
  function _profileVisible() {
    const prof = document.getElementById("gpxi-ele-profile");
    return !!(prof && !prof.hidden);
  }
  function _clampWindow() {
    const n = _points.length;
    if (n < 2) { _profI0 = 0; _profI1 = Math.max(0, n - 1); return; }
    _profI0 = Math.max(0, Math.min(_profI0, n - 2));
    _profI1 = Math.min(n - 1, Math.max(_profI1, _profI0 + 1));
  }
  // Höhenprofil zeichnen — nur das sichtbare Index-Fenster [_profI0.._profI1] (Zoom-Sync mit Karte).
  function drawEleProfile() {
    const svg = document.getElementById("gpxi-eleprof-svg");
    if (!svg || !_demEles || _demEles.length !== _points.length || _points.length < 2) { _profDraw = null; return; }
    _closeProfileBox();   // schwebende Info-Box ist nach Neuzeichnen nicht mehr passend platziert
    { const hc = document.getElementById("gpxi-eleprof-cursor"); if (hc) hc.hidden = true; }
    _clampWindow();
    const i0 = _profI0, i1 = _profI1;
    const W = 1000, H = 150, padT = 10, padB = 16;
    const cum = _cumDist();
    const x0 = cum[i0], x1 = cum[i1] || (x0 + 1), span = (x1 - x0) || 1;
    const gpsArr = _points.map(p => (p.ele == null || !isFinite(p.ele)) ? null : p.ele);
    const demArr = _demEles;
    const w = _eleWeight();
    const resArr = _blendEles(w);
    // y-Skala nur über das sichtbare Fenster
    let lo = Infinity, hi = -Infinity;
    for (let i = i0; i <= i1; i++) for (const v of [gpsArr[i], demArr[i], resArr[i]]) { if (v == null || !isFinite(v)) continue; if (v < lo) lo = v; if (v > hi) hi = v; }
    if (!isFinite(lo) || !isFinite(hi)) { _profDraw = null; return; }
    if (hi - lo < 1) hi = lo + 1;
    const X = d => ((d - x0) / span) * W;
    const Y = v => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
    const path = arr => {
      let d = "", pen = false;
      for (let i = i0; i <= i1; i++) {
        const v = arr[i];
        if (v == null || !isFinite(v)) { pen = false; continue; }
        d += (pen ? "L" : "M") + X(cum[i]).toFixed(1) + " " + Y(v).toFixed(1) + " ";
        pen = true;
      }
      return d.trim();
    };
    const mid = (lo + hi) / 2;
    let inner = [hi, mid, lo].map(v =>
      `<line x1="0" y1="${Y(v).toFixed(1)}" x2="${W}" y2="${Y(v).toFixed(1)}" class="gpxi-ep-grid"/>`
    ).join("");
    inner += `<path d="${path(gpsArr)}" class="gpxi-ep-line gpxi-ep-gps"/>`
          +  `<path d="${path(demArr)}" class="gpxi-ep-line gpxi-ep-dem"/>`
          +  `<path d="${path(resArr)}" class="gpxi-ep-line gpxi-ep-res"/>`;
    // Anker-Marker A/B als vertikale Linien (wenn im Fenster)
    const vline = (idx, cls) => (idx != null && idx >= i0 && idx <= i1)
      ? `<line x1="${X(cum[idx]).toFixed(1)}" y1="0" x2="${X(cum[idx]).toFixed(1)}" y2="${H}" class="${cls}"/>` : "";
    inner += vline(_selA, "gpxi-ep-anchor gpxi-ep-anchor-a") + vline(_selB, "gpxi-ep-anchor gpxi-ep-anchor-b");
    // Einzelne klickbare Punkte — nur wenn wenige sichtbar (sonst zu viel DOM)
    const visN = i1 - i0 + 1;
    if (visN <= 200) {
      let dots = "";
      for (let i = i0; i <= i1; i++) {
        const v = resArr[i]; if (v == null || !isFinite(v)) continue;
        const sel = (i === _selA || i === _selB) ? " gpxi-ep-dot-sel" : "";
        dots += `<circle cx="${X(cum[i]).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="${visN <= 60 ? 3.2 : 2.2}" class="gpxi-ep-dot${sel}"/>`;
      }
      inner += dots;
    }
    svg.innerHTML = inner;
    _profDraw = { i0, i1, x0, span, W, cum };
    const info = document.getElementById("gpxi-eleprof-info");
    if (info) info.textContent =
      t("gpxinspect.ele_gain_gps", "Höhenmeter — GPS ") + Math.round(_eleGain(gpsArr)) + " · " +
      t("gpxinspect.ele_gain_map", "Karte ") + Math.round(_eleGain(demArr)) + " · " +
      t("gpxinspect.ele_gain_res", "Ergebnis ") + Math.round(_eleGain(resArr)) + " m" +
      (visN < _points.length ? "   (" + t("gpxinspect.ele_zoom_hint", "Ausschnitt") + " " + (i0 + 1) + "–" + (i1 + 1) + "/" + _points.length + ")" : "");
    const resEl = document.getElementById("gpxi-ele-result");
    if (resEl) resEl.textContent = t("gpxinspect.ele_preview", "Vorschau: %new Höhenmeter (%pct % Karte). Übernehmen, um es zu speichern.")
      .replace("%new", Math.round(_eleGain(resArr))).replace("%pct", Math.round(w * 100));
  }

  // ── Zoom-Sync Karte ↔ Höhenprofil (v0.9.293) ─────────────────────────────────
  function _windowFromBounds() {
    if (!map || _points.length < 2) return false;
    let b; try { b = map.getBounds(); } catch (_) { return false; }
    if (!b) return false;
    const W = b.getWest(), E = b.getEast(), S = b.getSouth(), N = b.getNorth();
    let lo = -1, hi = -1;
    for (let i = 0; i < _points.length; i++) {
      const p = _points[i];
      if (p.lon >= W && p.lon <= E && p.lat >= S && p.lat <= N) { if (lo < 0) lo = i; hi = i; }
    }
    if (lo < 0 || hi <= lo) return false;
    _profI0 = Math.max(0, lo - 1);
    _profI1 = Math.min(_points.length - 1, hi + 1);
    return true;
  }
  function onMapMoveSyncProfile() {
    if (_syncing || !_profileVisible()) return;
    if (!_windowFromBounds()) { _profI0 = 0; _profI1 = _points.length - 1; }
    drawEleProfile();
  }
  function _fitMapToWindow() {
    if (!map) return;
    _clampWindow();
    let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
    for (let i = _profI0; i <= _profI1; i++) {
      const p = _points[i];
      if (p.lon < mnx) mnx = p.lon; if (p.lat < mny) mny = p.lat;
      if (p.lon > mxx) mxx = p.lon; if (p.lat > mxy) mxy = p.lat;
    }
    if (!isFinite(mnx)) return;
    _syncing = true;
    try { map.once("moveend", () => { _syncing = false; }); } catch (_) { _syncing = false; }
    try { map.fitBounds([[mnx, mny], [mxx, mxy]], { padding: 50, animate: false, maxZoom: 18 }); }
    catch (_) { _syncing = false; }
  }
  function _zoomProfileWindow(factor, centerFrac) {
    const n = _points.length; if (n < 2) return;
    const cur = _profI1 - _profI0;
    let next = Math.round(cur * factor);
    next = Math.max(2, Math.min(n - 1, next));
    const center = _profI0 + centerFrac * cur;
    let i0 = Math.round(center - next * centerFrac);
    i0 = Math.max(0, Math.min(i0, n - 1 - next));
    _profI0 = i0; _profI1 = i0 + next;
    drawEleProfile(); _fitMapToWindow();
  }
  function _panProfileWindow(fracDelta) {
    const n = _points.length; if (n < 2) return;
    const cur = _profI1 - _profI0;
    const shift = Math.round(fracDelta * cur);
    if (!shift) return;
    let i0 = Math.max(0, Math.min(_profI0 + shift, n - 1 - cur));
    _profI0 = i0; _profI1 = i0 + cur;
    drawEleProfile(); _fitMapToWindow();
  }
  function _profileIdxAtClientX(clientX) {
    if (!_profDraw) return -1;
    const svg = document.getElementById("gpxi-eleprof-svg");
    if (!svg) return -1;
    const r = svg.getBoundingClientRect();
    if (!r.width) return -1;
    const xv = ((clientX - r.left) / r.width) * _profDraw.W;
    const targetCum = _profDraw.x0 + (xv / _profDraw.W) * _profDraw.span;
    let best = _profDraw.i0, bestD = Infinity;
    for (let i = _profDraw.i0; i <= _profDraw.i1; i++) {
      const d = Math.abs(_profDraw.cum[i] - targetCum);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }
  let _profDragX = null, _profDragMoved = false;
  function onProfileClick(e) {
    if (_profDragMoved) { _profDragMoved = false; return; }   // war ein Pan, kein Klick
    const idx = _profileIdxAtClientX(e.clientX);
    if (idx < 0) return;
    const cx = e.clientX, cy = e.clientY;
    if (_clickTimer) { clearTimeout(_clickTimer); _clickTimer = null; }
    _clickTimer = setTimeout(() => { _clickTimer = null; selectAnchor(idx); }, 240);
  }
  function onProfileDblClick(e) {
    const idx = _profileIdxAtClientX(e.clientX);
    if (idx < 0) return;
    e.preventDefault();
    if (_clickTimer) { clearTimeout(_clickTimer); _clickTimer = null; }
    selectAnchor(idx);
  }
  function onProfileWheel(e) {
    if (!_profDraw) return;
    e.preventDefault();
    const svg = document.getElementById("gpxi-eleprof-svg");
    const r = svg.getBoundingClientRect();
    const frac = r.width ? Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) : 0.5;
    _zoomProfileWindow(e.deltaY > 0 ? 1.25 : 0.8, frac);
  }
  function onProfileDown(e) { _profDragX = e.clientX; _profDragMoved = false; }
  function onProfileMove(e) {
    if (_profDragX == null || !_profDraw) return;
    const svg = document.getElementById("gpxi-eleprof-svg");
    const r = svg.getBoundingClientRect();
    if (!r.width) return;
    const dxFrac = (e.clientX - _profDragX) / r.width;
    if (Math.abs(dxFrac) < 0.03) return;
    _profDragMoved = true;
    _panProfileWindow(-dxFrac);
    _profDragX = e.clientX;
  }
  function onProfileUp() { _profDragX = null; }

  // ── Verknüpfter Hover-Cursor (v0.9.294) — Maus Karte ↔ Position im Profil ─────
  // Maus über der Karte → vertikaler Balken im Profil; Maus über dem Profil → Ring
  // auf dem Track. Beides läuft über setHover(idx).
  function setHover(idx) {
    // 0) Live-Daten-Box in der Ecke: zeigt immer den Punkt unter dem Mauszeiger.
    const hbox = document.getElementById("gpxi-hoverbox");
    if (hbox) {
      if (idx == null || !_points[idx]) { hbox.hidden = true; }
      else { hbox.innerHTML = _pointDataTable(idx); hbox.hidden = false; }
    }
    // 1) Ring-Marker auf der Karte
    try {
      const src = map && map.getSource("gpxi-hover");
      if (src) {
        if (idx == null || !_points[idx]) src.setData({ type: "FeatureCollection", features: [] });
        else src.setData({ type: "Feature", geometry: { type: "Point", coordinates: [_points[idx].lon, _points[idx].lat] } });
      }
    } catch (_) {}
    // 2) Vertikaler Cursor im Profil
    const strip = document.getElementById("gpxi-ele-profile");
    const svg = document.getElementById("gpxi-eleprof-svg");
    let cur = document.getElementById("gpxi-eleprof-cursor");
    if (!strip || !svg || !_profDraw || idx == null || idx < _profDraw.i0 || idx > _profDraw.i1) {
      if (cur) cur.hidden = true; return;
    }
    if (!cur) { cur = document.createElement("div"); cur.id = "gpxi-eleprof-cursor"; cur.className = "gpxi-ep-cursor"; strip.appendChild(cur); }
    const xView = ((_profDraw.cum[idx] - _profDraw.x0) / _profDraw.span) * _profDraw.W;
    const sr = svg.getBoundingClientRect(), pr = strip.getBoundingClientRect();
    cur.style.left = ((sr.left - pr.left) + (xView / _profDraw.W) * sr.width) + "px";
    cur.style.top = (sr.top - pr.top) + "px";
    cur.style.height = sr.height + "px";
    cur.hidden = false;
  }
  function _hideHover() { setHover(null); }
  function _nearestIdxToLngLat(lng, lat) {
    const i0 = _profDraw ? _profDraw.i0 : 0;
    const i1 = _profDraw ? _profDraw.i1 : _points.length - 1;
    const coslat = Math.cos(lat * Math.PI / 180);   // Längengrade nach Breite skalieren
    let best = -1, bestD = Infinity;
    for (let i = i0; i <= i1; i++) {
      const p = _points[i];
      const dx = (p.lon - lng) * coslat, dy = p.lat - lat;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }
  let _hoverRAF = 0, _hoverLL = null;
  function onMapHover(e) {
    _hoverLL = e.lngLat;
    if (_hoverRAF) return;
    _hoverRAF = requestAnimationFrame(() => {
      _hoverRAF = 0;
      if (!_hoverLL) return;
      const idx = _nearestIdxToLngLat(_hoverLL.lng, _hoverLL.lat);
      if (idx >= 0) setHover(idx);
    });
  }
  function onProfileHover(e) {
    if (!_profDraw) return;
    const idx = _profileIdxAtClientX(e.clientX);
    if (idx >= 0) setHover(idx);
  }

  // ── Punkt-Info-Feld (v0.9.293) — leichtes Feld AM Punkt, dunkelt NICHT ab ─────
  // Karte = natives Popup (folgt dem Punkt). Profil = schwebende Box an der Klick-
  // stelle. Neuer Klick → das Feld wandert zum neuen Punkt.
  function _pointDataTable(idx) {
    const p = _points[idx];
    const cum = _cumDist();
    const distStart = cum[idx] || 0;
    const prev = idx > 0 ? _points[idx - 1] : null;
    const dPrev = prev ? _haversine(prev, p) : null;
    const tThis = p.time ? Date.parse(p.time) : null;
    const tPrev = prev && prev.time ? Date.parse(prev.time) : null;
    const dtPrev = (tThis != null && tPrev != null) ? (tThis - tPrev) / 1000 : null;
    const speed = (dPrev != null && dtPrev && dtPrev > 0) ? (dPrev / dtPrev) * 3.6 : null;
    const grade = (dPrev != null && dPrev > 0 && prev && prev.ele != null && p.ele != null) ? ((p.ele - prev.ele) / dPrev) * 100 : null;
    const dem = _demEles ? _demEles[idx] : null;
    const rows = [];
    const row = (k, v) => rows.push(`<tr><td class="gpxi-pm-k">${k}</td><td class="gpxi-pm-v">${v}</td></tr>`);
    row(t("gpxinspect.pm_index", "Punkt"), "#" + (idx + 1) + " / " + _points.length);  // _pointDataTable
    row(t("gpxinspect.pm_pos", "Position"), p.lat.toFixed(6) + ", " + p.lon.toFixed(6));
    row(t("gpxinspect.pm_ele", "Höhe (GPS)"), p.ele != null ? Math.round(p.ele) + " m" : "—");
    if (dem != null && isFinite(dem)) row(t("gpxinspect.pm_ele_map", "Höhe (Karte)"), Math.round(dem) + " m");
    row(t("gpxinspect.pm_time", "Zeit"), p.time ? _fmtPtTime(p.time) : t("gpxinspect.no_time", "ohne Zeit"));
    row(t("gpxinspect.pm_dist", "Distanz ab Start"), _fmtKm(distStart));
    if (dPrev != null) row(t("gpxinspect.pm_dprev", "Abstand zum vorigen"), dPrev.toFixed(1) + " m");
    if (speed != null) row(t("gpxinspect.pm_speed", "Geschwindigkeit"), speed.toFixed(1) + " km/h");
    if (grade != null) row(t("gpxinspect.pm_grade", "Steigung"), (grade >= 0 ? "+" : "") + grade.toFixed(1) + " %");
    return `<div class="gpxi-pi-head">${t("gpxinspect.pm_title", "Punkt-Daten")}</div>` +
      `<table class="gpxi-pm-tbl"><tbody>${rows.join("")}</tbody></table>`;
  }
  function _pointInfoHtml(idx) {
    return _pointDataTable(idx) +
      `<div class="gpxi-pi-actions">` +
      `<button class="btn" id="gpxi-pi-a">${t("gpxinspect.pm_set_a", "Als Anker A")}</button>` +
      `<button class="btn" id="gpxi-pi-b">${t("gpxinspect.pm_set_b", "Als Anker B")}</button>` +
      `</div>`;
  }
  function _wirePointInfo(idx, closeFn) {
    const aBtn = document.getElementById("gpxi-pi-a");
    const bBtn = document.getElementById("gpxi-pi-b");
    if (aBtn) aBtn.onclick = () => { _selA = idx; _selB = null; renderPoints(); updateUI(); if (_profDraw) drawEleProfile(); if (closeFn) closeFn(); };
    if (bBtn) bBtn.onclick = () => {
      if (_selA === null) { _selA = idx; }
      else if (idx !== _selA) { _selB = idx; if (_selB < _selA) { const tmp = _selA; _selA = _selB; _selB = tmp; } }
      renderPoints(); updateUI(); if (_profDraw) drawEleProfile(); if (closeFn) closeFn();
    };
  }
  function _closeProfileBox() { const box = document.getElementById("gpxi-pinfo-box"); if (box) box.remove(); }
  function _closeMapPopup() { if (_ptPopup) { try { _ptPopup.remove(); } catch (_) {} _ptPopup = null; } }
  // Karte: Popup am Punkt (folgt der Karte beim Pannen/Zoomen).
  function showPointInfoMap(idx) {
    const p = _points[idx];
    if (!p || !_maplib || !map) return;
    _closeProfileBox();
    _closeMapPopup();
    _ptPopup = new _maplib.Popup({ closeButton: true, closeOnClick: false, maxWidth: "300px", className: "gpxi-pinfo-pop", offset: 10 })
      .setLngLat([p.lon, p.lat]).setHTML(`<div class="gpxi-pinfo">${_pointInfoHtml(idx)}</div>`).addTo(map);
    try { _ptPopup.on("close", () => { _ptPopup = null; }); } catch (_) {}
    _wirePointInfo(idx, _closeMapPopup);
  }
  // Profil: schwebende Box an der Klickstelle (im canvaswrap), folgt dem Theme.
  function showPointInfoProfile(idx, clientX, clientY) {
    const wrap = document.getElementById("gpxi-canvaswrap");
    if (!wrap) return;
    _closeMapPopup();
    let box = document.getElementById("gpxi-pinfo-box");
    if (!box) { box = document.createElement("div"); box.id = "gpxi-pinfo-box"; box.className = "gpxi-pinfo gpxi-pinfo-float"; wrap.appendChild(box); }
    box.innerHTML = `<button class="gpxi-pi-x" id="gpxi-pi-close" title="${t("gpxinspect.pm_close", "Schließen")}">✕</button>` + _pointInfoHtml(idx);
    const wr = wrap.getBoundingClientRect();
    box.style.left = "0px"; box.style.top = "0px";   // erst messen, dann platzieren
    const bw = box.offsetWidth, bh = box.offsetHeight;
    let left = (clientX - wr.left) + 12;
    let top = (clientY - wr.top) - bh - 12;           // bevorzugt oberhalb des Klicks
    if (top < 4) top = (clientY - wr.top) + 14;       // sonst darunter
    if (left + bw > wr.width - 4) left = wr.width - bw - 6;
    if (left < 4) left = 4;
    if (top + bh > wr.height - 4) top = wr.height - bh - 6;
    if (top < 4) top = 4;
    box.style.left = left + "px"; box.style.top = top + "px";
    const cBtn = document.getElementById("gpxi-pi-close");
    if (cBtn) cBtn.onclick = _closeProfileBox;
    _wirePointInfo(idx, _closeProfileBox);
  }
  // DEM einmal samplen + Profil einblenden.
  async function loadEleProfile() {
    const resEl = document.getElementById("gpxi-ele-result");
    if (_eleBusy || _points.length < 2 || !map) return;
    if (!(typeof isMapboxMode === "function" && isMapboxMode())) {
      const m = t("gpxinspect.ele_need_token", "Braucht einen Mapbox-Token (Einstellungen).");
      if (resEl) resEl.textContent = m; toast(m, "warn"); return;
    }
    const btn = document.getElementById("gpxi-ele-load");
    _eleBusy = true;
    if (btn) { btn.disabled = true; btn.textContent = "⏳ " + t("gpxinspect.ele_working", "Hole Höhen aus der Karte …"); }
    try {
      // Track-Bbox anfahren (animate:false), auf 'idle' warten (DEM-Kacheln da), samplen, zurück.
      const cam = { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
      try { map.fitBounds(_trackBounds(), { padding: 40, animate: false }); } catch (_) {}
      await new Promise((resolve) => {
        let done = false; const fin = () => { if (!done) { done = true; resolve(); } };
        try { map.once("idle", fin); } catch (_) {}
        setTimeout(fin, 9000);
      });
      if (isUnmounted) return;
      let hit = 0;
      const dem = _points.map(p => {
        let v = null;
        try { v = map.queryTerrainElevation([p.lon, p.lat]); } catch (_) {}
        if (v == null || !isFinite(v)) return null;
        hit++; return Math.round(v * 10) / 10;
      });
      try { map.jumpTo(cam); } catch (_) {}
      if (!hit) {
        const m = t("gpxinspect.ele_no_dem", "Keine Höhendaten gefunden (Internet/Token?).");
        if (resEl) resEl.textContent = m; toast(m, "warn"); return;
      }
      _demEles = dem;
      const prof = document.getElementById("gpxi-ele-profile");
      if (prof) prof.hidden = false;
      setDisabled("gpxi-ele-weight", false);
      setDisabled("gpxi-ele-apply", false);
      try { map.resize(); } catch (_) {}   // Karte schrumpft um den Profil-Streifen
      // Fenster initial auf den aktuell sichtbaren Karten-Ausschnitt (Zoom-Sync)
      _profI0 = 0; _profI1 = _points.length - 1;
      _windowFromBounds();
      drawEleProfile();
    } catch (e) {
      applog && applog("error", "[gpxinspect] loadEleProfile: " + e);
      if (resEl) resEl.textContent = t("gpxinspect.ele_err", "Höhenprofil laden fehlgeschlagen.");
    } finally {
      _eleBusy = false;
      if (btn) { btn.disabled = false; btn.textContent = "🗺 " + t("gpxinspect.ele_load", "Höhenprofil aus Karte laden"); }
    }
  }
  // Aktuelle Mischung in die Punkte schreiben (mit Undo).
  function applyEleBlend() {
    if (!_demEles || _demEles.length !== _points.length) return;
    const w = _eleWeight();
    const res = _blendEles(w);
    const oldGain = _eleGain(_points.map(p => p.ele));
    _pushUndo(t("gpxinspect.ele_title", "Höhe korrigieren"));
    for (let i = 0; i < _points.length; i++) {
      if (res[i] != null && isFinite(res[i])) _points[i].ele = Math.round(res[i] * 10) / 10;
    }
    _hasEle = true; _dirty = true;
    const newGain = _eleGain(_points.map(p => p.ele));
    renderAll(); updateUI();
    drawEleProfile();   // GPS-Linie == jetzt Ergebnis → die beiden fallen zusammen
    const resEl = document.getElementById("gpxi-ele-result");
    if (resEl) resEl.textContent = t("gpxinspect.ele_done", "Übernommen: %old → %new Höhenmeter (%pct % Karte). Jetzt speichern.")
      .replace("%old", Math.round(oldGain)).replace("%new", Math.round(newGain)).replace("%pct", Math.round(w * 100));
    toast(t("gpxinspect.ele_applied_toast", "Höhe übernommen — zum Sichern unten speichern."), "success");
  }

  async function saveTrack() {
    if (!_points.length) return;
    const payload = _points.map(p => ({ lat: p.lat, lon: p.lon, ele: p.ele, time: p.time }));
    let res;
    try { res = await api().gpxinspect_save(payload, _srcPath); } catch (e) { res = { ok: false, error: String(e) }; }
    if (isUnmounted) return;
    if (!res || !res.ok) { toast((res && res.error) || "Speichern fehlgeschlagen", "error", 6000); return; }
    _dirty = false; updateUI();
    const note = document.getElementById("gpxi-note");
    if (note) note.textContent = t("gpxinspect.saved", "Gespeichert: ") + res.out_path;
    toast(t("gpxinspect.saved", "Gespeichert: ") + res.out_path, "success", 6000);
    // Geheiltes GPX gleich global laden → alle Module nutzen die saubere Version,
    // und der Inspektor zeigt ab jetzt den geheilten Track.
    if (typeof loadGlobalGpx === "function") { try { loadGlobalGpx(res.out_path); } catch (_) {} }
  }

  // ── UI-State ─────────────────────────────────────────────────────────────────
  function _fmtKm(m) { return (m / 1000 < 100) ? (m / 1000).toFixed(1) + " km" : Math.round(m / 1000) + " km"; }
  function updateUI() {
    const has = _points.length > 0;
    const empty = document.getElementById("gpxi-empty");
    const panel = document.getElementById("gpxi-panel");
    if (empty) empty.hidden = has;
    if (panel) panel.hidden = !has;
    if (!has) return;
    // Stats
    let dist = 0;
    for (let i = 1; i < _points.length; i++) dist += _haversine(_points[i - 1], _points[i]);
    const stat = document.getElementById("gpxi-stat");
    if (stat) stat.textContent = _points.length + " " + t("gpxinspect.points", "Punkte") + " · " + _fmtKm(dist)
      + (_hasTime ? "" : " · " + t("gpxinspect.no_time", "ohne Zeit"))
      + (_dirty ? " · " + t("gpxinspect.unsaved", "ungespeichert") : "");
    // Auswahl-Text
    const selEl = document.getElementById("gpxi-sel");
    const haveA = _selA !== null, haveB = _selB !== null;
    if (selEl) {
      if (!haveA) selEl.textContent = t("gpxinspect.sel_none", "Keine Auswahl");
      else if (!haveB) {
        // v0.9.293 — Detail-Daten liegen jetzt im Punkt-Modal (Klick), hier nur kurz.
        selEl.textContent = t("gpxinspect.sel_a_short", "Anker A: ") + "#" + (_selA + 1)
          + " — " + t("gpxinspect.sel_a_next", "jetzt B klicken");
      } else {
        const between = _selB - _selA - 1;
        const segDist = _haversine(_points[_selA], _points[_selB]);
        const tA = _points[_selA].time ? Date.parse(_points[_selA].time) : null;
        const tB = _points[_selB].time ? Date.parse(_points[_selB].time) : null;
        const dur = (tA != null && tB != null) ? (" · ⏱ " + _fmtDur(tB - tA)) : "";
        selEl.textContent = t("gpxinspect.sel_ab", "A→B: ") + between + " " + t("gpxinspect.between", "Punkte dazwischen") + " · " + _fmtKm(segDist) + dur;
      }
    }
    const both = haveA && haveB;
    const hasBetween = both && (_selB > _selA + 1);
    setDisabled("gpxi-heal", !hasBetween || _drawMode);
    setDisabled("gpxi-fill", !both || _drawMode);
    setDisabled("gpxi-drawfill", !both || _drawMode);
    setDisabled("gpxi-delete-one", !(haveA && !haveB) || _drawMode);
    setDisabled("gpxi-delete", !hasBetween || _drawMode);
    // Map Matching: Bereich sobald A+B gesetzt sind (≥2 Punkte reichen zum Snappen —
    // anders als „Lücke füllen" braucht es KEINE Punkte dazwischen); ganzer Track sobald Punkte da.
    setDisabled("gpxi-match-sel", !both || _drawMode || _mmBusy);
    setDisabled("gpxi-match-all", _drawMode || _mmBusy || _points.length < 2);
    setDisabled("gpxi-clearsel", !haveA || _drawMode);
    setDisabled("gpxi-save", !_dirty || _drawMode);
    setDisabled("gpxi-reset", !_dirty || _drawMode);
    setDisabled("gpxi-undo", _drawMode || !(_undo && _undo.canUndo()));
    setDisabled("gpxi-redo", _drawMode || !(_undo && _undo.canRedo()));
    // Auto-Despike: Button frei wenn Punkte da & nicht im Zeichnen-Modus.
    setDisabled("gpxi-heal-run", _drawMode || _mmBusy || !_points.length);
    const spikeBox = document.getElementById("gpxi-spikebox");
    const nSpk = _spikes.length, nGap = _gaps.length;
    if (spikeBox) spikeBox.hidden = (nSpk === 0 && nGap === 0) || _drawMode;
    {
      const sh = document.getElementById("gpxi-spikehint");
      if (sh) {
        let txt = "";
        if (nSpk > 0) txt += t("gpxinspect.spike_nav", "Ausreißer ") + (_spikeIdx + 1) + "/" + nSpk;
        if (nGap > 0) txt += (txt ? " · " : "") + t("gpxinspect.gap_count", "Lücken: ") + nGap;
        sh.textContent = txt;
      }
      // Durchsteppen nur sinnvoll für Ausreißer; bei reinen Lücken Nav aus.
      setDisabled("gpxi-spike-prev", nSpk === 0 || _spikeIdx <= 0);
      setDisabled("gpxi-spike-next", nSpk === 0 || _spikeIdx >= nSpk - 1);
    }
    // Zeichnen-Modus: Box ein, Stützpunkt-Zähler, Übernehmen/Undo nach Bedarf.
    const drawBox = document.getElementById("gpxi-drawbox");
    if (drawBox) drawBox.hidden = !_drawMode;
    if (_drawMode) {
      const dh = document.getElementById("gpxi-drawhint");
      if (dh) dh.textContent = t("gpxinspect.draw_count", "Stützpunkte gesetzt: ") + _drawPts.length
        + " — " + t("gpxinspect.draw_more", "weiter klicken oder übernehmen.");
      setDisabled("gpxi-draw-apply", _drawPts.length < 1);
      setDisabled("gpxi-draw-undo", _drawPts.length < 1);
    }
  }
  function setDisabled(id, dis) { const el = document.getElementById(id); if (el) el.disabled = !!dis; }

  // ── Listener ─────────────────────────────────────────────────────────────────
  const _on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener("click", fn); };
  _on("gpxi-heal", healSegment);
  _on("gpxi-fill", fillGap);
  _on("gpxi-drawfill", startDraw);
  _on("gpxi-draw-apply", applyDrawnPath);
  _on("gpxi-draw-undo", undoDrawPoint);
  _on("gpxi-draw-cancel", cancelDraw);
  _on("gpxi-delete-one", deletePoint);
  _on("gpxi-delete", deleteBetween);
  _on("gpxi-clearsel", clearSelection);
  _on("gpxi-match-sel", routeSelection);

  // Entf/Backspace: einzelnen Punkt (nur A) oder Bereich (A+B) löschen.
  // Nicht feuern wenn man in einem Eingabefeld tippt oder im Zeichnen-Modus ist.
  function onKeyDown(e) {
    if (e.key !== "Delete" && e.key !== "Backspace") return;
    if (_drawMode) return;
    const tag = (e.target && e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || (e.target && e.target.isContentEditable)) return;
    const panel = document.getElementById("gpxi-panel");
    if (!panel || panel.hidden || !panel.offsetParent) return;   // Modul nicht sichtbar
    if (_selA !== null && _selB === null) { e.preventDefault(); deletePoint(); }
    else if (_selA !== null && _selB !== null && _selB > _selA + 1) { e.preventDefault(); deleteBetween(); }
  }
  document.addEventListener("keydown", onKeyDown);
  _on("gpxi-undo", () => { if (_undo) _undo.undo(); });
  _on("gpxi-redo", () => { if (_undo) _undo.redo(); });
  _on("gpxi-heal-run", runHeal);
  // ?-Tooltip: native title-Tooltips rendern in der WebView nicht → eigenes Popup,
  // das per position:fixed auch aus dem scrollbaren Panel herausragen darf.
  (function () {
    let tip = document.getElementById("gpxi-tip");
    if (!tip) { tip = document.createElement("div"); tip.id = "gpxi-tip"; tip.className = "gpxi-tip"; document.body.appendChild(tip); }
    const scope = document.getElementById("gpxi-panel") || body;
    function show(el) {
      const txt = el.getAttribute("data-tip"); if (!txt) return;
      tip.textContent = txt; tip.style.display = "block";
      const r = el.getBoundingClientRect();
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let left = r.left + r.width / 2 - tw / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
      let top = r.top - th - 8;
      if (top < 8) top = r.bottom + 8;
      tip.style.left = left + "px"; tip.style.top = top + "px";
    }
    function hide() { tip.style.display = "none"; }
    scope.addEventListener("mouseover", (e) => { const q = e.target.closest && e.target.closest(".gpxi-q"); if (q) show(q); });
    scope.addEventListener("mouseout", (e) => { const q = e.target.closest && e.target.closest(".gpxi-q"); if (q) hide(); });
    scope.addEventListener("click", (e) => { const q = e.target.closest && e.target.closest(".gpxi-q"); if (q) { e.preventDefault(); (tip.style.display === "block" ? hide() : show(q)); } });
  })();
  // Empfindlichkeits-Slider: nur Label live.
  { const sl = document.getElementById("gpxi-sens"), lbl = document.getElementById("gpxi-sens-val");
    if (sl) sl.addEventListener("input", () => { if (lbl) lbl.textContent = sl.value; }); }
  // v0.9.294 — Füll-Abstand ändert die Lücken-Vorschau (Geister-Punkte) live nach.
  { const sp = document.getElementById("gpxi-spacing");
    if (sp) sp.addEventListener("input", () => { if (_gaps.length) renderGaps(); }); }
  // v0.9.292 — Höhe korrigieren: Profil laden, live mischen, übernehmen
  _on("gpxi-ele-load", loadEleProfile);
  _on("gpxi-ele-apply", applyEleBlend);
  { const ew = document.getElementById("gpxi-ele-weight"), ewl = document.getElementById("gpxi-ele-weight-val");
    if (ew) ew.addEventListener("input", () => { if (ewl) ewl.textContent = ew.value + " %"; drawEleProfile(); }); }
  // v0.9.293 — Profil-Interaktion: Klick=Modal, Doppelklick=Anker, Rad=Zoom, Drag=Pan
  { const psvg = document.getElementById("gpxi-eleprof-svg");
    if (psvg) {
      psvg.addEventListener("click", onProfileClick);
      psvg.addEventListener("dblclick", onProfileDblClick);
      psvg.addEventListener("wheel", onProfileWheel, { passive: false });
      psvg.addEventListener("pointerdown", onProfileDown);
      psvg.addEventListener("pointermove", onProfileMove);
      psvg.addEventListener("mousemove", onProfileHover);            // v0.9.294 — Track-Ring zeigen
      psvg.addEventListener("mouseleave", _hideHover);
      window.addEventListener("pointerup", onProfileUp);
    } }
  if (!(typeof isMapboxMode === "function" && isMapboxMode())) {
    const lb = document.getElementById("gpxi-ele-load"); if (lb) lb.disabled = true;
    const rr = document.getElementById("gpxi-ele-result");
    if (rr) rr.textContent = t("gpxinspect.ele_need_token", "Braucht einen Mapbox-Token (Einstellungen).");
  }
  _on("gpxi-save", saveTrack);
  _on("gpxi-reset", () => { if (_srcPath) loadTrack(_srcPath); });

  updateUI();

  // ── Cleanup ──────────────────────────────────────────────────────────────────
  return function cleanup() {
    isUnmounted = true;
    try { document.removeEventListener("keydown", onKeyDown); } catch (_) {}
    try { window.removeEventListener("pointerup", onProfileUp); } catch (_) {}   // v0.9.293
    if (_clickTimer) { try { clearTimeout(_clickTimer); } catch (_) {} _clickTimer = null; }
    if (_hoverRAF) { try { cancelAnimationFrame(_hoverRAF); } catch (_) {} _hoverRAF = 0; }
    try { _closeProfileBox(); } catch (_) {}
    try { _closeMapPopup(); } catch (_) {}
    try { if (map) { map.remove(); } } catch (_) {}
    map = null;
  };
}
