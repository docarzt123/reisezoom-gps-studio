/* Exportieren aus dem Archiv (08.10.2026).
 *
 * Marc: „Das sollte auf jeden Fall auch mit Rechtsklick gehen: ‚Exportieren …‘ und dann kommt ein Dialog, in was und was
 * man exportieren will.“ — Zwei Dialoge, ein Muster:
 *   rzArchivExport.touren(pfade, name)   Track(s) als GPX · KML · KMZ · TCX · GeoJSON · CSV, eine Tour auch als Projekt
 *   rzArchivExport.medien(pfade, filter?, n?)   Fotos/Clips als Original-Kopie oder verkleinertes JPEG, auf Wunsch ohne
 *                                               Ort und Kameradaten, Dateiname wie das Original oder Datum_Uhrzeit_Ort
 * Die Originale werden nie verändert. Der Ordner/Speicherort kommt danach aus dem Systemdialog.
 */
(function () {
  "use strict";
  const T = (k, fb, v) => {
    let s = (typeof t === "function") ? t(k, fb) : fb;
    if (v) for (const [a, b] of Object.entries(v)) s = String(s).split("{" + a + "}").join(b);
    return s;
  };
  // 09.10.2026 — Strich-Symbole statt Emojis (ui/js/icons.js); Dialog-Titel sind reiner Text und bleiben ohne Zeichen
  const I = (n, g) => (typeof rzIcon === "function" ? rzIcon(n, { size: g || 14 }) : "");
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = () => (window.pywebview && window.pywebview.api) || {};
  const num = (n) => { try { return Number(n).toLocaleString((typeof i18nMeta === "function" && i18nMeta().active) || "de"); } catch (_) { return String(n); } };
  const merk = (k, v) => { try { if (v === undefined) return localStorage.getItem("rz-export-" + k); localStorage.setItem("rz-export-" + k, v); } catch (_) {} return null; };

  const FORMATE = [
    ["gpx", "GPX", () => T("export.f_gpx", "für Garmin, Komoot, Strava, Navi-Apps")],
    ["kml", "KML", () => T("export.f_kml", "für Google Earth")],
    ["kmz", "KMZ", () => T("export.f_kmz", "Google Earth, gepackt")],
    ["tcx", "TCX", () => T("export.f_tcx", "für Trainingsportale")],
    ["geojson", "GeoJSON", () => T("export.f_geojson", "für Web-Karten und GIS")],
    ["csv", "CSV", () => T("export.f_csv", "Tabelle: Punkte mit Zeit und Höhe")],
    ["rzproj", T("export.f_projekt_name", "Projekt"), () => T("export.f_projekt", "mit allen Einstellungen, für GPS Studio")],
  ];

  function touren(pfade, name) {
    pfade = (pfade || []).filter(Boolean);
    if (!pfade.length || typeof openModal !== "function") return;
    const mehrere = pfade.length > 1;
    let fmt = merk("fmt") || "gpx";
    if (mehrere && fmt === "rzproj") fmt = "gpx";
    const titel = mehrere ? T("export.touren_titel_n", "{n} Touren exportieren", { n: num(pfade.length) })
                          : T("export.tour_titel", "Tour exportieren") + (name ? ` — ${name}` : "");
    const m = openModal({
      title: titel,
      body: `<div class="ex-dialog">
          <div class="field-label">${esc(T("export.format", "Format"))}</div>
          <div class="ex-formate">${FORMATE.map(([k, l, h]) => `<label class="ex-format${mehrere && k === "rzproj" ? " ist-aus" : ""}" title="${esc(mehrere && k === "rzproj" ? T("export.projekt_nur_eine", "Ein Projekt gibt es je Tour — bitte eine Tour wählen") : "")}">
              <input type="radio" name="ex-fmt" value="${k}"${k === fmt ? " checked" : ""}${mehrere && k === "rzproj" ? " disabled" : ""}>
              <b>${esc(l)}</b><small>${esc(h())}</small></label>`).join("")}</div>
          <div class="lib-hint ex-hinweis">${esc(mehrere ? T("export.touren_ordner", "Danach wählst du einen Ordner — jede Tour wird eine eigene Datei mit ihrem Namen. Nichts wird überschrieben.")
                                            : T("export.tour_speichern", "Danach wählst du, wo die Datei hin soll — vorgeschlagen ist der Name der Tour."))}</div>
        </div>`,
      footer: `<button type="button" class="btn" id="ex-ab">${esc(T("common.cancel", "Abbrechen"))}</button>
               <button type="button" class="btn btn-primary" id="ex-ok">${I("share")} ${esc(T("export.los", "Exportieren …"))}</button>`,
    });
    document.getElementById("ex-ab").onclick = () => m.close();
    document.getElementById("ex-ok").onclick = async () => {
      const w = (document.querySelector('input[name="ex-fmt"]:checked') || {}).value || "gpx";
      merk("fmt", w);
      m.close();
      let r = null;
      try { r = await api().touren_exportieren(pfade, w); } catch (e) { r = { ok: false, error: String(e) }; }   // warte-ok: Systemdialog
      if (!r || r.cancelled) return;
      if (!r.ok) { if (typeof toast === "function") toast(r.error || "?", "error", 6000); return; }
      const ziel = r.pfad || r.ordner || "";
      if (typeof toast === "function") toast(r.n > 1 ? T("export.touren_ok", "{n} Touren gespeichert in {ort}", { n: num(r.n), ort: String(ziel).split(/[\\/]/).pop() })
                                                     : T("export.tour_ok", "Gespeichert: {ort}", { ort: String(ziel).split(/[\\/]/).pop() }), "success", 5000);
    };
  }

  function medien(pfade, filter, nGesamt) {
    pfade = (pfade || []).filter(Boolean);
    const n = pfade.length || nGesamt || 0;
    if (!n || typeof openModal !== "function") return;
    const art = merk("art") || "original", kante = merk("kante") || "2048", namen = merk("namen") || "original";
    const ohne = merk("ohne") === "1";
    const m = openModal({
      title: (n === 1 ? T("export.medien_titel_1", "Foto exportieren") : T("export.medien_titel_n", "{n} Fotos und Clips exportieren", { n: num(n) })),
      body: `<div class="ex-dialog">
          <div class="field-label">${esc(T("export.als", "Als"))}</div>
          <label class="ex-zeile"><input type="radio" name="ex-art" value="original"${art === "original" ? " checked" : ""}> <b>${esc(T("export.original", "Original kopieren"))}</b>
            <small>${esc(T("export.original_h", "unverändert, volle Qualität"))}</small></label>
          <label class="ex-zeile"><input type="radio" name="ex-art" value="jpeg"${art === "jpeg" ? " checked" : ""}> <b>${esc(T("export.jpeg", "Verkleinert als JPEG"))}</b>
            <select id="ex-kante" class="lib-select">${[["1080", "1080 px"], ["2048", "2048 px"], ["3840", "3840 px (4K)"], ["0", T("export.volle_groesse", "volle Größe")]]
              .map(([v, l]) => `<option value="${v}"${v === kante ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>
            <small>${esc(T("export.jpeg_h", "zum Teilen und für Web — auch aus RAW und HEIC"))}</small></label>
          <label class="ex-zeile ex-haken"><input type="checkbox" id="ex-ohne"${ohne ? " checked" : ""}> <b>${esc(T("export.ohne_meta", "Ort und Kameradaten entfernen"))}</b>
            <small>${esc(T("export.ohne_meta_h", "zum Teilen — GPS, Kamera und Aufnahmedaten fehlen dann in der Kopie. Videos behalten sie."))}</small></label>
          <div class="field-label" style="margin-top:10px">${esc(T("export.dateiname", "Dateiname"))}</div>
          <label class="ex-zeile"><input type="radio" name="ex-namen" value="original"${namen === "original" ? " checked" : ""}> ${esc(T("export.name_original", "wie das Original"))}</label>
          <label class="ex-zeile"><input type="radio" name="ex-namen" value="datum_ort"${namen === "datum_ort" ? " checked" : ""}> ${esc(T("export.name_datum_ort", "Datum_Uhrzeit_Ort (z. B. 2023-05-05_074212_Masca.jpg)"))}</label>
          <div class="lib-hint ex-hinweis">${esc(T("export.medien_ordner", "Danach wählst du einen Ordner. Deine Originale bleiben unverändert, nichts wird überschrieben."))}</div>
        </div>`,
      footer: `<button type="button" class="btn" id="ex-ab">${esc(T("common.cancel", "Abbrechen"))}</button>
               <button type="button" class="btn btn-primary" id="ex-ok">${I("share")} ${esc(T("export.ordner_los", "Ordner wählen und exportieren …"))}</button>`,
    });
    document.getElementById("ex-ab").onclick = () => m.close();
    document.getElementById("ex-ok").onclick = async () => {
      const opt = {
        art: (document.querySelector('input[name="ex-art"]:checked') || {}).value || "original",
        kante: +(document.getElementById("ex-kante") || {}).value || 0,
        qualitaet: 90,
        ohne_meta: !!(document.getElementById("ex-ohne") || {}).checked,
        namen: (document.querySelector('input[name="ex-namen"]:checked') || {}).value || "original",
      };
      if (!pfade.length && filter) opt.filter = filter;
      merk("art", opt.art); merk("kante", String(opt.kante)); merk("namen", opt.namen); merk("ohne", opt.ohne_meta ? "1" : "0");
      m.close();
      let r = null;
      try { r = await api().medien_exportieren(pfade, opt); } catch (e) { r = { ok: false, error: String(e) }; }   // warte-ok: Systemdialog, danach Fortschritt in der Statusbox
      if (!r || r.cancelled) return;
      if (!r.ok) { if (typeof toast === "function") toast(r.error || "?", "error", 6000); return; }
      verfolgen(r.ordner, r.gesamt || n);
    };
  }

  async function verfolgen(ordner, gesamt) {
    const S = window.rzStatus;
    if (S) S.start("medien-export", { titel: T("export.status_titel", "Medien exportieren"), text: T("export.status_start", "Startet …"),
                                      gesamt, abbrechen: true, hintergrund: true });
    let gestoppt = false;
    for (;;) {
      await new Promise(r => setTimeout(r, 400));
      if (!gestoppt && S && S.abgebrochen && S.abgebrochen("medien-export")) { gestoppt = true; try { api().medien_export_stopp(); } catch (_) {} }   // warte-ok: nur ein Signal, die Statusbox zeigt das Ende
      let st = null; try { st = await api().medien_export_status(); } catch (_) {}   // warte-ok: Fortschritt steht in der Statusbox
      if (!st) continue;
      if (S && st.laeuft) S.schritt("medien-export", { text: T("export.status_datei", "{a} von {b} · {d}", { a: num(st.n || 0), b: num(st.gesamt || gesamt), d: st.datei || "" }), n: st.n || 0, gesamt: st.gesamt || gesamt });
      if (!st.laeuft) {
        const e = st.ergebnis || {};
        const kurz = String(ordner || "").split(/[\\/]/).pop();
        if (e.ok === false) { if (S) S.fehler("medien-export", e.error || "?"); else if (typeof toast === "function") toast(e.error || "?", "error"); return; }
        const text = T("export.medien_ok", "{n} exportiert nach „{ort}“", { n: num(e.n_ok || 0), ort: kurz })
          + (e.n_fehler ? " · " + T("export.medien_fehler", "{n} nicht möglich (Original nicht erreichbar oder unlesbar)", { n: num(e.n_fehler) }) : "");
        if (S) S.fertig("medien-export", text);
        if (typeof toast === "function") toast(text, e.n_fehler ? "warn" : "success", 6000);
        return;
      }
    }
  }

  /* 08.10.2026 (Stufe 2) — „Aus diesen Fotos eine Tour machen“: die markierten Fotos mit Ort in
     Aufnahmereihenfolge verbinden (gerade oder entlang von Wegen), ins Archiv übernehmen und die Tour-Seite öffnen. */
  async function tourAusFotos(pfade) {
    pfade = (pfade || []).filter(Boolean);
    if (pfade.length < 2 || typeof openModal !== "function") {
      if (typeof toast === "function") toast(T("tour_aus_fotos.zu_wenig", "Dafür braucht es mindestens zwei Fotos mit Ort und Aufnahmezeit."), "info", 5000);
      return;
    }
    const m = openModal({
      title: T("tour_aus_fotos.titel", "Tour aus {n} Fotos machen", { n: num(pfade.length) }),
      body: `<div class="ex-dialog">
          <p class="muted" style="margin:0 0 6px">${esc(T("tour_aus_fotos.text", "Die Fotos mit Ort werden in der Reihenfolge ihrer Aufnahme verbunden — eine neue Tour im Archiv, mit Karte, Fotos und allem, was eine Tour kann."))}</p>
          <label class="field-label" for="taf-name">${esc(T("tour_aus_fotos.name_label", "Name"))}</label>
          <input type="text" id="taf-name" class="lib-input" placeholder="${esc(T("tour_aus_fotos.name_ph", "leer = Ort und Datum"))}">
          <div class="field-label" style="margin-top:8px">${esc(T("tour_aus_fotos.wie", "Verbinden"))}</div>
          ${[["gerade", T("tour_aus_fotos.gerade", "gerade Linien (Luftlinie von Foto zu Foto)")], ["walking", T("tour_aus_fotos.zu_fuss", "entlang von Wegen — zu Fuß")],
             ["cycling", T("tour_aus_fotos.rad", "entlang von Wegen — Rad")], ["driving", T("tour_aus_fotos.auto", "entlang von Straßen — Auto")]]
            .map(([k, l], i) => `<label class="ex-zeile"><input type="radio" name="taf-wie" value="${k}"${i === 0 ? " checked" : ""}> ${esc(l)}</label>`).join("")}
          <div class="lib-hint ex-hinweis">${esc(T("tour_aus_fotos.hinweis", "Fotos ohne Ort zählen nicht mit. Die Wegeführung fragt einen freien Kartendienst; klappt das nicht, werden es gerade Linien."))}</div>
        </div>`,
      footer: `<button type="button" class="btn" id="taf-ab">${esc(T("common.cancel", "Abbrechen"))}</button>
               <button type="button" class="btn btn-primary" id="taf-ok">${I("compass")} ${esc(T("tour_aus_fotos.los", "Tour anlegen"))}</button>`,
    });
    document.getElementById("taf-ab").onclick = () => m.close();
    document.getElementById("taf-ok").onclick = async () => {
      const wie = (document.querySelector('input[name="taf-wie"]:checked') || {}).value || "gerade";
      const name = (document.getElementById("taf-name") || {}).value || "";
      m.close();
      let r = null;
      try { r = await rzWarten("tour_aus_fotos", () => api().tour_aus_fotos(pfade, wie, name)); } catch (e) { r = { ok: false, error: String(e) }; }
      if (!r || !r.ok) { if (typeof toast === "function") toast((r && r.error) || "?", "error", 6000); return; }
      // ins Archiv einlesen (nur der Import-Ordner) und dann die Tour-Seite öffnen
      try { await api().library_scan_start(false, r.folder); } catch (_) {}   // warte-ok: Fortschritt unten in der Statusbox
      for (let i = 0; i < 60; i++) {
        await new Promise(res => setTimeout(res, 500));
        let st = null; try { st = await api().library_scan_status(); } catch (_) {}   // warte-ok: kurzes Nachfragen
        if (st && !st.running) break;
      }
      if (typeof toast === "function") toast(T("tour_aus_fotos.ok", "Neue Tour „{n}“ aus {f} Fotos{w}.", { n: r.name, f: num(r.n_fotos), w: r.wege ? " — " + T("tour_aus_fotos.mit_wegen", "entlang von Wegen") : "" })
        + (r.ohne_ort ? " " + T("tour_aus_fotos.ohne_ort", "{n} ohne Ort blieben weg.", { n: num(r.ohne_ort) }) : ""), "success", 6000);
      if (window.rzTourSeite) window.rzTourSeite.oeffnen({ path: r.pfad, name: r.name });
    };
  }

  /* 08.10.2026 (Beta-Tester: „Landkartenausschnitt etwas fummelig … Ort per Tastatur oder Kopiereingaben“ —
     „mehreren Clips gleichzeitig Koordinaten zuweisen“) — einen Ort für ein oder mehrere Fotos/Clips setzen: Ort suchen
     oder Koordinate einfügen (Dezimal, Grad/Minuten/Sekunden, Google-/Apple-Maps-Link), auf Wunsch per Klick in die
     kleine Karte. Geschrieben wird mit Sicherung wie beim Verorten eines einzelnen Fotos. */
  function koordinateLesen(text) {
    // 08.10.2026 (Klicktest) — macOS macht beim Tippen aus ' und " typografische Zeichen (’ “), Karten-Apps liefern ′ ″;
    // ohne das ging das „W“ verloren (16,83 statt −16,85 — der Punkt lag in der Sahara)
    const s = String(text || "").replace(/[′’‘´`]/g, "'").replace(/[″“”„]/g, '"').replace(/º/g, "°").trim();
    if (!s) return null;
    const gut = (lat, lon) => (isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) ? { lat, lon } : null;
    let m = s.match(/[@=]\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);   // …/@28.29,-16.84,15z · ?q=28.29,-16.84 · ll=
    if (m) return gut(+m[1], +m[2]);
    const dms = [...s.matchAll(/(\d+(?:[.,]\d+)?)\s*°\s*(?:(\d+(?:[.,]\d+)?)\s*'\s*)?(?:(\d+(?:[.,]\d+)?)\s*(?:"|'')\s*)?([NSEWOnsewo])?/g)];
    if (dms.length >= 2) {
      const wert = (x) => { let v = +x[1].replace(",", ".") + (x[2] ? +x[2].replace(",", ".") / 60 : 0) + (x[3] ? +x[3].replace(",", ".") / 3600 : 0);
        if (/[SWsw]/.test(x[4] || "")) v = -v; return v; };
      let a = dms[0], b = dms[1];
      if (/[EOeo]|[Ww]/.test(a[4] || "") && /[NSns]/.test(b[4] || "")) [a, b] = [b, a];   // Länge zuerst geschrieben
      return gut(wert(a), wert(b));
    }
    m = s.match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
    if (m) return gut(+m[1], +m[2]);
    m = s.match(/^(-?\d{1,2},\d+)\s*[;\s]\s*(-?\d{1,3},\d+)$/);      // deutsch: 28,2905 -16,8452
    if (m) return gut(+m[1].replace(",", "."), +m[2].replace(",", "."));
    return null;
  }

  function ortSetzen(pfade, fertig) {
    pfade = (pfade || []).filter(Boolean);
    if (!pfade.length || typeof openModal !== "function") return;
    const m = openModal({
      title: (pfade.length === 1 ? T("ort.titel_1", "Ort setzen") : T("ort.titel_n", "Ort für {n} Dateien setzen", { n: num(pfade.length) })),
      body: `<div class="ex-dialog os-dialog">
          <input type="text" id="os-q" class="lib-input" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="${esc(T("ort.ph", "Ort suchen oder Koordinate einfügen — z. B. Masca oder 28.2905, -16.8452"))}">
          <div class="os-treffer" id="os-treffer"></div>
          <div class="os-karte" id="os-karte"></div>
          <div class="os-wahl muted" id="os-wahl">${esc(T("ort.noch_keiner", "Noch kein Ort — suchen, einfügen oder in die Karte klicken."))}</div>
          <label class="ex-zeile"><input type="checkbox" id="os-adr" checked disabled> <span id="os-adr-text">${esc(T("ort.adresse", "Adresse mitschreiben"))}</span></label>
          <div class="lib-hint ex-hinweis">${esc(T("ort.hinweis", "Der Ort wird in die Dateien geschrieben — vorher legt die App von jedem Original eine Sicherung an."))}</div>
        </div>`,
      footer: `<button type="button" class="btn" id="os-ab">${esc(T("common.cancel", "Abbrechen"))}</button>
               <button type="button" class="btn btn-primary" id="os-ok" disabled>${I("map-pin")} ${esc(pfade.length === 1 ? T("ort.los_1", "Ort schreiben") : T("ort.los_n", "In {n} Dateien schreiben", { n: num(pfade.length) }))}</button>`,
      // 08.10.2026 (Durchsicht) — auch ✕ und Esc bauen die Karte ab (vorher nur die Knöpfe)
      onClose: () => { try { if (karte) karte.remove(); } catch (_) {} karte = null; window.__rzOrtKarte = null; },
    });
    let wahl = null, adresse = null, karte = null, pin = null, lib = null, lauf = 0, tmr = 0, adrTmr = 0;
    const q = document.getElementById("os-q"), tr = document.getElementById("os-treffer"), ok = document.getElementById("os-ok");
    const setzen = async (lat, lon, name) => {
      wahl = { lat, lon }; adresse = null; ok.disabled = false;
      document.getElementById("os-wahl").innerHTML = I("map-pin") + " " + esc((name ? name + " · " : "") + lat.toFixed(5) + ", " + lon.toFixed(5));
      if (karte && lib) {
        try { if (!pin) pin = new lib.Marker({ color: "#ff896b" }).setLngLat([lon, lat]).addTo(karte); else pin.setLngLat([lon, lat]);
              karte.easeTo({ center: [lon, lat], zoom: Math.max(karte.getZoom(), 12), duration: 300 }); } catch (_) {}
      }
      const c = document.getElementById("os-adr"), t2 = document.getElementById("os-adr-text");
      c.disabled = true; t2.textContent = T("ort.adresse_sucht", "Adresse wird gesucht …");
      const meinLauf = ++lauf;
      // 08.10.2026 (Klicktest) — erst fragen, wenn die Eingabe ruht: jeder Tastendruck mit erkannter Koordinate startete
      // eine eigene Adresssuche (vier gleichzeitig, je 6–9 s), der Dienst bremste sie aus, und auch die letzte kam leer zurück
      clearTimeout(adrTmr);
      await new Promise(res => { adrTmr = setTimeout(res, 600); });
      if (meinLauf !== lauf || !document.getElementById("os-adr")) return;
      let r = null; try { r = await api().fotos_adresse(lat, lon, (typeof i18nMeta === "function" && i18nMeta().active) || "de"); } catch (_) {}   // warte-ok: Zeile sagt „wird gesucht“
      if (meinLauf !== lauf || !document.getElementById("os-adr")) return;
      if (r && r.ok && r.adresse) { adresse = r.adresse; c.disabled = false; c.checked = true;
        t2.textContent = T("ort.adresse_mit", "Adresse mitschreiben: {a}", { a: [r.adresse.street, r.adresse.city, r.adresse.country].filter(Boolean).join(", ") }); }
      else { c.checked = false; t2.textContent = T("ort.adresse_keine", "Keine Adresse gefunden — nur die Koordinate wird geschrieben."); }
    };
    try {
      const c = createMap({ container: "os-karte", styleKey: (typeof rzArchivStil === "function") ? rzArchivStil() : ((typeof mapDefaultStyle === "function") ? mapDefaultStyle() : undefined),
                            common: { center: [10.4, 51.2], zoom: 3.5, attributionControl: true } });
      karte = c.map; lib = c.lib; window.__rzOrtKarte = karte;   // Prüfstand
      if (typeof rzMassstab === "function") rzMassstab(karte);
      karte.on("click", (e) => setzen(e.lngLat.lat, e.lngLat.lng, ""));
    } catch (_) {}
    q.oninput = () => {
      clearTimeout(tmr);
      const k = koordinateLesen(q.value);
      if (k) { tr.innerHTML = ""; setzen(k.lat, k.lon, T("ort.koordinate", "Koordinate")); return; }
      const text = q.value.trim();
      if (text.length < 3) { tr.innerHTML = ""; return; }
      tmr = setTimeout(async () => {
        tr.innerHTML = `<span class="muted">${esc(T("ort.sucht", "Sucht …"))}</span>`;
        let r = null; try { r = await api().route_geocode(text, 6); } catch (_) {}   // warte-ok: Trefferliste zeigt „Sucht …“
        if (q.value.trim() !== text) return;
        const hits = (r && r.ok && r.results) || [];
        tr.innerHTML = hits.length ? hits.map((h, i) => `<button type="button" class="os-hit" data-i="${i}">${I("map-pin", 13)} ${esc(h.name || "")}</button>`).join("")
                                   : `<span class="muted">${esc(T("ort.nichts", "Nichts gefunden — anders schreiben oder Koordinate einfügen."))}</span>`;
        tr.querySelectorAll("[data-i]").forEach(b => { b.onclick = () => { const h = hits[+b.dataset.i]; tr.querySelectorAll(".os-hit").forEach(x => x.classList.toggle("is-on", x === b)); setzen(+h.lat, +h.lon, h.name); }; });
      }, 350);
    };
    setTimeout(() => q.focus(), 50);
    const zu = () => { try { if (karte) karte.remove(); } catch (_) {} window.__rzOrtKarte = null; m.close(); };
    document.getElementById("os-ab").onclick = zu;
    ok.onclick = async () => {
      if (!wahl) return;
      const mitAdr = document.getElementById("os-adr").checked && adresse;
      const w = wahl; zu();
      let r = null;
      try { r = await rzWarten("fotos_verorten_mehrere", () => api().fotos_verorten_mehrere(pfade, w.lat, w.lon, mitAdr ? adresse : null)); } catch (e) { r = { ok: false, error: String(e) }; }
      if (!r || !r.ok) { if (typeof toast === "function") toast((r && (r.error || (r.fehler && r.fehler[0] && r.fehler[0].grund))) || "?", "error", 6000); return; }
      if (typeof toast === "function") toast((r.n_ok === 1 ? T("ort.ok_1", "Ort in die Datei geschrieben.") : T("ort.ok", "Ort in {n} Dateien geschrieben.", { n: num(r.n_ok) })) + (r.n_fehler ? " " + T("ort.fehler", "{n} gingen nicht (schreibgeschützt oder nicht erreichbar).", { n: num(r.n_fehler) }) : ""),
                                          r.n_fehler ? "warn" : "success", 6000);
      if (typeof fertig === "function") fertig(r);
    };
  }

  /* Doppelte Fotos/Clips (08.10.2026, Beta-Tester: „eine Menge Doppelte“). Zwei Arten:
     gleich      dieselbe Datei an zwei Stellen (Inhaltskennung) — vorgeschlagen: alle bis auf eine weg, auf einen Schlag
     fast gleich dieselbe Aufnahme, verkleinert oder anders gespeichert (Zeit ±2 s + Bildinhalt) — erst ansehen: nichts
                 ist vorgemerkt, ein Klick auf das Bild, das bleiben soll, merkt die anderen vor.
     Weggeräumt wird nie endgültig: Papierkorb oder Ordner „Doppelte (GPS Studio)“ neben dem Original. */
  function doppelte(fertig) {
    if (typeof openModal !== "function") return;
    const ov = document.getElementById("modal-overlay");
    if (ov) ov.classList.add("dp-gross");
    let res = null, reiter = "gleich", zeigen = 40;
    const weg = new Set(), bleibt = {}, thumbs = {};
    const mb = (b) => (b >= 1e9 ? (b / 1e9).toLocaleString(undefined, { maximumFractionDigits: 1 }) + " GB" : Math.max(1, Math.round((b || 0) / 1e6)) + " MB");
    const m = openModal({
      title: "⧉ " + T("dop.titel", "Doppelte Fotos und Clips"),
      body: `<div class="dp-dialog" id="dp-box"><div class="dp-laedt"><span class="ass-spinner"></span> ${esc(T("dop.sucht", "Sucht nach Doppelten …"))}</div></div>`,
      footer: `<label class="dp-wohin"><input type="radio" name="dp-wohin" value="papierkorb"${merk("dop-wohin") !== "ordner" ? " checked" : ""}> ${esc(T("dop.papierkorb", "in den Papierkorb"))}</label>
               <label class="dp-wohin" title="${esc(T("dop.ordner_tip", "Neben dem Original entsteht ein Ordner „Doppelte (GPS Studio)“ — das Einlesen lässt ihn aus."))}"><input type="radio" name="dp-wohin" value="ordner"${merk("dop-wohin") === "ordner" ? " checked" : ""}> ${esc(T("dop.ordner", "in Ordner „Doppelte (GPS Studio)“"))}</label>
               <span class="dp-spart muted" id="dp-spart"></span>
               <span style="flex:1"></span>
               <button type="button" class="btn" id="dp-ab">${esc(T("common.close", "Schließen"))}</button>
               <button type="button" class="btn btn-primary" id="dp-ok" disabled>${I("archive")} ${esc(T("dop.los0", "Wegräumen"))}</button>`,
      onClose: () => { if (ov) ov.classList.remove("dp-gross"); },
    });
    const box = () => document.getElementById("dp-box");
    const okK = () => document.getElementById("dp-ok");
    const gid = (art, i) => art + i;

    // 09.10.2026 (Marc: „man sollte auch wissen, wie viel Platz man spart“) — Größe je Pfad, Summe der Vorgemerkten
    const groesse = {};
    const spart = (pfade) => [...pfade].reduce((s2, p) => s2 + (groesse[p] || 0), 0);
    const wohinJetzt = () => (document.querySelector('input[name="dp-wohin"]:checked') || {}).value || "papierkorb";
    function knopf() {
      const k = okK(); if (!k) return;
      k.disabled = !weg.size;
      const b = spart(weg);
      k.innerHTML = I("archive") + " " + esc(weg.size ? (b ? T("dop.los_mb", "{n} wegräumen ({mb})", { n: num(weg.size), mb: mb(b) }) : T("dop.los", "{n} wegräumen", { n: num(weg.size) })) : T("dop.los0", "Wegräumen"));
      // ehrlich: im Papierkorb ist der Platz erst nach dem Leeren frei, im Ordner erst nach dessen Löschen
      const sp = document.getElementById("dp-spart");
      if (sp) sp.textContent = !b ? "" : wohinJetzt() === "ordner"
        ? T("dop.spart_ordner", "{mb} — frei wird der Platz erst, wenn du den Ordner löschst.", { mb: mb(b) })
        : T("dop.spart_pk", "Macht {mb} frei, sobald der Papierkorb geleert ist.", { mb: mb(b) });
    }
    function vorschlagen() {
      weg.clear();
      (res.gleich || []).forEach((g, i) => { bleibt[gid("g", i)] = g.behalten; g.pfade.forEach(d => { if (d.path !== g.behalten) weg.add(d.path); }); });
    }
    const gruppen = () => (reiter === "gleich" ? res.gleich : res.fast) || [];

    function kachel(d, g, key) {
      const behalt = bleibt[key] === d.path, w = weg.has(d.path);
      const ort = String(d.path || "").split(/[\\/]/).slice(-3, -1).join("/");   // der Ordner der Datei, nicht der beobachtete Hauptordner
      const mass = d.breite && d.hoehe ? `${d.breite}×${d.hoehe}` : "";
      const tu = thumbs[d.path];
      return `<div class="dp-k${behalt ? " ist-bleibt" : ""}${w ? " ist-weg" : ""}" data-dp-pfad="${esc(d.path)}" data-dp-g="${key}" title="${esc(d.path)}">
          <div class="dp-bild"${tu ? ` style="background-image:url('${tu}')"` : ""}>${d.art === "video" ? '<span class="dp-vid">▶</span>' : ""}
            ${behalt ? `<span class="dp-marke dp-m-bleibt">✓ ${esc(T("dop.bleibt", "bleibt"))}</span>` : w ? `<span class="dp-marke dp-m-weg">${I("archive", 12)} ${esc(T("dop.weg", "weg"))}</span>` : ""}</div>
          <div class="dp-name">${esc(d.dateiname || "")}</div>
          <div class="dp-info muted">${esc([mass, mb(d.size)].filter(Boolean).join(" · "))}</div>
          <div class="dp-info muted">${I("folder", 12)} ${esc(ort)}</div>
          <label class="dp-weg-l"><input type="checkbox" data-dp-weg="${esc(d.path)}"${w ? " checked" : ""}${behalt ? " disabled" : ""}> ${esc(T("dop.wegraeumen", "wegräumen"))}</label>
        </div>`;
    }

    function zeichnen() {
      const b = box(); if (!b || !res) return;
      const nG = (res.gleich || []).length, nF = (res.fast || []).length;
      if (!nG && !nF) {
        b.innerHTML = `<div class="dp-leer">${I("circle-check", 18)} ${esc(T("dop.keine", "Keine Doppelten gefunden."))}</div>${res.mit_inhalt ? "" : `<div class="lib-hint">${esc(T("dop.ohne_inhalt", "Ohne Inhaltssuche erkennt die App „fast gleich“ nur an Aufnahmezeit, Kamera und Seitenverhältnis — mit Inhaltssuche findet sie auch verkleinerte Fassungen sicherer."))}</div>`}`;
        knopf(); return;
      }
      const liste = gruppen();
      const kopf = reiter === "gleich"
        ? T("dop.kopf_gleich", "Dieselbe Datei liegt mehrfach da — {n} Fassungen sind zu viel ({mb}). Vorgemerkt ist alles bis auf eine Fassung: die größte, dann die mit Koordinate, dann das Original statt einer „Kopie“ oder eines Exports. Ein Klick auf ein Bild behält stattdessen dieses.", { n: num(res.n_gleich), mb: mb(res.bytes_gleich) })
        : T("dop.kopf_fast", "Dieselbe Aufnahme, aber nicht dieselbe Datei — etwa ein verkleinerter Export. Nichts ist vorgemerkt: Klick auf das Bild, das bleiben soll.");
      b.innerHTML = `<div class="dp-reiter">
          <button type="button" class="dp-r${reiter === "gleich" ? " is-on" : ""}" data-dp-r="gleich">${esc(T("dop.r_gleich", "Gleich"))} <b>${num(nG)}</b></button>
          <button type="button" class="dp-r${reiter === "fast" ? " is-on" : ""}" data-dp-r="fast">${esc(T("dop.r_fast", "Fast gleich"))} <b>${num(nF)}</b></button>
        </div>
        <div class="lib-hint dp-kopf">${esc(kopf)}${reiter === "fast" && !res.mit_inhalt ? " " + esc(T("dop.ohne_inhalt_kurz", "Die Inhaltssuche ist aus — die Gruppen beruhen nur auf Zeit und Kamera, darum „unsicher“.")) : ""}${reiter === "fast" && res.serien ? " " + esc(T("dop.serien", "{n} Serien (Zeitraffer, Intervallaufnahmen) zählen nicht als Doppelte.", { n: num(res.serien) })) : ""}</div>
        <div class="dp-liste">${liste.slice(0, zeigen).map((g, i) => {
          const key = gid(reiter === "gleich" ? "g" : "f", i);
          return `<div class="dp-gruppe">
            <div class="dp-g-kopf">${esc(T("dop.gruppe", "{n} Fassungen", { n: num(g.pfade.length) }))}${(() => { const b = spart(g.pfade.map(d => d.path).filter(p => weg.has(p))); return b ? ` · <b class="dp-g-spart">${esc(T("dop.gruppe_spart", "spart {mb}", { mb: mb(b) }))}</b>` : ""; })()}${g.unsicher ? ` <span class="dp-unsicher" title="${esc(T("dop.unsicher_tip", "Nur nach Aufnahmezeit, Kamera und Seitenverhältnis zugeordnet — bitte genau hinsehen."))}">${esc(T("dop.unsicher", "unsicher"))}</span>` : ""}</div>
            <div class="dp-g-bilder">${g.pfade.map(d => kachel(d, g, key)).join("")}</div></div>`;
        }).join("")}
        ${liste.length > zeigen ? `<button type="button" class="btn btn-sm" id="dp-mehr">${esc(T("dop.mehr", "Weitere {n} Gruppen zeigen", { n: num(Math.min(40, liste.length - zeigen)) }))}</button>` : ""}</div>`;
      b.querySelectorAll("[data-dp-r]").forEach(x => { x.onclick = () => { reiter = x.dataset.dpR; zeigen = 40; zeichnen(); }; });
      const mehr = b.querySelector("#dp-mehr"); if (mehr) mehr.onclick = () => { zeigen += 40; zeichnen(); };
      b.querySelectorAll(".dp-bild").forEach(x => {
        x.onclick = () => {
          const k = x.closest(".dp-k"), key = k.dataset.dpG, pfad = k.dataset.dpPfad;
          const i = +key.slice(1), g = (key[0] === "g" ? res.gleich : res.fast)[i];
          bleibt[key] = pfad;
          g.pfade.forEach(d => { if (d.path === pfad) weg.delete(d.path); else weg.add(d.path); });
          zeichnen();
        };
      });
      b.querySelectorAll("[data-dp-weg]").forEach(c => { c.onchange = () => { if (c.checked) weg.add(c.dataset.dpWeg); else weg.delete(c.dataset.dpWeg); zeichnen(); }; });
      knopf();
      bilderHolen(liste.slice(0, zeigen));
    }

    async function bilderHolen(liste) {
      const offen = [...new Set(liste.flatMap(g => g.pfade.map(d => d.path)))].filter(p => !(p in thumbs));
      for (let i = 0; i < offen.length; i += 40) {
        const teil = offen.slice(i, i + 40);
        let r = null; try { r = await api().fotos_thumbs(teil, false); } catch (_) {}   // warte-ok: Kacheln zeigen bis dahin ihre Fläche
        teil.forEach(p => { thumbs[p] = (r && r.thumbs && r.thumbs[p]) || ""; });
        const b = box(); if (!b) return;
        teil.forEach(p => { const el = [...b.querySelectorAll(".dp-k")].find(k => k.dataset.dpPfad === p); const bi = el && el.querySelector(".dp-bild"); if (bi && thumbs[p]) bi.style.backgroundImage = `url('${thumbs[p]}')`; });
      }
    }

    async function laden() {
      const b = box(); if (b) b.innerHTML = `<div class="dp-laedt"><span class="ass-spinner"></span> ${esc(T("dop.sucht", "Sucht nach Doppelten …"))}</div>`;
      let r = null; try { r = await api().fotos_doppelte(); } catch (e) { r = { ok: false, error: String(e) }; }   // warte-ok: Spinner im Dialog
      if (!box()) return;
      if (!r || !r.ok) { box().innerHTML = `<div class="dp-leer">${I("triangle-alert", 18)} ${esc((r && r.error) || "?")}</div>`; return; }
      res = r;
      [...(res.gleich || []), ...(res.fast || [])].forEach(g => g.pfade.forEach(d => { groesse[d.path] = +d.size || 0; }));
      vorschlagen();
      if (!(res.gleich || []).length && (res.fast || []).length) reiter = "fast";
      zeichnen();
    }

    document.getElementById("dp-ab").onclick = () => m.close();
    document.querySelectorAll('input[name="dp-wohin"]').forEach(x => { x.onchange = knopf; });
    okK().onclick = async () => {
      if (!weg.size) return;
      const wohin = (document.querySelector('input[name="dp-wohin"]:checked') || {}).value || "papierkorb";
      merk("dop-wohin", wohin);
      const pfade = [...weg];
      const frei = spart(pfade);
      const k = okK(); k.disabled = true; k.innerHTML = `<span class="ass-spinner"></span> ${esc(T("dop.raeumt", "Räumt weg …"))}`;
      let r = null; try { r = await api().fotos_doppelte_wegraeumen(pfade, wohin); } catch (e) { r = { ok: false, error: String(e) }; }   // warte-ok: Knopf zeigt „Räumt weg …“
      if (typeof toast === "function") {
        const satz = wohin === "ordner" ? T("dop.ok_ordner", "{n} in den Ordner „Doppelte (GPS Studio)“ verschoben.", { n: num((r && r.n_ok) || 0) })
                                        : T("dop.ok_papierkorb", "{n} in den Papierkorb gelegt — von dort lassen sie sich zurückholen.", { n: num((r && r.n_ok) || 0) })
                                          + (frei && r && r.ok && !r.n_fehler ? " " + T("dop.ok_mb", "{mb} werden frei, sobald du ihn leerst.", { mb: mb(frei) }) : "");
        toast(satz + (r && r.n_fehler ? " " + T("dop.fehler", "{n} gingen nicht (schreibgeschützt oder nicht erreichbar).", { n: num(r.n_fehler) }) : ""), r && r.ok && !r.n_fehler ? "success" : "warn", 7000);
      }
      if (typeof fertig === "function") fertig(r);
      if (box()) laden();
    };
    laden();
  }

  /* „Öffnen mit …“ (08.10.2026) — Fotos/Clips im Bildprogramm der Wahl nacharbeiten, ohne erst den Ordner zu suchen.
     macOS: Liste der Programme, die macOS für die Datei kennt (zuletzt benutzte zuerst, Standard markiert).
     Windows: gleich der System-Dialog „Öffnen mit“. */
  async function oeffnenMit(pfade) {
    pfade = (pfade || []).filter(Boolean);
    if (!pfade.length) return;
    const los = async (app) => {
      let r = null; try { r = await api().medien_oeffnen_mit(pfade, app || ""); } catch (e) { r = { ok: false, error: String(e) }; }   // warte-ok: übergibt nur an das Programm
      if (!r || !r.ok) { if (typeof toast === "function") toast((r && r.error) || "?", "error", 6000); }
    };
    if (typeof openModal !== "function") return los("");
    const m = openModal({
      title: "↗ " + (pfade.length === 1 ? T("oeffnen.titel_1", "Öffnen mit …") : T("oeffnen.titel_n", "{n} Dateien öffnen mit …", { n: num(pfade.length) })),
      body: `<div class="ex-dialog om-dialog" id="om-box"><div class="dp-laedt"><span class="ass-spinner"></span> ${esc(T("oeffnen.sucht", "Sucht passende Programme …"))}</div></div>`,
      footer: `<button type="button" class="btn" id="om-ab">${esc(T("common.cancel", "Abbrechen"))}</button>`,
    });
    document.getElementById("om-ab").onclick = () => m.close();
    let r = null; try { r = await api().medien_apps(pfade[0]); } catch (_) {}   // warte-ok: Spinner im Dialog
    const box = document.getElementById("om-box"); if (!box) return;
    if (r && r.system_dialog) { m.close(); return los(""); }
    const apps = (r && r.apps) || [];
    if (!apps.length) { m.close(); return los(""); }
    box.innerHTML = `<div class="om-liste">${apps.map((a, i) => `<button type="button" class="om-app" data-om="${i}" title="${esc(a.pfad)}">
          <span class="om-name">${esc(a.name)}</span>${a.zuletzt ? `<span class="om-marke">${esc(T("oeffnen.zuletzt", "zuletzt"))}</span>` : ""}${a.standard ? `<span class="om-marke">${esc(T("oeffnen.standard", "Standard"))}</span>` : ""}</button>`).join("")}</div>
        <div class="lib-hint ex-hinweis">${esc(T("oeffnen.hinweis", "Das Original wird im Programm geöffnet. Speichert das Programm Änderungen, liest GPS Studio sie beim nächsten Einlesen."))}</div>`;
    box.querySelectorAll("[data-om]").forEach(b => { b.onclick = () => { const a = apps[+b.dataset.om]; m.close(); los(a.pfad); }; });
  }

  window.rzArchivExport = { touren, medien, tourAusFotos, ortSetzen, koordinateLesen, doppelte, oeffnenMit };
})();
