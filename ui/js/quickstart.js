/* Reisezoom GPS Studio — Schnell-Einstieg pro Modul (v0.9.460).
 *
 * Jedes Modul hat einen eigenen 3-Schritte-Guide mit echtem Screenshot. Der
 * Einstieg ist KONTEXTUELL: „🚀 Erste Schritte" im Hilfe-Menü zeigt den Guide
 * für das Modul, in dem man gerade steht (nicht eine lange Gesamtseite).
 *
 * v0.9.507 — Die deutschen Texte hier sind nur noch die FALLBACKS: übersetzt
 * sprache-ok: Die deutschen Texte hier sind RÜCKFALLWERTE. Gezeigt wird
 * immer `tr(feld, fallback)` = `T("quickstart.<modul>.<feld>", …)`, siehe
 * unten — die Sprachdateien enthalten alle Schlüssel (Wache:
 * tests/test_keine_hartkodierte_sprache.py, Abschnitt 7).
 * wird beim Öffnen über `quickstart.<modul>.<feld>`-Schlüssel (title, intro,
 * step1..3, tip). Die ursprüngliche Entscheidung „Zielgruppe ist deutschsprachig"
 * (v0.9.460) ist überholt — das Programm wird international genutzt, und ein
 * spanischer Nutzer bekam einen deutschen Einstieg. Grundsatz seitdem: nirgends
 * hartkodiert eine Sprache, die angezeigt wird.
 */
(() => {
  // Modul-Key (= RZGPS_MODULES-Slug) → Guide. `img` liegt unter ui/img/quickstart/.
  const QS = {
    animator: {
      emoji: "🎬",
      title: "Animator — Track als Video",
      img: "img/quickstart/animator.jpg",
      intro: "Macht aus deinem GPX ein cineastisches Video: die Kamera fliegt über die 3D-Karte und zeichnet die Strecke nach.",
      steps: [
        "<b>Track laden:</b> Aus dem Archiv mit „Öffnen in → Animator“ — oder oben links über das Ordner-Symbol eine GPX-, FIT- oder TCX-Datei wählen bzw. sie ins Fenster ziehen.",
        "<b>Optik einstellen:</b> Links Karte, Tracks, Kamera & Co. aufklappen — die Vorschau zeigt jede Änderung sofort, ▶ unten spielt den Flug ab. Eilig? „Schnell-Video …“ stellt alles in einem Schritt ein.",
        "<b>Exportieren:</b> Oben rechts „Video exportieren“ — Format, Auflösung und Bildrate wählen; das Video entsteht im Hintergrund.",
      ],
      tip: "Der Animator startet in der Welt-Ansicht (Globus) als Kino-Intro. „Auf Start“ oder der Probe-Lauf springt zu deinem Track.",
    },
    reiseroute: {
      emoji: "🧭",
      title: "Reiseroute — Anreise als Route animieren",
      img: "img/quickstart/reiseroute.jpg",
      intro: "Animiert die Anreise zu deiner Tour: aus Start- und Zielpunkt wird eine Route berechnet und wie ein Track abgeflogen.",
      steps: [
        "<b>Stationen setzen:</b> Start und Ziel als Adresse eintippen — oder „Klick-Modus“ aktivieren und direkt auf die Karte tippen. Zwischenziele beliebig hinzufügen.",
        "<b>Fortbewegung wählen:</b> Auto, zu Fuß oder Fahrrad — bestimmt, welche Wege die Route nimmt.",
        "<b>„Route berechnen“:</b> Die Strecke wird gebaut und lässt sich wie im Animator abfliegen und rendern.",
      ],
      tip: "„Flugroute“ statt „Straße folgen“ zieht eine direkte Linie — gut für Flüge oder große Distanzen.",
    },
    heightanim: {
      emoji: "📊",
      title: "Daten-Animator — Messwerte als Video",
      img: "img/quickstart/datenanimator.jpg",
      intro: "Animiert eine Messkurve deines Tracks — Höhe, Puls, Tempo, Trittfrequenz — die sich live aufbaut. Mit transparentem Hintergrund als Overlay fürs Video.",
      steps: [
        "<b>Track laden:</b> Eine GPX/FIT mit den gewünschten Daten (z. B. Höhe oder Herzfrequenz) — aus dem Archiv oder oben links über das Ordner-Symbol.",
        "<b>Datenreihe(n) wählen:</b> Links oben die Reihe für die linke Achse (z. B. Höhe) und optional eine zweite für die rechte Achse (z. B. Tempo).",
        "<b>Optik + Rendern:</b> Farben, Linien, Marker und Info-Leiste einstellen, dann unter „Rendern“ das Format wählen und „Video rendern“ — mit Alpha für die Composite-Spur oder als HTML für den Blog.",
      ],
      tip: "Für ein Overlay im Schnittprogramm die Hintergrund-Deckkraft auf 0 setzen und als ProRes mit Alpha rendern.",
    },
    tourmap: {
      emoji: "🗺️",
      title: "Tour-Map — statische Karten-PNG",
      img: "img/quickstart/tourmap.jpg",
      intro: "Erzeugt ein hochauflösendes Standbild deiner Tour — perfekt fürs Thumbnail, den Blog oder als Übersicht.",
      steps: [
        "<b>Track laden:</b> Aus dem Archiv mit „Öffnen in → Tour-Map“ — oder oben links über das Ordner-Symbol wählen bzw. ins Fenster ziehen.",
        "<b>Bild gestalten:</b> Links Format, Karte, Tracks, Kamera und Overlays (Strecke, Höhenmeter …) einstellen — die Vorschau zeigt das Bild genau so, wie es gespeichert wird.",
        "<b>Exportieren:</b> Oben rechts „Bild exportieren“ speichert das PNG in der gewählten Auflösung.",
      ],
      tip: "Was du in der Vorschau siehst, kommt genau so ins Bild — Ausschnitt einfach per Maus zurechtziehen.",
    },
    webkarte: {
      emoji: "🌐",
      title: "Web Karte — interaktive Karte fürs Web",
      img: "img/quickstart/webkarte.jpg",
      intro: "Exportiert eine leichte, interaktive Karte (Leaflet) zum Einbetten im Blog — Besucher können zoomen und die Beschriftungen antippen.",
      steps: [
        "<b>Track laden:</b> Aus dem Archiv oder oben links über das Ordner-Symbol; weitere Etappen per „+ Track hinzufügen“.",
        "<b>Gestalten:</b> Track-Farbe und -Breite, Kartenstil, Maßstab und Nordpfeil einstellen; „+ Beschriftung hinzufügen“ setzt Texte direkt auf die Karte.",
        "<b>Exportieren:</b> Oben rechts „Als HTML exportieren“ und im Blog einbetten — optional mit DSGVO-Zustimmungs-Button.",
      ],
      tip: "Die Vorschau hier ist exakt der Export — kein Überraschungs-Ergebnis beim Einbetten.",
    },
    geotagger: {
      emoji: "📷",
      title: "Geotagger — Fotos mit GPS taggen",
      img: "img/quickstart/geotagger.jpg",
      intro: "Schreibt GPS-Koordinaten (und optional Adressen) in deine Fotos — anhand des GPX-Tracks deiner Tour und der Aufnahmezeit.",
      steps: [
        "<b>Fotos laden:</b> „Fotos auswählen …“ oder „Ganzen Ordner laden“ — die passenden Touren aus dem Archiv schlägt GPS Studio selbst vor.",
        "<b>Zeit abgleichen:</b> Weicht die Kamera-Uhr ab, mit dem Zeitversatz-Regler korrigieren — die Pins wandern live an die richtige Stelle.",
        "<b>Schreiben:</b> Unten unter „Schreiben“ optional „Adressen abrufen“, dann die GPS-Daten in die Fotos schreiben. Das Original bleibt unberührt.",
      ],
      tip: "Einzelne Fotos ohne Track-Zeit kannst du per „Auf Track einrasten“ oder Ziehen von Hand platzieren.",
    },
    gpxinspect: {
      emoji: "🩹",
      title: "GPX-Inspektor — Track heilen",
      img: "img/quickstart/gpxinspect.jpg",
      intro: "Repariert verrauschte Tracks Punkt für Punkt: Ausreißer glätten, Lücken füllen, Abschnitte abschneiden, mehrere Aufzeichnungen zu einem Track verbinden.",
      steps: [
        "<b>Track laden:</b> Aus dem Archiv mit „Im Inspektor“ — oder oben links über das Ordner-Symbol. Jeder einzelne Punkt wird sichtbar, unten steht das Logbuch.",
        "<b>Heilen:</b> „Heilen (automatisch)“ glättet Ausreißer und füllt Lücken. Feiner geht's über „Abschnitt A→B“.",
        "<b>Speichern:</b> „Geheilten Track speichern …“ als GPX oder TCX — das Original bleibt erhalten.",
      ],
      tip: "Mit „Tracks verbinden“ hängst du eine zweite Aufzeichnung an — praktisch, wenn die Uhr mittendrin gestoppt hat.",
    },
    library: {
      emoji: "📚",
      title: "Archiv — alle Touren an einem Ort",
      img: "img/quickstart/library.jpg",
      intro: "Liest deine Track-Ordner ein und zeigt jede Tour mit Bild, Datum und Zahlen. Statt Dateinamen zu raten, suchst und filterst du — und schickst die Tour mit einem Klick weiter.",
      steps: [
        "<b>Ordner hinzufügen:</b> Links unten „Ordner & Einlesen“ → „+ Ordner hinzufügen“ und den Ordner mit deinen Tracks wählen. Unterordner kommen mit; 700 Dateien dauern rund 20 Sekunden. Einzelne Dateien: „Tour hinzufügen“ oder einfach ins Fenster ziehen.",
        "<b>Wiederfinden:</b> Suchfeld, Art, Jahr, Zeitraum und Länge in der Leiste über den Touren. Oben rechts wechselst du die Ansicht: Zeilen, Kacheln, Tabelle, Karte mit allen Touren oder Statistik.",
        "<b>Weiterarbeiten:</b> Tour anklicken und rechts an Animator, Tour-Karte, Geotagger & Co. übergeben. Ein Doppelklick schickt sie direkt in den Animator.",
      ],
      tip: "Unter „Ordner & Einlesen“ holst du dir mit „Kartenbilder holen“ echte Karten hinter jede Tour — einmal geladen, danach offline. Deine Dateien werden nie verschoben oder gelöscht.",
    },
    // 24.10.2026 — für die Willkommen-Seite (ui/js/willkommen.js, „Mehr erfahren“)
    tourseite: {
      emoji: "📖",
      title: "Tour & Logbuch — die Tour auf einer Seite",
      img: "img/quickstart/tourseite.jpg",
      intro: "Ein Doppelklick im Archiv öffnet die Tour: Karte, Fotos und Clips, Zeitstrahl und das Logbuch — was wann wo war, Tag für Tag.",
      steps: [
        "<b>Öffnen:</b> Im Archiv eine Tour doppelklicken. Links stehen Zahlen, Höhenprofil und die Knöpfe (Video, Karte als Bild, Im Inspektor, Öffnen in …).",
        "<b>Logbuch lesen:</b> Rechts erkennt das Logbuch Fahrten, Wanderungen, Pausen und Übernachtungen samt Orten. Bei mehreren Tagen scrollst du einfach weiter; der Zeitstrahl unter der Karte zeigt alles auf einen Blick.",
        "<b>Korrigieren:</b> Über „⋯“ an einem Eintrag umbenennen, die Art ändern, teilen oder zusammenlegen. Was du änderst, gilt überall — auch im Video.",
      ],
      tip: "Ein Klick auf einen Block im Zeitstrahl zeigt die Stelle auf der Karte; das Mausrad zoomt, ein Doppelklick auf einen Tag zeigt nur diesen Tag.",
    },
    // 24.10.2026 — für die Willkommen-Seite (ui/js/willkommen.js, „Mehr erfahren“)
    medien: {
      emoji: "🖼",
      title: "Medien — Fotos und Clips aller Touren",
      img: "img/quickstart/medien.jpg",
      intro: "Alle Fotos und Clips deiner Fotoordner — auch auf externen Laufwerken —, nach Tag, Ort und Tour sortiert. Jedes Foto lässt sich bearbeiten; das Original bleibt.",
      steps: [
        "<b>Ordner hinzufügen:</b> Im Archiv oben „Medien“ wählen und links einen Fotoordner hinzufügen. Vorschaubilder und Aufnahmedaten werden einmal gelesen.",
        "<b>Finden:</b> Nach Jahr, Tag, Ordner, Kamera oder Ort filtern — oder mit der Inhaltssuche nach „Wasserfall“ oder „Sonnenuntergang“ suchen.",
        "<b>Weiter:</b> Fotos gehören automatisch zu ihrer Tour; in der Lupe bearbeiten, exportieren oder im Geotagger verorten.",
      ],
      tip: "Fehlt einem Foto der Ort, gibt ihn der Geotagger aus dem Track der Tour.",
    },
  };

  // Manche Module teilen sich Registrierung/Slug — sicherstellen, dass jeder
  // Slug einen Guide findet (Fallback = Animator).
  function guideFor(modKey) {
    return QS[modKey] || QS.animator;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /**
   * Öffnet den Schnell-Einstieg. `modKey` optional — ohne Argument der Guide
   * für das gerade aktive Modul (kontextuell aus dem Hilfe-Menü).
   */
  const SCHRITT_BILDER = ["library", "tourseite", "medien", "animator", "tourmap", "heightanim", "gpxinspect", "webkarte", "geotagger"];

  window.openQuickstart = function (modKey) {
    const active = modKey
      || (typeof window.getActiveMod === "function" && window.getActiveMod())
      || "animator";
    const g = guideFor(active);
    const T = (typeof window.t === "function") ? window.t : (k, f) => f || k;
    // Übersetzung pro Feld — der Schlüssel hängt am Guide, der wirklich gezeigt
    // wird (Fallback-Slug „animator"), nicht am angefragten Modul.
    const slug = QS[active] ? active : "animator";
    const tr = (feld, fb) => T("quickstart." + slug + "." + feld, fb);
    const titel = tr("title", g.title);

    // 24.10.2026 (Marc: „überall Screenshots, direkt. sonst sind das üble Textwüsten“) — je Schritt ein Ausschnitt
    // der Oberfläche mit markiertem Knopf (scripts/willkommen_bilder.py → img/quickstart/<modul>-<n>.jpg)
    const mitBildern = SCHRITT_BILDER.includes(slug);
    const stepsHtml = g.steps.map((s, i) => mitBildern
      ? `<li class="qs-step qs-step-bild"><img class="qs-step-img" src="${(window.__rzAssetBase || "")}img/quickstart/${slug}-${i + 1}.jpg" alt="" loading="lazy"
             onerror="this.remove()"><div class="qs-step-txt"><span class="qs-step-n">${i + 1}</span><span class="qs-step-t">${tr("step" + (i + 1), s)}</span></div></li>`
      : `<li class="qs-step"><span class="qs-step-n">${i + 1}</span><span class="qs-step-t">${tr("step" + (i + 1), s)}</span></li>`
    ).join("");

    const tipHtml = g.tip
      ? `<p class="qs-tip">💡 ${esc(tr("tip", g.tip))}</p>` : "";

    // 19.10.2026 — „Frag GPS Studio“: Fragefeld ganz oben; Enter oder Tippen öffnet die Suche mit dem Text
    const frag = window.rzFrag ? window.rzFrag.feldHtml("qs-frag") : "";
    const body = `
      <div class="qs-wrap">
        ${frag}
        <p class="qs-intro">${esc(tr("intro", g.intro))}</p>
        ${mitBildern ? "" : `<img class="qs-shot" src="${(window.__rzAssetBase || "")}${g.img}" alt="${esc(titel)}"
             onerror="this.style.display='none'">`}
        <ol class="qs-steps${mitBildern ? " qs-steps-bild" : ""}">${stepsHtml}</ol>
        ${tipHtml}
      </div>`;

    window.openModal({
      // textContent (openModal) — nicht escapen, sonst stand „Tour &amp; Logbuch“ im Titel
      title: `${g.emoji} ${T("quickstart.title", "Erste Schritte")} — ${titel.split(" — ")[0]}`,
      body,
      footer: `
        <button class="btn" id="qs-guide">${T("quickstart.full_guide", "Ganzes Handbuch")}</button>
        <button class="btn btn-primary" id="qs-ok">${T("common.ok", "Verstanden")}</button>`,
      klasse: mitBildern ? "qs-breit" : "",   // mit Schritt-Bildern breiter, damit die Ausschnitte lesbar sind
    });
    if (window.rzFrag) window.rzFrag.feldVerbinden("qs-frag", () => { try { window.openModal({}).close(); } catch (e) { console.warn("[quickstart]", e); } });
    const ok = document.getElementById("qs-ok");
    if (ok) ok.onclick = () => { try { window.openModal({}).close(); } catch (_) {} };
    const gd = document.getElementById("qs-guide");
    // `api` ist ein Top-Level-`const` aus util.js (NICHT window.api) — direkt
    // per Namen ansprechen, sonst ist window.api() undefined und der Klick
    // verpuffte still im catch. (Fix: „Ganzes Handbuch"-Button ging nicht.)
    if (gd) gd.onclick = () => {
      try { api().open_user_guide(); }
      catch (e) { if (window.rzSwallow) rzSwallow(e, "quickstart:open_user_guide"); }
    };
  };

  window.RZ_QUICKSTART = QS;   // für Tests / evtl. Gesamtübersicht
})();
