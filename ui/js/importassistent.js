/* Reisezoom GPS Studio — Import-Assistent (15.10.2026)
 *
 * Marc: „ein Ordner, den ich bestimme, und dann machen wir einen Import-Assistenten, der guckt, was drin ist, ggf. auf
 * Fehler im Track hinweist …, ein paar Fragen zum Track stellt (Art, Infos …, alles schon vorausgefüllt), Sammlung …,
 * Logbuch erstellen, die Fotos auf der Karte wie im Geotagger zeigt. ‚So übernehmen?‘ Dann fragen: Wie weiter?“
 *
 * Sechs Schritte in EINEM Fenster (openModal), Zustand in `Z`, jeder Schritt zeichnet sich aus `Z` neu:
 *   0 Eingang   Eingangsordner + Ziel im Archiv wählen, Inhalt (eingang_pruefen) — ohne neuen Track kein Weiter
 *   1 Track     Linie, Eckdaten, Track-Check
 *   2 Angaben   Titel (Vorschläge aus den Orten), Art (aus dem Tempo), Notiz, Sammlung
 *   3 Medien    Fotos/Clips auf der Karte (eingang_zuordnen; ohne Medien im Eingang: aus dem Medienarchiv)
 *   4 Prüfen    „So übernehmen?“ → eingang_uebernehmen
 *   5 Weiter    Fertig · Tour-Seite · Medien · Schnell-Video · Video-Assistent · Animator · Tour-Karte · Daten-Animator
 * Geht nur auf, wenn man ihn startet (Archiv „Import-Assistent …“, Menü Ablage).
 */
(function () {
  "use strict";
  const T = (k, f, v) => (typeof t === "function" ? t(k, f, v) : f);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const I = (n, g) => (typeof rzIcon === "function" ? rzIcon(n, { size: g || 16 }) : "");
  const log = (lvl, m) => { try { applog(lvl, "[import-assistent] " + m); } catch (_) {} };
  const SCHRITTE = ["eingang", "track", "angaben", "medien", "pruefen", "weiter"];
  let Z = null, M = null, karte = null;

  function neuerZustand() {
    return { seite: 0, ordner: "", ziel: "", laedt: "", pruefung: null, trackPfad: "", titel: "", titelVorschlaege: [],
             art: "", arten: [], notiz: "", sammlungen: [], sammlung: "", sammlungNeu: "", zuordnung: null,
             verorten: true, ergebnis: null, fehler: "" };
  }

  const tracks = () => (Z.pruefung && Z.pruefung.tracks) || [];
  const neueTracks = () => tracks().filter(x => x.art === "neu" && x.lesbar !== false);
  const track = () => tracks().find(x => x.pfad === Z.trackPfad) || null;
  const treffer = () => (Z.zuordnung && Z.zuordnung.treffer) || [];
  const imTrack = () => treffer().filter(x => x.im_track);
  const ladeZeile = (text) => `<div class="ia-lade"><span class="spinner"></span> ${esc(text)}</div>`;

  async function openImportAssistent() {
    if (M) return;
    Z = neuerZustand();
    let st = {};
    try { st = (await loadSettings()) || {}; } catch (_) { st = {}; }
    Z.ordner = st.import_eingang || "";
    Z.ziel = st.import_ziel || "";
    M = openModal({
      title: T("ia.titel", "Import-Assistent"),
      body: `<div id="ia-rumpf"></div>`,
      footer: `<button class="btn btn-ghost btn-left" id="ia-zurueck" type="button">${I("arrow-left")} ${esc(T("ia.zurueck", "Zurück"))}</button>
               <button class="btn" id="ia-abbrechen" type="button">${esc(T("common.cancel", "Abbrechen"))}</button>
               <button class="btn btn-primary" id="ia-weiter" type="button">${esc(T("ia.weiter", "Weiter"))} ${I("arrow-right")}</button>
               <button class="btn btn-primary" id="ia-uebernehmen" type="button" hidden>${I("check")} ${esc(T("ia.uebernehmen", "So übernehmen"))}</button>`,
      onClose: () => { aufraeumen(); },
      restorePrevious: () => zeichnen(),
    });
    document.getElementById("modal")?.classList.add("ia-modal");
    zeichnen();
    if (Z.ordner) pruefen();
  }

  function aufraeumen() {
    if (karte) { try { karte.remove(); } catch (_) {} karte = null; }
    document.getElementById("modal")?.classList.remove("ia-modal");
    M = null;
  }

  // ── Zeichnen ───────────────────────────────────────────────────────────────────────────────────────────────────────
  function zeichnen() {
    const rumpf = document.getElementById("ia-rumpf");
    if (!rumpf || !Z) return;
    const n = SCHRITTE.length;
    const kopf = `<div class="ia-kopf"><span class="ia-schritt">${esc(T("ia.schritt", "Schritt {n} von {m}", { n: Z.seite + 1, m: n }))}</span>
      <span class="ia-punkte">${SCHRITTE.map((s, i) => `<span class="ia-punkt${i === Z.seite ? " an" : ""}${i < Z.seite ? " fertig" : ""}"></span>`).join("")}</span>
      <span class="ia-name">${esc(T("ia.s_" + SCHRITTE[Z.seite], ""))}</span></div>`;
    const seite = { eingang: seiteEingang, track: seiteTrack, angaben: seiteAngaben, medien: seiteMedien, pruefen: seitePruefen, weiter: seiteWeiter }[SCHRITTE[Z.seite]];
    rumpf.innerHTML = kopf + `<section class="ia-seite" data-ia="${SCHRITTE[Z.seite]}">${seite()}</section>`
      + (Z.fehler ? `<div class="ia-fehler">${I("triangle-alert")} ${esc(Z.fehler)}</div>` : "");
    binden();
    knoepfe();
    if (SCHRITTE[Z.seite] === "track" || SCHRITTE[Z.seite] === "medien") setTimeout(karteZeichnen, 0);
  }

  function knoepfe() {
    const zur = document.getElementById("ia-zurueck"), wei = document.getElementById("ia-weiter"),
      ueb = document.getElementById("ia-uebernehmen"), ab = document.getElementById("ia-abbrechen");
    if (!wei) return;
    const s = SCHRITTE[Z.seite];
    zur.hidden = Z.seite === 0 || s === "weiter";
    zur.disabled = !!Z.laedt;
    ab.hidden = s === "weiter";
    wei.hidden = s === "pruefen" || s === "weiter";
    ueb.hidden = s !== "pruefen";
    wei.disabled = !!Z.laedt || (s === "eingang" && !Z.trackPfad) || (s === "angaben" && !Z.titel.trim());
    ueb.disabled = !!Z.laedt;
    zur.onclick = () => geh(Z.seite - 1);
    wei.onclick = () => geh(Z.seite + 1);
    ueb.onclick = uebernehmen;
    ab.onclick = () => { if (M) M.close(); };
  }

  function geh(i) {
    if (!Z || i < 0 || i >= SCHRITTE.length) return;
    Z.fehler = "";
    Z.seite = i;
    if (karte) { try { karte.remove(); } catch (_) {} karte = null; }
    zeichnen();
    const s = SCHRITTE[i];
    if (s === "angaben") angabenLaden();
    if (s === "medien" && !Z.zuordnung) zuordnen();
  }

  // ── Schritt 0: Eingang ─────────────────────────────────────────────────────────────────────────────────────────────
  function seiteEingang() {
    const p = Z.pruefung;
    let inhalt = "";
    if (Z.laedt === "pruefen") inhalt = ladeZeile(T("ia.lade_eingang", "Schaue in den Eingang …"));
    else if (!Z.ordner) inhalt = `<p class="muted">${esc(T("ia.ordner_leer", "Wähle den Ordner, in den du Track, Fotos und Clips nach der Tour legst."))}</p>`;
    else if (p && p.ok) {
      const ts = tracks(), fotos = (p.medien || []).filter(m => m.art !== "video").length, clips = (p.medien || []).filter(m => m.art === "video").length;
      inhalt = `<ul class="ia-liste">${ts.map(x => `<li>${I("route")} <b>${esc(x.name)}</b>
          <span class="ia-marke ${x.art === "neu" ? "neu" : ""}">${esc(x.art === "neu" ? T("ia.neu", "neu") : (x.lesbar === false ? T("ia.unlesbar", "nicht lesbar") : T("ia.bekannt", "schon im Archiv")))}</span>
          ${x.km != null ? `<span class="muted">${esc(String(x.km).replace(".", ","))} km · ${esc(x.datum || "")}</span>` : ""}</li>`).join("")}
        <li>${I("images")} ${esc(T("ia.n_fotos", "Fotos: {n}", { n: fotos }))} · ${esc(T("ia.n_clips", "Clips: {n}", { n: clips }))}</li>
        ${(p.sonst || []).length ? `<li class="muted">${I("file-text")} ${esc(T("ia.n_sonst", "Andere Dateien (bleiben liegen): {n}", { n: p.sonst.length }))}</li>` : ""}</ul>`;
      if (!ts.length) inhalt += `<p class="ia-hinweis">${esc(T("ia.kein_track", "Im Eingang liegt kein Track. Der Assistent startet mit einem neuen Track."))}</p>`;
      else if (!neueTracks().length) inhalt += `<p class="ia-hinweis">${esc(T("ia.kein_neuer", "Alle Tracks im Eingang sind schon im Archiv. Der Assistent startet mit einem neuen Track."))}</p>`;
      else if (neueTracks().length > 1) inhalt += `<label class="ia-feld">${esc(T("ia.welcher", "Welcher Track?"))}
          <select id="ia-track-wahl" class="lib-input">${neueTracks().map(x => `<option value="${esc(x.pfad)}"${x.pfad === Z.trackPfad ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>`;
    } else if (p && !p.ok) inhalt = `<p class="ia-hinweis">${esc(p.error || "")}</p>`;
    return `<p class="ia-intro">${esc(T("ia.intro", "Leg nach der Tour Track, Fotos und Clips in deinen Eingangsordner. Der Assistent schaut nach, was drin ist, verortet die Fotos und nimmt alles ins Archiv auf."))}</p>
      <div class="ia-ordner"><span class="ia-ordner-name">${I("inbox")} ${esc(T("ia.eingang", "Eingang"))}</span>
        <code title="${esc(Z.ordner)}"><bdi dir="ltr">${esc(Z.ordner || T("ia.nicht_gewaehlt", "noch nicht gewählt"))}</bdi></code>
        <button class="btn btn-sm" id="ia-ordner-wahl" type="button">${I("folder-open")} ${esc(T("ia.waehlen", "Wählen …"))}</button></div>
      <div class="ia-ordner"><span class="ia-ordner-name">${I("hard-drive")} ${esc(T("ia.ziel", "Ziel im Archiv"))}</span>
        <code title="${esc(Z.ziel || (p && p.ziel) || "")}"><bdi dir="ltr">${esc(Z.ziel || (p && p.ziel) || T("ia.ziel_standard", "erster Archiv-Ordner"))}</bdi></code>
        <button class="btn btn-sm" id="ia-ziel-wahl" type="button">${I("folder-open")} ${esc(T("ia.waehlen", "Wählen …"))}</button></div>
      <div class="ia-inhalt">${inhalt}</div>`;
  }

  async function pruefen() {
    Z.laedt = "pruefen"; Z.pruefung = null; Z.trackPfad = ""; Z.zuordnung = null; zeichnen();
    let r;
    try { r = await api().eingang_pruefen(Z.ordner); } catch (e) { r = { ok: false, error: String(e) }; } // warte-ok: Ladezeile im Assistenten
    if (!Z) return;
    Z.laedt = ""; Z.pruefung = r;
    const neu = neueTracks();
    if (neu.length) {
      Z.trackPfad = neu[0].pfad;
      Z.titel = neu[0].titel || ""; Z.art = neu[0].aktivitaet || "";
    }
    log("info", `Eingang: ${tracks().length} Track(s), neu ${neu.length}, Medien ${(r.medien || []).length}`);
    zeichnen();
  }

  // ── Schritt 1: Track ───────────────────────────────────────────────────────────────────────────────────────────────
  function seiteTrack() {
    const x = track();
    if (!x) return "";
    const dauer = (x.start && x.ende) ? Math.round((new Date(x.ende) - new Date(x.start)) / 60000) : 0;
    const befunde = (x.befunde || []).map(b => (typeof window.rzTrackCheckZeile === "function" ? window.rzTrackCheckZeile(b) : b.key)).filter(Boolean);
    const stufe = (typeof window.rzTrackCheckStufeText === "function" && x.hoechste) ? window.rzTrackCheckStufeText(x.hoechste) : "";
    return `<div class="ia-zwei"><div class="ia-karte" id="ia-karte"></div>
      <div class="ia-fakten"><h4>${esc(x.name)}</h4>
        <dl><dt>${esc(T("ia.strecke", "Strecke"))}</dt><dd>${esc(String(x.km).replace(".", ","))} km</dd>
        <dt>${esc(T("ia.datum", "Datum"))}</dt><dd>${esc(x.datum || "–")}</dd>
        <dt>${esc(T("ia.dauer", "Dauer"))}</dt><dd>${dauer ? esc(Math.floor(dauer / 60) + ":" + String(dauer % 60).padStart(2, "0") + " h") : "–"}</dd>
        <dt>${esc(T("ia.punkte", "Punkte"))}</dt><dd>${esc(x.punkte)}</dd></dl>
        <div class="ia-check">${befunde.length
          ? `<b>${I("stethoscope")} ${esc(T("ia.check_befunde", "Track-Check"))}</b><ul>${befunde.map(b => `<li>${esc(b)}</li>`).join("")}</ul>${stufe ? `<span class="muted">${esc(stufe)}</span>` : ""}`
          : `${I("check")} ${esc(T("trackcheck.ok_none", "Track-Check: alles in Ordnung."))}`}</div></div></div>`;
  }

  // ── Schritt 2: Angaben ─────────────────────────────────────────────────────────────────────────────────────────────
  function seiteAngaben() {
    const chips = (Z.titelVorschlaege || []).filter(v => v && v !== Z.titel);
    const arten = Z.arten.length ? Z.arten : (Z.art ? [Z.art] : []);
    return `<label class="ia-feld">${esc(T("ia.titel_feld", "Titel"))}
        <input type="text" id="ia-titel" class="lib-input" value="${esc(Z.titel)}"></label>
      <div class="ia-chips">${Z.titelLaedt ? ladeZeile(T("ia.lade_titel", "Sucht Titel aus den Orten …"))
        : chips.map(v => `<button type="button" class="ia-chip" data-titel="${esc(v)}">${esc(v)}</button>`).join("")}</div>
      <label class="ia-feld">${esc(T("ia.art", "Art"))}
        <select id="ia-art" class="lib-input">${arten.map(a => `<option value="${esc(a)}"${a === Z.art ? " selected" : ""}>${esc(T("library.act." + a, a))}</option>`).join("")}</select></label>
      <label class="ia-feld">${esc(T("ia.notiz", "Notiz"))}
        <textarea id="ia-notiz" class="lib-input" rows="3" placeholder="${esc(T("ia.notiz_ph", "Mit wem, Wetter, Besonderes …"))}">${esc(Z.notiz)}</textarea></label>
      <label class="ia-feld">${esc(T("ia.sammlung", "Sammlung"))}
        <select id="ia-sammlung" class="lib-input"><option value="">${esc(T("ia.sammlung_keine", "keine"))}</option>
          ${Z.sammlungen.map(s => `<option value="${esc(s.id)}"${String(s.id) === String(Z.sammlung) ? " selected" : ""}>${esc(s.name)}</option>`).join("")}
          <option value="__neu"${Z.sammlung === "__neu" ? " selected" : ""}>${esc(T("ia.sammlung_neu", "Neue Sammlung …"))}</option></select></label>
      ${Z.sammlung === "__neu" ? `<input type="text" id="ia-sammlung-neu" class="lib-input" value="${esc(Z.sammlungNeu)}" placeholder="${esc(T("ia.sammlung_name", "Name der Sammlung"))}">` : ""}`;
  }

  async function angabenLaden() {
    if (!Z.arten.length) {
      try { const r = await api().library_activities(); if (Z && r && r.choices) Z.arten = r.choices; } catch (_) {} // warte-ok: schnelle Liste
    }
    if (!Z.sammlungen.length) {
      try { const r = await api().library_collections(); if (Z && r && r.collections) Z.sammlungen = r.collections; } catch (_) {} // warte-ok: schnelle Liste
    }
    if (Z && SCHRITTE[Z.seite] === "angaben") zeichnen();
    if (Z && !Z.titelVorschlaege.length && Z.trackPfad) {
      Z.titelLaedt = true; zeichnen();
      let r; try { r = await api().schnellvideo_titel_vorschlaege(Z.trackPfad); } catch (_) { r = null; } // warte-ok: Ladezeile im Assistenten
      if (!Z) return;
      Z.titelLaedt = false; Z.titelVorschlaege = (r && r.titel) || [];
      if (SCHRITTE[Z.seite] === "angaben") zeichnen();
    }
  }

  // ── Schritt 3: Fotos & Clips ───────────────────────────────────────────────────────────────────────────────────────
  function seiteMedien() {
    if (Z.laedt === "zuordnen" || !Z.zuordnung) return ladeZeile(T("ia.lade_zuordnen", "Legt Fotos und Clips auf den Track …"));
    const z = Z.zuordnung;
    if (!z.ok) return `<p class="ia-hinweis">${esc(z.error || "")}</p>`;
    const drin = imTrack(), eigen = drin.filter(x => x.quelle === "exif").length, raus = treffer().length - drin.length;
    const zone = z.zeitzone || {};
    const zt = zone.minuten != null && zone.minuten !== 0
      ? T("ia.zeitzone", "Die Kamera speichert keine Zeitzone — aus dem Track errechnet: UTC{v}", { v: (zone.minuten >= 0 ? "+" : "−") + Math.abs(zone.minuten / 60).toString().replace(".", ",") }) : "";
    const kopf = z.archiv
      ? (drin.length ? T("ia.aus_archiv", "Im Eingang liegen keine Fotos. Aus dem Medienarchiv gehören zu dieser Tour: {n}", { n: drin.length })
                     : T("ia.archiv_leer", "Im Eingang liegen keine Fotos, und im Medienarchiv gibt es keine Aufnahmen aus dieser Zeit."))
      : T("ia.auf_tour", "Fotos und Clips auf der Tour: {n}", { n: drin.length });
    const zuVerorten = drin.filter(x => x.quelle === "track").length;
    return `<div class="ia-zwei"><div class="ia-karte" id="ia-karte"></div>
      <div class="ia-fakten"><p>${esc(kopf)}</p>
        ${eigen ? `<p class="muted">${esc(T("ia.eigenes_gps", "Davon mit eigenem GPS (bleibt): {n}", { n: eigen }))}</p>` : ""}
        ${raus ? `<p class="muted">${esc(T("ia.ausserhalb", "Zeitlich nicht passend, bleiben im Eingang: {n}", { n: raus }))}</p>` : ""}
        ${zt ? `<p class="muted">${I("clock")} ${esc(zt)}</p>` : ""}
        ${zuVerorten ? `<label class="check-row"><input type="checkbox" id="ia-verorten"${Z.verorten ? " checked" : ""}> ${esc(z.archiv
          ? T("ia.verorten_archiv", "Fehlende Orte eintragen (vorher gesichert): {n}", { n: zuVerorten })
          : T("ia.verorten", "Position in die Fotos/Clips schreiben (vorher gesichert): {n}", { n: zuVerorten }))}</label>` : ""}
      </div></div>
      <div class="ia-streifen" id="ia-streifen">${drin.slice(0, 60).map(x => `<span class="ia-bild" data-pfad="${esc(x.pfad)}" title="${esc(x.pfad.split(/[\\/]/).pop())}"></span>`).join("")}</div>`;
  }

  async function zuordnen() {
    const x = track();
    if (!x) return;
    Z.laedt = "zuordnen"; zeichnen();
    const medien = (Z.pruefung && Z.pruefung.medien) || [];
    let r; try { r = await api().eingang_zuordnen(x.pfad, medien, 0, null); } catch (e) { r = { ok: false, error: String(e) }; } // warte-ok: Ladezeile im Assistenten
    if (!Z) return;
    Z.laedt = ""; Z.zuordnung = r;
    log("info", `zugeordnet: ${imTrack().length}/${treffer().length}${r && r.archiv ? " (Medienarchiv)" : ""}, Zeitzone ${JSON.stringify((r && r.zeitzone) || {})}`);
    if (SCHRITTE[Z.seite] === "medien") zeichnen();
    vorschaubilder();
  }

  async function vorschaubilder() {
    const pf = imTrack().slice(0, 60).map(x => x.pfad);
    if (!pf.length) return;
    let r; try { r = await api().eingang_vorschaubilder(pf); } catch (_) { r = null; } // warte-ok: Bilder kommen nach, Platzhalter steht
    Z && (Z.bilder = (r && r.bilder) || {});
    bilderSetzen();
  }

  function bilderSetzen() {
    if (!Z || !Z.bilder) return;
    document.querySelectorAll(".ia-bild[data-pfad], .ia-pin[data-pfad]").forEach(el => {
      const u = Z.bilder[el.dataset.pfad];
      if (u) el.style.backgroundImage = `url("${u}")`;
    });
  }

  // ── Karte (Schritt 1 und 3) ────────────────────────────────────────────────────────────────────────────────────────
  function karteZeichnen() {
    const host = document.getElementById("ia-karte"), x = track();
    if (!host || !x || !(x.coords || []).length || typeof createMap !== "function") return;
    if (karte) { try { karte.remove(); } catch (_) {} karte = null; }
    const co = x.coords, lo = co.map(c => c[0]), la = co.map(c => c[1]);
    const bbox = { min_lon: Math.min(...lo), max_lon: Math.max(...lo), min_lat: Math.min(...la), max_lat: Math.max(...la) };
    let c;
    try {
      c = createMap({ container: host, styleKey: (typeof rzArchivStil === "function") ? rzArchivStil() : undefined, bbox,
                      common: { center: co[0], zoom: 11, attributionControl: true } });
    } catch (e) { log("warn", "Karte: " + e); return; }
    const map = c.map, lib = c.lib;
    karte = map;
    window.__rzIaKarte = map;   // Prüfstand
    map.on("load", () => {
      if (karte !== map) return;
      map.addSource("ia-spur", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: co } } });
      map.addLayer({ id: "ia-spur-rand", type: "line", source: "ia-spur", layout: { "line-cap": "round", "line-join": "round" },
                     paint: { "line-color": "#0f1a20", "line-width": 6, "line-opacity": 0.55 } });
      map.addLayer({ id: "ia-spur-linie", type: "line", source: "ia-spur", layout: { "line-cap": "round", "line-join": "round" },
                     paint: { "line-color": "#48d6c4", "line-width": 3.5 } });
      if (typeof rzStartZiel === "function") { try { rzStartZiel(map, lib, [co]); } catch (_) {} }
      if (SCHRITTE[Z.seite] === "medien") {
        for (const m of imTrack()) {
          if (m.lat == null || m.lon == null) continue;
          const el = document.createElement("span");
          el.className = "ia-pin" + (m.quelle === "exif" ? " eigen" : "");
          el.dataset.pfad = m.pfad;
          el.title = m.pfad.split(/[\\/]/).pop() + (m.quelle === "exif" ? " · " + T("ia.pin_eigen", "eigenes GPS") : "");
          new lib.Marker({ element: el, anchor: "bottom" }).setLngLat([+m.lon, +m.lat]).addTo(map);
        }
        bilderSetzen();
      }
      try { map.fitBounds([[bbox.min_lon, bbox.min_lat], [bbox.max_lon, bbox.max_lat]], { padding: 30, duration: 0 }); } catch (_) {}
    });
  }

  // ── Schritt 4: So übernehmen? ──────────────────────────────────────────────────────────────────────────────────────
  function sammlungText() {
    if (Z.sammlung === "__neu") return Z.sammlungNeu.trim() ? T("ia.p_sammlung_neu", "neue Sammlung „{name}“", { name: Z.sammlungNeu.trim() }) : "";
    const s = Z.sammlungen.find(x => String(x.id) === String(Z.sammlung));
    return s ? T("ia.p_sammlung", "Sammlung „{name}“", { name: s.name }) : "";
  }

  function seitePruefen() {
    if (Z.laedt === "uebernehmen") return ladeZeile(T("ia.lade_uebernehmen", "Übernimmt die Tour …"));
    const x = track(), z = Z.zuordnung || {}, drin = imTrack();
    const ordner = (x.datum ? x.datum + " " : "") + Z.titel.trim();
    const zuVerorten = Z.verorten ? drin.filter(m => m.quelle === "track").length : 0;
    const zeilen = [
      [I("folder-plus"), T("ia.p_ordner", "Neuer Ordner „{ordner}“ in {ziel}", { ordner, ziel: (Z.ziel || (Z.pruefung && Z.pruefung.ziel) || "").split(/[\\/]/).pop() })],
      [I("route"), z.archiv ? T("ia.p_track", "Der Track zieht dorthin um", {})
                            : T("ia.p_verschieben", "Der Track und Fotos/Clips ziehen dorthin um: {n}", { n: drin.length })],
      zuVerorten ? [I("map-pin"), T("ia.p_verorten", "Fotos/Clips bekommen ihre Position: {n}", { n: zuVerorten })] : null,
      [I("hard-drive"), T("ia.p_archiv", "Ins Archiv: „{titel}“ · {art}", { titel: Z.titel.trim(), art: T("library.act." + Z.art, Z.art) })],
      Z.notiz.trim() ? [I("notebook-pen"), T("ia.p_notiz", "Mit deiner Notiz")] : null,
      sammlungText() ? [I("library"), sammlungText()] : null,
      [I("book-open"), T("ia.p_logbuch", "Logbuch mit Pausen und Übernachtungen")],
    ].filter(Boolean);
    return `<ul class="ia-liste ia-plan">${zeilen.map(([i, txt]) => `<li>${i} ${esc(txt)}</li>`).join("")}</ul>`;
  }

  async function uebernehmen() {
    const x = track();
    if (!x || Z.laedt) return;
    const drin = imTrack(), z = Z.zuordnung || {};
    const plan = { track: x.pfad, titel: Z.titel.trim(), aktivitaet: Z.art, notiz: Z.notiz, datum: x.datum || "",
                   sammlung: Z.sammlung === "__neu" ? (Z.sammlungNeu.trim() ? { neu: Z.sammlungNeu.trim() } : null)
                                                    : (Z.sammlung ? { id: Z.sammlung } : null),
                   medien: z.archiv ? [] : drin.map(m => m.pfad), treffer: drin, verorten: !!Z.verorten, archiv_medien: !!z.archiv };
    Z.laedt = "uebernehmen"; zeichnen();
    let r;
    try { r = await rzWarten("eingang_uebernehmen", () => api().eingang_uebernehmen(plan)); } catch (e) { r = { ok: false, error: String(e) }; }
    if (!Z) return;
    Z.laedt = "";
    if (!r || !r.ok) { Z.fehler = T("ia.fehler", "Nicht übernommen: {e}", { e: (r && r.error) || "?" }); zeichnen(); return; }
    Z.ergebnis = r;
    log("info", `übernommen: ${r.pfad} (${r.verschoben} Dateien, ${r.verortet} verortet)`);
    try { window.dispatchEvent(new CustomEvent("rz-archiv-geaendert")); } catch (_) {}
    geh(5);
  }

  // ── Schritt 5: Wie weiter? ─────────────────────────────────────────────────────────────────────────────────────────
  const WEITER = [
    ["fertig", "check", "ia.w_fertig", "Fertig"],
    ["tourseite", "layout-list", "ia.w_tourseite", "Tour-Seite mit Logbuch"],
    ["medien", "images", "ia.w_medien", "Fotos bearbeiten (Geotagger)"],
    ["schnellvideo", "zap", "ia.w_schnellvideo", "Schnell-Video"],
    ["assistent", "wand-sparkles", "ia.w_assistent", "Video-Assistent"],
    ["animator", "clapperboard", "ia.w_animator", "Video selbst gestalten (Animator)"],
    ["tourmap", "map", "ia.w_tourmap", "Karte erstellen"],
    ["heightanim", "chart-spline", "ia.w_heightanim", "Daten animieren"],
  ];

  function seiteWeiter() {
    const r = Z.ergebnis || {};
    return `<ul class="ia-liste ia-ergebnis">${(r.schritte || []).map(s => `<li class="${s.ok ? "ok" : "fehl"}">${I(s.ok ? "check" : "triangle-alert")} ${esc(s.text)}</li>`).join("")}</ul>
      <p class="ia-intro ia-wie-weiter">${esc(T("ia.wie_weiter", "Wie weiter?"))}</p>
      <div class="ia-wege">${WEITER.map(([id, ic, k, f]) => `<button type="button" class="ia-weg${id === "fertig" ? " fertig" : ""}" data-ia-weiter="${id}">${I(ic, 20)}<span>${esc(T(k, f))}</span></button>`).join("")}</div>`;
  }

  async function weiter(ziel) {
    const r = Z && Z.ergebnis, pfad = r && r.pfad;
    if (M) M.close();
    if (ziel === "fertig" || !pfad) return;
    log("info", "weiter: " + ziel);
    if (ziel === "tourseite") { if (window.rzTourSeite) window.rzTourSeite.oeffnen({ path: pfad, geo_hash: r.geo_hash }); return; }
    if (ziel === "schnellvideo") { if (window.rzSchnellVideo) window.rzSchnellVideo(pfad); return; }
    const modul = { medien: "geotagger", assistent: "animator", animator: "animator", tourmap: "tourmap", heightanim: "heightanim" }[ziel];
    if (!modul) return;
    if (ziel === "assistent") window.__rzVideoAssistent = null;
    const ok = await window.loadGlobalGpx(pfad, { stumm: true });
    if (ok === false) return;
    switchMod(modul);
    if (ziel !== "assistent") return;
    // wie die Tour-Seite: warten, bis der Animator die Tour geladen hat, dann den Video-Assistenten öffnen
    for (let i = 0; i < 100; i++) {
      await new Promise(res => setTimeout(res, 200));
      const f = window.__rzVideoAssistent;
      if (typeof f !== "function") continue;
      let gut = false; try { gut = await f(true); } catch (_) { gut = false; }
      if (gut) return;
    }
    if (typeof toast === "function") toast(T("va.nicht_bereit", "Die Tour lädt noch — den Video-Assistenten findest du oben im Animator."), "info", 5000);
  }

  // ── Ereignisse ─────────────────────────────────────────────────────────────────────────────────────────────────────
  function binden() {
    const $ = (id) => document.getElementById(id);
    const wahl = async (feld) => {
      const r = await api().pick_file("folder", []);   // warte-ok: Systemdialog
      const o = (r && r[0]) || "";
      if (!o || !Z) return;
      Z[feld] = o;
      try { await saveSettings({ [feld === "ordner" ? "import_eingang" : "import_ziel"]: o }, { immediate: true }); } catch (e) { log("warn", "Einstellung: " + e); }
      if (feld === "ordner") pruefen(); else zeichnen();
    };
    if ($("ia-ordner-wahl")) $("ia-ordner-wahl").onclick = () => wahl("ordner");
    if ($("ia-ziel-wahl")) $("ia-ziel-wahl").onclick = () => wahl("ziel");
    if ($("ia-track-wahl")) $("ia-track-wahl").onchange = (e) => {
      Z.trackPfad = e.target.value; Z.zuordnung = null; Z.titelVorschlaege = [];
      const x = track(); if (x) { Z.titel = x.titel || ""; Z.art = x.aktivitaet || ""; }
    };
    if ($("ia-titel")) $("ia-titel").oninput = (e) => { Z.titel = e.target.value; knoepfe(); };
    document.querySelectorAll(".ia-chip[data-titel]").forEach(b => b.onclick = () => { Z.titel = b.dataset.titel; zeichnen(); });
    if ($("ia-art")) $("ia-art").onchange = (e) => { Z.art = e.target.value; };
    if ($("ia-notiz")) $("ia-notiz").oninput = (e) => { Z.notiz = e.target.value; };
    if ($("ia-sammlung")) $("ia-sammlung").onchange = (e) => { Z.sammlung = e.target.value; zeichnen(); };
    if ($("ia-sammlung-neu")) $("ia-sammlung-neu").oninput = (e) => { Z.sammlungNeu = e.target.value; };
    if ($("ia-verorten")) $("ia-verorten").onchange = (e) => { Z.verorten = e.target.checked; };
    document.querySelectorAll("[data-ia-weiter]").forEach(b => b.onclick = () => weiter(b.dataset.iaWeiter));
    bilderSetzen();
  }

  window.openImportAssistent = openImportAssistent;
  window.__rzIa = { seite: () => (Z ? Z.seite : -1), zustand: () => (Z ? { treffer: imTrack(), trackPfad: Z.trackPfad, titel: Z.titel, art: Z.art } : null) };   // Prüfstand
})();
