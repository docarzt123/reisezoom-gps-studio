/* Tempo-Farben (17.10.2026, umgebaut 18.10.2026): Hilfen für „Mehrere Track-Farben“ mit der Quelle Geschwindigkeit.
 *
 * Die Roh-Geschwindigkeit je Punkt springt (GPS-Rauschen, Stillstand). Für die Farben wird sie über ein zentriertes
 * Zeitfenster aus Distanz und Zeit neu gerechnet (glaetten):
 *
 *   v_i = (Strecke im Fenster) / (Zeit im Fenster) · 3,6      Fenster = [t_i − F/2, t_i + F/2], am Rand gekürzt
 *
 * Das Fenster ist mindestens 15 s und mindestens ±2 Punkte breit: die Reihe des Animators ist auf 800 Punkte
 * ausgedünnt, bei langen Touren liegen die Punkte weiter als F/2 auseinander.
 *
 * „Auto“ endet beim 98. Perzentil (perzentil), damit einzelne Ausreißer nicht die ganze Skala verschieben;
 * „Ampel“ (ampelStufen) liefert die drei Stufen grün → gelb → rot über dieselbe Spanne.
 * Rein und ohne DOM — läuft in der App (Animator) und unter node (Test).
 */
(function (root) {
  "use strict";

  /** km/h je Punkt aus kumulierter Distanz (m) und Zeit (s); ohne Zeit im Fenster (Δt ≤ 0) 0. */
  function glaetten(cumDistM, cumTimeS, fensterS) {
    const F = (fensterS === undefined || fensterS === null) ? 15 : fensterS;
    const n = Math.min(cumDistM.length, cumTimeS.length);
    const aus = new Array(n);
    const halb = F / 2;
    let lo = 0, hi = 0;   // beide Fenstergrenzen wandern nur vorwärts (Zeit steigt monoton): das engt die Binärsuche ein
    for (let i = 0; i < n; i++) {
      const t = cumTimeS[i];
      // erster Index mit t >= t_i − F/2 (Binärsuche im Bereich [lo, i])
      let a = lo, b = i;
      while (a < b) { const m = (a + b) >> 1; if (cumTimeS[m] < t - halb) a = m + 1; else b = m; }
      lo = a;
      // letzter Index mit t <= t_i + F/2 (Binärsuche im Bereich [max(hi, i), n − 1])
      a = Math.max(hi, i); b = n - 1;
      while (a < b) { const m = (a + b + 1) >> 1; if (cumTimeS[m] > t + halb) b = m - 1; else a = m; }
      hi = a;
      // Mindestens ±2 Punkte im Fenster (wie core/animator.py): bei dünnen Reihen (Punktabstand > F/2) wäre es sonst leer.
      // Erweitert wird nur lokal — lo/hi bleiben die echten Suchgrenzen für den nächsten Punkt.
      const l = Math.min(lo, Math.max(0, i - 2)), h = Math.max(hi, Math.min(n - 1, i + 2));
      const dt = cumTimeS[h] - cumTimeS[l];
      aus[i] = dt > 0 ? Math.max(0, (cumDistM[h] - cumDistM[l]) / dt * 3.6) : 0;
    }
    return aus;
  }

  /** p-Perzentil (0..100) mit linearer Interpolation; leer → 0. */
  function perzentil(werte, p) {
    const s = werte.filter(v => typeof v === "number" && isFinite(v)).sort((x, y) => x - y);
    if (!s.length) return 0;
    const pos = Math.max(0, Math.min(100, p)) * (s.length - 1) / 100;
    const u = Math.floor(pos), o = Math.min(s.length - 1, u + 1);
    return s[u] + (s[o] - s[u]) * (pos - u);
  }

  /** Ampel-Skala grün → gelb → rot über lo..hi (Mitte = Mittelwert), v auf 0,1 gerundet wie bei „Auto“. */
  function ampelStufen(lo, hi) {
    const r = (x) => Math.round(x * 10) / 10;
    return [{ v: r(lo), color: "#2e9e44" }, { v: r((lo + hi) / 2), color: "#f2c40f" }, { v: r(hi), color: "#d7191c" }];
  }

  root.rzTempoFarben = { glaetten, perzentil, ampelStufen };
})(typeof window !== "undefined" ? window : globalThis);
