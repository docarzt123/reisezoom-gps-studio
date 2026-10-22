/* Meine Orte (22.10.2026, Marc: „‚zu Hause‘ festlegen können … und andere Orte, z. B. bei Oma … in zukünftigen
 * Logbüchern wird das dann anhand der Location erkannt“ und „einen ‚Meine Orte‘-Editor mit Kartenansicht und Listenansicht,
 * löschen, ändern, verschieben … als neuer Punkt im Archiv“).
 *
 * Eine Seite über der Archivliste (wie die Tour-Seite): links die Karte mit jedem Ort als Stecknadel samt Umkreis, rechts
 * die Liste. Anlegen über die Ortssuche (auch Koordinaten/Maps-Links) oder „＋ Ort“ und Klick in die Karte; Namen in der
 * Liste ändern, Umkreis wählen, Stecknadel ziehen = verschieben, Papierkorb = löschen. Gespeichert über die Brücke
 * (`meine_orte*`, in den Einstellungen); das Logbuch erkennt die Orte beim nächsten Öffnen.
 */
(function () {
  "use strict";
  const T = (k, f, p) => (typeof t === "function" ? t(k, f, p) : (f || k));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const I = (n, g) => (typeof rzIcon === "function" ? rzIcon(n, { size: g || 16 }) : "");
  const api = () => (window.pywebview && window.pywebview.api) || {};
  const UMKREISE = [50, 100, 150, 250, 500, 1000, 2000];
  let Z = null;

  function offen() { return !!(Z && Z.seite && Z.seite.isConnected); }

  function kreis(lon, lat, r) {
    const pkt = [], n = 48, dy = r / 111320, dx = r / (111320 * Math.max(0.05, Math.cos(lat * Math.PI / 180)));
    for (let i = 0; i <= n; i++) { const a = (i / n) * 2 * Math.PI; pkt.push([lon + dx * Math.cos(a), lat + dy * Math.sin(a)]); }
    return pkt;
  }

  async function oeffnen() {
    schliessen(true);
    const main = document.querySelector(".lib-main");
    if (!main) return false;
    const seite = document.createElement("div");
    seite.className = "ts-seite mo-seite";
    seite.innerHTML = `<div class="ts-kopf">
        <button type="button" class="btn btn-sm ts-zurueck" title="${esc(T("orte.zurueck_tip", "Zurück zum Archiv (Esc)"))}">← ${esc(T("orte.zurueck", "Archiv"))}</button>
        <b class="ts-titel">${I("map-pin-house", 18)} ${esc(T("orte.titel", "Meine Orte"))}</b>
        <span class="ts-unter muted">${esc(T("orte.unter", "Zu Hause, bei Oma … — das Logbuch erkennt sie in allen Touren."))}</span></div>
      <div class="mo-koerper">
        <div class="mo-karte" id="mo-karte"></div>
        <div class="mo-spalte">
          <div class="mo-suche"><input type="search" id="mo-suche" placeholder="${esc(T("orte.suche_ph", "Ort suchen, Adresse oder Koordinaten …"))}">
            <button type="button" class="btn btn-sm" id="mo-neu" title="${esc(T("orte.neu_tip", "Ort setzen: danach in die Karte klicken"))}">${I("plus", 14)} ${esc(T("orte.neu", "Ort"))}</button></div>
          <div class="mo-treffer" id="mo-treffer" hidden></div>
          <div class="mo-liste" id="mo-liste"><div class="muted"><span class="spinner"></span> ${esc(T("common.loading", "Lädt …"))}</div></div>
          <div class="mo-hinweis muted">${esc(T("orte.hinweis", "Stecknadel ziehen = verschieben. Die Orte bleiben privat und gehen in keinen Export."))}</div>
        </div>
      </div>`;
    main.appendChild(seite);
    main.classList.add("ts-aktiv");
    { const k = document.getElementById("lib-seg-orte"); if (k) k.classList.add("is-on"); }
    Z = { seite, orte: [], map: null, lib: null, marker: {}, sel: null, setzen: false, radius: { standard: 150 } };
    seite.querySelector(".ts-zurueck").onclick = () => schliessen();
    seite.querySelector("#mo-neu").onclick = () => setzenModus(!Z.setzen);
    const such = seite.querySelector("#mo-suche");
    let tmr = 0;
    such.addEventListener("input", () => { clearTimeout(tmr); tmr = setTimeout(() => suchen(such.value), 350); });
    such.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); clearTimeout(tmr); suchen(such.value, true); } });
    karte();
    await laden();
    return true;
  }

  async function laden() {
    const z = Z;
    const r = await api().meine_orte().catch(() => null);   // warte-ok: Liste zeigt „Lädt …“
    if (Z !== z) return;
    Z.orte = (r && r.ok && r.orte) || [];
    if (r && r.radius) Z.radius = r.radius;
    liste(); kartePins(true);
  }

  function liste() {
    const box = Z.seite.querySelector("#mo-liste");
    if (!Z.orte.length) {
      box.innerHTML = `<div class="mo-leer">${I("house", 22)}<div>${esc(T("orte.leer", "Noch keine eigenen Orte. Leg „Zu Hause“ an: oben suchen oder „＋ Ort“ und in die Karte klicken — oder im Logbuch beim Umbenennen eines Halts das Häkchen setzen."))}</div></div>`;
      return;
    }
    box.innerHTML = Z.orte.map((o) => `<div class="mo-ort${Z.sel === o.id ? " an" : ""}" data-mo="${esc(o.id)}">
        <span class="mo-pin">${I("map-pin", 16)}</span>
        <input class="mo-name" type="text" value="${esc(o.name)}" data-mo-name="${esc(o.id)}" aria-label="${esc(T("orte.name", "Name"))}">
        <select class="mo-radius" data-mo-radius="${esc(o.id)}" title="${esc(T("orte.umkreis_tip", "Umkreis, in dem ein Halt als dieser Ort zählt"))}">
          ${UMKREISE.concat(UMKREISE.includes(o.radius_m) ? [] : [o.radius_m]).sort((a, b) => a - b).map((m) => `<option value="${m}"${m === o.radius_m ? " selected" : ""}>${m < 1000 ? m + " m" : (m / 1000) + " km"}</option>`).join("")}
        </select>
        <button type="button" class="mo-knopf" data-mo-zeig="${esc(o.id)}" title="${esc(T("orte.zeigen", "Auf der Karte zeigen"))}">${I("locate", 15)}</button>
        <button type="button" class="mo-knopf mo-weg" data-mo-weg="${esc(o.id)}" title="${esc(T("orte.loeschen", "Löschen"))}">${I("trash-2", 15)}</button>
      </div>`).join("");
    box.querySelectorAll("[data-mo-name]").forEach((el) => {
      const speichern = () => { const o = Z.orte.find((x) => x.id === el.dataset.moName); const n = el.value.trim(); if (o && n && n !== o.name) aendern(o, { name: n }); else if (o) el.value = o.name; };
      el.addEventListener("change", speichern);
      el.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); el.blur(); } else if (e.key === "Escape") { e.stopPropagation(); const o = Z.orte.find((x) => x.id === el.dataset.moName); if (o) el.value = o.name; el.blur(); } });
      el.addEventListener("focus", () => waehlen(el.dataset.moName, false));
    });
    box.querySelectorAll("[data-mo-radius]").forEach((el) => { el.onchange = () => { const o = Z.orte.find((x) => x.id === el.dataset.moRadius); if (o) aendern(o, { radius_m: +el.value }); }; });
    box.querySelectorAll("[data-mo-zeig]").forEach((b) => { b.onclick = () => waehlen(b.dataset.moZeig, true); });
    box.querySelectorAll("[data-mo-weg]").forEach((b) => { b.onclick = () => loeschen(b.dataset.moWeg); });
    box.querySelectorAll("[data-mo]").forEach((row) => { row.addEventListener("click", (e) => { if (!e.target.closest("input, select, button")) waehlen(row.dataset.mo, true); }); });
  }

  async function speichern(ort) {
    const r = await api().meine_orte_speichern(ort).catch((e) => ({ ok: false, error: String(e) }));   // warte-ok: eine Zeile in den Einstellungen
    if (!r || !r.ok) { if (typeof toast === "function") toast((r && r.error) || "?", "error", 4000); return null; }
    Z.orte = r.orte || Z.orte;
    return r.ort;
  }
  async function aendern(o, patch) {
    const neu = await speichern(Object.assign({}, o, patch));
    if (!neu || !Z) return;
    liste(); kartePins(false);
  }
  async function anlegen(name, lon, lat) {
    const neu = await speichern({ name, lat, lon, radius_m: Z.radius.standard || 150 });
    if (!neu || !Z) return;
    Z.sel = neu.id;
    liste(); kartePins(false); waehlen(neu.id, true);
    const el = Z.seite.querySelector(`[data-mo-name="${neu.id}"]`); if (el) { el.focus(); el.select(); }
    if (typeof toast === "function") toast(T("orte.angelegt", "„{n}“ angelegt — das Logbuch erkennt den Ort ab jetzt.", { n: name }), "success", 3500);
  }
  async function loeschen(id) {
    const o = Z.orte.find((x) => x.id === id); if (!o) return;
    const ja = await new Promise((res) => {
      const m = openModal({ title: T("orte.loeschen", "Löschen"),
        body: `<p>${esc(T("orte.loeschen_frage", "„{n}“ löschen? Logbücher zeigen dort wieder den Straßennamen.", { n: o.name }))}</p>`,
        footer: `<button class="btn" id="mo-nein">${esc(T("common.cancel", "Abbrechen"))}</button><button class="btn btn-danger" id="mo-ja">${esc(T("orte.loeschen", "Löschen"))}</button>`,
        onClose: () => res(false) });
      document.getElementById("mo-ja").onclick = () => { res(true); try { m.close(); } catch (_) {} };
      document.getElementById("mo-nein").onclick = () => { res(false); try { m.close(); } catch (_) {} };
    });
    if (!ja) return;
    const r = await api().meine_orte_loeschen(id).catch(() => null);   // warte-ok: eine Zeile in den Einstellungen
    if (!r || !r.ok || !Z) return;
    Z.orte = r.orte || []; if (Z.sel === id) Z.sel = null;
    liste(); kartePins(false);
  }

  async function suchen(text, sofort) {
    const box = Z && Z.seite.querySelector("#mo-treffer"); if (!box) return;
    text = String(text || "").trim();
    if (text.length < 2) { box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = false; box.innerHTML = `<div class="muted"><span class="spinner"></span> ${esc(T("orte.sucht", "Sucht …"))}</div>`;
    const r = await api().route_geocode(text, 5).catch(() => null);   // warte-ok: „Sucht …“ im Kasten
    if (!Z || Z.seite.querySelector("#mo-suche").value.trim() !== text) return;
    const hits = (r && r.ok && r.results) || [];
    if (!hits.length) { box.innerHTML = `<div class="muted">${esc(T("orte.nichts", "Nichts gefunden — anders schreiben oder in die Karte klicken."))}</div>`; return; }
    box.innerHTML = hits.map((h, i) => `<button type="button" class="mo-treffer-z" data-mo-hit="${i}">${I("map-pin", 14)} ${esc(h.name)}</button>`).join("");
    box.querySelectorAll("[data-mo-hit]").forEach((b) => { b.onclick = () => { const h = hits[+b.dataset.moHit]; uebernehmen(h); }; });
    if (sofort && hits.length === 1) uebernehmen(hits[0]);
  }
  async function uebernehmen(h) {
    const box = Z.seite.querySelector("#mo-treffer"); box.hidden = true; box.innerHTML = "";
    Z.seite.querySelector("#mo-suche").value = "";
    const vorschlag = Z.orte.length ? String(h.name || "").split(",")[0] : T("orte.zuhause", "Zu Hause");
    await anlegen(vorschlag, +h.lon, +h.lat);
  }

  function setzenModus(an) {
    if (!Z) return;
    Z.setzen = !!an;
    Z.seite.classList.toggle("mo-setzen", Z.setzen);
    const b = Z.seite.querySelector("#mo-neu"); if (b) b.classList.toggle("is-on", Z.setzen);
    if (Z.map) Z.map.getCanvas().style.cursor = Z.setzen ? "crosshair" : "";
  }

  // ── Karte ────────────────────────────────────────────────────────────────────────────────
  function karte() {
    const host = Z.seite.querySelector("#mo-karte");
    let created;
    try {
      created = createMap({ container: host, styleKey: (typeof rzArchivStil === "function") ? rzArchivStil() : undefined,
        common: { center: [10.4, 51.2], zoom: 4.5, attributionControl: true } });
    } catch (e) { host.innerHTML = `<div class="muted" style="padding:20px">${esc(String(e))}</div>`; return; }
    Z.map = created.map; Z.lib = created.lib;
    window.__rzMeineOrteKarte = Z.map;   // Prüfstand
    const z = Z, map = Z.map;
    map.on("load", () => {
      if (Z !== z) return;
      map.addSource("mo-kreise", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "mo-kreise-f", type: "fill", source: "mo-kreise", paint: { "fill-color": "#48d6c4", "fill-opacity": ["case", ["get", "an"], 0.22, 0.12] } });
      map.addLayer({ id: "mo-kreise-l", type: "line", source: "mo-kreise", paint: { "line-color": "#48d6c4", "line-width": ["case", ["get", "an"], 2.4, 1.4] } });
      kartePins(true);
    });
    map.on("click", async (e) => {
      if (!Z || Z !== z || !Z.setzen) return;
      setzenModus(false);
      const name = Z.orte.length ? T("orte.neuer_ort", "Neuer Ort") : T("orte.zuhause", "Zu Hause");
      await anlegen(name, e.lngLat.lng, e.lngLat.lat);
    });
  }
  function kartePins(einpassen) {
    if (!Z || !Z.map || !Z.lib) return;
    const map = Z.map, lib = Z.lib;
    Object.values(Z.marker).forEach((m) => { try { m.remove(); } catch (_) {} });
    Z.marker = {};
    for (const o of Z.orte) {
      const el = document.createElement("div");
      el.className = "mo-marker" + (Z.sel === o.id ? " an" : "");
      el.innerHTML = `${I("map-pin", 26)}<span>${esc(o.name)}</span>`;
      const m = new lib.Marker({ element: el, draggable: true, anchor: "bottom" }).setLngLat([o.lon, o.lat]).addTo(map);
      m.on("dragend", () => { const ll = m.getLngLat(); aendern(o, { lon: ll.lng, lat: ll.lat }); });
      el.addEventListener("click", (e) => { e.stopPropagation(); waehlen(o.id, false); });
      Z.marker[o.id] = m;
    }
    const src = map.getSource && map.getSource("mo-kreise");
    if (src) src.setData({ type: "FeatureCollection", features: Z.orte.map((o) => ({ type: "Feature", properties: { an: Z.sel === o.id },
      geometry: { type: "Polygon", coordinates: [kreis(o.lon, o.lat, o.radius_m)] } })) });
    if (einpassen && Z.orte.length) {
      const b = new lib.LngLatBounds(); Z.orte.forEach((o) => b.extend([o.lon, o.lat]));
      try { map.fitBounds(b, { padding: 80, maxZoom: 14, duration: 0 }); } catch (_) {}
    }
  }
  function waehlen(id, fliegen) {
    if (!Z) return;
    Z.sel = id;
    Z.seite.querySelectorAll("[data-mo]").forEach((r) => r.classList.toggle("an", r.dataset.mo === id));
    Object.entries(Z.marker).forEach(([k, m]) => { const el = m.getElement(); if (el) el.classList.toggle("an", k === id); });
    const src = Z.map && Z.map.getSource && Z.map.getSource("mo-kreise");
    if (src) kartePins(false);
    const o = Z.orte.find((x) => x.id === id);
    if (o && fliegen && Z.map) { try { Z.map.flyTo({ center: [o.lon, o.lat], zoom: Math.max(Z.map.getZoom(), 15), duration: 600 }); } catch (_) {} }
  }

  function schliessen(still) {
    if (!Z) return;
    const z = Z; Z = null;
    if (z.map) { try { z.map.remove(); } catch (_) {} }
    try { z.seite.remove(); } catch (_) {}
    if (!document.querySelector(".ts-seite")) document.querySelectorAll(".lib-main.ts-aktiv").forEach((x) => x.classList.remove("ts-aktiv"));
    window.__rzMeineOrteKarte = null;
    { const k = document.getElementById("lib-seg-orte"); if (k) k.classList.remove("is-on"); }
    if (!still && typeof window.__rzLibDetailNeu === "function") try { window.__rzLibDetailNeu(); } catch (_) {}
  }
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !offen() || e.isComposing) return;
    const z = e.target;
    if (z && (z.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(z.tagName))) return;
    if (document.querySelector("#modal-overlay:not([hidden])")) return;
    e.preventDefault();
    if (Z && Z.setzen) { setzenModus(false); return; }
    schliessen();
  });
  setInterval(() => { if (Z && !Z.seite.isConnected) schliessen(true); }, 1500);

  window.rzMeineOrte = { oeffnen, schliessen: () => schliessen(), offen, zustand: () => (Z ? { orte: Z.orte.slice(), sel: Z.sel, setzen: Z.setzen } : null) };
})();
