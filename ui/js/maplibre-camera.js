/* Reisezoom GPS Studio — Kamera-Adapter für MapLibre GL (04.09.2026)
 *
 * Mapbox GL hat die FreeCamera (Position im Mercator-Raum + Orientierung);
 * die „ruhige Kamera (3D)" des Animators fährt damit einen Pfad, der NICHT
 * am Gelände klebt. MapLibre kennt keine FreeCamera; seine eigene Rechnung
 * (`calculateCameraOptionsFromCameraLngLatAltRotation`) liefert unter der
 * Weltkugel-Projektion NaN (kein pixelPerMeter im Globe-Transform). Deshalb
 * hier die Umrechnung selbst, rein aus center/zoom/pitch/bearing/elevation —
 * projektionsunabhängig, Mercator-Mathematik wie in MapLibre (tileSize 512).
 *
 * Wird ZWEIMAL geladen: in ui/index.html (Vorschau) und inline im Render-HTML
 * (core/animator.py liest diese Datei). Keine Abhängigkeiten außer maplibregl.
 *
 *   rzMlCamRead(map)            → { pos:[x,y,z] (Mercator), bp:[bearing, pitch] }
 *   rzMlCamApply(map, pos, bp)  → jumpTo(center, zoom, bearing, pitch, elevation)
 */
(function () {
  const R = 6378137.0;
  const D2R = Math.PI / 180;
  function circ(lat) { return 2 * Math.PI * R * Math.cos(lat * D2R); }
  function mercZfromAlt(altM, lat) { return altM / circ(lat); }          // Meter → Mercator-Einheiten
  function lngX(lng) { return (180 + lng) / 360; }
  function latY(lat) { return (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))) / 360; }
  function xLng(x) { return x * 360 - 180; }
  function yLat(y) { const y2 = 180 - y * 360; return 360 / Math.PI * Math.atan(Math.exp(y2 * Math.PI / 180)) - 90; }
  function ctcdPx(map) {                                               // Kamera→Mitte in Pixeln (Frustum)
    const tr = map.transform;
    const v = tr && tr.cameraToCenterDistance;
    if (isFinite(v) && v > 0) return v;
    const h = (tr && tr.height) || map.getCanvas().clientHeight || 900;
    const fov = ((tr && isFinite(tr.fov) ? tr.fov : 36.87) * D2R);
    return 0.5 / Math.tan(fov / 2) * h;
  }
  function centerElev(map) {
    try { const e = map.getCenterElevation ? map.getCenterElevation() : (map.transform && map.transform.elevation); return isFinite(e) ? e : 0; } catch (_) { return 0; }
  }
  function terrainAt(map, lngLat, fallback) {
    try { if (map.getTerrain && map.getTerrain()) { const e = map.queryTerrainElevation(lngLat); if (e != null && isFinite(e)) return e; } } catch (_) {}
    return fallback;
  }
  // elevOpt (Meter, optional): bekannte Geländehöhe unter der Bildmitte. Ohne sie
  // wird das Gelände abgefragt; erst wenn auch das fehlt, gilt die Karten-Höhe.
  // 04.09.2026 (Marc: „Anflug vom 1. zum 2. Keyframe verhält sich anders, je
  // nachdem wo ich anfange"): vorher las diese Funktion die MITTELPUNKT-Höhe
  // der Karte (`getCenterElevation`), die nach jumpTo nicht nachgeführt wird
  // und deshalb noch von der Position VOR dem Probelauf stammte; rzMlCamApply
  // rechnet aber mit der echten Geländehöhe → der Zoom lief um die Differenz
  // weg, und die hing vom Startpunkt ab.
  function rzMlCamRead(map, elevOpt) {
    const c = map.getCenter(), zoom = map.getZoom();
    const p = map.getPitch() * D2R, b = map.getBearing() * D2R;
    const worldSize = 512 * Math.pow(2, zoom);
    const ppm = mercZfromAlt(1, c.lat) * worldSize;                    // Pixel je Meter in der Bildmitte
    const ctcd = ctcdPx(map);
    const elev = (elevOpt != null && isFinite(elevOpt)) ? elevOpt : terrainAt(map, [c.lng, c.lat], centerElev(map));
    const altM = Math.cos(p) * ctcd / ppm + elev;
    const offMerc = Math.sin(p) * ctcd / worldSize;                    // Kamera steht HINTER der Mitte
    const cx = lngX(c.lng) - Math.sin(b) * offMerc;
    const cy = latY(c.lat) + Math.cos(b) * offMerc;
    const camLat = yLat(cy);
    return { pos: [cx, cy, mercZfromAlt(altM, camLat)], bp: [map.getBearing(), map.getPitch()] };
  }
  // elevOpt (Meter, optional): Geländehöhe, mit der die Stützstelle GELESEN wurde.
  // Ist sie bekannt, wird sie fest verwendet (kein Gelände-Abgriff) — damit ist
  // Lesen/Setzen exakt umkehrbar, auch wenn die Kacheln beim Abspielen gerade
  // fehlen (04.09.2026: „Zoom landet an der falschen Stelle von ganz vorne").
  function rzMlCamApply(map, pos, bp, elevOpt) {
    const b = bp[0] * D2R, p = bp[1] * D2R;
    const camLat = yLat(pos[1]);
    const altM = pos[2] / mercZfromAlt(1, camLat);
    const fixed = (elevOpt != null && isFinite(elevOpt));
    let elev = fixed ? elevOpt : centerElev(map), cLng = xLng(pos[0]), cLat = camLat;
    // Blickstrahl trifft Gelände. Der Meter→Mercator-Maßstab gehört zur
    // BILDMITTE (so rechnet MapLibre pixelPerMeter), nicht zur Kamera — bei
    // 100 km Abstand machte der Breitengrad-Unterschied sonst 1,8 km aus.
    for (let i = 0; i < 4; i++) {
      const dz = Math.max(1, altM - elev);
      const offMerc = dz * Math.tan(p) * mercZfromAlt(1, cLat);
      const cx = pos[0] + Math.sin(b) * offMerc, cy = pos[1] - Math.cos(b) * offMerc;
      const nLng = xLng(cx), nLat = yLat(cy);
      const e2 = fixed ? elev : terrainAt(map, [nLng, nLat], elev);
      const fertig = Math.abs(e2 - elev) < 0.5 && Math.abs(nLat - cLat) < 1e-7;
      cLng = nLng; cLat = nLat; elev = e2;
      if (fertig) break;
    }
    const dz = Math.max(1, altM - elev);
    const ppm = ctcdPx(map) * Math.cos(p) / dz;
    const worldSize = ppm / mercZfromAlt(1, cLat);
    let zoom = Math.log2(worldSize / 512);
    // 05.09.2026 (Audit): nie unter minZoom / über maxZoom, Breite innerhalb Mercator — sonst wirft
    // MapLibres Gelände-Kachelsuche je Bild „x=0, y=-1 outside of bounds".
    try { zoom = Math.max(map.getMinZoom ? map.getMinZoom() : 0, Math.min(map.getMaxZoom ? map.getMaxZoom() : 24, zoom)); } catch (_) { zoom = Math.max(0, zoom); }
    if (!isFinite(zoom)) zoom = 0;
    cLat = Math.max(-85, Math.min(85, cLat));
    try { if (map.getCenterClampedToGround && map.getCenterClampedToGround()) map.setCenterClampedToGround(false); } catch (_) {}
    map.jumpTo({ center: [cLng, cLat], zoom: zoom, bearing: bp[0], pitch: bp[1], elevation: elev });
  }
  window.rzMlCamRead = rzMlCamRead;
  window.rzMlCamApply = rzMlCamApply;
})();
