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
  // v0.9.322 — Undo für ALLE Geotagger-Controls (vorher nur 4 Keys). DOM-Snapshot:
  // erfasst/stellt alle Panel-Controls direkt her + feuert deren Events (Offset →
  // Match-Neuberechnung, Checkboxen, Backup/Überschreiben usw.).
  // v0.9.359 — Undo deckt jetzt AUCH den Geotagger-JS-State ab (manuelle
  // Platzierungen, EXIF-Edits, Adressen, Richtungen, Häkchen, Pro-Kamera-Offsets,
  // Referenzbild) — nicht nur die Panel-Controls. `_gtUndoCaptureState`/
  // `_gtUndoRestoreState` sind weiter unten als hoisted-Functions definiert.
  const _gtgUndoCtrl = window.rzMakePanelUndoController("gt-panel", {
    section: "geotagger",
    toast: (msg) => { if (typeof toast === "function") toast(msg, "info", 1000); },
    extraSnapshot: () => _gtUndoCaptureState(),
    extraApply: (x) => _gtUndoRestoreState(x),
  });
  window.__rzUndoControllers.geotagger = _gtgUndoCtrl;
  const _gtgPushUndo = (label, opts) => _gtgUndoCtrl.push(label, opts);
  // v0.9.322 — Push-Listener verdrahtet jetzt rzMakePanelUndoController selbst
  // (Pre-Change-Erfassung). Diese Funktion bleibt als No-Op für Altaufrufe.
  function _wireGeotaggerUndoListeners() { /* siehe rzMakePanelUndoController */ }
  const _origGtgProjChanged = window._geotaggerOnProjectChanged;
  window._geotaggerOnProjectChanged = function() {
    _gtgUndoCtrl.reset();
    if (typeof _origGtgProjChanged === "function") _origGtgProjChanged();
  };
  // ── /Undo-Redo ──────────────────────────────────────────────────────────

  // v0.9.351 — kompaktes „?"-Hilfe-Badge mit Hover-Tooltip (statt langer
  // Erklärungstexte in der Sidebar). Text steht im title-Attribut.
  const _q = (key, fb) => `<span class="gt-help" tabindex="0" title="${_gtEsc(t(key, fb))}">?</span>`;

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
        <div class="section-title">${t("geotagger.section.offset")}${_q("geotagger.offset.help_tooltip")}</div>

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

        <!-- v0.9.364 — Pro-Kamera: eingebettetes Foto-GPS ignorieren und stattdessen
             nach Aufnahmezeit auf den Track setzen (z.B. Handy mit ungenauem CELLID-GPS). -->
        <label class="checkbox-row" id="gt-ignore-gps-row" style="margin-top:8px;">
          <input type="checkbox" id="gt-ignore-gps">
          <span>${t("geotagger.ignore_gps.label", "Foto-eigenes GPS ignorieren")}${_q("geotagger.ignore_gps.help", "Setzt Fotos dieser Kamera nach Aufnahmezeit auf den Track — statt ihr eingebettetes GPS zu nutzen. Ideal für Handys mit ungenauer Funkzellen-Ortung. Gilt für die oben gefilterte Kamera (ohne Filter = Standard für alle).")}</span>
        </label>
        <div class="small-info" id="gt-ignore-gps-ctx" style="display:none; margin-left:24px;"></div>

        <!-- v0.9.370 — Pro-Kamera: Aufnahmezeit exakt auf die (lokale) Track-Zeit setzen.
             Damit laufen zwei Kameras mit unterschiedlich gestellter Uhr in Lightroom
             zeitlich synchron. GPS bleibt korrekt (nur die Aufnahmezeit wird gesetzt). -->
        <label class="checkbox-row" id="gt-set-time-row" style="margin-top:8px;">
          <input type="checkbox" id="gt-set-time-from-track">
          <span>${t("geotagger.settime.label", "Aufnahmezeit auf Track-Zeit setzen")}${_q("geotagger.settime.help", "Schreibt bei allen gematchten Fotos dieser Kamera die (lokale) Uhrzeit des getroffenen Track-Punkts als Aufnahmezeit. So laufen zwei Kameras mit falsch gestellter Uhr in Lightroom zeitlich synchron. Das GPS bleibt korrekt. Gilt für die oben gefilterte Kamera (ohne Filter = Standard für alle).")}</span>
        </label>
        <div class="small-info" id="gt-set-time-ctx" style="display:none; margin-left:24px;"></div>
      </div>

      <!-- v0.9.166 — Fotos manuell auf der Karte platzieren -->
      <div class="section">
        <div class="section-title">${t("geotagger.section.place", "Manuell platzieren")}${_q("geotagger.place.hint", "Zieh ein Foto aus der Liste auf die Karte — die Koordinaten werden dann geschrieben. Funktioniert auch ohne Track.")}</div>
        <label class="checkbox-row">
          <input type="checkbox" id="gt-snap-track">
          <span>${t("geotagger.place.snap_toggle", "Auf Track einrasten")}${_q("geotagger.place.cmd_hint", "⌘ beim Ablegen kehrt das kurz um. Ohne geladenen Track werden Fotos frei platziert.")}</span>
        </label>
      </div>

      <div class="divider"></div>

      <div class="section">
        <div class="section-title">${t("geotagger.section.write")}</div>
        <!-- v0.9.372 — „Backup-ZIP"-Checkbox entfernt: Originale werden nie mehr
             angefasst (Kopien in Zielordner), damit ist ein Backup überflüssig. -->
        <label class="field-label" style="font-size:12px; margin-top:6px; display:block;">${t("geotagger.mode.label", "Wenn ein Foto schon Daten hat")}${_q("geotagger.mode.help", "„Ergänzen“ lässt vorhandenes GPS in Ruhe und fügt nur fehlende Sachen (z.B. Adresse, Blickrichtung) hinzu. Ein im Foto gespeicherter Standort hat dann Vorrang vor der Zeit-Zuordnung.")}</label>
        <select id="gt-write-mode" style="width:100%;">
          <option value="fill">${t("geotagger.mode.fill", "Behalten, nur Fehlendes ergänzen")}</option>
          <option value="overwrite">${t("geotagger.mode.overwrite", "Alles überschreiben")}</option>
          <option value="skip_existing">${t("geotagger.mode.skip", "Fotos mit GPS ganz auslassen")}</option>
        </select>
        <label class="checkbox-row">
          <input type="checkbox" id="gt-adjust-time">
          <span>${t("geotagger.toggle.adjust_time")}</span>
        </label>

        <button class="btn btn-block" id="gt-geocode" style="margin-top:6px">${t("geotagger.btn.geocode", "📍 Adressen abrufen")}</button>
        <div class="small-info" id="gt-geocode-status" style="margin-top:4px; opacity:0.85;"></div>

        <!-- v0.9.346 — Globale Felder (Urheber/Copyright/…) für den ganzen Stapel -->
        <button class="btn btn-block btn-small" id="gt-global-fields" style="margin-top:8px">${t("geotagger.gf.btn", "✎ Globale Felder (Urheber, Copyright …)")}</button>
        <div class="small-info" id="gt-global-status" style="margin-top:4px; opacity:0.85;"></div>

        <!-- v0.9.349 — Auto-Tag per Bilderkennung (Apple Vision, nur macOS) -->
        <button class="btn btn-block btn-small" id="gt-autotag" style="margin-top:8px; display:none">${t("geotagger.autotag.btn", "🔍 Auto-Tag (Bilderkennung)")}</button>
        <div class="small-info" id="gt-autotag-status" style="margin-top:4px; opacity:0.85;"></div>

        <div class="match-summary" id="gt-summary" style="display:none"></div>

        <!-- v0.9.368 (Marc) — „Was wird geschrieben" direkt über den Schreib-Button. -->
        <div class="gt-wf-title">${t("geotagger.wf.title", "Was wird ins Foto geschrieben")}</div>
        <label class="checkbox-row gt-wf">
          <input type="checkbox" id="gt-wf-gps" checked disabled>
          <span>${t("geotagger.wf.gps", "GPS-Koordinaten")}</span>
        </label>
        <label class="checkbox-row gt-wf">
          <input type="checkbox" id="gt-wf-altitude" checked>
          <span>${t("geotagger.wf.altitude", "Höhe")}</span>
        </label>
        <label class="checkbox-row gt-wf">
          <input type="checkbox" id="gt-wf-direction" checked>
          <span>${t("geotagger.wf.direction", "Blickrichtung (Kompass)")}</span>
        </label>
        <label class="checkbox-row gt-wf">
          <input type="checkbox" id="gt-wf-address" checked>
          <span>${t("geotagger.wf.address", "Adresse (Ort, Land, Straße)")}</span>
        </label>
        <!-- v0.9.367 — Gruppen-Schalter: was du gesetzt/bearbeitet hast, wird nur
             geschrieben, wenn die Gruppe an ist (kein Häkchen pro Einzelfeld). -->
        <label class="checkbox-row gt-wf">
          <input type="checkbox" id="gt-wf-keywords" checked>
          <span>${t("geotagger.wf.keywords", "Stichwörter (Bilderkennung)")}${_q("geotagger.wf.keywords_help", "Schreibt die per Auto-Tag erkannten Stichwörter ins Foto. Aus = die Bilderkennungs-Keywords werden nicht geschrieben (bleiben aber gespeichert).")}</span>
        </label>
        <label class="checkbox-row gt-wf">
          <input type="checkbox" id="gt-wf-global" checked>
          <span>${t("geotagger.wf.global", "Globale Felder")}${_q("geotagger.wf.global_help", "Schreibt die im „Globale Felder“-Modal gesetzten Werte (Urheber, Copyright, Credit, Website …) auf alle sichtbaren Fotos. Aus = nichts davon schreiben, ohne die Werte zu löschen.")}</span>
        </label>
        <label class="checkbox-row gt-wf">
          <input type="checkbox" id="gt-wf-exif" checked>
          <span>${t("geotagger.wf.exif_edits", "Meine EXIF-Änderungen")}${_q("geotagger.wf.exif_edits_help", "Schreibt die im EXIF-Tab von Hand bearbeiteten oder per „+ Feld“ hinzugefügten Tags. Aus = deine manuellen EXIF-Änderungen werden nicht geschrieben (bleiben gespeichert).")}</span>
        </label>
        <button class="btn btn-primary btn-block" id="gt-write" disabled>${t("geotagger.btn.write")}</button>
      </div>
    </aside>

    <section class="canvas gt-content">
      <!-- v0.9.345 — kleines Warnbanner oben: ungespeicherte EXIF-Änderungen -->
      <div class="gt-unsaved-banner" id="gt-unsaved" hidden></div>
      <!-- v0.9.340 — Filterleiste OBEN über Fotos + Karte (Kameras + Kategorien).
           Wirkt auf Thumbnails UND Karten-Marker (echtes WYSIWYG). -->
      <div class="gt-filterbar" id="gt-filterbar"></div>
      <div class="gt-layout">
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
            <!-- v0.9.341 — Tabs: Info (Standort+Key-EXIF) | EXIF (alle Tags) -->
            <div class="gt-pv-tabs">
              <button type="button" class="gt-pv-tab active" data-pvtab="info">${t("geotagger.exif.tab_info", "Info")}</button>
              <button type="button" class="gt-pv-tab" data-pvtab="exif">${t("geotagger.exif.tab_exif", "EXIF")}</button>
            </div>
            <div class="gt-pv-page" id="gt-pv-info">
              <div class="map-preview-panel-meta" id="gt-preview-meta"></div>
              <div class="gt-pv-keyexif" id="gt-preview-keyexif"></div>
            </div>
            <div class="gt-pv-page" id="gt-pv-exif" style="display:none">
              <!-- v0.9.355 — kuratierte „zum Ausfüllen"-Felder (auch leer anklickbar) -->
              <div class="gt-exif-fill" id="gt-exif-fill"></div>
              <input type="text" id="gt-exif-search" class="gt-exif-search"
                     placeholder="${t("geotagger.exif.search_ph", "Feld suchen … (z. B. GPS)")}"
                     autocomplete="off" spellcheck="false">
              <div class="gt-pv-exiftable" id="gt-preview-exiftable"></div>
              <button type="button" class="gt-exif-addbtn" id="gt-exif-addfield">＋ ${t("geotagger.exif.add_field", "Feld hinzufügen")}</button>
            </div>
          </div>
        </div>
      </div>
      </div><!-- /.gt-layout -->
    </section>
  `;

  let map = null;
  let markers = [];           // mapboxgl.Marker
  let _gtSpider = { active: false, mks: [] };  // v0.9.347 — aufgefächerter Pin-Stapel (Spiderfy)
  let _compassMarker = null;  // v0.9.337 — interaktiver Aufnahmerichtungs-Kompass (selektiertes Foto)
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
  // v0.9.354 — Pro-Kamera-Zeit-Offset. Der globale Default (`_gtGlobalOffset`)
  // gilt für alle Kameras ohne eigenen Override; pro Kamera-Modell kann ein
  // abweichender Offset gesetzt werden. Slider + Referenz wirken auf die gerade
  // gefilterte Kamera (Filter „Alle" = globaler Default für alle Kameras).
  let _gtGlobalOffset = parseInt((_settingsCache && _settingsCache.geotagger
                                  && _settingsCache.geotagger.offset_seconds) || 0) || 0;
  const _gtCamOffsets = Object.assign({}, (_settingsCache && _settingsCache.geotagger
                                           && _settingsCache.geotagger.cam_offsets) || {});
  // v0.9.364 — Pro-Kamera: eigenes Foto-GPS ignorieren → nach Aufnahmezeit zuordnen.
  // Gleiches Muster wie der Offset: globaler Default + Pro-Kamera-Override.
  let _gtGlobalIgnoreGps = !!(_settingsCache && _settingsCache.geotagger
                              && _settingsCache.geotagger.ignore_gps);
  const _gtCamIgnoreGps = Object.assign({}, (_settingsCache && _settingsCache.geotagger
                                             && _settingsCache.geotagger.cam_ignore_gps) || {});
  // v0.9.370 — Pro-Kamera: Aufnahmezeit aus der Track-Zeit setzen (gleiches Muster).
  let _gtGlobalSetTime = !!(_settingsCache && _settingsCache.geotagger
                            && _settingsCache.geotagger.set_time_from_track);
  const _gtCamSetTime = Object.assign({}, (_settingsCache && _settingsCache.geotagger
                                           && _settingsCache.geotagger.cam_set_time_from_track) || {});
  // v0.9.337 — Reverse-Geocoding-Ergebnisse (path → Adress-Dict) + manuelle Richtung
  const _gtAddr = new Map();        // path → {display, city, state, country, street, …}
  const _gtDir = new Map();         // path → {dir:Number|null, src:"manual"} (Karten-Kompass)
  const _gtGeoSeen = new Set();     // Pfade die der Auto-Geocode schon angestoßen hat
  const _gtExif = new Map();        // path → {key:{…}, all:{…}} (volle EXIF, lazy gecacht)
  const _gtExifEdits = new Map();   // path → Map(tag → neuerWert) — ungespeicherte EXIF-Änderungen (v0.9.344)
  function _gtPendingExifCount() { let n = 0; _gtExifEdits.forEach(m => { n += m.size; }); return n; }
  function _gtPendingExifPhotos() { return _gtExifEdits.size; }
  function _gtRefreshWriteBtn() {
    const b = document.getElementById("gt-write");
    if (b) {
      const hasGps = matches.some(m => m.lat != null && m.in_range && _gtMatchTaggable(m));
      const hasGlobal = Object.keys(_gtGlobalTags()).length > 0 && _gtGlobalTargetPhotos().length > 0;
      b.disabled = !(hasGps || _gtPendingExifCount() > 0 || hasGlobal);
    }
    _gtUpdateUnsavedBanner();
  }
  // v0.9.345 — kleines Warnbanner oben anzeigen, solange EXIF-Änderungen ausstehen
  function _gtUpdateUnsavedBanner() {
    const el = document.getElementById("gt-unsaved");
    if (!el) return;
    const n = _gtPendingExifCount();
    if (!n) { el.hidden = true; el.innerHTML = ""; return; }
    const ph = _gtPendingExifPhotos();
    el.hidden = false;
    el.innerHTML = `<span>⚠️ ${t("geotagger.exif.unsaved_banner", "{n} ungespeicherte EXIF-Änderung(en) in {p} Foto(s) — beim „Taggen schreiben“ sichern").replace("{n}", n).replace("{p}", ph)}</span>`;
  }

  // v0.9.346 — „Globale Felder": Urheber/Copyright/… einmal setzen, beim Taggen
  // auf alle sichtbaren/angehakten Fotos schreiben. Pro logischem Feld werden
  // mehrere EXIF/IPTC/XMP-Tags gefüllt, damit Lightroom/Apple Fotos sie finden.
  const _GT_GLOBAL_FIELDS = [
    { key: "artist",    tags: ["Artist", "XMP-dc:Creator", "IPTC:By-line"],            label: () => t("geotagger.gf.artist", "Urheber (dein Name)") },
    { key: "copyright", tags: ["Copyright", "XMP-dc:Rights", "IPTC:CopyrightNotice"],  label: () => t("geotagger.gf.copyright", "Copyright") },
    { key: "usage",     tags: ["XMP-xmpRights:UsageTerms"],                            label: () => t("geotagger.gf.usage", "Nutzungsbedingungen") },
    { key: "credit",    tags: ["IPTC:Credit", "XMP-photoshop:Credit"],                 label: () => t("geotagger.gf.credit", "Credit") },
    { key: "source",    tags: ["IPTC:Source", "XMP-photoshop:Source"],                 label: () => t("geotagger.gf.source", "Quelle") },
    { key: "website",   tags: ["XMP-iptcCore:CreatorWorkURL"],                         label: () => t("geotagger.gf.website", "Website / URL") },
    { key: "email",     tags: ["XMP-iptcCore:CreatorWorkEmail"],                       label: () => t("geotagger.gf.email", "E-Mail") },
    { key: "keywords",  tags: ["IPTC:Keywords", "XMP-dc:Subject"],                     label: () => t("geotagger.gf.keywords", "Stichwörter (Komma-getrennt)") },
  ];
  function _gtGlobalProfile() {
    return (typeof _settingsCache !== "undefined" && _settingsCache && _settingsCache.geotagger_global_exif) || {};
  }
  function _gtGlobalTags() {   // → {exiftoolTag: wert} nur für nicht-leere Felder
    const prof = _gtGlobalProfile(); const out = {};
    _GT_GLOBAL_FIELDS.forEach(f => {
      const v = String(prof[f.key] || "").trim();
      if (v) f.tags.forEach(tag => { out[tag] = v; });
    });
    return out;
  }
  function _gtGlobalActiveCount() {
    const prof = _gtGlobalProfile();
    return _GT_GLOBAL_FIELDS.filter(f => String(prof[f.key] || "").trim()).length;
  }
  function _gtGlobalTargetPhotos() {   // sichtbar (im Filter) UND angehakt
    return photos.filter(p => _gtPhotoChecked(p) && _gtPhotoInFilter(p));
  }
  function _gtUpdateGlobalStatus() {
    const el = document.getElementById("gt-global-status");
    if (!el) return;
    const n = _gtGlobalActiveCount();
    el.textContent = n
      ? t("geotagger.gf.status_set", "✓ {n} Feld(er) gesetzt — werden auf alle sichtbaren Fotos geschrieben").replace("{n}", n)
      : t("geotagger.gf.status_none", "Noch keine globalen Felder gesetzt.");
  }
  function _gtOpenGlobalFields() {
    const prof = _gtGlobalProfile();
    const v = (x) => String(x || "").replace(/"/g, "&quot;");
    const rows = _GT_GLOBAL_FIELDS.map(f =>
      `<label class="gt-addr-row"><span>${f.label()}</span><input id="gf-${f.key}" type="text" value="${v(prof[f.key])}"></label>`
    ).join("");
    openModal({
      title: t("geotagger.gf.title", "Globale Felder (Urheber, Copyright …)"),
      body: `<div class="gt-addr-form">${rows}
        <p class="muted" style="margin-top:8px; font-size:12px;">${t("geotagger.gf.hint", "Diese Felder werden beim „Taggen schreiben“ auf alle sichtbaren/angehakten Fotos geschrieben (EXIF + IPTC + XMP). Einmal gesetzt, bleiben sie gespeichert. Leer = nicht schreiben.")}</p>
      </div>`,
      footer: `<button class="btn" id="gf-cancel">${t("common.cancel", "Abbrechen")}</button>
               <button class="btn btn-primary" id="gf-save">${t("common.save", "Speichern")}</button>`,
    });
    document.getElementById("gf-cancel").onclick = () => openModal({}).close();
    document.getElementById("gf-save").onclick = () => {
      const obj = {};
      // IMMER alle Keys schreiben (leere mit ""), damit gelöschte Felder auch
      // wirklich verschwinden (settings_set merged sonst die alten Werte zurück).
      _GT_GLOBAL_FIELDS.forEach(f => {
        obj[f.key] = (document.getElementById("gf-" + f.key).value || "").trim();
      });
      // In-Memory-Cache sofort konsistent halten …
      if (typeof _settingsCache !== "undefined" && _settingsCache) _settingsCache.geotagger_global_exif = obj;
      // … UND dauerhaft (session-übergreifend) auf die Platte schreiben. Direkt über
      // die Bridge, damit es garantiert persistiert (unabhängig von saveSettings).
      try { api().settings_set({ geotagger_global_exif: obj }); } catch (_) {}
      openModal({}).close();
      _gtUpdateGlobalStatus();
      _gtRefreshWriteBtn();
    };
  }

  // v0.9.349 — Auto-Tag per Bilderkennung (Apple Vision). Erkennt zu jedem
  // sichtbaren/angehakten Foto Stichwörter und legt sie als AUSSTEHENDE EXIF-Edits
  // (Keywords) ab → Nutzer prüft (gelb) und schreibt sie mit „Taggen schreiben".
  async function _gtRunAutotag() {
    const targets = _gtGlobalTargetPhotos();
    if (!targets.length) { toast(t("geotagger.autotag.no_photos", "Keine sichtbaren Fotos zum Verschlagworten."), "warn"); return; }
    const paths = targets.map(p => p.path);
    let res;
    try { res = await api().geotagger_autotag_start(paths); }
    catch (e) { toast(String(e), "error"); return; }
    if (!res || !res.ok) { toast((res && res.error) || "?", "warn"); return; }

    let canceled = false;
    openModal({
      title: t("geotagger.autotag.title", "Bilderkennung läuft …"),
      body: `<div class="modal-current-file" id="at-cur">${t("geotagger.autotag.running", "Analysiere Fotos …")}</div>
        <div class="modal-progress"><div class="modal-progress-bar"><div class="modal-progress-fill" id="at-fill"></div></div>
        <div class="modal-progress-text"><span id="at-cnt">0 / ${res.total}</span><span id="at-pct">0%</span></div></div>`,
      footer: '<button class="btn btn-danger" id="at-cancel">' + t("common.cancel", "Abbrechen") + '</button>',
      closable: false,
    });
    document.getElementById("at-cancel").onclick = async () => {
      canceled = true; await api().geotagger_autotag_cancel();
      const b = document.getElementById("at-cancel"); if (b) { b.disabled = true; b.textContent = "…"; }
    };

    const poll = async () => {
      let s; try { s = await api().geotagger_autotag_status(); } catch (_) { return; }
      const pct = s.total > 0 ? (s.done / s.total) * 100 : 0;
      const f = document.getElementById("at-fill"); if (f) f.style.width = pct.toFixed(1) + "%";
      const c = document.getElementById("at-cnt"); if (c) c.textContent = `${s.done} / ${s.total}`;
      const pe = document.getElementById("at-pct"); if (pe) pe.textContent = `${pct.toFixed(0)}%`;
      if (!s.running && s.completed) { _gtAutotagApply(s, canceled); return; }
      setTimeout(poll, 200);
    };
    poll();
  }

  // Ergebnisse der Bilderkennung als ausstehende EXIF-Edits (Keywords) übernehmen.
  function _gtAutotagApply(s, canceled) {
    const results = (s && s.results) || {};
    let n = 0;
    if (Object.keys(results).length) _gtgPushUndo("Auto-Tags übernommen", { force: true });   // v0.9.359 — undoable
    Object.keys(results).forEach(path => {
      const kws = results[path] || [];
      if (!kws.length) return;
      let m = _gtExifEdits.get(path);
      if (!m) { m = new Map(); _gtExifEdits.set(path, m); }
      m.set("Keywords", kws.join(", "));   // ausstehend → gelb, prüfbar, dann schreiben
      n++;
    });
    openModal({}).close();
    _gtRefreshWriteBtn();
    if (selectedPath && _gtExif.has(selectedPath)) { _gtRenderExif(selectedPath); }
    const st = document.getElementById("gt-autotag-status");
    if (st) st.textContent = n
      ? t("geotagger.autotag.done", "✓ {n} Fotos verschlagwortet — prüfen + „Taggen schreiben“.").replace("{n}", n)
      : t("geotagger.autotag.none", "Keine Stichwörter gefunden.");
    if (n) toast(t("geotagger.autotag.toast", "{n} Fotos verschlagwortet — als ausstehend markiert.").replace("{n}", n), "success", 6000);
    else if (!canceled) toast(t("geotagger.autotag.none", "Keine Stichwörter gefunden."), "warn");
  }

  // Welche EXIF-Felder geschrieben werden sollen (GPS immer an).
  function getWriteFields() {
    const ck = (id, def) => { const e = document.getElementById(id); return e ? e.checked : def; };
    return {
      gps: true,
      altitude: ck("gt-wf-altitude", true),
      direction: ck("gt-wf-direction", true),
      address: ck("gt-wf-address", true),
    };
  }
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
    // v0.9.354 — globaler Default + Pro-Kamera-Overrides. `_gtGlobalOffset` und
    // `_gtCamOffsets` werden von den Slider-Handlern live gepflegt; das Backend
    // nimmt pro Foto den Kamera-Offset, sonst den globalen.
    const res = await api().geotagger_match(_gtGlobalOffset, 1800, getTzOffsetMinutes(), _gtCamOffsets,
                                            _gtGlobalIgnoreGps, _gtCamIgnoreGps);   // v0.9.364
    if (isUnmounted) return;        // Awaited bridge call kam zurück nachdem unmount
    if (!res.ok) { toast(res.error, "error"); return; }
    matches = res.matches;
    _gtMergeManual();               // v0.9.166 — manuelle Platzierungen wieder reinmischen
    matches.forEach(_gtApplyManualDir);  // v0.9.337 — manuelle Kompass-Richtung gewinnt
    redrawMarkers();
    updateSummary();
    updateBadges();
    _gtMaybeAutoGeocode();               // v0.9.338 — Adresse automatisch nachladen (wenn aktiviert)
    _gtRefreshWriteBtn();   // v0.9.344 — berücksichtigt auch ausstehende EXIF-Edits
  }, 80);

  function getOffsetSeconds() {
    const slider = document.getElementById("gt-off-slider");
    return slider ? parseInt(slider.value) || 0 : 0;
  }

  // v0.9.354 — Offset-Kontext = die gerade gefilterte Kamera (oder null = „Alle"/
  // globaler Default). Slider, Reset, Edit-Modal und Referenz wirken alle auf den
  // aktuellen Kontext: ist eine Kamera gefiltert, wird DEREN Offset bearbeitet;
  // ohne Kamera-Filter der globale Default (gilt für alle Kameras ohne Override).
  function _gtOffsetCam() { return _gtCamFilter || null; }
  function _gtEffectiveOffset(cam) {
    if (cam && Object.prototype.hasOwnProperty.call(_gtCamOffsets, cam)) return _gtCamOffsets[cam];
    return _gtGlobalOffset;
  }
  function _gtContextOffset() { return _gtEffectiveOffset(_gtOffsetCam()); }
  function _gtHasCamOffsets() { return Object.keys(_gtCamOffsets).length > 0; }

  // v0.9.364 — „Foto-eigenes GPS ignorieren" (pro Kamera), gleiche Kontext-Logik
  // wie der Offset. Effektiv = Kamera-Override falls gesetzt, sonst globaler Default.
  function _gtEffectiveIgnoreGps(cam) {
    if (cam && Object.prototype.hasOwnProperty.call(_gtCamIgnoreGps, cam)) return !!_gtCamIgnoreGps[cam];
    return !!_gtGlobalIgnoreGps;
  }
  function _gtContextIgnoreGps() { return _gtEffectiveIgnoreGps(_gtOffsetCam()); }
  function _gtSetContextIgnoreGps(v, persist) {
    const cam = _gtOffsetCam();
    v = !!v;
    if (cam) {
      if (v === !!_gtGlobalIgnoreGps) delete _gtCamIgnoreGps[cam];  // == Default → kein Override
      else _gtCamIgnoreGps[cam] = v;
      if (persist) saveSettings({ geotagger: { cam_ignore_gps: Object.assign({}, _gtCamIgnoreGps) } });
    } else {
      _gtGlobalIgnoreGps = v;
      if (persist) saveSettings({ geotagger: { ignore_gps: v } });
    }
  }
  // Bringt die Checkbox + Kontext-Hinweis auf den Stand der aktuell gefilterten Kamera.
  function _gtSyncIgnoreGpsToContext() {
    const cb = document.getElementById("gt-ignore-gps");
    if (cb) cb.checked = _gtContextIgnoreGps();
    const ctx = document.getElementById("gt-ignore-gps-ctx");
    if (ctx) {
      const cam = _gtOffsetCam();
      if (cam && _gtContextIgnoreGps()) {
        const lbl = (cam === _GT_CAM_UNKNOWN) ? t("geotagger.filter.cam_unknown", "Unbekannt") : cam;
        ctx.textContent = "📷 " + lbl;
        ctx.style.display = "";
      } else { ctx.style.display = "none"; ctx.textContent = ""; }
    }
  }
  // v0.9.370 — „Aufnahmezeit auf Track-Zeit setzen" pro Kamera (analog ignore_gps).
  function _gtEffectiveSetTime(cam) {
    if (cam && Object.prototype.hasOwnProperty.call(_gtCamSetTime, cam)) return !!_gtCamSetTime[cam];
    return !!_gtGlobalSetTime;
  }
  function _gtContextSetTime() { return _gtEffectiveSetTime(_gtOffsetCam()); }
  function _gtSetContextSetTime(v, persist) {
    const cam = _gtOffsetCam();
    v = !!v;
    if (cam) {
      if (v === !!_gtGlobalSetTime) delete _gtCamSetTime[cam];  // == Default → kein Override
      else _gtCamSetTime[cam] = v;
      if (persist) saveSettings({ geotagger: { cam_set_time_from_track: Object.assign({}, _gtCamSetTime) } });
    } else {
      _gtGlobalSetTime = v;
      if (persist) saveSettings({ geotagger: { set_time_from_track: v } });
    }
  }
  function _gtSyncSetTimeToContext() {
    const cb = document.getElementById("gt-set-time-from-track");
    if (cb) cb.checked = _gtContextSetTime();
    const ctx = document.getElementById("gt-set-time-ctx");
    if (ctx) {
      const cam = _gtOffsetCam();
      if (cam && _gtContextSetTime()) {
        const lbl = (cam === _GT_CAM_UNKNOWN) ? t("geotagger.filter.cam_unknown", "Unbekannt") : cam;
        ctx.textContent = "📷 " + lbl;
        ctx.style.display = "";
      } else { ctx.style.display = "none"; ctx.textContent = ""; }
    }
  }
  // Setzt den Offset des aktuellen Kontexts. persist=false = nur in-memory (für
  // jeden Slider-`input`), persist=true = zusätzlich in die Settings schreiben.
  function _gtSetContextOffset(v, persist) {
    const cam = _gtOffsetCam();
    v = Math.round(v) || 0;
    if (cam) {
      // v0.9.354 — entspricht der Kamera-Offset dem globalen Default, bewirkt der
      // Override nichts → Eintrag entfernen (kein „+0s"-Badge, keine Settings-Leiche).
      if (v === _gtGlobalOffset) delete _gtCamOffsets[cam];
      else _gtCamOffsets[cam] = v;
      if (persist) saveSettings({ geotagger: { cam_offsets: Object.assign({}, _gtCamOffsets) } });
    } else {
      _gtGlobalOffset = v;
      if (persist) saveSettings({ geotagger: { offset_seconds: v } });
    }
  }
  // Bringt den Slider auf den Offset des aktuellen Kontexts (nach Kamera-Filter-
  // Wechsel). Erweitert ggf. den Slider-Range, ohne zu persistieren.
  function _gtSyncSliderToContext() {
    const s = document.getElementById("gt-off-slider");
    if (!s) return;
    const v = _gtContextOffset();
    if (Math.abs(v) > parseInt(s.max)) {
      const needed = Math.abs(v) > 21600 ? 12 : Math.abs(v) > 10800 ? 6 : Math.abs(v) > 7200 ? 3 : 2;
      applySliderRange(needed);
    }
    s.value = String(Math.max(parseInt(s.min), Math.min(parseInt(s.max), v)));
    updateOffsetDisplay();
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
    _gtSetContextOffset(v, true);   // v0.9.354 — auf aktuellen Kamera-Kontext schreiben
  }

  function updateOffsetDisplay() {
    const sec = getOffsetSeconds();
    let txt = fmtSeconds(sec);
    if (tzOffsetMin) txt += "  ·  " + tzLabel(tzOffsetMin);   // v0.9.177
    // v0.9.354 — zeigen, für welche Kamera der Offset gerade gilt
    const cam = _gtOffsetCam();
    if (cam) txt += "  ·  📷 " + (cam === _GT_CAM_UNKNOWN
      ? t("geotagger.filter.cam_unknown", "Unbekannt") : cam);
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
        _gtSetContextOffset(clamped, true);   // v0.9.354 — Kontext-aware
        updateMatches();
      }
    });
  });

  // v0.9.28 (Marc-Feedback): Snap komplett raus. Der Slider bewegt sich
  // stufenlos in 1-Min-Schritten (`step=60`). Wer exakte Werte braucht
  // (Sekunden, runde Stunden), nutzt den ✎-Edit-Button.
  slider.addEventListener("input", () => {
    _gtSetContextOffset(parseInt(slider.value) || 0, false);  // v0.9.354 — in-memory, kein persist je input
    updateOffsetDisplay();
    updateMatches();    // debounced 80 ms
  });
  slider.addEventListener("change", () => {
    _gtSetContextOffset(parseInt(slider.value) || 0, true);   // v0.9.354 — jetzt persistieren (Kontext-aware)
    updateMatches();
  });

  // v0.9.364 — „Foto-eigenes GPS ignorieren" (pro Kamera). Wirkt auf den aktuellen
  // Kamera-Kontext (wie der Offset), persistiert + re-matcht sofort.
  const _gtIgnoreGpsCb = document.getElementById("gt-ignore-gps");
  if (_gtIgnoreGpsCb) {
    _gtIgnoreGpsCb.checked = _gtContextIgnoreGps();
    _gtSyncIgnoreGpsToContext();
    _gtIgnoreGpsCb.addEventListener("change", () => {
      _gtgPushUndo("Foto-GPS-Modus geändert", { force: true });   // undo-bar (v0.9.359-System)
      _gtSetContextIgnoreGps(_gtIgnoreGpsCb.checked, true);
      _gtSyncIgnoreGpsToContext();
      updateMatches();
    });
  }

  // v0.9.370 — „Aufnahmezeit auf Track-Zeit setzen" (pro Kamera). Wirkt auf den
  // aktuellen Kamera-Kontext (wie Offset/ignore_gps). Ändert NICHT das Matching
  // (nur was geschrieben wird), daher kein re-match — nur persistieren + undo.
  const _gtSetTimeCb = document.getElementById("gt-set-time-from-track");
  if (_gtSetTimeCb) {
    _gtSetTimeCb.checked = _gtContextSetTime();
    _gtSyncSetTimeToContext();
    _gtSetTimeCb.addEventListener("change", () => {
      _gtgPushUndo("Aufnahmezeit-aus-Track geändert", { force: true });
      _gtSetContextSetTime(_gtSetTimeCb.checked, true);
      _gtSyncSetTimeToContext();
    });
  }

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

  // v0.9.372 — „gt-backup" entfällt (kein Backup-ZIP mehr); bindSetting raus.
  bindSetting("gt-write-mode", "geotagger", "write_mode", { type: "string" });  // v0.9.339
  bindSetting("gt-adjust-time", "geotagger", "adjust_photo_time", { type: "bool" });
  // v0.9.370 — „gt-set-time-from-track" wird NICHT mehr via bindSetting global
  // gebunden, sondern pro Kamera über _gtSetContextSetTime (siehe oben).
  // v0.9.337 — EXIF-Feld-Auswahl (was wird geschrieben), persistiert
  bindSetting("gt-wf-altitude", "geotagger", "wf_altitude", { type: "bool" });
  bindSetting("gt-wf-direction", "geotagger", "wf_direction", { type: "bool" });
  bindSetting("gt-wf-address", "geotagger", "wf_address", { type: "bool" });
  bindSetting("gt-wf-keywords", "geotagger", "wf_keywords", { type: "bool" });   // v0.9.367
  bindSetting("gt-wf-global", "geotagger", "wf_global", { type: "bool" });
  bindSetting("gt-wf-exif", "geotagger", "wf_exif", { type: "bool" });
  // v0.9.366 — Blickrichtung-Schalter steuert auch die ANZEIGE (Pin-Pfeil, Vorschau-
  // Chip, Karten-Kompass) → bei Umschalten Karte + offene Vorschau neu zeichnen.
  document.getElementById("gt-wf-direction")?.addEventListener("change", () => {
    try { redrawMarkers(); } catch (_) {}   // Pin-Pfeile + Karten-Kompass neu bewerten
    const sel = selectedPath ? matches.find(x => x.path === selectedPath) : null;
    if (sel) { try { showPhotoPopup(sel); } catch (_) {} }   // Vorschau-Chips neu
  });
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
    // v0.9.347 — Spiderfy bei Karten-Bewegung/Zoom wieder einklappen (Offsets in px
    // würden sonst gegenüber den lngLat-Leitlinien driften).
    map.on("movestart", () => { if (_gtSpider.active) _gtUnspiderfy(); });
    map.on("zoomstart", () => { if (_gtSpider.active) _gtUnspiderfy(); });
    // v0.9.352 — Anzahl-Badges nach Bewegung/Zoom neu berechnen (Cluster ändern sich)
    let _badgeTimer = null;
    const _recalcBadges = () => {
      clearTimeout(_badgeTimer);
      _badgeTimer = setTimeout(() => { if (!isUnmounted) _gtUpdateClusterBadges(); }, 120);
    };
    map.on("moveend", _recalcBadges);
    map.on("zoomend", _recalcBadges);
  });

  // Close-Button für Preview-Panel
  document.getElementById("gt-preview-close").addEventListener("click", hidePhotoPopup);

  // v0.9.341 — Vorschau-Tabs (Info | EXIF) — Buttons sind statisch im Panel
  document.querySelectorAll("#gt-preview .gt-pv-tab").forEach(btn => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      _gtSetPvTab(btn.getAttribute("data-pvtab"));
    });
  });

  // v0.9.343 — EXIF-Tab: Klick auf eine editierbare Zelle startet Inline-Edit
  document.getElementById("gt-preview-exiftable")?.addEventListener("click", (ev) => {
    if (ev.target.closest(".gt-exif-input, .gt-exif-editbtns")) return;  // im Edit-Modus
    const td = ev.target.closest("td.gt-editable");
    if (td) { ev.stopPropagation(); _gtBeginExifEdit(td); }
  });

  // v0.9.355 — EXIF-Tab: Live-Suche filtert die Felder (z. B. „GPS")
  const _gtExifSearchEl = document.getElementById("gt-exif-search");
  if (_gtExifSearchEl) {
    _gtExifSearchEl.addEventListener("input", _gtFilterExifRows);
    _gtExifSearchEl.addEventListener("click", (ev) => ev.stopPropagation());
  }

  // v0.9.355 — „Ausfüllen"-Block: gleiche Inline-Edit-Logik wie die Tabelle
  document.getElementById("gt-exif-fill")?.addEventListener("click", (ev) => {
    if (ev.target.closest(".gt-exif-input, .gt-exif-editbtns")) return;
    const td = ev.target.closest("td.gt-editable");
    if (td) { ev.stopPropagation(); _gtBeginExifEdit(td); }
  });
  // v0.9.355 — „+ Feld hinzufügen"
  document.getElementById("gt-exif-addfield")?.addEventListener("click", (ev) => {
    ev.stopPropagation(); _gtOpenAddField();
  });

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
          _gtExifEdits.clear(); _gtExif.clear();   // v0.9.344 — Pending-EXIF mit aufräumen
          _gtUpdateUnsavedBanner();
          const writeBtn = document.getElementById("gt-write");
          if (writeBtn) writeBtn.disabled = true;
        } catch (_) {}
        hideGridLoader();
        _gtResetFiltersAndOffset();  // v0.9.362 (Marc) — auch beim Session-Schließen Filter+Offset weg
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
        // Fertig — jetzt sind alle EXIF-Zeiten da → Raster nach Aufnahmezeit
        // ordnen (v0.9.363) und einmal frisch aufbauen.
        _gtSortPhotosByTime();
        renderPhotoGrid();
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

  // v0.9.363 (Marc) — Foto-Raster nach AUFNAHMEZEIT sortieren (statt nach Dateiname,
  // wie der Ordner-Scan sie liefert). Sortiert das `photos`-Array selbst (nicht nur
  // die Anzeige), damit DOM-Reihenfolge == Array-Index bleibt (updatePendingTileState
  // u.a. verlassen sich darauf). Quelle ist `photo_time` (UTC-ISO bei Kameras mit
  // eingebettetem TZ-Offset, sonst naive Lokalzeit) → über mehrere Kameras hinweg
  // echte zeitliche Reihenfolge. Fotos ohne Zeit wandern ans Ende, dort nach Name.
  function _gtSortPhotosByTime() {
    const key = (p) => {
      if (p && p.photo_time) { const t = Date.parse(p.photo_time); if (!isNaN(t)) return t; }
      return Infinity;
    };
    photos.sort((a, b) => {
      const ka = key(a), kb = key(b);
      if (ka !== kb) return ka - kb;
      return String((a && a.name) || "").localeCompare(String((b && b.name) || ""));
    });
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
    if (m) _gtShowCompass(m); else _gtHideCompass();   // v0.9.337 — Karten-Kompass
    // Im Referenz-Modus den Banner mit dem neuen Foto-Namen updaten
    if (refMode) updateBanner();
  }

  // v0.9.361 — formatierte ANZEIGE-Aufnahmezeit: lokale Kamera-Wanduhr
  // (DateTimeOriginal, nicht UTC) + aktiver Zeit-Offset (pro Kamera oder global).
  // photo_time bleibt intern UTC fürs Track-Matching; das hier ist nur Anzeige.
  function _gtCaptureLocalStr(path) {
    const m = matches.find(x => x.path === path);
    const ph = photos.find(p => p.path === path);
    const iso = (m && m.photo_time_local) || (ph && ph.photo_time_local)
              || (m && m.photo_time) || (ph && ph.photo_time) || null;
    if (!iso) return "";
    try {
      const cam = (ph && ph.camera) || null;
      const offSec = _gtEffectiveOffset(cam) || 0;
      const base = new Date(iso);
      const shown = offSec ? new Date(base.getTime() + offSec * 1000) : base;
      return shown.toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
    } catch (_) { return ""; }
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
    const _capStr = _gtCaptureLocalStr(m.path);   // v0.9.361 — lokale Zeit + Offset
    if (_capStr) bits.push(_capStr);
    if (m.lat != null) {
      bits.push(`<span class="coord">${m.lat.toFixed(5)}, ${m.lon.toFixed(5)}</span>`);
    }
    // v0.9.337 — Adresse (Reverse-Geocoding) — pro Foto anzeigbar UND editierbar
    const addr = _gtAddr.get(m.path);
    const editIco = `<button class="gt-addr-edit" title="${t("geotagger.addr.edit_title", "Adresse bearbeiten")}">✎</button>`;
    if (m.lat != null) {
      if (addr) {
        const line = [addr.street, addr.postcode ? `${addr.postcode} ${addr.city}` : addr.city, addr.country]
          .filter(Boolean).join(", ");
        bits.push(`<span class="gt-addr">📍 ${line || t("geotagger.addr.empty", "(leer)")} ${editIco}</span>`);
      } else {
        bits.push(`<span class="gt-addr gt-addr-add">${editIco}<span class="gt-addr-add-lbl">${t("geotagger.addr.add", "Adresse hinzufügen")}</span></span>`);
      }
    }
    metaEl.innerHTML = bits.join("<br>") + gtChipsHtml(m);
    // Edit-Button verdrahten (innerHTML wurde gerade neu gesetzt)
    const _editBtn = metaEl.querySelector(".gt-addr-edit");
    if (_editBtn) _editBtn.addEventListener("click", (ev) => { ev.stopPropagation(); _gtEditAddress(m.path); });
    const _addLbl = metaEl.querySelector(".gt-addr-add-lbl");
    if (_addLbl) _addLbl.addEventListener("click", (ev) => { ev.stopPropagation(); _gtEditAddress(m.path); });

    // v0.9.341 — EXIF: immer mit Info-Tab starten, Key-Felder + voller Tab nachladen
    _gtSetPvTab("info");
    const _es = document.getElementById("gt-exif-search");   // v0.9.355 — Suche pro Foto frisch
    if (_es) _es.value = "";
    _gtRenderExif(m.path);   // aus Cache (oder Lade-Platzhalter)
    _gtFetchExif(m.path);    // async per Bridge nachziehen

    panel.classList.add("show");
  }

  // v0.9.341 — Vorschau-Tabs (Info | EXIF) umschalten
  function _gtSetPvTab(tab) {
    document.querySelectorAll("#gt-preview .gt-pv-tab").forEach(b =>
      b.classList.toggle("active", b.getAttribute("data-pvtab") === tab));
    const info = document.getElementById("gt-pv-info");
    const exif = document.getElementById("gt-pv-exif");
    if (info) info.style.display = (tab === "exif") ? "none" : "";
    if (exif) exif.style.display = (tab === "exif") ? "" : "none";
  }

  // v0.9.341 — volle EXIF per Bridge holen (lazy, gecacht) und neu rendern
  async function _gtFetchExif(path) {
    if (!_gtExif.has(path)) {
      try {
        const res = await api().geotagger_photo_exif(path);
        if (res && res.ok) _gtExif.set(path, res);
        else _gtExif.set(path, { key: {}, all: {} });
      } catch (_) {
        _gtExif.set(path, { key: {}, all: {} });
      }
    }
    if (selectedPath === path) _gtRenderExif(path);
  }

  // v0.9.341 — Key-EXIF (Info-Tab) + voller Tag-Dump (EXIF-Tab) rendern
  // v0.9.355 — kuratierte beschreibbare Felder. Der „Ausfüllen"-Block oben zeigt
  // diese IMMER (auch leer → anklickbar), „+ Feld hinzufügen" bietet weitere + freie
  // Tag-Eingabe. Beide nutzen den bestehenden Inline-Edit-/Pending-Pfad (data-tag →
  // _gtExifEdits, geschrieben beim „Taggen schreiben" mit Backup).
  const _GT_FILL_FIELDS = [
    { tag: "ImageDescription", k: "geotagger.exif.f.description", d: "Beschreibung" },
    { tag: "Title",            k: "geotagger.exif.f.title",       d: "Titel" },
    { tag: "Keywords",         k: "geotagger.exif.f.keywords",    d: "Stichwörter" },
    { tag: "Rating",           k: "geotagger.exif.f.rating",      d: "Bewertung (0–5)" },
    { tag: "UserComment",      k: "geotagger.exif.f.comment",     d: "Kommentar" },
    { tag: "Artist",           k: "geotagger.exif.f.artist",      d: "Urheber" },
    { tag: "Copyright",        k: "geotagger.exif.f.copyright",   d: "Copyright" },
  ];
  const _GT_ADD_FIELDS = [
    { tag: "Headline",     k: "geotagger.exif.f.headline",     d: "Überschrift" },
    { tag: "Instructions", k: "geotagger.exif.f.instructions", d: "Anweisung" },
    { tag: "Credit",       k: "geotagger.exif.f.credit",       d: "Credit" },
    { tag: "Source",       k: "geotagger.exif.f.source",       d: "Quelle" },
    { tag: "City",         k: "geotagger.exif.f.city",         d: "Stadt" },
    { tag: "State",        k: "geotagger.exif.f.state",        d: "Bundesland/Region" },
    { tag: "Country",      k: "geotagger.exif.f.country",      d: "Land" },
    { tag: "Sublocation",  k: "geotagger.exif.f.sublocation",  d: "Ort/Detail" },
    { tag: "Make",         k: "geotagger.exif.f.make",         d: "Kamera-Marke" },
    { tag: "Model",        k: "geotagger.exif.f.model",        d: "Kamera-Modell" },
  ];
  const _GT_FILL_TAGS = new Set(_GT_FILL_FIELDS.map(f => f.tag));
  function _gtFieldLabel(f) { return t(f.k, f.d); }

  // Baut die editierbare <td>-Zelle für einen Tag (geteilt von Füll-Block + Tabelle).
  // Leere Werte zeigen einen „leer – klicken"-Platzhalter, sind aber editierbar.
  function _gtExifEditCell(tag, disk, pendVal) {
    const isPend = pendVal !== undefined;
    const shown = isPend ? pendVal : (disk == null ? "" : disk);
    const empty = (shown === "" || shown == null);
    const cls = "gt-exif-val gt-editable" + (isPend ? " gt-pending" : "") + (empty ? " gt-empty" : "");
    const inner = empty
      ? `<span class="gt-exif-ph">${t("geotagger.exif.empty_ph", "leer – klicken")}</span>`
      : _gtEsc(shown);
    return `<td class="${cls}" data-tag="${_gtEsc(tag)}" data-disk="${_gtEsc(disk == null ? "" : disk)}" `
      + `title="${t("geotagger.exif.edit_hint", "Klicken zum Bearbeiten")}">${inner}<span class="gt-edit-ico">✎</span></td>`;
  }

  function _gtRenderExif(path) {
    const keyEl = document.getElementById("gt-preview-keyexif");
    const tblEl = document.getElementById("gt-preview-exiftable");
    const d = _gtExif.get(path);
    const fillEl0 = document.getElementById("gt-exif-fill");
    if (!d) {
      const loading = `<div class="gt-pv-loading">${t("geotagger.exif.loading", "Lade EXIF …")}</div>`;
      if (keyEl) keyEl.innerHTML = loading;
      if (tblEl) tblEl.innerHTML = loading;
      if (fillEl0) fillEl0.innerHTML = "";
      return;
    }
    const k = d.key || {};
    const focal = k.focal ? (k.focal35 ? `${k.focal} (KB ${k.focal35})` : k.focal) : "";
    // v0.9.360 (Marc): Aufnahmezeit IMMER direkt im Info-Tab anzeigen (nicht nur als
    // nackte Zeile im Meta-Block). v0.9.361: lokale Kamera-Zeit + aktiver Offset.
    const captured = _gtCaptureLocalStr(path);
    const rows = [
      [t("geotagger.exif.camera", "Kamera"), k.camera],
      [t("geotagger.exif.lens", "Objektiv"), k.lens],
      [t("geotagger.exif.focal", "Brennweite"), focal],
      [t("geotagger.exif.iso", "ISO"), k.iso],
      [t("geotagger.exif.shutter", "Belichtungszeit"), k.shutter],
      [t("geotagger.exif.aperture", "Blende"), k.aperture],
      [t("geotagger.exif.exposure_comp", "Belichtungskorrektur"), k.exposure_comp],
      [t("geotagger.exif.flash", "Blitz"), k.flash],
    ].filter(r => r[1]);
    // Aufnahmezeit immer als erste Zeile (auch wenn keine Kamera-EXIF da ist).
    rows.unshift([t("geotagger.exif.captured", "Aufnahmezeit"),
                  captured || t("geotagger.exif.no_time", "—")]);
    if (keyEl) {
      keyEl.innerHTML = rows.length
        ? `<table class="gt-exif-grid">${rows.map(r =>
            `<tr><th>${_gtEsc(r[0])}</th><td>${_gtEsc(r[1])}</td></tr>`).join("")}</table>`
        : `<div class="gt-pv-loading">${t("geotagger.exif.none", "Keine Kamera-EXIF gefunden.")}</div>`;
    }
    const all = d.all || {};
    const edits = _gtExifEdits.get(path);   // Map(tag→neuerWert) oder undefined

    // v0.9.355 — „Ausfüllen"-Block: kuratierte Felder IMMER (auch leer, anklickbar).
    const fillEl = document.getElementById("gt-exif-fill");
    if (fillEl) {
      const fr = _GT_FILL_FIELDS.map(f => {
        const disk = (f.tag in all) ? all[f.tag] : "";
        const pend = (edits && edits.has(f.tag)) ? edits.get(f.tag) : undefined;
        return `<tr><th>${_gtEsc(_gtFieldLabel(f))}</th>${_gtExifEditCell(f.tag, disk, pend)}</tr>`;
      }).join("");
      fillEl.innerHTML =
        `<div class="gt-exif-fill-head">${t("geotagger.exif.fill_head", "Ausfüllen")}</div>`
        + `<table class="gt-exif-grid">${fr}</table>`;
    }

    if (tblEl) {
      const ro = new Set(d.readonly || []);
      // Tabelle = vorhandene Tags OHNE die kuratierten (stehen oben) + neu
      // hinzugefügte Pending-Tags, die (noch) nicht in der Datei sind.
      const baseKeys = Object.keys(all).filter(kk => !_GT_FILL_TAGS.has(kk));
      const addedKeys = edits ? [...edits.keys()].filter(kk => !_GT_FILL_TAGS.has(kk) && !(kk in all)) : [];
      const keys = baseKeys.concat(addedKeys);
      // v0.9.344 — Hinweis, dass es ungespeicherte Änderungen gibt (werden beim Schreiben getaggt)
      const note = (edits && edits.size)
        ? `<div class="gt-exif-pending-note">⏳ ${t("geotagger.exif.pending_note", "{n} Änderung(en) — werden beim „Taggen schreiben“ gespeichert").replace("{n}", edits.size)} <button type="button" class="gt-exif-discard">${t("geotagger.exif.discard", "verwerfen")}</button></div>`
        : "";
      tblEl.innerHTML = keys.length
        ? note + `<table class="gt-exif-grid">${keys.map(kk => {
            const onDisk = (kk in all);
            const editable = !ro.has(kk);
            const disk = onDisk ? all[kk] : "";
            const pendVal = (edits && edits.has(kk)) ? edits.get(kk) : undefined;
            if (editable) {
              return `<tr><th>${_gtEsc(kk)}</th>${_gtExifEditCell(kk, disk, pendVal)}</tr>`;
            }
            return `<tr><th>${_gtEsc(kk)}</th><td class="gt-exif-val gt-ro">${_gtEsc(disk)}</td></tr>`;
          }).join("")}</table>`
        : (note || `<div class="gt-pv-loading">${t("geotagger.exif.none_all", "Keine EXIF-Daten.")}</div>`);
      const disc = tblEl.querySelector(".gt-exif-discard");
      if (disc) disc.addEventListener("click", (ev) => {
        ev.stopPropagation();
        _gtExifEdits.delete(path);
        _gtRefreshWriteBtn();
        _gtRenderExif(path);
      });
      _gtFilterExifRows();   // v0.9.355 — aktiven Suchfilter nach Neu-Render wieder anwenden
    }
  }

  // v0.9.355 — „+ Feld hinzufügen": kuratierte Liste ODER freier exiftool-Tag,
  // landet als ausstehende Änderung (geschrieben beim „Taggen schreiben").
  function _gtOpenAddField() {
    const path = selectedPath;
    if (!path) return;
    const opts = _GT_ADD_FIELDS.map(f =>
      `<option value="${_gtEsc(f.tag)}">${_gtEsc(_gtFieldLabel(f))} (${_gtEsc(f.tag)})</option>`).join("");
    openModal({
      title: t("geotagger.exif.add_title", "EXIF-Feld hinzufügen"),
      body: `
        <div class="gt-addf-form">
          <label class="gt-addf-row"><span>${t("geotagger.exif.add_choose", "Feld")}</span>
            <select id="gt-addf-sel">
              ${opts}
              <option value="__custom__">${t("geotagger.exif.add_custom", "Eigenes Feld (Tag-Name) …")}</option>
            </select>
          </label>
          <label class="gt-addf-row" id="gt-addf-customrow" style="display:none"><span>${t("geotagger.exif.add_custom_label", "Tag-Name")}</span>
            <input id="gt-addf-custom" type="text" placeholder="${t("geotagger.exif.add_custom_ph", "exiftool-Tag, z. B. Headline")}" autocomplete="off" spellcheck="false">
          </label>
          <label class="gt-addf-row"><span>${t("geotagger.exif.add_value", "Wert")}</span>
            <input id="gt-addf-val" type="text" autocomplete="off">
          </label>
          <p class="muted" style="margin:8px 0 0; font-size:11px; line-height:1.5;">${t("geotagger.exif.add_hint", "Wird als ausstehende Änderung gesammelt und beim „Taggen schreiben“ ins Foto geschrieben (mit Backup).")}</p>
        </div>`,
      footer: `<button class="btn" id="gt-addf-cancel">${t("common.cancel", "Abbrechen")}</button>
               <button class="btn btn-primary" id="gt-addf-ok">${t("common.add", "Hinzufügen")}</button>`,
    });
    const sel = document.getElementById("gt-addf-sel");
    const customRow = document.getElementById("gt-addf-customrow");
    const customInp = document.getElementById("gt-addf-custom");
    const valInp = document.getElementById("gt-addf-val");
    sel.addEventListener("change", () => {
      const isC = sel.value === "__custom__";
      customRow.style.display = isC ? "" : "none";
      if (isC && customInp) customInp.focus();
    });
    setTimeout(() => valInp && valInp.focus(), 50);
    document.getElementById("gt-addf-cancel").onclick = () => openModal({}).close();
    document.getElementById("gt-addf-ok").onclick = () => {
      let tag = (sel.value === "__custom__" ? (customInp.value || "") : sel.value).trim();
      tag = tag.replace(/[^A-Za-z0-9:_-]/g, "");   // nur gültige Tag-Zeichen
      if (!tag) { if (customInp) customInp.focus(); return; }
      _gtgPushUndo("EXIF-Feld hinzugefügt", { force: true });   // v0.9.359 — undoable
      let m = _gtExifEdits.get(path);
      if (!m) { m = new Map(); _gtExifEdits.set(path, m); }
      m.set(tag, valInp.value);
      _gtRefreshWriteBtn();
      _gtRenderExif(path);
      openModal({}).close();
    };
  }

  // v0.9.355 — Live-Filter im EXIF-Tab: tippt man z. B. „GPS", bleiben nur Felder
  // sichtbar, deren Tag-Name den Text enthält. Reines Zeigen/Verstecken der Zeilen
  // (kein Re-Render), damit das Eingabefeld den Fokus behält.
  function _gtFilterExifRows() {
    const tbl = document.getElementById("gt-preview-exiftable");
    if (!tbl) return;
    const inp = document.getElementById("gt-exif-search");
    const q = (inp ? inp.value : "").trim().toLowerCase();
    let shown = 0;
    tbl.querySelectorAll("tr").forEach(tr => {
      const th = tr.querySelector("th");
      if (!th) return;
      const match = !q || th.textContent.toLowerCase().includes(q);
      tr.style.display = match ? "" : "none";
      if (match) shown++;
    });
    let empty = tbl.querySelector(".gt-exif-nomatch");
    if (q && shown === 0) {
      if (!empty) {
        empty = document.createElement("div");
        empty.className = "gt-pv-loading gt-exif-nomatch";
        tbl.appendChild(empty);
      }
      empty.textContent = t("geotagger.exif.no_match", "Kein Feld passt zu „{q}“.").replace("{q}", q);
      empty.style.display = "";
    } else if (empty) {
      empty.style.display = "none";
    }
  }

  // v0.9.343/344 — eine EXIF-Zelle inline editieren. Der neue Wert wird NICHT sofort
  // geschrieben, sondern als ausstehende Änderung gesammelt (_gtExifEdits) und erst
  // beim normalen „Taggen schreiben" gespeichert — so liegt auch ein Backup vor.
  function _gtBeginExifEdit(td) {
    if (!td || td._editing) return;
    const path = selectedPath;
    const tag = td.getAttribute("data-tag");
    if (!path || !tag) return;
    td._editing = true;
    const disk = td.getAttribute("data-disk") || "";
    const editsNow = _gtExifEdits.get(path);
    const cur = (editsNow && editsNow.has(tag)) ? editsNow.get(tag) : disk;  // aktuell angezeigter Wert
    td.innerHTML =
      `<input class="gt-exif-input" type="text" value="${_gtEsc(cur)}">
       <div class="gt-exif-editbtns">
         <button type="button" class="gt-exif-save" title="${t("common.save", "Speichern")}">✓</button>
         <button type="button" class="gt-exif-cancel" title="${t("common.cancel", "Abbrechen")}">✕</button>
       </div>`;
    const inp = td.querySelector(".gt-exif-input");
    inp.focus(); inp.select();
    let done = false;
    const finish = () => { td._editing = false; if (selectedPath === path) _gtRenderExif(path); };
    const cancel = () => { if (done) return; done = true; finish(); };
    const save = () => {
      if (done) return;
      done = true;
      const val = inp.value;
      let m = _gtExifEdits.get(path);
      const isNoop = (val === disk) ? !(m && m.has(tag)) : (m && m.get(tag) === val);
      if (!isNoop) _gtgPushUndo("EXIF-Wert geändert", { force: true });   // v0.9.359 — undoable
      if (val === disk) {
        // zurück auf Original → keine ausstehende Änderung
        if (m) { m.delete(tag); if (!m.size) _gtExifEdits.delete(path); }
      } else {
        if (!m) { m = new Map(); _gtExifEdits.set(path, m); }
        m.set(tag, val);
      }
      _gtRefreshWriteBtn();
      finish();
    };
    inp.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Enter") { ev.preventDefault(); save(); }
      else if (ev.key === "Escape") { ev.preventDefault(); cancel(); }
    });
    td.querySelector(".gt-exif-save").addEventListener("click", (ev) => { ev.stopPropagation(); save(); });
    td.querySelector(".gt-exif-cancel").addEventListener("click", (ev) => { ev.stopPropagation(); cancel(); });
  }

  // v0.9.337 — Adresse eines Fotos manuell bearbeiten (Geocoding-Ergebnis korrigieren
  // oder ohne Abruf von Hand setzen). Schreibt in die _gtAddr-Map → wird beim Taggen
  // als IPTC/XMP geschrieben.
  function _gtEditAddress(path) {
    const a = _gtAddr.get(path) || {};
    const v = (x) => String(x || "").replace(/"/g, "&quot;");
    const row = (id, label, val) =>
      `<label class="gt-addr-row"><span>${label}</span><input id="${id}" type="text" value="${v(val)}"></label>`;
    openModal({
      title: t("geotagger.addr.edit_title", "Adresse bearbeiten"),
      body: `<div class="gt-addr-form">
        ${row("ga-street", t("geotagger.addr.street", "Straße / Detail"), a.street)}
        ${row("ga-postcode", t("geotagger.addr.postcode", "PLZ"), a.postcode)}
        ${row("ga-city", t("geotagger.addr.city", "Ort"), a.city)}
        ${row("ga-state", t("geotagger.addr.state", "Bundesland / Region"), a.state)}
        ${row("ga-country", t("geotagger.addr.country", "Land"), a.country)}
        <p class="muted" style="margin-top:8px; font-size:12px;">${t("geotagger.addr.hint", "Diese Adresse wird beim Taggen ins Foto geschrieben (IPTC/XMP). Alle Felder leer = keine Adresse.")}</p>
      </div>`,
      footer: `<button class="btn" id="ga-cancel">${t("common.cancel", "Abbrechen")}</button>
               <button class="btn btn-primary" id="ga-save">${t("common.save", "Speichern")}</button>`,
    });
    const get = (id) => (document.getElementById(id).value || "").trim();
    document.getElementById("ga-cancel").onclick = () => openModal({}).close();
    document.getElementById("ga-save").onclick = () => {
      const country = get("ga-country");
      const city = get("ga-city");
      const edited = {
        street: get("ga-street"), postcode: get("ga-postcode"),
        city, state: get("ga-state"), country,
        // Ländercode nur behalten, wenn das Land unverändert blieb (sonst wäre er falsch)
        country_code: (country === (a.country || "") ? (a.country_code || "") : ""),
        edited: true,
      };
      edited.display = [edited.street, edited.postcode ? `${edited.postcode} ${city}` : city, country]
        .filter(s => s && s.trim()).join(", ");
      const empty = !edited.street && !edited.postcode && !edited.city && !edited.state && !edited.country;
      _gtgPushUndo("Adresse bearbeitet", { force: true });   // v0.9.359 — undoable
      if (empty) _gtAddr.delete(path); else _gtAddr.set(path, edited);
      openModal({}).close();
      const mm = matches.find(x => x.path === path);
      if (mm) showPhotoPopup(mm);
    };
  }

  // v0.9.333 — Lichtstempel + Blickrichtung (Sonnenstand/EXIF-Kurs aus core/sun.py
  // via Bridge). Spiegelt das Web-Tool. Chips für Detail-Ansicht + Foto-Karten.
  const _GT_SUN_EMOJI = { noon: "🌞", day: "🌤️", golden: "🌅", blue: "🌆", dusk: "🌌", night: "🌙" };
  const _GT_LVD_EMOJI = { back: "🌅", side: "☀️", front: "🌞" };
  function gtCompass(deg) {
    const a = t("geotagger.compass", "N,NO,O,SO,S,SW,W,NW").split(",");
    return a[Math.round(deg / 45) % 8] || "";
  }
  // v0.9.366 — Blickrichtung wird nur ANGEZEIGT (Pin-Pfeil, Vorschau-Chip, Karten-
  // Kompass), wenn sie laut „Was wird ins Foto geschrieben" auch geschrieben werden
  // soll. Schalter aus → Blickrichtung überall ausblenden.
  function _gtWriteDirection() {
    const cb = document.getElementById("gt-wf-direction");
    return cb ? cb.checked : true;
  }
  function gtChipsHtml(m) {
    if (!m || m.lat == null || !m.in_range) return "";
    const c = [];
    if (m.light_phase) c.push(`<span class="gt-chip sun">${_GT_SUN_EMOJI[m.light_phase] || "☀️"} ${t("geotagger.light." + m.light_phase, m.light_phase)}</span>`);
    if (m.dir != null && _gtWriteDirection()) { const _ds = m.dir_src === "exif" ? "cam" : (m.dir_src === "logged" ? "logged" : (m.dir_src === "manual" ? "manual" : "move")); c.push(`<span class="gt-chip">🧭 ${gtCompass(m.dir)} ${Math.round(m.dir)}° <span class="dim">(${t("geotagger.dir." + _ds, m.dir_src)})</span></span>`); }
    if (m.light_vs_dir) c.push(`<span class="gt-chip${m.light_vs_dir === "back" ? " back" : ""}">${_GT_LVD_EMOJI[m.light_vs_dir] || "☀️"} ${t("geotagger.lvd." + m.light_vs_dir, m.light_vs_dir)}</span>`);
    return c.length ? `<div class="gt-chips">${c.join("")}</div>` : "";
  }

  function hidePhotoPopup() {
    const panel = document.getElementById("gt-preview");
    if (panel) panel.classList.remove("show");
    _gtHideCompass();   // v0.9.337 — Kompass mit schließen
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
  const _gtFilterClick = (ev) => {
    const fb = ev.target.closest("[data-gtfilter]");
    if (fb) { ev.preventDefault(); _gtSetFilter(fb.getAttribute("data-gtfilter")); return; }
    const cb = ev.target.closest("[data-gtcam]");   // v0.9.164 — Kamera-Filter
    if (cb) { ev.preventDefault(); _gtSetCamFilter(cb.getAttribute("data-gtcam")); return; }
  };
  document.getElementById("gt-summary")?.addEventListener("click", _gtFilterClick);
  document.getElementById("gt-filterbar")?.addEventListener("click", _gtFilterClick);  // v0.9.340 — Filterleiste oben

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
    // v0.9.347 — offene Pin-Auffächerung mit einem Leer-Klick wieder einklappen
    if (_gtSpider.active) { _gtUnspiderfy(); return; }
    // Referenz-Modus: Klick setzt den Zeit-Offset (bestehendes Verhalten)
    if (refMode) {
      if (!selectedPath) { toast(t("geotagger.toast.select_photo"), "warn"); return; }
      const { lng, lat } = e.lngLat;
      const res = await api().geotagger_compute_offset_from_reference(selectedPath, lat, lng);
      if (!res.ok) { toast(res.error, "error"); return; }
      _gtgPushUndo("Referenz-Offset gesetzt", { force: true });   // v0.9.359 — undoable
      setOffsetFromSeconds(res.offset_seconds);   // v0.9.354 — wirkt auf den aktuellen Kamera-Kontext
      referencePath = selectedPath;     // dieses Foto bleibt markiert als Referenz
      refMode = false;
      document.getElementById("gt-ref-mode").classList.remove("btn-primary");
      updateBanner();
      // Tile-Highlight aktualisieren
      document.querySelectorAll(".photo-tile").forEach(t => {
        t.classList.toggle("reference", t.dataset.path === referencePath);
      });
      renderFilterBar();   // v0.9.354 — neuer Kamera-Offset-Badge sichtbar machen
      // v0.9.354 — bei aktivem Kamera-Filter klarstellen, dass der Offset NUR für
      // diese Kamera gilt (die zweite Kamera wird separat referenziert).
      const _refCam = _gtOffsetCam();
      let _msg = t("geotagger.toast.offset_set", { human: res.human });
      if (_refCam) {
        const _cl = (_refCam === _GT_CAM_UNKNOWN) ? t("geotagger.filter.cam_unknown", "Unbekannt") : _refCam;
        _msg += " · 📷 " + _cl;
      }
      toast(_msg, "success");
      updateMatches();
      return;
    }
    // v0.9.350 — ist gerade eine Foto-Vorschau offen, schließt ein Klick auf die
    // Karte sie (wie der ✕-Button) — dann nichts weiter tun.
    const pv = document.getElementById("gt-preview");
    if (pv && pv.classList.contains("show")) { hidePhotoPopup(); return; }
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
      // v0.9.359 (Marc-Bug): Fotos AUßERHALB der Trackzeit haben zwar eine
      // geclampte Position (nächster Track-Punkt = oft Track-Anfang) — die gehören
      // NICHT auf die Karte (sonst „klebt" alles am Start). Nur in_range ODER
      // manuell platzierte Fotos bekommen einen Pin.
      if (!m.in_range && !m.manual) return;
      if (!_gtMatchInFilter(m)) return;          // v0.9.340 — Filter wirkt auch auf die Karte
      const isManual = !!m.manual;               // v0.9.166 — manuell platziert
      const eltMarker = document.createElement("div");
      let cls = "photo-marker";
      if (m.existing_gps) cls += " existing";
      if (isManual) cls += " manual";
      if (m.path === referencePath) cls += " reference";
      if (m.path === selectedPath) cls += " selected";
      eltMarker.className = cls;
      // v0.9.333 — Blickrichtungs-Pfeil (Lichtstempel-Gimmick): zeigt die
      // Aufnahmerichtung (EXIF-Kamerakurs oder Bewegung) am Pin.
      if (m.dir != null && m.in_range && _gtWriteDirection()) {   // v0.9.366 — nur wenn Richtung geschrieben wird
        const ar = document.createElement("div");
        ar.className = "pm-dir";
        ar.style.transform = "translateX(-50%) rotate(" + m.dir + "deg)";
        eltMarker.appendChild(ar);
      }
      // v0.9.359 — JEDER Pin lässt sich ziehen, um genau dieses eine Foto zu
      // verschieben (auch zeitlich gematchte). Beim Loslassen wird es als manuell
      // platziert gespeichert.
      eltMarker.title = (m.name || "") + " — "
        + t("geotagger.place.marker_drag", "ziehen zum Verschieben");
      // v0.9.347 — Spiderfy: liegen mehrere Pins pixelgenau übereinander, fächert
      // ein Klick sie auf (statt nur den obersten zu treffen). Klick auf ein
      // aufgefächertes Foto wählt es aus + klappt zu.
      eltMarker.addEventListener("click", ev => {
        ev.stopPropagation();
        const self = markers.find(x => x._path === m.path);
        if (!self) { selectPhoto(m.path); return; }
        if (_gtSpider.active && _gtSpider.mks.includes(self)) {
          _gtUnspiderfy(); selectPhoto(m.path); return;
        }
        const group = _gtMarkersNear(self);
        if (group.length >= 2) _gtSpiderfy(group);
        else selectPhoto(m.path);
      });
      try {
        const mk = new (mapLib().Marker)({ element: eltMarker, anchor: "center", draggable: true })
          .setLngLat([m.lon, m.lat])
          .addTo(map);
        mk._path = m.path;
        // v0.9.359 — ALLE Pins ziehbar; beim Loslassen wird genau dieses Foto
        // repositioniert (⌘/Toggle entscheidet über Track-Einrasten).
        mk.on("dragstart", () => { _gtgPushUndo("Foto verschoben"); });
        mk.on("dragend", () => _gtOnMarkerDragEnd(m.path, mk));
        markers.push(mk);
      } catch (err) {
        // Map kann zwischen Check und addTo zerstört worden sein (Tab-Wechsel-Race)
        console.warn("redrawMarkers: marker add failed", err);
      }
    });
    // v0.9.337 — Kompass des selektierten Fotos nach jedem Redraw frisch aufsetzen
    // (nur wenn es auch durch den Filter sichtbar ist — v0.9.340)
    if (selectedPath) {
      const sm = matches.find(x => x.path === selectedPath);
      if (sm && _gtMatchInFilter(sm)) _gtShowCompass(sm); else _gtHideCompass();
    }
    // Marker neu gezeichnet → evtl. offene Auffächerung verwerfen (Marker-Objekte sind neu)
    _gtSpider = { active: false, mks: [] };
    _gtSpiderSetLines([]);
    _gtUpdateClusterBadges();   // v0.9.352 — Anzahl-Badges für überlappende Pins
  }

  // ── v0.9.347 — Spiderfy für übereinanderliegende Foto-Pins ────────────────
  // Mehrere Fotos am (fast) selben Punkt: Klick fächert sie kreisförmig auf
  // (via marker.setOffset → echte lngLat bleibt unverändert) + Leitlinien.
  function _gtMarkersNear(mk) {
    if (!map || !mk) return [mk];
    let p0;
    try { p0 = map.project(mk.getLngLat()); } catch (_) { return [mk]; }
    const R = 16;  // Pixel-Radius, in dem Pins als „übereinander" gelten
    return markers.filter(o => {
      try {
        const p = map.project(o.getLngLat());
        return Math.hypot(p.x - p0.x, p.y - p0.y) <= R;
      } catch (_) { return false; }
    });
  }

  function _gtSpiderSetLines(features) {
    if (!map) return;
    try {
      if (typeof map.getCanvasContainer !== "function" || !map.getCanvasContainer()) return;
      const data = { type: "FeatureCollection", features: features || [] };
      const src = map.getSource("gt-spider");
      if (src) { src.setData(data); return; }
      if (!features || !features.length) return;
      map.addSource("gt-spider", { type: "geojson", data });
      map.addLayer({
        id: "gt-spider-lines", type: "line", source: "gt-spider",
        paint: { "line-color": "#ff7a18", "line-width": 1.5, "line-opacity": 0.75 },
      });
    } catch (_) {}
  }

  function _gtUnspiderfy() {
    if (_gtSpider.active) {
      _gtSpider.mks.forEach(mk => {
        try { mk.setOffset([0, 0]); } catch (_) {}
        try { mk.getElement().classList.remove("gt-spidered"); } catch (_) {}
      });
    }
    _gtSpider = { active: false, mks: [] };
    _gtSpiderSetLines([]);
    _gtUpdateClusterBadges();   // v0.9.352 — Anzahl-Badges wieder zeigen
  }

  function _gtSpiderfy(group) {
    _gtUnspiderfy();
    const n = group.length;
    if (n < 2 || !map) return false;
    const R = Math.min(78, 32 + n * 7);   // Auffächer-Radius (px)
    let center;
    try { center = group[0].getLngLat(); } catch (_) { return false; }
    let cpx; try { cpx = map.project(center); } catch (_) { return false; }
    const lineFeatures = [];
    group.forEach((mk, i) => {
      const a = (2 * Math.PI * i) / n - Math.PI / 2;   // oben starten
      const dx = Math.cos(a) * R, dy = Math.sin(a) * R;
      try { mk.setOffset([dx, dy]); } catch (_) {}
      try {
        const el = mk.getElement();
        el.classList.add("gt-spidered");
        if (el.parentNode) el.parentNode.appendChild(el);   // nach vorn
      } catch (_) {}
      try {
        const off = map.unproject([cpx.x + dx, cpx.y + dy]);
        lineFeatures.push({ type: "Feature", geometry: { type: "LineString",
          coordinates: [[center.lng, center.lat], [off.lng, off.lat]] } });
      } catch (_) {}
    });
    _gtSpiderSetLines(lineFeatures);
    _gtSpider = { active: true, mks: group.slice() };
    _gtClearClusterBadges();   // beim Auffächern keine Anzahl-Badges
    return true;
  }

  // v0.9.352 — alle Anzahl-Badges entfernen
  function _gtClearClusterBadges() {
    markers.forEach(mk => {
      let el; try { el = mk.getElement(); } catch (_) { return; }
      if (!el) return;
      const b = el.querySelector(".pm-count");
      if (b) b.remove();
      el.classList.remove("pm-clustered");
    });
  }

  // v0.9.352 — Pins, die pixelgenau übereinanderliegen, bekommen am obersten Pin
  // ein kleines Zahl-Badge (= wie viele Fotos dort liegen). Wird nach jedem Redraw
  // und bei Karten-Bewegung/Zoom neu berechnet (Cluster hängen vom Zoom ab).
  function _gtUpdateClusterBadges() {
    if (!map || isUnmounted) return;
    _gtClearClusterBadges();
    if (_gtSpider.active) return;   // im aufgefächerten Zustand keine Badges
    const pts = [];
    markers.forEach(mk => {
      try { pts.push({ mk, p: map.project(mk.getLngLat()) }); } catch (_) {}
    });
    const R = 16;
    const used = new Set();
    for (let i = 0; i < pts.length; i++) {
      if (used.has(i)) continue;
      const group = [i];
      for (let j = i + 1; j < pts.length; j++) {
        if (used.has(j)) continue;
        if (Math.hypot(pts[i].p.x - pts[j].p.x, pts[i].p.y - pts[j].p.y) <= R) group.push(j);
      }
      group.forEach(k => used.add(k));
      if (group.length < 2) continue;
      // Badge auf den zuletzt gezeichneten (= obenliegenden) Pin der Gruppe
      const top = pts[group[group.length - 1]].mk;
      let el; try { el = top.getElement(); } catch (_) { continue; }
      if (!el) continue;
      el.classList.add("pm-clustered");
      const b = document.createElement("div");
      b.className = "pm-count";
      b.textContent = String(group.length);
      el.appendChild(b);
      if (el.parentNode) el.parentNode.appendChild(el);   // nach vorn
    }
  }

  // ── v0.9.337 — Interaktiver Aufnahmerichtungs-Kompass auf der Karte ──────
  // Marc-Feature: das selektierte Foto erscheint auf der Karte mit einem Kompass.
  // Ziehen = Aufnahmerichtung setzen (dir_src="manual"); ✕ = Richtung unbekannt
  // (abschalten). Vorhandene Richtung (EXIF/Logger) wird angezeigt und ist
  // korrigierbar. Schreibt später GPSImgDirection (siehe write-Worker).

  function _gtHideCompass() {
    if (_compassMarker) { try { _compassMarker.remove(); } catch (_) {} _compassMarker = null; }
  }

  function _gtShowCompass(m) {
    _gtHideCompass();
    if (!_gtWriteDirection()) return;   // v0.9.366 — Richtung aus → kein Karten-Kompass
    if (isUnmounted || !map || !m || m.lat == null) return;
    if (!(m.in_range || m.manual)) return;
    try {
      if (typeof map.getCanvasContainer !== "function" || !map.getCanvasContainer()) return;
    } catch (_) { return; }

    const ph = photos.find(p => p.path === m.path);
    const el = document.createElement("div");
    el.className = "gt-compass";
    el.innerHTML = `
      <div class="gt-compass-ring">
        <span class="gt-compass-tick n">N</span>
        <span class="gt-compass-tick e">O</span>
        <span class="gt-compass-tick s">S</span>
        <span class="gt-compass-tick w">W</span>
        <div class="gt-compass-cone"></div>
        <img class="gt-compass-thumb" src="${ph && ph.thumb ? ph.thumb : ""}" alt="">
      </div>
      <button class="gt-compass-clear" title="${t("geotagger.compass.clear", "Aufnahmerichtung unbekannt — abschalten")}">✕</button>
      <div class="gt-compass-label"></div>
    `;
    const ring = el.querySelector(".gt-compass-ring");
    const cone = el.querySelector(".gt-compass-cone");
    const label = el.querySelector(".gt-compass-label");
    const clearBtn = el.querySelector(".gt-compass-clear");
    let tmpDir = (m.dir != null ? ((m.dir % 360) + 360) % 360 : null);
    let dragging = false;

    function paint(deg) {
      if (deg == null) {
        ring.classList.add("unset");
        cone.style.display = "none";
        label.textContent = t("geotagger.compass.hint", "Ziehen = Richtung setzen");
      } else {
        ring.classList.remove("unset");
        cone.style.display = "";
        cone.style.transform = `rotate(${deg}deg)`;
        label.textContent = `${gtCompass(deg)} ${Math.round(deg)}°`;
      }
    }
    paint(tmpDir);

    function bearingFromEvent(ev) {
      const r = ring.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const px = (ev.touches ? ev.touches[0].clientX : ev.clientX);
      const py = (ev.touches ? ev.touches[0].clientY : ev.clientY);
      // 0°=N(oben), 90°=O(rechts) — passt zur nordausgerichteten Geotagger-Karte.
      return ((Math.atan2(px - cx, -(py - cy)) * 180 / Math.PI) + 360) % 360;
    }
    function onMove(ev) {
      if (!dragging) return;
      if (ev.cancelable) ev.preventDefault();
      tmpDir = bearingFromEvent(ev);
      paint(tmpDir);
    }
    function commit() {
      _gtgPushUndo("Blickrichtung gesetzt", { force: true });   // v0.9.359 — undoable
      _gtDir.set(m.path, { dir: tmpDir, src: "manual" });
      m.dir = (tmpDir != null ? tmpDir : null);
      m.dir_src = (tmpDir != null ? "manual" : null);
      m.dir_off = (tmpDir == null);
      redrawMarkers();                  // baut Pin-Pfeil + Kompass frisch auf
      const sel = matches.find(x => x.path === m.path);
      if (sel) showPhotoPopup(sel);
    }
    function onUp() {
      if (!dragging) return;
      dragging = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
      commit();
    }
    ring.addEventListener("mousedown", (ev) => {
      if (ev.button !== 0) return;
      ev.stopPropagation(); ev.preventDefault();
      dragging = true; tmpDir = bearingFromEvent(ev); paint(tmpDir);
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
    ring.addEventListener("touchstart", (ev) => {
      ev.stopPropagation();
      dragging = true; tmpDir = bearingFromEvent(ev); paint(tmpDir);
      window.addEventListener("touchmove", onMove, { passive: false });
      window.addEventListener("touchend", onUp);
    }, { passive: true });
    clearBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      tmpDir = null;
      commit();
    });

    try {
      _compassMarker = new (mapLib().Marker)({ element: el, anchor: "center" })
        .setLngLat([m.lon, m.lat]).addTo(map);
    } catch (e) { console.warn("compass add failed", e); }
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
  // v0.9.359 — Undo-Snapshot/-Restore des kompletten Geotagger-JS-State.
  // (Foto-Add/Remove ist NICHT abgedeckt — das berührt Backend-Registrierung.)
  function _gtUndoCaptureState() {
    return {
      manual: [..._gtManual.entries()].map(([p, v]) => [p, Object.assign({}, v)]),
      exif: [..._gtExifEdits.entries()].map(([p, m]) => [p, [...m.entries()]]),
      dir: [..._gtDir.entries()].map(([p, v]) => [p, Object.assign({}, v)]),
      addr: [..._gtAddr.entries()].map(([p, v]) => [p, Object.assign({}, v)]),
      unchecked: [..._gtUnchecked],
      camOff: Object.assign({}, _gtCamOffsets),
      globOff: _gtGlobalOffset,
      camIgnoreGps: Object.assign({}, _gtCamIgnoreGps),   // v0.9.364
      globIgnoreGps: _gtGlobalIgnoreGps,
      camSetTime: Object.assign({}, _gtCamSetTime),       // v0.9.370
      globSetTime: _gtGlobalSetTime,
      ref: referencePath,
    };
  }
  function _gtUndoRestoreState(s) {
    if (!s) return;
    _gtManual.clear();   (s.manual || []).forEach(([p, v]) => _gtManual.set(p, Object.assign({}, v)));
    _gtExifEdits.clear();(s.exif   || []).forEach(([p, arr]) => _gtExifEdits.set(p, new Map(arr)));
    _gtDir.clear();      (s.dir    || []).forEach(([p, v]) => _gtDir.set(p, Object.assign({}, v)));
    _gtAddr.clear();     (s.addr   || []).forEach(([p, v]) => _gtAddr.set(p, Object.assign({}, v)));
    _gtUnchecked.clear();(s.unchecked || []).forEach(p => _gtUnchecked.add(p));
    Object.keys(_gtCamOffsets).forEach(k => delete _gtCamOffsets[k]);
    Object.assign(_gtCamOffsets, s.camOff || {});
    if (typeof s.globOff === "number") _gtGlobalOffset = s.globOff;
    Object.keys(_gtCamIgnoreGps).forEach(k => delete _gtCamIgnoreGps[k]);   // v0.9.364
    Object.assign(_gtCamIgnoreGps, s.camIgnoreGps || {});
    if (typeof s.globIgnoreGps === "boolean") _gtGlobalIgnoreGps = s.globIgnoreGps;
    Object.keys(_gtCamSetTime).forEach(k => delete _gtCamSetTime[k]);       // v0.9.370
    Object.assign(_gtCamSetTime, s.camSetTime || {});
    if (typeof s.globSetTime === "boolean") _gtGlobalSetTime = s.globSetTime;
    referencePath = s.ref || null;
    // alles neu aufbauen
    try { _gtMergeManual(); } catch (_) {}
    try { matches.forEach(_gtApplyManualDir); } catch (_) {}
    try { _gtSyncSliderToContext(); } catch (_) {}
    try { _gtSyncIgnoreGpsToContext(); } catch (_) {}
    try { _gtSyncSetTimeToContext(); } catch (_) {}   // v0.9.370
    try { updateMatches(); } catch (_) {}
    try { redrawMarkers(); } catch (_) {}
    try { renderPhotoGrid(); } catch (_) {}
    try { renderFilterBar(); } catch (_) {}
    try { updateBadges(); } catch (_) {}
    try { updateSummary(); } catch (_) {}
    try { _gtRefreshWriteBtn(); } catch (_) {}
  }

  // v0.9.359 — ist dieses Foto bereits auf der Karte (manuell platziert, im Track
  // gematcht ODER mit eigenem GPS)? Dann kein erneutes Raster→Karte-Ziehen (#3).
  function _gtPhotoIsPlaced(path) {
    if (_gtManual.has(path)) return true;
    const m = matches.find(x => x.path === path);
    return !!(m && m.lat != null && (m.in_range || m.existing_gps));
  }

  async function _gtPlacePhoto(path, lat, lon, snap) {
    const ph = photos.find(p => p.path === path);
    if (!ph) return;
    _gtgPushUndo("Foto platziert", { force: true });   // v0.9.359 — undoable
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
    _gtRefreshWriteBtn();   // v0.9.344 — auch aktiv bei ausstehenden EXIF-Edits
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
          // v0.9.359 (Marc-Bug): schon platzierte/getaggte Fotos NICHT erneut aus
          // dem Raster auf die Karte ziehen (führt zu Durcheinander). Zum Verschieben
          // den Pin direkt auf der Karte ziehen.
          if (_gtPhotoIsPlaced(path)) {
            document.removeEventListener("mousemove", onMove, true);
            document.removeEventListener("mouseup", onUp, true);
            toast(t("geotagger.place.already_placed", "Schon auf der Karte — zum Verschieben den Pin direkt anfassen."), "info", 2600);
            return;
          }
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
    if (sum) {
      sum.style.display = "block";
      // v0.9.340 — Übersicht ist jetzt rein informativ (reine Zähler); die
      // interaktiven Filter sind in die Filterleiste OBEN gewandert (renderFilterBar).
      sum.innerHTML = `
        <strong>${t("geotagger.summary.title", "Übersicht:")}</strong><br>
        <span class="gt-sum-line"><span class="ok">●</span> ${t("geotagger.summary.tagged", { n: ok })}</span><br>
        ${oor ? `<span class="gt-sum-line"><span class="warn">!</span> ${t("geotagger.summary.out_of_range", { n: oor })}</span><br>` : ""}
        ${skip ? `<span class="gt-sum-line"><span class="err">?</span> ${t("geotagger.summary.no_exif_time", { n: skip })}</span><br>` : ""}
        ${existing ? `<span class="gt-sum-line" style="color:var(--text-muted)">⌃ ${t("geotagger.summary.existing", { n: existing })}</span>` : ""}
      `;
    }
    renderFilterBar();
  }

  // v0.9.340 — Filterleiste oben: Chips für Kategorien + Kameras. Klick toggelt
  // den Filter (gemeinsamer delegierter Handler). Wirkt auf Thumbnails UND Karte.
  function renderFilterBar() {
    const bar = document.getElementById("gt-filterbar");
    if (!bar) return;
    if (!photos.length) { bar.innerHTML = ""; return; }
    const ok = matches.filter(m => m.lat != null && m.in_range).length;
    const oor = matches.filter(m => m.lat != null && !m.in_range).length;
    const skip = matches.filter(m => m.lat == null).length;
    const existing = matches.filter(m => m.existing_gps).length;
    const camCounts = new Map();
    for (const p of photos) {
      if (!p || !p.path) continue;
      const c = _gtPhotoCamera(p);
      camCounts.set(c, (camCounts.get(c) || 0) + 1);
    }
    const anyFilter = !!(_gtFilter || _gtCamFilter);
    const chip = (active, attr, label, n) =>
      `<button type="button" class="gt-fchip${active ? " active" : ""}" ${attr}>${label}`
      + (n != null ? ` <span class="n">${n}</span>` : "") + `</button>`;
    let html = chip(!anyFilter, 'data-gtfilter="reset"', t("geotagger.filter.all", "Alle"), photos.length);
    if (ok)       html += chip(_gtFilter === "tagged", 'data-gtfilter="tagged"', t("geotagger.filter.tagged", "Im Track"), ok);
    if (oor)      html += chip(_gtFilter === "oor", 'data-gtfilter="oor"', t("geotagger.filter.oor", "Außerhalb Trackzeit"), oor);
    if (skip)     html += chip(_gtFilter === "notime", 'data-gtfilter="notime"', t("geotagger.filter.notime", "Ohne Zeit"), skip);
    if (existing) html += chip(_gtFilter === "hasgps", 'data-gtfilter="hasgps"', t("geotagger.filter.hasgps", "Mit GPS"), existing);
    if (camCounts.size >= 2) {
      html += `<span class="gt-fsep"></span>`;
      [...camCounts.entries()].sort((a, b) => b[1] - a[1]).forEach(([cam, n]) => {
        const lbl = (cam === _GT_CAM_UNKNOWN) ? t("geotagger.filter.cam_unknown", "Unbekannt") : cam;
        let label = "📷 " + _gtEsc(lbl);
        // v0.9.354 — eigener Zeit-Offset für diese Kamera? Als Badge anzeigen —
        // aber nur, wenn er sich vom globalen Default unterscheidet (ein „0 == global"-
        // Override bewirkt nichts und soll kein „+0s"-Badge erzeugen; deckt auch
        // Alt-Projekte mit redundanten Einträgen ab).
        if (Object.prototype.hasOwnProperty.call(_gtCamOffsets, cam)
            && _gtCamOffsets[cam] !== _gtGlobalOffset) {
          label += ` <span class="gt-camoff">${_gtEsc(fmtSeconds(_gtCamOffsets[cam]).replace(/\s+/g, ""))}</span>`;
        }
        html += chip(_gtCamFilter === cam, `data-gtcam="${_gtEsc(cam)}"`, label, n);
      });
    }
    bar.innerHTML = html;
  }

  // v0.9.340 — passt ein Match in die aktiven Filter (Kamera + Kategorie)? Für die
  // Karten-Marker (WYSIWYG: gefiltert = auch auf der Karte weg).
  function _gtMatchInFilter(m) {
    if (!m) return false;
    if (_gtCamFilter) {
      const ph = photos.find(p => p.path === m.path);
      if (!ph || _gtPhotoCamera(ph) !== _gtCamFilter) return false;
    }
    if (_gtFilter) {
      switch (_gtFilter) {
        case "tagged": return m.lat != null && m.in_range;
        case "oor":    return m.lat != null && !m.in_range;
        case "notime": return m.lat == null;
        case "hasgps": return !!m.existing_gps;
      }
    }
    return true;
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
    _gtgPushUndo("Häkchen umgeschaltet", { force: true });   // v0.9.359 — undoable
    if (_gtUnchecked.has(path)) _gtUnchecked.delete(path);
    else _gtUnchecked.add(path);
    updateSummary();
  }

  function _gtSetFilter(key) {
    if (key === "reset") { _gtFilter = null; _gtCamFilter = null; }
    else _gtFilter = (_gtFilter === key) ? null : key;
    _gtSyncSliderToContext();   // v0.9.354 — Reset stellt den Slider auf den globalen Offset
    _gtSyncIgnoreGpsToContext();  // v0.9.364 — Checkbox folgt der gefilterten Kamera
    _gtSyncSetTimeToContext();  // v0.9.370 — Checkbox folgt der gefilterten Kamera
    renderPhotoGrid();
    redrawMarkers();   // v0.9.340 — Filter wirkt auch auf die Karte (WYSIWYG)
    updateSummary();
  }

  function _gtSetCamFilter(cam) {
    _gtCamFilter = (_gtCamFilter === cam) ? null : cam;
    _gtSyncSliderToContext();   // v0.9.354 — Slider folgt der gerade gefilterten Kamera
    _gtSyncIgnoreGpsToContext();  // v0.9.364 — Checkbox folgt der gefilterten Kamera
    _gtSyncSetTimeToContext();  // v0.9.370 — Checkbox folgt der gefilterten Kamera
    renderPhotoGrid();
    redrawMarkers();   // v0.9.340 — Filter wirkt auch auf die Karte (WYSIWYG)
    updateSummary();
  }

  // v0.9.232 (Nutzer-Wunsch): manuelle Platzierung aufheben → Foto wird wieder
  // per Aufnahmezeit gegen den Track gematcht (wie frisch importiert), OHNE es
  // zu löschen und neu reinzuholen. Nur für aktuell manuell platzierte Fotos.
  function _gtResyncPhoto(path) {
    if (!path || !_gtManual.has(path)) return;
    _gtgPushUndo("Platzierung aufgehoben", { force: true });   // v0.9.359 — undoable
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
  // entfernt. v0.9.362 (Marc): jetzt auch Filterleiste UND Zeit-Offset zurücksetzen
  // (vorher blieben die Filter-Chips stehen und der Offset auf seinem letzten Wert).
  // Reine Geräte-Prefs (Backup-Toggle, Kamera-Zeitzone) bleiben. DOM-Zugriffe
  // guarded für den nicht-gemounteten Fall.
  // v0.9.362 (Marc-Bug) — gemeinsamer Reset von Filtern, Zeit-Offset, Blickrichtungen/
  // Adressen, Undo-Stack + Filterleiste. Wird BEIDE Wege aufgerufen: rotes ✕
  // (_gtClearWorkspace) UND Session-Schließen (leerer onGpxLoaded). Vorher blieben
  // die Filter-Chips oben stehen und der Offset auf seinem letzten Wert.
  // Geräte-Prefs (Backup-Toggle, Kamera-Zeitzone) bleiben bewusst unangetastet.
  function _gtResetFiltersAndOffset() {
    _gtFilter = null;          // Übersicht-Filter
    _gtCamFilter = null;       // Kamera-Filter
    _gtUnchecked.clear();      // Tag-Auswahl
    _gtManual.clear();         // manuelle Platzierungen
    _gtDir.clear();            // Blickrichtungen
    _gtAddr.clear();           // Adressen
    try { _gtGeoSeen.clear(); } catch (_) {}
    _gtGlobalOffset = 0;       // Zeit-Offset global + pro Kamera zurück auf 0
    Object.keys(_gtCamOffsets).forEach(k => delete _gtCamOffsets[k]);
    _gtGlobalIgnoreGps = false;   // v0.9.364 — Foto-GPS-Ignorieren zurücksetzen
    Object.keys(_gtCamIgnoreGps).forEach(k => delete _gtCamIgnoreGps[k]);
    _gtGlobalSetTime = false;     // v0.9.370 — „Zeit aus Track" zurücksetzen
    Object.keys(_gtCamSetTime).forEach(k => delete _gtCamSetTime[k]);
    try {
      const _os = document.getElementById("gt-off-slider");
      if (_os) { applySliderRange(2); _os.value = "0"; }
      updateOffsetDisplay();
      _gtSyncIgnoreGpsToContext();
      _gtSyncSetTimeToContext();  // v0.9.370
    } catch (_) {}
    try { saveSettings({ geotagger: { offset_seconds: 0, cam_offsets: {}, ignore_gps: false, cam_ignore_gps: {}, set_time_from_track: false, cam_set_time_from_track: {} } }); } catch (_) {}
    try { if (_gtgUndoCtrl && _gtgUndoCtrl.reset) _gtgUndoCtrl.reset(); } catch (_) {}
    try { renderFilterBar(); } catch (_) {}
  }

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
    _gtResetFiltersAndOffset();  // v0.9.362 — Filter, Zeit-Offset, Richtungen/Adressen, Undo
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
      _gtExifEdits.clear(); _gtExif.clear();   // v0.9.344 — Pending-EXIF mit aufräumen
      _gtUpdateUnsavedBanner();
      const writeBtn = document.getElementById("gt-write");
      if (writeBtn) writeBtn.disabled = true;
      // 6) Foto-Grid + Filterleiste neu rendern (jetzt leer → Chips verschwinden)
      renderPhotoGrid();
      renderFilterBar();   // v0.9.362 (Marc) — Filter-Chips oben mit weg
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

  // v0.9.337 — manuell (Karten-Kompass) gesetzte/abgeschaltete Richtung auf ein Match anwenden
  function _gtApplyManualDir(m) {
    if (!_gtDir.has(m.path)) return;
    const d = _gtDir.get(m.path);
    if (d && d.dir != null) { m.dir = ((d.dir % 360) + 360) % 360; m.dir_src = "manual"; }
    else { m.dir = null; m.dir_src = null; m.dir_off = true; }  // ✕ = Richtung unbekannt
  }

  // v0.9.337/338 — Reverse-Geocoding (Adressen): 3-Stufen-Pyramide im Backend.
  // Gemeinsame Funktion für den manuellen Button UND das automatische Abrufen
  // beim Hinzufügen. `_gtGeoSeen` verhindert, dass der Auto-Lauf bei jeder
  // Offset-Änderung neu feuert (nur bei wirklich neuen Fotos).
  let _gtGeoPolling = false;
  let _gtAutoGeoTimer = null;

  async function _gtRunGeocode(opts) {
    opts = opts || {};
    const items = matches.filter(m => m.lat != null && m.in_range)
      .map(m => ({ path: m.path, lat: m.lat, lon: m.lon }));
    const statusEl = document.getElementById("gt-geocode-status");
    const btn = document.getElementById("gt-geocode");
    if (!items.length) {
      if (statusEl && !opts.auto) statusEl.textContent = t("geotagger.geocode.none", "Keine verorteten Fotos.");
      return;
    }
    const res = await api().geotagger_reverse_geocode_start(items);
    if (!res || !res.ok) {
      if (statusEl) statusEl.textContent = res && res.disabled
        ? t("geotagger.geocode.disabled", "Adress-Suche ist in den Einstellungen aus.")
        : ((res && res.error) || "Fehler");
      return;
    }
    if (btn) btn.disabled = true;
    if (_gtGeoPolling) return;   // ein Poller genügt, neue Calls hängen sich dran
    _gtGeoPolling = true;
    const poll = async () => {
      const st = await api().geotagger_reverse_geocode_status();
      Object.entries(st.results || {}).forEach(([p, a]) => _gtAddr.set(p, a));
      if (statusEl) statusEl.textContent = t("geotagger.geocode.progress", { done: st.done, total: st.total });
      const sel = matches.find(x => x.path === selectedPath);
      if (sel) showPhotoPopup(sel);
      if (st.running) { setTimeout(poll, 700); }
      else {
        _gtGeoPolling = false;
        if (btn) btn.disabled = false;
        if (statusEl) statusEl.textContent = t("geotagger.geocode.done", { n: _gtAddr.size });
      }
    };
    poll();
  }

  // Automatisch nach dem Zuordnen — nur wenn aktiviert UND es wirklich neue,
  // noch nicht abgefragte Fotos gibt (sonst würde jeder Offset-Zug neu feuern).
  function _gtMaybeAutoGeocode() {
    if (typeof _settingsCache !== "undefined" && _settingsCache && _settingsCache.geocode_enabled === false) return;
    const fresh = matches.some(m => m.lat != null && m.in_range &&
      !_gtAddr.has(m.path) && !_gtGeoSeen.has(m.path));
    if (!fresh) return;
    matches.forEach(m => { if (m.lat != null && m.in_range) _gtGeoSeen.add(m.path); });
    clearTimeout(_gtAutoGeoTimer);
    _gtAutoGeoTimer = setTimeout(() => _gtRunGeocode({ auto: true }), 1200);
  }

  const geocodeBtn = document.getElementById("gt-geocode");
  if (geocodeBtn) geocodeBtn.addEventListener("click", () => _gtRunGeocode({ manual: true }));

  // v0.9.346 — Globale Felder (Urheber/Copyright/…)
  const globalBtn = document.getElementById("gt-global-fields");
  if (globalBtn) globalBtn.addEventListener("click", () => _gtOpenGlobalFields());
  _gtUpdateGlobalStatus();

  // v0.9.349 — Auto-Tag per Bilderkennung (Apple Vision, nur macOS). Button nur
  // einblenden, wenn die Bridge die Verfügbarkeit bestätigt.
  const autotagBtn = document.getElementById("gt-autotag");
  if (autotagBtn) {
    autotagBtn.addEventListener("click", () => _gtRunAutotag());
    (async () => {
      try {
        const avail = await api().autotag_available();
        autotagBtn.style.display = avail ? "" : "none";
        const st = document.getElementById("gt-autotag-status");
        if (st && !avail) st.textContent = "";
      } catch (_) { autotagBtn.style.display = "none"; }
    })();
  }

  document.getElementById("gt-write").addEventListener("click", async () => {
    const writable = matches.filter(m => m.lat != null && m.in_range && _gtMatchTaggable(m));
    // v0.9.367 — Gruppen-Schalter: getrennt zusammenbauen, je nach Häkchen mitnehmen.
    const _wf = (id) => { const e = document.getElementById(id); return e ? e.checked : true; };
    const wfKeywords = _wf("gt-wf-keywords");   // Auto-Tag-Stichwörter
    const wfExifEdits = _wf("gt-wf-exif");      // manuelle EXIF-Bearbeitungen
    const wfGlobal = _wf("gt-wf-global");       // globale Felder
    // v0.9.344/367 — ausstehende EXIF-Edits aufteilen: „Keywords" (Bilderkennung) vs.
    // sonstige manuelle Edits; jede Gruppe nur, wenn ihr Schalter an ist.
    const exifEdits = {};
    let manualCount = 0, keywordCount = 0;
    _gtExifEdits.forEach((mm, p) => {
      mm.forEach((v, k) => {
        const isKw = (k === "Keywords");
        if (isKw) { keywordCount++; if (!wfKeywords) return; }
        else { manualCount++; if (!wfExifEdits) return; }
        (exifEdits[p] = exifEdits[p] || {})[k] = v;
      });
    });
    const exifEditCount = (wfExifEdits ? manualCount : 0) + (wfKeywords ? keywordCount : 0);

    // v0.9.346/367 — globale Felder (Urheber/Copyright/…) nur mergen wenn Gruppe an.
    const globalTags = _gtGlobalTags();
    const globalFieldCount = _gtGlobalActiveCount();
    const globalTargets = _gtGlobalTargetPhotos();
    const globalActive = wfGlobal && Object.keys(globalTags).length > 0 && globalTargets.length > 0;
    if (globalActive) {
      globalTargets.forEach(p => {
        exifEdits[p.path] = Object.assign({}, globalTags, exifEdits[p.path] || {});
      });
    }

    if (!writable.length && !exifEditCount && !globalActive) { toast(t("geotagger.toast.nothing_to_write"), "warn"); return; }

    // v0.9.337 — geocodete Adresse + manuell gesetzte Richtung an die Matches hängen
    writable.forEach(m => {
      if (_gtAddr.has(m.path)) m.address = _gtAddr.get(m.path);
      _gtApplyManualDir(m);
    });
    const writeFields = getWriteFields();

    const writeMode = (document.getElementById("gt-write-mode") || {}).value || "fill";
    const backup = false;   // v0.9.372 — kein Backup-ZIP mehr (Originale unangetastet)
    const adjustTime = document.getElementById("gt-adjust-time").checked;
    // v0.9.370 — „Aufnahmezeit auf Track-Zeit setzen" pro Kamera (globaler Default
    // + Override je Kamera, greift im Backend pro Foto). Ersetzt den alten globalen
    // Schalter aus der „Manuell platzieren"-Sektion.
    const setTimeFromTrack = _gtGlobalSetTime;
    const camSetTime = Object.assign({}, _gtCamSetTime);
    // v0.9.354 — globaler Default; Pro-Kamera-Offsets gehen separat als cam_offsets
    // ins Backend (greift dort pro Foto, auch für die Aufnahmezeit-Korrektur).
    const offsetSec = _gtGlobalOffset;
    const camOffsets = Object.assign({}, _gtCamOffsets);

    // v0.9.339 — Modus bestimmt, wie mit schon-vorhandenem GPS umgegangen wird.
    const withExisting = writable.filter(m => m.existing_gps).length;
    const toWrite = (writeMode === "skip_existing") ? (writable.length - withExisting) : writable.length;
    const modeRowLabel = writeMode === "overwrite"
      ? t("geotagger.mode.row_overwrite", "Werden überschrieben")
      : (writeMode === "skip_existing"
        ? t("geotagger.mode.row_skip", "Werden ausgelassen")
        : t("geotagger.mode.row_fill", "Behalten GPS, bekommen Fehlendes ergänzt"));

    // Backup-Pfad lookup für Anzeige
    const paths = await api().get_paths();

    // Bestätigungs-Modal
    // v0.9.354 — bei Pro-Kamera-Offsets ist der Wert nicht mehr einheitlich.
    const _hasCamOff = _gtHasCamOffsets();
    const offsetTxt = _hasCamOff
      ? t("geotagger.offset.per_camera", "pro Kamera")
      : fmtSeconds(offsetSec);
    const timeAdjustBlock = (adjustTime && (offsetSec !== 0 || _hasCamOff))
      ? `<div class="modal-stat-row"><span class="label">⏰ Foto-Aufnahmezeit anpassen</span><span class="val" style="color:var(--warn)">${toWrite} × ${offsetTxt}</span></div>`
      : '';
    // v0.9.370 — wie viele Fotos bekommen ihre Aufnahmezeit aus der Track-Zeit gesetzt.
    const _setTimeCount = writable.filter(m => _gtEffectiveSetTime(m.camera || _GT_CAM_UNKNOWN)).length;
    const setTimeBlock = _setTimeCount
      ? `<div class="modal-stat-row"><span class="label">🕒 ${t("geotagger.settime.summary_row", "Aufnahmezeit auf Track-Zeit")}</span><span class="val" style="color:var(--warn)">${_setTimeCount}</span></div>`
      : '';
    const summary = `
      <div class="modal-stat-row"><span class="label">Erkannte Fotos im Track</span><span class="val">${writable.length}</span></div>
      <div class="modal-stat-row"><span class="label">Davon mit bereits gesetztem GPS</span><span class="val">${withExisting}</span></div>
      ${withExisting ? `<div class="modal-stat-row"><span class="label">${modeRowLabel}</span><span class="val muted">${withExisting}</span></div>` : ''}
      <div class="modal-stat-row"><span class="label"><strong>Werden getaggt</strong></span><span class="val" style="color:var(--accent)">${toWrite}</span></div>
      ${exifEditCount ? `<div class="modal-stat-row"><span class="label">✎ ${t("geotagger.exif.summary_row", "Bearbeitete EXIF-Felder")}</span><span class="val" style="color:var(--accent)">${exifEditCount}</span></div>` : ''}
      ${globalActive ? `<div class="modal-stat-row"><span class="label">🌐 ${t("geotagger.gf.summary_row", "Globale Felder")}</span><span class="val" style="color:var(--accent)">${globalFieldCount} × ${globalTargets.length} ${t("geotagger.gf.summary_photos", "Fotos")}</span></div>` : ''}
      ${timeAdjustBlock}
      ${setTimeBlock}
      <p class="muted" style="margin-top:14px; line-height:1.45; font-size:12px">
        💾 Gleich wählst du einen <b>Zielordner</b> — dorthin schreiben wir die
        getaggten Kopien. Deine <b>Originale bleiben unangetastet</b> (sie sind damit
        selbst die Sicherung).
      </p>
    `;

    // Nichts zu tun nur, wenn weder GPS noch EXIF-Edits noch globale Felder anstehen
    if (toWrite === 0 && !exifEditCount && !globalActive) {
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
      openModal({}).close();   // Bestätigungs-Modal schließen
      // v0.9.372 — Zielordner wählen: getaggte KOPIEN landen dort, Originale bleiben
      // unangetastet (= das Backup selbst). Kein ZIP, kein „danach exportieren" mehr.
      const folders = await api().pick_file("folder");
      if (!folders || !folders.length) return;   // abgebrochen
      const destDir = folders[0];
      // Würde eine Kopie auf ein Original fallen (Zielordner == Ordner echter
      // Originale)? Nur für „Ordner wählen"-Fotos relevant — Drops liegen unter _drops/.
      const norm = (s) => (s || "").replace(/[\\/]+$/, "");
      const parentDir = (p) => norm((p || "").replace(/[\\/][^\\/]*$/, ""));
      const wouldOverwrite = writable.some(m =>
        !/[\\/]_drops[\\/]/.test(m.path || "") && parentDir(m.path) === norm(destDir));
      let overwriteOriginals = false;
      if (wouldOverwrite) {
        overwriteOriginals = await new Promise((resolve) => {
          openModal({
            title: "Originale überschreiben?",
            body: `<p style="line-height:1.5">Das ist der Ordner deiner <b>Originale</b>.
                   Sollen die Originale hier wirklich <b>überschrieben</b> werden?
                   <br><span style="color:var(--warn)">Ohne Backup — das lässt sich nicht rückgängig machen.</span></p>`,
            footer: `<button class="btn" id="ov-cancel">Abbrechen</button>
                     <button class="btn btn-danger" id="ov-ok">Ja, überschreiben</button>`,
          });
          document.getElementById("ov-cancel").onclick = () => { openModal({}).close(); resolve(false); };
          document.getElementById("ov-ok").onclick = () => { openModal({}).close(); resolve(true); };
        });
        if (!overwriteOriginals) return;   // abgebrochen → nichts schreiben
      }
      runWriteWithProgress(writable, backup, writeMode, adjustTime, offsetSec, setTimeFromTrack,
        writeFields, exifEdits, camOffsets, camSetTime, destDir, overwriteOriginals);
    };
  });

  async function runWriteWithProgress(writable, backup, writeMode, adjustTime, offsetSec, setTimeFromTrack, writeFields, exifEdits, camOffsets, camSetTime, destDir, overwriteOriginals) {
    const res = await api().geotagger_start_write(
      writable, backup, (writeMode === "overwrite"), adjustTime, offsetSec, !!setTimeFromTrack,
      writeFields || { gps: true, altitude: true, direction: true, address: true },
      writeMode || "fill",
      exifEdits || {},
      camOffsets || {},   // v0.9.354 — Pro-Kamera-Offsets
      camSetTime || {},   // v0.9.370 — Pro-Kamera „Zeit aus Track"
      destDir || "",      // v0.9.372 — Zielordner für die getaggten Kopien
      !!overwriteOriginals // v0.9.372 — Originale bewusst überschreiben (bestätigt)
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
    // v0.9.372 — Neues Modell: getaggte Fotos liegen als Kopien im gewählten
    // Zielordner (Originale unangetastet). Kein Export-Schritt, kein Backup-ZIP mehr.
    const dir = s.saved_dir || "";
    const dirName = dir ? dir.replace(/[\\/]+$/, "").split(/[\\/]/).pop() : "";
    const savedRow = (dir && !canceled && s.done > 0)
      ? `<div class="modal-stat-row"><span class="label">Gespeichert in</span><span class="val mono">${dirName}</span></div>`
      : '';
    const canOpen = dir && !canceled && s.done > 0;

    openModal({
      title: canceled ? "Abgebrochen" : "Fertig",
      body: `
        <div class="modal-stat-row"><span class="label">Fotos getaggt</span><span class="val" style="color:var(--success)">${s.done}</span></div>
        ${s.skipped ? `<div class="modal-stat-row"><span class="label">Fehler / übersprungen</span><span class="val" style="color:var(--danger)">${s.skipped}</span></div>` : ''}
        ${s.skipped_existing ? `<div class="modal-stat-row"><span class="label">Bereits getaggt (übersprungen)</span><span class="val muted">${s.skipped_existing}</span></div>` : ''}
        ${savedRow}
        ${errBlock}
      `,
      footer: `
        ${canOpen ? '<button class="btn btn-primary" id="md-open">Ordner öffnen</button>' : ''}
        <button class="btn ${canOpen ? '' : 'btn-primary'}" id="md-ok">OK</button>
      `,
      closable: true,
    });
    if (canOpen) {
      document.getElementById("md-open").onclick = () => { api().reveal_in_finder(dir); };
    }
    document.getElementById("md-ok").onclick = () => openModal({}).close();

    // v0.9.344 — geschriebene EXIF-Edits aus dem Pending-Speicher räumen + EXIF-Cache
    // invalidieren, damit ein erneutes Öffnen die frischen Werte von der Platte liest.
    if (!canceled) {
      _gtExifEdits.clear();
      _gtExif.clear();
      _gtRefreshWriteBtn();
      const mSel = matches.find(x => x.path === selectedPath);
      if (mSel && document.getElementById("gt-preview")?.classList.contains("show")) {
        _gtRenderExif(selectedPath); _gtFetchExif(selectedPath);
      }
    }

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
