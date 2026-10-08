"""Update ohne Neuinstallation (27.09.2026).

Marc: „können wir vielleicht auch ohne Neuinstallation updaten? falls ja, bau das so."
Das ersetzt die Entscheidung vom 19.06.2026 („bewusst kein Selbst-Update").

Ablauf
  1. Manifest von reisezoom.com lesen (Version, Datei, Größe, SHA-256 je Plattform).
  2. Paket in den App-Ordner laden (`_update/`), Größe und SHA-256 prüfen.
  3. macOS: DMG schreibgeschützt einhängen, das .app daraus NEBEN das laufende Bundle
     kopieren („.Reisezoom GPS Studio.app.update", gleicher Datenträger → Umbenennen ist
     atomar), Signatur prüfen (`codesign --verify --deep --strict`) und verlangen, dass
     das Team (Developer ID) dasselbe ist wie beim laufenden Bundle. Erst dann „bereit".
     Windows: der geprüfte Installer ist „bereit".
  4. Neustart: ein abgekoppelter Helfer wartet, bis die App beendet ist, legt das alte
     Bundle in den Papierkorb, schiebt das neue an seinen Platz und startet es. Das
     laufende Programm überschreibt sich NIE selbst — es lädt Dateien aus seinem Bundle
     bei Bedarf nach, ein Austausch im Betrieb könnte es mitten in der Arbeit abstürzen
     lassen. Windows: der Installer startet (gewohnte Oberfläche, gleiche AppId ersetzt
     die Installation), die App beendet sich.

Warum Windows nicht still: Der Installer braucht Administratorrechte (Installation
unter „Programme"), und ohne Windows-Testrechner lässt sich ein stiller Austausch samt
Neustart nicht prüfen. Der gewohnte Installer ist erprobt.

Sicherheit: nur HTTPS (Ausnahme http://127.0.0.1 für den Prüfstand), Größe + SHA-256
aus dem Manifest. Auf dem Mac zusätzlich die Signaturprüfung mit Team-Vergleich — ein
Angreifer, der den Server übernimmt, kann nicht mit Marcs Developer ID signieren.

Alles Prüfbare liegt in reinen Funktionen; Aufrufe von hdiutil/ditto/codesign gehen
durch `_run`, das der Prüfstand austauschen kann.
"""
from __future__ import annotations

from core import i18n as _i18n  # 29.09.2026 — Meldungen in der App-Sprache
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Callable, Optional

from . import dateischutz as _ds
from . import net as _net

APP_NAME = "Reisezoom GPS Studio"
PLATTFORM_SCHLUESSEL = {"darwin": "macos-arm64", "win32": "windows-x64"}
_LSREGISTER = ("/System/Library/Frameworks/CoreServices.framework/Frameworks/"
               "LaunchServices.framework/Support/lsregister")


def _run(cmd: list, timeout: float = 300.0) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)


# ── Manifest ────────────────────────────────────────────────────────────────────

def url_erlaubt(url: str) -> bool:
    """Nur HTTPS — oder http://127.0.0.1/localhost für den Prüfstand."""
    try:
        u = urllib.parse.urlparse(str(url))
    except Exception:  # noqa: BLE001
        return False
    if u.scheme == "https" and u.netloc:
        return True
    return u.scheme == "http" and (u.hostname or "") in ("127.0.0.1", "localhost")


def paket_aus_manifest(manifest: dict, manifest_url: str, plattform: str = sys.platform) -> Optional[dict]:
    """{version, url, size, sha256, datei} für diese Plattform — oder None."""
    if not isinstance(manifest, dict):
        return None
    key = PLATTFORM_SCHLUESSEL.get(plattform)
    d = ((manifest.get("downloads") or {}).get(key) or {}) if key else {}
    datei = str(d.get("file") or "").strip()
    sha = str(d.get("sha256") or "").strip().lower()
    try:
        groesse = int(d.get("size") or 0)
    except (TypeError, ValueError):
        groesse = 0
    version = str(manifest.get("version") or "").lstrip("vV").strip()
    if not (datei and re.fullmatch(r"[0-9a-f]{64}", sha) and groesse > 0 and version):
        return None
    if "/" in datei or "\\" in datei or datei.startswith("."):
        return None
    url = urllib.parse.urljoin(manifest_url, datei)
    if not url_erlaubt(url):
        return None
    return {"version": version, "url": url, "size": groesse, "sha256": sha, "datei": datei}


def manifest_holen(url: str, ssl_ctx=None, user_agent: str = "ReisezoomGPSStudio", timeout: float = 8.0) -> dict:
    if not url_erlaubt(url):
        raise ValueError(f"Manifest-Adresse nicht erlaubt: {url}")
    req = urllib.request.Request(url, headers={"User-Agent": user_agent, "Cache-Control": "no-cache"})
    with urllib.request.urlopen(req, timeout=timeout, context=ssl_ctx or _net.ssl_context()) as resp:
        return json.loads(resp.read().decode("utf-8"))


# ── Laden + prüfen ──────────────────────────────────────────────────────────────

class Abgebrochen(Exception):
    pass


class UpdateFehler(RuntimeError):
    """Fehler mit Code für die Oberfläche (i18n `update.err.<code>`); der Text ist die deutsche
    Beschreibung fürs Log und der Rückfall, falls eine Übersetzung fehlt."""

    def __init__(self, code: str, text: str):
        super().__init__(text)
        self.code = code


def herunterladen(url: str, ziel: Path, groesse: int, sha256: str, *,
                  fortschritt: Optional[Callable[[int, int], None]] = None,
                  abbruch: Optional[Callable[[], bool]] = None,
                  ssl_ctx=None, user_agent: str = "ReisezoomGPSStudio") -> Path:
    """Datei laden, Größe + SHA-256 prüfen. Erst die fertige, geprüfte Datei bekommt
    ihren Namen (vorher `.teil`). Wirft bei Fehlern; räumt die Teildatei weg."""
    if not url_erlaubt(url):
        raise UpdateFehler("adresse", f"Download-Adresse nicht erlaubt: {url}")
    ziel = Path(ziel)
    ziel.parent.mkdir(parents=True, exist_ok=True)
    teil = ziel.with_name(ziel.name + ".teil")
    h = hashlib.sha256()
    n = 0
    req = urllib.request.Request(url, headers={"User-Agent": user_agent})
    try:
        with urllib.request.urlopen(req, timeout=30, context=ssl_ctx or _net.ssl_context()) as resp, \
                open(teil, "wb") as f:
            while True:
                if abbruch and abbruch():
                    raise Abgebrochen()
                block = resp.read(1 << 20)
                if not block:
                    break
                f.write(block)
                h.update(block)
                n += len(block)
                if n > groesse:
                    raise UpdateFehler("groesse", f"Download größer als angekündigt ({n} > {groesse} Bytes)")
                if fortschritt:
                    fortschritt(n, groesse)
        if n != groesse:
            raise UpdateFehler("unvollstaendig", f"Download unvollständig ({n} von {groesse} Bytes)")
        if h.hexdigest() != sha256.lower():
            raise UpdateFehler("pruefsumme", "Prüfsumme stimmt nicht — die Datei ist beschädigt oder verändert")
        _ds.ersetzen(teil, ziel, "selbstupdate", art=_ds.ART_TEMP)
        return ziel
    except BaseException:
        try:
            _ds.loeschen(teil, "selbstupdate", art=_ds.ART_TEMP)
        except Exception:  # noqa: BLE001
            pass
        raise


# ── macOS: Bundle bereitstellen und prüfen ──────────────────────────────────────

def team_id(app: Path) -> str:
    """TeamIdentifier der Signatur ('' = keine / ad-hoc)."""
    r = _run(["codesign", "-dv", "--verbose=2", str(app)], timeout=60)
    m = re.search(r"^TeamIdentifier=(\S+)", (r.stderr or "") + (r.stdout or ""), re.M)
    t = m.group(1) if m else ""
    return "" if t.lower() in ("not", "not set") else t


def signatur_gueltig(app: Path) -> tuple[bool, str]:
    r = _run(["codesign", "--verify", "--deep", "--strict", str(app)], timeout=600)
    return r.returncode == 0, (r.stderr or r.stdout or "").strip()[:300]


def bundle_version(app: Path) -> str:
    try:
        import plistlib
        with open(Path(app) / "Contents" / "Info.plist", "rb") as f:
            return str(plistlib.load(f).get("CFBundleShortVersionString") or "")
    except Exception:  # noqa: BLE001
        return ""


def staging_pfad(bundle: Path) -> Path:
    return Path(bundle).parent / f".{APP_NAME}.app.update"


def mac_bereitstellen(dmg: Path, bundle: Path, erwartete_version: str, erwartetes_team: str,
                      say: Callable[[str], None] = lambda _m: None) -> Path:
    """DMG einhängen, .app daneben kopieren, prüfen. Liefert den Staging-Pfad."""
    bundle = Path(bundle)
    stage = staging_pfad(bundle)
    _ds.nutzer_ziel(stage)   # unsere Zwischenstufe neben dem Bundle (kein GPS-Studio-Bereich)
    if stage.exists():
        _ds.ordner_loeschen(stage, "selbstupdate", art=_ds.ART_TEMP, ignore_errors=True)
    mnt = Path(tempfile.mkdtemp(prefix="rz-update-mnt-"))
    eingehaengt = False
    try:
        r = _run(["hdiutil", "attach", "-nobrowse", "-readonly", "-noautoopen",
                  "-mountpoint", str(mnt), str(dmg)], timeout=300)
        if r.returncode != 0:
            raise UpdateFehler("dmg", "DMG ließ sich nicht öffnen: " + (r.stderr or "").strip()[:200])
        eingehaengt = True
        apps = sorted(p for p in mnt.iterdir() if p.suffix == ".app")
        if not apps:
            raise UpdateFehler("keine_app", "Im DMG liegt keine App")
        say(f"kopiere {apps[0].name} → {stage}")
        r = _run(["ditto", str(apps[0]), str(stage)], timeout=900)
        if r.returncode != 0 or not stage.exists():
            raise UpdateFehler("kopieren", "Kopieren fehlgeschlagen: " + (r.stderr or "").strip()[:200])
    finally:
        if eingehaengt:
            r = _run(["hdiutil", "detach", str(mnt)], timeout=60)
            if r.returncode != 0:
                _run(["hdiutil", "detach", str(mnt), "-force"], timeout=60)
        try:
            # dateischutz-ok: rmdir entfernt nur den eigenen, leeren Einhängepunkt aus mkdtemp (scheitert sonst)
            mnt.rmdir()
        except OSError:
            pass
    try:
        ok, msg = signatur_gueltig(stage)
        if not ok:
            raise UpdateFehler("signatur", "Signatur der neuen Version ist ungültig: " + msg)
        t = team_id(stage)
        if not erwartetes_team or t != erwartetes_team:
            raise UpdateFehler("team", f"Neue Version stammt nicht vom selben Entwickler ({t or 'unsigniert'})")
        v = bundle_version(stage)
        if erwartete_version and v and v != erwartete_version:
            raise UpdateFehler("version", f"Im Paket steckt Version {v}, erwartet {erwartete_version}")
    except BaseException:
        _ds.ordner_loeschen(stage, "selbstupdate", art=_ds.ART_TEMP, ignore_errors=True)
        raise
    # Quarantäne wegnehmen, falls vorhanden (per urllib geladen hat keine — sicher ist sicher)
    _run(["xattr", "-dr", "com.apple.quarantine", str(stage)], timeout=120)
    return stage


def _sh(s: str) -> str:
    return "'" + str(s).replace("'", "'\"'\"'") + "'"


def helfer_skript(pid: int, bundle: Path, stage: Path, alte_version: str, logdatei: Path,
                  neu_starten: bool = True, start_env: Optional[dict] = None) -> str:
    """Shell-Helfer: warten bis `pid` weg ist → altes Bundle in den Papierkorb →
    neues an seinen Platz → starten. Bei jedem Fehlschlag bleibt/kommt das alte zurück."""
    # Papierkorb zur LAUFZEIT über $HOME (nicht beim Erzeugen festschreiben — sonst landet ein
    # Prüfstand-Lauf mit eigenem HOME im echten Papierkorb; so am 27.09.2026 passiert).
    alt_name = f"{APP_NAME} {alte_version}.app" if alte_version else f"{APP_NAME} (alt).app"
    # Eine Test-App (eigener App-Ordner) muss als Test-App zurückkommen — `open` gibt die
    # Umgebung sonst nicht weiter, und sie liefe mit den echten Daten des Rechners.
    env_teile = "".join(f" --env {_sh(f'{k}={v}')}" for k, v in sorted((start_env or {}).items()))
    starte = f'open -n {_sh(bundle)}{env_teile}' if neu_starten else "true"
    return f"""#!/bin/sh
# GPS Studio Update-Helfer (core/selbstupdate.py) — wird nach dem Austausch nicht mehr gebraucht.
LOG={_sh(logdatei)}
APP={_sh(bundle)}
NEU={_sh(stage)}
KORB="$HOME/.Trash"
ALT="$KORB/"{_sh(alt_name)}
log() {{ echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }}
log "Helfer wartet auf PID {int(pid)}"
i=0
while kill -0 {int(pid)} 2>/dev/null; do
  sleep 0.5; i=$((i+1))
  if [ $i -gt 240 ]; then log "App nach 120 s nicht beendet — Abbruch, nichts geändert"; exit 1; fi
done
sleep 1
[ -d "$NEU" ] || {{ log "neue Version fehlt — nichts geändert"; exit 1; }}
mkdir -p "$KORB"
[ -e "$ALT" ] && ALT="$KORB/{APP_NAME} (alt $(date +%s)).app"
if mv "$APP" "$ALT"; then
  if mv "$NEU" "$APP"; then
    log "ausgetauscht: $APP (alte Version im Papierkorb: $ALT)"
    {_sh(_LSREGISTER)} -f "$APP" >/dev/null 2>&1 || true
  else
    log "neue Version ließ sich nicht an ihren Platz schieben — alte zurück"
    mv "$ALT" "$APP"
  fi
else
  log "altes Bundle ließ sich nicht verschieben — nichts geändert"
  rm -rf "$NEU"
fi
{starte}
log "fertig"
"""


# ── Zustand + Ablauf (eine laufende Aktion je App) ──────────────────────────────

class Updater:
    """Hält den Zustand für die Oberfläche: phase ∈ idle | laden | pruefen | bereit |
    fehler | abgebrochen; dazu Version, Bytes, Fehlertext."""

    def __init__(self, arbeitsordner: Path, *, bundle: Optional[Path], plattform: str = sys.platform,
                 aktuelle_version: str = "", log: Callable[[str], None] = lambda _m: None):
        self.ordner = Path(arbeitsordner)
        self.bundle = Path(bundle) if bundle else None
        self.plattform = plattform
        self.aktuell = aktuelle_version
        self.log = log
        self._lock = threading.Lock()
        self._abbruch = False
        self._thread: Optional[threading.Thread] = None
        self.st: dict = {"phase": "idle"}

    # Kann diese Installation sich selbst ersetzen?
    def moeglich(self) -> dict:
        if self.plattform == "win32":
            return {"ok": True, "art": "installer"}
        if self.plattform != "darwin":
            return {"ok": False, "grund": "plattform"}
        b = self.bundle
        if not b or b.suffix != ".app":
            return {"ok": False, "grund": "nicht_gebuendelt"}
        if "/AppTranslocation/" in str(b) or str(b).startswith("/Volumes/"):
            return {"ok": False, "grund": "nicht_installiert"}
        if not (os.access(b.parent, os.W_OK) and os.access(b, os.W_OK)):
            return {"ok": False, "grund": "rechte"}
        return {"ok": True, "art": "bundle"}

    def status(self) -> dict:
        with self._lock:
            return dict(self.st)

    def _setzen(self, **kw) -> None:
        with self._lock:
            self.st.update(kw)

    def abbrechen(self) -> None:
        self._abbruch = True

    def starten(self, paket: dict, *, ssl_ctx=None, user_agent: str = "ReisezoomGPSStudio",
                erwartetes_team: str = "") -> dict:
        with self._lock:
            if self._thread and self._thread.is_alive():
                return {"ok": False, "error": _i18n.t_aktiv("update.err.laeuft", "Ein Update läuft bereits")}
            self.st = {"phase": "laden", "version": paket["version"], "bytes": 0, "total": paket["size"]}
        self._abbruch = False

        def _lauf():
            try:
                ziel = self.ordner / paket["datei"]
                herunterladen(paket["url"], ziel, paket["size"], paket["sha256"],
                              fortschritt=lambda n, g: self._setzen(bytes=n, total=g),
                              abbruch=lambda: self._abbruch, ssl_ctx=ssl_ctx, user_agent=user_agent)
                self.log(f"Update {paket['version']}: geladen und geprüft ({paket['size']} Bytes)")
                self._setzen(phase="pruefen")
                if self.plattform == "darwin":
                    stage = mac_bereitstellen(ziel, self.bundle, paket["version"], erwartetes_team, say=self.log)
                    try:
                        _ds.loeschen(ziel, "selbstupdate", art=_ds.ART_TEMP)
                    except Exception:  # noqa: BLE001
                        pass
                    self._setzen(phase="bereit", stage=str(stage), art="bundle")
                else:
                    self._setzen(phase="bereit", installer=str(ziel), art="installer")
                self.log(f"Update {paket['version']}: bereit")
            except Abgebrochen:
                self._setzen(phase="abgebrochen")
                self.log("Update abgebrochen")
            except Exception as e:  # noqa: BLE001
                self._setzen(phase="fehler", error=str(e), code=getattr(e, "code", "netz"))
                self.log(f"Update fehlgeschlagen: {e}")

        self._thread = threading.Thread(target=_lauf, daemon=True, name="rz-selbstupdate")
        self._thread.start()
        return {"ok": True}

    def anwenden(self, pid: int, logdatei: Path, neu_starten: bool = True, start_env: Optional[dict] = None) -> dict:
        """Helfer/Installer abgekoppelt starten. Danach muss die App sich beenden."""
        st = self.status()
        if st.get("phase") != "bereit":
            return {"ok": False, "error": _i18n.t_aktiv("update.err.nicht_bereit", "Kein Update bereit")}
        if st.get("art") == "bundle":
            skript = self.ordner / "update-helfer.sh"
            skript.write_text(helfer_skript(pid, self.bundle, Path(st["stage"]), self.aktuell, logdatei,
                                            neu_starten=neu_starten, start_env=start_env), encoding="utf-8")
            os.chmod(skript, 0o755)
            subprocess.Popen(["/bin/sh", str(skript)], start_new_session=True, close_fds=True,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL)
            self.log(f"Update-Helfer gestartet ({skript})")
            return {"ok": True, "art": "bundle"}
        if st.get("art") == "installer":
            exe = st.get("installer")
            if not exe or not Path(exe).is_file():
                return {"ok": False, "error": _i18n.t_aktiv("update.err.installer_fehlt", "Installer fehlt")}
            flags = 0x00000008 | 0x00000200   # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
            subprocess.Popen([exe], close_fds=True, creationflags=flags)
            self.log(f"Installer gestartet ({exe})")
            return {"ok": True, "art": "installer"}
        return {"ok": False, "error": "Unbekannte Update-Art"}

    def aufraeumen(self) -> None:
        """Reste früherer Läufe (Teildateien, alte Pakete, liegengebliebenes Staging)."""
        try:
            if self.ordner.is_dir():
                for p in self.ordner.iterdir():
                    if p.suffix in (".teil", ".dmg", ".exe") or p.name == "update-helfer.sh":
                        try:
                            _ds.loeschen(p, "selbstupdate", art=_ds.ART_TEMP)
                        except Exception:  # noqa: BLE001
                            pass
            if self.bundle:
                st = staging_pfad(self.bundle)
                if st.exists():
                    _ds.nutzer_ziel(st)
                    _ds.ordner_loeschen(st, "selbstupdate", art=_ds.ART_TEMP, ignore_errors=True)
        except Exception:  # noqa: BLE001
            pass


__all__ = ["Updater", "paket_aus_manifest", "manifest_holen", "herunterladen", "mac_bereitstellen",
           "helfer_skript", "team_id", "signatur_gueltig", "bundle_version", "url_erlaubt", "staging_pfad",
           "Abgebrochen", "UpdateFehler"]
