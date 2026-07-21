// Reisezoom GPS Studio — Höhen-Animator-Modul (v0.9.93)
//
// Phase 1.5: UI + Live-SVG-Vorschau MIT Animation. Kurve baut sich auf,
// Marker läuft mit, Play/Pause + Scrub-Slider unten in der Canvas.
// Geschwindigkeit kommt aus den Settings (Dauer + Hold).
//
// Phase 2 (kommt): Render-Pipeline (Frames via Headless-Browser →
// ffmpeg → MP4). Die Animation hier ist 1:1 das, was im Video drin sein
// wird — der Renderer wird denselben Draw-Code benutzen.

(window.RZGPS_MODULES = window.RZGPS_MODULES || {}).heightanim = {
  manifest: {
    slug: "heightanim",
    name: "Daten-Animator",
    description: "Messwerte als Video",
    icon: "⛰",
    sort_order: 30,  // Reihenfolge: Animator(10) Reiseroute(20) Höhen(30) Tour-Map(40) Geotagger(50) Inspektor(60)
  },
  mount: function (body, headerActions) { return mountHeightAnim(body, headerActions); },
};

function mountHeightAnim(body, headerActions) {
  // Layout-Konvention: .module-body ist ein 360px-1fr-Grid (Sidebar
  // links, Canvas rechts). Wir geben deshalb ZWEI Top-Level-Kinder zurück
  // — Wrapper-Divs wie .anim-layout würden das Grid zerschießen.
  body.innerHTML = `
    <aside class="panel" id="height-panel">
        <!-- v0.9.437 (Daten-Animator) — Serien-Auswahl ganz oben: WAS wird
             animiert? Wird aus dem geladenen Track gefüllt (Höhe/Tempo/Steigung
             + Sensoren wie Puls/Leistung). Ohne Track/nur eine Reihe: disabled. -->
        <div class="field" id="ha-series-field" style="padding:12px 14px 4px;">
          <div style="display:flex; align-items:center;">
            <label class="field-label" for="ha-series-a" style="margin:0;">${t("heightanim.field.series_a", "Datenreihe")}</label>
            ${_help("heightanim.series.hint", "Was animiert wird. Puls, Trittfrequenz & Co. erscheinen automatisch, wenn dein Track (z. B. FIT) sie enthält.")}
          </div>
          <select id="ha-series-a"></select>
        </div>
        <!-- v0.9.438 — optionale zweite Reihe auf eigener rechter Achse -->
        <div class="field" id="ha-series-b-field" style="padding:4px 14px 12px;">
          <div style="display:flex; align-items:center;">
            <label class="field-label" for="ha-series-b" style="margin:0;">${t("heightanim.field.series_b", "Zweite Datenreihe (rechte Achse)")}</label>
            <span class="rz-help" tabindex="0" role="img" title="${_haEsc(t("heightanim.series_b.hint", "Optional: eine zweite Kurve mit eigener Achse rechts — z. B. Höhe links, Puls rechts.") + "\n\n" + t("heightanim.series_b.applies_hint", "Farbe, Fläche, Farbzonen, Info-Leiste und Punkte gelten für die linke Achse (erste Datenreihe)."))}">?</span>
          </div>
          <select id="ha-series-b"></select>
          <!-- v0.9.442 — gleiches Feld-Muster wie überall (Label + Wert in px) -->
          <div class="row-2" id="ha-series-b-style" style="margin-top:6px;">
            <div class="field">
              <label class="field-label">${t("heightanim.field.line_color", "Linienfarbe")}</label>
              <input type="color" id="ha-line-color-b" value="#2e86de">
            </div>
            <div class="field">
              <label class="field-label">${t("heightanim.field.line_width", "Liniendicke")} <span class="label-val" id="ha-line-width-b-val">3 px</span></label>
              <input type="range" id="ha-line-width-b" min="1" max="10" step="0.5" value="3">
            </div>
          </div>
        </div>
        <section class="section" data-accordion-section="general">
          <button class="section-collapse-header" type="button">
            <span>${t("heightanim.section.general", "⚙️ Allgemein")}</span>${_help("heightanim.intro", "Erstellt ein Video, das die Messkurve deines Tracks live aufbaut.")}
            <span class="collapse-arrow">▸</span>
          </button>
          <div class="section-collapse-body" hidden>
            <div class="row-3">
              <div class="field">
                <label class="field-label">${t("animator.field.duration")} <span class="label-val" id="height-dur-v">12 s</span></label>
                <input type="range" id="height-dur" min="2" max="60" step="1" value="12">
              </div>
              <div class="field">
                <label class="field-label">${t("animator.field.hold")} <span class="label-val" id="height-hold-v">2 s</span></label>
                <input type="range" id="height-hold" min="0" max="10" step="1" value="2">
              </div>
              <div class="field">
                <label class="field-label">${t("animator.field.fps")} <span class="label-val" id="height-fps-v">30</span></label>
                <input type="range" id="height-fps" min="24" max="60" step="6" value="30">
              </div>
            </div>
            <div class="field">
              <label class="field-label">${t("animator.field.resolution", "Auflösung")}</label>
              <div class="res-picker">
                <button type="button" class="res-btn" data-w="3840" data-h="2160" title="3840×2160 · 16:9">4K</button>
                <button type="button" class="res-btn" data-w="1920" data-h="1080" title="1920×1080 · 16:9">1080p</button>
                <button type="button" class="res-btn" data-w="2160" data-h="3840" title="2160×3840 · 9:16 Hochkant">4K↕</button>
                <button type="button" class="res-btn" data-w="1080" data-h="1920" title="1080×1920 · 9:16 Hochkant (Shorts/Reels)">1080↕</button>
              </div>
              <div class="row-2 res-custom">
                <input type="number" id="height-w" min="640" max="7680" step="2" value="1920" placeholder="${t("animator.field.width")}">
                <input type="number" id="height-h" min="360" max="7680" step="2" value="1080" placeholder="${t("animator.field.height")}">
              </div>
            </div>
          </div>
        </section>

        <section class="section" data-accordion-section="style">
          <button class="section-collapse-header" type="button">
            <span>${t("heightanim.section.style", "🎨 Optik")}</span>
            <span class="collapse-arrow">▸</span>
          </button>
          <div class="section-collapse-body" hidden>
            <div class="field">
              <label class="field-label">${t("heightanim.field.bg_color", "Hintergrund")}</label>
              <input type="color" id="height-bg" value="#1a1a1a">
            </div>
            <div class="field">
              <label class="field-label">${t("heightanim.field.line_color", "Linienfarbe")}</label>
              <input type="color" id="height-color" value="#ff6b35">
            </div>
            <div class="field">
              <label class="field-label">${t("heightanim.field.line_width", "Liniendicke")} <span class="label-val" id="height-lw-v">4.0 px</span></label>
              <input type="range" id="height-lw" min="1" max="10" step="0.5" value="4">
            </div>
            <div class="field">
              <label class="field-label">${t("heightanim.field.smoothing", "Glättung")} <span class="label-val" id="height-smoothing-v">0</span></label>
              <input type="range" id="height-smoothing" min="0" max="20" step="1" value="0">
            </div>
            <div class="row-2">
              <div class="field">
                <label class="field-label">${t("heightanim.field.grid_color", "Gitterfarbe")}</label>
                <input type="color" id="height-grid-color" value="#3a3a3a">
              </div>
              <div class="field">
                <label class="field-label">${t("heightanim.field.label_color", "Beschriftungsfarbe")}</label>
                <input type="color" id="height-label-color" value="#cccccc">
              </div>
            </div>
            <label class="checkbox-row">
              <input type="checkbox" id="height-grid" checked>
              <span>${t("heightanim.field.grid", "Hilfsgitter zeigen")}</span>
            </label>
            <label class="checkbox-row">
              <input type="checkbox" id="height-axes" checked>
              <span>${t("heightanim.field.axes", "Achsen-Beschriftung zeigen")}</span>
            </label>
            <!-- v0.9.447 — Achsen einzeln steuerbar. Vorher gab es nur den Schalter
                 darüber und fest verdrahtete Werte-Anzahlen; als kleines Overlay auf
                 der Karte wurde die Beschriftung dadurch unlesbar klein. -->
            <div id="height-axis-detail" style="margin-left:20px">
              <label class="checkbox-row">
                <input type="checkbox" id="height-axis-x" checked>
                <span>${t("heightanim.field.axis_x", "X-Achse (Distanz)")}</span>
              </label>
              <label class="checkbox-row">
                <input type="checkbox" id="height-axis-y" checked>
                <span>${t("heightanim.field.axis_y", "Y-Achse links")}</span>
              </label>
              <label class="checkbox-row">
                <input type="checkbox" id="height-axis-y2" checked>
                <span>${t("heightanim.field.axis_y2", "Y-Achse rechts (2. Reihe)")}</span>
              </label>
              <div class="field">
                <label class="field-label">${t("heightanim.field.axis_font", "Schriftgröße")}
                  <span class="label-val" id="height-axis-font-v">20 px</span></label>
                <input type="range" id="height-axis-font" min="8" max="60" step="1" value="20">
              </div>
              <div class="field">
                <label class="field-label">${t("heightanim.field.axis_x_ticks", "Werte auf X")}
                  <span class="label-val" id="height-axis-xt-v">6</span></label>
                <input type="range" id="height-axis-xt" min="1" max="12" step="1" value="6">
              </div>
              <div class="field">
                <label class="field-label">${t("heightanim.field.axis_y_ticks", "Werte auf Y")}
                  <span class="label-val" id="height-axis-yt-v">5</span></label>
                <input type="range" id="height-axis-yt" min="1" max="12" step="1" value="5">
              </div>
            </div>
          </div>
        </section>

        <section class="section" data-accordion-section="fill">
          <button class="section-collapse-header" type="button">
            <span>${t("heightanim.section.fill", "🪣 Fläche unter der Linie")}</span>${_help("heightanim.fill.hint", "Ab jeder eingestellten Schwelle wechselt die Füllfarbe. Ohne Zonen gilt die Füllfarbe für die ganze Fläche.")}
            <span class="collapse-arrow">▸</span>
          </button>
          <div class="section-collapse-body" hidden>
            <label class="checkbox-row">
              <input type="checkbox" id="height-area-fill" checked>
              <span>${t("heightanim.fill.enabled", "Fläche füllen")}</span>
            </label>
            <div class="row-2">
              <div class="field">
                <label class="field-label">${t("heightanim.fill.color", "Füllfarbe")}</label>
                <input type="color" id="height-area-color" value="#ff6b35">
              </div>
              <div class="field">
                <label class="field-label">${t("heightanim.fill.opacity", "Deckkraft")} <span class="label-val" id="height-area-op-v">18 %</span></label>
                <input type="range" id="height-area-op" min="0" max="100" step="1" value="18">
              </div>
            </div>
            <div class="section-subhead" style="margin:12px 0 4px; font-size:12px; opacity:0.7;">${t("heightanim.fill.zones", "Farbzonen")}</div>
            <div class="field">
              <label class="field-label">${t("heightanim.fill.mode", "Farbübergang")}</label>
              <select id="height-area-mode">
                <option value="smooth">${t("heightanim.fill.mode_smooth", "Weicher Verlauf")}</option>
                <option value="bands">${t("heightanim.fill.mode_bands", "Harte Bänder")}</option>
              </select>
            </div>
            <div class="row-2" style="align-items:flex-end;">
              <div class="field">
                <label class="field-label">${t("heightanim.fill.steps", "Anzahl Stufen")}</label>
                <input type="number" id="height-area-steps" min="2" max="12" step="1" value="4">
              </div>
              <button type="button" class="btn btn-secondary" id="height-area-gen">${t("heightanim.fill.generate", "Stufen anlegen")}</button>
            </div>
            <div id="height-fill-stops" class="height-wp-list"></div>
            <button type="button" class="btn btn-secondary btn-block" id="height-area-add-stop" style="margin:8px 0 0;">
              + ${t("heightanim.fill.add", "Farbschwelle")}
            </button>
          </div>
        </section>

        <section class="section" data-accordion-section="bgzones">
          <button class="section-collapse-header" type="button">
            <span>${t("heightanim.section.bgzones", "🖼️ Hintergrund-Farbzonen")}</span>${_help("heightanim.bg.intro", "Färbt den Hintergrund nach Wert ein.")}
            <span class="collapse-arrow">▸</span>
          </button>
          <div class="section-collapse-body" hidden>
            <label class="checkbox-row">
              <input type="checkbox" id="height-bg-clip">
              <span>${t("heightanim.bg.clip", "Nur im Diagramm-Bereich (innerhalb der Achsen)")}</span>
            </label>
            <div class="field">
              <label class="field-label">${t("heightanim.fill.mode", "Farbübergang")}</label>
              <select id="height-bg-mode">
                <option value="smooth">${t("heightanim.fill.mode_smooth", "Weicher Verlauf")}</option>
                <option value="bands">${t("heightanim.fill.mode_bands", "Harte Bänder")}</option>
              </select>
            </div>
            <div class="row-2" style="align-items:flex-end;">
              <div class="field">
                <label class="field-label">${t("heightanim.fill.steps", "Anzahl Stufen")}</label>
                <input type="number" id="height-bg-steps" min="2" max="12" step="1" value="4">
              </div>
              <button type="button" class="btn btn-secondary" id="height-bg-gen">${t("heightanim.fill.generate", "Stufen anlegen")}</button>
            </div>
            <div id="height-bg-stops" class="height-wp-list"></div>
            <button type="button" class="btn btn-secondary btn-block" id="height-bg-add-stop" style="margin:8px 0 0;">
              + ${t("heightanim.fill.add", "Farbschwelle")}
            </button>
          </div>
        </section>

        <section class="section" data-accordion-section="linezones">
          <button class="section-collapse-header" type="button">
            <span>${t("heightanim.section.linezones", "🌈 Linien-Farbzonen")}</span>${_help("heightanim.line.intro", "Färbt die Linie nach Wert ein.")}
            <span class="collapse-arrow">▸</span>
          </button>
          <div class="section-collapse-body" hidden>
            <div class="field">
              <label class="field-label">${t("heightanim.fill.mode", "Farbübergang")}</label>
              <select id="height-line-mode">
                <option value="smooth">${t("heightanim.fill.mode_smooth", "Weicher Verlauf")}</option>
                <option value="bands">${t("heightanim.fill.mode_bands", "Harte Bänder")}</option>
              </select>
            </div>
            <div class="row-2" style="align-items:flex-end;">
              <div class="field">
                <label class="field-label">${t("heightanim.fill.steps", "Anzahl Stufen")}</label>
                <input type="number" id="height-line-steps" min="2" max="12" step="1" value="4">
              </div>
              <button type="button" class="btn btn-secondary" id="height-line-gen">${t("heightanim.fill.generate", "Stufen anlegen")}</button>
            </div>
            <div id="height-line-stops" class="height-wp-list"></div>
            <button type="button" class="btn btn-secondary btn-block" id="height-line-add-stop" style="margin:8px 0 0;">
              + ${t("heightanim.fill.add", "Farbschwelle")}
            </button>
          </div>
        </section>

        <section class="section" data-accordion-section="marker">
          <button class="section-collapse-header" type="button">
            <span>${t("heightanim.section.marker", "📍 Marker")}</span>
            <span class="collapse-arrow">▸</span>
          </button>
          <div class="section-collapse-body" hidden>
            <label class="checkbox-row">
              <input type="checkbox" id="height-marker-dot" checked>
              <span>${t("heightanim.marker.show_dot", "Laufpunkt zeigen")}</span>
            </label>
            <div class="row-2">
              <div class="field">
                <label class="field-label">${t("heightanim.marker.dot_color", "Punktfarbe")}</label>
                <input type="color" id="height-marker-dot-color" value="#ffffff">
              </div>
              <div class="field">
                <label class="field-label">${t("heightanim.marker.dot_size", "Punktgröße")} <span class="label-val" id="height-marker-dot-size-v">6 px</span></label>
                <input type="range" id="height-marker-dot-size" min="2" max="18" step="1" value="6">
              </div>
            </div>

            <label class="checkbox-row" style="margin-top:6px;">
              <input type="checkbox" id="height-marker" checked>
              <span>${t("heightanim.marker.show", "Info-Box zeigen")}</span>
            </label>
            <div class="section-subhead" style="margin:10px 0 4px; font-size:12px; opacity:0.7;">${t("heightanim.marker.callout", "Info-Box am Marker")}</div>
            <!-- v0.9.442 — ⛰ + Steigung sind höhen-only: Zeilen werden bei
                 anderen Reihen komplett ausgeblendet (syncEleOnlyRows) -->
            <label class="checkbox-row" data-ele-only="1">
              <input type="checkbox" id="height-marker-icon" checked>
              <span>${t("heightanim.marker.icon", "⛰-Symbol zeigen")}</span>
            </label>
            <label class="checkbox-row">
              <input type="checkbox" id="height-marker-ele" checked>
              <span>${t("heightanim.marker.ele", "Wert zeigen")}</span>
            </label>
            <label class="checkbox-row" data-ele-only="1">
              <input type="checkbox" id="height-gradient" checked>
              <span>${t("heightanim.marker.gradient", "Steigung % zeigen")}</span>
            </label>
            <label class="checkbox-row">
              <input type="checkbox" id="height-marker-dist" checked>
              <span>${t("heightanim.marker.dist", "Distanz zeigen")}</span>
            </label>
            <div class="row-2">
              <div class="field">
                <label class="field-label">${t("heightanim.marker.bg", "Hintergrundfarbe")}</label>
                <input type="color" id="height-marker-bg" value="#000000">
              </div>
              <div class="field">
                <label class="field-label">${t("heightanim.marker.bg_op", "Deckkraft")} <span class="label-val" id="height-marker-bg-op-v">60 %</span></label>
                <input type="range" id="height-marker-bg-op" min="0" max="100" step="5" value="60">
              </div>
            </div>
            <div class="row-2">
              <div class="field">
                <label class="field-label">${t("heightanim.marker.border", "Randfarbe")}</label>
                <input type="color" id="height-marker-border" value="#ff6b35">
              </div>
              <div class="field">
                <label class="field-label">${t("heightanim.marker.border_w", "Randdicke")} <span class="label-val" id="height-marker-bw-v">1.5 px</span></label>
                <input type="range" id="height-marker-bw" min="0" max="6" step="0.5" value="1.5">
              </div>
            </div>
            <div class="field">
              <label class="field-label">${t("heightanim.marker.font", "Schriftgröße")} <span class="label-val" id="height-marker-fs-v">16 px</span></label>
              <input type="range" id="height-marker-fs" min="10" max="34" step="1" value="16">
            </div>
          </div>
        </section>

        <section class="section" data-accordion-section="header">
          <button class="section-collapse-header" type="button">
            <span>${t("heightanim.section.header", "ℹ️ Info-Leiste")}</span>
            <span class="collapse-arrow">▸</span>
          </button>
          <div class="section-collapse-body" hidden>
            <label class="checkbox-row">
              <input type="checkbox" id="height-header" checked>
              <span>${t("heightanim.header.show", "Sachliche Info-Leiste zeigen")}</span>
            </label>
            <div class="muted" style="font-size:11px; margin:2px 0 8px;">
              ${t("heightanim.header.hint", "Welche Werte oben eingeblendet werden:")}
            </div>
            <div id="height-header-fields" class="height-field-list"></div>
          </div>
        </section>

        <section class="section" data-accordion-section="points">
          <button class="section-collapse-header" type="button">
            <span>${t("heightanim.section.points", "🚩 Punkte auf der Strecke")}</span>
            <span class="collapse-arrow">▸</span>
          </button>
          <div class="section-collapse-body" hidden>
            <label class="checkbox-row">
              <input type="checkbox" id="height-src-photos" checked>
              <span>${t("heightanim.points.photos", "Fotos anzeigen")}</span>
            </label>
            <label class="checkbox-row">
              <input type="checkbox" id="height-src-gpx" checked>
              <span>${t("heightanim.points.gpx", "GPX-Wegpunkte anzeigen")}</span>
            </label>
            <label class="checkbox-row">
              <input type="checkbox" id="height-src-auto">
              <span>${t("heightanim.points.auto", "Auto-Marker (Gipfel/Tiefpunkt/steilste)")}</span>
            </label>
            <button type="button" class="btn btn-secondary btn-block" id="height-add-point" style="margin:8px 0;">
              + ${t("heightanim.points.add", "Punkt aufs Profil setzen")}
            </button>
            <p class="muted" id="height-add-hint" style="font-size:11px; margin:0 0 8px; display:none;">
              ${t("heightanim.points.add_hint", "Jetzt in die Kurve klicken um den Punkt zu setzen.")}
            </p>
            <div id="height-wp-list" class="height-wp-list"></div>
          </div>
        </section>

        <section class="section" data-accordion-section="render">
          <button class="section-collapse-header" type="button">
            <span>${t("heightanim.section.render", "🎬 Rendern")}</span>
            <span class="collapse-arrow">▸</span>
          </button>
          <div class="section-collapse-body" hidden>
            <div class="field">
              <label class="field-label" for="height-codec">${t("heightanim.field.codec", "Codec / Format")}</label>
              <select id="height-codec">
                <option value="h264">${t("heightanim.codec.h264", "MP4 (H.264) — kompatibel, kleinste Datei")}</option>
                <option value="h265">${t("heightanim.codec.h265", "MP4 (H.265 / HEVC) — bessere Kompression")}</option>
                <option value="prores">${t("heightanim.codec.prores", "ProRes 4444 (.mov) — Master-Qualität")}</option>
                <option value="alpha">${t("heightanim.codec.alpha", "ProRes 4444 mit Alpha (.mov) — Overlay")}</option>
              </select>
              <p class="muted" style="font-size:11px; margin-top:4px;" id="height-codec-hint">
                ${t("heightanim.codec.hint.h264", "Standard für YouTube, Web, NLE-Schnitt.")}
              </p>
            </div>
            <button type="button" class="btn btn-primary btn-block" id="height-render">
              ▶ ${t("heightanim.btn.render", "Video rendern")}
            </button>
            <div class="render-progress" id="height-progress" style="display:none; margin-top:12px;">
              <div class="render-progress-row" style="display:flex; align-items:center; gap:8px;">
                <span id="height-pct" style="font-family:ui-monospace,Menlo,monospace; font-size:12px; min-width:40px;">0%</span>
                <div class="render-progress-bar" style="flex:1; height:8px; background:rgba(255,255,255,0.1); border-radius:4px; overflow:hidden;">
                  <div id="height-fill" style="height:100%; width:0%; background:#ff6b35; transition:width 0.2s;"></div>
                </div>
              </div>
              <p id="height-status" class="muted" style="font-size:11px; margin:6px 0 0 0;"></p>
              <button type="button" id="height-cancel" class="btn btn-secondary" style="margin-top:8px; width:100%; font-size:12px;">
                ${t("animator.btn.cancel", "Abbrechen")}
              </button>
            </div>
            <div id="height-done" style="display:none; margin-top:12px; padding:10px; background:rgba(80,200,120,0.10); border-left:3px solid #50c878; border-radius:4px;">
              <p style="font-size:12px; margin:0 0 8px 0;">${t("heightanim.done.label", "Video fertig.")}</p>
              <button type="button" id="height-open-folder" class="btn btn-secondary" style="width:100%; font-size:12px;">
                ${t("animator.btn.reveal")}
              </button>
            </div>

            <div style="margin-top:14px; border-top:1px solid rgba(255,255,255,0.08); padding-top:12px;">
              <button type="button" class="btn btn-secondary btn-block" id="height-export-html">
                ${t("heightanim.btn.export_html", "Als HTML exportieren (Blog/Web)")}
              </button>
              <p class="muted" style="font-size:11px; margin:6px 0 0;">
                ${t("heightanim.html.hint", "Selbst-laufende Animation als HTML — für WordPress & Co., ohne Video.")}
              </p>
            </div>
          </div>
        </section>
    </aside>
    <section class="canvas anim-canvas" id="height-canvas-host">
      <!-- v0.9.128: Layout analog Animator — Viewport mit Letterbox-Aspect-Ratio,
           Anim-Bar als Geschwister-Element drunter (statt im Viewport). -->
      <div class="height-viewport" id="height-viewport">
        <svg id="height-svg" style="display:block; width:100%; height:100%;"></svg>
        <div class="height-empty-hint" id="height-empty-hint">
          ${t("heightanim.empty_hint", "Lade einen GPX-Track, um die Kurve zu sehen.")}
        </div>
      </div>
      <div class="height-anim-bar" id="height-anim-bar">
        <button type="button" class="height-play-btn" id="height-play" aria-label="Play/Pause" title="Play/Pause">▶</button>
        <div class="height-track-wrap" id="height-track-wrap">
          <!-- Shade-Overlays für nicht-getrimmten Bereich -->
          <div class="height-trim-shade height-trim-shade-left" id="height-trim-shade-left"></div>
          <div class="height-trim-shade height-trim-shade-right" id="height-trim-shade-right"></div>
          <!-- Progress-Bar (unter den Handles) -->
          <input type="range" id="height-scrub" min="0" max="1000" step="1" value="0" class="height-progress-slider">
          <!-- Trim-Handles (links + rechts) wie im Animator -->
          <div class="height-trim-handle height-trim-handle-start" id="height-trim-handle-start"
               title="${t("heightanim.trim.start_tip", "Start ziehen — Trim-Anfang")}">
            <div class="height-trim-grip"></div>
          </div>
          <div class="height-trim-handle height-trim-handle-end" id="height-trim-handle-end"
               title="${t("heightanim.trim.end_tip", "Ende ziehen — Trim-Ende")}">
            <div class="height-trim-grip"></div>
          </div>
        </div>
        <span class="height-time" id="height-time">0.0 / 12.0 s</span>
      </div>
    </section>
  `;

  // ── State ──────────────────────────────────────────────────────────────
  let _currentData = null;   // { elevations, distances_m, stats }
  let _progress = 0;         // 0..1 — Position in der Animation
  let _playing = false;
  let _rafId = null;
  let _lastFrameTime = 0;
  let _holdingUntil = 0;     // wenn > 0: Hold-Phase aktiv (Zeitstempel ms wann sie endet)
  // Trim: welcher Track-Bereich wird animiert (0..1)
  let _trimStart = 0;
  let _trimEnd = 1;
  // Render-Polling
  let _renderPollTimer = null;
  let _lastRenderPreviewB64 = "";

  // ── v0.9.394 — Info-Leiste + Steigung + Wegpunkte ──────────────────────────
  let _showHeader = true;
  let _showGradient = true;
  let _statsFields = ["distance", "updown", "avg_grad", "max_grad", "ele_max"];
  // v0.9.437 (Daten-Animator) — welche Messreihe geplottet wird. `_seriesA` ist
  // die ID (ele/speed/grade/hr/power/…); die Werte landen in
  // `_currentData.elevations`, damit Vorschau/Marker/Zonen unverändert darauf
  // rechnen (genau wie im Backend, wo `elevations` ebenfalls generisch ist).
  // SYNCHRON zu core/heightanim.py (_series_decimals / series_meta / S_IS_ELE).
  let _seriesA = "ele";
  function _haSeriesList() { return (_currentData && Array.isArray(_currentData.series)) ? _currentData.series : []; }
  function _haSeries(id) { return _haSeriesList().find(s => s.id === (id || _seriesA)) || null; }
  function _haIsEle() { return _seriesA === "ele"; }
  function _haDec() { return ["speed", "grade", "temperature", "core_temp"].indexOf(_seriesA) >= 0 ? 1 : 0; }
  function _haUnit() { const s = _haSeries(); return s ? (s.unit || "") : "m"; }
  function _haLabel() { const s = _haSeries(); return s ? s.label : t("heightanim.series.ele", "Höhe"); }
  function _haFmt(v) { const u = _haUnit(); return v.toFixed(_haDec()) + (u ? " " + u : ""); }
  // ── Zweite Reihe (v0.9.438) ────────────────────────────────────────────────
  // Anders als A wird B NICHT in `_currentData.elevations` geschoben, sondern
  // separat gehalten — beide müssen ja gleichzeitig gezeichnet werden.
  let _seriesB = "";
  let _lineColorB = "#2e86de";
  let _lineWidthB = 3;
  function _haSeriesB() { return _seriesB ? (_haSeriesList().find(s => s.id === _seriesB) || null) : null; }
  // Werte der zweiten Reihe — null, wenn keine gewählt/vorhanden oder wenn sie
  // dieselbe wie A ist (zwei identische Kurven ergeben keine zweite Achse).
  function _haValuesB() {
    if (!_seriesB || _seriesB === _seriesA) return null;
    const s = _haSeriesB();
    if (!s || !Array.isArray(s.values) || !s.values.length) return null;
    return _rzSmooth(s.values, _smoothingVal());
  }
  function _haDecB() { return ["speed", "grade", "temperature", "core_temp"].indexOf(_seriesB) >= 0 ? 1 : 0; }
  function _haUnitB() { const s = _haSeriesB(); return s ? (s.unit || "") : ""; }
  function _haFmtB(v) { const u = _haUnitB(); return v.toFixed(_haDecB()) + (u ? " " + u : ""); }
  // Serie anwenden: Werte in `_currentData.elevations` schieben — dadurch
  // rechnen Kurve, Y-Skala, Marker, Farbzonen und Min/Max/Ø unverändert weiter.
  // Fällt auf die erste verfügbare Reihe zurück, wenn die gewünschte fehlt
  // (gleiche Semantik wie resolve_series() im Backend).
  function applySeries(id, opts) {
    const list = _haSeriesList();
    if (!list.length) return;
    let hit = list.find(s => s.id === id) || list.find(s => s.id === "ele") || list[0];
    _seriesA = hit.id;
    if (_currentData) _currentData.elevations = hit.values.slice();
    const sel = document.getElementById("ha-series-a");
    if (sel && sel.value !== _seriesA) sel.value = _seriesA;
    // v0.9.441 — Info-Leiste-Feldauswahl + B-Dropdown an die neue Reihe anpassen
    // (höhen-only Felder verschwinden bei Puls, Farbzonen-Tooltip-Einheit etc.).
    try { renderHeaderFields(); } catch (_) {}
    try { renderSeriesSelectB(); } catch (_) {}
    // v0.9.442 — höhen-only Marker-Zeilen (⛰, Steigung %) ein-/ausblenden und
    // die Farbzonen-Listen neu bauen (Schrittweite + Einheit hängen an der Reihe).
    try { syncEleOnlyRows(); } catch (_) {}
    try { syncAxisDetail(); } catch (_) {}
    try { ["fill", "bg", "line"].forEach(k => renderZoneStops(k)); } catch (_) {}
    if (!opts || opts.redraw !== false) { try { drawElevationSvg(); } catch (_) {} }
    if (!opts || opts.persist !== false) {
      try { saveProjectSettings(_MODKEY, { series_a: _seriesA }); } catch (_) {}
    }
  }
  // Dropdown aus den Serien des geladenen Tracks bauen (nur was da ist).
  function renderSeriesSelect() {
    const sel = document.getElementById("ha-series-a");
    if (!sel) return;
    const list = _haSeriesList();
    sel.innerHTML = list.map(s => `<option value="${s.id}">${_haEsc(s.label)}${s.unit ? " (" + _haEsc(s.unit) + ")" : ""}</option>`).join("");
    sel.disabled = list.length < 2;
    if (list.length) sel.value = _seriesA;
    renderSeriesSelectB();
  }
  // v0.9.438 — B-Dropdown: „—" (aus) plus alles außer der aktuell gewählten A.
  function renderSeriesSelectB() {
    const sel = document.getElementById("ha-series-b");
    if (!sel) return;
    const list = _haSeriesList().filter(s => s.id !== _seriesA);
    const off = `<option value="">${_haEsc(t("heightanim.series_b.off", "— keine —"))}</option>`;
    sel.innerHTML = off + list.map(s =>
      `<option value="${s.id}">${_haEsc(s.label)}${s.unit ? " (" + _haEsc(s.unit) + ")" : ""}</option>`).join("");
    // Wurde A auf die Reihe gestellt, die B belegt, fällt B weg.
    if (_seriesB && !list.some(s => s.id === _seriesB)) _seriesB = "";
    sel.value = _seriesB;
    sel.disabled = !list.length;
    // Farbe/Breite gehören zu B — ohne B gibt es nichts einzustellen.
    const style = document.getElementById("ha-series-b-style");
    if (style) style.style.display = _seriesB ? "" : "none";
    const c = document.getElementById("ha-line-color-b");
    if (c) c.value = _lineColorB;
    const w = document.getElementById("ha-line-width-b");
    if (w) w.value = String(_lineWidthB);
    const wv = document.getElementById("ha-line-width-b-val");
    if (wv) wv.textContent = _lineWidthB + " px";
    // v0.9.439 — Achsen-Klarheit: sobald eine zweite Reihe (rechte Achse) aktiv
    // ist, bekommt die erste Auswahl den Zusatz „· linke Achse" und der Hinweis
    // erklärt, dass alle übrigen Einstellungen zur linken Achse gehören. Ohne
    // zweite Reihe gibt es nur eine Achse → schlicht „Datenreihe".
    const aLbl = document.querySelector('label[for="ha-series-a"]');
    if (aLbl) {
      aLbl.textContent = _seriesB
        ? t("heightanim.field.series_a_left", "Datenreihe · linke Achse")
        : t("heightanim.field.series_a", "Datenreihe");
    }
  }
  // v0.9.447 — Detail-Block der Achsen ausgrauen, wenn der Haupt-Schalter aus ist.
  function syncAxisDetail() {
    const on = document.getElementById("height-axes")?.checked !== false;
    const box = document.getElementById("height-axis-detail");
    if (!box) return;
    box.style.opacity = on ? "" : ".4";
    box.style.pointerEvents = on ? "" : "none";
  }
  function _haEsc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  // v0.9.442 — Marker-Zeilen, die nur bei der Reihe „Höhe" Sinn ergeben
  // (⛰-Symbol, Steigung %), bei anderen Reihen komplett ausblenden — „nur
  // zeigen, was wir haben". Markiert per data-ele-only im Panel-HTML.
  function syncEleOnlyRows() {
    const show = _haIsEle();
    document.querySelectorAll('#height-panel [data-ele-only]').forEach(el => {
      el.style.display = show ? "" : "none";
    });
  }
  // v0.9.441 — „?"-Hilfe-Badge statt Dauer-Erklärtext in der Sidebar. Native
  // title-Tooltip (Hover/Fokus); hält die Seitenleiste kurz. Function-Declaration
  // → gehoisted, im Panel-Template nutzbar.
  function _help(key, fallback) {
    const e = _haEsc(t(key, fallback));
    return `<span class="rz-help" tabindex="0" role="img" title="${e}" aria-label="${e}">?</span>`;
  }
  let _wpSources = { photos: true, gpx: true, auto: false };
  let _manualWps = [];       // [{id, dist_frac, label, color}]
  let _autoMarkers = [];     // aus load_gpx (dist_m, ele, kind, grad)
  let _gpxWaypoints = [];    // aus load_gpx (dist_m, ele, name)
  let _wpHidden = {};        // {key: true} — einzelne Auto/GPX/Foto-Punkte ausblenden
  let _armAddPoint = false;  // nächster Klick aufs Profil setzt einen Punkt
  let _wpSeq = 1;
  // v0.9.402/403 — Höhen-Farbzonen für drei Ziele: Fläche, Hintergrund, Linie.
  // Jede Liste: [{id, ele, color}] — ab jeder Höhe wechselt die Farbe des Ziels.
  let _fillStops = [];
  let _bgStops = [];
  let _lineStops = [];
  let _zoneSeq = 1;

  // v0.9.401 — Projekt-State (Trim, Info-Leiste, Wegpunkte, Control-Farben) aus dem
  // aktiven Projekt laden. WICHTIG: Beim Kaltstart mountet das Modul BEVOR die Session
  // async geladen ist (`_activeProject` noch null) → dieser erste Aufruf findet nichts.
  // Sobald der GPX-Track async lädt (applyGlobalGpxToHeightModule), ist das Projekt da
  // und wir rufen dieselbe Funktion mit refreshUi erneut → dann greifen die Farben.
  // (Marc-Bug: „merkt sich die Farben nicht" — der Restore lief nur EINMAL, zu früh.)
  reloadProjectStateFromActive({ refreshUi: false });

  // v0.9.437 (Daten-Animator) — Serien-Auswahl verdrahten. Das Dropdown selbst
  // wird erst beim GPX-Load befüllt (renderSeriesSelect), der Listener kann
  // aber schon jetzt hängen. Gemerkte Serie aus dem Projekt vorladen.
  try {
    const _sv = (_activeProject && _activeProject[_MODKEY] && _activeProject[_MODKEY].series_a)
      || (typeof _settingsCache !== "undefined" && _settingsCache && _settingsCache[_MODKEY] && _settingsCache[_MODKEY].series_a);
    if (_sv) _seriesA = String(_sv);
  } catch (_) {}
  document.getElementById("ha-series-a")?.addEventListener("change", (e) => {
    applySeries(e.target.value);
  });
  // v0.9.438 — zweite Reihe. Sie wandert NICHT in _currentData.elevations
  // (dort liegt A), sondern wird beim Zeichnen separat geholt → neu zeichnen
  // reicht.
  try {
    const _b = (_activeProject && _activeProject[_MODKEY] && _activeProject[_MODKEY].series_b)
      || (_settingsCache && _settingsCache.series_b);
    if (_b) _seriesB = String(_b);
    const _bc = (_activeProject && _activeProject[_MODKEY] && _activeProject[_MODKEY].line_color_b)
      || (_settingsCache && _settingsCache.line_color_b);
    if (_bc) _lineColorB = String(_bc);
    const _bw = (_activeProject && _activeProject[_MODKEY] && _activeProject[_MODKEY].line_width_b)
      || (_settingsCache && _settingsCache.line_width_b);
    if (_bw) _lineWidthB = +_bw || 3;
  } catch (_) {}
  function _persistSeriesB() {
    try {
      saveProjectSettings(_MODKEY, {
        series_b: _seriesB, line_color_b: _lineColorB, line_width_b: _lineWidthB,
      });
    } catch (_) {}
  }
  document.getElementById("ha-series-b")?.addEventListener("change", (e) => {
    _seriesB = String(e.target.value || "");
    renderSeriesSelectB();
    _persistSeriesB();
    drawElevationSvg();
  });
  document.getElementById("ha-line-color-b")?.addEventListener("input", (e) => {
    _lineColorB = e.target.value; _persistSeriesB(); drawElevationSvg();
  });
  document.getElementById("ha-line-width-b")?.addEventListener("input", (e) => {
    _lineWidthB = +e.target.value || 3;
    const v = document.getElementById("ha-line-width-b-val");
    if (v) v.textContent = _lineWidthB + " px";
    _persistSeriesB(); drawElevationSvg();
  });

  // v0.9.399 — alle DOM-Controls (#height-panel) als {id: value/checked} lesen.
  function _readHeightControls() {
    const root = document.getElementById("height-panel");
    const o = {};
    if (root) root.querySelectorAll("input, select").forEach(el => {
      if (!el.id) return;
      o[el.id] = (el.type === "checkbox" || el.type === "radio") ? !!el.checked : el.value;
    });
    return o;
  }
  // Slider-Wert-Labels aus den aktuellen Slider-Werten neu setzen (nach Restore,
  // da wir dabei KEINE input-Events feuern → Undo/Persist bleiben unangetastet).
  function _refreshHeightSliderLabels() {
    const set = (sid, lid, fmt, suf) => {
      const s = document.getElementById(sid), l = document.getElementById(lid);
      if (s && l) l.textContent = fmt(s.value) + (suf || "");
    };
    set("height-dur", "height-dur-v", v => v, " s");
    set("height-hold", "height-hold-v", v => v, " s");
    set("height-fps", "height-fps-v", v => v, "");
    set("height-lw", "height-lw-v", v => parseFloat(v).toFixed(1), " px");
    set("height-smoothing", "height-smoothing-v", v => v, "");
    set("height-area-op", "height-area-op-v", v => v, " %");
    set("height-marker-dot-size", "height-marker-dot-size-v", v => v, " px");
    // v0.9.447 — Achsen-Detailsteuerung
    set("height-axis-font", "height-axis-font-v", v => v, " px");
    set("height-axis-xt", "height-axis-xt-v", v => v, "");
    set("height-axis-yt", "height-axis-yt-v", v => v, "");
    set("height-marker-bg-op", "height-marker-bg-op-v", v => v, " %");
    set("height-marker-bw", "height-marker-bw-v", v => parseFloat(v).toFixed(1), " px");
    set("height-marker-fs", "height-marker-fs-v", v => v, " px");
  }
  // v0.9.399 — Beim Mount die gespeicherten Control-Werte zurückspielen (Farben,
  // Größen, Auflösung, Dauer …). OHNE Event-Dispatch (keine Undo-/Persist-/Draw-
  // Nebenwirkungen); der normale Initial-Draw/Layout liest die Werte danach.
  function restoreHeightControls() {
    try {
      const proj = (typeof window.getActiveProject === "function") ? window.getActiveProject() : null;
      const c = proj && proj.heightanim && proj.heightanim.controls;
      if (!c || typeof c !== "object") return;
      Object.keys(c).forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if (el.type === "checkbox" || el.type === "radio") el.checked = !!c[id];
        else el.value = String(c[id]);
      });
      _refreshHeightSliderLabels();
    } catch (_) {}
  }
  // v0.9.401 — Kompletten Projekt-State (Trim + Info-Leiste + Wegpunkte + Control-
  // Farben) aus dem aktiven Projekt in die JS-Vars + DOM zurückspielen. Idempotent,
  // löst KEINE Persist-/Undo-Events aus. `refreshUi:true` rendert die abhängigen
  // UI-Teile neu (Info-Felder, Wegpunkt-Liste, Trim-Balken) — dafür beim erneuten
  // Aufruf NACH GPX-Load (Modul ist dann fertig gemountet).
  function reloadProjectStateFromActive(opts) {
    opts = opts || {};
    try {
      const proj = (typeof window.getActiveProject === "function") ? window.getActiveProject() : null;
      const ha = proj?.heightanim || {};
      // Trim
      if (typeof ha.trim_start === "number") _trimStart = Math.max(0, Math.min(1, ha.trim_start));
      if (typeof ha.trim_end === "number") _trimEnd = Math.max(0, Math.min(1, ha.trim_end));
      if (_trimEnd <= _trimStart) { _trimStart = 0; _trimEnd = 1; }
      // Info-Leiste + Wegpunkte
      if (typeof ha.show_header === "boolean") _showHeader = ha.show_header;
      if (typeof ha.show_gradient === "boolean") _showGradient = ha.show_gradient;
      if (Array.isArray(ha.stats_fields) && ha.stats_fields.length) _statsFields = ha.stats_fields.slice();
      if (ha.wp_sources && typeof ha.wp_sources === "object") _wpSources = Object.assign({ photos: true, gpx: true, auto: false }, ha.wp_sources);
      if (Array.isArray(ha.waypoints)) _manualWps = ha.waypoints.map(w => ({
        id: w.id || ("m" + (_wpSeq++)), dist_frac: +w.dist_frac || 0,
        label: w.label || "", color: w.color || "#ff6b35",
      }));
      if (ha.wp_hidden && typeof ha.wp_hidden === "object") _wpHidden = Object.assign({}, ha.wp_hidden);
      // v0.9.402/403 — Höhen-Farbzonen (Fläche / Hintergrund / Linie)
      const _mapZone = (a) => (Array.isArray(a) ? a.map(s => ({
        id: s.id || ("z" + (_zoneSeq++)), ele: +s.ele || 0, color: s.color || "#88cc66",
      })) : null);
      const _fs = _mapZone(ha.fill_stops); if (_fs) _fillStops = _fs;
      const _bs = _mapZone(ha.bg_stops);   if (_bs) _bgStops = _bs;
      const _ls = _mapZone(ha.line_stops); if (_ls) _lineStops = _ls;
      // v0.9.448 — Zweite Datenreihe. Bisher wurde sie NUR beim Modul-Mount aus
      // dem Projekt gelesen; da ist `_activeProject` beim Kaltstart aber noch
      // null. Der Selektor zeigte danach zwar „Tempo", die JS-Variable blieb
      // aber leer → weder zweite Kurve noch rechte Achse wurden gezeichnet.
      if (typeof ha.series_b === "string") _seriesB = ha.series_b;
      if (typeof ha.line_color_b === "string") _lineColorB = ha.line_color_b;
      if (ha.line_width_b != null) _lineWidthB = +ha.line_width_b || 3;
    } catch (_) {}
    // Control-Werte (Farben/Größen/Auflösung/Marker/Glättung) in die DOM-Inputs.
    try { restoreHeightControls(); } catch (_) {}
    if (opts.refreshUi) {
      try { renderHeaderFields(); } catch (_) {}
      try { renderWaypointList(); } catch (_) {}
      try { renderAllZones(); } catch (_) {}
      try { updateTrimVisual(); } catch (_) {}
      // v0.9.448 — Selektor + Farbe/Dicke der zweiten Reihe an den soeben
      // geladenen Projekt-Stand angleichen (siehe series_b oben).
      try { renderSeriesSelectB(); } catch (_) {}
    }
  }
  // Speichert IMMER das KOMPLETTE heightanim-Objekt (Root-Patch macht Shallow-
  // Replace von `heightanim` → Teil-Patches würden sich gegenseitig überschreiben).
  function persistHeightWaypoints() {
    try {
      if (typeof window.saveActiveProjectPatch === "function") {
        window.saveActiveProjectPatch({
          heightanim: {
            trim_start: _trimStart, trim_end: _trimEnd,
            show_header: _showHeader, show_gradient: _showGradient,
            stats_fields: _statsFields.slice(), wp_sources: Object.assign({}, _wpSources),
            wp_hidden: Object.assign({}, _wpHidden),
            waypoints: _manualWps.map(w => ({ id: w.id, dist_frac: w.dist_frac, label: w.label, color: w.color })),
            fill_stops: _fillStops.map(s => ({ id: s.id, ele: s.ele, color: s.color })),
            bg_stops: _bgStops.map(s => ({ id: s.id, ele: s.ele, color: s.color })),
            line_stops: _lineStops.map(s => ({ id: s.id, ele: s.ele, color: s.color })),
            // v0.9.448 — Serien-Auswahl MUSS hier mit rein: dieser Patch ersetzt
            // `heightanim` komplett, vorher fiel die zweite Reihe bei jeder
            // Trim-/Wegpunkt-/Zonen-Änderung wieder aus dem Projekt heraus.
            series_a: _seriesA, series_b: _seriesB,
            line_color_b: _lineColorB, line_width_b: _lineWidthB,
            controls: _readHeightControls(),
            // v0.9.443 — fertiger Stil-Snapshot, den der Animator als Diagramm-
            // Overlay „übernehmen" kann (WYSIWYG: gleiche collectHeightParams-
            // Quelle wie der Daten-Animator-Render). Projektweit lesbar, DOM-
            // unabhängig (der Animator hat kein height-*-DOM wenn er aktiv ist).
            chart_style: (function () { try { return collectHeightParams(); } catch (_) { return null; } })(),
          }
        }, { persistOnly: true });
      }
    } catch (_) {}
  }

  // ── Geteilte Stat-/Steigungs-Helfer — SYNCHRON zu core/heightanim.py ────────
  // v0.9.400 — Glättung: gleitender Mittelwert über die Höhen (Radius r je Seite).
  // SYNCHRON zu core/heightanim.py (_rzSmooth). Slider #height-smoothing (0 = aus).
  function _smoothingVal() {
    return parseInt(document.getElementById("height-smoothing")?.value || "0", 10) || 0;
  }
  function _rzSmooth(arr, r) {
    r = Math.round(r || 0);
    if (r <= 0 || !arr || arr.length < 3) return (arr || []).slice();
    const n = arr.length, out = new Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0, c = 0;
      const lo = Math.max(0, i - r), hi = Math.min(n - 1, i + r);
      for (let j = lo; j <= hi; j++) { const v = arr[j]; if (v != null) { s += v; c++; } }
      out[i] = c ? s / c : arr[i];
    }
    return out;
  }
  // v0.9.402 — Füll-Farbverlauf nach Höhe. Baut die <linearGradient>-Stops
  // (offset 0 = oben/eHi, offset 1 = unten/eLo). `baseColor` gilt unten (unter der
  // niedrigsten Zone); jede Zone {ele,color} färbt AB ihrer Höhe aufwärts. bands=true
  // → harte Kanten (doppelte Stops), sonst weicher Verlauf. SYNCHRON zu core/heightanim.py.
  function _rzFillStops(baseColor, stops, eHi, eSpan, bands) {
    const pts = [];
    (stops || []).forEach(s => {
      const e = +s.ele;
      if (!isFinite(e)) return;
      pts.push({ off: Math.max(0, Math.min(1, (eHi - e) / (eSpan || 1))), color: s.color || "#ffffff" });
    });
    pts.push({ off: 1, color: baseColor });          // Basis ganz unten
    pts.sort((a, b) => a.off - b.off);               // oben (klein) → unten (groß)
    if (!bands) return pts;
    const out = [];
    let prev = 0;
    for (let k = 0; k < pts.length; k++) {
      out.push({ off: prev, color: pts[k].color });
      out.push({ off: pts[k].off, color: pts[k].color });
      prev = pts[k].off;
    }
    return out;
  }
  // v0.9.403 — Zonen-Deskriptor: eine gemeinsame Logik für Fläche / Hintergrund / Linie.
  function _zoneCfg(key) {
    if (key === "bg") return {
      key: "bg", get: () => _bgStops, set: v => { _bgStops = v; },
      listId: "height-bg-stops", modeId: "height-bg-mode", stepsId: "height-bg-steps",
      gradId: "rzBgGrad", base: () => document.getElementById("height-bg")?.value || "#1a1a1a",
    };
    if (key === "line") return {
      key: "line", get: () => _lineStops, set: v => { _lineStops = v; },
      listId: "height-line-stops", modeId: "height-line-mode", stepsId: "height-line-steps",
      gradId: "rzLineGrad", base: () => document.getElementById("height-color")?.value || "#ff6b35",
    };
    return {
      key: "fill", get: () => _fillStops, set: v => { _fillStops = v; },
      listId: "height-fill-stops", modeId: "height-area-mode", stepsId: "height-area-steps",
      gradId: "rzFillGrad", base: () => document.getElementById("height-area-color")?.value || "#ff6b35",
    };
  }
  // Farb-Rampe (Terrain-Look) — Stützpunkte werden bei „Stufen anlegen" gesampelt.
  const _RZ_TERRAIN = ["#2e7d32", "#7cb342", "#c0ca33", "#c9a227", "#8d6e63", "#d7ccc8", "#ffffff"];
  function _rzLerpHex(a, b, f) {
    const pa = parseInt((a || "#000000").slice(1), 16), pb = parseInt((b || "#000000").slice(1), 16);
    const r = Math.round(((pa >> 16) & 255) + (((pb >> 16) & 255) - ((pa >> 16) & 255)) * f);
    const g = Math.round(((pa >> 8) & 255) + (((pb >> 8) & 255) - ((pa >> 8) & 255)) * f);
    const bl = Math.round((pa & 255) + ((pb & 255) - (pa & 255)) * f);
    return "#" + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
  }
  function _rzRampColor(tt) {
    tt = Math.max(0, Math.min(1, tt));
    const seg = tt * (_RZ_TERRAIN.length - 1);
    const i = Math.floor(seg), f = seg - i;
    if (i >= _RZ_TERRAIN.length - 1) return _RZ_TERRAIN[_RZ_TERRAIN.length - 1];
    return _rzLerpHex(_RZ_TERRAIN[i], _RZ_TERRAIN[i + 1], f);
  }
  function _rzWindowGrad(ds, es, idx, win, lo0, hi0) {
    const d0 = ds[idx];
    let lo = idx; while (lo > lo0 && d0 - ds[lo] < win) lo--;
    let hi = idx; while (hi < hi0 && ds[hi] - d0 < win) hi++;
    const dd = ds[hi] - ds[lo]; if (dd <= 0) return 0;
    const eLo = es[lo] == null ? 0 : es[lo], eHi = es[hi] == null ? 0 : es[hi];
    return (eHi - eLo) / dd * 100;
  }
  function _rzGradAtDist(ds, es, d, win) {
    const n = ds.length;
    let lo = 0; while (lo < n - 1 && d - ds[lo] > win) lo++;
    let hi = n - 1; while (hi > 0 && ds[hi] - d > win) hi--;
    if (hi <= lo) hi = Math.min(n - 1, lo + 1);
    const dd = ds[hi] - ds[lo]; if (dd <= 0) return 0;
    const eLo = es[lo] == null ? 0 : es[lo], eHi = es[hi] == null ? 0 : es[hi];
    return (eHi - eLo) / dd * 100;
  }
  function _rzHeaderStats(ds, es, i0, i1) {
    let eMin = Infinity, eMax = -Infinity, eSum = 0, eCnt = 0;
    for (let i = i0; i <= i1; i++) { const e = es[i]; if (e == null) continue; if (e < eMin) eMin = e; if (e > eMax) eMax = e; eSum += e; eCnt++; }
    const sm = [];
    for (let i = i0; i <= i1; i++) { let s = 0, c = 0; for (let j = Math.max(i0, i - 2); j <= Math.min(i1, i + 2); j++) { if (es[j] != null) { s += es[j]; c++; } } sm.push(c ? s / c : (es[i] || 0)); }
    let asc = 0, desc = 0, ref = sm[0] || 0;
    for (let k = 1; k < sm.length; k++) { const dz = sm[k] - ref; if (Math.abs(dz) >= 3) { if (dz > 0) asc += dz; else desc += -dz; ref = sm[k]; } }
    let gUpMax = 0, gDnMax = 0, gUpSum = 0, gUpW = 0, gDnSum = 0, gDnW = 0;
    for (let i = i0 + 1; i <= i1; i++) { const w = Math.max(0, ds[i] - ds[i - 1]); const g = _rzWindowGrad(ds, es, i, 60, i0, i1); if (g > 0.3) { if (g > gUpMax) gUpMax = g; gUpSum += g * w; gUpW += w; } else if (g < -0.3) { if (g < -gDnMax) gDnMax = -g; gDnSum += (-g) * w; gDnW += w; } }
    return { distM: Math.max(0, ds[i1] - ds[i0]), eleMin: eCnt ? eMin : 0, eleMax: eCnt ? eMax : 0, eleAvg: eCnt ? eSum / eCnt : 0, ascent: asc, descent: desc, gradAvgUp: gUpW ? gUpSum / gUpW : 0, gradAvgDown: gDnW ? gDnSum / gDnW : 0, gradMaxUp: gUpMax, gradMaxDown: gDnMax };
  }
  function _rzFieldLabel(id) {
    // Bei Nicht-Höhen-Serien tragen die Min/Max/Ø-Felder deren Namen
    // („Herzfrequenz max" statt „Höhe max") — SYNCHRON zu rzFieldLabel() in
    // core/heightanim.py.
    if (!_haIsEle()) {
      const L = _haLabel();
      if (id === "ele_max") return L + " max";
      if (id === "ele_min") return L + " min";
      if (id === "ele_minmax") return L + " min / max";
      if (id === "ele_avg") return "Ø " + L;
    }
    return t("heightanim.statfield." + id, {
      distance: "Distanz", updown: "Höhe ↑ / ↓", avg_grad: "Ø-Steigung",
      max_grad: "Max. Steigung", ele_max: "Höhe max", ele_min: "Höhe min",
      ele_minmax: "Höhe min / max", ele_avg: "Ø-Höhe",
    }[id] || id);
  }
  function _rzFieldValue(id, st) {
    const r = Math.round;
    switch (id) {
      case "distance":   return (st.distM / 1000).toFixed(2) + " km";
      // Auf/Ab + Steigung sind höhen-semantisch → bei Puls/Tempo/… leer, die
      // Anzeige filtert leere Werte raus (wie im Backend rzFieldValue).
      case "updown":     return _haIsEle() ? ("↑" + r(st.ascent) + " / ↓" + r(st.descent) + " m") : "";
      case "avg_grad":   return _haIsEle() ? ("+" + st.gradAvgUp.toFixed(1) + " / −" + st.gradAvgDown.toFixed(1) + " %") : "";
      case "max_grad":   return _haIsEle() ? ("+" + r(st.gradMaxUp) + " / −" + r(st.gradMaxDown) + " %") : "";
      case "ele_max":    return _haFmt(st.eleMax);
      case "ele_min":    return _haFmt(st.eleMin);
      // v0.9.441 — Einheit der Reihe (bpm/km/h/…), nicht mehr fix „m".
      case "ele_minmax": return _haFmt(st.eleMin) + " / " + _haFmt(st.eleMax);
      case "ele_avg":    return _haFmt(st.eleAvg);
      default:           return "";
    }
  }
  function _autoLabel(kind) {
    return t("heightanim.auto." + kind, {
      peak: "⛰ Gipfel", valley: "▼ Tiefpunkt",
      steep_up: "◤ Steilster Anstieg", steep_down: "◢ Steilster Abstieg",
    }[kind] || kind);
  }

  // Distanz→Höhe-Interpolation auf den aktuellen Daten
  function _eleAtDistArr(dists, elevs, d) {
    const n = dists.length;
    if (n === 0) return 0;
    if (d <= dists[0]) return elevs[0];
    if (d >= dists[n - 1]) return elevs[n - 1];
    for (let i = 1; i < n; i++) if (dists[i] >= d) {
      const d0 = dists[i - 1], d1 = dists[i];
      const seg = d1 > d0 ? (d - d0) / (d1 - d0) : 0;
      return elevs[i - 1] + (elevs[i] - elevs[i - 1]) * seg;
    }
    return elevs[n - 1];
  }

  // Foto-Anker (0..1) aus latlon nächstem Track-Punkt
  function _photoAnchorFrac(photo) {
    if (typeof photo.track_anchor === "number") return Math.max(0, Math.min(1, photo.track_anchor));
    const ll = _currentData && _currentData.latlon;
    if (!ll || !ll.length || photo.lat == null || photo.lon == null) return null;
    let best = 0, bestD = 1e18;
    const plat = +photo.lat, plon = +photo.lon;
    for (let i = 0; i < ll.length; i++) {
      const dlat = ll[i][0] - plat, dlon = (ll[i][1] - plon) * Math.cos(plat * Math.PI / 180);
      const d = dlat * dlat + dlon * dlon;
      if (d < bestD) { bestD = d; best = i; }
    }
    return ll.length > 1 ? best / (ll.length - 1) : 0;
  }

  // Baut die finale Wegpunkt-Liste aus allen 4 Quellen (für Preview + Render)
  function buildWaypoints() {
    if (!_currentData || !_currentData.distances_m) return [];
    const dists = _currentData.distances_m, elevs = _rzSmooth(_currentData.elevations, _smoothingVal());
    const maxDist = dists[dists.length - 1] || 1;
    const out = [];
    // Manuell
    for (const w of _manualWps) {
      const dm = Math.max(0, Math.min(1, w.dist_frac)) * maxDist;
      out.push({ dist_m: dm, ele: _eleAtDistArr(dists, elevs, dm), label: w.label || "", color: w.color || "#ff6b35" });
    }
    // Fotos
    if (_wpSources.photos) {
      try {
        const proj = (typeof window.getActiveProject === "function") ? window.getActiveProject() : null;
        const photos = (proj && proj.photos) || [];
        for (let i = 0; i < photos.length; i++) {
          const p = photos[i];
          if (p.visible === false) continue;
          if (_wpHidden["photo:" + i]) continue;
          const frac = _photoAnchorFrac(p);
          if (frac == null) continue;
          const dm = frac * maxDist;
          const nm = (p.name || p.filename || "").split("/").pop() || "📷";
          out.push({ dist_m: dm, ele: _eleAtDistArr(dists, elevs, dm), label: "📷 " + nm.replace(/\.[^.]+$/, ""), color: "#7ab8ff" });
        }
      } catch (_) {}
    }
    // GPX-Wegpunkte
    if (_wpSources.gpx) {
      for (let i = 0; i < _gpxWaypoints.length; i++) {
        if (_wpHidden["gpx:" + i]) continue;
        const g = _gpxWaypoints[i];
        out.push({ dist_m: +g.dist_m, ele: (g.ele != null ? +g.ele : _eleAtDistArr(dists, elevs, +g.dist_m)), label: g.name || "◆", color: "#7ae0a0" });
      }
    }
    // Auto-Marker
    if (_wpSources.auto) {
      for (let i = 0; i < _autoMarkers.length; i++) {
        if (_wpHidden["auto:" + _autoMarkers[i].kind]) continue;
        const a = _autoMarkers[i];
        out.push({ dist_m: +a.dist_m, ele: +a.ele, label: _autoLabel(a.kind), color: "#ffb37a" });
      }
    }
    return out;
  }

  // ── Draw ───────────────────────────────────────────────────────────────
  // Zeichnet das Höhenprofil. progress = 0..1 = wie viel der Linie sichtbar ist.
  function drawElevationSvg() {
    const svg = document.getElementById("height-svg");
    const host = document.getElementById("height-viewport");
    const animBar = document.getElementById("height-anim-bar");
    if (!svg || !host) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    if (!_currentData || !_currentData.elevations || _currentData.elevations.length < 2) {
      const hint = document.getElementById("height-empty-hint");
      if (hint) hint.style.display = "block";
      if (animBar) animBar.style.display = "none";
      return;
    }
    const hint = document.getElementById("height-empty-hint");
    if (hint) hint.style.display = "none";
    if (animBar) animBar.style.display = "flex";

    // SVG-eigene Dimensionen nehmen (nicht host) — die SVG ist via CSS
    // mit bottom:76px positioniert, also kleiner als der viewport.
    const w = svg.clientWidth  || host.clientWidth  || 800;
    const h = svg.clientHeight || (host.clientHeight - 76) || 400;
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.setAttribute("preserveAspectRatio", "none");

    const bg = document.getElementById("height-bg")?.value || "#1a1a1a";
    const lc = document.getElementById("height-color")?.value || "#ff6b35";
    const lw = parseFloat(document.getElementById("height-lw")?.value) || 4;
    const showGrid = document.getElementById("height-grid")?.checked !== false;
    const showAxes = document.getElementById("height-axes")?.checked !== false;
    // v0.9.447 — Achsen einzeln + Schriftgröße + Werte-Anzahl (Spiegelung zu
    // core/heightanim.py; Schrift skaliert relativ zur 1080-Referenz wie im Render)
    const axX  = showAxes && document.getElementById("height-axis-x")?.checked !== false;
    const axY  = showAxes && document.getElementById("height-axis-y")?.checked !== false;
    const axY2raw = document.getElementById("height-axis-y2")?.checked !== false;
    const axFontBase = parseFloat(document.getElementById("height-axis-font")?.value || "20");
    const axXT = Math.max(1, parseInt(document.getElementById("height-axis-xt")?.value || "6", 10));
    const axYT = Math.max(1, parseInt(document.getElementById("height-axis-yt")?.value || "5", 10));
    const showMarker = document.getElementById("height-marker")?.checked !== false;
    // v0.9.405 — laufender Punkt (zeichnet die Linie) unabhängig von der Info-Box schaltbar
    const showDot = document.getElementById("height-marker-dot")?.checked !== false;
    const gridColor = document.getElementById("height-grid-color")?.value || "#3a3a3a";
    const labelColor = document.getElementById("height-label-color")?.value || "#cccccc";
    // v0.9.402 — Fläche unter der Linie (füllen? Farbe? Deckkraft? Höhen-Farbzonen?)
    const areaFill  = document.getElementById("height-area-fill")?.checked !== false;
    const areaColor = document.getElementById("height-area-color")?.value || lc;
    const areaOp    = (parseFloat(document.getElementById("height-area-op")?.value) ?? 18) / 100;
    const areaBands = document.getElementById("height-area-mode")?.value === "bands";
    // v0.9.396 — Marker vollständig konfigurierbar
    const mkDotColor = document.getElementById("height-marker-dot-color")?.value || "#ffffff";
    const mkDotSize  = parseFloat(document.getElementById("height-marker-dot-size")?.value) || 6;
    const mkBg       = document.getElementById("height-marker-bg")?.value || "#000000";
    const mkBgOp     = (parseFloat(document.getElementById("height-marker-bg-op")?.value) ?? 60) / 100;
    const mkBorder   = document.getElementById("height-marker-border")?.value || "#ff6b35";
    const mkBw       = parseFloat(document.getElementById("height-marker-bw")?.value ?? "1.5");
    const mkFs       = parseFloat(document.getElementById("height-marker-fs")?.value) || 16;
    const mkShowIcon = document.getElementById("height-marker-icon")?.checked !== false;
    const mkShowEle  = document.getElementById("height-marker-ele")?.checked !== false;
    const mkShowDist = document.getElementById("height-marker-dist")?.checked !== false;

    // Background
    const bgRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bgRect.setAttribute("x", "0"); bgRect.setAttribute("y", "0");
    bgRect.setAttribute("width", w); bgRect.setAttribute("height", h);
    bgRect.setAttribute("fill", bg);
    svg.appendChild(bgRect);

    // Padding (etwas mehr Boden weil unter dem Plot die Anim-Bar liegt).
    // v0.9.394 — Header-Band oben + Platz für Wegpunkt-Labels.
    const headH = _showHeader ? 48 : 0;
    // v0.9.437 — linker Rand wächst mit der Einheit (synchron zu PAD_L in
    // core/heightanim.py): „139 bpm" / „24.5 km/h" brauchen mehr Platz als
    // „1234 m". Bei „m" bleibt es bei 60 → Höhen-Vorschau unverändert.
    // v0.9.438 — zweite Reihe: rechter Rand macht Platz für ihre Achse.
    const valsB = _haValuesB();
    const hasB = !!valsB;
    // v0.9.447 — Ränder richten sich nach der tatsächlichen Schriftgröße (nicht
    // mehr nach festen Pixeln) und fallen auf ein Minimum, wenn die jeweilige
    // Achse aus ist → die Kurve bekommt den Platz. Spiegelt core/heightanim.py.
    const axFont = Math.max(5, Math.round(axFontBase * (h / 1080)));
    const axGap = Math.round(axFont * 0.6);
    const _room = (unit) => Math.round((5 + Math.max(0, (unit || "").length)) * axFont * 0.58) + axGap;
    const axY2 = hasB && showAxes && axY2raw;
    const padL = axY ? _room(_haUnit()) : 12;
    const padR = axY2 ? _room(_haUnitB()) : 30;
    const padT = headH + 34, padB = axX ? Math.round(axFont * 1.6) + axGap : 20;
    const plotW = Math.max(20, w - padL - padR);
    const plotH = Math.max(20, h - padT - padB);

    const elevs = _rzSmooth(_currentData.elevations, _smoothingVal());
    const dists = _currentData.distances_m;
    const nPoints = elevs.length;
    const maxDist = dists[dists.length - 1] || 1;

    // Trim: Distanz-Fenster — bestimmt was sichtbar ist (Marc-Spec:
    // Preview = echtes Resultat, links/rechts verschwindet beim Ziehen).
    const dTrimStart = _trimStart * maxDist;
    const dTrimEnd   = _trimEnd   * maxDist;
    const dTrimSpan  = Math.max(1, dTrimEnd - dTrimStart);
    function _idxAt(d) {
      if (d <= dists[0]) return 0;
      if (d >= dists[nPoints - 1]) return nPoints - 1;
      for (let i = 1; i < nPoints; i++) if (dists[i] >= d) return i;
      return nPoints - 1;
    }
    const _i0 = _idxAt(dTrimStart);
    const _i1 = _idxAt(dTrimEnd);

    // Höhen-Min/Max IM TRIM-BEREICH (mit Berücksichtigung der
    // interpolierten Endpunkte an dTrimStart/dTrimEnd damit nichts unter
    // den Plot dippt).
    function _eleAtDist(d) {
      const idx = _idxAt(d);
      if (idx <= 0) return elevs[0];
      const d0 = dists[idx - 1], d1 = dists[idx];
      const seg = d1 > d0 ? (d - d0) / (d1 - d0) : 0;
      return elevs[idx - 1] + (elevs[idx] - elevs[idx - 1]) * seg;
    }
    let _eMin = Math.min(_eleAtDist(dTrimStart), _eleAtDist(dTrimEnd));
    let _eMax = Math.max(_eleAtDist(dTrimStart), _eleAtDist(dTrimEnd));
    for (let i = _i0; i <= _i1; i++) {
      if (elevs[i] < _eMin) _eMin = elevs[i];
      if (elevs[i] > _eMax) _eMax = elevs[i];
    }
    const eleRange = Math.max(1, _eMax - _eMin);

    // v0.9.97 — Y-Achse mit Pixel-genauem Bottom-Margin damit Marker +
    // Stroke nicht unter den Plot-Boden überstehen ("unterirdisch").
    // _eMin landet so, dass auch ein Marker-Kreis vollständig im Plot
    // bleibt. Untere Achs-Labels werden bei _eMin gezeichnet (Marc-
    // freundlich: niedrigster Punkt = unteres Achs-Label).
    const markerR = Math.max(8, lw * 2.5);   // Marker-Glow-Radius in px
    const bottomReservePx = Math.max(markerR + 2, lw * 0.7 + 8);
    const bottomPadFrac = Math.min(0.15, bottomReservePx / Math.max(60, plotH));
    const topPadFrac = 0.12;
    const eleSpan = (1 + topPadFrac) * eleRange / Math.max(0.001, 1 - bottomPadFrac);
    const eleLo = _eMin - bottomPadFrac * eleSpan;
    const eleHi = eleLo + eleSpan;

    // X-Achse: Trim-relativ — links/rechts verschwindet beim Trim-Ziehen.
    function px(distM) { return padL + ((distM - dTrimStart) / dTrimSpan) * plotW; }
    function py(ele)   { return padT + (1 - (ele - eleLo) / eleSpan) * plotH; }

    // ── Zweite Reihe (v0.9.438) — synchron zu core/heightanim.py ─────────────
    // Eigene Skala, weil Puls (bpm) und Höhe (m) keinen gemeinsamen Bereich
    // haben. Bei Änderung BEIDE Seiten pflegen (Render + Vorschau).
    let bLo = 0, bSpan = 1;
    if (hasB) {
      const _bAt = (d) => _eleAtDistArr(dists, valsB, d);
      let bMin = Math.min(_bAt(dTrimStart), _bAt(dTrimEnd));
      let bMax = Math.max(_bAt(dTrimStart), _bAt(dTrimEnd));
      for (let i = _i0; i <= _i1; i++) {
        if (valsB[i] < bMin) bMin = valsB[i];
        if (valsB[i] > bMax) bMax = valsB[i];
      }
      const bRange = Math.max(1e-6, bMax - bMin);
      bSpan = (1 + topPadFrac) * bRange / Math.max(0.001, 1 - bottomPadFrac);
      bLo = bMin - bottomPadFrac * bSpan;
    }
    function pyB(v) { return padT + (1 - (v - bLo) / bSpan) * plotH; }

    // v0.9.403 — Zonen-Gradient (Fläche/Hintergrund/Linie): baut eine vertikale
    // <linearGradient> nach Höhe und gibt die url zurück (oder null bei keinen Zonen).
    function _zoneGradUrl(gradId, stops, baseColor, bands) {
      const valid = (stops || []).filter(s => isFinite(+s.ele));
      if (!valid.length) return null;
      const NS = "http://www.w3.org/2000/svg";
      const grad = document.createElementNS(NS, "linearGradient");
      grad.setAttribute("id", gradId);
      grad.setAttribute("gradientUnits", "userSpaceOnUse");
      grad.setAttribute("x1", padL); grad.setAttribute("x2", padL);
      grad.setAttribute("y1", py(eleHi).toFixed(1)); grad.setAttribute("y2", py(eleLo).toFixed(1));
      _rzFillStops(baseColor, valid, eleHi, eleSpan, bands).forEach(st => {
        const s = document.createElementNS(NS, "stop");
        s.setAttribute("offset", (st.off * 100).toFixed(2) + "%");
        s.setAttribute("stop-color", st.color);
        grad.appendChild(s);
      });
      let defs = svg.querySelector("defs.rz-zone-defs");
      if (!defs) { defs = document.createElementNS(NS, "defs"); defs.setAttribute("class", "rz-zone-defs"); svg.insertBefore(defs, svg.firstChild); }
      defs.appendChild(grad);
      return "url(#" + gradId + ")";
    }

    // v0.9.403 — Hintergrund-Höhenstufen: färbt den Hintergrund nach Höhe (liegt
    // über dem flachen bg-Rect, unter Gitter/Linie/Fläche).
    if (_bgStops.length) {
      const bgUrl = _zoneGradUrl("rzBgGrad", _bgStops, bg, document.getElementById("height-bg-mode")?.value === "bands");
      if (bgUrl) {
        // v0.9.404 — optional nur im Diagramm-Bereich (innerhalb der Achsen) statt Vollbild
        const clip = document.getElementById("height-bg-clip")?.checked === true;
        const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        r.setAttribute("x", clip ? String(padL) : "0");
        r.setAttribute("y", clip ? String(padT) : "0");
        r.setAttribute("width", clip ? String(plotW) : w);
        r.setAttribute("height", clip ? String(plotH) : h);
        r.setAttribute("fill", bgUrl);
        svg.appendChild(r);
      }
    }

    // Hilfsgitter
    if (showGrid) {
      for (let i = 0; i <= axYT; i++) {
        const y = padT + (i / axYT) * plotH;
        const ln = document.createElementNS("http://www.w3.org/2000/svg", "line");
        ln.setAttribute("x1", padL); ln.setAttribute("x2", padL + plotW);
        ln.setAttribute("y1", y); ln.setAttribute("y2", y);
        ln.setAttribute("stroke", gridColor); ln.setAttribute("stroke-width", "1");
        ln.setAttribute("opacity", "0.4");
        svg.appendChild(ln);
      }
      for (let i = 0; i <= axXT; i++) {
        const x = padL + (i / axXT) * plotW;
        const ln = document.createElementNS("http://www.w3.org/2000/svg", "line");
        ln.setAttribute("x1", x); ln.setAttribute("x2", x);
        ln.setAttribute("y1", padT); ln.setAttribute("y2", padT + plotH);
        ln.setAttribute("stroke", gridColor); ln.setAttribute("stroke-width", "1");
        ln.setAttribute("opacity", "0.4");
        svg.appendChild(ln);
      }
    }

    // Achsen-Beschriftungen
    {
      const lblColor = labelColor;
      if (axX) for (let i = 0; i <= axXT; i++) {
        const x = padL + (i / axXT) * plotW;
        const distKm = (i / axXT) * (dTrimSpan / 1000);
        const txt = document.createElementNS("http://www.w3.org/2000/svg", "text");
        txt.setAttribute("x", x); txt.setAttribute("y", h - padB + Math.round(axFont * 1.35));
        txt.setAttribute("fill", lblColor);
        txt.setAttribute("font-size", axFont); txt.setAttribute("text-anchor", "middle");
        txt.setAttribute("font-family", "-apple-system, sans-serif");
        txt.textContent = `${distKm.toFixed(1)} km`;
        svg.appendChild(txt);
      }
      if (axY) for (let i = 0; i <= axYT; i++) {
        const y = padT + (i / axYT) * plotH;
        const ele = eleHi - (i / axYT) * eleSpan;
        const txt = document.createElementNS("http://www.w3.org/2000/svg", "text");
        txt.setAttribute("x", padL - axGap); txt.setAttribute("y", y + Math.round(axFont * 0.34));
        txt.setAttribute("fill", lblColor);
        txt.setAttribute("font-size", axFont); txt.setAttribute("text-anchor", "end");
        txt.setAttribute("font-family", "-apple-system, sans-serif");
        txt.textContent = _haFmt(ele);
        svg.appendChild(txt);
      }
      // v0.9.438 — rechte Achse für Reihe B, in ihrer Linienfarbe (synchron zu
      // core/heightanim.py).
      if (axY2) {
        for (let i = 0; i <= axYT; i++) {
          const y = padT + (i / axYT) * plotH;
          const v = (bLo + bSpan) - (i / axYT) * bSpan;
          const txt = document.createElementNS("http://www.w3.org/2000/svg", "text");
          txt.setAttribute("x", padL + plotW + axGap);
          txt.setAttribute("y", y + Math.round(axFont * 0.34));
          txt.setAttribute("fill", _lineColorB);
          txt.setAttribute("font-size", axFont); txt.setAttribute("text-anchor", "start");
          txt.setAttribute("font-family", "-apple-system, sans-serif");
          txt.textContent = _haFmtB(v);
          svg.appendChild(txt);
        }
      }
    }

    // ── Animations-Linie: zeichnet den Trim-Bereich bis _progress ──────
    const baseline = padT + plotH;
    const dCurrent = dTrimStart + Math.max(0, Math.min(1, _progress)) * dTrimSpan;
    let endIdx = _i1;
    for (let i = _i0; i <= _i1; i++) {
      if (dists[i] >= dCurrent) { endIdx = i; break; }
    }
    let endX, endY;
    if (endIdx <= _i0 || _progress <= 0) {
      endX = px(dists[_i0]); endY = py(elevs[_i0]);
      endIdx = _i0;
    } else {
      const d0 = dists[endIdx - 1];
      const d1 = dists[endIdx];
      const seg = d1 > d0 ? (dCurrent - d0) / (d1 - d0) : 0;
      const eInterp = elevs[endIdx - 1] + (elevs[endIdx] - elevs[endIdx - 1]) * seg;
      endX = px(dCurrent);
      endY = py(eInterp);
    }

    let partialD = "";
    for (let i = _i0; i <= Math.max(_i0, endIdx - 1); i++) {
      partialD += (i === _i0 ? "M" : " L") + px(dists[i]).toFixed(1) + " " + py(elevs[i]).toFixed(1);
    }
    if (_progress > 0) {
      if (!partialD) partialD = `M${px(dists[_i0]).toFixed(1)} ${py(elevs[_i0]).toFixed(1)}`;
      partialD += ` L${endX.toFixed(1)} ${endY.toFixed(1)}`;
    }

    if (_progress > 0 && areaFill && areaOp > 0) {
      const fillD = partialD + ` L${endX.toFixed(1)} ${baseline} L${px(dists[_i0]).toFixed(1)} ${baseline} Z`;
      const fillPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      fillPath.setAttribute("d", fillD);
      fillPath.setAttribute("fill", _zoneGradUrl("rzFillGrad", _fillStops, areaColor, areaBands) || areaColor);
      fillPath.setAttribute("opacity", String(areaOp));
      svg.appendChild(fillPath);
    }
    if (_progress > 0) {
      const lineStroke = _zoneGradUrl("rzLineGrad", _lineStops, lc, document.getElementById("height-line-mode")?.value === "bands") || lc;
      const linePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      linePath.setAttribute("d", partialD);
      linePath.setAttribute("fill", "none");
      linePath.setAttribute("stroke", lineStroke);
      linePath.setAttribute("stroke-width", String(lw));
      linePath.setAttribute("stroke-linejoin", "round");
      linePath.setAttribute("stroke-linecap", "round");
      svg.appendChild(linePath);
    }

    // v0.9.438 — zweite Kurve auf der rechten Skala. Wie im Render bewusst nur
    // Linie (keine Fläche, keine Farbzonen) — synchron zu core/heightanim.py.
    let curB = null;
    if (hasB && _progress > 0) {
      let bD = "";
      for (let i = _i0; i <= Math.max(_i0, endIdx - 1); i++) {
        bD += (i === _i0 ? "M" : " L") + px(dists[i]).toFixed(1) + " " + pyB(valsB[i]).toFixed(1);
      }
      if (endIdx <= _i0) {
        curB = valsB[_i0];
      } else {
        const d0 = dists[endIdx - 1], d1 = dists[endIdx];
        const seg = d1 > d0 ? (dCurrent - d0) / (d1 - d0) : 0;
        curB = valsB[endIdx - 1] + (valsB[endIdx] - valsB[endIdx - 1]) * seg;
      }
      if (!bD) bD = `M${px(dists[_i0]).toFixed(1)} ${pyB(valsB[_i0]).toFixed(1)}`;
      bD += ` L${endX.toFixed(1)} ${pyB(curB).toFixed(1)}`;
      const bPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      bPath.setAttribute("d", bD);
      bPath.setAttribute("fill", "none");
      bPath.setAttribute("stroke", _lineColorB);
      bPath.setAttribute("stroke-width", String(_lineWidthB));
      bPath.setAttribute("stroke-linejoin", "round");
      bPath.setAttribute("stroke-linecap", "round");
      svg.appendChild(bPath);
    }

    // Hex→rgba mit Deckkraft (für die Marker-Box)
    const _rgba = (hex, a) => {
      const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
      if (!m) return `rgba(0,0,0,${a})`;
      const n = parseInt(m[1], 16);
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    };

    // ── Marker (Punkt am Ende der gezeichneten Linie) ──────────────────
    if (showDot && _progress > 0) {
      // Glow
      const glow = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      glow.setAttribute("cx", endX.toFixed(1));
      glow.setAttribute("cy", endY.toFixed(1));
      glow.setAttribute("r", String(mkDotSize * 1.8));
      glow.setAttribute("fill", mkBorder);
      glow.setAttribute("opacity", "0.35");
      svg.appendChild(glow);
      // Punkt
      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("cx", endX.toFixed(1));
      dot.setAttribute("cy", endY.toFixed(1));
      dot.setAttribute("r", String(mkDotSize));
      dot.setAttribute("fill", mkDotColor);
      if (mkBw > 0) { dot.setAttribute("stroke", mkBorder); dot.setAttribute("stroke-width", String(Math.max(1, mkBw))); }
      svg.appendChild(dot);
    }

    // aktuelle Höhe am Marker (interpoliert)
    let curEle2;
    if (endIdx <= _i0) curEle2 = elevs[_i0];
    else {
      const d0 = dists[endIdx - 1], d1 = dists[endIdx];
      const seg = d1 > d0 ? (dCurrent - d0) / (d1 - d0) : 0;
      curEle2 = elevs[endIdx - 1] + (elevs[endIdx] - elevs[endIdx - 1]) * seg;
    }

    const _mk = (tag, attrs, txt) => {
      const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
      for (const k in attrs) el.setAttribute(k, attrs[k]);
      if (txt != null) el.textContent = txt;
      svg.appendChild(el); return el;
    };

    // ── Wegpunkte (erscheinen sobald die Linie sie passiert) ────────────────
    const _wps = buildWaypoints();
    if (_wps.length && _progress > 0) {
      for (const wp of _wps) {
        const wd = +wp.dist_m;
        if (!isFinite(wd) || wd < dTrimStart - 1 || wd > dTrimEnd + 1) continue;
        if (_progress < 1 && dCurrent < wd) continue;
        const wx = px(wd), wy = py(wp.ele != null ? +wp.ele : _eleAtDist(wd));
        const col = wp.color || "#ffb37a";
        const stemTop = wy - 18;
        _mk("line", { x1: wx, x2: wx, y1: wy, y2: stemTop, stroke: col, "stroke-width": "1.5" });
        _mk("circle", { cx: wx, cy: wy, r: String(Math.max(3, lw * 1.1)), fill: col, stroke: bg, "stroke-width": "1.5" });
        const label = (wp.label || "").toString();
        if (label) {
          const fs = 12, tw = Math.round(label.length * fs * 0.62 + 14);
          let bx = Math.max(padL, Math.min(w - padR - tw, wx - tw / 2));
          let by = Math.max(headH + 6, stemTop - 17);
          _mk("rect", { x: bx, y: by, width: tw, height: 17, rx: 4, fill: "#2a2a2a", stroke: col, "stroke-width": "1" });
          _mk("text", { x: bx + tw / 2, y: by + 12, fill: "#fff", "font-size": fs, "text-anchor": "middle", "font-family": "-apple-system, sans-serif" }, label);
        }
      }
    }

    // ── Sachliche Info-Leiste oben ──────────────────────────────────────────
    if (_showHeader && nPoints >= 2) {
      const st = _rzHeaderStats(dists, elevs, _i0, _i1);
      const fields = (_statsFields || []).filter(f => _rzFieldValue(f, st) !== "");
      const n = Math.max(1, fields.length), step = plotW / n, bandTop = 8;
      for (let k = 0; k < fields.length; k++) {
        const fx = padL + k * step;
        if (k > 0) _mk("line", { x1: fx - 10, x2: fx - 10, y1: bandTop, y2: bandTop + 40, stroke: gridColor, "stroke-width": "1" });
        _mk("text", { x: fx, y: bandTop + 14, fill: labelColor, opacity: "0.6", "font-size": 12, "font-family": "-apple-system, sans-serif" }, _rzFieldLabel(fields[k]));
        _mk("text", { x: fx, y: bandTop + 35, fill: labelColor, "font-size": 17, "font-weight": "500", "font-family": "-apple-system, sans-serif" }, _rzFieldValue(fields[k], st));
      }
    }

    // ── Marker-Callout: konfigurierbar (Felder + Farben + Schriftgröße) ──────
    if (showMarker && _progress > 0) {
      // synchron zu core/heightanim.py — Steigung ist höhen-semantisch und
      // fliegt bei Puls/Tempo/… aus der Marker-Box.
      const grad = (_showGradient && _haIsEle()) ? _rzGradAtDist(dists, elevs, dCurrent, 60) : null;
      const curDistKm = (dCurrent - dTrimStart) / 1000;
      const lines = [];
      // Zeile 1: ⛰-Symbol (nur bei Höhe) + Wert der Serie
      const _ic = (mkShowIcon && _haIsEle()) ? "⛰" : "";
      const l1 = _ic + (mkShowEle ? (_ic ? " " : "") + _haFmt(curEle2) : "");
      if (l1) lines.push({ text: l1, size: mkFs, fill: labelColor, weight: "500" });
      // v0.9.438 — zweite Reihe darunter, in ihrer Linienfarbe (synchron zu
      // core/heightanim.py).
      if (hasB && curB != null && mkShowEle) {
        lines.push({ text: _haFmtB(curB), size: mkFs * 0.82, fill: _lineColorB, weight: "500" });
      }
      // Zeile 2: Steigung + Distanz
      const p2 = [];
      if (grad != null) p2.push(`${grad >= 0 ? "↗ +" : "↘ −"}${Math.abs(grad).toFixed(1)} %`);
      if (mkShowDist) p2.push(`${curDistKm.toFixed(2)} km`);
      if (p2.length) lines.push({ text: p2.join("  ·  "), size: mkFs * 0.72,
        fill: (grad != null && grad < 0) ? "#ff9e6b" : (grad != null ? "#ffcbb0" : labelColor), weight: "400" });

      if (lines.length) {
        const padX = Math.round(mkFs * 0.7), padTop = Math.round(mkFs * 0.9);
        const lineGap = Math.round(mkFs * 1.15);
        const boxH = padTop + (lines.length - 1) * lineGap + Math.round(mkFs * 0.5);
        const boxW = Math.round(Math.max(...lines.map(l => l.text.length * l.size * 0.6)) + padX * 2);
        let boxX = endX + 12;
        if (boxX + boxW > w - padR) boxX = endX - 12 - boxW;
        boxX = Math.max(padL, boxX);
        let boxY = endY - boxH - 8;
        if (boxY < headH + 6) boxY = endY + 12;
        _mk("rect", { x: boxX, y: boxY, width: boxW, height: boxH, rx: 8,
          fill: _rgba(mkBg, mkBgOp),
          ...(mkBw > 0 ? { stroke: mkBorder, "stroke-width": String(mkBw) } : {}) });
        lines.forEach((l, i) => {
          _mk("text", { x: boxX + padX, y: boxY + padTop + i * lineGap,
            fill: l.fill, "font-size": l.size, "font-weight": l.weight,
            "font-family": "-apple-system, sans-serif" }, l.text);
        });
      }
    }
  }

  // ── Animation-Loop ─────────────────────────────────────────────────────
  function getDurations() {
    const dur = parseFloat(document.getElementById("height-dur")?.value) || 12;
    const hold = parseFloat(document.getElementById("height-hold")?.value) || 2;
    return { dur, hold };
  }

  function rafTick(ts) {
    if (!_playing) return;
    if (!_lastFrameTime) _lastFrameTime = ts;
    const dt = (ts - _lastFrameTime) / 1000;  // Sekunden
    _lastFrameTime = ts;

    const { dur, hold } = getDurations();

    if (_holdingUntil > 0) {
      // Hold-Phase: progress bleibt bei 1, nur warten
      if (ts >= _holdingUntil) {
        // Hold vorbei → wieder von 0 starten
        _holdingUntil = 0;
        _progress = 0;
        setProgressUi(0);
        drawElevationSvg();
      }
      _rafId = requestAnimationFrame(rafTick);
      return;
    }

    // Normale Animation
    _progress += dt / Math.max(0.1, dur);
    if (_progress >= 1) {
      _progress = 1;
      setProgressUi(1);
      drawElevationSvg();
      if (hold > 0) {
        _holdingUntil = ts + hold * 1000;
      } else {
        // Sofort wieder loslaufen
        _progress = 0;
      }
    } else {
      setProgressUi(_progress);
      drawElevationSvg();
    }
    _rafId = requestAnimationFrame(rafTick);
  }

  function setProgressUi(p) {
    const slider = document.getElementById("height-scrub");
    if (slider) slider.value = String(Math.round(p * 1000));
    const time = document.getElementById("height-time");
    if (time) {
      const { dur } = getDurations();
      time.textContent = `${(p * dur).toFixed(1)} / ${dur.toFixed(1)} s`;
    }
  }

  function startPlay() {
    if (_playing) return;
    _playing = true;
    _lastFrameTime = 0;
    _holdingUntil = 0;
    // Wenn am Ende: von vorn
    if (_progress >= 1) _progress = 0;
    const btn = document.getElementById("height-play");
    if (btn) btn.textContent = "⏸";
    _rafId = requestAnimationFrame(rafTick);
  }

  function pausePlay() {
    _playing = false;
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
    const btn = document.getElementById("height-play");
    if (btn) btn.textContent = "▶";
  }

  function togglePlay() {
    if (_playing) pausePlay();
    else startPlay();
  }

  // ── GPX-Load ───────────────────────────────────────────────────────────
  async function applyGlobalGpxToHeightModule(arg) {
    const path = (typeof arg === "string") ? arg : (arg && arg.path) || "";
    if (window.applog) window.applog("info", `[heightanim] applyGpx path=${path || "(leer)"}`);
    if (!path) {
      _currentData = null;
      pausePlay();
      _progress = 0;
      setProgressUi(0);
      drawElevationSvg();
      return;
    }
    if (!window.pywebview?.api?.heightanim_load_gpx) {
      if (window.applog) window.applog("warn", "[heightanim] Bridge heightanim_load_gpx fehlt");
      return;
    }
    try {
      const res = await window.pywebview.api.heightanim_load_gpx(path);
      if (window.applog) {
        window.applog("info", `[heightanim] load result ok=${res?.ok} n_elev=${res?.elevations?.length || 0}`);
      }
      if (res && res.ok) {
        if (window.hideSourceMissingBanner) window.hideSourceMissingBanner();
        _currentData = res;
        _autoMarkers = Array.isArray(res.auto_markers) ? res.auto_markers : [];
        _gpxWaypoints = Array.isArray(res.gpx_waypoints) ? res.gpx_waypoints : [];
        // v0.9.437 — Serien-Auswahl aus dem neuen Track bauen und die zuletzt
        // gewählte Reihe wieder anwenden (fällt zurück, wenn dieser Track sie
        // nicht hat — z.B. GPX ohne Puls nach einem FIT mit Puls).
        renderSeriesSelect();
        applySeries(_seriesA, { redraw: false, persist: false });
        renderSeriesSelect();
        _progress = 0;
        setProgressUi(0);
        // v0.9.401 — Projekt-State JETZT (erneut) anwenden: beim Kaltstart war
        // `_activeProject` beim Modul-Mount noch null (Session lädt async), daher
        // griffen gespeicherte Farben/Trim/Wegpunkte nicht. Jetzt — nach dem GPX-Load
        // — ist das Projekt da → Farben + Einstellungen werden gesetzt. (Marc-Bug
        // „merkt sich die Farben nicht".)
        try { reloadProjectStateFromActive({ refreshUi: true }); } catch (_) {}
        drawElevationSvg();
        // Auto-Play: direkt loslegen sobald ein neuer Track geladen ist
        startPlay();
      } else if (res && res.error) {
        if (window.applog) window.applog("error", `[heightanim] load error: ${res.error}`);
        if (window.isMissingFileError && window.isMissingFileError(res.error)) window.showSourceMissingBanner(path);
      }
    } catch (e) {
      console.warn("[heightanim] load failed", e);
      if (window.applog) window.applog("error", `[heightanim] load exception: ${e}`);
      if (window.isMissingFileError && window.isMissingFileError(e)) window.showSourceMissingBanner(path);
    }
  }

  // Initial laden wenn schon GPX da ist
  if (typeof getGlobalGpxPath === "function") {
    const p = getGlobalGpxPath();
    if (window.applog) window.applog("info", `[heightanim] initial gpx path=${p || "(leer)"}`);
    if (p) applyGlobalGpxToHeightModule(p);
  }
  // Auf globalen GPX-Wechsel reagieren — Callback bekommt `{path, data}`
  if (typeof onGpxLoaded === "function") {
    window.__rzGpxUnsub_height = onGpxLoaded(applyGlobalGpxToHeightModule);
  }

  // ── v0.9.322 — Undo/Redo (⌘Z) für alle Höhen-Animator-Einstellungen ────────
  // Höhen-Animator hält Optik/Auflösung in DOM-Controls (Snapshot-Controller) UND
  // — seit v0.9.394 — Info-Leiste/Wegpunkte in JS-State. Letzterer wird über
  // extraSnapshot/extraApply mitgesichert (wie im Geotagger). DOM-Änderungen pushen
  // automatisch (rzMakePanelUndoController); reine JS-Aktionen (Punkt setzen/löschen/
  // umbenennen/ausblenden) pushen manuell VOR der Mutation via _haPushUndo.
  function _haUndoCaptureState() {
    return {
      showHeader: _showHeader, showGradient: _showGradient,
      statsFields: _statsFields.slice(),
      wpSources: Object.assign({}, _wpSources),
      wpHidden: Object.assign({}, _wpHidden),
      manualWps: _manualWps.map(w => ({ id: w.id, dist_frac: w.dist_frac, label: w.label, color: w.color })),
      fillStops: _fillStops.map(s => ({ id: s.id, ele: s.ele, color: s.color })),
      bgStops: _bgStops.map(s => ({ id: s.id, ele: s.ele, color: s.color })),
      lineStops: _lineStops.map(s => ({ id: s.id, ele: s.ele, color: s.color })),
    };
  }
  function _haUndoRestoreState(x) {
    if (!x) return;
    _showHeader = !!x.showHeader;
    _showGradient = !!x.showGradient;
    _statsFields = Array.isArray(x.statsFields) ? x.statsFields.slice() : _statsFields;
    _wpSources = Object.assign({ photos: true, gpx: true, auto: false }, x.wpSources || {});
    _wpHidden = Object.assign({}, x.wpHidden || {});
    _manualWps = Array.isArray(x.manualWps)
      ? x.manualWps.map(w => ({ id: w.id || ("m" + (_wpSeq++)), dist_frac: +w.dist_frac || 0, label: w.label || "", color: w.color || "#ff6b35" }))
      : _manualWps;
    const _mapZoneU = (a, cur) => (Array.isArray(a)
      ? a.map(s => ({ id: s.id || ("z" + (_zoneSeq++)), ele: +s.ele || 0, color: s.color || "#88cc66" }))
      : cur);
    _fillStops = _mapZoneU(x.fillStops, _fillStops);
    _bgStops = _mapZoneU(x.bgStops, _bgStops);
    _lineStops = _mapZoneU(x.lineStops, _lineStops);
    try { renderAllZones(); } catch (_) {}
    // Fixe Checkboxen an den JS-State angleichen (ohne erneutes Push zu triggern —
    // wir setzen .checked direkt, kein dispatch).
    const _sync = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
    _sync("height-header", _showHeader);
    _sync("height-gradient", _showGradient);
    _sync("height-src-photos", _wpSources.photos);
    _sync("height-src-gpx", _wpSources.gpx);
    _sync("height-src-auto", _wpSources.auto);
    try { renderHeaderFields(); } catch (_) {}
    try { renderWaypointList(); } catch (_) {}
    try { persistHeightWaypoints(); } catch (_) {}
  }
  const _haUndoCtrl = (typeof window.rzMakePanelUndoController === "function")
    ? window.rzMakePanelUndoController("height-panel", {
        section: "heightanim",
        extraSnapshot: () => _haUndoCaptureState(),
        extraApply: (x) => _haUndoRestoreState(x),
        after: () => { try { drawElevationSvg(); } catch (_) {} },
        toast: (m) => { try { if (typeof toast === "function") toast(m, "info", 1000); } catch (_) {} },
      })
    : null;
  const _haPushUndo = (label) => { try { if (_haUndoCtrl) _haUndoCtrl.push(label, { force: true }); } catch (_) {} };
  if (_haUndoCtrl) {
    window.__rzUndoControllers = window.__rzUndoControllers || {};
    window.__rzUndoControllers.heightanim = _haUndoCtrl;
    // DOM-Push-Listener verdrahtet rzMakePanelUndoController selbst (Pre-Change-Erfassung).
  }

  // ── Event-Bindings ─────────────────────────────────────────────────────
  // Optik-Inputs re-drawen den aktuellen Frame
  ["height-bg", "height-color", "height-lw", "height-smoothing", "height-grid", "height-axes", "height-marker",
   "height-grid-color", "height-label-color",
   // v0.9.447 — Achsen-Detailsteuerung
   "height-axis-x", "height-axis-y", "height-axis-y2",
   "height-axis-font", "height-axis-xt", "height-axis-yt",
   "height-area-fill", "height-area-color", "height-area-op", "height-area-mode",
   "height-bg-mode", "height-bg-clip", "height-line-mode",
   "height-marker-dot", "height-marker-dot-color", "height-marker-dot-size", "height-marker-bg", "height-marker-bg-op",
   "height-marker-border", "height-marker-bw", "height-marker-fs",
   "height-marker-icon", "height-marker-ele", "height-marker-dist", "height-gradient"]
    .forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("input", drawElevationSvg);
      el.addEventListener("change", drawElevationSvg);
    });
  // Detail-Block folgt dem Haupt-Schalter.
  document.getElementById("height-axes")?.addEventListener("change", syncAxisDetail);
  try { syncAxisDetail(); } catch (_) {}

  // ── v0.9.394 — Info-Leiste + Wegpunkt-Editor ──────────────────────────────
  const ALL_STAT_FIELDS = ["distance", "updown", "avg_grad", "max_grad", "ele_max", "ele_min", "ele_minmax", "ele_avg"];
  // v0.9.441 — höhen-semantische Felder (Auf/Ab, Ø-/Max-Steigung) ergeben nur
  // bei der Reihe „Höhe" Sinn. Bei Puls/Tempo/… gar nicht erst zur Auswahl
  // anbieten — „nur zeigen, was wir haben".
  const ELE_ONLY_FIELDS = ["updown", "avg_grad", "max_grad"];
  function renderHeaderFields() {
    const host = document.getElementById("height-header-fields");
    if (!host) return;
    host.innerHTML = "";
    const fields = _haIsEle() ? ALL_STAT_FIELDS : ALL_STAT_FIELDS.filter(id => !ELE_ONLY_FIELDS.includes(id));
    for (const id of fields) {
      const row = document.createElement("label");
      row.className = "checkbox-row";
      row.style.cssText = "font-size:12px; padding:2px 0;";
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.checked = _statsFields.includes(id);
      cb.addEventListener("change", () => {
        _haPushUndo("Info-Feld geändert");   // dynamisch (keine id) → manueller Push
        if (cb.checked) { if (!_statsFields.includes(id)) _statsFields.push(id); }
        else _statsFields = _statsFields.filter(f => f !== id);
        persistHeightWaypoints(); drawElevationSvg();
      });
      const sp = document.createElement("span");
      sp.textContent = _rzFieldLabel(id);
      row.appendChild(cb); row.appendChild(sp); host.appendChild(row);
    }
  }
  // v0.9.402 — Füll-Farbzonen-Editor (ab Höhe X wechselt die Füllfarbe)
  // v0.9.403 — generischer Farbzonen-Editor für ein Ziel (fill/bg/line)
  function renderZoneStops(key) {
    const cfg = _zoneCfg(key);
    const arr = cfg.get();
    const host = document.getElementById(cfg.listId);
    if (!host) return;
    host.innerHTML = "";
    if (!arr.length) {
      host.innerHTML = `<p class="muted" style="font-size:11px; margin:4px 0;">${t("heightanim.fill.empty", "Keine Farbzonen — die Basisfarbe gilt überall.")}</p>`;
      return;
    }
    // Anzeige nach Höhe absteigend (oben = hohe Lagen)
    const order = arr.map((s, i) => ({ s, i })).sort((a, b) => (+b.s.ele) - (+a.s.ele));
    for (const { s, i } of order) {
      const row = document.createElement("div");
      row.className = "height-wp-row";
      const num = document.createElement("input");
      // v0.9.442 — Schrittweite passend zur Reihe: 50 ist auf Höhenmeter
      // geeicht; bei Puls/Tempo/… würde der Spinner absurd springen (120→170).
      num.type = "number"; num.step = _haIsEle() ? "50" : "1";
      num.value = (s.ele != null ? s.ele : 0);
      num.className = "height-fill-ele";
      num.style.cssText = "width:74px; margin-right:4px;";
      // v0.9.439 — generisch: Schwelle in der Einheit der linken Reihe (m / bpm /
      // km/h …), nicht mehr fix „(m)".
      const _thU = _haUnit();
      num.title = t("heightanim.fill.threshold_tip", "Ab diesem Wert gilt die neue Farbe") + (_thU ? " (" + _thU + ")" : "");
      let _numPushed = false;
      num.addEventListener("pointerdown", () => { _numPushed = false; });
      num.addEventListener("input", () => {
        if (!_numPushed) { _haPushUndo("Farbschwelle geändert"); _numPushed = true; }
        s.ele = parseFloat(num.value) || 0;
        persistHeightWaypoints(); drawElevationSvg();
      });
      num.addEventListener("change", () => { _numPushed = false; renderZoneStops(key); });
      const unit = document.createElement("span");
      // v0.9.442 — Einheit der geplotteten Reihe (m/bpm/km/h), nicht fix „m".
      unit.textContent = _haUnit(); unit.style.cssText = "opacity:0.6; margin-right:8px; font-size:12px;";
      const cpick = document.createElement("input");
      cpick.type = "color"; cpick.value = s.color || "#88cc66"; cpick.className = "height-wp-color";
      let _colPushed = false;
      cpick.addEventListener("pointerdown", () => { _colPushed = false; });
      cpick.addEventListener("input", () => {
        if (!_colPushed) { _haPushUndo("Farbzone-Farbe geändert"); _colPushed = true; }
        s.color = cpick.value; persistHeightWaypoints(); drawElevationSvg();
      });
      cpick.addEventListener("change", () => { _colPushed = false; });
      const del = document.createElement("button");
      del.type = "button"; del.className = "height-wp-del"; del.textContent = "✕";
      del.title = t("heightanim.fill.delete", "Farbzone löschen");
      del.addEventListener("click", () => {
        _haPushUndo("Farbzone gelöscht");
        cfg.get().splice(i, 1);
        persistHeightWaypoints(); renderZoneStops(key); drawElevationSvg();
      });
      row.appendChild(num); row.appendChild(unit); row.appendChild(cpick); row.appendChild(del);
      host.appendChild(row);
    }
  }
  function renderAllZones() {
    renderZoneStops("fill"); renderZoneStops("bg"); renderZoneStops("line");
  }
  // Eine neue Zone von Hand hinzufügen (Default-Höhe = Mitte des Höhenbereichs)
  function addZoneStop(key) {
    const cfg = _zoneCfg(key);
    _haPushUndo("Farbzone hinzugefügt");
    let defEle = 1000;
    try {
      const es = _currentData && _currentData.elevations;
      if (es && es.length) {
        let mn = Infinity, mx = -Infinity;
        for (const e of es) { if (e == null) continue; if (e < mn) mn = e; if (e > mx) mx = e; }
        if (isFinite(mn) && isFinite(mx)) defEle = Math.round((mn + mx) / 2);
      }
    } catch (_) {}
    cfg.get().push({ id: "z" + (_zoneSeq++), ele: defEle, color: cfg.base() });
    persistHeightWaypoints(); renderZoneStops(key); drawElevationSvg();
  }
  // v0.9.403 — „N Stufen anlegen": Höhenbereich des Tracks in N gleiche Bänder teilen
  // und automatisch Zonen mit Terrain-Farbrampe erzeugen (danach frei editierbar).
  function genZoneStops(key) {
    const cfg = _zoneCfg(key);
    const n = Math.max(2, Math.min(12, parseInt(document.getElementById(cfg.stepsId)?.value || "4", 10) || 4));
    const es = _currentData && _currentData.elevations;
    if (!es || !es.length) {
      try { if (typeof toast === "function") toast(t("heightanim.fill.no_track", "Erst einen Track (GPX) laden."), "info", 1600); } catch (_) {}
      return;
    }
    let mn = Infinity, mx = -Infinity;
    for (const e of es) { if (e == null) continue; if (e < mn) mn = e; if (e > mx) mx = e; }
    if (!isFinite(mn) || !isFinite(mx) || mx <= mn) return;
    _haPushUndo("Farbzonen erzeugt");
    const range = mx - mn;
    const stops = [];
    for (let k = 0; k < n; k++) {
      const ele = Math.round((mn + range * k / n) / 10) * 10;   // untere Grenze jedes Bandes
      stops.push({ id: "z" + (_zoneSeq++), ele, color: _rzRampColor(n > 1 ? k / (n - 1) : 0) });
    }
    cfg.set(stops);
    persistHeightWaypoints(); renderZoneStops(key); drawElevationSvg();
  }
  // Liste aller Wegpunkte (manuell editierbar; Quellen ausblendbar)
  function renderWaypointList() {
    const host = document.getElementById("height-wp-list");
    if (!host) return;
    host.innerHTML = "";
    const rows = [];
    _manualWps.forEach((w, i) => rows.push({ kind: "manual", i, label: w.label || t("heightanim.points.unnamed", "Punkt"), color: w.color, hidden: false }));
    if (_wpSources.photos) {
      try {
        const proj = (typeof window.getActiveProject === "function") ? window.getActiveProject() : null;
        ((proj && proj.photos) || []).forEach((p, i) => {
          if (p.visible === false) return;
          const nm = (p.name || p.filename || "Foto").split("/").pop().replace(/\.[^.]+$/, "");
          rows.push({ kind: "photo", key: "photo:" + i, label: "📷 " + nm, color: "#7ab8ff", hidden: !!_wpHidden["photo:" + i] });
        });
      } catch (_) {}
    }
    if (_wpSources.gpx) _gpxWaypoints.forEach((g, i) => rows.push({ kind: "gpx", key: "gpx:" + i, label: "◆ " + (g.name || "Wegpunkt"), color: "#7ae0a0", hidden: !!_wpHidden["gpx:" + i] }));
    if (_wpSources.auto) _autoMarkers.forEach((a) => rows.push({ kind: "auto", key: "auto:" + a.kind, label: _autoLabel(a.kind), color: "#ffb37a", hidden: !!_wpHidden["auto:" + a.kind] }));
    if (!rows.length) {
      host.innerHTML = `<p class="muted" style="font-size:11px; margin:4px 0;">${t("heightanim.points.empty", "Noch keine Punkte. Quellen oben aktivieren oder unten einen Punkt setzen.")}</p>`;
      return;
    }
    for (const r of rows) {
      const row = document.createElement("div");
      row.className = "height-wp-row";
      const dot = document.createElement("span");
      dot.className = "height-wp-dot"; dot.style.background = r.color;
      const lbl = document.createElement("span");
      lbl.className = "height-wp-label"; lbl.textContent = r.label;
      if (r.hidden) lbl.style.opacity = "0.4";
      row.appendChild(dot); row.appendChild(lbl);
      if (r.kind === "manual") {
        const w = _manualWps[r.i];
        lbl.title = t("heightanim.points.rename_tip", "Klicken zum Umbenennen");
        lbl.style.cursor = "pointer";
        lbl.addEventListener("click", () => {
          const nv = window.prompt(t("heightanim.points.rename", "Name des Punkts:"), w.label || "");
          if (nv != null) { _haPushUndo("Punkt umbenannt"); w.label = nv; persistHeightWaypoints(); renderWaypointList(); drawElevationSvg(); }
        });
        const cpick = document.createElement("input");
        cpick.type = "color"; cpick.value = w.color || "#ff6b35"; cpick.className = "height-wp-color";
        // Dynamisch (keine id) → manueller Push. Nur EINMAL pro Farb-Edit (erster
        // input erfasst den Vorher-Zustand, bevor w.color überschrieben wird).
        let _colPushed = false;
        cpick.addEventListener("pointerdown", () => { _colPushed = false; });
        cpick.addEventListener("input", () => {
          if (!_colPushed) { _haPushUndo("Punkt-Farbe geändert"); _colPushed = true; }
          w.color = cpick.value; persistHeightWaypoints(); drawElevationSvg();
        });
        cpick.addEventListener("change", () => { _colPushed = false; });
        const del = document.createElement("button");
        del.type = "button"; del.className = "height-wp-del"; del.textContent = "✕";
        del.title = t("heightanim.points.delete", "Punkt löschen");
        del.addEventListener("click", () => { _haPushUndo("Punkt gelöscht"); _manualWps.splice(r.i, 1); persistHeightWaypoints(); renderWaypointList(); drawElevationSvg(); });
        row.appendChild(cpick); row.appendChild(del);
      } else {
        // Quellen-Punkt: nur ein-/ausblenden
        const eye = document.createElement("button");
        eye.type = "button"; eye.className = "height-wp-del";
        eye.textContent = r.hidden ? "🚫" : "👁";
        eye.title = t("heightanim.points.toggle", "Ein-/Ausblenden");
        eye.addEventListener("click", () => {
          _haPushUndo("Punkt ein-/ausgeblendet");
          if (_wpHidden[r.key]) delete _wpHidden[r.key]; else _wpHidden[r.key] = true;
          persistHeightWaypoints(); renderWaypointList(); drawElevationSvg();
        });
        row.appendChild(eye);
      }
      host.appendChild(row);
    }
  }
  renderHeaderFields();
  renderWaypointList();
  renderAllZones();

  // Header/Steigung-Toggles
  const _hdrCb = document.getElementById("height-header");
  if (_hdrCb) { _hdrCb.checked = _showHeader; _hdrCb.addEventListener("change", () => { _showHeader = _hdrCb.checked; persistHeightWaypoints(); drawElevationSvg(); }); }
  const _gradCb = document.getElementById("height-gradient");
  if (_gradCb) { _gradCb.checked = _showGradient; _gradCb.addEventListener("change", () => { _showGradient = _gradCb.checked; persistHeightWaypoints(); drawElevationSvg(); }); }
  // Quellen-Toggles
  [["height-src-photos", "photos"], ["height-src-gpx", "gpx"], ["height-src-auto", "auto"]].forEach(([id, key]) => {
    const cb = document.getElementById(id);
    if (!cb) return;
    cb.checked = !!_wpSources[key];
    cb.addEventListener("change", () => { _wpSources[key] = cb.checked; persistHeightWaypoints(); renderWaypointList(); drawElevationSvg(); });
  });
  // „Punkt setzen" → nächster Klick aufs Profil legt einen manuellen Punkt an
  const _addBtn = document.getElementById("height-add-point");
  const _addHint = document.getElementById("height-add-hint");
  _addBtn?.addEventListener("click", () => {
    _armAddPoint = !_armAddPoint;
    if (_addHint) _addHint.style.display = _armAddPoint ? "block" : "none";
    _addBtn.classList.toggle("btn-primary", _armAddPoint);
    const svg = document.getElementById("height-svg");
    if (svg) svg.style.cursor = _armAddPoint ? "crosshair" : "";
  });
  document.getElementById("height-svg")?.addEventListener("click", (ev) => {
    if (!_armAddPoint || !_currentData || !_currentData.distances_m) return;
    const svg = document.getElementById("height-svg");
    const rect = svg.getBoundingClientRect();
    const w = rect.width, padL = 60, padR = 30;
    const plotW = Math.max(1, w - padL - padR);
    const dists = _currentData.distances_m;
    const maxDist = dists[dists.length - 1] || 1;
    const dTrimStart = _trimStart * maxDist, dTrimSpan = Math.max(1, (_trimEnd - _trimStart) * maxDist);
    const xr = (ev.clientX - rect.left - padL) / plotW;   // 0..1 im Plot
    const distM = dTrimStart + Math.max(0, Math.min(1, xr)) * dTrimSpan;
    const frac = Math.max(0, Math.min(1, distM / maxDist));
    const name = window.prompt(t("heightanim.points.name_new", "Name des Punkts:"), t("heightanim.points.default_name", "Punkt"));
    if (name == null) return;
    _haPushUndo("Punkt gesetzt");
    _manualWps.push({ id: "m" + (_wpSeq++), dist_frac: frac, label: name, color: "#ff6b35" });
    _armAddPoint = false;
    if (_addHint) _addHint.style.display = "none";
    _addBtn?.classList.remove("btn-primary");
    if (svg) svg.style.cursor = "";
    persistHeightWaypoints(); renderWaypointList(); drawElevationSvg();
  });

  // Slider-Labels live updaten
  function updateLabel(id, val, suffix) {
    const el = document.getElementById(id);
    if (el) el.textContent = val + (suffix || "");
  }
  document.getElementById("height-dur")?.addEventListener("input", e => {
    updateLabel("height-dur-v", e.target.value, " s");
    setProgressUi(_progress);  // Zeit-Anzeige re-rechnen
  });
  document.getElementById("height-hold")?.addEventListener("input", e =>
    updateLabel("height-hold-v", e.target.value, " s"));
  document.getElementById("height-fps")?.addEventListener("input", e =>
    updateLabel("height-fps-v", e.target.value, ""));
  document.getElementById("height-lw")?.addEventListener("input", e =>
    updateLabel("height-lw-v", parseFloat(e.target.value).toFixed(1), " px"));
  document.getElementById("height-smoothing")?.addEventListener("input", e =>
    updateLabel("height-smoothing-v", e.target.value, ""));
  document.getElementById("height-area-op")?.addEventListener("input", e =>
    updateLabel("height-area-op-v", e.target.value, " %"));
  // v0.9.402/403 — Farbzonen-Buttons für Fläche / Hintergrund / Linie
  document.getElementById("height-area-add-stop")?.addEventListener("click", () => addZoneStop("fill"));
  document.getElementById("height-area-gen")?.addEventListener("click", () => genZoneStops("fill"));
  document.getElementById("height-bg-add-stop")?.addEventListener("click", () => addZoneStop("bg"));
  document.getElementById("height-bg-gen")?.addEventListener("click", () => genZoneStops("bg"));
  document.getElementById("height-line-add-stop")?.addEventListener("click", () => addZoneStop("line"));
  document.getElementById("height-line-gen")?.addEventListener("click", () => genZoneStops("line"));
  // Achsen-Slider-Labels (v0.9.448) — `_refreshHeightSliderLabels()` läuft nur
  // nach dem Restore; ohne diese Listener bleibt die Wertanzeige beim Ziehen auf
  // dem alten Stand stehen (im Live-Test aufgefallen).
  document.getElementById("height-axis-font")?.addEventListener("input", e =>
    updateLabel("height-axis-font-v", e.target.value, " px"));
  document.getElementById("height-axis-xt")?.addEventListener("input", e =>
    updateLabel("height-axis-xt-v", e.target.value, ""));
  document.getElementById("height-axis-yt")?.addEventListener("input", e =>
    updateLabel("height-axis-yt-v", e.target.value, ""));
  // Marker-Slider-Labels (v0.9.396)
  document.getElementById("height-marker-dot-size")?.addEventListener("input", e =>
    updateLabel("height-marker-dot-size-v", e.target.value, " px"));
  document.getElementById("height-marker-bg-op")?.addEventListener("input", e =>
    updateLabel("height-marker-bg-op-v", e.target.value, " %"));
  document.getElementById("height-marker-bw")?.addEventListener("input", e =>
    updateLabel("height-marker-bw-v", parseFloat(e.target.value).toFixed(1), " px"));
  document.getElementById("height-marker-fs")?.addEventListener("input", e =>
    updateLabel("height-marker-fs-v", e.target.value, " px"));

  // Resolution-Picker (analog Animator) — Quick-Buttons setzen W/H,
  // aktiver Button wird highlighted wenn W/H exakt matched.
  function updateHeightResButtons() {
    const w = parseInt(document.getElementById("height-w")?.value) || 0;
    const h = parseInt(document.getElementById("height-h")?.value) || 0;
    document.querySelectorAll("#height-panel .res-btn[data-w]").forEach(b => {
      const match = parseInt(b.dataset.w) === w && parseInt(b.dataset.h) === h;
      b.classList.toggle("active", match);
    });
  }
  document.querySelectorAll("#height-panel .res-btn[data-w]").forEach(btn => {
    btn.addEventListener("click", () => {
      const w = parseInt(btn.dataset.w);
      const h = parseInt(btn.dataset.h);
      const wEl = document.getElementById("height-w");
      const hEl = document.getElementById("height-h");
      if (wEl) wEl.value = String(w);
      if (hEl) hEl.value = String(h);
      wEl?.dispatchEvent(new Event("input"));
      hEl?.dispatchEvent(new Event("input"));
      updateHeightResButtons();
    });
  });
  document.getElementById("height-w")?.addEventListener("input", updateHeightResButtons);
  document.getElementById("height-h")?.addEventListener("input", updateHeightResButtons);
  updateHeightResButtons();

  // Play/Pause-Button
  document.getElementById("height-play")?.addEventListener("click", togglePlay);

  // Progress-Slider — scrub
  const progressSlider = document.getElementById("height-scrub");
  if (progressSlider) {
    progressSlider.addEventListener("input", () => {
      pausePlay();  // beim Scrubben pausieren
      _progress = parseInt(progressSlider.value, 10) / 1000;
      _holdingUntil = 0;
      setProgressUi(_progress);
      drawElevationSvg();
    });
  }

  // v0.9.399 — jede Control-Änderung im Panel persistieren (Farben, Größen,
  // Auflösung, Dauer, Checkboxen …). saveActiveProjectPatch debounct selbst (200 ms).
  document.getElementById("height-panel")?.addEventListener("change", () => {
    try { persistHeightWaypoints(); } catch (_) {}
  });

  // Section-Akkordeon-Logik
  if (window.setupSectionAccordions) {
    window.setupSectionAccordions("heightanim", document.getElementById("height-panel"));
  }

  // v0.9.128 — Letterbox-Viewport mit Aspect-Ratio der Render-Auflösung
  // (analog updateAnimatorViewport im Animator-Modul). Wird gerufen:
  //   - beim Mount,
  //   - bei Resize des Canvas-Host (ResizeObserver),
  //   - bei Änderung des Auflösungs-Inputs (#height-w / #height-h).
  function updateHeightViewport() {
    const wrap = document.getElementById("height-viewport");
    const section = document.getElementById("height-canvas-host");
    if (!wrap || !section) return;
    const rwEl = document.getElementById("height-w");
    const rhEl = document.getElementById("height-h");
    const rw = parseInt(rwEl?.value) || 1920;
    const rh = parseInt(rhEl?.value) || 1080;
    const targetAR = rw / rh;
    const margin = 20;
    const cs = window.getComputedStyle(section);
    const padBot = parseFloat(cs.paddingBottom) || 0;
    const padTop = parseFloat(cs.paddingTop)    || 0;
    const avW = section.clientWidth - margin * 2;
    const avH = section.clientHeight - margin * 2 - padBot - padTop;
    if (avW <= 0 || avH <= 0) {
      // Layout noch nicht fertig — kurz warten und nochmal versuchen.
      setTimeout(updateHeightViewport, 100);
      return;
    }
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
    drawElevationSvg();
  }

  // ResizeObserver: Container-Größe ändert sich (Modul-Wechsel,
  // Window-Resize, Sidebar-Akkordeon) → Viewport neu berechnen.
  const ro = new ResizeObserver(() => updateHeightViewport());
  const sectionEl = document.getElementById("height-canvas-host");
  if (sectionEl) ro.observe(sectionEl);

  // Auflösungs-Inputs → Viewport neu berechnen
  const _onResChange = () => updateHeightViewport();
  document.getElementById("height-w")?.addEventListener("input", _onResChange);
  document.getElementById("height-h")?.addEventListener("input", _onResChange);
  document.getElementById("height-w")?.addEventListener("change", _onResChange);
  document.getElementById("height-h")?.addEventListener("change", _onResChange);

  // Initial-Trigger (DOM ist da, Layout pending — setTimeout-Retry im Helper)
  setTimeout(updateHeightViewport, 0);

  // ── Trim-Handles (Drag, analog Animator) ───────────────────────────────
  const trimHandleStartEl = document.getElementById("height-trim-handle-start");
  const trimHandleEndEl   = document.getElementById("height-trim-handle-end");
  const trimShadeLeftEl   = document.getElementById("height-trim-shade-left");
  const trimShadeRightEl  = document.getElementById("height-trim-shade-right");
  const trackWrapEl       = document.getElementById("height-track-wrap");
  const TRIM_MIN_SPAN = 0.02;  // mindestens 2% zwischen Start/End

  function updateTrimVisual() {
    const sPct = _trimStart * 100;
    const ePct = _trimEnd * 100;
    if (trimHandleStartEl) trimHandleStartEl.style.left = sPct + "%";
    if (trimHandleEndEl)   trimHandleEndEl.style.left   = ePct + "%";
    if (trimShadeLeftEl)  { trimShadeLeftEl.style.width = sPct + "%"; }
    if (trimShadeRightEl) { trimShadeRightEl.style.left = ePct + "%"; }
  }

  function persistTrim() {
    // v0.9.399 — schreibt das komplette heightanim-Objekt (Root-Patch = Shallow-
    // Replace), sonst würde ein Trim-Save Wegpunkte/Controls überschreiben.
    persistHeightWaypoints();
  }

  // Initial-Position
  updateTrimVisual();

  // Drag-Logik: Mousedown auf Handle → mousemove auf document, mouseup beendet.
  // Während Drag: progress=1 (volle Linie = Render-Endbild) damit Marc live
  // das Endergebnis sieht. Beim mouseup: zurück auf 0 + Auto-Play.
  function startTrimDrag(which, ev) {
    ev.preventDefault();
    ev.stopPropagation();
    pausePlay();
    _progress = 1;             // volle Linie während Drag
    setProgressUi(1);
    const rect = trackWrapEl.getBoundingClientRect();
    const onMove = (e) => {
      const x = (e.clientX != null ? e.clientX : e.touches?.[0]?.clientX) - rect.left;
      let p = Math.max(0, Math.min(1, x / rect.width));
      if (which === "start") {
        if (p > _trimEnd - TRIM_MIN_SPAN) p = _trimEnd - TRIM_MIN_SPAN;
        _trimStart = Math.max(0, p);
      } else {
        if (p < _trimStart + TRIM_MIN_SPAN) p = _trimStart + TRIM_MIN_SPAN;
        _trimEnd = Math.min(1, p);
      }
      updateTrimVisual();
      drawElevationSvg();      // re-render mit progress=1 + neuer Trim-Skala
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onUp);
      persistTrim();
      // Nach Trim: Endbild stehen lassen (progress=1 = Render-Endbild).
      // KEIN Autoplay — Marc startet die Animation manuell mit Play.
      // setProgressUi(1) damit Slider+Zeit-Anzeige zum Bild passen.
      setProgressUi(1);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onUp);
  }
  trimHandleStartEl?.addEventListener("mousedown", (e) => startTrimDrag("start", e));
  trimHandleEndEl?.addEventListener("mousedown",   (e) => startTrimDrag("end", e));
  trimHandleStartEl?.addEventListener("touchstart",(e) => startTrimDrag("start", e), { passive: false });
  trimHandleEndEl?.addEventListener("touchstart",  (e) => startTrimDrag("end", e), { passive: false });
  // Doppelklick = Reset auf 0–100%
  trimHandleStartEl?.addEventListener("dblclick", () => {
    _trimStart = 0; updateTrimVisual(); _progress = 0; setProgressUi(0); drawElevationSvg(); persistTrim();
  });
  trimHandleEndEl?.addEventListener("dblclick", () => {
    _trimEnd = 1; updateTrimVisual(); _progress = 0; setProgressUi(0); drawElevationSvg(); persistTrim();
  });

  // ── Render-Sektion ─────────────────────────────────────────────────────
  const codecHints = {
    h264:   t("heightanim.codec.hint.h264",   "Standard für YouTube, Web, NLE-Schnitt."),
    h265:   t("heightanim.codec.hint.h265",   "Bis 40% kleinere Datei bei gleicher Qualität. Mac/iOS perfekt; auf Windows mit aktuellem Player."),
    prores: t("heightanim.codec.hint.prores", "Master-Qualität für YouTube + Color-Grading. Sehr große Datei (~5–10× MP4)."),
    alpha:  t("heightanim.codec.hint.alpha",  "Transparenter Hintergrund — für Overlay über Video-Material in der Schnitt-Software."),
  };
  const codecEl = document.getElementById("height-codec");
  const codecHintEl = document.getElementById("height-codec-hint");
  codecEl?.addEventListener("change", () => {
    if (codecHintEl) codecHintEl.textContent = codecHints[codecEl.value] || "";
  });

  function setRenderingState(running) {
    document.getElementById("height-progress").style.display = running ? "block" : "none";
    document.getElementById("height-render").disabled = running;
    document.getElementById("height-render").style.opacity = running ? "0.5" : "1";
    if (running) document.getElementById("height-done").style.display = "none";
  }

  async function pollHeightRender() {
    if (window.__rzgpsShuttingDown) { clearTimeout(_renderPollTimer); return; }
    let s;
    try { s = await window.pywebview.api.heightanim_status(); }
    catch (e) { clearTimeout(_renderPollTimer); return; }
    const pct = Math.round((s.progress || 0) * 100);
    const pctEl = document.getElementById("height-pct");
    const fillEl = document.getElementById("height-fill");
    const statusEl = document.getElementById("height-status");
    if (pctEl) pctEl.textContent = pct + "%";
    if (fillEl) fillEl.style.width = pct + "%";
    if (statusEl) statusEl.textContent = s.status || "";

    if (s.cancelled) {
      setRenderingState(false);
      clearTimeout(_renderPollTimer);
      if (typeof toast === "function") toast(t("heightanim.toast.cancelled", "Render abgebrochen."), "info", 3500);
      return;
    }
    if (s.error) {
      setRenderingState(false);
      clearTimeout(_renderPollTimer);
      if (typeof toast === "function") {
        toast(t("heightanim.toast.failed", "Render fehlgeschlagen") + ": " + String(s.error).split("\n")[0], "error", 8000);
      }
      console.error("[heightanim] render error", s.error);
      return;
    }
    if (!s.running && s.progress >= 1.0) {
      setRenderingState(false);
      const done = document.getElementById("height-done");
      if (done) done.style.display = "block";
      const openBtn = document.getElementById("height-open-folder");
      if (openBtn) openBtn.onclick = () => window.pywebview.api.reveal_in_finder(s.output);
      if (typeof toast === "function") {
        toast(t("heightanim.toast.done", "Video fertig") + ": " + (s.output || "").split("/").pop(), "success", 6000);
      }
      return;
    }
    _renderPollTimer = setTimeout(pollHeightRender, 350);
  }

  // v0.9.397 — Params-Sammler: von Video-Render UND HTML-Export genutzt.
  function collectHeightParams() {
    const gpxPath = (typeof getGlobalGpxPath === "function") ? getGlobalGpxPath() : "";
    const codec = codecEl?.value || "h264";
    const alpha = (codec === "alpha");
    return {
      gpx_path: gpxPath,
      duration_s: parseInt(document.getElementById("height-dur")?.value || "12", 10),
      hold_s: parseInt(document.getElementById("height-hold")?.value || "2", 10),
      fps: parseInt(document.getElementById("height-fps")?.value || "30", 10),
      width: parseInt(document.getElementById("height-w")?.value || "1920", 10),
      height: parseInt(document.getElementById("height-h")?.value || "1080", 10),
      codec: alpha ? "prores" : codec,
      transparent_background: alpha,
      background_color: document.getElementById("height-bg")?.value || "#1a1a1a",
      // v0.9.437 (Daten-Animator) — welche Reihe gerendert wird + ihre
      // lokalisierten Label/Einheit (damit die Achse im Video zur App-Sprache
      // passt; das Backend hat nur DE-Defaults).
      series_a: _seriesA,
      // v0.9.438 — zweite Reihe (leer = einreihig wie bisher)
      series_b: _seriesB,
      line_color_b: _lineColorB,
      line_width_b: _lineWidthB,
      series_labels: (() => { const o = {}; _haSeriesList().forEach(s => { o[s.id] = s.label; }); return o; })(),
      series_units: (() => { const o = {}; _haSeriesList().forEach(s => { o[s.id] = s.unit || ""; }); return o; })(),
      line_color: document.getElementById("height-color")?.value || "#ff6b35",
      line_width: parseFloat(document.getElementById("height-lw")?.value || "4"),
      grid_enabled: document.getElementById("height-grid")?.checked !== false,
      show_axes: document.getElementById("height-axes")?.checked !== false,
      // v0.9.447 — Achsen einzeln + Schriftgröße + Werte-Anzahl
      axis_x_labels: document.getElementById("height-axis-x")?.checked !== false,
      axis_y_labels: document.getElementById("height-axis-y")?.checked !== false,
      axis_y2_labels: document.getElementById("height-axis-y2")?.checked !== false,
      axis_font_size: parseFloat(document.getElementById("height-axis-font")?.value || "20"),
      axis_x_ticks: parseInt(document.getElementById("height-axis-xt")?.value || "6", 10),
      axis_y_ticks: parseInt(document.getElementById("height-axis-yt")?.value || "5", 10),
      show_marker: document.getElementById("height-marker")?.checked !== false,
      marker_show_dot: document.getElementById("height-marker-dot")?.checked !== false,
      grid_color: document.getElementById("height-grid-color")?.value || "#3a3a3a",
      label_color: document.getElementById("height-label-color")?.value || "#cccccc",
      smoothing: parseInt(document.getElementById("height-smoothing")?.value || "0", 10),
      // v0.9.402 — Fläche unter der Linie + Höhen-Farbzonen
      area_fill: document.getElementById("height-area-fill")?.checked !== false,
      area_color: document.getElementById("height-area-color")?.value || "#ff6b35",
      area_opacity: parseInt(document.getElementById("height-area-op")?.value || "18", 10),
      area_mode: document.getElementById("height-area-mode")?.value || "smooth",
      fill_stops: _fillStops.map(s => ({ ele: +s.ele || 0, color: s.color || "#88cc66" })),
      // v0.9.403 — Höhen-Farbzonen für Hintergrund + Linie
      bg_mode: document.getElementById("height-bg-mode")?.value || "smooth",
      bg_clip: document.getElementById("height-bg-clip")?.checked === true,
      bg_stops: _bgStops.map(s => ({ ele: +s.ele || 0, color: s.color || "#1a1a1a" })),
      line_mode: document.getElementById("height-line-mode")?.value || "smooth",
      line_stops: _lineStops.map(s => ({ ele: +s.ele || 0, color: s.color || "#ff6b35" })),
      marker_dot_color: document.getElementById("height-marker-dot-color")?.value || "#ffffff",
      marker_dot_size: parseFloat(document.getElementById("height-marker-dot-size")?.value || "6"),
      marker_bg: document.getElementById("height-marker-bg")?.value || "#000000",
      marker_bg_opacity: (parseFloat(document.getElementById("height-marker-bg-op")?.value || "60")) / 100,
      marker_border_color: document.getElementById("height-marker-border")?.value || "#ff6b35",
      marker_border_width: parseFloat(document.getElementById("height-marker-bw")?.value || "1.5"),
      marker_font_size: parseFloat(document.getElementById("height-marker-fs")?.value || "16"),
      marker_show_icon: document.getElementById("height-marker-icon")?.checked !== false,
      marker_show_ele: document.getElementById("height-marker-ele")?.checked !== false,
      marker_show_dist: document.getElementById("height-marker-dist")?.checked !== false,
      show_stats_header: _showHeader,
      show_gradient: _showGradient,
      stats_fields: _statsFields.slice(),
      stats_labels: ["distance","updown","avg_grad","max_grad","ele_max","ele_min","ele_minmax","ele_avg"]
        .reduce((m, id) => { m[id] = _rzFieldLabel(id); return m; }, {}),
      waypoints: buildWaypoints(),
      trim_start: _trimStart,
      trim_end: _trimEnd,
    };
  }

  document.getElementById("height-render")?.addEventListener("click", async () => {
    const gpxPath = (typeof getGlobalGpxPath === "function") ? getGlobalGpxPath() : "";
    if (!gpxPath) {
      if (typeof toast === "function") toast(t("heightanim.toast.no_gpx", "Erst GPX laden."), "warn", 3000);
      return;
    }
    const params = collectHeightParams();

    setRenderingState(true);
    try {
      const res = await window.pywebview.api.heightanim_start_render(params);
      if (!res || !res.ok) {
        setRenderingState(false);
        // v0.9.229 — gemeinsamer Render-Engine-Guard (ui/js/util.js): bei
        // fehlendem Browser dasselbe Download-Modal wie Animator/Tour-Map
        // statt nur ein Toast (Windows-Bug-Report Peter Straka).
        if (res && res.error_code === "playwright_browser_missing" && typeof showRenderEngineMissingModal === "function") {
          showRenderEngineMissingModal(res.browsers_path, async () => {
            setRenderingState(true);
            const r2 = await window.pywebview.api.heightanim_start_render(params);
            if (!r2 || !r2.ok) {
              setRenderingState(false);
              if (typeof toast === "function") toast(t("heightanim.toast.start_failed", "Render konnte nicht starten") + ": " + (r2?.error || "unknown"), "error", 8000);
              return;
            }
            _renderPollTimer = setTimeout(pollHeightRender, 250);
          });
          return;
        }
        if (typeof toast === "function") {
          toast(t("heightanim.toast.start_failed", "Render konnte nicht starten") + ": " + (res?.error || "unknown"), "error", 8000);
        }
        return;
      }
      _renderPollTimer = setTimeout(pollHeightRender, 250);
    } catch (e) {
      setRenderingState(false);
      console.error("[heightanim] start_render exception", e);
      if (typeof toast === "function") toast(t("heightanim.toast.start_failed", "Render konnte nicht starten") + ": " + e, "error", 8000);
    }
  });

  document.getElementById("height-cancel")?.addEventListener("click", async () => {
    const btn = document.getElementById("height-cancel");
    if (btn) { btn.disabled = true; btn.textContent = "⏳ " + t("animator.cancel.requesting", "Abbruch …"); }
    try { await window.pywebview.api.heightanim_cancel(); } catch (_) {}
  });

  // ── v0.9.399 — Zentriertes Ergebnis-Modal für den HTML-Export ──────────────
  function showHtmlExportModal(res) {
    const kb = Math.round((res.bytes || 0) / 1024);
    const body = `
      <p style="font-size:13px; margin:0 0 8px;">${t("heightanim.html.modal_intro", "Selbst-laufende Animation als HTML gespeichert")} (${kb} KB).</p>
      <p style="font-size:12px; color:var(--text-muted,#aaa); margin:0 0 12px;">${t("heightanim.html.modal_open_hint", "Zum Ansehen „Im Browser öffnen\" nutzen — ein Doppelklick auf die Datei startet je nach System nur einen Editor.")}</p>
      <p style="font-size:12px; margin:0 0 4px; font-weight:600;">${t("heightanim.html.snippet_hint", "Snippet zum direkten Einfügen in einen „Custom HTML\"-Block:")}</p>
      <textarea id="height-html-snippet" readonly rows="5" style="width:100%; font-family:ui-monospace,Menlo,monospace; font-size:10px; resize:vertical; box-sizing:border-box;"></textarea>
      <p class="muted" style="font-size:11px; margin:6px 0 0;">${t("heightanim.html.snippet_wp", "In WordPress: einen Block „Custom HTML\" einfügen und das Snippet hineinkopieren.")}</p>`;
    const footer = `
      <button type="button" id="height-html-browser" class="btn btn-primary">▶ ${t("heightanim.html.open_browser", "Im Browser öffnen")}</button>
      <button type="button" id="height-html-copy" class="btn btn-secondary">${t("heightanim.html.copy", "Snippet kopieren")}</button>
      <button type="button" id="height-html-reveal" class="btn btn-secondary">${t("animator.btn.reveal")}</button>
      <button type="button" id="height-html-close" class="btn btn-secondary">${t("heightanim.html.close", "Schließen")}</button>`;
    const modal = (typeof openModal === "function") ? openModal({
      title: t("heightanim.html.modal_title", "HTML exportiert"), body, footer,
    }) : null;
    const ta = document.getElementById("height-html-snippet");
    if (ta) ta.value = res.snippet || "";
    document.getElementById("height-html-browser")?.addEventListener("click", () => {
      try { window.pywebview.api.heightanim_open_in_browser(res.output); } catch (_) {}
    });
    document.getElementById("height-html-reveal")?.addEventListener("click", () => {
      try { window.pywebview.api.reveal_in_finder(res.output); } catch (_) {}
    });
    document.getElementById("height-html-close")?.addEventListener("click", () => { if (modal) modal.close(); });
    document.getElementById("height-html-copy")?.addEventListener("click", async () => {
      try {
        if (ta) { ta.focus(); ta.select(); }
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(res.snippet || "");
        else document.execCommand("copy");
        if (typeof toast === "function") toast(t("heightanim.html.copied", "Snippet kopiert."), "success", 2500);
      } catch (e) {
        if (typeof toast === "function") toast(t("heightanim.html.copy_manual", "Bitte manuell markieren + kopieren."), "info", 4000);
      }
    });
  }

  // ── v0.9.397 — HTML-Export (Blog/Web) ──────────────────────────────────────
  document.getElementById("height-export-html")?.addEventListener("click", async () => {
    const gpxPath = (typeof getGlobalGpxPath === "function") ? getGlobalGpxPath() : "";
    if (!gpxPath) {
      if (typeof toast === "function") toast(t("heightanim.toast.no_gpx", "Erst GPX laden."), "warn", 3000);
      return;
    }
    if (!window.pywebview?.api?.heightanim_export_html) {
      if (typeof toast === "function") toast("Bridge heightanim_export_html fehlt", "error", 5000);
      return;
    }
    const btn = document.getElementById("height-export-html");
    const oldTxt = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "⏳ " + t("heightanim.html.exporting", "Exportiere HTML …"); }
    try {
      const params = collectHeightParams();
      params.replay_label = "↻ " + t("heightanim.html.replay", "Neu starten");
      const res = await window.pywebview.api.heightanim_export_html(params);
      if (!res || !res.ok) {
        if (typeof toast === "function") toast(t("heightanim.html.failed", "HTML-Export fehlgeschlagen") + ": " + (res?.error || "unknown"), "error", 8000);
        return;
      }
      showHtmlExportModal(res);
    } catch (e) {
      console.error("[heightanim] export_html exception", e);
      if (typeof toast === "function") toast(t("heightanim.html.failed", "HTML-Export fehlgeschlagen") + ": " + e, "error", 8000);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = oldTxt; }
    }
  });

  // Cleanup: ResizeObserver disconnecten + Animation stoppen + Poll-Timer
  return function cleanup() {
    pausePlay();
    // v0.9.389 — GPX-Listener abmelden. Sonst lädt die verwaiste Closure bei jedem
    // GPX-Laden den Track nach + startet startPlay() → rafTick läuft ewig im Hintergrund.
    try { if (window.__rzGpxUnsub_height) { window.__rzGpxUnsub_height(); window.__rzGpxUnsub_height = null; } } catch (_) {}
    try { ro.disconnect(); } catch (_) {}
    if (_renderPollTimer) { clearTimeout(_renderPollTimer); _renderPollTimer = null; }
  };
}
