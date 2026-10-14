// Hochflug (14.10.2026, Marc: „einen großen, hohen Flug angeben, obwohl es gar nicht so weit ist … die Kurve nicht nur
// horizontal, auch vertikal … wir wollen das beste Tool sein, dann brauchen wir einen richtigen Höheneditor“) —
// Höhenprofil eines Etappen-Abschnitts: `{ m: höchster Punkt in Metern (0 = aus), p: [[u, h], …] }` mit u = Anteil der
// Strecke 0…1 und h = Anteil der Höhe 0…1. Die Kurve läuft monoton kubisch durch die Punkte (Fritsch-Carlson: kein Über-
// oder Unterschwingen, also nie unter den Boden). Spiegel: core/hochflug.py `profil` — bei Änderung beide pflegen.
(function () {
  "use strict";
  const VORLAGEN = {
    bogen:     [[0, 0], [0.5, 1], [1, 0]],
    plateau:   [[0, 0], [0.22, 1], [0.78, 1], [1, 0]],
    steigflug: [[0, 0], [0.8, 1], [1, 0]],
  };
  const MIN_M = 10, MAX_M = 1000000;

  function sortiert(p) {
    const q = (Array.isArray(p) ? p : VORLAGEN.bogen).map(x => [Math.max(0, Math.min(1, +x[0] || 0)), Math.max(0, Math.min(1, +x[1] || 0))]);
    q.sort((a, b) => a[0] - b[0]);
    if (!q.length || q[0][0] > 0) q.unshift([0, 0]);
    if (q[q.length - 1][0] < 1) q.push([1, 0]);
    return q;
  }
  /** Höhe 0…1 an der Stelle u (0…1). */
  function profil(p, u) {
    const q = sortiert(p), n = q.length;
    u = Math.max(0, Math.min(1, +u || 0));
    if (n === 1) return q[0][1];
    const d = [], m = new Array(n).fill(0);
    for (let k = 0; k < n - 1; k++) { const dx = q[k + 1][0] - q[k][0]; d.push(dx > 1e-9 ? (q[k + 1][1] - q[k][1]) / dx : 0); }
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let k = 1; k < n - 1; k++) m[k] = (d[k - 1] * d[k] <= 0) ? 0 : (d[k - 1] + d[k]) / 2;
    for (let k = 0; k < n - 1; k++) {
      if (d[k] === 0) { m[k] = 0; m[k + 1] = 0; continue; }
      const a = m[k] / d[k], b = m[k + 1] / d[k], s = a * a + b * b;
      if (s > 9) { const t = 3 / Math.sqrt(s); m[k] = t * a * d[k]; m[k + 1] = t * b * d[k]; }
    }
    let k = 0;
    while (k < n - 2 && u > q[k + 1][0]) k++;
    const x0 = q[k][0], x1 = q[k + 1][0], h = x1 - x0;
    if (h <= 1e-9) return q[k + 1][1];
    const t = (u - x0) / h, t2 = t * t, t3 = t2 * t;
    const v = (2 * t3 - 3 * t2 + 1) * q[k][1] + (t3 - 2 * t2 + t) * h * m[k] + (-2 * t3 + 3 * t2) * q[k + 1][1] + (t3 - t2) * h * m[k + 1];
    return Math.max(0, Math.min(1, v));
  }
  /** Regler 0…100 ↔ Meter (logarithmisch 10 m … 1000 km; 0 = aus). */
  const reglerZuM = (v) => (+v <= 0) ? 0 : Math.round(Math.pow(10, Math.log10(MIN_M) + (Math.log10(MAX_M) - Math.log10(MIN_M)) * (+v / 100)));
  const mZuRegler = (m) => (+m <= 0) ? 0 : Math.max(1, Math.round(100 * (Math.log10(Math.max(MIN_M, Math.min(MAX_M, +m))) - Math.log10(MIN_M)) / (Math.log10(MAX_M) - Math.log10(MIN_M))));   // ≥ 1: eine kleine Höhe ist nie „aus“
  function mText(m) {
    if (!(m > 0)) return "–";
    if (m >= 1000) { const km = m / 1000; return (km >= 100 ? Math.round(km) : km >= 10 ? km.toFixed(0) : km.toFixed(1)).toLocaleString() + " km"; }
    return Math.round(m) + " m";
  }

  /** Editor in `box`: Regler „Höchster Punkt“, Profil mit Ziehpunkten, Vorlagen. `wert` = {m, p} oder null.
   *  `aendern(neu)` bei jeder fertigen Änderung (neu = {m, p} oder null = aus). `T(key, fallback)` für Texte.
   *  `live(neu)` (optional) schon WÄHREND des Ziehens — für die Linie in der Luft auf der Karte (14.10.2026). */
  function editor(box, wert, aendern, T, live) {
    T = T || ((k, f) => f);
    let st = { m: (wert && wert.m > 0) ? +wert.m : 0, p: sortiert(wert && wert.p), kreisen: !(wert && wert.kreisen === false) };
    const W = 260, H = 96, R = 7, PAD = 8;
    box.innerHTML = `<div class="hp-kopf"><label>${T("animator.hoch.max", "Höchster Punkt")} <b class="hp-m">${mText(st.m)}</b></label>
        <input type="range" class="hp-regler" min="0" max="100" step="1" value="${mZuRegler(st.m)}"></div>
      <svg class="hp-svg" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none"></svg>
      <label class="hp-kreisen" title="${T("animator.hoch.kreisen_tip", "Folgt die Kamera dem Flug, dreht sie sich einmal halb herum: an der Spitze von der Seite, beim Landen der Blick zurück auf den Bogen")}"><input type="checkbox" class="hp-kreisen-cb"${st.kreisen ? " checked" : ""}> ${T("animator.hoch.kreisen", "Kamera kreist herum (Bogen von der Seite)")}</label>
      <div class="hp-fuss"><span class="muted">${T("animator.hoch.hilfe", "Punkte ziehen · Doppelklick: Punkt dazu oder weg")}</span>
        <span class="hp-vorlagen">${Object.keys(VORLAGEN).map(k => `<button type="button" class="btn btn-small" data-hp="${k}">${T("animator.hoch.v_" + k, { bogen: "Bogen", plateau: "Plateau", steigflug: "Steigflug" }[k])}</button>`).join("")}</span></div>`;
    const svg = box.querySelector(".hp-svg");
    const X = (u) => PAD + u * (W - 2 * PAD), Y = (h) => H - PAD - h * (H - 2 * PAD);
    const U = (x) => Math.max(0, Math.min(1, (x - PAD) / (W - 2 * PAD))), Hh = (y) => Math.max(0, Math.min(1, (H - PAD - y) / (H - 2 * PAD)));
    let _liveRaf = 0;
    const liveMelden = () => {
      if (typeof live !== "function" || _liveRaf) return;
      _liveRaf = requestAnimationFrame(() => { _liveRaf = 0; try { live(st.m > 0 ? { m: st.m, p: st.p.map(x => x.slice()), ...(st.kreisen ? {} : { kreisen: false }) } : null); } catch (_) {} });
    };
    const melden = () => { aendern(st.m > 0 ? Object.assign({ m: st.m, p: st.p.map(x => [Math.round(x[0] * 1000) / 1000, Math.round(x[1] * 1000) / 1000]) }, st.kreisen ? {} : { kreisen: false }) : null); };
    function zeichnen() {
      const pfad = [];
      for (let i = 0; i <= 64; i++) { const u = i / 64; pfad.push(`${i ? "L" : "M"}${X(u).toFixed(1)},${Y(profil(st.p, u)).toFixed(1)}`); }
      const aus = !(st.m > 0);
      svg.innerHTML = `<rect x="0" y="0" width="${W}" height="${H}" class="hp-grund"/>`
        + `<line x1="${PAD}" y1="${H - PAD}" x2="${W - PAD}" y2="${H - PAD}" class="hp-boden"/>`
        + `<path d="${pfad.join(" ")} L${X(1)},${H - PAD} L${X(0)},${H - PAD} Z" class="hp-flaeche${aus ? " aus" : ""}"/>`
        + `<path d="${pfad.join(" ")}" class="hp-linie${aus ? " aus" : ""}"/>`
        + st.p.map((q, i) => `<circle cx="${X(q[0]).toFixed(1)}" cy="${Y(q[1]).toFixed(1)}" r="${R}" class="hp-punkt${aus ? " aus" : ""}" data-k="${i}"/>`).join("");
      box.querySelector(".hp-m").textContent = mText(st.m);
    }
    const pos = (ev) => { const r = svg.getBoundingClientRect(); return [(ev.clientX - r.left) * W / r.width, (ev.clientY - r.top) * H / r.height]; };
    let zug = -1;
    svg.addEventListener("pointerdown", (ev) => {
      const k = ev.target && ev.target.dataset ? +ev.target.dataset.k : NaN;
      if (!isFinite(k)) return;
      zug = k; svg.setPointerCapture(ev.pointerId); ev.preventDefault();
    });
    svg.addEventListener("pointermove", (ev) => {
      if (zug < 0) return;
      const [x, y] = pos(ev), n = st.p.length;
      let u = U(x);
      if (zug === 0) u = 0; else if (zug === n - 1) u = 1;
      else u = Math.max(st.p[zug - 1][0] + 0.02, Math.min(st.p[zug + 1][0] - 0.02, u));
      st.p[zug] = [u, Hh(y)];
      zeichnen(); liveMelden();
    });
    const loslassen = () => { if (zug >= 0) { zug = -1; melden(); } };
    svg.addEventListener("pointerup", loslassen);
    svg.addEventListener("pointercancel", loslassen);
    // Doppelklick: nach dem Ziehen hält das SVG den Zeiger fest (setPointerCapture), das Ereignis kommt dann vom SVG und
    // nicht vom Punkt — darum den nächsten Punkt über den Abstand suchen
    const punktBei = (x, y) => {
      let best = -1, bd = (R * 1.6) * (R * 1.6);
      st.p.forEach((q, i) => { const dx = X(q[0]) - x, dy = Y(q[1]) - y, d = dx * dx + dy * dy; if (d <= bd) { bd = d; best = i; } });
      return best;
    };
    svg.addEventListener("dblclick", (ev) => {
      const [x0, y0] = pos(ev), k = punktBei(x0, y0);
      if (k >= 0) {
        if (k > 0 && k < st.p.length - 1) st.p.splice(k, 1);
      } else {
        st.p.push([U(x0), Hh(y0)]); st.p = sortiert(st.p);
      }
      zeichnen(); melden();
    });
    box.querySelector(".hp-regler").addEventListener("input", (ev) => { st.m = reglerZuM(ev.target.value); zeichnen(); liveMelden(); });
    box.querySelector(".hp-regler").addEventListener("change", () => melden());
    box.querySelector(".hp-kreisen-cb").addEventListener("change", (ev) => { st.kreisen = !!ev.target.checked; melden(); });
    box.querySelectorAll("[data-hp]").forEach(b => b.addEventListener("click", () => {
      st.p = sortiert(VORLAGEN[b.dataset.hp]); if (!(st.m > 0)) st.m = 1000;
      box.querySelector(".hp-regler").value = mZuRegler(st.m); zeichnen(); melden();
    }));
    zeichnen();
    return { setzen: (w) => { st = { m: (w && w.m > 0) ? +w.m : 0, p: sortiert(w && w.p), kreisen: !(w && w.kreisen === false) }; box.querySelector(".hp-regler").value = mZuRegler(st.m); box.querySelector(".hp-kreisen-cb").checked = st.kreisen; zeichnen(); } };
  }

  window.rzHochflug = { profil, editor, sortiert, reglerZuM, mZuRegler, mText, VORLAGEN };
})();
