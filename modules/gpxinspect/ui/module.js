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
  let _selA = null, _selB = null;   // Anker-Indizes (a <= b)
  let _dirty = false;
  let _drawMode = false;            // Pfad-zeichnen-Modus aktiv?
  let _drawPts = [];                // selbst gesetzte Stützpunkte [{lat,lon}]
  // v0.9.239 — Auto-Despike: erkannte Ausreißer-Gruppen + Navigations-State.
  let _spikes = [];                 // [{a,b,from,to}] a=Anker vor, b=Anker nach
  let _spikeSet = new Set();        // Punkt-Indizes die als Ausreißer markiert sind
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
    snapshot: () => ({ points: JSON.parse(JSON.stringify(_points)), dirty: _dirty,
                       sources: _sources.slice() }),
    apply: (snap) => {
      _points = JSON.parse(JSON.stringify((snap && snap.points) || []));
      _dirty = !!(snap && snap.dirty);
      if (snap && Array.isArray(snap.sources)) _sources = snap.sources.slice();
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
    },
    toast: (m) => { try { toast(m, "info", 1000); } catch (_) {} },
    throttleMs: 0,
  }) : null;
  if (_undo) window.__rzUndoControllers.gpxinspect = _undo;
  function _pushUndo(label) { if (_undo) _undo.push(label, { force: true }); }

  body.innerHTML = `
    <div class="panel gpxi-side">
        <div class="gpxi-empty" id="gpxi-empty">${t("gpxinspect.empty", "Lade ein GPX über die Leiste oben — dann erscheint hier jeder einzelne Track-Punkt.")}</div>
        <div class="gpxi-panel" id="gpxi-panel" hidden>
          <div class="gpxi-stat" id="gpxi-stat"></div>
          <div class="gpxi-statgrid" id="gpxi-statgrid"></div>
          <div class="gpxi-stat-help">${t("gpxinspect.points_help_short", "Was ein Punkt ist")}<span class="gpxi-q" data-tip="${t("gpxinspect.points_help", "Ein Track besteht aus vielen einzelnen Messpunkten — jedes Mal, wenn dein Gerät die Position aufgezeichnet hat. Ein Punkt alle 1–10 Sekunden ist üblich; bei einer langen Tour kommen so schnell mehrere tausend zusammen. Auf der Karte ist jeder Punkt ein kleiner Kreis, den du anklicken kannst. Mehr Punkte heißt nicht besser: Beim Heilen werden Ausreißer entfernt und Lücken aufgefüllt, dabei ändert sich die Zahl.")}">?</span></div>
          <label class="gpxi-check" id="gpxi-speedcolor-row"><input type="checkbox" id="gpxi-speedcolor">
            🌡️ ${t("gpxinspect.speedcolor", "Nach Tempo einfärben")}<span class="gpxi-q" data-tip="${t("gpxinspect.speedcolor_help", "Färbt den Track nach Geschwindigkeit zwischen den Punkten: grün = normal, gelb = zügig, orange = sehr schnell, rot = Ausreißer-verdächtig. So springen GPS-Sprünge sofort ins Auge — dann Heilen oder den Abschnitt manuell glätten. Braucht Zeitstempel.")}">?</span></label>
          <div class="gpxi-speedlegend" id="gpxi-speedlegend" hidden></div>
          <div class="gpxi-fillrow" id="gpxi-speedthr-row" hidden>
            <label>${t("gpxinspect.speedthr", "Rot ab")}<span class="gpxi-q" data-tip="${t("gpxinspect.speedthr_help", "Ab welchem Tempo ein Stück als Ausreißer gilt (rot). Leer = automatisch aus dieser Tour selbst (grün bis zum üblichen Tempo, rot erst deutlich darüber) — das passt für Wandern wie für Autofahrten. Trägst du eine Zahl ein, gilt sie fest: grün bis zu einem Drittel, gelb bis zwei Dritteln, orange bis zur Schwelle, rot darüber.")}">?</span></label>
            <input type="number" id="gpxi-speed-thr" min="1" max="500" step="1" placeholder="${t("gpxinspect.tempo_cap_auto", "auto")}"> km/h
          </div>
          <div class="gpxi-mm-title">🩹 ${t("gpxinspect.heal_title", "Heilen (automatisch)")}<span class="gpxi-q" data-tip="${t("gpxinspect.heal_help", "Findet automatisch GPS-Ausreißer und Lücken und behebt sie. Bereich und Aktionen wählen, dann Heilen. Rückgängig jederzeit.")}">?</span></div>
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
          <div class="gpxi-undorow">
            <button class="btn" id="gpxi-undo" disabled title="⌘Z">↩︎ ${t("gpxinspect.undo", "Rückgängig")}</button>
            <button class="btn" id="gpxi-redo" disabled title="⌘⇧Z">↪︎ ${t("gpxinspect.redo", "Wiederherstellen")}</button>
          </div>

          <hr class="gpxi-hr">
          <!-- 31.08.2026 (der MTB-Kollege eines Beta-Testers): Punkte reduzieren + Tempo
               umschreiben — direkt am Track, speichern wie nach dem Heilen. -->
          <details class="gpxi-manual" id="gpxi-toolbox">
            <summary class="gpxi-mm-title">✂️ ${t("gpxinspect.tools_title", "Reduzieren & Tempo")}<span class="gpxi-q" data-tip="${t("gpxinspect.tools_help", "Punktzahl der Datei verkleinern (echte Punkte bleiben, gleichmäßig nach Strecke gewählt) oder die Zeitstempel auf ein Wunsch-Ø-Tempo umschreiben — z. B. um eine geplante Route mit realistischer Geschwindigkeit zu animieren. Beides landet erst beim Speichern in einer Datei.")}">?</span></summary>
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
          </details>

          <details class="gpxi-manual" open>
            <summary class="gpxi-mm-title">✏️ ${t("gpxinspect.manual_title", "Manuell bearbeiten (A→B)")}<span class="gpxi-q" data-tip="${t("gpxinspect.manual_help", "Zwei Punkte auf der Karte klicken (A grün, B rot), dann eine Aktion für den Abschnitt dazwischen wählen — z. B. Punkte dazwischen löschen.")}">?</span></summary>
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
            <button class="btn gpxi-act gpxi-del" id="gpxi-delete-one" disabled
              title="${t("gpxinspect.delete_one_tip", "Den ausgewählten Punkt (Anker A) entfernen. Geht auch mit Entf/Backspace.")}">
              🗑 ${t("gpxinspect.delete_one", "Diesen Punkt löschen")}</button>
            <button class="btn gpxi-act gpxi-del" id="gpxi-trim-before" disabled
              title="${t("gpxinspect.trim_before_tip", "Den Track-Anfang bis zu diesem Punkt entfernen — dieser Punkt wird der neue Start (z. B. Anfahrt oder Stillstand am Anfang wegschneiden).")}">
              ⏮ ${t("gpxinspect.trim_before", "Alles davor abschneiden")}</button>
            <button class="btn gpxi-act gpxi-del" id="gpxi-trim-after" disabled
              title="${t("gpxinspect.trim_after_tip", "Alles nach diesem Punkt entfernen — dieser Punkt wird das neue Ende (z. B. vergessenes Stoppen der Aufzeichnung am Tourende wegschneiden).")}">
              ⏭ ${t("gpxinspect.trim_after", "Alles danach abschneiden")}</button>
            <button class="btn gpxi-act gpxi-del" id="gpxi-delete" disabled
              title="${t("gpxinspect.delete_tip", "Die Punkte zwischen A und B ganz entfernen (Schleifen/Abstecher rausschneiden). A und B bleiben, die Linie verbindet sie direkt.")}">
              ✂️ ${t("gpxinspect.delete", "Punkte zwischen A→B rausschneiden")}</button>
            <button class="btn gpxi-clear" id="gpxi-clearsel" disabled>${t("gpxinspect.clear_sel", "Auswahl aufheben")}</button>
          </details>
          <hr class="gpxi-hr">
          <!-- v0.9.456 — Mehrere Aufzeichnungen zu EINEM Track verbinden.
               Der Sprung an der Nahtstelle wird bewusst NICHT automatisch
               überbrückt: eine gerade Linie dort wäre eine erfundene Strecke.
               Stattdessen beziffern wir die Lücke und verweisen aufs Heilen. -->
          <div class="gpxi-mm-title">🔗 ${t("gpxinspect.join_title", "Tracks verbinden")}<span class="gpxi-q" data-tip="${t("gpxinspect.join_help", "Hängt eine weitere Aufzeichnung an diesen Track — z. B. wenn die Uhr mittendrin gestoppt hat oder eine Mehrtagestour als eine Datei pro Tag vorliegt. Sensordaten (Puls, Leistung …) bleiben pro Abschnitt erhalten.")}">?</span></div>
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
          <hr class="gpxi-hr">
          <div class="gpxi-mm-title">⛰ ${t("gpxinspect.ele_title", "Höhe korrigieren")}<span class="gpxi-q" data-tip="${t("gpxinspect.ele_help", "GPS-Höhe ist verrauscht. Lädt das Höhenprofil aus der Karte; darunter mischst du GPS und Karte mit dem Regler. Braucht Mapbox-Token + Internet.")}">?</span></div>
          <button class="btn gpxi-act" id="gpxi-ele-load">🗺 ${t("gpxinspect.ele_load", "Höhenprofil aus Karte laden")}</button>
          <div class="gpxi-fillrow gpxi-sensrow">
            <label>${t("gpxinspect.ele_weight", "GPS ⟷ Karte")}</label>
            <input type="range" id="gpxi-ele-weight" min="0" max="100" step="5" value="70" disabled>
            <span id="gpxi-ele-weight-val" class="gpxi-sensval">70 %</span>
          </div>
          <button class="btn btn-primary gpxi-act" id="gpxi-ele-apply" disabled>⛰ ${t("gpxinspect.ele_apply", "Diese Höhe übernehmen")}</button>
          <div class="gpxi-note muted" id="gpxi-ele-result"></div>
          <hr class="gpxi-hr">
          <button class="btn btn-primary" id="gpxi-save" disabled>💾 ${t("gpxinspect.save", "Geheilten Track speichern …")}</button>
          <button class="btn gpxi-reset" id="gpxi-reset" disabled>↩︎ ${t("gpxinspect.reset", "Änderungen verwerfen")}</button>
          <div class="gpxi-note muted" id="gpxi-note"></div>
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
            9,  ["case", ["boolean", ["get", "spike"], false], 4,  2.2],
            14, ["case", ["boolean", ["get", "spike"], false], 7,  4.5],
            18, ["case", ["boolean", ["get", "spike"], false], 10, 7]],
          "circle-color": ["case",
            ["==", ["get", "sel"], "a"], "#22c55e",
            ["==", ["get", "sel"], "b"], "#ef4444",
            ["boolean", ["get", "spike"], false], "#f59e0b",
            // 29.08.2026 — Tempo-Einfärbung: bei 2 788 dichten Punkten sieht
            // man die Kreise, nicht die Linie darunter — also färben BEIDE.
            ["coalesce", ["get", "sc"], "#cfe6ff"]],
          "circle-stroke-width": ["case",
            ["boolean", ["get", "spike"], false], 2.4,
            ["boolean", ["get", "anchor"], false], 2.2, 0.6],
          "circle-stroke-color": ["case",
            ["==", ["get", "sel"], "a"], "#0a7a32",
            ["==", ["get", "sel"], "b"], "#a11",
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
      if (cur) loadTrack(cur);
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
  async function loadTrack(path) {
    let res;
    try { res = await api().gpxinspect_load(path); } catch (e) { res = { ok: false, error: String(e) }; }
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
    _srcPath = res.src || path;   // v0.9.295 — konvertierter GPX-Pfad (Fremdformate), sonst Original
    _sources = [_srcPath];        // v0.9.456 — Quelle 0; „Track anhängen" hängt weitere an
    _origPath = path;             // v0.9.335 — Original-Datei (für Default-Speicherort beim „Speichern unter…")
    _hasTime = !!res.has_time; _hasEle = !!res.has_ele; _hasSensors = !!res.has_sensors;
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
    const i = _nearestIdxToPoint(e.point.x, e.point.y, Infinity);
    if (i < 0) return;
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
    try { res = await api().gpxinspect_map_match(coords, profile, radius); }
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
    try { res = await api().gpxinspect_route_ab([A.lon, A.lat], [B.lon, B.lat], profile); }
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

  async function healAllSpikes() {
    if (!_spikes.length && !_gaps.length) return;
    _pushUndo(t("gpxinspect.heal_all", "Auto-Heilen"));
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
      const gapsAB = _gaps.map((g) => [_points[g.a].lon, _points[g.a].lat, _points[g.b].lon, _points[g.b].lat]);
      _mmBusy = true; updateUI();
      toast(t("gpxinspect.gap_routing", "Suche Routen für %g Lücken …").replace("%g", nG), "info", 4000);
      let res;
      try { res = await api().gpxinspect_route_gaps(gapsAB, fillMode); }
      catch (e) { res = { ok: false, error: String(e) }; }
      _mmBusy = false;
      if (res && res.error === "no_token") {
        toast(t("gpxinspect.match_no_token", "Kein Mapbox-Token konfiguriert (siehe Einstellungen) — fülle linear."), "warn", 3500);
      }
      const routes = (res && res.ok && Array.isArray(res.routes)) ? res.routes : [];
      let routed = 0, fillPts = 0, detour = 0;
      const order = _gaps.map((g, i) => ({ g, i })).sort((x, y) => y.g.a - x.g.a);
      for (const { g, i } of order) {
        const r = routes[i];
        // v0.9.315 — nur anwenden, wenn die Route KEIN Umweg/Schleife ist (sonst gerade
        // füllen). Schützt saubere Spuren davor, an Kreuzungen verbogen zu werden.
        if (r && r.ok && Array.isArray(r.coords) && r.coords.length >= 2 && !_routeIsDetour(r.coords, g.dist, 2.5)) {
          _applyRoutedRange(g.a, g.b, r.coords);   // ersetzt [a..b] durch die Wege-Route
          routed++;
        } else {
          if (r && r.ok && Array.isArray(r.coords) && r.coords.length >= 2) detour++;  // war Route, aber Umweg
          fillPts += _linearFillGap(g, spacing);   // Fallback: gerade Linie (Flugbögen ODER verworfener Umweg)
        }
      }
      const nT = ((document.getElementById("gpxi-heal-tempo") || {}).checked) ? tempoEntzerren() : 0;
      _dirty = true; clearSpikes(); _selA = _selB = null;
      renderAll(); updateUI();
      const msg = t("gpxinspect.heal_done_route", "Geheilt: %s Ausreißer · %r Lücken an Route angepasst, %l gerade gefüllt")
        .replace("%s", nS).replace("%r", routed).replace("%l", nG - routed)
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
      + (nT ? " · " + t("gpxinspect.heal_tempo_done", "%t Tempo-Stellen entzerrt").replace("%t", nT) : ""), "success", 3200);
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
          res = await api().library_track_ersetzen(payload, _srcPath, origPfad,
                                                   _sources.length > 1 ? _sources : null);
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
      res = await api().gpxinspect_save(payload, _srcPath, dest, fmt,
                                        _sources.length > 1 ? _sources : null);
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
  const _on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener("click", fn); };
  _on("gpxi-heal", healSegment);
  _on("gpxi-fill", fillGap);
  _on("gpxi-drawfill", startDraw);
  _on("gpxi-draw-apply", applyDrawnPath);
  _on("gpxi-draw-undo", undoDrawPoint);
  _on("gpxi-draw-cancel", cancelDraw);
  _on("gpxi-delete-one", deletePoint);
  _on("gpxi-trim-before", trimBefore);
  _on("gpxi-trim-after", trimAfter);
  _on("gpxi-delete", deleteBetween);
  _on("gpxi-clearsel", clearSelection);
  _on("gpxi-match-sel", routeSelection);

  // Entf/Backspace: einzelnen Punkt (nur A) oder Bereich (A+B) löschen.
  // Nicht feuern wenn man in einem Eingabefeld tippt oder im Zeichnen-Modus ist.
  function onKeyDown(e) {
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
      files = await api().pick_file("open", window.TRACK_PICK_FILTER || [], false);
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
      res = await api().gpxinspect_append_track(
        _points.map(p => ({ lat: p.lat, lon: p.lon, ele: p.ele, time: p.time, oi: p.oi, si: p.si || 0 })),
        path, mode, pause, _sources.length);
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

  updateUI();

  // ── Cleanup ──────────────────────────────────────────────────────────────────
  return function cleanup() {
    isUnmounted = true;
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
