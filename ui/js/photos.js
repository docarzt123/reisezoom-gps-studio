/*
 * ui/js/photos.js — Shared Foto-Pin-Renderer für Animator + Tour-Map (v0.9.74).
 *
 * Global API auf `window.PhotoPins`:
 *   - PhotoPins.attachToMap(map, photos, opts)     — addImage + Symbol-Layer
 *   - PhotoPins.updateSize(map, sizePx)            — Größe ändern (re-style)
 *   - PhotoPins.detach(map)                        — Layer + Source + Images entfernen
 *   - PhotoPins.flyTo(map, photo, zoom?)           — Map auf Foto zentrieren
 *   - PhotoPins.renderList(container, photos, onClick)  — Sidebar-Liste
 *   - PhotoPins.dedupePaths(existing, fresh)       — Path-Dedup beim Merge
 *
 * Layer-Konvention pro Map:
 *   Source:  'photo-pins-src'
 *   Layer:   'photo-pins-lyr'  (Symbol-Layer mit nummerierten Badge-Icons)
 *   Image-IDs: 'photo-num-<n>' (Canvas-Badge pro Nummer, `addImage`)
 *
 * v0.9.305 — Optik-Umbau (Marc): statt schwebender Thumbnails jetzt
 * **nummerierte Kreise** (1,2,3… in Track-Reihenfolge). Das Thumbnail
 * erscheint nur als **Hover-Vorschau** in der Live-Preview (kein Teil des
 * Renders). Die Badges sind Canvas-generierte Bilder → font-unabhängig und
 * im Preview + Render identisch (WYSIWYG).
 *
 * Aufruf-Pattern (Animator + Tour-Map identisch):
 *   1. Beim Mount/Aktivate: PhotoPins.attachToMap(map, project.photos, {sizePx})
 *   2. Bei Slider-Move: PhotoPins.updateSize(map, newSizePx)
 *   3. Bei Add/Remove: erst PhotoPins.detach(map), dann attachToMap mit neuer Liste
 *   4. Bei Unmount: PhotoPins.detach(map)
 *
 * WYSIWYG: das Render-Backend (core/animator.py + core/tourmap.py)
 * verwendet denselben Badge-Aufbau (gleiche IDs, gleiche Canvas-Zeichnung).
 */
(function () {
  "use strict";

  const SRC_ID = "photo-pins-src";
  const LAYER_ID = "photo-pins-lyr";
  const IMG_PREFIX = "photo-thumb-";   // Legacy-Cleanup in detach()
  const BADGE_PREFIX = "photo-num-";
  const PIN_FILL = "#ff385c";
  const PIN_STROKE = "#ffffff";
  const PIN_TEXT = "#ffffff";

  function _escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g,
      c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // Canvas-Badge (Kreis + Nummer) → ImageData für Mapbox addImage.
  // Identisch (1:1) zur JS-Funktion in core/animator.py / core/tourmap.py.
  function _makeBadgeImageData(num) {
    const S = 48;                          // 24 CSS-px @ pixelRatio 2
    const c = document.createElement("canvas");
    c.width = S; c.height = S;
    const ctx = c.getContext("2d");
    const cx = S / 2, cy = S / 2, r = S / 2 - 4;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.35)"; ctx.shadowBlur = 4; ctx.shadowOffsetY = 1;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = PIN_FILL; ctx.fill();
    ctx.restore();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.lineWidth = 3; ctx.strokeStyle = PIN_STROKE; ctx.stroke();
    const label = String(num);
    const fs = label.length >= 3 ? 18 : (label.length === 2 ? 22 : 26);
    ctx.fillStyle = PIN_TEXT;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "bold " + fs + 'px -apple-system, system-ui, Arial, sans-serif';
    ctx.fillText(label, cx, cy + 1);
    return ctx.getImageData(0, 0, S, S);
  }

  // v0.9.77 — visible-Flag: photo.visible === false → nicht auf der Map.
  // Default ist true (Backward-Compat zu v0.9.76 wo das Feld noch nicht
  // existierte).
  function _isVisible(p) {
    return !p || p.visible !== false;
  }

  function _toGeoJson(photos) {
    // Nur sichtbare Fotos kommen in die Features-Liste. Index bleibt aber
    // global (für stabile Feature-IDs / Hover-Lookup).
    const vis = (photos || []).map((p, i) => ({ p, i })).filter(({ p }) => _isVisible(p));
    // Nummerierung 1..N in TRACK-Reihenfolge (track_anchor), sonst Array-Order.
    const order = vis.slice().sort((a, b) => {
      const ta = typeof a.p.track_anchor === "number" ? a.p.track_anchor : a.i;
      const tb = typeof b.p.track_anchor === "number" ? b.p.track_anchor : b.i;
      return ta - tb;
    });
    const numByIdx = new Map();
    order.forEach((o, k) => numByIdx.set(o.i, k + 1));
    return {
      type: "FeatureCollection",
      features: vis.map(({ p, i }) => {
        const num = numByIdx.get(i) || 1;
        return {
          type: "Feature",
          id: i,
          properties: {
            idx: i,
            path: p.path,
            num: num,
            badgeId: `${BADGE_PREFIX}${num}`,
            // v0.9.79 — Track-Anchor (0..1) für Mapbox-Filter
            // [„<=", [„get", „track_anchor"], currentMarkerAnchor].
            track_anchor: typeof p.track_anchor === "number" ? p.track_anchor : 0,
          },
          geometry: {
            type: "Point",
            coordinates: [Number(p.lon), Number(p.lat)],
          },
        };
      }),
    };
  }

  // v0.9.79 — Berechnet pro Foto den nächsten Track-Punkt-Index (Euklidische
  // Distanz auf lon/lat — ausreichend für Distanzen im km-Bereich). Schreibt
  // das Ergebnis als `photo.track_anchor` direkt aufs Objekt (Mutation des
  // Caller-Arrays, weil das die billigere Variante ist als alles zu klonen).
  //
  // Animator-Use-Case: Foto erscheint im Render erst wenn `marker_anchor >=
  // photo.track_anchor` — also sobald der Track-Marker das Foto passiert.
  // Tour-Map ignoriert das Anchor (alles permanent sichtbar).
  function computeTrackAnchors(photos, coords) {
    if (!Array.isArray(photos) || !photos.length) return;
    if (!Array.isArray(coords) || coords.length < 2) {
      // Kein Track da → alle Fotos sofort sichtbar (anchor 0).
      for (const p of photos) p.track_anchor = 0;
      return;
    }
    const n = coords.length;
    for (const p of photos) {
      if (p == null || p.lon == null || p.lat == null) {
        if (p) p.track_anchor = 0;
        continue;
      }
      let bestIdx = 0;
      let bestSqDist = Infinity;
      const lon = Number(p.lon), lat = Number(p.lat);
      for (let i = 0; i < n; i++) {
        const dlon = coords[i][0] - lon;
        const dlat = coords[i][1] - lat;
        const d = dlon * dlon + dlat * dlat;
        if (d < bestSqDist) {
          bestSqDist = d;
          bestIdx = i;
        }
      }
      p.track_anchor = bestIdx / (n - 1);
    }
  }

  function _loadImage(url) {
    // Promise → HTMLImageElement (Mapbox addImage akzeptiert das)
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(e);
      img.src = url;
    });
  }

  // v0.9.76 — Per-Map-Cache der letzten attach-Parameter, damit wir nach
  // Style-Wechsel (= alle Sources/Layers/Images werden gewiped) automatisch
  // wieder reattachen können. Key: map-Instanz; Value: { photos, opts }.
  const _attachState = new WeakMap();

  async function attachToMap(map, photos, opts) {
    if (!map || typeof map.addSource !== "function") return;
    photos = Array.isArray(photos) ? photos : [];
    opts = opts || {};

    // v0.9.79 — Track-Anchors berechnen wenn coords übergeben werden.
    // Mutiert die photo-Objekte in-place (Animator passt das nach Track-Wechsel
    // neu an, Tour-Map ignoriert das Feld).
    if (Array.isArray(opts.coords) && opts.coords.length >= 2) {
      computeTrackAnchors(photos, opts.coords);
      // v0.9.80 — Debug-Log damit Marc per DevTools sieht was die Anchors sind
      console.log("[photo-pins] computed track_anchors:",
        photos.map(p => ({ name: (p.path || "").split("/").pop(),
                           anchor: p.track_anchor })));
    } else if (typeof opts.markerAnchor === "number") {
      console.warn("[photo-pins] markerAnchor übergeben, aber KEIN coords-Array → " +
        "track_anchors bleiben 0 → ALLE Pins werden bei jedem markerAnchor>=0 sichtbar. " +
        "Caller sollte coords mitgeben.");
    }

    // State cachen + Style-Change-Listener nur einmal pro Map installieren.
    _attachState.set(map, { photos: photos.slice(), opts: { ...opts } });
    if (!map.__rzPhotoStyleHook) {
      map.__rzPhotoStyleHook = true;
      // Bei jedem Style-Wechsel sind alle addImage/Source/Layer weg. Sobald
      // der neue Style geladen ist, mit gecachten Werten neu attachen.
      // v0.9.76 — Mapbox-Style-Wechsel-Race war Marc-Bug „Fotos nicht in
      // der Preview sichtbar".
      map.on("style.load", () => {
        const st = _attachState.get(map);
        if (st && st.photos && st.photos.length) {
          // Nach style.load ist isStyleLoaded() schon true, attach geht direkt.
          attachToMap(map, st.photos, st.opts);
        }
      });
    }

    const sizePx = Math.max(12, Math.min(200, +opts.sizePx || 48));

    // v0.9.76 — Race-Condition-Fix: wenn der Map-Style noch nicht fertig
    // geladen ist, ist addSource/addLayer ein No-Op (oder Crash je nach
    // Mapbox-Version). Auf style.load warten und dann nochmal versuchen.
    if (typeof map.isStyleLoaded === "function" && !map.isStyleLoaded()) {
      map.once("idle", () => attachToMap(map, photos, opts));
      return;
    }

    // Vorherigen Layer + Source + Images aufräumen, falls vorhanden
    detach(map);

    // v0.9.77 — Nur sichtbare Fotos für GeoJSON.
    const visiblePhotos = photos.filter(_isVisible);
    if (!visiblePhotos.length) return;  // alle abgewählt = leere Map

    // v0.9.305 — GeoJSON enthält pro Feature `num` (Track-Reihenfolge) +
    // `badgeId`. Pro Nummer EIN Canvas-Badge als Mapbox-Image registrieren
    // (dedupliziert über badgeId).
    const gj = _toGeoJson(photos);
    const seenBadges = new Set();
    for (const f of gj.features) {
      const badgeId = f.properties.badgeId;
      if (seenBadges.has(badgeId)) continue;
      seenBadges.add(badgeId);
      try {
        if (!map.hasImage(badgeId)) {
          map.addImage(badgeId, _makeBadgeImageData(f.properties.num), { pixelRatio: 2 });
        }
      } catch (e) {
        console.warn("[photo-pins] badge addImage failed", badgeId, e);
      }
    }

    try {
      if (map.getSource(SRC_ID)) {
        // Falls ein paralleler Call (style.load-Race) schon was angelegt hat.
        try { map.removeLayer(LAYER_ID); } catch (_) {}
        try { map.removeSource(SRC_ID); } catch (_) {}
      }
      map.addSource(SRC_ID, { type: "geojson", data: gj });
      const layerDef = {
        id: LAYER_ID,
        type: "symbol",
        source: SRC_ID,
        layout: {
          "icon-image": ["get", "badgeId"],
          // Badge ist 24 CSS-px groß (icon-size 1). sizePx/48 → Default 48 = 24 px.
          "icon-size": sizePx / 48,
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "icon-anchor": "center",
        },
      };
      // v0.9.79 — Initial-Filter (wenn markerAnchor übergeben). Foto-Pin nur
      // sichtbar wenn track_anchor <= markerAnchor — sprich Foto erscheint
      // erst wenn der Track-Marker dort vorbei gekommen ist.
      if (typeof opts.markerAnchor === "number") {
        layerDef.filter = ["<=", ["get", "track_anchor"], opts.markerAnchor];
      }
      map.addLayer(layerDef);
      _setupHover(map);
    } catch (e) {
      console.warn("[photo-pins] addSource/addLayer fehlgeschlagen", e);
    }
  }

  // v0.9.305 — Hover-Vorschau: über einem nummerierten Pin poppt das Thumbnail
  // auf (nur Live-Preview, NICHT Teil des Renders). Pro Map einmal installiert.
  function _setupHover(map) {
    if (map.__rzPhotoHover) return;
    const PopupCtor = (window.maplibregl && window.maplibregl.Popup) ||
                      (window.mapboxgl && window.mapboxgl.Popup);
    if (!PopupCtor) return;
    map.__rzPhotoHover = true;
    const popup = new PopupCtor({
      closeButton: false, closeOnClick: false, offset: 16, className: "photo-hover-popup",
    });
    map.on("mouseenter", LAYER_ID, (e) => {
      try { map.getCanvas().style.cursor = "pointer"; } catch (_) {}
      const f = e.features && e.features[0];
      if (!f) return;
      const st = _attachState.get(map);
      const p = st && st.photos && st.photos[f.properties.idx];
      if (!p || !p.thumb) return;
      const name = (p.path || "").split("/").pop();
      popup.setLngLat(f.geometry.coordinates)
        .setHTML(
          '<div class="photo-hover-card">' +
          '<img src="' + _escHtml(p.thumb) + '" alt="">' +
          '<span class="photo-hover-cap">#' + _escHtml(f.properties.num) +
          " · " + _escHtml(name) + "</span></div>")
        .addTo(map);
    });
    map.on("mouseleave", LAYER_ID, () => {
      try { map.getCanvas().style.cursor = ""; } catch (_) {}
      popup.remove();
    });
  }

  // v0.9.79 — Live-Update des Anchor-Filters. Wird vom Animator pro
  // scrubPreview-Step / Probe-Lauf-Frame aufgerufen. Sehr günstig: Mapbox
  // re-evaluiert die Expression in einem GPU-Pass.
  function setMarkerAnchor(map, markerAnchor) {
    if (!map || typeof map.getLayer !== "function") return;
    if (!map.getLayer(LAYER_ID)) return;
    try {
      if (markerAnchor == null) {
        // Filter komplett entfernen → alle Fotos sichtbar (Phase-1-Modus)
        map.setFilter(LAYER_ID, null);
      } else {
        map.setFilter(LAYER_ID, ["<=", ["get", "track_anchor"], Number(markerAnchor)]);
      }
    } catch (e) {
      console.warn("[photo-pins] setMarkerAnchor failed:", e);
    }
  }

  function updateSize(map, sizePx) {
    if (!map || typeof map.getLayer !== "function") return;
    if (!map.getLayer(LAYER_ID)) return;
    const v = Math.max(12, Math.min(200, +sizePx || 48));
    try {
      map.setLayoutProperty(LAYER_ID, "icon-size", v / 48);
    } catch (e) {
      // setLayoutProperty kann während style-loading werfen — egal,
      // beim nächsten attachToMap greift's wieder.
    }
  }

  function detach(map) {
    if (!map) return;
    try {
      if (map.getLayer && map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (map.getSource && map.getSource(SRC_ID)) map.removeSource(SRC_ID);
    } catch (e) { /* ignore */ }
    // Badge-Images (+ Legacy-Thumb-Images) entfernen.
    try {
      if (map.listImages) {
        for (const id of map.listImages()) {
          if ((id.indexOf(BADGE_PREFIX) === 0 || id.indexOf(IMG_PREFIX) === 0) && map.hasImage(id)) {
            map.removeImage(id);
          }
        }
      }
    } catch (e) { /* ignore */ }
  }

  function flyTo(map, photo, zoom) {
    if (!map || !photo || photo.lon == null || photo.lat == null) return;
    const z = (zoom == null) ? Math.max(map.getZoom(), 14) : zoom;
    map.flyTo({ center: [photo.lon, photo.lat], zoom: z, duration: 800 });
  }

  function dedupePaths(existing, fresh) {
    // existing + fresh sind beide [{path, lon, lat, thumb, ...}]
    // Wir nehmen fresh als Source-of-Truth wenn ein Path doppelt ist.
    const map = new Map();
    for (const p of (existing || [])) {
      if (p && p.path) map.set(p.path, p);
    }
    for (const p of (fresh || [])) {
      if (p && p.path) map.set(p.path, p);
    }
    return Array.from(map.values());
  }

  /**
   * Render der Foto-Liste in der Sidebar.
   *
   * @param container - DOM-Container (wird komplett neu befüllt)
   * @param photos - Foto-Array
   * @param onClick - (photo, i) → void, optional. Bei Klick auf die Row
   *                  (NICHT auf die Checkbox).
   * @param onToggle - v0.9.77: (photo, i, visible) → void, optional.
   *                   Bei Klick/Change auf die per-Foto-Checkbox.
   */
  function renderList(container, photos, onClick, onToggle) {
    if (!container) return;
    container.innerHTML = "";
    if (!photos || !photos.length) {
      const empty = document.createElement("div");
      empty.className = "photos-list-empty";
      empty.textContent = (window.t && window.t("photos.list_empty")) || "Keine Fotos geladen.";
      container.appendChild(empty);
      return;
    }
    for (let i = 0; i < photos.length; i++) {
      const p = photos[i];
      const row = document.createElement("div");
      row.className = "photos-list-row";
      if (!_isVisible(p)) row.classList.add("photos-list-row--hidden");
      row.title = p.path || "";

      // v0.9.77 — Visibility-Checkbox links vor dem Thumbnail
      const checkLabel = document.createElement("label");
      checkLabel.className = "photos-list-check";
      checkLabel.title = (window.t && window.t("photos.visible_hint")) || "Auf Karte anzeigen";
      // Click auf Checkbox darf NICHT die Row-onClick triggern (= flyTo).
      checkLabel.addEventListener("click", (e) => e.stopPropagation());
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = _isVisible(p);
      cb.addEventListener("change", () => {
        if (typeof onToggle === "function") onToggle(p, i, cb.checked);
      });
      checkLabel.appendChild(cb);
      row.appendChild(checkLabel);

      // v0.9.76 — IMMER ein Thumb-Slot (Image ODER Placeholder), nie leer.
      // Marc-Bug v0.9.75: ohne Image war die Row 0px hoch, Name unsichtbar.
      if (p.thumb) {
        const img = document.createElement("img");
        img.className = "photos-list-thumb";
        img.src = p.thumb;
        img.alt = "";
        img.loading = "lazy";
        // Wenn das Image nicht lädt (defekte data-URL etc.) → Placeholder
        img.onerror = () => {
          const ph = document.createElement("div");
          ph.className = "photos-list-thumb-placeholder";
          ph.textContent = "📷";
          row.replaceChild(ph, img);
        };
        row.appendChild(img);
      } else {
        const ph = document.createElement("div");
        ph.className = "photos-list-thumb-placeholder";
        ph.textContent = "📷";
        row.appendChild(ph);
      }
      // Name + Koordinaten
      const meta = document.createElement("div");
      meta.className = "photos-list-meta";
      const nameEl = document.createElement("div");
      nameEl.className = "photos-list-name";
      const base = (p.path || "").split("/").pop() || "(unbenannt)";
      nameEl.textContent = base;
      const coordEl = document.createElement("div");
      coordEl.className = "photos-list-coord";
      if (p.lat != null && p.lon != null) {
        coordEl.textContent = `${Number(p.lat).toFixed(5)}, ${Number(p.lon).toFixed(5)}`;
      } else {
        coordEl.textContent = "(kein GPS)";
      }
      meta.appendChild(nameEl);
      meta.appendChild(coordEl);
      row.appendChild(meta);
      if (typeof onClick === "function") {
        row.style.cursor = "pointer";
        row.addEventListener("click", () => onClick(p, i));
      }
      container.appendChild(row);
    }
  }

  /**
   * v0.9.75 — Pick-Choice-Modal. Marc-Spec: ein Button „Fotos wählen",
   * Klick öffnet kleines Modal mit zwei Optionen (Ordner / einzelne Dateien).
   *
   * @param {object} opts — { onFolder: (path) => void, onFiles: (paths) => void }
   * Beide Callbacks werden mit den vom nativen Picker zurückgegebenen Pfaden
   * gerufen. Bei Cancel wird KEIN Callback gerufen.
   */
  function openPickChoice(opts) {
    opts = opts || {};
    const tt = (k, fallback) => (window.t ? window.t(k, fallback) : fallback);
    // Vorhandenes Modal aufräumen (defensiv bei doppeltem Klick)
    document.querySelectorAll(".photo-pick-modal-backdrop").forEach(n => n.remove());

    const backdrop = document.createElement("div");
    backdrop.className = "photo-pick-modal-backdrop";

    const modal = document.createElement("div");
    modal.className = "photo-pick-modal";

    const h3 = document.createElement("h3");
    h3.textContent = tt("photos.pick_modal_title", "Fotos wählen");
    modal.appendChild(h3);

    const choices = document.createElement("div");
    choices.className = "photo-pick-choices";

    function mkBtn(icon, label, sub, onClick) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "photo-pick-btn";
      const ic = document.createElement("span");
      ic.className = "photo-pick-btn-icon";
      ic.textContent = icon;
      const txt = document.createElement("span");
      txt.className = "photo-pick-btn-text";
      const lab = document.createElement("span");
      lab.textContent = label;
      const subEl = document.createElement("span");
      subEl.className = "photo-pick-btn-sub";
      subEl.textContent = sub;
      txt.appendChild(lab);
      txt.appendChild(subEl);
      b.appendChild(ic);
      b.appendChild(txt);
      b.addEventListener("click", async () => {
        close();
        try { await onClick(); } catch (e) { console.warn("[photo-pick]", e); }
      });
      return b;
    }

    choices.appendChild(mkBtn(
      "📂",
      tt("photos.pick_choice_folder", "Aus Ordner"),
      tt("photos.pick_choice_folder_sub", "Alle Fotos eines Ordners scannen"),
      async () => {
        if (!window.pywebview?.api?.pick_file) return;
        const res = await window.pywebview.api.pick_file("folder", []);
        if (res && res.length && typeof opts.onFolder === "function") {
          opts.onFolder(res[0]);
        }
      }
    ));
    choices.appendChild(mkBtn(
      "📷",
      tt("photos.pick_choice_files", "Einzelne Fotos"),
      tt("photos.pick_choice_files_sub", "Mehrere Bilder gezielt auswählen"),
      async () => {
        if (!window.pywebview?.api?.pick_file) return;
        // file_types: JPEG/HEIC/RAW. Native Dialog ignoriert das auf macOS
        // teilweise, aber gibt einen Filter-Hint im Open-Sheet.
        const fileTypes = [
          "Bilder (*.jpg;*.jpeg;*.heic;*.heif;*.png;*.tif;*.tiff;*.cr3;*.cr2;*.nef;*.arw;*.raf;*.rw2;*.orf;*.dng)",
          "Alle Dateien (*.*)",
        ];
        const res = await window.pywebview.api.pick_file("open", fileTypes, true);
        if (res && res.length && typeof opts.onFiles === "function") {
          opts.onFiles(res);
        }
      }
    ));

    modal.appendChild(choices);

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "photo-pick-cancel";
    cancel.textContent = tt("common.cancel", "Abbrechen");
    cancel.addEventListener("click", () => close());
    modal.appendChild(cancel);

    backdrop.appendChild(modal);
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close();
    });
    function close() {
      backdrop.remove();
      document.removeEventListener("keydown", onKey);
    }
    function onKey(e) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey);
    document.body.appendChild(backdrop);
  }

  window.PhotoPins = {
    attachToMap,
    updateSize,
    detach,
    flyTo,
    dedupePaths,
    renderList,
    openPickChoice,
    // v0.9.79 — Phase 2: Foto-pop-in
    computeTrackAnchors,
    setMarkerAnchor,
    // Für Render-Backend-Konsumenten / Tests
    _SRC_ID: SRC_ID,
    _LAYER_ID: LAYER_ID,
    _IMG_PREFIX: IMG_PREFIX,
  };
})();
