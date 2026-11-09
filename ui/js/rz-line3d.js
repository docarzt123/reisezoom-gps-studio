/* rz-line3d.js — Linien ÜBER dem Gelände (MapLibre, 06.09.2026)
 *
 * Warum: MapLibre drapiert `line`-Ebenen auf das Geländenetz. Eine Spur liegt
 * dann exakt AUF der Oberfläche und wird von jedem Grat des groben Netzes
 * teilweise verdeckt; bei Kamerabewegung wandert die Verdeckungskante — im
 * Video flimmern einzelne Tracks (Marc, Teneriffa-Schwarm 4K, 05.09.2026).
 * Mapbox GL hob die Linien mit `line-z-offset` 150 m an; MapLibre kennt das
 * nicht (Linien-Shader ohne Höhe). Diese Ebene zeichnet die Spuren selbst:
 * jeder Punkt auf Geländehöhe + Versatz, Breite in Bildpunkten (wie eine
 * normale Linie), runde Enden/Verbindungen per Abstandsfeld, Tiefentest
 * gegen das Gelände (hinter dem Berg bleibt verdeckt).
 *
 * Nutzung:
 *   const lyr = rzLine3d.create("schwarm-3d", { offsetM: 150 });
 *   map.addLayer(lyr, beforeId);
 *   lyr.setTracks([{ coords: [[lng,lat],…], color: "#ff0000", width: 4, opacity: 0.9 }, …]);
 *   lyr.setCounts([k0, k1, …]);          // je Spur: bis zu welchem Punkt gezeichnet wird (Wachstum)
 *   lyr.refreshElevation();              // nach dem Laden der Geländekacheln (idle)
 *
 * Flüge (05.10.2026): `agl: [m…]` je Punkt = Höhe über Grund (statt des festen Versatzes), mit der
 * Gelände-Überhöhung multipliziert. `lot: true` = jeder Punkt wird eine senkrechte Linie vom Boden bis `agl`
 * (Vorhang zum Boden) statt einer verbundenen Spur.
 *
 * Nachglühen (06.11.2026, Komet): `zeiten: [s…]` je Punkt = Videosekunde, in der der Kopf ihn passiert;
 * `glut: { sek, stufen: [[u, "#rrggbb"], …] }` färbt nach dem ALTER (jetzt − Passage) / sek: u = 0 heiß … u = 1 die
 * eigene Farbe der Spur. `halo: { stark }` = dieselbe Spur als weicher, additiver Lichthof, der mit dem Alter verlischt.
 * Die Zeit „jetzt“ liefert `opts.jetzt()` (Videozeit) — Vorschau, Sprung und Video zeigen dieselbe Glut.
 * `kopf: { faktor, sek, farbe, farbSek }` (Komet): die Spur weitet sich zum Kopf auf und endet am Kopfrand
 * (`opts.kopfLuecke()`); mit `farbe` beginnt sie in der Farbe des Kopfs und geht über `farbSek` Sekunden in die Glut über.
 * `kopfAus: k` (08.11.2026, Bodenschatten): unter dem Kopf ganz aussparen, egal wie alt — Radius k × `opts.kopfOrt().schnittM`.
 * `opts.kopfOrt().pfeil = { dreh, groesseM }` (09.11.2026): beim Pfeil-Kopf die Spur in seinem Umriss aussparen, egal wie
 *   alt — die Röhre tritt an der Kerbe aus und läuft nie sichtbar durch den Pfeil. `kopfOrtAn: true` holt `opts.kopfOrt()`
 *   auch für Spuren ohne `kopf` (Röhre ohne Nachglühen); sonst nur mit `kopf`.
 * `opts.nachAufbau()` (08.11.2026): wird gerufen, nachdem die Spur beim Zoomen/Nachladen des Geländes ihre Höhen neu
 * gerechnet hat — wer etwas auf die Spur setzt (3D-Kopf), setzt es danach neu (nicht mitten im Zeichnen: per setTimeout).
 *
 * Der Vertex-Shader rechnet in Bildkoordinaten (Breite bleibt beim Zoomen
 * konstant), das Abstandsfeld im Fragment-Shader liefert Kappen und Kanten mit
 * Antialiasing. Varyings werden mit w multipliziert, damit sie bildlinear
 * (nicht perspektivisch) interpoliert werden.
 */
(function () {
  "use strict";

  // Vertex-Shader-Rumpf. Davor kommen MapLibres `shaderData.define` und
  // `vertexShaderPrelude` (Globus: projectToSphere/interpolateProjection, dazu die
  // u_projection_*-Uniforms). Ohne Prelude (ältere API) deklarieren wir die Matrix selbst.
  const VS_BODY = `
in vec3 a_pos;       // Merkator xyz dieses Endpunkts (z in Merkator-Einheiten)
in vec3 a_other;     // Merkator xyz des anderen Endpunkts
in float a_elev;     // Höhe dieses Endpunkts in Metern (Globus)
in float a_elevOther;
in float a_side;     // -1 / +1
in float a_end;      // 0 = Segmentanfang, 1 = Segmentende
in float a_dist;     // Merkator-Strecke bis zum Segmentanfang (Strichelung)
in vec4 a_color;     // Farbe dieses Endpunkts (premultiplied im Fragment)
in float a_zeit;     // 06.11.2026 Nachglühen: Videosekunde, in der der Kopf diesen Punkt passiert
uniform vec2 u_res;     // Bildpunkte (Breite, Höhe)
uniform float u_halfw;  // halbe Linienbreite in Bildpunkten
uniform float u_pxPerMerc;   // Bildpunkte je Merkator-Einheit (Strichelung)
uniform float u_pxPerMercRef; // dito zur Zeit des Aufbaus (Bezug für die Strichlänge)
uniform vec2 u_translate;    // Versatz in Gerätepixeln (Schlagschatten)
uniform float u_breiteM;     // 02.11.2026 Röhre: Breite in Metern (0 = Breite in Bildpunkten, u_halfw)
uniform float u_jetzt;       // Videozeit (s) — auch hier: Aufweiten zum Kopf
uniform vec2 u_kopf;         // 06.11.2026 Komet: (Faktor der Breite direkt am Kopf, Sekunden bis zur normalen Breite); x<=1 = aus
uniform float u_tiefeHebM;   // 06.11.2026 Tiefe so vergleichen, als läge die Spur so viele Meter höher (gezeichnet am echten Ort)
uniform vec3 u_kopfOrt;      // 08.11.2026 Kopf (Merkator x, y) und Radius (Merkator) — im Umkreis keine Tiefen-Anhebung; z<=0 = aus
uniform float u_kopfSchnittR; // 08.11.2026 Radius (Merkator), in dem ältere Stücke unter dem Kopf ausgespart werden; 0 = aus
uniform vec4 u_kopfPfeil;   // 09.11.2026 Pfeil-Kopf: (Fahrtrichtung Merkator x, y, Größe in Merkator, an > 0)
out vec3 v_lw;          // (entlang, quer, Segmentlänge) × w
out float v_w;
out float v_hw;         // halbe Breite in Bildpunkten × w (je Endpunkt: bei Metern perspektivisch verschieden)
out float v_licht;      // Lichtseite: Bildrichtung der Querachse gegen das Licht von oben links (−1…1)
out float v_dist;       // Bildpunkte bis zum Segmentanfang × w
out vec4 v_color;
out float v_zeit;
out float v_kopf;       // 06.11.2026 Komet: Nähe zum Kopf 0…1 (1 = direkt am Kopf)
out vec2 v_kopfRel;     // 08.11.2026 Lage zum Kopf in Schnitt-Radien (Mittellinie)
out vec2 v_pfeilLok;    // 09.11.2026 Lage zum Pfeil-Kopf in Pfeilgrößen: (quer, vorwärts) — Mittellinie
vec4 rzProject(vec3 posMerc, float elevM) {
#ifdef GLOBE
  // Custom Layer: „Kachel" = ganze Welt (u_projection_tile_mercator_coords = 0,0,1,1)
  vec2 posInTile = posMerc.xy;
  vec3 sphere = projectToSphere(posInTile);
  return interpolateProjection(posInTile, sphere, elevM);
#else
  return u_projection_matrix * vec4(posMerc, 1.0);
#endif
}
void main() {
  vec4 p = rzProject(a_pos, a_elev);
  vec4 q = rzProject(a_other, a_elevOther);
  vec2 sp = p.xy / p.w * u_res * 0.5;
  vec2 sq = q.xy / q.w * u_res * 0.5;
  vec2 dd = sq - sp;
  float L = length(dd);
  vec2 d = (L > 0.0001) ? dd / L : vec2(1.0, 0.0);
  vec2 n = vec2(-d.y, d.x);
  // 02.11.2026 Röhre — Breite in Metern: quer zur Spur um die halbe Breite versetzt projizieren, Abstand im Bild
  // messen; die Mindestbreite (u_halfw) gilt weiter, damit die Röhre aus der Ferne nicht verschwindet.
  float halfw = u_halfw;
  if (u_breiteM > 0.0) {
    vec2 dm = a_other.xy - a_pos.xy;
    float lm = length(dm);
    vec2 nm = (lm > 1e-12) ? vec2(-dm.y, dm.x) / lm : vec2(0.0, 1.0);
    float meterMerc = cosh(3.14159265 * (1.0 - 2.0 * a_pos.y)) / 40075016.686;
    vec4 pq = rzProject(a_pos + vec3(nm * (0.5 * u_breiteM * meterMerc), 0.0), a_elev);
    halfw = max(u_halfw, length(pq.xy / pq.w * u_res * 0.5 - sp));
  }
  // Komet: der Schweif kommt aus dem Kopf — in den letzten Zehntelsekunden vor dem Kopf weitet sich die Spur bis fast
  // auf Kopfgröße (nach Alter, wie die Glut: gleich bei jeder Bildrate)
  float kKopf = 0.0;
  if (u_kopf.x > 1.0 && u_kopf.y > 0.0) {
    float alt = max(0.0, u_jetzt - a_zeit);
    kKopf = 1.0 - smoothstep(0.0, u_kopf.y, alt);
    halfw *= 1.0 + (u_kopf.x - 1.0) * kKopf * kKopf;
  }
  v_kopf = kKopf;
  // Kappe: um halfw über den Endpunkt hinaus, weg vom anderen Ende
  vec2 sp2 = sp + n * a_side * halfw - d * halfw + vec2(u_translate.x, -u_translate.y);
  // 06.11.2026 (Komet-Flimmern, Teide: an festen Kamerastellen verschwand die ganze Röhre für ein Bild) — beim Nachladen
  // zeichnet MapLibre das Gelände kurz mit gröberen Kacheln, deren Netz am Hang höher liegt als die Röhre über dem
  // Boden schwebt. Die Tiefe wird deshalb wie für einen um u_tiefeHebM höheren Punkt verglichen: Netz-Ungenauigkeiten
  // verdecken nicht mehr, ein echter Grat dahinter weiter schon.
  float zNdc = p.z / p.w;
  // am Kopf echte Tiefe: dort muss die Kugel das Stück hinter ihr verdecken (der Ausgleich hebt nach oben = zur Kamera)
  // 08.11.2026 (Marc, Schorfheide s 12: „die Röhre scheint durch den Pfeil durch“) — die Anhebung wuchs schon ab dem
  // Kopf über u_kopf.y Sekunden an; bei ~1 km/s Videotempo war das Stück direkt hinter dem Pfeil schon um Meter angehoben
  // und gewann den Tiefentest gegen ihn, sobald der Pfeil zur Kamera zeigte. Jetzt: u_kopfFrei Sekunden (≈ 4 Kopflängen)
  // ohne Anhebung. Gemessen: es war ein ÄLTERES Stück derselben Strecke (Hin- und Rückweg auf demselben Weg), voll
  // angehoben — eine Zeitgrenze hilft da nicht. Darum räumlich: im Umkreis u_kopfOrt.z um den Kopf echte Tiefe für jedes
  // Stück, egal wie alt; bis zum doppelten Radius blendet die Anhebung ein.
  // 09.11.2026 (Marc, Teide: „die Röhre ist manchmal kurz unterbrochen im Nachglühbereich“) — die Anhebung fehlte hier
  // auch zeitlich: u_kopf.y Sekunden hinter dem Kopf (0,25 s) — bei 1,7 km je Videosekunde rund 400 m Röhre ohne Ausgleich,
  // feinere Geländekacheln schnitten Stücke heraus. Die Kopf-Zone ist seit 08.11. räumlich (u_kopfOrt.z), das reicht.
  float hebT = u_tiefeHebM;
  // 09.11.2026 (Teide) — statt fester Zone (3–6 Kopfgrößen ganz ohne Ausgleich: dort schnitt feineres Gelände Lücken) wächst
  // die Anhebung mit dem Abstand zum Kopf: halb so viele Meter wie Abstand. Vor den Kopf kommt ein Stück nur, wenn es um mehr
  // angehoben ist als Abstand × tan(Blickhöhe) — bei ≤ 63° Blickhöhe nie; steiler deckt der Kopf nur, was direkt unter ihm
  // liegt, und das spart der Pfeil-Umriss ohnehin aus.
  float mz = cosh(3.14159265 * (1.0 - 2.0 * a_pos.y)) / 40075016.686;
  if (u_kopfOrt.z > 0.0) hebT = min(hebT, 0.5 * distance(a_pos.xy, u_kopfOrt.xy) / mz);
  if (hebT > 0.0) {
    vec4 ph = rzProject(a_pos + vec3(0.0, 0.0, hebT * mz), a_elev + hebT);
    zNdc = clamp(ph.z / ph.w, -1.0, 1.0);
  }
  gl_Position = vec4(sp2 / (u_res * 0.5) * p.w, zNdc * p.w, p.w);
  float along = (a_end < 0.5) ? -halfw : (L + halfw);
  // 05.10.2026 (Klicktest „Flug in der Luft“: Punkt mit eingedellter Oberkante) — am Segmentende ist d gespiegelt,
  // damit auch die Normale: dort liegt Seite +1 geometrisch auf der −1-Seite des Anfangs. Der Querwert muss der
  // GEOMETRIE folgen (sonst passt er nicht zum Anfang), und die Dreiecke laufen v0 → v1 → v3 → v2 (siehe idx).
  float quer = (a_end < 0.5) ? a_side : -a_side;
  v_lw = vec3(along, quer * halfw, L) * p.w;
  v_w = p.w;
  v_hw = halfw * p.w;
  // Querachse zeigt im Bild in Richtung n des Segmentanfangs (am Ende ist n gespiegelt, quer auch)
  vec2 nAnf = (a_end < 0.5) ? n : -n;
  v_licht = dot(nAnf, normalize(vec2(-0.45, 1.0)));
  v_dist = a_dist * p.w;   // Merkator-Strecke bis zum Segmentanfang (× w)
  v_color = a_color;
  v_zeit = a_zeit;
  v_kopfRel = (u_kopfSchnittR > 0.0) ? (a_pos.xy - u_kopfOrt.xy) / u_kopfSchnittR : vec2(99.0);
  if (u_kopfPfeil.w > 0.0 && u_kopfPfeil.z > 0.0) {
    vec2 rp = (a_pos.xy - u_kopfOrt.xy) / u_kopfPfeil.z;
    v_pfeilLok = vec2(dot(rp, vec2(-u_kopfPfeil.y, u_kopfPfeil.x)), dot(rp, u_kopfPfeil.xy));
  } else v_pfeilLok = vec2(99.0);
}`;

  const FS = `#version 300 es
precision highp float;
in vec3 v_lw;
in float v_w;
in float v_dist;
in vec4 v_color;
in float v_hw;
in float v_licht;
in float v_zeit;
in float v_kopf;
in vec2 v_kopfRel;
in vec2 v_pfeilLok;
uniform vec4 u_kopfPfeil;
uniform float u_kopfAltSek; // 08.11.2026 Stücke älter als das (s) werden unter dem Kopf ausgespart; 0 = aus
uniform float u_kopfAus;    // 08.11.2026 > 0: unter dem Kopf ganz aussparen (jedes Alter), Radius = Wert × Schnittradius
uniform float u_luecke;    // 06.11.2026 Komet: so viele Sekunden vor dem Kopf endet die Spur (= Kugelradius / Tempo)
uniform vec4 u_kopfFarbe;  // 06.11.2026 Komet: rgb = Farbe des Kopfs, a = Sekunden, über die die Röhre ab dem Kopf in die Glut übergeht (0 = aus)
uniform vec4 u_color;      // Grundfarbe (× Vertexfarbe)
uniform float u_halfw;
uniform float u_roehre;    // 02.11.2026: 1 = als Röhre schattieren (Rundung, Licht von oben links, Glanzstreifen)
uniform float u_glanz;     // 0…1 Stärke des Glanzstreifens
uniform float u_featherRel; // weiche Kante zusätzlich als Anteil der halben Breite (Bodenschatten der Röhre)
uniform float u_feather;   // weiche Kante in Bildpunkten (Glow); 0.8 = normal
uniform vec2 u_dash;       // (Strich, Lücke) in Bildpunkten zur Bezugs-Zoomstufe; x<=0 = durchgezogen
uniform float u_pxPerMerc;
uniform float u_pxPerMercRef;
uniform float u_jetzt;     // 06.11.2026 Nachglühen: Videozeit jetzt (s)
uniform float u_glutSek;   // Dauer bis zur eigenen Farbe (s); 0 = aus
uniform int u_glutN;       // Zahl der heißen Stufen (≤ 5); danach bis u = 1 die eigene Farbe
uniform float u_glutU[5];
uniform vec3 u_glutF[5];
uniform float u_halo;      // > 0: Lichthof (additiv, verlischt mit dem Alter), Wert = Stärke
out vec4 fragColor;
vec3 rzGlut(float u, vec3 eigen) {
  vec3 vor = u_glutF[0]; float uv = u_glutU[0];
  if (u <= uv) return vor;
  for (int k = 1; k < 5; k++) {
    if (k >= u_glutN) break;
    if (u <= u_glutU[k]) return mix(vor, u_glutF[k], (u - uv) / max(1e-4, u_glutU[k] - uv));
    vor = u_glutF[k]; uv = u_glutU[k];
  }
  return mix(vor, eigen, smoothstep(0.0, 1.0, clamp((u - uv) / max(1e-4, 1.0 - uv), 0.0, 1.0)));
}
void main() {
  vec3 lw = v_lw / v_w;
  float along = lw.x, across = lw.y, L = lw.z;
  float hw = max(0.5, v_hw / v_w);
  float dist;
  if (along < 0.0) dist = length(vec2(along, across));
  else if (along > L) dist = length(vec2(along - L, across));
  else dist = abs(across);
  float f = max(0.3, u_feather + u_featherRel * hw);
  float a = 1.0 - smoothstep(hw - f, hw + 0.6, dist);
  if (u_dash.x > 0.0) {
    // Strichelung entlang der ECHTEN Linie, am BODEN verankert (Merkator-Strecke):
    // beim Zoomen atmet das Muster, es wandert nicht (weder je Kachel noch vom
    // Linienanfang her). Bezugsgröße = Strichlänge zur Zoomstufe des Aufbaus.
    float dMerc = v_dist / v_w + clamp(along, 0.0, L) / u_pxPerMerc;
    float dashM = u_dash.x / u_pxPerMercRef, gapM = u_dash.y / u_pxPerMercRef;
    float period = dashM + gapM;
    float m = mod(dMerc, period);
    float edge = min(m, dashM - m) * u_pxPerMerc;   // Abstand zur Strichkante in Bildpunkten (negativ = in der Lücke)
    edge += hw;                                      // runde Kappen: Strich wächst um halfw je Ende
    a *= smoothstep(-0.7, 0.7, edge);
  }
  vec4 c = u_color * v_color;
  float hitze = 0.0;
  float kopfK = 0.0;   // 1 = direkt am Kopf: Kopffarbe, ungeschattet (der Kopf ist unbeleuchtet)
  if (u_glutSek > 0.0 && u_glutN > 0) {
    if (v_zeit > u_jetzt) discard;   // noch nicht erreicht: die Spur endet genau am Kopf (auch mitten im Segment)
    // Komet: am Kugelrand enden (kein Stiel bis zur Kugelmitte), das letzte Stück weich ausleuchten
    float ageK = u_jetzt - v_zeit;
    // 08.11.2026 (Marc, Schorfheide s 11: „die Röhre ist immer noch im Pfeil zu sehen“) — auf Hin-und-zurück-Wegen fährt
    // der Kopf durch die Röhre des Hinwegs, gleiche Höhe, etwa so dick wie der flache Pfeil → sie ragte oben heraus. Ältere
    // Stücke werden direkt unter dem Kopf ausgespart (weicher Rand); das frische Stück hinter dem Kopf bleibt.
    if (u_kopfAltSek > 0.0 && ageK > u_kopfAltSek) {
      float dk = length(v_kopfRel);
      if (dk < 0.8) discard;
      a *= smoothstep(0.8, 1.0, dk);
    }
    if (u_luecke > 0.0) {
      if (ageK < u_luecke * 0.8) discard;
      a *= smoothstep(u_luecke * 0.8, u_luecke * 1.6, ageK);
    }
    float u = max(0.0, (u_jetzt - v_zeit) / u_glutSek);
    hitze = pow(clamp(1.0 - u, 0.0, 1.0), 1.6);
    c.rgb = rzGlut(u, c.rgb);
    // Marc 06.11.2026: „die Röhre muss am Anfang die gleiche Farbe haben wie der Pfeil oder die Kugel“ — sonst steckt
    // ein andersfarbiges Röhrenende sichtbar im Kopf. Ab der Kerbe/dem Kugelrand erst Kopffarbe, dann weich in die Glut.
    if (u_kopfFarbe.a > 0.0) {
      kopfK = 1.0 - smoothstep(u_luecke * 0.8, u_luecke * 0.8 + u_kopfFarbe.a, ageK);
      c.rgb = mix(c.rgb, u_kopfFarbe.rgb, kopfK);
    }
  }
  if (u_halo > 0.0) {
    // Lichthof: weicher Saum um die Mitte der Spur (Gauß quer), additiv, verlischt mit dem Alter. Ohne runde Enden —
    // die überlappten an jedem Gelenk und zählten dort doppelt (helle, wandernde Flecken).
    if (along < 0.0 || along > L) discard;
    float q = abs(across) / max(0.5, hw);
    float h = exp(-2.6 * q * q) * hitze * u_halo * c.a;
    if (h <= 0.002) discard;
    fragColor = vec4(c.rgb * h, 0.0);   // additiv
    return;
  }
  // 08.11.2026 (Marc, Schorfheide s 21–22: „da flimmert der Pfeil“) — der Bodenschatten der Röhre endete in der Kopfmitte,
  // am Boden, also auf der Höhe der Pfeilmitte: an Spitze und Flügelkanten (dort ist der Pfeil dünn) stritten Schatten und
  // Pfeil um die Tiefe, graue Flecken blitzten auf. Unter dem Kopf liegt dessen eigener Schatten — hier weich ausblenden.
  if (u_kopfAus > 0.0) {
    float dS = length(v_kopfRel) / u_kopfAus;
    if (dS < 0.8) discard;
    a *= smoothstep(0.8, 1.0, dS);
  }
  // 09.11.2026 (Marc, Teide: „man sieht die Röhre im Laufpfeil drin“) — der Pfeil zeigt geglättet in Fahrtrichtung, der
  // GPS-Weg dahinter schlängelt sich; die frische Röhre lief quer durch den flachen Pfeil und ragte oben heraus. Im Umriss
  // des Pfeils (Spitze 0,75 · Flügel ±0,54/−0,75 · Kerbe −0,36, in Pfeilgrößen, plus Fase) ist keine Röhre, egal wie alt.
  // An der Kerbe nur die Fase als Rand: dort tritt die Röhre aus (sie endet 0,5 hinter der Mitte, u_luecke).
  if (u_kopfPfeil.w > 0.0) {
    float ps = abs(v_pfeilLok.x), py = v_pfeilLok.y;
    float d1 = dot(vec2(ps, py - 0.75), vec2(0.9409, 0.3387)) - 0.16;      // Flanke Spitze → Flügel, nach außen
    float d2 = dot(vec2(ps, py + 0.36), vec2(-0.5855, -0.8107)) - 0.04;    // Kante Flügel → Kerbe, nach außen
    float dp = max(max(d1, d2), py - 0.87);                                // vor der Spitze nur knapp
    if (dp < 0.0) discard;
    a *= smoothstep(0.0, 0.04, dp);
  }
  if (a <= 0.002) discard;
  if (v_kopf > 0.0) a *= mix(1.0, exp(-1.6 * (dist / max(0.5, hw)) * (dist / max(0.5, hw))) * 1.25, v_kopf * 0.8);
  if (u_roehre > 0.5) {
    // Querschnitt eines Zylinders: t = Lage quer (−1…1), nz = Normale zum Betrachter. In den runden Kappen der
    // Abstand zur Achse, damit Enden und Knicke wie Kugelhälften wirken.
    // auch in den runden Kappen quer schattieren: die Kappen liegen an jedem Knick über dem Nachbarstück — als
    // Kugelhälften wirkte die Röhre wie eine Perlenkette
    float t = clamp(across / hw, -1.0, 1.0);
    float nz = sqrt(max(0.0, 1.0 - t * t));
    float s = clamp(v_licht, -1.0, 1.0);
    // Richtungsanteil klein halten: er wechselt mit jedem Segment (Zickzack-Spuren wirkten sonst streifig)
    float diff = clamp(t * s * 0.30 + nz * 0.85, 0.0, 1.0);
    vec3 farbe = c.rgb * (0.38 + 0.72 * diff);
    // frisch gelegte Röhre leuchtet selbst: weniger Schatten, Mitte heller
    farbe = mix(farbe, c.rgb * (0.70 + 0.30 * nz), hitze * 0.6);
    float tH = s * 0.22;
    float spec = exp(-pow((t - tH) / 0.22, 2.0)) * u_glanz * nz;
    farbe = mix(farbe, c.rgb, kopfK);
    c.rgb = min(vec3(1.0), farbe + vec3(1.0) * spec * 0.80 * (1.0 - kopfK));
  }
  fragColor = vec4(c.rgb, c.a * a);
  fragColor.rgb *= fragColor.a;   // premultiplied (MapLibre-Blend)
}`;

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error("rz-line3d Shader: " + gl.getShaderInfoLog(s));
    return s;
  }

  function hexToRgba(hex, opacity) {
    let h = String(hex || "#ff0000").trim();
    if (h[0] === "#") h = h.slice(1);
    if (h.length === 3) h = h.split("").map(c => c + c).join("");
    const n = parseInt(h.slice(0, 6), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, opacity == null ? 1 : opacity];
  }

  /** Nachglühen normalisieren: { sek, stufen: [[u, farbe], …] } → Felder für die Uniforms (höchstens 5 heiße Stufen). */
  function _glutNorm(g) {
    if (!g || !(+g.sek > 0) || !Array.isArray(g.stufen) || !g.stufen.length) return null;
    const st = g.stufen.slice(0, 5).map(x => [Math.max(0, Math.min(1, +x[0] || 0)), hexToRgba(x[1], 1)])
      .sort((x, y) => x[0] - y[0]);
    const u = st.map(x => x[0]), uPad = new Float32Array(5), fPad = new Float32Array(15);
    st.forEach((x, k) => { uPad[k] = x[0]; fPad[3 * k] = x[1][0]; fPad[3 * k + 1] = x[1][1]; fPad[3 * k + 2] = x[1][2]; });
    return { sek: +g.sek, u, uPad, fPad };
  }

  const LOT_MIN_PX = 6;   // Mindestabstand der Lotlinien in Gerätepixeln (siehe _lotSchritt)
  function create(id, opts) {
    opts = opts || {};
    const offsetM = (opts.offsetM != null) ? opts.offsetM : 150;
    const layer = {
      id, type: "custom", renderingMode: "3d",
      _map: null, _gl: null, _prog: null, _tracks: [], _counts: null, _bufs: [],
      _depth: opts.depth !== false,
      onAdd(map, gl) {
        this._map = map; this._gl = gl;
        // 06.10.2026 (Klicktest, 4K-Export „Flug in der Luft“ ohne Linie): Höhen wurden nur je ganzer Zoomstufe
        // abgefragt. Fährt die Kamera (Anflug) auf eine neue Stufe, bevor deren Geländekacheln da sind, kam 0 m
        // zurück — die Linie lag unter dem Berg und blieb dort. Jetzt: jede neu geladene Geländekachel macht die
        // Höhen ungültig, der nächste Zeichenlauf fragt neu (höchstens alle 200 ms).
        this._demNeu = (e) => {
          try {
            const tr = map.getTerrain && map.getTerrain();
            if (tr && e && e.sourceId === tr.source && e.tile) { this._elevDirty = true; map.triggerRepaint(); }
          } catch (_) {}
        };
        try { map.on("sourcedata", this._demNeu); } catch (_) {}
        if (this._tracks.length) this._rebuild();
      },
      _compile(gl, sd) {
        const define = sd ? String(sd.define || "") : "";
        const prelude = sd ? String(sd.vertexShaderPrelude || "") : "uniform mat4 u_projection_matrix;\n";
        const src = "#version 300 es\nprecision highp float;\n" + define + "\n" + prelude + "\n" + VS_BODY;
        const vs = compile(gl, gl.VERTEX_SHADER, src), fs = compile(gl, gl.FRAGMENT_SHADER, FS);
        const p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("rz-line3d Link: " + gl.getProgramInfoLog(p));
        if (this._prog) { try { gl.deleteProgram(this._prog); } catch (_) {} }
        this._prog = p; this._define = define;
        const U = (n) => gl.getUniformLocation(p, n);
        this._loc = { pos: gl.getAttribLocation(p, "a_pos"), other: gl.getAttribLocation(p, "a_other"),
                      elev: gl.getAttribLocation(p, "a_elev"), elevOther: gl.getAttribLocation(p, "a_elevOther"),
                      side: gl.getAttribLocation(p, "a_side"), end: gl.getAttribLocation(p, "a_end"),
                      dist: gl.getAttribLocation(p, "a_dist"), color: gl.getAttribLocation(p, "a_color"),
                      matrix: U("u_projection_matrix"), fallback: U("u_projection_fallback_matrix"),
                      tileMerc: U("u_projection_tile_mercator_coords"), clip: U("u_projection_clipping_plane"),
                      transition: U("u_projection_transition"),
                      res: U("u_res"), halfw: U("u_halfw"), ucolor: U("u_color"),
                      feather: U("u_feather"), dash: U("u_dash"), pxPerMerc: U("u_pxPerMerc"), pxPerMercRef: U("u_pxPerMercRef"), translate: U("u_translate"),
                      breiteM: U("u_breiteM"), tiefeHebM: U("u_tiefeHebM"), kopfOrt: U("u_kopfOrt"), kopfPfeil: U("u_kopfPfeil"), kopfSchnittR: U("u_kopfSchnittR"), kopfAltSek: U("u_kopfAltSek"), kopfAus: U("u_kopfAus"), kopf: U("u_kopf"), luecke: U("u_luecke"), roehre: U("u_roehre"), glanz: U("u_glanz"), featherRel: U("u_featherRel"),
                      zeit: gl.getAttribLocation(p, "a_zeit"), jetzt: U("u_jetzt"), glutSek: U("u_glutSek"), glutN: U("u_glutN"),
                      glutU: U("u_glutU[0]") || U("u_glutU"), glutF: U("u_glutF[0]") || U("u_glutF"), halo: U("u_halo"), kopfFarbe: U("u_kopfFarbe") };
      },
      onRemove(map, gl) {
        try { if (this._demNeu) map.off("sourcedata", this._demNeu); } catch (_) {}
        for (const b of this._bufs) { try { gl.deleteBuffer(b.vbo); gl.deleteBuffer(b.ibo); } catch (_) {} }
        this._bufs = [];
      },
      /** Spuren setzen: [{coords:[[lng,lat],…], color, width(px), opacity, roehre {glanz}, breiteM, hebMinPx, featherRel,
       *    colors: [[r,g,b,a]…] je Punkt (optional, 0..1),
       *    segColors: [[[r,g,b,a] Anfang, [r,g,b,a] Ende]…] je Segment (optional, Vorrang vor colors — harte
       *    Farbwechsel an einem Punkt ohne Zusatzpunkte, 15.10.2026 Fluglinie wie die Bodenlinie), dash: [strich, lücke] in
       *    Linienbreiten (optional), feather: px (optional, Glow)}] */
      setTracks(tracks) {
        this._tracks = (tracks || []).map(t => ({
          coords: t.coords || [], color: hexToRgba(t.color, t.opacity), width: (t.width != null ? +t.width : 4),
          colors: t.colors || null, segColors: t.segColors || null, dash: (t.dash && t.dash.length >= 2) ? [+t.dash[0], +t.dash[1]] : null,
          feather: (t.feather != null) ? +t.feather : 0.8,
          translate: (t.translate && t.translate.length >= 2) ? [+t.translate[0], +t.translate[1]] : [0, 0],
          offsetM: (t.offsetM != null) ? +t.offsetM : null,
          agl: Array.isArray(t.agl) || ArrayBuffer.isView(t.agl) ? t.agl : null, lot: !!t.lot,
          smooth: t.smooth,
          // 02.11.2026 Röhre: roehre {glanz 0…1}; breiteM = Breite in Metern (width bleibt Mindestbreite in px);
          // hebMinPx = Mindesthöhe über dem Boden in Bildpunkten (gegen das grobe Geländenetz); featherRel = weiche Kante
          // als Anteil der halben Breite (Bodenschatten)
          roehre: t.roehre ? { glanz: Math.max(0, Math.min(1, t.roehre.glanz != null ? +t.roehre.glanz : 0.5)) } : null,
          breiteM: (t.breiteM != null && +t.breiteM > 0) ? +t.breiteM : 0,
          hebMinPx: (t.hebMinPx != null) ? +t.hebMinPx : 0,
          featherRel: (t.featherRel != null) ? +t.featherRel : 0,
          zeiten: (Array.isArray(t.zeiten) || ArrayBuffer.isView(t.zeiten)) ? t.zeiten : null,
          glut: _glutNorm(t.glut),
          halo: (t.halo && +t.halo.stark > 0) ? { stark: +t.halo.stark } : null,
          tiefeHebM: (t.tiefeHebM != null && +t.tiefeHebM > 0) ? +t.tiefeHebM : 0,
          kopf: (t.kopf && +t.kopf.faktor > 1 && +t.kopf.sek > 0) ? [+t.kopf.faktor, +t.kopf.sek] : null,
          // Kopffarbe am Röhrenanfang: kopf.farbe "#rrggbb", kopf.farbSek = Übergang in die Glut (s)
          kopfFarbe: (t.kopf && t.kopf.farbe && +t.kopf.farbSek > 0) ? [...hexToRgba(t.kopf.farbe, 1).slice(0, 3), +t.kopf.farbSek] : null,
          kopfAus: (t.kopfAus != null && +t.kopfAus > 0) ? +t.kopfAus : 0,
          // 09.11.2026 — Kopf-Ort (Tiefe, Aussparung, Pfeil-Umriss) auch ohne Komet/Nachglühen
          kopfOrtAn: t.kopfOrtAn === true,
        }));
        this._counts = null;
        if (this._gl) this._rebuild();
        try { this._map && this._map.triggerRepaint(); } catch (_) {}
      },
      /** Wachstum: je Spur die Zahl gezeichneter Segmente ab dem Anfang; null = alles. */
      setCounts(counts) {
        this._counts = counts ? counts.slice() : null; this._ranges = null;
        try { this._map && this._map.triggerRepaint(); } catch (_) {}
      },
      /** Bereich je Spur: [[startIdx, endIdx]] (Punktindizes, inkl.); null = alles. */
      setRanges(ranges) {
        this._ranges = ranges ? ranges.map(r => r ? [r[0] | 0, r[1] | 0] : null) : null; this._counts = null;
        try { this._map && this._map.triggerRepaint(); } catch (_) {}
      },
      /** Geländehöhen neu abfragen (nach dem Laden der DEM-Kacheln). */
      refreshElevation() { if (this._gl) this._rebuild(); try { this._map && this._map.triggerRepaint(); } catch (_) {} },
      _elev(lng, lat, ersatz) {
        try {
          const m = this._map;
          if (m && m.getTerrain && m.getTerrain() && m.queryTerrainElevation) {
            const e = m.queryTerrainElevation({ lng, lat });
            if (typeof e === "number" && isFinite(e)) return e;
            // 06.11.2026 (Komet-Flimmern, Teide: in einzelnen Bildern verschwand die ganze Röhre im Berg) — beim Neuaufbau
            // während Geländekacheln nachladen lieferte die Abfrage für manche Punkte nichts → 0 m (Meereshöhe). Dann die
            // zuletzt bekannte Höhe dieses Punkts behalten.
            if (ersatz != null && isFinite(ersatz)) return ersatz;
          }
        } catch (_) {}
        return (ersatz != null && isFinite(ersatz)) ? ersatz : 0;
      },
      _ueberhoehung() {
        try { const tr = this._map && this._map.getTerrain && this._map.getTerrain(); return (tr && +tr.exaggeration) || 1; } catch (_) { return 1; }
      },
      _rebuild() {
        const gl = this._gl, MC = (window.maplibregl && window.maplibregl.MercatorCoordinate);
        if (!MC) return;
        const ex = this._ueberhoehung();
        // 06.10.2026 (Klicktest: Wanderung mit „Flug in der Luft“ — nach ⌘Z Lücken in der Linie): bodennahe Stücke
        // (Höhe über Grund ≈ 0) lagen genau in der Geländefläche und verschwanden je nach Kachelauflösung darin.
        // Mindesthöhe ≈ 3 Bildpunkte in Metern bei der aktuellen Zoomstufe (MapLibre: 512er Kacheln).
        let aglMin = 0, hebM = offsetM;
        try {
          const mp = this._map, br = mp.getCenter().lat;
          const mpp = 78271.517 * Math.cos(br * Math.PI / 180) / Math.pow(2, mp.getZoom());   // Meter je Bildpunkt
          aglMin = 3 * mpp;
          // 12.10.2026 (Nutzerfrage: Straightline-Challenge, Mehrtouren mit Gelände — „alle anderen Tracks haben einen Offset
          // und hängen in der Luft“): der feste Versatz von 150 m gegen das Flimmern im groben Geländenetz war aus der Ferne
          // unsichtbar (Zoom 10: ~1,5 Bildpunkte), in der Nähe aber eine schwebende Linie (Zoom 16: ~100 Bildpunkte). Jetzt
          // höchstens ~8 Bildpunkte in Metern, nie mehr als bisher; die Höhen werden je ganzer Zoomstufe neu gerechnet.
          if (offsetM > 0 && opts.offsetPx !== 0) hebM = Math.min(offsetM, (opts.offsetPx || 8) * mpp);
        } catch (_) {}
        const hebF = offsetM > 0 ? hebM / offsetM : 1;   // je Spur gesetzte Versätze (z. B. 150,5 für das Glanzlicht) gleich mitskalieren
        this._hebM = hebM; this._aglMin = aglMin;   // Prüfstand
        for (const b of this._bufs) { try { gl.deleteBuffer(b.vbo); gl.deleteBuffer(b.ibo); } catch (_) {} }
        this._bufs = [];
        this._bodenProbe = [];   // Prüfstand: ~20 abgefragte Bodenhöhen der ersten Spur [lng, lat, m]
        for (const t of this._tracks) {
          const c = t.coords;
          let n = c.length;
          let merc = new Array(n);
          const probeAll = (t === this._tracks[0]) ? Math.max(1, Math.floor(n / 20)) : 0;
          if (!t._boden || t._boden.length !== n) t._boden = new Float64Array(n).fill(NaN);
          let bodenVor = NaN;
          for (let i = 0; i < n; i++) {
            // Ersatz: zuletzt bekannte Höhe dieses Punkts, sonst die des Vorgängers
            const boden = this._elev(c[i][0], c[i][1], isFinite(t._boden[i]) ? t._boden[i] : (isFinite(bodenVor) ? bodenVor : null));
            t._boden[i] = boden; bodenVor = boden;
            if (probeAll && i % probeAll === 0) this._bodenProbe.push([c[i][0], c[i][1], boden]);
            const h = t.agl ? boden + Math.max(t.lot ? 0 : aglMin, Math.max(0, +t.agl[i] || 0) * ex)
                            : boden + Math.max((t.offsetM != null) ? +t.offsetM * hebF : hebM, t.hebMinPx * aglMin / 3);
            const mc = MC.fromLngLat([c[i][0], c[i][1]], h);
            merc[i] = [mc.x, mc.y, mc.z, h];
            if (t.lot) {   // Lot: zusätzlich der Fußpunkt am Boden (leicht angehoben gegen Z-Fighting)
              const fb = MC.fromLngLat([c[i][0], c[i][1]], boden + 1);
              merc[i].fuss = [fb.x, fb.y, fb.z, boden + 1];
            }
          }
          if (t.lot) {
            // Je Punkt ein Segment Fuß → Spitze: als Folge [Fuß0, Spitze0, Fuß1, Spitze1, …], gezeichnet werden
            // nur die geraden Segmente (Fuß_i → Spitze_i), siehe `nurGerade` unten.
            const paar = [];
            for (let i = 0; i < n; i++) { paar.push(merc[i].fuss, merc[i]); }
            merc = paar; n = paar.length;
          }
          // Glättung wie die Kachel-Vereinfachung der drapierten Linie: gleitendes Mittel
          // über so viele Punkte, wie in ~1,5 Bildpunkte passen (Indizes bleiben 1:1,
          // der Laufpunkt trifft weiter seinen Index). Erster/letzter Punkt bleiben.
          if (n > 4 && t.smooth !== false && !t.lot) {
            let ppm = 512 * Math.pow(2, this._map.getZoom());
            try { const tr = this._map.transform; if (tr && tr.worldSize) ppm = tr.worldSize; } catch (_) {}
            let segPx = 0; for (let i = 1; i < n; i++) segPx += Math.hypot(merc[i][0] - merc[i - 1][0], merc[i][1] - merc[i - 1][1]);
            segPx = segPx / (n - 1) * ppm;
            const w = Math.max(0, Math.min(12, Math.round(3.0 / Math.max(1e-6, segPx))));
            if (w >= 1) {
              const sm = new Array(n);
              for (let i = 0; i < n; i++) {
                const a0 = Math.max(0, i - w), b0 = Math.min(n - 1, i + w);
                let x = 0, y = 0, z = 0, hh = 0, k = 0;
                for (let j = a0; j <= b0; j++) { x += merc[j][0]; y += merc[j][1]; z += merc[j][2]; hh += merc[j][3]; k++; }
                sm[i] = (i === 0 || i === n - 1) ? merc[i] : [x / k, y / k, z / k, hh / k];
              }
              for (let i = 0; i < n; i++) merc[i] = sm[i];
            }
          }
          const segsAlle = Math.max(0, n - 1);
          const nurGerade = t.lot;                     // Lot: nur Fuß_i → Spitze_i, nie Spitze_i → Fuß_i+1
          const segs = nurGerade ? Math.floor(n / 2) : segsAlle;
          const cum = new Float64Array(n);   // Merkator-Strecke (xy) bis Punkt i
          for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(merc[i][0] - merc[i - 1][0], merc[i][1] - merc[i - 1][1]);
          const colAt = (i) => (t.colors && t.colors[i]) ? t.colors[i] : [1, 1, 1, 1];
          // je Segment 4 Vertices × (3 pos + 3 other + elev + elevOther + side + end + dist + rgba + zeit) = 17 Floats
          const zt = (!t.lot && t.zeiten) ? t.zeiten : null;
          const verts = new Float32Array(segs * 4 * 17);
          const idx = new Uint32Array(segs * 6);
          for (let s = 0; s < segs; s++) {
            const q = nurGerade ? 2 * s : s;
            const a = merc[q], b = merc[q + 1];
            const sc = (!nurGerade && t.segColors) ? t.segColors[q] : null;
            const base = s * 68, d0 = cum[q], ca = sc ? sc[0] : colAt(q), cb = sc ? sc[1] : colAt(q + 1);
            const za = zt ? (+zt[q] || 0) : 0, zb = zt ? (+zt[q + 1] || 0) : 0;
            const put = (o, P, Q, side, end, col, z) => { verts.set([P[0], P[1], P[2], Q[0], Q[1], Q[2], P[3], Q[3], side, end, d0, col[0], col[1], col[2], col[3], z], base + o); };
            put(0, a, b, -1, 0, ca, za); put(17, a, b, 1, 0, ca, za); put(34, b, a, 1, 1, cb, zb); put(51, b, a, -1, 1, cb, zb);
            // Am Ende ist d gespiegelt, deshalb dort die Seite getauscht (siehe put oben) →
            // Vertex 2 liegt geometrisch auf derselben Seite wie Vertex 0.
            const v = s * 4, o = s * 6;
            // Umlauf v0 (Anfang −n) → v1 (Anfang +n) → v3 (Ende +n) → v2 (Ende −n). Vorher (v0,v1,v2)+(v0,v2,v3):
            // das Dreieck v1–v3–Mitte fehlte, jede Linie war auf einer Seite eingedellt (05.10.2026).
            idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 3;
            idx[o + 3] = v; idx[o + 4] = v + 3; idx[o + 5] = v + 2;
          }
          const vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
          const ibo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
          this._bufs.push({ vbo, ibo, segs, color: t.color, width: t.width, dash: t.dash, feather: t.feather, translate: t.translate,
                           roehre: t.roehre, breiteM: t.breiteM, featherRel: t.featherRel, glut: t.glut, halo: t.halo, tiefeHebM: t.tiefeHebM, kopf: t.kopf, kopfFarbe: t.kopfFarbe,
                           kopfAus: t.kopfAus, kopfOrtAn: t.kopfOrtAn, lotCoords: t.lot ? c : null, lotK: 1 });
        }
      },
      /** 15.10.2026 (Marc: „dass der Bogen zumindest in der Vorschau flimmert“ — im Video nicht) — die Lotlinien
       *  unter einer hohen Fluglinie stehen in der kleinen Vorschau dichter als ein Bildpunkt; fährt die Kamera, wandert
       *  ein Moiré durch den Vorhang. Jetzt wird nur jede k-te Linie gezeichnet (k = 1, 2, 4 …), so dass auf dem Bildschirm
       *  mindestens LOT_MIN_PX Gerätepixel zwischen zwei Linien liegen. Ausgerichtet am Punktindex (keine wandernden
       *  Linien beim Wachsen), mit Schwelle gegen Hin-und-her-Springen. Im 4K-Video bleibt k meist 1. */
      _lotSchritt(b, first, segs, pr) {
        const c = b.lotCoords, mp = this._map;
        if (!c || segs < 4 || !mp || typeof mp.project !== "function") return 1;
        const proben = [], schritt = Math.max(1, Math.floor((segs - 1) / 9));
        try {
          for (let s = first; s < first + segs - 1 && proben.length < 10; s += schritt) {
            const a = mp.project(c[s]), q = mp.project(c[s + 1]);
            proben.push(Math.hypot(q.x - a.x, q.y - a.y) * pr);
          }
        } catch (_) { return b.lotK || 1; }
        if (!proben.length) return 1;
        proben.sort((x, y) => x - y);
        const med = proben[proben.length >> 1];
        let k = 1; while (k < 64 && med * k < LOT_MIN_PX) k *= 2;
        const alt = b.lotK || 1;
        if (k < alt && med * (alt / 2) < LOT_MIN_PX * 1.3) k = alt;   // erst deutlich über der Schwelle wieder dichter
        b.lotK = k;
        return k;
      },
      render(gl, args) {
        if (!this._tracks.length) return;
        // Geländehöhen nachziehen: einmal, sobald die DEM-Quelle geladen ist, und bei
        // jeder ganzen Zoomstufe (andere DEM-Auflösung). Der Aufbau läuft vor dem Zeichnen.
        try {
          const mp = this._map, z = Math.floor(mp.getZoom());
          const tr = mp.getTerrain && mp.getTerrain();
          let ok = true;
          if (tr && tr.source && mp.isSourceLoaded) { try { ok = !!mp.isSourceLoaded(tr.source); } catch (_) { ok = true; } }
          const jetzt = (typeof performance !== "undefined") ? performance.now() : Date.now();
          const demFrisch = this._elevDirty && ok && !(jetzt - (this._elevZeit || 0) < 200);
          if (z !== this._lastZ || (ok && !this._elevOk) || !this._bufs.length || demFrisch) {
            this._lastZ = z; this._elevOk = ok; this._ppmRef = null; this._elevZeit = jetzt;
            if (ok) this._elevDirty = false;
            this._rebuild();
            if (typeof opts.nachAufbau === "function") {
              setTimeout(() => {
                try { opts.nachAufbau(); } catch (e) { if (typeof window.applog === "function") window.applog("warn", "[line3d] nachAufbau: " + e); }
              }, 0);
            }
          } else if (this._elevDirty && ok) { try { mp.triggerRepaint(); } catch (_) {} }   // nur die 200 ms abwarten; lädt noch etwas, meldet sich sourcedata
        } catch (_) {}
        if (!this._bufs.length) return;
        const m = (args && args.defaultProjectionData && args.defaultProjectionData.mainMatrix)
                  ? args.defaultProjectionData.mainMatrix : args;
        if (window.__rzLine3dDebug && !this._dbgOnce) { this._dbgOnce = true; try { const pd = args && args.defaultProjectionData; window.__rzLine3dArgs = { keys: args && Object.keys(args), pd: pd && Object.keys(pd), m: m && Array.from(m), fallback: pd && pd.fallbackMatrix && Array.from(pd.fallbackMatrix), tileMerc: pd && pd.tileMercatorCoords && Array.from(pd.tileMercatorCoords), transition: pd && pd.projectionTransition, clip: pd && pd.clippingPlane && Array.from(pd.clippingPlane), shaderData: args && args.shaderData ? { define: args.shaderData.define, prelude: String(args.shaderData.vertexShaderPrelude || '').slice(0, 3000) } : null, canvas: [gl.canvas.width, gl.canvas.height] }; } catch (e) { window.__rzLine3dArgs = { err: String(e) }; } }
        if (!m || m.length !== 16) return;
        const sd = args && args.shaderData;
        const define = sd ? String(sd.define || "") : "";
        if (!this._prog || this._define !== define) { try { this._compile(gl, sd); } catch (e) { console.warn(String(e)); return; } }
        const cv = gl.canvas, res = [cv.width, cv.height];
        const pr = (this._map && this._map.getPixelRatio) ? this._map.getPixelRatio() : (window.devicePixelRatio || 1);
        // 25.10.2026 — Linie zoomt mit (Animator „Mitzoomen“): Faktor zur Breite, wie die Zoom-Ausdrücke der flachen Ebenen
        let zf = 1; try { if (this._map && typeof this._map.__rzBreiteFaktor === "function") zf = +this._map.__rzBreiteFaktor() || 1; } catch (_) {}
        gl.useProgram(this._prog);
        gl.uniformMatrix4fv(this._loc.matrix, false, m);
        const pd = args && args.defaultProjectionData;
        if (pd) {
          if (this._loc.fallback && pd.fallbackMatrix) gl.uniformMatrix4fv(this._loc.fallback, false, pd.fallbackMatrix);
          if (this._loc.tileMerc && pd.tileMercatorCoords) gl.uniform4fv(this._loc.tileMerc, pd.tileMercatorCoords);
          if (this._loc.clip && pd.clippingPlane) gl.uniform4fv(this._loc.clip, pd.clippingPlane);
          if (this._loc.transition != null) gl.uniform1f(this._loc.transition, +pd.projectionTransition || 0);
        }
        gl.uniform2f(this._loc.res, res[0], res[1]);
        // Bildpunkte je Merkator-Einheit (Weltbreite in Gerätepixeln) — für die Strichelung
        let ppm = 512 * Math.pow(2, this._map.getZoom()) * pr;
        try { const t = this._map.transform; if (t && t.worldSize) ppm = t.worldSize * pr; } catch (_) {}
        if (this._loc.pxPerMerc) gl.uniform1f(this._loc.pxPerMerc, ppm);
        if (this._ppmRef == null) this._ppmRef = ppm;
        if (this._loc.pxPerMercRef) gl.uniform1f(this._loc.pxPerMercRef, this._ppmRef);
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        // Tiefe nur LESEN (gegen das Gelände). Schreiben ließe die überlappenden Segmente einer
        // Linie sich selbst zerschneiden (Flimmern, dünne Linie — gemessen 06.09.2026).
        if (this._depth) { gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(false); }
        else gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        const L = this._loc;
        let jetzt = 0;
        try { jetzt = typeof opts.jetzt === "function" ? (+opts.jetzt() || 0) : 0; } catch (_) { jetzt = 0; }
        this._jetzt = jetzt;   // Prüfstand
        for (let i = 0; i < this._bufs.length; i++) {
          const b = this._bufs[i];
          let segs = b.segs, first = 0;
          if (this._counts && this._counts[i] != null) segs = Math.max(0, Math.min(b.segs, Math.floor(this._counts[i])));
          if (this._ranges && this._ranges[i]) { const r = this._ranges[i]; first = Math.max(0, Math.min(b.segs, r[0])); segs = Math.max(0, Math.min(b.segs, r[1]) - first); }
          if (!segs) continue;
          gl.bindBuffer(gl.ARRAY_BUFFER, b.vbo);
          const ST = 68;
          gl.enableVertexAttribArray(L.pos); gl.vertexAttribPointer(L.pos, 3, gl.FLOAT, false, ST, 0);
          gl.enableVertexAttribArray(L.other); gl.vertexAttribPointer(L.other, 3, gl.FLOAT, false, ST, 12);
          if (L.elev >= 0) { gl.enableVertexAttribArray(L.elev); gl.vertexAttribPointer(L.elev, 1, gl.FLOAT, false, ST, 24); }
          if (L.elevOther >= 0) { gl.enableVertexAttribArray(L.elevOther); gl.vertexAttribPointer(L.elevOther, 1, gl.FLOAT, false, ST, 28); }
          gl.enableVertexAttribArray(L.side); gl.vertexAttribPointer(L.side, 1, gl.FLOAT, false, ST, 32);
          gl.enableVertexAttribArray(L.end); gl.vertexAttribPointer(L.end, 1, gl.FLOAT, false, ST, 36);
          if (L.dist >= 0) { gl.enableVertexAttribArray(L.dist); gl.vertexAttribPointer(L.dist, 1, gl.FLOAT, false, ST, 40); }
          if (L.color >= 0) { gl.enableVertexAttribArray(L.color); gl.vertexAttribPointer(L.color, 4, gl.FLOAT, false, ST, 44); }
          if (L.zeit >= 0) { gl.enableVertexAttribArray(L.zeit); gl.vertexAttribPointer(L.zeit, 1, gl.FLOAT, false, ST, 60); }
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.ibo);
          const halfw = Math.max(0.5, b.width * zf * pr * 0.5);
          gl.uniform1f(L.halfw, halfw);
          gl.uniform1f(L.feather, (b.feather != null ? b.feather : 0.8) * pr);
          if (L.translate) gl.uniform2f(L.translate, (b.translate ? b.translate[0] : 0) * pr, (b.translate ? b.translate[1] : 0) * pr);
          if (b.dash) gl.uniform2f(L.dash, b.dash[0] * b.width * zf * pr, b.dash[1] * b.width * zf * pr); else gl.uniform2f(L.dash, 0, 0);
          gl.uniform4f(L.ucolor, b.color[0], b.color[1], b.color[2], b.color[3]);
          if (L.breiteM) gl.uniform1f(L.breiteM, b.breiteM ? b.breiteM * zf : 0);
          if (L.roehre) gl.uniform1f(L.roehre, b.roehre ? 1 : 0);
          if (L.glanz) gl.uniform1f(L.glanz, b.roehre ? b.roehre.glanz : 0);
          if (L.featherRel) gl.uniform1f(L.featherRel, b.featherRel || 0);
          if (L.tiefeHebM) gl.uniform1f(L.tiefeHebM, b.tiefeHebM || 0);
          if (L.kopf) gl.uniform2f(L.kopf, b.kopf ? b.kopf[0] : 0, b.kopf ? b.kopf[1] : 0);
          let luecke = 0;
          if (b.kopf) { try { luecke = typeof opts.kopfLuecke === "function" ? (+opts.kopfLuecke() || 0) : 0; } catch (_) { luecke = 0; } }
          if (L.luecke) gl.uniform1f(L.luecke, luecke);
          // 08.11.2026 — um den Kopf keine Tiefen-Anhebung (opts.kopfOrt() = { lng, lat, rM })
          if (L.kopfOrt) {
            let ko = null;
            // 09.11.2026 (Teide ohne Nachglühen: Röhre im Pfeil) — nicht nur beim Komet-Kopf, sondern bei jedem 3D-Kopf
            if ((b.kopf || b.kopfOrtAn) && typeof opts.kopfOrt === "function") { try { ko = opts.kopfOrt(); } catch (_) { ko = null; } }
            const MCk = window.maplibregl && window.maplibregl.MercatorCoordinate;
            if (ko && +ko.rM > 0 && MCk) {
              const km = MCk.fromLngLat([+ko.lng, +ko.lat], 0), mu = km.meterInMercatorCoordinateUnits();
              gl.uniform3f(L.kopfOrt, km.x, km.y, +ko.rM * mu);
              const schnittR = +ko.schnittM > 0 ? +ko.schnittM * mu : 0;
              if (L.kopfSchnittR) gl.uniform1f(L.kopfSchnittR, schnittR);
              if (L.kopfAltSek) gl.uniform1f(L.kopfAltSek, schnittR > 0 && +ko.altSek > 0 ? +ko.altSek : 0);
              if (L.kopfAus) gl.uniform1f(L.kopfAus, schnittR > 0 ? (b.kopfAus || 0) : 0);
              // 09.11.2026 Pfeil-Kopf: Umriss aussparen (Richtung im Uhrzeigersinn ab Nord; Merkator-y zeigt nach Süden)
              const pf = ko.pfeil;
              if (L.kopfPfeil) {
                if (pf && +pf.groesseM > 0 && !b.kopfAus) {
                  const dr = (+pf.dreh || 0) * Math.PI / 180;
                  gl.uniform4f(L.kopfPfeil, Math.sin(dr), -Math.cos(dr), +pf.groesseM * mu, 1);
                  window.__rzKopfPfeil = { dreh: +pf.dreh || 0, groesseM: +pf.groesseM, lng: +ko.lng, lat: +ko.lat };   // Prüfstand
                } else gl.uniform4f(L.kopfPfeil, 0, 0, 0, 0);
              }
            } else {
              gl.uniform3f(L.kopfOrt, 0, 0, 0);
              if (L.kopfSchnittR) gl.uniform1f(L.kopfSchnittR, 0);
              if (L.kopfAus) gl.uniform1f(L.kopfAus, 0);
              if (L.kopfAltSek) gl.uniform1f(L.kopfAltSek, 0);
              if (L.kopfPfeil) gl.uniform4f(L.kopfPfeil, 0, 0, 0, 0);
            }
          }
          if (L.kopfFarbe) { const k = b.kopf && b.kopfFarbe; gl.uniform4f(L.kopfFarbe, k ? k[0] : 0, k ? k[1] : 0, k ? k[2] : 0, k ? k[3] : 0); }
          const g = b.glut;
          if (L.glutSek) gl.uniform1f(L.glutSek, g ? g.sek : 0);
          if (L.glutN) gl.uniform1i(L.glutN, g ? g.u.length : 0);
          if (g && L.glutU) gl.uniform1fv(L.glutU, g.uPad);
          if (g && L.glutF) gl.uniform3fv(L.glutF, g.fPad);
          if (L.jetzt) gl.uniform1f(L.jetzt, jetzt);
          if (L.halo) gl.uniform1f(L.halo, b.halo ? b.halo.stark : 0);
          const k = b.lotCoords ? this._lotSchritt(b, first, segs, pr) : 1;
          if (k <= 1) gl.drawElements(gl.TRIANGLES, segs * 6, gl.UNSIGNED_INT, first * 6 * 4);
          else for (let s = Math.ceil(first / k) * k; s < first + segs; s += k) gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_INT, s * 6 * 4);
        }
        gl.blendEquation(gl.FUNC_ADD);
        gl.disableVertexAttribArray(L.pos); gl.disableVertexAttribArray(L.other);
        if (L.elev >= 0) gl.disableVertexAttribArray(L.elev); if (L.elevOther >= 0) gl.disableVertexAttribArray(L.elevOther);
        if (L.dist >= 0) gl.disableVertexAttribArray(L.dist); if (L.color >= 0) gl.disableVertexAttribArray(L.color);
        if (L.zeit >= 0) gl.disableVertexAttribArray(L.zeit);
        gl.disableVertexAttribArray(L.side); gl.disableVertexAttribArray(L.end);
      },
    };
    return layer;
  }

  const api = { create, hexToRgba };
  if (typeof window !== "undefined") window.rzLine3d = api;
  if (typeof globalThis !== "undefined") globalThis.rzLine3d = api;
})();
