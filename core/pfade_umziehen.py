"""Foto-Pfade umbiegen, wenn das Laufwerk anders eingehängt ist (05.10.2026).

Marc (04.10.2026): „Wenn ich die Bilder auf dem MacBook indiziere — könnte man die Bibliothek dann auf den Mac mini
übertragen?" Der Bestand speichert volle Pfade. Hängt dasselbe NAS auf dem anderen Rechner unter anderem Namen
(`/Volumes/Fotos` ↔ `/Volumes/Fotos-1`, Windows `Z:\\` ↔ `Y:\\`), passt nichts mehr — Index, Ordnerbaum, Fotostopps.

  kandidaten(conn)            — fehlende Foto-Ordner, für die dieselben Dateien unter einem anderen Einhängepunkt
                                liegen (Stichprobe ≥ 80 % gefunden) → [{alt, neu, treffer, stichprobe, n_fotos}]
  umbiegen(conn, alt, neu, idx=None) — alle Pfade mit Präfix `alt` auf `neu` (Bestand + Inhaltsindex), eine Transaktion
                                je Datenbank; Pfade, die es unter `neu` schon gibt, bleiben unangetastet (gezählt).

Rein über sqlite3-Verbindungen und Dateisystem-Abfragen (austauschbar für Tests). Die Sicherung der Bibliothek davor
macht der Aufrufer (app.py).
"""
from __future__ import annotations

import os
import random
import re
import string
from typing import Callable, Iterable, List, Optional

STICHPROBE = 12
MIN_ANTEIL = 0.8

_TABELLEN = (                      # (Tabelle, Spalten mit Pfaden) im Bestand (library.db)
    ("fotos", ("path", "ordner")),
    ("foto_ordner", ("path",)),
    ("foto_verz", ("path",)),
    ("foto_laufwerk", ("wurzel",)),
)


def _tabelle_da(conn, name: str) -> bool:
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone() is not None


def _wurzel_und_rest(pfad: str):
    """('/Volumes/Fotos', 'Bilder/2026') bzw. ('Z:\\', 'Bilder\\2026'); None, wenn kein Laufwerk erkennbar."""
    m = re.match(r"^(/Volumes/[^/]+)(?:/(.*))?$", pfad)
    if m:
        return m.group(1), m.group(2) or ""
    m = re.match(r"^([A-Za-z]:\\)(.*)$", pfad)
    if m:
        return m.group(1), m.group(2)
    return None


def _andere_wurzeln(wurzel: str, volumes: Optional[Iterable[str]] = None) -> List[str]:
    if wurzel.startswith("/Volumes/"):
        alle = list(volumes) if volumes is not None else (
            ["/Volumes/" + n for n in sorted(os.listdir("/Volumes"))] if os.path.isdir("/Volumes") else [])
        name = wurzel[len("/Volumes/"):]
        basis = re.sub(r"(?:-| )\d+$", "", name)
        # ähnliche Namen zuerst (Fotos-1, Fotos 2 …), danach alle anderen
        aehnlich = [v for v in alle if v != wurzel and re.sub(r"(?:-| )\d+$", "", v[len("/Volumes/"):]) == basis]
        return aehnlich + [v for v in alle if v != wurzel and v not in aehnlich]
    if re.match(r"^[A-Za-z]:\\$", wurzel):
        alle = list(volumes) if volumes is not None else [f"{b}:\\" for b in string.ascii_uppercase]
        return [v for v in alle if v.upper() != wurzel.upper()]
    return []


def kandidaten(conn, existiert: Callable[[str], bool] = os.path.exists,
               volumes: Optional[Iterable[str]] = None, zufall: Optional[random.Random] = None) -> list:
    """Fehlende Foto-Ordner mit einem gefundenen neuen Ort. Je fehlender Laufwerkswurzel höchstens ein Vorschlag."""
    if not _tabelle_da(conn, "foto_ordner") or not _tabelle_da(conn, "fotos"):
        return []
    rnd = zufall or random.Random(82)
    raus, gesehen = [], set()
    for (ordner,) in conn.execute("SELECT path FROM foto_ordner ORDER BY path").fetchall():
        if not ordner or existiert(ordner):
            continue
        wr = _wurzel_und_rest(ordner)
        if not wr or wr[0] in gesehen:
            continue
        wurzel = wr[0]
        gesehen.add(wurzel)
        if existiert(wurzel):           # Laufwerk ist da, nur der Ordner fehlt → kein Umhängen
            continue
        bed, arg = _unter("path", wurzel)
        pfade = [r[0] for r in conn.execute(f"SELECT path FROM fotos WHERE {bed} LIMIT 2000", arg).fetchall()]
        if not pfade:
            continue
        probe = rnd.sample(pfade, min(STICHPROBE, len(pfade)))
        for neu in _andere_wurzeln(wurzel, volumes):
            treffer = sum(1 for p in probe if existiert(neu + p[len(wurzel):]))
            if treffer / len(probe) >= MIN_ANTEIL:
                n = conn.execute(f"SELECT COUNT(*) FROM fotos WHERE {bed}", arg).fetchone()[0]
                raus.append({"alt": wurzel, "neu": neu, "treffer": treffer, "stichprobe": len(probe), "n_fotos": n})
                break
    return raus


def _unter(sp: str, alt: str):
    """SQL-Bedingung „Pfad in Spalte `sp` liegt unter alt" als ganzer Pfadteil: genau alt, oder danach ein Trenner,
    oder alt endet selbst auf einem Trenner (Windows-Wurzel „Z:\") — „/Volumes/Fotos" trifft nicht „/Volumes/Fotos-1/…"."""
    l = len(alt)
    bed = (f"(substr({sp}, 1, ?) = ? AND (length({sp}) = ? OR substr({sp}, ?, 1) IN ('/', '\\')"
           f" OR substr(?, ?, 1) IN ('/', '\\')))")
    return bed, (l, alt, l, l + 1, alt, l)


def _umbiegen_db(conn, tabellen, alt: str, neu: str) -> dict:
    """Präfix alt → neu in allen genannten Spalten; Primärschlüssel-Kollisionen bleiben stehen (OR IGNORE)."""
    l = len(alt)
    geaendert, uebrig = 0, 0
    with conn:
        for tab, spalten in tabellen:
            if not _tabelle_da(conn, tab):
                continue
            for sp in spalten:
                bed, arg = _unter(sp, alt)
                cur = conn.execute(f"UPDATE OR IGNORE {tab} SET {sp} = ? || substr({sp}, ?) WHERE {bed}", (neu, l + 1) + arg)
                geaendert += max(0, cur.rowcount or 0)
                uebrig += conn.execute(f"SELECT COUNT(*) FROM {tab} WHERE {bed}", arg).fetchone()[0]
    return {"geaendert": geaendert, "uebrig": uebrig}


def umbiegen(conn, alt: str, neu: str, idx=None) -> dict:
    """Bestand (und optional Inhaltsindex) umhängen. Gibt die Zahlen je Datenbank zurück."""
    alt, neu = str(alt), str(neu)
    if not re.match(r"^[A-Za-z]:\\$", alt):            # „Z:\" bleibt, sonst ohne Trenner am Ende
        alt, neu = alt.rstrip("/\\"), neu.rstrip("/\\")
    r = {"bestand": _umbiegen_db(conn, _TABELLEN, alt, neu)}
    if idx is not None:
        r["index"] = _umbiegen_db(idx, (("vek", ("path",)),), alt, neu)
    return r
