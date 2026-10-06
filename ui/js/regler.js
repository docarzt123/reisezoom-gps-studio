/* Regler-Füllung (05.10.2026 abends, FRAGEN F-7 Farbkonzept „Trailframe“): Jeder Schieberegler zeigt links vom Griff
 * die Akzentfarbe. WebKit hat dafür kein Pseudo-Element, deshalb setzt dieses Skript die CSS-Variable --rz-fill
 * (0–100 %) — bei jeder Eingabe UND wenn Code den Wert setzt (Einstellungen laden, ⌘Z, Looks): dazu wird der
 * `value`-Setter von <input> umwickelt. Kein Einfluss auf Werte oder Ereignisse.
 */
(function () {
  "use strict";
  function fuellen(el) {
    if (!el || el.type !== "range") return;
    const min = parseFloat(el.min), max = parseFloat(el.max), v = parseFloat(el.value);
    const lo = isFinite(min) ? min : 0, hi = isFinite(max) ? max : 100;
    const p = hi > lo && isFinite(v) ? Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100)) : 0;
    el.style.setProperty("--rz-fill", p.toFixed(2) + "%");
  }
  try {
    const P = HTMLInputElement.prototype, d = Object.getOwnPropertyDescriptor(P, "value");
    if (d && d.set && !P.__rzReglerFuellung) {
      Object.defineProperty(P, "value", { configurable: true, enumerable: d.enumerable, get: d.get,
        set(v) { d.set.call(this, v); if (this.type === "range") fuellen(this); } });
      const dn = Object.getOwnPropertyDescriptor(P, "valueAsNumber");
      if (dn && dn.set) Object.defineProperty(P, "valueAsNumber", { configurable: true, enumerable: dn.enumerable, get: dn.get,
        set(v) { dn.set.call(this, v); if (this.type === "range") fuellen(this); } });
      P.__rzReglerFuellung = true;
    }
  } catch (_) { /* ohne Umwicklung bleibt nur die Füllung beim Ziehen */ }
  document.addEventListener("input", (e) => fuellen(e.target), true);
  document.addEventListener("change", (e) => fuellen(e.target), true);
  // neu eingefügte Regler (Module, Dialoge) einmal füllen; min/max-Änderungen ebenso
  function alle(wurzel) { (wurzel.querySelectorAll ? wurzel.querySelectorAll('input[type="range"]') : []).forEach(fuellen); }
  const mo = new MutationObserver((ms) => {
    for (const m of ms) {
      if (m.type === "attributes") { fuellen(m.target); continue; }
      for (const n of m.addedNodes) { if (n.nodeType === 1) { if (n.matches && n.matches('input[type="range"]')) fuellen(n); else alle(n); } }
    }
  });
  function los() { alle(document); mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["min", "max", "value"] }); }
  if (document.body) los(); else document.addEventListener("DOMContentLoaded", los);
  window.rzReglerFuellen = fuellen;
})();
