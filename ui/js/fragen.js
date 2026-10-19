/* „Frag GPS Studio“ — Hilfesuche ohne Sprachmodell (19.10.2026).
 *
 * Ein Fragefeld durchsucht das Handbuch und die Beschriftungen der Knöpfe und zeigt die passenden Absätze. Der Knopf
 * „Zeig mir“ springt direkt zum richtigen Modul und Schalter und hebt ihn hervor. Läuft auf jedem Rechner: kein Netz,
 * kein Modell — ein kleiner Volltext-Index (BM25) im Speicher.
 *
 * Aufbau:
 *   - Quellen: (a) Handbuch der App-Sprache in Absätzen (Brücke `hilfe_handbuch`, core/hilfesuche.py), (b) die
 *     Beschriftungen aus i18n (Knöpfe, Schalter, Abschnitte, mit Tooltip), (c) die Tabelle ZIELE unten — die wichtigsten
 *     Stellen der App mit eigenen Suchwörtern (i18n `frag.w.<id>`) und dem Weg dorthin.
 *   - Wörter: klein, Umlaute als ae/oe/ue/ss, Akzente weg, „9:16“ → „9x16“, Stoppwörter weg (i18n `frag.stoppwoerter`),
 *     leichtes Stemming je Sprache (de/en/es). Treffer auch über Wortanfang, deutsche Wortenden (Komposita: „zeit“ in
 *     „aufnahmezeit“) und eine kleine Synonymliste (i18n `frag.synonyme`).
 *   - Bewertung: BM25 mit Feldern (Überschrift/Beschriftung zählt dreifach, Überschriften-Pfad einfach), Bonus für
 *     Treffer mit mehr Fragewörtern; Ziele der Tabelle und Beschriftungen bekommen einen Aufschlag.
 *   - Index entsteht einmal beim ersten Öffnen (je Sprache); eine Frage kostet wenige Millisekunden.
 *
 * Einstieg: ⌘K / Strg+K überall, das Fragefeld oben rechts in der Kopfzeile, „Hilfe → Frag GPS Studio …“ im Menü und das
 * Fragefeld im Fenster „Erste Schritte“. API: window.rzFrag.{oeffnen, schliessen, suchen, zeigMir}.
 *
 * Neues „Zeig mir“-Ziel: Eintrag in ZIELE (id, modul, label, ort, tip, finde, ggf. braucht/vorher), dazu
 * `frag.w.<id>` in i18n/{de,en,es}.json — siehe docs/DEVELOPER.md, Abschnitt „Frag GPS Studio“.
 */
(function () {
  "use strict";
  const T = (k, f, p) => (typeof t === "function" ? t(k, f, p) : f);
  const I = (n, s) => (typeof rzIcon === "function" ? rzIcon(n, { size: s || 16 }) : "");
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const log = (lvl, msg) => { try { if (typeof applog === "function") applog(lvl, "[frag] " + msg); } catch (e) { console.warn("[frag]", msg, e); } };
  const IST_MAC = /Mac/i.test(navigator.platform || "") || /Mac OS X/i.test(navigator.userAgent || "");
  const taste = () => (IST_MAC ? "⌘K" : T("frag.taste_win", "Strg+K"));
  const sprache = () => { try { const a = (typeof i18nMeta === "function" && i18nMeta().active) || "de"; return ["de", "en", "es"].includes(a) ? a : "de"; } catch (e) { return "de"; } };
  // Emojis/Deko aus Beschriftungen („🎥 Kamera“ → „Kamera“)
  const DEKO = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2900}-\u{297F}\u{2B00}-\u{2BFF}\u{25A0}-\u{25FF}\u{3030}\u{FE0F}\u{200D}]/gu;
  const sauber = (s) => String(s || "").replace(DEKO, "").replace(/\s+/g, " ").trim();
  const modName = (slug) => sauber(slug === "settings" ? T("topbar.settings", "Einstellungen") : T("modules." + slug + ".name", slug));

  // ── Wörter ──────────────────────────────────────────────────────────────
  function norm(s) {
    return String(s || "").toLowerCase()
      .replace(/(\d+)\s*[:x×]\s*(\d+)/g, "$1x$2")
      .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
      .normalize("NFD").replace(/[̀-ͯ]/g, "");
  }
  const roh = (s) => norm(s).match(/[a-z0-9]+/g) || [];
  const ENDEN_ES = ["amientos", "imientos", "amiento", "imiento", "aciones", "acion", "mente", "iendo", "ando", "ados", "adas", "idos", "idas",
    "ado", "ada", "ido", "ida", "ar", "er", "ir", "es", "os", "as", "s", "o", "a", "e"];
  /** Leichtes Stemming: gleiche Wortfamilie → gleicher Stamm („ändern/ändere“ → „aend“, „Fotos“ → „foto“). */
  function stamm(w, sp) {
    if (w.length <= 3 || /^\d/.test(w)) return w;
    let s = w;
    if (sp === "en") {
      if (s.endsWith("ies") && s.length > 4) s = s.slice(0, -3) + "y";
      else if (s.endsWith("sses")) s = s.slice(0, -2);
      else if (s.endsWith("s") && !s.endsWith("ss") && !s.endsWith("us") && s.length > 3) s = s.slice(0, -1);
      for (const e of ["ing", "ed"]) if (s.endsWith(e) && s.length - e.length >= 3) { s = s.slice(0, -e.length); break; }
      if (s.endsWith("e") && s.length > 4) s = s.slice(0, -1);
      return s;
    }
    if (sp === "es") {
      for (const e of ENDEN_ES) if (s.endsWith(e) && s.length - e.length >= 3) return s.slice(0, -e.length);
      return s;
    }
    // Deutsch (angelehnt an Snowball, ohne R1): Schritt 1 Endungen, Schritt 2 Verb-/Steigerungsendungen
    let weg = false;
    for (const e of ["ern", "em", "er", "en", "es", "e"]) if (s.endsWith(e) && s.length - e.length >= 3) { s = s.slice(0, -e.length); weg = true; break; }
    if (!weg && s.endsWith("s") && !s.endsWith("ss") && s.length >= 5) s = s.slice(0, -1);
    for (const e of ["est", "en", "er", "st"]) if (s.endsWith(e) && s.length - e.length >= 4) { s = s.slice(0, -e.length); break; }
    if (s.length >= 5 && s.endsWith("t") && !/[aeiou]t$/.test(s)) s = s.slice(0, -1);
    return s;
  }

  // ── Index ───────────────────────────────────────────────────────────────
  let IX = null;            // { sp, docs, post: Map, vokab: [], avgLen, n, stopp, syn: Map, hb: "laedt"|"ok"|"fehlt" }
  let hbLauf = null;
  const W_KOPF = 3, W_PFAD = 1;
  const K1 = 1.2, B = 0.6;

  function sprachDaten(sp) {
    const stopp = new Set(roh(T("frag.stoppwoerter", "")).map(w => w));
    const syn = new Map();   // Stamm → Set(Stämme der Gruppe)
    for (const gruppe of String(T("frag.synonyme", "")).split("|")) {
      const st = [...new Set(roh(gruppe).map(w => stamm(w, sp)))];
      for (const s of st) { if (!syn.has(s)) syn.set(s, new Set()); for (const o of st) if (o !== s) syn.get(s).add(o); }
    }
    return { stopp, syn };
  }
  function terme(text, sp, stopp) {
    const out = [];
    for (const w of roh(text)) if (!stopp.has(w)) out.push(stamm(w, sp));
    return out;
  }
  function docAufnehmen(ix, d) {
    const tf = new Map();
    const zaehl = (liste, w) => { for (const s of liste) tf.set(s, (tf.get(s) || 0) + w); };
    const kopf = terme(d.titel, ix.sp, ix.stopp), pfad = terme((d.pfad || []).join(" "), ix.sp, ix.stopp);
    const text = terme(d.text + " " + (d.extra || ""), ix.sp, ix.stopp);
    zaehl(kopf, W_KOPF); zaehl(pfad, W_PFAD); zaehl(text, 1);
    d.len = kopf.length + text.length;
    const i = ix.docs.length;
    ix.docs.push(d);
    for (const [s, w] of tf) { let p = ix.post.get(s); if (!p) ix.post.set(s, p = []); p.push(i, w); }
  }
  function abschliessen(ix) {
    ix.vokab = [...ix.post.keys()];
    let sum = 0; for (const d of ix.docs) sum += d.len;
    ix.avgLen = ix.docs.length ? sum / ix.docs.length : 1;
    ix.zielTerme = new Map();
    for (const z of ZIELE) {
      const st = [...new Set(terme(sauber(T(z.label[0], z.label[1])), ix.sp, ix.stopp))];
      ix.zielTerme.set(z.id, st);
    }
  }

  // Beschriftungen, die NICHT als Knopf in Frage kommen (Meldungen, Fehler, Tooltips — die hängen am Knopf)
  const PRAEFIX_AUS = new Set(["error", "warte", "wartespruch", "bugreport", "update", "cloud", "undo", "quiz", "first_run", "menu", "common",
    "rights", "about", "quickstart", "frag", "modules", "app", "vorgang", "toast", "kq", "dok", "help", "onboarding", "lizenz", "mcp"]);
  const SCHLUESSEL_AUS = /(error|fehler|warn|toast|confirm|frage|undo|laedt|lade_|status|fail|hinweis|_msg|msg_|meldung|body|_text$|\.text$|sicher|placeholder|_ph$|anker|_tip$|\.tip$|tooltip|_t$|hilfe$|help|_desc$|\.desc$|intro|erfolg|fertig|gespeichert|_n$|_1$|@win)/;
  const MODUL_VON = { animator: "animator", signs: "animator", einfach: "animator", look: "animator", kartened: "animator", mapstyle: "animator",
    tourmap: "tourmap", library: "library", bib: "library", pm: "library", fotos: "library", tourseite: "library", trackcheck: "library",
    vorlagen: "library", archiv: "library", geotagger: "geotagger", gpxinspect: "gpxinspect", heightanim: "heightanim", webkarte: "webkarte",
    settings: "settings" };
  function labelDocs(ix, benutzt) {
    const store = (typeof _i18nStrings !== "undefined" && _i18nStrings) || {};
    const zielKeys = new Set(ZIELE.map(z => z.label[0]));
    const gesehen = new Set();
    for (const [k, v] of Object.entries(store)) {
      if (typeof v !== "string") continue;
      const pr = k.split(".")[0];
      if (PRAEFIX_AUS.has(pr) || !MODUL_VON[pr] || SCHLUESSEL_AUS.test(k) || zielKeys.has(k) || !benutzt.has(k)) continue;
      const titel = sauber(v).replace(/[…:]+$/, "").trim();
      if (titel.length < 4 || titel.length > 70 || /[{}<>%]/.test(titel) || !/[a-zA-ZäöüÄÖÜ]/.test(titel)) continue;
      // 19.10.2026 (Audit) — ganze Sätze sind Meldungen, keine Knöpfe („Keine doppelten Touren gefunden.“ stand vor „Doppelte finden“)
      if (/[.!?]$/.test(titel) && titel.split(/\s+/).length >= 3) continue;
      const sig = MODUL_VON[pr] + "|" + norm(titel);
      if (gesehen.has(sig)) continue;
      gesehen.add(sig);
      let tip = "";
      for (const kk of [k + "_tip", k + ".tip", k + "_tooltip", k + ".tooltip", k + "_t", k.replace(/(_label|\.label)$/, "_tooltip"), k.replace(/(_label|\.label)$/, ".tooltip")]) {
        if (kk !== k && typeof store[kk] === "string" && store[kk]) { tip = sauber(store[kk]); break; }
      }
      docAufnehmen(ix, { typ: "ui", art: "label", titel, pfad: [modName(MODUL_VON[pr])], text: tip, schluessel: k, modul: MODUL_VON[pr], boost: 0.7 });
    }
  }
  function zielDocs(ix) {
    for (const z of ZIELE) {
      const titel = sauber(T(z.label[0], z.label[1]));
      const pfad = [z.modul ? modName(z.modul) : T("frag.app", "App")].concat((z.ort || []).map(([k, f]) => sauber(T(k, f))))
        .filter((x, i, a) => x && (i === 0 || norm(x) !== norm(a[i - 1])));   // „Camera › Camera“ (en) nur einmal
      docAufnehmen(ix, { typ: "ui", art: "ziel", titel, pfad, text: z.tip ? sauber(T(z.tip[0], z.tip[1])) : "",
        extra: T("frag.w." + z.id, ""), ziel: z.id, modul: z.modul, boost: 1.5 });
    }
  }
  const RE_VERSIONSNOTIZ = /^\s*(neu in v?\d|neu:|new in v?\d|new:|novedades en v?\d|nuevo en v?\d|novedades:)/i;
  function handbuchDocs(ix, hb) {
    const abschn = hb.abschnitte || [];
    // Erster Absatz eines Abschnitts trägt die Überschrift als Kopf — so findet eine Frage auch kurze Abschnitte
    const erster = new Set();
    for (const [ai, text] of hb.bloecke || []) {
      const a = abschn[ai]; if (!a) continue;
      const pfad = a.pfad || [];
      const kopf = pfad[pfad.length - 1] || "";
      // 19.10.2026 (Audit) — „Neu in v0.9.7xx“-Abschnitte sind Versionsnotizen: sie nannten oft dieselben Wörter und
      // standen vor der eigentlichen Anleitung („titel ändern“ → „Neu: Korrekturen …“)
      const notiz = RE_VERSIONSNOTIZ.test(kopf) || pfad.some(x => RE_VERSIONSNOTIZ.test(x));
      docAufnehmen(ix, { typ: "hb", titel: erster.has(ai) ? "" : kopf, kopf, pfad: pfad.slice(0, -1), text, anker: a.a, ai, boost: notiz ? 0.35 : 1 });
      erster.add(ai);
    }
  }
  function indexBauen() {
    const sp = sprache();
    if (IX && IX.sp === sp) return IX;
    const t0 = performance.now();
    const { stopp, syn } = sprachDaten(sp);
    IX = { sp, docs: [], post: new Map(), vokab: [], avgLen: 1, stopp, syn, hb: "laedt" };
    zielDocs(IX);   // Beschriftungen kommen mit dem Handbuch (nur die, die der Code wirklich benutzt)
    abschliessen(IX);
    log("info", `Index ${sp}: ${IX.docs.length} Beschriftungen/Ziele in ${Math.round(performance.now() - t0)} ms`);
    handbuchLaden(IX);
    return IX;
  }
  function handbuchLaden(ix) {
    if (hbLauf && hbLauf.ix === ix) return hbLauf.p;
    const a = (typeof api === "function") ? api() : null;
    if (!a || !a.hilfe_handbuch) { ix.hb = "fehlt"; return Promise.resolve(); }
    const p = Promise.resolve(a.hilfe_handbuch())   // warte-ok: eigene Ladeanzeige im Fragefeld („Handbuch wird gelesen …“)
      .then((r) => {
        if (IX !== ix) return;
        if (!r || !r.ok) { ix.hb = "fehlt"; log("warn", "Handbuch: " + ((r && r.error) || "keine Antwort")); return; }
        const t0 = performance.now();
        handbuchDocs(ix, r);
        labelDocs(ix, new Set(r.schluessel || []));
        abschliessen(ix);
        ix.hb = "ok";
        ix.hbAbschnitte = r.abschnitte || [];
        log("info", `Handbuch ${r.sprache}: ${(r.bloecke || []).length} Absätze in ${Math.round(performance.now() - t0)} ms`);
      })
      .catch((e) => { ix.hb = "fehlt"; log("warn", "Handbuch: " + e); })
      .then(() => { if (IX === ix && offen()) { statusZeigen(); suchenUndZeigen(); } });
    hbLauf = { ix, p };
    return p;
  }

  // ── Suche ───────────────────────────────────────────────────────────────
  /** Frage → Liste von Treffern {doc, score, treffer:Set(Stämme)}. Gruppiert Handbuch-Absätze je Abschnitt. */
  function suchen(frage, max) {
    const ix = indexBauen();
    const qs = [...new Set(terme(frage, ix.sp, ix.stopp))];
    if (!qs.length) return [];
    const N = ix.docs.length;
    const scores = new Map();   // doc → [summe, anzahlTerme, Set]
    for (const q of qs) {
      // Erweiterungen: genau, Wortanfang, Wortende (deutsche Komposita), Synonyme — je Dokument zählt die beste
      const erw = new Map([[q, 1]]);
      const setze = (s, w) => { if ((erw.get(s) || 0) < w) erw.set(s, w); };
      const syn = ix.syn.get(q) || new Set();
      for (const s of syn) setze(s, 0.7);
      for (const v of ix.vokab) {
        if (v === q) continue;
        if (q.length >= 3 && v.startsWith(q)) setze(v, q.length >= 4 ? 0.6 : 0.4);
        else if (ix.sp === "de" && q.length >= 4 && v.length > q.length + 2 && v.endsWith(q)) setze(v, 0.5);
        else if (syn.size) for (const s of syn) if (s.length >= 4 && v.startsWith(s)) { setze(v, 0.45); break; }
      }
      const bestes = new Map();   // doc → [beitrag, stamm]
      for (const [s, w] of erw) {
        const p = ix.post.get(s); if (!p) continue;
        const df = p.length / 2;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        for (let i = 0; i < p.length; i += 2) {
          const d = p[i], tf = p[i + 1], doc = ix.docs[d];
          const sc = w * idf * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * doc.len / ix.avgLen));
          const alt = bestes.get(d);
          if (!alt || alt[0] < sc) bestes.set(d, [sc, s]);
        }
      }
      for (const [d, [sc, s]] of bestes) {
        let e = scores.get(d); if (!e) scores.set(d, e = [0, 0, new Set()]);
        e[0] += sc; e[1] += 1; e[2].add(s);
      }
    }
    const n = qs.length;
    const roh = [];
    for (const [d, [sum, m, tr]] of scores) {
      const doc = ix.docs[d];
      if (doc.art === "label" && m / n < 0.5) continue;   // einzelne Beschriftung muss die Frage überwiegend treffen
      roh.push({ doc, score: sum * doc.boost * (0.3 + 0.7 * Math.pow(m / n, 1.5)), treffer: tr });
    }
    roh.sort((a, b) => b.score - a.score);
    // Handbuch: je Abschnitt der beste Absatz (+ ein Teil des zweitbesten), Beschriftungen ohne Dubletten
    const out = [], abschnitt = new Map();
    for (const r of roh) {
      if (r.doc.typ === "hb") {
        const g = abschnitt.get(r.doc.anker);
        if (g) { if (!g.zweit) { g.zweit = true; g.score += 0.3 * r.score; } continue; }
        abschnitt.set(r.doc.anker, r);
      }
      out.push(r);
      if (out.length > (max || 8) * 3) break;
    }
    out.sort((a, b) => b.score - a.score);
    const liste = out.slice(0, max || 8);
    for (const r of liste) if (r.doc.typ === "hb" && !r.doc.ziel) r.ziel = zielZumKopf(ix, r.doc.kopf);
    return liste;
  }
  /** Handbuch-Abschnitt ↔ „Zeig mir“-Ziel: alle Wörter der Ziel-Beschriftung stehen in der Überschrift. */
  function zielZumKopf(ix, kopf) {
    const k = new Set(terme(kopf, ix.sp, ix.stopp));
    for (const z of ZIELE) {
      if (z.kopfLink === false) continue;
      const st = ix.zielTerme.get(z.id) || [];
      if ((st.length >= 2 || (st.length === 1 && st[0].length >= 8)) && st.every(s => k.has(s))) return z.id;
    }
    return null;
  }
  /** Ausschnitt um die Fundstellen, Treffer als <mark>. */
  function schnipsel(text, treffer, sp, laenge) {
    const L = laenge || 26;
    const woerter = [];
    const re = /[\p{L}\p{N}]+(?:[:x×]\d+)?/gu;
    let m;
    while ((m = re.exec(text))) {
      const st = roh(m[0]).map(w => stamm(w, sp));
      woerter.push({ i: m.index, e: m.index + m[0].length, hit: st.some(s => treffer.has(s) || [...treffer].some(tt => tt.length >= 4 && s.startsWith(tt))) });
    }
    if (!woerter.length) return esc(text.slice(0, 200));
    let best = 0, bestI = 0, cnt = 0;
    for (let i = 0; i < woerter.length; i++) {
      if (woerter[i].hit) cnt++;
      if (i >= L && woerter[i - L].hit) cnt--;
      if (cnt > best) { best = cnt; bestI = Math.max(0, i - L + 1); }
    }
    const von = Math.max(0, bestI - (best ? 3 : 0)), bis = Math.min(woerter.length, von + L);
    let out = von > 0 ? "… " : "", pos = woerter[von].i;
    for (let i = von; i < bis; i++) {
      const w = woerter[i];
      out += esc(text.slice(pos, w.i));
      out += w.hit ? "<mark>" + esc(text.slice(w.i, w.e)) + "</mark>" : esc(text.slice(w.i, w.e));
      pos = w.e;
    }
    const ende = bis < woerter.length ? woerter[bis - 1].e : text.length;
    out += esc(text.slice(pos, ende));
    if (bis < woerter.length) out += " …";
    return out;
  }

  // ── „Zeig mir“ ──────────────────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const pause = (ms) => new Promise(r => setTimeout(r, ms));
  async function warteBis(fn, ms) {
    const ende = Date.now() + (ms || 3000);
    for (;;) {
      let v = null;
      try { v = fn(); } catch (e) { v = null; }
      if (v || Date.now() > ende) return v || null;
      await pause(80);
    }
  }
  const aktivesModul = () => (typeof window.getActiveMod === "function" ? window.getActiveMod() : "");
  const trackGeladen = () => { try { return !!(window.__rzAnimCoords && window.__rzAnimCoords().length > 1); } catch (e) { return false; } };
  function sichtbar(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none";
  }
  /** Aufklappen, was das Element verdeckt: Akkordeon-Abschnitt, „Mehr“-Details, ausgeblendete Seitenleiste. */
  async function aufdecken(el) {
    const panel = el.closest && el.closest("#anim-panel");
    if (panel && !sichtbar(panel)) { const k = $('.anim-ansicht [data-ansicht="seite"]'); if (k) { k.click(); await pause(250); } }
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      if (p.tagName === "DETAILS" && !p.open) p.open = true;
      if (p.classList && p.classList.contains("section-collapse-body") && p.hidden) {
        const h = p.parentElement && p.parentElement.querySelector(":scope > .section-collapse-header");
        if (h && h.getAttribute("aria-expanded") !== "true") h.click(); else p.hidden = false;
      }
    }
    await pause(60);
    return sichtbar(el);
  }
  function hervorheben(el) {
    try { el.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (e) { el.scrollIntoView(); }
    el.classList.remove("rz-zeigmir"); void el.offsetWidth; el.classList.add("rz-zeigmir");
    clearTimeout(el.__rzZeigT);
    el.__rzZeigT = setTimeout(() => el.classList.remove("rz-zeigmir"), 2800);
  }
  const reihe = (el) => (el && (el.closest(".checkbox-row, .anim-stil-zeile, .field") || el));
  const abschnittKopf = (sel) => () => { const s = $(sel); return s && !s.hidden ? s : null; };
  const segment = (id) => async () => { const b = await warteBis(() => document.getElementById(id), 3000); if (b && !b.classList.contains("is-on")) { b.click(); await pause(300); } };
  /** Beschriftung im DOM eines Moduls finden (Rückfall für Beschriftungen ohne Tabelleneintrag). */
  function sucheLabel(text, wurzel) {
    const ziel = norm(sauber(text)).replace(/[…:.\s]+$/, "");
    if (!ziel) return null;
    let best = null, bestLen = 1e9;
    const kandidaten = (wurzel || document).querySelectorAll("button, label, summary, .section-collapse-header, .field-label, option, a, h3, h4, [title], .anim-pille, span");
    for (const el of kandidaten) {
      const eigen = norm(sauber(el.textContent || "")).replace(/[…:.\s]+$/, "");
      const tit = norm(sauber(el.getAttribute && el.getAttribute("title") || "")).replace(/[…:.\s]+$/, "");
      if (eigen === ziel || (eigen.startsWith(ziel) && eigen.length <= ziel.length + 12) || tit === ziel) {
        const len = (el.textContent || "").length;
        if (len < bestLen) { best = el; bestLen = len; }
      }
    }
    if (best && best.tagName === "OPTION") best = best.closest("select") || best;
    if (best && best.tagName === "SPAN") best = best.closest("button, label, summary, .field, .section-collapse-header") || best;
    return best;
  }

  /* Die wichtigsten Stellen. label/ort/tip: [i18n-Schlüssel, deutscher Rückfall]. finde() liefert das Element (oder
     null), vorher() bereitet vor (Reiter wählen, Editor öffnen), braucht: "track" (geladene Tour) | "auswahl"
     (markierte Fotos), markiere(el) → das Element, das leuchten soll. kopfLink: false = Handbuch-Abschnitte mit gleich
     lautender Überschrift bekommen KEIN „Zeig mir“ auf dieses Ziel (zu allgemeine Wörter wie „Einstellungen“). */
  const KAMERA = [["animator.section.camera", "Kamera"], ["animator.kamera.fuehrung", "Kameraführung"]];
  const pille = (art) => () => $(`#anim-kamera-art [data-kamera-art="${art}"]`);
  const ZIELE = [
    { id: "kamera_folgen", modul: "animator", label: ["einfach.k_folgen", "Folgen"], ort: KAMERA, tip: ["einfach.k_folgen_t", "Kamera fliegt mit"], finde: pille("folgen") },
    { id: "kamera_fahrt", modul: "animator", label: ["einfach.k_fahrt", "Kamerafahrt"], ort: KAMERA, tip: ["einfach.k_fahrt_t", "Überblick → Flug → Schlussblick"], finde: pille("fahrt") },
    { id: "kamera_fest", modul: "animator", label: ["einfach.k_fest", "Fest"], ort: KAMERA, tip: ["einfach.k_fest_t", "ganze Tour im Blick"], finde: pille("fest") },
    { id: "kamera_startziel", modul: "animator", label: ["einfach.k_startziel", "Start → Ziel"], ort: KAMERA, tip: ["einfach.k_startziel_t", "über dem Start, dann in einer ruhigen Fahrt zum Ziel"], finde: pille("startziel") },
    { id: "keyframes", modul: "animator", label: ["animator.kf.enable_label", "Keyframe-Editor"], ort: [["animator.section.camera", "Kamera"], ["animator.mehr", "Mehr"]],
      tip: ["animator.kf.enable_tooltip", ""], finde: () => $("#anim-kf-enabled"), markiere: reihe },
    { id: "track_farben", modul: "animator", braucht: "track", label: ["animator.colors.einstieg", "Farbe nach Tempo, Höhe oder Steigung …"],
      ort: [["animator.section.tours", "Tracks"], ["frag.ort.track_editor", "Track-Editor (Stift am Track)"]], tip: ["animator.colors.einstieg_tip", ""],
      vorher: async () => { if (window.__rzAnimTrackEditor) window.__rzAnimTrackEditor("haupt"); await pause(200); },
      finde: () => $("#anim-track-editor [data-fw-einstieg]") || $("#anim-track-editor .tred-mehrfarbig") },
    { id: "laufpunkt_symbol", modul: "animator", braucht: "track", label: ["animator.dot.lb_sym", "Symbol nach Aktivität (aus dem Logbuch)"],
      ort: [["animator.section.tours", "Tracks"], ["frag.ort.track_editor", "Track-Editor (Stift am Track)"]], tip: ["animator.dot.lb_sym_tip", ""],
      vorher: async () => { if (window.__rzAnimTrackEditor) window.__rzAnimTrackEditor("haupt"); await pause(200); },
      finde: () => { const z = $("#anim-track-editor [data-lb-sym-zeile]"); if (z && !z.hidden) return z; const d = $('#anim-track-editor [data-stil="dot_show"]'); return d ? reihe(d) : null; } },
    { id: "aufnahmezeit", modul: "library", braucht: "auswahl", label: ["zeitaendern.ctx_1", "Aufnahmezeit ändern …"], ort: [["fotos.titel", "Medien"]],
      tip: ["frag.z.aufnahmezeit_tip", "Fotos und Clips markieren, dann Aufnahmezeit für alle auf einmal verschieben oder fest setzen."],
      vorher: segment("lib-seg-fotos"), finde: () => $('#foto-markleiste [data-ml="zeit"]') },
    { id: "video_export", modul: "animator", label: ["animator.hauptaktion", "Video exportieren"], ort: [], tip: ["frag.z.video_export_tip", "Öffnet den Export-Dialog: Format, Auflösung, Qualität und Speicherort."],
      finde: () => $("#anim-hauptaktion") },
    { id: "seitenverhaeltnis", modul: "animator", label: ["animator.format.seitenverhaeltnis", "Seitenverhältnis"], ort: [["animator.section.format", "Format & Ablauf"]],
      tip: ["frag.z.seitenverhaeltnis_tip", "16:9 für YouTube, 9:16 für Reels und Shorts, unter „Weitere …“ 1:1, 4:5, 4:3, 21:9 oder ein eigenes Format."],
      finde: () => $("#anim-format-art"), markiere: reihe },
    { id: "videolaenge", modul: "animator", label: ["frag.z.videolaenge", "Videolänge"], ort: [["animator.section.format", "Format & Ablauf"]], tip: null,
      finde: () => $("#anim-dauer-feld") },
    { id: "kartenlook", modul: "animator", label: ["look.titel", "Look"], ort: [["animator.section.map", "Karte"]], tip: ["look.hilfe", ""],
      finde: () => $("#anim-gesamtlook-field") },
    { id: "overlays", modul: "animator", label: ["animator.section.overlays", "Overlays"], ort: [], tip: ["frag.z.overlays_tip", "Einblendungen im Video: Tempo, Höhe, Distanz, Uhrzeit, Höhenprofil, Minikarte."],
      finde: abschnittKopf('#anim-panel [data-accordion-section="overlays"]') },
    // 19.10.2026 (Audit) — Highlights und Doppelte: Neulingsfragen („Ortsnamen anzeigen“, „doppelte Touren löschen“) fanden sie nicht
    { id: "highlights", modul: "animator", label: ["animator.hl.title", "Highlights"], ort: [["animator.section.overlays", "Overlays"]],
      tip: ["frag.z.highlights_tip", "Gipfel, Aussichtspunkte, Orte und Pässe entlang der Strecke als Schilder im Video."],
      finde: () => $("#anim-hl-on"), markiere: reihe },
    { id: "etappe", modul: "animator", label: ["animator.etappe.neu", "Etappe erstellen"], ort: [["animator.section.tours", "Tracks"]],
      tip: ["animator.etappe.neu_tip", "Eine geplante Strecke ohne GPS-Aufzeichnung: Anreise, Flug, Fähre, Autofahrt."],
      finde: () => $("#anim-etappe-neu") },
    { id: "fotostopps", modul: "animator", label: ["animator.section.signs_photos", "Schilder und Fotos"], ort: [], tip: ["frag.z.fotostopps_tip", "Fotostopps: Fotos der Tour erscheinen im Video an ihrem Ort, dazu Schilder mit Text."],
      finde: abschnittKopf("#anim-signs-section") },
    { id: "logbuch", modul: "animator", label: ["animator.section.logbuch", "Logbuch im Video"], ort: [], tip: ["frag.z.logbuch_tip", "Das Logbuch erkennt Abschnitte (Fahrt, Pause, Wanderung) und zeigt sie im Video."],
      finde: abschnittKopf("#anim-lb-section") },
    { id: "musik", modul: "animator", label: ["animator.section.ton", "Musik und Ton"], ort: [], tip: ["frag.z.musik_tip", "Musik unter das Video legen, Lautstärke, Klick bei Fotostopps."],
      finde: abschnittKopf("#anim-ton-section") },
    { id: "schnellvideo", modul: "animator", label: ["schnell.knopf", "Schnell-Video …"], ort: [], tip: ["schnell.knopf_tip", ""], finde: () => $("#anim-schnellvideo") },
    { id: "videoassistent", modul: "animator", label: ["assistent.knopf", "Video-Assistent …"], ort: [], tip: ["va.knopf_tip", ""], finde: () => $("#anim-videoassistent") },
    { id: "importassistent", modul: "library", label: ["ia.knopf", "Import-Assistent …"], ort: [["pm.seg_archive", "Touren-Archiv"]],
      tip: ["frag.z.importassistent_tip", "Tour, Fotos und Clips aus einem Ordner Schritt für Schritt übernehmen."],
      vorher: segment("lib-seg-touren"), finde: () => $("#lib-import-assistent") },
    { id: "medien", kopfLink: false, modul: "library", label: ["fotos.titel", "Medien"], ort: [], tip: ["frag.z.medien_tip", "Alle Fotos und Clips: Ordner einlesen, nach Datum, Ort oder Inhalt suchen."],
      finde: () => $("#lib-seg-fotos") },
    { id: "doppelte", modul: "library", label: ["library.duplicates", "Doppelte finden"], ort: [["pm.seg_archive", "Touren-Archiv"]],
      tip: ["frag.z.doppelte_tip", "Gleiche Touren im Archiv finden und wegräumen — die Datei bleibt, nur der doppelte Eintrag geht."],
      vorher: segment("lib-seg-touren"), finde: () => $("#lib-dupes") },
    { id: "projekte", kopfLink: false, modul: "library", label: ["pm.title", "Projekte"], ort: [], tip: null, finde: () => $("#lib-seg-projekte") },
    { id: "vorlagen", kopfLink: false, modul: "library", label: ["vorlagen.titel", "Vorlagen"], ort: [], tip: null, finde: () => $("#lib-seg-vorlagen") },
    { id: "geotagger", modul: "geotagger", label: ["modules.geotagger.name", "Geotagger"], ort: [], tip: ["modules.geotagger.desc", "Fotos mit GPS taggen"],
      finde: () => $('#module-tabs .mod-btn[data-mod="geotagger"]') },
    { id: "tourmap", modul: "tourmap", label: ["modules.tourmap.name", "Tour-Map"], ort: [], tip: ["modules.tourmap.desc", "Statische Karten-PNG"],
      finde: () => $('#module-tabs .mod-btn[data-mod="tourmap"]') },
    { id: "datenanimator", modul: "heightanim", label: ["modules.heightanim.name", "Daten-Animator"], ort: [], tip: ["modules.heightanim.desc", ""],
      finde: () => $('#module-tabs .mod-btn[data-mod="heightanim"]') },
    { id: "gpxinspektor", modul: "gpxinspect", label: ["modules.gpxinspect.name", "GPX-Inspektor"], ort: [], tip: ["modules.gpxinspect.desc", ""],
      finde: () => $('#module-tabs .mod-btn[data-mod="gpxinspect"]') },
    { id: "webkarte", modul: "webkarte", label: ["modules.webkarte.name", "Web Karte"], ort: [], tip: ["modules.webkarte.desc", ""],
      finde: () => $('#module-tabs .mod-btn[data-mod="webkarte"]') },
    { id: "einstellungen", kopfLink: false, modul: null, label: ["topbar.settings", "Einstellungen"], ort: [], tip: ["frag.z.einstellungen_tip", "Sprache, Kartenanbieter und Schlüssel, Render-Qualität, Bibliothek."],
      finde: () => $("#topbar-settings") },
  ];
  const ZIEL = new Map(ZIELE.map(z => [z.id, z]));

  /** Zur Stelle springen. Ergebnis {ok, grund}: grund = "track" | "auswahl" | "unsichtbar" | "unbekannt". */
  async function zeigMir(zielOderDoc) {
    let z = typeof zielOderDoc === "string" ? ZIEL.get(zielOderDoc) : zielOderDoc;
    if (z && z.typ === "ui" && z.art === "label") {   // Beschriftung ohne Tabelleneintrag: im Modul suchen
      const d = z, text = d.titel;
      z = { id: "label:" + d.schluessel, modul: d.modul === "settings" ? null : d.modul,
        vorher: d.modul === "settings" ? async () => { if (window.openSettingsModal) await window.openSettingsModal(); await pause(300); } : null,
        finde: () => sucheLabel(text, d.modul === "settings" ? $("#modal-overlay") : $("#main")) };
    }
    if (!z) return { ok: false, grund: "unbekannt" };
    log("info", "Zeig mir: " + z.id);
    if (z.modul && z.modul !== aktivesModul() && typeof window.switchMod === "function") {
      window.switchMod(z.modul);
      await pause(250);
    }
    if (z.braucht === "track" && !(await warteBis(trackGeladen, 600))) return { ok: false, grund: "track" };
    if (z.vorher) { try { await z.vorher(); } catch (e) { log("warn", "vorher " + z.id + ": " + e); } }
    let el = await warteBis(z.finde, z.braucht === "auswahl" ? 700 : 3000);
    if (!el) return { ok: false, grund: z.braucht === "auswahl" ? "auswahl" : "unsichtbar" };
    if (z.markiere) el = z.markiere(el) || el;
    // Detail-Spalte/Editor gleiten noch herein: kurz nachsehen, bevor es „nicht zu sehen“ heißt
    if (!(await aufdecken(el)) && !(await warteBis(() => sichtbar(el), 1500))) return { ok: false, grund: z.braucht === "track" && !trackGeladen() ? "track" : "unsichtbar" };
    hervorheben(el);
    return { ok: true, el };
  }

  // ── Oberfläche ──────────────────────────────────────────────────────────
  let box = null, sel = 0, treffer = [], suchTimer = 0;
  const offen = () => !!(box && !box.hidden);
  function aufbauen() {
    if (box) return box;
    box = document.createElement("div");
    box.id = "rz-frag";
    box.className = "rz-frag";
    box.hidden = true;
    box.innerHTML = `
      <div class="rz-frag-karte" role="dialog" aria-label="${esc(T("frag.titel", "Frag GPS Studio"))}">
        <div class="rz-frag-kopf">
          <span class="rz-frag-lupe">${I("search", 18)}</span>
          <input id="rz-frag-eingabe" type="text" autocomplete="off" spellcheck="false" role="combobox" aria-controls="rz-frag-liste" aria-expanded="true">
          <kbd class="rz-frag-kbd">Esc</kbd>
          <button type="button" class="rz-frag-x" id="rz-frag-x">${I("x", 16)}</button>
        </div>
        <div class="rz-frag-status" id="rz-frag-status" aria-live="polite"></div>
        <ul class="rz-frag-liste" id="rz-frag-liste" role="listbox"></ul>
        <div class="rz-frag-fuss">
          <span class="rz-frag-tasten" id="rz-frag-tasten"></span>
          <button type="button" class="rz-frag-hb" id="rz-frag-handbuch">${I("book-open", 14)} <span></span></button>
        </div>
      </div>`;
    document.body.appendChild(box);
    const ein = box.querySelector("#rz-frag-eingabe");
    box.addEventListener("mousedown", (e) => { if (e.target === box) schliessen(); });
    box.querySelector("#rz-frag-x").addEventListener("click", () => schliessen());
    box.querySelector("#rz-frag-handbuch").addEventListener("click", () => handbuchOeffnen(""));
    ein.addEventListener("input", () => { clearTimeout(suchTimer); suchTimer = setTimeout(suchenUndZeigen, 60); });
    box.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); schliessen(); return; }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault(); e.stopPropagation();
        if (!treffer.length) return;
        sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + treffer.length) % treffer.length;
        auswahlZeigen();
        return;
      }
      if (e.key === "Enter" && !e.isComposing) {
        if (e.target && e.target.closest && e.target.closest("button")) return;   // Knopf mit Fokus: dessen Klick
        e.preventDefault(); e.stopPropagation();
        if (treffer[sel]) hauptaktion(sel);
        else { const v = ein.value.trim(); if (v) suchenUndZeigen(); }
      }
    });
    box.querySelector("#rz-frag-liste").addEventListener("click", (e) => {
      const li = e.target.closest("[data-i]"); if (!li) return;
      const i = +li.dataset.i;
      if (e.target.closest("[data-zeig]")) { zeigen(i); return; }
      if (e.target.closest("[data-hb]")) { handbuchOeffnen(treffer[i].doc.anker || ""); return; }
      if (e.target.closest("[data-beispiel]")) return;
      hauptaktion(i);
    });
    return box;
  }
  function texteSetzen() {
    const ein = box.querySelector("#rz-frag-eingabe");
    ein.placeholder = T("frag.platzhalter", "Frag GPS Studio … z. B. „Video in 9:16“");
    ein.setAttribute("aria-label", T("frag.titel", "Frag GPS Studio"));
    box.querySelector("#rz-frag-x").title = T("common.close", "Schließen");
    box.querySelector("#rz-frag-tasten").textContent = T("frag.tasten", "↑↓ auswählen · ↵ öffnen · Esc schließen");
    box.querySelector("#rz-frag-handbuch span").textContent = T("frag.ganzes_handbuch", "Ganzes Handbuch");
  }
  function statusZeigen(text, spinner) {
    if (!box) return;
    const st = box.querySelector("#rz-frag-status");
    if (text === undefined) {
      const lade = IX && IX.hb === "laedt";
      text = lade ? T("frag.laedt", "Handbuch wird gelesen …") : "";
      spinner = lade;
    }
    st.innerHTML = text ? (spinner ? '<span class="spinner"></span> ' : "") + esc(text) : "";
    st.hidden = !text;
  }
  function beispieleZeigen() {
    const ul = box.querySelector("#rz-frag-liste");
    const b = String(T("frag.beispiele", "wie ändere ich das Datum vieler Fotos|Kamera folgt dem Track|Video in 9:16|Farbe nach Tempo")).split("|").filter(Boolean);
    treffer = []; sel = 0;
    ul.innerHTML = `<li class="rz-frag-beispiele"><span class="muted">${esc(T("frag.beispiele_titel", "Zum Beispiel:"))}</span>
      ${b.map(x => `<button type="button" class="rz-frag-chip" data-beispiel="${esc(x)}">${esc(x)}</button>`).join("")}</li>`;
    ul.querySelectorAll("[data-beispiel]").forEach(k => k.addEventListener("click", () => {
      const ein = box.querySelector("#rz-frag-eingabe"); ein.value = k.dataset.beispiel; ein.focus(); suchenUndZeigen();
    }));
  }
  function suchenUndZeigen() {
    if (!box) return;
    const frage = box.querySelector("#rz-frag-eingabe").value.trim();
    if (!frage) { beispieleZeigen(); return; }
    const t0 = performance.now();
    treffer = suchen(frage, 8);
    box.dataset.ms = String(Math.round(performance.now() - t0));
    sel = 0;
    const ul = box.querySelector("#rz-frag-liste");
    if (!treffer.length) {
      ul.innerHTML = `<li class="rz-frag-leer">${esc(T("frag.nichts", "Nichts gefunden. Probier andere Wörter — oder öffne das ganze Handbuch."))}</li>`;
      return;
    }
    const sp = IX.sp;
    ul.innerHTML = treffer.map((r, i) => {
      const d = r.doc, hb = d.typ === "hb";
      const titel = hb ? (d.kopf || "") : d.titel;
      const pfad = hb ? [T("frag.handbuch", "Handbuch")].concat(d.pfad || []) : [T("frag.in_der_app", "In der App")].concat(d.pfad || []);
      const zielId = d.ziel || r.ziel;
      const kannZeigen = !!(zielId || d.art === "label");
      const text = hb ? d.text : (d.text || "");
      return `<li class="rz-frag-treffer" role="option" data-i="${i}" id="rz-frag-t${i}">
        <span class="rz-frag-art">${I(hb ? "book-open" : "mouse-pointer-click", 15)}</span>
        <div class="rz-frag-inhalt">
          <div class="rz-frag-titel">${schnipsel(titel, r.treffer, sp, 40)}</div>
          <div class="rz-frag-pfad">${pfad.map(esc).join(" › ")}</div>
          ${text ? `<div class="rz-frag-schnipsel">${schnipsel(text, r.treffer, sp)}</div>` : ""}
          <div class="rz-frag-meldung" hidden></div>
        </div>
        <div class="rz-frag-knoepfe">
          ${kannZeigen ? `<button type="button" class="btn btn-sm rz-frag-zeig" data-zeig title="${esc(T("frag.zeig_mir_tip", "Springt zur Stelle in der App und hebt sie hervor"))}">${I("locate-fixed", 14)} ${esc(T("frag.zeig_mir", "Zeig mir"))}</button>` : ""}
          ${hb ? `<button type="button" class="btn btn-sm btn-ghost rz-frag-hb-knopf" data-hb title="${esc(T("frag.im_handbuch", "Im Handbuch öffnen"))}">${I("external-link", 14)}</button>` : ""}
        </div>
      </li>`;
    }).join("");
    auswahlZeigen();
  }
  function auswahlZeigen() {
    box.querySelectorAll(".rz-frag-treffer").forEach((li, i) => {
      li.classList.toggle("is-sel", i === sel);
      li.setAttribute("aria-selected", i === sel ? "true" : "false");
    });
    const li = box.querySelector("#rz-frag-t" + sel);
    if (li) { li.scrollIntoView({ block: "nearest" }); box.querySelector("#rz-frag-eingabe").setAttribute("aria-activedescendant", li.id); }
  }
  function hauptaktion(i) {
    const r = treffer[i]; if (!r) return;
    if (r.doc.typ === "ui") zeigen(i);
    else handbuchOeffnen(r.doc.anker || "");
  }
  function handbuchOeffnen(anker) {
    const a = (typeof api === "function") ? api() : null;
    if (!a || !a.open_user_guide) return;
    Promise.resolve(a.open_user_guide(anker || "")).catch((e) => log("warn", "Handbuch öffnen: " + e));   // warte-ok: öffnet den Browser, kehrt sofort zurück
  }
  const GRUND = {
    track: ["frag.braucht_track", "Dafür muss eine Tour geladen sein — öffne zuerst eine Tour im Archiv oder über „Track wählen …“."],
    auswahl: ["frag.braucht_auswahl", "„Aufnahmezeit ändern …“ erscheint, sobald Fotos markiert sind: im Archiv unter „Medien“ Fotos mit ⌘-Klick markieren — dann steht der Knopf in der Leiste darüber (auch im Rechtsklick-Menü)."],
    unsichtbar: ["frag.nicht_sichtbar", "Diese Stelle ist gerade nicht zu sehen — sie erscheint erst in einer bestimmten Lage (anderes Modul, geladene Tour oder gewählte Option)."],
    unbekannt: ["frag.nicht_sichtbar", "Diese Stelle ist gerade nicht zu sehen."],
  };
  async function zeigen(i) {
    const r = treffer[i]; if (!r) return;
    const li = box.querySelector("#rz-frag-t" + i);
    const knopf = li && li.querySelector("[data-zeig]");
    if (knopf) knopf.disabled = true;
    const ziel = r.doc.ziel || r.ziel || r.doc;
    // Panel weg, damit die Stelle frei liegt; bei einem Hindernis kommt es mit der Erklärung zurück
    box.classList.add("ist-unterwegs");
    let erg;
    try { erg = await zeigMir(ziel); } catch (e) { log("warn", "Zeig mir: " + e); erg = { ok: false, grund: "unbekannt" }; }
    box.classList.remove("ist-unterwegs");
    if (knopf) knopf.disabled = false;
    if (erg.ok) { schliessen(); return; }
    box.querySelector("#rz-frag-eingabe").focus();   // Tastatur (Esc, Pfeile) bleibt beim Panel
    const [k, f] = GRUND[erg.grund] || GRUND.unbekannt;
    const m = li && li.querySelector(".rz-frag-meldung");
    let text = T(k, f);
    if (erg.grund === "auswahl" && !IST_MAC) text = text.replace("⌘", T("frag.strg", "Strg"));
    if (m) { m.innerHTML = I("info", 13) + " " + esc(text); m.hidden = false; }
    box.dataset.grund = erg.grund;
  }

  function oeffnen(text) {
    aufbauen();
    texteSetzen();
    try { indexBauen(); } catch (e) { log("warn", "Index: " + e); }
    box.hidden = false;
    box.dataset.grund = "";
    document.body.classList.add("rz-frag-offen");
    const ein = box.querySelector("#rz-frag-eingabe");
    if (typeof text === "string") ein.value = text;
    statusZeigen();
    suchenUndZeigen();
    requestAnimationFrame(() => { ein.focus(); ein.select(); });
  }
  function schliessen() {
    if (!box || box.hidden) return;
    box.hidden = true;
    document.body.classList.remove("rz-frag-offen");
  }

  // Esc schließt auch, wenn der Fokus gerade nicht im Panel liegt (nach einem Klick daneben)
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !offen() || box.contains(document.activeElement)) return;
    e.preventDefault(); e.stopImmediatePropagation(); schliessen();
  }, true);
  // ⌘K / Strg+K — vor allen Modulen (Fensterphase, früh registriert): der Animator legt auf „K“ einen Keyframe
  window.addEventListener("keydown", (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || String(e.key || "").toLowerCase() !== "k") return;
    if (typeof window.rzWartet === "function" && window.rzWartet()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (offen()) { const ein = box.querySelector("#rz-frag-eingabe"); ein.focus(); ein.select(); }
    else oeffnen();
  }, true);

  /** Fragefeld-Knopf in der Kopfzeile (neben ⚙). */
  function kopfKnopf() {
    const ziel = document.querySelector(".topbar-actions");
    if (!ziel || document.getElementById("topbar-frag")) return;
    const b = document.createElement("button");
    b.type = "button"; b.id = "topbar-frag"; b.className = "topbar-frag";
    b.innerHTML = `${I("search", 14)}<span class="topbar-frag-text"></span><kbd class="topbar-frag-kbd"></kbd>`;
    b.addEventListener("click", () => oeffnen());
    ziel.insertBefore(b, ziel.firstChild);
    kopfKnopfTexte();
  }
  const leisteMessen = () => { if (typeof passeTabsAnBreiteAn === "function") passeTabsAnBreiteAn(); };
  function kopfKnopfTexte() {
    const b = document.getElementById("topbar-frag"); if (!b) return;
    b.querySelector(".topbar-frag-text").textContent = T("frag.knopf", "Frag GPS Studio …");
    b.querySelector(".topbar-frag-kbd").textContent = taste();
    b.title = T("frag.knopf_tip", "Handbuch und Knöpfe durchsuchen ({taste})").replace("{taste}", taste());
    leisteMessen();   // längerer Text in einer anderen Sprache: Modulleiste neu messen
  }
  /** Fragefeld für andere Fenster (Erste Schritte): Eingabe + Enter öffnet die Suche mit dem Text. */
  function feldHtml(id) {
    return `<div class="rz-frag-feld">${I("search", 15)}<input type="text" id="${id}" autocomplete="off" spellcheck="false"
      placeholder="${esc(T("frag.platzhalter", "Frag GPS Studio … z. B. „Video in 9:16“"))}"><kbd>${esc(taste())}</kbd></div>`;
  }
  function feldVerbinden(id, vorher) {
    const ein = document.getElementById(id); if (!ein) return;
    const los = () => { const v = ein.value; if (typeof vorher === "function") vorher(); oeffnen(v); };
    ein.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); los(); } });
    ein.addEventListener("input", () => { if (ein.value.trim().length >= 2) los(); });
  }

  window.rzFrag = {
    oeffnen, schliessen, offen, zeigMir, feldHtml, feldVerbinden, kopfKnopfTexte,
    /** Prüfstand: Treffer als einfache Liste {typ, titel, pfad, anker, ziel, score}. */
    suchen: (frage, max) => suchen(frage, max).map(r => ({ typ: r.doc.typ, art: r.doc.art || "", titel: r.doc.typ === "hb" ? r.doc.kopf : r.doc.titel,
      pfad: r.doc.pfad || [], anker: r.doc.anker || "", ziel: r.doc.ziel || r.ziel || "", score: Math.round(r.score * 100) / 100 })),
    handbuchBereit: () => (IX ? IX.hb : "aus"),
    indexNeu: () => { IX = null; hbLauf = null; },
    ziele: () => ZIELE.map(z => z.id),
    _stamm: stamm,
  };
  // Sprache geladen/gewechselt: Kopfzeilen-Knopf neu beschriften, Index beim nächsten Öffnen neu bauen
  window.addEventListener("rz-i18n-ready", () => { kopfKnopfTexte(); if (IX && IX.sp !== sprache()) { IX = null; hbLauf = null; } });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", kopfKnopf);
  else kopfKnopf();
})();
