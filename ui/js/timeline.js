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
 *     onEventCopy: (ev, zielAnker) => { },  // Alt+Ziehen = duplizieren
 *     onEventClipboardCopy: (ev) => { },     // ⌘C
 *     onEventClipboardPaste: (anker) => { }, // ⌘V an der Abspielposition
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
  // 22.08.2026 (Audit): Jeder Mount hängte 7 Window-Listener an, kein Abbau —
  // bei jedem Modulwechsel stapelten sich Closures samt getEvents-Referenzen.
  // Alle dauerhaften Listener laufen über diesen Registrar; `destroy()` räumt auf.
  const _winListeners = [];
  const _win = (ev, fn) => { window.addEventListener(ev, fn); _winListeners.push([ev, fn]); };

  // ── HTML ──────────────────────────────────────────────────────────────────
  // v0.9.1 — Multi-Lane: 6 horizontale Spuren (4 Camera-Properties +
  // 2 Reserve-Spuren für Marker und Foto). Jede Spur rendert ihre eigenen
  // Marker. Scrubber + Anim-End-Trenner sind durchgängig.
  // Lanes, deren Wert sich mit Option+Ziehen verändern lässt (v0.9.512).
  const WERT_LANES = ["pitch", "bearing", "zoom", "position"];
  const LANES = [
    // 09.09.2026 (Marc: „mach das Tempo in der Timeline nach oben und
    // durchgehend") — die Tempo-Spur steht ÜBER den Keyframe-Spuren, wie der
    // Tempo-Editor in Final Cut über dem Clip. Sie rendert keine
    // Keyframe-Marker, sondern eine durchgehende Kachelung; ihre Bedienung
    // liegt unten in `_tempoBinden` und meldet über `onTempoChange`.
    { kind: "tempo", label: tlT("animator.lane.tempo", "Tempo"), icon: "⏱", color: "#ffa94d",
      tip: tlT("animator.lane.tempo_tip", "Tempo: hier anhalten oder einen Abschnitt langsamer laufen lassen. Ziehen legt einen Abschnitt an, Doppelklick auf freie Fläche einen Halt, Doppelklick auf einen Eintrag öffnet ihn, Rechtsklick zeigt das Menü.") },
    { kind: "pitch",    label: tlT("animator.lane.pitch",    "Pitch"),     icon: "📐", color: "#5aa9ff" },
    { kind: "bearing",  label: tlT("animator.lane.bearing",  "Drehung"),   icon: "🧭", color: "#6cdd9b" },
    { kind: "zoom",     label: tlT("animator.lane.zoom",     "Zoom"),      icon: "🔍", color: "#c397ff" },
    // v0.9.530 (Nutzerfrage aus Spanien, IDEAS §31): „Karte" und „Welt-Pos"
    // waren nicht auseinanderzuhalten. Jetzt benannt nach dem, was sie TUN
    // (Erdpunkt = Erde drehen, Bildlage = Bild im Ausschnitt schieben) + je
    // ein erklärender Tooltip an der Spur-Beschriftung.
    { kind: "center",   label: tlT("animator.lane.center",   "Erdpunkt"), icon: "📍", color: "#ffb24a",
      tip: tlT("animator.lane.center_tip", "Erdpunkt: welcher Punkt der Erde unter der Kamera liegt. Ändern DREHT die Erde unter der Kamera (Werte über ±180° = volle Umdrehungen).") },
    { kind: "position", label: tlT("animator.lane.position", "Bildlage"), icon: "✥",  color: "#4dd4ff",
      tip: tlT("animator.lane.position_tip", "Bildlage: verschiebt die Erdansicht im Bildausschnitt (±50%). Die Kamera bleibt — nur das Bild rutscht, z.B. um Platz für Text zu schaffen.") },
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
      <div class="lane-label" title="${L.tip || L.label}"><span class="lane-icon">${L.icon}</span><span class="lane-name">${L.label}</span></div>
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
          <!-- v0.9.528 (Nutzer-Idee aus Spanien + Marc): Der Griff-KÖRPER ist nur
               noch Anzeige (pointer-events:none) — Keyframes exakt auf Start/Ende
               waren sonst auf der Leiste nicht mehr anfassbar. Gegriffen wird am
               KOPF, einem Fähnchen UNTER der Leiste (wie der Scrubber-Pfeil):
               Start-Fahne hängt links der Linie, Ende-Fahne rechts — so bleibt
               auch das Scrubber-Dreieck dazwischen frei. -->
          <div class="timeline-trim-handle timeline-trim-handle-start" id="tl-trim-handle-start">
            <div class="trim-handle-kopf"
                 title="${tlT('animator.timeline.trim_start_tip', 'Render-Start ziehen — bestimmt wo der Render anfängt. KFs links davon werden als Anlauf-Bewegung verwendet.')}"></div>
          </div>
          <div class="timeline-trim-handle timeline-trim-handle-end" id="tl-trim-handle-end">
            <div class="trim-handle-kopf"
                 title="${tlT('animator.timeline.trim_end_tip', 'Render-Ende ziehen — bestimmt wo der Render aufhört.')}"></div>
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
        <!-- 08.09.2026 (Marc) — die Bilanz der Tempo-Kurve gehört dorthin, wo
             man sie baut: unter die Spur. In der Seitenleiste stand sie in
             einem zugeklappten Abschnitt und war praktisch unsichtbar. -->
        <div class="timeline-tempo-bilanz" id="tl-tempo-bilanz" hidden></div>
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
  function _openEasingModal(targetAnchor, currentEasing, currentSmooth) {
    _closeEasingModal();
    const backdrop = document.createElement("div");
    backdrop.className = "timeline-easing-modal-backdrop";
    const modal = document.createElement("div");
    modal.className = "timeline-easing-modal";
    modal.innerHTML = `
      <div class="easing-modal-title">${tlT("animator.timeline.easing.title", "Übergang zum nächsten Keyframe")}</div>
      <div class="easing-modal-grid"></div>
      <label class="easing-modal-smooth" title="${tlT("animator.timeline.smooth.tip", "Glättet in diesem Abschnitt das Auf und Ab der Kamera über dem Gelände. Das Häkchen „Ruhige Kamera“ in der Seitenleiste gilt für das ganze Video.")}">
        <input type="checkbox" class="easing-modal-smooth-cb" ${currentSmooth ? "checked" : ""}>
        <span>🎥 ${tlT("animator.timeline.smooth.label", "Ruhige Kamera in diesem Abschnitt")}</span>
      </label>
      <div class="easing-modal-footer">
        <button type="button" class="easing-modal-cancel">${tlT("animator.timeline.easing.cancel", "Abbrechen")}</button>
      </div>
    `;
    // 22.08.2026 — Ruhige Kamera je Abschnitt (Marc: „da einstellen, wo man
    // den Übergang einstellt"). Wirkt sofort, das Modal bleibt offen.
    const smoothCb = modal.querySelector(".easing-modal-smooth-cb");
    smoothCb.addEventListener("change", () => {
      if (cb.onSmoothChange) cb.onSmoothChange(targetAnchor, !!smoothCb.checked);
    });
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
  // ⚠️ ZWEI GRÖSSEN, DIE MAN NICHT VERWECHSELN DARF (v0.9.511):
  //   • Track-Anker  0..1 über die GESAMTE Strecke — so sind Keyframes,
  //     Trim-Griffe, Schilder und Foto-Pins gespeichert.
  //   • Leisten-Position 0..1 über die GESAMTE ZEIT (Intro + Anim + Hold).
  // Die Anim-Region der Leiste läuft von ti bis tf; nur dort bewegt sich der
  // Track. `setTrimVisual` rechnete das schon immer so — Keyframes wurden
  // dagegen mit ihrem rohen Anker als Leisten-Position gezeichnet. Ohne Intro
  // und ohne Hold sind beide Größen gleich, deshalb fiel es nie auf; mit Hold
  // wanderten die Pins nach rechts weg von ihrer Stelle im Track.
  // ⚠️ Bewusst OHNE Klemmen auf 0..1 (Fehler-Bericht ein Beta-Tester, 16.08.2026:
  // „Früher konnte ich hier einen Keyframe setzen, in dieser letzten Version
  // schaffe ich das nicht.")
  //
  // Ein Keyframe DARF vor dem Track-Anfang liegen: Das ist der Anlauf im Intro,
  // mit dem die Kamera schon in Bewegung ist, wenn der Track beginnt — und
  // hinter dem Ende ebenso, für den Nachschwenk im Hold. Der Renderer rechnet
  // dort ohnehin mit Ankern außerhalb 0..1 (`_kamera_anker` in
  // core/animator.py). Mit dem Klemmen landete im Intro jeder Klick bei 0, der
  // Keyframe sprang an den Track-Anfang, und es sah aus, als ginge es nicht.
  function _trackToBar(a) {
    const tf = _trackFraction || 1.0, ti = _introFraction || 0.0;
    return ti + a * Math.max(0.0001, tf - ti);
  }
  function _barToTrack(p) {
    const tf = _trackFraction || 1.0, ti = _introFraction || 0.0;
    return (p - ti) / Math.max(0.0001, tf - ti);
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
  // v0.9.512 — Während des Wert-Ziehens zeigt die Zeile den laufenden Wert
  // an, sonst die Scrubber-Position. Ohne das zieht man blind.
  let _statusHint = null;
  // ── Tempo-Spur (08.09.2026, Marc) ────────────────────────────────────────
  // Zwei Sorten Einträge, beide an der STRECKE verankert wie Keyframes:
  //   { art:"halt",  bei, sek, kamera }              — die Strecke steht still
  //   { art:"tempo", von, bis, faktor }              — Abschnitt gegen die Grundraffung
  // Die Spur zeichnet und bedient; gerechnet wird in core/tempo.py, gespeichert
  // im Projekt. Änderungen gehen über `onTempoChange` zurück an den Animator.
  let _tempo = [];              // die Einträge
  let _tempoHalte = [];         // aus der Kurve: Lage der Halte in Videosekunden
  let _tempoKurve = null;       // { dauer_s, anteile[] } — Videozeit ↔ Strecke
  let _tempoZieh = null;        // laufende Geste
  let _tempoLetzterDruck = null;  // { i, t } — für die eigene Doppelklick-Erkennung
  let _tempoHinweis = null;     // gesetzt = Spur gesperrt, Text steht darin
  // 09.09.2026 (Marc: „bei Multitrack sollte man sehen, welcher Track an welcher
  // Stelle in der Timeline läuft"): Die Etappen mit Name, Farbe und ihrer Lage
  // auf der Leiste. Die Grund-Kacheln der Tempo-Spur SIND die Etappen — sie
  // tragen deshalb deren Namen statt „1,0×".
  let _tempoEtappen = [];       // [{ name, farbe, von, bis }] in Leisten-Anteilen
  // ── Gruppen-Zeilen (IDEAS §60, Phase 3 — 09.09.2026) ─────────────────────
  // Ab zwei Gruppen IST die Tempo-Spur die erste Zeile der Gruppen: jede Kachel
  // eine Gruppe (Name, Faktor, Sekunden), die Lücke zwischen zwei Inhalten der
  // Übergang, davor und dahinter die Halte. Gruppen, deren Inhalte sich
  // überlappen, bekommen eigene Zeilen darunter (`data-kind="gruppe"`).
  // Bedienung: Kachel ziehen = in der Zeit verschieben, Ränder = Länge (Faktor),
  // Doppelklick/Rechtsklick = öffnen, Kachel nach oben/unten ziehen = Stapel.
  let _gruppenZeilen = [];      // [[{id, name, farbe, von, bis, vonS, sek, faktor, n, inKette, kamera, ueber_stil, fest}]]
  let _gruppenZieh = null;
  let _gruppenLetzterDruck = null;
  let _gruppenGesamtS = 0;      // Länge des ganzen Videos — vom Animator mitgegeben, damit Pixel ↔ Sekunden stimmen

  function setGruppen(zeilen, gesamtS) {
    _gruppenZeilen = Array.isArray(zeilen) ? zeilen.map(z => (z || []).slice()) : [];
    _gruppenGesamtS = (+gesamtS > 0) ? +gesamtS : 0;
    _gruppenZeilenSicherstellen();
    const el = laneMarkersEl["tempo"];
    if (el) _tempoZeichnen(el);
  }
  /** So viele Zusatz-Zeilen anlegen, wie der Plan braucht (Zeile 0 ist die Tempo-Spur). */
  function _gruppenZeilenSicherstellen() {
    const lanes = host.querySelector(".timeline-lanes");
    const tempoLane = host.querySelector('.timeline-lane[data-kind="tempo"]');
    if (!lanes || !tempoLane) return;
    const soll = Math.max(0, _gruppenZeilen.length - 1);
    const da = Array.from(lanes.querySelectorAll('.timeline-lane[data-kind="gruppe"]'));
    for (let i = da.length; i < soll; i++) {
      const lane = document.createElement("div");
      lane.className = "timeline-lane";
      lane.dataset.kind = "gruppe";
      lane.dataset.zeile = String(i + 1);
      lane.style.setProperty("--lane-color", "#7fb8ff");
      lane.innerHTML = `<div class="lane-label" title="${tlT("animator.lane.gruppe_tip", "Parallel: diese Gruppen laufen gleichzeitig mit der Zeile darüber. Ziehen verschiebt, die Ränder ändern die Länge, Doppelklick öffnet.")}"><span class="lane-icon">∥</span><span class="lane-name">${tlT("animator.lane.gruppe", "parallel")}</span></div>
        <div class="lane-track"><div class="lane-axis"></div><div class="lane-markers" id="tl-lane-gruppe-${i + 1}"></div></div>`;
      // hinter der letzten Gruppen-Zeile bzw. hinter der Tempo-Spur
      const vorher = lanes.querySelectorAll('.timeline-lane[data-kind="gruppe"]');
      const anker = vorher.length ? vorher[vorher.length - 1] : tempoLane;
      anker.insertAdjacentElement("afterend", lane);
      _gruppenBinden(lane.querySelector(".lane-track"), i + 1);
    }
    const jetzt = Array.from(lanes.querySelectorAll('.timeline-lane[data-kind="gruppe"]'));
    for (let i = soll; i < jetzt.length; i++) jetzt[i].remove();
    tempoLane.classList.toggle("ist-gruppen", _gruppenZeilen.length > 0);
    const name = tempoLane.querySelector(".lane-name"), icon = tempoLane.querySelector(".lane-icon");
    if (name) name.textContent = _gruppenZeilen.length ? tlT("animator.lane.gruppen", "Touren") : tlT("animator.lane.tempo", "Tempo");
    if (icon) icon.textContent = _gruppenZeilen.length ? "🎥" : "⏱";
    const label = tempoLane.querySelector(".lane-label");
    if (label) label.title = _gruppenZeilen.length
      ? tlT("animator.lane.gruppen_tip", "Jede Kachel ist eine Gruppe von Touren; die Kamera folgt der obersten, die gerade läuft. Ziehen verschiebt eine Gruppe in der Zeit, die Ränder ändern ihre Länge, Doppelklick öffnet sie, nach oben oder unten ziehen ordnet den Stapel.")
      : tlT("animator.lane.tempo_tip", "Tempo: hier anhalten oder einen Abschnitt langsamer laufen lassen. Ziehen legt einen Abschnitt an, Doppelklick auf freie Fläche einen Halt, Doppelklick auf einen Eintrag öffnet ihn, Rechtsklick zeigt das Menü.");
  }
  /** Sekunden des ganzen Videos je Leisten-Anteil — und umgekehrt. */
  function _gruppenSekJeAnteil() {
    if (_gruppenGesamtS > 0) return _gruppenGesamtS;
    const ges = _tempoGesamtS();
    return ges > 0 ? ges : 0;
  }
  /** Eine Zeile zeichnen: Halte und Übergänge als Bänder, Inhalte als Kacheln. */
  function _gruppenZeileZeichnen(el, zeile) {
    const gruppen = (_gruppenZeilen[zeile] || []).slice().sort((a, b) => a.von - b.von);
    const ti = _introFraction || 0.0, tf = _trackFraction || 1.0;
    const breitePx = el.getBoundingClientRect().width || 1000;
    const ges = _gruppenSekJeAnteil();
    const zahl = (v) => (Math.round(v * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const band = (von, bis, art, titel, stil) => {
      if (bis - von < 0.0005) return;
      const b = document.createElement("div");
      b.className = "tl-gruppe-band tl-gruppe-" + art;
      b.style.left = _anchorToPct(von) + "%";
      b.style.width = Math.max(0.3, _anchorToPct(bis) - _anchorToPct(von)) + "%";
      const sek = ges > 0 ? (bis - von) * ges : 0;
      b.title = titel + (sek > 0 ? ` · ${zahl(sek)} s` : "");
      const wPx = (bis - von) * _viewZoom * breitePx;
      const glyph = art === "ueber" ? (stil === "luftlinie" ? "↗" : stil === "schnitt" ? "✂" : "✈") : "⏸";
      b.innerHTML = wPx >= 14 ? `<span class="tl-gruppe-glyph">${glyph}</span>` + (wPx >= 48 && sek > 0 ? `<span class="tl-gruppe-sek">${zahl(sek)} s</span>` : "") : "";
      el.appendChild(b);
    };
    let pos = ti;
    gruppen.forEach((g, i) => {
      if (i === 0) band(pos, g.von, "halt", tlT("animator.gruppe.halt_vor", "Halt vor dem Inhalt"));
      else band(pos, g.von, "ueber", tlT("animator.gruppe.uebergang", "Übergang"), g.ueber_stil);
      const k = document.createElement("button");
      k.type = "button";
      k.className = "tl-gruppe" + (g.kamera ? " ist-kamera" : "") + (g.fest ? " ist-fest" : "") + (g.n > 1 ? " hat-mitglieder" : "");
      k.dataset.id = g.id;
      k.draggable = false;
      k.style.left = _anchorToPct(g.von) + "%";
      k.style.width = Math.max(0.4, _anchorToPct(g.bis) - _anchorToPct(g.von)) + "%";
      if (g.farbe) k.style.borderLeftColor = g.farbe;
      const wPx = (g.bis - g.von) * _viewZoom * breitePx;
      const fTxt = zahl(+g.faktor || 1) + "×";
      const sTxt = g.sek > 0 ? zahl(g.sek) + " s" : "";
      k.title = `${g.name || g.id}` + (g.n > 1 ? ` · ${g.n} ${tlT("animator.gruppe.touren", "Touren")}` : "")
        + ` · ${fTxt} · ${sTxt}` + (g.kamera ? " · " + tlT("animator.gruppe.kamera", "die Kamera folgt dieser Gruppe") : "")
        + "\n" + tlT("animator.gruppe.tip", "Ziehen: in der Zeit verschieben · Ränder: Länge · Doppelklick: öffnen");
      const name = wPx >= 44 ? `<span class="tl-gruppe-name">${(g.n > 1 ? "👥 " : "")}${_esc(g.name || g.id)}</span>` : "";
      const zahlen = wPx >= 96 ? `<span class="tl-gruppe-zahlen">${fTxt}${sTxt ? " · " + sTxt : ""}</span>`
        : (wPx >= 60 && Math.abs((+g.faktor || 1) - 1) > 1e-9 ? `<span class="tl-gruppe-zahlen">${fTxt}</span>` : "");
      k.innerHTML = `<span class="tl-gruppe-rand" data-rand="l"></span>${name}${zahlen}<span class="tl-gruppe-rand" data-rand="r"></span>`;
      el.appendChild(k);
      pos = g.bis;
    });
    if (pos < tf - 0.0005) band(pos, tf, "halt", tlT("animator.gruppe.halt_nach", "Halt nach dem Inhalt (Auffüllen bis zum Ende)"));
  }
  function _esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function _gruppenAlleZeichnen() {
    _gruppenZeilen.forEach((_z, i) => {
      const el = i === 0 ? laneMarkersEl["tempo"] : host.querySelector(`#tl-lane-gruppe-${i}`);
      if (!el) return;
      el.innerHTML = "";
      _gruppenZeileZeichnen(el, i);
    });
  }
  function _gruppeVonId(id) {
    for (const z of _gruppenZeilen) for (const g of z) if (g.id === id) return g;
    return null;
  }
  /** Bedienung einer Gruppen-Zeile (die Tempo-Spur bindet dasselbe in `_tempoBinden`). */
  function _gruppenBinden(lane, zeile) {
    if (!lane) return;
    lane.addEventListener("mousedown", (ev) => _gruppenMausDruck(ev, lane, zeile));
    lane.addEventListener("contextmenu", (ev) => {
      const k = ev.target.closest(".tl-gruppe");
      if (!k) return;
      ev.preventDefault();
      _gruppenMenue(ev, k.dataset.id);
    });
  }
  function _gruppenMenue(ev, id) {
    _menueZeigen(ev, [
      { text: tlT("animator.tempo.menu_oeffnen", "Öffnen …"),
        tun: () => { try { (cb.onGruppeOeffnen || (() => {}))(id); } catch (e) { console.warn("onGruppeOeffnen:", e); } } },
    ]);
  }
  function _gruppenMausDruck(ev, lane, zeile) {
    const k = ev.target.closest(".tl-gruppe");
    if (!k || ev.button !== 0) return false;
    const rand = ev.target.closest(".tl-gruppe-rand");
    const id = k.dataset.id;
    const g = _gruppeVonId(id);
    if (!g) return false;
    ev.preventDefault();
    // Doppelklick selbst erkennen — die Zeile wird nach jedem Loslassen neu
    // gezeichnet, ein natives dblclick kommt nie an (dieselbe Falle wie in der
    // Tempo-Spur, 08.09.2026 gemessen).
    const jetzt = Date.now();
    if (_gruppenLetzterDruck && _gruppenLetzterDruck.id === id && jetzt - _gruppenLetzterDruck.t < 350) {
      _gruppenLetzterDruck = null;
      try { (cb.onGruppeOeffnen || (() => {}))(id); } catch (e) { console.warn("onGruppeOeffnen:", e); }
      return true;
    }
    _gruppenLetzterDruck = { id, t: jetzt };
    // Die Kacheln liegen in Prozent des Marker-Behälters — daran rechnet sich
    // ein Pixel in Sekunden um (nicht an der Spur, die ist breiter).
    const mk = lane.querySelector(".lane-markers") || lane;
    const spurPx = mk.getBoundingClientRect().width || 1;
    const ges = _gruppenSekJeAnteil();
    const sekJePx = ges > 0 ? ges / spurPx / _viewZoom : 0;
    const laneH = lane.getBoundingClientRect().height || 30;
    _gruppenZieh = { id, art: rand ? "laenge" : "zeit", seite: rand ? rand.dataset.rand : null,
                     x0: ev.clientX, y0: ev.clientY, vonS0: +g.vonS || 0, sek0: +g.sek || 0,
                     el: k, links0: parseFloat(k.style.left) || 0, breite0: parseFloat(k.style.width) || 0,
                     bewegt: false, stapel: 0 };
    const bewegen = (e2) => {
      const z = _gruppenZieh; if (!z) return;
      const dx = e2.clientX - z.x0, dy = e2.clientY - z.y0;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) z.bewegt = true;
      const dS = sekJePx > 0 ? dx * sekJePx : 0;
      const dPct = dx / spurPx * 100;
      if (z.art === "zeit") {
        // nach oben/unten gezogen: Stapel — die Kachel bleibt stehen, die Zeile hebt sich ab
        const stufen = Math.round(dy / Math.max(20, laneH));
        z.stapel = Math.max(-1, Math.min(1, -stufen));
        if (z.stapel) {
          z.el.style.left = z.links0 + "%";
          z.el.classList.toggle("zieht-hoch", z.stapel > 0);
          z.el.classList.toggle("zieht-runter", z.stapel < 0);
          setStatusHint(z.stapel > 0 ? tlT("animator.gruppe.stapel_hoch", "Gruppe nach oben (Kamera-Vorrang)")
                                     : tlT("animator.gruppe.stapel_runter", "Gruppe nach unten"));
        } else {
          z.el.classList.remove("zieht-hoch", "zieht-runter");
          const neuS = Math.max(0, z.vonS0 + dS);
          z.el.style.left = Math.max(0, z.links0 + dPct) + "%";
          setStatusHint(`${tlT("animator.gruppe.ab", "ab")} ${neuS.toFixed(1)} s`);
        }
      } else {
        const neu = Math.max(0.3, z.seite === "l" ? z.sek0 - dS : z.sek0 + dS);
        if (z.seite === "l") {
          z.el.style.left = (z.links0 + dPct) + "%";
          z.el.style.width = Math.max(0.4, z.breite0 - dPct) + "%";
        } else {
          z.el.style.width = Math.max(0.4, z.breite0 + dPct) + "%";
        }
        setStatusHint(`${neu.toFixed(1)} s`);
      }
    };
    const hoch = (e2) => {
      document.removeEventListener("mousemove", bewegen, true);
      document.removeEventListener("mouseup", hoch, true);
      const z = _gruppenZieh; _gruppenZieh = null;
      setStatusHint(null);
      if (!z || !z.bewegt) { _gruppenAlleZeichnen(); return; }
      const dx = e2.clientX - z.x0;
      const dS = sekJePx > 0 ? dx * sekJePx : 0;
      try {
        if (z.art === "zeit" && z.stapel) (cb.onGruppenStapel || (() => {}))(z.id, z.stapel);
        else if (z.art === "zeit") (cb.onGruppeZiehen || (() => {}))(z.id, Math.max(0, z.vonS0 + dS), z.seite);
        else {
          const neu = Math.max(0.3, z.seite === "l" ? z.sek0 - dS : z.sek0 + dS);
          (cb.onGruppeLaenge || (() => {}))(z.id, neu, z.seite);
        }
      } catch (e) { console.warn("Gruppen-Geste:", e); }
      _gruppenAlleZeichnen();
    };
    document.addEventListener("mousemove", bewegen, true);
    document.addEventListener("mouseup", hoch, true);
    return true;
  }

  function setEtappen(liste) {
    _tempoEtappen = Array.isArray(liste) ? liste.slice() : [];
    const el = laneMarkersEl["tempo"];
    if (el) _tempoZeichnen(el);
  }
  /** Welche Etappe an dieser Stelle der Leiste läuft. */
  function _etappeBei(pos) {
    for (const e of _tempoEtappen) {
      if (pos >= e.von - 1e-6 && pos <= e.bis + 1e-6) return e;
    }
    return null;
  }

  function setTempo(liste, halte, kurve, hinweis) {
    _tempo = Array.isArray(liste) ? liste.slice() : [];
    _tempoHalte = Array.isArray(halte) ? halte.slice() : [];
    // Ein Hinweis sperrt die Spur: eine Reise bringt ihren eigenen Zeitplan mit,
    // eigene Halte hätten dort keine Wirkung — dann lieber gar nicht erst
    // anlegen lassen und sagen warum (Marc, 08.09.2026).
    _tempoHinweis = (typeof hinweis === "string" && hinweis) ? hinweis : null;
    // ⚠️ Auch OHNE Tabelle merken: bei einer Etappenfolge verteilt die Kurve
    // nichts (die Bahn ist schon gleichmäßig in Videozeit), die Sekunden für
    // die Beschriftung braucht die Spur trotzdem.
    _tempoKurve = kurve
      ? { dauer_s: +kurve.dauer_s || 0,
          anteile: (Array.isArray(kurve.anteile) && kurve.anteile.length > 1) ? kurve.anteile : null }
      : null;
    const el = laneMarkersEl["tempo"];
    if (el) _tempoZeichnen(el);
  }

  /* ── Videozeit statt Streckenanteil (08.09.2026) ────────────────────────
   * Die Leiste zeigt VIDEOZEIT. Ein Halt kostet Videozeit, ohne dass die
   * Strecke weiterläuft — als Punkt gezeichnet ist er deshalb eine Lüge:
   * ein Anlauf von 5 s in einem 22-s-Video ist knapp ein Viertel der Leiste.
   * `anteile` ist die Kurve aus core/tempo.py (Bild → Streckenanteil), also
   * genau die Umrechnung, die auch die Vorschau und der Render benutzen.
   * `_videoAusStrecke` ist ihre Umkehrung; auf einem Halt (Plateau) liefert
   * sie den ANFANG des Plateaus, `_videoAusStreckeEnde` das Ende. */
  function _videoAusStrecke(a, endeVomPlateau) {
    const m = _tempoKurve && _tempoKurve.anteile;
    if (!m || m.length < 2) return Math.max(0, Math.min(1, a));
    const n1 = m.length - 1;
    a = Math.max(0, Math.min(1, a));
    let lo = 0, hi = n1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (m[mid] < a) lo = mid + 1; else hi = mid; }
    if (endeVomPlateau) { while (lo < n1 && m[lo + 1] <= a + 1e-9) lo++; return lo / n1; }
    if (lo === 0) return 0;
    const y0 = m[lo - 1], y1 = m[lo];
    const f = (y1 - y0) > 1e-9 ? (a - y0) / (y1 - y0) : 0;
    return Math.max(0, Math.min(1, (lo - 1 + f) / n1));
  }
  /** Umgekehrt: Anteil der Anim-Phase → Streckenanteil. */
  function _streckeAusVideo(v) {
    const m = _tempoKurve && _tempoKurve.anteile;
    if (!m || m.length < 2) return v;
    const n1 = m.length - 1;
    const x = Math.max(0, Math.min(1, v)) * n1;
    const i = Math.min(n1 - 1, Math.floor(x));
    return m[i] + (m[i + 1] - m[i]) * (x - i);
  }
  /** Die Leistenstelle eines Halts: er belegt ab_s..bis_s der Anim-Phase. */
  function _haltSpanne(e) {
    const ti = _introFraction || 0.0, tf = _trackFraction || 1.0;
    if (e.gesperrt && e.rolle === "anlauf") return [0, ti];
    if (e.gesperrt && e.rolle === "nachlauf") return [tf, 1];
    const d = (_tempoKurve && _tempoKurve.dauer_s) || 0;
    const bei = Math.max(0, Math.min(1, +e.bei || 0));
    let v0 = null, v1 = null;
    if (d > 0) {
      // Der passende Halt aus der Kurve — gesucht über seine Stelle.
      let best = null, ab = 1e9;
      for (const h of _tempoHalte) {
        const dd = Math.abs((+h.bei || 0) - bei);
        if (dd < ab) { ab = dd; best = h; }
      }
      if (best && ab < 0.01 && best.ab_s != null && best.bis_s != null) {
        v0 = best.ab_s / d; v1 = best.bis_s / d;
      }
    }
    if (v0 == null) {                       // z. B. Etappen-Übergänge: nicht in der Kurve
      v0 = _videoAusStrecke(bei, false);
      v1 = v0 + (d > 0 ? (+e.sek || 0) / d : 0.01);
    }
    return [ti + Math.max(0, Math.min(1, v0)) * (tf - ti),
            ti + Math.max(0, Math.min(1, v1)) * (tf - ti)];
  }
  function _tempoMelden() {
    try { (cb.onTempoChange || (() => {}))(_tempo.slice()); } catch (e) { console.warn("onTempoChange:", e); }
    const el = laneMarkersEl["tempo"];
    if (el) _tempoZeichnen(el);
  }
  function _tempoSortiert() {
    return _tempo.slice().sort((a, b) => (a.art === "halt" ? a.bei : a.von) - (b.art === "halt" ? b.bei : b.von));
  }
  /** Grenzen, in die ein Abschnitt hineinpasst — Überlappen ist verboten. */
  function _tempoGrenzen(idx) {
    let links = 0, rechts = 1;
    _tempo.forEach((e, i) => {
      if (i === idx || e.art !== "tempo") return;
      if (e.bis <= (_tempo[idx].von ?? 0) + 1e-9) links = Math.max(links, e.bis);
      if (e.von >= (_tempo[idx].bis ?? 1) - 1e-9) rechts = Math.min(rechts, e.von);
    });
    return [links, rechts];
  }

  /** Wie lang das ganze Video ist — aus der Kurve und der Lage der Anim-Phase.
   *  Ohne Kurve bleibt es 0 und die Kacheln zeigen nur ihren Faktor. */
  function _tempoGesamtS() {
    const d = (_tempoKurve && _tempoKurve.dauer_s) || 0;
    const ti = _introFraction || 0.0, tf = _trackFraction || 1.0;
    const spanne = tf - ti;
    return (d > 0 && spanne > 0.001) ? d / spanne : 0;
  }

  /** Die Spur als lückenlose Folge von Kacheln — wie der Tempo-Editor in Final
   *  Cut über dem Clip (Marc, 09.09.2026: „durchgehend … dass man sieht, was wo
   *  liegt"). Jede Kachel weiß, was sie ist, wie lang sie dauert und ob man sie
   *  anfassen darf. Zwischen den Einträgen steht die Grundraffung mit 1,0×. */
  function _tempoKacheln() {
    const ti = _introFraction || 0.0, tf = _trackFraction || 1.0;
    const teile = [];
    for (const [i, e] of _tempo.entries()) {
      if (!e || typeof e !== "object") continue;
      if (e.art === "halt") {
        const [l, r] = _haltSpanne(e);
        teile.push({ von: l, bis: Math.max(l, r), art: "halt", idx: i,
                     gesperrt: !!e.gesperrt, sek: +e.sek || 0, titel: e.titel || "" });
      } else if (e.art === "tempo") {
        const von = Math.max(0, Math.min(1, +e.von || 0));
        const bis = Math.max(von, Math.min(1, +e.bis || 0));
        teile.push({ von: ti + _videoAusStrecke(von, false) * (tf - ti),
                     bis: ti + _videoAusStrecke(bis, true) * (tf - ti),
                     art: "tempo", idx: i, gesperrt: false, faktor: +e.faktor || 1 });
      }
    }
    // 09.09.2026 (Marc: „wenn ich eine Pause länger ziehe, wird der Block nicht
    // länger"): Die Lage der Halte kommt aus der Kurve, und die wird erst nach
    // dem Loslassen neu geholt — während des Ziehens stand der Block still und
    // nur die Zahl lief. Deshalb wächst der gezogene Halt hier sofort mit, und
    // alles rechts davon rückt so weit nach; die Kurve räumt danach auf.
    const z = _tempoZieh;
    const d = (_tempoKurve && _tempoKurve.dauer_s) || 0;
    if (z && z.art === "halt-dauer" && d > 0) {
      const halt = teile.find(t => t.idx === z.i);
      const sek = +(_tempo[z.i] || {}).sek || 0;
      if (halt) {
        const delta = (sek - (+z.sek0 || 0)) / d * (tf - ti);
        const bisAlt = halt.bis;
        halt.bis = Math.max(halt.von, Math.min(tf, halt.bis + delta));
        for (const t of teile) {
          if (t === halt || t.gesperrt || t.von < bisAlt - 1e-6) continue;
          t.von = Math.max(halt.bis, Math.min(tf, t.von + delta));
          t.bis = Math.max(t.von, Math.min(tf, t.bis + delta));
        }
      }
    }
    teile.sort((a, b) => a.von - b.von || a.bis - b.bis);
    // Lücken mit der Grundraffung füllen — so ist die Spur durchgehend belegt.
    const raus = [];
    let pos = 0;
    for (const t of teile) {
      if (t.von > pos + 0.004) raus.push({ von: pos, bis: t.von, art: "grund", faktor: 1 });
      raus.push(t);
      pos = Math.max(pos, t.bis);
    }
    if (pos < 0.996) raus.push({ von: pos, bis: 1, art: "grund", faktor: 1 });
    return raus;
  }

  function _tempoZeichnen(el) {
    el.innerHTML = "";
    const lane = el.closest('.timeline-lane[data-kind="tempo"]');
    if (_gruppenZeilen.length) {
      // §60: ab zwei Gruppen ist diese Spur die erste Gruppen-Zeile.
      if (lane) { lane.classList.add("ist-gruppen"); lane.classList.toggle("ist-gesperrt", !!_tempoHinweis); lane.title = _tempoHinweis || ""; }
      _gruppenAlleZeichnen();
      return;
    }
    if (lane) {
      lane.classList.remove("ist-gruppen");
      lane.classList.toggle("ist-gesperrt", !!_tempoHinweis);
      // ⚠️ Der Hinweis steht als Tooltip, NICHT als Text in der Spur: bei einer
      // Reise liegen dort vierzehn Übergangs-Bänder, und der Satz lief quer
      // darüber (08.09.2026 auf Marcs Rechner gesehen). Was die Reise kostet,
      // sagt die Bilanz unter der Spur.
      lane.title = _tempoHinweis || "";
    }
    // Wie breit die Spur wirklich ist — daran hängt, ob eine Beschriftung
    // hineinpasst. Ein 1-Sekunden-Übergang ist 25 px breit; „⏸ 1.0s" passt da
    // nicht und wurde zu „1.(".
    // Wie breit die Spur wirklich ist — daran hängt, ob eine Beschriftung
    // hineinpasst. Ein 1-Sekunden-Übergang ist 25 px breit; „⏸ 1.0s" passt da
    // nicht und wurde zu „1.(".
    const breitePx = el.getBoundingClientRect().width || 1000;
    const gesamtS = _tempoGesamtS();
    const sek = (t) => gesamtS > 0 ? (t.bis - t.von) * gesamtS : 0;
    const zahl = (v) => (Math.round(v * 10) / 10).toLocaleString(undefined,
      { minimumFractionDigits: 1, maximumFractionDigits: 1 });

    for (const t of _tempoKacheln()) {
      const l = _anchorToPct(t.von), r = _anchorToPct(t.bis);
      const breite = Math.max(0.4, r - l);
      const wPx = breite / 100 * breitePx;
      const d = t.sek != null ? +t.sek : sek(t);
      const dauerTxt = d > 0 ? zahl(d) + " s" : "";
      const el2 = document.createElement(t.art === "grund" ? "div" : "button");
      if (t.art !== "grund") el2.type = "button";
      el2.style.left = l + "%";
      el2.style.width = breite + "%";
      if (t.idx != null) el2.dataset.idx = String(t.idx);

      if (t.art === "halt") {
        el2.className = "tl-tempo-kachel tl-tempo-halt" + (t.gesperrt ? " ist-gesperrt" : "");
        el2.title = `${t.titel || tlT("animator.tempo.halt", "Halt")} ${zahl(d)} s`
          + (t.gesperrt ? " · " + tlT("animator.tempo.gesperrt", "kommt aus einer anderen Einstellung") : "");
        el2.innerHTML = (wPx >= 14 ? `<span class="tl-tempo-pause">⏸</span>` : "")
          + (wPx >= 46 ? `<span class="tl-tempo-sek">${dauerTxt}</span>` : "")
          // Eigene Halte lassen sich an den Rändern länger und kürzer ziehen
          // (Marc, 09.09.2026: „die Pausenblöcke kann ich nicht anfassen").
          + (t.gesperrt ? "" : `<span class="tl-tempo-rand" data-rand="l"></span>`
                             + `<span class="tl-tempo-rand" data-rand="r"></span>`);
      } else {
        const f = t.art === "tempo" ? (+t.faktor || 1) : 1;
        const fTxt = zahl(f) + "×";
        el2.className = t.art === "tempo" ? "tl-tempo-kachel tl-tempo-block"
                                          : "tl-tempo-kachel tl-tempo-grund";
        // Bei mehreren Etappen trägt die Grund-Kachel den NAMEN der Etappe, die
        // dort läuft — sie ist genau deren Platz auf der Leiste.
        const et = t.art === "grund" ? _etappeBei((t.von + t.bis) / 2) : null;
        if (et && et.farbe) el2.style.borderLeft = `3px solid ${et.farbe}`;
        el2.title = t.art === "tempo"
          ? `${fTxt} ${tlT("animator.tempo.gegen", "gegen die Grundraffung")}` + (dauerTxt ? ` · ${dauerTxt}` : "")
          : (et ? (et.voll || et.name) + (dauerTxt ? ` · ${dauerTxt}` : "")
                : tlT("animator.tempo.grund", "Grundraffung") + (dauerTxt ? ` · ${dauerTxt}` : ""));
        // „1,0× 3,4 s" — Faktor UND Dauer, damit man sieht, was wo liegt.
        let txt = wPx >= 68 ? `${fTxt} ${dauerTxt}` : (wPx >= 30 ? fTxt : "");
        if (et) {
          el2.classList.add("hat-etappe");
          txt = wPx >= 44 ? et.name : "";
        }
        el2.innerHTML = (t.art === "tempo" ? `<span class="tl-tempo-rand" data-rand="l"></span>` : "")
          + (txt ? `<span class="tl-tempo-text">${txt}</span>` : "")
          + (t.art === "tempo" ? `<span class="tl-tempo-rand" data-rand="r"></span>` : "");
      }
      el.appendChild(el2);
    }
  }

  /** Zeigerstelle → Streckenanteil. Die Leiste läuft in Videozeit, die
   *  Einträge hängen an der Strecke — dazwischen steht die Kurve. Ohne diese
   *  Umrechnung greift man neben dem, was man sieht, sobald Halte im Spiel
   *  sind (Marc, 08.09.2026).
   *  ⚠️ Geklemmt: die Spur ist schmaler als die Zeitachse (Beschriftungsspalte),
   *  ohne das entstand beim Klick am rechten Rand ein Halt bei 1,08. */
  function _tempoStelle(clientX) {
    const v = Math.max(0, Math.min(1, _barToTrack(anchorFromClientX(clientX))));
    return Math.max(0, Math.min(1, _streckeAusVideo(v)));
  }

  /** Einen Halt an einer Streckenstelle anlegen (Doppelklick, Menü). */
  function _tempoHaltAnlegen(stelle) {
    if (_tempoHinweis) return;
    _tempo.push({ art: "halt", bei: Math.max(0, Math.min(1, stelle)), sek: 2.0, kamera: "nichts" });
    _tempoMelden();
  }
  /** Einen Abschnitt (0,5×) ab einer Streckenstelle anlegen — ein Zehntel der
   *  Strecke, bis zum nächsten Eintrag gekürzt. Danach lässt er sich ziehen. */
  function _tempoAbschnittAnlegen(stelle) {
    if (_tempoHinweis) return;
    const von = Math.max(0, Math.min(0.99, stelle));
    _tempo.push({ art: "tempo", von, bis: Math.min(1, von + 0.1), faktor: 0.5 });
    const i = _tempo.length - 1, e = _tempo[i];
    const [lo, hi] = _tempoGrenzen(i);
    e.von = Math.max(lo, e.von); e.bis = Math.min(hi, e.bis);
    if (e.bis - e.von < 0.005) { _tempo.splice(i, 1); return; }
    _tempoMelden();
  }
  /** Das Rechtsklick-Menü der Tempo-Spur (09.09.2026, Marc: „generell müsste
   *  da in der Timeline Rechtsklick gehen, dass ich so was wieder rausnehme"). */
  function _tempoMenue(ev, lane) {
    if (_tempoHinweis) return;
    const el = ev.target.closest(".tl-tempo-halt, .tl-tempo-block");
    const i = el ? +el.dataset.idx : -1;
    const e = i >= 0 ? _tempo[i] : null;
    if (e && !e.gesperrt) {
      _menueZeigen(ev, [
        { text: tlT("animator.tempo.menu_oeffnen", "Öffnen …"),
          tun: () => { try { (cb.onTempoOeffnen || (() => {}))(i, e); } catch (err) { console.warn("onTempoOeffnen:", err); } } },
        { text: tlT("animator.tempo.menu_loeschen", "Löschen"), gefaehrlich: true,
          tun: () => { _tempo.splice(i, 1); _tempoMelden(); } },
      ]);
      return;
    }
    if (e && e.gesperrt) return;                       // Anlauf, Nachlauf, Übergänge: nur ansehen
    const stelle = _tempoStelle(ev.clientX);
    _menueZeigen(ev, [
      { text: tlT("animator.tempo.menu_halt", "Halt hier (2 s)"), tun: () => _tempoHaltAnlegen(stelle) },
      { text: tlT("animator.tempo.menu_abschnitt", "Langsamer Abschnitt hier (0,5×)"), tun: () => _tempoAbschnittAnlegen(stelle) },
    ]);
  }
  /** Ein kleines Menü an der Maus; schließt bei Klick daneben, Escape, Scrollen. */
  let _menueEl = null;
  function _menueSchliessen() {
    if (_menueEl) { _menueEl.remove(); _menueEl = null; }
    document.removeEventListener("mousedown", _menueAussen, true);
    document.removeEventListener("keydown", _menueTaste, true);
    document.removeEventListener("scroll", _menueSchliessen, true);
  }
  function _menueAussen(ev) { if (_menueEl && !_menueEl.contains(ev.target)) _menueSchliessen(); }
  function _menueTaste(ev) { if (ev.key === "Escape") { ev.preventDefault(); _menueSchliessen(); } }
  function _menueZeigen(ev, eintraege) {
    _menueSchliessen();
    if (!eintraege || !eintraege.length) return;
    const m = document.createElement("div");
    m.className = "tl-menue";
    m.setAttribute("role", "menu");
    for (const e of eintraege) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "tl-menue-eintrag" + (e.gefaehrlich ? " ist-gefaehrlich" : "");
      b.setAttribute("role", "menuitem");
      b.textContent = e.text;
      b.addEventListener("mousedown", (x) => x.stopPropagation());
      b.addEventListener("click", (x) => { x.preventDefault(); x.stopPropagation(); _menueSchliessen(); try { e.tun(); } catch (err) { console.warn("Menü:", err); } });
      m.appendChild(b);
    }
    document.body.appendChild(m);
    // Erst messen, dann setzen — das Menü bleibt im Fenster.
    const w = m.offsetWidth || 180, h = m.offsetHeight || 60;
    m.style.left = Math.max(4, Math.min(window.innerWidth - w - 4, ev.clientX)) + "px";
    m.style.top = Math.max(4, Math.min(window.innerHeight - h - 4, ev.clientY)) + "px";
    _menueEl = m;
    setTimeout(() => {
      document.addEventListener("mousedown", _menueAussen, true);
      document.addEventListener("keydown", _menueTaste, true);
      document.addEventListener("scroll", _menueSchliessen, true);
    }, 0);
  }

  function _tempoBinden() {
    const lane = host.querySelector('.timeline-lane[data-kind="tempo"] .lane-track');
    if (!lane) return;
    lane.addEventListener("mousedown", (ev) => {
      if (_gruppenZeilen.length) { _gruppenMausDruck(ev, lane, 0); return; }   // §60: Gruppen-Zeile
      if (_tempoHinweis) return;                 // gesperrte Spur: nur ansehen
      const halt = ev.target.closest(".tl-tempo-halt");
      const block = ev.target.closest(".tl-tempo-block");
      const rand = ev.target.closest(".tl-tempo-rand");
      // ⚠️ Klemmen: die Spur ist schmaler als die Zeitachse (Beschriftungsspalte),
      // ohne das entstand beim Klick am rechten Rand ein Halt bei 1,08 — außerhalb
      // der Strecke (08.09.2026 im Prüfstand gemessen).
      const start = _tempoStelle(ev.clientX);
      // ⚠️ Doppelklick selbst erkennen: nach jedem Loslassen wird die Spur neu
      // gezeichnet, das angeklickte Element ist dann ein anderes — und der
      // Browser feuert kein `dblclick` mehr (08.09.2026 im Prüfstand gemessen:
      // der Editor ging nie auf). Zwei Drücker auf denselben Eintrag innerhalb
      // von 350 ms sind ein Doppelklick.
      const zielIdx = (halt || block) ? +(halt || block).dataset.idx : -1;
      const jetzt = Date.now();
      if (zielIdx >= 0 && _tempoLetzterDruck && _tempoLetzterDruck.i === zielIdx
          && jetzt - _tempoLetzterDruck.t < 350) {
        _tempoLetzterDruck = null;
        const e = _tempo[zielIdx];
        if (e && !e.gesperrt) {
          ev.preventDefault();
          try { (cb.onTempoOeffnen || (() => {}))(zielIdx, e); }
          catch (err) { console.warn("onTempoOeffnen:", err); }
        }
        return;
      }
      // 09.09.2026 (Marc: „ein Klick macht direkt eine Zwei-Sekunden-Pause,
      // sonst hat man ständig Pausen"): Ein Klick auf leere Fläche setzt nur
      // noch den Scrubber. Einen Halt legt der DOPPELKLICK auf leere Fläche an
      // (oder das Rechtsklick-Menü); Ziehen bleibt der Abschnitt.
      if (zielIdx < 0 && !halt && !block && !rand && _tempoLetzterDruck && _tempoLetzterDruck.i === -1
          && jetzt - _tempoLetzterDruck.t < 350 && Math.abs(_tempoLetzterDruck.x - ev.clientX) < 6) {
        _tempoLetzterDruck = null;
        ev.preventDefault();
        _tempoHaltAnlegen(start);
        return;
      }
      _tempoLetzterDruck = zielIdx >= 0 ? { i: zielIdx, t: jetzt } : { i: -1, t: jetzt, x: ev.clientX };
      if (rand && halt) {
        // 09.09.2026 (Marc: „die Pausenblöcke kann ich aktuell nicht anfassen
        // und länger oder kürzer ziehen"): Ein Halt hat jetzt zwei Anfasser.
        // Gezogen wird seine DAUER — links wie rechts, die Stelle im Track
        // bleibt, weil ein Halt dort ohnehin nur Zeit einfügt.
        const i = +halt.dataset.idx;
        if (_tempo[i] && _tempo[i].gesperrt) return;
        _tempoZieh = { art: "halt-dauer", i, seite: rand.dataset.rand,
                       x0: ev.clientX, sek0: +_tempo[i].sek || 0 };
      } else if (halt) {
        const i = +halt.dataset.idx;
        if (_tempo[i] && _tempo[i].gesperrt) return;      // Etappen-Halte nicht verschieben
        _tempoZieh = { art: "halt-schieben", i, start };
      } else if (rand && block) {
        _tempoZieh = { art: "rand", i: +block.dataset.idx, seite: rand.dataset.rand };
      } else if (block) {
        const i = +block.dataset.idx;
        _tempoZieh = { art: "block-schieben", i, start,
                       von0: _tempo[i].von, bis0: _tempo[i].bis };
      } else {
        // Leere Fläche: neuen Abschnitt aufziehen
        _tempo.push({ art: "tempo", von: start, bis: start, faktor: 0.5 });
        _tempoZieh = { art: "neu", i: _tempo.length - 1, start, clientX: ev.clientX };
      }
      ev.preventDefault();
      const bewegen = (e2) => {
        const a = _tempoStelle(e2.clientX);
        const z = _tempoZieh; if (!z) return;
        const e = _tempo[z.i]; if (!e) return;
        if (z.art === "halt-dauer") {
          // Pixel → Sekunden: die Spur zeigt Videozeit, ihre ganze Breite ist
          // die Gesamtlänge des Videos.
          const spur = lane.getBoundingClientRect().width || 1;
          const ges = _tempoGesamtS();
          const dx = (e2.clientX - z.x0) * (z.seite === "l" ? -1 : 1);
          const dS = ges > 0 ? dx / spur * ges : dx / 40;
          e.sek = Math.max(0.2, Math.round((z.sek0 + dS) * 10) / 10);
          // Die Statuszeile zeigt beim Ziehen den laufenden Wert — sonst zieht
          // man blind (dieselbe Regel wie beim Wert-Ziehen, v0.9.512).
          setStatusHint(`${tlT("animator.tempo.halt", "Halt")} ${e.sek.toFixed(1)} s`);
        }
        else if (z.art === "halt-schieben") { e.bei = a; }
        else if (z.art === "neu") { e.von = Math.min(z.start, a); e.bis = Math.max(z.start, a); }
        else if (z.art === "rand") {
          if (z.seite === "l") e.von = Math.min(a, e.bis - 0.005);
          else e.bis = Math.max(a, e.von + 0.005);
          const [lo, hi] = _tempoGrenzen(z.i);
          e.von = Math.max(lo, e.von); e.bis = Math.min(hi, e.bis);
        } else if (z.art === "block-schieben") {
          const d = a - z.start;
          const br = z.bis0 - z.von0;
          const [lo, hi] = _tempoGrenzen(z.i);
          let v = Math.max(lo, Math.min(hi - br, z.von0 + d));
          e.von = v; e.bis = v + br;
        }
        _tempoZeichnen(laneMarkersEl["tempo"]);
      };
      const hoch = () => {
        document.removeEventListener("mousemove", bewegen, true);
        document.removeEventListener("mouseup", hoch, true);
        const z = _tempoZieh; _tempoZieh = null;
        setStatusHint(null);
        if (z && z.art === "neu") {
          const e = _tempo[z.i];
          // Ein Klick ohne Ziehen ist kein Abschnitt — und seit 09.09.2026
          // auch kein Halt mehr: er setzt den Scrubber an diese Stelle.
          if (e && (e.bis - e.von) < 0.01) {
            _tempo.splice(z.i, 1);
            _tempoZeichnen(laneMarkersEl["tempo"]);
            const anker = anchorFromClientX(z.clientX);
            setScrubberVisual(anker);
            try { if (cb.onScrub) cb.onScrub(anker); if (cb.onScrubEnd) cb.onScrubEnd(_barToTrack(anker)); }
            catch (err) { console.warn("scrub:", err); }
            return;
          }
        }
        _tempoMelden();
      };
      document.addEventListener("mousemove", bewegen, true);
      document.addEventListener("mouseup", hoch, true);
    });
    lane.addEventListener("contextmenu", (ev) => {
      const k = ev.target.closest(".tl-gruppe");
      if (k) { ev.preventDefault(); _gruppenMenue(ev, k.dataset.id); return; }
      if (_gruppenZeilen.length) return;
      ev.preventDefault();
      _tempoMenue(ev, lane);
    });
    lane.addEventListener("dblclick", (ev) => {
      const el = ev.target.closest(".tl-tempo-halt, .tl-tempo-block");
      if (!el) return;
      ev.preventDefault();
      const i = +el.dataset.idx;
      const e = _tempo[i];
      if (!e || e.gesperrt) return;
      try { (cb.onTempoOeffnen || (() => {}))(i, e); } catch (err) { console.warn("onTempoOeffnen:", err); }
    });
  }

  function setStatusHint(txt) { _statusHint = txt || null; updateStatusLabel(); }
  function updateStatusLabel() {
    if (!statusEl) return;
    if (_statusHint) { statusEl.textContent = _statusHint; return; }
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
    // 05.09.2026 (Beta-Tester, Windows: „die Griffe liegen übereinander"): Am Rand
    // (Start = 0 %, Ende = 100 %) ist der Griff-Körper nur ein zweiter Strich neben
    // Intro-Linie und Scrubber — dann bleibt allein die Fahne unter der Leiste.
    if (trimHandleStartEl) trimHandleStartEl.classList.toggle("is-rand", sPct <= 0.05);
    if (trimHandleEndEl)   trimHandleEndEl.classList.toggle("is-rand", ePct >= 99.95);
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
      // v0.9.276 (Nutzer) — KEIN `if (!_enabled) return` mehr: der Trim (Render-Bereich)
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
        m.style.left = _anchorToPct(_trackToBar(c.anchor || 0)) + "%";
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
        const targetSmooth = !!(b.events.find(e => e && e.smooth_in) || {}).smooth_in;
        const midAnchor = (a.anchor + b.anchor) / 2;
        // Platzprüfung — 27.08.2026 deutlich gelockert.
        //
        // Vorgeschichte: Am 16.08. meldete ein Beta-Tester, dass der
        // Übergangs-Knopf bei Zeitleisten-Zoom 1× den Keyframe-Knopf verdeckt.
        // Die damalige Lösung war, ihn bei Enge WEGZULASSEN (Grenze 46 px) —
        // sein Einwand jetzt: dann muss man zum Ändern trotzdem hineinzoomen.
        // Seit heute sitzen die Reiter ÜBER der Keyframe-Reihe (CSS
        // `.timeline-cluster-row`), überdecken also nichts mehr. Die Grenze
        // schützt nur noch die Reiter voreinander: Sie sind 18 px breit, unter
        // 20 px Abstand würden sie sich gegenseitig überlagern.
        const breitePx = (trackEl.getBoundingClientRect().width || 0) * _viewZoom;
        const abstandPx = Math.abs(_trackToBar(b.anchor) - _trackToBar(a.anchor)) * breitePx;
        if (abstandPx < 20) continue;
        const sym = document.createElement("button");
        sym.type = "button";
        sym.className = "timeline-easing-symbol easing-" + targetEasing + (targetSmooth ? " is-smooth" : "");
        sym.style.left = _anchorToPct(_trackToBar(midAnchor)) + "%";
        sym.dataset.targetAnchor = String(b.anchor);
        sym.dataset.easing = targetEasing;
        sym.title = `${tlT("animator.timeline.easing.tip", "Übergang")}: ${_easingLabel(targetEasing)}\n${tlT("animator.timeline.easing.click", "Klicken zum Ändern.")}`;
        sym.innerHTML = _easingGlyph(targetEasing) + (targetSmooth ? '<span class="timeline-easing-smooth-badge" aria-hidden="true">🎥</span>' : "");
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
          _openEasingModal(_easeAnchor, _curEase, targetSmooth);
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
      if (L.kind === "tempo") { _tempoZeichnen(el); continue; }
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
        m.style.left = _anchorToPct(_trackToBar(item.anchor || 0)) + "%";
        m.dataset.kind = L.kind;
        m.dataset.anchor = String(item.anchor || 0);
        m.title = `${L.label} @ ${((item.anchor || 0) * 100).toFixed(0)}%\n\n`
                + tlT("animator.timeline.marker.tip", "Klick: auswählen · Rechtsklick: löschen · Drag: verschieben")
                + (WERT_LANES.includes(L.kind)
                    ? "\n" + tlT("animator.timeline.marker.tip_value",
                                 "Option + ziehen: Wert ändern (Shift = fein)")
                    : "");
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
    // v0.9.512 — Alt/Option auf einem WERT-Marker: ziehen ändert den WERT
    // statt die Position (Marc-Wunsch 2026-08-14: „wenn ich dann option
    // festhalte, will ich durch verschieben der maus die werte der rotation
    // ändern, statt den keyframe zu verschieben").
    // ⚠️ Auf dem CLUSTER bleibt Alt das Duplizieren aus v0.9.505 — dort gibt
    // es keinen einzelnen Wert, und das Kopieren eines ganzen Keyframes ist
    // die häufigere Geste. Die „Karte"-Lane fehlt bewusst: ein Kartenmittel-
    // punkt ist kein Zahlenwert, den man am Pixel aufziehen kann.
    if (e.altKey && WERT_LANES.includes(kind)) {
      _dragging = { type: "value", kind, anchor,
                    startX: e.clientX, startY: e.clientY, moved: false };
      if (cb.onValueDragStart) cb.onValueDragStart({ kind, anchor });
      return;
    }
    // v0.9.505 — Alt/Option beim Anfassen = duplizieren statt verschieben
    // (das Idiom aus Premiere, Final Cut, After Effects). `startAnchor` bleibt
    // dabei stehen: `anchor` wandert während des Ziehens mit, wir brauchen aber
    // am Ende noch die Stelle, VON der kopiert wird.
    _dragging = { type: "marker", kind, anchor, startAnchor: anchor,
                  moved: false, kopieren: !!e.altKey };
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
    // Die Tempo-Spur hat ihre eigene Bedienung — hier würde sonst zusätzlich
    // ein Keyframe entstehen (08.09.2026).
    if (e.target.closest('.timeline-lane[data-kind="tempo"]')) return;
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
    // v0.9.511 — die Maus zeigt auf eine Stelle der LEISTE, gespeichert wird
    // die Stelle im TRACK.
    const anchor = _barToTrack(anchorFromClientX(e.clientX));
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
  _win("mousemove", (e) => {
    if (!_dragging || !_enabled) return;
    // v0.9.512 — Wert-Ziehen rechnet in PIXELN, nicht in Ankern.
    if (_dragging.type === "value") {
      _dragging.moved = true;
      if (cb.onValueDrag) {
        cb.onValueDrag({
          kind: _dragging.kind, anchor: _dragging.anchor,
          dx: e.clientX - _dragging.startX,
          dy: _dragging.startY - e.clientY,      // nach oben = mehr
          fein: !!e.shiftKey,
        });
      }
      return;
    }
    const barPos = anchorFromClientX(e.clientX);
    // Der Scrubber lebt auf der Leiste, ein Keyframe im Track (v0.9.511).
    const anchor = _dragging.type === "marker" ? _barToTrack(barPos) : barPos;
    if (_dragging.type === "scrubber") {
      setScrubberVisual(anchor);
      if (cb.onScrub) cb.onScrub(anchor);
    } else if (_dragging.type === "marker") {
      _dragging.moved = true;
      // v0.9.3: nur DIESEN einen Event bewegen (kind+oldAnchor identifiziert ihn).
      // v0.9.4: bei kind="__cluster" bewegt der Caller (module.js) alle 4
      //         Properties am Anker zusammen.
      // v0.9.505: beim Duplizieren bleibt das Original, wo es ist — hier wird
      // also NICHTS gespeichert. Der Marker wandert nur als Vorschau mit; beim
      // Loslassen stellt `refresh()` ihn zurück und die Kopie entsteht.
      if (!_dragging.kopieren && cb.onAnchorChange) {
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
        m.style.left = _anchorToPct(_trackToBar(anchor)) + "%";
        m.dataset.anchor = String(anchor);
        if (_dragging.kopieren) m.classList.add("is-copying");
      });
      _dragging.anchor = anchor;
      // Beim Duplizieren die Auswahl NICHT mitziehen — sie gehört noch dem
      // Original, bis die Kopie wirklich existiert.
      if (!_dragging.kopieren) _selectedEvent = { kind: _dragging.kind, anchor };
    }
  });
  _win("mouseup", () => {
    if (_dragging) {
      // Nach Drag-Ende einmal refresh, damit Marker-Reihenfolge + tooltips
      // konsistent sind. Bei Scrubber-Drag-Ende informieren wir den Caller,
      // damit der die volle Track-Linie wiederherstellen kann.
      const wasScrubber = _dragging.type === "scrubber";
      const kopie = (_dragging.type === "marker" && _dragging.kopieren
                     && _dragging.moved) ? _dragging : null;
      const wertZug = _dragging.type === "value" ? _dragging : null;   // v0.9.512
      _dragging = null;
      if (wertZug) {
        if (cb.onValueDragEnd) cb.onValueDragEnd({ kind: wertZug.kind, anchor: wertZug.anchor,
                                                   geaendert: !!wertZug.moved });
        refresh();
        return;
      }
      refresh();   // stellt das Original zurück — es wurde nie bewegt
      if (kopie && cb.onEventCopy) {
        cb.onEventCopy({ kind: kopie.kind, anchor: kopie.startAnchor },
                       kopie.anchor);
      }
      if (wasScrubber && cb.onScrubEnd) cb.onScrubEnd(_barToTrack(_scrubAnchor));
    }
  });

  // Action-Buttons
  btnSnap.addEventListener("click", () => {
    if (!_enabled || !cb.onSnapshot) return;
    // ⚠️ v0.9.511 — `_scrubAnchor` ist eine LEISTEN-Position; ein Keyframe
    // speichert einen TRACK-Anker. Ohne Umrechnung landete der Keyframe um
    // genau die Hold-Stauchung neben dem Scrubber (Marc: „wenn Du hier
    // Keyframe klickst, dann erscheint der nicht an der Stelle, wo der
    // Scrubber steht").
    cb.onSnapshot(_barToTrack(_scrubAnchor));
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
    // ⚠️ v0.9.511 — und die Keyframe-Marker ebenso: seit sie über `_trackToBar`
    // gezeichnet werden, hängt ihre Pixelposition an tf/ti. Vorher saßen sie
    // auf ihrem rohen Anker und überlebten eine Phasen-Änderung unbeschadet;
    // ohne dieses `refresh()` blieben sie stehen, während Griffe und Scrubber
    // wanderten — ein frisch gesetzter Keyframe erschien dann sichtbar neben
    // dem Scrubber, obwohl sein Anker exakt stimmte (Marc, 2026-08-14).
    try { refresh(); } catch (_) {}
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
    _win("mousemove", (e) => {
      if (!_sbDrag) return;
      const dx = e.clientX - _sbDrag.startX;
      const dxFrac = dx / Math.max(1, _sbDrag.trackWidth);
      _viewOffset = _clampViewOffset(_sbDrag.startOffset + dxFrac);
      refresh();
      setScrubberVisual(_scrubAnchor);
      setTrimVisual(_trimStart, _trimEnd);
      _updateScrollbar();
    });
    _win("mouseup", () => {
      if (_sbDrag) { _sbDrag = null; document.body.style.cursor = ""; }
    });
  }

  // v0.9.505 — ⌘C / ⌘V für Keyframes. Für weite Wege auf der Zeitleiste, wo
  // Ziehen unpraktisch ist: Marker auswählen, kopieren, Abspielkopf setzen,
  // einfügen.
  //
  // ⚠️ Nur zugreifen, wenn die Zeitleiste wirklich aktiv ist UND der Fokus
  // nicht in einem Eingabefeld steht — sonst klaut das Werkzeug dem Nutzer das
  // normale Kopieren von Text. Aus demselben Grund `capture: false`: Felder
  // dürfen zuerst.
  _win("keydown", (e) => {
    if (!_enabled) return;
    if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
    const k = (e.key || "").toLowerCase();
    if (k !== "c" && k !== "v") return;
    const a = document.activeElement;
    if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA"
              || a.isContentEditable)) return;
    // Nur reagieren, wenn die Zeitleiste sichtbar ist — der Nutzer könnte in
    // einem ganz anderen Modul sein, während der Animator im Hintergrund lebt.
    if (!host || !host.offsetParent) return;
    if (k === "c") {
      if (!_selectedEvent || !cb.onEventClipboardCopy) return;
      e.preventDefault();
      cb.onEventClipboardCopy(_selectedEvent);
    } else {
      if (!cb.onEventClipboardPaste) return;
      e.preventDefault();
      cb.onEventClipboardPaste(_barToTrack(_scrubAnchor));   // v0.9.511: Track-Anker
    }
  });

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
  _win("mousemove", (e) => {
    if (!_panDrag) return;
    const dx = e.clientX - _panDrag.startX;
    const dxFrac = dx / Math.max(1, _panDrag.width);
    _viewOffset = _clampViewOffset(_panDrag.startOffset - dxFrac * _viewWindow());
    refresh();
    setScrubberVisual(_scrubAnchor);
    setTrimVisual(_trimStart, _trimEnd);
    _updateScrollbar();
  });
  _win("mouseup", () => { _panDrag = null; });

  _updateZoomLabel();
  _updateScrollbar();

  // Initial render
  _tempoBinden();   // 08.09.2026 — Bedienung der Tempo-Spur
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

  // v0.9.511 — Umrechnung nach außen geben. Wer einen Keyframe, ein Schild
  // oder einen Foto-Pin anfasst, arbeitet mit TRACK-Ankern; wer den Scrubber
  // oder die Zeit meint, mit LEISTEN-Positionen.
  // ⚠️ `getScrubber`/`setScrubber` sprechen seit v0.9.511 in TRACK-Ankern —
  // dieselbe Größe wie Keyframes, Schilder, Foto-Pins und die Trim-Griffe.
  // Das ist die Größe, die fast jeder Aufrufer meint. Wer wirklich die
  // Position auf der LEISTE braucht (Zeit, inkl. Intro und Hold), nimmt
  // ausdrücklich `getScrubberBar`/`setScrubberBar`: das sind der Probe-Lauf,
  // der Schnappschuss (er braucht die Sekunde) und der Zwischenspeicher
  // beim Modul-Wechsel.
  function getScrubberTrack() { return _barToTrack(_scrubAnchor); }
  function setScrubberTrack(a) { setScrubberVisual(_trackToBar(a)); }

  return {
    destroy: () => { for (const [ev, fn] of _winListeners.splice(0)) { try { window.removeEventListener(ev, fn); } catch (_) {} } },
    setEtappen,
    trackToBar: _trackToBar,
    barToTrack: _barToTrack,
    getScrubberTrack,
    setStatusHint,
    setScrubberTrack,
    refresh,
    setScrubber: setScrubberTrack,
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
    getScrubber: getScrubberTrack,
    getScrubberBar: () => _scrubAnchor,
    setScrubberBar: setScrubberVisual,
    updateStatusLabel,
    setTempo,
    getTempo: () => _tempo.slice(),
    getScrubAnchor: () => _scrubAnchor,
    setGruppen,
    getGruppen: () => _gruppenZeilen.map(z => z.slice()),
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
