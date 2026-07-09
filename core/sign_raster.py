"""v0.9.418 — Serverseitige Schild-Rasterung für den leichten Leaflet-Export.

Der Leaflet-Blog-Export ist bewusst schlank (keine MapLibre-Engine). Trotzdem
sollen die Schilder pixelgenau wie in App/Video aussehen (WYSIWYG). Dafür werden
sie NICHT im App-WebView gerastert (dort wirft `canvas.toDataURL` in WKWebView
eine Ausnahme — Ursache der alten „Schilder fehlen/falsch"-Bugs), sondern
SERVERSEITIG in einem headless Chromium (Playwright) mit derselben
`ui/js/sign_draw.js`-Engine (`window.__rzDrawSign`) wie das Video-Rendering.
Ergebnis: pro sichtbarem Schild ein PNG-data-URI + Anzeigegröße (CSS-px) + Anker
(Sprechblasen-Richtung), fertig als Leaflet-`L.icon` einbettbar.

`rasterize_signs()` bekommt die Roh-Schilder (wie `proj.tourmap_signs`) und gibt
`[{lat, lon, img, w, h, anchor, text}]` zurück (nur sichtbare, mit gültigen
Koordinaten). Bild-Schilder (`imageSrc`) werden hier NICHT geladen — v1 ist
bewusst „nur Text-Schilder"; ein evtl. `thumb`-data-URI wird aber mitgezeichnet,
falls vorhanden.
"""
from __future__ import annotations

import sys
from pathlib import Path


def _sign_draw_js() -> str:
    base = Path(getattr(sys, "_MEIPASS", None) or Path(__file__).resolve().parent.parent)
    return (base / "ui" / "js" / "sign_draw.js").read_text(encoding="utf-8")


def rasterize_signs(signs: list, signs_show: bool = True) -> list:
    """Rastert sichtbare Text-Schilder serverseitig zu PNG-Bild-Markern.

    Rückgabe: Liste `{lat, lon, img (data-URI), w, h, anchor, text}` in Eingabe-
    Reihenfolge (nur sichtbare mit gültigen lat/lon). Leere Liste, wenn nichts zu
    tun ist (spart einen Chromium-Start)."""
    if not signs_show:
        return []
    # Nur sichtbare Schilder mit gültigen Koordinaten vorbereiten.
    prepared = []
    for s in (signs or []):
        if not isinstance(s, dict) or s.get("visible") is False:
            continue
        try:
            lat = float(s.get("lat")); lon = float(s.get("lon"))
        except (TypeError, ValueError):
            continue
        o = dict(s)
        o["text"] = str(o.get("text") or "")
        prepared.append({"lat": lat, "lon": lon, "sign": o})
    if not prepared:
        return []

    from playwright.sync_api import sync_playwright

    signdraw = _sign_draw_js()
    payload = [p["sign"] for p in prepared]
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--use-angle=default", "--enable-webgl", "--ignore-gpu-blocklist",
                  "--disable-background-networking",
                  "--disable-features=MediaRouter,DialMediaRouteProvider",
                  "--no-first-run", "--no-default-browser-check"],
        )
        try:
            page = browser.new_page()
            page.set_content("<!doctype html><html><body></body></html>")
            page.add_script_tag(content=signdraw)
            drawn = page.evaluate(
                """(signs) => signs.map(function(s){
                    try {
                        var d = window.__rzDrawSign(s);
                        if (!d || !d.data || !d.data.width) return null;
                        var cv = document.createElement('canvas');
                        cv.width = d.data.width; cv.height = d.data.height;
                        cv.getContext('2d').putImageData(d.data, 0, 0);
                        var dpr = Number(d.dpr) || 1;
                        return {
                            img: cv.toDataURL('image/png'),
                            w: Math.max(1, Math.round(d.data.width / dpr)),
                            h: Math.max(1, Math.round(d.data.height / dpr)),
                            anchor: d.anchor || 'bottom'
                        };
                    } catch (e) { return null; }
                })""",
                payload,
            )
        finally:
            browser.close()

    out = []
    for prep, res in zip(prepared, drawn or []):
        if not res or not res.get("img"):
            continue
        out.append({
            "lat": prep["lat"], "lon": prep["lon"],
            "img": res["img"], "w": int(res["w"]), "h": int(res["h"]),
            "anchor": res["anchor"] if res.get("anchor") in ("top", "left", "right", "bottom") else "bottom",
            "text": prep["sign"].get("text", ""),
        })
    return out
