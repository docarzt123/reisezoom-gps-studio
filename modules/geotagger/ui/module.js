// Reisezoom GPS Studio — Geotagger-Modul

(window.RZGPS_MODULES = window.RZGPS_MODULES || {}).geotagger = {
  manifest: {
    slug: "geotagger",
    name: "Geotagger",
    description: "Fotos mit GPS taggen",
    icon: "◉",
    sort_order: 50,
  },
  mount: function (body, headerActions) { return mountGeotagger(body, headerActions); },
};

function mountGeotagger(body, headerActions) {
  // ── v0.9.67 — Undo/Redo für Geotagger-Settings (ohne EXIF-Write) ─────────
  // Snapshot: nur die nicht-destruktiven Settings (Offset, Referenz-Pfad,
  // Foldermode etc.). Geschriebene GPS-Tags in Fotos sind NICHT undoable
  // (destruktiv → braucht separaten Restore-Workflow, siehe Marc-Choice).
  const _gtgUndoCtrl = window.createUndoController({
    snapshot: () => {
      const proj = (typeof getActiveProject === "function") ? getActiveProject() : null;
      const g = (proj && proj.geotagger) || {};
      return {
        offset_seconds:   g.offset_seconds ?? 0,
        reference_path:   g.reference_path || null,
        reference_mode:   g.reference_mode || null,
        folder_recursive: !!g.folder_recursive,
      };
    },
    apply: (snap) => {
      if (!snap) return;
      saveProjectSettings("geotagger", JSON.parse(JSON.stringify(snap)));
      if (typeof rebindAllSettings === "function") rebindAllSettings();
      // Offset-Slider triggert recalculation der Matches
      const offEl = document.getElementById("gt-offset");
      if (offEl) offEl.dispatchEvent(new Event("input", { bubbles: true }));
    },
    toast: (msg) => { if (typeof toast === "function") toast(msg, "info", 1000); },
  });
  window.__rzUndoControllers.geotagger = _gtgUndoCtrl;
  const _gtgPushUndo = (label, opts) => _gtgUndoCtrl.push(label, opts);
  // Generic-Hook auf #gt-panel
  function _wireGeotaggerUndoListeners() {
    const root = document.getElementById("gt-panel");
    if (!root) return;
    if (root.dataset.undoWired === "1") return;
    root.dataset.undoWired = "1";
    root.addEventListener("input", (ev) => {
      const t = ev.target;
      if (!t) return;
      _gtgPushUndo(`${t.id || t.name || "Wert"} geändert`);
    });
    root.addEventListener("change", (ev) => {
      const t = ev.target;
      if (!t) return;
      const tag = (t.tagName || "").toLowerCase();
      const ty = (t.type || "").toLowerCase();
      const isDiscrete = tag === "select" || ty === "checkbox" || ty === "radio";
      _gtgPushUndo(`${t.id || t.name || tag} geändert`, { force: isDiscrete });
    });
  }
  const _origGtgProjChanged = window._geotaggerOnProjectChanged;
  window._geotaggerOnProjectChanged = function() {
    _gtgUndoCtrl.reset();
    if (typeof _origGtgProjChanged === "function") _origGtgProjChanged();
  };
  // ── /Undo-Redo ──────────────────────────────────────────────────────────

  body.innerHTML = `
    <aside class="panel" id="gt-panel">
      <!-- v0.8.1: GPX-Sektion entfernt — Picker ist global in der Sub-Top-Bar. -->
      <div class="section">
        <div class="section-title">${t("geotagger.section.photos")}</div>
        <button class="btn btn-block" id="gt-pick-photos">${t("geotagger.btn.pick_photos")}</button>
        <button class="btn btn-block btn-small" id="gt-pick-folder">${t("geotagger.btn.pick_folder")}</button>
        <!-- v0.9.27 (Nutzer-Feedback): Unterordner-Option beim Folder-Pick -->
        <label class="checkbox-row" style="margin-top:6px; font-size:12px;">
          <input type="checkbox" id="gt-folder-recursive">
          <span>${t("geotagger.toggle.folder_recursive")}</span>
        </label>
        <div class="file-label small-info" id="gt-photos-info" hidden></div>
      </div>

      <div class="section">
        <div class="section-title" title="${t("geotagger.offset.help_tooltip")}">${t("geotagger.section.offset")}</div>

        <div class="offset-slider-box">
          <div class="offset-slider-display">
            <span class="offset-slider-value" id="gt-off-display">±0s</span>
            <button class="offset-slider-reset" id="gt-off-reset" title="${t("geotagger.offset.reset_tooltip")}">↺</button>
            <button class="offset-slider-edit" id="gt-off-edit" title="${t("geotagger.offset.edit_tooltip")}">✎</button>
          </div>
          <input type="range" id="gt-off-slider"
                 min="-7200" max="7200" step="60" value="0">
          <div class="offset-slider-scale" id="gt-off-scale">
            <span>−2h</span><span>−1h</span><span>0</span><span>+1h</span><span>+2h</span>
          </div>
          <button class="offset-range-toggle" id="gt-off-range-toggle">${t("geotagger.offset.more_hours")}</button>
          <div class="offset-range-buttons" id="gt-off-range-buttons" style="display:none">
            <span class="offset-range-label">${t("geotagger.offset.range_label")}</span>
            <button class="offset-range-btn active" data-range="2">±2h</button>
            <button class="offset-range-btn" data-range="3">±3h</button>
            <button class="offset-range-btn" data-range="6">±6h</button>
            <button class="offset-range-btn" data-range="12">±12h</button>
          </div>
        </div>

        <button class="btn btn-block btn-small" id="gt-ref-mode"
                title="${t("geotagger.btn.ref_mode_tooltip")}">${t("geotagger.btn.ref_mode")}</button>
      </div>

      <!-- v0.9.166 — Fotos manuell auf der Karte platzieren -->
      <div class="section">
        <div class="section-title">${t("geotagger.section.place", "Manuell platzieren")}</div>
        <p class="small-info" style="margin:0 0 8px; line-height:1.5;">${t("geotagger.place.hint", "Zieh ein Foto aus der Liste auf die Karte — die Koordinaten werden dann geschrieben. Funktioniert auch ohne Track.")}</p>
        <label class="checkbox-row">
          <input type="checkbox" id="gt-snap-track">
          <span>${t("geotagger.place.snap_toggle", "Auf Track einrasten")}</span>
        </label>
        <div class="small-info" id="gt-snap-cmd-hint" style="margin-top:4px; opacity:0.8;">${t("geotagger.place.cmd_hint", "⌘ beim Ablegen kehrt das kurz um.")}</div>
        <!-- v0.9.281 (Nutzer-Wunsch): Aufnahmezeit aus Track für eingerastete Fotos -->
        <label class="checkbox-row" style="margin-top:8px;">
          <input type="checkbox" id="gt-set-time-from-track">
          <span>${t("geotagger.place.set_time_toggle", "Aufnahmezeit aus Track übernehmen")}</span>
        </label>
        <div class="small-info" style="margin-top:4px; opacity:0.8;">${t("geotagger.place.set_time_hint", "Nur für eingerastete Fotos: schreibt die Uhrzeit des Track-Punkts als Aufnahmezeitpunkt — ideal für WhatsApp-Fotos ohne korrekte Zeit.")}</div>
      </div>

      <div class="divider"></div>

      <div class="section">
        <div class="section-title">${t("geotagger.section.write")}</div>
        <label class="checkbox-row">
          <input type="checkbox" id="gt-backup" checked>
          <span>${t("geotagger.toggle.backup")}</span>
        </label>
        <label class="checkbox-row">
          <input type="checkbox" id="gt-overwrite">
          <span>${t("geotagger.toggle.overwrite")}</span>
        </label>
        <label class="checkbox-row">
          <input type="checkbox" id="gt-adjust-time">
          <span>${t("geotagger.toggle.adjust_time")}</span>
        </label>
        <div class="match-summary" id="gt-summary" style="display:none"></div>
        <button class="btn btn-primary btn-block" id="gt-write" disabled>${t("geotagger.btn.write")}</button>
      </div>
    </aside>

    <section class="canvas gt-layout">
      <div class="photo-grid drop-target" id="gt-photos" data-drop-hint="${t("geotagger.dnd.photos_hint")}"></div>
      <div class="canvas drop-target" id="gt-mapdrop" data-drop-hint="${t("geotagger.dnd.gpx_hint")}" style="position:relative">
        <div class="mode-banner" id="gt-banner">${t("geotagger.banner.ref_mode_generic")}</div>
        <!-- v0.9.166 — Hinweis beim Drag eines Fotos auf die Karte -->
        <div class="gt-place-hint" id="gt-place-hint"></div>
        <div id="map-canvas"></div>
        <div class="map-preview-panel" id="gt-preview">
          <button class="map-preview-close" id="gt-preview-close" title="${t("common.close")}">✕</button>
          <img id="gt-preview-img" alt="">
          <div class="map-preview-panel-body">
            <div class="map-preview-panel-name" id="gt-preview-name"></div>
            <div class="map-preview-panel-meta" id="gt-preview-meta"></div>
          </div>
        </div>
      </div>
    </section>
  `;

  let map = null;
  let markers = [];           // mapboxgl.Marker
  let photos = [];            // pyState: loaded photos
  let matches = [];           // latest match result
  let selectedPath = null;
  let refMode = false;
  let referencePath = null;   // welches Foto wurde zuletzt als Referenz benutzt?
  let currentGpxPath = null;
  // v0.9.163 — Track-Klick-Info-Popup + Übersicht-Filter
  let _gtTrackPopup = null;   // mapLib().Popup für Track-Punkt-Klick
  let _gtFilter = null;       // null | "tagged" | "oor" | "notime" | "hasgps"
  // v0.9.164 — Kamera-Filter + Tag-Auswahl (Checkbox je Foto, default an)
  let _gtCamFilter = null;    // null oder Kamera-String
  const _gtUnchecked = new Set();  // Pfade die NICHT getaggt werden (Häkchen aus)
  // v0.9.166 — Fotos manuell auf der Karte platzieren (Drag aus der Liste)
  const _gtManual = new Map();     // path → {lat, lon, alt|null} (manuell gesetzt)
  let _gtSnapToTrack = false;      // Toggle „Auf Track einrasten"
  let _gtMetaDown = false;         // ⌘ aktuell gedrückt (Marker-Drag + Hint)
  // v0.9.29 (Marc-Bug-Report): Flag damit async-Tasks die nach dem Unmount
  // weiterlaufen (debouncted updateMatches, pollThumbs in-flight, Promise-
  // Callbacks) NICHT auf den zerstörten map zugreifen. Sonst Mapbox-Error:
  // „undefined is not an object (evaluating 'e.getCanvasContainer().appendChild')"
  // beim Tab-Wechsel während Thumbs noch laden.
  let isUnmounted = false;

  // updateMatches MUSS vor den Listener-Bindings definiert sein,
  // sonst TDZ-ReferenceError → ganze mount-Funktion bricht ab.
  const updateMatches = debounce(async () => {
    if (isUnmounted) return;        // v0.9.29: Tab schon weggeswitched
    _gtUpdateSnapAvail();           // v0.9.166 — Snap-Toggle je nach Track an/aus
    if (!photos.length || !currentGpxPath) return;
    const offset = getOffsetSeconds();
    const res = await api().geotagger_match(offset, 1800, getTzOffsetMinutes());
    if (isUnmounted) return;        // Awaited bridge call kam zurück nachdem unmount
    if (!res.ok) { toast(res.error, "error"); return; }
    matches = res.matches;
    _gtMergeManual();               // v0.9.166 — manuelle Platzierungen wieder reinmischen
    redrawMarkers();
    updateSummary();
    updateBadges();
    const writeBtn = document.getElementById("gt-write");
    if (writeBtn) writeBtn.disabled = !matches.some(m => m.lat != null && m.in_range);
  }, 80);

  function getOffsetSeconds() {
    const slider = document.getElementById("gt-off-slider");
    return slider ? parseInt(slider.value) || 0 : 0;
  }

  // v0.9.177 — Kamera-Zeitzone (UTC±, Minuten). Wird im „genauen Offset"-Modal
  // gesetzt, gilt nur für Fotos ohne eingebetteten TZ-Offset (Backend filtert).
  let tzOffsetMin = parseInt((_settingsCache && _settingsCache.geotagger
                              && _settingsCache.geotagger.tz_offset_minutes) || 0) || 0;
  function getTzOffsetMinutes() { return tzOffsetMin; }
  // Übliche Zeitzonen (Minuten-Offset → Label mit Reise-Beispielen)
  const TZ_OPTIONS = [
    [-720, "UTC−12"], [-660, "UTC−11"], [-600, "UTC−10 (Hawaii)"],
    [-540, "UTC−9"],  [-480, "UTC−8 (US-Westküste)"], [-420, "UTC−7"],
    [-360, "UTC−6"],  [-300, "UTC−5 (US-Ostküste)"], [-240, "UTC−4"],
    [-210, "UTC−3:30"], [-180, "UTC−3"], [-120, "UTC−2"], [-60, "UTC−1"],
    [0,    "UTC±0 (keine Korrektur / Track-Zeit)"],
    [60,   "UTC+1 (Mitteleuropa Winter)"], [120, "UTC+2 (Mitteleuropa Sommer)"],
    [180,  "UTC+3"], [210, "UTC+3:30 (Iran)"], [240, "UTC+4"], [270, "UTC+4:30"],
    [300,  "UTC+5"], [330, "UTC+5:30 (Indien)"], [345, "UTC+5:45 (Nepal)"],
    [360,  "UTC+6"], [390, "UTC+6:30 (Myanmar)"], [420, "UTC+7 (Thailand, Vietnam)"],
    [480,  "UTC+8 (China)"], [540, "UTC+9 (Japan)"], [570, "UTC+9:30"],
    [600,  "UTC+10 (Ostaustralien)"], [660, "UTC+11"], [720, "UTC+12 (Neuseeland)"],
    [780,  "UTC+13"], [840, "UTC+14"],
  ];
  function tzLabel(min) {
    const o = TZ_OPTIONS.find(x => x[0] === min);
    if (o) return o[1].replace(/\s*\(.*\)$/, "");
    const s = min < 0 ? "−" : "+";
    const a = Math.abs(min);
    return `UTC${s}${Math.floor(a / 60)}${a % 60 ? ":" + String(a % 60).padStart(2, "0") : ""}`;
  }

  function setOffsetFromSeconds(sec) {
    const slider = document.getElementById("gt-off-slider");
    if (!slider) return;
    const v = Math.max(-43200, Math.min(43200, Math.round(sec)));
    // Slider-Range ggf. automatisch erweitern damit der Wert auch in den
    // sichtbaren Bereich passt (Range = 3/6/12 h)
    const curMax = parseInt(slider.max);
    if (Math.abs(v) > curMax) {
      const needed = Math.abs(v) > 21600 ? 12
                   : Math.abs(v) > 10800 ? 6
                   : Math.abs(v) > 7200  ? 3
                   : 2;
      // Range-Buttons sichtbar machen falls noch aufgeklappt
      const rb = document.getElementById("gt-off-range-buttons");
      const tg = document.getElementById("gt-off-range-toggle");
      if (rb && tg) { rb.style.display = ""; tg.style.display = "none"; }
      const btn = document.querySelector(`.offset-range-btn[data-range="${needed}"]`);
      if (btn) btn.click();
    }
    slider.value = String(v);
    updateOffsetDisplay();
    saveSettings({ geotagger: { offset_seconds: v } });
  }

  function updateOffsetDisplay() {
    const sec = getOffsetSeconds();
    let txt = fmtSeconds(sec);
    if (tzOffsetMin) txt += "  ·  " + tzLabel(tzOffsetMin);   // v0.9.177
    document.getElementById("gt-off-display").textContent = txt;
  }

  // Slider initialisieren mit Settings-Wert
  const slider = document.getElementById("gt-off-slider");
  const initialOff = parseInt((_settingsCache && _settingsCache.geotagger
                               && _settingsCache.geotagger.offset_seconds) || 0);

  // Range-Modi. Step 60s in allen damit Snap-Logik (s.u.) flüssig zu vollen
  // Stunden einrastet.
  const RANGES = {
    2:  { sec: 7200,  step: 60, labels: ["−2h",  "−1h",   "0", "+1h",   "+2h"] },
    3:  { sec: 10800, step: 60, labels: ["−3h",  "−1.5h", "0", "+1.5h", "+3h"] },
    6:  { sec: 21600, step: 60, labels: ["−6h",  "−3h",   "0", "+3h",   "+6h"] },
    12: { sec: 43200, step: 60, labels: ["−12h", "−6h",   "0", "+6h",   "+12h"] },
  };

  function applySliderRange(hours) {
    const r = RANGES[hours];
    if (!r) return;
    slider.min = String(-r.sec);
    slider.max = String(r.sec);
    slider.step = String(r.step);
    // Skalen-Labels aktualisieren
    const scale = document.getElementById("gt-off-scale");
    scale.innerHTML = r.labels.map(l => `<span>${l}</span>`).join("");
    // Buttons-State
    document.querySelectorAll(".offset-range-btn").forEach(b => {
      b.classList.toggle("active", parseInt(b.dataset.range) === hours);
    });
    // Bewusst NICHT in Settings persistieren — der Range richtet sich beim
    // App-Start automatisch nach dem gespeicherten offset_seconds-Wert.
  }

  // Beim App-Start: Range richtet sich nach dem aktuellen Offset-Wert.
  // → Default-Offset 0 ergibt IMMER ±2h. Der vorher gespeicherte
  //   `offset_range_hours` wird absichtlich ignoriert, damit der Slider
  //   beim Neustart wieder kompakt ist.
  function autoRangeFor(sec) {
    const abs = Math.abs(sec);
    if (abs > 21600) return 12;
    if (abs > 10800) return 6;
    if (abs > 7200)  return 3;
    return 2;
  }
  const initRange = autoRangeFor(initialOff);
  applySliderRange(initRange);

  slider.value = String(initialOff);
  updateOffsetDisplay();

  // Range-Buttons-Aufklapper. Wenn aktueller Range schon > ±2h, sind die
  // Buttons sofort sichtbar (User hat sie ja vorher gebraucht).
  function setRangeButtonsVisible(visible) {
    document.getElementById("gt-off-range-buttons").style.display = visible ? "" : "none";
    document.getElementById("gt-off-range-toggle").style.display = visible ? "none" : "";
  }
  if (initRange > 2) setRangeButtonsVisible(true);

  document.getElementById("gt-off-range-toggle").addEventListener("click", () => {
    setRangeButtonsVisible(true);
  });

  // Range-Wechsel-Buttons
  document.querySelectorAll(".offset-range-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const hours = parseInt(btn.dataset.range);
      const cur = getOffsetSeconds();
      applySliderRange(hours);
      // Wert in Range-Grenzen clampen
      const clamped = Math.max(parseInt(slider.min), Math.min(parseInt(slider.max), cur));
      slider.value = String(clamped);
      updateOffsetDisplay();
      if (clamped !== cur) {
        saveSettings({ geotagger: { offset_seconds: clamped } });
        updateMatches();
      }
    });
  });

  // v0.9.28 (Marc-Feedback): Snap komplett raus. Der Slider bewegt sich
  // stufenlos in 1-Min-Schritten (`step=60`). Wer exakte Werte braucht
  // (Sekunden, runde Stunden), nutzt den ✎-Edit-Button.
  slider.addEventListener("input", () => {
    updateOffsetDisplay();
    updateMatches();    // debounced 80 ms
  });
  slider.addEventListener("change", () => {
    saveSettings({ geotagger: { offset_seconds: parseInt(slider.value) || 0 } });
    updateMatches();
  });

  // Reset-Button → 0
  document.getElementById("gt-off-reset").addEventListener("click", () => {
    setOffsetFromSeconds(0);
    updateMatches();
  });

  // Edit-Button → Modal für genauen Offset-Wert.
  // v0.9.27 (Nutzer-Feedback): Text-Input mit Parser statt nur Sekunden-Zahl.
  // Akzeptiert: 4s, 4m, 1h30m, -2h, 1:30:00, oder reine Zahl (= Sekunden).
  document.getElementById("gt-off-edit").addEventListener("click", () => {
    const cur = getOffsetSeconds();
    // Cur-Wert als h/m/s-String darstellen (nicht „+0s" wenn 0)
    const curStr = cur === 0 ? "0s" : fmtSeconds(cur).replace(/\s+/g, "");
    openModal({
      title: t("geotagger.offset.modal_title"),
      body: `
        <p class="muted">${t("geotagger.offset.modal_intro")}</p>
        <ul class="muted" style="margin:4px 0 12px 18px; padding:0; font-size:12px; line-height:1.55;">
          <li>${t("geotagger.offset.modal_examples_1")}</li>
          <li>${t("geotagger.offset.modal_examples_2")}</li>
          <li>${t("geotagger.offset.modal_examples_3")}</li>
          <li>${t("geotagger.offset.modal_examples_4")}</li>
        </ul>
        <input type="text" id="md-offset-input" value="${curStr}"
               placeholder="${t("geotagger.offset.modal_placeholder")}"
               autocomplete="off" spellcheck="false"
               style="width:100%; font-family:ui-monospace,Menlo,monospace; font-size:18px; text-align:center;">
        <div id="md-offset-feedback" class="muted" style="margin-top:8px; min-height:18px; text-align:center;"></div>
        <div style="margin-top:16px; padding-top:14px; border-top:1px solid var(--border, #333);">
          <label for="md-offset-tz" style="display:block; font-weight:600; margin-bottom:4px;">
            ${t("geotagger.offset.tz_label", "Kamera-Zeitzone")}
          </label>
          <p class="muted" style="margin:0 0 8px; font-size:12px; line-height:1.5;">
            ${t("geotagger.offset.tz_intro", "Nur nötig, wenn die Kamera die Zeitzone NICHT in den Metadaten speichert (z.B. viele Olympus/OM, GoPro). Fotos mit gespeicherter Zeitzone (Handy etc.) bleiben automatisch korrekt.")}
          </p>
          <select id="md-offset-tz" style="width:100%; padding:7px 8px; font-size:14px;">
            ${TZ_OPTIONS.map(([min, lbl]) =>
              `<option value="${min}"${min === tzOffsetMin ? " selected" : ""}>${lbl}</option>`
            ).join("")}
          </select>
        </div>
        <p class="muted" style="margin-top:12px; font-size:11px;">${t("geotagger.offset.modal_range_hint")}</p>
      `,
      footer: `
        <button class="btn" id="md-cancel-off">Abbrechen</button>
        <button class="btn btn-primary" id="md-ok-off">Übernehmen</button>
      `,
    });
    const inputEl = document.getElementById("md-offset-input");
    const feedback = document.getElementById("md-offset-feedback");
    const okBtn = document.getElementById("md-ok-off");
    function validate() {
      const txt = inputEl.value;
      const parsed = parseTimeOffset(txt);
      if (parsed == null) {
        feedback.textContent = t("geotagger.offset.modal_invalid");
        feedback.style.color = "var(--danger, #ef4444)";
        okBtn.disabled = true;
        return null;
      }
      if (Math.abs(parsed) > 86400) {
        feedback.textContent = t("geotagger.offset.modal_out_of_range").replace("{val}", fmtSeconds(parsed));
        feedback.style.color = "var(--danger, #ef4444)";
        okBtn.disabled = true;
        return null;
      }
      feedback.textContent = `→ ${fmtSeconds(parsed)}  (${parsed} s)`;
      feedback.style.color = "var(--text-muted, #999)";
      okBtn.disabled = false;
      return parsed;
    }
    inputEl.addEventListener("input", validate);
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); okBtn.click(); }
    });
    setTimeout(() => { inputEl.select(); validate(); }, 50);
    document.getElementById("md-cancel-off").onclick = () => openModal({}).close();
    okBtn.onclick = () => {
      const v = validate();
      if (v == null) return;
      // v0.9.177 — Zeitzone übernehmen + persistieren
      const tzSel = document.getElementById("md-offset-tz");
      if (tzSel) {
        tzOffsetMin = parseInt(tzSel.value) || 0;
        saveSettings({ geotagger: { tz_offset_minutes: tzOffsetMin } });
      }
      setOffsetFromSeconds(v);
      updateOffsetDisplay();
      updateMatches();
      openModal({}).close();
    };
  });

  bindSetting("gt-backup", "geotagger", "make_backup", { type: "bool" });
  bindSetting("gt-overwrite", "geotagger", "overwrite_existing", { type: "bool" });
  bindSetting("gt-adjust-time", "geotagger", "adjust_photo_time", { type: "bool" });
  bindSetting("gt-set-time-from-track", "geotagger", "set_time_from_track", { type: "bool" });
  // v0.9.67: Undo-Listener auf #gt-panel
  _wireGeotaggerUndoListeners();

  whenApiReady().then(async () => {
    const made = createMap({
      container: "map-canvas",
      mapboxStyle: "mapbox://styles/mapbox/outdoors-v12",
      common: { center: [10, 51], zoom: 4 },
    });
    map = made.map;
    map.addControl(new made.lib.NavigationControl(), "top-right");
    // v0.8.4: onMapReady ist robust gegen Race-Conditions — falls Mapbox
    // den Style schon geladen hat BEVOR der Listener registriert wird.
    onMapReady(map, () => {
      applog("info", "[Geotagger onMapReady cb] running");
      map.addSource("gt-track", { type: "geojson", data: { type: "Feature", geometry: { type: "LineString", coordinates: [] } } });
      map.addLayer({ id: "gt-track-glow", type: "line", source: "gt-track",
        paint: { "line-color": "#ff6b35", "line-width": 7, "line-opacity": 0.4, "line-blur": 3 } });
      map.addLayer({ id: "gt-track-line", type: "line", source: "gt-track",
        paint: { "line-color": "#ff6b35", "line-width": 2.5, "line-opacity": 0.95 } });
      // Initial-Apply wenn schon ein globales GPX geladen ist
      if (typeof getGlobalGpxPath === "function") {
        const curPath = getGlobalGpxPath();
        if (curPath) loadGpxByPath(curPath);
      }
      // v0.9.29 (Marc-Bug-Report): Map-Pose-Restore raus — kollidiert mit
      // fitBounds nach showTrack. Nur Selection (selectedPath, referencePath)
      // wiederherstellen, das ist UI-state der nicht mit Map-Animationen
      // konkurriert.
      try {
        const cache = window.__rzgpsModuleCache && window.__rzgpsModuleCache.geotagger;
        if (cache && Date.now() - cache.ts < 60 * 60 * 1000) {
          setTimeout(() => {
            if (isUnmounted) return;
            try {
              if (cache.referencePath) referencePath = cache.referencePath;
              if (cache.selectedPath && photos.find(p => p.path === cache.selectedPath)) {
                selectPhoto(cache.selectedPath);
              }
            } catch (_) {}
          }, 900);
        }
      } catch (_) {}
    });
    map.on("click", onMapClick);
  });

  // Close-Button für Preview-Panel
  document.getElementById("gt-preview-close").addEventListener("click", hidePhotoPopup);

  // Initial-Render: Empty State sichtbar machen
  renderPhotoGrid();

  // v0.9.30 (Marc-Entscheidung): State-Restore NUR für Tab-Wechsel via
  // Backend-Memory. NICHT mehr für App-Restart aus Settings. Foto-Laden ist
  // ein bewusster Workflow-Schritt — beim App-Neustart will der User meistens
  // frisch anfangen, nicht 200 RAW-Files neu einlesen lassen.
  // Recursive-Checkbox-State bleibt persistent (kostet nix).
  (async () => {
    try {
      const gt = (_settingsCache && _settingsCache.geotagger) || {};
      const recCb = document.getElementById("gt-folder-recursive");
      if (recCb && gt.folder_recursive) recCb.checked = true;

      // 200 ms warten damit der mount-Code (whenApiReady, map-Init etc.) durch ist
      await new Promise(r => setTimeout(r, 200));

      // Tab-Wechsel-Fall: Backend hat `_gtg_photos` noch im Memory mit Thumbs
      if (isUnmounted) return;
      const st = await api().geotagger_get_state();
      if (isUnmounted) return;
      if (st && st.ok && st.has_state && Array.isArray(st.photos) && st.photos.length) {
        photos = st.photos;
        renderPhotoGrid();
        setLabel("gt-photos-info", `${photos.length} Fotos (gecacht)`);
        // Match neu rechnen falls GPX da ist
        if (typeof getGlobalGpxPath === "function") {
          const gpxPath = getGlobalGpxPath();
          if (gpxPath) {
            currentGpxPath = gpxPath;
            setTimeout(updateMatches, 300);
          }
        }
        // Wenn Thumb-Worker noch läuft → pollen damit fehlende Thumbs nachkommen
        if (st.thumb_progress && st.thumb_progress.running) {
          pollThumbs(new Set(photos.filter(p => p.thumb).map(p => p.path)));
        }
      }
    } catch (err) {
      console.warn("Geotagger State-Restore failed:", err);
    }
  })();

  // ── Handler ──────────────────────────────────────────────────────────────

  function setLabel(id, text) {
    const el = document.getElementById(id);
    if (!el) return;
    if (text) { el.textContent = text; el.hidden = false; }
    else      { el.textContent = ""; el.hidden = true; }
  }

  async function loadGpxByPath(path) {
    if (isUnmounted) return;
    const res = await api().geotagger_load_gpx(path);
    if (isUnmounted) return;
    if (!res.ok) {
      if (window.isMissingFileError && window.isMissingFileError(res.error)) window.showSourceMissingBanner(path);
      else toast(res.error, "error");
      return;
    }
    if (window.hideSourceMissingBanner) window.hideSourceMissingBanner();
    currentGpxPath = path;
    _gtUpdateSnapAvail();             // v0.9.166 — Snap-Toggle aktivieren (Track da)
    setLabel("gt-gpx-path", path.split("/").slice(-1)[0]);
    // v0.8.0: Session aktivieren — gleiche Settings wie in Animator/Tour-Map
    if (typeof sessionActivate === "function" && res.coords) {
      try {
        await sessionActivate(res.coords, path);
        if (typeof rebindAllSettings === "function") rebindAllSettings();
      } catch (err) { console.warn("sessionActivate (geotagger):", err); }
    }
    // v0.8.5: Mapbox's isStyleLoaded() ist direkt nach `load`-Event
    // unzuverlässig (Source-Tiles noch am laden). addSource/setData
    // funktionieren ab style.json-Load. Wir nutzen onMapReady (robust
    // gegen den Race) und rufen showTrack direkt — wenn map noch nicht
    // existiert (sollte nur beim allerersten Mount passieren), warten
    // wir via setInterval.
    if (!map) {
      const wait = setInterval(() => {
        if (map) {
          clearInterval(wait);
          if (typeof onMapReady === "function") onMapReady(map, () => showTrack(res));
          else showTrack(res);
        }
      }, 100);
    } else {
      if (typeof onMapReady === "function") onMapReady(map, () => showTrack(res));
      else showTrack(res);
    }
    updateMatches();
    toast("GPX geladen: " + res.name, "success", 2500);
  }

  // v0.8.1: GPX-Picker ist global in der Sub-Top-Bar.
  // v0.9.31: GPX-Clear (z.B. via „Session schließen" oder ✕-Button im
  // GPX-Picker) räumt jetzt den kompletten Geotagger-Frontend-State —
  // Fotos, Matches, Marker, Track-Layer — sodass die App optisch sofort
  // leer ist. Backend-Cleanup (Thumb-Worker stoppen) macht
  // `api.geotagger_clear()` — wird vom close_session-Handler vorher gerufen.
  if (typeof onGpxLoaded === "function") {
    onGpxLoaded(({ path }) => {
      if (path) loadGpxByPath(path);
      else {
        // Session geschlossen / GPX entfernt — kompletten State räumen
        stopThumbPolling();
        photos = [];
        matches = [];
        selectedPath = null;
        referencePath = null;
        refMode = false;
        currentGpxPath = null;
        try { markers.forEach(m => { try { m.remove(); } catch (_) {} }); } catch (_) {}
        markers = [];
        // Track-Layer von der Karte runter
        if (map) {
          try {
            const src = map.getSource("gt-track");
            if (src) src.setData({ type: "Feature", geometry: { type: "LineString", coordinates: [] } });
          } catch (_) {}
        }
        // UI-Reset
        try {
          const gpxLbl = document.getElementById("gt-gpx-path");
          if (gpxLbl) gpxLbl.hidden = true;
        } catch (_) {}
        try {
          const phInfo = document.getElementById("gt-photos-info");
          if (phInfo) { phInfo.hidden = true; phInfo.textContent = ""; }
          const summary = document.getElementById("gt-summary");
          if (summary) { summary.style.display = "none"; summary.innerHTML = ""; }
          const writeBtn = document.getElementById("gt-write");
          if (writeBtn) writeBtn.disabled = true;
        } catch (_) {}
        hideGridLoader();
        renderPhotoGrid();  // Empty State wieder zeigen
      }
    });
  }
  // v0.8.4: Initial-Apply läuft jetzt im onMapReady-Callback oben
  // (zusammen mit Track-Layer-Setup) — robust gegen Race-Conditions.

  function showTrack(res) {
    if (isUnmounted || !map) return;          // v0.9.29
    // v0.8.5: defensive — wenn gt-track source noch nicht da ist (Race),
    // legen wir sie an (zusammen mit den Layern). Sonst skip + warn.
    if (!map.getSource("gt-track")) {
      applog && applog("warn", "[Geotagger showTrack] gt-track source missing — recreating");
      try {
        map.addSource("gt-track", { type: "geojson", data: { type: "Feature", geometry: { type: "LineString", coordinates: [] } } });
        if (!map.getLayer("gt-track-glow")) {
          map.addLayer({ id: "gt-track-glow", type: "line", source: "gt-track",
            paint: { "line-color": "#ff6b35", "line-width": 7, "line-opacity": 0.4, "line-blur": 3 } });
        }
        if (!map.getLayer("gt-track-line")) {
          map.addLayer({ id: "gt-track-line", type: "line", source: "gt-track",
            paint: { "line-color": "#ff6b35", "line-width": 2.5, "line-opacity": 0.95 } });
        }
      } catch (err) {
        applog && applog("error", "[Geotagger showTrack] addSource fail: " + err);
        return;
      }
    }
    map.getSource("gt-track").setData({
      type: "Feature", geometry: { type: "LineString", coordinates: res.coords }
    });
    const b = res.bbox;
    map.fitBounds([[b.min_lon, b.min_lat], [b.max_lon, b.max_lat]], { padding: 80, duration: 600 });
  }

  document.getElementById("gt-pick-photos").addEventListener("click", async () => {
    // pywebview file_types: jeder Filter ist eine Option im Picker-Popup-Menü
    const filters = [
      "Medien (*.jpg;*.jpeg;*.cr3;*.cr2;*.nef;*.arw;*.raf;*.orf;*.dng;*.heic;*.mp4;*.mov;*.m4v;*.insv;*.insp)",
      "Fotos (*.jpg;*.jpeg;*.cr3;*.cr2;*.nef;*.arw;*.raf;*.orf;*.dng;*.heic)",
      "Videos (*.mp4;*.mov;*.m4v;*.insv;*.insp;*.mts)",
      "JPEG (*.jpg;*.jpeg)",
      "RAW (*.cr3;*.cr2;*.nef;*.arw;*.raf;*.orf;*.dng)",
    ];
    const files = await api().pick_file("open", filters, true);
    if (!files || !files.length) return;
    // v0.9.27 (Nutzer-Feedback): Foto-Pfade persistieren damit Modul-Wechsel
    // + App-Restart sie wiederherstellen kann
    saveSettings({ geotagger: { last_photos_paths: files, last_photos_dir: "" } });
    await loadPhotos(files);
  });

  document.getElementById("gt-pick-folder").addEventListener("click", async () => {
    const folders = await api().pick_file("folder");
    if (!folders || !folders.length) return;
    const folder = folders[0];
    const recursive = document.getElementById("gt-folder-recursive").checked;
    // v0.9.27 (Nutzer-Feedback): Ordner + Rekursiv-State persistieren
    saveSettings({ geotagger: { last_photos_dir: folder, last_photos_paths: [], folder_recursive: recursive } });
    stopThumbPolling();
    const res = await api().geotagger_load_photos_from_folder(folder, recursive);
    if (!res.ok) { toast(res.error, "error"); return; }
    photos = _gtMergeRegistered(res.photos);   // v0.9.176 — ergänzen statt ersetzen
    renderPhotoGrid();
    setLabel("gt-photos-info", countLabel(photos, recursive ? "aus Ordner + Unterordner" : "aus Ordner"));
    if (res.warning) toast(res.warning, "warn", 6000);
    showGridLoader(0, photos.length);
    pollThumbs(new Set());
    // v0.9.27 (Nutzer-Feedback): GPX-Auto-Detect anbieten — nur wenn aktuell
    // KEIN GPX geladen ist (sonst würde es das vom User aktiv geladene
    // einfach überschreiben, was nervig wäre)
    if (!currentGpxPath && photos.length > 0) {
      offerNearbyGpx(folder);
    }
  });

  /** v0.9.27 (Nutzer-Feedback): findet GPX-Dateien in der Nähe des
   *  Foto-Ordners und bietet dem User an, eine davon zu laden. */
  async function offerNearbyGpx(folder) {
    try {
      const res = await api().geotagger_find_gpx_near(folder);
      if (!res.ok || !res.matches || !res.matches.length) return;
      const matches = res.matches;
      if (matches.length === 1) {
        // Genau ein Treffer → kompakter Toast mit Ja/Nein-Buttons via Modal
        const m = matches[0];
        const sizeKb = (m.size / 1024).toFixed(0);
        openModal({
          title: t("geotagger.gpx_nearby.title_single"),
          body: `
            <p>${t("geotagger.gpx_nearby.body_single")}</p>
            <div class="modal-stat-row"><span class="label">${t("geotagger.gpx_nearby.col_file")}</span><span class="val mono">${m.name}</span></div>
            <div class="modal-stat-row"><span class="label">${t("geotagger.gpx_nearby.col_path")}</span><span class="val muted mono" style="font-size:11px; word-break:break-all;">${m.path}</span></div>
            <div class="modal-stat-row"><span class="label">${t("geotagger.gpx_nearby.col_size")}</span><span class="val">${sizeKb} KB</span></div>
          `,
          footer: `
            <button class="btn" id="md-nogpx">${t("geotagger.gpx_nearby.no")}</button>
            <button class="btn btn-primary" id="md-yesgpx">${t("geotagger.gpx_nearby.yes_single")}</button>
          `,
        });
        document.getElementById("md-nogpx").onclick = () => openModal({}).close();
        document.getElementById("md-yesgpx").onclick = async () => {
          openModal({}).close();
          await loadGpxByPath(m.path);
        };
      } else {
        // Mehrere Treffer → Auswahl-Modal
        const rows = matches.map((m, i) => {
          const sizeKb = (m.size / 1024).toFixed(0);
          const when = new Date(m.mtime * 1000).toLocaleDateString("de-DE", {
            year: "numeric", month: "short", day: "numeric",
          });
          const parent = m.path.split("/").slice(-2, -1)[0];
          return `
            <label class="modal-gpx-pick-row">
              <input type="radio" name="md-gpx" value="${i}" ${i === 0 ? "checked" : ""}>
              <div class="modal-gpx-pick-info">
                <div class="modal-gpx-pick-name">${m.name}</div>
                <div class="modal-gpx-pick-meta">📂 ${parent} · 📅 ${when} · ${sizeKb} KB</div>
              </div>
            </label>
          `;
        }).join("");
        openModal({
          title: t("geotagger.gpx_nearby.title_multi").replace("{n}", matches.length),
          body: `
            <p class="muted">${t("geotagger.gpx_nearby.body_multi")}</p>
            <div class="modal-gpx-pick-list">${rows}</div>
          `,
          footer: `
            <button class="btn" id="md-nogpx">${t("geotagger.gpx_nearby.no")}</button>
            <button class="btn btn-primary" id="md-yesgpx">${t("geotagger.gpx_nearby.yes_multi")}</button>
          `,
        });
        document.getElementById("md-nogpx").onclick = () => openModal({}).close();
        document.getElementById("md-yesgpx").onclick = async () => {
          const sel = document.querySelector('input[name="md-gpx"]:checked');
          if (!sel) return;
          const m = matches[parseInt(sel.value)];
          openModal({}).close();
          await loadGpxByPath(m.path);
        };
      }
    } catch (err) {
      console.warn("offerNearbyGpx:", err);
    }
  }

  let thumbPollTimer = null;
  function stopThumbPolling() {
    if (thumbPollTimer) { clearTimeout(thumbPollTimer); thumbPollTimer = null; }
  }
  // v0.9.25 — beim App-Close (pagehide) Polling sofort stoppen, sonst hängt
  // ein in-flight `geotagger_poll_thumbs()` die Bridge.
  if (typeof onAppClose === "function") onAppClose(() => stopThumbPolling());

  async function loadPhotos(files) {
    stopThumbPolling();
    // Phase 1: schnelle Registrierung (path + name + is_raw/is_video)
    const res = await api().geotagger_register_photos(files);
    if (!res.ok) { toast(res.error, "error"); return; }
    photos = _gtMergeRegistered(res.photos);   // v0.9.176 — ergänzen statt ersetzen
    renderPhotoGrid();
    setLabel("gt-photos-info", countLabel(photos, "registriert"));
    if (res.warning) toast(res.warning, "warn", 6000);
    showGridLoader(0, photos.length);
    pollThumbs(new Set());
  }

  function countLabel(photos, verb) {
    const n_raw = photos.filter(p => p.is_raw).length;
    const n_vid = photos.filter(p => p.is_video).length;
    const n_jpg = photos.length - n_raw - n_vid;
    const parts = [];
    if (n_jpg) parts.push(`${n_jpg} JPG`);
    if (n_raw) parts.push(`${n_raw} RAW`);
    if (n_vid) parts.push(`${n_vid} Video${n_vid > 1 ? "s" : ""}`);
    return `${photos.length} Medien ${verb}${parts.length ? " (" + parts.join(" + ") + ")" : ""}`;
  }

  async function pollThumbs(known) {
    // v0.9.25 — Hard-Stop wenn Window am Schließen: KEIN weiterer Bridge-Call.
    if (window.__rzgpsShuttingDown) { stopThumbPolling(); return; }
    // v0.9.29 — Modul wurde inzwischen unmounted (Tab gewechselt) → stop.
    if (isUnmounted) { stopThumbPolling(); return; }
    try {
      const res = await api().geotagger_poll_thumbs(Array.from(known));
      if (isUnmounted) { stopThumbPolling(); return; }
      if (!res.ok) { stopThumbPolling(); return; }
      // Deltas in photo-state einarbeiten + Tiles updaten
      const deltas = res.deltas || {};
      let touched = 0;
      for (const [path, data] of Object.entries(deltas)) {
        const ph = photos.find(p => p.path === path);
        if (!ph) continue;
        ph.thumb = data.thumb;
        ph.photo_time = data.photo_time;
        ph.existing_gps = data.existing_gps;
        ph.camera = data.camera || null;   // v0.9.164 — Kamera-Modell
        updateTileForPath(path);
        known.add(path);
        touched++;
      }
      const prog = res.progress || { total: 0, done: 0, running: false };
      showGridLoader(prog.done, prog.total, "Lade Thumbnails");

      // Match neu berechnen wenn neue EXIF-Zeiten reingekommen sind
      if (touched > 0 && currentGpxPath) {
        updateMatches();
      }

      if (window.__rzgpsShuttingDown) { stopThumbPolling(); return; }
      if (prog.running || (prog.total > 0 && prog.done < prog.total)) {
        thumbPollTimer = setTimeout(() => pollThumbs(known), 250);
      } else {
        // Fertig
        hideGridLoader();
        if (prog.total > 0) {
          toast(`${prog.done} Fotos geladen`, "success", 2500);
        }
      }
    } catch (err) {
      console.error("pollThumbs", err);
      stopThumbPolling();
    }
  }

  function showGridLoader(done, total, label) {
    const el = document.getElementById("gt-grid-loader");
    if (!el) return;
    el.classList.add("show");
    const pct = total > 0 ? (done / total) * 100 : 0;
    el.querySelector(".photo-grid-loader-text").textContent =
      `${label || "Lade Thumbnails"}: ${done} / ${total}`;
    el.querySelector(".photo-grid-loader-fill").style.width = pct.toFixed(1) + "%";
  }
  function hideGridLoader() {
    const el = document.getElementById("gt-grid-loader");
    if (el) el.classList.remove("show");
  }

  function updateTileForPath(path) {
    const tile = document.querySelector(`.photo-tile[data-path="${CSS.escape(path)}"]`);
    if (!tile) return;
    const ph = photos.find(p => p.path === path);
    if (!ph) return;
    if (ph.thumb) {
      tile.classList.remove("skeleton");
      const img = tile.querySelector(".photo-thumb img");
      if (img) img.src = ph.thumb;
    }
  }

  function renderPhotoGrid() {
    const grid = document.getElementById("gt-photos");
    grid.innerHTML = "";

    // Wenn noch keine Fotos: Empty State mit Dummy-Tiles + Hint
    if (!photos.length) {
      const empty = el("div", { class: "photo-grid-empty" });
      empty.innerHTML = `
        <div class="photo-grid-empty-hint">
          <div class="photo-grid-empty-icon">📷</div>
          <div class="photo-grid-empty-title">${t("geotagger.empty.title")}</div>
          <div class="photo-grid-empty-text">${t("geotagger.empty.text")}</div>
        </div>
      `;
      grid.appendChild(empty);
      // 8 graue Dummy-Tiles als Vorschau-Platzhalter
      for (let i = 0; i < 8; i++) {
        const ph = el("div", { class: "photo-tile photo-tile-placeholder" });
        ph.innerHTML = `
          <div class="photo-thumb"><span class="ph-placeholder-icon">+</span></div>
          <div class="ph-name">—</div>
        `;
        grid.appendChild(ph);
      }
      return;
    }

    // Loader-Header
    const loader = el("div", { class: "photo-grid-loader", id: "gt-grid-loader" });
    loader.innerHTML = `
      <div class="photo-grid-loader-text">Lade Thumbnails …</div>
      <div class="photo-grid-loader-bar"><div class="photo-grid-loader-fill"></div></div>
    `;
    grid.appendChild(loader);
    // Tiles (v0.9.163: optionaler Übersicht-Filter)
    let _gtShown = 0;
    photos.forEach((p, i) => {
      if (!_gtPhotoInFilter(p)) return;
      _gtShown++;
      const isSkel = !p.thumb;
      const isUploading = !!p._uploading;
      const isError = !!p._error;
      const cls = "photo-tile"
            + (isSkel ? " skeleton" : "")
            + (isUploading ? " uploading" : "")
            + (isError ? " error" : "")
            + (p.path && p.path === referencePath ? " reference" : "")
            + (p.path && p.path === selectedPath ? " selected" : "")
            + (p.path && !_gtPhotoChecked(p) ? " gt-unchecked" : "");  // v0.9.164
      const tile = el("div", {
        class: cls,
        "data-path": p.path || ("pending:" + i),
        "data-pending-idx": p._pending ? String(i) : "",
      });
      // Thumb-Wrapper: hat feste Höhe (CSS), reserviert Platz auch ohne src
      const thumbWrap = el("div", { class: "photo-thumb" });
      const img = el("img", { src: p.thumb || "", alt: p.name, loading: "lazy" });
      thumbWrap.appendChild(img);
      // Video-Badge mit Play-Icon
      if (p.is_video) {
        thumbWrap.appendChild(el("div", { class: "tile-video-badge", title: "Video" }, "▶"));
      }
      // Wenn beim Drop noch hochgeladen wird: Status-Marker im Thumb-Bereich
      if (isUploading) {
        thumbWrap.appendChild(el("div", { class: "tile-upload-indicator" }, "↑"));
      }
      const badge = el("div", { class: "badge" });
      thumbWrap.appendChild(badge);
      // v0.9.164 — Tag-Checkbox (default an) + Entfernen-✕ (nur echte Fotos)
      if (p.path) {
        const chk = el("input", { type: "checkbox", class: "gt-tag-check",
          title: t("geotagger.tagcheck.title", "Wird getaggt (Häkchen aus = nicht taggen)") });
        chk.checked = _gtPhotoChecked(p);
        chk.addEventListener("click", ev => ev.stopPropagation());
        chk.addEventListener("change", () => {
          _gtToggleChecked(p.path);
          tile.classList.toggle("gt-unchecked", !chk.checked);
        });
        thumbWrap.appendChild(chk);
        const rm = el("button", { type: "button", class: "gt-remove-btn",
          title: t("geotagger.remove.title", "Aus Liste entfernen") }, "✕");
        rm.addEventListener("click", ev => { ev.stopPropagation(); _gtRemovePhoto(p.path); });
        thumbWrap.appendChild(rm);
        // v0.9.232 (Nutzer-Wunsch): manuell platziertes Foto wieder per
        // Aufnahmezeit auf den Track syncen — ohne löschen/neu importieren.
        // Nur sichtbar wenn das Foto aktuell manuell platziert ist.
        if (_gtManual.has(p.path)) {
          const rs = el("button", { type: "button", class: "gt-resync-btn",
            title: t("geotagger.resync.title", "Wieder per Aufnahmezeit auf den Track synchronisieren") }, "↺");
          rs.addEventListener("click", ev => { ev.stopPropagation(); _gtResyncPhoto(p.path); });
          thumbWrap.appendChild(rs);
        }
        // v0.9.165 — Klartext-Hinweis INS BILD (statt Tooltip, der vom ✕-Hover
        // verdeckt wird) für nicht taggbare Fotos. Text wird in updateBadges gesetzt.
        thumbWrap.appendChild(el("div", { class: "gt-untag-note" }));
      }
      tile.appendChild(thumbWrap);
      // Dateiname-Strip drunter — immer sichtbar, auch im Skelett
      tile.appendChild(el("div", { class: "ph-name", title: p.name }, p.name));
      if (p.path) tile.addEventListener("click", () => selectPhoto(p.path));
      grid.appendChild(tile);
    });
    // v0.9.163 — Hinweis wenn ein aktiver Filter nichts übrig lässt.
    if (_gtFilter && _gtShown === 0) {
      grid.appendChild(el("div", { class: "gt-filter-empty" },
        t("geotagger.filter.empty", "Keine Fotos in dieser Kategorie.")));
    }
    // v0.9.165 — Badges + Häkchen-Sichtbarkeit + Ausgrauen direkt setzen
    // (auch nach Filter-Wechsel, wo updateMatches nicht läuft).
    try { updateBadges(); } catch (_) {}
  }

  function selectPhoto(path) {
    selectedPath = path;
    document.querySelectorAll(".photo-tile").forEach(t => {
      t.classList.toggle("selected", t.dataset.path === path);
    });
    // v0.9.27 (Nutzer-Feedback): selektierter Marker nach VORN bringen.
    // Mapbox malt Marker in DOM-Order — bei dichten Cluster-Pins ist der
    // selektierte Marker sonst unter anderen verdeckt.
    markers.forEach(mk => {
      const el = mk.getElement();
      if (mk._path === path) {
        el.classList.add("selected");
        // Element ans Ende vom parent → wird zuletzt gemalt = obenauf
        try {
          if (el.parentNode) el.parentNode.appendChild(el);
        } catch (_) {}
      } else {
        el.classList.remove("selected");
      }
    });
    // Foto-Tile in den sichtbaren Bereich scrollen
    const tile = document.querySelector(`.photo-tile[data-path="${CSS.escape(path)}"]`);
    if (tile && tile.scrollIntoView) {
      tile.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    // Karten-Fokus + Popup mit Foto-Preview
    const m = matches.find(x => x.path === path);
    // v0.9.165 — Karte NUR bewegen wenn das Foto wirklich im Track-Zeitfenster
    // liegt (in_range). Bei „außerhalb der Track-Zeit" zeigt m.lat den
    // NÄCHSTGELEGENEN Punkt (= meist Track-Start) — dorthin zu fliegen wäre
    // irreführend, also Karte stehen lassen.
    if (m && m.lat != null && m.in_range && map) {
      map.flyTo({ center: [m.lon, m.lat], zoom: Math.max(map.getZoom(), 13), duration: 600 });
    }
    if (m) showPhotoPopup(m);
    // Im Referenz-Modus den Banner mit dem neuen Foto-Namen updaten
    if (refMode) updateBanner();
  }

  function showPhotoPopup(m) {
    const ph = photos.find(p => p.path === m.path);
    if (!ph) return;
    const panel = document.getElementById("gt-preview");
    const img = document.getElementById("gt-preview-img");
    const nameEl = document.getElementById("gt-preview-name");
    const metaEl = document.getElementById("gt-preview-meta");
    if (!panel || !img || !nameEl || !metaEl) return;

    img.src = ph.thumb || "";
    nameEl.innerHTML = ph.name +
      (m.path === referencePath ? ' <span class="ref-pin">🎯 Referenz</span>' : '');

    const bits = [];
    if (m.photo_time) {
      const dt = new Date(m.photo_time);
      bits.push(dt.toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" }));
    }
    if (m.lat != null) {
      bits.push(`<span class="coord">${m.lat.toFixed(5)}, ${m.lon.toFixed(5)}</span>`);
    }
    metaEl.innerHTML = bits.join("<br>");

    panel.classList.add("show");
  }

  function hidePhotoPopup() {
    const panel = document.getElementById("gt-preview");
    if (panel) panel.classList.remove("show");
  }

  function updateBanner() {
    const banner = document.getElementById("gt-banner");
    banner.classList.toggle("show", refMode);
    if (refMode && selectedPath) {
      const ph = photos.find(p => p.path === selectedPath);
      banner.innerHTML = t("geotagger.banner.ref_mode", { name: ph ? ph.name : "" });
    } else {
      banner.textContent = t("geotagger.banner.ref_mode_generic");
    }
  }

  document.getElementById("gt-ref-mode").addEventListener("click", () => {
    refMode = !refMode;
    document.getElementById("gt-ref-mode").classList.toggle("btn-primary", refMode);
    updateBanner();
    if (refMode && !selectedPath && photos.length) {
      toast(t("geotagger.toast.select_photo_first"), "warn");
    }
  });

  // v0.9.163 — delegierter Klick-Handler für die „zeigen"/Reset-Buttons der
  // Übersicht (innerHTML wird neu gesetzt, daher Delegation statt direkter
  // Listener). EINMAL gebunden beim Mount.
  document.getElementById("gt-summary")?.addEventListener("click", (ev) => {
    const fb = ev.target.closest("[data-gtfilter]");
    if (fb) { ev.preventDefault(); _gtSetFilter(fb.getAttribute("data-gtfilter")); return; }
    const cb = ev.target.closest("[data-gtcam]");   // v0.9.164 — Kamera-Filter
    if (cb) { ev.preventDefault(); _gtSetCamFilter(cb.getAttribute("data-gtcam")); return; }
  });

  // v0.9.164 — Backspace/Delete entfernt das gerade selektierte Foto aus der
  // Liste (wenn der Fokus NICHT in einem Eingabefeld liegt).
  document.addEventListener("keydown", (ev) => {
    if (isUnmounted) return;
    if (ev.key !== "Backspace" && ev.key !== "Delete") return;
    if (!selectedPath) return;
    const ae = document.activeElement;
    const tag = ae && ae.tagName ? ae.tagName.toLowerCase() : "";
    if (tag === "input" || tag === "textarea" || (ae && ae.isContentEditable)) return;
    ev.preventDefault();
    _gtRemovePhoto(selectedPath);
  });

  async function onMapClick(e) {
    // Referenz-Modus: Klick setzt den Zeit-Offset (bestehendes Verhalten)
    if (refMode) {
      if (!selectedPath) { toast(t("geotagger.toast.select_photo"), "warn"); return; }
      const { lng, lat } = e.lngLat;
      const res = await api().geotagger_compute_offset_from_reference(selectedPath, lat, lng);
      if (!res.ok) { toast(res.error, "error"); return; }
      setOffsetFromSeconds(res.offset_seconds);
      referencePath = selectedPath;     // dieses Foto bleibt markiert als Referenz
      refMode = false;
      document.getElementById("gt-ref-mode").classList.remove("btn-primary");
      updateBanner();
      // Tile-Highlight aktualisieren
      document.querySelectorAll(".photo-tile").forEach(t => {
        t.classList.toggle("reference", t.dataset.path === referencePath);
      });
      toast(t("geotagger.toast.offset_set", { human: res.human }), "success");
      updateMatches();
      return;
    }
    // v0.9.163 — Sonst: Klick auf den Track → Punkt-Info (GPS/Höhe/Datum/Zeit)
    await _gtShowTrackInfoAt(e);
  }

  // v0.9.163 — Track-Punkt-Info bei Klick auf die Track-Linie.
  async function _gtShowTrackInfoAt(e) {
    if (!map || isUnmounted) return;
    // Nur reagieren wenn wirklich auf die Track-Linie geklickt wurde.
    let onTrack = false;
    try {
      const hits = map.queryRenderedFeatures(e.point, { layers: ["gt-track-line", "gt-track-glow"] });
      onTrack = !!(hits && hits.length);
    } catch (_) { onTrack = false; }
    if (!onTrack) { _gtHideTrackPopup(); return; }
    const { lng, lat } = e.lngLat;
    let res;
    try { res = await api().geotagger_track_point_at(lng, lat); } catch (_) { return; }
    if (!res || !res.ok) return;
    _gtShowTrackPopup(res);
  }

  function _gtFmtTrackTime(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return { local: String(iso), utc: "", tz: "" };
    const p = n => String(n).padStart(2, "0");
    const fmt = (dd, mm, yy, h, mi, s) => `${p(dd)}.${p(mm)}.${yy} ${p(h)}:${p(mi)}:${p(s)}`;
    let tz = "";
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (_) {}
    return {
      // Systemzeitzone (lokal) + UTC (GPX-Standard)
      local: fmt(d.getDate(), d.getMonth() + 1, d.getFullYear(), d.getHours(), d.getMinutes(), d.getSeconds()),
      utc:   fmt(d.getUTCDate(), d.getUTCMonth() + 1, d.getUTCFullYear(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()),
      tz,
    };
  }

  function _gtShowTrackPopup(res) {
    if (isUnmounted || !map) return;
    let Lib;
    try { Lib = mapLib(); } catch (_) { return; }
    if (!Lib || !Lib.Popup) return;
    _gtHideTrackPopup();
    const ft = _gtFmtTrackTime(res.time);
    const eleLine = (res.ele != null)
      ? `<div class="gt-tp-row"><span class="gt-tp-k">${t("geotagger.track_info.ele", "Höhe")}</span><span class="gt-tp-v">${Math.round(res.ele)} m</span></div>`
      : "";
    // v0.9.163 — Zeit in UTC (GPX-Standard) UND System-Zeitzone (lokal) anzeigen.
    let timeRows = "";
    if (ft && ft.utc) {
      const localLbl = ft.tz
        ? `${t("geotagger.track_info.local", "Lokal")} (${ft.tz})`
        : t("geotagger.track_info.local", "Lokal");
      timeRows = `
        <div class="gt-tp-row"><span class="gt-tp-k">${localLbl}</span><span class="gt-tp-v">${ft.local}</span></div>
        <div class="gt-tp-row"><span class="gt-tp-k">UTC</span><span class="gt-tp-v">${ft.utc}</span></div>`;
    } else {
      timeRows = `<div class="gt-tp-row"><span class="gt-tp-k">${t("geotagger.track_info.time", "Zeit")}</span><span class="gt-tp-v">—</span></div>`;
    }
    const html = `
      <div class="gt-track-popup">
        <div class="gt-tp-title">📍 ${t("geotagger.track_info.title", "Track-Punkt")}</div>
        <div class="gt-tp-row"><span class="gt-tp-k">${t("geotagger.track_info.coords", "GPS")}</span><span class="gt-tp-v">${res.lat.toFixed(6)}, ${res.lon.toFixed(6)}</span></div>
        ${eleLine}
        ${timeRows}
      </div>`;
    try {
      _gtTrackPopup = new Lib.Popup({ closeButton: true, closeOnClick: true, maxWidth: "280px" })
        .setLngLat([res.lon, res.lat])
        .setHTML(html)
        .addTo(map);
    } catch (_) { _gtTrackPopup = null; }
  }

  function _gtHideTrackPopup() {
    try { if (_gtTrackPopup) _gtTrackPopup.remove(); } catch (_) {}
    _gtTrackPopup = null;
  }

  function redrawMarkers() {
    markers.forEach(m => { try { m.remove(); } catch (_) {} });
    markers = [];
    // v0.9.29: dreifache Sicherung gegen zerstörten Map.
    // 1) Unmount-Flag, 2) map-Variable null, 3) map.getCanvasContainer-Check
    // (mapbox-Internals; wenn die Map removed wurde, ist getCanvasContainer undefined)
    if (isUnmounted || !map) return;
    try {
      if (typeof map.getCanvasContainer !== "function" || !map.getCanvasContainer()) return;
    } catch (_) { return; }
    matches.forEach(m => {
      if (m.lat == null || m.lon == null) return;
      const isManual = !!m.manual;               // v0.9.166 — manuell platziert
      const eltMarker = document.createElement("div");
      let cls = "photo-marker";
      if (m.existing_gps) cls += " existing";
      if (isManual) cls += " manual";
      if (m.path === referencePath) cls += " reference";
      if (m.path === selectedPath) cls += " selected";
      eltMarker.className = cls;
      eltMarker.title = isManual
        ? (m.name || "") + " — " + t("geotagger.place.marker_title", "manuell gesetzt (ziehen zum Korrigieren)")
        : (m.name || "");
      eltMarker.addEventListener("click", ev => { ev.stopPropagation(); selectPhoto(m.path); });
      try {
        const mk = new (mapLib().Marker)({ element: eltMarker, anchor: "center", draggable: isManual })
          .setLngLat([m.lon, m.lat])
          .addTo(map);
        mk._path = m.path;
        // v0.9.166 — manuelle Pins lassen sich zum Feinjustieren ziehen.
        // ⌘/Toggle entscheidet, ob beim Loslassen auf den Track eingerastet wird.
        if (isManual) mk.on("dragend", () => _gtOnMarkerDragEnd(m.path, mk));
        markers.push(mk);
      } catch (err) {
        // Map kann zwischen Check und addTo zerstört worden sein (Tab-Wechsel-Race)
        console.warn("redrawMarkers: marker add failed", err);
      }
    });
  }

  // ── v0.9.166 — Fotos manuell auf der Karte platzieren ───────────────────
  // Marc-Feature: Fotos ohne brauchbare Aufnahmezeit (z.B. Export-Datum, daher
  // „außerhalb der Track-Zeit") per Drag aus der Liste auf die Karte ziehen.
  // Die Koordinaten werden dann ganz normal in die EXIF-Tags geschrieben.
  // Frei platzieren ODER auf den Track einrasten (Toggle + ⌘ als Umkehr).
  // Ohne geladenen Track → immer frei.

  function _gtHasTrack() { return !!currentGpxPath; }

  // Toggle bestimmt den Default, ⌘ kehrt ihn temporär um.
  function _gtSnapWanted(metaKey) {
    return metaKey ? !_gtSnapToTrack : _gtSnapToTrack;
  }

  function _gtUpdateSnapAvail() {
    const cb = document.getElementById("gt-snap-track");
    if (!cb) return;
    const has = _gtHasTrack();
    cb.disabled = !has;
    const row = cb.closest(".checkbox-row");
    if (row) row.style.opacity = has ? "" : "0.45";
    const hint = document.getElementById("gt-snap-cmd-hint");
    if (hint) {
      hint.textContent = has
        ? t("geotagger.place.cmd_hint", "⌘ beim Ablegen kehrt das kurz um.")
        : t("geotagger.place.no_track", "Kein Track geladen — Fotos werden frei platziert.");
    }
  }

  // Manuelle Platzierungen in die matches-Liste mischen (nach jedem Backend-Match
  // neu, weil matches dann frisch ersetzt wird).
  function _gtMergeManual() {
    if (!_gtManual.size) return;
    _gtManual.forEach((pos, path) => {
      const ph = photos.find(p => p.path === path);
      if (!ph) return;                       // Foto nicht mehr geladen
      let m = matches.find(x => x.path === path);
      if (!m) { m = { path, name: ph.name, photo_time: ph.photo_time || null }; matches.push(m); }
      m.lat = pos.lat;
      m.lon = pos.lon;
      m.alt = (pos.alt != null ? pos.alt : null);
      m.in_range = true;                     // manuell gesetzt = gilt als taggbar
      m.manual = true;
      m.existing_gps = !!ph.existing_gps;
      // v0.9.281 — beim Einrasten gefundene Track-Zeit mitnehmen (GPS-Zeitstempel +
      // optional „Aufnahmezeit aus Track"). Bei freier Platzierung ohne Snap: null.
      if (pos.track_time) m.matched_time_utc = pos.track_time;
    });
  }

  // Ein Foto an lng/lat setzen. snap=true → vorher nächsten Track-Punkt suchen.
  async function _gtPlacePhoto(path, lat, lon, snap) {
    const ph = photos.find(p => p.path === path);
    if (!ph) return;
    let alt = null;
    let trackTime = null;
    if (snap && _gtHasTrack()) {
      try {
        const res = await api().geotagger_track_point_at(lon, lat);
        if (res && res.ok) {
          lat = res.lat; lon = res.lon;
          if (res.ele != null) alt = res.ele;   // Track-Höhe gleich mitnehmen
          if (res.time) trackTime = res.time;    // v0.9.281 — Track-Zeit für „Aufnahmezeit aus Track"
        }
      } catch (_) {}
    }
    if (isUnmounted) return;
    _gtManual.set(path, { lat, lon, alt, track_time: trackTime });
    selectedPath = path;
    _gtMergeManual();
    _gtRefreshAfterManual();
    toast(t("geotagger.place.done", { name: ph.name }), "success", 1500);
  }

  async function _gtOnMarkerDragEnd(path, mk) {
    if (isUnmounted) return;
    let ll;
    try { ll = mk.getLngLat(); } catch (_) { return; }
    let lat = ll.lat, lon = ll.lng, alt = null, trackTime = null;
    if (_gtSnapWanted(_gtMetaDown) && _gtHasTrack()) {
      try {
        const res = await api().geotagger_track_point_at(lon, lat);
        if (res && res.ok) { lat = res.lat; lon = res.lon; if (res.ele != null) alt = res.ele; if (res.time) trackTime = res.time; }
      } catch (_) {}
    } else {
      const prev = _gtManual.get(path);
      alt = prev ? prev.alt : null;            // bisherige Höhe behalten
      trackTime = prev ? (prev.track_time || null) : null;
    }
    if (isUnmounted) return;
    _gtManual.set(path, { lat, lon, alt, track_time: trackTime });
    _gtMergeManual();
    _gtRefreshAfterManual();
  }

  function _gtRefreshAfterManual() {
    try { redrawMarkers(); } catch (_) {}
    try { updateBadges(); } catch (_) {}
    try { updateSummary(); } catch (_) {}
    // v0.9.232 — Liste neu rendern, damit der ↺-„wieder syncen"-Button am jetzt
    // manuell platzierten Foto erscheint (Tile-Render liest `_gtManual`).
    try { renderPhotoGrid(); } catch (_) {}
    document.querySelectorAll(".photo-tile").forEach(tl => {
      tl.classList.toggle("selected", tl.dataset.path === selectedPath);
    });
    const writeBtn = document.getElementById("gt-write");
    if (writeBtn) {
      writeBtn.disabled = !matches.some(m => m.lat != null && m.in_range && _gtMatchTaggable(m));
    }
  }

  // Pixel-Event → LngLat auf der Karte (null wenn außerhalb der Karte).
  function _gtMapPointFromEvent(e) {
    if (!map || isUnmounted) return null;
    let cont;
    try { cont = map.getContainer(); } catch (_) { return null; }
    if (!cont) return null;
    const r = cont.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (x < 0 || y < 0 || x > r.width || y > r.height) return null;
    try { return map.unproject([x, y]); } catch (_) { return null; }
  }

  function _gtMakeDragGhost(ph) {
    const g = el("div", { class: "gt-drag-ghost" });
    if (ph && ph.thumb) g.appendChild(el("img", { src: ph.thumb, alt: "" }));
    g.appendChild(el("div", { class: "gt-drag-ghost-name" }, ph ? ph.name : ""));
    document.body.appendChild(g);
    return g;
  }

  function _gtUpdateDragHint(e) {
    const hint = document.getElementById("gt-place-hint");
    if (!hint) return;
    const over = !!_gtMapPointFromEvent(e);
    if (!over) { hint.classList.remove("show"); return; }
    const snap = _gtSnapWanted(e.metaKey) && _gtHasTrack();
    hint.textContent = snap
      ? t("geotagger.place.hint_snap", "Auf Track einrasten — loslassen zum Setzen")
      : t("geotagger.place.hint_free", "Frei platzieren — loslassen zum Setzen");
    hint.classList.toggle("snap", snap);
    hint.classList.add("show");
  }

  function _gtClearDragHint() {
    const hint = document.getElementById("gt-place-hint");
    if (hint) hint.classList.remove("show");
  }

  // Pointer-basiertes Drag aus der Foto-Liste (robuster als HTML5-DnD in der
  // WKWebView + freie Kontrolle über ⌘-Status). Delegiert auf #gt-photos.
  function _gtInitManualDrag() {
    const grid = document.getElementById("gt-photos");
    if (!grid || grid.dataset.manualDrag === "1") return;
    grid.dataset.manualDrag = "1";
    grid.addEventListener("mousedown", (ev) => {
      if (ev.button !== 0) return;
      if (ev.target.closest(".gt-tag-check, .gt-remove-btn, .gt-resync-btn")) return;  // Checkbox/✕/↺ frei lassen
      const tile = ev.target.closest(".photo-tile");
      if (!tile) return;
      const path = tile.dataset.path;
      if (!path || path.startsWith("pending:")) return;
      const ph = photos.find(p => p.path === path);
      const startX = ev.clientX, startY = ev.clientY;
      let ghost = null, dragging = false;

      const onMove = (e) => {
        if (!dragging) {
          if (Math.hypot(e.clientX - startX, e.clientY - startY) < 6) return;
          dragging = true;
          ghost = _gtMakeDragGhost(ph);
          document.body.classList.add("gt-dragging");
        }
        _gtMetaDown = e.metaKey;
        if (ghost) { ghost.style.left = e.clientX + "px"; ghost.style.top = e.clientY + "px"; }
        _gtUpdateDragHint(e);
      };
      const onUp = (e) => {
        document.removeEventListener("mousemove", onMove, true);
        document.removeEventListener("mouseup", onUp, true);
        document.body.classList.remove("gt-dragging");
        if (ghost) { try { ghost.remove(); } catch (_) {} }
        _gtClearDragHint();
        if (!dragging) return;                 // war nur ein Klick → onclick=selectPhoto
        const pt = _gtMapPointFromEvent(e);
        if (!pt) return;                        // außerhalb der Karte → abbrechen
        _gtPlacePhoto(path, pt.lat, pt.lng, _gtSnapWanted(e.metaKey));
      };
      document.addEventListener("mousemove", onMove, true);
      document.addEventListener("mouseup", onUp, true);
    });
  }

  function updateBadges() {
    // v0.9.165-fix — Parameter heißt `tile` (NICHT `t`), sonst überschattet er
    // die i18n-Funktion t() → „t is not a function" bei den Badge-Tooltips.
    document.querySelectorAll(".photo-tile").forEach(tile => {
      const m = matches.find(x => x.path === tile.dataset.path);
      const b = tile.querySelector(".badge");
      const chk = tile.querySelector(".gt-tag-check");
      b.className = "badge";
      b.title = "";
      // v0.9.165 — taggbar NUR wenn gematcht UND in Track-Zeit. Sonst: Häkchen
      // ausblenden (kann eh nicht getaggt werden) + Kachel ausgrauen. Das !/?-
      // Badge oben (mit Tooltip) erklärt, warum.
      const taggable = !!(m && m.lat != null && m.in_range);
      if (chk) chk.style.display = taggable ? "" : "none";
      tile.classList.toggle("gt-untaggable", !!(m && !taggable));
      // v0.9.165 — Klartext-Hinweis direkt ins Bild (statt Tooltip, der vom
      // ✕-Hover verdeckt wird). Leer = unsichtbar (CSS :empty).
      const note = tile.querySelector(".gt-untag-note");
      if (note) note.textContent = "";
      if (!m) { b.textContent = ""; return; }
      if (m.existing_gps && m.lat == null) {
        b.classList.add("existing"); b.textContent = "✓";
        b.title = t("geotagger.badge.existing", "Hat bereits GPS-Daten");
        if (note) note.textContent = t("geotagger.note.existing", "Hat schon GPS");
      } else if (m.lat != null && m.in_range) {
        b.classList.add("tagged"); b.textContent = "●";
        b.title = t("geotagger.badge.tagged", "Wird getaggt");
      } else if (m.lat != null && !m.in_range) {
        b.classList.add("error"); b.textContent = "!";
        b.title = t("geotagger.badge.oor", "Außerhalb der Track-Zeit — für diese Aufnahmezeit gibt es keinen Punkt im Track");
        if (note) note.textContent = t("geotagger.note.oor", "Außerhalb der Track-Zeit");
      } else {
        b.classList.add("error"); b.textContent = "?";
        b.title = t("geotagger.badge.notime", "Keine brauchbare Aufnahmezeit (EXIF) — kann nicht zugeordnet werden");
        if (note) note.textContent = t("geotagger.note.notime", "Keine Aufnahmezeit");
      }
    });
  }

  function updateSummary() {
    const ok = matches.filter(m => m.lat != null && m.in_range).length;
    const oor = matches.filter(m => m.lat != null && !m.in_range).length;
    const skip = matches.filter(m => m.lat == null).length;
    const existing = matches.filter(m => m.existing_gps).length;
    const sum = document.getElementById("gt-summary");
    sum.style.display = "block";
    // v0.9.163 — „zeigen"-Button je Kategorie filtert die Foto-Liste.
    const showLbl = t("geotagger.filter.show", "zeigen");
    const btn = (key, count) => count
      ? ` <button type="button" class="gt-filter-btn${_gtFilter === key ? " active" : ""}" data-gtfilter="${key}">${showLbl}</button>`
      : "";
    // v0.9.164 — Kamera-Sektion: distinkte Kameras aus den geladenen Fotos.
    const camCounts = new Map();
    for (const p of photos) {
      if (!p || !p.path) continue;
      const c = _gtPhotoCamera(p);
      camCounts.set(c, (camCounts.get(c) || 0) + 1);
    }
    let camBlock = "";
    if (camCounts.size >= 2) {
      const rows = [...camCounts.entries()].sort((a, b) => b[1] - a[1]).map(([cam, n]) => {
        const label = (cam === _GT_CAM_UNKNOWN) ? t("geotagger.filter.cam_unknown", "Unbekannt") : cam;
        return `<span class="gt-sum-line gt-cam-line">📷 ${_gtEsc(label)} <span class="muted">(${n})</span>`
          + ` <button type="button" class="gt-filter-btn${_gtCamFilter === cam ? " active" : ""}" data-gtcam="${_gtEsc(cam)}">${showLbl}</button></span><br>`;
      }).join("");
      camBlock = `<div class="gt-cam-section"><div class="gt-cam-head">${t("geotagger.summary.cameras", "Kameras")}:</div>${rows}</div>`;
    }
    const resetBtn = (_gtFilter || _gtCamFilter)
      ? `<div class="gt-filter-reset-wrap"><button type="button" class="gt-filter-reset" data-gtfilter="reset">✕ ${t("geotagger.filter.reset", "Filter zurücksetzen")}</button></div>`
      : "";
    // v0.9.163 — bestehende i18n-Keys (mit {n}-Platzhalter) verwenden.
    sum.innerHTML = `
      <strong>${t("geotagger.summary.title", "Übersicht:")}</strong><br>
      <span class="gt-sum-line"><span class="ok">●</span> ${t("geotagger.summary.tagged", { n: ok })}${btn("tagged", ok)}</span><br>
      ${oor ? `<span class="gt-sum-line"><span class="warn">!</span> ${t("geotagger.summary.out_of_range", { n: oor })}${btn("oor", oor)}</span><br>` : ""}
      ${skip ? `<span class="gt-sum-line"><span class="err">?</span> ${t("geotagger.summary.no_exif_time", { n: skip })}${btn("notime", skip)}</span><br>` : ""}
      ${existing ? `<span class="gt-sum-line" style="color:var(--text-muted)">⌃ ${t("geotagger.summary.existing", { n: existing })}${btn("hasgps", existing)}</span>` : ""}
      ${camBlock}
      ${resetBtn}
    `;
  }

  // v0.9.163/164 — ist ein Foto unter den aktiven Filtern (Kategorie + Kamera)
  // SICHTBAR? Beide Filter wirken UND-verknüpft.
  const _GT_CAM_UNKNOWN = "—";
  function _gtEsc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => (
      {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
  }
  function _gtPhotoCamera(p) { return (p && p.camera) ? p.camera : _GT_CAM_UNKNOWN; }
  function _gtPhotoInFilter(p) {
    if (!p) return false;
    // Kamera-Filter (v0.9.164)
    if (_gtCamFilter && _gtPhotoCamera(p) !== _gtCamFilter) return false;
    // Kategorie-Filter (v0.9.163)
    if (_gtFilter) {
      if (!p.path) return false;            // Pending/Upload-Tiles nur ohne Filter
      const m = matches.find(mm => mm.path === p.path);
      if (!m) return false;
      switch (_gtFilter) {
        case "tagged": return m.lat != null && m.in_range;
        case "oor":    return m.lat != null && !m.in_range;
        case "notime": return m.lat == null;
        case "hasgps": return !!m.existing_gps;
        default:       return true;
      }
    }
    return true;
  }

  // v0.9.164 — Häkchen je Foto (default AN = wird getaggt, außer aktiv abgewählt)
  function _gtPhotoChecked(p) { return !!(p && p.path && !_gtUnchecked.has(p.path)); }
  function _gtToggleChecked(path) {
    if (!path) return;
    if (_gtUnchecked.has(path)) _gtUnchecked.delete(path);
    else _gtUnchecked.add(path);
    updateSummary();
  }

  function _gtSetFilter(key) {
    if (key === "reset") { _gtFilter = null; _gtCamFilter = null; }
    else _gtFilter = (_gtFilter === key) ? null : key;
    renderPhotoGrid();
    updateSummary();
  }

  function _gtSetCamFilter(cam) {
    _gtCamFilter = (_gtCamFilter === cam) ? null : cam;
    renderPhotoGrid();
    updateSummary();
  }

  // v0.9.232 (Nutzer-Wunsch): manuelle Platzierung aufheben → Foto wird wieder
  // per Aufnahmezeit gegen den Track gematcht (wie frisch importiert), OHNE es
  // zu löschen und neu reinzuholen. Nur für aktuell manuell platzierte Fotos.
  function _gtResyncPhoto(path) {
    if (!path || !_gtManual.has(path)) return;
    _gtManual.delete(path);
    // Sofortiges Feedback bis der debounced Re-Match durch ist:
    const m = matches.find(x => x.path === path);
    if (m) m.manual = false;
    updateMatches();        // re-match per Aufnahmezeit (greift jetzt ohne diesen Pin)
    renderPhotoGrid();      // ↺-Button verschwindet (nicht mehr manuell)
    if (!currentGpxPath) {
      toast(t("geotagger.resync.no_track", "Kein Track geladen — Foto bleibt vorerst ohne Position."), "warn", 3500);
    }
  }

  // v0.9.164 — Foto aus der Liste entfernen (✕ / Backspace). Ändert NICHTS an
  // der Datei, nimmt sie nur aus Liste/Match/Karte raus.
  async function _gtRemovePhoto(path) {
    if (!path) return;
    try { await api().geotagger_remove_photos([path]); } catch (_) {}
    photos = photos.filter(p => p.path !== path);
    matches = matches.filter(m => m.path !== path);
    _gtUnchecked.delete(path);
    _gtManual.delete(path);            // v0.9.166 — manuelle Platzierung mit entfernen
    if (selectedPath === path) { selectedPath = null; hidePhotoPopup(); }
    if (referencePath === path) referencePath = null;
    try { redrawMarkers(); } catch (_) {}
    renderPhotoGrid();
    updateSummary();
  }

  // v0.9.155: Workspace-Clear läuft zentral über das rote ✕ in der GPX-Bar
  // (window.clearWorkspaceGlobal). Modul registriert nur seine Reset-Logik:
  // GPX-Track, alle Fotos, Match-Daten, Karten-Marker + Backend-State werden
  // entfernt. Settings (Offset, Backup-Toggle, Aufnahmezeit-Adjust etc.)
  // bleiben unverändert. DOM-Zugriffe guarded für den nicht-gemounteten Fall.
  async function _gtClearWorkspace() {
    // 1) Backend-State leeren
    try { await api().geotagger_clear(); } catch (_) {}
    // 2) Frontend-State leeren
    photos = [];
    matches = [];
    selectedPath = null;
    referencePath = null;
    refMode = false;
    currentGpxPath = null;
    _gtFilter = null;          // v0.9.163 — Übersicht-Filter zurücksetzen
    _gtCamFilter = null;       // v0.9.164 — Kamera-Filter zurücksetzen
    _gtUnchecked.clear();      // v0.9.164 — Tag-Auswahl zurücksetzen
    _gtManual.clear();         // v0.9.166 — manuelle Platzierungen zurücksetzen
    _gtHideTrackPopup();       // v0.9.163 — Track-Klick-Popup schließen
    // v0.9.27 (Nutzer-Feedback): persistierten Foto-State auch leeren
    try { saveSettings({ geotagger: { last_photos_dir: "", last_photos_paths: [] } }); } catch (_) {}
    // 3) Marker von der Karte entfernen
    try {
      markers.forEach(m => { try { m.remove(); } catch (_) {} });
    } catch (_) {}
    markers = [];
    // 4) Track-Layer raus
    if (map) {
      try {
        if (map.getLayer("gtg-track")) map.removeLayer("gtg-track");
        if (map.getLayer("gtg-track-glow")) map.removeLayer("gtg-track-glow");
        if (map.getSource("gtg-track")) map.removeSource("gtg-track");
      } catch (_) {}
      try { map.flyTo({ center: [10, 51], zoom: 4, duration: 500 }); } catch (_) {}
    }
    // 5) UI-Labels + Buttons zurücksetzen
    try {
      const gpxLbl = document.getElementById("gt-gpx-path");
      if (gpxLbl) { gpxLbl.hidden = true; gpxLbl.textContent = ""; }
      const phInfo = document.getElementById("gt-photos-info");
      if (phInfo) { phInfo.hidden = true; phInfo.textContent = ""; }
      const summary = document.getElementById("gt-summary");
      if (summary) { summary.style.display = "none"; summary.innerHTML = ""; }
      const writeBtn = document.getElementById("gt-write");
      if (writeBtn) writeBtn.disabled = true;
      // 6) Foto-Grid neu rendern (jetzt leer)
      renderPhotoGrid();
    } catch (_) {}
  }
  if (typeof registerWorkspaceResetter === "function") registerWorkspaceResetter(_gtClearWorkspace);

  // v0.9.164 — nur taggen, was SICHTBAR (Filter) UND ANGEHAKT ist (Marc-Wunsch).
  // v0.9.166 — manuell platzierte Fotos sind IMMER taggbar (sofern angehakt):
  // das Platzieren ist die explizite Tagging-Absicht, ein Kategorie-Filter darf
  // sie nicht mehr rauswerfen (sie sind z.B. nicht mehr „außerhalb Track-Zeit").
  function _gtMatchTaggable(m) {
    const p = photos.find(pp => pp.path === m.path);
    if (!p) return false;
    if (!_gtPhotoChecked(p)) return false;
    if (m && m.manual) return true;
    return _gtPhotoInFilter(p);
  }

  document.getElementById("gt-write").addEventListener("click", async () => {
    const writable = matches.filter(m => m.lat != null && m.in_range && _gtMatchTaggable(m));
    if (!writable.length) { toast(t("geotagger.toast.nothing_to_write"), "warn"); return; }

    const overwrite = document.getElementById("gt-overwrite").checked;
    const backup = document.getElementById("gt-backup").checked;
    const adjustTime = document.getElementById("gt-adjust-time").checked;
    const setTimeFromTrack = !!(document.getElementById("gt-set-time-from-track") || {}).checked;
    const offsetSec = getOffsetSeconds();

    // Wie viele werden übersprungen (haben schon GPS)?
    const withExisting = writable.filter(m => m.existing_gps).length;
    const toWrite = overwrite ? writable.length : writable.length - withExisting;

    // Backup-Pfad lookup für Anzeige
    const paths = await api().get_paths();

    // Bestätigungs-Modal
    const offsetTxt = fmtSeconds(offsetSec);
    const timeAdjustBlock = (adjustTime && offsetSec !== 0)
      ? `<div class="modal-stat-row"><span class="label">⏰ Foto-Aufnahmezeit anpassen</span><span class="val" style="color:var(--warn)">${toWrite} × ${offsetTxt}</span></div>`
      : '';
    const summary = `
      <div class="modal-stat-row"><span class="label">Erkannte Fotos im Track</span><span class="val">${writable.length}</span></div>
      <div class="modal-stat-row"><span class="label">Davon mit bereits gesetztem GPS</span><span class="val">${withExisting}</span></div>
      <div class="modal-stat-row"><span class="label">Werden ${overwrite ? 'überschrieben' : 'übersprungen'}</span><span class="val ${overwrite ? '' : 'muted'}">${withExisting}</span></div>
      <div class="modal-stat-row"><span class="label"><strong>Werden getaggt</strong></span><span class="val" style="color:var(--accent)">${toWrite}</span></div>
      ${timeAdjustBlock}
      ${backup ? `
        <p class="muted" style="margin-top:14px">📦 Backup-ZIP wird angelegt unter:</p>
        <div class="mono" style="font-size:11px; padding:6px 10px; background:var(--bg-3); border-radius:6px; word-break:break-all; color:var(--text-dim);">${paths.backups_photos}</div>
      ` : '<p style="margin-top:14px; color:var(--warn)">⚠️ Kein Backup wird angelegt!</p>'}
    `;

    if (toWrite === 0) {
      toast(t("geotagger.toast.all_have_gps"), "warn", 6000);
      return;
    }

    openModal({
      title: "Schreibvorgang starten?",
      body: summary,
      footer: `
        <button class="btn" id="modal-cancel">Abbrechen</button>
        <button class="btn btn-primary" id="modal-ok">Schreiben starten</button>
      `,
    });
    document.getElementById("modal-cancel").onclick = () => {
      openModal({ closable: true }).close();
    };
    document.getElementById("modal-ok").onclick = async () => {
      runWriteWithProgress(writable, backup, overwrite, adjustTime, offsetSec, setTimeFromTrack);
    };
  });

  async function runWriteWithProgress(writable, backup, overwrite, adjustTime, offsetSec, setTimeFromTrack) {
    const res = await api().geotagger_start_write(
      writable, backup, overwrite, adjustTime, offsetSec, !!setTimeFromTrack
    );
    if (!res.ok) {
      openModal({ title: "Fehler", body: `<p>${res.error}</p>`,
        footer: '<button class="btn btn-primary" id="md-x">OK</button>' });
      document.getElementById("md-x").onclick = () => openModal({}).close();
      return;
    }
    // Progress-Modal
    let canceled = false;
    const m = openModal({
      title: "GPS wird geschrieben …",
      body: `
        <div class="modal-current-file" id="md-current">Vorbereitung …</div>
        <div class="modal-progress">
          <div class="modal-progress-bar"><div class="modal-progress-fill" id="md-fill"></div></div>
          <div class="modal-progress-text">
            <span id="md-counter">0 / ${res.total}</span>
            <span id="md-pct">0%</span>
          </div>
        </div>
        ${res.skipped_existing ? `<p class="muted">${res.skipped_existing} Fotos mit bereits vorhandenem GPS werden übersprungen.</p>` : ''}
      `,
      footer: '<button class="btn btn-danger" id="md-cancel">Abbrechen</button>',
      closable: false,
    });
    document.getElementById("md-cancel").onclick = async () => {
      canceled = true;
      await api().geotagger_write_cancel();
      document.getElementById("md-cancel").disabled = true;
      document.getElementById("md-cancel").textContent = "Abbrechen …";
    };

    // Polling
    const poll = async () => {
      const s = await api().geotagger_write_status();
      const pct = s.total > 0 ? (s.done / s.total) * 100 : 0;
      const cur = document.getElementById("md-current");
      const fill = document.getElementById("md-fill");
      const cnt = document.getElementById("md-counter");
      const pctEl = document.getElementById("md-pct");
      if (cur && s.current_name) cur.textContent = s.current_name;
      if (fill) fill.style.width = pct.toFixed(1) + "%";
      if (cnt) cnt.textContent = `${s.done} / ${s.total}`;
      if (pctEl) pctEl.textContent = `${pct.toFixed(0)}%`;
      if (!s.running && s.completed) {
        showWriteResultModal(s, canceled);
        return;
      }
      setTimeout(poll, 200);
    };
    poll();
  }

  function showWriteResultModal(s, canceled) {
    const errLines = (s.errors || []).slice(0, 8).map(e =>
      `<div>${e.replace(/^.*\//, '… ')}</div>`).join('');
    const errBlock = (s.errors && s.errors.length)
      ? `<div class="modal-error-list">${errLines}${s.errors.length > 8 ? `<div>+${s.errors.length - 8} weitere</div>` : ''}</div>`
      : '';
    const bk = s.backup_path
      ? `<div class="modal-stat-row"><span class="label">Backup-ZIP</span><span class="val mono">${s.backup_path.split('/').pop()}</span></div>`
      : '';

    // v0.9.152: Per Drag&Drop importierte Fotos liegen als Wegwerf-Kopien unter
    // _drops/ — die WebView liefert keinen Original-Pfad. Der GPS-Write landete
    // daher in den Kopien, NICHT in den Originalen. Damit der User die getaggten
    // Dateien trotzdem bekommt, bieten wir hier den Export in einen Zielordner an.
    const dropHint = (s.from_drops && !canceled && s.done > 0)
      ? `<div class="modal-stat-row" style="display:block;margin-top:8px;line-height:1.4">
           <span class="muted" style="font-size:12px">Diese Fotos wurden per Drag&amp;Drop importiert — die GPS-Daten
           stehen in App-internen Kopien, nicht in deinen Original-Dateien. Klick auf
           <b>„Getaggte Fotos speichern …"</b>, um die fertig getaggten Bilder in einen
           Ordner deiner Wahl zu exportieren. (Tipp: Wer Originale direkt taggen will,
           lädt sie über <b>„Ordner wählen"</b> statt per Drag&amp;Drop.)</span>
         </div>`
      : '';

    openModal({
      title: canceled ? "Abgebrochen" : "Fertig",
      body: `
        <div class="modal-stat-row"><span class="label">Fotos getaggt</span><span class="val" style="color:var(--success)">${s.done}</span></div>
        ${s.skipped ? `<div class="modal-stat-row"><span class="label">Fehler / übersprungen</span><span class="val" style="color:var(--danger)">${s.skipped}</span></div>` : ''}
        ${s.skipped_existing ? `<div class="modal-stat-row"><span class="label">Bereits getaggt (übersprungen)</span><span class="val muted">${s.skipped_existing}</span></div>` : ''}
        ${bk}
        ${errBlock}
        ${dropHint}
      `,
      footer: `
        ${(s.from_drops && !canceled && s.done > 0) ? '<button class="btn btn-primary" id="md-export">Getaggte Fotos speichern …</button>' : ''}
        ${s.backup_path ? '<button class="btn" id="md-finder">Backup im Finder</button>' : ''}
        <button class="btn ${(s.from_drops && !canceled && s.done > 0) ? '' : 'btn-primary'}" id="md-ok">OK</button>
      `,
      closable: true,
    });
    if (s.backup_path) {
      document.getElementById("md-finder").onclick = () => api().reveal_in_finder(s.backup_path);
    }
    const exportBtn = document.getElementById("md-export");
    if (exportBtn) {
      exportBtn.onclick = () => exportTaggedDrops();
    }
    document.getElementById("md-ok").onclick = () => openModal({}).close();

    // Photo-State refreshen (existing_gps ist jetzt überall gesetzt)
    if (photos.length && !canceled) {
      const paths = photos.map(p => p.path);
      api().geotagger_load_photos(paths).then(r2 => {
        if (r2.ok) { photos = r2.photos; renderPhotoGrid(); updateMatches(); }
      });
    }
  }

  // v0.9.152: Exportiert die getaggten Drag&Drop-Kopien in einen Zielordner.
  // Per Drag&Drop importierte Fotos liegen unter _drops/ (kein Original-Pfad
  // bekannt) — der GPS-Write landete in diesen Kopien. Hier kopieren wir sie
  // unter ihrem Original-Namen in einen vom User gewählten Ordner.
  async function exportTaggedDrops() {
    // Nur Drop-Fotos exportieren, die einen Match mit Koordinaten haben (also
    // tatsächlich getaggt wurden). Erkennung am _drops/-Pfad.
    const isDrop = (p) => p && p.path && /[\\/]_drops[\\/]/.test(p.path);
    const taggedNames = new Set(
      (matches || []).filter(m => m && m.lat != null && m.lon != null)
        .map(m => (m.path || "").replace(/.*[\\/]/, ""))
    );
    let items = photos.filter(p => isDrop(p) &&
      (taggedNames.size === 0 || taggedNames.has((p.path || "").replace(/.*[\\/]/, ""))))
      .map(p => ({ src: p.path, name: p.name || (p.path || "").replace(/.*[\\/]/, "") }));
    // Fallback: falls die Match-Filterung nichts ergibt, alle Drop-Fotos nehmen
    if (!items.length) {
      items = photos.filter(isDrop).map(p => ({
        src: p.path, name: p.name || (p.path || "").replace(/.*[\\/]/, ""),
      }));
    }
    if (!items.length) {
      toast("Keine getaggten Fotos zum Exportieren gefunden", "warn");
      return;
    }
    const folders = await api().pick_file("folder");
    if (!folders || !folders.length) return;  // abgebrochen
    const dest = folders[0];
    const res = await api().geotagger_export_tagged(items, dest);
    if (!res || !res.ok) {
      toast("Export fehlgeschlagen: " + ((res && res.error) || "unbekannt"), "error");
      return;
    }
    const errTxt = (res.errors && res.errors.length) ? ` (${res.errors.length} Fehler)` : "";
    toast(`${res.exported} getaggte Fotos gespeichert in ${dest.replace(/.*[\\/]/, "")}${errTxt}`,
      res.errors && res.errors.length ? "warn" : "success", 6000);
    // Modal schließen + Zielordner im Finder zeigen
    try { openModal({}).close(); } catch (e) {}
    if (res.exported > 0) api().reveal_in_finder(dest);
  }

  // ── Drag & Drop ───────────────────────────────────────────────────────

  // GPX-Drop: Karte
  // v0.9.33: nutzt jetzt `loadGlobalGpx` damit der Sub-Top-Bar-Picker oben
  // sich aktualisiert (analog zum normalen File-Pick). Vorher rief das nur
  // die lokale geotagger-Funktion → globaler State + Picker-UI blieben leer.
  // `loadGlobalGpx` triggert eh den onGpxLoaded-Listener → Geotagger lädt
  // den Track automatisch in seine Karte.
  setupDropZone({
    target: "#gt-mapdrop",
    // v0.9.282 — auch FIT/NMEA/KML/… annehmen (Backend konvertiert nach GPX)
    accept: ["gpx", "fit", "nmea", "log", "kml", "kmz", "tcx", "geojson"],
    async onDrop(files) {
      if (!files.length) return;
      if (files.length > 1) toast("Nur die erste GPX wird geladen", "warn");
      // "binary" statt "text" — FIT/KMZ sind Binärformate (base64 erhält auch GPX-Text).
      const paths = await persistDroppedFiles([files[0]], "binary");
      if (typeof loadGlobalGpx === "function") {
        await loadGlobalGpx(paths[0]);
      } else {
        await loadGpxByPath(paths[0]);  // Fallback
      }
    },
  });

  // Fotos- & Video-Drop: Foto-Grid links.
  // v0.9.32 (Marc-Feedback): GPX wird hier auch akzeptiert, damit der User
  // Fotos + Track gemeinsam reinziehen kann. Sortierung im onDrop.
  setupDropZone({
    target: "#gt-photos",
    accept: ["jpg", "jpeg", "jpe", "tif", "tiff",
             "cr3", "cr2", "crw", "nef", "nrw", "arw", "srf", "sr2",
             "raf", "rw2", "orf", "dng", "pef", "rwl", "srw",
             "heic", "heif",
             // Videos
             "mp4", "mov", "m4v", "qt", "insv", "insp",
             "mts", "m2ts", "lrv", "3gp", "avi", "mkv",
             // Track-Dateien werden hier mit erkannt — separat behandelt im onDrop.
             // v0.9.282: nicht nur GPX, sondern alle konvertierbaren Formate.
             "gpx", "fit", "nmea", "log", "kml", "kmz", "tcx", "geojson"],
    async onDrop(files) {
      // Aufteilen: Track-Files vs. Foto/Video-Files
      const gpxFiles = files.filter(f => window.TRACK_DROP_RE.test(f.relPath));
      const mediaFiles = files.filter(f => !window.TRACK_DROP_RE.test(f.relPath));

      // GPX zuerst — Match-Berechnung läuft sonst ohne Track ins Leere.
      // v0.9.33 (Marc-Feedback): `loadGlobalGpx` statt nur lokal, damit der
      // GPX-Picker-Indikator in der Sub-Top-Bar ebenfalls aktualisiert wird
      // (sonst hat der User keinen visuellen Hinweis dass ein Track aktiv ist).
      if (gpxFiles.length) {
        if (gpxFiles.length > 1) toast("Nur die erste GPX wird geladen", "warn");
        try {
          const paths = await persistDroppedFiles([gpxFiles[0]], "binary");
          if (typeof loadGlobalGpx === "function") {
            await loadGlobalGpx(paths[0]);
          } else {
            await loadGpxByPath(paths[0]);  // Fallback
          }
        } catch (err) {
          console.warn("GPX-Drop fehlgeschlagen:", err);
          toast("GPX konnte nicht geladen werden: " + (err.message || err), "error");
        }
      }
      // Dann Fotos — die nutzen direkt den geladenen Track für updateMatches
      if (mediaFiles.length) {
        await importDroppedPhotos(mediaFiles);
      }
    },
  });

  // ── Pending-Drop-Import (mit sofortigen Skelett-Tiles) ────────────────

  // v0.9.176 — registrierte Fotos in die bestehende Liste mergen (statt
  // ersetzen). Schon vorhandene Pfade behalten ihr (geladenes) Foto-Objekt
  // inkl. Thumb; neue kommen frisch dazu. Reihenfolge = Backend-Liste.
  function _gtMergeRegistered(resPhotos) {
    const byPath = new Map();
    for (const p of photos) { if (p && p.path) byPath.set(p.path, p); }
    return (resPhotos || []).map(rp => {
      const ex = byPath.get(rp.path);
      return ex ? ex : Object.assign({}, rp, { thumb: null, photo_time: null, existing_gps: null });
    });
  }

  async function importDroppedPhotos(droppedFiles) {
    if (!droppedFiles.length) return;
    stopThumbPolling();

    // ---- PHASE A: sofort lokale Pending-Tiles rendern (vor Upload!) ----
    // v0.9.176 (Nutzer-Feedback): ANHÄNGEN statt ersetzen + Dubletten (gleicher
    // Originalpfad) überspringen.
    const RAW_RX = /\.(cr3|cr2|crw|nef|nrw|arw|srf|sr2|raf|rw2|orf|dng|pef|rwl|srw|heic|heif)$/i;
    const VIDEO_RX = /\.(mp4|mov|m4v|qt|insv|insp|mts|m2ts|lrv|3gp|avi|mkv)$/i;
    const _existPaths = new Set(photos.filter(p => p.path).map(p => p.path));
    const pending = droppedFiles
      .filter(d => !(d.nativePath && _existPaths.has(d.nativePath)))
      .map(d => ({
        path: null,
        name: d.relPath.replace(/.*[\\/]/, ""),
        is_raw: RAW_RX.test(d.relPath),
        is_video: VIDEO_RX.test(d.relPath),
        thumb: null,
        photo_time: null,
        existing_gps: null,
        _pending: true,
        _uploading: true,
        _file: d.file,
        _relPath: d.relPath,
        // v0.9.153: echter Originalpfad (pywebview) — ermöglicht In-Place-Tagging
        _nativePath: d.nativePath || null,
      }));
    if (!pending.length) { return; }   // alles schon in der Liste
    photos = photos.concat(pending);   // ANHÄNGEN
    renderPhotoGrid();
    setLabel("gt-photos-info",
      `${pending.length} Foto(s) werden importiert …`);
    showGridLoader(0, pending.length, "Importiere Dateien");

    let doneCount = 0;

    // ---- PHASE B1: Dateien mit echtem Originalpfad SOFORT übernehmen ----
    // (kein Copy → Geotagging schreibt später in-place in die Originale)
    for (const ph of pending) {
      if (ph._nativePath) {
        ph.path = ph._nativePath;
        ph._uploading = false;
        doneCount++;
        updatePendingTileState(ph);
        showGridLoader(doneCount, pending.length, "Importiere Dateien");
      }
    }

    // ---- PHASE B2: Rest (ohne nativen Pfad) base64-uploaden (Fallback) ----
    const needUpload = pending.filter(p => !p._nativePath);
    if (needUpload.length) {
      const sessionRes = await api().drop_session_start();
      if (!sessionRes.ok) {
        toast("Drop-Session fehlgeschlagen", "error");
        return;
      }
      const sessionId = sessionRes.session_id;
      const queue = needUpload.slice();    // shallow copy als Work-Queue
      const concurrency = 4;
      await Promise.all(Array.from({ length: concurrency }, async () => {
        while (queue.length > 0) {
          const ph = queue.shift();
          if (!ph) break;
          try {
            const b64 = await fileToBase64(ph._file);
            const safeName = ph._relPath.replace(/[\\/]/g, "_");
            const r = await api().drop_save_file(sessionId, safeName, b64);
            if (r.ok) {
              ph.path = r.path;
              ph._uploading = false;
            } else {
              ph._error = r.error || "Upload-Fehler";
              ph._uploading = false;
            }
          } catch (e) {
            ph._error = e.message || String(e);
            ph._uploading = false;
          }
          doneCount++;
          // Tile-State sichtbar machen — kein full re-render, gezielt update
          updatePendingTileState(ph);
          showGridLoader(doneCount, pending.length, "Importiere Dateien");
        }
      }));
    }

    // ---- PHASE C: bei Backend registrieren + Lazy-Thumbs starten ----
    // Nur die NEUEN (pending) Pfade registrieren; Backend hängt sie an.
    const uploadedPaths = pending.filter(p => p.path).map(p => p.path);
    if (!uploadedPaths.length) {
      toast("Keine Datei konnte importiert werden", "error");
      hideGridLoader();
      return;
    }
    const res = await api().geotagger_register_photos(uploadedPaths);
    if (!res.ok) { toast(res.error, "error"); return; }
    if (res.warning) toast(res.warning, "warn", 6000);   // v0.9.176 — RAW/exiftool-Hinweis auch beim Drop

    // Volle Liste vom Backend mergen (bestehende Thumbs bleiben erhalten)
    photos = _gtMergeRegistered(res.photos);
    renderPhotoGrid();
    setLabel("gt-photos-info", countLabel(photos, "importiert"));
    showGridLoader(0, photos.length, "Lade Thumbnails");
    pollThumbs(new Set());
  }

  function updatePendingTileState(ph) {
    // ph wurde mutiert (path gesetzt, _uploading=false oder _error)
    // → finde das Tile und entferne uploading-Klasse, ggf. setze error
    const idx = photos.indexOf(ph);
    if (idx < 0) return;
    const tile = document.querySelectorAll(".photo-tile")[idx + 1]; // +1 wegen Loader-Header
    if (!tile) return;
    tile.classList.remove("uploading");
    if (ph._error) tile.classList.add("error");
    const ind = tile.querySelector(".tile-upload-indicator");
    if (ind) ind.remove();
  }

  // ── v0.9.166 — Manuell-Platzieren: Wiring ────────────────────────────────
  const _gtMetaKeyHandler = (e) => { _gtMetaDown = e.metaKey; };
  (function _gtWireManual() {
    const snapCb = document.getElementById("gt-snap-track");
    if (snapCb) {
      snapCb.checked = _gtSnapToTrack;
      snapCb.addEventListener("change", () => { _gtSnapToTrack = snapCb.checked; });
    }
    // ⌘-Status global verfolgen (für Marker-Drag-Snap + Live-Hint).
    window.addEventListener("keydown", _gtMetaKeyHandler, true);
    window.addEventListener("keyup", _gtMetaKeyHandler, true);
    _gtInitManualDrag();
    _gtUpdateSnapAvail();
  })();

  return () => {
    // v0.9.29: Unmount-Flag SOFORT setzen damit alle weiteren async-Callbacks
    // (debouncted updateMatches, in-flight pollThumbs, sessionActivate-Promises)
    // sauber abbrechen bevor sie auf map zugreifen.
    isUnmounted = true;
    stopThumbPolling();
    // v0.9.166 — globale ⌘-Listener wieder abräumen (sonst Leak pro Tab-Wechsel)
    try {
      window.removeEventListener("keydown", _gtMetaKeyHandler, true);
      window.removeEventListener("keyup", _gtMetaKeyHandler, true);
    } catch (_) {}
    // v0.9.28 (Marc-Feedback): nur Foto-Selection in den Cache. Die Map-Pose
    // wird NICHT mehr gecacht — beim Restore kam's nach dem fitTrackPreview
    // hinterher und hat unintendiert reingezoomt (v0.9.29 Bug-Report).
    try {
      const cache = (window.__rzgpsModuleCache = window.__rzgpsModuleCache || {});
      cache.geotagger = {
        ts: Date.now(),
        selectedPath: selectedPath,
        referencePath: referencePath,
      };
    } catch (_) {}
    markers.forEach(m => { try { m.remove(); } catch (_) {} });
    markers = [];
    if (map) { try { map.remove(); } catch (_) {} }
    map = null;
  };
}
