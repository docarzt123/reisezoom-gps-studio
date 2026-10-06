/* seitenleisten.js — Seitenleisten ziehen + rechte Detail-Spalte (06.10.2026, Trailframe-Gerüst, docs/PLAN.md §2b/§1a)
 *
 * Marc: „die sidebars müssen breiter und schmaler gezogen werden können" und „die rechte Sidebar für Schilder usw.
 * gibt es noch nicht". Feste Regel aus dem Grilling: links immer die Seitenleiste des Moduls, rechts nur der
 * Detail-Editor des gerade Angeklickten — öffnet bei Bedarf, die Karte rückt zur Seite (wird nicht verdeckt),
 * Esc/✕ schließt, Breite mit der Maus verstellbar und gemerkt (Start 340 px).
 *
 * Wirkt auf #module-body (Raster: Seitenleiste | Fläche [| Detail]). Das Archiv (lib-mode, drei feste Spalten)
 * bleibt außen vor. Die Editoren selbst ändern sich nicht: `rzDetailSpalte.aufnehmen(panel)` hängt ihr Fenster in
 * die Spalte um; schließt der Editor (entfernt sein Fenster), geht die Spalte von selbst wieder zu.
 *
 *   rzDetailSpalte.aufnehmen(el) → true, wenn das Fenster jetzt rechts sitzt (sonst bleibt es schwebend)
 *   rzDetailSpalte.offen()       → ob gerade ein Editor rechts steht
 */
(function () {
  "use strict";
  const L_STD = 360, L_MIN = 240, L_MAX = 640;   // linke Seitenleiste (Standard wie bisher im Stylesheet)
  const R_STD = 340, R_MIN = 280, R_MAX = 640;   // rechte Detail-Spalte
  const FLAECHE_MIN = 360;                        // so viel Karte bleibt mindestens
  const K_L = (m) => "rz-panel-l:" + m, K_R = "rz-detail-breite";

  const lies = (k, d) => { try { const v = parseFloat(localStorage.getItem(k)); return isFinite(v) ? v : d; } catch (_) { return d; } };
  const merk = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, String(Math.round(v))); } catch (_) {} };
  const klemm = (v, a, b) => Math.max(a, Math.min(b, v));
  const leiste = () => document.getElementById("module-body");
  const modul = () => { try { return (typeof activeMod !== "undefined" && activeMod) || "x"; } catch (_) { return "x"; } };

  const DOPPEL_MS = 450;
  let _druck = -1e9, _spaeter = 0;
  window.addEventListener("pointerdown", () => { _druck = performance.now(); }, true);
  let _raf = 0;
  function karteNachziehen() {   // MapLibre/Mapbox messen ihre Fläche nur bei „resize" neu
    if (_raf) return;
    _raf = requestAnimationFrame(() => { _raf = 0; try { window.dispatchEvent(new Event("resize")); } catch (_) {} });
  }

  /** Maße je Ansicht. 06.10.2026 (Marc: „breiter und schmaler ziehen sollte überall gehen, auch im Archiv") — das
   *  Archiv hat drei feste Spalten (Bereiche | Raster | Detail): beide Ränder ziehbar, eigene Grenzen. */
  function profil(b) {
    if (b && b.classList.contains("lib-mode")) {
      return { lib: true, lStd: 208, lMin: 160, lMax: 420, rStd: 320, rMin: 240, rMax: 560,
               kL: K_L("library"), kR: "rz-panel-r:library" };
    }
    return { lib: false, lStd: L_STD, lMin: L_MIN, lMax: L_MAX, rStd: R_STD, rMin: R_MIN, rMax: R_MAX,
             kL: K_L(modul()), kR: K_R };
  }

  function teile(b) {
    if (!b) return null;
    if (b.classList.contains("lib-mode")) {
      const links = b.querySelector(":scope > .lib-nav"), rechts = b.querySelector(":scope > .lib-detail");
      if (!links) return null;
      return { links, detail: rechts, lib: true };
    }
    const links = b.querySelector(":scope > .panel:first-child");   // aside.panel oder div.panel (Inspektor)
    if (!links) return null;
    return { links, detail: b.querySelector(":scope > #rz-detail"), lib: false };
  }

  function breiten(b, offen) {
    const w = b.clientWidth || window.innerWidth, P = profil(b);
    const wl = klemm(lies(P.kL, P.lStd), P.lMin, Math.max(P.lMin, Math.min(P.lMax, w - FLAECHE_MIN - (offen ? P.rMin : 0))));
    const wr = offen ? klemm(lies(P.kR, P.rStd), P.rMin, Math.max(P.rMin, Math.min(P.rMax, w - wl - FLAECHE_MIN))) : 0;
    return { wl, wr, w };
  }

  function griff(b, seite) {
    let g = b.querySelector(`:scope > .rz-griff[data-seite="${seite}"]`);
    if (!g) {
      g = document.createElement("div");
      g.className = "rz-griff";
      g.dataset.seite = seite;
      g.setAttribute("role", "separator");
      g.setAttribute("aria-orientation", "vertical");
      g.title = (typeof t === "function") ? t("seitenleiste.griff_tip", "Ziehen: Breite ändern · Doppelklick: Standard") : "";
      g.addEventListener("pointerdown", ziehenStart);
      g.addEventListener("dblclick", () => { const P = profil(leiste()); merk(seite === "l" ? P.kL : P.kR, null); anwenden(); });
      b.appendChild(g);
    }
    return g;
  }

  function anwenden() {
    const b = leiste();
    if (!b) return;
    const tl = teile(b);
    if (!tl) {
      if (b.style.gridTemplateColumns) b.style.gridTemplateColumns = "";
      b.__rzSpalten = "";
      document.documentElement.style.setProperty("--rz-detail-breite", "0px");
      if (b.classList.contains("mit-detail")) b.classList.remove("mit-detail");   // nur bei Änderung: sonst schreibt
      // classList das Attribut neu, der Klassen-Beobachter ruft anwenden() wieder → Endlosschleife
      b.querySelectorAll(":scope > .rz-griff").forEach(g => g.remove());
      return;
    }
    // Archiv: die Detailspalte gehört fest dazu (außer das Fenster ist so schmal, dass das Stylesheet sie ausblendet)
    const offen = tl.lib ? !!(tl.detail && getComputedStyle(tl.detail).display !== "none")
                         : !!(tl.detail && tl.detail.querySelector(":scope > :not(.rz-detail-leer)"));
    // Erst nach einem möglichen Doppelklick umbauen: öffnet der erste Klick den Editor, rückte die Zeitleiste sonst
    // unter der Maus zusammen und der zweite Klick traf eine andere Stelle (Klicktest 06.10.2026).
    const seit = performance.now() - _druck;
    if (!tl.lib && offen !== b.classList.contains("mit-detail") && seit < DOPPEL_MS) {
      clearTimeout(_spaeter);
      _spaeter = setTimeout(anwenden, DOPPEL_MS - seit + 10);
      return;
    }
    const { wl, wr, w } = breiten(b, offen);
    // 06.10.2026 — den zuletzt GESETZTEN Wert vergleichen, nicht b.style: der Browser liest „minmax(0, 1fr)“ als
    // „minmax(0px, 1fr)“ zurück → jeder Durchgang hielt die Spalten für geändert, löste „resize“ aus, und „resize“
    // rief wieder anwenden() — eine Dauerschleife in jedem Bild (78 resize in 2 s; Karte maß sich dauernd neu,
    // Tooltips schlossen sofort, WebKit hing unter Last).
    const vorher = b.__rzSpalten || "";
    // 06.10.2026 (test_videoeditor) — Seitenleiste per „ohne-seite“ ausgeblendet: keine linke Spalte, sonst rutscht die
    // Vorschau in die 360-px-Spalte der versteckten Leiste (Bild 320×180)
    const ohneLinks = !tl.lib && b.classList.contains("ohne-seite");
    const soll = ohneLinks ? (offen ? `minmax(0, 1fr) ${wr}px` : "minmax(0, 1fr)")
               : (offen ? `${wl}px minmax(0, 1fr) ${wr}px` : `${wl}px minmax(0, 1fr)`);
    if (vorher !== soll) { b.style.gridTemplateColumns = soll; b.__rzSpalten = soll; }
    // Fortschrittskästen unten rechts rücken neben die Detail-Spalte (app.css #rz-status-box)
    const rv = offen ? wr + "px" : "0px";
    if (tl.lib) {
      if (document.documentElement.style.getPropertyValue("--rz-detail-breite") !== rv) document.documentElement.style.setProperty("--rz-detail-breite", rv);
      griff(b, "l").style.left = wl + "px";
      const gl = griff(b, "r");
      gl.hidden = !offen;
      gl.style.left = (w - wr) + "px";
      if (vorher !== soll) karteNachziehen();
      return;
    }
    if (document.documentElement.style.getPropertyValue("--rz-detail-breite") !== rv) document.documentElement.style.setProperty("--rz-detail-breite", rv);
    if (b.classList.contains("mit-detail") !== offen) b.classList.toggle("mit-detail", offen);
    if (tl.detail && tl.detail.hidden !== !offen) tl.detail.hidden = !offen;
    griff(b, "l").style.left = wl + "px";
    griff(b, "l").hidden = ohneLinks;
    const gr = griff(b, "r");
    gr.hidden = !offen;
    gr.style.left = (w - wr) + "px";
    if (vorher !== soll) karteNachziehen();
  }

  let _zug = null;
  function ziehenStart(e) {
    const b = leiste(), g = e.currentTarget;
    if (!b || e.button !== 0) return;
    e.preventDefault();
    const r = b.getBoundingClientRect();
    _zug = { seite: g.dataset.seite, g, r };
    g.classList.add("zieht");
    document.body.classList.add("rz-zieht-breite");
    try { g.setPointerCapture(e.pointerId); } catch (_) {}
    g.addEventListener("pointermove", ziehen);
    g.addEventListener("pointerup", ziehenEnde, { once: true });
    g.addEventListener("pointercancel", ziehenEnde, { once: true });
  }
  function ziehen(e) {
    if (!_zug) return;
    const { r, seite } = _zug;
    const P = profil(leiste());
    if (seite === "l") merk(P.kL, klemm(e.clientX - r.left, P.lMin, P.lMax));
    else merk(P.kR, klemm(r.right - e.clientX, P.rMin, P.rMax));
    anwenden();
  }
  function ziehenEnde() {
    if (!_zug) return;
    _zug.g.classList.remove("zieht");
    _zug.g.removeEventListener("pointermove", ziehen);
    document.body.classList.remove("rz-zieht-breite");
    _zug = null;
    anwenden();
    karteNachziehen();
  }

  /** Editor-Fenster rechts in die Detail-Spalte hängen. Ein anderer offener Editor wird über seinen ✕ geschlossen,
   *  damit sein Modul aufräumt (Auswahl, Markierungen). */
  function aufnehmen(panel) {
    const b = leiste();
    const tl = teile(b);
    if (!b || !panel || !tl || tl.lib) return false;
    let d = b.querySelector(":scope > #rz-detail");
    if (!d) {
      d = document.createElement("aside");
      d.id = "rz-detail";
      d.className = "rz-detail";
      d.hidden = true;
      b.appendChild(d);
      new MutationObserver(anwenden).observe(d, { childList: true });
    }
    for (const alt of [...d.children]) {
      if (alt === panel) continue;
      const x = alt.querySelector(".sign-editor-x");
      if (x) x.click();
      if (alt.isConnected && alt.parentElement === d) alt.remove();
    }
    panel.classList.add("im-detail");
    d.appendChild(panel);
    anwenden();
    return true;
  }
  const offen = () => { const d = document.getElementById("rz-detail"); return !!(d && !d.hidden && d.childElementCount); };

  // Esc schließt den Editor rechts — außer man tippt gerade (dann gehört Esc dem Feld/IME).
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.isComposing || !offen()) return;
    const z = e.target;
    if (z && (z.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(z.tagName))) return;
    if (document.querySelector("#modal-overlay:not([hidden])")) return;
    const x = document.querySelector("#rz-detail .sign-editor-x");
    if (x) { e.preventDefault(); x.click(); }
  });

  let _beobachtet = null, _bKinder = null, _bKlasse = null, _mainBeob = null;
  function start() {
    const b = leiste();
    if (!b) {   // das App-Gerüst (#module-body) baut app.js erst nach dem Laden — darauf warten
      const w = new MutationObserver(() => { if (leiste()) { w.disconnect(); start(); } });
      w.observe(document.documentElement, { childList: true, subtree: true });
      return;
    }
    // Review 06.10.2026: renderMod() (app.js) ersetzt #main.innerHTML bei JEDEM Modulwechsel — damit auch
    // #module-body. Die Beobachter hingen am alten Element; nach dem ersten Wechsel fehlten Griffe und Breiten.
    // Darum #main beobachten und an jedes neue #module-body neu anhängen.
    const main = document.getElementById("main");
    if (main && !_mainBeob) {
      _mainBeob = new MutationObserver(() => { const nb = leiste(); if (nb && nb !== _beobachtet) anhaengen(nb); });
      _mainBeob.observe(main, { childList: true });
    }
    anhaengen(b);
    if (!start._resize) { start._resize = true; window.addEventListener("resize", () => { if (!_zug) requestAnimationFrame(anwenden); }); }
  }
  function anhaengen(b) {
    if (_bKinder) _bKinder.disconnect();
    if (_bKlasse) _bKlasse.disconnect();
    _beobachtet = b;
    _bKinder = new MutationObserver((ml) => {
      // Griffe selbst lösen keinen neuen Durchgang aus
      if (ml.every(m => [...m.addedNodes, ...m.removedNodes].every(n => n.nodeType === 1 && n.classList.contains("rz-griff")))) return;
      anwenden();
    });
    _bKinder.observe(b, { childList: true });
    _bKlasse = new MutationObserver(anwenden);
    _bKlasse.observe(b, { attributes: true, attributeFilter: ["class"] });
    anwenden();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();

  window.rzDetailSpalte = { aufnehmen, offen, anwenden };
})();
