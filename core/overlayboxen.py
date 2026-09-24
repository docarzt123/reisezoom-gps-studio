"""Overlay-Boxen einzeln einstellen (23.09.2026, docs/OVERLAY-BOXEN.md).

Reines Modell ohne App-Importe. Drei Ebenen: global → Box → Zeile. Jeder Wert
unten, der fehlt (oder None ist), erbt von oben. „Zurücksetzen" heißt: den
Schlüssel weglassen.

⚠️ Die AUFLÖSUNG ist WORTGLEICH zu ui/js/overlay_boxen.js: Python baut damit das
Render-HTML (Boxen, Stil, Schriften), JavaScript die Vorschau. Der Wächter
tests/test_overlay_boxen.py vergleicht beide. Wer hier etwas ändert, ändert es dort mit.

Die ZEITSTEUERUNG (wann eine Box erscheint, Blenden, Auslöser) rechnet nur
ui/js/overlay_boxen.js — Vorschau, Szene-Render und klassischer Render benutzen
dieselbe Datei. Der Python-Zwilling lief nur in Tests und ist seit 24.09.2026 weg.
Das Modell unten beschreibt, was `zeit` bedeutet:

Zeitmodell
----------
Auslöser (`art`):
  s             Video-Sekunde `wert`                        → Zeit-Auslöser
  start         Track-Start (= Ende des Intros)             → Zeit-Auslöser
  ende          Track-Ende (= Intro + Animation)            → Zeit-Auslöser
  pct           `wert` Prozent der Strecke                  → Strecken-Auslöser
  etappe_start  Anfang von Etappe `wert`                    → Strecken-Auslöser
  etappe_ende   Ende von Etappe `wert`                      → Strecken-Auslöser
Zeit-Auslöser kennen ihren Zeitpunkt. Strecken-Auslöser merken sich die
Video-Sekunde, in der der Laufpunkt die Stelle erreicht hat (`mem`), damit die
Blende von dort aus läuft — Tempo-Kurven und Übergänge stimmen so von selbst.
Die Einblendung beginnt am Auslöser „von", die Ausblendung am Auslöser „bis"
(bzw. „von" + `dauer_s`). Ohne Ausblendung verschwindet die Box dort hart.
"""
from __future__ import annotations

import math
import re

_HEX = re.compile(r"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")

STANDARD_IDS = ("totals", "live", "ele")
BOX_TYPEN = ("totals", "live")
AUSLOESER = ("s", "pct", "etappe_start", "etappe_ende", "start", "ende")
BLENDEN = ("none", "fade", "pop", "both")
POSITIONEN = ("tl", "tr", "bl", "br", "tc", "bc", "cc", "ml", "mr", "tcw", "bcw")
SCHRIFTEN = ("system", "nunito", "quicksand", "fredoka", "oswald", "bebas")

DEFAULT_LIVE_FIELDS = ["dist_done", "time_elapsed", "ele_now"]
DEFAULT_TOTAL_FIELDS = ["dist_total", "moving_time", "avg_speed", "max_speed", "elev_gain", "elev_loss"]

STIL_KEYS = ("bg_color", "bg_opacity", "text_color", "font", "radius", "border_w", "border_color", "shadow")
BLENDE_KEYS = ("ein", "aus", "dauer_s")
ZEILE_KEYS = ("text_color", "groesse", "fett")



def _get(cfg, key, default=None):
    if isinstance(cfg, dict):
        v = cfg.get(key, default)
    else:
        v = getattr(cfg, key, default)
    return default if v is None else v


def _num(v, default=0.0):
    if v is None or v == "":
        return default
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    if f != f or f in (float("inf"), float("-inf")):
        return default
    return f


def _clamp(x, lo, hi):
    return lo if x < lo else hi if x > hi else x


def _farbe(v, default):
    s = str(v or "").strip()
    return s.lower() if _HEX.match(s) else default


def _blendeart(v, default="none"):
    s = str(v or "").strip()
    return s if s in BLENDEN else default


def _rund(x):
    """Rundung für die Parität Python ↔ JS (Math.round(x*1e4)/1e4)."""
    return math.floor(x * 10000 + 0.5) / 10000


# ── Globale Werte ────────────────────────────────────────────────────────────

def global_stil(cfg) -> dict:
    font = str(_get(cfg, "overlay_font", "system") or "system").lower()
    return {
        "bg_color": _farbe(_get(cfg, "overlay_bg_color", "#000000"), "#000000"),
        "bg_opacity": _rund(_clamp(_num(_get(cfg, "overlay_bg_opacity", 0.55), 0.55), 0.0, 1.0)),
        "text_color": _farbe(_get(cfg, "overlay_text_color", "#ffffff"), "#ffffff"),
        "font": font if font in SCHRIFTEN else "system",
        "radius": _rund(_clamp(_num(_get(cfg, "overlay_radius", 12), 12.0), 0.0, 60.0)),
        "border_w": _rund(_clamp(_num(_get(cfg, "overlay_border_w", 0), 0.0), 0.0, 12.0)),
        "border_color": _farbe(_get(cfg, "overlay_border_color", "#ffffff"), "#ffffff"),
        "shadow": bool(_get(cfg, "overlay_shadow", True)),
    }


def global_blende(cfg) -> dict:
    return {
        "ein": _blendeart(_get(cfg, "overlay_entry", "none")),
        "aus": _blendeart(_get(cfg, "overlay_exit", "none")),
        "dauer_s": _rund(_clamp(_num(_get(cfg, "overlay_blende_s", 0.5), 0.5), 0.05, 10.0)),
    }


def _stil_mischen(basis: dict, ueber) -> dict:
    out = dict(basis)
    if not isinstance(ueber, dict):
        return out
    for k in STIL_KEYS:
        v = ueber.get(k)
        if v is None:
            continue
        if k in ("bg_color", "text_color", "border_color"):
            out[k] = _farbe(v, basis[k])
        elif k == "bg_opacity":
            out[k] = _rund(_clamp(_num(v, basis[k]), 0.0, 1.0))
        elif k == "radius":
            out[k] = _rund(_clamp(_num(v, basis[k]), 0.0, 60.0))
        elif k == "border_w":
            out[k] = _rund(_clamp(_num(v, basis[k]), 0.0, 12.0))
        elif k == "font":
            f = str(v).lower()
            out[k] = f if f in SCHRIFTEN else basis[k]
        elif k == "shadow":
            out[k] = bool(v)
    return out


def _blende_mischen(basis: dict, ueber) -> dict:
    out = dict(basis)
    if not isinstance(ueber, dict):
        return out
    if ueber.get("ein") is not None:
        out["ein"] = _blendeart(ueber.get("ein"), basis["ein"])
    if ueber.get("aus") is not None:
        out["aus"] = _blendeart(ueber.get("aus"), basis["aus"])
    if ueber.get("dauer_s") is not None:
        out["dauer_s"] = _rund(_clamp(_num(ueber.get("dauer_s"), basis["dauer_s"]), 0.05, 10.0))
    return out


# ── Zeit ─────────────────────────────────────────────────────────────────────

def _ausloeser(a):
    if not isinstance(a, dict):
        return None
    art = str(a.get("art") or "")
    if art not in AUSLOESER:
        return None
    wert = _num(a.get("wert"), 0.0)
    if art == "s":
        wert = max(0.0, wert)
    elif art == "pct":
        wert = _clamp(wert, 0.0, 100.0)
    elif art in ("etappe_start", "etappe_ende"):
        wert = float(max(1, int(wert)))
    else:
        wert = 0.0
    return {"art": art, "wert": _rund(wert)}


def zeit_normal(z):
    """{von, bis|None, dauer_s|None} oder None (= keine eigene Zeit)."""
    if not isinstance(z, dict):
        return None
    von = _ausloeser(z.get("von")) or {"art": "s", "wert": 0.0}
    dauer = _num(z.get("dauer_s"), 0.0) if z.get("dauer_s") is not None else 0.0
    if dauer > 0:
        return {"von": von, "bis": None, "dauer_s": _rund(dauer)}
    return {"von": von, "bis": _ausloeser(z.get("bis")), "dauer_s": None}


def _zeit_alt(cfg, praefix):
    """Standardbox ohne eigene `zeit`: aus den alten Sekundenfeldern."""
    frm = max(0.0, _num(_get(cfg, praefix + "_from_s", 0), 0.0))
    to = _num(_get(cfg, praefix + "_to_s", 0), 0.0)
    return {"von": {"art": "s", "wert": _rund(frm)},
            "bis": ({"art": "s", "wert": _rund(to)} if to > 0 else None),
            "dauer_s": None}


def _bezug(v, default="gesamt"):
    if v is None or v == "":
        return default
    if v in ("gesamt", "laufend"):
        return v
    if isinstance(v, bool):
        return default
    if isinstance(v, (int, float)):
        n = int(v)
    elif isinstance(v, str) and re.match(r"^\s*\d+\s*$", v):
        n = int(v)
    else:
        return default
    return n if n >= 1 else default


def _zeit_trivial(z) -> bool:
    return (z is None) or (z["von"]["art"] == "s" and z["von"]["wert"] <= 0
                           and z["bis"] is None and not z["dauer_s"])


# ── Auflösung ────────────────────────────────────────────────────────────────

_ALT = {
    "totals": ("overlay_totals", "tl", DEFAULT_TOTAL_FIELDS),
    "live": ("overlay_live", "tr", DEFAULT_LIVE_FIELDS),
    "ele": ("overlay_elevation", "bc", None),
}


def _eintraege(cfg) -> list:
    roh = _get(cfg, "overlay_boxen", None)
    return [b for b in (roh if isinstance(roh, list) else []) if isinstance(b, dict) and b.get("id")]


def aufloesen(cfg) -> list:
    """Alle Boxen mit wirksamen Werten, Reihenfolge: totals, live, ele, Zusatzboxen.

    Jede Box: {id, typ, standard, enabled, position, fields, titel, stil, blende,
    zeit, bezug, zeilen:{fid:{text_color, groesse, fett, zeit, blende, bezug}}}.
    `zeilen` enthält nur Zeilen mit Abweichung.
    """
    g_stil = global_stil(cfg)
    g_blende = global_blende(cfg)
    eintraege = _eintraege(cfg)
    je_id = {}
    for e in eintraege:
        je_id.setdefault(str(e["id"]), e)
    ids = list(STANDARD_IDS) + [str(e["id"]) for e in eintraege
                                if str(e["id"]) not in STANDARD_IDS]
    gesehen = set()
    out = []
    for bid in ids:
        if bid in gesehen:
            continue
        gesehen.add(bid)
        e = je_id.get(bid) or {}
        standard = bid in STANDARD_IDS
        if standard:
            praefix, pos_def, felder_def = _ALT[bid]
            typ = "ele" if bid == "ele" else bid
            enabled = bool(_get(cfg, praefix + "_enabled", True))
            position = str(_get(cfg, praefix + "_position", pos_def) or pos_def)
            fields = None
            if felder_def is not None:
                f = _get(cfg, praefix + "_fields", None)
                fields = [str(x) for x in f] if isinstance(f, list) else list(felder_def)
            titel = ""
        else:
            typ = e.get("typ") if e.get("typ") in BOX_TYPEN else "totals"
            enabled = bool(e.get("enabled")) if e.get("enabled") is not None else True
            position = str(e.get("position") or "cc")
            f = e.get("fields")
            fields = ([str(x) for x in f] if isinstance(f, list)
                      else list(DEFAULT_LIVE_FIELDS if typ == "live" else DEFAULT_TOTAL_FIELDS))
            titel = str(e.get("titel") or "")[:80]
        if position not in POSITIONEN:
            position = pos_def if standard else "cc"
        stil = _stil_mischen(g_stil, e.get("stil"))
        blende = _blende_mischen(g_blende, e.get("blende"))
        zeit = zeit_normal(e.get("zeit"))
        if zeit is None:
            zeit = _zeit_alt(cfg, _ALT[bid][0]) if standard else {"von": {"art": "s", "wert": 0.0}, "bis": None, "dauer_s": None}
        bezug = _bezug(e.get("bezug")) if typ == "totals" else "gesamt"
        zeilen = {}
        roh_z = e.get("zeilen") if isinstance(e.get("zeilen"), dict) else {}
        if typ != "ele":
            for fid in sorted(roh_z.keys()):
                zz = roh_z[fid]
                if not isinstance(zz, dict):
                    continue
                gr = zz.get("groesse")
                zeilen[str(fid)] = {
                    "text_color": _farbe(zz.get("text_color"), stil["text_color"]) if zz.get("text_color") is not None else stil["text_color"],
                    "groesse": _rund(_clamp(_num(gr, 1.0), 0.5, 3.0)) if gr is not None else 1.0,
                    "fett": (bool(zz.get("fett")) if zz.get("fett") is not None else None),
                    "zeit": zeit_normal(zz.get("zeit")),
                    "blende": _blende_mischen(blende, zz.get("blende")),
                    "bezug": _bezug(zz.get("bezug"), bezug) if typ == "totals" else "gesamt",
                }
        out.append({"id": bid, "typ": typ, "standard": standard, "enabled": enabled,
                    "position": position, "fields": fields, "titel": titel,
                    "stil": stil, "blende": blende, "zeit": zeit, "bezug": bezug,
                    "zeilen": zeilen})
    return out


def hat_zeitsteuerung(cfg) -> bool:
    """True, wenn der Render je Bild die Zeitsteuerung aufrufen muss."""
    for b in aufloesen(cfg) + chart_boxen(cfg):
        if not b["enabled"]:
            continue
        if b["blende"]["ein"] != "none" or b["blende"]["aus"] != "none":
            return True
        if not _zeit_trivial(b["zeit"]) or b["bezug"] == "laufend":
            return True
        for z in b["zeilen"].values():
            if z["zeit"] is not None or z["bezug"] == "laufend":
                return True
    return False


def chart_boxen(cfg) -> list:
    """Daten-Diagramme als Zeit-Boxen (id chart-<i>): nur Zeitfenster aus
    from_s/to_s + globale Blende, kein eigener Stil (v0.9.443-Verhalten)."""
    g_blende = global_blende(cfg)
    out = []
    for i, ch in enumerate(_get(cfg, "charts", None) or []):
        if not isinstance(ch, dict):
            continue
        frm = max(0.0, _num(ch.get("from_s"), 0.0))
        to = _num(ch.get("to_s"), 0.0)
        out.append({"id": "chart-" + str(i), "typ": "chart", "standard": False, "enabled": True,
                    "blende": dict(g_blende), "bezug": "gesamt", "zeilen": {},
                    "zeit": {"von": {"art": "s", "wert": _rund(frm)},
                             "bis": ({"art": "s", "wert": _rund(to)} if to > 0 else None),
                             "dauer_s": None}})
    return out


def fonts_in_gebrauch(cfg) -> list:
    """Alle Schriften, die irgendeine Box nutzt (Render lädt sie per <link>)."""
    out = []
    for b in aufloesen(cfg):
        f = b["stil"]["font"]
        if f not in out:
            out.append(f)
    return out
