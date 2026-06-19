// Reisezoom GPS Studio — Frame + Modul-Routing + i18n + Settings-Modal

let activeMod = null;
let activeCleanup = null;

function applyI18nToModuleManifests() {
  // Manifests aus den geladenen Strings überschreiben (Name + Beschreibung).
  const reg = window.RZGPS_MODULES || {};
  for (const slug of Object.keys(reg)) {
    const m = reg[slug].manifest;
    if (!m) continue;
    const name = t(`modules.${slug}.name`);
    const desc = t(`modules.${slug}.desc`);
    if (name && name !== `modules.${slug}.name`) m.name = name;
    if (desc && desc !== `modules.${slug}.desc`) m.desc = desc;
    if (!("description" in m)) m.description = desc;
    else m.description = desc;
  }
}

function getModules() {
  const reg = window.RZGPS_MODULES || {};
  return Object.values(reg).sort((a, b) =>
    (a.manifest.sort_order || 999) - (b.manifest.sort_order || 999)
  );
}

function renderTabs() {
  const wrap = document.getElementById("module-tabs");
  wrap.innerHTML = "";
  for (const mod of getModules()) {
    const m = mod.manifest;
    const btn = document.createElement("button");
    btn.className = "mod-btn" + (m.slug === activeMod ? " active" : "");
    btn.dataset.mod = m.slug;
    btn.innerHTML = `
      <span class="mod-ico">${m.icon || "•"}</span>
      <span class="mod-label">
        <span class="mod-name">${m.name}</span>
        ${m.description ? `<span class="mod-desc">${m.description}</span>` : ""}
      </span>
    `;
    btn.addEventListener("click", () => switchMod(m.slug));
    wrap.appendChild(btn);
  }
}

function switchMod(slug) {
  if (slug === activeMod) return;
  const reg = window.RZGPS_MODULES || {};
  if (!reg[slug]) return;
  if (typeof activeCleanup === "function") activeCleanup();
  activeMod = slug;
  saveSettings({ active_module: slug });
  renderTabs();
  renderMod();
}

function renderMod() {
  applog && applog("info", `[renderMod] activeMod=${activeMod}`);
  const reg = window.RZGPS_MODULES || {};
  const mod = reg[activeMod];
  if (!mod) {
    document.getElementById("main").innerHTML =
      '<div class="empty-state"><div class="empty-state-title">Kein Modul aktiv</div></div>';
    return;
  }
  const m = mod.manifest;
  const root = document.getElementById("main");
  // v0.8.2: Modul-Header ohne Titel/Subtitel — der aktive Modul-Tab in
  // der oberen Topbar zeigt schon, wo man ist. Stattdessen links der
  // globale GPX-Picker (gpx-bar.js) und rechts modul-spezifische
  // Aktionen (z.B. Stats-Pills).
  root.innerHTML = `
    <div class="module-header">
      <div class="module-header-gpx" id="mod-header-gpx"></div>
      <div class="module-header-actions" id="mod-header-actions"></div>
    </div>
    <div class="module-body" id="module-body"></div>
  `;
  // GPX-Bar in den linken Header-Slot einsetzen
  if (typeof renderGpxBarInto === "function") {
    renderGpxBarInto(document.getElementById("mod-header-gpx"));
  }
  activeCleanup = mod.mount(
    document.getElementById("module-body"),
    document.getElementById("mod-header-actions"),
  );
}

// ── Settings-Modal ──────────────────────────────────────────────────────────

async function openSettingsModal() {
  const meta = i18nMeta();
  const available = meta.available || [];
  const current = (_settingsCache && _settingsCache.language) || "auto";

  const langOptions = [
    `<option value="auto"${current === "auto" ? " selected" : ""}>${t("settings.language.auto")} (${meta.system_locale})</option>`,
    ...available.map(l =>
      `<option value="${l.code}"${current === l.code ? " selected" : ""}>${l.native_label}</option>`
    ),
  ].join("");

  // Aktueller Mapbox-Token-Status
  const tokInfo = await api().mapbox_token_info();
  const currentTok = (_settingsCache && _settingsCache.mapbox_token) || "";
  const tokenStatusLabel = tokInfo.is_user_token
    ? `<span style="color:var(--success)">●</span> ${t("settings.mapbox.user_active")}`
    : `<span style="color:var(--text-muted)">●</span> ${t("settings.mapbox.default_active")}`;

  // v0.9.245 — Globale Render-/Export-Qualität
  const rq = (_settingsCache && _settingsCache.render) || {};
  const rqFmt = rq.frame_format || "jpeg";
  const rqJq = (rq.jpeg_quality != null) ? rq.jpeg_quality : 92;
  const rqCodec = rq.codec || "h264";
  const rqCrf = (rq.crf != null) ? rq.crf : 20;
  const rqPreset = rq.encoder_preset || "fast";
  const _sel = (a, b) => (a === b ? " selected" : "");
  // v0.9.247 — OSM-Modus erzwingen (Test)
  const forceOsm = !!(_settingsCache && _settingsCache.force_osm);
  const hasTok = !!(currentTok && currentTok.startsWith("pk."));
  // v0.9.287 — Eigene Standardwerte für neue Tracks (Marc-Wunsch)
  const udInfo = await api().get_user_defaults_info().catch(() => ({ has_custom: false }));

  openModal({
    title: t("settings.title"),
    body: `
      <p class="muted" style="margin-bottom:4px">${t("settings.language")}</p>
      <select id="md-lang" style="width:100%;">${langOptions}</select>
      <p class="muted" style="margin-top:6px; font-size:11px;">${t("settings.language.help")}</p>

      <div style="margin-top:18px; padding-top:14px; border-top: 1px solid var(--border);">
        <p class="muted" style="margin-bottom:4px; display:flex; justify-content:space-between; align-items:baseline;">
          <span>${t("settings.mapbox.label")}</span>
          <span style="font-size:11px">${tokenStatusLabel}</span>
        </p>
        <input type="text" id="md-mapbox-token" style="width:100%; font-family:ui-monospace,Menlo,monospace; font-size:11.5px;"
               placeholder="pk.eyJ1Ijoi..." value="${currentTok.replace(/"/g, '&quot;')}">
        <p class="muted" style="margin-top:6px; font-size:11px;">
          ${t("settings.mapbox.help_short")}
          &nbsp;<a href="#" id="md-mapbox-help-link" style="color:var(--accent); text-decoration:underline; cursor:pointer">${t("settings.mapbox.help_link")}</a>
        </p>
        <p style="margin-top:10px; font-size:12px;">
          <a href="#" id="md-mapbox-usage-link" style="color:var(--accent); text-decoration:underline; cursor:pointer">${t("settings.mapbox.usage_link")}</a>
        </p>
        <p class="muted" style="margin-top:2px; font-size:11px;">${t("settings.mapbox.usage_hint")}</p>
        <label style="display:flex; align-items:center; gap:8px; margin-top:12px; font-size:12.5px; cursor:pointer;">
          <input type="checkbox" id="md-force-osm" ${forceOsm ? "checked" : ""}>
          <span>${t("settings.force_osm.label")}</span>
        </label>
        <p class="muted" style="margin-top:2px; font-size:11px; line-height:1.5; padding-left:24px;">${t("settings.force_osm.help")}</p>
      </div>

      <div style="margin-top:18px; padding-top:14px; border-top:1px solid var(--border);">
        <p class="muted" style="margin-bottom:8px; font-weight:600; color:var(--text);">${t("settings.render.title")}</p>

        <label class="field-label" for="md-rq-fmt" style="font-size:12px;">${t("settings.render.frame_format")}</label>
        <select id="md-rq-fmt" style="width:100%;">
          <option value="jpeg"${_sel(rqFmt, "jpeg")}>${t("settings.render.fmt_jpeg")}</option>
          <option value="png"${_sel(rqFmt, "png")}>${t("settings.render.fmt_png")}</option>
        </select>
        <div id="md-rq-jq-row" style="margin-top:8px;${rqFmt === "jpeg" ? "" : "display:none;"}">
          <label class="field-label" for="md-rq-jq" style="font-size:12px; display:flex; justify-content:space-between;">
            <span>${t("settings.render.jpeg_quality")}</span><span id="md-rq-jq-val">${rqJq}</span>
          </label>
          <input type="range" id="md-rq-jq" min="70" max="100" step="1" value="${rqJq}" style="width:100%;">
        </div>

        <label class="field-label" for="md-rq-codec" style="font-size:12px; margin-top:12px; display:block;">${t("settings.render.codec")}</label>
        <select id="md-rq-codec" style="width:100%;">
          <option value="h264"${_sel(rqCodec, "h264")}>${t("settings.render.codec_h264")}</option>
          <option value="h265"${_sel(rqCodec, "h265")}>${t("settings.render.codec_h265")}</option>
          <option value="prores"${_sel(rqCodec, "prores")}>${t("settings.render.codec_prores")}</option>
        </select>

        <div id="md-rq-enc-rows" style="${rqCodec === "prores" ? "display:none;" : ""}">
          <div style="margin-top:8px;">
            <label class="field-label" for="md-rq-crf" style="font-size:12px; display:flex; justify-content:space-between;">
              <span>${t("settings.render.crf")}</span><span id="md-rq-crf-val">${rqCrf}</span>
            </label>
            <input type="range" id="md-rq-crf" min="16" max="28" step="1" value="${rqCrf}" style="width:100%;">
            <p class="muted" style="font-size:10.5px; margin-top:2px;">${t("settings.render.crf_hint")}</p>
          </div>
          <label class="field-label" for="md-rq-preset" style="font-size:12px; margin-top:8px; display:block;">${t("settings.render.preset")}</label>
          <select id="md-rq-preset" style="width:100%;">
            <option value="veryfast"${_sel(rqPreset, "veryfast")}>${t("settings.render.preset_veryfast")}</option>
            <option value="fast"${_sel(rqPreset, "fast")}>${t("settings.render.preset_fast")}</option>
            <option value="medium"${_sel(rqPreset, "medium")}>${t("settings.render.preset_medium")}</option>
            <option value="slow"${_sel(rqPreset, "slow")}>${t("settings.render.preset_slow")}</option>
          </select>
        </div>
        <p class="muted" style="margin-top:8px; font-size:11px; line-height:1.5;">${t("settings.render.hint")}</p>
      </div>

      <div style="margin-top:18px; padding-top:14px; border-top:1px solid var(--border);">
        <p class="muted" style="margin-bottom:6px; font-weight:600; color:var(--text);">${t("settings.defaults.title")}</p>
        <p class="muted" style="font-size:11px; line-height:1.5; margin-bottom:10px;">${t("settings.defaults.help")}</p>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="btn" id="md-save-defaults">${t("settings.defaults.save")}</button>
          <button class="btn" id="md-reset-defaults"${udInfo && udInfo.has_custom ? "" : " disabled"}>${t("settings.defaults.reset")}</button>
        </div>
        <p class="muted" id="md-defaults-status" style="font-size:11px; margin-top:8px;">${(udInfo && udInfo.has_custom) ? t("settings.defaults.status_custom") : t("settings.defaults.status_factory")}</p>
      </div>

    `,
    footer: `
      <button class="btn" id="md-cancel-set">${t("common.cancel")}</button>
      <button class="btn btn-primary" id="md-ok-set">${t("common.save")}</button>
    `,
  });

  // v0.9.287 — Eigene Standardwerte für neue Tracks (Marc-Wunsch). Wirkt sofort
  // (unabhängig von Speichern/Abbrechen des Dialogs), da es ein eigener Vorgang ist.
  {
    const saveDefBtn = document.getElementById("md-save-defaults");
    const resetDefBtn = document.getElementById("md-reset-defaults");
    const defStatus = document.getElementById("md-defaults-status");
    if (saveDefBtn) saveDefBtn.onclick = async () => {
      const sess = (typeof getActiveSession === "function") ? getActiveSession() : null;
      const proj = (typeof getActiveProject === "function") ? getActiveProject() : null;
      try {
        const res = await api().save_user_defaults((sess && sess.track_hash) || "", (proj && proj.id) || "");
        if (res && res.ok) {
          toast(t("settings.defaults.saved"), "success");
          if (resetDefBtn) resetDefBtn.disabled = false;
          if (defStatus) defStatus.textContent = t("settings.defaults.status_custom");
        } else { toast(t("settings.defaults.error"), "warn"); }
      } catch (_) { toast(t("settings.defaults.error"), "warn"); }
    };
    if (resetDefBtn) resetDefBtn.onclick = async () => {
      try {
        const res = await api().reset_user_defaults();
        if (res && res.ok) {
          toast(t("settings.defaults.reset_done"), "success");
          resetDefBtn.disabled = true;
          if (defStatus) defStatus.textContent = t("settings.defaults.status_factory");
        } else { toast(t("settings.defaults.error"), "warn"); }
      } catch (_) { toast(t("settings.defaults.error"), "warn"); }
    };
  }

  document.getElementById("md-mapbox-help-link").onclick = (e) => {
    e.preventDefault();
    openMapboxHelpModal();
  };
  // v0.8.0: Direkt-Link zum Mapbox-Usage-Dashboard. Öffnet im externen
  // Browser via pywebview-Bridge (Marc kann dort seinen Verbrauch sehen).
  const usageLink = document.getElementById("md-mapbox-usage-link");
  if (usageLink) usageLink.onclick = (e) => {
    e.preventDefault();
    try {
      if (api().open_external_url) {
        api().open_external_url("https://account.mapbox.com/statistics/");
      } else {
        window.open("https://account.mapbox.com/statistics/", "_blank");
      }
    } catch (_) {
      window.open("https://account.mapbox.com/statistics/", "_blank");
    }
  };
  // Render-Qualität: Live-Toggles + Slider-Labels
  const _fmtSel = document.getElementById("md-rq-fmt");
  if (_fmtSel) _fmtSel.onchange = () => {
    const row = document.getElementById("md-rq-jq-row");
    if (row) row.style.display = _fmtSel.value === "jpeg" ? "" : "none";
  };
  const _codecSel = document.getElementById("md-rq-codec");
  if (_codecSel) _codecSel.onchange = () => {
    const rows = document.getElementById("md-rq-enc-rows");
    if (rows) rows.style.display = _codecSel.value === "prores" ? "none" : "";
  };
  const _jqSl = document.getElementById("md-rq-jq");
  if (_jqSl) _jqSl.oninput = () => { const v = document.getElementById("md-rq-jq-val"); if (v) v.textContent = _jqSl.value; };
  const _crfSl = document.getElementById("md-rq-crf");
  if (_crfSl) _crfSl.oninput = () => { const v = document.getElementById("md-rq-crf-val"); if (v) v.textContent = _crfSl.value; };

  document.getElementById("md-cancel-set").onclick = () => openModal({}).close();
  document.getElementById("md-ok-set").onclick = async () => {
    const newLang = document.getElementById("md-lang").value;
    const newTok = document.getElementById("md-mapbox-token").value.trim();
    const oldTok = (_settingsCache && _settingsCache.mapbox_token) || "";

    // Token-Sanity-Check vor jedem Save
    if (newTok && !newTok.startsWith("pk.")) {
      toast(t("settings.mapbox.invalid_token"), "warn", 5000);
      return;
    }

    // Beide Settings in EINEM synchronen Bridge-Call schreiben — keine
    // Race-Condition mit nachfolgendem loadI18n().
    const patch = {};
    if (newLang !== current) patch.language = newLang;
    if (newTok !== oldTok)   patch.mapbox_token = newTok;

    // v0.9.247 — OSM-Modus erzwingen (Test)
    const newForceOsm = !!document.getElementById("md-force-osm")?.checked;
    if (newForceOsm !== forceOsm) patch.force_osm = newForceOsm;

    // v0.9.245 — Render-/Export-Qualität
    const newRender = {
      frame_format: document.getElementById("md-rq-fmt").value,
      jpeg_quality: parseInt(document.getElementById("md-rq-jq").value, 10) || 92,
      codec: document.getElementById("md-rq-codec").value,
      crf: parseInt(document.getElementById("md-rq-crf").value, 10) || 20,
      encoder_preset: document.getElementById("md-rq-preset").value,
    };
    const renderChanged = JSON.stringify(newRender) !== JSON.stringify({
      frame_format: rqFmt, jpeg_quality: rqJq, codec: rqCodec, crf: rqCrf, encoder_preset: rqPreset,
    });
    if (renderChanged) patch.render = newRender;

    if (Object.keys(patch).length === 0) {
      openModal({}).close();
      return;
    }

    await saveSettings(patch, { immediate: true });

    if (patch.mapbox_token !== undefined || patch.force_osm !== undefined) {
      // Token-Wechsel ODER OSM-Umschalter ändert die Map-Engine (Mapbox ↔ OSM),
      // Token-Cache in util.js, Animator-Style-Lock, MapLibre/Mapbox-Lib-Wahl
      // etc. — sicherer Weg: komplettes UI-Reload, damit alles frisch init.
      toast(t(patch.force_osm !== undefined ? "settings.force_osm.saved" : "settings.mapbox.saved"), "success", 2200);
      openModal({}).close();
      // Kurz warten, damit der Toast sichtbar ist, dann WebView neu laden.
      setTimeout(() => { window.location.reload(); }, 700);
      return;
    }

    if (patch.language !== undefined) {
      // Sprachwechsel ohne Reload — hot-swap reicht
      await loadI18n();
      applyI18nToModuleManifests();
      renderTabs();
      renderMod();
    }
    openModal({}).close();
  };
}

function openMapboxHelpModal() {
  openModal({
    title: t("mapbox_help.title"),
    body: `
      <p>${t("mapbox_help.intro")}</p>
      <div style="margin-top:12px; padding:10px 14px; background:rgba(255,165,0,0.08); border-left:3px solid #ff9d3a; border-radius:6px; font-size:12.5px; line-height:1.55;">
        ${t("mapbox_help.cc_info")}
      </div>
      <ol style="margin-top:14px; padding-left:18px; line-height:1.7;">
        <li>${t("mapbox_help.step1")}
          &nbsp;<a href="#" data-url="https://account.mapbox.com/auth/signup" class="md-link">account.mapbox.com</a></li>
        <li>${t("mapbox_help.step2")}</li>
        <li>${t("mapbox_help.step3")}</li>
        <li>${t("mapbox_help.step4")}</li>
        <li>${t("mapbox_help.step5")}</li>
      </ol>
      <p class="muted" style="margin-top:14px; font-size:11.5px; line-height:1.55;">
        ${t("mapbox_help.tier_info")}
      </p>
      <p class="muted" style="margin-top:6px; font-size:11.5px;">
        ${t("mapbox_help.security_info")}
      </p>
    `,
    footer: `
      <button class="btn" id="md-mh-open" data-url="https://account.mapbox.com/access-tokens/">${t("mapbox_help.btn.open_dashboard")}</button>
      <button class="btn btn-primary" id="md-mh-ok">${t("common.ok")}</button>
    `,
  });
  // Externe Links über die Bridge öffnen (sonst öffnet pywebview im selben Fenster)
  document.querySelectorAll(".md-link, #md-mh-open").forEach(a => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const url = a.dataset.url;
      if (url) api().open_url(url);
    });
  });
  document.getElementById("md-mh-ok").onclick = () => openModal({}).close();
}

// ── Hilfe-Modal + Über-Modal ───────────────────────────────────────────────

function openHelpModal() {
  openModal({
    title: t("help.title"),
    body: `
      <p class="muted" style="margin:0 0 14px 0; font-size:12.5px; line-height:1.5;">
        ${t("help.intro")}
      </p>
      <div class="help-links">
        <a class="help-link" href="#" id="help-user-guide">
          <span class="help-link-icon">📖</span>
          <span class="help-link-text">
            <strong>${t("help.user_guide.title")}</strong>
            <span class="muted">${t("help.user_guide.body")}</span>
          </span>
        </a>
        <a class="help-link" href="#" id="help-mapbox">
          <span class="help-link-icon">🔑</span>
          <span class="help-link-text">
            <strong>${t("help.mapbox.title")}</strong>
            <span class="muted">${t("help.mapbox.body")}</span>
          </span>
        </a>
        <a class="help-link" href="#" id="help-feedback">
          <span class="help-link-icon">📧</span>
          <span class="help-link-text">
            <strong>${t("help.feedback.title")}</strong>
            <span class="muted">${t("help.feedback.body")}</span>
          </span>
        </a>
        <a class="help-link" href="#" id="help-log">
          <span class="help-link-icon">📋</span>
          <span class="help-link-text">
            <strong>${t("help.log.title")}</strong>
            <span class="muted">${t("help.log.body")}</span>
          </span>
        </a>
        <a class="help-link" href="#" id="help-about">
          <span class="help-link-icon">ℹ</span>
          <span class="help-link-text">
            <strong>${t("help.about.title")}</strong>
            <span class="muted">${t("help.about.body")}</span>
          </span>
        </a>
      </div>
    `,
    footer: `<button class="btn btn-primary" id="md-help-ok">${t("common.ok")}</button>`,
  });
  document.getElementById("help-user-guide").onclick = (e) => { e.preventDefault(); api().open_user_guide(); };
  document.getElementById("help-mapbox").onclick     = (e) => { e.preventDefault(); openMapboxHelpModal(); };
  document.getElementById("help-feedback").onclick   = (e) => {
    e.preventDefault();
    openModal({}).close();
    window.openBugReportModal("Feedback aus Hilfe-Menü");
  };
  document.getElementById("help-log").onclick        = (e) => { e.preventDefault(); api().open_log(); };
  document.getElementById("help-about").onclick      = (e) => { e.preventDefault(); openAboutModal(); };
  document.getElementById("md-help-ok").onclick = () => openModal({}).close();
}

// v0.9.289 — Spenden-/Unterstützen-Links (Marc). HIER deine echten URLs eintragen.
// Leerer String ("") = Button wird ausgeblendet. Solange "DEIN_" drinsteht, gilt
// der Link als Platzhalter und der Button wird (noch) NICHT angezeigt — so kann
// nichts auf eine tote Seite führen, bevor du die echten Links eingetragen hast.
const SUPPORT_LINKS = {
  kofi:   "https://ko-fi.com/A0A6KR1N",      // Marcs Ko-fi (2026-06-15)
  paypal: "https://paypal.me/reisezoom",     // Marcs PayPal.me (2026-06-15)
};
function _supportLinkOk(u) { return !!u && !u.includes("DEIN_"); }

async function openAboutModal() {
  let info = {};
  try { info = await api().get_app_info(); } catch (_) {}
  const escapeHtml = (s) => String(s ?? "").replace(/[&<>]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
  openModal({
    title: t("about.title"),
    body: `
      <div style="text-align:center; padding:8px 0 4px;">
        <img src="assets/icon.png" alt="" onerror="this.style.display='none'"
             style="width:128px; height:128px; border-radius:24px;
                    filter: drop-shadow(0 6px 16px rgba(0,0,0,0.55));
                    margin-bottom:14px;">
        <div style="font-size:22px; font-weight:700; letter-spacing:0.2px;">
          ${escapeHtml(info.name || "Reisezoom GPS Studio")}
        </div>
        <div class="muted" style="font-size:12px; margin-top:4px;">
          ${t("about.version")}&nbsp;${escapeHtml(info.version || "?")}&nbsp;·&nbsp;Python&nbsp;${escapeHtml(info.python || "?")}
        </div>
        <!-- v0.9.280 (Nutzer-Wunsch) — manueller Update-Check -->
        <div style="margin-top:10px;">
          <button id="about-check-update" class="btn"
                  style="padding:6px 14px; border-radius:8px; background:var(--bg-3); color:var(--text); font-size:12px; font-weight:600; border:1px solid var(--border); cursor:pointer;">
            ${t("update.check")}
          </button>
        </div>
        <div class="muted" style="font-size:12.5px; margin:14px auto 0; max-width:380px; line-height:1.55;">
          ${t("about.tagline")}
        </div>
        <div style="font-size:12.5px; font-weight:600; color:var(--text); margin-top:14px;">
          ${t("about.credits")}
        </div>
        <!-- v0.9.273 — Reisezoom-Promo: Blog + YouTube prominent im About-Dialog -->
        <div style="margin-top:16px; display:flex; gap:10px; justify-content:center;">
          <a href="#" class="md-about-link btn" data-url="https://www.youtube.com/@reisezoom"
             style="text-decoration:none; padding:7px 14px; border-radius:8px; background:#ff4d4d; color:#fff; font-size:12.5px; font-weight:600;">▶&nbsp;YouTube</a>
          <a href="#" class="md-about-link btn" data-url="https://reisezoom.com"
             style="text-decoration:none; padding:7px 14px; border-radius:8px; background:var(--bg-3); color:var(--text); font-size:12.5px; font-weight:600; border:1px solid var(--border);">🌐&nbsp;reisezoom.com</a>
        </div>
        <div class="muted" style="font-size:11px; margin-top:8px;">${t("about.promo", "Outdoor, Fotografie &amp; Kameras von Marc – schau vorbei!")}</div>
      </div>

      <!-- v0.9.289 — Unterstützen / Spenden (Marc). Links in SUPPORT_LINKS (oben). -->
      <hr style="border:none; border-top:1px solid var(--border); margin:18px 0 12px;">
      <div style="text-align:center;">
        <div style="font-size:12.5px; font-weight:600; color:var(--text);">${t("about.support.title")}</div>
        <div class="muted" style="font-size:11.5px; margin:6px auto 0; max-width:400px; line-height:1.55;">${t("about.support.body")}</div>
        <div style="margin-top:12px; display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
          ${_supportLinkOk(SUPPORT_LINKS.kofi)
            ? `<a href="#" class="md-about-link btn" data-url="${SUPPORT_LINKS.kofi}" style="text-decoration:none; padding:8px 16px; border-radius:8px; background:#ffdd66; color:#3a2d00; font-size:12.5px; font-weight:700;">☕&nbsp;${t("about.support.kofi")}</a>`
            : `<a href="#" class="md-support-todo btn" style="text-decoration:none; padding:8px 16px; border-radius:8px; background:var(--bg-3); color:var(--text-muted); font-size:12.5px; font-weight:700; border:1px dashed var(--border);">☕&nbsp;${t("about.support.kofi")}</a>`}
          ${_supportLinkOk(SUPPORT_LINKS.paypal)
            ? `<a href="#" class="md-about-link btn" data-url="${SUPPORT_LINKS.paypal}" style="text-decoration:none; padding:8px 16px; border-radius:8px; background:var(--bg-3); color:var(--text); font-size:12.5px; font-weight:700; border:1px solid var(--border);">${t("about.support.paypal")}</a>`
            : `<a href="#" class="md-support-todo btn" style="text-decoration:none; padding:8px 16px; border-radius:8px; background:var(--bg-3); color:var(--text-muted); font-size:12.5px; font-weight:700; border:1px dashed var(--border);">${t("about.support.paypal")}</a>`}
        </div>
      </div>

      <hr style="border:none; border-top:1px solid var(--border); margin:18px 0 12px;">
      <div style="font-size:11px; color:var(--text-muted); line-height:1.7; font-family:ui-monospace,Menlo,monospace; word-break:break-all;">
        <div><strong style="color:var(--text-dim); font-family:inherit;">${t("about.paths.app_support")}:</strong><br>${escapeHtml(info.app_support || "?")}</div>
        <div style="margin-top:6px;"><strong style="color:var(--text-dim); font-family:inherit;">${t("about.paths.tour_maps")}:</strong><br>${escapeHtml(info.tour_maps_dir || "?")}</div>
        <div style="margin-top:6px;"><strong style="color:var(--text-dim); font-family:inherit;">${t("about.paths.renders")}:</strong><br>${escapeHtml(info.renders_dir || "?")}</div>
      </div>

      <!-- v0.9.40 — License-Credits für gebundelte Bibliotheken
           (Nutzer-Hint 2026-05-25). FFmpeg-LGPL verlangt prominente
           Attribution + Source-Link bei Distribution. -->
      <hr style="border:none; border-top:1px solid var(--border); margin:18px 0 12px;">
      <div style="font-size:11.5px; font-weight:600; color:var(--text-dim); margin-bottom:6px;">
        ${t("about.credits.title")}
      </div>
      <div style="font-size:11.5px; color:var(--text-muted); line-height:1.65;">
        ${t("about.credits.intro")}
        <ul style="margin:6px 0 0 18px; padding:0; font-size:11px;">
          <li>
            <a href="#" class="md-about-link" data-url="https://ffmpeg.org/">FFmpeg</a>
            — LGPLv2.1+ / GPLv2+ (libx264/libx265 sind GPL-Komponenten)
          </li>
          <li>
            <a href="#" class="md-about-link" data-url="https://www.mapbox.com/legal/tos">Mapbox GL JS</a>
            — Mapbox Terms of Service
          </li>
          <li>
            <a href="#" class="md-about-link" data-url="https://pywebview.flowrl.com/">pywebview</a> — BSD-3-Clause ·
            <a href="#" class="md-about-link" data-url="https://python-pillow.org/">Pillow</a> — HPND ·
            <a href="#" class="md-about-link" data-url="https://github.com/tkrajina/gpxpy">gpxpy</a> — Apache-2.0
          </li>
          <li>
            <a href="#" class="md-about-link" data-url="https://playwright.dev/">Playwright</a> — Apache-2.0 ·
            <a href="#" class="md-about-link" data-url="https://www.chromium.org/">Chromium</a> — BSD-3-Clause (Render-Engine, gebündelt auf macOS + Windows)
          </li>
          <li>
            <a href="#" class="md-about-link" data-url="https://exiftool.org/">ExifTool</a> — Artistic License (gebündelt auf macOS + Windows)
          </li>
          <li>
            <a href="#" class="md-about-link" data-url="https://github.com/bigcat88/pillow_heif">pillow-heif</a> — BSD-3-Clause ·
            <a href="#" class="md-about-link" data-url="https://github.com/strukturag/libheif">libheif</a> — LGPL v3
          </li>
          <li>
            <a href="#" class="md-about-link" data-url="https://github.com/polyvertex/fitdecode">fitdecode</a> — MIT (FIT-Import: Garmin/Wahoo)
          </li>
        </ul>
      </div>
    `,
    footer: `<button class="btn btn-primary" id="md-about-ok">${t("common.ok")}</button>`,
  });
  document.getElementById("md-about-ok").onclick = () => openModal({}).close();
  // v0.9.40 — Credits-Links via Bridge im externen Browser öffnen
  document.querySelectorAll(".md-about-link").forEach(a => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const url = a.dataset.url;
      try { if (url && api().open_url) api().open_url(url); }
      catch (_) { window.open(url, "_blank"); }
    });
  });
  // v0.9.289 — Platzhalter-Spenden-Buttons: noch kein echter Link hinterlegt →
  // sanfter Hinweis statt toter Seite (Marc trägt Links in SUPPORT_LINKS ein).
  document.querySelectorAll(".md-support-todo").forEach(a => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      try { toast(t("about.support.todo"), "info"); } catch (_) {}
    });
  });
  // Topbar-Version auf Backend-Version syncen
  const topbarV = document.getElementById("topbar-version");
  if (topbarV && info.version) topbarV.textContent = "v" + info.version;
  // v0.9.280 — manueller Update-Check aus dem Über-Dialog
  const upBtn = document.getElementById("about-check-update");
  if (upBtn) upBtn.onclick = async () => {
    const prev = upBtn.textContent;
    upBtn.textContent = t("update.checking");
    upBtn.disabled = true;
    try { await checkForUpdate(true); }
    finally { upBtn.textContent = prev; upBtn.disabled = false; }
  };
}

// ── Init ───────────────────────────────────────────────────────────────────

// Globale Wrapper damit das macOS-Menü „Einstellungen…" sie via
// `window.evaluate_js("window.openSettingsModal()")` aufrufen kann.
window.openSettingsModal = openSettingsModal;
window.openMapboxHelpModal = openMapboxHelpModal;
window.openHelpModal = openHelpModal;
window.openAboutModal = openAboutModal;

/**
 * Beim allerersten Start (oder wenn der Token aus settings.json gelöscht
 * wurde) zeigen wir ein nicht-schließbares Onboarding-Modal mit Anleitung
 * + Input-Field. Erst nach Eingabe eines gültigen `pk.`-Tokens läuft die
 * App normal weiter.
 */
async function openFirstRunMapboxModal() {
  return new Promise(resolve => {
    openModal({
      title: t("first_run.title"),
      body: `
        <p>${t("first_run.intro")}</p>

        <div style="margin-top:14px; padding:12px 14px; background:var(--bg-3); border-radius:8px;">
          <p style="font-weight:600; margin-bottom:6px;">${t("first_run.opt_token_title")}</p>
          <p class="muted" style="font-size:12px;">${t("first_run.opt_token_desc")}</p>
          <div style="margin-top:10px; padding:8px 12px; background:rgba(255,165,0,0.08); border-left:3px solid #ff9d3a; border-radius:5px; font-size:11.5px; line-height:1.5;">
            ${t("mapbox_help.cc_info")}<br>${t("mapbox_help.tier_info")}
          </div>
          <ol style="margin-top:10px; padding-left:18px; line-height:1.55; font-size:12px;">
            <li>${t("mapbox_help.step1")}
              &nbsp;<a href="#" data-url="https://account.mapbox.com/auth/signup" class="md-link">account.mapbox.com</a></li>
            <li>${t("mapbox_help.step3")}</li>
            <li>${t("mapbox_help.step4")}</li>
          </ol>
          <input type="text" id="md-fr-token" style="width:100%; margin-top:8px; font-family:ui-monospace,Menlo,monospace; font-size:11.5px;" placeholder="pk.eyJ1Ijoi...">
          <div id="md-fr-err" style="color:var(--danger); font-size:11px; margin-top:6px; display:none"></div>
        </div>

        <div style="margin-top:10px; padding:12px 14px; border:1px dashed var(--border); border-radius:8px;">
          <p style="font-weight:600; margin-bottom:4px;">${t("first_run.opt_osm_title")}</p>
          <p class="muted" style="font-size:12px;">${t("first_run.opt_osm_desc")}</p>
        </div>

        <p class="muted" style="margin-top:10px; font-size:11px;">${t("first_run.change_later_hint")}</p>
      `,
      footer: `
        <button class="btn btn-left" id="md-fr-skip">${t("first_run.btn.skip")}</button>
        <button class="btn" data-url="https://account.mapbox.com/access-tokens/" id="md-fr-open">${t("mapbox_help.btn.open_dashboard")}</button>
        <button class="btn btn-primary" id="md-fr-save">${t("first_run.btn.save")}</button>
      `,
      closable: false,
    });
    setTimeout(() => document.getElementById("md-fr-token")?.focus(), 100);
    document.getElementById("md-fr-open").onclick = (e) => {
      e.preventDefault();
      api().open_url(e.currentTarget.dataset.url);
    };
    document.querySelectorAll(".md-link").forEach(a => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        api().open_url(a.dataset.url);
      });
    });
    const errEl = document.getElementById("md-fr-err");
    document.getElementById("md-fr-save").onclick = async () => {
      const v = document.getElementById("md-fr-token").value.trim();
      errEl.style.display = "none";
      if (!v.startsWith("pk.") || v.length < 20) {
        errEl.textContent = t("settings.mapbox.invalid_token");
        errEl.style.display = "block";
        return;
      }
      await saveSettings({ mapbox_token: v, onboarding_done: true }, { immediate: true });
      openModal({}).close();
      resolve();
    };
    document.getElementById("md-fr-skip").onclick = async () => {
      // Ohne Token weiterarbeiten → OSM-Modus, kein Premium-Render
      await saveSettings({ mapbox_token: "", onboarding_done: true }, { immediate: true });
      openModal({}).close();
      resolve();
    };
  });
}

// v0.9.280 (Nutzer-Wunsch) — In-App-Update-Check (Stufe 1: nur Hinweis-Banner,
// kein Selbst-Update). Fragt das Backend (throttelt GitHub auf alle 12 h) und
// zeigt bei neuerer Version ein dismissbares Banner unter der Topbar. `force`
// (manueller „Suchen"-Button im Über-Dialog) umgeht Throttle + zeigt Toast.
async function checkForUpdate(force = false) {
  const banner = document.getElementById("update-banner");
  let res;
  try { res = await api().check_for_update(!!force); }
  catch (_) { if (force) toast(t("update.error"), "warn"); return; }
  if (!res || !res.ok) { if (force) toast(t("update.error"), "warn"); return; }

  if (res.available && (force || !res.dismissed)) {
    if (banner) {
      const txt = document.getElementById("update-banner-text");
      if (txt) txt.innerHTML = t("update.banner", { v: res.latest });
      const dl = document.getElementById("update-banner-dl");
      if (dl) {
        dl.textContent = t("update.download");
        dl.onclick = () => { try { api().open_url(res.download_url || res.page_url); } catch (_) {} };
      }
      const x = document.getElementById("update-banner-close");
      if (x) x.onclick = () => {
        banner.hidden = true;
        try { api().update_dismiss(res.latest); } catch (_) {}
      };
      banner.hidden = false;
    }
  } else {
    if (banner) banner.hidden = true;
    if (force) toast(t("update.uptodate", { v: res.current }), "success");
  }
}
window.checkForUpdate = checkForUpdate;

// v0.9.317 — „Als <Format> exportieren" (Menü). Exportiert den aktuell geladenen
// Track (auch aus FIT/NMEA/KML/… importiert) in jedes Zielformat:
// GPX · KML · KMZ · TCX · GeoJSON · CSV. Nutzt core.trackio (geteilt mit dem Web).
async function exportCurrent(fmt) {
  fmt = (fmt || "gpx").toLowerCase();
  let res;
  try { res = await api().export_current(fmt); }
  catch (_) { toast(t("export.error", "Export fehlgeschlagen."), "warn"); return; }
  if (!res) return;
  if (res.cancelled) return;
  if (res.ok) toast(t("export.done", "Exportiert") + " (" + (res.fmt || fmt).toUpperCase() + ")", "success");
  else toast(res.error === "Kein Track geladen."
        ? t("export.no_track", "Kein Track geladen.")
        : (res.error || t("export.error", "Export fehlgeschlagen.")), "warn");
}
window.exportCurrent = exportCurrent;
// Rückwärtskompatible Wrapper (alte Menü-Trigger / evtl. Aufrufer)
window.exportCurrentGpx = () => exportCurrent("gpx");
window.exportCurrentCsv = () => exportCurrent("csv");

window.addEventListener("DOMContentLoaded", async () => {
  await whenApiReady();
  await loadSettings();
  await loadI18n();
  applyI18nToModuleManifests();

  document.getElementById("topbar-settings").addEventListener("click", openSettingsModal);
  // v0.9.288 — Topbar aufgeräumt (Marc): Hilfe/Feedback/YouTube/Blog sind aus der
  // Topbar raus und leben jetzt im macOS-Menü („Datei"/„Hilfe", siehe app.py).
  // openHelpModal/openBugReportModal bleiben als Funktionen erhalten (Menü ruft
  // openBugReportModal direkt; einzelne Help-Items hängen direkt am Menü).

  // Topbar-Version aus Backend syncen (sonst hardcoded v0.2 im HTML)
  try {
    const info = await api().get_app_info();
    const tv = document.getElementById("topbar-version");
    if (tv && info && info.version) tv.textContent = "v" + info.version;
  } catch (_) {}

  // v0.9.280 — Update-Check im Hintergrund (blockiert den Start nicht).
  setTimeout(() => { checkForUpdate(false); }, 1500);

  // First-Run: nur wenn die Settings-Datei noch nie eine Mapbox-Entscheidung
  // gespeichert haben → blockierendes Modal mit zwei Optionen:
  //   1) Mapbox-Token eintragen (volle Features)
  //   2) Ohne Token starten — dann OSM als Fallback (kein Satellite, kein 3D)
  const onboardingDone = !!(_settingsCache && _settingsCache.onboarding_done);
  if (!onboardingDone) {
    await openFirstRunMapboxModal();
  }
  // Aktiven Map-Token für die Factory laden (auch wenn kein Token → OSM-Mode)
  await initMapToken();

  const wanted = (_settingsCache && _settingsCache.active_module);
  const available = getModules().map(m => m.manifest.slug);
  activeMod = available.includes(wanted) ? wanted : (available[0] || null);
  renderTabs();
  renderMod();

  // v0.9.27 (Nutzer-Feedback): letztes GPX automatisch wieder laden,
  // damit ein App-Restart nicht den Track verliert. Async, blockiert
  // den Module-Mount nicht.
  // v0.9.28: wenn die Datei weg ist (umbenannt, gelöscht, externe Platte ab),
  // wird auch der Geotagger-State mit zurückgesetzt — App startet sauber leer.
  setTimeout(async () => {
    try {
      const lastPath = _settingsCache && _settingsCache.last_gpx_path;
      if (!lastPath || typeof loadGlobalGpx !== "function") return;
      const exists = await api().path_exists(lastPath);
      if (!exists || !exists.ok || !exists.exists) {
        try {
          if (typeof saveSettings === "function") {
            saveSettings({
              last_gpx_path: "",
              geotagger: { last_photos_dir: "", last_photos_paths: [] }
            });
          }
        } catch (_) {}
        return;
      }
      await loadGlobalGpx(lastPath);
    } catch (err) {
      console.warn("auto-restore GPX failed:", err);
    }
  }, 250);
});
