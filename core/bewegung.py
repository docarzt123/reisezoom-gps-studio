"""Bewegungsart und Halte erkennen (docs/IDEAS.md §67, Schritt 2 — 13.09.2026).

Marc: „Wir müssen eben erkennen, was gemacht wird, und das irgendwie sinnvoll
machen. Das wird noch der schwerste überhaupt sein." Und: „die Regeln müssen
halt gefittet werden."

Dieses Modul teilt einen Track in **Bereiche** ein — Gehen, Laufen, Rad, Fahrt,
Übersetzen, Halt, Pause oder unsicher — und ändert dabei keinen einzigen Punkt.
Es ist das Fundament für zwei Dinge:

1. den Track-Check ohne Fehlalarme: jede Schwelle richtet sich nach der
   Bewegungsart des Abschnitts (Q13, Q17, Q18);
2. die Einteilung einer Reise in der Bibliothek (Q5, Q6).

**Regeln, keine Blackbox.** Jede Grenze unten ist an echten Aufzeichnungen
gemessen (Archiv des Autors, 726 Touren, und die Prüfsammlung unter
tests/pruefsammlung). Tempo wird über ein Zeitfenster gemittelt, nicht Punkt für
Punkt — sonst entscheidet das Zittern des Handys über die Bewegungsart.

**Unsicher ist eine erlaubte Antwort (Q20).** Wo die Daten es nicht hergeben
(Laufen oder Rad zwischen 8 und 15 km/h ohne Hinweis der Tour), sagt die
Erkennung das, statt zu raten. Der Mensch kann jeden Bereich von Hand setzen.
"""
from __future__ import annotations

import re
from typing import List, Optional

from . import trackcheck as _tc

# ── Gemessene Grenzen ───────────────────────────────────────────────────────
#
# Tempo über 2-Minuten-Fenster im Archiv (km/h, 5 / 50 / 95 %):
#   wandern      1,0 / 4,4 / 5,9      spaziergang 0,9 / 2,3 / 4,2
#   laufen       0,9 / 5,4 / 16,7     rad         0,3 / 9,9 / 75 (eine „Rad"-Tour mit Autofahrt)
#   auto        12,2 / 57,5 / 131,9
FENSTER_S = 120.0           # Tempo wird über ±60 s gemittelt
GEHEN_BIS_KMH = 7.5         # darüber läuft oder rollt man
LAUFEN_BIS_KMH = 20.0       # mit Hinweis „laufen": bis hier Laufen
RAD_AB_KMH = 15.0           # ohne Hinweis: ab hier Rad (8–15 km/h ist unsicher)
FAHRT_AB_KMH = 35.0         # darüber auf Dauer: Fahrzeug
FAHRT_MIN_S = 150.0         # … und zwar mindestens so lange am Stück
FAHRT_OHNE_PUNKTE_M = 2000.0  # ein Segment so lang mit Fahrzeugtempo = Fahrt ohne Aufzeichnung

# Halt: mindestens 3 Minuten innerhalb eines kleinen Kreises. Der Radius liegt
# über dem gemessenen Knäuel-Radius beim Stehen (Median 25 m, 90 % 30 m).
HALT_RADIUS_M = 40.0
HALT_MIN_S = 180.0
# Pause über ein Loch hinweg (Wirtshaus, Q17): Die Zeit zwischen zwei Punkten
# ist deutlich länger, als die Strecke dazwischen zu gehen gedauert hätte.
PAUSE_MIN_S = 180.0

# Kurze Stücke werden dem Nachbarn zugeschlagen — ein 40-Sekunden-„Rad" mitten
# in einer Wanderung ist ein bergab gerannter Hang oder Zittern.
LAUF_MIN_S = 180.0
LAUF_MIN_M = 300.0

ARTEN = ("gehen", "laufen", "rad", "fahrt", "uebersetzen", "halt", "pause", "unsicher")
BEWEGT = ("gehen", "laufen", "rad", "fahrt", "uebersetzen", "unsicher")


# ── Hilfen ──────────────────────────────────────────────────────────────────

def _prior(aktivitaet: Optional[str]) -> str:
    """Die Aktivität der Tour (Archiv, Komoot …) auf einen Hinweis abbilden."""
    a = (aktivitaet or "").lower()
    if any(w in a for w in ("lauf", "run", "jog", "trail")):
        return "laufen"
    if any(w in a for w in ("rad", "bike", "cycl", "mtb", "velo", "gravel")):
        return "rad"
    if any(w in a for w in ("auto", "car", "driv", "motor", "womo", "wohnmobil")):
        return "fahrt"
    if any(w in a for w in ("wander", "hik", "spazier", "walk", "geh")):
        return "gehen"
    return ""


def klasse(kmh: float, prior: str = "") -> str:
    """Tempo (über das Fenster gemittelt) → Bewegungsart."""
    if kmh < GEHEN_BIS_KMH:
        return "gehen"
    if kmh >= FAHRT_AB_KMH:
        return "fahrt"
    if prior == "laufen":
        return "laufen" if kmh < LAUFEN_BIS_KMH else "unsicher"
    if prior == "rad":
        return "rad"
    if prior == "fahrt":
        return "fahrt" if kmh >= RAD_AB_KMH else "unsicher"
    return "rad" if kmh >= RAD_AB_KMH else "unsicher"


def _fenster_tempo(sp: "_tc._Spur", sperre: List[bool]) -> List[Optional[float]]:
    """Tempo je Segment, gemittelt über ±FENSTER_S/2 (Strecke ÷ Zeit).

    Gesperrte Segmente (Halte, Übersetzen) zählen nicht mit — sonst zieht eine
    Kaffeepause das Tempo der Wanderung davor und danach nach unten.
    """
    n = sp.n
    halb = FENSTER_S / 2.0
    tempo: List[Optional[float]] = [None] * max(0, n - 1)
    if n < 2 or not sp.hat_zeit:
        return tempo
    # Präfixsummen über erlaubte Segmente
    cum_d = [0.0] * n
    cum_t = [0.0] * n
    for i in range(n - 1):
        dt = sp.dt(i, i + 1)
        ok = (not sperre[i]) and sp.L[i] is not None and dt is not None and dt > 0
        cum_d[i + 1] = cum_d[i] + (sp.L[i] if ok else 0.0)
        cum_t[i + 1] = cum_t[i] + (dt if ok else 0.0)
    lo = hi = 0
    for i in range(n - 1):
        if sperre[i] or sp.ts[i] is None:
            continue
        mitte = sp.ts[i]
        while lo < i and (sp.ts[lo] is None or mitte - sp.ts[lo] > halb):
            lo += 1
        if hi < i + 1:
            hi = i + 1
        while hi + 1 < n and sp.ts[hi + 1] is not None and sp.ts[hi + 1] - mitte <= halb:
            hi += 1
        d = cum_d[hi] - cum_d[lo]
        t = cum_t[hi] - cum_t[lo]
        if t <= 0:
            dt = sp.dt(i, i + 1)
            tempo[i] = (sp.L[i] / dt) if (dt and dt > 0 and sp.L[i] is not None) else None
        else:
            tempo[i] = d / t
    return tempo


# ── Halte und Pausen ────────────────────────────────────────────────────────

def halte(sp: "_tc._Spur") -> List[dict]:
    """Stellen, an denen man mindestens drei Minuten nicht vom Fleck kam.

    Marc (Q18): Zittern erkennt man daran, dass man trotz großer Einzelsprünge
    **netto nicht vorankommt**. Genau das misst der Kreis: Solange alle Punkte
    um den laufenden Mittelpunkt bleiben, ist es ein Halt — egal wie wild sie
    darin herumspringen. Wer um einen Aussichtsturm herumgeht, verlässt den
    Kreis nach kurzer Zeit und bleibt Bewegung.
    """
    raus: List[dict] = []
    n = sp.n
    if n < 2 or not sp.hat_zeit:
        return raus
    i = 0
    while i < n - 1:
        if sp.ts[i] is None:
            i += 1
            continue
        # FESTER Anker, kein mitwandernder Mittelpunkt: Der wanderte beim
        # langsamen Aufstieg mit, und am Teide wurden aus 13 Stunden Wanderung
        # 5 Stunden „Halt" (gemessen beim ersten Fitten, 13.09.2026).
        a_lat, a_lon = sp.lat[i], sp.lon[i]
        j = i
        while j + 1 < n and sp.seg[j + 1] == sp.seg[i]:
            if _tc._hav(a_lat, a_lon, sp.lat[j + 1], sp.lon[j + 1]) > HALT_RADIUS_M:
                break
            j += 1
        dauer = sp.dt(i, j) or 0.0
        if j > i and dauer >= HALT_MIN_S:
            weg = sum((sp.L[x] or 0.0) for x in range(i, j))
            netto = sp.d(i, j)
            raus.append({"a": i, "b": j, "dauer_s": dauer, "weg_m": weg,
                         "zitter": weg > max(3.0 * netto, 2.0 * HALT_RADIUS_M)})
            i = j
        else:
            i += 1
    return raus


def pausen(sp: "_tc._Spur", sperre: List[bool], tempo: List[Optional[float]]) -> List[dict]:
    """Pausen über ein Loch hinweg — der Wirtshaus-Fall (Q17).

    Zwischen zwei Punkten liegt viel mehr Zeit, als die Strecke gebraucht
    hätte. Die Wegzeit wird mit dem Tempo der Umgebung gerechnet; was übrig
    bleibt, ist Pause. Ob dazu auch eine Lücke gehört, entscheidet der
    Track-Check (fehlende Wegzeit ≥ 60 s).
    """
    raus: List[dict] = []
    for i in range(sp.n - 1):
        if sperre[i] or sp.L[i] is None:
            continue
        dt = sp.dt(i, i + 1)
        if dt is None or dt < PAUSE_MIN_S:
            continue
        v = _tempo_umgebung(tempo, i)
        if not v:
            continue
        wegzeit = sp.L[i] / v
        rest = dt - wegzeit
        if rest >= PAUSE_MIN_S:
            raus.append({"a": i, "b": i + 1, "dauer_s": rest, "wegzeit_s": wegzeit,
                         "abstand_m": sp.L[i]})
    return raus


def _tempo_umgebung(tempo: List[Optional[float]], i: int, weite: int = 25) -> Optional[float]:
    werte = [t for t in tempo[max(0, i - weite):i] + tempo[i + 1:i + 1 + weite]
             if t is not None and t > 0.3]
    if not werte:
        return None
    werte.sort()
    return werte[len(werte) // 2]


# ── Halte aus der Aufzeichnungs-App (Q8) ────────────────────────────────────

_VON_BIS = re.compile(r"(\d{1,2}):(\d{2})\s*(?:bis|–|-|to)\s*(\d{1,2}):(\d{2})(?:\s*\+(\d))?")


def app_dauer_s(text: str) -> Optional[float]:
    """„15:31 bis 13:23 +1" → Dauer in Sekunden. Unabhängig von der Zeitzone."""
    m = _VON_BIS.search(text or "")
    if not m:
        return None
    h1, m1, h2, m2, tage = m.groups()
    a = int(h1) * 60 + int(m1)
    b = int(h2) * 60 + int(m2) + 1440 * int(tage or 0)
    if b < a:
        b += 1440
    return float((b - a) * 60)


def app_halte(sp: "_tc._Spur", wegpunkte: List[dict], radius_m: float = 150.0) -> List[dict]:
    """Wegpunkte mit Von-bis-Zeit (Geory u. a.) den Punkten des Tracks zuordnen.

    Die Uhrzeiten im Text sind Ortszeit ohne Zone — gerechnet wird deshalb nur
    mit ihrer DAUER. Der Ort des Wegpunkts sucht sich die Track-Stelle, an der
    so lange niemand weiterkam; der Name kommt aus der App.
    """
    raus: List[dict] = []
    if not wegpunkte or sp.n < 2 or not sp.hat_zeit:
        return raus
    for w in wegpunkte:
        try:
            wl, wo = float(w.get("lat")), float(w.get("lon"))
        except (TypeError, ValueError):
            continue
        soll = app_dauer_s(" ".join(str(w.get(k) or "") for k in ("desc", "cmt", "name")))
        if not soll:
            continue
        # Zusammenhängende Läufe von Punkten im Umkreis des Wegpunkts
        kandidaten = []
        i = 0
        while i < sp.n:
            if _tc._hav(wl, wo, sp.lat[i], sp.lon[i]) <= radius_m:
                j = i
                while j + 1 < sp.n and _tc._hav(wl, wo, sp.lat[j + 1], sp.lon[j + 1]) <= radius_m:
                    j += 1
                # Ein Halt steckt oft in einem Loch: Strecken-Logger (Geory) setzen
                # nach dem Losfahren erst nach ~200 m wieder einen Punkt — der liegt
                # dann schon außerhalb des Umkreises. Folgt auf den letzten Punkt im
                # Umkreis eine lange Stille, reicht der Halt bis zum nächsten Punkt.
                ende = j
                if j + 1 < sp.n and (sp.dt(j, j + 1) or 0.0) >= 300.0:
                    ende = j + 1
                dauer = sp.dt(i, ende) or 0.0
                kandidaten.append((i, ende, dauer))
                i = j + 1
            else:
                i += 1
        if not kandidaten:
            continue
        a, b, dauer = min(kandidaten, key=lambda c: abs(c[2] - soll))
        if dauer <= 0 or not (0.5 <= dauer / soll <= 2.0 or abs(dauer - soll) <= 900):
            continue
        raus.append({"a": a, "b": b, "dauer_s": dauer, "name": str(w.get("name") or "").strip(),
                     "soll_s": soll})
    return raus


# ── Zusammensetzen ──────────────────────────────────────────────────────────

def erkennen(points, *, aktivitaet: Optional[str] = None,
             wegpunkte: Optional[List[dict]] = None) -> dict:
    """Den Track in Bereiche einteilen. Ändert keinen Punkt.

    Rückgabe: ``{"bereiche": [...], "zusammenfassung": {...}, "prior": str}``.
    Ein Bereich: ``art, von, bis`` (Punkt-Indizes), ``t0, t1`` (Epoch-Sekunden),
    ``dauer_s, strecke_m, tempo_kmh, quelle`` (auto | app), ``name``, ``sicher``.
    """
    sp = points if isinstance(points, _tc._Spur) else _tc._Spur(list(points or []))
    n = sp.n
    prior = _prior(aktivitaet)
    leer = {"bereiche": [], "zusammenfassung": {}, "prior": prior}
    if n < 2 or not sp.hat_zeit:
        return leer

    # Segment-Etiketten, None = noch offen
    etikett: List[Optional[str]] = [None] * (n - 1)
    name: List[str] = [""] * (n - 1)
    quelle: List[str] = ["auto"] * (n - 1)

    def setze(a: int, b: int, art: str, nm: str = "", q: str = "auto"):
        for s in range(max(0, a), min(n - 1, b)):
            etikett[s] = art
            name[s] = nm
            quelle[s] = q

    # 1) Übersetzen (Fähre, Flug, Autozug) — schon im Track-Check gemessen
    for u in _tc.uebersetzen(sp):
        setze(u["a"], u["b"], "uebersetzen")

    # 1b) Fahrt ohne Punkte: ein einzelnes langes Segment mit Fahrzeugtempo. In
    #     einer Tour mit Autofahrt lagen 9,7 km in 13 Minuten ohne einen Punkt
    #     (GPS im Auto aus) — knapp unter der Übersetzen-Grenze, also sonst ein
    #     „Tempo-Fehler" mitten in der Wanderung (Prüfsammlung, 13.09.2026).
    for s in range(n - 1):
        if etikett[s] is not None or sp.L[s] is None or sp.L[s] < FAHRT_OHNE_PUNKTE_M:
            continue
        dt = sp.dt(s, s + 1)
        if dt and dt > 0 and FAHRT_AB_KMH / 3.6 <= sp.L[s] / dt <= _tc.UEBERSETZEN_FAHRZEUG_MAX_MS:
            setze(s, s + 1, "fahrt")

    # 2) Halte aus der App zuerst (Q8), dann die eigenen dort, wo noch frei ist
    for h in app_halte(sp, wegpunkte or []):
        setze(h["a"], h["b"], "halt", h.get("name", ""), "app")
    for h in halte(sp):
        if all(etikett[s] is None for s in range(h["a"], h["b"])):
            setze(h["a"], h["b"], "halt")

    # 3) Tempo über das Fenster, ohne Halte und Übersetzen
    sperre = [e is not None for e in etikett]
    tempo = _fenster_tempo(sp, sperre)

    # 4) Pausen über Löcher hinweg
    for p in pausen(sp, sperre, tempo):
        setze(p["a"], p["b"], "pause")
    sperre = [e is not None for e in etikett]

    # 5) Etappengrenzen sind Pausen, keine Unsicherheit. In zusammengeführten
    #    Mehrtages-Dateien lagen sonst 61 Tage zwischen zwei Etappen als
    #    „unsicher" im Ergebnis (66-Seen-Weg, beim Fitten am 13.09.2026).
    for s in range(n - 1):
        if etikett[s] is None and sp.L[s] is None:
            etikett[s] = "pause"

    # 6) Bewegung nach Tempo. Segmente ohne auswertbare Zeit (gleiche Sekunde,
    #    geheilte Punkte ohne Zeitstempel) erben vom Nachbarn statt „unsicher".
    offen = []
    for s in range(n - 1):
        if etikett[s] is not None:
            continue
        v = tempo[s]
        if v is None:
            offen.append(s)
        else:
            etikett[s] = klasse(v * 3.6, prior)
    for s in offen:
        links = next((etikett[x] for x in range(s - 1, -1, -1) if etikett[x] in BEWEGT), None)
        rechts = next((etikett[x] for x in range(s + 1, n - 1) if etikett[x] in BEWEGT), None)
        etikett[s] = links or rechts or "unsicher"

    # Fahrt nur auf Dauer: kurze Spitzen (bergab, Zittern) sind keine Fahrt
    _kurze_fahrt_entschaerfen(sp, etikett, tempo, prior)

    bereiche = _laeufe(sp, etikett, name, quelle)
    bereiche = _kurze_zuschlagen(sp, bereiche, tempo)
    for b in bereiche:
        _messen(sp, b)
    return {"bereiche": bereiche, "zusammenfassung": zusammenfassung(bereiche), "prior": prior}


def _kurze_fahrt_entschaerfen(sp, etikett, tempo, prior):
    s = 0
    n1 = len(etikett)
    while s < n1:
        if etikett[s] != "fahrt":
            s += 1
            continue
        e = s
        while e + 1 < n1 and etikett[e + 1] == "fahrt":
            e += 1
        dauer = sp.dt(s, e + 1) or 0.0
        if dauer < FAHRT_MIN_S:
            for x in range(s, e + 1):
                v = tempo[x]
                etikett[x] = klasse(min((v or 0) * 3.6, FAHRT_AB_KMH - 0.1), prior)
        s = e + 1


def _laeufe(sp, etikett, name, quelle) -> List[dict]:
    raus: List[dict] = []
    s = 0
    n1 = len(etikett)
    while s < n1:
        e = s
        while (e + 1 < n1 and etikett[e + 1] == etikett[s]
               and name[e + 1] == name[s] and quelle[e + 1] == quelle[s]):
            e += 1
        raus.append({"art": etikett[s], "von": s, "bis": e + 1, "name": name[s],
                     "quelle": quelle[s]})
        s = e + 1
    return raus


def _kurze_zuschlagen(sp, bereiche: List[dict], tempo) -> List[dict]:
    """Zu kurze Bewegungsstücke dem ähnlichsten Nachbarn geben.

    Halte, Pausen, Übersetzen und App-Bereiche bleiben immer stehen — die sind
    gemessen oder mitgeliefert, nicht geschätzt.
    """
    def kurz(k):
        b = bereiche[k]
        if b["art"] not in BEWEGT or b["art"] == "uebersetzen" or b["quelle"] != "auto":
            return False
        dauer = sp.dt(b["von"], b["bis"]) or 0.0
        if dauer >= LAUF_MIN_S:
            return False
        weg = sum((sp.L[x] or 0.0) for x in range(b["von"], b["bis"]))
        if weg < LAUF_MIN_M:
            return True
        # Eingerahmt von derselben Art: eine Minute „Rad" mitten in einer
        # Wanderung ist ein GPS-Fehler, egal wie weit er „gefahren" ist.
        links = bereiche[k - 1]["art"] if k > 0 else None
        rechts = bereiche[k + 1]["art"] if k + 1 < len(bereiche) else None
        return links is not None and links == rechts and links in BEWEGT

    geaendert = True
    while geaendert and len(bereiche) > 1:
        geaendert = False
        for k, b in enumerate(bereiche):
            if not kurz(k):
                continue
            nachbarn = []
            for m in (k - 1, k + 1):
                if 0 <= m < len(bereiche) and bereiche[m]["art"] in BEWEGT \
                        and bereiche[m]["art"] != "uebersetzen":
                    nachbarn.append(m)
            if not nachbarn:
                continue
            # der längere Nachbar gewinnt
            m = max(nachbarn, key=lambda x: (sp.dt(bereiche[x]["von"], bereiche[x]["bis"]) or 0.0))
            ziel = bereiche[m]
            ziel["von"] = min(ziel["von"], b["von"])
            ziel["bis"] = max(ziel["bis"], b["bis"])
            del bereiche[k]
            # gleiche Nachbarn verschmelzen
            _verschmelzen(bereiche)
            geaendert = True
            break
    return bereiche


def _verschmelzen(bereiche: List[dict]) -> None:
    k = 0
    while k + 1 < len(bereiche):
        a, b = bereiche[k], bereiche[k + 1]
        if a["art"] == b["art"] and a["name"] == b["name"] and a["quelle"] == b["quelle"]:
            a["bis"] = b["bis"]
            del bereiche[k + 1]
        else:
            k += 1


def _messen(sp, b: dict) -> None:
    b["t0"] = sp.ts[b["von"]]
    b["t1"] = sp.ts[b["bis"]]
    b["dauer_s"] = round((sp.dt(b["von"], b["bis"]) or 0.0), 1)
    if b["art"] in ("halt", "pause"):
        # Beim Stehen ist die „Strecke" nur Zittern — sie zählt nicht.
        b["strecke_m"] = 0.0
    else:
        b["strecke_m"] = round(sum((sp.L[x] or 0.0) for x in range(b["von"], b["bis"])), 1)
    b["tempo_kmh"] = round(b["strecke_m"] / b["dauer_s"] * 3.6, 2) if b["dauer_s"] > 0 else 0.0
    b["sicher"] = b["art"] != "unsicher"


def zusammenfassung(bereiche: List[dict]) -> dict:
    """Dauer, Strecke und Tempo je Bewegungsart (Q16: kein Ø über gemischte Tracks)."""
    z: dict = {}
    for b in bereiche:
        e = z.setdefault(b["art"], {"dauer_s": 0.0, "strecke_m": 0.0, "anzahl": 0})
        e["dauer_s"] += b.get("dauer_s", 0.0)
        e["strecke_m"] += b.get("strecke_m", 0.0)
        e["anzahl"] += 1
    for e in z.values():
        e["tempo_kmh"] = round(e["strecke_m"] / e["dauer_s"] * 3.6, 2) if e["dauer_s"] > 0 else 0.0
        e["dauer_s"] = round(e["dauer_s"], 1)
        e["strecke_m"] = round(e["strecke_m"], 1)
    return z
