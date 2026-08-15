"""Wo die Geheimnisse des Cloud-Archivs liegen (seit 15.08.2026).

Entwurf: `docs/IDEAS.md` §26. Marc am 15.08.2026 zur Ablage: Schlüsselbund,
nicht `settings.json` — „geht das auch für windows und linux? sonst brauchen wir
ein fallback."

## Die Antwort war: ja, mit einer Einschränkung

| System | Ablage |
|---|---|
| macOS | Schlüsselbund |
| Windows | Anmeldeinformationsverwaltung |
| Linux | Secret Service von GNOME/KDE — **nur mit laufendem Desktop** |

Auf einem kargen Linux gibt es keinen Schlüsselbund. Dann fällt dieses Modul auf
eine Datei zurück, die nur der Nutzer lesen darf (0600) — **und sagt das auch**
(`ablage_beschreibung()`). Stillschweigend auszuweichen wäre das Schlimmste:
Der Nutzer glaubt, sein Schlüssel liege sicher, und er liegt im Klartext.

## ⚠️ Warum nicht in die `settings.json`

Die wandert in Sicherungen, in Fehlerberichte und in das „Log auf den
Schreibtisch legen", das für einen Nutzer gebaut wurde, der seine Log-Datei
nicht fand. Ein Serverschlüssel im Klartext wäre dort früher oder später zu
sehen — auf einem fremden Bildschirm.

## Zwei Geheimnisse je Archiv

* **Zugang** (Adresse + Schlüssel) — damit spricht die App mit dem Server.
* **Datenschlüssel** — damit öffnet sie die Umschläge. Er entsteht beim
  Einrichten aus dem Passwort (siehe `crypto.py`) und wird hier abgelegt, damit
  das Passwort auf diesem Rechner nie wieder gebraucht wird.
"""
from __future__ import annotations

import base64
import json
import os
import stat
import threading
from dataclasses import dataclass
from pathlib import Path

DIENST = "Reisezoom GPS Studio (Cloud-Archiv)"

# ⚠️ Zeitgrenze für JEDEN Schlüsselbund-Zugriff.
#
# Gefunden am 15.08.2026 beim Test in der gebauten App: Wurde ein Eintrag von
# einem ANDEREN Programm angelegt (hier: der Entwicklungslauf), fragt macOS beim
# Lesen nach Erlaubnis — und `keyring.get_password` kehrt bis zur Antwort NICHT
# zurück. Erscheint der Dialog nicht (weil er hinter dem Fenster liegt oder der
# Aufruf aus einem Hintergrund-Thread kommt), hängt der Aufruf für immer.
#
# Ohne diese Grenze fror damit die Zustandsanzeige dauerhaft ein, ohne Fehler,
# ohne Log — sie blieb einfach leer. Lieber nach ein paar Sekunden ehrlich
# „nicht erreichbar" sagen als schweigend hängen.
ZEITGRENZE = 8.0

_ZUGANG = "zugang"
_DATENSCHLUESSEL = "datenschluessel"


class SchluesselAblageFehler(Exception):
    """Ablegen oder Lesen ist gescheitert."""


@dataclass(frozen=True)
class Zugang:
    """Wie die App den Server erreicht."""
    adresse: str
    schluessel: str


# ══════════════════════════════════════════════════════════════════════════
#  Welche Ablage haben wir?
# ══════════════════════════════════════════════════════════════════════════

def _schluesselbund():
    """Den Schlüsselbund holen — oder None, wenn es hier keinen gibt."""
    try:
        import keyring
        from keyring.backends import fail
        kr = keyring.get_keyring()
        # ⚠️ `keyring` liefert auf Systemen ohne Ablage einen Platzhalter, der
        # beim Schreiben wirft statt beim Holen. Ohne diese Prüfung fiele das
        # erst auf, wenn der Nutzer schon meint, er sei eingerichtet.
        if isinstance(kr, fail.Keyring):
            return None
        return keyring
    except Exception:
        return None


def hat_schluesselbund() -> bool:
    return _schluesselbund() is not None


def ablage_beschreibung() -> str:
    """Ein Satz für die Oberfläche — ehrlich, nicht beschönigend."""
    if hat_schluesselbund():
        import keyring
        name = keyring.get_keyring().__class__.__name__
        if "macOS" in name or name == "Keyring":
            return "Im Schlüsselbund dieses Macs."
        if "Windows" in name:
            return "In der Anmeldeinformationsverwaltung von Windows."
        return "Im Schlüsselbund des Systems."
    return ("Dieses System hat keinen Schlüsselbund. Zugang und Schlüssel liegen "
            "in einer Datei, die nur du lesen kannst — nicht verschlüsselt.")


# ══════════════════════════════════════════════════════════════════════════
#  Rückfall: eine Datei, die nur dem Nutzer gehört
# ══════════════════════════════════════════════════════════════════════════

def _rueckfall_datei(basis: Path) -> Path:
    return Path(basis) / "cloud-zugang.json"


def _rueckfall_lesen(basis: Path) -> dict:
    p = _rueckfall_datei(basis)
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception as e:
        raise SchluesselAblageFehler(f"{p} ist beschädigt: {e}") from e


def _rueckfall_schreiben(basis: Path, daten: dict) -> None:
    p = _rueckfall_datei(basis)
    p.parent.mkdir(parents=True, exist_ok=True)
    # ⚠️ Erst die Rechte setzen, dann schreiben. Andersherum stünde der
    # Schlüssel für einen Wimpernschlag für alle lesbar auf der Platte.
    fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, stat.S_IRUSR | stat.S_IWUSR)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(daten, f, indent=2)
    try:
        os.chmod(p, stat.S_IRUSR | stat.S_IWUSR)   # falls die Datei schon existierte
    except OSError:
        pass


# ══════════════════════════════════════════════════════════════════════════
#  Ablegen und holen
# ══════════════════════════════════════════════════════════════════════════

def zugang_ablegen(archiv: str, zugang: Zugang, *, basis: Path | None = None) -> None:
    wert = json.dumps({"adresse": zugang.adresse, "schluessel": zugang.schluessel})
    _ablegen(archiv, _ZUGANG, wert, basis)


def zugang_holen(archiv: str, *, basis: Path | None = None) -> Zugang | None:
    roh = _holen(archiv, _ZUGANG, basis)
    if not roh:
        return None
    d = json.loads(roh)
    return Zugang(adresse=d.get("adresse", ""), schluessel=d.get("schluessel", ""))


def datenschluessel_ablegen(archiv: str, schluessel: bytes, *, basis: Path | None = None) -> None:
    _ablegen(archiv, _DATENSCHLUESSEL, base64.b64encode(schluessel).decode(), basis)


def datenschluessel_holen(archiv: str, *, basis: Path | None = None) -> bytes | None:
    roh = _holen(archiv, _DATENSCHLUESSEL, basis)
    return base64.b64decode(roh) if roh else None


def archiv_vergessen(archiv: str, *, basis: Path | None = None) -> None:
    """Alles zu diesem Archiv löschen — beim Abmelden der Cloud."""
    for feld in (_ZUGANG, _DATENSCHLUESSEL):
        _loeschen(archiv, feld, basis)


# ── innen ─────────────────────────────────────────────────────────────────

def _konto(archiv: str, feld: str) -> str:
    return f"{feld}:{archiv}"


def _mit_zeitgrenze(fn, *a):
    """Einen Schlüsselbund-Aufruf ausführen — oder nach `ZEITGRENZE` aufgeben.

    Gibt `(ok, wert)` zurück. `ok=False` heißt: Der Schlüsselbund hat nicht
    geantwortet (wartet vermutlich auf eine Freigabe, die niemand sieht).
    """
    ergebnis = {}

    def lauf():
        try:
            ergebnis["wert"] = fn(*a)
            ergebnis["ok"] = True
        except Exception as e:      # noqa: BLE001
            ergebnis["fehler"] = e

    t = threading.Thread(target=lauf, daemon=True)
    t.start()
    t.join(ZEITGRENZE)
    if t.is_alive():
        return False, None          # ⚠️ Der Thread läuft weiter — wir warten nur nicht mehr.
    if "fehler" in ergebnis:
        raise ergebnis["fehler"]
    return ergebnis.get("ok", False), ergebnis.get("wert")


def _ablegen(archiv: str, feld: str, wert: str, basis: Path | None) -> None:
    kr = _schluesselbund()
    if kr is not None:
        try:
            ok, _ = _mit_zeitgrenze(kr.set_password, DIENST, _konto(archiv, feld), wert)
            if ok:
                return
        except Exception as e:
            # Der Schlüsselbund kann zur Laufzeit wegbrechen (gesperrt,
            # abgelehnt). Dann nicht scheitern, sondern zurückfallen — und der
            # Nutzer sieht über `ablage_beschreibung()`, woran er ist.
            if basis is None:
                raise SchluesselAblageFehler(f"Schlüsselbund lehnt ab: {e}") from e
    if basis is None:
        raise SchluesselAblageFehler(
            "Kein Schlüsselbund und kein Ablageort angegeben.")
    daten = _rueckfall_lesen(basis)
    daten[_konto(archiv, feld)] = wert
    _rueckfall_schreiben(basis, daten)


def _holen(archiv: str, feld: str, basis: Path | None) -> str | None:
    kr = _schluesselbund()
    if kr is not None:
        try:
            ok, wert = _mit_zeitgrenze(kr.get_password, DIENST, _konto(archiv, feld))
            if ok and wert:
                return wert
        except Exception:
            pass
    if basis is None:
        return None
    return _rueckfall_lesen(basis).get(_konto(archiv, feld))


def _loeschen(archiv: str, feld: str, basis: Path | None) -> None:
    kr = _schluesselbund()
    if kr is not None:
        try:
            _mit_zeitgrenze(kr.delete_password, DIENST, _konto(archiv, feld))
        except Exception:
            pass          # nicht vorhanden ist auch gelöscht
    if basis is not None:
        daten = _rueckfall_lesen(basis)
        if daten.pop(_konto(archiv, feld), None) is not None:
            _rueckfall_schreiben(basis, daten)
