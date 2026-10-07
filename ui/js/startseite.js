/* Startseite nach Aufgaben (05.10.2026, Block 3, IDEEN I-121).
 *
 * Marc (Roadmap 05.10.2026): „Startseite nur für neue Nutzer / beim ersten Start, sonst der letzte Ort." Darum
 * erscheint sie genau einmal: direkt nach dem Einrichtungsdialog (app.js, „Los geht's"). Wer die App schon kennt,
 * landet wie bisher im zuletzt geöffneten Modul. Drei Aufgaben statt Modulsymbolen (Mockup „vereinfachte
 * Oberfläche", Ansicht Start): Video erstellen · Track verbessern · Fotos verorten.
 * Neue Nutzer starten den Animator in der einfachen Ansicht (FRAGEN F-10, vorläufig).
 */
(function () {
  "use strict";
  const T = (k, f) => (typeof t === "function" ? t(k, f) : f);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const AUFGABEN = [
    { id: "video", symbol: "🎬", modul: "library", titel: ["startseite.video", "Video erstellen"],
      text: ["startseite.video_text", "Tour wählen, Look und Fotos dazu — in fünf Schritten zum fertigen Video."] },
    { id: "track", symbol: "🧭", modul: "gpxinspect", titel: ["startseite.track", "Track verbessern"],
      text: ["startseite.track_text", "Ausreißer, Lücken und Pausen finden und den Track sauber machen."] },
    { id: "fotos", symbol: "📍", modul: "geotagger", titel: ["startseite.fotos", "Fotos verorten"],
      text: ["startseite.fotos_text", "Deinen Fotos den Ort aus dem Track geben — für Karte, Archiv und Video."] },
    // 07.10.2026 (Etappen, Grilling Punkt 10)
    { id: "ohne_gps", symbol: "🗺", modul: null, titel: ["etappe.ohne_gps", "Kartenanimation ohne GPS"],
      text: ["startseite.ohne_gps_text", "Eine Route ohne Aufzeichnung — Anreise, Flug, Fähre: Stationen eintippen, Verkehrsmittel wählen."] },
  ];

  function rzStartseite() {
    if (typeof openModal !== "function") return;
    const m = openModal({
      title: T("startseite.titel", "Was möchtest du machen?"),
      body: `<div class="rz-start">${AUFGABEN.map(a => `<button type="button" class="rz-start-karte" data-start="${a.id}">
          <span class="rz-start-symbol">${a.symbol}</span><b>${esc(T(a.titel[0], a.titel[1]))}</b><span>${esc(T(a.text[0], a.text[1]))}</span></button>`).join("")}</div>
        <p class="muted" style="margin:12px 0 0;font-size:12px">${esc(T("startseite.hinweis", "Alle Werkzeuge findest du jederzeit oben in der Leiste."))}</p>`,
      footer: `<button type="button" class="btn" id="rz-start-spaeter">${esc(T("startseite.archiv", "Erst mal ins Archiv"))}</button>`,
    });
    const box = document.getElementById("modal-body");
    const gehe = (modul) => { try { m.close(); } catch (_) {} if (typeof switchMod === "function") switchMod(modul); };
    box && box.addEventListener("click", (e) => {
      const b = e.target.closest("[data-start]"); if (!b) return;
      const a = AUFGABEN.find(x => x.id === b.dataset.start); if (!a) return;
      try { applog("info", "[startseite] " + a.id); } catch (_) {}
      if (a.id === "ohne_gps") { try { m.close(); } catch (_) {} if (typeof window.rzKartenanimationOhneGps === "function") window.rzKartenanimationOhneGps(""); return; }
      gehe(a.modul);
      if (a.id === "video" && typeof toast === "function")
        toast(T("startseite.video_toast", "Wähle links eine Tour — dann „🎬 Schnell-Video …“ oder „Im Animator öffnen“."), "info", 7000);
    });
    const sp = document.getElementById("rz-start-spaeter");
    if (sp) sp.onclick = () => gehe("library");
  }

  /** Nach dem ersten Einrichten (app.js ruft das auf): die Startseite zeigen. (Die einfache Ansicht wird seit
   *  06.10.2026 nicht mehr vorgewählt — sie wandert in den Video-Assistenten.) */
  function rzStartseiteNachEinrichtung() {
    setTimeout(rzStartseite, 1200);   // nach dem Aufbau des ersten Moduls
  }

  window.rzStartseite = rzStartseite;
  window.rzStartseiteNachEinrichtung = rzStartseiteNachEinrichtung;
})();
