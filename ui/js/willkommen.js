/* Willkommen — Überblick über GPS Studio auf einer Seite (24.10.2026).
 *
 * Marc: „direkt bei dem Willkommensbildschirm ein bisschen eine Anleitung … nicht ein Tutorial, wo man komplett
 * durchklickt, sondern einfach jedes Modul mit Bildern und einer kurzen Erklärung … dann ein ‚Mehr erfahren‘ … und
 * eine Anleitung, wie man ganz schnell anfangen kann … Es soll aber auch schick aussehen.“
 *
 * Eine Seite über dem Fenster: Schnellstart in drei Schritten (mit Knöpfen, die gleich loslegen), darunter die
 * Aufgaben der früheren Startseite und je Modul eine Karte mit echtem Bild (ui/img/quickstart, aufgenommen von
 * scripts/willkommen_bilder.py aus einem Demo-Archiv), kurzer Erklärung, „Mehr erfahren“ (der Schnell-Einstieg des
 * Moduls, ui/js/quickstart.js) und „Öffnen“. Erscheint nach dem ersten Einrichten und — solange „Beim Start zeigen“
 * an ist — bei jedem Start; sonst über Hilfe → „Überblick über GPS Studio“.
 */
(function () {
  "use strict";
  const T = (k, f, p) => (typeof t === "function" ? t(k, f, p) : (f || k));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const I = (n, g) => (typeof rzIcon === "function" ? rzIcon(n, { size: g || 18 }) : "");

  // Je Modul: Karte im Überblick. `qs` = Schlüssel des Schnell-Einstiegs, `oeffnen` = wohin „Öffnen“ führt.
  const MODULE = [
    { id: "library", icon: "library", bild: "library", qs: "library", oeffnen: "library",
      titel: ["willkommen.m.library", "Archiv"],
      text: ["willkommen.m.library_text", "Alle Touren an einem Ort: Ordner einlesen, suchen, filtern, Statistik. Ein Doppelklick öffnet die Tour."] },
    { id: "tourseite", icon: "book-open", bild: "tourseite", qs: "tourseite", oeffnen: "library",
      titel: ["willkommen.m.tourseite", "Tour & Logbuch"],
      text: ["willkommen.m.tourseite_text", "Karte, Fotos, Zeitstrahl und das Logbuch der Tour — was wann wo war, Tag für Tag."] },
    { id: "medien", icon: "images", bild: "medien", qs: "medien", oeffnen: "medien",
      titel: ["willkommen.m.medien", "Medien"],
      text: ["willkommen.m.medien_text", "Fotos und Clips von allen Laufwerken — nach Tour, Ort und Tag, mit Bildbearbeitung."] },
    { id: "animator", icon: "clapperboard", bild: "animator", qs: "animator", oeffnen: "animator",
      titel: ["willkommen.m.animator", "Animator"],
      text: ["willkommen.m.animator_text", "Aus dem Track ein Kartenvideo: 3D-Gelände, Kamerafahrt, Fotos, Schilder und Einblendungen."] },
    { id: "tourmap", icon: "map", bild: "tourmap", qs: "tourmap", oeffnen: "tourmap",
      titel: ["willkommen.m.tourmap", "Tour-Map"],
      text: ["willkommen.m.tourmap_text", "Ein Standbild der Tour in hoher Auflösung — fürs Thumbnail, den Blog oder als Poster."] },
    { id: "heightanim", icon: "chart-spline", bild: "datenanimator", qs: "heightanim", oeffnen: "heightanim",
      titel: ["willkommen.m.heightanim", "Daten-Animator"],
      text: ["willkommen.m.heightanim_text", "Höhe, Tempo oder Puls als Kurve, die sich aufbaut — auch als Overlay fürs Video."] },
    { id: "gpxinspect", icon: "search", bild: "gpxinspect", qs: "gpxinspect", oeffnen: "gpxinspect",
      titel: ["willkommen.m.gpxinspect", "GPX-Inspektor"],
      text: ["willkommen.m.gpxinspect_text", "Track prüfen und reparieren: Ausreißer, Lücken, Zeiten — mit Logbuch und Zeitstrahl."] },
    { id: "webkarte", icon: "globe", bild: "webkarte", qs: "webkarte", oeffnen: "webkarte",
      titel: ["willkommen.m.webkarte", "Web-Karte"],
      text: ["willkommen.m.webkarte_text", "Eine interaktive Karte deiner Tour zum Einbetten in Blog oder Website."] },
    { id: "geotagger", icon: "map-pin", bild: "geotagger", qs: "geotagger", oeffnen: "geotagger",
      titel: ["willkommen.m.geotagger", "Geotagger"],
      text: ["willkommen.m.geotagger_text", "Deinen Fotos den Ort aus dem Track geben — für Karte, Archiv und Video."] },
  ];
  // Die Aufgaben der früheren Startseite (ui/js/startseite.js) als Abkürzungen
  const AUFGABEN = [
    { id: "video", icon: "clapperboard", titel: ["startseite.video", "Video erstellen"] },
    { id: "track", icon: "bandage", titel: ["startseite.track", "Track verbessern"] },
    { id: "fotos", icon: "map-pin", titel: ["startseite.fotos", "Fotos verorten"] },
    { id: "ohne_gps", icon: "route", titel: ["etappe.ohne_gps", "Kartenanimation ohne GPS"] },
  ];

  let _el = null;

  function html(beimStart) {
    // Bildpfade über window.__rzAssetBase: die App lädt index.html als Kopie aus einem Temp-Ordner (app.py
    // _prepare_html_with_cache_busting) — relativ gebaute Pfade zeigten dort ins Leere (Marc: „keine Bilder“)
    const karte = (m) => `<article class="rzw-karte" data-rzw-modul="${m.id}">
        <button type="button" class="rzw-bild" data-rzw-mehr="${m.id}" title="${esc(T("willkommen.mehr", "Mehr erfahren"))}">
          <img src="${(window.__rzAssetBase || "")}img/quickstart/${m.bild}.jpg" alt="" loading="lazy" onerror="this.closest('.rzw-bild').classList.add('ohne')"></button>
        <div class="rzw-karte-text">
          <h3>${I(m.icon, 17)}<span>${esc(T(m.titel[0], m.titel[1]))}</span></h3>
          <p>${esc(T(m.text[0], m.text[1]))}</p>
          <div class="rzw-karte-knoepfe">
            <button type="button" class="rzw-link" data-rzw-mehr="${m.id}">${esc(T("willkommen.mehr", "Mehr erfahren"))} ${I("arrow-right", 14)}</button>
            <button type="button" class="btn btn-sm" data-rzw-oeffnen="${m.id}">${esc(T("willkommen.oeffnen", "Öffnen"))}</button>
          </div>
        </div>
      </article>`;
    // je Schritt ein Ausschnitt mit markiertem Knopf (scripts/willkommen_bilder.py → img/quickstart/start-<n>.jpg)
    const schritt = (n, titel, text, knoepfe) => `<li class="rzw-schritt">
        <img class="rzw-schritt-bild" src="${(window.__rzAssetBase || "")}img/quickstart/start-${n}.jpg" alt="" onerror="this.remove()">
        <div class="rzw-schritt-zeile"><span class="rzw-nr">${n}</span>
        <div><b>${esc(titel)}</b><p>${esc(text)}</p>${knoepfe ? `<div class="rzw-schritt-knoepfe">${knoepfe}</div>` : ""}</div></div></li>`;
    return `<div class="rzw-innen">
      <header class="rzw-kopf">
        <div class="rzw-kopf-text">
          <div class="rzw-marke">${I("route", 22)} GPS Studio</div>
          <h1>${esc(T("willkommen.titel", "Willkommen — schön, dass du da bist"))}</h1>
          <p>${esc(T("willkommen.unter", "Hier bereitest du deine Touren auf: sammeln, verstehen, zeigen. Archiv, Logbuch, Karten und Videos — alles an einem Ort, alles auf deinem Rechner."))}</p>
        </div>
        <button type="button" class="btn btn-primary rzw-weiter" data-rzw-zu="1">${esc(T("willkommen.zum_archiv", "Zum Archiv"))} ${I("arrow-right", 16)}</button>
      </header>

      <section class="rzw-schnell">
        <h2>${I("zap", 18)} ${esc(T("willkommen.schnell_titel", "In drei Schritten zum ersten Video"))}</h2>
        <ol class="rzw-schritte">
          ${schritt(1, T("willkommen.s1", "Track holen"), T("willkommen.s1_text", "Eine GPX-, FIT- oder TCX-Datei ins Fenster ziehen — oder im Archiv deinen Track-Ordner einlesen."),
            `<button type="button" class="btn btn-sm btn-primary" data-rzw-aktion="track">${I("upload", 14)} ${esc(T("willkommen.track_oeffnen", "Track öffnen …"))}</button>
             <button type="button" class="btn btn-sm" data-rzw-aktion="ordner">${I("folder-plus", 14)} ${esc(T("willkommen.ordner", "Ordner einlesen …"))}</button>`)}
          ${schritt(2, T("willkommen.s2", "Tour öffnen"), T("willkommen.s2_text", "Im Archiv doppelklicken: Karte, Fotos, Logbuch und Zeitstrahl der Tour auf einen Blick."))}
          ${schritt(3, T("willkommen.s3", "Video machen"), T("willkommen.s3_text", "„Video ▾ → Schnell-Video“: Format, Länge und Look wählen — fertig. Den Feinschliff gibt's im Animator."))}
        </ol>
        <div class="rzw-aufgaben"><span class="muted">${esc(T("willkommen.oder", "Oder gleich:"))}</span>
          ${AUFGABEN.map(a => `<button type="button" class="rzw-chip" data-rzw-aufgabe="${a.id}">${I(a.icon, 14)} ${esc(T(a.titel[0], a.titel[1]))}</button>`).join("")}
        </div>
      </section>

      <section class="rzw-module">
        <h2>${I("layout-grid", 18)} ${esc(T("willkommen.module_titel", "Was steckt drin?"))}</h2>
        <div class="rzw-raster">${MODULE.map(karte).join("")}</div>
      </section>

      <footer class="rzw-fuss">
        <label class="rzw-haken"><input type="checkbox" id="rzw-beim-start"${beimStart ? " checked" : ""}> ${esc(T("willkommen.beim_start", "Beim Start zeigen"))}</label>
        <span class="muted">${esc(T("willkommen.wieder", "Jederzeit wieder: Hilfe → Überblick über GPS Studio"))}</span>
        <button type="button" class="btn" data-rzw-handbuch="1">${I("book-open", 14)} ${esc(T("quickstart.full_guide", "Ganzes Handbuch"))}</button>
      </footer>
    </div>`;
  }

  function schliessen() {
    if (!_el) return;
    const h = _el.querySelector("#rzw-beim-start");
    if (h && typeof saveSettings === "function") { try { saveSettings({ willkommen_beim_start: !!h.checked }); } catch (_) {} }
    _el.classList.add("weg");
    const el = _el; _el = null;
    setTimeout(() => el.remove(), 220);
    document.removeEventListener("keydown", _taste, true);
  }
  function _taste(e) { if (e.key === "Escape" && _el && !document.querySelector("#modal-overlay:not([hidden])")) { e.stopPropagation(); schliessen(); } }

  function gehe(modul) {
    schliessen();
    if (modul === "medien") {
      if (typeof switchMod === "function") switchMod("library");
      // Das Archiv baut sich nach dem Wechsel erst auf — auf den Medien-Knopf warten (bis 4 s)
      let n = 0;
      const klick = () => { const b = document.getElementById("lib-seg-fotos"); if (b) { if (!b.classList.contains("is-on")) b.click(); } else if (++n < 20) setTimeout(klick, 200); };
      setTimeout(klick, 150);
      return;
    }
    if (typeof switchMod === "function") switchMod(modul);
  }

  async function aktion(was) {
    if (was === "track") { schliessen(); if (typeof window.pickGpx === "function") window.pickGpx(); return; }
    if (was === "ordner") {
      schliessen();
      if (typeof switchMod === "function") switchMod("library");
      try {
        const r = await api().library_add_folder("");   // warte-ok: Systemdialog
        if (r && r.ok) {
          await api().library_scan_start(false, r.path || "");   // warte-ok: Einlesen läuft im Hintergrund mit eigener Anzeige
          if (typeof toast === "function") toast(T("willkommen.ordner_laeuft", "Der Ordner wird eingelesen — die Touren erscheinen gleich im Archiv."), "info", 5000);
        }
      } catch (e) { console.warn("[willkommen] Ordner:", e); }
    }
  }

  function aufgabe(id) {
    schliessen();
    if (id === "ohne_gps") { if (typeof window.rzKartenanimationOhneGps === "function") window.rzKartenanimationOhneGps(""); return; }
    const ziel = { video: "library", track: "gpxinspect", fotos: "geotagger" }[id] || "library";
    if (typeof switchMod === "function") switchMod(ziel);
    if (id === "video" && typeof toast === "function")
      toast(T("startseite.video_toast", "Wähle links eine Tour — dann „🎬 Schnell-Video …“ oder „Im Animator öffnen“."), "info", 7000);
  }

  /** Den Überblick zeigen. `opt.erststart` = direkt nach dem Einrichten (Haken „Beim Start zeigen“ dann an). */
  function rzWillkommen(opt) {
    opt = opt || {};
    if (_el) return;
    const st = (typeof _settingsCache !== "undefined" && _settingsCache) || {};
    const beimStart = opt.erststart ? true : st.willkommen_beim_start === true;
    _el = document.createElement("div");
    _el.id = "rz-willkommen";
    _el.className = "rzw";
    _el.setAttribute("role", "dialog");
    _el.setAttribute("aria-label", T("willkommen.titel", "Willkommen — schön, dass du da bist"));
    _el.innerHTML = html(beimStart);
    document.body.appendChild(_el);
    requestAnimationFrame(() => _el && _el.classList.add("da"));
    _el.addEventListener("click", (e) => {
      const z = e.target.closest("[data-rzw-zu]"); if (z) { gehe("library"); return; }
      const m = e.target.closest("[data-rzw-mehr]");
      if (m) { const mod = MODULE.find(x => x.id === m.dataset.rzwMehr); if (mod && typeof window.openQuickstart === "function") window.openQuickstart(mod.qs); return; }
      const o = e.target.closest("[data-rzw-oeffnen]");
      if (o) { const mod = MODULE.find(x => x.id === o.dataset.rzwOeffnen); if (mod) gehe(mod.oeffnen); return; }
      const a = e.target.closest("[data-rzw-aktion]"); if (a) { aktion(a.dataset.rzwAktion); return; }
      const g = e.target.closest("[data-rzw-aufgabe]"); if (g) { aufgabe(g.dataset.rzwAufgabe); return; }
      const h = e.target.closest("[data-rzw-handbuch]"); if (h) { try { api().open_user_guide(); } catch (_) {} }
    });
    document.addEventListener("keydown", _taste, true);
    try { applog("info", "[willkommen] gezeigt" + (opt.erststart ? " (Erststart)" : "")); } catch (_) {}
  }

  window.rzWillkommen = rzWillkommen;
  window.rzWillkommenSchliessen = schliessen;
  window.RZ_WILLKOMMEN_MODULE = MODULE;   // Prüfstand
})();
