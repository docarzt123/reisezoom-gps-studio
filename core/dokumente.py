"""Dokumente zur Tour (12.10.2026, Stufe 1) — Ankündigungen, Routenbeschreibungen, Tickets, Notizen als PDF, Text oder
Word an eine Tour hängen. „Wenn es zur Tour gehört, gehört es dazu“ (Marc). Die App VERKNÜPFT nur: die Datei bleibt, wo
sie ist, und wird nie verändert (wie die Fotos). Hier: was man aus einer Datei liest — Art, Text für die Archiv-Suche,
Vorschaubild der ersten Seite. Keine allgemeine Dokumentenverwaltung.
"""
from __future__ import annotations

import base64
import io
import os
import re
import zipfile
from typing import Optional

#: Dateiendung → Art (Symbol und Text auf der Tour-Seite)
ARTEN = {
    ".pdf": "pdf",
    ".txt": "text", ".md": "text", ".markdown": "text", ".rtf": "text",
    ".doc": "word", ".docx": "word", ".odt": "word", ".pages": "word",
    ".xls": "tabelle", ".xlsx": "tabelle", ".ods": "tabelle", ".numbers": "tabelle", ".csv": "tabelle",
    ".html": "web", ".htm": "web", ".webloc": "web", ".url": "web",
    ".jpg": "bild", ".jpeg": "bild", ".png": "bild", ".heic": "bild", ".webp": "bild",
}
#: Für den Dateidialog (macOS/Windows-Filter)
ENDUNGEN = sorted(ARTEN)
TEXT_MAX = 40000          # Zeichen je Dokument für die Suche
PDF_SEITEN_MAX = 40


def art(pfad: str) -> str:
    return ARTEN.get(os.path.splitext(str(pfad or ""))[1].lower(), "datei")


def _sauber(t: str) -> str:
    t = re.sub(r"[ \t\r\f\v]+", " ", t or "")
    t = re.sub(r"\n\s*\n+", "\n", t)
    return t.strip()[:TEXT_MAX]


def text_lesen(pfad: str) -> str:
    """Text eines Dokuments für die Archiv-Suche — leer, wenn die Art keinen hergibt oder die Datei unlesbar ist.
    PDF über pypdf (erste PDF_SEITEN_MAX Seiten), Text/Markdown direkt, Word (.docx) und OpenDocument aus dem ZIP."""
    p = str(pfad or "")
    if not p or not os.path.isfile(p):
        return ""
    endung = os.path.splitext(p)[1].lower()
    try:
        if endung == ".pdf":
            from pypdf import PdfReader
            r = PdfReader(p, strict=False)
            if r.is_encrypted:
                try:
                    r.decrypt("")
                except Exception:  # noqa: BLE001
                    return ""
            teile = []
            for i, seite in enumerate(r.pages):
                if i >= PDF_SEITEN_MAX:
                    break
                try:
                    teile.append(seite.extract_text() or "")
                except Exception:  # noqa: BLE001 — eine kaputte Seite hält den Rest nicht auf
                    continue
                if sum(len(x) for x in teile) > TEXT_MAX:
                    break
            return _sauber("\n".join(teile))
        if endung in (".txt", ".md", ".markdown", ".csv"):
            roh = open(p, "rb").read(TEXT_MAX * 4)
            for kod in ("utf-8", "cp1252", "latin-1"):
                try:
                    return _sauber(roh.decode(kod))
                except UnicodeDecodeError:
                    continue
            return ""
        if endung in (".docx", ".odt"):
            innen = "word/document.xml" if endung == ".docx" else "content.xml"
            with zipfile.ZipFile(p) as z:
                xml = z.read(innen).decode("utf-8", "replace")
            xml = re.sub(r"</(w:p|text:p|text:h)>", "\n", xml)
            return _sauber(re.sub(r"<[^>]+>", " ", xml))
        if endung in (".html", ".htm"):
            roh = open(p, "rb").read(TEXT_MAX * 6).decode("utf-8", "replace")
            roh = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", roh)
            return _sauber(re.sub(r"<[^>]+>", " ", roh))
    except Exception:  # noqa: BLE001 — unlesbar: kein Suchtext, die Verknüpfung bleibt trotzdem
        return ""
    return ""


def vorschau(pfad: str, px: int = 320) -> Optional[str]:
    """Vorschaubild der ersten Seite als data:-URL (PNG/JPEG) oder None. Bilder über Pillow, alles andere über Quick Look
    (nur macOS; Windows/Linux zeigen das Symbol der Art)."""
    p = str(pfad or "")
    if not p or not os.path.isfile(p):
        return None
    try:
        if art(p) == "bild":
            from PIL import Image, ImageOps
            try:
                import pillow_heif  # noqa: F401
                pillow_heif.register_heif_opener()
            except Exception:  # noqa: BLE001
                pass
            with Image.open(p) as im:
                im = ImageOps.exif_transpose(im).convert("RGB")
                im.thumbnail((px, px))
                buf = io.BytesIO()
                im.save(buf, "JPEG", quality=82)
            return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
        from core.exif import extract_quicklook_thumbnail
        png = extract_quicklook_thumbnail(p, size=px)
        if png:
            return "data:image/png;base64," + base64.b64encode(png).decode("ascii")
    except Exception:  # noqa: BLE001
        return None
    return None


# ── Verknüpfung in der Archiv-Datenbank ─────────────────────────────────────────────────────────────────────────────
# Schlüssel ist die Tour (tracks.tour_id — überlebt neue Fassungen derselben Tour), nicht der Dateipfad der GPX.
# `text_norm` = Name + gelesener Text, klein und ohne Akzente (library._norm) — die Archiv-Suche findet die Tour darüber.

_SCHEMA = """
CREATE TABLE IF NOT EXISTS tour_dokumente (
    tour      TEXT NOT NULL,
    pfad      TEXT NOT NULL,
    name      TEXT,
    art       TEXT,
    groesse   INTEGER,
    mtime     REAL,
    text_norm TEXT,
    n_zeichen INTEGER DEFAULT 0,
    added_at  TEXT,
    PRIMARY KEY (tour, pfad)
);
CREATE INDEX IF NOT EXISTS idx_tour_dokumente_tour ON tour_dokumente(tour);
"""


def schema_anlegen(conn) -> None:
    conn.executescript(_SCHEMA)
    try:
        from . import library as _lib
        _lib._DOKUMENTE_DA = bool(conn.execute("SELECT 1 FROM tour_dokumente LIMIT 1").fetchone()) or _lib._DOKUMENTE_DA
    except Exception:  # noqa: BLE001
        pass


def _norm(s: str) -> str:
    from .library import _norm as n
    return n(s)


def verknuepfen(conn, tour: str, pfade: list) -> dict:
    """Dateien an die Tour hängen (vorhandene werden neu gelesen). Returns {neu, schon, fehlt, ohne_text}."""
    import datetime as _dt
    neu = schon = fehlt = ohne_text = 0
    for p in pfade or []:
        p = str(p or "")
        if not p or not os.path.isfile(p):
            fehlt += 1
            continue
        da = conn.execute("SELECT 1 FROM tour_dokumente WHERE tour = ? AND pfad = ?", (tour, p)).fetchone()
        text = text_lesen(p)
        if not text and art(p) in ("pdf", "text", "word", "web"):
            ohne_text += 1
        st = os.stat(p)
        name = os.path.basename(p)
        conn.execute("INSERT OR REPLACE INTO tour_dokumente(tour, pfad, name, art, groesse, mtime, text_norm, n_zeichen, added_at) "
                     "VALUES(?,?,?,?,?,?,?,?, COALESCE((SELECT added_at FROM tour_dokumente WHERE tour = ? AND pfad = ?), ?))",
                     (tour, p, name, art(p), int(st.st_size), float(st.st_mtime), _norm(name + "\n" + text), len(text),
                      tour, p, _dt.datetime.now().isoformat(timespec="seconds")))
        if da:
            schon += 1
        else:
            neu += 1
    conn.commit()
    if neu:
        from . import library as _lib
        _lib._DOKUMENTE_DA = True
    return {"neu": neu, "schon": schon, "fehlt": fehlt, "ohne_text": ohne_text}


def liste(conn, tour: str) -> list:
    """Dokumente der Tour, neueste Verknüpfung zuletzt; `fehlt` = Datei nicht (mehr) da (Laufwerk ab, verschoben)."""
    out = []
    for r in conn.execute("SELECT pfad, name, art, groesse, n_zeichen, added_at FROM tour_dokumente WHERE tour = ? "
                          "ORDER BY added_at, name", (tour,)).fetchall():
        pfad = r[0]
        out.append({"pfad": pfad, "name": r[1] or os.path.basename(pfad), "art": r[2] or art(pfad), "groesse": r[3] or 0,
                    "n_zeichen": r[4] or 0, "added_at": r[5] or "", "fehlt": not os.path.exists(pfad)})
    return out


def entfernen(conn, tour: str, pfad: str) -> bool:
    """Nur die Verknüpfung lösen — die Datei bleibt unangetastet."""
    n = conn.execute("DELETE FROM tour_dokumente WHERE tour = ? AND pfad = ?", (tour, str(pfad or ""))).rowcount
    conn.commit()
    return n > 0


def anzahl(conn, tour: str) -> int:
    try:
        return int(conn.execute("SELECT COUNT(*) FROM tour_dokumente WHERE tour = ?", (tour,)).fetchone()[0])
    except Exception:  # noqa: BLE001
        return 0
