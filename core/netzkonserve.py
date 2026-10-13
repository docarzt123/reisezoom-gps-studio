"""Netz-Konserve für Tests (13.10.2026) — Ortsdienste ohne echtes Netz abspielen.

Die volle Suite hing immer wieder an langsamen Ortsdiensten (Photon/Nominatim/Overpass): Zeitlimits, Tests, die zu früh
nachsahen, 13.10.: drei Läufe bis grün. Ist die Umgebungsvariable `RZ_NETZ_KONSERVE` gesetzt (nur `scripts/run_tests.py`
tut das), gehen Anfragen an diese Dienste nicht mehr ins Netz, sondern werden aus Dateien beantwortet:
- vorhanden → sofort die aufgezeichnete Antwort
- fehlt → einmal echt fragen und die Antwort (nur Erfolge) für alle späteren Läufe ablegen
Alle anderen Adressen (Kartenkacheln, Updates …) bleiben unberührt. In der App ist das nie aktiv.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import threading
import urllib.parse
import urllib.request
from pathlib import Path

HOSTS = ("photon.komoot.io", "nominatim.openstreetmap.org", "overpass-api.de", "overpass.kumi.systems")
_lock = threading.Lock()
_orig = None
_ordner: Path | None = None
zaehler = {"abgespielt": 0, "aufgenommen": 0}


class _Antwort(io.BytesIO):
    """Genug von http.client.HTTPResponse für unsere Aufrufer: read(), with, status/getcode(), headers."""

    def __init__(self, daten: bytes, status: int = 200, kopf: dict | None = None, url: str = ""):
        super().__init__(daten)
        self.status = self.code = status
        self.headers = kopf or {}
        self.url = url

    def getcode(self):
        return self.status

    def geturl(self):
        return self.url

    def info(self):
        return self.headers


def _schluessel(url: str, daten) -> str:
    roh = url.encode("utf-8") + b"\n" + (daten if isinstance(daten, bytes) else str(daten or "").encode("utf-8"))
    return hashlib.sha256(roh).hexdigest()[:32]


def _abfangen(url, data=None, timeout=None, *a, **k):   # reicht context= des Aufrufers weiter (**k)
    req = url if isinstance(url, urllib.request.Request) else None
    adresse = req.full_url if req is not None else str(url)
    host = urllib.parse.urlsplit(adresse).hostname or ""
    if _ordner is None or host not in HOSTS:
        return _orig(url, data, timeout, *a, **k) if timeout is not None else _orig(url, data, *a, **k)
    daten = data if data is not None else (req.data if req is not None else None)
    datei = _ordner / host / (_schluessel(adresse, daten) + ".json")
    if datei.is_file():
        try:
            e = json.loads(datei.read_text(encoding="utf-8"))
            zaehler["abgespielt"] += 1
            return _Antwort(e["body"].encode("utf-8"), int(e.get("status", 200)), e.get("headers") or {}, adresse)
        except Exception:  # noqa: BLE001 — kaputte Aufnahme → neu holen
            pass
    antwort = _orig(url, data, timeout, *a, **k) if timeout is not None else _orig(url, data, *a, **k)
    with antwort:
        body = antwort.read()
        status = getattr(antwort, "status", 200) or 200
        kopf = {"Content-Type": antwort.headers.get("Content-Type", "")} if getattr(antwort, "headers", None) else {}
    if 200 <= int(status) < 300:
        try:
            datei.parent.mkdir(parents=True, exist_ok=True)
            tmp = datei.with_suffix(f".{os.getpid()}.{threading.get_ident()}.tmp")
            tmp.write_text(json.dumps({"url": adresse, "status": int(status), "headers": kopf,
                                       "body": body.decode("utf-8", errors="replace")}, ensure_ascii=False),
                           encoding="utf-8")
            os.replace(tmp, datei)   # dateischutz-ok: nur Test-Aufnahmen (RZ_NETZ_KONSERVE), nie Nutzerdaten — in der App aus
            zaehler["aufgenommen"] += 1
        except OSError:
            pass
    return _Antwort(body, int(status), kopf, adresse)


def einschalten(ordner) -> bool:
    """Konserve für diesen Prozess einschalten (idempotent)."""
    global _orig, _ordner
    with _lock:
        _ordner = Path(ordner)
        if _orig is None:
            _orig = urllib.request.urlopen
            urllib.request.urlopen = _abfangen
    return True


def aus_umgebung() -> bool:
    o = (os.environ.get("RZ_NETZ_KONSERVE") or "").strip()
    return einschalten(o) if o else False
