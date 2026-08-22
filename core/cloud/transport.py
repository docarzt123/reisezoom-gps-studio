"""Reden mit der Gegenstelle auf dem eigenen Webserver (seit 15.08.2026).

Gegenstück zu `server/rz-cloud.php`. Entwurf: `docs/IDEAS.md` §26.

## ⚠️ Was dieses Modul NICHT tut

Es verschlüsselt nichts und entschlüsselt nichts. Hier kommen fertige Umschläge
an und gehen fertige Umschläge raus. Wer das vermischt, hat irgendwann eine
Stelle, an der Klartext über die Leitung geht — deshalb ist die Trennung streng:
`crypto.py` macht Umschläge, dieses Modul trägt sie.

## Namen

Nach außen heißt eine Tour `track/6a1f…`, auf dem Server `sha256(...)`. Der
Server erfährt damit nie, wie etwas heißt, und kann trotzdem ablegen und
wiederfinden. Die Umrechnung steht hier an einer Stelle: `server_name()`.

⚠️ Der LOGISCHE Name bleibt der, mit dem der Umschlag verschlossen wurde —
sonst schlägt die Namensbindung aus `crypto.py` fehl. Nicht verwechseln.
"""
from __future__ import annotations

import hashlib
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

from .. import net

ZEITLIMIT = 60          # Sekunden je Anfrage
FORMAT = 1              # das Protokoll, das diese App spricht


class CloudFehler(Exception):
    """Der Server hat nicht mitgespielt."""


class UnsichereAdresse(CloudFehler):
    """http:// statt https:// — Zugangsschlüssel ginge im Klartext (22.08.2026)."""


class NichtErreichbar(CloudFehler):
    """Kein Netz, falsche Adresse, Server aus."""


class ZugangAbgelehnt(CloudFehler):
    """Falscher oder fehlender Zugangsschlüssel."""


class NichtVorhanden(CloudFehler):
    """Diesen Umschlag gibt es dort nicht."""


class FormatZuNeu(CloudFehler):
    """Der Server spricht eine neuere Fassung, als diese App kennt."""


@dataclass(frozen=True)
class Eintrag:
    """Was der Server über einen Umschlag weiß — mehr sieht er nicht."""
    name: str            # Server-Name (Hash)
    pruef: str           # Prüfsumme des KLARTEXTS, vom Client gesetzt
    groesse: int
    zeit: int
    nummer: int


def server_name(logischer_name: str) -> str:
    """`track/6a1f…` → 64 Hexzeichen. Verrät nichts und ist immer gültig."""
    return hashlib.sha256(logischer_name.encode("utf-8")).hexdigest()


def adresse_pruefen(adresse: str) -> str:
    """22.08.2026 — HTTPS ist Pflicht. Ohne Schema wird https:// ergänzt;
    http:// wird abgelehnt, weil der Zugangsschlüssel sonst im Klartext über
    die Leitung ginge (die Umschläge selbst sind verschlüsselt, der Schlüssel
    im Header nicht). Ausnahme nur für Tests: localhost/127.0.0.1 oder
    `RZ_CLOUD_HTTP=1`."""
    a = (adresse or "").strip()
    if not a:
        raise CloudFehler("Keine Adresse angegeben.")
    if "://" not in a:
        a = "https://" + a
    teile = urllib.parse.urlsplit(a)
    schema = (teile.scheme or "").lower()
    host = (teile.hostname or "").lower()
    if schema == "https":
        return a
    if schema == "http":
        if host in ("localhost", "127.0.0.1", "::1") or os.environ.get("RZ_CLOUD_HTTP") == "1":
            return a
        raise UnsichereAdresse("Nur https:// ist erlaubt — http:// würde den Zugangsschlüssel unverschlüsselt übertragen.")
    raise CloudFehler(f"Unbekanntes Adress-Schema: {schema or '?'}")


class Gegenstelle:
    """Ein Archiv auf einem Webserver."""

    def __init__(self, adresse: str, schluessel: str = "", *, zeitlimit: int = ZEITLIMIT):
        self.adresse = adresse_pruefen(adresse)
        self.schluessel = schluessel
        self.zeitlimit = zeitlimit

    # ── innen ────────────────────────────────────────────────────────────

    def _url(self, was: str, **argumente) -> str:
        argumente = {k: v for k, v in argumente.items() if v is not None}
        frage = urllib.parse.urlencode({"was": was, **argumente})
        return f"{self.adresse}{'&' if '?' in self.adresse else '?'}{frage}"

    def _anfragen(self, was: str, *, rumpf: bytes | None = None,
                  methode: str = "GET", roh: bool = False, **argumente):
        url = self._url(was, **argumente)
        req = urllib.request.Request(url, data=rumpf, method=methode)
        if self.schluessel:
            req.add_header("X-RZ-Schluessel", self.schluessel)
        if rumpf is not None:
            req.add_header("Content-Type", "application/octet-stream")
        try:
            # ⚠️ `context=` ist Pflicht (siehe core/net.py): In der gebauten App
            # findet OpenSSL die System-Zertifikate nicht, und jeder HTTPS-Aufruf
            # stirbt mit CERTIFICATE_VERIFY_FAILED. Dieser Fehler ist dem Projekt
            # schon fünfmal passiert — `tests/` hat ihn hier zum sechsten Mal
            # abgefangen, bevor er einen Nutzer erreicht hat.
            with urllib.request.urlopen(req, timeout=self.zeitlimit,
                                        context=net.ssl_context()) as antwort:
                daten = antwort.read()
        except urllib.error.HTTPError as e:
            daten = e.read()
            text = ""
            try:
                text = (json.loads(daten) or {}).get("fehler", "")
            except Exception:
                text = daten[:200].decode("utf-8", "replace")
            if e.code in (401, 403):
                raise ZugangAbgelehnt(text or "Zugang abgelehnt.") from e
            if e.code == 404 and was == "holen":
                raise NichtVorhanden(text or "Nicht vorhanden.") from e
            raise CloudFehler(f"Server meldet {e.code}: {text}") from e
        except urllib.error.URLError as e:
            raise NichtErreichbar(
                f"{self.adresse} ist nicht erreichbar: {e.reason}") from e
        except TimeoutError as e:
            raise NichtErreichbar("Zeitüberschreitung.") from e

        if roh:
            return daten
        try:
            d = json.loads(daten)
        except Exception as e:
            # ⚠️ Der häufigste Fall in der Praxis: Der Nutzer hat die Adresse
            # der HTML-Seite eingetragen statt die der PHP-Datei. Dann kommt
            # eine Webseite zurück, und eine Meldung wie „Erwartungswert 1,
            # Zeile 1" hilft niemandem.
            anfang = daten[:60].decode("utf-8", "replace").strip()
            raise CloudFehler(
                "Der Server antwortet nicht wie die Gegenstelle des GPS Studios. "
                f"Zeigt die Adresse wirklich auf rz-cloud.php? (Anfang: {anfang!r})"
            ) from e
        if not d.get("ok"):
            raise CloudFehler(d.get("fehler") or "Unbekannter Fehler.")
        return d

    # ── außen ────────────────────────────────────────────────────────────

    def info(self) -> dict:
        """Ohne Zugang: Spricht dort überhaupt unsere Gegenstelle?"""
        d = self._anfragen("info")
        if d.get("dienst") != "reisezoom-cloud":
            raise CloudFehler("Dort antwortet etwas anderes als ein GPS-Studio-Archiv.")
        if int(d.get("format", 0)) > FORMAT:
            raise FormatZuNeu(
                "Dieses Archiv wurde von einer neueren Fassung des GPS Studios "
                "angelegt. Bitte aktualisiere die App.")
        return d

    def anlegen(self, verpackter_schluessel_json: str) -> str:
        """Archiv einrichten. Gibt den Zugangsschlüssel zurück — nur dieses eine Mal."""
        d = self._anfragen("anlegen", methode="POST",
                           rumpf=verpackter_schluessel_json.encode("utf-8"))
        self.schluessel = d["schluessel"]
        return self.schluessel

    def archiv_schluessel(self) -> str:
        """Den verpackten Datenschlüssel holen — der Weg von Gerät 2."""
        return self._anfragen("archiv", roh=True).decode("utf-8")

    def liste(self) -> dict[str, Eintrag]:
        """Alles, was oben liegt — in EINER Anfrage."""
        d = self._anfragen("liste")
        return {name: Eintrag(name=name, pruef=e.get("pruef", ""),
                              groesse=int(e.get("groesse", 0)),
                              zeit=int(e.get("zeit", 0)),
                              nummer=int(e.get("nummer", 0)))
                for name, e in (d.get("eintraege") or {}).items()}

    def holen(self, logischer_name: str) -> bytes:
        return self._anfragen("holen", roh=True, name=server_name(logischer_name))

    def legen(self, logischer_name: str, umschlag: bytes, pruefsumme: str) -> int:
        """Umschlag ablegen. `pruefsumme` ist die des KLARTEXTS (siehe crypto)."""
        d = self._anfragen("legen", methode="POST", rumpf=umschlag,
                           name=server_name(logischer_name), pruef=pruefsumme)
        return int(d.get("nummer", 0))

    def loeschen(self, logischer_name: str) -> None:
        self._anfragen("loeschen", methode="POST",
                       name=server_name(logischer_name))

    def papierkorb_leeren(self, tage: int = 30) -> int:
        d = self._anfragen("papierkorb", methode="POST", tage=tage)
        return int(d.get("geloescht", 0))

    # ── Papierkorb im Detail (v0.9.524) ──────────────────────────────────
    # Der Server kennt nur Hex-Namen und Zeitpunkte — Klarnamen übersetzt die
    # App lokal zurück (server_name ist sha256 über den logischen Namen; wir
    # kennen alle logischen Namen, die es je gab, aus dem Verzeichnis).

    def papierkorb_liste(self) -> list[dict]:
        d = self._anfragen("papierkorb_liste")
        return list(d.get("eintraege") or [])

    def papierkorb_holen(self, hex_name: str, zeit: int) -> bytes:
        """Einen Eintrag verschlüsselt ausliefern — Wiederherstellen macht die
        App selbst (entschlüsseln → prüfen → normal wieder ablegen), damit der
        Server nie die Klartext-Prüfsumme kennen muss."""
        return self._anfragen("papierkorb_holen", roh=True,
                              name=hex_name, zeit=zeit)

    def papierkorb_weg(self, hex_name: str, zeit: int) -> bool:
        d = self._anfragen("papierkorb_weg", methode="POST",
                           name=hex_name, zeit=zeit)
        return bool(d.get("geloescht"))
