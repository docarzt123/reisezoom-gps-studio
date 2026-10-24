#!/usr/bin/env python3
"""Logbuch-Modell aus geteilten Korrekturen trainieren (24.10.2026, core/lernen.py).

    logbuch_lernen.py                 → Bericht: Beispiele je Art, Trefferquote auf zurückgehaltenen Beispielen
    logbuch_lernen.py --veroeffentlichen  → … und nur wenn die Hürden genommen sind: modell.json auf data.reisezoom.com

Quelle: alle *.jsonl aus /_lernen_daten (scripts/lernen_server.py holen), ohne Testsendungen (App „0.0.0“). Jede
Zeile ist eine Korrektur — die Regeln lagen dort also falsch; verglichen wird deshalb nicht mit den Regeln, sondern ob
das Modell auf Beispielen, die es nicht gesehen hat, richtig liegt, WENN es sicher ist (p ≥ SCHWELLE).

Hürden (HUERDEN): genug Beispiele, genug Arten, Trefferquote der sicheren Antworten, und es muss überhaupt oft genug
sicher sein — sonst bleibt das alte Modell (oder keins) stehen.
"""
from __future__ import annotations

import json
import random
import sys
import time
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO)); sys.path.insert(0, str(REPO / "scripts"))
from core import lernen as L  # noqa: E402

HUERDEN = {"beispiele": 200, "arten": 3, "je_art": 20, "treffer": 0.90, "abdeckung": 0.30}
ARBEIT = Path("/Volumes/MacMini 2TB Acasis/_tmp/claude/lernen")


def laden(ordner: Path) -> list:
    raus = []
    for p in sorted(ordner.glob("*.jsonl")):
        for zeile in p.read_text().splitlines():
            try:
                d = json.loads(zeile)
            except ValueError:
                continue
            if d.get("f") != L.FORMAT or d.get("app") == "0.0.0" or not L.art_ziel(d.get("art")):
                continue
            raus.append({"art": L.art_ziel(d["art"]), "merkmale": d.get("m") or {}})
    return raus


def bewerten(train: list, test: list) -> dict:
    m = L.trainieren(train)
    if not m:
        return {"modell": None}
    sicher = richtig = 0
    for b in test:
        art, p = L.vorhersagen(m, b["merkmale"])
        if p >= L.SCHWELLE:
            sicher += 1
            richtig += int(art == b["art"])
    return {"modell": m, "test": len(test), "sicher": sicher, "richtig": richtig,
            "treffer": (richtig / sicher) if sicher else 0.0, "abdeckung": (sicher / len(test)) if test else 0.0}


def main() -> int:
    import lernen_server as S
    ziel = ARBEIT / time.strftime("%Y%m%d-%H%M")
    S.holen(ziel)
    bs = laden(ziel)
    je = Counter(b["art"] for b in bs)
    print(f"{len(bs)} Beispiele: {dict(je)}")
    genug = [a for a, n in je.items() if n >= HUERDEN["je_art"]]
    if len(bs) < HUERDEN["beispiele"] or len(genug) < HUERDEN["arten"]:
        print(f"Noch zu wenig zum Lernen (Hürde: {HUERDEN['beispiele']} Beispiele, {HUERDEN['arten']} Arten mit je "
              f"{HUERDEN['je_art']}). Kein Modell.")
        return 0
    random.seed(7)
    random.shuffle(bs)
    test = [b for i, b in enumerate(bs) if i % 5 == 0]
    train = [b for i, b in enumerate(bs) if i % 5 != 0]
    r = bewerten(train, test)
    print(f"zurückgehalten {r['test']}: sicher {r['sicher']} ({r['abdeckung']:.0%}), davon richtig {r['richtig']} ({r['treffer']:.0%})")
    ok = r["treffer"] >= HUERDEN["treffer"] and r["abdeckung"] >= HUERDEN["abdeckung"]
    if not ok:
        print("Hürde nicht genommen — kein neues Modell.")
        return 0
    voll = L.trainieren(bs)                      # fürs Veröffentlichen mit allen Beispielen
    voll["pruefung"] = {k: r[k] for k in ("test", "sicher", "richtig")}
    datei = ziel / "modell.json"
    datei.write_text(json.dumps(voll))
    print("Modell:", datei)
    if "--veroeffentlichen" in sys.argv:
        S.modell_veroeffentlichen(datei)
    return 0


if __name__ == "__main__":
    sys.exit(main())
