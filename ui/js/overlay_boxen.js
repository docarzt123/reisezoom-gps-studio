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
  // 24.09.2026 (Overlay-Spur, docs/OVERLAY-BOXEN.md §6): Balkenränder der Timeline sind
  // video_start (s ab Start), strecke (Streckenanteil 0..1), video_ende (s vor Ende).
  const AUSLOESER = ["s", "pct", "etappe_start", "etappe_ende", "start", "ende",
                     "video_start", "strecke", "video_ende"];
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
    const d = {
      ein: blendeart(get(cfg, "overlay_entry", "none")),
      aus: blendeart(get(cfg, "overlay_exit", "none")),
      dauer_s: rund(clamp(num(get(cfg, "overlay_blende_s", 0.5), 0.5), 0.05, 10)),
    };
    d.ein_s = d.aus_s = d.dauer_s;
    return d;
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
    if (!istNix(ueber.dauer_s)) {
      out.dauer_s = rund(clamp(num(ueber.dauer_s, basis.dauer_s), 0.05, 10));
      out.ein_s = out.aus_s = out.dauer_s;
    }
    // 24.09.2026 — Ein- und Ausblendung mit eigener Dauer (in der Timeline ziehbar).
    for (const k of ["ein_s", "aus_s"]) {
      if (!istNix(ueber[k])) out[k] = rund(clamp(num(ueber[k], out[k]), 0, 30));
    }
    return out;
  }

  function ausloeser(a) {
    if (!istDict(a)) return null;
    const art = String(a.art || "");
    if (AUSLOESER.indexOf(art) < 0) return null;
    let wert = num(a.wert, 0);
    if (art === "s" || art === "video_start" || art === "video_ende") wert = Math.max(0, wert);
    else if (art === "strecke") wert = clamp(wert, 0, 1);
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
  /** 24.09.2026 — mehrere Zeiträume je Box: `zeit` darf eine Liste sein.
   *  → Liste normalisierter Zeiten (≥ 1) oder null. */
  function zeitListe(z) {
    if (Array.isArray(z)) {
      const out = z.map(zeitNormal).filter((x) => !!x);
      return out.length ? out : null;
    }
    const zn = zeitNormal(z);
    return zn ? [zn] : null;
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
  const zeitTrivial = (z) => {
    if (!z) return true;
    const vonNull = (z.von.art === "s" || z.von.art === "video_start") && z.von.wert <= 0;
    const bisEnde = !z.bis || (z.bis.art === "video_ende" && z.bis.wert <= 0);
    return vonNull && bisEnde && !z.dauer_s;
  };

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
      let zeiten = zeitListe(e.zeit);
      if (!zeiten) zeiten = [standard ? zeitAlt(cfg, ALT[bid][0]) : { von: { art: "s", wert: 0 }, bis: null, dauer_s: null }];
      const zeit = zeiten[0];
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
      out.push({ id: bid, typ, standard, enabled, position, fields, titel, stil, blende, zeit, zeiten, bezug: bz, zeilen });
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
      const z = { von: { art: "s", wert: rund(frm) }, bis: to > 0 ? { art: "s", wert: rund(to) } : null, dauer_s: null };
      out.push({ id: "chart-" + i, typ: "chart", standard: false, enabled: true,
        blende: Object.assign({}, gBlende), bezug: "gesamt", zeilen: {}, zeit: z, zeiten: [z] });
    });
    return out;
  }

  function hatZeitsteuerung(cfg) {
    for (const b of aufloesen(cfg).concat(chartBoxen(cfg))) {
      if (!b.enabled) continue;
      if (b.blende.ein !== "none" || b.blende.aus !== "none") return true;
      if ((b.zeiten || []).length > 1 || !zeitTrivial(b.zeit) || b.bezug === "laufend") return true;
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
  /** Gesamtlänge des Videos (Intro + Animation + Halten). */
  function gesamtS(ctx) {
    if (ctx && num(ctx.total_s, 0) > 0) return num(ctx.total_s, 0);
    return num(ctx && ctx.intro_s, 0) + num(ctx && ctx.anim_s, 0) + num(ctx && ctx.hold_s, 0);
  }
  /** Videosekunde, in der der Laufpunkt Streckenanteil f erreicht, aus einer
   *  aufsteigenden Tabelle [[anteil, sekunde], …] (linear dazwischen). */
  function ausTabelle(tab, f) {
    const n = tab.length;
    if (!n) return NaN;
    if (f <= tab[0][0]) return tab[0][1];
    if (f >= tab[n - 1][0]) return tab[n - 1][1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tab[m][0] < f) lo = m; else hi = m; }
    const a = tab[lo], b = tab[hi];
    const q = b[0] > a[0] ? (f - a[0]) / (b[0] - a[0]) : 0;
    return a[1] + (b[1] - a[1]) * q;
  }
  /** Ein Auslöser → ["t", Videosekunde] oder ["f", Streckenanteil] (null = nie).
   *  Streckenanteile werden zur Sekunde, sobald der Aufrufer `ctx.zeitBeiStrecke`
   *  mitgibt (Vorschau, Szene-Render, klassischer Render) — dann ist jede Kante
   *  vorab bekannt und die Box am Balkenende GANZ weg (Marc, 24.09.2026). */
  function ziel(a, ctx) {
    if (!a) return null;
    const art = a.art, w = a.wert;
    const intro = num(ctx && ctx.intro_s, 0), anim = num(ctx && ctx.anim_s, 0);
    let f = null;
    if (art === "s" || art === "video_start") return ["t", w];
    if (art === "video_ende") return ["t", Math.max(0, gesamtS(ctx) - w)];
    if (art === "start") return ["t", intro];
    if (art === "ende") return ["t", intro + anim];
    if (art === "strecke") f = w;
    else if (art === "pct") f = w / 100;
    else {
      const et = ((ctx && ctx.etappen) || {})[String(Math.trunc(w))];
      if (!et) return null;
      f = art === "etappe_start" ? et[0] : et[1];
    }
    const zbs = ctx && typeof ctx.zeitBeiStrecke === "function" ? ctx.zeitBeiStrecke : null;
    const t = zbs ? Number(zbs(clamp(f, 0, 1)))
      : (ctx && Array.isArray(ctx.strecke_zeit) ? ausTabelle(ctx.strecke_zeit, clamp(f, 0, 1)) : NaN);
    if (isFinite(t)) return ["t", t];
    return ["f", f];
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
  const hatEin = (bl) => !!bl && bl.ein && bl.ein !== "none";
  const hatAus = (bl) => !!bl && bl.aus && bl.aus !== "none";
  function blendeDauer(bl, k) {
    const v = bl ? (istNix(bl[k]) ? bl.dauer_s : bl[k]) : 0.5;
    return Math.max(0, num(v, 0.5));
  }
  function mischen(bl, pIn, pOut) {
    const ein = (bl && bl.ein) || "none", aus = (bl && bl.aus) || "none";
    let op = 1, pop = 1;
    if (ein === "fade" || ein === "both") op *= pIn;
    if (aus === "fade" || aus === "both") op *= pOut;
    if (ein === "pop" || ein === "both") pop *= eb(pIn);
    if (aus === "pop" || aus === "both") pop *= eb(pOut);
    return { sichtbar: true, deckkraft: rund(op), pop: rund(pop) };
  }

  /** Die Kanten einer Zeit in Videosekunden: {an, aus} oder null, wenn eine
   *  Kante am Streckenanteil hängt und keine Umrechnung da ist. `aus` =
   *  Infinity heißt „bis zum Ende, Länge unbekannt". Für die Timeline. */
  function kanten(zeit, ctx) {
    if (!zeit) return { an: 0, aus: gesamtS(ctx) || Infinity };
    const zv = ziel(zeit.von, ctx);
    if (!zv || zv[0] !== "t") return null;
    let aus;
    if (zeit.dauer_s) aus = zv[1] + zeit.dauer_s;
    else if (!zeit.bis) aus = gesamtS(ctx) || Infinity;
    else {
      const zb = ziel(zeit.bis, ctx);
      if (!zb || zb[0] !== "t") return null;
      aus = zb[1];
    }
    return { an: zv[1], aus };
  }

  /** Sichtbarkeit, Deckkraft und Pop einer Box/Zeile zur Videosekunde t.
   *
   *  24.09.2026 (Marc): Der Balken in der Timeline IST die Zeit der Box — am
   *  Anfang beginnt die Einblendung, am ENDE ist sie ganz weg; die Blenden
   *  liegen innerhalb (je eigene Dauer `ein_s`/`aus_s`, bei zu kurzem Balken
   *  anteilig gekürzt). Vorher begann die Ausblendung erst am „bis".
   *
   *  Rückfall ohne Umrechnung Strecke → Sekunde (Standbild ohne Kontext): der
   *  frühere Weg über `mem` — ein Streckenauslöser merkt sich die Sekunde, in
   *  der er erreicht wurde, die Ausblendung beginnt dort. */
  function zustand(zeit, blende, t, frac, ctx, mem) {
    if (!zeit) return { sichtbar: true, deckkraft: 1, pop: 1 };
    const k = kanten(zeit, ctx);
    if (k) {
      const an = k.an, aus = k.aus;
      if (t < an - EPS || t > aus + EPS) return UNSICHTBAR();
      let a = hatEin(blende) ? blendeDauer(blende, "ein_s") : 0;
      let b = hatAus(blende) ? blendeDauer(blende, "aus_s") : 0;
      const laenge = aus - an;
      if (isFinite(laenge) && a + b > laenge && a + b > 0) {
        const f = Math.max(0, laenge) / (a + b);
        a *= f; b *= f;
      }
      const pIn = a > 0 ? clamp((t - an) / a, 0, 1) : 1;
      const pOut = (b > 0 && isFinite(aus)) ? clamp((aus - t) / b, 0, 1) : 1;
      if (hatAus(blende) && pOut <= 0) return UNSICHTBAR();
      return mischen(blende, pIn, pOut);
    }
    // ── Rückfall: Strecken-Auslöser über `mem` ──
    let last = istNix(mem._t) ? null : mem._t;
    if (last !== null && (t < last - 1e-6 || t - last > 1.0)) {
      for (const key of Object.keys(mem)) delete mem[key];
      last = null;
    }
    mem._lauf = last !== null;
    mem._t = t;
    const dIn = blendeDauer(blende, "ein_s"), dOut = blendeDauer(blende, "aus_s");
    const tOn = erreichtBei(ziel(zeit.von, ctx), "von", t, frac, mem);
    if (tOn === null) return UNSICHTBAR();
    let tOff;
    if (zeit.dauer_s) {
      tOff = tOn !== -Infinity ? tOn + zeit.dauer_s : null;
      if (tOff !== null && t < tOff - EPS) tOff = null;
    } else if (!zeit.bis) {
      tOff = null;
    } else {
      tOff = erreichtBei(ziel(zeit.bis, ctx), "bis", t, frac, mem);
    }
    const pIn = (tOn === -Infinity || dIn <= 0) ? 1 : clamp((t - tOn) / dIn, 0, 1);
    let pOut = 1;
    if (tOff !== null) {
      if (!hatAus(blende)) {
        if (t > tOff + EPS || tOff === -Infinity) return UNSICHTBAR();
      } else {
        pOut = (tOff === -Infinity || dOut <= 0) ? 0 : clamp(1 - (t - tOff) / dOut, 0, 1);
        if (pOut <= 0) return UNSICHTBAR();
      }
    }
    return mischen(blende, pIn, pOut);
  }

  /** Mehrere Zeiträume einer Box (24.09.2026): sichtbar, sobald einer greift; es
   *  zählt der Zeitraum mit der größten Deckkraft (er liefert auch den Pop). */
  function zustandListe(zeiten, blende, t, frac, ctx, speicher, schluessel) {
    let best = null;
    (zeiten && zeiten.length ? zeiten : [null]).forEach((z, i) => {
      const key = i ? schluessel + "#" + i : schluessel;
      const mem = speicher[key] || (speicher[key] = {});
      const st = zustand(z, blende, t, frac, ctx, mem);
      if (!best || (st.sichtbar && (!best.sichtbar || st.deckkraft > best.deckkraft))) best = st;
    });
    return best;
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
      setzen(el, zustandListe(b.zeiten || [b.zeit], b.blende, t, frac, ctx, speicher, b.id), false);
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
                zeitNormal, globalStil, globalBlende, bezugWert, kanten, gesamtS, ausTabelle, zeitListe, zustandListe,
                STANDARD_IDS, AUSLOESER, BLENDEN, POSITIONEN, SCHRIFTEN };
  // Unter node (Wächter) setzt der Aufrufer vorher globalThis.window = globalThis.
  if (root) root.rzOverlayBoxen = api;
})(typeof window !== "undefined" ? window : null);
