// Reisezoom GPS Studio — GPX-Inspektor-Modul (v0.9.233)
// Marc-Idee + Nutzer-Bug-Report (c): Track Punkt-für-Punkt zeigen und „heilen".
// Phase 1: alle Punkte auf der Karte, 2 Anker wählen → Heilen (Sprung glätten,
// Position+Höhe interpolieren, Zeit behalten → Speed korrigiert sich selbst)
// ODER Lücke füllen (neue Punkte mit interpolierter Position/Höhe/Zeit einfügen).
// Editierter Track wird als <name>_geheilt.gpx gespeichert.

(window.RZGPS_MODULES = window.RZGPS_MODULES || {}).gpxinspect = {
  manifest: {
    slug: "gpxinspect",
    name: "GPX-Inspektor",
    description: "Track heilen",
    icon: "🔍",
    // 02.09.2026 (Marc: „zieh den Inspektor in der Menübar hinter das Archiv,
  // da gehört er hin") — 7 statt 60, also zwischen Archiv (5) und
  // Animator (10). Passt auch zur Aufteilung aus dem Bibliotheks-Umbau:
  // Archiv und Inspektor arbeiten an den DATEN, alles danach an einem
  // Projekt (docs/UMBAU-BIBLIOTHEK.md, Abschnitt 2).
  sort_order: 7,
  },
  mount: function (body, headerActions) { return mountGpxInspect(body, headerActions); },
};

function mountGpxInspect(body, headerActions) {
  let map = null;
  let isUnmounted = false;
  let _points = [];        // editierbare Kopie: [{lat,lon,ele,time}]
  let _srcPath = null;     // konvertierte/gecachte GPX (für Sensor-Reparse)
  // v0.9.456 — alle Quelldateien des aktuellen Tracks. Nach „Track anhängen"
  // stammen die Punkte aus mehreren Dateien; jeder Punkt merkt sich per `si`
  // seinen Index hierin, damit das Backend beim Speichern die Sensorwerte aus
  // der RICHTIGEN Datei liest statt sie über die Naht zu interpolieren.
  let _sources = [];
  let _origPath = null;    // v0.9.335 — Original-Datei des Nutzers (für Default-Speicherort)
  let _hasTime = false, _hasEle = false, _hasSensors = false;
  let _localTimeN = 0, _tc = null;   // 10.09.2026 — Track-Check: Zeiten ohne Zone, letztes Ergebnis
  let _selA = null, _selB = null;   // Anker-Indizes (a <= b)
  let _dirty = false;
  let _drawMode = false;            // Pfad-zeichnen-Modus aktiv?
  let _drawPts = [];                // selbst gesetzte Stützpunkte [{lat,lon}]
  // v0.9.239 — Auto-Despike: erkannte Ausreißer-Gruppen + Navigations-State.
  let _spikes = [];                 // [{a,b,from,to}] a=Anker vor, b=Anker nach
  let _spikeSet = new Set();        // Punkt-Indizes die als Ausreißer markiert sind
  // 12.09.2026 — Fundstellen des Track-Checks, die gerade auf der Karte markiert sind.
  let _tcMarkiert = new Set();
  let _tcZeigeKey = "";             // welche Befund-Art ist markiert
  let _tcZeigeIdx = -1;             // welche Stelle davon wurde zuletzt angesprungen
  let _spikeIdx = -1;               // aktuell anvisierter Ausreißer (für Navigation)
  let _gaps = [];                   // v0.9.294 — erkannte Lücken [{a,b,dist}] (b=a+1) für Auto-Heilen
  let _despikeRan = false;          // wurde schon mind. 1× gesucht? (Slider live-Update)
  let _dragging = false;            // ziehe gerade den ausgewählten Punkt? (v0.9.243)
  let _dragMoved = false;           // hat sich beim Ziehen wirklich was bewegt?
  let _demEles = null;              // v0.9.292 — gesampelte Mapbox-Gelände-Höhe pro Punkt (oder null)
  // v0.9.293 — Höhenprofil-Zoom (Fenster in Punkt-Indizes) + Karten-Sync + Punkt-Modal
  let _profI0 = 0, _profI1 = 0;     // sichtbares Index-Fenster im Profil
  let _syncing = false;             // Reentrancy-Schutz Karte<->Profil
  let _profDraw = null;             // letzte Zeichen-Parameter fürs Hit-Testing
  let _maplib = null;               // Karten-Lib (mapboxgl/maplibregl) für Popup
  let _aMarker = null, _bMarker = null;   // v0.9.304 — deutliche A/B-Anker-Pins
  let _startMarker = null, _zielMarker = null;   // 27.08.2026 — Anfang/Ende der Tour
  let _ptPopup = null;              // Mapbox-Popup mit Punkt-Info (Karte)
  let _clickTimer = null;           // Einzel-/Doppelklick-Entscheidung

  // v0.9.238 — Undo/Redo (Cmd+Z / Cmd+Shift+Z) für ALLE Track-Edits.
  // Snapshot/Restore auf der kompletten _points-Liste. Vor jeder Operation
  // wird der Stand gepusht (force, kein Throttle — jede Aktion ist diskret).
  const _undo = (typeof window.createUndoController === "function") ? window.createUndoController({
    // v0.9.456: `sources` gehört mit in den Snapshot — sonst bliebe nach dem
    // Rückgängigmachen eines „Track anhängen" die Quelldatei in der Liste und
    // die si-Indizes zeigten ins Leere.
    // 13.09.2026 — Logbuch (§68 Stufe 2): der Stand der Einteilung reist im Schnappschuss mit.
    snapshot: () => _undoSnap(),
    apply: (snap) => {
      _points = JSON.parse(JSON.stringify((snap && snap.points) || []));
      _dirty = !!(snap && snap.dirty);
      if (snap && Array.isArray(snap.sources)) _sources = snap.sources.slice();
      // 10.09.2026: Zeiten-Werkzeuge/Umkehren ändern die Uhr — nach Undo/Redo neu ableiten
      _hasTime = _points.length > 0 && _points.every(p => !!p.time);
      { const r = document.getElementById("gpxi-speedrow"); if (r) r.hidden = _hasTime; }
      // A/B-Auswahl ist UI-Zustand (keine Daten) → nach Undo/Redo behalten, solange die
      // Anker-Indizes noch im Track liegen. Nur ungültige (out of range) verwerfen.
      const _n = _points.length;
      if (_selA != null && _selA >= _n) _selA = null;
      if (_selB != null && _selB >= _n) _selB = null;
      if (_selA == null) _selB = null;
      _drawMode = false; _drawPts = [];
      clearSpikes();
      renderAll(); renderDraw(); updateUI();
      // 01.09.2026: nach Undo/Redo hat der Track eine andere Punktzahl —
      // Regler-Maximum und Vorschau müssen mitziehen.
      try { reduzierReglerSync(); } catch (_) {}
      // 10.09.2026 (Echt-Test): nach Undo einer Reparatur muss der Befund-Kasten zurückkommen.
      try { analyseTrack(); } catch (_) {}
      try { _lbUndoAnwenden(snap); } catch (_) {}
    },
    toast: (m) => { try { toast(m, "info", 1000); } catch (_) {} },
    throttleMs: 0,
  }) : null;
  if (_undo) window.__rzUndoControllers.gpxinspect = _undo;
  function _pushUndo(label) { if (_undo) _undo.push(label, { force: true }); }
  /** Der Stand, den der Undo-Stapel merkt — auch für „erst handeln, dann pushen" (s. _pushUndoMit). */
  function _undoSnap() {
    return Object.assign({ points: JSON.parse(JSON.stringify(_points)), dirty: _dirty,
                           sources: _sources.slice() }, _lbSchnappschuss());
  }
  /** 14.09.2026: Schritt mit VORHER erfasstem Stand pushen — erst wenn die Brücke Erfolg
   *  gemeldet hat. Sonst bleibt bei Fehler/Abbruch ein leerer ⌘Z-Schritt liegen. */
  function _pushUndoMit(label, vorher) { if (_undo && vorher) _undo.push(label, { force: true, state: vorher }); }

  body.innerHTML = `
    <div class="panel gpxi-side">
        <div class="gpxi-empty" id="gpxi-empty">${t("gpxinspect.empty", "Lade ein GPX über die Leiste oben — dann erscheint hier jeder einzelne Track-Punkt.")}</div>
        <div class="gpxi-panel" id="gpxi-panel" hidden>
          <div class="gpxi-stat" id="gpxi-stat"></div>
          <div class="gpxi-statgrid" id="gpxi-statgrid"></div>
          <div class="gpxi-undorow">
            <button class="btn" id="gpxi-undo" disabled title="⌘Z">↩︎ ${t("gpxinspect.undo", "Rückgängig")}</button>
            <button class="btn" id="gpxi-redo" disabled title="⌘⇧Z">↪︎ ${t("gpxinspect.redo", "Wiederherstellen")}</button>
          </div>
          <!-- 10.09.2026 — Track-Check (docs/TRACK-CHECK.md): Befund-Kasten ganz oben.
               Häkchen je Befund (rot/gelb vorbelegt, grau nicht), „Reparieren" führt nur
               die angehakten Schritte aus (core/gpxheal), Vorher/Nachher wie beim Heilen. -->
          <div id="gpxi-heal-analysis" class="gpxi-analysis gpxi-tc" hidden></div>

          <details class="gpxi-sec" data-sec="pruefen">
            <summary class="gpxi-mm-title">🔍 ${t("gpxinspect.sec_pruefen", "Anschauen & prüfen")}<span class="gpxi-q" data-tip="${t("gpxinspect.sec_pruefen_help", "Erst gucken, dann anfassen: Tempo-Färbung zeigt Ausreißer, die Runden-Tabelle die Zwischenzeiten. Hier wird nichts verändert.")}">?</span></summary>
            <div class="gpxi-sec-body">
          <label class="gpxi-check" id="gpxi-speedcolor-row"><input type="checkbox" id="gpxi-speedcolor">
            🌡️ ${t("gpxinspect.speedcolor", "Nach Tempo einfärben")}<span class="gpxi-q" data-tip="${t("gpxinspect.speedcolor_help", "Färbt den Track nach Geschwindigkeit zwischen den Punkten: grün = normal, gelb = zügig, orange = sehr schnell, rot = Ausreißer-verdächtig. So springen GPS-Sprünge sofort ins Auge — dann Heilen oder den Abschnitt manuell glätten. Braucht Zeitstempel.")}">?</span></label>
          <div class="gpxi-speedlegend" id="gpxi-speedlegend" hidden></div>
          <div class="gpxi-fillrow" id="gpxi-speedthr-row" hidden>
            <label>${t("gpxinspect.speedthr", "Rot ab")}<span class="gpxi-q" data-tip="${t("gpxinspect.speedthr_help", "Ab welchem Tempo ein Stück als Ausreißer gilt (rot). Leer = automatisch aus dieser Tour selbst (grün bis zum üblichen Tempo, rot erst deutlich darüber) — das passt für Wandern wie für Autofahrten. Trägst du eine Zahl ein, gilt sie fest: grün bis zu einem Drittel, gelb bis zwei Dritteln, orange bis zur Schwelle, rot darüber.")}">?</span></label>
            <input type="number" id="gpxi-speed-thr" min="1" max="500" step="1" placeholder="${t("gpxinspect.tempo_cap_auto", "auto")}"> km/h
          </div>
          <div class="gpxi-fillrow">
            <label>${t("gpxinspect.wz_splits", "Runde je")}</label>
            <input type="number" id="gpxi-wz-every" min="0.1" max="100" step="0.5" value="1"> km
          </div>
          <button class="btn gpxi-act" id="gpxi-wz-splits" title="${t("gpxinspect.wz_splits_tip", "Zwischenzeiten je Abschnitt: Strecke, Dauer, Tempo, Höhenmeter. Zum Kopieren als Tabelle.")}">📊 ${t("gpxinspect.wz_splits_run", "Runden-Tabelle")}</button>
          <div class="gpxi-stat-help">${t("gpxinspect.points_help_short", "Was ein Punkt ist")}<span class="gpxi-q" data-tip="${t("gpxinspect.points_help", "Ein Track besteht aus vielen einzelnen Messpunkten — jedes Mal, wenn dein Gerät die Position aufgezeichnet hat. Ein Punkt alle 1–10 Sekunden ist üblich; bei einer langen Tour kommen so schnell mehrere tausend zusammen. Auf der Karte ist jeder Punkt ein kleiner Kreis, den du anklicken kannst. Mehr Punkte heißt nicht besser: Beim Heilen werden Ausreißer entfernt und Lücken aufgefüllt, dabei ändert sich die Zahl.")}">?</span></div>
            </div>
          </details>
          <details class="gpxi-sec" data-sec="heilen">
            <summary class="gpxi-mm-title">🩹 ${t("gpxinspect.heal_title", "Heilen (automatisch)")}<span class="gpxi-q" data-tip="${t("gpxinspect.heal_help", "Findet automatisch GPS-Ausreißer und Lücken und behebt sie. Bereich und Aktionen wählen, dann Heilen. Rückgängig jederzeit.")}">?</span></summary>
            <div class="gpxi-sec-body">
          <div class="gpxi-segrow" role="radiogroup">
            <label class="gpxi-seg"><input type="radio" name="gpxi-heal-scope" id="gpxi-scope-track" value="track" checked> ${t("gpxinspect.scope_track", "Ganzer Track")}</label>
            <label class="gpxi-seg"><input type="radio" name="gpxi-heal-scope" id="gpxi-scope-ab" value="ab"> ${t("gpxinspect.scope_ab", "Abschnitt A→B")}</label>
          </div>
          <label class="gpxi-check"><input type="checkbox" id="gpxi-heal-spikes" checked> ${t("gpxinspect.heal_opt_spikes", "Ausreißer/Sprünge glätten")}</label>
          <label class="gpxi-check"><input type="checkbox" id="gpxi-heal-gaps" checked> ${t("gpxinspect.heal_opt_gaps", "Lücken mit Punkten füllen")}</label>
          <label class="gpxi-check" id="gpxi-heal-tempo-row"><input type="checkbox" id="gpxi-heal-tempo" checked> ${t("gpxinspect.heal_opt_tempo", "Unmögliches Tempo entzerren (Zeit korrigieren)")}<span class="gpxi-q" data-tip="${t("gpxinspect.heal_opt_tempo_help", "Manche GPS-Sprünge sind ein dauerhafter Versatz: Der Track springt z. B. 40 m und bleibt dort — Position glätten kann das nicht heilen, denn die Strecke wurde ja zurückgelegt, nur die Zeitstempel behaupten „in 3 Sekunden“. Diese Option korrigiert die ZEIT solcher Stellen aufs übliche Tempo der Umgebung. Die Tour wird dadurch ein paar Sekunden länger; Strecke und Positionen bleiben unangetastet.")}">?</span></label>
          <div class="gpxi-fillrow" id="gpxi-tempocap-row">
            <label>${t("gpxinspect.tempo_cap", "Max. plausibles Tempo")}<span class="gpxi-q" data-tip="${t("gpxinspect.tempo_cap_help", "Leer = automatisch (aus dem Tempo-Median der Tour). Trage z. B. 15 ein, wenn du weißt, dass du nie schneller als 15 km/h warst — alles darüber wird beim Heilen zeitlich entzerrt.")}">?</span></label>
            <input type="number" id="gpxi-tempo-cap" min="1" max="500" step="1" placeholder="${t("gpxinspect.tempo_cap_auto", "auto")}"> km/h
          </div>
          <div class="gpxi-fillrow" id="gpxi-profilerow">
            <label>${t("gpxinspect.profile", "Lücken füllen als")}<span class="gpxi-q" data-tip="${t("gpxinspect.profile_help", "Luftlinie = gerade Linie zwischen den Punkten. Wandern/Fahrrad/Auto = die echte Route auf dem Wegenetz suchen (Mapbox, Internet + Token) und der Track folgt den Wegen. Plausibilitäts-Bremse: Wird der gefundene Weg länger als das 2,5-Fache der Luftlinie, ist er vermutlich ein Umweg über die falsche Kreuzung — dann wird die Lücke gerade gefüllt, und die Meldung sagt, wie oft das passiert ist. Sehr große Lücken (z. B. Flüge, über 300 km) bleiben immer gerade.")}">?</span></label>
            <select id="gpxi-profile">
              <option value="linear" selected>📏 ${t("gpxinspect.profile_linear", "Luftlinie (gerade)")}</option>
              <option value="walking">🚶 ${t("gpxinspect.mm_walking", "Zu Fuß / Wandern")}</option>
              <option value="cycling">🚴 ${t("gpxinspect.mm_cycling", "Fahrrad")}</option>
              <option value="driving">🚗 ${t("gpxinspect.mm_driving", "Auto")}</option>
            </select>
          </div>
          <div class="gpxi-hint-sm" id="gpxi-profil-hinweis" hidden></div>
          <div class="gpxi-fillrow gpxi-sensrow">
            <label>${t("gpxinspect.sens", "Empfindlichkeit")}<span class="gpxi-q" data-tip="${t("gpxinspect.sens_help", "Wie streng gesucht wird. Niedrig = nur krasse Ausreißer und große Lücken, hoch = auch kleine.")}">?</span></label>
            <input type="range" id="gpxi-sens" min="1" max="10" step="1" value="5">
            <span id="gpxi-sens-val" class="gpxi-sensval">5</span>
          </div>
          <div class="gpxi-fillrow">
            <label>${t("gpxinspect.spacing", "Abstand beim Füllen")}</label>
            <input type="number" id="gpxi-spacing" min="2" max="500" step="1" value="20"> m
          </div>
          <!-- Zu Anfang versteckt: Die Zeile gehört zum Bereich Abschnitt
               A nach B und wird von updateUI eingeblendet, sobald dieser
               gewählt ist (02.09.2026: "was bedeutet hier keine auswahl?"). -->
          <div class="gpxi-sel" id="gpxi-sel" hidden>${t("gpxinspect.sel_klick_a", "Klicke auf der Karte den Punkt A an, dann Punkt B — dazwischen wird geheilt.")}</div>
          <button class="btn btn-primary gpxi-act" id="gpxi-heal-run">🩹 ${t("gpxinspect.heal_run", "Heilen")}</button>
          <div class="gpxi-baft" id="gpxi-baft" hidden>
            <div class="gpxi-baft-head">✨ ${t("gpxinspect.baft_title", "Vorher → Nachher")}
              <button type="button" class="gpxi-baft-x" id="gpxi-baft-close" title="${t("common.close", "Schließen")}">✕</button></div>
            <div class="gpxi-baft-rows" id="gpxi-baft-rows"></div>
            <label class="gpxi-check"><input type="checkbox" id="gpxi-before-toggle" checked>
              ${t("gpxinspect.baft_show_before", "Vorher-Track auf der Karte zeigen (grau gestrichelt)")}</label>
          </div>
            </div>
          </details>
          <details class="gpxi-sec" data-sec="bearbeiten">
            <summary class="gpxi-mm-title">✏️ ${t("gpxinspect.sec_bearbeiten", "Bearbeiten (Anker A→B)")}<span class="gpxi-q" data-tip="${t("gpxinspect.manual_help", "Zwei Punkte auf der Karte klicken (A grün, B rot), dann eine Aktion für den Abschnitt dazwischen wählen — z. B. Punkte dazwischen löschen. Umkehren geht immer; Startpunkt und Teilen brauchen nur A.")}">?</span></summary>
            <div class="gpxi-sec-body">
          <div class="gpxi-sel gpxi-ab-status" id="gpxi-ab-status"></div>
          <div class="gpxi-sub">${t("gpxinspect.sub_ab", "Abschnitt zwischen A und B")}</div>
            <button class="btn gpxi-act" id="gpxi-heal" disabled
              title="${t("gpxinspect.heal_tip", "Die Punkte zwischen A und B auf die direkte Linie legen (Position + Höhe interpoliert). Zeitstempel bleiben → Geschwindigkeit wird wieder realistisch.")}">
              🩹 ${t("gpxinspect.heal", "Sprung glätten (A→B gerade)")}</button>
            <button class="btn gpxi-act" id="gpxi-fill" disabled
              title="${t("gpxinspect.fill_tip", "Zwischen A und B neue Punkte einfügen (Position, Höhe und Zeit interpoliert).")}">
              ➕ ${t("gpxinspect.fill", "Lücke füllen (Luftlinie)")}</button>
            <button class="btn gpxi-act" id="gpxi-match-sel" disabled
              title="${t("gpxinspect.match_sel_tip", "Findet die echte Straßen-/Wege-Route zwischen A und B (Wege-Profil oben). Robust gegen GPS-Drift.")}">
              🛣 ${t("gpxinspect.match_sel", "Strecke A→B (Straße folgen)")}</button>
            <button class="btn gpxi-act" id="gpxi-drawfill" disabled
              title="${t("gpxinspect.drawfill_tip", "Pfad zwischen A und B selbst auf der Karte zeichnen. Wird mit Position, Höhe und Zeit aufgefüllt.")}">
              ✏️ ${t("gpxinspect.drawfill", "Pfad zeichnen & füllen")}</button>
            <div class="gpxi-drawbox" id="gpxi-drawbox" hidden>
              <div class="gpxi-drawhint" id="gpxi-drawhint"></div>
              <button class="btn btn-primary gpxi-act" id="gpxi-draw-apply" disabled>✓ ${t("gpxinspect.draw_apply", "Pfad übernehmen")}</button>
              <button class="btn gpxi-act" id="gpxi-draw-undo" disabled>⤺ ${t("gpxinspect.draw_undo", "Letzten Punkt zurück")}</button>
              <button class="btn gpxi-act" id="gpxi-draw-cancel">✕ ${t("gpxinspect.draw_cancel", "Zeichnen abbrechen")}</button>
            </div>
            <button class="btn gpxi-act gpxi-del" id="gpxi-delete" disabled
              title="${t("gpxinspect.delete_tip", "Die Punkte zwischen A und B ganz entfernen (Schleifen/Abstecher rausschneiden). A und B bleiben, die Linie verbindet sie direkt.")}">
              ✂️ ${t("gpxinspect.delete", "Punkte zwischen A→B rausschneiden")}</button>
            <button class="btn gpxi-act" id="gpxi-ab-archiv" disabled
              title="${t("gpxinspect.ab_archiv_tip", "Den Abschnitt zwischen A und B als eigene, neue Tour ins Archiv legen — z. B. die Wanderung aus einer Datei, in der auch die Autofahrt steckt. Der Track hier bleibt unverändert.")}">
              📥 ${t("gpxinspect.ab_archiv", "Abschnitt A→B als neue Tour ins Archiv …")}</button>
          <div class="gpxi-sub">${t("gpxinspect.sub_a", "Am Punkt A")}</div>
            <button class="btn gpxi-act gpxi-del" id="gpxi-delete-one" disabled
              title="${t("gpxinspect.delete_one_tip", "Den ausgewählten Punkt (Anker A) entfernen. Geht auch mit Entf/Backspace.")}">
              🗑 ${t("gpxinspect.delete_one", "Diesen Punkt löschen")}</button>
            <button class="btn gpxi-act gpxi-del" id="gpxi-trim-before" disabled
              title="${t("gpxinspect.trim_before_tip", "Den Track-Anfang bis zu diesem Punkt entfernen — dieser Punkt wird der neue Start (z. B. Anfahrt oder Stillstand am Anfang wegschneiden).")}">
              ⏮ ${t("gpxinspect.trim_before", "Alles davor abschneiden")}</button>
            <button class="btn gpxi-act gpxi-del" id="gpxi-trim-after" disabled
              title="${t("gpxinspect.trim_after_tip", "Alles nach diesem Punkt entfernen — dieser Punkt wird das neue Ende (z. B. vergessenes Stoppen der Aufzeichnung am Tourende wegschneiden).")}">
              ⏭ ${t("gpxinspect.trim_after", "Alles danach abschneiden")}</button>
            <button class="btn gpxi-act" id="gpxi-wz-rotate" disabled title="${t("gpxinspect.wz_rotate_tip", "Bei einer Rundtour woanders anfangen: Anker A wird der neue Start, der alte Anfang hängt sich hinten an.")}">🚩 ${t("gpxinspect.wz_rotate", "Startpunkt hierher (Anker A)")}</button>
            <button class="btn gpxi-act" id="gpxi-wz-split" disabled title="${t("gpxinspect.wz_split_tip", "Den Track an Anker A in zwei Teile schneiden. Der Schnittpunkt gehört zu beiden Teilen.")}">✂ ${t("gpxinspect.wz_split", "Hier teilen (Anker A) …")}</button>
          <div class="gpxi-sub">${t("gpxinspect.sub_track", "Ganzer Track")}</div>
            <button class="btn gpxi-act" id="gpxi-wz-reverse" title="${t("gpxinspect.wz_reverse_tip", "Den Track rückwärts laufen lassen. Zeitstempel werden gespiegelt (Start bleibt der Start), sonst liefe die Uhr rückwärts.")}">🔁 ${t("gpxinspect.wz_reverse", "Umkehren")}</button>
            <button class="btn gpxi-clear" id="gpxi-clearsel" disabled>${t("gpxinspect.clear_sel", "Auswahl aufheben")}</button>
            </div>
          </details>
          <details class="gpxi-sec" data-sec="punkte">
            <summary class="gpxi-mm-title">📉 ${t("gpxinspect.sec_punkte", "Punkte & Zeiten")}<span class="gpxi-q" data-tip="${t("gpxinspect.sec_punkte_help", "Punktzahl verkleinern (gleichmäßig nach Strecke oder nach Abweichung von der Linie) und die Zeitstempel umschreiben: Zeitachse für Routen ohne Uhr, Zeiten verschieben, Startzeit oder Gesamtdauer setzen. Alles landet erst beim Speichern in einer Datei.")}">?</span></summary>
            <div class="gpxi-sec-body">
          <div id="gpxi-toolbox">
            <label class="field-label gpxi-reduce-lbl" style="margin-top:2px">
              <span>${t("gpxinspect.reduce_label", "Punkte reduzieren auf")}</span>
              <b id="gpxi-reduce-v">—</b></label>
            <input type="range" id="gpxi-reduce-n" min="2" max="100" step="1" value="100" style="width:100%">
            <div class="gpxi-fillrow" style="margin-top:4px">
              <button class="btn btn-sm" id="gpxi-reduce-run">${t("gpxinspect.reduce_run", "Reduzieren")}</button>
              <span class="gpxi-hint-sm" id="gpxi-reduce-hint"></span>
            </div>
            <!-- 01.09.2026 (Marc: „wir haben doch son Geschwindigkeitsheiler,
                 damit können wir das meiste davon schon machen") — stimmt: bei
                 AUFGEZEICHNETEN Tracks repariert „Unmögliches Tempo entzerren"
                 die Zeiten gezielt und behält den echten Rhythmus. Bleibt genau
                 eine Lücke: Tracks OHNE jede Uhrzeit (geplante Routen) — dort
                 steigt der Heiler sofort aus. Deshalb ist diese Zeile nur
                 noch bei zeitlosen Tracks sichtbar. -->
            <div id="gpxi-speedrow" hidden style="margin-top:8px; padding-top:8px; border-top:1px dashed var(--border);">
              <div class="ov-style-title" style="font-size:12px">🕐 ${t("gpxinspect.speed_title", "Zeitachse erzeugen")}
                <span class="gpxi-q" data-tip="${t("gpxinspect.speed_help", "Fuer geplante Routen ohne Uhrzeit.")}">?</span>
              </div>
              <div class="gpxi-fillrow" style="margin-top:4px">
                <span>${t("gpxinspect.speed_label", "Ø-Tempo")}</span>
                <input type="number" id="gpxi-speed-v" min="0.5" max="300" step="0.5" placeholder="12"> km/h
                <button class="btn btn-sm" id="gpxi-speed-run">${t("gpxinspect.speed_run", "Anwenden")}</button>
              </div>
            </div>
            <div class="gpxi-sel" id="gpxi-tools-info"></div>
          </div>
          <div class="gpxi-fillrow">
            <label>${t("gpxinspect.wz_tol", "Ausdünnen ab Abweichung")}</label>
            <input type="number" id="gpxi-wz-tol" min="0.5" max="200" step="0.5" value="5"> m
          </div>
          <button class="btn gpxi-act" id="gpxi-wz-simplify" title="${t("gpxinspect.wz_simplify_tip", "Douglas-Peucker: entfernt Punkte, die weniger als diesen Abstand von der Linie abweichen. Start und Ziel bleiben immer.")}">📉 ${t("gpxinspect.wz_simplify", "Ausdünnen (Abweichung)")}</button>
          <div class="gpxi-fillrow">
            <label>${t("gpxinspect.wz_retime", "Zeiten")}</label>
            <select id="gpxi-wz-retime-mode">
              <option value="shift" selected>${t("gpxinspect.wz_retime_shift", "verschieben um")}</option>
              <option value="start">${t("gpxinspect.wz_retime_start", "Start setzen auf")}</option>
              <option value="duration">${t("gpxinspect.wz_retime_duration", "Dauer setzen auf")}</option>
            </select>
          </div>
          <div class="gpxi-fillrow" id="gpxi-wz-retime-row-shift">
            <label>${t("gpxinspect.wz_retime_shift_lbl", "Versatz")}</label>
            <input type="number" id="gpxi-wz-shift" step="60" value="3600"> s
          </div>
          <div class="gpxi-fillrow" id="gpxi-wz-retime-row-start" hidden>
            <label>${t("gpxinspect.wz_retime_start_lbl", "Startzeit")}</label>
            <input type="datetime-local" id="gpxi-wz-start">
          </div>
          <div class="gpxi-fillrow" id="gpxi-wz-retime-row-duration" hidden>
            <label>${t("gpxinspect.wz_retime_duration_lbl", "Dauer")}</label>
            <input type="number" id="gpxi-wz-duration" min="1" step="1" value="60"> min
          </div>
          <button class="btn gpxi-act" id="gpxi-wz-retime-run" title="${t("gpxinspect.wz_retime_tip", "Alle Zeitstempel verschieben (Zeitzone, vergessene Sommerzeit, Kamera-Abgleich), auf eine Startzeit legen oder auf eine Gesamtdauer stauchen/strecken. Ohne Uhr: erst oben „Zeitachse erzeugen“.")}">⏱ ${t("gpxinspect.wz_retime_run", "Zeiten anwenden")}</button>
          <div class="gpxi-note muted" id="gpxi-wz-note"></div>
            </div>
          </details>
          <details class="gpxi-sec" data-sec="verbinden">
            <summary class="gpxi-mm-title">🔗 ${t("gpxinspect.join_title", "Tracks verbinden")}<span class="gpxi-q" data-tip="${t("gpxinspect.join_help", "Hängt eine weitere Aufzeichnung an diesen Track — z. B. wenn die Uhr mittendrin gestoppt hat oder eine Mehrtagestour als eine Datei pro Tag vorliegt. Sensordaten (Puls, Leistung …) bleiben pro Abschnitt erhalten.")}">?</span></summary>
            <div class="gpxi-sec-body">
          <div class="gpxi-fillrow">
            <label>${t("gpxinspect.join_where", "Einfügen")}</label>
            <select id="gpxi-join-mode">
              <option value="append" selected>${t("gpxinspect.join_append", "am Ende")}</option>
              <option value="prepend">${t("gpxinspect.join_prepend", "am Anfang")}</option>
              <option value="time">${t("gpxinspect.join_time", "nach Uhrzeit")}</option>
            </select>
          </div>
          <div class="gpxi-fillrow">
            <label>${t("gpxinspect.join_pause", "Pause dazwischen")}</label>
            <input type="number" id="gpxi-join-pause" min="0" max="86400" step="30" value="0"> s
          </div>
          <button class="btn gpxi-act" id="gpxi-join" disabled>➕ ${t("gpxinspect.join_run", "Weiteren Track anhängen …")}</button>
          <div class="gpxi-note muted" id="gpxi-join-note"></div>
            </div>
          </details>
          <details class="gpxi-sec" data-sec="hoehe">
            <summary class="gpxi-mm-title">⛰ ${t("gpxinspect.ele_title", "Höhe korrigieren")}<span class="gpxi-q" data-tip="${t("gpxinspect.ele_help", "GPS-Höhe ist verrauscht. Lädt das Höhenprofil aus der Karte; darunter mischst du GPS und Karte mit dem Regler. Braucht Mapbox-Token + Internet.")}">?</span></summary>
            <div class="gpxi-sec-body">
          <button class="btn gpxi-act" id="gpxi-ele-load">🗺 ${t("gpxinspect.ele_load", "Höhenprofil aus Karte laden")}</button>
          <div class="gpxi-fillrow gpxi-sensrow">
            <label>${t("gpxinspect.ele_weight", "GPS ⟷ Karte")}</label>
            <input type="range" id="gpxi-ele-weight" min="0" max="100" step="5" value="70" disabled>
            <span id="gpxi-ele-weight-val" class="gpxi-sensval">70 %</span>
          </div>
          <button class="btn btn-primary gpxi-act" id="gpxi-ele-apply" disabled>⛰ ${t("gpxinspect.ele_apply", "Diese Höhe übernehmen")}</button>
          <div class="gpxi-note muted" id="gpxi-ele-result"></div>
            </div>
          </details>
          <div class="gpxi-foot">
          <button class="btn btn-primary" id="gpxi-save" disabled>💾 ${t("gpxinspect.save", "Geheilten Track speichern …")}</button>
          <button class="btn gpxi-reset" id="gpxi-reset" disabled>↩︎ ${t("gpxinspect.reset", "Änderungen verwerfen")}</button>
          <div class="gpxi-note muted" id="gpxi-note"></div>
          </div>
        </div>
    </div>
    <section class="canvas" id="gpxi-canvaswrap">
      <div id="gpxi-canvas"></div>
      <div id="gpxi-hoverbox" class="gpxi-hoverbox gpxi-pinfo" hidden></div>
      <div id="gpxi-ele-profile" class="gpxi-eleprof" hidden>
        <div class="gpxi-eleprof-head">
          <span class="gpxi-eleprof-title">⛰ ${t("gpxinspect.ele_profile_title", "Höhenprofil")}</span>
          <span class="gpxi-eleleg"><i class="gpxi-sw gpxi-sw-gps"></i>${t("gpxinspect.ele_leg_gps", "GPS (Original)")}</span>
          <span class="gpxi-eleleg"><i class="gpxi-sw gpxi-sw-dem"></i>${t("gpxinspect.ele_leg_map", "Karte (Mapbox)")}</span>
          <span class="gpxi-eleleg"><i class="gpxi-sw gpxi-sw-res"></i>${t("gpxinspect.ele_leg_res", "Ergebnis")}</span>
          <span class="gpxi-eleprof-info" id="gpxi-eleprof-info"></span>
        </div>
        <svg class="gpxi-eleprof-svg" id="gpxi-eleprof-svg" viewBox="0 0 1000 150" preserveAspectRatio="none" aria-hidden="true"></svg>
      </div>
      <!-- 13.09.2026 — Logbuch der Tour (docs/LOGBUCH.md §68): Zeitstrahl unten über die
           ganze Breite, rechts das mitlaufende Logbuch (Q6). Entsteht beim Öffnen (Q4). -->
      <div id="gpxi-logbuch" class="gpxi-lb" hidden>
        <div class="gpxi-lb-kopf">
          <span class="gpxi-lb-titel">📖 ${t("logbuch.titel", "Logbuch")}<span class="gpxi-q" data-tip="${t("logbuch.help", "Was wann war: Fahrten, Fähren, Wanderungen, Pausen und der höchste Punkt — automatisch aus dem Track erkannt. Klick auf einen Eintrag hebt den Abschnitt auf der Karte hervor, Klick auf den Track wählt den Eintrag. Doppelklick auf einen Tag zieht ihn im Zeitstrahl auf, Mausrad zoomt. Esc hebt die Auswahl auf.")}">?</span></span>
          <span class="gpxi-lb-summe" id="gpxi-lb-summe"></span>
          <span class="gpxi-lb-hinweis" id="gpxi-lb-hinweis" hidden></span>
          <span class="gpxi-lb-werk">
          <label class="gpxi-lb-schalter" title="${t("logbuch.alles_zeigen_help", "Auch kurze Halte und die rohen Bereiche der Erkennung zeigen.")}"><input type="checkbox" id="gpxi-lb-alles"> ${t("logbuch.alles_zeigen", "alles zeigen")}</label>
          <button type="button" class="gpxi-lb-knopf" id="gpxi-lb-reise" hidden title="${t("logbuch.reise_tip", "Wieder die ganze Tour zeigen")}">⤢ ${t("logbuch.reise", "Ganze Tour")}</button>
          <label class="gpxi-lb-schalter" title="${t("logbuch.pois_tip", "Sehenswürdigkeiten am Weg als eigene Spur zeigen")}"><input type="checkbox" id="gpxi-lb-pois" checked> POIs</label>
          <label class="gpxi-lb-schalter" title="${t("logbuch.eigene_tip", "Eigene Spuren (z. B. „mit den Kindern“) zeigen — anlegen über ＋ A→B")}"><input type="checkbox" id="gpxi-lb-eigene"> ${t("logbuch.spur_eigene", "Eigene")}</label>
          <label class="gpxi-lb-schalter" title="${t("logbuch.befunde_tip", "Fundstellen des Track-Checks als Spur; Klick springt hin")}"><input type="checkbox" id="gpxi-lb-befunde" checked> ${t("logbuch.spur_befunde", "Befunde")}</label>
          <button type="button" class="gpxi-lb-knopf" id="gpxi-lb-fenster-auf" title="${t("logbuch.fenster.auf", "Als großes Fenster mit Tabelle öffnen")}">⤢</button>
          <button type="button" class="gpxi-lb-knopf" id="gpxi-lb-ab" disabled title="${t("logbuch.knopf.ab_tip", "Aus dem Abschnitt zwischen Anker A und B einen eigenen Eintrag machen")}">＋ A→B</button>
          <button type="button" class="gpxi-lb-knopf" id="gpxi-lb-punkt" disabled title="${t("logbuch.knopf.punkt_tip", "Eigenen Punkt setzen: danach auf die Karte klicken")}">📍 ${t("logbuch.knopf.punkt", "Punkt")}</button>
          <button type="button" class="gpxi-lb-knopf" id="gpxi-lb-einst" disabled title="${t("logbuch.einst.titel", "Logbuch-Einstellungen")}">⚙</button>
          <button type="button" class="gpxi-lb-knopf" id="gpxi-lb-neu" title="${t("logbuch.neu_tip", "Logbuch aus dem Track neu erkennen")}">↻</button>
          <button type="button" class="gpxi-lb-knopf" id="gpxi-lb-zu" title="${t("logbuch.zu", "Logbuch einklappen")}">▾</button>
          </span>
        </div>
        <div class="gpxi-lb-koerper" id="gpxi-lb-koerper" hidden>
          <div class="gpxi-lb-strahl" id="gpxi-lb-strahl">
            <div class="gpxi-lb-spuren" id="gpxi-lb-spuren-el"></div>
            <div class="gpxi-lb-svgbox" id="gpxi-lb-svgbox">
              <svg id="gpxi-lb-svg" class="gpxi-lb-svg" aria-hidden="true"></svg>
              <div class="gpxi-lb-cursor" id="gpxi-lb-cursor" hidden><span></span></div>
            </div>
          </div>
          <div class="gpxi-lb-liste" id="gpxi-lb-liste"></div>
        </div>
      </div>
    </section>
  `;

  // ── Map ──────────────────────────────────────────────────────────────────
  whenApiReady().then(async () => {
    if (isUnmounted) return;
    let made;
    try {
      // 03.09.2026 — gemeinsame Stilliste; Gelände des Stils gleich mit
      // (queryTerrainElevation für die Höhenkorrektur braucht eine DEM-Quelle).
      made = createMap({
        container: "gpxi-canvas",
        styleKey: (_settingsCache && _settingsCache.gpxinspect && _settingsCache.gpxinspect.map_style) || mapDefaultStyle(),
        bbox: (typeof _bboxLonLat === "function") ? _bboxLonLat() : null,
        terrain: true, exaggeration: 1.0,
        common: { center: [10, 51], zoom: 4 },
      });
    } catch (e) {
      applog && applog("error", "[gpxinspect] createMap warf: " + e);
      return;
    }
    map = made.map;
    _maplib = made.lib;   // v0.9.293 — für Punkt-Info-Popup
    try { map.addControl(new made.lib.NavigationControl(), "top-right"); } catch (_) {}
    onMapReady(map, () => {
      if (isUnmounted) return;
      // Falls die Karte bei 0-Größe erzeugt wurde (Layout noch nicht fertig):
      try { map.resize(); } catch (_) {}
      const emptyLine = { type: "Feature", geometry: { type: "LineString", coordinates: [] } };
      const emptyFC = { type: "FeatureCollection", features: [] };
      try {
        // 29.08.2026 (Marc: „nach 'auto heilen' direkt ein vorher nachher") —
        // der Stand VOR dem Heilen bleibt als graue gestrichelte Linie sichtbar.
        map.addSource("gpxi-before", { type: "geojson", data: emptyLine });
        map.addLayer({ id: "gpxi-before-lyr", type: "line", source: "gpxi-before",
          paint: { "line-color": "#9aa0a8", "line-width": 2, "line-dasharray": [2, 1.6], "line-opacity": 0.8 } });
        map.addSource("gpxi-line", { type: "geojson", data: emptyLine });
        map.addLayer({ id: "gpxi-line-lyr", type: "line", source: "gpxi-line",
          paint: { "line-color": "#3aa0ff", "line-width": 2.4, "line-opacity": 0.85 } });
        // v0.9.294 — Lücken-Heil-Vorschau (andersfarbig): gestrichelte Füll-Linie + Geister-Punkte.
        // 29.08.2026 (Marc: „nach tempo einfärben lassen, damit ich die
        // ausreiser sehe") — Segment-Färbung nach km/h, liegt ÜBER der Linie.
        map.addSource("gpxi-speed", { type: "geojson", data: emptyFC });
        map.addLayer({ id: "gpxi-speed-lyr", type: "line", source: "gpxi-speed",
          layout: { "line-cap": "round" },
          paint: { "line-color": ["get", "color"], "line-width": 3.2, "line-opacity": 0.95 } });
        map.addSource("gpxi-gapfill", { type: "geojson", data: emptyLine });
        map.addLayer({ id: "gpxi-gapfill-lyr", type: "line", source: "gpxi-gapfill",
          paint: { "line-color": "#e879f9", "line-width": 3, "line-dasharray": [1.5, 1.2], "line-opacity": 0.95 } });
        map.addSource("gpxi-gapfill-pts", { type: "geojson", data: emptyFC });
        map.addLayer({ id: "gpxi-gapfill-pts-lyr", type: "circle", source: "gpxi-gapfill-pts", paint: {
          "circle-radius": 3, "circle-color": "#e879f9", "circle-opacity": 0.55,
          "circle-stroke-width": 1, "circle-stroke-color": "#86198f",
        } });
        // 01.09.2026 (Marc: „sieht man live, wie sich der track verändert?") —
        // Vorschau der reduzierten Linie beim Schieben des Reglers. MUSS über
        // Track-Linie und Tempo-Färbung liegen, sonst ist sie unsichtbar.
        map.addSource("gpxi-redprev", { type: "geojson", data: emptyLine });
        map.addLayer({ id: "gpxi-redprev-lyr", type: "line", source: "gpxi-redprev",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#ff6b35", "line-width": 3.4, "line-opacity": 1 } });
        map.addSource("gpxi-redprev-pts", { type: "geojson", data: emptyFC });
        map.addLayer({ id: "gpxi-redprev-pts-lyr", type: "circle", source: "gpxi-redprev-pts",
          paint: { "circle-radius": 3.4, "circle-color": "#ff6b35",
                   "circle-stroke-width": 1, "circle-stroke-color": "#ffffff" } });
        map.addSource("gpxi-pts", { type: "geojson", data: emptyFC });
        map.addLayer({ id: "gpxi-pts-lyr", type: "circle", source: "gpxi-pts", paint: {
          // Zoom-Interpolate MUSS oben stehen (Mapbox erlaubt kein zoom-interpolate
          // innerhalb eines case) — die Spike-Vergrößerung steckt im Output pro Stop.
          "circle-radius": ["interpolate", ["linear"], ["zoom"],
            9,  ["case", ["boolean", ["get", "fund"], false], 6, ["boolean", ["get", "spike"], false], 4,  2.2],
            14, ["case", ["boolean", ["get", "fund"], false], 10, ["boolean", ["get", "spike"], false], 7,  4.5],
            18, ["case", ["boolean", ["get", "fund"], false], 14, ["boolean", ["get", "spike"], false], 10, 7]],
          "circle-color": ["case",
            ["==", ["get", "sel"], "a"], "#22c55e",
            ["==", ["get", "sel"], "b"], "#ef4444",
            // 12.09.2026 (Marc: „im inspektor muss klar gekennzeichnet werden, was er
            // als fehler erkennt"): die Fundstellen des Track-Checks in Magenta —
            // bewusst eine Farbe, die sonst nirgends vorkommt.
            ["boolean", ["get", "fund"], false], "#e11d9c",
            ["boolean", ["get", "spike"], false], "#f59e0b",
            // 29.08.2026 — Tempo-Einfärbung: bei 2 788 dichten Punkten sieht
            // man die Kreise, nicht die Linie darunter — also färben BEIDE.
            ["coalesce", ["get", "sc"], "#cfe6ff"]],
          "circle-stroke-width": ["case",
            ["boolean", ["get", "fund"], false], 2.6,
            ["boolean", ["get", "spike"], false], 2.4,
            ["boolean", ["get", "anchor"], false], 2.2, 0.6],
          "circle-stroke-color": ["case",
            ["==", ["get", "sel"], "a"], "#0a7a32",
            ["==", ["get", "sel"], "b"], "#a11",
            ["boolean", ["get", "fund"], false], "#ffffff",
            ["boolean", ["get", "spike"], false], "#7c4a02",
            // 29.08.2026 — Tempo-Einfärbung: Rand folgt der Füllfarbe, sonst
            // übertönt das Standard-Blau die winzigen Kreise komplett.
            ["coalesce", ["get", "sc"], "#1f6fc4"]],
        } });
        // 02.09.2026 (Marc: „ich bin die gleiche Strecke vor und zurück
        // gelaufen und kann überhaupt nicht erkennen, in welcher Richtung der
        // Track an der Stelle läuft, wo ich gucke"): Dieselben Punkte, nur als
        // kleine Richtungspfeile. Eigene Ebene über DERSELBEN Quelle — Klicks,
        // Anker, Ausreißer-Hervorhebung und Tempo-Färbung gelten unverändert.
        // Das Bild ist ein SDF, damit `icon-color` je Punkt greift; sonst
        // müsste je Farbe ein eigenes Bild in den Atlas.
        try {
          if (!map.hasImage("gpxi-arrow")) {
            map.addImage("gpxi-arrow", _pfeilBildSdf(), { pixelRatio: 2, sdf: true });
          }
        } catch (_) {}
        map.addLayer({ id: "gpxi-pts-arrow", type: "symbol", source: "gpxi-pts",
          layout: {
            "icon-image": "gpxi-arrow",
            "icon-rotate": ["get", "brg"],
            "icon-rotation-alignment": "map",
            "icon-allow-overlap": true, "icon-ignore-placement": true,
            "icon-size": ["interpolate", ["linear"], ["zoom"],
              9, ["case", ["boolean", ["get", "spike"], false], 0.30, 0.20],
              14, ["case", ["boolean", ["get", "spike"], false], 0.55, 0.38],
              18, ["case", ["boolean", ["get", "spike"], false], 0.80, 0.60]],
          },
          paint: {
            "icon-color": ["case",
              ["==", ["get", "sel"], "a"], "#22c55e",
              ["==", ["get", "sel"], "b"], "#ef4444",
              ["boolean", ["get", "spike"], false], "#f59e0b",
              ["coalesce", ["get", "sc"], "#cfe6ff"]],
            "icon-halo-color": "#0b1220",
            "icon-halo-width": 1.1,
          } });
        // v0.9.237 — Pfad-Zeichnen: Preview-Linie A→Stützpunkte→B + Stützpunkt-Marker.
        map.addSource("gpxi-draw", { type: "geojson", data: emptyLine });
        map.addLayer({ id: "gpxi-draw-lyr", type: "line", source: "gpxi-draw",
          paint: { "line-color": "#ff9f1c", "line-width": 2.6, "line-dasharray": [2, 1.4], "line-opacity": 0.95 } });
        map.addSource("gpxi-draw-pts", { type: "geojson", data: emptyFC });
        map.addLayer({ id: "gpxi-draw-pts-lyr", type: "circle", source: "gpxi-draw-pts", paint: {
          "circle-radius": 5.5, "circle-color": "#ff9f1c",
          "circle-stroke-width": 2, "circle-stroke-color": "#fff",
        } });
        // v0.9.294 — Hover-Marker (verknüpft mit dem Höhenprofil-Cursor).
        map.addSource("gpxi-hover", { type: "geojson", data: emptyFC });
        map.addLayer({ id: "gpxi-hover-lyr", type: "circle", source: "gpxi-hover", paint: {
          "circle-radius": 7, "circle-color": "rgba(255,255,255,0.0)",
          "circle-stroke-width": 3, "circle-stroke-color": "#ffffff",
        } });
        // 13.09.2026 — Logbuch (§68 Q16): der gewählte Eintrag leuchtet auf dem Track —
        // heller Saum plus Linie in der Farbe der Art; ein Punkt-Eintrag als Ring.
        map.addSource("gpxi-lb-hl", { type: "geojson", data: emptyFC });
        map.addLayer({ id: "gpxi-lb-hl-saum", type: "line", source: "gpxi-lb-hl", filter: ["==", ["get", "pt"], false],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#ffffff", "line-width": 11, "line-opacity": 0.85 } }, "gpxi-pts-lyr");
        map.addLayer({ id: "gpxi-lb-hl-lyr", type: "line", source: "gpxi-lb-hl", filter: ["==", ["get", "pt"], false],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": ["coalesce", ["get", "c"], "#ff6b35"], "line-width": 6, "line-opacity": 1 } }, "gpxi-pts-lyr");
        map.addLayer({ id: "gpxi-lb-hl-pt", type: "circle", source: "gpxi-lb-hl", filter: ["==", ["get", "pt"], true],
          paint: { "circle-radius": 11, "circle-color": ["coalesce", ["get", "c"], "#c084fc"], "circle-opacity": 0.35,
                   "circle-stroke-width": 3, "circle-stroke-color": ["coalesce", ["get", "c"], "#c084fc"] } });
      } catch (e) { applog && applog("warn", "[gpxinspect] layer add: " + e); }
      // v0.9.291 — Terrain-DEM für die Höhenkorrektur (queryTerrainElevation).
      // 03.09.2026: hängt createMap() aus dem Stil an (Mapbox-DEM / MapTiler /
      // AWS terrarium) — für jede Quelle, nicht mehr nur mit Mapbox-Token.
      try {
        const cv = document.getElementById("gpxi-canvas");
        if (cv && cv.parentElement && typeof attachMapStyleControl === "function") {
          attachMapStyleControl(cv.parentElement, {
            section: "gpxinspect", terrain: true,
            getMap: () => map, getBbox: () => (typeof _bboxLonLat === "function" ? _bboxLonLat() : null),
          });
        }
      } catch (_) {}
      // v0.9.294 — tolerante Klicks: nächster Punkt im Pixel-Radius (statt layer-gebunden).
      map.on("click", onMapClick);
      try { _lbKarteVerdrahten(); } catch (e) { applog && applog("warn", "[logbuch] Karte: " + e); }
      map.on("dblclick", onMapDbl);   // Doppelklick = Anker setzen
      // v0.9.293 — Karte bewegt/zoomt → Höhenprofil auf den sichtbaren Abschnitt syncen.
      map.on("moveend", onMapMoveSyncProfile);
      // v0.9.294 — Maus über der Karte → Position im Höhenprofil zeigen (verknüpfter Cursor).
      map.on("mousemove", onMapHover);
      map.on("mouseout", () => setHover(null));
      // Ausgewählten Punkt (Anker A, Einzel-Auswahl) per Drag verschieben (v0.9.243).
      // 02.09.2026: Punkte werden als Pfeile gezeichnet — Klick, Ziehen und
      // Zeiger müssen auf BEIDEN Ebenen hängen, sonst sind die Punkte
      // unanklickbar, sobald die Pfeile sichtbar sind.
      map.on("mousedown", "gpxi-pts-lyr", onPointMouseDown);
      map.on("mousedown", "gpxi-pts-arrow", onPointMouseDown);
      map.on("mousemove", onDragMove);
      map.on("mouseup", onDragEnd);
      map.on("mouseenter", "gpxi-pts-arrow", (e) => {
        try { map.getCanvas().style.cursor = "pointer"; } catch (_) {}
      });
      map.on("mouseleave", "gpxi-pts-arrow", () => {
        try { map.getCanvas().style.cursor = ""; } catch (_) {}
      });
      map.on("mouseenter", "gpxi-pts-lyr", (e) => {
        if (_drawMode) { _setCursor("crosshair"); return; }   // Zeichnen-Modus: Fadenkreuz behalten
        const f = e.features && e.features[0];
        const grab = f && _selB === null && f.properties.i === _selA;
        _setCursor(grab ? "grab" : "pointer");
      });
      map.on("mouseleave", "gpxi-pts-lyr", () => {
        if (_drawMode) { _setCursor("crosshair"); return; }
        if (!_dragging) _setCursor("");
      });
      // Schon ein globales GPX geladen?
      const cur = (typeof getGlobalGpxPath === "function") ? getGlobalGpxPath() : null;
      // 13.09.2026 — nur laden, wenn dieser Track nicht schon offen ist oder gerade lädt.
      // Wurde die Karte erst NACH dem Laden fertig (langsamer Rechner, Software-GL), lud
      // sie den Track ein zweites Mal und warf alles weg, was inzwischen bearbeitet war
      // (gefunden am Wächter „Umkehren").
      if (cur && cur !== _origPath && cur !== _ladePfad) loadTrack(cur);
      else if (cur) { try { renderAll(); updateUI(); } catch (_) {} }
      // Nachträgliches Resize, falls das Layout erst nach onMapReady steht.
      setTimeout(() => { if (!isUnmounted && map) { try { map.resize(); } catch (_) {} } }, 350);
    });
  });

  if (typeof onGpxLoaded === "function") {
    window.__rzGpxUnsub_insp = onGpxLoaded(({ path }) => {
      if (isUnmounted) return;
      if (path) loadTrack(path); else clearTrack();
    });
  }

  // ── Laden / Anzeige ────────────────────────────────────────────────────────
  let _ladePfad = null;   // 13.09.2026 — Track, der gerade geladen wird (gegen Doppel-Laden)
  async function loadTrack(path) {
    let res;
    _ladePfad = path;
    try { res = await rzWarten("gpxinspect_load", () => api().gpxinspect_load(path)); } catch (e) { res = { ok: false, error: String(e) }; }
    finally { if (_ladePfad === path) _ladePfad = null; }
    if (isUnmounted) return;
    if (!res || !res.ok) {
      if (window.isMissingFileError && window.isMissingFileError(res && res.error)) window.showSourceMissingBanner(path);
      else toast((res && res.error) || t("error.gpx_generic", "GPX-Fehler"), "error", 5000);
      return;
    }
    if (window.hideSourceMissingBanner) window.hideSourceMissingBanner();
    // oi = Original-Index → beim Speichern behalten geheilte/unveränderte Punkte ihre
    // FIT/TCX-Sensorwerte (Herzfrequenz, Temperatur …). Eingefügte Punkte haben kein oi
    // (undefined) → Backend interpoliert deren Sensoren. v0.9.334 (Nutzer-Feedback).
    _points = (res.points || []).map(p => ({ lat: p.lat, lon: p.lon, ele: p.ele, time: p.time, oi: p.i, si: 0 }));
    { const n = document.getElementById("gpxi-wz-note"); if (n) n.textContent = ""; }   // 10.09.2026 — alter Hinweis weg
    try { analyseTrack(); } catch (_) {}
    _srcPath = res.src || path;   // v0.9.295 — konvertierter GPX-Pfad (Fremdformate), sonst Original
    _sources = [_srcPath];        // v0.9.456 — Quelle 0; „Track anhängen" hängt weitere an
    _origPath = path;             // v0.9.335 — Original-Datei (für Default-Speicherort beim „Speichern unter…")
    _hasTime = !!res.has_time; _hasEle = !!res.has_ele; _hasSensors = !!res.has_sensors;
    _localTimeN = res.local_time_n || 0;   // 10.09.2026 — Zeiten ohne Zeitzone (Track-Check, grau)
    _selA = _selB = null; _dirty = false;
    _drawMode = false; _drawPts = [];
    clearSpikes();
    _eleInvalidate();   // v0.9.292 — neues Track → altes Höhenprofil verwerfen
    if (_undo) _undo.reset();
    const _scRow = document.getElementById("gpxi-speedcolor-row");
    if (_scRow) _scRow.style.display = _hasTime ? "" : "none";   // ohne Zeit kein Tempo
    const _htRow = document.getElementById("gpxi-heal-tempo-row");
    if (_htRow) _htRow.style.display = _hasTime ? "" : "none";
    const _tcRow = document.getElementById("gpxi-tempocap-row");
    if (_tcRow) _tcRow.style.display = _hasTime ? "" : "none";
    // 01.09.2026: „Zeitachse erzeugen" NUR bei Tracks ohne Uhrzeit — sonst ist
    // es ein zweiter Knopf für etwas, das der Geschwindigkeitsheiler besser kann.
    const _spRow = document.getElementById("gpxi-speedrow");
    if (_spRow) _spRow.hidden = _hasTime;
    clearBeforeAfter();
    renderAll();
    try { renderDraw(); } catch (_) {}
    fitTrack(res.bbox);
    updateUI();
    // 01.09.2026 (Marc): Regler zeigt die ECHTE Punktzahl dieses Tracks.
    try { reduzierReglerSync(); } catch (_) {}
    // Richtungspfeile: Kurse einmal für diesen Track rechnen.
    try { _pfeileBerechnen(); _punktFormAnwenden(); renderPoints(); } catch (_) {}
    // Neuer Track → neue Schätzung; eine frühere Handauswahl gilt nicht weiter.
    _profilManuell = false;
    try { profilVorschlagen(); } catch (_) {}
    // 13.09.2026 — Logbuch (§68 Q4): entsteht automatisch beim Öffnen.
    _lbZeiten = null; _lbZeitSort = null;
    try { logbuchLaden(); } catch (e) { applog && applog("warn", "[logbuch] " + e); }
  }

  function clearTrack() {
    try {
      map.getSource("gpxi-redprev").setData({ type: "Feature", geometry: { type: "LineString", coordinates: [] } });
      map.getSource("gpxi-redprev-pts").setData({ type: "FeatureCollection", features: [] });
      if (map.getLayer("gpxi-pts-lyr")) { map.setPaintProperty("gpxi-pts-lyr", "circle-opacity", 1); map.setPaintProperty("gpxi-pts-lyr", "circle-stroke-opacity", 1); }
      if (map.getLayer("gpxi-pts-arrow")) map.setPaintProperty("gpxi-pts-arrow", "icon-opacity", 1);
      if (map.getLayer("gpxi-speed-lyr")) map.setPaintProperty("gpxi-speed-lyr", "line-opacity", 0.95);
      if (map.getLayer("gpxi-line-lyr")) map.setPaintProperty("gpxi-line-lyr", "line-opacity", 0.85);
    } catch (_) {}
    _points = []; _srcPath = null; _origPath = null; _sources = []; _selA = _selB = null; _dirty = false;
    try { logbuchLeeren(); } catch (_) {}
    try { if (map && map.getSource("gpxi-line")) map.getSource("gpxi-line").setData({ type: "Feature", geometry: { type: "LineString", coordinates: [] } }); } catch (_) {}
    try { if (map && map.getSource("gpxi-pts")) map.getSource("gpxi-pts").setData({ type: "FeatureCollection", features: [] }); } catch (_) {}
    _eleInvalidate();
    updateUI();
  }

  /* 29.08.2026 (Marc: „man sollte die kompletten stats im inspector sehen —
   * dann sieht man auch direkt, ob alles passt") — Kennzahlen LIVE aus den
   * aktuellen Punkten gerechnet (nicht aus der Datei): nach jedem Heilen oder
   * Editieren stimmen sie sofort. Bergauf/Bergab sind hier bewusst die rohen
   * Summen (das Archiv glättet stärker) — für Vorher/Nachher zählt, dass
   * beide Seiten gleich gerechnet sind. */
  function _trackStats() {
    let dist = 0, dur = 0, maxKmh = 0, asc = 0, desc = 0;
    for (let i = 1; i < _points.length; i++) {
      const a = _points[i - 1], b = _points[i];
      const d = _haversine(a, b);
      dist += d;
      if (a.time && b.time) {
        const dt = (Date.parse(b.time) - Date.parse(a.time)) / 1000;
        if (dt > 0) {
          dur += dt;
          const v = d / dt * 3.6;
          if (v > maxKmh) maxKmh = v;
        }
      }
    }
    // 02.09.2026, Audit: Hier stand die naive Summe (jeder positive
    // Höhenunterschied addiert). Bei GPS-Rauschen von ±5–10 m je Punkt ergab
    // das ein Vielfaches dessen, was das Archiv für dieselbe Tour zeigte.
    // Jetzt rechnet die ganze App mit `hoehenmeter()` aus util.js — der
    // JS-Fassung von core/gpx.py, samt Etappen-Trennung.
    const hm = hoehenmeter(_points);
    asc = hm.asc; desc = hm.desc;
    return { n: _points.length, dist, dur, maxKmh, asc, desc,
             avg: dur > 0 ? dist / dur * 3.6 : 0 };
  }
  function renderStatGrid() {
    const box = document.getElementById("gpxi-statgrid");
    if (!box) return;
    if (!_points.length) { box.innerHTML = ""; return; }
    const s = _trackStats();
    const z = (lab, val) => `<span class="gpxi-sg-l">${lab}</span><span class="gpxi-sg-v">${val}</span>`;
    box.innerHTML =
      z(t("gpxinspect.st_dist", "Strecke"), _fmtKm(s.dist))
      + (s.dur > 0 ? z(t("gpxinspect.st_dur", "Dauer"), _fmtDur(s.dur * 1000)) : "")
      + (s.dur > 0 ? z(t("gpxinspect.st_avg", "Ø Tempo"), s.avg.toFixed(1) + " km/h") : "")
      + (s.dur > 0 ? z(t("gpxinspect.st_max", "Max. Tempo"), s.maxKmh.toFixed(1) + " km/h") : "")
      + (s.asc || s.desc ? z(t("gpxinspect.st_hm", "Höhenmeter"), `↑ ${Math.round(s.asc)} · ↓ ${Math.round(s.desc)} m`) : "");
  }

  /* Vorher/Nachher nach dem Auto-Heilen: Kennzahlen-Vergleich + der alte
   * Track als graue gestrichelte Linie (eingefügte Punkte sind ohnehin
   * magenta). Undo/Redo oder ein neuer Track räumen den Vergleich ab. */
  let _beforeStats = null, _beforeCoords = null;
  function merkeVorher() {
    _beforeStats = _trackStats();
    _beforeCoords = _points.map(p => [p.lon, p.lat]);
  }
  function clearBeforeAfter() {
    _beforeStats = null; _beforeCoords = null;
    const box = document.getElementById("gpxi-baft");
    if (box) box.hidden = true;
    try { map.getSource("gpxi-before").setData({ type: "Feature", geometry: { type: "LineString", coordinates: [] } }); } catch (_) {}
  }
  function renderBeforeLine() {
    const an = !!document.getElementById("gpxi-before-toggle")?.checked;
    try {
      map.getSource("gpxi-before").setData({ type: "Feature", geometry: {
        type: "LineString", coordinates: (an && _beforeCoords) ? _beforeCoords : [] } });
    } catch (_) {}
  }
  function zeigeVorherNachher() {
    if (!_beforeStats) return;
    const nach = _trackStats();
    const vor = _beforeStats;
    const box = document.getElementById("gpxi-baft");
    const rows = document.getElementById("gpxi-baft-rows");
    if (!box || !rows) return;
    const zeile = (lab, a, b, besserWennKleiner) => {
      const gleich = a === b;
      const cls = gleich ? "" : (besserWennKleiner === null ? " neutral"
        : ((b < a) === besserWennKleiner ? " gut" : " schlecht"));
      return `<span class="gpxi-sg-l">${lab}</span><span class="gpxi-sg-v${cls}">${a} → ${b}</span>`;
    };
    rows.innerHTML =
      zeile(t("gpxinspect.points", "Punkte"), vor.n, nach.n, null)
      + zeile(t("gpxinspect.st_dist", "Strecke"), _fmtKm(vor.dist), _fmtKm(nach.dist), true)
      + (vor.dur > 0 ? zeile(t("gpxinspect.st_max", "Max. Tempo"),
          vor.maxKmh.toFixed(1) + " km/h", nach.maxKmh.toFixed(1) + " km/h", true) : "")
      + (vor.dur > 0 ? zeile(t("gpxinspect.st_dur", "Dauer"),
          _fmtDur(vor.dur * 1000), _fmtDur(nach.dur * 1000), null) : "")
      + (vor.asc || nach.asc ? zeile(t("gpxinspect.st_hm", "Höhenmeter") + " ↑",
          Math.round(vor.asc) + " m", Math.round(nach.asc) + " m", true) : "");
    box.hidden = false;
    const bt = document.getElementById("gpxi-before-toggle");
    if (bt) bt.checked = true;
    renderBeforeLine();
  }

  function renderAll() {
    _lbZeiten = null; _lbZeitSort = null;   // Logbuch: Punktzeiten neu ableiten (Index ↔ Uhrzeit)
    // Der Track hat sich geändert → Fahrtrichtungen neu (nur wenn Pfeile an).
    try { _pfeileBerechnen(); } catch (_) {}
    if (!map) return;
    // v0.9.292 — DEM-Profil wird ungültig sobald sich die Punktzahl ändert (Indizes verschieben sich).
    if (_demEles && _demEles.length !== _points.length) _eleInvalidate();
    try {
      const line = { type: "Feature", geometry: { type: "LineString", coordinates: _points.map(p => [p.lon, p.lat]) } };
      if (map.getSource("gpxi-line")) map.getSource("gpxi-line").setData(line);
    } catch (_) {}
    try { renderSpeedColor(); } catch (_) {}
    try { renderStatGrid(); } catch (_) {}
    renderPoints();
  }

  /* 29.08.2026 (Marc) — Track nach Tempo einfärben, um GPS-Ausreißer zu SEHEN.
   * Pro Segment km/h aus Distanz/Zeitdifferenz; die Schwellen kommen aus dem
   * Track selbst (Perzentile), damit Wandern wie Radfahren funktioniert:
   * grün ≤ P80, gelb ≤ P95, orange ≤ 1,5×P95, rot darüber (Ausreißer-Kandidat).
   * Die Legende zeigt die echten km/h-Schwellen dieses Tracks. */
  function _segSpeeds() {
    const out = new Array(Math.max(0, _points.length - 1)).fill(null);
    for (let i = 1; i < _points.length; i++) {
      const a = _points[i - 1], b = _points[i];
      if (!a.time || !b.time) continue;
      const dt = (Date.parse(b.time) - Date.parse(a.time)) / 1000;
      if (!(dt > 0)) continue;
      const R = 6371000, dLa = (b.lat - a.lat) * Math.PI / 180, dLo = (b.lon - a.lon) * Math.PI / 180;
      const q = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLo / 2) ** 2;
      out[i - 1] = (R * 2 * Math.asin(Math.sqrt(q))) / dt * 3.6;
    }
    return out;
  }
  let _speedFarben = null;   // Punkt-Index → Tempo-Farbe (nur wenn Färbung an)
  let _pfeilBrg = null;      // Punkt-Index → Fahrtrichtung (nur für die Pfeile)
  /** Fahrtrichtung je Punkt — einmal je Track, nicht bei jedem Zeichnen.
   *  Nutzt dieselbe geglättete Rechnung wie der Laufpunkt (ui/js/util.js);
   *  bei 25 m Basis zeigt eine Wendestrecke sauber in beide Richtungen. */
  function _pfeileBerechnen() {
    if (_points.length < 2) { _pfeilBrg = null; return; }
    const co = _points.map(p => [p.lon, p.lat]);
    const g = (typeof kursGlaettung === "function") ? kursGlaettung(2) : { basisM: 30, minPunkte: 10 };
    _pfeilBrg = new Array(co.length);
    for (let i = 0; i < co.length; i++) {
      _pfeilBrg[i] = (typeof kursAusSpur === "function")
        ? kursAusSpur(co, i, g.basisM, g.minPunkte) : 0;
    }
  }
  /* 29.08.2026 (Marc: „wie heile ich diese tempo probleme?") — der Rest nach
   * dem Positions-Glätten sind DAUERHAFTE Versätze: 40 m Sprung, der Track
   * bleibt drüben. Die Strecke wurde real zurückgelegt, nur die Zeitstempel
   * behaupten Unmögliches. Heilung = ZEIT korrigieren: Segmente über der
   * Ausreißer-Schwelle (Median-relativ, wie die Erkennung) bekommen die Dauer,
   * die das übliche Tempo der Umgebung (±15 Segmente) gebraucht hätte; alle
   * späteren Zeitstempel rücken entsprechend nach hinten. Positionen und
   * Strecke bleiben unangetastet, die Tour wird ein paar Sekunden länger. */
  function tempoEntzerren() {
    if (!_hasTime) return 0;
    const n = _points.length;
    if (n < 3) return 0;
    const orig = _points.map(p => p.time ? Date.parse(p.time) : null);
    const sens = Math.max(1, Math.min(10, parseFloat((document.getElementById("gpxi-sens") || {}).value) || 5));
    const lerp = (a, b) => a + (b - a) * (sens - 1) / 9;
    const vs = [];
    for (let i = 1; i < n; i++) {
      if (orig[i] == null || orig[i - 1] == null) continue;
      const dt = (orig[i] - orig[i - 1]) / 1000;
      if (dt > 0) vs.push(_haversine(_points[i - 1], _points[i]) / dt);
    }
    vs.sort((a, b) => a - b);
    const med = vs.length ? vs[Math.floor(vs.length / 2)] : 0;
    if (med <= 0) return 0;
    // 29.08.2026 (Marc: „ich bin ein paar mal gerannt, aber 27 km/h hab ich
    // bestimmt nicht erreicht") — wer sein Maximal-Tempo kennt, gibt es vor;
    // leer bleibt die automatische Median-Schwelle.
    const capKmh = parseFloat((document.getElementById("gpxi-tempo-cap") || {}).value);
    const thr = (isFinite(capKmh) && capKmh >= 1)
      ? capKmh / 3.6
      : Math.max(4.2, med * lerp(12, 3));
    let shiftMs = 0, fixed = 0;
    for (let i = 1; i < n; i++) {
      if (orig[i] == null) continue;
      if (orig[i - 1] != null) {
        const dt = (orig[i] - orig[i - 1]) / 1000;
        const d = _haversine(_points[i - 1], _points[i]);
        const zuSchnell = (dt <= 0 && d > 1) || (dt > 0 && d / dt > thr);
        if (zuSchnell) {
          // Zieltempo: Median der Umgebung ohne die Ausreißer selbst.
          const fenster = [];
          for (let j = Math.max(1, i - 15); j < Math.min(n, i + 16); j++) {
            if (orig[j] == null || orig[j - 1] == null) continue;
            const ddt = (orig[j] - orig[j - 1]) / 1000;
            if (ddt <= 0) continue;
            const vv = _haversine(_points[j - 1], _points[j]) / ddt;
            if (vv <= thr) fenster.push(vv);
          }
          fenster.sort((a, b) => a - b);
          const ziel = Math.max(0.5, fenster.length ? fenster[Math.floor(fenster.length / 2)] : med);
          const neuDt = d / ziel;
          shiftMs += (neuDt - Math.max(0, dt)) * 1000;
          fixed++;
        }
      }
      if (shiftMs > 0.5) _points[i].time = new Date(orig[i] + Math.round(shiftMs)).toISOString();
    }
    return fixed;
  }

  /** 31.08.2026 (der MTB-Kollege eines Beta-Testers): Punktzahl reduzieren — behält ECHTE
   *  Punkte, gleichmäßig über die Strecke gewählt (erster/letzter immer). */
  /** Welche Punkte überleben? Gleichmäßig nach STRECKE gewählt, erster und
   *  letzter immer. Vorschau und Anwenden teilen sich diese Rechnung. */
  function _reduzierAuswahl(ziel) {
    const n = _points.length;
    ziel = Math.round(ziel);
    if (!n || !isFinite(ziel) || ziel < 2 || ziel >= n) return null;
    const cum = [0];
    for (let i = 1; i < n; i++) cum.push(cum[i - 1] + _haversine(_points[i - 1], _points[i]));
    const total = cum[n - 1] || 1;
    const schritt = total / (ziel - 1);
    const behalten = [_points[0]];
    let naechste = schritt, i = 1;
    while (i < n - 1 && behalten.length < ziel - 1) {
      if (cum[i] >= naechste) { behalten.push(_points[i]); naechste += schritt; }
      i++;
    }
    behalten.push(_points[n - 1]);
    return behalten;
  }

  /** Regler-Stand → Beschriftung + orange Vorschau-Linie auf der Karte. */
  /* 02.09.2026 (Marc: „lücke füllen sollte vorausgefüllt sein, je nach tempo —
   * da kann man sich ja denken, welche art der fortbewegung es war"):
   * Die Fortbewegungsart aus dem Tempo der Tour vorschlagen. Gerechnet wird
   * mit dem MEDIAN der Segmente in Bewegung (über 0,5 km/h) — der Mittelwert
   * würde von Pausen und Ausreißern verzogen. Die Grenzen sind bewusst weit:
   * 9 km/h liegt über jedem Wandertempo und unter jedem Radtempo, 25 km/h
   * über flottem Radfahren und unter Landstraße. Wer selbst wählt, behält
   * seine Wahl — der Vorschlag kommt nur beim Laden eines Tracks. */
  let _profilManuell = false;
  function profilVorschlagen() {
    const sel = document.getElementById("gpxi-profile");
    const hin = document.getElementById("gpxi-profil-hinweis");
    if (!sel) return;
    if (_profilManuell || !_hasTime) { if (hin) hin.hidden = true; return; }
    const vs = _segSpeeds().filter(v => v != null && isFinite(v) && v > 0.5).sort((a, b) => a - b);
    if (vs.length < 10) { if (hin) hin.hidden = true; return; }
    const med = vs[Math.floor(vs.length / 2)];
    const wahl = med <= 9 ? "walking" : med <= 25 ? "cycling" : "driving";
    sel.value = wahl;
    if (hin) {
      const name = { walking: t("gpxinspect.mm_walking", "Zu Fuß / Wandern"),
                     cycling: t("gpxinspect.mm_cycling", "Fahrrad"),
                     driving: t("gpxinspect.mm_driving", "Auto") }[wahl];
      hin.hidden = false;
      hin.textContent = t("gpxinspect.profil_geraten",
        "\u201E{art}\u201C aus dem Tempo dieser Tour geschätzt (Median {v} km/h) — du kannst es ändern.")
        .replace("{art}", name).replace("{v}", med.toFixed(1));
    }
  }

  function reduzierVorschau() {
    const el = document.getElementById("gpxi-reduce-n");
    const lbl = document.getElementById("gpxi-reduce-v");
    const hint = document.getElementById("gpxi-reduce-hint");
    const n = _points.length;
    if (!el) return;
    const ziel = Math.max(2, Math.min(n, parseInt(el.value, 10) || n));
    const pct = n > 1 ? Math.round((ziel / n) * 100) : 100;
    if (lbl) lbl.textContent = `${ziel} / ${n} (${pct} %)`;
    const auswahl = (ziel < n) ? _reduzierAuswahl(ziel) : null;
    if (hint) {
      hint.textContent = auswahl
        ? t("gpxinspect.reduce_hint", "{n} Punkte fallen weg").replace("{n}", String(n - auswahl.length))
        : t("gpxinspect.reduce_alle", "alle Punkte bleiben");
    }
    try {
      map.getSource("gpxi-redprev").setData({ type: "Feature", geometry: {
        type: "LineString",
        coordinates: auswahl ? auswahl.map(p => [p.lon, p.lat]) : [] } });
      // 01.09.2026 (im Test gefunden): die orange Linie allein sieht man NICHT —
      // die dichten blauen Punkt-Kreise des Originals decken sie zu. Deshalb
      // (1) die überlebenden Punkte orange darüber zeichnen, (2) das Original
      // währenddessen abblenden und (3) beide Vorschau-Ebenen nach oben holen.
      map.getSource("gpxi-redprev-pts").setData({ type: "FeatureCollection",
        features: (auswahl || []).map(p => ({ type: "Feature", properties: {},
          geometry: { type: "Point", coordinates: [p.lon, p.lat] } })) });
      for (const id of ["gpxi-redprev-lyr", "gpxi-redprev-pts-lyr"]) {
        if (map.getLayer(id)) map.moveLayer(id);
      }
      const blass = !!auswahl;
      if (map.getLayer("gpxi-pts-lyr")) map.setPaintProperty("gpxi-pts-lyr", "circle-opacity", blass ? 0.18 : 1);
      if (map.getLayer("gpxi-pts-lyr")) map.setPaintProperty("gpxi-pts-lyr", "circle-stroke-opacity", blass ? 0.18 : 1);
      if (map.getLayer("gpxi-pts-arrow")) map.setPaintProperty("gpxi-pts-arrow", "icon-opacity", blass ? 0.18 : 1);
      if (map.getLayer("gpxi-speed-lyr")) map.setPaintProperty("gpxi-speed-lyr", "line-opacity", blass ? 0.2 : 0.95);
      // Ohne Vorschau gehoert die Grundlinie NICHT pauschal auf 0,85 zurueck:
      // bei aktiver Tempo-Faerbung haelt renderSpeedColor sie bewusst auf 0,15,
      // sonst uebertoent das Blau die Farbsegmente.
      if (map.getLayer("gpxi-line-lyr")) map.setPaintProperty("gpxi-line-lyr", "line-opacity",
        blass ? 0.25 : (_speedFarben ? 0.15 : 0.85));
    } catch (_) {}
    const btn = document.getElementById("gpxi-reduce-run");
    if (btn) btn.disabled = !auswahl;
  }

  /** Regler auf den aktuellen Track einstellen: Maximum = echte Punktzahl,
   *  Stand = 100 % (Marc, 01.09.2026: „immer die anzahl des tracks drin"). */
  function reduzierReglerSync(behalteStand) {
    const el = document.getElementById("gpxi-reduce-n");
    if (!el) return;
    const n = Math.max(2, _points.length);
    el.max = String(n);
    el.min = "2";
    // 02.09.2026 (Marc: „nach tempo einfaerben geht nicht mehr") — hier stand
    // bei langen Tracks eine Schrittweite von 10. Der Browser rastet den Wert auf min + k*step,
    // also auf 2, 12, 22 … Bei 2 788 Punkten wurde aus value="2788" ein 2782:
    // der Regler stand nie auf 100 %, die Reduzier-Vorschau lief dauerhaft mit
    // und blendete Track UND Tempo-Faerbung auf 0,2 ab. Schrittweite 1 kostet
    // nichts und laesst den Regler die echte Punktzahl erreichen.
    el.step = "1";
    // Neuer Track (oder Stand größer als der Track): auf 100 % = alle Punkte.
    // Der Regler zeigt damit immer die ECHTE Punktzahl dieses Tracks an.
    if (!behalteStand || !el.value || parseInt(el.value, 10) > n) el.value = String(n);
    reduzierVorschau();
  }

  function punkteReduzieren(ziel) {
    const n = _points.length;
    const behalten = _reduzierAuswahl(ziel);
    if (!behalten) {
      toast(t("gpxinspect.reduce_schon", "Der Track hat nur {n} Punkte").replace("{n}", String(n)), "info");
      return 0;
    }
    _pushUndo(t("gpxinspect.reduce_run", "Reduzieren"));
    merkeVorher();
    _points = behalten;
    _selA = _selB = null;
    _dirty = true;
    renderAll(); updateUI(); zeigeVorherNachher();
    reduzierReglerSync(true);
    return n - _points.length;
  }

  /** 31.08.2026: Zeitstempel auf ein Wunsch-Ø-Tempo umschreiben. Startzeit
   *  bleibt die vorhandene erste Zeit (ohne Zeiten: heute 09:00). Danach hat
   *  auch eine geplante Route eine echte Zeitachse. */
  function tempoSetzen(kmh) {
    const n = _points.length;
    if (n < 2 || !isFinite(kmh) || kmh <= 0) return false;
    _pushUndo(t("gpxinspect.speed_run", "Anwenden"));
    merkeVorher();
    let t0 = _points[0].time ? Date.parse(_points[0].time) : NaN;
    if (!isFinite(t0)) {
      const d = new Date(); d.setHours(9, 0, 0, 0);
      t0 = d.getTime();
    }
    const v = kmh / 3.6;
    let cum = 0;
    _points[0].time = new Date(t0).toISOString();
    for (let i = 1; i < n; i++) {
      cum += _haversine(_points[i - 1], _points[i]);
      _points[i].time = new Date(t0 + Math.round((cum / v) * 1000)).toISOString();
    }
    _hasTime = true;
    _dirty = true;
    renderAll(); updateUI(); zeigeVorherNachher();
    // Jetzt hat der Track eine Uhr: die Zeile hat ihren Zweck erfüllt, ab hier
    // ist der Geschwindigkeitsheiler zuständig.
    { const r = document.getElementById("gpxi-speedrow"); if (r) r.hidden = true; }
    { const r = document.getElementById("gpxi-heal-tempo-row"); if (r) r.style.display = ""; }
    { const r = document.getElementById("gpxi-tempocap-row"); if (r) r.style.display = ""; }
    return true;
  }

  function renderSpeedColor() {
    const src = map && map.getSource("gpxi-speed");
    if (!src) return;
    const an = !!document.getElementById("gpxi-speedcolor")?.checked;
    const leg = document.getElementById("gpxi-speedlegend");
    const thrRow = document.getElementById("gpxi-speedthr-row");
    if (thrRow) thrRow.hidden = !(an && _hasTime && _points.length >= 3);
    if (!an || !_hasTime || _points.length < 3) {
      src.setData({ type: "FeatureCollection", features: [] });
      if (leg) leg.hidden = true;
      const warAn = !!_speedFarben;
      _speedFarben = null;
      try { map.setPaintProperty("gpxi-line-lyr", "line-opacity", 0.85); } catch (_) {}
      if (warAn) renderPoints();   // Punktfarben zurücksetzen
      return;
    }
    const spd = _segSpeeds();
    const werte = spd.filter(v => v != null && isFinite(v)).slice().sort((x, y) => x - y);
    if (!werte.length) { src.setData({ type: "FeatureCollection", features: [] }); if (leg) leg.hidden = true; return; }
    const p = (f) => werte[Math.min(werte.length - 1, Math.floor(f * (werte.length - 1)))];
    // 02.09.2026 (Marc): Die Schwelle lässt sich vorgeben. Leer = wie bisher aus
    // der Tour selbst (Perzentile), damit Wandern wie Radfahren funktioniert.
    // Mit Zahl gilt sie fest — dann heißt „rot" für jede Tour dasselbe, und man
    // kann zwei Aufzeichnungen wirklich vergleichen.
    const eigene = parseFloat((document.getElementById("gpxi-speed-thr") || {}).value);
    let p80, p95, rot;
    if (isFinite(eigene) && eigene > 0) {
      rot = eigene; p95 = eigene * (2 / 3); p80 = eigene / 3;
    } else {
      p80 = p(0.80); p95 = p(0.95); rot = Math.max(p95 * 1.5, p95 + 1);
    }
    const farbe = (v) => v == null ? "#8a8f98"
      : v <= p80 ? "#2ecc71" : v <= p95 ? "#f1c40f" : v <= rot ? "#ff8c1a" : "#ff3355";
    const feats = [];
    for (let i = 0; i < spd.length; i++) {
      feats.push({ type: "Feature", properties: { color: farbe(spd[i]), i: i },
        geometry: { type: "LineString",
          coordinates: [[_points[i].lon, _points[i].lat], [_points[i + 1].lon, _points[i + 1].lat]] } });
    }
    src.setData({ type: "FeatureCollection", features: feats });
    // Punktfarbe = Tempo des ANKOMMENDEN Segments (Punkt 0 erbt das erste).
    _speedFarben = new Array(_points.length);
    for (let i = 0; i < _points.length; i++) _speedFarben[i] = farbe(spd[Math.max(0, i - 1)]);
    renderPoints();
    try { map.setPaintProperty("gpxi-line-lyr", "line-opacity", 0.15); } catch (_) {}
    if (leg) {
      leg.hidden = false;
      leg.innerHTML = [["#2ecc71", `≤ ${p80.toFixed(1)}`], ["#f1c40f", `≤ ${p95.toFixed(1)}`],
                       ["#ff8c1a", `≤ ${rot.toFixed(1)}`], ["#ff3355", `> ${rot.toFixed(1)} km/h`]]
        .map(([c, txt]) => `<span><i style="background:${c}"></i>${txt}</span>`).join("");
    }
  }

  /** Pfeilspitze als SDF-Bild (nur Alpha zählt) — damit `icon-color` je
   *  Punkt greift und die Tempo-Färbung auch für Pfeile gilt. */
  function _pfeilBildSdf() {
    const d = 2, w = 26 * d, h = 26 * d;
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d");
    g.translate(w / 2, h / 2);
    g.fillStyle = "#fff";
    g.beginPath();
    g.moveTo(0, -10 * d);          // Spitze
    g.lineTo(7 * d, 9 * d);
    g.lineTo(0, 5 * d);            // Kerbe
    g.lineTo(-7 * d, 9 * d);
    g.closePath();
    g.fill();
    return c.getContext("2d").getImageData(0, 0, w, h);
  }

  /** 02.09.2026 (Marc: „Pfeile sind immer da als Default, die haben doch
   *  keinen Nachteil"): Richtig — der Pfeil sagt zusätzlich die Richtung und
   *  kostet sonst nichts. Also kein Umschalter.
   *
   *  Einzige Ausnahme: Wenn das Pfeilbild nicht in den Karten-Atlas kommt
   *  (alte GPU, Stil noch nicht fertig), bleiben die Kreise stehen — lieber
   *  Punkte als eine leere Karte. */
  function _pfeilModus() {
    try { return !!(map && map.hasImage && map.hasImage("gpxi-arrow")); }
    catch (_) { return false; }
  }
  function _punktFormAnwenden() {
    const pfeile = _pfeilModus();
    try {
      if (map.getLayer("gpxi-pts-lyr"))
        map.setLayoutProperty("gpxi-pts-lyr", "visibility", pfeile ? "none" : "visible");
      if (map.getLayer("gpxi-pts-arrow"))
        map.setLayoutProperty("gpxi-pts-arrow", "visibility", pfeile ? "visible" : "none");
    } catch (_) {}
  }

  function renderPoints() {
    if (!map || !map.getSource("gpxi-pts")) return;
    const feats = new Array(_points.length);
    for (let i = 0; i < _points.length; i++) {
      const p = _points[i];
      const sel = (i === _selA) ? "a" : (i === _selB) ? "b" : "";
      feats[i] = {
        type: "Feature",
        properties: { i: i, sel: sel, anchor: (sel !== ""), spike: _spikeSet.has(i),
                      fund: _tcMarkiert.has(i),
                      sc: _speedFarben ? _speedFarben[i] : null,
                      // Fahrtrichtung an dieser Stelle — nur für die
                      // Pfeil-Darstellung. Dieselbe Rechnung wie beim
                      // Laufpunkt (util.js), damit „vor" und „zurück" auf
                      // einer Wendestrecke wirklich auseinandergehen.
                      brg: _pfeilBrg ? _pfeilBrg[i] : 0 },
        geometry: { type: "Point", coordinates: [p.lon, p.lat] },
      };
    }
    try { map.getSource("gpxi-pts").setData({ type: "FeatureCollection", features: feats }); } catch (_) {}
    renderAnchorMarkers();
    renderStartZielMarker();     // 27.08.2026 — Anfang/Ende sichtbar halten
  }
  // v0.9.304 — Deutliche A/B-Anker als Pin-Badges (statt nur etwas größerer Kreise).
  function _mkAnchorEl(lab, cls) {
    // WICHTIG: kein CSS-transform am Marker-Element selbst — Mapbox/MapLibre setzt dort
    // sein eigenes translate fürs Positionieren und würde es überschreiben. Runder Badge.
    const el = document.createElement("div");
    el.className = "gpxi-anchor-mk " + cls;
    el.textContent = lab;
    return el;
  }
  // 27.08.2026 (Marc: „im inspektor müssen anfang und ende einer tour klar
  // sichtbar sein") — Wer eine Aufzeichnung prüft, muss zuerst wissen, wo sie
  // beginnt: Anfahrt wegschneiden, Rundtour beurteilen, Ausreißer am Rand
  // erkennen. Bisher sahen alle Punkte gleich aus, Grün/Rot war für die
  // A/B-Auswahl reserviert. Deshalb hier BESCHRIFTETE Fähnchen statt Farben —
  // die sind eindeutig und kollidieren nicht mit der Auswahl.
  function _mkEndeEl(text, cls) {
    // Kein CSS-transform am Element selbst (siehe _mkAnchorEl).
    const el = document.createElement("div");
    el.className = "gpxi-ende-mk " + cls;
    el.textContent = text;
    return el;
  }

  function renderStartZielMarker() {
    if (!map || !_maplib || typeof _maplib.Marker !== "function") return;
    try {
      if (_startMarker) { _startMarker.remove(); _startMarker = null; }
      if (_zielMarker) { _zielMarker.remove(); _zielMarker = null; }
      if (!_points.length) return;
      const a = _points[0], z = _points[_points.length - 1];
      _startMarker = new _maplib.Marker({ element: _mkEndeEl(t("gpxinspect.start", "▶ START"), "gpxi-ende-start") })
        .setLngLat([a.lon, a.lat]).addTo(map);
      // Bei einer Rundtour liegen Anfang und Ende praktisch aufeinander; dann
      // würde das zweite Fähnchen das erste verdecken. In dem Fall sagt EIN
      // Fähnchen die Wahrheit — sonst rätselt man, warum „Ziel" fehlt.
      const rund = Math.abs(a.lat - z.lat) < 1e-4 && Math.abs(a.lon - z.lon) < 1e-4;
      if (rund) {
        _startMarker.remove();
        _startMarker = new _maplib.Marker({ element: _mkEndeEl(t("gpxinspect.rundtour", "▶ START · ZIEL"), "gpxi-ende-rund") })
          .setLngLat([a.lon, a.lat]).addTo(map);
        return;
      }
      _zielMarker = new _maplib.Marker({ element: _mkEndeEl(t("gpxinspect.ziel", "■ ZIEL"), "gpxi-ende-ziel") })
        .setLngLat([z.lon, z.lat]).addTo(map);
    } catch (e) { applog && applog("warn", "[gpxinspect] Start/Ziel: " + e); }
  }

  function renderAnchorMarkers() {
    if (!map || !_maplib || typeof _maplib.Marker !== "function") return;
    try {
      if (_aMarker) { _aMarker.remove(); _aMarker = null; }
      if (_bMarker) { _bMarker.remove(); _bMarker = null; }
      if (_selA != null && _points[_selA]) {
        _aMarker = new _maplib.Marker({ element: _mkAnchorEl("A", "gpxi-anchor-a") })
          .setLngLat([_points[_selA].lon, _points[_selA].lat]).addTo(map);
      }
      if (_selB != null && _points[_selB]) {
        _bMarker = new _maplib.Marker({ element: _mkAnchorEl("B", "gpxi-anchor-b") })
          .setLngLat([_points[_selB].lon, _points[_selB].lat]).addTo(map);
      }
    } catch (_) {}
  }

  function fitTrack(bbox) {
    if (!map || !_points.length) return;
    try {
      let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
      for (const p of _points) {
        if (p.lon < minLon) minLon = p.lon; if (p.lon > maxLon) maxLon = p.lon;
        if (p.lat < minLat) minLat = p.lat; if (p.lat > maxLat) maxLat = p.lat;
      }
      map.fitBounds([[minLon, minLat], [maxLon, maxLat]], { padding: 60, duration: 600, maxZoom: 17 });
    } catch (_) {}
  }

  // ── Auswahl ─────────────────────────────────────────────────────────────────
  // v0.9.294 — Klick-Toleranz (Marc): nicht nur exakt auf dem Punkt, sondern auch
  // wenn man nah dran ist. Wir suchen den nächsten Punkt im Pixel-Radius statt das
  // Klick-Event an den Punkt-Layer zu binden. Einzelklick = Info-Feld (verzögert),
  // Doppelklick = Anker direkt.
  const _HIT_TOL_PX = 18;
  function _nearestIdxToPoint(px, py, tolPx) {
    if (!map || !_points.length) return -1;
    const tol2 = tolPx * tolPx;
    let best = -1, bestD = tol2;
    for (let i = 0; i < _points.length; i++) {
      let sp; try { sp = map.project([_points[i].lon, _points[i].lat]); } catch (_) { continue; }
      const dx = sp.x - px, dy = sp.y - py, d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }
  function onMapClick(e) {
    if (_drawMode) { onMapClickDraw(e); return; }
    if (_dragMoved) { _dragMoved = false; return; }   // Klick direkt nach Drag schlucken
    // v0.9.305 (Nutzer-Feedback): Anker-Klick wählt IMMER den nächstgelegenen
    // Track-Punkt — egal wie weit der Klick entfernt ist (kein 18px-Limit mehr).
    // Man klickt grob hin, der nächste Punkt wird gesetzt.
    try { const bef = _lbBefundAnKarte(e.point); if (bef && !_lbPunktModus) { _lbBefundZeigen(bef.key, bef.idx, true); return; } } catch (_) {}
    const i = _nearestIdxToPoint(e.point.x, e.point.y, Infinity);
    if (i < 0) return;
    if (_lbPunktModus) { try { _lbPunktSetzen(i); } catch (_) {} return; }   // Logbuch Stufe 2: eigener Punkt
    try { _lbWaehleZuIdx(i); } catch (_) {}   // Logbuch (§68 Q16): Klick auf den Track wählt den Eintrag
    if (_clickTimer) { clearTimeout(_clickTimer); _clickTimer = null; }
    // v0.9.303 — Einzelklick setzt direkt Anker A/B (Daten gibt's live in der Hover-Box).
    _clickTimer = setTimeout(() => { _clickTimer = null; selectAnchor(i); }, 240);
  }
  function onMapDbl(e) {
    if (_drawMode) return;
    const i = _nearestIdxToPoint(e.point.x, e.point.y, _HIT_TOL_PX);
    if (i < 0) return;
    try { e.preventDefault(); } catch (_) {}   // kein Karten-Doppelklick-Zoom, wenn ein Punkt nah ist
    if (_clickTimer) { clearTimeout(_clickTimer); _clickTimer = null; }
    selectAnchor(i);
  }
  // Anker-Logik (A → B → neu), aus onPointClick herausgezogen.
  function selectAnchor(i) {
    if (_selA === null) { _selA = i; }
    else if (_selB === null) {
      if (i === _selA) return;
      _selB = i;
      if (_selB < _selA) { const tmp = _selA; _selA = _selB; _selB = tmp; }
    } else { _selA = i; _selB = null; }
    renderPoints(); updateUI();
    if (_profDraw) drawEleProfile();   // Anker-Marker im Profil mitziehen
  }

  function clearSelection() { _selA = _selB = null; renderPoints(); updateUI(); if (_profDraw) drawEleProfile(); }

  // ── Punkt verschieben (Drag, v0.9.243) ───────────────────────────────────────
  // Nur der ausgewählte grüne Anker A (Einzel-Auswahl) ist ziehbar. Zeit + Höhe
  // bleiben, nur die Position ändert sich → Geschwindigkeit bleibt korrekt.
  function onPointMouseDown(e) {
    if (_drawMode || _selB !== null) return;
    const f = e.features && e.features[0];
    if (!f || f.properties.i !== _selA) return;
    e.preventDefault();                       // Karte nicht mitziehen
    _dragging = true; _dragMoved = false;
    try { map.getCanvas().style.cursor = "grabbing"; } catch (_) {}
  }
  function onDragMove(e) {
    if (!_dragging || _selA === null) return;
    if (!_dragMoved) { _pushUndo(t("gpxinspect.move", "Punkt verschieben")); _dragMoved = true; }
    _points[_selA].lat = e.lngLat.lat;
    _points[_selA].lon = e.lngLat.lng;
    renderAll();                              // Linie + Punkte aktualisieren
  }
  function onDragEnd() {
    if (!_dragging) return;
    _dragging = false;
    try { map.getCanvas().style.cursor = ""; } catch (_) {}
    if (_dragMoved) { _dirty = true; clearSpikes(); renderAll(); updateUI(); }
  }

  // ── Edit-Operationen ─────────────────────────────────────────────────────────
  function healSegment() {
    if (_selA === null || _selB === null || _selB <= _selA + 1) return;
    _pushUndo(t("gpxinspect.heal", "Heilen"));
    const A = _points[_selA], B = _points[_selB];
    const span = _selB - _selA;
    for (let k = _selA + 1; k < _selB; k++) {
      const tt = (k - _selA) / span;
      _points[k].lat = A.lat + (B.lat - A.lat) * tt;
      _points[k].lon = A.lon + (B.lon - A.lon) * tt;
      if (A.ele != null && B.ele != null) _points[k].ele = A.ele + (B.ele - A.ele) * tt;
      // Zeit ABSICHTLICH unverändert → Geschwindigkeit korrigiert sich selbst.
    }
    _dirty = true; clearSpikes(); clearSelection();
    renderAll(); updateUI();
    toast(t("gpxinspect.healed", "Abschnitt geglättet — Zeit behalten, Geschwindigkeit korrigiert."), "success", 2200);
  }

  function _haversine(a, b) {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const la1 = a.lat * rad, la2 = b.lat * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // v0.9.315 — Plausi-Check gegen erfundene Umwege/Schleifen beim Routen/Matchen.
  // Mapbox routet an Kreuzungen schon mal über Ausfahrt+Kreisel zurück — eine saubere
  // GPS-Spur darf dadurch NICHT verbogen werden. ratio = Pfadlänge / Luftlinie A→B.
  // Liegt sie über maxRatio, ist es ein Umweg/Schleife → Caller verwirft die Route.
  function _routePathLen(coords) {
    let L = 0;
    for (let i = 1; i < coords.length; i++) {
      L += _haversine({ lon: coords[i - 1][0], lat: coords[i - 1][1] }, { lon: coords[i][0], lat: coords[i][1] });
    }
    return L;
  }
  function _routeIsDetour(coords, straightDist, maxRatio) {
    if (!Array.isArray(coords) || coords.length < 2) return false;
    const L = _routePathLen(coords);
    const ref = Math.max(straightDist || 0, 30);   // kleine Lücken nicht überempfindlich
    return L > ref * maxRatio;
  }

  async function fillGap() {
    if (_selA === null || _selB === null || _selB <= _selA) return;
    // 22.08.2026 (Audit): zwischen A und B liegende Punkte werden ERSETZT —
    // bei versehentlich weit gesetzten Markern verschwanden ganze Abschnitte
    // ohne Hinweis. Ab 3 Zwischenpunkten nachfragen.
    const dazwischen = _selB - _selA - 1;
    if (dazwischen >= 3 && typeof window.rzConfirm === "function") {
      const ok = await window.rzConfirm(
        t("gpxinspect.fill", "Lücke füllen (Luftlinie)"),
        t("gpxinspect.fill_ersetzt", "Zwischen A und B liegen {n} vorhandene Punkte. Sie werden durch die neue gerade Linie ersetzt. Fortfahren?").replace("{n}", dazwischen),
        t("gpxinspect.fill", "Lücke füllen (Luftlinie)"), true);
      if (!ok) return;
    }
    _pushUndo(t("gpxinspect.fill", "Lücke füllen"));
    const A = _points[_selA], B = _points[_selB];
    let spacing = parseFloat((document.getElementById("gpxi-spacing") || {}).value) || 20;
    spacing = Math.max(2, Math.min(500, spacing));
    const dist = _haversine(A, B);
    let n = Math.max(1, Math.min(2000, Math.round(dist / spacing) - 1));
    const tA = A.time ? Date.parse(A.time) : null;
    const tB = B.time ? Date.parse(B.time) : null;
    const inserted = [];
    for (let k = 1; k <= n; k++) {
      const tt = k / (n + 1);
      const np = {
        lat: A.lat + (B.lat - A.lat) * tt,
        lon: A.lon + (B.lon - A.lon) * tt,
        ele: (A.ele != null && B.ele != null) ? (A.ele + (B.ele - A.ele) * tt) : (A.ele != null ? A.ele : null),
        time: (tA != null && tB != null) ? new Date(tA + (tB - tA) * tt).toISOString() : null,
      };
      inserted.push(np);
    }
    // Alles strikt zwischen A und B durch die neuen Punkte ersetzen.
    _points.splice(_selA + 1, (_selB - _selA - 1), ...inserted);
    _dirty = true; clearSpikes(); clearSelection();
    renderAll(); updateUI();
    toast(t("gpxinspect.filled", "Lücke gefüllt: ") + inserted.length + " " + t("gpxinspect.points", "Punkte"), "success", 2200);
  }

  // ── Zeit-/Punkt-Info (Nutzer-Wunsch v0.9.263): beim Klick auf einen Punkt
  //    Index, Zeitstempel (lokal) und Höhe zeigen. _ptInfo wird in updateUI in die
  //    Auswahl-Zeile geschrieben.
  function _fmtPtTime(iso) {
    if (!iso) return t("gpxinspect.no_time", "ohne Zeit");
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    try { return d.toLocaleString(); } catch (_) { return iso; }
  }
  function _fmtDur(ms) {
    if (ms == null || !isFinite(ms)) return "";
    let s = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60); s -= m * 60;
    return (h ? h + "h " : "") + (m || h ? m + "m " : "") + s + "s";
  }
  function _ptInfo(idx) {
    const p = _points[idx];
    if (!p) return "";
    let s = "#" + (idx + 1);
    if (p.time) s += " · 🕑 " + _fmtPtTime(p.time);
    if (p.ele != null) s += " · " + Math.round(p.ele) + " m";
    return s;
  }

  // ── Map Matching (Track auf Straße/Weg snappen) ──────────────────────────────
  let _mmBusy = false;
  function _applyMatchedRange(startIdx, endIdx, matched) {
    const A = _points[startIdx], B = _points[endIdx];
    const tA = A.time ? Date.parse(A.time) : null;
    const tB = B.time ? Date.parse(B.time) : null;
    const eA = (A.ele != null) ? A.ele : null, eB = (B.ele != null) ? B.ele : null;
    const pts = matched.map(c => ({ lon: c[0], lat: c[1] }));
    // Kumulative Länge der gematchten Linie → Zeit/Höhe linear über die Strecke verteilen.
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + _haversine(pts[i - 1], pts[i]));
    const total = cum[cum.length - 1] || 1;
    const newPts = pts.map((p, i) => {
      const f = cum[i] / total;
      return {
        lat: p.lat, lon: p.lon,
        ele: (eA != null && eB != null) ? (eA + (eB - eA) * f) : eA,
        time: (tA != null && tB != null) ? new Date(tA + (tB - tA) * f).toISOString() : null,
      };
    });
    _points.splice(startIdx, (endIdx - startIdx + 1), ...newPts);
  }

  // v0.9.268 — Eine Linie [{lon,lat}] auf ~spacingM Punktabstand nachverdichten.
  function _densifyLine(line, spacingM) {
    if (line.length < 2) return line.slice();
    const sp = Math.max(2, spacingM || 20);
    const out = [{ lon: line[0].lon, lat: line[0].lat }];
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i];
      const d = _haversine(a, b);
      const steps = Math.max(1, Math.round(d / sp));
      for (let k = 1; k <= steps; k++) {
        const tt = k / steps;
        out.push({ lon: a.lon + (b.lon - a.lon) * tt, lat: a.lat + (b.lat - a.lat) * tt });
      }
    }
    return out;
  }

  // v0.9.268 — Routen-Ergebnis (Strecke A→B) einsetzen MIT:
  //  (1) Nachverdichtung auf die Punktdichte des Original-Abschnitts → der Animator
  //      (der die Marker-Bewegung pro Punkt-Index verteilt) gibt dem längeren Stück
  //      proportional mehr Frames → Geschwindigkeit stimmt wieder.
  //  (2) Zeit über die DURCHSCHNITTSGESCHWINDIGKEIT des Original-Abschnitts (Marc-Idee):
  //      die längere Route bekommt entsprechend mehr Zeit, statt ins alte A→B-Fenster
  //      gequetscht zu werden (= zu schnell). Alle nachfolgenden Zeitstempel werden um
  //      die Differenz mitverschoben, damit der Track zeitlich konsistent bleibt.
  function _applyRoutedRange(startIdx, endIdx, rawCoords) {
    const A = _points[startIdx], B = _points[endIdx];
    // Original-Abschnitt vermessen (Distanz für die Durchschnittsgeschwindigkeit).
    let dOrig = 0;
    for (let i = startIdx + 1; i <= endIdx; i++) dOrig += _haversine(_points[i - 1], _points[i]);
    // Nachverdicht-Abstand = TYPISCHER (Median-)Punktabstand des ganzen Tracks, NICHT der
    // (oft spiky/spärliche) Original-Abschnitt → die geheilte Strecke kriegt dieselbe Dichte
    // wie der Rest und läuft im Animator nicht zu schnell.
    const _gaps = [];
    for (let i = 1; i < _points.length; i++) { const g = _haversine(_points[i - 1], _points[i]); if (g > 0.01) _gaps.push(g); }
    _gaps.sort((a, b) => a - b);
    const _med = _gaps.length ? _gaps[Math.floor(_gaps.length / 2)] : 20;
    const spacing = Math.max(5, Math.min(50, _med || 20));
    let pts = rawCoords.map(c => ({ lon: c[0], lat: c[1] }));
    pts = _densifyLine(pts, spacing);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + _haversine(pts[i - 1], pts[i]));
    const dNew = cum[cum.length - 1] || 1;
    const tA = A.time ? Date.parse(A.time) : null;
    const tB = B.time ? Date.parse(B.time) : null;
    const eA = (A.ele != null) ? A.ele : null, eB = (B.ele != null) ? B.ele : null;
    let timeAt, delta = 0;
    if (tA != null && tB != null && tB > tA && dOrig > 0) {
      const v = dOrig / (tB - tA);          // m pro ms = Durchschnittsgeschwindigkeit des Abschnitts
      timeAt = (i) => tA + cum[i] / v;       // konstante Geschwindigkeit über die neue Länge
      delta = (tA + dNew / v) - tB;          // ≥ 0: längere Route braucht mehr Zeit
    } else if (tA != null && tB != null) {
      timeAt = (i) => tA + (tB - tA) * (cum[i] / dNew);   // Fallback: linear (kein dOrig)
    } else {
      timeAt = () => null;
    }
    const newPts = pts.map((p, i) => {
      const f = cum[i] / dNew;
      const tt = timeAt(i);
      return {
        lat: p.lat, lon: p.lon,
        ele: (eA != null && eB != null) ? (eA + (eB - eA) * f) : eA,
        time: (tt != null) ? new Date(tt).toISOString() : null,
      };
    });
    // Nachfolgende Punkte zeitlich mitverschieben (vor dem Splice, Original-Indizes).
    if (delta > 0.5) {
      for (let i = endIdx + 1; i < _points.length; i++) {
        if (_points[i].time) _points[i].time = new Date(Date.parse(_points[i].time) + delta).toISOString();
      }
    }
    _points.splice(startIdx, (endIdx - startIdx + 1), ...newPts);
  }
  async function _runMatch(startIdx, endIdx, label) {
    if (_mmBusy || _drawMode) return;
    if (endIdx - startIdx < 1) return;
    let profile = (document.getElementById("gpxi-profile") || {}).value || "walking"; if (profile === "linear") profile = "walking";
    const radius = parseInt((document.getElementById("gpxi-mm-radius") || {}).value, 10) || 25;
    const coords = _points.slice(startIdx, endIdx + 1).map(p => [p.lon, p.lat]);
    _mmBusy = true; updateUI();
    toast(t("gpxinspect.matching", "Matche auf das Wegenetz …"), "info", 2000);
    let res;
    try { res = await rzWarten("gpxinspect_map_match", () => api().gpxinspect_map_match(coords, profile, radius)); }
    catch (e) { res = { ok: false, error: String(e) }; }
    _mmBusy = false;
    if (!res || !res.ok) {
      const err = res && res.error;
      if (err === "no_token") toast(t("gpxinspect.match_no_token", "Kein Mapbox-Token konfiguriert (siehe Einstellungen)."), "error", 3500);
      else toast(t("gpxinspect.match_failed", "Matching fehlgeschlagen: ") + (err || ""), "error", 3500);
      updateUI(); return;
    }
    const matched = res.coords || [];
    // res.matched===false → die API konnte NICHTS auf einen Weg legen (Spur zu weit weg).
    // Dann NICHT anwenden (sonst stiller No-Op = „passiert nix") — klare Meldung geben.
    if (matched.length < 2 || res.matched === false) {
      toast(t("gpxinspect.match_nomatch", "Kein Weg/keine Straße in der Nähe gefunden — Track liegt zu weit weg."), "warn", 3500);
      updateUI(); return;
    }
    _pushUndo(label);
    _applyMatchedRange(startIdx, endIdx, matched);
    _dirty = true; clearSpikes(); clearSelection();
    renderAll(); updateUI();
    toast(t("gpxinspect.matched", "Auf das Wegenetz gelegt: ") + matched.length + " " + t("gpxinspect.points", "Punkte"), "success", 2500);
  }
  // v0.9.267 — A→B per DIRECTIONS-Route (Straße folgen) statt Map Matching: kein
  // 50-m-Radius-Limit, A/B werden auf die nächste Straße gesnappt + dazwischen geroutet.
  // Robust gegen jede GPS-Drift. Ersetzt die mittleren Punkte durch die echte Wege-Route,
  // Zeit/Höhe linear über die neue Länge verteilt (wie Map Matching).
  async function routeSelection() {
    if (_selA === null || _selB === null || _selB <= _selA) return;
    if (_mmBusy || _drawMode) return;
    let profile = (document.getElementById("gpxi-profile") || {}).value || "walking"; if (profile === "linear") profile = "walking";
    const A = _points[_selA], B = _points[_selB];
    _mmBusy = true; updateUI();
    toast(t("gpxinspect.routing", "Suche Route zwischen A und B …"), "info", 2000);
    let res;
    try { res = await rzWarten("gpxinspect_route_ab", () => api().gpxinspect_route_ab([A.lon, A.lat], [B.lon, B.lat], profile)); }
    catch (e) { res = { ok: false, error: String(e) }; }
    _mmBusy = false;
    if (!res || !res.ok) {
      const err = res && res.error;
      if (err === "no_token") toast(t("gpxinspect.match_no_token", "Kein Mapbox-Token konfiguriert (siehe Einstellungen)."), "error", 3500);
      else toast(t("gpxinspect.route_failed", "Route konnte nicht berechnet werden: ") + (err || ""), "error", 3500);
      updateUI(); return;
    }
    const coords = res.coords || [];
    if (coords.length < 2 || res.matched === false) {
      toast(t("gpxinspect.route_nomatch", "Keine Route gefunden — A oder B liegt zu weit von einer Straße entfernt."), "warn", 3500);
      updateUI(); return;
    }
    // v0.9.315 — Schleifen-Schutz: Straßen sind legitim länger als die Luftlinie, aber
    // ein grober Umweg/eine Schleife (z. B. Mapbox routet über Ausfahrt+Kreisel zurück)
    // wird NICHT angewendet. Nutzer kann dann „Luftlinie" oder „Pfad zeichnen" nehmen.
    if (_routeIsDetour(coords, _haversine(A, B), 4.0)) {
      toast(t("gpxinspect.route_detour", "Die gefundene Route macht einen großen Umweg/eine Schleife — nicht angewendet. Nimm „Lücke füllen (Luftlinie)“ oder „Pfad zeichnen & füllen“."), "warn", 5000);
      updateUI(); return;
    }
    _pushUndo(t("gpxinspect.match_sel", "Strecke A→B"));
    _applyRoutedRange(_selA, _selB, coords);
    _dirty = true; clearSpikes(); clearSelection();
    renderAll(); updateUI();
    toast(t("gpxinspect.routed", "Strecke A→B auf die Straße gelegt: ") + coords.length + " " + t("gpxinspect.points", "Punkte"), "success", 2500);
  }
  // v0.9.315 — „Ganzen Track snappen" entschärft: überschreibt ALLE Punkte mit Mapbox-
  // Straßengeometrie (kann an Kreuzungen Umwege/Schleifen erzeugen). Bewusste 2-Klick-
  // Bestätigung statt stiller Ausführung. Für nur Lücken/Ausreißer → „Heilen" nutzen.
  let _matchWholeArm = 0;
  function matchWhole() {
    if (_points.length < 2) return;
    const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : 0;
    if (now - _matchWholeArm > 4000) {
      _matchWholeArm = now;
      toast(t("gpxinspect.match_all_warn", "Achtung: legt den GANZEN Track auf Mapbox-Straßen und überschreibt deine aufgezeichneten Punkte — an Kreuzungen können Umwege/Schleifen entstehen. Für nur Lücken/Ausreißer lieber „Heilen“. Zum Bestätigen nochmal klicken."), "warn", 4000);
      return;
    }
    _matchWholeArm = 0;
    _runMatch(0, _points.length - 1, t("gpxinspect.match_all", "Ganzen Track matchen"));
  }

  // ── Pfad zeichnen & füllen (v0.9.237) ────────────────────────────────────────
  function _setCursor(c) { try { if (map) map.getCanvas().style.cursor = c || ""; } catch (_) {} }
  function startDraw() {
    if (_selA === null || _selB === null || _selB <= _selA) return;
    _drawMode = true; _drawPts = [];
    _setCursor("crosshair");                 // Fadenkreuz fürs Punkte-Setzen
    renderDraw(); updateUI();
    toast(t("gpxinspect.draw_started", "Klick auf die Karte, um den Pfad zu zeichnen."), "info", 2500);
  }
  function onMapClickDraw(e) {
    if (!_drawMode) return;
    _drawPts.push({ lat: e.lngLat.lat, lon: e.lngLat.lng });
    _setCursor("crosshair");                 // nach Klick wieder absichern
    renderDraw(); updateUI();
  }
  function undoDrawPoint() { if (_drawPts.length) { _drawPts.pop(); renderDraw(); updateUI(); } }
  function cancelDraw() { _drawMode = false; _drawPts = []; _setCursor(""); renderDraw(); updateUI(); }
  function renderDraw() {
    if (!map) return;
    const A = (_selA != null) ? _points[_selA] : null;
    const B = (_selB != null) ? _points[_selB] : null;
    const path = (_drawMode && A && B) ? [A, ..._drawPts, B] : [];
    try { if (map.getSource("gpxi-draw")) map.getSource("gpxi-draw").setData({ type: "Feature", geometry: { type: "LineString", coordinates: path.map(p => [p.lon, p.lat]) } }); } catch (_) {}
    try {
      const feats = _drawMode ? _drawPts.map((p, i) => ({ type: "Feature", properties: { i }, geometry: { type: "Point", coordinates: [p.lon, p.lat] } })) : [];
      if (map.getSource("gpxi-draw-pts")) map.getSource("gpxi-draw-pts").setData({ type: "FeatureCollection", features: feats });
    } catch (_) {}
  }
  function applyDrawnPath() {
    if (!_drawMode || _selA === null || _selB === null || _selB <= _selA) return;
    const A = _points[_selA], B = _points[_selB];
    const path = [A, ..._drawPts, B];
    // Kumulative Distanzen entlang des gezeichneten Pfads.
    const cum = [0];
    for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + _haversine(path[i - 1], path[i]));
    const total = cum[cum.length - 1];
    if (total <= 0) { cancelDraw(); return; }
    let spacing = parseFloat((document.getElementById("gpxi-spacing") || {}).value) || 20;
    spacing = Math.max(2, Math.min(500, spacing));
    const n = Math.max(1, Math.min(5000, Math.round(total / spacing) - 1));
    _pushUndo(t("gpxinspect.drawfill", "Pfad füllen"));
    const tA = A.time ? Date.parse(A.time) : null, tB = B.time ? Date.parse(B.time) : null;
    const inserted = [];
    let seg = 0;
    for (let k = 1; k <= n; k++) {
      const d = total * k / (n + 1);
      while (seg < cum.length - 2 && cum[seg + 1] < d) seg++;
      const segLen = cum[seg + 1] - cum[seg];
      const tt = segLen <= 0 ? 0 : (d - cum[seg]) / segLen;
      const a = path[seg], b = path[seg + 1];
      const frac = d / total;   // Höhe + Zeit linear A→B über die Pfad-Distanz
      inserted.push({
        lat: a.lat + (b.lat - a.lat) * tt,
        lon: a.lon + (b.lon - a.lon) * tt,
        ele: (A.ele != null && B.ele != null) ? (A.ele + (B.ele - A.ele) * frac) : (A.ele != null ? A.ele : null),
        time: (tA != null && tB != null) ? new Date(tA + (tB - tA) * frac).toISOString() : null,
      });
    }
    _points.splice(_selA + 1, (_selB - _selA - 1), ...inserted);
    _dirty = true;
    _drawMode = false; _drawPts = [];
    clearSpikes();
    clearSelection();           // ruft renderPoints + updateUI
    renderDraw();               // Zeichen-Layer leeren
    renderAll();
    toast(t("gpxinspect.drawfilled", "Pfad aufgefüllt: ") + inserted.length + " " + t("gpxinspect.points", "Punkte"), "success", 2400);
  }

  // Einzelnen ausgewählten Punkt (Anker A, ohne B) löschen. (v0.9.241)
  function deletePoint() {
    if (_selA === null || _selB !== null) return;
    if (_points.length <= 2) { toast(t("gpxinspect.too_few", "Zu wenige Punkte zum Löschen."), "warning", 2200); return; }
    _pushUndo(t("gpxinspect.delete_one", "Punkt löschen"));
    _points.splice(_selA, 1);
    _dirty = true; clearSpikes(); clearSelection();
    renderAll(); updateUI();
    toast(t("gpxinspect.deleted", "Punkte gelöscht: ") + 1, "success", 1600);
  }

  function deleteBetween() {
    if (_selA === null || _selB === null || _selB <= _selA + 1) return;
    _pushUndo(t("gpxinspect.delete", "Punkte löschen"));
    const cnt = _selB - _selA - 1;
    _points.splice(_selA + 1, cnt);
    _dirty = true; clearSpikes(); clearSelection();
    renderAll(); updateUI();
    toast(t("gpxinspect.deleted", "Punkte gelöscht: ") + cnt, "success", 1800);
  }

  // Track am ausgewählten Punkt (Anker A, ohne B) kappen (v0.9.320, §15.1).
  // trimBefore: alles VOR A weg → A wird neuer Startpunkt (z. B. Anfahrt rausschneiden).
  // trimAfter:  alles NACH A weg → A wird neues Ende (z. B. vergessenes Stoppen am Ende).
  function trimBefore() {
    if (_selA === null || _selB !== null) return;
    if (_selA < 1) { toast(t("gpxinspect.trim_noop", "Hier gibt es nichts abzuschneiden."), "warning", 2000); return; }
    const cnt = _selA;
    _pushUndo(t("gpxinspect.trim_before", "Anfang abschneiden"));
    _points.splice(0, cnt);
    _dirty = true; clearSpikes(); clearSelection();
    renderAll(); updateUI();
    toast(t("gpxinspect.deleted", "Punkte gelöscht: ") + cnt, "success", 1800);
  }
  function trimAfter() {
    if (_selA === null || _selB !== null) return;
    if (_selA > _points.length - 2) { toast(t("gpxinspect.trim_noop", "Hier gibt es nichts abzuschneiden."), "warning", 2000); return; }
    const cnt = _points.length - _selA - 1;
    _pushUndo(t("gpxinspect.trim_after", "Ende abschneiden"));
    _points.splice(_selA + 1, cnt);
    _dirty = true; clearSpikes(); clearSelection();
    renderAll(); updateUI();
    toast(t("gpxinspect.deleted", "Punkte gelöscht: ") + cnt, "success", 1800);
  }

  // ── Auto-Despike (v0.9.239) ──────────────────────────────────────────────────
  // Findet GPS-Ausreißer: Punkte, die weit wegspringen UND wieder zurückkommen
  // (Umweg über die Sehne A→C). Geometrisch robust (kein Zeitstempel nötig);
  // wenn Zeit da ist, zusätzlich Geschwindigkeits-Gate gegen Falsch-Positive bei
  // echten scharfen Kurven. Echte Lücken (langer gerader Sprung ohne Rückkehr)
  // werden NICHT markiert — der Umweg ist dort ~0.
  function detectSpikes() {
    const P = _points, n = P.length;
    if (n < 3) return [];
    const seg = new Array(n - 1);
    for (let i = 0; i < n - 1; i++) seg[i] = _haversine(P[i], P[i + 1]);
    const sorted = [...seg].sort((a, b) => a - b);
    const medSeg = sorted[Math.floor(sorted.length / 2)] || 0;
    const haveTime = _hasTime && P.every(p => p.time);
    // Empfindlichkeit 1..10 (Slider) → Schwellen. 1 = nur krasse Sprünge,
    // 10 = auch kleine Zacken. lerp über den Slider-Bereich.
    const sens = Math.max(1, Math.min(10, parseFloat((document.getElementById("gpxi-sens") || {}).value) || 5));
    const lerp = (a, b) => a + (b - a) * (sens - 1) / 9;
    const SPIKE_FACTOR = lerp(12, 2);              // Vielfaches des mittleren Punktabstands
    const FLOOR = lerp(120, 15);                    // Mindest-Sprungweite in m
    const ABS_JUMP = Math.max(FLOOR, medSeg * SPIKE_FACTOR);
    const SPEED_CAP = lerp(120, 25);               // m/s; 120≈432 km/h … 25≈90 km/h
    // 29.08.2026 (Marcs Masca-Spikes, live seziert): Sekündliche Aufzeichnung
    // macht Spikes KURZ (13–15 m) — die Sprungweiten-Regel greift nie. Was sie
    // verrät, ist ihr TEMPO relativ zur Tour: 13-facher Median bei einer
    // Wanderung ist unmöglich. Median-relativ bleibt es aktivitäts-neutral
    // (Radfahren hat höheren Median → höhere Schwelle), das absolute Minimum
    // (15 km/h) schützt normales Gehen vor Fehlalarmen.
    let medSpeed = 0;
    if (haveTime) {
      const vs = [];
      for (let i = 0; i < n - 1; i++) {
        const dt = (Date.parse(P[i + 1].time) - Date.parse(P[i].time)) / 1000;
        if (dt > 0) vs.push(seg[i] / dt);
      }
      vs.sort((a, b) => a - b);
      medSpeed = vs.length ? vs[Math.floor(vs.length / 2)] : 0;
    }
    // Kurve an Marcs Masca-Track geeicht: Median 1,34 m/s, Spikes 12,6–15,5 m/s
    // (≈ 9–12× Median). lerp(12, 3): Standard (5) fängt ab ~8× Median, die
    // niedrigste Stufe bleibt bei 12× konservativ.
    const REL_SPEED = lerp(12, 3);                 // Vielfaches des Median-Tempos
    const SPEED_THR = medSpeed > 0 ? Math.max(4.2, medSpeed * REL_SPEED) : Infinity;
    const flags = new Array(n).fill(false);
    for (let i = 1; i < n - 1; i++) {
      const inD = seg[i - 1], outD = seg[i];
      const chord = _haversine(P[i - 1], P[i + 1]);
      const detour = inD + outD - chord;           // wie weit der Punkt aus der Sehne ragt
      const bigJump = (inD > ABS_JUMP || outD > ABS_JUMP);
      const returns = detour > ABS_JUMP * 0.8;     // springt raus UND zurück
      let speedBad = true;
      let vIn = 0, vOut = 0;
      if (haveTime) {
        const dtIn = (Date.parse(P[i].time) - Date.parse(P[i - 1].time)) / 1000;
        const dtOut = (Date.parse(P[i + 1].time) - Date.parse(P[i].time)) / 1000;
        vIn = dtIn > 0 ? inD / dtIn : Infinity;
        vOut = dtOut > 0 ? outD / dtOut : Infinity;
        speedBad = (vIn > SPEED_CAP || vOut > SPEED_CAP);
      }
      if (bigJump && returns && speedBad) flags[i] = true;
      else if (haveTime && (vIn > SPEED_THR || vOut > SPEED_THR)) flags[i] = true;
    }
    // Aufeinanderfolgende markierte Punkte zu einer Ausreißer-Gruppe zusammenfassen.
    const groups = [];
    let i = 0;
    while (i < n) {
      if (flags[i]) {
        let j = i; while (j + 1 < n && flags[j + 1]) j++;
        const a = i - 1, b = j + 1;
        if (a >= 0 && b < n) groups.push({ a, b, from: i, to: j });
        i = j + 1;
      } else i++;
    }
    return groups;
  }

  function clearSpikes() {
    _spikes = []; _spikeSet = new Set(); _spikeIdx = -1; _despikeRan = false;
    _gaps = []; try { renderGaps(); } catch (_) {}
  }

  // v0.9.294 — Lücken erkennen: ungewöhnlich lange Segmente (GPS-Dropouts), die KEINE
  // Ausreißer sind. Baseline = unteres Perzentil der Abstände (robust, auch wenn der
  // Track viele Lücken hat). Schwelle skaliert mit dem Empfindlichkeits-Slider.
  function detectGaps() {
    const P = _points, n = P.length;
    if (n < 2) return [];
    // v0.9.299 — Lücke = Segment, das DEUTLICH länger ist als der typische Punktabstand
    // des Tracks (= sichtbares Loch, egal wie groß). Robust über den Median, und die
    // Schwelle ist an den FÜLL-Abstand gekoppelt: ein Loch muss deutlich größer sein als
    // die Punkte, mit denen wir füllen — sonst hätte Füllen keinen Effekt und das geheilte
    // Stück würde sofort wieder als Loch zählen. So bleibt nach „Heilen" nichts übrig.
    const seg = new Array(n - 1);
    for (let i = 0; i < n - 1; i++) seg[i] = _haversine(P[i], P[i + 1]);
    const sd = [...seg].sort((a, b) => a - b);
    const median = sd[Math.floor(sd.length / 2)] || sd[0] || 0;   // typischer Abstand (Abtast-Kadenz)
    const spacing = _gapSpacing();
    const sens = Math.max(1, Math.min(10, parseFloat((document.getElementById("gpxi-sens") || {}).value) || 5));
    const lerp = (a, b) => a + (b - a) * (sens - 1) / 9;
    // Empfindlich: niedrig = nur große Löcher, hoch = auch kleine Abweichungen vom Takt.
    const distTH = Math.max(spacing * lerp(2.5, 1.6), median * lerp(3.5, 1.8));
    const gaps = [];
    for (let i = 0; i < n - 1; i++) {
      if (seg[i] > distTH && !_spikeSet.has(i) && !_spikeSet.has(i + 1)) {
        gaps.push({ a: i, b: i + 1, dist: seg[i] });
      }
    }
    return gaps;
  }
  // Wie viele Punkte würden in eine Lücke eingefügt (für Vorschau-Zähler + Anwenden).
  function _gapFillCount(dist, spacing) {
    return Math.max(1, Math.min(2000, Math.round(dist / spacing) - 1));
  }
  function _gapSpacing() {
    let s = parseFloat((document.getElementById("gpxi-spacing") || {}).value) || 20;
    return Math.max(2, Math.min(500, s));
  }
  // Vorschau der Lücken-Füllung auf die Karte (gestrichelte Linie + Geister-Punkte).
  function renderGaps() {
    if (!map || !map.getSource("gpxi-gapfill")) return;
    const lines = [], ghosts = [];
    const spacing = _gapSpacing();
    let ghostBudget = 600;   // Geister-Punkte gesamt begrenzen (Performance)
    for (const g of _gaps) {
      const A = _points[g.a], B = _points[g.b];
      if (!A || !B) continue;
      lines.push([[A.lon, A.lat], [B.lon, B.lat]]);
      if (ghostBudget > 0) {
        const n = Math.min(_gapFillCount(g.dist, spacing), ghostBudget, 120);
        for (let k = 1; k <= n; k++) {
          const tt = k / (n + 1);
          ghosts.push({ type: "Feature", geometry: { type: "Point", coordinates: [A.lon + (B.lon - A.lon) * tt, A.lat + (B.lat - A.lat) * tt] } });
        }
        ghostBudget -= n;
      }
    }
    try {
      map.getSource("gpxi-gapfill").setData(lines.length
        ? { type: "Feature", geometry: { type: "MultiLineString", coordinates: lines } }
        : { type: "Feature", geometry: { type: "LineString", coordinates: [] } });
      map.getSource("gpxi-gapfill-pts").setData({ type: "FeatureCollection", features: ghosts });
    } catch (_) {}
  }

  // v0.9.302 — EIN „Heilen" (Automatik), gesteuert über Bereich (ganzer Track / Abschnitt
  // A→B) + Checkboxen: Ausreißer glätten · Lücken füllen (optional an Wege anpassen) ·
  // ganzen Track snappen (nur Bereich = Track).
  function _healScope() {
    return ((document.getElementById("gpxi-scope-ab") || {}).checked) ? "ab" : "track";
  }
  async function runHeal() {
    if (_drawMode || !_points.length || _mmBusy) return;
    const scope = _healScope();
    const doSpikes = !!((document.getElementById("gpxi-heal-spikes") || {}).checked);
    const doGaps = !!((document.getElementById("gpxi-heal-gaps") || {}).checked);
    if (!doSpikes && !doGaps) {
      toast(t("gpxinspect.heal_nothing_sel", "Nichts ausgewählt — hak an, was geheilt werden soll."), "info", 2800);
      return;
    }
    let lo = 0, hi = _points.length - 1;
    if (scope === "ab") {
      if (_selA === null || _selB === null || _selB <= _selA) {
        toast(t("gpxinspect.heal_need_ab", "Bereich „Abschnitt A→B“: erst zwei Punkte auf der Karte setzen (A grün, B rot)."), "warn", 3600);
        return;
      }
      lo = _selA; hi = _selB;
    }
    // 1) Ausreißer glätten + Lücken füllen (je nach Checkbox, evtl. nur im Bereich).
    if (doSpikes || doGaps) {
      let groups = doSpikes ? detectSpikes() : [];
      if (scope === "ab") groups = groups.filter((g) => g.from >= lo && g.to <= hi);
      _spikes = groups; _spikeIdx = -1;
      _spikeSet = new Set();
      for (const g of groups) for (let k = g.from; k <= g.to; k++) _spikeSet.add(k);
      let gaps = doGaps ? detectGaps() : [];
      if (scope === "ab") gaps = gaps.filter((g) => g.a >= lo && g.b <= hi);
      _gaps = gaps;
      _selA = _selB = null;
      if (_spikes.length || _gaps.length) {
        merkeVorher();           // 29.08.2026 — für den Vorher/Nachher-Vergleich
        await healAllSpikes();   // füllt Lücken laut Profil (Luftlinie oder Route)
        zeigeVorherNachher();
      } else if ((document.getElementById("gpxi-heal-tempo") || {}).checked) {
        // v0.9.621 (Abnahme-Befund): Tempo-Entzerren lief nur als Anhängsel
        // von healAllSpikes — ein sauberer Track mit reinem Tempo-Problem
        // (z. B. gesetzter Deckel) bekam „Nichts zu heilen". Eigener Schritt.
        merkeVorher();
        _pushUndo(t("gpxinspect.heal", "Heilen"));
        const nT = tempoEntzerren();
        if (nT) {
          _dirty = true; renderAll(); updateUI(); zeigeVorherNachher();
          toast(t("gpxinspect.heal_tempo_done", "%t Tempo-Stellen entzerrt")
            .replace("%t", nT), "success", 3200);
        } else {
          toast(t("gpxinspect.heal_none", "Nichts zu heilen gefunden 👍"), "info", 2800);
        }
      } else {
        toast(t("gpxinspect.heal_none", "Nichts zu heilen gefunden 👍"), "info", 2800);
      }
    }
    // Übersicht: ganzen Track zeigen.
    try { map.fitBounds(_trackBounds(), { padding: 50, duration: 600 }); } catch (_) {}
  }
  function _zoomToGap(k) {
    const g = _gaps[k]; if (!g || !map) return;
    const A = _points[g.a], B = _points[g.b];
    // 11.09.2026 (Tester-Log: „undefined is not an object (evaluating 'A.lat')"): nach
    // Heilen/Löschen zeigt die Lückenliste noch auf alte Indizes → kein Sprung statt Fehler.
    if (!A || !B) { if (window.applog) window.applog("warn", `[gpxinspect] Lücke ${k}: Punkte ${g.a}/${g.b} nicht mehr vorhanden (n=${_points.length})`); return; }
    try {
      map.fitBounds([[Math.min(A.lon, B.lon), Math.min(A.lat, B.lat)], [Math.max(A.lon, B.lon), Math.max(A.lat, B.lat)]],
        { padding: 120, duration: 500, maxZoom: 17 });
    } catch (_) {}
  }

  function gotoSpike(k) {
    if (!_spikes.length) return;
    _spikeIdx = Math.max(0, Math.min(_spikes.length - 1, k));
    const g = _spikes[_spikeIdx];
    _selA = g.a; _selB = g.b;
    renderPoints();
    // Auf die Ausreißer-Region zoomen (Anker + dazwischen).
    try {
      let mnLon = Infinity, mnLat = Infinity, mxLon = -Infinity, mxLat = -Infinity;
      for (let k2 = g.a; k2 <= g.b; k2++) {
        const p = _points[k2];
        if (p.lon < mnLon) mnLon = p.lon; if (p.lon > mxLon) mxLon = p.lon;
        if (p.lat < mnLat) mnLat = p.lat; if (p.lat > mxLat) mxLat = p.lat;
      }
      map.fitBounds([[mnLon, mnLat], [mxLon, mxLat]], { padding: 120, duration: 500, maxZoom: 18 });
    } catch (_) {}
    updateUI();
  }

  // 08.09.2026 (Marc: „wenn ich auf Heilen klicke, gehe ich davon aus, dass so was alles
  // glattgezogen wird"): Zeiten, Doppelpunkte, Nullkoordinaten, fehlende Höhen über die Brücke
  // (core/gpxheal) — vor Ausreißern und Lücken. Bericht kommt als Schlüssel + Zahl.
  const _HEAL_KEYS = {
    no_coords: ["gpxinspect.heal_k_no_coords", "%n Punkte ohne Koordinaten entfernt"],
    duplicates: ["gpxinspect.heal_k_duplicates", "%n Doppelpunkte entfernt"],
    spread_seconds: ["gpxinspect.heal_k_spread", "%n mehrfach belegte Sekunden verteilt"],
    backwards: ["gpxinspect.heal_k_backwards", "%n Zeit-Rücksprünge geglättet"],
    missing_time: ["gpxinspect.heal_k_missing_time", "%n fehlende Zeiten ergänzt"],
    outliers: ["gpxinspect.heal_k_outliers", "%n Tempo-Ausreißer entfernt"],
    missing_ele: ["gpxinspect.heal_k_missing_ele", "%n fehlende Höhen ergänzt"],
    cold_start: ["gpxinspect.heal_k_cold_start", "%n Kaltstart-Punkte verworfen"],
    spikes: ["gpxinspect.heal_k_spikes", "%n Sprünge geradegerückt"],
    tempo: ["gpxinspect.heal_k_tempo", "%n Tempo-Stellen entzerrt"],
    gaps: ["gpxinspect.heal_k_gaps", "%n Lücken gefüllt"],
    standstill: ["gpxinspect.heal_k_standstill", "%n Standdrift-Stellen zusammengezogen"],
    ele_garbage: ["gpxinspect.heal_k_ele_garbage", "%n Höhen-Müll-Werte ersetzt"],
  };
  // 08.09.2026 (Marc: „ein Analysieren-Knopf schlägt vor, was man glattziehen könnte, und man hakt
  // an, was gemacht wird"): nach dem Laden einmal prüfen, Funde als Häkchen zeigen.
  let _healFunde = [];
  // 10.09.2026 — Track-Check (docs/TRACK-CHECK.md): beim Öffnen prüfen (core/trackcheck,
  // dieselben Schwellen wie Archiv und Heilen), Befund-Kasten oben. Ohne Archiv-Zeile
  // gibt es kein „Ist so in Ordnung" — die Abwahl hängt an der Version im Archiv.
  // 12.09.2026 — „uebersetzen" (Fähre, Flug, Autozug) bekommt bewusst KEIN Häkchen:
  // daran ist nichts zu reparieren, die Strecke wurde wirklich zurückgelegt.
  const _TC_OHNE_SCHRITT = { clock_off: "retime", no_time: "timeline", local_time: "",
                             xml_broken: "", uebersetzen: "" };
  // 13.09.2026 (Q3, Marc): Eigenheiten der Aufzeichnung — kein Fehler des Nutzers.
  // Grau, ohne Häkchen, und beim Reparieren still mit bereinigt.
  const _TC_STILL = { duplicates: true, spread_seconds: true };
  // 12.09.2026 (Marc: „klar und deutlich gekennzeichnet, was er als fehler erkennt und
  // wie er es reparieren würde"): je Befund-Art ein Satz, was die Reparatur TUT. Steht
  // unter der Befund-Zeile, damit niemand raten muss, was ein Häkchen auslöst.
  const _TC_REPARATUR = {
    spikes: ["trackcheck.rep_spikes", "Reparatur: Der ausgerissene Punkt wandert zurück auf die Linie zwischen seinen Nachbarn."],
    cold_start: ["trackcheck.rep_cold_start", "Reparatur: Die ersten Punkte vor dem ersten echten Empfang werden entfernt."],
    ele_garbage: ["trackcheck.rep_ele_garbage", "Reparatur: Unmögliche Höhenwerte werden aus den Nachbarn neu berechnet."],
    gaps: ["trackcheck.rep_gaps", "Reparatur: Die Lücke wird gefüllt — entlang echter Wege, wenn ein Profil gewählt ist, sonst geradlinig."],
    gaps_klein: ["trackcheck.rep_gaps_klein", "Reparatur: Die kleine Lücke wird gefüllt — wie eine große, nur ohne Alarm: unter einer Minute fehlender Bewegung."],
    missing_ele: ["trackcheck.rep_missing_ele", "Reparatur: Fehlende Höhen werden aus den Nachbarpunkten ergänzt."],
    tempo: ["trackcheck.rep_tempo", "Reparatur: Nicht die Strecke, nur die Zeit wird entzerrt — der Track bleibt, wo er ist."],
    backwards: ["trackcheck.rep_backwards", "Reparatur: Rückwärts laufende Zeitstempel werden aufsteigend geradegezogen."],
    duplicates: ["trackcheck.rep_duplicates", "Reparatur: Doppelte Punkte an derselben Stelle werden zu einem zusammengefasst."],
    spread_seconds: ["trackcheck.rep_spread_seconds", "Reparatur: Mehrfach belegte Sekunden werden gleichmäßig über die Sekunde verteilt."],
    standstill: ["trackcheck.rep_standstill", "Reparatur: Das Gezitter im Stand wird auf einen Punkt zusammengezogen."],
  };

  /** Die Fundstellen einer Befund-Art auf der Karte markieren und der Reihe nach
   *  anspringen. Zweiter Klick = nächste Stelle. */
  function trackCheckZeigen(key) {
    const b = ((_tc && _tc.befunde) || []).find((x) => x.key === key);
    const stellen = (b && b.stellen) || [];
    if (!stellen.length) {
      toast(t("trackcheck.keine_stellen", "Für diesen Befund gibt es keine einzelne Stelle."), "info", 2500);
      return;
    }
    if (_tcZeigeKey !== key) { _tcZeigeKey = key; _tcZeigeIdx = -1; _tcMarkiert = new Set(stellen); }
    _tcZeigeIdx = (_tcZeigeIdx + 1) % stellen.length;
    const i = Math.max(0, Math.min(_points.length - 1, stellen[_tcZeigeIdx]));
    const p = _points[i];
    renderPoints();
    if (p && map) {
      try { map.easeTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 15), duration: 700 }); } catch (_) {}
    }
    toast(t("trackcheck.stelle_von", "Stelle {i} von {n}").replace("{i}", _tcZeigeIdx + 1)
      .replace("{n}", stellen.length) + ((b && b.stellen_gekappt) ? " +" : ""), "info", 1800);
  }

  function trackCheckMarkierungWeg() {
    if (!_tcMarkiert.size) return;
    _tcMarkiert = new Set(); _tcZeigeKey = ""; _tcZeigeIdx = -1;
    renderPoints();
  }

  async function analyseTrack() {
    const box = document.getElementById("gpxi-heal-analysis");
    if (!box) return;
    if (!_points || _points.length < 3) { box.hidden = true; box.innerHTML = ""; _healFunde = []; _tc = null; return; }
    let r = null;
    try { r = await rzWarten("gpxinspect_track_check", () => api().gpxinspect_track_check(_points, _origPath || "", _localTimeN || 0)); } catch (e) { r = null; }
    if (isUnmounted) return;
    if (!r || !r.ok) { box.hidden = true; box.innerHTML = ""; _healFunde = []; _tc = null; return; }
    _tc = r;
    try { if (_lb) _lbStrahlRender(); } catch (_) {}   // Logbuch Stufe 4: Befunde-Spur
    try { _profilAusArt(r.activity); } catch (_) {}
    _healFunde = (r.befunde || []).filter((b) => !(b.key in _TC_OHNE_SCHRITT)).map((b) => ({ key: b.key, n: b.n }));
    const kurz = (typeof rzTrackCheckKurz === "function") ? rzTrackCheckKurz(r.befunde, 4) : "";
    const zeile = (typeof rzTrackCheckZeile === "function") ? rzTrackCheckZeile : (b) => b.key + " " + b.n;
    const stufeTxt = (typeof rzTrackCheckStufeText === "function") ? rzTrackCheckStufeText : () => "";
    const okKnopf = (k) => r.im_archiv
      ? `<button type="button" class="gpxi-tc-ok" data-tc-ok="${k}" title="${t("trackcheck.btn_ok_tip", "Diese Befund-Art bei dieser Tour nicht mehr melden — weder auf der Kachel noch beim Laden.")}">${t("trackcheck.btn_ok", "Ist so in Ordnung")}</button>` : "";
    const rows = (r.befunde || []).map((b) => {
      if (_TC_STILL[b.key]) {
        return `<div class="gpxi-tc-row is-grau"><span class="gpxi-tc-dot"></span><span class="gpxi-tc-txt">${zeile(b)} <span class="gpxi-tc-stufe">${t("trackcheck.still_hinweis", "Eigenheit der Aufzeichnung — wird beim Reparieren mitbereinigt")}</span></span>${okKnopf(b.key)}</div>`;
      }
      const ohne = _TC_OHNE_SCHRITT[b.key];
      if (ohne !== undefined) {
        const sprung = ohne === "retime" ? `<button type="button" class="gpxi-tc-ok" data-tc-goto="retime">${t("trackcheck.goto_retime", "Zeiten setzen")}</button>`
          : ohne === "timeline" ? `<button type="button" class="gpxi-tc-ok" data-tc-goto="timeline">${t("trackcheck.goto_timeline", "Zeitachse erzeugen")}</button>` : "";
        const erklaerung = b.key === "uebersetzen"
          ? ` <span class="gpxi-tc-stufe">${t("trackcheck.uebersetzen_hinweis", "Fähre, Flug oder Autozug: Die Strecke wurde wirklich zurückgelegt, nur ohne Aufzeichnung. Daran wird nichts repariert.")}</span>` : "";
        const zeigen2 = (b.stellen && b.stellen.length)
          ? `<button type="button" class="gpxi-tc-ok" data-tc-zeig="${b.key}">${t("trackcheck.btn_zeigen", "Zeigen")}</button>` : "";
        return `<div class="gpxi-tc-row is-${b.stufe}"><span class="gpxi-tc-dot"></span><span class="gpxi-tc-txt">${zeile(b)}${erklaerung}</span>${zeigen2}${sprung}${okKnopf(b.key)}</div>`;
      }
      const rep = _TC_REPARATUR[b.key];
      const repTxt = rep ? `<span class="gpxi-tc-rep">${t(rep[0], rep[1])}</span>` : "";
      const zeigen = (b.stellen && b.stellen.length)
        ? `<button type="button" class="gpxi-tc-ok" data-tc-zeig="${b.key}" title="${t("trackcheck.btn_zeigen_tip", "Die Fundstellen auf der Karte markieren und der Reihe nach anspringen.")}">${t("trackcheck.btn_zeigen", "Zeigen")}</button>` : "";
      return `<label class="gpxi-tc-row is-${b.stufe}"><input type="checkbox" data-heal="${b.key}"${b.stufe === "grau" ? "" : " checked"}><span class="gpxi-tc-dot"></span><span class="gpxi-tc-txt">${zeile(b)} <span class="gpxi-tc-stufe">${stufeTxt(b.stufe)}</span>${repTxt}</span>${zeigen}${okKnopf(b.key)}</label>`;
    }).join("");
    const abgew = (r.abgewaehlt || []).map((b) => `<div class="gpxi-tc-row is-grau"><span class="gpxi-tc-txt">${zeile(b)}</span><button type="button" class="gpxi-tc-ok" data-tc-show="${b.key}">${t("trackcheck.btn_show_again", "wieder anzeigen")}</button></div>`).join("");
    const hatSchritt = _healFunde.length > 0;
    box.innerHTML = `<div class="gpxi-tc-title is-${r.marke || (r.hoechste || "leer")}"><span class="gpxi-tc-dot"></span>${
        (r.befunde || []).length ? t("trackcheck.title", "Track-Check") + ": " + kurz : t("trackcheck.inspector_none", "Track-Check: nichts gefunden 👍")}</div>`
      + rows
      + (abgew ? `<div class="gpxi-tc-hidden">${abgew}</div>` : "")
      + (hatSchritt ? `<div class="gpxi-tc-actions"><button class="btn btn-primary btn-sm" id="gpxi-tc-repair" title="${t("trackcheck.repair_hint", "Repariert nur, was angehakt ist. Vorher/Nachher erscheint unten, Rückgängig geht jederzeit.")}">${t("trackcheck.repair_btn", "🩹 Reparieren")}</button></div>` : "");
    box.hidden = !(r.befunde || []).length && !abgew;
    const rep = document.getElementById("gpxi-tc-repair");
    if (rep) rep.onclick = trackCheckReparieren;
    box.querySelectorAll("[data-tc-zeig]").forEach((b) => b.onclick = (ev) => {
      ev.preventDefault(); ev.stopPropagation();   // nicht das Häkchen umschalten
      trackCheckZeigen(b.dataset.tcZeig);
    });
    box.querySelectorAll("[data-tc-ok]").forEach((b) => b.onclick = () => trackCheckOk(b.dataset.tcOk, true));
    box.querySelectorAll("[data-tc-show]").forEach((b) => b.onclick = () => trackCheckOk(b.dataset.tcShow, false));
    box.querySelectorAll("[data-tc-goto]").forEach((b) => b.onclick = () => {
      const ziel = b.dataset.tcGoto === "retime" ? "gpxi-wz-retime-run" : "gpxi-speedrow";
      const sec = document.querySelector('.gpxi-sec[data-sec="bearbeiten"]'); if (sec) sec.open = true;
      const el = document.getElementById(ziel); if (el) { try { el.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (_) {} }
    });
  }
  /** Pause ≥ 2 min mit ≤ 100 m Versatz (Wirtshaus) — im Kern kein Befund, hier auch nicht füllen. */
  function _istPauseLuecke(g) {
    const A = _points[g.a], B = _points[g.b];
    if (!A || !B || !A.time || !B.time) return false;
    const dt = (Date.parse(B.time) - Date.parse(A.time)) / 1000;
    return dt >= 120 && g.dist <= 100;
  }
  /** Profil aus der Fortbewegungsart der Archiv-Tour vorbelegen (schlägt die Tempo-Schätzung,
   *  nie die Handwahl). Ohne passende Art bleibt, was profilVorschlagen gewählt hat. */
  function _profilAusArt(art) {
    if (_profilManuell || !art) return;
    const sel = document.getElementById("gpxi-profile"); if (!sel) return;
    const a = String(art).toLowerCase();
    const wahl = /wander|spazier|lauf|hiking|walk|run|trail/.test(a) ? "walking"
      : /rad|bike|cycl|gravel|mtb|velo/.test(a) ? "cycling"
      : /auto|motor|car|driv|moped/.test(a) ? "driving" : "";
    if (wahl) sel.value = wahl;
  }
  async function trackCheckOk(key, ok) {
    if (!_origPath) return;
    let r; try { r = await api().library_track_check_ok(_origPath, key, !!ok); } catch (e) { r = { ok: false, error: String(e) }; }
    if (!r || !r.ok) { toast(t("trackcheck.error", "Track-Check nicht möglich: {e}").replace("{e}", (r && r.error) || "?"), "error"); return; }
    try { await analyseTrack(); } catch (_) {}
  }
  // Reparieren = die angehakten Schritte über core/gpxheal, alles andere bleibt. Undo,
  // Vorher/Nachher und Neuprüfung wie beim Heilen (Marc: Undo für alles).
  async function trackCheckReparieren(nurKeys) {
    const box = document.getElementById("gpxi-heal-analysis");
    if (!box || _mmBusy || _drawMode) return;
    // 13.09.2026 (Marc: Befund auf der Karte „gleich die Frage reparieren") — nur diese Art
    let schritte = Array.isArray(nurKeys) ? nurKeys.slice()
      : [...box.querySelectorAll("input[data-heal]")].filter((c) => c.checked).map((c) => c.getAttribute("data-heal"));
    if (!schritte.length) { toast(t("trackcheck.nothing_selected", "Nichts angehakt — nichts zu reparieren."), "info", 2400); return; }
    for (const b of ((_tc && _tc.befunde) || [])) {
      if (_TC_STILL[b.key] && schritte.indexOf(b.key) < 0) schritte.push(b.key);
    }
    const aktivitaet = (_tc && _tc.activity) || "";
    // 10.09.2026 (Marc: „wäre nicht besser anhand der Fortbewegungsart die Karte zu nutzen?"):
    // Lücken laufen über das Profil aus „Lücken füllen als" — Wege statt Luftlinie. Der Kern
    // füllt dann nicht, die Lücken werden nach den anderen Schritten hier geroutet.
    const fillMode = (document.getElementById("gpxi-profile") || {}).value || "linear";
    const mitKlein = schritte.indexOf("gaps_klein") >= 0;
    const lueckenRouten = (schritte.indexOf("gaps") >= 0 || mitKlein) && fillMode !== "linear";
    const nurKlein = mitKlein && schritte.indexOf("gaps") < 0;
    if (lueckenRouten) schritte = schritte.filter((k) => k !== "gaps" && k !== "gaps_klein");
    _pushUndo(t("trackcheck.repair", "Track-Check reparieren"));
    merkeVorher();
    let r = { ok: true, points: _points.slice(), bericht: [] };
    if (schritte.length) {
      try { r = await rzWarten("gpxinspect_heal", () => api().gpxinspect_heal(_points, 250, schritte, false, aktivitaet)); } catch (e) { r = { ok: false, error: String(e) }; }
    }
    if (isUnmounted) return;
    if (!r || !r.ok || !Array.isArray(r.points)) { toast(t("trackcheck.error", "Track-Check nicht möglich: {e}").replace("{e}", (r && r.error) || "?"), "error"); return; }
    const teile = (r.bericht || []).filter((b) => schritte.indexOf(b.key) >= 0).map((b) => { const k = _HEAL_KEYS[b.key]; return k ? t(k[0], k[1]).replace("%n", b.n) : (b.key + " " + b.n); });
    _points.length = 0; for (const p of r.points) _points.push(p);
    if (lueckenRouten) {
      // 13.09.2026 — dieselben Lücken wie im Kasten, aus dem Kern (fehlende Wegzeit je
      // Bewegungsart). Vorher suchte die Oberfläche selbst ab 100 m und füllte damit
      // andere Stellen, als der Track-Check gemeldet hatte.
      _spikeSet = new Set();
      let gaps = [];
      try {
        const lr = await rzWarten("gpxinspect_luecken", () => api().gpxinspect_luecken(_points, aktivitaet, mitKlein));
        gaps = ((lr && lr.luecken) || []).filter((g) => !nurKlein || g.stufe === "grau");
      } catch (_) { gaps = []; }
      if (isUnmounted) return;
      if (gaps.length) {
        const { routed, detour } = await _lueckenRouten(gaps, _gapSpacing(), fillMode);
        if (isUnmounted) return;
        teile.push(t("gpxinspect.heal_done_route_short", "%r Lücken an Wege angepasst, %l gerade gefüllt").replace("%r", routed).replace("%l", gaps.length - routed)
          + (detour ? " (" + detour + " " + t("gpxinspect.heal_detour", "Umwege verworfen") + ")" : ""));
      }
    }
    _dirty = true; clearSpikes(); trackCheckMarkierungWeg(); _selA = _selB = null;
    _hasTime = _points.length > 0 && _points.every(p => !!p.time);
    _eleInvalidate();
    renderAll(); updateUI(); zeigeVorherNachher();
    try { reduzierReglerSync(); } catch (_) {}
    try { _pfeileBerechnen(); _punktFormAnwenden(); renderPoints(); } catch (_) {}
    toast(t("trackcheck.repaired", "Repariert: {liste}").replace("{liste}", teile.join(" · ") || "—"), "success", 4500);
    try { await analyseTrack(); } catch (_) {}
    try { map.fitBounds(_trackBounds(), { padding: 50, duration: 600 }); } catch (_) {}
  }
  function _healSchritte() {
    const box = document.getElementById("gpxi-heal-analysis");
    if (!box || box.hidden) return null;   // keine Analyse → alles
    // Sprünge, Lücken und Tempo macht dieser Heil-Weg selbst (mit Routen-Profil und
    // Karten-Vorschau) — der Kern soll sie hier nicht vorwegnehmen.
    const selbst = ["spikes", "gaps", "tempo"];
    return [...box.querySelectorAll("input[data-heal]")].filter((c) => c.checked).map((c) => c.getAttribute("data-heal")).filter((k) => selbst.indexOf(k) < 0);
  }
  async function healTimesAndData() {
    if (!_points || _points.length < 3) return "";
    const schritte = _healSchritte();
    if (schritte && !schritte.length) return "";
    let r = null;
    try { r = await rzWarten("gpxinspect_heal", () => api().gpxinspect_heal(_points, 250, schritte, false, (_tc && _tc.activity) || "")); } catch (e) { r = { ok: false, error: String(e) }; }
    if (!r || !r.ok || !Array.isArray(r.points)) { try { applog("warn", "[gpxinspect] heilen (Brücke): " + (r && r.error)); } catch (_) {} return ""; }
    const teile = (r.bericht || []).filter((b) => !schritte || schritte.indexOf(b.key) >= 0).map((b) => { const k = _HEAL_KEYS[b.key]; return k ? t(k[0], k[1]).replace("%n", b.n) : (b.key + " " + b.n); });
    if (!teile.length) return "";
    _points.length = 0; for (const p of r.points) _points.push(p);
    _dirty = true;
    try { analyseTrack(); } catch (_) {}
    return teile.join(" · ");
  }
  async function healAllSpikes() {
    _pushUndo(t("gpxinspect.heal_all", "Auto-Heilen"));
    const _datenMsg = await healTimesAndData();
    if (_datenMsg) { try { detectSpikes && detectSpikes(); } catch (_) {} }
    if (!_spikes.length && !_gaps.length) {
      if (_datenMsg) { renderAll(); updateUI(); toast(t("gpxinspect.heal_done_data", "Geheilt: %d").replace("%d", _datenMsg), "success", 4500); }
      return;
    }
    // 1) Ausreißer geraderücken — verschiebt nur (kein Splice) → Indizes bleiben gültig.
    for (const g of _spikes) {
      const A = _points[g.a], B = _points[g.b], span = g.b - g.a;
      for (let k = g.a + 1; k < g.b; k++) {
        const tt = (k - g.a) / span;
        _points[k].lat = A.lat + (B.lat - A.lat) * tt;
        _points[k].lon = A.lon + (B.lon - A.lon) * tt;
        if (A.ele != null && B.ele != null) _points[k].ele = A.ele + (B.ele - A.ele) * tt;
        // Zeit bleibt → Geschwindigkeit korrigiert sich selbst.
      }
    }
    const nS = _spikes.length;
    const nG = _gaps.length;
    const spacing = _gapSpacing();
    // Füll-Art direkt aus dem Profil: 'linear' (Luftlinie) ODER walking/cycling/driving (Route).
    const fillMode = (document.getElementById("gpxi-profile") || {}).value || "linear";

    // 2) Lücken füllen — von HINTEN nach VORNE, damit Indizes gültig bleiben.
    if (fillMode !== "linear" && nG) {
      // Route-Modus: jede Lücke entlang echter Wege/Straßen (Profil) routen.
      const { routed, detour } = await _lueckenRouten(_gaps, spacing, fillMode);
      const nT = ((document.getElementById("gpxi-heal-tempo") || {}).checked) ? tempoEntzerren() : 0;
      _dirty = true; clearSpikes(); _selA = _selB = null;
      renderAll(); updateUI();
      const msg = t("gpxinspect.heal_done_route", "Geheilt: %s Ausreißer · %r Lücken an Route angepasst, %l gerade gefüllt")
        .replace("%s", nS).replace("%r", routed).replace("%l", nG - routed)
        + (_datenMsg ? " · " + _datenMsg : "")
        + (detour ? " (" + detour + " " + t("gpxinspect.heal_detour", "Umwege verworfen") + ")" : "")
        + (nT ? " · " + t("gpxinspect.heal_tempo_done", "%t Tempo-Stellen entzerrt").replace("%t", nT) : "");
      toast(msg, "success", 4000);
      return;
    }

    // Linear-Modus (Standard).
    let fillPts = 0;
    const gapsDesc = [..._gaps].sort((a, b) => b.a - a.a);
    for (const g of gapsDesc) fillPts += _linearFillGap(g, spacing);
    const nT = ((document.getElementById("gpxi-heal-tempo") || {}).checked) ? tempoEntzerren() : 0;
    _dirty = true; clearSpikes(); _selA = _selB = null;
    renderAll(); updateUI();
    toast(t("gpxinspect.heal_done", "Geheilt: %s Ausreißer, %g Lücken (+%p Punkte)")
      .replace("%s", nS).replace("%g", nG).replace("%p", fillPts)
      + (_datenMsg ? " · " + _datenMsg : "")
      + (nT ? " · " + t("gpxinspect.heal_tempo_done", "%t Tempo-Stellen entzerrt").replace("%t", nT) : ""), "success", 3200);
  }
  /** Lücken entlang echter Wege füllen (Profil walking/cycling/driving, OSRM/Mapbox); Umwege
   *  und unerreichbare Lücken werden gerade gefüllt. Ändert _points von hinten nach vorne.
   *  Gemeinsam für „Heilen (automatisch)" und „Reparieren" im Befund-Kasten (10.09.2026). */
  /** Typisches Tempo um einen Punkt herum (m/s) — für das Lücken-Profil je Abschnitt.
   *  12.09.2026 (IDEAS §63): In einer Womo-Reise mit Spaziergängen ist EIN Profil für
   *  den ganzen Track falsch. Gemessen wird lokal, nicht global. */
  function _tempoUm(idx, fenster) {
    const vs = [];
    const von = Math.max(0, idx - fenster), bis = Math.min(_points.length - 1, idx + fenster);
    for (let i = von; i < bis; i++) {
      const a = _points[i], b = _points[i + 1];
      if (!a || !b || !a.time || !b.time) continue;
      const dt = (new Date(b.time) - new Date(a.time)) / 1000;
      if (!(dt > 0) || dt > 600) continue;         // Pausen zählen nicht mit
      const d = _haversine(a, b);
      if (d > 0) vs.push(d / dt);
    }
    if (!vs.length) return 0;
    vs.sort((x, y) => x - y);
    return vs[Math.floor(vs.length / 2)];
  }
  /** Welches Routen-Profil passt HIER? Aus dem Tempo um die Lücke herum. */
  function _profilAusTempo(g) {
    const v = _tempoUm(g.a, 150);
    if (!v) return "";
    return v < 2.5 ? "walking" : (v < 7 ? "cycling" : "driving");   // 9 / 25 km/h
  }
  /** Ein Profil je Lücke — aber nur, wenn der Track wirklich gemischt ist.
   *
   *  12.09.2026: Die abschnittsweise Wahl ist für Mischtouren gedacht (Womo-Fahrt
   *  mit Spaziergängen). Bei einer gewöhnlichen Tour bleibt die Einstellung des
   *  Nutzers stehen — sie kommt aus „Lücken füllen als" oder aus der
   *  Fortbewegungsart im Archiv, und die weiß es besser als ein Tempo-Median
   *  (Schieben am Berg, Stau, Ampeln). Erst wenn die Lücken in VERSCHIEDENEN
   *  Tempo-Welten liegen, entscheidet das Tempo je Lücke.
   */
  function _profileFuerLuecken(gaps, fallback) {
    const geraten = gaps.map((g) => _profilAusTempo(g));
    const arten = new Set(geraten.filter(Boolean));
    if (_profilManuell || arten.size < 2) return gaps.map(() => fallback);
    return geraten.map((x) => x || fallback);
  }

  async function _lueckenRouten(gaps, spacing, fillMode) {
    const gapsAB = gaps.map((g) => [_points[g.a].lon, _points[g.a].lat, _points[g.b].lon, _points[g.b].lat]);
    const profile = _profileFuerLuecken(gaps, fillMode);
    _mmBusy = true; updateUI();
    const arten = [...new Set(profile)];
    toast(arten.length > 1
      ? t("gpxinspect.gap_routing_mix", "Suche Routen für %g Lücken — je Abschnitt passend (%a) …")
          .replace("%g", gaps.length).replace("%a", arten.join(", "))
      : t("gpxinspect.gap_routing", "Suche Routen für %g Lücken …").replace("%g", gaps.length), "info", 4000);
    if (window.rzStatus) {
      window.rzStatus.start("luecken-routen", {
        titel: t("gpxinspect.gap_routing_titel", "Lücken an Wege anpassen"),
        text: t("gpxinspect.gap_routing", "Suche Routen für %g Lücken …").replace("%g", gaps.length),
        // Kein Zähler: Die Brücke rechnet alle Lücken in einem Aufruf — ein „0 / 42 (0 %)",
        // das bis zum Ende stehen bleibt, sah nach Hänger aus (Echt-App-Test 13.09.2026).
      });
    }
    let res;
    try { res = await api().gpxinspect_route_gaps(gapsAB, profile); }
    catch (e) { res = { ok: false, error: String(e) }; }
    if (window.rzStatus) window.rzStatus.fertig("luecken-routen", "");
    _mmBusy = false;
    if (res && res.error === "no_token") {
      toast(t("gpxinspect.match_no_token", "Kein Mapbox-Token konfiguriert (siehe Einstellungen) — fülle linear."), "warn", 3500);
    }
    const routes = (res && res.ok && Array.isArray(res.routes)) ? res.routes : [];
    let routed = 0, fillPts = 0, detour = 0;
    const order = gaps.map((g, i) => ({ g, i })).sort((x, y) => y.g.a - x.g.a);
    for (const { g, i } of order) {
      const r = routes[i];
      // v0.9.315 — nur anwenden, wenn die Route KEIN Umweg/Schleife ist (sonst gerade
      // füllen). Schützt saubere Spuren davor, an Kreuzungen verbogen zu werden.
      if (r && r.ok && Array.isArray(r.coords) && r.coords.length >= 2 && !_routeIsDetour(r.coords, g.dist, 2.5)) {
        _applyRoutedRange(g.a, g.b, r.coords);
        routed++;
      } else {
        if (r && r.ok && Array.isArray(r.coords) && r.coords.length >= 2) detour++;
        fillPts += _linearFillGap(g, spacing);
      }
    }
    return { routed, fillPts, detour };
  }
  // Eine Lücke mit gerade interpolierten Punkten füllen (Position/Höhe/Zeit linear). Gibt
  // die Anzahl eingefügter Punkte zurück. b = a+1 → reines Einfügen bei a+1.
  function _linearFillGap(g, spacing) {
    const A = _points[g.a], B = _points[g.b];
    if (!A || !B) return 0;
    const dist = _haversine(A, B);
    const n = _gapFillCount(dist, spacing);
    const tA = A.time ? Date.parse(A.time) : null;
    const tB = B.time ? Date.parse(B.time) : null;
    const inserted = [];
    for (let k = 1; k <= n; k++) {
      const tt = k / (n + 1);
      inserted.push({
        lat: A.lat + (B.lat - A.lat) * tt,
        lon: A.lon + (B.lon - A.lon) * tt,
        ele: (A.ele != null && B.ele != null) ? (A.ele + (B.ele - A.ele) * tt) : (A.ele != null ? A.ele : null),
        time: (tA != null && tB != null) ? new Date(tA + (tB - tA) * tt).toISOString() : null,
      });
    }
    _points.splice(g.a + 1, 0, ...inserted);
    return inserted.length;
  }

  // ── Höhe korrigieren: Höhenprofil GPS vs. Karte zeigen + live mischen ────────
  // v0.9.292 (Nutzer-Feedback zu v0.9.291: „man sieht nicht was passiert") —
  // Einmal die Gelände-Höhe pro Punkt samplen (queryTerrainElevation) und unter
  // der Karte GPS- + Karten-Linie übereinander zeichnen; der Regler mischt live
  // eine fette Ergebnis-Linie. „Übernehmen" schreibt sie in _points[].ele.
  function _eleGain(eles) {
    // Dieselbe Rechnung wie überall sonst (util.js → core/gpx.py). Hier ohne
    // Etappen, weil verglichen wird: GPS-Höhe gegen Karten-Höhe über dieselbe
    // Punktreihe.
    return hoehenmeterAusReihe(eles).asc;
  }
  function _trackBounds() {
    let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
    for (const p of _points) {
      if (p.lon < mnx) mnx = p.lon; if (p.lat < mny) mny = p.lat;
      if (p.lon > mxx) mxx = p.lon; if (p.lat > mxy) mxy = p.lat;
    }
    return [[mnx, mny], [mxx, mxy]];
  }
  let _eleBusy = false;
  function _eleWeight() {
    const wEl = document.getElementById("gpxi-ele-weight");
    return Math.max(0, Math.min(1, (parseFloat(wEl && wEl.value) || 0) / 100));
  }
  function _blendEles(w) {
    return _points.map((p, i) => {
      const gps = (p.ele == null || !isFinite(p.ele)) ? null : p.ele;
      const dem = _demEles ? _demEles[i] : null;
      if (dem == null || !isFinite(dem)) return gps;   // kein DEM → GPS behalten
      if (gps == null) return dem;
      return (1 - w) * gps + w * dem;
    });
  }
  function _cumDist() {
    const out = new Array(_points.length); out[0] = 0;
    for (let i = 1; i < _points.length; i++) out[i] = out[i - 1] + _haversine(_points[i - 1], _points[i]);
    return out;
  }
  // Profil ungültig machen (z. B. wenn Punkte sich ändern → Indizes passen nicht mehr).
  function _eleInvalidate() {
    _demEles = null; _profDraw = null;
    _closeProfileBox(); _closeMapPopup();
    try { setHover(null); } catch (_) {}
    const prof = document.getElementById("gpxi-ele-profile");
    if (prof && !prof.hidden) { prof.hidden = true; try { if (map) map.resize(); } catch (_) {} }
    setDisabled("gpxi-ele-weight", true);
    setDisabled("gpxi-ele-apply", true);
  }
  function _profileVisible() {
    const prof = document.getElementById("gpxi-ele-profile");
    return !!(prof && !prof.hidden);
  }
  function _clampWindow() {
    const n = _points.length;
    if (n < 2) { _profI0 = 0; _profI1 = Math.max(0, n - 1); return; }
    _profI0 = Math.max(0, Math.min(_profI0, n - 2));
    _profI1 = Math.min(n - 1, Math.max(_profI1, _profI0 + 1));
  }
  // Höhenprofil zeichnen — nur das sichtbare Index-Fenster [_profI0.._profI1] (Zoom-Sync mit Karte).
  function drawEleProfile() {
    const svg = document.getElementById("gpxi-eleprof-svg");
    if (!svg || !_demEles || _demEles.length !== _points.length || _points.length < 2) { _profDraw = null; return; }
    _closeProfileBox();   // schwebende Info-Box ist nach Neuzeichnen nicht mehr passend platziert
    { const hc = document.getElementById("gpxi-eleprof-cursor"); if (hc) hc.hidden = true; }
    _clampWindow();
    const i0 = _profI0, i1 = _profI1;
    const W = 1000, H = 150, padT = 10, padB = 16;
    const cum = _cumDist();
    const x0 = cum[i0], x1 = cum[i1] || (x0 + 1), span = (x1 - x0) || 1;
    const gpsArr = _points.map(p => (p.ele == null || !isFinite(p.ele)) ? null : p.ele);
    const demArr = _demEles;
    const w = _eleWeight();
    const resArr = _blendEles(w);
    // y-Skala nur über das sichtbare Fenster
    let lo = Infinity, hi = -Infinity;
    for (let i = i0; i <= i1; i++) for (const v of [gpsArr[i], demArr[i], resArr[i]]) { if (v == null || !isFinite(v)) continue; if (v < lo) lo = v; if (v > hi) hi = v; }
    if (!isFinite(lo) || !isFinite(hi)) { _profDraw = null; return; }
    if (hi - lo < 1) hi = lo + 1;
    const X = d => ((d - x0) / span) * W;
    const Y = v => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
    const path = arr => {
      let d = "", pen = false;
      for (let i = i0; i <= i1; i++) {
        const v = arr[i];
        if (v == null || !isFinite(v)) { pen = false; continue; }
        d += (pen ? "L" : "M") + X(cum[i]).toFixed(1) + " " + Y(v).toFixed(1) + " ";
        pen = true;
      }
      return d.trim();
    };
    const mid = (lo + hi) / 2;
    let inner = [hi, mid, lo].map(v =>
      `<line x1="0" y1="${Y(v).toFixed(1)}" x2="${W}" y2="${Y(v).toFixed(1)}" class="gpxi-ep-grid"/>`
    ).join("");
    inner += `<path d="${path(gpsArr)}" class="gpxi-ep-line gpxi-ep-gps"/>`
          +  `<path d="${path(demArr)}" class="gpxi-ep-line gpxi-ep-dem"/>`
          +  `<path d="${path(resArr)}" class="gpxi-ep-line gpxi-ep-res"/>`;
    // Anker-Marker A/B als vertikale Linien (wenn im Fenster)
    const vline = (idx, cls) => (idx != null && idx >= i0 && idx <= i1)
      ? `<line x1="${X(cum[idx]).toFixed(1)}" y1="0" x2="${X(cum[idx]).toFixed(1)}" y2="${H}" class="${cls}"/>` : "";
    inner += vline(_selA, "gpxi-ep-anchor gpxi-ep-anchor-a") + vline(_selB, "gpxi-ep-anchor gpxi-ep-anchor-b");
    // Einzelne klickbare Punkte — nur wenn wenige sichtbar (sonst zu viel DOM)
    const visN = i1 - i0 + 1;
    if (visN <= 200) {
      let dots = "";
      for (let i = i0; i <= i1; i++) {
        const v = resArr[i]; if (v == null || !isFinite(v)) continue;
        const sel = (i === _selA || i === _selB) ? " gpxi-ep-dot-sel" : "";
        dots += `<circle cx="${X(cum[i]).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="${visN <= 60 ? 3.2 : 2.2}" class="gpxi-ep-dot${sel}"/>`;
      }
      inner += dots;
    }
    svg.innerHTML = inner;
    _profDraw = { i0, i1, x0, span, W, cum };
    const info = document.getElementById("gpxi-eleprof-info");
    if (info) info.textContent =
      t("gpxinspect.ele_gain_gps", "Höhenmeter — GPS ") + Math.round(_eleGain(gpsArr)) + " · " +
      t("gpxinspect.ele_gain_map", "Karte ") + Math.round(_eleGain(demArr)) + " · " +
      t("gpxinspect.ele_gain_res", "Ergebnis ") + Math.round(_eleGain(resArr)) + " m" +
      (visN < _points.length ? "   (" + t("gpxinspect.ele_zoom_hint", "Ausschnitt") + " " + (i0 + 1) + "–" + (i1 + 1) + "/" + _points.length + ")" : "");
    const resEl = document.getElementById("gpxi-ele-result");
    if (resEl) resEl.textContent = t("gpxinspect.ele_preview", "Vorschau: %new Höhenmeter (%pct % Karte). Übernehmen, um es zu speichern.")
      .replace("%new", Math.round(_eleGain(resArr))).replace("%pct", Math.round(w * 100));
  }

  // ── Zoom-Sync Karte ↔ Höhenprofil (v0.9.293) ─────────────────────────────────
  function _windowFromBounds() {
    if (!map || _points.length < 2) return false;
    let b; try { b = map.getBounds(); } catch (_) { return false; }
    if (!b) return false;
    const W = b.getWest(), E = b.getEast(), S = b.getSouth(), N = b.getNorth();
    let lo = -1, hi = -1;
    for (let i = 0; i < _points.length; i++) {
      const p = _points[i];
      if (p.lon >= W && p.lon <= E && p.lat >= S && p.lat <= N) { if (lo < 0) lo = i; hi = i; }
    }
    if (lo < 0 || hi <= lo) return false;
    _profI0 = Math.max(0, lo - 1);
    _profI1 = Math.min(_points.length - 1, hi + 1);
    return true;
  }
  function onMapMoveSyncProfile() {
    if (_syncing || !_profileVisible()) return;
    if (!_windowFromBounds()) { _profI0 = 0; _profI1 = _points.length - 1; }
    drawEleProfile();
  }
  function _fitMapToWindow() {
    if (!map) return;
    _clampWindow();
    let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
    for (let i = _profI0; i <= _profI1; i++) {
      const p = _points[i];
      if (p.lon < mnx) mnx = p.lon; if (p.lat < mny) mny = p.lat;
      if (p.lon > mxx) mxx = p.lon; if (p.lat > mxy) mxy = p.lat;
    }
    if (!isFinite(mnx)) return;
    _syncing = true;
    try { map.once("moveend", () => { _syncing = false; }); } catch (_) { _syncing = false; }
    try { map.fitBounds([[mnx, mny], [mxx, mxy]], { padding: 50, animate: false, maxZoom: 18 }); }
    catch (_) { _syncing = false; }
  }
  function _zoomProfileWindow(factor, centerFrac) {
    const n = _points.length; if (n < 2) return;
    const cur = _profI1 - _profI0;
    let next = Math.round(cur * factor);
    next = Math.max(2, Math.min(n - 1, next));
    const center = _profI0 + centerFrac * cur;
    let i0 = Math.round(center - next * centerFrac);
    i0 = Math.max(0, Math.min(i0, n - 1 - next));
    _profI0 = i0; _profI1 = i0 + next;
    drawEleProfile(); _fitMapToWindow();
  }
  function _panProfileWindow(fracDelta) {
    const n = _points.length; if (n < 2) return;
    const cur = _profI1 - _profI0;
    const shift = Math.round(fracDelta * cur);
    if (!shift) return;
    let i0 = Math.max(0, Math.min(_profI0 + shift, n - 1 - cur));
    _profI0 = i0; _profI1 = i0 + cur;
    drawEleProfile(); _fitMapToWindow();
  }
  function _profileIdxAtClientX(clientX) {
    if (!_profDraw) return -1;
    const svg = document.getElementById("gpxi-eleprof-svg");
    if (!svg) return -1;
    const r = svg.getBoundingClientRect();
    if (!r.width) return -1;
    const xv = ((clientX - r.left) / r.width) * _profDraw.W;
    const targetCum = _profDraw.x0 + (xv / _profDraw.W) * _profDraw.span;
    let best = _profDraw.i0, bestD = Infinity;
    for (let i = _profDraw.i0; i <= _profDraw.i1; i++) {
      const d = Math.abs(_profDraw.cum[i] - targetCum);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }
  let _profDragX = null, _profDragMoved = false;
  function onProfileClick(e) {
    if (_profDragMoved) { _profDragMoved = false; return; }   // war ein Pan, kein Klick
    const idx = _profileIdxAtClientX(e.clientX);
    if (idx < 0) return;
    const cx = e.clientX, cy = e.clientY;
    if (_clickTimer) { clearTimeout(_clickTimer); _clickTimer = null; }
    _clickTimer = setTimeout(() => { _clickTimer = null; selectAnchor(idx); }, 240);
  }
  function onProfileDblClick(e) {
    const idx = _profileIdxAtClientX(e.clientX);
    if (idx < 0) return;
    e.preventDefault();
    if (_clickTimer) { clearTimeout(_clickTimer); _clickTimer = null; }
    selectAnchor(idx);
  }
  function onProfileWheel(e) {
    if (!_profDraw) return;
    e.preventDefault();
    const svg = document.getElementById("gpxi-eleprof-svg");
    const r = svg.getBoundingClientRect();
    const frac = r.width ? Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) : 0.5;
    _zoomProfileWindow(e.deltaY > 0 ? 1.25 : 0.8, frac);
  }
  function onProfileDown(e) { _profDragX = e.clientX; _profDragMoved = false; }
  function onProfileMove(e) {
    if (_profDragX == null || !_profDraw) return;
    const svg = document.getElementById("gpxi-eleprof-svg");
    const r = svg.getBoundingClientRect();
    if (!r.width) return;
    const dxFrac = (e.clientX - _profDragX) / r.width;
    if (Math.abs(dxFrac) < 0.03) return;
    _profDragMoved = true;
    _panProfileWindow(-dxFrac);
    _profDragX = e.clientX;
  }
  function onProfileUp() { _profDragX = null; }

  // ── Verknüpfter Hover-Cursor (v0.9.294) — Maus Karte ↔ Position im Profil ─────
  // Maus über der Karte → vertikaler Balken im Profil; Maus über dem Profil → Ring
  // auf dem Track. Beides läuft über setHover(idx).
  function setHover(idx) {
    try { _lbCursor(idx); } catch (_) {}   // Logbuch (§68 Q16): Marke im Zeitstrahl, kein Sprung
    // 0) Live-Daten-Box in der Ecke: zeigt immer den Punkt unter dem Mauszeiger.
    const hbox = document.getElementById("gpxi-hoverbox");
    if (hbox) {
      if (idx == null || !_points[idx]) { hbox.hidden = true; }
      else { hbox.innerHTML = _pointDataTable(idx); hbox.hidden = false; }
    }
    // 1) Ring-Marker auf der Karte
    try {
      const src = map && map.getSource("gpxi-hover");
      if (src) {
        if (idx == null || !_points[idx]) src.setData({ type: "FeatureCollection", features: [] });
        else src.setData({ type: "Feature", geometry: { type: "Point", coordinates: [_points[idx].lon, _points[idx].lat] } });
      }
    } catch (_) {}
    // 2) Vertikaler Cursor im Profil
    const strip = document.getElementById("gpxi-ele-profile");
    const svg = document.getElementById("gpxi-eleprof-svg");
    let cur = document.getElementById("gpxi-eleprof-cursor");
    if (!strip || !svg || !_profDraw || idx == null || idx < _profDraw.i0 || idx > _profDraw.i1) {
      if (cur) cur.hidden = true; return;
    }
    if (!cur) { cur = document.createElement("div"); cur.id = "gpxi-eleprof-cursor"; cur.className = "gpxi-ep-cursor"; strip.appendChild(cur); }
    const xView = ((_profDraw.cum[idx] - _profDraw.x0) / _profDraw.span) * _profDraw.W;
    const sr = svg.getBoundingClientRect(), pr = strip.getBoundingClientRect();
    cur.style.left = ((sr.left - pr.left) + (xView / _profDraw.W) * sr.width) + "px";
    cur.style.top = (sr.top - pr.top) + "px";
    cur.style.height = sr.height + "px";
    cur.hidden = false;
  }
  function _hideHover() { setHover(null); }
  function _nearestIdxToLngLat(lng, lat) {
    const i0 = _profDraw ? _profDraw.i0 : 0;
    const i1 = _profDraw ? _profDraw.i1 : _points.length - 1;
    const coslat = Math.cos(lat * Math.PI / 180);   // Längengrade nach Breite skalieren
    let best = -1, bestD = Infinity;
    for (let i = i0; i <= i1; i++) {
      const p = _points[i];
      const dx = (p.lon - lng) * coslat, dy = p.lat - lat;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }
  let _hoverRAF = 0, _hoverLL = null;
  function onMapHover(e) {
    _hoverLL = e.lngLat;
    if (_hoverRAF) return;
    _hoverRAF = requestAnimationFrame(() => {
      _hoverRAF = 0;
      if (!_hoverLL) return;
      const idx = _nearestIdxToLngLat(_hoverLL.lng, _hoverLL.lat);
      if (idx >= 0) setHover(idx);
    });
  }
  function onProfileHover(e) {
    if (!_profDraw) return;
    const idx = _profileIdxAtClientX(e.clientX);
    if (idx >= 0) setHover(idx);
  }

  // ── Punkt-Info-Feld (v0.9.293) — leichtes Feld AM Punkt, dunkelt NICHT ab ─────
  // Karte = natives Popup (folgt dem Punkt). Profil = schwebende Box an der Klick-
  // stelle. Neuer Klick → das Feld wandert zum neuen Punkt.
  function _pointDataTable(idx) {
    const p = _points[idx];
    const cum = _cumDist();
    const distStart = cum[idx] || 0;
    const prev = idx > 0 ? _points[idx - 1] : null;
    const dPrev = prev ? _haversine(prev, p) : null;
    const tThis = p.time ? Date.parse(p.time) : null;
    const tPrev = prev && prev.time ? Date.parse(prev.time) : null;
    const dtPrev = (tThis != null && tPrev != null) ? (tThis - tPrev) / 1000 : null;
    const speed = (dPrev != null && dtPrev && dtPrev > 0) ? (dPrev / dtPrev) * 3.6 : null;
    const grade = (dPrev != null && dPrev > 0 && prev && prev.ele != null && p.ele != null) ? ((p.ele - prev.ele) / dPrev) * 100 : null;
    const dem = _demEles ? _demEles[idx] : null;
    const rows = [];
    const row = (k, v) => rows.push(`<tr><td class="gpxi-pm-k">${k}</td><td class="gpxi-pm-v">${v}</td></tr>`);
    row(t("gpxinspect.pm_index", "Punkt"), "#" + (idx + 1) + " / " + _points.length);  // _pointDataTable
    row(t("gpxinspect.pm_pos", "Position"), p.lat.toFixed(6) + ", " + p.lon.toFixed(6));
    row(t("gpxinspect.pm_ele", "Höhe (GPS)"), p.ele != null ? Math.round(p.ele) + " m" : "—");
    if (dem != null && isFinite(dem)) row(t("gpxinspect.pm_ele_map", "Höhe (Karte)"), Math.round(dem) + " m");
    row(t("gpxinspect.pm_time", "Zeit"), p.time ? _fmtPtTime(p.time) : t("gpxinspect.no_time", "ohne Zeit"));
    row(t("gpxinspect.pm_dist", "Distanz ab Start"), _fmtKm(distStart));
    if (dPrev != null) row(t("gpxinspect.pm_dprev", "Abstand zum vorigen"), dPrev.toFixed(1) + " m");
    if (speed != null) row(t("gpxinspect.pm_speed", "Geschwindigkeit"), speed.toFixed(1) + " km/h");
    if (grade != null) row(t("gpxinspect.pm_grade", "Steigung"), (grade >= 0 ? "+" : "") + grade.toFixed(1) + " %");
    return `<div class="gpxi-pi-head">${t("gpxinspect.pm_title", "Punkt-Daten")}</div>` +
      `<table class="gpxi-pm-tbl"><tbody>${rows.join("")}</tbody></table>`;
  }
  function _pointInfoHtml(idx) {
    return _pointDataTable(idx) +
      `<div class="gpxi-pi-actions">` +
      `<button class="btn" id="gpxi-pi-a">${t("gpxinspect.pm_set_a", "Als Anker A")}</button>` +
      `<button class="btn" id="gpxi-pi-b">${t("gpxinspect.pm_set_b", "Als Anker B")}</button>` +
      `</div>`;
  }
  function _wirePointInfo(idx, closeFn) {
    const aBtn = document.getElementById("gpxi-pi-a");
    const bBtn = document.getElementById("gpxi-pi-b");
    if (aBtn) aBtn.onclick = () => { _selA = idx; _selB = null; renderPoints(); updateUI(); if (_profDraw) drawEleProfile(); if (closeFn) closeFn(); };
    if (bBtn) bBtn.onclick = () => {
      if (_selA === null) { _selA = idx; }
      else if (idx !== _selA) { _selB = idx; if (_selB < _selA) { const tmp = _selA; _selA = _selB; _selB = tmp; } }
      renderPoints(); updateUI(); if (_profDraw) drawEleProfile(); if (closeFn) closeFn();
    };
  }
  function _closeProfileBox() { const box = document.getElementById("gpxi-pinfo-box"); if (box) box.remove(); }
  function _closeMapPopup() { if (_ptPopup) { try { _ptPopup.remove(); } catch (_) {} _ptPopup = null; } }
  // Karte: Popup am Punkt (folgt der Karte beim Pannen/Zoomen).
  function showPointInfoMap(idx) {
    const p = _points[idx];
    if (!p || !_maplib || !map) return;
    _closeProfileBox();
    _closeMapPopup();
    _ptPopup = new _maplib.Popup({ closeButton: true, closeOnClick: false, maxWidth: "300px", className: "gpxi-pinfo-pop", offset: 10 })
      .setLngLat([p.lon, p.lat]).setHTML(`<div class="gpxi-pinfo">${_pointInfoHtml(idx)}</div>`).addTo(map);
    try { _ptPopup.on("close", () => { _ptPopup = null; }); } catch (_) {}
    _wirePointInfo(idx, _closeMapPopup);
  }
  // Profil: schwebende Box an der Klickstelle (im canvaswrap), folgt dem Theme.
  function showPointInfoProfile(idx, clientX, clientY) {
    const wrap = document.getElementById("gpxi-canvaswrap");
    if (!wrap) return;
    _closeMapPopup();
    let box = document.getElementById("gpxi-pinfo-box");
    if (!box) { box = document.createElement("div"); box.id = "gpxi-pinfo-box"; box.className = "gpxi-pinfo gpxi-pinfo-float"; wrap.appendChild(box); }
    box.innerHTML = `<button class="gpxi-pi-x" id="gpxi-pi-close" title="${t("gpxinspect.pm_close", "Schließen")}">✕</button>` + _pointInfoHtml(idx);
    const wr = wrap.getBoundingClientRect();
    box.style.left = "0px"; box.style.top = "0px";   // erst messen, dann platzieren
    const bw = box.offsetWidth, bh = box.offsetHeight;
    let left = (clientX - wr.left) + 12;
    let top = (clientY - wr.top) - bh - 12;           // bevorzugt oberhalb des Klicks
    if (top < 4) top = (clientY - wr.top) + 14;       // sonst darunter
    if (left + bw > wr.width - 4) left = wr.width - bw - 6;
    if (left < 4) left = 4;
    if (top + bh > wr.height - 4) top = wr.height - bh - 6;
    if (top < 4) top = 4;
    box.style.left = left + "px"; box.style.top = top + "px";
    const cBtn = document.getElementById("gpxi-pi-close");
    if (cBtn) cBtn.onclick = _closeProfileBox;
    _wirePointInfo(idx, _closeProfileBox);
  }
  // 03.09.2026 — Helfer für die Anbieterauswahl
  function _bboxLonLat() {
    try {
      const ps = (_points || []).filter(p => p && isFinite(p.lat) && isFinite(p.lon));
      if (!ps.length) return null;
      let a = 999, b = 999, c = -999, d = -999;
      for (const p of ps) { if (p.lon < a) a = p.lon; if (p.lat < b) b = p.lat; if (p.lon > c) c = p.lon; if (p.lat > d) d = p.lat; }
      return [a, b, c, d];
    } catch (_) { return null; }
  }
  function _hatGelaende() { try { return !!(map && map.getTerrain && map.getTerrain()); } catch (_) { return false; } }
  // DEM einmal samplen + Profil einblenden.
  async function loadEleProfile() {
    const resEl = document.getElementById("gpxi-ele-result");
    if (_eleBusy || _points.length < 2 || !map) return;
    if (!_hatGelaende()) {
      const m = t("gpxinspect.ele_need_terrain", "Der gewählte Kartenstil hat kein Gelände — bitte einen anderen Stil wählen.");
      if (resEl) resEl.textContent = m; toast(m, "warn"); return;
    }
    _eleBusy = true;
    // v0.9.522 — gemeinsames Warte-Muster aus util.js statt Eigenbau.
    const frei = knopfBeschaeftigt("gpxi-ele-load", "gpxinspect.ele_working", "Hole Höhen aus der Karte …");
    await malPause();
    try {
      // Track-Bbox anfahren (animate:false), auf 'idle' warten (DEM-Kacheln da), samplen, zurück.
      const cam = { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
      try { map.fitBounds(_trackBounds(), { padding: 40, animate: false }); } catch (_) {}
      await new Promise((resolve) => {
        let done = false; const fin = () => { if (!done) { done = true; resolve(); } };
        try { map.once("idle", fin); } catch (_) {}
        setTimeout(fin, 9000);
      });
      if (isUnmounted) return;
      let hit = 0;
      const dem = _points.map(p => {
        let v = null;
        try { v = map.queryTerrainElevation([p.lon, p.lat]); } catch (_) {}
        if (v == null || !isFinite(v)) return null;
        hit++; return Math.round(v * 10) / 10;
      });
      try { map.jumpTo(cam); } catch (_) {}
      if (!hit) {
        const m = t("gpxinspect.ele_no_dem", "Keine Höhendaten gefunden (Internet/Token?).");
        if (resEl) resEl.textContent = m; toast(m, "warn"); return;
      }
      _demEles = dem;
      const prof = document.getElementById("gpxi-ele-profile");
      if (prof) prof.hidden = false;
      setDisabled("gpxi-ele-weight", false);
      setDisabled("gpxi-ele-apply", false);
      try { map.resize(); } catch (_) {}   // Karte schrumpft um den Profil-Streifen
      // Fenster initial auf den aktuell sichtbaren Karten-Ausschnitt (Zoom-Sync)
      _profI0 = 0; _profI1 = _points.length - 1;
      _windowFromBounds();
      drawEleProfile();
    } catch (e) {
      applog && applog("error", "[gpxinspect] loadEleProfile: " + e);
      if (resEl) resEl.textContent = t("gpxinspect.ele_err", "Höhenprofil laden fehlgeschlagen.");
    } finally {
      _eleBusy = false;
      if (frei) frei();
    }
  }
  // Aktuelle Mischung in die Punkte schreiben (mit Undo).
  function applyEleBlend() {
    if (!_demEles || _demEles.length !== _points.length) return;
    const w = _eleWeight();
    const res = _blendEles(w);
    const oldGain = _eleGain(_points.map(p => p.ele));
    _pushUndo(t("gpxinspect.ele_title", "Höhe korrigieren"));
    for (let i = 0; i < _points.length; i++) {
      if (res[i] != null && isFinite(res[i])) _points[i].ele = Math.round(res[i] * 10) / 10;
    }
    _hasEle = true; _dirty = true;
    const newGain = _eleGain(_points.map(p => p.ele));
    renderAll(); updateUI();
    drawEleProfile();   // GPS-Linie == jetzt Ergebnis → die beiden fallen zusammen
    const resEl = document.getElementById("gpxi-ele-result");
    if (resEl) resEl.textContent = t("gpxinspect.ele_done", "Übernommen: %old → %new Höhenmeter (%pct % Karte). Jetzt speichern.")
      .replace("%old", Math.round(oldGain)).replace("%new", Math.round(newGain)).replace("%pct", Math.round(w * 100));
    toast(t("gpxinspect.ele_applied_toast", "Höhe übernommen — zum Sichern unten speichern."), "success");
  }

  async function saveTrack() {
    if (!_points.length) return;
    // 29.08.2026 (Marc: „ich bin ja ausm archiv gekommen … und möchte sie dann
    // im archiv direkt haben") — liegt das Original im Archiv, ist ERSETZEN
    // der kurze Weg: Datei überschreiben (Sicherung in der App-Ablage),
    // Sammlungen, Projekte und Reise/Schwarm-Kompositionen wandern mit.
    // Ohne Archiv (oder bei Nicht-GPX-Originalen) bleibt alles wie bisher.
    const origPfad = _origPath || _srcPath || "";
    let imArchiv = false;
    if (origPfad.toLowerCase().endsWith(".gpx")) {
      try {
        const st = await api().archiv_status(origPfad);
        imArchiv = !!(st && st.ok && st.im_archiv);
      } catch (_) {}
    }
    if (imArchiv) {
      const wahl = await new Promise((res) => {
        const m = openModal({
          title: "💾 " + t("gpxinspect.save", "Geheilten Track speichern …"),
          body: `<div class="lib-fmodal">
            <p>${t("gpxinspect.ersetzen_frage", "Diese Tour liegt im Archiv. Soll die geheilte Version das Original ersetzen?")}</p>
            <div class="lib-hint">${t("gpxinspect.ersetzen_hint", "Sammlungen und das Archiv zeigen danach die geheilte Version. Bestehende Projekte bleiben an der bisherigen Version „gepinnt“ (nichts verrutscht) und zeigen „⬆ neuere Version“ zum bewussten Aktualisieren. Das Original wird vorher in der App-Ablage gesichert und bleibt als Version wiederherstellbar.")}</div>
          </div>`,
          footer: `<button class="btn" id="gpxi-ers-abbruch">${t("common.cancel", "Abbrechen")}</button>
                   <button class="btn" id="gpxi-ers-neu">${t("gpxinspect.ersetzen_neu", "Als neue Datei …")}</button>
                   <button class="btn btn-primary" id="gpxi-ers-ja">${t("gpxinspect.ersetzen_ja", "Im Archiv ersetzen")}</button>`,
        });
        const fertig = (w) => { m.close(); res(w); };
        const a = document.getElementById("gpxi-ers-abbruch"); if (a) a.onclick = () => fertig("abbruch");
        const n = document.getElementById("gpxi-ers-neu"); if (n) n.onclick = () => fertig("neu");
        const j = document.getElementById("gpxi-ers-ja"); if (j) j.onclick = () => fertig("ersetzen");
      });
      if (wahl === "abbruch") return;
      if (wahl === "ersetzen") {
        const payload = _points.map(p => ({ lat: p.lat, lon: p.lon, ele: p.ele, time: p.time, oi: p.oi, si: p.si || 0 }));
        let res;
        try {
          res = await rzWarten("library_track_ersetzen", () => api().library_track_ersetzen(payload, _srcPath, origPfad,
                                                   _sources.length > 1 ? _sources : null));
        } catch (e) { res = { ok: false, error: String(e) }; }
        if (isUnmounted) return;
        if (!res || !res.ok) { toast((res && res.error) || "Speichern fehlgeschlagen", "error", 6000); return; }
        _dirty = false; updateUI();
        const teile = [t("gpxinspect.ersetzt_toast", "Im Archiv ersetzt.")];
        if (res.collections) teile.push(t("gpxinspect.ersetzt_col", "%n Sammlungs-Einträge umgezogen").replace("%n", res.collections));
        if (res.mengen) teile.push(t("gpxinspect.ersetzt_mengen", "%n Kompositionen aktualisiert").replace("%n", res.mengen));
        if (res.sensors_kept) teile.push(t("gpxinspect.sensors_kept", "Sensordaten erhalten"));
        toast(teile.join(" · "), "success", 7000);
        const note = document.getElementById("gpxi-note");
        if (note) note.textContent = teile.join(" · ") + " — " + t("gpxinspect.ersetzt_backup", "Sicherung:") + " " + (res.backup || "");
        return;
      }
      // „Als neue Datei …" → normaler Weg unten.
    }
    // v0.9.335 (Nutzer-Feedback): „Speichern unter…" mit Format-Wahl —
    // Default-Ordner ist der der Original-Datei (nicht der tiefe Library-Cache),
    // GPX (mit eingebetteten Sensoren) oder TCX. oi mitsenden → Sensoren bleiben.
    const orig = _origPath || _srcPath || "";
    const slash = Math.max(orig.lastIndexOf("/"), orig.lastIndexOf("\\"));
    const dir = slash >= 0 ? orig.slice(0, slash) : "";
    let stem = slash >= 0 ? orig.slice(slash + 1) : orig;
    const dot = stem.lastIndexOf("."); if (dot > 0) stem = stem.slice(0, dot);
    const defName = (stem || "track") + "_geheilt.gpx";
    let dest = "";
    try {
      dest = await api().pick_save_path(defName, dir, ["GPX (*.gpx)", "TCX (*.tcx)"]);
    } catch (_) { dest = ""; }
    if (!dest) return;   // abgebrochen
    const fmt = String(dest).toLowerCase().endsWith(".tcx") ? "tcx" : "gpx";
    const payload = _points.map(p => ({ lat: p.lat, lon: p.lon, ele: p.ele, time: p.time, oi: p.oi, si: p.si || 0 }));
    let res;
    try {
      res = await rzWarten("gpxinspect_save", () => api().gpxinspect_save(payload, _srcPath, dest, fmt,
                                        _sources.length > 1 ? _sources : null));
    } catch (e) { res = { ok: false, error: String(e) }; }
    if (isUnmounted) return;
    if (!res || !res.ok) { toast((res && res.error) || "Speichern fehlgeschlagen", "error", 6000); return; }
    _dirty = false; updateUI();
    const note = document.getElementById("gpxi-note");
    const savedMsg = t("gpxinspect.saved", "Gespeichert: ") + res.out_path
      + (res.sensors_kept ? " — " + t("gpxinspect.sensors_kept", "Sensordaten erhalten") : "");
    if (note) note.textContent = savedMsg;
    toast(savedMsg, "success", 6000);
    // Wer war das VOR dem Heilen? Projekte hängen am Koordinaten-Hash der Tour;
    // der geheilte Track hat einen anderen und damit eine leere Sitzung. Die
    // Kennung müssen wir uns also merken, BEVOR wir die neue Datei laden.
    let altHash = "", altProjekte = 0;
    try {
      const sess = (typeof getActiveSession === "function") ? getActiveSession() : null;
      altHash = (sess && sess.track_hash) || "";
      altProjekte = ((typeof getProjectsList === "function") ? (getProjectsList() || []) : []).length;
    } catch (_) {}

    // Fall 4 der Archiv-Frage (Marc, 27.08.2026): Ein hier geänderter und
    // gespeicherter Track ist noch nirgends erfasst — also fragen, BEVOR er
    // geladen wird. Sagt der Nutzer ja, liegt er danach im Archiv, und mit
    // dieser Version wird weitergearbeitet.
    let zielPfad = res.out_path;
    if (typeof window.archivFrage === "function") {
      try { zielPfad = await window.archivFrage(res.out_path, { nachAenderung: true }) || res.out_path; }
      catch (_) {}
    }
    if (isUnmounted) return;
    // Geheilten Track gleich global laden → alle Module nutzen die saubere Version
    // (auch TCX: _ensure_gpx konvertiert + zieht die Sensoren in den Cache-Sidecar).
    // Stumm: die Archiv-Frage ist an dieser Stelle schon beantwortet.
    if (typeof loadGlobalGpx === "function") {
      try { await loadGlobalGpx(zielPfad, { stumm: true }); } catch (_) {}
    }
    if (isUnmounted) return;
    if (altHash && altProjekte) await _projekteUebernehmenFragen(altHash);
  }

  /** „Arbeit übernehmen?" — nach dem Heilen anbieten, die Projekte der
   *  Ursprungstour auf den geheilten Track zu übertragen (27.08.2026, Marc:
   *  „wenn ich im animator was baue und merke, dass mit dem track etwas nicht
   *  stimmt … Stand jetzt muss ich im animator dann alles neu bauen").
   *
   *  Übernommen wird ALLES: Animator, Tour-Map, Geotagger, Höhen-Animator,
   *  Fotos und Schilder. Der Vorbehalt steht im Dialog, nicht im Kleingedruckten:
   *  Keyframes und Schilder sitzen an einer relativen Position im Track — je mehr
   *  geheilt wurde, desto weiter können sie verrutschen.
   */
  async function _projekteUebernehmenFragen(altHash) {
    let neuHash = "";
    try {
      const sess = (typeof getActiveSession === "function") ? getActiveSession() : null;
      neuHash = (sess && sess.track_hash) || "";
    } catch (_) {}
    if (!neuHash || neuHash === altHash) return;   // nichts verändert → gleiche Sitzung

    const ok = await new Promise(resolve => {
      openModal({
        title: t("gpxinspect.uebernehmen_titel", "Arbeit auf den geheilten Track übernehmen?"),
        body: `<p>${t("gpxinspect.uebernehmen_text",
                "Der geheilte Track ist für das Programm eine neue Tour — deine Projekte hängen noch an der alten Datei. Sollen Animator, Tour-Map, Geotagger, Höhen-Animator samt Fotos und Schildern mit herüberkommen?")}</p>
               <p class="hinweis" style="opacity:.85">⚠️ ${t("gpxinspect.uebernehmen_vorbehalt",
                "Je nachdem, wie viel geheilt wurde, passt die Übernahme nicht überall: Keyframes, Schilder und Foto-Pins sitzen an einer Stelle im Track. Wurden nur einzelne Ausreißer geglättet, merkst du nichts. Wurde viel eingefügt oder abgeschnitten, können sie verrutschen — dann bitte kurz nachsehen.")}</p>
               <p style="opacity:.75">${t("gpxinspect.uebernehmen_sicher",
                "Die alte Tour bleibt unangetastet — du kannst jederzeit wieder die Originaldatei öffnen.")}</p>`,
        footer: `
          <button class="btn" id="md-uebn-nein">${t("gpxinspect.uebernehmen_nein", "Nein, leer starten")}</button>
          <button class="btn btn-primary" id="md-uebn-ja">${t("gpxinspect.uebernehmen_ja", "Ja, übernehmen")}</button>
        `,
        onClose: () => resolve(false),
      });
      const zu = (wert) => { try { openModal({}).close(); } catch (_) {} resolve(wert); };
      const nein = document.getElementById("md-uebn-nein");
      const ja   = document.getElementById("md-uebn-ja");
      if (nein) nein.onclick = () => zu(false);
      if (ja)   ja.onclick   = () => zu(true);
    });
    if (!ok || isUnmounted) return;

    let r;
    try { r = await api().session_projekte_uebernehmen(altHash, neuHash); }
    catch (e) { r = { ok: false, error: String(e) }; }
    if (isUnmounted) return;
    if (!r || !r.ok) {
      toast((r && r.error) || t("gpxinspect.uebernehmen_fehler", "Übernahme fehlgeschlagen"), "error", 6000);
      return;
    }
    // Sitzung neu ziehen, damit Topbar und Module die kopierten Projekte sehen.
    try {
      const g = (typeof window.getGlobalGpxData === "function") ? window.getGlobalGpxData() : null;
      const gp = (typeof window.getGlobalGpxPath === "function") ? window.getGlobalGpxPath() : "";
      if (g && g.coords && typeof sessionActivate === "function") {
        await sessionActivate(g.coords, gp || "");
      }
    } catch (_) {}
    try { if (typeof rebindAllSettings === "function") rebindAllSettings(); } catch (_) {}
    const abw = (r.punkte_alt && r.punkte_neu)
      ? Math.round(Math.abs(r.punkte_neu - r.punkte_alt) / r.punkte_alt * 100) : 0;
    let msg = t("gpxinspect.uebernehmen_ok", "%n Projekt(e) übernommen.").replace("%n", r.projekte);
    if (abw >= 5) {
      msg += " " + t("gpxinspect.uebernehmen_pruefen",
        "Die Tour hat sich um rund %p % geändert — bitte Keyframes und Schilder kurz prüfen.")
        .replace("%p", abw);
    }
    toast(msg, abw >= 5 ? "warn" : "success", 8000);
  }

  // ── UI-State ─────────────────────────────────────────────────────────────────
  function _fmtKm(m) { return (m / 1000 < 100) ? (m / 1000).toFixed(1) + " km" : Math.round(m / 1000) + " km"; }
  function updateUI() {
    try { _lbKnoepfe(); } catch (_) {}
    const has = _points.length > 0;
    const empty = document.getElementById("gpxi-empty");
    const panel = document.getElementById("gpxi-panel");
    if (empty) empty.hidden = has;
    if (panel) panel.hidden = !has;
    if (!has) return;
    // Stats
    let dist = 0;
    for (let i = 1; i < _points.length; i++) dist += _haversine(_points[i - 1], _points[i]);
    const stat = document.getElementById("gpxi-stat");
    if (stat) stat.textContent = _points.length + " " + t("gpxinspect.points", "Punkte") + " · " + _fmtKm(dist)
      + (_hasTime ? "" : " · " + t("gpxinspect.no_time", "ohne Zeit"))
      + (_dirty ? " · " + t("gpxinspect.unsaved", "ungespeichert") : "");
    // Auswahl-Text
    const selEl = document.getElementById("gpxi-sel");
    const haveA = _selA !== null, haveB = _selB !== null;
    // 10.09.2026 — Statuszeile im Abschnitt „Bearbeiten": ausgegraute Knöpfe sagten
    // nicht, was ihnen fehlt.
    { const st = document.getElementById("gpxi-ab-status");
      if (st) {
        if (_drawMode) st.textContent = t("gpxinspect.ab_draw", "Zeichenmodus — den Pfad auf der Karte klicken.");
        else if (!haveA) st.textContent = t("gpxinspect.ab_none", "Punkt auf der Karte anklicken → Anker A. Zweiter Klick → B.");
        else if (!haveB) st.textContent = t("gpxinspect.ab_a", "Anker A: Punkt #{n}. Zweiter Klick setzt B; Werkzeuge mit „A“ sind frei.").replace("{n}", _selA + 1);
        else st.textContent = t("gpxinspect.ab_ab", "Abschnitt A→B: Punkt #{a} bis #{b}, {n} dazwischen.").replace("{a}", _selA + 1).replace("{b}", _selB + 1).replace("{n}", _selB - _selA - 1);
      } }
    if (selEl) {
      // 02.09.2026 (Marc: „was bedeutet hier ‚keine auswahl‘, für was ist das?")
      // — die Zeile gehört zum Bereich „Abschnitt A→B" und stand auch dann da,
      // wenn „Ganzer Track" gewählt war. Dort meint sie nichts, und ein Wort
      // ohne Bezug ist schlimmer als gar keins. Jetzt erscheint sie nur im
      // A→B-Modus und sagt statt „Keine Auswahl", was zu tun ist.
      selEl.hidden = (_healScope() !== "ab");
      if (!haveA) selEl.textContent = t("gpxinspect.sel_klick_a",
        "Klicke auf der Karte den Punkt A an, dann Punkt B — dazwischen wird geheilt.");
      else if (!haveB) {
        // v0.9.293 — Detail-Daten liegen jetzt im Punkt-Modal (Klick), hier nur kurz.
        selEl.textContent = t("gpxinspect.sel_a_short", "Anker A: ") + "#" + (_selA + 1)
          + " — " + t("gpxinspect.sel_a_next", "jetzt B klicken");
      } else {
        const between = _selB - _selA - 1;
        const segDist = _haversine(_points[_selA], _points[_selB]);
        const tA = _points[_selA].time ? Date.parse(_points[_selA].time) : null;
        const tB = _points[_selB].time ? Date.parse(_points[_selB].time) : null;
        const dur = (tA != null && tB != null) ? (" · ⏱ " + _fmtDur(tB - tA)) : "";
        selEl.textContent = t("gpxinspect.sel_ab", "A→B: ") + between + " " + t("gpxinspect.between", "Punkte dazwischen") + " · " + _fmtKm(segDist) + dur;
      }
    }
    const both = haveA && haveB;
    const hasBetween = both && (_selB > _selA + 1);
    setDisabled("gpxi-heal", !hasBetween || _drawMode);
    setDisabled("gpxi-fill", !both || _drawMode);
    setDisabled("gpxi-drawfill", !both || _drawMode);
    setDisabled("gpxi-delete-one", !(haveA && !haveB) || _drawMode);
    // Track kappen (§15.1): nur bei Einzel-Auswahl (A ohne B), und nur wenn es auf
    // der jeweiligen Seite überhaupt was abzuschneiden gibt (≥2 Punkte bleiben übrig).
    setDisabled("gpxi-trim-before", !(haveA && !haveB) || _drawMode || _selA < 1);
    setDisabled("gpxi-trim-after",  !(haveA && !haveB) || _drawMode || _selA > _points.length - 2);
    setDisabled("gpxi-delete", !hasBetween || _drawMode);
    setDisabled("gpxi-ab-archiv", !both || _drawMode || _selB <= _selA);
    // 10.09.2026 — Web-Werkzeuge: Startpunkt und Teilen brauchen Anker A (allein)
    setDisabled("gpxi-wz-rotate", !(haveA && !haveB) || _drawMode || _selA < 1);
    setDisabled("gpxi-wz-split", !(haveA && !haveB) || _drawMode || _selA < 1 || _selA > _points.length - 2 || _points.length < 4);
    setDisabled("gpxi-wz-reverse", _drawMode || _points.length < 2);
    setDisabled("gpxi-wz-simplify", _drawMode || _points.length < 3);
    setDisabled("gpxi-wz-retime-run", _drawMode || _points.length < 2 || !_hasTime);
    setDisabled("gpxi-wz-splits", _drawMode || _points.length < 2);
    // Map Matching: Bereich sobald A+B gesetzt sind (≥2 Punkte reichen zum Snappen —
    // anders als „Lücke füllen" braucht es KEINE Punkte dazwischen); ganzer Track sobald Punkte da.
    setDisabled("gpxi-match-sel", !both || _drawMode || _mmBusy);
    setDisabled("gpxi-match-all", _drawMode || _mmBusy || _points.length < 2);
    setDisabled("gpxi-clearsel", !haveA || _drawMode);
    setDisabled("gpxi-save", !_dirty || _drawMode);
    setDisabled("gpxi-reset", !_dirty || _drawMode);
    setDisabled("gpxi-undo", _drawMode || !(_undo && _undo.canUndo()));
    setDisabled("gpxi-redo", _drawMode || !(_undo && _undo.canRedo()));
    // Auto-Despike: Button frei wenn Punkte da & nicht im Zeichnen-Modus.
    setDisabled("gpxi-heal-run", _drawMode || _mmBusy || !_points.length);
    setDisabled("gpxi-join", _drawMode || _mmBusy || !_points.length);
    const spikeBox = document.getElementById("gpxi-spikebox");
    const nSpk = _spikes.length, nGap = _gaps.length;
    if (spikeBox) spikeBox.hidden = (nSpk === 0 && nGap === 0) || _drawMode;
    {
      const sh = document.getElementById("gpxi-spikehint");
      if (sh) {
        let txt = "";
        if (nSpk > 0) txt += t("gpxinspect.spike_nav", "Ausreißer ") + (_spikeIdx + 1) + "/" + nSpk;
        if (nGap > 0) txt += (txt ? " · " : "") + t("gpxinspect.gap_count", "Lücken: ") + nGap;
        sh.textContent = txt;
      }
      // Durchsteppen nur sinnvoll für Ausreißer; bei reinen Lücken Nav aus.
      setDisabled("gpxi-spike-prev", nSpk === 0 || _spikeIdx <= 0);
      setDisabled("gpxi-spike-next", nSpk === 0 || _spikeIdx >= nSpk - 1);
    }
    // Zeichnen-Modus: Box ein, Stützpunkt-Zähler, Übernehmen/Undo nach Bedarf.
    const drawBox = document.getElementById("gpxi-drawbox");
    if (drawBox) drawBox.hidden = !_drawMode;
    if (_drawMode) {
      const dh = document.getElementById("gpxi-drawhint");
      if (dh) dh.textContent = t("gpxinspect.draw_count", "Stützpunkte gesetzt: ") + _drawPts.length
        + " — " + t("gpxinspect.draw_more", "weiter klicken oder übernehmen.");
      setDisabled("gpxi-draw-apply", _drawPts.length < 1);
      setDisabled("gpxi-draw-undo", _drawPts.length < 1);
    }
  }
  function setDisabled(id, dis) { const el = document.getElementById(id); if (el) el.disabled = !!dis; }

  // ── Listener ─────────────────────────────────────────────────────────────────
  // ── 10.09.2026 — Web-Werkzeuge im Inspektor (Marc: „die App muss alles können") ──
  function _wzPayload() { return _points.map(p => ({ lat: p.lat, lon: p.lon, ele: p.ele, time: p.time, oi: p.oi, si: p.si || 0 })); }
  function _wzUebernehmen(neuePunkte, label) {
    _pushUndo(label);
    merkeVorher();
    _points = (neuePunkte || []).map(p => ({ lat: p.lat, lon: p.lon, ele: p.ele, time: p.time, oi: p.oi, si: p.si || 0 }));
    _hasTime = _points.length > 0 && _points.every(p => !!p.time);
    _dirty = true; clearSpikes(); clearSelection();
    _eleInvalidate();
    renderAll(); updateUI(); zeigeVorherNachher();
    try { reduzierReglerSync(true); } catch (_) {}
    try { _pfeileBerechnen(); _punktFormAnwenden(); renderPoints(); } catch (_) {}
    { const r = document.getElementById("gpxi-speedrow"); if (r) r.hidden = _hasTime; }
  }
  async function _wzAnwenden(action, params, label) {
    if (!_points.length) return null;
    let res;
    try { res = await rzWarten("gpxinspect_werkzeug", () => api().gpxinspect_werkzeug(action, _wzPayload(), params || {})); }
    catch (e) { res = { ok: false, error: String(e) }; }
    if (isUnmounted) return null;
    if (!res || !res.ok) { toast((res && (res.hint || res.error)) || t("gpxinspect.wz_fehler", "Werkzeug fehlgeschlagen"), "error", 6000); return null; }
    return res;
  }
  const _wzNote = (txt) => { const n = document.getElementById("gpxi-wz-note"); if (n) n.textContent = txt || ""; };
  async function wzReverse() {
    const r = await _wzAnwenden("reverse", {}, t("gpxinspect.wz_reverse", "Umkehren"));
    if (!r) return;
    _wzUebernehmen(r.points, t("gpxinspect.wz_reverse", "Umkehren"));
    _wzNote(r.times_mirrored ? t("gpxinspect.wz_reverse_ok", "Umgekehrt, Zeiten gespiegelt.") : t("gpxinspect.wz_reverse_ok_ohne", "Umgekehrt."));
  }
  async function wzRotate() {
    if (_selA === null || _selB !== null) return;
    const r = await _wzAnwenden("rotate", { at_index: _selA }, t("gpxinspect.wz_rotate", "Startpunkt"));
    if (!r) return;
    _wzUebernehmen(r.points, t("gpxinspect.wz_rotate_undo", "Startpunkt verschoben"));
    _wzNote(r.is_loop ? t("gpxinspect.wz_rotate_ok", "Neuer Start gesetzt.")
      : t("gpxinspect.wz_rotate_gap", "Neuer Start gesetzt — Achtung: Start und Ziel lagen {m} m auseinander, das ist keine geschlossene Runde.").replace("{m}", Math.round(r.gap_m || 0)));
  }
  async function wzSplit() {
    if (_selA === null || _selB !== null) return;
    const r = await _wzAnwenden("split", { at_index: _selA }, t("gpxinspect.wz_split", "Teilen"));
    if (!r || !r.parts) return;
    const km = (m) => (m / 1000).toFixed(1) + " km";
    const wahl = await new Promise((res) => {
      const m = openModal({
        title: "✂ " + t("gpxinspect.wz_split_title", "Track teilen"),
        body: `<div class="lib-fmodal"><p>${t("gpxinspect.wz_split_body", "Teil 1: {n1} Punkte, {l1} · Teil 2: {n2} Punkte, {l2}. Der Schnittpunkt gehört zu beiden Teilen.")
          .replace("{n1}", r.counts[0]).replace("{l1}", km(r.lengths_m[0])).replace("{n2}", r.counts[1]).replace("{l2}", km(r.lengths_m[1]))}</p></div>`,
        footer: `<button class="btn" id="gpxi-wz-sp-abbruch">${t("common.cancel", "Abbrechen")}</button>
                 <button class="btn" id="gpxi-wz-sp-1">${t("gpxinspect.wz_split_keep1", "Teil 1 behalten")}</button>
                 <button class="btn" id="gpxi-wz-sp-2">${t("gpxinspect.wz_split_keep2", "Teil 2 behalten")}</button>
                 <button class="btn btn-primary" id="gpxi-wz-sp-beide">${t("gpxinspect.wz_split_both", "Beide als Dateien speichern")}</button>`,
      });
      const fertig = (w) => { m.close(); res(w); };
      document.getElementById("gpxi-wz-sp-abbruch").onclick = () => fertig("abbruch");
      document.getElementById("gpxi-wz-sp-1").onclick = () => fertig(1);
      document.getElementById("gpxi-wz-sp-2").onclick = () => fertig(2);
      document.getElementById("gpxi-wz-sp-beide").onclick = () => fertig("beide");
    });
    if (wahl === "abbruch") return;
    if (wahl === "beide") {
      let res;
      try { res = await rzWarten("gpxinspect_save_teile", () => api().gpxinspect_save_teile(r.parts, _srcPath, _sources.length > 1 ? _sources : null)); }
      catch (e) { res = { ok: false, error: String(e) }; }
      if (!res || !res.ok) { toast((res && res.error) || "Speichern fehlgeschlagen", "error", 6000); return; }
      const txt = t("gpxinspect.wz_split_saved", "Gespeichert: ") + (res.pfade || []).join(" · ");
      _wzNote(txt); toast(txt, "success", 7000);
      return;
    }
    _wzUebernehmen(r.parts[wahl - 1], t("gpxinspect.wz_split_undo", "Track geteilt"));
    _wzNote(t("gpxinspect.wz_split_kept", "Teil {k} behalten, der andere ist verworfen (Rückgängig holt ihn zurück).").replace("{k}", wahl));
  }
  async function wzSimplify() {
    const tol = parseFloat(document.getElementById("gpxi-wz-tol")?.value) || 5;
    const r = await _wzAnwenden("simplify", { tol_m: tol }, t("gpxinspect.wz_simplify", "Ausdünnen"));
    if (!r) return;
    if (!r.removed) { toast(t("gpxinspect.wz_simplify_nichts", "Nichts zu entfernen — kein Punkt weicht mehr als {m} m ab.").replace("{m}", tol), "info", 3000); return; }
    _wzUebernehmen(r.points, t("gpxinspect.wz_simplify", "Ausdünnen"));
    _wzNote(t("gpxinspect.wz_simplify_ok", "{n} Punkte entfernt, {k} bleiben (Abweichung ≤ {m} m).").replace("{n}", r.removed).replace("{k}", r.kept).replace("{m}", r.tol_m));
  }
  function _wzRetimeZeilen() {
    const mode = document.getElementById("gpxi-wz-retime-mode")?.value || "shift";
    for (const m of ["shift", "start", "duration"]) { const row = document.getElementById("gpxi-wz-retime-row-" + m); if (row) row.hidden = (m !== mode); }
    if (mode === "start") { const inp = document.getElementById("gpxi-wz-start"); if (inp && !inp.value && _points[0] && _points[0].time) { try { const d = new Date(_points[0].time); const pad = (x) => String(x).padStart(2, "0"); inp.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; } catch (_) {} } }
  }
  async function wzRetime() {
    const mode = document.getElementById("gpxi-wz-retime-mode")?.value || "shift";
    const params = { mode };
    if (mode === "shift") params.shift_s = parseFloat(document.getElementById("gpxi-wz-shift")?.value) || 0;
    if (mode === "start") { const v = document.getElementById("gpxi-wz-start")?.value; if (!v) { toast(t("gpxinspect.wz_retime_start_fehlt", "Bitte eine Startzeit wählen."), "warning", 3000); return; } params.start_iso = new Date(v).toISOString(); }
    if (mode === "duration") params.duration_s = (parseFloat(document.getElementById("gpxi-wz-duration")?.value) || 0) * 60;
    const r = await _wzAnwenden("retime", params, t("gpxinspect.wz_retime", "Zeiten"));
    if (!r) return;
    _wzUebernehmen(r.points, t("gpxinspect.wz_retime_undo", "Zeiten geändert"));
    _wzNote(t("gpxinspect.wz_retime_ok", "Zeiten neu: {a} bis {b}, Dauer {d} min, Ø {v} km/h").replace("{a}", _fmtPtTime(r.start)).replace("{b}", _fmtPtTime(r.end)).replace("{d}", Math.round((r.duration_s || 0) / 60)).replace("{v}", r.avg_kmh != null ? r.avg_kmh : "–"));
  }
  async function wzSplits() {
    const every = parseFloat(document.getElementById("gpxi-wz-every")?.value) || 1;
    const r = await _wzAnwenden("splits", { every_km: every }, t("gpxinspect.wz_splits_run", "Runden-Tabelle"));
    if (!r || !Array.isArray(r.splits)) return;
    const fmtD = (s) => (s == null ? "–" : _fmtDur(s * 1000));
    const rows = r.splits.map((z, i) => `<tr><td>${(i + 1)}</td><td>${z.km.toFixed(2)}</td><td>${(z.dist_m / 1000).toFixed(2)}</td><td>${fmtD(z.duration_s)}</td><td>${z.kmh != null ? z.kmh.toFixed(1) : "–"}</td><td>${Math.round(z.up_m)}</td><td>${Math.round(z.down_m)}</td></tr>`).join("");
    const csv = ["Nr;km bis;Strecke km;Dauer;km/h;Auf m;Ab m"].concat(r.splits.map((z, i) => [i + 1, z.km.toFixed(2), (z.dist_m / 1000).toFixed(2), fmtD(z.duration_s), z.kmh != null ? z.kmh.toFixed(1) : "", Math.round(z.up_m), Math.round(z.down_m)].join(";"))).join("\n");
    const m = openModal({
      title: "📊 " + t("gpxinspect.wz_splits_title", "Runden-Tabelle") + ` (${r.every_km} km · ${r.total_km} km)`,
      body: `<div style="max-height:52vh;overflow:auto"><table class="gpxi-wz-tabelle"><thead><tr><th>#</th><th>${t("gpxinspect.wz_col_km", "km bis")}</th><th>${t("gpxinspect.wz_col_dist", "Strecke")}</th><th>${t("gpxinspect.wz_col_dur", "Dauer")}</th><th>km/h</th><th>↑ m</th><th>↓ m</th></tr></thead><tbody>${rows}</tbody></table></div>`,
      footer: `<button class="btn" id="gpxi-wz-sp-copy">📋 ${t("gpxinspect.wz_copy", "Als Tabelle kopieren")}</button><button class="btn btn-primary" id="gpxi-wz-sp-ok">${t("common.ok", "OK")}</button>`,
    });
    document.getElementById("gpxi-wz-sp-ok").onclick = () => m.close();
    document.getElementById("gpxi-wz-sp-copy").onclick = async () => { try { await navigator.clipboard.writeText(csv); toast(t("gpxinspect.wz_copied", "Tabelle kopiert (Semikolon-getrennt, passt in jede Tabellenkalkulation)."), "success", 3000); } catch (_) { toast(t("bugreport.copy_failed", "Konnte nicht in Zwischenablage kopieren."), "error", 3000); } };
  }
  window.__rzGpxiWerkzeug = { reverse: wzReverse, rotate: wzRotate, split: wzSplit, simplify: wzSimplify, retime: wzRetime, splits: wzSplits,
    punkte: () => _points, ankerA: (i) => { _selA = i; _selB = null; renderPoints(); updateUI(); },
    ankerAB: (a, b) => { _selA = Math.min(a, b); _selB = Math.max(a, b); renderPoints(); updateUI(); } };   // Prüfstand
  // 10.09.2026 (Marc: „der Inspektor muss übersichtlicher werden") — sechs gleiche
  // Klapp-Abschnitte; offen bleibt, was der Nutzer zuletzt offen hatte (settings.json
  // gpxinspect.open_sections). Erster Start: Prüfen, Heilen, Bearbeiten offen.
  (function _gpxiAbschnitte() {
    const secs = Array.from(document.querySelectorAll("details.gpxi-sec"));
    if (!secs.length) return;
    let open;
    try {
      const cur = (typeof window.rzReadModuleSettings === "function") ? (window.rzReadModuleSettings("gpxinspect") || {}) : {};
      open = Array.isArray(cur.open_sections) ? new Set(cur.open_sections) : new Set(["pruefen", "heilen", "bearbeiten"]);
    } catch (_) { open = new Set(["pruefen", "heilen", "bearbeiten"]); }
    if (window.__rzTestAllOpen) open = new Set(secs.map(d => d.dataset.sec));
    secs.forEach(d => {
      d.open = open.has(d.dataset.sec);
      d.addEventListener("toggle", () => {
        if (d.open) open.add(d.dataset.sec); else open.delete(d.dataset.sec);
        try { saveSettings({ gpxinspect: { open_sections: Array.from(open) } }); } catch (_) {}
      });
    });
  })();
  const _on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener("click", fn); };
  _on("gpxi-wz-reverse", wzReverse);
  _on("gpxi-wz-rotate", wzRotate);
  _on("gpxi-wz-split", wzSplit);
  _on("gpxi-wz-simplify", wzSimplify);
  _on("gpxi-wz-retime-run", wzRetime);
  _on("gpxi-wz-splits", wzSplits);
  { const sel = document.getElementById("gpxi-wz-retime-mode"); if (sel) sel.addEventListener("change", _wzRetimeZeilen); }
  _on("gpxi-heal", healSegment);
  _on("gpxi-fill", fillGap);
  _on("gpxi-drawfill", startDraw);
  _on("gpxi-draw-apply", applyDrawnPath);
  _on("gpxi-draw-undo", undoDrawPoint);
  _on("gpxi-draw-cancel", cancelDraw);
  _on("gpxi-delete-one", deletePoint);
  _on("gpxi-ab-archiv", () => {
    if (_selA == null || _selB == null) return;
    const stamm = (_lb && _lb.name) || String(_origPath || _srcPath || "").split("/").pop().replace(/\.[^.]+$/, "") || "Tour";
    _abschnittInsArchiv(Math.min(_selA, _selB), Math.max(_selA, _selB),
      stamm + " – " + t("gpxinspect.abschnitt", "Abschnitt"), "");
  });
  _on("gpxi-trim-before", trimBefore);
  _on("gpxi-trim-after", trimAfter);
  _on("gpxi-delete", deleteBetween);
  _on("gpxi-clearsel", clearSelection);
  _on("gpxi-match-sel", routeSelection);

  // Entf/Backspace: einzelnen Punkt (nur A) oder Bereich (A+B) löschen.
  // Nicht feuern wenn man in einem Eingabefeld tippt oder im Zeichnen-Modus ist.
  function onKeyDown(e) {
    // Logbuch (§68 Q16): Esc hebt die Auswahl auf — nur, wenn das Modul sichtbar ist.
    if (e.key === "Escape") {
      if (_lbMenueEl) { _lbMenueZu(); return; }
      if (_lbPunktModus) { _lbPunktUmschalten(); return; }
      if (_lbSel) {
        const panel = document.getElementById("gpxi-panel");
        if (panel && !panel.hidden && panel.offsetParent) { lbWaehlen(null); return; }
      }
    }
    if (e.key !== "Delete" && e.key !== "Backspace") return;
    if (_drawMode) return;
    const tag = (e.target && e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || (e.target && e.target.isContentEditable)) return;
    const panel = document.getElementById("gpxi-panel");
    if (!panel || panel.hidden || !panel.offsetParent) return;   // Modul nicht sichtbar
    if (_selA !== null && _selB === null) { e.preventDefault(); deletePoint(); }
    else if (_selA !== null && _selB !== null && _selB > _selA + 1) { e.preventDefault(); deleteBetween(); }
  }
  document.addEventListener("keydown", onKeyDown);
  _on("gpxi-undo", () => { if (_undo) _undo.undo(); });
  _on("gpxi-redo", () => { if (_undo) _undo.redo(); });
  _on("gpxi-heal-run", runHeal);
  // 31.08.2026 (der MTB-Kollege eines Beta-Testers): Reduzieren + Tempo
  { const _rEl = document.getElementById("gpxi-reduce-n");
    if (_rEl) _rEl.addEventListener("input", () => { try { reduzierVorschau(); } catch (e) { applog("warn", "[gpxi] Reduzier-Vorschau: " + e); } }); }
  _on("gpxi-reduce-run", () => {
    const _el = document.getElementById("gpxi-reduce-n") || {};
    const ziel = parseInt(_el.value, 10);
    if (!isFinite(ziel) || ziel < 2) {
      toast(t("gpxinspect.reduce_fehlt", "Bitte eine Ziel-Punktzahl eingeben"), "warn");
      return;
    }
    const weg = punkteReduzieren(ziel);
    if (weg > 0) {
      toast(t("gpxinspect.reduce_done", "{n} Punkte entfernt — jetzt {m}")
        .replace("{n}", String(weg)).replace("{m}", String(_points.length)), "success", 3200);
    }
  });
  _on("gpxi-speed-run", () => {
    const _el = document.getElementById("gpxi-speed-v") || {};
    const v = parseFloat(_el.value || _el.placeholder);
    if (!isFinite(v) || v <= 0) {
      toast(t("gpxinspect.speed_fehlt", "Bitte ein Tempo in km/h eingeben"), "warn");
      return;
    }
    if (tempoSetzen(v)) {
      toast(t("gpxinspect.speed_done", "Zeitstempel auf Ø {v} km/h gesetzt")
        .replace("{v}", String(v)), "success", 3200);
    }
  });
  // Wer die Fortbewegungsart selbst wählt, behält seine Wahl — der Vorschlag
  // aus dem Tempo mischt sich dann nicht mehr ein (bis zum nächsten Track).
  { const pf = document.getElementById("gpxi-profile");
    if (pf) pf.addEventListener("change", () => {
      _profilManuell = true;
      const hin = document.getElementById("gpxi-profil-hinweis");
      if (hin) hin.hidden = true;
    }); }
  // Bereichswechsel: die Auswahl-Zeile gehört nur zu „Abschnitt A→B".
  for (const id of ["gpxi-scope-track", "gpxi-scope-ab"]) {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", () => { try { updateUI(); } catch (_) {} });
  }
  { const sc = document.getElementById("gpxi-speedcolor");
    if (sc) sc.addEventListener("change", () => { try { renderSpeedColor(); } catch (_) {} }); }
  // Eigene Ausreißer-Schwelle für die Tempo-Färbung — wie der Tempo-Deckel
  // darüber: überlebt den Neustart, leer heißt automatisch.
  { const st = document.getElementById("gpxi-speed-thr");
    if (st) {
      try {
        const merk = (typeof _settingsCache === "object" && _settingsCache) ? _settingsCache.gpxi_speed_thr : null;
        if (merk != null && merk !== "") st.value = merk;
      } catch (_) {}
      const um = () => {
        try { saveSettings({ gpxi_speed_thr: st.value === "" ? "" : parseFloat(st.value) }); } catch (_) {}
        try { renderSpeedColor(); } catch (_) {}
      };
      st.addEventListener("change", um);
      st.addEventListener("input", um);
    } }
  // Max-Tempo-Deckel überlebt den Neustart (z. B. „15" für Wander-Touren).
  { const tc = document.getElementById("gpxi-tempo-cap");
    if (tc) {
      try {
        const merk = (typeof _settingsCache === "object" && _settingsCache) ? _settingsCache.gpxi_tempo_cap : null;
        if (merk != null && merk !== "") tc.value = merk;
      } catch (_) {}
      tc.addEventListener("change", () => {
        try { saveSettings({ gpxi_tempo_cap: tc.value === "" ? "" : parseFloat(tc.value) }); } catch (_) {}
      });
    } }
  _on("gpxi-baft-close", () => clearBeforeAfter());
  { const bt = document.getElementById("gpxi-before-toggle");
    if (bt) bt.addEventListener("change", () => renderBeforeLine()); }
  // Undo/Redo macht den Vorher/Nachher-Vergleich ungültig (Stand ändert sich).
  for (const id of ["gpxi-undo", "gpxi-redo"]) {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", () => clearBeforeAfter());
  }
  // ?-Erklärblasen. Seit v0.9.501 liegt der Helfer in ui/js/util.js, damit
  // Archiv und Inspektor dieselbe Blase benutzen — vorher gab es ihn nur hier.
  initHelpTips(document.getElementById("gpxi-panel") || body);
  // Empfindlichkeits-Slider: nur Label live.
  { const sl = document.getElementById("gpxi-sens"), lbl = document.getElementById("gpxi-sens-val");
    if (sl) sl.addEventListener("input", () => { if (lbl) lbl.textContent = sl.value; }); }
  // v0.9.294 — Füll-Abstand ändert die Lücken-Vorschau (Geister-Punkte) live nach.
  { const sp = document.getElementById("gpxi-spacing");
    if (sp) sp.addEventListener("input", () => { if (_gaps.length) renderGaps(); }); }
  // v0.9.292 — Höhe korrigieren: Profil laden, live mischen, übernehmen
  // ── Tracks verbinden (v0.9.456) ─────────────────────────────────────────
  async function joinTrack() {
    if (!_points.length) return;
    const note = document.getElementById("gpxi-join-note");
    let files;
    try {
      // 09.09.2026 — aus dem Archiv wählen (Datei von außerhalb: dort importieren).
      if (typeof window.rzArchivTourenWaehlen === "function") {
        files = await window.rzArchivTourenWaehlen({ einzel: true,
          titel: t("gpxinspect.join_pick", "Track zum Verbinden wählen"), okText: t("gpxinspect.join_ok", "Verbinden") });
      } else {
        files = await api().pick_file("open", window.TRACK_PICK_FILTER || [], false);
      }
    } catch (_) { files = null; }
    const path = files && files.length ? files[0] : null;
    if (!path) return;   // abgebrochen

    const mode = (document.getElementById("gpxi-join-mode") || {}).value || "append";
    const pause = parseNum((document.getElementById("gpxi-join-pause") || {}).value, 0);
    // v0.9.522 — gemeinsames Warte-Muster aus util.js statt Eigenbau.
    const frei = knopfBeschaeftigt("gpxi-join", "gpxinspect.join_working", "Hänge an …");
    await malPause();
    let res;
    try {
      res = await rzWarten("gpxinspect_append_track", () => api().gpxinspect_append_track(
        _points.map(p => ({ lat: p.lat, lon: p.lon, ele: p.ele, time: p.time, oi: p.oi, si: p.si || 0 })),
        path, mode, pause, _sources.length));
    } catch (e) { res = { ok: false, error: String(e) }; }
    if (frei) frei();
    if (isUnmounted) return;
    if (!res || !res.ok) {
      const msg = (res && res.error) || t("gpxinspect.join_failed", "Anhängen fehlgeschlagen");
      if (note) note.textContent = msg;
      toast(msg, "error", 6000);
      return;
    }

    _pushUndo(t("gpxinspect.join_undo", "Track anhängen"));
    _sources.push(res.src);
    _points = (res.points || []).map(p => ({ lat: p.lat, lon: p.lon, ele: p.ele,
                                             time: p.time, oi: p.oi, si: p.si || 0 }));
    _hasTime = _points.some(p => !!p.time);
    _hasSensors = true;   // konservativ: die neue Quelle kann welche mitbringen
    _selA = _selB = null; _dirty = true;
    clearSpikes(); _eleInvalidate();
    renderAll(); updateUI();
    try { fitTrack(null); } catch (_) {}

    // Die Naht ehrlich benennen statt sie zu kaschieren. Der Nutzer entscheidet,
    // ob die Lücke bleibt (echte Pause) oder per Heilen geschlossen wird.
    const m = res.meta || {};
    const parts = [t("gpxinspect.join_added", "Angehängt:") + " " + (res.name || "") +
                   " (+" + (m.count_b || 0) + " " + t("gpxinspect.points", "Punkte") + ")"];
    if (m.gap_m != null) {
      // Nahtstellen sind oft nur ein paar Meter — _fmtKm würde daraus „0.0 km"
      // machen. Und _fmtDur rechnet in Millisekunden, gap_s kommt in Sekunden.
      const gapTxt = m.gap_m < 1000 ? Math.round(m.gap_m) + " m" : _fmtKm(m.gap_m);
      parts.push(t("gpxinspect.join_gap", "Lücke an der Naht:") + " " + gapTxt
                 + (m.gap_s != null ? " / " + _fmtDur(m.gap_s * 1000) : ""));
    }
    if (m.time_mode === "shifted") {
      parts.push(t("gpxinspect.join_shifted", "Zeiten des angehängten Tracks nach hinten verschoben (er überlappte)."));
    } else if (m.time_mode === "none") {
      parts.push(t("gpxinspect.join_notime", "Ohne Zeitstempel — Reihenfolge wie gewählt."));
    }
    parts.push(t('gpxinspect.join_hint', 'Die Lücke schließt du mit „Heilen → Lücken mit Punkten füllen“.'));
    if (note) note.textContent = parts.join(" · ");
    toast(parts[0], "success", 5000);
  }
  _on("gpxi-join", joinTrack);

  _on("gpxi-ele-load", loadEleProfile);
  _on("gpxi-ele-apply", applyEleBlend);
  { const ew = document.getElementById("gpxi-ele-weight"), ewl = document.getElementById("gpxi-ele-weight-val");
    if (ew) ew.addEventListener("input", () => { if (ewl) ewl.textContent = ew.value + " %"; drawEleProfile(); }); }
  // v0.9.293 — Profil-Interaktion: Klick=Modal, Doppelklick=Anker, Rad=Zoom, Drag=Pan
  { const psvg = document.getElementById("gpxi-eleprof-svg");
    if (psvg) {
      psvg.addEventListener("click", onProfileClick);
      psvg.addEventListener("dblclick", onProfileDblClick);
      psvg.addEventListener("wheel", onProfileWheel, { passive: false });
      psvg.addEventListener("pointerdown", onProfileDown);
      psvg.addEventListener("pointermove", onProfileMove);
      psvg.addEventListener("mousemove", onProfileHover);            // v0.9.294 — Track-Ring zeigen
      psvg.addEventListener("mouseleave", _hideHover);
      window.addEventListener("pointerup", onProfileUp);
    } }
  // 03.09.2026 — Gelände gibt es mit jeder Quelle; die Sperre „nur mit Token" ist weg.
  _on("gpxi-save", saveTrack);
  _on("gpxi-reset", () => { if (_srcPath) loadTrack(_srcPath); });

  // ── Logbuch der Tour (13.09.2026, docs/LOGBUCH.md §68, Stufe 1) ─────────────
  // Marc: „wie wäre es, wenn der inspector eine art logbuch generiert, was wo war
  // … wenn man einen eintrag anklickt, wird der bereich des tracks hervorgehoben
  // … als zeitstrahl darstellen ist fast noch besser oder wir machen beides."
  // Unten im Inspektor: Zeitstrahl über die ganze Breite (Spuren Tage · Bewegung
  // mit Höhenprofil · Punkte), rechts daneben das mitlaufende Logbuch (Q6).
  // Beides zeigt dieselben Daten aus der Brücke `logbuch_lesen` — die Einteilung
  // „Bewegung" der Tour (Q2), gelesen nach den Regeln Q5/Q7/Q8 (core/logbuch).
  // Kopplung (Q16): Eintrag → Bereich leuchtet, Karte zoomt · Klick auf den Track
  // → Eintrag gewählt · Hover → Marke im Zeitstrahl · Esc hebt auf.
  const _LB_FARBE = { fahrt: "#3b82f6", uebersetzen: "#14b8a6", gehen: "#22c55e", wanderung: "#22c55e",
                      spaziergang: "#4ade80", rad: "#f97316", laufen: "#eab308", pause: "#6b7280",
                      uebernachtung: "#4b5563", halt: "#9ca3af", unsicher: "#8b8fa3", wassersport: "#0ea5e9" };
  const _LB_ICON = { fahrt: "🚗", uebersetzen: "⛴", gehen: "🚶", wanderung: "🥾", spaziergang: "🚶", rad: "🚴",
                     laufen: "🏃", pause: "☕", uebernachtung: "🌙", halt: "⏸", unsicher: "❓", wassersport: "🛶", punkt: "📍", poi: "⭐",
                     hoechster_punkt: "⛰", start: "🏁", ziel: "🏁" };
  const _LB_ARTEN_DE = { fahrt: "Fahrt", uebersetzen: "Fähre", gehen: "Gehen", wanderung: "Wanderung",
                         spaziergang: "Spaziergang", rad: "Rad", laufen: "Laufen", pause: "Pause",
                         uebernachtung: "Übernachtung", halt: "Halt", unsicher: "Rad oder Laufen?", wassersport: "Wassersport",
                         hoechster_punkt: "Höchster Punkt", start: "Start", ziel: "Ziel", punkt: "Eigener Punkt", poi: "Sehenswürdigkeit" };
  let _LB_H_AKTIV = 156;                   // Höhe des Zeitstrahls (px) — je nach sichtbaren Spuren (Stufe 4)
  let _LB_ZEILEN_AKTIV = { tage: [3, 17], bewegung: [23, 87], punkte: [91, 109], pois: [113, 131], achse: [135, 153] };
  let _lb = null;            // Antwort der Brücke (Einträge, Punkte, Tage, roh …)
  let _lbSel = null;         // Kennung des gewählten Eintrags
  let _lbAlles = false;      // Schalter „alles zeigen" (Q5: rohe Bereiche samt kurzer Halte)
  let _lbFenster = null;     // [t0, t1] sichtbarer Ausschnitt; null = ganze Reise
  let _lbZeiten = null;      // Epoch je Punkt (Index ↔ Zeit), lazy
  let _lbZeitSort = null;    // { t: Float64Array, i: Int32Array } — nur Punkte MIT Zeit, nach Zeit sortiert (für die Suche)
  let _lbHover = null;       // Index unter dem Zeiger (für den Cursor im Strahl)
  let _lbRO = null;          // ResizeObserver des Strahls
  let _lbRAF = 0;
  let _lbPfad = null;        // für welche Datei das Logbuch gilt

  const _lbEl = (id) => document.getElementById(id);
  const _lbEsc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const _lbArt = (art) => t("logbuch.art." + art, _LB_ARTEN_DE[art] || art);
  const _lbFarbe = (art) => _LB_FARBE[art] || "#8b8fa3";
  function _lbDatum(tEpoch, versatz) { return new Date((tEpoch + (versatz || 0) * 60) * 1000); }
  function _lbUhr(tEpoch, versatz) {
    try { return _lbDatum(tEpoch, versatz).toLocaleTimeString(rzSprachCode(), { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }); }
    catch (_) { return ""; }
  }
  function _lbTagText(tEpoch, versatz, lang) {
    try { return _lbDatum(tEpoch, versatz).toLocaleDateString(rzSprachCode(), Object.assign({ timeZone: "UTC" }, lang)); }
    catch (_) { return ""; }
  }
  function _lbDauer(s) {
    s = Math.max(0, Math.round(s || 0));
    const h = Math.floor(s / 3600), m = Math.round((s - h * 3600) / 60);
    if (h && m) return t("logbuch.dauer_hm", "{h} h {m} min", { h, m });
    if (h) return t("logbuch.dauer_h", "{h} h", { h });
    return t("logbuch.dauer_m", "{m} min", { m });
  }
  function _lbKm(m) {
    if (!m) return "";
    if (m < 950) return Math.round(m) + " m";
    return (m / 1000).toLocaleString(rzSprachCode(), { maximumFractionDigits: m < 20000 ? 1 : 0 }) + " km";
  }
  function _lbZeitenBauen() {
    _lbZeiten = new Array(_points.length);
    const paare = [];
    for (let i = 0; i < _points.length; i++) {
      const d = _points[i].time ? Date.parse(_points[i].time) : NaN;
      _lbZeiten[i] = isFinite(d) ? d / 1000 : NaN;
      if (isFinite(d)) paare.push(i);
    }
    // 14.09.2026: Suchtabelle ohne Lücken — vorher fiel die Zweiteilung beim ersten Punkt ohne Zeit
    // auf lineares Suchen zurück (je Mausbewegung über den ganzen Track).
    let sortiert = true;
    for (let k = 1; k < paare.length; k++) if (_lbZeiten[paare[k]] < _lbZeiten[paare[k - 1]]) { sortiert = false; break; }
    if (!sortiert) paare.sort((a, b) => _lbZeiten[a] - _lbZeiten[b]);
    const T = new Float64Array(paare.length), I = new Int32Array(paare.length);
    for (let k = 0; k < paare.length; k++) { I[k] = paare[k]; T[k] = _lbZeiten[paare[k]]; }
    _lbZeitSort = { t: T, i: I };
    return _lbZeiten;
  }
  /** Punkt-Index zur Uhrzeit — die Einträge sind nach Uhrzeit gespeichert, nie nach Nummer. */
  function _lbIdxZuZeit(tEpoch) {
    if (!_lbZeiten || !_lbZeitSort) _lbZeitenBauen();
    const T = _lbZeitSort.t, I = _lbZeitSort.i, n = T.length;
    if (!n || !isFinite(tEpoch)) return -1;
    let lo = 0, hi = n - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (T[mid] < tEpoch) lo = mid + 1; else hi = mid; }
    // lo = erster Eintrag ≥ tEpoch; der Nachbar davor kann näher liegen
    if (lo > 0 && Math.abs(T[lo - 1] - tEpoch) <= Math.abs(T[lo] - tEpoch)) lo--;
    return I[lo];
  }
  function _lbIndexBereich(e) {
    const a = _lbIdxZuZeit(e.t0), b = _lbIdxZuZeit(e.t1);
    return (a < 0 || b < 0) ? null : [Math.min(a, b), Math.max(a, b)];
  }
  /** Die Einträge, die gerade gelten: das Logbuch — oder mit „alles zeigen" die rohen Bereiche. */
  function _lbEintraege() {
    if (!_lb) return [];
    if (!_lbAlles) return _lb.eintraege || [];
    const v0 = (_lb.eintraege && _lb.eintraege[0] && _lb.eintraege[0].versatz_min) || 0;
    return (_lb.roh || []).filter(b => b.t1 > b.t0).map(b => ({
      id: b.id, bids: [b.id], art: b.art, art_roh: b.art, anzeige_art: b.art, name: b.name || "",
      quelle: b.quelle, t0: b.t0, t1: b.t1, dauer_s: b.t1 - b.t0, strecke_m: b.strecke_m || 0,
      tempo_kmh: b.tempo_kmh || 0, hoehe_auf: 0, hoehe_ab: 0, geraten: false, roh: true,
      versatz_min: v0, tag: _lbTagZu(b.t0),
    }));
  }
  function _lbTagZu(tEpoch) {
    const d = (_lb && _lb.tage || []).find(x => x.t0 - 1 <= tEpoch && tEpoch <= x.t1 + 1);
    return d ? d.nr : ((_lb && _lb.tage && _lb.tage.length) ? _lb.tage[_lb.tage.length - 1].nr : 1);
  }
  function _lbSpanne() {
    if (_lbFenster) return _lbFenster;
    const es = _lbEintraege(), ps = (_lb && _lb.punkte) || [];
    let t0 = Infinity, t1 = -Infinity;
    for (const e of es) { t0 = Math.min(t0, e.t0); t1 = Math.max(t1, e.t1); }
    for (const p of ps) { t0 = Math.min(t0, p.t); t1 = Math.max(t1, p.t); }
    if (!isFinite(t0)) return null;
    const pad = Math.max(60, (t1 - t0) * 0.01);
    return [t0 - pad, t1 + pad];
  }

  // ── Laden ────────────────────────────────────────────────────────────────
  async function logbuchLaden(neu, opt) {
    opt = opt || {};
    const wrap = _lbEl("gpxi-logbuch"), pfad = _origPath;
    if (!wrap) return;
    if (!pfad || !_points.length) { wrap.hidden = true; _lb = null; _lbStandMerken(null); return; }
    _lbPfad = pfad;
    let r;
    try { r = await rzWarten("logbuch_lesen", () => api().logbuch_lesen(pfad, !!neu)); }
    catch (e) { r = { ok: false, error: String(e) }; }
    if (isUnmounted || _lbPfad !== pfad || _origPath !== pfad) return;
    const behalten = opt.auswahl || null, fensterAlt = opt.auswahl ? _lbFenster : null;
    _lbSel = null; _lbFenster = fensterAlt; _lbHover = null;
    _lbHighlight(null);
    wrap.hidden = false;
    const note = _lbEl("gpxi-lb-hinweis"), koerper = _lbEl("gpxi-lb-koerper");
    if (!r || !r.ok) {
      _lb = null;
      const txt = (r && r.grund === "nicht_im_archiv")
        ? t("logbuch.nicht_im_archiv", "Diese Datei liegt nicht im Archiv — das Logbuch gibt es für Touren im Archiv.")
        : (r && r.grund === "ohne_zeit")
          ? t("logbuch.ohne_zeit", "Der Track hat keine Zeitstempel — ohne Uhrzeit gibt es kein Logbuch.")
          : ((r && r.error) || t("logbuch.fehler", "Das Logbuch konnte nicht erstellt werden."));
      if (note) { note.textContent = txt; note.hidden = false; }
      if (koerper) koerper.hidden = true;
      _lbStandMerken(null); _lbSummeRender(); _lbKnoepfe();
      try { _lbFensterAufKarte(true); } catch (_) {}   // kein Logbuch → kein Saum
      return;
    }
    _lb = r;
    _lbStandMerken(r);
    try { await _lbEigeneLaden(); } catch (e) { applog && applog("warn", "[logbuch] eigene Spuren: " + e); }
    if (note) note.hidden = true;
    if (koerper) koerper.hidden = _lbZuIst();
    applog && applog("info", `[logbuch] ${(r.eintraege || []).length} Einträge, ${(r.punkte || []).length} Punkte, ${(r.tage || []).length} Tage, Zone ${r.zone}`);
    logbuchRender();
    _lbKnoepfe();
    if (behalten && _lbFinde(behalten)) lbWaehlen(behalten, { zoom: false, scroll: false });
    try { _lbFensterRender(); } catch (_) {}
    // Saum auf der Karte zum (neuen) Ausschnitt nachziehen — ohne die Karte zu verschieben (_lbAusKarte)
    _lbAusKarte = true; try { _lbFensterAufKarte(true); } catch (_) {} finally { _lbAusKarte = false; }
    // Stufe 3: Ortsnamen und POIs im Hintergrund — beim Öffnen ganz, nach Änderungen nur aus dem Cache
    if (!opt.ohneNetz) { try { _lbNetzNachladen(opt.auswahl !== undefined && opt.auswahl !== null ? { nurCache: true } : null); } catch (_) {} }
  }
  function _lbZuIst() { const w = _lbEl("gpxi-logbuch"); return !!(w && w.classList.contains("ist-zu")); }
  function logbuchLeeren() {
    _lb = null; _lbSel = null; _lbFenster = null; _lbZeiten = null; _lbZeitSort = null; _lbPfad = null; _lbFensterLetzte = null;
    _lbStandMerken(null); _lbPunktModus = false; try { _lbKnoepfe(); } catch (_) {}
    _lbOrte = {}; _lbPois = []; _lbNetzLauf++; if (_lbGross) { _lbFensterMerken(); _lbGross.hidden = true; } _lbEigene = [];
    const w = _lbEl("gpxi-logbuch"); if (w) w.hidden = true;
    _lbHighlight(null);
    try { _lbInfoZu(); _lbKartenMarken(true); _lbFensterAufKarte(true); } catch (_) {}
  }

  // ── Rendern ──────────────────────────────────────────────────────────────
  function logbuchRender() {
    if (!_lb) return;
    _lbSummeRender();
    _lbListeRender();
    _lbStrahlRender();
    const raus = _lbEl("gpxi-lb-reise"); if (raus) raus.hidden = !_lbFenster;
  }
  function _lbSummeRender() {
    const el = _lbEl("gpxi-lb-summe"); if (!el) return;
    if (!_lb) { el.innerHTML = ""; return; }
    const z = _lb.zusammenfassung || {};
    const teile = [];
    const mitDauer = ["fahrt", "rad", "laufen"], mitZahl = ["uebersetzen", "wanderung", "spaziergang", "gehen", "wassersport", "pause", "uebernachtung", "unsicher"];
    for (const art of mitDauer) if (z[art]) teile.push(`<span class="gpxi-lb-chip" style="--c:${_lbFarbe(art)}">${_LB_ICON[art] || ""} ${_lbDauer(z[art].dauer_s)} ${_lbArt(art)}</span>`);
    for (const art of mitZahl) if (z[art]) {
      const n = z[art].anzahl;
      const name = n === 1 ? _lbArt(art) : t("logbuch.mehrzahl." + art, _lbArt(art));
      teile.push(`<span class="gpxi-lb-chip" style="--c:${_lbFarbe(art)}">${_LB_ICON[art] || ""} ${n} ${name}</span>`);
    }
    if (_lb.hoechster && _lb.hoechster.ele != null) {
      teile.push(`<span class="gpxi-lb-chip" style="--c:#c084fc">⛰ ${t("logbuch.hoechster", "höchster Punkt {m} m", { m: Math.round(_lb.hoechster.ele).toLocaleString(rzSprachCode()) })}</span>`);
    }
    el.innerHTML = teile.join("");
  }
  function _lbZeileHtml(e) {
    const gew = e.id === _lbSel ? " ist-gewaehlt" : "";
    const meta = [];
    meta.push(_lbUhr(e.t0, e.versatz_min) + " – " + _lbUhr(e.t1, e.versatz_min));
    { const ort = _lbOrtText(e); if (ort) meta.push(ort); }
    meta.push(_lbDauer(e.dauer_s));
    if (e.strecke_m > 50) meta.push(_lbKm(e.strecke_m));
    if (e.hoehe_auf >= 20) meta.push("↑" + e.hoehe_auf + " m");
    if (e.tempo_kmh && e.art !== "pause") meta.push(e.tempo_kmh.toLocaleString(rzSprachCode(), { maximumFractionDigits: 1 }) + " km/h");
    const artName = _lbArt(e.anzeige_art);
    const name = e.name ? `${_lbEsc(e.name)} <small>${artName}</small>` : artName;
    const geraten = e.geraten ? ` <button type="button" class="gpxi-lb-badge ist-vermutet" data-vermutet="${e.id}" title="${t("logbuch.geraten_tip2", "Die Erkennung war hier unsicher. Klick: bestätigen oder eine andere Art wählen.")}">${t("logbuch.geraten", "vermutet")}</button>` : "";
    const roh = e.roh ? ` <span class="gpxi-lb-badge">${t("logbuch.roh", "roh")}</span>` : "";
    const notiz = e.notiz ? `<div class="gpxi-lb-notiz">${_lbEsc(e.notiz)}</div>` : "";
    return `<div class="gpxi-lb-zeile${gew}" data-lb="${e.id}" style="--c:${_lbFarbe(e.anzeige_art)}">
      <span class="gpxi-lb-icon">${_LB_ICON[e.anzeige_art] || "•"}</span>
      <div class="gpxi-lb-text"><div class="gpxi-lb-name">${name}${geraten}${roh}</div><div class="gpxi-lb-meta">${meta.join(" · ")}</div>${notiz}</div>
      <button type="button" class="gpxi-lb-mehr" title="${t("logbuch.menue.titel", "Bearbeiten")}">⋯</button></div>`;
  }
  function _lbPunktHtml(p) {
    const gew = p.id === _lbSel ? " ist-gewaehlt" : "";
    const txt = p.art === "hoechster_punkt"
      ? `${_lbArt(p.art)} · ${Math.round(p.ele || 0).toLocaleString(rzSprachCode())} m`
      : (p.name ? `${_lbEsc(p.name)} <small>${_lbArt(p.art)}</small>` : _lbArt(p.art));
    const notiz = p.notiz ? `<div class="gpxi-lb-notiz">${_lbEsc(p.notiz)}</div>` : "";
    const ortP = _lbOrtText(p);
    return `<div class="gpxi-lb-zeile ist-punkt${p.art === "punkt" || p.art === "poi" ? " ist-eigen" : ""}${gew}" data-lb="${p.id}"><span class="gpxi-lb-icon">${p.symbol || _LB_ICON[p.art] || "•"}</span>
      <div class="gpxi-lb-text"><div class="gpxi-lb-name">${txt}</div><div class="gpxi-lb-meta">${_lbUhr(p.t, p.versatz_min)}${ortP ? " · " + _lbEsc(ortP) : ""}</div>${notiz}</div>
      <button type="button" class="gpxi-lb-mehr" title="${t("logbuch.menue.titel", "Bearbeiten")}">⋯</button></div>`;
  }
  function _lbListeRender() {
    const el = _lbEl("gpxi-lb-liste"); if (!el || !_lb) return;
    const es = _lbEintraege(), ps = _lbPunkteSichtbar();
    const zeilen = es.map(e => ({ t: e.t0, tag: e.tag, html: _lbZeileHtml(e), rang: 1 }))
      .concat(ps.map(p => ({ t: p.t, tag: p.tag, html: _lbPunktHtml(p), rang: p.art === "start" ? 0 : (p.art === "ziel" ? 2 : 1) })));
    zeilen.sort((a, b) => (a.t - b.t) || (a.rang - b.rang));
    let html = "";
    if (_lb.mehrtaegig) {
      const tage = new Map();
      for (const d of _lb.tage || []) tage.set(d.nr, d);
      let letzter = null;
      for (const z of zeilen) {
        if (z.tag !== letzter) {
          const d = tage.get(z.tag);
          const km = es.filter(e => e.tag === z.tag).reduce((s, e) => s + (e.strecke_m || 0), 0);
          const titel = t("logbuch.tag", "Tag {n}", { n: z.tag }) + (d ? " · " + _lbTagText(d.t0, d.versatz_min, { weekday: "short", day: "numeric", month: "long" }) : "");
          html += `<div class="gpxi-lb-tag" data-lb-tag="${z.tag}" title="${t("logbuch.tag_tip", "Klick: diesen Tag im Zeitstrahl aufziehen")}"><span>${titel}</span><span class="gpxi-lb-tag-meta">${km > 50 ? _lbKm(km) : ""}</span></div>`;
          letzter = z.tag;
        }
        html += z.html;
      }
    } else {
      html = zeilen.map(z => z.html).join("");
    }
    if (!zeilen.length) html = `<div class="gpxi-lb-leer">${t("logbuch.leer", "Nichts erkannt — der Track ist zu kurz oder hat keine Bewegung.")}</div>`;
    el.innerHTML = html;
    el.querySelectorAll("[data-lb]").forEach(z => z.addEventListener("click", () => lbWaehlen(z.dataset.lb, { zoom: true })));
    el.querySelectorAll("[data-vermutet]").forEach(bt => bt.addEventListener("click", (ev) => {
      ev.stopPropagation(); const r = bt.getBoundingClientRect();
      _lbEintragMenue(_lbFinde(bt.dataset.vermutet), r.left, r.bottom + 2, null);
    }));
    el.querySelectorAll("[data-lb-tag]").forEach(z => z.addEventListener("click", () => _lbTagZoom(parseInt(z.dataset.lbTag, 10))));
  }
  function _lbTagZoom(nr) {
    const d = (_lb && _lb.tage || []).find(x => x.nr === nr); if (!d) return;
    if (_lbFenster && Math.abs(_lbFenster[0] - d.t0) < 1 && Math.abs(_lbFenster[1] - d.t1) < 1) _lbFenster = null;
    else _lbFenster = [d.t0 - Math.max(120, (d.t1 - d.t0) * 0.02), d.t1 + Math.max(120, (d.t1 - d.t0) * 0.02)];
    logbuchRender();
    _lbFensterAufKarte(true, true);
  }

  // Zeitstrahl: SVG in Pixelkoordinaten des Behälters — Texte bleiben scharf.
  function _lbStrahlRender() {
    const svg = _lbEl("gpxi-lb-svg"), box = _lbEl("gpxi-lb-svgbox");
    if (!svg || !box || !_lb) return;
    try { _lbSpurenAnpassen(); } catch (_) {}
    const W = Math.max(80, Math.floor(box.clientWidth)), H = _LB_H_AKTIV;
    const sp = _lbSpanne();
    if (!sp || W < 100) { svg.innerHTML = ""; return; }
    const [f0, f1] = sp, span = Math.max(1, f1 - f0);
    const X = (tEpoch) => ((tEpoch - f0) / span) * W;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("width", W); svg.setAttribute("height", H);
    const Z = _LB_ZEILEN_AKTIV;
    const versatz = (_lb.eintraege && _lb.eintraege[0] && _lb.eintraege[0].versatz_min) || ((_lb.tage || [])[0] || {}).versatz_min || 0;
    let s = `<defs><pattern id="gpxi-lb-streifen" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
        <rect width="8" height="8" fill="#6b7280"/><rect width="4" height="8" fill="#9ca3af"/></pattern>
      <clipPath id="gpxi-lb-clip"><rect x="0" y="0" width="${W}" height="${H}"/></clipPath></defs>`;
    // Hintergrund der Spuren
    s += `<rect x="0" y="${Z.bewegung[0]}" width="${W}" height="${Z.bewegung[1] - Z.bewegung[0]}" class="gpxi-lb-spurbg"/>`;
    s += `<rect x="0" y="${Z.punkte[0]}" width="${W}" height="${Z.punkte[1] - Z.punkte[0]}" class="gpxi-lb-spurbg"/>`;
    // Tage
    const tage = _lb.tage || [];
    tage.forEach((d, k) => {
      const x0 = Math.max(0, X(d.t0)), x1 = Math.min(W, X(d.t1)); if (x1 <= 0 || x0 >= W) return;
      const w = Math.max(2, x1 - x0);
      const lang = w > 120 ? { weekday: "short", day: "numeric", month: "numeric" } : (w > 60 ? { day: "numeric", month: "numeric" } : null);
      const txt = lang ? t("logbuch.tag", "Tag {n}", { n: d.nr }) + " · " + _lbTagText(d.t0, d.versatz_min, lang) : (w > 16 ? String(d.nr) : "");
      s += `<g class="gpxi-lb-tagblock${k % 2 ? " ist-zweiter" : ""}" data-lb-tag="${d.nr}"><rect x="${x0.toFixed(1)}" y="${Z.tage[0]}" width="${w.toFixed(1)}" height="${Z.tage[1] - Z.tage[0]}" rx="3"/>`
         + (txt ? `<text x="${(x0 + 5).toFixed(1)}" y="${Z.tage[0] + 10.5}">${_lbEsc(txt)}</text>` : "") + `<title>${_lbEsc(t("logbuch.tag", "Tag {n}", { n: d.nr }) + " · " + _lbTagText(d.t0, d.versatz_min, { weekday: "long", day: "numeric", month: "long", year: "numeric" }))}</title></g>`;
    });
    // Bewegung: ein Block je Eintrag
    const y0 = Z.bewegung[0] + 3, hB = Z.bewegung[1] - Z.bewegung[0] - 6;
    for (const e of _lbEintraege()) {
      const x0 = X(e.t0), x1 = X(e.t1); if (x1 < 0 || x0 > W) continue;
      const xa = Math.max(-2, x0), xb = Math.min(W + 2, x1), w = Math.max(1.5, xb - xa);
      const still = e.art === "pause" || e.art === "halt";
      const fill = e.anzeige_art === "unsicher" ? "url(#gpxi-lb-streifen)" : _lbFarbe(e.anzeige_art);
      const cls = "gpxi-lb-block" + (still ? " ist-still" : "") + (e.id === _lbSel ? " ist-gewaehlt" : "") + (e.geraten ? " ist-geraten" : "");
      const name = e.name || _lbArt(e.anzeige_art);
      const label = w > 34 ? (_LB_ICON[e.anzeige_art] || "") + " " + name : "";
      const passt = label && (label.length * 6.4 + 10) < w;
      const zeile2 = w > 64 ? _lbDauer(e.dauer_s) + (e.strecke_m > 950 && w > 96 ? " · " + _lbKm(e.strecke_m) : "") : "";
      s += `<g class="${cls}" data-lb="${e.id}"><rect x="${xa.toFixed(1)}" y="${y0}" width="${w.toFixed(1)}" height="${hB}" rx="4" fill="${fill}"/>`
         + (passt ? `<text class="gpxi-lb-bl1" x="${(xa + 6).toFixed(1)}" y="${y0 + 18}">${_lbEsc(label)}</text>` : (w > 22 ? `<text class="gpxi-lb-bl1" x="${(xa + w / 2).toFixed(1)}" y="${y0 + 18}" text-anchor="middle">${_LB_ICON[e.anzeige_art] || ""}</text>` : ""))
         + (zeile2 && passt ? `<text class="gpxi-lb-bl2" x="${(xa + 6).toFixed(1)}" y="${y0 + 36}">${_lbEsc(zeile2)}</text>` : "")
         + `<title>${_lbEsc(name + " · " + _lbUhr(e.t0, e.versatz_min) + " – " + _lbUhr(e.t1, e.versatz_min) + " · " + _lbDauer(e.dauer_s) + (e.strecke_m > 50 ? " · " + _lbKm(e.strecke_m) : ""))}</title></g>`;
    }
    // Höhenprofil als Silhouette über der Bewegungsspur (Q15) — über den Blöcken,
    // sonst deckt die Farbe es zu; nimmt keine Klicks an.
    s += _lbProfilPfad(X, f0, f1, Z.bewegung[0], Z.bewegung[1]);
    // Punkte
    if (!_lbAlles) {
      const yP = (Z.punkte[0] + Z.punkte[1]) / 2;
      let letzteX = -Infinity;
      for (const p of _lbPunkteSichtbar().slice().sort((a, b) => a.t - b.t)) {
        const x = X(p.t); if (x < -4 || x > W + 4) continue;
        const gew = p.id === _lbSel ? " ist-gewaehlt" : "";
        let form;
        if (p.art === "hoechster_punkt") form = `<path d="M${x.toFixed(1)} ${(yP - 6).toFixed(1)} l6 11 h-12 z" class="gpxi-lb-pt-hoch"/>`;
        else if (p.art === "start") form = `<circle cx="${x.toFixed(1)}" cy="${yP.toFixed(1)}" r="4.5" class="gpxi-lb-pt-start"/>`;
        else form = `<rect x="${(x - 4).toFixed(1)}" y="${(yP - 4).toFixed(1)}" width="8" height="8" rx="1.5" class="gpxi-lb-pt-ziel"/>`;
        const txt = p.art === "hoechster_punkt" && p.ele != null ? Math.round(p.ele).toLocaleString(rzSprachCode()) + " m" : "";
        const label = (txt && x - letzteX > 54) ? `<text x="${(x + 8).toFixed(1)}" y="${(yP + 4).toFixed(1)}" class="gpxi-lb-pt-txt">${txt}</text>` : "";
        if (txt) letzteX = x;
        s += `<g class="gpxi-lb-punkt${gew}" data-lb="${p.id}">${form}${label}<title>${_lbEsc(_lbArt(p.art) + (txt ? " · " + txt : "") + " · " + _lbUhr(p.t, p.versatz_min))}</title></g>`;
      }
    }
    // Zeitachse
    if (Z.pois) s += `<rect x="0" y="${Z.pois[0]}" width="${W}" height="${Z.pois[1] - Z.pois[0]}" class="gpxi-lb-spurbg"/>`;
    try { s += _lbEigeneRender(X, W); } catch (_) {}
    try { s += _lbBefundeRender(X, W); } catch (_) {}
    s += _lbAchse(X, f0, f1, W, versatz, Z.achse[0]);
    svg.innerHTML = s;
    try { _lbPoisRender(); } catch (_) {}
    try { _lbKartenMarken(); } catch (_) {}
    svg.querySelectorAll("[data-lb]").forEach(g => g.addEventListener("click", (ev) => { ev.stopPropagation(); lbWaehlen(g.dataset.lb, { zoom: true }); }));
    svg.querySelectorAll("[data-lb-tag]").forEach(g => g.addEventListener("dblclick", (ev) => { ev.stopPropagation(); _lbTagZoom(parseInt(g.dataset.lbTag, 10)); }));
    _lbCursor(_lbHover);
  }
  function _lbProfilPfad(X, f0, f1, yTop, yBot) {
    if (!_hasEle || _points.length < 2) return "";
    const z = _lbZeiten || _lbZeitenBauen();
    const n = z.length, schritt = Math.max(1, Math.floor(n / 900));
    let lo = Infinity, hi = -Infinity;
    const pts = [];
    for (let i = 0; i < n; i += schritt) {
      const tI = z[i], e = _points[i].ele;
      if (!isFinite(tI) || e == null || !isFinite(e) || tI < f0 || tI > f1) continue;
      pts.push([X(tI), e]); if (e < lo) lo = e; if (e > hi) hi = e;
    }
    if (pts.length < 2 || !isFinite(lo)) return "";
    if (hi - lo < 5) hi = lo + 5;
    const Y = (e) => yBot - 2 - ((e - lo) / (hi - lo)) * (yBot - yTop - 6);
    let d = `M${pts[0][0].toFixed(1)} ${(yBot - 2).toFixed(1)}`;
    for (const [x, e] of pts) d += ` L${x.toFixed(1)} ${Y(e).toFixed(1)}`;
    d += ` L${pts[pts.length - 1][0].toFixed(1)} ${(yBot - 2).toFixed(1)} Z`;
    return `<path d="${d}" class="gpxi-lb-profil"/>`;
  }
  function _lbAchse(X, f0, f1, W, versatz, y) {
    const span = f1 - f0;
    const stufen = [900, 1800, 3600, 7200, 10800, 21600, 43200, 86400, 172800, 604800, 1209600];
    let schritt = stufen[stufen.length - 1];
    for (const st of stufen) { if (W / (span / st) >= 78) { schritt = st; break; } }
    const off = (versatz || 0) * 60;
    let s = `<line x1="0" y1="${y}" x2="${W}" y2="${y}" class="gpxi-lb-achse"/>`;
    const start = Math.floor((f0 + off) / schritt) * schritt - off;
    const mitDatum = schritt >= 86400;
    for (let tt = start; tt <= f1; tt += schritt) {
      const x = X(tt); if (x < 0 || x > W) continue;
      const lok = _lbDatum(tt, versatz);
      const mitternacht = lok.getUTCHours() === 0 && lok.getUTCMinutes() === 0;
      const txt = mitDatum || mitternacht
        ? _lbTagText(tt, versatz, { weekday: "short", day: "numeric", month: "numeric" })
        : _lbUhr(tt, versatz);
      s += `<line x1="${x.toFixed(1)}" y1="${y}" x2="${x.toFixed(1)}" y2="${y + 4}" class="gpxi-lb-achse"/>`
         + `<text x="${(x + 3).toFixed(1)}" y="${y + 14}" class="gpxi-lb-achse-txt${mitternacht ? " ist-tag" : ""}">${_lbEsc(txt)}</text>`;
    }
    return s;
  }

  // ── Kopplung (Q16) ───────────────────────────────────────────────────────
  function _lbFinde(id) {
    if (!_lb || !id) return null;
    const e = _lbEintraege().find(x => x.id === id); if (e) return e;
    return (_lb.punkte || []).find(x => x.id === id) || null;
  }
  function lbWaehlen(id, opt) {
    opt = opt || {};
    const e = _lbFinde(id);
    _lbSel = e ? e.id : null;
    const liste = _lbEl("gpxi-lb-liste");
    if (liste) liste.querySelectorAll("[data-lb]").forEach(z => z.classList.toggle("ist-gewaehlt", z.dataset.lb === _lbSel));
    const svg = _lbEl("gpxi-lb-svg");
    if (svg) svg.querySelectorAll("[data-lb]").forEach(g => g.classList.toggle("ist-gewaehlt", g.dataset.lb === _lbSel));
    if (!e) { _lbHighlight(null); return; }
    if (liste && opt.scroll !== false) {
      const z = liste.querySelector(`[data-lb="${e.id}"]`);
      if (z) { try { z.scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch (_) { z.scrollIntoView(); } }
    }
    if (!_lbIstPunkt(e)) {
      _lbInfoZu();
      const lage = _lbIndexBereich(e);
      _lbHighlight(lage ? { von: lage[0], bis: lage[1], farbe: _lbFarbe(e.anzeige_art) } : null);
      if (opt.zoom && lage) _lbKarteZu(lage[0], lage[1]);
    } else {
      const i = e.idx != null ? e.idx : _lbIdxZuZeit(e.t);
      _lbHighlight(i >= 0 ? { punkt: i, farbe: "#c084fc" } : null);
      try { _lbPunktZeigen(e, !opt.zoom); } catch (_) {}
    }
    try { _lbKartenMarken(); } catch (_) {}
    // Ist der Eintrag außerhalb des Ausschnitts, zeigt der Strahl ihn trotzdem (springen)
    const sp = _lbSpanne(), ta = e.t0 != null ? e.t0 : e.t;
    if (_lbFenster && sp && (ta < sp[0] || ta > sp[1])) { _lbFenster = null; logbuchRender(); }
  }
  /** Klick auf den Track: der Eintrag, in dem der Punkt liegt (ohne Zoom, Q16). */
  function _lbWaehleZuIdx(i) {
    if (!_lb || i == null || i < 0) return;
    const z = _lbZeiten || _lbZeitenBauen(); const tt = z[i]; if (!isFinite(tt)) return;
    const e = _lbEintraege().find(x => x.t0 <= tt && tt <= x.t1);
    if (e && e.id !== _lbSel) lbWaehlen(e.id, { zoom: false });
  }
  function _lbKarteZu(a, b) {
    if (!map || a == null || b == null) return;
    let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
    for (let i = a; i <= b; i++) { const p = _points[i]; if (!p) continue; if (p.lon < minLon) minLon = p.lon; if (p.lon > maxLon) maxLon = p.lon; if (p.lat < minLat) minLat = p.lat; if (p.lat > maxLat) maxLat = p.lat; }
    if (!isFinite(minLon)) return;
    if (maxLon - minLon < 1e-4 && maxLat - minLat < 1e-4) { minLon -= 0.002; maxLon += 0.002; minLat -= 0.0015; maxLat += 0.0015; }
    try { _syncing = true; map.fitBounds([[minLon, minLat], [maxLon, maxLat]], { padding: 70, duration: 650, maxZoom: 15 }); }
    catch (_) {} finally { setTimeout(() => { _syncing = false; }, 700); }
  }
  function _lbHighlight(h) {
    if (!map) return;
    try {
      const src = map.getSource("gpxi-lb-hl"); if (!src) return;
      if (!h) { src.setData({ type: "FeatureCollection", features: [] }); return; }
      const feats = [];
      if (h.punkt != null) {
        const p = _points[h.punkt];
        if (p) feats.push({ type: "Feature", properties: { c: h.farbe, pt: true }, geometry: { type: "Point", coordinates: [p.lon, p.lat] } });
      } else {
        const coords = [];
        for (let i = h.von; i <= h.bis; i++) { const p = _points[i]; if (p) coords.push([p.lon, p.lat]); }
        if (coords.length === 1) coords.push(coords[0]);
        if (coords.length) feats.push({ type: "Feature", properties: { c: h.farbe, pt: false }, geometry: { type: "LineString", coordinates: coords } });
      }
      src.setData({ type: "FeatureCollection", features: feats });
    } catch (_) {}
  }
  /** Marke im Zeitstrahl für den Punkt unter dem Zeiger (Karte oder Höhenprofil). */
  function _lbCursor(idx) {
    _lbHover = idx;
    const cur = _lbEl("gpxi-lb-cursor"), box = _lbEl("gpxi-lb-svgbox");
    if (!cur || !box || !_lb) return;
    const sp = _lbSpanne();
    if (idx == null || idx < 0 || !sp) { cur.hidden = true; return; }
    const z = _lbZeiten || _lbZeitenBauen(); const tt = z[idx];
    if (!isFinite(tt) || tt < sp[0] || tt > sp[1]) { cur.hidden = true; return; }
    const x = ((tt - sp[0]) / (sp[1] - sp[0])) * box.clientWidth;
    cur.style.left = x.toFixed(1) + "px";
    const versatz = (_lb.eintraege && _lb.eintraege[0] && _lb.eintraege[0].versatz_min) || 0;
    cur.querySelector("span").textContent = _lbUhr(tt, versatz);
    cur.classList.toggle("ist-rechts", x > box.clientWidth - 70);
    cur.hidden = false;
  }
  function _lbIdxAnX(clientX) {
    const box = _lbEl("gpxi-lb-svgbox"), sp = _lbSpanne(); if (!box || !sp) return -1;
    const r = box.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - r.left) / Math.max(1, r.width)));
    return _lbIdxZuZeit(sp[0] + frac * (sp[1] - sp[0]));
  }
  function _lbZoom(faktor, clientX) {
    const sp = _lbSpanne(); if (!sp) return;
    const box = _lbEl("gpxi-lb-svgbox"); const r = box.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - r.left) / Math.max(1, r.width)));
    const mitte = sp[0] + frac * (sp[1] - sp[0]);
    let neu = (sp[1] - sp[0]) * faktor;
    const ganz = (function () { const f = _lbFenster; _lbFenster = null; const g = _lbSpanne(); _lbFenster = f; return g; })();
    if (!ganz) return;
    if (neu >= (ganz[1] - ganz[0])) { _lbFenster = null; logbuchRender(); _lbFensterAufKarte(false, true); return; }
    neu = Math.max(600, neu);
    let a = mitte - frac * neu, b = a + neu;
    if (a < ganz[0]) { a = ganz[0]; b = a + neu; }
    if (b > ganz[1]) { b = ganz[1]; a = b - neu; }
    _lbFenster = [a, b];
    logbuchRender();
    _lbFensterAufKarte();
  }
  function _lbVerdrahten() {
    const svg = _lbEl("gpxi-lb-svg"), box = _lbEl("gpxi-lb-svgbox");
    if (!svg || !box) return;
    box.addEventListener("mousemove", (e) => { const i = _lbIdxAnX(e.clientX); if (i >= 0) setHover(i); });
    box.addEventListener("mouseleave", () => setHover(null));
    box.addEventListener("wheel", (e) => { e.preventDefault(); _lbZoom(e.deltaY > 0 ? 1.35 : 1 / 1.35, e.clientX); }, { passive: false });
    box.addEventListener("dblclick", (e) => { if (e.target === svg || e.target === box) { _lbFenster = null; logbuchRender(); _lbFensterAufKarte(true, true); } });
    _on("gpxi-lb-reise", () => { _lbFenster = null; logbuchRender(); _lbFensterAufKarte(true, true); });
    _on("gpxi-lb-neu", () => logbuchLaden(true));
    { const a = _lbEl("gpxi-lb-alles"); if (a) a.addEventListener("change", () => { _lbAlles = !!a.checked; _lbSel = null; _lbHighlight(null); logbuchRender(); }); }
    _on("gpxi-lb-zu", () => {
      const w = _lbEl("gpxi-logbuch"); if (!w) return;
      const zu = !w.classList.contains("ist-zu");
      w.classList.toggle("ist-zu", zu);
      const k = _lbEl("gpxi-lb-koerper"); if (k) k.hidden = zu || !_lb;
      const kn = _lbEl("gpxi-lb-zu"); if (kn) { kn.textContent = zu ? "▴" : "▾"; kn.title = zu ? t("logbuch.auf", "Logbuch aufklappen") : t("logbuch.zu", "Logbuch einklappen"); }
      try { saveSettings({ gpxi_logbuch_zu: zu }); } catch (_) {}
      if (!zu) { _lbStrahlRender(); setTimeout(() => { try { map && map.resize(); } catch (_) {} }, 60); }
    });
    try {
      if (_settingsCache && _settingsCache.gpxi_logbuch_zu) {
        const w = _lbEl("gpxi-logbuch"); w.classList.add("ist-zu");
        const kn = _lbEl("gpxi-lb-zu"); if (kn) { kn.textContent = "▴"; kn.title = t("logbuch.auf", "Logbuch aufklappen"); }
      }
    } catch (_) {}
    if (typeof ResizeObserver === "function") {
      _lbRO = new ResizeObserver(() => { if (_lbRAF) return; _lbRAF = requestAnimationFrame(() => { _lbRAF = 0; if (_lb) _lbStrahlRender(); }); });
      _lbRO.observe(box);
    }
  }
  _lbVerdrahten();
  // ── Logbuch Stufe 2 — Bearbeiten + Einstellungen (docs/LOGBUCH.md §4, Q12/Q13) ──
  // Marc: „man muss natürlich alles ändern können" und „Undo für alles". Jede
  // Änderung geht über `einteilung_aktion` (Handarbeit überlebt jede Neuberechnung);
  // der Stand der Einteilung steckt im Undo-Schnappschuss des Inspektors, ⌘Z
  // schreibt ihn über `einteilung_stand_setzen` zurück.
  const _LB_HAND_ARTEN = ["fahrt", "uebersetzen", "wanderung", "spaziergang", "rad", "laufen", "wassersport", "pause"];
  let _lbStand = null;       // vollständiger Stand der Einteilung „Bewegung" (für ⌘Z)
  let _lbEinst = null;       // { global, tour } — Einstellungen (für ⌘Z)
  let _lbPunktModus = false; // nächster Kartenklick setzt einen eigenen Punkt
  let _lbZiehen = null;      // laufendes Grenze-Ziehen im Zeitstrahl
  let _lbMenueEl = null;
  let _lbMenueWeg = null;    // Klick-außerhalb-Listener des Menüs (wird beim Schließen abgemeldet)

  function _lbStandMerken(r) {
    _lbStand = r && r.stand ? JSON.parse(JSON.stringify(r.stand)) : null;
    _lbEinst = r ? { global: r.einst_global || {}, tour: r.einst_tour || {} } : null;
  }
  /** Für den Undo-Schnappschuss des Inspektors: was das Logbuch gerade ist. */
  function _lbSchnappschuss() {
    return { lb: _lbStand ? JSON.parse(JSON.stringify(_lbStand)) : null,
             lbEinst: _lbEinst ? JSON.parse(JSON.stringify(_lbEinst)) : null, lbPfad: _lbPfad,
             lbEigen: _lbEigeneSchnappschuss() };
  }
  /** ⌘Z/⌘⇧Z: Stand der Einteilung und Einstellungen zurückschreiben, dann neu lesen. */
  async function _lbUndoAnwenden(snap) {
    if (!snap || !_lb || !snap.lbPfad || snap.lbPfad !== _lbPfad) return;
    let neu = false;
    try {
      if (snap.lb && JSON.stringify(snap.lb) !== JSON.stringify(_lbStand)) {
        await api().einteilung_stand_setzen(_lb.eid, snap.lb, _lb.tour);   // warte-ok: Teil des Undo-Schritts
        neu = true;
      }
      if (snap.lbEinst && JSON.stringify(snap.lbEinst) !== JSON.stringify(_lbEinst)) {
        await api().logbuch_einstellungen_stand(_lbPfad, snap.lbEinst);   // warte-ok: Teil des Undo-Schritts
        neu = true;
      }
    } catch (e) { applog && applog("warn", "[logbuch] undo: " + e); }
    try { if (await _lbEigeneUndo(snap.lbEigen)) neu = neu || false; } catch (_) {}
    if (neu) await logbuchLaden(false, { auswahl: _lbSel });
  }
  async function _lbAktion(label, aktion, params, opt) {
    if (!_lb) return null;
    opt = opt || {};
    const vorher = opt.ohneUndo ? null : _undoSnap();   // Undo-Schritt erst nach Erfolg (14.09.2026)
    let r;
    try { r = await rzWarten("einteilung_aktion", () => api().einteilung_aktion(_lb.eid, aktion, params)); }
    catch (e) { r = { ok: false, error: String(e) }; }
    if (isUnmounted) return null;
    if (!r || !r.ok) {
      toast((r && r.error) || t("logbuch.fehler_aktion", "Das ging nicht"), "error", 5000);
      return null;
    }
    if (vorher) { _pushUndoMit(label, vorher); try { updateUI(); } catch (_) {} }   // ↩︎-Knopf wird erst durch updateUI freigegeben
    await logbuchLaden(false, { auswahl: opt.auswahl === undefined ? _lbSel : opt.auswahl });
    return r;
  }
  /** Vermutete Einträge festschreiben: die angezeigte Art wird Handarbeit (ein ⌘Z-Schritt). */
  async function _lbBestaetigen(es) {
    const teile = (es || []).filter(e => e && !_lbIstPunkt(e) && e.geraten).map(e => ({ bids: e.bids, art: e.anzeige_art }));
    if (!teile.length) { toast(t("logbuch.nichts_vermutet", "Nichts Vermutetes ausgewählt."), "info", 2500); return null; }
    const label = teile.length === 1 ? t("logbuch.undo.bestaetigen", "Logbuch: Art bestätigt")
                                     : t("logbuch.undo.bestaetigen_n", "Logbuch: {n} Arten bestätigt", { n: teile.length });
    return _lbAktion(label, "bestaetigen", { teile });
  }
  /** Kleiner Frage-Dialog: ein Text (oder eine Notiz), OK/Abbrechen — null = abgebrochen. */
  function _lbFrage(titel, wert, mehrzeilig) {
    return new Promise((resolve) => {
      const feld = mehrzeilig
        ? `<textarea id="gpxi-lb-frage" class="gpxi-lb-frage" rows="4">${_lbEsc(wert || "")}</textarea>`
        : `<input id="gpxi-lb-frage" class="gpxi-lb-frage" type="text" value="${_lbEsc(wert || "")}">`;
      const m = openModal({ title: titel, body: `<div class="lib-fmodal">${feld}</div>`,
        footer: `<button class="btn" id="gpxi-lb-frage-nein">${t("common.cancel", "Abbrechen")}</button>
                 <button class="btn btn-primary" id="gpxi-lb-frage-ja">${t("common.ok", "OK")}</button>` });
      const el = document.getElementById("gpxi-lb-frage");
      const fertig = (v) => { try { m.close(); } catch (_) {} resolve(v); };
      const ja = document.getElementById("gpxi-lb-frage-ja"), nein = document.getElementById("gpxi-lb-frage-nein");
      if (ja) ja.onclick = () => fertig(el ? el.value : "");
      if (nein) nein.onclick = () => fertig(null);
      if (el) {
        el.focus(); try { el.select(); } catch (_) {}
        if (!mehrzeilig) el.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); fertig(el.value); } });
      }
    });
  }

  // ── Kontextmenü ──────────────────────────────────────────────────────────
  function _lbMenueZu() {
    if (_lbMenueEl) { try { _lbMenueEl.remove(); } catch (_) {} _lbMenueEl = null; }
    // 14.09.2026: Listener immer abmelden — vorher blieb er nach jedem Klick auf einen Eintrag hängen (einer je Menü)
    if (_lbMenueWeg) { try { document.removeEventListener("mousedown", _lbMenueWeg, true); } catch (_) {} _lbMenueWeg = null; }
  }
  function _lbMenue(x, y, eintraege) {
    _lbMenueZu();
    const el = document.createElement("div");
    el.className = "gpxi-lb-menue";
    el.innerHTML = eintraege.map((m, k) => m === "-" ? `<div class="gpxi-lb-menue-strich"></div>`
      : `<button type="button" class="gpxi-lb-menue-eintrag${m.unter ? " ist-unter" : ""}${m.aus ? " ist-aus" : ""}" data-k="${k}"${m.aus ? " disabled" : ""}>${m.symbol ? `<span class="gpxi-lb-menue-symbol">${m.symbol}</span>` : ""}${_lbEsc(m.text)}</button>`).join("");
    document.body.appendChild(el);
    const r = el.getBoundingClientRect();
    el.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 6)) + "px";
    el.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 6)) + "px";
    el.querySelectorAll("[data-k]").forEach(b => b.addEventListener("click", (ev) => {
      ev.stopPropagation(); const m = eintraege[parseInt(b.dataset.k, 10)]; _lbMenueZu(); if (m && m.tu) m.tu();
    }));
    _lbMenueEl = el;
    const weg = (ev) => { if (_lbMenueEl === el && !el.contains(ev.target)) _lbMenueZu(); };
    _lbMenueWeg = weg;
    setTimeout(() => { if (_lbMenueWeg === weg) document.addEventListener("mousedown", weg, true); }, 0);
  }
  function _lbNachbar(e, richtung) {
    const es = _lbEintraege().slice().sort((a, b) => a.t0 - b.t0);
    const k = es.findIndex(x => x.id === e.id);
    return k < 0 ? null : es[k + richtung] || null;
  }
  /** Punkte i0..i1 des Tracks als NEUE Tour ins Archiv (14.09.2026). Fragt den Namen, zeigt danach
   *  „Im Archiv zeigen“ und „Wieder entfernen“ — der Track im Inspektor bleibt unverändert. */
  async function _abschnittInsArchiv(i0, i1, vorschlag, art) {
    if (!(i1 > i0) || !_points[i0] || !_points[i1]) return;
    const name = await _lbFrage(t("gpxinspect.ab_archiv_name", "Name der neuen Tour"), vorschlag || "");
    if (name === null) return;
    const payload = _points.slice(i0, i1 + 1).map(p => ({ lat: p.lat, lon: p.lon, ele: p.ele, time: p.time, oi: p.oi, si: p.si || 0 }));
    let r;
    try {
      r = await rzWarten("archiv_abschnitt_aufnehmen", () => api().archiv_abschnitt_aufnehmen(payload, _srcPath || "", String(name).trim(),
        _sources.length > 1 ? _sources : null, art || ""), {
        titel: t("warte.archiv_abschnitt_aufnehmen.titel", "Neue Tour wird angelegt"),
        text: t("warte.archiv_abschnitt_aufnehmen.text", "Der Abschnitt wird ins Archiv aufgenommen"),
      });
    } catch (err) { r = { ok: false, error: String(err) }; }
    if (isUnmounted) return;
    if (!r || !r.ok) { toast((r && r.error) || t("gpxinspect.ab_archiv_fehler", "Die Tour konnte nicht angelegt werden."), "error", 6000); return; }
    applog && applog("info", `[inspektor] Abschnitt #${i0}–#${i1} als Tour ins Archiv: ${r.pfad}`);
    const m = openModal({
      title: "📥 " + t("gpxinspect.ab_archiv_ok_titel", "Neue Tour im Archiv"),
      body: `<p>${t("gpxinspect.ab_archiv_ok", "„{name}“ liegt jetzt als eigene Tour im Archiv ({n} Punkte). Der Track hier ist unverändert.", { name: _lbEsc(r.name), n: r.punkte })}</p>`,
      footer: `<button class="btn" id="gpxi-aba-weg">${t("gpxinspect.ab_archiv_weg", "Wieder entfernen")}</button>
               <button class="btn" id="gpxi-aba-bleiben">${t("gpxinspect.ab_archiv_bleiben", "Hier weiterarbeiten")}</button>
               <button class="btn btn-primary" id="gpxi-aba-zeigen">${t("gpxinspect.ab_archiv_zeigen", "Im Archiv zeigen")}</button>`,
    });
    const knopf = (id, fn) => { const b = document.getElementById(id); if (b) b.onclick = fn; };
    knopf("gpxi-aba-bleiben", () => m.close());
    knopf("gpxi-aba-zeigen", () => {
      m.close();
      window.__rzArchivZeigen = { geo: r.geo_hash ? [r.geo_hash] : [], pfade: [r.pfad] };
      try { switchMod("library"); } catch (_) {}
    });
    knopf("gpxi-aba-weg", async () => {
      m.close();
      const w = await api().library_trash(r.pfad);
      if (w && w.ok) toast(t("gpxinspect.ab_archiv_entfernt", "Die neue Tour ist wieder entfernt (Papierkorb)."), "info");
      else toast((w && w.error) || "?", "error", 6000);
    });
    return r;
  }
  try { window.__rzAbschnittInsArchiv = _abschnittInsArchiv; } catch (_) {}

  function _lbEintragMenue(e, x, y, tHier, opt) {
    if (!e || _lbAlles) return;
    opt = opt || {};
    const istPunkt = _lbIstPunkt(e);
    const M = [];
    // 14.09.2026 (Marc: „wie kann ich vermutete Bewegungsarten bestätigen?")
    if (!istPunkt && e.geraten) {
      M.push({ symbol: "✓", text: t("logbuch.menue.bestaetigen", "{art} bestätigen", { art: _lbArt(e.anzeige_art) }), tu: () => _lbBestaetigen([e]) });
      M.push("-");
    }
    if (istPunkt) M.push({ symbol: "🗺", text: t("logbuch.menue.karte_zeigen", "Auf der Karte zeigen"), tu: () => lbWaehlen(e.id, { zoom: true }) });
    M.push({ symbol: "✏️", text: t("logbuch.menue.umbenennen", "Umbenennen …"), tu: async () => {
      const v = await _lbFrage(t("logbuch.frage.name", "Name des Eintrags"), e.name || "");
      if (v === null) return;
      await _lbAktion(t("logbuch.undo.umbenennen", "Logbuch: umbenennen"), "aendern", istPunkt ? { bid: e.id, name: v } : { bids: e.bids, name: v });
    } });
    M.push({ symbol: "📝", text: t("logbuch.menue.notiz", "Notiz …"), tu: async () => {
      const v = await _lbFrage(t("logbuch.frage.notiz", "Notiz zu diesem Eintrag"), e.notiz || "", true);
      if (v === null) return;
      await _lbAktion(t("logbuch.undo.notiz", "Logbuch: Notiz"), "aendern", istPunkt ? { bid: e.id, notiz: v } : { bids: e.bids, notiz: v });
    } });
    if (!istPunkt) {
      M.push("-");
      M.push({ text: t("logbuch.menue.art", "Art ändern"), aus: true });
      for (const art of _LB_HAND_ARTEN) {
        if (art === e.anzeige_art) continue;
        M.push({ unter: true, symbol: _LB_ICON[art] || "", text: _lbArt(art), tu: () =>
          _lbAktion(t("logbuch.undo.art", "Logbuch: Art ändern"), "aendern", { bids: e.bids, art }) });
      }
      M.push("-");
      const teilbar = (tt) => tt != null && tt > e.t0 + 30 && tt < e.t1 - 30;
      const teilen = (tt) => _lbAktion(t("logbuch.undo.teilen", "Logbuch: Aktivität teilen"), "teilen_zeit", { t: tt });
      if (teilbar(tHier)) M.push({ symbol: "✂️", text: t("logbuch.menue.teilen_hier", "Aktivität hier teilen ({z})", { z: _lbUhr(tHier, e.versatz_min) }), tu: () => teilen(tHier) });
      // Marc, 13.09.2026: „ich würde gern die aktivität teilen" — in der Liste kennt das Menü
      // keine Stelle. Also: am Anker A (wenn er im Eintrag liegt) oder an einer Uhrzeit.
      const zA = (_selA !== null) ? (_lbZeiten || _lbZeitenBauen())[_selA] : NaN;
      if (isFinite(zA) && teilbar(zA)) M.push({ symbol: "✂️", text: t("logbuch.menue.teilen_anker", "Aktivität bei Anker A teilen ({z})", { z: _lbUhr(zA, e.versatz_min) }), tu: () => teilen(zA) });
      M.push({ symbol: "✂️", text: t("logbuch.menue.teilen_uhrzeit", "Aktivität bei Uhrzeit teilen …"), tu: async () => {
        const v = await _lbFrage(t("logbuch.frage.uhrzeit", "Uhrzeit (Ortszeit), z. B. 12:30"), _lbUhr((e.t0 + e.t1) / 2, e.versatz_min));
        if (v === null) return;
        const m = /^(\d{1,2})[:.](\d{2})$/.exec(String(v).trim());
        if (!m) { toast(t("logbuch.uhrzeit_ungueltig", "Bitte eine Uhrzeit wie 12:30 eingeben."), "warn"); return; }
        // Die Uhrzeit auf den Tag des Eintragsbeginns legen (Ortszeit); liegt sie davor, ist der nächste Tag gemeint.
        const tag0 = _lbDatum(e.t0, e.versatz_min); tag0.setUTCHours(parseInt(m[1], 10), parseInt(m[2], 10), 0, 0);
        let tt = tag0.getTime() / 1000 - (e.versatz_min || 0) * 60;
        if (tt < e.t0) tt += 86400;
        if (!teilbar(tt)) { toast(t("logbuch.uhrzeit_ausserhalb", "Diese Uhrzeit liegt nicht in diesem Eintrag."), "warn"); return; }
        await teilen(tt);
      } });
      M.push({ symbol: "✂️", text: t("logbuch.menue.teilen_mitte", "Aktivität in der Mitte teilen"), aus: !teilbar((e.t0 + e.t1) / 2), tu: () => teilen((e.t0 + e.t1) / 2) });
      const vor = _lbNachbar(e, -1), nach = _lbNachbar(e, +1);
      M.push({ symbol: "⇤", text: t("logbuch.menue.mit_vorherigem", "Mit vorherigem zusammenlegen"), aus: !vor, tu: () =>
        _lbAktion(t("logbuch.undo.zusammenlegen", "Logbuch: zusammenlegen"), "zusammenlegen", { bid_a: vor.bids[vor.bids.length - 1], bid_b: e.bids[0] }, { auswahl: null }) });
      M.push({ symbol: "⇥", text: t("logbuch.menue.mit_naechstem", "Mit nächstem zusammenlegen"), aus: !nach, tu: () =>
        _lbAktion(t("logbuch.undo.zusammenlegen", "Logbuch: zusammenlegen"), "zusammenlegen", { bid_a: e.bids[e.bids.length - 1], bid_b: nach.bids[0] }, { auswahl: null }) });
      M.push("-");
      // 14.09.2026 (Marc/Beta-Tester: Autofahrt und Wanderung in einer Datei) — den Eintrag als eigene Tour
      M.push({ symbol: "📥", text: t("logbuch.menue.als_tour", "Als eigene Tour ins Archiv …"), tu: () => {
        const z = _lbZeiten || _lbZeitenBauen();
        let i0 = -1, i1 = -1;
        for (let i = 0; i < z.length; i++) {
          if (!(z[i] >= e.t0 && z[i] <= e.t1)) continue;
          if (i0 < 0) i0 = i;
          i1 = i;
        }
        if (i0 < 0 || i1 <= i0) { toast(t("gpxinspect.abschnitt_zu_kurz", "Der Abschnitt braucht mindestens zwei Punkte."), "warn"); return; }
        const tag = _lbDatum(e.t0, e.versatz_min);
        const datum = tag.getUTCDate() + "." + (tag.getUTCMonth() + 1) + "." + tag.getUTCFullYear();
        _abschnittInsArchiv(i0, i1, e.name || (_lbArt(e.anzeige_art) + " " + datum), e.anzeige_art || e.art || "");
      } });
      M.push("-");
      M.push({ symbol: "🗑", text: t("logbuch.menue.loeschen", "Löschen (geht im Nachbarn auf)"), tu: () =>
        _lbAktion(t("logbuch.undo.loeschen", "Logbuch: löschen"), "aufgehen", { bids: e.bids }, { auswahl: null }) });
    } else {
      M.push("-");
      M.push({ symbol: "🗑", text: t("logbuch.menue.punkt_loeschen", "Punkt löschen"), tu: () => _lbPunktLoeschen(e) });
    }
    if (opt.idx != null && opt.idx >= 0) {
      M.push("-");
      M.push({ symbol: "📍", text: t("logbuch.menue.punkt_hier", "Eigenen Punkt hier setzen …"), tu: () => { _lbPunktModus = true; _lbPunktSetzen(opt.idx); } });
      M.push({ symbol: "Ⓐ", text: t("logbuch.menue.anker_hier", "Anker A/B hier setzen"), tu: () => { try { selectAnchor(opt.idx); } catch (_) {} } });
    }
    _lbMenue(x, y, M);
  }
  /** Der rohe Bereich eines (zusammengesetzten) Eintrags, in dem eine Zeit liegt. */
  function _lbRohBeiZeit(e, tt) {
    const roh = (_lb && _lb.roh || []).filter(b => e.bids.includes(b.id) && b.t0 <= tt && tt <= b.t1);
    return roh.length ? roh[0].id : e.bids[0];
  }

  // ── Grenzen im Zeitstrahl ziehen ─────────────────────────────────────────
  function _lbGrenzeBei(clientX) {
    const box = _lbEl("gpxi-lb-svgbox"), sp = _lbSpanne(); if (!box || !sp || _lbAlles) return null;
    const r = box.getBoundingClientRect();
    const es = _lbEintraege().slice().sort((a, b) => a.t0 - b.t0);
    for (let k = 0; k + 1 < es.length; k++) {
      const x = ((es[k].t1 - sp[0]) / (sp[1] - sp[0])) * r.width;
      if (Math.abs(clientX - r.left - x) <= 6 && Math.abs(es[k + 1].t0 - es[k].t1) < 1) return { links: es[k], rechts: es[k + 1], x: r.left + x };
    }
    return null;
  }
  function _lbZeitAnX(clientX) {
    const box = _lbEl("gpxi-lb-svgbox"), sp = _lbSpanne(); if (!box || !sp) return null;
    const r = box.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - r.left) / Math.max(1, r.width)));
    return sp[0] + frac * (sp[1] - sp[0]);
  }
  function _lbZiehenVerdrahten() {
    const box = _lbEl("gpxi-lb-svgbox"); if (!box) return;
    box.addEventListener("pointermove", (e) => {
      if (_lbZiehen) {
        const tt = Math.min(_lbZiehen.rechts.t1 - 60, Math.max(_lbZiehen.links.t0 + 60, _lbZeitAnX(e.clientX)));
        _lbZiehen.t = tt;
        const cur = _lbEl("gpxi-lb-cursor");
        if (cur) { const r = box.getBoundingClientRect(), sp = _lbSpanne();
          cur.style.left = (((tt - sp[0]) / (sp[1] - sp[0])) * r.width).toFixed(1) + "px";
          cur.querySelector("span").textContent = _lbUhr(tt, _lbZiehen.links.versatz_min); cur.hidden = false; }
        return;
      }
      box.style.cursor = _lbGrenzeBei(e.clientX) ? "col-resize" : "";
    });
    box.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const g = _lbGrenzeBei(e.clientX); if (!g) return;
      e.preventDefault(); e.stopPropagation();
      _lbZiehen = Object.assign({ t: g.links.t1 }, g);
      try { box.setPointerCapture(e.pointerId); } catch (_) {}
    });
    const ende = async (e) => {
      if (!_lbZiehen) return;
      const z = _lbZiehen; _lbZiehen = null;
      try { box.releasePointerCapture(e.pointerId); } catch (_) {}
      if (Math.abs(z.t - z.links.t1) < 15) return;
      await _lbAktion(t("logbuch.undo.grenze", "Logbuch: Grenze verschoben"), "grenze",
        { bid_links: z.links.bids[z.links.bids.length - 1], bid_rechts: z.rechts.bids[0], t: z.t });
    };
    box.addEventListener("pointerup", ende);
    box.addEventListener("pointercancel", () => { _lbZiehen = null; });
    box.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const g = e.target.closest("[data-lb]"); if (!g) return;
      _lbEintragMenue(_lbFinde(g.dataset.lb), e.clientX, e.clientY, _lbZeitAnX(e.clientX));
    });
  }

  // ── Eigener Bereich A→B, eigener Punkt, Einstellungen ────────────────────
  function _lbKnoepfe() {
    const ab = _lbEl("gpxi-lb-ab"); if (ab) ab.disabled = !(_lb && _selA !== null && _selB !== null && !_lbAlles);
    const pk = _lbEl("gpxi-lb-punkt"); if (pk) { pk.disabled = !_lb || _lbAlles; pk.classList.toggle("ist-an", _lbPunktModus); }
    const zr = _lbEl("gpxi-lb-einst"); if (zr) zr.disabled = !_lb;
  }
  function _lbBereichAB(ev) {
    if (!_lb || _selA === null || _selB === null) return;
    const z = _lbZeiten || _lbZeitenBauen();
    const t0 = z[Math.min(_selA, _selB)], t1 = z[Math.max(_selA, _selB)];
    if (!isFinite(t0) || !isFinite(t1) || t1 - t0 < 30) { toast(t("logbuch.ab_zu_kurz", "Der Abschnitt A→B ist zu kurz für einen Eintrag."), "warn"); return; }
    const M = [{ text: t("logbuch.menue.art_fuer_ab", "Art des neuen Eintrags"), aus: true }];
    for (const art of _LB_HAND_ARTEN) M.push({ unter: true, symbol: _LB_ICON[art] || "", text: _lbArt(art), tu: async () => {
      const r = await _lbAktion(t("logbuch.undo.bereich", "Logbuch: Bereich A→B"), "setzen", { t0, t1, art, name: "" }, { auswahl: null });
      if (r) { try { clearSelection(); } catch (_) {} }
    } });
    M.push("-");
    const r = ev && ev.currentTarget ? ev.currentTarget.getBoundingClientRect() : { left: 400, bottom: 300 };
    _lbEigenAnlegen(t0, t1).then(E => { _lbMenue(r.left, r.bottom + 4, M.concat(E)); });
  }
  function _lbPunktUmschalten() {
    _lbPunktModus = !_lbPunktModus;
    _lbKnoepfe();
    if (_lbPunktModus) { _setCursor("crosshair"); toast(t("logbuch.punkt_modus", "Klick auf die Karte setzt den Punkt — Esc bricht ab."), "info", 4000); }
    else _setCursor("");
  }
  /** Aus onMapClick: im Punkt-Modus wird der nächste Track-Punkt ein eigener Eintrag. */
  async function _lbPunktSetzen(i) {
    if (!_lbPunktModus) return false;
    _lbPunktModus = false; _setCursor(""); _lbKnoepfe();
    const z = _lbZeiten || _lbZeitenBauen(); const tt = z[i]; const p = _points[i];
    if (!p || !isFinite(tt)) return true;
    const name = await _lbFrage(t("logbuch.frage.punkt_name", "Name des Punkts"), "");
    if (name === null) return true;
    await _lbAktion(t("logbuch.undo.punkt", "Logbuch: Punkt gesetzt"), "punkt", { t: tt, art: "punkt", name, lat: p.lat, lon: p.lon, ele: p.ele });
    return true;
  }
  function _lbEinstellungen() {
    if (!_lb) return;
    const w = _lb.einstellungen || {}, je = _lb.einst_tour || {};
    const hatTour = Object.keys(je).length > 0;
    const zeile = (id, label, wert, einheit, schritt) => `<label class="gpxi-lb-einst-zeile"><span>${label}</span><input type="number" id="${id}" value="${wert}" step="${schritt}" min="0"> <small>${einheit}</small></label>`;
    const m = openModal({
      title: "⚙ " + t("logbuch.einst.titel", "Logbuch-Einstellungen"),
      body: `<div class="lib-fmodal gpxi-lb-einst">
        ${zeile("gpxi-lbe-pause", t("logbuch.einst.pause_ab", "Stillstand zählt als Pause ab"), Math.round((w.pause_ab_s || 600) / 60), "min", 1)}
        ${zeile("gpxi-lbe-km", t("logbuch.einst.wanderung_km", "Gehen ist eine Wanderung ab"), ((w.wanderung_ab_m || 5000) / 1000).toFixed(1), "km", 0.5)}
        ${zeile("gpxi-lbe-hm", t("logbuch.einst.wanderung_hm", "… oder ab Höhenmetern"), Math.round(w.wanderung_ab_hm || 200), "m", 10)}
        ${zeile("gpxi-lbe-lf", t("logbuch.einst.langsame_fahrt", "Rad/Laufen zwischen zwei Fahrten ist Fahrt, wenn kürzer als"), Math.round((w.langsame_fahrt_bis_s || 2700) / 60), "min", 5)}
        <div class="gpxi-lb-einst-wahl gpxi-lb-einst-netz">
          <label><input type="checkbox" id="gpxi-lbe-orte"${(w.orte_holen == null || w.orte_holen > 0) ? " checked" : ""}> ${t("logbuch.einst.orte", "Ortsnamen im Internet nachschlagen (Photon)")}</label>
          <label><input type="checkbox" id="gpxi-lbe-pois"${(w.pois_holen == null || w.pois_holen > 0) ? " checked" : ""}> ${t("logbuch.einst.pois", "Sehenswürdigkeiten am Weg suchen (OpenStreetMap)")}</label>
        </div>
        ${zeile("gpxi-lbe-menge", t("logbuch.einst.pois_menge", "POI-Spur zeigt höchstens"), Math.round(w.pois_menge || 30), t("logbuch.einst.stueck", "Stück"), 5)}
        <div class="gpxi-lb-einst-wahl">
          <label><input type="radio" name="gpxi-lbe-ziel" value="tour" checked> ${t("logbuch.einst.fuer_tour", "Nur für diese Tour")}</label>
          <label><input type="radio" name="gpxi-lbe-ziel" value="alle"> ${t("logbuch.einst.fuer_alle", "Als Standard für alle Touren übernehmen")}</label>
        </div>
        <div class="lib-hint">${hatTour ? t("logbuch.einst.hinweis_tour", "Diese Tour hat eigene Werte — „Zurücksetzen“ nimmt sie weg, dann gilt wieder der Standard.") : t("logbuch.einst.hinweis_standard", "Diese Tour nutzt den Standard.")}</div>
      </div>`,
      footer: `<button class="btn btn-left" id="gpxi-lbe-reset"${hatTour ? "" : " disabled"}>${t("common.reset", "Zurücksetzen")}</button>
               <button class="btn" id="gpxi-lbe-nein">${t("common.cancel", "Abbrechen")}</button>
               <button class="btn btn-primary" id="gpxi-lbe-ja">${t("common.apply", "Übernehmen")}</button>`,
    });
    const zu = () => { try { m.close(); } catch (_) {} };
    const speichern = async (patch, alsStandard, reset) => {
      zu();
      const vorher = _undoSnap();
      let r;
      try { r = await api().logbuch_einstellungen(_lbPfad, patch, !!alsStandard, !!reset); }   // warte-ok: sofortige Antwort
      catch (e) { r = { ok: false, error: String(e) }; }
      if (!r || !r.ok) { toast((r && r.error) || t("logbuch.fehler_aktion", "Das ging nicht"), "error"); return; }
      _pushUndoMit(t("logbuch.undo.einst", "Logbuch: Einstellungen"), vorher);
      try { updateUI(); } catch (_) {}
      await logbuchLaden(false, { auswahl: _lbSel, ohneNetz: true });
      try { _lbNetzNachladen(); } catch (_) {}
    };
    const v = (id) => parseFloat((document.getElementById(id) || {}).value);
    const ja = document.getElementById("gpxi-lbe-ja"); if (ja) ja.onclick = () => {
      const patch = { pause_ab_s: v("gpxi-lbe-pause") * 60, wanderung_ab_m: v("gpxi-lbe-km") * 1000,
                      wanderung_ab_hm: v("gpxi-lbe-hm"), langsame_fahrt_bis_s: v("gpxi-lbe-lf") * 60,
                      orte_holen: (document.getElementById("gpxi-lbe-orte") || {}).checked ? 1 : 0,
                      pois_holen: (document.getElementById("gpxi-lbe-pois") || {}).checked ? 1 : 0,
                      pois_menge: v("gpxi-lbe-menge") };
      for (const k in patch) if (!isFinite(patch[k])) delete patch[k];
      const alle = (document.querySelector('input[name="gpxi-lbe-ziel"]:checked') || {}).value === "alle";
      speichern(patch, alle, false);
    };
    const nein = document.getElementById("gpxi-lbe-nein"); if (nein) nein.onclick = zu;
    const rs = document.getElementById("gpxi-lbe-reset"); if (rs) rs.onclick = () => speichern(null, false, true);
  }
  function _lbBearbeitenVerdrahten() {
    _on("gpxi-lb-ab", _lbBereichAB);
    _on("gpxi-lb-punkt", _lbPunktUmschalten);
    _on("gpxi-lb-einst", _lbEinstellungen);
    const liste = _lbEl("gpxi-lb-liste");
    if (liste) {
      liste.addEventListener("contextmenu", (e) => {
        const z = e.target.closest("[data-lb]"); if (!z) return;
        e.preventDefault(); _lbEintragMenue(_lbFinde(z.dataset.lb), e.clientX, e.clientY, null);
      });
      liste.addEventListener("click", (e) => {
        const b = e.target.closest(".gpxi-lb-mehr"); if (!b) return;
        e.preventDefault(); e.stopPropagation();
        const z = b.closest("[data-lb]"); const r = b.getBoundingClientRect();
        _lbEintragMenue(_lbFinde(z.dataset.lb), r.left, r.bottom + 2, null);
      });
    }
    _lbZiehenVerdrahten();
    _lbKnoepfe();
  }
  _lbBearbeitenVerdrahten();
  window.__rzGpxiLogbuchBearbeiten = { aktion: _lbAktion, bestaetigen: _lbBestaetigen, menue: _lbEintragMenue, bereichAB: _lbBereichAB,
                                       punktModus: () => _lbPunktModus, punktSetzen: _lbPunktSetzen, einstellungen: _lbEinstellungen,
                                       stand: () => _lbStand, schnappschuss: _lbSchnappschuss };
  // ── Logbuch Stufe 3 — Ortsnamen, POIs, großes Fenster (docs/LOGBUCH.md §4, Q10/Q11/Q17) ──
  // Netz nur hier, nur im Hintergrund (Kasten unten rechts), abschaltbar in ⚙.
  let _lbOrte = {};          // eintrag_id → {von, nach, hier}
  let _lbPois = [];          // POI-Spur: [{id, name, symbol, rang, t, idx, wichtig, im_logbuch}]
  let _lbPoisAn = true;      // Spur sichtbar?
  let _lbNetzLauf = 0;       // laufende Hintergrundarbeit (Nummer, gegen Überholen)
  let _lbGross = null;     // großes Fenster (Element)
  let _lbFensterSort = { spalte: "t0", auf: true };
  let _lbFensterWahl = new Set();
  let _lbFensterNurVermutet = false;
  let _lbFensterLetzte = null;   // zuletzt angeklickte Zeile (Shift-Klick wählt den Bereich bis hierher)

  function _lbOrtText(e) {
    const o = _lbOrte[e.id]; if (!o) return "";
    if (o.hier) return o.hier;
    if (o.von && o.nach) return o.von === o.nach ? o.von : o.von + " → " + o.nach;
    return o.von || o.nach || "";
  }
  /** Nach dem Logbuch: Ortsnamen und POIs im Hintergrund holen (Q4/Q10/Q11). */
  async function _lbNetzNachladen(opt) {
    if (!_lb || !_lbPfad) return;
    const einst = _lb.einstellungen || {};
    const pfad = _lbPfad, lauf = ++_lbNetzLauf;
    if (opt && opt.nurCache) {   // nach einer Änderung: Kennungen sind neu, Namen kommen aus dem Cache
      let r; try { r = await api().logbuch_orte(pfad, 0); } catch (e) { r = null; }   // warte-ok: Cache, sofort
      if (isUnmounted || lauf !== _lbNetzLauf || _lbPfad !== pfad) return;
      if (r && r.ok) { _lbOrte = r.orte || {}; _lbListeRender(); try { _lbFensterRender(); } catch (_) {} }
      _lbPoisAbgleichen();
      _lbPoisRender(); try { _lbKartenMarken(); } catch (_) {}
      return;
    }
    _lbOrte = {}; _lbPois = [];
    const id = "logbuch-netz";
    const will = { orte: (einst.orte_holen == null || einst.orte_holen > 0), pois: (einst.pois_holen == null || einst.pois_holen > 0) };
    if (!will.orte && !will.pois) { _lbPoisRender(); return; }
    try {
      rzStatus.start(id, { titel: t("logbuch.netz.titel", "Logbuch: Namen und Orte"), text: t("logbuch.netz.orte", "Ortsnamen werden nachgeschlagen …"), hintergrund: true, abbrechen: true });
      if (will.orte) {
        // Liste und Fenster höchstens einmal je Sekunde neu zeichnen, am Ende auf jeden Fall (14.09.2026)
        let zuletzt = 0, offen = false;
        const zeichnen = () => { zuletzt = performance.now(); offen = false; _lbListeRender(); try { _lbFensterRender(); } catch (_) {} };
        for (let runde = 0; runde < 12; runde++) {
          let r; try { r = await api().logbuch_orte(pfad, 25); } catch (e) { r = null; }   // warte-ok: Hintergrundkasten logbuch-netz
          if (isUnmounted || lauf !== _lbNetzLauf || _lbPfad !== pfad) return;
          if (!r || !r.ok) break;
          Object.assign(_lbOrte, r.orte || {}); offen = true;
          if (!r.offen || !r.netz || rzStatus.abgebrochen(id)) break;
          if (performance.now() - zuletzt > 1000) zeichnen();
          rzStatus.schritt(id, { text: t("logbuch.netz.orte_offen", "Ortsnamen: noch {n} offen", { n: r.offen }) });
        }
        if (offen) zeichnen();
      }
      if (will.pois && !rzStatus.abgebrochen(id)) {
        rzStatus.schritt(id, { text: t("logbuch.netz.pois", "Sehenswürdigkeiten am Weg werden gesucht …") });
        let r; try { r = await api().logbuch_pois(pfad, false); } catch (e) { r = null; }   // warte-ok: Hintergrundkasten logbuch-netz
        if (isUnmounted || lauf !== _lbNetzLauf || _lbPfad !== pfad) return;
        if (r && r.ok) {
          _lbPois = r.pois || [];
          if (r.im_logbuch > 0) { await logbuchLaden(false, { auswahl: _lbSel, ohneNetz: true }); if (lauf !== _lbNetzLauf) return; }
          _lbPoisRender();
          if (!r.netz) toast(t("logbuch.netz.kein_netz", "Ohne Internet: Sehenswürdigkeiten werden später nachgetragen."), "info", 4000);
        }
      }
      rzStatus.fertig(id, t("logbuch.netz.fertig", "Namen und Orte sind da"));
    } catch (e) {
      try { rzStatus.ende(id); } catch (_) {}
      applog && applog("warn", "[logbuch] Netz: " + e);
    }
  }
  /** POI-Flaggen (im_logbuch, abgelehnt) aus dem aktuellen Logbuch ableiten — nach ⌘Z/⌘⇧Z stimmen sie sonst nicht mehr.
   *  Spiegelt die Brücke (logbuch_pois): im Logbuch = Punkt „poi" mit dieser osm_id; abgelehnt = Grabstein „weg" mit dieser osm_id. */
  function _lbPoisAbgleichen() {
    if (!_lb || !_lbPois.length) return;
    const drin = new Set(), weg = new Set();
    for (const p of _lb.punkte || []) if (p.art === "poi" && p.osm_id != null) drin.add(String(p.osm_id));
    for (const b of _lb.roh || []) if (b.art === "weg" && b.osm_id != null) weg.add(String(b.osm_id));
    for (const q of _lbPois) {
      const k = String(q.osm_id);
      q.im_logbuch = drin.has(k);
      q.abgelehnt = weg.has(k);
    }
  }
  // POI-Spur im Zeitstrahl (eigene Zeile unter den Punkten)
  function _lbPoisRender() {
    const svg = _lbEl("gpxi-lb-svg"); if (!svg) return;
    let g = svg.querySelector("#gpxi-lb-poispur");
    if (!g) { g = document.createElementNS("http://www.w3.org/2000/svg", "g"); g.id = "gpxi-lb-poispur"; svg.appendChild(g); }
    const sp = _lbSpanne(); const W = parseFloat(svg.getAttribute("width")) || 0;
    const menge = Math.max(0, Math.round((_lb && _lb.einstellungen && _lb.einstellungen.pois_menge) || 30));
    const Z = _LB_ZEILEN_AKTIV.pois;
    if (!_lbPoisAn || !Z || !sp || !W || !_lbPois.length || _lbAlles) { g.innerHTML = ""; return; }
    const yP = (Z[0] + Z[1]) / 2;
    const liste = _lbPois.filter(p => p.t != null).slice().sort((a, b) => (a.rang - b.rang) || (a.t - b.t)).slice(0, menge).sort((a, b) => a.t - b.t);
    let s = "", letzteX = -Infinity;
    const xs = liste.map(p => ((p.t - sp[0]) / (sp[1] - sp[0])) * W);
    for (let k = 0; k < liste.length; k++) {
      const p = liste[k], x = xs[k]; if (x < -6 || x > W + 6) continue;
      const cls = "gpxi-lb-poi" + (p.im_logbuch ? " ist-drin" : "") + (p.wichtig ? " ist-wichtig" : "");
      // Beschriftung nur, wenn bis zur nächsten Marke Platz ist (sonst Text über Kreisen)
      const naechsteX = k + 1 < xs.length ? xs[k + 1] : Infinity;
      const platz = Math.min(naechsteX - x, W - x) - 12;
      const kurz = p.name.length <= 26 ? p.name : p.name.slice(0, 24) + "…";
      const label = (x - letzteX > 40 && platz > kurz.length * 5.6) ? `<text x="${(x + 9).toFixed(1)}" y="${(yP + 4).toFixed(1)}" class="gpxi-lb-poi-txt">${_lbEsc(kurz)}</text>` : "";
      if (label) letzteX = x;
      s += `<g class="${cls}" data-poi="${_lbEsc(p.id)}"><circle cx="${x.toFixed(1)}" cy="${yP.toFixed(1)}" r="6"/><text x="${x.toFixed(1)}" y="${(yP + 3.5).toFixed(1)}" text-anchor="middle" class="gpxi-lb-poi-sym">${p.symbol || "📍"}</text>${label}<title>${_lbEsc(p.name + (p.im_logbuch ? " · " + t("logbuch.poi.im_logbuch", "steht im Logbuch") : " · " + t("logbuch.poi.klick_zeigen", "Klick: auf der Karte zeigen")))}</title></g>`;
    }
    g.innerHTML = s;
    g.querySelectorAll("[data-poi]").forEach(el => el.addEventListener("click", (ev) => { ev.stopPropagation(); _lbPoiZeigen(_lbPois.find(q => q.id === el.dataset.poi)); }));
  }
  async function _lbPoiUebernehmen(id) {
    const p = _lbPois.find(x => x.id === id); if (!p || p.im_logbuch) return;
    const r = await _lbAktion(t("logbuch.undo.poi", "Logbuch: Sehenswürdigkeit übernommen"), "punkt",
      { t: p.t, art: "poi", name: p.name, lat: p.lat, lon: p.lon, ele: p.ele, osm_id: p.osm_id, symbol: p.symbol, poi_art: p.art });
    if (r) { p.im_logbuch = true; _lbPoisRender(); }
  }

  // ── Großes Fenster (Q17): Tabelle, sortieren, Mehrfachauswahl ───────────
  function _lbFensterAuf() {
    if (!_lb) return;
    if (_lbGross) {
      if (!_lbGross.hidden) { _lbFensterMerken(); _lbGross.hidden = true; return; }     // ⤢ ist ein Umschalter
      _lbGross.hidden = false; _lbFensterLage(true); _lbFensterRender(); return;
    }
    const w = document.createElement("div");
    w.className = "gpxi-lb-fenster"; w.id = "gpxi-lb-fenster";
    w.innerHTML = `<div class="gpxi-lb-fenster-kopf"><span class="gpxi-lb-fenster-titel">📖 ${t("logbuch.titel", "Logbuch")} — <span id="gpxi-lbf-name"></span></span>
        <span class="gpxi-lb-fenster-summe" id="gpxi-lbf-summe"></span>
        <label class="gpxi-lb-schalter" title="${t("logbuch.fenster.nur_vermutete_tip", "Nur Einträge zeigen, bei denen die Erkennung unsicher war")}"><input type="checkbox" id="gpxi-lbf-nurverm"> ${t("logbuch.fenster.nur_vermutete", "nur vermutete")}</label>
        <button type="button" class="gpxi-lb-knopf" id="gpxi-lbf-maxi" title="${t("logbuch.fenster.maximieren", "Maximieren")}">▢</button>
        <button type="button" class="gpxi-lb-knopf" id="gpxi-lbf-zu" title="${t("common.close", "Schließen")}">✕</button></div>
      <div class="gpxi-lb-fenster-leiste" id="gpxi-lbf-leiste" hidden>
        <span id="gpxi-lbf-anzahl"></span>
        <button type="button" class="gpxi-lb-knopf" id="gpxi-lbf-best">✓ ${t("logbuch.fenster.bestaetigen", "Vermutete bestätigen")}</button>
        <button type="button" class="gpxi-lb-knopf" id="gpxi-lbf-art">${t("logbuch.menue.art", "Art ändern")} ▾</button>
        <button type="button" class="gpxi-lb-knopf" id="gpxi-lbf-zus">${t("logbuch.fenster.zusammenlegen", "Zusammenlegen")}</button>
        <button type="button" class="gpxi-lb-knopf" id="gpxi-lbf-del">🗑 ${t("logbuch.fenster.loeschen", "Löschen")}</button>
        <button type="button" class="gpxi-lb-knopf" id="gpxi-lbf-keine">${t("logbuch.fenster.abwaehlen", "Auswahl aufheben")}</button>
      </div>
      <div class="gpxi-lb-fenster-body"><table class="gpxi-lb-tabelle" id="gpxi-lbf-tabelle"></table></div>`;
    document.body.appendChild(w);
    _lbGross = w;
    // 14.09.2026 (Marc: „es soll richtig als Fenster funktionieren, verschieben und in der Größe
    // ändern"): vorher nur CSS-`resize` (winziger, von der Tabelle verdeckter Griff) und 84 % des
    // Bildschirms groß. Jetzt Griffe an allen Kanten und Ecken, sichtbarer Eckgriff, Startgröße
    // rechts über der Karte, Doppelklick auf die Kopfzeile = maximieren/zurück, alles gemerkt.
    w.insertAdjacentHTML("beforeend", ["n", "s", "e", "w", "ne", "nw", "se", "sw"]
      .map(r => `<div class="gpxi-lbf-griff gpxi-lbf-griff-${r}" data-griff="${r}"></div>`).join("")
      + `<div class="gpxi-lbf-eckzeichen" aria-hidden="true"></div>`);
    _lbFensterLage(true);
    const kopf = w.querySelector(".gpxi-lb-fenster-kopf");
    const MIN_W = 460, MIN_H = 220;
    let zug = null;
    const beiZug = (e) => {
      if (!zug) return;
      const dx = e.clientX - zug.sx, dy = e.clientY - zug.sy;
      let { x, y, bw, bh } = zug;
      if (zug.art === "move") { x += dx; y += dy; }
      else {
        if (zug.art.includes("e")) bw = Math.max(MIN_W, zug.bw + dx);
        if (zug.art.includes("s")) bh = Math.max(MIN_H, zug.bh + dy);
        if (zug.art.includes("w")) { bw = Math.max(MIN_W, zug.bw - dx); x = zug.x + (zug.bw - bw); }
        if (zug.art.includes("n")) { bh = Math.max(MIN_H, zug.bh - dy); y = zug.y + (zug.bh - bh); }
      }
      x = Math.max(-bw + 120, Math.min(innerWidth - 120, x));
      y = Math.max(0, Math.min(innerHeight - 40, y));
      w.style.left = x + "px"; w.style.top = y + "px"; w.style.width = bw + "px"; w.style.height = bh + "px";
    };
    const zugEnde = () => {
      if (!zug) return;
      zug = null; w.classList.remove("ist-gezogen");
      window.removeEventListener("pointermove", beiZug); window.removeEventListener("pointerup", zugEnde);
      _lbFensterMerken();
    };
    const zugStart = (e, art) => {
      if (e.button !== 0) return;
      if (w.classList.contains("ist-maximiert")) {
        if (art !== "move") return;
        _lbFensterMaximieren(false);                 // aus maximiert herausziehen: alte Größe unter dem Zeiger
        const bw = w.offsetWidth; w.style.left = Math.max(0, e.clientX - bw / 2) + "px"; w.style.top = "0px";
      }
      zug = { art, sx: e.clientX, sy: e.clientY, x: w.offsetLeft, y: w.offsetTop, bw: w.offsetWidth, bh: w.offsetHeight };
      w.classList.add("ist-gezogen");
      window.addEventListener("pointermove", beiZug); window.addEventListener("pointerup", zugEnde);
      e.preventDefault(); e.stopPropagation();
    };
    kopf.addEventListener("pointerdown", (e) => { if (e.target.closest("button, input, label")) return; zugStart(e, "move"); });
    kopf.addEventListener("dblclick", (e) => { if (e.target.closest("button, input, label")) return; _lbFensterMaximieren(!w.classList.contains("ist-maximiert")); });
    w.querySelectorAll("[data-griff]").forEach(g => g.addEventListener("pointerdown", (e) => zugStart(e, g.dataset.griff)));
    w.querySelector("#gpxi-lbf-zu").addEventListener("click", () => { _lbFensterMerken(); w.hidden = true; });
    w.querySelector("#gpxi-lbf-maxi").addEventListener("click", () => _lbFensterMaximieren(!w.classList.contains("ist-maximiert")));
    w.querySelector("#gpxi-lbf-nurverm").addEventListener("change", (ev) => { _lbFensterNurVermutet = !!ev.target.checked; _lbFensterWahl.clear(); _lbFensterRender(); });
    w.querySelector("#gpxi-lbf-best").addEventListener("click", async () => {
      const es = _lbFensterGewaehlt(); _lbFensterWahl.clear();
      await _lbBestaetigen(es);
    });
    w.querySelector("#gpxi-lbf-keine").addEventListener("click", () => { _lbFensterWahl.clear(); _lbFensterRender(); });
    w.querySelector("#gpxi-lbf-del").addEventListener("click", async () => {
      const bids = _lbFensterBids(); if (!bids.length) return;
      _lbFensterWahl.clear();
      await _lbAktion(t("logbuch.undo.loeschen", "Logbuch: löschen"), "aufgehen", { bids }, { auswahl: null });
    });
    w.querySelector("#gpxi-lbf-zus").addEventListener("click", async () => {
      const es = _lbFensterGewaehlt().filter(e => !_lbIstPunkt(e)).sort((a, b) => a.t0 - b.t0);
      if (es.length < 2) return;
      _lbFensterWahl.clear();
      // Der Reihe nach: erster + zweiter, Ergebnis + dritter … (der Kern legt über verborgene Halte hinweg zusammen).
      // Ein Klick = EIN ⌘Z-Schritt: Stand vorher merken, Einzelschritte ohne Undo, am Ende einmal pushen.
      const vorher = _undoSnap(); let getan = 0;
      let links = es[0];
      for (let k = 1; k < es.length; k++) {
        const r = await _lbAktion(t("logbuch.undo.zusammenlegen", "Logbuch: zusammenlegen"), "zusammenlegen",
          { bid_a: links.bids[links.bids.length - 1], bid_b: es[k].bids[0] }, { auswahl: null, ohneUndo: true });
        if (!r) break;
        getan++;
        links = _lbEintraege().slice().sort((a, b) => a.t0 - b.t0).find(x => x.t0 <= es[0].t0 + 1 && x.t1 >= es[k].t1 - 1) || links;
      }
      if (getan) { _pushUndoMit(t("logbuch.undo.zusammenlegen", "Logbuch: zusammenlegen"), vorher); try { updateUI(); } catch (_) {} }
    });
    w.querySelector("#gpxi-lbf-art").addEventListener("click", (ev) => {
      const bids = _lbFensterBids(); if (!bids.length) return;
      const M = [{ text: t("logbuch.menue.art", "Art ändern"), aus: true }];
      for (const art of _LB_HAND_ARTEN) M.push({ unter: true, symbol: _LB_ICON[art] || "", text: _lbArt(art), tu: () =>
        _lbAktion(t("logbuch.undo.art", "Logbuch: Art ändern"), "aendern", { bids, art }) });
      const r = ev.currentTarget.getBoundingClientRect(); _lbMenue(r.left, r.bottom + 4, M);
    });
    _lbFensterRender();
  }
  function _lbFensterMerken() {
    if (!_lbGross || _lbGross.hidden || !_lbGross.offsetWidth) return;   // versteckt: nichts Falsches (0×0) merken
    const maxi = _lbGross.classList.contains("ist-maximiert");
    const r = maxi && _lbGross._vorMaxi ? _lbGross._vorMaxi
      : { x: _lbGross.offsetLeft, y: _lbGross.offsetTop, w: _lbGross.offsetWidth, h: _lbGross.offsetHeight };
    try { localStorage.setItem("rz_logbuch_fenster", JSON.stringify(Object.assign({}, r, { maxi }))); } catch (_) {}
  }
  /** Lage aus dem Speicher (oder Startlage rechts über der Karte), immer in den Bildschirm geholt. */
  function _lbFensterLage(mitSpeicher) {
    const w = _lbGross; if (!w) return;
    let pos = null;
    if (mitSpeicher) { try { pos = JSON.parse(localStorage.getItem("rz_logbuch_fenster") || "null"); } catch (_) {} }
    if (!pos || !pos.w) {
      const karte = document.getElementById("gpxi-canvas");
      const k = karte ? karte.getBoundingClientRect() : { right: innerWidth - 20, top: 90 };
      const bw = Math.min(760, Math.max(460, Math.round(innerWidth * 0.46))), bh = Math.min(560, Math.max(260, Math.round(innerHeight * 0.6)));
      pos = { x: Math.max(8, Math.round(k.right - bw - 16)), y: Math.max(8, Math.round(k.top + 16)), w: bw, h: bh };
    }
    const bw = Math.min(Math.max(460, pos.w), innerWidth - 16), bh = Math.min(Math.max(220, pos.h), innerHeight - 16);
    const x = Math.max(8, Math.min(innerWidth - bw - 8, pos.x)), y = Math.max(8, Math.min(innerHeight - bh - 8, pos.y));
    w.style.left = x + "px"; w.style.top = y + "px"; w.style.width = bw + "px"; w.style.height = bh + "px";
    if (pos.maxi) _lbFensterMaximieren(true);
  }
  function _lbFensterMaximieren(an) {
    const w = _lbGross; if (!w) return;
    if (an && !w.classList.contains("ist-maximiert")) {
      w._vorMaxi = { x: w.offsetLeft, y: w.offsetTop, w: w.offsetWidth, h: w.offsetHeight };
      w.classList.add("ist-maximiert");
      w.style.left = "8px"; w.style.top = "8px"; w.style.width = (innerWidth - 16) + "px"; w.style.height = (innerHeight - 16) + "px";
    } else if (!an && w.classList.contains("ist-maximiert")) {
      w.classList.remove("ist-maximiert");
      const r = w._vorMaxi || { x: 60, y: 60, w: 700, h: 480 };
      w.style.left = r.x + "px"; w.style.top = r.y + "px"; w.style.width = r.w + "px"; w.style.height = r.h + "px";
    }
    const k = w.querySelector("#gpxi-lbf-maxi");
    if (k) { k.textContent = an ? "❐" : "▢"; k.title = an ? t("logbuch.fenster.wiederherstellen", "Wiederherstellen") : t("logbuch.fenster.maximieren", "Maximieren"); }
    _lbFensterMerken();
  }
  function _lbFensterGewaehlt() { return [..._lbFensterWahl].map(id => _lbFinde(id)).filter(Boolean); }
  function _lbFensterBids() { return _lbFensterGewaehlt().filter(e => !_lbIstPunkt(e)).flatMap(e => e.bids); }
  function _lbFensterRender() {
    if (!_lbGross || _lbGross.hidden || !_lb) return;
    const nm = _lbGross.querySelector("#gpxi-lbf-name"); if (nm) nm.textContent = _lb.name || "";
    const su = _lbGross.querySelector("#gpxi-lbf-summe"); if (su) su.innerHTML = (_lbEl("gpxi-lb-summe") || {}).innerHTML || "";
    const zeilen = _lbEintraege().map(e => Object.assign({ _punkt: false, _t: e.t0, _art: _lbArt(e.anzeige_art), _icon: _LB_ICON[e.anzeige_art] || "" }, e))
      .concat(_lbPunkteSichtbar().map(p => Object.assign({ _punkt: true, _t: p.t, t0: p.t, dauer_s: 0, strecke_m: 0, hoehe_auf: 0, tempo_kmh: 0, _art: _lbArt(p.art), _icon: p.symbol || _LB_ICON[p.art] || "•" }, p)))
      .filter(z => !_lbFensterNurVermutet || z.geraten);
    const sp = _lbFensterSort, k = sp.spalte;
    const wert = (z) => k === "t0" ? z._t : k === "art" ? z._art : k === "name" ? (z.name || "") : k === "ort" ? _lbOrtText(z) : (z[k] || 0);
    zeilen.sort((a, b) => { const x = wert(a), y = wert(b); const c = (typeof x === "string") ? x.localeCompare(y, rzSprachCode()) : (x - y); return sp.auf ? c : -c; });
    const kopf = [["t0", t("logbuch.fenster.zeit", "Zeit")], ["art", t("logbuch.fenster.art", "Art")], ["name", t("logbuch.fenster.name", "Name")],
                  ["ort", t("logbuch.fenster.ort", "Ort")], ["dauer_s", t("logbuch.fenster.dauer", "Dauer")], ["strecke_m", "km"], ["hoehe_auf", "↑ m"], ["tempo_kmh", "km/h"]];
    let html = `<thead><tr><th class="gpxi-lbt-w"><input type="checkbox" id="gpxi-lbf-alle"${_lbFensterWahl.size && _lbFensterWahl.size === zeilen.length ? " checked" : ""}></th>` +
      kopf.map(([s, txt]) => `<th data-sort="${s}"${sp.spalte === s ? ' class="ist-sort"' : ""}>${txt}${sp.spalte === s ? (sp.auf ? " ▴" : " ▾") : ""}</th>`).join("") + `<th></th></tr></thead><tbody>`;
    for (const z of zeilen) {
      const gew = _lbFensterWahl.has(z.id) ? " ist-gewaehlt" : "", akt = z.id === _lbSel ? " ist-aktiv" : "";
      const zeit = _lbUhr(z._t, z.versatz_min) + (z._punkt ? "" : " – " + _lbUhr(z.t1, z.versatz_min)) + (_lb.mehrtaegig ? ` <small>${t("logbuch.tag", "Tag {n}", { n: z.tag })}</small>` : "");
      html += `<tr data-lb="${z.id}" class="${z._punkt ? "ist-punkt" : ""}${gew}${akt}" style="--c:${_lbFarbe(z.anzeige_art || "")}">
        <td class="gpxi-lbt-w"><input type="checkbox" data-wahl="${z.id}"${gew ? " checked" : ""}></td>
        <td class="gpxi-lbt-zeit">${zeit}</td><td><span class="gpxi-lbt-art">${z._icon} ${z._art}</span>${z.geraten ? ` <button type="button" class="gpxi-lb-badge ist-vermutet" data-vermutet="${z.id}" title="${t("logbuch.geraten_tip2", "Die Erkennung war hier unsicher. Klick: bestätigen oder eine andere Art wählen.")}">${t("logbuch.geraten", "vermutet")}</button>` : ""}</td>
        <td class="gpxi-lbt-name" data-edit="${z.id}" title="${t("logbuch.fenster.name_tip", "Doppelklick: umbenennen")}">${_lbEsc(z.name || "")}${z.notiz ? `<div class="gpxi-lb-notiz">${_lbEsc(z.notiz)}</div>` : ""}</td>
        <td class="gpxi-lbt-ort">${_lbEsc(_lbOrtText(z))}</td>
        <td class="gpxi-lbt-num">${z._punkt ? "" : _lbDauer(z.dauer_s)}</td><td class="gpxi-lbt-num">${z.strecke_m > 50 ? _lbKm(z.strecke_m) : ""}</td>
        <td class="gpxi-lbt-num">${z.hoehe_auf >= 20 ? z.hoehe_auf : ""}</td><td class="gpxi-lbt-num">${z.tempo_kmh && z.art !== "pause" ? z.tempo_kmh.toLocaleString(rzSprachCode(), { maximumFractionDigits: 1 }) : ""}</td>
        <td><button type="button" class="gpxi-lb-mehr" title="${t("logbuch.menue.titel", "Bearbeiten")}">⋯</button></td></tr>`;
    }
    html += "</tbody>";
    const tab = _lbGross.querySelector("#gpxi-lbf-tabelle"); tab.innerHTML = html;
    const leiste = _lbGross.querySelector("#gpxi-lbf-leiste"); leiste.hidden = !_lbFensterWahl.size;
    const anz = _lbGross.querySelector("#gpxi-lbf-anzahl"); if (anz) anz.textContent = t("logbuch.fenster.gewaehlt", "{n} gewählt", { n: _lbFensterWahl.size });
    tab.querySelectorAll("th[data-sort]").forEach(th => th.addEventListener("click", () => {
      const s = th.dataset.sort; if (_lbFensterSort.spalte === s) _lbFensterSort.auf = !_lbFensterSort.auf; else _lbFensterSort = { spalte: s, auf: true };
      _lbFensterRender();
    }));
    const alle = tab.querySelector("#gpxi-lbf-alle"); if (alle) alle.addEventListener("change", () => { _lbFensterWahl = alle.checked ? new Set(zeilen.map(z => z.id)) : new Set(); _lbFensterRender(); });
    tab.querySelectorAll("[data-wahl]").forEach(cb => cb.addEventListener("click", (ev) => {
      const id = cb.dataset.wahl;
      const ids = zeilen.map(z => z.id), a = _lbFensterLetzte ? ids.indexOf(_lbFensterLetzte) : -1, b = ids.indexOf(id);
      if (ev.shiftKey && a >= 0 && b >= 0) {
        for (let k = Math.min(a, b); k <= Math.max(a, b); k++) _lbFensterWahl.add(ids[k]);
      } else if (cb.checked) _lbFensterWahl.add(id); else _lbFensterWahl.delete(id);
      _lbFensterLetzte = id; _lbFensterRender();
    }));
    tab.querySelectorAll("[data-vermutet]").forEach(bt => bt.addEventListener("click", (ev) => {
      ev.stopPropagation(); const r = bt.getBoundingClientRect();
      _lbEintragMenue(_lbFinde(bt.dataset.vermutet), r.left, r.bottom + 2, null);
    }));
    tab.querySelectorAll("tr[data-lb]").forEach(tr => {
      tr.addEventListener("click", (ev) => { if (ev.target.closest("input, button, [data-edit]")) return; lbWaehlen(tr.dataset.lb, { zoom: true }); _lbFensterRender(); });
      tr.addEventListener("contextmenu", (ev) => { ev.preventDefault(); _lbEintragMenue(_lbFinde(tr.dataset.lb), ev.clientX, ev.clientY, null); });
      const mehr = tr.querySelector(".gpxi-lb-mehr"); if (mehr) mehr.addEventListener("click", (ev) => { ev.stopPropagation(); const r = mehr.getBoundingClientRect(); _lbEintragMenue(_lbFinde(tr.dataset.lb), r.left, r.bottom + 2, null); });
    });
    tab.querySelectorAll("[data-edit]").forEach(td => td.addEventListener("dblclick", () => {
      const e = _lbFinde(td.dataset.edit); if (!e) return;
      const inp = document.createElement("input"); inp.type = "text"; inp.value = e.name || ""; inp.className = "gpxi-lbt-edit";
      td.innerHTML = ""; td.appendChild(inp); inp.focus(); inp.select();
      let fertig = false;
      const ab = async (speichern) => {
        if (fertig) return; fertig = true;
        if (speichern && inp.value !== (e.name || "")) await _lbAktion(t("logbuch.undo.umbenennen", "Logbuch: umbenennen"), "aendern", _lbIstPunkt(e) ? { bid: e.id, name: inp.value } : { bids: e.bids, name: inp.value });
        else _lbFensterRender();
      };
      inp.addEventListener("keydown", (ev) => { if (ev.key === "Enter") ab(true); if (ev.key === "Escape") ab(false); });
      inp.addEventListener("blur", () => ab(true));
    }));
  }
  function _lbStufe3Verdrahten() {
    _on("gpxi-lb-fenster-auf", _lbFensterAuf);
    { const a = _lbEl("gpxi-lb-pois"); if (a) a.addEventListener("change", () => { _lbPoisAn = !!a.checked; _lbInfoZu(); logbuchRender(); try { _lbFensterRender(); } catch (_) {} }); }
    const box = _lbEl("gpxi-lb-svgbox");
    if (box) box.addEventListener("contextmenu", (e) => {
      const g = e.target.closest("[data-poi]"); if (!g) return;
      e.preventDefault(); e.stopPropagation();
      const p = _lbPois.find(x => x.id === g.dataset.poi); if (!p) return;
      _lbMenue(e.clientX, e.clientY, [{ text: p.name, aus: true },
        { symbol: "📍", text: t("logbuch.poi.uebernehmen", "Ins Logbuch übernehmen"), aus: p.im_logbuch, tu: () => _lbPoiUebernehmen(p.id) }]);
    }, true);
  }
  _lbStufe3Verdrahten();
  window.__rzGpxiLogbuchNetz = { maximieren: (an) => _lbFensterMaximieren(an), orte: () => _lbOrte, pois: () => _lbPois, nachladen: _lbNetzNachladen, fenster: _lbFensterAuf,
                                 fensterEl: () => _lbGross, wahl: _lbFensterWahl, poiUebernehmen: _lbPoiUebernehmen };
  // ── Logbuch Stufe 4 — Befunde-Spur (Q18) und Eigene-Spur (Q14) ──────────────
  // Befunde kommen aus dem Track-Check (`_tc`, Fundstellen als Punkt-Indizes), Klick
  // springt zur Stelle und markiert den Befund wie „Zeigen" im Kasten. Eigene
  // Einteilungen („mit den Kindern") sind eigene Zeilen in der Bibliothek; sie
  // reisen im Undo-Schnappschuss mit (`lbEigen`).
  let _lbBefundeAn = true;
  let _lbEigeneAn = false;
  let _lbEigene = [];        // Einteilungen art=eigen: [{id, name, bereiche}]
  const _LB_EIGEN_FARBEN = ["#e879f9", "#38bdf8", "#fb923c", "#a3e635", "#f472b6", "#facc15"];

  function _lbBefundeListe() {
    if (!_tc || !_tc.befunde) return [];
    const raus = [];
    for (const b of _tc.befunde) {
      if (!b.stellen || !b.stellen.length) continue;
      for (const i of b.stellen) raus.push({ key: b.key, stufe: b.stufe || "grau", idx: i });
    }
    return raus;
  }
  function _lbSpurenAnpassen() {
    // Sichtbare Spuren bestimmen Höhe und Zeilen des Zeitstrahls
    const zeilen = { tage: [3, 17], bewegung: [23, 87], punkte: [91, 109] };
    let y = 113;
    if (_lbPoisAn) { zeilen.pois = [y, y + 18]; y += 22; } else zeilen.pois = null;
    if (_lbEigeneAn) { zeilen.eigene = [y, y + 18]; y += 22; } else zeilen.eigene = null;
    if (_lbBefundeAn && _lbBefundeListe().length) { zeilen.befunde = [y, y + 16]; y += 20; } else zeilen.befunde = null;
    zeilen.achse = [y, y + 18];
    _LB_ZEILEN_AKTIV = zeilen;
    _LB_H_AKTIV = y + 21;
    const box = _lbEl("gpxi-lb-strahl"), svg = _lbEl("gpxi-lb-svg"), spuren = _lbEl("gpxi-lb-spuren-el"), cur = _lbEl("gpxi-lb-cursor"), koerper = _lbEl("gpxi-lb-koerper");
    if (svg) svg.style.height = _LB_H_AKTIV + "px";
    if (cur) cur.style.height = _LB_H_AKTIV + "px";
    if (koerper) koerper.style.height = (_LB_H_AKTIV + 44) + "px";
    if (spuren) {
      spuren.style.height = _LB_H_AKTIV + "px";
      spuren.innerHTML = [["tage", t("logbuch.spur_tage", "Tage")], ["bewegung", t("logbuch.spur_bewegung", "Bewegung")], ["punkte", t("logbuch.spur_punkte", "Punkte")],
        ["pois", "POIs"], ["eigene", t("logbuch.spur_eigene", "Eigene")], ["befunde", t("logbuch.spur_befunde", "Befunde")]]
        .filter(([k]) => zeilen[k]).map(([k, txt]) => `<span style="top:${zeilen[k][0] + (k === "bewegung" ? 25 : 0)}px">${txt}</span>`).join("");
    }
    if (box) box.style.cursor = "";
  }
  function _lbBefundeRender(X, W) {
    const Z = _LB_ZEILEN_AKTIV.befunde; if (!Z) return "";
    const z = _lbZeiten || _lbZeitenBauen();
    const farbe = { rot: "#e53935", gelb: "#d4a017", grau: "#8b8fa3" };
    const zeile = (typeof rzTrackCheckZeile === "function") ? rzTrackCheckZeile : (b) => b.key;
    let s = `<rect x="0" y="${Z[0]}" width="${W}" height="${Z[1] - Z[0]}" class="gpxi-lb-spurbg"/>`;
    const yM = (Z[0] + Z[1]) / 2;
    for (const b of _lbBefundeListe()) {
      const tt = z[b.idx]; if (!isFinite(tt)) continue;
      const x = X(tt); if (x < -4 || x > W + 4) continue;
      const bef = (_tc.befunde || []).find(q => q.key === b.key) || { key: b.key, n: 1 };
      s += `<g class="gpxi-lb-befund ist-${b.stufe}" data-befund="${b.key}" data-idx="${b.idx}"><path d="M${x.toFixed(1)} ${(yM - 7).toFixed(1)} l6 7 l-6 7 l-6 -7 z" fill="${farbe[b.stufe] || farbe.grau}"/><title>${_lbEsc(zeile(bef) + " · #" + (b.idx + 1) + " · " + t("logbuch.befund_klick", "Klick: Stelle zeigen"))}</title></g>`;
    }
    return s;
  }
  function _lbEigeneRender(X, W) {
    const Z = _LB_ZEILEN_AKTIV.eigene; if (!Z) return "";
    let s = `<rect x="0" y="${Z[0]}" width="${W}" height="${Z[1] - Z[0]}" class="gpxi-lb-spurbg"/>`;
    _lbEigene.forEach((e, k) => {
      const farbe = _LB_EIGEN_FARBEN[k % _LB_EIGEN_FARBEN.length];
      for (const b of e.bereiche || []) {
        if (b.t1 <= b.t0) continue;
        const x0 = X(b.t0), x1 = X(b.t1); if (x1 < 0 || x0 > W) continue;
        const xa = Math.max(-2, x0), w = Math.max(2, Math.min(W + 2, x1) - xa);
        const name = b.name || e.name || "";
        const label = w > 40 && name ? `<text class="gpxi-lb-bl2" x="${(xa + 5).toFixed(1)}" y="${Z[0] + 13}">${_lbEsc(name.length > Math.floor(w / 6) ? name.slice(0, Math.max(3, Math.floor(w / 6) - 1)) + "…" : name)}</text>` : "";
        s += `<g class="gpxi-lb-eigen" data-eigen="${e.id}" data-bid="${b.id}"><rect x="${xa.toFixed(1)}" y="${Z[0] + 2}" width="${w.toFixed(1)}" height="${Z[1] - Z[0] - 4}" rx="3" fill="${farbe}" opacity=".8"/>${label}<title>${_lbEsc((e.name ? e.name + ": " : "") + (b.name || "") + " · " + _lbUhr(b.t0, (_lb.eintraege[0] || {}).versatz_min) + " – " + _lbUhr(b.t1, (_lb.eintraege[0] || {}).versatz_min))}</title></g>`;
      }
    });
    return s;
  }
  async function _lbEigeneLaden() {
    if (!_lbPfad) { _lbEigene = []; return; }
    let r; try { r = await api().einteilung_lesen(_lbPfad); } catch (_) { r = null; }   // warte-ok: Datenbank, sofort
    if (isUnmounted) return;
    _lbEigene = (r && r.ok ? r.einteilungen : []).filter(e => e.art === "eigen");
  }
  function _lbEigeneSchnappschuss() {
    return _lbEigene.map(e => ({ id: e.id, tour: e.tour, art: "eigen", name: e.name || "", bereiche: JSON.parse(JSON.stringify(e.bereiche || [])) }));
  }
  async function _lbEigeneUndo(snapEigen) {
    if (!snapEigen || !_lb) return false;
    const jetzt = _lbEigeneSchnappschuss();
    if (JSON.stringify(jetzt) === JSON.stringify(snapEigen)) return false;
    const soll = new Map(snapEigen.map(e => [e.id, e]));
    for (const e of jetzt) if (!soll.has(e.id)) { try { await api().einteilung_stand_setzen(e.id, null, _lb.tour); } catch (_) {} }   // warte-ok: Undo
    for (const e of snapEigen) { try { await api().einteilung_stand_setzen(e.id, e, _lb.tour); } catch (_) {} }   // warte-ok: Undo
    await _lbEigeneLaden(); _lbStrahlRender();
    return true;
  }
  async function _lbEigenAnlegen(t0, t1) {
    // Name der Spur: bestehende zur Auswahl, sonst neu
    const M = [{ text: t("logbuch.eigen.titel", "Eigene Spur"), aus: true }];
    for (const e of _lbEigene) M.push({ unter: true, symbol: "🏷", text: e.name || t("logbuch.eigen.ohne_name", "(ohne Namen)"), tu: () => _lbEigenBereich(e.id, t0, t1) });
    M.push({ unter: true, symbol: "＋", text: t("logbuch.eigen.neu", "Neue Spur …"), tu: async () => {
      const name = await _lbFrage(t("logbuch.eigen.frage", "Name der eigenen Spur, z. B. „mit den Kindern“"), "");
      if (name === null) return;
      const vorher = _undoSnap();
      let r; try { r = await api().einteilung_eigen_anlegen(_lbPfad, name); } catch (e) { r = { ok: false, error: String(e) }; }   // warte-ok: Datenbank
      if (!r || !r.ok) { toast((r && r.error) || t("logbuch.fehler_aktion", "Das ging nicht"), "error"); return; }
      _pushUndoMit(t("logbuch.undo.eigen", "Logbuch: eigene Spur"), vorher); try { updateUI(); } catch (_) {}
      await _lbEigenBereich(r.eid, t0, t1, true);
    } });
    return M;
  }
  async function _lbEigenBereich(eid, t0, t1, ohneUndo) {
    const vorher = ohneUndo ? null : _undoSnap();   // Undo-Schritt erst nach Erfolg — Abbrechen hinterlässt keinen leeren
    const name = await _lbFrage(t("logbuch.eigen.bereich_name", "Beschriftung des Abschnitts (darf leer bleiben)"), "");
    if (name === null) return;
    let r; try { r = await api().einteilung_aktion(eid, "setzen", { t0, t1, art: "eigen", name }); } catch (e) { r = { ok: false, error: String(e) }; }   // warte-ok: Datenbank
    if (!r || !r.ok) { toast((r && r.error) || t("logbuch.fehler_aktion", "Das ging nicht"), "error"); return; }
    if (vorher) { _pushUndoMit(t("logbuch.undo.eigen", "Logbuch: eigene Spur"), vorher); try { updateUI(); } catch (_) {} }
    _lbEigeneAn = true; const cb = _lbEl("gpxi-lb-eigene"); if (cb) cb.checked = true;
    await _lbEigeneLaden(); _lbStrahlRender();
    try { clearSelection(); } catch (_) {}
  }
  function _lbStufe4Verdrahten() {
    { const a = _lbEl("gpxi-lb-befunde"); if (a) a.addEventListener("change", () => { _lbBefundeAn = !!a.checked; _lbInfoZu(); _lbStrahlRender(); }); }
    { const a = _lbEl("gpxi-lb-eigene"); if (a) a.addEventListener("change", () => { _lbEigeneAn = !!a.checked; _lbStrahlRender(); }); }
    const box = _lbEl("gpxi-lb-svgbox"); if (!box) return;
    box.addEventListener("click", (e) => {
      const g = e.target.closest("[data-befund]"); if (!g) return;
      e.stopPropagation();
      const i = parseInt(g.dataset.idx, 10);
      if (_points[i]) { _lbBefundZeigen(g.dataset.befund, i); }
    }, true);
    box.addEventListener("contextmenu", (e) => {
      const g = e.target.closest("[data-eigen]"); if (!g) return;
      e.preventDefault(); e.stopPropagation();
      const eid = g.dataset.eigen, bid = g.dataset.bid;
      const ein = _lbEigene.find(x => x.id === eid); const b = ein && (ein.bereiche || []).find(x => x.id === bid);
      _lbMenue(e.clientX, e.clientY, [
        { text: (ein && ein.name) || t("logbuch.eigen.titel", "Eigene Spur"), aus: true },
        { symbol: "✏️", text: t("logbuch.menue.umbenennen", "Umbenennen …"), tu: async () => {
          const v = await _lbFrage(t("logbuch.eigen.bereich_name", "Beschriftung des Abschnitts (darf leer bleiben)"), (b && b.name) || ""); if (v === null) return;
          _pushUndo(t("logbuch.undo.eigen", "Logbuch: eigene Spur")); try { updateUI(); } catch (_) {}
          try { await api().einteilung_aktion(eid, "aendern", { bid, name: v }); } catch (_) {}   // warte-ok: Datenbank
          await _lbEigeneLaden(); _lbStrahlRender(); } },
        { symbol: "🗑", text: t("logbuch.eigen.entfernen", "Abschnitt entfernen"), tu: async () => {
          _pushUndo(t("logbuch.undo.eigen", "Logbuch: eigene Spur")); try { updateUI(); } catch (_) {}
          try { await api().einteilung_aktion(eid, "bereich_entfernen", { bid }); } catch (_) {}   // warte-ok: Datenbank
          await _lbEigeneLaden(); _lbStrahlRender(); } },
        { symbol: "🗑", text: t("logbuch.eigen.spur_entfernen", "Ganze Spur entfernen"), tu: async () => {
          _pushUndo(t("logbuch.undo.eigen", "Logbuch: eigene Spur")); try { updateUI(); } catch (_) {}
          try { await api().einteilung_entfernen(eid); } catch (_) {}   // warte-ok: Datenbank
          await _lbEigeneLaden(); _lbStrahlRender(); } },
      ]);
    }, true);
  }
  _lbStufe4Verdrahten();
  window.__rzGpxiLogbuchSpuren = { befunde: _lbBefundeListe, eigene: () => _lbEigene, eigeneLaden: _lbEigeneLaden, zeilen: () => _LB_ZEILEN_AKTIV,
                                   eigenBereich: _lbEigenBereich, an: (was, an) => { if (was === "befunde") _lbBefundeAn = !!an; if (was === "eigene") _lbEigeneAn = !!an; _lbStrahlRender(); } };



  // ── Logbuch auf der Karte (Marc, 13.09.2026) ────────────────────────────────
  // „Punkte, POIs und Befunde müssen bei einem Klick darauf in der Karte angezeigt
  // werden und es muss direkt dastehen, was das ist" · „auf der Karte auch Rechtsklick
  // mit denselben Dingen wie im Zeitstrahl" · „zoomt man im Zeitstrahl, soll die Karte
  // denselben Ausschnitt zeigen — und andersrum".
  let _lbMarken = [];          // HTML-Marker der Punkte und POIs
  let _lbInfo = null;          // Info-Kasten (Popup) auf der Karte
  let _lbKarteTimer = 0;       // Zeitstrahl-Zoom → Karte (entprellt)
  let _lbAusKarte = false;     // Zeitstrahl wird gerade aus der Karte gesetzt
  function _lbIstPunkt(e) { return !!e && (e.t != null || e.t1 == null || e.t1 <= e.t0); }
  function _lbPunkteSichtbar() {
    return (_lb && !_lbAlles ? (_lb.punkte || []) : []).filter(p => _lbPoisAn || p.art !== "poi");
  }
  function _lbPoiArtText(p) {
    const roh = String(p.poi_art || (p.art !== "poi" ? p.art : "") || "");
    const namen = { gipfel: t("logbuch.poiart.gipfel", "Gipfel"), pass: t("logbuch.poiart.pass", "Pass"), aussicht: t("logbuch.poiart.aussicht", "Aussichtspunkt"), wasserfall: t("logbuch.poiart.wasserfall", "Wasserfall"), hoehle: t("logbuch.poiart.hoehle", "Höhle"), quelle: t("logbuch.poiart.quelle", "Quelle"), gletscher: t("logbuch.poiart.gletscher", "Gletscher"), huette: t("logbuch.poiart.huette", "Hütte"), burg: t("logbuch.poiart.burg", "Burg"), ruine: t("logbuch.poiart.ruine", "Ruine"), denkmal: t("logbuch.poiart.denkmal", "Denkmal"), sehenswert: t("logbuch.poiart.sehenswert", "Attraktion"), kunst: t("logbuch.poiart.kunst", "Kunstwerk"), museum: t("logbuch.poiart.museum", "Museum"), leuchtturm: t("logbuch.poiart.leuchtturm", "Leuchtturm"), turm: t("logbuch.poiart.turm", "Turm"), see: t("logbuch.poiart.see", "See"), ort: t("logbuch.poiart.ort", "Ort") };
    if (namen[roh]) return namen[roh];
    const a = roh.replace(/_/g, " ");
    return a ? a.charAt(0).toUpperCase() + a.slice(1) : "";
  }
  function _lbPunktBeschreibung(p) {
    if (p.art === "poi") {
      const a = _lbPoiArtText(p);
      return t("logbuch.karte.poi", "Sehenswürdigkeit aus OpenStreetMap") + (a ? " · " + _lbEsc(a) : "");
    }
    if (p.art === "punkt") return t("logbuch.karte.punkt", "Eigener Punkt im Logbuch");
    if (p.art === "start") return t("logbuch.karte.start", "Beginn der Aufzeichnung");
    if (p.art === "ziel") return t("logbuch.karte.ziel", "Ende der Aufzeichnung");
    if (p.art === "hoechster_punkt") return t("logbuch.karte.hoechster", "Höchster Punkt der Tour") + (p.ele != null ? " · " + Math.round(p.ele).toLocaleString(rzSprachCode()) + " m" : "");
    return _lbArt(p.art);
  }
  function _lbInfoZu() { if (_lbInfo) { try { _lbInfo.remove(); } catch (_) {} _lbInfo = null; } }
  function _lbInfoAuf(lon, lat, html, verdrahten) {
    if (!map || !_maplib) return;
    _lbInfoZu(); try { _closeMapPopup(); } catch (_) {}
    _lbInfo = new _maplib.Popup({ closeButton: true, closeOnClick: false, maxWidth: "310px", className: "gpxi-pinfo-pop gpxi-lb-info-pop", offset: 14 })
      .setLngLat([lon, lat]).setHTML(`<div class="gpxi-lb-info">${html}</div>`).addTo(map);
    try { _lbInfo.on("close", () => { _lbInfo = null; }); } catch (_) {}
    const el = _lbInfo.getElement && _lbInfo.getElement();
    if (el && verdrahten) {
      el.querySelectorAll("[data-lbi]").forEach(b => b.addEventListener("click", (ev) => { ev.stopPropagation(); verdrahten(b.dataset.lbi); }));
    }
  }
  function _lbLage(p) {
    if (p.lat != null && p.lon != null) return [p.lon, p.lat];
    const i = p.idx != null ? p.idx : _lbIdxZuZeit(p.t);
    return (i >= 0 && _points[i]) ? [_points[i].lon, _points[i].lat] : null;
  }
  function _lbKarteHin(lage, zoom) {
    if (!map || !lage) return;
    try {
      const b = map.getBounds();
      const drin = b && lage[0] >= b.getWest() && lage[0] <= b.getEast() && lage[1] >= b.getSouth() && lage[1] <= b.getNorth();
      if (drin && map.getZoom() >= (zoom || 13) - 0.5) return;
      _syncing = true;
      map.once("moveend", () => setTimeout(() => { _syncing = false; }, 30));
      map.easeTo({ center: lage, zoom: Math.max(map.getZoom(), zoom || 14), duration: 600 });
    } catch (_) { _syncing = false; }
  }
  /** Punkt (aus dem Logbuch) auf der Karte zeigen, mit Info und Knöpfen. */
  function _lbPunktZeigen(p, ohneFlug) {
    const lage = _lbLage(p); if (!lage) return;
    if (!ohneFlug) _lbKarteHin(lage, 14);
    const titel = p.art === "hoechster_punkt" ? _lbArt(p.art) : (p.name ? _lbEsc(p.name) : _lbArt(p.art));
    const ort = _lbOrtText(p);
    const html = `<div class="gpxi-lb-info-kopf"><span class="gpxi-lb-info-sym">${p.symbol || _LB_ICON[p.art] || "•"}</span><b>${titel}</b></div>
      <div class="gpxi-lb-info-was">${_lbPunktBeschreibung(p)}</div>
      <div class="gpxi-lb-info-meta">${_lbUhr(p.t, p.versatz_min)}${ort ? " · " + _lbEsc(ort) : ""}${p.quelle === "hand" ? " · " + t("logbuch.karte.von_hand", "von Hand") : ""}</div>
      ${p.notiz ? `<div class="gpxi-lb-notiz">${_lbEsc(p.notiz)}</div>` : ""}
      <div class="gpxi-lb-info-knoepfe">
        <button type="button" class="gpxi-lb-knopf" data-lbi="name">✏️ ${t("logbuch.karte.umbenennen", "Umbenennen")}</button>
        <button type="button" class="gpxi-lb-knopf" data-lbi="notiz">📝 ${t("logbuch.karte.notiz", "Notiz")}</button>
        <button type="button" class="gpxi-lb-knopf ist-gefahr" data-lbi="weg">🗑 ${t("logbuch.karte.loeschen", "Löschen")}</button>
      </div>`;
    _lbInfoAuf(lage[0], lage[1], html, async (was) => {
      if (was === "name") {
        const v = await _lbFrage(t("logbuch.frage.name", "Name des Eintrags"), p.name || ""); if (v === null) return;
        _lbInfoZu(); await _lbAktion(t("logbuch.undo.umbenennen", "Logbuch: umbenennen"), "aendern", { bid: p.id, name: v });
        const neu = _lbFinde(p.id); if (neu) _lbPunktZeigen(neu, true);
      } else if (was === "notiz") {
        const v = await _lbFrage(t("logbuch.frage.notiz", "Notiz zu diesem Eintrag"), p.notiz || "", true); if (v === null) return;
        _lbInfoZu(); await _lbAktion(t("logbuch.undo.notiz", "Logbuch: Notiz"), "aendern", { bid: p.id, notiz: v });
        const neu = _lbFinde(p.id); if (neu) _lbPunktZeigen(neu, true);
      } else if (was === "weg") {
        _lbInfoZu(); await _lbPunktLoeschen(p);
      }
    });
  }
  async function _lbPunktLoeschen(p) {
    const r = await _lbAktion(t("logbuch.undo.punkt_loeschen", "Logbuch: Punkt löschen"), "bereich_entfernen", { bid: p.id }, { auswahl: null });
    if (r && p.osm_id) {
      const q = _lbPois.find(x => String(x.osm_id) === String(p.osm_id));
      if (q) { q.im_logbuch = false; q.abgelehnt = true; }
      _lbKartenMarken();
    }
    return r;
  }
  /** POI aus der POI-Spur (noch nicht im Logbuch) auf der Karte zeigen. */
  function _lbPoiZeigen(q, ohneFlug) {
    if (!q) return;
    if (q.im_logbuch) {
      const p = (_lb && _lb.punkte || []).find(x => x.art === "poi" && String(x.osm_id) === String(q.osm_id));
      if (p) { lbWaehlen(p.id, { zoom: !ohneFlug }); return; }
    }
    const lage = [q.lon, q.lat];
    if (!ohneFlug) _lbKarteHin(lage, 14);
    const a = _lbPoiArtText(q);
    const html = `<div class="gpxi-lb-info-kopf"><span class="gpxi-lb-info-sym">${q.symbol || "📍"}</span><b>${_lbEsc(q.name)}</b></div>
      <div class="gpxi-lb-info-was">${t("logbuch.karte.poi", "Sehenswürdigkeit aus OpenStreetMap")}${a ? " · " + _lbEsc(a) : ""}</div>
      <div class="gpxi-lb-info-meta">${q.t != null ? _lbUhr(q.t, ((_lb && _lb.eintraege[0]) || {}).versatz_min) + " · " : ""}${t("logbuch.karte.nicht_drin", "steht nicht im Logbuch")}</div>
      <div class="gpxi-lb-info-knoepfe">
        <button type="button" class="gpxi-lb-knopf ist-haupt" data-lbi="rein">📍 ${t("logbuch.poi.uebernehmen", "Ins Logbuch übernehmen")}</button>
      </div>`;
    _lbInfoAuf(lage[0], lage[1], html, async (was) => {
      if (was !== "rein") return;
      _lbInfoZu(); await _lbPoiUebernehmen(q.id);
      const p = (_lb && _lb.punkte || []).find(x => x.art === "poi" && String(x.osm_id) === String(q.osm_id));
      if (p) lbWaehlen(p.id, { zoom: false });
    });
  }
  /** Befund-Stelle auf der Karte: was kaputt ist, was die Reparatur tut, und gleich „Reparieren?". */
  function _lbBefundZeigen(key, idx, ohneFlug) {
    const bef = ((_tc && _tc.befunde) || []).find(q => q.key === key); const p = _points[idx];
    if (!bef || !p) return;
    if (!ohneFlug) _lbKarteHin([p.lon, p.lat], 15);
    try { setHover(idx); } catch (_) {}
    const zeile = (typeof rzTrackCheckZeile === "function") ? rzTrackCheckZeile : (b) => b.key;
    const stufeTxt = (typeof rzTrackCheckStufeText === "function") ? rzTrackCheckStufeText : () => "";
    const stellen = bef.stellen || [], nr = stellen.indexOf(idx);
    const ohne = _TC_OHNE_SCHRITT[key];
    const rep = _TC_REPARATUR[key];
    const erkl = key === "uebersetzen" ? t("trackcheck.uebersetzen_hinweis", "Fähre, Flug oder Autozug: Die Strecke wurde wirklich zurückgelegt, nur ohne Aufzeichnung. Daran wird nichts repariert.")
      : (_TC_STILL[key] ? t("trackcheck.still_hinweis", "Eigenheit der Aufzeichnung — wird beim Reparieren mitbereinigt") : (rep ? t(rep[0], rep[1]) : ""));
    const kannRep = ohne === undefined && !!rep;
    const html = `<div class="gpxi-lb-info-kopf"><span class="gpxi-lb-info-sym gpxi-lb-info-befund ist-${bef.stufe || "grau"}">◆</span><b>${_lbEsc(zeile(bef))}</b></div>
      <div class="gpxi-lb-info-was">${_lbEsc(stufeTxt(bef.stufe || "grau") || t("logbuch.karte.befund", "Befund des Track-Checks"))}</div>
      <div class="gpxi-lb-info-meta">${t("logbuch.karte.stelle", "Stelle {i} von {n} · Punkt #{p}", { i: nr + 1, n: stellen.length, p: idx + 1 })}</div>
      ${erkl ? `<div class="gpxi-lb-info-rep">${_lbEsc(erkl)}</div>` : ""}
      <div class="gpxi-lb-info-knoepfe">
        ${kannRep ? `<button type="button" class="gpxi-lb-knopf ist-haupt" data-lbi="rep">🩹 ${t("logbuch.karte.reparieren", "Reparieren")}</button>` : ""}
        ${ohne === "retime" ? `<button type="button" class="gpxi-lb-knopf" data-lbi="goto">${t("trackcheck.goto_retime", "Zeiten setzen")}</button>` : ""}
        ${stellen.length > 1 ? `<button type="button" class="gpxi-lb-knopf" data-lbi="weiter">${t("logbuch.karte.naechste", "Nächste Stelle")} ›</button>` : ""}
        ${_tc && _tc.im_archiv ? `<button type="button" class="gpxi-lb-knopf" data-lbi="ok">${t("trackcheck.btn_ok", "Ist so in Ordnung")}</button>` : ""}
      </div>`;
    _lbInfoAuf(p.lon, p.lat, html, async (was) => {
      if (was === "weiter") { const n = stellen[(nr + 1) % stellen.length]; _lbBefundZeigen(key, n); }
      else if (was === "rep") {
        _lbInfoZu();
        const ok = await _lbJaNein(t("logbuch.karte.rep_frage", "„{b}“ reparieren?", { b: zeile(bef) }),
          (rep ? t(rep[0], rep[1]) : "") + " " + t("logbuch.karte.rep_alle", "Das betrifft alle {n} Stellen dieser Art. Rückgängig geht mit ⌘Z.", { n: stellen.length || bef.n || 1 }));
        if (ok) { try { await trackCheckReparieren([key]); } catch (e) { toast(String(e), "error"); } }
      }
      else if (was === "ok") { _lbInfoZu(); try { await trackCheckOk(key, true); } catch (_) {} }
      else if (was === "goto") {
        _lbInfoZu();
        const sec = document.querySelector('.gpxi-sec[data-sec="bearbeiten"]'); if (sec) sec.open = true;
        const el = document.getElementById("gpxi-wz-retime-run"); if (el) { try { el.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (_) {} }
      }
    });
  }
  function _lbJaNein(titel, text) {
    return new Promise((resolve) => {
      const m = openModal({ title: titel, body: `<div class="lib-fmodal"><p>${_lbEsc(text)}</p></div>`,
        footer: `<button class="btn" id="gpxi-lb-jn-nein">${t("common.cancel", "Abbrechen")}</button>
                 <button class="btn btn-primary" id="gpxi-lb-jn-ja">${t("logbuch.karte.reparieren", "Reparieren")}</button>` });
      const fertig = (v) => { try { m.close(); } catch (_) {} resolve(v); };
      const ja = document.getElementById("gpxi-lb-jn-ja"), nein = document.getElementById("gpxi-lb-jn-nein");
      if (ja) ja.onclick = () => fertig(true);
      if (nein) nein.onclick = () => fertig(false);
    });
  }

  /** Marken auf der Karte: Logbuch-Punkte (Start/Ziel zeigt die Karte schon), POIs und Befunde. */
  let _lbKartenSig = "";
  function _lbKartenMarkenAuswahl() {
    for (const m of _lbMarken) { try { const el = m.getElement(); if (el.dataset.lb) el.classList.toggle("ist-gewaehlt", el.dataset.lb === _lbSel); } catch (_) {} }
  }
  function _lbKartenMarken(erzwingen) {
    // Die Auswahl steckt nicht in der Signatur: sie schaltet nur eine Klasse um (14.09.2026)
    const sig = !_lb ? "" : [_lbAlles, _lbPoisAn, _lbBefundeAn, _points.length,
      _lbPunkteSichtbar().map(p => p.id + (p.name || "")).join(","),
      _lbPois.map(q => q.id + (q.im_logbuch ? "+" : "")).join(","), _lbBefundeAn ? _lbBefundeListe().length : 0,
      (_lb.einstellungen || {}).pois_menge].join("|");
    if (!erzwingen && sig === _lbKartenSig) { _lbKartenMarkenAuswahl(); return; }
    _lbKartenSig = sig;
    for (const m of _lbMarken) { try { m.remove(); } catch (_) {} }
    _lbMarken = [];
    if (!map || !_maplib) return;
    _lbKarteEbenen();
    const befSrc = map.getSource && map.getSource("gpxi-lb-bef");
    if (!_lb || _lbAlles) { if (befSrc) befSrc.setData({ type: "FeatureCollection", features: [] }); return; }
    const neu = (lage, sym, cls, titel, klick, rechts, lbId) => {
      const el = document.createElement("div");
      el.className = "gpxi-lb-marke " + cls; el.textContent = sym; el.title = titel;
      if (lbId != null) el.dataset.lb = lbId;
      el.addEventListener("click", (ev) => { ev.stopPropagation(); klick(); });
      el.addEventListener("dblclick", (ev) => ev.stopPropagation());
      el.addEventListener("mousedown", (ev) => ev.stopPropagation());
      el.addEventListener("contextmenu", (ev) => { ev.preventDefault(); ev.stopPropagation(); if (rechts) rechts(ev); });
      const mk = new _maplib.Marker({ element: el, anchor: "center" }).setLngLat(lage).addTo(map);
      _lbMarken.push(mk);
    };
    for (const p of _lbPunkteSichtbar()) {
      if (p.art === "start" || p.art === "ziel") continue;
      const lage = _lbLage(p); if (!lage) continue;
      const titel = (p.name || _lbArt(p.art)) + (p.art === "hoechster_punkt" && p.ele != null ? " · " + Math.round(p.ele) + " m" : "");
      neu(lage, p.symbol || _LB_ICON[p.art] || "•", "ist-" + p.art + (p.id === _lbSel ? " ist-gewaehlt" : ""), titel,
        () => lbWaehlen(p.id, { zoom: false }), (ev) => _lbEintragMenue(p, ev.clientX, ev.clientY, null), p.id);
    }
    if (_lbPoisAn) {
      const menge = Math.max(0, Math.round((_lb.einstellungen && _lb.einstellungen.pois_menge) || 30));
      const liste = _lbPois.filter(q => !q.im_logbuch && q.lat != null).slice().sort((a, b) => a.rang - b.rang).slice(0, menge);
      for (const q of liste) {
        neu([q.lon, q.lat], q.symbol || "📍", "ist-poi-spur", q.name + " · " + t("logbuch.poi.klick_karte", "Klick: was ist das?"),
          () => _lbPoiZeigen(q, true), (ev) => _lbMenue(ev.clientX, ev.clientY, [{ text: q.name, aus: true },
            { symbol: "📍", text: t("logbuch.poi.uebernehmen", "Ins Logbuch übernehmen"), tu: () => _lbPoiUebernehmen(q.id) }]));
      }
    }
    if (befSrc) {
      const feats = [];
      if (_lbBefundeAn) for (const b of _lbBefundeListe()) {
        const p = _points[b.idx]; if (!p) continue;
        feats.push({ type: "Feature", properties: { key: b.key, idx: b.idx, stufe: b.stufe }, geometry: { type: "Point", coordinates: [p.lon, p.lat] } });
      }
      befSrc.setData({ type: "FeatureCollection", features: feats });
    }
  }
  function _lbBefundAnKarte(pt) {
    if (!map || !_lbBefundeAn || !map.getLayer("gpxi-lb-bef-lyr")) return null;
    try {
      const f = map.queryRenderedFeatures([[pt.x - 8, pt.y - 8], [pt.x + 8, pt.y + 8]], { layers: ["gpxi-lb-bef-lyr"] });
      if (f && f.length) return { key: f[0].properties.key, idx: Number(f[0].properties.idx) };
    } catch (_) {}
    return null;
  }
  /** Rechtsklick auf der Karte = dasselbe Menü wie im Zeitstrahl, an dieser Stelle. */
  function _lbKarteRechtsklick(ev) {
    if (!_lb || _lbAlles || _drawMode) return;
    const oe = ev.originalEvent; try { oe && oe.preventDefault(); } catch (_) {}
    const bef = _lbBefundAnKarte(ev.point);
    if (bef) { _lbBefundZeigen(bef.key, bef.idx, true); return; }
    const i = _nearestIdxToPoint(ev.point.x, ev.point.y, 60);
    if (i < 0) return;
    const z = _lbZeiten || _lbZeitenBauen(); const tt = z[i]; if (!isFinite(tt)) return;
    const e = _lbEintraege().find(x => x.t0 <= tt && tt <= x.t1);
    if (!e) return;
    if (e.id !== _lbSel) lbWaehlen(e.id, { zoom: false, scroll: true });
    _lbEintragMenue(e, oe ? oe.clientX : 300, oe ? oe.clientY : 300, tt, { idx: i });
  }
  function _lbKarteEbenen() {
    if (!map) return;
    try {
      if (!map.getSource("gpxi-lb-bef")) {
        map.addSource("gpxi-lb-bef", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({ id: "gpxi-lb-bef-lyr", type: "circle", source: "gpxi-lb-bef", paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 3.5, 15, 6.5],
          "circle-color": ["match", ["get", "stufe"], "rot", "#e53935", "gelb", "#d4a017", "#8b8fa3"],
          "circle-stroke-width": 1.6, "circle-stroke-color": "#ffffff" } });
      }
      if (!map.getSource("gpxi-lb-fen")) {
        map.addSource("gpxi-lb-fen", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        const vor = map.getLayer("gpxi-lb-hl-saum") ? "gpxi-lb-hl-saum" : undefined;
        map.addLayer({ id: "gpxi-lb-fen-lyr", type: "line", source: "gpxi-lb-fen", layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#f59e0b", "line-width": 9, "line-opacity": 0.55 } }, vor);
      }
    } catch (e) { applog && applog("warn", "[logbuch] Karten-Ebenen: " + e); }
  }
  let _lbKarteVerdrahtet = false;
  function _lbKarteVerdrahten() {
    if (!map || _lbKarteVerdrahtet) return;
    _lbKarteVerdrahtet = true;
    _lbKarteEbenen();
    map.on("contextmenu", _lbKarteRechtsklick);
    map.on("moveend", _lbKarteBewegt);
    try { map.getCanvas().addEventListener("contextmenu", (e) => { if (_lb) e.preventDefault(); }); } catch (_) {}
  }
  // Zeitstrahl-Ausschnitt → Karte: denselben Abschnitt zeigen und hell markieren.
  function _lbFensterAufKarte(sofort, ganz) {
    if (_lbKarteTimer) clearTimeout(_lbKarteTimer);
    const lauf = () => {
      _lbKarteTimer = 0;
      if (!map) return;
      let src = null; try { src = map.getSource("gpxi-lb-fen"); } catch (_) {}
      // Ohne Logbuch (geleert, Track gewechselt) darf kein orangener Saum stehen bleiben (14.09.2026)
      if (!_lb) { if (src) src.setData({ type: "FeatureCollection", features: [] }); return; }
      const z = _lbZeiten || _lbZeitenBauen();
      if (!_lbFenster) {
        if (src) src.setData({ type: "FeatureCollection", features: [] });
        if (ganz && !_lbAusKarte && _points.length > 1) { _syncing = true; try { _lbKarteZu(0, _points.length - 1); } catch (_) { _syncing = false; } }
        return;
      }
      let a = -1, b = -1;
      for (let i = 0; i < z.length; i++) { const tt = z[i]; if (!isFinite(tt)) continue; if (tt >= _lbFenster[0] && tt <= _lbFenster[1]) { if (a < 0) a = i; b = i; } }
      if (a < 0) { if (src) src.setData({ type: "FeatureCollection", features: [] }); return; }
      if (src) {
        const coords = []; const schritt = Math.max(1, Math.floor((b - a) / 3000));
        for (let i = a; i <= b; i += schritt) coords.push([_points[i].lon, _points[i].lat]);
        coords.push([_points[b].lon, _points[b].lat]);
        src.setData({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } }] });
      }
      if (_lbAusKarte) return;       // die Karte hat den Ausschnitt vorgegeben — nicht zurückschieben
      let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
      for (let i = a; i <= b; i++) { const p = _points[i]; if (p.lon < mnx) mnx = p.lon; if (p.lon > mxx) mxx = p.lon; if (p.lat < mny) mny = p.lat; if (p.lat > mxy) mxy = p.lat; }
      if (mxx - mnx < 1e-4 && mxy - mny < 1e-4) { mnx -= 0.002; mxx += 0.002; mny -= 0.0015; mxy += 0.0015; }
      _syncing = true;
      try {
        map.once("moveend", () => setTimeout(() => { _syncing = false; }, 30));
        map.fitBounds([[mnx, mny], [mxx, mxy]], { padding: 60, duration: 450, maxZoom: 16 });
      } catch (_) { _syncing = false; }
    };
    if (sofort) lauf(); else _lbKarteTimer = setTimeout(lauf, 260);
  }
  // Karte bewegt (von Hand) → Zeitstrahl auf den sichtbaren Abschnitt.
  function _lbKarteBewegt(ev) {
    // Nur Bewegungen von Hand (Ziehen, Mausrad, Zoom-Knöpfe) tragen ein originalEvent —
    // eigene fitBounds/easeTo nicht. Sonst schiebt jedes Anspringen den Zeitstrahl um.
    if (!ev || !ev.originalEvent) return;
    if (!_lb || !map || _points.length < 2 || _lbAlles) return;
    const w = _lbEl("gpxi-logbuch"); if (!w || w.hidden || w.classList.contains("ist-zu")) return;
    let bb; try { bb = map.getBounds(); } catch (_) { return; }
    const W = bb.getWest(), E = bb.getEast(), S = bb.getSouth(), N = bb.getNorth();
    const z = _lbZeiten || _lbZeitenBauen();
    // Sichtbare Punkte als zusammenhängende Läufe (Lücken bis 20 Punkte überbrückt) —
    // eine Reise kommt oft mehrmals durch denselben Ausschnitt.
    const laeufe = []; let lauf = null, drin = 0;
    for (let i = 0; i < _points.length; i++) {
      const p = _points[i];
      if (p.lon >= W && p.lon <= E && p.lat >= S && p.lat <= N && isFinite(z[i])) {
        drin++;
        if (lauf && i - lauf.b <= 20) lauf.b = i; else { lauf = { a: i, b: i }; laeufe.push(lauf); }
      }
    }
    let neu = null;
    if (drin && drin < _points.length * 0.98) {
      const alt = _lbFenster;
      const ueber = (l) => alt ? Math.max(0, Math.min(z[l.b], alt[1]) - Math.max(z[l.a], alt[0])) : 0;
      laeufe.sort((x, y) => (ueber(y) - ueber(x)) || ((y.b - y.a) - (x.b - x.a)));
      const l = laeufe[0];
      const lo = z[l.a], hi = z[l.b];
      const ganz = (function () { const f = _lbFenster; _lbFenster = null; const g = _lbSpanne(); _lbFenster = f; return g; })();
      const pad = Math.max(60, (hi - lo) * 0.03);
      neu = [ganz ? Math.max(ganz[0], lo - pad) : lo - pad, ganz ? Math.min(ganz[1], hi + pad) : hi + pad];
      if (neu[1] - neu[0] < 600) { const m = (neu[0] + neu[1]) / 2; neu = [m - 300, m + 300]; }
      if (ganz && neu[1] - neu[0] >= (ganz[1] - ganz[0]) * 0.98) neu = null;
    }
    const gleich = (!neu && !_lbFenster) || (neu && _lbFenster && Math.abs(neu[0] - _lbFenster[0]) < 5 && Math.abs(neu[1] - _lbFenster[1]) < 5);
    if (gleich) return;
    _lbFenster = neu;
    _lbAusKarte = true;
    // Nur der Zeitstrahl hängt am Ausschnitt — die Liste (innerHTML + Listener) bleibt stehen (14.09.2026)
    try { _lbStrahlRender(); const raus = _lbEl("gpxi-lb-reise"); if (raus) raus.hidden = !_lbFenster; _lbFensterAufKarte(true); }
    finally { _lbAusKarte = false; }
  }
  window.__rzGpxiLogbuchKarte = { marken: () => _lbMarken.map(m => { const el = m.getElement(); return { cls: el.className, sym: el.textContent, titel: el.title }; }),
                                  info: () => (_lbInfo && _lbInfo.getElement ? _lbInfo.getElement().innerText : null),
                                  infoKnopf: (was) => { const b = _lbInfo && _lbInfo.getElement().querySelector(`[data-lbi="${was}"]`); if (b) b.click(); return !!b; },
                                  punktZeigen: (id) => _lbPunktZeigen(_lbFinde(id), true), poiZeigen: (id) => _lbPoiZeigen(_lbPois.find(q => q.id === id), true),
                                  befundZeigen: _lbBefundZeigen, rechtsklickIdx: (i) => { const sp = map.project([_points[i].lon, _points[i].lat]); _lbKarteRechtsklick({ point: sp, originalEvent: { clientX: 400, clientY: 300, preventDefault() {} } }); },
                                  bounds: () => { try { return map.getBounds().toArray(); } catch (_) { return null; } },
                                  springe: (i, zoom) => { try { map.jumpTo({ center: [_points[i].lon, _points[i].lat], zoom }, { originalEvent: { type: "test" } }); } catch (e) { return String(e); } return true; },
                                  fenSrc: () => { const s = map.getSource("gpxi-lb-fen"); return s && s._data; },
                                  karteBewegt: _lbKarteBewegt, fensterAufKarte: _lbFensterAufKarte, befSrc: () => { const s = map.getSource("gpxi-lb-bef"); return s && s._data; } };

  // Für Wächter: Zustand des Logbuchs von außen lesbar
  window.__rzGpxiLogbuch = { daten: () => _lb, auswahl: () => _lbSel, waehlen: lbWaehlen, laden: logbuchLaden,
                            fenster: () => _lbFenster, hover: () => _lbHover,
                            zuIdx: _lbWaehleZuIdx, hoverIdx: (i) => setHover(i) };

  updateUI();

  // ── Cleanup ──────────────────────────────────────────────────────────────────
  return function cleanup() {
    isUnmounted = true;
    try { if (_lbRO) { _lbRO.disconnect(); _lbRO = null; } } catch (_) {}
    try { if (_lbRAF) cancelAnimationFrame(_lbRAF); } catch (_) {}
    // 14.09.2026: Logbuch-Reste abräumen — großes Fenster (hängt an document.body), Menü, Timer, Globale.
    // Sonst steht das Fenster über dem nächsten Modul und seine Knöpfe rufen tote Closures.
    try { if (_lbKarteTimer) { clearTimeout(_lbKarteTimer); _lbKarteTimer = 0; } } catch (_) {}
    try { _lbMenueZu(); } catch (_) {}
    try { if (_lbGross) { _lbFensterMerken(); _lbGross.remove(); _lbGross = null; } } catch (_) {}
    try { _lbInfoZu(); } catch (_) {}
    for (const k of ["__rzGpxiLogbuch", "__rzGpxiLogbuchBearbeiten", "__rzGpxiLogbuchNetz", "__rzGpxiLogbuchSpuren", "__rzGpxiLogbuchKarte", "__rzAbschnittInsArchiv"]) {
      try { delete window[k]; } catch (_) {}
    }
    // v0.9.389 — GPX-Listener abmelden (hielt sonst die komplette _points-Kopie).
    try { if (window.__rzGpxUnsub_insp) { window.__rzGpxUnsub_insp(); window.__rzGpxUnsub_insp = null; } } catch (_) {}
    try { document.removeEventListener("keydown", onKeyDown); } catch (_) {}
    try { window.removeEventListener("pointerup", onProfileUp); } catch (_) {}   // v0.9.293
    if (_clickTimer) { try { clearTimeout(_clickTimer); } catch (_) {} _clickTimer = null; }
    if (_hoverRAF) { try { cancelAnimationFrame(_hoverRAF); } catch (_) {} _hoverRAF = 0; }
    try { _closeProfileBox(); } catch (_) {}
    try { _closeMapPopup(); } catch (_) {}
    try { if (map) { map.remove(); } } catch (_) {}
    map = null;
  };
}
