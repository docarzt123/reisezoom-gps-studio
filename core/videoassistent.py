"""Video-Assistent, Stufe 1: die besten und abwechslungsreichsten Fotos einer Tour wählen (05.10.2026).

Marc (Roadmap 05.10.2026): „Aus 400 Fotos einer Tour die besten und abwechslungsreichsten — Doppelte und
Fast-Gleiche weg, Gipfel, Aussicht, Menschen, Essen, Tiere gemischt; sinnvoll über das Logbuch verteilt (keins
mitten in der Autofahrt, Pausen als Fotostopps)." Grundlage: Inhaltssuche (core/inhalt.py, SigLIP 2) und Logbuch.

Reine Funktionen ohne App-Zustand — `app.py` (schnellvideo_fotos) sammelt Vektoren, Inhaltswerte und
Fahrtabschnitte und ruft `waehlen`. Ohne Inhaltssuche (aus, Modell fehlt, Foto nicht im Index) arbeitet die Wahl
mit Pausen/Serien/Abstand wie bisher — jedes Merkmal ist ein Zusatz, keins eine Voraussetzung.

Ablauf:
  1. Doppelte weg: Fotos binnen DOPPELT_S Sekunden, die sich laut Inhalt gleichen (Kosinus ≥ DOPPELT_KOS) — ohne
     Vektoren nur binnen DOPPELT_OHNE_S — bilden eine Gruppe; es bleibt das mit dem höchsten Wert.
  2. Wert: Pause (+2) · Serie (+1, aus app.py) · Inhalt „sehenswert" (+0…2) · Inhalt „Ausschuss" (−0…3, unscharf,
     Bildschirmfoto, Boden …) · Autofahrt ohne Halt (−1,5).
  3. Wahl wie MMR: immer das Foto mit dem besten Wert minus Ähnlichkeit zu schon gewählten (Inhalt) minus Wiederholung
     desselben Themas, mit Mindestabstand auf der Strecke; kleiner Bonus für Lücken, damit es über die Tour verteilt ist.
"""
from __future__ import annotations

import math
from typing import Optional

DOPPELT_S = 45          # Sekunden: so dicht hintereinander + gleicher Inhalt = dasselbe Motiv
DOPPELT_KOS = 0.90      # Kosinus der Inhaltsvektoren für „fast gleich" (Ähnlich-Suche beginnt bei 0,75)
DOPPELT_OHNE_S = 4      # ohne Vektoren: nur echte Serienbilder (Burst)
AEHNLICH_STRAFE = 2.5   # × Kosinus zum ähnlichsten schon gewählten Foto
THEMA_STRAFE = 1.0      # je schon gewähltem Foto mit demselben Thema
FAHRT_STRAFE = 1.5
LUECKE_BONUS = 0.6      # höchstens, für ≥ 20 % Strecke Abstand zum nächsten gewählten

# Themen und Ausschuss für SigLIP (englisch: das Modell ist mehrsprachig, englisch trifft am genauesten).
THEMEN = {
    "aussicht": "a scenic view over a wide landscape",
    "gipfel": "a mountain summit with a cross or a view from the top",
    "wasser": "a lake, a river, a waterfall or the sea",
    "himmel": "a sunset, sunrise or dramatic sky",
    "menschen": "people hiking or travelling together",
    "tier": "an animal",
    "essen": "food or drinks on a table",
    "ort": "a village, a town or a historic building",
    "weg": "a trail or path through nature",
}
AUSSCHUSS = {
    "unscharf": "a blurry, out of focus photo",
    "bildschirm": "a screenshot of a phone or computer screen",
    "dokument": "a document, a ticket or a sign photographed up close",
    "boden": "the ground, shoes or feet",
    "auto": "the inside of a car or a dashboard",
}


def _kos(a, b) -> float:
    if a is None or b is None:
        return 0.0
    try:
        s = float(sum(x * y for x, y in zip(a, b)))
        na = math.sqrt(sum(x * x for x in a)) or 1.0
        nb = math.sqrt(sum(y * y for y in b)) or 1.0
        return s / (na * nb)
    except Exception:  # noqa: BLE001
        return 0.0


def in_fahrt(bei: float, fahrten: list) -> bool:
    return any(a <= bei <= b for a, b in (fahrten or []))


def wert_von(f: dict, inhalt: Optional[dict], fahrten: list) -> tuple:
    """(Wert, Gründe) eines Kandidaten. `f["wert"]` = Pause/Serie aus app.py (0…3)."""
    w = float(f.get("wert") or 0)
    gruende = []
    if f.get("pause"):
        gruende.append("pause")
    if f.get("serie"):
        gruende.append("serie")
    i = (inhalt or {}).get(f["path"])
    if i:
        gut = float(i.get("gut") or 0)
        schlecht = float(i.get("schlecht") or 0)
        w += 2.0 * gut - 3.0 * schlecht
        if gut >= 0.35 and i.get("thema"):
            gruende.append(i["thema"])
        if schlecht >= 0.35:
            gruende.append("ausschuss:" + str(i.get("ausschuss") or ""))
    if in_fahrt(float(f["bei"]), fahrten) and not f.get("pause"):
        w -= FAHRT_STRAFE
        gruende.append("fahrt")
    return w, gruende


def doppelte_weg(kand: list, vek: Optional[dict]) -> tuple:
    """(übrig, weg) — je Gruppe nahezu gleicher Fotos bleibt das mit dem höchsten `_w`."""
    vek = vek or {}
    ks = sorted(kand, key=lambda f: (f.get("epoch") is None, f.get("epoch") or 0))
    gruppen: list = []
    for f in ks:
        e = f.get("epoch")
        g = gruppen[-1] if gruppen else None
        if g is not None and e is not None and g[-1].get("epoch") is not None:
            dt = abs(e - g[-1]["epoch"])
            va, vb = vek.get(f["path"]), vek.get(g[-1]["path"])
            gleich = (dt <= DOPPELT_S and _kos(va, vb) >= DOPPELT_KOS) if (va is not None and vb is not None) \
                else dt <= DOPPELT_OHNE_S
            if gleich:
                g.append(f)
                continue
        gruppen.append([f])
    uebrig, weg = [], []
    for g in gruppen:
        g.sort(key=lambda f: -f["_w"])
        uebrig.append(g[0])
        if len(g) > 1:
            g[0]["_gruende"].append("bestes_von:%d" % len(g))
            weg.extend(g[1:])
    return uebrig, weg


def waehlen(kandidaten: list, n_max: int, vek: Optional[dict] = None, inhalt: Optional[dict] = None,
            fahrten: Optional[list] = None, abstand: float = 0.07, tage: Optional[list] = None) -> list:
    """Kandidaten {path, bei, epoch, wert, pause?, serie?} → gewählte (nach `bei` sortiert), je mit
    `grund` (Liste kurzer Schlüssel) und `punkte` (Endwert). `vek`: path → Vektor; `inhalt`: path →
    {thema, gut, ausschuss, schlecht}; `fahrten`: [(von, bis)] als Streckenanteil; `tage`: [(von, bis)] Tagesetappen
    (Logbuch: Übernachtungen) — reicht `n_max`, bekommt zuerst jeder Tag sein bestes Foto."""
    vek = vek or {}
    kand = []
    for f in kandidaten or []:
        if f.get("bei") is None:
            continue
        g = dict(f)
        g["_w"], g["_gruende"] = wert_von(g, inhalt, fahrten or [])
        kand.append(g)
    kand, _weg = doppelte_weg(kand, vek)
    wahl: list = []
    themen: dict = {}
    # 05.10.2026 (Marc: „über das Logbuch verteilen … ein Foto je Etappe") — erst je Tag das beste, dann auffüllen
    tg = [t for t in (tage or []) if t[1] > t[0]]
    if len(tg) >= 2 and len(tg) <= int(n_max):
        for a, b in tg:
            im_tag = [f for f in kand if a <= f["bei"] <= b and not any(abs(f["bei"] - g["bei"]) < abstand for g in wahl)]
            if not im_tag:
                continue
            f = max(im_tag, key=lambda f: f["_w"])
            f["_gruende"].append("tag")
            wahl.append(f)
            th = ((inhalt or {}).get(f["path"]) or {}).get("thema")
            if th:
                themen[th] = themen.get(th, 0) + 1
            f["punkte"] = round(f["_w"], 3)
    while len(wahl) < max(0, int(n_max)):
        bester, bester_p = None, -1e9
        for f in kand:
            if f in wahl or any(abs(f["bei"] - g["bei"]) < abstand for g in wahl):
                continue
            p = f["_w"]
            v = vek.get(f["path"])
            if wahl and v is not None:
                p -= AEHNLICH_STRAFE * max(0.0, max(_kos(v, vek.get(g["path"])) for g in wahl))
            th = ((inhalt or {}).get(f["path"]) or {}).get("thema")
            if th:
                p -= THEMA_STRAFE * themen.get(th, 0)
            luecke = min((abs(f["bei"] - g["bei"]) for g in wahl), default=0.2)
            p += LUECKE_BONUS * min(1.0, luecke / 0.2)
            if p > bester_p + 1e-9 or (abs(p - bester_p) <= 1e-9 and bester is not None and f["bei"] < bester["bei"]):
                bester, bester_p = f, p
        if bester is None:
            break
        wahl.append(bester)
        th = ((inhalt or {}).get(bester["path"]) or {}).get("thema")
        if th:
            themen[th] = themen.get(th, 0) + 1
        bester["punkte"] = round(bester_p, 3)
    raus = []
    for f in sorted(wahl, key=lambda f: f["bei"]):
        g = {k: v for k, v in f.items() if not k.startswith("_")}
        g["grund"] = list(dict.fromkeys(f["_gruende"]))
        g["wert"] = round(f["_w"], 3)
        raus.append(g)
    return raus


def inhalt_bewerten(modell, vektoren: dict) -> dict:
    """path → {thema, gut, ausschuss, schlecht} aus SigLIP-Wahrscheinlichkeiten (Modell aus core/inhalt.py).
    `gut` = höchste Themen-Wahrscheinlichkeit, `schlecht` = höchste Ausschuss-Wahrscheinlichkeit (je 0…1)."""
    import numpy as np
    if not vektoren:
        return {}
    pfade = list(vektoren)
    m = np.stack([np.asarray(vektoren[p], dtype="float32") for p in pfade])
    m /= (np.linalg.norm(m, axis=1, keepdims=True) + 1e-9)

    def wahrsch(texte: dict):
        namen = list(texte)
        t = np.stack([np.asarray(modell.text_vektor(texte[k]), dtype="float32") for k in namen])
        t /= (np.linalg.norm(t, axis=1, keepdims=True) + 1e-9)
        return namen, np.asarray(modell.wahrscheinlichkeit(m @ t.T), dtype="float32")

    tn, tp = wahrsch(THEMEN)
    an, ap = wahrsch(AUSSCHUSS)
    # SigLIP-Wahrscheinlichkeiten sind absolut klein (Suchschwelle 0,01) — innerhalb der Tour auf 0…1 normieren
    # (bestes Foto der Tour = 1), aber nur, wenn überhaupt etwas erkannt ist (sonst bleibt es nahe 0).
    def rel(x):
        hoch = float(x.max()) if len(x) else 0.0
        return x / hoch if hoch >= 0.005 else x * 0.0
    gut, schlecht = rel(tp.max(axis=1)), rel(ap.max(axis=1))
    raus = {}
    for i, p in enumerate(pfade):
        ti, ai = int(np.argmax(tp[i])), int(np.argmax(ap[i]))
        raus[p] = {"thema": tn[ti], "gut": float(gut[i]), "ausschuss": an[ai], "schlecht": float(schlecht[i]),
                   "p_gut": float(tp[i][ti]), "p_schlecht": float(ap[i][ai])}
    return raus
