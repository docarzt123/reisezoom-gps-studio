/* Logbuch-Ansicht — EIN Baustein für die Tour-Seite, später Video-Assistent und Animator (11.10.2026).
 *
 * Marc (11.10.2026): „Das Logbuch ist im Inspektor eigentlich falsch aufgehoben … das gehört doch zur Tour, sodass
 * man das in allen Modulen nutzen kann.“ Die Daten liegen je Tour in der
 * Bibliothek (Einteilung), gelesen über `logbuch_lesen`, Namen/Notizen/Art über `einteilung_aktion` — was man hier
 * setzt, sieht man überall. Profi-Werkzeuge (Teilen, Grenzen ziehen) bleiben im GPX-Inspektor.
 *
 *   const lb = rzLogbuchAnsicht.zeichnen(box, { path, onWahl: (eintrag) => …, onDaten: (daten) => …, onGeaendert: () => … });
 *   lb.waehlen(id) · lb.neuLaden() · lb.tagEintraege() · lb.daten()
 */
(function () {
  "use strict";
  const T = (k, f, p) => (typeof t === "function" ? t(k, f, p) : (f || k));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const I = (n, g) => (typeof rzIcon === "function" ? rzIcon(n, { size: g || 16 }) : "");
  const sprache = () => { try { return rzSprachCode(); } catch (_) { return undefined; } };

  // Farben wie im Inspektor (modules/gpxinspect/ui/module.js _LB_FARBE), Symbole als Strich-Icons (Lucide, keine Emojis)
  const FARBE = { fahrt: "#3b82f6", uebersetzen: "#14b8a6", gehen: "#22c55e", wanderung: "#22c55e", spaziergang: "#4ade80",
                  rad: "#f97316", laufen: "#eab308", pause: "#6b7280", uebernachtung: "#4b5563", halt: "#9ca3af", unsicher: "#8b8fa3",
                  wassersport: "#0ea5e9", punkt: "#a78bfa", poi: "#fbbf24", hoechster_punkt: "#c084fc", start: "#2dd4bf", ziel: "#2dd4bf" };
  const SYMBOL = { fahrt: "car", uebersetzen: "ship", gehen: "footprints", wanderung: "footprints", spaziergang: "footprints",
                   rad: "bike", laufen: "activity", pause: "coffee", uebernachtung: "moon", halt: "pause", unsicher: "circle-help",
                   wassersport: "sailboat", punkt: "map-pin", poi: "star", hoechster_punkt: "mountain", start: "flag", ziel: "flag" };
  const ARTEN_DE = { fahrt: "Fahrt", uebersetzen: "Fähre", gehen: "Gehen", wanderung: "Wanderung", spaziergang: "Spaziergang",
                     rad: "Rad", laufen: "Laufen", pause: "Pause", uebernachtung: "Übernachtung", halt: "Halt",
                     unsicher: "Rad oder Laufen?", wassersport: "Wassersport", hoechster_punkt: "Höchster Punkt", start: "Start",
                     ziel: "Ziel", punkt: "Eigener Punkt", poi: "Sehenswürdigkeit" };
  // 16.10.2026 — Arten, die man von Hand setzen kann (wie core/logbuch.HAND_ARTEN und das „Art ändern“ im Inspektor)
  const HAND_ARTEN = ["fahrt", "uebersetzen", "wanderung", "spaziergang", "rad", "laufen", "wassersport", "pause"];
  const artName = (a) => T("logbuch.art." + a, ARTEN_DE[a] || a);
  const farbe = (a) => FARBE[a] || "#8b8fa3";
  const symbol = (a) => I(SYMBOL[a] || "map-pin", 17);

  const datum = (t0, v) => new Date((t0 + (v || 0) * 60) * 1000);
  function uhr(t0, v) { try { return datum(t0, v).toLocaleTimeString(sprache(), { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }); } catch (_) { return ""; } }
  function tagText(t0, v, opt) { try { return datum(t0, v).toLocaleDateString(sprache(), Object.assign({ timeZone: "UTC" }, opt)); } catch (_) { return ""; } }
  function dauer(s) {
    s = Math.max(0, Math.round(s || 0));
    const h = Math.floor(s / 3600), m = Math.round((s - h * 3600) / 60);
    if (h && m) return T("logbuch.dauer_hm", "{h} h {m} min", { h, m });
    if (h) return T("logbuch.dauer_h", "{h} h", { h });
    return T("logbuch.dauer_m", "{m} min", { m });
  }
  function km(m) {
    if (!m) return "";
    if (m < 950) return Math.round(m) + " m";
    return (m / 1000).toLocaleString(sprache(), { maximumFractionDigits: m < 20000 ? 1 : 0 }) + " km";
  }
  // Punkte (Start, Ziel, höchster Punkt, eigene, POIs) tragen aus der Einteilung auch t0 == t1 — an der Art erkennen,
  // sonst zeigt die Liste „Start 13:25–13:25 · 0 min“ (Marc, PDF der Rügen-Reise, 22.10.2026)
  const PUNKT_ARTEN = ["start", "ziel", "hoechster_punkt", "punkt", "poi"];
  const istPunkt = (x) => !!x && x.t != null && (x.t0 == null || PUNKT_ARTEN.includes(x.art));

  /** Ort zum Eintrag aus `logbuch_orte` ({von, nach, hier}). */
  function ortVon(orte, x) {
    // 22.10.2026 — „Meine Orte“ gehen vor dem Ortsnamen aus dem Netz („Zu Hause“ statt „Ahrensweg 9“)
    if (x.mein_ort) return { text: x.mein_ort, nach: x.mein_ort, hier: x.mein_ort, mein: true };
    if (x.mein_ort_von || x.mein_ort_nach) {
      const o0 = orte[x.id] || {}, von = x.mein_ort_von || o0.von || "", nach = x.mein_ort_nach || o0.nach || "";
      return { text: von && nach ? von + " → " + nach : (von || nach), nach, hier: von || nach, mein: true };
    }
    const o = orte[x.id]; if (!o) return { text: "", nach: "", hier: "" };
    const hier = o.hier || (o.von && o.von === o.nach ? o.von : "");
    return { text: hier || (o.von && o.nach ? o.von + " → " + o.nach : (o.von || o.nach || "")), nach: o.nach || "", hier: hier || o.von || "" };
  }
  /** Lesbarer Titel: „Fahrt nach Hamburg“, „Spaziergang in Hamburg“, „Start in Norderstedt“. */
  // Im Titel nur der Ort selbst („Laufen in Astorga“) — Region und Land stehen in der Zeile darunter (Marc-Klicktest 11.10.2026)
  const kurzOrt = (v) => String(v || "").split(",")[0].trim();
  function titel(x, orte) {
    if (x.name) return x.name;
    const art = istPunkt(x) ? x.art : (x.anzeige_art || x.art), o0 = ortVon(orte, x), a = artName(art);
    if (x.mein_ort) return T("logbuch.titel_mein_ort", "{art} · {ort}", { art: a, ort: x.mein_ort });
    const o = { hier: kurzOrt(o0.hier), nach: kurzOrt(o0.nach) };
    if (art === "hoechster_punkt") return a + (x.ele != null ? " · " + Math.round(x.ele).toLocaleString(sprache()) + " m" : "");
    if ((art === "fahrt" || art === "uebersetzen" || art === "rad") && o.nach && o.nach !== o.hier) return T("logbuch.titel_nach", "{art} nach {ort}", { art: a, ort: o.nach });
    if (o.hier || o.nach) return T("logbuch.titel_in", "{art} in {ort}", { art: a, ort: o.hier || o.nach });
    return a;
  }

  // 22.10.2026 — gemerkte Logbücher dieser Sitzung (siehe tourseite.js): sofort zeigen, im Hintergrund frisch lesen
  const _lbMerk = new Map(), LB_MERK = 12;
  function zeichnen(box, opt) {
    opt = opt || {};
    const Z = { box, opt, d: null, orte: {}, tag: null, alleTage: false, sel: null, rueck: null, lauf: 0 };

    async function laden(neu) {
      const lauf = ++Z.lauf;
      const alt = !neu ? _lbMerk.get(opt.path) : null;
      if (alt) {   // sofort die gemerkte Fassung
        Z.d = alt.r; Z.orte = alt.orte || {};
        if (Z.tag == null || !(alt.r.tage || []).some((d) => d.nr === Z.tag)) Z.tag = (alt.r.tage && alt.r.tage.length) ? alt.r.tage[0].nr : null;
        render();
        if (opt.onDaten) opt.onDaten(alt.r);
      } else box.innerHTML = `<div class="lba-laedt"><span class="spinner"></span> ${esc(T("logbuch.laedt", "Logbuch wird geladen …"))}</div>`;
      let r = null;
      try { r = await api().logbuch_lesen(opt.path, !!neu); } catch (e) { r = { ok: false, error: String(e) }; }   // warte-ok: Ladeanzeige im Kasten (bzw. gemerkte Fassung)
      if (lauf !== Z.lauf || !box.isConnected) return;
      if (alt && (!r || !r.ok)) return;   // Lesefehler im Hintergrund: die gemerkte Fassung bleibt stehen
      const json = r && r.ok ? JSON.stringify(r) : "";
      if (r && r.ok) { _lbMerk.delete(opt.path); _lbMerk.set(opt.path, { r, json, orte: (alt && alt.orte) || {} }); while (_lbMerk.size > LB_MERK) _lbMerk.delete(_lbMerk.keys().next().value); }
      if (alt && alt.json === json) { _orteNachladen(lauf); return; }
      if (!r || !r.ok) {
        const g = r && r.grund;
        const text = g === "nicht_im_archiv" ? T("logbuch.nicht_im_archiv", "Diese Datei liegt nicht im Archiv — das Logbuch gibt es für Touren im Archiv.")
          : g === "ohne_zeit" ? T("logbuch.ohne_zeit", "Der Track hat keine Zeitstempel — ohne Uhrzeit gibt es kein Logbuch.")
          : ((r && r.error) || "?");
        box.innerHTML = `<div class="lba-leer">${esc(text)}</div>`;
        Z.d = null; if (opt.onDaten) opt.onDaten(null);
        return;
      }
      Z.d = r;
      if (Z.tag == null || !(r.tage || []).some((d) => d.nr === Z.tag)) Z.tag = (r.tage && r.tage.length) ? r.tage[0].nr : null;
      render();
      if (opt.onDaten) opt.onDaten(r);
      _orteNachladen(lauf);
    }
    // Ortsnamen: erst der Cache (sofort), dann bis zu 25 neue im Hintergrund — und mit dem Logbuch merken
    async function _orteNachladen(lauf) {
      const merk = () => { const m = _lbMerk.get(opt.path); if (m) m.orte = Z.orte; };
      try {
        const c = await api().logbuch_orte(opt.path, 0);   // warte-ok: nur Cache
        if (lauf === Z.lauf && c && c.ok && JSON.stringify(c.orte || {}) !== JSON.stringify(Z.orte || {})) { Z.orte = c.orte || {}; merk(); render(); }
        const n = await api().logbuch_orte(opt.path, 25);   // warte-ok: Namen kommen nach, Liste steht schon
        if (lauf === Z.lauf && n && n.ok && JSON.stringify(n.orte || {}) !== JSON.stringify(Z.orte || {})) { Z.orte = n.orte || {}; merk(); render(); }
        // Sehenswürdigkeiten am Weg (22.10.2026: die Tourseite fragte sie nie ab — nur der Track-Inspektor tat das).
        // Je Tour in der Bibliothek gemerkt; neue wichtige landen als Punkte im Logbuch → dann neu lesen.
        if (lauf !== Z.lauf) return;
        const p = await api().logbuch_pois(opt.path, false);   // warte-ok: Logbuch steht schon, Punkte kommen nach
        if (lauf === Z.lauf && box.isConnected && p && p.ok && p.im_logbuch > 0) laden(false);
      } catch (_) {}
    }

    const alleEintraege = () => {
      const d = Z.d || {};
      const liste = (d.eintraege || []).concat((d.punkte || []).filter((p) => p.art !== "poi" || p.name));
      return liste.sort((a, b) => ((a.t0 != null ? a.t0 : a.t) - (b.t0 != null ? b.t0 : b.t))
        // Start und Ziel vor dem Eintrag, der zur selben Zeit beginnt: Ziel 17:37 vor der Übernachtung ab 17:37
        || ((a.art === "start" || a.art === "ziel" ? 0 : 1) - (b.art === "start" || b.art === "ziel" ? 0 : 1)));
    };
    const tagEintraege = () => {
      const d = Z.d; if (!d) return [];
      const alle = alleEintraege();
      if (!d.mehrtaegig || Z.tag == null) return alle;
      return alle.filter((x) => (x.tag == null ? 1 : x.tag) === Z.tag);
    };

    function chipsHtml() {
      const z = (Z.d && Z.d.zusammenfassung) || {}, raus = [];
      for (const a of ["fahrt", "rad", "laufen"]) if (z[a]) raus.push(`<span class="lba-chip" style="--c:${farbe(a)}">${I(SYMBOL[a], 13)} ${esc(dauer(z[a].dauer_s))} ${esc(artName(a))}</span>`);
      for (const a of ["uebersetzen", "wanderung", "spaziergang", "gehen", "wassersport", "pause", "uebernachtung"]) if (z[a]) {
        const n = z[a].anzahl, name = n === 1 ? artName(a) : T("logbuch.mehrzahl." + a, artName(a));
        raus.push(`<span class="lba-chip" style="--c:${farbe(a)}">${I(SYMBOL[a], 13)} ${n} ${esc(name)}</span>`);
      }
      if (Z.d && Z.d.hoechster && Z.d.hoechster.ele != null)
        raus.push(`<span class="lba-chip" style="--c:${farbe("hoechster_punkt")}">${I("mountain", 13)} ${esc(T("logbuch.hoechster", "höchster Punkt {m} m", { m: Math.round(Z.d.hoechster.ele).toLocaleString(sprache()) }))}</span>`);
      return raus.join("");
    }
    function tageHtml() {
      const d = Z.d; if (!d || !d.mehrtaegig) return "";
      const tage = d.tage || [], zeigen = Z.alleTage ? tage : tage.slice(0, 3);
      const knopf = (x) => `<button type="button" class="lba-tag${x.nr === Z.tag ? " an" : ""}" data-lba-tag="${x.nr}">${esc(T("logbuch.tag_kurz", "Tag {n} · {d}", { n: x.nr, d: tagText(x.t0, x.versatz_min, { weekday: "short", day: "numeric", month: "short" }) }))}</button>`;
      const mehr = tage.length > zeigen.length ? `<button type="button" class="lba-tag lba-tag-mehr" data-lba-mehr="1">${esc(T("logbuch.weitere_tage", "+ {n} weitere Tage", { n: tage.length - zeigen.length }))}</button>` : "";
      return `<div class="lba-tage">${zeigen.map(knopf).join("")}${mehr}</div>`;
    }
    function zeileHtml(x) {
      const p = istPunkt(x), art = p ? x.art : (x.anzeige_art || x.art), o = ortVon(Z.orte, x);
      const zeit = p ? uhr(x.t, x.versatz_min) : (uhr(x.t0, x.versatz_min) + "–" + uhr(x.t1, x.versatz_min));
      const meta = [];
      if (o.text) meta.push(esc(o.text));
      if (!p) { meta.push(esc(dauer(x.dauer_s))); if (x.strecke_m > 50) meta.push(esc(km(x.strecke_m))); }
      if (!p && x.stau_s >= 120) meta.push(esc(T("logbuch.stau", "davon {n} min Stau", { n: Math.round(x.stau_s / 60) })));
      const vermutet = (!p && x.geraten) ? ` <span class="lba-badge" title="${esc(T("logbuch.geraten_tip2", "Die Erkennung war hier unsicher."))}">${esc(T("logbuch.geraten", "vermutet"))}</span>` : "";
      const notiz = x.notiz ? `<div class="lba-notiz">${esc(x.notiz)}</div>` : "";
      return `<div class="lba-eintrag${Z.sel === x.id ? " gewaehlt" : ""}" data-lba-id="${esc(x.id)}" style="--c:${farbe(art)}" role="button" tabindex="0">
          <span class="lba-symbol">${symbol(art)}</span>
          <div class="lba-text"><div class="lba-kopf"><b>${esc(titel(x, Z.orte))}</b><span class="lba-zeit">${esc(zeit)}</span></div>
            <div class="lba-meta">${meta.join(" · ")}${vermutet}</div>${notiz}</div>
          ${p || !(x.bids && x.bids.length) ? "" : `<button type="button" class="lba-mehr" data-lba-mehr-id="${esc(x.id)}" title="${esc(T("logbuch.menue.titel", "Bearbeiten"))}">${I("ellipsis", 16)}</button>`}
        </div>`;
    }
    function render() {
      const d = Z.d; if (!d) return;
      const liste = tagEintraege();
      let kopf = "";
      if (d.mehrtaegig && Z.tag != null) {
        const tag = (d.tage || []).find((x) => x.nr === Z.tag);
        const m = liste.reduce((s, x) => s + (+x.strecke_m || 0), 0);
        kopf = `<div class="lba-tagkopf"><b>${esc(T("logbuch.tag_kopf", "Tag {n} · {d}", { n: Z.tag, d: tag ? tagText(tag.t0, tag.versatz_min, { weekday: "short", day: "numeric", month: "long" }) : "" }))}</b><span>${esc(km(m))}</span></div>`;
      }
      const rueck = Z.rueck ? `<div class="lba-rueck">${esc(Z.rueck.text)} <button type="button" class="btn btn-sm" data-lba-rueck="1">${I("rotate-ccw", 13)} ${esc(T("logbuch.rueckgaengig", "Rückgängig"))}</button></div>` : "";
      box.innerHTML = `<div class="lba">
          <div class="lba-titel">${I("book-open", 18)} <b>${esc(T("logbuch.titel", "Logbuch"))}</b><span class="lba-luft"></span>
            <button type="button" class="btn btn-sm btn-ghost" data-lba-export="pdf" title="${esc(T("logbuch.export_pdf_tip", "Als PDF speichern — Tagebuch der Tour mit allen Tagen"))}">${I("file-down", 14)} PDF</button>
            <button type="button" class="btn btn-sm btn-ghost" data-lba-export="csv" title="${esc(T("logbuch.export_csv_tip", "Als Tabelle (CSV) speichern — für Excel oder Numbers"))}">${I("table", 14)} CSV</button></div>
          <div class="lba-unter muted">${esc(T("logbuch.unter", "Deine Tour, Tag für Tag. Namen und Notizen bleiben überall gleich."))}</div>
          <div class="lba-chips">${chipsHtml()}</div>
          ${tageHtml()}
          ${kopf}
          <div class="lba-liste">${liste.length ? liste.map(zeileHtml).join("") : `<div class="lba-leer">${esc(T("logbuch.leer", "Nichts erkannt — der Track ist zu kurz oder hat keine Bewegung."))}</div>`}</div>
          ${rueck}
          <div class="lba-fuss muted">${esc(T("logbuch.fuss_art", "Hier: Namen und Art ändern, Notizen ergänzen, Einträge verbinden. Track-Reparaturen bleiben im GPX-Inspektor."))}</div>
        </div>`;
      binden();
    }
    /* 22.10.2026 (Marc: „ein Export des Logbuchs wäre super“ → PDF + CSV) — alle Tage, dieselben Titel, Orte und Zeiten
       wie auf dem Bildschirm. Die Kärtchen je Tag setzt das Backend ein (<!--RZKARTE:n-->). */
    function csvText() {
      const d = Z.d, alle = alleEintraege(), tz = (n) => (d.tage || []).find((x) => x.nr === n);
      const zelle = (v) => { v = String(v == null ? "" : v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      const kopf = [T("logbuch.csv.tag", "Tag"), T("logbuch.csv.datum", "Datum"), T("logbuch.csv.von", "Von"), T("logbuch.csv.bis", "Bis"),
        T("logbuch.csv.art", "Art"), T("logbuch.csv.titel", "Titel"), T("logbuch.csv.ort", "Ort"), T("logbuch.csv.dauer", "Dauer (min)"),
        T("logbuch.csv.strecke", "Strecke (km)"), T("logbuch.csv.notiz", "Notiz"), T("logbuch.csv.breite", "Breite"), T("logbuch.csv.laenge", "Länge")];
      const zeilen = alle.map((x) => {
        const p = istPunkt(x), art = p ? x.art : (x.anzeige_art || x.art), o = ortVon(Z.orte, x), tg = x.tag == null ? 1 : x.tag;
        const t0 = p ? x.t : x.t0, pos = x.pos || x.pos_von || null, t = tz(tg);
        return [tg, tagText(t0, x.versatz_min, { year: "numeric", month: "2-digit", day: "2-digit" }) || (t ? t.datum : ""), uhr(t0, x.versatz_min),
          p ? "" : uhr(x.t1, x.versatz_min), artName(art), titel(x, Z.orte), o.text, p ? "" : Math.round((x.dauer_s || 0) / 60),
          p || !x.strecke_m ? "" : (x.strecke_m / 1000).toLocaleString(sprache(), { maximumFractionDigits: 2 }), x.notiz || "",
          pos ? pos[1].toFixed(6) : "", pos ? pos[0].toFixed(6) : ""].map(zelle).join(";");
      });
      return [kopf.map(zelle).join(";")].concat(zeilen).join("\r\n") + "\r\n";
    }
    function pdfHtml() {
      const d = Z.d, alle = alleEintraege(), name = opt.name || d.name || "";
      const tage = d.mehrtaegig && (d.tage || []).length ? d.tage : [{ nr: 1, t0: (alle[0] || {}).t0 || (alle[0] || {}).t, t1: 0, versatz_min: (alle[0] || {}).versatz_min }];
      const kapitel = tage.map((tg) => {
        const liste = d.mehrtaegig ? alle.filter((x) => (x.tag == null ? 1 : x.tag) === tg.nr) : alle;
        const m = liste.reduce((s, x) => s + (+x.strecke_m || 0), 0);
        const zeilen = liste.map((x) => {
          const p = istPunkt(x), art = p ? x.art : (x.anzeige_art || x.art), o = ortVon(Z.orte, x);
          const zeit = p ? uhr(x.t, x.versatz_min) : (uhr(x.t0, x.versatz_min) + "–" + uhr(x.t1, x.versatz_min));
          const meta = [o.text, p ? "" : dauer(x.dauer_s), (!p && x.strecke_m > 50) ? km(x.strecke_m) : ""].filter(Boolean).join(" · ");
          return `<tr><td class="z">${esc(zeit)}</td><td class="s"><span style="color:${farbe(art)}">${symbol(art)}</span></td>
            <td><b>${esc(titel(x, Z.orte))}</b>${meta ? `<div class="m">${esc(meta)}</div>` : ""}${x.notiz ? `<div class="n">${esc(x.notiz)}</div>` : ""}</td></tr>`;
        }).join("");
        const kopf = d.mehrtaegig ? T("logbuch.tag_kopf", "Tag {n} · {d}", { n: tg.nr, d: tagText(tg.t0, tg.versatz_min, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) })
                                  : tagText(tg.t0, tg.versatz_min, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
        return `<section><h2>${esc(kopf)}<span>${esc(km(m))}</span></h2><!--RZKARTE:${tg.nr}--><table>${zeilen}</table></section>`;
      }).join("");
      const chips = ((typeof document !== "undefined") ? (() => { const div = document.createElement("div"); div.innerHTML = chipsHtml(); return [...div.querySelectorAll(".lba-chip")].map((c) => c.textContent.trim()).join(" · "); })() : "");
      return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(name)}</title><style>
        body { font: 11pt system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1d2421; }
        h1 { font-size: 20pt; margin: 0 0 4px; } .unter { color: #5d6b66; margin-bottom: 18px; }
        section { break-inside: auto; margin-bottom: 18px; }
        h2 { font-size: 13pt; display: flex; justify-content: space-between; border-bottom: 1.5px solid #1f7a5c; padding-bottom: 3px; margin: 18px 0 8px; break-after: avoid; }
        h2 span { color: #5d6b66; font-weight: 500; } svg.karte { display: block; margin: 6px 0 10px; max-width: 100%; height: auto; break-inside: avoid; }
        table { width: 100%; border-collapse: collapse; } tr { break-inside: avoid; } td { vertical-align: top; padding: 4px 6px; border-bottom: 1px solid #e3e8e6; }
        td.z { white-space: nowrap; color: #5d6b66; width: 92px; font-variant-numeric: tabular-nums; } td.s { width: 22px; } td.s svg { width: 15px; height: 15px; }
        .m { color: #5d6b66; font-size: 9.5pt; } .n { font-style: italic; font-size: 9.5pt; margin-top: 2px; }
        .fuss { color: #8a9893; font-size: 8.5pt; margin-top: 24px; }
      </style></head><body><h1>${esc(name || T("logbuch.titel", "Logbuch"))}</h1><div class="unter">${esc(chips)}</div>${kapitel}
      <div class="fuss">${esc(T("logbuch.export_fuss", "Erstellt mit GPS Studio by reisezoom.com"))}</div></body></html>`;
    }
    async function exportieren(art, knopf) {
      if (!Z.d) return;
      const vorher = knopf.innerHTML; knopf.disabled = true; knopf.innerHTML = `<span class="spinner"></span>`;
      try {
        const tage = (Z.d.tage || []).map((t) => ({ nr: t.nr, t0: t.t0, t1: t.t1 }));
        if (!tage.length) { const a = alleEintraege(); if (a.length) tage.push({ nr: 1, t0: (a[0].t0 != null ? a[0].t0 : a[0].t) - 1, t1: (a[a.length - 1].t1 || a[a.length - 1].t) + 1 }); }
        const r = await api().logbuch_export(opt.path, art, art === "pdf" ? pdfHtml() : csvText(), opt.name || Z.d.name || "", tage);   // warte-ok: Knopf zeigt Spinner, davor Systemdialog
        if (r && r.ok) toast(T("logbuch.export_ok", "Gespeichert: {n}", { n: String(r.pfad).split(/[\\/]/).pop() }), "success", 4000);
        else if (r && !r.abbruch) toast((r && r.error) || "?", "error", 6000);
      } finally { knopf.disabled = false; knopf.innerHTML = vorher; }
    }
    function binden() {
      box.querySelectorAll("[data-lba-export]").forEach((b) => { b.onclick = () => exportieren(b.dataset.lbaExport, b); });
      box.querySelectorAll("[data-lba-tag]").forEach((b) => { b.onclick = () => { Z.tag = +b.dataset.lbaTag; Z.sel = null; render(); if (opt.onTag) opt.onTag(Z.tag); }; });
      const mehr = box.querySelector("[data-lba-mehr]"); if (mehr) mehr.onclick = () => { Z.alleTage = true; render(); };
      box.querySelectorAll("[data-lba-id]").forEach((el) => {
        const w = () => waehlen(el.dataset.lbaId, true);
        el.onclick = (ev) => { if (ev.target.closest("[data-lba-mehr-id]")) return; w(); };
        el.onkeydown = (ev) => { if (ev.key === "Enter") w(); };
      });
      box.querySelectorAll("[data-lba-mehr-id]").forEach((b) => { b.onclick = (ev) => { ev.stopPropagation(); menue(b.dataset.lbaMehrId, b); }; });
      const r = box.querySelector("[data-lba-rueck]"); if (r) r.onclick = rueckgaengig;
    }
    function finde(id) { return alleEintraege().find((x) => x.id === id) || null; }
    function waehlen(id, vonKlick) {
      const x = finde(id); if (!x) return;
      if (Z.d && Z.d.mehrtaegig && x.tag != null && x.tag !== Z.tag) Z.tag = x.tag;
      Z.sel = id; render();
      const el = box.querySelector(`[data-lba-id="${CSS.escape(id)}"]`); if (el && !vonKlick) el.scrollIntoView({ block: "nearest" });
      if (opt.onWahl) opt.onWahl(x);
    }

    // ── Bearbeiten (gleiche Brücke wie der Inspektor, eigenes Rückgängig) ──
    function frage(titelText, wert, mehrzeilig, ortHaken) {
      return new Promise((res) => {
        const feld = mehrzeilig ? `<textarea id="lba-frage" class="lba-frage" rows="4">${esc(wert || "")}</textarea>` : `<input id="lba-frage" class="lba-frage" type="text" value="${esc(wert || "")}">`;
        // 22.10.2026 (Marc: „beim Umbenennen mit einem Haken zu ‚Meine Orte‘ hinzufügen“)
        const haken = ortHaken ? `<label class="lba-orthaken"><input type="checkbox" id="lba-frage-ort"> ${esc(T("logbuch.als_mein_ort", "Zu „Meine Orte“ hinzufügen — wird in allen Logbüchern erkannt"))}</label>` : "";
        const m = openModal({ title: titelText, body: `<div class="lib-fmodal">${feld}${haken}</div>`,
          footer: `<button class="btn" id="lba-frage-nein">${esc(T("common.cancel", "Abbrechen"))}</button><button class="btn btn-primary" id="lba-frage-ja">${esc(T("common.ok", "OK"))}</button>` });
        const el = document.getElementById("lba-frage"), fertig = (v) => {
          const h = document.getElementById("lba-frage-ort"), alsOrt = !!(h && h.checked);
          try { m.close(); } catch (_) {}
          res(ortHaken ? (v == null ? null : { wert: v, alsOrt }) : v);
        };
        document.getElementById("lba-frage-ja").onclick = () => fertig(el ? el.value : "");
        document.getElementById("lba-frage-nein").onclick = () => fertig(null);
        if (el) { el.focus(); try { el.select(); } catch (_) {} if (!mehrzeilig) el.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); fertig(el.value); } }); }
      });
    }
    async function aktion(text, was, params) {
      const d = Z.d; if (!d) return;
      const vorher = d.stand ? JSON.parse(JSON.stringify(d.stand)) : null;
      let r = null;
      try { r = await rzWarten("einteilung_aktion", () => api().einteilung_aktion(d.eid, was, params)); } catch (e) { r = { ok: false, error: String(e) }; }
      if (!r || !r.ok) { if (typeof toast === "function") toast((r && r.error) || T("logbuch.fehler_aktion", "Das ging nicht"), "error", 5000); return; }
      Z.rueck = vorher ? { text, stand: vorher, eid: d.eid, tour: d.tour } : null;
      // gespeichert ist es schon — Bescheid geben, bevor `laden` auf die Ortsnamen aus dem Netz wartet
      if (opt.onGeaendert) { try { opt.onGeaendert(); } catch (_) {} }
      await laden(false);
    }
    async function rueckgaengig() {
      const u = Z.rueck; if (!u) return;
      Z.rueck = null;
      try { await rzWarten("einteilung_stand_setzen", () => api().einteilung_stand_setzen(u.eid, u.stand, u.tour)); } catch (_) {}
      if (opt.onGeaendert) { try { opt.onGeaendert(); } catch (_) {} }
      await laden(false);
    }
    function menue(id, anker) {
      const x = finde(id); if (!x || istPunkt(x) || !(x.bids && x.bids.length)) return;
      const liste = (Z.d.eintraege || []), i = liste.findIndex((e) => e.id === id), vor = liste[i - 1], nach = liste[i + 1];
      const pkt = [];   // [Text, Aktion] · {kopf} · "-" · {html, fn, art}
      pkt.push([T("logbuch.menue.umbenennen", "Umbenennen …"), async () => {
        const art = x.anzeige_art || x.art, pos = x.pos || x.pos_von;
        const ortTauglich = !!pos && ["pause", "uebernachtung", "halt"].includes(art);
        const v = await frage(T("logbuch.frage.name", "Name"), x.name || x.mein_ort || titel(x, Z.orte), false, ortTauglich);
        if (v == null) return;
        const name = (ortTauglich ? v.wert : v).trim();
        if (ortTauglich && v.alsOrt && name) {
          const r = await api().meine_orte_speichern({ name, lat: pos[1], lon: pos[0] }).catch(() => null);   // warte-ok: eine Zeile in den Einstellungen
          if (r && r.ok) toast(T("logbuch.ort_gemerkt", "„{n}“ steht jetzt in „Meine Orte“.", { n: name }), "success", 3500);
          // der Eintrag heißt dann über den Ort — kein eigener Name nötig
          await aktion(T("logbuch.undo.umbenannt", "Umbenannt"), "aendern", { bids: x.bids, name: "" });
          return;
        }
        aktion(T("logbuch.undo.umbenannt", "Umbenannt"), "aendern", { bids: x.bids, name });
      }]);
      pkt.push([T("logbuch.menue.notiz", "Notiz …"), async () => {
        const v = await frage(T("logbuch.frage.notiz", "Notiz"), x.notiz || "", true);
        if (v != null) aktion(T("logbuch.undo.notiz", "Notiz geändert"), "aendern", { bids: x.bids, notiz: v.trim() });
      }]);
      if (vor) pkt.push([T("logbuch.menue.mit_vorherigem", "Mit vorherigem zusammenlegen"), () => aktion(T("logbuch.undo.verbunden", "Verbunden"), "zusammenlegen", { bid_a: vor.bids[vor.bids.length - 1], bid_b: x.bids[0] })]);
      if (nach) pkt.push([T("logbuch.menue.mit_naechstem", "Mit nächstem zusammenlegen"), () => aktion(T("logbuch.undo.verbunden", "Verbunden"), "zusammenlegen", { bid_a: x.bids[x.bids.length - 1], bid_b: nach.bids[0] })]);
      // 16.10.2026 — Art der Fortbewegung ändern (Rückmeldung: „Ich kann den Namen ändern, aber nicht die Art
      // der Fortbewegung“). Dieselbe Aktion wie im Inspektor: `aendern` mit `art` macht den Eintrag zu Handarbeit,
      // die jede Neuberechnung überlebt; Animator, Video-Assistent und Kurzfassung lesen sie aus der Einteilung.
      const jetzt = x.anzeige_art || x.art;
      pkt.push("-");
      pkt.push({ kopf: T("logbuch.menue.art", "Art ändern") });
      for (const a of HAND_ARTEN) {
        const ist = a === jetzt;
        if (ist && !x.geraten) continue;   // vermutete Art: hier bestätigen (wird dann Handarbeit)
        const text = ist ? T("logbuch.menue.bestaetigen", "{art} bestätigen", { art: artName(a) }) : artName(a);
        pkt.push({ art: a, html: `<span class="lba-menue-sym" style="--c:${farbe(a)}">${I(SYMBOL[a] || "map-pin", 14)}</span>${esc(text)}`,
                   fn: () => aktion(T("logbuch.undo.art_geaendert", "Art geändert"), "aendern", { bids: x.bids, art: a }) });
      }
      document.querySelectorAll(".lba-menue").forEach((m) => m.remove());
      const m = document.createElement("div");
      m.className = "lib-ctxmenu lba-menue"; m.setAttribute("role", "menu");
      for (const e of pkt) {
        if (e === "-") { m.appendChild(document.createElement("hr")); continue; }
        if (e.kopf) { const k = document.createElement("div"); k.className = "lba-menue-kopf"; k.textContent = e.kopf; m.appendChild(k); continue; }
        const b = document.createElement("button"); b.type = "button"; b.className = "lib-ctx-item"; b.setAttribute("role", "menuitem");
        let fn;
        if (Array.isArray(e)) { b.textContent = e[0]; fn = e[1]; }
        else { b.innerHTML = e.html; b.dataset.lbaArt = e.art; fn = e.fn; }
        b.onclick = () => { zu(); fn(); }; m.appendChild(b);
      }
      document.body.appendChild(m);
      const r0 = anker.getBoundingClientRect(), r = m.getBoundingClientRect();
      m.style.left = Math.max(4, Math.min(r0.right - r.width, innerWidth - r.width - 6)) + "px";
      m.style.top = Math.max(4, Math.min(r0.bottom + 2, innerHeight - r.height - 6)) + "px";
      const weg = (ev) => { if (!m.contains(ev.target)) zu(); };
      function zu() { m.remove(); document.removeEventListener("mousedown", weg, true); }
      setTimeout(() => { if (m.isConnected) document.addEventListener("mousedown", weg, true); }, 0);
    }

    laden(false);
    return { waehlen, neuLaden: () => laden(false), daten: () => Z.d, tagEintraege, titel: (x) => titel(x, Z.orte), tag: () => Z.tag };
  }

  // 11.10.2026 (Schritt 9) — der GPX-Inspektor nimmt Symbole, Namen und Titel von hier (eine Quelle für alle Module)
  window.rzLogbuchAnsicht = { zeichnen, symbolName: (a) => SYMBOL[a] || "map-pin", farbe, artName, titel, handArten: HAND_ARTEN.slice(),
    symbolHtml: (a, g) => I(SYMBOL[a] || "map-pin", g || 16) };
})();
