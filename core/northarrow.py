"""Nordpfeil-Grafik für Render (core/animator.py) und Leaflet-Export
(core/tourmap_leaflet.py). Die Vorschau spiegelt sie in ui/js/util.js
(`window.RZ_NORTH_SVG`) — tests/test_north_scale.py hält beide gleich.
Beta-Tester, 04.09.2026: „Nordpfeil und Maßstab dürfen einfach nicht fehlen!"
"""
NORTH_SVG = ('<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><circle cx="32" cy="32" r="30" class="rz-north-bg" fill="rgba(0,0,0,0.55)"/><text x="32" y="15" text-anchor="middle" font-size="11" font-weight="800" fill="#ffffff" font-family="sans-serif">N</text><polygon points="32,17 40,42 32,37 24,42" fill="#e8452c"/><polygon points="32,58 24,42 32,37 40,42" fill="#ffffff" fill-opacity="0.85"/></svg>')


# 25.10.2026 — Kompass je Kartenlook (Marc: „für jeden Kartenstil einen Kompass“; dieselben Bilder wie das Web-Studio).
# Quelle: ui/kompass/kompass-<look>.svg — dieselben Dateien, aus denen scripts/kompass_js.py ui/js/kompass.js baut.
import sys as _sys
from pathlib import Path as _Path

_KOMPASS: dict | None = None


def kompasse() -> dict:
    """{look: svg} aus ui/kompass/ (im App-Bündel unter _MEIPASS)."""
    global _KOMPASS
    if _KOMPASS is None:
        base = _Path(getattr(_sys, "_MEIPASS", None) or _Path(__file__).resolve().parent.parent)
        _KOMPASS = {p.stem.removeprefix("kompass-"): p.read_text(encoding="utf-8").strip()
                    for p in sorted((base / "ui" / "kompass").glob("kompass-*.svg"))}
    return _KOMPASS


def north_svg_fuer(einstellungen: dict | None) -> str:
    """Spiegel von rzKompassFuer (ui/js/kompass.js): Kompass des Looks (map_style „kartenlook“ + kartenlook.id), sonst der Pfeil."""
    e = einstellungen or {}
    kl = e.get("kartenlook")
    look = (kl if isinstance(kl, str) else (kl or {}).get("id")) if e.get("map_style") == "kartenlook" else None
    return kompasse().get(look or "", "") or NORTH_SVG

