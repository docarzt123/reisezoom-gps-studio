"""Der Zeitplan eines Projekts: Gruppen, Halte, Inhalte — die EINE Wahrheit.

Modell und Begründung stehen in `docs/IDEAS.md` §60 (Marc, 09.09.2026). Kurz:

  * **Alle Tracks eines Projekts sind gleich lang** — so lang wie das Video.
    Ein Track ist *Halt + Inhalt + Halt*; die ganze Anordnung steckt darin, wo
    seine Halte sitzen. „Nacheinander" heißt: Gruppe 2 hat vorne einen langen
    Halt. „Gleichzeitig" heißt: keine hat einen. Startversatz und Blocklänge
    gibt es als eigene Begriffe nicht mehr.
  * **Alles ist eine Gruppe**, auch eine einzelne Tour — auf der Leiste gibt es
    nur EINEN Typ. Ihr gehört alles Zeitliche (Faktor, Halte, Keyframes,
    Kamera-Rolle); frei je Mitglied bleiben Farbe, Laufpunkt und der eigene
    vordere Halt.
  * **Der Faktor ist die gespeicherte Zahl, die Länge das Ergebnis.** 0,5×
    heißt halb so schnell und braucht darum doppelt so viel Videozeit.
  * **Die Projektlänge ist das Maximum** über alle Gruppen; kürzere werden
    hinten aufgefüllt.

Dieses Modul rechnet nur — es kennt weder GPX noch Oberfläche. Wie lang der
Inhalt einer Gruppe bei Faktor 1 wäre, sagt ihm der Aufrufer (aus
`core/tempo.py`). Dadurch ist der ganze Zeitplan in Millisekunden prüfbar.

Zeiten sind ANIMATIONSZEIT: 0 = Ende des Anlaufs (`intro_s`). Anlauf und
Nachlauf des Projekts liegen davor und dahinter und gehören allen Gruppen —
so bleibt die Leiste mit `introFraction`/`trackFraction` unverändert.

Das wortgleiche Gegenstück für die Oberfläche ist `ui/js/spuren.js`; dass beide
dasselbe rechnen, misst `tests/test_spuren_js_vs_py.py` an zufälligen Fällen.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional

# Untergrenze für den Inhalt einer Gruppe. Feste Dauern gehen vom Budget ab und
# drückten die übrigen sonst auf null — dreizehn Etappen standen in der Liste
# und kamen im Video nicht vor (08.09.2026 auf Marcs Rechner gemessen).
MIN_INHALT_S = 0.3


@dataclass
class Mitglied:
    """Eine Tour in einer Gruppe. Zeitlich folgt sie der Gruppe; eigen sind ihr
    nur der vordere Halt und das Optische."""
    gpx_path: str
    name: str = ""
    farbe: str = ""
    vorlauf_s: float = 0.0          # eigener Vorlauf INNERHALB der Gruppe
    sichtbar_vor_inhalt: bool = False   # im Füll-Halt vor dem Inhalt zeigen?


@dataclass
class Gruppe:
    """Eine Zeile auf der Leiste. Auch eine einzelne Tour ist eine Gruppe."""
    id: str
    name: str = ""
    mitglieder: List[Mitglied] = field(default_factory=list)
    faktor: float = 1.0             # gegen die Grundraffung
    vorlauf_s: float = 0.0          # Halt VOR dem Inhalt
    eintraege: List[dict] = field(default_factory=list)   # Halte/Abschnitte
    keyframes: List[dict] = field(default_factory=list)
    leit_gpx: str = ""              # Leit-Tour (Kamera); leer = alle Mitglieder ins Bild
    ueber_stil: str = "kino"        # Stil des Übergangs, der IN diese Gruppe führt
    ueber_s: Optional[float] = None  # Regel für die Kette: Lücke davor (None = gemeinsame Flugdauer)
    zu: bool = True                 # Zeile zugeklappt?
    fest: bool = False              # von Hand gelegt — die Kette schiebt sie nicht mehr
    # 09.09.2026 (Marc: „hoch, runter, über einer Spur bleiben → der Track
    # rutscht in diese Spur; weiter hoch/runter → eigene Spur"): eine gewünschte
    # Zeile, 1-basiert; 0 = wie bisher die erste freie. Nur für `fest` sinnvoll.
    zeile: int = 0

    @property
    def takt_gpx(self) -> str:
        """Die Tour, aus der die Zeit der Gruppe kommt: IMMER das erste Mitglied.
        `leit_gpx` führt nur die Kamera — beim Schwarm war das die Fokus-Tour,
        gelaufen ist die Vorschau trotzdem am Haupt-Track."""
        return self.mitglieder[0].gpx_path if self.mitglieder else ""


@dataclass
class Lage:
    """Wo eine Gruppe auf der Videozeit liegt. Alles in Sekunden."""
    id: str
    vorlauf_s: float
    inhalt_s: float
    nachlauf_s: float
    zeile: int = 0                  # gewünschte Zeile (0 = automatisch)

    @property
    def von_s(self) -> float:
        return self.vorlauf_s

    @property
    def bis_s(self) -> float:
        return self.vorlauf_s + self.inhalt_s

    @property
    def gesamt_s(self) -> float:
        return self.vorlauf_s + self.inhalt_s + self.nachlauf_s


@dataclass
class Plan:
    dauer_s: float
    lagen: List[Lage]
    hinweise: List[str] = field(default_factory=list)

    def lage(self, gid: str) -> Optional[Lage]:
        for l in self.lagen:
            if l.id == gid:
                return l
        return None


def _sauber(v, vorgabe: float = 0.0) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return vorgabe
    return f if f == f and f not in (float("inf"), float("-inf")) else vorgabe


def inhalt_dauer(gruppe: Gruppe, roh_s: float) -> float:
    """Wie lang der Inhalt einer Gruppe im Video ist.

    `roh_s` ist seine Länge bei Faktor 1 (aus der Tempo-Kurve). 0,5× heißt halb
    so schnell und braucht damit die doppelte Videozeit — deshalb geteilt.
    """
    f = _sauber(gruppe.faktor, 1.0)
    if f <= 0:
        f = 1.0
    return max(MIN_INHALT_S, _sauber(roh_s, 0.0) / f)


def zeitplan(gruppen: List[Gruppe], roh_s: Dict[str, float],
             mindest_s: float = 0.0) -> Plan:
    """Den Zeitplan rechnen: wo jede Gruppe liegt und wie lang das Video wird.

    Die Projektlänge ist das MAXIMUM über alle Gruppen (Vorlauf + Inhalt); was
    kürzer ist, wird hinten aufgefüllt, damit alle gleich lang sind. `mindest_s`
    (der Wunsch aus dem Feld „Animation (s)") kann das Video verlängern,
    niemals verkürzen — sonst fiele hinten etwas ab.
    """
    hinweise: List[str] = []
    roh_teil: List[Lage] = []
    for g in gruppen:
        vor = max(0.0, _sauber(g.vorlauf_s, 0.0))
        inh = inhalt_dauer(g, roh_s.get(g.id, 0.0))
        roh_teil.append(Lage(id=g.id, vorlauf_s=vor, inhalt_s=inh, nachlauf_s=0.0,
                             zeile=max(0, int(_sauber(getattr(g, "zeile", 0), 0)))))

    dauer = max([l.bis_s for l in roh_teil], default=0.0)
    if mindest_s > dauer + 1e-9:
        dauer = float(mindest_s)
    if dauer <= 0:
        return Plan(dauer_s=0.0, lagen=[], hinweise=["keine Gruppen"])

    for l in roh_teil:
        l.nachlauf_s = max(0.0, dauer - l.bis_s)
    # Die Regel, an der alles hängt: jede Gruppe ist so lang wie das Video.
    for l in roh_teil:
        if abs(l.gesamt_s - dauer) > 1e-6:
            hinweise.append(f"{l.id}: {l.gesamt_s:.3f} s statt {dauer:.3f} s")
    return Plan(dauer_s=dauer, lagen=roh_teil, hinweise=hinweise)


def kamera_gruppe(gruppen: List[Gruppe]) -> Optional[Gruppe]:
    """Wer die Kamera führt: die OBERSTE Gruppe (Marc: „oben steuert alles")."""
    return gruppen[0] if gruppen else None


def ueberlappt(a: Lage, b: Lage) -> bool:
    """Überlappen sich zwei INHALTE? (Die Halte zählen nicht — sonst überlappt
    ab sofort alles mit allem und jede Zeile klappt auf.)"""
    return a.von_s < b.bis_s - 1e-9 and b.von_s < a.bis_s - 1e-9


def zeilen(plan: Plan) -> List[List[str]]:
    """Welche Gruppen sich eine Zeile teilen — in der Reihenfolge der Liste.

    Erst die Gruppen mit GEWÜNSCHTER Zeile (`zeile` ≥ 1, aus dem Ziehen in eine
    Spur): sie kommen in diese Zeile, und wenn dort schon etwas überlappt, in
    die nächste freie darunter. Dann die übrigen: jede in die erste Zeile, in
    der ihr Inhalt frei liegt. Leere Zeilen fallen weg — die Nummern der
    Oberfläche sind die Nummern der vollen Zeilen."""
    raus: List[List[Lage]] = []

    def frei(z: int, l: Lage) -> bool:
        return z >= len(raus) or not any(ueberlappt(l, x) for x in raus[z])

    def rein(z: int, l: Lage) -> None:
        while len(raus) <= z:
            raus.append([])
        raus[z].append(l)

    for l in plan.lagen:
        if l.zeile >= 1:
            z = l.zeile
            while not frei(z, l):
                z += 1
            rein(z, l)
    for l in plan.lagen:
        if l.zeile >= 1:
            continue
        z = 0
        while not frei(z, l):
            z += 1
        rein(z, l)
    return [[l.id for l in zeile] for zeile in raus if zeile]


# ── Umrechnung bestehender Projekte (§60, Punkt 11) ────────────────────────
# Beide heutigen Abläufe sind Sonderfälle des Modells:
#   „reise"   → je Tour eine Gruppe, der Vorlauf wächst um die vorherigen
#               Inhalte und die Übergänge dazwischen.
#   „schwarm" → EINE Gruppe mit allen Touren als Mitglieder; der Startversatz
#               je Tour wird ihr Vorlauf innerhalb der Gruppe.
# Gerechnet wird im Speicher; geschrieben erst, wenn der Nutzer etwas ändert —
# ein altes Projekt bleibt bit-genau, solange man es nur ansieht.

def aus_projekt(animator: dict, roh_s: Dict[str, float],
                groesse: Optional[Dict[str, float]] = None) -> List[Gruppe]:
    """Aus den heutigen Projekt-Feldern die Gruppen bauen.

    `roh_s`  : je GPX-Pfad die Inhaltslänge bei Faktor 1 (aus core/tempo.py).
    `groesse`: je GPX-Pfad das Maß für die anteilige Verteilung (heute die
               Punktzahl `n_raw`); ohne Angabe zählt die Inhaltslänge.
    """
    a = animator or {}
    haupt = str(a.get("haupt_gpx") or "")
    extra = list(a.get("extra_tours") or [])
    pfade = ([haupt] if haupt else []) + [str(t.get("gpx_path") or "") for t in extra]
    pfade = [p for p in pfade if p]
    if not pfade:
        return []
    namen = [str(a.get("etappe1_name") or "")] + [str(t.get("name") or "") for t in extra]
    farben = [str(a.get("line_color") or "")] + [str(t.get("line_color") or "") for t in extra]

    if str(a.get("tours_ablauf") or "reise") == "schwarm":
        g = Gruppe(id="g1", name=namen[0] or "", vorlauf_s=0.0,
                   leit_gpx=str(a.get("schwarm_fokus_gpx") or a.get("tours_fokus") or ""))
        # Der eigene Startversatz je Tour wird ihr Vorlauf IN der Gruppe — auch
        # der des Haupt-Tracks (`tours_haupt_start_s`).
        g.mitglieder = [
            Mitglied(gpx_path=p, name=n, farbe=f,
                     vorlauf_s=max(0.0, _sauber((extra[i - 1] if i else {}).get("start_s")
                                                if i else a.get("tours_haupt_start_s"), 0.0)))
            for i, (p, n, f) in enumerate(zip(pfade, namen, farben))]
        return [g]

    # ── Nacheinander: dieselbe Zeitregel wie `_reise_segmente` ────────────
    fest = [max(0.0, _sauber(a.get("etappe1_dauer_s"), 0.0))] \
        + [max(0.0, _sauber(t.get("dauer_s"), 0.0)) for t in extra]
    budget = max(0.0, _sauber(a.get("duration_s"), 12.0))
    rest = max(0.0, budget - sum(fest))
    offen = [i for i, f in enumerate(fest) if not f]
    mass = groesse or roh_s
    offen_summe = sum(max(1e-9, _sauber(mass.get(pfade[i]), 1.0)) for i in offen) or 1.0
    laengen = []
    for i, p in enumerate(pfade):
        if fest[i]:
            laengen.append(fest[i])
        else:
            anteil = max(1e-9, _sauber(mass.get(p), 1.0)) / offen_summe
            laengen.append(max(MIN_INHALT_S, rest * anteil))

    flug_s = _sauber(a.get("fly_duration_s"), 3.0)
    gruppen: List[Gruppe] = []
    pos = 0.0
    for i, p in enumerate(pfade):
        eigen_s: Optional[float] = None
        if i > 0:
            stil = str((extra[i - 1] or {}).get("ueber_stil") or "kino")
            eigen = (extra[i - 1] or {}).get("ueber_s")
            eigen_s = None if eigen in (None, "") else max(0.0, _sauber(eigen, 0.0))
            ueber = 0.0 if stil == "schnitt" else (flug_s if eigen_s is None else eigen_s)
            pos += ueber
        else:
            stil = "kino"
        roh = max(1e-6, _sauber(roh_s.get(p), laengen[i]))
        g = Gruppe(id=f"g{i + 1}", name=namen[i] or "", vorlauf_s=pos,
                   faktor=roh / max(MIN_INHALT_S, laengen[i]), ueber_stil=stil,
                   ueber_s=eigen_s)
        g.mitglieder = [Mitglied(gpx_path=p, name=namen[i], farbe=farben[i])]
        gruppen.append(g)
        pos += laengen[i]
    return gruppen
