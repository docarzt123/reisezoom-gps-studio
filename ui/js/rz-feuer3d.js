/* rz-feuer3d.js — Schweif für den Laufpunkt „Feuerkugel“ in rz-figur3d (three.js, 02.11.2026)
 *
 * Marc: „wie wenn eine brennende Kanonenkugel fliegt — eine Art Schweif“. Erster Entwurf (glühender Kern, großer
 * Glutschein, Funken) war ihm „viel zu groß und zu krass“; jetzt: „mehr als Mischung der normalen Kugel und dann halt
 * mit Schweif“. Der Kopf ist darum die normale 3D-Kugel aus rz-figur3d; hier kommen nur dazu:
 *   Schein    schwacher warmer Hof um die Kugel
 *   Schweif   weiche Leuchtpartikel entlang der gelaufenen Strecke (folgt Kurven), hinten schmal, rot und blass
 * Alles hängt an der Videozeit (`zeit`), nicht an der Uhr — Vorschau und Video zeigen dasselbe Bild.
 * Additiv gemischt, ohne Tiefe zu schreiben; hinter Gelände und Kugel bleibt es verdeckt (Tiefentest).
 *
 *   const fk = rzFeuer3d.erzeugen(THREE);   group.add(fk.gruppe);
 *   fk.setzen({ zeit, auge: Vector3 (Kamera im Modellraum), spur: [[x,y,z]…] (Modellraum, Kopf zuerst), kalt: null | "#rrggbb" })
 * Modellraum: Meter, Kopf im Ursprung, Kugeldurchmesser 1 (der Aufrufer skaliert die Gruppe).
 */
(function () {
  "use strict";

  const N_FLAMMEN = 90;

  // Rauschen im Shader (Wert-Rauschen, zwei Oktaven) — billig, glatt genug für Flammen
  const RAUSCHEN = `
float rzH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float rzN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(rzH(i), rzH(i + vec2(1, 0)), f.x), mix(rzH(i + vec2(0, 1)), rzH(i + vec2(1, 1)), f.x), f.y); }
float rzF(vec2 p) { return 0.6 * rzN(p) + 0.4 * rzN(p * 2.3 + 7.1); }`;

  // Farbverlauf der Flamme: t = 1 heiß (Kern) … 0 kalt (Rauchende). kalt = eigene Farbe statt Feuer.
  const FARBE = `
uniform float u_kalt;
uniform vec3 u_kaltFarbe;
vec3 rzGlut(float t) {
  vec3 feuer = t > 0.75 ? mix(vec3(1.0, 0.78, 0.32), vec3(1.0, 0.97, 0.85), (t - 0.75) / 0.25)
             : t > 0.4  ? mix(vec3(1.0, 0.38, 0.06), vec3(1.0, 0.78, 0.32), (t - 0.4) / 0.35)
             :            mix(vec3(0.45, 0.06, 0.02), vec3(1.0, 0.38, 0.06), t / 0.4);
  vec3 kalt = t > 0.7 ? mix(u_kaltFarbe, vec3(1.0), (t - 0.7) / 0.3) : mix(u_kaltFarbe * 0.35, u_kaltFarbe, t / 0.7);
  return mix(feuer, kalt, u_kalt);
}`;

  function erzeugen(T) {
    const gruppe = new T.Group();
    const gemeinsam = { u_zeit: { value: 0 }, u_kalt: { value: 0 }, u_kaltFarbe: { value: new T.Color(0x48d6c4) },
                        u_auge: { value: new T.Vector3(0, 1, 1) } };

    // ── Glut-Hof (Fläche, die zur Kamera schaut) ───────────────────────────────
    const hof = new T.Mesh(new T.PlaneGeometry(1, 1), new T.ShaderMaterial({
      uniforms: gemeinsam, transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      vertexShader: `varying vec2 v_uv; void main() { v_uv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float u_zeit; varying vec2 v_uv; ${RAUSCHEN}${FARBE}
        void main() {
          float r = length(v_uv);
          float flacker = 0.85 + 0.3 * rzF(vec2(u_zeit * 5.0, 1.7));
          float a = pow(max(0.0, 1.0 - r), 2.6) * flacker * 0.45;
          if (a < 0.003) discard;
          gl_FragColor = vec4(rzGlut(0.55 + 0.4 * (1.0 - r)) * a, a);
        }`,
    }));
    hof.scale.setScalar(2.0);

    // ── Flammenschweif: weiche Leuchtpartikel entlang der Spur ──────────────────
    // (02.11.2026, zweiter Versuch) Ein Band sah nur von der Seite gut aus; läuft die Spur auf die Kamera zu, wurde es zu
    // Querstreifen. Partikel schauen immer zur Kamera. Sie wandern mit der Videozeit nach hinten, vorn dicht und heiß
    // (addieren sich zu Weiß), hinten klein, rot und blass.
    const qGeo = new T.BufferGeometry();
    const qPos = new Float32Array(N_FLAMMEN * 3), qU = new Float32Array(N_FLAMMEN), qZufall = new Float32Array(N_FLAMMEN);
    qGeo.setAttribute("position", new T.BufferAttribute(qPos, 3));
    qGeo.setAttribute("a_u", new T.BufferAttribute(qU, 1));
    qGeo.setAttribute("a_zufall", new T.BufferAttribute(qZufall, 1));
    const schweif = new T.Points(qGeo, new T.ShaderMaterial({
      uniforms: Object.assign({ u_pxProEinheit: { value: 10 } }, gemeinsam),
      transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      vertexShader: `attribute float a_u; attribute float a_zufall; uniform float u_pxProEinheit; varying float v_u; varying float v_z;
        void main() { v_u = a_u; v_z = a_zufall; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = max(1.5, u_pxProEinheit * (0.95 - 0.7 * a_u) * (0.8 + 0.4 * a_zufall)); }`,
      fragmentShader: `uniform float u_zeit; varying float v_u; varying float v_z; ${RAUSCHEN}${FARBE}
        void main() {
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          float n = rzF(p * 1.8 + vec2(v_z * 17.0, u_zeit * 4.0 + v_z * 9.0));
          float r = length(p) * (0.85 + 0.3 * n);
          float a = (1.0 - smoothstep(0.15, 1.0, r)) * pow(1.0 - v_u, 1.4) * 0.38;
          if (a < 0.003) discard;
          gl_FragColor = vec4(rzGlut(clamp(0.85 - v_u * 1.0 + 0.12 * (n - 0.5), 0.0, 1.0)) * a, a);
        }`,
    }));
    schweif.frustumCulled = false;

    gruppe.add(schweif, hof);

    // Pseudozufall je Partikel (fest, damit jedes Bild gleich ist)
    const rnd = (i, k) => { const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
    const _v = new T.Vector3();

    /** Punkt und Richtung auf der Spur bei Anteil u (0 Kopf … 1 Ende), Ausgabe in o / richtung. */
    function aufSpur(spur, kum, u, o, richtung) {
      const L = kum[kum.length - 1] || 1, d = u * L;
      let i = 1; while (i < kum.length - 1 && kum[i] < d) i++;
      const a = spur[i - 1], b = spur[i], seg = Math.max(1e-6, kum[i] - kum[i - 1]), f = Math.min(1, Math.max(0, (d - kum[i - 1]) / seg));
      o.set(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f);
      if (richtung) richtung.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    }

    function setzen(o) {
      const zeit = +o.zeit || 0;
      gemeinsam.u_zeit.value = zeit;
      gemeinsam.u_kalt.value = o.kalt ? 1 : 0;
      if (o.kalt) gemeinsam.u_kaltFarbe.value.set(o.kalt);
      gemeinsam.u_auge.value.copy(o.auge);
      hof.lookAt(o.auge);
      hof.scale.setScalar(2.0 * (0.95 + 0.08 * Math.sin(zeit * 13.0) * Math.sin(zeit * 7.3 + 1.1)));
      // Spur: ohne Strecke dahinter (Start) ein kurzes Stück gegen die Fahrtrichtung
      let spur = (o.spur && o.spur.length >= 2) ? o.spur : [[0, 0, 0], [0, 0, 1]];
      const kum = [0];
      for (let i = 1; i < spur.length; i++) kum.push(kum[i - 1] + Math.hypot(spur[i][0] - spur[i - 1][0], spur[i][1] - spur[i - 1][1], spur[i][2] - spur[i - 1][2]));
      const L = kum[kum.length - 1];
      // Flammen: Partikel i läuft in `takt` Sekunden vom Kopf bis zum Ende; Versatz je Partikel fest, damit sie gleichmäßig
      // verteilt bleiben. Quadratisch verteilt → vorn dichter.
      const takt = 0.9, u0 = Math.min(0.3, 0.4 / Math.max(1e-6, L));   // Schweif beginnt am Kugelrand
      for (let i = 0; i < N_FLAMMEN; i++) {
        const lauf = (zeit / takt + i / N_FLAMMEN) % 1, u = u0 + (1 - u0) * lauf * lauf;
        const zyk = Math.floor(zeit / takt + i / N_FLAMMEN);
        const r1 = rnd(i, 11 + zyk * 0.53), r2 = rnd(i, 13 + zyk * 0.71), r3 = rnd(i, 17 + zyk * 0.19);
        aufSpur(spur, kum, u, _v, null);
        const streu = 0.06 + 0.22 * u;   // hinten etwas breiter, ausgefranst
        qPos.set([_v.x + (r1 - 0.5) * streu, _v.y + u * u * L * 0.04 + (r2 - 0.4) * streu * 0.8, _v.z + (r3 - 0.5) * streu], i * 3);
        qU[i] = u; qZufall[i] = r1;
      }
      qGeo.attributes.position.needsUpdate = true; qGeo.attributes.a_u.needsUpdate = true; qGeo.attributes.a_zufall.needsUpdate = true;
      schweif.material.uniforms.u_pxProEinheit.value = +o.pxProEinheit || 10;
    }

    function entsorgen() {
      for (const m of [hof, schweif]) { m.geometry.dispose(); m.material.dispose(); }
    }
    return { gruppe, setzen, entsorgen };
  }

  const api = { erzeugen };
  if (typeof window !== "undefined") window.rzFeuer3d = api;
})();
