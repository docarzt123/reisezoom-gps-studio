// Reisezoom GPS Studio — Animator-Modul

(window.RZGPS_MODULES = window.RZGPS_MODULES || {}).animator = {
  manifest: {
    slug: "animator",
    name: "Animator",
    description: "Track als Video rendern",
    icon: "▶",
    sort_order: 10,
  },
  mount: function (body, headerActions) { return mountAnimator(body, headerActions, { mode: "animator", moduleSlug: "animator" }); },
};

// v0.9.207 — Reiseroute = DRY-Klon des Animators: GENAU dieselbe mountAnimator-
// Funktion, nur `mode:"reiseroute"`. Kein zweites module.js, kein Code-Klon →
// Änderungen am Animator wirken automatisch hier mit. Eigener Tab + eigener
// Tab-State-Cache. (Phase 2: geladenes GPX als Ghost + Route statt GPX animieren.)
(window.RZGPS_MODULES = window.RZGPS_MODULES || {}).reiseroute = {
  manifest: {
    slug: "reiseroute",  // sort_order 20 — direkt nach Animator (10)
    name: "Reiseroute",
    description: "Anreise-Route animieren (GPX als Ghost)",
    icon: "🛣",
    sort_order: 20,
  },
  mount: function (body, headerActions) { return mountAnimator(body, headerActions, { mode: "reiseroute", moduleSlug: "reiseroute" }); },
};

// v0.9.308 — Tour-Map = DRY-Klon des Animators im STANDBILD-Modus. Dieselbe
// mountAnimator-Funktion, `mode:"staticFrame"`. Blendet die Animations-Regler
// aus (Dauer/FPS/Codec/Keyframe-Timeline) und rendert EIN PNG (still_frame).
// Ersetzt das alte modules/tourmap/ui/module.js (dort ist die Registrierung raus).
(window.RZGPS_MODULES = window.RZGPS_MODULES || {}).tourmap = {
  manifest: {
    slug: "tourmap",
    name: "Tour-Map",
    description: "Statische Karten-PNG",
    icon: "🗺",
    sort_order: 40,
  },
  mount: function (body, headerActions) { return mountAnimator(body, headerActions, { mode: "staticFrame", moduleSlug: "tourmap" }); },
};

function mountAnimator(body, headerActions, opts) {
  // v0.9.207/208 — opts steuert den DRY-Klon (Animator ↔ Reiseroute). RZ_MODE
  // gated das Reiseroute-Verhalten. _MODKEY ist der EIGENE Namespace pro Tab:
  // Settings (_activeProject[_MODKEY] via bindSetting/saveProjectSettings),
  // Tab-State-Cache, Undo, Accordion-State — alles getrennt zwischen Animator
  // und Reiseroute. (util.js `isProjectModule` muss _MODKEY kennen.)
  opts = opts || {};
  const RZ_MODE = opts.mode || "animator";
  const _isReiseroute = (RZ_MODE === "reiseroute");
  const _isStaticFrame = (RZ_MODE === "staticFrame");  // v0.9.308 — Tour-Map
  const _MODKEY = opts.moduleSlug || "animator";
  // v0.9.212 — Schilder/Fotos pro Modul trennen. Animator behält den Root-Key
  // "signs" (Back-Compat zu bestehenden Projekten); Reiseroute bekommt eigene
  // "reiseroute_signs". Sonst würde Reiseroute die Animator-Schilder zeigen.
  const _SIGNS_KEY = (_MODKEY === "animator") ? "signs" : (_MODKEY + "_signs");
  // v0.8.2: Stats-Pills hier raus — die GPX-Bar links im Modul-Header
  // zeigt schon Distanz/Zeit/Aufstieg/Abstieg. Wir lassen die Stats-
  // Elemente aber als hidden Stubs im DOM stehen damit der bestehende
  // Code (drawPreview etc.) noch ohne Crash document.getElementById()
  // machen kann.
  if (headerActions) {
    headerActions.innerHTML = `
      <div class="anim-stats-bar" id="anim-stats" hidden>
        <div class="anim-stats-empty" id="anim-stats-empty"></div>
        <div class="anim-stats-cards" id="anim-stats-cards" hidden>
          <span id="s-dist"></span><span id="s-time"></span><span id="s-asc"></span><span id="s-desc"></span>
        </div>
      </div>
    `;
  }

  body.innerHTML = `
    <aside class="panel" id="anim-panel">

      <!-- v0.8.1: „Quelle"-Sektion entfernt — GPX-Picker ist jetzt
           global in der Sub-Top-Bar oben (siehe ui/js/gpx-bar.js). -->

      <!-- v0.9.205 — Route / Anreise: Start+Ziel → Mapbox-Route ODER Flug-Bogen
           → synthetisches GPX → wie ein normaler Track animiert. -->
      <section class="section" data-accordion-section="route">
        <button class="section-collapse-header" type="button">
          <span>${t("route.section", "🛫 Route / Anreise")}</span>
          <span class="collapse-arrow">▸</span>
        </button>
        <div class="section-collapse-body" hidden>
          <div class="muted" style="font-size:11px; margin-bottom:8px; line-height:1.45;">
            ${t("route.intro", "Start und Ziel angeben — daraus wird eine Strecke berechnet und wie ein Track animiert (Kamera-Flug, Schilder, Render inklusive).")}
          </div>
          <div class="field">
            <label class="field-label">${t("route.mode", "Stil")}</label>
            <div class="seg-toggle" id="route-mode">
              <label class="seg-opt"><input type="radio" name="route-mode" value="road" checked> <span>${t("route.mode.road", "🛣️ Straße folgen")}</span></label>
              <label class="seg-opt"><input type="radio" name="route-mode" value="arc"> <span>${t("route.mode.arc", "✈️ Flugroute")}</span></label>
            </div>
          </div>
          <div class="field">
            <label class="field-label" for="route-start-input">${t("route.start", "Start")}</label>
            <div class="route-pt-row">
              <input type="text" id="route-start-input" placeholder="${t("route.placeholder", "Adresse / Ort oder lon,lat")}">
              <button type="button" class="btn btn-subtle" id="route-start-pick" title="${t("route.pick", "Auf der Karte klicken")}">📍</button>
            </div>
            <div class="route-pt-resolved muted" id="route-start-resolved"></div>
          </div>
          <div class="field">
            <label class="field-label" for="route-end-input">${t("route.end", "Ziel")}</label>
            <div class="route-pt-row">
              <input type="text" id="route-end-input" placeholder="${t("route.placeholder", "Adresse / Ort oder lon,lat")}">
              <button type="button" class="btn btn-subtle" id="route-end-pick" title="${t("route.pick", "Auf der Karte klicken")}">📍</button>
            </div>
            <div class="route-pt-resolved muted" id="route-end-resolved"></div>
          </div>
          <div class="field" id="route-profile-field">
            <label class="field-label" for="route-profile">${t("route.profile", "Fortbewegung")}</label>
            <select id="route-profile">
              <option value="driving">${t("route.profile.driving", "🚗 Auto")}</option>
              <option value="walking">${t("route.profile.walking", "🚶 Zu Fuß")}</option>
              <option value="cycling">${t("route.profile.cycling", "🚴 Fahrrad")}</option>
            </select>
            <div class="field" style="margin-top:6px;" title="${t("route.grob.tooltip", "Vereinfachte, gröbere Linie — nicht so kleinteilig wie eine echte Wanderung. Die Animation bleibt immer flüssig.")}">
              <label class="field-label">${t("route.coarseness", "Detailgrad")} <span class="label-val" id="route-coarse-v">55 %</span></label>
              <input type="range" id="route-coarse" min="0" max="100" step="5" value="55">
              <div class="route-coarse-ends muted"><span>${t("route.fine", "fein")}</span><span>${t("route.coarse", "grob")}</span></div>
            </div>
          </div>
          <button type="button" class="btn btn-primary" id="route-compute" style="width:100%; margin-top:4px;">${t("route.compute", "Route berechnen")}</button>
          <div class="muted" id="route-status" style="font-size:11px; margin-top:6px; line-height:1.4;"></div>
        </div>
      </section>

      <!-- v0.9.211 — GPX-Ghost (nur Reiseroute): das geladene GPX als
           konfigurierbare Hintergrund-Linie zum animierten Route-Track. -->
      <section class="section" data-accordion-section="ghost-gpx">
        <button class="section-collapse-header" type="button">
          <span>${t("route.ghost.section", "👻 GPX-Ghost")}</span>
          <span class="collapse-arrow">▸</span>
        </button>
        <div class="section-collapse-body" hidden>
          <div class="muted" style="font-size:11px; margin-bottom:8px; line-height:1.45;">
            ${t("route.ghost.intro", "Das geladene GPX (z.B. die Wanderung) als schwache Linie hinter der animierten Route.")}
          </div>
          <label class="checkbox-row">
            <input type="checkbox" id="route-ghost-show" checked>
            <span>${t("route.ghost.show", "GPX-Ghost anzeigen")}</span>
          </label>
          <div class="field" id="route-ghost-color-field">
            <label class="field-label">${t("route.ghost.color", "Farbe")} <span class="label-val" id="route-ghost-color-v">#7fa8ff</span></label>
            <input type="color" id="route-ghost-color" value="#7fa8ff">
          </div>
          <div class="field" id="route-ghost-opacity-field">
            <label class="field-label">${t("route.ghost.opacity", "Deckkraft")} <span class="label-val" id="route-ghost-opacity-v">60 %</span></label>
            <input type="range" id="route-ghost-opacity" min="5" max="100" step="5" value="60">
          </div>
          <div class="field" id="route-ghost-width-field">
            <label class="field-label">${t("route.ghost.width", "Linienbreite")} <span class="label-val" id="route-ghost-width-v">2.5 px</span></label>
            <input type="range" id="route-ghost-width" min="1" max="8" step="0.5" value="2.5">
          </div>
          <label class="checkbox-row">
            <input type="checkbox" id="route-ghost-dashed" checked>
            <span>${t("route.ghost.dashed", "Gestrichelt")}</span>
          </label>
        </div>
      </section>

      <!-- Karte (Akkordeon) — Stil, Terrain, Beleuchtung, Beschriftungen -->
      <section class="section" data-accordion-section="map">
        <button class="section-collapse-header" type="button">
          <span>${t("animator.section.map")}</span>
          <span class="collapse-arrow">▸</span>
        </button>
        <div class="section-collapse-body" hidden>
          <div class="field" id="anim-style-field">
            <label class="field-label" for="anim-style">${t("animator.field.style")}</label>
            <select id="anim-style">
              <option value="satellite">${t("animator.style.satellite")}</option>
              <option value="satellite_streets">${t("animator.style.satellite_streets")}</option>
              <option value="outdoors">${t("animator.style.outdoors")}</option>
              <option value="streets">${t("animator.style.streets")}</option>
              <option value="light">${t("animator.style.light")}</option>
              <option value="dark">${t("animator.style.dark")}</option>
              <option value="alpha">${t("animator.style.alpha")}</option>
            </select>
            <div class="osm-disabled-notice" id="anim-style-osm-notice" hidden>
              <span class="osm-disabled-title">${t("animator.style.osm_disabled_title")}</span>
              ${t("animator.style.osm_disabled_body")}
              <br>
              <button type="button" class="osm-disabled-cta" id="anim-style-osm-cta">${t("animator.style.osm_disabled_cta")}</button>
            </div>
            <div class="muted" id="anim-alpha-hint" hidden style="font-size:11px; margin-top:6px; line-height:1.45;">
              ${t("animator.style.alpha_hint")}
            </div>
          </div>
          <label class="checkbox-row">
            <input type="checkbox" id="anim-terrain" checked>
            <span>${t("animator.toggle.terrain")}</span>
          </label>
          <div class="field">
            <label class="field-label">${t("animator.field.exaggeration")} <span class="label-val" id="anim-ex-v">1.5×</span></label>
            <input type="range" id="anim-ex" min="0" max="4" step="0.1" value="1.5">
          </div>
          <div class="field">
            <label class="field-label" for="anim-mc-light">${t("map_config.light_preset")}</label>
            <select id="anim-mc-light">
              <option value="dawn">🌅 ${t("map_config.light.dawn")}</option>
              <option value="day" selected>☀️ ${t("map_config.light.day")}</option>
              <option value="dusk">🌇 ${t("map_config.light.dusk")}</option>
              <option value="night">🌙 ${t("map_config.light.night")}</option>
            </select>
          </div>
          <div class="field">
            <div class="sub-group-label">${t("map_config.elements")}</div>
            <label class="checkbox-row inline">
              <input type="checkbox" id="anim-mc-places" checked>
              <span>${t("map_config.elements.places")}</span>
            </label>
            <label class="checkbox-row inline">
              <input type="checkbox" id="anim-mc-roads" checked>
              <span>${t("map_config.elements.roads")}</span>
            </label>
            <label class="checkbox-row inline">
              <input type="checkbox" id="anim-mc-poi" checked>
              <span>${t("map_config.elements.poi")}</span>
            </label>
            <label class="checkbox-row inline">
              <input type="checkbox" id="anim-mc-transit" checked>
              <span>${t("map_config.elements.transit")}</span>
            </label>
            <label class="checkbox-row inline">
              <input type="checkbox" id="anim-mc-admin" checked>
              <span>${t("map_config.elements.admin")}</span>
              <button type="button" class="field-help" data-help="anim-admin"
                      title="${t("animator.help.show")}">?</button>
            </label>
            <div class="muted field-help-content" data-help-content="anim-admin" hidden
                 style="font-size:11px; margin-top:2px; line-height:1.4; padding-left:24px;">
              ${t("map_config.elements.admin_hint")}
            </div>
            <div class="quick-toggle-row">
              <button type="button" class="btn btn-subtle" id="anim-mc-all-off">${t("map_config.all_off")}</button>
              <button type="button" class="btn btn-subtle" id="anim-mc-all-on">${t("map_config.all_on")}</button>
            </div>
          </div>
        </div>
      </section>

      <!-- Track (Akkordeon) — Farbe, Dicke, Schlagschatten, Detail-Punkte -->
      <section class="section" data-accordion-section="track">
        <button class="section-collapse-header" type="button">
          <span>${t("animator.section.track")}</span>
          <span class="collapse-arrow">▸</span>
        </button>
        <div class="section-collapse-body" hidden>
          <div class="field">
            <label class="field-label">${t("animator.field.color")} <span class="label-val" id="anim-color-v">#ff6b35</span></label>
            <input type="color" id="anim-color" value="#ff6b35">
          </div>
          <div class="field">
            <label class="field-label">${t("animator.field.line_width")} <span class="label-val" id="anim-lw-v">3.5 px</span></label>
            <input type="range" id="anim-lw" min="1" max="10" step="0.5" value="3.5">
          </div>
          <div class="field">
            <label class="field-label" for="anim-line-style">${t("animator.field.line_style")}</label>
            <select id="anim-line-style">
              <option value="solid" selected>${t("animator.line_style.solid")}</option>
              <option value="dashed">${t("animator.line_style.dashed")}</option>
              <option value="dotted">${t("animator.line_style.dotted")}</option>
              <option value="dashdot">${t("animator.line_style.dashdot")}</option>
              <!-- v0.8.12 — Röhre als 2D-Style (Marc-Wunsch: gehört zu den Linien-Stilen, nicht extra Dropdown). -->
              <option value="tube">${t("animator.line_style.tube")}</option>
            </select>
          </div>
          <div class="field" id="anim-line-spacing-field" hidden title="${t("animator.line_style_spacing.tooltip")}">
            <label class="field-label">${t("animator.field.line_style_spacing")} <span class="label-val" id="anim-line-spacing-v">1.0×</span></label>
            <input type="range" id="anim-line-spacing" min="0.5" max="5" step="0.25" value="1">
          </div>
          <!-- v0.9.309 — Checkbox raus (Marc): der Stärke-Slider IST der Schalter.
               0 px = aus, hochziehen = Schatten/Glow an. -->
          <div class="field" id="anim-shadow-strength-field" title="${t("animator.shadow.tooltip")}">
            <label class="field-label">${t("animator.toggle.shadow")} <span class="label-val" id="anim-shadow-strength-v">0 px</span></label>
            <input type="range" id="anim-shadow-strength" min="0" max="10" step="0.5" value="0">
          </div>
          <div class="field" id="anim-glow-strength-field" title="${t("animator.glow.tooltip")}">
            <label class="field-label">${t("animator.toggle.glow")} <span class="label-val" id="anim-glow-strength-v">0 px</span></label>
            <input type="range" id="anim-glow-strength" min="0" max="10" step="0.5" value="0">
          </div>
          <!-- v0.9.169 — Ghost-Track: ganze Route schwach vorgezeichnet -->
          <label class="checkbox-row" title="${t("animator.ghost.tooltip", "Zeigt die ganze Route schon schwach/transparent im Hintergrund; nur der animierte Teil wird voll gezeichnet.")}">
            <input type="checkbox" id="anim-ghost-enabled">
            <span>${t("animator.toggle.ghost_track", "Ghost-Track (ganze Route schwach)")}</span>
          </label>
          <div class="field" id="anim-ghost-color-field" hidden>
            <label class="field-label">${t("animator.field.ghost_color", "Ghost-Track-Farbe")} <span class="label-val" id="anim-ghost-color-v">#ff6b35</span></label>
            <input type="color" id="anim-ghost-color" value="#ff6b35">
          </div>
          <div class="field" id="anim-ghost-opacity-field" hidden>
            <label class="field-label">${t("animator.field.ghost_opacity", "Deckkraft Ghost-Track")} <span class="label-val" id="anim-ghost-opacity-v">30 %</span></label>
            <input type="range" id="anim-ghost-opacity" min="5" max="80" step="5" value="30">
          </div>
          <div class="field">
            <label class="field-label">${t("animator.field.point_count")}
              <span class="label-val" id="anim-pointcount-v">— / —</span>
              <!-- v0.8.19 — Hint als klick-Tooltip statt Dauer-Text:
                   liest man einmal, dann nicht mehr. -->
              <button type="button" class="field-help" data-help="point_count"
                      title="${t("animator.help.show")}">?</button>
            </label>
            <input type="range" id="anim-pointcount" min="10" max="100" step="1" value="100" disabled>
            <div class="muted field-help-content" data-help-content="point_count" hidden
                 style="font-size:11px; margin-top:6px; line-height:1.45;">
              ${t("animator.point_count.hint")}
            </div>
          </div>
        </div>
      </section>

      <!-- v0.9.156 — Multi-Track (Marc-Wunsch 2026-06-01): mehrere Touren
           hintereinander animieren, Kamera fliegt im Kino-Stil dazwischen.
           Die geladene GPX (oben in der Bar) ist immer „Tour 1"; hier kommen
           weitere Touren mit eigener Farbe dazu.
           v0.9.162 — VORERST AUSGEBLENDET (display:none): Multi-Track ist noch
           nicht fertig (Marc-Entscheidung). Code bleibt drin, nur unsichtbar;
           _extraTours bleibt leer, daher nutzt der Render nie den Multi-Track-
           Pfad. Zum Reaktivieren das style=display:none unten entfernen. -->
      <section class="section" data-accordion-section="tours" style="display:none">
        <button class="section-collapse-header" type="button">
          <span>${t("animator.section.tours", "🧭 Mehrere Touren")}</span>
          <span class="collapse-arrow">▸</span>
        </button>
        <div class="section-collapse-body" hidden>
          <p class="muted" style="font-size:11px; line-height:1.45; margin:0 0 8px;">
            ${t("animator.tours.hint", "Weitere Touren werden nach der ersten animiert — die Kamera fliegt im Kino-Stil von einer zur nächsten.")}
          </p>
          <div id="anim-tours-list" class="anim-tours-list"></div>
          <button type="button" class="btn btn-small" id="anim-tours-add" style="width:100%; margin-top:4px;">
            ＋ ${t("animator.tours.add", "Tour hinzufügen")}
          </button>
          <div class="field" id="anim-fly-field" hidden style="margin-top:10px;">
            <label class="field-label">${t("animator.field.fly_duration", "Kinoflug-Dauer")} <span class="label-val" id="anim-fly-v">3.0 s</span></label>
            <input type="range" id="anim-fly" min="1" max="8" step="0.5" value="3">
          </div>
        </div>
      </section>


      <!-- Overlays (Akkordeon) — Stats-Boxen + Höhenprofil -->
      <section class="section" data-accordion-section="overlays">
        <button class="section-collapse-header" type="button">
          <span>${t("animator.section.overlays")}</span>
          <span class="collapse-arrow">▸</span>
        </button>
        <div class="section-collapse-body" hidden>
          <label class="checkbox-row">
            <input type="checkbox" id="anim-overlays" checked>
            <span><strong>${t("animator.toggle.overlays")}</strong></span>
          </label>
          <div class="overlay-groups" id="anim-overlay-groups">
            <div class="overlay-group" id="anim-overlay-totals-group">
              <label class="checkbox-row inline">
                <input type="checkbox" id="anim-ov-totals" checked>
                <span>${t("animator.overlay.totals")}</span>
              </label>
              <select id="anim-ov-totals-pos" class="pos-select" title="${t("animator.overlay.position")}">
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
              <div class="ov-timing" title="${t("animator.overlay.timing_tip")}">
                <span class="ov-timing-lbl">⏱ ${t("animator.overlay.timing")}</span>
                <input type="number" id="anim-ov-totals-from" class="ov-time-in" min="0" step="0.5" placeholder="0">
                <span class="ov-timing-dash">–</span>
                <input type="number" id="anim-ov-totals-to" class="ov-time-in" min="0" step="0.5" placeholder="${t("animator.overlay.timing_end")}">
                <span class="ov-timing-unit">s</span>
              </div>
              <div class="ov-fieldeditor" id="anim-ov-totals-fields" data-ovbox="totals"></div>
            </div>
            <div class="overlay-group" id="anim-overlay-live-group">
              <label class="checkbox-row inline">
                <input type="checkbox" id="anim-ov-live" checked>
                <span>${t("animator.overlay.live")}</span>
              </label>
              <select id="anim-ov-live-pos" class="pos-select" title="${t("animator.overlay.position")}">
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
              <div class="ov-timing" title="${t("animator.overlay.timing_tip")}">
                <span class="ov-timing-lbl">⏱ ${t("animator.overlay.timing")}</span>
                <input type="number" id="anim-ov-live-from" class="ov-time-in" min="0" step="0.5" placeholder="0">
                <span class="ov-timing-dash">–</span>
                <input type="number" id="anim-ov-live-to" class="ov-time-in" min="0" step="0.5" placeholder="${t("animator.overlay.timing_end")}">
                <span class="ov-timing-unit">s</span>
              </div>
              <div class="ov-fieldeditor" id="anim-ov-live-fields" data-ovbox="live"></div>
            </div>
            <div class="overlay-group" id="anim-overlay-elevation-group">
              <label class="checkbox-row inline">
                <input type="checkbox" id="anim-ov-ele" checked>
                <span>${t("animator.overlay.elevation")}</span>
              </label>
              <select id="anim-ov-ele-pos" class="pos-select" title="${t("animator.overlay.position")}">
                <option value="bc">${t("animator.pos.bc")}</option>
                <option value="bcw">${t("animator.pos.bcw")}</option>
                <option value="tc">${t("animator.pos.tc")}</option>
                <option value="tcw">${t("animator.pos.tcw")}</option>
                <option value="tl">${t("animator.pos.tl")}</option>
                <option value="tr">${t("animator.pos.tr")}</option>
                <option value="bl">${t("animator.pos.bl")}</option>
                <option value="br">${t("animator.pos.br")}</option>
              </select>
              <div class="ov-timing" title="${t("animator.overlay.timing_tip")}">
                <span class="ov-timing-lbl">⏱ ${t("animator.overlay.timing")}</span>
                <input type="number" id="anim-ov-ele-from" class="ov-time-in" min="0" step="0.5" placeholder="0">
                <span class="ov-timing-dash">–</span>
                <input type="number" id="anim-ov-ele-to" class="ov-time-in" min="0" step="0.5" placeholder="${t("animator.overlay.timing_end")}">
                <span class="ov-timing-unit">s</span>
              </div>
            </div>
            <!-- v0.9.321 — Stats-Editor: globales Styling aller Stats-Boxen -->
            <div class="ov-style" style="margin-top:10px; padding-top:8px; border-top:1px dashed var(--border);">
              <div class="ov-style-title">🎨 ${t("animator.overlay.style", "Aussehen der Stats-Boxen")}</div>
              <div class="ov-style-row">
                <label for="anim-ov-font">${t("animator.overlay.font", "Schrift")}</label>
                <select id="anim-ov-font" class="pos-select">
                  <option value="system">${t("animator.overlay.font_system", "System (Standard)")}</option>
                  <option value="nunito">Nunito</option>
                  <option value="quicksand">Quicksand</option>
                  <option value="fredoka">Fredoka</option>
                  <option value="oswald">Oswald</option>
                  <option value="bebas">Bebas Neue</option>
                </select>
              </div>
              <div class="ov-style-row">
                <label for="anim-ov-textcolor">${t("animator.overlay.text_color", "Textfarbe")}</label>
                <input type="color" id="anim-ov-textcolor" value="#ffffff">
              </div>
              <div class="ov-style-row">
                <label for="anim-ov-bgcolor">${t("animator.overlay.bg_color", "Hintergrund")}</label>
                <input type="color" id="anim-ov-bgcolor" value="#000000">
              </div>
              <div class="ov-style-row">
                <label for="anim-ov-bgopacity">${t("animator.overlay.bg_opacity", "Deckkraft Hintergrund")}</label>
                <input type="range" id="anim-ov-bgopacity" min="0" max="100" step="5" value="55">
                <span class="ov-style-val" id="anim-ov-bgopacity-val">55 %</span>
              </div>
            </div>
            <!-- v0.9.41 — Stats-Quelle bei aktivem Trim:
                 Trim-Werte (Default, Marc-Spec) vs. Gesamt-Track-Werte. -->
            <div style="margin-top:10px; padding-top:8px; border-top:1px dashed var(--border);">
              <label class="checkbox-row inline"
                     title="${t("animator.overlay.stats_use_trim_tip")}">
                <input type="checkbox" id="anim-stats-use-trim" checked>
                <span>${t("animator.overlay.stats_use_trim")}</span>
              </label>
              <!-- v0.9.55 (Marc) — Track-Linie VOR Trim-Start im Render zeigen? -->
              <label class="checkbox-row inline"
                     style="margin-top:6px;"
                     title="${t("animator.overlay.show_pretrim_tip")}">
                <input type="checkbox" id="anim-show-pretrim" checked>
                <span>${t("animator.overlay.show_pretrim")}</span>
              </label>
            </div>
          </div>
        </div>
      </section>

      <!-- Kamera (Akkordeon) — v0.8.16 Marc-Refactor:
           Body wechselt zwischen Classic-Modus (Pitch + Rotation, statisch
           über das ganze Video) und Keyframe-Modus (Anchor + Pitch + Bearing
           + Zoom + Follow + Buttons für einen ausgewählten Keyframe).
           Umgeschaltet über die „🎥 Keyframe-Editor"-Checkbox ganz oben in
           der Section. So sieht der User nur die Regler die zum gewählten
           Modus passen. -->
      <section class="section" data-accordion-section="camera" id="anim-camera-section">
        <button class="section-collapse-header" type="button">
          <span id="anim-camera-section-title">${t("animator.section.camera")}</span>
          <span class="collapse-arrow">▸</span>
        </button>
        <div class="section-collapse-body" hidden>
          <!-- Master-Toggle: Keyframe-Editor an/aus -->
          <label class="checkbox-row" style="margin-bottom:10px; padding-bottom:10px; border-bottom:1px dashed rgba(255,255,255,0.08);" title="${t("animator.kf.enable_tooltip")}">
            <input type="checkbox" id="anim-kf-enabled">
            <span>🎥 ${t("animator.kf.enable_label")}</span>
          </label>

          <!-- v0.9.318 (Marc) — Ruhige Kamera (entkoppelte FreeCamera): gegen das
               Hoch-Runter-Hüpfen über bergigem 3D-Terrain. Kamera reitet nicht mehr
               aufs Gelände, sondern fliegt entkoppelt durch den 3D-Raum (framing-treu
               an den Keyframes). Default AUS = alter, gut getesteter Modus. Gilt für
               ALLE Kamera-Modi → steht über der Classic/KF-Umschaltung. -->
          <label class="checkbox-row" id="anim-smooth-camera-row" style="margin-bottom:10px;"
                 title="${t("animator.field.smooth_camera_tip", "Gegen das Hoch-Runter-Hüpfen der Kamera über bergigem 3D-Terrain. Aus = klassisch (Standard). An = ruhige, entkoppelte Kamera.")}">
            <input type="checkbox" id="anim-smooth-camera">
            <span>🎥 ${t("animator.field.smooth_camera", "Ruhige Kamera (3D-Terrain)")}</span>
          </label>

          <!-- Classic-Modus (KF aus): statischer Pitch + lineare Rotation über das ganze Video.
               v0.8.17: zusätzlich Zoom-Stufe (absoluter Mapbox-Zoom; setzt direkt die Map)
               und Track-folgen-Toggle (Backend-Field camera_follow_track). -->
          <div id="anim-camera-body-classic">
            <div class="field">
              <label class="field-label">${t("animator.field.pitch")} <span class="label-val" id="anim-pitch-v">40°</span></label>
              <input type="range" id="anim-pitch" min="0" max="80" step="1" value="40">
            </div>
            <div class="field">
              <label class="field-label">${t("animator.field.rotation")} <span class="label-val" id="anim-rot-v">20°</span></label>
              <input type="range" id="anim-rot" min="0" max="60" step="1" value="20">
            </div>
            <!-- v0.9.107 — Spin als Velocity-Slider raus. Drehung wird
                 deklarativ über KF center.lng-Werte (Welt-Drehung) gesteuert.
                 Konstante Rotation = 2 KFs mit Lng-Differenz. -->

            <div class="field">
              <label class="field-label">${t("animator.field.zoom")} <span class="label-val" id="anim-zoom-v">12.0</span></label>
              <input type="range" id="anim-zoom" min="0" max="18" step="0.1" value="12">
            </div>
            <label class="checkbox-row" title="${t("animator.field.camera_follow_track_tooltip")}">
              <input type="checkbox" id="anim-camera-follow">
              <span>🚶 ${t("animator.field.camera_follow_track")}</span>
            </label>
            <!-- v0.9.275 (Nutzer) — Trägheit: weiches Nachziehen statt hartem Kleben am Punkt.
                 Nur sinnvoll wenn „Kamera folgt Track" an ist. -->
            <div class="field" id="anim-follow-inertia-row">
              <label class="field-label">${t("animator.field.follow_inertia", "Kamera-Trägheit")} <span class="label-val" id="anim-follow-inertia-v">0%</span></label>
              <input type="range" id="anim-follow-inertia" min="0" max="100" step="5" value="0"
                     title="${t("animator.field.follow_inertia_tip", "0 = hart am Punkt (kann wackeln), höher = die Kamera zieht weicher nach")}">
            </div>

            <!-- v0.9.310 — Standbild-Modus (Tour-Map): feste Kamera-Regler.
                 Per Default hidden, wird nur im staticFrame-Modus eingeblendet
                 (siehe _isStaticFrame-Block). Steuert Ausrichtung (bearing),
                 Randabstand (padding_pct) und Start/Ziel-Markierung (show_pins)
                 — direkt WYSIWYG in der Vorschau (fitTrackPreview liest sie). -->
            <div id="anim-static-camera" hidden>
              <div class="field">
                <label class="field-label">${t("animator.field.bearing", "Ausrichtung")} <span class="label-val" id="anim-static-bearing-v">-10°</span></label>
                <input type="range" id="anim-static-bearing" min="-180" max="180" step="1" value="-10"
                       title="${t("animator.field.bearing_tip", "Drehung der Karte (Kompass-Richtung nach oben)")}">
              </div>
              <div class="field">
                <label class="field-label">${t("animator.field.padding", "Randabstand")} <span class="label-val" id="anim-static-padding-v">8%</span></label>
                <input type="range" id="anim-static-padding" min="0" max="30" step="1" value="8"
                       title="${t("animator.field.padding_tip", "Luft zwischen Track und Bildrand")}">
              </div>
              <label class="checkbox-row" title="${t("animator.field.static_pins_tip", "Start- und Endpunkt als Markierung auf der Karte")}">
                <input type="checkbox" id="anim-static-pins" checked>
                <span>📍 ${t("animator.field.static_pins", "Start/Ziel-Markierung")}</span>
              </label>
            </div>
          </div>

          <!-- Keyframe-Modus (KF an): pro Keyframe Anchor/Pitch/Bearing/Zoom + Buttons.
               Inhalt war v0.7-v0.8.15 in der separaten #anim-kf-section.
               Wird durch die Master-Toggle-Checkbox in Animator-UI sichtbar gemacht;
               einzelne Felder erscheinen erst wenn ein KF ausgewählt ist (renderKeyframeEditor). -->
          <div id="anim-camera-body-keyframe" hidden>
            <!-- Hint wenn kein KF ausgewählt -->
            <div class="muted" id="anim-kf-empty-hint" style="font-size:12px; line-height:1.45; padding:6px 0;">
              ${t("animator.kf.empty_hint")}
            </div>

            <!-- Editor-Felder (sichtbar wenn ein KF ausgewählt ist) -->
            <!-- v0.9.3: jedes Property-Feld hat data-prop=kind damit
                 renderKeyframeEditor pro Lane einzeln togglen kann
                 (Per-Property-Edit-Modus). -->
            <div id="anim-kf-editor-fields" hidden>
              <div class="field" data-prop="anchor">
                <label class="field-label">${t("animator.kf.anchor")}
                  <span class="label-val" id="anim-kf-anchor-v">0%</span>
                </label>
                <input type="range" id="anim-kf-anchor" min="0" max="100" step="0.5" value="0">
              </div>
              <div class="field" data-prop="pitch">
                <label class="field-label">${t("animator.kf.pitch")}
                  <span class="label-val" id="anim-kf-pitch-v">40°</span>
                  <!-- v0.9.60 (Marc-Bug): Mini-Reset-Knopf für Pitch=0.
                       Nötig bei Welt-/Erdkugel-Sicht (Mapbox tilted die Globe
                       bei Pitch > 0 → erscheint im unteren Drittel). -->
                  <button type="button" class="kf-reset-btn" id="anim-kf-pitch-reset"
                          title="${t("animator.kf.pitch_reset_tip")}">↺ 0°</button>
                </label>
                <input type="range" id="anim-kf-pitch" min="0" max="85" step="1" value="40">
              </div>
              <div class="field" data-prop="bearing">
                <label class="field-label">${t("animator.kf.bearing")}
                  <span class="label-val" id="anim-kf-bearing-v">0°</span>
                </label>
                <input type="range" id="anim-kf-bearing" min="-180" max="180" step="1" value="0">
              </div>
              <div class="field" data-prop="zoom">
                <label class="field-label">${t("animator.kf.zoom")}
                  <span class="label-val" id="anim-kf-zoom-v">12.0</span>
                </label>
                <!-- v0.8.14 — absoluter Zoom (0–22, wie Mapbox). Intern als zoom_offset gespeichert. -->
                <input type="range" id="anim-kf-zoom" min="0" max="22" step="0.1" value="12">
              </div>
              <!-- v0.9.136 — Karten-Position pro KF (Längen-/Breitengrad),
                   gehört zur center-Lane. Längengrad ist ABGEWICKELT: Werte
                   über ±180° = volle Welt-Drehungen auf dem Weg vom vorherigen
                   Keyframe (Insta360-Modell). Beim Ziehen der Karte zählt der
                   Wert automatisch hoch; größere Werte ins Label tippbar. -->
              <div class="field" data-prop="center" title="${t("animator.kf.center_tooltip", "Karten-Position dieses Keyframes. Längengrad abgewickelt: Werte über ±180° = volle Erd-Drehungen auf dem Weg vom vorherigen Keyframe (wie Insta360). Beim Ziehen der Karte zählt der Wert automatisch hoch.")}">
                <div class="row-2">
                  <div class="field">
                    <label class="field-label">🌐 ${t("animator.kf.lng", "Länge")}
                      <span class="label-val" id="anim-kf-lng-v">0°</span>
                    </label>
                    <input type="range" id="anim-kf-lng" min="-540" max="540" step="0.1" value="0">
                  </div>
                  <div class="field">
                    <label class="field-label">↕ ${t("animator.kf.lat", "Breite")}
                      <span class="label-val" id="anim-kf-lat-v">0°</span>
                    </label>
                    <input type="range" id="anim-kf-lat" min="-85" max="85" step="0.1" value="0">
                  </div>
                </div>
              </div>
              <!-- v0.9.109 — Welt-Position (X/Y in %) pro KF, eigene Lane
                   "position". Setzt Mapbox-padding beim Render. -->
              <div data-prop="position" title="${t("animator.kf.position_tooltip", "Welt-Position im Viewport — X verschiebt horizontal, Y vertikal. -50% bis +50% der Viewport-Größe.")}">
                <div class="row-2">
                  <div class="field">
                    <label class="field-label">↔ ${t("animator.kf.position_x", "Welt X")}
                      <span class="label-val" id="anim-kf-position-x-v">0 %</span>
                    </label>
                    <input type="range" id="anim-kf-position-x" min="-50" max="50" step="1" value="0">
                  </div>
                  <div class="field">
                    <label class="field-label">↕ ${t("animator.kf.position_y", "Welt Y")}
                      <span class="label-val" id="anim-kf-position-y-v">0 %</span>
                    </label>
                    <input type="range" id="anim-kf-position-y" min="-50" max="50" step="1" value="0">
                  </div>
                </div>
              </div>

              <!-- v0.9.6 — Follow-Track-Toggle in einem Wrapper mit data-prop=center
                   damit Color-Strip + Per-Property-Sichtbarkeit (v0.9.5) greifen.
                   Hilfetext jetzt hinter ?-Button (Marc-Spec 2026-05-23). -->
              <div class="kf-follow-wrap" data-prop="center" style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                <label class="checkbox-row" style="flex:1 1 auto; margin:0;">
                  <input type="checkbox" id="anim-kf-follow-track">
                  <span>🚶 ${t("animator.kf.follow_track")}</span>
                </label>
                <button type="button" class="field-help" data-help="kf-follow-hint"
                        title="${t("animator.help.show")}">?</button>
              </div>
              <div class="muted field-help-content" data-help-content="kf-follow-hint" hidden
                   style="font-size:11px; margin-top:6px; line-height:1.45;">
                ${t("animator.kf.follow_tip")}
              </div>
              <div class="kf-actions" style="display:flex; flex-direction:column; gap:6px; margin-top:8px;">
                <button type="button" class="btn btn-subtle" id="anim-kf-from-map">
                  📍 ${t("animator.kf.from_map")}
                </button>
                <button type="button" class="btn btn-subtle" id="anim-kf-delete" style="color:#ff7a7a; border-color:rgba(255,122,122,0.3);">
                  🗑 ${t("animator.kf.delete")}
                </button>
              </div>
              <!-- v0.8.20 — Hilfetexte als ?-Tooltips zusammengefasst.
                   Marc-Wunsch: „liest man auch nur 1x". -->
              <div style="display:flex; gap:8px; margin-top:10px; flex-wrap: wrap;">
                <button type="button" class="field-help-pill" data-help="kf-edit-hint"
                        title="${t("animator.help.show")}">? ${t("animator.help.label.kf_edit")}</button>
                <button type="button" class="field-help-pill" data-help="kf-delete-hint"
                        title="${t("animator.help.show")}">? ${t("animator.help.label.kf_delete")}</button>
              </div>
              <div class="muted field-help-content" data-help-content="kf-edit-hint" hidden
                   style="font-size:11px; margin-top:6px; line-height:1.45;">
                ${t("animator.kf.hint")}
              </div>
              <div class="muted field-help-content" data-help-content="kf-delete-hint" hidden
                   style="font-size:11px; margin-top:6px; line-height:1.45;">
                ${t("animator.kf.delete_hint")}
              </div>
            </div>
          </div>
          <!-- v0.9.88 — Cinematic-Flyto-Toggle: nur sichtbar im KF-Modus, weil
               im Classic-Modus die impliziten Default-KFs identischen Zoom haben
               (Δzoom=0 → van-Wijk wird nie aktiv → Toggle wäre nutzlos). -->
          <label class="checkbox-row" id="anim-cinematic-flyto-row" hidden style="margin-top:8px;" title="${t("animator.field.cinematic_flyto_tooltip", "Bei großen Zoom-Sprüngen (Globe→Detail) macht die Kamera einen leicht ausgreifenden Bogen — wie Mapbox' flyTo. Schöner Cinematic-Effekt, kann aber 'zu weit raus zoomen' wirken. Ausschalten = strikte lineare Interpolation.")}">
            <input type="checkbox" id="anim-cinematic-flyto" checked>
            <span>🎬 ${t("animator.field.cinematic_flyto", "Cineastischer Flug")}</span>
          </label>
          <!-- v0.9.130 — Welt zentrieren als zwei Buttons nebeneinander:
               (1) auf Track-Startpunkt → Erde bleibt beim Reinzoom fixiert
                   auf dem Anfang, ideal für „Erde → Track-Start"-Choreo
               (2) auf Welt-Mitte (Greenwich/Äquator [10,0]) → klassische
                   frontale Erd-Sicht wie vor v0.9.129, Track sitzt off-center
                   und die Kamera fliegt beim Render dorthin rein.
               Beide setzen pitch=0, zoom=0, Welt-Padding-Defaults. -->
          <div class="kf-world-center-row" style="margin-top:8px; display:flex; gap:6px;">
            <button type="button" class="btn btn-subtle kf-world-btn" id="anim-world-center-start"
                    style="flex:1; min-width:0;"
                    title="${t("animator.kf.world_center_start_tip", "Welt-Sicht zentriert auf den Track-STARTPUNKT. Beim Reinzoomen bleibt der Startpunkt fixiert (kein Wandern durch die Welt). Im KF-Modus wird ein Welt-KF angelegt.")}">
              🌍📍 <span>${t("animator.kf.world_center_start", "Auf Start")}</span>
            </button>
            <button type="button" class="btn btn-subtle kf-world-btn" id="anim-world-center-bbox"
                    style="flex:1; min-width:0;"
                    title="${t("animator.kf.world_center_bbox_tip", "Welt-Sicht zentriert auf die WELT-MITTE (Greenwich/Äquator). Klassische frontale Erd-Ansicht wie früher — der Track sitzt off-center, die Kamera fliegt beim Render dorthin rein. Im KF-Modus wird ein Welt-KF angelegt.")}">
              🌍⌖ <span>${t("animator.kf.world_center_bbox", "Welt-Mitte")}</span>
            </button>
          </div>
          <!-- v0.9.103 — XY-Slider zum visuellen Verschieben der Welt
               im Viewport. Bei Globe-Projektion ist center-Setzen =
               sphärische Rotation (dreht nur die Erde), nicht visuelle
               Translation. Mit Mapbox-Padding wird das ganze Erd-Objekt
               im Viewport verschoben. Range -50% bis +50% der Viewport-
               Höhe/Breite. -->
          <!-- v0.9.109 — Welt-Drehung + Welt-Position Slider sind jetzt im
               KF-Editor-Block (zusammen mit Pitch/Bearing/Zoom). Hier
               unter dem Welt-Button bleibt nur der Button selbst. -->

        </div>
      </section>

      <!-- v0.9.198 — Schilder UND Fotos vereint. Ein Foto = Schild mit Bild. -->
      <section class="section" data-accordion-section="signs" id="anim-signs-section">
        <button class="section-collapse-header" type="button">
          <span>${t("animator.section.signs_photos", "🚩 Schilder und Fotos")}</span>
          <span class="collapse-arrow">▸</span>
        </button>
        <div class="section-collapse-body" hidden>
          <div style="display:flex; gap:6px; align-items:center;">
            <button type="button" class="btn btn-subtle" style="flex:1;" id="anim-signs-place">${t("signs.place_button", "📍 Auf Track")}</button>
            <button type="button" class="btn btn-subtle" style="flex:1;" id="anim-signs-place-free">${t("signs.place_free_button", "📌 Frei platzieren")}</button>
            <button type="button" class="field-help" data-help="signs-photos" title="${t("animator.help.show")}">?</button>
          </div>
          <div class="muted field-help-content" data-help-content="signs-photos" hidden style="font-size:11px; margin-top:6px; line-height:1.45;">
            ${t("signs.help", "Schilder und Fotos entlang der Route — ein Foto ist ein Schild mit Bild. Mit „📷 Fotos hinzufügen“ kommen Fotos (mit GPS) automatisch an ihre Aufnahme-Koordinaten. Alles erscheint im Video, sobald der Marker den Punkt erreicht. In der Liste: ⠿ ziehen zum Sortieren, Häkchen = an/aus, ✎ = bearbeiten, ✕ = löschen.")}
          </div>
          <div style="display:flex; gap:6px; margin-top:6px;">
            <button type="button" class="btn btn-subtle" style="flex:1;" id="anim-signs-add-photos">${t("signs.add_photos", "📷 Fotos hinzufügen")}</button>
            <button type="button" class="btn btn-subtle" style="flex:1;" id="anim-signs-add-gtg">${t("photos.from_geotagger", "Aus Geotagger")}</button>
          </div>
          <div class="muted" id="anim-signs-place-hint" style="font-size:11px; margin-top:4px; display:none;">${t("signs.place_active", "Klick auf den Track, um das Schild zu setzen … (Esc bricht ab)")}</div>
          <div class="field" style="margin-top:8px;">
            <label class="checkbox">
              <input type="checkbox" id="anim-signs-show" checked>
              <span>${t("signs.show_combined", "Auf Karte anzeigen")}</span>
            </label>
            <label class="checkbox" style="margin-top:4px;">
              <input type="checkbox" id="anim-signs-preview-all">
              <span>${t("signs.preview_all", "In der Vorschau ALLE zeigen")}</span>
            </label>
          </div>
          <div class="anim-photos-bulk" style="display:flex; justify-content:space-between; align-items:center; margin:8px 0 6px; font-size:11px;">
            <span class="muted" id="anim-signs-count"></span>
            <span style="display:flex; gap:6px;">
              <button type="button" class="btn-link-sm" id="anim-signs-all-on">${t("photos.select_all", "Alle an")}</button>
              <span class="muted">·</span>
              <button type="button" class="btn-link-sm" id="anim-signs-all-off">${t("photos.select_none", "Alle aus")}</button>
            </span>
          </div>
          <div class="photos-list" id="anim-signs-list"></div>
          <div class="anim-photos-foot" style="display:flex; justify-content:flex-end; align-items:center; margin-top:8px;">
            <button type="button" class="btn btn-danger-subtle" id="anim-signs-clear">${t("signs.clear_all", "🗑 Alle entfernen")}</button>
          </div>
        </div>
      </section>

      <!-- Video-Einstellungen (Akkordeon) — Dauer/Hold + Auflösung + FPS + Codec -->
      <section class="section" data-accordion-section="video">
        <button class="section-collapse-header" type="button">
          <span>${t("animator.section.video")}</span>
          <span class="collapse-arrow">▸</span>
        </button>
        <div class="section-collapse-body" hidden>
          <div class="row-3">
            <div class="field">
              <label class="field-label">${t("animator.field.intro")}</label>
              <input type="number" id="anim-intro" min="0" max="20" value="0">
            </div>
            <div class="field">
              <label class="field-label">${t("animator.field.duration")}</label>
              <input type="number" id="anim-dur" min="3" max="60" value="12">
            </div>
            <div class="field">
              <label class="field-label">${t("animator.field.hold")}</label>
              <input type="number" id="anim-hold" min="0" max="20" value="5">
            </div>
          </div>
          <div class="field">
            <label class="field-label">${t("animator.field.resolution")}</label>
            <div class="res-picker">
              <button class="res-btn" data-w="3840" data-h="2160" title="3840×2160 · 16:9">4K</button>
              <button class="res-btn" data-w="1920" data-h="1080" title="1920×1080 · 16:9">1080p</button>
              <button class="res-btn" data-w="2160" data-h="3840" title="2160×3840 · 9:16 Hochkant">4K↕</button>
              <button class="res-btn" data-w="1080" data-h="1920" title="1080×1920 · 9:16 Hochkant (Shorts/Reels)">1080↕</button>
            </div>
            <div class="row-2 res-custom">
              <input type="number" id="anim-w" min="640" max="7680" step="2" value="3840" placeholder="${t("animator.field.width")}">
              <input type="number" id="anim-h" min="360" max="7680" step="2" value="2160" placeholder="${t("animator.field.height")}">
            </div>
          </div>
          <div class="row-2">
            <div class="field">
              <label class="field-label">${t("animator.field.fps")}</label>
              <select id="anim-fps">
                <option value="24">24 (Kino)</option>
                <option value="25">25 (PAL)</option>
                <option value="30" selected>30</option>
                <option value="50">50 (PAL HFR)</option>
                <option value="60">60</option>
              </select>
            </div>
          </div>
          <div class="field">
            <label class="field-label">${t("animator.field.map_smoothing")} <span class="label-val" id="anim-map-smoothing-v">1.3 px</span></label>
            <input type="range" id="anim-map-smoothing" min="0" max="3" step="0.1" value="1.3">
            <div class="muted" style="font-size:11px; margin-top:4px; line-height:1.4;">${t("animator.field.map_smoothing_hint")}</div>
          </div>
        </div>
      </section>

      <div class="section">
        <button class="btn btn-primary btn-block" id="anim-render" disabled>${t("animator.btn.render")}</button>
      </div>
    </aside>

    <section class="canvas drop-target anim-canvas" id="anim-drop" data-drop-hint="${t("animator.dnd.hint")}">
      <!-- Letterbox-Viewport mit der Render-Aspect-Ratio (gleiches Pattern wie
           Tour-Map). Damit ist die Vorschau geometrisch deckungsgleich mit
           dem MP4-Output → WYSIWYG. Ohne Letterbox würde Mapbox's fitBounds
           je nach Canvas-Aspect anderen Zoom rausgeben. -->
      <div class="animator-viewport" id="anim-viewport">
        <div id="map-canvas"></div>
        <!-- Overlay-Vorschau (Stats-Boxen, Höhenprofil) liegt absolut über der Karte.
             Wird von renderOverlayPreview() in JS gefüllt. -->
        <div class="overlay-preview-layer" id="anim-overlay-preview" aria-hidden="true"></div>
      </div>
      <!-- Resolution-Badge zeigt aktuelles Format permanent (synchron zu Tour-Map) -->
      <div class="anim-resolution-badge" id="anim-res-badge"></div>
      <!-- v0.9.137 — Live-Drehungszähler. Zeigt den abgewickelten Längengrad +
           Umdrehungen live beim Karten-Ziehen, damit man sieht ob die
           Welt-Drehung-Akkumulation (Insta360-Modell) greift. -->
      <div class="anim-rotation-counter" id="anim-rot-counter" title="${t("animator.rotcounter.tooltip")}">
        <span class="rc-icon">↻</span>
        <span class="rc-val" id="anim-rot-counter-val">0° (0↻)</span>
      </div>
      <!-- Hint-Banner bei aktivem Alpha-Modus: sichtbar erklären, dass die
           Vorschau-Karte im finalen Render NICHT mit enthalten ist -->
      <div class="anim-alpha-hint" id="anim-alpha-preview-hint" hidden>
        ⚠️ ${t("animator.alpha.preview_hint")}
      </div>
      <!-- Refit-Button — User pant manuell und kann mit einem Klick wieder
           auf den Track-Extent springen (analog Tour-Map). -->
      <button class="anim-refit-btn" id="anim-refit" title="${t("tourmap.btn.refit")}">⤢</button>
      <!-- Timeline-Bar (v0.7.0) — Camera-Keyframes. Wird von timeline.js
           gefüllt; siehe mountTimelineBar() unten in mountAnimator(). -->
      <div class="anim-timeline-host" id="anim-timeline-host"></div>
      <div class="progress-overlay" id="anim-progress">
        <div class="render-preview-wrap">
          <img class="render-preview" id="anim-preview" alt="">
          <div class="render-preview-placeholder" id="anim-preview-placeholder">${t("animator.preview.starting")}</div>
        </div>
        <div class="progress-meta">
          <div class="progress-percent" id="anim-pct">0%</div>
          <div class="progress-bar"><div class="progress-fill" id="anim-fill"></div></div>
          <div class="progress-status" id="anim-status">${t("animator.status.start")}</div>
        </div>
        <button class="btn" id="anim-cancel">⨯ ${t("animator.btn.cancel")}</button>
      </div>
      <div class="render-done hidden" id="anim-done">
        <h2>${t("animator.status.done")}</h2>
        <video id="anim-video" controls autoplay muted></video>
        <div class="render-done-buttons">
          <button class="btn" id="anim-play-video">${t("animator.btn.play_video", "▶ Abspielen")}</button>
          <button class="btn" id="anim-open-folder">${t("animator.btn.reveal")}</button>
          <button class="btn btn-primary" id="anim-new">${t("animator.btn.next")}</button>
        </div>
      </div>
    </section>
  `;

  // Live-Labels für Slider
  const updateLabel = (id, val, suffix) => {
    const lbl = document.getElementById(id);
    if (lbl) lbl.textContent = val + suffix;
  };
  const bindLabel = (slider, label, suffix) => {
    const el = document.getElementById(slider);
    el.addEventListener("input", () => updateLabel(label, el.value, suffix));
  };
  bindLabel("anim-pitch", "anim-pitch-v", "°");
  bindLabel("anim-rot", "anim-rot-v", "°");
  // v0.9.107 — bindLabel anim-spin entfernt (Spin-Slider gibts nicht mehr)
  bindLabel("anim-ex", "anim-ex-v", "×");
  bindLabel("anim-lw", "anim-lw-v", " px");
  bindLabel("anim-shadow-strength", "anim-shadow-strength-v", " px");
  bindLabel("anim-glow-strength", "anim-glow-strength-v", " px");
  bindLabel("anim-map-smoothing", "anim-map-smoothing-v", " px");
  // v0.9.310 — Standbild-Kamera-Slider (existieren im DOM unabhängig vom Modus)
  if (document.getElementById("anim-static-bearing")) bindLabel("anim-static-bearing", "anim-static-bearing-v", "°");
  if (document.getElementById("anim-static-padding")) bindLabel("anim-static-padding", "anim-static-padding-v", "%");
  document.getElementById("anim-color").addEventListener("input", e => {
    document.getElementById("anim-color-v").textContent = e.target.value;
  });

  // Settings-Bindings (Werte aus settings.json laden + bei Änderung speichern)
  bindSetting("anim-style", _MODKEY, "map_style");

  // OSM-Modus → Style-Picker disablen + Hinweis mit „Token hinzufügen"-CTA.
  // (Bei Token-Wechsel ruft app.js renderMod() → komplettes Remount,
  //  daher reicht ein einmaliges Setup beim Mount.)
  (function applyOsmStyleLock() {
    const fieldEl  = document.getElementById("anim-style-field");
    const noticeEl = document.getElementById("anim-style-osm-notice");
    const selectEl = document.getElementById("anim-style");
    const ctaEl    = document.getElementById("anim-style-osm-cta");
    if (!fieldEl || !noticeEl || !selectEl || !ctaEl) return;

    if (isOsmMode()) {
      fieldEl.classList.add("is-osm-disabled");
      selectEl.disabled = true;
      noticeEl.hidden = false;
      ctaEl.addEventListener("click", () => {
        if (typeof window.openSettingsModal === "function") {
          window.openSettingsModal();
        }
      });
    } else {
      fieldEl.classList.remove("is-osm-disabled");
      selectEl.disabled = false;
      noticeEl.hidden = true;
    }
  })();
  bindSetting("anim-terrain", _MODKEY, "enable_terrain", { type: "bool" });
  // v0.8.16 — Master-Toggle: Keyframe-Editor an/aus.
  bindSetting("anim-kf-enabled", _MODKEY, "keyframes_enabled", { type: "bool",
    onChange: () => applyKeyframesEnabled() });

  // v0.9.11 — Warnung wenn der User den Editor mit bestehenden Keyframes
  // ausschaltet. Marc-Spec: „Da muss eine Warnung kommen 'Keyframes gehen
  // verloren! Willst du den Keyframes Editor wirklich verlassen?'".
  // Click-Handler läuft VOR dem change-Listener von bindSetting. Wenn wir
  // preventDefault() rufen, kippt der Checkbox-State nicht und kein change
  // feuert — wir können dann via Modal entscheiden.
  (() => {
    const cbKf = document.getElementById("anim-kf-enabled");
    if (!cbKf) return;
    cbKf.addEventListener("click", (e) => {
      // checked reflektiert HIER schon den geplanten neuen Zustand.
      // Interessant ist nur: gerade an, soll ausgeschaltet werden → checked=false.
      if (cbKf.checked) return;  // Aktivierung ist immer OK
      const hasKfs = getRawTimelineEvents().some(ev => ev && KF_LANES.includes(ev.kind));
      if (!hasKfs) return;       // nichts zu verlieren → durchlassen
      e.preventDefault();        // Toggle-Kippen abbrechen
      const titleStr  = (typeof t === "function" ? t("animator.kf.deactivate_warn_title") : null) || "Keyframes gehen verloren!";
      const bodyStr   = (typeof t === "function" ? t("animator.kf.deactivate_warn_body")  : null)
                     || "Du hast bestehende Keyframes gesetzt. Wenn du den Keyframe-Editor jetzt deaktivierst, werden <strong>alle Keyframes gelöscht</strong>. Möchtest du fortfahren?";
      const cancelStr = (typeof t === "function" ? t("common.cancel") : null) || "Abbrechen";
      const okStr     = (typeof t === "function" ? t("animator.kf.deactivate_warn_ok") : null) || "Editor deaktivieren";
      openModal({
        title: titleStr,
        body:  `<p style="margin:0 0 4px; font-size:13.5px; line-height:1.5;">${bodyStr}</p>`,
        footer: `
          <button type="button" class="btn" id="md-kf-deact-cancel">${cancelStr}</button>
          <button type="button" class="btn btn-primary" id="md-kf-deact-ok" style="background:#d94343; border-color:#b53636;">${okStr}</button>
        `,
      });
      document.getElementById("md-kf-deact-cancel").onclick = () => openModal({}).close();
      document.getElementById("md-kf-deact-ok").onclick = () => {
        openModal({}).close();
        // Alle Keyframe-Events killen (marker/photo bleiben für später)
        const filtered = getRawTimelineEvents().filter(e => e && !KF_LANES.includes(e.kind));
        setTimelineEvents(filtered);
        // Jetzt programmatisch toggeln + change-Event auslösen, damit
        // bindSetting persistiert + applyKeyframesEnabled() läuft.
        cbKf.checked = false;
        cbKf.dispatchEvent(new Event("change"));
      };
    });
  })();
  // Karten-Feinabstimmung-Felder — jetzt direkt in der Karten-Sektion (v0.6.0).
  bindSetting("anim-mc-light", _MODKEY, "light_preset",
    { onChange: () => applyHideLabels() });
  bindSetting("anim-mc-places", _MODKEY, "show_place_labels",
    { type: "bool", onChange: () => applyHideLabels() });
  bindSetting("anim-mc-roads", _MODKEY, "show_road_labels",
    { type: "bool", onChange: () => applyHideLabels() });
  bindSetting("anim-mc-poi", _MODKEY, "show_poi_labels",
    { type: "bool", onChange: () => applyHideLabels() });
  bindSetting("anim-mc-transit", _MODKEY, "show_transit_labels",
    { type: "bool", onChange: () => applyHideLabels() });
  bindSetting("anim-mc-admin", _MODKEY, "show_admin_boundaries",
    { type: "bool", onChange: () => applyHideLabels() });
  // Quick "Alle aus" / "Alle an"
  (function setupMcQuickButtons() {
    const ids = ["anim-mc-places","anim-mc-roads","anim-mc-poi","anim-mc-transit","anim-mc-admin"];
    const setAll = (state) => {
      ids.forEach(id => {
        const el = document.getElementById(id);
        if (el && el.checked !== state) {
          el.checked = state;
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
    };
    document.getElementById("anim-mc-all-off")?.addEventListener("click", () => setAll(false));
    document.getElementById("anim-mc-all-on")?.addEventListener("click", () => setAll(true));
  })();

  // v0.9.208 — „Route / Anreise" gehört nur ins Reiseroute-Modul; im Animator
  // die Sektion komplett rausnehmen (DRY: gleiche HTML-Quelle, hier gefiltert).
  if (!_isReiseroute) {
    // Animator: Route- + GPX-Ghost-Sektion raus (gehören nur ins Reiseroute-Modul).
    try { document.querySelector('#anim-panel [data-accordion-section="route"]')?.remove(); } catch (_) {}
    try { document.querySelector('#anim-panel [data-accordion-section="ghost-gpx"]')?.remove(); } catch (_) {}
  } else {
    // Reiseroute: Stats-Overlays raus (dafür ist hier der GPX-Ghost). bindSetting
    // no-op't auf fehlende Elemente (util.js) → sicher zu entfernen.
    try { document.querySelector('#anim-panel [data-accordion-section="overlays"]')?.remove(); } catch (_) {}
  }

  // v0.9.308 — Standbild-Modus (Tour-Map): Animations-Regler AUSBLENDEN (nicht
  // entfernen → der bestehende Init-/Probe-Lauf-/Timeline-Code findet seine
  // DOM-Nodes weiter, kein Crash). Sichtbar bleiben: Karte, Track, statische
  // Kamera (Neigung), Overlays, Schilder/Fotos, Auflösung.
  if (_isStaticFrame) {
    // Alles ausblenden (display:none, NICHT remove → Init-Code crasht nicht),
    // was nur fürs animierte Video Sinn ergibt. Ein Standbild zeigt immer alles.
    const _hideSel = (sel) => { try { const el = document.querySelector(sel); if (el) el.style.display = "none"; } catch (_) {} };
    const _hideClosest = (id, sel) => { try { const c = document.getElementById(id)?.closest(sel); if (c) c.style.display = "none"; } catch (_) {} };
    // — Video-Sektion: Animations-Felder raus, Auflösung BLEIBT.
    _hideClosest("anim-intro", ".row-3");          // Intro/Dauer/Hold
    _hideClosest("anim-fps", ".row-2");            // FPS
    _hideClosest("anim-map-smoothing", ".field");  // Karte glätten (4K-Anti-Flimmer)
    // — Kamera: alles Animations-Bezogene raus, nur Neigung (pitch) bleibt.
    _hideSel("#anim-panel #anim-camera-body-keyframe");   // Keyframe-Editor
    _hideClosest("anim-kf-enabled", ".checkbox-row");     // KF-Modus-Toggle
    _hideClosest("anim-rot", ".field");                   // Rotation (Schwenk über die Anim)
    _hideClosest("anim-camera-follow", ".checkbox-row");  // Kamera folgt Track
    _hideSel("#anim-follow-inertia-row");                 // Kamera-Trägheit
    _hideSel("#anim-smooth-camera-row");                  // Ruhige Kamera (3D)
    _hideSel("#anim-cinematic-flyto-row");                // Cinematic-Flug
    // — v0.9.310: Standbild-Kamera-Regler (Ausrichtung/Randabstand/Pins) ZEIGEN.
    try { const sc = document.getElementById("anim-static-camera"); if (sc) sc.hidden = false; } catch (_) {}
    // — Overlays: Live-Stats (zeit-animiert) raus; Trim-Stats-Optionen raus
    //   (kein Trim ohne Timeline). Gesamt-Stats + Höhenprofil bleiben.
    _hideSel("#anim-overlay-live-group");
    try { const w = document.getElementById("anim-stats-use-trim")?.closest(".checkbox-row")?.parentElement; if (w) w.style.display = "none"; } catch (_) {}
    // — Schilder/Fotos: „In der Vorschau ALLE zeigen" — im Standbild eh immer alle.
    _hideClosest("anim-signs-preview-all", ".checkbox");
    // — Timeline-Bar (Probe-Lauf/Scrubber) raus + reservierten Platz freigeben.
    //   .anim-canvas reserviert padding-bottom = var(--anim-tl-h, 230px) für die
    //   Timeline. Da der Host jetzt 0px hoch ist, setzt der Mess-Code
    //   (offsetHeight>0) die Variable NICHT → der 230px-Default bliebe → Karte
    //   klebte oben. Im Standbild explizit 0 → Vorschau zentriert über die Höhe.
    _hideSel("#anim-timeline-host");
    try { document.getElementById("anim-drop")?.style.setProperty("--anim-tl-h", "0px"); } catch (_) {}
    // — Render-Button-Text.
    try { const rb = document.getElementById("anim-render"); if (rb) rb.textContent = t("tourmap.btn.render", "🖼 Karte als PNG rendern"); } catch (_) {}
    // — v0.9.310: Sektion-Header „Video-Einstellungen" → „Bild-Einstellungen"
    //   (enthält im Standbild-Modus nur noch die Auflösung).
    try {
      const vh = document.querySelector('[data-accordion-section="video"] .section-collapse-header > span:first-child');
      if (vh) vh.textContent = t("tourmap.section.image_settings", "Bild-Einstellungen");
    } catch (_) {}
  }

  // Sektion-Akkordeons (v0.6.0): alle data-accordion-section-Elemente
  // klickbar machen + State persistieren.
  if (window.setupSectionAccordions) {
    window.setupSectionAccordions(_MODKEY, document.getElementById("anim-panel"));
  }

  // v0.8.20 — Help-Button-Click-Handler ist jetzt global in ui/js/util.js
  // (greift überall in der App).

  // v0.7.5: Keyframe-Editor-Slider direkt nach Template-Mount binden.
  // Vorher wurde das beim ersten renderKeyframeEditor() lazy gemacht — aber
  // wenn dabei aus irgendwelchen Gründen die Flag schon true war oder die
  // Slider noch nicht im DOM waren, gingen die Listener verloren. Jetzt
  // ganz früh, alle Elemente sind sicher da.
  //
  // v0.7.6: State-Variablen für KF-Editor MÜSSEN hier oben deklariert sein
  // — `bindKeyframeEditor()` greift auf `_kfEditorBound`, `_selectedKfIdx`,
  // `_tlBar`, `_fitZoomBase`, `_previewRaf` zu. `let` ist NICHT gehoisted
  // (TDZ-Fehler sonst → mountAnimator bricht ab → Karte lädt nicht).
  let _selectedKfIdx = null;

  // ── v0.9.66/67 — Undo/Redo via generischen Controller (util.js) ──────────
  // 50 Schritte, 800 ms Throttle für Drag-Operationen. Globaler Keyboard-
  // Listener in util.js routet Cmd/Ctrl+Z zum aktiven Modul.
  const _animUndoCtrl = window.createUndoController({
    snapshot: () => {
      const proj = (typeof getActiveProject === "function") ? getActiveProject() : null;
      const a = (proj && proj[_MODKEY]) || (_settingsCache && _settingsCache[_MODKEY]) || {};
      return {
        timeline_events:     JSON.parse(JSON.stringify(a.timeline_events || [])),
        intro_s:             a.intro_s ?? 0,
        duration_s:          a.duration_s ?? 12,
        hold_s:              a.hold_s ?? 5,
        render_start_anchor: a.render_start_anchor ?? 0.0,
        render_end_anchor:   a.render_end_anchor ?? 1.0,
        keyframes_enabled:   !!a.keyframes_enabled,
      };
    },
    apply: (snap) => {
      if (!snap) return;
      saveProjectSettings(_MODKEY, {
        timeline_events:     JSON.parse(JSON.stringify(snap.timeline_events)),
        intro_s:             snap.intro_s,
        duration_s:          snap.duration_s,
        hold_s:              snap.hold_s,
        render_start_anchor: snap.render_start_anchor,
        render_end_anchor:   snap.render_end_anchor,
        keyframes_enabled:   snap.keyframes_enabled,
      });
      if (_settingsCache) {
        _settingsCache[_MODKEY] = _settingsCache[_MODKEY] || {};
        Object.assign(_settingsCache[_MODKEY], {
          timeline_events: JSON.parse(JSON.stringify(snap.timeline_events)),
          intro_s: snap.intro_s, duration_s: snap.duration_s, hold_s: snap.hold_s,
          render_start_anchor: snap.render_start_anchor,
          render_end_anchor: snap.render_end_anchor,
          keyframes_enabled: snap.keyframes_enabled,
        });
      }
      const setVal = (id, v) => { const el = document.getElementById(id); if (el && el.value !== String(v)) el.value = String(v); };
      setVal("anim-intro", snap.intro_s);
      setVal("anim-dur",   snap.duration_s);
      setVal("anim-hold",  snap.hold_s);
      const masterCb = document.getElementById("anim-kf-enabled");
      if (masterCb) masterCb.checked = !!snap.keyframes_enabled;
      if (_tlBar && _tlBar.setTrim) _tlBar.setTrim(snap.render_start_anchor, snap.render_end_anchor);
      applyTrimToTrackPreview(snap.render_start_anchor, snap.render_end_anchor);
      applyKeyframesEnabled();
      if (_tlBar) {
        _tlBar.refresh();
        if (_tlBar.setTrackFraction) _tlBar.setTrackFraction(trackFraction(), introFraction());
      }
      _selectedKfIdx = null;
      _selectedEvent = null;
      rebuildCameraKeyframePins();
      renderKeyframeEditor();
      refreshPreviewTrackData();
    },
    toast: (msg) => { if (typeof toast === "function") toast(msg, "info", 1000); },
  });
  window.__rzUndoControllers[_MODKEY] = _animUndoCtrl;
  // Aliase damit existing-Code-Sites (animUndo/animRedo, _animPushUndo, _animResetUndoStacks) weiter funktionieren
  const _animPushUndo = (label, opts) => _animUndoCtrl.push(label, opts);
  const animUndo = () => _animUndoCtrl.undo();
  const animRedo = () => _animUndoCtrl.redo();
  const _animResetUndoStacks = () => _animUndoCtrl.reset();
  // ── /Undo-Redo-Block ────────────────────────────────────────────────────
  // v0.9.3 — Per-Property-Selektion. Wenn gesetzt (= {kind, anchor}), zeigt
  // der Detail-Editor nur den Slider zur ausgewählten Lane. Wenn null:
  // Cluster-Modus (alle 4 Properties zugleich, wie in v0.9.0-0.9.2).
  let _selectedEvent = null;
  let _tlBar = null;
  let _kfEditorBound = false;
  let _previewRaf = null;
  let _fitZoomBase = null;

  /**
   * v0.9.39 (Marc-Bug-Report): liefert den TRACK-AUTO-FIT-Zoom als Basis
   * für die KF-`zoom_offset`-Berechnung. NUR aus dem authoritativen
   * `_fitZoomBase` (gesetzt nach fitBounds `moveend`-Event).
   *
   * Wenn noch nicht verfügbar → `null`. Caller müssen damit umgehen
   * (z.B. scrubPreview wartet auf moveend statt zu raten).
   *
   * WICHTIG: kein cameraForBounds-Fallback mehr (war v0.9.36) — der
   * lieferte beim Re-Mount mit noch nicht final layoutetem Viewport
   * falsche (zu kleine) Zoom-Werte → KF-Preview zoomte rausgezoomt aus.
   * Marc-Beobachtung: Render war korrekt, nur Preview falsch → Bug ist
   * in der Preview-Berechnung, nicht in der Speicherung.
   *
   * Setzt `_fitZoomBase` NICHT als Seiteneffekt (Snapshot-Vergiftung-Bug
   * aus v0.9.36 und älter).
   */
  function effectiveFitZoomBase() {
    return _fitZoomBase;  // null oder echter Wert
  }
  // v0.8.6: Probe-Lauf Speed-Multiplikator + Real-Time-Anchor
  let _previewSpeed = 1;
  let _previewT0 = 0;
  let _previewAnimMs = 0;
  let _previewHoldMs = 0;
  bindKeyframeEditor();

  // Stil = "alpha" (= "Ohne Karte") + Codec-Auto-Switch (v0.6.0).
  // Alpha-Kanal-Output braucht zwingend ProRes 4444 (kein H.264/H.265 mit Alpha
  // in MP4). Wenn User Alpha-Stil wählt → Codec auf prores + Hint anzeigen.
  // Hint im Karten-Stil-Bereich (alpha_hint) bleibt sichtbar solange Alpha aktiv.
  // v0.9.245 — Codec-Wahl ist in die globalen Einstellungen gewandert. Hier nur
  // noch den Alpha-Hinweis ein-/ausblenden. Alpha erzwingt ProRes im Backend.
  function syncAlphaStyleUI() {
    const styleSel = document.getElementById("anim-style");
    const alphaHint = document.getElementById("anim-alpha-hint");
    if (!styleSel) return;
    const isAlpha = styleSel.value === "alpha";
    if (alphaHint) alphaHint.hidden = !isAlpha;
  }
  document.getElementById("anim-style")?.addEventListener("change", syncAlphaStyleUI);
  // Einmal initial — nach bindSetting hat das Style-Element den persistierten Wert
  setTimeout(syncAlphaStyleUI, 50);
  bindSetting("anim-overlays", _MODKEY, "show_overlays", { type: "bool" });
  bindSetting("anim-pitch", _MODKEY, "pitch", { type: "number",
    onLoad: v => updateLabel("anim-pitch-v", v, "°") });
  bindSetting("anim-rot", _MODKEY, "rotation", { type: "number",
    onLoad: v => updateLabel("anim-rot-v", v, "°") });
  // v0.9.107 — Spin-bindSetting entfernt (Slider gibts nicht mehr).
  // v0.9.84 — Cinematic-Flyto-Toggle
  bindSetting("anim-cinematic-flyto", _MODKEY, "cinematic_flyto", { type: "bool" });
  // v0.8.17 — Zoom-Stufe im Classic-Modus: setzt direkt die Karten-Zoom.
  // Der Render liest dann den aktuellen Map-Zoom aus (overrideZoom-Pfad),
  // d.h. der Slider-Wert ist beim Render automatisch dabei.
  bindSetting("anim-zoom", _MODKEY, "static_zoom", { type: "number",
    onLoad: v => {
      const z = parseFloat(v);
      if (!isNaN(z)) updateLabel("anim-zoom-v", z.toFixed(1), "");
      // Beim Laden NICHT die Map setzen — die wird über _fitZoomBase
      // initialisiert. Slider zeigt nur den gespeicherten Wert.
    },
    onChange: v => {
      const z = parseFloat(v);
      if (isNaN(z)) return;
      updateLabel("anim-zoom-v", z.toFixed(1), "");
      // Map LIVE auf den neuen Zoom setzen
      if (map) {
        try { map.easeTo({ zoom: z, duration: 80 }); } catch (_) {}
      }
    },
  });
  // v0.9.310 — Standbild-Kamera (Tour-Map): Ausrichtung (bearing), Randabstand
  // (padding_pct) und Start/Ziel-Markierung (show_pins). Persistiert pro Projekt.
  // onChange triggert im Standbild-Modus ein Re-Fit → WYSIWYG-Vorschau.
  if (document.getElementById("anim-static-bearing")) {
    bindSetting("anim-static-bearing", _MODKEY, "static_bearing", { type: "number",
      onLoad: v => updateLabel("anim-static-bearing-v", Math.round(parseFloat(v) || 0), "°"),
      onChange: v => {
        updateLabel("anim-static-bearing-v", Math.round(parseFloat(v) || 0), "°");
        if (_isStaticFrame) { try { fitTrackPreview(true); } catch (_) {} }
      },
    });
  }
  if (document.getElementById("anim-static-padding")) {
    bindSetting("anim-static-padding", _MODKEY, "static_padding", { type: "number",
      onLoad: v => updateLabel("anim-static-padding-v", Math.round(parseFloat(v) || 0), "%"),
      onChange: v => {
        updateLabel("anim-static-padding-v", Math.round(parseFloat(v) || 0), "%");
        if (_isStaticFrame) { try { fitTrackPreview(true); } catch (_) {} }
      },
    });
  }
  if (document.getElementById("anim-static-pins")) {
    bindSetting("anim-static-pins", _MODKEY, "static_pins", { type: "bool",
      onChange: () => { if (_isStaticFrame) { try { updateStaticPinsPreview(); } catch (_) {} } },
    });
  }

  // v0.8.17 — „Kamera folgt Track" im Classic-Modus
  // v0.9.275/277 (Nutzer) — Kamera-Trägheit (0..100 %), nur sichtbar wenn „Kamera folgt Track" an.
  // WICHTIG (Marc-Bug v0.9.277): _fiSync MUSS auch beim PROJEKTWECHSEL laufen. bindSetting
  // setzt die Follow-Checkbox dann programmatisch (kein `change`-Event) → darum `onLoad: _fiSync`
  // an der Follow-Bindung, sonst bleibt der Regler nach Projektwechsel versteckt obwohl Follow an.
  const _fiLbl = () => { const v = document.getElementById("anim-follow-inertia-v"); const s = document.getElementById("anim-follow-inertia"); if (v && s) v.textContent = (parseInt(s.value, 10) || 0) + "%"; };
  // v0.9.318 — „Kamera-Höhe halten"-Regler ersetzt durch „Ruhige Kamera (3D)"-Checkbox
  // (entkoppelte FreeCamera). Default AUS = alter Modus. _fiSync togglet nur noch die
  // (Follow-spezifische) Trägheit.
  const _fiSync = () => {
    const cb = document.getElementById("anim-camera-follow");
    const row = document.getElementById("anim-follow-inertia-row");
    if (cb && row) row.style.display = cb.checked ? "" : "none";
  };
  bindSetting("anim-camera-follow", _MODKEY, "camera_follow_track", { type: "bool", onLoad: _fiSync, onChange: _fiSync });
  bindSetting("anim-follow-inertia", _MODKEY, "camera_follow_inertia_pct", { type: "number", onLoad: _fiLbl, onChange: _fiLbl });
  // v0.9.318 — Ruhige Kamera (entkoppelte FreeCamera). Default AUS. Toggle aktualisiert
  // den Probelauf (falls gerade einer läuft → neu starten, sonst egal).
  const _smoothCamSync = () => { try { if (_previewRaf) runTimelinePreview(true); } catch (_) {} };
  bindSetting("anim-smooth-camera", _MODKEY, "smooth_camera_3d", { type: "bool", onChange: _smoothCamSync });
  document.getElementById("anim-camera-follow")?.addEventListener("change", _fiSync);
  document.getElementById("anim-follow-inertia")?.addEventListener("input", _fiLbl);
  _fiSync(); _fiLbl();
  bindSetting("anim-ex", _MODKEY, "exaggeration", { type: "number",
    onLoad: v => updateLabel("anim-ex-v", v, "×") });
  bindSetting("anim-dur", _MODKEY, "duration_s", { type: "number" });
  bindSetting("anim-hold", _MODKEY, "hold_s", { type: "number" });
  // v0.9.66: Undo-Snapshot vor dem ersten Slider-Input. Throttle blockiert
  // die restlichen Events während des Drag — beim ersten in der Session
  // wird der Vorher-State gespeichert.
  ["anim-dur", "anim-hold", "anim-intro"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", () => _animPushUndo(
      id === "anim-intro" ? "Intro geändert" :
      id === "anim-hold"  ? "Hold geändert"  : "Dauer geändert"
    ));
  });
  // Master-Toggle ist discrete: force-push damit's nicht weggeschluckt wird
  document.getElementById("anim-kf-enabled")?.addEventListener("change", () => {
    _animPushUndo("Keyframe-Editor umgeschaltet", { force: true });
  });
  // v0.9.59 (Nutzer-Wunsch): Intro-Hold analog zum Outro-Hold
  bindSetting("anim-intro", _MODKEY, "intro_s", { type: "number" });
  // v0.9.18 — onLoad/onChange auf updateResButtons() koppeln, damit der
  // Quick-Picker-Button beim Session-Load + Projekt-Wechsel der Eingabe
  // folgt. Marc-Spec 2026-05-24: „Auflösung in den Feldern muss gewinnen.
  // Entspricht sie nicht einem der Vorwahl-Buttons, dann darf keiner
  // ausgewählt sein." Function-Declarations sind gehoist, deshalb ist der
  // Aufruf hier safe obwohl updateResButtons() weiter unten definiert wird.
  bindSetting("anim-w", _MODKEY, "width", { type: "number",
    onLoad:   () => updateResButtons(),
    onChange: () => updateResButtons() });
  bindSetting("anim-h", _MODKEY, "height", { type: "number",
    onLoad:   () => updateResButtons(),
    onChange: () => updateResButtons() });
  bindSetting("anim-fps", _MODKEY, "fps", { type: "number" });
  // (Codec-Auswahl ist in die globalen Einstellungen „Qualität & Export" gewandert.)
  // Performance + Alpha (v0.4)
  // point_count wird nach GPX-Load dynamisch konfiguriert (Max = n_points).
  // KEIN bindSetting hier — die Settings-Persistenz machen wir manuell als
  // PROZENT, weil die absolute Punkte-Anzahl je Track unterschiedlich ist
  // (50 Punkte können bei einem 5000-Punkte-Track viel weniger sein als bei
  // einem 100-Punkte-Track). User-Default ist „alle Punkte" (100 %).
  // Alpha ist jetzt ein Karten-Stil-Wert ("alpha"), kein eigenes bool mehr.
  // Backwards-compat: alte settings.json mit transparent_background=true wird
  // beim ersten Render-Klick aus dem Stil abgeleitet, nicht aus dem Feld.
  // v0.9.309 — Schlagschatten + Glow: Checkbox raus (Marc). Der Stärke-Slider
  // ist der Schalter (0 px = aus). Kein shadow_enabled/glow_enabled-Toggle mehr;
  // das Backend gated über `strength > 0`. Default-Stärke 0 = aus.
  bindSetting("anim-shadow-strength", _MODKEY, "shadow_strength", { type: "number",
    onLoad: v => updateLabel("anim-shadow-strength-v", parseFloat(v).toFixed(1), " px"),
    onChange: v => updateLabel("anim-shadow-strength-v", parseFloat(v).toFixed(1), " px") });
  bindSetting("anim-glow-strength", _MODKEY, "glow_strength", { type: "number",
    onLoad: v => updateLabel("anim-glow-strength-v", parseFloat(v).toFixed(1), " px"),
    onChange: v => {
      updateLabel("anim-glow-strength-v", parseFloat(v).toFixed(1), " px");
      applyGlowToLayers();
    }});
  // Karte glätten / Anti-Flimmer (v0.9.286b, Marc) — reiner Render-Param,
  // keine Live-Preview (greift nur im 4K-Export).
  bindSetting("anim-map-smoothing", _MODKEY, "map_smoothing", { type: "number",
    onLoad: v => updateLabel("anim-map-smoothing-v", parseFloat(v).toFixed(1), " px"),
    onChange: v => updateLabel("anim-map-smoothing-v", parseFloat(v).toFixed(1), " px") });
  // v0.9.169/170 — Ghost-Track (ganze Route schwach im Hintergrund) + eigene Farbe
  bindSetting("anim-ghost-enabled", _MODKEY, "ghost_track_enabled", { type: "bool",
    onChange: () => applyGhost() });
  bindSetting("anim-ghost-color", _MODKEY, "ghost_track_color", {
    onLoad: v => { const lbl = document.getElementById("anim-ghost-color-v"); if (lbl) lbl.textContent = v || currentGhostColor(); },
    onChange: v => { const lbl = document.getElementById("anim-ghost-color-v"); if (lbl) lbl.textContent = v || currentGhostColor(); applyGhost(); } });
  // Live-Update des Hex-Labels beim Ziehen im Color-Picker (analog anim-color).
  document.getElementById("anim-ghost-color").addEventListener("input", e => {
    const lbl = document.getElementById("anim-ghost-color-v");
    if (lbl) lbl.textContent = e.target.value;
    applyGhost();
  });
  bindSetting("anim-ghost-opacity", _MODKEY, "ghost_track_opacity_pct", { type: "number",
    onLoad: v => updateLabel("anim-ghost-opacity-v", Math.round(parseFloat(v)), " %"),
    onChange: v => { updateLabel("anim-ghost-opacity-v", Math.round(parseFloat(v)), " %"); applyGhost(); } });
  (function syncGhostUi() {
    const cb = document.getElementById("anim-ghost-enabled");
    const fields = ["anim-ghost-color-field", "anim-ghost-opacity-field"]
      .map(id => document.getElementById(id)).filter(Boolean);
    const apply = () => {
      const hide = !cb.checked;
      fields.forEach(f => { f.hidden = hide; f.style.display = hide ? "none" : ""; });
    };
    cb.addEventListener("change", apply);
    apply();
  })();
  // v0.9.211 (Reiseroute) — GPX-Ghost-Config (Elemente existieren nur hier).
  if (_isReiseroute) {
    bindSetting("route-ghost-show", _MODKEY, "ghost_gpx_show", { type: "bool",
      onChange: () => _applyGhostGpx() });
    bindSetting("route-ghost-color", _MODKEY, "ghost_gpx_color", {
      onLoad: v => { const l = document.getElementById("route-ghost-color-v"); if (l) l.textContent = v || "#7fa8ff"; },
      onChange: v => { const l = document.getElementById("route-ghost-color-v"); if (l) l.textContent = v || "#7fa8ff"; _applyGhostGpx(); } });
    document.getElementById("route-ghost-color")?.addEventListener("input", e => {
      const l = document.getElementById("route-ghost-color-v"); if (l) l.textContent = e.target.value; _applyGhostGpx();
    });
    bindSetting("route-ghost-opacity", _MODKEY, "ghost_gpx_opacity_pct", { type: "number",
      onLoad: v => updateLabel("route-ghost-opacity-v", Math.round(parseFloat(v)), " %"),
      onChange: v => { updateLabel("route-ghost-opacity-v", Math.round(parseFloat(v)), " %"); _applyGhostGpx(); } });
    bindSetting("route-ghost-width", _MODKEY, "ghost_gpx_width", { type: "number",
      onLoad: v => updateLabel("route-ghost-width-v", parseFloat(v).toFixed(1), " px"),
      onChange: v => { updateLabel("route-ghost-width-v", parseFloat(v).toFixed(1), " px"); _applyGhostGpx(); } });
    bindSetting("route-ghost-dashed", _MODKEY, "ghost_gpx_dashed", { type: "bool",
      onChange: () => _applyGhostGpx() });
  }
  bindSetting("anim-lw", _MODKEY, "line_width", { type: "number",
    onLoad: v => updateLabel("anim-lw-v", parseFloat(v).toFixed(1), " px"),
    onChange: v => updateLabel("anim-lw-v", parseFloat(v).toFixed(1), " px") });
  bindSetting("anim-line-style", _MODKEY, "line_style",
    { onChange: () => { applyLineStyle(); applyTrackStyle(); syncLineSpacingVisibility(); } });
  bindSetting("anim-line-spacing", _MODKEY, "line_style_spacing", { type: "number",
    onLoad: v => updateLabel("anim-line-spacing-v", parseFloat(v).toFixed(2), "×"),
    onChange: v => { updateLabel("anim-line-spacing-v", parseFloat(v).toFixed(2), "×"); applyLineStyle(); } });
  // Spacing-Slider nur sichtbar wenn line_style != solid
  function syncLineSpacingVisibility() {
    const sel = document.getElementById("anim-line-style");
    const fld = document.getElementById("anim-line-spacing-field");
    if (!sel || !fld) return;
    // v0.8.12: solid + tube haben kein dash-Pattern → Spacing-Slider weg.
    // v0.8.19: zusätzlich style.display um sicher zu gehen dass .field-CSS
    // das hidden-Attribut nicht überschreibt.
    const hide = sel.value === "solid" || sel.value === "tube";
    fld.hidden = hide;
    fld.style.display = hide ? "none" : "";
  }
  syncLineSpacingVisibility();
  // Overlay-Toggles + Positionen
  bindSetting("anim-ov-totals", _MODKEY, "overlay_totals_enabled", { type: "bool" });
  bindSetting("anim-ov-totals-pos", _MODKEY, "overlay_totals_position");
  bindSetting("anim-ov-live", _MODKEY, "overlay_live_enabled", { type: "bool" });
  bindSetting("anim-ov-live-pos", _MODKEY, "overlay_live_position");
  bindSetting("anim-ov-ele", _MODKEY, "overlay_elevation_enabled", { type: "bool" });
  bindSetting("anim-ov-ele-pos", _MODKEY, "overlay_elevation_position");
  // v0.9.228 — Overlay-Zeitfenster (Nutzer „ab Sek X bis Sek Y"). 0 = ab Start /
  // bis Ende. number-Bind speichert/restored projekt-bewusst.
  bindSetting("anim-ov-totals-from", _MODKEY, "overlay_totals_from_s", { type: "number" });
  bindSetting("anim-ov-totals-to", _MODKEY, "overlay_totals_to_s", { type: "number" });
  bindSetting("anim-ov-live-from", _MODKEY, "overlay_live_from_s", { type: "number" });
  bindSetting("anim-ov-live-to", _MODKEY, "overlay_live_to_s", { type: "number" });
  bindSetting("anim-ov-ele-from", _MODKEY, "overlay_elevation_from_s", { type: "number" });
  bindSetting("anim-ov-ele-to", _MODKEY, "overlay_elevation_to_s", { type: "number" });
  // v0.9.321 — Stats-Editor: globales Styling (Schrift/Textfarbe/BG/Opacity).
  bindSetting("anim-ov-font", _MODKEY, "overlay_font", { onChange: renderOverlayPreview });
  bindSetting("anim-ov-textcolor", _MODKEY, "overlay_text_color", { onChange: renderOverlayPreview });
  bindSetting("anim-ov-bgcolor", _MODKEY, "overlay_bg_color", { onChange: renderOverlayPreview });
  // BG-Opacity: gespeichert als 0..1, UI-Slider 0..100 → eigene Anbindung.
  (function bindOvOpacity() {
    const sl = document.getElementById("anim-ov-bgopacity");
    const lbl = document.getElementById("anim-ov-bgopacity-val");
    if (!sl) return;
    const stored = _activeProject?.[_MODKEY]?.overlay_bg_opacity;
    if (typeof stored === "number") sl.value = String(Math.round(stored * 100));
    const sync = () => { if (lbl) lbl.textContent = sl.value + " %"; };
    sync();
    sl.addEventListener("input", () => {
      sync();
      saveProjectSettings(_MODKEY, { overlay_bg_opacity: (parseFloat(sl.value) || 0) / 100 });
      renderOverlayPreview();
    });
  })();
  // (Feld-Editoren werden weiter unten gebaut, sobald der Feld-Katalog initialisiert
  //  ist — siehe `_ovRebuildEditors()` nach dem Katalog-Block. TDZ-Schutz.)
  // v0.9.41 — Stats-Quelle bei aktivem Trim
  bindSetting("anim-stats-use-trim", _MODKEY, "stats_use_trim", { type: "bool" });
  // v0.9.55 (Marc): Pre-Trim-Track-Linie im Render an/aus
  bindSetting("anim-show-pretrim", _MODKEY, "show_pretrim_track", { type: "bool" });
  // v0.9.56: Bei Toggle sofort die Preview-Track-Linie neu zeichnen
  document.getElementById("anim-show-pretrim")?.addEventListener("change", () => {
    if (_tlBar && _tlBar.getTrim) {
      const tr = _tlBar.getTrim();
      applyTrimToTrackPreview(tr.start, tr.end);
    }
  });

  // Auflösungs-Quick-Picker: aktiven Button anhand der aktuellen Inputs setzen
  function updateResButtons() {
    const w = parseInt(document.getElementById("anim-w").value) || 0;
    const h = parseInt(document.getElementById("anim-h").value) || 0;
    document.querySelectorAll(".res-btn[data-w]").forEach(b => {
      const match = parseInt(b.dataset.w) === w && parseInt(b.dataset.h) === h;
      b.classList.toggle("active", match);
    });
  }
  document.querySelectorAll(".res-btn[data-w]").forEach(btn => {
    btn.addEventListener("click", () => {
      const w = parseInt(btn.dataset.w);
      const h = parseInt(btn.dataset.h);
      const wEl = document.getElementById("anim-w");
      const hEl = document.getElementById("anim-h");
      wEl.value = String(w);
      hEl.value = String(h);
      // Settings-Save manuell triggern (bindSetting hört auf 'input'/'change')
      wEl.dispatchEvent(new Event("input"));
      hEl.dispatchEvent(new Event("input"));
      updateResButtons();
    });
  });
  // Reagiere wenn User die Inputs manuell anfasst (Aktive-Button-Status neu setzen)
  // W/H-Inputs triggern Viewport-Refit + Track-Refit für WYSIWYG
  function onAnimResolutionChange() {
    updateResButtons();
    // v0.6.5 — User-Position erhalten beim Auflösungs-Wechsel, ohne Drift.
    // Vorher (v0.6.4) hatten wir map.getBounds() + map.fitBounds(saved, padding:0)
    // — das macht aber einen Round-Trip durch eine rechteckige Bbox, der bei
    // pitch>0 verlustbehaftet ist (Mapbox kann den exakten Zoom nicht
    // zurückrechnen). Resultat: jeder Auflösungs-Wechsel zoomte minimal raus.
    // Jetzt snapshotten wir direkt center+zoom+pitch+bearing und stellen
    // sie via jumpTo() wieder her — exakte 1:1-Wiederherstellung.
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
    updateAnimatorViewport();
    if (saved && map) {
      requestAnimationFrame(() => {
        try { map.jumpTo(saved); } catch (_) {}
      });
    }
  }
  document.getElementById("anim-w").addEventListener("input", onAnimResolutionChange);
  document.getElementById("anim-h").addEventListener("input", onAnimResolutionChange);
  // Initial-Status setzen
  updateResButtons();
  bindSetting("anim-color", _MODKEY, "line_color", {
    onLoad: v => { const lbl = document.getElementById("anim-color-v"); if (lbl) lbl.textContent = v; },
    onChange: v => { const lbl = document.getElementById("anim-color-v"); if (lbl) lbl.textContent = v; }
  });

  // v0.9.115/116 — Welt-Drehung-Label-Format mit Drehungs-Counter.
  // Auf Modul-Scope damit setSliderFromProps, _applyKfRotation und der
  // Welt-Button-Code drauf zugreifen können (vorher lokal in
  // bindKeyframeEditor → ReferenceError ausserhalb).
  // Beispiele: 0° / 360° (1↻) / 720° (2↻) / 540° (1.5↻) / 90° (0.25↻)
  function _formatRotationLabel(deg) {
    if (!Number.isFinite(deg)) deg = 0;
    const rotDeg = Math.round(deg) + "°";
    if (Math.abs(deg) < 1) return rotDeg;
    const turns = deg / 360;
    const turnsStr = turns.toFixed(2).replace(/\.?0+$/, "");
    return `${rotDeg} (${turnsStr}↻)`;
  }

  // Map vorbereiten
  let map = null;
  let currentGpx = null;
  // v0.9.156 — Multi-Track: zusätzliche Touren NACH der ersten (= globale GPX
  // in der Bar). Jede: { gpx_path, line_color, name }. Render schickt nur dann
  // ein `tracks`-Array (≥2 Einträge) wenn hier ≥1 Extra-Tour liegt.
  let _extraTours = [];
  let currentCoords = null;     // letzte Track-Coords für Layer-Rebuild bei Style-Wechsel
  let currentBbox   = null;
  // v0.9.210 (Reiseroute Phase 2) — das geladene GPX (Wanderung) wird hier als
  // GHOST gehalten; animiert wird die berechnete Route (currentCoords). Nur im
  // Reiseroute-Modul befüllt (im Animator immer null → keine Wirkung).
  let _ghostGpxCoords = null;
  let _ghostGpxPath = null;
  let _animViewportObserver = null;
  // v0.9.10 — beobachtet die Timeline-Bar-Höhe, damit padding-bottom +
  // bottom-Offset von Refit-Button / Resolution-Badge sich anpassen.
  let _animTimelineObserver = null;

  // v0.9.136 — Längengrad-Akkumulator (Insta360-Modell). Die Welt-Drehung
  // steckt jetzt in der *abgewickelten* center.lng: dreht der User die Karte
  // per Drag mehrfach um die Erde, sammeln wir die echten Umdrehungen (lng
  // kann >±180° werden, z.B. 370° = eine volle Drehung + 10°). Mapbox
  // normalisiert beim Rendern, aber wir merken uns den abgewickelten Wert.
  //
  // WICHTIG: Nur ECHTE User-Drags (`drag`-Event) akkumulieren. Programmatische
  // Moves (easeTo/jumpTo/setCenter) feuern KEIN `drag` → korrumpieren den
  // Akkumulator nicht. Nach programmatischen Sprüngen re-seeden wir bewusst.
  let _lngAccum = null;       // abgewickelter Längengrad (kann >±180°)
  let _lngAccumPrev = null;   // letzter gewickelter lng-Wert (für Delta)
  // v0.9.139 — Dreh-Ursprung: der „natürliche" (un-gedrehte) Längengrad des
  // aktuellen Keyframes. Der Counter zeigt die Drehung RELATIV dazu, sonst
  // zählt er den absoluten Längengrad/360 (Marc-Bug: eine West-Drehung von
  // Berlin (lng≈13°) ergab -346° = -0.96↻, also „unter 1" → Marc musste
  // mehr als einmal drehen bis der Counter über 1 sprang). Wird bei jeder
  // programmatischen Navigation (Scrub/Step/Feld-Edit) auf den dann
  // aktuellen natürlichen Längengrad gesetzt; ECHTE Drags lassen ihn fix
  // → Drag misst sauber relativ zum Ausgangspunkt.
  let _lngRotOrigin = null;
  // v0.9.139 — true zwischen `dragstart` und `moveend` einer ECHTEN User-
  // Geste (inkl. nachlaufender Inertia). Nur dann akkumulieren wir `move`-
  // Events → programmatische easeTo/jumpTo (kein dragstart) korrumpieren
  // den Akkumulator nicht.
  let _userInteracting = false;

  function _wrapLng(l) {
    if (!Number.isFinite(l)) return 0;
    return (((l + 180) % 360) + 360) % 360 - 180;
  }
  // Setzt den Akkumulator auf einen bekannten abgewickelten Wert (nach
  // programmatischen Sprüngen / beim Aktivieren eines Keyframes).
  function _seedLngAccum(lng) {
    if (!Number.isFinite(lng)) lng = 0;
    _lngAccum = lng;
    _lngAccumPrev = _wrapLng(lng);
    // v0.9.139 — Programmatische Navigation = neuer Dreh-Ursprung. Der
    // Counter zeigt ab hier 0 und zählt die folgende User-Drehung relativ.
    _lngRotOrigin = lng;
  }
  // v0.9.139 — Drehung relativ zum Ursprung (für Counter-Anzeige). Eine
  // volle Drehung in beide Richtungen ergibt exakt ±360° (±1.00↻),
  // unabhängig vom absoluten Längengrad des Tracks.
  function _lngRotationRelative() {
    if (_lngAccum === null) return 0;
    const origin = (_lngRotOrigin !== null) ? _lngRotOrigin : _lngAccum;
    return _lngAccum - origin;
  }
  // Bei jedem User-Move (Drag + Inertia) aufgerufen: misst das gewickelte
  // Delta, erkennt ±180°-Sprünge (Datumsgrenze) und akkumuliert in den
  // abgewickelten Wert.
  function _trackLngAccumFromMap() {
    if (!map) return;
    const cur = _wrapLng(map.getCenter().lng);
    if (_lngAccum === null) { _seedLngAccum(cur); _updateLngLiveDisplay(); return; }
    let d = cur - _lngAccumPrev;
    if (d > 180) d -= 360;        // sprang von ~-180 nach ~+180
    else if (d < -180) d += 360;  // sprang von ~+180 nach ~-180
    _lngAccum += d;
    _lngAccumPrev = cur;
    _updateLngLiveDisplay();
  }

  // v0.9.139 — Bringt den Akkumulator auf die AKTUELLE (gesetzte) Kartenmitte
  // und liefert den abgewickelten Längengrad. Schutz gegen Mapbox-Drag-
  // Trägheit (Inertia): nach dem Loslassen eines Flicks gleitet die Karte
  // weiter (feuert `move`/`moveend`), und falls der Akkumulator dabei aus
  // irgendeinem Grund hinterherhinkt, holt diese Reconcile-Stufe das letzte
  // Rest-Delta nach. Davor scheiterte beim Speichern der harte Toleranz-Check
  // (|accum-center|<0.01) → der gewickelte Wert wurde persistiert → die volle
  // Welt-Drehung ging verloren (Marc-Bug „dreht nicht wie aufgenommen").
  function _reconcileLngAccumToCenter() {
    if (!map) return null;
    const cur = _wrapLng(map.getCenter().lng);
    if (_lngAccum === null) { _seedLngAccum(cur); return _lngAccum; }
    let d = cur - _wrapLng(_lngAccum);
    if (d > 180) d -= 360;
    else if (d < -180) d += 360;
    _lngAccum += d;
    _lngAccumPrev = cur;
    return _lngAccum;
  }

  // v0.9.137 — Aktualisiert (a) den Live-Drehungszähler im Viewport und (b),
  // falls der Keyframe-Editor offen ist, die Lon/Lat-Felder live mit dem
  // aktuellen abgewickelten Wert. So sieht der User beim Karten-Ziehen sofort
  // wie die Welt-Drehung hochzählt.
  function _updateLngLiveDisplay() {
    if (!map) return;
    const c = map.getCenter();
    const lngAcc = (_lngAccum !== null) ? _lngAccum : c.lng;
    // v0.9.139 — Counter zeigt die Drehung RELATIV zum Dreh-Ursprung, nicht
    // den absoluten Längengrad/360. So ergibt eine volle Drehung in beide
    // Richtungen exakt ±1.00↻ (vorher: West-Drehung von Berlin = -0.96↻).
    const rotRel = _lngRotationRelative();
    // (a) Live-Counter im Viewport (permanent sichtbar als Debug-/Status-Anzeige)
    const rc = document.getElementById("anim-rot-counter-val");
    if (rc) rc.textContent = _formatRotationLabel(rotRel);
    // (b) Lon/Lat-Felder im KF-Editor (nur wenn vorhanden + sichtbar)
    const lngEl = document.getElementById("anim-kf-lng");
    const latEl = document.getElementById("anim-kf-lat");
    if (lngEl) {
      // dataset.userValue bleibt der ABSOLUTE abgewickelte Längengrad — das
      // ist die echte Koordinate die gespeichert/angewandt wird.
      lngEl.dataset.userValue = String(+lngAcc.toFixed(4));
      const cl = Math.max(-540, Math.min(540, lngAcc));
      lngEl.value = String(cl);
      // Label zeigt die relative Drehung (konsistent mit dem Viewport-Counter).
      const lngV = document.getElementById("anim-kf-lng-v");
      if (lngV) lngV.textContent = _formatRotationLabel(rotRel);
    }
    if (latEl) {
      const latC = +c.lat.toFixed(4);
      latEl.value = String(Math.max(-85, Math.min(85, latC)));
      const latV = document.getElementById("anim-kf-lat-v");
      if (latV) latV.textContent = latC.toFixed(1) + "°";
    }
  }

  /**
   * Letterbox-Viewport an die gewählte Render-Auflösung anpassen.
   * Identisches Pattern wie Tour-Map — Vorschau und Render zeigen damit
   * geometrisch dasselbe (WYSIWYG, gleicher Zoom-Level).
   */
  function updateAnimatorViewport() {
    const wrap = document.getElementById("anim-viewport");
    const section = document.querySelector(".anim-canvas");
    const badge = document.getElementById("anim-res-badge");
    if (!wrap || !section) return;
    const rwEl = document.getElementById("anim-w");
    const rhEl = document.getElementById("anim-h");
    const rw = parseInt(rwEl?.value) || 1920;
    const rh = parseInt(rhEl?.value) || 1080;
    const targetAR = rw / rh;
    const margin = 20;
    // v0.9.7 — `.anim-canvas` hat padding-bottom (Platz für die Timeline-Bar).
    // `clientHeight` enthält das Padding aber — wenn wir es nicht abziehen,
    // wird der Viewport zu hoch, sein unterer Rand ragt in die Timeline-
    // Region rein, und damit landen Overlays (Höhenprofil, Stats) + die
    // .anim-resolution-badge optisch IM Bild statt davor.
    // Marc 2026-05-23: „Auflösung steht plötzlich wieder die ganze Zeit
    // im Bild und das Höhenprofil ist in der Preview zu weit unten".
    const cs = window.getComputedStyle(section);
    const padBot = parseFloat(cs.paddingBottom) || 0;
    const padTop = parseFloat(cs.paddingTop)    || 0;
    const avW = section.clientWidth - margin * 2;
    const avH = section.clientHeight - margin * 2 - padBot - padTop;
    if (avW <= 0 || avH <= 0) return;
    const availAR = avW / avH;
    let w, h;
    if (availAR > targetAR) {
      h = avH;
      w = h * targetAR;
    } else {
      w = avW;
      h = w / targetAR;
    }
    wrap.style.width  = Math.round(w) + "px";
    wrap.style.height = Math.round(h) + "px";
    if (map) {
      try { map.resize(); } catch (_) {}
    }

    // Overlay-Preview-Layer: in RENDER-Pixel-Größe rendern + transform-scale
    // auf die Letterbox-Größe verkleinern. Damit kann die Preview-CSS exakt
    // die selben Werte (Font, Padding, Position) wie der Render nutzen
    // → 1:1 WYSIWYG der Overlay-Optik.
    const layer = document.getElementById("anim-overlay-preview");
    if (layer) {
      const scale = w / rw;
      layer.style.width  = rw + "px";
      layer.style.height = rh + "px";
      layer.style.transform = `scale(${scale})`;
      layer.style.transformOrigin = "top left";
      // v0.6.3 — Overlay-Skalierung an Render-Höhe koppeln (siehe CSS-Doku
      // `--overlay-scale`). Base 1080. Min 0.5 für sehr kleine Tests.
      // Synchron zum Backend in core/animator.py._overlay_scale().
      const overlayScale = Math.max(0.5, rh / 1080);
      layer.style.setProperty("--overlay-scale", overlayScale);
    }

    if (badge) {
      const r = rw / rh;
      const ar = (() => {
        if (Math.abs(r - 16/9) < 0.02) return "16:9";
        if (Math.abs(r - 9/16) < 0.02) return "9:16";
        if (Math.abs(r - 1)    < 0.02) return "1:1";
        if (Math.abs(r - 4/3)  < 0.02) return "4:3";
        if (Math.abs(r - 3/4)  < 0.02) return "3:4";
        return rw + ":" + rh;
      })();
      const newText = rw + "×" + rh + "  ·  " + ar;
      // v0.9.8 — Badge fadet automatisch wieder weg.
      // Nur sichtbar zeigen wenn sich was geändert hat ODER beim Erst-Mount.
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

  // Style-Map muss zum Backend (`core/animator.py.MAP_STYLES`) passen
  const MAP_STYLES = {
    satellite:          "mapbox://styles/mapbox/standard-satellite",
    satellite_streets:  "mapbox://styles/mapbox/satellite-streets-v12",
    streets:            "mapbox://styles/mapbox/streets-v12",
    outdoors:           "mapbox://styles/mapbox/outdoors-v12",
    light:              "mapbox://styles/mapbox/light-v11",
    dark:               "mapbox://styles/mapbox/dark-v11",
  };

  function currentLineColor() {
    return document.getElementById("anim-color").value || "#ff6b35";
  }
  function currentTerrainOn() {
    return document.getElementById("anim-terrain").checked;
  }
  function currentExaggeration() {
    return parseFloat(document.getElementById("anim-ex").value) || 1.5;
  }
  function currentPitch() {
    return parseFloat(document.getElementById("anim-pitch").value) || 0;
  }

  /**
   * Re-Build der Track-Layer auf die Map. Wird aufgerufen nach `style.load`
   * (denn setStyle entfernt alle Sources/Layer).
   */
  function currentLineWidth() {
    return parseFloat(document.getElementById("anim-lw")?.value) || 3.5;
  }
  // v0.9.169 — Ghost-Track (ganze Route schwach im Hintergrund)
  function currentGhostEnabled() {
    return !!document.getElementById("anim-ghost-enabled")?.checked;
  }
  function currentGhostOpacity() {
    // Slider in % (5..80), Paint braucht 0..1
    return (parseFloat(document.getElementById("anim-ghost-opacity")?.value) || 30) / 100;
  }
  function currentGhostColor() {
    return document.getElementById("anim-ghost-color")?.value || "#ff6b35";
  }

  // v0.9.211 (Reiseroute) — GPX-Ghost-Config (geladenes GPX als Hintergrund-Linie).
  function currentGhostGpxShow() {
    const el = document.getElementById("route-ghost-show");
    return el ? !!el.checked : true;
  }
  function currentGhostGpxColor() {
    return document.getElementById("route-ghost-color")?.value || "#7fa8ff";
  }
  function currentGhostGpxOpacity() {
    return (parseFloat(document.getElementById("route-ghost-opacity")?.value) || 60) / 100;
  }
  function currentGhostGpxWidth() {
    return parseFloat(document.getElementById("route-ghost-width")?.value) || 2.5;
  }
  function currentGhostGpxDashed() {
    const el = document.getElementById("route-ghost-dashed");
    return el ? !!el.checked : true;
  }
  // v0.9.215 — GPX-Ghost-Einstellungen aus dem Projekt in die Regler zurück­spielen
  // (für den App-Start, wo das Modul vor dem GPX-Load mountet und bindSetting
  // noch leer lief). Danach live anwenden.
  function _ghostGpxRestore() {
    if (!_isReiseroute) return;
    let a = null;
    try { a = (typeof getActiveProject === "function" ? getActiveProject() : null)?.[_MODKEY]; } catch (_) {}
    if (!a) a = (_settingsCache && _settingsCache[_MODKEY]) || {};
    const setVal = (id, v) => { const e = document.getElementById(id); if (e && v != null) e.value = v; };
    const setChk = (id, v) => { const e = document.getElementById(id); if (e && v != null) e.checked = !!v; };
    if ("ghost_gpx_show" in a) setChk("route-ghost-show", a.ghost_gpx_show);
    if (a.ghost_gpx_color) { setVal("route-ghost-color", a.ghost_gpx_color); const l = document.getElementById("route-ghost-color-v"); if (l) l.textContent = a.ghost_gpx_color; }
    if (a.ghost_gpx_opacity_pct != null) { setVal("route-ghost-opacity", a.ghost_gpx_opacity_pct); const l = document.getElementById("route-ghost-opacity-v"); if (l) l.textContent = Math.round(a.ghost_gpx_opacity_pct) + " %"; }
    if (a.ghost_gpx_width != null) { setVal("route-ghost-width", a.ghost_gpx_width); const l = document.getElementById("route-ghost-width-v"); if (l) l.textContent = parseFloat(a.ghost_gpx_width).toFixed(1) + " px"; }
    if ("ghost_gpx_dashed" in a) setChk("route-ghost-dashed", a.ghost_gpx_dashed);
    _applyGhostGpx();
  }

  // v0.8.11 — Track-Anteil an der gesamten Timeline (anim + hold).
  // Wird gebraucht um aus einem Timeline-Anker (0..1 von Gesamt-Render) den
  // Track-Index abzuleiten:
  //   - timeline_anchor < track_fraction  → Track-Phase, idx = (timeline_anchor / track_fraction) * (n-1)
  //   - timeline_anchor >= track_fraction → Hold-Phase, idx = n-1 (Track steht still)
  // Bei hold_s=0 ist track_fraction=1.0 — Timeline-Anker und Track-Anker
  // sind identisch (Backward-Compat).
  function trackFraction() {
    // v0.9.59: tf bezeichnet die Position auf der Timeline wo die Anim-Phase
    // ENDET. Bei intro_s > 0: tf = (intro + dur) / total. Sonst klassisch.
    const intro = parseFloat(document.getElementById("anim-intro")?.value) || 0;
    const dur = parseFloat(document.getElementById("anim-dur")?.value) || 12;
    const hold = parseFloat(document.getElementById("anim-hold")?.value) || 0;
    return (intro + dur) / Math.max(0.001, intro + dur + hold);
  }
  // v0.9.59: Intro-Bruchteil — Position wo die Anim-Phase BEGINNT (= Intro endet).
  function introFraction() {
    const intro = parseFloat(document.getElementById("anim-intro")?.value) || 0;
    const dur = parseFloat(document.getElementById("anim-dur")?.value) || 12;
    const hold = parseFloat(document.getElementById("anim-hold")?.value) || 0;
    return intro / Math.max(0.001, intro + dur + hold);
  }
  // Hilfsfunktion: Timeline-Anchor → Track-Index (0..n-1).
  // v0.9.69 (Marc-Bug): Mapping muss Intro-Phase + Trim-Range berücksichtigen.
  // Vorher: `anchor/tf * (n-1)` → ignorierte Intro UND Trim → bei anchor=ti
  // (= Ende Intro / Start Anim) sprang Marker auf z.B. 20 % des Tracks
  // statt am trim_start zu stehen. Resultat: scrubPreview zeichnete schon
  // einen Track-Aufbau obwohl die Anim noch nicht losgelaufen ist.
  //   anchor in [0, ti]:  marker = trim_start            (Intro = Stillstand)
  //   anchor in [ti, tf]: marker walkt trim_start → end (Anim-Phase)
  //   anchor in [tf, 1]:  marker = trim_end             (Hold = Stillstand)
  function trackIdxFromTimelineAnchor(anchor) {
    const n = currentCoords ? currentCoords.length : 0;
    if (n < 2) return 0;
    const ti = introFraction();
    const tf = trackFraction();
    const trim = (_tlBar && typeof _tlBar.getTrim === "function")
      ? _tlBar.getTrim() : { start: 0, end: 1 };
    const trimA = Math.max(0, Math.min(1, trim.start ?? 0));
    const trimB = Math.max(trimA, Math.min(1, trim.end ?? 1));
    let markerReal;
    if (anchor <= ti) {
      markerReal = trimA;
    } else if (anchor < tf) {
      const animProgress = (anchor - ti) / Math.max(0.0001, tf - ti);
      markerReal = trimA + animProgress * (trimB - trimA);
    } else {
      markerReal = trimB;
    }
    return Math.max(0, Math.min(n - 1, Math.round(markerReal * (n - 1))));
  }

  function currentShadowStrength() {
    return parseFloat(document.getElementById("anim-shadow-strength")?.value) || 0;
  }
  // v0.9.309 — kein Toggle mehr: „an" = Stärke > 0.
  function currentShadowEnabled() {
    return currentShadowStrength() > 0;
  }
  function currentGlowEnabled() {
    return currentGlowStrength() > 0;
  }
  function currentGlowStrength() {
    return parseFloat(document.getElementById("anim-glow-strength")?.value) || 0;
  }
  function currentAlphaEnabled() {
    // v0.6.0: Alpha-Modus = Stil "alpha". Vorher eigene Checkbox.
    return document.getElementById("anim-style")?.value === "alpha";
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
    // WICHTIG — Layer-Reihenfolge: shadow < glow < line (von unten nach oben).
    // Shadow muss ZUERST added werden (= darunter), damit er nicht den Track
    // überdeckt. Beim Re-mount (style-load) wird rebuildPreviewLayers() neu
    // aufgerufen → wir prüfen jeden Layer einzeln mit getLayer.
    // Layout für alle Track-Layer: round-caps/round-joins (sauber, statt
    // Mapbox-Default butt/miter). Synchron zum Render-HTML.
    const trackLayout = { "line-cap": "round", "line-join": "round" };
    // v0.8.14 — dasharray DIREKT beim Layer-Anlegen mitgeben statt nachträglich
    // per setPaintProperty zu setzen (Mapbox-GL 3.x baked SDF nur beim Anlegen).
    const dash = currentDasharray();
    const dashPaint = dash ? { "line-dasharray": dash } : {};
    // v0.9.16 — line-z-offset (150 m) MUSS auch in der Preview gesetzt sein,
    // wenn Terrain aktiv ist — sonst rendert das Backend den Track 150 m über
    // dem Boden schwebend, die Preview malt ihn aber auf dem Boden. In
    // gekippter Ansicht ändert das die Perspektive (Track erscheint im Render
    // dünner / verschoben). Synchron zu core/animator.py (Glow + Main +
    // Highlight haben z-offset; Shadow bewusst NICHT, damit der Schatten am
    // Boden bleibt).
    const zOffPaint = currentTerrainOn() ? { "line-z-offset": 150 } : {};
    // v0.9.169 — Ghost-Track: ganze Route als UNTERSTE Linie (eigene Source mit
    // ALLEN Punkten, wird nie getrimmt/animiert). Zuerst added = ganz unten.
    // Sichtbarkeit/Deckkraft steuert applyGhost().
    if (!map.getSource("preview-ghost")) {
      map.addSource("preview-ghost", {
        type: "geojson",
        data: { type: "Feature", geometry: { type: "LineString", coordinates: currentCoords || [] } },
      });
    } else if (currentCoords) {
      map.getSource("preview-ghost").setData({
        type: "Feature", geometry: { type: "LineString", coordinates: currentCoords },
      });
    }
    if (!map.getLayer("preview-ghost")) {
      map.addLayer({ id: "preview-ghost", type: "line", source: "preview-ghost",
        layout: { ...trackLayout, "visibility": "none" },
        paint: { "line-color": currentGhostColor(), "line-width": lw, "line-opacity": currentGhostOpacity(), ...dashPaint, ...zOffPaint } });
    }
    // v0.9.210 (Reiseroute Phase 2) — das geladene GPX (Wanderung) als ZWEITER
    // Ghost: andere Linie als die animierte Route, faint+gestrichelt, ganz unten.
    if (_isReiseroute) {
      if (!map.getSource("preview-ghost-gpx")) {
        map.addSource("preview-ghost-gpx", { type: "geojson",
          data: { type: "Feature", geometry: { type: "LineString", coordinates: _ghostGpxCoords || [] } } });
      } else if (_ghostGpxCoords) {
        map.getSource("preview-ghost-gpx").setData({
          type: "Feature", geometry: { type: "LineString", coordinates: _ghostGpxCoords } });
      }
      if (!map.getLayer("preview-ghost-gpx")) {
        map.addLayer({ id: "preview-ghost-gpx", type: "line", source: "preview-ghost-gpx",
          layout: { "line-cap": "round", "line-join": "round",
                    "visibility": (_ghostGpxCoords && _ghostGpxCoords.length > 1 && currentGhostGpxShow()) ? "visible" : "none" },
          paint: { "line-color": currentGhostGpxColor(), "line-width": currentGhostGpxWidth(),
                   "line-opacity": currentGhostGpxOpacity(),
                   "line-dasharray": currentGhostGpxDashed() ? [2, 2] : [1, 0] } });
      }
    }
    if (!map.getLayer("preview-shadow")) {
      const st = currentShadowStrength();
      map.addLayer({ id: "preview-shadow", type: "line", source: "preview-track",
        layout: trackLayout,
        paint: {
          "line-color": "rgba(0,0,0,0.7)",
          "line-width": lw * 2.2,
          "line-blur": st,
          "line-translate": [st, st],
          ...dashPaint,
          // KEIN z-offset — Shadow soll am Boden bleiben (siehe Render-Code).
        }
      });
    }
    if (!map.getLayer("preview-glow")) {
      const gs = currentGlowStrength();
      // v0.9.16 — Glow-Opacity auf 0.35 angeglichen (war 0.4 vs Render 0.35).
      // v0.9.20 — line-width skaliert mit gs: bei gs=4 (Default) ≈ 2.85×lw
      // (Backward-Compat), bei gs=10 → 4.10×lw (sichtbar breiterer Halo).
      // Spiegelung core/animator.py.
      map.addLayer({ id: "preview-glow", type: "line", source: "preview-track",
        layout: trackLayout,
        paint: { "line-color": color, "line-width": lw * (2.0 + 0.21 * gs), "line-opacity": 0.35, "line-blur": gs, ...dashPaint, ...zOffPaint } });
    }
    if (!map.getLayer("preview-line")) {
      map.addLayer({ id: "preview-line", type: "line", source: "preview-track",
        layout: trackLayout,
        paint: { "line-color": color, "line-width": lw, "line-opacity": 0.95, ...dashPaint, ...zOffPaint } });
    }
    // v0.8.10 — Röhre (Nutzer-Wunsch): weißer Highlight-Streifen oben auf
    // der Linie, simuliert eine zylindrische Oberfläche → wirkt plastischer.
    // Synchron zum Render-HTML (core/animator.py track-highlight-Layer).
    // Wird immer angelegt; Sichtbarkeit steuert applyTrackStyle().
    if (!map.getLayer("preview-highlight")) {
      map.addLayer({ id: "preview-highlight", type: "line", source: "preview-track",
        layout: { ...trackLayout, "visibility": "none" },
        paint: { "line-color": "#ffffff", "line-width": lw * 0.35, "line-opacity": 0.55, "line-blur": 0.6, ...zOffPaint } });
    }
    // Schatten-Sichtbarkeit + Glow-Sichtbarkeit + Alpha-Background + Hide-Labels
    // nach jedem Rebuild neu setzen (Style-Wechsel resettet sonst alle Layer).
    // v0.8.14 — applyLineStyle() rufen wir hier NICHT mehr; dasharray ist
    // direkt in den Layer-Paint-Props eingebaut. Sonst gäb's eine Rekursion.
    applyShadowToLayers();
    applyGlowToLayers();
    applyGhost();
    applyAlphaPreview();
    applyHideLabels();
    applyTrackStyle();
    applyTerrain();
    // v0.7.0: Camera-Keyframe-Pins zeichnen (gelbe Kreise auf der Track-Linie
    // bei den jeweiligen Track-Anker-Positionen).
    rebuildCameraKeyframePins();
    // v0.9.310: Standbild-Modus — Start/Ziel-Markierung in die Vorschau (WYSIWYG
    // zum Render). Nur wenn staticFrame + Toggle an.
    try { updateStaticPinsPreview(); } catch (_) {}
  }

  // v0.9.310 — Start/Ziel-Pins in der Live-Vorschau (nur Standbild/Tour-Map).
  // Spiegelt den Render-Stil aus core/animator.py (SHOW_PINS-Block): weißer
  // Glow + zweifarbiger Kern (Start = weiß mit Linienfarbe-Rand, Ziel umgekehrt).
  function updateStaticPinsPreview() {
    if (!map) return;
    const want = _isStaticFrame
      && (document.getElementById("anim-static-pins")?.checked ?? true)
      && Array.isArray(currentCoords) && currentCoords.length >= 2;
    const removePins = () => {
      ["preview-pin-core", "preview-pin-glow"].forEach(l => { try { if (map.getLayer(l)) map.removeLayer(l); } catch (_) {} });
      try { if (map.getSource("preview-pins")) map.removeSource("preview-pins"); } catch (_) {}
    };
    if (!want) { removePins(); return; }
    const color = currentLineColor();
    const data = { type: "FeatureCollection", features: [
      { type: "Feature", properties: { kind: "start" }, geometry: { type: "Point", coordinates: currentCoords[0] } },
      { type: "Feature", properties: { kind: "end" },   geometry: { type: "Point", coordinates: currentCoords[currentCoords.length - 1] } },
    ]};
    if (!map.getSource("preview-pins")) {
      map.addSource("preview-pins", { type: "geojson", data });
    } else {
      try { map.getSource("preview-pins").setData(data); } catch (_) {}
    }
    if (!map.getLayer("preview-pin-glow")) {
      map.addLayer({ id: "preview-pin-glow", type: "circle", source: "preview-pins",
        paint: { "circle-radius": 14, "circle-color": "#ffffff", "circle-opacity": 0.3, "circle-blur": 0.7, "circle-pitch-alignment": "map" } });
    }
    if (!map.getLayer("preview-pin-core")) {
      map.addLayer({ id: "preview-pin-core", type: "circle", source: "preview-pins",
        paint: { "circle-radius": 7,
          "circle-color": ["match", ["get", "kind"], "start", "#ffffff", "end", color, "#fff"],
          "circle-stroke-color": ["match", ["get", "kind"], "start", color, "end", "#ffffff", "#fff"],
          "circle-stroke-width": 2.5, "circle-pitch-alignment": "map" } });
    } else {
      // Linienfarbe kann sich geändert haben → Paint nachziehen.
      try {
        map.setPaintProperty("preview-pin-core", "circle-color", ["match", ["get", "kind"], "start", "#ffffff", "end", color, "#fff"]);
        map.setPaintProperty("preview-pin-core", "circle-stroke-color", ["match", ["get", "kind"], "start", color, "end", "#ffffff", "#fff"]);
      } catch (_) {}
    }
  }

  // ── v0.7.0: Camera-Keyframe-Pins auf der Karte ───────────────────────────
  // Zeichnet pro Camera-Event einen gelben Pin an der jeweiligen Track-
  // Position. Synchron zur Timeline-Bar — klicken auf einen Pin selektiert
  // den Keyframe, genauso wie klicken auf einen Timeline-Marker.
  function rebuildCameraKeyframePins() {
    // v0.8.16: Wenn der Keyframe-Editor ausgeschaltet ist, keine Pins
    // anzeigen — getTimelineEvents() returnt eh [].
    // v0.9.15: Wenn der User Pins explizit ausgeblendet hat (für WYSIWYG-
    // Vergleich gegen das finale Render), auch keine Pins anzeigen.
    if (!map || !currentCoords || currentCoords.length < 2
        || !keyframesEnabled() || !previewShowKfPins()) {
      try {
        if (map && map.getLayer("preview-kf-pins")) map.removeLayer("preview-kf-pins");
        if (map && map.getSource("preview-kf"))    map.removeSource("preview-kf");
      } catch (_) {}
      return;
    }
    // v0.9.0: jetzt pro Cluster (= ein Anker mit mehreren Property-Events)
    // ein Pin, statt pro Camera-Event. Cluster-Anker werden über
    // clusterAnchors() ermittelt.
    const anchors = clusterAnchors();
    const features = anchors.map((anchor, idx) => {
      const a = Math.max(0, Math.min(1, anchor));
      const coordIdx = trackIdxFromTimelineAnchor(a);
      const coord = currentCoords[coordIdx] || currentCoords[0];
      return {
        type: "Feature",
        properties: { idx, selected: idx === _selectedKfIdx },
        geometry: { type: "Point", coordinates: coord },
      };
    });
    const data = { type: "FeatureCollection", features };
    if (!map.getSource("preview-kf")) {
      map.addSource("preview-kf", { type: "geojson", data });
    } else {
      map.getSource("preview-kf").setData(data);
    }
    if (!map.getLayer("preview-kf-pins")) {
      map.addLayer({
        id: "preview-kf-pins",
        type: "circle",
        source: "preview-kf",
        paint: {
          "circle-radius": ["case", ["==", ["get", "selected"], true], 11, 8],
          "circle-color": ["case", ["==", ["get", "selected"], true], "#ffd166", "#ff6b35"],
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 2.5,
          "circle-opacity": 0.95,
        },
      });
      // Click-Handler einmalig binden
      map.on("click", "preview-kf-pins", (e) => {
        const feat = e.features && e.features[0];
        if (!feat) return;
        const idx = feat.properties.idx;
        selectKeyframe(idx);
      });
      map.on("mouseenter", "preview-kf-pins", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "preview-kf-pins", () => { map.getCanvas().style.cursor = ""; });
    }
  }

  // Linien-Stil live anwenden (v0.6.5, Nutzer-Feature-Request).
  // v0.6.6: zusätzlich Spacing-Slider — multipliziert die dasharray-Werte.
  // v0.6.7: dotted-Pattern auf [0.1, 2] korrigiert (Punkte statt Striche
  // dank line-cap: round). Glow-Layer wird jetzt AUCH dashed, sonst zeigt
  // er sich als kontinuierlicher Halo durch die Gaps zwischen den Punkten.
  // v0.8.14 — dasharray-Berechnung ausgelagert. Wird sowohl in
  // rebuildPreviewLayers() (beim Anlegen der Layer) als auch in applyLineStyle()
  // (beim Live-Wechsel) benutzt. Bei tube/solid: null (= keine dasharray).
  function currentDasharray() {
    const style = document.getElementById("anim-line-style")?.value || "solid";
    const spacing = Math.max(0.1, parseFloat(document.getElementById("anim-line-spacing")?.value) || 1);
    const base = { dashed: [3, 2], dotted: [0.1, 2], dashdot: [3, 1.5, 0.1, 1.5] }[style];
    return base ? base.map(v => v * spacing) : null;
  }

  function applyLineStyle() {
    if (!map) return;
    // v0.8.14 — Mapbox-GL 3.x baked das line-dasharray-SDF nur EINMAL beim
    // Layer-Anlegen. setPaintProperty mit anderen Werten wird zwar intern
    // gesetzt, aber das Render-SDF bleibt. Robuster Fix: Layer komplett
    // wegwerfen — rebuildPreviewLayers() legt sie mit aktuellem dasharray
    // (über currentDasharray()) frisch neu an.
    const layers = ["preview-line", "preview-glow", "preview-shadow", "preview-highlight"];
    try {
      for (const id of layers) {
        if (map.getLayer(id)) map.removeLayer(id);
      }
    } catch (e) { applog("warn", `[applyLineStyle] removeLayer failed: ${e}`); }
    applog("debug", `[applyLineStyle] dasharray=${JSON.stringify(currentDasharray())}`);
    rebuildPreviewLayers();
  }

  // v0.8.10 — Höhere-Tube-Optik (Marc-Spec 2026-05-23, Nutzer-Inspiration):
  // weißer Highlight-Streifen wenn line_style == "tube". Sonst unsichtbar.
  // v0.8.12 — liest aus line_style statt aus separatem track_style-Feld
  // (Marc-Wunsch: gehört zu den 2D-Linien-Stilen).
  function applyTrackStyle() {
    if (!map) return;
    const style = document.getElementById("anim-line-style")?.value || "solid";
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


  function applyShadowToLayers() {
    if (!map) return;
    const enabled = currentShadowEnabled();
    const st = currentShadowStrength();
    const lw = currentLineWidth();
    const visible = enabled && st > 0;
    try {
      if (map.getLayer("preview-shadow")) {
        map.setLayoutProperty("preview-shadow", "visibility", visible ? "visible" : "none");
        if (visible) {
          map.setPaintProperty("preview-shadow", "line-width", lw * 2.2);
          map.setPaintProperty("preview-shadow", "line-blur", st);
          map.setPaintProperty("preview-shadow", "line-translate", [st, st]);
        }
      }
    } catch (_) {}
  }

  // Glow-Sichtbarkeit + Stärke (v0.6.8). Analog applyShadowToLayers.
  // v0.9.169 — Ghost-Track: Sichtbarkeit + Deckkraft + Farbe/Breite/Dash live
  // an die Hintergrund-Linie anlegen (synchron zu Render: core/animator.py).
  function applyGhost() {
    if (!map) return;
    try {
      if (!map.getLayer("preview-ghost")) return;
      const on = currentGhostEnabled();
      map.setLayoutProperty("preview-ghost", "visibility", on ? "visible" : "none");
      if (on) {
        map.setPaintProperty("preview-ghost", "line-opacity", currentGhostOpacity());
        map.setPaintProperty("preview-ghost", "line-color", currentGhostColor());
        map.setPaintProperty("preview-ghost", "line-width", currentLineWidth());
        // Ghost-Source aktuell halten (voller Track, unabhängig vom Trim/Scrub).
        if (currentCoords && map.getSource("preview-ghost")) {
          map.getSource("preview-ghost").setData({
            type: "Feature", geometry: { type: "LineString", coordinates: currentCoords },
          });
        }
      }
    } catch (_) {}
  }

  // v0.9.210/211 (Reiseroute) — Ghost des geladenen GPX live anlegen + Config
  // (Sichtbarkeit/Farbe/Deckkraft/Breite/Strichelung) anwenden.
  function _applyGhostGpx() {
    if (!map || !_isReiseroute) return;
    try {
      if (!map.getLayer("preview-ghost-gpx")) { rebuildPreviewLayers(); return; }
      const has = !!(_ghostGpxCoords && _ghostGpxCoords.length > 1) && currentGhostGpxShow();
      map.setLayoutProperty("preview-ghost-gpx", "visibility", has ? "visible" : "none");
      if (has) {
        map.getSource("preview-ghost-gpx").setData({
          type: "Feature", geometry: { type: "LineString", coordinates: _ghostGpxCoords } });
        map.setPaintProperty("preview-ghost-gpx", "line-color", currentGhostGpxColor());
        map.setPaintProperty("preview-ghost-gpx", "line-opacity", currentGhostGpxOpacity());
        map.setPaintProperty("preview-ghost-gpx", "line-width", currentGhostGpxWidth());
        map.setPaintProperty("preview-ghost-gpx", "line-dasharray", currentGhostGpxDashed() ? [2, 2] : [1, 0]);
      }
    } catch (_) {}
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
          // v0.9.20 — line-width skaliert mit gs (Backward-Compat bei gs=4).
          map.setPaintProperty("preview-glow", "line-width", lw * (2.0 + 0.21 * gs));
        }
      }
    } catch (_) {}
  }

  /** v0.8.6: Liest aktuellen Karten-State (pitch/bearing/zoom) und
   *  verteilt ihn an die Sidebar-Slider und ggf. an den aktiven
   *  Keyframe. Wird bei map "moveend" (nur User-Gesten via originalEvent)
   *  gerufen. So kann Marc den Cinematic direkt auf der Karte einstellen
   *  statt mit den Detail-Editor-Slidern hin- und herzuziehen. */
  function _syncMapStateToUi() {
    if (!map) return;
    const curPitch = +map.getPitch().toFixed(2);
    const curBearing = +map.getBearing().toFixed(2);
    const curZoom = +map.getZoom().toFixed(3);
    // v0.9.37/39: wenn _fitZoomBase noch null, Slider-Sync skippen (sonst NaN).
    // _syncMapStateToUi wird kontinuierlich gerufen (z.B. moveend) — beim
    // nächsten Lauf nach echtem moveend ist's gesetzt.
    const fitBase = effectiveFitZoomBase();
    const zoomOff = fitBase != null ? +(curZoom - fitBase).toFixed(2) : 0;

    // Haupt-Pitch-Slider mitführen (cfg.pitch — Fallback ohne Keyframes)
    const pitchSlider = document.getElementById("anim-pitch");
    const pitchLabel  = document.getElementById("anim-pitch-v");
    if (pitchSlider) {
      pitchSlider.value = String(curPitch);
      if (pitchLabel) pitchLabel.textContent = curPitch.toFixed(0) + "°";
      if (typeof saveProjectSettings === "function" && typeof getActiveSession === "function" && getActiveSession()) {
        saveProjectSettings(_MODKEY, { pitch: curPitch });
      } else {
        saveSettings({ animator: { pitch: curPitch } });
      }
    }

    // v0.8.17 — Zoom-Stufe-Slider (Classic-Modus) mitführen
    const zoomSlider = document.getElementById("anim-zoom");
    const zoomLabel  = document.getElementById("anim-zoom-v");
    if (zoomSlider && !keyframesEnabled()) {
      zoomSlider.value = String(curZoom);
      if (zoomLabel) zoomLabel.textContent = curZoom.toFixed(1);
      // Persistenz: spiegelt den Live-Zoom als static_zoom — beim nächsten
      // Restart fängt die Map natürlich wieder mit Auto-Fit an, dieser Wert
      // ist eher informativ.
      if (typeof saveProjectSettings === "function" && typeof getActiveSession === "function" && getActiveSession()) {
        saveProjectSettings(_MODKEY, { static_zoom: curZoom });
      }
    }

    // v0.9.0 — Wenn auf einem Keyframe-Cluster: dessen Property-Events
    // mitupdaten. Track-Folgen-Status: kein center-Event vorhanden.
    if (_selectedKfIdx != null) {
      const anchors = clusterAnchors();
      // v0.9.145 (Marc-Bug „1. KF kriegt fälschlich die Werte"): NUR in den
      // ausgewählten KF schreiben, wenn der Scrubber WIRKLICH auf ihm steht.
      // Vorher: ein stale _selectedKfIdx (oft 0 = 1. KF, von früher angewählt
      // und über skipSelectionSync-Pfade — KF-Editor-Toggle Z.1912,
      // Projekt-Restore Z.4216 — nicht zurückgesetzt) bekam beim Pannen/Zoomen
      // an einer Nicht-KF-Scrubber-Position fälschlich die aktuellen Map-Werte.
      // So wurde gleichzeitig zum bewusst neu gesetzten KF der 1. KF überschrieben.
      const scrubAnchor = _tlBar ? _tlBar.getScrubber() : null;
      const onSelectedKf = scrubAnchor != null
        && findKeyframeAtAnchor(scrubAnchor) === _selectedKfIdx;
      if (onSelectedKf && _selectedKfIdx < anchors.length) {
        const curProps = clusterPropsAt(anchors[_selectedKfIdx]);
        const isTracking = curProps.center == null;
        const patch = {
          pitch: curPitch,
          bearing: curBearing,
          zoom_offset: zoomOff,
          // v0.9.73: gleichzeitig zoom_absolute speichern (reload-stabil).
          // curZoom ist der aktuelle Mapbox-Zoom; bleibt unabhängig von
          // späteren Fit-Base-Drifts gültig.
          zoom_absolute: curZoom,
        };
        if (!isTracking) {
          const c = map.getCenter();
          // v0.9.138/139 (Marc-Bug „Counter zählt, Preview dreht nicht" +
          // „dreht nicht wie aufgenommen"): map.getCenter().lng ist GEWICKELT
          // [-180,180). Eine volle Welt-Drehung per Drag steckt aber im
          // *abgewickelten* Akkumulator (_lngAccum, z.B. 374°). Reconcile
          // bringt den Akkumulator robust auf die finale (post-Inertia)
          // Kartenmitte und persistiert den abgewickelten Wert (inkl. voller
          // Erd-Umdrehungen) — identisch zu snapshotKeyframe. Ersetzt den
          // fragilen Toleranz-Check (<0.01), der bei Flick-Drehungen wegen
          // Drag-Trägheit scheiterte → beide KFs hatten denselben lng → keine
          // Drehung im Probe-Lauf.
          const recLng = _reconcileLngAccumToCenter();
          const lngVal = (recLng !== null) ? +recLng.toFixed(6) : +c.lng.toFixed(6);
          patch.center = [lngVal, +c.lat.toFixed(6)];
        }
        updateKeyframeFields(_selectedKfIdx, patch);
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = String(val); };
        const setLbl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        set("anim-kf-pitch", curPitch);
        setLbl("anim-kf-pitch-v", curPitch.toFixed(0) + "°");
        set("anim-kf-bearing", curBearing);
        setLbl("anim-kf-bearing-v", curBearing.toFixed(0) + "°");
        // Zoom-Slider zeigt absolut (siehe v0.8.17 dataset.fitBase Logik)
        // v0.9.39: fallback auf curZoom wenn _fitZoomBase noch nicht da
        const absZoom = (fitBase != null ? fitBase : curZoom) + zoomOff;
        set("anim-kf-zoom", absZoom);
        setLbl("anim-kf-zoom-v", absZoom.toFixed(1));
      }
    }
  }

  // ── v0.7.0: Timeline / Keyframe-Logik ────────────────────────────────────
  // _selectedKfIdx ist der Index in der timeline_events-Liste des aktuell
  // ausgewählten Camera-Keyframes (oder null = nichts ausgewählt).
  // _tlBar ist die Referenz auf die Timeline-Komponente (siehe mountTimelineBar).
  // v0.7.6: Diese Variablen sind oben in mountAnimator() deklariert (TDZ-Fix).

  // v0.8.16 — Master-Toggle: ist der Keyframe-Editor aktiviert?
  function keyframesEnabled() {
    const cb = document.getElementById("anim-kf-enabled");
    return !!cb?.checked;
  }

  // v0.9.11 — Preview-Toggle „Ganzer Track sichtbar". Persistiert pro Projekt
  // in `animator.preview_full_track`. Wird vom Timeline-Bar-Checkbox gepflegt
  // und in scrubPreview gelesen. Affects only Preview, nicht Render.
  function previewFullTrack() {
    const a = _activeProject?.[_MODKEY];
    if (a && "preview_full_track" in a) return !!a.preview_full_track;
    return !!(_settingsCache?.[_MODKEY]?.preview_full_track);
  }
  function setPreviewFullTrack(on) {
    saveProjectSettings(_MODKEY, { preview_full_track: !!on });
    // Source sofort aktualisieren — bei „an" voller Track, bei „aus" zur
    // aktuellen Scrubber-Position trimmen.
    refreshPreviewTrackData();
  }

  // v0.9.15 — KF-Pins-Toggle: gelbe Dots auf der Karten-Vorschau an Keyframe-
  // Positionen. Default TRUE (Editier-Hilfe). User kann ausschalten für
  // echtes WYSIWYG. Affects nur Preview, nicht Render.
  function previewShowKfPins() {
    const a = _activeProject?.[_MODKEY];
    if (a && "preview_show_kf_pins" in a) return !!a.preview_show_kf_pins;
    if (_settingsCache?.[_MODKEY] && "preview_show_kf_pins" in _settingsCache[_MODKEY]) {
      return !!_settingsCache[_MODKEY].preview_show_kf_pins;
    }
    return true;  // backward-compat: alte Projekte ohne den Key kriegen TRUE
  }
  function setPreviewShowKfPins(on) {
    saveProjectSettings(_MODKEY, { preview_show_kf_pins: !!on });
    rebuildCameraKeyframePins();
  }
  // v0.9.56 (Marc): Setting „Track vor Trim-Start zeigen" auch in der Preview
  // anwenden. Mirrors `cfg.show_pretrim_track` im Backend-Render.
  function showPretrimTrack() {
    const a = _activeProject?.[_MODKEY];
    if (a && "show_pretrim_track" in a) return !!a.show_pretrim_track;
    if (_settingsCache?.[_MODKEY] && "show_pretrim_track" in _settingsCache[_MODKEY]) {
      return !!_settingsCache[_MODKEY].show_pretrim_track;
    }
    return true;  // Default: zeigen (= bisheriges Verhalten)
  }
  // Hilfsfunktion: Start-Coord-Idx für die Track-Linie. Wenn Pre-Trim
  // sichtbar sein soll → 0. Sonst → Trim-Start-Coord (= round(trimA*(n-1))).
  function lineStartCoordIdx() {
    if (showPretrimTrack()) return 0;
    if (!currentCoords || currentCoords.length < 2) return 0;
    const trim = (_tlBar && _tlBar.getTrim) ? _tlBar.getTrim() : { start: 0, end: 1 };
    const trimA = Math.max(0, Math.min(1, trim.start ?? 0));
    return Math.max(0, Math.min(currentCoords.length - 1, Math.round(trimA * (currentCoords.length - 1))));
  }
  // Kleine Helfer-Fn die den preview-track-Source neu setzt — egal ob
  // voller Track oder bis zum aktuellen Scrubber-Punkt.
  function refreshPreviewTrackData() {
    if (!map || !currentCoords) return;
    try {
      const src = map.getSource("preview-track");
      if (!src) return;
      const scrubAnchor = _tlBar ? _tlBar.getScrubber() : 0;
      const coordIdx = trackIdxFromTimelineAnchor(scrubAnchor);
      const startIdx = lineStartCoordIdx();
      const coords = previewFullTrack()
        ? currentCoords
        : currentCoords.slice(startIdx, coordIdx + 1);
      src.setData({
        type: "Feature",
        geometry: { type: "LineString", coordinates: coords },
      });
    } catch (_) {}
  }

  // v0.9.10 — Misst die aktuelle Höhe der Timeline-Bar und setzt sie als
  // CSS-Variable `--anim-tl-h` auf der .anim-canvas. Damit folgen padding-
  // bottom + bottom-Offset des Refit-Buttons + Resolution-Badge automatisch
  // der echten Bar-Höhe (Multi-Lane an = ~250 px, Classic-Modus aus = ~95 px).
  // Wird gerufen nach Layout-Änderungen, die die Bar-Höhe beeinflussen
  // können (applyKeyframesEnabled, Hilfe-Toggle, Mount).
  function syncTimelineHeight() {
    const section = document.querySelector(".anim-canvas");
    const tlHost = document.querySelector(".anim-timeline-host");
    if (!section || !tlHost) return;
    // offsetHeight ist synchron — triggert ggf. einen Reflow, ist aber für
    // unseren Use-Case (selten gerufen) günstig.
    const h = tlHost.offsetHeight;
    if (h > 0) section.style.setProperty("--anim-tl-h", h + "px");
  }

  // v0.8.16 — Master-Toggle. Schaltet zwischen Classic-Kamera (Pitch+Rotation
  // statisch) und Keyframe-Kamera (per-KF Slider) um. Timeline-Bar BLEIBT
  // immer sichtbar (Marc-Wunsch: Probe-Lauf muss auch ohne KFs gehen) — nur
  // die KF-spezifischen Buttons (Snapshot, Clear) + Marker werden versteckt.
  function applyKeyframesEnabled() {
    const enabled = keyframesEnabled();

    // Sidebar Camera-Section: Sub-Body umschalten
    const classic = document.getElementById("anim-camera-body-classic");
    const kfBody = document.getElementById("anim-camera-body-keyframe");
    if (classic) classic.hidden = enabled;
    if (kfBody)  kfBody.hidden = !enabled;
    // v0.9.88 — Cineastischer-Flug-Toggle nur sichtbar wenn KF-Editor an.
    // Im Classic-Modus haben die impliziten Default-KFs identischen Zoom →
    // van-Wijk wird nie aktiv → Toggle wäre nutzlos.
    const cineRow = document.getElementById("anim-cinematic-flyto-row");
    if (cineRow) cineRow.hidden = !enabled;

    // Beim Ausschalten: Selection zurücksetzen
    if (!enabled) {
      _selectedKfIdx = null;
    }

    // Pins auf der Karte neu zeichnen (Funktion checkt selbst keyframesEnabled).
    rebuildCameraKeyframePins();

    // Timeline-Bar: Snapshot/Clear-Buttons + Marker hidden im Disabled-Modus,
    // Scrubber + Play bleiben. Steuern via CSS-Klasse am Host.
    const tlHost = document.getElementById("anim-timeline-host");
    if (tlHost) tlHost.classList.toggle("anim-timeline-host--kf-off", !enabled);

    // Detail-Editor neu rendern (zeigt Fields oder Empty-Hint)
    renderKeyframeEditor();
    if (_tlBar && _tlBar.updateStatusLabel) _tlBar.updateStatusLabel();

    // v0.9.10 — Bar-Höhe neu messen + Viewport neu fitten, damit die
    // Karte den frei gewordenen Platz (bzw. den durch Lane-Anzeige
    // benötigten) bekommt.
    syncTimelineHeight();
    updateAnimatorViewport();
    // v0.9.35 (Marc-Bug-Report): bei aktiviertem KF-Editor MIT gesetzten KFs
    // bestimmt der Scrubber die Map-Pose — nicht fitTrackPreview. Sonst
    // zoomen wir die Karte auf den Track-Extent und überschreiben die
    // KF-Map-Pose (= „Karte rauszoomen"-Bug bei aktivem KF-Editor).
    if (enabled && map && currentCoords && currentCoords.length > 1 && clusterAnchors().length > 0) {
      const a = _tlBar ? _tlBar.getScrubber() : 0;
      try { scrubPreview(a, { skipSelectionSync: true }); } catch (_) {}
    } else if (currentBbox) {
      fitTrackPreview(false);
    }
  }

  // v0.8.16: Liefert die GESPEICHERTEN events, ohne den enabled-Filter.
  // Für interne Buchhaltung (zählen, migrieren, speichern). Renderer und
  // UI-Layer sollen `getTimelineEvents()` benutzen — das filtert via Toggle.
  function getRawTimelineEvents() {
    if (typeof getActiveProject === "function") {
      const proj = getActiveProject();
      if (proj && proj[_MODKEY] && Array.isArray(proj[_MODKEY].timeline_events)) {
        return proj[_MODKEY].timeline_events;
      }
    }
    return _settingsCache?.[_MODKEY]?.timeline_events || [];
  }

  function getTimelineEvents() {
    // v0.8.16: wenn Editor ausgeschaltet ist, gibt es für die Render-/Preview-
    // Logik effektiv KEINE Keyframes. Sie bleiben aber im Cache erhalten,
    // sodass der User sie nicht verliert wenn er den Editor später wieder
    // anschaltet — Toggle ist nicht-destruktiv.
    if (!keyframesEnabled()) return [];
    return getRawTimelineEvents();
  }

  // v0.9.86 (Marc-Refactor „Classic = KF-Modus mit Default-KFs"):
  // Baut ein Set aus 2 impliziten KFs (anchor=0 + anchor=1) aus den globalen
  // Slider-Werten (pitch/rotation/zoom/camera_follow_track). Damit kann
  // Render+Preview einheitlich über `getEffectiveEvents()` laufen — kein
  // Sonderfall mehr für „Classic-Modus ohne KFs". Die User-UI bleibt
  // unverändert; intern ist Classic = KF-Modus mit 2 versteckten Default-KFs.
  //
  // Anchor=0 (Anim-Start): Bearing -10° (Mapbox-Convention für Start-Sweep)
  // Anchor=1 (Anim-Ende):  Bearing -10°+rotation (= Sweep über gesamte Dauer)
  // → Identisch zum bisherigen Classic-Bearing-Fallback `-10 + tprog*rotation`.
  // Pitch+Zoom konstant über beide KFs (User kann die Slider live ändern).
  // Center=null wenn camera_follow_track an, sonst null als Default (Track-Punkt).
  function buildDefaultEvents() {
    const pitch = parseFloat(document.getElementById("anim-pitch")?.value) || 40;
    const zoomAbs = parseFloat(document.getElementById("anim-zoom")?.value);
    const rot = parseFloat(document.getElementById("anim-rot")?.value) || 0;
    // center = null bedeutet Track-Punkt-Folgen (gewollt im Classic-Modus
    // wenn `camera_follow_track` an). Sonst lassen wir's auch null —
    // override_center wird via Bridge bei Render extra durchgereicht wenn
    // der User die Karte manuell gepant hat.
    const center = null;
    const evs = [
      { kind: "pitch",   anchor: 0, value: pitch },
      { kind: "pitch",   anchor: 1, value: pitch },
      { kind: "bearing", anchor: 0, value: -10 },
      { kind: "bearing", anchor: 1, value: -10 + rot },
      { kind: "center",  anchor: 0, value: center },
      { kind: "center",  anchor: 1, value: center },
    ];
    // Zoom nur wenn Slider-Wert sinnvoll ist (kann beim ersten Mount NaN sein).
    if (!isNaN(zoomAbs)) {
      evs.push({ kind: "zoom", anchor: 0, value_absolute: zoomAbs, value_offset: 0 });
      evs.push({ kind: "zoom", anchor: 1, value_absolute: zoomAbs, value_offset: 0 });
    }
    return evs;
  }

  // Render/Preview-Helper: liefert User-KFs falls vorhanden + Editor an,
  // sonst die impliziten Default-KFs. Genau EIN Code-Pfad für Interpolation.
  function getEffectiveEvents() {
    if (keyframesEnabled()) {
      const ev = getRawTimelineEvents();
      if (ev && ev.length > 0) return ev;
    }
    return buildDefaultEvents();
  }

  function setTimelineEvents(events) {
    if (!_settingsCache) return;
    _settingsCache[_MODKEY] = _settingsCache[_MODKEY] || {};
    _settingsCache[_MODKEY].timeline_events = events;
    // v0.8.0: Wenn eine Session aktiv ist, speichern wir das im Projekt
    // (track-gebunden). Sonst in der globalen settings.json als Fallback.
    if (typeof saveProjectSettings === "function" && typeof getActiveSession === "function" && getActiveSession()) {
      saveProjectSettings(_MODKEY, { timeline_events: events });
      // Lokalen Projekt-Cache aktualisieren damit getTimelineEvents() den
      // neuen Stand liest (saveProjectSettings macht das bereits, aber
      // wir wollen es explizit haben falls der Cache anders lebt)
      const proj = getActiveProject();
      if (proj) {
        proj[_MODKEY] = proj[_MODKEY] || {};
        proj[_MODKEY].timeline_events = events;
      }
    } else {
      saveSettings({ animator: { timeline_events: events } });
    }
    if (_tlBar) {
      _tlBar.refresh();
      if (_tlBar.updateStatusLabel) _tlBar.updateStatusLabel();
    }
    rebuildCameraKeyframePins();
    syncTimelineOverrideUi();
  }

  // Wird vom Klick auf Marker/Karten-Pin gerufen: Scrubber zum Keyframe
  // bewegen. scrubPreview() ruft dann syncScrubberSelection() das den
  // Editor automatisch öffnet.
  // v0.9.0 — _selectedKfIdx ist jetzt ein „Cluster-Index" in der virtuellen
  // Liste der unique anchors. clusterAnchors() liefert sortierte uniques —
  // dort findet die Selektion statt. Im Detail-Editor werden alle Property-
  // Werte an diesem Anchor zusammengeführt angezeigt (wie ein KF aus v0.8.x).
  // Multi-Lane-Edit (pro Property einzeln) ist Iteration 2.

  function clusterAnchors() {
    const anchors = new Set();
    for (const ev of getRawTimelineEvents()) {
      if (ev && KF_LANES.includes(ev.kind)) {
        anchors.add(+(ev.anchor || 0).toFixed(6));
      }
    }
    return [...anchors].sort((a, b) => a - b);
  }
  function getClusterAt(anchor, tolerance) {
    if (tolerance == null) tolerance = 0.001;
    const evs = getRawTimelineEvents();
    return evs.filter(e => e && KF_LANES.includes(e.kind)
      && Math.abs((e.anchor || 0) - anchor) < tolerance);
  }
  // Cluster-Properties am Anker zusammenführen — wie ein v0.8-Camera-KF
  function clusterPropsAt(anchor) {
    const cluster = getClusterAt(anchor);
    const out = { anchor, pitch: undefined, bearing: undefined, zoom_offset: undefined, center: undefined, position: undefined };
    for (const ev of cluster) {
      if (ev.kind === "pitch")    out.pitch       = ev.value;
      if (ev.kind === "bearing")  out.bearing     = ev.value;
      if (ev.kind === "zoom")     out.zoom_offset = ev.value_offset;
      if (ev.kind === "center")   out.center      = ev.value;
      if (ev.kind === "position") out.position    = ev.value;  // {x, y} in %
    }
    return out;
  }

  function selectKeyframe(idx) {
    const anchors = clusterAnchors();
    if (idx == null || idx < 0 || idx >= anchors.length) return;
    const anchor = anchors[idx];
    if (_tlBar) _tlBar.setScrubber(anchor);
    scrubPreview(anchor);
  }

  // v0.9.64 (Nutzer/Marc): KEINE Auto-Selektion mehr. Vorher hat der Mount
  // KF1 automatisch selektiert (v0.9.17). Folge: jede Map-Bewegung schrieb
  // via `_syncMapStateToUi` in KF1, auch wenn der User nur die Vorschau
  // verschieben wollte. Marc-Wortlaut: „Wenn man etwas ändert ohne einen KF
  // angewählt zu haben, soll sich kein KF ändern. Aber, wenn man will kann
  // man mit diesen änderungen einen KF erstellen." → über Snapshot-Button
  // („📍 Hier Keyframe") gezielt anlegen.
  // Funktion bleibt als No-Op damit bestehende Call-Sites kein TypeError werfen.
  function autoSelectFirstKfIfNeeded() {
    /* intentionally no-op since v0.9.64 — keine Auto-Selektion mehr */
  }

  // Snapshot-Workflow (v0.9.0): aktuelle Kartenansicht → 4 Property-Events
  // (pitch / bearing / zoom / center) am gleichen Anker. Wenn dort schon ein
  // Cluster ist, werden seine Events upgedated.
  function snapshotKeyframe(anchor, options) {
    if (!map) return;
    options = options || {};
    _animPushUndo("Keyframe gesetzt", { force: true });
    if (anchor == null) anchor = _tlBar ? _tlBar.getScrubber() : 0;
    anchor = Math.max(0, Math.min(1, anchor));
    const pitch = +map.getPitch().toFixed(2);
    const bearing = +map.getBearing().toFixed(2);
    const curZoom = +map.getZoom().toFixed(3);
    // v0.9.39: Snapshot erfolgt typischerweise interaktiv nach Map-Load —
    // _fitZoomBase ist da. Falls doch null (extrem schneller Snap nach
    // GPX-Load): User-Warnung + skip statt Müll zu speichern.
    const base = effectiveFitZoomBase();
    if (base == null) {
      console.warn("[snapshot] _fitZoomBase noch nicht gesetzt — bitte kurz warten und nochmal versuchen");
      toast("Karte noch nicht stabil — KF bitte gleich nochmal setzen", "warn", 3000);
      return;
    }
    const zoomOff = +(curZoom - base).toFixed(2);
    const c = map.getCenter();
    // v0.9.136/139 — Welt-Drehung steckt in der *abgewickelten* center.lng.
    // Reconcile bringt den Akkumulator robust auf die finale Kartenmitte
    // (auch nach Inertia) und liefert den abgewickelten Wert (kann >±180° =
    // volle Erddrehungen). Ersetzt den fragilen Toleranz-Check (<0.01), der
    // bei Flick-Drehungen wegen Drag-Trägheit scheiterte → Drehung verloren.
    const recLng = _reconcileLngAccumToCenter();
    const lngVal = (recLng !== null) ? +recLng.toFixed(6) : +c.lng.toFixed(6);
    const centerArr = [lngVal, +c.lat.toFixed(6)];

    // Existierende Property-Events am gleichen Anker entfernen.
    // v0.9.38: Toleranz 0.001 → 0.005 (= 0.5 % der Timeline). Vorher haben
    // Float-Rundungsfehler beim Anchor verglichen mit Cluster-Anchors zu
    // Duplikaten an „1.0" geführt. 0.5 % entspricht der Marker-Klick-Toleranz.
    const events = getRawTimelineEvents().filter(e =>
      !(e && KF_LANES.includes(e.kind) && Math.abs((e.anchor || 0) - anchor) < 0.005)
    );
    // 4 neue Property-Events anlegen
    // v0.9.73 (Marc-Bug "Erde nach Reload viel kleiner"): zoom-Event speichert
    // BEIDE — `value_offset` (legacy) UND `value_absolute` (= curZoom als
    // absoluter Mapbox-Zoom). Beim Anwenden wird `value_absolute` bevorzugt:
    // `effective_offset = value_absolute - currentFitBase`. So bleibt der
    // gespeicherte Zoom-Punkt stabil auch wenn `_fitZoomBase` zwischen Set-
    // und Reload-Zeit driftet (Marc-Wortlaut: „Wenn ich beim KF rauszoome,
    // bin ich viel näher dran, als nach einem Reload").
    events.push({ kind: "pitch",   anchor, value: pitch,             easing: "linear" });
    events.push({ kind: "bearing", anchor, value: bearing,           easing: "linear" });
    events.push({ kind: "zoom",    anchor, value_offset: zoomOff, value_absolute: curZoom, easing: "linear" });
    events.push({ kind: "center",  anchor, value: centerArr,         easing: "linear" });
    // v0.9.107/109/117 — Position + Rotation pro KF.
    // Marc-Bug v0.9.116: nach Welt-Button + Track-Drag spinnte alles
    // weil die Slider-Werte (0, 34, 0) vom letzten KF auf einen neuen
    // Track-KF kopiert wurden. Lösung: bei NEUEM KF (= kein existing
    // Cluster am Anchor) Defaults 0/0/0 — User kann sie über die
    // Slider/Welt-Button trotzdem setzen. options.preserveWorldSliders
    // = Welt-Button overrided das (er WILL die aktuellen Slider-Werte).
    const existedAtAnchor = getRawTimelineEvents().some(e =>
      e && KF_LANES.includes(e.kind) && Math.abs((e.anchor || 0) - anchor) < 0.005
    );
    const isNewKf = !existedAtAnchor;
    const useDefaultsForWorld = isNewKf && !options.preserveWorldSliders;
    const posX = useDefaultsForWorld
      ? 0
      : (+parseFloat(document.getElementById("anim-kf-position-x")?.value || "0").toFixed(1) || 0);
    const posY = useDefaultsForWorld
      ? 0
      : (+parseFloat(document.getElementById("anim-kf-position-y")?.value || "0").toFixed(1) || 0);
    events.push({ kind: "position", anchor, value: { x: posX, y: posY }, easing: "linear" });
    // v0.9.136 — Welt-Drehung-Lane (rotation) abgeschafft. Die Drehung steckt
    // jetzt in der abgewickelten center.lng (siehe centerArr oben).
    events.sort((a, b) => (a.anchor || 0) - (b.anchor || 0));
    setTimelineEvents(events);
    syncScrubberSelection(anchor);
  }

  // v0.9.8 — Per-Property-Keyframe via Doppelklick auf eine Lane:
  // erzeugt NUR EINEN Event in der gewählten Lane mit dem aktuellen
  // Karten-Wert für diese Property. Marc-Spec: keine Cluster-Anlage wenn
  // nur eine Property gewollt ist. kind="__cluster" → klassisches Snapshot
  // (alle 4 Properties).
  function createSingleProperty(kind, anchor) {
    if (!map) return;
    _animPushUndo("Property-Keyframe gesetzt", { force: true });
    if (kind === "__cluster") {
      snapshotKeyframe(anchor);
      return;
    }
    if (!KF_LANES.includes(kind)) return;
    anchor = Math.max(0, Math.min(1, anchor));
    // Bestehenden Event derselben Property am gleichen Anker entfernen.
    // v0.9.38: Toleranz 0.001 → 0.005 (siehe snapshotKeyframe).
    const events = getRawTimelineEvents().filter(e =>
      !(e && e.kind === kind && Math.abs((e.anchor || 0) - anchor) < 0.005)
    );
    // Neuen Event mit aktuellem Karten-Wert für DIESE Property anlegen
    let newEv = null;
    if (kind === "pitch") {
      newEv = { kind: "pitch", anchor, value: +map.getPitch().toFixed(2), easing: "linear" };
    } else if (kind === "bearing") {
      newEv = { kind: "bearing", anchor, value: +map.getBearing().toFixed(2), easing: "linear" };
    } else if (kind === "zoom") {
      // v0.9.37 — siehe snapshotKeyframe: effectiveFitZoomBase() statt
      // _fitZoomBase-Side-Effect.
      // v0.9.73 — value_absolute (siehe snapshotKeyframe-Kommentar) für
      // Reload-stabile Zoom-Werte.
      const curZoom = +map.getZoom().toFixed(3);
      const base = effectiveFitZoomBase();
      const zoomOff = +(curZoom - base).toFixed(2);
      newEv = { kind: "zoom", anchor, value_offset: zoomOff, value_absolute: curZoom, easing: "linear" };
    } else if (kind === "center") {
      const c = map.getCenter();
      // v0.9.136 — abgewickelte lng (Welt-Drehung), siehe snapshotKeyframe.
      let lngVal = +c.lng.toFixed(6);
      if (_lngAccum !== null && Math.abs(_wrapLng(_lngAccum) - _wrapLng(c.lng)) < 0.01) {
        lngVal = +_lngAccum.toFixed(6);
      }
      newEv = { kind: "center", anchor, value: [lngVal, +c.lat.toFixed(6)], easing: "linear" };
    } else if (kind === "position") {
      const x = +parseFloat(document.getElementById("anim-kf-position-x")?.value || "0").toFixed(1) || 0;
      const y = +parseFloat(document.getElementById("anim-kf-position-y")?.value || "0").toFixed(1) || 0;
      newEv = { kind: "position", anchor, value: { x, y }, easing: "linear" };
    }
    if (!newEv) return;
    events.push(newEv);
    events.sort((a, b) => (a.anchor || 0) - (b.anchor || 0));
    setTimelineEvents(events);
    // Neuen Event selektieren — Editor zeigt nur den passenden Slider mit Glow
    selectEvent({ kind, anchor });
  }

  function deleteKeyframe(idx) {
    _animPushUndo("Keyframe gelöscht", { force: true });
    const anchors = clusterAnchors();
    if (idx == null || idx < 0 || idx >= anchors.length) return;
    const anchor = anchors[idx];
    const events = getRawTimelineEvents().filter(e =>
      !(e && KF_LANES.includes(e.kind) && Math.abs((e.anchor || 0) - anchor) < 0.001)
    );
    setTimelineEvents(events);
    selectKeyframe(null);
  }

  function clearAllKeyframes() {
    _animPushUndo("Alle Keyframes gelöscht", { force: true });
    // Alle Property-Events (camera-lanes) löschen; marker/photo bleiben für später.
    const events = getRawTimelineEvents().filter(e => e && !KF_LANES.includes(e.kind));
    setTimelineEvents(events);
    selectKeyframe(null);
    _selectedEvent = null;
  }

  // v0.9.3 — Per-Event-Operationen (Lane-Marker Click/Drag/Delete).
  // {kind, anchor} identifiziert genau einen Property-Event.

  function selectEvent(ev) {
    if (!ev || !ev.kind) {
      _selectedEvent = null;
      _selectedKfIdx = null;
    } else {
      _selectedEvent = { kind: ev.kind, anchor: ev.anchor };
      // Cluster-Index ebenfalls setzen damit Karten-Pins + alte
      // Cluster-Logiken konsistent bleiben.
      // v0.9.4: kind="__cluster" wird hier ganz natürlich akzeptiert —
      // _selectedKfIdx zeigt auf den Cluster, _selectedEvent.kind === "__cluster"
      // markiert die Cluster-Selektion (vs per-Property).
      const anchors = clusterAnchors();
      const ti = anchors.findIndex(a => Math.abs(a - ev.anchor) < 0.001);
      _selectedKfIdx = ti >= 0 ? ti : null;
    }
    if (_tlBar) _tlBar.setSelected(_selectedEvent);
    if (_selectedEvent) {
      if (_tlBar) _tlBar.setScrubber(_selectedEvent.anchor);
      // skipSelectionSync: scrubPreview soll _selectedEvent nicht überschreiben.
      scrubPreview(_selectedEvent.anchor, { skipSelectionSync: true });
    }
    rebuildCameraKeyframePins();
    renderKeyframeEditor();
  }

  function moveEvent(ev, newAnchor) {
    _animPushUndo("Keyframe verschoben");  // throttled — pusht nur den 1. Drag-State
    if (!ev || !ev.kind) return;
    const clamped = Math.max(0, Math.min(1, newAnchor));

    // v0.9.4 — Cluster-Drag: alle Events am Anker zusammen verschieben.
    if (ev.kind === "__cluster") {
      const events = getRawTimelineEvents().slice();
      for (const e of events) {
        if (e && KF_LANES.includes(e.kind)
            && Math.abs((e.anchor || 0) - ev.anchor) < 0.001) {
          e.anchor = clamped;
        }
      }
      events.sort((a, b) => (a.anchor || 0) - (b.anchor || 0));
      setTimelineEvents(events);
      // Selection mitziehen
      if (_selectedEvent && _selectedEvent.kind === "__cluster"
          && Math.abs(_selectedEvent.anchor - ev.anchor) < 0.001) {
        _selectedEvent = { kind: "__cluster", anchor: clamped };
      }
      const newAnchors = clusterAnchors();
      const newIdx = newAnchors.findIndex(a => Math.abs(a - clamped) < 0.001);
      if (newIdx >= 0) _selectedKfIdx = newIdx;
      if (_tlBar) _tlBar.setSelected(_selectedEvent);
      if (_tlBar) _tlBar.setScrubber(clamped);
      // skipSelectionSync: sonst killt syncScrubberSelection unsere Cluster-Selektion.
      scrubPreview(clamped, { skipSelectionSync: true });
      return;
    }

    const events = getRawTimelineEvents().slice();
    for (const e of events) {
      if (e && e.kind === ev.kind && Math.abs((e.anchor || 0) - ev.anchor) < 0.001) {
        e.anchor = clamped;
        break;
      }
    }
    events.sort((a, b) => (a.anchor || 0) - (b.anchor || 0));
    setTimelineEvents(events);
    // Selection mitziehen
    if (_selectedEvent && _selectedEvent.kind === ev.kind
        && Math.abs(_selectedEvent.anchor - ev.anchor) < 0.001) {
      _selectedEvent = { kind: ev.kind, anchor: clamped };
    }
    if (_tlBar) _tlBar.setScrubber(clamped);
    // v0.9.4: skipSelectionSync auch hier — sonst löscht der Sync die
    // gerade gesetzte Per-Property-Selektion (Bug aus v0.9.3).
    scrubPreview(clamped, { skipSelectionSync: true });
  }

  function deleteEventOne(ev) {
    _animPushUndo("Property gelöscht", { force: true });
    if (!ev || !ev.kind) return;

    // v0.9.4 — Rechtsklick auf Cluster-Marker → ganzen Cluster löschen
    if (ev.kind === "__cluster") {
      const events = getRawTimelineEvents().filter(e =>
        !(e && KF_LANES.includes(e.kind) && Math.abs((e.anchor || 0) - ev.anchor) < 0.001)
      );
      setTimelineEvents(events);
      if (_selectedEvent && _selectedEvent.kind === "__cluster"
          && Math.abs(_selectedEvent.anchor - ev.anchor) < 0.001) {
        _selectedEvent = null;
        _selectedKfIdx = null;
      }
      renderKeyframeEditor();
      rebuildCameraKeyframePins();
      if (_tlBar) _tlBar.setSelected(_selectedEvent);
      return;
    }

    const events = getRawTimelineEvents().filter(e =>
      !(e && e.kind === ev.kind && Math.abs((e.anchor || 0) - ev.anchor) < 0.001)
    );
    setTimelineEvents(events);
    // Wenn der gerade ausgewählte Event gelöscht wurde → Selektion leeren
    if (_selectedEvent && _selectedEvent.kind === ev.kind
        && Math.abs(_selectedEvent.anchor - ev.anchor) < 0.001) {
      _selectedEvent = null;
    }
    renderKeyframeEditor();
    rebuildCameraKeyframePins();
    if (_tlBar) _tlBar.setSelected(_selectedEvent);
  }

  function updateKeyframeAnchor(idx, anchor) {
    _animPushUndo("Anchor geändert");  // throttled
    const anchors = clusterAnchors();
    if (idx == null || idx < 0 || idx >= anchors.length) return;
    const oldAnchor = anchors[idx];
    const clamped = Math.max(0, Math.min(1, anchor));
    const events = getRawTimelineEvents().slice();
    for (const ev of events) {
      if (ev && KF_LANES.includes(ev.kind) && Math.abs((ev.anchor || 0) - oldAnchor) < 0.001) {
        ev.anchor = clamped;
      }
    }
    events.sort((a, b) => (a.anchor || 0) - (b.anchor || 0));
    setTimelineEvents(events);
    if (_tlBar) _tlBar.setScrubber(clamped);
    scrubPreview(clamped);
  }

  // patch hat die alten Property-Namen (pitch, bearing, zoom_offset, center) —
  // wir mappen auf die neuen Property-Events.
  // v0.9.73 — `zoom_absolute` als zusätzliches Patch-Feld unterstützt. Wenn
  // nur `zoom_offset` gepatcht wird, ergänzen wir `zoom_absolute` aus
  // (offset + currentFitBase); umgekehrt analog. Beide Werte landen auf
  // dem gleichen Event (kind=zoom + anchor), als `value_offset` (legacy)
  // und `value_absolute` (reload-stabil).
  function updateKeyframeFields(idx, patch) {
    _animPushUndo("Keyframe-Werte geändert");  // throttled — Map-Drag, Slider-Move etc.
    const anchors = clusterAnchors();
    if (idx == null || idx < 0 || idx >= anchors.length) return;
    const anchor = anchors[idx];
    const events = getRawTimelineEvents().slice();
    // v0.9.73: zoom_offset ↔ zoom_absolute beidseitig auffüllen.
    const _fitBase = effectiveFitZoomBase();
    if (("zoom_offset" in patch) && !("zoom_absolute" in patch) && _fitBase != null) {
      patch.zoom_absolute = +(patch.zoom_offset + _fitBase).toFixed(3);
    }
    if (("zoom_absolute" in patch) && !("zoom_offset" in patch) && _fitBase != null) {
      patch.zoom_offset = +(patch.zoom_absolute - _fitBase).toFixed(2);
    }
    const mapping = {
      pitch:         { kind: "pitch",    field: "value" },
      bearing:       { kind: "bearing",  field: "value" },
      zoom_offset:   { kind: "zoom",     field: "value_offset" },
      zoom_absolute: { kind: "zoom",     field: "value_absolute" },
      center:        { kind: "center",   field: "value" },
      position:      { kind: "position", field: "value" },
      anchor:        null, // handled separately
    };
    for (const [propName, val] of Object.entries(patch)) {
      if (propName === "anchor") {
        // → updateKeyframeAnchor stattdessen
        updateKeyframeAnchor(idx, val);
        return;
      }
      const m = mapping[propName];
      if (!m) continue;
      // Existierenden Event finden + updaten, oder anlegen
      let found = false;
      for (const ev of events) {
        if (ev && ev.kind === m.kind && Math.abs((ev.anchor || 0) - anchor) < 0.001) {
          ev[m.field] = val;
          found = true;
          break;
        }
      }
      if (!found && val != null) {
        events.push({ kind: m.kind, anchor, [m.field]: val, easing: "linear" });
      }
    }
    events.sort((a, b) => (a.anchor || 0) - (b.anchor || 0));
    setTimelineEvents(events);
  }

  // Detail-Editor in der Sidebar: Section aus-/einblenden, Slider füllen
  function renderKeyframeEditor() {
    // v0.8.16: KF-Editor lebt jetzt INNERHALB der Camera-Section unter
    // #anim-camera-body-keyframe. Wir togglen nur die inneren Divs:
    //   - #anim-kf-empty-hint (sichtbar wenn kein KF selektiert)
    //   - #anim-kf-editor-fields (sichtbar wenn KF selektiert)
    const emptyHint = document.getElementById("anim-kf-empty-hint");
    const fields = document.getElementById("anim-kf-editor-fields");
    if (!emptyHint || !fields) return;

    // Master-Toggle aus → Sub-Body komplett hidden (über applyKeyframesEnabled).
    // Hier ist Master-Toggle an; entscheide auf Basis der Selektion.
    if (!keyframesEnabled()) {
      // Nur Sicherheits-fallback; applyKeyframesEnabled hat den Body schon hidden.
      return;
    }
    // v0.9.3: Zwei Selektions-Modi:
    //   (a) Per-Property: `_selectedEvent = {kind, anchor}` — Editor zeigt
    //       nur den Slider für diese Lane.
    //   (b) Cluster: entweder `_selectedEvent.kind === "__cluster"` (neu in
    //       v0.9.4, gesetzt durch Cluster-Marker oben) ODER
    //       `_selectedKfIdx != null && !_selectedEvent` (Legacy via Scrubber) —
    //       Editor zeigt alle 4 Slider (Snapshot-Bündel).
    const anchors = clusterAnchors();
    let anchor, focusedKind;
    if (_selectedEvent && _selectedEvent.kind && _selectedEvent.kind !== "__cluster") {
      anchor = _selectedEvent.anchor;
      focusedKind = _selectedEvent.kind;
    } else if (_selectedEvent && _selectedEvent.kind === "__cluster") {
      anchor = _selectedEvent.anchor;
      focusedKind = null;  // Cluster-Modus → alle Slider
    } else if (_selectedKfIdx != null && _selectedKfIdx < anchors.length) {
      anchor = anchors[_selectedKfIdx];
      focusedKind = null;  // Cluster-Modus
    } else {
      emptyHint.hidden = false;
      fields.hidden = true;
      return;
    }
    const props = clusterPropsAt(anchor);
    emptyHint.hidden = true;
    fields.hidden = false;
    // Per-Lane-Sichtbarkeit: Anchor IMMER sichtbar, Property-Felder nur
    // wenn focusedKind === diese Property ODER focusedKind === null.
    // v0.9.5 — zusätzlich `is-active`-Klasse: das Feld der gewählten Lane
    // (focusedKind) wird mit farbigem Glow markiert, damit Marc auf einen
    // Blick sieht welcher Regler für den gewählten Lane-Marker zuständig ist.
    for (const f of fields.querySelectorAll("[data-prop]")) {
      const p = f.dataset.prop;
      f.hidden = (focusedKind != null && p !== "anchor" && p !== focusedKind);
      f.classList.toggle("is-active", !!focusedKind && p === focusedKind);
    }

    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = String(val);
    };
    const setLbl = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    const anchorPct = (props.anchor || 0) * 100;
    set("anim-kf-anchor", anchorPct);
    setLbl("anim-kf-anchor-v", anchorPct.toFixed(1) + "%");
    set("anim-kf-pitch", props.pitch ?? 40);
    setLbl("anim-kf-pitch-v", (props.pitch ?? 40).toFixed(0) + "°");
    set("anim-kf-bearing", props.bearing ?? 0);
    setLbl("anim-kf-bearing-v", (props.bearing ?? 0).toFixed(0) + "°");
    // Zoom (siehe Bug-Fix v0.8.17: fitBase im dataset stabil halten)
    // v0.9.39: wenn _fitZoomBase noch null (Re-Mount-Race) → curZoom als
    // Fallback nur fürs anzeigen; sobald moveend gefeuert hat rendert
    // renderKeyframeEditor ohnehin nochmal mit echtem Wert.
    const _fitBase = effectiveFitZoomBase() ?? (map ? map.getZoom() : 12);
    const _absZoom = _fitBase + (props.zoom_offset ?? 0);
    set("anim-kf-zoom", _absZoom);
    setLbl("anim-kf-zoom-v", _absZoom.toFixed(1));
    const _zoomEl = document.getElementById("anim-kf-zoom");
    if (_zoomEl) _zoomEl.dataset.fitBase = String(_fitBase);
    // v0.9.109 — Position + Rotation pro KF
    const _posVal = props.position || { x: 0, y: 0 };
    set("anim-kf-position-x", _posVal.x || 0);
    set("anim-kf-position-y", _posVal.y || 0);
    setLbl("anim-kf-position-x-v", Math.round(_posVal.x || 0) + " %");
    setLbl("anim-kf-position-y-v", Math.round(_posVal.y || 0) + " %");
    // v0.9.136 — Welt-Drehung/Position via center.lng/lat (Insta360-Modell).
    // lng ist *abgewickelt* (>±180° = volle Erddrehungen); das Label zeigt den
    // Drehungs-Counter (z.B. "370° (1.03↻)"). Bei Track-Folgen (kein center-
    // Event) Defaults 0/0 — Felder sind dann sowieso ausgeblendet.
    const _centerVal = Array.isArray(props.center) ? props.center : null;
    const _lngVal = _centerVal ? (+_centerVal[0] || 0) : 0;
    const _latVal = _centerVal ? (+_centerVal[1] || 0) : 0;
    set("anim-kf-lng", _lngVal);
    setLbl("anim-kf-lng-v", _formatRotationLabel(_lngVal));
    set("anim-kf-lat", _latVal);
    setLbl("anim-kf-lat-v", _latVal.toFixed(1) + "°");
    // Ungeclampte Werte (lng >±540 = mehrere Drehungen) in dataset.userValue
    // cachen damit _applyKfCenter sie statt des geclampten Slider-Werts liest.
    const _lngEl = document.getElementById("anim-kf-lng");
    if (_lngEl) {
      const lo = parseFloat(_lngEl.min), hi = parseFloat(_lngEl.max);
      if (_lngVal < lo || _lngVal > hi) _lngEl.dataset.userValue = String(_lngVal);
      else delete _lngEl.dataset.userValue;
    }
    const _latEl = document.getElementById("anim-kf-lat");
    if (_latEl) {
      const lo = parseFloat(_latEl.min), hi = parseFloat(_latEl.max);
      if (_latVal < lo || _latVal > hi) _latEl.dataset.userValue = String(_latVal);
      else delete _latEl.dataset.userValue;
    }
    // Track-Folgen-Checkbox (= kein center-Event vorhanden)
    // v0.9.6 — Hilfetext liegt jetzt hinter dem ?-Button (kf-follow-hint),
    // Live-Update des Hint-Texts entfällt damit.
    const followCb = document.getElementById("anim-kf-follow-track");
    if (followCb) {
      followCb.checked = (props.center == null);
    }

    fields.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // v0.7.5-Fix: bind-once direkt nach Template-Mount, nicht erst beim ersten
  // Editor-Open. Vorher gab's Race-Conditions (Flag wurde manchmal true ohne
  // dass die Bindings drangehängt wurden → Slider tot).
  // Diese Funktion wird in der `mountAnimator`-Initialisierung
  // EINMAL gerufen (nach body.innerHTML, wo die Slider-Elemente da sind).
  function bindKeyframeEditor() {
    if (_kfEditorBound) return;  // safety, falls doppelt gerufen
    const onSliderChange = (sliderId, lblId, field, formatter) => {
      const el = document.getElementById(sliderId);
      const lbl = document.getElementById(lblId);
      if (!el || !lbl) {
        console.warn("[kf-editor] missing slider element:", sliderId, lblId);
        return;
      }
      el.addEventListener("input", () => {
        const v = parseFloat(el.value);
        lbl.textContent = formatter(v);
        // v0.9.3: Resolve active anchor from either selection mode
        const anchors = clusterAnchors();
        let curAnchor;
        if (_selectedEvent) curAnchor = _selectedEvent.anchor;
        else if (_selectedKfIdx != null && _selectedKfIdx < anchors.length) curAnchor = anchors[_selectedKfIdx];
        else {
          console.warn("[kf-editor] slider", sliderId, "moved but no selection");
          return;
        }
        if (field === "anchor") {
          // Anchor-Slider: bewegt entweder den ganzen Cluster (Cluster-Modus)
          // oder nur den selektierten Event (Per-Property-Modus).
          const newAnchor = v / 100;
          if (_selectedEvent) {
            moveEvent({ kind: _selectedEvent.kind, anchor: curAnchor }, newAnchor);
          } else {
            updateKeyframeAnchor(_selectedKfIdx, newAnchor);
          }
        } else {
          // Property-Slider: patch das einzelne Event mit dem neuen Wert.
          // updateKeyframeFields macht das pro Property sauber, egal in
          // welchem Modus (es greift den Event am Anker via Cluster-Logik).
          // Cluster-Idx vom Anker neu beziehen falls _selectedKfIdx out-of-date.
          const ti = anchors.findIndex(a => Math.abs(a - curAnchor) < 0.001);
          if (ti < 0) return;
          const patch = {};
          patch[field] = v;
          updateKeyframeFields(ti, patch);
          if (_tlBar) _tlBar.setScrubber(curAnchor);
          scrubPreview(curAnchor);
        }
      });
    };
    onSliderChange("anim-kf-anchor", "anim-kf-anchor-v", "anchor", v => v.toFixed(1) + "%");
    onSliderChange("anim-kf-pitch", "anim-kf-pitch-v", "pitch", v => v.toFixed(0) + "°");
    onSliderChange("anim-kf-bearing", "anim-kf-bearing-v", "bearing", v => v.toFixed(0) + "°");
    // v0.9.109 — Position pro KF (X/Y in %): Slider im KF-Editor.
    // Setzt sofort Map-Padding (live preview) + patcht KF-Event.
    function _applyKfPosition() {
      const x = parseFloat(document.getElementById("anim-kf-position-x")?.value) || 0;
      const y = parseFloat(document.getElementById("anim-kf-position-y")?.value) || 0;
      // Labels updaten
      const xV = document.getElementById("anim-kf-position-x-v");
      const yV = document.getElementById("anim-kf-position-y-v");
      if (xV) xV.textContent = Math.round(x) + " %";
      if (yV) yV.textContent = Math.round(y) + " %";
      // Padding live anwenden
      if (map) {
        try {
          const vp = map.getCanvas();
          const vpW = (vp && vp.clientWidth)  || 1920;
          const vpH = (vp && vp.clientHeight) || 1080;
          const padX = Math.abs(x) / 100 * vpW;
          const padY = Math.abs(y) / 100 * vpH;
          map.setPadding({
            top:    y < 0 ? padY : 0,
            bottom: y > 0 ? padY : 0,
            left:   x > 0 ? padX : 0,
            right:  x < 0 ? padX : 0,
          });
        } catch (_) {}
      }
      // KF-Patch — NUR wenn Scrubber tatsächlich auf einem KF steht.
      // Sonst (Scrubber zwischen KFs) patcht der Slider versehentlich
      // den letzten selektierten KF (= meist KF1).
      if (!keyframesEnabled()) return;
      const anchors = clusterAnchors();
      let curAnchor;
      if (_selectedEvent) curAnchor = _selectedEvent.anchor;
      else if (_selectedKfIdx != null && _selectedKfIdx < anchors.length) curAnchor = anchors[_selectedKfIdx];
      else return;
      // Scrubber-Anchor-Check: muss zum selektierten KF passen
      const scrubAnchor = _tlBar ? _tlBar.getScrubber() : 0;
      if (Math.abs(scrubAnchor - curAnchor) > 0.005) return;
      const ti = anchors.findIndex(a => Math.abs(a - curAnchor) < 0.001);
      if (ti < 0) return;
      updateKeyframeFields(ti, { position: { x, y } });
    }
    document.getElementById("anim-kf-position-x")?.addEventListener("input", _applyKfPosition);
    document.getElementById("anim-kf-position-y")?.addEventListener("input", _applyKfPosition);

    // v0.9.136 — Welt-Drehung/Position pro KF via center.lng/lat (Insta360-
    // Modell). lng ist *abgewickelt* (>±180° = volle Erddrehungen). Setzt
    // live die Kartenmitte + patcht das center-Event.
    function _applyKfCenter() {
      const lngEl = document.getElementById("anim-kf-lng");
      const latEl = document.getElementById("anim-kf-lat");
      // dataset.userValue (Label-Edit, ungeclampt) hat Vorrang vor slider.value.
      const lng = (lngEl && lngEl.dataset.userValue != null && lngEl.dataset.userValue !== "")
        ? parseFloat(lngEl.dataset.userValue)
        : parseFloat(lngEl?.value) || 0;
      const lat = (latEl && latEl.dataset.userValue != null && latEl.dataset.userValue !== "")
        ? parseFloat(latEl.dataset.userValue)
        : parseFloat(latEl?.value) || 0;
      const lngV = document.getElementById("anim-kf-lng-v");
      if (lngV) lngV.textContent = _formatRotationLabel(lng);
      const latV = document.getElementById("anim-kf-lat-v");
      if (latV) latV.textContent = lat.toFixed(1) + "°";
      // Map live setzen. Programmatischer jumpTo → kein `drag`-Event, also
      // re-seeden wir den Akkumulator bewusst auf den abgewickelten Wert.
      if (map) {
        try {
          map.jumpTo({ center: [lng, lat] });
          _seedLngAccum(lng);
        } catch (_) {}
      }
      // KF-Patch — NUR wenn Scrubber tatsächlich auf einem KF steht.
      if (!keyframesEnabled()) return;
      const anchors = clusterAnchors();
      let curAnchor;
      if (_selectedEvent) curAnchor = _selectedEvent.anchor;
      else if (_selectedKfIdx != null && _selectedKfIdx < anchors.length) curAnchor = anchors[_selectedKfIdx];
      else return;
      const scrubAnchor = _tlBar ? _tlBar.getScrubber() : 0;
      if (Math.abs(scrubAnchor - curAnchor) > 0.005) return;
      const ti = anchors.findIndex(a => Math.abs(a - curAnchor) < 0.001);
      if (ti < 0) return;
      updateKeyframeFields(ti, { center: [lng, lat] });
    }
    document.getElementById("anim-kf-lng")?.addEventListener("input", _applyKfCenter);
    document.getElementById("anim-kf-lat")?.addEventListener("input", _applyKfCenter);
    // v0.9.60 (Marc-Bug Erdkugel): Reset-Pitch-Button setzt Pitch auf 0
    // und triggert das Slider-input-Event, sodass KF-Update + Preview-Scrub
    // wie bei Slider-Move ablaufen.
    const _pitchResetBtn = document.getElementById("anim-kf-pitch-reset");
    if (_pitchResetBtn) {
      _pitchResetBtn.addEventListener("click", () => {
        const slider = document.getElementById("anim-kf-pitch");
        if (!slider) return;
        slider.value = "0";
        slider.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    // v0.9.89-v1.0.0 (Marc-Bug-Saga „Weltkugel zentrieren") → v0.9.104:
    // Welt-Button setzt jetzt zusätzlich die XY-Shift-Slider. v0.9.141:
    // X=0 % / Y=0 % — bei pitch=0 (flach von oben) sitzt die Erde ohne
    // vertikalen Shift mittig (der alte Y=34-Wert stammte aus der pitch=35°-
    // Ära und schob die Welt zu hoch). Damit kommt der erste Welt-KF
    // out-of-the-box mittig zentriert raus.
    // v0.9.130 — Welt-Zentrierung in zwei Modi: "start" (Track-Startpunkt)
    // und "bbox" (Track-Bbox-Mittelpunkt). Beide nutzen dieselbe Logik
    // (easeTo + Slider-Bump + Anti-Spring), nur das center unterscheidet sich.
    function _centerWorld(mode) {
      if (!map) return;
      const WORLD_PITCH = 0;          // Marc: flach von oben — Polachsen-Spin
      const WORLD_ZOOM = 0;           // Marc: ganz raus, volle Erde sichtbar
      // Center je nach Modus.
      //   mode "start" → Track-Startpunkt (Nutzer-Wunsch v0.9.129): beim
      //     Reinzoomen bleibt der Startpunkt fix, die Erde wandert nicht weg.
      //   mode "world" → Greenwich/Äquator [10, 0] = klassische Welt-Sicht
      //     „wie es vor v0.9.129 war" (Marc: „so wie es vorher war"). Die
      //     Erde steht frontal (Europa/Afrika), der Track sitzt irgendwo
      //     darauf und die Kamera fliegt beim Render dorthin rein.
      //
      //   v0.9.132 Fix: vorher war mode="bbox" (Track-Bbox-Mittelpunkt) —
      //   das ist bei voller Welt-Sicht (zoom 0) optisch NICHT vom Start zu
      //   unterscheiden (ein paar km Versatz sind auf dem ganzen Globus
      //   unsichtbar), daher wirkte „Auf Mitte" als ginge es auch auf Start.
      let WORLD_CENTER_LON = 10;      // Greenwich
      let WORLD_CENTER_LAT = 0;       // Äquator
      try {
        if (mode === "start" && currentCoords && currentCoords.length > 0 && currentCoords[0]) {
          WORLD_CENTER_LON = currentCoords[0][0];
          WORLD_CENTER_LAT = currentCoords[0][1];
        }
        // mode === "world" (oder Fallback): [10, 0] bleibt stehen
      } catch (_) {}
      const WORLD_SHIFT_X = 0;        // Prozent — keine horizontale Verschiebung
      // v0.9.141 (Marc): bei WORLD_PITCH=0 (flach von oben) ist KEIN vertikaler
      // Shift nötig — die Erde sitzt mit Y=0 schon mittig. Der frühere Wert 34
      // stammte aus der pitch=35°-Ära und schob die Welt jetzt zu weit nach oben.
      const WORLD_SHIFT_Y = 0;        // Prozent — Erde vertikal mittig (kein Shift)
      // v0.9.140 (Marc-Bug „springt 1/2 s später ein paar Pixel hoch"):
      // Padding GLEICH in den easeTo backen — vorher lief der easeTo OHNE
      // Padding (Erde landet vertikal zentriert/zu tief), und erst der
      // moveend-`setPadding` + der 250-ms-`jumpTo` schob sie danach ruckartig
      // nach oben → sichtbarer Doppel-Sprung. Mit Padding im easeTo gleitet
      // die Erde in EINER Bewegung an die finale Position; die nachgelagerten
      // setPadding/jumpTo verwenden denselben Wert = optisch No-Op.
      const _worldPadding = (() => {
        try {
          const vp = map.getCanvas();
          const vpW = (vp && vp.clientWidth)  || 1920;
          const vpH = (vp && vp.clientHeight) || 1080;
          const padX = Math.abs(WORLD_SHIFT_X) / 100 * vpW;
          const padY = Math.abs(WORLD_SHIFT_Y) / 100 * vpH;
          return {
            top:    WORLD_SHIFT_Y < 0 ? padY : 0,
            bottom: WORLD_SHIFT_Y > 0 ? padY : 0,
            left:   WORLD_SHIFT_X > 0 ? padX : 0,
            right:  WORLD_SHIFT_X < 0 ? padX : 0,
          };
        } catch (_) { return { top: 0, bottom: 0, left: 0, right: 0 }; }
      })();
      try {
        map.easeTo({
          pitch: WORLD_PITCH,
          bearing: 0,
          zoom: WORLD_ZOOM,
          center: [WORLD_CENTER_LON, WORLD_CENTER_LAT],
          padding: _worldPadding,
          duration: 800,
        });
      } catch (_) {}
      const _syncAfterEase = () => {
        if (!map) return;
        // v0.9.136 — programmatischer easeTo → Akkumulator auf Welt-lng seeden.
        _seedLngAccum(WORLD_CENTER_LON);
        // KF-Slider direkt setzen (X/Y position + Welt-lng/lat)
        const sxEl = document.getElementById("anim-kf-position-x");
        const syEl = document.getElementById("anim-kf-position-y");
        const lngEl = document.getElementById("anim-kf-lng");
        const latEl = document.getElementById("anim-kf-lat");
        if (sxEl) sxEl.value = String(WORLD_SHIFT_X);
        if (syEl) syEl.value = String(WORLD_SHIFT_Y);
        if (lngEl) { lngEl.value = String(WORLD_CENTER_LON); delete lngEl.dataset.userValue; }
        if (latEl) { latEl.value = String(WORLD_CENTER_LAT); delete latEl.dataset.userValue; }
        // Padding live anwenden — v0.9.140: identischer Wert wie im easeTo
        // oben (_worldPadding), damit hier KEIN sichtbarer Sprung passiert
        // (Padding ist durch den easeTo schon gesetzt → setPadding = No-Op).
        try { map.setPadding(_worldPadding); } catch (_) {}
        // Labels aktualisieren
        const sxV = document.getElementById("anim-kf-position-x-v");
        const syV = document.getElementById("anim-kf-position-y-v");
        const lngV = document.getElementById("anim-kf-lng-v");
        const latV = document.getElementById("anim-kf-lat-v");
        if (sxV) sxV.textContent = WORLD_SHIFT_X + " %";
        if (syV) syV.textContent = WORLD_SHIFT_Y + " %";
        if (lngV) lngV.textContent = _formatRotationLabel(WORLD_CENTER_LON);
        if (latV) latV.textContent = WORLD_CENTER_LAT.toFixed(1) + "°";

        const _bumpSlider = (id, val) => {
          const el = document.getElementById(id);
          if (!el) return;
          el.value = String(val);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        };
        _bumpSlider("anim-pitch", WORLD_PITCH);
        _bumpSlider("anim-zoom", WORLD_ZOOM);
        if (keyframesEnabled()) {
          // v0.9.117: preserveWorldSliders=true damit Welt-Pos/Rotation
          // aus den Slidern (gesetzt vom Welt-Button) UND NICHT auf 0
          // zurückgesetzt werden.
          try { snapshotKeyframe(undefined, { preserveWorldSliders: true }); } catch (e) {
            console.warn("[world-center] snapshot fehlgeschlagen", e);
          }
        }
        // v0.9.129 — Anti-Spring-Sicherung (Nutzer-Bug):
        // Slider-Bump-Events können andere Listener triggern (ResizeObserver,
        // fitTrackPreview-Cascade, KF-Slider-Listener), die die Map kurz
        // an eine andere Stelle bewegen. Nach 250 ms holen wir die Welt-
        // Pose definitiv zurück per jumpTo (ohne Animation).
        setTimeout(() => {
          if (!map) return;
          try {
            // v0.9.140: Padding gleich im jumpTo mitgeben (identisch zum
            // easeTo/moveend) — so steht die Welt in EINER Pose und es gibt
            // keinen zweiten Pixel-Sprung mehr.
            map.jumpTo({
              pitch: WORLD_PITCH,
              bearing: 0,
              zoom: WORLD_ZOOM,
              center: [WORLD_CENTER_LON, WORLD_CENTER_LAT],
              padding: _worldPadding,
            });
            _seedLngAccum(WORLD_CENTER_LON);  // v0.9.136
          } catch (_) {}
        }, 250);
      };
      try { map.once("moveend", _syncAfterEase); }
      catch (_) { setTimeout(_syncAfterEase, 900); }
    }
    // v0.9.130 — Zwei Buttons: auf Start vs. auf Bbox-Mitte
    const _worldStartBtn = document.getElementById("anim-world-center-start");
    if (_worldStartBtn) {
      _worldStartBtn.addEventListener("click", () => _centerWorld("start"));
    }
    const _worldBboxBtn = document.getElementById("anim-world-center-bbox");
    if (_worldBboxBtn) {
      _worldBboxBtn.addEventListener("click", () => _centerWorld("world"));
    }
    // v0.9.136 — Welt-Position + Welt-lng/lat Slider sind im KF-Editor-Block
    // (`anim-kf-position-x/y`, `anim-kf-lng`, `anim-kf-lat`). Die onChange-
    // Listener werden in bindKeyframeEditor() registriert.

    // v0.8.14 — Zoom-Slider zeigt absoluten Mapbox-Zoom (0–22); intern
    // speichern wir weiter zoom_offset = absolute - fit_zoom.
    // v0.8.17 — fitBase wird aus dataset.fitBase gelesen, das in
    // renderKeyframeEditor beim Auswählen gesetzt wird. So bleibt der
    // Bezug während des Slider-Drags stabil (war zuvor Race mit map.getZoom
    // während easeTo läuft).
    (() => {
      const el = document.getElementById("anim-kf-zoom");
      const lbl = document.getElementById("anim-kf-zoom-v");
      if (!el || !lbl) return;
      el.addEventListener("input", () => {
        const absZoom = parseFloat(el.value);
        lbl.textContent = absZoom.toFixed(1);
        // v0.9.58 (Nutzer-Bug): _selectedKfIdx ist ein CLUSTER-Index
        // (= Index in clusterAnchors()), NICHT in der flachen events[]-Liste.
        // Vorher: `events[_selectedKfIdx]` indexierte falsch — bei 2 KFs
        // mit je 4 Property-Events traf cluster-idx=1 das 2. Event von KF1
        // (bearing@anchor=0), Scrubber sprang zurück zu KF1. Jetzt: gleicher
        // Lookup-Pattern wie pitch/bearing-Slider (über clusterAnchors).
        const anchors = clusterAnchors();
        let curAnchor;
        if (_selectedEvent) curAnchor = _selectedEvent.anchor;
        else if (_selectedKfIdx != null && _selectedKfIdx < anchors.length) curAnchor = anchors[_selectedKfIdx];
        else return;
        // Bezug konsistent über dataset (von renderKeyframeEditor gesetzt).
        // v0.9.39: Wenn dataset.fitBase oder Helper null → skip statt NaN.
        const fitBase = parseFloat(el.dataset.fitBase) || effectiveFitZoomBase();
        if (fitBase == null || isNaN(fitBase)) return;
        const zoomOff = +(absZoom - fitBase).toFixed(2);
        // Cluster-Idx vom Anker neu beziehen (falls _selectedKfIdx out-of-date)
        const ti = anchors.findIndex(a => Math.abs(a - curAnchor) < 0.001);
        if (ti < 0) return;
        // v0.9.73: beide Werte mitgeben — absZoom ist die direkte User-Intention,
        // wird beim Reload bevorzugt; zoom_offset bleibt für Legacy-Code.
        updateKeyframeFields(ti, { zoom_offset: zoomOff, zoom_absolute: +absZoom.toFixed(3) });
        if (_tlBar) _tlBar.setScrubber(curAnchor);
        scrubPreview(curAnchor);
      });
    })();

    const fromMapBtn = document.getElementById("anim-kf-from-map");
    if (fromMapBtn) {
      fromMapBtn.addEventListener("click", () => {
        if (!map) return;
        const anchors = clusterAnchors();
        let curAnchor, focusedKind;
        if (_selectedEvent && _selectedEvent.kind && _selectedEvent.kind !== "__cluster") {
          curAnchor = _selectedEvent.anchor; focusedKind = _selectedEvent.kind;
        } else if (_selectedEvent && _selectedEvent.kind === "__cluster") {
          // v0.9.4: Cluster-Selektion → alle 3 Werte (wie früher).
          curAnchor = _selectedEvent.anchor; focusedKind = null;
        } else if (_selectedKfIdx != null && _selectedKfIdx < anchors.length) {
          curAnchor = anchors[_selectedKfIdx]; focusedKind = null;
        } else return;
        const ti = anchors.findIndex(a => Math.abs(a - curAnchor) < 0.001);
        if (ti < 0) return;
        // v0.9.3: Per-Property-Modus → nur die selektierte Property updaten.
        // Sonst (Cluster-Modus) alle 3 Werte gleichzeitig.
        const patch = {};
        if (!focusedKind || focusedKind === "pitch")
          patch.pitch = +map.getPitch().toFixed(2);
        if (!focusedKind || focusedKind === "bearing")
          patch.bearing = +map.getBearing().toFixed(2);
        if (!focusedKind || focusedKind === "zoom") {
          // v0.9.39: nur schreiben wenn _fitZoomBase verfügbar — sonst NaN
          // v0.9.73: zoom_absolute = aktueller Map-Zoom (reload-stabil).
          const fb = effectiveFitZoomBase();
          const curMapZoom = +map.getZoom().toFixed(3);
          if (fb != null) patch.zoom_offset = +(curMapZoom - fb).toFixed(2);
          patch.zoom_absolute = curMapZoom;
        }
        updateKeyframeFields(ti, patch);
        renderKeyframeEditor();
      });
    } else {
      console.warn("[kf-editor] anim-kf-from-map button missing at bind-time");
    }

    const delBtn = document.getElementById("anim-kf-delete");
    if (delBtn) {
      delBtn.addEventListener("click", () => {
        // v0.9.3: Per-Property-Modus → nur diesen einen Event löschen.
        // Cluster-Modus: ganzen Cluster (alle 4 Properties) am Anker löschen.
        if (_selectedEvent) {
          deleteEventOne(_selectedEvent);
        } else if (_selectedKfIdx != null) {
          deleteKeyframe(_selectedKfIdx);
        }
      });
    } else {
      console.warn("[kf-editor] anim-kf-delete button missing at bind-time");
    }

    // v0.8.8: Track-Folgen-Toggle
    // v0.9.6 — Hint-Text-Update entfernt; Hilfe ist jetzt statisch hinter ?-Button.
    const followCb = document.getElementById("anim-kf-follow-track");
    if (followCb) {
      followCb.addEventListener("change", () => {
        if (_selectedKfIdx == null || !map) return;
        const isTracking = followCb.checked;
        if (isTracking) {
          // Track-folgen → center weg
          updateKeyframeFields(_selectedKfIdx, { center: null });
        } else {
          // Frei → aktuellen Karten-Center festhalten
          const c = map.getCenter();
          updateKeyframeFields(_selectedKfIdx, { center: [+c.lng.toFixed(6), +c.lat.toFixed(6)] });
        }
        // v0.9.0: _selectedKfIdx ist Cluster-Index — Anker aus clusterAnchors()
        const anchors = clusterAnchors();
        if (_selectedKfIdx != null && _selectedKfIdx < anchors.length) {
          scrubPreview(anchors[_selectedKfIdx]);
        }
      });
    }

    _kfEditorBound = true;
    console.log("[kf-editor] bindKeyframeEditor done — sliders are live");
  }

  // Scrub-Vorschau: setzt die Karte auf die interpolierten Werte an `anchor`
  // und trimmt die Track-Linie bis zu diesem Punkt.
  // v0.7.4: zusätzlich Auto-Selektion synchronisieren — wenn der Scrubber
  // nahe an einem Keyframe landet, wird dieser ausgewählt; sonst Editor weg.
  function scrubPreview(anchor, opts) {
    if (!map || !currentCoords || currentCoords.length < 2) return;
    // v0.9.3 — opts.skipSelectionSync: wenn true, KEIN syncScrubberSelection.
    // Wird von selectEvent() benutzt — sonst löscht der sync sofort wieder
    // die gerade gesetzte Per-Property-Selektion.
    const skipSel = !!(opts && opts.skipSelectionSync);
    // v0.9.86: einheitlicher Pfad — getEffectiveEvents liefert User-KFs ODER
    // implizite Default-KFs aus den Slidern. Kein Sonderfall für Classic mehr.
    const events = getEffectiveEvents();
    const defaultPitch = currentPitch();
    const defaultRotation = parseFloat(document.getElementById("anim-rot")?.value) || 0;
    // v0.9.65: fitZoomBase mitgeben für van-Wijk-Interpolation
    // v0.9.84: cinematic-Toggle aus Animator-Settings durchreichen
    const _animProj = (typeof getActiveProject === "function") ? getActiveProject() : null;
    const _cinematic = !_animProj?.[_MODKEY] || _animProj[_MODKEY].cinematic_flyto !== false;
    const interp = interpolateCameraJs(events, anchor, defaultPitch, defaultRotation,
                                        undefined, effectiveFitZoomBase(),
                                        { cinematic: _cinematic });
    // v0.8.11: anchor ist Timeline-Anker (0..1 von gesamt anim+hold).
    // Track-idx wird über track_fraction abgeleitet — in der Hold-Phase
    // bleibt er auf len-1 (Track steht still), während die Kamera weiter
    // interpoliert werden kann.
    const coordIdx = trackIdxFromTimelineAnchor(anchor);
    // v0.8.7: wenn Keyframe expliziten center hat → nutze ihn, sonst Track-Punkt
    // v0.8.19: Im Classic-Modus (kein KF-Editor) respektieren wir
    // camera_follow_track — wenn aus, bewegt der Scrubber die Kamera NICHT
    // mit dem Track-Punkt, sondern die Map bleibt wo der User sie hin gepant
    // hat. Vorher folgte die Preview dem Track auch wenn der Toggle aus war.
    const isClassic = !keyframesEnabled();
    const cameraFollow = !!document.getElementById("anim-camera-follow")?.checked;
    // v0.9.39: wenn _fitZoomBase noch nicht gesetzt (frischer Re-Mount,
    // fitBounds-moveend kommt noch), WARTEN — nicht raten. Sonst landet
    // die Karte auf falschem Zoom (cameraForBounds-Fallback war v0.9.36
    // → falsch wenn Viewport noch nicht layoutet). Stattdessen registrieren
    // wir uns auf den nächsten moveend und scrubben dann nochmal.
    const base = effectiveFitZoomBase();
    if (base == null) {
      if (map) {
        try {
          // Idempotent: nur einmal pro Re-Mount queue'n
          if (!scrubPreview._pendingDeferredAnchor) {
            scrubPreview._pendingDeferredAnchor = anchor;
            map.once("moveend", () => {
              const a = scrubPreview._pendingDeferredAnchor;
              scrubPreview._pendingDeferredAnchor = null;
              if (a != null && _fitZoomBase != null) {
                try { scrubPreview(a, opts); } catch (_) {}
              }
            });
          } else {
            // Falls noch ein scrub aussteht, anchor updaten (= jüngster gewinnt)
            scrubPreview._pendingDeferredAnchor = anchor;
          }
        } catch (_) {}
      }
      return;  // KEIN flacher Zoom-Fallback mehr — sonst landet Karte falsch
    }
    // v0.9.86: kein Classic-Sonderfall mehr — getEffectiveEvents liefert
    // implizite KFs mit value_absolute=anim-zoom-slider. interp.zoom_offset
    // ist im Classic also exakt (slider - base), zoom = base + offset = slider. ✓
    const easeArgs = {
      pitch: interp.pitch,
      bearing: interp.bearing,
      zoom: base + interp.zoom_offset,
      duration: 80,
    };
    if (interp.center) {
      easeArgs.center = interp.center.slice ? interp.center.slice() : interp.center;
    } else if (!isClassic || cameraFollow) {
      const tp = currentCoords[coordIdx];
      easeArgs.center = tp.slice ? tp.slice() : tp;
    }
    // v0.9.136 — Welt-Drehung steckt jetzt in der *abgewickelten* center.lng
    // (Insta360-Modell). interpolateCameraJs liefert die bereits korrekt
    // abgewickelte center.lng (siehe _maybeFlyToInterp + _interpScalar).
    // Die separate rotation-Lane ist abgeschafft. Hier seeden wir nur noch
    // den lng-Akkumulator auf den vorschau-gesetzten Wert, damit ein
    // anschliessender User-Drag korrekt weiterzählt.
    if (easeArgs.center) _seedLngAccum(easeArgs.center[0]);
    // position-padding wird weiterhin mit smooth Fade-Out zwischen Zoom 4
    // und 8 gewichtet (zoom <= 4: 100 %, 4..8: linear, >= 8: 0 %).
    const _zf = Math.max(0, Math.min(1, (8 - easeArgs.zoom) / 4));
    if (_zf > 0 && interp.position) {
      const sx = (interp.position.x || 0) * _zf;
      const sy = (interp.position.y || 0) * _zf;
      try {
        const vp = map.getCanvas();
        const vpW = (vp && vp.clientWidth)  || 1920;
        const vpH = (vp && vp.clientHeight) || 1080;
        const padX = Math.abs(sx) / 100 * vpW;
        const padY = Math.abs(sy) / 100 * vpH;
        easeArgs.padding = {
          top:    sy < 0 ? padY : 0,
          bottom: sy > 0 ? padY : 0,
          left:   sx > 0 ? padX : 0,
          right:  sx < 0 ? padX : 0,
        };
      } catch (_) {}
    } else {
      easeArgs.padding = { top: 0, bottom: 0, left: 0, right: 0 };
    }
    map.easeTo(easeArgs);
    // Track-Trim: nur bis zum Scrubber-Punkt anzeigen
    // v0.9.11 — wenn der „Ganzer Track"-Toggle an ist, KEIN Trim — Marc
    // will manchmal den ganzen Track sehen während er die Keyframes setzt.
    try {
      const src = map.getSource("preview-track");
      if (src && currentCoords) {
        // v0.9.56: respektiert show_pretrim_track-Setting (= matches Render-Output)
        const startIdx = lineStartCoordIdx();
        const coords = previewFullTrack()
          ? currentCoords
          : currentCoords.slice(startIdx, coordIdx + 1);
        src.setData({
          type: "Feature",
          geometry: { type: "LineString", coordinates: coords },
        });
      }
    } catch (_) {}
    // v0.9.79 — Foto-Pins: Filter auf aktuelle Marker-Position. Foto erscheint
    // erst wenn Track-Marker es passiert hat.
    // v0.9.81 — via window-Helper (Scope-Fix, sonst ReferenceError silent).
    try {
      const ph = window.__rzAnimPhotos;
      if (ph && ph.updateMarkerFilter) ph.updateMarkerFilter(anchor);
      const sg = window.__rzAnimSigns;   // v0.9.171 — Schilder live mitführen
      if (sg && sg.updateAtAnchor) sg.updateAtAnchor(anchor);
    } catch (e) { console.warn("[anim-photos] scrubPreview filter update failed:", e); }
    // Detail-Editor an Scrubber-Position anpassen (überspringen wenn vom
    // Per-Event-Pfad gerufen — siehe selectEvent)
    if (!skipSel) syncScrubberSelection(anchor);
  }

  // v0.7.4: Findet den Keyframe (falls einer) der nah genug am Scrubber-
  // Anchor liegt. Toleranz ist in Track-Prozent — je nach Track-Länge sind
  // 0.5 % typischerweise weniger als die Breite des Markers auf der Bar,
  // damit User mit der Maus präzise treffen kann. Per Pfeiltasten landet
  // man genau auf dem Wert wenn die Anchors exakt einem GPS-Punkt
  // entsprechen — wir bauen die Toleranz so dass auch das matcht.
  function findKeyframeAtAnchor(anchor) {
    if (!currentCoords || currentCoords.length < 2) return null;
    // v0.9.0: Cluster-Anchors (= unique anchors über Property-Events)
    const anchors = clusterAnchors();
    const tolerance = Math.max(0.005, 0.5 / Math.max(1, currentCoords.length - 1));
    let bestIdx = null;
    let bestDist = Infinity;
    for (let i = 0; i < anchors.length; i++) {
      const d = Math.abs(anchors[i] - anchor);
      if (d <= tolerance && d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  function syncScrubberSelection(anchor) {
    // v0.9.3: Scrubber-Move geht in den Cluster-Modus zurück (alle 4
    // Properties zusammen), wenn der Scrubber auf einen Anker landet wo
    // mehrere Property-Events sind. Per-Property-Modus wird nur durch
    // explizites Klick auf einen Lane-Marker erreicht.
    const newIdx = findKeyframeAtAnchor(anchor);
    if (newIdx === _selectedKfIdx && _selectedEvent == null) return;
    _selectedKfIdx = newIdx;
    _selectedEvent = null;  // Scrubber → Cluster-Modus
    if (_tlBar) _tlBar.setSelected(null);
    rebuildCameraKeyframePins();
    renderKeyframeEditor();
  }

  // v0.9.0 — Property-Event-Interpolation. Spiegelt core/timeline.py
  // `interpolate_properties`. Bekommt die rohen events (alle kinds) und
  // filtert intern; pro Property eigene Liste + eigene Interpolation.
  // Returnt {pitch, bearing, zoom_offset, center} — Werte die NICHT durch
  // Events bestimmt sind kommen aus den Defaults (Sweep für bearing,
  // statisch für pitch, 0 für zoom, null für center).
  // v0.9.125 — Easing-Funktion. Mirrors core/timeline.py::_apply_easing.
  // Easing-Wert kommt vom Ziel-Event (b) — also „wie wird der Übergang ZUM
  // b-KF gefahren". Default "linear" für alle bestehenden Projekte.
  function _applyEasing(t, kind) {
    if (kind === "ease_in")     return t * t;
    if (kind === "ease_out")    return 1.0 - (1.0 - t) * (1.0 - t);
    if (kind === "ease_in_out") return t * t * (3.0 - 2.0 * t);
    return t;  // linear
  }
  function _interpScalar(evs, progress, valueKey) {
    if (!evs.length) return null;
    if (evs.length === 1 || progress <= (evs[0].anchor || 0)) return evs[0][valueKey] ?? 0;
    if (progress >= (evs[evs.length - 1].anchor || 1)) return evs[evs.length - 1][valueKey] ?? 0;
    for (let i = 0; i < evs.length - 1; i++) {
      const a = evs[i], b = evs[i + 1];
      const aa = a.anchor || 0, ba = b.anchor || 0;
      if (progress >= aa && progress <= ba) {
        const span = ba - aa;
        if (span <= 0) return b[valueKey] ?? 0;
        const t = _applyEasing((progress - aa) / span, b.easing || "linear");
        return (a[valueKey] ?? 0) + ((b[valueKey] ?? 0) - (a[valueKey] ?? 0)) * t;
      }
    }
    return evs[evs.length - 1][valueKey] ?? 0;
  }

  // v0.9.73 — Zoom-Effektiv-Offset:
  // Bevorzugt `value_absolute` (= absoluter Mapbox-Zoom zur Set-Zeit, reload-stabil)
  // und berechnet den effektiven Offset gegen die aktuelle Fit-Base.
  // Fällt zurück auf legacy `value_offset` wenn `value_absolute` fehlt
  // (Projekte vor v0.9.73) oder `fitBase` noch nicht da ist.
  // Marc-Bug-Fix für „Erde nach Reload viel kleiner als bei Set-Zeit".
  function _zoomEffectiveOffset(ev, fitBase) {
    if (ev && ev.value_absolute != null && fitBase != null && isFinite(fitBase)) {
      return ev.value_absolute - fitBase;
    }
    return ev && ev.value_offset != null ? ev.value_offset : 0;
  }

  // Lineare Interpolation von Zoom-Offset mit value_absolute-Bevorzugung.
  function _interpZoomOffset(evs, progress, fitBase) {
    if (!evs.length) return null;
    if (evs.length === 1 || progress <= (evs[0].anchor || 0))
      return _zoomEffectiveOffset(evs[0], fitBase);
    if (progress >= (evs[evs.length - 1].anchor || 1))
      return _zoomEffectiveOffset(evs[evs.length - 1], fitBase);
    for (let i = 0; i < evs.length - 1; i++) {
      const a = evs[i], b = evs[i + 1];
      const aa = a.anchor || 0, ba = b.anchor || 0;
      if (progress >= aa && progress <= ba) {
        const span = ba - aa;
        const offA = _zoomEffectiveOffset(a, fitBase);
        const offB = _zoomEffectiveOffset(b, fitBase);
        if (span <= 0) return offB;
        const t = _applyEasing((progress - aa) / span, b.easing || "linear");
        return offA + (offB - offA) * t;
      }
    }
    return _zoomEffectiveOffset(evs[evs.length - 1], fitBase);
  }
  function _interpBearing(evs, progress) {
    if (!evs.length) return null;
    if (evs.length === 1 || progress <= (evs[0].anchor || 0)) return evs[0].value ?? 0;
    if (progress >= (evs[evs.length - 1].anchor || 1)) return evs[evs.length - 1].value ?? 0;
    for (let i = 0; i < evs.length - 1; i++) {
      const a = evs[i], b = evs[i + 1];
      const aa = a.anchor || 0, ba = b.anchor || 0;
      if (progress >= aa && progress <= ba) {
        const span = ba - aa;
        if (span <= 0) return b.value ?? 0;
        const t = _applyEasing((progress - aa) / span, b.easing || "linear");
        let delta = ((b.value ?? 0) - (a.value ?? 0)) % 360;
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;
        return (a.value ?? 0) + delta * t;
      }
    }
    return evs[evs.length - 1].value ?? 0;
  }
  // v0.9.143 (Marc-Bug „frei → Track-folgen"): Track-Punkt am gegebenen
  // Timeline-Anchor. Wird genutzt um in _interpCenter den null-Endpunkt eines
  // gemischten Segments (frei ↔ Track-folgen) auf die tatsächliche Track-Position
  // aufzulösen, damit die Kamera smooth dorthin pant statt einzufrieren+springen.
  function _trackPointAtAnchor(anchor) {
    if (!currentCoords || currentCoords.length < 1) return null;
    const idx = trackIdxFromTimelineAnchor(anchor);
    const p = currentCoords[idx];
    return (p && p.length >= 2) ? [p[0], p[1]] : null;
  }
  function _interpCenter(evs, progress) {
    const withVal = evs.filter(e => e.value != null);
    if (!withVal.length) return null;
    if (evs.length === 1 || progress <= (evs[0].anchor || 0)) {
      return evs[0].value || null;
    }
    if (progress >= (evs[evs.length - 1].anchor || 1)) {
      return evs[evs.length - 1].value || null;
    }
    for (let i = 0; i < evs.length - 1; i++) {
      const a = evs[i], b = evs[i + 1];
      const aa = a.anchor || 0, ba = b.anchor || 0;
      if (progress >= aa && progress <= ba) {
        const span = ba - aa;
        const rawT = span > 0 ? (progress - aa) / span : 1;
        const t = _applyEasing(rawT, b.easing || "linear");
        // v0.9.143: gemischtes Segment (ein Endpunkt frei, einer Track-folgen
        // = null) — null-Endpunkt auf den Track-Punkt an SEINEM Anchor auflösen,
        // dann interpolieren. Beide null → null zurück (Caller folgt dem Track
        // per-Vertex, unverändertes Verhalten).
        let av = a.value, bv = b.value;
        if (av == null && bv == null) return null;
        if (av == null) av = _trackPointAtAnchor(aa);
        if (bv == null) bv = _trackPointAtAnchor(ba);
        if (av && bv) {
          return [av[0] + (bv[0] - av[0]) * t,
                  av[1] + (bv[1] - av[1]) * t];
        }
        return av || bv || null;
      }
    }
    return evs[evs.length - 1].value || null;
  }

  // v0.9.63 (Marc-Bug Erdkugel-Flug): van-Wijk-Algorithmus für gekoppelte
  // (center+zoom)-Interpolation bei großen Zoom-Sprüngen. Linear interpolieren
  // ergibt bei Globe→Detail (Δzoom ≈ 13) den „Track rutscht aus Sichtfeld
  // bis recht starkem Zoom hin geflogen wird"-Effekt — weil center linear
  // gepannt wird während zoom linear skaliert. van-Wijk macht das Mapbox-
  // flyTo-Verhalten nach: erst Zoom-Out + Pan + Zoom-In als smooth coupled curve.
  // Reference: van Wijk + Nuij 2003, „Smooth and Efficient Zooming and Panning".
  // Mapbox-gl-js Camera._flyTo nutzt den gleichen Algorithmus mit rho=1.42.
  // v0.9.133 — Web-Mercator-Projektion (lon/lat ↔ Welt-Bruchteil [0,1]).
  // Spiegelt Python-`_merc_x/_merc_y/...` in core/timeline.py. van-Wijk braucht
  // Distanz u und Viewport-Breite w=1/2^z in DENSELBEN Einheiten (Welt-Bruchteil).
  function _mercX(lon) { return (lon + 180) / 360; }
  function _mercY(lat) {
    const la = Math.max(-85.051129, Math.min(85.051129, lat));
    const s = Math.sin(la * Math.PI / 180);
    return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  }
  function _mercXInv(x) { return x * 360 - 180; }
  function _mercYInv(y) {
    const n = Math.PI - 2 * Math.PI * y;
    return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  }

  function _vanWijkInterp(c1, c2, z1, z2, t) {
    // Defensive
    if (!c1 || !c2) return { center: c1 || c2 || null, zoom: z1 + (z2 - z1) * t };
    if (t <= 0) return { center: c1, zoom: z1 };
    if (t >= 1) return { center: c2, zoom: z2 };
    const rho = 1.42;
    // w(z) = Sichtbare Welt-Größe (Wir nutzen w = 1/2^z als Proxy — konstanter
    // Faktor fällt in den Formeln raus). Größerer Zoom = kleineres w.
    const w1 = 1 / Math.pow(2, z1);
    const w2 = 1 / Math.pow(2, z2);
    // Horizontale Distanz im selben Skalen-Raum wie w. Wir nehmen Lat/Lon-Diff
    // direkt — bei kleinen Distanzen ok; bei Globe-Sprung (>30°) leicht ungenau,
    // aber die Kurve sieht trotzdem deutlich besser aus als linear.
    const dx = c2[0] - c1[0];
    const dy = c2[1] - c1[1];
    const u = Math.sqrt(dx * dx + dy * dy);
    if (u < 1e-9) {
      // Kein Pan — nur Zoom linear interpolieren
      return { center: [c1[0], c1[1]], zoom: z1 + (z2 - z1) * t };
    }
    const rho2 = rho * rho;
    const u2 = u * u;
    const w1sq = w1 * w1;
    const w2sq = w2 * w2;
    // van-Wijk-Hilfsgrößen (Eq. 9 im Paper)
    const b0 = (w2sq - w1sq + rho2 * rho2 * u2) / (2.0 * w1 * rho2 * u);
    const b1 = (w2sq - w1sq - rho2 * rho2 * u2) / (2.0 * w2 * rho2 * u);
    // v0.9.68 (Marc-Bug): Vorzeichen-Fix — van-Wijk-Paper Eq. 9 hat
    // r(i) = ln(-b_i + sqrt(b_i² + 1)), nicht +b_i. Bei großen Zoom-Deltas
    // (typisch Globe→Detail mit Δ~12) wurde S sonst negativ → unsere
    // Defensive griff auf linear zurück. Mathematisch: r(i) = -asinh(b_i).
    const r0 = Math.log(-b0 + Math.sqrt(b0 * b0 + 1));
    const r1 = Math.log(-b1 + Math.sqrt(b1 * b1 + 1));
    const S = (r1 - r0) / rho;     // „Pfad-Länge"
    if (!isFinite(S) || S <= 0) {
      // Degenerierter Fall — Fallback auf linear
      return {
        center: [c1[0] + dx * t, c1[1] + dy * t],
        zoom: z1 + (z2 - z1) * t,
      };
    }
    const s = t * S;
    // v0.9.68 (Marc-Bug): Korrektur der Formel — cosh(r0) ist KONSTANT
    // (van-Wijk Eq. 6), nicht cosh(rho*s + r0). Letzteres gehört nur in ws
    // (Eq. 7) als Nenner. Vorher: u(S) ≠ u (Marker landete weit hinter dem Endpunkt).
    const cosh_r0 = Math.cosh(r0);
    const us = w1 / rho2 *
      (cosh_r0 * Math.tanh(rho * s + r0) - Math.sinh(r0));
    const ws = w1 * cosh_r0 / Math.cosh(rho * s + r0);
    const zoom_s = Math.log2(1 / Math.max(1e-12, ws));
    const cTrip = u > 0 ? us / u : t;
    return {
      center: [c1[0] + dx * cTrip, c1[1] + dy * cTrip],
      zoom: zoom_s,
    };
  }

  // Threshold ab dem wir van-Wijk statt linear nehmen. Bei < 3 Zoom-Levels
  // Unterschied wirkt linear auch schon ok — bei > 3 fängt's an zu kippen.
  // v0.9.84 — Threshold von 3 → 5: van-Wijk nur bei wirklich extremen Zoom-
  // Sprüngen (Globe→Detail). Bei normalen Track-Übergängen (Δzoom 3-5) bleibt
  // lineare Interpolation, kein „Hollywood-Rauszoom".
  const _FLYTO_ZOOM_DELTA_THRESHOLD = 5.0;

  // v0.9.63 — Hilfsfunktion: findet das Segment in dem progress liegt für
  // BEIDE zoom+center-Spuren. Wenn dasselbe Segment + großer Zoom-Sprung
  // → returnt van-Wijk-Interpolation (gekoppelt). Sonst null = linear weiter.
  // v0.9.65 (Marc-Bug): van-Wijk-Formel ist NICHT translation-invariant in w
  // (w = 1/2^z). Wir müssen ABSOLUTE Mapbox-Zooms (offset + fitBase) reingeben,
  // sonst kommt eine schiefe Kurve raus. fitBase wird vom Caller durchgereicht.
  function _maybeFlyToInterp(zoomEvs, centerEvs, progress, fitBase) {
    if (fitBase == null || isNaN(fitBase)) return null;  // ohne fitBase keine Konvertierung möglich
    // Finde zoom-Segment
    let zA = null, zB = null;
    for (let i = 0; i < zoomEvs.length - 1; i++) {
      const a = zoomEvs[i].anchor || 0, b = zoomEvs[i + 1].anchor || 0;
      if (progress >= a && progress <= b) { zA = zoomEvs[i]; zB = zoomEvs[i + 1]; break; }
    }
    if (!zA || !zB) return null;
    // Finde center-Segment
    let cA = null, cB = null;
    for (let i = 0; i < centerEvs.length - 1; i++) {
      const a = centerEvs[i].anchor || 0, b = centerEvs[i + 1].anchor || 0;
      if (progress >= a && progress <= b) { cA = centerEvs[i]; cB = centerEvs[i + 1]; break; }
    }
    if (!cA || !cB) return null;
    // v0.9.144 (Marc-Bug „nur weiß"): gemischtes Segment (ein Endpunkt frei,
    // einer Track-folgen = null). Früher bailte van-Wijk hier und der Caller
    // pante LINEAR — bei großem Zoom-Sprung (Welt→Track) flog die Kamera durch
    // leeren Raum (= weiße Karte). Jetzt null-Endpunkt auf den Track-Punkt an
    // seinem Anchor auflösen → sauberer Kino-Flug auch beim frei↔folgen-Wechsel.
    // Beide null → kein flyto (reines Track-Folgen). Spiegelt Python.
    let cAval = cA.value, cBval = cB.value;
    if (!cAval && !cBval) return null;
    if (!cAval) cAval = _trackPointAtAnchor(cA.anchor || 0);
    if (!cBval) cBval = _trackPointAtAnchor(cB.anchor || 0);
    if (!cAval || !cBval) return null;
    // Segmente müssen ungefähr dieselben Anchor-Grenzen haben
    if (Math.abs((zA.anchor || 0) - (cA.anchor || 0)) > 0.001) return null;
    if (Math.abs((zB.anchor || 0) - (cB.anchor || 0)) > 0.001) return null;
    // Zoom-Sprung-Check (in Offset-Space — Skala egal, nur Differenz zählt)
    // v0.9.73: value_absolute bevorzugen (reload-stabil) → effektiver Offset.
    const offsetA = _zoomEffectiveOffset(zA, fitBase);
    const offsetB = _zoomEffectiveOffset(zB, fitBase);
    if (Math.abs(offsetA - offsetB) < _FLYTO_ZOOM_DELTA_THRESHOLD) return null;
    // v0.9.133 (Marc-Bug Welt→Track): van-Wijk jetzt in Mercator-projizierten
    // Koordinaten [0,1] statt roher Grad → u passt zu w=1/2^z. Damit braucht's
    // den v0.9.121-Skip ("min(abs) <= 3 → linear") NICHT mehr: die Kurve bleibt
    // am weiten Ende oben (Welt-Sicht/Schwenk) und zoomt erst am Ende rein =
    // echter Kino-Flug statt „fällt runter und irrt im Tiefflug umher".
    const absA = offsetA + fitBase;
    const absB = offsetB + fitBase;
    // Lokal-progress im Segment
    const seg = (zB.anchor || 0) - (zA.anchor || 0);
    const t = seg > 0 ? (progress - (zA.anchor || 0)) / seg : 1;
    // v0.9.136 — Welt-Drehung-Entkopplung (Insta360-Modell, synchron zu
    // core/timeline.py `_maybe_flyto_interp`). center.lng ist *abgewickelt*
    // (kann >±180° = volle Erddrehungen). van-Wijk darf aber NUR die
    // geografische Kürzeste-Pfad-Distanz sehen, sonst projiziert _mercX
    // einen lng>180 ausserhalb [0,1] und der Zoom explodiert. Wir zerlegen:
    //   lon_a_w  = gewickelter Start-lng  ∈ [-180,180)
    //   base_off = abgewickelter Offset des Starts (Vielfaches 360)
    //   shortest = kürzester geo. Weg A→B ∈ [-180,180)
    //   winding  = übrige volle Drehungen (Vielfaches 360)
    // van-Wijk läuft auf den gewickelten Endpunkten; das Winding addieren
    // wir linear (×t) oben drauf. Ergebnis t=0→lon_a, t=1→lon_b exakt.
    const lonA = cAval[0], lonB = cBval[0];
    const lonAW = _wrapLng(lonA);
    const baseOff = lonA - lonAW;
    const rawD = lonB - lonA;
    const shortest = _wrapLng(rawD);
    const winding = rawD - shortest;
    const mcA = [_mercX(lonAW), _mercY(cAval[1])];
    const mcB = [_mercX(lonAW + shortest), _mercY(cBval[1])];
    const r = _vanWijkInterp(mcA, mcB, absA, absB, t);
    // Mapbox-Min-Zoom-Clamp + Mercator → lon/lat zurück
    const absZoom = Math.max(0, r.zoom);
    const lng = _mercXInv(r.center[0]) + baseOff + winding * t;
    const center = [lng, _mercYInv(r.center[1])];
    // absolute Zoom → offset zurückrechnen
    return { center: center, zoom_offset: absZoom - fitBase };
  }

  // events — entweder Property-Events ODER alte camera-Events (Backward-Compat).
  // v0.9.65: optional `fitZoomBase` für van-Wijk-Interpolation (= absoluter
  // Mapbox-Zoom bei Track-Auto-Fit). Wenn null/undef → van-Wijk wird skipped,
  // bisheriges lineares Verhalten greift.
  function interpolateCameraJs(events, progress, defaultPitch, defaultRotation, defaultBearingStart, fitZoomBase, opts) {
    if (defaultBearingStart == null) defaultBearingStart = -10;
    progress = Math.max(0, Math.min(1, progress));
    const evs = Array.isArray(events) ? events : [];

    // v0.9.38 (Marc-Bug-Report): De-Dup pro kind + anchor.
    // Alte gespeicherte Projekte enthalten Duplikate (mehrere zoom/pitch/
    // bearing am gleichen Anchor — passierte durch Filter-Toleranz-Bug
    // beim Snapshot). Beim Anwenden müssen wir auf 1 Event pro (kind,anchor)
    // reduzieren, sonst gewinnt nicht der zuletzt gesetzte Wert sondern
    // ein zufälliger. Strategie: NEUERE (= später in der Liste = später
    // gesetzt) überschreibt ÄLTERE.
    const dedup = (list) => {
      const seen = new Map();   // anchor (gerundet) → event
      for (const e of list) {
        if (!e) continue;
        const key = (e.anchor || 0).toFixed(4);
        seen.set(key, e);  // späterer Eintrag gewinnt
      }
      return Array.from(seen.values());
    };

    // Property-Events nach kind filtern + de-dupen + sortieren
    const sortByAnchor = (a, b) => (a.anchor || 0) - (b.anchor || 0);
    const pitchEvs   = dedup(evs.filter(e => e && e.kind === "pitch")).sort(sortByAnchor);
    const bearingEvs = dedup(evs.filter(e => e && e.kind === "bearing")).sort(sortByAnchor);
    const zoomEvs    = dedup(evs.filter(e => e && e.kind === "zoom")).sort(sortByAnchor);
    const centerEvs  = dedup(evs.filter(e => e && e.kind === "center")).sort(sortByAnchor);
    // v0.9.107 — position-Events ({x,y} in %, Mapbox-padding pro KF)
    const positionEvs = dedup(evs.filter(e => e && e.kind === "position")).sort(sortByAnchor);
    // v0.9.136 — rotation-Lane abgeschafft (Insta360-Modell). Die Drehung
    // steckt in der abgewickelten center.lng. Alte Projekte können noch
    // rotation-Events enthalten — die werden hier ignoriert (kein Crash).
    const hasProperty = pitchEvs.length || bearingEvs.length || zoomEvs.length || centerEvs.length || positionEvs.length;

    if (hasProperty) {
      const p = _interpScalar(pitchEvs, progress, "value");
      const b = _interpBearing(bearingEvs, progress);
      // v0.9.73: bevorzugt `value_absolute` (reload-stabil) gegen aktuelle
      // Fit-Base; Fallback `value_offset` für ältere Projekte.
      let z = _interpZoomOffset(zoomEvs, progress, fitZoomBase);
      let c = _interpCenter(centerEvs, progress);
      // v0.9.63: bei großem Zoom-Sprung + zugehörigem Center-KF van-Wijk-Kurve.
      // v0.9.65: fitZoomBase muss übergeben werden — sonst skipped die Funktion
      // (van-Wijk-Formel braucht absolute Mapbox-Zooms, nicht offsets).
      // v0.9.84 (Marc-Bug „zoomt weiter raus als eingestellt"): nur wenn Toggle
      // `cinematic_flyto` an ist. Sonst linear (= keine Bogen-Trajectory).
      const _cinematic = !opts || opts.cinematic !== false;
      if (_cinematic && zoomEvs.length >= 2 && centerEvs.length >= 2) {
        const flyto = _maybeFlyToInterp(zoomEvs, centerEvs, progress, fitZoomBase);
        if (flyto) {
          z = flyto.zoom_offset;
          c = flyto.center;
        }
      }
      // v0.9.107 — Position: lineare Interpolation der {x,y}-Komponenten
      // zwischen KFs. Wenn keine position-Events → null, kein padding.
      let posInterp = null;
      if (positionEvs.length > 0) {
        // x und y separat als Scalar interpolieren
        const posXEvs = positionEvs.map(e => ({ anchor: e.anchor, value: (e.value || {}).x || 0 }));
        const posYEvs = positionEvs.map(e => ({ anchor: e.anchor, value: (e.value || {}).y || 0 }));
        const px = _interpScalar(posXEvs, progress, "value");
        const py = _interpScalar(posYEvs, progress, "value");
        if (px != null || py != null) posInterp = { x: px || 0, y: py || 0 };
      }
      // v0.9.136 — rotation-Lane abgeschafft. Die Welt-Drehung steckt in der
      // abgewickelten center.lng (siehe _interpCenter + _maybeFlyToInterp).
      return {
        pitch: p != null ? p : defaultPitch,
        bearing: b != null ? b : (defaultBearingStart + progress * defaultRotation),
        zoom_offset: z != null ? z : 0,
        center: c,
        position: posInterp,
      };
    }

    // Backward-Compat: alte camera-Events (sollte nach Migration nicht mehr
    // vorkommen, aber sicherheitshalber)
    const cams = evs.filter(e => e && e.kind === "camera").sort(sortByAnchor);
    if (!cams.length) {
      return {
        pitch: defaultPitch,
        bearing: defaultBearingStart + progress * defaultRotation,
        zoom_offset: 0,
        center: null,
      };
    }
    if (cams.length === 1 || progress <= (cams[0].anchor || 0)) {
      const k = cams[0];
      return { pitch: k.pitch || 0, bearing: k.bearing || 0, zoom_offset: k.zoom_offset || 0, center: k.center || null };
    }
    if (progress >= (cams[cams.length - 1].anchor || 1)) {
      const k = cams[cams.length - 1];
      return { pitch: k.pitch || 0, bearing: k.bearing || 0, zoom_offset: k.zoom_offset || 0, center: k.center || null };
    }
    for (let i = 0; i < cams.length - 1; i++) {
      const a = cams[i], b = cams[i + 1];
      const aa = a.anchor || 0, ba = b.anchor || 0;
      if (progress >= aa && progress <= ba) {
        const span = ba - aa;
        if (span <= 0) return { pitch: b.pitch || 0, bearing: b.bearing || 0, zoom_offset: b.zoom_offset || 0, center: b.center || null };
        const t = (progress - aa) / span;
        let delta = ((b.bearing || 0) - (a.bearing || 0)) % 360;
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;
        let center = null;
        if (a.center && b.center) {
          center = [a.center[0] + (b.center[0] - a.center[0]) * t,
                    a.center[1] + (b.center[1] - a.center[1]) * t];
        } else if (a.center) center = a.center;
        else if (b.center) center = b.center;
        return {
          pitch: (a.pitch || 0) + ((b.pitch || 0) - (a.pitch || 0)) * t,
          bearing: (a.bearing || 0) + delta * t,
          zoom_offset: (a.zoom_offset || 0) + ((b.zoom_offset || 0) - (a.zoom_offset || 0)) * t,
          center,
        };
      }
    }
    const k = cams[cams.length - 1];
    return { pitch: k.pitch || 0, bearing: k.bearing || 0, zoom_offset: k.zoom_offset || 0, center: k.center || null };
  }

  // Probe-Lauf: animiert über die eingestellte Animations-Dauer (cfg.duration_s)
  // den ganzen Track ab + interpoliert Camera-Werte synchron. Reines Vorschau-
  // Feature, kein Render. Plus Animations-Hold am Ende synchron zum
  // anim-hold-Slider (so wie's der Render auch macht).
  // Toggle-Verhalten: zweiter Klick (oder Space) während laufendem Preview
  // stoppt sofort.
  // v0.8.6: Speed-Multiplier (1x, 2x, 4x, 8x). Jeder „L"-Druck während
  // laufendem Probe-Lauf verdoppelt. Bei Stop → reset auf 1.
  // (Variablen oben in mountAnimator deklariert — TDZ-Schutz.)

  /** Wird vom L-Key gerufen — startet Probe oder verdoppelt Speed.
   *  Toggle (Stop): K-Key oder Space. */
  function bumpPreviewSpeed() {
    if (_previewRaf) {
      // Läuft schon → Speed verdoppeln, max 8x. t0 adjustieren damit
      // sich die aktuell-virtual-Time nicht ändert.
      const newSpeed = Math.min(8, _previewSpeed * 2);
      if (newSpeed !== _previewSpeed) {
        const now = performance.now();
        const virtualElapsed = (now - _previewT0) * _previewSpeed;
        _previewT0 = now - (virtualElapsed / newSpeed);
        _previewSpeed = newSpeed;
        applog("info", `[runPreview] speed → ${newSpeed}x`);
        if (_tlBar) _tlBar.setPlayingSpeed && _tlBar.setPlayingSpeed(newSpeed);
      }
    } else {
      // Stop → Start mit 1x
      _previewSpeed = 1;
      runTimelinePreview(true);
    }
  }

  function runTimelinePreview(forceStart) {
    if (!map || !currentCoords || currentCoords.length < 2) return;
    if (_previewRaf && forceStart !== true) {
      // Aktuell läuft was → stoppen
      cancelAnimationFrame(_previewRaf);
      _previewRaf = null;
      _previewSpeed = 1;
      if (_tlBar) _tlBar.setPlaying(false);
      // v0.9.45 (Marc-Bug): Track-Linie über refreshPreviewTrackData
      // wiederherstellen — der respektiert previewFullTrack() (= Toggle
      // „Ganzer Track" aus → bei Scrubber-Position trimmen) statt blind
      // den kompletten Track zu zeigen.
      refreshPreviewTrackData();
      return;
    }
    // v0.9.254 (Nutzer-Bug #5) — beim START eines Probe-Laufs das echte Schild-Timing
    // zeigen. Sonst bleiben ein gerade bearbeitetes Schild oder der „Alle Schilder
    // zeigen"-Modus aktiv → Schild wird eingeblendet und bleibt stehen. Die Force-Modi
    // leben im Schild-Scope → über die window.__rzAnimSigns.beginPreview()-Methode
    // zurücksetzen (v0.9.255: direkter Variablenzugriff hier crashte mit „Can't find variable").
    try { window.__rzAnimSigns && window.__rzAnimSigns.beginPreview && window.__rzAnimSigns.beginPreview(); } catch (_) {}
    // v0.9.86: einheitlicher Pfad mit getEffectiveEvents (User-KFs oder
    // implizite Defaults aus Slidern). Marc-Refactor „nur ein interner Modus".
    const events = getEffectiveEvents();
    const defaultPitch = currentPitch();
    const defaultRotation = parseFloat(document.getElementById("anim-rot")?.value) || 0;
    // v0.7.1: Probe-Lauf nutzt die eingestellte Animations-Dauer statt fix 5 s.
    // Hold-Phase wird auch berücksichtigt — der Render hat ja auch den Hold am
    // Ende mit Bearing-Sweep. Wir simulieren das durch eine kleine End-Hold-Zeit.
    const introSec = parseFloat(document.getElementById("anim-intro")?.value) || 0;
    const durSec = parseFloat(document.getElementById("anim-dur")?.value) || 12;
    const holdSec = parseFloat(document.getElementById("anim-hold")?.value) || 0;
    const introMs = Math.max(0, introSec * 1000);
    const animMs = Math.max(500, durSec * 1000);
    const holdMs = Math.max(0, holdSec * 1000);
    // v0.9.59: Total-Zeit = intro + anim + hold. Drei Phasen.
    const totalMs = introMs + animMs + holdMs;
    // v0.9.43: Probe-Lauf startet an aktueller Scrubber-Position
    let _startAnchor = (_tlBar && typeof _tlBar.getScrubber === "function")
      ? Math.max(0, Math.min(1, _tlBar.getScrubber() || 0))
      : 0;
    if (_startAnchor >= 0.98) _startAnchor = 0;
    // v0.9.72 (Marc-Bug, „nach Reload Preview falsch"): fitZoomBase EINMAL
    // beim Start cachen + KONSTANT für den ganzen Probe-Lauf benutzen. Vorher
    // wurde pro Frame `effectiveFitZoomBase()` neu abgefragt — wenn der Wert
    // mid-flight wechselt (z.B. weil eine fitBounds-Animation parallel läuft
    // oder _fitZoomBase erst spät durch moveend gesetzt wurde), springt
    // van-Wijk pro Frame mit anderer Base = sichtbar falsche Interpolation.
    // Wenn fitZoomBase noch null ist (Re-Mount nach Reload, moveend noch
    // ausstehend) → defer via map.once("moveend") und retry.
    const _previewFitBase = effectiveFitZoomBase();
    if (_previewFitBase == null) {
      try {
        if (map) {
          map.once("moveend", () => {
            try { runTimelinePreview(true); } catch (_) {}
          });
        }
      } catch (_) {}
      return;
    }
    _previewT0 = performance.now() - (_startAnchor * totalMs);
    _previewAnimMs = animMs;
    _previewHoldMs = holdMs;
    if (_tlBar) _tlBar.setPlaying(true);
    // v0.9.83 — Spin-Akkumulator reset für jeden neuen Probelauf
    // v0.9.277 (Nutzer) — Kamera-Trägheit im Probelauf (WYSIWYG zum Render). EMA des
    // Folge-Zentrums, ZEITBASIERT gerechnet (auf 30fps-Render referenziert), damit
    // die Vorschau (≈60fps) genauso träge wirkt wie das Video.
    let _follLL = null;
    let _follLastNow = 0;
    // v0.9.314 — Kamera-Höhe HALTEN: eingefrorene Gelände-Referenz pro Probelauf.
    let _camStabBase = null;
    // v0.9.318 — Entkoppelte FreeCamera (WYSIWYG zum Render). Pro Keyframe-Anker
    // die exakte 3D-Kamera (Position + Orientierung) auslesen, im step dazwischen
    // Position linear + Orientierung per nlerp interpolieren → kein Berg-Hüpfen,
    // framing-treu an den KFs. Spiegel von __camPrepFaithful/__camFaithful im Render.
    let _faithCams = null, _useFaithful = false;
    const _nlerpQ = (a, b, t) => {
      const dot = a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3];
      const bb = dot < 0 ? [-b[0], -b[1], -b[2], -b[3]] : b;
      const r = [a[0]+(bb[0]-a[0])*t, a[1]+(bb[1]-a[1])*t, a[2]+(bb[2]-a[2])*t, a[3]+(bb[3]-a[3])*t];
      const len = Math.hypot(r[0], r[1], r[2], r[3]) || 1;
      return [r[0]/len, r[1]/len, r[2]/len, r[3]/len];
    };
    const _faithSeek = (tp) => {
      const cams = _faithCams; if (!cams || !cams.length) return;
      const fc = map.getFreeCameraOptions();
      if (cams.length === 1) {
        const c = cams[0];
        fc.position = new mapboxgl.MercatorCoordinate(c.pos[0], c.pos[1], c.pos[2]);
        fc.orientation = c.ori; map.setFreeCameraOptions(fc); return;
      }
      let i = 0; while (i < cams.length - 2 && tp > cams[i+1].t) i++;
      const A = cams[i], B = cams[i+1], span = (B.t - A.t) || 1e-6;
      const u = Math.max(0, Math.min(1, (tp - A.t) / span));
      fc.position = new mapboxgl.MercatorCoordinate(
        A.pos[0]+(B.pos[0]-A.pos[0])*u, A.pos[1]+(B.pos[1]-A.pos[1])*u, A.pos[2]+(B.pos[2]-A.pos[2])*u);
      fc.orientation = _nlerpQ(A.ori, B.ori, u);
      map.setFreeCameraOptions(fc);
    };
    try {
      const _fProj = (typeof getActiveProject === "function") ? getActiveProject() : null;
      // v0.9.318 — Default AUS: nur an, wenn Checkbox/Setting explizit true.
      const _fSmooth = _fProj?.[_MODKEY]?.smooth_camera_3d === true;
      if (_fSmooth && map && map.getFreeCameraOptions && typeof mapboxgl !== "undefined") {
        const _camKinds = { center: 1, pitch: 1, zoom: 1, bearing: 1, position: 1, rotation: 1 };
        const _anchSet = new Set([0, 1]);
        (events || []).forEach((e) => {
          if (e && _camKinds[e.kind] && e.value != null) {
            const a = Math.round((+e.anchor || 0) * 1e6) / 1e6;
            if (a >= 0 && a <= 1) _anchSet.add(a);
          }
        });
        const _anchors = Array.from(_anchSet).sort((x, y) => x - y);
        if (_anchors.length >= 2) {
          const _fCine = !_fProj?.[_MODKEY] || _fProj[_MODKEY].cinematic_flyto !== false;
          const _fFollow = !!document.getElementById("anim-camera-follow")?.checked;
          const _fStatic = (() => { try { const c = map.getCenter(); return [c.lng, c.lat]; } catch (_) { return [0, 0]; } })();
          const _fti = introFraction(), _ftf = trackFraction(), _ftn = currentCoords.length;
          const _ftrim = (_tlBar && typeof _tlBar.getTrim === "function") ? _tlBar.getTrim() : { start: 0, end: 1 };
          const _ftA = Math.max(0, Math.min(1, _ftrim.start ?? 0)), _ftB = Math.max(_ftA, Math.min(1, _ftrim.end ?? 1));
          const _markerAt = (tp) => {
            if (tp < _fti) return _ftA;
            if (tp < _ftf) { const p = (tp - _fti) / Math.max(0.0001, _ftf - _fti); return _ftA + p * (_ftB - _ftA); }
            return _ftB;
          };
          const _savedCam = map.getFreeCameraOptions();
          _faithCams = _anchors.map((a) => {
            const ip = interpolateCameraJs(events, a, defaultPitch, defaultRotation, undefined, _previewFitBase, { cinematic: _fCine });
            const zm = _previewFitBase + (ip.zoom_offset || 0);
            let ll;
            if (ip.center) ll = ip.center.slice();
            else if (_fFollow) {
              const ci = Math.max(0, Math.min(_ftn - 1, Math.round(_markerAt(a) * (_ftn - 1))));
              ll = currentCoords[ci] ? [currentCoords[ci][0], currentCoords[ci][1]] : _fStatic;
            } else ll = _fStatic;
            map.jumpTo({ center: ll, zoom: zm, pitch: ip.pitch, bearing: ip.bearing || 0 });
            const fc = map.getFreeCameraOptions(), o = fc.orientation;
            return { t: a, pos: [fc.position.x, fc.position.y, fc.position.z], ori: [o[0], o[1], o[2], o[3]] };
          });
          try { map.setFreeCameraOptions(_savedCam); } catch (_) {}
          _useFaithful = true;
        }
      }
    } catch (_) { _useFaithful = false; _faithCams = null; }
    const step = (now) => {
      const elapsed = (now - _previewT0) * _previewSpeed;
      // v0.9.53: Track-Position-Trim, fixe Render-Zeit (anim + hold).
      // timelineProgress = 0..1 linear mit Zeit. tf = Position wo Anim
      // endet und Hold beginnt. Während Anim-Phase wandert der Marker
      // auf dem realen Track von trim_start nach trim_end. Während Hold
      // steht er am trim_end. Scrubber visuell = marker_real * tf (während
      // Anim) bzw. trim_end*tf + holdProgress*(1 - trim_end*tf) (während
      // Hold) — so dass der Scrubber visuell GENAU durch die Trim-Handles
      // wandert.
      const timelineProgress = Math.min(1, elapsed / totalMs);
      // v0.9.228 — Overlay-Zeitfenster im Probelauf spiegeln (WYSIWYG zum Render).
      // Video-Sekunde = Fortschritt × Gesamtdauer (intro+anim+hold).
      try {
        const _ovTotalSec = (parseFloat(document.getElementById("anim-intro")?.value) || 0)
          + (parseFloat(document.getElementById("anim-dur")?.value) || 0)
          + (parseFloat(document.getElementById("anim-hold")?.value) || 0);
        _animOverlayTimingPreview(timelineProgress * _ovTotalSec);
      } catch (_) {}
      const ti = introFraction();
      const tf = trackFraction();
      const tn = currentCoords.length;
      const trim = (_tlBar && typeof _tlBar.getTrim === "function")
        ? _tlBar.getTrim() : { start: 0, end: 1 };
      const trimA = Math.max(0, Math.min(1, trim.start ?? 0));
      const trimB = Math.max(trimA, Math.min(1, trim.end ?? 1));
      // v0.9.59: Drei Phasen — intro/anim/hold. Marker und Scrubber-Position
      // pro Phase berechnet, sodass Scrubber visuell durch die Trim-Handles
      // wandert (linkes Handle bei intro-Ende, rechtes bei anim-Ende).
      const trimStartVis = ti + trimA * (tf - ti);
      const trimEndVis   = ti + trimB * (tf - ti);
      let markerReal, scrubberVis;
      // v0.9.253 — eigener Schild-Anker, der in Intro/Hold ÜBER die Track-Grenzen
      // hinausläuft (gleiche Rate wie Anim = 1/durSec pro Sekunde), damit Schild-
      // Timing-Fenster (Einblenden im Intro / Ausblenden im Hold) auch dort greifen.
      // Der Marker selbst bleibt am trim_start/-end eingefroren (markerReal).
      let signAnchor;
      if (timelineProgress < ti) {
        // INTRO-Phase — Marker am trim_start, Scrubber wandert 0 → trimStartVis
        markerReal = trimA;
        const introProgress = timelineProgress / Math.max(0.0001, ti);
        scrubberVis = introProgress * trimStartVis;
        signAnchor = trimA - (introSec * (1 - introProgress)) / Math.max(0.001, durSec);
      } else if (timelineProgress < tf) {
        // ANIM-Phase
        const animProgress = (timelineProgress - ti) / Math.max(0.0001, tf - ti);
        markerReal = trimA + animProgress * (trimB - trimA);
        scrubberVis = trimStartVis + animProgress * (trimEndVis - trimStartVis);
        signAnchor = markerReal;
      } else {
        // HOLD-Phase — Marker am trim_end, Scrubber wandert trimEndVis → 1.0
        markerReal = trimB;
        const holdProgress = (timelineProgress - tf) / Math.max(0.0001, 1 - tf);
        scrubberVis = trimEndVis + holdProgress * (1 - trimEndVis);
        signAnchor = trimB + (holdProgress * holdSec) / Math.max(0.001, durSec);
      }
      const coordIdx = Math.max(0, Math.min(tn - 1, Math.round(markerReal * (tn - 1))));
      // v0.9.56: Track-Linien-Start respektiert show_pretrim_track-Setting:
      // wenn an → von Track-Anfang (0), sonst vom Trim-Start.
      const startCoordIdx = showPretrimTrack()
        ? 0
        : Math.max(0, Math.min(tn - 1, Math.round(trimA * (tn - 1))));
      // KF-Interpolation kriegt timelineProgress (0..1 von gesamter Render-Zeit).
      // KFs wirken auf der Zeit-Achse, ihre Anchor sind auf real-Track 0..1
      // (= Position wo der Marker zu der Zeit ist).
      // v0.9.65: fitZoomBase mitgeben für van-Wijk-Interpolation
      // v0.9.72: KONSTANTE Base über den ganzen Probe-Lauf (siehe `_previewFitBase`
      // oben). Sonst springt van-Wijk wenn _fitZoomBase mid-flight wechselt.
      // v0.9.84: cinematic-Toggle durchreichen
      const _runProj = (typeof getActiveProject === "function") ? getActiveProject() : null;
      const _runCinematic = !_runProj?.[_MODKEY] || _runProj[_MODKEY].cinematic_flyto !== false;
      const interp = interpolateCameraJs(events, timelineProgress, defaultPitch, defaultRotation,
                                          undefined, _previewFitBase,
                                          { cinematic: _runCinematic });
      // v0.8.7: Keyframe-center hat Vorrang vor Track-Punkt
      const isClassic2 = !keyframesEnabled();
      const cameraFollow2 = !!document.getElementById("anim-camera-follow")?.checked;
      // v0.9.72: konstante Base über den Probe-Lauf (siehe _previewFitBase oben).
      const base = _previewFitBase;
      // v0.9.107 — Spin als Velocity-Slider raus. Drehung kommt jetzt
      // deklarativ aus center.lng-Werten pro KF (= Welt-Drehung-Slider
      // setzt das im Snapshot). interpolateCameraJs interpoliert linear
      // zwischen den KF-lng-Werten.
      const _curZoom = base + (interp.zoom_offset || 0);
      const jumpArgs = {
        pitch: interp.pitch,
        bearing: interp.bearing || 0,
        zoom: _curZoom,
      };
      // v0.9.136 — center.lng (abgewickelt) hat Vorrang vor Track-Punkt. Die
      // Welt-Drehung steckt in der center.lng (Insta360-Modell); die separate
      // rotation-Lane ist abgeschafft.
      let _didFollow = false;
      if (interp.center) { jumpArgs.center = interp.center.slice(); _follLL = null; }
      else if (!isClassic2 || cameraFollow2) {
        _didFollow = true;
        const _tgt = currentCoords[coordIdx];
        // v0.9.277 (Nutzer) — Kamera-Trägheit: EMA des Folge-Zentrums, zeitbasiert auf
        // 30fps-Render referenziert → Vorschau wirkt genauso träge wie das Video.
        const _inertia = (parseInt(document.getElementById("anim-follow-inertia")?.value, 10) || 0) / 100;
        const _kRender = Math.max(0.005, Math.pow(1 - _inertia, 2));
        if (_inertia <= 0 || !_follLL) {
          _follLL = [_tgt[0], _tgt[1]];
        } else {
          const _dv = Math.max(0, now - _follLastNow) * _previewSpeed / 1000;   // Video-Sek.
          const _kPrev = 1 - Math.pow(1 - _kRender, 30 * _dv);                   // 30 = Render-fps-Referenz
          _follLL = [_follLL[0] + (_tgt[0] - _follLL[0]) * _kPrev,
                     _follLL[1] + (_tgt[1] - _follLL[1]) * _kPrev];
        }
        _follLastNow = now;
        jumpArgs.center = _follLL.slice();
      }
      // position-padding mit smooth Fade-Out zwischen Zoom 4 und 8
      // (zoom <= 4: 100 %, 4..8: linear, >= 8: 0 %). Siehe scrubPreview.
      const _zfStep = Math.max(0, Math.min(1, (8 - _curZoom) / 4));
      if (jumpArgs.center) _seedLngAccum(jumpArgs.center[0]);  // v0.9.136
      // v0.9.318 — entkoppelte FreeCamera (WYSIWYG zum Render) statt setCenter/-Zoom.
      if (_useFaithful) { _faithSeek(timelineProgress); }
      else { map.jumpTo(jumpArgs); }
      // Padding ebenfalls mit zoomFade gewichten, damit der Welt-Offset
      // genauso sanft ausläuft wie die Drehung.
      if (_zfStep > 0 && interp.position) {
        try {
          const vp = map.getCanvas();
          const vpW = (vp && vp.clientWidth)  || 1920;
          const vpH = (vp && vp.clientHeight) || 1080;
          const sx = (interp.position.x || 0) * _zfStep;
          const sy = (interp.position.y || 0) * _zfStep;
          const padX = Math.abs(sx) / 100 * vpW;
          const padY = Math.abs(sy) / 100 * vpH;
          map.setPadding({
            top:    sy < 0 ? padY : 0,
            bottom: sy > 0 ? padY : 0,
            left:   sx > 0 ? padX : 0,
            right:  sx < 0 ? padX : 0,
          });
        } catch (_) {}
      } else {
        try { map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 }); } catch (_) {}
      }
      try {
        const src = map.getSource("preview-track");
        if (src) {
          const fullToggle = previewFullTrack();
          const lineCoords = fullToggle
            ? currentCoords
            : currentCoords.slice(startCoordIdx, coordIdx + 1);
          src.setData({
            type: "Feature",
            geometry: { type: "LineString", coordinates: lineCoords },
          });
        }
      } catch (_) {}
      // v0.9.79 — Foto-Pins live mit Marker mit-laufen lassen.
      // markerReal ist hier schon der Track-Anchor (0..1 vom realen Track,
      // inkl. trim/intro/hold-Phasenberechnung). PERFEKTER Match.
      // v0.9.81 — Scope-Fix: _animPhotosShow ist innerhalb der onMapReady-
      // Closure definiert und in step() NICHT zugreifbar → ReferenceError
      // wurde silent von try/catch verschluckt. Jetzt via window-Helper.
      try {
        const ph = window.__rzAnimPhotos;
        if (typeof PhotoPins !== "undefined" && PhotoPins.setMarkerAnchor &&
            ph && ph.show && ph.show()) {
          PhotoPins.setMarkerAnchor(map, markerReal);
        }
        const sg = window.__rzAnimSigns;   // v0.9.171 — Schilder im Probelauf
        // v0.9.253 — Schild-Anker (läuft in Intro/Hold über die Grenzen) statt
        // markerReal, damit Timing-Fenster in Intro/Hold auch in der Vorschau greifen.
        if (sg && sg.applyMarkerAnchor) sg.applyMarkerAnchor(signAnchor);
      } catch (e) { console.warn("[anim-photos] step filter update failed:", e); }
      // Scrubber visuell — siehe Berechnung oben (durch Trim-Handles wandernd).
      if (_tlBar) _tlBar.setScrubber(scrubberVis);
      if (elapsed < totalMs) {
        _previewRaf = requestAnimationFrame(step);
      } else {
        _previewRaf = null;
        if (_tlBar) _tlBar.setPlaying(false);
        // v0.9.228 — Overlay-Boxen nach Probelauf wieder alle einblenden
        // (statische Konfig-Vorschau zeigt alle aktivierten Boxen).
        try { _animOverlayTimingPreview(-1); } catch (_) {}
        refreshPreviewTrackData();
        // v0.9.79 — Foto-Filter auf den scrubAnchor zurücksetzen, sonst
        // bleiben am Probe-Lauf-Ende alle Fotos sichtbar obwohl der Scrubber
        // vielleicht nur in der Mitte steht.
        // v0.9.81 — via window-Helper (Scope-Fix).
        try {
          const a = (_tlBar && typeof _tlBar.getScrubber === "function")
            ? _tlBar.getScrubber() : 0;
          const ph = window.__rzAnimPhotos;
          if (ph && ph.updateMarkerFilter) ph.updateMarkerFilter(a);
          const sg = window.__rzAnimSigns;   // v0.9.171
          if (sg && sg.updateAtAnchor) sg.updateAtAnchor(a);
        } catch (e) { console.warn("[anim-photos] post-preview filter update failed:", e); }
      }
    };
    if (_previewRaf) cancelAnimationFrame(_previewRaf);
    _previewRaf = requestAnimationFrame(step);
  }
  // v0.7.6: _previewRaf wird oben in mountAnimator() deklariert (TDZ-Fix).

  // v0.7.1: Position-Label-Provider — zeigt "Punkt N / Total · X%" in der
  // Timeline-Bar Status-Row.
  // v0.7.4: zusätzlich "🎥 auf Keyframe #N" oder "frei (📍 = neuer Keyframe)"
  // damit Marc immer weiß ob seine Karten-Edits einen Keyframe ändern oder
  // nur die freie Karten-Vorschau.
  function timelinePositionLabel(anchor) {
    if (!currentCoords || currentCoords.length < 2) return "—";
    // v0.8.11: anchor ist Timeline-Anker. Track-idx via track_fraction;
    // wenn wir in der Hold-Phase sind, beschriften wir das explizit damit
    // der User weiß warum der Track-Endpunkt stehen bleibt.
    const tf = trackFraction();
    const idx = trackIdxFromTimelineAnchor(anchor);
    const pct = (anchor * 100).toFixed(1);
    const pointLbl = (typeof t === "function" && t("animator.timeline.point") !== "animator.timeline.point")
                     ? t("animator.timeline.point") : "Punkt";
    const phase = anchor > tf + 0.0005
      ? ((typeof t === "function" && t("animator.timeline.hold_phase") !== "animator.timeline.hold_phase")
          ? t("animator.timeline.hold_phase") : "Hold")
      : "";
    const base = phase
      ? `${pointLbl} ${idx + 1} / ${currentCoords.length} · ${pct}% · ⏸ ${phase}`
      : `${pointLbl} ${idx + 1} / ${currentCoords.length} · ${pct}%`;
    // Modus-Suffix
    const kfIdx = findKeyframeAtAnchor(anchor);
    let suffix;
    if (kfIdx != null) {
      const onKf = (typeof t === "function" && t("animator.timeline.on_keyframe") !== "animator.timeline.on_keyframe")
                   ? t("animator.timeline.on_keyframe") : "auf Keyframe";
      suffix = ` · 🎥 ${onKf} #${kfIdx + 1}`;
    } else {
      const free = (typeof t === "function" && t("animator.timeline.free_mode") !== "animator.timeline.free_mode")
                   ? t("animator.timeline.free_mode") : "frei (📍 = neuer Keyframe)";
      suffix = ` · ${free}`;
    }
    return base + suffix;
  }

  // v0.7.1: Pfeiltasten-Navigation auf der Timeline.
  // ← / →           — ein GPS-Punkt vor/zurück
  // Shift + ← / →   — 10 GPS-Punkte vor/zurück
  // Home / End      — Anfang / Ende
  // Space           — Probe-Lauf toggle
  // Nur wenn Animator-Modul aktiv ist UND kein Input/Textarea fokussiert.
  function bindTimelineKeyNav() {
    if (bindTimelineKeyNav._bound) return;
    bindTimelineKeyNav._bound = true;
    window.addEventListener("keydown", (e) => {
      // Nur reagieren wenn der Animator gerade sichtbar ist
      const panel = document.getElementById("anim-panel");
      if (!panel || !panel.offsetParent) return;
      // v0.9.67: Cmd/Ctrl+Z (Undo) wird vom globalen Listener in util.js
      // verarbeitet — modul-übergreifend (Animator + Tour-Map + Geotagger).
      // Hier nicht mehr behandelt.
      // Nicht bei Input/Textarea/Select
      const ae = document.activeElement;
      const tag = (ae?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      // Editierbare Elemente auch raus (contentEditable)
      if (ae?.isContentEditable) return;
      if (!currentCoords || currentCoords.length < 2) return;

      const step = e.shiftKey ? 10 : 1;
      let handled = false;
      if (e.key === "ArrowLeft") {
        jumpTrackPoints(-step);
        handled = true;
      } else if (e.key === "ArrowRight") {
        jumpTrackPoints(+step);
        handled = true;
      } else if (e.key === "Home") {
        jumpToAnchor(0);
        handled = true;
      } else if (e.key === "End") {
        jumpToAnchor(1);
        handled = true;
      } else if (e.key === " " || e.code === "Space") {
        // Space: Probe-Lauf toggle (Start/Stop)
        runTimelinePreview();
        handled = true;
      } else if (e.key === "k" || e.key === "K") {
        // v0.8.20 — K: Keyframe an aktueller Scrubber-Position hinzufügen
        // (Marc-Wunsch). Vorher war K Stop (zusammen mit Space) — Stop bleibt
        // auf Space alleine. K macht nur was wenn der KF-Editor an ist.
        if (keyframesEnabled()) {
          snapshotKeyframe();
          handled = true;
        }
      } else if (e.key === "l" || e.key === "L") {
        // v0.8.6: L wie in Premiere/Final Cut — startet Probe-Lauf,
        // weitere L-Drücker während laufendem Lauf verdoppeln Speed
        // (1x → 2x → 4x → 8x). K oder Space stoppt.
        bumpPreviewSpeed();
        handled = true;
      } else if ((e.key === "Delete" || e.key === "Backspace") && _selectedKfIdx != null) {
        // v0.7.3: Selektierten Keyframe via Tastatur löschen
        deleteKeyframe(_selectedKfIdx);
        handled = true;
      }
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    });
  }

  function jumpTrackPoints(delta) {
    if (!currentCoords || currentCoords.length < 2) return;
    const total = currentCoords.length - 1;
    const curAnchor = _tlBar ? _tlBar.getScrubber() : 0;
    const curIdx = Math.round(curAnchor * total);
    const newIdx = Math.max(0, Math.min(total, curIdx + delta));
    const newAnchor = total > 0 ? newIdx / total : 0;
    jumpToAnchor(newAnchor);
  }

  function jumpToAnchor(anchor) {
    if (_tlBar) _tlBar.setScrubber(anchor);
    scrubPreview(anchor);
  }
  // _fitZoomBase wird von fitTrackPreview() gesetzt — der Auto-Fit-Zoom.
  // Zoom-Offsets werden relativ dazu interpretiert.
  // v0.7.6: Deklaration oben in mountAnimator() (TDZ-Fix).

  // Backward-Compat-UI: wenn Keyframes vorhanden sind, die alten
  // Pitch/Rotation-Slider mit „inaktiv"-Hinweis grayed-out anzeigen.
  function syncTimelineOverrideUi() {
    // v0.9.0: Property-Events ODER alte camera-Events
    const hasKfs = getTimelineEvents().some(e =>
      e && (KF_LANES.includes(e.kind) || e.kind === "camera"));
    const pitchField = document.getElementById("anim-pitch")?.closest(".field");
    const rotField   = document.getElementById("anim-rot")?.closest(".field");
    [pitchField, rotField].forEach(f => {
      if (!f) return;
      f.classList.toggle("is-overridden-by-timeline", hasKfs);
      // Hinweis-Text einmalig hinzufügen
      let hint = f.querySelector(".timeline-override-hint");
      if (hasKfs && !hint) {
        hint = document.createElement("div");
        hint.className = "muted timeline-override-hint";
        hint.style.cssText = "font-size:11px; margin-top:4px; color:#ffd166;";
        hint.textContent = tlT("animator.timeline.override", "⏱ Wird durch Timeline-Keyframes gesteuert");
        f.appendChild(hint);
      } else if (!hasKfs && hint) {
        hint.remove();
      }
    });
  }

  function getMapConfig() {
    // Karten-Feinabstimmung-Werte aus den Akkordeon-Controls lesen.
    // Falls die noch nicht im DOM sind (z.B. ganz früher Render-Cycle):
    // Fallback auf den Settings-Cache.
    const el = id => document.getElementById(id);
    const fallback = (_settingsCache && _settingsCache[_MODKEY]) || {};
    return {
      lightPreset: el("anim-mc-light")?.value || fallback.light_preset || "day",
      showPlace: el("anim-mc-places")
        ? el("anim-mc-places").checked
        : (fallback.show_place_labels !== false),
      showRoad: el("anim-mc-roads")
        ? el("anim-mc-roads").checked
        : (fallback.show_road_labels !== false),
      showPoi: el("anim-mc-poi")
        ? el("anim-mc-poi").checked
        : (fallback.show_poi_labels !== false),
      // ÖPNV wieder als Checkbox in v0.6.5 — vorher in v0.6.0 entfernt,
      // Marc wollte sie wieder. Dasselbe DOM-Read-Pattern wie die anderen.
      showTransit: el("anim-mc-transit")
        ? el("anim-mc-transit").checked
        : (fallback.show_transit_labels !== false),
      showAdmin: el("anim-mc-admin")
        ? el("anim-mc-admin").checked
        : (fallback.show_admin_boundaries !== false),
    };
  }

  function applyHideLabels() {
    // Karten-Feinabstimmung in der Live-Preview anwenden (v0.5.0+).
    // Zwei Mechanismen parallel:
    //   1) Mapbox-Standard-Styles → setConfigProperty('basemap', …) für
    //      lightPreset + die 4 show*Labels-Properties.
    //   2) Klassische Styles → Layer-ID-Heuristik (Symbol- + Line-Layer,
    //      gematched nach `admin-*`, `road-*`, `poi-*`, `transit-*`,
    //      `place-*`/`country-label-*`/`state-label-*`).
    // Function-Name behalten wir wegen vieler Aufruf-Stellen — intern
    // macht sie jetzt mehr.
    if (!map) return;
    const c = getMapConfig();
    // 1) Standard-Style Config (No-Op auf klassischen Styles)
    try { map.setConfigProperty("basemap", "lightPreset", c.lightPreset); } catch (_) {}
    try { map.setConfigProperty("basemap", "showPlaceLabels", c.showPlace); } catch (_) {}
    try { map.setConfigProperty("basemap", "showRoadLabels", c.showRoad); } catch (_) {}
    try { map.setConfigProperty("basemap", "showPointOfInterestLabels", c.showPoi); } catch (_) {}
    try { map.setConfigProperty("basemap", "showTransitLabels", c.showTransit); } catch (_) {}
    // Admin-Boundaries: Mapbox hat dafür Mitte 2024 die Config-Property
    // ergänzt. Bei älteren Style-Versionen ist das ein No-Op (try/catch).
    try { map.setConfigProperty("basemap", "showAdminBoundaries", c.showAdmin); } catch (_) {}
    // 2) Klassische Styles: Layer-ID-Heuristik
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

  function applyAlphaPreview() {
    // Im Alpha-Modus wird im Render KEINE Karte sein. Damit der User das
    // VOR dem Render sieht, legen wir einen dunklen Background-Layer
    // ZWISCHEN Karten-Tiles und Track-Layer (Mapbox-Z-Stack: beforeId =
    // "preview-shadow" sortiert den neuen Layer direkt darunter ein).
    // Mapbox `background`-Layer hat keine Source, füllt den ganzen Viewport.
    if (!map) return;
    const enabled = currentAlphaEnabled();
    // Hint-Banner im DOM (Viewport-Overlay) — User-freundliche Erklärung
    const hint = document.getElementById("anim-alpha-preview-hint");
    if (hint) hint.hidden = !enabled;
    try {
      const beforeId = map.getLayer("preview-shadow") ? "preview-shadow"
                     : map.getLayer("preview-glow") ? "preview-glow"
                     : undefined;
      if (enabled) {
        if (!map.getLayer("alpha-bg")) {
          map.addLayer({
            id: "alpha-bg",
            type: "background",
            paint: { "background-color": "#1a1a1a", "background-opacity": 0.94 }
          }, beforeId);
        } else {
          map.setLayoutProperty("alpha-bg", "visibility", "visible");
        }
      } else {
        if (map.getLayer("alpha-bg")) {
          map.setLayoutProperty("alpha-bg", "visibility", "none");
        }
      }
    } catch (_) {}
  }

  function applyLineWidthToLayers() {
    if (!map) return;
    const lw = currentLineWidth();
    const gs = currentGlowStrength();
    try {
      // v0.9.20 — Glow-Width respektiert gs-Skalierung
      if (map.getLayer("preview-glow")) map.setPaintProperty("preview-glow", "line-width", lw * (2.0 + 0.21 * gs));
      if (map.getLayer("preview-line")) map.setPaintProperty("preview-line", "line-width", lw);
      // v0.8.10 — Highlight-Layer (Tube-Modus) folgt der Linien-Dicke
      if (map.getLayer("preview-highlight")) map.setPaintProperty("preview-highlight", "line-width", lw * 0.35);
    } catch (_) {}
  }

  function applyTerrain() {
    if (!map) return;
    if (isOsmMode()) return;   // OSM ohne Token → kein DEM verfügbar
    const want = currentTerrainOn();
    try {
      if (want) {
        if (!map.getSource("mapbox-dem")) {
          map.addSource("mapbox-dem", {
            type: "raster-dem",
            url: "mapbox://mapbox.mapbox-terrain-dem-v1",
            tileSize: 512, maxzoom: 14,
          });
        }
        map.setTerrain({ source: "mapbox-dem", exaggeration: currentExaggeration() });
      } else {
        map.setTerrain(null);
      }
      // v0.9.16 — line-z-offset auf 150 m setzen wenn Terrain aktiv, sonst auf 0.
      // Damit „schwebt" der Track im Preview genau gleich wie im Render
      // (Render-Code hat dasselbe 150-m-Offset in core/animator.py). Shadow
      // bleibt bewusst auf dem Boden (kein z-offset).
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
    } catch (_) {}
  }

  // v0.9.23 — Sammel-Re-Apply ALLER paint-Properties auf der Preview-Karte.
  // Wird nach Session-Load / Projekt-Wechsel gerufen, weil `bindSetting`'s
  // `applyToElement` nur den DOM-Wert setzt + `onLoad` ruft — die ganzen
  // `applyXxxToLayers()`-Funktionen werden nicht automatisch nachgezogen.
  // Marc-Bug 2026-05-24: „Trackfarbe in Sidebar restored, Preview zeigt
  // aber default-Farbe" — selber Klasse von Bug existiert für line-width,
  // shadow, glow, line-style, etc. Eine zentrale Re-Apply-Fn löst alle
  // gleichzeitig statt jedem bindSetting einzeln eine apply-Logik
  // anzuhängen.
  function applyAllPaintSettings() {
    if (!map) return;
    try { applyLineColorToLayers(); } catch (_) {}
    try { applyLineWidthToLayers(); } catch (_) {}
    try { applyShadowToLayers(); } catch (_) {}
    try { applyGlowToLayers(); } catch (_) {}
    try { applyLineStyle(); } catch (_) {}
    try { applyTrackStyle(); } catch (_) {}
    try { applyHideLabels(); } catch (_) {}
    try { applyTerrain(); } catch (_) {}
    try { applyAlphaPreview(); } catch (_) {}
    try { renderOverlayPreview(); } catch (_) {}
  }

  function applyStyle(styleKey) {
    if (!map) return;
    if (isOsmMode()) {
      // Im OSM-Modus gibt es nur einen Style — Wechsel ignorieren
      toast(t("animator.osm_only"), "info", 3000);
      return;
    }
    const url = MAP_STYLES[styleKey] || MAP_STYLES.satellite;
    map.setStyle(url);
    map.once("style.load", () => {
      rebuildPreviewLayers();
    });
  }

  whenApiReady().then(async () => {
    // v0.9.249 — OSM-Modus: Animator + Reiseroute sind Mapbox-only. Statt einer
    // sinnlosen OSM-Vorschau die Karten-Fläche mit klarer „Token nötig"-Meldung
    // überdecken und den Map-Init komplett überspringen (keine OSM-Karte).
    try {
      const _cv = body.querySelector("#map-canvas");
      if (_cv && _cv.parentElement && window.osmBlockOverlay && window.osmBlockOverlay(_cv.parentElement)) {
        return;
      }
    } catch (_) {}
    const initialStyleKey = (_settingsCache?.[_MODKEY]?.map_style) || "satellite";
    // Viewport vor Map-Init dimensionieren — sonst hat Mapbox die falsche Größe.
    updateAnimatorViewport();
    const made = createMap({
      container: "map-canvas",
      mapboxStyle: MAP_STYLES[initialStyleKey] || MAP_STYLES.satellite,
      common: { center: [10, 51], zoom: 4, pitch: currentPitch() },
    });
    map = made.map;
    map.addControl(new made.lib.NavigationControl(), "top-right");

    // v0.8.6: Karte-Edits → Slider + Keyframe-Sync.
    // Wenn der User in der Karte mit Maus/Cmd+Drag etwas ändert (Pitch,
    // Bearing, Zoom), sollen die Slider in der Sidebar mitgehen.
    // Wenn der Scrubber gerade AUF einem Keyframe steht: dessen Werte
    // werden auch geupdated — so kann Marc den Cinematic direkt auf der
    // Karte einstellen statt mit den Slidern.
    // `originalEvent` ist gesetzt wenn's eine User-Geste war (nicht
    // unsere eigenen easeTo/jumpTo-Calls).
    map.on("moveend", (e) => {
      // v0.9.139 — Geste-Ende: Inertia ist durch. Flag zurücksetzen, aber
      // auch dann syncen wenn das moveend selbst kein originalEvent trägt
      // (Inertia-moveend nach einem User-Drag) — sonst ginge die per Flick
      // erzeugte Welt-Drehung beim finalen Settle verloren.
      const wasUser = _userInteracting;
      _userInteracting = false;
      if (!e || (!e.originalEvent && !wasUser)) return;
      _syncMapStateToUi();
    });

    // v0.9.136/139 — Längengrad-Akkumulator: nur ECHTE User-Gesten
    // akkumulieren. `dragstart` markiert die Geste (Flag) + seedet den Prev-
    // Wert; `move` misst Frame-für-Frame-Deltas (inkl. nachlaufender Inertia,
    // die KEINE `drag`-Events mehr feuert) und erkennt ±180°-Sprünge →
    // abgewickelte center.lng (Welt-Drehung). Programmatische easeTo/jumpTo
    // feuern kein `dragstart` → `_userInteracting` bleibt false → kein
    // Korrumpieren.
    map.on("dragstart", () => {
      _userInteracting = true;
      if (_lngAccum === null) _seedLngAccum(map.getCenter().lng);
      else _lngAccumPrev = _wrapLng(map.getCenter().lng);
      _updateLngLiveDisplay();
    });
    map.on("move", () => { if (_userInteracting) _trackLngAccumFromMap(); });
    // v0.9.137 — Counter beim ersten Laden auf den aktuellen Stand setzen.
    map.once("idle", () => { if (_lngAccum === null) _seedLngAccum(map.getCenter().lng); _updateLngLiveDisplay(); });

    // v0.8.20 — Rechtsklick / Doppel-Tap auf Touchpad = Keyframe an aktueller
    // Scrubber-Position setzen (Marc-Wunsch). Mapbox feuert `contextmenu` für
    // beide Eingaben. Wir verhindern auch das Browser-Default-Kontextmenü.
    map.on("contextmenu", (e) => {
      if (!keyframesEnabled()) return;
      if (e?.originalEvent?.preventDefault) e.originalEvent.preventDefault();
      snapshotKeyframe();
    });

    // v0.8.4: onMapReady ist robust gegen Race-Conditions — wenn Mapbox
    // den Style schon geladen hat BEVOR wir den Listener anhängen, wird
    // der Callback trotzdem gerufen (über isStyleLoaded-Pre-Check).
    // v0.9.171 — Klick auf die Karte setzt im Platzier-Modus ein Wegpunkt-Schild.
    // v0.9.205 — Route-Punkt-Pick hat Vorrang: konsumiert den Klick (kein Schild).
    map.on("click", (e) => {
      try { if (_routeOnMapClick(e)) return; } catch (_) {}
      try { _animSignsOnMapClick(e); } catch (_) {}
    });

    onMapReady(map, () => {
      applog("info", "[Animator onMapReady cb] running");
      rebuildPreviewLayers();
      if (typeof getGlobalGpxData === "function") {
        const path = getGlobalGpxPath();
        const data = getGlobalGpxData();
        applog("info", `[Animator onMapReady] gpxPath=${path} hasData=${!!data}`);
        if (path && data) applyGlobalGpx(path, data);
        // v0.9.214 (Reiseroute) — zuletzt berechnete Route wiederherstellen
        // (animierter Track), das geladene GPX bleibt Ghost.
        if (_isReiseroute && typeof _routeRestoreGpx === "function") { try { _routeRestoreGpx(); } catch (_) {} }
      }
      // v0.9.29/35 (Marc-Bug-Report): Selection + Scrubber wiederherstellen.
      // v0.9.35: zusätzlich `scrubPreview` rufen damit die Map auf den KF
      // zoomt — sonst bleibt sie auf Track-Extent (fitTrackPreview-Resultat)
      // und der User landet beim Tab-Wechsel-Zurück nicht da wo er war.
      try {
        const cache = window.__rzgpsModuleCache && window.__rzgpsModuleCache[_MODKEY];
        if (cache && Date.now() - cache.ts < 60 * 60 * 1000) {
          // Längeres Delay (1000 ms) damit sessionActivate-then + autoSelectFirstKfIfNeeded
          // erst durch sind. Sonst überschreiben die unsere Restore-Werte.
          setTimeout(() => {
            try {
              if (cache.selectedKfIdx != null && typeof _selectedKfIdx !== "undefined") {
                _selectedKfIdx = cache.selectedKfIdx;
                if (typeof renderKeyframeEditor === "function") renderKeyframeEditor();
              }
              if (cache.scrubberAnchor != null && _tlBar && typeof _tlBar.setScrubber === "function") {
                _tlBar.setScrubber(cache.scrubberAnchor);
                // Karte auf den gemerkten KF-Anchor scrubben — nur wenn KFs
                // aktiv sind, sonst wäre's ein No-Op auf currentCoords.
                if (keyframesEnabled() && map && currentCoords && currentCoords.length > 1) {
                  try { scrubPreview(cache.scrubberAnchor, { skipSelectionSync: true }); } catch (_) {}
                }
              }
            } catch (_) {}
          }, 1000);
        }
      } catch (_) {}
    });
    // Overlay-Vorschau einmal initial — auch ohne GPX zeigen wir Platzhalter-
    // Boxen, damit der User sieht WO die Stats-Boxen landen werden.
    renderOverlayPreview();

    // v0.9.34 (Marc-Bug-Report): ResizeObserver feuern beim Re-Mount mehrfach
    // in schneller Folge (Layout-Cascade). Wenn jeder Trigger sofort
    // updateAnimatorViewport + fitTrackPreview ruft, killen die Calls die
    // gerade laufende Map-Animation → flackernde Zoom-Werte, oft Weltansicht
    // als Endzustand. Debounce auf 200 ms = wir warten bis das Layout stabil
    // ist und feuern dann EINMAL.
    let _resizeRefitTimer = null;
    const _debouncedRefit = () => {
      clearTimeout(_resizeRefitTimer);
      _resizeRefitTimer = setTimeout(() => {
        updateAnimatorViewport();
        if (currentBbox) fitTrackPreview(false);
      }, 200);
    };
    // ResizeObserver: Section-Größe ändert sich → Viewport neu fitten + Refit
    _animViewportObserver = new ResizeObserver(_debouncedRefit);
    _animViewportObserver.observe(document.querySelector(".anim-canvas"));

    // v0.9.10 — Timeline-Bar-Höhe beobachten. Jedes Mal wenn sich die Bar
    // ausdehnt oder schrumpft (KF-Editor an/aus, ?-Hilfe geöffnet/zu, künftig
    // mehr/weniger Lanes), wird `--anim-tl-h` neu gesetzt → padding-bottom
    // der .anim-canvas + bottom-Offset von Refit-Button + Resolution-Badge
    // passen sich an. Karte bekommt dadurch automatisch den freien Platz.
    const tlHostEl = document.querySelector(".anim-timeline-host");
    if (tlHostEl) {
      let _tlResizeTimer = null;
      _animTimelineObserver = new ResizeObserver(() => {
        clearTimeout(_tlResizeTimer);
        _tlResizeTimer = setTimeout(() => {
          syncTimelineHeight();
          updateAnimatorViewport();
          if (currentBbox) fitTrackPreview(false);
        }, 200);
      });
      _animTimelineObserver.observe(tlHostEl);
    }
    // Initial einmal messen (vor erstem Layout)
    syncTimelineHeight();

    // v0.7.0: Timeline-Bar mounten (Camera-Keyframes).
    const tlHost = document.getElementById("anim-timeline-host");
    if (tlHost && typeof mountTimelineBar === "function") {
      _tlBar = mountTimelineBar({
        container: tlHost,
        getEvents: getTimelineEvents,
        getPositionLabel: timelinePositionLabel,
        onScrub:        (anchor) => scrubPreview(anchor),
        onScrubEnd:     () => {
          // v0.8.9: KEIN Track-Reset mehr nach Scrubbing — Marc will dass
          // der Track bis zur Scrubber-Position getrimmt BLEIBT (Wunsch
          // 2026-05-23). Für volle Linie: zum 100%-Ende scrubben oder
          // Refit-Button ⤢.
          if (false && map && currentCoords) {
            try {
              const src = map.getSource("preview-track");
              if (src) src.setData({
                type: "Feature",
                geometry: { type: "LineString", coordinates: currentCoords },
              });
            } catch (_) {}
          }
        },
        // v0.9.3: timeline.js callbacks geben jetzt {kind, anchor} statt cluster-idx.
        onSelect:       (ev) => selectEvent(ev),
        onAnchorChange: (ev, newAnchor) => moveEvent(ev, newAnchor),
        onDelete:       (ev) => deleteEventOne(ev),
        onSnapshot:     (anchor) => snapshotKeyframe(anchor),
        onClearAll:     () => clearAllKeyframes(),
        onRunPreview:   () => runTimelinePreview(),
        // v0.9.8 — Doppelklick auf eine Lane = nur dieser Property einen
        // Event geben (statt immer den ganzen Cluster anzulegen).
        onCreateSingle: (ev) => createSingleProperty(ev.kind, ev.anchor),
        // v0.9.11 — Voller-Track-Toggle: gibt + setzt das Setting.
        getFullTrack:       () => previewFullTrack(),
        onFullTrackChange:  (on) => setPreviewFullTrack(on),
        // v0.9.15 — KF-Pins-Toggle: gibt + setzt das Setting.
        getShowKfPins:      () => previewShowKfPins(),
        onShowKfPinsChange: (on) => setPreviewShowKfPins(on),
        // v0.9.48 — Hold-Trenner ist nicht mehr draggable (sitzt am End-Trim).
        // Der frühere onHoldTrennerChange-Callback wurde entfernt.
        // v0.9.41 — Trim-Range (Render-Bereich). Persistiert pro Projekt.
        // v0.9.125 — Easing-Picker auf der Cluster-Verbindungslinie:
        // patcht easing-Feld in ALLEN Events des Ziel-Anchors (Cluster) +
        // persistiert die geänderten Events.
        onEasingChange: (targetAnchor, newEasing) => {
          const proj = getActiveProject();
          if (!proj || !proj[_MODKEY]) return;
          const events = proj[_MODKEY].timeline_events || [];
          let changed = 0;
          for (const ev of events) {
            if (ev && Math.abs((ev.anchor || 0) - targetAnchor) < 0.001) {
              ev.easing = newEasing;
              changed++;
            }
          }
          if (changed > 0) {
            _animPushUndo("Easing geändert");
            saveProjectSettings(_MODKEY, { timeline_events: events });
            if (_tlBar && _tlBar.refresh) _tlBar.refresh();
            // Sofort scrubPreview damit man die neue Kurve im Live-Preview sieht
            scrubPreview((_tlBar && _tlBar.getScrubber) ? _tlBar.getScrubber() : 0);
          }
        },
        onTrimChange: (start, end, committed) => {
          // v0.9.66: Undo-Snapshot vor der ersten Mutation in der Drag-Sequenz
          // (Throttle schluckt die restlichen Frames).
          _animPushUndo("Trim verschoben");
          if (committed) {
            saveProjectSettings(_MODKEY, {
              render_start_anchor: +start.toFixed(4),
              render_end_anchor:   +end.toFixed(4),
            });
          }
          // Track-Linie auf den Trim-Bereich kürzen (live, auch während Drag)
          applyTrimToTrackPreview(start, end);
        },
      });
      syncTimelineOverrideUi();
      // v0.8.11 — Track-/Hold-Trenner initial setzen + bei dur/hold-Änderung
      // nachziehen. Bindings für anim-dur/anim-hold bereits weiter oben.
      if (_tlBar && _tlBar.setTrackFraction) {
        // v0.9.59: setTrackFraction nimmt jetzt {ti, tf} entgegen — ti = wo
        // die Anim-Phase beginnt (= Intro-Ende), tf = wo sie endet (= Hold-Anfang).
        _tlBar.setTrackFraction(trackFraction(), introFraction());
        const _onTfChange = () => {
          if (_tlBar && _tlBar.setTrackFraction) _tlBar.setTrackFraction(trackFraction(), introFraction());
          if (_tlBar && _tlBar.getTrim) {
            const tr = _tlBar.getTrim();
            applyTrimToTrackPreview(tr.start, tr.end);
          }
        };
        document.getElementById("anim-dur")?.addEventListener("input", _onTfChange);
        document.getElementById("anim-hold")?.addEventListener("input", _onTfChange);
        document.getElementById("anim-intro")?.addEventListener("input", _onTfChange);
      }
      // v0.9.44 (Marc-Bug-Report): Trim-Range aus aktivem Projekt jetzt
      // anwenden — beim Tab-Wechsel/Re-Mount läuft applyTrimFromSettings
      // im sessionActivate.then() evtl. VOR mountTimelineBar (wenn der
      // Map-Style schon gecacht war und onMapReady-cb synchron feuerte).
      // Daher hier nach _tlBar-Mount erneut anwenden — _tlBar.setTrim hat
      // dann garantiert die richtigen Werte aus _activeProject[_MODKEY].
      applyTrimFromSettings();
      // v0.8.16 — Master-Toggle initial anwenden (Timeline-Bar versteckt
      // wenn keyframes_enabled=false).
      applyKeyframesEnabled();
      // v0.9.17 — Nach Mount + Session-Restore: wenn KFs in der Session
      // vorhanden sind und Editor an ist, ersten Cluster auto-selektieren.
      // Sonst zeigt der Editor leer obwohl die Timeline-Bar voller Marker
      // ist. (v0.9.16 hat das in _animOnProjectChanged eingebaut — das wird
      // aber NUR beim Dropdown-Wechsel gerufen, nicht beim App-Start.)
      autoSelectFirstKfIfNeeded();
    }

    // ── v0.9.74 — Foto-Pins (Phase 1) ───────────────────────────────────────
    // Foto-Liste ist auf Projekt-Ebene (`_activeProject.photos`), geteilt
    // mit Tour-Map. Größen-Slider + Show-Checkbox pro Modul in
    // `animator.photos_size_px` / `animator.photos_show`.
    // Persistiert werden NUR path/lon/lat (+ optional elevation/datetime);
    // Thumbs werden nicht in settings.json gespeichert (zu groß), sondern
    // bei jedem Projekt-Aktivieren über `photos_refresh_thumbs` frisch
    // nachgezogen. Spiegel-Implementation im Tour-Map-Modul (Marc-Pflicht).
    function _animPhotosSizePx() {
      const a = _activeProject?.[_MODKEY];
      if (a && typeof a.photos_size_px === "number") return a.photos_size_px;
      return 48;
    }
    function _animPhotosShow() {
      const a = _activeProject?.[_MODKEY];
      if (a && "photos_show" in a) return !!a.photos_show;
      return true;
    }
    function _animPhotosList() {
      const list = _activeProject && Array.isArray(_activeProject.photos)
        ? _activeProject.photos : [];
      return list;
    }
    function _animPhotosApplyToMap() {
      if (!map || typeof PhotoPins === "undefined") return;
      // v0.9.198 — Fotos sind im Animator jetzt SCHILDER MIT BILD. Die alten
      // Foto-Pins werden hier NICHT mehr gezeichnet (leere Liste = vorhandene
      // Pins werden entfernt). project.photos bleibt nur noch für die Tour-Map.
      const list = [];
      // v0.9.79/80 — Phase-2-Verhalten NUR wenn Track-Coords da sind. Sonst
      // (kein GPX geladen) zeigen wir alle Pins permanent — sonst wäre nichts
      // sichtbar und der User würde nicht verstehen warum.
      const hasTrack = Array.isArray(currentCoords) && currentCoords.length >= 2;
      const opts = { sizePx: _animPhotosSizePx() };
      if (hasTrack) {
        const scrubAnchor = (_tlBar && typeof _tlBar.getScrubber === "function")
          ? _tlBar.getScrubber() : 0;
        opts.coords = currentCoords;
        opts.markerAnchor = _animPhotosMarkerAnchor(scrubAnchor);
        console.log("[anim-photos] applyToMap WITH track, n_photos=" + list.length +
                    ", n_coords=" + currentCoords.length +
                    ", markerAnchor=" + opts.markerAnchor.toFixed(4));
      } else {
        console.log("[anim-photos] applyToMap NO track (currentCoords leer) → " +
                    "alle Pins permanent sichtbar");
      }
      try { PhotoPins.attachToMap(map, list, opts); } catch (e) {
        console.warn("[anim-photos] attachToMap fehlgeschlagen", e);
      }
    }
    // v0.9.79 — Wandelt Timeline-Anchor (0..1 inkl. intro+hold) in
    // Marker-Position-im-Track (0..1) um. Wiederverwendung der bestehenden
    // trackIdxFromTimelineAnchor + Normalisierung.
    function _animPhotosMarkerAnchor(timelineAnchor) {
      if (!currentCoords || currentCoords.length < 2) return 0;
      const n = currentCoords.length;
      const idx = (typeof trackIdxFromTimelineAnchor === "function")
        ? trackIdxFromTimelineAnchor(timelineAnchor) : 0;
      return idx / (n - 1);
    }
    // v0.9.79 — Nur den Filter live setzen (kein voller Re-Attach).
    // Wird von scrubPreview + runTimelinePreview pro Frame gerufen.
    function _animPhotosUpdateMarkerFilter(timelineAnchor) {
      if (!map || typeof PhotoPins === "undefined" || !PhotoPins.setMarkerAnchor) return;
      if (!_animPhotosShow()) return;
      PhotoPins.setMarkerAnchor(map, _animPhotosMarkerAnchor(timelineAnchor));
    }
    function _animPhotosRenderList() {
      const host = document.getElementById("anim-photos-list");
      if (!host || typeof PhotoPins === "undefined") return;
      PhotoPins.renderList(
        host,
        _animPhotosList(),
        (p) => { if (map) PhotoPins.flyTo(map, p); },
        // v0.9.77 — onToggle: visible-Flag pro Foto
        (p, i, visible) => _animPhotosSetVisibility(i, visible)
      );
      // Counter mit „N von M sichtbar"-Pattern wenn welche ausgeblendet sind
      const cnt = document.getElementById("anim-photos-count");
      if (cnt) {
        const list = _animPhotosList();
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
    // v0.9.77 — Per-Foto-Visibility toggle. Mutiert _activeProject.photos
    // direkt + persistiert + re-apply auf Map.
    function _animPhotosSetVisibility(i, visible) {
      const list = _animPhotosList();
      if (i < 0 || i >= list.length) return;
      list[i] = { ...list[i], visible: !!visible };
      _animPhotosSaveListToProject(list);
      _animPhotosApplyToMap();
      _animPhotosRenderList();
    }
    function _animPhotosSetAllVisible(visible) {
      const list = _animPhotosList();
      if (!list.length) return;
      const updated = list.map(p => ({ ...p, visible: !!visible }));
      _animPhotosSaveListToProject(updated);
      _animPhotosApplyToMap();
      _animPhotosRenderList();
    }
    function _animPhotosSaveListToProject(merged) {
      if (!_activeProject) return;
      // PERSIST: path/lon/lat/elevation/datetime + v0.9.77 visible; thumb wegwerfen.
      const stripped = (merged || []).map(p => ({
        path: p.path,
        lon: Number(p.lon),
        lat: Number(p.lat),
        elevation: p.elevation == null ? null : Number(p.elevation),
        datetime: p.datetime || null,
        // visible default true (Backward-Compat) — nur explicit false speichern
        visible: p.visible === false ? false : true,
      }));
      // Memory: behalte Thumbs IN-MEMORY damit Map sofort attachen kann.
      _activeProject.photos = (merged || []).slice();
      // v0.9.78: persistOnly: true — sonst würde saveActiveProjectPatch
      // `_activeProject.photos` auf `stripped` (ohne Thumbs) überschreiben
      // und die nächste attachToMap-Calls könnten keine Images mehr laden.
      try {
        if (typeof saveActiveProjectPatch === "function") {
          saveActiveProjectPatch({ photos: stripped }, { persistOnly: true });
        }
      } catch (e) {
        applog("warn", `[anim-photos] persist fehlgeschlagen: ${e}`);
      }
    }
    async function _animPhotosLoadFromPaths(pathsOrFolder) {
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
          toast(t("photos.toast_loaded", "%n Fotos geladen.")
                .replace("%n", photos.length), "ok", 2500);
        }
        const merged = PhotoPins.dedupePaths(_animPhotosList(), photos);
        _animPhotosSaveListToProject(merged);
        _animPhotosApplyToMap();
        _animPhotosRenderList();
      } catch (e) {
        applog("error", `[anim-photos] load fehlgeschlagen: ${e}`);
        toast(t("photos.toast_load_error", "Fotos konnten nicht geladen werden."), "err", 3500);
      }
    }
    async function _animPhotosLoadFromGeotagger() {
      if (!window.pywebview?.api?.photos_from_geotagger) return;
      try {
        const res = await window.pywebview.api.photos_from_geotagger();
        const photos = (res && res.photos) || [];
        if (photos.length === 0) {
          toast(t("photos.toast_gtg_empty", "Keine Geotagger-Fotos mit GPS gefunden."), "warn", 3500);
          return;
        }
        const merged = PhotoPins.dedupePaths(_animPhotosList(), photos);
        _animPhotosSaveListToProject(merged);
        _animPhotosApplyToMap();
        _animPhotosRenderList();
        toast(t("photos.toast_loaded", "%n Fotos geladen.")
              .replace("%n", photos.length), "ok", 2500);
      } catch (e) {
        applog("error", `[anim-photos] from-geotagger fehlgeschlagen: ${e}`);
      }
    }
    function _animPhotosClearAll() {
      _animPhotosSaveListToProject([]);
      _animPhotosApplyToMap();
      _animPhotosRenderList();
    }
    async function _animPhotosRefreshThumbsAfterRestore() {
      // Nach Projekt-Aktivieren: persistierte Pfade haben kein `thumb` mehr.
      // Diese Funktion holt sie nach + applied auf die Map.
      const persisted = _animPhotosList();
      if (!persisted.length) {
        _animPhotosApplyToMap();
        _animPhotosRenderList();
        return;
      }
      const paths = persisted.map(p => p.path).filter(Boolean);
      try {
        const res = await window.pywebview.api.photos_refresh_thumbs(paths);
        const fresh = (res && res.photos) || [];
        // Nur Thumb-Felder mergen — Position-Updates aus EXIF lassen wir
        // gewinnen, falls sich GPS zwischen Speichern und Reload geändert hat.
        const byPath = new Map(fresh.map(p => [p.path, p]));
        const merged = persisted.map(p => {
          const fr = byPath.get(p.path);
          if (!fr) return p;
          return { ...p, ...fr };
        });
        // In-Memory updaten (wir persistieren NICHT nochmal — keine Änderung
        // an den persistierten Werten, nur Thumb-Anreicherung).
        if (_activeProject) _activeProject.photos = merged;
      } catch (e) {
        applog("warn", `[anim-photos] refresh-thumbs fehlgeschlagen: ${e}`);
      }
      _animPhotosApplyToMap();
      _animPhotosRenderList();
    }
    // ── v0.9.171 — Wegpunkt-Schilder ───────────────────────────────────────
    // Analog zu den Foto-Pins, aber als HTML-Marker (Sprechblase) mit Text.
    // Erscheinen sobald der Track-Marker den Punkt erreicht (track_anchor),
    // Billboard + skaliert mit Zoom. Daten: _activeProject.signs = [{lat,lon,text}].
    let _animSignPlaceMode = false;
    let _animSignPlaceFree = false;   // v0.9.179 — freie Platzierung (nicht auf Track rasten)
    let _animSignForceIdx = -1;       // v0.9.180 — Schild, das beim Bearbeiten IMMER sichtbar bleibt
    let _animSignsPreviewAll = false; // v0.9.188 — Vorschau: alle Schilder zeigen (nur Preview, nicht Render)
    // v0.9.171b — Symbol-Layer statt HTML-Marker (driftfrei, GPU-gebunden,
    // skaliert nativ mit Zoom via icon-size). Jedes Schild als Canvas-Bild.
    const _ANIM_SIGNS_SRC = "anim-signs-src";
    const _ANIM_SIGNS_LYR = "anim-signs-lyr";
    let _animSignImgIds = [];
    let _animSignImgVer = 0;     // (Legacy, ungenutzt seit v0.9.255 DOM-Marker)
    // v0.9.255 — Schilder sind jetzt echte HTML-Marker (mapboxgl/maplibregl.Marker mit
    // DOM-Element, gestylt via sign_dom.js) statt gerasterter Symbol-Layer-Icons.
    // Größe/Ecken/Rahmen/Schatten/Text = reine CSS-Updates am stehenden Element → kein
    // Flackern. Gleiche Engine wie der Render → WYSIWYG. _animSignMarkers[fi] = {marker, wrap, zoomScale}.
    let _animSignMarkers = [];
    let _animSignZoomHooked = false;   // map.on("zoom") nur einmal binden
    let _animSignLastAnchorM = 0;      // letzter Marker-Anchor (für Zoom-Reapply)
    // v0.9.256 — HYBRID: Beim EDITIEREN (Editor offen) rendern Schilder als DOM-Marker
    // (flackerfrei, Kamera steht → kein „Schwimmen"). Bei Probelauf/Export/Ruhe rendern
    // sie als GPU-Symbol-Layer (flüssig wie die Foto-Pins, kein Schwimmen). Umgeschaltet
    // wird in _animSignsOpenEditor (→DOM) / _animSignsCloseEditor + beginPreview (→GPU).
    let _animSignEditMode = false;
    let _animSignMoveIdx = -1;   // >=0 = bestehendes Schild verschieben statt neues setzen
    function _animSignsSizePx() {
      const a = _activeProject?.[_MODKEY];
      if (a && typeof a.signs_size_px === "number") return a.signs_size_px;
      return 40;
    }
    function _animSignsShow() {
      const a = _activeProject?.[_MODKEY];
      if (a && "signs_show" in a) return !!a.signs_show;
      return true;
    }
    function _animSignsStyle() {
      const a = _activeProject?.[_MODKEY];
      return (a && a.signs_style) || "callout";
    }
    function _animSignsColor() {
      const a = _activeProject?.[_MODKEY];
      return (a && a.signs_color) || "#ff6b35";
    }
    function _animSignsList() {
      return (_activeProject && Array.isArray(_activeProject[_SIGNS_KEY])) ? _activeProject[_SIGNS_KEY] : [];
    }
    // v0.9.179 — Schild voll customizable. Defaults für alle Eigenschaften.
    const _SIGN_DEFAULTS = {
      style: "callout", color: "#ff6b35", size: 40,
      bg: "auto", textColor: "auto", font: "system", weight: 700, italic: false, align: "center",
      radius: 9, padding: 7, opacity: 1,
      borderColor: "none", borderWidth: 0,
      decoScale: 0.5,        // v0.9.256 — Länge der Stangen (Banner/Wegweiser) als Faktor der Box-Höhe
      shadow: false, shadowColor: "#000000", shadowBlur: 8, shadowStrength: 0.55,
      zoomScale: true, before: 0, after: 0, entry: "none",
      alwaysVisible: false,  // v0.9.188 — ganze Zeit sichtbar (kein Timing-Fenster)
      anchorMode: "track",   // track = Anker rastet, free = freie Position
      imageSrc: "",          // v0.9.189 — optionales Bild; Schild MIT Bild = Foto-Karte (Text = Bildunterschrift)
      imageSize: 60,         // v0.9.190 — Bildbreite separat vom Schrift-Größe-Slider (20..160 → ×5 px)
      visible: true,         // v0.9.198 — pro Schild/Foto an/aus (Checkbox in der Liste)
    };
    // Merkt sich die zuletzt benutzten Stil-/Verhaltens-Eigenschaften fürs nächste Schild.
    let _animSignLast = { ...(_SIGN_DEFAULTS) };
    let _animSignMetas = [];   // pro Schild { a_show, a_hide, fade, pop } für die Frame-Logik
    function _animSignsDuration() {
      const a = _activeProject?.[_MODKEY];
      return (a && Number(a.duration_s)) || 12;
    }
    function _animSignNormalize(s) {
      const o = { ...(_SIGN_DEFAULTS), ...(s || {}) };
      o.lat = Number(o.lat); o.lon = Number(o.lon); o.text = String(o.text || "");
      o.size = Number(o.size) || 40;
      o.weight = Number(o.weight) || 700;
      o.radius = Number(o.radius); o.padding = Number(o.padding);
      o.opacity = Math.max(0, Math.min(1, Number(o.opacity)));
      o.borderWidth = Number(o.borderWidth) || 0;
      o.decoScale = (o.decoScale == null || isNaN(Number(o.decoScale))) ? 0.5 : Math.max(0.1, Math.min(2, Number(o.decoScale)));
      o.shadowBlur = Number(o.shadowBlur);
      o.shadowStrength = (o.shadowStrength == null || isNaN(Number(o.shadowStrength)))
        ? 0.55 : Math.max(0.05, Math.min(1, Number(o.shadowStrength)));
      o.before = Number(o.before) || 0; o.after = Number(o.after) || 0;
      o.italic = !!o.italic; o.shadow = !!o.shadow; o.zoomScale = !!o.zoomScale;
      o.alwaysVisible = !!o.alwaysVisible;
      o.imageSrc = String(o.imageSrc || "");
      o.imageSize = Number(o.imageSize) || 60;
      o.visible = (o.visible === false) ? false : true;   // v0.9.198 — Default sichtbar
      return o;
    }
    function _animSignsSave(list) {
      if (!_activeProject) return;
      // In-Memory: normalisiert, BEHÄLT transiente Bild-Felder (`_imgEl`/`thumb`),
      // damit Bilder nicht bei jedem Save neu geladen werden müssen.
      const inMem = (list || []).map(_animSignNormalize);
      // v0.9.195 — das non-enumerable `_imgEl` überlebt den normalize-Spread nicht,
      // daher vom Original-Objekt zurückhängen (sonst lädt das Bild nach jedem Save neu).
      inMem.forEach((m, i) => { const o = (list || [])[i]; if (o && o._imgEl) _animSetImgEl(m, o._imgEl); });
      _activeProject[_SIGNS_KEY] = inMem.slice();
      // v0.9.193 — Persistierte Kopie: `_imgEl` (HTMLImage, nicht serialisierbar)
      // und Lade-Flags raus, ABER den `thumb` (data-URL) MITSPEICHERN. Grund:
      // das Neu-Erzeugen via Bridge beim Reload hakte in der WebView → „schwarzes
      // Loch". Mit gespeichertem Thumb ist Reload identisch zum Erst-Hinzufügen
      // (funktioniert zuverlässig). ~50 KB pro Bild-Schild, für eine Handvoll ok.
      const persist = inMem.map(s => { const o = { ...s }; delete o._imgEl; delete o._imgLoading; delete o._imgFailed; delete o._imgMissing; delete o._imgChecked; delete o._imgBroken; return o; });
      try {
        if (typeof saveActiveProjectPatch === "function") saveActiveProjectPatch({ [_SIGNS_KEY]: persist });
      } catch (_) {}
    }
    // Nächster Track-Index zu einer Klick-Position (rastet das Schild auf den Track).
    function _animSignsNearestIdx(lng, lat) {
      if (!Array.isArray(currentCoords) || currentCoords.length < 1) return -1;
      const clat = Math.cos(lat * Math.PI / 180);
      let best = -1, bestD = Infinity;
      for (let i = 0; i < currentCoords.length; i++) {
        const c = currentCoords[i];
        const dx = (lng - c[0]) * clat, dy = lat - c[1];
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = i; }
      }
      return best;
    }
    function _animSignAnchorForLngLat(lng, lat) {
      const n = Array.isArray(currentCoords) ? currentCoords.length : 0;
      if (n < 2) return 0;
      const idx = _animSignsNearestIdx(lng, lat);
      return idx < 0 ? 0 : idx / (n - 1);
    }
    // Schild als Canvas-Bild zeichnen → ImageData. Nutzt die GEMEINSAME Engine
    // window.__rzDrawSign (ui/js/sign_draw.js) — identisch zum Render (kein
    // doppelt gepflegter Klon mehr). `s` = volles Schild-Objekt.
    // v0.9.195 — Das geladene HTMLImageElement NON-ENUMERABLE an das Schild hängen.
    // Sonst wird es beim Speichern (JSON / Spread) zu `{src:"data:..."}` serialisiert
    // → beim Reload truthy aber kein echtes Bild → drawImage scheitert → dunkle Box.
    // Non-enumerable: von JSON.stringify, {...spread} und Object.entries ignoriert.
    function _animSetImgEl(s, im) {
      try {
        Object.defineProperty(s, "_imgEl", { value: im, enumerable: false, writable: true, configurable: true });
      } catch (_) { s._imgEl = im; }
    }
    // Echtes, geladenes Bild? (kein leeres/0px-Image, kein serialisierter {src}-Rest)
    function _animSignHasImg(s) {
      return !!(s && s._imgEl && s._imgEl.naturalWidth > 0);
    }
    function _animSignDrawImageData(s) {
      if (!window.__rzDrawSign) return null;
      const o = _animSignNormalize(s);
      // v0.9.196 — nur ein ECHTES, geladenes Bild übergeben (kein persistierter
      // {src}-Pseudo-Rest, kein 0px-Bild) → sonst zeichnet rzDrawSign eine dunkle Box.
      if (s._imgEl && s._imgEl.naturalWidth > 0) o.image = s._imgEl;
      return window.__rzDrawSign(o);
    }
    // v0.9.189 — Bild eines Schilds (data-URL-Thumb → HTMLImageElement) sicher laden.
    // Cache als `s._imgEl`/`s.thumb`. Thumb via Bridge nachladen, falls nur Pfad da.
    function _animSignEnsureImage(s) {
      return new Promise((resolve) => {
        if (!s || !s.imageSrc) { resolve(false); return; }
        if (_animSignHasImg(s)) { resolve(true); return; }
        if (s._imgLoading) { resolve(false); return; }
        s._imgLoading = true;
        // v0.9.194 — Erfolg NUR wenn das Bild wirklich Pixel hat (naturalWidth>0).
        // Vorher wurde ein kaputter/leerer Thumb (onload feuert, aber naturalWidth=0)
        // als „geladen" akzeptiert → dunkle Box („schwarzes Loch"). Jetzt: kaputt →
        // EINMAL via Bridge frisch erzeugen; bleibt's kaputt → als fehlerhaft markieren.
        const fail = () => { s._imgLoading = false; s._imgFailed = true; s._imgBroken = true; resolve(false); };
        const tryLoad = (dataUrl, allowRegen) => {
          if (!dataUrl) { allowRegen ? regen() : fail(); return; }
          const im = new Image();
          im.onload = () => {
            if (im.naturalWidth > 0) {
              _animSetImgEl(s, im);   // non-enumerable → wird NICHT persistiert
              s._imgLoading = false; s._imgFailed = false; s._imgBroken = false;
              resolve(true);
            } else { allowRegen ? regen() : fail(); }
          };
          im.onerror = () => { allowRegen ? regen() : fail(); };
          im.src = dataUrl;
        };
        const regen = () => {
          try {
            api().sign_image_thumb(s.imageSrc).then((r) => {
              if (r && r.ok && r.thumb) { s.thumb = r.thumb; tryLoad(r.thumb, false); }
              else { fail(); }
            }).catch(() => { fail(); });
          } catch (_) { fail(); }
        };
        // Gespeicherten Thumb zuerst probieren (schnell), bei Defekt frisch erzeugen.
        if (s.thumb) { tryLoad(s.thumb, true); }
        else { regen(); }
      });
    }
    function _animSignsDetach() {
      // DOM-Marker entfernen …
      (_animSignMarkers || []).forEach(m => { try { if (m && m.marker) m.marker.remove(); } catch (_) {} });
      _animSignMarkers = [];
      // … und GPU-Layer + Icon-Bilder.
      if (map) {
        try { if (map.getLayer(_ANIM_SIGNS_LYR)) map.removeLayer(_ANIM_SIGNS_LYR); } catch (_) {}
        try { if (map.getSource(_ANIM_SIGNS_SRC)) map.removeSource(_ANIM_SIGNS_SRC); } catch (_) {}
        (_animSignImgIds || []).forEach(id => { try { if (map.hasImage(id)) map.removeImage(id); } catch (_) {} });
      }
      _animSignImgIds = [];
    }
    function _animSignsAttachToMap() {
      if (!map) return;
      _animSignsDetach();
      _animSignMetas = [];
      if (!_animSignsShow()) return;
      const allSigns = _animSignsList();
      const list = allSigns.filter(s => ((s.text || "").trim() || s.imageSrc) && s.visible !== false);
      if (!list.length) return;
      // Existenz der Original-Bilddatei prüfen (einmal pro Schild) für die Liste-Warnung.
      list.filter(s => s.imageSrc && !s._imgChecked).forEach(s => {
        s._imgChecked = true;
        try {
          api().sign_image_exists(s.imageSrc).then(r => {
            const missing = !(r && r.exists);
            if (missing !== !!s._imgMissing) {
              s._imgMissing = missing;
              _animSignsRenderList();
              if (missing) toast(t("signs.image_missing", "⚠ Bild nicht mehr gefunden") + ": " + (s.imageSrc.split("/").pop()), "error");
            }
          }).catch(() => {});
        } catch (_) {}
      });
      // v0.9.256 — HYBRID-Dispatch: Editor offen → DOM-Marker (flackerfrei), sonst →
      // GPU-Symbol-Layer (flüssig, kein Schwimmen).
      if (_animSignEditMode) _animSignsAttachDOM(allSigns, list);
      else _animSignsAttachGPU(allSigns, list);
      const a = (_tlBar && typeof _tlBar.getScrubber === "function") ? _tlBar.getScrubber() : 0;
      _animSignsUpdateAtAnchor(a);
    }
    // ── DOM-Marker (Editier-Modus): flackerfreies Live-Update am stehenden Element ──
    function _animSignsAttachDOM(allSigns, list) {
      const dur = _animSignsDuration();
      const MarkerCls = (typeof mapLib === "function" ? mapLib() : (window.mapboxgl || window.maplibregl)).Marker;
      list.forEach((s) => {
        const fi = allSigns.indexOf(s);
        const sn = _animSignNormalize(s);
        let imageUrl = (s._imgEl && s._imgEl.src) || s.thumb || "";
        if (s.imageSrc && !imageUrl) {
          try { _animSignEnsureImage(s).then(() => { try { _animSignsUpdateInPlace(); _animSignsRenderList(); } catch (_) {} }); } catch (_) {}
        }
        let wrap;
        try { wrap = window.__rzSignDomBuild(); window.__rzSignDomStyle(wrap, sn, { imageUrl }); } catch (_) { return; }
        wrap.addEventListener("click", (ev) => {
          if (_animSignPlaceMode) return;
          try { ev.stopPropagation(); } catch (_) {}
          _animSignsOpenEditor(fi);
        });
        let marker;
        try { marker = new MarkerCls({ element: wrap, anchor: "bottom" }).setLngLat([Number(sn.lon), Number(sn.lat)]).addTo(map); } catch (_) { return; }
        // v0.9.256 — jetzt im DOM → Box-Höhe ist messbar → einmal nach-stylen, damit die
        // Banner-/Wegweiser-Pfosten proportional zur echten Box-Höhe sitzen.
        try { window.__rzSignDomStyle(wrap, sn, { imageUrl }); } catch (_) {}
        const trackAnchor = (typeof sn.timeAnchor === "number") ? sn.timeAnchor : _animSignAnchorForLngLat(Number(sn.lon), Number(sn.lat));
        _animSignMetas[fi] = window.__rzSignMeta ? window.__rzSignMeta({ ...sn, track_anchor: trackAnchor }, dur) : { a_show: trackAnchor, a_hide: 2, fade: 0, pop: 0 };
        _animSignMarkers[fi] = { marker, wrap, zoomScale: !!sn.zoomScale };
      });
      if (!_animSignZoomHooked) {
        _animSignZoomHooked = true;
        try { map.on("zoom", () => { if (_animSignEditMode) _animSignsApplyMarkerAnchor(_animSignLastAnchorM); }); } catch (_) {}
      }
    }
    // ── GPU-Symbol-Layer (Probelauf/Export/Ruhe): flüssig wie die Foto-Pins ──
    function _animSignsAttachGPU(allSigns, list) {
      const needImg = list.filter(s => s.imageSrc && !_animSignHasImg(s) && !s._imgLoading && !s._imgFailed);
      if (needImg.length) {
        Promise.all(needImg.map(_animSignEnsureImage)).then(() => {
          if (map && map.getContainer && !_animSignEditMode) { _animSignsAttachToMap(); _animSignsRenderList(); }
        });
      }
      const dur = _animSignsDuration();
      const features = [];
      list.forEach((s) => {
        if (s.imageSrc && !_animSignHasImg(s) && !(s.text || "").trim()) return;
        const fi = allSigns.indexOf(s);
        const sn = _animSignNormalize(s);
        if (_animSignHasImg(s)) _animSetImgEl(sn, s._imgEl);
        const id = "sign-img-" + fi;
        try {
          const img = _animSignDrawImageData(sn);
          if (!img) return;
          if (map.hasImage(id)) map.removeImage(id);
          map.addImage(id, img.data, { pixelRatio: img.dpr });
          _animSignImgIds.push(id);
        } catch (_) { return; }
        const trackAnchor = (typeof sn.timeAnchor === "number") ? sn.timeAnchor : _animSignAnchorForLngLat(Number(sn.lon), Number(sn.lat));
        const meta = window.__rzSignMeta ? window.__rzSignMeta({ ...sn, track_anchor: trackAnchor }, dur) : { a_show: trackAnchor, a_hide: 2, fade: 0, pop: 0 };
        _animSignMetas[fi] = meta;
        features.push({ type: "Feature", id: fi, properties: { imgId: id, signIdx: fi, zoomScale: !!sn.zoomScale, a_show: meta.a_show, a_hide: meta.a_hide }, geometry: { type: "Point", coordinates: [Number(sn.lon), Number(sn.lat)] } });
      });
      try {
        map.addSource(_ANIM_SIGNS_SRC, { type: "geojson", data: { type: "FeatureCollection", features } });
        map.addLayer({
          id: _ANIM_SIGNS_LYR, type: "symbol", source: _ANIM_SIGNS_SRC,
          filter: ["all", ["<=", ["get", "a_show"], -1], [">=", ["get", "a_hide"], -1]],
          layout: {
            "icon-image": ["get", "imgId"],
            "icon-size": ["interpolate", ["linear"], ["zoom"],
              8, ["case", ["==", ["get", "zoomScale"], true], 0.5, 1.0],
              12, ["case", ["==", ["get", "zoomScale"], true], 0.8, 1.0],
              16, ["case", ["==", ["get", "zoomScale"], true], 1.5, 1.0],
              20, ["case", ["==", ["get", "zoomScale"], true], 2.4, 1.0]],
            "icon-anchor": "bottom",
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "icon-pitch-alignment": "viewport",
            "icon-rotation-alignment": "viewport",
          },
          paint: { "icon-opacity": ["coalesce", ["feature-state", "op"], 1] },
        });
      } catch (_) {}
    }
    // v0.9.254 (Nutzer-Bug #1/#2) — Live-Update OHNE Layer/Source-Neuaufbau. Beim
    // Editieren (Bildgröße/Ecken/Rahmen/Schatten-Slider) wurde bei JEDEM input-Event
    // _animSignsAttachToMap() gerufen → Layer + Source + alle Icon-Bilder komplett
    // abgerissen und neu gebaut → das Symbol flackerte. Hier bleiben Layer + Source
    // stehen; nur die betroffenen Icon-Bilder werden neu gezeichnet und die Source-
    // Daten (Position/Timing) per setData aktualisiert. icon-allow-overlap +
    // icon-ignore-placement sind gesetzt → kein Platzierungs-Fade → kein Flackern.
    // Gibt false zurück wenn die Struktur (noch) nicht da ist → Caller macht den
    // vollen Attach. Geeignet NUR für Aussehen/Timing-Änderungen bestehender Schilder
    // (kein Hinzufügen/Entfernen/Sichtbarkeit — die rufen weiter den vollen Attach).
    // v0.9.255 — Live-Update OHNE Neu-Aufbau: jeden bestehenden Marker einfach neu
    // stylen (CSS/Inhalt) und ggf. die Position aktualisieren. Da das Element STEHEN
    // bleibt und nur seine CSS-Werte ändern, gibt es KEIN Flackern — egal ob Größe,
    // Ecken, Rahmen, Schatten oder Text geändert wird. Gibt false zurück, wenn die
    // Marker-Struktur nicht zur aktuellen Liste passt (dann macht der Caller den vollen
    // Attach — z.B. nach Hinzufügen/Löschen/Sichtbarkeit).
    // Live-Update beim Editieren (NUR DOM-Modus): jeden Marker neu stylen (CSS/Inhalt)
    // → kein Flackern, da das Element steht. Im GPU-Modus false → Caller macht Attach.
    function _animSignsUpdateInPlace() {
      if (!map || !_animSignEditMode) return false;
      const allSigns = _animSignsList();
      const list = allSigns.filter(s => ((s.text || "").trim() || s.imageSrc) && s.visible !== false);
      if (!list.length) return false;
      const dur = _animSignsDuration();
      let ok = true;
      list.forEach((s) => {
        const fi = allSigns.indexOf(s);
        const mk = _animSignMarkers[fi];
        if (!mk || !mk.wrap || !mk.marker) { ok = false; return; }
        const sn = _animSignNormalize(s);
        let imageUrl = (s._imgEl && s._imgEl.src) || s.thumb || "";
        if (s.imageSrc && !imageUrl) { try { _animSignEnsureImage(s).then(() => { try { _animSignsUpdateInPlace(); } catch (_) {} }); } catch (_) {} }
        try { window.__rzSignDomStyle(mk.wrap, sn, { imageUrl }); } catch (_) {}
        try { mk.marker.setLngLat([Number(sn.lon), Number(sn.lat)]); } catch (_) {}
        mk.zoomScale = !!sn.zoomScale;
        const trackAnchor = (typeof sn.timeAnchor === "number") ? sn.timeAnchor : _animSignAnchorForLngLat(Number(sn.lon), Number(sn.lat));
        _animSignMetas[fi] = window.__rzSignMeta ? window.__rzSignMeta({ ...sn, track_anchor: trackAnchor }, dur) : { a_show: trackAnchor, a_hide: 2, fade: 0, pop: 0 };
      });
      if (!ok) return false;
      const a = (_tlBar && typeof _tlBar.getScrubber === "function") ? _tlBar.getScrubber() : 0;
      _animSignsUpdateAtAnchor(a);
      return true;
    }
    // Pro Frame: Sichtbarkeit/Fade — Dispatch nach Render-Modus.
    function _animSignsApplyMarkerAnchor(markerAnchor) {
      const M = Number(markerAnchor);
      _animSignLastAnchorM = M;
      if (_animSignEditMode) _animSignsApplyDOM(M);
      else _animSignsApplyGPU(M);
    }
    // GPU-Modus: Sichtbarkeits-Fenster via setFilter + Fade via feature-state.
    function _animSignsApplyGPU(M) {
      if (!map || !map.getLayer(_ANIM_SIGNS_LYR)) return;
      if (_animSignsPreviewAll) {
        try {
          map.setFilter(_ANIM_SIGNS_LYR, ["all"]);
          for (let i = 0; i < _animSignMetas.length; i++) { try { map.setFeatureState({ source: _ANIM_SIGNS_SRC, id: i }, { op: 1 }); } catch (_) {} }
        } catch (_) {}
        return;
      }
      if (window.__rzSignFrame) window.__rzSignFrame(map, _ANIM_SIGNS_LYR, _ANIM_SIGNS_SRC, _animSignMetas, M);
    }
    // DOM-Modus: pro Marker Sichtbarkeit/Opacity/Zoom-Scale, Change-Detection gegen Jank.
    function _animSignsApplyDOM(M) {
      let anyZoomScale = false;
      for (let i = 0; i < _animSignMarkers.length; i++) { if (_animSignMarkers[i] && _animSignMarkers[i].zoomScale) { anyZoomScale = true; break; } }
      const zoom = (anyZoomScale && map && map.getZoom) ? map.getZoom() : 12;
      _animSignMarkers.forEach((mk, fi) => {
        if (!mk || !mk.wrap) return;
        const meta = _animSignMetas[fi] || { a_show: -1, a_hide: 2, fade: 0 };
        let op = 1, visible;
        if (_animSignsPreviewAll || _animSignForceIdx === fi) { visible = true; op = 1; }
        else {
          visible = (M >= meta.a_show && M <= meta.a_hide);
          if (visible && meta.fade > 0) op = Math.max(0, Math.min(1, Math.min((M - meta.a_show) / meta.fade, (meta.a_hide - M) / meta.fade, 1)));
        }
        const wrap = mk.wrap;
        const dispVal = visible ? "" : "none";
        if (mk._lastDisp !== dispVal) { wrap.style.display = dispVal; mk._lastDisp = dispVal; }
        if (!visible) return;
        const opR = Math.round(op * 100) / 100;
        if (mk._lastOp !== opR) { wrap.style.opacity = String(opR); mk._lastOp = opR; }
        if (mk.zoomScale) {
          const card = wrap.__card;
          if (card) {
            const sc = Math.round((window.__rzSignDomZoomScale ? window.__rzSignDomZoomScale(zoom, true) : 1) * 1000) / 1000;
            if (mk._lastScale !== sc) { card.style.transform = (sc !== 1) ? ("scale(" + sc + ")") : ""; mk._lastScale = sc; }
          }
        }
      });
    }
    // v0.9.204 — Schild-spezifischer Anker: im Intro NEGATIV unter den
    // trim_start laufen lassen (statt einzufrieren), damit ein Schild-Vorlauf
    // (`before`) ins Intro reicht und über die letzte Intro-Sekunde einblendet.
    // Spiegelt den Render (animator.py _sign_intro_anchor). Fotos nutzen
    // weiterhin _animPhotosMarkerAnchor (eingefroren) — nur Schilder erweitern.
    // Rate introSec/animSec = Einheit von rzSignSecToAnchor → before=N s blendet
    // N s vor Track-Start ein. Hold/Anim bleiben unverändert (= base).
    function _animSignsAnchorFromTimeline(timelineAnchor) {
      const base = _animPhotosMarkerAnchor(timelineAnchor);
      const ti = (typeof introFraction === "function") ? introFraction() : 0;
      if (ti <= 0 || timelineAnchor >= ti) return base;  // kein Intro / außerhalb
      const introSec = parseFloat(document.getElementById("anim-intro")?.value) || 0;
      const animSec  = parseFloat(document.getElementById("anim-dur")?.value) || 12;
      if (introSec <= 0 || animSec <= 0) return base;
      const introProgress = Math.max(0, Math.min(1, timelineAnchor / Math.max(0.0001, ti)));
      // base = trimA-Anker (Marker am Track-Start). Im Intro nach unten ziehen:
      return base - (1 - introProgress) * (introSec / animSec);
    }
    // Aufruf aus scrubPreview mit Timeline-Anchor (inkl. intro+hold) → umrechnen.
    function _animSignsUpdateAtAnchor(timelineAnchor) {
      _animSignsApplyMarkerAnchor(_animSignsAnchorFromTimeline(timelineAnchor));
    }
    let _animSignDragFrom = -1;   // v0.9.198 — Drag-Reorder Quell-Index
    function _animSignsRenderList() {
      const host = document.getElementById("anim-signs-list");
      if (!host) return;
      host.innerHTML = "";
      const list = _animSignsList();
      list.forEach((s, i) => {
        const off = (s.visible === false);
        const row = el("div", { class: "sign-row" + (off ? " sign-row-off" : ""), draggable: "true", "data-idx": String(i) });
        // ⠿ Drag-Handle
        const handle = el("div", { class: "sign-row-handle", title: t("signs.drag", "Ziehen zum Sortieren") }, "⠿");
        // ☑ Sichtbar-Checkbox
        const chk = el("input", { type: "checkbox", class: "sign-row-vis", title: t("signs.toggle_visible", "Anzeigen / ausblenden") });
        chk.checked = !off;
        chk.addEventListener("click", (ev) => ev.stopPropagation());
        chk.addEventListener("change", () => _animSignsSetVisible(i, chk.checked));
        // Thumb (bei Bild) oder 🚩-Icon
        let media;
        if (s.imageSrc) {
          const src = (s._imgEl && s._imgEl.src) || s.thumb || "";
          media = el("div", { class: "sign-row-thumb" });
          if (src) media.style.backgroundImage = `url("${src}")`; else media.textContent = "🖼";
        } else {
          media = el("div", { class: "sign-row-ico" }, "🚩");
        }
        // Label
        let _lbl = (s.text || "").trim()
          ? s.text
          : (s.imageSrc ? (s.imageSrc.split("/").pop() || t("signs.grp.image", "Bild")) : "—");
        const _err = !!(s._imgMissing || s._imgBroken);
        if (_err) _lbl = "⚠ " + _lbl;
        const _errTitle = s._imgMissing
          ? t("signs.image_missing", "⚠ Bild nicht mehr gefunden") + ": " + s.imageSrc
          : t("signs.image_broken", "⚠ Bild konnte nicht geladen werden") + ": " + s.imageSrc;
        const txt = el("div", {
          class: "sign-row-text" + (_err ? " sign-row-error" : ""),
          title: _err ? _errTitle : t("signs.row_open", "Bearbeiten"),
        }, _lbl);
        txt.addEventListener("click", () => _animSignsOpenEditor(i));
        // ✎ Bearbeiten
        const edit = el("button", { type: "button", class: "sign-row-edit", title: t("signs.edit", "Bearbeiten") }, "✎");
        edit.addEventListener("click", (ev) => { ev.stopPropagation(); _animSignsOpenEditor(i); });
        // ✕ Löschen
        const del = el("button", { type: "button", class: "sign-row-del", title: t("signs.delete", "Löschen") }, "✕");
        del.addEventListener("click", (ev) => { ev.stopPropagation(); _animSignsDelete(i); });
        row.appendChild(handle); row.appendChild(chk); row.appendChild(media);
        row.appendChild(txt); row.appendChild(edit); row.appendChild(del);
        // Drag-Reorder
        row.addEventListener("dragstart", (ev) => {
          _animSignDragFrom = i; row.classList.add("dragging");
          try { ev.dataTransfer.effectAllowed = "move"; ev.dataTransfer.setData("text/plain", String(i)); } catch (_) {}
        });
        row.addEventListener("dragend", () => {
          row.classList.remove("dragging");
          host.querySelectorAll(".drag-over").forEach(r => r.classList.remove("drag-over"));
        });
        row.addEventListener("dragover", (ev) => { ev.preventDefault(); try { ev.dataTransfer.dropEffect = "move"; } catch (_) {} row.classList.add("drag-over"); });
        row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
        row.addEventListener("drop", (ev) => { ev.preventDefault(); row.classList.remove("drag-over"); _animSignsReorder(_animSignDragFrom, i); });
        host.appendChild(row);
      });
      const cnt = document.getElementById("anim-signs-count");
      if (cnt) cnt.textContent = list.length
        ? (list.length === 1 ? t("signs.count_one", "1 Eintrag") : t("signs.count_other", "%d Einträge").replace("%d", list.length))
        : "";
    }
    // v0.9.198 — Sichtbarkeit / Reihenfolge / Massenschalter
    function _animSignsSetVisible(idx, on) {
      const l = _animSignsList().slice();
      if (idx < 0 || idx >= l.length) return;
      l[idx] = { ...l[idx], visible: !!on };
      _animSignsSave(l); _animSignsAttachToMap(); _animSignsRenderList();
    }
    function _animSignsSetAllVisible(on) {
      const l = _animSignsList().map(s => ({ ...s, visible: !!on }));
      if (!l.length) return;
      _animSignsSave(l); _animSignsAttachToMap(); _animSignsRenderList();
    }
    function _animSignsReorder(from, to) {
      if (from == null || from < 0 || to < 0 || from === to) return;
      const l = _animSignsList().slice();
      if (from >= l.length || to >= l.length) return;
      const [moved] = l.splice(from, 1);
      l.splice(to, 0, moved);
      _animSignsSave(l); _animSignsAttachToMap(); _animSignsRenderList();
      _animSignDragFrom = -1;
    }
    // Schild auf den nächsten Track-Punkt zu lng/lat setzen (Index zurück).
    function _animSignSnap(lng, lat) {
      const idx = _animSignsNearestIdx(lng, lat);
      if (idx >= 0 && Array.isArray(currentCoords) && currentCoords[idx]) {
        return { lon: currentCoords[idx][0], lat: currentCoords[idx][1] };
      }
      return { lon: lng, lat: lat };
    }
    // Neues Schild setzen (erbt die zuletzt benutzten Eigenschaften) + Editor öffnen.
    // free=true → an die geklickte Stelle (frei, z.B. Sehenswürdigkeit); Timing-Anker
    // bleibt der nächste Track-Punkt. free=false → rastet auf den Track.
    function _animSignsAddNew(lng, lat, free) {
      const p = free ? { lon: lng, lat: lat } : _animSignSnap(lng, lat);
      const list = _animSignsList().slice();
      list.push({ ...(_animSignLast), lat: p.lat, lon: p.lon, text: "",
        anchorMode: free ? "free" : "track" });
      _animSignsSave(list);
      _animSignsAttachToMap();
      _animSignsRenderList();
      _animSignsOpenEditor(list.length - 1, true);
    }
    function _animSignsDelete(i) {
      const list = _animSignsList().slice();
      if (i < 0 || i >= list.length) return;
      list.splice(i, 1);
      _animSignsSave(list);
      _animSignsAttachToMap();
      _animSignsRenderList();
    }
    function _animSignsClearAll() {
      if (!_animSignsList().length) return;
      _animSignsSave([]);
      _animSignsAttachToMap();
      _animSignsRenderList();
    }
    // v0.9.175 — Schild-Editor als SCHWEBENDES Panel neben dem Schild (KEIN
    // Modal mit Backdrop) — Karte + Schild bleiben sichtbar, Änderungen live.
    let _animSignEditorEl = null;
    let _animSignEditorIdx = -1;   // v0.9.194 — welches Schild ist im Editor offen
    let _animSignEditorReposition = null;
    function _animSignsCloseEditor() {
      if (_animSignEditorReposition && map) { try { map.off("move", _animSignEditorReposition); } catch (_) {} }
      _animSignEditorReposition = null;
      if (_animSignEditorEl) { try { _animSignEditorEl.remove(); } catch (_) {} }
      _animSignEditorEl = null;
      _animSignEditorIdx = -1;
      // v0.9.180 — bearbeitetes Schild nicht mehr zwangs-sichtbar halten
      _animSignForceIdx = -1;
      // v0.9.256 — Editor zu → zurück in den GPU-Modus (flüssige Bewegung). Nur
      // umschalten + neu attachen, wenn wir wirklich im Editier-Modus waren.
      if (_animSignEditMode) {
        _animSignEditMode = false;
        try { _animSignsAttachToMap(); } catch (_) {}
      }
      const a = (_tlBar && typeof _tlBar.getScrubber === "function") ? _tlBar.getScrubber() : 0;
      _animSignsUpdateAtAnchor(a);
    }
    // v0.9.180 — Panel hängt jetzt an document.body (nicht am Karten-Container),
    // damit man es über die Karte HINAUS ziehen kann (z.B. auf die Sidebar).
    // Position daher in SEITEN-Koordinaten (Container-Offset + map.project).
    function _animSignsPositionEditor(panel, lon, lat) {
      if (!map) return;
      try {
        const p = map.project([Number(lon), Number(lat)]);
        const r = map.getContainer().getBoundingClientRect();
        const vw = window.innerWidth, vh = window.innerHeight;
        const pw = panel.offsetWidth || 286, ph = panel.offsetHeight || 300;
        let x = r.left + p.x + 18, y = r.top + p.y - ph / 2;
        if (x + pw > vw - 8) x = r.left + p.x - pw - 18;   // kein Platz rechts → links vom Schild
        x = Math.max(8, Math.min(vw - pw - 8, x));
        y = Math.max(8, Math.min(vh - ph - 8, y));
        panel.style.left = x + "px"; panel.style.top = y + "px";
      } catch (_) { panel.style.left = "60px"; panel.style.top = "60px"; }
    }
    // v0.9.178 — Editor-Panel an der Kopfzeile frei verschiebbar machen.
    function _animSignsMakeDraggable(panel) {
      const head = panel.querySelector(".sign-editor-head");
      if (!head) return;
      head.style.cursor = "move";
      head.style.touchAction = "none";
      head.style.userSelect = "none";
      let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
      const onMove = (e) => {
        if (!dragging) return;
        // v0.9.180 — frei im ganzen Fenster (Panel hängt an body), auch über die Karte hinaus
        const pw = panel.offsetWidth, ph = panel.offsetHeight;
        let x = ox + (e.clientX - sx);
        let y = oy + (e.clientY - sy);
        x = Math.max(2, Math.min(window.innerWidth - pw - 2, x));
        y = Math.max(2, Math.min(window.innerHeight - ph - 2, y));
        panel.style.left = x + "px";
        panel.style.top = y + "px";
        e.preventDefault();
      };
      const onUp = (e) => {
        dragging = false;
        try { head.releasePointerCapture(e.pointerId); } catch (_) {}
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      head.addEventListener("pointerdown", (e) => {
        // Klick auf den Schließen-Button NICHT als Drag werten
        if (e.target.closest("#se-close")) return;
        dragging = true;
        panel._userMoved = true;   // ab jetzt nicht mehr automatisch ans Schild kleben
        sx = e.clientX; sy = e.clientY;
        ox = parseFloat(panel.style.left) || 0;
        oy = parseFloat(panel.style.top) || 0;
        try { head.setPointerCapture(e.pointerId); } catch (_) {}
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        e.preventDefault();
      });
    }
    function _animSignsOpenEditor(idx, focusText) {
      // v0.9.194 — Ist der Editor für GENAU dieses Schild schon offen, NICHT neu
      // aufbauen (sonst springt das verschobene Modal zurück auf Default-Position).
      // Nur bei einem anderen Schild neu öffnen/positionieren.
      if (_animSignEditorEl && _animSignEditorIdx === idx) {
        _animSignForceIdx = idx;   // sichtbar halten
        return;
      }
      _animSignsCloseEditor();
      const list = _animSignsList();
      if (idx < 0 || idx >= list.length || !map || !map.getContainer) return;
      // v0.9.256 — Editor auf → in den DOM-Marker-Modus wechseln (flackerfreies
      // Live-Editieren). Karte steht beim Editieren still → kein „Schwimmen".
      if (!_animSignEditMode) {
        _animSignEditMode = true;
        try { _animSignsAttachToMap(); } catch (_) {}
      }
      const c = _animSignNormalize(list[idx]);
      const sel = (v, cv) => v === cv ? " selected" : "";
      const chk = (b) => b ? " checked" : "";
      const noneBg = c.bg === "none";                              // v0.9.269 — Hintergrund „Keine" (transparent)
      // v0.9.270 — EINE Box-/Hintergrundfarbe. „Akzentfarbe" + „Auto" entfallen. Der Picker zeigt
      // direkt die wirksame Farbe: gesetzte bg, sonst (legacy „auto"/leer) die Form-Standardfarbe.
      const bgResolved = (c.bg && c.bg !== "auto" && c.bg !== "none")
        ? c.bg
        : ((c.style === "banner" || c.style === "signpost" || c.style === "plain") ? (c.color || "#ff6b35") : "#15171c");
      const customTc = c.textColor && c.textColor !== "auto";
      const panel = el("div", { class: "sign-editor sign-editor-full" });
      panel.innerHTML = `
        <div class="sign-editor-head">
          <span>${t("signs.editor_title", "Schild")}</span>
          <button type="button" class="sign-editor-x" id="se-close" title="${t("common.close", "Schließen")}">✕</button>
        </div>
        <div class="sign-editor-body">
          <textarea id="se-text" rows="2" placeholder="${c.imageSrc ? t("signs.caption_ph", "Bildunterschrift (optional)") : t("signs.modal_ph", "z.B. Gipfel erreicht! (Zeilenumbruch erlaubt)")}">${_animEscapeHtml(c.text)}</textarea>

          <div class="se-group-title">${t("signs.grp.image", "Bild")}</div>
          <div class="se-inline" style="gap:6px;">
            <button type="button" class="btn btn-small" id="se-img-pick" style="flex:1;">${c.imageSrc ? t("signs.image_change", "🖼 Bild ändern") : t("signs.image_add", "🖼 Bild hinzufügen")}</button>
            <button type="button" class="btn btn-small" id="se-img-clear" style="${c.imageSrc ? "" : "display:none;"}">${t("signs.image_remove", "✕")}</button>
          </div>
          <div class="muted" id="se-img-name" style="font-size:10.5px; margin-top:2px; ${c.imageSrc ? "" : "display:none;"}">${_animEscapeHtml((c.imageSrc || "").split("/").pop())}</div>
          <div class="se-grid" id="se-img-size-row" style="margin-top:6px; ${c.imageSrc ? "" : "display:none;"}">
            <label>${t("signs.image_size", "Bildgröße")}</label>
            <input type="range" id="se-img-size" min="20" max="160" step="4" value="${c.imageSize}">
          </div>

          <div class="se-group-title">${t("signs.grp.shape", "Form & Akzent")}</div>
          <div class="se-grid">
            <label>${t("signs.style", "Form")}</label>
            <select id="se-style">
              <option value="callout"${sel("callout", c.style)}>${t("signs.style.callout", "Sprechblase")}</option>
              <option value="banner"${sel("banner", c.style)}>${t("signs.style.banner", "Zielbanner")}</option>
              <option value="pin"${sel("pin", c.style)}>${t("signs.style.pin", "Stecknadel")}</option>
              <option value="signpost"${sel("signpost", c.style)}>${t("signs.style.signpost", "Wegweiser")}</option>
              <option value="plain"${sel("plain", c.style)}>${t("signs.style.plain", "Schlicht (Box)")}</option>
            </select>
            <label>${t("signs.bg", "Hintergrund")}</label>
            <span class="se-inline"><input type="color" id="se-bg" value="${_animEscapeHtml(bgResolved)}" data-none="${noneBg ? "1" : "0"}"><button type="button" class="se-auto-btn${noneBg ? " on" : ""}" id="se-bg-none" title="${t("signs.bg_none_hint", "Kein Hintergrund (transparent) — z.B. Bild ohne farbigen Rahmen")}">${t("signs.bg_none", "Keine")}</button></span>
            <label>${t("signs.radius", "Ecken")}</label>
            <input type="range" id="se-radius" min="0" max="28" step="1" value="${c.radius}">
            <label>${t("signs.opacity", "Deckkraft")}</label>
            <input type="range" id="se-opacity" min="20" max="100" step="5" value="${Math.round(c.opacity*100)}">
            <label>${t("signs.border", "Rahmen")}</label>
            <span class="se-inline"><input type="range" id="se-bw" min="0" max="10" step="1" value="${c.borderWidth}"><input type="color" id="se-bc" value="${_animEscapeHtml(c.borderColor !== "none" ? c.borderColor : "#ffffff")}"></span>
            <label id="se-deco-label" title="${t("signs.deco_len_hint", "Länge der Stangen beim Zielbanner / Wegweiser")}" style="${(c.style === "banner" || c.style === "signpost") ? "" : "display:none;"}">${t("signs.deco_len", "Stangen-Länge")}</label>
            <input type="range" id="se-deco" min="10" max="150" step="5" value="${Math.round((c.decoScale != null ? c.decoScale : 0.5) * 100)}" style="${(c.style === "banner" || c.style === "signpost") ? "" : "display:none;"}">
          </div>

          <div class="se-group-title">${t("signs.grp.text", "Schrift")}</div>
          <div class="se-grid">
            <label>${t("signs.font", "Schriftart")}</label>
            <select id="se-font">
              <option value="system"${sel("system", c.font)}>${t("signs.font.system", "Standard (System)")}</option>
              <option value="rounded"${sel("rounded", c.font)}>${t("signs.font.rounded", "Rundlich")}</option>
              <option value="condensed"${sel("condensed", c.font)}>${t("signs.font.condensed", "Schmal")}</option>
              <option value="serif"${sel("serif", c.font)}>${t("signs.font.serif", "Serif")}</option>
              <option value="mono"${sel("mono", c.font)}>${t("signs.font.mono", "Monospace")}</option>
              <option value="impact"${sel("impact", c.font)}>${t("signs.font.impact", "Plakativ")}</option>
            </select>
            <label>${t("signs.size", "Größe")}</label>
            <input type="range" id="se-size" min="16" max="90" step="2" value="${c.size}">
            <label>${t("signs.weight", "Stärke")}</label>
            <select id="se-weight">
              <option value="400"${sel(400, c.weight)}>${t("signs.weight.normal", "Normal")}</option>
              <option value="600"${sel(600, c.weight)}>${t("signs.weight.medium", "Mittel")}</option>
              <option value="700"${sel(700, c.weight)}>${t("signs.weight.bold", "Fett")}</option>
              <option value="800"${sel(800, c.weight)}>${t("signs.weight.black", "Extra-Fett")}</option>
            </select>
            <label>${t("signs.align", "Ausrichtung")}</label>
            <select id="se-align">
              <option value="left"${sel("left", c.align)}>${t("signs.align.left", "Links")}</option>
              <option value="center"${sel("center", c.align)}>${t("signs.align.center", "Mitte")}</option>
              <option value="right"${sel("right", c.align)}>${t("signs.align.right", "Rechts")}</option>
            </select>
            <label>${t("signs.textColor", "Textfarbe")}</label>
            <span class="se-inline"><input type="color" id="se-tc" value="${_animEscapeHtml(customTc ? c.textColor : "#ffffff")}" data-auto="${customTc ? "0" : "1"}"><button type="button" class="se-auto-btn" id="se-tc-auto" title="${t("signs.tc_auto_hint", "Automatischer Kontrast zum Hintergrund")}">${t("signs.auto", "Auto")}</button></span>
            <label>${t("signs.italic", "Kursiv")}</label>
            <span class="se-inline"><input type="checkbox" id="se-italic"${chk(c.italic)}></span>
          </div>

          <div class="se-group-title">${t("signs.grp.shadow", "Schlagschatten")}</div>
          <div class="se-grid">
            <label>${t("signs.shadow", "Schatten")}</label>
            <span class="se-inline"><input type="checkbox" id="se-shadow"${chk(c.shadow)}><input type="color" id="se-sc" value="${_animEscapeHtml(c.shadowColor)}"></span>
            <label>${t("signs.shadowBlur", "Weichheit")}</label>
            <input type="range" id="se-sb" min="2" max="60" step="1" value="${c.shadowBlur}">
            <label>${t("signs.shadowStrength", "Stärke")}</label>
            <input type="range" id="se-ss" min="10" max="100" step="5" value="${Math.round(c.shadowStrength*100)}">
          </div>

          <div class="se-group-title">${t("signs.grp.behavior", "Verhalten & Timing")}</div>
          <div class="se-grid">
            <label>${t("signs.always", "Ganze Zeit zeigen")}</label>
            <span class="se-inline"><input type="checkbox" id="se-always"${chk(c.alwaysVisible)}></span>
            <label>${t("signs.zoomScale", "Mit Zoom wachsen")}</label>
            <span class="se-inline"><input type="checkbox" id="se-zoom"${chk(c.zoomScale)}></span>
            <label>${t("signs.entry", "Einblendung")}</label>
            <select id="se-entry">
              <option value="none"${sel("none", c.entry)}>${t("signs.entry.none", "Hart (sofort)")}</option>
              <option value="fade"${sel("fade", c.entry)}>${t("signs.entry.fade", "Einblenden")}</option>
              <option value="pop"${sel("pop", c.entry)}>${t("signs.entry.pop", "Aufpoppen")}</option>
              <option value="both"${sel("both", c.entry)}>${t("signs.entry.both", "Ein- + Aufpoppen")}</option>
            </select>
            <label>${t("signs.before", "Vorlauf (Sek.)")}</label>
            <input type="number" id="se-before" min="0" max="30" step="0.5" value="${c.before}">
            <label>${t("signs.after", "Sichtbar nach (Sek.)")}</label>
            <input type="number" id="se-after" min="0" max="60" step="0.5" value="${c.after}" title="${t("signs.after_hint", "0 = bleibt bis zum Ende")}">
          </div>
          <div class="se-time-anchor" style="margin-top:8px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.08);">
            <div style="font-size:11px; font-weight:600; margin-bottom:2px;">${t("signs.time_anchor", "Auslöse-Zeitpunkt")}</div>
            <div class="muted" id="se-ta-status" style="font-size:10.5px;">${(typeof c.timeAnchor === "number") ? t("signs.time_anchor_fixed", "Fester Zeitpunkt: %d %").replace("%d", Math.round(c.timeAnchor * 100)) : t("signs.time_anchor_auto_state", "Automatisch (nach Position)")}</div>
            <div class="se-inline" style="gap:6px; margin-top:4px;">
              <button type="button" class="btn btn-small" id="se-ta-set" style="flex:1;" title="${t("signs.time_anchor_hint", "Bei Hin-und-zurück-Strecken: Scrubber auf den gewünschten Moment schieben, dann hier festnageln (löst die Mehrdeutigkeit gleicher Orte).")}">${t("signs.time_anchor_set", "🕐 Auf Zeitleisten-Position")}</button>
              <button type="button" class="btn btn-small" id="se-ta-auto">${t("signs.time_anchor_auto", "Auto")}</button>
            </div>
          </div>
        </div>
        <div class="sign-editor-foot" style="flex-wrap:wrap; gap:6px;">
          <button type="button" class="btn btn-small" id="se-apply-all" style="flex-basis:100%;" title="${t("signs.apply_all_hint", "Aussehen (Form/Farben/Schrift/Schatten/Größe) auf alle anderen übertragen")}">${t("signs.apply_all", "🎨 Stil auf alle übertragen")}</button>
          <button type="button" class="btn btn-danger-subtle btn-small" id="se-del">${t("signs.delete", "🗑")}</button>
          <button type="button" class="btn btn-small" id="se-move">${t("signs.move", "↔ Verschieben")}</button>
        </div>`;
      document.body.appendChild(panel);   // v0.9.180 — an body → über die Karte hinaus ziehbar
      _animSignEditorEl = panel;
      _animSignEditorIdx = idx;   // v0.9.194 — offenes Schild merken (Re-Klick ohne Sprung)
      _animSignsPositionEditor(panel, c.lon, c.lat);
      _animSignsMakeDraggable(panel);
      // v0.9.180 — dieses Schild ab jetzt immer sichtbar zeigen + Vorschau refreshen
      _animSignForceIdx = idx;
      { const a = (_tlBar && typeof _tlBar.getScrubber === "function") ? _tlBar.getScrubber() : 0;
        _animSignsUpdateAtAnchor(a); }
      _animSignEditorReposition = () => {
        const l = _animSignsList();
        if (idx < l.length && _animSignEditorEl && !_animSignEditorEl._userMoved) {
          _animSignsPositionEditor(_animSignEditorEl, l[idx].lon, l[idx].lat);
        }
      };
      try { map.on("move", _animSignEditorReposition); } catch (_) {}

      const $ = (id) => panel.querySelector(id);
      const apply = () => {
        const l2 = _animSignsList().slice();
        if (idx >= l2.length) return;
        const patch = {
          text: $("#se-text").value || "",
          style: $("#se-style").value,
          bg: $("#se-bg").dataset.none === "1" ? "none" : $("#se-bg").value,
          radius: parseInt($("#se-radius").value, 10),
          opacity: (parseInt($("#se-opacity").value, 10) || 100) / 100,
          borderWidth: parseInt($("#se-bw").value, 10) || 0,
          borderColor: (parseInt($("#se-bw").value, 10) || 0) > 0 ? $("#se-bc").value : "none",
          decoScale: (parseInt($("#se-deco").value, 10) || 50) / 100,
          font: $("#se-font").value,
          size: parseInt($("#se-size").value, 10) || 40,
          weight: parseInt($("#se-weight").value, 10) || 700,
          align: $("#se-align").value,
          textColor: $("#se-tc").dataset.auto === "1" ? "auto" : $("#se-tc").value,
          italic: $("#se-italic").checked,
          shadow: $("#se-shadow").checked,
          shadowColor: $("#se-sc").value,
          shadowBlur: parseInt($("#se-sb").value, 10),
          shadowStrength: (parseInt($("#se-ss").value, 10) || 55) / 100,
          imageSize: parseInt($("#se-img-size").value, 10) || 60,
          zoomScale: $("#se-zoom").checked,
          alwaysVisible: $("#se-always").checked,
          entry: $("#se-entry").value,
          before: parseFloat($("#se-before").value) || 0,
          after: parseFloat($("#se-after").value) || 0,
        };
        // v0.9.254 — das gecachte Bild-Element (`_imgEl`) ist NON-ENUMERABLE und
        // überlebt den Objekt-Spread NICHT. Vor dem Neubau merken und danach wieder
        // anhängen, sonst verliert das Schild bei JEDER Einstellungs-Änderung sein
        // Bild (Marc-Bug: „Bild verschwindet sobald man Ecken/Text ändert"). Gleiche
        // imageSrc → selbes Bild, also sicher übertragbar.
        const _prevSign = l2[idx];
        l2[idx] = { ...l2[idx], ...patch };
        if (_prevSign && _prevSign._imgEl && l2[idx].imageSrc && l2[idx].imageSrc === _prevSign.imageSrc) {
          _animSetImgEl(l2[idx], _prevSign._imgEl);
        }
        // Stil/Verhalten (ohne Text) als Default fürs nächste Schild merken
        const { text, ...rest } = patch;
        _animSignLast = { ..._animSignLast, ...rest };
        _animSignsSave(l2);
        // v0.9.254 — Live-Update ohne Layer/Source-Neuaufbau (kein Flackern beim
        // Ziehen von Bildgröße/Ecken/Rahmen-Slidern). Fällt auf den vollen Attach
        // zurück, falls die Struktur noch nicht steht.
        if (!_animSignsUpdateInPlace()) _animSignsAttachToMap();
        _animSignsRenderList();
      };
      const tEl = $("#se-text");
      // v0.9.190 — Textfarbe/Hintergrund OHNE Checkbox: eine Farbe zu wählen wirkt
      // sofort (setzt data-auto=0). Der „Auto"-Button setzt data-auto=1 zurück
      // (= automatischer Kontrast bzw. Stil-Standardfarbe). MUSS vor dem apply-
      // Listener registrieren, damit data-auto stimmt, bevor apply liest.
      // Textfarbe „Auto" = automatischer Kontrast zum Hintergrund (bleibt — anderer Sinn als bg).
      { const col = $("#se-tc"), autoBtn = $("#se-tc-auto");
        if (col) col.addEventListener("input", () => { col.dataset.auto = "0"; });
        if (autoBtn && col) autoBtn.addEventListener("click", () => { col.dataset.auto = "1"; apply(); });
      }
      // v0.9.269/270 (Nutzer) — Hintergrund: EINE Farbe + „Keine" (transparent). Kein Auto/Akzent mehr.
      { const bgCol = $("#se-bg"), noneBtn = $("#se-bg-none");
        if (noneBtn && bgCol) noneBtn.addEventListener("click", () => {
          bgCol.dataset.none = "1";
          noneBtn.classList.add("on");
          apply();
        });
        if (bgCol && noneBtn) bgCol.addEventListener("input", () => { bgCol.dataset.none = "0"; noneBtn.classList.remove("on"); });
      }
      panel.querySelectorAll("input, select, textarea").forEach(elm => {
        const ev = (elm.type === "color" || elm.type === "range" || elm.tagName === "TEXTAREA"
                    || elm.type === "number" || elm.type === "text") ? "input" : "change";
        elm.addEventListener(ev, apply);
      });
      // v0.9.257 — „Stangen-Länge" nur bei Zielbanner / Wegweiser zeigen (nur die haben
      // Stangen). Beim Form-Wechsel ein-/ausblenden.
      { const _seStyle = $("#se-style");
        if (_seStyle) _seStyle.addEventListener("change", () => {
          const showDeco = (_seStyle.value === "banner" || _seStyle.value === "signpost");
          const lbl = $("#se-deco-label"), inp = $("#se-deco");
          if (lbl) lbl.style.display = showDeco ? "" : "none";
          if (inp) inp.style.display = showDeco ? "" : "none";
        });
      }
      // v0.9.259 — Auslöse-Zeitpunkt manuell festnageln (löst Mehrdeutigkeit bei
      // Hin-und-zurück-Strecken: gleicher Ort, zweimal vorbei). „Auf Zeitleisten-
      // Position" bindet das Schild an die Track-Position, an der der Marker beim
      // aktuellen Scrubber steht (timeAnchor) — hat im Render + in der Vorschau
      // Vorrang vor der Klick-Position. „Auto" löscht das wieder (zurück zu Position).
      const _taUpdateStatus = () => {
        const s = _animSignsList()[idx] || {};
        const st = $("#se-ta-status");
        if (st) st.textContent = (typeof s.timeAnchor === "number")
          ? t("signs.time_anchor_fixed", "Fester Zeitpunkt: %d %").replace("%d", Math.round(s.timeAnchor * 100))
          : t("signs.time_anchor_auto_state", "Automatisch (nach Position)");
      };
      $("#se-ta-set").onclick = () => {
        const scr = (_tlBar && typeof _tlBar.getScrubber === "function") ? _tlBar.getScrubber() : 0;
        const ta = Math.max(0, Math.min(1, _animPhotosMarkerAnchor(scr)));
        const l2 = _animSignsList().slice();
        if (idx >= l2.length) return;
        l2[idx] = { ...l2[idx], timeAnchor: ta };
        _animSignsSave(l2);
        if (!_animSignsUpdateInPlace()) _animSignsAttachToMap();
        _animSignsRenderList();
        _taUpdateStatus();
        try { toast(t("signs.time_anchor_set_done", "Zeitpunkt festgelegt."), "ok"); } catch (_) {}
      };
      $("#se-ta-auto").onclick = () => {
        const l2 = _animSignsList().slice();
        if (idx >= l2.length) return;
        const cp = { ...l2[idx] }; delete cp.timeAnchor;
        l2[idx] = cp;
        _animSignsSave(l2);
        if (!_animSignsUpdateInPlace()) _animSignsAttachToMap();
        _animSignsRenderList();
        _taUpdateStatus();
      };
      $("#se-close").onclick = () => _animSignsCloseEditor();
      $("#se-del").onclick = () => { _animSignsCloseEditor(); _animSignsDelete(idx); };
      $("#se-move").onclick = () => { _animSignsCloseEditor(); _animSignsStartMove(idx); };
      // v0.9.198/199 — „Stil + Verhalten auf alle übertragen": Aussehen UND
      // Verhalten (Timing/Einblendung/Zoom/„ganze Zeit zeigen") dieses Schilds auf
      // ALLE anderen kopieren. Text/Bild/Position/Sichtbar-Häkchen bleiben pro Schild.
      $("#se-apply-all").onclick = () => {
        const l = _animSignsList();
        if (l.length < 2) { toast(t("signs.apply_all_none", "Keine anderen Schilder vorhanden."), "info"); return; }
        const src = _animSignNormalize(l[idx]);
        const APPLY_KEYS = [
          // Aussehen
          "style", "color", "bg", "textColor", "font", "weight", "italic",
          "align", "size", "radius", "padding", "opacity", "borderColor", "borderWidth", "decoScale",
          "shadow", "shadowColor", "shadowBlur", "shadowStrength", "imageSize",
          // Verhalten
          "zoomScale", "entry", "before", "after", "alwaysVisible"];
        const patch = {}; APPLY_KEYS.forEach(k => patch[k] = src[k]);
        const l2 = l.map((s, i) => (i === idx ? s : { ...s, ...patch }));
        // v0.9.201 — gecachtes Bild-Element ALLER Schilder droppen, damit das Icon
        // bei geänderter Bildgröße garantiert neu gezeichnet wird (sonst behält
        // Mapbox das alte Icon-Bild → Größe schien nicht zu wirken).
        l2.forEach(s => { try { delete s._imgEl; } catch (_) {} });
        _animSignForceIdx = -1;
        _animSignsSave(l2);
        _animSignsDetach();          // alle alten Icon-Bilder von der Karte werfen
        _animSignsAttachToMap();     // komplett neu aufbauen (frische Bilder, neue Größe)
        _animSignsRenderList();
        try { if (map && map.triggerRepaint) map.triggerRepaint(); } catch (_) {}
        toast(t("signs.apply_all_done", "Stil + Verhalten auf alle übertragen."), "ok");
      };
      // v0.9.189 — Bild hinzufügen / ändern / entfernen
      $("#se-img-pick").onclick = async () => {
        let r;
        try { r = await api().sign_pick_image(); } catch (e) { return; }
        if (!r || !r.ok) { if (r && r.error) toast(r.error, "error"); return; }
        if (r.cancelled) return;
        const l2 = _animSignsList().slice();
        if (idx >= l2.length) return;
        l2[idx] = { ...l2[idx], imageSrc: r.path, thumb: r.thumb, _imgEl: null, _imgFailed: false, _imgLoading: false, _imgChecked: false, _imgMissing: false, _imgBroken: false };
        _animSignsSave(l2);
        _animSignsAttachToMap();
        _animSignsRenderList();
        $("#se-img-pick").textContent = t("signs.image_change", "🖼 Bild ändern");
        $("#se-img-clear").style.display = "";
        const nm = $("#se-img-name"); if (nm) { nm.style.display = ""; nm.textContent = (r.path || "").split("/").pop(); }
        const szr = $("#se-img-size-row"); if (szr) szr.style.display = "";
        $("#se-text").placeholder = t("signs.caption_ph", "Bildunterschrift (optional)");
      };
      $("#se-img-clear").onclick = () => {
        const l2 = _animSignsList().slice();
        if (idx >= l2.length) return;
        l2[idx] = { ...l2[idx], imageSrc: "", thumb: null, _imgEl: null };
        _animSignsSave(l2);
        _animSignsAttachToMap();
        _animSignsRenderList();
        $("#se-img-pick").textContent = t("signs.image_add", "🖼 Bild hinzufügen");
        $("#se-img-clear").style.display = "none";
        const nm = $("#se-img-name"); if (nm) nm.style.display = "none";
        const szr = $("#se-img-size-row"); if (szr) szr.style.display = "none";
        $("#se-text").placeholder = t("signs.modal_ph", "z.B. Gipfel erreicht!");
      };
      if (focusText) { try { tEl.focus(); } catch (_) {} }
    }
    function _animSignsStartMove(idx) {
      if (!Array.isArray(currentCoords) || currentCoords.length < 2) return;
      _animSignMoveIdx = idx;
      // Verschieben respektiert den Anker-Modus des Schilds (frei bleibt frei).
      const s = _animSignsList()[idx];
      const isFree = !!(s && s.anchorMode === "free");
      _animSignsSetPlaceMode(true, true, isFree);
      // v0.9.202 — deutlicher Hinweis (der Sidebar-Text ist leicht zu übersehen).
      try {
        toast(isFree
          ? t("signs.move_toast_free", "📍 Klick auf die Karte für die neue Position — Esc bricht ab")
          : t("signs.move_toast_track", "📍 Klick auf den Track für die neue Position — Esc bricht ab"),
          "info", 4000);
      } catch (_) {}
    }
    function _animSignsSetPlaceMode(on, isMove, free) {
      _animSignPlaceMode = !!on;
      _animSignPlaceFree = !!free;
      if (!on) { _animSignMoveIdx = -1; _animSignPlaceFree = false; }
      const btn = document.getElementById("anim-signs-place");
      const btnF = document.getElementById("anim-signs-place-free");
      if (btn) btn.classList.toggle("btn-primary", _animSignPlaceMode && !_animSignPlaceFree);
      if (btnF) btnF.classList.toggle("btn-primary", _animSignPlaceMode && _animSignPlaceFree);
      const hint = document.getElementById("anim-signs-place-hint");
      if (hint) {
        hint.textContent = isMove
          ? (_animSignPlaceFree ? t("signs.move_active_free", "Klick irgendwo auf die Karte, um das Schild zu verschieben … (Esc bricht ab)")
                                : t("signs.move_active", "Klick auf den Track, um das Schild zu verschieben … (Esc bricht ab)"))
          : (_animSignPlaceFree ? t("signs.place_active_free", "Klick irgendwo auf die Karte (z.B. eine Sehenswürdigkeit) … (Esc bricht ab)")
                                : t("signs.place_active", "Klick auf den Track, um das Schild zu setzen … (Esc bricht ab)"));
        hint.style.display = _animSignPlaceMode ? "block" : "none";
      }
      const cont = map && map.getCanvas ? map.getCanvas() : null;
      if (cont) cont.style.cursor = _animSignPlaceMode ? "crosshair" : "";
    }
    function _animSignsOnMapClick(e) {
      const lng = e.lngLat.lng, lat = e.lngLat.lat;
      if (_animSignPlaceMode) {
        const moveIdx = _animSignMoveIdx;
        const free = _animSignPlaceFree;
        _animSignsSetPlaceMode(false);
        const p = free ? { lon: lng, lat: lat } : _animSignSnap(lng, lat);
        if (moveIdx >= 0) {                       // bestehendes Schild verschieben
          const l2 = _animSignsList().slice();
          if (moveIdx < l2.length) {
            // v0.9.203 — beim manuellen Verschieben den Zeit-Anker verwerfen → Timing
            // richtet sich wieder nach der (neuen) Position.
            const _moved = { ...l2[moveIdx], lat: p.lat, lon: p.lon, anchorMode: free ? "free" : "track" };
            delete _moved.timeAnchor;
            l2[moveIdx] = _moved;
            _animSignsSave(l2); _animSignsAttachToMap(); _animSignsRenderList();
            _animSignsOpenEditor(moveIdx);        // Editor wieder öffnen (am neuen Ort)
          }
        } else {
          _animSignsAddNew(lng, lat, free);
        }
        return;
      }
      // v0.9.255 — Schilder sind jetzt HTML-Marker und fangen ihren Klick selbst ab
      // (siehe wrap.addEventListener in _animSignsAttachToMap). Hier kein Hit-Test mehr.
    }
    // v0.9.198 — Foto-Import: legt für jedes Foto (mit GPS) ein Schild MIT Bild an
    // den Aufnahme-Koordinaten an. Die Sign lädt ihren eigenen 600px-Thumb (imageSrc).
    async function _animSignsAddPhotosFromBridge(loader) {
      try {
        const res = await loader();
        const photos = (res && res.photos) || [];
        if (!photos.length) {
          // v0.9.199 — ohne GPS ≠ Lesefehler. Klare Meldung statt pauschal „kein GPS".
          if ((res && res.failed_count) > 0 && !(res.skipped_count > 0)) {
            toast(t("photos.toast_failed", "Fotos konnten nicht gelesen werden."), "err", 3500);
          } else {
            toast(t("photos.toast_no_gps", "Keine Fotos mit GPS gefunden."), "warn", 3500);
          }
          return;
        }
        // v0.9.203 — Timing über die AUFNAHME-ZEIT (gegen GPX-Zeitstempel) statt
        // Position. Löst das Loop-Problem (gleicher Ort mehrfach am Track).
        let timeAnchors = {};
        try {
          const gpxPath = (typeof currentGpx === "string" && currentGpx) ? currentGpx : "";
          if (gpxPath && window.pywebview?.api?.photos_time_anchors) {
            const r = await window.pywebview.api.photos_time_anchors(
              photos.map(p => p.path || p.imageSrc).filter(Boolean), gpxPath);
            if (r && r.ok) timeAnchors = r.anchors || {};
          }
        } catch (_) {}
        const seen = new Set(_animSignsList().map(s => (s.imageSrc || "")).filter(Boolean));
        const list = _animSignsList().slice();
        let added = 0;
        photos.forEach(p => {
          const src = p.path || p.imageSrc || "";
          if (!src || seen.has(src)) return;
          seen.add(src);
          const ta = timeAnchors[src];
          list.push({ ...(_SIGN_DEFAULTS),
            lat: Number(p.lat), lon: Number(p.lon),
            text: "", imageSrc: src, anchorMode: "free", visible: true,
            ...(typeof ta === "number" ? { timeAnchor: ta } : {}) });
          added++;
        });
        if (!added) { toast(t("signs.photos_dupes", "Alle Fotos sind schon drin."), "info", 2500); return; }
        _animSignsSave(list);
        _animSignsAttachToMap();
        _animSignsRenderList();
        toast(t("photos.toast_loaded", "%n Fotos geladen.").replace("%n", added), "ok", 2500);
      } catch (e) {
        applog("error", `[anim-signs] Foto-Import fehlgeschlagen: ${e}`);
        toast(t("photos.toast_load_error", "Fotos konnten nicht geladen werden."), "err", 3500);
      }
    }
    function _animSignsImportPhotos(pathsOrFolder) {
      if (!window.pywebview?.api?.photos_load) return;
      return _animSignsAddPhotosFromBridge(() => window.pywebview.api.photos_load(pathsOrFolder));
    }
    function _animSignsImportFromGeotagger() {
      if (!window.pywebview?.api?.photos_from_geotagger) return;
      return _animSignsAddPhotosFromBridge(() => window.pywebview.api.photos_from_geotagger());
    }
    function _animSignsBindUi() {
      const show = document.getElementById("anim-signs-show");
      if (show && !show._wired) {
        show._wired = true;
        show.checked = _animSignsShow();
        show.addEventListener("change", () => {
          try {
            if (typeof saveProjectSettings === "function" && typeof getActiveSession === "function" && getActiveSession())
              saveProjectSettings(_MODKEY, { signs_show: !!show.checked });
          } catch (_) {}
          _animSignsAttachToMap();
        });
      }
      const prevAll = document.getElementById("anim-signs-preview-all");
      if (prevAll && !prevAll._wired) {
        prevAll._wired = true;
        prevAll.checked = _animSignsPreviewAll;
        prevAll.addEventListener("change", () => {
          _animSignsPreviewAll = !!prevAll.checked;
          const a = (_tlBar && typeof _tlBar.getScrubber === "function") ? _tlBar.getScrubber() : 0;
          _animSignsUpdateAtAnchor(a);   // sofort anwenden
        });
      }
      const placeBtn = document.getElementById("anim-signs-place");
      if (placeBtn && !placeBtn._wired) {
        placeBtn._wired = true;
        placeBtn.addEventListener("click", () => {
          if (!Array.isArray(currentCoords) || currentCoords.length < 2) {
            if (typeof toast === "function") toast(t("signs.need_track", "Erst eine GPX-Route laden."), "warn");
            return;
          }
          const on = !(_animSignPlaceMode && !_animSignPlaceFree);
          _animSignsSetPlaceMode(on, false, false);
        });
      }
      const placeFreeBtn = document.getElementById("anim-signs-place-free");
      if (placeFreeBtn && !placeFreeBtn._wired) {
        placeFreeBtn._wired = true;
        placeFreeBtn.addEventListener("click", () => {
          if (!Array.isArray(currentCoords) || currentCoords.length < 2) {
            if (typeof toast === "function") toast(t("signs.need_track", "Erst eine GPX-Route laden."), "warn");
            return;
          }
          const on = !(_animSignPlaceMode && _animSignPlaceFree);
          _animSignsSetPlaceMode(on, false, true);
        });
      }
      const clearBtn = document.getElementById("anim-signs-clear");
      if (clearBtn && !clearBtn._wired) {
        clearBtn._wired = true;
        clearBtn.addEventListener("click", () => _animSignsClearAll());
      }
      // v0.9.198 — „📷 Fotos hinzufügen" (Ordner/Dateien) → Schilder mit Bild
      const addPhotos = document.getElementById("anim-signs-add-photos");
      if (addPhotos && !addPhotos._wired) {
        addPhotos._wired = true;
        addPhotos.addEventListener("click", () => {
          if (typeof PhotoPins === "undefined" || !PhotoPins.openPickChoice) return;
          PhotoPins.openPickChoice({
            onFolder: (path) => _animSignsImportPhotos(path),
            onFiles:  (paths) => _animSignsImportPhotos(paths),
          });
        });
      }
      const addGtg = document.getElementById("anim-signs-add-gtg");
      if (addGtg && !addGtg._wired) {
        addGtg._wired = true;
        addGtg.addEventListener("click", () => _animSignsImportFromGeotagger());
      }
      // v0.9.198 — Master „Alle an" / „Alle aus"
      const allOn = document.getElementById("anim-signs-all-on");
      if (allOn && !allOn._wired) { allOn._wired = true; allOn.addEventListener("click", () => _animSignsSetAllVisible(true)); }
      const allOff = document.getElementById("anim-signs-all-off");
      if (allOff && !allOff._wired) { allOff._wired = true; allOff.addEventListener("click", () => _animSignsSetAllVisible(false)); }
      // v0.9.198 — Drop-Zone: Fotos/Ordner auf die Sektion ziehen → Schilder mit Bild
      const dropHost = document.getElementById("anim-signs-section");
      if (dropHost && !dropHost._dropWired) {
        dropHost._dropWired = true;
        dropHost.addEventListener("dragover", (e) => { e.preventDefault(); dropHost.classList.add("photos-dropping"); });
        dropHost.addEventListener("dragleave", () => dropHost.classList.remove("photos-dropping"));
        dropHost.addEventListener("drop", async (e) => {
          e.preventDefault();
          dropHost.classList.remove("photos-dropping");
          const nativeMap = (typeof consumeNativeDropMap === "function") ? await consumeNativeDropMap() : {};
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
          if (paths.length) _animSignsImportPhotos(paths);
        });
      }
      // Esc bricht den Platzier-Modus ab + schließt den Editor
      if (!window.__animSignsEscWired) {
        window.__animSignsEscWired = true;
        document.addEventListener("keydown", (e) => {
          if (e.key !== "Escape") return;
          if (_animSignPlaceMode) _animSignsSetPlaceMode(false);
          _animSignsCloseEditor();
        });
      }
    }

    // ── v0.9.205 — Route / Anreise ───────────────────────────────────────────
    // Start+Ziel → Mapbox Directions (Straße) ODER Flug-Bogen → synthetisches
    // GPX → loadGlobalGpx → wie ein normaler Track animiert.
    let _routePick = null;     // null | "start" | "end" — aktiver Karten-Pick
    let _routeStart = null;    // {lon,lat} aus Karten-Klick
    let _routeEnd = null;
    let _routeBusy = false;
    function _routeStatus(msg, kind) {
      const el = document.getElementById("route-status");
      if (el) { el.textContent = msg || ""; el.style.color = (kind === "err") ? "#ff6b6b" : ""; }
    }
    function _routeFmt(lon, lat) { return `${lat.toFixed(5)}, ${lon.toFixed(5)}`; }
    function _routeSetResolved(which, label, lon, lat) {
      const el = document.getElementById(`route-${which}-resolved`);
      if (el) el.textContent = label ? `✓ ${label}` : `✓ ${_routeFmt(lon, lat)}`;
    }
    function _routeSetPickMode(which) {
      _routePick = which || null;
      const sb = document.getElementById("route-start-pick");
      const eb = document.getElementById("route-end-pick");
      if (sb) sb.classList.toggle("btn-primary", _routePick === "start");
      if (eb) eb.classList.toggle("btn-primary", _routePick === "end");
      const cont = map && map.getCanvas ? map.getCanvas() : null;
      if (cont) cont.style.cursor = _routePick ? "crosshair" : "";
      if (_routePick) {
        const lbl = _routePick === "start" ? t("route.start", "Start") : t("route.end", "Ziel");
        try { toast(t("route.pick_toast", "📍 Klick auf die Karte für:") + " " + lbl + " (Esc bricht ab)", "info", 4000); } catch (_) {}
      }
    }
    function _routeOnMapClick(e) {
      if (!_routePick) return false;
      const which = _routePick;
      const lon = e.lngLat.lng, lat = e.lngLat.lat;
      if (which === "start") _routeStart = { lon, lat }; else _routeEnd = { lon, lat };
      const input = document.getElementById(`route-${which}-input`);
      if (input) input.value = _routeFmt(lon, lat);  // lat,lon
      _routeSetResolved(which, null, lon, lat);
      _routeSetPickMode(null);
      _routePersist();
      return true;
    }
    // v0.9.214 — Start/Ziel + Route-Einstellungen + zuletzt berechneter Route-
    // GPX-Pfad ins Projekt speichern, damit ein Neustart sie wiederherstellt.
    function _routePersist(extra) {
      if (!_isReiseroute || typeof saveProjectSettings !== "function") return;
      try {
        const patch = {
          route_start_text: (document.getElementById("route-start-input") || {}).value || "",
          route_end_text: (document.getElementById("route-end-input") || {}).value || "",
          route_start_lonlat: _routeStart || null,
          route_end_lonlat: _routeEnd || null,
          route_mode: (document.querySelector('input[name="route-mode"]:checked') || {}).value || "road",
          // v0.9.231 — KEIN `|| 55`: bei „fein" ist der Slider-Wert 0, und 0 ist
          // in JS falsy → `|| 55` machte aus fein heimlich grob (0.55). isNaN-Guard.
          route_coarseness: (function(){ const v = parseFloat((document.getElementById("route-coarse") || {}).value); return isNaN(v) ? 55 : v; })(),
          route_profile: (document.getElementById("route-profile") || {}).value || "driving",
        };
        if (extra) Object.assign(patch, extra);
        saveProjectSettings(_MODKEY, patch);
      } catch (_) {}
    }
    // v0.9.253 — Reiseroute komplett zurücksetzen (für ein frisches Projekt):
    // Start/Ziel + Eingaben + der vom vorigen Projekt geladene Route-Track raus.
    // Sonst übernimmt ein neues Projekt den alten Stand und re-speichert ihn
    // (= „neues Projekt dupliziert die Route statt sie zurückzusetzen").
    function _routeReset() {
      if (!_isReiseroute) return;
      _routeStart = null; _routeEnd = null;
      const si = document.getElementById("route-start-input"); if (si) si.value = "";
      const ei = document.getElementById("route-end-input");   if (ei) ei.value = "";
      const sr = document.getElementById("route-start-resolved"); if (sr) sr.textContent = "";
      const er = document.getElementById("route-end-resolved");   if (er) er.textContent = "";
      try { _routeStatus(""); } catch (_) {}
      // Geladenen Route-Track aus der Vorschau nehmen (frisches Projekt = leer).
      currentGpx = null; currentCoords = null; currentBbox = null; _gpxStats = null; _gpxElevations = null;
      if (map) {
        ["preview-line", "preview-glow", "preview-highlight"].forEach(l => { try { if (map.getLayer(l)) map.removeLayer(l); } catch (_) {} });
        try { if (map.getSource("preview-track")) map.removeSource("preview-track"); } catch (_) {}
      }
      try {
        const se = document.getElementById("anim-stats-empty"); if (se) se.hidden = false;
        const sc = document.getElementById("anim-stats-cards"); if (sc) sc.hidden = true;
        const rb = document.getElementById("anim-render"); if (rb) rb.disabled = true;
      } catch (_) {}
      try { _applyGhostGpx(); } catch (_) {}
    }
    function _routeRestore() {
      if (!_isReiseroute) return;
      let a = null;
      try { a = (typeof getActiveProject === "function" ? getActiveProject() : null)?.[_MODKEY]; } catch (_) {}
      if (!a) a = (_settingsCache && _settingsCache[_MODKEY]) || {};
      // Frisches Projekt ohne Route-Daten → sauber zurücksetzen statt alten
      // Stand stehen lassen (sonst „Duplikat"-Bug beim Projekt-Wechsel/Neu).
      const _hasRoute = !!(a.route_start_text || a.route_end_text || a.route_start_lonlat
                           || a.route_end_lonlat || a.route_gpx_path);
      if (!_hasRoute) { _routeReset(); return; }
      const si = document.getElementById("route-start-input"); if (si) si.value = (a.route_start_text != null ? a.route_start_text : "");
      const ei = document.getElementById("route-end-input");   if (ei) ei.value = (a.route_end_text != null ? a.route_end_text : "");
      _routeStart = a.route_start_lonlat || null;
      _routeEnd = a.route_end_lonlat || null;
      const sr = document.getElementById("route-start-resolved"); if (sr) sr.textContent = "";
      const er = document.getElementById("route-end-resolved");   if (er) er.textContent = "";
      if (_routeStart) _routeSetResolved("start", null, _routeStart.lon, _routeStart.lat);
      if (_routeEnd)   _routeSetResolved("end", null, _routeEnd.lon, _routeEnd.lat);
      if (a.route_mode) { const r = document.querySelector(`input[name="route-mode"][value="${a.route_mode}"]`); if (r) r.checked = true; }
      if (a.route_coarseness != null) {
        const c = document.getElementById("route-coarse"); if (c) c.value = a.route_coarseness;
        const v = document.getElementById("route-coarse-v"); if (v) v.textContent = a.route_coarseness + " %";
      }
      if (a.route_profile) { const p = document.getElementById("route-profile"); if (p) p.value = a.route_profile; }
    }
    // Stellt den zuletzt berechneten Route-Track wieder her (Datei liegt
    // persistent in App-Support/routes/). Braucht die Karte → aus onMapReady.
    async function _routeRestoreGpx() {
      if (!_isReiseroute) return;
      let a = null;
      try { a = (typeof getActiveProject === "function" ? getActiveProject() : null)?.[_MODKEY]; } catch (_) {}
      if (!a) a = (_settingsCache && _settingsCache[_MODKEY]) || {};
      const p = a.route_gpx_path;
      if (!p) return;
      try {
        if (window.pywebview?.api?.sign_image_exists) {
          const ex = await window.pywebview.api.sign_image_exists(p);
          if (ex && ex.exists === false) return;
        }
        await loadGpxByPath(p);
        try { fitTrackPreview(true); } catch (_) {}
        _applyGhostGpx();
      } catch (_) {}
    }
    // v0.9.260 — gibt {coords, hadInput, err} zurück, damit _routeCompute die ECHTE
    // Ursache melden kann (vorher pauschal „Start fehlt", auch bei Geocoding-Fehler/
    // Netzproblem/leerem Treffer → Nutzer-Bugreport: irreführend).
    async function _routeResolve(which) {
      const input = document.getElementById(`route-${which}-input`);
      const txt = (input && input.value || "").trim();
      // "lat, lon" (Google-Konvention beim Copy-Paste) → direkt nehmen.
      const m = txt.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
      if (m) { const a = parseFloat(m[1]), b = parseFloat(m[2]); return { coords: { lon: b, lat: a }, hadInput: true, err: null }; }
      if (txt) {
        let r;
        try { r = await api().route_geocode(txt, 1); }
        catch (e) { return { coords: null, hadInput: true, err: "geocode_failed", detail: String(e && e.message || e) }; }
        if (r && r.ok && r.results && r.results.length) {
          const h = r.results[0]; _routeSetResolved(which, h.name, h.lon, h.lat);
          return { coords: { lon: h.lon, lat: h.lat }, hadInput: true, err: null };
        }
        if (r && r.error === "no_token") return { coords: null, hadInput: true, err: "no_token" };
        if (r && r.ok) return { coords: null, hadInput: true, err: "not_found" };  // ok, aber kein Treffer
        return { coords: null, hadInput: true, err: "geocode_failed", detail: (r && r.error) || "unbekannt" };
      }
      return { coords: (which === "start" ? _routeStart : _routeEnd), hadInput: false, err: null };
    }
    async function _routeCompute() {
      if (_routeBusy) return;
      const mode = (document.querySelector('input[name="route-mode"]:checked') || {}).value || "road";
      _routeBusy = true;
      const btn = document.getElementById("route-compute");
      if (btn) btn.disabled = true;
      _routeStatus(t("route.computing", "Route wird berechnet …"));
      try {
        const S = await _routeResolve("start");
        const E = await _routeResolve("end");
        // Token fehlt → klare Meldung (gilt für Start ODER Ziel).
        if (S.err === "no_token" || E.err === "no_token") {
          _routeStatus(t("route.no_token", "Kein Mapbox-Token konfiguriert (siehe Einstellungen)."), "err"); return;
        }
        // Pro Feld die ECHTE Ursache melden statt pauschal „fehlt".
        const _fieldErr = (R, leerKey, leerDef, label) => {
          if (R.coords) return false;
          if (!R.hadInput) { _routeStatus(t(leerKey, leerDef), "err"); return true; }
          if (R.err === "not_found") { _routeStatus(t("route.not_found", "%s: Adresse nicht gefunden — anders schreiben oder 📍 auf der Karte klicken.").replace("%s", label), "err"); return true; }
          _routeStatus(t("route.geocode_failed", "%s: Adresssuche fehlgeschlagen (Internet/Token prüfen).").replace("%s", label) + (R.detail ? " [" + R.detail + "]" : ""), "err"); return true;
        };
        if (_fieldErr(S, "route.no_start", "Start fehlt — Adresse eingeben oder 📍 auf der Karte klicken.", t("route.start", "Start"))) return;
        if (_fieldErr(E, "route.no_end", "Ziel fehlt — Adresse eingeben oder 📍 auf der Karte klicken.", t("route.end", "Ziel"))) return;
        const s = S.coords, en = E.coords;
        const profile = (document.getElementById("route-profile") || {}).value || "driving";
        // v0.9.231 — Falsy-Zero-Fix: „fein" = 0, und `0 || 55` ergab fälschlich
        // 55 → fein war heimlich grob (bei Fußwegen ein Strich). isNaN-Guard.
        const _coarseRaw = parseFloat((document.getElementById("route-coarse") || {}).value);
        const coarseness = (isNaN(_coarseRaw) ? 55 : _coarseRaw) / 100;
        const sName = (document.getElementById("route-start-input") || {}).value || "Start";
        const eName = (document.getElementById("route-end-input") || {}).value || "Ziel";
        const name = `${sName} → ${eName}`.slice(0, 60);
        const res = await api().route_compute({
          waypoints: [[s.lon, s.lat], [en.lon, en.lat]], mode, profile, coarseness, name,
        });
        if (!res || !res.ok) {
          const code = res && res.error;
          const msg = (code === "no_token") ? t("route.no_token", "Kein Mapbox-Token konfiguriert (siehe Einstellungen).")
                    : (code === "need_two_points") ? t("route.no_start", "Start und Ziel nötig.")
                    : (t("route.failed", "Route fehlgeschlagen: ") + (code || "unbekannt"));
          _routeStatus(msg, "err"); return;
        }
        // v0.9.210 — Route ist der ANIMIERTE Track (lokal geladen, ohne das
        // globale GPX zu ersetzen). Das geladene Wander-GPX bleibt als Ghost.
        await loadGpxByPath(res.gpx_path);
        try { fitTrackPreview(true); } catch (_) {}
        _applyGhostGpx();  // Ghost-Linie wieder drüberlegen
        _routePersist({ route_gpx_path: res.gpx_path });  // v0.9.214 — fürs Wiederherstellen
        const km = (res.distance_m || 0) / 1000;
        _routeStatus(t("route.done", "✓ Route geladen: ") + km.toFixed(1) + " km"
          + (res.duration_s ? " · ~" + Math.round(res.duration_s / 60) + " min" : ""));
      } catch (err) {
        _routeStatus(t("route.failed", "Route fehlgeschlagen: ") + (err && err.message || err), "err");
      } finally {
        _routeBusy = false;
        const b = document.getElementById("route-compute");
        if (b) b.disabled = false;
      }
    }
    function _routeBindUi() {
      const sp = document.getElementById("route-start-pick");
      if (sp && !sp._wired) { sp._wired = true; sp.addEventListener("click", () => _routeSetPickMode(_routePick === "start" ? null : "start")); }
      const ep = document.getElementById("route-end-pick");
      if (ep && !ep._wired) { ep._wired = true; ep.addEventListener("click", () => _routeSetPickMode(_routePick === "end" ? null : "end")); }
      const cb = document.getElementById("route-compute");
      if (cb && !cb._wired) { cb._wired = true; cb.addEventListener("click", _routeCompute); }
      const coarse = document.getElementById("route-coarse");
      const coarseV = document.getElementById("route-coarse-v");
      if (coarse && !coarse._wired) {
        coarse._wired = true;
        const upd = () => { if (coarseV) coarseV.textContent = `${coarse.value} %`; };
        coarse.addEventListener("input", upd);
        coarse.addEventListener("change", () => _routePersist());  // v0.9.214
        upd();
      }
      const prof = document.getElementById("route-profile");
      if (prof && !prof._wired) { prof._wired = true; prof.addEventListener("change", () => _routePersist()); }
      const profField = document.getElementById("route-profile-field");
      const syncMode = () => {
        const mode = (document.querySelector('input[name="route-mode"]:checked') || {}).value || "road";
        if (profField) profField.style.display = (mode === "arc") ? "none" : "";
      };
      document.querySelectorAll('input[name="route-mode"]').forEach((r) => {
        if (!r._wired) { r._wired = true; r.addEventListener("change", () => { syncMode(); _routePersist(); }); }
      });
      _routeRestore();  // v0.9.214 — gespeicherte Start/Ziel/Einstellungen wiederherstellen
      syncMode();
      if (!window.__routeEscWired) {
        window.__routeEscWired = true;
        document.addEventListener("keydown", (e) => { if (e.key === "Escape" && _routePick) _routeSetPickMode(null); });
      }
    }

    function _animPhotosBindUi() {
      // Slider
      const slider = document.getElementById("anim-photos-size");
      const sliderV = document.getElementById("anim-photos-size-v");
      if (slider && !slider._wired) {
        slider._wired = true;
        slider.value = String(_animPhotosSizePx());
        if (sliderV) sliderV.textContent = `${slider.value} px`;
        slider.addEventListener("input", () => {
          const v = parseInt(slider.value, 10) || 48;
          if (sliderV) sliderV.textContent = `${v} px`;
          if (map && typeof PhotoPins !== "undefined") PhotoPins.updateSize(map, v);
          try {
            if (typeof saveProjectSettings === "function" && typeof getActiveSession === "function" && getActiveSession()) {
              saveProjectSettings(_MODKEY, { photos_size_px: v });
            }
          } catch (_) {}
        });
      }
      // Show-Checkbox
      const show = document.getElementById("anim-photos-show");
      if (show && !show._wired) {
        show._wired = true;
        show.checked = _animPhotosShow();
        show.addEventListener("change", () => {
          try {
            if (typeof saveProjectSettings === "function" && typeof getActiveSession === "function" && getActiveSession()) {
              saveProjectSettings(_MODKEY, { photos_show: !!show.checked });
            }
          } catch (_) {}
          _animPhotosApplyToMap();
        });
      }
      // v0.9.75 — Pick-Button öffnet Choice-Modal (Ordner oder einzelne Dateien)
      const pickBtn = document.getElementById("anim-photos-pick");
      if (pickBtn && !pickBtn._wired) {
        pickBtn._wired = true;
        pickBtn.addEventListener("click", () => {
          if (typeof PhotoPins === "undefined" || !PhotoPins.openPickChoice) {
            applog("warn", "[anim-photos] PhotoPins.openPickChoice nicht verfügbar");
            return;
          }
          PhotoPins.openPickChoice({
            onFolder: (path) => _animPhotosLoadFromPaths(path),
            onFiles:  (paths) => _animPhotosLoadFromPaths(paths),
          });
        });
      }
      // From-Geotagger
      const gtgBtn = document.getElementById("anim-photos-from-gtg");
      if (gtgBtn && !gtgBtn._wired) {
        gtgBtn._wired = true;
        gtgBtn.addEventListener("click", () => _animPhotosLoadFromGeotagger());
      }
      // Clear
      const clearBtn = document.getElementById("anim-photos-clear");
      if (clearBtn && !clearBtn._wired) {
        clearBtn._wired = true;
        clearBtn.addEventListener("click", () => {
          if (!_animPhotosList().length) return;
          _animPhotosClearAll();
        });
      }
      // v0.9.77 — Master „Alle an" / „Alle aus"
      const selAll = document.getElementById("anim-photos-select-all");
      if (selAll && !selAll._wired) {
        selAll._wired = true;
        selAll.addEventListener("click", () => _animPhotosSetAllVisible(true));
      }
      const selNone = document.getElementById("anim-photos-select-none");
      if (selNone && !selNone._wired) {
        selNone._wired = true;
        selNone.addEventListener("click", () => _animPhotosSetAllVisible(false));
      }
      // Drop-Zone: das ganze Section-Body akzeptiert Drop (Fotos oder Ordner)
      const dropHost = document.getElementById("anim-photos-section");
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
          const nativeMap = (typeof consumeNativeDropMap === "function")
                            ? await consumeNativeDropMap() : {};
          const MEDIA_RX = /\.(jpe?g|jpe|tiff?|cr3|cr2|crw|nef|nrw|arw|srf|sr2|raf|rw2|orf|dng|pef|rwl|srw|heic|heif|mp4|mov|m4v|qt|insv|insp|mts|m2ts|lrv|3gp|avi|mkv)$/i;
          const paths = [];
          for (const f of (e.dataTransfer?.files || [])) {
            const np = nativePathFromMap(nativeMap, f.name) || f.path || null;
            if (np) paths.push(np);
          }
          // Auffang: JS bekam keine Files (WKWebView) → native Medien-Pfade nehmen
          if (!paths.length) {
            const seen = new Set();
            for (const k in nativeMap) {
              const p = nativeMap[k];
              if (p && !seen.has(p) && MEDIA_RX.test(p)) { seen.add(p); paths.push(p); }
            }
          }
          if (paths.length) _animPhotosLoadFromPaths(paths);
        });
      }
      _animPhotosRenderList();
    }
    // Initial-Bind nach Mount (Buttons existieren schon im DOM)
    _animPhotosBindUi();
    _animSignsBindUi();
    if (_isReiseroute) _routeBindUi();  // v0.9.205/208 — Route nur im Reiseroute-Modul
    // v0.9.222 — _routeRestore/_routeRestoreGpx leben in DIESEM whenApiReady-
    // Closure. Der onGpxLoaded-Handler (mountAnimator-Scope, eine Ebene höher)
    // kann sie nicht direkt sehen → über Modul-Scope-Handles erreichbar machen.
    if (_isReiseroute) { _rrRouteRestoreFn = _routeRestore; _rrRouteRestoreGpxFn = _routeRestoreGpx; }
    // v0.9.171 — Schilder-Helper für scrubPreview/step + GPX-Load exposen.
    window.__rzAnimSigns = {
      updateAtAnchor: _animSignsUpdateAtAnchor,
      applyMarkerAnchor: _animSignsApplyMarkerAnchor,
      attach: _animSignsAttachToMap,
      renderList: _animSignsRenderList,
      onMapClick: _animSignsOnMapClick,
      // v0.9.255 — Probe-Lauf-Start: Editor schließen + Force-Modi aus, damit das echte
      // Schild-Timing greift (Nutzer-Bug #5). Diese Variablen leben in DIESEM Scope und
      // sind aus runTimelinePreview (anderer Scope) NICHT direkt erreichbar → über diese
      // Methode zurücksetzen. (Vorher direkter Zugriff → „Can't find variable"-Crash.)
      beginPreview: () => {
        try { _animSignsCloseEditor(); } catch (_) {}
        _animSignForceIdx = -1;
        if (_animSignsPreviewAll) {
          _animSignsPreviewAll = false;
          const _pa = document.getElementById("anim-signs-preview-all");
          if (_pa) _pa.checked = false;
        }
      },
      // v0.9.185 — vollständiges Aufräumen, auf der LEBENDEN Karte. window.__rzAnimSigns
      // wird bei jedem Mount überschrieben → zeigt immer auf den aktiven Mount-Closure,
      // egal welche (evtl. veraltete) Resetter-Closure den Clear auslöst.
      clearAll: () => {
        try { _animSignsCloseEditor(); } catch (_) {}
        _animSignForceIdx = -1;
        _animSignMetas = [];
        try { _animSignsSave([]); } catch (_) {}       // Schild-Daten leeren
        try { _animSignsDetach(); } catch (_) {}        // Layer + Bilder von der Karte
        try { _animSignsRenderList(); } catch (_) {}    // Sidebar-Liste leeren
        try { if (map && map.triggerRepaint) map.triggerRepaint(); } catch (_) {}
      },
    };
    // v0.9.81 — Helper als window-API exposen, damit runTimelinePreview's
    // step() + scrubPreview() sie aufrufen können. Die Funktions-Definitions
    // selbst leben innerhalb dieses if-Blocks (= onMapReady-Closure-Scope) und
    // sind von OUTSIDE this block aus NICHT zugreifbar — ReferenceError im
    // step() wurde von dessen try/catch silent verschluckt, das war der Grund
    // warum Phase-2-Filter nicht aktualisiert wurde während des Probe-Laufs.
    window.__rzAnimPhotos = {
      show: _animPhotosShow,
      list: _animPhotosList,
      applyToMap: _animPhotosApplyToMap,
      updateMarkerFilter: _animPhotosUpdateMarkerFilter,
      markerAnchorFromTimeline: _animPhotosMarkerAnchor,
    };
    // v0.9.74/76 — Thumbs refreshen + auf Map applizieren, sobald Map ready.
    // attachToMap selbst hat einen isStyleLoaded-Guard, aber wir warten
    // hier zusätzlich noch onMapReady ab um Race-Conditions zu vermeiden.
    if (typeof onMapReady === "function" && map) {
      onMapReady(map, () => {
        // Etwas Delay damit sessionActivate auch durch ist und _activeProject
        // gesetzt wurde.
        setTimeout(() => {
          _animPhotosRefreshThumbsAfterRestore();
          _animSignsAttachToMap(); _animSignsRenderList();   // v0.9.171
        }, 200);
      });
    } else {
      setTimeout(() => { _animPhotosRefreshThumbsAfterRestore(); }, 400);
    }

    // v0.8.0: Hook für Projekt-Wechsel-Updates (wird von projects.js gerufen).
    // Setzt Animator-spezifischen UI-State neu, der nicht über bindSetting
    // abgedeckt ist (Keyframe-Pins, Timeline-Bar, Editor-Selection).
    window._animOnProjectChanged = function() {
      _selectedKfIdx = null;
      _selectedEvent = null;
      // v0.9.66: Undo-Historie pro Projekt — beim Wechsel komplett leeren.
      _animResetUndoStacks();
      // v0.8.16 — Master-Toggle initial: wenn das Projekt timeline_events hat
      // aber kein `keyframes_enabled` gesetzt ist (= aus älterer App-Version),
      // setze es automatisch auf true damit der User seine KFs nicht verliert.
      migrateKeyframesEnabledIfNeeded();
      // v0.8.11 — Beim Projekt-Wechsel: alte Anker ggf. von Track→Timeline
      // umrechnen (idempotent via Flag).
      migrateTimelineAnchorsIfNeeded();
      // v0.8.12 — Wenn das Projekt noch track_style=tube hatte, ins
      // line_style mergen.
      migrateTrackStyleToLineStyleIfNeeded();
      // v0.9.0 — camera-events → property-events
      migrateCameraToPropertyEventsIfNeeded();
      if (_tlBar) {
        _tlBar.refresh();
        _tlBar.setSelected(null);
        if (_tlBar.updateStatusLabel) _tlBar.updateStatusLabel();
        // Anim/Hold-Trenner für das neue Projekt nachziehen.
        // v0.9.62: zweites Argument introFraction() mitgeben, sonst bleibt
        // ti=0 stehen (Intro-Region wird beim Projektwechsel nicht angezeigt).
        if (_tlBar.setTrackFraction) _tlBar.setTrackFraction(trackFraction(), introFraction());
        // v0.9.11 — Voller-Track-Toggle aus dem neuen Projekt übernehmen
        if (_tlBar.setFullTrack) _tlBar.setFullTrack(previewFullTrack());
        // v0.9.15 — KF-Pins-Toggle aus dem neuen Projekt übernehmen
        if (_tlBar.setShowKfPins) _tlBar.setShowKfPins(previewShowKfPins());
      }
      // v0.9.11 — Preview-Track anhand des neuen Toggle-States rendern
      refreshPreviewTrackData();
      rebuildCameraKeyframePins();
      syncTimelineOverrideUi();
      renderKeyframeEditor();
      // v0.9.23 — paint-Settings re-apply (Linienfarbe, -breite, Shadow,
      // Glow, Style usw.). Sonst bleiben Preview-Layer auf dem Stand vor
      // dem Projekt-Wechsel statt das neue Projekt zu spiegeln.
      applyAllPaintSettings();
      // v0.9.41 — Render-Trim aus Projekt anwenden (KFs außerhalb dimmen,
      // Track-Linie auf Trim-Bereich kürzen).
      applyTrimFromSettings();
      // v0.9.16/17 — Nach Projekt-Wechsel: Auto-Select wenn KFs vorhanden.
      // Helper teilt sich die Logik mit dem App-Mount-Pfad.
      autoSelectFirstKfIfNeeded();
      // v0.8.16: Sichtbarkeit von Timeline-Bar + KF-Section anwenden
      applyKeyframesEnabled();
      // Stil-spezifische applyXxx-Helpers neu triggern damit die Map
      // den aktuellen Projekt-State zeigt
      try {
        applyShadowToLayers();
        applyGlowToLayers();
        applyLineStyle();
        applyHideLabels();
        applyAlphaPreview();
      } catch (_) {}
      // v0.9.74 — Foto-Pins für neues Projekt: UI-Controls auf neue Werte
      // setzen + Thumbs nachholen + auf Map applizieren.
      try {
        const slider = document.getElementById("anim-photos-size");
        const sliderV = document.getElementById("anim-photos-size-v");
        if (slider) slider.value = String(_animPhotosSizePx());
        if (sliderV) sliderV.textContent = `${_animPhotosSizePx()} px`;
        const show = document.getElementById("anim-photos-show");
        if (show) show.checked = _animPhotosShow();
      } catch (_) {}
      _animPhotosRefreshThumbsAfterRestore();
      // v0.9.171 — Schilder fürs neue Projekt: Controls + Marker + Liste neu.
      try {
        const ssl = document.getElementById("anim-signs-size");
        const sslV = document.getElementById("anim-signs-size-v");
        if (ssl) ssl.value = String(_animSignsSizePx());
        if (sslV) sslV.textContent = `${_animSignsSizePx()} px`;
        const ssh = document.getElementById("anim-signs-show");
        if (ssh) ssh.checked = _animSignsShow();
        _animSignsCloseEditor();
        _animSignsSetPlaceMode(false);
        _animSignsAttachToMap();
        _animSignsRenderList();
      } catch (_) {}
      // v0.9.253 — Reiseroute: Start/Ziel + Route-Track aufs neue Projekt
      // ziehen (bzw. bei frischem Projekt zurücksetzen). Vorher fehlte das
      // komplett → neues Projekt übernahm die alte Route ("Duplikat").
      if (_isReiseroute) {
        try { _routeRestore(); } catch (_) {}
        try { _routeRestoreGpx(); } catch (_) {}
      }
    };

    // v0.8.4: Initial-Apply läuft jetzt im onMapReady-Callback oben
    // (zusammen mit rebuildPreviewLayers) — kein separater Block hier.
  });

  // ── Live-Preview-Wiring ───────────────────────────────────────────────
  // Alle Settings-Inputs reagieren direkt auf die Vorschau-Karte.

  document.getElementById("anim-style").addEventListener("change", e => {
    applyStyle(e.target.value);
  });
  // Pitch/Bearing-Änderung: NUR Wert setzen, KEIN Refit. Sonst springt
  // die Map zurück auf Bbox-Mitte und überschreibt was der User manuell
  // gepant hat. Render nutzt override_center+override_zoom aus der
  // Preview-Position, daher ist WYSIWYG ohnehin gesichert (Mapbox
  // berechnet beim Render nicht selbständig neuen Zoom).
  // Für expliziten Refit auf den Track: ⤢-Button unten rechts.
  document.getElementById("anim-pitch").addEventListener("input", e => {
    if (map) map.setPitch(parseFloat(e.target.value) || 0);
  });
  document.getElementById("anim-refit")?.addEventListener("click", () => {
    if (currentBbox) {
      fitTrackPreview(true);
      // v0.8.9: Refit zeigt zusätzlich die GANZE Track-Linie (= „Reset"
      // für Track-Trim, der nach Scrubber-Aktionen erhalten bleibt)
      if (map && currentCoords) {
        try {
          const src = map.getSource("preview-track");
          if (src) src.setData({
            type: "Feature",
            geometry: { type: "LineString", coordinates: currentCoords },
          });
        } catch (_) {}
      }
    } else {
      toast(t("animator.stats.empty_hint"), "info", 2000);
    }
  });
  document.getElementById("anim-rot").addEventListener("input", e => {
    // Im Render macht das Backend einen Sweep, in der Preview zeigen wir
    // das End-Bearing nur informativ — wird beim Render-Snapshot ignoriert
    // (Backend nutzt eigenes Start-Bearing -10 für die Animation).
    if (map) map.setBearing(parseFloat(e.target.value) || 0);
  });
  document.getElementById("anim-ex").addEventListener("input", () => {
    applyTerrain();
  });
  document.getElementById("anim-terrain").addEventListener("change", () => {
    applyTerrain();
  });
  // Karten-Feinabstimmung-Akkordeon — Bindings + Toggle-Logic siehe oben.
  document.getElementById("anim-color").addEventListener("input", () => {
    applyLineColorToLayers();
    renderOverlayPreview();   // Akzentfarbe in der Live-Stat (Zurückgelegt) etc.
  });
  document.getElementById("anim-lw").addEventListener("input", () => {
    applyLineWidthToLayers();
    applyShadowToLayers();   // Schatten-Breite skaliert mit Track-Breite
  });
  // Schatten-Live-Sync (Checkbox + Slider)
  document.getElementById("anim-shadow-enabled")?.addEventListener("change", () => {
    applyShadowToLayers();
  });
  document.getElementById("anim-shadow-strength")?.addEventListener("input", () => {
    applyShadowToLayers();
  });
  // Alpha-Modus ist seit v0.6.0 ein Karten-Stil — Style-Change ruft
  // ohnehin schon applyStyle() → das ruft applyAlphaPreview() im neuen
  // rebuildPreviewLayers indirekt.
  // Punkte-Slider-Live-Sync: bei jedem Drag den Preview-Track neu auflösen.
  // `input` feuert kontinuierlich beim Ziehen — visuell smooth.
  document.getElementById("anim-pointcount")?.addEventListener("input", () => {
    applyPointCountToPreview();
  });
  // v0.9.21 — Slider-Wert ans aktive Projekt speichern (debounced via
  // saveProjectSettings's internem Patch-Akkumulator → kein Spam). 0 = alle.
  document.getElementById("anim-pointcount")?.addEventListener("change", () => {
    const sl = document.getElementById("anim-pointcount");
    if (!sl || sl.disabled) return;
    const v = parseInt(sl.value);
    const mx = parseInt(sl.max);
    const toSave = (v >= mx) ? 0 : v;
    if (typeof saveProjectSettings === "function") {
      saveProjectSettings(_MODKEY, { point_count: toSave });
    } else if (typeof saveSettings === "function") {
      saveSettings({ animator: { point_count: toSave } });
    }
  });
  // Overlay-Settings live spiegeln
  ["anim-overlays",
   "anim-ov-totals", "anim-ov-totals-pos",
   "anim-ov-live", "anim-ov-live-pos",
   "anim-ov-ele", "anim-ov-ele-pos",
   // v0.9.228 — Zeitfenster-Inputs: bei Änderung Preview neu (zeigt im
   // Probelauf das Ein-/Ausblenden).
   "anim-ov-totals-from", "anim-ov-totals-to",
   "anim-ov-live-from", "anim-ov-live-to",
   "anim-ov-ele-from", "anim-ov-ele-to"
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", () => renderOverlayPreview());
  });

  /** Blendet die granularen Overlay-Konfig-Zeilen (Totals/Live/Höhenprofil
   *  + Positionen) aus, sobald der Master-Toggle „Stats-Overlays anzeigen"
   *  aus ist. Sonst wirkt das Panel verwirrend („warum kann ich Position
   *  ändern wenn die Overlays eh aus sind?"). */
  function syncOverlayConfigVisibility() {
    const master = document.getElementById("anim-overlays")?.checked ?? true;
    const groups = document.getElementById("anim-overlay-groups");
    if (groups) groups.hidden = !master;
  }
  document.getElementById("anim-overlays")?.addEventListener("change", syncOverlayConfigVisibility);
  syncOverlayConfigVisibility();   // initial — Settings sind hier schon geladen

  // GPX-Statistiken merken — werden für die Overlay-Live-Vorschau gebraucht.
  let _gpxStats = null;
  let _gpxElevations = null;

  // ── v0.9.321 Stats-Editor ────────────────────────────────────────────────
  // Feld-Katalog — Spiegel von core/animator.py (OVERLAY_LIVE/TOTAL_FIELDS).
  // Bei Änderung BEIDE pflegen. req: "none" | "time" | "ele".
  const OVERLAY_FIELD_CATALOG = {
    live: [
      { id: "dist_done", req: "none" }, { id: "dist_left", req: "none" },
      { id: "speed", req: "time" }, { id: "time_elapsed", req: "time" }, { id: "time_left", req: "time" },
      { id: "ele_now", req: "ele" }, { id: "grade", req: "ele" },
    ],
    totals: [
      { id: "dist_total", req: "none" }, { id: "duration", req: "time" },
      { id: "avg_speed", req: "time" }, { id: "max_speed", req: "time" },
      { id: "elev_gain", req: "ele" }, { id: "elev_loss", req: "ele" },
      { id: "ele_high", req: "ele" }, { id: "ele_low", req: "ele" },
    ],
  };
  const OVERLAY_DEFAULT_FIELDS = {
    live: ["dist_done", "time_elapsed", "ele_now"],
    totals: ["dist_total", "duration", "elev_gain", "elev_loss", "ele_high"],
  };
  const _OV_FALLBACK_LABEL = {
    dist_done: "Zurückgelegt", dist_left: "Verbleibend", speed: "Tempo",
    time_elapsed: "Vergangen", time_left: "Restzeit", ele_now: "Höhe", grade: "Steigung",
    dist_total: "Strecke", duration: "Zeit", avg_speed: "Ø Tempo", max_speed: "Max. Tempo",
    elev_gain: "Bergauf", elev_loss: "Bergab", ele_high: "Höchster Punkt", ele_low: "Tiefster Punkt",
  };
  const _ovFieldLabel = (id) => t("animator.statsfield." + id, _OV_FALLBACK_LABEL[id] || id);
  const _ovHasTime = () => !!(_gpxStats && _gpxStats.duration_s > 0);
  const _ovHasEle = () => !!(_gpxStats && _gpxStats.ele_max != null);
  const _ovAvail = (req) => req === "time" ? _ovHasTime() : req === "ele" ? _ovHasEle() : true;
  const _ovFmtKm = (km) => km < 100 ? km.toFixed(1) + " km" : km.toFixed(0) + " km";
  const _ovFmtDur = (sec) => { sec = Math.max(0, Math.floor(sec)); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), x = sec % 60, p = n => n < 10 ? "0" + n : "" + n; return h > 0 ? h + ":" + p(m) + ":" + p(x) : p(m) + ":" + p(x); };
  // Font-Stacks (Spiegel von core/animator.py _OVERLAY_FONTS). Google-Fonts werden
  // in der App-WebView wie im Render per <link>/@import geladen; hier reicht der Stack.
  const OVERLAY_FONT_STACK = {
    system: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif",
    nunito: "'Nunito', sans-serif", quicksand: "'Quicksand', sans-serif",
    fredoka: "'Fredoka', sans-serif", oswald: "'Oswald', sans-serif", bebas: "'Bebas Neue', sans-serif",
  };
  function _ovHexRgba(hex, a) {
    let h = String(hex || "#000000").replace("#", "");
    if (h.length === 3) h = h.split("").map(c => c + c).join("");
    const r = parseInt(h.slice(0, 2), 16) || 0, g = parseInt(h.slice(2, 4), 16) || 0, b = parseInt(h.slice(4, 6), 16) || 0;
    return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
  }

  // Gespeicherte Auswahl (Projekt) → {order:[alle ids in Reihenfolge], on:Set}
  function _ovReadOrder(box) {
    const cat = OVERLAY_FIELD_CATALOG[box].map(f => f.id);
    let saved = _activeProject?.[_MODKEY]?.["overlay_" + box + "_fields"];
    if (!Array.isArray(saved) || !saved.length) saved = OVERLAY_DEFAULT_FIELDS[box];
    saved = saved.filter(id => cat.includes(id));
    const on = new Set(saved);
    const order = saved.concat(cat.filter(id => !on.has(id)));
    return { order, on };
  }
  // Aktuelle Auswahl aus dem DOM (Reihenfolge + nur angehakte, verfügbare Felder)
  function _ovGetFields(box) {
    const cont = document.getElementById("anim-ov-" + box + "-fields");
    if (!cont) return OVERLAY_DEFAULT_FIELDS[box].slice();
    return Array.from(cont.querySelectorAll(".ov-fieldrow"))
      .filter(r => !r.classList.contains("unavail") && r.querySelector("input")?.checked)
      .map(r => r.dataset.fid);
  }
  function _ovPersist(box) {
    saveProjectSettings(_MODKEY, { ["overlay_" + box + "_fields"]: _ovGetFields(box) });
  }
  let _ovDragEl = null;
  function _ovBuildEditor(box) {
    const cont = document.getElementById("anim-ov-" + box + "-fields");
    if (!cont) return;
    const { order, on } = _ovReadOrder(box);
    cont.innerHTML = order.map(id => {
      const f = OVERLAY_FIELD_CATALOG[box].find(x => x.id === id);
      const avail = _ovAvail(f.req);
      const checked = on.has(id) && avail;
      return `<div class="ov-fieldrow${avail ? "" : " unavail"}" draggable="${avail ? "true" : "false"}" data-fid="${id}">`
        + `<span class="ov-grip" title="${t("animator.overlay.reorder", "Ziehen zum Sortieren")}">⠿</span>`
        + `<label class="ov-fieldlbl"><input type="checkbox" ${checked ? "checked" : ""} ${avail ? "" : "disabled"}>`
        + `<span>${_ovFieldLabel(id)}</span></label>`
        + (avail ? "" : `<span class="ov-unavail">${t("animator.statsfield.unavail", "—")}</span>`)
        + `</div>`;
    }).join("");
    // Checkbox-Änderung
    cont.querySelectorAll(".ov-fieldrow input").forEach(cb => {
      cb.addEventListener("change", () => { _ovPersist(box); renderOverlayPreview(); });
    });
    // Drag-Sortierung
    cont.querySelectorAll(".ov-fieldrow").forEach(row => {
      row.addEventListener("dragstart", (e) => { _ovDragEl = row; row.classList.add("ov-dragging"); try { e.dataTransfer.effectAllowed = "move"; } catch (_) {} });
      row.addEventListener("dragend", () => { row.classList.remove("ov-dragging"); _ovDragEl = null; _ovPersist(box); renderOverlayPreview(); });
      row.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (!_ovDragEl || _ovDragEl === row || row.parentElement !== cont) return;
        const rect = row.getBoundingClientRect();
        const after = (e.clientY - rect.top) > rect.height / 2;
        cont.insertBefore(_ovDragEl, after ? row.nextSibling : row);
      });
    });
  }
  function _ovRebuildEditors() { _ovBuildEditor("totals"); _ovBuildEditor("live"); }
  // Vorschau-Wert (Endzustand) für ein Feld — WYSIWYG-Annäherung.
  function _ovFieldValue(id) {
    const s = _gpxStats; if (!s) return "—";
    const km = s.distance_km || 0, dur = s.duration_s || 0;
    const avg = dur > 0 ? (km / (dur / 3600)) : 0;
    const lastEle = (_gpxElevations && _gpxElevations.length) ? Math.round(_gpxElevations[_gpxElevations.length - 1]) : (s.ele_max != null ? Math.round(s.ele_max) : null);
    switch (id) {
      case "dist_done": case "dist_total": return _ovFmtKm(km);
      case "dist_left": return _ovFmtKm(0);
      case "speed": case "avg_speed": return Math.round(avg) + " km/h";
      case "max_speed": return "≈ " + Math.round(avg * 1.4) + " km/h";
      case "time_elapsed": case "duration": return _ovFmtDur(dur);
      case "time_left": return _ovFmtDur(0);
      case "ele_now": return lastEle != null ? lastEle + " m" : "—";
      case "grade": return "0 %";
      case "elev_gain": return "↑ " + Math.round(s.ascent_m || 0) + " m";
      case "elev_loss": return "↓ " + Math.round(s.descent_m || 0) + " m";
      case "ele_high": return s.ele_max != null ? Math.round(s.ele_max) + " m" : "—";
      case "ele_low": return s.ele_min != null ? Math.round(s.ele_min) + " m" : "—";
    }
    return "—";
  }
  // Initialer Editor-Aufbau — hier sind Katalog-Consts + _gpxStats sicher initialisiert.
  _ovRebuildEditors();

  /** Spiegelt die Render-Overlays als HTML-Layer auf der Preview-Karte.
   *  Wird gerufen bei Mount, GPX-Load, Color-/Toggle-/Position-Change. */
  function renderOverlayPreview() {
    const layer = document.getElementById("anim-overlay-preview");
    if (!layer) return;
    // v0.9.215 — Reiseroute hat keine Stats-Overlays (Sektion entfernt). Ohne
    // diesen Guard liefert `?.checked ?? true` für die fehlenden Checkboxen
    // `true` → Overlays würden fälschlich angezeigt.
    if (_isReiseroute) { layer.innerHTML = ""; return; }
    const master = document.getElementById("anim-overlays")?.checked ?? true;
    const totals = document.getElementById("anim-ov-totals")?.checked ?? true;
    // v0.9.309 — im Standbild (Tour-Map) keine Live-Box (zeit-animiert).
    const live   = !_isStaticFrame && (document.getElementById("anim-ov-live")?.checked ?? true);
    const ele    = document.getElementById("anim-ov-ele")?.checked ?? true;
    const posT   = document.getElementById("anim-ov-totals-pos")?.value || "tl";
    const posL   = document.getElementById("anim-ov-live-pos")?.value || "tr";
    const posE   = document.getElementById("anim-ov-ele-pos")?.value || "bc";
    const color  = currentLineColor();

    if (!master) { layer.innerHTML = ""; return; }

    // Stats: echte Zahlen wenn GPX geladen, sonst Demo-Werte als Platzhalter
    const s = _gpxStats;
    const fmtKmLocal = (km) => km < 100 ? km.toFixed(1) + " km" : km.toFixed(0) + " km";
    const fmtDurLocal = (sec) => {
      sec = Math.max(0, Math.floor(sec));
      const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), x = sec % 60;
      const pad = n => n < 10 ? "0" + n : "" + n;
      return h > 0 ? h + ":" + pad(m) + ":" + pad(x) : pad(m) + ":" + pad(x);
    };
    const distTxt = s ? fmtKmLocal(s.distance_km) : "—";
    const dur     = s ? s.duration_s : 0;
    const durTxt  = s ? fmtDurLocal(dur) : "—";
    const ascTxt  = s ? Math.round(s.ascent_m) + " m"  : "—";
    const descTxt = s ? Math.round(s.descent_m) + " m" : "—";
    const eleMaxTxt = s && s.ele_max != null ? Math.round(s.ele_max) + " m" : "—";

    // v0.9.290 (Nutzer): ruhende Vorschau zeigt den ENDZUSTAND (100 %, = letzter
    // Frame) statt 50 %. Die alten 50 %-Demowerte sahen aus wie echte „schon
    // halbe Strecke gefahren"-Daten und verwirrten vor dem Render. Die animierte
    // Vorschau (Probe-Lauf) und der Render selbst zählen weiterhin korrekt 0→Ende.
    const liveDistTxt = s ? fmtKmLocal(s.distance_km) : "0.0 km";
    const liveTimeTxt = s ? fmtDurLocal(dur) : "00:00";
    const liveEleTxt  = (_gpxElevations && _gpxElevations.length)
      ? Math.round(_gpxElevations[_gpxElevations.length - 1]) + " m"
      : (s && s.ele_max != null ? Math.round(s.ele_max) + " m" : "0 m");

    // Höhenprofil-SVG: einfache Polyline aus _gpxElevations (v0.9.290: 100% =
    // Endzustand gefüllt, passend zur Live-Stat oben).
    let eleSvg = "";
    if (ele && _gpxElevations && _gpxElevations.length > 1) {
      const W = 1000, H = 120, PY = 10;
      const eMin = Math.min(..._gpxElevations);
      const eMax = Math.max(..._gpxElevations);
      const eRng = (eMax - eMin) || 1;
      const yOf = (e) => H - PY - ((e - eMin) / eRng) * (H - PY * 2);
      const xOf = (i) => (i / Math.max(1, _gpxElevations.length - 1)) * W;
      const bgPts = _gpxElevations.map((e, i) => `${xOf(i).toFixed(1)},${yOf(e).toFixed(1)}`).join(" ");
      const half = _gpxElevations.length;   // v0.9.290: voll gefüllt (Endzustand)
      const activePairs = [];
      for (let i = 0; i < half; i++) activePairs.push([xOf(i), yOf(_gpxElevations[i])]);
      const activePts = activePairs.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
      const fillPts = activePairs.length >= 2
        ? `${activePairs[0][0].toFixed(1)},${H} ${activePts} ${activePairs[activePairs.length - 1][0].toFixed(1)},${H}`
        : "";
      const dotX = activePairs.length ? activePairs[activePairs.length - 1][0].toFixed(1) : 0;
      const dotY = activePairs.length ? activePairs[activePairs.length - 1][1].toFixed(1) : 0;
      eleSvg = `
        <div class="ov-ele-header">
          <span class="ov-ele-title">${t("animator.overlay.elevation_title")}</span>
          <span class="ov-ele-minmax">Min ${Math.round(eMin)} m · Max ${Math.round(eMax)} m</span>
        </div>
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="ov-ele-svg">
          <defs>
            <linearGradient id="ov-ele-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="${color}" stop-opacity="0.55"/>
              <stop offset="100%" stop-color="${color}" stop-opacity="0.02"/>
            </linearGradient>
          </defs>
          <polyline points="${bgPts}" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
          <polygon points="${fillPts}" fill="url(#ov-ele-grad)"/>
          <polyline points="${activePts}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
          <circle cx="${dotX}" cy="${dotY}" r="4.5" fill="#ffffff" stroke="${color}" stroke-width="2"/>
        </svg>`;
    }

    // v0.9.321 — globales Styling (Schrift/Textfarbe/BG/Opacity) auf alle Boxen
    const fontKey = document.getElementById("anim-ov-font")?.value || "system";
    const fontFam = OVERLAY_FONT_STACK[fontKey] || OVERLAY_FONT_STACK.system;
    const txtCol  = document.getElementById("anim-ov-textcolor")?.value || "#ffffff";
    const bgCol   = document.getElementById("anim-ov-bgcolor")?.value || "#000000";
    const bgOpac  = (parseFloat(document.getElementById("anim-ov-bgopacity")?.value) || 55) / 100;
    const boxStyle = `font-family:${fontFam}; color:${txtCol}; background:${_ovHexRgba(bgCol, bgOpac)};`;
    // v0.9.321 — katalog-getriebene, sortierbare Felder pro Box (Endzustand-Werte)
    const rowsHtml = (box) => _ovGetFields(box).map(id => {
      const accent = (id === "dist_done") ? ` style="color:${color}"` : "";
      return `<div class="ov-row"><span class="ov-l">${_ovFieldLabel(id)}</span><span class="ov-v"${accent}>${_ovFieldValue(id)}</span></div>`;
    }).join("");

    let html = "";
    if (totals) { const r = rowsHtml("totals"); if (r) html += `<div class="ov-box pos-${posT}" data-ovbox="totals" style="${boxStyle}">${r}</div>`; }
    if (live)   { const r = rowsHtml("live");   if (r) html += `<div class="ov-box pos-${posL}" data-ovbox="live" style="${boxStyle}">${r}</div>`; }
    if (ele && eleSvg) {
      html += `<div class="ov-ele-box pos-${posE}" data-ovbox="ele" style="${boxStyle}">${eleSvg}</div>`;
    }
    layer.innerHTML = html;
  }

  // v0.9.228 — Preview-WYSIWYG für Beta-Testers Overlay-Zeitfenster: blendet die
  // Vorschau-Boxen im Probelauf nach Video-Sekunde ein/aus (analog zum Render
  // window.__overlayTiming). tSec = aktuelle Video-Sekunde (intro+anim+hold).
  // to<=0 = bis Ende. Bei tSec<0 (kein Probelauf aktiv) alle wieder sichtbar.
  function _animOverlayTimingPreview(tSec) {
    const layer = document.getElementById("anim-overlay-preview");
    if (!layer) return;
    const num = (id) => parseFloat(document.getElementById(id)?.value) || 0;
    const wins = {
      totals: [num("anim-ov-totals-from"), num("anim-ov-totals-to")],
      live:   [num("anim-ov-live-from"),   num("anim-ov-live-to")],
      ele:    [num("anim-ov-ele-from"),    num("anim-ov-ele-to")],
    };
    for (const key of Object.keys(wins)) {
      const el = layer.querySelector(`[data-ovbox="${key}"]`);
      if (!el) continue;
      if (tSec < 0) { el.style.visibility = ""; continue; }
      const w = wins[key];
      const vis = (tSec >= w[0]) && (w[1] <= 0 || tSec <= w[1]);
      el.style.visibility = vis ? "" : "hidden";
    }
  }

  async function loadGpxByPath(path) {
    const res = await api().animator_load_gpx(path);
    if (!res.ok) { toast(res.error || "GPX-Fehler", "error"); return; }
    currentGpx = path;
    _gpxStats = res.stats;
    _gpxElevations = res.elevations || (res.coords ? res.coords.map(() => 0) : []);
    try { _ovRebuildEditors(); } catch (_) {}   // v0.9.321 — Feld-Verfügbarkeit aktualisieren
    // Stats-Bar umschalten: Empty-Hint aus, Karten an
    document.getElementById("anim-stats-empty").hidden = true;
    document.getElementById("anim-stats-cards").hidden = false;
    document.getElementById("s-dist").textContent = fmtKm(res.stats.distance_km * 1000);
    document.getElementById("s-time").textContent = fmtDur(res.stats.duration_s);
    document.getElementById("s-asc").textContent = "↑ " + fmtMeter(res.stats.ascent_m);
    document.getElementById("s-desc").textContent = "↓ " + fmtMeter(res.stats.descent_m);
    document.getElementById("anim-render").disabled = false;

    if (map && map.isStyleLoaded()) drawPreview(res);
    else if (map) map.once("load", () => drawPreview(res));
    renderOverlayPreview();  // jetzt haben wir Stats → echte Werte zeigen

    // Punkte-Slider auf den geladenen Track kalibrieren.
    // Max-Wert = volle Punkte-Anzahl des Tracks (aus stats.n_points).
    // Initial: voll rechts (alle Punkte). User kann reduzieren.
    configurePointCountSlider(res.stats.n_points);

    toast("GPX geladen: " + res.name, "success", 2500);
  }

  /** Linear-resample: nimmt aus `arr` exakt `target` gleichmäßig verteilte
   * Elemente. Erstes und letztes bleiben erhalten. Effizient O(target). */
  function resampleArray(arr, target) {
    if (target >= arr.length) return arr;
    if (target < 2) return arr.length ? [arr[0]] : [];
    const step = (arr.length - 1) / (target - 1);
    const out = new Array(target);
    for (let i = 0; i < target; i++) out[i] = arr[Math.round(i * step)];
    return out;
  }

  function configurePointCountSlider(nPoints) {
    const sl = document.getElementById("anim-pointcount");
    const lbl = document.getElementById("anim-pointcount-v");
    if (!sl || !lbl) return;
    // Min = 10 (sonst sieht der Track aus wie ein Polygon mit 5 Ecken).
    // Wenn der Track sehr klein ist (< 10 Punkte): Slider unsinnig — deaktivieren.
    if (!nPoints || nPoints < 20) {
      sl.disabled = true;
      lbl.textContent = nPoints ? `${nPoints} / ${nPoints}` : "— / —";
      return;
    }
    sl.disabled = false;
    sl.min = 10;
    sl.max = nPoints;
    // v0.9.21 — persistierten Wert aus dem aktiven Projekt restoren statt
    // immer auf max zu setzen. Convention: 0 = „alle Punkte" (Default).
    // Marc-Spec 2026-05-24: „trackpunkte also wenn man reduziert, das wird
    // nicht im projekt/in der session gespeichert".
    const stored = (_activeProject?.[_MODKEY] && "point_count" in _activeProject[_MODKEY])
      ? _activeProject[_MODKEY].point_count
      : (_settingsCache?.[_MODKEY]?.point_count ?? 0);
    const restored = (stored > 0)
      ? Math.min(Math.max(10, stored), nPoints)
      : nPoints;
    sl.value = String(restored);
    lbl.textContent = `${restored} / ${nPoints}`;
    // currentCoords sind die downsampled-800-Punkte aus dem Bridge-Load.
    // Wir merken sie einmal als „voll" — Slider-Drag resampelt davon weiter.
    _fullPreviewCoords = currentCoords ? currentCoords.slice() : [];
    // Falls reduziert: Preview gleich resamplen sodass die Punkte-Optik passt.
    if (restored < nPoints) {
      applyPointCountToPreview();
    }
  }

  // Voll-Coords-Snapshot: 800 Punkte vom Backend (Frontend-Preview-Auflösung).
  // Beim Slider-Drag resampeln wir davon weiter runter — das ist visuell
  // praktisch identisch zum echten Backend-Resampling der Raw-Points.
  let _fullPreviewCoords = [];

  function applyPointCountToPreview() {
    if (!map || !_fullPreviewCoords.length) return;
    const sl = document.getElementById("anim-pointcount");
    const lbl = document.getElementById("anim-pointcount-v");
    if (!sl || sl.disabled) return;
    const v = parseInt(sl.value);
    const maxN = parseInt(sl.max);
    // Map-Source-Update: Preview-Track auf reduzierte Coords umschalten
    let coords = _fullPreviewCoords;
    if (v < maxN) {
      // Wir resampeln aus den 800 Frontend-Coords proportional zu v/maxN.
      const targetIn800 = Math.max(2, Math.round(_fullPreviewCoords.length * (v / maxN)));
      coords = resampleArray(_fullPreviewCoords, targetIn800);
    }
    try {
      const src = map.getSource("preview-track");
      if (src) {
        src.setData({ type: "Feature", geometry: { type: "LineString", coordinates: coords } });
      }
    } catch (_) {}
    if (lbl) lbl.textContent = `${v} / ${maxN}`;
  }

  // v0.9.221 (Reiseroute) — Robuster Restore mit Retry. Problem davor: beim
  // App-Start mountet das Modul VOR dem async GPX-Load + Session-Aktivierung.
  // onGpxLoaded feuerte zwar, aber `getActiveProject()` war noch leer (Session
  // nicht fertig) → _routeRestore las proj=undefined. Lösung: nach GPX-Load
  // pollen, bis das aktive Projekt wirklich Reiseroute-Daten hat, DANN einmalig
  // alles wiederherstellen (Settings, Start/Ziel, Ghost, Route-Track + KFs).
  // v0.9.222 — Handles auf die im whenApiReady-Closure definierten Restore-Fns
  // (werden dort gesetzt, sobald die UI gebunden ist).
  let _rrRouteRestoreFn = null, _rrRouteRestoreGpxFn = null;
  let _rrRestoreTimer = null;
  function _reiserouteRestoreWithRetry() {
    if (!_isReiseroute) return;
    if (_rrRestoreTimer) { clearTimeout(_rrRestoreTimer); _rrRestoreTimer = null; }
    let tries = 0;
    const attempt = () => {
      const proj = (typeof getActiveProject === "function") ? getActiveProject() : null;
      const a = proj && proj[_MODKEY];
      const hasData = !!(a && (a.route_start_text != null || a.route_end_text != null || a.route_gpx_path));
      const fnReady = (typeof _rrRouteRestoreFn === "function");
      // Warten bis (a) Projekt-Daten geladen UND (b) Restore-Fns aus dem
      // whenApiReady-Closure gesetzt sind. Sonst nochmal probieren.
      if ((!hasData || !fnReady) && tries < 20) { tries++; _rrRestoreTimer = setTimeout(attempt, 150); return; }
      _rrRestoreTimer = null;
      try { if (typeof rebindAllSettings === "function") rebindAllSettings(); } catch (_) {}
      try { if (typeof applyAllPaintSettings === "function") applyAllPaintSettings(); } catch (_) {}
      try { if (typeof _rrRouteRestoreFn === "function") _rrRouteRestoreFn(); } catch (e) { try { applog("warn", `[rrRestore] routeRestore warf: ${e}`); } catch (_) {} }
      try { _ghostGpxRestore(); } catch (e) { try { applog("warn", `[rrRestore] ghostRestore warf: ${e}`); } catch (_) {} }
      try { if (typeof _rrRouteRestoreGpxFn === "function") _rrRouteRestoreGpxFn(); } catch (e) { try { applog("warn", `[rrRestore] routeRestoreGpx warf: ${e}`); } catch (_) {} }
    };
    attempt();
  }

  // v0.8.1: GPX-Picker ist global in der Sub-Top-Bar. Hier hören wir
  // nur auf das Event und übernehmen das geladene GPX für den Animator.
  if (typeof onGpxLoaded === "function") {
    onGpxLoaded(({ path, data }) => {
      if (path && data) {
        // Synthetisches `res`-Objekt analog zum bisherigen loadGpxByPath-Flow
        // v0.9.220 — GESCHÜTZT: wirft applyGlobalGpx (Ghost/fit vor Map-Ready),
        // brach vorher der ganze cb ab → kein Restore + keine KFs/Timeline.
        try { applyGlobalGpx(path, data); } catch (e) { try { applog("warn", `[onGpxLoaded] applyGlobalGpx warf: ${e}`); } catch (_) {} }
        // v0.9.221 — Reiseroute-Restore robust per Retry (s.o.), statt synchron
        // direkt hier (lief vorher zu früh, proj war noch leer).
        if (_isReiseroute) { try { _reiserouteRestoreWithRetry(); } catch (_) {} }
      } else {
        // GPX geschlossen → State zurücksetzen
        currentGpx = null;
        currentCoords = null;
        currentBbox = null;
        _gpxStats = null;
        _gpxElevations = [];
        try {
          document.getElementById("anim-stats-empty").hidden = false;
          document.getElementById("anim-stats-cards").hidden = true;
          document.getElementById("anim-render").disabled = true;
        } catch (_) {}
        // v0.9.185 — Schilder via lebenden Handle leeren (closure-sicher).
        try { if (window.__rzAnimSigns && window.__rzAnimSigns.clearAll) window.__rzAnimSigns.clearAll(); } catch (_) {}
      }
    });
  }
  // v0.8.2: Initial-Apply beim Modul-Mount wird im whenApiReady()-Block
  // gemacht (nach Map-Init). Sync hier wäre zu früh — `map` ist null.

  // v0.8.12 — Migration: alte Projekte hatten line_style + separates
  // track_style="tube". Jetzt ist „tube" Teil von line_style. Wenn ein
  // Projekt track_style="tube" hat (egal welcher line_style), setzen wir
  // line_style="tube" und entfernen track_style aus dem Cache.
  // v0.9.0 — Multi-Track-Migration (Marc-Plan A 2026-05-23):
  // Alte `{kind:"camera"}`-Events bündelten alle 4 Properties (pitch/bearing/
  // zoom_offset/center) in einem Event. Mit der Multi-Track-Timeline hat
  // jede Property ihre eigene Spur — Datenmodell wird zu Property-Events:
  //   {kind:"pitch",   anchor, value}
  //   {kind:"bearing", anchor, value}
  //   {kind:"zoom",    anchor, value_offset}
  //   {kind:"center",  anchor, value:[lon,lat] | null}
  //
  // Migration läuft on-load idempotent via Flag `timeline_schema_v: 2`.
  function migrateCameraToPropertyEventsIfNeeded() {
    const proj = (typeof getActiveProject === "function") ? getActiveProject() : null;
    const anim = (proj && proj[_MODKEY]) || _settingsCache?.[_MODKEY];
    if (!anim) return;
    if (anim.timeline_schema_v === 2) return;
    const events = Array.isArray(anim.timeline_events) ? anim.timeline_events : [];
    const cameraEvents = events.filter(e => e && e.kind === "camera");
    if (cameraEvents.length === 0) {
      // Nichts zu migrieren — Flag setzen damit's nicht beim nächsten Load
      // wieder geprüft wird
      anim.timeline_schema_v = 2;
      return;
    }
    applog("info", `[migrate v2] camera→property events, n=${cameraEvents.length}`);
    const newEvents = events.filter(e => e && e.kind !== "camera");
    for (const cam of cameraEvents) {
      const anchor = cam.anchor || 0;
      const easing = cam.easing || "linear";
      newEvents.push({ kind: "pitch",   anchor, value: cam.pitch ?? 40,    easing });
      newEvents.push({ kind: "bearing", anchor, value: cam.bearing ?? 0,   easing });
      // v0.9.73 — value_absolute fehlt bei alter Migration. Wird beim
      // ersten Apply lazy aus `value_offset + fitBase` ergänzt. Bis dahin
      // bleibt das alte (offset-only) Verhalten — reload-Stabilität greift
      // erst nach manuellem Neu-Setzen des KFs.
      newEvents.push({ kind: "zoom",    anchor, value_offset: cam.zoom_offset ?? 0, easing });
      // center: nur Event wenn explizit gesetzt — sonst Track-Folgen
      if (cam.center) {
        newEvents.push({ kind: "center", anchor, value: cam.center, easing });
      }
    }
    newEvents.sort((a, b) => (a.anchor || 0) - (b.anchor || 0));
    anim.timeline_events = newEvents;
    anim.timeline_schema_v = 2;
    try {
      if (typeof saveProjectSettings === "function" && typeof getActiveSession === "function" && getActiveSession()) {
        saveProjectSettings(_MODKEY, { timeline_events: newEvents, timeline_schema_v: 2 });
      } else if (typeof saveSettings === "function") {
        saveSettings({ animator: { timeline_events: newEvents, timeline_schema_v: 2 } });
      }
    } catch (e) { applog("warn", `[migrate v2] save failed: ${e}`); }
  }

  // v0.9.0 — Helpers für Property-Events
  // v0.9.83 — spin als 5. KF-Property (deg/sec). Wird zwischen KFs linear
  // interpoliert. Akkumuliert sich pro Frame zum Bearing on top.
  const KF_LANES = ["pitch", "bearing", "zoom", "center", "position"];
  function eventsByKind(kind) {
    return getRawTimelineEvents()
      .filter(e => e && e.kind === kind)
      .sort((a, b) => (a.anchor || 0) - (b.anchor || 0));
  }

  // v0.8.16 — Wenn ein Projekt timeline_events hat aber `keyframes_enabled`
  // gar nicht gesetzt ist (= aus älterer App-Version vor v0.8.16), aktivieren
  // wir den Editor automatisch, damit der User seine KFs sieht. Wenn das Feld
  // explizit auf false steht, lassen wir es so (User hat aktiv ausgeschaltet).
  function migrateKeyframesEnabledIfNeeded() {
    const proj = (typeof getActiveProject === "function") ? getActiveProject() : null;
    const anim = (proj && proj[_MODKEY]) || _settingsCache?.[_MODKEY];
    if (!anim) return;
    if ("keyframes_enabled" in anim) return;  // schon migriert
    const hasEvents = Array.isArray(anim.timeline_events) && anim.timeline_events.length > 0;
    anim.keyframes_enabled = hasEvents;
    // DOM-Checkbox nachziehen
    const cb = document.getElementById("anim-kf-enabled");
    if (cb) cb.checked = hasEvents;
    try {
      if (typeof saveProjectSettings === "function" && typeof getActiveSession === "function" && getActiveSession()) {
        saveProjectSettings(_MODKEY, { keyframes_enabled: hasEvents });
      } else if (typeof saveSettings === "function") {
        saveSettings({ animator: { keyframes_enabled: hasEvents } });
      }
    } catch (e) { applog("warn", `[migrate kf-enabled] save failed: ${e}`); }
    applog("info", `[migrate kf-enabled] hasEvents=${hasEvents} → keyframes_enabled=${hasEvents}`);
  }

  function migrateTrackStyleToLineStyleIfNeeded() {
    const proj = (typeof getActiveProject === "function") ? getActiveProject() : null;
    const anim = (proj && proj[_MODKEY]) || _settingsCache?.[_MODKEY];
    if (!anim) return;
    if (anim.track_style === "tube" && anim.line_style !== "tube") {
      applog("info", "[migrate] track_style=tube → line_style=tube (v0.8.12)");
      anim.line_style = "tube";
      anim.track_style = "flat";
      // DOM ggf. nachziehen (rebindAllSettings hat schon den alten Wert gesetzt)
      const sel = document.getElementById("anim-line-style");
      if (sel) sel.value = "tube";
      try {
        if (typeof saveProjectSettings === "function" && typeof getActiveSession === "function" && getActiveSession()) {
          saveProjectSettings(_MODKEY, { line_style: "tube", track_style: "flat" });
        } else if (typeof saveSettings === "function") {
          saveSettings({ animator: { line_style: "tube", track_style: "flat" } });
        }
      } catch (e) { applog("warn", `[migrate] save failed: ${e}`); }
    }
  }

  // v0.8.11 — Migration: bestehende Projekte hatten anchor = Track-Anteil,
  // ab v0.8.11 ist anchor = Timeline-Anteil (inkl. Hold). Beim Laden eines
  // Projekts skalieren wir die alten Anker einmalig um den Faktor
  // `track_fraction = dur/(dur+hold)`. Idempotent über das Flag
  // `timeline_anchor_v: 2` im Animator-Settings-Block.
  function migrateTimelineAnchorsIfNeeded() {
    const proj = (typeof getActiveProject === "function") ? getActiveProject() : null;
    const anim = (proj && proj[_MODKEY]) || _settingsCache?.[_MODKEY];
    if (!anim) return;
    if (anim.timeline_anchor_v === 2) return;
    const events = Array.isArray(anim.timeline_events) ? anim.timeline_events : [];
    if (events.length === 0) {
      anim.timeline_anchor_v = 2;  // ohne Save — beim nächsten Save bleibt's an Bord
      return;
    }
    const dur = parseFloat(anim.duration_s) || 12;
    const hold = parseFloat(anim.hold_s) || 0;
    const tf = dur / Math.max(0.001, dur + hold);
    if (tf >= 0.9999) {
      // hold=0 → Anker bleiben identisch, einfach flaggen.
      anim.timeline_anchor_v = 2;
      return;
    }
    applog("info", `[migrate] timeline anchors track→timeline, factor=${tf.toFixed(3)}, n=${events.length}`);
    const migrated = events.map(ev => Object.assign({}, ev, {
      anchor: Math.max(0, Math.min(1, (ev.anchor || 0) * tf)),
    }));
    anim.timeline_events = migrated;
    anim.timeline_anchor_v = 2;
    // Persistieren (Projekt oder global)
    try {
      if (typeof saveProjectSettings === "function" && typeof getActiveSession === "function" && getActiveSession()) {
        saveProjectSettings(_MODKEY, { timeline_events: migrated, timeline_anchor_v: 2 });
      } else if (typeof saveSettings === "function") {
        saveSettings({ animator: { timeline_events: migrated, timeline_anchor_v: 2 } });
      }
    } catch (e) {
      applog("warn", `[migrate] save failed: ${e}`);
    }
  }

  function applyGlobalGpx(path, res) {
    applog("info", `[applyGlobalGpx] path=${path} n_coords=${res?.coords?.length} mapReady=${map?.isStyleLoaded?.()} mapLoaded=${map?.loaded?.()}`);
    // v0.9.210 (Reiseroute Phase 2) — das geladene GPX wird hier NICHT der
    // animierte Track, sondern der GHOST. Animiert wird die berechnete Route
    // (currentCoords, via _routeCompute → loadGpxByPath). Wenn noch keine Route
    // da ist, fitten wir auf das Ghost-GPX, damit der User sieht wohin's geht.
    if (_isReiseroute) {
      _ghostGpxPath = path;
      _ghostGpxCoords = (res && res.coords) || null;
      _applyGhostGpx();
      if (!currentCoords && res && res.bbox) { currentBbox = res.bbox; try { fitTrackPreview(false); } catch (_) {} }
      return;
    }
    currentGpx = path;
    _gpxStats = res.stats;
    _gpxElevations = res.elevations || (res.coords ? res.coords.map(() => 0) : []);
    try { _ovRebuildEditors(); } catch (_) {}   // v0.9.321 — Feld-Verfügbarkeit aktualisieren
    try {
      document.getElementById("anim-stats-empty").hidden = true;
      document.getElementById("anim-stats-cards").hidden = false;
      document.getElementById("s-dist").textContent = fmtKm(res.stats.distance_km * 1000);
      document.getElementById("s-time").textContent = fmtDur(res.stats.duration_s);
      document.getElementById("s-asc").textContent = "↑ " + fmtMeter(res.stats.ascent_m);
      document.getElementById("s-desc").textContent = "↓ " + fmtMeter(res.stats.descent_m);
      document.getElementById("anim-render").disabled = false;
    } catch (_) {}
    // v0.8.5: applyGlobalGpx wird IMMER aus onMapReady-Callback aufgerufen.
    // Zu dem Zeitpunkt ist `load`-Event garantiert gefeuert. `isStyleLoaded()`
    // ist Mapbox-intern aber unzuverlässig (returnt manchmal false direkt
    // nach load wenn Source-Tiles noch fetched werden). drawPreview macht
    // nur addSource/setData — funktioniert sobald style.json geladen ist,
    // also nach load-Event. Daher: drawPreview DIREKT aufrufen, ohne weitere
    // Gates. Wenn map fehlt (sollte nicht passieren), skip.
    if (map) drawPreview(res);
    else applog("warn", "[applyGlobalGpx] map is null — skipping drawPreview");
    renderOverlayPreview();
    configurePointCountSlider(res.stats.n_points);
  }

  function drawPreview(res) {
    applog("info", `[drawPreview] n_coords=${res?.coords?.length} hasSource=${!!map?.getSource?.("preview-track")}`);
    currentCoords = res.coords;
    currentBbox = res.bbox;
    // v0.9.80 — wenn Track neu geladen wurde, Foto-Pins re-attachen damit
    // die track_anchors für die neue Track-Geometrie berechnet werden.
    // Sonst bleiben track_anchors auf 0 (vom letzten attach ohne coords)
    // und alle Pins sind ab Frame 0 sichtbar.
    // v0.9.81 — via window-Helper (drawPreview ist auch außerhalb der
    // onMapReady-Closure → _animPhotosApplyToMap nicht in scope).
    try {
      setTimeout(() => {
        const ph = window.__rzAnimPhotos;
        if (ph && ph.applyToMap) ph.applyToMap();
        const sg = window.__rzAnimSigns;   // v0.9.171 — Schilder für neue Track-Geometrie re-attachen
        if (sg && sg.attach) { sg.attach(); sg.renderList(); }
      }, 50);
    } catch (_) {}
    // v0.8.0: Session anhand der Track-Koordinaten aktivieren. Wenn der
    // gleiche Track schon mal geladen war, kommt das Standard-Projekt
    // mit allen früheren Settings + Keyframes zurück. Sonst neue Session.
    // v0.9.216 (Reiseroute) — NICHT für die berechnete Route: die würde sonst
    // die Session vom geladenen GPX (Hike) auf die Route-Coords umbiegen → alle
    // Reiseroute-Settings (Start/Ziel, Ghost, Beschriftungen) landen in der
    // falschen Session und gehen verloren. Die Session bleibt die des Hikes.
    // v0.9.219 — Post-Session-Apply: ALLES was nach dem Aktivieren der Session
    // passieren muss (Settings/KFs/Timeline/Paint). Vorher hing das nur am
    // sessionActivate().then() — das hatte ich für Reiseroute mit-gegated, wodurch
    // KFs/Zoom/Timeline-KF-Modus dort fehlten. Jetzt eigene Funktion, die in
    // BEIDEN Modi läuft; nur das Session-AKTIVIEREN bleibt für Reiseroute aus
    // (sonst kapert die Route die Hike-Session).
    const _applySessionState = () => {
      if (typeof rebindAllSettings === "function") rebindAllSettings();
      migrateTimelineAnchorsIfNeeded();
      migrateTrackStyleToLineStyleIfNeeded();
      migrateCameraToPropertyEventsIfNeeded();
      migrateKeyframesEnabledIfNeeded();
      applyKeyframesEnabled();
      if (_tlBar) {
        _tlBar.refresh();
        if (_tlBar.updateStatusLabel) _tlBar.updateStatusLabel();
        if (_tlBar.setTrackFraction) _tlBar.setTrackFraction(trackFraction(), introFraction());
      }
      rebuildCameraKeyframePins();
      syncTimelineOverrideUi();
      applyAllPaintSettings();
      _selectedKfIdx = null;
      _selectedEvent = null;
      renderKeyframeEditor();
      autoSelectFirstKfIfNeeded();
      // v0.9.219 — Reiseroute: Start/Ziel + Ghost zuverlässig nachziehen
      // (Settings stehen jetzt in der aktiven Hike-Session).
      if (_isReiseroute) {
        try { _routeRestore(); } catch (_) {}
        try { _ghostGpxRestore(); } catch (_) {}
      }
    };
    if (!_isReiseroute && typeof sessionActivate === "function") {
      sessionActivate(res.coords, currentGpx || "")
        .then(_applySessionState)
        .catch(err => console.warn("sessionActivate failed:", err));
    } else if (_isReiseroute) {
      // Route aktiviert KEINE eigene Session (kein Hijack), wendet aber den
      // Stand der schon aktiven Hike-Session an.
      try { _applySessionState(); } catch (e) { console.warn("reiseroute applySessionState:", e); }
    }
    // v0.8.5: Wenn die Source noch nicht existiert (z.B. Race beim Re-Mount),
    // rufen wir rebuildPreviewLayers() das alle Sources/Layer idempotent
    // anlegt. Vorher gab's nur einen if-Check und kein else → Track unsichtbar.
    if (map.getSource("preview-track")) {
      map.getSource("preview-track").setData({
        type: "Feature", geometry: { type: "LineString", coordinates: res.coords }
      });
    } else {
      applog("info", "[drawPreview] no preview-track source — rebuilding layers");
      rebuildPreviewLayers();
    }
    // v0.9.295 (Nutzer-Feedback Beta-Tester): Track-Ansicht beim Laden DIREKT setzen
    // (Sprung statt 500-ms-Fly-in von der Weltkugel) — man sieht sofort den ganzen
    // Track + Rand, und auf schwächeren Rechnern ruckelt kein Reinzoomen mehr.
    // _lastFitTs zurücksetzen, damit der nicht-animierte Fit nicht vom
    // Anti-Cascade-Guard (≤700 ms) übersprungen wird.
    fitTrackPreview._lastFitTs = 0;
    fitTrackPreview(false);
    // v0.7.0: Camera-Keyframe-Pins neu zeichnen wenn Track sich ändert
    rebuildCameraKeyframePins();
    // v0.7.1: Status-Label updaten + key-nav binden (idempotent)
    if (_tlBar && _tlBar.updateStatusLabel) _tlBar.updateStatusLabel();
    bindTimelineKeyNav();
  }

  /**
   * Fittet die Preview-Map auf den Track-Extent.
   * WICHTIG: gleiche Padding-Proportion wie das Backend
   * (core/animator.py._make_html → PAD_FACTOR = 0.08), damit Vorschau und
   * gerendertes Video den selben Karten-Ausschnitt zeigen.
   *
   * Caveat: das Animator-Preview-Canvas hat KEINEN Letterbox-Viewport
   * (anders als Tour-Map), die Aspect-Ratio kann also abweichen. Der Track
   * selbst wird trotzdem korrekt eingerahmt — Pitch/Bearing-Sweep verändern
   * eh permanent die Optik beim Render, das ist OK.
   */
  /** v0.9.41 — Preview-Track-Linie auf den Trim-Bereich kürzen.
   *  Wird beim Trim-Drag live aufgerufen. Wenn Trim = [0,1] (= kompletter
   *  Track), zeigen wir den ganzen Track. */
  function applyTrimToTrackPreview(start, end) {
    if (!map || !currentCoords || currentCoords.length < 2) return;
    try {
      const src = map.getSource("preview-track");
      if (!src) return;
      const n = currentCoords.length;
      const a = Math.max(0, Math.min(1, start));
      const b = Math.max(a, Math.min(1, end));
      // v0.9.70 (Marc-Bug): linker Trimmer muss die Linie analog zum rechten
      // kürzen. show_pretrim_track wirkt NUR während der Animation (Playback +
      // Render-Output) — die statische Trim-Drag-Live-Vorschau zeigt immer
      // exakt den Trim-Bereich.
      const si = Math.max(0, Math.round(a * (n - 1)));
      const ei = Math.max(si, Math.min(n - 1, Math.round(b * (n - 1))));
      const slice = currentCoords.slice(si, ei + 1);
      src.setData({
        type: "Feature",
        geometry: { type: "LineString", coordinates: slice },
      });
    } catch (_) {}
  }

  /** Trim aus Projekt-Settings lesen und auf Timeline-Bar + Preview anwenden. */
  function applyTrimFromSettings() {
    const proj = (typeof getActiveProject === "function") ? getActiveProject() : null;
    const a = proj?.[_MODKEY] || {};
    const start = typeof a.render_start_anchor === "number" ? a.render_start_anchor : 0.0;
    const end   = typeof a.render_end_anchor   === "number" ? a.render_end_anchor   : 1.0;
    if (_tlBar && typeof _tlBar.setTrim === "function") _tlBar.setTrim(start, end);
    applyTrimToTrackPreview(start, end);
  }

  function fitTrackPreview(animated = true) {
    if (!map || !currentBbox) return;
    const b = currentBbox;
    if (!("min_lon" in b)) return;
    // v0.9.34 (Marc-Bug-Report): Schutz gegen Animations-Interruption.
    // Wenn gerade eine fitBounds-Animation läuft (≤ 700 ms her) und der
    // neue Call ist non-animated (= ResizeObserver-Trigger), skippen.
    // Sonst würde der ResizeObserver-Cascade beim Re-Mount jede laufende
    // Animation killen → komische Zwischenstände, oft mit Weltansicht-Ende.
    if (!animated && fitTrackPreview._lastFitTs &&
        Date.now() - fitTrackPreview._lastFitTs < 700) {
      return;
    }
    // v0.9.310 — Standbild-Modus: Randabstand kommt vom Slider (padding_pct),
    // sonst der animierte Default 8 %.
    const _staticPad = _isStaticFrame ? parseFloat(document.getElementById("anim-static-padding")?.value) : NaN;
    const PAD_FACTOR = (!isNaN(_staticPad)) ? (_staticPad / 100) : 0.08;   // Synchron mit core/animator.py
    // Letterbox-Viewport hat exakt die Render-Aspect-Ratio — pad in der
    // gleichen Proportion ergibt identischen Zoom wie der Render.
    const vpEl = document.getElementById("anim-viewport") || document.getElementById("map-canvas");
    const vpMin = vpEl ? Math.min(vpEl.clientWidth, vpEl.clientHeight) : 600;
    // v0.9.30/34 (Marc-Bug-Report): wenn der Viewport noch nicht final layoutet
    // ist (Tab-Wechsel, Re-Mount, CSS noch nicht durch), kann clientWidth/Height
    // 0 oder sehr klein sein → fitBounds würde dann auf Weltansicht zoomen.
    // Wir verschieben den Fit auf den nächsten Frame. Max. 10 Re-Tries mit
    // 200 ms = 2 s Geduld (manche Re-Mount-Szenarien brauchen das).
    if (vpMin < 200) {
      if (!fitTrackPreview._retries) fitTrackPreview._retries = 0;
      if (fitTrackPreview._retries < 10) {
        fitTrackPreview._retries++;
        setTimeout(() => fitTrackPreview(animated), 200);
      }
      return;
    }
    fitTrackPreview._retries = 0;
    fitTrackPreview._lastFitTs = Date.now();
    const pxPad = Math.max(2, Math.round(PAD_FACTOR * vpMin));
    // Bearing zeigen wir als End-Bearing der Animation (Render sweept von
    // -10 bis -10+rotation). So sieht der User wo die Kamera am Ende landet.
    // v0.9.310 — Standbild-Modus: feste Ausrichtung vom Slider (bearing).
    const startBearing = -10;
    const rot = parseFloat(document.getElementById("anim-rot")?.value) || 0;
    const _staticBearing = _isStaticFrame ? parseFloat(document.getElementById("anim-static-bearing")?.value) : NaN;
    const endBearing = (!isNaN(_staticBearing)) ? _staticBearing : (startBearing + rot);
    try {
      map.fitBounds(
        [[b.min_lon, b.min_lat], [b.max_lon, b.max_lat]],
        {
          padding: pxPad,
          pitch: parseFloat(document.getElementById("anim-pitch").value) || 0,
          bearing: endBearing,
          duration: animated ? 500 : 0,
        }
      );
      // v0.7.9: _fitZoomBase NACH Animations-Ende setzen, nicht via
      // requestAnimationFrame (das feuert sofort im ersten Frame, wo
      // map.getZoom() noch der Pre-Fit-Zoom ist → bei snapshotKeyframe
      // entsteht ein riesiger zoom_offset → Backend zoomt extrem rein).
      map.once("moveend", () => {
        try {
          _fitZoomBase = map.getZoom();
          console.log("[fit] _fitZoomBase =", _fitZoomBase.toFixed(3));
          // v0.9.209 — Frisch geladener Track OHNE vom User gesetzten Zoom:
          // den Classic-Zoom-Slider auf den Fit-Zoom setzen, sonst springt der
          // Probelauf auf den Default (static_zoom=12) → „zoomt dicht rein"
          // (fiel v.a. im Reiseroute-Modul mit frischem Settings-Namespace auf).
          // Nur wenn der User für DIESES Modul noch keinen Zoom gewählt hat;
          // getunte Projekte/Keyframe-Modus bleiben unangetastet.
          try {
            if (!keyframesEnabled()) {
              const projZ = getActiveProject()?.[_MODKEY]?.static_zoom;
              const cacheZ = _settingsCache?.[_MODKEY]?.static_zoom;
              const userSet = (typeof projZ === "number") || (typeof cacheZ === "number");
              if (!userSet) {
                const zs = document.getElementById("anim-zoom");
                const zl = document.getElementById("anim-zoom-v");
                if (zs) zs.value = _fitZoomBase.toFixed(1);
                if (zl) zl.textContent = _fitZoomBase.toFixed(1);
              }
            }
          } catch (_) {}
          // v0.9.39 (Marc-Bug-Report): Jetzt wo _fitZoomBase verfügbar ist,
          // einen evtl. queue'd scrubPreview vom Re-Mount nachholen — der
          // hatte sich oben in scrubPreview() auf moveend gehookt weil
          // base noch null war. Plus: wenn KFs aktiv sind und der Scrubber
          // nicht am Anfang steht, MAP auf die echte KF-Pose setzen (die
          // sich aus _fitZoomBase + zoom_offset ergibt).
          if (keyframesEnabled() && currentCoords && currentCoords.length > 1) {
            const a = _tlBar ? _tlBar.getScrubber() : 0;
            try { scrubPreview(a, { skipSelectionSync: true }); } catch (_) {}
          }
        } catch (_) {}
      });
    } catch (e) {
      console.warn("fitTrackPreview failed:", e);
    }
  }

  // Render starten
  // v0.9.155: Workspace-Clear läuft jetzt zentral über das rote ✕ in der
  // GPX-Bar (window.clearWorkspaceGlobal). Dieses Modul registriert nur noch
  // seine eigene Reset-Logik. DOM-Zugriffe sind guarded, damit der Resetter
  // auch dann sauber durchläuft wenn das Modul gerade nicht gemountet ist.
  function _animClearWorkspace() {
    currentGpx = null;
    currentCoords = null;
    currentBbox = null;
    _gpxStats = null;
    _gpxElevations = null;
    // Track-Layer von der Karte entfernen
    if (map) {
      try {
        if (map.getLayer("preview-line")) map.removeLayer("preview-line");
        if (map.getLayer("preview-glow")) map.removeLayer("preview-glow");
        if (map.getSource("preview-track")) map.removeSource("preview-track");
      } catch (_) {}
      // Karte zurück auf neutrale Welt-Sicht
      try { map.flyTo({ center: [10, 51], zoom: 4, pitch: currentPitch(), bearing: -10, duration: 500 }); } catch (_) {}
    }
    // Header-Stats zurück auf Empty-Hint
    try {
      document.getElementById("anim-stats-empty").hidden = false;
      document.getElementById("anim-stats-cards").hidden = true;
      // Render-Button + Overlay-Preview zurücksetzen
      document.getElementById("anim-render").disabled = true;
      renderOverlayPreview();
      // Punkte-Slider zurück auf Default „kein GPX geladen"
      configurePointCountSlider(0);
    } catch (_) {}
    _fullPreviewCoords = [];
    // v0.9.156 — Multi-Track-Liste + Preview-Layer mit zurücksetzen.
    _extraTours = [];
    try { _animClearExtraPreview(); } catch (_) {}
    try { _animRenderToursList(); } catch (_) {}
    // v0.9.185 — Schilder via lebenden Handle leeren (closure-sicher).
    try { if (window.__rzAnimSigns && window.__rzAnimSigns.clearAll) window.__rzAnimSigns.clearAll(); } catch (_) {}
  }
  if (typeof registerWorkspaceResetter === "function") registerWorkspaceResetter(_animClearWorkspace);

  // ── v0.9.156 — Multi-Track-Tourenliste ──────────────────────────────────
  const _TOUR_PALETTE = ["#35a7ff", "#7bd35b", "#ffd23f", "#c77dff", "#ff5d8f", "#34d8c9"];

  // v0.9.161 — Modul-scoped escapeHtml. Wurde von _animRenderToursList (Tour-
  // Namen/Pfade/Farbe) genutzt, war aber nur als function-lokale const in zwei
  // Modal-Funktionen definiert → ReferenceError „Can't find variable: escapeHtml"
  // beim Hinzufügen einer weiteren Tour. Function-Declaration = gehoistet, also
  // überall im Modul-Closure verfügbar (die lokalen consts shadowen sie lokal).
  function _animEscapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => (
      {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]
    ));
  }

  function _animRenderToursList() {
    const host = document.getElementById("anim-tours-list");
    const flyField = document.getElementById("anim-fly-field");
    if (!host) return;
    host.innerHTML = "";
    _extraTours.forEach((tr, i) => {
      const row = document.createElement("div");
      row.className = "anim-tour-row";
      row.innerHTML = `
        <span class="anim-tour-idx">${i + 2}</span>
        <input type="color" class="anim-tour-color" value="${_animEscapeHtml(tr.line_color)}" title="${t("animator.tours.color", "Farbe dieser Tour")}">
        <span class="anim-tour-name" title="${_animEscapeHtml(tr.gpx_path)}">${_animEscapeHtml(tr.name)}</span>
        <span class="anim-tour-actions">
          <button type="button" class="anim-tour-btn" data-act="up" ${i === 0 ? "disabled" : ""} title="${t("animator.tours.up", "nach oben")}">↑</button>
          <button type="button" class="anim-tour-btn" data-act="down" ${i === _extraTours.length - 1 ? "disabled" : ""} title="${t("animator.tours.down", "nach unten")}">↓</button>
          <button type="button" class="anim-tour-btn anim-tour-del" data-act="del" title="${t("animator.tours.remove", "entfernen")}">✕</button>
        </span>`;
      row.querySelector(".anim-tour-color").addEventListener("input", (e) => {
        _extraTours[i].line_color = e.target.value;
        try {
          if (map && map.getLayer("mtour-prev-line-" + i))
            map.setPaintProperty("mtour-prev-line-" + i, "line-color", e.target.value);
        } catch (_) {}
      });
      row.querySelector('[data-act="up"]').addEventListener("click", () => {
        if (i > 0) { const tmp = _extraTours[i - 1]; _extraTours[i - 1] = _extraTours[i]; _extraTours[i] = tmp; _animRenderToursList(); _animDrawExtraToursPreview(); }
      });
      row.querySelector('[data-act="down"]').addEventListener("click", () => {
        if (i < _extraTours.length - 1) { const tmp = _extraTours[i + 1]; _extraTours[i + 1] = _extraTours[i]; _extraTours[i] = tmp; _animRenderToursList(); _animDrawExtraToursPreview(); }
      });
      row.querySelector('[data-act="del"]').addEventListener("click", () => {
        _extraTours.splice(i, 1); _animRenderToursList(); _animDrawExtraToursPreview(); _animFitAllTours();
      });
      host.appendChild(row);
    });
    if (flyField) flyField.hidden = _extraTours.length === 0;
  }

  // Entfernt alle Multi-Track-Preview-Layer/-Sources von der Karte.
  function _animClearExtraPreview() {
    if (!map) return;
    for (let i = 0; i < 64; i++) {
      try {
        if (map.getLayer("mtour-prev-line-" + i)) map.removeLayer("mtour-prev-line-" + i);
        if (map.getSource("mtour-prev-" + i)) map.removeSource("mtour-prev-" + i);
      } catch (_) {}
    }
  }

  // Zeichnet pro Extra-Tour eine farbige Linie auf die Vorschau-Karte (WYSIWYG).
  function _animDrawExtraToursPreview() {
    if (!map || (map.isStyleLoaded && !map.isStyleLoaded())) return;
    _animClearExtraPreview();
    const lw = parseFloat(document.getElementById("anim-lw")?.value || "3.5");
    _extraTours.forEach((tr, i) => {
      if (!tr.coords || tr.coords.length < 2) return;
      try {
        map.addSource("mtour-prev-" + i, {
          type: "geojson",
          data: { type: "Feature", geometry: { type: "LineString", coordinates: tr.coords } },
        });
        map.addLayer({
          id: "mtour-prev-line-" + i, type: "line", source: "mtour-prev-" + i,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": tr.line_color, "line-width": lw, "line-opacity": 0.9 },
        });
      } catch (e) { console.warn("extra-tour preview:", e); }
    });
  }

  // Karte auf alle Touren (primär + extra) einpassen.
  function _animFitAllTours() {
    if (!map) return;
    let pts = [];
    if (Array.isArray(currentCoords)) pts = pts.concat(currentCoords);
    _extraTours.forEach(tr => { if (Array.isArray(tr.coords)) pts = pts.concat(tr.coords); });
    if (pts.length < 2) return;
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const p of pts) { if (p[0] < a) a = p[0]; if (p[0] > c) c = p[0]; if (p[1] < b) b = p[1]; if (p[1] > d) d = p[1]; }
    try {
      map.fitBounds([[a, b], [c, d]], {
        padding: 60, duration: 600,
        pitch: (typeof currentPitch === "function") ? currentPitch() : 0,
      });
    } catch (_) {}
  }

  async function _animAddTour() {
    let files = null;
    try {
      // v0.9.282 — auch FIT/NMEA/KML/… als Extra-Tour zulassen (Backend konvertiert).
      files = await api().pick_file("open", window.TRACK_PICK_FILTER, false);
    } catch (e) {
      console.warn("pick_file (tours):", e);
    }
    if (!files || !files.length) return;
    let path = files[0];
    if (path === currentGpx || _extraTours.some(t => t.gpx_path === path)) {
      toast(t("animator.tours.dup", "Diese Tour ist schon geladen."), "info");
      return;
    }
    // Coords für die Vorschau laden (downsampled GeoJSON aus dem Backend).
    let coords = null;
    try {
      const res = await api().animator_load_gpx(path);
      if (res && res.ok) {
        coords = res.coords;
        // v0.9.282: aufgelösten GPX-Pfad merken (bei Fremdformaten der Cache-GPX),
        // damit der Multi-Track-Render echte GPX nutzt statt FIT/NMEA/…
        if (res.gpx_path) path = res.gpx_path;
      }
      else { toast(res?.error || t("animator.tours.load_fail", "Tour konnte nicht geladen werden."), "error"); return; }
    } catch (e) {
      console.warn("animator_load_gpx (tour):", e);
      toast(t("animator.tours.load_fail", "Tour konnte nicht geladen werden."), "error");
      return;
    }
    const color = _TOUR_PALETTE[_extraTours.length % _TOUR_PALETTE.length];
    const name = (path.split("/").pop() || "Tour").replace(/\.[^.]+$/i, "");
    _extraTours.push({ gpx_path: path, line_color: color, name, coords });
    _animRenderToursList();
    _animDrawExtraToursPreview();
    _animFitAllTours();
  }

  document.getElementById("anim-tours-add")?.addEventListener("click", _animAddTour);
  document.getElementById("anim-fly")?.addEventListener("input", (e) => {
    const lbl = document.getElementById("anim-fly-v");
    if (lbl) lbl.textContent = `${parseFloat(e.target.value).toFixed(1)} s`;
  });
  _animRenderToursList();

  document.getElementById("anim-render").addEventListener("click", async () => {
    if (!currentGpx) return;
    // Alpha-Modus braucht keinen Mapbox-Token (keine Map). Skip Token-Check.
    // v0.6.0: Alpha-Modus = Stil "alpha". Alpha + OSM ist OK (kein Token nötig).
    const alphaModeActive = document.getElementById("anim-style").value === "alpha";
    if (isOsmMode() && !alphaModeActive) {
      openModal({
        title: t("animator.render_needs_token.title"),
        body: `<p>${t("animator.render_needs_token.body")}</p>`,
        footer: `
          <button class="btn" id="md-rs-close">${t("common.cancel")}</button>
          <button class="btn btn-primary" id="md-rs-settings">${t("common.settings")}</button>
        `,
      });
      document.getElementById("md-rs-close").onclick = () => openModal({}).close();
      document.getElementById("md-rs-settings").onclick = () => {
        openModal({}).close();
        if (window.openSettingsModal) window.openSettingsModal();
      };
      return;
    }
    // Save-As-Dialog wie im Tour-Map: vor dem Render-Start fragen wo das
    // Video hin soll. Default-Name: <gpx-stem>_<W>x<H>_<codec>.mp4 — oder
    // bei Alpha-Kanal-Modus: <gpx-stem>_<W>x<H>_alpha.mov (ProRes 4444).
    const w = parseInt(document.getElementById("anim-w").value);
    const h = parseInt(document.getElementById("anim-h").value);
    // v0.9.245 — Codec kommt aus den globalen Einstellungen „Qualität & Export".
    const codec = (_settingsCache && _settingsCache.render && _settingsCache.render.codec) || "h264";
    const alpha = document.getElementById("anim-style").value === "alpha";
    const gpxStem = (currentGpx.split("/").pop() || "tour").replace(/\.gpx$/i, "");
    // .mov für Alpha ODER ProRes-ohne-Alpha; .mp4 für H.264/H.265.
    const needsMov = alpha || codec === "prores";
    // v0.9.308 — Standbild (Tour-Map): PNG statt Video.
    const ext = _isStaticFrame ? "png" : (needsMov ? "mov" : "mp4");
    const codecLabel = alpha ? "alpha" : codec;
    const defaultName = _isStaticFrame
      ? `${gpxStem}_${w}x${h}.png`
      : `${gpxStem}_${w}x${h}_${codecLabel}.${ext}`;
    const fileFilter = _isStaticFrame ? ["PNG (*.png)"] : (needsMov ? ["MOV (*.mov)"] : ["MP4 (*.mp4)"]);
    const lastDir = (_settingsCache && _settingsCache[_MODKEY] && _settingsCache[_MODKEY].last_save_dir) || "";

    const savePath = await api().pick_save_path(defaultName, lastDir, fileFilter);
    if (!savePath) return;   // User hat abgebrochen

    // Last-Dir merken fürs nächste Mal
    const dir = savePath.substring(0, savePath.lastIndexOf("/"));
    if (dir) saveSettings({ animator: { last_save_dir: dir } });

    // User-Viewport snapshotten — Marc's manueller Pan/Zoom in der Preview
    // soll im Render erhalten bleiben. Wenn override_* gesetzt sind, baut
    // das Backend die Map mit center+zoom statt mit bounds-fit.
    //
    // v0.7.8-Fix: Wenn Camera-Keyframes da sind, sind override_center+zoom
    // ÜBERFLÜSSIG — die Keyframes regeln pitch/bearing/zoom_offset über
    // den ganzen Track. Würde man trotzdem override_* setzen, käme der
    // aktuelle Scrubber-State als Map-Init rein UND interpolate_camera
    // addiert dann nochmal seinen Offset → Doppel-Anwendung, kompletter
    // Drift zwischen Live-Preview und finalem Render.
    // → Bei Keyframes: override_* null lassen, Backend macht bounds-fit
    //   als Base, Keyframes setzen den Cinematic relativ dazu.
    // v0.9.0: Property-Events ODER alte camera-Events
    // v0.9.223 — BUGFIX (Marc „1. Frame falscher Zoom" in Reiseroute, betraf
    // auch Animator nach Neustart): hasKfs MUSS projekt-bewusst sein. Nach
    // einem Restart liegen die Keyframes im aktiven Projekt, `_settingsCache`
    // ist aber leer → hasKfs war fälschlich false → der Classic-Snapshot-Zweig
    // unten überschrieb die echten Zoom-Keyframes mit dem aktuellen Map-Zoom.
    // getTimelineEvents() liest projekt-first UND respektiert den Editor-Toggle.
    const hasKfs = getTimelineEvents()
      .some(e => e && (KF_LANES.includes(e.kind) || e.kind === "camera"));
    // v0.9.157 — WYSIWYG-Zoom-Korrektur (Marc-Bug „Render-Zoom ≠ Preview-Zoom
    // in BEIDEN Modi"). Ein einziger Delta-Wert pro Render:
    //   zoom_correction = correctedZoom(map,W,H) - map.getZoom()
    //                   = log2(min(W/previewW, H/previewH))
    // Mapbox-Zoom ist relativ zur Viewport-Pixelbreite (Preview ~800 px, Render
    // 1920–7680 px). Das Backend addiert diesen Delta (minus log2(dsf)) auf den
    // absoluten KF-Zoom → identisch für KF-Modus UND Classic (= 2 hidden KFs).
    let zoomCorrection = 0;
    try {
      if (map && window.correctedZoom) {
        zoomCorrection = window.correctedZoom(map, w, h) - map.getZoom();
        if (!isFinite(zoomCorrection)) zoomCorrection = 0;
      }
    } catch (_) { zoomCorrection = 0; }
    // v0.9.157 — Track-Linie an die Preview-Dicke angleichen (Marc-Bug „Linie
    // im Render dünner als in der Preview", v.a. bei 4K). Mapbox-`line-width`
    // ist CSS-Pixel; der Render-CSS-Viewport (= W/dsf) ist breiter als die
    // schmale Preview → dieselbe px-Linie wirkt relativ dünner. Skalierung:
    //   lineScale = (renderW/previewW) / dsf = 2^zoomCorrection / dsf
    // (2^zoomCorrection = min(W/pw, H/ph), der Viewport-Ratio in Device-Px;
    // /dsf bringt's auf CSS-Px). Browser malt die CSS-Linie dann mit ×dsf
    // Device-Px → finale Dicke = slider × renderW/previewW = exakt Preview-
    // Anteil. Bei fehlender Map → 1 (kein Eingriff). Spiegelt die Zoom-
    // Korrektur 1:1 (linear statt log).
    let lineScale = 1;
    try {
      if (map && zoomCorrection) {
        const dsf = Math.max(1, Math.max(w, h) / 1920);
        lineScale = Math.pow(2, zoomCorrection) / dsf;
        if (!isFinite(lineScale) || lineScale <= 0) lineScale = 1;
      }
    } catch (_) { lineScale = 1; }
    let snapshotPitch = parseFloat(document.getElementById("anim-pitch").value);
    // v0.9.157 — Classic läuft jetzt über GENAU EINEN Pfad: die 2 hidden KFs aus
    // getEffectiveEvents() (→ buildDefaultEvents). Statt des alten override_*-
    // Sonderpfads snapshotten wir die aktuelle Preview-Kamera (Pan/Pitch/Zoom)
    // direkt in diese KFs. `override_*` bleibt null — das Backend nutzt bounds-
    // fit als Map-Init, jeder Frame setzt Center/Zoom eh explizit aus den KFs.
    // Der User merkt nichts: Classic = KF-Modus mit unsichtbaren Start/End-KFs.
    let renderEvents = getEffectiveEvents();
    if (map && !hasKfs) {
      try {
        const c = map.getCenter();
        const mz = map.getZoom();
        const mp = map.getPitch();
        const follow = !!document.getElementById("anim-camera-follow")?.checked;
        snapshotPitch = mp;
        renderEvents = renderEvents.map(e => {
          if (!e) return e;
          if (e.kind === "zoom")  return { ...e, value_absolute: mz };
          if (e.kind === "pitch") return { ...e, value: mp };
          // Center nur snapshotten wenn die Kamera NICHT dem Track folgt
          // (sonst null lassen = per-Frame Track-Punkt, wie gehabt).
          if (e.kind === "center" && !follow) return { ...e, value: [c.lng, c.lat] };
          return e;
        });
      } catch (_) {}
    }
    // Bei Keyframes: snapshotPitch bleibt = slider-default (cfg.pitch). Wird
    // im Backend nur als Fallback verwendet wenn interpolate_camera keinen
    // Match findet — bei vorhandenen Keyframes greift immer ein Keyframe.

    const params = {
      gpx_path: currentGpx,
      // v0.9.156 — Multi-Track: nur senden wenn ≥1 Extra-Tour vorhanden ist.
      // Backend aktiviert den isolierten Multi-Render-Pfad ab 2 Touren. Tour 1
      // = die globale GPX (currentGpx) mit der Farbe aus der Track-Sektion.
      ...(function() {
        if (!_extraTours.length) return {};
        const primaryName = (currentGpx.split("/").pop() || "Tour 1").replace(/\.gpx$/i, "");
        const tracks = [{
          gpx_path: currentGpx,
          line_color: document.getElementById("anim-color").value,
          name: primaryName,
        }].concat(_extraTours.map(tr => ({
          gpx_path: tr.gpx_path, line_color: tr.line_color, name: tr.name,
        })));
        return {
          tracks,
          fly_duration_s: parseFloat(document.getElementById("anim-fly")?.value || "3"),
        };
      })(),
      output_path: savePath,
      map_style: document.getElementById("anim-style").value,
      // v0.9.308 — Standbild-Modus (Tour-Map): EIN PNG via render_frame.
      // v0.9.310 — bearing/padding_pct/show_pins kommen jetzt aus eigenen
      // Reglern in der Kamera-Sektion (WYSIWYG zur Vorschau). Fallback auf die
      // bisherigen Tour-Map-Defaults wenn ein Element fehlt.
      still_frame: _isStaticFrame,
      ...(_isStaticFrame ? {
        bearing: (() => { const v = parseFloat(document.getElementById("anim-static-bearing")?.value); return isNaN(v) ? -10 : v; })(),
        padding_pct: (() => { const v = parseFloat(document.getElementById("anim-static-padding")?.value); return isNaN(v) ? 8 : v; })(),
        show_pins: (document.getElementById("anim-static-pins")?.checked ?? true),
      } : {}),
      duration_s: parseInt(document.getElementById("anim-dur").value),
      hold_s: parseInt(document.getElementById("anim-hold").value),
      intro_s: parseInt(document.getElementById("anim-intro")?.value || "0"),  // v0.9.59
      fps: parseInt(document.getElementById("anim-fps").value),
      width: parseInt(document.getElementById("anim-w").value),
      height: parseInt(document.getElementById("anim-h").value),
      pitch: snapshotPitch,
      rotation: parseFloat(document.getElementById("anim-rot").value),
      // v0.9.107 — spin_dps raus (Slider entfernt). Drehung kommt aus
      // den position-/center-KF-Events, Render-Backend ignoriert spin_dps.
      spin_dps: 0,
      cinematic_flyto: !!document.getElementById("anim-cinematic-flyto")?.checked,
      exaggeration: parseFloat(document.getElementById("anim-ex").value),
      enable_terrain: document.getElementById("anim-terrain").checked,
      // v0.8.17 — Classic-Mode Toggle „Kamera folgt Track" → Backend bewegt
      // Center pro Frame zum aktuellen Track-Punkt. Im KF-Modus per KF gesteuert.
      camera_follow_track: !!document.getElementById("anim-camera-follow")?.checked,
      camera_follow_inertia: (parseInt(document.getElementById("anim-follow-inertia")?.value, 10) || 0) / 100,
      smooth_camera_3d: !!document.getElementById("anim-smooth-camera")?.checked,  // v0.9.318 entkoppelte FreeCamera
      show_overlays: !_isReiseroute && !!document.getElementById("anim-overlays")?.checked,
      line_color: document.getElementById("anim-color").value,
      // v0.9.157 — line_width für den Render auf Preview-Dicke hochskaliert
      // (lineScale, s.o.). Slider/Preview bleiben unverändert beim Roh-Wert.
      line_width: parseFloat(document.getElementById("anim-lw").value) * lineScale,
      line_style: document.getElementById("anim-line-style").value,
      line_style_spacing: parseFloat(document.getElementById("anim-line-spacing").value),
      // v0.9.215 — null-safe (Overlay-Sektion ist im Reiseroute-Modul entfernt)
      // + in Reiseroute IMMER aus (dort gibt es keine Stats-Overlays).
      overlay_totals_enabled: !_isReiseroute && !!document.getElementById("anim-ov-totals")?.checked,
      overlay_totals_position: document.getElementById("anim-ov-totals-pos")?.value || "top-left",
      overlay_live_enabled: !_isReiseroute && !_isStaticFrame && !!document.getElementById("anim-ov-live")?.checked,
      overlay_live_position: document.getElementById("anim-ov-live-pos")?.value || "bottom-left",
      overlay_elevation_enabled: !_isReiseroute && !!document.getElementById("anim-ov-ele")?.checked,
      overlay_elevation_position: document.getElementById("anim-ov-ele-pos")?.value || "bottom-right",
      // v0.9.228 — Overlay-Zeitfenster (Nutzer „ab Sek X bis Sek Y"). Leeres
      // Feld / 0 = ab Start bzw. bis Ende.
      overlay_totals_from_s: parseFloat(document.getElementById("anim-ov-totals-from")?.value) || 0,
      overlay_totals_to_s: parseFloat(document.getElementById("anim-ov-totals-to")?.value) || 0,
      overlay_live_from_s: parseFloat(document.getElementById("anim-ov-live-from")?.value) || 0,
      overlay_live_to_s: parseFloat(document.getElementById("anim-ov-live-to")?.value) || 0,
      overlay_elevation_from_s: parseFloat(document.getElementById("anim-ov-ele-from")?.value) || 0,
      overlay_elevation_to_s: parseFloat(document.getElementById("anim-ov-ele-to")?.value) || 0,
      // v0.9.321 — Stats-Editor: wählbare/sortierbare Felder + globales Styling
      overlay_totals_fields: _ovGetFields("totals"),
      overlay_live_fields: _ovGetFields("live"),
      overlay_font: document.getElementById("anim-ov-font")?.value || "system",
      overlay_text_color: document.getElementById("anim-ov-textcolor")?.value || "#ffffff",
      overlay_bg_color: document.getElementById("anim-ov-bgcolor")?.value || "#000000",
      overlay_bg_opacity: (parseFloat(document.getElementById("anim-ov-bgopacity")?.value) || 55) / 100,
      // codec/crf/frame_format kommen jetzt server-seitig aus den globalen
      // Render-Settings (Dialog „Qualität & Export"), nicht mehr aus der Sidebar.
      // v0.9.157 — override_* abgeschafft (Classic = 2 hidden KFs, s.o.).
      // Map-Init im Backend nutzt bounds-fit; Kamera kommt pro Frame aus KFs.
      override_center: null,
      override_zoom: null,
      // WYSIWYG-Zoom-Korrektur (gilt für KF-Modus + Classic).
      zoom_correction: zoomCorrection,
      // v0.9.224 — WYSIWYG-Größe für Schilder + Foto-Pins. lineScale =
      // renderCssWidth/previewWidth (s.o.). Backend multipliziert die icon-size
      // damit → Schild/Pin haben im Render denselben Frame-Anteil wie in der
      // Preview (sonst wirken sie im 4K-Render kleiner). Probelauf: 1.0.
      render_scale: lineScale,
      // v0.4: Punkte-Dichte (low/medium/high/max) + Alpha-Kanal-Modus.
      // Alpha = kein Karten-Background → ProRes-4444-.mov für NLE-Composit.
      point_count: (function() {
        const sl = document.getElementById("anim-pointcount");
        if (!sl || sl.disabled) return 0;  // 0 = alle (Backend-Default)
        const v = parseInt(sl.value);
        const max = parseInt(sl.max);
        // Wenn voller Wert: 0 senden, sonst exakte Punkte-Zahl
        return (v >= max) ? 0 : v;
      })(),
      transparent_background: document.getElementById("anim-style").value === "alpha",
      // v0.4/v0.9.309: Schlagschatten — Slider IST der Schalter (Stärke 0 = aus).
      shadow_enabled: currentShadowEnabled(),
      shadow_strength: currentShadowStrength(),
      // v0.6.8/v0.9.309: Glow — Slider IST der Schalter (Stärke 0 = aus).
      glow_enabled: currentGlowEnabled(),
      glow_strength: currentGlowStrength(),
      // v0.9.286b: Karte glätten (Anti-Flimmer-Tiefpass, nur 4K-Wirkung)
      map_smoothing: parseFloat(document.getElementById("anim-map-smoothing")?.value || "1.3"),
      // v0.9.169: Ghost-Track — ganze Route schwach im Hintergrund vorgezeichnet
      ghost_track_enabled: currentGhostEnabled(),
      ghost_track_opacity: currentGhostOpacity(),
      ghost_track_color: currentGhostColor(),   // v0.9.170 — eigene Ghost-Farbe
      // v0.9.210/211 (Reiseroute) — das geladene Wander-GPX als zusätzlicher
      // Ghost (andere Linie als die animierte Route) auch im gerenderten Video,
      // mit konfigurierbarer Farbe/Deckkraft/Breite/Strichelung.
      ghost_gpx_coords: (_isReiseroute && _ghostGpxCoords && _ghostGpxCoords.length > 1 && currentGhostGpxShow())
        ? _ghostGpxCoords : [],
      ghost_gpx_color: currentGhostGpxColor(),
      ghost_gpx_opacity: currentGhostGpxOpacity(),
      ghost_gpx_width: currentGhostGpxWidth(),
      ghost_gpx_dashed: currentGhostGpxDashed(),
      // v0.7.0: Camera-Keyframe-Timeline
      // v0.9.86: Render bekommt User-KFs ODER implizite Default-KFs aus den
      // Slider-Werten. Backend interpoliert einheitlich — kein Sonderfall
      // für „Classic ohne KFs" mehr.
      // v0.9.157: renderEvents = getEffectiveEvents() PLUS Classic-Snapshot der
      // aktuellen Preview-Kamera (center/pitch/zoom) in die 2 hidden KFs.
      timeline_events: renderEvents,
      // v0.9.41 — Partial-Track-Render (Trim-Bereich)
      ...(function() {
        const proj = (typeof getActiveProject === "function") ? getActiveProject() : null;
        const a = proj?.[_MODKEY] || {};
        return {
          render_start_anchor: typeof a.render_start_anchor === "number" ? a.render_start_anchor : 0.0,
          render_end_anchor:   typeof a.render_end_anchor   === "number" ? a.render_end_anchor   : 1.0,
          stats_use_trim:      typeof a.stats_use_trim === "boolean" ? a.stats_use_trim : true,
          // v0.9.55 (Marc): Pre-Trim-Track-Linie an/aus
          show_pretrim_track:  typeof a.show_pretrim_track === "boolean" ? a.show_pretrim_track : true,
          // v0.9.103: Welt-Verschiebung via Mapbox-Padding
          world_shift_x_pct:   typeof a.world_shift_x_pct === "number" ? a.world_shift_x_pct : 0.0,
          world_shift_y_pct:   typeof a.world_shift_y_pct === "number" ? a.world_shift_y_pct : 0.0,
        };
      })(),
      // v0.9.74 — Foto-Pins. photos auf Projekt-Root (geteilt mit Tour-Map),
      // photos_size_px + photos_show pro Modul.
      ...(function() {
        const proj = (typeof getActiveProject === "function") ? getActiveProject() : null;
        const a = proj?.[_MODKEY] || {};
        return {
          photos: [],   // v0.9.198 — Fotos sind jetzt Schilder mit Bild (signs); keine alten Foto-Pins mehr rendern
          photos_size_px: typeof a.photos_size_px === "number" ? a.photos_size_px : 48,
          photos_show: typeof a.photos_show === "boolean" ? a.photos_show : true,
          // v0.9.171 — Wegpunkt-Schilder (signs auf Projekt-Root, Größe/Show pro Modul)
          signs: Array.isArray(proj?.[_SIGNS_KEY]) ? proj[_SIGNS_KEY] : [],
          signs_size_px: typeof a.signs_size_px === "number" ? a.signs_size_px : 40,
          signs_show: typeof a.signs_show === "boolean" ? a.signs_show : true,
          signs_style: a.signs_style || "callout",
          signs_color: a.signs_color || "#ff6b35",
        };
      })(),
      // v0.5.0: Karten-Feinabstimmung — direkt aus den Settings, nicht
      // aus DOM-Elementen (UI ist das Modal, kein dauerhaftes Bedienfeld).
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
    };
    const res = await api().animator_start_render(params);
    if (!res.ok) {
      if (res.error_code === "playwright_browser_missing") {
        showPlaywrightMissingModal(res.browsers_path, async () => {
          // Nach erfolgreicher Installation Render direkt erneut starten
          const r2 = await api().animator_start_render(params);
          if (!r2.ok) {
            toast(r2.error || "Fehler beim Start", "error", 6000);
            return;
          }
          document.getElementById("anim-progress").classList.add("show");
          document.getElementById("anim-done").classList.add("hidden");
          // v0.9.12 — Render-Lock auch im Playwright-Retry-Pfad
          setRenderingState(true);
          pollStatus();
        });
        return;
      }
      toast(res.error || "Fehler beim Start", "error");
      return;
    }
    document.getElementById("anim-progress").classList.add("show");
    document.getElementById("anim-done").classList.add("hidden");
    // v0.9.12 — Während des Renders alles außer der Cancel-Region sperren.
    setRenderingState(true);
    // Preview-Bild + Cancel-Button-State zurücksetzen
    {
      const img = document.getElementById("anim-preview");
      const ph  = document.getElementById("anim-preview-placeholder");
      const cancelBtn = document.getElementById("anim-cancel");
      if (img) { img.src = ""; img.classList.remove("visible"); }
      if (ph)  ph.style.display = "";
      if (cancelBtn) {
        cancelBtn.disabled = false;
        cancelBtn.textContent = "⨯ " + t("animator.btn.cancel");
      }
    }
    pollStatus();
  });

  // Cancel-Button → Bridge-Call. Worker prüft das Flag vor jedem Frame
  // und wirft RenderCancelled, der Status-Polling sieht s.cancelled.
  document.getElementById("anim-cancel").addEventListener("click", async () => {
    const btn = document.getElementById("anim-cancel");
    btn.disabled = true;
    btn.textContent = "⏳ " + t("animator.cancel.requesting");
    try { await api().animator_cancel(); } catch (_) {}
  });

  let pollTimer = null;
  let _lastPreviewB64 = "";
  async function pollStatus() {
    // v0.9.25 — kein Bridge-Call mehr wenn Window am Schließen
    if (window.__rzgpsShuttingDown) { clearTimeout(pollTimer); return; }
    const s = await api().animator_status();
    const pct = Math.round((s.progress || 0) * 100);
    document.getElementById("anim-pct").textContent = pct + "%";
    document.getElementById("anim-fill").style.width = pct + "%";
    document.getElementById("anim-status").textContent = s.status || "";

    // Live-Preview-Bild updaten — nur wenn neuer Frame angekommen ist
    // (sonst flackert das Image bei jedem 350-ms-Poll).
    if (s.preview_b64 && s.preview_b64 !== _lastPreviewB64) {
      _lastPreviewB64 = s.preview_b64;
      const img = document.getElementById("anim-preview");
      const ph  = document.getElementById("anim-preview-placeholder");
      if (img) img.src = "data:image/jpeg;base64," + s.preview_b64;
      if (img) img.classList.add("visible");
      if (ph)  ph.style.display = "none";
    }

    if (s.cancelled) {
      document.getElementById("anim-progress").classList.remove("show");
      clearTimeout(pollTimer);
      setRenderingState(false);     // v0.9.12 — UI wieder freigeben
      toast(t("animator.cancel.toast"), "info", 4000);
      _lastPreviewB64 = "";
      return;
    }
    if (s.error) {
      document.getElementById("anim-progress").classList.remove("show");
      clearTimeout(pollTimer);
      setRenderingState(false);     // v0.9.12 — UI wieder freigeben
      _lastPreviewB64 = "";
      // Vollständiges Fehler-Modal mit Log-Tail + Aktionen
      showRenderErrorModal(s.error, s.log_path);
      return;
    }
    if (!s.running && s.progress >= 1.0) {
      document.getElementById("anim-progress").classList.remove("show");
      setRenderingState(false);     // v0.9.12 — UI wieder freigeben
      const done = document.getElementById("anim-done");
      done.classList.remove("hidden");
      const v = document.getElementById("anim-video");
      v.onerror = () => {
        const code = (v.error && v.error.code) || 0;
        console.warn("[anim-video] Laden fehlgeschlagen — MediaError code=" + code + " src=" + v.src);
        // code 3=DECODE, 4=SRC_NOT_SUPPORTED → Codec; 2=NETWORK → Datei/Pfad.
        toast(t("animator.video_load_fail", "Vorschau konnte nicht geladen werden — nutze „▶ Abspielen“ für den System-Player."), "warn", 7000);
      };
      // v0.9.160 — Inline-Player über localhost-HTTP (Range-fähig). WKWebView
      // lädt `file://` von externen Volumes/anderen Ordnern nicht zuverlässig
      // (Media-Sandbox) → schwarzes Bild. Der lokale Media-Server umgeht das.
      // Fallback auf `file://` (encodeURI gegen Umlaute/Leerzeichen), falls der
      // Server-Aufruf scheitert.
      (async () => {
        let srcUrl = null;
        try {
          const r = await api().serve_media(s.output);
          if (r && r.ok && r.url) srcUrl = r.url;
        } catch (_) {}
        if (!srcUrl) srcUrl = encodeURI("file://" + s.output) + "?t=" + Date.now();
        v.src = srcUrl;
        v.load();
        try { await v.play(); } catch (_) {}  // autoplay-Fallback (muted erlaubt)
      })();
      // v0.9.158 — garantierter Abspiel-Weg: öffnet das Video im System-
      // Default-Player (QuickTime), unabhängig vom WKWebView-`<video>`.
      const playBtn = document.getElementById("anim-play-video");
      if (playBtn) playBtn.onclick = () => api().open_path(s.output);
      document.getElementById("anim-open-folder").onclick = () => api().reveal_in_finder(s.output);
      document.getElementById("anim-new").onclick = () => {
        done.classList.add("hidden");
      };
      toast("Video fertig: " + s.output.split("/").slice(-1)[0], "success", 6000);
      return;
    }
    pollTimer = setTimeout(pollStatus, 350);
  }

  /** Modal das aufpoppt wenn der Chromium-Browser für Playwright fehlt.
   *  Bietet eine „Browser installieren"-Aktion (~150 MB Download) an. */
  // v0.9.229 — verlagert nach ui/js/util.js (showRenderEngineMissingModal),
  // damit Tour-Map + Höhen-Animator denselben Render-Engine-Guard nutzen.
  // Dünner Alias, damit die bestehende Aufrufstelle unverändert bleibt.
  function showPlaywrightMissingModal(browsersPath, onSuccess) {
    return showRenderEngineMissingModal(browsersPath, onSuccess);
  }

  /** Zeigt ein Modal mit Fehlerdetails + Aktionen für die Logdatei. */
  async function showRenderErrorModal(rawError, logPath) {
    // rawError ist „str(e)\n<traceback>" — erste Zeile = Kurzfassung
    const firstLine = (rawError || "").split("\n")[0] || t("animator.render_error.unknown");
    const fullError = (rawError || "").trim();

    // Log-Tail aus dem Backend ziehen (kann fehlen wenn Logger nicht initialisiert war)
    let logTail = "";
    let logPathResolved = logPath || "";
    try {
      const info = await api().get_log_tail(16000);
      if (info && info.ok) {
        logTail = info.text || "";
        logPathResolved = info.path || logPathResolved;
      }
    } catch (_) { /* ignore */ }

    const escapeHtml = (s) => String(s).replace(/[&<>]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));

    openModal({
      title: t("animator.render_error.title"),
      body: `
        <p style="margin:0 0 10px 0; color: var(--text);">
          <strong>${escapeHtml(firstLine)}</strong>
        </p>
        <p class="muted" style="margin:0 0 14px 0; font-size:11.5px; line-height:1.5;">
          ${t("animator.render_error.body")}
        </p>
        <details style="margin-bottom:10px;">
          <summary style="cursor:pointer; font-size:12px; color: var(--text-dim);">${t("animator.render_error.show_traceback")}</summary>
          <pre style="margin:8px 0 0 0; padding:10px 12px; background:#0a0a0a; border:1px solid var(--border); border-radius:6px; font-size:10.5px; line-height:1.45; max-height:220px; overflow:auto; white-space:pre-wrap; word-break:break-all; color:#ff8b6c;">${escapeHtml(fullError)}</pre>
        </details>
        <details>
          <summary style="cursor:pointer; font-size:12px; color: var(--text-dim);">${t("animator.render_error.show_log")} <span class="muted" style="font-size:11px;">— ${escapeHtml(logPathResolved)}</span></summary>
          <pre style="margin:8px 0 0 0; padding:10px 12px; background:#0a0a0a; border:1px solid var(--border); border-radius:6px; font-size:10.5px; line-height:1.45; max-height:260px; overflow:auto; white-space:pre-wrap; color: var(--text-dim);">${escapeHtml(logTail || "(Logdatei leer oder nicht lesbar)")}</pre>
        </details>
      `,
      footer: `
        <button class="btn" id="md-rerr-finder">${t("animator.render_error.btn.reveal_log")}</button>
        <button class="btn" id="md-rerr-open">${t("animator.render_error.btn.open_log")}</button>
        <button class="btn btn-primary" id="md-rerr-mail">📧 ${t("common.report_to_marc")}</button>
        <button class="btn" id="md-rerr-ok">${t("common.ok")}</button>
      `,
    });
    document.getElementById("md-rerr-open").onclick = () => { api().open_log(); };
    document.getElementById("md-rerr-finder").onclick = () => { api().reveal_log_in_finder(); };
    document.getElementById("md-rerr-mail").onclick = () => {
      // Bug-Report-Modal mit Copy-Buttons öffnen — funktioniert auch ohne
      // lokales Mail-Programm (Webmail-User können den Text rauskopieren).
      openModal({}).close();   // erst Fehler-Modal zu, sonst überlagern sich die
      window.openBugReportModal(firstLine || "Render fehlgeschlagen");
    };
    document.getElementById("md-rerr-ok").onclick = () => openModal({}).close();
  }

  return () => {
    clearTimeout(pollTimer);
    try { _animSignsCloseEditor(); } catch (_) {}   // v0.9.180 — body-Panel aufräumen
    if (_animViewportObserver) {
      try { _animViewportObserver.disconnect(); } catch (_) {}
      _animViewportObserver = null;
    }
    if (_animTimelineObserver) {
      try { _animTimelineObserver.disconnect(); } catch (_) {}
      _animTimelineObserver = null;
    }
    // v0.9.29 (Marc-Bug-Report): nur Selection + Scrubber cachen. Map-Pose
    // erzeugte beim Restore einen unintendierten Zoom-Out (Race mit
    // fitTrackPreview nach Mount).
    try {
      const cache = (window.__rzgpsModuleCache = window.__rzgpsModuleCache || {});
      cache[_MODKEY] = {
        ts: Date.now(),
        selectedKfIdx: (typeof _selectedKfIdx !== "undefined") ? _selectedKfIdx : null,
        scrubberAnchor: (_tlBar && typeof _tlBar.getScrubber === "function") ? _tlBar.getScrubber() : null,
      };
    } catch (_) {}
    if (map) map.remove();
  };
}
