#!/usr/bin/env python3
"""Saubere Quickstart-Screenshots je Modul — headless Playwright mit ECHTEM
Mapbox-Token, ECHTER de.json-i18n und ECHTEM Teide-Track (via loadGlobalGpx
eingepasst). Deterministisch, reproduzierbar, ohne Fenster-Chaos."""
import asyncio, importlib.util, json, os, re
from pathlib import Path

REPO = Path("/Users/docarzt/Claude-Masterblaster/Reisezoom-GPS-Studio")
OUT = REPO / "ui/img/quickstart"
OUT.mkdir(parents=True, exist_ok=True)

spec = importlib.util.spec_from_file_location("st", REPO / "scripts/selftest_ui.py")
st = importlib.util.module_from_spec(spec); spec.loader.exec_module(st)

TOKEN = json.load(open(os.path.expanduser(
    "~/Library/Application Support/Reisezoom GPS Studio/settings.json")))["mapbox_token"]
T = json.load(open("/tmp/teide_mock.json"))
E = json.load(open("/tmp/teide_extra.json"))   # Profil (Höhe/HR) + Inspektor-Punkte
DE = json.load(open(REPO / "i18n/de.json"))

# ── Mock patchen: Token + Teide-GPX ──────────────────────────────────────
js = st.MOCK_API_JS
js = js.replace('mapbox_token: "pk.test_mock"', f'mapbox_token: {json.dumps(TOKEN)}')
new_gpx = (
    "  const MOCK_GPX = {\n"
    f"    coords: {json.dumps(T['coords'])},\n"
    f"    bbox: {json.dumps(T['bbox'])},\n"
    f"    elevations: {json.dumps(T['elevations'])},\n"
    f'    name: {json.dumps(T["name"])},\n'
    f"    stats: {json.dumps(T['stats'])},\n"
    "  };\n"
)
js = re.sub(r"  const MOCK_GPX = \{.*?\n  \};\n", new_gpx, js, count=1, flags=re.DOTALL)

# ── Echte i18n nachreichen (Mock liefert sonst rohe Keys) ────────────────
I18N_PATCH = (
    "(() => { const S = " + json.dumps(DE, ensure_ascii=False) + ";"
    " if (window.pywebview && window.pywebview.api) {"
    "   window.pywebview.api.i18n_get_strings = async () => "
    "     ({ strings: S, active: 'de', requested: 'de', system_locale: 'de',"
    "        available: ['de','en','es'] });"
    " } })();"
)

# Der generische Mock liefert einen synthetischen 6-km-Hügel und kennt den
# Inspektor gar nicht — die Screenshots würden dem Guide-Text widersprechen
# (generisches Profil unter „pico_del_teide.gpx", leere Inspektor-Sidebar).
# Deshalb: echtes Teide-Höhenprofil + echte Punktliste in den Mock.
DATA_PATCH = (
    "(() => { const D=" + json.dumps(E) + ";"
    " const api=()=>window.pywebview&&window.pywebview.api;"
    " const iv=setInterval(()=>{ const a=api(); if(!a) return; clearInterval(iv);"
    "  a.heightanim_load_gpx=async()=>({ok:true,distances_m:D.dists,elevations:D.eles,"
    "    series:[{id:'ele',label:'Höhe',unit:'m',values:D.eles},"
    "            {id:'hr',label:'Herzfrequenz',unit:'bpm',values:D.hrs}],"
    "    stats:{},waypoints:[],auto_markers:[]});"
    "  a.gpxinspect_load=async()=>({ok:true,points:D.insp,count:D.insp.length,"
    "    has_time:true,has_ele:true,has_sensors:true,bbox:D.bbox,src:'/x/pico_del_teide.gpx'});"
    " },50); })();"
)

# ── mapboxgl/maplibregl-Instanzen mitschneiden, damit wir die Karte gezielt
#    auf den Teide-Track einpassen können (der Mock löst den Fit nicht aus). ─
BB = T["bbox"]
MAP_TRACK = """
(() => {
  window.__rzMaps = [];
  function wrap(nsName) {
    let ns;
    Object.defineProperty(window, nsName, {
      configurable: true,
      get() { return ns; },
      set(v) {
        ns = v;
        try {
          if (v && v.Map && !v.Map.__rzWrapped) {
            const O = v.Map;
            const W = function(...a) { const m = new O(...a); window.__rzMaps.push(m); return m; };
            W.prototype = O.prototype;
            Object.setPrototypeOf(W, O);
            W.__rzWrapped = true;
            v.Map = W;
          }
        } catch (_) {}
      }
    });
  }
  wrap("mapboxgl"); wrap("maplibregl");
  // Leaflet: L.map ist eine Factory — Instanz mitschneiden für den Track-Fit.
  let Lref;
  Object.defineProperty(window, "L", {
    configurable: true,
    get() { return Lref; },
    set(v) {
      Lref = v;
      try {
        if (v && v.map && !v.map.__rzWrapped) {
          const o = v.map;
          const w = function(...a) { const m = o.apply(this, a); window.__rzLeaflet = m; return m; };
          w.__rzWrapped = true;
          Object.assign(w, o);
          v.map = w;
        }
      } catch (_) {}
    }
  });
})();
"""

from playwright.async_api import async_playwright

MODULES = {
    "animator": "animator", "reiseroute": "reiseroute", "datenanimator": "heightanim",
    "tourmap": "tourmap", "webkarte": "webkarte", "geotagger": "geotagger",
    "gpxinspect": "gpxinspect",
}

async def main():
    errs = []
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--use-angle=default", "--enable-webgl",
                                          "--ignore-gpu-blocklist"])
        pg = await b.new_page(viewport={"width": 1512, "height": 900}, device_scale_factor=2)
        pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.add_init_script(MAP_TRACK)   # ZUERST — vor mapbox-gl.js
        await pg.add_init_script(js)
        await pg.add_init_script(I18N_PATCH)
        await pg.add_init_script(DATA_PATCH)
        await pg.goto((REPO / "ui/index.html").as_uri())
        await pg.wait_for_timeout(3500)
        for name, mod in MODULES.items():
            try:
                await pg.click(f'[data-mod="{mod}"]', timeout=4000)
            except Exception as e:
                print(f"  !! {name}: Tab-Klick {e}")
            await pg.wait_for_timeout(1200)
            try:
                await pg.evaluate("""async () => {
                  if (typeof window.loadGlobalGpx === 'function')
                    await window.loadGlobalGpx('/x/pico_del_teide.gpx');
                }""")
            except Exception:
                pass
            await pg.wait_for_timeout(2500)
            # Karte des aktuellen Moduls gezielt auf den Teide-Track einpassen.
            try:
                await pg.evaluate("""(bb) => {
                  if (window.__rzLeaflet && document.querySelector('.leaflet-container')) {
                    // Web Karte (Leaflet): [lat,lon]-Reihenfolge!
                    try { window.__rzLeaflet.fitBounds(
                      [[bb.min_lat, bb.min_lon], [bb.max_lat, bb.max_lon]],
                      { padding: [60, 60], animate: false }); return; } catch (_) {}
                  }
                  const maps = window.__rzMaps || [];
                  const m = maps[maps.length - 1];
                  if (m && m.fitBounds) m.fitBounds(
                    [[bb.min_lon, bb.min_lat], [bb.max_lon, bb.max_lat]],
                    { padding: 70, duration: 0, pitch: 0, bearing: 0 });
                }""", BB)
            except Exception as e:
                print("   fit:", e)
            if name == "tourmap":
                # Sektionen einklappen → der orange „Karte als PNG rendern"-Button
                # (Schritt 3 des Guides) ist im Bild, wie in Marcs echtem Setup.
                try:
                    await pg.evaluate("""() => {
                      document.querySelectorAll('aside.panel [data-accordion-section]').forEach(sec => {
                        const b = sec.querySelector('.section-collapse-body');
                        const h = sec.querySelector('.section-collapse-header');
                        if (b && h && !b.hidden) h.click();
                      });
                    }""")
                except Exception:
                    pass
            await pg.wait_for_timeout(6500)   # Satelliten-Tiles nach dem Fit
            path = OUT / f"{name}.png"
            await pg.screenshot(path=str(path))
            print(f"  ✓ {name} → {path.name}")
        await b.close()
    print("pageerrors:", len(errs))
    for e in errs[:5]: print("  ", e[:150])

asyncio.run(main())
