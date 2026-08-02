"""Ein einziger Ort für ausgehende HTTPS-Verbindungen.

Warum es diese Datei gibt
-------------------------
In der gebauten App (PyInstaller) findet Pythons OpenSSL die System-Zertifikate
**nicht**. Jeder HTTPS-Aufruf stirbt dann mit::

    [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed:
    unable to get local issuer certificate

Das ist bisher **dreimal** aufgefallen und **dreimal einzeln** repariert worden:

* v0.9.261 — Reiseroute (`core/route.py`), Nutzer-Bug
* v0.9.316 — Update-Prüfung (`app.py`), Nutzer-Bug „keine Verbindung"
* v0.9.496 — Adressen im Geotagger (`core/geocode.py`), Nutzer-Bug-Report

Beim dritten Mal fiel auf, dass dieselbe Wurzel noch zwei weitere Stellen
betrifft, die nur noch niemand gemeldet hatte: `core/elevation.py` (Höhen aus
dem Geländemodell) und `core/library.py` (Kartenbilder fürs Tour-Archiv).

Deshalb jetzt eine Quelle statt fünf Kopien — und zusätzlich ein Riegel, der
auch für Aufrufe gilt, die diese Datei gar nicht kennen: `install_default_ca()`
setzt `SSL_CERT_FILE`, und daran hält sich jede Bibliothek, die Pythons
Vorgabe-Kontext benutzt.

**Regel:** Ein neuer HTTPS-Aufruf im Kern nimmt `context=ssl_context()` mit.
Wer das vergisst, baut denselben Fehler zum vierten Mal.
"""
from __future__ import annotations

import os
import ssl

__all__ = ["ssl_context", "install_default_ca"]

_CTX: ssl.SSLContext | None = None


def _ca_datei() -> str | None:
    """Pfad zum mitgelieferten Zertifikatsspeicher, falls vorhanden."""
    try:
        import certifi          # über requests verfügbar, via PyInstaller gebündelt
        pfad = certifi.where()
        return pfad if pfad and os.path.exists(pfad) else None
    except Exception:           # noqa: BLE001 — ohne certifi bleibt der Systemspeicher
        return None


def ssl_context() -> ssl.SSLContext:
    """Ein geprüfter TLS-Kontext, der auch im Bundle Zertifikate findet.

    Wird einmal gebaut und wiederverwendet — das Einlesen des CA-Bundles kostet
    sonst bei jedem Aufruf Zeit, und Adressen werden im Hundertertakt abgefragt.
    """
    global _CTX
    if _CTX is None:
        ca = _ca_datei()
        _CTX = ssl.create_default_context(cafile=ca) if ca \
            else ssl.create_default_context()
    return _CTX


def install_default_ca() -> str | None:
    """`SSL_CERT_FILE` setzen, damit auch fremder Code Zertifikate findet.

    Muss **vor** dem ersten TLS-Aufbau laufen (OpenSSL liest die Variable beim
    Anlegen des Vorgabe-Kontexts). Eine bereits gesetzte Variable bleibt
    unangetastet — wer sie selbst setzt, meint es so.

    Gibt den verwendeten Pfad zurück, oder None, wenn es beim Systemspeicher
    bleibt.
    """
    if os.environ.get("SSL_CERT_FILE"):
        return os.environ["SSL_CERT_FILE"]
    ca = _ca_datei()
    if ca:
        os.environ["SSL_CERT_FILE"] = ca
        os.environ.setdefault("REQUESTS_CA_BUNDLE", ca)
    return ca
