/* rzstyle.js — Videovorlagen als .rzstyle-Datei exportieren und einlesen (02.11.2026)
 *
 * Marc: „könnte man auf dem Desktop Vorlagen bauen und die ins iPhone übernehmen? das wäre doch was“ — die iPhone-App
 * zeichnet dieselben Einblendungen (ui/js/container.js) und liest Vorlagen als Datei. Hier wird die Vorlage gebaut:
 * eingebaute in 16:9, 9:16 und 1:1 mit Platzhaltern statt Texten ({title}, {subtitle}, {kicker}, {t:<key>}),
 * eigene in dem Format, in dem sie gemerkt wurden (Projekttitel → {title}). Namen und Übersetzungen ergänzt das
 * Backend (core/rzstyle.py), es schreibt auch die Datei. Format: docs/DEVELOPER.md, „rzstyle file format“.
 *
 *   await rzStyle.exportieren("fernweh")            // eingebaute Vorlage → Sichern-Dialog
 *   await rzStyle.exportieren({ eigen: E })         // eigene Vorlage (Eintrag aus videovorlagen_eigen)
 *   await rzStyle.alleExportieren()                 // die zehn eingebauten in einen Ordner (<id>.rzstyle)
 *   const r = await rzStyle.importieren("16:9")     // Dateien wählen → eigene Vorlagen; r.liste = neue Liste
 */
(function () {
  "use strict";
  const FORMATE = ["16:9", "9:16", "1:1"];
  const api = () => (window.pywebview && window.pywebview.api) || {};
  const T = (k, d, p) => (typeof t === "function" ? t(k, d, p) : d);
  const meldung = (text, art, ms) => { if (typeof toast === "function") toast(text, art || "info", ms || 4000); };

  /** Schriften, die eine Liste von Einblendungen benutzt (ids aus container.js SCHRIFTEN). */
  function schriften(listen) {
    const s = new Set();
    for (const liste of listen) for (const c of liste || []) {
      if (c && c.schrift) s.add(String(c.schrift));
      for (const z of (c && c.zeilen) || []) if (z && z.schrift) s.add(String(z.schrift));
    }
    return [...s].sort();
  }
  /** Kartenbild der Vorlage (ui/img/vorlagen/<id>.jpg, Teide-Tour) als kleines JPEG — fehlt es, ohne Vorschau. */
  function vorschau(id) {
    return new Promise((fertig) => {
      const img = new Image();
      img.onload = () => {
        try {
          const cv = document.createElement("canvas"); cv.width = 480; cv.height = 270;
          cv.getContext("2d").drawImage(img, 0, 0, 480, 270);
          fertig(cv.toDataURL("image/jpeg", 0.82));
        } catch (_) { fertig(null); }
      };
      img.onerror = () => fertig(null);
      img.src = (window.__rzAssetBase || "") + "img/vorlagen/" + encodeURIComponent(id) + ".jpg";
    });
  }
  /** Eingebaute Vorlage in allen drei Formaten bauen. Gibt { stil, schluessel } zurück. */
  async function eingebaut(id) {
    const VV = window.rzVideoVorlagen;
    const V = VV && VV.LISTE.find(x => x.id === id);
    if (!V) throw new Error("unbekannte Vorlage " + id);
    const schluessel = {};
    // Platzhalter-Übersetzer: merkt sich jeden benutzten Schlüssel samt deutschem Ersatztext
    const tp = (k, d) => { schluessel[k] = typeof d === "string" ? d : String(d == null ? "" : d); return "{t:" + k + "}"; };
    const formats = {};
    let animator = null;
    for (const f of FORMATE) {
      const R = VV.bauen(id, { titel: "{title}", unter: "{subtitle}", kicker: "{kicker}", format: f, t: tp,
                               intro_s: 3, hold_s: 4, logo: { an: true } });   // Dauern = Standard des Video-Assistenten
      if (!R) continue;
      formats[f] = { container: R.container, verlauf: R.verlauf };
      animator = animator || R.animator;
    }
    return {
      stil: { id, name: V.name, builtin: true, palette: V.palette, animator, formats,
              fonts: schriften(Object.values(formats).map(x => x.container)), preview: await vorschau(id) },
      schluessel,
    };
  }
  /** Eigene Vorlage: das gemerkte Format; der Projekttitel (titel_alt) wird zum Platzhalter {title}. */
  function eigen(E) {
    const D = (E && E.daten) || {};
    const alt = String(D.titel_alt || "");
    const container = JSON.parse(JSON.stringify(D.container || []));
    if (alt) container.forEach(c => (c.zeilen || []).forEach(z => { if (z && z.typ === "text" && z.text === alt) z.text = "{title}"; }));
    const f = FORMATE.concat(["4:5", "4:3", "21:9"]).indexOf(D.format) >= 0 ? D.format : "16:9";
    return {
      stil: { id: E.id, name: E.name, builtin: false, palette: null, animator: D.animator || {}, formats: { [f]: { container, verlauf: D.verlauf || null } },
              fonts: schriften([container]), preview: null },
      schluessel: {},
    };
  }
  async function exportieren(quelle) {
    let b;
    try { b = typeof quelle === "string" ? await eingebaut(quelle) : eigen(quelle && quelle.eigen); }
    catch (e) { meldung(T("rzstyle.fehler_bauen", "Die Vorlage ließ sich nicht als Datei bauen.") + " (" + e + ")", "error", 5000); return null; }
    const name = typeof quelle === "string" ? T("vv.name." + quelle, b.stil.name) : b.stil.name;
    let r;
    try { r = await api().rzstyle_exportieren(b.stil, b.schluessel, name); }   // warte-ok: Sichern-Dialog, danach sofort
    catch (e) { r = { ok: false, error: String(e) }; }
    if (r && r.ok) meldung(T("rzstyle.gespeichert", "Stil gespeichert: {datei}", { datei: String(r.pfad || "").split(/[\\/]/).pop() }), "success", 3500);
    else if (r && !r.abgebrochen) meldung((r && r.error) || T("rzstyle.fehler_schreiben", "Konnte die Datei nicht schreiben."), "error", 5000);
    try { applog("info", "[rzstyle] export " + (typeof quelle === "string" ? quelle : "eigen") + " → " + (r && (r.pfad || (r.abgebrochen ? "abgebrochen" : r.error)))); } catch (_) {}
    return r;
  }
  async function alleExportieren(ordner) {
    const VV = window.rzVideoVorlagen;
    if (!VV) return null;
    const stile = [], schluessel = {};
    try {
      for (const V of VV.LISTE) { const b = await eingebaut(V.id); stile.push(b.stil); Object.assign(schluessel, b.schluessel); }
    } catch (e) { meldung(T("rzstyle.fehler_bauen", "Die Vorlage ließ sich nicht als Datei bauen.") + " (" + e + ")", "error", 5000); return null; }
    let r;
    try { r = await api().rzstyle_alle_exportieren(stile, schluessel, ordner || ""); }   // warte-ok: Ordner-Dialog, danach sofort
    catch (e) { r = { ok: false, error: String(e) }; }
    if (r && r.ok) meldung(T("rzstyle.alle_gespeichert", "{n} Stile gespeichert in {ordner}", { n: (r.dateien || []).length, ordner: r.ordner }), "success", 4500);
    else if (r && !r.abgebrochen) meldung((r && r.error) || T("rzstyle.fehler_schreiben", "Konnte die Datei nicht schreiben."), "error", 5000);
    try { applog("info", "[rzstyle] alle eingebauten → " + (r && (r.ordner || r.error || "abgebrochen"))); } catch (_) {}
    return r;
  }
  async function importieren(format) {
    let r;
    try { r = await api().rzstyle_importieren(format || ""); }   // warte-ok: Öffnen-Dialog, danach sofort
    catch (e) { r = { ok: false, error: String(e) }; }
    if (!r || r.abgebrochen) return r;
    const neu = r.neu || [], fehler = r.fehler || [];
    if (neu.length) meldung(T("rzstyle.importiert", "Als eigene Videovorlage übernommen: {namen}", { namen: neu.join(", ") }), "success", 4500);
    if (fehler.length) meldung(T("rzstyle.import_fehler", "Nicht übernommen: {liste}", { liste: fehler.map(f => f.datei + " (" + f.grund + ")").join(", ") }), "error", 6000);
    if (!neu.length && !fehler.length && r.error) meldung(r.error, "error", 5000);
    try { applog("info", "[rzstyle] import: " + neu.length + " neu, " + fehler.length + " Fehler"); } catch (_) {}
    return r;
  }

  window.rzStyle = { exportieren, alleExportieren, importieren, eingebaut, eigen, FORMATE };
})();
