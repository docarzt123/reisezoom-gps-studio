/* Overlay-Boxen einzeln einstellen (23.09.2026, docs/OVERLAY-BOXEN.md).
 *
 * ⚠️ WORTGLEICH zu core/overlayboxen.py (Auflösung + Zeitsteuerung). Der Wächter
 * tests/test_overlay_boxen.py vergleicht beide an denselben Beispielen.
 *
 * Diese Datei läuft an drei Stellen:
 *   - in der App (ui/index.html) für Vorschau, Probelauf und Szene-Render,
 *   - eingebettet im klassischen Render-HTML (core/animator.py),
 *   - unter node im Wächter (vorher globalThis.window = globalThis setzen).
 *
 * window.rzOverlayBoxen = { aufloesen, chartBoxen, zustand, anwenden, etappenGrenzen,
 *                            hatZeitsteuerung, zeitNormal, globalStil, globalBlende }
 */
(function (root) {
  "use strict";
  const STANDARD_IDS = ["totals", "live", "ele"];
  const BOX_TYPEN = ["totals", "live"];
  const AUSLOESER = ["s", "pct", "etappe_start", "etappe_ende", "start", "ende"];
  const BLENDEN = ["none", "fade", "pop", "both"];
  const POSITIONEN = ["tl", "tr", "bl", "br", "tc", "bc", "cc", "ml", "mr", "tcw", "bcw"];
  const SCHRIFTEN = ["system", "nunito", "quicksand", "fredoka", "oswald", "bebas"];
  const DEFAULT_LIVE_FIELDS = ["dist_done", "time_elapsed", "ele_now"];
  const DEFAULT_TOTAL_FIELDS = ["dist_total", "moving_time", "avg_speed", "max_speed", "elev_gain", "elev_loss"];
  const STIL_KEYS = ["bg_color", "bg_opacity", "text_color", "font", "radius", "border_w", "border_color", "shadow"];
  const EPS = 1e-9;
  const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

  const istNix = (v) => v === null || v === undefined;
  function get(cfg, key, def) {
    const v = cfg ? cfg[key] : undefined;
    return istNix(v) ? def : v;
  }
  function num(v, def) {
    if (istNix(v) || v === "") return def;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (typeof v !== "number" && typeof v !== "string") return def;
    const f = Number(v);
    return isFinite(f) ? f : def;
  }
  const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
  function farbe(v, def) {
    const s = String(v || "").trim();
    return HEX.test(s) ? s.toLowerCase() : def;
  }
  function blendeart(v, def) {
    const s = String(v || "").trim();
    return BLENDEN.indexOf(s) >= 0 ? s : (def === undefined ? "none" : def);
  }
  const rund = (x) => Math.floor(x * 10000 + 0.5) / 10000;
  const istDict = (x) => !!x && typeof x === "object" && !Array.isArray(x);

  function globalStil(cfg) {
    const font = String(get(cfg, "overlay_font", "system") || "system").toLowerCase();
    return {
      bg_color: farbe(get(cfg, "overlay_bg_color", "#000000"), "#000000"),
      bg_opacity: rund(clamp(num(get(cfg, "overlay_bg_opacity", 0.55), 0.55), 0, 1)),
      text_color: farbe(get(cfg, "overlay_text_color", "#ffffff"), "#ffffff"),
      font: SCHRIFTEN.indexOf(font) >= 0 ? font : "system",
      radius: rund(clamp(num(get(cfg, "overlay_radius", 12), 12), 0, 60)),
      border_w: rund(clamp(num(get(cfg, "overlay_border_w", 0), 0), 0, 12)),
      border_color: farbe(get(cfg, "overlay_border_color", "#ffffff"), "#ffffff"),
      shadow: !!get(cfg, "overlay_shadow", true),
    };
  }
  function globalBlende(cfg) {
    return {
      ein: blendeart(get(cfg, "overlay_entry", "none")),
      aus: blendeart(get(cfg, "overlay_exit", "none")),
      dauer_s: rund(clamp(num(get(cfg, "overlay_blende_s", 0.5), 0.5), 0.05, 10)),
    };
  }
  function stilMischen(basis, ueber) {
    const out = Object.assign({}, basis);
    if (!istDict(ueber)) return out;
    for (const k of STIL_KEYS) {
      const v = ueber[k];
      if (istNix(v)) continue;
      if (k === "bg_color" || k === "text_color" || k === "border_color") out[k] = farbe(v, basis[k]);
      else if (k === "bg_opacity") out[k] = rund(clamp(num(v, basis[k]), 0, 1));
      else if (k === "radius") out[k] = rund(clamp(num(v, basis[k]), 0, 60));
      else if (k === "border_w") out[k] = rund(clamp(num(v, basis[k]), 0, 12));
      else if (k === "font") { const f = String(v).toLowerCase(); out[k] = SCHRIFTEN.indexOf(f) >= 0 ? f : basis[k]; }
      else if (k === "shadow") out[k] = !!v;
    }
    return out;
  }
  function blendeMischen(basis, ueber) {
    const out = Object.assign({}, basis);
    if (!istDict(ueber)) return out;
    if (!istNix(ueber.ein)) out.ein = blendeart(ueber.ein, basis.ein);
    if (!istNix(ueber.aus)) out.aus = blendeart(ueber.aus, basis.aus);
    if (!istNix(ueber.dauer_s)) out.dauer_s = rund(clamp(num(ueber.dauer_s, basis.dauer_s), 0.05, 10));
    return out;
  }

  function ausloeser(a) {
    if (!istDict(a)) return null;
    const art = String(a.art || "");
    if (AUSLOESER.indexOf(art) < 0) return null;
    let wert = num(a.wert, 0);
    if (art === "s") wert = Math.max(0, wert);
    else if (art === "pct") wert = clamp(wert, 0, 100);
    else if (art === "etappe_start" || art === "etappe_ende") wert = Math.max(1, Math.trunc(wert));
    else wert = 0;
    return { art, wert: rund(wert) };
  }
  function zeitNormal(z) {
    if (!istDict(z)) return null;
    const von = ausloeser(z.von) || { art: "s", wert: 0 };
    const dauer = !istNix(z.dauer_s) ? num(z.dauer_s, 0) : 0;
    if (dauer > 0) return { von, bis: null, dauer_s: rund(dauer) };
    return { von, bis: ausloeser(z.bis), dauer_s: null };
  }
  function zeitAlt(cfg, praefix) {
    const frm = Math.max(0, num(get(cfg, praefix + "_from_s", 0), 0));
    const to = num(get(cfg, praefix + "_to_s", 0), 0);
    return { von: { art: "s", wert: rund(frm) }, bis: to > 0 ? { art: "s", wert: rund(to) } : null, dauer_s: null };
  }
  function bezug(v, def) {
    if (def === undefined) def = "gesamt";
    if (istNix(v) || v === "") return def;
    if (v === "gesamt" || v === "laufend") return v;
    if (typeof v === "boolean") return def;
    let n;
    if (typeof v === "number") n = Math.trunc(v);
    else if (typeof v === "string" && /^\s*\d+\s*$/.test(v)) n = parseInt(v, 10);
    else return def;
    return n >= 1 ? n : def;
  }
  // sprache-ok: Auslöser-Kürzel, kein sichtbarer Text
  const zeitTrivial = (z) => !z || (z.von.art === "s" && z.von.wert <= 0 && !z.bis && !z.dauer_s);

  const ALT = {
    totals: ["overlay_totals", "tl", DEFAULT_TOTAL_FIELDS],
    live: ["overlay_live", "tr", DEFAULT_LIVE_FIELDS],
    ele: ["overlay_elevation", "bc", null],
  };
  function eintraege(cfg) {
    const roh = get(cfg, "overlay_boxen", null);
    return (Array.isArray(roh) ? roh : []).filter((b) => istDict(b) && b.id);
  }

  function aufloesen(cfg) {
    const gStil = globalStil(cfg), gBlende = globalBlende(cfg);
    const es = eintraege(cfg);
    const jeId = {};
    for (const e of es) { const k = String(e.id); if (!(k in jeId)) jeId[k] = e; }
    const ids = STANDARD_IDS.concat(es.map((e) => String(e.id)).filter((k) => STANDARD_IDS.indexOf(k) < 0));
    const gesehen = {};
    const out = [];
    for (const bid of ids) {
      if (gesehen[bid]) continue;
      gesehen[bid] = true;
      const e = jeId[bid] || {};
      const standard = STANDARD_IDS.indexOf(bid) >= 0;
      let typ, enabled, position, fields, titel, posDef = "cc";
      if (standard) {
        const [praefix, pd, felderDef] = ALT[bid];
        posDef = pd;
        typ = bid;
        enabled = !!get(cfg, praefix + "_enabled", true);
        position = String(get(cfg, praefix + "_position", pd) || pd);
        fields = null;
        if (felderDef) {
          const f = get(cfg, praefix + "_fields", null);
          fields = Array.isArray(f) ? f.map(String) : felderDef.slice();
        }
        titel = "";
      } else {
        typ = BOX_TYPEN.indexOf(e.typ) >= 0 ? e.typ : "totals";
        enabled = !istNix(e.enabled) ? !!e.enabled : true;
        position = String(e.position || "cc");
        const f = e.fields;
        fields = Array.isArray(f) ? f.map(String) : (typ === "live" ? DEFAULT_LIVE_FIELDS : DEFAULT_TOTAL_FIELDS).slice();
        titel = String(e.titel || "").slice(0, 80);
      }
      if (POSITIONEN.indexOf(position) < 0) position = posDef;
      const stil = stilMischen(gStil, e.stil);
      const blende = blendeMischen(gBlende, e.blende);
      let zeit = zeitNormal(e.zeit);
      if (!zeit) zeit = standard ? zeitAlt(cfg, ALT[bid][0]) : { von: { art: "s", wert: 0 }, bis: null, dauer_s: null };
      const bz = typ === "totals" ? bezug(e.bezug) : "gesamt";
      const zeilen = {};
      const rohZ = istDict(e.zeilen) ? e.zeilen : {};
      if (typ !== "ele") {
        for (const fid of Object.keys(rohZ).sort()) {
          const zz = rohZ[fid];
          if (!istDict(zz)) continue;
          zeilen[String(fid)] = {
            text_color: !istNix(zz.text_color) ? farbe(zz.text_color, stil.text_color) : stil.text_color,
            groesse: !istNix(zz.groesse) ? rund(clamp(num(zz.groesse, 1), 0.5, 3)) : 1,
            fett: !istNix(zz.fett) ? !!zz.fett : null,
            zeit: zeitNormal(zz.zeit),
            blende: blendeMischen(blende, zz.blende),
            bezug: typ === "totals" ? bezug(zz.bezug, bz) : "gesamt",
          };
        }
      }
      out.push({ id: bid, typ, standard, enabled, position, fields, titel, stil, blende, zeit, bezug: bz, zeilen });
    }
    return out;
  }

  function chartBoxen(cfg) {
    const gBlende = globalBlende(cfg);
    const out = [];
    (get(cfg, "charts", null) || []).forEach((ch, i) => {
      if (!istDict(ch)) return;
      const frm = Math.max(0, num(ch.from_s, 0));
      const to = num(ch.to_s, 0);
      out.push({ id: "chart-" + i, typ: "chart", standard: false, enabled: true,
        blende: Object.assign({}, gBlende), bezug: "gesamt", zeilen: {},
        zeit: { von: { art: "s", wert: rund(frm) }, bis: to > 0 ? { art: "s", wert: rund(to) } : null, dauer_s: null } });
    });
    return out;
  }

  function hatZeitsteuerung(cfg) {
    for (const b of aufloesen(cfg).concat(chartBoxen(cfg))) {
      if (!b.enabled) continue;
      if (b.blende.ein !== "none" || b.blende.aus !== "none") return true;
      if (!zeitTrivial(b.zeit) || b.bezug === "laufend") return true;
      for (const k of Object.keys(b.zeilen)) {
        const z = b.zeilen[k];
        if (z.zeit || z.bezug === "laufend") return true;
      }
    }
    return false;
  }

  function etappenGrenzen(cumDist, stageNr) {
    const n = Math.min((cumDist || []).length, (stageNr || []).length);
    if (n < 1) return {};
    const d0 = Number(cumDist[0]);
    const span = Number(cumDist[n - 1]) - d0;
    const tmp = {}, reihe = [];
    for (let i = 0; i < n; i++) {
      const nr = Math.trunc(Number(stageNr[i] || 0));
      if (nr < 1) continue;
      const f = span > 0 ? (Number(cumDist[i]) - d0) / span : 0;
      if (!(nr in tmp)) { tmp[nr] = [f, f]; reihe.push(nr); } else tmp[nr][1] = f;
    }
    const out = {};
    for (const nr of reihe) out[String(nr)] = [rund(tmp[nr][0]), rund(tmp[nr][1])];
    return out;
  }

  // ── Zeitsteuerung ─────────────────────────────────────────────────────────
  function eb(x) {
    if (x >= 1) return 1;
    if (x <= 0) return 0;
    const c1 = 1.70158, c3 = c1 + 1, p = x - 1;
    return 1 + c3 * p * p * p + c1 * p * p;
  }
  function ziel(a, ctx) {
    if (!a) return null;
    const art = a.art, w = a.wert;
    const intro = num(ctx && ctx.intro_s, 0), anim = num(ctx && ctx.anim_s, 0);
    if (art === "s") return ["t", w];
    if (art === "start") return ["t", intro];
    if (art === "ende") return ["t", intro + anim];
    if (art === "pct") return ["f", w / 100];
    const et = ((ctx && ctx.etappen) || {})[String(Math.trunc(w))];
    if (!et) return null;
    return ["f", art === "etappe_start" ? et[0] : et[1]];
  }
  function erreichtBei(z, key, t, frac, mem) {
    if (!z) return null;
    const kind = z[0], x = z[1];
    if (kind === "t") return t >= x - EPS ? x : null;
    if (frac < x - EPS) { delete mem[key]; return null; }
    if (!(key in mem)) mem[key] = mem._lauf ? t : -Infinity;
    return mem[key];
  }
  const UNSICHTBAR = () => ({ sichtbar: false, deckkraft: 0, pop: 1 });

  function zustand(zeit, blende, t, frac, ctx, mem) {
    if (!zeit) return { sichtbar: true, deckkraft: 1, pop: 1 };
    let last = istNix(mem._t) ? null : mem._t;
    if (last !== null && (t < last - 1e-6 || t - last > 1.0)) {
      for (const k of Object.keys(mem)) delete mem[k];
      last = null;
    }
    mem._lauf = last !== null;
    mem._t = t;
    const d = Math.max(0.05, num(blende && blende.dauer_s, 0.5));
    const ein = (blende && blende.ein) || "none", aus = (blende && blende.aus) || "none";
    const tOn = erreichtBei(ziel(zeit.von, ctx), "von", t, frac, mem);
    if (tOn === null) return UNSICHTBAR();
    let tOff;
    if (zeit.dauer_s) {
      tOff = tOn !== -Infinity ? tOn + zeit.dauer_s : null;
      if (tOff !== null && t < tOff - EPS) tOff = null;
    } else {
      tOff = erreichtBei(ziel(zeit.bis, ctx), "bis", t, frac, mem);
    }
    const pIn = tOn === -Infinity ? 1 : clamp((t - tOn) / d, 0, 1);
    let pOut = 1;
    if (tOff !== null) {
      if (aus === "none") {
        if (t > tOff + EPS || tOff === -Infinity) return UNSICHTBAR();
      } else {
        pOut = tOff === -Infinity ? 0 : clamp(1 - (t - tOff) / d, 0, 1);
        if (pOut <= 0) return UNSICHTBAR();
      }
    }
    let op = 1, pop = 1;
    if (ein === "fade" || ein === "both") op *= pIn;
    if (aus === "fade" || aus === "both") op *= pOut;
    if (ein === "pop" || ein === "both") pop *= eb(pIn);
    if (aus === "pop" || aus === "both") pop *= eb(pOut);
    return { sichtbar: true, deckkraft: rund(op), pop: rund(pop) };
  }

  // ── Anwenden auf das DOM (Vorschau, Probelauf, Szene-Render, klassischer Render) ──
  // Box = [data-ovbox="<id>"], Zeile = [data-f="<fid>"] darin. `speicher` behält je
  // Box/Zeile den Zustand der Strecken-Auslöser über die Bilder hinweg.
  // t < 0 = Ruhezustand (keine Zeitsteuerung, alles sichtbar, Bezug-Werte bleiben).
  function setzen(el, z, istZeile) {
    if (!z) {
      el.style.visibility = ""; el.style.opacity = "";
      if (istZeile) el.style.transform = ""; else el.style.setProperty("--rz-ov-pop", "1");
      return;
    }
    el.style.visibility = z.sichtbar ? "" : "hidden";
    el.style.opacity = (z.sichtbar && z.deckkraft < 1) ? String(z.deckkraft) : "";
    if (istZeile) el.style.transform = (z.sichtbar && z.pop !== 1) ? `scale(${z.pop})` : "";
    else el.style.setProperty("--rz-ov-pop", z.sichtbar ? String(z.pop) : "1");
  }
  function bezugWert(el, bz, stageNr) {
    let werte = el.__rzStageVals;
    if (werte === undefined) {
      try { werte = JSON.parse(el.getAttribute("data-stage-values") || "null"); } catch (_) { werte = null; }
      el.__rzStageVals = werte;
    }
    if (!werte) return;
    const key = bz === "laufend" ? String(stageNr || "") : bz === "gesamt" ? "gesamt" : String(bz);
    const txt = (key in werte) ? werte[key] : (werte.gesamt !== undefined ? werte.gesamt : "–");
    const v = el.querySelector(".value, .ov-v");
    if (v && v.textContent !== txt) v.textContent = txt;
  }
  function anwenden(root, boxen, t, frac, stageNr, ctx, speicher) {
    if (!root || !boxen) return;
    speicher = speicher || {};
    for (const b of boxen) {
      if (!b || !b.enabled) continue;
      const el = root.querySelector('[data-ovbox="' + b.id + '"]');
      if (!el) continue;
      if (t < 0) {
        setzen(el, null, false);
        el.querySelectorAll("[data-f]").forEach((r) => setzen(r, null, true));
        continue;
      }
      const mem = speicher[b.id] || (speicher[b.id] = {});
      setzen(el, zustand(b.zeit, b.blende, t, frac, ctx, mem), false);
      for (const fid of Object.keys(b.zeilen || {})) {
        const zl = b.zeilen[fid];
        if (!zl.zeit) continue;
        const r = el.querySelector('[data-f="' + fid + '"]');
        if (!r) continue;
        const m2 = speicher[b.id + "|" + fid] || (speicher[b.id + "|" + fid] = {});
        setzen(r, zustand(zl.zeit, zl.blende, t, frac, ctx, m2), true);
      }
      el.querySelectorAll("[data-stage-values]").forEach((r) => {
        const fid = r.getAttribute("data-f");
        const zl = (b.zeilen || {})[fid];
        bezugWert(r, zl ? zl.bezug : b.bezug, stageNr);
      });
    }
  }

  const api = { aufloesen, chartBoxen, zustand, anwenden, etappenGrenzen, hatZeitsteuerung,
                zeitNormal, globalStil, globalBlende, bezugWert,
                STANDARD_IDS, AUSLOESER, BLENDEN, POSITIONEN, SCHRIFTEN };
  // Unter node (Wächter) setzt der Aufrufer vorher globalThis.window = globalThis.
  if (root) root.rzOverlayBoxen = api;
})(typeof window !== "undefined" ? window : null);
