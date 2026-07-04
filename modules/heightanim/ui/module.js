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
    name: "Höhen-Animator",
    description: "Höhenprofil als Video",
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
        <section class="section" data-accordion-section="general">
          <button class="section-collapse-header" type="button">
            <span>${t("heightanim.section.general", "Allgemein")}</span>
            <span class="collapse-arrow">▸</span>
          </button>
          <div class="section-collapse-body" hidden>
            <div class="muted" style="font-size:12px; line-height:1.45; margin-bottom:10px;">
              ${t("heightanim.intro", "Erstellt ein Video das die Höhenprofil-Kurve deines Tracks live aufbaut. Aktuell ist die Vorschau live verfügbar — der Video-Render kommt in einer der nächsten Versionen.")}
            </div>
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
            <span>${t("heightanim.section.style", "Optik")}</span>
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
            <label class="checkbox-row">
              <input type="checkbox" id="height-grid" checked>
              <span>${t("heightanim.field.grid", "Hilfsgitter zeigen")}</span>
            </label>
            <label class="checkbox-row">
              <input type="checkbox" id="height-axes" checked>
              <span>${t("heightanim.field.axes", "Achsen-Beschriftung zeigen")}</span>
            </label>
            <label class="checkbox-row">
              <input type="checkbox" id="height-marker" checked>
              <span>${t("heightanim.field.marker", "Marker zeigen")}</span>
            </label>
          </div>
        </section>

        <section class="section" data-accordion-section="render">
          <button class="section-collapse-header" type="button">
            <span>${t("heightanim.section.render", "Rendern")}</span>
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
            <div class="render-done" id="height-done" style="display:none; margin-top:12px; padding:10px; background:rgba(80,200,120,0.10); border-left:3px solid #50c878; border-radius:4px;">
              <p style="font-size:12px; margin:0 0 8px 0;">${t("heightanim.done.label", "Video fertig.")}</p>
              <button type="button" id="height-open-folder" class="btn btn-secondary" style="width:100%; font-size:12px;">
                ${t("animator.btn.reveal_in_finder", "Im Finder zeigen")}
              </button>
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
          ${t("heightanim.empty_hint", "Lade einen GPX-Track um das Höhenprofil zu sehen.")}
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

  // Trim aus Project-Settings laden (falls vorhanden)
  try {
    const proj = (typeof window.getActiveProject === "function") ? window.getActiveProject() : null;
    const ha = proj?.heightanim || {};
    if (typeof ha.trim_start === "number") _trimStart = Math.max(0, Math.min(1, ha.trim_start));
    if (typeof ha.trim_end   === "number") _trimEnd   = Math.max(0, Math.min(1, ha.trim_end));
    if (_trimEnd <= _trimStart) { _trimStart = 0; _trimEnd = 1; }
  } catch (_) {}

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
    const showMarker = document.getElementById("height-marker")?.checked !== false;

    // Background
    const bgRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bgRect.setAttribute("x", "0"); bgRect.setAttribute("y", "0");
    bgRect.setAttribute("width", w); bgRect.setAttribute("height", h);
    bgRect.setAttribute("fill", bg);
    svg.appendChild(bgRect);

    // Padding (etwas mehr Boden weil unter dem Plot die Anim-Bar liegt)
    const padL = 60, padR = 30, padT = 40, padB = showAxes ? 50 : 20;
    const plotW = Math.max(20, w - padL - padR);
    const plotH = Math.max(20, h - padT - padB);

    const elevs = _currentData.elevations;
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

    // Hilfsgitter
    if (showGrid) {
      const gridColor = "#3a3a3a";
      for (let i = 0; i <= 5; i++) {
        const y = padT + (i / 5) * plotH;
        const ln = document.createElementNS("http://www.w3.org/2000/svg", "line");
        ln.setAttribute("x1", padL); ln.setAttribute("x2", padL + plotW);
        ln.setAttribute("y1", y); ln.setAttribute("y2", y);
        ln.setAttribute("stroke", gridColor); ln.setAttribute("stroke-width", "1");
        ln.setAttribute("opacity", "0.4");
        svg.appendChild(ln);
      }
      for (let i = 0; i <= 6; i++) {
        const x = padL + (i / 6) * plotW;
        const ln = document.createElementNS("http://www.w3.org/2000/svg", "line");
        ln.setAttribute("x1", x); ln.setAttribute("x2", x);
        ln.setAttribute("y1", padT); ln.setAttribute("y2", padT + plotH);
        ln.setAttribute("stroke", gridColor); ln.setAttribute("stroke-width", "1");
        ln.setAttribute("opacity", "0.4");
        svg.appendChild(ln);
      }
    }

    // Achsen-Beschriftungen
    if (showAxes) {
      const lblColor = "#ccc";
      for (let i = 0; i <= 6; i++) {
        const x = padL + (i / 6) * plotW;
        const distKm = (i / 6) * (dTrimSpan / 1000);
        const txt = document.createElementNS("http://www.w3.org/2000/svg", "text");
        txt.setAttribute("x", x); txt.setAttribute("y", h - padB + 22);
        txt.setAttribute("fill", lblColor);
        txt.setAttribute("font-size", "13"); txt.setAttribute("text-anchor", "middle");
        txt.setAttribute("font-family", "-apple-system, sans-serif");
        txt.textContent = `${distKm.toFixed(1)} km`;
        svg.appendChild(txt);
      }
      for (let i = 0; i <= 5; i++) {
        const y = padT + (i / 5) * plotH;
        const ele = eleHi - (i / 5) * eleSpan;
        const txt = document.createElementNS("http://www.w3.org/2000/svg", "text");
        txt.setAttribute("x", padL - 8); txt.setAttribute("y", y + 4);
        txt.setAttribute("fill", lblColor);
        txt.setAttribute("font-size", "13"); txt.setAttribute("text-anchor", "end");
        txt.setAttribute("font-family", "-apple-system, sans-serif");
        txt.textContent = `${ele.toFixed(0)} m`;
        svg.appendChild(txt);
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

    if (_progress > 0) {
      const fillD = partialD + ` L${endX.toFixed(1)} ${baseline} L${px(dists[_i0]).toFixed(1)} ${baseline} Z`;
      const fillPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      fillPath.setAttribute("d", fillD);
      fillPath.setAttribute("fill", lc);
      fillPath.setAttribute("opacity", "0.18");
      svg.appendChild(fillPath);
    }
    if (_progress > 0) {
      const linePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      linePath.setAttribute("d", partialD);
      linePath.setAttribute("fill", "none");
      linePath.setAttribute("stroke", lc);
      linePath.setAttribute("stroke-width", String(lw));
      linePath.setAttribute("stroke-linejoin", "round");
      linePath.setAttribute("stroke-linecap", "round");
      svg.appendChild(linePath);
    }

    // ── Marker (Kreis am Ende der gezeichneten Linie) ──────────────────
    if (showMarker && _progress > 0) {
      // Outer Glow
      const glow = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      glow.setAttribute("cx", endX.toFixed(1));
      glow.setAttribute("cy", endY.toFixed(1));
      glow.setAttribute("r", String(Math.max(8, lw * 2.5)));
      glow.setAttribute("fill", lc);
      glow.setAttribute("opacity", "0.35");
      svg.appendChild(glow);
      // Inner solid
      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("cx", endX.toFixed(1));
      dot.setAttribute("cy", endY.toFixed(1));
      dot.setAttribute("r", String(Math.max(4, lw * 1.1)));
      dot.setAttribute("fill", "#fff");
      dot.setAttribute("stroke", lc);
      dot.setAttribute("stroke-width", "2");
      svg.appendChild(dot);
    }

    // ── Live-Stats-Label (aktuelle Distanz + Höhe) ──────────────────────
    if (_progress > 0) {
      // Trim-relative Werte
      let curEle, curDist;
      if (endIdx <= _i0) {
        curEle = elevs[_i0]; curDist = 0;
      } else {
        const d0 = dists[endIdx - 1], d1 = dists[endIdx];
        const seg = d1 > d0 ? (dCurrent - d0) / (d1 - d0) : 0;
        curEle = elevs[endIdx - 1] + (elevs[endIdx] - elevs[endIdx - 1]) * seg;
        curDist = dCurrent - dTrimStart;   // anzeige beginnt bei 0
      }
      // Stats-Box oben rechts
      const sg = document.createElementNS("http://www.w3.org/2000/svg", "g");
      const sb = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      const boxW = 170, boxH = 56, boxX = w - padR - boxW, boxY = padT - 30;
      sb.setAttribute("x", boxX); sb.setAttribute("y", boxY);
      sb.setAttribute("width", boxW); sb.setAttribute("height", boxH);
      sb.setAttribute("rx", "8"); sb.setAttribute("ry", "8");
      sb.setAttribute("fill", "rgba(0,0,0,0.55)");
      sb.setAttribute("stroke", lc); sb.setAttribute("stroke-width", "1.5");
      sb.setAttribute("opacity", "0.95");
      sg.appendChild(sb);
      const t1 = document.createElementNS("http://www.w3.org/2000/svg", "text");
      t1.setAttribute("x", boxX + 12); t1.setAttribute("y", boxY + 22);
      t1.setAttribute("fill", "#fff");
      t1.setAttribute("font-size", "13"); t1.setAttribute("font-family", "-apple-system, sans-serif");
      t1.textContent = `↗ ${(curDist / 1000).toFixed(2)} km`;
      sg.appendChild(t1);
      const t2 = document.createElementNS("http://www.w3.org/2000/svg", "text");
      t2.setAttribute("x", boxX + 12); t2.setAttribute("y", boxY + 42);
      t2.setAttribute("fill", "#fff");
      t2.setAttribute("font-size", "13"); t2.setAttribute("font-family", "-apple-system, sans-serif");
      t2.textContent = `⛰ ${curEle.toFixed(0)} m`;
      sg.appendChild(t2);
      svg.appendChild(sg);
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
        _progress = 0;
        setProgressUi(0);
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
  // Höhen-Animator hält seine Werte direkt in den Controls (kein Settings-Dict) →
  // DOM-Snapshot-Controller. apply stellt die Werte her, feuert Events + zeichnet neu.
  const _haUndoCtrl = (typeof window.rzMakePanelUndoController === "function")
    ? window.rzMakePanelUndoController("height-panel", {
        section: "heightanim",
        after: () => { try { drawElevationSvg(); } catch (_) {} },
        toast: (m) => { try { if (typeof toast === "function") toast(m, "info", 1000); } catch (_) {} },
      })
    : null;
  if (_haUndoCtrl) {
    window.__rzUndoControllers = window.__rzUndoControllers || {};
    window.__rzUndoControllers.heightanim = _haUndoCtrl;
    // Push-Listener verdrahtet rzMakePanelUndoController selbst (Pre-Change-Erfassung).
  }

  // ── Event-Bindings ─────────────────────────────────────────────────────
  // Optik-Inputs re-drawen den aktuellen Frame
  ["height-bg", "height-color", "height-lw", "height-grid", "height-axes", "height-marker"]
    .forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("input", drawElevationSvg);
      el.addEventListener("change", drawElevationSvg);
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
    try {
      if (typeof window.saveActiveProjectPatch === "function") {
        window.saveActiveProjectPatch({
          heightanim: { trim_start: _trimStart, trim_end: _trimEnd }
        }, { persistOnly: true });
      }
    } catch (_) {}
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
        toast(t("heightanim.toast.done", "Höhen-Video fertig") + ": " + (s.output || "").split("/").pop(), "success", 6000);
      }
      return;
    }
    _renderPollTimer = setTimeout(pollHeightRender, 350);
  }

  document.getElementById("height-render")?.addEventListener("click", async () => {
    const gpxPath = (typeof getGlobalGpxPath === "function") ? getGlobalGpxPath() : "";
    if (!gpxPath) {
      if (typeof toast === "function") toast(t("heightanim.toast.no_gpx", "Erst GPX laden."), "warn", 3000);
      return;
    }
    const codec = codecEl?.value || "h264";
    const alpha = (codec === "alpha");
    const params = {
      gpx_path: gpxPath,
      duration_s: parseInt(document.getElementById("height-dur")?.value || "12", 10),
      hold_s: parseInt(document.getElementById("height-hold")?.value || "2", 10),
      fps: parseInt(document.getElementById("height-fps")?.value || "30", 10),
      width: parseInt(document.getElementById("height-w")?.value || "1920", 10),
      height: parseInt(document.getElementById("height-h")?.value || "1080", 10),
      codec: alpha ? "prores" : codec,
      transparent_background: alpha,
      background_color: document.getElementById("height-bg")?.value || "#1a1a1a",
      line_color: document.getElementById("height-color")?.value || "#ff6b35",
      line_width: parseFloat(document.getElementById("height-lw")?.value || "4"),
      grid_enabled: document.getElementById("height-grid")?.checked !== false,
      show_axes: document.getElementById("height-axes")?.checked !== false,
      show_marker: document.getElementById("height-marker")?.checked !== false,
      trim_start: _trimStart,
      trim_end: _trimEnd,
    };

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
