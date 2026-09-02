#!/usr/bin/env python3
"""Changelog → RSS-Feed (Marc-Wunsch, Content-Plan TODO 5, 01.09.2026).

Warum: Der Changelog liegt längst als HTML unter fester URL. Ein Feed daneben
kostet fast nichts, hat keine DSGVO-Folgen und keine Supportlast — und erreicht
genau die technische Zielgruppe, die GPS Studio benutzt. Wer den Feed abonniert,
erfährt von neuen Versionen, ohne dass wir eine Mail-Liste betreiben müssten.

Quelle ist `docs/CHANGELOG.html` (die deutsche Nutzer-Fassung): jeder
`<article class="version …">` wird ein Eintrag, Titel = Versionsnummer +
Tagline, Beschreibung = die Highlight-Absätze als Klartext.

Aufruf:  ./.venv/bin/python scripts/make_changelog_feed.py [ziel.xml]
Ausgabe: docs/changelog.xml  (wird von scripts/deploy_release.sh mit hochgeladen)
"""
from __future__ import annotations

import html
import re
import sys
from datetime import datetime, timezone
from email.utils import format_datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
QUELLE = ROOT / "docs" / "CHANGELOG.html"
ZIEL = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "docs" / "changelog.xml"
BASIS = "https://reisezoom.com/downloads/gps-studio/latest/changelog.html"

MONATE = {"januar": 1, "februar": 2, "märz": 3, "april": 4, "mai": 5, "juni": 6,
          "juli": 7, "august": 8, "september": 9, "oktober": 10,
          "november": 11, "dezember": 12}


def _text(roh: str) -> str:
    """HTML-Schnipsel → Klartext (Tags raus, Entities auf)."""
    ohne = re.sub(r"<[^>]+>", " ", roh)
    return re.sub(r"\s+", " ", html.unescape(ohne)).strip()


def _datum(roh: str) -> datetime:
    m = re.match(r"(\d{1,2})\.\s*(\S+)\s+(\d{4})", roh.strip())
    if not m:
        return datetime.now(timezone.utc)
    tag, monat, jahr = int(m.group(1)), MONATE.get(m.group(2).lower(), 1), int(m.group(3))
    return datetime(jahr, monat, tag, 12, 0, tzinfo=timezone.utc)


def main() -> int:
    if not QUELLE.exists():
        print(f"Quelle fehlt: {QUELLE}")
        return 1
    s = QUELLE.read_text(encoding="utf-8")
    artikel = re.findall(r'<article class="version[^"]*">(.*?)</article>', s, re.S)
    if not artikel:
        print("Keine Versions-Blöcke gefunden — Aufbau der Seite geändert?")
        return 1

    eintraege = []
    for a in artikel[:20]:                      # 20 Versionen reichen im Feed
        num = re.search(r'class="version-num">([^<]+)<', a)
        dat = re.search(r'class="version-date">([^<]+)<', a)
        tag = re.search(r'class="version-tagline">(.*?)</p>', a, re.S)
        if not num:
            continue
        version = _text(num.group(1))
        tagline = _text(tag.group(1)) if tag else ""
        # Beschreibung: die Highlight-Absätze, sonst die Liste
        teile = [_text(h) for h in re.findall(r'<div class="highlight">(.*?)</div>', a, re.S)]
        if not teile:
            teile = [_text(li) for li in re.findall(r"<li>(.*?)</li>", a, re.S)[:6]]
        eintraege.append({
            "titel": f"{version} — {tagline}" if tagline else version,
            "link": f"{BASIS}#{version.replace('.', '-')}",
            "datum": _datum(dat.group(1) if dat else ""),
            "text": "\n\n".join(teile[:4]),
        })

    jetzt = format_datetime(datetime.now(timezone.utc))
    zeilen = ['<?xml version="1.0" encoding="UTF-8"?>',
              '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">', "<channel>",
              "<title>GPS Studio by reisezoom.com — Versions-Verlauf</title>",
              f"<link>{BASIS}</link>",
              "<description>Was sich in jeder Version von GPS Studio ändert.</description>",
              "<language>de</language>",
              f"<lastBuildDate>{jetzt}</lastBuildDate>",
              '<atom:link href="https://reisezoom.com/downloads/gps-studio/latest/changelog.xml"'
              ' rel="self" type="application/rss+xml"/>']
    for e in eintraege:
        zeilen += ["<item>",
                   f"<title>{html.escape(e['titel'])}</title>",
                   f"<link>{html.escape(e['link'])}</link>",
                   f"<guid isPermaLink=\"false\">gps-studio-{html.escape(e['titel'].split(' ')[0])}</guid>",
                   f"<pubDate>{format_datetime(e['datum'])}</pubDate>",
                   f"<description>{html.escape(e['text'])}</description>",
                   "</item>"]
    zeilen += ["</channel>", "</rss>"]
    ZIEL.write_text("\n".join(zeilen) + "\n", encoding="utf-8")
    print(f"✅ {ZIEL.relative_to(ROOT) if ZIEL.is_relative_to(ROOT) else ZIEL} "
          f"({len(eintraege)} Einträge, {ZIEL.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
