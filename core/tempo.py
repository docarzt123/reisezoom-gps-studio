"""Tempo-Kurve: Videozeit → Stelle auf der Strecke.

Marc, 08.09.2026, nach einer langen Fragerunde: „alles ist eine Beschleunigung
der Tour." Die Grundeinstellung ist eine **Raffung** — 140-fach gegen die echte
Zeit, oder so-und-so-viele Kilometer je Videosekunde, wenn die Tour keine
Zeitstempel hat. Wie lang das Video wird, ergibt sich daraus. Darüber liegen
Einträge:

* **Halt** (`{"art": "halt", "bei": 0..1, "sek": 3.0, "kamera": "kino"}`) —
  die Strecke steht, die Videozeit läuft weiter. Ein Etappen-Übergang ist genau
  das, nur mit Kamerabewegung; `kamera` sagt, welche.
* **Tempo** (`{"art": "tempo", "von": 0..1, "bis": 0..1, "faktor": 0.5}`) —
  dieser Abschnitt läuft mit dem Faktor GEGEN die Grundraffung. Ändert man die
  Grundraffung, ziehen alle Abschnitte mit.

Beides verlängert das Video; die Dauer ist ein Ergebnis, kein Versprechen.

⚠️ Diese Datei ist die EINZIGE Wahrheit für die Kurve. Die Vorschau holt sie
über die Brücke (`animator_tempo_map`), der Render verteilt seine Punkte danach.
Eine zweite Rechnung im Browser wäre genau die Sorte Abweichung, wegen der es
diesen Umbau gibt.
"""
from __future__ import annotations

from typing import Iterable, Sequence

from .gpx import achsenwerte

# Wie die Grundraffung zu lesen ist.
BASIS_ZEIT = "zeit"        # Faktor = Raffung gegen die echte Zeit (140 = 140-fach)
BASIS_STRECKE = "strecke"  # Faktor = Kilometer je Videosekunde
BASIS_PUNKTE = "punkte"    # Faktor = aufgezeichnete Punkte je Videosekunde

MAX_BILDER = 36000         # Deckel: 20 Minuten bei 30 Bildern/s


def _sauber(x, vorgabe=0.0) -> float:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return vorgabe
    return v if v == v and v not in (float("inf"), float("-inf")) else vorgabe


def basis_aus_pace_mode(modus: str) -> str:
    """Alt → neu: die drei Tempo-Voreinstellungen sind die drei Grundlagen."""
    m = str(modus or "raw")
    if m == "real":
        return BASIS_ZEIT
    if m == "even":
        return BASIS_STRECKE
    return BASIS_PUNKTE


def _basis_pruefen(pts: Sequence, basis: str) -> str:
    """Ohne Zeitstempel gibt es keine Zeitachse — dann zählt die Strecke.

    ⚠️ Dieselbe Regel wie in `core/gpx.pace_index_map`. Ohne sie rechnete die
    Kurve auf einer Achse aus lauter Nullen weiter und lieferte für eine geplante
    Route (Komoot, ohne Zeiten) 69 statt 12 Sekunden — 08.09.2026 in der Matrix
    an „Alligator Alley Loop" aufgefallen.
    """
    if basis == BASIS_ZEIT and (not pts or not getattr(pts[-1], "elapsed_s", 0)):
        return BASIS_STRECKE
    return basis


def rate_aus_dauer(pts: Sequence, basis: str, dauer_s: float, *,
                   pausen: str = "trim", pause_ab_s: float = 120.0,
                   pause_auf_s: float = 5.0) -> float:
    """Die Raffung, die genau `dauer_s` ergibt — für bestehende Projekte.

    Damit läuft ein Projekt, das bisher „12 Sekunden, gleichmäßig" hieß, nach
    dem Umbau Bild für Bild genauso. Die Dauer bleibt die Eingabe, gespeichert
    wird die daraus abgeleitete Raffung.
    """
    d = max(0.001, _sauber(dauer_s, 1.0))
    if len(pts) < 2:
        return 1.0
    basis = _basis_pruefen(pts, basis)
    if basis == BASIS_PUNKTE:
        return (len(pts) - 1) / d
    achse = "time" if basis == BASIS_ZEIT else "dist"
    w = achsenwerte(list(pts), achse, pausen, pause_ab_s, pause_auf_s)
    spanne = (w[-1] - w[0]) if w else 0.0
    if spanne <= 0:
        return 1.0
    return (spanne / d) if basis == BASIS_ZEIT else (spanne / 1000.0 / d)


def rate_fuer_wunschdauer(pts: Sequence, basis: str, wunsch_s: float,
                          eintraege: Iterable[dict] = (), **kw) -> float:
    """Die Raffung, mit der das Video GENAU `wunsch_s` lang wird — mit Halten.

    08.09.2026 (Marc, Frage 15): „auf 12 s zurückrechnen." Halte sind ein fester
    Zuschlag, der Streckenteil skaliert umgekehrt mit der Raffung. Also einmal
    mit einer Probe-Raffung rechnen und daraus die richtige ableiten. Bleibt für
    die Strecke keine Zeit übrig (nur Halte, oder Halte länger als der Wunsch),
    kommt die kleinstmögliche sinnvolle Raffung zurück und der Aufrufer sieht an
    der echten Dauer, dass der Wunsch nicht zu halten war.
    """
    wunsch = max(0.1, _sauber(wunsch_s, 1.0))
    probe_rate = rate_aus_dauer(pts, basis, wunsch, **{k: v for k, v in kw.items()
                                                      if k in ("pausen", "pause_ab_s", "pause_auf_s")})
    probe = kurve(pts, basis=basis, rate=probe_rate, eintraege=eintraege, fps=1, **kw)
    konstante = probe["sek_strecke"] * probe_rate          # unabhängig von der Raffung
    rest = wunsch - probe["sek_halte"]
    if rest <= 0.05 or konstante <= 0:
        return probe_rate * 1000.0 if rest <= 0.05 else probe_rate
    return konstante / rest


def kurve(pts: Sequence, *, basis: str = BASIS_STRECKE, rate: float = 1.0,
          eintraege: Iterable[dict] = (), fps: int = 30,
          pausen: str = "trim", pause_ab_s: float = 120.0, pause_auf_s: float = 5.0,
          max_bilder: int = MAX_BILDER) -> dict:
    """Rechnet die Kurve aus.

    Liefert:
      `dauer_s`   — Länge der Animation (ohne Anlauf und Nachlauf)
      `anteile`   — je Bild die Stelle auf der Strecke (0..1)
      `sek_strecke` / `sek_halte` — woraus die Dauer besteht
      `halte`     — die Halte mit ihrer Lage in Videosekunden (für die Spur)
      `hinweise`  — was zurechtgebogen wurde
    """
    hinweise: list[str] = []
    n = len(pts)
    if n < 2:
        return {"dauer_s": 0.0, "anteile": [0.0], "sek_strecke": 0.0, "sek_halte": 0.0,
                "halte": [], "hinweise": ["zu wenig Punkte"], "basis": basis, "rate": rate}

    basis = basis if basis in (BASIS_ZEIT, BASIS_STRECKE, BASIS_PUNKTE) else BASIS_STRECKE
    basis_gewuenscht = basis
    basis = _basis_pruefen(pts, basis)
    if basis != basis_gewuenscht:
        hinweise.append("ohne Zeitstempel: über die Strecke gerechnet")
    r = _sauber(rate, 1.0)
    if r <= 0:
        r = 1.0
        hinweise.append("Raffung war 0 oder negativ — auf 1 gesetzt")

    # ── 1. Kosten je Abschnitt in Videosekunden ────────────────────────────
    if basis == BASIS_PUNKTE:
        kosten = [1.0 / r] * (n - 1)
    else:
        achse = "time" if basis == BASIS_ZEIT else "dist"
        w = achsenwerte(list(pts), achse, pausen, pause_ab_s, pause_auf_s)
        if w[-1] - w[0] <= 0:
            hinweise.append("Achse ohne Spanne — gleichmäßig über die Punkte")
            kosten = [1.0 / max(1e-9, r)] * (n - 1)
        else:
            teiler = r if basis == BASIS_ZEIT else (r * 1000.0)
            kosten = [max(0.0, (w[i + 1] - w[i]) / max(1e-9, teiler)) for i in range(n - 1)]

    # ── 2. Tempo-Abschnitte: Kosten strecken ───────────────────────────────
    eintraege = [e for e in (eintraege or []) if isinstance(e, dict)]
    for e in eintraege:
        if str(e.get("art")) != "tempo":
            continue
        f = _sauber(e.get("faktor"), 1.0)
        if f <= 0:
            hinweise.append("Tempo-Faktor 0 übersprungen")
            continue
        von = max(0.0, min(1.0, _sauber(e.get("von"), 0.0)))
        bis = max(0.0, min(1.0, _sauber(e.get("bis"), 0.0)))
        if bis < von:
            von, bis = bis, von
        i0 = int(round(von * (n - 1)))
        i1 = int(round(bis * (n - 1)))
        for i in range(i0, min(i1, n - 1)):
            kosten[i] /= f

    # ── 3. Halte: Zeit an einer Stelle einfügen ────────────────────────────
    halte = []
    for e in eintraege:
        if str(e.get("art")) != "halt":
            continue
        sek = max(0.0, _sauber(e.get("sek"), 0.0))
        if sek <= 0:
            continue
        bei = max(0.0, min(1.0, _sauber(e.get("bei"), 0.0)))
        halte.append({"bei": bei, "sek": sek, "kamera": str(e.get("kamera") or "kino"),
                      "idx": int(round(bei * (n - 1)))})
    halte.sort(key=lambda h: h["bei"])

    sek_strecke = sum(kosten)
    sek_halte = sum(h["sek"] for h in halte)
    dauer = sek_strecke + sek_halte
    if dauer <= 0:
        return {"dauer_s": 0.0, "anteile": [0.0], "sek_strecke": 0.0, "sek_halte": 0.0,
                "halte": halte, "hinweise": hinweise + ["Dauer 0"], "basis": basis, "rate": r}

    # ── 4. Stützpunkte (Videosekunde, Stelle auf der Strecke) ─────────────
    #    Ein Halt ist ein PLATEAU: zwei Stützpunkte mit derselben Stelle und
    #    unterschiedlicher Zeit. Ohne dieses Plateau würde die Abtastung quer
    #    durch den Halt interpolieren und die Strecke liefe langsam weiter —
    #    im ersten Lauf genau so gemessen (0,4915 statt 0,4988).
    zs: list[float] = []
    fs: list[float] = []
    t = 0.0
    h_pos = 0
    for i in range(n):
        anteil = i / (n - 1)
        while h_pos < len(halte) and halte[h_pos]["idx"] == i:
            zs.append(t); fs.append(anteil)          # Halt beginnt
            halte[h_pos]["ab_s"] = t
            t += halte[h_pos]["sek"]
            halte[h_pos]["bis_s"] = t
            zs.append(t); fs.append(anteil)          # Halt endet, Stelle unverändert
            h_pos += 1
        zs.append(t); fs.append(anteil)
        if i < n - 1:
            t += kosten[i]
    while h_pos < len(halte):                        # Halt am Ende der Strecke
        halte[h_pos]["ab_s"] = t
        t += halte[h_pos]["sek"]
        halte[h_pos]["bis_s"] = t
        zs.append(t); fs.append(1.0)
        h_pos += 1
    dauer = t

    # ── 5. Tabelle je Bild ─────────────────────────────────────────────────
    bilder = max(2, min(int(max_bilder), int(round(dauer * max(1, int(fps)))) + 1))
    if bilder >= max_bilder:
        hinweise.append(f"Deckel: {max_bilder} Bilder")
    anteile = []
    j = 0
    for k in range(bilder):
        ziel = dauer * (k / (bilder - 1))
        while j < len(zs) - 2 and zs[j + 1] <= ziel:
            j += 1
        d = zs[j + 1] - zs[j]
        f = 0.0 if d <= 0 else max(0.0, min(1.0, (ziel - zs[j]) / d))
        anteile.append(min(1.0, fs[j] + (fs[j + 1] - fs[j]) * f))
    # Doppelte Punkte am Anfang oder Ende (gleiche Koordinate zweimal) ließen den
    # ersten Wert bei 0,001 landen — 08.09.2026 an „66 Seen Tag 8" gesehen.
    anteile[0] = 0.0
    anteile[-1] = 1.0

    return {"dauer_s": dauer, "anteile": anteile, "sek_strecke": sek_strecke,
            "sek_halte": sek_halte, "halte": halte, "hinweise": hinweise,
            "basis": basis, "rate": r, "bilder": bilder}
