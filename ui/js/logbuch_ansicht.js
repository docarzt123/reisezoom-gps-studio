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

  // ── EIN Menü und EIN Frage-Dialog für Logbuch-Einträge (24.10.2026, Marc: „ein Logbuch für alles“) ──────────────
  // Tourseite und GPX-Inspektor bauen ihr Menü hier; jede zeigt es in ihrer gewohnten Form. `U` (Umgebung) liefert,
  // was die Ansicht kann:
  //   aktion(label, was, params, opt) → Promise   einteilung_aktion + eigenes Rückgängig der Ansicht
  //   frage(titel, wert, mehrzeilig, ortHaken)    → Promise<string | {wert, alsOrt} | null>
  //   liste()                                     → Einträge (Nachbarn fürs Zusammenlegen)
  //   titel(x) · karteZeigen(x) · alsTour(x) · punktLoeschen(x)          (optional)
  //   teilenStellen(x) → [{t, text}] · vorAlsTour(x) / hinten(x) → weitere Menüpunkte  (Inspektor: hier, Anker A …)
  // Ein Menüpunkt: { sym: Strich-Symbol | symHtml, text, tu, aus, unter, art } · { kopf } · "-"
  function frageDialog(titelText, wert, mehrzeilig, ortHaken, pf) {
    pf = pf || "lba";
    return new Promise((res) => {
      const feld = mehrzeilig ? `<textarea id="${pf}-frage" class="${pf}-frage" rows="4">${esc(wert || "")}</textarea>` : `<input id="${pf}-frage" class="${pf}-frage" type="text" value="${esc(wert || "")}">`;
      // 22.10.2026 (Marc: „beim Umbenennen mit einem Haken zu ‚Meine Orte‘ hinzufügen“)
      const haken = ortHaken ? `<label class="lba-orthaken"><input type="checkbox" id="${pf}-frage-ort"> ${esc(T("logbuch.als_mein_ort", "Zu „Meine Orte“ hinzufügen — wird in allen Logbüchern erkannt"))}</label>` : "";
      const m = openModal({ title: titelText, body: `<div class="lib-fmodal">${feld}${haken}</div>`,
        footer: `<button class="btn" id="${pf}-frage-nein">${esc(T("common.cancel", "Abbrechen"))}</button><button class="btn btn-primary" id="${pf}-frage-ja">${esc(T("common.ok", "OK"))}</button>` });
      const el = document.getElementById(pf + "-frage"), fertig = (v) => {
        const h = document.getElementById(pf + "-frage-ort"), alsOrt = !!(h && h.checked);
        try { m.close(); } catch (_) {}
        res(ortHaken ? (v == null ? null : { wert: v, alsOrt }) : v);
      };
      document.getElementById(pf + "-frage-ja").onclick = () => fertig(el ? el.value : "");
      document.getElementById(pf + "-frage-nein").onclick = () => fertig(null);
      if (el) { el.focus(); try { el.select(); } catch (_) {} if (!mehrzeilig) el.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); fertig(el.value); } }); }
    });
  }
  /** Bearbeitbar? Abschnitte und alle Punkte (Start „Campingplatz“); löschen lassen sich alle Punkte außer Start und
   *  Ziel — ein gelöschter höchster Punkt bleibt weg, auch beim Neuberechnen. */
  const bearbeitbar = (x) => !!x && (istPunkt(x) ? !!x.id : !!(x.bids && x.bids.length));
  async function umbenennen(x, U) {
    const p = istPunkt(x), art = x.anzeige_art || x.art, pos = x.pos || x.pos_von;
    const ortTauglich = !p && !!pos && ["pause", "uebernachtung", "halt"].includes(art);
    const v = await U.frage(T("logbuch.frage.name", "Name"), x.name || x.mein_ort || (U.titel ? U.titel(x) : ""), false, ortTauglich);
    if (v == null) return;
    const name = String(ortTauglich ? v.wert : v).trim(), label = T("logbuch.undo.umbenennen", "Logbuch: umbenennen");
    if (ortTauglich && v.alsOrt && name) {
      const r = await api().meine_orte_speichern({ name, lat: pos[1], lon: pos[0] }).catch(() => null);   // warte-ok: eine Zeile in den Einstellungen
      if (r && r.ok && typeof toast === "function") toast(T("logbuch.ort_gemerkt", "„{n}“ steht jetzt in „Meine Orte“.", { n: name }), "success", 3500);
      return U.aktion(label, "aendern", { bids: x.bids, name: "" });   // der Eintrag heißt dann über den Ort
    }
    return U.aktion(label, "aendern", p ? { bid: x.id, name } : { bids: x.bids, name });
  }
  function menueEintraege(x, U) {
    const M = []; if (!bearbeitbar(x)) return M;
    const p = istPunkt(x), art = x.anzeige_art || x.art;
    // 14.09.2026 (Marc: „wie kann ich vermutete Bewegungsarten bestätigen?“) — ganz oben
    if (!p && x.geraten) {
      M.push({ sym: "check", text: T("logbuch.menue.bestaetigen", "{art} bestätigen", { art: artName(art) }),
               tu: () => U.aktion(T("logbuch.undo.bestaetigen", "Logbuch: Art bestätigt"), "bestaetigen", { teile: [{ bids: x.bids, art }] }) });
      M.push("-");
    }
    if (p && U.karteZeigen) M.push({ sym: "map", text: T("logbuch.menue.karte_zeigen", "Auf der Karte zeigen"), tu: () => U.karteZeigen(x) });
    M.push({ sym: "pencil", text: T("logbuch.menue.umbenennen", "Umbenennen …"), tu: () => umbenennen(x, U) });
    M.push({ sym: "notebook-pen", text: T("logbuch.menue.notiz", "Notiz …"), tu: async () => {
      const v = await U.frage(T("logbuch.frage.notiz", "Notiz"), x.notiz || "", true);
      if (v == null) return;
      U.aktion(T("logbuch.undo.notiz", "Logbuch: Notiz"), "aendern", p ? { bid: x.id, notiz: String(v).trim() } : { bids: x.bids, notiz: String(v).trim() });
    } });
    if (p) {
      const weg = !["start", "ziel"].includes(x.art);
      if (weg) M.push("-");
      if (weg) M.push({ sym: "trash-2", text: T("logbuch.menue.punkt_loeschen", "Punkt löschen"), tu: () => U.punktLoeschen ? U.punktLoeschen(x)
        : U.aktion(T("logbuch.undo.punkt_loeschen", "Logbuch: Punkt löschen"), "bereich_entfernen", { bid: x.id }, { auswahl: null }) });
      for (const e of (U.hinten ? U.hinten(x) : [])) M.push(e);
      return M;
    }
    M.push("-"); M.push({ kopf: T("logbuch.menue.art", "Art ändern") });
    for (const a of HAND_ARTEN) {
      if (a === art) continue;
      M.push({ unter: true, art: a, symHtml: `<span class="lba-menue-sym" style="--c:${farbe(a)}">${I(SYMBOL[a] || "map-pin", 14)}</span>`, text: artName(a),
               tu: () => U.aktion(T("logbuch.undo.art", "Logbuch: Art ändern"), "aendern", { bids: x.bids, art: a }) });
    }
    // 24.09.2026 — was dieser Abschnitt im Video tut; dieselbe Einstellung wie „Logbuch im Video“ im Animator
    M.push("-"); M.push({ kopf: T("logbuch.menue.im_video", "Im Video") });
    for (const [wert, sym, text] of [["", "eye", T("animator.lb.standard", "zeigen (Standard)")], ["blass", "eye-off", T("animator.lb.blass", "blass")],
                                     ["raffen", "fast-forward", T("animator.lb.raffen", "raffen (×8)")], ["ueberspringen", "skip-forward", T("animator.lb.ueberspringen", "überspringen")]]) {
      const ist = (x.anzeige || "") === wert || (x.anzeige === "zeigen" && wert === "");
      M.push({ unter: true, sym: ist ? "check" : sym, text, aus: ist,
               tu: () => U.aktion(T("logbuch.undo.im_video", "Logbuch: Anzeige im Video"), "aendern", { bids: x.bids, anzeige: wert }) });
    }
    M.push("-");
    const teilbar = (tt) => tt != null && tt > x.t0 + 30 && tt < x.t1 - 30;
    const teilen = (tt) => U.aktion(T("logbuch.undo.teilen", "Logbuch: Aktivität teilen"), "teilen_zeit", { t: tt });
    for (const e of (U.teilenStellen ? U.teilenStellen(x) : [])) if (teilbar(e.t)) M.push({ sym: "scissors", text: e.text, tu: () => teilen(e.t) });
    M.push({ sym: "scissors", text: T("logbuch.menue.teilen_uhrzeit", "Aktivität bei Uhrzeit teilen …"), tu: async () => {
      const v = await U.frage(T("logbuch.frage.uhrzeit", "Uhrzeit (Ortszeit), z. B. 12:30"), uhr((x.t0 + x.t1) / 2, x.versatz_min));
      if (v == null) return;
      const m = /^(\d{1,2})[:.](\d{2})$/.exec(String(v).trim());
      if (!m) { if (typeof toast === "function") toast(T("logbuch.uhrzeit_ungueltig", "Bitte eine Uhrzeit wie 12:30 eingeben."), "warn"); return; }
      // die Uhrzeit auf den Tag des Eintragsbeginns legen (Ortszeit); liegt sie davor, ist der nächste Tag gemeint
      const tag0 = datum(x.t0, x.versatz_min); tag0.setUTCHours(parseInt(m[1], 10), parseInt(m[2], 10), 0, 0);
      let tt = tag0.getTime() / 1000 - (x.versatz_min || 0) * 60;
      if (tt < x.t0) tt += 86400;
      if (!teilbar(tt)) { if (typeof toast === "function") toast(T("logbuch.uhrzeit_ausserhalb", "Diese Uhrzeit liegt nicht in diesem Eintrag."), "warn"); return; }
      await teilen(tt);
    } });
    M.push({ sym: "scissors", text: T("logbuch.menue.teilen_mitte", "Aktivität in der Mitte teilen"), aus: !teilbar((x.t0 + x.t1) / 2), tu: () => teilen((x.t0 + x.t1) / 2) });
    const liste = (U.liste ? U.liste() : []).filter((e) => !istPunkt(e) && e.bids && e.bids.length).slice().sort((a, b) => a.t0 - b.t0);
    const k = liste.findIndex((e) => e.id === x.id), vor = k > 0 ? liste[k - 1] : null, nach = k >= 0 ? liste[k + 1] || null : null;
    const legen = T("logbuch.undo.zusammenlegen", "Logbuch: zusammenlegen");
    M.push({ sym: "arrow-left", text: T("logbuch.menue.mit_vorherigem", "Mit vorherigem zusammenlegen"), aus: !vor,
             tu: () => U.aktion(legen, "zusammenlegen", { bid_a: vor.bids[vor.bids.length - 1], bid_b: x.bids[0] }, { auswahl: null }) });
    M.push({ sym: "arrow-right", text: T("logbuch.menue.mit_naechstem", "Mit nächstem zusammenlegen"), aus: !nach,
             tu: () => U.aktion(legen, "zusammenlegen", { bid_a: x.bids[x.bids.length - 1], bid_b: nach.bids[0] }, { auswahl: null }) });
    const vorTour = U.vorAlsTour ? U.vorAlsTour(x) : [];
    if (vorTour.length || U.alsTour) {
      M.push("-");
      for (const e of vorTour) M.push(e);
      // 14.09.2026 (Beta-Tester: Autofahrt und Wanderung in einer Datei) — den Eintrag als eigene Tour
      if (U.alsTour) M.push({ sym: "inbox", text: T("logbuch.menue.als_tour", "Als eigene Tour ins Archiv …"), tu: () => U.alsTour(x) });
    }
    M.push("-");
    M.push({ sym: "trash-2", text: T("logbuch.menue.loeschen", "Löschen (geht im Nachbarn auf)"),
             tu: () => U.aktion(T("logbuch.undo.loeschen", "Logbuch: löschen"), "aufgehen", { bids: x.bids }, { auswahl: null }) });
    for (const e of (U.hinten ? U.hinten(x) : [])) M.push(e);
    return M;
  }
  /** Vorschlag für den Namen einer neuen Tour aus einem Eintrag: „Wanderung 27.7.2026“. */
  function tourVorschlag(x) {
    const tag = datum(x.t0, x.versatz_min);
    return x.name || (artName(x.anzeige_art || x.art) + " " + tag.getUTCDate() + "." + (tag.getUTCMonth() + 1) + "." + tag.getUTCFullYear());
  }

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
  // ── EINE Liste (24.10.2026, „ein Logbuch für alles“) ────────────────────────────────────────────────────
  // Tourseite und GPX-Inspektor zeigen dieselben Zeilen und Tagesabschnitte. `c` (Umgebung):
  //   orte · gewaehlt(id) → bool · gewKlasse (Inspektor „ist-gewaehlt“, wie Zeitstrahl und Karte) · details (Höhenmeter,
  //   Tempo — Inspektor) · punktSymbol(p) → HTML (eigene Punkte mit eigenem Symbol) · tagKlick (Tageskopf als Knopf)
  // Jede Zeile trägt `data-lba-id` und — für die Kopplung im Inspektor — `data-lb`.
  function eintragHtml(x, c) {
    c = c || {};
    const orte = c.orte || {}, p = istPunkt(x), art = p ? x.art : (x.anzeige_art || x.art), o = ortVon(orte, x);
    const zeit = p ? uhr(x.t, x.versatz_min) : (uhr(x.t0, x.versatz_min) + "–" + uhr(x.t1, x.versatz_min));
    const meta = [];
    if (x.name) meta.push(esc(artName(art)));   // eigener Name („Gipfelweg“) — die Art steht dann hier
    if (o.text) meta.push(esc(o.text));
    if (!p) { meta.push(esc(dauer(x.dauer_s))); if (x.strecke_m > 50) meta.push(esc(km(x.strecke_m))); }
    if (!p && c.details && x.hoehe_auf >= 20) meta.push("↑" + x.hoehe_auf + " m");
    if (!p && c.details && x.tempo_kmh && x.art !== "pause") meta.push(esc(x.tempo_kmh.toLocaleString(sprache(), { maximumFractionDigits: 1 }) + " km/h"));
    if (!p && x.stau_s >= 120) meta.push(esc(T("logbuch.stau", "davon {n} min Stau", { n: Math.round(x.stau_s / 60) })));
    // 24.10.2026 — warum diese Art: der Weg darunter hat entschieden
    if (!p && x.grund) meta.push(esc(T("logbuch.grund." + x.grund, { autobahn: "auf der Autobahn", faehre: "auf einer Fährlinie", radweg: "auf Radwegen" }[x.grund] || "")));
    const marken = [];
    // „vermutet“ ist ein Knopf: bestätigen oder eine andere Art wählen (wie bisher im Inspektor)
    if (!p && x.geraten) marken.push(`<button type="button" class="lba-badge lba-vermutet" data-vermutet="${esc(x.id)}" title="${esc(T("logbuch.geraten_tip2", "Die Erkennung war hier unsicher. Klick: bestätigen oder eine andere Art wählen."))}">${esc(T("logbuch.geraten", "vermutet"))}</button>`);
    if (x.roh) marken.push(`<span class="lba-badge">${esc(T("logbuch.roh", "roh"))}</span>`);
    // 24.09.2026 — Anzeige im Video, wenn nicht „zeigen“
    const imVideo = { blass: ["eye-off", T("animator.lb.blass", "blass")], raffen: ["fast-forward", T("animator.lb.raffen", "raffen (×8)")],
                      ueberspringen: ["skip-forward", T("animator.lb.ueberspringen", "überspringen")] }[x.anzeige || ""];
    if (imVideo) marken.push(`<span class="lba-badge" data-im-video="${esc(x.anzeige)}" title="${esc(T("logbuch.menue.im_video", "Im Video") + ": " + imVideo[1])}">${I(imVideo[0], 11)} ${esc(imVideo[1])}</span>`);
    const notiz = x.notiz ? `<div class="lba-notiz">${esc(x.notiz)}</div>` : "";
    const sym = p && c.punktSymbol ? c.punktSymbol(x) : symbol(art);
    const gew = c.gewaehlt && c.gewaehlt(x.id) ? " " + (c.gewKlasse || "gewaehlt") : "";
    return `<div class="lba-eintrag${p ? " lba-punkt" : ""}${p && (x.art === "punkt" || x.art === "poi") ? " lba-eigen" : ""}${gew}" data-lba-id="${esc(x.id)}" data-lb="${esc(x.id)}" style="--c:${farbe(art)}" role="button" tabindex="0">
        <span class="lba-symbol">${sym}</span>
        <div class="lba-text"><div class="lba-kopf"><b>${esc(titel(x, orte))}</b><span class="lba-zeit">${esc(zeit)}</span></div>
          <div class="lba-meta">${meta.join(" · ")}${marken.length ? " " + marken.join(" ") : ""}</div>${notiz}</div>
        ${!bearbeitbar(x) || x.roh ? "" : `<button type="button" class="lba-mehr" data-lba-mehr-id="${esc(x.id)}" title="${esc(T("logbuch.menue.titel", "Bearbeiten"))}">${I("ellipsis", 16)}</button>`}
      </div>`;
  }
  /** Nach Zeit; Start und Ziel vor dem Eintrag, der zur selben Zeit beginnt (Ziel 17:37 vor der Übernachtung ab 17:37). */
  function sortiert(liste) {
    const rang = (x) => (x.art === "start" || x.art === "ziel") && istPunkt(x) ? 0 : 1;
    return liste.slice().sort((a, b) => ((a.t0 != null ? a.t0 : a.t) - (b.t0 != null ? b.t0 : b.t)) || (rang(a) - rang(b)));
  }
  /** Die ganze Liste: bei Mehrtagestouren je Tag ein Abschnitt mit Überschrift, die beim Scrollen oben stehen bleibt. */
  function listeHtml(liste, d, c) {
    c = c || {};
    const alle = sortiert(liste || []);
    if (!alle.length) return `<div class="lba-leer">${esc(T("logbuch.leer", "Nichts erkannt — der Track ist zu kurz oder hat keine Bewegung."))}</div>`;
    if (!(d && d.mehrtaegig && (d.tage || []).length > 1)) return alle.map((x) => eintragHtml(x, c)).join("");
    const knopf = c.tagKlick ? ` role="button" tabindex="0" title="${esc(T("logbuch.tag_tip", "Klick: diesen Tag im Zeitstrahl aufziehen"))}"` : "";
    return (d.tage || []).map((tg) => {
      const teil = alle.filter((x) => (x.tag == null ? 1 : x.tag) === tg.nr);
      const m = teil.reduce((s2, x) => s2 + (istPunkt(x) ? 0 : (+x.strecke_m || 0)), 0);
      return `<section class="lba-tagblock" data-lba-tagblock="${tg.nr}">
          <div class="lba-tagkopf" data-lba-tagkopf="${tg.nr}"${knopf}><b>${esc(T("logbuch.tag_kopf", "Tag {n} · {d}", { n: tg.nr, d: tagText(tg.t0, tg.versatz_min, { weekday: "long", day: "numeric", month: "long" }) }))}</b><span>${esc(km(m))}</span></div>
          ${teil.length ? teil.map((x) => eintragHtml(x, c)).join("") : `<div class="lba-leer">${esc(T("logbuch.tag_leer", "An diesem Tag keine Bewegung."))}</div>`}
        </section>`;
    }).join("");
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
    // 24.10.2026 (Marc: „wenn man warten muss, muss halt Feedback dazu kommen“) — was im Hintergrund nachkommt, steht
    // als Zeile über der Liste (Spinner + Text, bei den Wegen mit Zähler); die Liste ist währenddessen schon bedienbar.
    function hinweis(text) {
      Z.hinweis = text || "";
      const el = box.querySelector(".lba-nachladen");
      if (el) { el.hidden = !Z.hinweis; const t2 = el.querySelector(".lba-nachladen-text"); if (t2) t2.textContent = Z.hinweis; }
    }
    async function _orteNachladen(lauf) {
      const merk = () => { const m = _lbMerk.get(opt.path); if (m) m.orte = Z.orte; };
      try {
        hinweis(T("logbuch.netz.orte", "Ortsnamen werden nachgeladen …"));
        const c = await api().logbuch_orte(opt.path, 0);   // warte-ok: nur Cache
        if (lauf === Z.lauf && c && c.ok && JSON.stringify(c.orte || {}) !== JSON.stringify(Z.orte || {})) { Z.orte = c.orte || {}; merk(); render(); }
        const n = await api().logbuch_orte(opt.path, 25);   // warte-ok: Namen kommen nach, Liste steht schon
        if (lauf === Z.lauf && n && n.ok && JSON.stringify(n.orte || {}) !== JSON.stringify(Z.orte || {})) { Z.orte = n.orte || {}; merk(); render(); }
        // Sehenswürdigkeiten am Weg (22.10.2026: die Tourseite fragte sie nie ab — nur der Track-Inspektor tat das).
        // Je Tour in der Bibliothek gemerkt; neue wichtige landen als Punkte im Logbuch → dann neu lesen.
        if (lauf !== Z.lauf) return;
        hinweis(T("logbuch.netz.pois", "Sehenswürdigkeiten am Weg werden gesucht …"));
        const p = await api().logbuch_pois(opt.path, false);   // warte-ok: Logbuch steht schon, Punkte kommen nach (Zeile .lba-nachladen)
        if (lauf === Z.lauf && box.isConnected && p && p.ok && p.im_logbuch > 0) { laden(false); return; }
        // 24.10.2026 — Wegklasse unter dem Track: Stau auf der Autobahn → Fahrt, Fährlinie → Fähre, Radweg → Rad
        if (lauf !== Z.lauf) return;
        const wegeText = T("logbuch.netz.wege", "Wege unter dem Track werden gelesen …");
        hinweis(wegeText);
        const uhr2 = setInterval(async () => {
          if (lauf !== Z.lauf || !box.isConnected) { clearInterval(uhr2); return; }
          const st = await api().logbuch_wege_stand(opt.path).catch(() => null);   // warte-ok: nur Zähler für die Anzeige
          if (st && st.gesamt > 1 && lauf === Z.lauf && Z.hinweis) hinweis(wegeText + " " + T("logbuch.netz.n_von", "{a} von {b}", { a: st.fertig, b: st.gesamt }));
        }, 1000);
        let w = null;
        try { w = await api().logbuch_wege(opt.path, false); } finally { clearInterval(uhr2); }   // warte-ok: Logbuch steht schon (Zeile .lba-nachladen)
        if (lauf === Z.lauf) hinweis("");
        if (lauf === Z.lauf && box.isConnected && w && w.ok && w.geaendert > 0) laden(false);
      } catch (_) { if (lauf === Z.lauf) hinweis(""); }
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
    const umgebung = () => ({ orte: Z.orte, gewaehlt: (id) => id === Z.sel });
    /* 24.10.2026 (Marc: „bei mehreren Tagen einfach weiter scrollen und klar machen, dass ich im nächsten Tag bin“) —
       alle Tage untereinander, je Tag ein Abschnitt mit einer Überschrift, die beim Scrollen oben stehen bleibt, bis der
       nächste Tag sie wegschiebt. Die Tag-Knöpfe springen hin und zeigen, welcher Tag gerade oben steht; die Karte
       (Tourseite, `onTag`) zieht mit. */
    function render() {
      const d = Z.d; if (!d) return;
      const mehr = d.mehrtaegig && (d.tage || []).length > 1;
      const liste = mehr ? alleEintraege() : tagEintraege();
      const oben = box.scrollTop;   // neu gezeichnet wird auch nach Ortsnamen und Änderungen — die Stelle bleibt
      const rueck = Z.rueck ? `<div class="lba-rueck">${esc(Z.rueck.text)} <button type="button" class="btn btn-sm" data-lba-rueck="1">${I("rotate-ccw", 13)} ${esc(T("logbuch.rueckgaengig", "Rückgängig"))}</button></div>` : "";
      box.innerHTML = `<div class="lba">
          <div class="lba-titel">${I("book-open", 18)} <b>${esc(T("logbuch.titel", "Logbuch"))}</b><span class="lba-luft"></span>
            <button type="button" class="btn btn-sm btn-ghost" data-lba-export="pdf" title="${esc(T("logbuch.export_pdf_tip", "Als PDF speichern — Tagebuch der Tour mit allen Tagen"))}">${I("file-down", 14)} PDF</button>
            <button type="button" class="btn btn-sm btn-ghost" data-lba-export="csv" title="${esc(T("logbuch.export_csv_tip", "Als Tabelle (CSV) speichern — für Excel oder Numbers"))}">${I("table", 14)} CSV</button></div>
          <div class="lba-unter muted">${esc(T("logbuch.unter", "Deine Tour, Tag für Tag. Namen und Notizen bleiben überall gleich."))}</div>
          <div class="lba-nachladen muted"${Z.hinweis ? "" : " hidden"}><span class="spinner"></span> <span class="lba-nachladen-text">${esc(Z.hinweis || "")}</span></div>
          <div class="lba-chips">${chipsHtml()}</div>
          ${tageHtml()}
          <div class="lba-liste${mehr ? " lba-mehrtags" : ""}">${listeHtml(liste, mehr ? d : null, umgebung())}</div>
          ${rueck}
          <div class="lba-fuss muted">${esc(T("logbuch.fuss_art", "Hier: Namen und Art ändern, Notizen ergänzen, Einträge verbinden. Track-Reparaturen bleiben im GPX-Inspektor."))}</div>
        </div>`;
      box.scrollTop = oben;
      binden();
    }
    // Welcher Tag steht oben? Der Abschnitt, der die obere Kante der Spalte (plus etwas Luft) überdeckt.
    function tagOben() {
      const bl = box.querySelectorAll("[data-lba-tagblock]"); if (!bl.length) return null;
      const kante = box.getBoundingClientRect().top + 24;
      let nr = +bl[0].dataset.lbaTagblock;
      for (const b of bl) { if (b.getBoundingClientRect().top <= kante) nr = +b.dataset.lbaTagblock; else break; }
      return nr;
    }
    function tagKnoepfe() { box.querySelectorAll("[data-lba-tag]").forEach((b) => b.classList.toggle("an", +b.dataset.lbaTag === Z.tag)); }
    let _tagMeldenT = 0;
    function tagSetzen(nr, sofort) {
      if (nr == null || nr === Z.tag) return;
      Z.tag = nr; tagKnoepfe();
      // die Karte passt sich an den Tag an — beim Scrollen erst, wenn er eine Weile oben steht (sonst ruckt sie mit)
      clearTimeout(_tagMeldenT);
      const melden = () => { if (opt.onTag && box.isConnected) opt.onTag(Z.tag); };
      if (sofort) melden(); else _tagMeldenT = setTimeout(melden, 250);
    }
    let _springBis = 0, _scrollRaf = 0;
    box.addEventListener("scroll", () => {
      if (_scrollRaf || performance.now() < _springBis) return;
      _scrollRaf = requestAnimationFrame(() => { _scrollRaf = 0; tagSetzen(tagOben(), false); });
    }, { passive: true });
    function zumTag(nr) {
      const b = box.querySelector(`[data-lba-tagblock="${nr}"]`);
      if (!b) { tagSetzen(nr, true); return; }
      _springBis = performance.now() + 900;   // während der Fahrt nicht über die Tage dazwischen melden
      box.scrollTo({ top: b.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop, behavior: "smooth" });
      tagSetzen(nr, true);
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
      box.querySelectorAll("[data-lba-tag]").forEach((b) => { b.onclick = () => zumTag(+b.dataset.lbaTag); });
      const mehr = box.querySelector("[data-lba-mehr]"); if (mehr) mehr.onclick = () => { Z.alleTage = true; render(); };
      box.querySelectorAll("[data-lba-id]").forEach((el) => {
        const w = () => waehlen(el.dataset.lbaId, true);
        el.onclick = (ev) => { if (ev.target.closest("[data-lba-mehr-id], [data-vermutet]")) return; w(); };
        el.onkeydown = (ev) => { if (ev.key === "Enter") w(); };
      });
      box.querySelectorAll("[data-lba-mehr-id]").forEach((b) => { b.onclick = (ev) => { ev.stopPropagation(); menue(b.dataset.lbaMehrId, b); }; });
      box.querySelectorAll("[data-vermutet]").forEach((b) => { b.onclick = (ev) => { ev.stopPropagation(); menue(b.dataset.vermutet, b); }; });
      const r = box.querySelector("[data-lba-rueck]"); if (r) r.onclick = rueckgaengig;
    }
    function finde(id) { return alleEintraege().find((x) => x.id === id) || null; }
    function waehlen(id, vonKlick) {
      const x = finde(id); if (!x) return;
      // alle Tage stehen untereinander: nur die Markierung umstellen, nicht neu zeichnen (die Stelle bleibt)
      Z.sel = id;
      box.querySelectorAll(".lba-eintrag.gewaehlt").forEach((e) => e.classList.remove("gewaehlt"));
      const el = box.querySelector(`[data-lba-id="${CSS.escape(id)}"]`);
      if (el) el.classList.add("gewaehlt"); else render();
      if (Z.d && Z.d.mehrtaegig && x.tag != null && x.tag !== Z.tag) {
        if (!vonKlick) _springBis = performance.now() + 900;
        Z.tag = x.tag; tagKnoepfe();
      }
      if (el && !vonKlick) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      if (opt.onWahl) opt.onWahl(x);
    }

    // ── Bearbeiten (gleiche Brücke wie der Inspektor, eigenes Rückgängig) ──
    const frage = (titelText, wert, mehrzeilig, ortHaken) => frageDialog(titelText, wert, mehrzeilig, ortHaken, "lba");
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
    // „Als eigene Tour ins Archiv“ — die Punkte holt die Tourseite einmal über die Brücke des Inspektors
    async function alsTour(x) {
      const name = await frage(T("gpxinspect.ab_archiv_name", "Name der neuen Tour"), tourVorschlag(x));
      if (name == null || !String(name).trim()) return;
      if (!Z.punkte) {
        const r = await rzWarten("gpxinspect_load", () => api().gpxinspect_load(opt.path)).catch(() => null);
        Z.punkte = r && r.ok ? { liste: r.points || [], src: r.src || opt.path } : null;
      }
      const pts = ((Z.punkte && Z.punkte.liste) || []).filter((q) => { const z = q.time ? Date.parse(q.time) / 1000 : NaN; return z >= x.t0 && z <= x.t1; });
      if (pts.length < 2) { if (typeof toast === "function") toast(T("gpxinspect.abschnitt_zu_kurz", "Der Abschnitt braucht mindestens zwei Punkte."), "warn"); return; }
      const payload = pts.map((q) => ({ lat: q.lat, lon: q.lon, ele: q.ele, time: q.time, oi: q.i, si: 0 }));
      const r = await rzWarten("archiv_abschnitt_aufnehmen", () => api().archiv_abschnitt_aufnehmen(payload, Z.punkte.src, String(name).trim(), null, x.anzeige_art || x.art || ""),
        { titel: T("warte.archiv_abschnitt_aufnehmen.titel", "Neue Tour wird angelegt"), text: T("warte.archiv_abschnitt_aufnehmen.text", "Der Abschnitt wird ins Archiv aufgenommen") }).catch((e) => ({ ok: false, error: String(e) }));
      if (typeof toast !== "function") return;
      if (r && r.ok) toast(T("logbuch.als_tour_ok", "„{name}“ liegt jetzt als eigene Tour im Archiv.", { name: r.name }), "success", 5000);
      else toast((r && r.error) || T("gpxinspect.ab_archiv_fehler", "Die Tour konnte nicht angelegt werden."), "error", 6000);
    }
    function menue(id, anker) {
      const x = finde(id); if (!x) return;
      const pkt = menueEintraege(x, { aktion, frage, liste: () => Z.d.eintraege || [], titel: (y) => titel(y, Z.orte), alsTour,
                                      karteZeigen: (y) => waehlen(y.id, false) });
      if (!pkt.length) return;
      document.querySelectorAll(".lba-menue").forEach((m) => m.remove());
      const m = document.createElement("div");
      m.className = "lib-ctxmenu lba-menue"; m.setAttribute("role", "menu");
      for (const e of pkt) {
        if (e === "-") { m.appendChild(document.createElement("hr")); continue; }
        if (e.kopf) { const k = document.createElement("div"); k.className = "lba-menue-kopf"; k.textContent = e.kopf; m.appendChild(k); continue; }
        const b = document.createElement("button"); b.type = "button"; b.className = "lib-ctx-item" + (e.unter ? " lba-menue-unter" : ""); b.setAttribute("role", "menuitem");
        b.innerHTML = (e.symHtml || (e.sym ? `<span class="lba-menue-sym">${I(e.sym, 14)}</span>` : "")) + esc(e.text);
        if (e.art) b.dataset.lbaArt = e.art;
        if (e.aus) b.disabled = true;
        b.onclick = () => { zu(); try { e.tu(); } catch (err) { console.warn("[logbuch] Menü:", err); } }; m.appendChild(b);
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
    return { waehlen, neuLaden: () => laden(false), daten: () => Z.d, tagEintraege, titel: (x) => titel(x, Z.orte), tag: () => Z.tag, auswahl: () => Z.sel };
  }

  // 11.10.2026 (Schritt 9) — der GPX-Inspektor nimmt Symbole, Namen und Titel von hier (eine Quelle für alle Module)
  window.rzLogbuchAnsicht = { zeichnen, uhr, tagText, dauer, km, listeHtml, eintragHtml, menueEintraege, frageDialog, bearbeitbar, tourVorschlag, istPunkt, symbolName: (a) => SYMBOL[a] || "map-pin", farbe, artName, titel, handArten: HAND_ARTEN.slice(),
    symbolHtml: (a, g) => I(SYMBOL[a] || "map-pin", g || 16) };
})();
