/* bergnamen.js — Berg- und Gipfelnamen im Gelände (01.11.2026)
 *
 * Ziel: Namen und Höhen der Berge schön in die Landschaft gesetzt, mit guten Schriften. Entscheidungen 01.11.2026: Gipfel aus den Vektorkacheln der
 * Karte (OpenFreeMap, Ebene `mountain_peak` mit Name, Höhe, Art), zuerst aufrecht im Bild (Größe nach Entfernung),
 * Standard an in neuen Projekten, Schrift Cormorant Garamond (Namen) + Manrope (Höhen), Systemschriften wählbar.
 *
 * Maße: ferner Name 1,9–2,4 % der
 * Bildhöhe H, naher bis 3,2 %, Höhe darunter 1,2–1,4 % H im Abstand 0,35 % H, 0,6–1,0 % H über dem Gipfel; Halo #101A22
 * 65 % (Unschärfe 0,45 % H) + zweiter Schatten 45 % (0,12 % H nach unten); höchstens vier Namen quer, zwei hoch;
 * mindestens 1,6 % H Abstand zwischen Textgruppen; verdeckte Gipfel ausblenden; Ein 0,35 s, Aus 0,3 s.
 *
 * Eine DOM-Ebene im Kartencontainer (wie Schilder und Einblendungen): das Video ist ein Bildschirmfoto der Vorschau, die
 * Namen stehen also in Vorschau und Video gleich. Ein-/Ausblenden rechnet in Videozeit, wenn sie läuft (Render Bild für
 * Bild), sonst in echter Zeit.
 *
 *   const bn = rzBergnamen.erstellen(map, { einstellungen: () => ({an, schrift, groesse, farbe, schatten, max}), zeit: () => s })
 *   bn.aktualisieren()   // nach jeder Kamerabewegung (hängt selbst an map "render")
 *   bn.weg()
 */
(function () {
  "use strict";
  const KACHELN = "https://tiles.openfreemap.org/planet";
  const SRC = "rz-berge", LADE = "rz-berge-laden";
  const ATTRIB = "© OpenMapTiles © OpenStreetMap";
  const KLASSEN = new Set(["peak", "volcano"]);
  const EIN_S = 0.35, AUS_S = 0.3;

  // Schriften: mitgeliefert + System (wie die Einblendungen, ui/js/container.js SCHRIFTEN)
  const SCHRIFTEN = {
    cormorant: '"Cormorant Garamond", Georgia, serif',
    manrope: 'Manrope, "IBM Plex Sans", system-ui, sans-serif',
    georgia: 'Georgia, "Times New Roman", serif',
    system: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    plex: '"IBM Plex Sans", system-ui, sans-serif',
    caveat: 'Caveat, cursive',
  };
  const STANDARD = { an: false, schrift: "cormorant", groesse: 100, farbe: "#F4F1E9", schatten: 65, max: 4 };

  // Schriften vorab laden, damit schon das erste Videobild die richtige zeigt
  try { if (document.fonts && document.fonts.load) { document.fonts.load('600 40px "Cormorant Garamond"'); document.fonts.load("400 20px Manrope"); } } catch (_) {}

  const sprache = () => { try { return (window.rzSprachCode && window.rzSprachCode()) || "de"; } catch (_) { return "de"; } };
  const zahl = (x) => String(Math.round(x));   // Höhen ohne Tausenderpunkt: „3715 m“
  const klemme = (x, a, b) => Math.max(a, Math.min(b, x));
  function hexRgb(h) {
    const n = String(h || "").replace("#", ""); const v = n.length === 3 ? n.split("").map(c => c + c).join("") : n;
    const r = parseInt(v.slice(0, 2), 16), g = parseInt(v.slice(2, 4), 16), b = parseInt(v.slice(4, 6), 16);
    return [r, g, b].every(Number.isFinite) ? [r, g, b] : [244, 241, 233];
  }
  function abstandM(a, b) {   // Meter auf der Kugel
    const R = 6371000, r = Math.PI / 180;
    const dLa = (b[1] - a[1]) * r, dLo = (b[0] - a[0]) * r;
    const s = Math.sin(dLa / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLo / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  /** Vektorquelle mit den Gipfeln: vorhandene OpenFreeMap-Quelle des Stils, sonst eine eigene; eine unsichtbare Ebene sorgt
   *  dafür, dass ihre Kacheln geladen werden (querySourceFeatures sieht nur geladene). */
  function quelleSichern(map) {
    const st = map.getStyle && map.getStyle(); if (!st || !st.sources) return null;
    let id = null;
    for (const [k, s] of Object.entries(st.sources)) {
      if (s && s.type === "vector" && (k === "openmaptiles" || /openfreemap\.org\/planet/.test(String(s.url || "")))) { id = k; break; }
    }
    if (!id) { if (!map.getSource(SRC)) map.addSource(SRC, { type: "vector", url: KACHELN, attribution: ATTRIB }); id = SRC; }
    if (!map.getLayer(LADE)) {
      map.addLayer({ id: LADE, type: "circle", source: id, "source-layer": "mountain_peak", minzoom: 7,
        paint: { "circle-radius": 1, "circle-opacity": 0, "circle-stroke-opacity": 0 } });
    }
    return id;
  }
  /** Gipfelnamen der Grundkarte aus- (an = true) bzw. wieder einblenden — sonst stünde jeder Name doppelt da. */
  function kartenGipfel(map, aus) {
    const st = map.getStyle && map.getStyle(); if (!st) return;
    for (const l of st.layers || []) {
      if (l.type !== "symbol" || l["source-layer"] !== "mountain_peak") continue;
      try {
        if (aus) {
          map.__rzBnVorher = map.__rzBnVorher || {};
          if (!(l.id in map.__rzBnVorher)) map.__rzBnVorher[l.id] = (l.layout && l.layout.visibility) || "visible";
          map.setLayoutProperty(l.id, "visibility", "none");
        }
        else if (map.__rzBnVorher && map.__rzBnVorher[l.id]) map.setLayoutProperty(l.id, "visibility", map.__rzBnVorher[l.id]);
      } catch (_) {}
    }
  }

  function erstellen(map, opt) {
    opt = opt || {};
    const einst = () => Object.assign({}, STANDARD, (opt.einstellungen && opt.einstellungen()) || {});
    const box = map.getContainer();
    const ebene = document.createElement("div");
    ebene.className = "rz-bergnamen";
    ebene.setAttribute("aria-hidden", "true");
    box.appendChild(ebene);
    let quelle = null, kand = [], kandAlt = 0, kandBraucht = true;
    const sichtbar = new Map();   // key → { el, op, ziel, x, y, w, h }
    let tAlt = null, echtAlt = performance.now();
    let aus = false;

    function kandidatenLesen() {
      kandBraucht = false; kandAlt = performance.now();
      const L = sprache(), feld = "name:" + L, seen = new Map();
      let fs = [];
      try { fs = map.querySourceFeatures(quelle, { sourceLayer: "mountain_peak" }) || []; } catch (_) { fs = []; }
      for (const f of fs) {
        const p = f.properties || {};
        if (!KLASSEN.has(p.class)) continue;
        const name = String(p[feld] || p.name || "").trim(); if (!name) continue;
        const g = f.geometry && f.geometry.coordinates; if (!g || !isFinite(g[0]) || !isFinite(g[1])) continue;
        const key = name + "|" + g[0].toFixed(3) + "|" + g[1].toFixed(3);
        if (seen.has(key)) continue;
        const ele = isFinite(+p.ele) ? +p.ele : null;
        seen.set(key, { key, name, ele, lng: +g[0], lat: +g[1] });
      }
      kand = Array.from(seen.values());
    }

    /** Kamera in Länge/Breite/Höhe (m) — aus dem Kamera-Adapter (ui/js/maplibre-camera.js) */
    function kamera() {
      try {
        const r = window.rzMlCamRead ? window.rzMlCamRead(map) : null;
        if (!r || !window.maplibregl) return null;
        const mc = new window.maplibregl.MercatorCoordinate(r.pos[0], r.pos[1], r.pos[2]);
        const ll = mc.toLngLat();
        return { lng: ll.lng, lat: ll.lat, alt: mc.toAltitude() };
      } catch (_) { return null; }
    }
    /** Liegt Gelände zwischen Kamera und Gipfel? (Strahl in 14 Schritten, nur mit 3D-Gelände) */
    function verdeckt(cam, k, eleK) {
      if (!cam || !map.getTerrain || !map.getTerrain()) return false;
      for (let i = 1; i <= 14; i++) {
        const s = i / 15;
        if (s > 0.96) break;
        const lng = cam.lng + (k.lng - cam.lng) * s, lat = cam.lat + (k.lat - cam.lat) * s;
        const strahl = cam.alt + (eleK + 8 - cam.alt) * s;
        let e = null; try { e = map.queryTerrainElevation([lng, lat]); } catch (_) {}
        if (e != null && isFinite(e) && e > strahl + 12) return true;
      }
      return false;
    }

    function zeichnen() {
      const E = einst();
      if (!E.an) { if (!aus) { aus = true; ebene.innerHTML = ""; sichtbar.clear(); try { kartenGipfel(map, false); } catch (_) {} } return; }
      if (aus) aus = false;
      if (!quelle || !map.getLayer(LADE)) { try { quelle = quelleSichern(map); kartenGipfel(map, true); kandBraucht = true; if (map.triggerRepaint) map.triggerRepaint(); } catch (_) { return; } }
      if (kandBraucht || performance.now() - kandAlt > 1500) kandidatenLesen();
      // Zeit: Videozeit, wenn sie sich bewegt (Render, Abspielen), sonst echte Zeit (Ziehen, Scrubben)
      const t = opt.zeit ? opt.zeit() : null, jetzt = performance.now();
      // Video (Schrittmodus): nur die Videozeit zählt — zwischen zwei Bildern vergeht keine Blendzeit (jedes Bild gleich)
      const schritt = !!(window.__rzStepMode || window.__rzRenderMode);
      let dt = schritt ? 0 : (jetzt - echtAlt) / 1000;
      if (t != null && tAlt != null && t !== tAlt) dt = Math.abs(t - tAlt);
      tAlt = t; echtAlt = jetzt;
      dt = klemme(dt, 0, 0.5);
      const W = box.clientWidth || 1, H = box.clientHeight || 1, hoch = H > W * 1.15;
      const maxN = Math.max(0, Math.min(+E.max || 4, hoch ? 2 : 4));
      const cam = kamera();
      const gr = klemme(+E.groesse || 100, 40, 250) / 100;
      // Kandidaten im Bild, mit Bildschirmlage und Entfernung
      const imBild = [];
      for (const k of kand) {
        let p; try { p = window.rzProjektGezeichnet ? window.rzProjektGezeichnet(map, [k.lng, k.lat]) : map.project([k.lng, k.lat]); } catch (_) { continue; }
        if (!p || !isFinite(p.x) || !isFinite(p.y)) continue;
        if (p.x < -40 || p.x > W + 40 || p.y < H * 0.04 || p.y > H * 0.96) continue;
        const d = cam ? Math.hypot(abstandM([cam.lng, cam.lat], [k.lng, k.lat]), (k.ele || 0) - cam.alt) : 10000;
        // hinter der Kamera? (Blickrichtung aus der Drehung)
        if (cam) {
          const b = map.getBearing() * Math.PI / 180, dx = k.lng - cam.lng, dy = k.lat - cam.lat;
          if (dx * Math.sin(b) + dy * Math.cos(b) < 0) continue;
        }
        imBild.push({ k, x: p.x, y: p.y, d, wert: (k.ele || 0) / 1000 + (1 - Math.min(d, 40000) / 40000) * 2.2 + (sichtbar.has(k.key) ? 1.5 : 0) });
      }
      imBild.sort((a, b) => b.wert - a.wert);
      // Auswahl: höchstens maxN, ohne Überlappung (Abstand 1,6 % H), nicht verdeckt
      const gewaehlt = [], kaesten = [], luft = 0.016 * H;
      for (const c of imBild) {
        if (gewaehlt.length >= maxN) break;
        const eleK = (() => { try { const e = map.queryTerrainElevation([c.k.lng, c.k.lat]); return e != null && isFinite(e) ? e : (c.k.ele || 0); } catch (_) { return c.k.ele || 0; } })();
        if (verdeckt(cam, c.k, eleK)) continue;
        const nah = klemme((25000 - c.d) / 23000, 0, 1);
        const pName = (hoch ? 1.9 + nah * 0.7 : 1.9 + nah * 1.3) / 100 * H * gr;
        const pHoehe = (hoch ? 1.45 : 1.3) / 100 * H * gr;
        const breite = Math.max(c.k.name.length * pName * 0.5, 5 * pHoehe) + 4, hoehe = pName * 1.1 + (c.k.ele != null ? pHoehe * 1.3 + 0.0035 * H : 0);
        const abhebung = 0.008 * H;
        const bx = { l: c.x - breite / 2 - luft, r: c.x + breite / 2 + luft, o: c.y - abhebung - hoehe - luft, u: c.y + luft };
        // ganz im Bild (2 % Rand) — sonst lieber weglassen als abgeschnitten (Render-Probe 01.11.2026: „Montaña Roca Cangre…“)
        if (bx.l + luft < 0.02 * W || bx.r - luft > 0.98 * W || bx.o + luft < 0.02 * H) continue;
        if (kaesten.some(k2 => !(bx.r < k2.l || bx.l > k2.r || bx.u < k2.o || bx.o > k2.u))) continue;
        kaesten.push(bx);
        gewaehlt.push(Object.assign(c, { pName, pHoehe, abhebung }));
      }
      // Halo nach Einstellung (Deckkraft 0–100 %)
      const sch = klemme(+E.schatten, 0, 100) / 100;
      const [r, g, b] = hexRgb(E.farbe);
      // Standard 65 %: erster Schatten 65 %, zweiter 45 % (Spezifikation); der Regler skaliert beide
      // 01.11.2026 (Marc: Lesbarkeit auf allen Untergründen) — zum weichen Halo ein feiner, klarer Rand rundum: helle
      // Namen bleiben auch auf hellen Karten (Straßenkarte, Strand, Schnee) lesbar
      const rr = Math.max(0.6, 0.0011 * H).toFixed(2), ra = Math.min(0.85, sch * 1.1).toFixed(2);
      const halo = sch > 0 ? [`${rr}px 0 0 rgba(16,26,34,${ra})`, `-${rr}px 0 0 rgba(16,26,34,${ra})`, `0 ${rr}px 0 rgba(16,26,34,${ra})`, `0 -${rr}px 0 rgba(16,26,34,${ra})`,
        `0 0 ${(0.0045 * H).toFixed(1)}px rgba(16,26,34,${sch.toFixed(2)})`, `0 ${(0.0012 * H).toFixed(1)}px ${(0.002 * H).toFixed(1)}px rgba(16,26,34,${Math.min(1, sch * 0.45 / 0.65).toFixed(2)})`].join(", ") : "none";
      const schrift = SCHRIFTEN[E.schrift] || SCHRIFTEN.cormorant;
      const neu = new Set(gewaehlt.map(c => c.k.key));
      for (const c of gewaehlt) {
        let s = sichtbar.get(c.k.key);
        if (!s) {
          const el = document.createElement("div");
          el.className = "rz-bn";
          el.innerHTML = `<span class="rz-bn-name"></span><span class="rz-bn-hoehe"></span><span class="rz-bn-linie"></span>`;
          ebene.appendChild(el);
          s = { el, op: 0 };
          sichtbar.set(c.k.key, s);
        }
        s.ziel = 1;
        const nm = s.el.children[0], ho = s.el.children[1], li = s.el.children[2];
        if (nm.textContent !== c.k.name) nm.textContent = c.k.name;
        const hTxt = c.k.ele != null ? zahl(c.k.ele) + " m" : "";
        if (ho.textContent !== hTxt) ho.textContent = hTxt;
        ho.hidden = !hTxt;
        Object.assign(nm.style, { fontFamily: schrift, fontWeight: E.schrift === "cormorant" ? "600" : "500", fontSize: c.pName.toFixed(1) + "px", lineHeight: "1.05", textShadow: halo });
        Object.assign(ho.style, { fontFamily: SCHRIFTEN.manrope, fontWeight: "400", fontSize: c.pHoehe.toFixed(1) + "px", marginTop: (0.0035 * H).toFixed(1) + "px", textShadow: halo });
        s.el.style.color = `rgb(${r},${g},${b})`;
        // feine Ankerlinie vom Text zum Gipfel
        Object.assign(li.style, { height: c.abhebung.toFixed(1) + "px", background: `rgba(${r},${g},${b},0.55)` });
        s.el.style.transform = `translate(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px) translate(-50%, -100%)`;
      }
      // Ein-/Ausblenden
      let laeuft = false;
      for (const [key, s] of sichtbar) {
        if (!neu.has(key)) s.ziel = 0;
        s.op = s.ziel > s.op ? Math.min(1, s.op + dt / EIN_S) : Math.max(0, s.op - dt / AUS_S);
        if (dt === 0 && s.ziel === 1 && s.op === 0) s.op = 1;   // Standbild ohne Zeit: gleich ganz da
        if (s.op <= 0 && s.ziel === 0) { s.el.remove(); sichtbar.delete(key); continue; }
        s.el.style.opacity = s.op.toFixed(3);
        if (s.op !== s.ziel) laeuft = true;
      }
      // Vorschau steht still, eine Blende läuft noch: weiterzeichnen lassen, bis sie fertig ist (sonst blieb ein Name halb
      // durchsichtig hängen — test_bergnamen, 01.11.2026). Im Video treibt die Videozeit die Blende.
      if (laeuft && !schritt && map.triggerRepaint) requestAnimationFrame(() => { try { map.triggerRepaint(); } catch (_) {} });
    }

    // Kacheln mit Gipfeln da: neu lesen und einmal neu zeichnen lassen — steht die Karte still, käme sonst kein „render“
    let nachT = null;
    const nachKacheln = (e) => {
      if (!(e && quelle && e.sourceId === quelle)) return;
      kandBraucht = true;
      clearTimeout(nachT);
      nachT = setTimeout(() => { try { if (einst().an && map.triggerRepaint) map.triggerRepaint(); } catch (_) {} }, 120);
    };
    const nachStil = () => { quelle = null; kandBraucht = true; };
    let geplant = false;
    const beimRendern = () => {
      if (geplant) return;
      geplant = true;
      // im Schrittmodus (Video) sofort, sonst nach dem Zeichnen im selben Bild
      try { zeichnen(); } catch (e) { try { applog("warn", "[bergnamen] " + e); } catch (_) {} }
      geplant = false;
    };
    map.on("render", beimRendern);
    map.on("sourcedata", nachKacheln);
    map.on("styledata", nachStil);
    return {
      aktualisieren: beimRendern,
      /** Prüfstand: was gerade steht */
      stand: () => Array.from(sichtbar.entries()).map(([key, s]) => ({ key, name: s.el.children[0].textContent, op: s.op, ziel: s.ziel })),
      kandidaten: () => kand.length,
      weg() {
        clearTimeout(nachT);
        try { map.off("render", beimRendern); map.off("sourcedata", nachKacheln); map.off("styledata", nachStil); } catch (_) {}
        try { kartenGipfel(map, false); } catch (_) {}
        ebene.remove(); sichtbar.clear();
      },
    };
  }

  window.rzBergnamen = { erstellen, SCHRIFTEN, STANDARD };
})();
