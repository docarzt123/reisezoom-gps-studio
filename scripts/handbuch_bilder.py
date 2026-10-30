#!/usr/bin/env python3
"""Bilder und kurze Clips fürs Handbuch aus der echten Oberfläche (29.10.2026).

Baut eine frische Demo-Bibliothek (nur die Touren aus DEMO_TOUREN, keine echten Nutzerdaten) in einem Temp-Ordner,
öffnet die App-Oberfläche kopflos (WebKit, echte Brücke) und nimmt je Sprache die Ansichten aus AUFNAHMEN auf.
Ergebnis: docs/img/handbuch/<name>-<sprache>.jpg (1400 px breit) bzw. .mp4 (stumm, Schleife).

    .venv/bin/python scripts/handbuch_bilder.py                 # alle Sprachen, alle Aufnahmen
    .venv/bin/python scripts/handbuch_bilder.py --sprachen de --nur animator,archiv
    .venv/bin/python scripts/handbuch_bilder.py --liste          # Namen der Aufnahmen

Neue Version der App → Skript neu laufen lassen, dann scripts/build_user_guide_html.py.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ZIEL = REPO / "docs" / "img" / "handbuch"
QUELLEN = Path.home() / "GPS-Studio-Test" / "Quellen"
DEMO_TOUREN = [
    QUELLEN / "03-touren" / "2023-05-05_Barranco de Masca Extended Version Erjos ➡️ Masca ➡️ Buenavista-1106845751.gpx",
    *sorted((QUELLEN / "08-teneriffa-woche").glob("*.gpx")),
]
BREITE, HOEHE = 1440, 900          # Fenster (CSS-Pixel)
AUSGABE_BREITE = 1400              # Bildbreite im Handbuch

parser = argparse.ArgumentParser()
parser.add_argument("--sprachen", default="de,en,es")
parser.add_argument("--nur", default="")
parser.add_argument("--liste", action="store_true")
parser.add_argument("--behalten", action="store_true", help="Temp-Ordner nicht löschen (Fehlersuche)")
ARGS = parser.parse_args()

# ── Demo-Umgebung (vor `import app`: App-Ordner über die Umgebung) ─────────────────────────────────────────────────
TMP = Path(tempfile.mkdtemp(prefix="rz-handbuch-", dir=os.environ.get("TMPDIR"))).resolve()
APP_ORDNER, BIB, TOUREN = TMP / "App-Ordner", TMP / "Bibliothek", TMP / "Touren"
for p in (APP_ORDNER, TOUREN):
    p.mkdir(parents=True)
import re as _re
for q in DEMO_TOUREN:
    if q.exists():   # Anzeige-Name ohne Datum/Kennnummer/Emoji: „Barranco de Masca Extended Version …“
        stamm = _re.sub(r"^\d{4}-\d{2}-\d{2}_", "", q.stem)
        stamm = _re.sub(r"-\d{6,}$", "", stamm)
        stamm = _re.sub(r"[^\w\s\-–,.äöüÄÖÜßáéíóúñ]", "", stamm).strip()
        ziel = TOUREN / (stamm + q.suffix)
        txt = q.read_text(encoding="utf-8", errors="replace")
        txt = _re.sub(r"(<trk>\s*<name>)[^<]*(</name>)", lambda m: m.group(1) + stamm + m.group(2), txt, count=1)
        txt = _re.sub(r"(<metadata>\s*<name>)[^<]*(</name>)", lambda m: m.group(1) + stamm + m.group(2), txt, count=1)
        ziel.write_text(txt, encoding="utf-8")
kachel = Path.home() / "GPS-Studio-Test" / "App-Ordner" / "_tilecache"
if kachel.is_dir():
    subprocess.run(["cp", "-c", "-R", str(kachel), str(APP_ORDNER / "_tilecache")], capture_output=True)
(APP_ORDNER / "testrechner.json").write_text(json.dumps({"schreiben_nur_in": [str(TMP)]}))
os.environ.update(RZ_APP_ORDNER=str(APP_ORDNER), RZ_CLOUD_ABLAGE="datei", RZ_CLOUD="0", RZ_KEIN_WILLKOMMEN="1")
sys.path.insert(0, str(REPO))
os.chdir(REPO)
import app as APP  # noqa: E402
import core.bibliothek as cbib  # noqa: E402

cbib.anlegen(BIB)
(APP_ORDNER / "bibliothek.json").write_text(json.dumps({"pfad": str(BIB), "vorher": []}))
APP.BIB = APP.BIB_ORT = APP.DATEN_ORT = BIB
APP.BIB_BEREIT = True
APP.BIB_ERSTSTART = False
APP.LIBRARY_DB = BIB / "library.db"
api = APP.Api()
api.settings_set({"onboarding_done": True})
api.library_add_folder(str(TOUREN))
api.library_scan_start()
time.sleep(1)
for _ in range(240):
    if not api.library_scan_status().get("running"):
        break
    time.sleep(0.5)
MASCA = next(TOUREN.glob("*Masca*.gpx"))
print("Touren in der Demo-Bibliothek:", len(list(TOUREN.glob("*.gpx"))), flush=True)
PID = None


def neues_projekt() -> str:
    """Je Sprache ein frisches Projekt (der Video-Assistent legt beim Öffnen eine Kamerafahrt und eine Titelkarte an)."""
    r = api.schnellvideo_anlegen(str(MASCA), "Barranco de Masca", {"map_style": "free_satellite", "enable_terrain": True, "pitch": 55,
                                                                    "highlights_enabled": True, "smooth_camera_3d": True})
    pid = r.get("project_id")
    api.projekt_umbenennen(pid, "Barranco de Masca")   # umbenannt = eigenes Projekt (nicht „automatisch angelegt“)
    api.projekt_status_setzen(pid, "aktiv")
    # zwei weitere Projekte, damit die Projektliste nach etwas aussieht
    for muster, name, status in (("*Vilaflor*", "Vilaflor – Sombrero", "fertig"), ("*Schildkr*", "Wer sieht die Schildkröte", "idee")):
        g = next(TOUREN.glob(muster + ".gpx"), None)
        if g:
            r2 = api.schnellvideo_anlegen(str(g), name, {"map_style": "free_satellite", "enable_terrain": True})
            if r2.get("project_id"):
                api.projekt_umbenennen(r2["project_id"], name)
                api.projekt_status_setzen(r2["project_id"], status)
    return pid

BRIDGE_JS = r"""(() => { window.__rzKeinPmBoot = true;
  const NATIVE = { pick_save_path: async () => null, pick_file: async () => null, pick_folder: async () => null, open_url: async () => ({ ok: true }),
    set_window_size: async () => ({ ok: true }), get_window_size: async () => ({ width: __B__, height: __H__ }), quit: async () => {}, on_loaded: () => {} };
  const api = new Proxy({}, { get(_t, name) { if (name in NATIVE) return NATIVE[name]; if (typeof name !== "string") return undefined;
    return async (...args) => JSON.parse(await window.rzBridge(name, JSON.stringify(args))); } });
  window.pywebview = { api }; window.dispatchEvent(new Event("pywebviewready")); })();""".replace("__B__", str(BREITE)).replace("__H__", str(HOEHE))

FALSCH_STATUS = {"an": False, "p": 0.0}


def _sync(name, a):
    if name == "animator_status" and FALSCH_STATUS["an"]:
        return json.dumps({"running": True, "progress": FALSCH_STATUS["p"], "status": f"Frame {int(FALSCH_STATUS['p'] * 1200)} / 1200", "cancelled": False})
    fn = getattr(api, name, None)
    if fn is None:
        return json.dumps({"ok": False})
    try:
        return json.dumps(fn(*json.loads(a)), default=str)
    except Exception as e:  # noqa: BLE001
        return json.dumps({"ok": False, "error": str(e)})


async def bridge(name, a):
    return await asyncio.get_running_loop().run_in_executor(None, _sync, name, a)


async def ruhe(page, ms=1500):
    """Karte fertig geladen (falls eine da ist), dann kurz warten."""
    try:
        await page.evaluate("""() => new Promise((r) => { const m = window.__rzAnimMap && window.__rzAnimMap(); let d = false;
          const f = () => { if (d) return; d = true; r(); }; if (!m) return f();
          try { if (m.loaded() && m.areTilesLoaded()) return f(); m.once('idle', f); } catch (_) { f(); } setTimeout(f, 15000); })""")
    except Exception:  # noqa: BLE001
        pass
    await page.wait_for_timeout(ms)


async def warte(page, js, sek=60):
    ende = time.time() + sek
    while time.time() < ende:
        try:
            if await page.evaluate(js):
                return True
        except Exception:  # noqa: BLE001
            pass
        await page.wait_for_timeout(300)
    return False


async def projekt_oeffnen(page):
    await page.evaluate("""(pid) => { window.__rzProjektOeffnenId = pid; window.__rzStartProjekte = true; switchMod("library");
        window.dispatchEvent(new CustomEvent("rz-projekt-oeffnen", { detail: { id: pid, modul: "animator" } })); }""", PID)
    await warte(page, f"() => !!(window.__rzSchnellBereit && window.__rzSchnellBereit('{PID}'))", 90)
    await ruhe(page, 4000)


async def modul(page, name):
    await page.evaluate("(n) => window.switchMod(n)", name)
    await page.wait_for_timeout(2500)
    await ruhe(page, 1500)


async def bild(page, name, sprache, auswahl=None):
    """Bildschirm (oder nur das Element `auswahl`) als JPEG in Handbuch-Breite."""
    # laufende Hintergrund-Vorgänge (Kasten unten rechts) abwarten, höchstens 30 s
    await warte(page, "() => !Array.from(document.querySelectorAll('.rz-status-titel')).some((e) => e.offsetParent)", 30)
    await page.evaluate(OHNE_TEST)
    roh = TMP / f"{name}-{sprache}.png"
    if auswahl:
        await page.locator(auswahl).first.screenshot(path=str(roh))
    else:
        await page.screenshot(path=str(roh))
    ziel = ZIEL / f"{name}-{sprache}.jpg"
    from PIL import Image
    im = Image.open(roh).convert("RGB")
    if im.width > AUSGABE_BREITE:
        im = im.resize((AUSGABE_BREITE, round(im.height * AUSGABE_BREITE / im.width)), Image.LANCZOS)
    im.save(ziel, "JPEG", quality=82, optimize=True, progressive=True)
    print(f"  {ziel.relative_to(REPO)}  ({ziel.stat().st_size // 1024} KB)", flush=True)


# ── Aufnahmen ──────────────────────────────────────────────────────────────────────────────────────────────────────
OHNE_TEST = """() => { const tv = document.getElementById('topbar-version'); if (tv) { tv.textContent = tv.textContent.replace(' · TEST', '');
  tv.classList.remove('ist-testrechner'); } document.body.classList.remove('testrechner'); }"""


async def abschnitt(page, slug):
    """Im Animator genau einen Seitenleisten-Abschnitt aufklappen (ohne die Einstellung zu speichern) und hinscrollen."""
    await page.evaluate("""(slug) => { document.querySelectorAll('[data-accordion-section]').forEach((s) => {
        const h = s.querySelector('.section-collapse-header'), b = s.querySelector('.section-collapse-body'); if (!h || !b) return;
        const an = s.dataset.accordionSection === slug; h.setAttribute('aria-expanded', String(an)); b.hidden = !an; });
      const s = document.querySelector(`[data-accordion-section="${slug}"]`); if (s) s.scrollIntoView({ block: 'start' }); }""", slug)
    await page.wait_for_timeout(900)


async def dialog_zu(page):
    await page.keyboard.press("Escape")
    await page.wait_for_timeout(500)
    await page.evaluate("() => { try { closeAllModals(); } catch (_) {} document.querySelectorAll('.rz-exp-schliessen, .va-zu, .modal-close').forEach((b) => { try { b.click(); } catch (_) {} }); }")
    await page.wait_for_timeout(600)


async def a_archiv(page, sp):
    await modul(page, "library")
    await page.evaluate("() => { const t = document.getElementById('lib-seg-touren'); if (t) t.click(); }")
    await page.wait_for_timeout(3000)
    await bild(page, "archiv-touren", sp)
    # eine Tour anwählen → rechts die Tour mit Karte und Werkzeugen
    await page.evaluate("() => { const k = document.querySelector('.lib-zeile[data-i=\"1\"], .lib-zeile, .lib-card, .lib-row:not(.lib-row-head)'); if (k) k.click(); }")
    await page.wait_for_timeout(3500)
    await bild(page, "archiv-tour-gewaehlt", sp)


async def a_projekte(page, sp):
    await modul(page, "library")
    await page.evaluate("() => { const t = document.getElementById('lib-seg-projekte'); if (t) t.click(); }")
    await page.wait_for_timeout(2500)
    await bild(page, "archiv-projekte", sp)


async def a_animator(page, sp):
    await projekt_oeffnen(page)
    await abschnitt(page, "__keiner__")
    await bild(page, "animator-uebersicht", sp)
    for slug, name in (("format", "animator-format"), ("map", "animator-karte"), ("tours", "animator-tracks"),
                       ("camera", "animator-kamera"), ("overlays", "animator-einblendungen"), ("signs", "animator-schilder"),
                       ("logbuch", "animator-logbuch"), ("ton", "animator-ton")):
        await abschnitt(page, slug)
        await bild(page, name, sp)
    await abschnitt(page, "__keiner__")


async def a_dialoge(page, sp):
    await projekt_oeffnen(page)
    await page.evaluate("() => document.getElementById('anim-hauptaktion')?.click()")
    await page.wait_for_timeout(2000)
    await bild(page, "export-dialog", sp)
    await dialog_zu(page)
    await page.evaluate("() => document.getElementById('anim-schnellvideo')?.click()")
    await page.wait_for_timeout(3000)
    await bild(page, "schnellvideo", sp)
    await dialog_zu(page)
    await page.evaluate("() => document.getElementById('anim-videoassistent')?.click()")
    await page.wait_for_timeout(3500)
    await bild(page, "videoassistent", sp)
    await dialog_zu(page)


async def a_module(page, sp):
    for m, name in (("tourmap", "tourmap"), ("reiseroute", "reiseroute"), ("webkarte", "webkarte"), ("heightanim", "datenanimator"),
                    ("geotagger", "geotagger"), ("gpxinspect", "gpx-inspektor")):
        await modul(page, m)
        await page.wait_for_timeout(2500)
        await bild(page, name, sp)


def clip_speichern(webm: Path, name: str, sprache: str, von_s: float = 0.0, bis_s: float = 0.0, ausschnitt=None):
    """Aufnahme (webm) → stummes MP4 fürs Handbuch: 960 px breit, H.264, Schleife im Handbuch."""
    ziel = ZIEL / f"{name}-{sprache}.mp4"
    vf = []
    if ausschnitt:
        x, y, w, h = (int(round(v)) for v in ausschnitt)
        vf.append(f"crop={w - w % 2}:{h - h % 2}:{x}:{y}")
    vf.append("scale=960:-2")
    cmd = ["ffmpeg", "-v", "error", "-y"] + (["-ss", f"{von_s:.2f}"] if von_s else []) + ["-i", str(webm)] \
        + (["-t", f"{bis_s - von_s:.2f}"] if bis_s else []) \
        + ["-vf", ",".join(vf), "-an", "-c:v", "libx264", "-crf", "28", "-preset", "slow", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(ziel)]
    subprocess.run(cmd, check=True)
    print(f"  {ziel.relative_to(REPO)}  ({ziel.stat().st_size // 1024} KB)", flush=True)


async def _aufnahme(browser, sprache, schritte, name, **kw):
    """Eigener Kontext mit Video-Aufnahme: App laden, `schritte(page)` ausführen, Clip speichern."""
    vid = TMP / f"vid-{name}-{sprache}"
    ctx = await browser.new_context(viewport={"width": BREITE, "height": HOEHE}, record_video_dir=str(vid),
                                    record_video_size={"width": BREITE, "height": HOEHE})
    page = await ctx.new_page()
    await page.expose_function("rzBridge", bridge)
    await page.add_init_script(BRIDGE_JS)
    await page.goto(f"file://{(REPO / 'ui/index.html').resolve()}", wait_until="domcontentloaded")
    await page.wait_for_timeout(3500)
    await page.evaluate("() => { try { closeAllModals(); } catch (_) {} }")
    t0 = time.time()
    info = await schritte(page) or {}
    await page.evaluate(OHNE_TEST)
    dauer = time.time() - t0
    await ctx.close()
    webm = next(vid.glob("*.webm"))
    # die Aufnahme beginnt mit dem Kontext; der gewünschte Teil liegt am Ende (info["sekunden"] lang)
    gesamt = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(webm)],
                                  capture_output=True, text=True).stdout.strip() or 0)
    lang = info.get("sekunden", 6.0)
    clip_speichern(webm, name, sprache, von_s=max(0.0, gesamt - lang - 0.3), bis_s=max(0.0, gesamt - 0.3), ausschnitt=info.get("ausschnitt"))
    _ = dauer


async def c_vorschau(page):
    await projekt_oeffnen(page)
    await page.evaluate(OHNE_TEST)
    await page.evaluate("() => document.querySelector('[data-tp=\"play\"]')?.click()")
    await page.wait_for_timeout(8000)
    # Vorschau und Zeitleiste (rechts neben der Seitenleiste)
    box = await page.evaluate("""() => { const v = document.getElementById('anim-viewport')?.getBoundingClientRect(); if (!v) return null;
        const x = Math.max(0, v.x - 16), y = Math.max(0, v.y - 16); return [x, y, innerWidth - x, innerHeight - y]; }""")
    return {"sekunden": 7.5, "ausschnitt": box}


async def c_wanderung(page):
    await projekt_oeffnen(page)
    await page.evaluate(OHNE_TEST)
    FALSCH_STATUS.update(an=True, p=0.0)
    try:
        await page.evaluate("() => { try { setRenderingState(true); } catch (_) {} document.getElementById('anim-progress')?.classList.add('show'); }")
        # Animator neu einhängen → er hängt sich an den (vorgetäuschten) laufenden Render
        await page.evaluate("() => window.switchMod('library')"); await page.wait_for_timeout(1200)
        await page.evaluate("() => window.switchMod('animator')"); await page.wait_for_timeout(2500)
        for i in range(48):
            FALSCH_STATUS["p"] = min(1.0, i / 44)
            await page.wait_for_timeout(250)
        # nur Wanderung + Prozentzahl, ohne die leere Vorschaufläche darüber
        box = await page.evaluate("""() => { const t = document.getElementById('anim-tour')?.getBoundingClientRect(),
            p = document.getElementById('anim-progress')?.getBoundingClientRect(); if (!t || !p) return null;
            const y0 = Math.max(p.y, t.y - 70), y1 = Math.min(p.y + p.height, t.y + t.height + 70);
            return [p.x + 20, y0, p.width - 40, y1 - y0]; }""")
    finally:
        FALSCH_STATUS.update(an=False)
    return {"sekunden": 11.5, "ausschnitt": box}


KLIPS = {"vorschau-abspielen": c_vorschau, "render-wanderung": c_wanderung}


async def a_clips(page, sp):
    for name, fn in KLIPS.items():
        await _aufnahme(page.context.browser, sp, fn, name)


# Reihenfolge: Dialoge zuletzt (der Video-Assistent legt schon beim Öffnen eine Kamerafahrt ins Projekt)
# „projekte“ nach „animator“: ein frisch angelegtes Projekt steht erst nach dem ersten Öffnen in der Liste
AUFNAHMEN = {"archiv": a_archiv, "animator": a_animator, "projekte": a_projekte, "module": a_module, "clips": a_clips,
             "dialoge": a_dialoge}


async def main():
    from playwright.async_api import async_playwright
    ZIEL.mkdir(parents=True, exist_ok=True)
    nur = [x for x in ARGS.nur.split(",") if x]
    async with async_playwright() as p:
        b = await p.webkit.launch(headless=True)
        for sp in [x for x in ARGS.sprachen.split(",") if x]:
            print(f"== {sp} ==", flush=True)
            api.settings_set({"language": sp})
            global PID
            PID = neues_projekt()
            ctx = await b.new_context(viewport={"width": BREITE, "height": HOEHE}, device_scale_factor=2)
            page = await ctx.new_page()
            fehler = []
            page.on("pageerror", lambda e: fehler.append(str(e)[:200]))
            await page.expose_function("rzBridge", bridge)
            await page.add_init_script(BRIDGE_JS)
            await page.goto(f"file://{(REPO / 'ui/index.html').resolve()}", wait_until="domcontentloaded")
            await page.wait_for_timeout(3500)
            await page.evaluate("() => { try { closeAllModals(); } catch (_) {} }")
            for name, fn in AUFNAHMEN.items():
                if nur and name not in nur:
                    continue
                try:
                    await fn(page, sp)
                except Exception as e:  # noqa: BLE001
                    print(f"  ⚠️  {name}: {e}", flush=True)
            if fehler:
                print("  JS-Fehler:", fehler[:3])
            await ctx.close()
        await b.close()


if ARGS.liste:
    print("\n".join(AUFNAHMEN))
    sys.exit(0)
try:
    asyncio.run(main())
finally:
    if not ARGS.behalten:
        shutil.rmtree(TMP, ignore_errors=True)
