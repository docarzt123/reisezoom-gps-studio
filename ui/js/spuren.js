/* Der Zeitplan eines Projekts: Gruppen, Halte, Inhalte — die EINE Wahrheit.
 *
 * Wortgleiches Gegenstück zu `core/spuren.py` (IDEAS §60, Marc 09.09.2026).
 * Der Python-Teil ist die Vorschrift und wird dort geprüft; dieser hier läuft
 * in der Oberfläche, weil die Vorschau den Plan SYNCHRON braucht — `_reiseBauen`
 * wird aus acht Stellen heraus gerufen, und eine zweite asynchrone Schicht
 * (Brücke → Antwort → Nachziehen) hat uns bei der Tempo-Kurve schon einen Tag
 * gekostet. Dass beide dasselbe rechnen, misst `tests/test_spuren_js_vs_py.py`
 * mit `node` an zufälligen Fällen — wer eine Seite anfasst, fasst beide an.
 *
 *   * Alle Tracks eines Projekts sind gleich lang — so lang wie das Video.
 *     Ein Track ist Halt + Inhalt + Halt; die Anordnung steckt darin, wo seine
 *     Halte sitzen. „Nacheinander" = Gruppe 2 hat vorne einen langen Halt.
 *   * Alles ist eine Gruppe, auch eine einzelne Tour.
 *   * Der Faktor ist die gespeicherte Zahl, die Länge das Ergebnis.
 *   * Die Projektlänge ist das Maximum; kürzere werden hinten aufgefüllt.
 *
 * Zeiten hier sind ANIMATIONSZEIT: 0 = Ende des Anlaufs (intro_s). Anlauf und
 * Nachlauf des Projekts liegen davor und dahinter und gehören allen Gruppen.
 */
(function () {
  "use strict";

  const MIN_INHALT_S = 0.3;

  function sauber(v, vorgabe) {
    const f = parseFloat(v);
    return (isFinite(f)) ? f : (vorgabe || 0);
  }

  /** Wie lang der Inhalt einer Gruppe im Video ist: 0,5× = doppelte Zeit. */
  function inhaltDauer(gruppe, rohS) {
    let f = sauber(gruppe.faktor, 1.0);
    if (!(f > 0)) f = 1.0;
    return Math.max(MIN_INHALT_S, sauber(rohS, 0.0) / f);
  }

  /** Den Zeitplan rechnen: wo jede Gruppe liegt und wie lang das Video wird.
   *  `mindestS` (der Wunsch aus „Animation (s)") verlängert, verkürzt nie. */
  function zeitplan(gruppen, rohS, mindestS) {
    const hinweise = [];
    const lagen = [];
    for (const g of gruppen || []) {
      const vor = Math.max(0, sauber(g.vorlauf_s, 0));
      const inh = inhaltDauer(g, (rohS || {})[g.id] || 0);
      lagen.push({ id: g.id, vorlauf_s: vor, inhalt_s: inh, nachlauf_s: 0,
                   zeile: Math.max(0, Math.trunc(sauber(g.zeile, 0))),
                   get von_s() { return this.vorlauf_s; },
                   get bis_s() { return this.vorlauf_s + this.inhalt_s; },
                   get gesamt_s() { return this.vorlauf_s + this.inhalt_s + this.nachlauf_s; } });
    }
    let dauer = 0;
    for (const l of lagen) dauer = Math.max(dauer, l.bis_s);
    if ((mindestS || 0) > dauer + 1e-9) dauer = +mindestS;
    if (!(dauer > 0)) return { dauer_s: 0, lagen: [], hinweise: ["keine Gruppen"] };
    for (const l of lagen) l.nachlauf_s = Math.max(0, dauer - l.bis_s);
    for (const l of lagen) {
      if (Math.abs(l.gesamt_s - dauer) > 1e-6) hinweise.push(`${l.id}: ${l.gesamt_s.toFixed(3)} s statt ${dauer.toFixed(3)} s`);
    }
    const plan = { dauer_s: dauer, lagen, hinweise };
    plan.lage = (gid) => lagen.find(l => l.id === gid) || null;
    return plan;
  }

  /** Wer die Kamera führt: die OBERSTE Gruppe. */
  function kameraGruppe(gruppen) { return (gruppen && gruppen.length) ? gruppen[0] : null; }

  /** Überlappen sich zwei INHALTE? Die Halte zählen nicht. */
  function ueberlappt(a, b) {
    return a.von_s < b.bis_s - 1e-9 && b.von_s < a.bis_s - 1e-9;
  }

  /** Welche Gruppen sich eine Zeile teilen — in Listenreihenfolge, jede in die
   *  erste Zeile, in der ihr Inhalt frei liegt. Zeile 0 ist die KETTE, aus der
   *  die Vorschau ihre Bahn baut. */
  function zeilen(plan) {
    // Erst die mit GEWÜNSCHTER Zeile (zeile ≥ 1, aus dem Ziehen in eine Spur),
    // dann die übrigen in die erste freie; leere Zeilen fallen weg.
    const raus = [];
    const frei = (z, l) => z >= raus.length || !raus[z].some(x => ueberlappt(l, x));
    const rein = (z, l) => { while (raus.length <= z) raus.push([]); raus[z].push(l); };
    for (const l of plan.lagen) {
      if ((l.zeile || 0) >= 1) { let z = l.zeile; while (!frei(z, l)) z++; rein(z, l); }
    }
    for (const l of plan.lagen) {
      if ((l.zeile || 0) >= 1) continue;
      let z = 0; while (!frei(z, l)) z++; rein(z, l);
    }
    return raus.filter(z => z.length).map(z => z.map(l => l.id));
  }

  /** Aus den heutigen Projekt-Feldern die Gruppen bauen (§60, Punkt 11).
   *  `rohS`: je GPX-Pfad die Inhaltslänge bei Faktor 1; `groesse`: je Pfad das
   *  Maß für die anteilige Verteilung (die Punktzahl), sonst zählt rohS. */
  function ausProjekt(animator, rohS, groesse) {
    const a = animator || {};
    const haupt = String(a.haupt_gpx || "");
    const extra = Array.isArray(a.extra_tours) ? a.extra_tours : [];
    let pfade = (haupt ? [haupt] : []).concat(extra.map(t => String((t && t.gpx_path) || "")));
    pfade = pfade.filter(Boolean);
    if (!pfade.length) return [];
    const namen = [String(a.etappe1_name || "")].concat(extra.map(t => String((t && t.name) || "")));
    const farben = [String(a.line_color || "")].concat(extra.map(t => String((t && t.line_color) || "")));
    const mitglied = (p, n, f, vor) => ({ gpx_path: p, name: n, farbe: f, vorlauf_s: vor || 0, sichtbar_vor_inhalt: false });

    if (String(a.tours_ablauf || "reise") === "schwarm") {
      const g = { id: "g1", name: namen[0] || "", faktor: 1.0, vorlauf_s: 0, ueber_s: null,
                  eintraege: [], keyframes: [],
                  leit_gpx: String(a.schwarm_fokus_gpx || a.tours_fokus || ""),
                  ueber_stil: "kino", zu: true, fest: false, mitglieder: [] };
      g.mitglieder = pfade.map((p, i) => mitglied(p, namen[i], farben[i],
        Math.max(0, sauber(i ? (extra[i - 1] || {}).start_s : a.tours_haupt_start_s, 0))));
      return [g];
    }

    // Nacheinander: dieselbe Zeitregel wie `_reise_segmente`.
    const fest = [Math.max(0, sauber(a.etappe1_dauer_s, 0))].concat(extra.map(t => Math.max(0, sauber((t || {}).dauer_s, 0))));
    const budget = Math.max(0, sauber(a.duration_s, 12));
    const rest = Math.max(0, budget - fest.reduce((x, y) => x + y, 0));
    const offen = fest.map((f, i) => f ? -1 : i).filter(i => i >= 0);
    const mass = groesse || rohS || {};
    let offenSumme = offen.reduce((s, i) => s + Math.max(1e-9, sauber(mass[pfade[i]], 1.0)), 0) || 1.0;
    const laengen = pfade.map((p, i) => fest[i] ? fest[i]
      : Math.max(MIN_INHALT_S, rest * Math.max(1e-9, sauber(mass[p], 1.0)) / offenSumme));

    const flugS = sauber(a.fly_duration_s, 3.0);
    const gruppen = [];
    let pos = 0.0;
    pfade.forEach((p, i) => {
      let stil = "kino", eigen = null;
      if (i > 0) {
        const t = extra[i - 1] || {};
        stil = String(t.ueber_stil || "kino");
        eigen = (t.ueber_s == null || t.ueber_s === "") ? null : Math.max(0, sauber(t.ueber_s, 0));
        pos += stil === "schnitt" ? 0 : (eigen == null ? flugS : eigen);
      }
      const roh = Math.max(1e-6, sauber((rohS || {})[p], laengen[i]));
      gruppen.push({ id: "g" + (i + 1), name: namen[i] || "", vorlauf_s: pos,
                     faktor: roh / Math.max(MIN_INHALT_S, laengen[i]),
                     ueber_stil: stil, ueber_s: eigen, eintraege: [], keyframes: [],
                     leit_gpx: "", zu: true, fest: false,
                     mitglieder: [mitglied(p, namen[i], farben[i], 0)] });
      pos += laengen[i];
    });
    return gruppen;
  }

  const api = { MIN_INHALT_S, inhaltDauer, zeitplan, kameraGruppe, ueberlappt, zeilen, ausProjekt };
  // Im Browser am Fenster; der Prüfstand (tests/test_spuren_js_vs_py.py) lädt die
  // Datei unter node mit einem `window`-Schatten — kein CommonJS-Export nötig.
  if (typeof window !== "undefined") window.rzSpuren = api;
})();
