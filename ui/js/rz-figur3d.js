/* rz-figur3d.js — der Laufpunkt als echter 3D-Körper (MapLibre + three.js, 02.11.2026)
 *
 * Warum: Nutzer wünschen sich als Laufpunkt richtige 3D-Objekte. Erster Schritt sind Kugel und Pfeil auf der Röhre
 * (rz-line3d), Licht und Schatten wie bei der Röhre; dieselbe Ebene trägt später Fahrzeuge (glTF). three.js zeichnet
 * in MapLibres eigenen WebGL-Kontext und Tiefenpuffer — hinter dem Berg verdeckt das Gelände den Körper von selbst.
 *
 *   await rzFigur3d.laden();                         // three.js erst bei Bedarf (ui/vendor/three.js, ~2 MB)
 *   const f = rzFigur3d.create("laufpunkt-3d"); map.addLayer(f);
 *   f.setFigur({ lng, lat, agl, form: "komet" | "kometpfeil" | "kugel" | "puk" | "pfeil" | "feuer" (Kugel + Schweif), farbe, glanz, groesseM, minPx, drehung, neigung,
 *                leucht: "#rrggbb" (Komet: Farbe des Scheins = heißeste Glutstufe) });
 *   f.setFigur(null);                                // ausblenden
 *   form "modell" (08.11.2026): 3D-Fahrzeug aus rz-modelle.js — modell: { art, phase (0…1 Bewegung), ruhe (0…1 Ruhepose), farbe, farbe2 },
 *                groesseM = Länge; Bodenmodelle stehen mit der Unterkante auf agl, Luftmodelle mit der Mitte;
 *                obenauf: true = nie vom Gelände verdeckt (Laufpunkt „obenauf“)
 *
 *   groesseM  Durchmesser (Kugel, Puk) bzw. Länge (Pfeil) in Metern; minPx = Mindestgröße in CSS-Pixeln (aus der Ferne)
 *   drehung   Fahrtrichtung in Grad im Uhrzeigersinn ab Nord;  neigung = Steigung in Grad (bergauf positiv)
 *   agl       Höhe der Körpermitte über dem Gelände in Metern (wie die Röhre)
 *
 * Licht: fest von oben links im Bild (wie die Röhre in rz-line3d) — es dreht mit der Kamera, damit jedes Video gleich
 * wirkt. Schatten: weicher Fleck auf dem Boden unter dem Körper. Merkator und Globus (seit 08.11.2026 über
 * transform.getMatrixForModel).
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

  /** Weicher runder Schein (weiß, nach außen durchsichtig) — eingefärbt über die Sprite-Farbe, additiv. */
  function _scheinTextur(T) {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const g = c.getContext("2d"), r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, "rgba(255,255,255,0.85)"); r.addColorStop(0.25, "rgba(255,255,255,0.45)");
    r.addColorStop(0.55, "rgba(255,255,255,0.12)"); r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r; g.fillRect(0, 0, 128, 128);
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace;
    return t;
  }

  /** Pfeil in Einheitsgröße: Länge 1 entlang +z (vorn), flach in der x/z-Ebene, Dicke nach oben (+y). */
  function _pfeilGeometrie(T, dicke) {
    const s = new T.Shape();
    // Navigationspfeil mit Kerbe hinten (wie der 2D-Laufpfeil): Spitze vorn, zwei Flügel, Kerbe
    s.moveTo(0, 0.5); s.lineTo(0.36, -0.5); s.lineTo(0, -0.24); s.lineTo(-0.36, -0.5); s.closePath();
    const d = dicke || 0.16;
    const g = new T.ExtrudeGeometry(s, { depth: d, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.045, bevelSegments: 4, curveSegments: 4 });
    g.translate(0, 0, -d / 2);
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
        // 06.11.2026 Komet — glühende Kugel (Marc: „die Kugel muss der hellste Punkt sein, ab da wird's dunkler nach
        // hinten“): selbstleuchtender weißglühender Kern (unbeleuchtet, kein Schatten auf der Kugel), darum zwei weiche
        // Scheine: innen fast weiß, außen in der Glutfarbe. Die Scheine prüfen keine Tiefe (das Gelände schnitt sie sonst
        // als Sichel ab) — hinter dem Berg blendet sie stattdessen die Sichtprüfung des Laufpunkts aus (rzSignSicht).
        this._perle = new T.MeshBasicMaterial({ color: 0xfffbf2 });
        const komet = new T.Mesh(new T.SphereGeometry(0.5, 48, 32), this._perle);
        // Flächen statt Sprites: three richtet Sprites nach der Kameradrehung aus, unsere Kamera ist eine reine Matrix ohne
        // Drehung — der Schein stand als senkrechte Scheibe in der Landschaft (von schräg oben fast unsichtbar). Die Flächen
        // werden in render() zum echten Kameraort gedreht.
        const scheinMat = (farbe) => new T.MeshBasicMaterial({ map: _scheinTextur(T), color: farbe, transparent: true,
          blending: T.AdditiveBlending, depthWrite: false, depthTest: false, side: T.DoubleSide });
        this._scheinInnen = new T.Mesh(new T.PlaneGeometry(1, 1), scheinMat(0xfff4dc));
        this._scheinInnen.visible = false;
        this._schein = new T.Mesh(new T.PlaneGeometry(1, 1), scheinMat(0xffffff));
        this._schein.visible = false;
        // Komet-Pfeil: dritter Schein weiter hinten (Triebwerk, Marc 06.11.2026)
        this._scheinHinten = new T.Mesh(new T.PlaneGeometry(1, 1), scheinMat(0xffffff));
        this._scheinHinten.visible = false;
        // 06.11.2026 (Marc: „mach statt der Kugel jetzt das gleiche mit einem Pfeil“) — Komet-Pfeil: derselbe weißglühende,
        // unbeleuchtete Körper wie die Kometenkugel, als Pfeil (etwas dicker, damit er neben der Röhre nicht wie ein Blatt
        // wirkt), Seiten in der Glutfarbe; die Röhre kommt hinten aus der Kerbe
        this._glutRand = new T.MeshBasicMaterial({ color: 0xffd27a });
        const kometpfeil = new T.Mesh(_pfeilGeometrie(T, 0.3), [this._perle, this._glutRand]);
        this._formen = {
          komet,
          kometpfeil,
          kugel,
          puk,
          pfeil: new T.Mesh(_pfeilGeometrie(T), [this._weiss, this._material]),
          // 08.11.2026 — 3D-Fahrzeuge (rz-modelle.js): ein Körper, die Geometrie wechselt je Art und Bewegungsstufe
          modell: new T.Mesh(new T.BufferGeometry(), this._modellMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.0, side: T.DoubleSide })),
        };
        this._modellGeo = new WeakMap();
        this._modellGeoListe = [];   // 09.11.2026 (Audit) — alle gebauten Modellnetze, damit onRemove sie freigeben kann
        this._koerper = new T.Group();
        for (const k in this._formen) { this._formen[k].visible = false; this._koerper.add(this._formen[k]); }
        this._schatten = new T.Mesh(new T.CircleGeometry(0.5, 40),
          new T.MeshBasicMaterial({ map: _schattenTextur(T), transparent: true, depthWrite: false }));
        this._schatten.rotation.x = -Math.PI / 2;
        this._scene.add(this._koerper, this._schatten, this._schein, this._scheinInnen, this._scheinHinten);
        // Feuerkugel (rz-feuer3d): eigene Gruppe, Einheit = Kugeldurchmesser
        if (window.rzFeuer3d) { this._feuer = window.rzFeuer3d.erzeugen(T); this._feuer.gruppe.visible = false; this._scene.add(this._feuer.gruppe); }
      },
      onRemove() {
        try {
          for (const k in (this._formen || {})) this._formen[k].traverse((o) => { if (o.geometry) o.geometry.dispose(); });
          if (this._material) this._material.dispose();
          if (this._weiss) this._weiss.dispose();
          if (this._perle) this._perle.dispose();
          if (this._glutRand) this._glutRand.dispose();
          if (this._modellMat) this._modellMat.dispose();
          if (this._scheinInnen) { this._scheinInnen.geometry.dispose(); this._scheinInnen.material.map.dispose(); this._scheinInnen.material.dispose(); }
          if (this._schein) { this._schein.geometry.dispose(); this._schein.material.map.dispose(); this._schein.material.dispose(); }
          if (this._scheinHinten) { this._scheinHinten.geometry.dispose(); this._scheinHinten.material.map.dispose(); this._scheinHinten.material.dispose(); }
          if (this._feuer) this._feuer.entsorgen();
          if (this._schatten) { this._schatten.geometry.dispose(); this._schatten.material.map.dispose(); this._schatten.material.dispose(); }
          // 09.11.2026 (Audit) — Modellnetze je Art/Bewegungsstufe und der Renderer selbst blieben nach jedem Stil-,
          // Röhren- oder Kopfwechsel im Speicher (der Renderer hängt Listener an die Karten-Leinwand). dispose() gibt den
          // geteilten WebGL-Kontext der Karte NICHT auf.
          for (const g of (this._modellGeoListe || [])) g.dispose();
          this._modellGeoListe = [];
          this._modellGeo = new WeakMap();
          if (this._renderer) this._renderer.dispose();
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
      /** Geometrie eines 3D-Fahrzeugs (rz-modelle.js) in den Modellraum der Ebene: Modell x rechts, y vorn, z oben →
       *  three (−x, z, y), also vorn = +z wie der Pfeil. Je Art und Bewegungsstufe einmal gebaut, Farben bei Wechsel neu. */
      _modellGeometrie(md) {
        const R = window.rzModelle, T = this._T;
        if (!R || !md || !md.art || !R.ARTEN.includes(md.art)) return null;
        const t = R.mesh(md.art, +md.phase || 0, +md.ruhe || 0);
        let e = this._modellGeo.get(t);
        if (!e) {
          const n = t.pos.length / 3, pos = new Float32Array(3 * n), nor = new Float32Array(3 * n);
          for (let i = 0; i < n; i++) {
            pos[3 * i] = -t.pos[3 * i]; pos[3 * i + 1] = t.pos[3 * i + 2]; pos[3 * i + 2] = t.pos[3 * i + 1];
            nor[3 * i] = -t.nor[3 * i]; nor[3 * i + 1] = t.nor[3 * i + 2]; nor[3 * i + 2] = t.nor[3 * i + 1];
          }
          const geo = new T.BufferGeometry();
          geo.setAttribute("position", new T.BufferAttribute(pos, 3));
          geo.setAttribute("normal", new T.BufferAttribute(nor, 3));
          geo.setAttribute("color", new T.BufferAttribute(new Float32Array(3 * n), 3));
          // 12.11.2026 — Unterkante (Modelllänge = 1, Mitte = 0) für Luftmodelle: sie stehen mit der Mitte auf agl
          let unter = 0;
          if (t.luft) for (let i = 2; i < t.pos.length; i += 3) unter = Math.max(unter, -t.pos[i]);
          e = { geo, farbKey: null, rolle: t.rolle, unter };
          this._modellGeo.set(t, e);
          this._modellGeoListe.push(geo);
        }
        const fk = (md.farbe || "") + "|" + (md.farbe2 || "");
        if (e.farbKey !== fk) {
          // rz-modelle liefert sRGB 0…1, three rechnet linear (wie color.set("#…") bei den anderen Formen)
          const lin = (c) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4), F = {};
          const col = e.geo.getAttribute("color").array;
          for (let i = 0; i < e.rolle.length; i++) {
            const r = e.rolle[i];
            const c = F[r] || (F[r] = R.farbe(r, md).map((v) => lin(Math.min(1, v * (r === "licht" ? 1.35 : 1)))));
            col[3 * i] = c[0]; col[3 * i + 1] = c[1]; col[3 * i + 2] = c[2];
          }
          e.geo.getAttribute("color").needsUpdate = true;
          e.farbKey = fk;
        }
        this._modellUnter = e.unter || 0;
        return e.geo;
      },
      render(gl, args) {
        const f = this._figur, T = this._T;
        if (!f || !T || !this._renderer) return;
        const pd = args && args.defaultProjectionData;
        // 08.11.2026 (Marc: „3D muss überall gehen“) — im Globus zeichnete die Ebene nichts (ein Flug-Überblick
        // zeigte kein Flugzeug). Jetzt rechnet MapLibre die Lage des Modells (transform.getMatrixForModel: dieselben Achsen —
        // x Ost, y oben, z Süd, Meter — für Merkator und Globus); unten wird nur die Modellmatrix getauscht.
        const globus = !!(pd && +pd.projectionTransition > 0.001);
        this._globus = globus;   // Prüfstand
        const mm = pd && pd.mainMatrix ? pd.mainMatrix : args;
        if (!mm || mm.length !== 16) return;
        const m = this._map, MC = window.maplibregl && window.maplibregl.MercatorCoordinate;
        if (!MC) return;
        let boden = 0;
        // 06.11.2026 (Marc: „warum zittert die Kugel so?“) — die Abfrage genau unter dem Kopf sprang am Steilhang um im Mittel
        // 16 m je Bild; die Röhre nimmt die Höhen ihrer Trackpunkte. Wer `boden` mitgibt (aus denselben Punkthöhen), sitzt ruhig.
        if (f.boden != null && isFinite(+f.boden)) boden = +f.boden;
        else try { const e = m.queryTerrainElevation && m.getTerrain && m.getTerrain() ? m.queryTerrainElevation([f.lng, f.lat]) : 0; boden = (typeof e === "number" && isFinite(e)) ? e : 0; } catch (_) {}
        // Höhe wie die Röhre (rz-line3d): über Grund × Geländeüberhöhung — sonst sitzt der Körper bei überhöhtem Gelände
        // über oder unter der Röhre statt in ihrer Mitte
        let ex = 1;
        try { const tr = m.getTerrain && m.getTerrain(); ex = (tr && +tr.exaggeration) || 1; } catch (_) {}
        const agl = Math.max(0, +f.agl || 0) * ex;
        const mc = MC.fromLngLat([f.lng, f.lat], boden + agl);
        const s = mc.meterInMercatorCoordinateUnits();
        // Modellraum in Metern: x Ost, y oben, z Süd (three-üblich; Merkator-y wächst nach Süden). −s auf y wie im
        // MapLibre-Beispiel: nach der Drehung um x wird Modell-z zu Merkator-y, und die Spiegelung hält den Umlaufsinn
        // der Dreiecke richtig (MapLibres Matrix spiegelt selbst einmal)
        let modell = new T.Matrix4().makeTranslation(mc.x, mc.y, mc.z)
          .scale(new T.Vector3(s, -s, s))
          .multiply(new T.Matrix4().makeRotationX(Math.PI / 2));
        if (globus) {
          try { const gm = m.transform && m.transform.getMatrixForModel ? m.transform.getMatrixForModel([f.lng, f.lat], boden + agl) : null; if (gm) modell = new T.Matrix4().fromArray(gm); }
          catch (e) { console.warn("[figur3d] Globus-Matrix:", e); return; }
        }
        const gesamt = new T.Matrix4().fromArray(mm).multiply(modell);
        // Kamera an ihren echten Ort im Modellraum stellen (der Punkt, den die Gesamtmatrix auf w = 0, x = y = 0 abbildet).
        // Ohne das rechnet three den Glanz von der Figurmitte aus — oben auf Kugel, Puk und Pfeil lag ein dunkler Fleck.
        const e = new T.Vector4(0, 0, 1, 0).applyMatrix4(gesamt.clone().invert());
        this._auge = Math.abs(e.w) > 1e-12 ? new T.Vector3(e.x / e.w, e.y / e.w, e.z / e.w) : new T.Vector3(0, 1e5, 1e5);
        // Größe: Meter, aber nie kleiner als minPx Bildpunkte. Meter je Bildpunkt AM KOPF, quer zur Blickrichtung, aus der
        // Gesamtmatrix (06.11.2026: vorher über map.project am Boden — das fragte das Gelände ab und sprang am Hang, die
        // Kugel pumpte von Bild zu Bild um bis zu 30 %).
        let groesse = Math.max(0.5, +f.groesseM || 10);
        try {
          const v = this._auge.clone().normalize();
          let r = new T.Vector3().crossVectors(v, new T.Vector3(0, 1, 0));
          if (r.lengthSq() < 1e-8) r.set(1, 0, 0);
          r.normalize();
          const p0 = new T.Vector4(0, 0, 0, 1).applyMatrix4(gesamt), p1 = new T.Vector4(r.x, r.y, r.z, 1).applyMatrix4(gesamt);
          const cv = m.getCanvas(), W = cv.clientWidth || cv.width, H = cv.clientHeight || cv.height;
          const px = Math.hypot((p1.x / p1.w - p0.x / p0.w) * W / 2, (p1.y / p1.w - p0.y / p0.w) * H / 2);
          if (px > 1e-6 && isFinite(px)) groesse = Math.max(groesse, (+f.minPx || 0) / px);
        } catch (_) {}
        this._groesseM = groesse;   // gezeichnete Größe (Meter): die Röhre endet am Kugelrand (rz-line3d u_luecke)
        // Abstand Mitte → Austritt der Röhre: Kugelrand bzw. beim Pfeil die Kerbe (0,24 × 1,5 der Einheitsgröße, etwas davor)
        this._lueckeM = groesse * (f.form === "kometpfeil" ? 0.3 : 0.5);
        if (window.__rzKometLog) { try { const sp = m.project([f.lng, f.lat]); window.__rzKometLog.push([+(window.__rzVideoSek || 0).toFixed(3), +f.lng.toFixed(7), +f.lat.toFixed(7), +boden.toFixed(1), +agl.toFixed(1), +groesse.toFixed(1), +sp.x.toFixed(1), +sp.y.toFixed(1)]); } catch (_) {} }   // Prüfstand
        this._kamera.position.copy(this._auge);
        this._kamera.updateMatrixWorld(true);
        this._kamera.projectionMatrix = gesamt.multiply(this._kamera.matrixWorld);   // × Ansicht⁻¹ (three) = Gesamtmatrix
        // Körper
        const feuer = f.form === "feuer" && !!this._feuer;
        let form = (f.form === "pfeil" || f.form === "puk" || f.form === "komet" || f.form === "kometpfeil") ? f.form : "kugel";
        let heben = 0;   // Meter, um die der Körper über agl steigt (Luftmodell am Boden)
        if (f.form === "modell") {
          this._modellUnter = 0;
          const geo = this._modellGeometrie(f.modell);
          if (geo) { form = "modell"; this._formen.modell.geometry = geo; }
          // 09.11.2026 (Audit) — „obenauf“ schaltete hier den Tiefentest ab: dann malte jedes spätere Dreieck über die
          // früheren (ferne Räder und Innenflächen über der Karosserie). Jetzt mit Tiefentest, aber in den vordersten
          // Tiefenbereich gedrückt (gl.depthRange beim Zeichnen, unten) — vor dem Gelände, in sich richtig sortiert.
          this._modellMat.depthTest = true;
          // 12.11.2026 (FPV-Drohne „zerstückelt“) — Luftmodelle stehen mit der Mitte auf agl. Ohne Flugmodus ist
          // agl 0: Die untere Hälfte steckte im Gelände, bei der FPV-Drohne die ganzen Ringe (bis −0,21 Modelllänge unter
          // der Mitte), zu sehen waren nur Kuppel, Akku und lose Bögen. Jetzt schwebt die Unterkante mindestens 0,1
          // Modelllänge über dem Boden; im Flug (agl groß genug) ändert sich nichts.
          if (geo && this._modellUnter > 0) heben = Math.max(0, (this._modellUnter + 0.1) * groesse - agl);
        }
        for (const k in this._formen) this._formen[k].visible = (k === form);   // Feuerkugel = normale Kugel + Schweif
        if (this._feuer) this._feuer.gruppe.visible = feuer;
        if (feuer) this._feuerSetzen(f, groesse, boden, agl, mc);
        this._material.color.set(f.farbe || "#48d6c4");
        this._material.roughness = this._weiss.roughness = Math.max(0.08, 0.85 - 0.7 * Math.max(0, Math.min(1, f.glanz != null ? +f.glanz : 0.5)));
        const dreh = (+f.drehung || 0) * Math.PI / 180, neig = (+f.neigung || 0) * Math.PI / 180;
        this._koerper.position.set(0, heben, 0);
        this._hebenM = heben;   // Prüfstand
        this._koerper.rotation.set(0, 0, 0);
        // Fahrtrichtung: Nord = −z; im Uhrzeigersinn von oben gesehen = negative Drehung um y
        this._koerper.rotation.order = "YXZ";
        this._koerper.rotation.y = Math.PI - dreh;
        this._koerper.rotation.x = (form === "kugel" || form === "komet") ? 0 : -neig;   // bergauf: Spitze bzw. Vorderkante hebt sich
        this._koerper.scale.setScalar(groesse);
        // Schatten auf dem Boden: Abstand nach unten, mit der Höhe weicher und größer
        this._schatten.position.set(0, -agl + Math.max(0.3, groesse * 0.02), 0);
        const aglS = agl + heben;   // Schatten weicher, je höher der Körper wirklich schwebt
        this._schatten.scale.setScalar(groesse * (1.25 + Math.min(1, aglS / Math.max(1, groesse)) * 0.35));
        this._schatten.material.opacity = Math.max(0.25, 0.75 - 0.25 * Math.min(1, aglS / Math.max(1, groesse)));
        this._schatten.visible = f.schatten !== false;
        // Komet: Hauch der Glutfarbe im Perlmutt + Schein um den Kopf
        const leucht = (form === "komet" || form === "kometpfeil") ? (f.leucht || f.farbe || "#ffffff") : null;
        if (form === "kometpfeil") this._glutRand.color.set(f.leucht || f.farbe || "#ffd27a");
        let sicht = 1;
        if (leucht && typeof window.rzSignSicht === "function") {
          try { sicht = Math.max(0, Math.min(1, +window.rzSignSicht(m, f.lng, f.lat, boden + agl, 12))); } catch (_) { sicht = 1; }
          if (!isFinite(sicht)) sicht = 1;
        }
        this._schein.visible = this._scheinInnen.visible = !!leucht && sicht > 0.01;
        this._scheinHinten.visible = this._schein.visible && form === "kometpfeil";
        if (leucht) {
          const st = (f.scheinStark != null ? +f.scheinStark : 1.0) * sicht;
          this._schein.material.color.set(leucht);
          this._schein.material.opacity = st;
          this._schein.position.set(0, 0, 0);
          this._schein.scale.setScalar(groesse * (f.scheinFaktor != null ? +f.scheinFaktor : 3.4));
          this._schein.lookAt(this._auge);
          this._scheinInnen.material.opacity = 0.8 * st;
          this._scheinInnen.position.set(0, 0, 0);
          this._scheinInnen.scale.setScalar(groesse * 1.7);
          this._scheinInnen.lookAt(this._auge);
          if (form === "kometpfeil") {
            // 06.11.2026 (Marc: „den Glow nach hinten schicken, dass es aussieht wie ein Raketentriebwerk — in der Mitte sieht
            // es blöd aus“) — die Scheine sitzen hinter der Kerbe auf der Achse: heißer Kern am Austritt, dahinter größer und
            // schwächer, der dritte am weitesten hinten. Der Pfeil selbst bleibt der hellste Körper.
            const hinten = new T.Vector3(0, 0, -1).applyQuaternion(this._koerper.quaternion);
            const setz = (o, abst, gr, op) => { o.position.copy(hinten).multiplyScalar(groesse * abst); o.scale.setScalar(groesse * gr); o.material.opacity = op; o.lookAt(this._auge); };
            setz(this._scheinInnen, 0.42, 1.1, 0.85 * st);
            setz(this._schein, 0.85, 2.2, 0.8 * st);
            this._scheinHinten.material.color.set(leucht);
            setz(this._scheinHinten, 1.4, 2.0, 0.45 * st);
          }
        }
        // Licht von oben links im Bild: Richtung aus Kamera-Peilung (Ost/Nord), Höhe fest
        const b = (m.getBearing ? m.getBearing() : 0) * Math.PI / 180;
        const links = [-Math.cos(b), Math.sin(b)];   // Bild-links in (Ost, Nord)
        const zurKamera = [-Math.sin(b), -Math.cos(b)];
        const ost = links[0] * 0.55 + zurKamera[0] * 0.45, nord = links[1] * 0.55 + zurKamera[1] * 0.45;
        this._sonne.position.set(ost, 1.3, -nord);
        this._sonne.target.position.set(0, 0, 0);
        this._renderer.resetState();
        const vorn = form === "modell" && !!f.obenauf;
        const glv = vorn ? this._renderer.getContext() : null;
        if (glv) glv.depthRange(0, 0.002);
        try { this._renderer.render(this._scene, this._kamera); }
        finally { if (glv) glv.depthRange(0, 1); }
      },
    };
    return layer;
  }

  const api = { create, laden };
  if (typeof window !== "undefined") window.rzFigur3d = api;
})();
