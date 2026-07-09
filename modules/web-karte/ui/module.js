/* v0.9.422 — „Web Karte": eigenständiger, schlanker Leaflet-Editor für interaktive
 * Karten fürs Web/Blog. Komplett unabhängig von der Tour-Map.
 *
 * Nur das Nötigste: Track wird automatisch aus dem geladenen GPX gezeichnet
 * (fitBounds), dazu freie Text-Beschriftungen, die DIREKT auf der Karte gesetzt
 * und bearbeitet werden (klicken zum Hinzufügen, ziehen zum Verschieben, Text
 * tippen, löschen). Schlichte Leaflet-Labels (kein Server-Rastern → sofort).
 * Export = leichte, eigenständige Leaflet-HTML (+ iframe-Snippet), optional mit
 * DSGVO-„Karte laden"-Gate. Eigenes Datenmodell (proj.webkarte).
 *
 * Registriert sich als eigener Tab (RZGPS_MODULES.webkarte).
 */
(function () {
  const MODKEY = "webkarte";

  function mountWebKarte(body, _headerActions) {
    const T = (typeof t === "function") ? t : (k, d) => d || k;

    // v0.9.428 — Beschriftungen als permanente Leaflet-Tooltips (zoom-stabil). Der
    // Tooltip-CONTAINER ist transparent; das sichtbare „Pill" ist ein innerer <span>
    // mit PRO-LABEL Farbe/Größe (inline). Standard-Pfeil aus. Pin-Container reset.
    if (!document.getElementById("wk-label-style")) {
      const st = document.createElement("style");
      st.id = "wk-label-style";
      st.textContent =
        ".wk-pin{background:none;border:0;}" +
        ".leaflet-tooltip.wk-tip{background:none;border:0;padding:0;box-shadow:none;white-space:nowrap;}" +
        ".leaflet-tooltip.wk-tip:before{display:none;}" +
        ".wk-lbl-row{border:1px solid var(--border,#3a3f4a);border-radius:7px;padding:7px;margin-bottom:7px;}" +
        ".wk-lbl-row.sel{border-color:#ff6b35;box-shadow:0 0 0 1px #ff6b35;}";
      document.head.appendChild(st);
    }
    const LBL_COLOR0 = "#15171c";   // Default-Pill-Farbe
    const LBL_SIZE0 = 13;           // Default-Schriftgröße px
    const styles = (typeof RZ_OSM_TILE_STYLES !== "undefined") ? RZ_OSM_TILE_STYLES : { osm: { label: "OpenStreetMap" } };

    const proj = () => (typeof getActiveProject === "function") ? getActiveProject() : null;
    const wk = () => { const p = proj(); return (p && p[MODKEY]) || {}; };
    const get = (k, d) => { const a = wk(); return (k in a) ? a[k] : d; };
    const save = (patch) => { if (typeof saveProjectSettings === "function") saveProjectSettings(MODKEY, patch); };

    const lineColor0 = get("line_color", "#ff6b35");
    const lineWidth0 = get("line_width", 4.5);
    const tileStyle0 = styles[get("tile_style", "osm")] ? get("tile_style", "osm") : "osm";
    const consentOn0 = !!get("consent_enabled", false);
    const consentTxt0 = get("consent_text", "");
    const consentBtn0 = get("consent_button", "");
    const DEFAULT_CONSENT = T("tourmap.html.consent_default",
      "Zum Anzeigen der interaktiven Karte werden Kartenkacheln von OpenStreetMap geladen. Dabei wird deine IP-Adresse an den Kartenanbieter übertragen. Mit Klick auf „Karte laden“ stimmst du dem zu.");
    // Labels: [{lat, lon, text, color, size}] — eigenes Datenmodell.
    const normLabels = (arr) => (Array.isArray(arr) ? arr.map((l) => ({
      lat: Number(l.lat), lon: Number(l.lon), text: String(l.text || ""),
      color: (typeof l.color === "string" && l.color) ? l.color : LBL_COLOR0,
      size: (Number(l.size) > 0) ? Number(l.size) : LBL_SIZE0,
    })).filter((l) => isFinite(l.lat) && isFinite(l.lon)) : []);
    let labels = normLabels(get("labels", null));

    const styleOpts = Object.keys(styles).map((k) =>
      `<option value="${k}"${k === tileStyle0 ? " selected" : ""}>${styles[k].label || k}</option>`).join("");

    body.innerHTML = `
      <aside class="panel" id="wk-panel">
        <div class="section">
          <div class="muted" style="font-size:11px; line-height:1.5; margin:0 0 12px;">
            ${T("webkarte.intro", "Leichte, interaktive Karte fürs Web. Track kommt automatisch aus dem GPX; Beschriftungen setzt du direkt auf der Karte. Die Vorschau hier ist exakt der Export.")}
          </div>
          <label class="field-label" for="wk-color">${T("webkarte.track_color", "Track-Farbe")}</label>
          <input type="color" id="wk-color" value="${lineColor0}" style="width:100%; height:34px; padding:2px;">
          <label class="field-label" for="wk-width" style="margin-top:10px;">${T("webkarte.track_width", "Track-Breite")}: <span id="wk-width-val">${lineWidth0}</span> px</label>
          <input type="range" id="wk-width" min="1" max="12" step="0.5" value="${lineWidth0}" style="width:100%;">
          <label class="field-label" for="wk-tile" style="margin-top:10px;">${T("webkarte.tile_style", "Kartenstil")}</label>
          <select id="wk-tile" style="width:100%;">${styleOpts}</select>
        </div>

        <div class="section">
          <div class="field-label" style="margin-bottom:6px;">${T("webkarte.labels", "Beschriftungen")}</div>
          <button class="btn btn-secondary btn-block" id="wk-add-label">＋ ${T("webkarte.add_label", "Beschriftung hinzufügen")}</button>
          <div id="wk-label-list" style="margin-top:8px;"></div>
          <div class="muted" id="wk-label-hint" style="font-size:11px; margin-top:4px; line-height:1.45;">${T("webkarte.labels_hint", "Auf „Hinzufügen“ klicken, dann auf die Karte tippen. Text/Farbe/Größe stellst du hier ein; auf der Karte ziehen verschiebt die Beschriftung.")}</div>
        </div>

        <div class="section">
          <label class="check-row">
            <input type="checkbox" id="wk-consent"${consentOn0 ? " checked" : ""}>
            <span>${T("tourmap.html.consent_toggle", "DSGVO-Zustimmungs-Button")}</span>
          </label>
          <div id="wk-consent-fields" style="margin-top:8px;${consentOn0 ? "" : "display:none;"}">
            <label class="field-label" for="wk-consent-text">${T("tourmap.html.consent_text_label", "Zustimmungs-Text")}</label>
            <textarea id="wk-consent-text" rows="4" style="width:100%; box-sizing:border-box; font-size:12px;">${consentTxt0 || DEFAULT_CONSENT}</textarea>
            <label class="field-label" for="wk-consent-button" style="margin-top:8px;">${T("tourmap.html.consent_button_label", "Button-Beschriftung")}</label>
            <input type="text" id="wk-consent-button" value="${consentBtn0 || T("tourmap.html.consent_button_default", "Karte laden")}" style="width:100%; box-sizing:border-box;">
          </div>
        </div>

        <div class="section">
          <button class="btn btn-primary btn-block" id="wk-export">🌐 ${T("webkarte.export_btn", "Als HTML exportieren")}</button>
          <div class="muted" id="wk-status" style="font-size:11px; margin-top:8px; min-height:14px;"></div>
        </div>
      </aside>
      <section id="wk-canvas" style="position:relative; background:#e8ebf0;">
        <div id="wk-map" style="position:absolute; inset:0;"></div>
      </section>`;

    const el = (id) => document.getElementById(id);
    const status = (m) => { const s = el("wk-status"); if (s) s.textContent = m || ""; };

    let map = null, tileLayer = null, trackLine = null, startPin = null, endPin = null;
    let labelTips = [];
    let track = [];
    let addMode = false;
    let destroyed = false;
    let _ro = null, _gpxUnsub = null, _sessUnsub = null;

    function tileFor(id) {
      const s = styles[id] || styles.osm;
      const urls = (s.sub && s.sub.length) ? s.sub.map((d) => s.url.replace("{s}", d)) : [s.url];
      return L.tileLayer(urls[0], { maxZoom: s.max || 19, subdomains: (s.sub || []).join(""), attribution: s.attr || "" });
    }
    function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

    function persistLabels() {
      save({ labels: labels.map((l) => ({ lat: l.lat, lon: l.lon, text: l.text, color: l.color, size: l.size })) });
    }

    // Kontrastfarbe (weiß/dunkel) je nach Pill-Hintergrund, damit Text lesbar bleibt.
    function textColorFor(bg) {
      const m = /^#?([0-9a-f]{6})$/i.exec(String(bg || "").trim());
      if (!m) return "#fff";
      const n = parseInt(m[1], 16);
      const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      return lum > 0.6 ? "#15171c" : "#fff";
    }
    // Das sichtbare „Pill" als HTML (pro-Label Farbe/Größe inline).
    function pillHtml(l) {
      const color = l.color || LBL_COLOR0;
      const size = (Number(l.size) > 0) ? Number(l.size) : LBL_SIZE0;
      return '<span style="display:inline-block;white-space:nowrap;padding:4px 9px;border-radius:8px;'
        + "font:600 " + size + "px/1.25 -apple-system,system-ui,'Segoe UI',Roboto,sans-serif;"
        + "background:" + color + ";color:" + textColorFor(color) + ";"
        + 'box-shadow:0 1px 4px rgba(0,0,0,.4)">' + esc(l.text || " ") + "</span>";
    }

    // v0.9.428 — Label = permanenter Leaflet-Tooltip (zoom-stabil). Auf der Karte nur
    // VERSCHIEBEN per Drag; bearbeiten (Text/Farbe/Größe/Löschen) läuft über die
    // Sidebar-Liste (zuverlässiger als ein Karten-Popup). Klick ohne Drag → Zeile
    // in der Sidebar fokussieren.
    function makeLabelTip(l) {
      const tip = L.tooltip({ permanent: true, direction: "top", className: "wk-tip",
        opacity: 1, interactive: true, offset: [0, -2] })
        .setLatLng([l.lat, l.lon]).setContent(pillHtml(l));
      tip.addTo(map);
      let start = null, moved = false;
      const onMove = (ev) => {
        if (!start) return;
        if (Math.abs(ev.clientX - start.x) + Math.abs(ev.clientY - start.y) > 3) moved = true;
        const rect = map.getContainer().getBoundingClientRect();
        const ll = map.containerPointToLatLng(L.point(ev.clientX - rect.left, ev.clientY - rect.top));
        l.lat = ll.lat; l.lon = ll.lng; tip.setLatLng(ll);
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        try { map.dragging.enable(); } catch (_) {}
        if (moved) persistLabels(); else focusLabelRow(labels.indexOf(l));
        start = null;
      };
      const bind = () => {
        const e = tip.getElement(); if (!e) return;
        e.style.cursor = "move";
        e.addEventListener("mousedown", (ev) => {
          ev.preventDefault(); ev.stopPropagation();
          start = { x: ev.clientX, y: ev.clientY }; moved = false;
          try { map.dragging.disable(); } catch (_) {}
          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp);
        });
      };
      if (tip.getElement()) bind(); else setTimeout(bind, 0);
      return tip;
    }

    function rebuildLabels() {
      labelTips.forEach((tp) => { try { map.removeLayer(tp); } catch (_) {} });
      labelTips = [];
      labels.forEach((l) => { labelTips.push(makeLabelTip(l)); });
    }

    // Nur den Inhalt EINES Tooltips neu setzen (nach Text/Farbe/Größe-Änderung).
    function updateTip(idx) {
      if (labelTips[idx] && labels[idx]) labelTips[idx].setContent(pillHtml(labels[idx]));
    }

    // ── Sidebar-Liste: Text/Farbe/Größe/Löschen pro Beschriftung ────────────
    const SIZE_OPTS = [
      [11, T("webkarte.size_s", "Klein")],
      [13, T("webkarte.size_m", "Mittel")],
      [16, T("webkarte.size_l", "Groß")],
      [22, T("webkarte.size_xl", "Sehr groß")],
    ];
    function renderLabelList() {
      const box = el("wk-label-list"); if (!box) return;
      if (!labels.length) { box.innerHTML = ""; return; }
      box.innerHTML = labels.map((l, i) => {
        const opts = SIZE_OPTS.map(([v, lab]) =>
          `<option value="${v}"${Number(l.size) === v ? " selected" : ""}>${lab}</option>`).join("");
        return `<div class="wk-lbl-row" data-idx="${i}">
          <input type="text" class="wk-lbl-text" data-idx="${i}" value="${esc(l.text)}"
                 placeholder="${esc(T("webkarte.label_placeholder", "Text …"))}"
                 style="width:100%; box-sizing:border-box; font-size:13px; padding:4px 6px; margin-bottom:5px;">
          <div style="display:flex; gap:6px; align-items:center;">
            <input type="color" class="wk-lbl-color" data-idx="${i}" value="${l.color || LBL_COLOR0}"
                   title="${esc(T("webkarte.label_color", "Farbe"))}" style="width:34px; height:26px; padding:1px;">
            <select class="wk-lbl-size" data-idx="${i}" title="${esc(T("webkarte.label_size", "Größe"))}" style="flex:1;">${opts}</select>
            <button type="button" class="wk-lbl-del" data-idx="${i}" title="${esc(T("webkarte.delete", "Löschen"))}"
                    style="background:none; border:0; cursor:pointer; font-size:15px; padding:2px 4px;">🗑</button>
          </div>
        </div>`;
      }).join("");
    }
    function focusLabelRow(idx) {
      const box = el("wk-label-list"); if (!box) return;
      box.querySelectorAll(".wk-lbl-row").forEach((r) => r.classList.remove("sel"));
      const row = box.querySelector('.wk-lbl-row[data-idx="' + idx + '"]');
      if (row) {
        row.classList.add("sel");
        row.scrollIntoView({ block: "nearest" });
        const inp = row.querySelector(".wk-lbl-text");
        if (inp) { inp.focus(); inp.select(); }
      }
    }
    function addLabelAt(lat, lon) {
      const l = { lat, lon, text: T("webkarte.new_label", "Text"), color: LBL_COLOR0, size: LBL_SIZE0 };
      labels.push(l); persistLabels(); rebuildLabels(); renderLabelList();
      focusLabelRow(labels.length - 1);
    }

    // v0.9.427 — Alle Einstellungen + Beschriftungen frisch aus dem aktiven Projekt
    // in die UI + Karte übernehmen. Wird beim Mount UND bei jedem Session-/Projekt-
    // Wechsel gerufen (onSessionChanged), damit nichts „vergessen" wird, wenn das
    // Projekt erst nach dem Mount bereitsteht oder gewechselt wird.
    function applyProjectState() {
      const a = wk();
      if (el("wk-color") && a.line_color) el("wk-color").value = a.line_color;
      if (el("wk-width") && a.line_width != null) {
        el("wk-width").value = a.line_width;
        if (el("wk-width-val")) el("wk-width-val").textContent = a.line_width;
      }
      if (el("wk-tile") && a.tile_style && styles[a.tile_style]) el("wk-tile").value = a.tile_style;
      const cons = !!a.consent_enabled;
      if (el("wk-consent")) el("wk-consent").checked = cons;
      if (el("wk-consent-fields")) el("wk-consent-fields").style.display = cons ? "" : "none";
      if (el("wk-consent-text") && a.consent_text) el("wk-consent-text").value = a.consent_text;
      if (el("wk-consent-button") && a.consent_button) el("wk-consent-button").value = a.consent_button;
      // Kachel-Layer an den (evtl. neuen) Stil anpassen
      if (map && tileLayer && el("wk-tile")) {
        try { map.removeLayer(tileLayer); } catch (_) {}
        tileLayer = tileFor(el("wk-tile").value).addTo(map);
      }
      // Beschriftungen neu aus dem Projekt aufbauen
      labels = normLabels(a.labels);
      renderLabelList();
      if (map) { rebuildLabels(); drawTrack(); }
    }

    function drawTrack() {
      [trackLine, startPin, endPin].forEach((x) => { if (x) { try { map.removeLayer(x); } catch (_) {} } });
      trackLine = startPin = endPin = null;
      if (!track || track.length < 2) return;
      const color = el("wk-color")?.value || "#ff6b35";
      const width = parseFloat(el("wk-width")?.value) || 4.5;
      trackLine = L.polyline(track, { color, weight: width, opacity: 0.95, lineJoin: "round", lineCap: "round" }).addTo(map);
      const pin = (c) => L.divIcon({ className: "wk-pin", iconSize: [20, 20], iconAnchor: [10, 10],
        html: '<span style="display:block;width:14px;height:14px;border-radius:50%;background:' + c + ';border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5)"></span>' });
      startPin = L.marker(track[0], { icon: pin("#2ecc71"), interactive: false }).addTo(map);
      endPin = L.marker(track[track.length - 1], { icon: pin("#e74c3c"), interactive: false }).addTo(map);
      try { map.fitBounds(trackLine.getBounds(), { padding: [30, 30] }); } catch (_) {}
    }

    async function loadTrack() {
      const gpxPath = (typeof getGlobalGpxPath === "function") ? getGlobalGpxPath() : "";
      if (!gpxPath) { status(T("webkarte.no_gpx", "Erst eine GPX-Datei laden.")); return; }
      status(T("webkarte.loading", "Lade Track …"));
      try {
        const res = await window.pywebview.api.webkarte_prepare({ gpx_path: gpxPath });
        if (destroyed) return;
        if (!res || !res.ok) { status(T("webkarte.load_fail", "Track laden fehlgeschlagen") + ": " + (res?.error || "?")); return; }
        track = res.track || [];
        drawTrack();
        status("");
      } catch (e) { if (!destroyed) status(String(e)); }
    }

    function collectParams() {
      return {
        gpx_path: (typeof getGlobalGpxPath === "function") ? getGlobalGpxPath() : "",
        tile_style: el("wk-tile")?.value || "osm",
        line_color: el("wk-color")?.value || "#ff6b35",
        line_width: parseFloat(el("wk-width")?.value) || 4.5,
        show_pins: true,
        labels: labels.map((l) => ({ lat: l.lat, lon: l.lon, text: l.text, color: l.color, size: l.size })),
        consent_enabled: !!el("wk-consent")?.checked,
        consent_text: (el("wk-consent-text")?.value || "").trim() || DEFAULT_CONSENT,
        consent_button: (el("wk-consent-button")?.value || "").trim() || T("tourmap.html.consent_button_default", "Karte laden"),
        ...(map ? (() => { const c = map.getCenter(); return { view_center: [c.lat, c.lng], view_zoom: map.getZoom() }; })() : {}),
        width: 1120, height: 640,
      };
    }

    async function doExport() {
      const btn = el("wk-export");
      const gpxPath = (typeof getGlobalGpxPath === "function") ? getGlobalGpxPath() : "";
      if (!gpxPath) { if (typeof toast === "function") toast(T("webkarte.no_gpx", "Erst eine GPX-Datei laden."), "warn", 3000); return; }
      const old = btn.textContent; btn.disabled = true; btn.textContent = "⏳ " + T("tourmap.html.exporting", "Exportiere HTML …");
      try {
        const res = await window.pywebview.api.webkarte_export(collectParams());
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
        <textarea id="wk-snippet" readonly rows="5" style="width:100%; font-family:ui-monospace,Menlo,monospace; font-size:10px; box-sizing:border-box;"></textarea>`;
      const footer = `
        <button type="button" id="wk-open" class="btn btn-primary">▶ ${T("tourmap.html.open_browser", "Im Browser öffnen")}</button>
        <button type="button" id="wk-copy" class="btn btn-secondary">${T("tourmap.html.copy", "Snippet kopieren")}</button>
        <button type="button" id="wk-reveal" class="btn btn-secondary">${T("animator.btn.reveal", "Im Finder zeigen")}</button>
        <button type="button" id="wk-close" class="btn btn-secondary">${T("tourmap.html.close", "Schließen")}</button>`;
      const modal = (typeof openModal === "function") ? openModal({ title: T("tourmap.html.modal_title", "HTML exportiert"), body: bodyHtml, footer }) : null;
      const ta = el("wk-snippet"); if (ta) ta.value = res.snippet || "";
      el("wk-open")?.addEventListener("click", () => { try { window.pywebview.api.tourmap_open_in_browser(res.output); } catch (_) {} });
      el("wk-reveal")?.addEventListener("click", () => { try { window.pywebview.api.reveal_in_finder(res.output); } catch (_) {} });
      el("wk-close")?.addEventListener("click", () => { if (modal) modal.close(); });
      el("wk-copy")?.addEventListener("click", () => { try { if (ta) { ta.focus(); ta.select(); } document.execCommand("copy"); if (typeof toast === "function") toast(T("tourmap.html.copied", "Snippet kopiert."), "info", 2500); } catch (_) {} });
    }

    // ── Karte init ─────────────────────────────────────────────────────────
    (function initMap() {
      const host = el("wk-map");
      if (!host || typeof L === "undefined" || !L.map) {
        if (host) host.innerHTML = '<div style="padding:20px;color:#c00;">Leaflet nicht geladen.</div>';
        return;
      }
      map = L.map(host, { scrollWheelZoom: true }).setView([51.16, 10.45], 5);
      tileLayer = tileFor(tileStyle0).addTo(map);
      _ro = new ResizeObserver(() => { try { map.invalidateSize(false); } catch (_) {} });
      _ro.observe(host);
      [120, 400, 900].forEach((ms) => setTimeout(() => { try { map.invalidateSize(false); } catch (_) {} }, ms));
      rebuildLabels();

      // Klick auf die Karte im „Hinzufügen"-Modus → neues Label.
      map.on("click", (e) => {
        if (!addMode) return;
        addMode = false; try { host.style.cursor = ""; } catch (_) {}
        el("wk-add-label")?.classList.remove("btn-primary");
        el("wk-add-label")?.classList.add("btn-secondary");
        addLabelAt(e.latlng.lat, e.latlng.lng);
      });
    })();

    // ── Listener ───────────────────────────────────────────────────────────
    el("wk-color")?.addEventListener("input", () => { save({ line_color: el("wk-color").value }); drawTrack(); });
    el("wk-width")?.addEventListener("input", () => { el("wk-width-val").textContent = el("wk-width").value; save({ line_width: parseFloat(el("wk-width").value) }); drawTrack(); });
    el("wk-tile")?.addEventListener("change", () => {
      const v = el("wk-tile").value; save({ tile_style: v });
      if (map && tileLayer) { try { map.removeLayer(tileLayer); } catch (_) {} tileLayer = tileFor(v).addTo(map); }
    });
    el("wk-add-label")?.addEventListener("click", () => {
      addMode = !addMode;
      const b = el("wk-add-label");
      b.classList.toggle("btn-primary", addMode); b.classList.toggle("btn-secondary", !addMode);
      try { el("wk-map").style.cursor = addMode ? "crosshair" : ""; } catch (_) {}
      status(addMode ? T("webkarte.click_to_place", "Auf die Karte klicken zum Platzieren …") : "");
    });

    // Label-Liste: Text/Farbe/Größe ändern + löschen (Event-Delegation, überlebt Re-Render).
    (function wireLabelList() {
      const box = el("wk-label-list"); if (!box) return;
      const idxOf = (e) => parseInt(e.target.getAttribute("data-idx"), 10);
      box.addEventListener("input", (e) => {
        const i = idxOf(e); if (!(i >= 0) || !labels[i]) return;
        if (e.target.classList.contains("wk-lbl-text")) { labels[i].text = e.target.value; updateTip(i); persistLabels(); }
        else if (e.target.classList.contains("wk-lbl-color")) { labels[i].color = e.target.value; updateTip(i); persistLabels(); }
      });
      box.addEventListener("change", (e) => {
        const i = idxOf(e); if (!(i >= 0) || !labels[i]) return;
        if (e.target.classList.contains("wk-lbl-size")) { labels[i].size = Number(e.target.value) || LBL_SIZE0; updateTip(i); persistLabels(); }
      });
      box.addEventListener("click", (e) => {
        const btn = e.target.closest(".wk-lbl-del"); if (!btn) return;
        const i = parseInt(btn.getAttribute("data-idx"), 10);
        if (!(i >= 0) || !labels[i]) return;
        labels.splice(i, 1); persistLabels(); rebuildLabels(); renderLabelList();
      });
    })();
    el("wk-consent")?.addEventListener("change", () => {
      const on = !!el("wk-consent").checked; save({ consent_enabled: on });
      el("wk-consent-fields").style.display = on ? "" : "none";
    });
    el("wk-consent-text")?.addEventListener("change", () => save({ consent_text: el("wk-consent-text").value }));
    el("wk-consent-button")?.addEventListener("change", () => save({ consent_button: el("wk-consent-button").value }));
    el("wk-export")?.addEventListener("click", doExport);

    if (typeof onGpxLoaded === "function") {
      try { _gpxUnsub = onGpxLoaded(() => { if (!destroyed) loadTrack(); }); } catch (_) {}
    }
    // Bei Session-/Projekt-Wechsel alle Einstellungen + Labels neu übernehmen
    // (deckt auch den Fall ab, dass das Projekt erst NACH dem Mount bereitsteht).
    if (typeof onSessionChanged === "function") {
      try { _sessUnsub = onSessionChanged(() => { if (!destroyed) applyProjectState(); }); } catch (_) {}
    }
    applyProjectState();   // Stand aus dem (evtl. schon aktiven) Projekt sofort anwenden
    loadTrack();

    return function () {
      destroyed = true;
      try { if (_gpxUnsub) _gpxUnsub(); } catch (_) {}
      try { if (_sessUnsub) _sessUnsub(); } catch (_) {}
      try { if (_ro) _ro.disconnect(); } catch (_) {}
      try { if (map) map.remove(); } catch (_) {}
      map = null; _ro = null; _gpxUnsub = null; _sessUnsub = null;
    };
  }

  (window.RZGPS_MODULES = window.RZGPS_MODULES || {}).webkarte = {
    manifest: {
      slug: "webkarte",
      name: "Web Karte",
      description: "Interaktive Karte fürs Web",
      icon: "🌐",
      sort_order: 45,
    },
    mount: mountWebKarte,
  };
})();
