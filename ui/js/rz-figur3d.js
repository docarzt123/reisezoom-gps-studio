/* rz-figur3d.js — der Laufpunkt als echter 3D-Körper (MapLibre + three.js, 02.11.2026)
 *
 * Warum: Nutzer wünschen sich als Laufpunkt richtige 3D-Objekte. Erster Schritt sind Kugel und Pfeil auf der Röhre
 * (rz-line3d), Licht und Schatten wie bei der Röhre; dieselbe Ebene trägt später Fahrzeuge (glTF). three.js zeichnet
 * in MapLibres eigenen WebGL-Kontext und Tiefenpuffer — hinter dem Berg verdeckt das Gelände den Körper von selbst.
 *
 *   await rzFigur3d.laden();                         // three.js erst bei Bedarf (ui/vendor/three.js, ~2 MB)
 *   const f = rzFigur3d.create("laufpunkt-3d"); map.addLayer(f);
 *   f.setFigur({ lng, lat, agl, form: "kugel" | "puk" | "pfeil" | "feuer" (Kugel + Schweif), farbe, glanz, groesseM, minPx, drehung, neigung });
 *   f.setFigur(null);                                // ausblenden
 *
 *   groesseM  Durchmesser (Kugel, Puk) bzw. Länge (Pfeil) in Metern; minPx = Mindestgröße in CSS-Pixeln (aus der Ferne)
 *   drehung   Fahrtrichtung in Grad im Uhrzeigersinn ab Nord;  neigung = Steigung in Grad (bergauf positiv)
 *   agl       Höhe der Körpermitte über dem Gelände in Metern (wie die Röhre)
 *
 * Licht: fest von oben links im Bild (wie die Röhre in rz-line3d) — es dreht mit der Kamera, damit jedes Video gleich
 * wirkt. Schatten: weicher Fleck auf dem Boden unter dem Körper. Nur Merkator (im Globus nichts).
 */
(function () {
  "use strict";

  let _laden = null;
  /** three.js nachladen (klassisches Skript, setzt window.THREE). */
  function laden() {
    if (window.THREE) return Promise.resolve(window.THREE);
    if (_laden) return _laden;
    _laden = new Promise((ok, fehler) => {
      const s = document.createElement("script");
      s.src = (window.__rzAssetBase || "") + "vendor/three.js";
      s.onload = () => (window.THREE ? ok(window.THREE) : fehler(new Error("three.js geladen, aber window.THREE fehlt")));
      s.onerror = () => { _laden = null; fehler(new Error("three.js nicht ladbar: " + s.src)); };
      document.head.appendChild(s);
    });
    return _laden;
  }

  function _schattenTextur(T) {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const g = c.getContext("2d"), r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, "rgba(0,0,0,0.55)"); r.addColorStop(0.55, "rgba(0,0,0,0.28)"); r.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = r; g.fillRect(0, 0, 128, 128);
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace;
    return t;
  }

  /** Pfeil in Einheitsgröße: Länge 1 entlang +z (vorn), flach in der x/z-Ebene, Dicke nach oben (+y). */
  function _pfeilGeometrie(T) {
    const s = new T.Shape();
    // Navigationspfeil mit Kerbe hinten (wie der 2D-Laufpfeil): Spitze vorn, zwei Flügel, Kerbe
    s.moveTo(0, 0.5); s.lineTo(0.36, -0.5); s.lineTo(0, -0.24); s.lineTo(-0.36, -0.5); s.closePath();
    const g = new T.ExtrudeGeometry(s, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.045, bevelSegments: 4, curveSegments: 4 });
    g.translate(0, 0, -0.08);
    g.scale(1.5, 1.5, 1.5);   // der Pfeil wirkt flach — 1,5 × so lang wie die Kugel breit ist
    g.rotateX(-Math.PI / 2);    // Shape-y (vorn) → −z … umdrehen, damit die Spitze nach +z zeigt
    g.rotateY(Math.PI);
    g.computeVertexNormals();
    return g;
  }

  function create(id) {
    const layer = {
      id, type: "custom", renderingMode: "3d",
      _map: null, _figur: null, _T: null,
      onAdd(map, gl) {
        this._map = map;
        const T = this._T = window.THREE;
        if (!T) return;
        this._renderer = new T.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
        this._renderer.autoClear = false;
        this._scene = new T.Scene();
        this._kamera = new T.Camera();
        this._halbkugel = new T.HemisphereLight(0xffffff, 0x202020, 0.55);
        this._sonne = new T.DirectionalLight(0xffffff, 3.4);
        this._scene.add(this._halbkugel, this._sonne, this._sonne.target);
        // Weiß + Linienfarbe wie der 2D-Laufpunkt (Marc, 02.11.2026: „das Weiß mit dazu“): Pfeil oben/unten weiß, Rand und
        // Fase farbig (ExtrudeGeometry: Gruppe 0 = Deckflächen, 1 = Seiten); Kugel weiß mit farbigem Ring am Äquator
        this._material = new T.MeshStandardMaterial({ color: 0x48d6c4, roughness: 0.45, metalness: 0.0 });
        this._weiss = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0.0 });
        const kugel = new T.Group();
        kugel.add(new T.Mesh(new T.SphereGeometry(0.5, 40, 28), this._weiss));
        const ring = new T.Mesh(new T.TorusGeometry(0.5, 0.075, 16, 64), this._material);
        ring.rotation.x = Math.PI / 2;
        kugel.add(ring);
        // Puk (Marc, 02.11.2026): flache Scheibe wie ein Eishockey-Puk — oben weiß, Rand farbig, Kanten gerundet (zwei
        // Ringe); liegt flach und kippt mit der Steigung wie der Pfeil
        const puk = new T.Group(), pH = 0.3, pR = 0.07;
        puk.add(new T.Mesh(new T.CylinderGeometry(0.5, 0.5, pH - 2 * pR, 48), [this._material, this._weiss, this._weiss]));
        for (const y of [pH / 2 - pR, -(pH / 2 - pR)]) {
          const kante = new T.Mesh(new T.TorusGeometry(0.5 - pR, pR, 12, 64), this._material);
          kante.rotation.x = Math.PI / 2; kante.position.y = y; puk.add(kante);
          const deckel = new T.Mesh(new T.CircleGeometry(0.5 - pR, 48), this._weiss);
          deckel.rotation.x = y > 0 ? -Math.PI / 2 : Math.PI / 2; deckel.position.y = y + (y > 0 ? pR : -pR); puk.add(deckel);
        }
        this._formen = {
          kugel,
          puk,
          pfeil: new T.Mesh(_pfeilGeometrie(T), [this._weiss, this._material]),
        };
        this._koerper = new T.Group();
        for (const k in this._formen) { this._formen[k].visible = false; this._koerper.add(this._formen[k]); }
        this._schatten = new T.Mesh(new T.CircleGeometry(0.5, 40),
          new T.MeshBasicMaterial({ map: _schattenTextur(T), transparent: true, depthWrite: false }));
        this._schatten.rotation.x = -Math.PI / 2;
        this._scene.add(this._koerper, this._schatten);
        // Feuerkugel (rz-feuer3d): eigene Gruppe, Einheit = Kugeldurchmesser
        if (window.rzFeuer3d) { this._feuer = window.rzFeuer3d.erzeugen(T); this._feuer.gruppe.visible = false; this._scene.add(this._feuer.gruppe); }
      },
      onRemove() {
        try {
          for (const k in (this._formen || {})) this._formen[k].traverse((o) => { if (o.geometry) o.geometry.dispose(); });
          if (this._material) this._material.dispose();
          if (this._weiss) this._weiss.dispose();
          if (this._feuer) this._feuer.entsorgen();
          if (this._schatten) { this._schatten.geometry.dispose(); this._schatten.material.map.dispose(); this._schatten.material.dispose(); }
        } catch (_) {}
        this._renderer = null;
      },
      setFigur(f) {
        this._figur = f || null;
        try { this._map && this._map.triggerRepaint(); } catch (_) {}
      },
      /** Meter je CSS-Pixel an einer Stelle (mit Perspektive): 1 m nach Osten projizieren. */
      _mProPx(lng, lat, h) {
        const m = this._map;
        const a = m.project([lng, lat]), b = m.project([lng + 1 / (111320 * Math.max(0.05, Math.cos(lat * Math.PI / 180))), lat]);
        const px = Math.hypot(b.x - a.x, b.y - a.y);
        return px > 1e-6 ? 1 / px : 1;
      },
      /** Feuerkugel: Kamera-Auge und Spur in den Raum der Feuer-Gruppe (Meter / Kugeldurchmesser) umrechnen. */
      _feuerSetzen(f, groesse, boden, agl, mc) {
        const T = this._T, m = this._map, fg = this._feuer.gruppe;
        fg.position.set(0, 0, 0); fg.scale.setScalar(groesse); fg.updateMatrixWorld(true);
        const auge = this._auge.clone().multiplyScalar(1 / groesse);   // Kamera (render) im Raum der Feuer-Gruppe
        // Spur hinter dem Kopf: Länge ≈ 6 Kugeldurchmesser, Höhe wie die Röhre (Gelände + agl)
        const lat0 = f.lat, kl = 111320 * Math.cos(lat0 * Math.PI / 180), ziel = 6 * groesse;
        const spur = [[0, 0, 0]];
        let summe = 0, vorher = [f.lng, f.lat];
        for (const c of (f.spur || [])) {
          const dx = (c[0] - vorher[0]) * kl, dz = -(c[1] - vorher[1]) * 111320, d = Math.hypot(dx, dz);
          if (d < 1e-3) continue;
          let b = boden;
          try { const h = m.queryTerrainElevation([c[0], c[1]]); if (typeof h === "number" && isFinite(h)) b = h; } catch (_) {}
          const rest = ziel - summe, u = d > rest ? rest / d : 1;
          const x = ((vorher[0] + (c[0] - vorher[0]) * u) - f.lng) * kl, z = -((vorher[1] + (c[1] - vorher[1]) * u) - f.lat) * 111320;
          spur.push([x / groesse, (b - boden) / groesse, z / groesse]);
          summe += d * u; vorher = c;
          if (summe >= ziel - 1e-6) break;
        }
        if (spur.length < 2) {   // Start: noch keine Strecke dahinter — kurz gegen die Fahrtrichtung
          const b = (+f.drehung || 0) * Math.PI / 180;
          spur.push([-Math.sin(b) * 3, 0, Math.cos(b) * 3]);
        }
        const pxProEinheit = groesse / Math.max(1e-6, this._mProPx(f.lng, f.lat)) * ((m.getPixelRatio && m.getPixelRatio()) || 1);
        this._feuer.setzen({ zeit: +f.zeit || 0, auge, spur, kalt: f.kalt || null, pxProEinheit });
        window.__rzFeuerPruef = { groesse, auge: auge.toArray(), spur: spur.slice(0, 12), n: spur.length, pxProEinheit, roh: (f.spur || []).slice(0, 4) };   // Prüfstand
      },
      render(gl, args) {
        const f = this._figur, T = this._T;
        if (!f || !T || !this._renderer) return;
        const pd = args && args.defaultProjectionData;
        if (pd && +pd.projectionTransition > 0.001) return;   // Globus: (noch) nicht
        const mm = pd && pd.mainMatrix ? pd.mainMatrix : args;
        if (!mm || mm.length !== 16) return;
        const m = this._map, MC = window.maplibregl && window.maplibregl.MercatorCoordinate;
        if (!MC) return;
        let boden = 0;
        try { const e = m.queryTerrainElevation && m.getTerrain && m.getTerrain() ? m.queryTerrainElevation([f.lng, f.lat]) : 0; boden = (typeof e === "number" && isFinite(e)) ? e : 0; } catch (_) {}
        // Höhe wie die Röhre (rz-line3d): über Grund × Geländeüberhöhung — sonst sitzt der Körper bei überhöhtem Gelände
        // über oder unter der Röhre statt in ihrer Mitte
        let ex = 1;
        try { const tr = m.getTerrain && m.getTerrain(); ex = (tr && +tr.exaggeration) || 1; } catch (_) {}
        const agl = Math.max(0, +f.agl || 0) * ex;
        const mc = MC.fromLngLat([f.lng, f.lat], boden + agl);
        const s = mc.meterInMercatorCoordinateUnits();
        // Größe: Meter, aber nie kleiner als minPx Bildpunkte
        let groesse = Math.max(0.5, +f.groesseM || 10);
        try { groesse = Math.max(groesse, (+f.minPx || 0) * this._mProPx(f.lng, f.lat)); } catch (_) {}
        // Modellraum in Metern: x Ost, y oben, z Süd (three-üblich; Merkator-y wächst nach Süden). −s auf y wie im
        // MapLibre-Beispiel: nach der Drehung um x wird Modell-z zu Merkator-y, und die Spiegelung hält den Umlaufsinn
        // der Dreiecke richtig (MapLibres Matrix spiegelt selbst einmal)
        const modell = new T.Matrix4().makeTranslation(mc.x, mc.y, mc.z)
          .scale(new T.Vector3(s, -s, s))
          .multiply(new T.Matrix4().makeRotationX(Math.PI / 2));
        const gesamt = new T.Matrix4().fromArray(mm).multiply(modell);
        // Kamera an ihren echten Ort im Modellraum stellen (der Punkt, den die Gesamtmatrix auf w = 0, x = y = 0 abbildet).
        // Ohne das rechnet three den Glanz von der Figurmitte aus — oben auf Kugel, Puk und Pfeil lag ein dunkler Fleck.
        const e = new T.Vector4(0, 0, 1, 0).applyMatrix4(gesamt.clone().invert());
        this._auge = Math.abs(e.w) > 1e-12 ? new T.Vector3(e.x / e.w, e.y / e.w, e.z / e.w) : new T.Vector3(0, 1e5, 1e5);
        this._kamera.position.copy(this._auge);
        this._kamera.updateMatrixWorld(true);
        this._kamera.projectionMatrix = gesamt.multiply(this._kamera.matrixWorld);   // × Ansicht⁻¹ (three) = Gesamtmatrix
        // Körper
        const feuer = f.form === "feuer" && !!this._feuer;
        const form = (f.form === "pfeil" || f.form === "puk") ? f.form : "kugel";
        for (const k in this._formen) this._formen[k].visible = (k === form);   // Feuerkugel = normale Kugel + Schweif
        if (this._feuer) this._feuer.gruppe.visible = feuer;
        if (feuer) this._feuerSetzen(f, groesse, boden, agl, mc);
        this._material.color.set(f.farbe || "#48d6c4");
        this._material.roughness = this._weiss.roughness = Math.max(0.08, 0.85 - 0.7 * Math.max(0, Math.min(1, f.glanz != null ? +f.glanz : 0.5)));
        const dreh = (+f.drehung || 0) * Math.PI / 180, neig = (+f.neigung || 0) * Math.PI / 180;
        this._koerper.position.set(0, 0, 0);
        this._koerper.rotation.set(0, 0, 0);
        // Fahrtrichtung: Nord = −z; im Uhrzeigersinn von oben gesehen = negative Drehung um y
        this._koerper.rotation.order = "YXZ";
        this._koerper.rotation.y = Math.PI - dreh;
        this._koerper.rotation.x = form === "kugel" ? 0 : -neig;   // bergauf: Spitze bzw. Vorderkante hebt sich
        this._koerper.scale.setScalar(groesse);
        // Schatten auf dem Boden: Abstand nach unten, mit der Höhe weicher und größer
        this._schatten.position.set(0, -agl + Math.max(0.3, groesse * 0.02), 0);
        this._schatten.scale.setScalar(groesse * (1.25 + Math.min(1, agl / Math.max(1, groesse)) * 0.35));
        this._schatten.material.opacity = Math.max(0.25, 0.75 - 0.25 * Math.min(1, agl / Math.max(1, groesse)));
        this._schatten.visible = f.schatten !== false;
        // Licht von oben links im Bild: Richtung aus Kamera-Peilung (Ost/Nord), Höhe fest
        const b = (m.getBearing ? m.getBearing() : 0) * Math.PI / 180;
        const links = [-Math.cos(b), Math.sin(b)];   // Bild-links in (Ost, Nord)
        const zurKamera = [-Math.sin(b), -Math.cos(b)];
        const ost = links[0] * 0.55 + zurKamera[0] * 0.45, nord = links[1] * 0.55 + zurKamera[1] * 0.45;
        this._sonne.position.set(ost, 1.3, -nord);
        this._sonne.target.position.set(0, 0, 0);
        this._renderer.resetState();
        this._renderer.render(this._scene, this._kamera);
      },
    };
    return layer;
  }

  const api = { create, laden };
  if (typeof window !== "undefined") window.rzFigur3d = api;
})();
