/* Reisezoom GPS Studio — Timeline-Bar-Komponente (v0.7.0)
 *
 * Wiederverwendbare Timeline-Bar für Track-Events (Camera-Keyframes,
 * später auch Foto-Inserts + Text-Overlays).
 *
 * Bedienung:
 *   const tl = mountTimelineBar({
 *     container: document.getElementById("anim-timeline-host"),
 *     getEvents: () => _settingsCache?.animator?.timeline_events || [],
 *     onScrub: (anchor) => { ... },         // Live-Preview-Update
 *     onAnchorChange: (idx, anchor) => { }, // User dragged Marker
 *     onSelect: (idx) => { ... },           // User clicked Marker
 *     onDelete: (idx) => { ... },           // Rechtsklick auf Marker
 *     onSnapshot: () => { ... },            // 📍 Hier Keyframe gedrückt
 *     onClearAll: () => { ... },            // 🗑 Alle weg
 *     onRunPreview: () => { ... },          // ▶ Probe-Lauf
 *   });
 *   tl.refresh();           // nach Änderung von events neu zeichnen
 *   tl.setScrubber(0.35);   // Scrubber an Position setzen
 *   tl.setSelected(2);      // Marker hervorheben (oder null)
 *
 * Anchor-Konvention: 0.0 = Track-Anfang, 1.0 = Track-Ende.
 */

function mountTimelineBar(opts) {
  const cb = opts || {};
  const host = cb.container;
  if (!host) {
    console.warn("mountTimelineBar: kein container");
    return null;
  }
  const getEvents = cb.getEvents || (() => []);

  // ── HTML ──────────────────────────────────────────────────────────────────
  // v0.9.1 — Multi-Lane: 6 horizontale Spuren (4 Camera-Properties +
  // 2 Reserve-Spuren für Marker und Foto). Jede Spur rendert ihre eigenen
  // Marker. Scrubber + Anim-End-Trenner sind durchgängig.
  const LANES = [
    { kind: "pitch",    label: tlT("animator.lane.pitch",    "Pitch"),     icon: "📐", color: "#5aa9ff" },
    { kind: "bearing",  label: tlT("animator.lane.bearing",  "Drehung"),   icon: "🧭", color: "#6cdd9b" },
    { kind: "zoom",     label: tlT("animator.lane.zoom",     "Zoom"),      icon: "🔍", color: "#c397ff" },
    { kind: "center",   label: tlT("animator.lane.center",   "Karte"),     icon: "📍", color: "#ffb24a" },
    { kind: "position", label: tlT("animator.lane.position", "Welt-Pos"),  icon: "✥",  color: "#4dd4ff" },
    // v0.9.136 — Welt-Drehung-Lane (rotation) abgeschafft (Insta360-Modell).
    // Die Drehung steckt jetzt in der abgewickelten center.lng der „Karte"-
    // Lane. Alte Projekte mit rotation-Events: Lane fehlt → Marker werden
    // nicht gezeigt (kein Crash; Marc-Regel „nur laden").
    // v0.9.227 — Marker- + Foto-Spuren entfernt (Marc): Schilder und Fotos
    // werden längst über ihr eigenes „Schilder und Fotos"-System gesetzt,
    // nicht mehr über Keyframe-Events. Die Reserve-Spuren kosteten nur Platz.
  ];
  const lanesHtml = LANES.map(L => `
    <div class="timeline-lane" data-kind="${L.kind}" style="--lane-color: ${L.color};">
      <div class="lane-label" title="${L.label}"><span class="lane-icon">${L.icon}</span><span class="lane-name">${L.label}</span></div>
      <div class="lane-track">
        <div class="lane-axis"></div>
        <div class="lane-markers" id="tl-lane-${L.kind}"></div>
      </div>
    </div>
  `).join("");
  host.innerHTML = `
    <div class="timeline-bar">
      <div class="timeline-track" id="tl-track">
        <!-- v0.9.4: Cluster-Row über allen Lanes. Ein Marker pro unique-anchor
             der den GANZEN Cluster (alle 4 Properties zusammen) verschiebt.
             Marc-Spec 2026-05-23: „mach doch oben drüber einen marker, um den
             cluster zu bewegen, das ist am intuitivsten". -->
        <div class="timeline-cluster-row" data-kind="__cluster">
          <div class="lane-label cluster-label" title="${tlT('animator.lane.cluster_tip', 'Klick: alle Properties auswählen · Drag: alle zusammen verschieben · Rechtsklick: alles löschen')}">
            <span class="lane-icon">🎬</span>
            <span class="lane-name">${tlT('animator.lane.cluster', 'Cluster')}</span>
          </div>
          <div class="lane-track cluster-track">
            <div class="cluster-axis"></div>
            <div class="cluster-markers" id="tl-cluster-markers"></div>
          </div>
        </div>
        <!-- v0.9.1: Multi-Lane-Container -->
        <div class="timeline-lanes">${lanesHtml}</div>
        <!-- v0.9.1: Overlay über die Lane-Track-Region (rechts der Labels).
             Enthält Scrubber + Hold-Region + Anim-End-Trenner. -->
        <div class="timeline-track-overlay">
          <!-- v0.9.59 — Intro-Region (links) + Intro-Trenner, analog zu Hold rechts -->
          <div class="timeline-intro-region" id="tl-intro-region" style="display:none"></div>
          <div class="timeline-anim-start" id="tl-anim-start" style="display:none" title="${tlT('animator.timeline.anim_start_tip', 'Ende der Intro-Phase, Beginn der Track-Animation')}"></div>
          <div class="timeline-hold-region" id="tl-hold-region" style="display:none"></div>
          <div class="timeline-anim-end" id="tl-anim-end" style="display:none" title="${tlT('animator.timeline.anim_end_tip', 'Ende der Track-Animation, Beginn der Hold-Phase')}"></div>
          <!-- v0.9.8 — Scrubber-Linie + Grab-Handle unten (Triangle).
               Handle sitzt ABSEITS der Cluster-Marker (= unter den Lanes,
               im Übergang zur Status-Zeile), damit Marc den Playhead auch
               an Anker 0 % oder 100 % anfassen kann ohne den Cluster-
               Marker zu erwischen. -->
          <div class="timeline-scrubber" id="tl-scrubber">
            <div class="scrubber-handle" id="tl-scrubber-handle"
                 title="${tlT('animator.timeline.scrubber.tip', 'Playhead — ziehen zum Scrubben')}"></div>
          </div>
          <!-- v0.9.41 — Trim-Bar (Render-Range). 2 Drag-Handles links + rechts;
               Bereich außerhalb wird gegrayed (über separates Overlay).
               Anchors sind 0..1 über GESAMT-Track. KFs außerhalb bleiben
               sichtbar (als Anlauf-Marker) — siehe CSS .kf-outside-trim. -->
          <div class="timeline-trim-shade timeline-trim-shade-left" id="tl-trim-shade-left"></div>
          <div class="timeline-trim-shade timeline-trim-shade-right" id="tl-trim-shade-right"></div>
          <div class="timeline-trim-region" id="tl-trim-region"></div>
          <div class="timeline-trim-handle timeline-trim-handle-start" id="tl-trim-handle-start"
               title="${tlT('animator.timeline.trim_start_tip', 'Render-Start ziehen — bestimmt wo der Render anfängt. KFs links davon werden als Anlauf-Bewegung verwendet.')}">
            <div class="trim-handle-grip"></div>
          </div>
          <div class="timeline-trim-handle timeline-trim-handle-end" id="tl-trim-handle-end"
               title="${tlT('animator.timeline.trim_end_tip', 'Render-Ende ziehen — bestimmt wo der Render aufhört.')}">
            <div class="trim-handle-grip"></div>
          </div>
        </div>
        <div class="timeline-ticks">
          <span class="timeline-tick" style="left:0%">0%</span>
          <span class="timeline-tick" style="left:25%">25%</span>
          <span class="timeline-tick" style="left:50%">50%</span>
          <span class="timeline-tick" style="left:75%">75%</span>
          <span class="timeline-tick" style="left:100%">100%</span>
        </div>
        <!-- v0.9.126 — Timeline-Scrollbar (nur sichtbar bei Zoom > 1).
             Funktioniert ähnlich wie Browser-Scrollbar: Track + Thumb dessen
             Breite den Sichtbereich-Anteil zeigt. Drag verschiebt _viewOffset. -->
        <div class="timeline-scrollbar" id="tl-scrollbar" style="display:none">
          <div class="tl-scrollbar-thumb" id="tl-scrollbar-thumb"></div>
        </div>
      </div>
      <div class="timeline-status-row">
        <div class="timeline-status" id="tl-status">—</div>
        <!-- v0.9.125 — Timeline-Zoom-Controls. Klick auf + zoomed um 2× rein,
             auf − wieder raus. Klick auf das Label resettet auf 1× (= ganze Track).
             Mausrad über der Timeline zoomed auch (centered auf Scrubber). -->
        <div class="timeline-zoom-controls" title="${tlT('animator.timeline.zoom.tip', 'Timeline-Zoom: Mausrad / +/− Buttons / Doppelklick auf 1×')}">
          <button type="button" class="tl-zoom-btn" id="tl-zoom-out" title="${tlT('animator.timeline.zoom.out', 'Auszoomen')}">−</button>
          <span class="tl-zoom-label" id="tl-zoom-label">1×</span>
          <button type="button" class="tl-zoom-btn" id="tl-zoom-in" title="${tlT('animator.timeline.zoom.in', 'Reinzoomen')}">+</button>
          <button type="button" class="tl-zoom-btn tl-zoom-reset" id="tl-zoom-reset" title="${tlT('animator.timeline.zoom.reset', 'Auf 1× zurücksetzen (ganzer Track)')}">⤢</button>
        </div>
        <!-- v0.9.1 — Hilfetexte als ?-Tooltip (Marc-Spec). Klick auf das ?
             toggelt die Tastatur-Belegung + Geste-Tipp ein/aus. -->
        <button type="button" class="field-help" data-help="timeline-keys"
                title="${tlT('animator.help.show', 'Hilfe anzeigen / verstecken')}">?</button>
      </div>
      <div class="timeline-actions">
        <button type="button" class="btn btn-primary timeline-btn-snap" id="tl-btn-snap"
                title="${tlT('animator.timeline.snap_tip', 'Snapshottet die aktuelle Karten-Ansicht als neuen Keyframe.')}">
          📍 <span>${tlT('animator.timeline.snap', 'Hier Keyframe')}</span>
        </button>
        <button type="button" class="btn timeline-btn-play" id="tl-btn-play"
                title="${tlT('animator.timeline.play_tip', 'Läuft den ganzen Track einmal ab als Probe in der eingestellten Animations-Dauer (ohne Render).')}">
          ▶ <span>${tlT('animator.timeline.play', 'Probe-Lauf')}</span>
        </button>
        <!-- v0.9.11 — Checkbox „vollständigen Track anzeigen". Marc-Spec:
             „Toggle, um zu wählen, dass in der Preview der ganze Track
             angezeigt wird, egal, wo man sich auf der Timeline befindet." -->
        <label class="timeline-toggle-fulltrack" id="tl-toggle-fulltrack"
               title="${tlT('animator.timeline.fulltrack_tip', 'An: kompletter Track immer sichtbar (kein Trim zur Scrubber-Position). Aus: Track wird auf den Bereich bis zum Scrubber gekürzt — wie im finalen Render.')}">
          <input type="checkbox" id="tl-cb-fulltrack">
          <span>${tlT('animator.timeline.fulltrack', 'Ganzer Track')}</span>
        </label>
        <!-- v0.9.15 — Checkbox „KF-Pins anzeigen" (= gelbe Dots auf dem
             Track an Keyframe-Positionen). An (Default) ist hilfreich beim
             Editieren, aus ist echtes WYSIWYG — Pins tauchen im finalen
             Render NIE auf. Marc-Spec: „muss man die keyfram dots, auf dem
             track ausblenden können, damit es wirklich wysiwyg ist". -->
        <label class="timeline-toggle-fulltrack" id="tl-toggle-kfpins"
               title="${tlT('animator.timeline.kfpins_tip', 'An: Keyframe-Pins (gelbe Dots) auf der Karten-Vorschau sichtbar — Editier-Hilfe. Aus: WYSIWYG-Modus, Pins erscheinen sowieso nicht im finalen Render.')}">
          <input type="checkbox" id="tl-cb-kfpins">
          <span>${tlT('animator.timeline.kfpins', 'KF-Pins')}</span>
        </label>
        <button type="button" class="btn btn-subtle timeline-btn-clear" id="tl-btn-clear"
                title="${tlT('animator.timeline.clear_tip', 'Entfernt alle Keyframes. Pitch/Rotation-Slider sind danach wieder aktiv.')}">
          🗑 <span>${tlT('animator.timeline.clear', 'Alle weg')}</span>
        </button>
      </div>
      <!-- v0.9.1 — Hilfetexte (Tastatur + Gesten) zusammengefasst in einem
           ?-Tooltip oberhalb. Dauer-Anzeige unten weg. -->
      <div class="muted field-help-content" data-help-content="timeline-keys" hidden
           style="font-size:11px; line-height:1.5;">
        <div class="timeline-keynav-hint">
          <kbd>←</kbd> <kbd>→</kbd> ${tlT('animator.timeline.keynav.step', 'GPS-Punkt')}
          · <kbd>⇧</kbd>+<kbd>←/→</kbd> ${tlT('animator.timeline.keynav.bigstep', '10er-Sprung')}
          · <kbd>Home</kbd> / <kbd>End</kbd> ${tlT('animator.timeline.keynav.ends', 'Anfang/Ende')}
          · <kbd>L</kbd> ${tlT('animator.timeline.keynav.play_l', 'Probe / Speed×2')}
          · <kbd>Space</kbd> ${tlT('animator.timeline.keynav.stop', 'Stop')}
          · <kbd>K</kbd> ${tlT('animator.timeline.keynav.snapshot', 'Keyframe setzen')}
          · <kbd>Del</kbd> ${tlT('animator.timeline.keynav.delete', 'Keyframe löschen')}
        </div>
        <div style="margin-top:6px;">
          💡 ${tlT('animator.timeline.gesture_hint', 'Tipp: Karte ganz normal hinziehen — <kbd>Cmd</kbd>+Drag (Mac) oder Rechtsklick+Drag kippt sie auch. Dann „Hier Keyframe" drücken.')}
        </div>
        <div style="margin-top:6px;">
          🎯 ${tlT('animator.timeline.dblclick_hint', '<strong>Doppelklick</strong> auf eine Lane (Pitch / Drehung / Zoom / Position) setzt <em>nur diese eine</em> Property an der Klick-Position — kein ganzer Cluster. Praktisch wenn man z.B. nur Bearing animieren will. Doppelklick in die Cluster-Zeile oben legt wie gewohnt alle 4 zusammen an.')}
        </div>
      </div>
    </div>
  `;

  // ── DOM-Refs + State ──────────────────────────────────────────────────────
  const trackEl     = host.querySelector("#tl-track");
  // v0.9.1: pro Lane eigenes markers-Element
  const laneMarkersEl = {};
  for (const L of LANES) {
    laneMarkersEl[L.kind] = host.querySelector(`#tl-lane-${L.kind}`);
  }
  // v0.9.4: Cluster-Row über den Lanes — ein Marker pro Anker
  const clusterMarkersEl = host.querySelector("#tl-cluster-markers");
  const scrubberEl  = host.querySelector("#tl-scrubber");
  const statusEl    = host.querySelector("#tl-status");
  const btnSnap     = host.querySelector("#tl-btn-snap");
  const btnPlay     = host.querySelector("#tl-btn-play");
  const btnClear    = host.querySelector("#tl-btn-clear");

  // v0.9.125 — Easing-Glyphs + Label (Mini-Picker auf Cluster-Verbindungslinie).
  function _easingLabel(kind) {
    if (kind === "ease_in")     return tlT("animator.timeline.easing.ease_in",     "Sanft starten");
    if (kind === "ease_out")    return tlT("animator.timeline.easing.ease_out",    "Sanft enden");
    if (kind === "ease_in_out") return tlT("animator.timeline.easing.ease_in_out", "Sanft in & aus");
    return tlT("animator.timeline.easing.linear", "Linear");
  }
  function _easingGlyph(kind, size) {
    // v0.9.126 — Icons im iMovie/FCP-Stil: zwei Endpunkt-Marker (Kreise)
    // plus verbindende Kurve/Linie. Marc-Spec aus Screenshot 2026-05-29.
    // pointer-events:none auf SVG damit der Button-Click den ganzen Bereich
    // einfängt (sonst klickt man auf den Path und der closest()-Lookup
    // ist zwar OK, aber Hit-Test mit 1.8px Stroke ist unzuverlässig).
    const s = size || 24;
    const stroke = 1.6;
    const dotR = 1.8;
    // Endpunkte: links unten (2,18) und rechts oben (18,2) — konsistent für
    // alle Kurven, damit man die Form sofort vergleichen kann.
    const dots = `<circle cx="3" cy="17" r="${dotR}" fill="currentColor"/><circle cx="17" cy="3" r="${dotR}" fill="currentColor"/>`;
    let path;
    if (kind === "ease_in") {
      // langsamer Anfang, schneller Schluss → Linie geht erst flach, dann steil
      path = `<path d="M3,17 Q14,17 17,3" fill="none" stroke="currentColor" stroke-width="${stroke}"/>`;
    } else if (kind === "ease_out") {
      // schneller Anfang, langsamer Schluss → Linie geht erst steil, dann flach
      path = `<path d="M3,17 Q6,3 17,3" fill="none" stroke="currentColor" stroke-width="${stroke}"/>`;
    } else if (kind === "ease_in_out") {
      // S-Kurve: beide Endpunkte mit horizontaler Tangente
      path = `<path d="M3,17 C8,17 12,3 17,3" fill="none" stroke="currentColor" stroke-width="${stroke}"/>`;
    } else {
      // linear: gerade Verbindung
      path = `<line x1="3" y1="17" x2="17" y2="3" stroke="currentColor" stroke-width="${stroke}"/>`;
    }
    return `<svg viewBox="0 0 20 20" width="${s}" height="${s}" style="pointer-events:none; display:block;">${path}${dots}</svg>`;
  }
  // v0.9.126 — Easing-Modal (statt floating Picker). Marc-Spec: zentrales
  // Modal mit Backdrop, große Icons im iMovie-Stil, Klick außerhalb schließt.
  let _easingModalEl = null;
  function _closeEasingModal() {
    if (_easingModalEl) { _easingModalEl.remove(); _easingModalEl = null; }
  }
  function _openEasingModal(targetAnchor, currentEasing) {
    _closeEasingModal();
    const backdrop = document.createElement("div");
    backdrop.className = "timeline-easing-modal-backdrop";
    const modal = document.createElement("div");
    modal.className = "timeline-easing-modal";
    modal.innerHTML = `
      <div class="easing-modal-title">${tlT("animator.timeline.easing.title", "Übergang zum nächsten Keyframe")}</div>
      <div class="easing-modal-grid"></div>
      <div class="easing-modal-footer">
        <button type="button" class="easing-modal-cancel">${tlT("animator.timeline.easing.cancel", "Abbrechen")}</button>
      </div>
    `;
    const grid = modal.querySelector(".easing-modal-grid");
    const opts = ["linear", "ease_in", "ease_out", "ease_in_out"];
    for (const o of opts) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "easing-modal-opt easing-" + o + (o === currentEasing ? " is-current" : "");
      btn.innerHTML = `<div class="easing-modal-glyph">${_easingGlyph(o, 56)}</div><div class="easing-modal-label">${_easingLabel(o)}</div>`;
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        _closeEasingModal();
        if (cb.onEasingChange) cb.onEasingChange(targetAnchor, o);
      });
      grid.appendChild(btn);
    }
    modal.querySelector(".easing-modal-cancel").addEventListener("click", _closeEasingModal);
    backdrop.appendChild(modal);
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) _closeEasingModal();
    });
    document.body.appendChild(backdrop);
    _easingModalEl = backdrop;
    // ESC-Key schließt
    const esc = (e) => {
      if (e.key === "Escape") { _closeEasingModal(); document.removeEventListener("keydown", esc); }
    };
    document.addEventListener("keydown", esc);
  }
  // v0.9.127 — Click-Handler ist jetzt DIREKT pro Symbol-Button (in refresh()
  // gesetzt), kein host-Delegated-Listener mehr. Robuster gegen Z-Index-Konflikte.

  // v0.9.125 — Timeline-Zoom (Marc-Wunsch: präzise arbeiten bei vielen KFs).
  // _viewZoom: 1 = ganzer Track sichtbar, 2 = halber, 4 = viertel, …
  // _viewOffset: Anchor-Wert am LINKEN Rand (0..1-_viewWindow).
  // Helper: _anchorToPct(a) → Prozent im sichtbaren Track
  //         _pctToAnchor(p) → Anchor-Wert (0..1) zurück (für Click→Anchor)
  let _viewZoom = 1;
  let _viewOffset = 0;
  const TL_ZOOM_MIN = 1;
  const TL_ZOOM_MAX = 16;
  function _viewWindow() { return 1 / _viewZoom; }
  function _anchorToPct(a) {
    return ((a - _viewOffset) * _viewZoom * 100).toFixed(2);
  }
  function _clampViewOffset(off) {
    return Math.max(0, Math.min(1 - _viewWindow(), off));
  }
  let _scrubAnchor = 0;
  // v0.9.3: Per-Event-Selection. _selectedEvent = {kind, anchor} oder null.
  // Frühere _selectedIdx (Cluster-Index) ist weg.
  let _selectedEvent = null;
  let _dragging = null;  // { type: "scrubber" | "marker", kind, anchor, moved }
  let _enabled = true;
  let _isPlaying = false;
  // v0.9.41 — Trim-Range (0..1 über Gesamt-Track). Default = ganzer Track.
  let _trimStart = 0.0;
  let _trimEnd   = 1.0;
  const TRIM_MIN_SPAN = 0.02;  // Minimum 2 % zwischen Start- und End-Handle

  // Status-Label-Provider (Animator setzt das via opts.getPositionLabel).
  // Default-Fallback: nur Prozent zeigen.
  function updateStatusLabel() {
    if (!statusEl) return;
    if (cb.getPositionLabel) {
      statusEl.textContent = cb.getPositionLabel(_scrubAnchor);
    } else {
      statusEl.textContent = (_scrubAnchor * 100).toFixed(1) + "%";
    }
  }

  // ── Anchor ↔ Pixel ────────────────────────────────────────────────────────
  // v0.9.1: jetzt relativ zum Overlay (= Track-Region rechts der Lane-Labels).
  const overlayEl = host.querySelector(".timeline-track-overlay");
  function anchorFromClientX(clientX) {
    const ref = overlayEl || trackEl;
    const rect = ref.getBoundingClientRect();
    const x = clientX - rect.left;
    // v0.9.125 — Zoom-aware: lokaler Pixel-Anteil → relative Position im
    // sichtbaren Fenster → echtes Anchor.
    const localFrac = Math.max(0, Math.min(1, x / Math.max(1, rect.width)));
    return Math.max(0, Math.min(1, _viewOffset + localFrac * _viewWindow()));
  }

  function setScrubberVisual(anchor) {
    _scrubAnchor = anchor;
    scrubberEl.style.left = _anchorToPct(anchor) + "%";
    updateStatusLabel();
  }

  // v0.9.41 — Trim-Visualisierung aktualisieren
  const trimShadeLeftEl  = host.querySelector("#tl-trim-shade-left");
  const trimShadeRightEl = host.querySelector("#tl-trim-shade-right");
  const trimRegionEl     = host.querySelector("#tl-trim-region");
  const trimHandleStartEl = host.querySelector("#tl-trim-handle-start");
  const trimHandleEndEl   = host.querySelector("#tl-trim-handle-end");
  function setTrimVisual(start, end) {
    _trimStart = Math.max(0, Math.min(1 - TRIM_MIN_SPAN, start));
    _trimEnd   = Math.max(_trimStart + TRIM_MIN_SPAN, Math.min(1, end));
    // v0.9.59: Trim-Handles werden visuell in die ANIM-REGION der Timeline
    // gemapt — `ti..tf`. ti = wo Intro endet (Anim beginnt), tf = wo Anim
    // endet (Hold beginnt). Ohne Intro (ti=0) verhält's sich wie v0.9.53.
    // Mit Intro: Handles rücken nach rechts, Anim-Region schrumpft entsprechend.
    const tf = _trackFraction || 1.0;
    const ti = _introFraction || 0.0;
    const span = Math.max(0.0001, tf - ti);
    const sVis = ti + _trimStart * span;
    const eVis = ti + _trimEnd   * span;
    // v0.9.125: Timeline-Zoom-aware via _anchorToPct
    const sPct = _anchorToPct(sVis);
    const ePct = _anchorToPct(eVis);
    if (trimShadeLeftEl)   trimShadeLeftEl.style.width  = "0%";  // v0.9.59: Intro-Region links ist eigene Anzeige
    if (trimShadeRightEl)  {
      trimShadeRightEl.style.left  = ePct + "%";
      trimShadeRightEl.style.width = "0%";
    }
    if (trimRegionEl)      { trimRegionEl.style.left = sPct + "%"; trimRegionEl.style.width = Math.max(0, (parseFloat(ePct) - parseFloat(sPct))).toFixed(2) + "%"; }
    if (trimHandleStartEl) trimHandleStartEl.style.left = sPct + "%";
    if (trimHandleEndEl)   trimHandleEndEl.style.left   = ePct + "%";
    _applyTrimDimToMarkers();
    // Hold + Intro folgen den jeweiligen Trim-Handles.
    _renderHoldUi();
    if (typeof _renderIntroUi === "function") _renderIntroUi();
  }
  function _applyTrimDimToMarkers() {
    const lo = _trimStart, hi = _trimEnd;
    host.querySelectorAll(".timeline-marker, .timeline-marker-cluster").forEach(el => {
      // v0.9.125 — Marker-Anchor via data-anchor (robust gegen Zoom-Skalierung),
      // nicht via parseFloat(el.style.left) — das wäre der gezoomte Wert.
      const da = parseFloat(el.dataset.anchor);
      const a = isNaN(da) ? (parseFloat(el.style.left) || 0) / 100 : da;
      el.classList.toggle("kf-outside-trim", a < lo - 0.0001 || a > hi + 0.0001);
    });
  }

  // Trim-Drag (Start- und End-Handle).
  // v0.9.48 (Marc-Spec): Hold-Trenner sitzt visuell am End-Trim; daher kein
  // separater Hold-Drag mehr. Trim-Position bestimmt alleine wo Hold beginnt.
  function _bindTrimHandle(handleEl, which) {
    if (!handleEl) return;
    handleEl.addEventListener("mousedown", (e) => {
      // v0.9.276 (Leo) — KEIN `if (!_enabled) return` mehr: der Trim (Render-Bereich)
      // ist unabhängig vom Keyframe-Modus und muss auch im Classic-Modus ziehbar sein.
      e.preventDefault(); e.stopPropagation();
      const onMove = (ev) => {
        // v0.9.59: Trim-Handles dürfen nur in der ANIM-REGION (ti..tf) der
        // Timeline. Visuell clampen, dann auf REALE Track-Position 0..1
        // rückrechnen via (visual - ti) / (tf - ti).
        const tf = _trackFraction || 1.0;
        const ti = _introFraction || 0.0;
        const span = Math.max(0.0001, tf - ti);
        let vp = anchorFromClientX(ev.clientX);
        vp = Math.max(ti, Math.min(tf, vp));
        let realA = (vp - ti) / span;
        if (which === "start") {
          realA = Math.max(0, Math.min(_trimEnd - TRIM_MIN_SPAN, realA));
          setTrimVisual(realA, _trimEnd);
        } else {
          realA = Math.max(_trimStart + TRIM_MIN_SPAN, Math.min(1, realA));
          setTrimVisual(_trimStart, realA);
        }
        if (cb.onTrimChange) cb.onTrimChange(_trimStart, _trimEnd, false);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        if (cb.onTrimChange) cb.onTrimChange(_trimStart, _trimEnd, true);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
  }
  _bindTrimHandle(trimHandleStartEl, "start");
  _bindTrimHandle(trimHandleEndEl,   "end");

  // ── Marker-Rendering pro Lane ────────────────────────────────────────────
  // v0.9.1: Multi-Lane. Pro Lane (Property-kind) eigene Marker-Liste; alle
  // Marker einer Lane stehen horizontal auf dem gleichen vertikalen Niveau.
  // Click auf einen Marker selektiert noch den Cluster (= alle Events am
  // gleichen Anker) — Per-Property-Edit kommt in v0.9.2.
  // v0.9.136 — rotation-Lane abgeschafft (Insta360-Modell, Drehung in
  // center.lng). position bleibt eigene Lane.
  const KF_KINDS = ["pitch", "bearing", "zoom", "center", "position", "camera"];
  function computeClusters(events) {
    const buckets = new Map();
    for (const ev of events) {
      if (!ev || !KF_KINDS.includes(ev.kind)) continue;
      const key = (+(ev.anchor || 0).toFixed(6));
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(ev);
    }
    return [...buckets.entries()]
      .map(([anchor, evs]) => ({ anchor, events: evs }))
      .sort((a, b) => a.anchor - b.anchor);
  }
  function refresh() {
    const events = getEvents();
    const clusters = computeClusters(events);
    // Cluster-Anchors für die Selektions-Mapping (Camera-Lanes)
    const clusterAnchors = clusters.map(c => c.anchor);

    // v0.9.4 — Cluster-Row: ein Marker pro unique Anker. Visuell deutlich
    // größer & dezent neutral gefärbt damit er als „der zieht alle 4 mit"
    // erkennbar ist.
    if (clusterMarkersEl) {
      clusterMarkersEl.innerHTML = "";
      for (const c of clusters) {
        const m = document.createElement("button");
        m.type = "button";
        const isSelected = _selectedEvent
          && _selectedEvent.kind === "__cluster"
          && Math.abs((_selectedEvent.anchor || 0) - (c.anchor || 0)) < 0.001;
        m.className = "timeline-marker timeline-marker-cluster"
                    + (isSelected ? " is-selected" : "");
        m.style.left = _anchorToPct(c.anchor || 0) + "%";
        m.dataset.kind = "__cluster";
        m.dataset.anchor = String(c.anchor || 0);
        m.title = `${tlT("animator.lane.cluster", "Cluster")} @ ${((c.anchor || 0) * 100).toFixed(0)}%\n\n`
                + tlT("animator.timeline.cluster.tip",
                      "Klick: alle Properties auswählen · Drag: alle zusammen verschieben · Rechtsklick: gesamten Cluster löschen");
        m.innerHTML = `<span class="timeline-marker-icon">🎬</span>`;
        clusterMarkersEl.appendChild(m);
      }
      // v0.9.125 — Easing-Symbole zwischen je zwei aufeinanderfolgenden Clustern.
      // Das Symbol sitzt mittig auf der Verbindungslinie, zeigt die aktuelle
      // Easing-Methode (linear/ein/aus/inout) des ZIEL-Clusters und öffnet bei
      // Klick ein Modal mit den 4 Optionen. Marc-Spec: „direkt auf der
      // linie, die 2 KFs verbindet in der mitte".
      // v0.9.127 — Mousedown-Handler DIREKT pro Symbol (statt Event-Delegation
      // auf host). Verhindert Z-Index-/Capture-Konflikte mit anderen Listeners.
      for (let i = 0; i < clusters.length - 1; i++) {
        const a = clusters[i];
        const b = clusters[i + 1];
        const targetEasing = (b.events.find(e => e && e.easing) || {}).easing || "linear";
        const midAnchor = (a.anchor + b.anchor) / 2;
        const sym = document.createElement("button");
        sym.type = "button";
        sym.className = "timeline-easing-symbol easing-" + targetEasing;
        sym.style.left = _anchorToPct(midAnchor) + "%";
        sym.dataset.targetAnchor = String(b.anchor);
        sym.dataset.easing = targetEasing;
        sym.title = `${tlT("animator.timeline.easing.tip", "Übergang")}: ${_easingLabel(targetEasing)}\n${tlT("animator.timeline.easing.click", "Klicken zum Ändern.")}`;
        sym.innerHTML = _easingGlyph(targetEasing);
        // Mousedown stoppt Cluster-Drag-Logik, click öffnet Modal.
        const _easeAnchor = b.anchor;
        const _curEase = targetEasing;
        sym.addEventListener("mousedown", (e) => {
          e.stopPropagation();
          e.preventDefault();
        });
        sym.addEventListener("click", (e) => {
          e.stopPropagation();
          e.preventDefault();
          _openEasingModal(_easeAnchor, _curEase);
        });
        clusterMarkersEl.appendChild(sym);
      }
    }

    // Pro Lane Marker rendern. Camera-Lanes (pitch/bearing/zoom/center)
    // bekommen Marker aus dem Cluster — wenn ein Camera-Event eine Property
    // hat, kriegt seine Lane einen Marker. v0.9.0-Migration garantiert dass
    // jeder Snapshot 4 Events anlegt → in allen 4 Lanes ein Marker.
    for (const L of LANES) {
      const el = laneMarkersEl[L.kind];
      if (!el) continue;
      el.innerHTML = "";
      // Lane-spezifische Events sammeln
      let laneEvents = [];
      if (L.kind === "marker" || L.kind === "photo") {
        laneEvents = events.filter(e => e && e.kind === L.kind);
      } else {
        // Camera-Lanes: pro Cluster checken ob die Property dort gesetzt ist
        for (let cIdx = 0; cIdx < clusters.length; cIdx++) {
          const c = clusters[cIdx];
          const hit = c.events.find(e =>
            e.kind === L.kind ||
            (e.kind === "camera" && (
              (L.kind === "pitch"   && e.pitch       !== undefined) ||
              (L.kind === "bearing" && e.bearing     !== undefined) ||
              (L.kind === "zoom"    && e.zoom_offset !== undefined) ||
              (L.kind === "center"  && e.center)
            ))
          );
          if (hit) {
            laneEvents.push({ anchor: c.anchor, kind: L.kind, clusterIdx: cIdx, ev: hit });
          }
        }
      }
      for (const item of laneEvents) {
        const m = document.createElement("button");
        m.type = "button";
        // v0.9.3: Selection ist PER-EVENT (kind + anchor), nicht pro Cluster.
        // v0.9.4: Wenn der CLUSTER ausgewählt ist (kind="__cluster"), kriegen
        //         ALLE Lane-Marker am gleichen Anker den is-selected-Glow —
        //         damit der User sieht, dass alle 4 Properties zusammen
        //         selektiert sind.
        const isSelected = _selectedEvent && (
          (_selectedEvent.kind === L.kind
           && Math.abs((_selectedEvent.anchor || 0) - (item.anchor || 0)) < 0.001)
          ||
          (_selectedEvent.kind === "__cluster"
           && Math.abs((_selectedEvent.anchor || 0) - (item.anchor || 0)) < 0.001)
        );
        m.className = `timeline-marker timeline-marker-${L.kind}`
                    + (isSelected ? " is-selected" : "");
        m.style.left = _anchorToPct(item.anchor || 0) + "%";
        m.dataset.kind = L.kind;
        m.dataset.anchor = String(item.anchor || 0);
        m.title = `${L.label} @ ${((item.anchor || 0) * 100).toFixed(0)}%\n\n`
                + tlT("animator.timeline.marker.tip", "Klick: auswählen · Rechtsklick: löschen · Drag: verschieben");
        m.innerHTML = `<span class="timeline-marker-icon">${L.icon}</span>`;
        el.appendChild(m);
      }
    }
    btnClear.disabled = clusters.length === 0;
    btnPlay.disabled  = false;
    // v0.9.41 — Marker-Dimming für Trim-Range neu anwenden
    _applyTrimDimToMarkers();
  }

  // v0.9.3: setSelected nimmt jetzt {kind, anchor} oder null.
  function setSelected(ev) {
    _selectedEvent = (ev && ev.kind) ? { kind: ev.kind, anchor: ev.anchor } : null;
    refresh();
  }

  function setScrubber(anchor) {
    setScrubberVisual(Math.max(0, Math.min(1, anchor || 0)));
  }

  function setEnabled(en) {
    _enabled = !!en;
    host.classList.toggle("is-disabled", !_enabled);
    btnSnap.disabled = !_enabled;
    btnPlay.disabled = !_enabled;
    if (!_enabled) btnClear.disabled = true;
    else refresh();
  }

  // ── Event-Bindings ────────────────────────────────────────────────────────

  // Scrubber drag (klick + drag auf der Track-Bar = Scrubber bewegen,
  // EXCLUDIVE der Klicks auf Marker)
  trackEl.addEventListener("mousedown", (e) => {
    if (!_enabled) return;
    if (e.target.closest(".timeline-marker")) {
      // wird vom marker-handler übernommen (siehe unten)
      return;
    }
    e.preventDefault();
    const anchor = anchorFromClientX(e.clientX);
    setScrubberVisual(anchor);
    if (cb.onScrub) cb.onScrub(anchor);
    _dragging = { type: "scrubber" };
  });

  // v0.9.8 — Direkter Drag auf den Scrubber-Handle (Triangle unten).
  // Sitzt außerhalb der Cluster-/Lane-Marker-Zonen → kein Hit-Test-Konflikt
  // mit Markern an Anker 0 % / 100 %.
  const scrubHandleEl = host.querySelector("#tl-scrubber-handle");
  if (scrubHandleEl) {
    scrubHandleEl.addEventListener("mousedown", (e) => {
      if (!_enabled) return;
      e.preventDefault();
      e.stopPropagation();
      const anchor = anchorFromClientX(e.clientX);
      setScrubberVisual(anchor);
      if (cb.onScrub) cb.onScrub(anchor);
      _dragging = { type: "scrubber" };
    });
  }

  // v0.9.3 — Marker-Click/Drag/Rechtsklick arbeiten pro Event (kind+anchor).
  trackEl.addEventListener("mousedown", (e) => {
    if (!_enabled) return;
    const m = e.target.closest(".timeline-marker");
    if (!m) return;
    const kind = m.dataset.kind;
    const anchor = parseFloat(m.dataset.anchor);
    if (!kind || isNaN(anchor)) return;
    e.preventDefault();
    e.stopPropagation();
    _selectedEvent = { kind, anchor };
    if (cb.onSelect) cb.onSelect({ kind, anchor });
    refresh();
    _dragging = { type: "marker", kind, anchor, moved: false };
  }, true);

  // v0.9.8 — Doppelklick auf eine LEERE Stelle einer Lane → nur ein
  // einzelner Property-Event in DIESER Lane wird angelegt. Marc-Spec:
  // „man sollte irgendwie durch klick auf die entsprechende zeile der
  // timeline nur für den entsprechenden wert dort einen keyframe setzen
  // können. Oder geht das schon irgendwie? sonst hat man immer den
  // ganzen cluster und muss alles was man nicht braucht rauslöschen."
  trackEl.addEventListener("dblclick", (e) => {
    if (!_enabled) return;
    if (e.target.closest(".timeline-marker")) return;
    // In welcher Lane wurde geklickt? (Lane- oder Cluster-Row)
    const laneEl = e.target.closest(".timeline-lane");
    const clusterEl = e.target.closest(".timeline-cluster-row");
    let kind;
    if (laneEl) {
      kind = laneEl.dataset.kind;
    } else if (clusterEl) {
      kind = "__cluster";
    }
    if (!kind) return;
    // Reserve-Lanes (marker/photo) noch nicht implementiert → ignorieren
    if (kind === "marker" || kind === "photo") return;
    e.preventDefault();
    e.stopPropagation();
    const anchor = anchorFromClientX(e.clientX);
    if (cb.onCreateSingle) cb.onCreateSingle({ kind, anchor });
  });

  trackEl.addEventListener("contextmenu", (e) => {
    if (!_enabled) return;
    const m = e.target.closest(".timeline-marker");
    if (!m) return;
    const kind = m.dataset.kind;
    const anchor = parseFloat(m.dataset.anchor);
    if (!kind || isNaN(anchor)) return;
    e.preventDefault();
    if (cb.onDelete) cb.onDelete({ kind, anchor });
  });

  // Globale mouse-move/up für drag
  window.addEventListener("mousemove", (e) => {
    if (!_dragging || !_enabled) return;
    const anchor = anchorFromClientX(e.clientX);
    if (_dragging.type === "scrubber") {
      setScrubberVisual(anchor);
      if (cb.onScrub) cb.onScrub(anchor);
    } else if (_dragging.type === "marker") {
      _dragging.moved = true;
      // v0.9.3: nur DIESEN einen Event bewegen (kind+oldAnchor identifiziert ihn).
      // v0.9.4: bei kind="__cluster" bewegt der Caller (module.js) alle 4
      //         Properties am Anker zusammen.
      if (cb.onAnchorChange) {
        cb.onAnchorChange({ kind: _dragging.kind, anchor: _dragging.anchor }, anchor);
      }
      // Marker visuell verschieben + dataset.anchor für den nächsten
      // Move-Tick mitziehen. Bei Cluster-Drag werden ALLE Marker am
      // selben Anker (Cluster + alle Lane-Marker) bewegt.
      let sel;
      if (_dragging.kind === "__cluster") {
        sel = `.timeline-marker[data-anchor="${_dragging.anchor}"]`;
      } else {
        sel = `.timeline-marker[data-kind="${_dragging.kind}"][data-anchor="${_dragging.anchor}"]`;
      }
      const els = trackEl.querySelectorAll(sel);
      els.forEach(m => {
        m.style.left = _anchorToPct(anchor) + "%";
        m.dataset.anchor = String(anchor);
      });
      _dragging.anchor = anchor;
      _selectedEvent = { kind: _dragging.kind, anchor };
    }
  });
  window.addEventListener("mouseup", () => {
    if (_dragging) {
      // Nach Drag-Ende einmal refresh, damit Marker-Reihenfolge + tooltips
      // konsistent sind. Bei Scrubber-Drag-Ende informieren wir den Caller,
      // damit der die volle Track-Linie wiederherstellen kann.
      const wasScrubber = _dragging.type === "scrubber";
      _dragging = null;
      refresh();
      if (wasScrubber && cb.onScrubEnd) cb.onScrubEnd(_scrubAnchor);
    }
  });

  // Action-Buttons
  btnSnap.addEventListener("click", () => {
    if (!_enabled || !cb.onSnapshot) return;
    cb.onSnapshot(_scrubAnchor);
  });
  btnPlay.addEventListener("click", () => {
    if (!_enabled || !cb.onRunPreview) return;
    cb.onRunPreview(!_isPlaying);
  });

  function setPlaying(isPlaying) {
    _isPlaying = !!isPlaying;
    if (_isPlaying) {
      btnPlay.classList.add("is-playing");
      btnPlay.querySelector("span").textContent = tlT('animator.timeline.stop', 'Stopp');
      btnPlay.firstChild.textContent = "⏸ ";
    } else {
      btnPlay.classList.remove("is-playing");
      btnPlay.querySelector("span").textContent = tlT('animator.timeline.play', 'Probe-Lauf');
      btnPlay.firstChild.textContent = "▶ ";
    }
  }

  // v0.8.6: Button-Text um Speed erweitern wenn > 1x
  function setPlayingSpeed(speed) {
    if (!_isPlaying) return;
    const span = btnPlay.querySelector("span");
    if (!span) return;
    if (speed && speed > 1) {
      span.textContent = tlT('animator.timeline.stop', 'Stopp') + " (" + speed + "×)";
    } else {
      span.textContent = tlT('animator.timeline.stop', 'Stopp');
    }
  }
  btnClear.addEventListener("click", () => {
    if (!_enabled || !cb.onClearAll) return;
    cb.onClearAll();
  });

  // v0.9.11 — Voller-Track-Toggle. State + Initial-Wert kommen vom Caller
  // via opts.getFullTrack() (für Restore aus Settings) und onChange-Callback.
  const cbFullTrack = host.querySelector("#tl-cb-fulltrack");
  if (cbFullTrack) {
    if (cb.getFullTrack) {
      try { cbFullTrack.checked = !!cb.getFullTrack(); } catch (_) {}
    }
    cbFullTrack.addEventListener("change", () => {
      if (cb.onFullTrackChange) cb.onFullTrackChange(!!cbFullTrack.checked);
    });
  }

  // v0.9.15 — KF-Pins-Toggle (analog Voller-Track-Toggle).
  const cbKfPins = host.querySelector("#tl-cb-kfpins");
  if (cbKfPins) {
    if (cb.getShowKfPins) {
      try { cbKfPins.checked = !!cb.getShowKfPins(); } catch (_) {}
    }
    cbKfPins.addEventListener("change", () => {
      if (cb.onShowKfPinsChange) cb.onShowKfPinsChange(!!cbKfPins.checked);
    });
  }

  // v0.8.11 — Track-Fraction (0..1) signalisiert den Übergang Anim→Hold.
  // Anim-Phase: 0..tf, Hold-Phase: tf..1. tf=1 = keine Hold-Phase
  // (Trenner unsichtbar).
  const animEndEl = host.querySelector("#tl-anim-end");
  const holdRegionEl = host.querySelector("#tl-hold-region");
  // v0.9.59 — Intro-Visuals (links auf der Timeline, Spiegel zur Hold-Region)
  const animStartEl = host.querySelector("#tl-anim-start");
  const introRegionEl = host.querySelector("#tl-intro-region");
  // v0.9.51 (Marc-Korrektur): Hold-Trenner ist NICHT mehr an _trimEnd gepegt
  // (das war v0.9.48 → falsch). Trim und Hold sind semantisch UNABHÄNGIG:
  //   - Trim-Handles = welche Track-Position gerendert wird (Track-Anker)
  //   - Hold-Trenner = wo in der ZEIT die Anim-Phase endet (= tf = dur/total)
  // Beide sitzen auf der gleichen Timeline (0..1 über anim+hold Gesamtzeit)
  // aber an unterschiedlichen Stellen. Bei neuem Projekt mit hold=5s,
  // trim=[0,1] sitzt der Trenner z.B. bei 0.75 (= 15s/20s), die Trim-Handles
  // bei 0 und 1. So sieht man den Hold-Block grafisch auch wenn der ganze
  // Track gerendert wird.
  // Trenner ist weiterhin NICHT draggable — Hold-Dauer ändert man am
  // Hold-Slider (v0.9.48-Design bleibt).
  let _hasHold = false;
  let _hasIntro = false;
  let _trackFraction = 1.0;   // tf: Position wo Anim endet, Hold beginnt
  let _introFraction = 0.0;   // ti: Position wo Intro endet, Anim beginnt
  // v0.9.59 — setTrackFraction nimmt jetzt zwei Argumente: tf (Anim-Ende) + ti (Intro-Ende)
  function setTrackFraction(tf, ti) {
    const f = Math.max(0, Math.min(1, parseFloat(tf) || 1));
    const i = Math.max(0, Math.min(f, parseFloat(ti) || 0));
    _trackFraction = f;
    _introFraction = i;
    _hasHold = f < 0.9999;
    _hasIntro = i > 0.0001;
    _renderHoldUi();
    _renderIntroUi();
    // Bei tf/ti-Änderung müssen die Trim-Handles ihre visuelle Position neu rechnen
    setTrimVisual(_trimStart, _trimEnd);
  }
  function _renderHoldUi() {
    // Hold-Trenner + Region sitzen visuell am rechten Trim-Handle (= ti + trim_end * (tf-ti)).
    const tf = _trackFraction || 1.0;
    const ti = _introFraction || 0.0;
    const holdStart = ti + _trimEnd * (tf - ti);
    if (animEndEl) {
      animEndEl.style.display = _hasHold ? "" : "none";
      animEndEl.style.left = _anchorToPct(holdStart) + "%";
    }
    if (holdRegionEl) {
      if (!_hasHold) {
        holdRegionEl.style.display = "none";
      } else {
        holdRegionEl.style.display = "";
        holdRegionEl.style.left = _anchorToPct(holdStart) + "%";
        holdRegionEl.style.width = Math.max(0, (1 - holdStart) * _viewZoom * 100).toFixed(2) + "%";
      }
    }
  }
  function _renderIntroUi() {
    // v0.9.59 — Intro-Trenner + Region sitzen visuell am LINKEN Trim-Handle
    // (= ti + trim_start * (tf-ti)). Intro-Region 0..left_trim_handle.
    // Analog zu Hold-Region rechts.
    const tf = _trackFraction || 1.0;
    const ti = _introFraction || 0.0;
    const introEnd = ti + _trimStart * (tf - ti);
    if (animStartEl) {
      animStartEl.style.display = _hasIntro ? "" : "none";
      animStartEl.style.left = _anchorToPct(introEnd) + "%";
    }
    if (introRegionEl) {
      if (!_hasIntro) {
        introRegionEl.style.display = "none";
      } else {
        introRegionEl.style.display = "";
        // v0.9.125 — Zoom-aware: linke Kante = -_viewOffset relativ, Breite = introEnd-Anteil im Window
        introRegionEl.style.left = _anchorToPct(0) + "%";
        introRegionEl.style.width = Math.max(0, introEnd * _viewZoom * 100).toFixed(2) + "%";
      }
    }
  }

  // ── v0.9.125: Timeline-Zoom-Controls ─────────────────────────────────────
  const zoomLabelEl = host.querySelector("#tl-zoom-label");
  const zoomInBtn   = host.querySelector("#tl-zoom-in");
  const zoomOutBtn  = host.querySelector("#tl-zoom-out");
  const zoomResetBtn= host.querySelector("#tl-zoom-reset");
  const scrollbarEl     = host.querySelector("#tl-scrollbar");
  const scrollbarThumbEl= host.querySelector("#tl-scrollbar-thumb");
  function _updateZoomLabel() {
    if (zoomLabelEl) zoomLabelEl.textContent = (_viewZoom < 2 ? _viewZoom.toFixed(0) : _viewZoom.toFixed(0)) + "×";
    if (zoomResetBtn) zoomResetBtn.style.opacity = (_viewZoom > 1) ? "1" : "0.4";
  }
  // v0.9.126 — Scrollbar darstellen wenn Zoom > 1
  function _updateScrollbar() {
    if (!scrollbarEl || !scrollbarThumbEl) return;
    if (_viewZoom <= 1) {
      scrollbarEl.style.display = "none";
      return;
    }
    scrollbarEl.style.display = "";
    const widthPct = (_viewWindow() * 100).toFixed(2);
    const leftPct  = (_viewOffset * 100).toFixed(2);
    scrollbarThumbEl.style.width = widthPct + "%";
    scrollbarThumbEl.style.left  = leftPct + "%";
  }
  function _applyZoom(newZoom, focusAnchor) {
    const oldZoom = _viewZoom;
    _viewZoom = Math.max(TL_ZOOM_MIN, Math.min(TL_ZOOM_MAX, newZoom));
    if (_viewZoom <= 1) {
      _viewZoom = 1;
      _viewOffset = 0;
    } else if (focusAnchor != null) {
      // Zentrum-Anchor halten: neuer Offset so dass focusAnchor in der Mitte des Fensters landet
      _viewOffset = _clampViewOffset(focusAnchor - _viewWindow() / 2);
    } else {
      // Kein Fokus → bisheriges Zentrum halten
      const oldCenter = _viewOffset + (1 / oldZoom) / 2;
      _viewOffset = _clampViewOffset(oldCenter - _viewWindow() / 2);
    }
    _updateZoomLabel();
    refresh();
    setScrubberVisual(_scrubAnchor);
    setTrimVisual(_trimStart, _trimEnd);
    _updateScrollbar();
  }
  if (zoomInBtn)  zoomInBtn.addEventListener("click", () => _applyZoom(_viewZoom * 2, _scrubAnchor));
  if (zoomOutBtn) zoomOutBtn.addEventListener("click", () => _applyZoom(_viewZoom / 2, _scrubAnchor));
  if (zoomLabelEl) zoomLabelEl.addEventListener("click", () => _applyZoom(1));
  if (zoomResetBtn) zoomResetBtn.addEventListener("click", () => _applyZoom(1));

  // v0.9.126 — Scrollbar-Drag: Thumb verschieben zum Pannen
  if (scrollbarEl && scrollbarThumbEl) {
    let _sbDrag = null;
    scrollbarThumbEl.addEventListener("mousedown", (e) => {
      if (_viewZoom <= 1) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = scrollbarEl.getBoundingClientRect();
      _sbDrag = {
        startX: e.clientX,
        startOffset: _viewOffset,
        trackWidth: rect.width,
      };
      document.body.style.cursor = "grabbing";
    });
    // Click auf leeren Bereich der Scrollbar = dort hinspringen
    scrollbarEl.addEventListener("mousedown", (e) => {
      if (_viewZoom <= 1 || e.target === scrollbarThumbEl) return;
      e.preventDefault();
      const rect = scrollbarEl.getBoundingClientRect();
      const fracClick = (e.clientX - rect.left) / Math.max(1, rect.width);
      // Center thumb at click
      _viewOffset = _clampViewOffset(fracClick - _viewWindow() / 2);
      refresh();
      setScrubberVisual(_scrubAnchor);
      setTrimVisual(_trimStart, _trimEnd);
      _updateScrollbar();
    });
    window.addEventListener("mousemove", (e) => {
      if (!_sbDrag) return;
      const dx = e.clientX - _sbDrag.startX;
      const dxFrac = dx / Math.max(1, _sbDrag.trackWidth);
      _viewOffset = _clampViewOffset(_sbDrag.startOffset + dxFrac);
      refresh();
      setScrubberVisual(_scrubAnchor);
      setTrimVisual(_trimStart, _trimEnd);
      _updateScrollbar();
    });
    window.addEventListener("mouseup", () => {
      if (_sbDrag) { _sbDrag = null; document.body.style.cursor = ""; }
    });
  }

  // v0.9.127 — Mausrad/Touchpad-Handler
  //   Ctrl/Cmd + Wheel        = Zoom in/out, zentriert auf Maus
  //   Touchpad 2-Finger horizontal (deltaX) ODER Shift/Alt + Wheel = Pan
  //   (kein Modifier + vertikales Scrollen = normal durchlassen für Page-Scroll)
  const wheelEl = host.querySelector(".timeline-bar");
  if (wheelEl) {
    wheelEl.addEventListener("wheel", (e) => {
      if (!_enabled) return;
      // Ctrl/Cmd → Zoom
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const focus = anchorFromClientX(e.clientX);
        const factor = e.deltaY < 0 ? 1.25 : 0.8;
        _applyZoom(_viewZoom * factor, focus);
        return;
      }
      // Touchpad 2-Finger horizontal (= deltaX dominiert) → Pan auch ohne Modifier.
      // Plus Shift/Alt + Wheel als expliziter Pan-Trigger (Maus-Variante).
      const absX = Math.abs(e.deltaX);
      const absY = Math.abs(e.deltaY);
      const touchpadHorizontal = absX > absY && absX > 0.5;
      const modifierPan = e.shiftKey || e.altKey;
      if (touchpadHorizontal || modifierPan) {
        if (_viewZoom <= 1) return;  // kein Pan möglich ohne Zoom
        e.preventDefault();
        // Bei Modifier: deltaY auswerten (klassisches Maus-Wheel ohne X).
        // Bei Touchpad: deltaX direkt.
        const raw = touchpadHorizontal ? e.deltaX : (e.deltaY || e.deltaX);
        const delta = raw / 800 * _viewWindow();
        _viewOffset = _clampViewOffset(_viewOffset + delta);
        refresh();
        setScrubberVisual(_scrubAnchor);
        setTrimVisual(_trimStart, _trimEnd);
        _updateScrollbar();
      }
    }, { passive: false });
  }

  // Pan via Mittlere-Maus-Drag oder Shift+Drag im Overlay
  let _panDrag = null;
  if (overlayEl) {
    overlayEl.addEventListener("mousedown", (e) => {
      // Nur bei middle-mouse oder shift+left auf leerer Area pannen
      if (_viewZoom <= 1) return;
      const isPan = e.button === 1 || (e.button === 0 && e.shiftKey);
      if (!isPan) return;
      e.preventDefault();
      const rect = overlayEl.getBoundingClientRect();
      _panDrag = { startX: e.clientX, startOffset: _viewOffset, width: rect.width };
    });
  }
  window.addEventListener("mousemove", (e) => {
    if (!_panDrag) return;
    const dx = e.clientX - _panDrag.startX;
    const dxFrac = dx / Math.max(1, _panDrag.width);
    _viewOffset = _clampViewOffset(_panDrag.startOffset - dxFrac * _viewWindow());
    refresh();
    setScrubberVisual(_scrubAnchor);
    setTrimVisual(_trimStart, _trimEnd);
    _updateScrollbar();
  });
  window.addEventListener("mouseup", () => { _panDrag = null; });

  _updateZoomLabel();
  _updateScrollbar();

  // Initial render
  refresh();
  updateStatusLabel();

  // v0.9.11 — Voller-Track-Toggle programmatisch setzen (für Settings-Restore)
  function setFullTrack(on) {
    if (cbFullTrack) cbFullTrack.checked = !!on;
  }
  // v0.9.15 — KF-Pins-Toggle programmatisch setzen (für Settings-Restore)
  function setShowKfPins(on) {
    if (cbKfPins) cbKfPins.checked = !!on;
  }

  // v0.9.41 — Trim-API
  function setTrim(start, end) {
    setTrimVisual(start, end);
  }

  return {
    refresh,
    setScrubber,
    setSelected,
    setEnabled,
    setPlaying,
    setPlayingSpeed,
    setTrackFraction,
    setFullTrack,
    setShowKfPins,
    setTrim,
    getTrim: () => ({ start: _trimStart, end: _trimEnd }),
    isPlaying: () => _isPlaying,
    getScrubber: () => _scrubAnchor,
    updateStatusLabel,
  };
}

// Mini-i18n-Wrapper: nutzt t() wenn vorhanden, sonst Fallback-Text.
// (Manche frühe Mounts feuern bevor i18n bereit ist — sicherer als
// direkter Aufruf zu t().)
function tlT(key, fallback) {
  try {
    if (typeof t === "function") {
      const s = t(key);
      if (s && s !== key) return s;
    }
  } catch (_) {}
  return fallback;
}
