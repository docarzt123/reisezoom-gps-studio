/* Reisezoom GPS Studio — Schnell-Einstieg pro Modul (v0.9.460).
 *
 * Jedes Modul hat einen eigenen 3-Schritte-Guide mit echtem Screenshot. Der
 * Einstieg ist KONTEXTUELL: „🚀 Erste Schritte" im Hilfe-Menü zeigt den Guide
 * für das Modul, in dem man gerade steht (nicht eine lange Gesamtseite).
 *
 * Die Guide-Texte stehen bewusst als deutsche Klartext-Daten hier (nicht über
 * t()): es ist zusammenhängende Prosa, die App-Zielgruppe ist deutschsprachig,
 * und so bläht es die i18n-Bundles nicht mit ~100 Sätzen auf. Das Modal-
 * Drumherum (Titel, Buttons) ist normal lokalisiert.
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
        "<b>Track laden:</b> Oben auf „Track wählen …“ klicken oder eine GPX/FIT/TCX-Datei direkt ins Fenster ziehen.",
        "<b>Optik einstellen:</b> In der Seitenleiste Kartenstil, Track-Farbe und Kamera (Neigung, Rotation) wählen. „Probe-Lauf“ unten zeigt den Flug sofort.",
        "<b>Rendern:</b> Ganz unten in den Video-Einstellungen Auflösung/FPS wählen und das Video rendern.",
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
        "<b>Track laden:</b> Ein GPX/FIT mit den gewünschten Daten laden (z. B. Höhe oder Herzfrequenz).",
        "<b>Datenreihe(n) wählen:</b> Oben die linke Achse festlegen (z. B. Höhe) und optional eine zweite Reihe für die rechte Achse (z. B. Puls).",
        "<b>Optik + Rendern:</b> Farben, Linien, Achsen einstellen und als Video rendern — mit Alpha für die Composite-Spur.",
      ],
      tip: "Für ein Overlay im Schnittprogramm die Hintergrund-Deckkraft auf 0 setzen und als ProRes mit Alpha rendern.",
    },
    tourmap: {
      emoji: "🗺️",
      title: "Tour-Map — statische Karten-PNG",
      img: "img/quickstart/tourmap.jpg",
      intro: "Erzeugt ein hochauflösendes Standbild deiner Tour — perfekt fürs Thumbnail, den Blog oder als Übersicht.",
      steps: [
        "<b>Track laden:</b> GPX oben wählen oder reinziehen.",
        "<b>Bild gestalten:</b> Kartenstil, Track-Optik, Start/End-Pins und die Stats-Box (Strecke, Höhenmeter …) einstellen — alles WYSIWYG in der Vorschau.",
        "<b>„Karte als PNG rendern“:</b> Das fertige Bild in der gewünschten Auflösung speichern.",
      ],
      tip: "Was du in der Vorschau siehst, kommt genau so ins Bild — Ausschnitt einfach per Maus zurechtziehen.",
    },
    webkarte: {
      emoji: "🌐",
      title: "Web Karte — interaktive Karte fürs Web",
      img: "img/quickstart/webkarte.jpg",
      intro: "Exportiert eine leichte, interaktive Karte (Leaflet) zum Einbetten im Blog — Besucher können zoomen und die Beschriftungen antippen.",
      steps: [
        "<b>Track laden:</b> GPX oben wählen. Weitere Etappen per „Track hinzufügen“ dazu.",
        "<b>Gestalten:</b> Track-Farbe/-Breite, Kartenstil (z. B. OpenStreetMap) und Beschriftungen direkt auf der Karte setzen.",
        "<b>Exportieren:</b> Als HTML exportieren und im Blog einbetten — optional mit DSGVO-Zustimmungs-Button.",
      ],
      tip: "Die Vorschau hier ist exakt der Export — kein Überraschungs-Ergebnis beim Einbetten.",
    },
    geotagger: {
      emoji: "📷",
      title: "Geotagger — Fotos mit GPS taggen",
      img: "img/quickstart/geotagger.jpg",
      intro: "Schreibt GPS-Koordinaten (und optional Adressen) in deine Fotos — anhand des GPX-Tracks deiner Tour und der Aufnahmezeit.",
      steps: [
        "<b>Track + Fotos laden:</b> Die GPX der Tour laden, dann „Fotos auswählen …“ oder einen ganzen Ordner reinziehen.",
        "<b>Zeit abgleichen:</b> Weicht die Kamera-Uhr ab, mit dem Zeitversatz-Regler korrigieren — die Pins wandern live an die richtige Stelle.",
        "<b>Schreiben:</b> Optional „Adressen abrufen“, dann die GPS-Daten in die Fotos schreiben. Das Original bleibt unberührt.",
      ],
      tip: "Einzelne Fotos ohne Track-Zeit kannst du per „Auf Track einrasten“ oder Ziehen von Hand platzieren.",
    },
    gpxinspect: {
      emoji: "🩹",
      title: "GPX-Inspektor — Track heilen",
      img: "img/quickstart/gpxinspect.jpg",
      intro: "Repariert verrauschte Tracks Punkt für Punkt: Ausreißer glätten, Lücken füllen, Abschnitte abschneiden, mehrere Aufzeichnungen zu einem Track verbinden.",
      steps: [
        "<b>Track laden:</b> GPX oben wählen — jeder einzelne Punkt wird sichtbar.",
        "<b>Heilen:</b> „Heilen (automatisch)“ glättet Ausreißer und füllt Lücken. Feiner geht’s manuell über Anker A→B.",
        "<b>Speichern:</b> Den geheilten Track als GPX oder TCX speichern — das Original bleibt erhalten.",
      ],
      tip: "Mit „Tracks verbinden“ hängst du eine zweite Aufzeichnung an — praktisch, wenn die Uhr mittendrin gestoppt hat.",
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
  window.openQuickstart = function (modKey) {
    const active = modKey
      || (typeof window.getActiveMod === "function" && window.getActiveMod())
      || "animator";
    const g = guideFor(active);
    const T = (typeof window.t === "function") ? window.t : (k, f) => f || k;

    const stepsHtml = g.steps.map((s, i) =>
      `<li class="qs-step"><span class="qs-step-n">${i + 1}</span><span class="qs-step-t">${s}</span></li>`
    ).join("");

    const tipHtml = g.tip
      ? `<p class="qs-tip">💡 ${esc(g.tip)}</p>` : "";

    const body = `
      <div class="qs-wrap">
        <p class="qs-intro">${esc(g.intro)}</p>
        <img class="qs-shot" src="${g.img}" alt="${esc(g.title)}"
             onerror="this.style.display='none'">
        <ol class="qs-steps">${stepsHtml}</ol>
        ${tipHtml}
      </div>`;

    window.openModal({
      title: `${g.emoji} ${T("quickstart.title", "Erste Schritte")} — ${esc(g.title.split(" — ")[0])}`,
      body,
      footer: `
        <button class="btn" id="qs-guide">${T("quickstart.full_guide", "Ganzes Handbuch")}</button>
        <button class="btn btn-primary" id="qs-ok">${T("common.ok", "Verstanden")}</button>`,
    });
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
