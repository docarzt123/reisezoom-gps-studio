/* Einfache Ansicht des Animators (05.10.2026).
 *
 * Marc (Roadmap 05.10.2026): „Erst muss der Unterbau stehen; einfache Ebenen sind ein Layer obendrauf" — fünf Schritte
 * Route → Look → Orte & Fotos → Kamera → Export, „Feinarbeit" = der volle Animator, DIESELBEN Daten
 * („integriert statt parallel neu gebaut").
 *
 * Deshalb hat diese Datei keine eigenen Einstellungen: jeder Schritt bedient die vorhandenen Felder/Knöpfe des
 * Animators (gleiche Speicherung, gleiches Undo, gleiche Vorschau). Umschalter „Einfach / Feinarbeit" oben in der
 * Seitenleiste; die Wahl wird global gemerkt (settings.animator_ansicht). Tour-Map (Standbild) bleibt unverändert.
 */
(function () {
  "use strict";
  const T = (k, f) => (typeof t === "function" ? t(k, f) : f);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const $ = (id) => document.getElementById(id);
  const SCHRITTE = ["route", "look", "fotos", "kamera", "export"];
  // I-005 benannte Formate (MapAnimator-Vergleich): YouTube, Reel/Short, Quadrat, Instagram, klassisch, Kino
  const FORMATE = [["16:9", 1920, 1080], ["9:16", 1080, 1920], ["1:1", 1080, 1080], ["4:5", 1080, 1350], ["4:3", 1440, 1080], ["21:9", 2520, 1080]];
  let schritt = "route";

  // 06.10.2026 (Marc: „ich würde nicht einfach/Feinarbeit machen in der Sidebar, sondern einen Button für den
  // Video-Assistenten") — Umschalter abgeschaltet; die fünf Schritte gehen später im Assistenten-Quiz auf (F-14).
  // Nur Tests schalten sie mit window.__rzEinfachAn = true wieder ein.
  const an = () => window.__rzEinfachAn === true;
  function ansicht() {
    if (!an()) return "feinarbeit";
    try { return (typeof _settingsCache !== "undefined" && _settingsCache && _settingsCache.animator_ansicht) || "feinarbeit"; } catch (_) { return "feinarbeit"; }
  }
  function ansichtMerken(a) {
    try { if (typeof _settingsCache !== "undefined" && _settingsCache) _settingsCache.animator_ansicht = a; } catch (_) {}
    try { if (typeof saveSettings === "function") saveSettings({ animator_ansicht: a }); } catch (_) {}
  }

  /** Wert in ein vorhandenes Feld schreiben und dessen Ereignisse auslösen (Speichern/Undo/Vorschau wie von Hand). */
  function feld(id, wert) {
    const e = $(id); if (!e) return false;
    if (e.type === "checkbox") e.checked = !!wert; else e.value = String(wert);
    e.dispatchEvent(new Event("input", { bubbles: true }));
    e.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  const klick = (sel) => { const e = document.querySelector(sel); if (e) e.click(); return !!e; };

  function formatJetzt() {
    const w = +($("anim-w") || {}).value || 0, h = +($("anim-h") || {}).value || 0;
    const f = FORMATE.find(([, fw, fh]) => Math.abs(fw / fh - w / Math.max(1, h)) < 0.01);
    return f ? f[0] : "";
  }
  function formatSetzen(name) {
    const f = FORMATE.find(x => x[0] === name); if (!f) return;
    const gross = (+($("anim-w") || {}).value || 0) >= 2160 || (+($("anim-h") || {}).value || 0) >= 2160 ? 2 : 1;   // 4K bleibt 4K
    feld("anim-w", f[1] * gross); feld("anim-h", f[2] * gross);
  }

  function kameraJetzt() {
    const kf = !!($("anim-kf-enabled") || {}).checked, folgt = !!($("anim-camera-follow") || {}).checked;
    const vorgabe = ((window.rzReadModuleSettings && window.rzReadModuleSettings("animator")) || {}).kamera_vorgabe;
    return kf ? (vorgabe === "startziel" ? "startziel" : "fahrt") : folgt ? "folgen" : "fest";
  }
  /** 07.10.2026 (PLAN §3, MapAnimator „Start → Ziel“) — die Kamera steht über dem Start und gleitet in einer ruhigen
   *  Bewegung zum Ziel; Höhe eine Stufe näher als der Überblick, Norden oben. Zwei Keyframes, frei änderbar. */
  function startZielKeyframes(start, ziel, bbox) {
    const r = Math.PI / 180, d = (a, b) => 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(Math.sin((b[1] - a[1]) * r / 2) ** 2
      + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin((b[0] - a[0]) * r / 2) ** 2)));
    const diag = bbox ? d([bbox[0], bbox[1]], [bbox[2], bbox[3]]) : d(start, ziel);
    const z = Math.max(0.6, Math.min(3.5, Math.log2(Math.max(0.5, diag) / 2) - 0.3));
    const ev = [];
    for (const [a, c] of [[0, start], [1, ziel]]) {
      ev.push({ kind: "pitch", anchor: a, value: 40, easing: "ease_in_out" });
      ev.push({ kind: "bearing", anchor: a, value: 0, easing: "ease_in_out" });
      ev.push({ kind: "zoom", anchor: a, value_offset: Math.round(z * 100) / 100, easing: "ease_in_out" });
      ev.push({ kind: "center", anchor: a, value: c.slice(), easing: "ease_in_out" });
    }
    return ev;
  }
  /** Kamera-Vorgaben: Fest · Folgen · Kamerafahrt (wie im Schnell-Video, als bearbeitbare Keyframes). */
  function kameraSetzen(art, opt) {
    if (art === "fest" || art === "folgen") {
      // 19.10.2026 (Klicktest) — ein Klick des Nutzers = EIN ⌘Z-Schritt. Über zwei Felder nacheinander lagen zwei Schritte
      // auf dem Stapel, das erste ⌘Z nach „Folgen“ landete im nie gesehenen Zwischenstand „Fest, Editor aus“.
      // Nur für Klicks (opt.einSchritt): interne Aufrufer setzen mitten in einem größeren Ablauf und nutzen weiter die Felder.
      const ctrl = window.__rzUndoControllers && window.__rzUndoControllers.animator;
      const a = opt && opt.einSchritt && window.rzReadModuleSettings && window.rzReadModuleSettings("animator");
      if (a && ctrl && typeof ctrl.applyState === "function") {
        ctrl.applyState(Object.assign({}, a, { keyframes_enabled: false, camera_follow_track: art === "folgen" }),
          art === "folgen" ? T("einfach.k_folgen", "Folgen") : T("einfach.k_fest", "Fest"));
        return;
      }
      feld("anim-kf-enabled", false); feld("anim-camera-follow", art === "folgen"); return;
    }
    // Kamerafahrt: Überblick → Flug entlang der Strecke → Schlussblick (ein Undo-Schritt über den Animator)
    try {
      const ctrl = window.__rzUndoControllers && window.__rzUndoControllers.animator;
      const a = (window.rzReadModuleSettings && window.rzReadModuleSettings("animator")) || {};
      // 19.10.2026 — „Fest“/„Folgen“ lassen die Keyframes ruhen (Editor aus). Kommt danach dieselbe Art wieder, gilt die
      // vorhandene Fahrt wieder — exakt, nicht neu erzeugt (vorher ersetzte aus → an eine eigene oder aus Schnell-Video/
      // Assistent übernommene Fahrt ohne Frage). Eine andere Art (Kamerafahrt ↔ Start → Ziel) erzeugt wie bisher neu.
      const ruhend = !($("anim-kf-enabled") || {}).checked && typeof window.rzEigeneKeyframesGespeichert === "function"
        && window.rzEigeneKeyframesGespeichert();
      if (ruhend && (art === "startziel") === (a.kamera_vorgabe === "startziel")) { feld("anim-kf-enabled", true); return; }
      const bbox = window.__rzEinfachBbox ? window.__rzEinfachBbox() : null;
      if (art === "startziel") {
        const sz = window.__rzStartZiel ? window.__rzStartZiel() : null;
        if (!ctrl || !sz) return;
        ctrl.applyState(Object.assign({}, a, { keyframes_enabled: true, camera_follow_track: false, kamera_vorgabe: "startziel",
          timeline_events: startZielKeyframes(sz[0], sz[1], bbox) }), T("einfach.k_startziel", "Start → Ziel"));
        return;
      }
      if (!ctrl || !window.__rzSchnellKamerafahrt || !bbox) { feld("anim-camera-follow", true); return; }
      const animS = +a.duration_s || 20;
      const neu = Object.assign({}, a, { keyframes_enabled: true, camera_follow_track: true, kamera_vorgabe: "fahrt",
        timeline_events: window.__rzSchnellKamerafahrt(bbox, animS, null, { hold_s: isFinite(+a.hold_s) ? +a.hold_s : undefined }) });
      ctrl.applyState(neu, T("einfach.kamera_undo", "Kamerafahrt"));
      setTimeout(() => { try { if (window.__rzSchnellKamera) window.__rzSchnellKamera(); } catch (_) {} }, 600);
    } catch (e) { try { applog("warn", "[einfach] Kamerafahrt: " + e); } catch (_) {} }
  }

  // wie KF_LANES in module.js: nur diese Ereignisarten gehören zur Kamera, alles andere (Marker …) bleibt
  const KAMERA_LANES = ["pitch", "bearing", "zoom", "center", "position"];
  /** 18.10.2026 (Fahrt neu erzeugen) — ersetzt NUR die Kamera-Keyframes durch eine neue Fahrt: art = "fahrt" (Kamerafahrt
   *  mit opt.flug / opt.lebendig), "startziel" oder "standard" (Standard-Keyframes). Felder laut Art, Blickrichtung
   *  der Kamerafahrt und alles zusammen ein Undo-Schritt. Liefert true = erzeugt, false = nichts geändert. */
  async function fahrtNeu(art, opt) {
    const ctrl = window.__rzUndoControllers && window.__rzUndoControllers.animator;
    const a = (window.rzReadModuleSettings && window.rzReadModuleSettings("animator")) || {};
    const keinTrack = () => { try { if (typeof toast === "function") toast(T("animator.kf.fahrt_neu_kein_track", "Erst eine Tour laden – ohne Strecke gibt es keine Kamerafahrt."), "warn"); } catch (_) {} return false; };
    try {
      if (!ctrl) return false;
      const bbox = window.__rzEinfachBbox ? window.__rzEinfachBbox() : null;
      let kamera, felder, flug = "begleiter";
      if (art === "fahrt") {
        const linie = window.__rzTrackLinie ? window.__rzTrackLinie() : null;
        if (!window.__rzSchnellKamerafahrt || !bbox || !linie) return keinTrack();
        flug = (opt && window.__rzFlugstile && window.__rzFlugstile.stil(opt.flug)) ? opt.flug : "begleiter";
        const lebendig = (opt && isFinite(+opt.lebendig)) ? +opt.lebendig : 0.5;
        kamera = window.__rzSchnellKamerafahrt(bbox, +a.duration_s || 20, null, { flug, lebendig, hold_s: isFinite(+a.hold_s) ? +a.hold_s : undefined }, linie);
        felder = { camera_follow_track: true, kamera_vorgabe: "fahrt" };
      } else if (art === "startziel") {
        const sz = window.__rzStartZiel ? window.__rzStartZiel() : null;
        if (!sz) return keinTrack();
        kamera = startZielKeyframes(sz[0], sz[1], bbox);
        felder = { camera_follow_track: false, kamera_vorgabe: "startziel" };
      } else if (art === "standard") {
        if (!window.__rzStandardKeyframes) return false;
        kamera = window.__rzStandardKeyframes().map((ev) => { const c = Object.assign({}, ev); delete c.standard; return c; });
        felder = { kamera_vorgabe: "fahrt" };   // camera_follow_track bleibt unverändert
      } else return false;
      const behalten = (a.timeline_events || []).filter((e) => !(e && KAMERA_LANES.includes(e.kind)));
      const neu = Object.assign({}, a, felder, { keyframes_enabled: true, timeline_events: behalten.concat(kamera) });
      ctrl.applyState(neu, T("animator.kf.fahrt_neu_undo", "Kamerafahrt neu erzeugt"));
      if (art === "fahrt" && window.__rzSchnellKamera) {
        // Blickrichtung aus der geglätteten Spur — gehört zum selben Undo-Schritt (wie im Video-Assistenten)
        await new Promise((res) => setTimeout(res, 600));
        try { window.__rzUndoApplying = true; window.__rzSchnellKamera(window.__rzFlugstile.kurs(flug)); }
        finally { setTimeout(() => { window.__rzUndoApplying = false; }, 0); }
      }
      return true;
    } catch (e) { try { applog("warn", "[einfach] Fahrt neu: " + e); } catch (_) {} return false; }
  }

  // zuletzt erzeugte Auswahl des Popups — beim nächsten Öffnen vorbelegt (nur bis zum Neuladen der Seite)
  let _fnLetzte = { art: "fahrt", flug: "begleiter", lebendig: 0.5 };
  /** 18.10.2026 (Fahrt neu erzeugen) — Popup „Kamerafahrt neu erzeugen“: Art, Flugstil, Lebendigkeit wählen, dann
   *  fahrtNeu(). opts.onAbbruch wird beim Schließen ohne Erzeugen gerufen (Abbrechen, Esc, ✕, Klick daneben) — genau einmal. */
  function fahrtNeuDialog(opts) {
    const fs = window.__rzFlugstile;
    const cur = Object.assign({}, _fnLetzte);
    if (!fs || !fs.liste.includes(cur.flug)) cur.flug = "begleiter";
    const nKamera = ((window.__rzKeyframes && window.__rzKeyframes.liste()) || []).filter((e) => e && KAMERA_LANES.includes(e.kind)).length;
    const ARTEN = [["fahrt", T("einfach.k_fahrt", "Kamerafahrt")], ["startziel", T("einfach.k_startziel", "Start → Ziel")],
      ["standard", T("animator.kf.fahrt_neu_standard", "Standard-Keyframes")]];
    const flugKarten = (fs ? fs.liste : []).map((k) => {
      const [name, kurz] = fs.text(k);
      return `<button type="button" class="va-bk${k === cur.flug ? " is-on" : ""}" data-fn-flug="${esc(k)}"><span class="va-bk-bild">${fs.clip(k)}</span><b>${esc(name)}</b><span class="va-bk-text">${esc(kurz)}</span></button>`;
    }).join("");
    const body = `<div class="fn-dialog">
      <div class="va-feld-kopf"><span>${esc(T("animator.kf.fahrt_neu_art", "Art"))}</span></div>
      <div class="anim-pillen" id="fn-arten">${ARTEN.map(([a, l]) => `<button type="button" class="anim-pille${a === cur.art ? " is-on" : ""}" data-fn-art="${a}">${esc(l)}</button>`).join("")}</div>
      <div id="fn-fahrt-block"${cur.art === "fahrt" ? "" : " hidden"}>
        <div class="va-feld-kopf"><span>${esc(T("va.k_flug", "Flugstil"))}</span></div>
        <div class="va-karten va-karten-3 va-flugstile" id="fn-flug">${flugKarten}</div>
        <div class="va-feld-kopf"><span>${esc(T("va.k_leb", "Wie lebendig?"))}</span></div>
        <input type="range" class="va-regler" id="fn-leb" min="0" max="1" step="0.05" value="${cur.lebendig}">
        <div class="va-regler-enden"><span>${esc(T("va.k_ruhig_g", "Ruhig & weit"))}</span><span>${esc(T("va.k_lebendig_g", "Lebendig & nah"))}</span></div>
      </div>
      ${nKamera > 0 ? `<p class="muted va-klein" id="fn-hinweis">${esc(T("animator.kf.fahrt_neu_hinweis", "Ersetzt die {n} Keyframes der aktuellen Fahrt – ⌘Z holt sie zurück.").replace("{n}", nKamera))}</p>` : ""}
    </div>`;
    const footer = `<button type="button" class="btn btn-ghost" id="fn-abbrechen">${esc(T("common.cancel", "Abbrechen"))}</button>
      <button type="button" class="btn btn-primary" id="fn-ok">${esc(T("animator.kf.fahrt_neu_ok", "Erzeugen"))}</button>`;
    let erzeugt = false, m = null;
    // 18.10.2026 — Wird das Modal ohne onClose beendet (closeAllModals, überlagernder Dialog), bliebe dieser
    // Listener hängen und verschluckte jedes spätere Esc. Ist der Erzeugen-Knopf dieses Popups nicht mehr im DOM,
    // ist es nicht der oberste sichtbare Dialog: Listener entfernen und Esc durchlassen.
    let okKnopf = null;
    const taste = (e) => {
      if (e.key !== "Escape") return;
      if (!okKnopf || !okKnopf.isConnected) { document.removeEventListener("keydown", taste, true); return; }
      e.preventDefault(); e.stopPropagation(); if (m) m.close();
    };
    m = openModal({ title: T("animator.kf.fahrt_neu_titel", "Kamerafahrt neu erzeugen"), body, footer, onClose: () => {
      document.removeEventListener("keydown", taste, true);
      if (!erzeugt && opts && typeof opts.onAbbruch === "function") { try { opts.onAbbruch(); } catch (_) {} }
    } });
    okKnopf = document.getElementById("fn-ok");
    document.addEventListener("keydown", taste, true);
    const wurzel = document.querySelector("#modal-body .fn-dialog"); if (!wurzel) return;
    wurzel.addEventListener("click", (e) => {
      const a = e.target.closest("[data-fn-art]");
      if (a) {
        cur.art = a.dataset.fnArt;
        wurzel.querySelectorAll("[data-fn-art]").forEach((b) => b.classList.toggle("is-on", b === a));
        wurzel.querySelector("#fn-fahrt-block").hidden = cur.art !== "fahrt";
        return;
      }
      const f = e.target.closest("[data-fn-flug]");
      if (f) { cur.flug = f.dataset.fnFlug; wurzel.querySelectorAll("[data-fn-flug]").forEach((b) => b.classList.toggle("is-on", b === f)); }
    });
    wurzel.querySelector("#fn-leb").addEventListener("input", (e) => { cur.lebendig = +e.target.value; });
    document.getElementById("fn-abbrechen").addEventListener("click", () => m.close());
    document.getElementById("fn-ok").addEventListener("click", () => {
      erzeugt = true; _fnLetzte = Object.assign({}, cur);
      m.close();
      fahrtNeu(cur.art, { flug: cur.flug, lebendig: cur.lebendig });
    });
  }

  function karten(gruppe, liste, aktiv) {
    return `<div class="rz-ef-karten" data-ef-gruppe="${gruppe}">` + liste.map(([wert, titel, text]) =>
      `<button type="button" class="rz-ef-karte${wert === aktiv ? " is-on" : ""}" data-ef-wert="${esc(wert)}"><b>${esc(titel)}</b>${text ? `<span>${esc(text)}</span>` : ""}</button>`).join("") + "</div>";
  }

  function inhalt(s) {
    if (s === "route") {
      let name = "";
      try { const pr = (typeof getActiveProject === "function") ? getActiveProject() : null;
            const g = (typeof getGlobalGpxPath === "function") ? getGlobalGpxPath() : "";
            name = (g ? String(g).split(/[\\/]/).pop().replace(/\.[^.]+$/, "") : "") || (pr && pr.name) || ""; } catch (_) {}
      const dauer = +($("anim-dur") || {}).value || 0;
      return `<p class="muted rz-ef-hinweis">${esc(T("einfach.route_hint", "Welche Tour, wie lang, welches Format?"))}</p>
        ${name ? `<div class="rz-ef-tour">🗺 ${esc(name)}</div>` : ""}
        <button type="button" class="btn btn-small" data-ef-tat="archiv">📁 ${esc(T("einfach.andere_tour", "Andere Tour wählen …"))}</button>
        <label class="field-label">${esc(T("einfach.laenge", "Länge der Fahrt"))}</label>
        ${karten("dauer", [["15", "15 s", ""], ["30", "30 s", ""], ["60", "60 s", ""], ["90", "90 s", ""]], String([15, 30, 60, 90].includes(dauer) ? dauer : ""))}
        <label class="field-label">${esc(T("einfach.format", "Format"))}</label>
        ${karten("format", FORMATE.map(([n]) => [n, n, { "16:9": T("einfach.f_yt", "YouTube"), "9:16": T("einfach.f_reel", "Reel, Short"), "1:1": T("einfach.f_quadrat", "Quadrat"), "4:5": T("einfach.f_insta", "Instagram"), "4:3": T("einfach.f_klassisch", "klassisch"), "21:9": T("einfach.f_kino", "Kino") }[n]]), formatJetzt())}`;
    }
    if (s === "look") {
      const L = window.rzLooks; if (!L) return "";
      const akt = L.erkennen((window.rzReadModuleSettings && window.rzReadModuleSettings("animator")) || {});
      return `<p class="muted rz-ef-hinweis">${esc(T("einfach.look_hint", "Karte, Linie und Schrift in einem Zug — alles bleibt in der Feinarbeit einzeln änderbar."))}</p>
        <div class="rz-look-reihe rz-ef-looks">${L.NAMEN.map(n => { const st = L.kachelStil ? L.kachelStil(n) : ""; return `<button type="button" class="rz-look-knopf${n === akt ? " is-on" : ""}" data-ef-look="${n}"><span class="rz-look-bild rz-look-${n}${st ? " rz-look-svg" : ""}"${st}></span><span>${esc(T("look." + n, n))}</span></button>`; }).join("")}</div>`;
    }
    if (s === "fotos") {
      const hl = !!($("anim-hl-on") || {}).checked;
      return `<p class="muted rz-ef-hinweis">${esc(T("einfach.fotos_hint", "Höhepunkte der Strecke und deine Fotos als Schilder an der Route."))}</p>
        <label class="chk"><input type="checkbox" data-ef-hl${hl ? " checked" : ""}><span>⭐ ${esc(T("einfach.highlights", "Höhepunkte zeigen (höchster Punkt, steilste Stelle, Orte …)"))}</span></label>
        <button type="button" class="btn btn-small" data-ef-tat="fotos">📸 ${esc(T("einfach.fotos_hinzu", "Fotos dieser Tour hinzufügen …"))}</button>
        <button type="button" class="btn btn-small" data-ef-tat="schnell">🎬 ${esc(T("einfach.schnell", "Fotos, Musik und Ablauf automatisch (Schnell-Video) …"))}</button>`;
    }
    if (s === "kamera") {
      return `<p class="muted rz-ef-hinweis">${esc(T("einfach.kamera_hint", "Wie die Kamera der Tour folgt. Keyframes setzt du später in der Feinarbeit."))}</p>
        ${karten("kamera", [["fest", T("einfach.k_fest", "Fest"), T("einfach.k_fest_t", "ganze Tour im Blick")],
                            ["folgen", T("einfach.k_folgen", "Folgen"), T("einfach.k_folgen_t", "Kamera fliegt mit")],
                            ["fahrt", T("einfach.k_fahrt", "Kamerafahrt"), T("einfach.k_fahrt_t", "Überblick → Flug → Schlussblick")]], kameraJetzt())}`;
    }
    if (s === "export") {
      const w = +($("anim-w") || {}).value || 0, h = +($("anim-h") || {}).value || 0;
      return `<p class="muted rz-ef-hinweis">${esc(T("einfach.export_hint", "Alles bereit? Das Video entsteht genau so, wie die Vorschau es zeigt."))}</p>
        <div class="rz-ef-tour">🎞 ${w}×${h} · ${esc(formatJetzt() || "")} · ${esc(String(+($("anim-dur") || {}).value || 0))} s</div>
        <button type="button" class="btn btn-primary btn-block" data-ef-tat="rendern">🎬 ${esc(T("animator.btn.render", "Video rendern"))}</button>`;
    }
    return "";
  }

  function zeichnen() {
    const box = $("rz-einfach"); if (!box) return;
    box.querySelector(".rz-ef-schritte").innerHTML = SCHRITTE.map((s, i) =>
      `<button type="button" class="rz-ef-schritt${s === schritt ? " is-on" : ""}" data-ef-schritt="${s}"><i>${i + 1}</i>${esc(T("einfach.s_" + s, { route: "Route", look: "Look", fotos: "Orte & Fotos", kamera: "Kamera", export: "Export" }[s]))}</button>`).join("");
    box.querySelector(".rz-ef-inhalt").innerHTML = inhalt(schritt);
    const weiter = box.querySelector("[data-ef-weiter]");
    const i = SCHRITTE.indexOf(schritt);
    if (weiter) { weiter.hidden = i >= SCHRITTE.length - 1; weiter.textContent = T("einfach.weiter", "Weiter") + " → " + T("einfach.s_" + SCHRITTE[i + 1], SCHRITTE[i + 1] || ""); }
  }

  function anwenden() {
    const panel = $("anim-panel"); if (!panel) return;
    const einfach = ansicht() === "einfach";
    panel.classList.toggle("rz-einfach-an", einfach);
    const umsch = $("rz-ansicht");
    if (umsch) umsch.querySelectorAll("[data-ansicht]").forEach(b => b.classList.toggle("is-on", b.dataset.ansicht === (einfach ? "einfach" : "feinarbeit")));
    if (einfach) zeichnen();
  }

  function einbauen() {
    const panel = $("anim-panel");
    if (!an() || !panel || panel.querySelector("#rz-ansicht")) return;
    if (window.__rzEinfachErlaubt === false || document.querySelector("#tourmap-html-section")) return;   // Tour-Map/Reiseroute: nicht
    const kopf = document.createElement("div");
    kopf.id = "rz-ansicht"; kopf.className = "rz-ansicht";
    kopf.innerHTML = `<button type="button" data-ansicht="einfach">${esc(T("einfach.einfach", "Einfach"))}</button><button type="button" data-ansicht="feinarbeit">${esc(T("einfach.feinarbeit", "Feinarbeit"))}</button>`;
    const box = document.createElement("div");
    box.id = "rz-einfach"; box.className = "rz-einfach";
    box.innerHTML = `<div class="rz-ef-schritte"></div><div class="rz-ef-inhalt"></div>
      <div class="rz-ef-fuss"><button type="button" class="btn btn-small" data-ef-weiter></button>
      <button type="button" class="btn btn-ghost btn-small" data-ansicht-zu="feinarbeit">${esc(T("einfach.zur_feinarbeit", "Zur Feinarbeit"))}</button></div>`;
    panel.prepend(box); panel.prepend(kopf);
    kopf.addEventListener("click", (e) => {
      const b = e.target.closest("[data-ansicht]"); if (!b) return;
      ansichtMerken(b.dataset.ansicht); anwenden();
      try { applog("info", "[einfach] Ansicht " + b.dataset.ansicht); } catch (_) {}
    });
    box.addEventListener("change", (e) => {
      if (e.target.matches("[data-ef-hl]")) { feld("anim-hl-on", e.target.checked); }
    });
    box.addEventListener("click", (e) => {
      const s = e.target.closest("[data-ef-schritt]"); if (s) { schritt = s.dataset.efSchritt; zeichnen(); return; }
      if (e.target.closest("[data-ef-weiter]")) { const i = SCHRITTE.indexOf(schritt); schritt = SCHRITTE[Math.min(SCHRITTE.length - 1, i + 1)]; zeichnen(); return; }
      if (e.target.closest("[data-ansicht-zu]")) { ansichtMerken("feinarbeit"); anwenden(); return; }
      const lk = e.target.closest("[data-ef-look]");
      if (lk) { klick(`#anim-gesamtlook [data-look="${lk.dataset.efLook}"]`); setTimeout(zeichnen, 50); return; }
      const k = e.target.closest("[data-ef-wert]");
      if (k) {
        const g = k.closest("[data-ef-gruppe]").dataset.efGruppe, v = k.dataset.efWert;
        if (g === "dauer") feld("anim-dur", v);
        if (g === "format") formatSetzen(v);
        if (g === "kamera") kameraSetzen(v, { einSchritt: true });
        setTimeout(zeichnen, 80); return;
      }
      const tat = e.target.closest("[data-ef-tat]"); if (!tat) return;
      const a = tat.dataset.efTat;
      if (a === "archiv" && typeof switchMod === "function") switchMod("library");
      if (a === "rendern") { if (!klick("#anim-hauptaktion")) klick("#anim-render"); }   // E11: derselbe Export-Dialog
      if (a === "schnell") klick("#anim-schnellvideo");
      if (a === "fotos") klick("#anim-signs-add-photos");
    });
    anwenden();
  }

  // Der Animator baut seine Seitenleiste bei jedem Öffnen neu — dann einbauen.
  const beob = new MutationObserver(() => { if (an() && $("anim-panel") && !$("rz-ansicht")) einbauen(); });
  const start = () => { beob.observe(document.body, { childList: true, subtree: true }); einbauen(); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  window.rzEinfach = { einbauen, anwenden, zeichnen, kameraSetzen, fahrtNeu, fahrtNeuDialog, formatSetzen, SCHRITTE };
})();
