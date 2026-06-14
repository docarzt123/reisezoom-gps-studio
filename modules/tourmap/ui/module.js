// Reisezoom GPS Studio — Tour-Map-Modul
// Statische Karten-PNG aus GPX (für YouTube-Thumbnails, Komoot-Cover, …).
// 80% UI-Pattern vom Animator geklaut; Hauptunterschied: kein Video, ein PNG.

(window.RZGPS_MODULES = window.RZGPS_MODULES || {}).tourmap = {
  manifest: {
    slug: "tourmap",
    name: "Tour-Map",
    description: "Statische Karten-PNG",
    icon: "🗺",
    sort_order: 40,
  },
  mount: function (body, headerActions) { return mountTourmap(body, headerActions); },
};

function mountTourmap(body, headerActions) {
  // v0.8.2: Stats-Pills hier raus — die GPX-Bar zeigt die jetzt zentral.
  // Hidden Stubs damit bestehende DOM-Updates (t-dist etc.) nicht crashen.
  if (headerActions) {
    headerActions.innerHTML = `
      <div class="tmap-stats-bar" id="tmap-stats" hidden>
        <div class="tmap-stats-empty" id="tmap-stats-empty"></div>
        <div class="tmap-stats-cards" id="tmap-stats-cards" hidden>
          <span id="t-dist"></span><span id="t-time"></span><span id="t-asc"></span><span id="t-desc"></span>
        </div>
      </div>
    `;
  }

  body.innerHTML = `
    <aside class="panel" id="tmap-panel">

      <!-- Quelle -->
      <!-- v0.8.1: „Quelle"-Sektion entfernt — GPX-Picker ist jetzt
           global in der Sub-Top-Bar oben (siehe ui/js/gpx-bar.js). -->

      <!-- Karte — Stil, Terrain, Beleuchtung, Beschriftungen -->
      <section class="section" data-accordion-section="map">
        <button class="section-collapse-header" type="button">
          <span>${t("animator.section.map")}</span>
          <span class="collapse-arrow">▸</span>
        </button>
        <div class="section-collapse-body" hidden>
          <div class="field" id="tmap-style-field">
            <label class="field-label" for="tmap-style">${t("animator.field.style")}</label>
            <select id="tmap-style">
              <option value="satellite">${t("animator.style.satellite")}</option>
              <option value="satellite_streets">${t("animator.style.satellite_streets")}</option>
              <option value="outdoors">${t("animator.style.outdoors")}</option>
              <option value="streets">${t("animator.style.streets")}</option>
              <option value="light">${t("animator.style.light")}</option>
              <option value="dark">${t("animator.style.dark")}</option>
            </select>
            <div class="osm-disabled-notice" id="tmap-style-osm-notice" hidden>
              <span class="osm-disabled-title">${t("animator.style.osm_disabled_title")}</span>
              ${t("tourmap.style.osm_disabled_body")}
              <br>
              <button type="button" class="osm-disabled-cta" id="tmap-style-osm-cta">${t("animator.style.osm_disabled_cta")}</button>
            </div>
          </div>
          <label class="checkbox-row">
            <input type="checkbox" id="tmap-terrain" checked>
            <span>${t("animator.toggle.terrain")}</span>
          </label>
          <div class="field">
            <label class="field-label">${t("animator.field.exaggeration")} <span class="label-val" id="tmap-ex-v">1.5×</span></label>
            <input type="range" id="tmap-ex" min="0" max="4" step="0.1" value="1.5">
          </div>
          <div class="field">
            <label class="field-label" for="tmap-mc-light">${t("map_config.light_preset")}</label>
            <select id="tmap-mc-light">
              <option value="dawn">🌅 ${t("map_config.light.dawn")}</option>
              <option value="day" selected>☀️ ${t("map_config.light.day")}</option>
              <option value="dusk">🌇 ${t("map_config.light.dusk")}</option>
              <option value="night">🌙 ${t("map_config.light.night")}</option>
            </select>
          </div>
          <div class="field">
            <div class="sub-group-label">${t("map_config.elements")}</div>
            <label class="checkbox-row inline">
              <input type="checkbox" id="tmap-mc-places" checked>
              <span>${t("map_config.elements.places")}</span>
            </label>
            <label class="checkbox-row inline">
              <input type="checkbox" id="tmap-mc-roads" checked>
              <span>${t("map_config.elements.roads")}</span>
            </label>
            <label class="checkbox-row inline">
              <input type="checkbox" id="tmap-mc-poi" checked>
              <span>${t("map_config.elements.poi")}</span>
            </label>
            <label class="checkbox-row inline">
              <input type="checkbox" id="tmap-mc-transit" checked>
              <span>${t("map_config.elements.transit")}</span>
            </label>
            <label class="checkbox-row inline">
              <input type="checkbox" id="tmap-mc-admin" checked>
              <span>${t("map_config.elements.admin")}</span>
              <button type="button" class="field-help" data-help="tmap-admin"
                      title="${t("animator.help.show")}">?</button>
            </label>
            <div class="muted field-help-content" data-help-content="tmap-admin" hidden
                 style="font-size:11px; margin-top:2px; line-height:1.4; padding-left:24px;">
              ${t("map_config.elements.admin_hint")}
            </div>
            <div class="quick-toggle-row">
              <button type="button" class="btn btn-subtle" id="tmap-mc-all-off">${t("map_config.all_off")}</button>
              <button type="button" class="btn btn-subtle" id="tmap-mc-all-on">${t("map_config.all_on")}</button>
            </div>
          </div>
        </div>
      </section>

      <!-- Track — Farbe, Dicke, Start/End-Pins -->
      <section class="section" data-accordion-section="track">
        <button class="section-collapse-header" type="button">
          <span>${t("animator.section.track")}</span>
          <span class="collapse-arrow">▸</span>
        </button>
        <div class="section-collapse-body" hidden>
          <div class="field">
            <label class="field-label">${t("animator.field.color")} <span class="label-val" id="tmap-color-v">#ff6b35</span></label>
            <input type="color" id="tmap-color" value="#ff6b35">
          </div>
          <div class="field">
            <label class="field-label">${t("animator.field.line_width")} <span class="label-val" id="tmap-lw-v">4.5 px</span></label>
            <input type="range" id="tmap-lw" min="1" max="12" step="0.5" value="4.5">
          </div>
          <div class="field">
            <label class="field-label" for="tmap-line-style">${t("animator.field.line_style")}</label>
            <select id="tmap-line-style">
              <option value="solid" selected>${t("animator.line_style.solid")}</option>
              <option value="dashed">${t("animator.line_style.dashed")}</option>
              <option value="dotted">${t("animator.line_style.dotted")}</option>
              <option value="dashdot">${t("animator.line_style.dashdot")}</option>
              <!-- v0.8.12 — Röhre als 2D-Style (synchron Animator). -->
              <option value="tube">${t("animator.line_style.tube")}</option>
            </select>
          </div>
          <div class="field" id="tmap-line-spacing-field" hidden title="${t("animator.line_style_spacing.tooltip")}">
            <label class="field-label">${t("animator.field.line_style_spacing")} <span class="label-val" id="tmap-line-spacing-v">1.0×</span></label>
            <input type="range" id="tmap-line-spacing" min="0.5" max="5" step="0.25" value="1">
          </div>
          <label class="checkbox-row" title="${t("animator.glow.tooltip")}">
            <input type="checkbox" id="tmap-glow-enabled" checked>
            <span>${t("animator.toggle.glow")}</span>
          </label>
          <div class="field" id="tmap-glow-strength-field">
            <label class="field-label">${t("animator.field.glow_strength")} <span class="label-val" id="tmap-glow-strength-v">4 px</span></label>
            <input type="range" id="tmap-glow-strength" min="0" max="10" step="0.5" value="4">
          </div>
          <label class="checkbox-row">
            <input type="checkbox" id="tmap-pins" checked>
            <span>${t("tourmap.toggle.pins")}</span>
          </label>
        </div>
      </section>

      <!-- Overlays -->
      <section class="section" data-accordion-section="overlays">
        <button class="section-collapse-header" type="button">
          <span>${t("animator.section.overlays")}</span>
          <span class="collapse-arrow">▸</span>
        </button>
        <div class="section-collapse-body" hidden>
          <label class="checkbox-row">
            <input type="checkbox" id="tmap-overlays" checked>
            <span><strong>${t("animator.toggle.overlays")}</strong></span>
          </label>
          <div class="overlay-groups" id="tmap-overlay-groups">
            <div class="overlay-group">
              <label class="checkbox-row inline">
                <input type="checkbox" id="tmap-ov-totals" checked>
                <span>${t("animator.overlay.totals")}</span>
              </label>
              <select id="tmap-ov-totals-pos" class="pos-select">
                <option value="tl">${t("animator.pos.tl")}</option>
                <option value="tc">${t("animator.pos.tc")}</option>
                <option value="tr">${t("animator.pos.tr")}</option>
                <option value="ml">${t("animator.pos.ml")}</option>
                <option value="cc">${t("animator.pos.cc")}</option>
                <option value="mr">${t("animator.pos.mr")}</option>
                <option value="bl">${t("animator.pos.bl")}</option>
                <option value="bc">${t("animator.pos.bc")}</option>
                <option value="br">${t("animator.pos.br")}</option>
              </select>
            </div>
            <div class="overlay-group">
              <label class="checkbox-row inline">
                <input type="checkbox" id="tmap-ov-ele">
                <span>${t("animator.overlay.elevation")}</span>
              </label>
              <select id="tmap-ov-ele-pos" class="pos-select">
                <option value="bc">${t("animator.pos.bc")}</option>
                <option value="bcw">${t("animator.pos.bcw")}</option>
                <option value="tc">${t("animator.pos.tc")}</option>
                <option value="tcw">${t("animator.pos.tcw")}</option>
                <option value="tl">${t("animator.pos.tl")}</option>
                <option value="tr">${t("animator.pos.tr")}</option>
                <option value="bl">${t("animator.pos.bl")}</option>
                <option value="br">${t("animator.pos.br")}</option>
              </select>
            </div>
          </div>
        </div>
      </section>

      <!-- Kamera -->
      <section class="section" data-accordion-section="camera">
        <button class="section-collapse-header" type="button">
          <span>${t("animator.section.camera")}</span>
          <span class="collapse-arrow">▸</span>
        </button>
        <div class="section-collapse-body" hidden>
          <div class="field">
            <label class="field-label">${t("animator.field.pitch")} <span class="label-val" id="tmap-pitch-v">35°</span></label>
            <input type="range" id="tmap-pitch" min="0" max="70" step="1" value="35">
          </div>
          <div class="field">
            <label class="field-label">${t("tourmap.field.bearing")} <span class="label-val" id="tmap-bearing-v">-10°</span></label>
            <input type="range" id="tmap-bearing" min="-90" max="90" step="1" value="-10">
          </div>
          <div class="field">
            <label class="field-label">${t("tourmap.field.padding")} <span class="label-val" id="tmap-pad-v">8%</span></label>
            <input type="range" id="tmap-pad" min="0" max="25" step="1" value="8">
          </div>
        </div>
      </section>

      <!-- v0.9.74 — Foto-Pins (Phase 1). Geteilt mit Animator auf Projekt-Ebene.
           Identisches UI-Muster wie im Animator (Marc-Spiegelungs-Regel). -->
      <section class="section" data-accordion-section="photos" id="tmap-photos-section">
        <button class="section-collapse-header" type="button">
          <span>${t("tourmap.section.photos", "📷 Fotos")}</span>
          <span class="collapse-arrow">▸</span>
        </button>
        <div class="section-collapse-body" hidden>
          <div class="muted" style="font-size:11px; line-height:1.45; margin-bottom:8px;">
            ${t("photos.hint", "Fotos mit GPS-EXIF erscheinen als kleine Thumbnails auf der Karte.")}
          </div>
          <div class="tmap-photos-actions" style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px;">
            <button type="button" class="btn btn-subtle" id="tmap-photos-pick">${t("photos.pick_button", "📷 Fotos wählen")}</button>
            <button type="button" class="btn btn-subtle" id="tmap-photos-from-gtg">${t("photos.from_geotagger", "Aus Geotagger")}</button>
          </div>
          <div class="field">
            <label class="field-label">${t("photos.size", "Größe")} <span class="label-val" id="tmap-photos-size-v">48 px</span></label>
            <input type="range" id="tmap-photos-size" min="24" max="80" step="2" value="48">
          </div>
          <div class="field">
            <label class="checkbox">
              <input type="checkbox" id="tmap-photos-show" checked>
              <span>${t("photos.show", "Auf Karte anzeigen")}</span>
            </label>
          </div>
          <!-- v0.9.77 — Master-Auswahl + Pin-Counter über der Liste -->
          <div class="tmap-photos-bulk" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; font-size:11px;">
            <span class="muted" id="tmap-photos-count"></span>
            <span style="display:flex; gap:6px;">
              <button type="button" class="btn-link-sm" id="tmap-photos-select-all">${t("photos.select_all", "Alle an")}</button>
              <span class="muted">·</span>
              <button type="button" class="btn-link-sm" id="tmap-photos-select-none">${t("photos.select_none", "Alle aus")}</button>
            </span>
          </div>
          <div class="photos-list" id="tmap-photos-list"></div>
          <div class="tmap-photos-foot" style="display:flex; justify-content:flex-end; align-items:center; margin-top:8px;">
            <button type="button" class="btn btn-danger-subtle" id="tmap-photos-clear">${t("photos.clear_all", "🗑 Alle entfernen")}</button>
          </div>
        </div>
      </section>

      <!-- Bild-Einstellungen — Format/Auflösung (statt Video) -->
      <section class="section" data-accordion-section="image">
        <button class="section-collapse-header" type="button">
          <span>${t("tourmap.section.image_settings")}</span>
          <span class="collapse-arrow">▸</span>
        </button>
        <div class="section-collapse-body" hidden>
          <div class="field">
            <label class="field-label">${t("tourmap.field.preset")}</label>
            <div class="res-picker">
              <button class="res-btn" data-w="1920" data-h="1080" title="YouTube-Thumbnail 1920×1080 · 16:9">YT 16:9</button>
              <button class="res-btn" data-w="3840" data-h="2160" title="3840×2160 · 16:9">4K</button>
              <button class="res-btn" data-w="1080" data-h="1920" title="1080×1920 · 9:16 Shorts/Reels">Shorts</button>
              <button class="res-btn" data-w="1080" data-h="1080" title="1080×1080 · Instagram-Square">1:1</button>
            </div>
            <div class="row-2 res-custom">
              <input type="number" id="tmap-w" min="640" max="7680" step="2" value="1920" placeholder="${t("animator.field.width")}">
              <input type="number" id="tmap-h" min="360" max="7680" step="2" value="1080" placeholder="${t("animator.field.height")}">
            </div>
          </div>
        </div>
      </section>

      <div class="section">
        <button class="btn btn-primary btn-block" id="tmap-render" disabled>${t("tourmap.btn.render")}</button>
      </div>
    </aside>

    <section class="canvas drop-target tourmap-canvas" id="tmap-drop" data-drop-hint="${t("tourmap.dnd.hint")}">
      <!-- Aspect-Ratio-Viewport: bildet exakt die gewählte Ziel-Auflösung als
           Letterbox-Box ab. So sieht man IM Vorschau-Bereich genau, was im
           PNG landen wird (WYSIWYG). Drumrum ist schwarzer Rand. -->
      <div class="tourmap-viewport" id="tmap-viewport">
        <div id="tourmap-canvas"></div>
        <div class="overlay-preview-layer" id="tmap-overlay-preview" aria-hidden="true"></div>

        <div class="progress-overlay" id="tmap-progress">
          <div class="progress-meta">
            <div class="progress-percent" id="tmap-pct">0%</div>
            <div class="progress-bar"><div class="progress-fill" id="tmap-fill"></div></div>
            <div class="progress-status" id="tmap-status">${t("animator.status.start")}</div>
          </div>
          <button class="btn" id="tmap-cancel">⨯ ${t("animator.btn.cancel")}</button>
        </div>

        <div class="tourmap-result" id="tmap-result">
          <div class="tourmap-result-imgwrap">
            <img class="tourmap-result-img" id="tmap-result-img" alt="">
          </div>
          <div class="tourmap-result-meta" id="tmap-result-meta"></div>
          <div class="tourmap-result-buttons">
            <button class="btn" id="tmap-result-finder">${t("animator.btn.reveal")}</button>
            <button class="btn" id="tmap-result-copy">${t("tourmap.btn.copy_clipboard")}</button>
            <button class="btn btn-primary" id="tmap-result-new">${t("tourmap.btn.new")}</button>
          </div>
        </div>
      </div>

      <!-- Refit-Button schwebt unten rechts — User kann nach manuellem Panen
           wieder auf den Track-Extent springen. -->
      <button class="tourmap-refit-btn" id="tmap-refit" title="${t("tourmap.btn.refit")}">⤢</button>

      <!-- Auflösungs-Indikator-Badge (zeigt aktuelles W×H + Format-Name) -->
      <div class="tourmap-resolution-badge" id="tmap-res-badge"></div>
    </section>
  `;

  // ── Slider-Labels ────────────────────────────────────────────────────────
  const updateLabel = (id, val, suffix) => {
    const lbl = document.getElementById(id);
    if (lbl) lbl.textContent = val + suffix;
  };
  document.getElementById("tmap-pitch").addEventListener("input", e => updateLabel("tmap-pitch-v", e.target.value, "°"));
  document.getElementById("tmap-bearing").addEventListener("input", e => updateLabel("tmap-bearing-v", e.target.value, "°"));
  document.getElementById("tmap-pad").addEventListener("input", e => updateLabel("tmap-pad-v", e.target.value, "%"));
  document.getElementById("tmap-ex").addEventListener("input", e => updateLabel("tmap-ex-v", e.target.value, "×"));
  document.getElementById("tmap-lw").addEventListener("input", e => updateLabel("tmap-lw-v", parseFloat(e.target.value).toFixed(1), " px"));
  document.getElementById("tmap-color").addEventListener("input", e => updateLabel("tmap-color-v", e.target.value, ""));

  // v0.9.67: Undo-Listener auf #tmap-panel hängen (Form-Inputs → Snapshot vor Mutation).
  _wireTourmapUndoListeners();

  // ── Settings-Bindings ────────────────────────────────────────────────────
  bindSetting("tmap-style", "tourmap", "map_style");
  bindSetting("tmap-terrain", "tourmap", "enable_terrain", { type: "bool" });
  // Karten-Feinabstimmung — jetzt in Karten-Sektion integriert (v0.6.0).
  bindSetting("tmap-mc-light", "tourmap", "light_preset",
    { onChange: () => applyHideLabels() });
  bindSetting("tmap-mc-places", "tourmap", "show_place_labels",
    { type: "bool", onChange: () => applyHideLabels() });
  bindSetting("tmap-mc-roads", "tourmap", "show_road_labels",
    { type: "bool", onChange: () => applyHideLabels() });
  bindSetting("tmap-mc-poi", "tourmap", "show_poi_labels",
    { type: "bool", onChange: () => applyHideLabels() });
  bindSetting("tmap-mc-transit", "tourmap", "show_transit_labels",
    { type: "bool", onChange: () => applyHideLabels() });
  bindSetting("tmap-mc-admin", "tourmap", "show_admin_boundaries",
    { type: "bool", onChange: () => applyHideLabels() });
  // Sektion-Akkordeons (v0.6.0): alle data-accordion-section.
  if (window.setupSectionAccordions) {
    window.setupSectionAccordions("tourmap", document.getElementById("tmap-panel"));
  }
  // Quick "Alle aus" / "Alle an"
  (function setupMcQuickButtons() {
    const ids = ["tmap-mc-places","tmap-mc-roads","tmap-mc-poi","tmap-mc-transit","tmap-mc-admin"];
    const setAll = (state) => {
      ids.forEach(id => {
        const el = document.getElementById(id);
        if (el && el.checked !== state) {
          el.checked = state;
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
    };
    document.getElementById("tmap-mc-all-off")?.addEventListener("click", () => setAll(false));
    document.getElementById("tmap-mc-all-on")?.addEventListener("click", () => setAll(true));
  })();
  bindSetting("tmap-pins", "tourmap", "show_pins",
    { type: "bool", onChange: () => applyPinsVisibility() });
  bindSetting("tmap-color", "tourmap", "line_color", {
    onLoad: v => updateLabel("tmap-color-v", v, ""),
    onChange: v => updateLabel("tmap-color-v", v, ""),
  });
  bindSetting("tmap-lw", "tourmap", "line_width", { type: "number",
    onLoad: v => updateLabel("tmap-lw-v", parseFloat(v).toFixed(1), " px"),
    onChange: v => updateLabel("tmap-lw-v", parseFloat(v).toFixed(1), " px") });
  bindSetting("tmap-line-style", "tourmap", "line_style",
    { onChange: () => { applyLineStyle(); applyTrackStyle(); syncLineSpacingVisibility(); } });
  bindSetting("tmap-line-spacing", "tourmap", "line_style_spacing", { type: "number",
    onLoad: v => updateLabel("tmap-line-spacing-v", parseFloat(v).toFixed(2), "×"),
    onChange: v => { updateLabel("tmap-line-spacing-v", parseFloat(v).toFixed(2), "×"); applyLineStyle(); } });
  function syncLineSpacingVisibility() {
    const sel = document.getElementById("tmap-line-style");
    const fld = document.getElementById("tmap-line-spacing-field");
    if (!sel || !fld) return;
    // v0.8.12: solid + tube haben kein dash-Pattern → Spacing-Slider weg.
    fld.hidden = sel.value === "solid" || sel.value === "tube";
  }
  syncLineSpacingVisibility();
  // Glow (v0.6.8) — analog Animator
  bindSetting("tmap-glow-enabled", "tourmap", "glow_enabled", { type: "bool",
    onChange: () => applyGlowToLayers() });
  bindSetting("tmap-glow-strength", "tourmap", "glow_strength", { type: "number",
    onLoad: v => updateLabel("tmap-glow-strength-v", parseFloat(v).toFixed(1), " px"),
    onChange: v => {
      updateLabel("tmap-glow-strength-v", parseFloat(v).toFixed(1), " px");
      applyGlowToLayers();
    }});
  (function syncGlowUi() {
    const cb = document.getElementById("tmap-glow-enabled");
    const sl = document.getElementById("tmap-glow-strength");
    const field = document.getElementById("tmap-glow-strength-field");
    if (!cb || !sl || !field) return;
    const apply = () => {
      sl.disabled = !cb.checked;
      field.style.opacity = cb.checked ? "1" : "0.5";
    };
    cb.addEventListener("change", apply);
    apply();
  })();
  bindSetting("tmap-pitch", "tourmap", "pitch", { type: "number",
    onLoad: v => updateLabel("tmap-pitch-v", v, "°") });
  bindSetting("tmap-bearing", "tourmap", "bearing", { type: "number",
    onLoad: v => updateLabel("tmap-bearing-v", v, "°") });
  bindSetting("tmap-pad", "tourmap", "padding_pct", { type: "number",
    onLoad: v => updateLabel("tmap-pad-v", v, "%") });
  bindSetting("tmap-ex", "tourmap", "exaggeration", { type: "number",
    onLoad: v => updateLabel("tmap-ex-v", v, "×") });
  // v0.9.18 — Spiegelung Animator: onLoad/onChange auf updateResButtons()
  // koppeln, damit der Quick-Picker nach Session-Load der Eingabe folgt.
  bindSetting("tmap-w", "tourmap", "width", { type: "number",
    onLoad:   () => updateResButtons(),
    onChange: () => updateResButtons() });
  bindSetting("tmap-h", "tourmap", "height", { type: "number",
    onLoad:   () => updateResButtons(),
    onChange: () => updateResButtons() });
  bindSetting("tmap-overlays", "tourmap", "show_overlays", { type: "bool" });
  bindSetting("tmap-ov-totals", "tourmap", "overlay_totals_enabled", { type: "bool" });
  bindSetting("tmap-ov-totals-pos", "tourmap", "overlay_totals_position");
  bindSetting("tmap-ov-ele", "tourmap", "overlay_elevation_enabled", { type: "bool" });
  bindSetting("tmap-ov-ele-pos", "tourmap", "overlay_elevation_position");

  // ── Auflösungs-Preset-Buttons ────────────────────────────────────────────
  function updateResButtons() {
    const w = parseInt(document.getElementById("tmap-w").value) || 0;
    const h = parseInt(document.getElementById("tmap-h").value) || 0;
    document.querySelectorAll("#tmap-panel .res-btn[data-w]").forEach(b => {
      const match = parseInt(b.dataset.w) === w && parseInt(b.dataset.h) === h;
      b.classList.toggle("active", match);
    });
  }
  document.querySelectorAll("#tmap-panel .res-btn[data-w]").forEach(btn => {
    btn.addEventListener("click", () => {
      const w = parseInt(btn.dataset.w), h = parseInt(btn.dataset.h);
      const wEl = document.getElementById("tmap-w");
      const hEl = document.getElementById("tmap-h");
      wEl.value = String(w); hEl.value = String(h);
      wEl.dispatchEvent(new Event("input"));
      hEl.dispatchEvent(new Event("input"));
      updateResButtons();
    });
  });
  document.getElementById("tmap-w").addEventListener("input", updateResButtons);
  document.getElementById("tmap-h").addEventListener("input", updateResButtons);
  updateResButtons();

  // ── Overlay-Konfig folgt Master-Toggle ───────────────────────────────────
  function syncOverlayConfigVisibility() {
    const master = document.getElementById("tmap-overlays")?.checked ?? true;
    const groups = document.getElementById("tmap-overlay-groups");
    if (groups) groups.hidden = !master;
  }
  document.getElementById("tmap-overlays").addEventListener("change", syncOverlayConfigVisibility);
  syncOverlayConfigVisibility();

  // ── Style-OSM-Lock ───────────────────────────────────────────────────────
  // Tour-Map braucht IMMER Mapbox-Token — auch im OSM-Modus zeigen wir die
  // selbe Notice wie im Animator. (Render-Bridge blockiert dann eh.)
  (function applyOsmStyleLock() {
    const fieldEl  = document.getElementById("tmap-style-field");
    const noticeEl = document.getElementById("tmap-style-osm-notice");
    const selectEl = document.getElementById("tmap-style");
    const ctaEl    = document.getElementById("tmap-style-osm-cta");
    if (!fieldEl || !noticeEl || !selectEl || !ctaEl) return;
    if (isOsmMode()) {
      fieldEl.classList.add("is-osm-disabled");
      selectEl.disabled = true;
      noticeEl.hidden = false;
      ctaEl.addEventListener("click", () => {
        if (typeof window.openSettingsModal === "function") window.openSettingsModal();
      });
    }
  })();

  // ── Map vorbereiten ──────────────────────────────────────────────────────
  let map = null;
  let currentGpx = null;
  let currentCoords = null;
  let currentBbox = null;             // [w, s, e, n] – für refit
  let _gpxStats = null;
  let _gpxElevations = null;
  let _viewportResizeObserver = null;

  function currentLineColor() {
    return document.getElementById("tmap-color").value || "#ff6b35";
  }
  function currentLineWidth() {
    return parseFloat(document.getElementById("tmap-lw")?.value) || 4.5;
  }
  function currentRenderW() { return parseInt(document.getElementById("tmap-w").value) || 1920; }
  function currentRenderH() { return parseInt(document.getElementById("tmap-h").value) || 1080; }
  function currentPadPct()  { return parseFloat(document.getElementById("tmap-pad").value) || 8; }
  function currentPitch()   { return parseFloat(document.getElementById("tmap-pitch").value) || 35; }
  function currentBearing() { return parseFloat(document.getElementById("tmap-bearing").value) || -10; }

  /**
   * Extrahiert (minLon, minLat, maxLon, maxLat) aus dem Backend-Bbox-Format.
   * Achtung: das Backend liefert ein DICT (`{min_lat, max_lat, min_lon, max_lon}`),
   * nicht ein Array — gleiche Konvention wie im Animator.
   */
  function _bboxCorners(bbox) {
    if (!bbox) return null;
    if (Array.isArray(bbox) && bbox.length === 4) {
      // Defensive: falls jemand mal ein Array reinreicht
      return [bbox[0], bbox[1], bbox[2], bbox[3]];
    }
    if (typeof bbox === "object" && "min_lon" in bbox) {
      return [bbox.min_lon, bbox.min_lat, bbox.max_lon, bbox.max_lat];
    }
    return null;
  }

  /**
   * Fittet die Map auf den Track-Extent. WICHTIG: gleiche Formel wie im
   * Backend (`core/tourmap.py._make_html` → fitBoundsOptions.padding).
   * Sonst zeigt die Vorschau einen anderen Ausschnitt als der finale Render
   * → kein WYSIWYG.
   *
   * Formel (muss synchron mit Python sein):
   *   pad_factor = 0.05 + padding_pct/100      (5%-30% bei Slider 0-25)
   *   px_pad     = pad_factor * min(viewport-Achse)
   *
   * Mapbox-Trick: weil Preview & Render die gleiche Aspect-Ratio haben
   * (Letterbox-Viewport) UND beide den selben pad_factor benutzen, ergibt
   * sich automatisch der gleiche Zoom-Level — egal wie groß die Pixel sind.
   */
  function fitTrackToView(animated = true) {
    if (!map || !currentBbox) return;
    const c = _bboxCorners(currentBbox);
    if (!c) return;
    const [minLon, minLat, maxLon, maxLat] = c;
    // v0.9.34: laufende Animation nicht durch non-animated Refit interruptieren
    if (!animated && fitTrackToView._lastFitTs &&
        Date.now() - fitTrackToView._lastFitTs < 650) {
      return;
    }
    const padFactor = 0.05 + (currentPadPct() / 100);
    // Hier nutzen wir die Preview-Viewport-Größe, nicht die Render-Größe —
    // Mapbox-Zoom skaliert mit Viewport-Pixeln; gleiche Proportion → gleicher Zoom.
    const vp = document.getElementById("tmap-viewport");
    const vpMin = vp ? Math.min(vp.clientWidth, vp.clientHeight) : 600;
    // v0.9.30/34: Layout-Guard mit längerer Geduld (10 × 200 ms = 2 s)
    if (vpMin < 200) {
      if (!fitTrackToView._retries) fitTrackToView._retries = 0;
      if (fitTrackToView._retries < 10) {
        fitTrackToView._retries++;
        setTimeout(() => fitTrackToView(animated), 200);
      }
      return;
    }
    fitTrackToView._retries = 0;
    fitTrackToView._lastFitTs = Date.now();
    const pxPad = Math.max(2, Math.round(padFactor * vpMin));

    try {
      map.fitBounds(
        [[minLon, minLat], [maxLon, maxLat]],
        {
          padding: pxPad,
          pitch: currentPitch(),
          bearing: currentBearing(),
          duration: animated ? 450 : 0,
        }
      );
    } catch (e) {
      console.warn("fitTrackToView failed:", e);
    }
  }

  /**
   * Stellt das Viewport-Letterboxing auf die aktuelle Ziel-Auflösung ein.
   * Wird auf Mount, Resize-Observer und W/H-Change aufgerufen.
   */
  function updateViewport() {
    const wrap = document.getElementById("tmap-viewport");
    const section = document.querySelector(".tourmap-canvas");
    const badge = document.getElementById("tmap-res-badge");
    if (!wrap || !section) return;
    const rw = currentRenderW();
    const rh = currentRenderH();
    const targetAR = rw / rh;
    // Verfügbarer Platz im Canvas-Bereich (mit kleinem Rand)
    const margin = 20;
    const avW = section.clientWidth - margin * 2;
    const avH = section.clientHeight - margin * 2;
    if (avW <= 0 || avH <= 0) return;
    const availAR = avW / avH;
    let w, h;
    if (availAR > targetAR) {
      // Canvas ist breiter als Ziel → Höhe begrenzt
      h = avH;
      w = h * targetAR;
    } else {
      w = avW;
      h = w / targetAR;
    }
    wrap.style.width  = Math.round(w) + "px";
    wrap.style.height = Math.round(h) + "px";
    // Mapbox muss nach Größenänderung neu zeichnen
    if (map) {
      try { map.resize(); } catch (_) {}
    }

    // Overlay-Preview-Layer in RENDER-Pixel-Größe rendern + transform-scale
    // auf die Letterbox-Größe verkleinern. So nutzt die Preview-CSS exakt
    // die Render-Werte (font/padding/position) → identische Optik wie das PNG.
    const layer = document.getElementById("tmap-overlay-preview");
    if (layer) {
      const scale = w / rw;
      layer.style.width  = rw + "px";
      layer.style.height = rh + "px";
      layer.style.transform = `scale(${scale})`;
      layer.style.transformOrigin = "top left";
      // v0.6.3 — Overlay-Skalierung an Render-Höhe (synchron zu Backend
      // _overlay_scale() und zum CSS in module.css via --overlay-scale).
      const overlayScale = Math.max(0.5, rh / 1080);
      layer.style.setProperty("--overlay-scale", overlayScale);
    }

    // Badge updaten: "1920×1080 · 16:9"
    if (badge) {
      const ar = (() => {
        const r = rw / rh;
        if (Math.abs(r - 16/9) < 0.02) return "16:9";
        if (Math.abs(r - 9/16) < 0.02) return "9:16";
        if (Math.abs(r - 1)    < 0.02) return "1:1";
        if (Math.abs(r - 4/3)  < 0.02) return "4:3";
        if (Math.abs(r - 3/4)  < 0.02) return "3:4";
        return rw + ":" + rh;
      })();
      // v0.9.8 — Spiegelung zu Animator: Badge zeigt sich nur kurz beim Wechsel,
      // dann fadet er weg (Marc-Wunsch in Animator angeordert, hier
      // konsistent mit übernommen).
      const newText = rw + "×" + rh + "  ·  " + ar;
      if (badge.textContent !== newText) {
        badge.textContent = newText;
        badge.classList.add("is-visible");
        clearTimeout(badge._fadeTimer);
        badge._fadeTimer = setTimeout(() => {
          badge.classList.remove("is-visible");
        }, 2500);
      }
    }
  }

  function rebuildPreviewLayers() {
    if (!map) return;
    const color = currentLineColor();
    const lw = currentLineWidth();
    if (!map.getSource("preview-track")) {
      map.addSource("preview-track", {
        type: "geojson",
        data: { type: "Feature", geometry: { type: "LineString", coordinates: currentCoords || [] } },
      });
    } else if (currentCoords) {
      map.getSource("preview-track").setData({
        type: "Feature", geometry: { type: "LineString", coordinates: currentCoords },
      });
    }
    // round-caps/round-joins synchron zum Render-HTML (v0.6.5).
    const trackLayout = { "line-cap": "round", "line-join": "round" };
    // v0.8.14 — dasharray DIREKT beim Layer-Anlegen (Mapbox-GL 3.x SDF-Cache).
    const dash = currentDasharray();
    const dashPaint = dash ? { "line-dasharray": dash } : {};
    // v0.9.16 — line-z-offset (150 m) MUSS auch in der Preview gesetzt sein,
    // wenn Terrain aktiv ist. Synchron zu core/tourmap.py + Animator-Spiegelung.
    const _terrainOn = !!document.getElementById("tmap-terrain")?.checked;
    const zOffPaint = _terrainOn ? { "line-z-offset": 150 } : {};
    if (!map.getLayer("preview-glow")) {
      const gs = currentGlowStrength();
      // v0.9.16 — Glow-Opacity auf 0.35 angeglichen (war 0.4 vs Render 0.35).
      // v0.9.20 — Glow-line-width skaliert mit gs (Spiegelung Animator).
      map.addLayer({ id: "preview-glow", type: "line", source: "preview-track",
        layout: trackLayout,
        paint: { "line-color": color, "line-width": lw * (2.0 + 0.21 * gs), "line-opacity": 0.35, "line-blur": gs, ...dashPaint, ...zOffPaint } });
    }
    if (!map.getLayer("preview-line")) {
      map.addLayer({ id: "preview-line", type: "line", source: "preview-track",
        layout: trackLayout,
        paint: { "line-color": color, "line-width": lw, "line-opacity": 0.95, ...dashPaint, ...zOffPaint } });
    }
    // v0.8.10 — Röhre: weißer Highlight-Streifen oben auf der Linie. Synchron
    // zu core/tourmap.py track-highlight-Layer.
    if (!map.getLayer("preview-highlight")) {
      map.addLayer({ id: "preview-highlight", type: "line", source: "preview-track",
        layout: { ...trackLayout, "visibility": "none" },
        paint: { "line-color": "#ffffff", "line-width": lw * 0.35, "line-opacity": 0.55, "line-blur": 0.6, ...zOffPaint } });
    }
    // Pin-Preview (v0.6.6): Start/End-Marker live einblenden, synchron zur
    // tmap-pins-Checkbox + Track-Farbe.
    rebuildPreviewPins();
    applyTerrain();
    applyHideLabels();
    // v0.8.14 — applyLineStyle() hier nicht mehr nötig; dasharray ist in Layer
    // eingebaut. Würde sonst Rekursion verursachen.
    applyTrackStyle();
    applyGlowToLayers();
  }

  // currentGlowEnabled/Strength + applyGlowToLayers (v0.6.8). Spiegelung
  // zu modules/animator/ui/module.js — gleiche Logik.
  function currentGlowEnabled() {
    return !!document.getElementById("tmap-glow-enabled")?.checked;
  }
  function currentGlowStrength() {
    return parseFloat(document.getElementById("tmap-glow-strength")?.value) || 0;
  }
  function applyGlowToLayers() {
    if (!map) return;
    const enabled = currentGlowEnabled();
    const gs = currentGlowStrength();
    const lw = currentLineWidth();
    const visible = enabled && gs > 0;
    try {
      if (map.getLayer("preview-glow")) {
        map.setLayoutProperty("preview-glow", "visibility", visible ? "visible" : "none");
        if (visible) {
          map.setPaintProperty("preview-glow", "line-blur", gs);
          // v0.9.20 — line-width skaliert mit gs (Spiegelung Animator).
          map.setPaintProperty("preview-glow", "line-width", lw * (2.0 + 0.21 * gs));
        }
      }
    } catch (_) {}
  }

  function rebuildPreviewPins() {
    if (!map) return;
    const color = currentLineColor();
    if (!currentCoords || currentCoords.length < 2) return;
    const first = currentCoords[0];
    const last  = currentCoords[currentCoords.length - 1];
    const data = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { kind: "start" }, geometry: { type: "Point", coordinates: first } },
        { type: "Feature", properties: { kind: "end"   }, geometry: { type: "Point", coordinates: last  } },
      ],
    };
    if (!map.getSource("preview-pins")) {
      map.addSource("preview-pins", { type: "geojson", data });
    } else {
      map.getSource("preview-pins").setData(data);
    }
    if (!map.getLayer("preview-pin-glow")) {
      map.addLayer({
        id: "preview-pin-glow", type: "circle", source: "preview-pins",
        paint: { "circle-radius": 14, "circle-color": "#fff", "circle-opacity": 0.3, "circle-blur": 0.7 },
      });
    }
    if (!map.getLayer("preview-pin-core")) {
      map.addLayer({
        id: "preview-pin-core", type: "circle", source: "preview-pins",
        paint: {
          "circle-radius": 7,
          "circle-color": ["match", ["get", "kind"], "start", "#fff", "end", color, "#fff"],
          "circle-stroke-color": ["match", ["get", "kind"], "start", color, "end", "#fff", "#fff"],
          "circle-stroke-width": 2.5,
        },
      });
    } else {
      // Bei Farb-Wechsel die Pin-Farben mit-updaten
      try {
        map.setPaintProperty("preview-pin-core", "circle-color",
          ["match", ["get", "kind"], "start", "#fff", "end", color, "#fff"]);
        map.setPaintProperty("preview-pin-core", "circle-stroke-color",
          ["match", ["get", "kind"], "start", color, "end", "#fff", "#fff"]);
      } catch (_) {}
    }
    applyPinsVisibility();
  }

  function applyPinsVisibility() {
    if (!map) return;
    const visible = document.getElementById("tmap-pins")?.checked ?? true;
    const vis = visible ? "visible" : "none";
    try {
      if (map.getLayer("preview-pin-glow")) map.setLayoutProperty("preview-pin-glow", "visibility", vis);
      if (map.getLayer("preview-pin-core")) map.setLayoutProperty("preview-pin-core", "visibility", vis);
    } catch (_) {}
  }

  // v0.8.14 — dasharray-Berechnung ausgelagert (synchron Animator).
  function currentDasharray() {
    const style = document.getElementById("tmap-line-style")?.value || "solid";
    const spacing = Math.max(0.1, parseFloat(document.getElementById("tmap-line-spacing")?.value) || 1);
    const base = { dashed: [3, 2], dotted: [0.1, 2], dashdot: [3, 1.5, 0.1, 1.5] }[style];
    return base ? base.map(v => v * spacing) : null;
  }

  // Linien-Stil live anwenden (v0.6.5+, mit Spacing v0.6.6).
  // v0.8.14: Layer-Recreate statt setPaintProperty (siehe Animator-Spiegelung).
  function applyLineStyle() {
    if (!map) return;
    // v0.8.14 — Layer komplett wegwerfen + via rebuildPreviewLayers neu
    // anlegen, weil Mapbox-GL 3.x das dasharray-SDF nur beim Anlegen baked.
    try {
      for (const id of ["preview-line", "preview-glow", "preview-highlight"]) {
        if (map.getLayer(id)) map.removeLayer(id);
      }
    } catch (e) { applog("warn", `[applyLineStyle] removeLayer failed: ${e}`); }
    rebuildPreviewLayers();
  }

  // v0.8.12 — Höhere-Tube-Optik liest jetzt aus line_style statt eigenem
  // track_style-Dropdown (Marc-Wunsch: gehört zu den 2D-Linien-Stilen).
  function applyTrackStyle() {
    if (!map) return;
    const style = document.getElementById("tmap-line-style")?.value || "solid";
    const lw = currentLineWidth();
    try {
      if (map.getLayer("preview-highlight")) {
        map.setLayoutProperty("preview-highlight", "visibility", style === "tube" ? "visible" : "none");
        if (style === "tube") {
          map.setPaintProperty("preview-highlight", "line-width", lw * 0.35);
        }
      }
    } catch (_) {}
  }

  function getMapConfig() {
    // Aus den Akkordeon-Controls lesen, Fallback aus Settings-Cache.
    const el = id => document.getElementById(id);
    const fb = (_settingsCache && _settingsCache.tourmap) || {};
    return {
      lightPreset: el("tmap-mc-light")?.value || fb.light_preset || "day",
      showPlace: el("tmap-mc-places")
        ? el("tmap-mc-places").checked
        : (fb.show_place_labels !== false),
      showRoad: el("tmap-mc-roads")
        ? el("tmap-mc-roads").checked
        : (fb.show_road_labels !== false),
      showPoi: el("tmap-mc-poi")
        ? el("tmap-mc-poi").checked
        : (fb.show_poi_labels !== false),
      // ÖPNV in v0.6.5 wieder als Checkbox (Marc-Anweisung).
      showTransit: el("tmap-mc-transit")
        ? el("tmap-mc-transit").checked
        : (fb.show_transit_labels !== false),
      showAdmin: el("tmap-mc-admin")
        ? el("tmap-mc-admin").checked
        : (fb.show_admin_boundaries !== false),
    };
  }

  function applyHideLabels() {
    // Karten-Feinabstimmung in der Live-Preview anwenden (v0.5.0+).
    // Siehe ausführliche Doku im Animator-Modul — identische Logik.
    if (!map) return;
    const c = getMapConfig();
    try { map.setConfigProperty("basemap", "lightPreset", c.lightPreset); } catch (_) {}
    try { map.setConfigProperty("basemap", "showPlaceLabels", c.showPlace); } catch (_) {}
    try { map.setConfigProperty("basemap", "showRoadLabels", c.showRoad); } catch (_) {}
    try { map.setConfigProperty("basemap", "showPointOfInterestLabels", c.showPoi); } catch (_) {}
    try { map.setConfigProperty("basemap", "showTransitLabels", c.showTransit); } catch (_) {}
    try { map.setConfigProperty("basemap", "showAdminBoundaries", c.showAdmin); } catch (_) {}
    const style = map.getStyle && map.getStyle();
    if (!style || !style.layers) return;
    style.layers.forEach(l => {
      if (l.type !== "symbol" && l.type !== "line") return;
      const id = l.id.toLowerCase();
      let want = null;
      if (id.includes("admin") || id.includes("boundary") || id.includes("country-boundary")) want = c.showAdmin;
      else if (id.includes("road") || id.includes("street") || id.includes("path")) want = (l.type === "line") ? null : c.showRoad;
      else if (id.includes("poi")) want = c.showPoi;
      else if (id.includes("transit") || id.includes("airport") || id.includes("rail") || id.includes("ferry")) want = c.showTransit;
      else if (id.includes("place") || id.includes("settlement") || id.includes("country-label") || id.includes("state-label")) want = c.showPlace;
      if (want === null) return;
      try { map.setLayoutProperty(l.id, "visibility", want ? "visible" : "none"); } catch (_) {}
    });
  }

  function applyTerrain() {
    if (!map || isOsmMode()) return;
    const want = document.getElementById("tmap-terrain").checked;
    try {
      if (want) {
        if (!map.getSource("mapbox-dem")) {
          map.addSource("mapbox-dem", {
            type: "raster-dem", url: "mapbox://mapbox.mapbox-terrain-dem-v1",
            tileSize: 512, maxzoom: 14,
          });
        }
        const ex = parseFloat(document.getElementById("tmap-ex").value) || 1.5;
        map.setTerrain({ source: "mapbox-dem", exaggeration: ex });
      } else {
        map.setTerrain(null);
      }
      // v0.9.16 — line-z-offset synchron zum Render setzen. Spiegelung zu
      // Animator (siehe core/tourmap.py + core/animator.py — beide Renders
      // setzen line-z-offset:150 bei aktivem Terrain).
      const zOff = want ? 150 : 0;
      for (const lid of ["preview-glow", "preview-line", "preview-highlight"]) {
        if (map.getLayer(lid)) {
          try { map.setPaintProperty(lid, "line-z-offset", zOff); } catch (_) {}
        }
      }
    } catch (_) {}
  }

  function applyLineColorToLayers() {
    if (!map) return;
    const color = currentLineColor();
    try {
      if (map.getLayer("preview-glow")) map.setPaintProperty("preview-glow", "line-color", color);
      if (map.getLayer("preview-line")) map.setPaintProperty("preview-line", "line-color", color);
      // Pin-Farben mit-updaten (v0.6.6)
      if (map.getLayer("preview-pin-core")) {
        map.setPaintProperty("preview-pin-core", "circle-color",
          ["match", ["get", "kind"], "start", "#fff", "end", color, "#fff"]);
        map.setPaintProperty("preview-pin-core", "circle-stroke-color",
          ["match", ["get", "kind"], "start", color, "end", "#fff", "#fff"]);
      }
    } catch (_) {}
  }
  function applyLineWidthToLayers() {
    if (!map) return;
    const lw = currentLineWidth();
    const gs = currentGlowStrength();
    try {
      // v0.9.20 — Glow-Width respektiert gs-Skalierung (Spiegelung Animator).
      if (map.getLayer("preview-glow")) map.setPaintProperty("preview-glow", "line-width", lw * (2.0 + 0.21 * gs));
      if (map.getLayer("preview-line")) map.setPaintProperty("preview-line", "line-width", lw);
      // v0.8.10 — Highlight-Layer folgt der Linien-Dicke
      if (map.getLayer("preview-highlight")) map.setPaintProperty("preview-highlight", "line-width", lw * 0.35);
    } catch (_) {}
  }

  // ── v0.9.67 — Undo/Redo für Tour-Map (Linien-/Pin-/Stats-Settings) ───────
  // Snapshot enthält die komplette tourmap-Settings-Sektion. Apply schreibt
  // zurück + rebindAllSettings (DOM) + applyAllPaintSettings (Preview-Karte).
  // Wird in den Mutations-Pfaden über `_tmapPushUndo()` gefüttert (siehe
  // Generic-Hook unten, der alle Form-Inputs in #tmap-panel abdeckt).
  const _tmapUndoCtrl = window.createUndoController({
    snapshot: () => {
      const proj = (typeof getActiveProject === "function") ? getActiveProject() : null;
      const t = (proj && proj.tourmap) || {};
      return JSON.parse(JSON.stringify(t));
    },
    apply: (snap) => {
      if (!snap) return;
      saveProjectSettings("tourmap", JSON.parse(JSON.stringify(snap)));
      if (typeof rebindAllSettings === "function") rebindAllSettings();
      try { applyAllPaintSettings(); } catch (_) {}
    },
    toast: (msg) => { if (typeof toast === "function") toast(msg, "info", 1000); },
  });
  window.__rzUndoControllers.tourmap = _tmapUndoCtrl;
  const _tmapPushUndo = (label, opts) => _tmapUndoCtrl.push(label, opts);
  const tmapUndo = () => _tmapUndoCtrl.undo();
  const tmapRedo = () => _tmapUndoCtrl.redo();
  // Generic-Hook: alle Form-Inputs in #tmap-panel triggern Undo-Snapshot
  // vor der Mutation. Throttled (Slider/Range) bzw. force (Checkbox/Select).
  function _wireTourmapUndoListeners() {
    const root = document.getElementById("tmap-panel");
    if (!root) return;
    if (root.dataset.undoWired === "1") return;
    root.dataset.undoWired = "1";
    root.addEventListener("input", (ev) => {
      const t = ev.target;
      if (!t || !t.name && !t.id) return;
      // Slider/Range → throttled (Drag-Session = 1 Snapshot)
      _tmapPushUndo(`Wert geändert (${t.id || t.name})`);
    });
    root.addEventListener("change", (ev) => {
      const t = ev.target;
      if (!t) return;
      // Discrete: select, checkbox, radio, color-picker → force
      const tag = (t.tagName || "").toLowerCase();
      const ty = (t.type || "").toLowerCase();
      const isDiscrete = tag === "select" || ty === "checkbox" || ty === "radio" || ty === "color";
      _tmapPushUndo(`Wert geändert (${t.id || t.name || tag})`, { force: isDiscrete });
    });
  }
  // Beim Projekt-Wechsel: Undo-Stack leeren
  const _origTmapProjChanged = window._tmapOnProjectChanged;
  window._tmapOnProjectChanged = function() {
    _tmapUndoCtrl.reset();
    if (typeof _origTmapProjChanged === "function") _origTmapProjChanged();
    // v0.9.74 — Foto-Pins Refresh + UI-Sync nach Projekt-Wechsel
    try {
      const slider = document.getElementById("tmap-photos-size");
      const sliderV = document.getElementById("tmap-photos-size-v");
      if (slider) slider.value = String(_tmapPhotosSizePx());
      if (sliderV) sliderV.textContent = `${_tmapPhotosSizePx()} px`;
      const show = document.getElementById("tmap-photos-show");
      if (show) show.checked = _tmapPhotosShow();
    } catch (_) {}
    _tmapPhotosRefreshThumbsAfterRestore();
  };
  // ── /Undo-Redo ──────────────────────────────────────────────────────────

  // ── v0.9.74 — Foto-Pins (Phase 1, Spiegelung Animator) ────────────────────
  function _tmapPhotosSizePx() {
    const t = (typeof getActiveProject === "function" ? getActiveProject() : null);
    const tm = t && t.tourmap;
    if (tm && typeof tm.photos_size_px === "number") return tm.photos_size_px;
    return 48;
  }
  function _tmapPhotosShow() {
    const t = (typeof getActiveProject === "function" ? getActiveProject() : null);
    const tm = t && t.tourmap;
    if (tm && "photos_show" in tm) return !!tm.photos_show;
    return true;
  }
  function _tmapPhotosList() {
    const proj = (typeof getActiveProject === "function" ? getActiveProject() : null);
    return (proj && Array.isArray(proj.photos)) ? proj.photos : [];
  }
  function _tmapPhotosApplyToMap() {
    if (!map || typeof PhotoPins === "undefined") return;
    const list = _tmapPhotosShow() ? _tmapPhotosList() : [];
    // v0.9.79 — Tour-Map ist Single-Frame, KEIN Zeit-Filter. Wir geben
    // explicit kein `markerAnchor` mit → PhotoPins setzt keinen Filter,
    // alle Fotos sind permanent sichtbar (Phase-1-Verhalten).
    try { PhotoPins.attachToMap(map, list, { sizePx: _tmapPhotosSizePx() }); } catch (_) {}
  }
  function _tmapPhotosRenderList() {
    const host = document.getElementById("tmap-photos-list");
    if (!host || typeof PhotoPins === "undefined") return;
    PhotoPins.renderList(
      host,
      _tmapPhotosList(),
      (p) => { if (map) PhotoPins.flyTo(map, p); },
      // v0.9.77 — onToggle
      (p, i, visible) => _tmapPhotosSetVisibility(i, visible)
    );
    const cnt = document.getElementById("tmap-photos-count");
    if (cnt) {
      const list = _tmapPhotosList();
      const total = list.length;
      const shown = list.filter(p => p && p.visible !== false).length;
      if (total === 0) cnt.textContent = "";
      else if (shown === total) {
        cnt.textContent = (total === 1
          ? t("photos.count_one", "1 Foto")
          : t("photos.count_other", "%d Fotos").replace("%d", total));
      } else {
        cnt.textContent = t("photos.count_visible", "%shown von %total sichtbar")
          .replace("%shown", shown).replace("%total", total);
      }
    }
  }
  // v0.9.77 — Per-Foto-Visibility (Spiegelung Animator)
  function _tmapPhotosSetVisibility(i, visible) {
    const list = _tmapPhotosList();
    if (i < 0 || i >= list.length) return;
    list[i] = { ...list[i], visible: !!visible };
    _tmapPhotosSaveListToProject(list);
    _tmapPhotosApplyToMap();
    _tmapPhotosRenderList();
  }
  function _tmapPhotosSetAllVisible(visible) {
    const list = _tmapPhotosList();
    if (!list.length) return;
    const updated = list.map(p => ({ ...p, visible: !!visible }));
    _tmapPhotosSaveListToProject(updated);
    _tmapPhotosApplyToMap();
    _tmapPhotosRenderList();
  }
  function _tmapPhotosSaveListToProject(merged) {
    const proj = (typeof getActiveProject === "function" ? getActiveProject() : null);
    if (!proj) return;
    const stripped = (merged || []).map(p => ({
      path: p.path,
      lon: Number(p.lon),
      lat: Number(p.lat),
      elevation: p.elevation == null ? null : Number(p.elevation),
      datetime: p.datetime || null,
      // v0.9.77 — visible-Flag mit-persistieren
      visible: p.visible === false ? false : true,
    }));
    proj.photos = (merged || []).slice();
    // v0.9.78: persistOnly damit der In-Memory-Cache mit Thumbs erhalten bleibt
    // (siehe Animator-Kommentar an gleicher Stelle).
    try {
      if (typeof saveActiveProjectPatch === "function") {
        saveActiveProjectPatch({ photos: stripped }, { persistOnly: true });
      }
    } catch (e) {
      console.warn("[tmap-photos] persist fehlgeschlagen", e);
    }
  }
  async function _tmapPhotosLoadFromPaths(pathsOrFolder) {
    if (!window.pywebview?.api?.photos_load) return;
    try {
      const res = await window.pywebview.api.photos_load(pathsOrFolder);
      const photos = (res && res.photos) || [];
      const skipped = (res && res.skipped_count) || 0;
      const failed = (res && res.failed_count) || 0;
      if (photos.length === 0 && (skipped > 0 || failed > 0)) {
        toast(t("photos.toast_no_gps", "Keine Fotos mit GPS gefunden."), "warn", 3500);
      } else if (skipped > 0 || failed > 0) {
        const total = (res.total || 0);
        toast(t("photos.toast_skipped",
                "%done von %total Fotos geladen — %skipped ohne GPS übersprungen.")
              .replace("%done", photos.length)
              .replace("%total", total)
              .replace("%skipped", skipped + failed), "info", 4000);
      } else if (photos.length > 0) {
        toast(t("photos.toast_loaded", "%n Fotos geladen.").replace("%n", photos.length), "ok", 2500);
      }
      const merged = PhotoPins.dedupePaths(_tmapPhotosList(), photos);
      _tmapPhotosSaveListToProject(merged);
      _tmapPhotosApplyToMap();
      _tmapPhotosRenderList();
    } catch (e) {
      console.warn("[tmap-photos] load fehlgeschlagen", e);
      toast(t("photos.toast_load_error", "Fotos konnten nicht geladen werden."), "err", 3500);
    }
  }
  async function _tmapPhotosLoadFromGeotagger() {
    if (!window.pywebview?.api?.photos_from_geotagger) return;
    try {
      const res = await window.pywebview.api.photos_from_geotagger();
      const photos = (res && res.photos) || [];
      if (photos.length === 0) {
        toast(t("photos.toast_gtg_empty", "Keine Geotagger-Fotos mit GPS gefunden."), "warn", 3500);
        return;
      }
      const merged = PhotoPins.dedupePaths(_tmapPhotosList(), photos);
      _tmapPhotosSaveListToProject(merged);
      _tmapPhotosApplyToMap();
      _tmapPhotosRenderList();
      toast(t("photos.toast_loaded", "%n Fotos geladen.").replace("%n", photos.length), "ok", 2500);
    } catch (e) {
      console.warn("[tmap-photos] from-geotagger fehlgeschlagen", e);
    }
  }
  function _tmapPhotosClearAll() {
    _tmapPhotosSaveListToProject([]);
    _tmapPhotosApplyToMap();
    _tmapPhotosRenderList();
  }
  async function _tmapPhotosRefreshThumbsAfterRestore() {
    const persisted = _tmapPhotosList();
    if (!persisted.length) {
      _tmapPhotosApplyToMap();
      _tmapPhotosRenderList();
      return;
    }
    const paths = persisted.map(p => p.path).filter(Boolean);
    try {
      const res = await window.pywebview.api.photos_refresh_thumbs(paths);
      const fresh = (res && res.photos) || [];
      const byPath = new Map(fresh.map(p => [p.path, p]));
      const merged = persisted.map(p => {
        const fr = byPath.get(p.path);
        return fr ? { ...p, ...fr } : p;
      });
      const proj = (typeof getActiveProject === "function" ? getActiveProject() : null);
      if (proj) proj.photos = merged;
    } catch (e) {
      console.warn("[tmap-photos] refresh-thumbs fehlgeschlagen", e);
    }
    _tmapPhotosApplyToMap();
    _tmapPhotosRenderList();
  }
  function _tmapPhotosBindUi() {
    const slider = document.getElementById("tmap-photos-size");
    const sliderV = document.getElementById("tmap-photos-size-v");
    if (slider && !slider._wired) {
      slider._wired = true;
      slider.value = String(_tmapPhotosSizePx());
      if (sliderV) sliderV.textContent = `${slider.value} px`;
      slider.addEventListener("input", () => {
        const v = parseInt(slider.value, 10) || 48;
        if (sliderV) sliderV.textContent = `${v} px`;
        if (map && typeof PhotoPins !== "undefined") PhotoPins.updateSize(map, v);
        try {
          if (typeof saveProjectSettings === "function" && typeof getActiveSession === "function" && getActiveSession()) {
            saveProjectSettings("tourmap", { photos_size_px: v });
          }
        } catch (_) {}
      });
    }
    const show = document.getElementById("tmap-photos-show");
    if (show && !show._wired) {
      show._wired = true;
      show.checked = _tmapPhotosShow();
      show.addEventListener("change", () => {
        try {
          if (typeof saveProjectSettings === "function" && typeof getActiveSession === "function" && getActiveSession()) {
            saveProjectSettings("tourmap", { photos_show: !!show.checked });
          }
        } catch (_) {}
        _tmapPhotosApplyToMap();
      });
    }
    const pickBtn = document.getElementById("tmap-photos-pick");
    if (pickBtn && !pickBtn._wired) {
      pickBtn._wired = true;
      pickBtn.addEventListener("click", () => {
        if (typeof PhotoPins === "undefined" || !PhotoPins.openPickChoice) return;
        PhotoPins.openPickChoice({
          onFolder: (path) => _tmapPhotosLoadFromPaths(path),
          onFiles:  (paths) => _tmapPhotosLoadFromPaths(paths),
        });
      });
    }
    const gtgBtn = document.getElementById("tmap-photos-from-gtg");
    if (gtgBtn && !gtgBtn._wired) {
      gtgBtn._wired = true;
      gtgBtn.addEventListener("click", () => _tmapPhotosLoadFromGeotagger());
    }
    const clearBtn = document.getElementById("tmap-photos-clear");
    if (clearBtn && !clearBtn._wired) {
      clearBtn._wired = true;
      clearBtn.addEventListener("click", () => {
        if (!_tmapPhotosList().length) return;
        _tmapPhotosClearAll();
      });
    }
    // v0.9.77 — Master „Alle an" / „Alle aus" (Spiegelung Animator)
    const selAll = document.getElementById("tmap-photos-select-all");
    if (selAll && !selAll._wired) {
      selAll._wired = true;
      selAll.addEventListener("click", () => _tmapPhotosSetAllVisible(true));
    }
    const selNone = document.getElementById("tmap-photos-select-none");
    if (selNone && !selNone._wired) {
      selNone._wired = true;
      selNone.addEventListener("click", () => _tmapPhotosSetAllVisible(false));
    }
    const dropHost = document.getElementById("tmap-photos-section");
    if (dropHost && !dropHost._dropWired) {
      dropHost._dropWired = true;
      dropHost.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropHost.classList.add("photos-dropping");
      });
      dropHost.addEventListener("dragleave", () => dropHost.classList.remove("photos-dropping"));
      dropHost.addEventListener("drop", async (e) => {
        e.preventDefault();
        dropHost.classList.remove("photos-dropping");
        // v0.9.153: echte Originalpfade via pywebview (WKWebView liefert dem
        // JS kein f.path). consumeNativeDropMap() pro Drop genau 1× rufen.
        // (synchron zu animator/module.js — bei Änderung beide pflegen)
        const nativeMap = (typeof consumeNativeDropMap === "function")
                          ? await consumeNativeDropMap() : {};
        const MEDIA_RX = /\.(jpe?g|jpe|tiff?|cr3|cr2|crw|nef|nrw|arw|srf|sr2|raf|rw2|orf|dng|pef|rwl|srw|heic|heif|mp4|mov|m4v|qt|insv|insp|mts|m2ts|lrv|3gp|avi|mkv)$/i;
        const paths = [];
        for (const f of (e.dataTransfer?.files || [])) {
          const np = nativePathFromMap(nativeMap, f.name) || f.path || null;
          if (np) paths.push(np);
        }
        if (!paths.length) {
          const seen = new Set();
          for (const k in nativeMap) {
            const p = nativeMap[k];
            if (p && !seen.has(p) && MEDIA_RX.test(p)) { seen.add(p); paths.push(p); }
          }
        }
        if (paths.length) _tmapPhotosLoadFromPaths(paths);
      });
    }
    _tmapPhotosRenderList();
  }
  _tmapPhotosBindUi();
  // v0.9.76 — auf Map-Ready warten bevor wir die Photo-Pins applizieren,
  // sonst silent fail bei addSource/addLayer (Style noch nicht geladen).
  if (typeof onMapReady === "function" && map) {
    onMapReady(map, () => {
      setTimeout(() => { _tmapPhotosRefreshThumbsAfterRestore(); }, 200);
    });
  } else {
    setTimeout(() => { _tmapPhotosRefreshThumbsAfterRestore(); }, 400);
  }
  // ── /Foto-Pins ───────────────────────────────────────────────────────────

  // v0.9.23 — Sammel-Re-Apply ALLER paint-Properties auf der Preview-Karte
  // nach Session-Load / Projekt-Wechsel. Spiegelung Animator. rebindAllSettings
  // setzt DOM-Werte, dispatcht aber keine Events → einzelne applyXxx-Listener
  // feuern nicht. Ohne diesen Call zeigt die Preview die alten Settings nach
  // Track-Wechsel. Marc-Bug-Report (Animator) gilt 1:1 auch hier.
  function applyAllPaintSettings() {
    if (!map) return;
    try { applyLineColorToLayers(); } catch (_) {}
    try { applyLineWidthToLayers(); } catch (_) {}
    try { applyGlowToLayers(); } catch (_) {}
    try { applyLineStyle(); } catch (_) {}
    try { applyTrackStyle(); } catch (_) {}
    try { applyHideLabels(); } catch (_) {}
    try { applyTerrain(); } catch (_) {}
    try { rebuildPreviewPins(); } catch (_) {}
    try { renderOverlayPreview(); } catch (_) {}
  }

  function applyStyle(styleKey) {
    if (!map || isOsmMode()) return;
    const MAP_STYLES = {
      satellite:          "mapbox://styles/mapbox/standard-satellite",
      satellite_streets:  "mapbox://styles/mapbox/satellite-streets-v12",
      streets:            "mapbox://styles/mapbox/streets-v12",
      outdoors:           "mapbox://styles/mapbox/outdoors-v12",
      light:              "mapbox://styles/mapbox/light-v11",
      dark:               "mapbox://styles/mapbox/dark-v11",
    };
    const url = MAP_STYLES[styleKey] || MAP_STYLES.satellite;
    map.setStyle(url);
    map.once("style.load", () => rebuildPreviewLayers());
  }

  whenApiReady().then(async () => {
    // v0.9.249 — OSM-Modus: Tour-Map ist Mapbox-only (Satellit/3D + Mapbox-
    // Render-Backend). Statt sinnloser OSM-Vorschau die Karten-Fläche mit klarer
    // „Token nötig"-Meldung überdecken und den Map-Init überspringen.
    try {
      const _cv = body.querySelector("#tourmap-canvas");
      if (_cv && _cv.parentElement && window.osmBlockOverlay && window.osmBlockOverlay(_cv.parentElement)) {
        return;
      }
    } catch (_) {}
    const MAP_STYLES = {
      satellite:          "mapbox://styles/mapbox/standard-satellite",
      satellite_streets:  "mapbox://styles/mapbox/satellite-streets-v12",
      streets:            "mapbox://styles/mapbox/streets-v12",
      outdoors:           "mapbox://styles/mapbox/outdoors-v12",
      light:               "mapbox://styles/mapbox/light-v11",
      dark:               "mapbox://styles/mapbox/dark-v11",
    };
    const initialStyleKey = (_settingsCache?.tourmap?.map_style) || "satellite";
    // Viewport initial auf gewählte Render-Auflösung dimensionieren BEVOR
    // wir die Map kreieren — sonst hat Mapbox die falsche Initial-Size.
    updateViewport();

    const made = createMap({
      container: "tourmap-canvas",
      mapboxStyle: MAP_STYLES[initialStyleKey] || MAP_STYLES.satellite,
      common: {
        center: [10, 51], zoom: 4,
        pitch: currentPitch(),
        bearing: currentBearing(),
      },
    });
    map = made.map;
    map.addControl(new made.lib.NavigationControl(), "top-right");
    // v0.8.4: onMapReady macht rebuildPreviewLayers + initial GPX-Apply
    // in einem Callback — robust gegen Race-Conditions (Style könnte
    // bereits geladen sein BEVOR der on-Listener registriert wird).
    onMapReady(map, () => {
      applog("info", "[TourMap onMapReady cb] running");
      rebuildPreviewLayers();
      if (typeof getGlobalGpxPath === "function") {
        const curPath = getGlobalGpxPath();
        applog("info", `[TourMap onMapReady] gpxPath=${curPath}`);
        if (curPath) loadGpxByPath(curPath);
      }
      // v0.9.29 (Marc-Bug-Report): Map-Pose-Restore raus — kollidiert mit
      // fitTrackPreview/refit nach Mount und zoomt unintendiert raus.
    });
    renderOverlayPreview();

    // Resize-Observer: Section-Größe ändert sich (Fenster, Sidebar etc.)
    // → Viewport neu fitten + Map resize.
    // v0.9.34 (Marc-Bug-Report): debounced damit die Layout-Cascade beim
    // Re-Mount nicht mehrere fitTrackToView-Calls in 50ms feuert.
    let _tmapResizeTimer = null;
    _viewportResizeObserver = new ResizeObserver(() => {
      clearTimeout(_tmapResizeTimer);
      _tmapResizeTimer = setTimeout(() => {
        updateViewport();
        if (currentBbox) fitTrackToView(false);
      }, 200);
    });
    _viewportResizeObserver.observe(document.querySelector(".tourmap-canvas"));
  });

  // ── Live-Wiring ──────────────────────────────────────────────────────────
  document.getElementById("tmap-style").addEventListener("change", e => applyStyle(e.target.value));
  // Pitch/Bearing-Änderung: NUR Wert setzen, KEIN Refit. So bleibt die
  // manuell gepante Position erhalten. Render snapshot't die aktuelle
  // map-View (override_center+override_zoom) → WYSIWYG ist gesichert,
  // ohne dass der Track ständig zur Mitte zurückspringt.
  // Für expliziten Refit: ⤢-Button unten rechts.
  document.getElementById("tmap-pitch").addEventListener("input", () => {
    if (map) map.setPitch(currentPitch());
  });
  document.getElementById("tmap-bearing").addEventListener("input", () => {
    if (map) map.setBearing(currentBearing());
  });
  document.getElementById("tmap-ex").addEventListener("input", applyTerrain);
  document.getElementById("tmap-terrain").addEventListener("change", applyTerrain);
  // Karten-Feinabstimmung-Akkordeon — Bindings + Toggle-Logic siehe oben.
  document.getElementById("tmap-color").addEventListener("input", () => {
    applyLineColorToLayers();
    renderOverlayPreview();
  });
  document.getElementById("tmap-lw").addEventListener("input", applyLineWidthToLayers);
  ["tmap-overlays",
   "tmap-ov-totals", "tmap-ov-totals-pos",
   "tmap-ov-ele", "tmap-ov-ele-pos"
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", () => renderOverlayPreview());
  });

  // ── WYSIWYG: Format-/Padding-Änderungen müssen sofort sichtbar sein ──────
  // Auflösungs-Inputs (manuell oder via Preset-Button) → Viewport-Aspekt
  // anpassen + Track neu fitten
  function onResolutionOrPaddingChange() {
    // v0.6.5 — center+zoom+pitch+bearing snapshotten statt bounds (kein Drift).
    // Siehe ausführliche Doku im Animator-Pendant.
    let saved = null;
    if (map) {
      try {
        saved = {
          center: map.getCenter(),
          zoom: map.getZoom(),
          pitch: map.getPitch(),
          bearing: map.getBearing(),
        };
      } catch (_) {}
    }
    updateViewport();
    if (saved && map) {
      requestAnimationFrame(() => {
        try { map.jumpTo(saved); } catch (_) {}
      });
    }
  }
  document.getElementById("tmap-w").addEventListener("input", onResolutionOrPaddingChange);
  document.getElementById("tmap-h").addEventListener("input", onResolutionOrPaddingChange);
  document.getElementById("tmap-pad").addEventListener("input", () => {
    if (currentBbox) fitTrackToView(true);
  });

  // Refit-Button schwebt unten rechts
  document.getElementById("tmap-refit").addEventListener("click", () => {
    if (currentBbox) {
      fitTrackToView(true);
    } else {
      toast(t("tourmap.stats.empty_hint"), "info", 2000);
    }
  });

  // ── Overlay-Preview-DOM (analog Animator) ────────────────────────────────
  function renderOverlayPreview() {
    const layer = document.getElementById("tmap-overlay-preview");
    if (!layer) return;
    const master = document.getElementById("tmap-overlays")?.checked ?? true;
    const totals = document.getElementById("tmap-ov-totals")?.checked ?? true;
    const ele    = document.getElementById("tmap-ov-ele")?.checked ?? false;
    const posT   = document.getElementById("tmap-ov-totals-pos")?.value || "tl";
    const posE   = document.getElementById("tmap-ov-ele-pos")?.value || "bc";
    const color  = currentLineColor();
    if (!master) { layer.innerHTML = ""; return; }

    const s = _gpxStats;
    const fmtKmLocal = (km) => km < 100 ? km.toFixed(1) + " km" : km.toFixed(0) + " km";
    const fmtDurLocal = (sec) => {
      sec = Math.max(0, Math.floor(sec));
      const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), x = sec % 60;
      const pad = n => n < 10 ? "0" + n : "" + n;
      return h > 0 ? h + ":" + pad(m) + ":" + pad(x) : pad(m) + ":" + pad(x);
    };
    const distTxt = s ? fmtKmLocal(s.distance_km) : "—";
    const durTxt  = s ? fmtDurLocal(s.duration_s) : "—";
    const ascTxt  = s ? Math.round(s.ascent_m) + " m"  : "—";
    const descTxt = s ? Math.round(s.descent_m) + " m" : "—";
    const eleMaxTxt = s && s.ele_max != null ? Math.round(s.ele_max) + " m" : "—";

    let eleSvg = "";
    if (ele && _gpxElevations && _gpxElevations.length > 1) {
      const W = 1000, H = 120, PY = 10;
      const eMin = Math.min(..._gpxElevations);
      const eMax = Math.max(..._gpxElevations);
      const eRng = (eMax - eMin) || 1;
      const yOf = (e) => H - PY - ((e - eMin) / eRng) * (H - PY * 2);
      const xOf = (i) => (i / Math.max(1, _gpxElevations.length - 1)) * W;
      const allPts = _gpxElevations.map((e, i) => `${xOf(i).toFixed(1)},${yOf(e).toFixed(1)}`).join(" ");
      const fillFirst = `${xOf(0).toFixed(1)},${H}`;
      const fillLast  = `${xOf(_gpxElevations.length - 1).toFixed(1)},${H}`;
      const fillPts = `${fillFirst} ${allPts} ${fillLast}`;
      eleSvg = `
        <div class="ov-ele-header">
          <span class="ov-ele-title">${t("animator.overlay.elevation_title")}</span>
          <span class="ov-ele-minmax">Min ${Math.round(eMin)} m · Max ${Math.round(eMax)} m</span>
        </div>
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="ov-ele-svg">
          <defs>
            <linearGradient id="tmap-ov-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="${color}" stop-opacity="0.55"/>
              <stop offset="100%" stop-color="${color}" stop-opacity="0.02"/>
            </linearGradient>
          </defs>
          <polygon points="${fillPts}" fill="url(#tmap-ov-grad)"/>
          <polyline points="${allPts}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
        </svg>`;
    }

    let html = "";
    if (totals) {
      html += `<div class="ov-box pos-${posT}">
        <div class="ov-row"><span class="ov-l">${t("animator.overlay.label.distance")}</span><span class="ov-v">${distTxt}</span></div>
        <div class="ov-row"><span class="ov-l">${t("animator.overlay.label.time")}</span><span class="ov-v">${durTxt}</span></div>
        <div class="ov-row"><span class="ov-l">${t("animator.overlay.label.ascent")}</span><span class="ov-v">↑ ${ascTxt}</span></div>
        <div class="ov-row"><span class="ov-l">${t("animator.overlay.label.descent")}</span><span class="ov-v">↓ ${descTxt}</span></div>
        <div class="ov-row"><span class="ov-l">${t("animator.overlay.label.elevation_max")}</span><span class="ov-v">${eleMaxTxt}</span></div>
      </div>`;
    }
    if (ele && eleSvg) {
      html += `<div class="ov-ele-box pos-${posE}">${eleSvg}</div>`;
    }
    layer.innerHTML = html;
  }

  async function loadGpxByPath(path) {
    applog("info", `[TourMap loadGpxByPath] start path=${path}`);
    const res = await api().tourmap_load_gpx(path);
    if (!res.ok) { applog("error", `[TourMap loadGpxByPath] fail: ${res.error}`); toast(res.error || "GPX-Fehler", "error"); return; }
    applog("info", `[TourMap loadGpxByPath] parsed n_coords=${res.coords?.length}`);
    currentGpx = path;
    currentCoords = res.coords;
    currentBbox = res.bbox || null;
    // v0.8.0: Session aktivieren (gleicher Track-Hash wie Animator → die
    // Settings sind dann modulübergreifend dieselben)
    if (typeof sessionActivate === "function") {
      try {
        await sessionActivate(res.coords, path);
        if (typeof rebindAllSettings === "function") rebindAllSettings();
      } catch (err) { console.warn("sessionActivate (tourmap):", err); }
    }
    _gpxStats = res.stats;
    _gpxElevations = res.elevations || [];

    document.getElementById("tmap-stats-empty").hidden = true;
    document.getElementById("tmap-stats-cards").hidden = false;
    document.getElementById("t-dist").textContent = fmtKm(res.stats.distance_km * 1000);
    document.getElementById("t-time").textContent = fmtDur(res.stats.duration_s);
    document.getElementById("t-asc").textContent = "↑ " + fmtMeter(res.stats.ascent_m);
    document.getElementById("t-desc").textContent = "↓ " + fmtMeter(res.stats.descent_m);
    document.getElementById("tmap-render").disabled = false;

    // Erst Viewport auf gewählte Auflösung dimensionieren, dann mit der
    // BACKEND-FORMEL fitten — so ist die Vorschau exakt deckungsgleich mit
    // dem späteren PNG (WYSIWYG).
    updateViewport();
    fitTrackToView(true);

    // v0.8.5: rebuildPreviewLayers DIREKT — wir sind im onMapReady-Path
    // garantiert nach load-Event. isStyleLoaded() ist Mapbox-intern
    // unzuverlässig direkt nach load (Source-Tiles noch am laden), aber
    // addSource/addLayer funktionieren ab style.json-Load.
    if (map) rebuildPreviewLayers();
    renderOverlayPreview();
    // v0.9.23 — paint-Settings aufs neue Projekt anwenden. rebuildPreviewLayers
    // legt Layer nur an wenn sie noch nicht existieren — bei einem
    // Re-Mount/Projekt-Wechsel bleiben sonst die alten Paint-Werte hängen.
    applyAllPaintSettings();
    toast(t("tourmap.toast.gpx_loaded") + ": " + res.name, "success", 2200);
  }

  // v0.8.1: GPX-Picker ist global in der Sub-Top-Bar.
  // Drag&Drop auf das Canvas leitet weiter an loadGlobalGpx.
  setupDropZone({
    target: document.getElementById("tmap-drop"),
    onFile: async (file) => {
      if (!file.name.toLowerCase().endsWith(".gpx")) return;
      const sess = "tmap_drop_" + Date.now();
      const text = await fileToText(file);
      const r = await api().drop_save_text_file(sess, file.name, text);
      if (r.ok && typeof loadGlobalGpx === "function") await loadGlobalGpx(r.path);
    },
  });

  // Globaler GPX-State: beim Laden + initial wenn Modul mountet
  if (typeof onGpxLoaded === "function") {
    onGpxLoaded(({ path, data }) => {
      if (path && data) loadGpxByPath(path);  // bestehender Tourmap-Backend-Call
      else {
        currentGpx = null;
        currentCoords = null;
        currentBbox = null;
        try {
          document.getElementById("tmap-stats-empty").hidden = false;
          document.getElementById("tmap-stats-cards").hidden = true;
          document.getElementById("tmap-render").disabled = true;
        } catch (_) {}
      }
    });
  }
  // v0.8.2: Initial-Apply läuft im whenApiReady().then-Block nach Map-Init.

  // ── Render-Knopf ─────────────────────────────────────────────────────────
  // v0.9.155: Workspace-Clear läuft zentral über das rote ✕ in der GPX-Bar
  // (window.clearWorkspaceGlobal). Modul registriert nur seine Reset-Logik.
  // DOM-Zugriffe guarded für den nicht-gemounteten Fall.
  function _tmapClearWorkspace() {
    currentGpx = null;
    currentCoords = null;
    currentBbox = null;
    _gpxStats = null;
    _gpxElevations = null;
    // Track-Layer entfernen
    if (map) {
      try {
        if (map.getLayer("preview-line")) map.removeLayer("preview-line");
        if (map.getLayer("preview-glow")) map.removeLayer("preview-glow");
        if (map.getSource("preview-track")) map.removeSource("preview-track");
      } catch (_) {}
      try { map.flyTo({ center: [10, 51], zoom: 4, pitch: currentPitch(), bearing: currentBearing(), duration: 500 }); } catch (_) {}
    }
    try {
      // Header-Stats Empty-Hint
      document.getElementById("tmap-stats-empty").hidden = false;
      document.getElementById("tmap-stats-cards").hidden = true;
      document.getElementById("tmap-render").disabled = true;
      // Result-View ausblenden falls vorher gerendert
      document.getElementById("tmap-result")?.classList.remove("show");
      renderOverlayPreview();
    } catch (_) {}
  }
  if (typeof registerWorkspaceResetter === "function") registerWorkspaceResetter(_tmapClearWorkspace);

  document.getElementById("tmap-render").addEventListener("click", async () => {
    if (!currentGpx) { toast(t("tourmap.stats.empty_hint"), "warn", 3000); return; }

    const w = parseInt(document.getElementById("tmap-w").value);
    const h = parseInt(document.getElementById("tmap-h").value);

    // Save-As-Dialog: User wählt Pfad + Namen, bevor das Rendern startet.
    // Default-Name: <gpx-stem>_<W>x<H>.png — klar lesbar fürs Format.
    const gpxStem = (currentGpx.split("/").pop() || "tour").replace(/\.gpx$/i, "");
    const defaultName = `${gpxStem}_${w}x${h}.png`;
    // Default-Ordner: zuletzt benutzter aus Settings, sonst Pictures-Default vom Backend
    const lastDir = (_settingsCache && _settingsCache.tourmap && _settingsCache.tourmap.last_save_dir) || "";

    const savePath = await api().pick_save_path(defaultName, lastDir, ["PNG (*.png)"]);
    if (!savePath) return;   // User hat abgebrochen

    // Last-Dir merken fürs nächste Mal (kein Modal-Spam mehr im selben Ordner)
    const dir = savePath.substring(0, savePath.lastIndexOf("/"));
    if (dir) saveSettings({ tourmap: { last_save_dir: dir } });

    // User-Viewport snapshotten — was im Preview-Letterbox steht, kommt 1:1
    // ins PNG. Pan/Zoom des Users wird damit respektiert (kein erneuter
    // bounds-fit im Backend, wenn override_* gesetzt ist).
    let overrideCenter = null, overrideZoom = null;
    let snapshotPitch = parseFloat(document.getElementById("tmap-pitch").value);
    let snapshotBearing = parseFloat(document.getElementById("tmap-bearing").value);
    if (map) {
      try {
        const c = map.getCenter();
        overrideCenter = [c.lng, c.lat];
        // v0.6.1 WYSIWYG-Fix — siehe Doku in util.js correctedZoom().
        overrideZoom = window.correctedZoom
          ? window.correctedZoom(map, w, h)
          : map.getZoom();
        snapshotPitch = map.getPitch();
        snapshotBearing = map.getBearing();
      } catch (_) {}
    }

    const params = {
      gpx_path: currentGpx,
      output_path: savePath,
      map_style: document.getElementById("tmap-style").value,
      width: w,
      height: h,
      pitch: snapshotPitch,
      bearing: snapshotBearing,
      padding_pct: parseFloat(document.getElementById("tmap-pad").value),
      override_center: overrideCenter,
      override_zoom: overrideZoom,
      exaggeration: parseFloat(document.getElementById("tmap-ex").value),
      enable_terrain: document.getElementById("tmap-terrain").checked,
      // v0.5.0: Karten-Feinabstimmung — aus den Settings, nicht aus DOM
      ...(function() {
        const c = getMapConfig();
        return {
          light_preset: c.lightPreset,
          show_place_labels: c.showPlace,
          show_road_labels: c.showRoad,
          show_poi_labels: c.showPoi,
          show_transit_labels: c.showTransit,
          show_admin_boundaries: c.showAdmin,
        };
      })(),
      line_color: document.getElementById("tmap-color").value,
      line_width: parseFloat(document.getElementById("tmap-lw").value),
      line_style: document.getElementById("tmap-line-style").value,
      line_style_spacing: parseFloat(document.getElementById("tmap-line-spacing").value),
      // v0.6.8: Glow um die Track-Linie
      glow_enabled: document.getElementById("tmap-glow-enabled").checked,
      glow_strength: parseFloat(document.getElementById("tmap-glow-strength").value),
      show_overlays: document.getElementById("tmap-overlays").checked,
      overlay_totals_enabled: document.getElementById("tmap-ov-totals").checked,
      overlay_totals_position: document.getElementById("tmap-ov-totals-pos").value,
      overlay_elevation_enabled: document.getElementById("tmap-ov-ele").checked,
      overlay_elevation_position: document.getElementById("tmap-ov-ele-pos").value,
      show_pins: document.getElementById("tmap-pins").checked,
      // v0.9.74 — Foto-Pins (geteilt mit Animator auf Projekt-Ebene)
      ...(function() {
        const proj = (typeof getActiveProject === "function") ? getActiveProject() : null;
        const tm = proj?.tourmap || {};
        return {
          photos: Array.isArray(proj?.photos) ? proj.photos : [],
          photos_size_px: typeof tm.photos_size_px === "number" ? tm.photos_size_px : 48,
          photos_show: typeof tm.photos_show === "boolean" ? tm.photos_show : true,
        };
      })(),
    };

    const res = await api().tourmap_render(params);
    if (!res.ok) {
      if (res.error_code === "mapbox_token_missing") {
        toast(res.error, "warn", 6000);
        if (window.openSettingsModal) window.openSettingsModal();
        return;
      }
      if (res.error_code === "playwright_browser_missing") {
        // v0.9.229 — gemeinsamer Render-Engine-Guard (ui/js/util.js), exakt wie
        // im Animator: Download-Modal statt verwirrendem „geh in den Animator"-
        // Toast (Windows-Bug-Report Peter Straka). Nach Install Render erneut.
        if (typeof showRenderEngineMissingModal === "function") {
          showRenderEngineMissingModal(res.browsers_path, async () => {
            const r2 = await api().tourmap_render(params);
            if (!r2.ok) { toast(r2.error || "Fehler beim Start", "error", 6000); return; }
            document.getElementById("tmap-progress").classList.add("show");
            document.getElementById("tmap-result").classList.remove("show");
            setRenderingState(true);
            const cb = document.getElementById("tmap-cancel");
            if (cb) { cb.disabled = false; cb.textContent = "⨯ " + t("animator.btn.cancel"); }
            pollStatus();
          });
        } else {
          toast(res.error || "Render-Engine fehlt", "error", 8000);
        }
        return;
      }
      toast(res.error || "Fehler beim Start", "error");
      return;
    }
    document.getElementById("tmap-progress").classList.add("show");
    document.getElementById("tmap-result").classList.remove("show");
    // v0.9.12 — Render-Lock (synchron zu Animator)
    setRenderingState(true);
    {
      const btn = document.getElementById("tmap-cancel");
      if (btn) { btn.disabled = false; btn.textContent = "⨯ " + t("animator.btn.cancel"); }
    }
    pollStatus();
  });

  document.getElementById("tmap-cancel").addEventListener("click", async () => {
    const btn = document.getElementById("tmap-cancel");
    btn.disabled = true;
    btn.textContent = "⏳ " + t("animator.cancel.requesting");
    try { await api().tourmap_cancel(); } catch (_) {}
  });

  let pollTimer = null;
  async function pollStatus() {
    // v0.9.25 — kein Bridge-Call mehr wenn Window am Schließen
    if (window.__rzgpsShuttingDown) { clearTimeout(pollTimer); return; }
    const s = await api().tourmap_status();
    const pct = Math.round((s.progress || 0) * 100);
    document.getElementById("tmap-pct").textContent = pct + "%";
    document.getElementById("tmap-fill").style.width = pct + "%";
    document.getElementById("tmap-status").textContent = s.status || "";

    if (s.cancelled) {
      document.getElementById("tmap-progress").classList.remove("show");
      clearTimeout(pollTimer);
      setRenderingState(false);     // v0.9.12 — UI wieder freigeben
      toast(t("animator.cancel.toast"), "info", 4000);
      return;
    }
    if (s.error) {
      document.getElementById("tmap-progress").classList.remove("show");
      clearTimeout(pollTimer);
      setRenderingState(false);     // v0.9.12 — UI wieder freigeben
      toast("Render fehlgeschlagen: " + s.error.split("\n")[0], "error", 8000);
      return;
    }
    if (!s.running && s.progress >= 1.0) {
      document.getElementById("tmap-progress").classList.remove("show");
      setRenderingState(false);     // v0.9.12 — UI wieder freigeben
      const result = document.getElementById("tmap-result");
      result.classList.add("show");
      const img = document.getElementById("tmap-result-img");
      // Cache-Bust mit Date.now damit immer das aktuelle Bild geladen wird
      img.src = "file://" + s.output + "?t=" + Date.now();
      document.getElementById("tmap-result-meta").textContent = s.output;
      document.getElementById("tmap-result-finder").onclick = () => api().reveal_in_finder(s.output);
      document.getElementById("tmap-result-copy").onclick = async () => {
        // Native macOS copy via osascript wäre ideal — wir machen's vorerst
        // einfach: Pfad in Zwischenablage (Bild-Copy bräuchte AppleScript)
        try {
          await navigator.clipboard.writeText(s.output);
          toast(t("tourmap.toast.path_copied"), "success", 2500);
        } catch (e) {
          toast(t("tourmap.toast.copy_failed"), "error", 3000);
        }
      };
      document.getElementById("tmap-result-new").onclick = () => result.classList.remove("show");
      toast(t("tourmap.toast.done") + ": " + s.output.split("/").slice(-1)[0], "success", 5000);
      return;
    }
    pollTimer = setTimeout(pollStatus, 350);
  }

  return () => {
    clearTimeout(pollTimer);
    if (_viewportResizeObserver) {
      try { _viewportResizeObserver.disconnect(); } catch (_) {}
      _viewportResizeObserver = null;
    }
    // v0.9.29: Map-Pose-Cache raus — kollidiert mit fitTrackPreview-Refits.
    if (map) { try { map.remove(); } catch (_) {} }
  };
}
