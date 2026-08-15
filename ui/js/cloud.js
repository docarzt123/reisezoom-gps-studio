/* Cloud-Archiv in der Oberfläche (v0.9.515, docs/IDEAS.md §26).
 *
 * ⚠️ ALLES HIER IST ZUSÄTZLICH. Ohne eingerichtete Cloud tut diese Datei
 * nichts: Die Zustandsanzeige bleibt versteckt, es läuft kein Zeitgeber, und
 * kein anderer Teil der App fragt hier etwas ab. Marcs Regel vom 15.08.2026:
 * „wer das nicht will, kann weiterhin wie bisher komplett lokal arbeiten."
 */
(function () {
  "use strict";

  var _stand = null;
  var _uhr = null;

  function T(k, f) { return (typeof t === "function") ? t(k, f) : f; }

  // ── Zustandsanzeige in der Kopfzeile ───────────────────────────────────
  // Marc wollte „kein Fenster, kein Ton, keine Meldung" — nur ein ruhiger
  // Hinweis, der erst dann laut wird, wenn wirklich etwas klemmt.
  function anzeigeElement() {
    var el = document.getElementById("cloud-stand");
    if (el) return el;
    var ziel = document.querySelector(".topbar-actions");
    if (!ziel) return null;
    el = document.createElement("button");
    el.id = "cloud-stand";
    el.type = "button";
    el.className = "cloud-stand";
    el.hidden = true;
    el.addEventListener("click", function () { openCloudModal(); });
    ziel.insertBefore(el, ziel.firstChild);
    return el;
  }

  function anzeigen(s) {
    var el = anzeigeElement();
    if (!el) return;
    if (!s || !s.verfuegbar || !s.eingerichtet) { el.hidden = true; return; }
    el.hidden = false;
    var lauf = s.lauf;
    if (lauf && lauf.n) {
      el.textContent = "☁ " + lauf.i + "/" + lauf.n;
      el.title = T("cloud.laeuft", "Überträgt gerade …");
      el.classList.add("laeuft");
    } else {
      el.textContent = "☁";
      el.title = T("cloud.aktuell", "Archiv ist abgeglichen");
      el.classList.remove("laeuft");
    }
  }

  function standHolen() {
    if (!window.pywebview || !window.pywebview.api || !window.pywebview.api.cloud_status) return;
    window.pywebview.api.cloud_status().then(function (s) {
      _stand = s;
      anzeigen(s);
      // ⚠️ Der Zeitgeber läuft NUR, solange etwas überträgt. Sonst fragte die
      // App im Sekundentakt nach, obwohl sich nie etwas ändert.
      if (s && s.lauf && s.lauf.n) {
        if (!_uhr) _uhr = setInterval(standHolen, 900);
      } else if (_uhr) {
        clearInterval(_uhr); _uhr = null;
      }
    }).catch(function (e) {
      // ⚠️ Ein stiller catch war hier ein Fehler: Als die Brücke einen Fehler
      // warf, blieb die Anzeige einfach weg — ohne jeden Hinweis, weder in der
      // Oberfläche noch im Log. Fehler gehören mindestens ins Log.
      try { applog("warn", "[cloud] Status nicht abrufbar: " + e); } catch (_) {}
    });
  }
  window.rzCloudStand = standHolen;

  // ── Einstellungsfenster ────────────────────────────────────────────────
  function openCloudModal() {
    var s = _stand || {};
    var eingerichtet = !!s.eingerichtet;
    var body = eingerichtet ? koerperVerbunden(s) : koerperNeu(s);
    openModal({
      title: T("cloud.titel", "Cloud-Archiv"),
      body: body,
      footer: '<button class="btn btn--ghost" id="cloud-zu">' +
              T("common.close", "Schließen") + "</button>",
    });
    document.getElementById("cloud-zu").onclick = function () { openModal({}).close(); };
    if (eingerichtet) handlerVerbunden(); else handlerNeu();
  }
  window.openCloudModal = openCloudModal;

  function koerperNeu(s) {
    return '' +
      '<p class="muted" style="line-height:1.55">' +
        T("cloud.intro",
          "Dein Archiv liegt auf deinem eigenen Webserver — verschlüsselt. " +
          "Lade dazu die Datei rz-cloud.php in einen Ordner deines Webspace und " +
          "trag hier die Adresse dieser Datei ein.") +
      '</p>' +
      '<p class="muted" style="font-size:12px;margin-top:8px">' +
        T("cloud.optional", "Das ist freiwillig. Ohne Cloud arbeitet die App wie bisher, alles bleibt lokal.") +
      '</p>' +
      '<label class="muted" style="display:block;margin-top:14px">' +
        T("cloud.adresse", "Adresse der Datei rz-cloud.php") + '</label>' +
      '<input type="text" id="cloud-adresse" style="width:100%" ' +
        'placeholder="https://deineseite.de/archiv/rz-cloud.php">' +
      '<div id="cloud-pruef" class="muted" style="font-size:12px;min-height:18px;margin-top:6px"></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">' +
        '<button class="btn btn--primary" id="cloud-neu">' +
          T("cloud.neu", "Neues Archiv anlegen") + '</button>' +
        '<button class="btn btn--ghost" id="cloud-alt">' +
          T("cloud.alt", "Mit vorhandenem verbinden") + '</button>' +
      '</div>' +
      '<div id="cloud-alt-felder" hidden style="margin-top:12px">' +
        '<label class="muted" style="display:block">' + T("cloud.zugang", "Zugangsschlüssel") + '</label>' +
        '<input type="text" id="cloud-zugangsschluessel" style="width:100%">' +
        '<label class="muted" style="display:block;margin-top:8px">' + T("cloud.passwort", "Archiv-Passwort") + '</label>' +
        '<input type="text" id="cloud-passwort" style="width:100%" placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX">' +
        '<button class="btn btn--primary" id="cloud-verbinden" style="margin-top:10px">' +
          T("cloud.verbinden", "Verbinden") + '</button>' +
      '</div>' +
      '<div id="cloud-meldung" style="margin-top:12px"></div>' +
      '<p class="muted" style="font-size:11px;margin-top:14px">' + (s.ablage || "") + '</p>';
  }

  function koerperVerbunden(s) {
    return '' +
      '<p>' + T("cloud.verbunden_mit", "Verbunden mit") + ':<br>' +
        '<code style="font-size:12px">' + (s.adresse || "") + '</code></p>' +
      '<div id="cloud-plan" class="muted" style="margin-top:10px">…</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">' +
        '<button class="btn btn--primary" id="cloud-jetzt">' +
          T("cloud.jetzt", "Jetzt abgleichen") + '</button>' +
        '<button class="btn btn--ghost" id="cloud-weg">' +
          T("cloud.trennen", "Verbindung trennen") + '</button>' +
      '</div>' +
      '<div id="cloud-meldung" style="margin-top:12px"></div>' +
      '<p class="muted" style="font-size:11px;margin-top:14px">' + (s.ablage || "") + '</p>';
  }

  function melden(html, art) {
    var el = document.getElementById("cloud-meldung");
    if (el) el.innerHTML = '<div class="' + (art === "fehler" ? "err" : "muted") +
                           '" style="padding:8px 10px;border-radius:8px">' + html + '</div>';
  }

  function handlerNeu() {
    var adr = document.getElementById("cloud-adresse");
    var pruef = document.getElementById("cloud-pruef");
    var warten = null;
    adr.oninput = function () {
      clearTimeout(warten);
      pruef.textContent = "";
      var wert = adr.value.trim();
      if (!wert) return;
      warten = setTimeout(function () {
        pruef.textContent = T("cloud.pruefe", "prüfe …");
        window.pywebview.api.cloud_pruefen(wert).then(function (r) {
          pruef.textContent = r.ok
            ? (r.eingerichtet
               ? "✓ " + T("cloud.gefunden_belegt", "Dort liegt bereits ein Archiv.")
               : "✓ " + T("cloud.gefunden_leer", "Gegenstelle gefunden, noch kein Archiv."))
            : "✗ " + r.error;
        });
      }, 600);
    };

    document.getElementById("cloud-alt").onclick = function () {
      var f = document.getElementById("cloud-alt-felder");
      f.hidden = !f.hidden;
    };

    document.getElementById("cloud-neu").onclick = function () {
      var wert = adr.value.trim();
      if (!wert) { melden(T("cloud.keine_adresse", "Bitte eine Adresse eintragen."), "fehler"); return; }
      melden(T("cloud.richte_ein", "Richte ein …"));
      window.pywebview.api.cloud_einrichten(wert).then(function (r) {
        if (!r.ok) { melden(r.error, "fehler"); return; }
        // ⚠️ Das Passwort wird GENAU EINMAL gezeigt. Danach liegt es nur im
        // Schlüsselbund — auch wir können es nicht wieder hervorholen.
        melden('<b>' + T("cloud.passwort_titel", "Dein Archiv-Passwort") + '</b>' +
               '<div style="font:600 20px/1.5 ui-monospace,monospace;letter-spacing:.06em;' +
               'margin:8px 0;user-select:all">' + r.passwort + '</div>' +
               '<div>' + T("cloud.passwort_hinweis",
                 "Speichere es jetzt in deinem Passwortmanager. Du brauchst es, um " +
                 "einen zweiten Rechner zu verbinden. Geht es verloren, kommt niemand " +
                 "mehr an die Daten — auch wir nicht.") + '</div>');
        standHolen();
      });
    };

    document.getElementById("cloud-verbinden").onclick = function () {
      melden(T("cloud.verbinde", "Verbinde …"));
      window.pywebview.api.cloud_verbinden(
        adr.value.trim(),
        document.getElementById("cloud-zugangsschluessel").value,
        document.getElementById("cloud-passwort").value
      ).then(function (r) {
        if (!r.ok) { melden(r.error, "fehler"); return; }
        melden(T("cloud.verbunden", "Verbunden."));
        standHolen();
        setTimeout(function () { openModal({}).close(); openCloudModal(); }, 700);
      });
    };
  }

  function handlerVerbunden() {
    var planEl = document.getElementById("cloud-plan");
    window.pywebview.api.cloud_plan().then(function (r) {
      planEl.textContent = r.ok ? r.text : ("✗ " + r.error);
    });
    document.getElementById("cloud-jetzt").onclick = function () {
      melden(T("cloud.laeuft", "Überträgt gerade …"));
      standHolen();
      window.pywebview.api.cloud_abgleichen().then(function (r) {
        if (!r.ok) { melden(r.error, "fehler"); return; }
        melden(T("cloud.fertig", "Fertig") + ": " + r.uebertragen + " · " + r.mb + " MB" +
               ((r.fehler && r.fehler.length) ? "<br>" + r.fehler.join("<br>") : ""));
        standHolen();
        window.pywebview.api.cloud_plan().then(function (p) {
          planEl.textContent = p.ok ? p.text : "";
        });
      });
    };
    document.getElementById("cloud-weg").onclick = function () {
      window.pywebview.api.cloud_trennen().then(function () {
        standHolen(); openModal({}).close();
      });
    };
  }

  // Beim Start einmal nachsehen — mehr nicht.
  //
  // ⚠️ NICHT auf `DOMContentLoaded` warten, sondern auf `whenApiReady()`:
  // Beim DOMContentLoaded gibt es `window.pywebview.api` noch gar nicht, der
  // Aufruf lief ins Leere und die Zustandsanzeige blieb dauerhaft versteckt —
  // ohne Fehlermeldung, weil `standHolen()` bei fehlender API still aussteigt.
  function starten() {
    if (typeof whenApiReady === "function") {
      whenApiReady().then(standHolen);
    } else {
      window.addEventListener("pywebviewready", standHolen, { once: true });
      standHolen();
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", starten);
  } else {
    starten();
  }
})();
