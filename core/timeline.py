"""
Timeline-Modul (v0.7.0) — Track-Event-System für den Animator.

Aktuell unterstützt: `CameraKeyframe` mit Pitch / Bearing / Zoom-Offset
an einem Track-Anker (0.0 = Track-Start, 1.0 = Track-Ende).

Vorbereitet für: Foto-Inserts, Text-Overlays, Sound-Cues (v0.7.1+).
Daher das gemeinsame `kind`-Feld im persistierten Schema.

Hauptfunktion: `interpolate_camera(events, progress, default_pitch,
default_rotation)` → liefert (pitch, bearing, zoom_offset) für einen
gegebenen Track-Fortschritt.

Konventionen:
- `progress` ist immer in [0.0, 1.0]
- `bearing` in Grad, interpoliert mit shortest-arc (sonst dreht's
  350° statt -10°)
- `zoom_offset` ist relativ zum Auto-Fit-Bounding-Box-Zoom; wird im
  Render-Loop auf den Base-Zoom addiert
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable


# ── Datenmodell ──────────────────────────────────────────────────────────────

@dataclass
class CameraKeyframe:
    """Ein Kamera-Keyframe an einer Track-Position.

    `anchor`: 0.0–1.0 (0 = Track-Anfang, 1 = Track-Ende)
    `pitch`:  Grad, typ. 0 (top-down) bis 85 (max-tilt)
    `bearing`: Grad, beliebig (wird modulo 360 interpoliert)
    `zoom_offset`: rel. zum Track-Fit-Zoom, typ. -3.0 bis +3.0
    `center`: optional [lon, lat] — wenn gesetzt: Kamera schaut FREI von
              dieser Position (kein Track-Folgen). Wenn None: Kamera
              folgt dem Track-Punkt am Anchor (klassisches Verhalten).
              v0.8.7+ — Marc-Wunsch: „die kamera ist immer auf den
              vorderste punkte des tracks gerichtet … wandert immer mit
              dem track mit". Mit `center` kann er den Karten-Ausschnitt
              pro Keyframe explizit setzen.
    `easing`: für v0.7.0 nur "linear" — v0.7.2 erweitert (ease-in/out)
    """
    anchor: float
    pitch: float
    bearing: float
    zoom_offset: float = 0.0
    center: list | None = None  # [lon, lat] oder None für Track-Folgen
    easing: str = "linear"


def keyframe_from_dict(d: dict) -> CameraKeyframe | None:
    """Wandelt einen JSON-Dict-Eintrag (aus settings.json oder Bridge)
    in einen `CameraKeyframe` um. Returnt None wenn der Eintrag kein
    Camera-Event ist oder ungültig — der Render-Loop ignoriert dann.

    Wir filtern hier `kind != "camera"` raus, weil v0.7.1+ andere Event-
    Typen (photo, text) in der gleichen Liste lebt und diese hier nichts
    zu suchen haben.
    """
    if not isinstance(d, dict):
        return None
    if d.get("kind", "camera") != "camera":
        return None
    try:
        center = d.get("center")
        if center is not None:
            try:
                center = [float(center[0]), float(center[1])]
            except (TypeError, ValueError, IndexError):
                center = None
        return CameraKeyframe(
            anchor=max(0.0, min(1.0, float(d["anchor"]))),
            pitch=float(d.get("pitch", 40.0)),
            bearing=float(d.get("bearing", -10.0)),
            zoom_offset=float(d.get("zoom_offset", 0.0)),
            center=center,
            easing=str(d.get("easing", "linear")),
        )
    except (KeyError, TypeError, ValueError):
        return None


def keyframes_from_events(events: Iterable[dict] | None) -> list[CameraKeyframe]:
    """Filtert + sortiert nach Anker. Nur Camera-Events."""
    if not events:
        return []
    out = []
    for ev in events:
        kf = keyframe_from_dict(ev)
        if kf is not None:
            out.append(kf)
    out.sort(key=lambda k: k.anchor)
    return out


# ── Interpolation ────────────────────────────────────────────────────────────

def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def _lerp_angle(a: float, b: float, t: float) -> float:
    """Interpoliert zwei Winkel via shortest-arc. Vermeidet 350°-Drehung
    wenn der direkte Weg -10° wäre.

    Mathe: `delta` auf [-180, 180] normalisieren, dann linear addieren.
    """
    delta = (b - a) % 360.0
    if delta > 180.0:
        delta -= 360.0
    return a + delta * t


def _apply_easing(t: float, kind: str) -> float:
    """v0.7.0: nur linear. v0.7.2 wird das erweitert (ease_in / ease_out
    / ease_in_out via cubic curves). Pflicht-Feld im Schema für Forward-
    Compat — heutige Events mit kind="ease_in" werden als linear gerendert.
    """
    if kind == "ease_in":
        return t * t
    if kind == "ease_out":
        return 1.0 - (1.0 - t) ** 2
    if kind == "ease_in_out":
        # smoothstep
        return t * t * (3.0 - 2.0 * t)
    return t  # linear (default)


def interpolate_camera(
    events: Iterable[dict] | None,
    progress: float,
    default_pitch: float,
    default_rotation: float,
    default_bearing_start: float = -10.0,
) -> tuple[float, float, float, list | None]:
    """Liefert (pitch, bearing, zoom_offset, center_or_None) für einen
    gegebenen Track-Fortschritt 0.0–1.0.

    `center` ist [lon, lat] wenn die Keyframes einen freien Karten-
    Ausschnitt definieren, sonst None → Caller verwendet Track-Punkt
    (klassisches Track-Folgen-Verhalten).

    Verhalten:
    - **Leere Events** → Legacy: statischer `default_pitch`, linearer
      Bearing-Sweep, zoom_offset=0, center=None (= Track folgen).
    - **1 Keyframe** → konstanter Wert des Keyframes inkl. center wenn
      definiert.
    - **Vor erstem / nach letztem Keyframe** → Wert konstant.
    - **Zwischen 2 Keyframes** → stückweise Interpolation. Bei center:
      wenn beide gesetzt → linear lerp (lon/lat). Wenn nur einer →
      diesen verwenden. Wenn keiner → None (Track-Folgen).
    """
    kfs = keyframes_from_events(events)

    if not kfs:
        # ⚠️ NUR hier klemmen: Der Rundum-Schwenk ohne Keyframes ist als
        # „einmal über den Track" definiert — in Anlauf und Nachlauf soll er
        # stehen bleiben, nicht weiterdrehen. Wo Keyframes da sind, gilt der
        # Anker dagegen ungeklemmt (18.08.2026, siehe interpolate_properties).
        bearing = default_bearing_start + max(0.0, min(1.0, progress)) * default_rotation
        return (default_pitch, bearing, 0.0, None)

    if len(kfs) == 1 or progress <= kfs[0].anchor:
        kf = kfs[0]
        return (kf.pitch, kf.bearing, kf.zoom_offset, kf.center)

    if progress >= kfs[-1].anchor:
        kf = kfs[-1]
        return (kf.pitch, kf.bearing, kf.zoom_offset, kf.center)

    for i in range(len(kfs) - 1):
        a, b = kfs[i], kfs[i + 1]
        if a.anchor <= progress <= b.anchor:
            span = b.anchor - a.anchor
            if span <= 0:
                return (b.pitch, b.bearing, b.zoom_offset, b.center)
            t = (progress - a.anchor) / span
            t = _apply_easing(t, b.easing)
            # center-Lerp: wenn beide gesetzt linear; wenn nur einer den
            # nehmen; wenn keiner None → Track-Folgen
            center = None
            if a.center and b.center:
                center = [_lerp(a.center[0], b.center[0], t),
                          _lerp(a.center[1], b.center[1], t)]
            elif a.center:
                center = a.center
            elif b.center:
                center = b.center
            return (
                _lerp(a.pitch, b.pitch, t),
                _lerp_angle(a.bearing, b.bearing, t),
                _lerp(a.zoom_offset, b.zoom_offset, t),
                center,
            )

    kf = kfs[-1]
    return (kf.pitch, kf.bearing, kf.zoom_offset, kf.center)


# ── Property-Events (v0.9.0 Multi-Track-Timeline) ────────────────────────────
#
# Marc-Plan A (2026-05-23): jede Kamera-Property hat in der Timeline eine
# eigene Spur und kann unabhängig angelegt/verschoben/gelöscht werden. Damit
# kann z.B. eine durchgehende 360°-Drehung über das ganze Video laufen,
# während Pitch und Zoom dazwischen mehrere Keyframes haben — die Drehung
# wird nicht durch die anderen unterbrochen.
#
# Event-Schema:
#   {"kind": "pitch",   "anchor": 0..1, "value": <degrees>}
#   {"kind": "bearing", "anchor": 0..1, "value": <degrees>}
#   {"kind": "zoom",    "anchor": 0..1, "value_offset": <delta to fit-zoom>}
#   {"kind": "center",  "anchor": 0..1, "value": [lon, lat]}  # null = track-follow
#
# Reserviert für später (Marker-/Foto-Lanes, Marc-Wunsch 2026-05-23):
#
#   {"kind": "marker", "anchor": 0..1,
#    "label": str, "icon": str,
#    "position": [lon, lat] | null}
#
#     `position` = Karten-Koordinaten WOhin der Marker auf der Karte gepinnt
#     wird. Wichtig: Marc-Klarstellung 2026-05-23: „Fotos und marker können
#     auch an anderen positionen erscheinen als direkt auf dem Track" — d.h.
#     der Marker hängt NICHT zwangsläufig am Track-Verlauf. Bsp.: „Hier
#     liegt mein Hotel" 500 m abseits des Tracks. Wenn `position: null`,
#     fällt's auf den Track-Punkt am `anchor` zurück.
#
#   {"kind": "photo", "anchor_start": 0..1, "anchor_end": 0..1, "path": str,
#    "screen_pos": "tl"|"tr"|"bl"|"br"|"center" | null,
#    "map_pos": [lon, lat] | null,
#    "fit_mode": "contain"|"cover"}
#
#     Foto kann ZWEI Ortungs-Modi haben:
#       - `screen_pos`: gesetzt → Foto erscheint als Bildschirm-Overlay
#         (Picture-in-Picture in der Ecke oder zentriert)
#       - `map_pos`: gesetzt → Foto wird AUF DIE KARTE projiziert (am
#         Lon/Lat-Punkt verankert, kippt + skaliert mit dem 3D-Terrain).
#         Funktioniert mit Mapbox Custom-Layer (Three.js-Plane) oder als
#         GeoJSON-Symbol-Layer mit Foto als Image.
#     Eines von beiden muss gesetzt sein. Position MUSS NICHT auf dem Track
#     liegen — Marc kann auch z.B. ein Foto vom Gipfel über dem Tal
#     platzieren wo gerade nicht der Track ist.
#
# Migration aus altem `kind:"camera"`-Schema passiert in der UI-Schicht
# (modules/animator/ui/module.js → migrateCameraToPropertyEvents).
# Backend nimmt beide Formate entgegen: zuerst Property-Events versuchen,
# wenn leer → Fallback auf alte camera-Events via interpolate_camera().

def _events_by_kind(events: Iterable[dict] | None, kind: str) -> list[dict]:
    """Filtert + sortiert Events nach Anker.

    v0.9.38 (Marc-Bug-Report): zusätzlich De-Dup pro Anchor.
    Alte gespeicherte Projekte enthalten Duplikate (mehrere events am
    gleichen Anchor durch Filter-Toleranz-Bug). Beim Anwenden muss pro
    (kind, anchor) genau EIN Event übrig bleiben — das spätere gewinnt
    (= zuletzt gesetzt). Spiegelt JS-`dedup` in `interpolateCameraJs`.
    """
    if not events:
        return []
    matching = [e for e in events if isinstance(e, dict) and e.get("kind") == kind]
    # De-Dup: anchor (gerundet) → event; späterer Eintrag überschreibt
    by_anchor: dict[str, dict] = {}
    for e in matching:
        key = f"{float(e.get('anchor', 0)):.4f}"
        by_anchor[key] = e
    result = list(by_anchor.values())
    result.sort(key=lambda e: float(e.get("anchor", 0)))
    return result


def _interpolate_scalar(evs: list[dict], progress: float, value_key: str = "value") -> float | None:
    """Lineare Interpolation eines skalaren Property-Events (Pitch/Zoom-Offset).
    Returnt None wenn keine Events vorhanden — Caller nutzt dann Default.
    """
    if not evs:
        return None
    if len(evs) == 1 or progress <= float(evs[0].get("anchor", 0)):
        return float(evs[0].get(value_key, 0))
    if progress >= float(evs[-1].get("anchor", 0)):
        return float(evs[-1].get(value_key, 0))
    for i in range(len(evs) - 1):
        a, b = evs[i], evs[i + 1]
        aa = float(a.get("anchor", 0))
        ba = float(b.get("anchor", 0))
        if aa <= progress <= ba:
            span = ba - aa
            if span <= 0:
                return float(b.get(value_key, 0))
            t = (progress - aa) / span
            t = _apply_easing(t, str(b.get("easing", "linear")))
            return _lerp(float(a.get(value_key, 0)), float(b.get(value_key, 0)), t)
    return float(evs[-1].get(value_key, 0))


def _zoom_effective_offset(ev: dict, fit_zoom_base: float | None,
                           abs_shift: float = 0.0) -> float:
    """v0.9.73 — Bevorzugt `value_absolute` (= absoluter Mapbox-Zoom zur
    Set-Zeit, reload-stabil) und berechnet den effektiven Offset gegen die
    aktuelle Fit-Base. Fällt zurück auf legacy `value_offset` wenn
    `value_absolute` fehlt oder fit_zoom_base None ist.

    Marc-Bug-Fix für „Erde nach Reload viel kleiner als bei Set-Zeit":
    `_fitZoomBase` driftet zwischen Set- und Render-Zeit (Window-Größe,
    Container-Pixel-Ratio etc.) — gespeicherter `value_offset` ist instabil.
    Mirrors JS `_zoomEffectiveOffset` in modules/animator/ui/module.js.

    v0.9.157 — WYSIWYG-Zoom-Fix (Marc-Bug „Render-Zoom ≠ Preview-Zoom in
    BEIDEN Modi"): `abs_shift` wird auf den absoluten Set-Zeit-Zoom addiert,
    BEVOR der Offset gegen `fit_zoom_base` gebildet wird. Damit gilt im
    Render-Loop `frame_zoom = fit_zoom_base + offset = value_absolute +
    abs_shift` — `fit_zoom_base` kürzt sich raus (padding-unabhängig).
    `abs_shift = zoom_correction - log2(dsf)` ist exakt die `correctedZoom()`-
    Korrektur aus util.js (Mapbox-Zoom ist relativ zur Viewport-Pixelbreite;
    Preview ~800 px, Render 1920–7680 px). Bei `abs_shift=0` (kein Correction-
    Wert, alte Projekte) reduziert sich das auf das v0.9.73-Verhalten.
    """
    if ev is None:
        return 0.0
    va = ev.get("value_absolute")
    if va is not None and fit_zoom_base is not None:
        try:
            return (float(va) + abs_shift) - float(fit_zoom_base)
        except (TypeError, ValueError):
            pass
    vo = ev.get("value_offset")
    try:
        return float(vo) if vo is not None else 0.0
    except (TypeError, ValueError):
        return 0.0


def _interpolate_zoom_offset(evs: list[dict], progress: float,
                              fit_zoom_base: float | None,
                              abs_shift: float = 0.0) -> float | None:
    """v0.9.73 — Lineare Interpolation des effektiven Zoom-Offsets mit
    value_absolute-Bevorzugung. Mirrors JS `_interpZoomOffset`.
    v0.9.157 — `abs_shift` (correctedZoom-Korrektur) durchgereicht."""
    if not evs:
        return None
    if len(evs) == 1 or progress <= float(evs[0].get("anchor", 0)):
        return _zoom_effective_offset(evs[0], fit_zoom_base, abs_shift)
    if progress >= float(evs[-1].get("anchor", 0)):
        return _zoom_effective_offset(evs[-1], fit_zoom_base, abs_shift)
    for i in range(len(evs) - 1):
        a, b = evs[i], evs[i + 1]
        aa = float(a.get("anchor", 0))
        ba = float(b.get("anchor", 0))
        if aa <= progress <= ba:
            span = ba - aa
            off_a = _zoom_effective_offset(a, fit_zoom_base, abs_shift)
            off_b = _zoom_effective_offset(b, fit_zoom_base, abs_shift)
            if span <= 0:
                return off_b
            t = (progress - aa) / span
            t = _apply_easing(t, str(b.get("easing", "linear")))
            return _lerp(off_a, off_b, t)
    return _zoom_effective_offset(evs[-1], fit_zoom_base, abs_shift)


def _interpolate_bearing_property(evs: list[dict], progress: float) -> float | None:
    """Wie _interpolate_scalar, aber shortest-arc für Winkel."""
    if not evs:
        return None
    if len(evs) == 1 or progress <= float(evs[0].get("anchor", 0)):
        return float(evs[0].get("value", 0))
    if progress >= float(evs[-1].get("anchor", 0)):
        return float(evs[-1].get("value", 0))
    for i in range(len(evs) - 1):
        a, b = evs[i], evs[i + 1]
        aa = float(a.get("anchor", 0))
        ba = float(b.get("anchor", 0))
        if aa <= progress <= ba:
            span = ba - aa
            if span <= 0:
                return float(b.get("value", 0))
            t = (progress - aa) / span
            t = _apply_easing(t, str(b.get("easing", "linear")))
            return _lerp_angle(float(a.get("value", 0)), float(b.get("value", 0)), t)
    return float(evs[-1].get("value", 0))


def _interpolate_center_property(evs: list[dict], progress: float,
                                 track_point_at=None) -> list | None:
    """Center-Property hat `value: [lon, lat]` oder null (= follow track).
    Returnt None wenn keine Events oder alle null → Caller folgt dem Track.

    v0.9.143 (Marc-Bug „frei → Track-folgen"): `track_point_at` ist ein optionaler
    Callable(anchor) -> [lon, lat] | None, der den Track-Punkt am gegebenen
    Timeline-Anchor liefert. Damit wird in einem GEMISCHTEN Segment (ein Endpunkt
    frei, einer Track-folgen = null) der null-Endpunkt auf die echte Track-Position
    aufgelöst und glatt dorthin gepant, statt einzufrieren und am Follow-KF zu
    springen. Spiegelt JS `_interpCenter` + `_trackPointAtAnchor`. Beide Endpunkte
    null → None (Caller folgt dem Track per-Vertex, unverändertes Verhalten).
    """
    evs_with_value = [e for e in evs if e.get("value") is not None]
    if not evs_with_value:
        return None
    if len(evs) == 1 or progress <= float(evs[0].get("anchor", 0)):
        v = evs[0].get("value")
        return [float(v[0]), float(v[1])] if v is not None else None
    if progress >= float(evs[-1].get("anchor", 0)):
        v = evs[-1].get("value")
        return [float(v[0]), float(v[1])] if v is not None else None
    for i in range(len(evs) - 1):
        a, b = evs[i], evs[i + 1]
        aa = float(a.get("anchor", 0))
        ba = float(b.get("anchor", 0))
        if aa <= progress <= ba:
            span = ba - aa
            t = (progress - aa) / span if span > 0 else 1.0
            t = _apply_easing(t, str(b.get("easing", "linear")))
            av, bv = a.get("value"), b.get("value")
            # v0.9.143: null-Endpunkt eines gemischten Segments auf den
            # Track-Punkt an SEINEM Anchor auflösen.
            if av is None and bv is None:
                return None
            if av is None and track_point_at is not None:
                av = track_point_at(aa)
            if bv is None and track_point_at is not None:
                bv = track_point_at(ba)
            if av is not None and bv is not None:
                return [_lerp(float(av[0]), float(bv[0]), t),
                        _lerp(float(av[1]), float(bv[1]), t)]
            if av is not None:
                return [float(av[0]), float(av[1])]
            if bv is not None:
                return [float(bv[0]), float(bv[1])]
            return None
    last_v = evs[-1].get("value")
    return [float(last_v[0]), float(last_v[1])] if last_v is not None else None


# v0.9.84 — Threshold von 3 → 5 (siehe JS-Kommentar)
_FLYTO_ZOOM_DELTA_THRESHOLD = 5.0


# v0.9.133 — Web-Mercator-Projektion (lon/lat ↔ Welt-Bruchteil [0,1]).
# van-Wijk braucht Distanz (u) und Viewport-Breite (w = 1/2^z) im SELBEN
# Einheitensystem. w ist ein Welt-Bruchteil (z=0 → w=1 = ganze Welt sichtbar),
# also müssen auch die Center-Koordinaten in Welt-Bruchteilen sein — NICHT in
# rohen Grad. Vorher (Grad) war u bei Globe-Flügen (Δlat bis 47°) gigantisch →
# van-Wijk wollte unter Zoom 0 rauszoomen → leere Karte → v0.9.121-Skip → linear.
# Spiegelt JS-`_mercX/_mercY/_mercXInv/_mercYInv` in modules/animator/ui/module.js.
def _merc_x(lon: float) -> float:
    return (float(lon) + 180.0) / 360.0


def _merc_y(lat: float) -> float:
    import math
    la = max(-85.051129, min(85.051129, float(lat)))
    s = math.sin(la * math.pi / 180.0)
    return 0.5 - math.log((1.0 + s) / (1.0 - s)) / (4.0 * math.pi)


def _merc_x_inv(x: float) -> float:
    return float(x) * 360.0 - 180.0


def _merc_y_inv(y: float) -> float:
    import math
    n = math.pi - 2.0 * math.pi * float(y)
    return 180.0 / math.pi * math.atan(0.5 * (math.exp(n) - math.exp(-n)))


def _van_wijk_interp(c1, c2, z1: float, z2: float, t: float) -> tuple[list, float]:
    """v0.9.63 — van-Wijk-Algorithmus für gekoppelte (center+zoom)-Interpolation.
    Bei großen Zoom-Sprüngen ergibt das einen smoothen Flug-Bogen (Zoom-Out → Pan →
    Zoom-In) statt linearer Center-Pan + linearer Zoom-Skalierung (= Track rutscht
    aus Sichtfeld). Mapbox-flyTo benutzt den gleichen Algorithmus mit rho=1.42.
    Reference: van Wijk + Nuij 2003, „Smooth and Efficient Zooming and Panning".

    Spiegelt JS-`_vanWijkInterp` in `modules/animator/ui/module.js`.
    """
    import math
    if t <= 0:
        return ([float(c1[0]), float(c1[1])], float(z1))
    if t >= 1:
        return ([float(c2[0]), float(c2[1])], float(z2))
    rho = 1.42
    w1 = 1.0 / (2.0 ** z1)
    w2 = 1.0 / (2.0 ** z2)
    dx = float(c2[0]) - float(c1[0])
    dy = float(c2[1]) - float(c1[1])
    u = math.sqrt(dx * dx + dy * dy)
    if u < 1e-9:
        return ([float(c1[0]), float(c1[1])], _lerp(z1, z2, t))
    rho2 = rho * rho
    u2 = u * u
    w1sq = w1 * w1
    w2sq = w2 * w2
    b0 = (w2sq - w1sq + rho2 * rho2 * u2) / (2.0 * w1 * rho2 * u)
    b1 = (w2sq - w1sq - rho2 * rho2 * u2) / (2.0 * w2 * rho2 * u)
    # v0.9.68 (Marc-Bug): Vorzeichen-Fix — van-Wijk-Paper Eq. 9 hat
    # r(i) = ln(-b_i + sqrt(b_i² + 1)), nicht +b_i. Bei großen Zoom-Deltas
    # (typisch Globe→Detail mit Δ~12) wurde S sonst negativ → unsere
    # Defensive griff auf linear zurück. Mathematisch: r(i) = -asinh(b_i).
    r0 = math.log(-b0 + math.sqrt(b0 * b0 + 1))
    r1 = math.log(-b1 + math.sqrt(b1 * b1 + 1))
    S = (r1 - r0) / rho
    if not math.isfinite(S) or S <= 0:
        # Degeneriert → linear
        return ([float(c1[0] + dx * t), float(c1[1] + dy * t)], _lerp(z1, z2, t))
    s = t * S
    # v0.9.68 (Marc-Bug): Korrektur der Formel — cosh(r0) ist KONSTANT (van-Wijk
    # Eq. 6), nicht cosh(rho*s + r0). Letzteres gehört nur in ws (Eq. 7) als
    # Nenner. Vorher: u(S) ≠ u (Marker landete weit hinter dem Endpunkt).
    cosh_r0 = math.cosh(r0)
    us = w1 / rho2 * (cosh_r0 * math.tanh(rho * s + r0) - math.sinh(r0))
    ws = w1 * cosh_r0 / math.cosh(rho * s + r0)
    zoom_s = math.log2(1.0 / max(1e-12, ws))
    c_t = us / u if u > 0 else t
    return ([float(c1[0] + dx * c_t), float(c1[1] + dy * c_t)], float(zoom_s))


def _maybe_flyto_interp(zoom_evs: list[dict], center_evs: list[dict],
                       progress: float, fit_zoom_base: float | None = None,
                       track_point_at=None, abs_shift: float = 0.0):
    """Findet Segment für progress in zoom+center-Spuren, returnt
    (center, zoom_offset) gekoppelt via van-Wijk wenn großer Zoom-Sprung
    + dasselbe Segment. Sonst None → Caller nutzt lineare Interpolation.

    v0.9.65: `fit_zoom_base` muss übergeben werden — van-Wijk-Formel
    ist NICHT translation-invariant in w (= 1/2^z). Wir brauchen ABSOLUTE
    Mapbox-Zooms (= offset + fit_base) für die Kurve."""
    if fit_zoom_base is None:
        return None
    if len(zoom_evs) < 2 or len(center_evs) < 2:
        return None
    z_a = z_b = None
    for i in range(len(zoom_evs) - 1):
        aa = float(zoom_evs[i].get("anchor", 0))
        ba = float(zoom_evs[i + 1].get("anchor", 0))
        if aa <= progress <= ba:
            z_a, z_b = zoom_evs[i], zoom_evs[i + 1]
            break
    if not z_a or not z_b:
        return None
    c_a = c_b = None
    for i in range(len(center_evs) - 1):
        aa = float(center_evs[i].get("anchor", 0))
        ba = float(center_evs[i + 1].get("anchor", 0))
        if aa <= progress <= ba:
            c_a, c_b = center_evs[i], center_evs[i + 1]
            break
    if not c_a or not c_b:
        return None
    # v0.9.144 (Marc-Bug „nur weiß"): gemischtes Segment (ein Endpunkt frei,
    # einer Track-folgen = null). Früher bailte van-Wijk hier komplett und der
    # Caller pante LINEAR — bei großem Zoom-Sprung (Welt→Track) flog die Kamera
    # dabei durch leeren Raum (= weiße/leere Karte). Jetzt lösen wir den
    # null-Endpunkt auf den Track-Punkt an SEINEM Anchor auf, damit van-Wijk
    # auch den frei↔folgen-Übergang als sauberen Kino-Flug (Zoom-Out, Schwenk,
    # Zoom-In) rendert. Beide null → kein flyto (reines Track-Folgen).
    cav = c_a.get("value")
    cbv = c_b.get("value")
    if cav is None and cbv is None:
        return None
    if cav is None and track_point_at is not None:
        cav = track_point_at(float(c_a.get("anchor", 0)))
    if cbv is None and track_point_at is not None:
        cbv = track_point_at(float(c_b.get("anchor", 0)))
    if cav is None or cbv is None:
        return None
    # Segmente müssen ungefähr dieselben Anchor-Grenzen haben
    if abs(float(z_a.get("anchor", 0)) - float(c_a.get("anchor", 0))) > 0.001:
        return None
    if abs(float(z_b.get("anchor", 0)) - float(c_b.get("anchor", 0))) > 0.001:
        return None
    # v0.9.73: `value_absolute` (= absoluter Mapbox-Zoom zur Set-Zeit) wenn
    # vorhanden bevorzugen; Fallback auf legacy `value_offset`. Reload-stabil.
    offset_a = _zoom_effective_offset(z_a, fit_zoom_base, abs_shift)
    offset_b = _zoom_effective_offset(z_b, fit_zoom_base, abs_shift)
    if abs(offset_a - offset_b) < _FLYTO_ZOOM_DELTA_THRESHOLD:
        return None
    abs_a = offset_a + fit_zoom_base
    abs_b = offset_b + fit_zoom_base
    # v0.9.133 — van-Wijk in Mercator-projizierten Koordinaten (NICHT Grad).
    # Der frühere v0.9.121-Skip ("min(abs) <= 3 → linear") war ein Workaround
    # für den Einheiten-Bug: in Grad wollte van-Wijk bei Globe→Track absurd weit
    # rauszoomen. In Welt-Bruchteilen [0,1] passt u zu w=1/2^z → die Kurve bleibt
    # am weiten Ende oben (Welt-Sicht/Schwenk) und zoomt erst am Ende rein =
    # echter Kino-Flug statt Tiefflug-Geirre. Daher Skip entfernt.
    seg = float(z_b.get("anchor", 0)) - float(z_a.get("anchor", 0))
    t = (progress - float(z_a.get("anchor", 0))) / seg if seg > 0 else 1.0
    # v0.9.136 — Multi-Turn-Winding (Welt-Drehung in der abgewickelten
    # center.lng) VON van-Wijk ENTKOPPELN. Wenn KF0.lng=10 und KF1.lng=370
    # (= 1 volle Drehung + Track), darf van-Wijk NICHT die rohe Differenz
    # (360°) als geografische Distanz sehen — sonst projiziert _merc_x() weit
    # ausserhalb [0,1] und die Kurve will absurd weit rauszoomen. Stattdessen:
    #   1. geografische Kurz-Distanz (shortest) = Differenz modulo ±180°
    #   2. winding = volle Drehungen = roh - shortest (Vielfaches von 360)
    # van-Wijk bekommt nur die echte Geo-Distanz (shortest) → sauberer Zoom/Pan.
    # Die vollen Drehungen legen wir LINEAR (× t) auf das Ergebnis-lng obendrauf
    # → die Welt dreht sich gleichmäßig WÄHREND des Flugs und landet bei t=1
    # exakt auf KF1.lng (Insta360-Verhalten).
    lon_a = float(cav[0])
    lon_b = float(cbv[0])
    lon_a_w = ((lon_a + 180.0) % 360.0) - 180.0
    base_off = lon_a - lon_a_w
    raw_d = lon_b - lon_a
    shortest = ((raw_d + 180.0) % 360.0) - 180.0
    winding = raw_d - shortest
    mc_a = [_merc_x(lon_a_w), _merc_y(float(cav[1]))]
    mc_b = [_merc_x(lon_a_w + shortest), _merc_y(float(cbv[1]))]
    mcenter, abs_zoom = _van_wijk_interp(mc_a, mc_b, abs_a, abs_b, t)
    # Mapbox-Min-Zoom-Clamp (Defensive gegen leere Karte) + zurück nach lon/lat
    abs_zoom = max(0.0, abs_zoom)
    center = [_merc_x_inv(mcenter[0]) + base_off + winding * t, _merc_y_inv(mcenter[1])]
    # absolute → offset zurück
    return (center, abs_zoom - fit_zoom_base)


def interpolate_properties(
    events: Iterable[dict] | None,
    progress: float,
    default_pitch: float,
    default_rotation: float,
    default_bearing_start: float = -10.0,
    fit_zoom_base: float | None = None,
    cinematic_flyto: bool = True,
    track_point_at=None,
    zoom_abs_shift: float = 0.0,
) -> tuple[float | None, float | None, float | None, list | None, dict | None, float | None]:
    """Liefert (pitch, bearing, zoom_offset, center, position, rotation) für gegebenen
    Track-Fortschritt — pro Property unabhängig.

    Jeder Rückgabewert ist `None` wenn keine entsprechenden Property-Events
    vorhanden sind. Der Caller (Render-Loop) entscheidet dann was als
    Default verwendet wird:
      - pitch None → cfg.pitch
      - bearing None → linear sweep über default_rotation
      - zoom_offset None → 0.0
      - center None → Track-Punkt
      - position None → kein Padding (= zentriert)

    v0.9.107: spin-Events (deg/sec) sind raus; falls vorhanden, werden sie
    beim Laden silent ignoriert. Drehung erfolgt deklarativ über
    center.lng-Werte pro KF. position-Events (kind="position", value={x,y}
    in %) sind die neue 5. Lane.

    Wenn das alte `kind:"camera"`-Schema verwendet wird (Backward-Compat),
    fällt diese Funktion auf `interpolate_camera()` zurück.

    v0.9.143 — `track_point_at` ist ein optionaler Callable(anchor) -> [lon, lat]
    | None, der den Track-Punkt am Timeline-Anchor liefert. Wird an
    `_interpolate_center_property` durchgereicht, damit ein gemischtes Segment
    (frei ↔ Track-folgen) glatt zwischen freier Position und Track-Punkt pant
    statt einzufrieren und am Follow-KF zu springen (WYSIWYG mit Preview).
    """
    # ⚠️ Bewusst OHNE Klemmen auf 0..1 (18.08.2026, siehe module.js): In Intro
    # und Hold läuft der Anker über die Track-Grenzen hinaus weiter (siehe
    # `_kamera_anker` in `animator.py`), und Keyframes dürfen dort liegen. Wer
    # hier klemmt, wertet den ganzen Anlauf bei 0 aus — hinter allen Keyframes,
    # die davor liegen — und der Anflug der Kamera fällt aus. Die Helfer unten
    # halten außerhalb am ersten bzw. letzten Keyframe.

    # Property-Events filtern
    pitch_evs    = _events_by_kind(events, "pitch")
    bearing_evs  = _events_by_kind(events, "bearing")
    zoom_evs     = _events_by_kind(events, "zoom")
    center_evs   = _events_by_kind(events, "center")
    position_evs = _events_by_kind(events, "position")
    rotation_evs = _events_by_kind(events, "rotation")

    has_property_events = bool(pitch_evs or bearing_evs or zoom_evs or center_evs or position_evs or rotation_evs)

    if has_property_events:
        pitch = _interpolate_scalar(pitch_evs, progress, "value")
        bearing = _interpolate_bearing_property(bearing_evs, progress)
        zoom_off = _interpolate_zoom_offset(zoom_evs, progress, fit_zoom_base, zoom_abs_shift)
        center = _interpolate_center_property(center_evs, progress, track_point_at)
        if cinematic_flyto and len(zoom_evs) >= 2 and len(center_evs) >= 2 and fit_zoom_base is not None:
            flyto = _maybe_flyto_interp(zoom_evs, center_evs, progress, fit_zoom_base, track_point_at, zoom_abs_shift)
            if flyto is not None:
                center, zoom_off = flyto
        # v0.9.107 — Position (X/Y in %)
        position = None
        if position_evs:
            x_evs = [{"anchor": e.get("anchor", 0), "value": (e.get("value") or {}).get("x", 0)} for e in position_evs]
            y_evs = [{"anchor": e.get("anchor", 0), "value": (e.get("value") or {}).get("y", 0)} for e in position_evs]
            px = _interpolate_scalar(x_evs, progress, "value")
            py = _interpolate_scalar(y_evs, progress, "value")
            if px is not None or py is not None:
                position = {"x": float(px or 0), "y": float(py or 0)}
        # v0.9.136 — Welt-Drehung-Lane ABGESCHAFFT (Insta360-Modell). Die
        # Drehung steckt jetzt in der *abgewickelten* center.lng (siehe
        # _interpolate_center_property + _maybe_flyto_interp). Alte Projekte
        # können noch rotation-Events enthalten — die werden hier still
        # ignoriert (kein Crash, keine Wirkung; Marc-Regel „nur laden").
        rotation = None
        return (pitch, bearing, zoom_off, center, position, rotation)

    # Fallback: altes camera-Event-Schema (v0.7.x–v0.8.x)
    cam_kfs = keyframes_from_events(events)
    if not cam_kfs:
        return (None, None, None, None, None, None)
    p, b, z, c = interpolate_camera(events, progress, default_pitch, default_rotation, default_bearing_start)
    return (p, b, z, c, None, None)


# ── Test-Helpers (manuelle Smoke-Tests) ─────────────────────────────────────

if __name__ == "__main__":
    # Smoke-Test
    print("Test 1: Leer → Legacy-Sweep")
    print("  progress=0.0:", interpolate_camera([], 0.0, 40, 20))
    print("  progress=0.5:", interpolate_camera([], 0.5, 40, 20))
    print("  progress=1.0:", interpolate_camera([], 1.0, 40, 20))

    print("\nTest 2: 1 Keyframe → konstant")
    kfs1 = [{"kind": "camera", "anchor": 0.5, "pitch": 70, "bearing": 90, "zoom_offset": 1.5}]
    print("  progress=0.0:", interpolate_camera(kfs1, 0.0, 40, 20))
    print("  progress=0.5:", interpolate_camera(kfs1, 0.5, 40, 20))
    print("  progress=1.0:", interpolate_camera(kfs1, 1.0, 40, 20))

    print("\nTest 3: 2 Keyframes, linear")
    kfs2 = [
        {"kind": "camera", "anchor": 0.0, "pitch": 40, "bearing": -10, "zoom_offset": 0},
        {"kind": "camera", "anchor": 1.0, "pitch": 80, "bearing": 50,  "zoom_offset": 2},
    ]
    print("  progress=0.0:", interpolate_camera(kfs2, 0.0, 40, 20))
    print("  progress=0.5:", interpolate_camera(kfs2, 0.5, 40, 20))
    print("  progress=1.0:", interpolate_camera(kfs2, 1.0, 40, 20))

    print("\nTest 4: shortest-arc bearing (350° → 10° soll +20° nehmen, nicht -340°)")
    kfs4 = [
        {"kind": "camera", "anchor": 0.0, "pitch": 40, "bearing": 350, "zoom_offset": 0},
        {"kind": "camera", "anchor": 1.0, "pitch": 40, "bearing": 10,  "zoom_offset": 0},
    ]
    print("  progress=0.5:", interpolate_camera(kfs4, 0.5, 40, 20),
          "  (bearing sollte 360 oder 0 sein, nicht 180)")

    print("\nTest 5: Photo-Event wird ignoriert")
    kfs5 = [
        {"kind": "camera", "anchor": 0.0, "pitch": 40, "bearing": 0, "zoom_offset": 0},
        {"kind": "photo",  "anchor": 0.5, "path": "x.jpg"},
        {"kind": "camera", "anchor": 1.0, "pitch": 80, "bearing": 50, "zoom_offset": 0},
    ]
    print("  progress=0.5:", interpolate_camera(kfs5, 0.5, 40, 20),
          "  (sollte mid zwischen den 2 cameras sein, nicht photo)")
