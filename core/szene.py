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

Seit 0.9.752 (30.09.2026, Marc: „wir sollten alles über eine pipeline machen")
ist das der EINZIGE Render-Weg — auch Standbild, Einzelbild und der transparente
Export (ProRes 4444): `mode["transparent"]` blendet Grundkarte, Raster- und
Relief-Ebenen, Sterne und Namensnennung aus, der Screenshot nimmt den Alpha-Kanal
mit. Der klassische Generator (core/animator.render) und `RZ_RENDER_KLASSISCH`
sind entfernt; core/animator.py baut nur noch die Web-Karte (build_interactive_html).
"""
from __future__ import annotations

from core import i18n as _i18n  # 29.09.2026 — Meldungen in der App-Sprache
import asyncio
import base64
import json
import logging
import math
import os
import re
import sys
import time
from pathlib import Path
from typing import Callable, Optional

from . import animator as A
from . import tileproxy as _tileproxy
from . import tonspur as _tonspur
from .frame_driver import FrameMuxer, muxer_fuer, teildatei

_log = logging.getLogger("animator.szene")

# 25.09.2026 — kleinste Render-Breite in CSS-px (Marc: „Mindestgröße von 640 px Breite").
SZENE_MIN_BREITE = 640

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
window.__rzFortsetzenGeprueft = true;   // 29.09.2026: kein „Fortsetzen“ des zuletzt benutzten Projekts in der Render-Seite
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
    if (__RZ_MODE__.blur > 0) { const st = document.createElement("style"); st.id = "rz-render-blur"; st.textContent = "#anim-viewport .maplibregl-canvas, #anim-viewport .mapboxgl-canvas { filter: blur(" + __RZ_MODE__.blur + "px); }"; document.head.appendChild(st); }
    // 30.09.2026 — transparenter Export (eine Pipeline): Seite und Karten-Hintergrund durchsichtig,
    // die Grundkarte blendet die Seite selbst aus (module.js _alphaRenderEbenen).
    if (__RZ_MODE__.transparent) { const st = document.createElement("style"); st.id = "rz-render-alpha"; st.textContent = "html, body, body.rz-render-mode, .anim-canvas, #anim-viewport, #anim-viewport .maplibregl-map, #anim-viewport .mapboxgl-map, #anim-viewport .maplibregl-canvas-container { background: transparent !important; background-image: none !important; } #anim-alpha-preview-hint { display: none !important; } body.rz-render-mode * { visibility: hidden; } body.rz-render-mode #anim-viewport, body.rz-render-mode #anim-viewport * { visibility: visible; } #anim-viewport .rz-stars-twinkle, #anim-viewport .maplibregl-ctrl-attrib, #anim-viewport .mapboxgl-ctrl-attrib { display: none !important; }"; document.head.appendChild(st); }
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
  if (window.__rzClipWarte) { try { await window.__rzClipWarte(); } catch (_) {} }   // 02.10.2026 — Clip-Einzelbild geladen?
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, __RZ_RUHE_MS__)));
  return performance.now() - t0;
}""".replace("__RZ_RUHE_MS__", str(int(os.environ.get("RZ_BILD_RUHE_MS", "60") or 0)))   # 30.09.2026 Messung: feste Pause je Bild
# 29.09.2026 — Vorwärmen: kürzere Wartegrenze je Halt (sonst bis 5 s × 200 Halte bei kaltem Speicher/langsamer Leitung)
# Prüfstand: Zeiten des letzten Video-Renders (Hänger an der Warte-Grenze, längstes Warten, ms je Schritt)
LETZTE_ZEITEN: dict = {}

_WARTE_VORWAERMEN_JS = _WARTE_BILD_JS.replace("setTimeout(on, 5000)", "setTimeout(on, 2500)")


async def _mit_meldung(aw, melden, is_cancelled=None, ab_s: float = 1.0):
    """02.10.2026 (Marc: „an manchen Frames steht er so lang, dass man fast denkt, er wäre abgestürzt") — einen
    Schritt eines Bildes abwarten und, solange er länger als `ab_s` dauert, jede Sekunde `melden(sekunden)` rufen.
    Abbrechen greift auch während des Wartens."""
    aufgabe = asyncio.ensure_future(aw)
    t0 = time.perf_counter()
    gemeldet = False
    try:
        while True:
            fertig, _ = await asyncio.wait({aufgabe}, timeout=ab_s if not gemeldet else 1.0)
            if fertig:
                return aufgabe.result()
            if is_cancelled and is_cancelled():
                aufgabe.cancel()
                raise A.RenderCancelled()
            gemeldet = True
            try:
                melden(time.perf_counter() - t0)
            except Exception:   # noqa: BLE001 — Meldung darf den Render nie stören
                pass
    finally:
        if not aufgabe.done():
            aufgabe.cancel()


def _stoerung_hinweis(page) -> str:
    """30.09.2026 (Marc: „wenn so ein Fehler auftaucht, gib es direkt beim Rendern aus — dann weiß man, warum es
    lange dauert"): Hinweis für die Fortschrittszeile, wenn Kartendienste gerade nicht liefern. Quellen: die
    Kachel-Weiche (Landes-Luftbilder, Name der Region) und der Kachelspeicher der Szene (Dienste direkt, Hostname)."""
    teile = []
    try:
        for rid, v in _tileproxy.stoerungen().items():
            if v["fehlend"] > 0:
                # 30.09.2026 — Dienstname in der App-Sprache: „Luftbild Spanien“ / „Aerial imagery Spain“ / „Ortofoto España“
                land = _i18n.t_aktiv("mapregion." + rid, v["name"].replace("Luftbild ", ""))
                teile.append((_i18n.t_aktiv("szene.luftbild", "Luftbild {name}").replace("{name}", land), v["fehlend"]))
    except Exception:
        pass
    try:
        for host, urls in ((getattr(page, "_rz_tile_stats", None) or {}).get("aus") or {}).items():
            if urls:
                teile.append((_i18n.t_aktiv("szene.kartendienst", "Kartendienst {name}").replace("{name}", str(host)), len(urls)))
    except Exception:
        pass
    if not teile:
        return ""
    vorlage = _i18n.t_aktiv("szene.kacheln_fehlen", "⚠️ {dienst} antwortet nicht – {n} Kacheln fehlen, es geht weiter")
    return " · " + "; ".join(vorlage.replace("{dienst}", str(d)).replace("{n}", str(n)) for d, n in teile)


def _stats_json(stats) -> str:
    return json.dumps(stats, default=lambda o: len(o) if isinstance(o, (set, frozenset)) else str(o))


def _grob_nach_fein(n: int) -> list:
    """Halte-Reihenfolge fürs Vorwärmen: erst Anfang/Ende, dann Mitte, Viertel, Achtel …
    (29.09.2026). Jeder Anfang der Liste deckt das ganze Video grob ab — ein früher Abbruch
    oder das Zeitbudget lassen so keine späten Abschnitte kalt. Vorher liefen die Halte der
    Reihe nach; die ersten 12 lagen alle im (schon geladenen) Intro, und das „früh beendet"
    griff, obwohl die eigentliche Strecke noch gar nicht vorgewärmt war."""
    if n <= 0:
        return []
    if n == 1:
        return [0]
    raus, gesehen = [0, n - 1], {0, n - 1}
    schritt = n - 1
    while len(raus) < n and schritt > 1:
        schritt = schritt / 2.0
        k = schritt
        while k < n - 1:
            i = int(round(k))
            if i not in gesehen:
                gesehen.add(i); raus.append(i)
            k += 2 * schritt
    raus += [i for i in range(n) if i not in gesehen]
    return raus


def _warte_zeile(letzte, laenge: int = 320) -> str:
    """25.09.2026 — Warte-Zustand fürs Log. Vorher `json.dumps(…)[:240]`: der lange
    GPX-Pfad (mit Emoji als \\u-Folgen) stand vorn und schnitt genau die Felder ab, an
    denen es hing (pending, modal, fitBase, schilderLaden). Jetzt: `ok` und die kurzen
    Felder zuerst, lange Texte (gpx, body, err) gekürzt ans Ende, Umlaute lesbar."""
    if not isinstance(letzte, dict):
        return json.dumps(letzte, ensure_ascii=False)[:laenge]
    lang = ("gpx", "body", "err", "grund")
    kurz = {k: v for k, v in letzte.items() if k not in lang}
    for k in lang:
        if k in letzte:
            v = letzte[k]
            kurz[k] = ("…" + v[-60:]) if isinstance(v, str) and len(v) > 60 else v
    return json.dumps(kurz, ensure_ascii=False)[:laenge]


async def _warte_auf(page, js: str, timeout_s: float, was: str, is_cancelled=None, intervall: float = 0.25):
    t0 = time.time()
    letzte = None
    naechster_log = t0 + 20
    while time.time() - t0 < timeout_s:
        if time.time() > naechster_log:
            naechster_log = time.time() + 20
            _log.info("Szene: warte auf %s … zuletzt %s", was, _warte_zeile(letzte))
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
    raise RuntimeError(f"Szene: Warten auf {was} abgebrochen nach {timeout_s:.0f}s — zuletzt {_warte_zeile(letzte, 400)}")


def _warte_grund(b) -> str:
    """25.09.2026 — woran die Bereitschaft (window.__rzAnimBereit) gerade hängt, in Worten.
    Vorher stand in der App minutenlang nur „Szene: Projekt öffnen …" (Klicktest AN-12/13)."""
    if not isinstance(b, dict):
        return _i18n.t_aktiv("szene.g_seite_still", "Seite antwortet nicht")
    if b.get("err"):
        return _i18n.t_aktiv("szene.g_seitenfehler", "Fehler in der Seite: ") + str(b.get("err"))[:80]
    if b.get("grund") == "kein Animator":
        return _i18n.t_aktiv("szene.g_kein_animator", "Animator öffnet nicht (Modul {modul})").replace("{modul}", str(b.get('mod') or '?'))
    if not b.get("map"):
        return _i18n.t_aktiv("szene.g_karte", "Karte wird angelegt")
    if not b.get("style"):
        return _i18n.t_aktiv("szene.g_stil", "Kartenstil lädt")
    if (b.get("coords") or 0) < 2:
        return _i18n.t_aktiv("szene.g_track", "Track lädt")
    if b.get("pending"):
        return _i18n.t_aktiv("szene.g_touren", "Touren werden übernommen")
    if b.get("modal"):
        return _i18n.t_aktiv("szene.g_modal", "Lade-Fenster offen")
    if b.get("route") is False:
        return _i18n.t_aktiv("szene.g_route", "Routen-GPX lädt")
    if not b.get("tiles"):
        return _i18n.t_aktiv("szene.g_kacheln", "Kartenkacheln laden")
    if b.get("fitBase") is None:
        return _i18n.t_aktiv("szene.g_ausschnitt", "Kartenausschnitt noch nicht berechnet")
    n = b.get("schilderLaden") or 0
    if n > 0:
        return _i18n.t_aktiv("szene.g_schilder", "{n} Schild-Bilder laden").replace("{n}", str(n))
    return _i18n.t_aktiv("szene.g_nicht_bereit", "noch nicht bereit")


def _nur_noch(b, feld: str) -> bool:
    """Steht alles bereit bis auf `feld` (fitBase / schilderLaden)?"""
    if not isinstance(b, dict) or b.get("grund") or b.get("err"):
        return False
    basis = (b.get("map") and b.get("style") and b.get("tiles") and (b.get("coords") or 0) >= 2
             and not b.get("pending") and not b.get("modal") and b.get("route") is not False)
    if not basis:
        return False
    if feld == "fitBase":
        return b.get("fitBase") is None
    return b.get("fitBase") is not None and (b.get("schilderLaden") or 0) > 0


async def _warte_bereit(page, js: str, timeout_s: float, was: str, is_cancelled, emit, fortschritt: float, text: str):
    """25.09.2026 (Klicktest AN-12/13) — Warten auf den bereiten Animator, aber nicht mehr
    blind. Der Grund steht im Fortschritt der App, und zwei Hänger lösen sich selbst:

    - Kartenausschnitt (fitBase) fehlt, sonst alles da: nach 15 s einmal ausdrücklich
      berechnen lassen (window.__rzAnimFit); bleibt er aus, nach 60 s mit verständlicher
      Meldung abbrechen statt vier Minuten bei 4 % zu stehen.
    - Nur noch Schild-Bilder fehlen: nach 30 s ohne sie weiter (Log-Warnung). Ein Bild,
      das nicht lädt, soll nicht das ganze Video verhindern; das Schild zeichnet sich, sobald
      sein Bild doch noch kommt, sonst ohne Bild.
    """
    t0 = time.time()
    naechster_log = t0 + 20
    letzte = None
    grund_alt = None
    angestossen = False
    schilder_frei = False
    fit_seit = None
    while True:
        if is_cancelled and is_cancelled():
            raise A.RenderCancelled()
        try:
            letzte = await page.evaluate(js)
        except Exception as e:      # noqa: BLE001
            letzte = {"err": str(e)[:200]}
        if isinstance(letzte, dict) and letzte.get("ok"):
            return letzte
        dt = time.time() - t0
        grund = _warte_grund(letzte)
        if dt > 4 and grund != grund_alt:
            grund_alt = grund
            emit(fortschritt, f"{text} ({grund})")
        if time.time() > naechster_log:
            naechster_log = time.time() + 20
            _log.info("Szene: warte auf %s (%s, %.0f s) … zuletzt %s", was, grund, dt, _warte_zeile(letzte))
        if _nur_noch(letzte, "fitBase"):
            fit_seit = fit_seit or time.time()
            if not angestossen and time.time() - fit_seit > 15:
                angestossen = True
                try:
                    z = await page.evaluate("() => (window.__rzAnimFit ? window.__rzAnimFit() : null)")
                except Exception as e:      # noqa: BLE001
                    z = f"Fehler {e}"
                _log.warning("Szene: Kartenausschnitt fehlte nach 15 s — neu berechnet (Zoom %s)", z)
            elif time.time() - fit_seit > 60:
                raise RuntimeError(_i18n.t_aktiv("szene.err_kein_ausschnitt",
                                       "Die Karte konnte keinen Ausschnitt für das Video berechnen "
                                       "(Vorschau-Fläche zu klein oder Track ohne Ausdehnung?)")
                                   + f" — {_warte_zeile(letzte, 300)}")
        else:
            fit_seit = None
        if not schilder_frei and dt > 30 and _nur_noch(letzte, "schilderLaden"):
            schilder_frei = True
            _log.warning("Szene: %s Schild-Bild(er) nach 30 s noch nicht geladen — Render läuft ohne "
                         "Warten weiter", letzte.get("schilderLaden"))
            try:
                await page.evaluate("() => { window.__rzSzeneSchilderNichtAbwarten = true; }")
            except Exception:      # noqa: BLE001
                pass
        if dt > timeout_s:
            raise RuntimeError(_i18n.t_aktiv("szene.err_zeitgrenze", "Nach {s} s nicht bereit: ").replace("{s}", f"{timeout_s:.0f}")
                               + f"{grund} ({was}) — {_warte_zeile(letzte, 300)}")
        await asyncio.sleep(0.5)


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
    # 25.09.2026 (Marc, nach Klicktest AN-12/13) — Mindestbreite: bei einem kleinen App-Fenster
    # (Vorschau 347 px) wurde das Video zur groben Vergrößerung der Mini-Vorschau — Linien,
    # Schilder und Quellenzeile klobig. Unter SZENE_MIN_BREITE rendert die Szene breiter und
    # verschiebt den Zoom um denselben Faktor (zoomShift), damit der Ausschnitt gleich bleibt;
    # alles in CSS-px (Linien, Schrift) wirkt dann feiner als in der Mini-Vorschau.
    vorschau_w = pw
    if pw < SZENE_MIN_BREITE <= cfg.width:
        pw = SZENE_MIN_BREITE
        _log.info("Szene: Vorschau nur %d px breit — rendere mit %d px (Zoom +%.2f)", vorschau_w, pw, math.log2(pw / vorschau_w))
    zoom_shift = math.log2(pw / vorschau_w) if vorschau_w > 0 else 0.0
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
            "zoomShift": round(zoom_shift, 4),
            # 30.09.2026 — Kacheldichte (params.kachel_stufen oder RZ_KACHEL_STUFEN; None = Standard)
            "kachelStufen": (lambda v: None if v in (None, "") else int(v))((params or {}).get("kachel_stufen", os.environ.get("RZ_KACHEL_STUFEN"))),   # Viewport = Vorschau → 0; bei Mindestbreite log2(breiter/Vorschau)
            # 07.09.2026 — Paint-Übergangsdauer im Render-Modus. 0 ms wäre 2× schneller, ließ aber auf
            # Gelände-Stilen (Fuji OSM, Teide Satellit) die Rasterkacheln beim Zoomen in ganzen
            # Abschnitten ungezeichnet (WYS mean_diff 22/17 statt 3/5; 60 ms genauso); 300 ms = MapLibre-
            # Standard ist korrekt. Ursache offen (IDEAS §53a), RZ_TRANS_MS zum Messen.
            "transMs": int(os.environ.get("RZ_TRANS_MS", "300") or 0),
            "transparent": bool(getattr(cfg, "transparent_background", False))}
    _keep = {k: True for k in (os.environ.get("RZ_KEEP") or "").split(",") if k}
    await page.add_init_script(_BRIDGE_JS.replace("__RZ_MODE__", json.dumps(mode)).replace("__RZ_KEEP__", json.dumps(_keep)))
    emit(0.02, _i18n.t_aktiv("szene.app_laden", "Szene: App laden …"))
    await page.goto(f"file://{UI_INDEX.resolve()}", wait_until="domcontentloaded")
    # Kachel-Cache erst NACH dem Laden der Seite einhängen: die Routen-Abfangung
    # ließ das file://-Laden der App mit net::ERR_FAILED scheitern (06.09.2026).
    try:
        _tileproxy.stoerungen_zuruecksetzen()   # 30.09.2026 — Ausfälle je Render zählen
        page._rz_tile_stats = await A._install_tile_cache(page, cfg)
    except Exception as e:      # noqa: BLE001
        _log.warning("Szene: Kachel-Cache nicht installiert: %s", e)
    await _warte_auf(page, "() => ({ ok: !!(window.RZGPS_MODULES && window.switchMod && window.loadGlobalGpx) })", 30, "App-Start", is_cancelled)
    await page.wait_for_timeout(1500)
    emit(0.04, _i18n.t_aktiv("szene.projekt_oeffnen", "Szene: Projekt öffnen …"))
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
        const ok = b.map && b.style && b.tiles && b.coords >= 2 && !b.pending && !b.modal && b.fitBase != null && b.route !== false && !(b.schilderLaden > 0 && !window.__rzSzeneSchilderNichtAbwarten); return Object.assign({ ok }, b); } catch (e) { return { ok: false, err: String(e) }; } }"""
    info = await _warte_bereit(page, bereit_js, 240, "Projekt/Animator", is_cancelled, emit, 0.04, _i18n.t_aktiv("szene.projekt_oeffnen", "Szene: Projekt öffnen …"))
    _log.info("Szene: Animator bereit — %s", _warte_zeile(info))
    aktiv = await page.evaluate("() => (typeof activeMod !== 'undefined' ? activeMod : null)")
    if modul and modul != "animator" and aktiv != modul:
        # 07.09.2026 — Rückfall: falls das Archiv nicht im gewünschten Modul geöffnet hat
        # (Reiseroute und Tour-Map sind dasselbe Animator-Modul in anderem Modus), ausdrücklich
        # umschalten und auf die frische Bereitschaft der neuen Einhängung warten.
        emit(0.045, _i18n.t_aktiv("szene.modul", "Szene: Modul {modul} …").replace("{modul}", str(modul)))
        await page.evaluate(f"() => {{ window.__rzAnimBereit = null; window.switchMod({json.dumps(modul)}); }}")
        await _warte_auf(page, f"() => ({{ ok: (typeof activeMod !== 'undefined' && activeMod === {json.dumps(modul)}) && typeof window.__rzAnimBereit === 'function' }})", 60, f"Modul {modul}", is_cancelled)
        info = await _warte_bereit(page, bereit_js, 240, f"Modul {modul} bereit", is_cancelled, emit, 0.045, _i18n.t_aktiv("szene.modul", "Szene: Modul {modul} …").replace("{modul}", str(modul)))
        _log.info("Szene: %s bereit — %s", modul, _warte_zeile(info))
    # Nachladen (Gelände-Kacheln, Schilder-Bilder) kurz Zeit geben, dann Viewport prüfen.
    await page.wait_for_timeout(2500)
    vp = await page.evaluate("() => { const v = document.getElementById('anim-viewport'); const r = v && v.getBoundingClientRect(); return r ? { x: r.x, y: r.y, w: r.width, h: r.height, k: getComputedStyle(v).getPropertyValue('--rz-prev-k') } : null; }")
    _log.info("Szene: Viewport im Fenster %s", json.dumps(vp))
    if not vp or abs(vp["w"] - vp_w) > 2 or abs(vp["h"] - vp_h) > 2 or abs(vp["x"]) > 1 or abs(vp["y"]) > 1:
        raise RuntimeError(f"Szene: Viewport nicht bildfüllend ({json.dumps(vp)}, erwartet {vp_w}x{vp_h} bei 0,0)")
    if fehler:
        _log.warning("Szene: JS-Fehler beim Laden: %s", fehler[:3])
    return browser, page, dsf, ss


# 30.09.2026 (Marc: „das dauert immer noch ewig" — gemessen: kalt wartet jedes Bild ~280 ms auf Kacheln, der
# Server braucht je Kachel seine Zeit) — VORLÄUFER: eine zweite unsichtbare Seite mit demselben Projekt fährt der
# Bildschleife voraus und lässt an jeder Stelle die Karte ihre Kacheln laden (kein Bild). Beide Seiten teilen den
# Kachelspeicher (Weiche + Playwright-Route), die Bildschleife findet die Kacheln dann vor. Die Karte fordert
# genau an, was sie braucht (Neigung, Gelände, Pixeldichte) — keine eigene Kachelrechnung. Fehler im Vorläufer
# beenden nur den Vorläufer, nie den Render. RZ_VORLAEUFER=0 schaltet ab (Messen).
VORLAEUFER_SCHRITT = int(os.environ.get("RZ_VORLAEUFER_SCHRITT", "6"))   # Bilder zwischen zwei Halten (0,2 s bei 30 fps; 15 gemessen deutlich schlechter)
VORLAEUFER_VORSPRUNG = 300      # höchstens so viele Bilder voraus (10 s)
VORLAEUFER_MIN_VORSPRUNG = 12   # holt die Bildschleife auf, springt er so weit vor
# Nicht aufs vollständige Laden warten: es reicht, dass die Karte die Anfragen losschickt — Weiche und
# Playwright-Route holen und speichern die Kachel auch, wenn die Karte schon weitergesprungen ist.
_WARTE_VORLAEUFER_JS = _WARTE_BILD_JS.replace("setTimeout(on, 5000)", "setTimeout(on, " + os.environ.get("RZ_VORLAEUFER_MS", "500") + ")")


async def _vorlaeufer(p, cfg, api, projekt_id, params, modul, zustand, is_cancelled):
    """Fährt der Bildschleife voraus (zustand["bild"] = aktuelles Bild der Schleife, zustand["ende"] = Bildzahl)."""
    browser = None
    t0 = time.time(); halte = 0
    try:
        browser, page, _dsf, _ss = await _seite_vorbereiten(p, cfg, api, projekt_id, is_cancelled, lambda a, b: None, params, modul=modul)
        await page.evaluate("() => window.__rzPreviewRun()")
        await _warte_auf(page, "() => ({ ok: !!(window.__rzPreviewStep && window.__rzPreviewStep.ready) })", 120, "Vorläufer", is_cancelled)
        zustand["bereit"] = True
        _log.info("Szene: Vorläufer bereit nach %.1f s", time.time() - t0)
        pos = 0
        while not zustand.get("stop"):
            ende = int(zustand.get("ende") or 0)
            bild = int(zustand.get("bild") or 0)
            if pos >= ende:
                break
            if pos < bild + VORLAEUFER_MIN_VORSPRUNG:
                pos = bild + VORLAEUFER_MIN_VORSPRUNG
                continue
            if pos > bild + VORLAEUFER_VORSPRUNG:
                await asyncio.sleep(0.1)
                continue
            await page.evaluate(f"() => window.__rzPreviewStep.seek({pos / cfg.fps:.6f})")
            await page.evaluate(_WARTE_VORLAEUFER_JS)
            halte += 1
            zustand["stand"] = pos
            pos += VORLAEUFER_SCHRITT
    except Exception as e:      # noqa: BLE001
        if not zustand.get("stop"):
            _log.warning("Szene: Vorläufer beendet: %s", str(e)[:200])
    finally:
        _log.info("Szene: Vorläufer: %d Halte in %.1f s", halte, time.time() - t0)
        if browser is not None:
            try: await browser.close()
            except Exception: pass


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
        _vl_an = os.environ.get("RZ_VORLAEUFER", "1") != "0" and not getattr(cfg, "transparent_background", False)   # Alpha: keine Kacheln
        _vl = {"bild": 0, "ende": total_frames, "stop": False, "stand": 0, "bereit": False}
        _vl_task = asyncio.create_task(_vorlaeufer(p, cfg, api, projekt_id, params, modul, _vl, is_cancelled)) if _vl_an else None
        try:
            browser, page, dsf, ss = await _seite_vorbereiten(p, cfg, api, projekt_id, is_cancelled, emit, params, modul=modul)
        except BaseException:
            _vl["stop"] = True
            if _vl_task is not None:
                try: await asyncio.wait_for(_vl_task, 15)
                except BaseException: pass
            raise
        try:
            emit(0.05, _i18n.t_aktiv("szene.probelauf", "Szene: Probelauf im Schrittmodus …"))
            await page.evaluate("() => window.__rzPreviewRun()")
            await _warte_auf(page, "() => ({ ok: !!(window.__rzPreviewStep && window.__rzPreviewStep.ready) })", 120, "Probelauf-Start", is_cancelled)
            # ⚠️ 09.09.2026 (Marc) — DIE VORSCHAU BESTIMMT DIE LÄNGE, und zwar wirklich.
            # Hier stand dieser Satz bisher nur als Warnung im Log, gerechnet wurde
            # weiter mit `duration_s` aus den Einstellungen. Bei einer Etappenfolge
            # kommen die Übergänge aber ZUSÄTZLICH zur eingestellten Dauer: gemessen
            # 8,00 s Video gegen 11,00 s Vorschau — die letzten drei Sekunden fehlten
            # schlicht. Zwei Quellen für eine Zahl, dieselbe Sorte Riss wie beim
            # Zeitplan der Etappen.
            total_ms = float(await page.evaluate("() => window.__rzPreviewStep.totalMs"))
            erwartet_ms = total_frames / cfg.fps * 1000
            aus_vorschau = max(1, int(round(total_ms / 1000.0 * cfg.fps)))
            if aus_vorschau != total_frames:
                _log.info("Szene: Länge kommt aus der Vorschau — %d statt %d Bildern "
                          "(%.2f s statt %.2f s)", aus_vorschau, total_frames,
                          total_ms / 1000.0, erwartet_ms / 1000.0)
                total_frames = aus_vorschau
            _vl["ende"] = total_frames
            # 08.09.2026 - Kacheln vorwaermen (wie der klassische Pfad seit v0.9.19 ueber
            # window.prewarmTiles): N Haltepunkte ueber die Zeitachse, je einmal auf idle
            # warten. Die Karte holt die Kacheln je Halt gebuendelt und parallel; ohne das
            # wartet die Bildschleife bei jedem Bild einzeln auf Nachzuegler. Marcs 4K-Lauf
            # vom 08.09.: 1826 Fehlgriffe im Zwischenspeicher, 2,1 s je Bild gegen 0,75 s
            # warm. RZ_VORWAERMEN=0 schaltet es ab (Pruefstand).
            # Dichte: rund 6 Haltepunkte je Sekunde Video, mindestens 12, hoechstens 200.
            # Kalt gemessen (Masca, 4 s, 4K): ohne 2336 ms/Bild, 24 Halte 1703, 48 Halte 1611.
            _vw_std = max(12, min(200, round(total_frames / max(1, cfg.fps) * 6)))
            # 30.09.2026 — mit Vorläufer entfällt das Vorwärmen vor dem ersten Bild: er lädt ohnehin voraus,
            # die Bildschleife startet sofort (RZ_VORWAERMEN erzwingt es weiterhin).
            _vorwaermen = int(os.environ.get("RZ_VORWAERMEN", "0" if _vl_task is not None else str(_vw_std)) or 0)
            if _vorwaermen > 1:
                _t_vw = time.time()
                emit(0.05, _i18n.t_aktiv("szene.vorwaermen", "Szene: Kacheln vorwärmen ({n}) …").replace("{n}", str(_vorwaermen)))
                # 08.09.2026 — Ist alles schon da, ist jeder weitere Halt verschenkte
                # Zeit (Marcs zweiter Masca-Lauf: 90 s Vorwaermen, kaum noch Ertrag).
                # Gemessen wird die WARTEZEIT je Halt, die `_WARTE_BILD_JS` zurueckgibt,
                # nicht der Kachel-Zaehler: rund die Haelfte der Fehlgriffe wird nie
                # abgelegt (Dienste ohne brauchbare Antwort), der Zaehler bliebe also
                # auch bei warmem Speicher hoch — gemessen 295 „neue" Kacheln in einem
                # Lauf, der zu 92 Prozent aus Treffern bestand.
                _warten = []
                _halte = 0
                # 29.09.2026 (Marc: „Kacheln vorwärmen dauert immer ziemlich lange … dann hängt's bei mir"):
                # grob → fein, höchstens 2,5 s je Halt, Zeitbudget (Standard 45 s, RZ_VORWAERMEN_S),
                # Fortschritt je Halt sichtbar.
                _budget_s = float(os.environ.get("RZ_VORWAERMEN_S", "45") or 45)
                _txt = _i18n.t_aktiv("szene.vorwaermen_n", "Szene: Kacheln vorwärmen {i} von {n} …")
                for _i in _grob_nach_fein(_vorwaermen):
                    if is_cancelled and is_cancelled():
                        raise A.RenderCancelled()
                    if time.time() - _t_vw > _budget_s:
                        _log.info("Szene: Vorwärmen nach Zeitbudget %.0f s beendet (%d von %d)", _budget_s, _halte, _vorwaermen)
                        break
                    _tv = (total_frames - 1) / cfg.fps * _i / (_vorwaermen - 1)
                    await page.evaluate(f"() => window.__rzPreviewStep.seek({_tv:.6f})")
                    _ms = await page.evaluate(_WARTE_VORWAERMEN_JS)
                    _warten.append(float(_ms) if isinstance(_ms, (int, float)) else 0.0)
                    _halte += 1
                    emit(0.05, _txt.replace("{i}", str(_halte)).replace("{n}", str(_vorwaermen)) + _stoerung_hinweis(page))
                    if _halte >= 12 and _halte % 6 == 0:
                        _letzte = sorted(_warten[-6:])[3]
                        # Schwelle aus Messungen (Masca, 4K): kalt wartet ein Halt
                        # 600 bis 900 ms, warm 380 bis 400 ms. Unter 500 ms ist nichts
                        # mehr zu holen — die verbleibende Wartezeit ist MapLibres
                        # eigenes Nachzeichnen, nicht das Laden von Kacheln.
                        if _letzte < 500:
                            _log.info("Szene: Vorwärmen früh beendet — Karte wartet nur noch %.0f ms je Halt (%d von %d)",
                                      _letzte, _halte, _vorwaermen)
                            break
                _mitte = sorted(_warten)[len(_warten) // 2] if _warten else 0.0
                _log.info("Szene: Kacheln vorgewärmt an %d von %d Haltepunkten in %.1fs (Warten je Halt im Mittel %.0f ms)",
                          _halte, _vorwaermen, time.time() - _t_vw, _mitte)
            # 08.09.2026 - Verkleinern uebernimmt ffmpeg (siehe _vf_args/_grab_frame).
            cfg.skalieren_in_ffmpeg = True
            mux = FrameMuxer(_ffmpeg_cmd(cfg), cfg.output_path, total_frames, log=_log, cancelled_cls=A.RenderCancelled)
            preview_every = max(1, cfg.fps // 10)
            # 30.09.2026 (Marc: „das Komoot-Video rendert so schnell, bei uns dauert es ewig") — wohin geht die
            # Zeit je Bild? Summen je Schritt, am Ende eine Logzeile „Szene: Zeit je Bild …".
            _z = {"seek": 0.0, "warten": 0.0, "greifen": 0.0, "schreiben": 0.0}
            # 01.10.2026 — Hänger zählen statt Gesamtzeit messen: ein Bild, das bis an die Grenze von
            # _WARTE_BILD_JS (5 s) auf die Karte wartet, ist der Fehler vom 30.09. (Kartendienst-Ausfall).
            # Die Gesamtzeit hängt an der Rechnerlast, diese Zahl nicht.
            _haenger, _warte_max = 0, 0.0
            _hinweis_alt = ""
            _t_bilder = time.time()
            try:
                for frame in range(total_frames):
                    if is_cancelled and is_cancelled():
                        raise A.RenderCancelled()
                    _vl["bild"] = frame
                    t = frame / cfg.fps
                    _t = time.perf_counter()
                    _p = 0.05 + 0.87 * frame / total_frames
                    def _meldung(schluessel, vorgabe, _f=frame, _p=_p, _h=_hinweis_alt):
                        return lambda sek: emit(_p, f"Frame {_f + 1} / {total_frames} · "
                                                + _i18n.t_aktiv(schluessel, vorgabe).replace("{s}", f"{sek:.0f}") + _h)
                    await _mit_meldung(page.evaluate(f"() => window.__rzPreviewStep.seek({t:.6f})"),
                                       _meldung("szene.m_springt", "Karte springt zur Stelle … {s} s"), is_cancelled)
                    _z["seek"] += time.perf_counter() - _t; _t = time.perf_counter()
                    await _mit_meldung(page.evaluate(_WARTE_BILD_JS),
                                       _meldung("szene.m_karte", "wartet auf die Karte (Kacheln, Gelände) … {s} s"), is_cancelled)
                    _w = time.perf_counter() - _t
                    _z["warten"] += _w
                    _warte_max = max(_warte_max, _w)
                    if _w >= 4.5:
                        _haenger += 1
                    if _SEEK2:
                        # 07.09.2026 — mit Gelände bezieht MapLibre die Kamerahöhe auf die Bodenhöhe im
                        # Mittelpunkt; kommen DEM-Kacheln erst nach dem Sprung, stimmt der Ausschnitt nicht
                        # (Einzelbild-Weg macht das seit 06.09. so). Zweiter Sprung nach dem Laden.
                        await page.evaluate(f"() => window.__rzPreviewStep.seek({t:.6f})")
                        await _mit_meldung(page.evaluate(_WARTE_BILD_JS),
                                           _meldung("szene.m_gelaende", "lädt die Geländehöhen nach … {s} s"), is_cancelled)
                    _t = time.perf_counter()
                    shot = await _mit_meldung(A._grab_frame(page, cfg),
                                              _meldung("szene.m_greifen", "nimmt das Bild auf … {s} s"), is_cancelled)
                    _z["greifen"] += time.perf_counter() - _t
                    if frame <= 2:
                        for _k in range(6):
                            if A._frame_black_ratio(shot) < 0.05:
                                break
                            _log.warning("Szene Frame %d: Bild schwarz — neu greifen (%d/6)", frame + 1, _k + 1)
                            await asyncio.sleep(0.5)
                            await page.evaluate(_WARTE_BILD_JS)
                            shot = await A._grab_frame(page, cfg)
                    _t = time.perf_counter()
                    mux.schreiben(shot, frame + 1)
                    _z["schreiben"] += time.perf_counter() - _t
                    if on_preview and frame % preview_every == 0:
                        try: on_preview(base64.b64encode(shot).decode("ascii"))
                        except Exception: pass
                    if frame % 10 == 0:
                        _hinweis_alt = _stoerung_hinweis(page)   # 30.09.2026 — Kartendienst-Ausfälle sichtbar machen
                    emit(0.05 + 0.87 * (frame + 1) / total_frames, f"Frame {frame + 1} / {total_frames}" + _hinweis_alt)
            except BaseException as _fehler:
                mux.abbrechen("abgebrochen" if isinstance(_fehler, A.RenderCancelled) else "Fehler")
                raise
            _n = max(1, total_frames)
            _log.info("Szene: Zeit je Bild %.0f ms (springen %.0f · warten auf Karte %.0f · Bild greifen %.0f · schreiben %.0f) — %d Bilder in %.1f s",
                      (time.time() - _t_bilder) * 1000 / _n, _z["seek"] * 1000 / _n, _z["warten"] * 1000 / _n,
                      _z["greifen"] * 1000 / _n, _z["schreiben"] * 1000 / _n, _n, time.time() - _t_bilder)
            _log.info("Szene: längstes Warten auf die Karte %.0f ms · Bilder an der 5-s-Grenze: %d", _warte_max * 1000, _haenger)
            LETZTE_ZEITEN.clear()
            LETZTE_ZEITEN.update(bilder=_n, haenger=_haenger, warte_max_s=_warte_max, je_bild_ms={k: v * 1000 / _n for k, v in _z.items()})
            # 02.10.2026 — Tonplan (Musik, Foto-Klicks, Clip-Ton) aus der Seite: dieselben Zeiten wie in der Vorschau
            try: _tonplan = await page.evaluate("() => (window.__rzTonPlan ? window.__rzTonPlan() : null)")
            except Exception as _e:  # noqa: BLE001
                _tonplan = None; _log.warning("Szene: Tonplan nicht lesbar: %s", _e)
            emit(0.92, _i18n.t_aktiv("animator.progress.ffmpeg_short", "ffmpeg finalisiert …"))
            mux.abschliessen(is_cancelled)
            if not _tonspur.plan_leer(_tonplan):
                emit(0.95, _i18n.t_aktiv("animator.progress.ton", "Tonspur wird angelegt …"))
                _ton = _tonspur.anlegen(cfg.output_path, _tonplan, A.find_ffmpeg(), total_frames / cfg.fps)
                if not _ton.get("ok"):
                    _log.warning("Szene: Tonspur fehlgeschlagen — Video bleibt stumm: %s", _ton.get("error"))
            _log.info("Szene: Kacheln %s", _stats_json(getattr(page, "_rz_tile_stats", None)))
            _gl = _tileproxy.geladen()
            _log.info("Szene: über die Kachel-Weiche aus dem Netz geladen: %d Kacheln, %.1f MB", _gl["kacheln"], _gl["bytes"] / 1e6)
            _st = _tileproxy.stoerungen()
            if _st or ((getattr(page, "_rz_tile_stats", None) or {}).get("aus")):
                _log.warning("Szene: Kartendienste mit Ausfällen — Weiche %s · direkt %s", json.dumps(_st, ensure_ascii=False),
                             _stats_json((getattr(page, "_rz_tile_stats", None) or {}).get("aus")))
        finally:
            _vl["stop"] = True
            if _vl_task is not None:
                try: await asyncio.wait_for(_vl_task, 15)
                except BaseException: pass
            try: await browser.close()
            except Exception: pass
    emit(1.0, _i18n.t_aktiv("animator.progress.done", "Fertig."))
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
            emit(0.6, _i18n.t_aktiv("szene.standbild", "Szene: Standbild …"))
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
    emit(1.0, _i18n.t_aktiv("animator.progress.done", "Fertig."))
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
    emit(1.0, _i18n.t_aktiv("animator.progress.done", "Fertig."))
    return cfg.output_path
