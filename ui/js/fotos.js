/* ──────────────────────────────────────────────────────────────────────────
 * Der Foto-Bestand im Archiv (12.09.2026, docs/IDEAS.md §64)
 *
 * Marc wollte keinen eigenen Reiter: „so wie man auch zwischen projekten und
 * touren wechselt, da einfach noch ein foto-tab dazu." Also ist das hier der
 * dritte Bereich des Archiv-Moduls — dieselbe Datenbank, dieselbe Leiste.
 *
 * Drei Ansichten, weil jede eine andere Frage beantwortet:
 *   Raster  — „was habe ich wann fotografiert" (nach Tagen gegliedert)
 *   Karte   — „wo war ich" (Punktwolke, Dichte als Helligkeit; optional die
 *             Touren als blasse Linien darunter)
 *   Touren  — „welche Fotos gehören zu welcher Tour" (über das Zeitfenster
 *             gerechnet, nicht gespeichert)
 *
 * Stufe 1 liest nur. Verorten ohne Track, Track aus Fotos bauen und der
 * EXIF-Editor sind eigene Stufen (§64).
 * ────────────────────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  const T = (k, f) => (typeof t === "function" ? t(k, f) : f);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const SEITE = 240;          // Fotos je Nachladung

  let haupt = null;           // der große Bereich
  let nav = null;             // die Seitenleiste
  let angemeldet = false;
  let ansicht = "raster";     // raster | karte | touren
  let filter = {};
  let geladen = [];           // die bisher geholten Fotos
  let gesamt = 0;
  let stand = {};
  let ordner = [];
  let scanTimer = 0;
  let karte = null, karteLib = null, karteBereit = false, spurenAn = false;
  let auswahl = null;
  let dKarte = null;          // die kleine Karte in der Detailspalte

  function num(n) {
    let loc = null;
    try { loc = (typeof i18nMeta === "function") ? i18nMeta().active : null; } catch (_) {}
    return Math.round(n || 0).toLocaleString(loc || undefined);
  }

  function tagText(tag) {
    if (!tag) return T("fotos.ohne_datum", "Ohne Datum");
    const d = new Date(tag + "T12:00:00");
    if (isNaN(d)) return tag;
    let loc = null;
    try { loc = (typeof i18nMeta === "function") ? i18nMeta().active : null; } catch (_) {}
    return d.toLocaleDateString(loc || undefined,
      { weekday: "short", year: "numeric", month: "long", day: "numeric" });
  }

  function uhrzeit(f) {
    if (!f.aufnahme_utc) return "";
    const d = new Date((f.aufnahme_utc + (f.tz_minuten || 0) * 60) * 1000);
    return d.toISOString().slice(11, 16);
  }

  function dauerText(s) {
    if (!s) return "";
    const m = Math.floor(s / 60), r = Math.round(s % 60);
    return m ? `${m}:${String(r).padStart(2, "0")}` : `${r}s`;
  }

  /** Was an einem Foto fehlt — sichtbar, statt still (Marc, Q16). */
  function maengel(f) {
    const m = [];
    if (!f.aufnahme_utc) m.push(T("fotos.fehlt_zeit", "keine Aufnahmezeit"));
    else if (!f.tz_bekannt) m.push(T("fotos.fehlt_tz", "Zeitzone geraten"));
    if (f.lat == null || f.lon == null) m.push(T("fotos.fehlt_ort", "keine Koordinate"));
    if (f.fehlt_seit) m.push(T("fotos.fehlt_datei", "Datei nicht erreichbar"));
    return m;
  }

  // ── Seitenleiste ────────────────────────────────────────────────────────

  function navZeichnen() {
    if (!nav) return;
    const s = stand || {};
    const zeile = (icon, text, n, klick, an) => `
      <button class="lib-nav-item${an ? " is-on" : ""}" type="button" data-fnav="${klick}">
        <span class="lib-nav-ico">${icon}</span>
        <span class="lib-nav-txt">${esc(text)}</span>
        <span class="lib-nav-count">${num(n)}</span>
      </button>`;

    nav.innerHTML = `
      <div class="lib-nav-title">${T("fotos.titel", "Fotos")}</div>
      <div class="lib-nav-hint">${T("fotos.nav_hint", "Ordner mit Fotos und Videos. Der Bestand liest nur — es wird keine Datei verändert.")}</div>
      ${zeile("🖼", T("fotos.alle", "Alle"), s.gesamt || 0, "alle", !filter.gps && !filter.art && !filter.ohne_zeit && !filter.mit_fehlenden)}
      ${zeile("📷", T("fotos.nur_fotos", "Nur Fotos"), s.fotos || 0, "fotos", filter.art === "foto")}
      ${zeile("🎬", T("fotos.nur_videos", "Nur Videos"), s.videos || 0, "videos", filter.art === "video")}
      ${zeile("📍", T("fotos.ohne_koordinate", "Ohne Koordinate"), s.ohne_koordinate || 0, "ohne_gps", filter.gps === "ohne")}
      ${zeile("🕐", T("fotos.ohne_zeit", "Ohne Aufnahmezeit"), s.ohne_zeit || 0, "ohne_zeit", !!filter.ohne_zeit)}
      ${(s.fehlt || 0) ? zeile("❓", T("fotos.fehlende", "Nicht erreichbar"), s.fehlt, "fehlend", !!filter.mit_fehlenden) : ""}

      <div class="lib-nav-title" style="margin-top:14px">${T("fotos.ordner_titel", "Fotoordner")}</div>
      <div id="foto-ordner-liste"></div>
      <button class="btn btn-primary btn-sm" id="foto-ordner-add" type="button" style="margin-top:6px">
        📂 ${T("fotos.ordner_add", "Ordner hinzufügen …")}</button>
      <button class="btn btn-ghost btn-sm" id="foto-scan" type="button">
        ${T("fotos.scan", "Einlesen")}</button>
      <div id="foto-scan-stand" class="lib-nav-hint"></div>
      ${(s.ungelesen || 0) ? `<div class="lib-nav-hint">${T("fotos.ungelesen", "{n} Dateien noch ohne Aufnahmedaten").replace("{n}", num(s.ungelesen))}</div>` : ""}
    `;

    const box = nav.querySelector("#foto-ordner-liste");
    if (box) {
      box.innerHTML = ordner.length
        ? ordner.map((o, i) => `
          <div class="foto-ordner">
            <div class="foto-ordner-txt" title="${esc(o.path)}">
              ${esc(o.path.split("/").slice(-2).join("/"))}
              <span class="muted">${num(o.n)}${o.da ? "" : " · " + T("fotos.ordner_weg", "nicht da")}</span>
            </div>
            <button class="btn btn-sm" data-fordweg="${i}" type="button"
                    title="${T("fotos.ordner_entfernen", "Ordner nicht mehr beobachten")}">✕</button>
          </div>`).join("")
        : `<div class="lib-nav-hint">${T("fotos.ordner_leer", "Noch kein Ordner. „Ordner hinzufügen“ nimmt einen auf; Unterordner kommen mit.")}</div>`;
      box.querySelectorAll("[data-fordweg]").forEach(b => {
        b.onclick = async () => {
          const o = ordner[+b.dataset.fordweg];
          if (!o) return;
          const ok = await window.rzConfirm(
            T("fotos.ordner_entfernen", "Ordner nicht mehr beobachten"),
            T("fotos.ordner_entfernen_frage", "„{p}“ verschwindet aus dem Bestand. Die Dateien selbst bleiben unberührt.").replace("{p}", o.path),
            T("fotos.ordner_entfernen_ok", "Entfernen"), false);
          if (!ok) return;
          const r = await api().fotos_ordner_weg(o.path, true);
          if (r && r.ok) { ordner = r.ordner || []; stand = r.stand || stand; navZeichnen(); neuLaden(); }
        };
      });
    }

    nav.querySelectorAll("[data-fnav]").forEach(b => {
      b.onclick = () => {
        const w = b.dataset.fnav;
        filter = Object.assign({}, filter);
        delete filter.art; delete filter.gps; delete filter.ohne_zeit; delete filter.mit_fehlenden;
        if (w === "fotos") filter.art = "foto";
        else if (w === "videos") filter.art = "video";
        else if (w === "ohne_gps") filter.gps = "ohne";
        else if (w === "ohne_zeit") filter.ohne_zeit = true;
        else if (w === "fehlend") filter.mit_fehlenden = true;
        navZeichnen();
        neuLaden();
      };
    });

    const add = nav.querySelector("#foto-ordner-add");
    if (add) add.onclick = async () => {
      add.disabled = true;
      try {
        const r = await api().fotos_ordner_hinzu("", true);
        if (r && r.ok) {
          ordner = r.ordner || [];
          navZeichnen();
          scanStarten();
        } else if (r && !r.abbruch) {
          toast((r && r.error) || "?", "warn");
        }
      } catch (e) { toast(String(e), "warn"); }
      add.disabled = false;
    };
    const scan = nav.querySelector("#foto-scan");
    if (scan) scan.onclick = () => scanStarten();
  }

  // ── Einlesen ────────────────────────────────────────────────────────────

  async function scanStarten() {
    if (!ordner.length) {
      toast(T("fotos.kein_ordner", "Erst einen Fotoordner hinzufügen."), "info");
      return;
    }
    const r = await api().fotos_scan_start().catch(() => null);
    if (!r || !r.ok) { toast((r && r.error) || "?", "warn"); return; }
    scanBeobachten();
  }

  function scanBeobachten() {
    clearTimeout(scanTimer);
    const box = nav && nav.querySelector("#foto-scan-stand");
    const knopf = nav && nav.querySelector("#foto-scan");
    // Ein abwesendes Laufwerk ist kein Fehler, aber es muss dastehen: sonst
    // wirkt ein Scan ohne Fund wie ein Defekt (Fotos auf einem NAS im WLAN).
    const fernText = (st) => {
      const f = (st && st.ferne_ordner) || [];
      if (!f.length) return "";
      const namen = f.map((x) => String(x).split("/").pop()).slice(0, 3).join(", ");
      return T("fotos.ordner_fern", "Nicht erreichbar") + ": " + namen
             + (f.length > 3 ? " +" + (f.length - 3) : "");
    };
    const tick = async () => {
      let st = null;
      try { st = await api().fotos_scan_status(); } catch (_) { st = null; }
      if (!st) return;
      // Auch im großen Kasten unten rechts anzeigen — dann sieht man den
      // Fortschritt, selbst wenn man inzwischen im Animator arbeitet
      // (Marc, 12.09.2026: „überall visuelles Feedback").
      if (window.rzStatus) {
        const phase2 = st.phase === "dateien"
          ? T("fotos.scan_dateien", "Dateien suchen")
          : T("fotos.scan_daten", "Aufnahmedaten lesen");
        if (st.running) {
          if (!window.rzStatus.laeuft("foto-scan")) {
            window.rzStatus.start("foto-scan", { titel: T("fotos.titel", "Fotos"),
                                                 text: phase2, gesamt: st.total || 0,
                                                 abbrechen: true });
          }
          window.rzStatus.schritt("foto-scan", { text: phase2, n: st.done || 0,
                                                 gesamt: st.total || 0 });
          if (window.rzStatus.abgebrochen("foto-scan")) api().fotos_scan_stop();
        } else if (window.rzStatus.laeuft("foto-scan")) {
          window.rzStatus.fertig("foto-scan",
            st.error ? String(st.error) : fernText(st));
        }
      }
      if (box) {
        if (st.running) {
          const phase = st.phase === "dateien"
            ? T("fotos.scan_dateien", "Dateien suchen")
            : T("fotos.scan_daten", "Aufnahmedaten lesen");
          box.innerHTML = `${esc(phase)} — ${num(st.done)}${st.total ? " / " + num(st.total) : ""}
            <button class="btn btn-sm" id="foto-scan-stop" type="button">${T("common.cancel", "Abbrechen")}</button>`;
          const sp = box.querySelector("#foto-scan-stop");
          if (sp) sp.onclick = () => api().fotos_scan_stop();
        } else {
          box.textContent = st.error ? String(st.error) : fernText(st);
        }
      }
      if (knopf) knopf.disabled = !!st.running;
      if (st.running) {
        // Während des ersten Durchgangs wächst die Liste — einmal je Sekunde
        // nachziehen reicht, sonst flackert es.
        if (st.phase === "dateien" && st.done && st.done % 1000 < 200) neuLaden(true);
        scanTimer = setTimeout(tick, 900);
      } else {
        stand = st.stand || stand;
        try {
          const r = await api().fotos_ordner();
          if (r && r.ok) { ordner = r.ordner || []; stand = r.stand || stand; }
        } catch (_) {}
        navZeichnen();
        neuLaden();
      }
    };
    tick();
  }

  // ── Laden ───────────────────────────────────────────────────────────────

  async function neuLaden(leise) {
    geladen = [];
    await mehrLaden(leise);
  }

  async function mehrLaden(leise) {
    const r = await api().fotos_abfrage({
      filter: filter, limit: SEITE, offset: geladen.length, mit_thumbs: true,
    }).catch(() => null);
    if (!r || !r.ok) { if (!leise) toast((r && r.error) || "?", "warn"); return; }
    gesamt = r.n || 0;
    geladen = geladen.concat(r.fotos || []);
    zeichnen();
  }

  async function filterwerteLaden() {
    const r = await api().fotos_filterwerte().catch(() => null);
    if (r && r.ok) {
      stand = r.stand || {};
      haupt._kameras = r.kameras || [];
      haupt._jahre = r.jahre || [];
    }
  }

  // ── Zeichnen ────────────────────────────────────────────────────────────

  function leisteHtml() {
    const kameras = haupt._kameras || [];
    const jahre = haupt._jahre || [];
    const opt = (wert, text, aktiv) =>
      `<option value="${esc(wert)}"${String(aktiv || "") === String(wert) ? " selected" : ""}>${esc(text)}</option>`;
    return `
      <div class="lib-bar foto-bar">
        <input type="search" id="foto-suche" class="lib-search" value="${esc(filter.suche || "")}"
               placeholder="${T("fotos.suche_ph", "Suchen — Dateiname, Kamera, Objektiv, Stichwort, Ort …")}">
        <select id="foto-jahr" class="lib-select">
          ${opt("", T("fotos.jahr_alle", "Alle Jahre"), filter.jahr)}
          ${jahre.map(j => opt(j.jahr, `${j.jahr} (${num(j.n)})`, filter.jahr)).join("")}
        </select>
        <select id="foto-kamera" class="lib-select">
          ${opt("", T("fotos.kamera_alle", "Alle Kameras"), filter.kamera)}
          ${kameras.map(k => opt(k.kamera, `${k.kamera} (${num(k.n)})`, filter.kamera)).join("")}
        </select>
        <select id="foto-gps" class="lib-select">
          ${opt("", T("fotos.gps_egal", "Mit und ohne Koordinate"), filter.gps)}
          ${opt("mit", T("fotos.gps_mit", "Nur mit Koordinate"), filter.gps)}
          ${opt("ohne", T("fotos.gps_ohne", "Nur ohne Koordinate"), filter.gps)}
        </select>
        <button class="lib-chip lib-chip-ghost" id="foto-reset" type="button">${T("library.reset", "Zurücksetzen")}</button>
        <span class="lib-bar-spacer"></span>
        <div class="lib-views" role="group">
          <button class="lib-view${ansicht === "raster" ? " is-on" : ""}" data-fview="raster" type="button"
                  title="${T("fotos.view_raster", "Raster nach Tagen")}">▦</button>
          <button class="lib-view${ansicht === "karte" ? " is-on" : ""}" data-fview="karte" type="button"
                  title="${T("fotos.view_karte", "Karte")}">🌍</button>
          <button class="lib-view${ansicht === "touren" ? " is-on" : ""}" data-fview="touren" type="button"
                  title="${T("fotos.view_touren", "Nach Touren")}">🥾</button>
        </div>
      </div>`;
  }

  function kopfHtml() {
    const teile = [T("fotos.kopf", "{n} Dateien").replace("{n}", num(gesamt))];
    if (stand.ungelesen) teile.push(T("fotos.kopf_offen", "{n} noch ohne Aufnahmedaten").replace("{n}", num(stand.ungelesen)));
    if (stand.ohne_koordinate) teile.push(T("fotos.kopf_ohne_gps", "{n} ohne Koordinate").replace("{n}", num(stand.ohne_koordinate)));
    return `<div class="lib-head">${esc(teile.join(" · "))}</div>`;
  }

  function kachelHtml(f, i) {
    const m = maengel(f);
    const bild = f.thumb_url
      ? `<img loading="lazy" src="${f.thumb_url}" alt="">`
      : `<div class="foto-kachel-leer">${f.art === "video" ? "🎬" : "🖼"}</div>`;
    return `
      <button class="foto-kachel${auswahl === f.path ? " is-on" : ""}" type="button" data-foto="${i}"
              title="${esc(f.dateiname)}${m.length ? " — " + esc(m.join(", ")) : ""}">
        ${bild}
        <span class="foto-kachel-zeit">${esc(uhrzeit(f))}</span>
        ${f.art === "video" ? `<span class="foto-kachel-art">▶ ${esc(dauerText(f.dauer_s))}</span>` : ""}
        ${m.length ? `<span class="foto-kachel-warn" title="${esc(m.join(", "))}">!</span>` : ""}
      </button>`;
  }

  function rasterZeichnen(box) {
    if (!geladen.length) {
      box.innerHTML = `<div class="lib-detail-empty" style="padding:20px">${
        stand.gesamt ? T("fotos.leer_filter", "Kein Treffer für diese Auswahl.")
                     : T("fotos.leer", "Noch keine Fotos im Bestand. Links einen Ordner hinzufügen, dann einlesen.")}</div>`;
      return;
    }
    const gruppen = [];
    let letzte = null;
    geladen.forEach((f, i) => {
      const tag = f.tag_lokal || "";
      if (!letzte || letzte.tag !== tag) {
        letzte = { tag, fotos: [] };
        gruppen.push(letzte);
      }
      letzte.fotos.push([f, i]);
    });
    box.innerHTML = gruppen.map(g => `
      <div class="foto-tag">
        <div class="foto-tag-kopf">${esc(tagText(g.tag))}
          <span class="muted">${num(g.fotos.length)}</span></div>
        <div class="foto-raster">${g.fotos.map(([f, i]) => kachelHtml(f, i)).join("")}</div>
      </div>`).join("")
      + (geladen.length < gesamt
        ? `<button class="btn" id="foto-mehr" type="button" style="margin:12px auto; display:block">
             ${T("fotos.mehr", "Weitere {n} laden").replace("{n}", num(Math.min(SEITE, gesamt - geladen.length)))}</button>`
        : "");
    const mehr = box.querySelector("#foto-mehr");
    if (mehr) mehr.onclick = () => { mehr.disabled = true; mehrLaden(); };
    box.querySelectorAll("[data-foto]").forEach(b => {
      b.onclick = () => detailZeigen(geladen[+b.dataset.foto]);
    });
  }

  async function tourenZeichnen(box) {
    box.innerHTML = `<div class="lib-detail-empty" style="padding:20px">${T("common.loading", "Lädt …")}</div>`;
    const r = await api().fotos_touren(filter).catch(() => null);
    if (!r || !r.ok) { box.innerHTML = `<div class="lib-detail-empty" style="padding:20px">${esc((r && r.error) || "?")}</div>`; return; }
    const liste = r.touren || [];
    if (!liste.length) {
      box.innerHTML = `<div class="lib-detail-empty" style="padding:20px">${
        T("fotos.touren_leer", "Keine Tour passt zeitlich zu diesen Fotos. Das Archiv braucht Touren mit Uhrzeit.")}</div>`;
      return;
    }
    box.innerHTML = `
      <div class="lib-nav-hint" style="padding:10px 12px 0">${T("fotos.touren_hint",
        "Zugeordnet über das Zeitfenster der Tour — nichts davon steht in den Dateien. Genau das kann kein reines Fototool: die Touren liegen hier schon.")}</div>
      <div class="foto-touren">
        ${liste.map((g, i) => `
          <button class="foto-tour${g.ohne_tour ? " ist-ohne" : ""}" type="button" data-ftour="${i}">
            <div class="foto-tour-name">${g.ohne_tour
              ? T("fotos.ohne_tour", "Zu keiner Tour")
              : esc(g.name || "—")}</div>
            <div class="foto-tour-zahl">${num(g.n)} ${T("fotos.stueck", "Dateien")}${
              g.ohne_koordinate ? ` · ${num(g.ohne_koordinate)} ${T("fotos.ohne_koordinate_kurz", "ohne Koordinate")}` : ""}</div>
          </button>`).join("")}
      </div>`;
    box.querySelectorAll("[data-ftour]").forEach(b => {
      b.onclick = async () => {
        const g = liste[+b.dataset.ftour];
        if (!g || g.ohne_tour) return;
        const r2 = await api().fotos_einer_tour(g.geo_hash || "", g.path || "").catch(() => null);
        if (!r2 || !r2.ok) return;
        filter = Object.assign({}, filter, { von_utc: r2.von - 1800, bis_utc: r2.bis + 1800 });
        ansicht = "raster";
        neuLaden();
        toast(T("fotos.tour_gefiltert", "Zeigt die Dateien im Zeitfenster von „{n}“").replace("{n}", g.name || ""), "info");
      };
    });
  }

  // ── Karte ───────────────────────────────────────────────────────────────

  function karteZeichnen(box) {
    box.innerHTML = `
      <div class="foto-kartewrap">
        <div class="foto-karte" id="foto-karte"></div>
        <div class="lib-map-hint" id="foto-karte-hint"></div>
        <label class="foto-karte-spuren">
          <input type="checkbox" id="foto-spuren"${spurenAn ? " checked" : ""}>
          <span>${T("fotos.karte_spuren", "Touren als Linien zeigen")}</span>
        </label>
      </div>`;
    const sp = box.querySelector("#foto-spuren");
    if (sp) sp.onchange = () => { spurenAn = sp.checked; spurenLaden(); };
    karteAufbauen();
  }

  function karteAufbauen() {
    if (karte) {
      try { karte.resize(); } catch (_) {}
      punkteLaden();
      return;
    }
    if (typeof createMap !== "function") return;
    const created = createMap({
      container: "foto-karte",
      styleKey: (typeof mapDefaultStyle === "function") ? mapDefaultStyle() : undefined,
      common: { center: [10, 51], zoom: 3, attributionControl: true },
    });
    karte = created.map; karteLib = created.lib;
    window.__fotoMap = karte;
    try { karte.addControl(new karteLib.NavigationControl({ showCompass: false }), "top-right"); } catch (_) {}
    karte.on("load", () => {
      karteBereit = true;
      // Die Spuren liegen UNTER der Wolke: sie sind Zusammenhang, nicht Inhalt.
      karte.addSource("foto-spuren", { type: "geojson", data: leer() });
      karte.addLayer({
        id: "foto-spuren-linie", type: "line", source: "foto-spuren",
        paint: { "line-color": "#7aa2c8", "line-width": 1.6, "line-opacity": 0.45 },
      });
      karte.addSource("foto-wolke", { type: "geojson", data: leer() });
      // Dichte als Helligkeit — bei zehntausend Punkten die einzige lesbare
      // Darstellung (Marc: „je mehr fotos, desto dunkler", wie Google Fotos).
      karte.addLayer({
        id: "foto-wolke-punkt", type: "circle", source: "foto-wolke",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["get", "n"], 1, 4, 10, 7, 100, 12, 1000, 18],
          "circle-color": ["interpolate", ["linear"], ["get", "n"],
                           1, "#ffd8a8", 10, "#ff922b", 100, "#e8590c", 1000, "#a02c00"],
          "circle-opacity": 0.82,
          "circle-stroke-width": 0.6, "circle-stroke-color": "rgba(0,0,0,.35)",
        },
      });
      karte.on("click", "foto-wolke-punkt", (e) => {
        const p = e.features && e.features[0];
        if (p) wolkeGeklickt(p.geometry.coordinates, p.properties.n);
      });
      karte.on("mouseenter", "foto-wolke-punkt", () => { karte.getCanvas().style.cursor = "pointer"; });
      karte.on("mouseleave", "foto-wolke-punkt", () => { karte.getCanvas().style.cursor = ""; });
      punkteLaden();
      if (spurenAn) spurenLaden();
    });
  }

  const leer = () => ({ type: "FeatureCollection", features: [] });

  async function punkteLaden() {
    const r = await api().fotos_punkte(filter, 3).catch(() => null);
    const punkte = (r && r.punkte) || [];
    const daten = {
      type: "FeatureCollection",
      features: punkte.map(p => ({
        type: "Feature", properties: { n: p.n },
        geometry: { type: "Point", coordinates: [p.lon, p.lat] },
      })),
    };
    const hint = document.getElementById("foto-karte-hint");
    if (hint) {
      const summe = punkte.reduce((a, p) => a + p.n, 0);
      hint.textContent = punkte.length
        ? T("fotos.karte_hint", "{n} Dateien mit Koordinate an {o} Stellen")
            .replace("{n}", num(summe)).replace("{o}", num(punkte.length))
        : T("fotos.karte_leer", "Keine dieser Dateien hat eine Koordinate.");
    }
    if (!karte || !karteBereit) return;
    const q = karte.getSource("foto-wolke");
    if (q) q.setData(daten);
    if (punkte.length) {
      try {
        const b = new karteLib.LngLatBounds();
        punkte.forEach(p => b.extend([p.lon, p.lat]));
        karte.fitBounds(b, { padding: 60, maxZoom: 12, duration: 0 });
      } catch (_) {}
    }
  }

  async function spurenLaden() {
    if (!karte || !karteBereit) return;
    const q = karte.getSource("foto-spuren");
    if (!q) return;
    if (!spurenAn) { q.setData(leer()); return; }
    const r = await api().library_query({ limit: 400, with_thumbs: false }).catch(() => null);
    const items = (r && r.items) || [];
    q.setData({
      type: "FeatureCollection",
      features: items.filter(it => it.geom && it.geom.length > 1).map(it => ({
        type: "Feature", properties: { name: it.name || "" },
        geometry: { type: "LineString", coordinates: it.geom },
      })),
    });
  }

  /** Klick in die Wolke: welche Dateien liegen hier, und aus welcher Tour? */
  async function wolkeGeklickt(coords, n) {
    const [lon, lat] = coords;
    const box = document.getElementById("lib-detail");
    if (!box) return;
    const r = await api().fotos_abfrage({
      filter: Object.assign({}, filter, { gps: "mit" }), limit: 500, mit_thumbs: false,
    }).catch(() => null);
    const nahe = ((r && r.fotos) || []).filter(f =>
      Math.abs((f.lat || 0) - lat) < 0.002 && Math.abs((f.lon || 0) - lon) < 0.002);
    box.hidden = false;
    box.innerHTML = `
      <div class="foto-detail">
        <div class="foto-detail-kopf">${T("fotos.stelle", "Diese Stelle")}</div>
        <div class="muted">${num(n)} ${T("fotos.stueck", "Dateien")} · ${lat.toFixed(4)}, ${lon.toFixed(4)}</div>
        <div id="foto-stelle-liste" style="margin-top:10px"></div>
      </div>`;
    const liste = box.querySelector("#foto-stelle-liste");
    if (!liste) return;
    if (!nahe.length) {
      liste.textContent = T("fotos.stelle_leer", "Keine Einzeldateien geladen — Filter enger setzen.");
      return;
    }
    const zeiten = nahe.map(f => f.aufnahme_utc).filter(Boolean);
    let tourText = "";
    if (zeiten.length) {
      const tr = await api().fotos_touren({
        von_utc: Math.min.apply(null, zeiten) - 60, bis_utc: Math.max.apply(null, zeiten) + 60,
      }).catch(() => null);
      const echte = ((tr && tr.touren) || []).filter(g => !g.ohne_tour);
      tourText = echte.length
        ? T("fotos.stelle_touren", "Hier war: {t}").replace("{t}", echte.map(g => g.name).join(", "))
        : T("fotos.stelle_keine_tour", "Zu dieser Zeit ist keine Tour aufgezeichnet.");
    }
    liste.innerHTML = `${tourText ? `<div class="foto-detail-zeile">${esc(tourText)}</div>` : ""}
      <div class="foto-raster">${nahe.slice(0, 24).map((f, i) => kachelHtml(f, i)).join("")}</div>`;
    liste.querySelectorAll("[data-foto]").forEach(b => {
      b.onclick = () => detailZeigen(nahe[+b.dataset.foto]);
    });
  }

  // ── Detailspalte ────────────────────────────────────────────────────────

  /* Was erkannt wurde und wie es zu lösen ist — in dieser Reihenfolge, denn
     „keine Koordinate" allein hilft niemandem (Marc, 12.09.2026: „anzeigen was
     für probleme gemeldet werden und ob wir die lösen können"). Der Kern liefert
     nur Schlüssel, der Text steht hier. */
  function befundText(b) {
    const tour = b.tour || "";
    switch (b.key) {
      case "datei_weg":
        return [T("fotos.b_weg", "Datei nicht erreichbar"),
                T("fotos.b_weg_hilfe", "Laufwerk verbinden und neu einlesen. Aufnahmedaten und Vorschau liegen in der Bibliothek, sie bleiben sichtbar.")];
      case "lesefehler":
        return [T("fotos.b_fehler", "Aufnahmedaten nicht lesbar") + (b.text ? " — " + b.text : ""),
                T("fotos.b_fehler_hilfe", "Beim nächsten Einlesen wird es erneut versucht.")];
      case "keine_zeit":
        return [T("fotos.b_zeit", "Keine Aufnahmezeit im Bild"),
                T("fotos.b_zeit_hilfe", "Ohne Zeit lässt sich weder Tour noch Ort zuordnen. Nachtragen geht erst mit dem EXIF-Editor — der ist geplant.")];
      case "zeitzone_geraten":
        return [T("fotos.b_tz", "Zeitzone geraten (UTC angenommen)"),
                b.loesbar
                  ? T("fotos.b_tz_hilfe_tour", "Der Geotagger rechnet sie aus dem Track „{t}“ aus.").replace("{t}", tour)
                  : T("fotos.b_tz_hilfe", "Mit einem Track zu dieser Zeit wäre sie berechenbar.")];
      case "keine_koordinate":
        return [T("fotos.b_ort", "Keine Koordinate im Bild"),
                b.loesbar
                  ? T("fotos.b_ort_hilfe_tour", "Zu dieser Zeit läuft der Track „{t}“ — der Geotagger kann das Bild damit verorten.").replace("{t}", tour)
                  : T("fotos.b_ort_hilfe", "Kein aufgezeichneter Track deckt diese Zeit ab. Verorten über Zeitnachbarn ist geplant.")];
      default:
        return [b.key, ""];
    }
  }

  function befundeHtml(befunde) {
    if (!befunde || !befunde.length) {
      return `<div class="foto-befund is-ok">✓ ${T("fotos.b_keine", "Nichts zu beanstanden — Zeit und Ort sind vollständig.")}</div>`;
    }
    return befunde.map((b) => {
      const [was, wie] = befundText(b);
      const punkt = b.stufe === "rot" ? "#e53935" : b.stufe === "gelb" ? "#d4a017" : "var(--text-muted)";
      const knopf = (b.aktion === "geotagger" && b.loesbar)
        ? `<button type="button" class="btn btn-sm foto-befund-tun" data-tun="geotagger"
             data-tour="${esc(b.tour_pfad || "")}">${T("fotos.b_verorten", "Im Geotagger verorten")}</button>` : "";
      return `<div class="foto-befund">
          <div class="foto-befund-kopf"><span class="foto-befund-punkt" style="background:${punkt}"></span>
            <span>${esc(was)}</span></div>
          ${wie ? `<div class="foto-befund-hilfe">${b.loesbar ? "→ " : ""}${esc(wie)}</div>` : ""}
          ${knopf}
        </div>`;
    }).join("");
  }

  /** Die kleine Karte: wo das Bild entstand, und die Tour dazu. */
  function detailKarte(d, tour) {
    const el = document.getElementById("foto-d-karte");
    if (!el || typeof createMap !== "function") return;
    const hatOrt = d.lat != null && d.lon != null;
    const linie = (tour && tour.geom && tour.geom.length > 1) ? tour.geom : null;
    if (!hatOrt && !linie) { el.hidden = true; return; }
    el.hidden = false;
    let lib = null;
    try {
      const created = createMap({
        container: "foto-d-karte",
        styleKey: (typeof mapDefaultStyle === "function") ? mapDefaultStyle() : undefined,
        common: { center: hatOrt ? [+d.lon, +d.lat] : linie[0], zoom: hatOrt ? 12 : 8,
                  attributionControl: false, interactive: true },
      });
      dKarte = created.map; lib = created.lib;
      window.__fotoDKarte = dKarte;          // Prüfstand
    } catch (_) { return; }
    const m = dKarte;
    m.on("load", () => {
      if (linie) {
        m.addSource("d-spur", { type: "geojson",
          data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: linie } } });
        m.addLayer({ id: "d-spur-linie", type: "line", source: "d-spur",
                     layout: { "line-cap": "round", "line-join": "round" },
                     paint: { "line-color": "#2f7fd1", "line-width": 3, "line-opacity": 0.9 } });
      }
      if (hatOrt) {
        m.addSource("d-punkt", { type: "geojson",
          data: { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [+d.lon, +d.lat] } } });
        m.addLayer({ id: "d-punkt-kreis", type: "circle", source: "d-punkt",
                     paint: { "circle-radius": 7, "circle-color": "#ff922b",
                              "circle-stroke-width": 2, "circle-stroke-color": "#fff" } });
      }
      // Ausschnitt: das Bild UND seine Tour, damit man beides im Zusammenhang sieht.
      try {
        const b = new lib.LngLatBounds();
        if (linie) linie.forEach((c) => b.extend(c));
        if (hatOrt) b.extend([+d.lon, +d.lat]);
        m.fitBounds(b, { padding: 28, maxZoom: hatOrt && !linie ? 13 : 12, duration: 0 });
      } catch (_) {}
    });
  }

  function detailKarteWeg() {
    if (!dKarte) return;
    try { dKarte.remove(); } catch (_) {}
    dKarte = null;
  }

  async function detailZeigen(f) {
    if (!f) return;
    auswahl = f.path;
    const box = document.getElementById("lib-detail");
    if (!box) return;
    box.hidden = false;
    detailKarteWeg();
    box.innerHTML = `<div class="foto-detail"><div class="muted">${T("common.loading", "Lädt …")}</div></div>`;
    const r = await api().fotos_details(f.path).catch(() => null);
    const d = (r && r.ok && r.foto) || f;
    const m = maengel(d);
    const zeile = (label, wert) => wert
      ? `<div class="foto-detail-zeile"><span class="muted">${esc(label)}</span> ${esc(wert)}</div>` : "";
    const tags = (d.tags && Object.keys(d.tags)) || [];
    const tour = d.tour || null;
    const befunde = d.befunde || null;
    box.innerHTML = `
      <div class="foto-detail">
        ${d.thumb_url ? `<img class="foto-detail-bild" src="${d.thumb_url}" alt="">` : ""}
        <div class="foto-detail-kopf">${esc(d.dateiname || "")}</div>
        ${befunde ? befundeHtml(befunde)
                  : (m.length ? `<div class="foto-detail-warn">⚠ ${esc(m.join(" · "))}</div>` : "")}
        <div class="foto-d-karte" id="foto-d-karte" hidden></div>
        ${tour ? `<div class="foto-detail-zeile"><span class="muted">${T("fotos.d_tour", "Tour")}</span>
            <button type="button" class="foto-d-tour" data-tour="${esc(tour.path || "")}">${esc(tour.name || "")}</button></div>` : ""}
        ${zeile(T("fotos.d_zeit", "Aufnahme"), d.tag_lokal ? `${d.tag_lokal} ${uhrzeit(d)}${d.tz_bekannt ? "" : " (" + T("fotos.geraten", "geraten") + ")"}` : "")}
        ${zeile(T("fotos.d_kamera", "Kamera"), d.kamera)}
        ${zeile(T("fotos.d_objektiv", "Objektiv"), d.objektiv)}
        ${zeile(T("fotos.d_werte", "Werte"), [d.brennweite, d.blende, d.belichtung, d.iso && "ISO " + d.iso].filter(Boolean).join(" · "))}
        ${zeile(T("fotos.d_groesse", "Größe"), d.breite && d.hoehe ? `${d.breite} × ${d.hoehe}` : "")}
        ${zeile(T("fotos.d_dauer", "Dauer"), dauerText(d.dauer_s))}
        ${zeile(T("fotos.d_ort", "Ort"), [d.ort, d.region, d.land].filter(Boolean).join(", "))}
        ${zeile(T("fotos.d_koordinate", "Koordinate"), (d.lat != null && d.lon != null) ? `${(+d.lat).toFixed(5)}, ${(+d.lon).toFixed(5)}` : "")}
        ${zeile(T("fotos.d_stichworte", "Stichwörter"), d.stichworte)}
        ${zeile(T("fotos.d_pfad", "Liegt in"), d.ordner)}
        ${tags.length ? `
          <details class="foto-detail-tags">
            <summary>${T("fotos.d_alle_tags", "Alle Aufnahmedaten")} (${tags.length})</summary>
            <div class="foto-tagliste">${tags.sort().map(k =>
              `<div class="foto-tagzeile"><span class="muted">${esc(k)}</span> ${esc(d.tags[k])}</div>`).join("")}</div>
          </details>` : ""}
      </div>`;
    document.querySelectorAll(".foto-kachel.is-on").forEach(el => el.classList.remove("is-on"));
    detailKarte(d, tour);
    const tunKnopf = box.querySelector('[data-tun="geotagger"]');
    if (tunKnopf) tunKnopf.onclick = () => verortenStarten(d, tunKnopf.dataset.tour || "");
    const tourKnopf = box.querySelector(".foto-d-tour");
    if (tourKnopf) tourKnopf.onclick = () => tourOeffnen(tourKnopf.dataset.tour || "");
  }

  /** „Im Geotagger verorten": Track laden, Modul wechseln, Ordner übergeben. */
  async function verortenStarten(d, tourPfad) {
    const ordnerPfad = d.ordner || "";
    if (window.rzStatus) {
      window.rzStatus.start("foto-verorten", {
        titel: T("fotos.b_verorten", "Im Geotagger verorten"),
        text: T("fotos.verorten_track", "Track laden …"),
      });
    }
    try {
      if (tourPfad && typeof window.loadGlobalGpx === "function") {
        await window.loadGlobalGpx(tourPfad, { stumm: true });
      }
      if (typeof switchMod === "function") switchMod("geotagger");
      if (window.rzStatus) {
        window.rzStatus.schritt("foto-verorten",
          { text: T("fotos.verorten_ordner", "Fotos einlesen …") });
      }
      // Kleine Pause: das Modul muss erst stehen, bevor es den Ordner liest.
      await new Promise((r) => setTimeout(r, 350));
      if (ordnerPfad && typeof window.__rzGtOrdnerLaden === "function") {
        await window.__rzGtOrdnerLaden(ordnerPfad, false);
      }
      if (window.rzStatus) window.rzStatus.fertig("foto-verorten", "");
    } catch (e) {
      if (window.rzStatus) window.rzStatus.fehler("foto-verorten", String(e && e.message ? e.message : e));
    }
  }

  async function tourOeffnen(pfad) {
    if (!pfad || typeof window.loadGlobalGpx !== "function") return;
    const ok = await window.loadGlobalGpx(pfad, { stumm: true });
    if (ok !== false && typeof switchMod === "function") switchMod("animator");
  }

  // ── Gerüst ──────────────────────────────────────────────────────────────

  function zeichnen() {
    if (!haupt) return;
    haupt.innerHTML = leisteHtml() + kopfHtml() + `<div class="foto-body" id="foto-body"></div>`;
    const box = haupt.querySelector("#foto-body");

    const suche = haupt.querySelector("#foto-suche");
    if (suche) {
      let tmr = 0;
      suche.oninput = () => {
        clearTimeout(tmr);
        tmr = setTimeout(() => { filter.suche = suche.value.trim(); neuLaden(); }, 260);
      };
    }
    const bind = (id, feld) => {
      const el = haupt.querySelector(id);
      if (el) el.onchange = () => {
        const v = el.value;
        if (v) filter[feld] = (feld === "jahr") ? +v : v; else delete filter[feld];
        navZeichnen();
        neuLaden();
      };
    };
    bind("#foto-jahr", "jahr");
    bind("#foto-kamera", "kamera");
    bind("#foto-gps", "gps");
    const reset = haupt.querySelector("#foto-reset");
    if (reset) reset.onclick = () => { filter = {}; navZeichnen(); neuLaden(); };
    haupt.querySelectorAll("[data-fview]").forEach(b => {
      b.onclick = () => {
        if (ansicht === b.dataset.fview) return;
        ansicht = b.dataset.fview;
        zeichnen();
      };
    });

    if (ansicht === "karte") karteZeichnen(box);
    else if (ansicht === "touren") tourenZeichnen(box);
    else rasterZeichnen(box);
  }

  async function mount(hauptEl, navEl) {
    haupt = hauptEl; nav = navEl; angemeldet = true;
    haupt.innerHTML = `<div class="lib-detail-empty" style="padding:20px">${T("common.loading", "Lädt …")}</div>`;
    const r = await api().fotos_ordner().catch(() => null);
    if (!angemeldet) return;
    if (r && r.ok) { ordner = r.ordner || []; stand = r.stand || {}; }
    await filterwerteLaden();
    if (!angemeldet) return;
    navZeichnen();
    await neuLaden(true);
    // Läuft gerade ein Scan (etwa aus einer früheren Sitzung im Hintergrund),
    // zeigt die Leiste ihn sofort an, statt ihn zu verschweigen.
    try {
      const st = await api().fotos_scan_status();
      if (st && st.running) scanBeobachten();
    } catch (_) {}
  }

  function unmount() {
    angemeldet = false;
    clearTimeout(scanTimer);
    if (karte) { try { karte.remove(); } catch (_) {} }
    karte = null; karteLib = null; karteBereit = false;
    haupt = null; nav = null;
  }

  window.rzFotos = { mount, unmount, neuLaden, scanStarten };
})();
