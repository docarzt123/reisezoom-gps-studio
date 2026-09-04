"""Nordpfeil-Grafik für Render (core/animator.py) und Leaflet-Export
(core/tourmap_leaflet.py). Die Vorschau spiegelt sie in ui/js/util.js
(`window.RZ_NORTH_SVG`) — tests/test_north_scale.py hält beide gleich.
Beta-Tester, 04.09.2026: „Nordpfeil und Maßstab dürfen einfach nicht fehlen!"
"""
NORTH_SVG = ('<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><circle cx="32" cy="32" r="30" class="rz-north-bg" fill="rgba(0,0,0,0.55)"/><text x="32" y="15" text-anchor="middle" font-size="11" font-weight="800" fill="#ffffff" font-family="sans-serif">N</text><polygon points="32,17 40,42 32,37 24,42" fill="#e8452c"/><polygon points="32,58 24,42 32,37 40,42" fill="#ffffff" fill-opacity="0.85"/></svg>')
