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
    if (!s || !s.verfuegbar) { el.hidden = true; return; }
    el.hidden = false;
    var lauf = s.lauf;
    var auto = s.auto || {};
    el.classList.remove("laeuft", "warnung", "aus");
    // v0.9.527 (Marc) — auch OHNE eingerichtete Cloud sichtbar (grau):
    // Klick öffnet den Dialog mit der Schritt-für-Schritt-Anleitung. Vorher
    // war die Funktion ohne Verbindung praktisch unauffindbar.
    if (!s.eingerichtet) {
      el.textContent = "☁";
      el.title = T("cloud.aus_hinweis", "Cloud-Archiv einrichten — Klick für die Anleitung");
      el.classList.add("aus");
      return;
    }
    if (lauf && lauf.n) {
      el.textContent = "☁ " + lauf.i + "/" + lauf.n;
      el.title = T("cloud.laeuft", "Überträgt gerade …");
      el.classList.add("laeuft");
    } else if (auto.status === "rueckstau") {
      // v0.9.524 — Auto-Sync kam nicht durch (offline?): still, aber sichtbar.
      el.textContent = "☁⚠";
      el.title = T("cloud.rueckstau", "Hochladen ausstehend — wird automatisch erneut versucht.") +
                 (auto.grund ? "\n" + auto.grund : "");
      el.classList.add("warnung");
    } else if (auto.status === "wartet") {
      el.textContent = "☁…";
      el.title = T("cloud.wartet", "Änderungen erkannt — Hochladen startet gleich.");
    } else {
      el.textContent = "☁";
      el.title = T("cloud.aktuell", "Archiv ist abgeglichen") +
                 (auto.zeit ? " (" + auto.zeit.replace("T", " ") + ")" : "");
    }
  }

  function standHolen() {
    if (!window.pywebview || !window.pywebview.api || !window.pywebview.api.cloud_status) return;
    window.pywebview.api.cloud_status().then(function (s) {
      _stand = s;
      // ⚠️ Versteckt heißt wirklich versteckt: keine Anzeige, kein Zeitgeber,
      // und `ui/js/app.js` liest dieses Merkmal, um den Abschnitt in den
      // Einstellungen wegzulassen. Siehe `_cloud_sichtbar()` in app.py.
      window.rzCloudSichtbar = !!(s && s.sichtbar);
      // 02.09.2026 — Stillgelegt ist NICHT dasselbe wie „gibt es nicht":
      // Wer die Cloud eingerichtet hat, soll in den Einstellungen erklärt
      // bekommen, warum sie verschwunden ist, statt sie zu vermissen.
      window.rzCloudStillgelegt = !!(s && s.stillgelegt);
      if (!window.rzCloudSichtbar) {
        var weg = document.getElementById("cloud-stand");
        if (weg) weg.hidden = true;
        if (_uhr) { clearInterval(_uhr); _uhr = null; }
        return;
      }
      anzeigen(s);
      // ⚠️ Der Zeitgeber läuft NUR, solange etwas überträgt. Sonst fragte die
      // App im Sekundentakt nach, obwohl sich nie etwas ändert.
      if (s && s.lauf && s.lauf.n) {
        if (!_uhr) _uhr = setInterval(standHolen, 900);
      } else if (_uhr) {
        clearInterval(_uhr); _uhr = null;
      }
      // v0.9.524 — Auto-Sync lebt im Hintergrund: alle 90 s ein stiller
      // Blick, damit ☁/☁…/☁⚠ die Wahrheit zeigt, ohne dass etwas pollt,
      // wenn gar keine Cloud eingerichtet ist.
      if (s && s.eingerichtet && !window.__cloudPuls) {
        window.__cloudPuls = setInterval(standHolen, 90000);
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
    // v0.9.527 — Schritt-für-Schritt für Einsteiger: Die App LIEFERT die
    // Server-Datei (Knopf legt sie auf den Schreibtisch), die Schritte sind
    // in einfacher Sprache. Voraussetzung beim Nutzer: nur ein eigener
    // Webspace mit PHP und HTTPS.
    return '' +
      '<p class="muted" style="line-height:1.55">' +
        T("cloud.intro2",
          "Dein Tour-Archiv, verschlüsselt auf deinem eigenen Webspace: Geht dieser Rechner kaputt, ist alles noch da — und ein zweiter Rechner kann sich mit demselben Archiv verbinden.") +
      '</p>' +
      '<p class="muted" style="font-size:12px;margin-top:6px">' +
        T("cloud.optional", "Das ist freiwillig. Ohne Cloud arbeitet die App wie bisher, alles bleibt lokal.") +
      '</p>' +
      '<div style="margin-top:14px;padding:12px;border:1px solid var(--border);border-radius:10px">' +
        '<strong style="font-size:13px">' + T("cloud.anl_titel", "So richtest du es ein (einmalig, ca. 5 Minuten)") + '</strong>' +
        '<ol class="muted" style="line-height:1.6;font-size:13px;margin:8px 0 0 18px;padding:0">' +
          '<li>' + T("cloud.anl_s1", "Klick den Knopf unten — die App legt dir die Datei rz-cloud.php auf den Schreibtisch.") + '</li>' +
          '<li>' + T("cloud.anl_s2", "Lade diese Datei in einen eigenen Ordner deines Webspace hoch (z. B. „archiv“) — mit deinem FTP-Programm oder dem Datei-Manager deines Hosters. Dein Webspace braucht nur PHP und HTTPS; das kann praktisch jeder Hoster.") + '</li>' +
          '<li>' + T("cloud.anl_s3", "Trag unten die Internet-Adresse dieser Datei ein (https://deineseite.de/archiv/rz-cloud.php) und klick „Neues Archiv anlegen“.") + '</li>' +
          '<li>' + T("cloud.anl_s4", "Die App zeigt dir dann EINMALIG dein Passwort und deinen Zugangsschlüssel. Speichere beides im Passwortmanager — ohne Passwort kommt niemand mehr an das Archiv, auch wir nicht.") + '</li>' +
        '</ol>' +
        '<div style="margin-top:10px">' +
          '<button class="btn btn--ghost" id="cloud-php">📄 ' +
            T("cloud.php_knopf", "rz-cloud.php auf den Schreibtisch legen") + '</button>' +
          '<span id="cloud-php-stand" class="muted" style="font-size:12px;margin-left:8px"></span>' +
        '</div>' +
      '</div>' +
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
    var auto = s.auto || {};
    var autoText =
      auto.status === "aktuell" ? T("cloud.auto_aktuell", "Automatischer Abgleich: aktuell") +
        (auto.zeit ? " · " + auto.zeit.replace("T", " ") : "") :
      auto.status === "laeuft" ? T("cloud.auto_laeuft", "Automatischer Abgleich: überträgt gerade …") :
      auto.status === "wartet" ? T("cloud.auto_wartet", "Automatischer Abgleich: Änderungen erkannt, startet gleich") :
      auto.status === "rueckstau" ? T("cloud.auto_rueckstau", "Automatischer Abgleich: ausstehend — wird erneut versucht") :
      T("cloud.auto_bereit", "Automatischer Abgleich: bereit — lädt nach Änderungen von selbst hoch");
    return '' +
      '<p>' + T("cloud.verbunden_mit", "Verbunden mit") + ':<br>' +
        '<code style="font-size:12px">' + (s.adresse || "") + '</code></p>' +
      '<p class="muted" style="margin-top:6px">🔄 ' + autoText + '</p>' +
      '<div id="cloud-plan" class="muted" style="margin-top:10px">…</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">' +
        '<button class="btn btn--primary" id="cloud-jetzt">' +
          T("cloud.jetzt", "Jetzt abgleichen") + '</button>' +
        '<button class="btn btn--ghost" id="cloud-daten">' +
          T("cloud.daten_zeigen", "Zugangsdaten anzeigen") + '</button>' +
        '<button class="btn btn--ghost" id="cloud-weg">' +
          T("cloud.trennen", "Verbindung trennen") + '</button>' +
      '</div>' +
      '<div id="cloud-meldung" style="margin-top:12px"></div>' +
      '<div id="cloud-ferne" style="margin-top:14px"></div>' +
      '<div id="cloud-korb" style="margin-top:14px"></div>' +
      '<p class="muted" style="font-size:11px;margin-top:14px">' + (s.ablage || "") + '</p>';
  }

  /* ── Übersicht: was liegt oben, was ist offen ────────────────────────────
   * 02.09.2026 — die Cloud ist eine Kopie der Bibliothek. Vorher stand hier
   * eine Liste einzelner Touren zum Nachladen, dazu eine für Reisen und
   * Schwärme: das alte Umschlag-Modell, ein zweites Datenmodell neben dem
   * echten. Jetzt gibt es genau zwei Richtungen — hoch und runter. */
  function ferneLaden() {
    var box = document.getElementById("cloud-ferne");
    if (!box) return;
    box.innerHTML = '<span class="muted">' + T("cloud.ferne_lade", "Schaue ins Archiv …") + '</span>';
    window.pywebview.api.cloud_uebersicht().catch(function (e) { return { ok: false, error: String(e) }; }).then(function (u) {
      if (!box.isConnected) return;
      if (!u.ok) { box.innerHTML = '<span class="muted">⚠ ' + u.error + '</span>'; return; }
      var l = u.lokal || {};
      box.innerHTML =
        '<b>' + T("cloud.ferne_titel", "In der Cloud") + ':</b> ' + u.oben + ' ' +
          T("cloud.objekte", "Objekte") +
        ' · <b>' + T("cloud.hier", "hier") + ':</b> ' + (l.touren || 0) + ' ' +
          T("library.tours", "Touren") +
        (u.offen ? ' · <span class="warnung">' + u.offen + ' ' +
            T("cloud.offen", "noch nicht hochgeladen") + '</span>' : '') +
        (u.nur_oben ? ' · <span class="muted">' + u.nur_oben + ' ' +
            T("cloud.nur_oben", "nur in der Cloud") + '</span>' : '') +
        '<div style="margin-top:10px">' +
          '<button class="btn btn--ghost" id="cloud-runter">' +
            T("cloud.herunterladen", "Bibliothek aus der Cloud laden") + '</button>' +
          (u.nur_oben ? ' <button class="btn btn--ghost" id="cloud-putzen">' +
            T("cloud.aufraeumen", "{n} Fremdes entfernen").replace("{n}", u.nur_oben) +
            '</button>' : '') +
          '<p class="muted" style="font-size:11px;margin-top:6px">' +
            T("cloud.herunterladen_hinweis",
              "Holt alles, was hier fehlt — für einen zweiten Rechner oder nach einem Datenverlust. Vorhandenes wird nicht überschrieben.") +
          '</p></div>';
      var pz = document.getElementById("cloud-putzen");
      if (pz) pz.onclick = function () {
        // Zwei Klicks — Löschen ist nie ein Versehen.
        if (!pz._sicher) {
          pz._sicher = true;
          pz.textContent = T("cloud.aufraeumen_sicher", "Wirklich entfernen?");
          setTimeout(function () {
            if (pz.isConnected) {
              pz._sicher = false;
              pz.textContent = T("cloud.aufraeumen", "{n} Fremdes entfernen").replace("{n}", u.nur_oben);
            }
          }, 4000);
          return;
        }
        pz.disabled = true;
        pz.textContent = "⏳";
        window.pywebview.api.cloud_aufraeumen()
          .catch(function (e) { return { ok: false, error: String(e) }; })
          .then(function (r) {
            if (!r.ok) { melden("⚠ " + r.error, "fehler"); pz.disabled = false; return; }
            melden(T("cloud.aufgeraeumt", "{n} Objekt(e) in den Papierkorb gelegt.")
                     .replace("{n}", r.entfernt));
            ferneLaden(); korbLaden();
          });
      };
      var b = document.getElementById("cloud-runter");
      if (b) b.onclick = function () {
        b.disabled = true;
        b.textContent = T("cloud.laedt", "Lädt …");
        window.pywebview.api.cloud_herunterladen()
          .catch(function (e) { return { ok: false, error: String(e) }; })
          .then(function (r) {
            b.disabled = false;
            b.textContent = T("cloud.herunterladen", "Bibliothek aus der Cloud laden");
            if (!r.ok) { melden("⚠ " + r.error, "fehler"); return; }
            melden(T("cloud.geholt_n", "{n} Objekt(e) geholt.").replace("{n}", r.geholt) +
                   ((r.fehler && r.fehler.length) ? "<br>" + r.fehler.join("<br>") : ""));
            ferneLaden();
          });
      };
    });
  }

  // ── v0.9.524: Papierkorb ───────────────────────────────────────────────
  function korbLaden() {
    var box = document.getElementById("cloud-korb");
    if (!box) return;
    window.pywebview.api.cloud_papierkorb().catch(function (e) { return { ok: false, error: String(e) }; }).then(function (k) {
      if (!box.isConnected) return;
      if (!k.ok) { box.innerHTML = k.error ? '<span class="muted">⚠ ' + k.error + '</span>' : ""; return; }
      var n = (k.eintraege || []).length;
      if (!n) {
        box.innerHTML = '<span class="muted">🗑 ' + T("cloud.korb_leer", "Papierkorb ist leer.") + '</span>';
        return;
      }
      // 02.09.2026: Nach dem Cloud-Umbau liegen im Papierkorb hunderte
      // Objekte des alten Modells. Ihre Klartextnamen kennt niemand mehr —
      // eine Liste aus lauter „(unbekannter Eintrag)" erklärt nichts.
      // Deshalb EINE Zeile, die sagt, woher sie kommen.
      var ohne_namen = (k.eintraege || []).filter(function (e) { return !e.klarname; }).length;
      var hinweis = (ohne_namen > 5)
        ? '<p class="muted" style="font-size:11px;margin:4px 0 8px">' +
            T("cloud.korb_alt_hinweis",
              "{n} Einträge stammen aus einer älteren Fassung des Cloud-Archivs — ihre Namen sind nicht mehr lesbar. Sie werden nicht mehr gebraucht und verschwinden nach 30 Tagen von selbst.")
              .replace("{n}", ohne_namen) + '</p>'
        : '';
      var zeilen = k.eintraege.map(function (e) {
        var wann = e.zeit ? new Date(e.zeit * 1000).toLocaleDateString() : "?";
        return '<div style="display:flex;align-items:center;gap:8px;padding:3px 0">' +
          '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
            (e.klarname || T("cloud.korb_unbekannt", "(unbekannter Eintrag)")) +
            ' <span class="muted">' + wann + (e.art === "version" ? " · " + T("cloud.korb_version", "älterer Stand") : "") + '</span></span>' +
          '<button class="btn btn--ghost korb-zurueck" data-n="' + e.name + '" data-z="' + e.zeit + '">' +
            T("cloud.korb_zurueck", "Wiederherstellen") + '</button>' +
          '<button class="btn btn--ghost korb-weg" data-n="' + e.name + '" data-z="' + e.zeit + '">✕</button>' +
          '</div>';
      }).join("");
      box.innerHTML = '<b>🗑 ' + T("cloud.korb_titel", "Papierkorb") + ' (' + n + ')</b>' +
        hinweis +
        '<div style="max-height:140px;overflow:auto;margin-top:6px">' + zeilen + '</div>' +
        '<button class="btn btn--ghost" id="korb-leeren" style="margin-top:6px">' +
          T("cloud.korb_leeren", "Älteres als 30 Tage endgültig löschen") + '</button>';
      box.querySelectorAll(".korb-zurueck").forEach(function (b) {
        b.onclick = function () {
          b.disabled = true; b.textContent = "⏳";
          window.pywebview.api.cloud_papierkorb_zurueck(b.dataset.n, parseInt(b.dataset.z, 10))
            .then(function (r) {
              if (r.ok) { korbLaden(); ferneLaden(); }
              else { b.disabled = false; b.textContent = T("cloud.korb_zurueck", "Wiederherstellen"); melden("⚠ " + r.error, "fehler"); }
            });
        };
      });
      box.querySelectorAll(".korb-weg").forEach(function (b) {
        b.onclick = function () {
          b.disabled = true;
          window.pywebview.api.cloud_papierkorb_eintrag_weg(b.dataset.n, parseInt(b.dataset.z, 10))
            .then(function () { korbLaden(); });
        };
      });
      var lb = document.getElementById("korb-leeren");
      if (lb) lb.onclick = function () {
        lb.disabled = true;
        window.pywebview.api.cloud_papierkorb_leeren(30).then(function (r) {
          lb.disabled = false;
          if (r.ok) { korbLaden(); melden(T("cloud.korb_geleert", "Gelöscht: ") + r.geloescht, ""); }
        });
      };
    });
  }

  function melden(html, art) {
    var el = document.getElementById("cloud-meldung");
    if (el) el.innerHTML = '<div class="' + (art === "fehler" ? "err" : "muted") +
                           '" style="padding:8px 10px;border-radius:8px">' + html + '</div>';
  }

  function handlerNeu() {
    // v0.9.527 — Server-Datei bereitlegen (aus dem App-Bundle).
    var phpBtn = document.getElementById("cloud-php");
    if (phpBtn) phpBtn.onclick = function () {
      var stand = document.getElementById("cloud-php-stand");
      window.pywebview.api.cloud_php_speichern().then(function (r) {
        if (!stand) return;
        stand.textContent = r && r.ok
          ? T("cloud.php_ok", "Liegt auf dem Schreibtisch ✓")
          : ((r && r.error) || T("cloud.php_fehler", "Hat nicht geklappt — siehe Log."));
      }).catch(function (e) {
        if (stand) stand.textContent = String(e);
      });
    };

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
                 "mehr an die Daten — auch wir nicht.") + '</div>' +
               // ⚠️ Der Zugangsschlüssel gehört DANEBEN, nicht versteckt: Beides
               // zusammen ist der Weg zurück ins Archiv. Läge er nur im
               // Schlüsselbund, käme man nach dessen Verlust selbst mit dem
               // Passwort nicht mehr an den Server.
               '<div style="margin-top:12px"><b>' + T("cloud.zugang", "Zugangsschlüssel") + '</b>' +
               '<div style="font:13px/1.5 ui-monospace,monospace;user-select:all;' +
               'word-break:break-all">' + (r.zugang || "") + '</div></div>');
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
    ferneLaden();
    korbLaden();
    var planEl = document.getElementById("cloud-plan");
    if (planEl) planEl.textContent = "";
    document.getElementById("cloud-jetzt").onclick = function () {
      melden(T("cloud.laeuft", "Überträgt gerade …"));
      standHolen();
      window.pywebview.api.cloud_abgleichen().catch(function (e) { return { ok: false, error: String(e) }; }).then(function (r) {
        if (!r.ok) { melden(r.error, "fehler"); return; }
        melden(T("cloud.fertig", "Fertig") + ": " + r.uebertragen + " · " + r.mb + " MB" +
               ((r.fehler && r.fehler.length) ? "<br>" + r.fehler.join("<br>") : ""));
        standHolen();
        ferneLaden();
      });
    };
    document.getElementById("cloud-daten").onclick = function () {
      window.pywebview.api.cloud_zugangsdaten().then(function (r) {
        if (!r.ok) { melden(r.error, "fehler"); return; }
        melden('<b>' + T("cloud.zugang", "Zugangsschlüssel") + '</b>' +
               '<div style="font:13px/1.5 ui-monospace,monospace;user-select:all;' +
               'word-break:break-all;margin:6px 0">' + r.zugang + '</div>' +
               '<div>' + T("cloud.daten_hinweis",
                 "Zusammen mit deinem Archiv-Passwort kommst du damit von jedem " +
                 "Rechner an dieses Archiv. Das Passwort selbst kann die App " +
                 "nicht mehr zeigen — es steht nur in deinem Passwortmanager.") +
               '</div>');
      });
    };
    // 22.08.2026 (Audit): Trennen löscht Zugang + Datenschlüssel lokal — wer den
    // Zugangsschlüssel nie notiert hat, kommt ohne ihn nicht mehr ans Archiv.
    // Deshalb: erst den Schlüssel zeigen, dann ein zweiter, bewusster Klick.
    var wegBtn = document.getElementById("cloud-weg");
    wegBtn.onclick = function () {
      if (wegBtn.dataset.scharf === "1") {
        window.pywebview.api.cloud_trennen().catch(function (e) { return { ok: false, error: String(e) }; }).then(function (r) {
          if (r && r.ok === false) { melden(r.error, "fehler"); return; }
          standHolen(); openModal({}).close();
        });
        return;
      }
      window.pywebview.api.cloud_zugangsdaten().catch(function () { return { ok: false }; }).then(function (r) {
        var key = (r && r.ok && r.zugang) ? ('<div style="font:13px/1.5 ui-monospace,monospace;user-select:all;' +
                  'word-break:break-all;margin:6px 0">' + r.zugang + '</div>') : "";
        melden('<b>' + T("cloud.trennen_frage", "Wirklich trennen?") + '</b><br>' +
               T("cloud.trennen_hinweis", "Dieser Rechner vergisst Zugang und Datenschlüssel. Notiere vorher deinen Zugangsschlüssel — ohne ihn und dein Passwort kommst du nicht wieder an das Archiv:") +
               key + '<div class="muted" style="font-size:12px">' +
               T("cloud.trennen_nochmal", "Zum Trennen den Knopf noch einmal klicken.") + '</div>', "fehler");
        wegBtn.dataset.scharf = "1";
        wegBtn.textContent = "⚠ " + T("cloud.trennen_jetzt", "Jetzt wirklich trennen");
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
