/* Reisezoom GPS Studio — GPX-Picker im Modul-Header (v0.8.2)
 *
 * Globale GPX-Quelle für alle Module. Wird ins Module-Header-DOM
 * eingesetzt (statt dass jedes Modul seinen eigenen Picker in der
 * Sidebar hat). Modul-Überschriften sind raus — der aktive Modul-Tab
 * oben in der Topbar zeigt eh wo man ist.
 *
 * API (window):
 *   loadGlobalGpx(path)      — lädt + verteilt an alle Module
 *   clearGlobalGpx()          — schließt Track + leert Session
 *   getGlobalGpxPath()        — aktueller Pfad oder ""
 *   getGlobalGpxData()        — letzter Parse-Result (coords, stats, …)
 *   onGpxLoaded(cb)           — Listener für Module
 *   renderGpxBarInto(elem)    — fügt HTML + Event-Bindings in einen
 *                               Container ein (von app.js nach jedem
 *                               Modul-Mount gerufen)
 */

(function() {
  "use strict";

  // v0.9.282 — Universelle Track-Import-Schicht: nicht nur GPX, sondern auch
  // FIT/NMEA/KML/KMZ/TCX/GeoJSON öffnen — das Backend konvertiert beim Laden
  // transparent nach GPX. Filter (Picker) + Erkennungs-Regex (Drag&Drop).
  // Global auf window, damit Module (Geotagger) denselben Filter nutzen.
  // WICHTIG (Nutzer-Bug v0.9.285): pywebviews Windows-Backend validiert die
  // Filter-Beschreibung mit Regex `[\w ]+` — KEINE Sonderzeichen (Bindestrich!).
  // „Track-Dateien" crashte → daher „Track Dateien" (nur Buchstaben + Leerzeichen).
  // v0.9.508 — die Beschreibung ist Sprache, die Endungen sind es nicht.
  // ⚠️ pywebviews Windows-Backend validiert die Beschreibung mit `[\w ]+`:
  // KEINE Sonderzeichen, auch keine Bindestriche (Nutzer-Bug v0.9.285). Die
  // Übersetzungen müssen sich daran halten.
  // ⚠️ Als GETTER, nicht als fertiges Array: diese Datei lädt, bevor die
  // Sprachdatei über die Brücke da ist — ein einmal gebautes Array trüge für
  // immer den deutschen Fallback. So wird erst beim Öffnen des Dialogs
  // übersetzt. (Beim Test aufgefallen: Oberfläche spanisch, Dateidialog
  // „Track Dateien".) Die vier Aufrufstellen lesen weiterhin nur den Namen.
  Object.defineProperty(window, "TRACK_PICK_FILTER", {
    configurable: true,
    get() {
      return [
        t("filter.track_files", "Track Dateien") + " (*.gpx;*.fit;*.nmea;*.log;*.kml;*.kmz;*.tcx;*.geojson;*.json)",
        "GPX (*.gpx)",
      ];
    },
  });
  // Drag&Drop: generische .json/.txt bewusst NICHT mitnehmen (zu mehrdeutig).
  window.TRACK_DROP_RE = /\.(gpx|fit|nmea|log|kml|kmz|tcx|geojson)$/i;

  // ── Globaler State ────────────────────────────────────────────────────
  let _gpxPath = "";
  let _gpxData = null;
  const _gpxListeners = new Set();

  window.getGlobalGpxPath = () => _gpxPath;
  window.getGlobalGpxData = () => _gpxData;
  window.onGpxLoaded = (cb) => { _gpxListeners.add(cb); return () => _gpxListeners.delete(cb); };

  function notifyGpxLoaded() {
    for (const cb of _gpxListeners) {
      try { cb({ path: _gpxPath, data: _gpxData }); }
      catch (err) { console.warn("gpx listener threw:", err); }
    }
  }

  // ── Ladeflagge (13.09.2026) ───────────────────────────────────────────
  // Marc: „Track wird geladen, und dann müssen wir schon ein Flag setzen. Dann
  // müssen wir, wenn er fertig geladen ist, noch mal ein Flag setzen, und wenn das
  // fertig-geladen-Flag fehlt, dann haben wir ein Problem."
  // „Fertig" heißt: Track, Schilder und Fotos sind geladen UND die Oberfläche hat
  // danach noch zwei Sekunden lang gelebt. Ein eingefrorenes Skript kommt hier nie
  // an — dann bleibt „lädt" stehen, und der nächste Start fragt nach.
  const _LADE_IDS = ["track-laden", "anim-schilder-laden", "anim-fotos", "anim-fotos-laden", "anim-fotos-gtg"];
  let _ladeflaggeLauf = 0;
  function _ladeflaggeSetzen(info) {
    try { const a = api(); if (a && a.ladeflagge_setzen) a.ladeflagge_setzen(info); } catch (_) {}
  }
  function _ladeflaggeFertigWennRuhig() {
    const lauf = ++_ladeflaggeLauf;
    let ruhig = 0;
    const t0 = Date.now();
    const pruefen = () => {
      if (lauf !== _ladeflaggeLauf) return;   // ein neuer Ladevorgang hat übernommen
      const beschaeftigt = window.rzStatus && _LADE_IDS.some(id => window.rzStatus.laeuft(id));
      ruhig = (beschaeftigt || Date.now() - t0 < 3000) ? 0 : ruhig + 1;
      if (ruhig >= 2) {
        try { const a = api(); if (a && a.ladeflagge_fertig) a.ladeflagge_fertig(); } catch (_) {}
        return;
      }
      setTimeout(pruefen, 1000);
    };
    setTimeout(pruefen, 1000);
  }

  /** Beim Start: Ist der letzte Ladevorgang nicht fertig geworden, fragen, ob das
   *  Projekt diesmal ohne Schilder und Fotos geöffnet werden soll. */
  window.rzLadeflaggePruefen = async function() {
    let r = null;
    try { r = await api().ladeflagge_vom_letzten_start(); } catch (_) { return; }
    if (!r || !r.problem) return;
    const esc = (x) => String(x ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const name = r.projekt || String(r.gpx || "").split("/").pop();
    const teile = [];
    if (r.schilder) teile.push(t("ladeflagge.n_schilder", "{n} Schilder").replace("{n}", r.schilder.toLocaleString()));
    if (r.fotos) teile.push(t("ladeflagge.n_fotos", "{n} Fotos").replace("{n}", r.fotos.toLocaleString()));
    const inhalt = teile.length ? teile.join(" · ") : "";
    const body = `
      <p>${t("ladeflagge.text", "Beim letzten Mal ist <b>{name}</b> nicht fertig geladen worden. Die App hing oder wurde beendet, bevor alles da war.").replace("{name}", esc(name))}</p>
      ${inhalt ? `<p>${t("ladeflagge.inhalt", "Im Projekt stecken: {inhalt}.").replace("{inhalt}", esc(inhalt))}</p>` : ""}
      <p>${t("ladeflagge.vorschlag", "Du kannst es diesmal <b>ohne Schilder und Fotos</b> öffnen. Es wird nichts gelöscht — sie bleiben im Projekt und lassen sich danach mit einem Klick dazuholen.")}</p>`;
    const kannSicher = r.gpx_da;
    const footer = `
      <button type="button" class="btn" data-lf="spaeter">${t("ladeflagge.nicht_oeffnen", "Nicht öffnen")}</button>
      <button type="button" class="btn" data-lf="normal" ${kannSicher ? "" : "disabled"}>${t("ladeflagge.normal", "Normal öffnen")}</button>
      <button type="button" class="btn btn-primary" data-lf="sicher" ${kannSicher ? "" : "disabled"}>${t("ladeflagge.sicher", "Ohne Schilder und Fotos öffnen")}</button>`;
    const m = openModal({ title: t("ladeflagge.titel", "Das Projekt hat beim letzten Mal nicht fertig geladen"), body, footer });
    if (window.applog) window.applog("warn", `[ladeflagge] Nachfrage beim Start: ${name} · ${inhalt}`);
    const foot = document.getElementById("modal-footer");
    const wahl = (w) => {
      try { m.close(); } catch (_) {}
      if (window.applog) window.applog("info", `[ladeflagge] Wahl: ${w}`);
      if (w === "spaeter" || !r.gpx) return;
      if (w === "sicher") window.__rzSicherTour = { gpx: r.gpx, tour_hash: r.tour_hash || "" };
      if (typeof switchMod === "function") switchMod("animator");
      setTimeout(() => window.loadGlobalGpx(r.gpx, { stumm: true }), 50);
    };
    foot && foot.querySelectorAll("[data-lf]").forEach(b => { b.onclick = () => wahl(b.dataset.lf); });
  };

  /** Banner im sicheren Modus: sagt, was ausgeblendet ist, und holt es auf Wunsch. */
  window.rzSicherBanner = function(verdeckt) {
    let bar = document.getElementById("sicher-banner");
    if (!verdeckt) { if (bar) bar.hidden = true; return; }
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "sicher-banner";
      bar.className = "source-missing-banner sicher-banner";
      bar.innerHTML = `<span class="source-missing-banner-icon">🛟</span>
        <span class="source-missing-banner-text"></span>
        <button type="button" class="source-missing-banner-pick" data-sb="laden"></button>`;
      const anker = document.getElementById("source-missing-banner");
      if (anker && anker.parentNode) anker.parentNode.insertBefore(bar, anker.nextSibling);
      else document.body.prepend(bar);
    }
    const teile = [];
    if (verdeckt.schilder) teile.push(t("ladeflagge.n_schilder", "{n} Schilder").replace("{n}", verdeckt.schilder.toLocaleString()));
    if (verdeckt.fotos) teile.push(t("ladeflagge.n_fotos", "{n} Fotos").replace("{n}", verdeckt.fotos.toLocaleString()));
    bar.querySelector(".source-missing-banner-text").textContent =
      t("ladeflagge.banner", "Sicher geöffnet: {inhalt} dieses Projekts sind ausgeblendet, nicht gelöscht. Änderungen daran sind gesperrt, bis du sie dazuholst.")
        .replace("{inhalt}", teile.join(" und ") || "—");
    const knopf = bar.querySelector("[data-sb=laden]");
    knopf.textContent = t("ladeflagge.dazuholen", "Schilder und Fotos dazuholen");
    knopf.onclick = () => {
      const gpx = window.__rzSicherTour && window.__rzSicherTour.gpx;
      window.__rzSicherTour = null;
      window.__rzSicherVerdeckt = null;
      bar.hidden = true;
      if (window.applog) window.applog("info", "[ladeflagge] Schilder und Fotos werden dazugeholt");
      if (gpx) window.loadGlobalGpx(gpx, { stumm: true });
    };
    bar.hidden = false;
  };

  // ── Quelldatei-fehlt-Banner (v0.9.305) ────────────────────────────────
  // Wenn die zuletzt geladene GPX-Datei nicht mehr lesbar ist (externe Platte
  // ab, Datei verschoben/gelöscht), zeigen wir EIN klares Banner statt jedes
  // Modul still in einen kaputt aussehenden Leer-Zustand laufen zu lassen.
  // Module rufen window.showSourceMissingBanner(path) in ihrem Load-Fehlerpfad.
  const _MISSING_FILE_RE = /no such file|errno\s*2|enoent|nicht gefunden|cannot find|file not found/i;
  window.isMissingFileError = (err) => _MISSING_FILE_RE.test(String(err || ""));
  let _smBannerBound = false;
  function _bindSourceMissingBanner() {
    if (_smBannerBound) return;
    const pick = document.getElementById("source-missing-banner-pick");
    const close = document.getElementById("source-missing-banner-close");
    if (!pick || !close) return;
    _smBannerBound = true;
    pick.onclick = () => { window.hideSourceMissingBanner(); if (typeof window.pickGpx === "function") window.pickGpx(); };
    close.onclick = () => window.hideSourceMissingBanner();
  }
  window.showSourceMissingBanner = function(path) {
    const bar = document.getElementById("source-missing-banner");
    const txt = document.getElementById("source-missing-banner-text");
    if (!bar || !txt) return;
    _bindSourceMissingBanner();
    const name = String(path || "").split("/").pop() || path || "";
    const tpl = (typeof t === "function")
      ? t("app.source_missing", "Quelldatei nicht gefunden: <b>{name}</b> — Laufwerk gemountet?")
      : "Quelldatei nicht gefunden: <b>{name}</b> — Laufwerk gemountet?";
    txt.innerHTML = tpl.replace("{name}", escapeHtml(name));
    bar.hidden = false;
  };
  window.hideSourceMissingBanner = function() {
    const bar = document.getElementById("source-missing-banner");
    if (bar) bar.hidden = true;
  };

  /** Lädt ein GPX einmal global. Master-Parse via animator_load_gpx
   *  (liefert die breiteste Stats-Sicht inkl. elevations). Aktiviert die
   *  Session, benachrichtigt alle Module. */
  window.loadGlobalGpx = async function(path, opts) {
    if (!path) return false;
    const stumm = !!(opts && opts.stumm);
    const ladeId = "track-laden";
    try {
      if (window.applog) window.applog("info", `[loadGlobalGpx] start path=${path}`);
      // 12.09.2026 (Marc: „überall wo etwas geladen wird brauchen wir visuelles
      // Feedback"): Das Lesen einer großen Datei dauert; ohne Anzeige wirkt die
      // App tot. Der Kasten unten rechts sagt, was gerade passiert.
      if (window.rzStatus) {
        window.rzStatus.start(ladeId, {
          titel: t("track.laden_titel", "Track wird geladen"),
          text: (path || "").split("/").pop(),
        });
      }
      // 13.09.2026 — Ladeflagge (Marc): „lädt" steht auf der Platte, BEVOR die Arbeit
      // beginnt; „fertig" erst, wenn alles steht und die Oberfläche noch lebt.
      _ladeflaggeSetzen({ gpx: path });
      const res = await api().animator_load_gpx(path);   // warte-ok: eigenes Fenster track-laden
      if (!res || !res.ok) {
        if (window.rzStatus) window.rzStatus.fehler(ladeId, res?.error || t("error.gpx_generic", "GPX-Fehler"));
        if (window.applog) window.applog("error", `[loadGlobalGpx] parse fail: ${res?.error}`);
        if (window.isMissingFileError(res?.error)) window.showSourceMissingBanner(path);
        else toast(res?.error || t("error.gpx_generic", "GPX-Fehler"), "error");
        return false;
      }
      window.hideSourceMissingBanner();
      // Die Quelldatei war weg, die Bibliothek hatte ihre eigene Kopie — sagen,
      // statt still etwas anderes zu laden (Beta-Tester, 12.09.2026).
      if (res.ersatz) {
        const nm = res.ersatz.name || (res.ersatz.fehlt || "").split("/").pop();
        if (window.applog) window.applog("warn", `[loadGlobalGpx] Quelldatei fehlt (${res.ersatz.fehlt}) → Bibliothekskopie`);
        toast(t("track.aus_bibliothek", "Die Datei „{d}“ gibt es nicht mehr — die Tour kommt aus deiner Bibliothek.")
          .replace("{d}", (res.ersatz.fehlt || "").split("/").pop()), "info", 7000);
        path = res.ersatz.pfad || path;
        if (nm && window.applog) window.applog("info", `[loadGlobalGpx] Ersatz-Tour: ${nm}`);
      }
      // 11.09.2026 (Beta-Tester „nichts geht mehr" im Animator, Verdacht: riesiger Track):
      // die Vorschau sieht nur 800 Punkte — die echte Größe stand nirgends im Log.
      if (window.applog) {
        const st = res.stats || {}, stg = (res.series && res.series.stage) || {};
        window.applog("info", `[loadGlobalGpx] parsed n_coords=${res.coords?.length} · Track: ${st.n_points ?? "?"} Punkte · ${st.distance_km != null ? st.distance_km.toFixed(1) : "?"} km · ${st.duration_s != null ? Math.round(st.duration_s / 3600) : "?"} h · ${stg.gesamt ?? "?"} Etappen · Zeit ${st.start_epoch ? new Date(st.start_epoch * 1000).toISOString().slice(0, 10) : "-"}…${st.end_epoch ? new Date(st.end_epoch * 1000).toISOString().slice(0, 10) : "-"}`);
      }
      _gpxPath = path;
      _gpxData = res;
      // 28.08.2026 (Marc: „der lädt immer noch zu viele touren / geht mehrmals
      // durch"): Bei einer MENGEN-Übergabe die Einzel-Sitzung des Haupt-Tracks
      // NICHT aktivieren — der Pending-Handler im Animator aktiviert gleich
      // die Mengen-Sitzung. Die Einzel-Aktivierung stieß vorher einen
      // Session-Restore an, der die alten Reise-Anhänge des Haupt-Tracks
      // mitten in die Übergabe lud (Race → fremde Etappen, doppeltes Zählen).
      if (typeof sessionActivate === "function" && !(opts && opts.menge)) {
        try { await sessionActivate(res.coords, path); }
        catch (err) {
          // 25.08.2026 — war nur console.warn: Schlug die Zuordnung zur Sitzung
          // fehl, stand im Log nichts, und die Projekte eines frisch
          // importierten Umschlags blieben unsichtbar.
          console.warn("sessionActivate (gpx-bar):", err);
          if (window.applog) window.applog("error", `[loadGlobalGpx] sessionActivate: ${err}`);
        }
      }
      // 13.09.2026 — Ladeflagge um Projekt, Tour und Umfang ergänzen (für die Nachfrage beim Start)
      try {
        const pj = (typeof _activeProject !== "undefined" && _activeProject) || {};
        const verdeckt = window.__rzSicherVerdeckt || null;
        _ladeflaggeSetzen({ gpx: path, projekt: pj.name || "",
          tour_hash: (typeof _activeSession !== "undefined" && _activeSession && _activeSession.track_hash) || "",
          schilder: verdeckt ? verdeckt.schilder : (pj.signs || []).length + (pj.tourmap_signs || []).length,
          fotos: verdeckt ? verdeckt.fotos : (pj.photos || []).length });
      } catch (e) { if (window.applog) window.applog("warn", `[ladeflagge] Projektangaben: ${e}`); }
      // v0.9.27 (Nutzer-Feedback): letzten GPX-Pfad persistieren damit
      // er beim App-Restart automatisch wiederhergestellt werden kann.
      // IDEAS §38: Gehört der Load zu einer TOURENMENGE (Reise/Schwarm), bleibt
      // `last_menge` stehen — sonst löscht ein normaler Einzel-Load sie, damit
      // der nächste App-Start nicht fälschlich die Menge wiederherstellt.
      try {
        if (typeof saveSettings === "function") {
          const patch = { last_gpx_path: path };
          if (!(opts && opts.menge)) patch.last_menge = null;
          saveSettings(patch);
        }
      } catch (_) {}
      if (window.rzStatus) {
        const st2 = res.stats || {};
        window.rzStatus.fertig(ladeId, t("track.laden_fertig", "{n} Punkte gelesen")
          .replace("{n}", (st2.n_points || (res.coords || []).length || 0).toLocaleString()));
      }
      _renderCurrent();
      notifyGpxLoaded();
      _ladeflaggeFertigWennRuhig();
      // 10.09.2026 — Track-Check-Hinweis (docs/TRACK-CHECK.md): einmal je Tour und
      // Sitzung, auch bei stummen Ladewegen (Archiv, Sitzung, App-Start).
      if (!(opts && opts.menge)) { try { window.rzTrackCheckHinweis && window.rzTrackCheckHinweis(path); } catch (_) {} }
      // Kennt das Archiv diese Tour? (27.08.2026, Marc) — nicht bei Ladevorgängen,
      // die aus dem Archiv selbst, aus der Cloud oder vom App-Start kommen.
      if (!stumm) { try { await window.archivFrage(path); } catch (_) {} }
      return true;
    } catch (err) {
      if (window.rzStatus) window.rzStatus.fehler(ladeId, String(err));
      console.warn("loadGlobalGpx error:", err);
      if (window.isMissingFileError(err)) window.showSourceMissingBanner(path);
      else toast(t("error.gpx_load", "GPX konnte nicht geladen werden") + ": " + err, "error");
      return false;
    }
  };

  window.clearGlobalGpx = function() {
    // 13.09.2026 (Echt-App-Test, Datenverlust): ZUERST das Projekt lösen. Das Leeren der
    // Schilder unten speichert sonst eine leere Liste in das noch aktive Projekt — so
    // verlor ein echtes Projekt beim „Workspace leeren" und beim „Projekt schließen"
    // seine Schilder. Offene Änderungen schreibt _resetActiveSession vorher weg.
    try { if (typeof _resetActiveSession === "function") _resetActiveSession(); }
    catch (e) { if (window.applog) window.applog("warn", `[gpx-bar] Projekt lösen: ${e}`); }
    // v0.9.185 — beim Leeren ALLES explizit Stück für Stück abräumen (auf der
    // lebenden Karte), statt hinterher zu pollen ob noch was da ist:
    // 1) Schilder (Layer + Bilder + Daten + Editor) via lebenden Animator-Handle.
    //    window.__rzAnimSigns zeigt immer auf den aktiven Mount → closure-sicher.
    try { if (window.__rzAnimSigns && window.__rzAnimSigns.clearAll) window.__rzAnimSigns.clearAll(); } catch (_) {}
    // 2) GPX-Track-State
    _gpxPath = "";
    _gpxData = null;
    _renderCurrent();
    notifyGpxLoaded();
    // 3) persistierten Zustand leeren, damit der App-Neustart wirklich LEER
    //    hochkommt (sonst lädt app.js das zuletzt geladene GPX automatisch wieder).
    try { if (typeof saveSettings === "function") saveSettings({ last_gpx_path: "" }); } catch (_) {}
    if (typeof _resetActiveSession === "function") _resetActiveSession();
  };

  // ── v0.9.155: Globaler Workspace-Clear ────────────────────────────────
  // Marc-Wunsch: statt drei modul-eigener „Workspace leeren"-Buttons ein
  // einziges rotes ✕ neben dem GPX im Modul-Header. Ein Klick räumt ALLE
  // Module gleichzeitig (GPX-Track, Fotos, Match-Daten, Backend-State) und
  // leert auch den GPX-Namen oben.
  //
  // Jedes Modul registriert beim IIFE-Init seine eigene Reset-Funktion via
  // registerWorkspaceResetter(fn). Die Closures der Module bleiben über
  // Modul-Wechsel hinweg bestehen (IIFE wird nur 1× geladen, nur das DOM
  // wird ausgetauscht) — deshalb greifen die Resetter auch für gerade nicht
  // gemountete Module (DOM-Zugriffe sind dort guarded/no-op).
  window.__workspaceResetters = window.__workspaceResetters || new Map();
  window.registerWorkspaceResetter = function(fn, key) {
    // v0.9.389 — per Modul-Key deduplizieren (Map statt Set): bei Re-Mount ersetzt der
    // neue Resetter den alten, statt dass die Sammlung pro Tab-Wechsel wächst. Sonst lief
    // „Workspace leeren" N stale Resetter = N× Backend-Clear + N× saveSettings.
    if (typeof fn === "function") window.__workspaceResetters.set(key || fn, fn);
  };

  /** Zeigt EIN Bestätigungs-Modal, räumt dann alle Module + GPX-Bar. */
  window.clearWorkspaceGlobal = function() {
    // confirmClearWorkspace(null, …) → „alle Module"-Text (confirm_all)
    if (typeof confirmClearWorkspace !== "function") {
      // Fallback ohne Modal — sollte nie passieren
      _runAllResetters();
      window.clearGlobalGpx();
      return;
    }
    confirmClearWorkspace(null, async () => {
      // 13.09.2026 (Echt-App-Test, Datenverlust): Erst das Projekt schließen, DANN die
      // Module leeren. Vorher war das Projekt beim Leeren noch aktiv, und die Module
      // speicherten ihren leeren Zustand hinein — ein echtes Projekt verlor so alle
      // 28 Schilder. Ohne aktives Projekt schreibt kein Leeren mehr etwas zurück.
      try { if (typeof _resetActiveSession === "function") _resetActiveSession(); }
      catch (e) { if (window.applog) window.applog("warn", `[workspace] Projekt schließen: ${e}`); }
      await _runAllResetters();
      window.clearGlobalGpx();   // GPX-Name oben + Session leeren
    });
  };

  async function _runAllResetters() {
    for (const fn of window.__workspaceResetters.values()) {
      try { await fn(); }
      catch (err) { console.warn("workspace resetter threw:", err); }
    }
  }

  // ── HTML-Templates ────────────────────────────────────────────────────
  function templateEmpty() {
    return `
      <div class="gpxbar-empty">
        <button class="gpxbar-pick-btn" type="button" data-gpxbar="pick-empty">
          <span class="gpxbar-icon">📂</span>
          <span>${(typeof t === "function" ? t("gpxbar.pick", "Track wählen …") : "Track wählen …")}</span>
        </button>
        <button class="gpxbar-pick-btn" type="button" data-gpxbar="library"
                title="${escapeAttr((typeof t === "function" ? t("library.open", "Archiv öffnen") : "Archiv öffnen"))}">
          <span class="gpxbar-icon">📚</span>
          <span>${(typeof t === "function" ? t("library.from_archive", "Aus dem Archiv …") : "Aus dem Archiv …")}</span>
        </button>
        <span class="gpxbar-hint">${(typeof t === "function"
          ? t("gpxbar.drop_hint", "… oder Track (GPX/FIT/KML…) hierher ziehen.")
          : "… oder Track (GPX/FIT/KML…) hierher ziehen.")}</span>
      </div>
    `;
  }
  // 02.09.2026 (Beta-Tester: „¿por qué si tengo abiertas 4 rutas, solo indica
  // 1?"): Die Kopfzeile zeigt die Zahlen der HAUPT-Tour. Bei einem Schwarm
  // sieht das aus, als wären die anderen Touren verschwunden — im Video
  // stehen dann aber die Summen aller Touren im Overlay. Deshalb sagt die
  // Kopfzeile jetzt, wie viele noch dazugehören.
  let _extraN = 0;
  window.rzGpxBarExtras = function (n) {
    const neu = Math.max(0, parseInt(n, 10) || 0);
    if (neu === _extraN) return;
    _extraN = neu;
    try { _renderCurrent(); } catch (_) {}
  };

  // 25.09.2026 (Klicktest IN-10/IN-12) — Der Inspektor hängte Tag 2 und 3 an, die
  // Kopfzeile blieb bei Tag 1 (377,9 km / 22:43). Sie zeigt die Datei; solange der
  // Inspektor einen ungespeicherten Stand hat, meldet er dessen Zahlen hier an und
  // die Kopfzeile sagt „ungespeichert" dazu. `null` nimmt die Vorschau wieder weg.
  let _vorschau = null;   // { pfad, stats }
  window.rzGpxBarVorschau = function (v) {
    const neu = (v && v.stats) ? { pfad: v.pfad || "", stats: v.stats } : null;
    if (JSON.stringify(neu) === JSON.stringify(_vorschau)) return;
    _vorschau = neu;
    try { _renderCurrent(); } catch (_) {}
  };

  function templateLoaded(name, fullPath, stats) {
    const vorschau = !!(_vorschau && _vorschau.pfad === fullPath);
    if (vorschau) stats = _vorschau.stats;
    const dist = stats?.distance_km != null ? fmtKm(stats.distance_km * 1000) : "—";
    const time = stats?.duration_s != null ? fmtDur(stats.duration_s) : "—";
    const asc  = stats?.ascent_m   != null ? "↑ " + fmtMeter(stats.ascent_m)  : "—";
    const desc = stats?.descent_m  != null ? "↓ " + fmtMeter(stats.descent_m) : "—";
    return `
      <div class="gpxbar-loaded">
        <button class="gpxbar-pick-btn gpxbar-pick-btn-compact" type="button"
                data-gpxbar="pick" title="${escapeAttr((typeof t === "function"
                  ? t("gpxbar.pick_other", "Anderen Track wählen") : "Anderen Track wählen"))}">
          <span class="gpxbar-icon">📂</span>
        </button>
        <button class="gpxbar-pick-btn gpxbar-pick-btn-compact" type="button"
                data-gpxbar="library"
                title="${escapeAttr((typeof t === "function" ? t("library.open", "Archiv öffnen") : "Archiv öffnen"))}">
          <span class="gpxbar-icon">📚</span>
        </button>
        <span class="gpxbar-filename" title="${escapeAttr(fullPath)}">${escapeHtml(name)}</span>
        <span class="gpxbar-sep">·</span>
        <span class="gpxbar-stat">${escapeHtml(dist)}</span>
        <span class="gpxbar-stat">${escapeHtml(time)}</span>
        <span class="gpxbar-stat">${escapeHtml(asc)}</span>
        <span class="gpxbar-stat">${escapeHtml(desc)}</span>
        ${vorschau ? `<span class="gpxbar-stat gpxbar-ungespeichert" title="${escapeAttr(
          (typeof t === "function"
            ? t("gpxbar.vorschau_tip", "Zahlen des Inspektors mit den noch nicht gespeicherten Änderungen. Die Datei selbst ist unverändert.")
            : ""))}">· ${(typeof t === "function" ? t("gpxinspect.unsaved", "ungespeichert") : "ungespeichert")}</span>` : ""}
        ${_extraN > 0 ? `<span class="gpxbar-stat gpxbar-extra" title="${escapeAttr(
          (typeof t === "function"
            ? t("gpxbar.extra_tip", "Die Zahlen links gehören zur Haupt-Tour. Im Video stehen in den Overlays die Summen aller Touren.")
            : ""))}">+${_extraN} ${(typeof t === "function"
              ? t("gpxbar.extra_n", "weitere Touren") : "weitere Touren")}</span>` : ""}
        <button class="gpxbar-close-btn gpxbar-clearws-btn" type="button" data-gpxbar="clearws"
                title="${escapeAttr((typeof t === "function" ? t("common.clear_workspace") : "Workspace leeren"))}">✕</button>
      </div>
    `;
  }

  // ── Mount/Render ──────────────────────────────────────────────────────
  let _container = null;

  /** Wird von app.js nach jedem Modul-Mount gerufen. Container ist der
   *  linke Bereich im module-header. Räumt vorherigen Inhalt + Listener
   *  weg und baut frisch auf. */
  window.renderGpxBarInto = function(container) {
    _container = container;
    _renderCurrent();
    _bindEvents();
    _setupDragDrop();
  };

  function _renderCurrent() {
    if (!_container) return;
    if (_gpxPath && _gpxData) {
      const name = _gpxData.name || _gpxPath.split("/").pop();
      _container.innerHTML = templateLoaded(name, _gpxPath, _gpxData.stats);
    } else {
      _container.innerHTML = templateEmpty();
    }
    _bindEvents();
  }

  function _bindEvents() {
    if (!_container) return;
    _container.querySelectorAll("[data-gpxbar]").forEach(el => {
      const action = el.dataset.gpxbar;
      el.onclick = (e) => {
        e.preventDefault();
        if (action === "pick-empty" || action === "pick") pickGpx();
        // v0.9.486 — das Archiv ist die komfortablere Track-Auswahl: statt eines
        // Datei-Dialogs der Katalog mit Vorschau, Suche und Filtern.
        else if (action === "library") {
          // 13.09.2026 (Echt-App-Test): „Aus dem Archiv …" soll dorthin, wo man eine Tour
          // wählt — nicht in die zuletzt offene Projekt- oder Fotoliste.
          window.__rzStartTouren = true;
          if (typeof switchMod === "function") switchMod("library");
        }
        else if (action === "clearws") window.clearWorkspaceGlobal();
        else if (action === "clear") window.clearGlobalGpx();   // Legacy-Fallback
      };
    });
  }

  async function pickGpx() {
    // 09.09.2026 (Marc: „bei uns ist die Wahrheit das Archiv der Touren"): erst
    // die Archiv-Auswahl; eine Datei von außerhalb geht dort über „Datei
    // importieren …" ins Archiv und wird dann geöffnet.
    if (typeof window.rzArchivTourenWaehlen === "function") {
      const pfade = await window.rzArchivTourenWaehlen({ einzel: true,
        titel: t("gpxbar.open_archiv", "Tour öffnen"), okText: t("gpxbar.open_ok", "Öffnen") });
      if (pfade && pfade.length) await window.loadGlobalGpx(pfade[0]);
      return;
    }
    const files = await api().pick_file("open", window.TRACK_PICK_FILTER, false); // warte-ok: Systemdialog
    if (!files || !files.length) return;
    await window.loadGlobalGpx(files[0]);
  }
  // v0.9.288 — global exponiert, damit das macOS-Menü „Datei → Track öffnen…"
  // denselben Picker auslösen kann wie der Topbar-Button.
  window.pickGpx = pickGpx;

  function _setupDragDrop() {
    if (!_container || _container._gpxDndBound) return;
    _container._gpxDndBound = true;
    _container.addEventListener("dragover", (e) => {
      if (!e.dataTransfer?.types?.includes("Files")) return;
      e.preventDefault();
      _container.classList.add("is-drag-over");
    });
    _container.addEventListener("dragleave", (e) => {
      if (!_container.contains(e.relatedTarget)) _container.classList.remove("is-drag-over");
    });
    _container.addEventListener("drop", async (e) => {
      e.preventDefault();
      _container.classList.remove("is-drag-over");
      // v0.9.153: echten Originalpfad via pywebview holen (WKWebView gibt dem
      // JS nur den Namen, kein .path). consumeNativeDropMap() pro Drop 1× rufen.
      const nativeMap = (typeof consumeNativeDropMap === "function")
                        ? await consumeNativeDropMap() : {};
      const files = (e.dataTransfer && e.dataTransfer.files) || [];
      // 22.08.2026 — Projekt-Datei (.rzproj) abgelegt → importieren statt laden
      const proj = Array.from(files).find(f => /\.rzproj$/i.test(f.name));
      let projPath = proj ? (nativePathFromMap(nativeMap, proj.name) || proj.path || null) : null;
      if (!projPath) { for (const k in nativeMap) { if (/\.rzproj$/i.test(k)) { projPath = nativeMap[k]; break; } } }
      if (projPath) { if (window.importProject) await window.importProject(projPath); return; }
      const gpx = Array.from(files).find(f => window.TRACK_DROP_RE.test(f.name));
      let path = null;
      if (gpx) {
        path = nativePathFromMap(nativeMap, gpx.name) || gpx.path || null;
      }
      // Auffang: JS bekam keine Files (WKWebView) → erster Track aus nativen Pfaden
      if (!path) {
        for (const k in nativeMap) {
          if (window.TRACK_DROP_RE.test(k)) { path = nativeMap[k]; break; }
        }
      }
      if (path) await window.loadGlobalGpx(path);
    });
  }

  /* ── Archiv-Frage (27.08.2026, Marc) ──────────────────────────────────────
   *
   * „wenn ich eine gpx öffne, egal in welchem modul, dann landet die nicht
   * automatisch im archiv" — und genau daran läuft die Hälfte der eigenen
   * Touren vorbei. Marcs vier Fälle, hier eins zu eins:
   *
   *   1. Es IST die Archiv-Datei          → nichts sagen, läuft wie bisher.
   *   2. Tour bekannt, andere Datei       → darauf hinweisen (Kopie außerhalb).
   *   3. Tour unbekannt                   → fragen; bei Ja wird die Datei in den
   *      überwachten Ordner KOPIERT und ab dann mit der Kopie gearbeitet.
   *   4. Im Inspektor geänderter Track    → ebenfalls fragen (`nachAenderung`).
   *
   * Gefragt wird nur bei Ladevorgängen, die der Nutzer selbst ausgelöst hat.
   * Beim App-Start, aus dem Archiv heraus und beim Cloud-Import wäre die Frage
   * sinnlos oder schon beantwortet — die rufen mit `{stumm: true}`.
   *
   * Liefert den Pfad zurück, mit dem weitergearbeitet werden soll.
   */
  window.archivFrage = async function(path, opts) {
    const nachAenderung = !!(opts && opts.nachAenderung);
    let st;
    try { st = await api().archiv_status(path); } catch (_) { return path; }
    // Ohne Tour-Kennung ist die Antwort nicht belastbar (alte Brücke, Fehler im
    // Archiv, Mock im Test) — dann lieber schweigen als einen Dialog aufmachen,
    // den niemand beantworten kann. Genau das ließ am 27.08.2026 den
    // Playwright-Test `selftest_pace` zehn Minuten lang stehen.
    if (!st || !st.ok || st.im_archiv || !st.geo_hash) return path;   // Fall 1

    if (st.bekannt && !nachAenderung) {                  // Fall 2 — nur Hinweis
      const name = st.archiv_name || "";
      toast(t("archiv.schon_da", "Diese Tour liegt schon im Archiv{name} — du arbeitest gerade an einer Kopie außerhalb.")
        .replace("{name}", name ? ` („${name}“)` : ""), "warn", 8000);
      return path;
    }

    // Schon einmal „nein" gesagt? Dann nicht bei jedem Öffnen erneut fragen.
    const merker = st.geo_hash || path;
    let abgelehnt = [];
    try { abgelehnt = (await loadSettings()).archiv_frage_nie || []; } catch (_) {}
    if (abgelehnt.indexOf(merker) >= 0) return path;

    const ordner = st.ordner || [];
    const zielHtml = ordner.length > 1
      ? `<div class="field-label" style="margin-top:10px">${t("archiv.ziel", "Ablegen in")}</div>
         <select id="md-arch-ordner" class="lib-select" style="width:100%">${
           ordner.map(o => `<option value="${escapeAttr(o.path)}">${escapeHtml(o.name)}</option>`).join("")}</select>`
      : `<p class="lib-hint" style="margin-top:8px">${t("archiv.ziel_fest", "Ablegen in:")} <code>${
           escapeHtml(ordner.length ? ordner[0].path : t("archiv.ziel_neu", "Dokumente › Reisezoom Touren (wird angelegt)"))}</code></p>`;

    const ja = await new Promise(resolve => {
      openModal({
        title: nachAenderung ? t("archiv.titel_geaendert", "Geänderten Track ins Archiv legen?")
                             : t("archiv.titel", "Tour ins Archiv aufnehmen?"),
        body: `<p>${nachAenderung
                ? t("archiv.text_geaendert", "Der geänderte Track ist noch nirgends erfasst. Soll er ins Archiv, damit du ihn wiederfindest?")
                : t("archiv.text", "Diese Tour kennt das Archiv noch nicht. Soll sie aufgenommen werden?")}</p>
               <p class="lib-hint">${t("archiv.kopie_hinweis",
                 "Die Datei wird in deinen überwachten Ordner kopiert — das Original bleibt, wo es ist. Weitergearbeitet wird ab dann mit der Version im Archiv.")}</p>
               ${zielHtml}`,
        footer: `
          <label class="check-row" style="margin-right:auto;font-size:12px">
            <input type="checkbox" id="md-arch-nie"><span>${t("archiv.nie_fragen", "Für diese Tour nicht mehr fragen")}</span>
          </label>
          <button class="btn" id="md-arch-nein">${t("archiv.nein", "Nein, danke")}</button>
          <button class="btn btn-primary" id="md-arch-ja">${t("archiv.ja", "Ja, ins Archiv")}</button>`,
        onClose: () => resolve(false),
      });
      const zu = (wert) => {
        const nie = document.getElementById("md-arch-nie");
        const wahl = document.getElementById("md-arch-ordner");
        window.__rzArchivZiel = wahl ? wahl.value : "";
        if (!wert && nie && nie.checked) {
          try { saveSettings({ archiv_frage_nie: abgelehnt.concat([merker]) }); } catch (_) {}
        }
        try { openModal({}).close(); } catch (_) {}
        resolve(wert);
      };
      const nein = document.getElementById("md-arch-nein");
      const jaBtn = document.getElementById("md-arch-ja");
      if (nein) nein.onclick = () => zu(false);
      if (jaBtn) jaBtn.onclick = () => zu(true);
    });
    if (!ja) return path;

    let r;
    try { r = await rzWarten("archiv_datei_aufnehmen", () => api().archiv_datei_aufnehmen(path, window.__rzArchivZiel || "")); }
    catch (e) { r = { ok: false, error: String(e) }; }
    if (!r || !r.ok) {
      toast((r && r.error) || t("archiv.fehler", "Konnte nicht ins Archiv gelegt werden."), "error", 6000);
      return path;
    }
    toast(r.cloud
      ? t("archiv.aufgenommen_cloud", "Ins Archiv aufgenommen — sie wandert gleich auch in deine Cloud.")
      : t("archiv.aufgenommen", "Ins Archiv aufgenommen."), "success", 5000);
    // Ab jetzt mit der Archiv-Version arbeiten — sonst zeigt die Leiste weiter
    // auf die Datei außerhalb, und die nächste Sitzung sucht sie dort.
    if (r.pfad && r.pfad !== path) { try { await window.loadGlobalGpx(r.pfad, { stumm: true }); } catch (_) {} }
    return r.pfad || path;
  };

  // ── Utilities ─────────────────────────────────────────────────────────
  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }
})();
