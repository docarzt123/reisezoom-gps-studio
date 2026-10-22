/* Tour-Seite im Archiv (08.10.2026).
 *
 * Ein Doppelklick auf eine Tour (oder „Tour öffnen“, der Tour-Name in den Foto-Details, „Nach Touren“) legt diese Seite
 * über die Tourenliste: links die Tour (Name, Datum, Ort, Werte, Höhenprofil, Logbuch, Aktionen), in der Mitte die Karte
 * mit dem Track und einem Punkt je Foto/Clip, unten der Medienstreifen in Aufnahmereihenfolge, rechts — nur wenn etwas
 * angeklickt ist — die Details des Mediums (die Foto-Detailspalte aus ui/js/fotos.js mit ihren Touren ✕/＋).
 * „← Touren“ oder Esc führt zurück an dieselbe Stelle der Liste. Korrekturen (✕ / ＋ Medien vom selben Tag) gelten überall.
 *
 *   window.rzTourSeite.oeffnen({ geo_hash, path, name }, beiFotoPfad?)  ·  .schliessen()  ·  .offen()
 */
(function () {
  "use strict";
  const T = (k, fb, v) => {
    let s = (typeof t === "function") ? t(k, fb) : fb;
    if (v) for (const [a, b] of Object.entries(v)) s = String(s).split("{" + a + "}").join(b);
    return s;
  };
  // 09.10.2026 — Strich-Symbole statt Emojis (ui/js/icons.js)
  const I = (n, g) => (typeof rzIcon === "function" ? rzIcon(n, { size: g || 14 }) : "");
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = () => (window.pywebview && window.pywebview.api) || {};
  const log = (lvl, m) => { try { if (typeof applog === "function") applog(lvl, "[tourseite] " + m); } catch (_) {} };
  const sprache = () => { try { return (typeof i18nMeta === "function" && i18nMeta().active) || "de"; } catch (_) { return "de"; } };

  let Z = null;   // Zustand der offenen Seite

  function offen() { return !!(Z && Z.seite && Z.seite.isConnected); }
  function neuLaden() { if (offen()) laden(); }

  async function _archivBereit() {
    // Aus einem anderen Modul (oder aus Medien): erst ins Archiv, Bereich Touren
    if (typeof activeMod !== "undefined" && activeMod !== "library" && typeof switchMod === "function") switchMod("library");
    for (let i = 0; i < 60; i++) {
      const seg = document.getElementById("lib-seg-touren");
      if (seg && document.querySelector(".lib-main")) {
        if (!seg.classList.contains("is-on")) { seg.click(); await new Promise(r => setTimeout(r, 120)); continue; }
        return true;
      }
      await new Promise(r => setTimeout(r, 50));
    }
    return !!document.querySelector(".lib-main");
  }

  function _datum(iso) {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(sprache(), { weekday: "short", day: "numeric", month: "long", year: "numeric" });
    } catch (_) { return String(iso).slice(0, 10); }
  }
  function _uhr(iso, tz) {
    if (typeof tourUhrzeitJS === "function") return tourUhrzeitJS(iso, tz, sprache());
    try { return new Date(iso).toLocaleTimeString(sprache(), { hour: "2-digit", minute: "2-digit" }); } catch (_) { return ""; }
  }
  // 19.10.2026 — Datum einer Tour in der Ortszeit ihres Startpunkts (`tag_lokal`), wie Archiv und Datumsbaum;
  // ohne den Archiv-Tag wie bisher aus `started_at`.
  function _datumTour(tr) {
    if (!tr) return "";
    if (typeof tourDatumJS === "function" && tr.tag_lokal) {
      return tourDatumJS(tr, { weekday: "short", day: "numeric", month: "long", year: "numeric" }, sprache());
    }
    return _datum(tr.started_at);
  }
  /** Ende einer Tour als Datum (Ortszeit über den Versatz am Start). */
  function _datumEnde(tr) {
    if (!tr || !tr.ended_at) return "";
    const ms = Date.parse(tr.ended_at);
    if (typeof tr.tz_minuten === "number" && isFinite(ms)) {
      return _datumTour({ tag_lokal: new Date(ms + tr.tz_minuten * 60000).toISOString().slice(0, 10) });
    }
    return _datum(tr.ended_at);
  }
  function _dauer(s) {
    s = Math.max(0, Math.round(+s || 0));
    const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
    return h ? `${h}:${String(m).padStart(2, "0")} h` : `${m} min`;
  }
  const _zahl = (x, n = 0) => (+x).toLocaleString(sprache(), { maximumFractionDigits: n, minimumFractionDigits: n });

  function _profilSvg(profil) {
    const p = (profil || []).filter(x => x[1] != null);
    if (p.length < 2) return "";
    const W = 260, H = 64, xs = p.map(x => x[0]), ys = p.map(x => x[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs) || 1, y0 = Math.min(...ys), y1 = Math.max(...ys);
    const sx = (x) => ((x - x0) / Math.max(1e-6, x1 - x0)) * W, sy = (y) => H - 4 - ((y - y0) / Math.max(1, y1 - y0)) * (H - 10);
    const pfad = p.map((q, i) => `${i ? "L" : "M"}${sx(q[0]).toFixed(1)},${sy(q[1]).toFixed(1)}`).join(" ");
    return `<svg class="ts-profil" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <path d="${pfad} L${W},${H} L0,${H} Z" class="ts-profil-flaeche"/><path d="${pfad}" class="ts-profil-linie"/></svg>
      <div class="ts-profil-achse"><span>${_zahl(y0)} m</span><span>${_zahl(y1)} m</span></div>`;
  }

  // ── Aufbau ──────────────────────────────────────────────────────────────────

  /** 08.10.2026 (Stufe 2) — die Reise als Behälter: mehrere Touren (Sammlung oder Auswahl) auf einer Seite. */
  async function oeffnenReise(pfade, name) {
    pfade = (pfade || []).filter(Boolean);
    if (pfade.length < 1) return false;
    return oeffnen({ name: name || T("reise.ohne_name", "Reise"), reise: pfade }, "");
  }

  async function oeffnen(tour, beiFoto) {
    if (!tour || (!tour.geo_hash && !tour.path && !tour.reise)) return false;
    if (!(await _archivBereit())) { log("warn", "Archiv nicht bereit"); return false; }
    schliessen(true);
    const main = document.querySelector(".lib-main"), nav = document.getElementById("lib-panel");
    if (!main || !nav) return false;
    const seite = document.createElement("div");
    seite.className = "ts-seite";
    seite.innerHTML = `<div class="ts-kopf">
        <button type="button" class="btn btn-sm ts-zurueck" title="${esc(T("tourseite.zurueck_tip", "Zurück zur Tourenliste (Esc)"))}">← ${esc(T("tourseite.zurueck", "Touren"))}</button>
        <b class="ts-titel">${esc(tour.name || "")}</b><span class="ts-unter muted"></span><span class="ts-zahlen"></span></div>

      <div class="ts-karte" id="ts-karte"><div class="ts-laden"><span class="spinner"></span> ${esc(T("tourseite.laedt", "Tour und Medien werden geladen …"))}</div></div>
      <div class="ts-streifen" id="ts-streifen"></div>`;
    main.appendChild(seite);
    main.classList.add("ts-aktiv");
    const links = document.createElement("div");
    links.className = "ts-links";
    links.innerHTML = `<div class="muted ts-laden-klein"><span class="spinner"></span> ${esc(T("common.loading", "Lädt …"))}</div>`;
    nav.appendChild(links);
    nav.classList.add("ts-aktiv");
    const det = document.getElementById("lib-detail");
    Z = { tour, seite, links, map: null, lib: null, daten: null, auswahl: beiFoto || "", marker: {}, detAlt: det ? det.innerHTML : "",
          reiter: "uebersicht", lb: null, lbBox: null, lbPins: {} };
    // 22.10.2026 (Marc: „man braucht eigentlich nur die Möglichkeit, die Seitenleisten und die Leiste unten ein- und
    // auszublenden, so wie im Animator“) — statt der Reiter Übersicht/Logbuch drei Ansichts-Knöpfe, je Gerät gemerkt
    // linke/rechte Leiste schaltet das Archiv selbst (Kopfzeile oben rechts); die Tour-Seite bringt „Bilder unten“ dazu
    { const platz = document.getElementById("lib-ansicht-extra");
      if (platz) {
        platz.innerHTML = `<button type="button" class="ansicht-knopf" data-ts-ansicht="unten" title="${esc(T("tourseite.ansicht_unten", "Bilder unten ein-/ausblenden — ohne Bilder zeigt die Karte die Logbuch-Einträge"))}"><span class="ak-zeit"></span></button>`;
        platz.querySelector("[data-ts-ansicht]").onclick = (ev) => { const a = _ansicht(); a.unten = !a.unten; _ansichtMerken(a); _ansichtAnwenden(); ev.currentTarget.blur(); };
      } }
    // 11.10.2026 (Marc: „rechts ist bei Übersicht alles frei — warum nicht direkt das Logbuch?“) — rechts steht bei
    // einer Tour immer das Logbuch; ein angeklicktes Foto zeigt dort seine Daten mit „← Logbuch“ zurück.
    if (tour.reise) { if (det) det.innerHTML = `<div class="lib-detail-empty">${esc(T("tourseite.detail_leer", "Foto oder Clip anklicken — dann stehen hier seine Aufnahmedaten und seine Touren."))}</div>`; }
    else _logbuchSpalte();
    // aus einer Reise geöffnet: „← Reise“ führt dorthin zurück (statt zur Liste)
    if (tour.vonReise) {
      const z = seite.querySelector(".ts-zurueck");
      z.textContent = "← " + T("reise.zurueck", "Reise");
      z.onclick = () => oeffnenReise(tour.vonReise.pfade, tour.vonReise.name);
    } else seite.querySelector(".ts-zurueck").onclick = () => schliessen();
    log("info", `öffnen ${tour.name || tour.path || tour.geo_hash}`);
    _ansichtAnwenden();
    await laden();
    return true;
  }

  // 22.10.2026 (Marc: „Doppelklick, dauert eine Weile … nochmal Doppelklick auf den gleichen Track, dauert wieder“) —
  // die zuletzt geöffneten Tour-Seiten bleiben in dieser Sitzung gemerkt: beim Wiederöffnen steht die Seite sofort, im
  // Hintergrund wird frisch gelesen und nur neu gezeichnet, wenn sich etwas geändert hat.
  const _seitenMerk = new Map(), SEITEN_MERK = 12;
  const _seitenSchluessel = (t) => t.reise ? "r:" + t.reise : "t:" + (t.path || t.geo_hash || "");
  function _anwenden(zust, r) {
    zust.daten = r;
    if (!zust.tour.reise) zust.tour = Object.assign({}, zust.tour, { geo_hash: r.tour.geo_hash || zust.tour.geo_hash, path: r.tour.path || zust.tour.path });
    _kopfZeichnen(); _linksZeichnen(); _streifenZeichnen(); _karteZeichnen();
    if (zust.auswahl) setTimeout(() => waehlen(zust.auswahl, true), 60);
  }
  async function laden() {
    if (!Z) return;
    const zust = Z;
    const schl = _seitenSchluessel(zust.tour), alt = _seitenMerk.get(schl);
    if (alt) _anwenden(zust, alt.r);
    let r = null;
    try {
      r = zust.tour.reise ? await api().reise_seite_daten(zust.tour.reise, zust.tour.name || "")   // warte-ok: Ladeanzeige in der Seite (bzw. gemerkte Seite)
                          : await api().tour_seite_daten(zust.tour.geo_hash || "", zust.tour.path || "");   // warte-ok: Ladeanzeige in der Seite (bzw. gemerkte Seite)
    } catch (e) { r = { ok: false, error: String(e) }; }
    if (Z !== zust) return;
    if (!r || !r.ok) {
      if (alt) return;   // die gemerkte Seite steht schon — ein Lesefehler im Hintergrund wirft sie nicht weg
      zust.seite.querySelector("#ts-karte").innerHTML = `<div class="ts-laden ts-fehler">${esc((r && r.error) || "?")}</div>`;
      zust.links.innerHTML = "";
      return;
    }
    const json = JSON.stringify(r);
    _seitenMerk.delete(schl); _seitenMerk.set(schl, { r, json });
    while (_seitenMerk.size > SEITEN_MERK) _seitenMerk.delete(_seitenMerk.keys().next().value);
    if (alt && alt.json === json) return;   // nichts geändert — nicht noch einmal zeichnen
    _anwenden(zust, r);
  }

  function _name(tr) { return tr.display_name || tr.name || tr.filename || ""; }
  /** 19.10.2026 — [erster Tag, letzter Tag] einer Reise in Ortszeit (erste Tour Start, letzte Tour Ende). */
  function _reiseSpanne(d) {
    const t = (d.touren || []).map(x => x.tour).filter(Boolean);
    if (!t.length) return [d.von ? _datum(d.von) : "", d.bis ? _datum(d.bis) : ""];
    return [_datumTour(t[0]), _datumEnde(t[t.length - 1]) || _datumTour(t[t.length - 1])];
  }

  function _kopfZeichnen() {
    const d = Z.daten, tr = d.tour;
    if (Z.tour.reise) {
      Z.seite.querySelector(".ts-titel").innerHTML = I("compass", 18) + " " + esc(d.name || Z.tour.name || "");
      const _r = _reiseSpanne(d);
      Z.seite.querySelector(".ts-unter").textContent = [_r[0], _r[1] && _r[1] !== _r[0] ? "– " + _r[1] : ""].filter(Boolean).join(" ");
      Z.seite.querySelector(".ts-zahlen").innerHTML = `${I("route", 13)} ${(d.touren || []).length} · ${I("camera", 13)} ${d.n_foto || 0} · ${I("clapperboard", 13)} ${d.n_video || 0}`;
      return;
    }
    Z.seite.querySelector(".ts-titel").textContent = _name(tr) || Z.tour.name || "";
    Z.seite.querySelector(".ts-unter").textContent = [_datumTour(tr), [tr.place, tr.region, tr.country].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
    Z.seite.querySelector(".ts-zahlen").innerHTML = `${I("camera", 13)} ${d.n_foto || 0} · ${I("clapperboard", 13)} ${d.n_video || 0}`;
  }

  function _linksZeichnenReise() {
    const d = Z.daten, rs = _reiseSpanne(d);
    const werte = [
      [T("tourseite.w_distanz", "Distanz"), d.distance_m ? _zahl(d.distance_m / 1000, 1) + " km" : ""],
      [T("tourseite.w_dauer", "Dauer"), d.duration_s ? _dauer(d.duration_s) : ""],
      [T("tourseite.w_aufstieg", "Aufstieg"), d.ascent_m ? "↑ " + _zahl(d.ascent_m) + " m" : ""],
      [T("reise.touren", "Touren"), String((d.touren || []).length)],
    ].filter(x => x[1]);
    Z.links.innerHTML = `
      <div class="ts-l-name">${I("compass", 16)} ${esc(d.name || Z.tour.name || "")}</div>
      <div class="ts-l-zeile">${I("calendar", 13)} ${esc(rs[0])}${rs[1] && rs[1] !== rs[0] ? " – " + esc(rs[1]) : ""}</div>
      ${werte.length ? `<div class="ts-werte">${werte.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}</div>` : ""}
      <div class="ts-reise-touren">${(d.touren || []).map((x, i) => `<button type="button" class="ts-reise-tour" data-i="${i}">
          <span class="ts-reise-farbe" style="background:${FARBEN[i % FARBEN.length]}"></span>
          <span class="ts-reise-name">${esc(x.tour.display_name || x.tour.name || x.tour.filename || "")}</span>
          <small>${esc(_datumTour(x.tour).replace(/^\w+\.?,?\s*/, ""))}${x.tour.distance_m ? " · " + _zahl(x.tour.distance_m / 1000, 1) + " km" : ""}${(x.n_foto || x.n_video) ? " · " + I("camera", 12) + " " + (x.n_foto + x.n_video) : ""}</small></button>`).join("")}</div>
      <div class="ts-aktionen">
        <button type="button" class="btn btn-primary btn-sm" id="ts-video">${I("clapperboard")} ${esc(T("reise.video", "Reise-Video …"))}</button>
        <button type="button" class="btn btn-sm" id="ts-export">${I("share")} ${esc(T("tourseite.export", "Exportieren …"))}</button>
      </div>
      <div class="lib-hint ts-hinweis">${esc(T("reise.hinweis", "Ein Klick auf eine Tour öffnet ihre eigene Tour-Seite. „Reise-Video“ führt die Touren zu einem Video zusammen."))}</div>`;
    Z.links.querySelectorAll(".ts-reise-tour").forEach(b => {
      const x = d.touren[+b.dataset.i];
      b.onclick = () => oeffnen({ geo_hash: x.tour.geo_hash, path: x.tour.path, name: x.tour.display_name || x.tour.name || "",
                                  vonReise: { pfade: Z.tour.reise, name: Z.tour.name } });
      b.onmouseenter = () => _linieHervor(+b.dataset.i, true);
      b.onmouseleave = () => _linieHervor(+b.dataset.i, false);
    });
    Z.links.querySelector("#ts-video").onclick = () => { if (typeof window.__rzLibZusammenfuehren === "function") window.__rzLibZusammenfuehren(Z.tour.reise); };
    Z.links.querySelector("#ts-export").onclick = (e) => {
      const ex = window.rzArchivExport; if (!ex) return;
      const m = (d.medien || []).map(x => x.path);
      _menue(e.currentTarget, [
        { text: "🧭 " + T("export.menue_touren", "Alle Touren der Reise …"), tun: () => ex.touren(Z.tour.reise, d.name || "") },
        { text: "📷 " + T("export.menue_medien_reise", "Fotos und Clips der Reise ({n}) …", { n: m.length }), tun: () => { if (m.length) ex.medien(m); } },
      ]);
    };
  }

  function _linksZeichnen() {
    if (Z.tour.reise) return _linksZeichnenReise();
    const d = Z.daten, tr = d.tour;
    const werte = [
      [T("tourseite.w_distanz", "Distanz"), tr.distance_m ? _zahl(tr.distance_m / 1000, 1) + " km" : ""],
      [T("tourseite.w_dauer", "Dauer"), tr.duration_s ? _dauer(tr.duration_s) : ""],
      [T("tourseite.w_aufstieg", "Aufstieg"), tr.ascent_m ? "↑ " + _zahl(tr.ascent_m) + " m" : ""],
      [T("tourseite.w_hoechster", "Höchster Punkt"), tr.ele_max != null ? _zahl(tr.ele_max) + " m" : ""],
    ].filter(x => x[1]);
    const zeit = tr.started_at ? `${_uhr(tr.started_at, tr.tz_minuten)}${tr.ended_at ? "–" + _uhr(tr.ended_at, tr.tz_minuten) : ""}` : "";
    Z.links.innerHTML = `
      <div class="ts-l-name">${esc(_name(tr))}</div>
      <div class="ts-l-zeile">${I("calendar", 13)} ${esc(_datumTour(tr))}${zeit ? ` · ${esc(zeit)}` : ""}</div>
      ${tr.place || tr.region || tr.country ? `<div class="ts-l-zeile">${I("map-pin", 13)} ${esc([tr.place, tr.region, tr.country].filter(Boolean).join(", "))}</div>` : ""}
      ${werte.length ? `<div class="ts-werte">${werte.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}</div>` : ""}
      ${_profilSvg(d.profil)}
      <div class="ts-logbuch" id="ts-logbuch" hidden></div>
      <div class="ts-aktionen">
        <button type="button" class="btn btn-primary btn-sm" id="ts-video">${I("clapperboard")} ${esc(T("tourseite.video", "Video"))} ▾</button>
        <button type="button" class="btn btn-sm" id="ts-karte-knopf">${I("map")} ${esc(T("tourseite.karte", "Karte als Bild"))}</button>
        <button type="button" class="btn btn-sm" id="ts-export">${I("share")} ${esc(T("tourseite.export", "Exportieren …"))}</button>
        <button type="button" class="btn btn-sm" id="ts-plus">＋ ${esc(T("tourseite.plus_tag", "Medien vom selben Tag …"))}</button>
        <button type="button" class="btn btn-sm" id="ts-auto" title="${esc(T("tourseite.auto_tip", "Alle Fotos der Tour automatisch aufhübschen (Ton und Weißabgleich je Foto) — Originale bleiben, nachher einzeln nacharbeiten"))}">${I("sparkles")} ${esc(T("tourseite.auto", "Auto für alle Fotos"))}</button>
      </div>
      <div class="ts-dokumente" id="ts-dokumente"></div>
      <div class="lib-hint ts-hinweis">${esc(T("tourseite.hinweis", "Zur Tour gehört, was während der Tour aufgenommen wurde und höchstens 2 km vom Track entfernt liegt (ohne Koordinate zählt die Zeit). Rechtsklick auf ein Bild nimmt es heraus, „＋ Medien vom selben Tag“ nimmt weitere dazu — das gilt dann überall in GPS Studio."))}</div>`;
    Z.links.querySelector("#ts-video").onclick = (e) => _videoMenue(e.currentTarget);
    Z.links.querySelector("#ts-karte-knopf").onclick = () => _oeffnenIn("tourmap");
    Z.links.querySelector("#ts-export").onclick = (e) => {
      const ex = window.rzArchivExport; if (!ex) return;
      const m = (Z.daten.medien || []).map(x => x.path);
      _menue(e.currentTarget, [
        { text: "🧭 " + T("export.menue_track", "Track …"), tip: T("export.menue_track_tip", "GPX, KML, KMZ, TCX, GeoJSON, CSV oder als Projekt"), tun: () => ex.touren([Z.tour.path], _name(tr)) },
        { text: "📷 " + T("export.menue_medien", "Fotos und Clips der Tour ({n}) …", { n: m.length }), tun: () => { if (m.length) ex.medien(m); } },
      ]);
    };
    Z.links.querySelector("#ts-plus").onclick = () => plusTag();
    // 09.10.2026 (Marcs Wunsch „Fotos einer Tour automatisch aufhübschen“)
    Z.links.querySelector("#ts-auto").onclick = async () => {
      const fotos = (Z.daten.medien || []).filter(x => x.art !== "video").map(x => x.path);
      if (!fotos.length) return;
      const ja = await window.rzConfirm(T("tourseite.auto", "Auto für alle Fotos"),
        T("tourseite.auto_frage", "{n} Fotos dieser Tour bekommen Auto-Ton und Auto-Weißabgleich. Die Originale bleiben unverändert; jedes Foto lässt sich danach einzeln nacharbeiten oder zurücksetzen.", { n: fotos.length }),
        T("tourseite.auto_los", "Aufhübschen"), false);
      if (!ja) return;
      const r = await rzWarten("foto_rezept_speichern", () => api().foto_rezept_speichern(fotos, { auto: true })).catch(() => null);
      // 09.10.2026 — überall die bearbeitete Fassung: Animator-Bilder neu, Bildstreifen der Seite neu
      if (r && r.ok) { window.dispatchEvent(new CustomEvent("rz-rezept-geaendert", { detail: { pfade: fotos } })); try { neuLaden(); } catch (e) { console.warn("[tourseite] neu laden nach Auto:", e); } }
      if (r && r.ok) { if (typeof toast === "function") toast(T("bearb.n_ok", "{n} Fotos bearbeitet — die Originale bleiben unverändert.", { n: fotos.length }), "success", 4000); }
      else if (typeof toast === "function") toast((r && r.error) || "?", "warn");
    };
    _logbuch(tr.path);
    _dokumente(tr.path);
    if (!Z.links.__rzDokDrop && typeof setupDropZone === "function") {
      Z.links.__rzDokDrop = true;
      setupDropZone({ target: Z.links, accept: DOK_ENDUNGEN, highlightClass: "ts-dok-ziel",
        onDrop: async (dateien) => {
          const pfade = (dateien || []).map(x => x.nativePath).filter(Boolean);   // nur echte Pfade — _drops-Kopien sind Temp
          if (!pfade.length) { if (typeof toast === "function") toast(T("dok.drop_kein_pfad", "Diese Datei lässt sich nicht verknüpfen — bitte über „＋ Dokument …“ wählen."), "warn", 5000); return; }
          if (Z && Z.tour && Z.tour.path) await _dokHinzu(Z.tour.path, pfade);
        } });
    }
  }

  /* 12.10.2026 (Marc: „wenn es zur Tour gehört, gehört es dazu“) — Dokumente zur Tour: PDF-Ankündigungen,
     Routenbeschreibungen, Tickets, Notizen. Nur verknüpft (Datei bleibt, wo sie ist, wird nie verändert), der Text kommt in
     die Archiv-Suche (core/dokumente). Hinzufügen per Knopf oder Ziehen auf die linke Spalte; Klick öffnet im
     zuständigen Programm, ⋯ zeigt im Finder oder löst die Verknüpfung. */
  const DOK_ENDUNGEN = ["pdf", "txt", "md", "markdown", "rtf", "doc", "docx", "odt", "pages", "xls", "xlsx", "ods", "numbers", "csv", "html", "htm", "webloc", "url"];
  const DOK_SYMBOL = { pdf: "file-text", text: "file-text", word: "file-text", tabelle: "table", web: "globe", bild: "image", datei: "file-text" };
  const _groesse = (b) => b >= 1048576 ? _zahl(b / 1048576, 1) + " MB" : (b >= 1024 ? Math.round(b / 1024) + " KB" : (b || 0) + " B");
  async function _dokumente(path, liste) {
    const box = Z && Z.links && Z.links.querySelector("#ts-dokumente"); if (!box || !path) return;
    const kopf = `<div class="ts-dok-kopf"><span>${I("file-text", 13)} ${esc(T("dok.titel", "Dokumente"))}</span>
      <button type="button" class="btn btn-sm btn-ghost" id="ts-dok-plus" title="${esc(T("dok.plus_tip", "PDF, Text, Word … an diese Tour hängen. Die Datei bleibt, wo sie ist."))}">＋ ${esc(T("dok.plus", "Dokument …"))}</button></div>`;
    if (!liste) {
      box.innerHTML = kopf + `<div class="lib-nav-hint"><span class="ass-spinner"></span> ${esc(T("dok.laedt", "Dokumente werden geladen …"))}</div>`;
      let r = null; try { r = await api().tour_dokumente(path); } catch (_) {}   // warte-ok: Ladeanzeige im Kasten
      if (!Z || !box.isConnected || Z.tour.path !== path) return;
      liste = (r && r.ok && r.dokumente) || [];
    }
    box.innerHTML = kopf + (liste.length ? `<div class="ts-dok-liste">${liste.map((d, i) => `
        <div class="ts-dok${d.fehlt ? " ist-weg" : ""}" data-dok="${i}" title="${esc(d.pfad)}">
          <span class="ts-dok-bild" data-dok-bild="${i}">${I(DOK_SYMBOL[d.art] || "file-text", 18)}</span>
          <span class="ts-dok-text"><b>${esc(d.name)}</b><small>${esc(d.fehlt ? T("dok.fehlt", "nicht gefunden — Laufwerk ab oder verschoben?") : _groesse(d.groesse))}</small></span>
          <button type="button" class="btn btn-sm btn-ghost ts-dok-mehr" data-dok-mehr="${i}" aria-label="${esc(T("dok.mehr", "Mehr"))}">${I("ellipsis", 14)}</button>
        </div>`).join("")}</div>`
      : `<div class="lib-hint ts-dok-leer">${esc(T("dok.leer", "Ankündigung, Routenbeschreibung, Tickets … — hierher ziehen oder „＋ Dokument …“. Ihr Text wird in der Archiv-Suche gefunden."))}</div>`);
    box.querySelector("#ts-dok-plus").onclick = async () => {
      let res = null;
      try { res = await api().pick_file("open", [T("dok.filter", "Dokumente") + " (" + DOK_ENDUNGEN.map(e => "*." + e).join(";") + ")"], true); } catch (_) {}   // warte-ok: Systemdialog
      const pfade = Array.isArray(res) ? res.filter(Boolean) : (res ? [res] : []);
      if (pfade.length) await _dokHinzu(path, pfade);
    };
    box.querySelectorAll("[data-dok]").forEach(z => {
      const d = liste[+z.dataset.dok];
      z.onclick = (e) => { if (e.target.closest("[data-dok-mehr]")) return; if (!d.fehlt) api().open_path(d.pfad); };
      z.oncontextmenu = (e) => { e.preventDefault(); _dokMenue(z, path, d); };
    });
    box.querySelectorAll("[data-dok-mehr]").forEach(b => { b.onclick = (e) => { e.stopPropagation(); _dokMenue(b, path, liste[+b.dataset.dokMehr]); }; });
    // Vorschau der ersten Seite nachladen (Quick Look auf dem Mac; sonst bleibt das Symbol)
    liste.forEach((d, i) => {
      if (d.fehlt || !["pdf", "word", "text", "bild", "tabelle"].includes(d.art)) return;
      Promise.resolve(api().tour_dokument_vorschau(d.pfad, 160)).then(r => {   // warte-ok: Symbol bleibt bis dahin
        const el = box.querySelector(`[data-dok-bild="${i}"]`);
        if (el && r && r.ok && r.data) el.innerHTML = `<img src="${r.data}" alt="">`;
      }).catch(() => {});
    });
  }
  async function _dokHinzu(path, pfade) {
    let r = null;
    try { r = await rzWarten("tour_dokumente_hinzu", () => api().tour_dokumente_hinzu(path, pfade)); } catch (e) { r = { ok: false, error: String(e) }; }
    if (!r || !r.ok) { if (typeof toast === "function") toast((r && r.error) || "?", "warn"); return; }
    if (Z && Z.tour && Z.tour.path === path) _dokumente(path, r.dokumente || []);
    if (typeof toast === "function") {
      const teile = [];
      if (r.neu) teile.push(r.neu === 1 ? T("dok.neu_1", "1 Dokument verknüpft") : T("dok.neu_n", "{n} Dokumente verknüpft", { n: r.neu }));
      if (r.schon) teile.push(T("dok.schon", "{n} waren schon dabei (neu gelesen)", { n: r.schon }));
      if (r.ohne_text) teile.push(T("dok.ohne_text", "{n} ohne lesbaren Text (z. B. eingescannt) — sie zählen nicht für die Suche", { n: r.ohne_text }));
      if (r.fehlt) teile.push(T("dok.nicht_da", "{n} nicht gefunden", { n: r.fehlt }));
      toast(teile.join(" · ") || T("dok.nichts", "Nichts verknüpft"), r.fehlt ? "warn" : "success", 5000);
    }
  }
  function _dokMenue(anker, path, d) {
    if (!d) return;
    _menue(anker, [
      { text: T("dok.oeffnen", "Öffnen"), tun: () => api().open_path(d.pfad) },
      { text: T("dok.finder", "Im Finder zeigen"), tun: () => api().reveal_in_finder(d.pfad) },
      "-",
      { text: T("dok.loesen", "Von der Tour lösen"), tip: T("dok.loesen_tip", "Nur die Verknüpfung — die Datei bleibt unangetastet."), gefahr: true,
        tun: async () => {
          let r = null; try { r = await api().tour_dokument_entfernen(path, d.pfad); } catch (_) {}   // warte-ok: nur Datenbank
          if (r && r.ok) _dokumente(path, r.dokumente || []);
        } },
    ]);
  }

  async function _logbuch(path) {
    const box = Z && Z.links.querySelector("#ts-logbuch"); if (!box || !path) return;
    let r = null; try { r = await api().logbuch_kurz(path); } catch (_) {}   // warte-ok: nur Datenbank, Kasten bleibt bis dahin verborgen
    if (!Z || !box.isConnected || !r || !r.ok || !r.vorhanden) return;
    if (typeof window.__rzLogbuchKurzHtml === "function") { box.innerHTML = window.__rzLogbuchKurzHtml(r); box.hidden = false; }
  }

  async function _oeffnenIn(slug) {
    if (!Z) return;
    const p = Z.tour.path;
    if (typeof window.loadGlobalGpx !== "function") return;
    const ok = await window.loadGlobalGpx(p, { stumm: true });
    if (ok !== false && typeof switchMod === "function") switchMod(slug);
  }

  function _menue(anker, eintraege) {
    document.querySelectorAll(".ts-menue").forEach(x => x.remove());
    const box = document.createElement("div");
    box.className = "lib-ctxmenu ts-menue"; box.setAttribute("role", "menu");
    for (const e of eintraege) {
      if (e === "-") { box.appendChild(document.createElement("hr")); continue; }
      const b = document.createElement("button"); b.type = "button";
      b.className = "lib-ctx-item" + (e.gefahr ? " lib-btn-danger" : "");
      if (typeof rzTextMitSymbol === "function") b.innerHTML = rzTextMitSymbol(e.text); else b.textContent = e.text;   // 09.10.2026 Strich-Symbol
      if (e.tip) b.title = e.tip;
      b.onclick = () => { zu(); try { e.tun(); } catch (err) { log("warn", "Menü: " + err); } };
      box.appendChild(b);
    }
    document.body.appendChild(box);
    const r0 = anker.getBoundingClientRect ? anker.getBoundingClientRect() : { left: anker.x, bottom: anker.y };
    const r = box.getBoundingClientRect();
    box.style.left = Math.max(4, Math.min(r0.left, window.innerWidth - r.width - 6)) + "px";
    box.style.top = Math.max(4, Math.min(r0.bottom + 2, window.innerHeight - r.height - 6)) + "px";
    const aussen = (ev) => { if (!box.contains(ev.target)) zu(); };
    const taste = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); zu(); } };
    function zu() { document.removeEventListener("mousedown", aussen, true); document.removeEventListener("keydown", taste, true); box.remove(); }
    setTimeout(() => { document.addEventListener("mousedown", aussen, true); document.addEventListener("keydown", taste, true); }, 0);
    return box;
  }

  function _videoMenue(knopf) {
    _menue(knopf, [
      { text: "⚡ " + T("schnell.knopf", "Schnell-Video …"), tip: T("schnell.knopf_tip", "Fertiges Tourvideo mit wenigen Entscheidungen."),
        tun: () => { if (window.rzSchnellVideo) window.rzSchnellVideo(Z.tour.path); } },
      { text: "🧭 " + T("assistent.knopf", "Video-Assistent …"), tip: T("va.knopf_tip", "Schritt für Schritt zum eigenen Video: Titel, Art, Karte, Einblendungen, Fotos, Schilder, Kamera, Schluss — alles landet bearbeitbar im Projekt."),
        tun: async () => {
          // Der Animator wird neu aufgebaut — erst die NEUE Fassung des Einstiegs abwarten, dann so lange versuchen, bis
          // die Tour geladen ist (höchstens ~20 s), sonst den Knopf zeigen lassen
          window.__rzVideoAssistent = null;
          await _oeffnenIn("animator");
          for (let i = 0; i < 100; i++) {
            await new Promise(r => setTimeout(r, 200));
            const f = window.__rzVideoAssistent;
            if (typeof f !== "function") continue;
            let ok = false; try { ok = await f(true); } catch (_) { ok = false; }
            if (ok) return;
          }
          if (typeof toast === "function") toast(T("va.nicht_bereit", "Die Tour lädt noch — den Video-Assistenten findest du oben im Animator."), "info", 5000);
        } },
      { text: "🎞 " + T("library.open_animator", "Im Animator öffnen"), tun: () => _oeffnenIn("animator") },
      { text: "📈 " + T("library.open_height", "Daten-Animator"), tun: () => _oeffnenIn("heightanim") },
    ]);
  }

  // ── Medienstreifen ─────────────────────────────────────────────────────────

  function _streifenZeichnen() {
    const box = Z.seite.querySelector("#ts-streifen");
    const m = Z.daten.medien || [];
    if (!m.length) {
      if (Z.tour.reise) {   // Reise: kein „vom selben Tag“ — das gehört zu einer einzelnen Tour
        box.innerHTML = `<div class="ts-streifen-leer muted">${esc(T("reise.keine_medien", "Zu dieser Reise gibt es keine Fotos oder Clips in deinen Medien."))}</div>`;
        return;
      }
      box.innerHTML = `<div class="ts-streifen-leer muted">${esc(T("tourseite.keine_medien", "Zu dieser Tour gibt es keine Fotos oder Clips in deinen Medien."))}
        <button type="button" class="btn btn-sm" data-plus>＋ ${esc(T("tourseite.plus_tag", "Medien vom selben Tag …"))}</button></div>`;
      box.querySelector("[data-plus]").onclick = () => plusTag();
      return;
    }
    box.innerHTML = m.map((x, i) => `<button type="button" class="ts-bild${x.art === "video" ? " ist-video" : ""}${x.quelle === "hand" ? " von-hand" : ""}" data-i="${i}" data-pfad="${esc(x.path)}"
        title="${esc(x.dateiname || "")}${x.tour ? " · " + esc(x.tour) : ""}${x.geschaetzt ? " · " + esc(T("tourseite.lage_geschaetzt", "Lage aus der Aufnahmezeit")) : ""}${x.quelle === "hand" ? " · " + esc(T("tourseite.von_hand", "von dir hinzugefügt")) : ""}">
        <span class="ts-bild-img"></span>${x.art === "video" ? `<span class="ts-bild-art">▶</span>` : ""}${x.quelle === "hand" ? `<span class="ts-bild-hand">＋</span>` : ""}</button>`).join("");
    box.querySelectorAll(".ts-bild").forEach(b => {
      const i = +b.dataset.i;
      b.onclick = () => waehlen(m[i].path);
      b.ondblclick = () => _gross(m[i].path);
      b.onmouseenter = () => _hervor(m[i].path, true);
      b.onmouseleave = () => _hervor(m[i].path, false);
      b.oncontextmenu = (e) => { e.preventDefault(); _bildMenue(e, m[i]); };
    });
    _thumbsLaden(m.map(x => x.path));
  }

  async function _thumbsLaden(pfade) {
    for (let i = 0; i < pfade.length; i += 40) {
      const teil = pfade.slice(i, i + 40);
      let r = null; try { r = await api().fotos_thumbs(teil, false); } catch (_) {}   // warte-ok: Kacheln zeigen bis dahin ihre Fläche
      if (!Z || !r || !r.ok) return;
      for (const [p, url] of Object.entries(r.thumbs || {})) {
        if (!url) continue;
        const el = Z.seite.querySelector(`.ts-bild[data-pfad="${CSS.escape(p)}"] .ts-bild-img`);
        if (el) el.style.backgroundImage = `url("${url}")`;
        const mk = Z.marker[p]; if (mk && mk._el) mk._el.style.backgroundImage = `url("${url}")`;
      }
    }
  }

  function _bildMenue(e, m) {
    _menue({ getBoundingClientRect: () => ({ left: e.clientX, bottom: e.clientY }) }, [
      { text: "🔍 " + T("fotos.gross", "Groß ansehen"), tun: () => _gross(m.path) },
      { text: "⬇ " + T("export.medien_eins", "Exportieren …"), tun: () => { if (window.rzArchivExport) window.rzArchivExport.medien([m.path]); } },
      { text: "✕ " + T("tourseite.raus", "Aus dieser Tour nehmen"), gefahr: true, tip: T("tourseite.raus_tip", "Gehört nicht zu dieser Tour — gilt überall in GPS Studio. Über „＋ Medien vom selben Tag“ holst du es zurück."),
        tun: () => korrigieren([m.path], false) },
      { text: "↗ " + T("oeffnen.ctx_1", "Öffnen mit …"), tun: () => { if (window.rzArchivExport) window.rzArchivExport.oeffnenMit([m.path]); } },
      { text: "📁 " + T("library.reveal", "Im Finder zeigen"), tun: () => { try { api().reveal_in_finder(m.path); } catch (_) {} } },
    ]);
  }

  async function korrigieren(pfade, dazu) {
    if (!Z || !pfade.length) return;
    let r = null;
    let gh = Z.tour.geo_hash;
    if (Z.tour.reise) {
      // in der Reise gehört das Medium zu einer bestimmten Tour
      const m = (Z.daten.medien || []).find(x => x.path === pfade[0]);
      const t = m && (Z.daten.touren || []).find(x => x.tour.path === m.tour_path);
      gh = t ? t.tour.geo_hash : "";
    }
    try { r = await api().tour_medien_korrigieren(gh, pfade, !!dazu); } catch (e) { r = { ok: false, error: String(e) }; }   // warte-ok: schreibt nur eine Zeile
    if (!r || !r.ok) { if (typeof toast === "function") toast((r && r.error) || "?", "error"); return; }
    if (typeof toast === "function") toast(dazu ? T("tourseite.dazu_ok", "{n} zur Tour genommen.", { n: pfade.length }) : T("tourseite.raus_ok", "Aus der Tour genommen."), "info");
    if (Z.auswahl && !dazu && pfade.includes(Z.auswahl)) Z.auswahl = "";
    await laden();
  }

  // ── ＋ Medien vom selben Tag ────────────────────────────────────────────────

  async function plusTag() {
    if (!Z || typeof openModal !== "function") return;
    const gh = Z.tour.geo_hash;
    const m = openModal({ title: "＋ " + T("tourseite.plus_tag_titel", "Medien vom selben Tag"),
      body: `<div class="ts-kand" id="ts-kand"><div class="muted"><span class="spinner"></span> ${esc(T("tourseite.kand_laedt", "Medien des Tages werden gesucht …"))}</div></div>`,
      footer: `<button type="button" class="btn" id="ts-kand-ab">${esc(T("common.cancel", "Abbrechen"))}</button>
               <button type="button" class="btn btn-primary" id="ts-kand-ok" disabled>${esc(T("tourseite.kand_ok", "Zur Tour nehmen"))}</button>` });
    document.getElementById("ts-kand-ab").onclick = () => m.close();
    let r = null; try { r = await api().tour_medien_kandidaten(gh); } catch (e) { r = { ok: false, error: String(e) }; }   // warte-ok: Ladeanzeige im Dialog
    const box = document.getElementById("ts-kand"); if (!box) return;
    if (!r || !r.ok) { box.innerHTML = `<div class="lib-warn">${esc((r && r.error) || "?")}</div>`; return; }
    const liste = r.medien || [];
    if (!liste.length) { box.innerHTML = `<div class="muted">${esc(T("tourseite.kand_leer", "Am Tag dieser Tour gibt es keine weiteren Fotos oder Clips."))}</div>`; return; }
    const GRUND = { zeit: T("tourseite.grund_zeit", "außerhalb der Tourzeit"), fern: T("tourseite.grund_fern", "über 2 km vom Track"),
                    raus: T("tourseite.grund_raus", "von dir herausgenommen") };
    box.innerHTML = `<div class="ts-kand-kopf muted">${esc(T("tourseite.kand_kopf", "{n} Medien vom {tag}, die nicht zur Tour gehören — anhaken, was dazugehört:", { n: liste.length, tag: (r.tage || []).join(", ") }))}</div>
      <div class="ts-kand-raster">${liste.map((x, i) => `<label class="ts-kand-bild" data-pfad="${esc(x.path)}" title="${esc(x.dateiname || "")}">
          <input type="checkbox" data-i="${i}"><span class="ts-bild-img"></span>${x.art === "video" ? `<span class="ts-bild-art">▶</span>` : ""}
          <span class="ts-kand-grund ist-${esc(x.grund)}">${esc(GRUND[x.grund] || "")}</span></label>`).join("")}</div>`;
    const ok = document.getElementById("ts-kand-ok");
    const zaehle = () => { const n = box.querySelectorAll("input:checked").length; ok.disabled = !n; ok.textContent = n ? T("tourseite.kand_ok_n", "{n} zur Tour nehmen", { n }) : T("tourseite.kand_ok", "Zur Tour nehmen"); };
    box.querySelectorAll("input").forEach(c => c.onchange = zaehle);
    ok.onclick = async () => { const p = [...box.querySelectorAll("input:checked")].map(c => liste[+c.dataset.i].path); m.close(); await korrigieren(p, true); };
    // Vorschaubilder
    for (let i = 0; i < liste.length; i += 40) {
      let t2 = null; try { t2 = await api().fotos_thumbs(liste.slice(i, i + 40).map(x => x.path), false); } catch (_) {}   // warte-ok: Kacheln zeigen bis dahin ihre Fläche
      if (!t2 || !t2.ok || !box.isConnected) break;
      for (const [p, url] of Object.entries(t2.thumbs || {})) {
        const el = box.querySelector(`.ts-kand-bild[data-pfad="${CSS.escape(p)}"] .ts-bild-img`);
        if (el && url) el.style.backgroundImage = `url("${url}")`;
      }
    }
  }

  // ── Karte ──────────────────────────────────────────────────────────────────

  // 09.10.2026 — Kartenstil des Archivs gewechselt: Karte neu
  window.addEventListener("rz-archiv-stil", () => { if (Z && Z.daten) _karteZeichnen(); });

  function _karteZeichnen() {
    const host = Z.seite.querySelector("#ts-karte");
    // 08.10.2026 (Durchsicht) — die vorige Karte abbauen: jede Korrektur (✕/＋) lädt neu, und sonst blieb je Laden eine
    // Karte samt WebGL-Kontext im Speicher (ab ~16 verwirft der Browser Kontexte, andere Karten werden schwarz)
    if (Z.map) { try { Z.map.remove(); } catch (_) {} Z.map = null; }
    Z.marker = {};
    host.innerHTML = "";
    const d = Z.daten;
    const reiseTeile = Z.tour.reise ? (d.touren || []).map(x => x.teile || []) : null;
    const teile = reiseTeile ? [].concat(...reiseTeile) : (d.teile || []);
    const alle = [].concat(...teile);
    let bbox = null;
    if (alle.length) {
      const lo = alle.map(c => c[0]), la = alle.map(c => c[1]);
      bbox = { min_lon: Math.min(...lo), max_lon: Math.max(...lo), min_lat: Math.min(...la), max_lat: Math.max(...la) };
    }
    // 22.10.2026 (Marc: „die Tour-Seite lädt die Karte 2×, erst einen kleinen Ausschnitt, dann die ganze Tour“) — gleich
    // mit dem Ausschnitt starten, den das Einpassen nach dem Laden ohnehin nimmt (Strecke + Medien), statt Zoom 11 am Start
    const huelle = alle.concat((d.medien || []).filter(m => m.lat != null && m.lon != null).map(m => [m.lon, m.lat]));
    let start = { center: alle.length ? alle[0] : [10.4, 51.2], zoom: alle.length ? 11 : 4.5 };
    if (huelle.length > 1) {
      const lo = huelle.map(c => c[0]), la = huelle.map(c => c[1]);
      const w = [Math.min(...lo), Math.min(...la)], o = [Math.max(...lo), Math.max(...la)];
      if (o[0] - w[0] > 1e-6 || o[1] - w[1] > 1e-6) start = { bounds: [w, o], fitBoundsOptions: { padding: 50, maxZoom: 15 } };
    }
    let created;
    try {
      created = createMap({ container: host, styleKey: (typeof rzArchivStil === "function") ? rzArchivStil() : ((typeof mapDefaultStyle === "function") ? mapDefaultStyle() : undefined),
        bbox, common: Object.assign({ attributionControl: true }, start) });
    } catch (e) { log("warn", "Karte: " + e); return; }
    Z.map = created.map; Z.lib = created.lib;
    if (typeof rzMassstab === "function") rzMassstab(Z.map);
    if (typeof rzArchivStilWahlHtml === "function") {
      const w = document.createElement("div"); w.className = "ts-karte-stil"; w.innerHTML = rzArchivStilWahlHtml("ts-karte-stil");
      host.appendChild(w); rzArchivStilWahlBinden(w, "ts-karte-stil");
    }
    window.__rzTourSeiteKarte = Z.map;   // Prüfstand
    const map = Z.map, lib = Z.lib, zust = Z;
    map.on("load", () => {
      if (Z !== zust || Z.map !== map) return;
      if (reiseTeile) {
        // je Tour eine Farbe (dieselbe wie in der Liste links)
        map.addSource("ts-spur", { type: "geojson", data: { type: "FeatureCollection", features: reiseTeile.map((t, i) => ({
          type: "Feature", properties: { farbe: FARBEN[i % FARBEN.length], i }, geometry: { type: "MultiLineString", coordinates: t } })) } });
        map.addLayer({ id: "ts-spur-rand", type: "line", source: "ts-spur", layout: { "line-cap": "round", "line-join": "round" },
                       paint: { "line-color": "#0f1a20", "line-width": 6, "line-opacity": 0.55 } });
        map.addLayer({ id: "ts-spur-linie", type: "line", source: "ts-spur", layout: { "line-cap": "round", "line-join": "round" },
                       paint: { "line-color": ["get", "farbe"], "line-width": ["case", ["==", ["get", "i"], -2], 6, 3.5] } });
      } else if (teile.length) {
        map.addSource("ts-spur", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: teile } } });
        map.addLayer({ id: "ts-spur-rand", type: "line", source: "ts-spur", layout: { "line-cap": "round", "line-join": "round" },
                       paint: { "line-color": "#0f1a20", "line-width": 6, "line-opacity": 0.55 } });
        map.addLayer({ id: "ts-spur-linie", type: "line", source: "ts-spur", layout: { "line-cap": "round", "line-join": "round" },
                       paint: { "line-color": "#48d6c4", "line-width": 3.5 } });
        if (typeof rzStartZiel === "function") rzStartZiel(map, lib, teile);
      }
      const b = new lib.LngLatBounds();
      alle.forEach(c => b.extend(c));
      for (const m of d.medien || []) {
        if (m.lat == null || m.lon == null) continue;
        const el = document.createElement("button");
        el.type = "button";
        el.className = "ts-pin" + (m.art === "video" ? " ist-video" : "") + (m.geschaetzt ? " geschaetzt" : "");
        el.title = (m.dateiname || "") + (m.geschaetzt ? " · " + T("tourseite.lage_geschaetzt", "Lage aus der Aufnahmezeit") : "");
        el.onclick = (e) => { e.stopPropagation(); waehlen(m.path); };
        el.ondblclick = (e) => { e.stopPropagation(); _gross(m.path); };
        el.onmouseenter = () => _hervor(m.path, true);
        el.onmouseleave = () => _hervor(m.path, false);
        const mk = new lib.Marker({ element: el, anchor: "bottom" }).setLngLat([+m.lon, +m.lat]).addTo(map);
        mk._el = el;
        Z.marker[m.path] = mk;
        b.extend([+m.lon, +m.lat]);
      }
      try { if (!b.isEmpty()) map.fitBounds(b, { padding: 50, maxZoom: 15, duration: 0 }); } catch (_) {}
      _thumbsLaden((d.medien || []).map(x => x.path));
      if (Z.reiter === "logbuch") _lbPinsSetzen();   // 11.10.2026 — nach Neuladen die Logbuch-Pins wieder setzen
    });
  }

  // Farben der Touren einer Reise (Liste links = Linie auf der Karte)
  const FARBEN = ["#48d6c4", "#ff896b", "#ffc21a", "#8fa8ff", "#e57bd8", "#7fd35b", "#ff5a7a", "#5ad1ff"];
  function _linieHervor(i, an) {
    if (!Z || !Z.map || !Z.map.getLayer("ts-spur-linie")) return;
    try { Z.map.setPaintProperty("ts-spur-linie", "line-width", an ? ["case", ["==", ["get", "i"], i], 7, 2.5] : 3.5); } catch (_) {}
  }

  function _hervor(pfad, an) {
    if (!Z) return;
    const mk = Z.marker[pfad]; if (mk && mk._el) mk._el.classList.toggle("hervor", !!an);
    const b = Z.seite.querySelector(`.ts-bild[data-pfad="${CSS.escape(pfad)}"]`); if (b) b.classList.toggle("hervor", !!an);
  }

  // ── Reiter „Logbuch“ (11.10.2026) ──
  // Das Logbuch der Tour (ui/js/logbuch_ansicht.js) steht rechts, die Karte zeigt die Einträge des Tages als Pins; ein Klick
  // auf einen Eintrag zeigt die Stelle, ein Klick auf einen Pin wählt den Eintrag. Medien-Pins und Bildstreifen ruhen solange.
  const _ANSICHT_KEY = "rz-ts-ansicht";
  function _ansicht() { try { return Object.assign({ unten: true }, JSON.parse(localStorage.getItem(_ANSICHT_KEY) || "{}")); } catch (_) { return { unten: true }; } }
  function _ansichtMerken(a) { try { localStorage.setItem(_ANSICHT_KEY, JSON.stringify(a)); } catch (_) {} }
  function _ansichtAnwenden() {
    if (!Z) return;
    const a = _ansicht();
    Z.seite.classList.toggle("ts-ohne-streifen", !a.unten);
    document.querySelectorAll("[data-ts-ansicht]").forEach(b => { const k = b.dataset.tsAnsicht; b.classList.toggle("an", !!a[k]); b.setAttribute("aria-pressed", a[k] ? "true" : "false"); });
    // ohne Bilder unten zeigt die Karte die Logbuch-Einträge (früher der Reiter „Logbuch“), mit Bildern die Fotos
    if (!Z.tour.reise) {
      const soll = a.unten ? "uebersicht" : "logbuch";
      if (Z.reiter !== soll) _reiterSetzen(soll);
    }
    setTimeout(() => { try { if (Z && Z.map) Z.map.resize(); window.dispatchEvent(new Event("resize")); } catch (_) {} }, 30);
  }
  function _reiterSetzen(r) {
    if (!Z || Z.tour.reise) return;
    Z.reiter = r === "logbuch" ? "logbuch" : "uebersicht";
    Z.seite.classList.toggle("ts-mit-logbuch", Z.reiter === "logbuch");
    _lbPinsWeg();
    if (Z.reiter === "logbuch") {
      Z.auswahl = "";
      Z.seite.querySelectorAll(".ts-bild.is-on").forEach(x => x.classList.remove("is-on"));
      Object.values(Z.marker).forEach(mk => mk._el && mk._el.classList.remove("is-on"));
      _logbuchSpalte(); _lbPinsSetzen(true);
    } else if (Z.auswahl) waehlen(Z.auswahl);
    else _logbuchSpalte();
  }
  /** Rechte Spalte = Logbuch. Die Ansicht wird einmal gebaut und beim Umschalten nur wieder eingehängt (Tag, Auswahl
   *  und Rückgängig bleiben stehen). */
  function _logbuchSpalte() {
    const det = document.getElementById("lib-detail");
    if (!Z || !det || Z.tour.reise || !window.rzLogbuchAnsicht) return;
    if (!Z.lbBox) {
      Z.lbBox = document.createElement("div");
      Z.lbBox.className = "ts-logbuch-spalte";
      const zust = Z;
      Z.lb = window.rzLogbuchAnsicht.zeichnen(Z.lbBox, {
        path: Z.tour.path,
        name: (Z.daten && Z.daten.tour && _name(Z.daten.tour)) || Z.tour.name || "",   // für den Export (Titel, Dateiname)
        onDaten: () => { if (Z === zust) _lbPinsSetzen(); },
        onTag: () => { if (Z === zust) _lbPinsSetzen(Z.reiter === "logbuch"); },
        onWahl: (x) => { if (Z === zust) _lbZeigen(x); },
        // 16.10.2026 — nach Umbenennen/Art ändern/Rückgängig auch die Kurzfassung links („2 h Fahrt · 1 Wanderung“) neu holen
        onGeaendert: () => { if (Z === zust) _logbuch(Z.tour.path); },
      });
    }
    if (Z.lbBox.parentNode !== det) { det.hidden = false; det.innerHTML = ""; det.appendChild(Z.lbBox); }
  }
  function _lbPinsWeg() {
    if (!Z) return;
    Object.values(Z.lbPins || {}).forEach(mk => { try { mk.remove(); } catch (_) {} });
    Z.lbPins = {};
  }
  function _lbPinsSetzen(einpassen) {
    if (!Z || !Z.map || !Z.lb || Z.reiter !== "logbuch") return;
    _lbPinsWeg();
    const lib = Z.lib, map = Z.map, b = new lib.LngLatBounds();
    for (const x of Z.lb.tagEintraege()) {
      if (!Array.isArray(x.pos)) continue;
      _lbPinMachen(x); b.extend(x.pos);
    }
    if (einpassen && !b.isEmpty()) { try { map.fitBounds(b, { padding: 60, maxZoom: 14, duration: 500 }); } catch (_) {} }
  }
  function _lbPinMachen(x) {
    const art = x.t0 == null ? x.art : (x.anzeige_art || x.art);
    const el = document.createElement("button");
    el.type = "button"; el.className = "ts-lb-pin"; el.style.setProperty("--c", window.rzLogbuchAnsicht.farbe(art));
    el.innerHTML = I(window.rzLogbuchAnsicht.symbolName(art), 14);
    el.title = Z.lb.titel(x);
    el.onclick = (e) => { e.stopPropagation(); Z.lb.waehlen(x.id); };
    const mk = new Z.lib.Marker({ element: el, anchor: "center" }).setLngLat(x.pos).addTo(Z.map);
    mk._el = el; Z.lbPins[x.id] = mk;
    return mk;
  }
  function _lbZeigen(x) {
    if (!Z || !Z.map) return;
    if (Z.reiter === "logbuch" && !Z.lbPins[x.id]) _lbPinsSetzen(false);
    // 11.10.2026 — in der Übersicht steht nur der gewählte Eintrag als Pin auf der Karte (sonst sähe man nicht, wo er war)
    if (Z.reiter !== "logbuch") { _lbPinsWeg(); if (Array.isArray(x.pos)) _lbPinMachen(x); }
    Object.entries(Z.lbPins || {}).forEach(([id, mk]) => mk._el && mk._el.classList.toggle("is-on", id === x.id));
    try {
      if (Array.isArray(x.pos_von) && Array.isArray(x.pos_bis) && (x.pos_von[0] !== x.pos_bis[0] || x.pos_von[1] !== x.pos_bis[1])) {
        const b = new Z.lib.LngLatBounds(); b.extend(x.pos_von); b.extend(x.pos_bis); if (Array.isArray(x.pos)) b.extend(x.pos);
        Z.map.fitBounds(b, { padding: 80, maxZoom: 15, duration: 600 });
      } else if (Array.isArray(x.pos)) Z.map.flyTo({ center: x.pos, zoom: Math.max(Z.map.getZoom(), 14), duration: 600 });
    } catch (_) {}
  }

  function waehlen(pfad, zentrieren) {
    if (!Z) return;
    Z.auswahl = pfad;
    Z.seite.querySelectorAll(".ts-bild.is-on").forEach(x => x.classList.remove("is-on"));
    Object.values(Z.marker).forEach(mk => mk._el && mk._el.classList.remove("is-on"));
    const b = Z.seite.querySelector(`.ts-bild[data-pfad="${CSS.escape(pfad)}"]`);
    if (b) { b.classList.add("is-on"); try { b.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (_) {} }
    const mk = Z.marker[pfad];
    if (mk && mk._el) {
      mk._el.classList.add("is-on");
      if (zentrieren && Z.map) try { Z.map.easeTo({ center: mk.getLngLat(), duration: 400 }); } catch (_) {}
    }
    if (window.rzFotos && window.rzFotos.detailFuer) {
      const zust = Z;
      Promise.resolve(window.rzFotos.detailFuer(pfad)).then(() => {
        const det = document.getElementById("lib-detail");
        if (Z !== zust || Z.auswahl !== pfad || Z.tour.reise || !det || det.querySelector(".ts-zum-logbuch")) return;
        const k = document.createElement("button");
        k.type = "button"; k.className = "btn btn-sm ts-zum-logbuch";
        k.innerHTML = `${I("arrow-left", 14)} ${esc(T("tourseite.zum_logbuch", "Logbuch"))}`;
        k.onclick = () => {
          if (!Z) return;
          Z.auswahl = "";
          Z.seite.querySelectorAll(".ts-bild.is-on").forEach(x => x.classList.remove("is-on"));
          Object.values(Z.marker).forEach(mk => mk._el && mk._el.classList.remove("is-on"));
          _logbuchSpalte();
        };
        det.prepend(k);
      }).catch(() => {});
    }
  }

  function _gross(pfad) {
    if (window.rzFotos && window.rzFotos.gross) window.rzFotos.gross(pfad, (Z && Z.daten ? Z.daten.medien : []).map(x => ({
      path: x.path, dateiname: x.dateiname, art: x.art, tag_lokal: x.tag, aufnahme_utc: x.utc, tz_minuten: x.tz })));
  }

  function schliessen(still) {
    document.querySelectorAll(".ts-menue").forEach(x => x.remove());
    if (!Z) return;
    const zust = Z; Z = null;
    try { if (zust.map) zust.map.remove(); } catch (_) {}
    try { zust.seite.remove(); } catch (_) {}
    try { zust.links.remove(); } catch (_) {}
    document.querySelectorAll(".lib-main.ts-aktiv, #lib-panel.ts-aktiv").forEach(x => x.classList.remove("ts-aktiv"));
    { const platz = document.getElementById("lib-ansicht-extra"); if (platz) platz.innerHTML = ""; }
    setTimeout(() => { try { window.dispatchEvent(new Event("resize")); } catch (_) {} }, 30);
    window.__rzTourSeiteKarte = null;
    if (!still) {
      log("info", "geschlossen");
      // die Tourenliste zeichnet ihre rechte Spalte wieder selbst
      if (typeof window.__rzLibDetailNeu === "function") try { window.__rzLibDetailNeu(); } catch (_) {}
    }
  }

  // Esc schließt — außer beim Tippen, in einem Dialog oder in der Großansicht
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !offen() || e.isComposing) return;
    const z = e.target;
    if (z && (z.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(z.tagName))) return;
    if (document.querySelector("#modal-overlay:not([hidden])") || document.querySelector(".foto-gross, .ts-menue, .lib-ctxmenu")) return;
    e.preventDefault();
    schliessen();
  });
  // Modulwechsel ersetzt das Archiv samt Seite — dann die Karte freigeben (sonst hängt sie im Speicher)
  setInterval(() => { if (Z && !Z.seite.isConnected) schliessen(true); }, 1500);

  window.rzTourSeite = { oeffnen, oeffnenReise, schliessen: () => schliessen(), offen, neuLaden, waehlen, korrigieren, plusTag,
                         zustand: () => (Z ? { tour: Z.tour, auswahl: Z.auswahl, n: (Z.daten && Z.daten.medien || []).length } : null) };
})();
