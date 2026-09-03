"""Die echte Oberfläche an die ECHTE Brücke (app.Api) hängen — headless (03.09.2026).

Playwright lädt ui/index.html; `window.pywebview.api` ist ein Proxy, der jeden
Aufruf über `page.expose_function` an `app.Api()` weiterreicht. Damit laufen
echte GPX-Parses, echte Stil-Auflösung, echte Renders — ohne pywebview-Fenster
und ohne Marcs Rechner zu übernehmen. Dev-Modus: APP_SUPPORT = Repo-Root, also
liegt settings.json im Repo (nicht in Marcs Library).

Aufruf: MAPTILER_KEY=… MAPBOX_TOKEN=… .venv/bin/python scripts/selftest_realbridge.py <out_dir> <szenario…>
Szenarien: animator_track  tourmap_render  animator_render  smallmods  library

Zwei Fallen, die dieser Prüfstand gefunden hat (siehe docs/DEVELOPER.md,
„Kartenanbieter"): Gelände während einer Kamerafahrt setzen und MapLibres
`isStyleLoaded()`-Semantik — Dinge, die der Mock-Prüfstand nie zeigt, weil er
weder echte Tracks noch echte Sitzungen kennt. `loadGlobalGpx` NICHT awaiten:
die echte App öffnet danach den Archiv-Dialog, und das Versprechen wartet.
`RZ_TRACE=1` protokolliert jede Karten-Methode samt Aufrufer.
"""
import asyncio, sys, json, os, re, time
from pathlib import Path
REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
os.chdir(REPO)
import app as APP
from playwright.async_api import async_playwright

OUT = Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
SCEN = sys.argv[2:] or ["animator_track"]
SP = REPO / "tests" / "fixtures"
api = APP.Api()

# Schlüssel NUR aus der Umgebung (MAPTILER_KEY, MAPBOX_TOKEN) — leer = kostenlose
# Stile; nie aus fremden Dateien lesen. Geschrieben wird in die Dev-Einstellungen
# (Repo-Root/settings.json, gitignored), nie in die des Nutzers.
api.settings_set({"maptiler_key": os.environ.get("MAPTILER_KEY", ""), "mapbox_token": os.environ.get("MAPBOX_TOKEN", ""),
                  "onboarding_done": True, "tile_cache_mb": 512, "force_osm": False})

BRIDGE_JS = r"""
(() => {
  window.__rzKeinPmBoot = true;
  const NATIVE = {   // Dialoge/Fenster: nie native Aufrufe aus dem Prüfstand
    pick_save_path: async (name) => (window.__rzSavePath || null),
    pick_file: async () => null, pick_folder: async () => null,
    set_window_size: async () => ({ ok: true }), get_window_size: async () => ({ width: 1400, height: 900 }),
    quit: async () => {}, on_loaded: () => {}, open_url: async () => ({ ok: true }),
  };
  const api = new Proxy({}, {
    get(_t, name) {
      if (name in NATIVE) return NATIVE[name];
      if (typeof name !== "string") return undefined;
      return async (...args) => {
        const res = await window.rzBridge(name, JSON.stringify(args));
        return JSON.parse(res);
      };
    },
  });
  window.pywebview = { api };
  window.__applogs = [];
  window.dispatchEvent(new Event("pywebviewready"));
})();
"""

def bridge(name, args_json):
    args = json.loads(args_json)
    t0 = time.time(); sys.stderr.write(f"[bridge] > {name}\n"); sys.stderr.flush()
    try:
        return _bridge(name, args)
    finally:
        sys.stderr.write(f"[bridge] < {name} {time.time()-t0:.2f}s\n"); sys.stderr.flush()


def _bridge(name, args):
    fn = getattr(api, name, None)
    if fn is None:
        return json.dumps({"ok": False, "error": f"no bridge {name}"})
    try:
        res = fn(*args)
    except Exception as e:
        return json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"})
    try:
        return json.dumps(res, default=str)
    except Exception:
        return json.dumps({"ok": True})


async def state(page):
    return await page.evaluate("""() => { const m = window.__rzLetzteKarte; const sel = document.getElementById('anim-style');
      return { sel: sel && sel.value, engine: m && m.__rzEngine, key: m && m.__rzStyleKey, region: m && m.__rzSpec && m.__rzSpec.region,
               terrain: !!(m && m.getTerrain && m.getTerrain()), loaded: !!(m && m.isStyleLoaded && m.isStyleLoaded()),
               note: (document.getElementById('anim-style-note')||{}).textContent, rightsHidden: (document.getElementById('anim-style-rights')||{}).hidden,
               sources: (m && m.getStyle && Object.keys(m.getStyle().sources || {})) || [] }; }""")


async def set_style(page, key, wait=6000):
    await page.evaluate(f"""() => {{ const s=document.getElementById('anim-style'); s.value='{key}'; s.dispatchEvent(new Event('change')); }}""")
    await page.wait_for_timeout(wait)


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True, args=["--use-angle=default", "--enable-webgl", "--ignore-gpu-blocklist"])
        page = await b.new_page(viewport={"width": 1400, "height": 900})
        errs = []; page.on("pageerror", lambda e: errs.append(str(e)[:300]))
        cons = []
        def _con(m):
            if m.type in ("error", "warning") and "GPU stall" not in m.text:
                cons.append(m.type + ": " + m.text[:220]); sys.stderr.write(f"[console] {m.type} {m.text[:200]} @ {m.location}\n"); sys.stderr.flush()
        page.on("console", _con)
        page.on("pageerror", lambda e: sys.stderr.write(f"[pageerror] {str(e)[:200]} || {str(getattr(e, 'stack', ''))[:900]}\n"))
        await page.expose_function("rzBridge", bridge)
        await page.add_init_script(BRIDGE_JS)
        await page.goto(f"file://{(REPO / 'ui/index.html').resolve()}", wait_until="domcontentloaded")
        await page.wait_for_timeout(4000)
        if os.environ.get("RZ_TRACE"): await page.evaluate("""() => {
          const wrap = (proto, name, lib) => { const o = proto[name]; if (!o) return; proto[name] = function(...a) {
            const st = (new Error()).stack.split('\\n').slice(2, 6).map(x => x.trim().replace(/^at /, '').replace(/^file:\\/\\/.*?\\/(ui|modules)\\//, '$1/')).join(' <- ');
            console.log('[mapcall] ' + lib + '.' + name + ' args=' + JSON.stringify(a.slice(0, 2), (k, v) => (typeof v === 'object' && v && v.version) ? '<style>' : v).slice(0, 160) + ' | ' + st);
            return o.apply(this, a); }; };
          for (const [lib, L] of [['maplibre', window.maplibregl], ['mapbox', window.mapboxgl]]) { if (!L) continue;
            for (const n of ['setStyle', 'setTerrain', 'jumpTo', 'easeTo', 'flyTo', 'fitBounds', 'setCenter', 'setZoom', 'stop', 'remove', 'resize']) wrap(L.Map.prototype, n, lib); }
        }""")
        page.on("console", lambda m: sys.stderr.write("[mapcall] " + m.text[10:400] + "\n") if m.text.startswith("[mapcall]") else None)
        report = {}
        gpx = str(SP / "potsdam_probe.gpx")
        teide = str(REPO / "tests/fixtures/track_teide.gpx")

        if "animator_track" in SCEN:
            await page.evaluate("window.switchMod('animator')"); await page.wait_for_timeout(3000)
            await set_style(page, "free_satellite", 4000)
            report["anim_before"] = await state(page)
            await page.evaluate(f"() => {{ window.loadGlobalGpx({json.dumps(gpx)}); }}"); await page.wait_for_timeout(8000)
            sys.stderr.write("[probe] nach loadGlobalGpx potsdam\n"); sys.stderr.flush()
            report["anim_potsdam"] = await asyncio.wait_for(state(page), 20)
            report["anim_potsdam"]["modal"] = (await page.evaluate("() => { const m = document.querySelector('.modal-title, #modal-title, .md-title'); return m ? m.textContent.slice(0,80) : null; }"))
            sys.stderr.write("[probe] state ok\n"); sys.stderr.flush()
            await page.screenshot(path=str(OUT / "rb_anim_potsdam_free.png"))
            await page.evaluate(f"() => {{ window.loadGlobalGpx({json.dumps(teide)}); }}"); await page.wait_for_timeout(8000)
            report["anim_teide"] = await state(page)
            await page.screenshot(path=str(OUT / "rb_anim_teide_free.png"))
            for k in ["maptiler_satellite", "satellite", "ofm_liberty", "free_satellite"]:
                await set_style(page, k, 7000)
                report["anim_" + k] = await state(page)
                await page.screenshot(path=str(OUT / f"rb_anim_teide_{k}.png"))

        if "tourmap_render" in SCEN or "animator_render" in SCEN:
            mod = "tourmap" if "tourmap_render" in SCEN else "animator"
            await page.evaluate(f"window.switchMod('{mod}')"); await page.wait_for_timeout(3000)
            await page.evaluate(f"() => {{ window.loadGlobalGpx({json.dumps(teide)}); }}"); await page.wait_for_timeout(6000)
            await set_style(page, "free_satellite", 5000)
            ext = "png" if mod == "tourmap" else "mp4"
            out = OUT / f"rb_{mod}_render.{ext}"
            if out.exists(): out.unlink()
            await page.evaluate(f"window.__rzSavePath = {json.dumps(str(out))}")
            if mod == "animator":
                await page.evaluate("""() => { const d=document.getElementById('anim-dur'); if (d) { d.value='2'; d.dispatchEvent(new Event('input')); d.dispatchEvent(new Event('change')); }
                    const h=document.getElementById('anim-hold'); if (h) { h.value='1'; h.dispatchEvent(new Event('input')); h.dispatchEvent(new Event('change')); }
                    const w=document.getElementById('anim-w'); const hh=document.getElementById('anim-h'); if (w&&hh) { w.value='1280'; hh.value='720'; w.dispatchEvent(new Event('change')); hh.dispatchEvent(new Event('change')); } }""")
                await page.wait_for_timeout(800)
            await page.evaluate("() => document.getElementById('anim-render').click()")
            t0 = time.time()
            while time.time() - t0 < 300:
                await page.wait_for_timeout(2000)
                if out.exists() and out.stat().st_size > 10000:
                    await page.wait_for_timeout(3000)
                    break
            report[mod + "_render"] = {"exists": out.exists(), "size": out.stat().st_size if out.exists() else 0, "secs": round(time.time() - t0, 1)}
            await page.screenshot(path=str(OUT / f"rb_{mod}_after_render.png"))
            txt = await page.evaluate("() => document.body.innerText")
            report[mod + "_render"]["ui_hint"] = [l for l in txt.splitlines() if "Luftbild" in l or "Satellit" in l][:4]

        if "smallmods" in SCEN:
            for mod in ["gpxinspect", "geotagger"]:
                await page.evaluate(f"window.switchMod('{mod}')"); await page.wait_for_timeout(3000)
                await page.evaluate(f"() => {{ window.loadGlobalGpx({json.dumps(gpx)}); }}"); await page.wait_for_timeout(6000)
                info = await page.evaluate("""() => { const m = window.__rzLetzteKarte; const c=document.querySelector('.rz-style-ctrl'); return { ctrl: !!c, note: c && c.querySelector('.rz-style-note').textContent, key: m && m.__rzStyleKey, region: m && m.__rzSpec && m.__rzSpec.region }; }""")
                report[mod] = info
                await page.screenshot(path=str(OUT / f"rb_{mod}.png"))

        if "library" in SCEN:
            await page.evaluate("window.switchMod('library')"); await page.wait_for_timeout(3000)
            await page.evaluate("() => { const b = document.querySelector('[data-view=\"map\"], #lib-view-map, .lib-view-map'); if (b) b.click(); }")
            await page.wait_for_timeout(5000)
            info = await page.evaluate("""() => { const m = window.__libMap; const c=document.querySelector('.rz-style-ctrl'); return { ctrl: !!c, mapwrapHidden: (document.getElementById('lib-mapwrap')||{}).hidden, key: m && m.__rzStyleKey }; }""")
            report["library"] = info
            await page.screenshot(path=str(OUT / "rb_library.png"))

        print(json.dumps(report, ensure_ascii=False, indent=1))
        print("pageerrors:", errs[:6])
        print("console:", cons[-8:])
        await b.close()

asyncio.run(main())
