"""Verschlüsselung für das Cloud-Archiv (seit 15.08.2026).

Entworfen mit Marc am 15.08.2026, festgehalten in `docs/IDEAS.md` §26.

## Das Modell in drei Sätzen

Ein **Datenschlüssel** (256 Bit, gewürfelt) verschlüsselt alles. Er selbst liegt
**verpackt** auf dem Server — aufgeschlossen wird er mit einem **Passwort**, das
die App würfelt und dem Nutzer einmal zeigt. Der Server sieht nie das Passwort
und nie den Datenschlüssel im Klartext, sondern nur das verschlossene Paket.

Damit kommt Gerät 2 allein mit dem Passwort an alles heran — es muss nichts
übertragen werden außer diesem einen Satz Zeichen.

## ⚠️ Zwei Geheimnisse, die man nicht verwechseln darf

* **Zugangsschlüssel** — sagt dem Server „ich darf mit dir sprechen". Den *kennt*
  der Server. Er steckt NICHT in diesem Modul, sondern in `transport.py`.
* **Passwort** — schließt die Inhalte auf. Das kennt der Server **nie**.

Wer den Zugangsschlüssel stiehlt, sieht verschlüsselte Klumpen. Wer das Passwort
verliert, verliert die Daten — auch Marc kann dann nicht helfen. Genau so muss
die App es beim Einrichten sagen.

## ⚠️ Warum das Passwort gewürfelt wird und nicht ausgedacht

Ein selbst ausgedachtes Passwort wäre die schwächste Stelle der ganzen Kette:
Der Datenschlüssel ist 256 Bit stark, ein menschliches Passwort selten mehr als
30. Marc am 15.08.2026: „Die app schlägt was vor." Das Ergebnis hat rund 122 Bit
und gehört in einen Passwortmanager — abtippbar, aber nicht erratbar.

## Format eines Umschlags

    RZC1 | Nonce (12 Byte) | Geheimtext + Prüfsumme

`RZC1` ist Kennung und Fassungsnummer in einem: Wenn das Format je wechselt,
erkennt eine ältere App das sofort, statt Unsinn zu entschlüsseln.

**Jeder Umschlag ist an seinen Namen gebunden** (AES-GCM „associated data"). Ein
Server, der zwei Umschläge vertauscht, fliegt damit auf — ohne diese Bindung
könnte er den Umschlag der Tour A unter dem Namen der Tour B ausliefern, und die
Entschlüsselung würde anstandslos gelingen.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import secrets
from dataclasses import dataclass

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

# ── Format ────────────────────────────────────────────────────────────────
KENNUNG = b"RZC1"
NONCE_LEN = 12          # von AES-GCM vorgegeben
SCHLUESSEL_LEN = 32     # 256 Bit

# ── Passwort ──────────────────────────────────────────────────────────────
# Crockford-Base32 ohne I, L, O, U: keine Verwechslung von 1/I/l und 0/O, und
# kein zufälliges Schimpfwort. 30 Zeichen, 25 Stellen → ~122 Bit.
ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ"
GRUPPEN = 5
GRUPPENLAENGE = 5

# ── Schlüsselableitung ────────────────────────────────────────────────────
# scrypt steckt in der Standardbibliothek — eine Abhängigkeit weniger.
# Die Parameter kosten auf einem Rechner von 2026 gut 100 ms. Das ist reichlich
# für etwas, das einmal beim Einrichten und einmal je Gerät passiert, und wäre
# selbst dann noch eine Hürde, wenn das Passwort schwächer wäre als es ist.
SCRYPT_N = 2 ** 15
SCRYPT_R = 8
SCRYPT_P = 1


class CloudKryptoFehler(Exception):
    """Etwas stimmt nicht — falsches Passwort, beschädigtes Paket, fremdes Format."""


class FalschesPasswort(CloudKryptoFehler):
    """Das Passwort schließt dieses Archiv nicht auf."""


# ══════════════════════════════════════════════════════════════════════════
#  Passwort
# ══════════════════════════════════════════════════════════════════════════

def passwort_wuerfeln() -> str:
    """Ein neues Archiv-Passwort. Gruppiert, damit man es vorlesen kann."""
    zeichen = [secrets.choice(ALPHABET) for _ in range(GRUPPEN * GRUPPENLAENGE)]
    return "-".join("".join(zeichen[i:i + GRUPPENLAENGE])
                    for i in range(0, len(zeichen), GRUPPENLAENGE))


def passwort_normalisieren(eingabe: str) -> str:
    """Alles wegwerfen, was nicht zum Alphabet gehört; Rest großschreiben.

    ⚠️ Das ist kein Luxus: Wer das Passwort aus einer Mail oder einem
    Passwortmanager kopiert, schleppt Bindestriche, Leerzeichen, Zeilenumbrüche
    oder Kleinbuchstaben mit. Ohne diese Umformung scheitert das Aufschließen,
    und der Nutzer sieht „falsches Passwort", obwohl er das richtige hat.

    Verwechselbare Zeichen werden NICHT geraten: Das Alphabet enthält weder
    0/O noch 1/I/L, die Verwechslung kann also gar nicht entstehen. Zeichen
    umzubiegen, die es nicht gibt, würde nur echte Tippfehler verschleiern.
    """
    return "".join(c for c in eingabe.upper() if c in ALPHABET)


def passwort_gueltig(eingabe: str) -> bool:
    """Hat die Eingabe die richtige Länge und nur erlaubte Zeichen?"""
    return len(passwort_normalisieren(eingabe)) == GRUPPEN * GRUPPENLAENGE


# ══════════════════════════════════════════════════════════════════════════
#  Datenschlüssel ein- und auspacken
# ══════════════════════════════════════════════════════════════════════════

@dataclass(frozen=True)
class VerpackterSchluessel:
    """Was davon auf dem Server liegen darf — und sonst nichts."""
    salz: bytes
    nonce: bytes
    paket: bytes
    n: int = SCRYPT_N
    r: int = SCRYPT_R
    p: int = SCRYPT_P

    def als_json(self) -> str:
        import base64
        b = base64.b64encode
        return json.dumps({
            "format": "RZC1",
            "kdf": "scrypt",
            "n": self.n, "r": self.r, "p": self.p,
            "salz": b(self.salz).decode(),
            "nonce": b(self.nonce).decode(),
            "paket": b(self.paket).decode(),
        }, indent=2)

    @staticmethod
    def aus_json(text: str) -> "VerpackterSchluessel":
        import base64
        d = json.loads(text)
        if d.get("format") != "RZC1":
            raise CloudKryptoFehler(
                f"Unbekanntes Schlüsselformat {d.get('format')!r} — "
                "vermutlich von einer neueren Fassung der App angelegt.")
        e = base64.b64decode
        return VerpackterSchluessel(
            salz=e(d["salz"]), nonce=e(d["nonce"]), paket=e(d["paket"]),
            n=int(d.get("n", SCRYPT_N)), r=int(d.get("r", SCRYPT_R)),
            p=int(d.get("p", SCRYPT_P)))


def _passwort_zu_schluessel(passwort: str, salz: bytes, n: int, r: int, p: int) -> bytes:
    roh = passwort_normalisieren(passwort).encode("utf-8")
    return hashlib.scrypt(roh, salt=salz, n=n, r=r, p=p, dklen=SCHLUESSEL_LEN,
                          maxmem=(128 * n * r * p) + (1 << 22))


def archiv_anlegen(passwort: str | None = None) -> tuple[bytes, str, VerpackterSchluessel]:
    """Ein frisches Archiv: Datenschlüssel, Passwort und das verpackte Paket.

    Rückgabe: (datenschluessel, passwort, verpackt). Der Datenschlüssel gehört
    in den Schlüsselbund, das Passwort vor die Augen des Nutzers, das Paket auf
    den Server.
    """
    passwort = passwort or passwort_wuerfeln()
    if not passwort_gueltig(passwort):
        raise CloudKryptoFehler("Passwort hat nicht die erwartete Form.")
    datenschluessel = secrets.token_bytes(SCHLUESSEL_LEN)
    return datenschluessel, passwort, schluessel_verpacken(datenschluessel, passwort)


def schluessel_verpacken(datenschluessel: bytes, passwort: str) -> VerpackterSchluessel:
    salz = secrets.token_bytes(16)
    nonce = secrets.token_bytes(NONCE_LEN)
    ableitung = _passwort_zu_schluessel(passwort, salz, SCRYPT_N, SCRYPT_R, SCRYPT_P)
    paket = AESGCM(ableitung).encrypt(nonce, datenschluessel, b"rz-archiv-schluessel")
    return VerpackterSchluessel(salz=salz, nonce=nonce, paket=paket)


def schluessel_auspacken(verpackt: VerpackterSchluessel, passwort: str) -> bytes:
    """Datenschlüssel zurückgewinnen — der Weg, den Gerät 2 geht."""
    if not passwort_gueltig(passwort):
        raise FalschesPasswort("Passwort hat nicht die erwartete Form.")
    ableitung = _passwort_zu_schluessel(passwort, verpackt.salz,
                                        verpackt.n, verpackt.r, verpackt.p)
    try:
        return AESGCM(ableitung).decrypt(verpackt.nonce, verpackt.paket,
                                         b"rz-archiv-schluessel")
    except Exception as e:      # InvalidTag & Co. — Ursache nie durchreichen
        raise FalschesPasswort(
            "Dieses Passwort schließt das Archiv nicht auf.") from e


# ══════════════════════════════════════════════════════════════════════════
#  Umschläge
# ══════════════════════════════════════════════════════════════════════════

def verschliessen(datenschluessel: bytes, name: str, inhalt: bytes) -> bytes:
    """Inhalt in einen Umschlag legen, der an `name` gebunden ist.

    `name` ist der logische Name (z. B. `track/6a1f…`, `verzeichnis`) — NICHT
    der Dateiname auf dem Server. Er wandert nicht mit ins Paket, sondern wird
    mitgerechnet: Wer den Umschlag unter einem anderen Namen ausliefert, bekommt
    beim Öffnen einen Fehler statt falscher Daten.
    """
    if len(datenschluessel) != SCHLUESSEL_LEN:
        raise CloudKryptoFehler("Datenschlüssel hat die falsche Länge.")
    nonce = secrets.token_bytes(NONCE_LEN)
    ct = AESGCM(datenschluessel).encrypt(nonce, inhalt, name.encode("utf-8"))
    return KENNUNG + nonce + ct


def oeffnen(datenschluessel: bytes, name: str, umschlag: bytes) -> bytes:
    """Umschlag öffnen. Wirft, wenn Name, Schlüssel oder Inhalt nicht passen."""
    if not umschlag.startswith(KENNUNG):
        gefunden = umschlag[:4].decode("latin-1", "replace")
        raise CloudKryptoFehler(
            f"Das ist kein Umschlag dieser App (Kennung {gefunden!r}).")
    nonce = umschlag[len(KENNUNG):len(KENNUNG) + NONCE_LEN]
    ct = umschlag[len(KENNUNG) + NONCE_LEN:]
    if len(nonce) != NONCE_LEN or not ct:
        raise CloudKryptoFehler("Umschlag ist abgeschnitten.")
    try:
        return AESGCM(datenschluessel).decrypt(nonce, ct, name.encode("utf-8"))
    except Exception as e:
        raise CloudKryptoFehler(
            f"Umschlag {name!r} lässt sich nicht öffnen — falscher Schlüssel, "
            "vertauschter Name oder beschädigt.") from e


# ══════════════════════════════════════════════════════════════════════════
#  Prüfsummen fürs Verzeichnis
# ══════════════════════════════════════════════════════════════════════════

def inhalts_pruefsumme(inhalt: bytes) -> str:
    """Prüfsumme über den KLARTEXT, für „hat sich das geändert?".

    ⚠️ Bewusst über den Klartext und nicht über den Umschlag: Zwei Umschläge
    desselben Inhalts sehen unterschiedlich aus (jedes Mal ein neues Nonce).
    Über den Umschlag gerechnet wäre jede Prüfsumme bei jedem Hochladen neu,
    und die Frage „hat sich etwas geändert?" nie mit Nein zu beantworten.
    """
    return hashlib.sha256(inhalt).hexdigest()


def gleich(a: str, b: str) -> bool:
    """Prüfsummen vergleichen, ohne über die Laufzeit zu plaudern."""
    return hmac.compare_digest(a or "", b or "")
