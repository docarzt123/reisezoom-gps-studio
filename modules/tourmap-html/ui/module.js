/* v0.9.418 — Tour-Map „HTML (Blog)"-Modus: eigenständiger, minimaler Leaflet-Editor.
 *
 * Bewusst KOMPLETT getrennt von der normalen Tour-Map (die über die Animator-Engine
 * läuft). Hier: leichte Leaflet-Karte (OSM-Raster), voller Track sofort, Schilder als
 * pixelgenaue Bild-Marker (serverseitig gerastert via Bridge → WYSIWYG), optionaler
 * DSGVO-Consent. KEINE Fotos, kein 3D, kein Overlay. Die Vorschau HIER ist exakt der
 * Export (dieselbe Leaflet-Engine + dieselben gerasterten Schilder).
 *
 * Exportiert `window.mountTourmapHtmlEditor(body, headerActions)` → Cleanup-Funktion.
 */
(function () {
  function mountTourmapHtmlEditor(body, _headerActions) {
    const T = (typeof t === "function") ? t : (k, d) => d || k;
    const MODKEY = "tourmap";
    const styles = (typeof RZ_OSM_TILE_STYLES !== "undefined") ? RZ_OSM_TILE_STYLES : { osm: { label: "OpenStreetMap" } };

    // ── Settings-Zugriff (eigene html_*-Keys, damit der Bild-Modus unberührt bleibt) ──
    function proj() { return (typeof getActiveProject === "function") ? getActiveProject() : null; }
    function tm() { const p = proj(); return (p && p[MODKEY]) || {}; }
    function get(key, def) { const a = tm(); return (key in a) ? a[key] : def; }
    function save(patch) { if (typeof saveProjectSettings === "function") saveProjectSettings(MODKEY, patch); }

    const lineColor0 = get("html_line_color", get("line_color", "#ff6b35"));
    const lineWidth0 = get("html_line_width", 4.5);
    const tileStyle0 = styles[get("html_tile_style", "osm")] ? get("html_tile_style", "osm") : "osm";
    const signsShow0 = (typeof get("html_signs_show", true) === "boolean") ? get("html_signs_show", true) : true;
    const consentOn0 = !!get("html_consent_enabled", false);
    const consentTxt0 = get("html_consent_text", "");
    const consentBtn0 = get("html_consent_button", "");
    const DEFAULT_CONSENT = T("tourmap.html.consent_default",
      "Zum Anzeigen der interaktiven Karte werden Kartenkacheln von OpenStreetMap geladen. Dabei wird deine IP-Adresse an den Kartenanbieter übertragen. Mit Klick auf „Karte laden“ stimmst du dem zu.");

    const styleOpts = Object.keys(styles).map((k) =>
      `<option value="${k}"${k === tileStyle0 ? " selected" : ""}>${styles[k].label || k}</option>`).join("");

    body.innerHTML = `
      <aside class="panel" id="tmhtml-panel" style="flex:0 0 320px; align-self:stretch; overflow:auto;">
        <div class="section">
          <div class="muted" style="font-size:11px; line-height:1.5; margin:0 0 12px;">
            ${T("tourmap.html2.intro", "Leichte, interaktive Karte fürs Blog (Leaflet + OpenStreetMap). Nur Route + Schilder — bewusst schlank. Die Vorschau hier ist exakt der Export.")}
          </div>

          <label class="field-label" for="tmhtml-color">${T("tourmap.html2.track_color", "Track-Farbe")}</label>
          <input type="color" id="tmhtml-color" value="${lineColor0}" style="width:100%; height:34px; padding:2px;">

          <label class="field-label" for="tmhtml-width" style="margin-top:10px;">${T("tourmap.html2.track_width", "Track-Breite")}: <span id="tmhtml-width-val">${lineWidth0}</span> px</label>
          <input type="range" id="tmhtml-width" min="1" max="12" step="0.5" value="${lineWidth0}" style="width:100%;">

          <label class="field-label" for="tmhtml-tile" style="margin-top:10px;">${T("tourmap.html2.tile_style", "Kartenstil")}</label>
          <select id="tmhtml-tile" style="width:100%;">${styleOpts}</select>

          <label class="check-row" style="margin-top:12px;">
            <input type="checkbox" id="tmhtml-signs"${signsShow0 ? " checked" : ""}>
            <span>${T("tourmap.html2.signs_show", "Schilder anzeigen")}</span>
          </label>
        </div>

        <div class="section">
          <label class="check-row">
            <input type="checkbox" id="tmhtml-consent"${consentOn0 ? " checked" : ""}>
            <span>${T("tourmap.html.consent_toggle", "DSGVO-Zustimmungs-Button")}</span>
          </label>
          <div id="tmhtml-consent-fields" style="margin-top:8px;${consentOn0 ? "" : "display:none;"}">
            <label class="field-label" for="tmhtml-consent-text">${T("tourmap.html.consent_text_label", "Zustimmungs-Text")}</label>
            <textarea id="tmhtml-consent-text" rows="4" style="width:100%; box-sizing:border-box; font-size:12px;">${consentTxt0 || DEFAULT_CONSENT}</textarea>
            <label class="field-label" for="tmhtml-consent-button" style="margin-top:8px;">${T("tourmap.html.consent_button_label", "Button-Beschriftung")}</label>
            <input type="text" id="tmhtml-consent-button" value="${consentBtn0 || T("tourmap.html.consent_button_default", "Karte laden")}" style="width:100%; box-sizing:border-box;">
          </div>
        </div>

        <div class="section">
          <button class="btn btn-primary btn-block" id="tmhtml-export">🌐 ${T("tourmap.html2.export_btn", "Als HTML exportieren")}</button>
          <div class="muted" id="tmhtml-status" style="font-size:11px; margin-top:8px; min-height:14px;"></div>
        </div>
      </aside>
      <section id="tmhtml-canvas" style="position:relative; flex:1 1 auto; min-width:0; align-self:stretch; background:#e8ebf0;">
        <div id="tmhtml-map" style="position:absolute; inset:0;"></div>
      </section>`;

    // ── Leaflet-Karte + State ────────────────────────────────────────────────
    let map = null, tileLayer = null, trackLine = null, startPin = null, endPin = null;
    let signMarkers = [];
    let track = [];        // [[lat,lon], …]
    let rsigns = [];       // [{lat,lon,img,w,h,anchor}]
    let destroyed = false;

    const el = (id) => document.getElementById(id);
    const status = (msg) => { const s = el("tmhtml-status"); if (s) s.textContent = msg || ""; };

    function tileFor(styleId) {
      const s = styles[styleId] || styles.osm;
      const urls = (s.sub && s.sub.length) ? s.sub.map((d) => s.url.replace("{s}", d)) : [s.url];
      return L.tileLayer(urls[0], { maxZoom: s.max || 19, subdomains: (s.sub || []).join(""), attribution: s.attr || "" });
    }
    function signAnchor(s) {
      const w = s.w || 40, h = s.h || 40, d = s.anchor || "bottom";
      if (d === "top") return [w / 2, 0];
      if (d === "left") return [0, h / 2];
      if (d === "right") return [w, h / 2];
      return [w / 2, h];
    }
    function drawSigns() {
      signMarkers.forEach((m) => { try { map.removeLayer(m); } catch (_) {} });
      signMarkers = [];
      if (!el("tmhtml-signs")?.checked) return;
      (rsigns || []).forEach((s) => {
        if (!s.img) return;
        const icon = L.icon({ iconUrl: s.img, iconSize: [s.w || 40, s.h || 40], iconAnchor: signAnchor(s), className: "rz-sign" });
        signMarkers.push(L.marker([s.lat, s.lon], { icon, interactive: false }).addTo(map));
      });
    }
    function drawTrack() {
      if (trackLine) { try { map.removeLayer(trackLine); } catch (_) {} trackLine = null; }
      if (startPin) { try { map.removeLayer(startPin); } catch (_) {} startPin = null; }
      if (endPin) { try { map.removeLayer(endPin); } catch (_) {} endPin = null; }
      if (!track || track.length < 2) return;
      const color = el("tmhtml-color")?.value || "#ff6b35";
      const width = parseFloat(el("tmhtml-width")?.value) || 4.5;
      trackLine = L.polyline(track, { color, weight: width, opacity: 0.95, lineJoin: "round", lineCap: "round" }).addTo(map);
      const pin = (c) => L.divIcon({ className: "rz-pin", iconSize: [20, 20], iconAnchor: [10, 10],
        html: '<span style="display:block;width:14px;height:14px;border-radius:50%;background:' + c + ';border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5)"></span>' });
      startPin = L.marker(track[0], { icon: pin("#2ecc71") }).addTo(map);
      endPin = L.marker(track[track.length - 1], { icon: pin("#e74c3c") }).addTo(map);
      try { map.fitBounds(trackLine.getBounds(), { padding: [26, 26] }); } catch (_) {}
    }

    function signsFromProject() {
      const p = proj();
      if (!p) return [];
      for (const k of ["tourmap_signs", "signs"]) {
        if (Array.isArray(p[k]) && p[k].length) return p[k];
      }
      return [];
    }

    // Track + (server-gerasterte) Schilder vom Backend holen → WYSIWYG-Vorschau.
    async function refreshData() {
      const gpxPath = (typeof getGlobalGpxPath === "function") ? getGlobalGpxPath() : "";
      if (!gpxPath) { status(T("tourmap.html2.no_gpx", "Erst eine GPX-Datei laden.")); return; }
      status(T("tourmap.html2.loading", "Lade Vorschau …"));
      try {
        const res = await window.pywebview.api.tourmap_leaflet_prepare({
          gpx_path: gpxPath,
          signs: signsFromProject(),
          signs_show: !!el("tmhtml-signs")?.checked,
        });
        if (destroyed) return;
        if (!res || !res.ok) { status(T("tourmap.html2.load_fail", "Vorschau fehlgeschlagen") + ": " + (res?.error || "?")); return; }
        track = res.track || [];
        rsigns = res.signs || [];
        drawTrack();
        drawSigns();
        status("");
      } catch (e) { if (!destroyed) status(String(e)); }
    }

    function collectExportParams() {
      return {
        gpx_path: (typeof getGlobalGpxPath === "function") ? getGlobalGpxPath() : "",
        tile_style: el("tmhtml-tile")?.value || "osm",
        line_color: el("tmhtml-color")?.value || "#ff6b35",
        line_width: parseFloat(el("tmhtml-width")?.value) || 4.5,
        show_pins: true,
        signs: signsFromProject(),
        signs_show: !!el("tmhtml-signs")?.checked,
        consent_enabled: !!el("tmhtml-consent")?.checked,
        consent_text: (el("tmhtml-consent-text")?.value || "").trim() || DEFAULT_CONSENT,
        consent_button: (el("tmhtml-consent-button")?.value || "").trim() || T("tourmap.html.consent_button_default", "Karte laden"),
        // Vorschau-Ausschnitt übernehmen (WYSIWYG): aktuelle Leaflet-Mitte + Zoom.
        ...(map ? (() => { const c = map.getCenter(); return { view_center: [c.lat, c.lng], view_zoom: map.getZoom() }; })() : {}),
        width: 1120, height: 640,
      };
    }

    async function doExport() {
      const btn = el("tmhtml-export");
      const gpxPath = (typeof getGlobalGpxPath === "function") ? getGlobalGpxPath() : "";
      if (!gpxPath) { if (typeof toast === "function") toast(T("tourmap.html2.no_gpx", "Erst eine GPX-Datei laden."), "warn", 3000); return; }
      const old = btn.textContent; btn.disabled = true; btn.textContent = "⏳ " + T("tourmap.html.exporting", "Exportiere HTML …");
      try {
        const res = await window.pywebview.api.tourmap_export_leaflet(collectExportParams());
        if (!res || !res.ok) { if (typeof toast === "function") toast(T("tourmap.html.failed", "HTML-Export fehlgeschlagen") + ": " + (res?.error || "?"), "error", 8000); return; }
        showExportModal(res);
      } catch (e) {
        if (typeof toast === "function") toast(T("tourmap.html.failed", "HTML-Export fehlgeschlagen") + ": " + e, "error", 8000);
      } finally { btn.disabled = false; btn.textContent = old; }
    }

    function showExportModal(res) {
      const kb = Math.round((res.bytes || 0) / 1024);
      const bodyHtml = `
        <p style="font-size:13px; margin:0 0 8px;">${T("tourmap.html.modal_intro", "Interaktive Karte als HTML gespeichert")} (${kb} KB).</p>
        <p style="font-size:12px; color:var(--text-muted,#aaa); margin:0 0 12px;">${T("tourmap.html.modal_open_hint", "Zum Ansehen „Im Browser öffnen“ nutzen.")}</p>
        <p style="font-size:12px; margin:0 0 4px; font-weight:600;">${T("tourmap.html.snippet_hint", "Snippet für einen „Custom HTML“-Block:")}</p>
        <textarea id="tmhtml-snippet" readonly rows="5" style="width:100%; font-family:ui-monospace,Menlo,monospace; font-size:10px; box-sizing:border-box;"></textarea>`;
      const footer = `
        <button type="button" id="tmhtml-open" class="btn btn-primary">▶ ${T("tourmap.html.open_browser", "Im Browser öffnen")}</button>
        <button type="button" id="tmhtml-copy" class="btn btn-secondary">${T("tourmap.html.copy", "Snippet kopieren")}</button>
        <button type="button" id="tmhtml-reveal" class="btn btn-secondary">${T("animator.btn.reveal", "Im Finder zeigen")}</button>
        <button type="button" id="tmhtml-close" class="btn btn-secondary">${T("tourmap.html.close", "Schließen")}</button>`;
      const modal = (typeof openModal === "function") ? openModal({ title: T("tourmap.html.modal_title", "HTML exportiert"), body: bodyHtml, footer }) : null;
      const ta = el("tmhtml-snippet"); if (ta) ta.value = res.snippet || "";
      el("tmhtml-open")?.addEventListener("click", () => { try { window.pywebview.api.tourmap_open_in_browser(res.output); } catch (_) {} });
      el("tmhtml-reveal")?.addEventListener("click", () => { try { window.pywebview.api.reveal_in_finder(res.output); } catch (_) {} });
      el("tmhtml-close")?.addEventListener("click", () => { if (modal) modal.close(); });
      el("tmhtml-copy")?.addEventListener("click", async () => {
        try { if (ta) { ta.focus(); ta.select(); } document.execCommand("copy"); if (typeof toast === "function") toast(T("tourmap.html.copied", "Snippet kopiert."), "info", 2500); } catch (_) {}
      });
    }

    // ── Karte initialisieren + Listener ──────────────────────────────────────
    const _log = (m) => { try { if (window.pywebview && window.pywebview.api && window.pywebview.api.log_js) window.pywebview.api.log_js("info", "[tmhtml] " + m); } catch (_) {} };
    let _ro = null;
    (function initMap() {
      const host = el("tmhtml-map");
      if (!host) { _log("no #tmhtml-map"); return; }
      if (typeof L === "undefined" || !L || !L.map) {
        _log("Leaflet L undefined/incomplete!");
        host.innerHTML = '<div style="padding:20px; color:#c00;">Leaflet nicht geladen (CDN nicht erreichbar?).</div>';
        return;
      }
      const r = host.getBoundingClientRect();
      _log("init container " + Math.round(r.width) + "x" + Math.round(r.height));
      try {
        map = L.map(host, { scrollWheelZoom: true }).setView([51.16, 10.45], 5);
        tileLayer = tileFor(tileStyle0).addTo(map);
        // WICHTIG: Beim Mount hat der Container im Flex-Layout oft noch 0 Größe →
        // Leaflet rendert leer und lädt keine Kacheln. Ein ResizeObserver ruft
        // invalidateSize(), sobald der Container seine echte Größe bekommt; dazu
        // ein paar gestaffelte Nach-Ticks als Sicherheitsnetz.
        _ro = new ResizeObserver(() => { try { map.invalidateSize(false); } catch (_) {} });
        _ro.observe(host);
        requestAnimationFrame(() => { try { map.invalidateSize(false); } catch (_) {} });
        [120, 400, 900].forEach((ms) => setTimeout(() => { try { map.invalidateSize(false); } catch (_) {} }, ms));
      } catch (e) {
        _log("map init throw: " + e);
        host.innerHTML = '<div style="padding:20px; color:#c00;">Karte-Init-Fehler: ' + e + "</div>";
      }
    })();

    el("tmhtml-color")?.addEventListener("input", () => { save({ html_line_color: el("tmhtml-color").value }); drawTrack(); });
    el("tmhtml-width")?.addEventListener("input", () => {
      el("tmhtml-width-val").textContent = el("tmhtml-width").value;
      save({ html_line_width: parseFloat(el("tmhtml-width").value) }); drawTrack();
    });
    el("tmhtml-tile")?.addEventListener("change", () => {
      const v = el("tmhtml-tile").value; save({ html_tile_style: v });
      if (map && tileLayer) { try { map.removeLayer(tileLayer); } catch (_) {} tileLayer = tileFor(v).addTo(map); }
    });
    el("tmhtml-signs")?.addEventListener("change", () => { save({ html_signs_show: !!el("tmhtml-signs").checked }); refreshData(); });
    el("tmhtml-consent")?.addEventListener("change", () => {
      const on = !!el("tmhtml-consent").checked; save({ html_consent_enabled: on });
      el("tmhtml-consent-fields").style.display = on ? "" : "none";
    });
    el("tmhtml-consent-text")?.addEventListener("change", () => save({ html_consent_text: el("tmhtml-consent-text").value }));
    el("tmhtml-consent-button")?.addEventListener("change", () => save({ html_consent_button: el("tmhtml-consent-button").value }));
    el("tmhtml-export")?.addEventListener("click", doExport);

    // Beim Mount kann die globale GPX noch nicht angewendet sein (Start-Race) →
    // getGlobalGpxPath() ist leer. Auf GPX-Load/-Wechsel hören und Vorschau
    // (Track + Schilder) neu aufbauen. Zusätzlich einmal direkt versuchen.
    let _gpxUnsub = null;
    if (typeof onGpxLoaded === "function") {
      try { _gpxUnsub = onGpxLoaded(() => { if (!destroyed) refreshData(); }); } catch (_) {}
    }
    refreshData();

    // Cleanup
    return function () {
      destroyed = true;
      try { if (_gpxUnsub) _gpxUnsub(); } catch (_) {}
      try { if (_ro) _ro.disconnect(); } catch (_) {}
      try { if (map) map.remove(); } catch (_) {}
      map = null; _ro = null; _gpxUnsub = null;
    };
  }

  window.mountTourmapHtmlEditor = mountTourmapHtmlEditor;
})();
