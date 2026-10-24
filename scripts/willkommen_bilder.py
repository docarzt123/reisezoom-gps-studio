#!/usr/bin/env python3
"""Bilder für die Willkommen-Seite und den Schnell-Einstieg neu aufnehmen (24.10.2026).

Marc: „Mach selber Screenshots, setz die rein … jedes Modul mit Bildern und einer kurzen Erklärung.“ Die Bilder gehen mit
der App hinaus (und ins öffentliche Repo) — deshalb kommen sie aus einem **Demo-Archiv ohne Privates**: Marcs
veröffentlichte Teneriffa-Touren, Masca, Teufelsmauer; Fotos der Masca-Tour ohne Personen (`FOTOS_OHNE`). Keine echten
Bibliotheken, keine Tester-Touren, keine Wohnorte.

    .venv/bin/python scripts/willkommen_bilder.py            → ui/img/quickstart/<modul>.jpg (1200 × 750)
    RZ_WILLKOMMEN_NUR=animator,library …                    → nur diese

Braucht Internet (Karten, Kartenbilder). Läuft mit der echten Oberfläche (WebKit) und dem echten Backend.
"""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
QUELLEN = Path.home() / "GPS-Studio-Test" / "Quellen"
D = Path(os.environ.get("RZ_DEMO_ORDNER", "/Volumes/MacMini 2TB Acasis/_tmp/claude/willkommen-demo")) / time.strftime("%Y%m%d-%H%M%S")
AUS = REPO / "ui" / "img" / "quickstart"
TOUREN = sorted((QUELLEN / "08-teneriffa-woche").glob("*.gpx")) + [
    QUELLEN / "03-touren" / "2023-05-05_Barranco de Masca Extended Version Erjos ➡️ Masca ➡️ Buenavista-1106845751.gpx",
    QUELLEN / "03-touren" / "track_teufelsmauer.gpx"]
FOTOS_OHNE = {"IMG_0637.jpg", "IMG_0638.jpg", "IMG_0653.jpg", "IMG_0665.jpg", "IMG_0684.jpg", "IMG_0741.jpg"}   # Personen
NUR = {x.strip() for x in os.environ.get("RZ_WILLKOMMEN_NUR", "").split(",") if x.strip()}


def demo_anlegen() -> None:
    (D / "Touren").mkdir(parents=True)
    (D / "Fotos").mkdir()
    for t in TOUREN:
        shutil.copy2(t, D / "Touren" / t.name)
    for f in sorted((QUELLEN / "10-fotos" / "echt-mit-gps").glob("*.jpg")):
        if "Enhanced" not in f.name and f.name not in FOTOS_OHNE:
            shutil.copy2(f, D / "Fotos" / f.name)
    appo = D / "App-Ordner"
    appo.mkdir()
    (appo / "bibliothek.json").write_text(json.dumps({"pfad": str(D / "Bibliothek"), "vorher": []}))
    (appo / "testrechner.json").write_text(json.dumps({"schreiben_nur_in": [str(D)]}))
    (appo / "settings.json").write_text(json.dumps({"onboarding_done": True, "language": "de", "logbuch_lernen_gefragt": True,
                                                    "map_style_default": "free_satellite", "update_check_enabled": False}))
    os.environ.update(RZ_APP_ORDNER=str(appo), RZ_CLOUD="0", RZ_CLOUD_ABLAGE="datei", RZ_KEIN_WILLKOMMEN="1")


WIEDER = os.environ.get("RZ_DEMO_WIEDER", "")   # vorhandenes Demo-Archiv nehmen (schneller beim Nachbessern)
if WIEDER:
    D = Path(WIEDER)
    os.environ.update(RZ_APP_ORDNER=str(D / "App-Ordner"), RZ_CLOUD="0", RZ_CLOUD_ABLAGE="datei", RZ_KEIN_WILLKOMMEN="1")
else:
    demo_anlegen()
sys.path.insert(0, str(REPO))
os.chdir(REPO)
import logging  # noqa: E402
logging.basicConfig(level=logging.WARNING)
import core.bibliothek as cbib  # noqa: E402
if not WIEDER:
    cbib.anlegen(D / "Bibliothek")
import app as APP  # noqa: E402
api = APP.Api()
api.settings_set({"version_zuletzt": APP.APP_VERSION})


def warte_py(fn, sek=600):
    ende = time.time() + sek
    while time.time() < ende:
        if fn():
            return True
        time.sleep(1)
    return False


if not WIEDER:
    print("Archiv einlesen …", flush=True)
    api.library_add_folder(str(D / "Touren"))
    api.library_scan_start(True)
    warte_py(lambda: not (api.library_scan_status() or {}).get("running"))
    print("Fotos einlesen …", flush=True)
    api.fotos_ordner_hinzu(str(D / "Fotos"))
    api.fotos_scan_start()
    warte_py(lambda: not (api.fotos_scan_status() or {}).get("running"))
    print("Kartenbilder …", flush=True)
    try:
        api.library_map_thumbs_start()
        warte_py(lambda: not (api.library_map_thumbs_status() or {}).get("running"), 300)
    except Exception as e:  # noqa: BLE001
        print("Kartenbilder:", e)
pfade = {r[0].split("/")[-1]: r[0] for r in api._lib().execute("SELECT path FROM tracks")}
MASCA = next(p for n, p in pfade.items() if "Masca" in n)
VILAFLOR = next(p for n, p in pfade.items() if "Vilaflor" in n)

BRIDGE_JS = r"""(() => { window.__rzKeinPmBoot = true;
  const api = new Proxy({}, { get(_t, name) { if (typeof name !== "string") return undefined;
    return async (...args) => JSON.parse(await window.rzBridge(name, JSON.stringify(args))); } });
  window.pywebview = { api }; window.dispatchEvent(new Event("pywebviewready")); })();"""


def _sync(name, a):
    fn = getattr(api, name, None)
    if fn is None:
        return json.dumps({"ok": False})
    try:
        return json.dumps(fn(*json.loads(a)), default=str)
    except Exception as e:  # noqa: BLE001
        return json.dumps({"ok": False, "error": str(e)})


async def bridge(name, a):
    return await asyncio.get_running_loop().run_in_executor(None, _sync, name, a)


async def warte(page, js, sek=40):
    for _ in range(sek * 4):
        try:
            if await page.evaluate(js):
                return True
        except Exception:  # noqa: BLE001
            pass
        await page.wait_for_timeout(250)
    return False


async def bild(page, name):
    from PIL import Image
    roh = D / f"{name}.png"
    await page.evaluate("() => { const o = document.getElementById('modal-overlay'); if (o && !o.hidden) { try { openModal({}).close(); } catch (_) {} } document.querySelectorAll('.toast, #toast').forEach(t => t.style.display = 'none'); const tv = document.getElementById('topbar-version'); if (tv) { tv.textContent = tv.textContent.replace(' · TEST', ''); tv.classList.remove('ist-testrechner'); } document.body.classList.remove('testrechner'); const sb = document.getElementById('rz-status-box'); if (sb) sb.style.visibility = 'hidden'; }")
    await page.wait_for_timeout(300)
    await page.screenshot(path=str(roh))
    im = Image.open(roh).convert("RGB")
    im = im.resize((1200, 750), Image.LANCZOS)
    AUS.mkdir(parents=True, exist_ok=True)
    im.save(AUS / f"{name}.jpg", "JPEG", quality=82, optimize=True, progressive=True)
    print("  →", AUS / f"{name}.jpg", flush=True)


# ── Schritt-Bilder (24.10.2026, Marc: „die braucht überall Screenshots, direkt. sonst sind das üble Textwüsten“) ──
# Je Schritt ein Ausschnitt der echten Oberfläche; was gemeint ist, leuchtet (Ring), der Rest ist leicht abgedunkelt.
# Ausgabe ui/img/quickstart/<modul>-<n>.jpg (720 × 450), dazu start-<n>.jpg, logbuch-frage.jpg, banner-*.jpg.
SPOT_JS = r"""(arg) => {
  const alt = document.getElementById('rzw-spot'); if (alt) alt.remove();
  const holen = (z) => { try { const r = (new Function('return (' + z + ')'))(); return r == null ? [] : (r.length !== undefined && !r.getBoundingClientRect ? [...r] : [r]); } catch (e) { return []; } };
  const box = (els) => { els = els.filter(e => e && e.getBoundingClientRect && e.getBoundingClientRect().width > 0); if (!els.length) return null;
    const rs = els.map(e => e.getBoundingClientRect());
    const x0 = Math.min(...rs.map(r => r.left)), y0 = Math.min(...rs.map(r => r.top)), x1 = Math.max(...rs.map(r => r.right)), y1 = Math.max(...rs.map(r => r.bottom));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; };
  const ringe = (arg.ringe || []).map(z => box(holen(z))).filter(Boolean);
  const kontext = (arg.kontext || []).map(z => box(holen(z))).filter(Boolean);
  if (!ringe.length && !kontext.length) return null;
  const P = 5, W = innerWidth, H = innerHeight;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg'); svg.id = 'rzw-spot';
  svg.setAttribute('width', W); svg.setAttribute('height', H);
  svg.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none';
  let mask = `<mask id="rzw-m"><rect width="${W}" height="${H}" fill="white"/>`;
  for (const r of ringe) mask += `<rect x="${r.x - P}" y="${r.y - P}" width="${r.w + 2 * P}" height="${r.h + 2 * P}" rx="9" fill="black"/>`;
  mask += '</mask>';
  let inhalt = `<defs>${mask}<filter id="rzw-g" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="5"/></filter></defs>`;
  if (arg.dimmen !== false && ringe.length) inhalt += `<rect width="${W}" height="${H}" fill="rgba(4,8,12,0.42)" mask="url(#rzw-m)"/>`;
  for (const r of ringe) {
    inhalt += `<rect x="${r.x - P}" y="${r.y - P}" width="${r.w + 2 * P}" height="${r.h + 2 * P}" rx="9" fill="none" stroke="#48d6c4" stroke-width="4" opacity="0.55" filter="url(#rzw-g)"/>`;
    inhalt += `<rect x="${r.x - P}" y="${r.y - P}" width="${r.w + 2 * P}" height="${r.h + 2 * P}" rx="9" fill="none" stroke="#48d6c4" stroke-width="2.5"/>`;
  }
  svg.innerHTML = inhalt; document.body.appendChild(svg);
  const alle = ringe.concat(kontext);
  const x0 = Math.min(...alle.map(r => r.x)), y0 = Math.min(...alle.map(r => r.y));
  const x1 = Math.max(...alle.map(r => r.x + r.w)), y1 = Math.max(...alle.map(r => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, W, H };
}"""


async def aufraeumen(page):
    await page.evaluate("""() => { document.querySelectorAll('.toast, #toast').forEach(t => t.style.display = 'none');
      const tv = document.getElementById('topbar-version'); if (tv) { tv.textContent = tv.textContent.replace(' · TEST', ''); tv.classList.remove('ist-testrechner'); }
      document.body.classList.remove('testrechner'); const sb = document.getElementById('rz-status-box'); if (sb) sb.style.visibility = 'hidden'; }""")


async def spot(page, name, ringe=(), kontext=(), breite=640, verhaeltnis=0.625, bereich=None, dimmen=True, aus=(720, 450), mitte=None):
    """Ausschnitt um `ringe` (+ `kontext`) mit Leuchtring speichern. `bereich` = (x, y, breite) fest statt automatisch."""
    from PIL import Image
    await aufraeumen(page)
    erstes = (list(ringe) + list(kontext) or [None])[0]
    if erstes and not bereich:
        await page.evaluate(f"() => {{ try {{ const e = (function () {{ const r = ({erstes}); return r && r.length !== undefined && !r.getBoundingClientRect ? r[0] : r; }})(); e && e.scrollIntoView({{ block: 'nearest' }}); }} catch (_) {{}} }}")
        await page.wait_for_timeout(250)
    u = await page.evaluate(SPOT_JS, {"ringe": list(ringe), "kontext": list(kontext), "dimmen": dimmen})
    vw, vh = 1440, 900
    if bereich:
        x, y, w = bereich
        h = w * verhaeltnis
    elif not u:
        print(f"  ✗ {name}: Ziel nicht gefunden", flush=True)
        return False
    else:
        pad = 28
        w = max(breite, u["w"] + 2 * pad, (u["h"] + 2 * pad) / verhaeltnis)
        w = min(w, vw, vh / verhaeltnis)
        h = w * verhaeltnis
        cx, cy = (mitte or (u["x"] + u["w"] / 2, u["y"] + u["h"] / 2))
        x = min(max(cx - w / 2, 0), vw - w)
        y = min(max(cy - h / 2, 0), vh - h)
    roh = D / f"{name}.png"
    await page.screenshot(path=str(roh), clip={"x": x, "y": y, "width": w, "height": h})
    await page.evaluate("() => { const s = document.getElementById('rzw-spot'); if (s) s.remove(); }")
    im = Image.open(roh).convert("RGB").resize(aus, Image.LANCZOS)
    im.save(AUS / f"{name}.jpg", "JPEG", quality=84, optimize=True, progressive=True)
    print("  →", f"{name}.jpg", flush=True)
    return True


def Z(sel):           # erstes passendes Element
    return f"document.querySelector({json.dumps(sel)})"


def ALLE(sel):
    return f"document.querySelectorAll({json.dumps(sel)})"


def TEXT(sel, text):  # erstes Element mit diesem Text
    return f"[...document.querySelectorAll({json.dumps(sel)})].find(e => e.getBoundingClientRect().width > 0 && e.textContent.includes({json.dumps(text)}))"


def SEKTION(text):    # ganze aufgeklappte Sektion der Seitenleiste
    return f"(() => {{ const h = {TEXT('.section-collapse-header', text)}; return h ? (h.closest('section') || h.parentElement) : null; }})()"


async def sektion_auf(page, text):
    await page.evaluate(f"""() => {{ const h = {TEXT('.section-collapse-header', text)};
      if (h && h.getAttribute('aria-expanded') !== 'true') h.click(); }}""")
    await page.wait_for_timeout(700)


async def schritte(page):
    async def modul(slug, gpx=None, ruhe=5000):
        await page.evaluate(f"() => switchMod({json.dumps(slug)})")
        await page.wait_for_timeout(1500)
        if gpx:
            await page.evaluate("(p) => window.loadGlobalGpx(p, { stumm: true })", gpx)
        await page.wait_for_timeout(ruhe)

    # Archiv
    await modul("library", ruhe=2500)
    await page.evaluate("() => document.getElementById('lib-seg-touren').click()")
    await page.wait_for_timeout(1500)
    await spot(page, "start-1", ringe=[Z("#lib-tour-add"), Z("#lib-folders-btn")], breite=760)
    await spot(page, "library-1", ringe=[Z("#lib-folders-btn")], kontext=[Z("#lib-ordnerbaum")], breite=700)
    await spot(page, "library-2", ringe=[f"[{Z('#lib-search')}, {Z('#lib-reset')}, {Z('#lib-kmmax')}]", ALLE(".lib-view")], breite=1000)
    await page.evaluate("() => document.querySelector('.lib-zeile').click()")
    await page.wait_for_timeout(2500)
    await spot(page, "library-3", ringe=[Z(".lib-zeile"), Z("#lib-detail")], breite=1000)
    # Tour-Seite
    await page.evaluate("(p) => window.rzTourSeite.oeffnen({ path: p })", MASCA)
    await warte(page, "() => { const b = document.getElementById('ts-strahl'); return b && !b.hidden && !!b.querySelector('.gpxi-lb-profil'); }", 60)
    await warte(page, "() => document.querySelectorAll('.ts-bild img').length > 3", 30)
    await page.wait_for_timeout(4000)
    await spot(page, "start-2", bereich=(380, 102, 1060), dimmen=False)
    await spot(page, "tourseite-1", ringe=[f"[{Z('#ts-video')}, {Z('#ts-oeffnen-in')}]"], kontext=[Z("#ts-logbuch")], breite=760)
    await spot(page, "tourseite-2", ringe=[Z("#lib-detail"), Z("#ts-strahl")], breite=1100)
    await page.evaluate("() => { const b = [...document.querySelectorAll('.lba-eintrag:not(.lba-punkt) .lba-mehr')][1]; b && b.click(); }")
    await page.wait_for_timeout(900)
    MENUE = "[...document.querySelectorAll('.lba-menue, .ts-menue')].pop()"
    EINTRAG = "[...document.querySelectorAll('.lba-eintrag:not(.lba-punkt)')][1]"
    await spot(page, "tourseite-3", ringe=[MENUE], kontext=[EINTRAG], breite=720)
    await spot(page, "logbuch-frage", ringe=[f"(() => {{ const m = {MENUE}; if (!m) return null; const k = [...m.querySelectorAll('.lib-ctx-item')].filter(b => /Fahrt|Wanderung|Rad|Laufen|Fähre|Spaziergang|Wassersport/.test(b.textContent)); return k.length ? k : m; }})()"], breite=380, verhaeltnis=0.75, aus=(600, 450))
    await page.evaluate("() => document.querySelectorAll('.lba-menue, .ts-menue').forEach(x => x.remove())")
    await page.wait_for_timeout(500)
    await page.evaluate("() => window.rzTourSeite.schliessen && window.rzTourSeite.schliessen()")
    await page.wait_for_timeout(800)
    # Medien
    await page.evaluate("() => document.getElementById('lib-seg-fotos').click()")
    await warte(page, "() => document.querySelectorAll('#lib-fotowrap img').length > 8", 30)
    await page.wait_for_timeout(2500)
    await spot(page, "medien-1", ringe=[Z("#lib-seg-fotos"), Z("#foto-ordner-add")], breite=900)
    await spot(page, "medien-2", ringe=[f"[{Z('#foto-suche')}, {Z('#foto-reset')}]", f"[{Z('#foto-jahr')}, {Z('#foto-gps')}]"], breite=900)
    await page.evaluate("() => { const k = document.querySelector('[data-foto]'); k && k.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); }")
    await page.wait_for_timeout(3500)
    await spot(page, "medien-3", ringe=[f"(() => {{ const r = {Z('.fg-reiter')}; return r ? (r.closest('aside, .fg-seite, .fg-rechts') || r.parentElement) : null; }})()"], bereich=(0, 0, 1440))
    await page.keyboard.press("Escape")
    await page.wait_for_timeout(400)
    await page.evaluate("() => { const g = document.querySelector('.fg-zu, .foto-gross-zu, [data-fg-zu]'); if (g) g.click(); }")
    await page.wait_for_timeout(800)
    await page.evaluate("() => document.getElementById('lib-seg-touren').click()")
    await page.wait_for_timeout(1000)
    # Schnell-Video
    await page.evaluate("(p) => window.rzSchnellVideo(p)", MASCA)
    await warte(page, "() => !!document.getElementById('sv-rendern')", 20)
    await page.wait_for_timeout(3000)
    # Marc: „keinen Screenshot von einem Hochkantvideo, das sieht so leer aus“ — 16:9 wählen
    await page.evaluate("() => { const b = [...document.querySelectorAll('.sv-wahl')].find(x => x.textContent.trim() === '16:9'); b && b.click(); }")
    await page.wait_for_timeout(6000)
    await spot(page, "start-3", ringe=[Z("#sv-rendern")], kontext=[Z("#sv-vorschau")], breite=900)
    await page.evaluate("() => { try { openModal({}).close(); } catch (_) {} }")
    await page.wait_for_timeout(1200)
    # Animator
    await modul("animator", VILAFLOR, 9000)
    await page.evaluate("() => window.__rzScrubZu && window.__rzScrubZu(0.55)")
    await page.wait_for_timeout(4000)
    await page.evaluate("() => document.querySelectorAll('.overlay-preview-layer, .ov-box, .anim-ueb, .rz-hinweis-karte').forEach(e => e.style.visibility = 'hidden')")
    await spot(page, "banner-neu", bereich=(420, 140, 960), verhaeltnis=0.34, dimmen=False, aus=(1200, 408))
    await page.evaluate("() => document.querySelectorAll('.overlay-preview-layer, .ov-box, .anim-ueb, .rz-hinweis-karte').forEach(e => e.style.visibility = '')")
    await spot(page, "animator-1", ringe=[ALLE(".gpxbar-pick-btn")], breite=720)
    await sektion_auf(page, "Karte")
    await spot(page, "animator-2", ringe=[SEKTION("Karte"), TEXT(".tp-knopf", "▶")], breite=1100)
    await spot(page, "animator-3", ringe=[Z("#anim-hauptaktion")], breite=760)
    # Tour-Map
    await modul("tourmap", VILAFLOR, 8000)
    await page.evaluate("() => document.querySelectorAll('.overlay-preview-layer, .ov-box, .anim-ueb, .rz-hinweis-karte').forEach(e => e.style.visibility = 'hidden')")
    await spot(page, "banner-karten", bereich=(560, 220, 760), verhaeltnis=0.34, dimmen=False, aus=(1200, 408))
    await page.evaluate("() => document.querySelectorAll('.overlay-preview-layer, .ov-box, .anim-ueb, .rz-hinweis-karte').forEach(e => e.style.visibility = '')")
    await spot(page, "tourmap-1", ringe=[ALLE(".gpxbar-pick-btn")], breite=720)
    await spot(page, "tourmap-2", ringe=[f"[{TEXT('.section-collapse-header', 'Format')}, {TEXT('.section-collapse-header', 'Overlays')}]"], breite=1000)
    await spot(page, "tourmap-3", ringe=[Z("#anim-hauptaktion")], breite=760)
    # Daten-Animator
    await modul("heightanim", VILAFLOR, 6000)
    await spot(page, "heightanim-1", ringe=[ALLE(".gpxbar-pick-btn")], breite=720)
    await sektion_auf(page, "Allgemein")
    await spot(page, "heightanim-2", ringe=[f"[{Z('#ha-series-field')}, {Z('#ha-series-b-field')}]"], breite=900)
    await sektion_auf(page, "Rendern")
    await spot(page, "heightanim-3", ringe=[SEKTION("Rendern")], breite=900)
    # GPX-Inspektor
    await modul("gpxinspect", MASCA, 9000)
    await spot(page, "gpxinspect-1", ringe=[ALLE(".gpxbar-pick-btn")], breite=900)
    await page.evaluate("() => { const s = [...document.querySelectorAll('summary.gpxi-mm-title')].find(x => x.textContent.includes('Heilen')); if (s && !s.parentElement.open) s.click(); }")
    await page.wait_for_timeout(800)
    await spot(page, "gpxinspect-2", ringe=[f"(() => {{ const s = {TEXT('summary.gpxi-mm-title', 'Heilen')}; return s ? s.parentElement : null; }})()"], breite=900)
    await spot(page, "gpxinspect-3", ringe=[Z("#gpxi-save")], breite=760)
    # Web-Karte
    await modul("webkarte", MASCA, 8000)
    await spot(page, "webkarte-1", ringe=[ALLE(".gpxbar-pick-btn"), Z("#wk-add-track")], breite=900)
    FELD = "(() => {{ const l = {}; return l ? (l.closest('.field') || l.parentElement) : null; }})()"
    await spot(page, "webkarte-2", ringe=[f"[{FELD.format(TEXT('#module-body label', 'Track-Farbe'))}, {FELD.format(TEXT('#module-body label', 'Kartenstil'))}]", Z("#wk-add-label")], breite=1000)
    await spot(page, "webkarte-3", ringe=[Z("#wk-hauptaktion")], breite=760)
    # Geotagger
    await modul("geotagger", MASCA, 5000)
    await page.evaluate("(d) => window.__rzGtOrdnerLaden(d, false)", str(D / "Fotos"))
    await warte(page, "() => !!document.getElementById('gt-track-wahl-ok')", 20)
    await page.evaluate("() => { const b = document.getElementById('gt-track-wahl-ok'); b && b.click(); }")
    await page.wait_for_timeout(9000)
    await spot(page, "geotagger-1", ringe=[f"[{Z('#gt-pick-photos')}, {Z('#gt-pick-folder')}]"], kontext=[Z("#gt-photos")], breite=1000)
    await spot(page, "geotagger-2", ringe=[f"[{Z('#gt-off-display')}, {Z('#gt-off-scale')}]"], breite=1000)
    await spot(page, "geotagger-3", ringe=[f"[{Z('#gt-geocode')}, {Z('#gt-write')}]"], breite=900)


async def main():
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        br = await p.webkit.launch(headless=True)
        page = await br.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=2)
        await page.expose_function("rzBridge", bridge)
        await page.add_init_script(BRIDGE_JS)
        await page.goto(f"file://{(REPO / 'ui' / 'index.html').resolve()}", wait_until="domcontentloaded")
        await page.wait_for_timeout(4000)

        async def modul(slug, gpx=None, ruhe=6000):
            await page.evaluate(f"() => switchMod({json.dumps(slug)})")
            await page.wait_for_timeout(1500)
            if gpx:
                await page.evaluate("(p) => window.loadGlobalGpx(p, { stumm: true })", gpx)
            await page.wait_for_timeout(ruhe)

        if not NUR or "library" in NUR:
            await modul("library")
            await warte(page, "() => document.querySelectorAll('.lib-card, .lib-row, [data-lib-path]').length > 3", 30)
            await page.wait_for_timeout(3000)
            await bild(page, "library")
        if not NUR or "tourseite" in NUR:
            await modul("library", ruhe=1000)
            await page.evaluate("(p) => window.rzTourSeite.oeffnen({ path: p })", MASCA)
            await warte(page, "() => { const b = document.getElementById('ts-strahl'); return b && !b.hidden && !!b.querySelector('.gpxi-lb-profil'); }", 60)
            await warte(page, "() => document.querySelectorAll('.ts-bild img').length > 3", 30)
            await page.wait_for_timeout(4000)
            await bild(page, "tourseite")
            await page.evaluate("() => window.rzTourSeite.schliessen && window.rzTourSeite.schliessen()")
        if not NUR or "medien" in NUR:
            await modul("library", ruhe=1000)
            await page.evaluate("() => document.getElementById('lib-seg-fotos') && document.getElementById('lib-seg-fotos').click()")
            await warte(page, "() => document.querySelectorAll('#lib-fotowrap img').length > 8", 30)
            await page.wait_for_timeout(3000)
            await bild(page, "medien")
            await page.evaluate("() => document.getElementById('lib-seg-touren') && document.getElementById('lib-seg-touren').click()")
        if not NUR or "animator" in NUR:
            await modul("animator", VILAFLOR, 9000)
            await page.evaluate("() => window.__rzScrubZu && window.__rzScrubZu(0.55)")
            await page.wait_for_timeout(6000)
            await bild(page, "animator")
        if not NUR or "tourmap" in NUR:
            await modul("tourmap", VILAFLOR, 9000)
            await bild(page, "tourmap")
        if not NUR or "datenanimator" in NUR:
            await modul("heightanim", VILAFLOR, 6000)
            await bild(page, "datenanimator")
        if not NUR or "gpxinspect" in NUR:
            await modul("gpxinspect", MASCA, 9000)
            await warte(page, "() => document.querySelectorAll('#gpxi-lb-liste .lba-eintrag').length > 3", 30)
            await page.wait_for_timeout(3000)
            await bild(page, "gpxinspect")
        if not NUR or "webkarte" in NUR:
            await modul("webkarte", MASCA, 8000)
            await bild(page, "webkarte")
        if not NUR or "geotagger" in NUR:
            await modul("geotagger", MASCA, 8000)
            await bild(page, "geotagger")
        if not NUR or "schritte" in NUR:
            await schritte(page)
        await br.close()


if __name__ == "__main__":
    asyncio.run(main())
    print("fertig — Demo:", D)
