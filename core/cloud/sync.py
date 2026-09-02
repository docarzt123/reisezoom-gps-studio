"""Der Abgleich: was muss hoch, was muss runter (seit 15.08.2026).

Entwurf: `docs/IDEAS.md` §26.

## Wie erkannt wird, was zu tun ist

Der Server führt ein Verzeichnis mit einer **Prüfsumme je Umschlag**. Die App
rechnet dieselben Prüfsummen lokal aus. Was sich unterscheidet, muss übertragen
werden — und zwar **eine** Anfrage für die ganze Liste, nicht eine je Tour.

⚠️ Die Prüfsumme geht über den **Klartext**, nie über den Umschlag. Ein Umschlag
ist bei jedem Verschließen anders (neues Nonce); über ihn gerechnet wäre jede
Tour immer „geändert", und die App lüde ewig alles neu hoch. Siehe
`crypto.inhalts_pruefsumme`.

⚠️ Auch der Umschlag selbst muss aus gleichen Daten gleich entstehen — deshalb
feste Zeitstempel im ZIP (`archiv.umschlag_bauen`). Ohne das wäre die
Prüfsumme jedes Mal neu, obwohl sich nichts geändert hat.

## Was dieses Modul NICHT tut

Es entscheidet nicht, WANN abgeglichen wird. Das gehört in die App (nach einer
Änderung gebündelt, beim Start einmal holen). Hier steht nur, WAS zu tun ist und
wie es getan wird — damit es sich ohne laufende App prüfen lässt.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from . import crypto, transport

# Wie viele Fehler ein Durchlauf verträgt, bevor er aufgibt. Ein einzelner
# hakeliger Umschlag darf den Rest nicht blockieren; hundert Fehler bedeuten
# dagegen, dass etwas Grundsätzliches nicht stimmt.
FEHLER_GRENZE = 25


@dataclass
class Plan:
    """Was zu tun ist — erst rechnen, dann übertragen."""
    hoch: list[str] = field(default_factory=list)       # logische Namen
    runter: list[str] = field(default_factory=list)
    weg: list[str] = field(default_factory=list)        # auf dem Server löschen
    unveraendert: int = 0

    @property
    def leer(self) -> bool:
        return not (self.hoch or self.runter or self.weg)

    def __str__(self) -> str:
        if self.leer:
            return f"nichts zu tun ({self.unveraendert} unverändert)"
        # ⚠️ `weg` wird NICHT mehr automatisch gelöscht (22.08.2026, Audit):
        # „lokal unbekannt" heißt im Zwei-Geräte-Betrieb meist „vom anderen
        # Rechner" — ein Auto-Löscher hätte die Geräte gegeneinander
        # ausgespielt und jede Papierkorb-Wiederherstellung sofort wieder
        # kassiert. Die Zahl bleibt sichtbar: „nur in der Cloud".
        return (f"{len(self.hoch)} hoch, {len(self.runter)} runter, "
                f"{len(self.weg)} nur in der Cloud, {self.unveraendert} unverändert")


@dataclass
class Ergebnis:
    uebertragen: int = 0
    bytes_hoch: int = 0
    fehler: list[str] = field(default_factory=list)


class Abgleich:
    """Ein Archiv gegen eine Gegenstelle abgleichen."""

    def __init__(self, gegenstelle: transport.Gegenstelle, datenschluessel: bytes):
        self.g = gegenstelle
        self.schluessel = datenschluessel

    # ── planen ───────────────────────────────────────────────────────────

    def planen(self, bestand: dict) -> Plan:
        """Vergleicht lokalen Bestand mit dem, was oben liegt.

        02.09.2026: `bestand` ist jetzt schlicht `{logischer Name: Prüfsumme}`.
        Vorher kannte diese Ebene die Bauteile des Archivs einzeln (Verzeichnis,
        Sammlungen, Touren, Mengen, Ketten, Fassungen) — bei jeder neuen Sorte
        musste sie mitwachsen. Was hochgehört, entscheidet jetzt allein
        `core/cloud/bibliothek.py`; hier wird nur noch verglichen.
        """
        oben = self.g.liste()
        plan = Plan()
        for logisch, pruef_lokal in bestand.items():
            eintrag = oben.get(transport.server_name(logisch))
            if eintrag is None or not crypto.gleich(eintrag.pruef, pruef_lokal):
                plan.hoch.append(logisch)
            else:
                plan.unveraendert += 1

        # ⚠️ Was oben liegt und lokal nicht mehr existiert, ist gelöscht —
        # aber NUR, wenn wir lokal überhaupt etwas kennen. Bei leerem lokalem
        # Bestand (frisch eingerichtetes Gerät) wäre das sonst der Befehl, das
        # ganze Archiv zu löschen. Gelöscht wird ohnehin nichts automatisch
        # (siehe Plan.__str__) — die Zahl ist nur eine Auskunft.
        if bestand:
            bekannt = {transport.server_name(n) for n in bestand}
            plan.weg = [sname for sname in oben if sname not in bekannt]
        return plan

    # ── übertragen ───────────────────────────────────────────────────────

    def hochladen(self, plan: Plan, inhalt_holen: Callable[[str], bytes],
                  fortschritt: Callable[[int, int, str], None] | None = None) -> Ergebnis:
        """Alles aus `plan.hoch` übertragen.

        `inhalt_holen(logischer_name)` liefert den KLARTEXT. Das Verschließen
        passiert hier, damit kein Aufrufer versehentlich Klartext hochlädt.
        """
        e = Ergebnis()
        gesamt = len(plan.hoch)
        for i, name in enumerate(plan.hoch, 1):
            try:
                klartext = inhalt_holen(name)
                umschlag = crypto.verschliessen(self.schluessel, name, klartext)
                self.g.legen(name, umschlag, crypto.inhalts_pruefsumme(klartext))
                e.uebertragen += 1
                e.bytes_hoch += len(umschlag)
            except Exception as fehler:      # noqa: BLE001
                e.fehler.append(f"{name}: {fehler}")
                if len(e.fehler) >= FEHLER_GRENZE:
                    e.fehler.append(
                        f"Nach {FEHLER_GRENZE} Fehlern abgebrochen — "
                        "hier stimmt etwas Grundsätzliches nicht.")
                    break
            if fortschritt:
                fortschritt(i, gesamt, name)
        return e

    def loeschen(self, plan: Plan) -> int:
        """Umschläge entfernen, die es lokal nicht mehr gibt.

        ⚠️ Seit 22.08.2026 ruft KEIN Abgleich das mehr automatisch auf (siehe
        Plan.__str__). Bleibt für eine künftige, bewusste Nutzer-Aktion
        („Aufräumen: N Touren nur in der Cloud entfernen")."""
        weg = 0
        for sname in plan.weg:
            try:
                # Der Server kennt nur Hash-Namen; wir haben hier auch nur den.
                self.g._anfragen("loeschen", methode="POST", name=sname)
                weg += 1
            except Exception:                # noqa: BLE001
                pass
        return weg

    # ── holen ────────────────────────────────────────────────────────────

    def holen(self, logischer_name: str) -> bytes:
        """Einen Umschlag holen und öffnen — gibt den Klartext zurück."""
        return crypto.oeffnen(self.schluessel, logischer_name,
                              self.g.holen(logischer_name))
