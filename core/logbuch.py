"""Logbuch der Tour — was wann war (Stufe 1).

Marc, 13.09.2026: „wie wäre es, wenn der inspector eine art logbuch generiert,
was wo war — zeit von bis: fähre von bis, pause, fahrt von nach, spaziergang/
wanderung usw. … höchster punkt."

**Eine Wahrheit (Q2).** Das Logbuch IST die Einteilung „Bewegung" aus
core/einteilung — die rohen Bereiche der Erkennung (core/bewegung) plus die
Punkt-Einträge (höchster Punkt, Start und Ziel je Tag). Dieses Modul macht daraus
die *lesbare Folge*: Es ändert die Einteilung nicht, sondern legt beim Lesen die
Regeln darüber, die Marc festgelegt hat:

- **Q5 — kein „Halt".** Stillstand ab zehn Minuten ist eine Pause. Was kürzer
  ist, geht im umgebenden Abschnitt auf (die Ampel, der Blick auf die Karte).
  Die Rohdaten bleiben; „alles zeigen" holt sie in der Oberfläche zurück.
- **Q7 — Gehen bekommt einen Namen.** Sagt die Tour „Wandern", ist jedes Gehen
  eine Wanderung; sagt sie „Spaziergang", ein Spaziergang. Sonst entscheiden
  Länge und Höhenmeter. Intern bleibt es `gehen`.
- **Q8 — unsicher wird dem Nachbarn zugeschlagen.** Liegt „unsicher" zwischen
  zwei gleichen Arten, ist es diese Art; hat es nur einen bewegten Nachbarn,
  dessen. Geht beides nicht, bleibt es ehrlich „Rad oder Laufen?".

Die Schwellen sind Einstellungen (Q13, ab Stufe 2 in der Oberfläche); hier
stehen die Standardwerte.
"""
from __future__ import annotations

import logging
from bisect import bisect_left, bisect_right
from datetime import datetime, timezone
from typing import List, Optional

log = logging.getLogger(__name__)

STANDARD = {
    "orte_holen": 1.0,          # Q10: Ortsnamen im Netz nachschlagen (Photon), abschaltbar
    "pois_holen": 1.0,          # Q11: Sehenswürdigkeiten am Weg suchen (OSM), abschaltbar
    "pois_menge": 30.0,         # Q11: wie viele POIs die Spur höchstens zeigt
    "pause_ab_s": 600.0,        # Q5: Stillstand ab 10 min wird Pause
    "wanderung_ab_m": 5000.0,   # Q7: Gehen ab 5 km …
    "wanderung_ab_hm": 200.0,   # … oder ab 200 Höhenmetern ist eine Wanderung
    "langsame_fahrt_bis_s": 2700.0,   # Rad/Laufen unter 45 min zwischen zwei Fahrten = langsame Fahrt
    "fahrt_beherrscht_ab_m": 300000.0,  # ab 300 km Fahrt (doppelt so weit wie Rad, Rad nur kurze Stücke) = langsame Fahrt
}
HM_SCHWELLE_M = 3.0            # Höhenmeter zählen erst ab 3 m Änderung (GPS-Rauschen)

UNSICHER_RAD_AB_KMH = 7.0   # 14.09.2026 — dauerhaft schneller geht niemand; darüber ist „unsicher“ Rad/Laufen
# 22.10.2026 (Marc, Logbuch der Rügen-Reise: „Stau auf der Autobahn fragt, ob's Fahrrad war“)
MIKRO_S = 90.0              # Bewegung unter 1½ min ist kein eigener Eintrag („Spaziergang · 0 min“)
STAU_VERSATZ_M = 300.0      # Langsames zwischen zwei Fahrten, nach dem das Auto woanders steht = Stau, kein Aussteigen
FAHRT_ZU_FUSS_M = 1000.0    # „Fahrt“ unter 1 km mit Schritttempo, ohne Fahrt daneben = zu Fuß (GPS-Sprünge am Parkplatz)
HOECHSTER_HUB_M = 150.0            # „Höchster Punkt“ nur ab so viel Höhe über dem tiefsten Punkt des Tages (wie highlights.HUB_MIN_M)
HOECHSTER_FAHRT_AB_M = 1000.0      # „Höchster Punkt“ auf einer Fahrt nur ab dieser Höhe (Pass) — 600 m auf der Autobahn sagen nichts
PUNKT_ARTEN = ("hoechster_punkt", "start", "ziel", "punkt", "poi")
HAND_ARTEN = ("fahrt", "uebersetzen", "wanderung", "spaziergang", "rad", "laufen", "wassersport", "pause")   # Q12: Art ändern
BEWEGT = ("gehen", "laufen", "rad", "fahrt", "uebersetzen")
STILL = ("halt", "pause")
# Von Hand gesetzte Arten (Q12) und ihre Familie für die Nachbarschaft (Q8): Neben einer
# bestätigten „Wanderung" ist ein „unsicher" genauso Gehen wie neben rohem „gehen".
# Wassersport ist eine eigene Familie — er kommt nur von Hand oder über den Hinweis der Tour.
FAMILIE = {"wanderung": "gehen", "spaziergang": "gehen", "wassersport": "wassersport"}


# ── Zeit ────────────────────────────────────────────────────────────────────

def _epoch(t) -> Optional[float]:
    """Zeit → Epoch-Sekunden. Naive Zeiten gelten als UTC — wie in core/trackcheck._ts,
    sonst lagen Logbuch und Track-Check bei Dateien ohne Zone um die Ortszeit des
    Rechners auseinander (14.09.2026)."""
    if t is None or t == "":
        return None
    if isinstance(t, (int, float)):
        return float(t)
    try:
        d = t if isinstance(t, datetime) else datetime.fromisoformat(str(t).strip().replace("Z", "+00:00"))
        if not d.tzinfo:
            d = d.replace(tzinfo=timezone.utc)
        return d.timestamp()
    except (ValueError, TypeError):
        return None


class _Zeiten:
    """Punktzeiten sortiert, für die Suche „welche Punkte liegen in [t0, t1]".

    Sortiert wird nach der Uhrzeit, der Punkt-Index läuft mit: Dateien mit mehreren
    <trk> in falscher Reihenfolge lieferten sonst falsche Bereiche und weder Start
    noch Ziel noch höchsten Punkt (14.09.2026)."""

    def __init__(self, points):
        self.pts = list(points or [])
        paare = []
        for i, p in enumerate(self.pts):
            t = _epoch(p.get("time") if isinstance(p, dict) else getattr(p, "time", None))
            if t is not None:
                paare.append((t, i))
        paare.sort()
        self.ts: List[float] = [t for t, _ in paare]
        self.idx: List[int] = [i for _, i in paare]

    def _lage(self, t0: float, t1: float):
        if not self.ts:
            return None
        a = bisect_left(self.ts, t0)
        b = bisect_right(self.ts, t1) - 1
        return None if b < a else (a, b)

    def bereich(self, t0: float, t1: float):
        """(erster, letzter) Punkt-Index innerhalb [t0, t1] in ZEITFOLGE — oder None.
        Bei verschobenen Etappen kann der erste Index der größere sein; wer über die
        Punkte dazwischen laufen will, nimmt `indizes`."""
        lage = self._lage(t0, t1)
        return None if lage is None else (self.idx[lage[0]], self.idx[lage[1]])

    def indizes(self, t0: float, t1: float) -> List[int]:
        """Alle Punkt-Indizes innerhalb [t0, t1], in Zeitfolge."""
        lage = self._lage(t0, t1)
        return [] if lage is None else self.idx[lage[0]:lage[1] + 1]

    def naechster(self, t: float) -> Optional[int]:
        if not self.ts:
            return None
        k = bisect_left(self.ts, t)
        if k >= len(self.ts):
            return self.idx[-1]
        if k > 0 and (t - self.ts[k - 1]) < (self.ts[k] - t):
            return self.idx[k - 1]
        return self.idx[k]


def _ele(p):
    e = p.get("ele") if isinstance(p, dict) else getattr(p, "ele", None)
    try:
        e = float(e)
    except (TypeError, ValueError):
        return None
    return e if e == e else None   # NaN raus


def hoehenmeter(points, a: int, b: int, indizes: Optional[List[int]] = None) -> dict:
    """Bergauf/bergab zwischen zwei Punkt-Indizes, mit Schwelle gegen Rauschen.
    `indizes` (in Zeitfolge) ersetzt den Indexbereich — für Dateien, deren Etappen
    nicht in Zeitfolge liegen."""
    auf = ab = 0.0
    letzte = None
    hoch = tief = None
    for k in (indizes if indizes is not None else range(max(0, a), min(len(points), b + 1))):
        e = _ele(points[k])
        if e is None:
            continue
        hoch = e if hoch is None else max(hoch, e)
        tief = e if tief is None else min(tief, e)
        if letzte is None:
            letzte = e
            continue
        d = e - letzte
        if abs(d) < HM_SCHWELLE_M:
            continue
        if d > 0:
            auf += d
        else:
            ab -= d
        letzte = e
    return {"auf": round(auf), "ab": round(ab), "hoch": hoch, "tief": tief}


# ── Punkt-Einträge (Q9: höchster Punkt, Start, Ziel — je Tag) ───────────────

def punkte_erzeugen(points, tage: Optional[List[dict]] = None) -> List[dict]:
    """Die Punkt-Einträge der Tour: je Tag der höchste Punkt, Start und Ziel.

    Ohne Tage (Track ohne Datum) gilt die ganze Tour als ein Tag. Rückgabe sind
    schlichte Dicts `{t, art, lat, lon, ele, tag}` — core/einteilung macht daraus
    Bereiche mit t0 == t1 in derselben Einteilung wie die Bewegung.
    """
    z = _Zeiten(points)
    if not z.ts:
        return []
    fenster = [(float(x["t0"]), float(x["t1"]), int(x.get("nr") or k + 1))
               for k, x in enumerate(tage or []) if x.get("t0") is not None]
    if not fenster:
        fenster = [(z.ts[0], z.ts[-1], 1)]
    raus: List[dict] = []
    for t0, t1, nr in fenster:
        lage = z.bereich(t0, t1)
        if lage is None:
            continue
        a, b = lage

        def punkt(k, art, nr=nr):
            p = z.pts[k]
            g = (lambda n: p.get(n) if isinstance(p, dict) else getattr(p, n, None))
            return {"t": _epoch(g("time")), "art": art, "lat": g("lat"), "lon": g("lon"),
                    "ele": _ele(p), "tag": nr, "idx": k}

        raus.append(punkt(a, "start"))
        hoch_k, hoch_e = None, None
        for k in z.indizes(t0, t1):
            e = _ele(z.pts[k])
            if e is not None and (hoch_e is None or e > hoch_e):
                hoch_k, hoch_e = k, e
        # a/b sind Indizes in ZEITFOLGE — bei Etappen außer Reihenfolge kann b < a sein
        if hoch_k is not None and b != a:
            raus.append(punkt(hoch_k, "hoechster_punkt"))
        if b != a:
            raus.append(punkt(b, "ziel"))
    return raus


# ── Die lesbare Folge (Q5, Q7, Q8) ──────────────────────────────────────────

def _prior(aktivitaet: Optional[str]) -> str:
    a = (aktivitaet or "").lower()
    # Marc, 13.09.2026 (Kajak-Tour als „Wanderung"): „Wanderung auf dem Wasser ist
    # sehr unwahrscheinlich" — sagt die Tour Boot/Kajak/SUP, ist alles Langsame
    # Wassersport. Die Art je Eintrag ändern kommt mit Stufe 2.
    if any(w in a for w in ("boot", "boat", "kajak", "kayak", "kanu", "canoe", "paddel", "paddl",
                            "sup", "segel", "sail", "ruder", "row", "wasser", "water", "surf")):
        return "wassersport"
    if any(w in a for w in ("spazier", "walk")):
        return "spaziergang"
    if any(w in a for w in ("wander", "hik", "trek", "berg")):
        return "wanderung"
    return ""


def _anzeige_art(e: dict, prior: str, einst: dict) -> str:
    if prior == "wassersport" and e["art"] in ("gehen", "laufen", "rad", "unsicher"):
        return "wassersport"
    if e["art"] != "gehen":
        return e["art"]
    if prior:
        return prior
    if (e.get("strecke_m") or 0) >= einst["wanderung_ab_m"] or (e.get("hoehe_auf") or 0) >= einst["wanderung_ab_hm"]:
        return "wanderung"
    return "spaziergang"


def _eintrag(b: dict) -> dict:
    art = "pause" if b["art"] in STILL else b["art"]
    return {"id": b["id"], "bids": [b["id"]], "art": art, "art_roh": b["art"],
            "name": b.get("name") or "", "quelle": b.get("quelle") or "auto",
            "anzeige": b.get("anzeige") or "", "t0": float(b["t0"]), "t1": float(b["t1"]),
            "strecke_m": float(b.get("strecke_m") or 0.0), "geraten": False,
            "dauer_roh": max(0.0, float(b["t1"]) - float(b["t0"])),
            "grenze": bool(b.get("grenze"))}


def strecke(points, a: int, b: int, indizes: Optional[List[int]] = None) -> Optional[float]:
    """Weg in Metern zwischen zwei Punkt-Indizes — über Etappengrenzen (seg) und
    kaputte Koordinaten hinweg wird nicht gemessen. None ohne brauchbare Punkte.
    `indizes` (in Zeitfolge) ersetzt den Indexbereich."""
    weg = 0.0
    letzte = None
    gefunden = False
    for k in (indizes if indizes is not None else range(max(0, a), min(len(points), b + 1))):
        p = points[k]
        g = (lambda n, p=p: p.get(n) if isinstance(p, dict) else getattr(p, n, None))
        try:
            la, lo = float(g("lat")), float(g("lon"))
        except (TypeError, ValueError):
            letzte = None
            continue
        if not (_math.isfinite(la) and _math.isfinite(lo)):
            letzte = None
            continue
        seg = g("seg") or 0
        gefunden = True
        if letzte is not None and letzte[2] == seg:
            weg += _hav(letzte[0], letzte[1], la, lo)
        letzte = (la, lo, seg)
    return weg if gefunden else None


def _messen(e: dict, z: Optional[_Zeiten]) -> None:
    e["dauer_s"] = round(max(0.0, e["t1"] - e["t0"]), 1)
    e["hoehe_auf"] = e["hoehe_ab"] = 0
    e["von_idx"] = e["bis_idx"] = None
    lage = z.bereich(e["t0"], e["t1"]) if z is not None else None
    if lage is not None:
        e["von_idx"], e["bis_idx"] = lage
        if e["art"] != "pause":
            idx = z.indizes(e["t0"], e["t1"])
            hm = hoehenmeter(z.pts, lage[0], lage[1], idx)
            e["hoehe_auf"], e["hoehe_ab"] = hm["auf"], hm["ab"]
            # Die Strecke aus den Punkten nachmessen: Geteilte oder verschobene
            # Bereiche tragen noch die Strecke des ganzen Bereichs (14.09.2026, das
            # Logbuch zählte sie doppelt). Ohne Punkte bleibt der gespeicherte Wert.
            w = strecke(z.pts, lage[0], lage[1], idx)
            if w is not None:
                e["strecke_m"] = round(w, 1)
    e["tempo_kmh"] = round(e["strecke_m"] / e["dauer_s"] * 3.6, 1) if e["dauer_s"] > 0 and e["art"] not in ("pause",) else 0.0


def _verschmelzen(folge: List[dict]) -> List[dict]:
    raus: List[dict] = []
    for e in folge:
        v = raus[-1] if raus else None
        if v and not e["grenze"] and v["art"] == e["art"] and v["name"] == e["name"] \
                and v["quelle"] == e["quelle"] and abs(v["t1"] - e["t0"]) < 1e-6:
            v["t1"] = e["t1"]
            v["strecke_m"] += e["strecke_m"]
            v["dauer_roh"] = (v.get("dauer_roh") or 0.0) + (e.get("dauer_roh") or 0.0)
            v["bids"] += e["bids"]
            v["geraten"] = v["geraten"] or e["geraten"]
            if e.get("stau"):
                v["stau_s"] = (v.get("stau_s") or 0.0) + (e["t1"] - e["t0"])
            continue
        if e.get("stau"):
            e["stau_s"] = e["t1"] - e["t0"]
        raus.append(e)
    return raus


# 24.10.2026 — Wegtyp unter dem Track (core/wegtyp). Erst ab diesem Anteil eines Abschnitts: der Jakobsweg
# läuft oft neben der Schnellstraße (2 % „Autobahn“ auf 150 km zu Fuß), ein Stau liegt ganz darauf.
WEG_SICHER = 0.6
WEG_RADWEG = 0.5
WEG_MIN_PROBEN = 3
FAEHRE_BIS_KMH = 60.0       # schneller ist keine Fähre (Schottland: 592 km mit 95 km/h über eine Lücke)


def wege_anwenden(folge: List[dict], proben: List[list]) -> None:
    """Was unter dem Abschnitt liegt, entscheidet ohne Raten — nur bei erkannten (nicht von Hand gesetzten) Einträgen:
    überwiegend Fährlinie → Fähre; überwiegend Autobahn/Schnellstraße und doch langsam → Fahrt (Stau, nie Rad);
    „Rad oder Laufen?“ überwiegend auf Radwegen → Rad (vermutet)."""
    from . import wegtyp as _wt
    for e in folge:
        a = _wt.anteile(proben, e["t0"], e["t1"])
        if not a or a.get("_n", 0) < WEG_MIN_PROBEN:
            continue
        e["wegtyp"] = {k: round(v, 2) for k, v in a.items() if k and k != "_n" and v >= 0.1}
        if e["quelle"] == "hand":
            continue
        art = e["art"]
        d = max(1.0, float(e["t1"]) - float(e["t0"]))
        kmh = float(e.get("strecke_m") or 0.0) / d * 3.6
        if a.get("faehre", 0) >= WEG_SICHER and kmh <= FAEHRE_BIS_KMH and art in ("fahrt", "gehen", "laufen", "rad", "unsicher"):
            e["art"], e["geraten"], e["grund"] = "uebersetzen", False, "faehre"
        elif a.get("autobahn", 0) >= WEG_SICHER and art in ("gehen", "laufen", "rad", "unsicher"):
            e["art"], e["geraten"], e["grund"] = "fahrt", False, "autobahn"
        elif art == "unsicher" and a.get("radweg", 0) >= WEG_RADWEG:
            e["art"], e["geraten"], e["grund"] = "rad", True, "radweg"


def modell_anwenden(folge: List[dict], modell: dict, points, wege, aktivitaet) -> None:
    from . import lernen as _le, wegtyp as _wt
    kandidaten = [e for e in folge if e["quelle"] == "auto" and not e.get("grund") and (e.get("geraten") or e["art"] == "unsicher")
                  and e["art"] not in ("pause",)]
    if not kandidaten:
        return
    vor = _le.punkte_vorbereiten(points)
    schwelle = float(modell.get("schwelle") or _le.SCHWELLE)
    for e in kandidaten:
        m = _le.merkmale(vor, e["t0"], e["t1"], _wt.anteile(wege, e["t0"], e["t1"]) if wege else None, aktivitaet or "")
        art, p = _le.vorhersagen(modell, m)
        if art and p >= schwelle and _le.art_ziel(e["art"]) != art:
            e["art"], e["geraten"], e["grund"] = art, True, "modell"


def eintraege(bereiche: List[dict], points=None, aktivitaet: Optional[str] = None,
              tage: Optional[List[dict]] = None, einstellungen: Optional[dict] = None,
              wege: Optional[List[list]] = None, modell: Optional[dict] = None) -> dict:
    """Aus den rohen Bereichen der Einteilung „Bewegung" die Folge des Logbuchs.

    Rückgabe: ``eintraege`` (Bereiche mit t0 < t1), ``punkte`` (t0 == t1),
    ``verborgen`` (Kennungen der aufgegangenen kurzen Halte), ``zusammenfassung``
    je Anzeige-Art und ``hoechster`` (der höchste Punkt der ganzen Tour).
    """
    einst = dict(STANDARD)
    einst.update({k: float(v) for k, v in (einstellungen or {}).items() if v is not None})
    z = _Zeiten(points) if points else None
    prior = _prior(aktivitaet)

    punkte: List[dict] = []
    folge: List[dict] = []
    for b in sorted(bereiche or [], key=lambda x: (x["t0"], x["t1"])):
        if b.get("art") == "weg":          # Grabstein eines gelöschten Punkts
            continue
        if b["t1"] < b["t0"] and b.get("art") not in PUNKT_ARTEN:
            # Rückwärts laufender Bereich: kaputt, kein Punkt „gehen" (14.09.2026)
            log.warning("logbuch: Bereich %s (%s) endet vor seinem Beginn (%s > %s) — übergangen",
                        b.get("id"), b.get("art"), b["t0"], b["t1"])
            continue
        if b.get("art") in PUNKT_ARTEN or b["t1"] <= b["t0"]:
            p = dict(b)
            p["t"] = float(b["t0"])
            if z is not None and p.get("idx") is None:
                p["idx"] = z.naechster(p["t"])
            punkte.append(p)
            continue
        folge.append(_eintrag(b))

    # Q5: kurze Stillstände gehen im Nachbarn auf. Benannte Halte der
    # Aufzeichnungs-App bleiben — der Nutzer hat sie bewusst gesetzt. Handarbeit
    # bleibt immer.
    verborgen: List[str] = []
    behalten: List[dict] = []
    for k, e in enumerate(folge):
        kurz = (e["art"] == "pause" and (e["t1"] - e["t0"]) < einst["pause_ab_s"]
                and e["quelle"] == "auto")
        if not kurz:
            behalten.append(e)
            continue
        verborgen.append(e["id"])
        if behalten:
            behalten[-1]["t1"] = e["t1"]          # der Abschnitt davor läuft durch
        elif k + 1 < len(folge):
            folge[k + 1]["t0"] = e["t0"]          # ganz am Anfang: der danach beginnt früher
    folge = behalten

    # 24.10.2026 — Wegtyp vor allen Tempo-Regeln: was er sicher sagt, muss niemand mehr raten
    if wege:
        wege_anwenden(folge, wege)

    # Q8: unsicher dem Nachbarn zuschlagen — Pausen dazwischen zählen nicht.
    def bewegter_nachbar(k, schritt):
        m = k + schritt
        while 0 <= m < len(folge):
            art = FAMILIE.get(folge[m]["art"], folge[m]["art"])   # Hand-Arten → Familie
            if art in BEWEGT or art == "wassersport":
                return art
            if art == "unsicher":
                return None
            m += schritt
        return None

    # 14.09.2026 (Marc, Radtour mit dem Sohn, 7–12 km/h, zwischendurch abgestiegen): „unsicher“
    # heißt hier fast immer langsames Rad. Dem Gehen-Nachbarn zugeschlagen wurde daraus eine
    # einzige Wanderung. Jetzt entscheidet das Tempo mit: Gehen geht nicht dauerhaft über
    # UNSICHER_RAD_AB_KMH — ein solches Stück wird Rad (bzw. Laufen, wenn die Tour ein Lauf ist).
    lauf_tour = bool(aktivitaet) and any(w in str(aktivitaet).lower() for w in ("lauf", "run", "jog", "trail"))

    def tempo(e):
        # Bewegtes Tempo VOR dem Aufgehen kurzer Halte (Q5 verlängert t0/t1 und verwässert es)
        d = e.get("dauer_roh") or (e["t1"] - e["t0"])
        return (e["strecke_m"] / d * 3.6) if d > 0 else 0.0

    for k, e in enumerate(folge):
        if e["art"] != "unsicher":
            continue
        links, rechts = bewegter_nachbar(k, -1), bewegter_nachbar(k, +1)
        schnell = tempo(e) >= UNSICHER_RAD_AB_KMH
        neu = None
        if links and rechts and links == rechts:
            neu = links
        elif (links and not rechts) or (rechts and not links):
            neu = links or rechts
        elif links and rechts:                       # verschiedene Nachbarn: das passende Tempo
            zu_fuss = [x for x in (links, rechts) if x == "gehen"]
            anders = [x for x in (links, rechts) if x in ("rad", "laufen")]   # Fahrt/Fähre: ehrlich unsicher lassen
            neu = (anders[0] if anders else None) if schnell else (zu_fuss[0] if zu_fuss else None)
        if neu == "gehen" and schnell:
            neu = "laufen" if lauf_tour else "rad"
        if neu is None and schnell and not links and not rechts and prior != "wassersport":
            neu = "laufen" if lauf_tour else "rad"
        if neu and neu != "uebersetzen":
            e["art"] = neu
            e["geraten"] = True

    # Langsame Fahrt (13.09.2026, an der Wohnmobil-Reise gesehen): Rät das Archiv
    # die Aktivität falsch („Rad" für ein Wohnmobil), wird jede Ortsdurchfahrt mit
    # 15–35 km/h zu „Rad" — 199 Einträge, 31 Stunden. Ein kurzes Stück Rad oder
    # Laufen ZWISCHEN zwei Fahrten ist aber praktisch immer langsames Fahren.
    # Vermutet, nicht gewusst — deshalb als „geraten" gekennzeichnet.
    for k, e in enumerate(folge):
        if e["art"] not in ("rad", "laufen") or e["quelle"] != "auto" or e.get("grund") == "radweg":
            continue
        if (e["t1"] - e["t0"]) >= einst["langsame_fahrt_bis_s"]:
            continue
        if bewegter_nachbar(k, -1) == "fahrt" and bewegter_nachbar(k, +1) == "fahrt":
            e["art"] = "fahrt"
            e["geraten"] = True
    # … und wenn die Fahrt die Reise beherrscht (Hunderte Kilometer, doppelt so
    # weit wie alles „Rad") UND das „Rad" aus lauter kurzen Stücken besteht, ist
    # auch das übrige „Rad" langsames Fahren: Ortsdurchfahrten. Eine Radtour mit
    # Anreise im Auto hat wenige lange Rad-Blöcke — die bleiben Rad.
    fahrt_m = sum(e["strecke_m"] for e in folge if e["art"] == "fahrt")
    rad = [e for e in folge if e["art"] == "rad" and e["quelle"] == "auto" and e.get("grund") != "radweg"]
    rad_m = sum(e["strecke_m"] for e in rad)
    kurz = sum(1 for e in rad if (e["t1"] - e["t0"]) < einst["langsame_fahrt_bis_s"])
    if rad and fahrt_m >= einst["fahrt_beherrscht_ab_m"] and fahrt_m >= 2.0 * rad_m \
            and kurz >= 0.7 * len(rad):
        for e in rad:
            e["art"] = "fahrt"
            e["geraten"] = True

    # 22.10.2026 — Kleinkram und Stau (Marc: „da gibt's noch viel, was besser erkannt werden könnte“)
    # (1) Bewegung unter MIKRO_S geht im Nachbarn auf, wie kurze Halte (Q5) — „Spaziergang · 0 min“.
    behalten = []
    for k, e in enumerate(folge):
        mikro = (e["art"] not in ("pause",) and e["quelle"] == "auto" and not e["name"]
                 and (e.get("dauer_roh") or (e["t1"] - e["t0"])) < MIKRO_S)
        if not mikro:
            behalten.append(e)
            continue
        verborgen.append(e["id"])
        if behalten:
            behalten[-1]["t1"] = e["t1"]
        elif k + 1 < len(folge):
            folge[k + 1]["t0"] = e["t0"]
    folge = behalten

    def nachbar_direkt(k, schritt):
        m = k + schritt
        return folge[m] if 0 <= m < len(folge) and abs(folge[m]["t1" if schritt < 0 else "t0"] - folge[k]["t0" if schritt < 0 else "t1"]) < 1.0 else None

    # (2) „Fahrt“ im Schritttempo über ein paar hundert Meter, ohne Fahrt daneben: zu Fuß (Parkplatz, GPS-Sprünge).
    for k, e in enumerate(folge):
        if e["art"] != "fahrt" or e["quelle"] != "auto" or e["strecke_m"] >= FAHRT_ZU_FUSS_M or tempo(e) >= UNSICHER_RAD_AB_KMH:
            continue
        if e.get("grund"):                      # vom Wegtyp entschieden (Autobahn, Fähre) — nicht zurückraten
            continue
        if any((n or {}).get("art") == "fahrt" for n in (nachbar_direkt(k, -1), nachbar_direkt(k, +1))):
            continue
        e["art"] = "gehen"
        e["geraten"] = True

    # (3) Stau: langsame Stücke (unsicher/gehen/rad/laufen) direkt zwischen zwei Fahrten, ohne Halt — und das Auto steht
    # danach woanders. Wer aussteigt, kommt zum Auto zurück; im Stau rollt es weiter.
    def lage_bei(t):
        if z is None:
            return None
        i = z.naechster(t)
        p = z.pts[i] if i is not None else None
        g = (lambda n: p.get(n) if isinstance(p, dict) else getattr(p, n, None))
        try:
            return float(g("lat")), float(g("lon"))
        except (TypeError, ValueError):
            return None

    k = 0
    while k < len(folge):
        if folge[k]["art"] != "fahrt":
            k += 1
            continue
        m = k + 1
        while m < len(folge) and folge[m]["art"] in ("unsicher", "gehen", "rad", "laufen") and folge[m]["quelle"] == "auto" \
                and not folge[m]["name"] and abs(folge[m]["t0"] - folge[m - 1]["t1"]) < 1.0:
            m += 1
        lauf = folge[k + 1:m]
        if lauf and m < len(folge) and folge[m]["art"] == "fahrt" and abs(folge[m]["t0"] - folge[m - 1]["t1"]) < 1.0 \
                and (lauf[-1]["t1"] - lauf[0]["t0"]) <= einst["langsame_fahrt_bis_s"]:
            a, b = lage_bei(lauf[0]["t0"]), lage_bei(lauf[-1]["t1"])
            versatz = _hav(a[0], a[1], b[0], b[1]) if a and b else 0.0
            weg_m = sum(e["strecke_m"] for e in lauf)
            # … und der Track fährt den Versatz auch ab (kein GPS-Sprung über eine Lücke)
            if versatz >= STAU_VERSATZ_M and weg_m >= 0.7 * versatz:
                for e in lauf:
                    e["art"] = "fahrt"
                    e["geraten"] = True
                    e["stau"] = True
        k = m if m > k + 1 else k + 1

    # 24.10.2026 (core/lernen) — gelerntes Modell aus geteilten Korrekturen: nur wo die Regeln raten oder
    # offen lassen, nur Erkanntes, nur bei hoher Sicherheit — und wieder als „vermutet“
    if modell and points:
        modell_anwenden(folge, modell, points, wege, aktivitaet)

    # 14.09.2026 — die Aktivität aus der Datei ist ein schwacher Hinweis: Komoot schreibt
    # „hike“ auch über eine Radtour. Überwiegt Rad/Laufen die Gehstrecke deutlich, gilt der
    # Wander-Hinweis nicht; die Gehstücke dazwischen sind dann Spaziergänge (Absteigen).
    if prior in ("wanderung", "spaziergang"):
        rad_m = sum(e["strecke_m"] for e in folge if e["art"] in ("rad", "laufen"))
        geh_m = sum(e["strecke_m"] for e in folge if e["art"] == "gehen")
        if rad_m > geh_m:
            prior = ""
    folge = _verschmelzen(folge)
    for e in folge:
        _messen(e, z)
        e["anzeige_art"] = _anzeige_art(e, prior, einst)
        e["notiz"] = next((b.get("notiz") or "" for b in bereiche if b["id"] in e["bids"] and b.get("notiz")), "")

    # Tag je Eintrag (nach Beginn) — nur, wenn es Tage gibt
    fenster = [(float(x["t0"]), float(x["t1"]), int(x.get("nr") or k + 1))
               for k, x in enumerate(tage or []) if x.get("t0") is not None]
    if fenster:
        def tag_von(t):
            # Ein Tag mit nur einem Punkt hat kein Fenster (berechnen_tage) — dann
            # zählt der letzte Tag, der vor dieser Zeit begonnen hat, nie der
            # letzte der Reise (sonst springt die Liste an der Stelle um).
            return next((nr for t0, t1, nr in fenster if t0 - 1 <= t <= t1 + 1),
                        next((nr for t0, _t1, nr in reversed(fenster) if t0 - 1 <= t), fenster[0][2]))
        for e in folge + punkte:
            t = e.get("t0", e.get("t"))
            e["tag"] = tag_von(t)
        # Eine Pause, die über die Nacht in den nächsten Tag reicht, ist eine
        # Übernachtung — im Wohnmobil-Logbuch die häufigste Zeile.
        for e in folge:
            if e["art"] == "pause" and (tag_von(e["t1"]) or e["tag"]) != e["tag"]:
                e["anzeige_art"] = "uebernachtung"

    # 22.10.2026 — Start und Ziel an die Bewegung: Die Aufzeichnung läuft oft schon/noch, während man steht. Ein Start
    # mitten in der Übernachtung (07:34, losgefahren 08:54) rückt an ihr Ende, ein Ziel in einer Pause an deren Anfang.
    for p in punkte:
        if p.get("art") not in ("start", "ziel") or p.get("quelle", "auto") != "auto":
            continue
        t = float(p["t"])
        for e in folge:
            if e["art"] != "pause":
                continue
            if p["art"] == "start" and e["t0"] <= t < e["t1"]:
                t = e["t1"]
            elif p["art"] == "ziel" and e["t0"] < t <= e["t1"]:
                t = e["t0"]
        if t != float(p["t"]):
            p["t"] = p["t0"] = p["t1"] = t
            if z is not None:
                p["idx"] = z.naechster(t)
                q = z.pts[p["idx"]] if p["idx"] is not None else None
                if q is not None:
                    g = (lambda n, q=q: q.get(n) if isinstance(q, dict) else getattr(q, n, None))
                    p["lat"], p["lon"] = g("lat"), g("lon")

    # 22.10.2026 — „Höchster Punkt“ nur, wo er etwas sagt: zu Fuß/Rad/in der Pause erreicht, oder auf einer Fahrt ab
    # HOECHSTER_FAHRT_AB_M (Pass mit dem Motorrad). Auf der Autobahn ist er Zufall (Marc, Rügen-Reise: 652 m auf der A7).
    weg = []
    for p in punkte:
        if p.get("art") != "hoechster_punkt" or p.get("quelle", "auto") != "auto":
            continue
        t = float(p["t"])
        drin = next((e for e in folge if e["t0"] <= t <= e["t1"]), None)
        if drin is not None and drin["art"] == "fahrt" and (p.get("ele") is None or float(p["ele"]) < HOECHSTER_FAHRT_AB_M):
            weg.append(p)
            continue
        # 23.10.2026 (Marc, Schorfheide: „Höchster Punkt · 85 m“) — wie bei den Highlight-Schildern (HUB_MIN_M): nur, wenn
        # es an dem Tag spürbar bergauf ging
        if z is not None and p.get("ele") is not None:
            f = next(((float(x["t0"]), float(x["t1"])) for k, x in enumerate(tage or [])
                      if x.get("t0") is not None and int(x.get("nr") or k + 1) == p.get("tag")), (z.ts[0], z.ts[-1]) if z.ts else None)
            hs = [h for h in (_ele(z.pts[i]) for i in z.indizes(*f)) if h is not None] if f else []
            if hs and float(p["ele"]) - min(hs) < HOECHSTER_HUB_M:
                weg.append(p)
    if weg:
        punkte = [p for p in punkte if p not in weg]

    zsf: dict = {}
    for e in folge:
        x = zsf.setdefault(e["anzeige_art"], {"anzahl": 0, "dauer_s": 0.0, "strecke_m": 0.0, "hoehe_auf": 0})
        x["anzahl"] += 1
        x["dauer_s"] += e["dauer_s"]
        x["strecke_m"] += e["strecke_m"]
        x["hoehe_auf"] += e.get("hoehe_auf") or 0
    for x in zsf.values():
        x["dauer_s"] = round(x["dauer_s"], 1)
        x["strecke_m"] = round(x["strecke_m"], 1)

    hoechster = None
    for p in punkte:
        if p.get("art") == "hoechster_punkt" and p.get("ele") is not None:
            if hoechster is None or p["ele"] > hoechster["ele"]:
                hoechster = p

    return {"eintraege": folge, "punkte": punkte, "verborgen": verborgen,
            "zusammenfassung": zsf, "hoechster": hoechster, "einstellungen": einst}


# ── Stufe 3: Ortsnamen (Q10) und Sehenswürdigkeiten (Q11) ──────────────────
#
# Beides braucht Netz und läuft NACH dem Logbuch im Hintergrund (Kasten unten
# rechts), abschaltbar. Was einmal nachgeschlagen wurde, bleibt in der Bibliothek:
# Ortsnamen je Stelle (rund 100 m Raster), POIs je Tour. Ohne Netz wird später
# nachgetragen — es fehlt dann ein Name, nie ein Eintrag.

import json as _json
import math as _math
import sqlite3 as _sqlite3
from datetime import datetime as _dt, timezone as _tz

SCHEMA = """
CREATE TABLE IF NOT EXISTS logbuch_orte (
    schluessel TEXT PRIMARY KEY,   -- "lat,lon" auf 3 Stellen (~100 m)
    ort        TEXT DEFAULT '',
    gemeinde   TEXT DEFAULT '',
    land       TEXT DEFAULT '',
    geaendert  TEXT
);
CREATE TABLE IF NOT EXISTS logbuch_pois (
    tour       TEXT PRIMARY KEY,
    daten      TEXT DEFAULT '[]',
    geaendert  TEXT
);
"""
POI_WICHTIG_RANG = 1        # Gipfel, Pässe, Burgen: immer ins Logbuch (Q11)
POI_PAUSE_NAH_M = 300.0     # ein POI so nah an einer Pause gehört dazu
POI_WEG_RANG = 2            # zu Fuß/mit dem Rad: auch Aussichtspunkte, Wasserfälle, Seen, Leuchttürme …
POI_WEG_MAX = 3             # … höchstens so viele je Abschnitt (die wichtigsten)
POI_WEG_ARTEN = ("wanderung", "spaziergang", "gehen", "laufen", "rad")


def schema_anlegen(conn: _sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    conn.commit()


def _jetzt() -> str:
    return _dt.now(_tz.utc).isoformat(timespec="seconds")


def ort_schluessel(lat, lon) -> str:
    return f"{round(float(lat), 3):.3f},{round(float(lon), 3):.3f}"


def ort_lesen(conn, lat, lon) -> Optional[dict]:
    r = conn.execute("SELECT ort, gemeinde, land FROM logbuch_orte WHERE schluessel = ?",
                     (ort_schluessel(lat, lon),)).fetchone()
    return {"ort": r[0], "gemeinde": r[1], "land": r[2]} if r else None


def ort_merken(conn, lat, lon, ort: str, gemeinde: str = "", land: str = "") -> None:
    conn.execute("INSERT INTO logbuch_orte(schluessel, ort, gemeinde, land, geaendert) VALUES(?,?,?,?,?) "
                 "ON CONFLICT(schluessel) DO UPDATE SET ort=excluded.ort, gemeinde=excluded.gemeinde, "
                 "land=excluded.land, geaendert=excluded.geaendert",
                 (ort_schluessel(lat, lon), ort or "", gemeinde or "", land or "", _jetzt()))
    conn.commit()


def ort_aus_adresse(a: Optional[dict]) -> dict:
    """Aus der normalisierten Adresse (core/geocode) das Grobe: „Ort, Gemeinde"."""
    if not a:
        return {"ort": "", "gemeinde": "", "land": ""}
    ort = (a.get("city") or a.get("county") or a.get("state") or "").strip()
    gemeinde = (a.get("county") or a.get("state") or "").strip()
    if gemeinde == ort:
        gemeinde = (a.get("state") or "").strip() if (a.get("state") or "").strip() != ort else ""
    return {"ort": ort, "gemeinde": gemeinde, "land": (a.get("country") or "").strip()}


def ort_kurz(o: Optional[dict]) -> str:
    if not o or not o.get("ort"):
        return ""
    return o["ort"] + (", " + o["gemeinde"] if o.get("gemeinde") and o["gemeinde"] != o["ort"] else "")


def orte_stellen(eintraege_: List[dict], punkte: List[dict], points) -> List[dict]:
    """Wo ein Ortsname gebraucht wird: Pausen „hier", Bewegung „von"/„nach", Punkte „hier".
    Punkte der Aufzeichnungs-App mit Namen brauchen keinen (Q10: App-Name zuerst)."""
    raus: List[dict] = []

    def koord(i):
        if i is None or i < 0 or i >= len(points):
            return None
        p = points[i]
        la = p.get("lat") if isinstance(p, dict) else getattr(p, "lat", None)
        lo = p.get("lon") if isinstance(p, dict) else getattr(p, "lon", None)
        return (float(la), float(lo)) if la is not None and lo is not None else None

    for e in eintraege_:
        if e["art"] == "pause":
            if e.get("name"):
                continue
            k = koord(e.get("von_idx"))
            if k:
                raus.append({"id": e["id"], "rolle": "hier", "lat": k[0], "lon": k[1]})
        else:
            for rolle, idx in (("von", e.get("von_idx")), ("nach", e.get("bis_idx"))):
                k = koord(idx)
                if k:
                    raus.append({"id": e["id"], "rolle": rolle, "lat": k[0], "lon": k[1]})
    for p in punkte:
        if p.get("name") or p.get("art") == "poi":
            continue
        k = koord(p.get("idx")) if p.get("idx") is not None else (
            (float(p["lat"]), float(p["lon"])) if p.get("lat") is not None else None)
        if k:
            raus.append({"id": p["id"], "rolle": "hier", "lat": k[0], "lon": k[1]})
    return raus


def _hav(lat1, lon1, lat2, lon2) -> float:
    R = 6371000.0
    p1, p2 = _math.radians(lat1), _math.radians(lat2)
    d = _math.sin((p2 - p1) / 2) ** 2 + _math.cos(p1) * _math.cos(p2) * _math.sin(_math.radians(lon2 - lon1) / 2) ** 2
    return 2 * R * _math.asin(_math.sqrt(d))


def pois_bewerten(pois: List[dict], eintraege_: List[dict], points) -> List[dict]:
    """Q11: Welche POIs gehören ins Logbuch — Gipfel/Pässe/Burgen immer, andere nur
    in Pausen-Nähe. Alle anderen bleiben in der POI-Spur."""
    pausen = []
    for e in eintraege_:
        if e["art"] == "pause" and e.get("von_idx") is not None:
            p = points[e["von_idx"]]
            la = p.get("lat") if isinstance(p, dict) else getattr(p, "lat", None)
            lo = p.get("lon") if isinstance(p, dict) else getattr(p, "lon", None)
            if la is not None:
                pausen.append((float(la), float(lo), e["id"]))
    # 22.10.2026 (Marc, Rügen: Wissower Klinken, Victoria-Sicht fehlten im Logbuch): wer zu Fuß oder mit dem Rad
    # unterwegs war, hat die Aussicht gesehen — dort zählt auch Rang 2, je Abschnitt die POI_WEG_MAX besten.
    wege = [(int(e["von_idx"]), int(e.get("bis_idx") if e.get("bis_idx") is not None else e["von_idx"]))
            for e in eintraege_ if (e.get("anzeige_art") or e["art"]) in POI_WEG_ARTEN and e.get("von_idx") is not None]
    je_weg: dict = {}
    for q in sorted(pois, key=lambda q: int(q.get("rang", 9))):
        idx = q.get("idx")
        if idx is None or int(q.get("rang", 9)) > POI_WEG_RANG:
            continue
        w = next((k for k, (a, b) in enumerate(wege) if a <= int(idx) <= b), None)
        if w is not None and len(je_weg.setdefault(w, [])) < POI_WEG_MAX:
            je_weg[w].append(id(q))
    am_weg = {i for v in je_weg.values() for i in v}
    raus = []
    for q0 in pois:
        q = dict(q0)
        nah = next((pid for la, lo, pid in pausen if _hav(la, lo, q["lat"], q["lon"]) <= POI_PAUSE_NAH_M), None)
        q["pause"] = nah
        q["wichtig"] = bool(int(q.get("rang", 9)) <= POI_WICHTIG_RANG or nah or id(q0) in am_weg)
        raus.append(q)
    return raus


def pois_lesen(conn, tour: str) -> Optional[List[dict]]:
    r = conn.execute("SELECT daten FROM logbuch_pois WHERE tour = ?", (tour,)).fetchone()
    if not r:
        return None
    try:
        return list(_json.loads(r[0] or "[]"))
    except (TypeError, ValueError):
        return None


def pois_merken(conn, tour: str, pois: List[dict]) -> None:
    conn.execute("INSERT INTO logbuch_pois(tour, daten, geaendert) VALUES(?,?,?) "
                 "ON CONFLICT(tour) DO UPDATE SET daten=excluded.daten, geaendert=excluded.geaendert",
                 (tour, _json.dumps(pois, ensure_ascii=False, separators=(",", ":")), _jetzt()))
    conn.commit()
