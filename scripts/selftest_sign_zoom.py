#!/usr/bin/env python3
"""Messwerkzeug + Regressionstest: „die Buchstaben tanzen".

Misst objektiv, wie stark ein Schild waehrend einer Zoomfahrt zappelt. Die Karte
steht auf dem Schild-Punkt, nur der Zoom laeuft — das Schild haengt also immer am
selben Bildschirmpunkt. Pro Schritt wird ein Ausschnitt proportional zur
Schildgroesse gegriffen und auf feste Kantenlaenge normiert. Bleibt die Groesse
konstant, sind aufeinanderfolgende Bilder praktisch identisch; waechst das Schild
mit dem Zoom, rasten die Buchstaben jedes Bild neu ein und die Differenz springt.

Erkenntnis aus v0.9.485 (gemessen, nicht vermutet): Ursache ist AUSSCHLIESSLICH das
Mitwachsen (`zoomScale`) — weder das Aufpoppen noch der datengetriebene icon-size-
Ausdruck. Auch Neu-Rastern bei jeder Zoomstufe half nicht (es war sogar minimal
schlechter), weil Text bei jeder neuen Groesse neu einrastet.

Die Voreinstellung bleibt „mitwachsen EIN" — das ist eine Design-Entscheidung, kein
Fehler. Dieser Test prueft deshalb NICHT die Voreinstellung, sondern nur, dass ein
Schild mit konstanter Groesse ruhig bleibt (sonst ist wirklich etwas kaputt).
"""
from __future__ import annotations
import asyncio, io, math, sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
import numpy as np
from PIL import Image
from core.animator import AnimatorConfig, _make_html
from core.gpx import parse_gpx, downsample

GRENZE = 0.01     # ab hier zappelt es sichtbar (ruhig gemessen: ~0.001)


def _icon_size(z: float, mitwachsen: bool) -> float:
    if not mitwachsen:
        return 1.0
    stops = [(8, 0.5), (12, 0.8), (16, 1.5), (20, 2.4)]
    for (a, s0), (b, s1) in zip(stops, stops[1:]):
        if a <= z <= b:
            return s0 + (s1 - s0) * (z - a) / (b - a)
    return stops[-1][1]


def _html(mitwachsen: bool, tmp: Path):
    gpx = str(REPO / "tests/fixtures/track_klein.gpx")
    pts, st = parse_gpx(gpx)
    pts = downsample(pts, 200)
    cum = [0.0]
    for a, b in zip(pts, pts[1:]):
        cum.append(cum[-1] + math.dist((a.lon, a.lat), (b.lon, b.lat)) * 111000)
    ct = [d / cum[-1] if cum[-1] else 0 for d in cum]
    mid = pts[len(pts) // 2]
    cfg = AnimatorConfig(
        gpx_path=gpx, output_path="/dev/null", mapbox_token="", use_osm=True,
        width=1280, height=720, duration_s=12,
        signs=[{"lat": mid.lat, "lon": mid.lon, "text": "Hamburg", "style": "callout",
                "entry": "none", "track_anchor": 0.5, "before": 0, "after": 0,
                "zoomScale": mitwachsen}])
    lons = [p.lon for p in pts]; lats = [p.lat for p in pts]
    html = _make_html(cfg, pts, cum, ct, {
        "distance_m": st.distance_m, "duration_s": st.duration_s, "ascent_m": st.ascent_m,
        "descent_m": st.descent_m, "ele_min": st.ele_min, "ele_max": st.ele_max,
        "moving_time_s": 0.0, "max_speed_kmh": 0.0},
        (min(lons), min(lats), max(lons), max(lats)))
    f = tmp / f"zoomtest_{int(mitwachsen)}.html"
    f.write_text(html, encoding="utf-8")
    return f, (mid.lon, mid.lat)


async def _zappeln(mitwachsen: bool, tmp: Path, zs) -> float:
    from playwright.async_api import async_playwright
    page, center = _html(mitwachsen, tmp)
    ims = []
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        pg = await br.new_page(viewport={"width": 1280, "height": 720})
        await pg.goto(page.as_uri())
        await pg.wait_for_function("window.__signsReady === true", timeout=60000)
        await pg.evaluate("c=>{map.jumpTo({center:c,zoom:13,bearing:0,pitch:0});}", list(center))
        await pg.evaluate("()=>window.__signsAnchorFilter(0.9)")
        await pg.wait_for_timeout(2500)
        for z in zs:
            await pg.evaluate("z=>{map.jumpTo({zoom:z});}", z)
            await pg.evaluate("()=>window.__signsAnchorFilter(0.9)")
            await pg.wait_for_timeout(110)
            s = _icon_size(z, mitwachsen)
            w, h = 150 * s, 60 * s
            png = await pg.screenshot(clip={"x": 640 - w / 2, "y": 360 - h - 8 * s,
                                            "width": w, "height": h})
            ims.append(Image.open(io.BytesIO(png)).convert("L").resize((300, 120), Image.LANCZOS))
        await br.close()
    a = [(np.asarray(i, dtype=np.float32) / 255.0) for i in ims]
    a = [(x - x.mean()) / (x.std() + 1e-6) for x in a]
    return float(np.mean([np.abs(a[i] - a[i - 1]).mean() for i in range(1, len(a))]))


async def main() -> int:
    import tempfile
    zs = [13.0 + 2.0 * i / 19 for i in range(20)]
    fails = []
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        aus = await _zappeln(False, tmp, zs)
        ein = await _zappeln(True, tmp, zs)
    print(f"   Mitwachsen AUS: {aus:.4f}   {'✅' if aus < GRENZE else '❌'}")
    print(f"   Mitwachsen EIN:            {ein:.4f}   (Preis der Funktion, kein Fehler)")
    if aus >= GRENZE:
        fails.append("Schild zappelt auch OHNE Mitwachsen — da ist etwas Neues kaputt")
    if ein <= aus * 5:
        fails.append("Messung unglaubwuerdig: EIN muesste deutlich staerker zappeln als AUS")
    print("\nRESULT:", "OK" if not fails else "FAIL")
    for f in fails:
        print("   ❌", f)
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
