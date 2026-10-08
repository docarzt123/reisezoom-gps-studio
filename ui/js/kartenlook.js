/* Kartenlooks: ein Look → ein MapLibre-Stil (07.10.2026, PLAN „10 Kartenlooks + Karten-Editor“, IDEEN I-286).
 *
 * Marc: „Im Web kann man halt 10 verschiedene Stile, und auf dem Desktop kann man sich die Karten komplett selber
 * bauen.“ Ein Look ist eine Farbtabelle JE ROLLE (Land, Wasser, Fluss, Küste, Wald, Park, Gebäude, Neben-/Haupt-
 * straße, Autobahn, Straßenrand, Bahn, Grenze, Schrift, Schriftrand, Wassertext) plus Schriftschnitt und drei
 * Zutaten: Schummerung (aus dem Gelände), Leuchtsaum (Straßen) und Meerestiefen in Stufen.
 *
 * Vorlage ist OpenFreeMap „Positron“ (fast einfarbig grau, alle Ebenen lassen sich einer Rolle zuordnen), mitgeliefert
 * als ui/vendor/ofm-positron.js — App-Vorschau, Video und Web zeichnen dadurch exakt denselben Stil, auch ohne Netz.
 *
 * Reine Daten + reine Funktionen, läuft auch unter node (Wächter, Web-Engine). Nur `tiefenProtokoll` braucht einen
 * Browser (Kachel-Umfärbung über OffscreenCanvas). Das Web lädt GENAU diese Datei aus der Engine — kein Nachbau.
 */
(function (root) {
  "use strict";
  const VERSION = 1;

  // ── Die zehn Start-Looks ──────────────────────────────────────────────────────────────────────────────────
  // Eigene Farbwerte (Anregung: Recherche MapAnimator 07.10.2026 — deren Code hat keine offene Lizenz, nur die Idee).
  // `natuerlich` ist das Luftbild (kein Vektor-Look): die Felder hier gelten für die Beschriftung darüber.
  const L = (o) => Object.assign({
    v: VERSION, basis: "positron", font: "regular", caps: false, labels: true, coast: null, shade: null, glow: null,
    depths: null, border: { color: "#9a9a9a", dash: false },
  }, o);
  const LOOKS = {
    natuerlich: L({ id: "natuerlich", satellit: true, land: "#3b4a3a", water: "#1d2b3a", waterway: "#2a3f52",
      wood: "#2f4030", park: "#34463a", building: "#555555", minor: "#ffffff", major: "#ffffff", motorway: "#ffffff",
      casing: "#000000", rail: "#cccccc", border: { color: "#ffffff", dash: true }, text: "#ffffff", halo: "#1b2328",
      waterText: "#cfe3ff" }),
    reiseatlas: L({ id: "reiseatlas", land: "#f7efdc", water: "#b9cdc6", waterway: "#a9c2bb",
      coast: { color: "#7d9b93", width: 0.8, opacity: 0.8 }, wood: "#e3e3c6", park: "#e8e8cc", building: "#e6dcc5",
      minor: "#fbf6ea", major: "#f3dcae", motorway: "#e9b77d", casing: "#cdbb98", rail: "#a89a83",
      border: { color: "#a0785a", dash: true }, text: "#4e3c2b", halo: "#f6eedb", waterText: "#4f6f78", font: "italic",
      shade: { shadow: "#6b5a43", highlight: "#fffaf0", accent: "#8a7354", exaggeration: 0.35 } }),
    nachtkarte: L({ id: "nachtkarte", land: "#0c1519", water: "#122c35", waterway: "#17394a",
      coast: { color: "#2d5866", width: 0.8, opacity: 0.9 }, wood: "#112420", park: "#10211f", building: "#1a2a2f",
      minor: "#24383d", major: "#3d5a60", motorway: "#6d8a8f", casing: "#0c1519", rail: "#2b4146",
      border: { color: "#4d6a70", dash: true }, text: "#c3d2cd", halo: "#0c1519", waterText: "#6f9aa6" }),
    minimal: L({ id: "minimal", land: "#f2f3f0", water: "#c2c8ca", waterway: "#bfcdd2", wood: "#dce0dc", park: "#e6e9e5",
      building: "#eaeae5", minor: "#e0e0e0", major: "#ffffff", motorway: "#ffffff", casing: "#d5d5d5", rail: "#dddddd",
      border: { color: "#b3b3b3", dash: false }, text: "#333333", halo: "#ffffff", waterText: "#495e91" }),
    schatzkarte: L({ id: "schatzkarte", land: "#e8d3a6", water: "#a9b597", waterway: "#93a083",
      coast: { color: "#5b3d20", width: 1.1, opacity: 0.85 }, wood: "#d8c48f", park: "#dcc898", building: "#d2b884",
      minor: "#9a7a52", major: "#6e4b28", motorway: "#5a3b1f", casing: null, rail: "#7d5d3a",
      border: { color: "#7a4f2a", dash: true }, text: "#4a2f16", halo: "#efdfb8", waterText: "#3f4f3a", font: "italic",
      shade: { shadow: "#4a2f16", highlight: "#f6e7c4", accent: "#6e4b28", exaggeration: 0.55 } }),
    topo: L({ id: "topo", land: "#fbfaf4", water: "#a6d2ee", waterway: "#7fbde6",
      coast: { color: "#3f8fc4", width: 0.7, opacity: 0.9 }, wood: "#cde4b2", park: "#d9ecc4", building: "#d9d4cc",
      minor: "#ffffff", major: "#f7d660", motorway: "#e9772f", casing: "#8a7d6b", rail: "#555555",
      border: { color: "#b0399a", dash: true }, text: "#222222", halo: "#ffffff", waterText: "#1f5f8f",
      shade: { shadow: "#4b5560", highlight: "#ffffff", accent: "#6d7a86", exaggeration: 0.7 } }),
    seekarte: L({ id: "seekarte", land: "#f0e4b6", water: "#d4eaf2", waterway: "#a9cfe0",
      coast: { color: "#1c3d5a", width: 1.2, opacity: 1 }, wood: "#e2d59c", park: "#e6dba6", building: "#ddcf9b",
      minor: "#c1ae76", major: "#957f47", motorway: "#6e5b2f", casing: null, rail: "#7b6a45",
      border: { color: "#c0392b", dash: true }, text: "#1c3d5a", halo: "#f6eed0", waterText: "#2a5b80", font: "italic",
      depths: { bands: [[-10, "#e9f4f8"], [-50, "#d2e8f1"], [-200, "#bcdcea"], [-1000, "#a6cfe2"], [-4000, "#92c2da"]],
                line: "#7fb0c9" } }),
    pastell: L({ id: "pastell", land: "#fbf0f3", water: "#cbede6", waterway: "#b5e2d9", wood: "#d9eecf", park: "#e2f2da",
      building: "#f1dfe6", minor: "#eccbdc", major: "#bba4e6", motorway: "#9584d6", casing: null, rail: "#cdb3cb",
      coast: { color: "#9fd3c8", width: 0.8, opacity: 0.8 }, border: { color: "#c3a6c8", dash: true },
      text: "#5e4a6c", halo: "#fff8fa", waterText: "#3f7f76",
      shade: { shadow: "#b89ab8", highlight: "#fffafc", accent: "#c9b0c9", exaggeration: 0.3 } }),
  };
  const NAMEN = Object.keys(LOOKS);

  // ── Farben ────────────────────────────────────────────────────────────────────────────────────────────────
  function hexRgb(h) {
    let s = String(h || "").trim().replace(/^#/, "");
    if (s.length === 3) s = s.split("").map((c) => c + c).join("");
    if (!/^[0-9a-f]{6}$/i.test(s)) return null;
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
  }
  const rgbHex = (c) => "#" + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
  function mix(a, b, t) {
    const x = hexRgb(a), y = hexRgb(b);
    if (!x || !y) return a || b;
    return rgbHex(x.map((v, i) => v + (y[i] - v) * t));
  }
  function hell(h) { const c = hexRgb(h) || [128, 128, 128]; return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255; }
  const rgba = (h, a) => { const c = hexRgb(h) || [0, 0, 0]; return `rgba(${c[0]},${c[1]},${c[2]},${a})`; };

  /** Look vervollständigen: fehlende Felder aus `minimal`, Ableitungen (Pfad, Eis, Wohngebiet). Gibt eine Kopie. */
  function normalisieren(look) {
    const basis = LOOKS.minimal;
    const o = JSON.parse(JSON.stringify(Object.assign({}, basis, look || {})));
    o.v = VERSION;
    o.border = Object.assign({ color: basis.border.color, dash: false }, (look && look.border) || {});
    for (const k of ["land", "water", "waterway", "wood", "park", "building", "minor", "major", "motorway", "rail",
      "text", "halo", "waterText"]) if (!hexRgb(o[k])) o[k] = basis[k];
    if (o.casing !== null && !hexRgb(o.casing)) o.casing = basis.casing;
    return o;
  }

  // ── Ebene → Rolle (Positron, Schema OpenMapTiles) ─────────────────────────────────────────────────────────
  function rolle(id) {
    if (id === "background" || id === "road_area_pier" || id === "road_pier") return "land";
    if (id === "park") return "park";
    if (id === "water") return "water";
    if (id === "waterway") return "waterway";
    if (id === "landcover_wood") return "wood";
    if (id === "landcover_ice_shelf" || id === "landcover_glacier") return "eis";
    if (id === "landuse_residential") return "wohnen";
    if (id === "building") return "building";
    if (/^aeroway/.test(id)) return "minor";
    if (id === "highway_path") return "pfad";
    if (id === "highway_minor") return "minor";
    if (/casing/.test(id)) return "casing";
    if (/^tunnel_motorway_inner/.test(id)) return "motorway_tunnel";
    if (/^highway_major/.test(id)) return id.endsWith("subtle") ? "major_fern" : "major";
    if (/^highway_motorway/.test(id)) return id.endsWith("subtle") ? "motorway_fern" : "motorway";
    if (/^railway/.test(id)) return /dashline/.test(id) ? "rail_luecke" : "rail";
    if (/^boundary/.test(id)) return "border";
    if (/^water(way)?_.*label$/.test(id) || /^water_name/.test(id)) return "waterText";
    if (/^highway-name/.test(id) || id === "airport") return "strassenText";
    if (/^label_/.test(id)) return "ortText";
    return "";
  }

  const ORTSTEXT = /^label_/;

  /** Linienbreite × f — Zahl, alte `stops`-Form oder interpolate über den Zoom (Zoom-Ausdrücke dürfen in MapLibre
   *  nur ganz außen stehen, also die Stützwerte vervielfachen statt ["*", f, …] drumzulegen). */
  function breiteMal(w, f) {
    if (typeof w === "number") return w * f;
    if (w && Array.isArray(w.stops)) return Object.assign({}, w, { stops: w.stops.map(([z, v]) => [z, typeof v === "number" ? v * f : v]) });
    if (Array.isArray(w) && w[0] === "interpolate" && Array.isArray(w[2]) && w[2][0] === "zoom") {
      return w.map((x, i) => (i >= 3 && i % 2 === 0 && typeof x === "number") ? x * f : x);
    }
    return 6;
  }

  /**
   * Look → fertiger MapLibre-Stil.
   *   basis   Positron-Stil (Objekt, z. B. window.RZ_OFM_POSITRON); wird nicht verändert
   *   opt.dem       Kachel-Adresse der Geländedaten (Terrarium, {z}/{x}/{y}) — Schummerung; ohne → keine Schummerung
   *   opt.tiefen    Kachel-Adresse für Meerestiefen (eigenes Protokoll, s. tiefenProtokoll) — ohne → keine Stufen
   *   opt.demAttribution  Nennung für die Geländequelle
   */
  function stilAusLook(look0, basis, opt) {
    opt = opt || {};
    const k = normalisieren(look0);
    const s = JSON.parse(JSON.stringify(basis));
    s.name = "GPS Studio Look " + (k.name || k.id || "eigen");
    const dunkel = hell(k.land) < 0.35;
    const neu = [];
    const minorOp = dunkel ? 0.9 : 1;
    for (const lyr of s.layers) {
      const r = rolle(lyr.id);
      const p = lyr.paint = lyr.paint || {};
      const lay = lyr.layout = lyr.layout || {};
      switch (r) {
        case "land": if (lyr.type === "background") p["background-color"] = k.land; else if (lyr.type === "fill") p["fill-color"] = k.land; else p["line-color"] = k.land; break;
        case "park": p["fill-color"] = k.park; break;
        case "water": p["fill-color"] = k.water; break;
        case "waterway": p["line-color"] = k.waterway; break;
        case "wood": p["fill-color"] = k.wood; break;
        case "eis": p["fill-color"] = mix(k.land, "#ffffff", dunkel ? 0.12 : 0.6); break;
        case "wohnen": p["fill-color"] = mix(k.land, k.building, 0.35); break;
        case "building":
          p["fill-color"] = k.building;
          p["fill-outline-color"] = mix(k.building, dunkel ? "#ffffff" : "#000000", 0.12);
          break;
        case "pfad": p["line-color"] = mix(k.minor, k.land, 0.25); break;
        case "minor": if (lyr.type === "fill") p["fill-color"] = mix(k.minor, k.land, 0.3); else { p["line-color"] = k.minor; p["line-opacity"] = minorOp; } break;
        case "casing":
          if (k.casing === null) lay.visibility = "none";
          else p["line-color"] = /tunnel/.test(lyr.id) ? mix(k.casing, k.land, 0.5) : k.casing;
          break;
        case "major": p["line-color"] = k.major; break;
        case "major_fern": p["line-color"] = rgba(k.major, 0.75); break;
        case "motorway": p["line-color"] = k.motorway; break;
        case "motorway_fern": p["line-color"] = rgba(k.motorway, 0.7); break;
        case "motorway_tunnel": p["line-color"] = mix(k.motorway, k.land, 0.45); break;
        case "rail": p["line-color"] = k.rail; break;
        case "rail_luecke": p["line-color"] = k.land; break;
        case "border":
          p["line-color"] = k.border.color;
          if (k.border.dash) p["line-dasharray"] = [3, 2];
          else delete p["line-dasharray"];
          break;
        case "waterText": p["text-color"] = k.waterText; p["text-halo-color"] = rgba(k.halo, 0.75); break;
        case "strassenText": p["text-color"] = mix(k.text, k.land, 0.35); p["text-halo-color"] = k.halo; break;
        case "ortText": p["text-color"] = k.text; p["text-halo-color"] = k.halo; p["text-halo-width"] = p["text-halo-width"] || 1.2; break;
        default: break;
      }
      if (lyr.type === "symbol") {
        if (k.labels === false) lay.visibility = "none";
        if (ORTSTEXT.test(lyr.id) || r === "waterText") {
          const f = lay["text-font"];
          if (Array.isArray(f) && f.length && typeof f[0] === "string") {
            const fett = /Bold/.test(f[0]);
            lay["text-font"] = [k.font === "italic" ? (r === "waterText" || !fett ? "Noto Sans Italic" : "Noto Sans Bold")
              : k.font === "bold" ? "Noto Sans Bold" : f[0]];
          }
          if (k.caps && r === "ortText") { lay["text-transform"] = "uppercase"; lay["text-letter-spacing"] = 0.08; }
        }
      }
      neu.push(lyr);
      // Zutaten an festen Stellen
      if (lyr.id === "water" && k.coast) {
        neu.push({ id: "rz-look-kueste", type: "line", source: "openmaptiles", "source-layer": "water",
          filter: ["match", ["geometry-type"], ["MultiPolygon", "Polygon"], true, false],
          paint: { "line-color": k.coast.color, "line-width": ["interpolate", ["linear"], ["zoom"], 4, (k.coast.width || 1) * 0.5, 12, (k.coast.width || 1) * 1.6],
                   "line-opacity": k.coast.opacity == null ? 1 : k.coast.opacity } });
      }
      if (lyr.id === "water" && k.depths && opt.tiefen) {
        neu.push({ id: "rz-look-tiefen", type: "raster", source: "rz-look-tiefen", maxzoom: 22,
          paint: { "raster-opacity": 1, "raster-resampling": "linear" } });
      }
      if (lyr.id === "landcover_wood" && k.shade && opt.dem) {
        neu.push({ id: "rz-look-schummerung", type: "hillshade", source: "rz-look-dem",
          paint: { "hillshade-shadow-color": k.shade.shadow, "hillshade-highlight-color": k.shade.highlight,
                   "hillshade-accent-color": k.shade.accent || k.shade.shadow,
                   "hillshade-exaggeration": Math.max(0, Math.min(1, +k.shade.exaggeration || 0.5)),
                   "hillshade-illumination-direction": 315 } });
      }
    }
    // Leuchtsaum: breite, weiche Unterlinie vor Haupt- und Autobahn
    if (k.glow) {
      const st = Math.max(0.2, Math.min(2, +k.glow.strength || 1));
      const mitSaum = [];
      for (const lyr of neu) {
        const r = rolle(lyr.id);
        if ((r === "major" || r === "motorway") && lyr.type === "line") {
          const farbe = k.glow.color || (r === "major" ? k.major : k.motorway);
          const w = lyr.paint["line-width"];
          mitSaum.push({ id: lyr.id + "-rz-saum", type: "line", source: lyr.source, "source-layer": lyr["source-layer"],
            filter: lyr.filter, minzoom: lyr.minzoom, maxzoom: lyr.maxzoom, layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": farbe, "line-opacity": 0.38 * st, "line-blur": 6 * st,
                     "line-width": breiteMal(w, 4) } });
          for (const key of Object.keys(mitSaum[mitSaum.length - 1])) if (mitSaum[mitSaum.length - 1][key] === undefined) delete mitSaum[mitSaum.length - 1][key];
        }
        mitSaum.push(lyr);
      }
      neu.length = 0; neu.push(...mitSaum);
    }
    s.layers = neu;
    if (k.shade && opt.dem) {
      s.sources["rz-look-dem"] = { type: "raster-dem", tiles: [opt.dem], tileSize: 256, maxzoom: 15, encoding: "terrarium",
        attribution: opt.demAttribution || "Terrain Tiles (Mapzen/AWS)" };
    }
    if (k.depths && opt.tiefen) {
      s.sources["rz-look-tiefen"] = { type: "raster", tiles: [opt.tiefen + (opt.tiefen.includes("?") ? "&" : "?") + "b=" + tiefenSchluessel(k.depths)],
        tileSize: 256, maxzoom: 10, attribution: opt.demAttribution || "Terrain Tiles (Mapzen/AWS)" };
    }
    return s;
  }

  // ── Meerestiefen: Terrarium-Kachel → Farbstufen (Browser) ────────────────────────────────────────────────
  // MapLibre 5.4 kennt noch kein `color-relief`; deshalb ein eigenes Kachelprotokoll: Geländekachel holen, Höhe je
  // Pixel lesen (Terrarium: (R·256 + G + B/256) − 32768), unter 0 m in die Stufe des Looks einfärben, sonst durchsichtig.
  function tiefenSchluessel(d) {
    return encodeURIComponent((d.bands || []).map((b) => (+b[0]) + ":" + String(b[1]).replace("#", "")).join(","));
  }
  function stufenLesen(b) {
    return decodeURIComponent(b || "").split(",").map((x) => x.split(":")).filter((x) => x.length === 2)
      .map(([m, c]) => [+m, hexRgb(c)]).filter((x) => isFinite(x[0]) && x[1]).sort((a, b) => b[0] - a[0]);
  }
  /** Kachel umfärben: rgbaPixel (Uint8ClampedArray der Terrarium-Kachel) → neue Pixel. Rein, testbar unter node. */
  function tiefenFaerben(px, stufen) {
    const out = new Uint8ClampedArray(px.length);
    for (let i = 0; i < px.length; i += 4) {
      const h = (px[i] * 256 + px[i + 1] + px[i + 2] / 256) - 32768;
      if (!(h < 0)) continue;
      let c = null;
      for (const [m, farbe] of stufen) { if (h <= m) c = farbe; else break; }
      if (!c) c = stufen.length ? stufen[0][1] : null;
      if (!c) continue;
      out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; out[i + 3] = 255;
    }
    return out;
  }
  /** Protokoll `rztiefe://{z}/{x}/{y}?b=…` bei MapLibre anmelden; `demVorlage` = Terrarium-Adresse mit {z}/{x}/{y}
   *  (OHNE Abschneiden der Meerestiefen). Nur im Browser. */
  function tiefenProtokoll(maplibregl, demVorlage) {
    if (!maplibregl || typeof maplibregl.addProtocol !== "function" || tiefenProtokoll._an) return;
    tiefenProtokoll._an = true;
    maplibregl.addProtocol("rztiefe", async (params) => {
      const m = /^rztiefe:\/\/(\d+)\/(\d+)\/(\d+)(?:\?b=([^&]*))?/.exec(params.url);
      if (!m) throw new Error("rztiefe: Adresse");
      const url = demVorlage.replace("{z}", m[1]).replace("{x}", m[2]).replace("{y}", m[3]);
      const r = await fetch(url);
      if (!r.ok) throw new Error("rztiefe: " + r.status);
      const bild = await createImageBitmap(await r.blob());
      const cv = new OffscreenCanvas(bild.width, bild.height), cx = cv.getContext("2d", { willReadFrequently: true });
      cx.drawImage(bild, 0, 0);
      const d = cx.getImageData(0, 0, bild.width, bild.height);
      d.data.set(tiefenFaerben(d.data, stufenLesen(m[4])));
      cx.putImageData(d, 0, 0);
      const png = await cv.convertToBlob({ type: "image/png" });
      return { data: await png.arrayBuffer() };
    });
  }

  /** Kleines Vorschaubild (SVG) für die Kachel im Raster: Land, Wasser, Wald, Straßen, Beispiellinie. */
  function kachelSvg(look0, linie) {
    const k = normalisieren(look0);
    const ln = linie || "#ff6b35";
    const sh = k.shade ? `<path d="M0 40 L22 22 L34 31 L52 14 L80 40 Z" fill="${k.shade.shadow}" opacity=".18"/>` : "";
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 48" preserveAspectRatio="xMidYMid slice">` +
      `<rect width="80" height="48" fill="${k.land}"/>` + sh +
      `<path d="M52 0 C58 14 70 18 80 16 L80 0 Z" fill="${k.water}"/>` +
      (k.coast ? `<path d="M52 0 C58 14 70 18 80 16" fill="none" stroke="${k.coast.color}" stroke-width="1"/>` : "") +
      `<ellipse cx="14" cy="38" rx="14" ry="9" fill="${k.wood}"/>` +
      `<path d="M0 30 L80 26" stroke="${k.motorway}" stroke-width="2.4"/>` +
      `<path d="M30 48 L42 0" stroke="${k.major}" stroke-width="1.6"/>` +
      `<path d="M8 6 C20 20 40 12 66 40" fill="none" stroke="${ln}" stroke-width="3" stroke-linecap="round"/></svg>`;
  }

  root.rzKartenlook = { VERSION, LOOKS, NAMEN, normalisieren, stilAusLook, rolle, tiefenFaerben, stufenLesen,
    tiefenSchluessel, tiefenProtokoll, kachelSvg, mix, hell };
})(typeof window !== "undefined" ? window : globalThis);
