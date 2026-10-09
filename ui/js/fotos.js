/* ──────────────────────────────────────────────────────────────────────────
 * Der Foto-Bestand im Archiv (12.09.2026)
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
  let gesamtOhneGps = null;   // 25.09.2026 — „ohne Koordinate" unter den Treffern (null = noch unbekannt)
  let stand = {};
  let ordner = [];
  let scanTimer = 0;
  let karte = null, karteLib = null, karteBereit = false, spurenAn = false;
  let auswahl = null;
  let dKarte = null;          // die kleine Karte in der Detailspalte
  let autoAn = true;          // beim Öffnen von selbst nachholen
  let scanStand = null;       // was der Scan gerade tut (für die Kopfzeile)
  let rasterBox = null;       // der Kasten, in dem das Raster steht
  let fussWache = null;       // beobachtet das Ende der Liste (Endlos-Blättern)
  let nachladend = false;
  let aufholStart = false;    // angestoßen, aber der Lauf meldet sich erst gleich
  let abgebrochen = false;    // der Mensch hat gestoppt — dann NICHT wieder von selbst
  let nachschau = null;       // Zeitpunkt des letzten vollständigen Blicks (Sekunden)
  let fernWache = 0;          // prüft, ob ein abwesendes Laufwerk zurück ist
  // 04.10.2026 — Inhaltssuche: Stand vom Backend, Zählung der letzten Suche, Sortierung der Treffer
  let inhalt = null;          // api.inhalt_status(): an, modell_da, index {n, klein}, bestand, lauf {…}
  let inhaltTreffer = null;   // r.inhalt der letzten Abfrage: {n_text, n_inhalt, art, indiziert}
  let inhaltTimer = 0;
  let inhaltTempo = null;     // { t0, d0 } — Tempo des Indizierens, für die Restzeit
  let sortierung = "relevanz";   // relevanz | zeit_neu — nur bei einer Suche
  let letzteWerte = null;        // 06.10.2026 — Kameras/Jahre des letzten Öffnens: beim nächsten Mal sofort da

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

  // 07.10.2026 (Marc: „die Mitte war schnell da, die Sidebar nicht … überall, wo man warten muss, sollte etwas kommen,
  // dass man wartet“) — solange Ordner und Zahlen unterwegs sind, ein drehender Kreis statt „0“ / „Noch kein Ordner“.
  let ordnerLaedt = false;
  // 09.10.2026 — Strich-Symbole statt Emojis (ui/js/icons.js)
  const I = (name, g, voll) => (typeof rzIcon === "function" ? rzIcon(name, { size: g || 15, fill: !!voll }) : "");
  const herz = (an, g) => I("heart", g || 15, an);   // Favorit: gefüllt, sonst nur Umriss
  const ladeHtml = (text) => `<div class="lib-nav-hint foto-laedt"><span class="ass-spinner"></span> ${esc(text)}</div>`;
  function navZeichnen() {
    if (!nav) return;
    const s = stand || {};
    const zahlOffen = ordnerLaedt && s.gesamt == null;
    const zeile = (icon, text, n, klick, an) => `
      <button class="lib-nav-item${an ? " is-on" : ""}" type="button" data-fnav="${klick}">
        <span class="lib-nav-ico">${icon}</span>
        <span class="lib-nav-txt">${esc(text)}</span>
        <span class="lib-nav-count">${zahlOffen ? `<span class="ass-spinner" title="${esc(T("fotos.zahlen_laden", "Zahlen werden geholt …"))}"></span>` : num(n)}</span>
      </button>`;

    // 08./09.10.2026 — oben Titel und Zahl, dann Sammlungen,
    // Datum, Ordner, aufklappbare Filter; Ordner verwalten und Einlesen ganz unten
    const hw = haupt || {};
    const opt = (wert, text, aktiv) => `<option value="${esc(wert)}"${String(aktiv || "") === String(wert) ? " selected" : ""}>${esc(text)}</option>`;
    const filterAn = !!(filter.jahr || filter.kamera || filter.gps);
    nav.innerHTML = `
      <div class="foto-nav-kopf" title="${esc(T("fotos.nav_hint2", "Ordner mit Fotos und Videos. Die App liest nur — Dateien ändert sie nur, wenn du ein Foto selbst bearbeitest, und sichert es vorher."))}">
        <div class="foto-nav-titel">${T("fotos.titel", "Medien")}</div>
        <div class="foto-nav-zahl muted">${zahlOffen ? "…" : esc(T("fotos.nav_zahl", "{n} Fotos und Clips").replace("{n}", num(s.gesamt || 0)))}</div>
      </div>
      <div class="lib-nav-title">${T("fotos.sammlungen", "Sammlungen")}</div>
      ${zeile(I("images"), T("fotos.alle", "Alle"), s.gesamt || 0, "alle", !filter.gps && !filter.art && !filter.ohne_zeit && !filter.mit_fehlenden && !filter.von)}
      ${zeile(I("camera"), T("fotos.nur_fotos", "Nur Fotos"), s.fotos || 0, "fotos", filter.art === "foto")}
      ${zeile(I("clapperboard"), T("fotos.nur_videos", "Nur Videos"), s.videos || 0, "videos", filter.art === "video")}
      ${zeile(I("heart"), T("fotos.favoriten", "Favoriten"), s.fav || 0, "fav", !!filter.fav)}
      ${zeile(I("pencil"), T("fotos.bearbeitet", "Bearbeitet"), s.bearbeitet || 0, "bearbeitet", !!filter.bearbeitet)}
      ${zeile(I("map-pin"), T("fotos.ohne_koordinate", "Ohne Koordinate"), s.ohne_koordinate || 0, "ohne_gps", filter.gps === "ohne")}
      ${zeile(I("clock"), T("fotos.ohne_zeit", "Ohne Aufnahmezeit"), s.ohne_zeit || 0, "ohne_zeit", !!filter.ohne_zeit)}
      ${(s.fehlt || 0) ? zeile(I("circle-help"), T("fotos.fehlende", "Nicht erreichbar"), s.fehlt, "fehlend", !!filter.mit_fehlenden) : ""}
      <button class="lib-nav-item" type="button" id="foto-nav-doppelte" title="${esc(T("dop.nav_tip", "Gleiche und fast gleiche Fotos und Clips finden und wegräumen — nie endgültig gelöscht"))}">
        <span class="lib-nav-ico">${I("copy")}</span><span class="lib-nav-txt">${esc(T("dop.nav", "Doppelte suchen …"))}</span></button>

      <div class="lib-nav-title foto-nav-alben-kopf" style="margin-top:12px">${T("fotos.alben", "Alben")}
        <button type="button" class="foto-nav-plus" id="foto-album-neu" title="${esc(T("fotos.album_neu", "Neues Album …"))}">＋</button></div>
      ${alben.length ? alben.map((a, i) => `<button class="lib-nav-item${+filter.album === a.id ? " is-on" : ""}" type="button" data-falbum="${i}">
          <span class="lib-nav-ico">${I("book-image")}</span><span class="lib-nav-txt">${esc(a.name)}</span><span class="lib-nav-count">${num(a.n)}</span></button>`).join("")
        : `<div class="lib-nav-hint">${esc(T("fotos.alben_leer", "Noch kein Album — Fotos markieren und „Zu Album …“."))}</div>`}
      ${datumsBaumRahmen()}
      ${ordnerBaumRahmen()}
      <details class="foto-nav-filter"${filterAn ? " open" : ""}>
        <summary class="lib-nav-title">${T("fotos.filter_titel", "Filter")}${filterAn ? ` <span class="foto-nav-filter-an">●</span>` : ""}</summary>
        <label class="foto-nav-feld"><span class="muted">${esc(T("fotos.filter_jahr", "Jahr"))}</span>
          <select id="foto-jahr" class="lib-select">${opt("", T("fotos.jahr_alle", "Alle Jahre"), filter.jahr)}${(hw._jahre || []).map(j => opt(j.jahr, `${j.jahr} (${num(j.n)})`, filter.jahr)).join("")}</select></label>
        <label class="foto-nav-feld"><span class="muted">${esc(T("fotos.filter_kamera", "Kamera"))}</span>
          <select id="foto-kamera" class="lib-select">${opt("", T("fotos.kamera_alle", "Alle Kameras"), filter.kamera)}${(hw._kameras || []).map(k => opt(k.kamera, `${k.kamera} (${num(k.n)})`, filter.kamera)).join("")}</select></label>
        <label class="foto-nav-feld"><span class="muted">${esc(T("fotos.filter_ort", "Ort"))}</span>
          <select id="foto-gps" class="lib-select">${opt("", T("fotos.gps_egal", "Mit und ohne Koordinate"), filter.gps)}${opt("mit", T("fotos.gps_mit", "Nur mit Koordinate"), filter.gps)}${opt("ohne", T("fotos.gps_ohne", "Nur ohne Koordinate"), filter.gps)}</select></label>
      </details>
      <div class="lib-nav-title" style="margin-top:14px">${T("fotos.ordner_titel", "Fotoordner")}</div>
      <div id="foto-ordner-liste"></div>
      <button class="btn btn-primary btn-sm" id="foto-ordner-add" type="button" style="margin-top:6px;white-space:nowrap">
        ${I("folder-plus")} ${T("fotos.ordner_add", "Ordner hinzufügen …")}</button>
      <button class="btn btn-ghost btn-sm" id="foto-scan" type="button">
        ${T("fotos.scan", "Einlesen")}</button>
      <div id="foto-scan-stand" class="lib-nav-hint"></div>
      <label class="foto-auto" title="${T("fotos.auto_tip", "Weiterlesen, wo der letzte Lauf aufhörte, und höchstens alle sechs Stunden nachsehen, ob sich in den Ordnern etwas geändert hat — beim Öffnen und still im Hintergrund, auch wenn die App einfach offen bleibt.")}">
        <input type="checkbox" id="foto-auto"${autoAn ? " checked" : ""}>
        <span>${T("fotos.auto", "Von selbst aktuell halten")}</span>
      </label>
      <div id="foto-inhalt-stand" class="lib-nav-hint foto-inh-nav">${inhaltNavHtml()}</div>
      ${(s.ungelesen || 0) ? `<div class="lib-nav-hint">${T("fotos.ungelesen", "{n} Dateien noch ohne Aufnahmedaten").replace("{n}", num(s.ungelesen))}</div>` : ""}
    `;

    const box = nav.querySelector("#foto-ordner-liste");
    if (box) {
      box.innerHTML = ordner.length
        ? ordner.map((o, i) => ordnerZeile(o, i)).join("")
        : ordnerLaedt ? ladeHtml(T("fotos.ordner_laden", "Fotoordner werden geprüft …"))
        : `<div class="lib-nav-hint">${T("fotos.ordner_leer", "Noch kein Ordner. „Ordner hinzufügen“ nimmt einen auf; Unterordner kommen mit.")}</div>`;
      box.querySelectorAll("[data-fverb]").forEach(b => {
        b.onclick = () => { const o = ordner[+b.dataset.fverb]; if (o) laufwerkVerbinden(o); };
      });
      box.querySelectorAll("[data-fordweg]").forEach(b => {
        b.onclick = async () => {
          const o = ordner[+b.dataset.fordweg];
          if (!o) return;
          const ok = await window.rzConfirm(
            T("fotos.ordner_entfernen", "Ordner nicht mehr beobachten"),
            T("fotos.ordner_entfernen_frage", "„{p}“ verschwindet aus dem Bestand. Die Dateien selbst bleiben unberührt.").replace("{p}", o.path),
            T("fotos.ordner_entfernen_ok", "Entfernen"), false);
          if (!ok) return;
          const r = await rzWarten("fotos_ordner_weg", () => api().fotos_ordner_weg(o.path, true)).catch((e) => ({ ok: false, error: String(e) }));
          if (r && r.ok) { ordner = r.ordner || []; stand = r.stand || stand; await filterwerteLaden(); navZeichnen(); neuLaden(); }
          else if (r && r.error) toast(r.error, "warn");
        };
      });
    }

    nav.querySelectorAll("[data-fnav]").forEach(b => {
      b.onclick = () => {
        const w = b.dataset.fnav;
        filter = Object.assign({}, filter);
        delete filter.art; delete filter.gps; delete filter.ohne_zeit; delete filter.mit_fehlenden; delete filter.fav; delete filter.album; delete filter.bearbeitet;
        if (w === "alle") { delete filter.von; delete filter.bis; delete filter.verz; }   // 04.10.2026 — wie „Alle Fotos" in Lightroom
        if (w === "fotos") filter.art = "foto";
        else if (w === "videos") filter.art = "video";
        else if (w === "ohne_gps") filter.gps = "ohne";
        else if (w === "ohne_zeit") filter.ohne_zeit = true;
        else if (w === "fehlend") filter.mit_fehlenden = true;
        else if (w === "fav") filter.fav = 1;
        else if (w === "bearbeitet") filter.bearbeitet = 1;
        navZeichnen();
        if (w === "alle") zeichnen();
        neuLaden();
      };
    });

    nav.querySelectorAll("#foto-jahr, #foto-kamera, #foto-gps").forEach(el => {
      const feld = { "foto-jahr": "jahr", "foto-kamera": "kamera", "foto-gps": "gps" }[el.id];
      el.onchange = () => {
        const v = el.value;
        filter = Object.assign({}, filter);
        if (v) filter[feld] = (feld === "jahr") ? +v : v; else delete filter[feld];
        if (feld === "jahr") { delete filter.von; delete filter.bis; }   // 04.10.2026 — nur eine Datumsauswahl gleichzeitig
        navZeichnen();
        neuLaden();
      };
    });
    nav.querySelectorAll("[data-falbum]").forEach(b => {
      const a = alben[+b.dataset.falbum];
      b.onclick = () => {
        filter = Object.assign({}, filter);
        delete filter.art; delete filter.gps; delete filter.ohne_zeit; delete filter.mit_fehlenden; delete filter.fav;
        filter.album = a.id;
        navZeichnen(); neuLaden();
      };
      b.oncontextmenu = (e) => {   // Umbenennen / Album löschen (die Fotos bleiben)
        e.preventDefault();
        document.querySelectorAll(".ts-menue").forEach(x => x.remove());
        const menue = document.createElement("div");
        menue.className = "lib-ctxmenu ts-menue";
        menue.style.left = e.clientX + "px"; menue.style.top = e.clientY + "px";
        menue.innerHTML = `<button type="button" class="lib-ctx-item" data-x="um">${I("pencil")} ${esc(T("fotos.album_umbenennen", "Umbenennen …"))}</button>
          <button type="button" class="lib-ctx-item is-danger" data-x="weg">✕ ${esc(T("fotos.album_weg", "Album löschen (Fotos bleiben)"))}</button>`;
        document.body.appendChild(menue);
        const zu = (ev) => { if (!menue.contains(ev.target)) { menue.remove(); document.removeEventListener("mousedown", zu, true); } };
        setTimeout(() => document.addEventListener("mousedown", zu, true), 0);
        menue.querySelector('[data-x="um"]').onclick = async () => {
          menue.remove();
          const name = await nameFragen(T("fotos.album_umbenennen", "Umbenennen …"), a.name); if (!name) return;
          const w = await api().fotos_album_aendern(a.id, name, false).catch(() => null);   // warte-ok: schreibt eine Zeile
          if (w && w.ok) { alben = w.alben; navZeichnen(); }
        };
        menue.querySelector('[data-x="weg"]').onclick = async () => {
          menue.remove();
          const ja = await window.rzConfirm(T("fotos.album_weg", "Album löschen (Fotos bleiben)"),
            T("fotos.album_weg_frage", "Das Album „{a}“ wird gelöscht. Die Fotos selbst bleiben unberührt.").replace("{a}", a.name), T("common.delete", "Löschen"), true);
          if (!ja) return;
          const w = await api().fotos_album_aendern(a.id, "", true).catch(() => null);   // warte-ok: löscht nur Zeilen
          if (w && w.ok) { alben = w.alben; if (+filter.album === a.id) { filter = Object.assign({}, filter); delete filter.album; neuLaden(); } navZeichnen(); }
        };
      };
    });
    const albNeu = nav.querySelector("#foto-album-neu");
    if (albNeu) albNeu.onclick = async () => {
      const name = await nameFragen(T("fotos.album_neu", "Neues Album …"), ""); if (!name) return;
      const w = await api().fotos_album_neu(name, [...markiert]).catch(() => null);   // warte-ok: schreibt nur Zeilen
      if (w && w.ok) { alben = w.alben; navZeichnen(); }
    };
    const dop = nav.querySelector("#foto-nav-doppelte");
    if (dop) dop.onclick = () => window.rzArchivExport && window.rzArchivExport.doppelte(async () => {
      const r = await api().fotos_ordner().catch(() => null);   // warte-ok: Zahlen links frischen still auf
      if (r && r.ok && angemeldet) { ordner = r.ordner || []; stand = r.stand || stand; navZeichnen(); }
      neuLaden(true);
    });
    datumsBaumFuellen();
    ordnerBaumFuellen();
    inhaltBinden(nav.querySelector("#foto-inhalt-stand"));   // Audit C-6: Knopf sofort bedienbar, nicht erst beim nächsten Tick

    const add = nav.querySelector("#foto-ordner-add");
    if (add) add.onclick = async () => {
      add.disabled = true;
      try {
        const r = await api().fotos_ordner_hinzu("", true); // warte-ok: Systemdialog
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
    const auto = nav.querySelector("#foto-auto");
    if (auto) auto.onchange = async () => {
      autoAn = !!auto.checked;
      try { await api().settings_set({ fotos_auto: autoAn }); } catch (_) {}
      if (autoAn) aufholen();
    };
  }

  // ── Einlesen ────────────────────────────────────────────────────────────

  /* Beim Öffnen weitermachen, wo der letzte Lauf aufhörte — und ab und zu
     nachsehen, ob sich in den Ordnern etwas geändert hat. Marc, 12.09.2026:
     „wenn ich einen ordner hinzugefügt habe, dann will ich doch auch, dass der
     gemonitort wird." Das Nachsehen kostet auf einem NAS Minuten, deshalb
     höchstens alle sechs Stunden; das Weiterlesen fasst nur an, was ohnehin
     dran ist. */
  async function aufholen(sagen) {
    if (abgebrochen) return null;
    aufholStart = true;
    kopfAuffrischen();
    const r = await api().fotos_aufholen().catch(() => null);
    if (r && r.gestartet) {
      scanBeobachten();
    } else {
      aufholStart = false;
      kopfAuffrischen();
    }
    // 18.09.2026 (Marc: „was tatsächlich passiert, sieht man nicht") — nach „Laufwerk wieder da" sagen, WAS nun geschieht
    if (sagen) toast(aufholText(r), "success", 7000);
    return r;
  }
  function aufholText(r) {
    const vorn = T("fotos.fern_da", "Laufwerk wieder da.") + " ";
    const tun = (r && r.tun) || {};
    if (r && r.gestartet) {
      return vorn + (tun.nachschau_faellig
        ? T("fotos.fern_tut_nachschau", "Die App sieht jetzt in den Ordnern nach neuen und geänderten Dateien und liest sie ein — der Stand steht oben.")
        : T("fotos.fern_tut_ungelesen", "Die App liest jetzt {n} noch ungelesene Dateien ein — der Stand steht oben.").replace("{n}", num(tun.ungelesen || 0)));
    }
    if (r && r.grund === "abgeschaltet") return vorn + T("fotos.fern_tut_aus", "Das selbstständige Einlesen ist abgeschaltet — „Jetzt einlesen“ startet es von Hand.");
    const wann = tun.letzte_nachschau ? zeitpunktText(tun.letzte_nachschau) : "";
    return vorn + T("fotos.fern_tut_nichts", "Es ist nichts zu tun: alles ist eingelesen, zuletzt nachgesehen {t}. Die nächste Nachschau kommt von selbst.").replace("{t}", wann || "—");
  }

  async function scanStarten() {
    abgebrochen = false;
    if (!ordner.length) {
      toast(T("fotos.kein_ordner", "Erst einen Fotoordner hinzufügen."), "info");
      return;
    }
    const r = await api().fotos_scan_start().catch(() => null);
    if (!r || !r.ok) { toast((r && r.error) || "?", "warn"); return; }
    scanBeobachten();
  }

  /* 04.10.2026 (Marc, Lightroom-Screenshot: „wie ich das gern hätte mit der Datumsauswahl") — „Nach Datum" in der
     Seitenleiste: Jahr → Monat → Tag („Mittwoch, 4. März"), je mit Anzahl, aufklappbar wie in Lightroom; ein Klick
     zeigt genau diesen Zeitraum (Filter von/bis auf den Aufnahmetag). Daten: api.fotos_datumsbaum (alle Tage, ohne
     Datumsfilter); auf-/zugeklappt wird je Gerät gemerkt. */
  const DB_KEY = "rz-fotos-datumsbaum";
  let dbTage = null, dbSchluessel = "", dbLaedt = false;
  const dbOffen = rzBaum.offenLaden(DB_KEY);
  function dbMerken() { rzBaum.offenMerken(DB_KEY, dbOffen); }
  /** Text des aktiven Datumsfilters — für den Chip in der Leiste (Bausteine: rzBaum in ui/js/util.js). */
  function datumsFilterText() { return rzBaum.datumText(filter.von, filter.bis); }
  function datumsBaumRahmen() {
    const auf = dbOffen.has("wurzel");
    return rzBaum.kopfHtml("foto-db-kopf", auf, I("calendar"), T("fotos.nach_datum", "Nach Datum"))
      + `<div id="foto-datumsbaum" class="foto-datumsbaum"${auf ? "" : " hidden"}></div>`;
  }
  async function datumsBaumFuellen() {
    const box = nav && nav.querySelector("#foto-datumsbaum");
    const kopf = nav && nav.querySelector("#foto-db-kopf");
    if (kopf) kopf.onclick = () => {
      if (dbOffen.has("wurzel")) dbOffen.delete("wurzel"); else dbOffen.add("wurzel");
      dbMerken(); navZeichnen();
    };
    if (!box) return;
    // Baum hängt an Art/Kamera/Koordinate (nicht am Datum) und am Bestand — bei Änderung neu holen
    const basis = Object.fromEntries(Object.entries(filter).filter(([k]) => !["von", "bis", "jahr", "suche", "aehnlich"].includes(k)));
    // Audit C-15: wie der Ordnerbaum ohne Text- und Ähnlich-Suche — beide zählen über die Trefferliste, nicht über den Baum
    const schluessel = JSON.stringify(basis) + "|" + ((stand && stand.gesamt) || 0);
    if (dbTage && schluessel === dbSchluessel) { datumsBaumZeichnen(box); return; }
    if (dbTage) datumsBaumZeichnen(box);
    if (dbLaedt) return;
    dbLaedt = true;
    if (!dbTage) box.innerHTML = ladeHtml(T("fotos.baum_laden", "wird geladen …"));
    try {
      const r = await api().fotos_datumsbaum(basis);
      if (r && r.ok) { dbTage = r.tage || []; dbSchluessel = schluessel; }
    } catch (_) {} finally { dbLaedt = false; }
    const b2 = nav && nav.querySelector("#foto-datumsbaum");
    if (b2) datumsBaumZeichnen(b2);
  }
  function datumsBaumZeichnen(box) {
    if (!(dbTage || []).length) { box.innerHTML = `<div class="lib-nav-hint">${esc(T("fotos.nach_datum_leer", "Noch keine Fotos mit Aufnahmezeit."))}</div>`; return; }
    box.innerHTML = rzBaum.datumHtml(dbTage, dbOffen, filter.von, filter.bis);
    box.querySelectorAll("[data-dbauf]").forEach(b => {
      b.onclick = (e) => { e.stopPropagation(); const k = b.dataset.dbauf; if (dbOffen.has(k)) dbOffen.delete(k); else dbOffen.add(k); dbMerken(); datumsBaumZeichnen(box); };
    });
    box.querySelectorAll("[data-dbwahl]").forEach(b => { b.onclick = () => datumWaehlen(b.dataset.dbwahl); });
  }
  /** Zeitraum wählen (Regel in rzBaum.datumKlick: Jahr/Monat klappen um wie der Pfeil — Marc, 04.10.2026). */
  function datumWaehlen(k) {
    filter = Object.assign({}, filter);
    const neu = rzBaum.datumKlick(k, dbOffen, filter.von, filter.bis);
    dbMerken();
    if (neu.von) { filter.von = neu.von; filter.bis = neu.bis; delete filter.jahr; } else { delete filter.von; delete filter.bis; }
    navZeichnen();
    zeichnen();
    neuLaden();
  }

  /* 04.10.2026 (Marc: „wenn ich einen Ordner im NAS angebe, nimmt er ja auch alle Unterordner. Aber sehen tu ich die
     nirgends … dass man sich auch da durchklicken kann") — „📁 Nach Ordner" unter „Nach Datum", genauso bedient.
     Daten: api.fotos_ordnerbaum (Anzahl je Verzeichnis), Baum aus rzBaum. Filter `verz` = Ordner samt Unterordnern. */
  const OB_KEY = "rz-fotos-ordnerbaum";
  let obDaten = null, obSchluessel = "", obLaedt = false;
  const obOffen = rzBaum.offenLaden(OB_KEY);
  function obMerken() { rzBaum.offenMerken(OB_KEY, obOffen); }
  function obWurzelText(p) { const o = ordner.find(x => x.path === p); return o ? ordnerTitel(o) : p; }
  /** „Fotos › 2024 › Island" — für den Chip. */
  function obTitel(pfad) { return rzBaum.ordnerText(pfad, ordner.map(o => o.path), obWurzelText); }
  function ordnerBaumRahmen() {
    const auf = obOffen.has("wurzel");
    return rzBaum.kopfHtml("foto-ob-kopf", auf, I("folder"), T("fotos.nach_ordner", "Nach Ordner"))
      + `<div id="foto-ordnerbaum" class="foto-datumsbaum"${auf ? "" : " hidden"}></div>`;
  }
  async function ordnerBaumFuellen() {
    const box = nav && nav.querySelector("#foto-ordnerbaum");
    const kopf = nav && nav.querySelector("#foto-ob-kopf");
    if (kopf) kopf.onclick = () => {
      if (obOffen.has("wurzel")) obOffen.delete("wurzel"); else obOffen.add("wurzel");
      obMerken(); navZeichnen();
    };
    if (!box) return;
    const basis = Object.fromEntries(Object.entries(filter).filter(([k]) => !["verz", "suche", "aehnlich"].includes(k)));
    const schluessel = JSON.stringify(basis) + "|" + ((stand && stand.gesamt) || 0) + "|" + ordner.map(o => o.path).join(",");
    if (obDaten && schluessel === obSchluessel) { ordnerBaumZeichnen(box); return; }
    if (obDaten) ordnerBaumZeichnen(box);
    if (obLaedt) return;
    obLaedt = true;
    if (!obDaten) box.innerHTML = ladeHtml(T("fotos.baum_laden", "wird geladen …"));
    try {
      const r = await api().fotos_ordnerbaum(basis);
      if (r && r.ok) { obDaten = r; obSchluessel = schluessel; }
    } catch (_) {} finally { obLaedt = false; }
    const b2 = nav && nav.querySelector("#foto-ordnerbaum");
    if (b2) ordnerBaumZeichnen(b2);
  }
  function ordnerBaumZeichnen(box) {
    const html = obDaten ? rzBaum.ordnerHtml(obDaten, obOffen, filter.verz, obWurzelText) : "";
    if (!html) { box.innerHTML = `<div class="lib-nav-hint">${esc(T("fotos.nach_ordner_leer", "Noch kein Fotoordner."))}</div>`; return; }
    box.innerHTML = html;
    box.querySelectorAll("[data-obauf]").forEach(b => {
      b.onclick = (e) => { e.stopPropagation(); const k = b.dataset.obauf; if (obOffen.has(k)) obOffen.delete(k); else obOffen.add(k); obMerken(); ordnerBaumZeichnen(box); };
    });
    box.querySelectorAll("[data-obwahl]").forEach(b => { b.onclick = () => ordnerWaehlen(b.dataset.obwahl, box); });
  }
  function ordnerWaehlen(k, box) {
    filter = Object.assign({}, filter);
    const hatKinder = !!box.querySelector(`[data-obauf="${CSS.escape(k)}"]`);
    const neu = rzBaum.ordnerKlick(k, hatKinder, obOffen, filter.verz);
    obMerken();
    if (neu) filter.verz = neu; else delete filter.verz;
    navZeichnen();
    zeichnen();
    neuLaden();
  }

  let letztePhase = "", letztesNachziehen = 0;
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
      scanStand = st;
      if (st.running) aufholStart = false;
      kopfAuffrischen();
      // Auch im großen Kasten unten rechts anzeigen — dann sieht man den
      // Fortschritt, selbst wenn man inzwischen im Animator arbeitet
      // (Marc, 12.09.2026: „überall visuelles Feedback").
      if (window.rzStatus) {
        // 18.09.2026 — derselbe Klartext wie in der Kopfzeile (auch im Kasten unten rechts)
        const phase2 = scanSchrittText(st) + " · " + scanStandText(st) + (st.aktuell ? " · " + kurzPfad(st.aktuell) : "");
        const gesamtJetzt = st.phase === "dateien" ? (st.erwartet || 0) : (st.total || 0);
        if (st.running) {
          if (!window.rzStatus.laeuft("foto-scan")) {
            window.rzStatus.start("foto-scan", { titel: T("fotos.titel", "Medien"),
                                                 text: phase2, gesamt: gesamtJetzt,
                                                 abbrechen: true,
                                                 // Liest im Hintergrund weiter — niemand wartet darauf.
                                                 hintergrund: true });
          }
          window.rzStatus.schritt("foto-scan", { text: phase2, n: Math.min(st.done || 0, gesamtJetzt || (st.done || 0)),
                                                 gesamt: gesamtJetzt });
          if (window.rzStatus.abgebrochen("foto-scan")) api().fotos_scan_stop();
        } else if (window.rzStatus.laeuft("foto-scan")) {
          window.rzStatus.fertig("foto-scan",
            st.error ? String(st.error) : fernText(st));
        }
      }
      if (box) {
        if (st.running) {
          // 13.09.2026 (Echt-App-Test): Abbrechen steht schon in der Kopfzeile und im
          // Kasten unten rechts — ein dritter Knopf hier machte es nur unübersichtlicher.
          box.textContent = scanSchrittText(st) + " — " + scanStandText(st);
        } else {
          box.textContent = st.error ? String(st.error) : fernText(st);
        }
      }
      // Kein „Einlesen", während schon eingelesen wird (Marc, 12.09.2026: „liest er jetzt
      // ein oder nicht?") — der Knopf verschwindet, statt nur grau zu werden.
      if (knopf) { knopf.disabled = !!st.running; knopf.hidden = !!st.running; }
      if (st.running) {
        // Während des ersten Durchgangs wächst die Liste — einmal je Sekunde
        // nachziehen reicht, sonst flackert es.
        // 14.09.2026 (Nachttest): Bei 2836 Dateien war der erste Durchgang schneller als ein
        // Takt, das Tausender-Fenster traf nie — das Raster zeigte „0 Dateien, noch keine
        // Fotos", während längst eingelesen wurde. Jetzt: beim Phasenwechsel und danach alle
        // 3 s nachziehen, solange die Ansicht noch nicht mal eine Seite voll hat.
        const jetzt = Date.now();
        const phasenWechsel = st.phase !== letztePhase;
        letztePhase = st.phase;
        if (phasenWechsel || (geladen.length < SEITE && jetzt - letztesNachziehen > 3000)) {
          letztesNachziehen = jetzt;
          neuLaden(true);
        }
        scanTimer = setTimeout(tick, 900);
      } else {
        restAnz = null; tempoMess = null;   // Audit C-4: der nächste Lauf startet mit frischer Restzeit
        stand = st.stand || stand;
        try {
          const r = await api().fotos_ordner();
          if (r && r.ok) { ordner = r.ordner || []; stand = r.stand || stand; nachschau = r.nachschau || nachschau; }
        } catch (_) {}
        // 25.09.2026 (Klicktest FO-05: Kameramenü nur „Alle Kameras") — Kameras und Jahre
        // wurden nur beim Öffnen gezählt; was erst danach eingelesen wurde, fehlte im Menü.
        await filterwerteLaden();
        navZeichnen();
        neuLaden();
      }
    };
    tick();
  }

  // ── Laden ───────────────────────────────────────────────────────────────

  // Zwei Ladevorgänge gleichzeitig hängten dieselbe Seite zweimal an (im
  // Prüfstand: 20 Kacheln statt 10). Seit das Aufholen im Hintergrund die
  // Ansicht nachzieht, passiert das leicht — also eine Laufnummer.
  let ladeLauf = 0;

  async function neuLaden(leise) {
    // 06.10.2026 (Marc: „zurück auf Fotos gewechselt, da musste er sie wieder einlesen") — die bisherige Seite bleibt
    // stehen, bis die neue da ist (vorher hier geleert: lief das Einlesen, frischte es auch bei unsichtbarer Ansicht auf,
    // und beim Zurückkommen war die „letzte Ansicht“ weg). Unsichtbar wird gar nicht aufgefrischt.
    if (!angemeldet) return;
    ladeLauf++;
    if (!leise) { markiert.clear(); _letzterKlick = -1; }   // neuer Filter = neue Auswahl (das stille Auffrischen behält sie)
    await mehrLaden(leise, true);
  }

  async function mehrLaden(leise, neu) {
    const lauf = ladeLauf;
    const ab = neu ? 0 : geladen.length;
    nachladend = true;
    try {
      const r = await api().fotos_abfrage({   // warte-ok: Endlos-Blättern lädt still nach
        filter: filter, limit: SEITE, offset: ab, mit_thumbs: true,
        sortierung: (filter.suche || filter.aehnlich) ? sortierung : "zeit_neu",
      }).catch(() => null);
      if (lauf !== ladeLauf || !angemeldet) return;   // inzwischen überholt
      if (!r || !r.ok) { if (!leise) toast((r && r.error) || "?", "warn"); return; }
      gesamt = r.n || 0;
      if (!ab) inhaltTreffer = r.inhalt || null;
      if (r.ohne_koordinate != null) gesamtOhneGps = r.ohne_koordinate;   // nur mit der ersten Seite
      geladen = neu ? (r.fotos || []) : geladen.concat(r.fotos || []);
      // Beim Weiterblättern nur anhängen: ein vollständiges Neuzeichnen würde
      // die Ansicht nach oben reißen und bei tausenden Kacheln hängen.
      if (ab && ansicht === "raster") rasterAnhaengen(ab);
      else zeichnen();
    } finally {
      nachladend = false;
    }
    thumbsNachholen();          // absichtlich ohne await: die Seite steht schon
  }

  /* Vorschaubilder, die noch nicht im Cache liegen, in Häppchen nachholen.
     Ein Video-Vorschaubild dauert Sekunden — 240 am Stück waren Minuten
     Stille. Jetzt steht die Seite sofort und die Bilder tröpfeln herein, mit
     sichtbarem Fortschritt und Abbrechen (Marc, 12.09.2026: „überall
     userfeedback"). */
  const THUMB_HAPPEN = 12;
  let thumbLauf = 0;

  async function thumbsNachholen() {
    const lauf = ++thumbLauf;
    const offen = geladen.filter(f => !f.thumb_url).map(f => f.path);
    if (!offen.length) { schaerfen(lauf); return; }
    // Laufwerk weg: Was nicht im Speicher liegt, lässt sich jetzt nicht bauen.
    // Kein Fortschrittsbalken über Bilder, die gar nicht kommen können.
    if (ordner.length && ordner.every(o => !o.da)) return;
    if (window.rzStatus) {
      window.rzStatus.start("foto-thumbs", {
        titel: T("fotos.titel", "Medien"),
        text: T("fotos.thumbs_holen", "Vorschaubilder erzeugen"),
        gesamt: offen.length, abbrechen: true,
        hintergrund: true,   // man blättert weiter, während die Kacheln kommen
      });
    }
    let fertig = 0;
    for (let i = 0; i < offen.length; i += THUMB_HAPPEN) {
      if (lauf !== thumbLauf || !angemeldet) break;
      if (window.rzStatus && window.rzStatus.abgebrochen("foto-thumbs")) break;
      const teil = offen.slice(i, i + THUMB_HAPPEN);
      const r = await api().fotos_thumbs(teil).catch(() => null);
      if (lauf !== thumbLauf || !angemeldet) break;
      const bilder = (r && r.thumbs) || {};
      const schnell = new Set((r && r.schnell) || []);   // 09.10.2026: eingebettetes Vorschaubild — schaerfen() holt das scharfe
      let neu = 0;
      geladen.forEach((f) => {
        if (!f.thumb_url && bilder[f.path]) { f.thumb_url = bilder[f.path]; neu++; }
        if (schnell.has(f.path)) f.thumb = 2;
      });
      fertig += teil.length;
      if (neu) bilderEinsetzen(bilder);
      if (window.rzStatus) {
        window.rzStatus.schritt("foto-thumbs", {
          n: fertig, gesamt: offen.length,
          text: T("fotos.thumbs_holen", "Vorschaubilder erzeugen"),
        });
      }
    }
    // Audit K-4: läuft das Einlesen, kein zweiter Kasten „Fotos · Fertig" unter „Schritt 2 von 3 …" — leise weg
    if (window.rzStatus && lauf === thumbLauf) {
      if (window.rzStatus.laeuft("foto-scan")) window.rzStatus.ende("foto-thumbs");
      else window.rzStatus.fertig("foto-thumbs", "");
    }
    if (lauf === thumbLauf) schaerfen(lauf);
  }

  /* 06.10.2026 (Marc: „B ja") — Schritt 3 legt fürs Raster das kleine eingebettete EXIF-Vorschaubild ab (thumb = 2,
     ~2 % der Daten). Was gerade zu sehen ist, wird still durch ein scharfes ersetzt — ohne Fortschrittskasten. */
  const _schaerfenFehl = new Set();
  let _schaerfenLaeuft = false, _schaerfenZeit = 0;
  async function schaerfen(lauf) {
    if (ordner.length && ordner.every(o => !o.da)) return;      // Laufwerk weg: dann bleibt das Schnellbild
    // Review 06.10.2026: nur was zu sehen ist (plus ein Bildschirm darunter) — nach langem Blättern las das sonst
    // tausende Fotos übers NAS. Was sich nicht schärfen lässt, wird in dieser Sitzung nicht wieder versucht.
    if (_schaerfenLaeuft) return;
    const sichtEl = (rasterBox && rasterBox.isConnected) ? rasterBox : haupt;
    const sicht = sichtEl ? sichtEl.getBoundingClientRect() : null;
    const imBild = (idx) => {
      if (!sicht) return true;
      const k = haupt.querySelector(`.foto-kachel[data-foto="${idx}"]`); if (!k) return false;
      const r = k.getBoundingClientRect();
      return r.bottom >= sicht.top - 50 && r.top <= sicht.bottom + sicht.height;
    };
    const offen = geladen.map((f, idx) => (f.thumb === 2 && !_schaerfenFehl.has(f.path) && imBild(idx)) ? f.path : null).filter(Boolean);
    _schaerfenLaeuft = true;
    try { for (let i = 0; i < offen.length; i += THUMB_HAPPEN) {
      if (lauf !== thumbLauf || !angemeldet) return;
      const teil = offen.slice(i, i + THUMB_HAPPEN);
      const r = await api().fotos_schaerfen(teil).catch(() => null);   // warte-ok: still im Hintergrund
      if (lauf !== thumbLauf || !angemeldet) return;
      const bilder = (r && r.thumbs) || {};
      if (r) teil.forEach(p => { if (!bilder[p]) _schaerfenFehl.add(p); });
      geladen.forEach((f, idx) => {
        if (!bilder[f.path]) return;
        f.thumb_url = bilder[f.path]; f.thumb = 1;
        const img = haupt && haupt.querySelector(`.foto-kachel[data-foto="${idx}"] img`);
        if (img) img.src = bilder[f.path];
      });
    } } finally { _schaerfenLaeuft = false; }
  }

  /** Die neuen Bilder in die schon gezeichneten Kacheln hängen — ohne das
      ganze Raster neu zu bauen, sonst springt die Ansicht beim Blättern. */
  function bilderEinsetzen(bilder) {
    if (!haupt) return;
    geladen.forEach((f, i) => {
      if (!bilder[f.path]) return;
      const k = haupt.querySelector(`.foto-kachel[data-foto="${i}"]`);
      if (!k) return;
      const leer = k.querySelector(".foto-kachel-leer");
      if (leer) {
        const img = document.createElement("img");
        img.loading = "lazy"; img.alt = ""; img.src = bilder[f.path];
        leer.replaceWith(img);
      } else {
        const img = k.querySelector("img");
        if (img && !img.getAttribute("src")) img.src = bilder[f.path];
      }
    });
  }

  async function filterwerteLaden() {
    const r = await api().fotos_filterwerte().catch(() => null);
    if (r && r.ok && haupt) {
      stand = r.stand || {};
      haupt._kameras = r.kameras || [];
      haupt._jahre = r.jahre || [];
      letzteWerte = { kameras: haupt._kameras, jahre: haupt._jahre };   // fürs nächste Öffnen (sofort da)
      // 25.09.2026 — eine gewählte Kamera/ein Jahr, das es nicht mehr gibt (Ordner entfernt),
      // fiele sonst unsichtbar weiter ins Gewicht: das Menü zeigt „Alle", gefiltert wird trotzdem.
      if (filter.kamera && !haupt._kameras.some(k => k.kamera === filter.kamera)) delete filter.kamera;
      if (filter.jahr && !haupt._jahre.some(j => +j.jahr === +filter.jahr)) delete filter.jahr;
    }
  }

  // ── Inhaltssuche (04.10.2026) ───────────────────────────────
  /* Marc: „wenn jemand seine Bilder irgendwo liegen hat … indiziert … schnell die passenden Bilder findet …
     Sonnenuntergang." Dasselbe Suchfeld (Q2): Treffer in Name/Stichwort/Ort zuerst, dann nach Bildinhalt (Q3, nach
     Relevanz, umschaltbar nach Datum). Eingeschaltet wird dort, wo man es braucht (Q4): sucht man und die
     Inhaltssuche ist aus, bietet die Kopfzeile sie an. Ausschalten und Löschen in den Einstellungen. */
  const INH_NICHT_KEY = "rz-fotos-inhalt-nicht-jetzt";
  function inhaltNichtJetzt() { try { return localStorage.getItem(INH_NICHT_KEY) === "1"; } catch (_) { return false; } }
  function mb(b) { return num(Math.round((b || 0) / 1e6)); }

  async function inhaltLaden(start) {
    const r = await api().inhalt_status().catch(() => null);
    if (!angemeldet) return;
    if (r && r.ok) inhalt = r;
    inhaltZeichnen();
    if (inhalt && inhalt.lauf && inhalt.lauf.running) inhaltBeobachten();
    else if (start && inhalt && inhalt.an) {
      // offen gebliebenes nachholen (Modell fehlt noch, neue Fotos) — das Backend entscheidet, ob etwas zu tun ist
      const a = await api().inhalt_aufholen().catch(() => null);
      if (a && a.gestartet) inhaltBeobachten();
    }
  }
  function inhaltBeobachten() {
    if (inhaltTimer) return;
    inhaltTimer = setInterval(async () => {
      if (!angemeldet) { clearInterval(inhaltTimer); inhaltTimer = 0; return; }
      const r = await api().inhalt_status().catch(() => null);
      if (r && r.ok) inhalt = r;
      inhaltZeichnen();
      if (!(inhalt && inhalt.lauf && inhalt.lauf.running)) {
        clearInterval(inhaltTimer); inhaltTimer = 0;
        const l = (inhalt && inhalt.lauf) || {};
        if (l.error && !l.abbruch) toast(T("fotos.inh_fehler", "Inhaltssuche: {f}").replace("{f}", String(l.error).slice(0, 160)), "warn", 9000);
        if (filter.suche || filter.aehnlich) neuLaden(true);   // jetzt mit (mehr) Index
        else zeichnen();
      }
    }, 2000);
  }
  function inhaltZahlen() {
    const l = (inhalt && inhalt.lauf) || {};
    const schon = l.schon || 0;
    const n = schon + (l.done || 0), g = schon + (l.total || 0);
    const jetzt = Date.now() / 1000;
    if (!inhaltTempo || (l.done || 0) < inhaltTempo.d0) inhaltTempo = { t0: jetzt, d0: l.done || 0 };
    let rest = null;
    const dt = jetzt - inhaltTempo.t0, dn = (l.done || 0) - inhaltTempo.d0;
    if (l.total > l.done && dt >= 8 && dn > 0 && !l.pausiert) rest = (l.total - l.done) / (dn / dt);
    return { n, g, proz: g ? Math.min(100, Math.floor(n / g * 100)) : null, rest };
  }
  /** Eine Zeile Stand der Inhaltssuche — Seitenleiste und Kopfzeile. */
  function inhaltStandText() {
    if (!inhalt || !inhalt.verfuegbar) return "";
    const l = inhalt.lauf || {};
    if (l.running && l.phase === "laden") {
      return T("fotos.inh_laedt", "Lädt das Suchmodell: {a} von {b} MB ({p} %)")
        .replace("{a}", mb(l.bytes)).replace("{b}", mb(l.gesamt)).replace("{p}", l.gesamt ? Math.floor(100 * l.bytes / l.gesamt) : 0);
    }
    if (l.running) {
      if (l.pausiert === "render") return T("fotos.inh_pause_render", "Inhaltssuche pausiert, solange ein Video rendert");
      if (l.pausiert === "einlesen") return T("fotos.inh_pause_einlesen", "Inhaltssuche wartet, bis das Einlesen fertig ist");
      const z = inhaltZahlen();
      if (!l.total) return T("fotos.inh_prueft", "Inhaltssuche prüft, was neu ist …");
      return T("fotos.inh_erfasst", "Bildinhalt erfasst: {n} von {g} Fotos ({p} %)").replace("{n}", num(z.n)).replace("{g}", num(z.g))
        .replace("{p}", z.proz) + (z.rest != null ? " · " + restText(z.rest) : "");
    }
    if (l.error && !l.abbruch) return "⚠︎ " + T("fotos.inh_fehler", "Inhaltssuche: {f}").replace("{f}", String(l.error).slice(0, 120));
    // 05.10.2026 (Audit C-3): nach „Nicht jetzt" bleibt eine stille Zeile mit Weg zurück
    if (!inhalt.an) return inhaltNichtJetzt() ? T("fotos.inh_aus", "Inhaltssuche aus") : "";
    const ix = inhalt.index || {};
    const zahl = (k, f) => T(k, f).replace("{n}", num(ix.n || 0)).replace("{g}", num(inhalt.bestand || 0));
    // Audit C-2: „angehalten" sichtbar statt „an — erfasst", sonst glaubt man, es sei fertig
    if (inhalt.angehalten || l.abbruch) return zahl("fotos.inh_angehalten", "Inhaltssuche angehalten — {n} von {g} Fotos erfasst");
    return zahl("fotos.inh_bereit", "Inhaltssuche an — {n} von {g} Fotos erfasst");
  }
  /** Welcher Knopf gehört zur Zeile: Anhalten (läuft), Weiter (angehalten/unvollständig), Noch einmal (Fehler),
      Einschalten (nach „Nicht jetzt"). */
  function inhaltKnopfHtml() {
    if (!inhalt || !inhalt.verfuegbar) return "";
    const l = inhalt.lauf || {}, ix = inhalt.index || {};
    const k = (w, t) => ` <button class="btn btn-ghost btn-sm" type="button" data-inh="${w}">${esc(t)}</button>`;
    if (l.running) return k("stop", T("fotos.inh_stop", "Anhalten"));
    if (!inhalt.an) return inhaltNichtJetzt() ? k("einschalten", T("fotos.inh_einschalten_kurz", "Einschalten …")) : "";
    if (l.error && !l.abbruch) return k("weiter", T("fotos.inh_nochmal", "Noch einmal versuchen"));
    if (inhalt.angehalten || l.abbruch || !inhalt.modell_da || (ix.n || 0) < (inhalt.bestand || 0)) return k("weiter", T("fotos.inh_weiter", "Weiter"));
    return "";
  }
  function inhaltNavHtml() {
    const t = inhaltStandText();
    if (!t) return "";
    const tip = T("fotos.inh_tip", "Die Inhaltssuche erkennt, was auf einem Foto zu sehen ist — „Sonnenuntergang“, „Hund am Strand“, „Gletscher“ — in jeder Sprache. Dafür schaut ein Bildmodell (SigLIP 2 von Google) einmal jedes Foto an. Das passiert nur auf diesem Rechner; kein Foto verlässt ihn. Der Index liegt in der Bibliothek und zieht mit ihr um.");
    return `${I("search")} ${esc(t)} ${typeof helpTip === "function" ? helpTip(tip) : ""}` + inhaltKnopfHtml()
      + ` <button type="button" class="foto-inh-faq" data-inh="faq">${esc(T("fotos.inh_faq", "Was passiert da?"))}</button>`;   // 06.10.2026 → FAQ im Handbuch
  }
  /** Kopfzeile: was die Suche fand (Zählung je Art + Sortierung) — oder das Angebot, die Inhaltssuche einzuschalten. */
  function inhaltKopfHtml() {
    const sucht = !!(filter.suche || filter.aehnlich);
    if (!sucht || !inhalt || !inhalt.verfuegbar) return "";
    if (inhaltTreffer) {
      const it = inhaltTreffer;
      const teile = it.art === "aehnlich"
        ? [it.quelle_fehlt ? T("fotos.inh_quelle_fehlt", "Dieses Foto ist noch nicht erfasst — gleich noch einmal versuchen.")
                           : T("fotos.inh_n_aehnlich", "{n} ähnliche Fotos").replace("{n}", num(it.n_inhalt))]
        : [T("fotos.inh_n_text", "{n} im Text").replace("{n}", num(it.n_text)),
           T("fotos.inh_n_bild", "{n} nach Bildinhalt").replace("{n}", num(it.n_inhalt))];
      const ix = inhalt.index || {};
      const unvoll = (inhalt.bestand || 0) > (ix.n || 0)
        ? ` <span class="muted">(${esc(T("fotos.inh_unvollstaendig", "Bildinhalt erst von {n} von {g} Fotos erfasst").replace("{n}", num(ix.n || 0)).replace("{g}", num(inhalt.bestand || 0)))})</span>` : "";
      return `<div class="foto-inh-kopf">${I("search")} ${esc(teile.join(" · "))}${unvoll}
        <span class="lib-views foto-inh-sort" role="group">
          <button class="lib-view${sortierung === "relevanz" ? " is-on" : ""}" type="button" data-inh-sort="relevanz">${esc(T("fotos.inh_sort_relevanz", "Beste zuerst"))}</button>
          <button class="lib-view${sortierung !== "relevanz" ? " is-on" : ""}" type="button" data-inh-sort="zeit_neu">${esc(T("fotos.inh_sort_datum", "Nach Datum"))}</button>
        </span></div>`;
    }
    const l = inhalt.lauf || {};
    if (inhalt.an && l.running) return `<div class="foto-inh-kopf muted">${I("search")} ${esc(inhaltStandText())}</div>`;
    if (inhalt.an || inhaltNichtJetzt() || !filter.suche) return "";
    // 04.10.2026 (Marc: „kann ich beim 1. Aktivieren schon auswählen, ob ich das große oder das kleine Modell haben
    // will?") — zwei Knöpfe statt einem; die Wahl bleibt in den Einstellungen änderbar.
    const vs = inhalt.varianten || {};
    const vb = vs.base || {}, vg = vs.gross || {};
    return `<div class="foto-inh-angebot">
      <div><b>${I("search")} ${esc(T("fotos.inh_angebot_titel", "Auch nach dem suchen, was auf den Fotos zu sehen ist?"))}</b></div>
      <div class="muted">${esc(T("fotos.inh_angebot_text2", "„Sonnenuntergang“, „Hund am Strand“, „Gletscher“ — in jeder Sprache. Lädt einmalig ein Bildmodell, danach läuft alles auf diesem Rechner, ohne Konto. Die Fotos werden im Hintergrund erfasst; du kannst dabei alles andere weiter benutzen."))}</div>
      <div class="foto-inh-wahl">
        <button class="btn btn-primary btn-sm" type="button" data-inh="an" data-inh-var="base">${esc(T("fotos.inh_an_standard", "Standard einschalten (ca. {mb} MB)").replace("{mb}", mb(vb.bytes)))}</button>
        <button class="btn btn-sm" type="button" data-inh="an" data-inh-var="gross">${esc(T("fotos.inh_an_gross", "Groß einschalten (ca. {gb} GB)").replace("{gb}", ((vg.bytes || 0) / 1e9).toFixed(1).replace(".", T("fotos.dezimal", ","))))}</button>
        <button class="btn btn-ghost btn-sm" type="button" data-inh="nicht">${esc(T("fotos.inh_nicht_jetzt", "Nicht jetzt"))}</button>
      </div>
      <div class="muted foto-inh-wahl-hilfe">${esc(T("fotos.inh_wahl_hilfe", "Standard reicht für die meisten Suchen und erfasst die Fotos schnell. Groß versteht vor allem Deutsch und Spanisch besser, ist aber dreimal so groß und erfasst etwa sechsmal langsamer. Umstellen geht später in den Einstellungen."))}</div></div>`;
  }
  function inhaltZeichnen() {
    if (nav) { const el = nav.querySelector("#foto-inhalt-stand"); if (el) { el.innerHTML = inhaltNavHtml(); inhaltBinden(el); } }
    if (haupt) {
      const k = haupt.querySelector(".foto-inh-kopf, .foto-inh-angebot");
      const html = inhaltKopfHtml();
      if (k && html) { k.outerHTML = html; inhaltBinden(haupt.querySelector("#foto-kopf") || haupt); }
      else if (k && !html) k.remove();
      else if (!k && html) { const kopf = haupt.querySelector("#foto-kopf"); if (kopf) { kopf.insertAdjacentHTML("beforeend", html); inhaltBinden(kopf); } }
    }
  }
  function inhaltBinden(wurzel) {
    if (!wurzel) return;
    wurzel.querySelectorAll("[data-inh]").forEach(b => {
      b.onclick = async () => {
        const w = b.dataset.inh;
        if (w === "nicht") { try { localStorage.setItem(INH_NICHT_KEY, "1"); } catch (_) { /* ui-falle-ok: Speicher gesperrt — Angebot kommt beim nächsten Mal wieder */ } inhaltZeichnen(); return; }
        if (w === "stop") { await api().inhalt_stop().catch(() => null); await inhaltLaden(); return; }
        if (w === "faq") { api().open_user_guide(T("inhalt.faq_anker", "inhaltssuche-siglip-2-was-passiert-da-genau")).catch(() => null); return; }
        if (w === "weiter") {
          b.disabled = true;
          const r = await api().inhalt_weiter().catch(() => null);
          await inhaltLaden();
          if (r && r.gestartet) inhaltBeobachten();
          else if (!(inhalt && inhalt.lauf && inhalt.lauf.running)) toast(T("fotos.inh_nichts_zu_tun", "Alle Fotos sind erfasst."), "info");
          return;
        }
        if (w === "einschalten") {
          try { localStorage.removeItem(INH_NICHT_KEY); } catch (_) { /* ui-falle-ok: Speicher gesperrt — Angebot kommt dann ohnehin */ }
          if (filter.suche) { zeichnen(); inhaltZeichnen(); }
          else if (typeof openSettingsModal === "function") openSettingsModal("bibliothek");
          return;
        }
        if (w === "an") {
          b.disabled = true;
          const r = await api().inhalt_einschalten(b.dataset.inhVar || "").catch((e) => ({ ok: false, error: String(e) }));
          if (r && r.ok === false) { toast(r.error || "?", "warn"); b.disabled = false; return; }
          await inhaltLaden();
          inhaltBeobachten();
          zeichnen();
        }
      };
    });
    wurzel.querySelectorAll("[data-inh-sort]").forEach(b => {
      b.onclick = () => { if (sortierung === b.dataset.inhSort) return; sortierung = b.dataset.inhSort; neuLaden(); };
    });
  }
  /* Audit K-3 (05.10.2026): wird die Inhaltssuche in den Einstellungen aus- oder gelöscht, darf der Foto-Bereich nicht
     im Inhaltssuche-Zustand stehen bleiben (Chip „Ähnlich wie …", Gruppen, Knopf „Ähnliche Fotos"). */
  window.addEventListener("rz-inhalt-geaendert", async () => {
    if (!angemeldet) return;
    await inhaltLaden();
    if (inhalt && !inhalt.an) {
      inhaltTreffer = null;
      if (filter.aehnlich) { filter = Object.assign({}, filter); delete filter.aehnlich; }
      zeichnen();
      neuLaden(true);
      if (auswahl) { const f = geladen.find(x => x.path === auswahl); if (f) detailZeigen(f); }
    }
  });
  /** „Ähnliche Fotos" aus der Detailspalte: Suche nach diesem Bild statt nach Text. */
  function aehnlicheZeigen(d) {
    filter = Object.assign({}, filter);
    delete filter.suche;
    filter.aehnlich = d.path;
    sortierung = "relevanz";
    if (ansicht !== "raster") ansicht = "raster";
    zeichnen();
    neuLaden();
  }

  // ── Zeichnen ────────────────────────────────────────────────────────────

  function leisteHtml() {
    // 09.10.2026 — Jahr/Kamera/Ort stehen jetzt links unter „Filter“; oben Suche, Chips, Ansichten
    return `
      <div class="lib-bar foto-bar">
        <input type="search" id="foto-suche" class="lib-search" value="${esc(filter.suche || "")}"
               placeholder="${inhalt && inhalt.an ? T("fotos.suche_ph_inhalt", "Suchen — auch nach Bildinhalt: „Sonnenuntergang“, „Hund am Strand“ …")
                                                    : T("fotos.suche_ph", "Suchen — Dateiname, Kamera, Objektiv, Stichwort, Ort …")}">
        ${filter.aehnlich ? `<button class="lib-chip is-on foto-db-chip" id="foto-aehnlich-chip" type="button" title="${esc(T("fotos.inh_aehnlich_weg", "Ähnlich-Suche aufheben"))}">${I("search", 13)} ${esc(T("fotos.inh_aehnlich_chip", "Ähnlich wie {n}").replace("{n}", String(filter.aehnlich).split(/[\\/]/).pop()))} ✕</button>` : ""}
        ${filter.verz ? `<button class="lib-chip is-on foto-db-chip" id="foto-ob-chip" type="button" title="${esc(obTitel(filter.verz) + " — " + T("fotos.ob_chip_weg", "Ordnerfilter aufheben"))}">${I("folder", 13)} ${esc(obTitel(filter.verz))} ✕</button>` : ""}
        ${datumsFilterText() ? `<button class="lib-chip is-on foto-db-chip" id="foto-db-chip" type="button" title="${esc(T("fotos.db_chip_weg", "Datumsfilter aufheben"))}">${I("calendar", 13)} ${esc(datumsFilterText())} ✕</button>` : ""}
        <button class="lib-chip lib-chip-ghost" id="foto-reset" type="button">${T("library.reset", "Zurücksetzen")}</button>
        <span class="lib-bar-spacer"></span>
        <div class="lib-views" role="group">
          <button class="lib-view${ansicht === "raster" ? " is-on" : ""}" data-fview="raster" type="button"
                  title="${T("fotos.view_raster", "Raster nach Tagen")}">${I("layout-grid", 16)}</button>
          <button class="lib-view${ansicht === "karte" ? " is-on" : ""}" data-fview="karte" type="button"
                  title="${T("fotos.view_karte", "Karte")}">${I("map", 16)}</button>
          <button class="lib-view${ansicht === "touren" ? " is-on" : ""}" data-fview="touren" type="button"
                  title="${T("fotos.view_touren", "Nach Touren")}">${I("route", 16)}</button>
        </div>
        ${exportKnopfHtml("foto-export-oben")}
      </div>`;
  }

  function kopfHtml() {
    // 25.09.2026 (Klicktest FO-05: „1 Dateien · 8 ohne Koordinate" bei EINEM Treffer) — Einzahl
    // und die Zahl ohne Koordinate aus der gefilterten Menge, nicht aus dem ganzen Bestand.
    const teile = [gesamt === 1 ? T("fotos.kopf_one", "1 Datei")
                                : T("fotos.kopf", "{n} Dateien").replace("{n}", num(gesamt))];
    if (stand.ungelesen) teile.push(T("fotos.kopf_offen", "{n} noch ohne Aufnahmedaten").replace("{n}", num(stand.ungelesen)));
    if (stand.ohne_bild) teile.push(T("fotos.kopf_ohne_bild", "{n} noch ohne Vorschaubild").replace("{n}", num(stand.ohne_bild)));
    const ohneGps = gesamtOhneGps != null ? gesamtOhneGps : (stand.ohne_koordinate || 0);
    // 08.10.2026 (Beta-Tester: „70 Dateien, davon 21 ohne Koordinaten — wo finde ich die?“) — die Zahl ist ein Filter
    const ohneKnopf = ohneGps && filter.gps !== "ohne"
      ? ` · <button type="button" class="foto-kopf-ohne" id="foto-kopf-ohne" title="${esc(T("fotos.kopf_ohne_tip", "Nur die Dateien ohne Koordinate zeigen — markieren und per Rechtsklick „Ort setzen …“"))}">${I("map-pin", 13)} ${esc(T("fotos.kopf_ohne_gps", "{n} ohne Koordinate").replace("{n}", num(ohneGps)))}</button>` : "";
    if (ohneGps && filter.gps === "ohne") teile.push(T("fotos.kopf_ohne_gps", "{n} ohne Koordinate").replace("{n}", num(ohneGps)));
    return `<div class="lib-head" id="foto-kopf">${fernHtml()}${esc(teile.join(" · "))}${ohneKnopf}${kopfArbeitHtml()}${inhaltKopfHtml()}</div>`;
  }

  /* Unterwegs ist das Laufwerk weg — und das muss man sehen, nicht erraten
     (Marc, 13.09.2026: „Ich bin jetzt unterwegs und das Laufwerk ist nicht mehr
     verfügbar. Das sollte doch irgendwie angezeigt werden."). Gesagt wird
     auch, was trotzdem geht und wann es weitergeht. */
  /** Auf welchem Laufwerk liegt ein Ordner? Der Name, den man kennt — nicht
      der letzte Ordnerteil (bei /Volumes/NAS/Bilder/2024 hieß es sonst „2024"). */
  /* 04.10.2026 (Marc: „es wird immer noch nicht richtig angezeigt, welche Ordner eingehängt sind … was ist
     /Volumes/Fotos überhaupt? Im Finder sehe ich das so ja gar nicht") — jede Zeile sagt, was der Finder sagt:
     Name des Laufwerks, Art (Netzlaufwerk auf <Server> / Zusatzlaufwerk / dieser Rechner) und den Zustand mit Punkt:
     🟢 verbunden · 📴 nicht verbunden (+ „Verbinden", wenn die Adresse bekannt ist) · ⚠️ antwortet nicht /
     unter anderem Namen eingehängt. Daten: core/laufwerke.py über api.fotos_ordner (o.laufwerk). */
  function lwName(o) {
    const lw = (o && o.laufwerk) || {};
    return lw.name || laufwerkVon(o && o.path);
  }
  function lwArt(lw) {
    if (lw.art === "netz") return lw.server
      ? T("fotos.lw_netz_auf", "Netzlaufwerk auf {s}").replace("{s}", lw.server)
      : T("fotos.lw_netz", "Netzlaufwerk");
    if (lw.art === "extern") return T("fotos.lw_extern", "Zusatzlaufwerk");
    return T("fotos.laufwerk_intern", "Dieser Rechner");
  }
  function lwZustand(o) {
    const lw = o.laufwerk || {};
    if (lw.alternativ) return { punkt: "", klasse: "anders", text: T("fotos.lw_anders_kurz", "unter anderem Namen eingehängt") };
    if (o.da) return { punkt: "", klasse: "da", text: T("fotos.lw_verbunden", "verbunden") };
    if (lw.verbunden && lw.lesbar == null) return { punkt: "", klasse: "haengt", text: T("fotos.lw_haengt", "verbunden, antwortet aber nicht") };
    if (lw.art === "intern") return { punkt: "", klasse: "weg", text: T("fotos.lw_ordner_fehlt", "Ordner nicht gefunden") };
    return { punkt: "", klasse: "weg", text: T("fotos.lw_getrennt", "nicht verbunden") };
  }
  /** Anzeigename des Ordners: Laufwerk, darunter der Weg im Laufwerk („Fotos › 2024 › Teneriffa"). */
  function ordnerTitel(o) {
    const lw = o.laufwerk || {};
    const w = lw.wurzel || "";
    const rest = (w && o.path.startsWith(w)) ? o.path.slice(w.length) : "";
    const teile = rest.split(/[\\/]/).filter(Boolean);
    if (lw.art !== "intern" && lw.name) return [lw.name].concat(teile.slice(-2)).join(" › ");
    return o.path.split(/[\\/]/).filter(Boolean).slice(-2).join(" › ");
  }
  function ordnerZeile(o, i) {
    const lw = o.laufwerk || {};
    const z = lwZustand(o);
    const verbindbar = !o.da && !lw.verbunden && !lw.alternativ && lw.art === "netz" && lw.url;
    const anders = lw.alternativ
      ? `<div class="foto-lw-hinweis">${esc(T("fotos.lw_anders", "Als „{n}“ eingehängt — macOS hat einen anderen Namen vergeben, weil „{o}“ belegt war. Im Finder auswerfen und neu verbinden, dann heißt es wieder „{o}“.")
          .replace("{n}", String(lw.alternativ).split("/")[2] || lw.alternativ).split("{o}").join(lw.name || ""))}</div>` : "";
    return `
          <div class="foto-ordner foto-lw-${z.klasse}">
            <span class="foto-lw-punkt" aria-hidden="true">${z.punkt}</span>
            <div class="foto-ordner-txt" title="${esc(o.path)}">
              <div class="foto-ordner-name"><b>${esc(ordnerTitel(o))}</b> <span class="muted">${num(o.n)}</span></div>
              <div class="foto-lw-zeile"><span class="foto-lw-zustand">${esc(z.text)}</span> <span class="muted">· ${esc(lwArt(lw))}</span></div>
              ${anders}
              ${verbindbar ? `<button class="btn btn-sm foto-lw-verbinden" data-fverb="${i}" type="button"
                    title="${esc(T("fotos.lw_verbinden_tip", "Öffnet {u} wie ⌘K im Finder — ein Passwort fragt das System selbst ab.").replace("{u}", lw.url))}">${I("link", 13)} ${T("fotos.lw_verbinden", "Verbinden")}</button>` : ""}
            </div>
            <button class="btn btn-sm" data-fordweg="${i}" type="button"
                    title="${T("fotos.ordner_entfernen", "Ordner nicht mehr beobachten")}">✕</button>
          </div>`;
  }
  /** „Verbinden": Adresse über das System öffnen, dann 30 s lang alle 2 s nachsehen. */
  async function laufwerkVerbinden(o) {
    const r = await rzWarten("fotos_laufwerk_verbinden", () => api().fotos_laufwerk_verbinden(o.path)).catch((e) => ({ ok: false, error: String(e) }));
    if (!r || !r.ok) { toast((r && r.error) || T("fotos.lw_keine_adresse", "Die Adresse dieses Laufwerks ist nicht bekannt — bitte einmal im Finder verbinden."), "warn", 6000); return; }
    toast(T("fotos.lw_verbindet", "Das System verbindet „{n}“ — ein Passwort fragt es selbst ab.").replace("{n}", lwName(o)), "info", 5000);
    for (let k = 0; k < 15; k++) {
      await new Promise((res) => setTimeout(res, 2000));
      let rr = null; try { rr = await api().fotos_ordner(); } catch (_) {}
      if (!rr || !rr.ok) continue;
      const neu = (rr.ordner || []).find((x) => x.path === o.path);
      if (neu && neu.da) {
        const vorher = ordner.filter(x => !x.da).length;
        ordner = rr.ordner || []; stand = rr.stand || stand; nachschau = rr.nachschau || nachschau;
        navZeichnen(); kopfAuffrischen();
        toast(T("fotos.lw_ist_verbunden", "„{n}“ ist verbunden.").replace("{n}", lwName(o)), "success", 4000);
        if (ordner.filter(x => !x.da).length < vorher) { if (autoAn) aufholen(true); }
        fernBeobachten();
        return;
      }
    }
    toast(T("fotos.lw_noch_nicht", "Noch nicht verbunden — im Finder nachsehen, ob eine Anmeldung wartet."), "info", 6000);
  }

  function laufwerkVon(pfad) {
    const p = String(pfad || "");
    let m = p.match(/^\/Volumes\/([^/]+)/);                 // macOS
    if (m) return m[1];
    m = p.match(/^\/(?:run\/)?media\/[^/]+\/([^/]+)/);     // Linux
    if (m) return m[1];
    m = p.match(/^\/mnt\/([^/]+)/);
    if (m) return m[1];
    m = p.match(/^([A-Za-z]):[\\/]/);                       // Windows
    if (m) return m[1].toUpperCase() + ":";
    m = p.match(/^\\\\([^\\]+)\\([^\\]+)/);                 // \\server\freigabe
    if (m) return m[1] + "\\" + m[2];
    return T("fotos.laufwerk_intern", "Dieser Rechner");
  }

  /* Unterwegs ist das Laufwerk weg — und das muss man sehen, nicht erraten
     (Marc, 13.09.2026: „Ich bin jetzt unterwegs und das Laufwerk ist nicht mehr
     verfügbar. Das sollte doch irgendwie angezeigt werden."). Bei mehreren
     Laufwerken sagt der Hinweis, WELCHE fehlen und welche weiterlaufen —
     gruppiert nach Laufwerk, nicht nach Ordner. */
  function fernHtml() {
    const weg = ordner.filter(o => !o.da);
    if (!weg.length) return "";
    const gruppieren = (liste) => {
      const g = new Map();
      liste.forEach(o => {
        const l = lwName(o);
        if (!g.has(l)) g.set(l, []);
        g.get(l).push(o);
      });
      return g;
    };
    const fehlend = gruppieren(weg);
    const da = gruppieren(ordner.filter(o => o.da));
    // Ein Laufwerk, das teils erreichbar ist, ist nicht „weg" — dann fehlen
    // nur einzelne Ordner darauf. Das sagt der Text genauso.
    const beschreiben = (g) => [...g.entries()].map(([l, os]) => {
      const alleDrauf = ordner.filter(o => lwName(o) === l).length;
      if (os.length === 1 && alleDrauf === 1) return l;
      return T("fotos.fern_ordner_auf", "{l} ({n} Ordner)").replace("{l}", l).replace("{n}", os.length);
    }).join(", ");
    const titel = T("fotos.fern_titel", "Nicht erreichbar: {n}").replace("{n}", beschreiben(fehlend));
    const wann = nachschau ? zeitpunktText(nachschau) : "";
    const satz = [
      da.size
        ? T("fotos.fern_rest", "Die Ordner auf {l} werden normal gelesen.").replace("{l}", [...da.keys()].join(", "))
        : "",
      T("fotos.fern_geht", "Suche, Karte und Vorschaubilder kommen aus der Bibliothek und funktionieren weiter."),
      (!da.size && wann) ? T("fotos.fern_stand", "Du siehst den Stand vom {t}.").replace("{t}", wann) : "",
      T("fotos.fern_weiter", "Sobald das Laufwerk wieder da ist, liest die App von selbst weiter."),
    ].filter(Boolean).join(" ");
    const liste = weg.length > 1
      ? `<div class="foto-fern-liste">${weg.map(o =>
          `<div title="${esc(o.path)}">${I("wifi-off", 13)} ${esc(ordnerTitel(o))} <span class="muted">${num(o.n)}</span></div>`).join("")}</div>`
      : "";
    // 04.10.2026 — „Verbinden" auch hier (der erste fehlende Ordner auf einem Netzlaufwerk mit bekannter Adresse)
    const verbIdx = ordner.findIndex(o => !o.da && o.laufwerk && !o.laufwerk.verbunden && !o.laufwerk.alternativ && o.laufwerk.art === "netz" && o.laufwerk.url);
    const verbKnopf = verbIdx >= 0
      ? `<button class="btn btn-sm btn-primary foto-lw-verbinden" id="foto-fern-verbinden" data-fverb="${verbIdx}" type="button">${I("link", 13)} ${T("fotos.lw_verbinden", "Verbinden")}</button> ` : "";
    // 18.09.2026 (Marc: „da bräuchte es noch einen Knopf für Nochmal versuchen") — nicht 20 s auf die Wache warten
    return `<div class="foto-fern" id="foto-fern">
        <div class="foto-fern-titel">${I("wifi-off")} ${esc(titel)}
          ${verbKnopf}<button class="btn btn-sm foto-fern-nochmal" id="foto-fern-nochmal" type="button">↻ ${T("fotos.fern_nochmal", "Nochmal versuchen")}</button></div>
        <div class="foto-fern-text">${esc(satz)}</div>
        ${liste}
      </div>`;
  }

  function zeitpunktText(sek) {
    const d = new Date(sek * 1000);
    if (isNaN(d)) return "";
    let loc = null;
    try { loc = (typeof i18nMeta === "function") ? i18nMeta().active : null; } catch (_) {}
    return d.toLocaleString(loc || undefined,
      { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  }

  /** 18.09.2026 — Knopf „Nochmal versuchen" im Hinweis: sofort nachsehen statt auf die 20-s-Wache zu warten.
      Dasselbe wie die Wache, aber mit Wartefenster und einer Antwort in JEDEM Fall (auch „immer noch weg"). */
  async function fernJetztPruefen() {
    const vorher = ordner.filter(o => !o.da).length;
    const r = await rzWarten("fotos_fern_nochmal", () => api().fotos_ordner(true)).catch(() => null);
    if (r && r.ok) { ordner = r.ordner || []; stand = r.stand || stand; nachschau = r.nachschau || nachschau; }
    const jetzt = ordner.filter(o => !o.da).length;
    navZeichnen();
    kopfAuffrischen();
    if (!r || !r.ok) toast(T("fotos.fern_nochmal_fehler", "Konnte nicht nachsehen — bitte gleich noch einmal."), "error", 4000);
    // 10.10.2026 — auch „wieder da“, wenn die 20-s-Wache es schon gemerkt hatte (dann ist vorher schon 0)
    else if (jetzt < vorher || jetzt === 0) { if (autoAn) aufholen(true); else toast(aufholText({ grund: "abgeschaltet" }), "success", 7000); }
    else toast(T("fotos.fern_nochmal_weg", "Immer noch nicht erreichbar. Ist das Laufwerk verbunden und im Finder sichtbar?"), "info", 5000);
    fernBeobachten();
  }
  function fernKnopfBinden(wurzel) {
    const b = wurzel && wurzel.querySelector("#foto-fern-nochmal");
    if (b) b.onclick = () => fernJetztPruefen();
    const v = wurzel && wurzel.querySelector("#foto-fern-verbinden");
    if (v) v.onclick = () => { const o = ordner[+v.dataset.fverb]; if (o) laufwerkVerbinden(o); };
  }

  /** Solange ein Laufwerk fehlt: alle 20 s nachsehen, ob es zurück ist —
      dann Hinweis weg, Seitenleiste auffrischen, von selbst weiterlesen. */
  /** 05.10.2026 — liegen die Fotos eines fehlenden Laufwerks unter einem anderen Namen
   *  (/Volumes/Fotos-1, Windows Y:\), einmal je Sitzung anbieten, die Pfade umzubiegen (Bestand + Inhaltsindex,
   *  vorher Sicherung der Bibliothek). Abgelehnt → in dieser Sitzung nicht mehr fragen. */
  let _umzugGefragt = false;
  async function pfadeUmziehenAnbieten() {
    if (_umzugGefragt) return;
    _umzugGefragt = true;
    let r = null;
    try { r = await api().fotos_pfade_kandidaten(); } catch (_) {}   // warte-ok: Hintergrund, Stichprobe von 12 Dateien
    for (const k of (r && r.kandidaten) || []) {
      const ja = await window.rzConfirm(T("fotos.umziehen_titel", "Fotos an neuem Ort gefunden"),
        T("fotos.umziehen_frage", "Die {n} Fotos von „{alt}“ liegen auf diesem Rechner unter „{neu}“. Sollen die Pfade angepasst werden? Vorher wird die Bibliothek gesichert.")
          .replace("{n}", num(k.n_fotos)).replace("{alt}", k.alt).replace("{neu}", k.neu),
        T("fotos.umziehen_ja", "Pfade anpassen"), false);
      if (!ja) continue;
      const u = await rzWarten("fotos_pfade_umbiegen", () => api().fotos_pfade_umbiegen(k.alt, k.neu)).catch(() => null);
      if (u && u.ok) {
        toast(T("fotos.umziehen_ok", "{n} Fotos zeigen jetzt auf „{neu}“.").replace("{n}", num((u.bestand || {}).geaendert || 0)).replace("{neu}", k.neu), "success", 6000);
        try { applog("info", `[fotos] Pfade umgebogen ${k.alt} → ${k.neu}: ${JSON.stringify(u)}`); } catch (_) {}
        try { await neuLaden(true); } catch (e) { applog("warn", `[fotos] Neu laden nach Umbiegen: ${e}`); }
      } else toast((u && u.error) || T("common.error", "Fehler"), "error", 7000);
    }
  }

  function fernBeobachten() {
    clearTimeout(fernWache);
    if (!angemeldet || !ordner.some(o => !o.da)) return;
    fernWache = setTimeout(async () => {
      if (!angemeldet) return;
      const vorher = ordner.filter(o => !o.da).length;
      try {
        const r = await api().fotos_ordner();
        if (r && r.ok) { ordner = r.ordner || []; stand = r.stand || stand; nachschau = r.nachschau || nachschau; }
      } catch (_) {}
      const jetzt = ordner.filter(o => !o.da).length;
      if (jetzt !== vorher) {
        navZeichnen();
        kopfAuffrischen();
        if (jetzt < vorher) {
          if (autoAn) aufholen(true); else toast(aufholText({ grund: "abgeschaltet" }), "success", 7000);
        }
      }
      fernBeobachten();
    }, 20000);
  }

  /* Es darf nie beides gleichzeitig dastehen — „Jetzt einlesen" und ein
     laufendes Einlesen (Marc, 12.09.2026: „der button jetzt einlesen ist immer
     noch da, das ist verwirrend. liest er jetzt ein oder nicht?"). Entweder
     läuft es, dann steht hier der Stand und Abbrechen. Oder es läuft nicht,
     dann steht hier der Knopf. */
  function kopfArbeitHtml() {
    // Ein gescheiterter Lauf darf nicht aussehen wie „nie gestartet": vorher
    // stand danach einfach wieder der Knopf da (Marc, 12.09.2026: „es läuft
    // kurz los und dann kommt der Knopf").
    if (scanStand && scanStand.error && !scanStand.running) {
      return ` <span class="foto-kopf-fehler">${I("triangle-alert", 13)} ${esc(T("fotos.kopf_fehler", "Einlesen abgebrochen: {f}")
        .replace("{f}", String(scanStand.error).slice(0, 120)))}</span>
        <button class="btn btn-sm" id="foto-kopf-scan" type="button">${T("fotos.kopf_nochmal", "Noch einmal versuchen")}</button>`;
    }
    if (scanStand && scanStand.warte) {
      return ` <span class="foto-kopf-laeuft">⏳ ${esc(T("fotos.kopf_warte", "Datenbank ist gerade belegt — wartet und versucht es erneut"))}</span>`;
    }
    // Zwischen „gleich geht es los" und „es läuft" liegt eine Sekunde, in der
    // sonst der Knopf stünde und man nicht wüsste, ob nun eingelesen wird
    // (Marc, 12.09.2026: „ich blick's immer noch nicht … liest er jetzt ein
    // oder nicht?"). Also: sobald das Aufholen angestoßen ist, steht das da.
    if (aufholStart && !(scanStand && scanStand.running)) {
      return ` <span class="foto-kopf-laeuft">⏳ ${esc(T("fotos.kopf_startet", "Liest ein …"))}</span>`;
    }
    if (scanStand && scanStand.running) {
      // 18.09.2026 (Marc: „was tatsächlich passiert, sieht man nicht") — Klartext: welcher Schritt, wozu,
      // wie weit, wo gerade, was bisher gefunden wurde.
      return ` <button class="btn btn-sm" id="foto-kopf-stop" type="button">${T("common.cancel", "Abbrechen")}</button>
        <div class="foto-kopf-klartext" id="foto-kopf-klartext">${scanKlartextHtml(scanStand)}</div>`;
    }
    // Nach dem Lauf: eine Zeile, was herauskam (bleibt 90 s stehen).
    if (scanStand && !scanStand.running && scanStand.fertig_um && (Date.now() / 1000 - scanStand.fertig_um) < 90) {
      const e = scanErgebnisText(scanStand);
      if (e) return ` <div class="foto-kopf-klartext foto-kopf-fertig">✓ ${esc(e)}</div>` + kopfOffenHtml();
    }
    return kopfOffenHtml();
  }

  /* 04.10.2026 (Marc: „ein Schritt, der zwei verschiedene Dinge macht — dann weiß man ja gar nicht, was passiert …
     da muss mehr Feedback sein, damit man sieht, dass es vorangeht") — EIN Klartext für Kopfzeile, Kasten unten rechts
     und Seitenleiste: welcher Schritt in welcher Gangart (schnell: nur geänderte Ordner / gründlich: jede Datei),
     wie weit (x von ≈ y, %), wie lange noch (aus dem gemessenen Tempo), und wo gerade (Ordner bzw. Datei). */
  let tempoMess = null;
  let restAnz = null;     // { phase, ende } — angezeigtes Ende von Schritt 2 (zählt ruhig herunter)   // { phase, t0, d0 } — Tempo seit Beginn der Phase, für die Restzeit
  function scanZahlen(st) {
    const erste = st.phase === "dateien";
    // Schritt 2 zählt, was frühere Läufe schon gelesen haben, mit (`schon`): nach einem Neustart steht dort der
    // Gesamtstand, nicht wieder 0 % (Marc, 04.10.2026). Die Restzeit misst trotzdem nur das Tempo dieses Laufs.
    const schon = erste ? 0 : (st.total ? (st.schon || 0) : 0);
    const gesamt = erste ? (st.erwartet || 0) : (st.total || 0) + schon;
    const n = (st.done || 0) + schon;
    const jetzt = Date.now() / 1000;
    if (!tempoMess || tempoMess.phase !== st.phase || n < tempoMess.d0) tempoMess = { phase: st.phase, t0: jetzt, d0: n };
    let rest = null;
    const dt = jetzt - tempoMess.t0, dn = n - tempoMess.d0;
    if (gesamt > n && dt >= 8 && dn > 0) rest = (gesamt - n) / (dn / dt);
    // 04.10.2026 (Marc: „die Zeit tickert die ganze Zeit hoch … sollte auf einen Schlag hoch sein und runtertickern")
    // — Schritt 2 bekommt die Restzeit vom Python-Teil (Dateien + MB, gemerktes Tempo). Angezeigt wird ein Endzeitpunkt,
    // der ruhig herunterzählt; neu gesetzt wird er nur, wenn die Schätzung um mehr als 10 % (mind. 2 Min.) abweicht.
    if (!erste && st.rest_s != null && st.rest_am) {
      const ziel = st.rest_am + st.rest_s;
      // Audit C-4: Anzeige schon (fast) bei 0, Schätzung aber noch über einer Minute → sofort neu
      const leergelaufen = restAnz && restAnz.ende - jetzt < 30 && ziel - jetzt > 60;
      if (!restAnz || leergelaufen || restAnz.phase !== st.phase || Math.abs(ziel - restAnz.ende) > Math.max(120, 0.1 * Math.max(0, ziel - jetzt))) {
        restAnz = { phase: st.phase, ende: ziel };
      }
      rest = Math.max(0, restAnz.ende - jetzt);
    }
    const proz = gesamt ? Math.min(100, Math.floor(n / gesamt * 100)) : null;
    return { erste, gesamt, n, proz, rest, ungefaehr: erste };
  }
  function restText(sek) {
    if (sek == null || !isFinite(sek)) return "";
    if (sek < 60) return T("fotos.kt_rest_kurz", "noch unter einer Minute");
    const min = Math.round(sek / 60);
    if (min < 60) return T("fotos.kt_rest_min", "noch ca. {m} Min.").replace("{m}", num(min));
    // Audit C-4: ab zwei Tagen in Tagen und Stunden (Marcs Fall „225 Std.")
    if (min >= 48 * 60) { const h = Math.round(min / 60); return T("fotos.kt_rest_tage", "noch ca. {d} Tage {h} Std.").replace("{d}", num(Math.floor(h / 24))).replace("{h}", num(h % 24)); }
    return T("fotos.kt_rest_std", "noch ca. {h} Std. {m} Min.").replace("{h}", num(Math.floor(min / 60))).replace("{m}", num(min % 60));
  }
  // 04.10.2026 (Marc: „225 h … fast 2 Wochen" → „Daten zuerst, Bilder danach") — drei Schritte statt zwei:
  // 1 Dateiliste, 2 Aufnahmedaten (schnell, für alle), 3 Vorschaubilder.
  // 06.10.2026 — Fortschritt des Einlesens auch dann unten rechts, wenn der Medien-Bereich (noch) nicht offen war: nach
  // einem Neustart liest die App von selbst weiter (app.py fotos_wache_starten). Ist der Bereich offen, macht das seine
  // eigene Abfrage (tick) — dann hier nichts.
  let _globalLaeuft = false;
  setInterval(async () => {
    if (angemeldet || !window.rzStatus || !window.pywebview || !window.pywebview.api || _globalLaeuft) return;
    _globalLaeuft = true;
    try {
      const st = await window.pywebview.api.fotos_scan_status();
      if (!st) return;
      const gesamt = st.phase === "dateien" ? (st.erwartet || 0) : (st.total || 0);
      const text = scanSchrittText(st) + " · " + scanStandText(st) + (st.aktuell ? " · " + kurzPfad(st.aktuell) : "");
      if (st.running) {
        if (!window.rzStatus.laeuft("foto-scan")) {
          window.rzStatus.start("foto-scan", { titel: T("fotos.titel", "Medien"), text, gesamt, abbrechen: true, hintergrund: true });
        }
        window.rzStatus.schritt("foto-scan", { text, n: Math.min(st.done || 0, gesamt || (st.done || 0)), gesamt });
        if (window.rzStatus.abgebrochen("foto-scan")) window.pywebview.api.fotos_scan_stop();
      } else if (window.rzStatus.laeuft("foto-scan")) {
        window.rzStatus.fertig("foto-scan", st.error ? String(st.error) : "");
      }
    } catch (_) { /* Brücke noch nicht da / App schließt — beim nächsten Mal */ }
    finally { _globalLaeuft = false; }
  }, 4000);

  function scanSchrittText(st) {
    if (st.phase === "bilder") return T("fotos.kt_schritt3", "Schritt 3 von 3 — legt die Vorschaubilder an");
    if (st.art === "ungelesen") return T("fotos.kt_ungelesen", "Holt Ungelesenes nach");
    if (st.phase !== "dateien") return T("fotos.kt_schritt2b", "Schritt 2 von 3 — liest Aufnahmezeit, Ort und Kamera");
    if (st.gruendlich && st.fortsetzung) return T("fotos.kt_schritt1_fort3", "Schritt 1 von 3 — gründliche Nachschau, macht weiter, wo sie aufhörte: schon geprüfte Ordner gehen schnell");
    return st.gruendlich
      ? T("fotos.kt_schritt1_gr3", "Schritt 1 von 3 — gründliche Nachschau: prüft jede Datei einzeln")
      : T("fotos.kt_schritt1_sch3", "Schritt 1 von 3 — schnelle Nachschau: prüft nur geänderte Ordner");
  }
  /** Eine Zeile Stand: „45.210 von ≈ 170.705 Dateien geprüft (26 %) · 3 neu · noch ca. 12 Min." */
  function scanStandText(st) {
    const z = scanZahlen(st), zw = st.zwischen || {};
    const teile = [];
    if (z.erste) {
      teile.push((z.gesamt
        ? T("fotos.kt_zahl1_von", "{n} von ≈ {g} Dateien geprüft").replace("{g}", num(z.gesamt))
        : T("fotos.kt_zahl1_n", "{n} Dateien geprüft")).replace("{n}", num(z.n)) + (z.proz != null ? ` (${z.proz} %)` : ""));
      if (zw.neu) teile.push(T("fotos.kt_neu", "{n} neu").replace("{n}", num(zw.neu)));
      if (zw.geaendert) teile.push(T("fotos.kt_geaendert", "{n} geändert").replace("{n}", num(zw.geaendert)));
    } else {
      teile.push((st.phase === "bilder" ? T("fotos.kt_zahl3", "{n} von {g} Vorschaubildern") : T("fotos.kt_zahl2", "{n} von {g} gelesen"))
        .replace("{n}", num(z.n)).replace("{g}", num(z.gesamt))
        + (z.proz != null ? ` (${z.proz} %)` : ""));
    }
    const r = restText(z.rest);
    if (r) teile.push(r);
    return teile.join(" · ");
  }
  function scanKlartextHtml(st) {
    const z = scanZahlen(st), zw = st.zwischen || {};
    const zweck = z.erste
      ? (st.gruendlich
          ? T("fotos.kt_zweck1_gr", "Fragt bei jeder Datei Größe und Änderungszeit ab — so fallen auch Änderungen IN Dateien auf (z. B. neu geschriebene EXIF-Daten). Läuft einmal pro Woche und bei „Jetzt einlesen“; auf einem Netzlaufwerk dauert das bei vielen Fotos eine Weile. Geöffnet wird dabei nichts.")
          : T("fotos.kt_zweck1_sch", "Übernimmt Ordner, die sich seit dem letzten Mal nicht geändert haben, und vergleicht nur in den übrigen die Dateien mit dem Bestand. Geöffnet wird dabei nichts."))
      : (st.phase === "bilder"
          ? T("fotos.kt_zweck3", "Legt für jedes Foto ein kleines Vorschaubild in die Bibliothek — dafür muss jede Datei einmal ganz gelesen werden, auf einem Netzlaufwerk ist das der langsamste Teil. Suche, Datum, Karte und Ordner funktionieren schon jetzt; wo du hinschaust, kommen die Bilder sofort.")
          : T("fotos.kt_zweck2b", "Liest Aufnahmezeit, Ort und Kamera aus jeder Datei (nur den Kopf, nicht das ganze Bild). Sobald das durch ist, gehen Suche, Datum, Karte und Ordner für alles; die Vorschaubilder kommen im Anschluss. Die Originale bleiben unberührt."));
    const ort = st.aktuell
      ? (z.erste ? T("fotos.kt_ordner", "Ordner: {p}") : T("fotos.kt_datei", "Datei: {p}")).replace("{p}", kurzPfad(st.aktuell)) : "";
    const ruhig = (z.erste && zw.uebernommen) ? T("fotos.kt_ruhig", "{n} aus unveränderten Ordnern übernommen").replace("{n}", num(zw.uebernommen)) : "";
    // 18.09.2026 (Marc: „interessant, was Schritt 2 dann wäre, damit man weiß, auf was man warten muss")
    const warten = (stand.ungelesen || 0) + (zw.neu || 0) + (zw.geaendert || 0);
    const danach = (z.erste && st.art !== "ungelesen")
      ? T("fotos.kt_danach3", "Danach Schritt 2: liest Aufnahmezeit, Ort und Kamera der neuen Dateien — derzeit warten {n} darauf — und Schritt 3 legt die Vorschaubilder an. Beides läuft im Hintergrund und macht beim nächsten Mal dort weiter, wo es aufhörte.").replace("{n}", num(warten)) : "";
    const balken = z.proz != null
      ? `<div class="foto-kt-balken" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${z.proz}"><span style="width:${z.proz}%"></span></div>` : "";
    // 04.10.2026 (Marc: „mach diesen ganzen langen Text weg … einfach wieder ein Fragezeichen, wo dann ein Tooltip kommt.
    // Schreib nur dazu: läuft im Hintergrund, dass man alles andere weiter benutzen kann") — Zweck und „Danach" im ?.
    const hilfe = (typeof helpTip === "function") ? " " + helpTip([zweck, danach].filter(Boolean).join("\n\n")) : "";
    return `<div class="foto-kt-1">⏳ ${esc(scanSchrittText(st))}${hilfe}</div>
      <div class="foto-kt-zahl">${esc(scanStandText(st))}</div>${balken}
      ${(ort || ruhig) ? `<div class="foto-kt-2 muted">${esc([ort, ruhig].filter(Boolean).join(" · "))}</div>` : ""}
      <div class="foto-kt-2 muted">${esc(T("fotos.kt_hintergrund", "Läuft im Hintergrund — du kannst alles andere weiter benutzen."))}</div>`;
  }
  function kurzPfad(p) {
    const t = String(p).split(/[\\/]/).filter(Boolean);
    return (t.length > 3 ? "…/" : "") + t.slice(-3).join("/");
  }
  /** Eine Zeile Ergebnis nach dem Lauf. */
  function scanErgebnisText(st) {
    const d1 = st.dateien || {}, d2 = st.daten || {};
    const teile = [];
    if (!d1.uebersprungen) teile.push(T("fotos.kt_erg1", "{n} Dateien geprüft: {neu} neu, {g} geändert, {w} nicht mehr da")
      .replace("{n}", num(d1.gesehen || 0)).replace("{neu}", num(d1.neu || 0)).replace("{g}", num(d1.geaendert || 0)).replace("{w}", num(d1.fehlt || 0))
      + (d1.uebernommen ? " (" + T("fotos.kt_ruhig", "{n} aus unveränderten Ordnern übernommen").replace("{n}", num(d1.uebernommen)) + ")" : ""));
    if (d2.gesamt) teile.push(T("fotos.kt_erg2", "Aufnahmedaten und Vorschaubilder von {n} Dateien gelesen").replace("{n}", num(d2.fertig || 0))
      + (d2.fehler ? " (" + T("fotos.kt_erg2f", "{n} nicht lesbar").replace("{n}", num(d2.fehler)) + ")" : ""));
    else if (!d1.uebersprungen) teile.push(T("fotos.kt_erg0", "nichts Neues zu lesen"));
    return teile.length ? T("fotos.kt_fertig", "Fertig.") + " " + teile.join(" · ") : "";
  }

  function kopfOffenHtml() {
    if (!stand.ungelesen) return "";
    // Ohne erreichbares Laufwerk gibt es nichts einzulesen — ein Knopf wäre
    // hier ein falsches Versprechen, der Hinweis oben sagt schon alles.
    if (ordner.length && ordner.every(o => !o.da)) return "";
    // Solange nichts eingelesen ist, gibt es auch keine Vorschaubilder im
    // Speicher — dann muss JEDES Bild einzeln vom Laufwerk kommen.
    const wort = abgebrochen
      ? T("fotos.kopf_weiter", "Weiterlesen")
      : T("fotos.kopf_einlesen", "Jetzt einlesen");
    const satz = abgebrochen
      ? T("fotos.kopf_abgebrochen", "Abgebrochen. Der nächste Lauf macht dort weiter, wo dieser aufhörte.")
      : T("fotos.kopf_offen_hilfe", "Erst nach dem Einlesen liegen Aufnahmedaten und Vorschaubilder in der Bibliothek — bis dahin holt die Ansicht jedes Bild einzeln vom Laufwerk.");
    return ` <button class="btn btn-sm" id="foto-kopf-scan" type="button">${wort}</button>
      <div class="muted" style="margin-top:4px">${satz}</div>`;
  }

  /** „📍 N ohne Koordinate“ im Kopf → Filter (08.10.2026). Auch nach dem Auffrischen des Kopfs neu binden. */
  function kopfOhneBinden(root) {
    const b = root && root.querySelector("#foto-kopf-ohne");
    if (b) b.onclick = () => { filter = Object.assign({}, filter, { gps: "ohne" }); navZeichnen(); neuLaden(); };
  }

  /** Nur die Kopfzeile auffrischen — das Raster bleibt, wo es ist. */
  function kopfAuffrischen() {
    if (!haupt) return;
    const el = haupt.querySelector("#foto-kopf");
    if (!el) return;
    // Audit C-12: während eines Scans kommt das alle 900 ms — nur die Teile tauschen, die sich geändert haben.
    // Sonst ging ein Klick auf das Angebot („Standard einschalten") oder die Sortierknöpfe im Austausch verloren.
    const vorlage = document.createElement("template");
    vorlage.innerHTML = kopfHtml().trim();
    const frisch = vorlage.content.firstElementChild;
    if (!frisch) return;
    const alt = [...el.childNodes], neuK = [...frisch.childNodes];
    if (alt.length === neuK.length && alt.every((n, i) => n.nodeType === neuK[i].nodeType)) {
      alt.forEach((n, i) => {
        const m = neuK[i];
        if (n.nodeType === 3) { if (n.nodeValue !== m.nodeValue) n.nodeValue = m.nodeValue; }
        else if (n.nodeType === 1 && n.outerHTML !== m.outerHTML) n.replaceWith(m);
      });
    } else {
      el.replaceWith(frisch);
    }
    const neu = haupt.querySelector("#foto-kopf");
    if (!neu) return;
    const start = neu.querySelector("#foto-kopf-scan");
    if (start) start.onclick = () => scanStarten();
    const stop = neu.querySelector("#foto-kopf-stop");
    if (stop) stop.onclick = () => { abgebrochen = true; api().fotos_scan_stop(); };
    fernKnopfBinden(neu);
    kopfOhneBinden(neu);
    inhaltBinden(neu);
  }

  /* 04.10.2026 (Marc: „warum haben die Fotos links unten solche Zeitstempel? Es sieht aus, als wären es Videos" —
     „die Kachel soll sauber bleiben, beim Drüberfahren muss es gar nichts anzeigen; nur beim Draufklicken wird die
     rechte Seite verändert") — keine Uhrzeit und kein Tooltip auf der Kachel. Zahl auf der Kachel = Videolänge (▶).
     Auch das „!" für fehlende Daten ist weg (Marc: „ja weg mit !") — Fehlendes zeigen die Filter links
     („Ohne Koordinate", „Ohne Aufnahmezeit") und rechts die Befunde. Name und Aufnahmedaten stehen in der Detailspalte. Für Screenreader trägt die Kachel
     Dateinamen und Befund als aria-label. */
  /* 08.10.2026 — das Bild bleibt sauber, darunter EINE Zeile
     Datum · Uhrzeit · Ort (kein Dateiname). Das Kästchen zum Markieren erscheint beim Drüberfahren und, sobald etwas
     markiert ist, auf allen Kacheln. */
  function kachelZeile(f) {
    const teile = [];
    if (f.tag_lokal) {
      try {
        const loc = (typeof i18nMeta === "function" && i18nMeta().active) || "de";
        teile.push(new Date(f.tag_lokal + "T12:00:00Z").toLocaleDateString(loc, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }));
      } catch (_) { teile.push(f.tag_lokal); }
    }
    const u = uhrzeit(f); if (u) teile.push(u);
    const ort = String(f.ort || "").split(",")[0].trim() || String(f.region || "").trim();
    return `<span class="foto-kachel-zeile"><span class="fkz-zeit">${esc(teile.join(" · "))}</span>${ort ? `<span class="fkz-ort">${esc(ort)}</span>` : ""}</span>`;
  }
  function kachelHtml(f, i) {
    const m = maengel(f);
    const bild = f.thumb_url
      ? `<img loading="lazy" src="${f.thumb_url}" alt="">`
      : `<div class="foto-kachel-leer">${I(f.art === "video" ? "clapperboard" : "image", 28)}</div>`;
    return `
      <button class="foto-kachel${auswahl === f.path ? " is-on" : ""}${markiert.has(f.path) ? " is-markiert" : ""}${f.bearbeitet ? " ist-bearbeitet" : ""}" type="button" data-foto="${i}"
              aria-label="${esc(f.dateiname)}${m.length ? " — " + esc(m.join(", ")) : ""}">
        <span class="foto-kachel-bild">${bild}
          <span class="foto-kachel-check" title="${esc(T("fotos.markieren_tip", "Markieren (oder ⌘-Klick)"))}" aria-hidden="true"></span>
          <span class="foto-kachel-herz${f.fav ? " ist-fav" : ""}" title="${esc(T("fotos.fav_tip", "Favorit (P)"))}" aria-hidden="true">${herz(f.fav, 16)}</span>
          ${f.art === "video" ? `<span class="foto-kachel-art">▶ ${esc(dauerText(f.dauer_s))}</span>` : ""}
          <span class="foto-kachel-bearb" title="${esc(T("bearb.kachel_tip", "Bearbeitet — das Original bleibt unverändert"))}" aria-hidden="true">${I("pencil", 13)}</span></span>
        ${kachelZeile(f)}
      </button>`;
  }

  function rasterZeichnen(box) {
    rasterBox = box;
    if (!geladen.length) {
      box.innerHTML = `<div class="lib-detail-empty" style="padding:20px">${
        stand.gesamt ? T("fotos.leer_filter", "Kein Treffer für diese Auswahl.")
                     : T("fotos.leer", "Noch keine Fotos im Bestand. Links einen Ordner hinzufügen, dann einlesen.")}</div>`;
      return;
    }
    box.innerHTML = gruppenHtml(0) + fussHtml();
    rasterVerdrahten(box, 0);
  }

  /** Die Tagesgruppen ab einem Index — so kann angehängt werden, ohne das
      ganze Raster neu zu bauen (sonst springt beim Weiterblättern die
      Ansicht nach oben). */
  function gruppenHtml(ab) {
    const gruppen = [];
    let letzte = null;
    // §81 — Inhaltssuche nach Relevanz: gegliedert nach Art des Treffers statt nach Tagen
    const nachArt = !!(inhaltTreffer && sortierung === "relevanz");
    for (let i = ab; i < geladen.length; i++) {
      const f = geladen[i];
      const tag = nachArt ? ("#" + (f.treffer || "inhalt")) : (f.tag_lokal || "");
      if (!letzte || letzte.tag !== tag) { letzte = { tag, fotos: [] }; gruppen.push(letzte); }
      letzte.fotos.push([f, i]);
    }
    const kopfText = (tag) => tag === "#text" ? T("fotos.inh_gruppe_text", "Treffer in Name, Stichwort oder Ort")
      : tag === "#inhalt" ? (inhaltTreffer && inhaltTreffer.art === "aehnlich" ? T("fotos.inh_gruppe_aehnlich", "Ähnliche Fotos — die ähnlichsten zuerst")
                                                                        : T("fotos.inh_gruppe_bild", "Nach Bildinhalt — die besten zuerst"))
      : tagText(tag);
    return gruppen.map(g => `
      <div class="foto-tag" data-tag="${esc(g.tag)}">
        <div class="foto-tag-kopf">${esc(kopfText(g.tag))}
          <span class="muted">${num(g.fotos.length)}</span>${g.tag && g.tag[0] !== "#" ? `<span class="foto-tag-touren" data-tag-touren="${esc(g.tag)}"></span>` : ""}</div>
        <div class="foto-raster">${g.fotos.map(([f, i]) => kachelHtml(f, i)).join("")}</div>
      </div>`).join("");
  }

  /* Der Fuß ist zugleich die Stelle, an der weitergeladen wird: kommt er in
     Sicht, holt die Ansicht die nächste Seite von selbst (Marc, 12.09.2026:
     „bau ein infinity scrolling"). Der Knopf bleibt als Rückfallweg — wer mit
     der Tastatur unterwegs ist, kommt sonst nie ans Ende. */
  function fussHtml() {
    if (geladen.length >= gesamt) {
      return `<div class="foto-fuss muted">${T("fotos.alle_da", "Alle {n} Dateien geladen.").replace("{n}", num(gesamt))}</div>`;
    }
    return `<div class="foto-fuss" id="foto-fuss">
      <button class="btn" id="foto-mehr" type="button">${T("fotos.mehr", "Weitere {n} laden")
        .replace("{n}", num(Math.min(SEITE, gesamt - geladen.length)))}</button>
      <div class="muted" style="margin-top:4px">${T("fotos.geladen_von", "{a} von {b}")
        .replace("{a}", num(geladen.length)).replace("{b}", num(gesamt))}</div>
    </div>`;
  }

  /* 08.10.2026 — mehrere markieren (⌘/Strg-Klick einzeln, Umschalt-Klick einen Bereich) und per Rechtsklick
     exportieren. Ein normaler Klick hebt die Markierung auf und zeigt das Foto rechts, wie bisher. */
  let markiert = new Set(), _letzterKlick = -1;
  function markierungZeigen() {
    if (!haupt) return;
    haupt.querySelectorAll(".foto-kachel").forEach(k => { const f = geladen[+k.dataset.foto]; k.classList.toggle("is-markiert", !!f && markiert.has(f.path)); });
    haupt.classList.toggle("hat-markierung", markiert.size > 0);
    markLeisteZeigen();
  }
  /* 09.10.2026 — Favoriten: nur in der Bibliothek. Sind alle schon Favorit, wird es weggenommen. */
  async function favUmschalten(pfade, jetztFav) {
    pfade = (pfade || []).filter(Boolean); if (!pfade.length) return;
    const an = jetztFav !== undefined ? !jetztFav : !pfade.every(p => (geladen.find(x => x.path === p) || {}).fav);
    const r = await api().fotos_favorit(pfade, an).catch(() => null);   // warte-ok: schreibt nur Zeilen in die Bibliothek
    if (!r || !r.ok) { toast((r && r.error) || "?", "warn"); return; }
    geladen.forEach(x => { if (pfade.includes(x.path)) x.fav = an ? 1 : 0; });
    if (haupt) haupt.querySelectorAll(".foto-kachel").forEach(k => {
      const x = geladen[+k.dataset.foto]; if (!x || !pfade.includes(x.path)) return;
      const h = k.querySelector(".foto-kachel-herz"); if (h) { h.innerHTML = herz(an, 16); h.classList.toggle("ist-fav", an); }
    });
    if (stand) stand.fav = r.stand_fav;
    navZeichnen();
    if (filter.fav && !an) neuLaden(true);
    if (auswahl && pfade.includes(auswahl)) { const h = document.getElementById("fd-fav"); if (h) { h.innerHTML = herz(an, 18); h.classList.toggle("ist-fav", an); } }
  }

  /* 09.10.2026 — Alben: selbst zusammengestellt, nur in der Bibliothek. */
  let alben = [];
  async function albenLaden() {
    const r = await api().fotos_alben().catch(() => null);   // warte-ok: Liste links füllt sich nach
    const neu = (r && r.ok && r.alben) || [];
    // nur neu zeichnen, wenn sich etwas geändert hat — ein zweites Zeichnen gleich nach dem Öffnen nahm den Bäumen
    // ihre Ladeanzeige (die Anfrage lief schon, der neue Baum blieb leer)
    if (JSON.stringify(neu) === JSON.stringify(alben)) return;
    alben = neu;
    navZeichnen();
  }
  function nameFragen(titel, vorgabe) {
    return new Promise((fertig) => {
      if (typeof openModal !== "function") { fertig(null); return; }
      const m = openModal({
        title: titel,
        body: `<input type="text" id="fn-name" class="lib-input" value="${esc(vorgabe || "")}" maxlength="120" style="width:100%">`,
        footer: `<button type="button" class="btn" id="fn-ab">${esc(T("common.cancel", "Abbrechen"))}</button>
                 <button type="button" class="btn btn-primary" id="fn-ok">${esc(T("common.ok", "OK"))}</button>`,
        onClose: () => fertig(null),
      });
      const ein = document.getElementById("fn-name");
      const ok = () => { const v = ein.value.trim(); if (!v) return; fertig(v); m.close(); };
      document.getElementById("fn-ab").onclick = () => m.close();
      document.getElementById("fn-ok").onclick = ok;
      ein.onkeydown = (e) => { if (e.key === "Enter") ok(); };
      setTimeout(() => { ein.focus(); ein.select(); }, 30);
    });
  }
  async function zuAlbumMenue(knopf, pfade) {
    document.querySelectorAll(".ts-menue").forEach(x => x.remove());
    const menue = document.createElement("div");
    menue.className = "lib-ctxmenu ts-menue"; menue.setAttribute("role", "menu");
    const r0 = knopf.getBoundingClientRect();
    menue.style.left = r0.left + "px"; menue.style.top = (r0.bottom + 4) + "px";
    menue.innerHTML = alben.map((a, i) => `<button type="button" class="lib-ctx-item" data-a="${i}">${I("book-image")} ${esc(a.name)} <span class="muted">${num(a.n)}</span></button>`).join("")
      + `<button type="button" class="lib-ctx-item" data-neu="1">${I("plus")} ${esc(T("fotos.album_neu", "Neues Album …"))}</button>`;
    document.body.appendChild(menue);
    const zu = (e) => { if (!menue.contains(e.target)) { menue.remove(); document.removeEventListener("mousedown", zu, true); } };
    setTimeout(() => document.addEventListener("mousedown", zu, true), 0);
    menue.querySelectorAll("[data-a]").forEach(b => {
      b.onclick = async () => {
        const a = alben[+b.dataset.a]; menue.remove();
        const w = await api().fotos_album_inhalt(a.id, pfade, true).catch(() => null);   // warte-ok: schreibt nur Zeilen
        if (w && w.ok) { alben = w.alben || alben; navZeichnen(); toast(T("fotos.album_ok", "{n} ins Album „{a}“ gelegt.").replace("{n}", num(pfade.length)).replace("{a}", a.name), "success", 3500); }
      };
    });
    const neuK = menue.querySelector("[data-neu]");
    if (neuK) neuK.onclick = async () => {
      menue.remove();
      const name = await nameFragen(T("fotos.album_neu", "Neues Album …"), "");
      if (!name) return;
      const w = await api().fotos_album_neu(name, pfade).catch(() => null);   // warte-ok: schreibt nur Zeilen
      if (w && w.ok) { alben = w.alben || alben; navZeichnen(); toast(T("fotos.album_ok", "{n} ins Album „{a}“ gelegt.").replace("{n}", num(pfade.length)).replace("{a}", name), "success", 3500); }
    };
  }

  /* 08.10.2026 — „N ausgewählt“ mit den Aktionen des Rechtsklicks; kein Löschen. */
  function markLeisteZeigen() {
    if (!haupt) return;
    let l = haupt.querySelector("#foto-markleiste");
    const sichtbar = new Set(geladen.map(x => x.path));
    const pfade = [...markiert].filter(p => sichtbar.has(p));
    if (!pfade.length) { if (l) l.remove(); return; }
    if (!l) {
      l = document.createElement("div");
      l.id = "foto-markleiste"; l.className = "foto-markleiste";
      const kopf = haupt.querySelector("#foto-kopf");
      if (kopf && kopf.nextSibling) kopf.parentNode.insertBefore(l, kopf.nextSibling); else haupt.prepend(l);
    }
    const n = pfade.length;
    l.innerHTML = `<span class="fml-zahl">${esc(T("fotos.markiert_n", "{n} ausgewählt").replace("{n}", num(n)))}</span>
      <button type="button" class="btn btn-sm" data-ml="export">${I("share", 14)} ${esc(T("export.medien_eins", "Exportieren …"))}</button>
      <button type="button" class="btn btn-sm" data-ml="ort">${I("map-pin", 14)} ${esc(T("ort.ctx_1", "Ort setzen …"))}</button>
      <button type="button" class="btn btn-sm" data-ml="fav" title="${esc(T("fotos.fav_tip", "Favorit (P)"))}">${I("heart", 14)} ${esc(T("fotos.fav", "Favorit"))}</button>
      <button type="button" class="btn btn-sm" data-ml="album">${I("book-image", 14)} ${esc(T("fotos.zu_album", "Zu Album …"))}</button>
      <button type="button" class="btn btn-sm" data-ml="auto" title="${esc(T("bearb.auto_alle_tip", "Ton und Weißabgleich je Foto automatisch — danach einzeln nacharbeiten"))}">${I("sparkles", 14)} ${esc(T("bearb.auto", "Auto"))}</button>
      ${bearbAblage ? `<button type="button" class="btn btn-sm" data-ml="einfuegen">${esc(T("bearb.einfuegen", "Einfügen"))}</button>` : ""}
      <button type="button" class="btn btn-sm" data-ml="tour">${I("route", 14)} ${esc(T("fotos.zu_tour", "Zu Tour …"))}</button>
      ${n > 1 ? `<button type="button" class="btn btn-sm" data-ml="neu">${I("compass", 14)} ${esc(T("tour_aus_fotos.kurz", "Tour daraus …"))}</button>` : ""}
      <button type="button" class="btn btn-sm" data-ml="mit">${I("external-link", 14)} ${esc(T("oeffnen.ctx_1", "Öffnen mit …"))}</button>
      <span class="fml-luft"></span>
      <button type="button" class="btn btn-sm btn-ghost" data-ml="alle" title="${esc(T("fotos.alle_markieren_tip", "Alle geladenen markieren (⌘A)"))}">${esc(T("fotos.alle_markieren", "Alle"))}</button>
      <button type="button" class="btn btn-sm btn-ghost" data-ml="weg" title="${esc(T("fotos.markierung_weg", "Markierung aufheben (Esc)"))}">✕</button>`;
    const A = window.rzArchivExport;
    l.querySelectorAll("[data-ml]").forEach(b => {
      b.onclick = (e) => {
        const w = b.dataset.ml, p = [...markiert].filter(x => sichtbar.has(x));
        if (w === "weg") { markiert.clear(); _letzterKlick = -1; markierungZeigen(); }
        else if (w === "alle") { geladen.forEach(x => markiert.add(x.path)); markierungZeigen(); }
        else if (w === "export" && A) A.medien(p);
        else if (w === "ort" && A) A.ortSetzen(p, () => { markiert.clear(); neuLaden(true); });
        else if (w === "neu" && A) A.tourAusFotos(p);
        else if (w === "mit" && A) A.oeffnenMit(p);
        else if (w === "tour") zuTourMenue(b, p);
        else if (w === "fav") favUmschalten(p);
        else if (w === "auto") bearbFuerMarkierte({ auto: true }, p);
        else if (w === "einfuegen" && bearbAblage) bearbFuerMarkierte(bearbAblage, p);
        else if (w === "album") zuAlbumMenue(b, p);
      };
    });
  }
  /** „Zu Tour …“ für mehrere: die Touren der Tage der markierten Medien zur Auswahl. */
  async function zuTourMenue(knopf, pfade) {
    document.querySelectorAll(".ts-menue").forEach(x => x.remove());
    const tage = [...new Set(geladen.filter(x => pfade.includes(x.path)).map(x => x.tag_lokal).filter(Boolean))].slice(0, 60);
    const menue = document.createElement("div");
    menue.className = "lib-ctxmenu ts-menue"; menue.setAttribute("role", "menu");
    const r0 = knopf.getBoundingClientRect();
    menue.style.left = r0.left + "px"; menue.style.top = (r0.bottom + 4) + "px";
    menue.innerHTML = `<div class="lib-ctx-item is-aus"><span class="ass-spinner"></span> ${esc(T("fotos.zu_tour_laedt", "Touren dieser Tage …"))}</div>`;
    document.body.appendChild(menue);
    const zu = (e) => { if (!menue.contains(e.target)) { menue.remove(); document.removeEventListener("mousedown", zu, true); } };
    setTimeout(() => document.addEventListener("mousedown", zu, true), 0);
    const r = await api().touren_an_tagen(tage).catch(() => null);   // warte-ok: Menü zeigt „Touren dieser Tage …“
    if (!menue.isConnected) return;
    const touren = []; const seen = new Set();
    Object.values((r && r.tage) || {}).forEach(l => (l || []).forEach(t => { if (!seen.has(t.geo_hash)) { seen.add(t.geo_hash); touren.push(t); } }));
    menue.innerHTML = touren.length ? touren.map((t, i) => `<button type="button" class="lib-ctx-item" data-t="${i}">${I("route", 14)} ${esc(t.name || "")}</button>`).join("")
      : `<div class="lib-ctx-item is-aus">${esc(T("fotos.zu_tour_keine", "An diesen Tagen gibt es keine Tour."))}</div>`;
    menue.querySelectorAll("[data-t]").forEach(b => {
      b.onclick = async () => {
        const t = touren[+b.dataset.t]; menue.remove();
        const w = await rzWarten("tour_medien_korrigieren", () => api().tour_medien_korrigieren(t.geo_hash, pfade, true)).catch(() => null);
        if (w && w.ok) toast(T("fotos.zu_tour_ok", "{n} zur Tour „{t}“ genommen.").replace("{n}", num(pfade.length)).replace("{t}", t.name || ""), "success", 4000);
        else toast((w && w.error) || "?", "warn");
      };
    });
  }
  function kachelKlick(e, i) {
    const f = geladen[i]; if (!f) return;
    if (e.target && e.target.closest && e.target.closest(".foto-kachel-herz")) { favUmschalten(markiert.has(f.path) ? [...markiert] : [f.path]); return; }
    if (e.metaKey || e.ctrlKey || (e.target && e.target.closest && e.target.closest(".foto-kachel-check"))) {
      if (!markiert.size && auswahl && geladen.some(x => x.path === auswahl)) markiert.add(auswahl);
      if (markiert.has(f.path)) markiert.delete(f.path); else markiert.add(f.path);
      _letzterKlick = i; markierungZeigen(); return;
    }
    if (e.shiftKey && _letzterKlick >= 0) {
      const [a, b] = [Math.min(_letzterKlick, i), Math.max(_letzterKlick, i)];
      for (let j = a; j <= b; j++) if (geladen[j]) markiert.add(geladen[j].path);
      markierungZeigen(); return;
    }
    if (markiert.size) { markiert.clear(); markierungZeigen(); }
    _letzterKlick = i;
    detailZeigen(f);
  }
  function kachelMenue(e, i) {
    e.preventDefault();
    const f = geladen[i]; if (!f) return;
    // 08.10.2026 (Durchsicht) — nur Markierte, die gerade zu sehen sind: nach einem Filterwechsel hätte „Ort für 7 setzen“
    // sonst auch in 5 Originale geschrieben, die nicht mehr auf dem Schirm stehen
    const sichtbar = new Set(geladen.map(x => x.path));
    const pfade = markiert.size && markiert.has(f.path) ? [...markiert].filter(p => sichtbar.has(p)) : [f.path];
    document.querySelectorAll(".ts-menue").forEach(x => x.remove());
    const menue = document.createElement("div");
    menue.className = "lib-ctxmenu ts-menue"; menue.setAttribute("role", "menu");
    const eintraege = [
      ["🔍 " + T("fotos.gross", "Groß ansehen"), () => grossOeffnen(f)],
      ["⬇ " + (pfade.length > 1 ? T("export.medien_n", "{n} exportieren …").replace("{n}", num(pfade.length)) : T("export.medien_eins", "Exportieren …")),
        () => { if (window.rzArchivExport) window.rzArchivExport.medien(pfade); }],
      ["📍 " + (pfade.length > 1 ? T("ort.ctx_n", "Ort für {n} setzen …").replace("{n}", num(pfade.length)) : T("ort.ctx_1", "Ort setzen …")),
        () => { if (window.rzArchivExport) window.rzArchivExport.ortSetzen(pfade, () => { markiert.clear(); neuLaden(true); }); }],
      ...(pfade.length > 1 ? [["🧭 " + T("tour_aus_fotos.ctx", "Tour aus diesen {n} Fotos machen …").replace("{n}", num(pfade.length)),
        () => { if (window.rzArchivExport) window.rzArchivExport.tourAusFotos(pfade); }]] : []),
      ["⬇ " + T("export.medien_alle", "Alle {n} gefilterten exportieren …").replace("{n}", num(gesamt)),
        () => { if (window.rzArchivExport) window.rzArchivExport.medien([], Object.assign({}, filter), gesamt); }],
      ["↗ " + (pfade.length > 1 ? T("oeffnen.ctx_n", "{n} öffnen mit …").replace("{n}", num(pfade.length)) : T("oeffnen.ctx_1", "Öffnen mit …")),
        () => { if (window.rzArchivExport) window.rzArchivExport.oeffnenMit(pfade); }],
      ["📁 " + T("fotos.im_finder", "Im Finder zeigen"), () => api().reveal_in_finder(f.path)],
    ];
    menueZeigen(menue, eintraege, e.clientX, e.clientY);
  }
  /** Kontextmenü `menue` mit [Text, Aktion]-Einträgen bei (x, y) zeigen; Klick daneben oder Esc schließt. */
  function menueZeigen(menue, eintraege, x, y) {
    eintraege.forEach(([text, tun]) => {
      const b = document.createElement("button"); b.type = "button"; b.className = "lib-ctx-item";
      // 09.10.2026 — das Zeichen vorn im Menütext wird zum Strich-Symbol (ui/js/icons.js)
      if (typeof rzTextMitSymbol === "function") b.innerHTML = rzTextMitSymbol(text); else b.textContent = text;
      b.onclick = () => { zu(); tun(); }; menue.appendChild(b);
    });
    document.body.appendChild(menue);
    menue.style.left = Math.max(4, Math.min(x, window.innerWidth - menue.offsetWidth - 6)) + "px";
    menue.style.top = Math.max(4, Math.min(y, window.innerHeight - menue.offsetHeight - 6)) + "px";
    const aussen = (ev) => { if (!menue.contains(ev.target)) zu(); };
    const taste = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); zu(); } };
    function zu() { document.removeEventListener("mousedown", aussen, true); document.removeEventListener("keydown", taste, true); menue.remove(); }
    setTimeout(() => { document.addEventListener("mousedown", aussen, true); document.addEventListener("keydown", taste, true); }, 0);
  }

  /* 09.10.2026 (Marc: „der Export-Knopf muss nach oben“) — Exportieren als Hauptaktion oben rechts (Koralle), in der
     Medien-Leiste und in der Lupe. Das Menü bietet, was gerade da ist: die Markierten, das gezeigte Medium, alle gefilterten. */
  function exportKnopfHtml(id) {
    return `<button type="button" class="btn btn-sm btn-cta foto-export-knopf" id="${id}" title="${esc(T("export.knopf_tip", "Markierte, dieses oder alle gefilterten Medien exportieren"))}">${I("share", 14)} ${esc(T("export.knopf", "Exportieren"))}</button>`;
  }
  function exportMenue(anker, f) {
    const ex = window.rzArchivExport; if (!ex || !anker) return;
    document.querySelectorAll(".ts-menue").forEach(x => x.remove());
    const sichtbar = new Set(geladen.map(x => x.path));
    const mark = [...markiert].filter(p => sichtbar.has(p));
    const eintraege = [];
    if (mark.length) eintraege.push(["⬇ " + (mark.length > 1 ? T("export.medien_n", "{n} exportieren …").replace("{n}", num(mark.length)) : T("export.medien_markiert_1", "Das markierte exportieren …")), () => ex.medien(mark)]);
    if (f && f.path && !(mark.length && mark.includes(f.path) && mark.length === 1)) {
      eintraege.push(["⬇ " + T("export.medien_datei", "„{name}“ exportieren …").replace("{name}", f.dateiname || String(f.path).split(/[\\/]/).pop()), () => ex.medien([f.path])]);
    }
    if (gesamt) eintraege.push(["⬇ " + T("export.medien_alle", "Alle {n} gefilterten exportieren …").replace("{n}", num(gesamt)), () => ex.medien([], Object.assign({}, filter), gesamt)]);
    if (!eintraege.length) { toast(T("export.nichts", "Nichts zum Exportieren — erst Medien einlesen oder den Filter lockern."), "info", 4000); return; }
    const menue = document.createElement("div");
    menue.className = "lib-ctxmenu ts-menue foto-export-menue"; menue.setAttribute("role", "menu");
    const r = anker.getBoundingClientRect();
    menueZeigen(menue, eintraege, r.right, r.bottom + 4);
    // rechtsbündig unter dem Knopf
    menue.style.left = Math.max(4, r.right - menue.offsetWidth) + "px";
  }

  /* 08.10.2026 (Stufe 2: „ein Tag = Tour + Fotos + Clips“) — im Kopf jedes Tages die Touren dieses Tages
     (Klick → Tour-Seite); ohne Tour, aber mit Fotos mit Ort: „🧭 Tour aus diesen Fotos“. Je Tag einmal gefragt. */
  const _tagTouren = new Map();
  async function tagTourenFuellen(box) {
    if (!box) return;
    const plaetze = [...box.querySelectorAll("[data-tag-touren]")].filter(e => !e.dataset.gefuellt);
    const offen = [...new Set(plaetze.map(e => e.dataset.tagTouren).filter(t => !_tagTouren.has(t)))];
    if (offen.length) {
      const r = await api().touren_an_tagen(offen).catch(() => null);   // warte-ok: Köpfe füllen sich nach
      for (const t of offen) _tagTouren.set(t, (r && r.ok && r.tage && r.tage[t]) || []);
    }
    for (const el of plaetze) {
      if (!el.isConnected) continue;
      const tag = el.dataset.tagTouren, touren = _tagTouren.get(tag) || [];
      el.dataset.gefuellt = "1";
      if (touren.length) {
        el.innerHTML = touren.map((x, i) => `<button type="button" class="foto-such-tour" data-i="${i}" title="${esc(T("fotos.d_tour_tip", "Tour-Seite öffnen: Karte, alle Fotos und Clips der Tour"))}">${I("route", 13)} ${esc(x.name || "")}</button>`).join("");
        el.querySelectorAll("[data-i]").forEach(b => { b.onclick = (e) => { e.stopPropagation(); const x = touren[+b.dataset.i]; if (window.rzTourSeite) window.rzTourSeite.oeffnen({ geo_hash: x.geo_hash, path: x.path, name: x.name }); }; });
      } else {
        const mitOrt = geladen.filter(f => f.tag_lokal === tag && f.lat != null && f.lon != null).map(f => f.path);
        if (mitOrt.length >= 2 && window.rzArchivExport) {
          el.innerHTML = `<button type="button" class="foto-such-tour foto-tag-neu" title="${esc(T("tour_aus_fotos.tag_tip", "Aus den Fotos dieses Tages eine Tour machen — mit Karte, Tour-Seite und Video"))}">${I("compass", 13)} ${esc(T("tour_aus_fotos.tag", "Tour aus diesen Fotos"))}</button>`;
          el.querySelector("button").onclick = (e) => { e.stopPropagation(); window.rzArchivExport.tourAusFotos(mitOrt); };
        }
      }
    }
  }

  function rasterVerdrahten(box, ab) {
    tagTourenFuellen(box).catch(() => {});
    box.querySelectorAll("[data-foto]").forEach(b => {
      if (+b.dataset.foto < ab) return;
      b.onclick = (e) => kachelKlick(e, +b.dataset.foto);
      // 04.10.2026 — Großansicht. 08.10.2026 (Klicktest): nicht beim schnellen ⌘/Shift-Dazumarkieren
      b.ondblclick = (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || (e.target.closest && e.target.closest(".foto-kachel-check, .foto-kachel-herz"))) return; grossOeffnen(geladen[+b.dataset.foto]); };
      b.oncontextmenu = (e) => kachelMenue(e, +b.dataset.foto);
    });
    if (markiert.size) markierungZeigen();
    const mehr = box.querySelector("#foto-mehr");
    if (mehr) mehr.onclick = () => { mehr.disabled = true; mehrLaden(); };
    fussBeobachten(box);
  }

  function fussBeobachten(box) {
    if (fussWache) { try { fussWache.disconnect(); } catch (_) {} fussWache = null; }
    const fuss = box.querySelector("#foto-fuss");
    if (!fuss || typeof IntersectionObserver !== "function") return;
    fussWache = new IntersectionObserver((eintraege) => {
      if (!eintraege.some(e => e.isIntersecting)) return;
      if (nachladend || geladen.length >= gesamt || !angemeldet) return;
      mehrLaden(true);
      // `box` ist selbst der scrollende Kasten (.foto-body) — nicht das
      // Fenster: mit `root: null` würde die Wache nie auslösen.
    }, { root: box, rootMargin: "600px" });
    fussWache.observe(fuss);
    // Schärfen folgt dem Blick: nach dem Scrollen kurz warten, dann das jetzt Sichtbare nachschärfen
    box.onscroll = () => { clearTimeout(_schaerfenZeit); _schaerfenZeit = setTimeout(() => { if (angemeldet) schaerfen(thumbLauf); }, 400); };
  }

  /** Nach dem Nachladen nur das Neue anhängen. */
  function rasterAnhaengen(ab) {
    const box = rasterBox;
    if (!box || !box.isConnected) { zeichnen(); return; }
    const fuss = box.querySelector(".foto-fuss");
    if (fuss) fuss.remove();
    // Fällt der erste neue Tag mit dem letzten gezeigten zusammen, wächst die
    // vorhandene Gruppe weiter, statt eine zweite mit demselben Datum zu
    // beginnen.
    const letzteGruppe = box.querySelector(".foto-tag:last-of-type");
    const neuHtml = gruppenHtml(ab);
    const huelle = document.createElement("div");
    huelle.innerHTML = neuHtml;
    const ersteNeue = huelle.querySelector(".foto-tag");
    if (letzteGruppe && ersteNeue &&
        letzteGruppe.dataset.tag === ersteNeue.dataset.tag) {
      const zielRaster = letzteGruppe.querySelector(".foto-raster");
      const quelle = ersteNeue.querySelector(".foto-raster");
      if (zielRaster && quelle) zielRaster.insertAdjacentHTML("beforeend", quelle.innerHTML);
      const zahl = letzteGruppe.querySelector(".foto-tag-kopf .muted");
      if (zahl) zahl.textContent = num(zielRaster.querySelectorAll(".foto-kachel").length);
      ersteNeue.remove();
    }
    box.insertAdjacentHTML("beforeend", huelle.innerHTML + fussHtml());
    rasterVerdrahten(box, ab);
  }

  let _tourenSuche = "";   // 08.10.2026 — Suche in „Nach Touren“ bleibt beim Neuzeichnen stehen
  async function tourenZeichnen(box) {
    box.innerHTML = `<div class="lib-detail-empty" style="padding:20px">${T("common.loading", "Lädt …")}</div>`;
    const r = await rzWarten("fotos_touren", () => api().fotos_touren(filter)).catch(() => null);
    if (!r || !r.ok) { box.innerHTML = `<div class="lib-detail-empty" style="padding:20px">${esc((r && r.error) || "?")}</div>`; return; }
    const liste = r.touren || [];
    if (!liste.length) {
      box.innerHTML = `<div class="lib-detail-empty" style="padding:20px">${
        T("fotos.touren_leer", "Keine Tour passt zeitlich zu diesen Fotos. Das Archiv braucht Touren mit Uhrzeit.")}</div>`;
      return;
    }
    // 08.10.2026 (Beta-Tester: „kein Datum, kein Ort, muss ich das anders filtern, um ein bestimmtes Projekt zu
    // öffnen? Mir ist ja Ort oder Jahr bekannt“) — je Tour Datum, Ort, Fortbewegung, km; Zwischenüberschrift je Jahr;
    // Suchfeld; „Im Animator öffnen“. Namen aus Export-Nummern („24613993220_ACTIVITY“, Adresse im Namen) → Ort.
    const _spr = (typeof i18nMeta === "function" && i18nMeta() && i18nMeta().active) || undefined;   // Sprache der App, nicht des Systems
    const datum = (s) => { try { return new Date(s * 1000).toLocaleDateString(_spr, { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" }); } catch (_) { return ""; } };
    const jahr = (s) => { try { return String(new Date(s * 1000).getFullYear()); } catch (_) { return ""; } };
    const ortVon = (g) => [g.place, g.region && g.region !== g.place ? g.region : "", !g.place && !g.region ? g.country : ""].filter(Boolean).join(", ");
    const nurNummer = (n) => !n || /@/.test(n) || /^\d{6,}/.test(n) || /_ACTIVITY\b/i.test(n) || /^activity[_\s-]*\d+/i.test(n);
    const anzeigeName = (g) => (nurNummer(g.name) ? (g.place || g.region || ortVon(g) || T("library.tour", "Tour")) : g.name);
    const zeile = (g, i) => {
      if (g.ohne_tour) return `<div class="foto-tour ist-ohne" data-ftour="${i}" role="button" tabindex="0">
          <div class="foto-tour-name">${T("fotos.ohne_tour", "Zu keiner Tour")}</div>
          <div class="foto-tour-zahl">${num(g.n)} ${T("fotos.stueck", "Dateien")}</div></div>`;
      const meta = [datum(g.von), ortVon(g), g.activity ? T("library.act." + g.activity, g.activity) : "", g.km ? `${num(g.km)} km` : ""].filter(Boolean).join(" · ");
      return `<div class="foto-tour" data-ftour="${i}" role="button" tabindex="0" title="${esc(g.name || "")}">
          <div class="foto-tour-kopf"><div class="foto-tour-name">${esc(anzeigeName(g))}</div>
            <button type="button" class="btn btn-ghost btn-sm foto-tour-anim" data-fanim="${i}" title="${T("fotos.tour_animator_tip", "Diese Tour im Animator öffnen")}">${I("clapperboard", 14)} ${T("fotos.tour_animator", "Im Animator öffnen")}</button></div>
          <div class="foto-tour-meta">${esc(meta)}</div>
          <div class="foto-tour-zahl">${num(g.n)} ${T("fotos.stueck", "Dateien")}${
            g.ohne_koordinate ? ` · ${num(g.ohne_koordinate)} ${T("fotos.ohne_koordinate_kurz", "ohne Koordinate")}` : ""}</div>
        </div>`;
    };
    const suchText = (g) => [g.name, anzeigeName(g), ortVon(g), g.country, datum(g.von), jahr(g.von), g.activity ? T("library.act." + g.activity, g.activity) : ""].join(" ").toLowerCase();
    const listeHtml = (q) => {
      const w = String(q || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
      let html = "", jahrDavor = null, n = 0;
      liste.forEach((g, i) => {
        if (w.length && (g.ohne_tour || !w.every(x => suchText(g).includes(x)))) return;
        const j = g.ohne_tour ? "" : jahr(g.von);
        if (j && j !== jahrDavor) { html += `<div class="foto-touren-jahr">${esc(j)}</div>`; jahrDavor = j; }
        html += zeile(g, i); n++;
      });
      return n ? html : `<div class="lib-detail-empty" style="padding:14px">${T("fotos.touren_keine_treffer", "Keine Tour passt zur Suche.")}</div>`;
    };
    box.innerHTML = `
      <div class="lib-nav-hint" style="padding:10px 12px 0">${T("fotos.touren_hint",
        "Zugeordnet über das Zeitfenster der Tour — nichts davon steht in den Dateien. Genau das kann kein reines Fototool: die Touren liegen hier schon.")}</div>
      <div class="foto-touren-suche"><input type="search" class="input" id="foto-touren-q" placeholder="${T("fotos.touren_suche", "Tour suchen — Ort, Jahr, Name …")}" value="${esc(_tourenSuche)}"></div>
      <div class="foto-touren">${listeHtml(_tourenSuche)}</div>`;
    const listeEl = box.querySelector(".foto-touren");
    const binden = () => {
      listeEl.querySelectorAll("[data-ftour]").forEach(b => {
        const los = async (ev) => {
          if (ev && ev.target.closest("[data-fanim]")) return;
          const g = liste[+b.dataset.ftour];
          if (!g || g.ohne_tour) return;
          const r2 = await rzWarten("fotos_einer_tour", () => api().fotos_einer_tour(g.geo_hash || "", g.path || "")).catch(() => null);
          if (!r2 || !r2.ok) return;
          filter = Object.assign({}, filter, { von_utc: r2.von - 1800, bis_utc: r2.bis + 1800 });
          ansicht = "raster";
          neuLaden();
          toast(T("fotos.tour_gefiltert", "Zeigt die Dateien im Zeitfenster von „{n}“").replace("{n}", anzeigeName(g)), "info");
        };
        b.onclick = los;
        b.onkeydown = (ev) => { if (ev.key === "Enter") los(ev); };
      });
      listeEl.querySelectorAll("[data-fanim]").forEach(k => {
        k.onclick = async (ev) => {
          ev.stopPropagation();
          const g = liste[+k.dataset.fanim]; if (!g || !g.path) return;
          try {
            const ok = await window.loadGlobalGpx(g.path, { stumm: true });
            if (ok !== false && typeof switchMod === "function") switchMod("animator");
          } catch (e) { applog("warn", "[fotos] Tour öffnen: " + e); }
        };
      });
    };
    binden();
    const q = box.querySelector("#foto-touren-q");
    if (q) q.oninput = () => { _tourenSuche = q.value; listeEl.innerHTML = listeHtml(q.value); binden(); };
  }

  // ── Karte ───────────────────────────────────────────────────────────────

  function karteZeichnen(box) {
    box.innerHTML = `
      <div class="foto-kartewrap">
        <div class="foto-karte" id="foto-karte"></div>
        <div class="lib-map-hint" id="foto-karte-hint"></div>
        ${typeof rzArchivStilWahlHtml === "function" ? `<div class="foto-karte-stil">${rzArchivStilWahlHtml("foto-karte-stil")}</div>` : ""}
        <label class="foto-karte-spuren">
          <input type="checkbox" id="foto-spuren"${spurenAn ? " checked" : ""}>
          <span>${T("fotos.karte_spuren", "Touren als Linien zeigen")}</span>
        </label>
      </div>`;
    const sp = box.querySelector("#foto-spuren");
    if (sp) sp.onchange = () => { spurenAn = sp.checked; spurenLaden(); };
    if (typeof rzArchivStilWahlBinden === "function") rzArchivStilWahlBinden(box, "foto-karte-stil");
    karteAufbauen();
  }

  function karteAufbauen() {
    if (karte) {
      // 25.09.2026 (Klicktest FO-07: Karte nach „Nach Touren" → „Raster" → „Karte" leer, nur der
      // Zähler stand da) — `zeichnen()` baut den Kasten jedes Mal neu, die alte Karte hing aber
      // noch in ihrem alten, längst ausgehängten Kasten und malte ins Leere. Jetzt wandert ihr
      // Kasten an die Stelle des neuen: Karte, Ausschnitt und geladene Kacheln bleiben erhalten.
      const neu = document.getElementById("foto-karte");
      let alt = null;
      try { alt = karte.getContainer(); } catch (_) {}
      if (neu && alt && alt !== neu) {
        try { neu.replaceWith(alt); }
        catch (_) { karteWeg(); }
      }
    }
    if (karte) {
      try { karte.resize(); } catch (_) {}
      // Nach dem Umhängen steht das Layout erst im nächsten Bild fest.
      requestAnimationFrame(() => { try { if (karte) karte.resize(); } catch (_) {} });
      punkteLaden();
      return;
    }
    if (typeof createMap !== "function") return;
    const created = createMap({
      container: "foto-karte",
      styleKey: (typeof rzArchivStil === "function") ? rzArchivStil() : undefined,
      common: { center: [10, 51], zoom: 3, attributionControl: true },
    });
    karte = created.map; karteLib = created.lib;
    window.__fotoMap = karte;
    try { karte.addControl(new karteLib.NavigationControl({ showCompass: false }), "top-right"); } catch (_) {}
    if (typeof rzMassstab === "function") rzMassstab(karte);
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

  /** Die große Karte ganz abbauen (25.09.2026 — Rückfallweg, wenn das Umhängen scheitert). */
  // 09.10.2026 — anderer Kartenstil: Karten neu aufbauen (eigene Ebenen gingen bei setStyle verloren)
  window.addEventListener("rz-archiv-stil", () => {
    if (!angemeldet) return;
    if (karte && ansicht === "karte") { karteWeg(); const box = haupt && haupt.querySelector("#foto-body"); if (box) karteZeichnen(box); }
    else karteWeg();
    if (auswahl && !gross) { const f = geladen.find(x => x.path === auswahl); if (f) detailZeigen(f); }
  });
  function karteWeg() {
    if (karte) { try { karte.remove(); } catch (_) {} }
    karte = null; karteLib = null; karteBereit = false;
  }

  const leer = () => ({ type: "FeatureCollection", features: [] });

  async function punkteLaden() {
    const r = await rzWarten("fotos_punkte", () => api().fotos_punkte(filter, 3)).catch(() => null);
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
  window.__rzFotoStelle = (lon, lat, n) => wolkeGeklickt([lon, lat], n);   // Prüfstand
  async function wolkeGeklickt(coords, n) {
    const [lon, lat] = coords;
    const box = document.getElementById("lib-detail");
    if (!box) return;
    const r = await rzWarten("fotos_abfrage", () => api().fotos_abfrage({
      filter: Object.assign({}, filter, { gps: "mit" }), limit: 500, mit_thumbs: false,
    })).catch(() => null);
    const nahe = ((r && r.fotos) || []).filter(f =>
      Math.abs((f.lat || 0) - lat) < 0.002 && Math.abs((f.lon || 0) - lon) < 0.002);
    box.hidden = false;
    detailKarteWeg();   // 25.09.2026 — die kleine Karte eines zuvor gezeigten Fotos nicht verwaist zurücklassen
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
      const tr = await rzWarten("fotos_touren", () => api().fotos_touren({
        von_utc: Math.min.apply(null, zeiten) - 60, bis_utc: Math.max.apply(null, zeiten) + 60,
      })).catch(() => null);
      const echte = ((tr && tr.touren) || []).filter(g => !g.ohne_tour);
      tourText = echte.length
        ? T("fotos.stelle_touren", "Hier war: {t}").replace("{t}", echte.map(g => g.name).join(", "))
        : T("fotos.stelle_keine_tour", "Zu dieser Zeit ist keine Tour aufgezeichnet.");
    }
    // 09.10.2026 — gleich das erste Foto groß, darüber die
    // Bildleiste dieser Stelle; „Hier war: …“ als Zeile darunter
    nahe.sort((a, b) => (a.aufnahme_utc || 0) - (b.aufnahme_utc || 0));
    detailZeigen(nahe[0], { streifen: nahe, kopf: `${num(n)} ${T("fotos.stueck", "Dateien")}${tourText ? " · " + tourText : ""}` });
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
                T("fotos.b_zeit_hilfe2", "Ohne Zeit lässt sich weder Tour noch Ort zuordnen. Unten unter „Aufnahmedaten bearbeiten“ nachtragen.")];
      case "zeitzone_geraten":
        return [T("fotos.b_tz", "Zeitzone geraten (UTC angenommen)"),
                b.loesbar
                  ? T("fotos.b_tz_hilfe_tour", "Der Geotagger rechnet sie aus dem Track „{t}“ aus.").replace("{t}", tour)
                  : T("fotos.b_tz_hilfe2", "Unten unter „Aufnahmedaten bearbeiten“ die Zeitzone eintragen (z. B. +02:00) — oder mit einem Track zu dieser Zeit berechnen lassen.")];
      case "keine_koordinate":
        return [T("fotos.b_ort", "Keine Koordinate im Bild"),
                b.loesbar
                  ? T("fotos.b_ort_hilfe_tour", "Zu dieser Zeit läuft der Track „{t}“ — der Geotagger kann das Bild damit verorten.").replace("{t}", tour)
                  : T("fotos.b_ort_hilfe2", "Kein aufgezeichneter Track deckt diese Zeit ab — einfach in die Karte unten klicken, um den Ort zu setzen.")];
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
    // 04.10.2026 (Marc: „Striche kreuz und quer durch den Rundweg … von den einzelnen Etappen") — eine zusammengeführte
    // Tour kommt als Etappen-Stücke (`tour.teile`, aus der Datei): je Etappe eine eigene Linie, keine Verbindungsstriche.
    const teile = (tour && Array.isArray(tour.teile) && tour.teile.length) ? tour.teile : (linie ? [linie] : null);
    // 04.10.2026 — die Karte steht immer da: ohne Ort zum Verorten per Klick (Marc: „einzelne Bilder einfach
    // verorten können … ohne die ganze Linie hin- und herspringen")
    el.hidden = false;
    const hinweis = document.getElementById("foto-d-ort-hinweis");
    if (hinweis) hinweis.textContent = d.datei_da === false ? ""
      : (hatOrt ? T("fotos.ort_ziehen", "Punkt ziehen, um den Ort zu ändern.") : T("fotos.ort_klicken", "In die Karte klicken, um den Ort zu setzen."));
    let lib = null;
    try {
      const created = createMap({
        container: "foto-d-karte",
        styleKey: (typeof rzArchivStil === "function") ? rzArchivStil() : undefined,
        common: { center: hatOrt ? [+d.lon, +d.lat] : (linie ? linie[0] : (ortVorschlag() || [10.4, 51.2])), zoom: hatOrt ? 12 : (linie ? 8 : (ortVorschlag() ? 11 : 4.5)),
                  attributionControl: true, interactive: true },   // 15.09.2026: Quellenleiste auf allen Karten
      });
      dKarte = created.map; lib = created.lib;
      window.__fotoDKarte = dKarte;          // Prüfstand
      if (typeof rzMassstab === "function") rzMassstab(dKarte);
    } catch (_) { return; }
    const m = dKarte;
    m.on("load", () => {
      if (linie) {
        m.addSource("d-spur", { type: "geojson",
          data: { type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: teile } } });
        // 09.10.2026 — Türkis mit dunkler Kontur wie auf der Tour-Seite (bleibt über Wald, Fels und Schnee lesbar)
        m.addLayer({ id: "d-spur-rand", type: "line", source: "d-spur",
                     layout: { "line-cap": "round", "line-join": "round" },
                     paint: { "line-color": "#0f1a20", "line-width": 6, "line-opacity": 0.55 } });
        m.addLayer({ id: "d-spur-linie", type: "line", source: "d-spur",
                     layout: { "line-cap": "round", "line-join": "round" },
                     paint: { "line-color": "#48d6c4", "line-width": 3 } });
        if (typeof rzStartZiel === "function") rzStartZiel(m, lib, teile);
      }
      // Ziehbarer Punkt (statt Kreis-Ebene); ohne Ort setzt ein Klick ihn
      const setzen = (lngLat) => {
        if (!ortMarker) {
          const elM = document.createElement("div"); elM.className = "foto-d-pin";
          ortMarker = new lib.Marker({ element: elM, draggable: d.datei_da !== false }).setLngLat(lngLat).addTo(m);
          ortMarker.on("dragend", () => ortGeaendert(d, ortMarker.getLngLat()));
        } else ortMarker.setLngLat(lngLat);
      };
      if (hatOrt) setzen([+d.lon, +d.lat]);
      if (d.datei_da !== false) m.on("click", (e) => { setzen(e.lngLat); ortGeaendert(d, e.lngLat); });
      // Ausschnitt: das Bild UND seine Tour, damit man beides im Zusammenhang sieht.
      try {
        const b = new lib.LngLatBounds();
        if (teile) teile.forEach((t) => t.forEach((c) => b.extend(c)));
        if (hatOrt) b.extend([+d.lon, +d.lat]);
        if (hatOrt || linie) m.fitBounds(b, { padding: (typeof RZ_ARCHIV_RAND === "object") ? RZ_ARCHIV_RAND : 28, maxZoom: hatOrt && !linie ? 13 : 12, duration: 0 });
      } catch (_) {}
    });
  }

  function detailKarteWeg() {
    ortMarker = null;
    if (!dKarte) return;
    try { dKarte.remove(); } catch (_) {}
    dKarte = null;
  }

  /* ── 04.10.2026: Verorten, Bearbeiten, Großansicht (Marc: „Ein Bild richtig groß angucken oder ein Video abspielen
     kann ich gar nicht" — „einen Frame rausschneiden und als Foto speichern" — „einen kompletten EXIF-Editor … einzelne
     Bilder einfach verorten … direkt im Archiv"). Schreiben über dieselben Wege wie der Geotagger (core/exif, ZIP-
     Sicherung vorher, Dateischutz); danach liest app.py die Datei sofort neu ein (cfotos.neu_lesen). */
  let ortMarker = null;
  /** Ort eines zeitlich benachbarten Fotos als Startpunkt der Karte (ohne eigenen Ort). */
  function ortVorschlag() {
    const i = geladen.findIndex(x => x.path === auswahl);
    for (let k = 1; k < 40 && i >= 0; k++) {
      for (const j of [i - k, i + k]) { const x = geladen[j]; if (x && x.lat != null && x.lon != null) return [+x.lon, +x.lat]; }
    }
    return null;
  }
  async function ortGeaendert(d, ll) {
    const box = document.getElementById("foto-d-ort-neu");
    if (!box) return;
    const lat = +ll.lat, lon = +ll.lng;
    box.hidden = false;
    box.innerHTML = `
      <div class="foto-ort-zeile"><b>${esc(T("fotos.ort_neu", "Neuer Ort"))}</b> ${lat.toFixed(6)}, ${lon.toFixed(6)}</div>
      <div class="foto-ort-felder">
        <label>${esc(T("fotos.ort_hoehe", "Höhe (m)"))} <input type="number" id="foto-ort-hoehe" step="1" value="${d.ele != null ? Math.round(d.ele) : ""}"></label>
        <label>${esc(T("fotos.ort_richtung", "Blickrichtung (°)"))} <input type="number" id="foto-ort-richtung" min="0" max="359" step="1" placeholder="—"></label>
      </div>
      <label class="foto-ort-adresse"><input type="checkbox" id="foto-ort-adr-an" checked> <span id="foto-ort-adr">${esc(T("fotos.ort_adresse_sucht", "Adresse wird gesucht …"))}</span></label>
      <div class="foto-ort-knoepfe">
        <button type="button" class="btn btn-sm btn-primary" id="foto-ort-speichern">${esc(T("fotos.ort_speichern", "Ort ins Foto schreiben"))}</button>
        <button type="button" class="btn btn-sm" id="foto-ort-verwerfen">${esc(T("common.cancel", "Abbrechen"))}</button>
      </div>
      <div class="muted foto-ort-sicher">${esc(T("fotos.schreiben_sicher", "Vor dem Schreiben legt die App eine Sicherung des Originals an."))}</div>`;
    let adresse = null;
    api().fotos_adresse(lat, lon, (typeof i18nMeta === "function" && i18nMeta().active) || "de").then((r) => {
      const el = document.getElementById("foto-ort-adr");
      if (!el) return;
      if (r && r.ok && r.adresse) {
        adresse = r.adresse;
        el.textContent = T("fotos.ort_adresse_mit", "Adresse mitschreiben: {a}").replace("{a}", [adresse.street, adresse.city, adresse.country].filter(Boolean).join(", "));
      } else { el.textContent = T("fotos.ort_adresse_keine", "Keine Adresse gefunden — nur die Koordinate wird geschrieben."); const c = document.getElementById("foto-ort-adr-an"); if (c) { c.checked = false; c.disabled = true; } }
    }).catch(() => {});
    box.querySelector("#foto-ort-verwerfen").onclick = () => { box.hidden = true; detailZeigen(d); };
    box.querySelector("#foto-ort-speichern").onclick = async () => {
      const h = box.querySelector("#foto-ort-hoehe").value, rr = box.querySelector("#foto-ort-richtung").value;
      const mitAdr = box.querySelector("#foto-ort-adr-an").checked && adresse;
      const r = await rzWarten("fotos_verorten", () => api().fotos_verorten(d.path, lat, lon, h === "" ? null : +h, rr === "" ? null : +rr, mitAdr ? adresse : null))
        .catch((e) => ({ ok: false, error: String(e) }));
      if (r && r.ok) { toast(T("fotos.ort_gespeichert", "Ort gespeichert."), "success", 3000); nachBearbeiten(d, r.details); }
      else toast((r && r.error) || "?", "error", 6000);
    };
  }
  /** Nach dem Schreiben: Kachel/Raster und Detailspalte mit den frisch gelesenen Werten. */
  function nachBearbeiten(d, details) {
    const neu = details && details.ok && details.foto;
    const i = geladen.findIndex(x => x.path === d.path);
    if (neu && i >= 0) geladen[i] = Object.assign({}, geladen[i], neu);
    detailZeigen(neu || d);
    dbTage = null;   // Datumsbaum neu holen (Zeit kann sich geändert haben)
  }

  // EXIF-Editor: dieselben Felder wie „Ausfüllen" im Geotagger, dazu Aufnahmezeit/Zeitzone, darunter alle übrigen
  const EDIT_FELDER = [
    ["DateTimeOriginal", "fotos.ef_zeit", "Aufnahmezeit (JJJJ:MM:TT hh:mm:ss)"], ["OffsetTimeOriginal", "fotos.ef_tz", "Zeitzone (z. B. +02:00)"],
    ["Title", "fotos.ef_titel", "Titel"], ["ImageDescription", "fotos.ef_beschreibung", "Beschreibung"],
    ["Keywords", "fotos.ef_stichworte", "Stichwörter (Komma-getrennt)"], ["Rating", "fotos.ef_bewertung", "Bewertung (0–5)"],
    ["Headline", "fotos.ef_ueberschrift", "Überschrift"], ["UserComment", "fotos.ef_kommentar", "Kommentar"],
    ["Artist", "fotos.ef_urheber", "Urheber"], ["Copyright", "fotos.ef_copyright", "Copyright"],
    ["Credit", "fotos.ef_credit", "Bildnachweis"], ["Source", "fotos.ef_quelle", "Quelle"], ["Instructions", "fotos.ef_hinweise", "Hinweise"],
    ["Sublocation", "fotos.ef_ortsteil", "Ortsteil / Ort im Bild"], ["City", "fotos.ef_stadt", "Stadt"],
    ["State", "fotos.ef_region", "Bundesland / Region"], ["Country", "fotos.ef_land", "Land"],
    ["Make", "fotos.ef_hersteller", "Kamera-Hersteller"], ["Model", "fotos.ef_modell", "Kamera-Modell"],
  ];
  function exifWert(alle, tag) {
    if (!alle) return "";
    if (tag in alle) return alle[tag];
    const k = Object.keys(alle).find(x => x.split(":").pop() === tag);
    return k ? alle[k] : "";
  }
  async function editorLaden(d) {
    const body = document.getElementById("foto-edit-body");
    if (!body) return;
    if (d.datei_da === false) { body.innerHTML = `<div class="muted">${esc(T("fotos.edit_fern", "Das Original ist gerade nicht erreichbar — bearbeiten geht, sobald das Laufwerk verbunden ist."))}</div>`; return; }
    const r = await api().fotos_exif_lesen(d.path).catch(() => null);
    if (!r || r.ok === false) { body.innerHTML = `<div class="muted">${esc((r && r.error) || "?")}</div>`; return; }
    const alle = r.all || {};
    const nurLesen = new Set(r.readonly || []);
    const feld = (tag, label, wert) => `<label class="foto-ef"><span class="muted">${esc(label)}</span>
        <input type="text" data-ef="${esc(tag)}" data-alt="${esc(wert == null ? "" : String(wert))}" value="${esc(wert == null ? "" : String(wert))}"></label>`;
    const hauptFelder = EDIT_FELDER.map(([tag, key, def]) => feld(tag, T(key, def), exifWert(alle, tag))).join("");
    const bekannte = new Set(EDIT_FELDER.map(x => x[0]));
    const rest = Object.keys(alle).filter(k => !nurLesen.has(k) && !bekannte.has(k.split(":").pop())).sort();
    body.innerHTML = `${hauptFelder}
      <details class="foto-ef-mehr"><summary>${esc(T("fotos.edit_alle", "Alle weiteren Felder"))} (${rest.length})</summary>
        <input type="search" class="foto-ef-suche" id="foto-ef-suche" placeholder="${esc(T("fotos.edit_suche", "Feld suchen …"))}">
        <div id="foto-ef-rest">${rest.map(k => feld(k, k, alle[k])).join("")}</div>
      </details>
      <div class="foto-ort-knoepfe">
        <button type="button" class="btn btn-sm btn-primary" id="foto-ef-speichern" disabled>${esc(T("fotos.edit_speichern", "Änderungen ins Foto schreiben"))}</button>
        <span class="muted" id="foto-ef-zahl"></span>
      </div>
      <div class="muted foto-ort-sicher">${esc(T("fotos.schreiben_sicher", "Vor dem Schreiben legt die App eine Sicherung des Originals an."))}</div>`;
    const geaendert = () => [...body.querySelectorAll("[data-ef]")].filter(i => i.value !== i.dataset.alt);
    const knopf = body.querySelector("#foto-ef-speichern"), zahl = body.querySelector("#foto-ef-zahl");
    body.addEventListener("input", (e) => {
      if (e.target.id === "foto-ef-suche") {
        const q = e.target.value.trim().toLowerCase();
        body.querySelectorAll("#foto-ef-rest .foto-ef").forEach(l => { l.hidden = q && !l.textContent.toLowerCase().includes(q) && !(l.querySelector("input").value || "").toLowerCase().includes(q); });
        return;
      }
      const n = geaendert().length; knopf.disabled = !n;
      zahl.textContent = n ? T("fotos.edit_n", "{n} geändert").replace("{n}", n) : "";
    });
    knopf.onclick = async () => {
      const felder = {}; geaendert().forEach(i => { felder[i.dataset.ef] = i.value; });
      knopf.disabled = true;
      const w = await rzWarten("fotos_exif_schreiben", () => api().fotos_exif_schreiben(d.path, felder)).catch((e) => ({ ok: false, error: String(e) }));
      if (w && w.ok) { toast(T("fotos.edit_gespeichert", "Ins Foto geschrieben."), "success", 3000); nachBearbeiten(d, w.details); }
      else { knopf.disabled = false; toast((w && w.error) || "?", "error", 6000); }
    };
  }

  // Großansicht (Overlay über der App): Foto groß oder Video abspielen, ← → blättern, Esc schließt
  let gross = null;   // { el, idx, liste }
  function grossOeffnen(f, eigeneListe) {
    if (!f) return;
    // 08.10.2026 — die Tour-Seite blättert durch die Medien IHRER Tour (nicht durch das Raster)
    const liste = (eigeneListe && eigeneListe.length) ? eigeneListe.slice() : (geladen.length ? geladen : [f]);
    let idx = liste.findIndex(x => x.path === f.path);
    if (idx < 0) { liste.unshift(f); idx = 0; }
    if (!gross) {
      const el = document.createElement("div");
      el.className = "foto-gross"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true");
      el.innerHTML = `<button type="button" class="foto-gross-zu" title="${esc(T("fotos.gross_zu", "Schließen (Esc)"))}">✕</button>
        <button type="button" class="foto-gross-voll" title="${esc(T("fotos.gross_voll", "Vollbild (F)"))}">⤢</button>
        ${exportKnopfHtml("foto-gross-export")}
        <button type="button" class="foto-gross-pfeil foto-gross-links" title="←">‹</button>
        <button type="button" class="foto-gross-pfeil foto-gross-rechts" title="→">›</button>
        <div class="foto-gross-buehne"></div>
        <div class="foto-gross-hinweis" hidden></div>
        <div class="foto-gross-streifen"></div>
        <aside class="foto-gross-seite"><div class="foto-gross-karte" id="foto-gross-karte"></div>
          <div class="fg-reiter" role="tablist"><button type="button" class="fg-r is-on" data-fg="bearb">${I("sliders-horizontal", 14)} ${esc(T("bearb.reiter", "Bearbeiten"))}</button><button type="button" class="fg-r" data-fg="info">${esc(T("bearb.reiter_info", "Info"))}</button></div>
          <div class="foto-gross-info" hidden></div><div class="foto-gross-bearb"></div></aside>
        <div class="foto-gross-leiste"><span class="foto-gross-name"></span><span class="foto-gross-knoepfe"></span></div>`;
      document.body.appendChild(el);
      el.classList.add("mit-seite");
      // 08.10.2026 („Lupe wie Lightroom“) — liegt im Layout: links bleiben Seitenleiste und Reiter
      // sichtbar; ⤢ oder F = nur das Foto, bildschirmfüllend
      el.classList.add("im-layout");
      el.querySelector(".foto-gross-voll").onclick = () => grossVollbild();
      window.addEventListener("resize", grossLage);
      el.querySelector(".foto-gross-zu").onclick = grossZu;
      el.querySelector("#foto-gross-export").onclick = (e) => { e.stopPropagation(); if (gross) exportMenue(e.currentTarget, gross.liste[gross.idx]); };
      el.querySelector(".foto-gross-links").onclick = () => grossBlaettern(-1);
      el.querySelector(".foto-gross-rechts").onclick = () => grossBlaettern(1);
      el.addEventListener("click", (e) => { if ((e.target === el || e.target.classList.contains("foto-gross-buehne")) && !(bearbZ && bearbZ.zuschneiden)) grossZu(); });
      document.addEventListener("keydown", grossTasten, true);
      document.addEventListener("keyup", grossTastenHoch, true);
      el.querySelectorAll("[data-fg]").forEach(b => { b.onclick = () => grossReiter(b.dataset.fg); });
      // 09.10.2026 (Marc: „öffne Bearbeiten direkt, nicht Info“) — Karte oben, darunter gleich die Regler
      gross = { el, liste, idx, reiter: "bearb" };
      grossLage();
    } else { gross.liste = liste; gross.idx = idx; }
    grossZeigen();
  }
  /** Lupe im Layout: rechts neben der linken Seitenleiste, unter den Reitern. */
  function grossLage() {
    const g = gross; if (!g) return;
    const el = g.el;
    if (!el.classList.contains("im-layout")) { el.style.left = el.style.top = ""; return; }
    // die Seitenleiste der Medien — oder (Tour-Seite) die linke Spalte der Tour
    let links = [document.querySelector(".ts-links"), nav].find(x => x && x.offsetParent && x.getBoundingClientRect().width > 40);
    // die ganze Spalte im Modul-Raster (die Seitenleiste hat innen Rand) — nicht nur ihr Inhalt
    while (links && links.parentElement && !links.parentElement.classList.contains("module-body")) links = links.parentElement;
    const oben = document.querySelector(".lib-main") || haupt;
    const r = links ? links.getBoundingClientRect() : null, o = oben ? oben.getBoundingClientRect() : null;
    el.style.left = Math.max(0, r ? r.right : 0) + "px";
    el.style.top = Math.max(0, o ? o.top : 0) + "px";
    requestAnimationFrame(zuschnittRahmen);
  }
  function grossVollbild(an) {
    const g = gross; if (!g) return;
    const voll = an === undefined ? g.el.classList.contains("im-layout") : !!an;
    g.el.classList.toggle("im-layout", !voll);
    grossLage();
    try { if (g.karte) g.karte.resize(); } catch (_) {}
  }
  function grossZu() {
    if (!gross) return;
    const v = gross.el.querySelector("video"); if (v) { try { v.pause(); v.removeAttribute("src"); v.load(); } catch (_) {} }
    try { if (gross.karte) gross.karte.remove(); } catch (_) {}
    bearbSpeichernJetzt();
    gross.el.remove(); document.removeEventListener("keydown", grossTasten, true); document.removeEventListener("keyup", grossTastenHoch, true);
    window.removeEventListener("resize", grossLage); gross = null;
  }

  /* 08.10.2026 — die Großansicht
     zeigt unten den Filmstreifen (die Liste, durch die man blättert: Raster-Filter, Tag, Tour) und rechts die Karte mit
     dem Track der Tour und dem Punkt des Fotos, darunter Aufnahmedaten und Touren. Später kommen dort die Regler zum
     Aufhübschen dazu. */
  function grossStreifen() {
    const g = gross; if (!g) return;
    const box = g.el.querySelector(".foto-gross-streifen"); if (!box) return;
    const von = Math.max(0, g.idx - 25), bis = Math.min(g.liste.length, g.idx + 26);
    if (g.streifenVon !== von || g.streifenBis !== bis || g.streifenListe !== g.liste) {
      g.streifenVon = von; g.streifenBis = bis; g.streifenListe = g.liste;
      box.innerHTML = g.liste.slice(von, bis).map((x, k) => `<button type="button" class="foto-gross-sbild${x.art === "video" ? " ist-video" : ""}" data-j="${von + k}"
          style="${x.thumb_url ? `background-image:url('${x.thumb_url}')` : ""}" title="${esc(x.dateiname || "")}"></button>`).join("");
      box.querySelectorAll("[data-j]").forEach(b => { b.onclick = () => { const j = +b.dataset.j; if (!gross) return; gross.idx = j; grossZeigen(); const f = gross.liste[j]; if (f) detailZeigen(f); }; });
      const ohne = g.liste.slice(von, bis).filter(x => !x.thumb_url).map(x => x.path);
      if (ohne.length) api().fotos_thumbs(ohne.slice(0, 60), false).then(r => {   // warte-ok: Kacheln zeigen bis dahin ihre Fläche
        if (!r || !r.ok || gross !== g) return;
        for (const [p, u] of Object.entries(r.thumbs || {})) {
          if (!u) continue;
          const x = g.liste.find(y => y.path === p); if (x) x.thumb_url = x.thumb_url || u;
          const el = [...box.querySelectorAll("[data-j]")].find(b => g.liste[+b.dataset.j] && g.liste[+b.dataset.j].path === p);
          if (el) el.style.backgroundImage = `url('${u}')`;
        }
      }).catch(() => {});
    }
    box.querySelectorAll(".is-on").forEach(b => b.classList.remove("is-on"));
    const an = box.querySelector(`[data-j="${g.idx}"]`);
    if (an) { an.classList.add("is-on"); try { an.scrollIntoView({ block: "nearest", inline: "center" }); } catch (_) {} }
  }
  /* 09.10.2026 — Bearbeiten in der Lupe: Histogramm,
     Auto, Voreinstellungen, Regler; „.“ halten = Vorher. Gespeichert wird ein Rezept in der Bibliothek, das Original
     bleibt. Vorschau rechnet die App (≤ 1600 px, ~0,1 s); beim Ziehen gedrosselt. */
  const BEARB_REGLER = [
    ["belichtung", "bearb.r_belichtung", "Belichtung", 0.05], ["kontrast", "bearb.r_kontrast", "Kontrast", 1],
    ["lichter", "bearb.r_lichter", "Lichter", 1], ["tiefen", "bearb.r_tiefen", "Tiefen", 1],
    ["temperatur", "bearb.r_temperatur", "Temperatur", 1], ["toenung", "bearb.r_toenung", "Tönung", 1],
    ["dynamik", "bearb.r_dynamik", "Dynamik", 1], ["saettigung", "bearb.r_saettigung", "Sättigung", 1],
    ["klarheit", "bearb.r_klarheit", "Klarheit", 1], ["dunst", "bearb.r_dunst", "Dunst entfernen", 1],
  ];
  const BEARB_STILE = [["natuerlich", "bearb.s_natuerlich", "Natürlich"], ["kraeftig", "bearb.s_kraeftig", "Kräftig"],
                       ["matt", "bearb.s_matt", "Matt"], ["sw", "bearb.s_sw", "SW"]];
  let bearbAblage = null;      // „Einstellungen kopieren“
  let bearbZ = null;           // { pfad, rezept, auto, lauf, tmrV, tmrS, zuschneiden, seite }
  // 09.10.2026 — Live-Vorschau in der Grafikkarte (ui/js/entwickeln_gl.js); ein Canvas für die ganze Sitzung, ohne WebGL 2
  // (oder nach einem Fehler) entwickelt wie bisher Python
  let bearbGL = null, bearbGLAus = false;
  const BEARB_SEITEN = [["orig", "bearb.seite_orig", "Original"], ["frei", "bearb.seite_frei", "Frei"], ["1:1"], ["4:5"], ["3:2"], ["2:3"], ["16:9"], ["9:16"]];
  function grossReiter(w) {
    const g = gross; if (!g) return;
    g.reiter = w;
    if (grossReiterZeigen() === "bearb") bearbLaden(g.liste[g.idx]).catch(() => {});
  }
  /** Zeigt den gewählten Reiter; ein Video lässt sich nicht bearbeiten, dort steht Info (die Wahl bleibt gemerkt). */
  function grossReiterZeigen() {
    const g = gross; if (!g) return "";
    const f = g.liste[g.idx];
    const w = (f && f.art === "video") ? "info" : g.reiter;
    g.el.querySelectorAll("[data-fg]").forEach(b => b.classList.toggle("is-on", b.dataset.fg === w));
    g.el.querySelector(".foto-gross-info").hidden = w !== "info";
    g.el.querySelector(".foto-gross-bearb").hidden = w !== "bearb";
    return w;
  }
  async function bearbLaden(f) {
    const g = gross; if (!g || !f) return;
    const box = g.el.querySelector(".foto-gross-bearb");
    if (f.art === "video") { box.innerHTML = `<div class="muted">${esc(T("bearb.video", "Videos lassen sich hier nicht bearbeiten."))}</div>`; return; }
    if (!bearbZ || bearbZ.pfad !== f.path) {
      bearbSpeichernJetzt();
      box.innerHTML = `<div class="muted"><span class="ass-spinner"></span> ${esc(T("bearb.laedt", "Bild wird vorbereitet …"))}</div>`;
      const r = await api().foto_bearbeiten_laden(f.path).catch(() => null);   // warte-ok: Feld zeigt „Bild wird vorbereitet …“
      if (gross !== g || g.liste[g.idx] !== f) return;
      if (!r || !r.ok) { box.innerHTML = `<div class="muted">${esc((r && r.error) || "?")}</div>`; return; }
      bearbZ = { pfad: f.path, f, rezept: r.rezept || {}, auto: r.auto || {}, aus_vorschau: r.aus_vorschau, lauf: 0, tmrV: 0, tmrS: 0, offen: false, hist: r.hist || null,
                 quelleUrl: r.quelle_url || null, voreinst: r.voreinstellungen || {}, W: r.breite || 0, H: r.hoehe || 0, seite: "orig" };
      if (r.quelle_url) {
        const z = bearbZ, bild = new Image();
        z.quelleBild = bild;
        z.quelleBereit = new Promise(ok => { bild.onload = bild.onerror = () => ok(); });
        bild.src = r.quelle_url;
        // gleich vorbereiten (Shader übersetzen, Quelle hochladen) — sonst wartet der erste Regelzug darauf
        z.quelleBereit.then(() => { if (bearbZ === z) bearbGLVorbereiten(z); });
      }
    }
    bearbZeichnen();
    if (!ist_leer(bearbZ.rezept)) bearbVorschau();
    else if (bearbZ.hist) bearbHist(bearbZ.hist);
  }
  const ist_leer = (rz) => !rz || !(rz.auto || rz.stil || BEARB_REGLER.some(([k]) => +rz[k]) || +rz.drehen90 || +rz.gerade || rz.zuschnitt);
  const BEARB_GEO = ["drehen90", "gerade", "zuschnitt"];
  const nurTon = (rz) => { const o = JSON.parse(JSON.stringify(rz || {})); BEARB_GEO.forEach(k => delete o[k]); return o; };
  const nurGeo = (rz) => { const o = {}; BEARB_GEO.forEach(k => { if (rz && rz[k] != null) o[k] = JSON.parse(JSON.stringify(rz[k])); }); return o; };
  /** Ein Regler hat sich geändert: Vorschau neu (Grafikkarte sofort im nächsten Bild, Python nach 70 ms), speichern nach 600 ms. */
  function bearbGeaendert(sofortSpeichern) {
    const z = bearbZ; if (!z) return;
    bearbZeichnenWerte();
    bearbPlanen();
    clearTimeout(z.tmrS); z.tmrS = setTimeout(bearbSpeichernJetzt, sofortSpeichern ? 0 : 600);
    z.offen = true;
  }
  function bearbPlanen() {
    const z = bearbZ; if (!z) return;
    if (z.gl) { if (!z.raf) z.raf = requestAnimationFrame(() => { z.raf = 0; bearbVorschau(); }); }
    else { clearTimeout(z.tmrV); z.tmrV = setTimeout(bearbVorschau, 70); }
  }
  function bearbZeichnen() {
    const g = gross, z = bearbZ; if (!g || !z) return;
    const box = g.el.querySelector(".foto-gross-bearb");
    const rz = z.rezept;
    if (z.zuschneiden) { zuschnittPanel(box); return; }
    box.innerHTML = `
      <canvas class="fb-hist" id="fb-hist" width="300" height="70"></canvas>
      ${z.aus_vorschau ? `<div class="muted fb-hinweis">${esc(T("bearb.aus_vorschau", "RAW: Diese Datei kann LibRaw nicht lesen — bearbeitet wird ein großes Vorschaubild."))}</div>` : ""}
      <div class="fb-zeile">
        <button type="button" class="btn btn-sm${(rz.zuschnitt || rz.gerade || rz.drehen90) ? " is-on" : ""}" id="fb-zs" title="${esc(T("bearb.zuschneiden_tip", "Zuschneiden und Geraderichten (R)"))}">${I("crop", 14)} ${esc(T("bearb.zuschneiden", "Zuschneiden"))}</button>
      </div>
      <div class="fb-zeile">
        <button type="button" class="btn btn-sm${rz.auto ? " is-on" : ""}" id="fb-auto" title="${esc(T("bearb.auto_tip", "Ton und Weißabgleich automatisch — die Regler kommen obendrauf"))}">${I("sparkles", 14)} ${esc(T("bearb.auto", "Auto"))}</button>
        <span class="fml-luft"></span>
        <button type="button" class="btn btn-sm btn-ghost" id="fb-vorher" title="${esc(T("bearb.vorher_tip", "Gedrückt halten (oder Taste „.“): Original zeigen"))}">${I("columns-2", 14)} ${esc(T("bearb.vorher", "Vorher"))}</button>
        <button type="button" class="btn btn-sm btn-ghost" id="fb-reset" title="${esc(T("bearb.reset", "Zurücksetzen"))}">${I("rotate-ccw", 14)}</button>
      </div>
      <div class="fb-stile">${BEARB_STILE.map(([k, ik, fb]) => `<button type="button" class="fb-stil${rz.stil === k ? " is-on" : ""}" data-stil="${k}">${esc(T(ik, fb))}</button>`).join("")}</div>
      <div class="fb-regler">${BEARB_REGLER.map(([k, ik, fb, schritt]) => {
        const [lo, hi] = k === "belichtung" ? [-3, 3] : [-100, 100];
        const v = +(rz[k] || 0);
        return `<label class="fb-r"><span class="fb-r-name">${esc(T(ik, fb))}</span><span class="fb-r-wert" id="fbw-${k}">${k === "belichtung" ? (v > 0 ? "+" : "") + v.toFixed(2) : (v > 0 ? "+" : "") + Math.round(v)}</span>
          <input type="range" min="${lo}" max="${hi}" step="${schritt}" value="${v}" data-r="${k}"></label>`;
      }).join("")}</div>
      <div class="fb-zeile fb-unten">
        <button type="button" class="btn btn-sm" id="fb-kopieren" title="${esc(T("bearb.kopieren_tip", "Diese Einstellungen merken, um sie auf andere Fotos zu übertragen"))}">${I("copy", 14)} ${esc(T("bearb.kopieren", "Kopieren"))}</button>
        <button type="button" class="btn btn-sm" id="fb-einfuegen"${bearbAblage ? "" : " disabled"}>${esc(T("bearb.einfuegen", "Einfügen"))}</button>
        <span class="fml-luft"></span>
        <button type="button" class="btn btn-sm" id="fb-datei">${I("save", 14)} ${esc(T("bearb.datei", "Als neue Datei …"))}</button>
      </div>
      <div class="muted fb-hinweis">${esc(T("bearb.hinweis", "Das Original bleibt unverändert. Export und Videos nehmen die bearbeitete Fassung."))}</div>`;
    const geaendert = bearbGeaendert;
    box.querySelector("#fb-zs").onclick = () => zuschnittAn(true);
    box.querySelectorAll("[data-r]").forEach(inp => {
      inp.oninput = () => { const v = +inp.value; if (v) rz[inp.dataset.r] = v; else delete rz[inp.dataset.r]; geaendert(false); };
      inp.ondblclick = () => { delete rz[inp.dataset.r]; inp.value = 0; geaendert(false); };   // wie Lightroom: Doppelklick = 0
    });
    box.querySelector("#fb-auto").onclick = () => { if (rz.auto) delete rz.auto; else rz.auto = true; bearbZeichnen(); geaendert(true); };
    box.querySelectorAll("[data-stil]").forEach(b => { b.onclick = () => { if (rz.stil === b.dataset.stil) delete rz.stil; else rz.stil = b.dataset.stil; bearbZeichnen(); geaendert(true); }; });
    box.querySelector("#fb-reset").onclick = () => { z.rezept = nurGeo(z.rezept); bearbZeichnen(); geaendert(true); };   // der Zuschnitt hat sein eigenes Zurücksetzen
    const vk = box.querySelector("#fb-vorher");
    vk.onmousedown = () => bearbVorher(true); vk.onmouseup = vk.onmouseleave = () => bearbVorher(false);
    box.querySelector("#fb-kopieren").onclick = () => { bearbAblage = nurTon(rz); bearbZeichnen(); toast(T("bearb.kopiert", "Einstellungen gemerkt — „Einfügen“ bei anderen Fotos oder in der Leiste für markierte."), "success", 3500); };
    box.querySelector("#fb-einfuegen").onclick = () => { if (!bearbAblage) return; z.rezept = Object.assign(nurTon(bearbAblage), nurGeo(z.rezept)); bearbZeichnen(); geaendert(true); };
    box.querySelector("#fb-datei").onclick = async () => {
      bearbSpeichernJetzt();
      const r = await api().foto_entwickelt_speichern(z.pfad).catch((e) => ({ ok: false, error: String(e) }));   // warte-ok: Systemdialog
      if (r && r.ok) toast(T("bearb.datei_ok", "Gespeichert: {n}").replace("{n}", String(r.pfad).split(/[\\/]/).pop()), "success", 4000);
      else if (r && !r.abbruch) toast(r.error || "?", "error", 6000);
    };
  }
  function bearbZeichnenWerte() {
    const g = gross, z = bearbZ; if (!g || !z) return;
    BEARB_REGLER.forEach(([k]) => {
      const el = g.el.querySelector("#fbw-" + k); if (!el) return;
      const v = +(z.rezept[k] || 0);
      el.textContent = k === "belichtung" ? (v > 0 ? "+" : "") + v.toFixed(2) : (v > 0 ? "+" : "") + Math.round(v);
    });
  }
  async function bearbVorschau() {
    const g = gross, z = bearbZ; if (!g || !z) return;
    const lauf = ++z.lauf;
    if (await bearbGLZeichnen()) return;
    if (gross !== g || bearbZ !== z || lauf !== z.lauf) return;
    const r = await api().foto_entwickeln_vorschau(z.pfad, z.rezept, false, !!z.zuschneiden).catch(() => null);   // warte-ok: das Bild wechselt, sobald fertig (~0,1 s)
    if (gross !== g || bearbZ !== z || lauf !== z.lauf || !r || !r.ok) return;
    z.url = r.url;
    if (g.liste[g.idx] && g.liste[g.idx].path === z.pfad && !z.vorher) {
      const img = g.el.querySelector(".foto-gross-buehne img"); if (img) { img.onload = () => zuschnittRahmen(); img.src = r.url; }
    }
    bearbHist(r.hist);
  }
  /** Grafikkarte bereit machen und die Quelle dieses Fotos hochladen. false = geht nicht (dann Python). */
  function bearbGLVorbereiten(z) {
    if (bearbGLAus || !window.rzEntwickler || !z || !z.quelleBild || !z.quelleBild.naturalWidth) return false;
    try {
      if (!bearbGL) {
        if (!rzEntwickler.EntwicklerGL.geht()) { bearbGLAus = true; return false; }
        const c = document.createElement("canvas"); c.className = "foto-gross-bild fb-gl";
        bearbGL = new rzEntwickler.EntwicklerGL(c);
      }
      if (bearbGL.verloren) { bearbGL = null; bearbGLAus = true; return false; }
      if (bearbGL.pfad !== z.pfad) { bearbGL.quelle(z.quelleBild); bearbGL.pfad = z.pfad; }
      z.gl = true;
      return true;
    } catch (e) {
      console.warn("[bearbeiten] WebGL — weiter mit Python:", e);
      bearbGLAus = true; z.gl = false;
      return false;
    }
  }
  /** Entwickelt in der Grafikkarte ins Canvas der Bühne. false = geht nicht (dann Python). */
  async function bearbGLZeichnen() {
    const g = gross, z = bearbZ;
    if (!g || !z || bearbGLAus || !window.rzEntwickler || !z.quelleBild) return false;
    if (!z.quelleBild.naturalWidth) {
      await z.quelleBereit;
      if (gross !== g || bearbZ !== z) return true;
    }
    if (!bearbGLVorbereiten(z)) return false;
    try {
      const w = z.vorher ? {} : rzEntwickler.wirksam(z.rezept, z.auto, z.voreinst);
      const rahmen = !!z.zuschneiden && !z.vorher;
      bearbGL.zeichnen(w, { rahmen });
      const buehne = g.el.querySelector(".foto-gross-buehne");
      if (buehne && g.liste[g.idx] && g.liste[g.idx].path === z.pfad && bearbGL.canvas.parentNode !== buehne) {
        buehne.querySelectorAll("img.foto-gross-bild").forEach(i => { i.hidden = true; });
        buehne.appendChild(bearbGL.canvas);
      }
      if (!z.vorher) bearbHist(bearbGL.histogramm(w, { rahmen }));
      zuschnittRahmen();
      return true;
    } catch (e) {
      console.warn("[bearbeiten] WebGL — weiter mit Python:", e);
      bearbGLAus = true; z.gl = false;
      return false;
    }
  }
  function bearbHist(h) {
    const c = gross && gross.el.querySelector("#fb-hist"); if (!c || !h) return;
    const ctx = c.getContext("2d"), W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);
    const max = Math.max(1, ...["r", "g", "b"].flatMap(k => h[k].slice(1, -1)));
    [["r", "rgba(255,110,90,.55)"], ["g", "rgba(80,220,170,.55)"], ["b", "rgba(80,140,255,.55)"]].forEach(([k, farbe]) => {
      ctx.fillStyle = farbe; ctx.beginPath(); ctx.moveTo(0, H);
      h[k].forEach((v, i) => ctx.lineTo(i / (h[k].length - 1) * W, H - Math.min(1, v / max) * H));
      ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
    });
  }
  function bearbVorher(an) {
    const g = gross, z = bearbZ; if (!g) return;
    if (z) z.vorher = !!an;
    if (z && z.gl && bearbGL && bearbGL.canvas.isConnected) bearbGLZeichnen();
    else {
      const img = g.el.querySelector(".foto-gross-buehne img"); if (!img) return;
      const orig = (z && z.quelleUrl) || g.originalUrl;
      if (an && orig) img.src = orig;
      else if (!an && z && z.url && g.liste[g.idx] && g.liste[g.idx].path === z.pfad) img.src = z.url;
    }
    zuschnittRahmen();
    const b = g.el.querySelector(".foto-gross-buehne"); if (b) b.dataset.vorher = T("bearb.vorher", "Vorher");
    g.el.classList.toggle("zeigt-vorher", !!an);
  }
  /* ── Zuschneiden und Geraderichten (09.10.2026) ──────────────────────────────────────────
     Die Bühne zeigt den ganzen gedrehten Rahmen, darüber das Zuschnitt-Rechteck (normiert im Rahmen nach den 90°-Drehungen).
     Rechnungen wie core/entwickeln.py (passend, einpassen) — über rzEntwickler. */
  function zsRahmen(z) { return rzEntwickler.rahmenMasse(z.W || 3, z.H || 2, z.rezept.drehen90 || 0); }
  function zsSeite(z) {
    const [Wr, Hr] = zsRahmen(z);
    if (z.seite === "frei") return null;
    if (z.seite === "orig" || !z.seite) return Wr / Hr;
    const [a, b] = z.seite.split(":").map(Number);
    return a / b;
  }
  function zsAktuell(z) {
    const [Wr, Hr] = zsRahmen(z), gr = +z.rezept.gerade || 0;
    return z.rezept.zuschnitt ? rzEntwickler.einpassen(z.rezept.zuschnitt, Wr, Hr, gr) : rzEntwickler.passend(Wr, Hr, gr);
  }
  async function zuschnittAn() {
    const z = bearbZ, g = gross; if (!z || !g || !window.rzEntwickler) return;
    const f = g.liste[g.idx]; if (!f || f.art === "video" || f.path !== z.pfad) return;
    if (g.reiter !== "bearb") { g.reiter = "bearb"; grossReiterZeigen(); }
    z.zuschneiden = true; z.zsVorher = nurGeo(z.rezept);
    bearbZeichnen(); bearbVorschau();
  }
  function zuschnittAus(behalten) {
    const z = bearbZ; if (!z || !z.zuschneiden) return;
    if (!behalten) { BEARB_GEO.forEach(k => delete z.rezept[k]); Object.assign(z.rezept, z.zsVorher || {}); }
    z.zuschneiden = false; z.zsVorher = null;
    bearbZeichnen(); bearbGeaendert(true);
  }
  function zuschnittPanel(box) {
    const z = bearbZ, rz = z.rezept, gr = +rz.gerade || 0;
    box.innerHTML = `
      <canvas class="fb-hist" id="fb-hist" width="300" height="70"></canvas>
      <div class="fb-zs-kopf">${I("crop", 14)} ${esc(T("bearb.zuschneiden", "Zuschneiden"))}</div>
      <label class="fb-r"><span class="fb-r-name">${esc(T("bearb.gerade", "Geraderichten"))}</span><span class="fb-r-wert" id="fbw-gerade">${(gr > 0 ? "+" : "") + gr.toFixed(1)}°</span>
        <input type="range" min="-45" max="45" step="0.1" value="${gr}" id="fb-gerade"></label>
      <div class="fb-zs-titel muted">${esc(T("bearb.seite", "Seitenverhältnis"))}</div>
      <div class="fb-stile fb-zs-seiten">${BEARB_SEITEN.map(([k, ik, fb]) => `<button type="button" class="fb-stil${z.seite === k ? " is-on" : ""}" data-seite="${k}">${esc(ik ? T(ik, fb) : k)}</button>`).join("")}</div>
      <div class="fb-zeile">
        <button type="button" class="btn btn-sm btn-ghost" id="fb-links" title="${esc(T("bearb.links", "90° nach links"))}">${I("rotate-ccw", 14)}</button>
        <button type="button" class="btn btn-sm btn-ghost" id="fb-rechts" title="${esc(T("bearb.rechts", "90° nach rechts"))}">${I("rotate-cw", 14)}</button>
        <span class="fml-luft"></span>
        <button type="button" class="btn btn-sm" id="fb-zs-reset">${esc(T("bearb.zs_reset", "Zurücksetzen"))}</button>
        <button type="button" class="btn btn-sm btn-primary" id="fb-zs-fertig">${I("check", 14)} ${esc(T("bearb.zs_fertig", "Fertig"))}</button>
      </div>
      <div class="muted fb-hinweis">${esc(T("bearb.zs_hinweis", "Rahmen ziehen verschiebt, Ecken und Kanten ändern die Größe. Enter = fertig, Esc = abbrechen."))}</div>`;
    const [Wr, Hr] = zsRahmen(z);
    const ger = box.querySelector("#fb-gerade");
    ger.oninput = () => {
      const v = +ger.value;
      if (v) rz.gerade = v; else delete rz.gerade;
      if (rz.zuschnitt) rz.zuschnitt = rzEntwickler.einpassen(rz.zuschnitt, Wr, Hr, v);
      box.querySelector("#fbw-gerade").textContent = (v > 0 ? "+" : "") + v.toFixed(1) + "°";
      zuschnittRahmen(); bearbGeaendert(false);
    };
    ger.ondblclick = () => { ger.value = 0; ger.oninput(); };
    box.querySelectorAll("[data-seite]").forEach(b => {
      b.onclick = () => {
        z.seite = b.dataset.seite;
        const A = zsSeite(z);
        if (A) rz.zuschnitt = rzEntwickler.passend(Wr, Hr, +rz.gerade || 0, A);
        box.querySelectorAll("[data-seite]").forEach(x => x.classList.toggle("is-on", x === b));
        zuschnittRahmen(); bearbGeaendert(false);
      };
    });
    const drehen = (rechts) => {
      rz.drehen90 = (((+rz.drehen90 || 0) + (rechts ? 1 : 3)) % 4) || undefined;
      if (!rz.drehen90) delete rz.drehen90;
      const c = rz.zuschnitt;
      if (c) rz.zuschnitt = rechts ? [1 - (c[1] + c[3]), c[0], c[3], c[2]] : [c[1], 1 - (c[0] + c[2]), c[3], c[2]];
      if (z.seite !== "orig" && z.seite !== "frei") { const [a, b2] = z.seite.split(":"); const x = `${b2}:${a}`; if (BEARB_SEITEN.some(s => s[0] === x)) z.seite = x; }
      bearbZeichnen(); bearbGeaendert(true);
    };
    box.querySelector("#fb-links").onclick = () => drehen(false);
    box.querySelector("#fb-rechts").onclick = () => drehen(true);
    box.querySelector("#fb-zs-reset").onclick = () => { BEARB_GEO.forEach(k => delete rz[k]); z.seite = "orig"; bearbZeichnen(); bearbGeaendert(true); };
    box.querySelector("#fb-zs-fertig").onclick = () => zuschnittAus(true);
  }
  /** Das Zuschnitt-Rechteck über dem Bild (nur im Werkzeug). */
  function zuschnittRahmen() {
    const g = gross, z = bearbZ; if (!g) return;
    const buehne = g.el.querySelector(".foto-gross-buehne"); if (!buehne) return;
    let ov = buehne.querySelector(".fb-zs-ov");
    const bild = [...buehne.querySelectorAll(".foto-gross-bild")].find(e => !e.hidden && e.offsetWidth);
    if (!z || !z.zuschneiden || z.vorher || !bild || !window.rzEntwickler) { if (ov) ov.remove(); return; }
    if (!ov) {
      ov = document.createElement("div"); ov.className = "fb-zs-ov";
      ov.innerHTML = `<div class="fb-zs-r"><i class="fb-zs-drittel"></i>${["nw", "n", "ne", "e", "se", "s", "sw", "w"].map(h => `<b data-h="${h}"></b>`).join("")}</div>`;
      buehne.appendChild(ov); zuschnittZiehen(ov);
    }
    const bb = buehne.getBoundingClientRect(), r = bild.getBoundingClientRect();
    Object.assign(ov.style, { left: (r.left - bb.left) + "px", top: (r.top - bb.top) + "px", width: r.width + "px", height: r.height + "px" });
    const zs = zsAktuell(z);
    Object.assign(ov.firstElementChild.style, { left: zs[0] * 100 + "%", top: zs[1] * 100 + "%", width: zs[2] * 100 + "%", height: zs[3] * 100 + "%" });
  }
  function zuschnittZiehen(ov) {
    ov.addEventListener("pointerdown", (e) => {
      const z = bearbZ; if (!z || !z.zuschneiden) return;
      const rEl = ov.firstElementChild;
      const h = e.target.dataset.h || (e.target === rEl ? "mitte" : null);
      if (!h) return;
      e.preventDefault(); e.stopPropagation();
      try { ov.setPointerCapture(e.pointerId); } catch (_) {}
      const box = ov.getBoundingClientRect(), [Wr, Hr] = zsRahmen(z), gr = +z.rezept.gerade || 0;
      const drin = (r) => rzEntwickler.drinnen(r, Wr, Hr, gr);
      const st = zsAktuell(z), A = zsSeite(z), MIN = 0.03;
      const x0 = e.clientX, y0 = e.clientY;
      const zug = (ev) => {
        const dx = (ev.clientX - x0) / box.width, dy = (ev.clientY - y0) / box.height;
        let r;
        if (h === "mitte") {   // verschieben — so weit es im Bild geht
          const um = (t) => [st[0] + dx * t, st[1] + dy * t, st[2], st[3]];
          let lo = 0, hi = 1;
          if (drin(um(1))) lo = 1; else for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2; if (drin(um(m))) lo = m; else hi = m; }
          r = um(lo);
        } else {
          let x1 = st[0], y1 = st[1], x2 = st[0] + st[2], y2 = st[1] + st[3];
          if (h.includes("w")) x1 = Math.min(x2 - MIN, x1 + dx);
          if (h.includes("e")) x2 = Math.max(x1 + MIN, x2 + dx);
          if (h.includes("n")) y1 = Math.min(y2 - MIN, y1 + dy);
          if (h.includes("s")) y2 = Math.max(y1 + MIN, y2 + dy);
          // Anker: die gegenüberliegende Ecke bzw. die Mitte der gegenüberliegenden Kante
          const ax = h.includes("w") ? x2 : (h.includes("e") ? x1 : (x1 + x2) / 2);
          const ay = h.includes("n") ? y2 : (h.includes("s") ? y1 : (y1 + y2) / 2);
          if (A) {   // Seitenverhältnis halten (in Pixeln)
            let bw = (x2 - x1) * Wr, bh = (y2 - y1) * Hr;
            // Ecke: die stärkere Bewegung (relativ zur Ausgangsgröße) bestimmt die Größe
            if (h.length === 2) { if (Math.abs(bw / (st[2] * Wr) - 1) >= Math.abs(bh / (st[3] * Hr) - 1)) bh = bw / A; else bw = bh * A; }
            else if (h === "e" || h === "w") bh = bw / A; else bw = bh * A;
            const nb = bw / Wr, nh = bh / Hr;
            x1 = h.includes("w") ? ax - nb : (h.includes("e") ? ax : ax - nb / 2);
            y1 = h.includes("n") ? ay - nh : (h.includes("s") ? ay : ay - nh / 2);
            x2 = x1 + nb; y2 = y1 + nh;
          }
          r = [x1, y1, x2 - x1, y2 - y1];
          if (!drin(r)) {   // in den Rahmen: zum Anker hin verkleinern
            const sk = (t) => [ax + (r[0] - ax) * t, ay + (r[1] - ay) * t, r[2] * t, r[3] * t];
            let lo = 0, hi = 1;
            for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2; if (drin(sk(m))) lo = m; else hi = m; }
            r = sk(lo);
            if (r[2] < MIN || r[3] < MIN) return;
          }
        }
        z.rezept.zuschnitt = r;
        zuschnittRahmen();
      };
      const los = () => {
        ov.removeEventListener("pointermove", zug); ov.removeEventListener("pointerup", los); ov.removeEventListener("pointercancel", los);
        bearbGeaendert(false);
      };
      ov.addEventListener("pointermove", zug); ov.addEventListener("pointerup", los); ov.addEventListener("pointercancel", los);
    });
  }
  function grossTastenHoch(e) { if (e.key === ".") { e.preventDefault(); bearbVorher(false); } }
  async function bearbSpeichernJetzt() {
    const z = bearbZ; if (!z || !z.offen) return;
    clearTimeout(z.tmrS); z.offen = false;
    const r = await api().foto_rezept_speichern(z.pfad, z.rezept).catch(() => null);   // warte-ok: schreibt eine Zeile
    if (!r || !r.ok) return;
    const an = !ist_leer(z.rezept) ? 1 : 0;
    geladen.forEach(x => { if (x.path === z.pfad) x.bearbeitet = an; });
    if (gross) gross.liste.forEach(x => { if (x.path === z.pfad) x.bearbeitet = an; });
    if (stand) stand.bearbeitet = r.stand_bearbeitet;
    if (haupt) haupt.querySelectorAll(".foto-kachel").forEach(k => { const x = geladen[+k.dataset.foto]; if (x && x.path === z.pfad) k.classList.toggle("ist-bearbeitet", !!an); });
    navZeichnen();
    kachelBilderNeu([z.pfad]);
    window.dispatchEvent(new CustomEvent("rz-rezept-geaendert", { detail: { pfade: [z.pfad] } }));
  }
  /** 09.10.2026 — nach dem Bearbeiten zeigt die Kachel die neue Fassung (fotos_thumbs entwickelt das kleine Bild). */
  async function kachelBilderNeu(pfade) {
    const sichtbar = pfade.filter(p => geladen.some(x => x.path === p)).slice(0, 120);
    if (!sichtbar.length) return;
    const r = await api().fotos_thumbs(sichtbar).catch(() => null);   // warte-ok: Kacheln behalten bis dahin ihr Bild
    const bilder = (r && r.thumbs) || {};
    if (!haupt) return;
    geladen.forEach((f, i) => {
      if (!bilder[f.path]) return;
      f.thumb_url = bilder[f.path];
      const img = haupt.querySelector(`.foto-kachel[data-foto="${i}"] img`);
      if (img) img.src = bilder[f.path];
    });
  }
  async function bearbFuerMarkierte(rezept, pfade) {
    const r = await rzWarten("foto_rezept_speichern", () => api().foto_rezept_speichern(pfade, rezept)).catch(() => null);
    if (!r || !r.ok) { toast((r && r.error) || "?", "warn"); return; }
    const an = !ist_leer(rezept) ? 1 : 0;
    geladen.forEach(x => { if (pfade.includes(x.path)) x.bearbeitet = an; });
    if (stand) stand.bearbeitet = r.stand_bearbeitet;
    if (haupt) haupt.querySelectorAll(".foto-kachel").forEach(k => { const x = geladen[+k.dataset.foto]; if (x && pfade.includes(x.path)) k.classList.toggle("ist-bearbeitet", !!an); });
    navZeichnen();
    kachelBilderNeu(pfade);
    window.dispatchEvent(new CustomEvent("rz-rezept-geaendert", { detail: { pfade } }));
    toast(T("bearb.n_ok", "{n} Fotos bearbeitet — die Originale bleiben unverändert.").replace("{n}", num(pfade.length)), "success", 4000);
  }

  async function grossSeite(f) {
    const g = gross; if (!g) return;
    const info = g.el.querySelector(".foto-gross-info"), host = g.el.querySelector("#foto-gross-karte");
    if (!info || !host) return;
    const r = await api().fotos_details(f.path).catch(() => null);   // warte-ok: Seite füllt sich nach, das Bild steht schon
    if (gross !== g || g.liste[g.idx] !== f) return;
    const d = (r && r.ok && r.foto) || f;
    const tour = d.tour || null;
    const touren = (tour && tour.touren) || (tour ? [tour] : []);
    info.innerHTML = `
      <div class="foto-gross-i-zeile">${I("calendar", 14)} ${esc(d.tag_lokal ? `${tagText(d.tag_lokal)} ${uhrzeit(d)}` : "—")}</div>
      ${d.kamera ? `<div class="foto-gross-i-zeile">${I("camera", 14)} ${esc(d.kamera)}${d.objektiv ? " · " + esc(d.objektiv) : ""}</div>` : ""}
      ${[d.brennweite, d.blende, d.belichtung, d.iso && "ISO " + d.iso].filter(Boolean).length ? `<div class="foto-gross-i-zeile muted">${esc([d.brennweite, d.blende, d.belichtung, d.iso && "ISO " + d.iso].filter(Boolean).join(" · "))}</div>` : ""}
      ${[d.ort, d.region, d.land].filter(Boolean).length ? `<div class="foto-gross-i-zeile">${I("map-pin", 14)} ${esc([d.ort, d.region, d.land].filter(Boolean).join(", "))}</div>` : ""}
      ${d.lat == null ? `<div class="foto-gross-i-zeile muted">${esc(T("fotos.gross_ohne_ort", "Ohne Koordinate — auf der Karte die Tour zur Aufnahmezeit"))}</div>` : ""}
      ${touren.length ? `<div class="foto-gross-i-touren">${touren.map(x => `<button type="button" class="foto-gross-i-tour" data-gh="${esc(x.geo_hash || "")}" data-p="${esc(x.path || "")}" title="${esc(T("fotos.d_tour_tip", "Tour-Seite öffnen: Karte, alle Fotos und Clips der Tour"))}">${I("route", 13)} <span class="fg-tourname">${esc(x.name || "")}</span></button>`).join("")}</div>` : ""}`;
    info.querySelectorAll(".foto-gross-i-tour").forEach(b => {
      b.onclick = () => { const p = f.path; grossZu(); if (window.rzTourSeite) window.rzTourSeite.oeffnen({ geo_hash: b.dataset.gh, path: b.dataset.p, name: b.textContent.trim() }, p); };
    });
    const linie = tour && Array.isArray(tour.geom) && tour.geom.length > 1 ? tour.geom : null;
    const teile = (tour && Array.isArray(tour.teile) && tour.teile.length) ? tour.teile : (linie ? [linie] : null);
    const hatOrt = d.lat != null && d.lon != null;
    host.classList.toggle("ist-leer", !teile && !hatOrt);
    if (!teile && !hatOrt) { if (g.karte) { try { g.karte.remove(); } catch (_) {} g.karte = null; } host.innerHTML = `<div class="muted foto-gross-karte-leer">${esc(T("fotos.gross_keine_karte", "Kein Ort und keine Tour — nichts auf der Karte"))}</div>`; return; }
    const zeichnen = () => {
      const m = g.karte; if (!m || gross !== g) return;
      const daten = { type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: teile || [] } };
      if (m.getSource("g-spur")) m.getSource("g-spur").setData(daten);
      else {
        m.addSource("g-spur", { type: "geojson", data: daten });
        m.addLayer({ id: "g-spur-rand", type: "line", source: "g-spur", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#0f1a20", "line-width": 6, "line-opacity": 0.55 } });
        m.addLayer({ id: "g-spur-linie", type: "line", source: "g-spur", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#48d6c4", "line-width": 3 } });
      }
      (g.nadeln || []).forEach(n => { try { n.remove(); } catch (_) {} });
      g.nadeln = (typeof rzStartZiel === "function") ? rzStartZiel(m, g.lib, teile) : [];
      if (g.pin) { try { g.pin.remove(); } catch (_) {} g.pin = null; }
      if (hatOrt) { const el = document.createElement("div"); el.className = "foto-d-pin"; g.pin = new g.lib.Marker({ element: el }).setLngLat([+d.lon, +d.lat]).addTo(m); }
      try {
        const b = new g.lib.LngLatBounds();
        if (teile) teile.forEach(t2 => t2.forEach(c => b.extend(c)));
        if (hatOrt) b.extend([+d.lon, +d.lat]);
        m.fitBounds(b, { padding: (typeof RZ_ARCHIV_RAND === "object") ? RZ_ARCHIV_RAND : 26, maxZoom: hatOrt && !teile ? 14 : 13, duration: 0 });
      } catch (_) {}
    };
    if (!g.karte) {
      host.innerHTML = "";
      try {
        const c = createMap({ container: host, styleKey: (typeof rzArchivStil === "function") ? rzArchivStil() : undefined,
          common: { center: hatOrt ? [+d.lon, +d.lat] : teile[0][0], zoom: 11, attributionControl: true } });
        g.karte = c.map; g.lib = c.lib;
        window.__fotoGrossKarte = g.karte;   // Prüfstand
        try { g.karte.addControl(new g.lib.NavigationControl({ showCompass: false }), "top-right"); } catch (_) {}
        if (typeof rzMassstab === "function") rzMassstab(g.karte);
        g.karte.on("load", zeichnen);
      } catch (_) {}
    } else if (g.karte.isStyleLoaded && g.karte.isStyleLoaded()) zeichnen();
    else g.karte.once("load", zeichnen);
  }
  function grossBlaettern(r) {
    if (!gross) return;
    const n = gross.idx + r;
    if (n < 0 || n >= gross.liste.length) return;
    gross.idx = n; grossZeigen();
    const f = gross.liste[n]; if (f) detailZeigen(f);
  }
  function grossTasten(e) {
    if (!gross) return;
    const v = gross.el.querySelector("video");
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) && e.target.type !== "range") return;
    if (e.target && e.target.type === "range" && /^Arrow/.test(e.key)) return;   // Pfeile bewegen den Regler
    if (e.key === "." && !e.metaKey && !e.ctrlKey) { e.preventDefault(); e.stopPropagation(); if (!e.repeat) bearbVorher(true); return; }
    if (bearbZ && bearbZ.zuschneiden && (e.key === "Enter" || e.key === "Escape")) {
      e.preventDefault(); e.stopPropagation(); zuschnittAus(e.key === "Enter"); return;
    }
    if ((e.key === "r" || e.key === "R") && !e.metaKey && !e.ctrlKey && !e.altKey && !v) {
      e.preventDefault(); e.stopPropagation();
      if (bearbZ && bearbZ.zuschneiden) zuschnittAus(true); else zuschnittAn(true);
      return;
    }
    if (e.key === "Escape" && !gross.el.classList.contains("im-layout")) { e.preventDefault(); e.stopPropagation(); grossVollbild(false); }
    else if (e.key === "Escape" || ((e.key === "g" || e.key === "G") && !e.metaKey && !e.ctrlKey)) { e.preventDefault(); e.stopPropagation(); grossZu(); }
    else if ((e.key === "f" || e.key === "F") && !e.metaKey && !e.ctrlKey) { e.preventDefault(); e.stopPropagation(); grossVollbild(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); grossBlaettern(-1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); grossBlaettern(1); }
    else if (e.key === " " && !(e.target && /INPUT|TEXTAREA/.test(e.target.tagName))) {
      e.preventDefault(); e.stopPropagation();
      if (v) { if (v.paused) v.play().catch(() => {}); else v.pause(); } else grossZu();
    }
  }
  function istWindows() { return /Windows/i.test(navigator.userAgent || ""); }
  async function grossZeigen() {
    const g = gross; if (!g) return;
    const f = g.liste[g.idx];
    const buehne = g.el.querySelector(".foto-gross-buehne"), hinweis = g.el.querySelector(".foto-gross-hinweis");
    hinweis.hidden = true; hinweis.innerHTML = "";
    grossReiterZeigen();   // geladen wird die Bearbeitung unten, sobald das Bild da ist
    buehne.innerHTML = f.thumb_url ? `<img class="foto-gross-bild is-vorschau" src="${f.thumb_url}" alt="">` : `<div class="muted">${esc(T("common.loading", "Lädt …"))}</div>`;
    g.el.querySelector(".foto-gross-links").disabled = g.idx <= 0;
    g.el.querySelector(".foto-gross-rechts").disabled = g.idx >= g.liste.length - 1;
    g.el.querySelector(".foto-gross-name").textContent = [f.dateiname, f.tag_lokal ? `${tagText(f.tag_lokal)} ${uhrzeit(f)}` : ""].filter(Boolean).join(" · ");
    try { grossStreifen(); } catch (_) {}
    grossSeite(f).catch(() => {});
    const r = await api().fotos_gross(f.path).catch(() => null);
    if (gross !== g || g.liste[g.idx] !== f) return;   // inzwischen weitergeblättert
    const knoepfe = [];
    if (r && r.ok && r.art === "video" && r.quelle === "original") {
      buehne.innerHTML = `<video class="foto-gross-video" controls autoplay playsinline src="${r.url}"></video>`;
      const v = buehne.querySelector("video");
      v.addEventListener("error", () => videoGehtNicht(f, hinweis), { once: true });
      knoepfe.push(`<button type="button" class="btn btn-sm" data-gk="standbild">${I("camera", 14)} ${esc(T("fotos.standbild", "Standbild speichern"))}</button>`);
    } else if (r && r.ok) {
      buehne.innerHTML = `<img class="foto-gross-bild" src="${r.url}" alt="">`;
      g.originalUrl = r.quelle === "bearbeitet" ? null : r.url;   // „Vorher“ darf nie die bearbeitete Fassung sein
      if (f.bearbeitet || g.reiter === "bearb") bearbLaden(f).catch(() => {});
      if (r.quelle === "bibliothek") { hinweis.hidden = false; hinweis.textContent = T("fotos.gross_fern", "Original gerade nicht erreichbar — gezeigt wird die Vorschau aus der Bibliothek."); }
    } else if (r && r.error) { hinweis.hidden = false; hinweis.textContent = r.error; }
    if (r && r.original_da !== false) {
      knoepfe.push(`<button type="button" class="btn btn-sm" data-gk="finder">${esc(T("fotos.im_finder", "Im Finder zeigen"))}</button>`);
      knoepfe.push(`<button type="button" class="btn btn-sm" data-gk="app">${esc(T("fotos.mit_app", "Mit Standard-App öffnen"))}</button>`);
      knoepfe.push(`<button type="button" class="btn btn-sm" data-gk="mit">↗ ${esc(T("oeffnen.ctx_1", "Öffnen mit …"))}</button>`);
    }
    const kb = g.el.querySelector(".foto-gross-knoepfe"); kb.innerHTML = knoepfe.join("");
    kb.querySelectorAll("[data-gk]").forEach(b => {
      b.onclick = async () => {
        const w = b.dataset.gk;
        if (w === "finder") api().reveal_in_finder(f.path);
        else if (w === "app") api().open_path(f.path);
        else if (w === "mit") { if (window.rzArchivExport) window.rzArchivExport.oeffnenMit([f.path]); }
        else if (w === "standbild") {
          const v = buehne.querySelector("video"); if (!v) return;
          v.pause();
          const s = await rzWarten("fotos_video_standbild", () => api().fotos_video_standbild(f.path, v.currentTime || 0)).catch((e) => ({ ok: false, error: String(e) }));
          if (s && s.ok) toast(T("fotos.standbild_ok", "Gespeichert: {n}").replace("{n}", String(s.ziel || "").split(/[\\/]/).pop()) + (s.im_bestand ? " · " + T("fotos.standbild_bestand", "erscheint gleich im Bestand") : ""), "success", 5000);
          else if (s && !s.abbruch) toast((s && s.error) || "?", "error", 6000);
        }
      };
    });
  }
  /** Video spielt hier nicht. Unter Windows fast immer HEVC/H.265 ohne die Erweiterung aus dem Microsoft Store. */
  function videoGehtNicht(f, hinweis) {
    hinweis.hidden = false;
    if (istWindows()) {
      hinweis.innerHTML = `<b>${esc(T("fotos.hevc_titel", "Dieses Video kann Windows hier nicht abspielen"))}</b>
        <div>${esc(T("fotos.hevc_text", "Meist ist es im Format HEVC (H.265) — so filmen viele Handys und Kameras. Windows braucht dafür die Erweiterung „HEVC-Videoerweiterungen“ aus dem Microsoft Store:"))}</div>
        <ol><li>${esc(T("fotos.hevc_1", "Unten auf „Erweiterung im Microsoft Store öffnen“ klicken."))}</li>
            <li>${esc(T("fotos.hevc_2", "Im Store „Installieren“ bzw. „Herunterladen“ wählen."))}</li>
            <li>${esc(T("fotos.hevc_3", "GPS Studio schließen und neu öffnen — danach laufen die Videos hier."))}</li></ol>
        <button type="button" class="btn btn-sm btn-primary" id="foto-hevc-store">${esc(T("fotos.hevc_knopf", "Erweiterung im Microsoft Store öffnen"))}</button>
        <button type="button" class="btn btn-sm" id="foto-hevc-app">${esc(T("fotos.mit_app", "Mit Standard-App öffnen"))}</button>`;
      hinweis.querySelector("#foto-hevc-store").onclick = () => api().open_url("https://apps.microsoft.com/detail/9n4wgh0z6vhq");
    } else {
      hinweis.innerHTML = `<div>${esc(T("fotos.video_nicht", "Dieses Video lässt sich hier nicht abspielen."))}</div>
        <button type="button" class="btn btn-sm" id="foto-hevc-app">${esc(T("fotos.mit_app", "Mit Standard-App öffnen"))}</button>`;
    }
    hinweis.querySelector("#foto-hevc-app").onclick = () => api().open_path(f.path);
  }
  // Leertaste öffnet das gewählte Foto groß (wie in Lightroom/Apple Fotos), nur im sichtbaren Foto-Bereich
  // 08.10.2026 (Lightroom-Tasten) — auch E öffnet die Lupe; Esc hebt die Markierung auf, ⌘A markiert alle
  document.addEventListener("keydown", (e) => {
    if (gross) return;
    const t = e.target; if (t && (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable)) return;
    if (!angemeldet || !haupt || !haupt.offsetParent) return;
    if (document.querySelector(".modal-overlay:not([hidden]), #modal-overlay:not([hidden]), .ts-menue, .ts-seite")) return;
    if (e.key === "Escape" && markiert.size) { e.preventDefault(); markiert.clear(); _letzterKlick = -1; markierungZeigen(); return; }
    if ((e.key === "p" || e.key === "P") && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const p = markiert.size ? [...markiert] : (auswahl ? [auswahl] : []);
      if (p.length) { e.preventDefault(); favUmschalten(p); }
      return;
    }
    if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === "a" || e.key === "A")) {
      e.preventDefault(); geladen.forEach(x => markiert.add(x.path)); markierungZeigen(); return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey || !(e.key === " " || e.key === "e" || e.key === "E")) return;
    if (!auswahl) return;
    const f = geladen.find(x => x.path === auswahl); if (!f) return;
    e.preventDefault(); grossOeffnen(f);
  });
  window.__rzFotoGross = { oeffnen: (p) => grossOeffnen(geladen.find(x => x.path === p) || { path: p }), zu: () => grossZu(), offen: () => !!gross };   // Prüfstand

  async function detailZeigen(f, opt) {
    if (!f) return;
    opt = opt || {};
    auswahl = f.path;
    const box = document.getElementById("lib-detail");
    if (!box) return;
    box.hidden = false;
    detailKarteWeg();
    box.innerHTML = `<div class="foto-detail"><div class="muted">${T("common.loading", "Lädt …")}</div></div>`;
    const r = await api().fotos_details(f.path).catch(() => null);
    const d = (r && r.ok && r.foto) || f;
    const m = maengel(d);
    const tags = (d.tags && Object.keys(d.tags)) || [];
    const tour = d.tour || null;
    const befunde = d.befunde || null;
    // 09.10.2026 — Bild, Titel, Tabelle mit Symbolen, „Standort“ mit Karte,
    // Touren, Stichwörter als Chips. Alles von vorher bleibt (Ort eingeben, Ähnliche, Bearbeiten, alle Aufnahmedaten).
    const tz = (sym, label, wert) => wert
      ? `<div class="fd-zeile"><span class="fd-sym" aria-hidden="true">${sym}</span><span class="fd-label muted">${esc(label)}</span><span class="fd-wert">${wert}</span></div>` : "";
    const titel = String(d.ort || "").split(",")[0].trim() || d.dateiname || "";
    const ortText = [d.ort, d.region, d.land].filter(Boolean).join(", ");
    const stw = String(d.stichworte || "").split(/[;,]/).map(x => x.trim()).filter(Boolean);
    box.innerHTML = `
      <div class="foto-detail">
        ${d.thumb_url ? `<button type="button" class="foto-detail-bild-knopf" id="foto-d-gross" title="${esc(T("fotos.gross_oeffnen", "Groß ansehen (Leertaste)"))}"><img class="foto-detail-bild" src="${d.thumb_url}" alt=""></button>` : ""}
        ${opt.streifen && opt.streifen.length > 1 ? `<div class="fd-streifen" id="fd-streifen">${opt.streifen.slice(0, 60).map((x, k) => `<button type="button" class="fd-sbild${x.path === d.path ? " is-on" : ""}" data-k="${k}" title="${esc(x.dateiname || "")}"></button>`).join("")}</div>` : ""}
        ${opt.kopf ? `<div class="fd-stelle muted">${esc(opt.kopf)}</div>` : ""}
        <div class="fd-titel"><span class="fd-titel-text">${esc(titel)}</span>
          <button type="button" class="fd-fav${d.fav ? " ist-fav" : ""}" id="fd-fav" title="${esc(T("fotos.fav_tip", "Favorit (P)"))}">${herz(d.fav, 18)}</button></div>
        ${titel !== d.dateiname ? `<div class="fd-datei muted">${esc(d.dateiname || "")}</div>` : ""}
        <div class="foto-detail-kopf">
          <button type="button" class="btn btn-sm foto-d-gross-knopf" id="foto-d-gross2">${d.art === "video" ? I("play", 14) + " " + esc(T("fotos.video_abspielen", "Abspielen")) : I("maximize-2", 14) + " " + esc(T("fotos.gross", "Groß ansehen"))}</button>
          ${inhalt && inhalt.an && inhalt.modell_da ? `<button type="button" class="btn btn-sm" id="foto-d-aehnlich">${I("images", 14)} ${esc(T("fotos.inh_aehnliche", "Ähnliche Fotos"))}</button>` : ""}</div>
        ${d.datei_da === false ? `<div class="foto-fern foto-fern-klein">${I("wifi-off", 14)} ${T("fotos.d_fern", "Original gerade nicht erreichbar — Vorschau und Aufnahmedaten kommen aus der Bibliothek.")}</div>` : ""}
        ${befunde ? befundeHtml(befunde)
                  : (m.length ? `<div class="foto-detail-warn">${I("triangle-alert", 14)} ${esc(m.join(" · "))}</div>` : "")}
        <div class="fd-tabelle">
          ${tz(I("calendar"), T("fotos.d_zeit", "Aufnahme"), d.tag_lokal ? esc(`${d.tag_lokal} ${uhrzeit(d)}`) + (d.tz_bekannt ? "" : ` <span class="muted">(${esc(T("fotos.geraten", "geraten"))})</span>`) : "")}
          ${tz(I("camera"), T("fotos.d_kamera", "Kamera"), [d.kamera, d.objektiv].filter(Boolean).map(esc).join("<br><span class=\"muted\">") + (d.kamera && d.objektiv ? "</span>" : ""))}
          ${tz(I("aperture"), T("fotos.d_blende", "Blende"), esc(d.blende || ""))}
          ${tz(I("timer"), T("fotos.d_belichtung", "Belichtungszeit"), esc(d.belichtung || ""))}
          ${tz("ISO", "ISO", esc(d.iso ? String(d.iso) : ""))}
          ${tz(I("ruler"), T("fotos.d_brennweite", "Brennweite"), esc(d.brennweite || ""))}
          ${tz(I("crop"), T("fotos.d_groesse", "Bildgröße"), d.breite && d.hoehe ? esc(`${d.breite} × ${d.hoehe}`) + ` <span class="muted">(${(d.breite * d.hoehe / 1e6).toFixed(1).replace(".", ",")} MP)</span>` : "")}
          ${tz(I("clock"), T("fotos.d_dauer", "Dauer"), esc(dauerText(d.dauer_s)))}
        </div>
        <div class="fd-abschnitt">${esc(T("fotos.d_standort", "Standort"))}</div>
        ${ortText || d.lat != null ? `<div class="fd-ort">${I("map-pin", 14)} ${esc(ortText || "")}${d.lat != null && d.lon != null ? `<div class="muted fd-koord">${(+d.lat).toFixed(5)}, ${(+d.lon).toFixed(5)}${d.ele != null ? ` · ${Math.round(d.ele)} m` : ""}</div>` : ""}</div>` : ""}
        <div class="foto-d-karte" id="foto-d-karte" hidden></div>
        <div class="foto-d-ort-hinweis muted" id="foto-d-ort-hinweis"></div>
        ${d.datei_da !== false ? `<button type="button" class="btn btn-ghost btn-sm foto-d-ort-tippen" id="foto-d-ort-tippen" title="${esc(T("ort.tippen_tip", "Ort suchen oder Koordinate einfügen statt in die Karte zu klicken"))}">${I("map-pin", 14)} ${esc(T("ort.tippen", "Ort eingeben …"))}</button>` : ""}
        <div class="foto-d-ort-neu" id="foto-d-ort-neu" hidden></div>
        <div class="fd-abschnitt">${esc(T("fotos.d_touren", "Touren"))}</div>
        <div class="foto-d-touren" id="foto-d-touren">${tourenHtml(tour)}</div>
        ${stw.length ? `<div class="fd-abschnitt">${esc(T("fotos.d_stichworte", "Stichwörter"))}</div>
          <div class="fd-chips">${stw.map(x => `<span class="fd-chip">${esc(x)}</span>`).join("")}</div>` : ""}
        ${(d.alben || []).length ? `<div class="fd-abschnitt">${esc(T("fotos.alben", "Alben"))}</div>
          <div class="fd-chips">${d.alben.map(a => `<span class="fd-chip">${I("book-image", 12)} ${esc(a.name)} <button type="button" class="fd-chip-x" data-album-raus="${a.id}" title="${esc(T("fotos.album_raus", "Aus dem Album nehmen"))}">✕</button></span>`).join("")}</div>` : ""}
        <div class="fd-pfad muted" title="${esc(d.ordner || "")}">${I("folder", 13)} ${esc(d.ordner || "")}</div>
        <details class="foto-detail-edit" id="foto-d-edit">
          <summary>${I("pencil", 13)} ${T("fotos.edit_titel", "Aufnahmedaten bearbeiten")}</summary>
          <div class="foto-edit-body" id="foto-edit-body"><div class="muted">${T("common.loading", "Lädt …")}</div></div>
        </details>
        ${tags.length ? `
          <details class="foto-detail-tags">
            <summary>${T("fotos.d_alle_tags", "Alle Aufnahmedaten")} (${tags.length})</summary>
            <div class="foto-tagliste">${tags.sort().map(k =>
              `<div class="foto-tagzeile"><span class="muted">${esc(k)}</span> ${esc(d.tags[k])}</div>`).join("")}</div>
          </details>` : ""}
      </div>`;
    document.querySelectorAll(".foto-kachel.is-on").forEach(el => el.classList.remove("is-on"));
    detailKarte(d, tour);
    const aeK = box.querySelector("#foto-d-aehnlich");
    if (aeK) aeK.onclick = () => aehnlicheZeigen(d);
    // 09.10.2026 — bearbeitete Fotos zeigen rechts die bearbeitete Fassung (das Raster-Vorschaubild bleibt das Original, ✎)
    if (d.bearbeitet && d.art !== "video") {
      api().foto_entwickeln_vorschau(d.path, null, false).then(r => {   // warte-ok: bis dahin steht das Vorschaubild
        const im = box.querySelector(".foto-detail-bild");
        if (r && r.ok && im && auswahl === d.path) im.src = r.url;
      }).catch(() => {});
    }
    const favK = box.querySelector("#fd-fav");
    if (favK) favK.onclick = () => { favUmschalten([d.path], favK.classList.contains("ist-fav")); };
    box.querySelectorAll("[data-album-raus]").forEach(b => {
      b.onclick = async () => {
        const w = await api().fotos_album_inhalt(+b.dataset.albumRaus, [d.path], false).catch(() => null);   // warte-ok: löscht eine Zeile
        if (w && w.ok) { alben = w.alben; navZeichnen(); detailZeigen(d, opt); if (+filter.album === +b.dataset.albumRaus) neuLaden(true); }
      };
    });
    const str = box.querySelector("#fd-streifen");
    if (str) {   // 09.10.2026 — Bildleiste der Stelle: Klick wechselt, Doppelklick = Lupe
      str.querySelectorAll("[data-k]").forEach(b => {
        b.onclick = () => detailZeigen(opt.streifen[+b.dataset.k], opt);
        b.ondblclick = () => grossOeffnen(opt.streifen[+b.dataset.k], opt.streifen);
      });
      const fehlt = opt.streifen.slice(0, 60).filter(x => !x.thumb_url).map(x => x.path);
      const setzen = () => str.querySelectorAll("[data-k]").forEach(b => { const x = opt.streifen[+b.dataset.k]; if (x && x.thumb_url) b.style.backgroundImage = `url("${x.thumb_url}")`; });
      setzen();
      if (fehlt.length) api().fotos_thumbs(fehlt, false).then(r => {   // warte-ok: Leiste zeigt bis dahin ihre Flächen
        const t = (r && r.thumbs) || {};
        opt.streifen.forEach(x => { if (t[x.path]) x.thumb_url = t[x.path]; });
        if (str.isConnected) setzen();
      }).catch(() => {});
      const an = str.querySelector(".is-on"); if (an) an.scrollIntoView({ block: "nearest", inline: "center" });
    }
    const grossK = box.querySelectorAll("#foto-d-gross, #foto-d-gross2");
    grossK.forEach(k => { k.onclick = () => grossOeffnen(d); });
    const edit = box.querySelector("#foto-d-edit");
    if (edit) edit.addEventListener("toggle", () => { if (edit.open) editorLaden(d); });
    const tunKnopf = box.querySelector('[data-tun="geotagger"]');
    if (tunKnopf) tunKnopf.onclick = () => verortenStarten(d, tunKnopf.dataset.tour || "");
    tourenBinden(box, d);
    const ortT = box.querySelector("#foto-d-ort-tippen");
    if (ortT) ortT.onclick = () => { if (window.rzArchivExport) window.rzArchivExport.ortSetzen([d.path], () => { neuLaden(true); detailZeigen(d); }); };
  }

  /* 08.10.2026 — wer in den Medien sucht, sieht oben auch die Touren dazu
     (Name, Ort, Jahr); ein Klick öffnet die Tour-Seite. Das Ergebnis bleibt je Suchtext gemerkt (zeichnen() läuft oft). */
  let _suchT = { text: null, touren: [] };
  async function suchTouren() {
    const el = haupt && haupt.querySelector("#foto-such-touren"); if (!el) return;
    const text = String(filter.suche || "").trim();
    if (text.length < 2) { el.hidden = true; return; }
    if (_suchT.text !== text) {
      const r = await api().suche_gemeinsam(text, 8, 0).catch(() => null);   // warte-ok: Leiste erscheint, sobald da
      _suchT = { text, touren: (r && r.ok && r.touren) || [], n: (r && r.n_touren) || 0 };
    }
    const el2 = haupt && haupt.querySelector("#foto-such-touren"); if (!el2 || String(filter.suche || "").trim() !== text) return;
    if (!_suchT.touren.length) { el2.hidden = true; return; }
    el2.hidden = false;
    el2.innerHTML = `<span class="muted">${I("route", 13)} ${esc(T("suche.touren_zu", "Touren zu „{q}“:").replace("{q}", text))}</span>`
      + _suchT.touren.map((x, i) => `<button type="button" class="foto-such-tour" data-i="${i}" title="${esc(T("fotos.d_tour_tip", "Tour-Seite öffnen: Karte, alle Fotos und Clips der Tour"))}">${esc(x.name || "")}${x.started_at ? ` <small>${esc(String(x.started_at).slice(0, 4))}</small>` : ""}</button>`).join("")
      + (_suchT.n > _suchT.touren.length ? `<span class="muted">+${_suchT.n - _suchT.touren.length}</span>` : "");
    el2.querySelectorAll(".foto-such-tour").forEach(b => {
      b.onclick = () => { const x = _suchT.touren[+b.dataset.i]; if (x && window.rzTourSeite) window.rzTourSeite.oeffnen({ geo_hash: x.geo_hash, path: x.path, name: x.name }); };
    });
  }

  /* 08.10.2026 — alle Touren des Mediums: Klick öffnet die Tour-Seite bei
     diesem Foto, ✕ nimmt es aus der Tour, „＋ zu Tour …“ bietet die Touren seines Tages an. Gilt überall in GPS Studio. */
  function tourenHtml(tour) {
    const liste = (tour && tour.touren) || (tour ? [tour] : []);
    return `<div class="foto-detail-zeile foto-d-touren-kopf"><span class="muted">${esc(liste.length > 1 ? T("fotos.d_touren", "Touren") : T("fotos.d_tour", "Tour"))}</span></div>
      ${liste.map(x => `<div class="foto-d-tourzeile">
          <button type="button" class="foto-d-tour" data-gh="${esc(x.geo_hash || "")}" data-tour="${esc(x.path || "")}" title="${esc(T("fotos.d_tour_tip", "Tour-Seite öffnen: Karte, alle Fotos und Clips der Tour"))}">${esc(x.name || "")}</button>
          ${x.quelle === "hand" ? `<span class="foto-d-tour-hand" title="${esc(T("tourseite.von_hand", "von dir hinzugefügt"))}">＋</span>` : ""}
          <button type="button" class="foto-d-tour-raus" data-raus="${esc(x.geo_hash || "")}" title="${esc(T("fotos.d_tour_raus", "Gehört nicht zu dieser Tour — herausnehmen"))}">✕</button></div>`).join("")}
      <button type="button" class="btn btn-ghost btn-sm foto-d-tour-plus" id="foto-d-tour-plus">＋ ${esc(T("fotos.d_tour_plus", "Zu einer Tour hinzufügen …"))}</button>`;
  }
  function tourenBinden(box, d) {
    box.querySelectorAll(".foto-d-tour").forEach(b => {
      b.onclick = () => {
        if (window.rzTourSeite) window.rzTourSeite.oeffnen({ geo_hash: b.dataset.gh, path: b.dataset.tour, name: b.textContent }, d.path);
        else tourOeffnen(b.dataset.tour || "");
      };
    });
    box.querySelectorAll("[data-raus]").forEach(b => {
      b.onclick = async () => {
        const r = await api().tour_medien_korrigieren(b.dataset.raus, [d.path], false).catch(() => null);   // warte-ok: schreibt eine Zeile
        if (!r || !r.ok) { toast((r && r.error) || "?", "error"); return; }
        toast(T("tourseite.raus_ok", "Aus der Tour genommen."), "info");
        tourenNeu(box, d);
      };
    });
    const plus = box.querySelector("#foto-d-tour-plus");
    if (plus) plus.onclick = async () => {
      const r = await api().medium_touren(d.path).catch(() => null);   // warte-ok: nur Datenbank
      const am = (r && r.ok && r.am_tag) || [];
      if (!am.length) { toast(T("fotos.d_tour_keine", "Keine weitere Tour an diesem Tag."), "info"); return; }
      const rr = plus.getBoundingClientRect();
      const menue = document.createElement("div");
      menue.className = "lib-ctxmenu ts-menue"; menue.setAttribute("role", "menu");
      menue.innerHTML = am.map((x, i) => `<button type="button" class="lib-ctx-item" data-i="${i}">${esc(x.name)}</button>`).join("");
      document.body.appendChild(menue);
      menue.style.left = Math.max(4, Math.min(rr.left, window.innerWidth - menue.offsetWidth - 6)) + "px";
      menue.style.top = Math.max(4, Math.min(rr.bottom + 2, window.innerHeight - menue.offsetHeight - 6)) + "px";
      const zu = () => { document.removeEventListener("mousedown", aussen, true); menue.remove(); };
      const aussen = (ev) => { if (!menue.contains(ev.target)) zu(); };
      setTimeout(() => document.addEventListener("mousedown", aussen, true), 0);
      menue.querySelectorAll("[data-i]").forEach(k => {
        k.onclick = async () => {
          zu();
          const x = am[+k.dataset.i];
          const w = await api().tour_medien_korrigieren(x.geo_hash, [d.path], true).catch(() => null);   // warte-ok: schreibt eine Zeile
          if (!w || !w.ok) { toast((w && w.error) || "?", "error"); return; }
          toast(T("fotos.d_tour_dazu", "Zur Tour „{n}“ genommen.").replace("{n}", x.name), "info");
          tourenNeu(box, d);
        };
      });
    };
  }
  async function tourenNeu(box, d) {
    const r = await api().fotos_details(d.path).catch(() => null);   // warte-ok: nur Datenbank
    const ziel = box.querySelector("#foto-d-touren");
    if (!r || !r.ok || !ziel) return;
    ziel.innerHTML = tourenHtml(r.foto.tour || null);
    tourenBinden(box, r.foto);
    if (window.rzTourSeite && window.rzTourSeite.offen()) window.rzTourSeite.neuLaden && window.rzTourSeite.neuLaden();
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
    // 04.10.2026 — wer gerade im Suchfeld tippt, behält Fokus, Schreibmarke und das schon Getippte: das Neuzeichnen
    // nach jeder Suche ersetzte das Feld, und nach einer kurzen Pause ging das Weitertippen ins Leere.
    const altFeld = haupt.querySelector("#foto-suche");
    const tippt = !!(altFeld && document.activeElement === altFeld);
    const getippt = altFeld ? altFeld.value : null, marke = tippt ? [altFeld.selectionStart, altFeld.selectionEnd] : null;
    haupt.innerHTML = leisteHtml() + kopfHtml() + `<div class="foto-such-touren" id="foto-such-touren" hidden></div><div class="foto-body" id="foto-body"></div>`;
    const box = haupt.querySelector("#foto-body");
    suchTouren();

    const suche = haupt.querySelector("#foto-suche");
    if (suche && tippt) {
      if (getippt != null) suche.value = getippt;
      suche.focus();
      try { suche.setSelectionRange(marke[0], marke[1]); } catch (_) {}
    }
    if (suche) {
      let tmr = 0;
      suche.oninput = () => {
        clearTimeout(tmr);
        tmr = setTimeout(() => { filter.suche = suche.value.trim(); delete filter.aehnlich; neuLaden(); }, 260);
      };
      // Enter sucht sofort (04.10.2026, Marc: „es passiert gar nichts, wenn ich … Enter tippe")
      suche.onkeydown = (e) => {
        if (e.key !== "Enter") return;
        clearTimeout(tmr);
        filter.suche = suche.value.trim(); delete filter.aehnlich; neuLaden();
      };
    }
    const dbChip = haupt.querySelector("#foto-db-chip");
    if (dbChip) dbChip.onclick = () => { filter = Object.assign({}, filter); delete filter.von; delete filter.bis; navZeichnen(); zeichnen(); neuLaden(); };
    const reset = haupt.querySelector("#foto-reset");
    if (reset) reset.onclick = () => { filter = {}; navZeichnen(); neuLaden(); };
    const exOben = haupt.querySelector("#foto-export-oben");
    if (exOben) exOben.onclick = () => exportMenue(exOben, auswahl ? geladen.find(x => x.path === auswahl) : null);
    const obChip = haupt.querySelector("#foto-ob-chip");
    if (obChip) obChip.onclick = () => { filter = Object.assign({}, filter); delete filter.verz; navZeichnen(); zeichnen(); neuLaden(); };
    const aeChip = haupt.querySelector("#foto-aehnlich-chip");
    if (aeChip) aeChip.onclick = () => { filter = Object.assign({}, filter); delete filter.aehnlich; zeichnen(); neuLaden(); };
    inhaltBinden(haupt);
    haupt.querySelectorAll("[data-fview]").forEach(b => {
      b.onclick = () => {
        if (ansicht === b.dataset.fview) return;
        ansicht = b.dataset.fview;
        zeichnen();
      };
    });

    fernKnopfBinden(haupt);   // 18.09.2026 — „Nochmal versuchen" im Laufwerk-Hinweis
    kopfOhneBinden(haupt);
    const kopfScan = haupt.querySelector("#foto-kopf-scan");
    if (kopfScan) kopfScan.onclick = () => scanStarten();
    const kopfStop = haupt.querySelector("#foto-kopf-stop");
    if (kopfStop) kopfStop.onclick = () => { abgebrochen = true; api().fotos_scan_stop(); };

    if (ansicht === "karte") karteZeichnen(box);
    else if (ansicht === "touren") tourenZeichnen(box);
    else rasterZeichnen(box);
  }

  async function mount(hauptEl, navEl) {
    haupt = hauptEl; nav = navEl; angemeldet = true;
    albenLaden();   // 09.10.2026 — Alben links (still nachgeladen)
    // Jeder Schritt sagt, was er tut: bei zehntausenden Dateien dauert das
    // sonst lange genug, dass man die App für tot hält.
    const schritt = (text) => {
      if (haupt) {
        haupt.innerHTML = `<div class="lib-detail-empty" style="padding:20px">
          <div>${esc(text)}</div>
          <div class="muted" style="margin-top:6px">${T("fotos.laden_hinweis", "Der Bestand liegt in der Bibliothek — das geht auch ohne das Laufwerk.")}</div>
        </div>`;
      }
      if (window.rzStatus) {
        if (!window.rzStatus.laeuft("foto-oeffnen")) {
          // 06.10.2026 (Marc: „Fotos erste Seite holen … richtig lang", „auf Touren geklickt …") — ohne `hintergrund`
          // war das ein SPERRENDES Fenster: bis die erste Seite da war, gingen alle Klicks ins Leere. Der Bereich zeigt
          // ohnehin, was passiert; man darf währenddessen woandershin.
          window.rzStatus.start("foto-oeffnen", { titel: T("fotos.titel", "Medien"), text: text, hintergrund: true });
        } else {
          window.rzStatus.schritt("foto-oeffnen", { text: text });
        }
      }
    };
    try {
      const st = await api().settings_get();
      autoAn = (st && st.fotos_auto) !== false;
    } catch (_) { autoAn = true; }
    // 06.10.2026 (Marc: „im Archiv, wenn man auf Fotos geht, muss er immer erst lesen. das dauert immer eine weile") —
    // vorher nacheinander: Ordner (mit Zählungen je Ordner), Kameras/Jahre/Bestand, erst dann die erste Seite; neben
    // einem laufenden Einlesen mehrere Sekunden leerer Kasten. Jetzt: war man schon hier, steht die letzte Ansicht
    // SOFORT da; die erste Seite (die schnellste Abfrage) kommt zuerst, Ordner und Filterwerte gleichzeitig dazu.
    let schonDa = geladen.length > 0;
    // 07.10.2026 (Marc: „das Letzte, was da war, cachen und direkt anzeigen und gleichzeitig sagen: neue Seite wird
    // geholt“) — erstes Öffnen in dieser Sitzung: den gemerkten Stand (Datei, ohne Datenbank) sofort zeigen.
    let ausSpeicher = false;
    if (!schonDa) {
      const m = await api().fotos_letzter_stand().catch(() => null);   // warte-ok: liest nur eine Datei, Millisekunden
      if (!angemeldet) return;
      if (m && m.ok && !m.leer) {
        if (m.ordner) { ordner = m.ordner.ordner || []; stand = m.ordner.stand || {}; nachschau = m.ordner.nachschau || null; }
        if (m.werte) { letzteWerte = { kameras: m.werte.kameras || [], jahre: m.werte.jahre || [] }; if (!m.ordner) stand = m.werte.stand || {}; }
        if (m.datumsbaum && !dbTage) dbTage = m.datumsbaum;          // Schlüssel bleibt leer → wird gleich frisch geholt
        if (m.ordnerbaum && !obDaten) obDaten = m.ordnerbaum;
        const ohneFilter = !Object.keys(filter).some(k => filter[k] != null && filter[k] !== "");
        if (ohneFilter && m.seite && (m.seite.fotos || []).length) {
          geladen = m.seite.fotos; gesamt = m.seite.n || geladen.length; gesamtOhneGps = m.seite.ohne_koordinate ?? null;
          ausSpeicher = schonDa = true;
        }
      }
    }
    if (schonDa) {
      if (letzteWerte) { haupt._kameras = letzteWerte.kameras; haupt._jahre = letzteWerte.jahre; }
      navZeichnen();
      zeichnen();
      if (ausSpeicher) altStandZeigen(true);
      thumbsNachholen();
    } else {
      schritt(T("fotos.laden_seite_kurz", "Erste Seite holen …"));
    }
    ordnerLaedt = true;
    if (!schonDa) navZeichnen();   // Seitenleiste sofort mit Ladeanzeige, nicht leer
    const ordnerHolen = api().fotos_ordner().catch(() => null).then((r) => {
      if (r && r.ok && angemeldet) { ordner = r.ordner || []; stand = r.stand || {}; nachschau = r.nachschau || null; }
    }).finally(() => { ordnerLaedt = false; });
    const werteHolen = filterwerteLaden();
    const vorher = JSON.stringify([letzteWerte, stand.gesamt]);
    await neuLaden(true);
    altStandZeigen(false);   // neue Seite da (oder fehlgeschlagen) — Hinweis weg
    if (!angemeldet) return;
    await Promise.all([ordnerHolen, werteHolen]);
    if (!angemeldet) return;
    navZeichnen();
    // Kopf mit Kamera-/Jahr-Auswahl und Zahlen nur neu, wenn sich etwas geändert hat (sonst flackert das Raster)
    if (JSON.stringify([letzteWerte, stand.gesamt]) !== vorher && !nachladend) zeichnen();
    if (window.rzStatus) {   // Audit K-4: wie oben — neben einem laufenden Einlesen kein „Fertig"-Kasten
      if (window.rzStatus.laeuft("foto-scan")) window.rzStatus.ende("foto-oeffnen");
      else window.rzStatus.fertig("foto-oeffnen", "");
    }
    if (!angemeldet) return;
    fernBeobachten();
    pfadeUmziehenAnbieten();   // 05.10.2026 — Laufwerk unter anderem Namen? einmal je Sitzung fragen
    if (autoAn) aufholen();
    inhaltLaden(true);
    // Läuft gerade ein Scan (etwa aus einer früheren Sitzung im Hintergrund),
    // zeigt die Leiste ihn sofort an, statt ihn zu verschweigen.
    try {
      const st = await api().fotos_scan_status();
      if (st && st.running) scanBeobachten();
    } catch (_) {}
  }

  /** Hinweis über dem Raster, solange der gemerkte Stand zu sehen ist und die frische Seite geholt wird. */
  function altStandZeigen(an) {
    if (!haupt) return;
    let el = haupt.querySelector(".foto-alt-stand");
    if (!an) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement("div");
      el.className = "foto-alt-stand";
      el.innerHTML = `<span class="ass-spinner"></span> ${esc(T("fotos.neue_seite", "Letzter Stand — neue Seite wird geholt …"))}`;
      haupt.prepend(el);
    }
  }

  function unmount() {
    // 09.10.2026 (Marc: „wenn ein Bild groß angezeigt wird und ich das Modul wechsle, bleibt das Bild groß stehen“) —
    // die Lupe hängt am <body>, nicht im Archiv; sie geht mit dem Archiv (Rezept wird dabei gespeichert)
    try { grossZu(); } catch (_) {}
    angemeldet = false;
    try { if (window.rzStatus && window.rzStatus.laeuft("foto-oeffnen")) window.rzStatus.ende("foto-oeffnen"); } catch (_) {}
    thumbLauf++;                // ein laufendes Nachholen von Bildern beenden
    clearTimeout(fernWache);
    if (fussWache) { try { fussWache.disconnect(); } catch (_) {} fussWache = null; }
    rasterBox = null;
    clearTimeout(scanTimer);
    clearInterval(inhaltTimer); inhaltTimer = 0;
    if (karte) { try { karte.remove(); } catch (_) {} }
    karte = null; karteLib = null; karteBereit = false;
    haupt = null; nav = null;
  }

  window.rzFotos = { mount, unmount, neuLaden, scanStarten,
    // 08.10.2026 — für die Tour-Seite (ui/js/tourseite.js): Detailspalte und Großansicht eines Mediums
    detailFuer: (pfad) => detailZeigen({ path: pfad }),
    // 08.10.2026 — „Alle ansehen“ aus der gemeinsamen Suche: Nach Touren, gefiltert
    zeigeTouren: (text) => { _tourenSuche = String(text || ""); ansicht = "touren"; zeichnen(); },
    gross: (pfad, liste) => {
      const l = (liste || []).map(x => (typeof x === "string" ? { path: x } : x));
      grossOeffnen(l.find(x => x.path === pfad) || { path: pfad }, l);
    } };
})();
