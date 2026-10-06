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
  // 04.10.2026 (IDEAS §81) — Inhaltssuche: Stand vom Backend, Zählung der letzten Suche, Sortierung der Treffer
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
      <div class="lib-nav-title">${T("fotos.titel", "Medien")}</div>
      <div class="lib-nav-hint">${T("fotos.nav_hint2", "Ordner mit Fotos und Videos. Die App liest nur — Dateien ändert sie nur, wenn du ein Foto selbst bearbeitest, und sichert es vorher.")}</div>
      ${zeile("🖼", T("fotos.alle", "Alle"), s.gesamt || 0, "alle", !filter.gps && !filter.art && !filter.ohne_zeit && !filter.mit_fehlenden && !filter.von)}
      ${zeile("📷", T("fotos.nur_fotos", "Nur Fotos"), s.fotos || 0, "fotos", filter.art === "foto")}
      ${zeile("🎬", T("fotos.nur_videos", "Nur Videos"), s.videos || 0, "videos", filter.art === "video")}
      ${zeile("📍", T("fotos.ohne_koordinate", "Ohne Koordinate"), s.ohne_koordinate || 0, "ohne_gps", filter.gps === "ohne")}
      ${zeile("🕐", T("fotos.ohne_zeit", "Ohne Aufnahmezeit"), s.ohne_zeit || 0, "ohne_zeit", !!filter.ohne_zeit)}
      ${(s.fehlt || 0) ? zeile("❓", T("fotos.fehlende", "Nicht erreichbar"), s.fehlt, "fehlend", !!filter.mit_fehlenden) : ""}

      ${datumsBaumRahmen()}
      ${ordnerBaumRahmen()}
      <div class="lib-nav-title" style="margin-top:14px">${T("fotos.ordner_titel", "Fotoordner")}</div>
      <div id="foto-ordner-liste"></div>
      <button class="btn btn-primary btn-sm" id="foto-ordner-add" type="button" style="margin-top:6px;white-space:nowrap">
        📂 ${T("fotos.ordner_add", "Ordner hinzufügen …")}</button>
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
        delete filter.art; delete filter.gps; delete filter.ohne_zeit; delete filter.mit_fehlenden;
        if (w === "alle") { delete filter.von; delete filter.bis; delete filter.verz; }   // 04.10.2026 — wie „Alle Fotos" in Lightroom
        if (w === "fotos") filter.art = "foto";
        else if (w === "videos") filter.art = "video";
        else if (w === "ohne_gps") filter.gps = "ohne";
        else if (w === "ohne_zeit") filter.ohne_zeit = true;
        else if (w === "fehlend") filter.mit_fehlenden = true;
        navZeichnen();
        if (w === "alle") zeichnen();
        neuLaden();
      };
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
    return rzBaum.kopfHtml("foto-db-kopf", auf, "📅", T("fotos.nach_datum", "Nach Datum"))
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
    return rzBaum.kopfHtml("foto-ob-kopf", auf, "📁", T("fotos.nach_ordner", "Nach Ordner"))
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
      let neu = 0;
      geladen.forEach((f) => {
        if (!f.thumb_url && bilder[f.path]) { f.thumb_url = bilder[f.path]; neu++; }
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

  // ── Inhaltssuche (04.10.2026, IDEAS §81) ───────────────────────────────
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
    if (l.error && !l.abbruch) return "⚠ " + T("fotos.inh_fehler", "Inhaltssuche: {f}").replace("{f}", String(l.error).slice(0, 120));
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
    return `🔍 ${esc(t)} ${typeof helpTip === "function" ? helpTip(tip) : ""}` + inhaltKnopfHtml()
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
      return `<div class="foto-inh-kopf">🔍 ${esc(teile.join(" · "))}${unvoll}
        <span class="lib-views foto-inh-sort" role="group">
          <button class="lib-view${sortierung === "relevanz" ? " is-on" : ""}" type="button" data-inh-sort="relevanz">${esc(T("fotos.inh_sort_relevanz", "Beste zuerst"))}</button>
          <button class="lib-view${sortierung !== "relevanz" ? " is-on" : ""}" type="button" data-inh-sort="zeit_neu">${esc(T("fotos.inh_sort_datum", "Nach Datum"))}</button>
        </span></div>`;
    }
    const l = inhalt.lauf || {};
    if (inhalt.an && l.running) return `<div class="foto-inh-kopf muted">🔍 ${esc(inhaltStandText())}</div>`;
    if (inhalt.an || inhaltNichtJetzt() || !filter.suche) return "";
    // 04.10.2026 (Marc: „kann ich beim 1. Aktivieren schon auswählen, ob ich das große oder das kleine Modell haben
    // will?") — zwei Knöpfe statt einem; die Wahl bleibt in den Einstellungen änderbar.
    const vs = inhalt.varianten || {};
    const vb = vs.base || {}, vg = vs.gross || {};
    return `<div class="foto-inh-angebot">
      <div><b>🔍 ${esc(T("fotos.inh_angebot_titel", "Auch nach dem suchen, was auf den Fotos zu sehen ist?"))}</b></div>
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
    const kameras = haupt._kameras || [];
    const jahre = haupt._jahre || [];
    const opt = (wert, text, aktiv) =>
      `<option value="${esc(wert)}"${String(aktiv || "") === String(wert) ? " selected" : ""}>${esc(text)}</option>`;
    return `
      <div class="lib-bar foto-bar">
        <input type="search" id="foto-suche" class="lib-search" value="${esc(filter.suche || "")}"
               placeholder="${inhalt && inhalt.an ? T("fotos.suche_ph_inhalt", "Suchen — auch nach Bildinhalt: „Sonnenuntergang“, „Hund am Strand“ …")
                                                    : T("fotos.suche_ph", "Suchen — Dateiname, Kamera, Objektiv, Stichwort, Ort …")}">
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
        ${filter.aehnlich ? `<button class="lib-chip is-on foto-db-chip" id="foto-aehnlich-chip" type="button" title="${esc(T("fotos.inh_aehnlich_weg", "Ähnlich-Suche aufheben"))}">🔍 ${esc(T("fotos.inh_aehnlich_chip", "Ähnlich wie {n}").replace("{n}", String(filter.aehnlich).split(/[\\/]/).pop()))} ✕</button>` : ""}
        ${filter.verz ? `<button class="lib-chip is-on foto-db-chip" id="foto-ob-chip" type="button" title="${esc(obTitel(filter.verz) + " — " + T("fotos.ob_chip_weg", "Ordnerfilter aufheben"))}">📁 ${esc(obTitel(filter.verz))} ✕</button>` : ""}
        ${datumsFilterText() ? `<button class="lib-chip is-on foto-db-chip" id="foto-db-chip" type="button" title="${esc(T("fotos.db_chip_weg", "Datumsfilter aufheben"))}">📅 ${esc(datumsFilterText())} ✕</button>` : ""}
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
    // 25.09.2026 (Klicktest FO-05: „1 Dateien · 8 ohne Koordinate" bei EINEM Treffer) — Einzahl
    // und die Zahl ohne Koordinate aus der gefilterten Menge, nicht aus dem ganzen Bestand.
    const teile = [gesamt === 1 ? T("fotos.kopf_one", "1 Datei")
                                : T("fotos.kopf", "{n} Dateien").replace("{n}", num(gesamt))];
    if (stand.ungelesen) teile.push(T("fotos.kopf_offen", "{n} noch ohne Aufnahmedaten").replace("{n}", num(stand.ungelesen)));
    if (stand.ohne_bild) teile.push(T("fotos.kopf_ohne_bild", "{n} noch ohne Vorschaubild").replace("{n}", num(stand.ohne_bild)));
    const ohneGps = gesamtOhneGps != null ? gesamtOhneGps : (stand.ohne_koordinate || 0);
    if (ohneGps) teile.push(T("fotos.kopf_ohne_gps", "{n} ohne Koordinate").replace("{n}", num(ohneGps)));
    return `<div class="lib-head" id="foto-kopf">${fernHtml()}${esc(teile.join(" · "))}${kopfArbeitHtml()}${inhaltKopfHtml()}</div>`;
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
    if (lw.alternativ) return { punkt: "⚠️", klasse: "anders", text: T("fotos.lw_anders_kurz", "unter anderem Namen eingehängt") };
    if (o.da) return { punkt: "🟢", klasse: "da", text: T("fotos.lw_verbunden", "verbunden") };
    if (lw.verbunden && lw.lesbar == null) return { punkt: "⚠️", klasse: "haengt", text: T("fotos.lw_haengt", "verbunden, antwortet aber nicht") };
    if (lw.art === "intern") return { punkt: "📴", klasse: "weg", text: T("fotos.lw_ordner_fehlt", "Ordner nicht gefunden") };
    return { punkt: "📴", klasse: "weg", text: T("fotos.lw_getrennt", "nicht verbunden") };
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
                    title="${esc(T("fotos.lw_verbinden_tip", "Öffnet {u} wie ⌘K im Finder — ein Passwort fragt das System selbst ab.").replace("{u}", lw.url))}">🔌 ${T("fotos.lw_verbinden", "Verbinden")}</button>` : ""}
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
          `<div title="${esc(o.path)}">📴 ${esc(ordnerTitel(o))} <span class="muted">${num(o.n)}</span></div>`).join("")}</div>`
      : "";
    // 04.10.2026 — „Verbinden" auch hier (der erste fehlende Ordner auf einem Netzlaufwerk mit bekannter Adresse)
    const verbIdx = ordner.findIndex(o => !o.da && o.laufwerk && !o.laufwerk.verbunden && !o.laufwerk.alternativ && o.laufwerk.art === "netz" && o.laufwerk.url);
    const verbKnopf = verbIdx >= 0
      ? `<button class="btn btn-sm btn-primary foto-lw-verbinden" id="foto-fern-verbinden" data-fverb="${verbIdx}" type="button">🔌 ${T("fotos.lw_verbinden", "Verbinden")}</button> ` : "";
    // 18.09.2026 (Marc: „da bräuchte es noch einen Knopf für Nochmal versuchen") — nicht 20 s auf die Wache warten
    return `<div class="foto-fern" id="foto-fern">
        <div class="foto-fern-titel">📴 ${esc(titel)}
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
    const r = await rzWarten("fotos_fern_nochmal", () => api().fotos_ordner()).catch(() => null);
    if (r && r.ok) { ordner = r.ordner || []; stand = r.stand || stand; nachschau = r.nachschau || nachschau; }
    const jetzt = ordner.filter(o => !o.da).length;
    navZeichnen();
    kopfAuffrischen();
    if (!r || !r.ok) toast(T("fotos.fern_nochmal_fehler", "Konnte nicht nachsehen — bitte gleich noch einmal."), "error", 4000);
    else if (jetzt < vorher) { if (autoAn) aufholen(true); else toast(aufholText({ grund: "abgeschaltet" }), "success", 7000); }
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
  /** 05.10.2026 (IDEAS §82 Schritt 1) — liegen die Fotos eines fehlenden Laufwerks unter einem anderen Namen
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
      return ` <span class="foto-kopf-fehler">⚠ ${esc(T("fotos.kopf_fehler", "Einlesen abgebrochen: {f}")
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
    inhaltBinden(neu);
  }

  /* 04.10.2026 (Marc: „warum haben die Fotos links unten solche Zeitstempel? Es sieht aus, als wären es Videos" —
     „die Kachel soll sauber bleiben, beim Drüberfahren muss es gar nichts anzeigen; nur beim Draufklicken wird die
     rechte Seite verändert") — keine Uhrzeit und kein Tooltip auf der Kachel. Zahl auf der Kachel = Videolänge (▶).
     Auch das „!" für fehlende Daten ist weg (Marc: „ja weg mit !") — Fehlendes zeigen die Filter links
     („Ohne Koordinate", „Ohne Aufnahmezeit") und rechts die Befunde. Name und Aufnahmedaten stehen in der Detailspalte. Für Screenreader trägt die Kachel
     Dateinamen und Befund als aria-label. */
  function kachelHtml(f, i) {
    const m = maengel(f);
    const bild = f.thumb_url
      ? `<img loading="lazy" src="${f.thumb_url}" alt="">`
      : `<div class="foto-kachel-leer">${f.art === "video" ? "🎬" : "🖼"}</div>`;
    return `
      <button class="foto-kachel${auswahl === f.path ? " is-on" : ""}" type="button" data-foto="${i}"
              aria-label="${esc(f.dateiname)}${m.length ? " — " + esc(m.join(", ")) : ""}">
        ${bild}
        ${f.art === "video" ? `<span class="foto-kachel-art">▶ ${esc(dauerText(f.dauer_s))}</span>` : ""}
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
          <span class="muted">${num(g.fotos.length)}</span></div>
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

  function rasterVerdrahten(box, ab) {
    box.querySelectorAll("[data-foto]").forEach(b => {
      if (+b.dataset.foto < ab) return;
      b.onclick = () => detailZeigen(geladen[+b.dataset.foto]);
      b.ondblclick = () => grossOeffnen(geladen[+b.dataset.foto]);   // 04.10.2026 — Großansicht
    });
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
        const r2 = await rzWarten("fotos_einer_tour", () => api().fotos_einer_tour(g.geo_hash || "", g.path || "")).catch(() => null);
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

  /** Die große Karte ganz abbauen (25.09.2026 — Rückfallweg, wenn das Umhängen scheitert). */
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
        styleKey: (typeof mapDefaultStyle === "function") ? mapDefaultStyle() : undefined,
        common: { center: hatOrt ? [+d.lon, +d.lat] : (linie ? linie[0] : (ortVorschlag() || [10.4, 51.2])), zoom: hatOrt ? 12 : (linie ? 8 : (ortVorschlag() ? 11 : 4.5)),
                  attributionControl: true, interactive: true },   // 15.09.2026: Quellenleiste auf allen Karten
      });
      dKarte = created.map; lib = created.lib;
      window.__fotoDKarte = dKarte;          // Prüfstand
    } catch (_) { return; }
    const m = dKarte;
    m.on("load", () => {
      if (linie) {
        m.addSource("d-spur", { type: "geojson",
          data: { type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: teile } } });
        m.addLayer({ id: "d-spur-linie", type: "line", source: "d-spur",
                     layout: { "line-cap": "round", "line-join": "round" },
                     paint: { "line-color": "#2f7fd1", "line-width": 3, "line-opacity": 0.9 } });
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
        if (hatOrt || linie) m.fitBounds(b, { padding: 28, maxZoom: hatOrt && !linie ? 13 : 12, duration: 0 });
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
  function grossOeffnen(f) {
    if (!f) return;
    const liste = geladen.length ? geladen : [f];
    let idx = liste.findIndex(x => x.path === f.path);
    if (idx < 0) { liste.unshift(f); idx = 0; }
    if (!gross) {
      const el = document.createElement("div");
      el.className = "foto-gross"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true");
      el.innerHTML = `<button type="button" class="foto-gross-zu" title="${esc(T("fotos.gross_zu", "Schließen (Esc)"))}">✕</button>
        <button type="button" class="foto-gross-pfeil foto-gross-links" title="←">‹</button>
        <button type="button" class="foto-gross-pfeil foto-gross-rechts" title="→">›</button>
        <div class="foto-gross-buehne"></div>
        <div class="foto-gross-hinweis" hidden></div>
        <div class="foto-gross-leiste"><span class="foto-gross-name"></span><span class="foto-gross-knoepfe"></span></div>`;
      document.body.appendChild(el);
      el.querySelector(".foto-gross-zu").onclick = grossZu;
      el.querySelector(".foto-gross-links").onclick = () => grossBlaettern(-1);
      el.querySelector(".foto-gross-rechts").onclick = () => grossBlaettern(1);
      el.addEventListener("click", (e) => { if (e.target === el || e.target.classList.contains("foto-gross-buehne")) grossZu(); });
      document.addEventListener("keydown", grossTasten, true);
      gross = { el, liste, idx };
    } else { gross.liste = liste; gross.idx = idx; }
    grossZeigen();
  }
  function grossZu() {
    if (!gross) return;
    const v = gross.el.querySelector("video"); if (v) { try { v.pause(); v.removeAttribute("src"); v.load(); } catch (_) {} }
    gross.el.remove(); document.removeEventListener("keydown", grossTasten, true); gross = null;
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
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); grossZu(); }
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
    buehne.innerHTML = f.thumb_url ? `<img class="foto-gross-bild is-vorschau" src="${f.thumb_url}" alt="">` : `<div class="muted">${esc(T("common.loading", "Lädt …"))}</div>`;
    g.el.querySelector(".foto-gross-links").disabled = g.idx <= 0;
    g.el.querySelector(".foto-gross-rechts").disabled = g.idx >= g.liste.length - 1;
    g.el.querySelector(".foto-gross-name").textContent = [f.dateiname, f.tag_lokal ? `${tagText(f.tag_lokal)} ${uhrzeit(f)}` : ""].filter(Boolean).join(" · ");
    const r = await api().fotos_gross(f.path).catch(() => null);
    if (gross !== g || g.liste[g.idx] !== f) return;   // inzwischen weitergeblättert
    const knoepfe = [];
    if (r && r.ok && r.art === "video" && r.quelle === "original") {
      buehne.innerHTML = `<video class="foto-gross-video" controls autoplay playsinline src="${r.url}"></video>`;
      const v = buehne.querySelector("video");
      v.addEventListener("error", () => videoGehtNicht(f, hinweis), { once: true });
      knoepfe.push(`<button type="button" class="btn btn-sm" data-gk="standbild">📸 ${esc(T("fotos.standbild", "Standbild speichern"))}</button>`);
    } else if (r && r.ok) {
      buehne.innerHTML = `<img class="foto-gross-bild" src="${r.url}" alt="">`;
      if (r.quelle === "bibliothek") { hinweis.hidden = false; hinweis.textContent = T("fotos.gross_fern", "Original gerade nicht erreichbar — gezeigt wird die Vorschau aus der Bibliothek."); }
    } else if (r && r.error) { hinweis.hidden = false; hinweis.textContent = r.error; }
    if (r && r.original_da !== false) {
      knoepfe.push(`<button type="button" class="btn btn-sm" data-gk="finder">${esc(T("fotos.im_finder", "Im Finder zeigen"))}</button>`);
      knoepfe.push(`<button type="button" class="btn btn-sm" data-gk="app">${esc(T("fotos.mit_app", "Mit Standard-App öffnen"))}</button>`);
    }
    const kb = g.el.querySelector(".foto-gross-knoepfe"); kb.innerHTML = knoepfe.join("");
    kb.querySelectorAll("[data-gk]").forEach(b => {
      b.onclick = async () => {
        const w = b.dataset.gk;
        if (w === "finder") api().reveal_in_finder(f.path);
        else if (w === "app") api().open_path(f.path);
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
  document.addEventListener("keydown", (e) => {
    if (gross || e.key !== " " || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target; if (t && (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable)) return;
    if (!angemeldet || !auswahl || !haupt || !haupt.offsetParent) return;
    if (document.querySelector(".modal-overlay:not([hidden]), #modal-overlay:not([hidden])")) return;
    const f = geladen.find(x => x.path === auswahl); if (!f) return;
    e.preventDefault(); grossOeffnen(f);
  });
  window.__rzFotoGross = { oeffnen: (p) => grossOeffnen(geladen.find(x => x.path === p) || { path: p }), zu: () => grossZu(), offen: () => !!gross };   // Prüfstand

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
        ${d.thumb_url ? `<button type="button" class="foto-detail-bild-knopf" id="foto-d-gross" title="${esc(T("fotos.gross_oeffnen", "Groß ansehen (Leertaste)"))}"><img class="foto-detail-bild" src="${d.thumb_url}" alt=""></button>` : ""}
        <div class="foto-detail-kopf">${esc(d.dateiname || "")}
          <button type="button" class="btn btn-sm foto-d-gross-knopf" id="foto-d-gross2">${d.art === "video" ? "▶ " + esc(T("fotos.video_abspielen", "Abspielen")) : "🔍 " + esc(T("fotos.gross", "Groß ansehen"))}</button>
          ${inhalt && inhalt.an && inhalt.modell_da ? `<button type="button" class="btn btn-sm" id="foto-d-aehnlich">🖼 ${esc(T("fotos.inh_aehnliche", "Ähnliche Fotos"))}</button>` : ""}</div>
        ${d.datei_da === false ? `<div class="foto-fern foto-fern-klein">📴 ${T("fotos.d_fern", "Original gerade nicht erreichbar — Vorschau und Aufnahmedaten kommen aus der Bibliothek.")}</div>` : ""}
        ${befunde ? befundeHtml(befunde)
                  : (m.length ? `<div class="foto-detail-warn">⚠ ${esc(m.join(" · "))}</div>` : "")}
        <div class="foto-d-karte" id="foto-d-karte" hidden></div>
        <div class="foto-d-ort-hinweis muted" id="foto-d-ort-hinweis"></div>
        <div class="foto-d-ort-neu" id="foto-d-ort-neu" hidden></div>
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
        <details class="foto-detail-edit" id="foto-d-edit">
          <summary>✎ ${T("fotos.edit_titel", "Aufnahmedaten bearbeiten")}</summary>
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
    const grossK = box.querySelectorAll("#foto-d-gross, #foto-d-gross2");
    grossK.forEach(k => { k.onclick = () => grossOeffnen(d); });
    const edit = box.querySelector("#foto-d-edit");
    if (edit) edit.addEventListener("toggle", () => { if (edit.open) editorLaden(d); });
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
    // 04.10.2026 — wer gerade im Suchfeld tippt, behält Fokus, Schreibmarke und das schon Getippte: das Neuzeichnen
    // nach jeder Suche ersetzte das Feld, und nach einer kurzen Pause ging das Weitertippen ins Leere.
    const altFeld = haupt.querySelector("#foto-suche");
    const tippt = !!(altFeld && document.activeElement === altFeld);
    const getippt = altFeld ? altFeld.value : null, marke = tippt ? [altFeld.selectionStart, altFeld.selectionEnd] : null;
    haupt.innerHTML = leisteHtml() + kopfHtml() + `<div class="foto-body" id="foto-body"></div>`;
    const box = haupt.querySelector("#foto-body");

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
    const bind = (id, feld) => {
      const el = haupt.querySelector(id);
      if (el) el.onchange = () => {
        const v = el.value;
        if (v) filter[feld] = (feld === "jahr") ? +v : v; else delete filter[feld];
        if (feld === "jahr") { delete filter.von; delete filter.bis; }   // 04.10.2026 — nur eine Datumsauswahl gleichzeitig
        navZeichnen();
        neuLaden();
      };
    };
    bind("#foto-jahr", "jahr");
    bind("#foto-kamera", "kamera");
    bind("#foto-gps", "gps");
    const dbChip = haupt.querySelector("#foto-db-chip");
    if (dbChip) dbChip.onclick = () => { filter = Object.assign({}, filter); delete filter.von; delete filter.bis; navZeichnen(); zeichnen(); neuLaden(); };
    const reset = haupt.querySelector("#foto-reset");
    if (reset) reset.onclick = () => { filter = {}; navZeichnen(); neuLaden(); };
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
    const schonDa = geladen.length > 0;
    if (schonDa) {
      if (letzteWerte) { haupt._kameras = letzteWerte.kameras; haupt._jahre = letzteWerte.jahre; }
      navZeichnen();
      zeichnen();
      thumbsNachholen();
    } else {
      schritt(T("fotos.laden_seite_kurz", "Erste Seite holen …"));
    }
    const ordnerHolen = api().fotos_ordner().catch(() => null).then((r) => {
      if (r && r.ok && angemeldet) { ordner = r.ordner || []; stand = r.stand || {}; nachschau = r.nachschau || null; }
    });
    const werteHolen = filterwerteLaden();
    const vorher = JSON.stringify([letzteWerte, stand.gesamt]);
    await neuLaden(true);
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
    pfadeUmziehenAnbieten();   // 05.10.2026 (IDEAS §82) — Laufwerk unter anderem Namen? einmal je Sitzung fragen
    if (autoAn) aufholen();
    inhaltLaden(true);
    // Läuft gerade ein Scan (etwa aus einer früheren Sitzung im Hintergrund),
    // zeigt die Leiste ihn sofort an, statt ihn zu verschweigen.
    try {
      const st = await api().fotos_scan_status();
      if (st && st.running) scanBeobachten();
    } catch (_) {}
  }

  function unmount() {
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

  window.rzFotos = { mount, unmount, neuLaden, scanStarten };
})();
