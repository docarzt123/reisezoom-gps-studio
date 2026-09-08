"""core/szene.py — Render über die GEMEINSAME Szene (06.09.2026).

Marc: „ich will 1:1 das in der vorschau, wie im fertigen video … das kriegen
wir nur hin, wenn es die gleiche pipeline hat."

Bis hierhin gab es zwei Implementierungen derselben Szene: die Vorschau in
modules/animator/ui/module.js und eine aus Python erzeugte Render-Seite in
core/animator.py. Jede Abweichung (Liniendicke, Strichelung, Luftbild-Rampe,
Schildgrößen, Kamera) kam daher. Jetzt fährt der Render die VORSCHAU selbst:

  1. kopfloses Chromium, Fenster = Video in CSS-Pixeln, device_scale_factor
     liefert die Gerätepixel (4K = 1920×1080 CSS × 2, plus SSAA wie bisher)
  2. ui/index.html laden — dieselbe App, dieselben Module — mit einer Brücke
     zur laufenden app.Api (nur lesend: Schreibaufrufe werden abgefangen)
  3. Projekt öffnen wie im Archiv (`rzProjektOeffnen`), Render-Modus: nur der
     Animator-Viewport ist sichtbar, k = 1 (keine Vorschau-Verkleinerung)
  4. Probelauf im Schrittmodus starten und Bild für Bild `seek(t)` rufen —
     dieselbe Schleife, die den Probelauf in der App treibt
  5. Screenshot je Bild → ffmpeg (FrameMuxer), wie beim klassischen Render

Der klassische Generator (core/animator.render) bleibt als Rückfall:
`RZ_RENDER_KLASSISCH=1` oder settings.render_engine = "klassisch".
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import re
import sys
import time
from pathlib import Path
from typing import Callable, Optional

from . import animator as A
from .frame_driver import FrameMuxer, muxer_fuer, teildatei

_log = logging.getLogger("animator.szene")

ROOT = Path(getattr(sys, "_MEIPASS", None) or Path(__file__).resolve().parent.parent)
UI_INDEX = ROOT / "ui" / "index.html"

# Brücken-Aufrufe, die die kopflose Vorschau NICHT ausführen darf: sie liefe
# sonst Einstellungen, Projektstände, Archiv- und Cloud-Daten der echten App
# um. Antwort ist ein stilles {"ok": true}.
_SCHREIBEND = re.compile(
    r"^(settings_set|settings_reset_module|save_user_defaults|reset_user_defaults"
    r"|session_(set_active_project|create_project|rename_project|delete_project|update_project_settings|update_project_root|projekte_uebernehmen)"
    r"|projekt_(modul_merken|status_setzen|umbenennen|loeschen|duplizieren|touren_setzen|version_setzen|fassung_aktualisieren|stand_wiederherstellen|frei_anlegen|importieren|exportieren)"
    r"|projekte_loeschen|library_(set_|clear_|save_|trash|forget|add_folder|remove_folder|import_|merge|collection_|track_ersetzen|dismiss|scan_start|map_thumbs_start|places_start)"
    r"|tour_(extern_entscheiden|version_loeschen|version_exportieren|fassung_wiederherstellen)"
    r"|cloud_|drop_|geotagger_(register|remove|write|start_write|export|clear)|gpxinspect_(save|append)|bibliothek_(umzug|festlegen|erneut|wiederherstellen|umziehen|ordner_waehlen)"
    r"|animator_start_render|animator_cancel|tourmap_render|heightanim_start_render|pick_|open_|reveal|save_log|quit|set_window|check_for_update|update_dismiss)"
)

# Aufrufe, die die kopflose Seite nie nativ machen darf (Dialoge, Fenster).
_BRIDGE_JS = r"""
(() => {
  window.__rzKeinPmBoot = true;
  window.__rzRenderMode = __RZ_MODE__;
  window.__rzKeep = __RZ_KEEP__;   // Diagnose: Render-Modus-Abkürzungen einzeln behalten (RZ_KEEP=trans,fade,rfade,globe)
  window.__rzStepMode = true;
  window.__rzStarsManual = true;
  window.__rzRightsAck = true;
  const NATIVE = {
    pick_save_path: async () => null, pick_file: async () => null, pick_folder: async () => null,
    set_window_size: async () => ({ ok: true }), get_window_size: async () => ({ width: __RZ_MODE__.w, height: __RZ_MODE__.h }),
    quit: async () => {}, on_loaded: () => {}, open_url: async () => ({ ok: true }),
  };
  const api = new Proxy({}, {
    get(_t, name) {
      if (name in NATIVE) return NATIVE[name];
      if (typeof name !== "string") return undefined;
      return async (...args) => { const res = await window.rzBridge(name, JSON.stringify(args)); return JSON.parse(res); };
    },
  });
  window.pywebview = { api };
  document.addEventListener("DOMContentLoaded", () => { try {
    document.body.classList.add("rz-render-mode");
    if (__RZ_MODE__.blur > 0) { const st = document.createElement("style"); st.textContent = "#anim-viewport .maplibregl-canvas, #anim-viewport .mapboxgl-canvas { filter: blur(" + __RZ_MODE__.blur + "px); }"; document.head.appendChild(st); }
  } catch (_) {} });
  window.dispatchEvent(new Event("pywebviewready"));
})();
"""


def _bridge_factory(api):
    def bridge(name: str, args_json: str) -> str:
        try:
            args = json.loads(args_json or "[]")
        except Exception:
            args = []
        if _SCHREIBEND.match(name):
            return json.dumps({"ok": True, "szene": "read-only"})
        fn = getattr(api, name, None)
        if fn is None or name.startswith("_"):
            return json.dumps({"ok": False, "error": f"no bridge {name}"})
        try:
            res = fn(*args)
        except Exception as e:      # noqa: BLE001
            return json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"})
        try:
            return json.dumps(res, default=str)
        except Exception:
            return json.dumps({"ok": True})
    return bridge


def _ffmpeg_cmd(cfg) -> list[str]:
    """Wie core/animator.render — Codec-Zweige 1:1 (h264/h265/prores/prores422)."""
    ffmpeg_bin = A.find_ffmpeg()
    codec = (cfg.codec or "h264").lower()
    if codec in ("prores", "prores4444") and cfg.transparent_background:
        cmd = [ffmpeg_bin, "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", str(cfg.fps), "-i", "-",
               *A._vf_args(cfg), "-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", "yuva444p10le", "-vendor", "ap10"]
    elif codec == "prores422":
        cmd = [ffmpeg_bin, "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", str(cfg.fps), "-i", "-",
               *A._vf_args(cfg), "-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le", "-vendor", "ap10"]
    elif codec in ("prores", "prores4444"):
        cmd = [ffmpeg_bin, "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", str(cfg.fps), "-i", "-",
               *A._vf_args(cfg), "-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", "yuv444p10le", "-vendor", "ap10"]
    else:
        vcodec = "libx265" if codec in ("h265", "hevc") else "libx264"
        cmd = [ffmpeg_bin, "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", str(cfg.fps), "-i", "-",
               *A._vf_args(cfg),
               "-c:v", vcodec, "-preset", (cfg.encoder_preset or "fast"), "-crf", str(cfg.crf),
               "-pix_fmt", "yuv420p", "-movflags", "+faststart"]
        if vcodec == "libx265":
            cmd += ["-tag:v", "hvc1"]
    cmd += ["-f", muxer_fuer(cfg.output_path), teildatei(cfg.output_path)]
    return cmd


_SEEK2 = os.environ.get("RZ_SEEK2", "0") == "1"   # Diagnose: RZ_SEEK2=1 = zwei Sprünge je Bild (brachte nichts, kostet 2×)

_WARTE_BILD_JS = """async () => {
  const m = window.__rzLetzteKarte; if (!m) return false;
  const t0 = performance.now();
  const fertig = () => { try { return m.loaded() && m.areTilesLoaded() && !m.isMoving() && !m.isZooming() && !m.isEasing(); } catch (_) { return true; } };
  if (!fertig()) {
    await new Promise((r) => { let done = false; const on = () => { if (done) return; done = true; try { m.off('idle', on); } catch (_) {} r(); };
      try { m.on('idle', on); } catch (_) { r(); } setTimeout(on, 5000); });
  }
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 60)));
  return performance.now() - t0;
}"""


async def _warte_auf(page, js: str, timeout_s: float, was: str, is_cancelled=None, intervall: float = 0.25):
    t0 = time.time()
    letzte = None
    naechster_log = t0 + 20
    while time.time() - t0 < timeout_s:
        if time.time() > naechster_log:
            naechster_log = time.time() + 20
            _log.info("Szene: warte auf %s … zuletzt %s", was, json.dumps(letzte)[:240])
        if is_cancelled and is_cancelled():
            raise A.RenderCancelled()
        try:
            letzte = await page.evaluate(js)
        except Exception as e:      # noqa: BLE001
            letzte = {"err": str(e)[:200]}
        if isinstance(letzte, dict) and letzte.get("ok"):
            return letzte
        if letzte is True:
            return letzte
        await asyncio.sleep(intervall)
    raise RuntimeError(f"Szene: Warten auf {was} abgebrochen nach {timeout_s:.0f}s — zuletzt {json.dumps(letzte)[:300]}")


async def _seite_vorbereiten(p, cfg, api, projekt_id: str, is_cancelled, emit, params=None, modul: Optional[str] = None):
    """Chromium starten, App laden, Projekt öffnen, Render-Modus. Liefert (browser, page, dsf, ss)."""
    t_pw = time.time()
    browser = await p.chromium.launch(
        headless=True,
        args=["--use-angle=default", "--enable-webgl", "--ignore-gpu-blocklist", "--disable-gpu-sandbox",
              "--disable-background-networking", "--disable-features=MediaRouter,DialMediaRouteProvider",
              "--no-first-run", "--no-default-browser-check", "--allow-file-access-from-files"],
    )
    _log.info("Szene: Chromium gestartet in %.1fs", time.time() - t_pw)
    # Video = Vorschau hochaufgelöst: Fenster in CSS-px GENAU so groß wie der Vorschau-
    # Viewport in der App (params.szene_vorschau_w/h), device_scale_factor = Video / Vorschau.
    # Damit sind Linien, Schilder, Beschriftungen, Overlays, Zoom exakt die der Vorschau —
    # ohne Umrechnung (kein Zoom-Versatz, kein Größenfaktor). SSAA wie bisher obendrauf.
    ss = A._render_ss(cfg.width, cfg.height)
    pw = int((params or {}).get("szene_vorschau_w") or 0); ph = int((params or {}).get("szene_vorschau_h") or 0)
    if pw < 200 or ph < 100:
        pw = max(1, int(round(cfg.width / A._render_dsf(cfg.width, cfg.height)))); ph = max(1, int(round(cfg.height / A._render_dsf(cfg.width, cfg.height))))
        _log.warning("Szene: keine Vorschau-Größe übergeben — nehme %dx%d CSS", pw, ph)
    # Seitenverhältnis exakt wie das Video (Letterbox-Rundung der Vorschau ausgleichen)
    ph = max(1, int(round(pw * cfg.height / cfg.width)))
    dsf = cfg.width / pw
    vp_w, vp_h = pw, ph
    _log.info("Szene: Viewport %dx%d CSS (= Vorschau) · DSF %.3f · SSAA %.2f · Ausgabe %dx%d", vp_w, vp_h, dsf, ss, cfg.width, cfg.height)
    page = await browser.new_page(viewport={"width": vp_w, "height": vp_h}, device_scale_factor=dsf * ss)
    fehler: list[str] = []
    page.on("pageerror", lambda e: fehler.append(str(e)[:300]))
    page.on("console", lambda m: _log.info("Szene page.console [%s] %s", m.type, m.text[:300]) if m.type in ("error", "warning") and "GPU stall" not in m.text and "Fog" not in m.text else None)
    await page.expose_function("rzBridge", _bridge_factory(api))
    # „Karte glätten" wie im klassischen Render: nur mit SSAA (4K), CSS-Blur auf der Karten-Canvas.
    blur_css = (max(0.0, float(cfg.map_smoothing or 0)) / dsf) if ss > 1.0 else 0.0
    # Zoom-Versatz Vorschau → Video: Keyframes/manuelle Kamera/static_zoom sind im Zoom
    # der VORSCHAU gespeichert (kleinerer Viewport). Wie im klassischen Render:
    # abs_shift = zoom_correction (UI: log2(rw / Vorschau-Breite)) − log2(dsf).
    mode = {"w": vp_w, "h": vp_h, "fps": cfg.fps, "width": cfg.width, "height": cfg.height, "blur": round(blur_css, 3),
            "zoomShift": 0.0,   # Viewport = Vorschau → kein Zoom-Versatz
            # 07.09.2026 — Paint-Übergangsdauer im Render-Modus. 0 ms wäre 2× schneller, ließ aber auf
            # Gelände-Stilen (Fuji OSM, Teide Satellit) die Rasterkacheln beim Zoomen in ganzen
            # Abschnitten ungezeichnet (WYS mean_diff 22/17 statt 3/5; 60 ms genauso); 300 ms = MapLibre-
            # Standard ist korrekt. Ursache offen (IDEAS §53a), RZ_TRANS_MS zum Messen.
            "transMs": int(os.environ.get("RZ_TRANS_MS", "300") or 0)}
    _keep = {k: True for k in (os.environ.get("RZ_KEEP") or "").split(",") if k}
    await page.add_init_script(_BRIDGE_JS.replace("__RZ_MODE__", json.dumps(mode)).replace("__RZ_KEEP__", json.dumps(_keep)))
    emit(0.02, "Szene: App laden …")
    await page.goto(f"file://{UI_INDEX.resolve()}", wait_until="domcontentloaded")
    # Kachel-Cache erst NACH dem Laden der Seite einhängen: die Routen-Abfangung
    # ließ das file://-Laden der App mit net::ERR_FAILED scheitern (06.09.2026).
    try:
        page._rz_tile_stats = await A._install_tile_cache(page, cfg)
    except Exception as e:      # noqa: BLE001
        _log.warning("Szene: Kachel-Cache nicht installiert: %s", e)
    await _warte_auf(page, "() => ({ ok: !!(window.RZGPS_MODULES && window.switchMod && window.loadGlobalGpx) })", 30, "App-Start", is_cancelled)
    await page.wait_for_timeout(1500)
    emit(0.04, "Szene: Projekt öffnen …")
    await page.evaluate("() => { try { window.switchMod('library'); } catch (_) {} }")
    await _warte_auf(page, "() => ({ ok: typeof window.rzProjektOeffnen === 'function' })", 20, "Archiv", is_cancelled)
    # Projekte-Reiter zeigen: erst damit kennt das Archiv die Projektliste (haupt_pfad usw.)
    await page.evaluate("() => { const t = document.getElementById('lib-seg-projekte'); if (t) t.click(); }")
    await _warte_auf(page, f"() => ({{ ok: !!document.querySelector('[data-open={json.dumps(projekt_id)}]') }})", 30, "Projektkarte", is_cancelled)
    await page.wait_for_timeout(500)
    # 07.09.2026 — das Archiv öffnet direkt im gewünschten Modul (Animator, Reiseroute, Tour-Map)
    await page.evaluate(f"() => {{ window.rzProjektOeffnen({json.dumps(projekt_id)}, {json.dumps(modul or 'animator')}); }}")
    # Bereit = Animator hat Karte + Stil + Kacheln + Track, keine offene Übergabe, kein Lade-Modal.
    bereit_js = """() => { try { const b = window.__rzAnimBereit && window.__rzAnimBereit(); if (!b) return { ok: false, grund: 'kein Animator', mod: (typeof activeMod !== 'undefined' ? activeMod : null), karte: !!window.__rzLetzteKarte, body: (document.body && document.body.innerText || '').slice(0, 160).replace(/\\s+/g, ' ') };
        const ok = b.map && b.style && b.tiles && b.coords >= 2 && !b.pending && !b.modal && b.fitBase != null && b.route !== false; return Object.assign({ ok }, b); } catch (e) { return { ok: false, err: String(e) }; } }"""
    info = await _warte_auf(page, bereit_js, 240, "Projekt/Animator", is_cancelled, intervall=0.5)
    _log.info("Szene: Animator bereit — %s", json.dumps(info)[:300])
    aktiv = await page.evaluate("() => (typeof activeMod !== 'undefined' ? activeMod : null)")
    if modul and modul != "animator" and aktiv != modul:
        # 07.09.2026 — Rückfall: falls das Archiv nicht im gewünschten Modul geöffnet hat
        # (Reiseroute und Tour-Map sind dasselbe Animator-Modul in anderem Modus), ausdrücklich
        # umschalten und auf die frische Bereitschaft der neuen Einhängung warten.
        emit(0.045, f"Szene: Modul {modul} …")
        await page.evaluate(f"() => {{ window.__rzAnimBereit = null; window.switchMod({json.dumps(modul)}); }}")
        await _warte_auf(page, f"() => ({{ ok: (typeof activeMod !== 'undefined' && activeMod === {json.dumps(modul)}) && typeof window.__rzAnimBereit === 'function' }})", 60, f"Modul {modul}", is_cancelled)
        info = await _warte_auf(page, bereit_js, 240, f"Modul {modul} bereit", is_cancelled, intervall=0.5)
        _log.info("Szene: %s bereit — %s", modul, json.dumps(info)[:300])
    # Nachladen (Gelände-Kacheln, Schilder-Bilder) kurz Zeit geben, dann Viewport prüfen.
    await page.wait_for_timeout(2500)
    vp = await page.evaluate("() => { const v = document.getElementById('anim-viewport'); const r = v && v.getBoundingClientRect(); return r ? { x: r.x, y: r.y, w: r.width, h: r.height, k: getComputedStyle(v).getPropertyValue('--rz-prev-k') } : null; }")
    _log.info("Szene: Viewport im Fenster %s", json.dumps(vp))
    if not vp or abs(vp["w"] - vp_w) > 2 or abs(vp["h"] - vp_h) > 2 or abs(vp["x"]) > 1 or abs(vp["y"]) > 1:
        raise RuntimeError(f"Szene: Viewport nicht bildfüllend ({json.dumps(vp)}, erwartet {vp_w}x{vp_h} bei 0,0)")
    if fehler:
        _log.warning("Szene: JS-Fehler beim Laden: %s", fehler[:3])
    return browser, page, dsf, ss


async def render_szene(cfg, *, api, projekt_id: str, params: Optional[dict] = None,
                       on_progress: Optional[Callable[[float, str], None]] = None,
                       on_preview: Optional[Callable[[str], None]] = None,
                       is_cancelled: Optional[Callable[[], bool]] = None,
                       modul: str = "animator") -> str:
    """Video über die gemeinsame Szene rendern (siehe Modul-Doku)."""
    from playwright.async_api import async_playwright

    def emit(p: float, msg: str) -> None:
        if on_progress:
            try: on_progress(p, msg)
            except Exception: pass

    intro_frames = max(0, int(round(float(getattr(cfg, "intro_s", 0) or 0) * cfg.fps)))
    anim_frames = max(1, int(round(cfg.duration_s * cfg.fps)))
    hold_frames = int(round(cfg.hold_s * cfg.fps))
    total_frames = intro_frames + anim_frames + hold_frames
    _log.info("Szene-Render: Projekt %s · %d Bilder @ %d fps (%s+%s+%s s) · %dx%d · %s",
              projekt_id, total_frames, cfg.fps, getattr(cfg, "intro_s", 0), cfg.duration_s, cfg.hold_s,
              cfg.width, cfg.height, cfg.codec)

    async with async_playwright() as p:
        browser, page, dsf, ss = await _seite_vorbereiten(p, cfg, api, projekt_id, is_cancelled, emit, params, modul=modul)
        try:
            emit(0.05, "Szene: Probelauf im Schrittmodus …")
            await page.evaluate("() => window.__rzPreviewRun()")
            await _warte_auf(page, "() => ({ ok: !!(window.__rzPreviewStep && window.__rzPreviewStep.ready) })", 120, "Probelauf-Start", is_cancelled)
            total_ms = await page.evaluate("() => window.__rzPreviewStep.totalMs")
            erwartet_ms = total_frames / cfg.fps * 1000
            if abs(float(total_ms) - erwartet_ms) > 1000:
                _log.warning("Szene: Vorschau-Dauer %.0f ms ≠ Render-Dauer %.0f ms — die Vorschau bestimmt", float(total_ms), erwartet_ms)
            # 08.09.2026 - Kacheln vorwaermen (wie der klassische Pfad seit v0.9.19 ueber
            # window.prewarmTiles): N Haltepunkte ueber die Zeitachse, je einmal auf idle
            # warten. Die Karte holt die Kacheln je Halt gebuendelt und parallel; ohne das
            # wartet die Bildschleife bei jedem Bild einzeln auf Nachzuegler. Marcs 4K-Lauf
            # vom 08.09.: 1826 Fehlgriffe im Zwischenspeicher, 2,1 s je Bild gegen 0,75 s
            # warm. RZ_VORWAERMEN=0 schaltet es ab (Pruefstand).
            # Dichte: rund 6 Haltepunkte je Sekunde Video, mindestens 12, hoechstens 200.
            # Kalt gemessen (Masca, 4 s, 4K): ohne 2336 ms/Bild, 24 Halte 1703, 48 Halte 1611.
            _vw_std = max(12, min(200, round(total_frames / max(1, cfg.fps) * 6)))
            _vorwaermen = int(os.environ.get("RZ_VORWAERMEN", str(_vw_std)) or 0)
            if _vorwaermen > 1:
                _t_vw = time.time()
                emit(0.05, f"Szene: Kacheln vorwärmen ({_vorwaermen}) …")
                for _i in range(_vorwaermen):
                    if is_cancelled and is_cancelled():
                        raise A.RenderCancelled()
                    _tv = (total_frames - 1) / cfg.fps * _i / (_vorwaermen - 1)
                    await page.evaluate(f"() => window.__rzPreviewStep.seek({_tv:.6f})")
                    await page.evaluate(_WARTE_BILD_JS)
                _log.info("Szene: Kacheln vorgewärmt an %d Haltepunkten in %.1fs", _vorwaermen, time.time() - _t_vw)
            # 08.09.2026 - Verkleinern uebernimmt ffmpeg (siehe _vf_args/_grab_frame).
            cfg.skalieren_in_ffmpeg = True
            mux = FrameMuxer(_ffmpeg_cmd(cfg), cfg.output_path, total_frames, log=_log, cancelled_cls=A.RenderCancelled)
            preview_every = max(1, cfg.fps // 10)
            try:
                for frame in range(total_frames):
                    if is_cancelled and is_cancelled():
                        raise A.RenderCancelled()
                    t = frame / cfg.fps
                    await page.evaluate(f"() => window.__rzPreviewStep.seek({t:.6f})")
                    await page.evaluate(_WARTE_BILD_JS)
                    if _SEEK2:
                        # 07.09.2026 — mit Gelände bezieht MapLibre die Kamerahöhe auf die Bodenhöhe im
                        # Mittelpunkt; kommen DEM-Kacheln erst nach dem Sprung, stimmt der Ausschnitt nicht
                        # (Einzelbild-Weg macht das seit 06.09. so). Zweiter Sprung nach dem Laden.
                        await page.evaluate(f"() => window.__rzPreviewStep.seek({t:.6f})")
                        await page.evaluate(_WARTE_BILD_JS)
                    shot = await A._grab_frame(page, cfg)
                    if frame <= 2:
                        for _k in range(6):
                            if A._frame_black_ratio(shot) < 0.05:
                                break
                            _log.warning("Szene Frame %d: Bild schwarz — neu greifen (%d/6)", frame + 1, _k + 1)
                            await asyncio.sleep(0.5)
                            await page.evaluate(_WARTE_BILD_JS)
                            shot = await A._grab_frame(page, cfg)
                    mux.schreiben(shot, frame + 1)
                    if on_preview and frame % preview_every == 0:
                        try: on_preview(base64.b64encode(shot).decode("ascii"))
                        except Exception: pass
                    emit(0.05 + 0.87 * (frame + 1) / total_frames, f"Frame {frame + 1} / {total_frames}")
            except BaseException as _fehler:
                mux.abbrechen("abgebrochen" if isinstance(_fehler, A.RenderCancelled) else "Fehler")
                raise
            emit(0.92, "ffmpeg finalisiert …")
            mux.abschliessen(is_cancelled)
            _log.info("Szene: Kacheln %s", json.dumps(getattr(page, "_rz_tile_stats", None)))
        finally:
            try: await browser.close()
            except Exception: pass
    emit(1.0, "Fertig.")
    return cfg.output_path


async def render_szene_still(cfg, *, api, projekt_id: str, params: Optional[dict] = None,
                             on_progress: Optional[Callable[[float, str], None]] = None,
                             is_cancelled: Optional[Callable[[], bool]] = None) -> str:
    """Tour-Map-Standbild aus der gemeinsamen Szene: die Tour-Map-Vorschau (Animator im
    staticFrame-Modus: ganzer Track, alle Schilder/Pins, Tour-Map-Kamera) in Videogröße
    als PNG nach cfg.output_path. 07.09.2026 — Marc: Tour-Map auf die Szene."""
    from playwright.async_api import async_playwright

    def emit(p: float, msg: str) -> None:
        if on_progress:
            try: on_progress(p, msg)
            except Exception: pass

    async with async_playwright() as p:
        browser, page, dsf, ss = await _seite_vorbereiten(p, cfg, api, projekt_id, is_cancelled, emit, params, modul="tourmap")
        try:
            emit(0.6, "Szene: Standbild …")
            # Kacheln/Gelände/Schilder nachladen lassen, dann zweimal ruhig abwarten (Kamerahöhe mit Gelände)
            for _k in range(2):
                await page.evaluate(_WARTE_BILD_JS)
                await page.wait_for_timeout(400)
            await page.evaluate(_WARTE_BILD_JS)
            alt = cfg.frame_format
            try:
                cfg.frame_format = "png"
                shot = await A._grab_frame(page, cfg)
            finally:
                cfg.frame_format = alt
            Path(cfg.output_path).write_bytes(shot)
            _log.info("Szene: Standbild %dx%d → %s", cfg.width, cfg.height, cfg.output_path)
        finally:
            try: await browser.close()
            except Exception: pass
    emit(1.0, "Fertig.")
    return cfg.output_path


async def render_szene_frame(cfg, *, api, projekt_id: str, t_sek: float, params: Optional[dict] = None,
                             on_progress: Optional[Callable[[float, str], None]] = None,
                             is_cancelled: Optional[Callable[[], bool]] = None,
                       modul: str = "animator") -> str:
    """Ein Standbild der gemeinsamen Szene zur Videozeit t_sek (PNG → cfg.output_path)."""
    from playwright.async_api import async_playwright

    def emit(p: float, msg: str) -> None:
        if on_progress:
            try: on_progress(p, msg)
            except Exception: pass

    async with async_playwright() as p:
        browser, page, dsf, ss = await _seite_vorbereiten(p, cfg, api, projekt_id, is_cancelled, emit, params, modul=modul)
        try:
            await page.evaluate("() => window.__rzPreviewRun()")
            await _warte_auf(page, "() => ({ ok: !!(window.__rzPreviewStep && window.__rzPreviewStep.ready) })", 120, "Probelauf-Start", is_cancelled)
            # Zweimal suchen: der erste Sprung lädt Kacheln/DEM für die neue Kamera nach, und
            # MapLibre bezieht die Kamerahöhe mit Gelände auf die Bodenhöhe im Mittelpunkt —
            # erst der zweite Sprung nach dem Laden steht exakt wie das Video (das Bild für
            # Bild springt). Gemessen 06.09.2026: sonst ~1 % Bildhöhe Versatz (Teide, Lofoten).
            for _k in range(2):
                await page.evaluate(f"() => window.__rzPreviewStep.seek({float(t_sek):.6f})")
                await page.evaluate(_WARTE_BILD_JS)
                await page.wait_for_timeout(300)
            # 07.09.2026 — Globus-Fehlerkorrektur (Vendor-Patch globeerr) gleicht sich auf der
            # Video-Uhr an; ein Einzelbild hat keine Vorgeschichte, also die Uhr eine Sekunde
            # vorstellen und neu zeichnen, damit die Korrektur wie im laufenden Video ankommt.
            await page.evaluate(f"() => {{ window.__rzRenderClock = () => {float(t_sek) * 1000 + 1000:.1f}; try {{ window.__rzLetzteKarte.triggerRepaint(); }} catch (_) {{}} }}")
            await page.evaluate(_WARTE_BILD_JS)
            alt = cfg.frame_format
            try:
                cfg.frame_format = "png"
                shot = await A._grab_frame(page, cfg)   # wie im Video: DSF·SSAA → exakt cfg.width×cfg.height
            finally:
                cfg.frame_format = alt
            Path(cfg.output_path).write_bytes(shot)
        finally:
            try: await browser.close()
            except Exception: pass
    emit(1.0, "Fertig.")
    return cfg.output_path
