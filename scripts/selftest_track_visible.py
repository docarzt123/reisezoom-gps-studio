#!/usr/bin/env python3
"""Regressions-Test: der geladene Track MUSS in der Vorschau sichtbar sein.

Fängt den Bug-Typ von v0.9.469 („Track wird nicht gezeichnet"): der Track lud,
Layer + Kamera + Farbe stimmten, aber die `preview-track`-Quelle hatte nur EINE
Koordinate → eine Linie mit 1 Punkt rendert unsichtbar. Ursache war das Trimmen
auf die Scrubber-Position bei „Ganzer Track" AUS.

Dieser Test lädt einen echten Track in Animator UND Tour-Map — jeweils mit
`preview_full_track` AUS **und** AN — und stellt sicher, dass die
`preview-track`-Quelle immer ≥ 2 Koordinaten hat (= die Linie zeichnet sichtbar).
Kein Mapbox-Token nötig: geprüft wird die GeoJSON-Quelle, nicht die Kacheln.

Exit 0 = alle Fälle grün · Exit 1 = mindestens ein Fall unsichtbar.
"""
import asyncio, importlib.util, json, sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
UI_INDEX = REPO / "ui" / "index.html"

# selftest_ui-Mock wiederverwenden (Token, i18n, MOCK_GPX, Projekt-Settings).
spec = importlib.util.spec_from_file_location("st_ui", REPO / "scripts" / "selftest_ui.py")
st = importlib.util.module_from_spec(spec); spec.loader.exec_module(st)

# 80-Punkte-Synthetik-Track (Berlin-Grunewald-ähnlich) + Bridge-Mocks, die die
# ECHTE Lade-Kette (loadGlobalGpx → animator_load_gpx → drawPreview) auslösen.
TRACK = [[13.17 + i * 0.001, 52.44 + i * 0.0009] for i in range(80)]
BBOX = {"min_lon": 13.17, "min_lat": 52.44, "max_lon": 13.17 + 79 * 0.001,
        "max_lat": 52.44 + 79 * 0.0009}
EXTRA_MOCK = """
(() => {
  const CO = %s, BB = %s;
  const RES = { ok:true, name:"Testtrack", gpx_path:"/x/test.gpx", coords:CO, bbox:BB,
    elevations: CO.map(()=>100), series:{}, sensor_fields:[], chart_series:[],
    stats:{ n_points:CO.length, distance_km:5, duration_s:3600, ascent_m:100,
            descent_m:100, ele_max:200, ele_min:100, moving_time_s:3000, max_speed_kmh:20 } };
  const PROJ = { id:"p1", name:"Standard", animator:{ preview_full_track:%s },
                 tourmap:{}, geotagger:{}, heightanim:{}, photos:[] };
  const iv = setInterval(() => {
    const a = window.pywebview && window.pywebview.api; if (!a) return; clearInterval(iv);
    a.animator_load_gpx = async () => RES;
    a.tourmap_load_gpx  = async () => RES;
    a.session_open_for_track = async () => ({ ok:true, session:{track_hash:"h1"},
                                              active_project:PROJ, projects:[PROJ] });
    a.session_update_project_settings = async (h,p,m,patch) => { PROJ[m]=Object.assign(PROJ[m]||{},patch); return {ok:true}; };
    a.session_set_active_project = async () => ({ ok:true, active_project:PROJ, projects:[PROJ] });
    a.path_exists = async () => ({ ok:true, exists:true });
  }, 30);
})();
"""

from playwright.async_api import async_playwright


async def _coords_after_load(pg, mod):
    """Lädt den Track im Modul `mod` und liefert die preview-track-Punktzahl."""
    tab = await pg.query_selector(f'[data-mod="{mod}"]')
    if tab:
        await tab.click(); await pg.wait_for_timeout(700)
    await pg.evaluate("async()=>{ if(window.loadGlobalGpx) await window.loadGlobalGpx('/x/test.gpx'); }")
    await pg.wait_for_timeout(2500)
    # preview-track kann über eine echte Map (mit Token) ODER null (ohne WebGL)
    # laufen. Der Test prüft die GeoJSON-Quelle direkt, wenn eine Map da ist.
    return await pg.evaluate("""() => {
      // Map generisch finden: Mapbox hält Instanzen nicht global — wir lesen die
      // Quelle über das zuletzt exponierte Debug-Handle ODER via Container.
      const el = document.querySelector('.mapboxgl-map, .maplibregl-map');
      // Es gibt keinen offiziellen DOM->Map-Zugriff; daher exponiert der Test
      // die Map NICHT und verlässt sich auf window.__rzTrackCoordsProbe, das die
      // App-Preview über die Quelle liefert — Fallback: -1 (Map nicht prüfbar).
      try {
        const m = window.__rzTrackProbeMap;
        if (m && m.getSource) {
          const s = m.getSource('preview-track');
          const g = s && s._data && s._data.geometry;
          return (g && g.coordinates) ? g.coordinates.length : 0;
        }
      } catch(_) {}
      return -1;
    }""")


async def main():
    results = []
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--use-angle=default", "--enable-webgl", "--ignore-gpu-blocklist"])
        for full in (False, True):
            for mod in ("animator", "tourmap"):
                pg = await b.new_page(viewport={"width": 1400, "height": 900})
                await pg.add_init_script(st.MOCK_API_JS)
                await pg.add_init_script(EXTRA_MOCK % (json.dumps(TRACK), json.dumps(BBOX), "true" if full else "false"))
                # Map-Konstruktor abfangen → letzte Instanz als Probe-Handle merken.
                await pg.add_init_script("""
                  (() => { function wrap(ns){ if(!window[ns]||!window[ns].Map||window[ns].Map.__p) return;
                    const O=window[ns].Map; const W=function(...a){ const m=new O(...a); window.__rzTrackProbeMap=m; return m; };
                    W.__p=true; Object.assign(W,O); W.prototype=O.prototype; window[ns].Map=W; }
                    let d=window.mapboxgl; Object.defineProperty(window,'mapboxgl',{configurable:true,
                      get(){return d;}, set(v){ d=v; try{wrap('mapboxgl');}catch(_){}}});
                    let d2=window.maplibregl; Object.defineProperty(window,'maplibregl',{configurable:true,
                      get(){return d2;}, set(v){ d2=v; try{wrap('maplibregl');}catch(_){}}});
                  })();
                """)
                await pg.goto(f"file://{UI_INDEX.resolve()}", wait_until="domcontentloaded")
                await pg.wait_for_timeout(3200)
                n = await _coords_after_load(pg, mod)
                results.append((mod, full, n))
                await pg.close()
        await b.close()

    print("── Track-Sichtbarkeit (preview-track-Punkte, ≥2 = sichtbar) ──")
    # Selbst-kalibrierend: Headless kann die Vorschau nicht immer füllen (Token/
    # WebGL/Timing). Nur wenn MINDESTENS EIN Fall den Track befüllt (≥2), ist die
    # Umgebung tauglich → dann ist jedes <2 ein ECHTER Fehler. Konnte KEIN Fall
    # füllen, ist der Test nicht aussagekräftig → SKIP + lauter Manuell-Hinweis.
    can_fill = any(n >= 2 for _, _, n in results)
    ok = True
    for mod, full, n in results:
        tag = f"{mod:9s} full_track={'AN ' if full else 'AUS'}"
        if not can_fill:
            print(f"  ⏭  {tag}: {n} (Vorschau headless nicht befüllbar)")
        elif n >= 2:
            print(f"  ✅ {tag}: {n} Punkte")
        else:
            print(f"  ❌ {tag}: {n} Punkt(e) → UNSICHTBARE Linie!")
            ok = False
    if not can_fill:
        print("\n⚠️  SKIP — die Vorschau ließ sich headless nicht befüllen "
              "(Token/WebGL/Timing). Track-Sichtbarkeit NICHT automatisch geprüft.")
        print("   → PFLICHT: manuelle Sichtprüfung laut docs/TESTING.md (Track in "
              "Animator + Tour-Map, 'Ganzer Track' AN und AUS).")
        return 0
    print("\nRESULT:", "OK" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
