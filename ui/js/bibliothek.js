/* Die Tour-Bibliothek — Erststart und die vier Fehlerfälle.
 *
 * Beschlossen mit Marc am 02.09.2026, siehe docs/UMBAU-BIBLIOTHEK.md.
 * Diese Datei bringt genau das auf den Schirm, was `bibliothek_status()`
 * meldet, und zwar VOR allem anderen: Ohne Bibliothek gibt es kein Archiv,
 * keine Projekte, nichts. Ein halb bedienbares Fenster wäre schlimmer als
 * eine klare Ansage.
 *
 * ⚠️ Grundsatz aus der Entscheidung: Es wird NIEMALS stillschweigend eine
 * leere neue Bibliothek angelegt. Jeder Ausweg hier ist eine bewusste
 * Handlung des Nutzers.
 */
(function () {
  "use strict";

  function T(k, f) { try { return t(k, f); } catch (_) { return f; } }
  function api() { return window.pywebview.api; }

  function schale(inhalt) {
    var alt = document.getElementById("bib-gate");
    if (alt) alt.remove();
    var el = document.createElement("div");
    el.id = "bib-gate";
    el.innerHTML = '<div class="bib-gate-box">' + inhalt + "</div>";
    document.body.appendChild(el);
    return el;
  }

  function weg() {
    var el = document.getElementById("bib-gate");
    if (el) el.remove();
  }

  /* Kennungen aus core/bibliothek.py und core/umzug.py — dort gibt es keine
     Übersetzung, deshalb werden sie erst hier zu Sätzen. */
  function grundText(r) {
    var g = (r && r.grund) || "";
    if (r && r.cloud) {
      return T("bib.cloud_abgelehnt",
        "Dieser Ordner gehört zu {dienst} und ist deshalb nicht möglich.").replace("{dienst}", r.cloud);
    }
    var m = {
      kein_ordner: T("bib.g_kein_ordner", "Das ist kein Ordner."),
      eltern_fehlt: T("bib.g_eltern_fehlt", "Der übergeordnete Ordner gibt es nicht."),
      kein_schreibrecht: T("bib.g_kein_schreibrecht", "Dort darf GPS Studio nicht schreiben."),
      ziel_nicht_leer: T("bib.g_ziel_nicht_leer", "Der Zielordner ist nicht leer."),
      kopie_unvollstaendig: T("bib.g_kopie_unvollstaendig", "Die Kopie blieb unvollständig — es wurde nichts geändert."),
      sicherung_fehlt: T("bib.g_sicherung_fehlt", "Diese Sicherung gibt es nicht mehr."),
      sicherung_unmoeglich: T("bib.g_sicherung_unmoeglich", "Es ließ sich keine Sicherung anlegen — deshalb wurde abgebrochen."),
      db_unlesbar: T("bib.g_db_unlesbar", "Die kopierte Datenbank war nicht lesbar — der bisherige Bestand bleibt liegen."),
      nicht_wegraeumbar: T("bib.g_nicht_wegraeumbar", "Der alte Ordner ließ sich nicht wegräumen."),
    };
    return m[g] || g || (r && r.error) || "?";
  }

  function mb(n) {
    if (!n) return "0 MB";
    return (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + " MB";
  }

  /* ── Erststart ──────────────────────────────────────────────────────────
   * Drei Schritte, ausdrücklich OHNE Mapbox-Konto und ohne Cloud: Wer die
   * App zum ersten Mal öffnet, soll sie sehen, nicht sich anmelden.       */
  function onboarding(st) {
    var vorschlag = (st.problem && st.problem.vorschlag) || st.ort;
    var gewaehlt = vorschlag;
    var el = schale(
      '<h2>' + T("bib.willkommen", "Willkommen bei GPS Studio") + "</h2>" +
      '<p>' + T("bib.willkommen_text",
        "Deine Touren, Projekte und Einstellungen leben in einer Bibliothek — einem Ordner, den du selbst bestimmst. Du kannst ihn später jederzeit wechseln.") + "</p>" +
      '<div class="bib-ort"><code id="bib-ort-anzeige"></code>' +
      '<button class="btn btn-sm" id="bib-waehlen">' + T("bib.ordner_waehlen", "Anderen Ordner wählen …") + "</button></div>" +
      '<p class="bib-warn" id="bib-hinweis" hidden></p>' +
      '<p class="muted bib-klein">' + T("bib.cloud_hinweis",
        "Cloud-Ordner wie Dropbox, iCloud Drive oder OneDrive gehen nicht: Sie tauschen Dateien mitten im Schreiben aus, die Datenbank geht dabei kaputt. Externe Platten und NAS sind in Ordnung.") + "</p>" +
      '<div class="bib-knoepfe"><button class="btn btn-primary" id="bib-los">' +
      T("bib.loslegen", "Bibliothek anlegen und loslegen") + "</button></div>");

    function zeigen() {
      el.querySelector("#bib-ort-anzeige").textContent = gewaehlt;
    }
    zeigen();

    el.querySelector("#bib-waehlen").onclick = async function () {
      var r = await api().bibliothek_ordner_waehlen();
      if (!r || r.cancelled) return;
      var h = el.querySelector("#bib-hinweis");
      if (!r.ok) {
        h.hidden = false;
        h.textContent = grundText(r);
        return;
      }
      h.hidden = !r.nicht_leer;
      if (r.nicht_leer) {
        h.textContent = T("bib.nicht_leer",
          "Der Ordner ist nicht leer. GPS Studio legt dort eigene Unterordner an — besser einen eigenen Ordner wählen.");
      }
      gewaehlt = r.pfad;
      zeigen();
    };

    el.querySelector("#bib-los").onclick = async function () {
      var b = el.querySelector("#bib-los");
      b.disabled = true;
      b.textContent = T("bib.lege_an", "Wird angelegt …");
      var r = await api().bibliothek_festlegen(gewaehlt);
      if (r && r.ok) { weg(); location.reload(); return; }
      b.disabled = false;
      b.textContent = T("bib.loslegen", "Bibliothek anlegen und loslegen");
      var h = el.querySelector("#bib-hinweis");
      h.hidden = false;
      h.textContent = grundText(r || {});
    };
  }

  /* ── Bibliothek nicht erreichbar ────────────────────────────────────────
   * Externe Platte ab, NAS weg, Ordner umbenannt. Anhalten und sagen, was
   * los ist — mit den zwei Auswegen, die es wirklich gibt.               */
  function fehlt(st) {
    var el = schale(
      '<h2>' + T("bib.fehlt_titel", "Bibliothek nicht erreichbar") + "</h2>" +
      '<p>' + T("bib.fehlt_text",
        "GPS Studio findet deine Bibliothek gerade nicht. Wenn sie auf einer externen Platte oder einem Netzlaufwerk liegt: anschließen beziehungsweise verbinden und erneut suchen.") + "</p>" +
      '<div class="bib-ort"><code>' + (st.problem.ort || "") + "</code></div>" +
      '<p class="muted bib-klein">' + T("bib.fehlt_beruhigung",
        "Es wurde nichts gelöscht und nichts neu angelegt. Deine Daten liegen dort, wo sie waren.") + "</p>" +
      '<div class="bib-knoepfe">' +
      '<button class="btn btn-primary" id="bib-nochmal">' + T("bib.erneut_suchen", "Erneut suchen") + "</button>" +
      '<button class="btn" id="bib-anderer">' + T("bib.anderer_ort", "Anderen Ort wählen …") + "</button></div>");
    el.querySelector("#bib-nochmal").onclick = async function () {
      var r = await api().bibliothek_erneut();
      if (r && r.ok) { weg(); location.reload(); } else pruefen();
    };
    el.querySelector("#bib-anderer").onclick = async function () {
      var w = await api().bibliothek_ordner_waehlen();
      if (!w || !w.ok) return;
      var r = await api().bibliothek_festlegen(w.pfad);
      if (r && r.ok) { weg(); location.reload(); }
    };
  }

  /* ── Von einer anderen Instanz belegt (Riegel 2) ────────────────────── */
  function belegt(st) {
    var v = st.problem.belegt_von || {};
    var el = schale(
      '<h2>' + T("bib.belegt_titel", "Bibliothek ist bereits geöffnet") + "</h2>" +
      '<p>' + T("bib.belegt_text",
        "Eine andere GPS-Studio-Instanz hat diese Bibliothek offen. Zwei gleichzeitig würden sich gegenseitig die Daten überschreiben.") + "</p>" +
      '<div class="bib-ort"><code>' + (st.problem.ort || "") + "</code></div>" +
      (v.rechner ? '<p class="muted bib-klein">' + T("bib.belegt_von", "Geöffnet von {rechner}, seit {seit}.")
        .replace("{rechner}", v.rechner).replace("{seit}", (v.seit || "").replace("T", " ")) + "</p>" : "") +
      '<div class="bib-knoepfe">' +
      '<button class="btn btn-primary" id="bib-nochmal">' + T("bib.erneut_suchen", "Erneut suchen") + "</button>" +
      '<button class="btn" id="bib-anderer">' + T("bib.anderer_ort", "Anderen Ort wählen …") + "</button></div>");
    el.querySelector("#bib-nochmal").onclick = async function () {
      var r = await api().bibliothek_erneut();
      if (r && r.ok) { weg(); location.reload(); } else pruefen();
    };
    el.querySelector("#bib-anderer").onclick = async function () {
      var w = await api().bibliothek_ordner_waehlen();
      if (!w || !w.ok) return;
      var r = await api().bibliothek_festlegen(w.pfad);
      if (r && r.ok) { weg(); location.reload(); }
    };
  }

  /* ── Datenbank defekt (Riegel 3) ────────────────────────────────────── */
  function defekt(st) {
    var sich = st.problem.sicherungen || [];
    var liste = sich.length
      ? sich.map(function (s) {
          return '<label class="bib-sicherung"><input type="radio" name="bib-sich" value="' + s.datei + '">' +
                 "<span>" + (s.zeit || "").replace("T", " ") + " · " + mb(s.groesse) +
                 (s.heil ? "" : " ⚠") + "</span></label>";
        }).join("")
      : '<p class="bib-warn">' + T("bib.keine_sicherung",
          "Es liegt keine Sicherung vor. Wende dich bitte an den Support, bevor du etwas löschst.") + "</p>";
    var el = schale(
      '<h2>' + T("bib.defekt_titel", "Die Archiv-Datenbank ist beschädigt") + "</h2>" +
      '<p>' + T("bib.defekt_text",
        "Die Datenbank deiner Bibliothek lässt sich nicht lesen. Deine Trackdateien sind davon nicht betroffen — nur der Index. Du kannst eine Sicherung zurückholen; die beschädigte Datei wird dabei nicht gelöscht, sondern beiseitegelegt.") + "</p>" +
      '<div class="bib-sicherungen">' + liste + "</div>" +
      '<div class="bib-knoepfe">' +
      (sich.length ? '<button class="btn btn-primary" id="bib-zurueck">' +
        T("bib.sicherung_zurueck", "Ausgewählte Sicherung zurückholen") + "</button>" : "") +
      '<button class="btn" id="bib-anderer">' + T("bib.anderer_ort", "Anderen Ort wählen …") + "</button></div>");
    var b = el.querySelector("#bib-zurueck");
    if (b) b.onclick = async function () {
      var w = el.querySelector('input[name="bib-sich"]:checked');
      if (!w) return;
      b.disabled = true;
      var r = await api().bibliothek_wiederherstellen(w.value);
      if (r && r.ok) { weg(); location.reload(); } else { b.disabled = false; pruefen(); }
    };
    el.querySelector("#bib-anderer").onclick = async function () {
      var w = await api().bibliothek_ordner_waehlen();
      if (!w || !w.ok) return;
      var r = await api().bibliothek_festlegen(w.pfad);
      if (r && r.ok) { weg(); location.reload(); }
    };
  }

  /* ── Umzug fehlgeschlagen ───────────────────────────────────────────── */
  /* ── Umzug: sichtbar, mit Fortschritt ────────────────────────────────
     02.09.2026 (Beta-Tester mit NAS: „die Migration dauert sehr lange"):
     Der Umzug lief vorher, bevor es ein Fenster gab. Wer seine Touren auf
     einem NAS hat, sah minutenlang gar nichts. Jetzt meldet sich dieser
     Schirm ZUERST, stößt den Umzug an und zeigt, wo er steht. */
  var SCHRITTE = {
    start:      "Wird vorbereitet …",
    sichern:    "Sicherung wird angelegt …",
    aufnehmen:  "Touren werden in die Bibliothek kopiert …",
    aufraeumen: "Alter Ort wird aufgeräumt …",
    fertig:     "Fertig.",
  };
  function umzugLaeuft(st) {
    var ziel = (st.problem && st.problem.ziel) || "";
    var el = schale(
      '<h2>' + T("bib.umzug_lauf_titel", "Deine Daten ziehen um") + "</h2>" +
      '<p>' + T("bib.umzug_lauf_text",
        "GPS Studio legt einmalig eine Bibliothek an und kopiert deinen Bestand hinein. Es wird nichts gelöscht — der bisherige Ort wird nur umbenannt. Liegen deine Touren auf einer Netzwerkplatte, kann das ein paar Minuten dauern.") + "</p>" +
      '<div class="bib-ort"><code>' + ziel + "</code></div>" +
      '<div class="bib-fortschritt"><div class="bib-fortschritt-balken" id="bib-umzug-bar"></div></div>' +
      '<p class="muted bib-klein" id="bib-umzug-schritt">' +
        T("bib.umzug_schritt_start", "Wird vorbereitet …") + "</p>");
    var bar = el.querySelector("#bib-umzug-bar");
    var txt = el.querySelector("#bib-umzug-schritt");
    api().bibliothek_umzug_starten().catch(function (e) {
      try { applog("error", "[bib] Umzug-Start: " + e); } catch (_) {}
    });
    var tick = setInterval(async function () {
      var r;
      try { r = await api().bibliothek_umzug_lauf(); } catch (_) { return; }
      if (!r) return;
      if (bar) bar.style.width = Math.round((r.anteil || 0) * 100) + "%";
      if (txt) {
        var name = SCHRITTE[r.schritt] || SCHRITTE.start;
        txt.textContent = T("bib.umzug_schritt_" + (r.schritt || "start"), name);
      }
      if (r.fertig) {
        clearInterval(tick);
        // Fertig oder gescheitert — in beiden Fällen entscheidet der frische
        // Status, welcher Schirm jetzt dran ist.
        location.reload();
      }
    }, 700);
  }

  function umzugKaputt(st) {
    var b = st.problem.bericht || {};
    var gruende = (b.probleme || []).map(function (x) {
      return "<li>" + (x.was || "") + ": " + grundText(x) + "</li>";
    }).join("");
    schale(
      '<h2>' + T("bib.umzug_fehler_titel", "Der Umzug ist nicht durchgelaufen") + "</h2>" +
      '<p>' + T("bib.umzug_fehler_text",
        "GPS Studio wollte deinen bisherigen Bestand in eine Bibliothek umziehen und hat abgebrochen. Es wurde nichts gelöscht — dein bisheriger Bestand liegt unverändert an seinem Platz.") + "</p>" +
      (gruende ? "<ul class='bib-warn'>" + gruende + "</ul>" : "") +
      (b.sicherung ? '<p class="muted bib-klein">' + T("bib.umzug_sicherung", "Sicherung liegt in: ") +
        "<code>" + b.sicherung + "</code></p>" : ""));
  }

  /* ── Umzug gelungen: einmal zeigen, was passiert ist ────────────────── */
  /* `erzwingen`: aus den Einstellungen heraus wird der Bericht auch dann
     gezeigt, wenn er beim Start schon einmal weggeklickt wurde. */
  function umzugBericht(b, erzwingen) {
    if (!b || !b.ok) return;
    if (!erzwingen) {
      try {
        if (localStorage.getItem("rz-umzug-gesehen") === (b.beendet || "1")) return;
      } catch (_) {}
    }
    var zeilen = (b.verschoben || []).map(function (x) {
      return "<li>" + x.was + " · " + x.n + "</li>";
    }).join("");
    var el = schale(
      '<h2>' + T("bib.umzug_ok_titel", "Deine Daten sind umgezogen") + "</h2>" +
      '<p>' + T("bib.umzug_ok_text",
        "GPS Studio bewahrt Touren und Projekte ab jetzt in einer Bibliothek auf. Dein bisheriger Bestand ist vollständig dorthin gewandert.") + "</p>" +
      '<div class="bib-ort"><code>' + (b.ort || "") + "</code></div>" +
      (zeilen ? "<ul class='bib-klein'>" + zeilen + "</ul>" : "") +
      '<p class="muted bib-klein">' + T("bib.umzug_ok_alt",
        "Der alte Bestand wurde nicht gelöscht, sondern nur umbenannt — falls doch etwas fehlt, ist es noch da.") + "</p>" +
      // Der Ort ist frei wählbar — das gehört HIERHIN gesagt, solange man
      // gerade darüber nachdenkt, und nicht nur ins Handbuch.
      '<p class="bib-klein">' + T("bib.umzug_ok_ort",
        "Dieser Ort ist frei wählbar. Wenn deine Touren lieber auf einer externen Platte oder einem Netzlaufwerk liegen sollen, kannst du die Bibliothek gleich hier verschieben — GPS Studio zieht sie dann wirklich um und fängt nicht neu an.") + "</p>" +
      '<p class="muted bib-klein">' + T("bib.umzug_ok_spaeter",
        "Später findest du das unter Einstellungen → Bibliothek → „An anderen Ort verschieben …“. Dort steht auch dieser Bericht wieder zur Verfügung.") + "</p>" +
      '<p class="bib-warn" id="bib-umz-hinweis" hidden></p>' +
      '<div class="bib-knoepfe">' +
      '<button class="btn btn-primary" id="bib-ok">' + T("common.ok", "Alles klar") + "</button>" +
      '<button class="btn" id="bib-umz">' + T("bib.umziehen", "An anderen Ort verschieben …") + "</button>" +
      "</div>");
    el.querySelector("#bib-ok").onclick = function () {
      try { localStorage.setItem("rz-umzug-gesehen", b.beendet || "1"); } catch (_) {}
      weg();
    };
    el.querySelector("#bib-umz").onclick = async function () {
      var knopf = el.querySelector("#bib-umz");
      var h = el.querySelector("#bib-umz-hinweis");
      var w = await api().bibliothek_ordner_waehlen();
      if (!w || w.cancelled) return;
      if (!w.ok) { h.hidden = false; h.textContent = grundText(w); return; }
      knopf.disabled = true;
      knopf.textContent = T("bib.zieht_um", "Wird verschoben …");
      var r = await api().bibliothek_umziehen(w.pfad);
      if (r && r.ok) {
        try { localStorage.setItem("rz-umzug-gesehen", b.beendet || "1"); } catch (_) {}
        location.reload();
        return;
      }
      knopf.disabled = false;
      knopf.textContent = T("bib.umziehen", "An anderen Ort verschieben …");
      h.hidden = false;
      h.textContent = grundText(r || {});
    };
  }

  async function pruefen() {
    var st;
    try {
      st = await api().bibliothek_status();
    } catch (e) {
      try { applog("error", "[bib] Status nicht abrufbar: " + e); } catch (_) {}
      return;
    }
    window.rzBibStatus = st;
    if (st.bereit) { weg(); umzugBericht(st.umzug); return; }
    var art = (st.problem && st.problem.art) || "fehlt";
    if (art === "erststart") onboarding(st);
    else if (art === "belegt") belegt(st);
    else if (art === "defekt") defekt(st);
    else if (art === "umzug") umzugKaputt(st);
    else if (art === "umzug_wartet") umzugLaeuft(st);
    else fehlt(st);
  }

  window.rzBibPruefen = pruefen;

  /** Den Umzugsbericht noch einmal ansehen (Einstellungen → Bibliothek).
   *  Holt ihn frisch, weil er nach einem Neustart nur noch in der
   *  Bibliothek liegt und nicht mehr im Speicher dieser Sitzung. */
  window.rzBibUmzugZeigen = async function () {
    try {
      const st = await api().bibliothek_status();
      if (st && st.umzug) { umzugBericht(st.umzug, true); return true; }
    } catch (e) {
      try { applog("warn", "[bib] Umzugsbericht: " + e); } catch (_) {}
    }
    return false;
  };
})();
