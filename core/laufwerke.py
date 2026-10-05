"""Auf welchem Laufwerk liegt ein Ordner, und ist es gerade da? (04.10.2026)

Marc: „Es wird immer noch nicht richtig angezeigt, welche Ordner eingehängt sind und welche gerade nicht verfügbar
sind" — und: „Aber was ist /Volumes/Fotos überhaupt? Im Finder sehe ich das so ja gar nicht."

Die App prüfte bisher nur `Path(ordner).is_dir()` und zeigte Systempfade. Hier steht stattdessen, was der Finder auch
sagt: der Name des Laufwerks, ob es ein Netzlaufwerk (mit Server) ist, ein USB-/Zusatzlaufwerk oder dieser Rechner —
und ob man wirklich hineinsehen kann (eine hängende NAS-Verbindung meldet sonst „da", liefert aber nichts).

Woher ein Netzlaufwerk kommt (Server, Adresse zum Verbinden), steht nur in der Mount-Tabelle, solange es verbunden ist.
Der Aufrufer merkt es sich deshalb (core/fotos.py, Tabelle `foto_laufwerk`), damit die App es auch sagen kann, wenn das
Laufwerk fehlt — und „Verbinden" öffnen kann (macOS fragt das Passwort selbst ab, die App sieht es nie).

macOS: `mount` · Linux: /proc/mounts · Windows: Laufwerksbuchstabe + GetDriveTypeW / WNetGetConnectionW.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Optional

NETZ_FS = {"smbfs", "afpfs", "nfs", "nfs4", "webdav", "cifs", "smb3", "fuse.sshfs", "davfs", "9p"}
_MOUNT_RE = re.compile(r"^(?P<quelle>.+?) on (?P<ziel>/.*?) \((?P<fs>[^,)]+)(?:, (?P<opt>[^)]*))?\)$")


def _ohne_fenster() -> dict:
    if sys.platform == "win32":
        return {"creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0)}
    return {}


# Audit E-3 (05.10.2026): die Seitenleiste fragt bis alle 2 s — je Anfrage ein `mount` und je Ordner ein Prüffaden.
# Bei hängendem NAS sammelten sich so Dutzende blockierte Fäden. Kurz merken, und nie zwei Prüfungen desselben Pfads.
_MOUNT_MERK: dict = {"t": 0.0, "tab": None}
MOUNT_MERK_S = 3.0
_LESBAR_MERK: dict = {}          # pfad → (zeit, wert)
_LESBAR_LAEUFT: set = set()
LESBAR_MERK_S = 5.0
LESBAR_HAENGT_S = 30.0
_merk_sperre = threading.Lock()


def mount_tabelle(text: Optional[str] = None) -> list[dict]:
    """Eingehängte Laufwerke: [{quelle, ziel, fs, netz}] — `text` für Tests (Ausgabe von `mount`)."""
    if text is None:
        jetzt = time.monotonic()
        if _MOUNT_MERK["tab"] is not None and jetzt - _MOUNT_MERK["t"] < MOUNT_MERK_S:
            return list(_MOUNT_MERK["tab"])
        tab = _mount_tabelle_lesen()
        _MOUNT_MERK.update({"t": jetzt, "tab": tab})
        return list(tab)
    return _mount_tabelle_lesen(text)


def _mount_tabelle_lesen(text: Optional[str] = None) -> list[dict]:
    raus = []
    if text is None:
        if sys.platform == "darwin":
            try:
                text = subprocess.run(["/sbin/mount"], capture_output=True, text=True, timeout=5).stdout
            except Exception:  # noqa: BLE001
                text = ""
        elif sys.platform.startswith("linux"):
            try:
                zeilen = Path("/proc/mounts").read_text(encoding="utf-8", errors="replace").splitlines()
            except Exception:  # noqa: BLE001
                zeilen = []
            for z in zeilen:
                t = z.split()
                if len(t) >= 3:
                    ziel = t[1].replace("\\040", " ")
                    raus.append({"quelle": t[0].replace("\\040", " "), "ziel": ziel, "fs": t[2], "netz": t[2] in NETZ_FS})
            return raus
        else:
            return raus
    for z in (text or "").splitlines():
        m = _MOUNT_RE.match(z.strip())
        if not m:
            continue
        fs = m.group("fs").strip()
        raus.append({"quelle": m.group("quelle"), "ziel": m.group("ziel"), "fs": fs, "netz": fs in NETZ_FS})
    return raus


def _server_und_url(quelle: str, fs: str) -> tuple[str, str, str]:
    """Aus der Mount-Quelle: (Server zum Anzeigen, Adresse zum Verbinden, Freigabe).
    //marc@NAS._smb._tcp.local/Fotos → ("NAS", "smb://marc@NAS._smb._tcp.local/Fotos", "Fotos")."""
    q = quelle.strip()
    if fs in ("smbfs", "cifs", "smb3") and q.startswith("//"):
        rest = q[2:]
        wer, _, ort = rest.rpartition("@") if "@" in rest.split("/", 1)[0] else ("", "", rest)
        host, _, freigabe = ort.partition("/")
        wer = wer.split(":", 1)[0]                     # nie ein Passwort weitertragen
        if wer.upper() == "GUEST":
            wer = ""
        url = "smb://" + (wer + "@" if wer else "") + host + "/" + freigabe
        return _server_name(host), url, freigabe.split("/")[-1] or freigabe
    if fs == "afpfs":
        m = re.match(r"^(?:afp_[^@]*@)?(?:[^@/]*@)?([^/]+)/(.+)$", q)
        if m:
            return _server_name(m.group(1)), "afp://" + m.group(1) + "/" + m.group(2), m.group(2)
    if fs.startswith("nfs") and ":" in q:
        host, _, exp = q.partition(":")
        return _server_name(host), "nfs://" + host + exp, exp.rstrip("/").split("/")[-1]
    if fs == "webdav":
        return _server_name(re.sub(r"^https?://", "", q).split("/")[0]), q, q.rstrip("/").split("/")[-1]
    return "", "", ""


def _server_name(host: str) -> str:
    h = re.sub(r"\._(smb|afpovertcp|nfs)\._tcp\.local\.?$", "", host or "")
    h = re.sub(r"\.local\.?$", "", h)
    return h.replace("%20", " ")


def _lesbar(pfad: str, frist: float = 2.0) -> Optional[bool]:
    """Kann man hineinsehen? True/False, None = keine Antwort in `frist` Sekunden (hängende Netzverbindung).

    Gemerkt: eine Antwort LESBAR_MERK_S, „hängt" LESBAR_HAENGT_S; läuft für den Pfad noch eine Prüfung, gilt er
    als hängend, statt einen weiteren Faden zu starten (Audit E-3)."""
    jetzt = time.monotonic()
    with _merk_sperre:
        m = _LESBAR_MERK.get(pfad)
        if m and jetzt - m[0] < (LESBAR_HAENGT_S if m[1] is None else LESBAR_MERK_S):
            return m[1]
        if pfad in _LESBAR_LAEUFT:
            return None
        _LESBAR_LAEUFT.add(pfad)
    erg: list = []

    def lauf():
        try:
            with os.scandir(pfad) as it:
                next(it, None)
            erg.append(True)
        except Exception:  # noqa: BLE001
            erg.append(False)
        finally:
            with _merk_sperre:
                _LESBAR_LAEUFT.discard(pfad)
                if erg:
                    _LESBAR_MERK[pfad] = (time.monotonic(), erg[0])

    t = threading.Thread(target=lauf, daemon=True, name="laufwerk-pruefen")
    t.start()
    t.join(frist)
    wert = erg[0] if erg else None
    if wert is None:
        with _merk_sperre:
            _LESBAR_MERK[pfad] = (time.monotonic(), None)
    return wert


def _mount_von(pfad: str, tabelle: list[dict]) -> Optional[dict]:
    """Längster Mount-Punkt, der den Pfad enthält (außer „/")."""
    beste = None
    for m in tabelle:
        z = m["ziel"].rstrip("/") or "/"
        if z == "/":
            continue
        if pfad == z or pfad.startswith(z + "/"):
            if beste is None or len(z) > len(beste["ziel"]):
                beste = m
    return beste


def _windows_info(pfad: str) -> dict:
    lw = os.path.splitdrive(pfad)[0]
    info = {"wurzel": lw + "\\" if lw else "", "name": lw or pfad, "art": "intern", "server": "", "url": "", "freigabe": ""}
    if pfad.startswith("\\\\"):
        teile = pfad.lstrip("\\").split("\\")
        if len(teile) >= 2:
            info.update(art="netz", server=teile[0], url="\\\\" + teile[0] + "\\" + teile[1], name=teile[1],
                        freigabe=teile[1], wurzel="\\\\" + teile[0] + "\\" + teile[1])
        return info
    try:
        import ctypes
        typ = ctypes.windll.kernel32.GetDriveTypeW(lw + "\\")
        if typ == 4:   # DRIVE_REMOTE
            info["art"] = "netz"
            buf = ctypes.create_unicode_buffer(1024)
            n = ctypes.c_ulong(1024)
            if ctypes.windll.mpr.WNetGetConnectionW(lw, buf, ctypes.byref(n)) == 0:
                unc = buf.value
                teile = unc.lstrip("\\").split("\\")
                info.update(url=unc, server=teile[0] if teile else "", freigabe=teile[1] if len(teile) > 1 else "")
        elif typ == 2:  # DRIVE_REMOVABLE
            info["art"] = "extern"
        elif typ == 3 and lw.upper() not in ("C:",):
            info["art"] = "extern"
    except Exception:  # noqa: BLE001
        pass
    return info


def info(pfad: str, tabelle: Optional[list[dict]] = None, gemerkt: Optional[dict] = None,
         volumes: str = "/Volumes", pruefen: bool = True) -> dict:
    """Laufwerk eines Ordners.

    Rückgabe: {name, art: netz|extern|intern, server, url, freigabe, wurzel, verbunden, lesbar, da, alternativ}
    — `da` = verbunden und lesbar (bzw. lesbar unbekannt, wenn `pruefen` aus). `gemerkt` = was der Aufrufer beim
    letzten Mal über dieses Laufwerk wusste (Server/Adresse bleiben so sichtbar, wenn es fehlt). `alternativ` = Pfad,
    unter dem derselbe Ordner gerade erreichbar ist (macOS vergibt „Fotos-1", wenn „Fotos" belegt war)."""
    p = str(pfad or "")
    gemerkt = gemerkt or {}
    if sys.platform == "win32" and not p.startswith("/"):
        i = _windows_info(p)
        verbunden = os.path.isdir(i["wurzel"] or p)
        lesbar = _lesbar(p) if (pruefen and verbunden) else (None if verbunden else False)
        for k in ("server", "url", "freigabe"):
            if not i.get(k) and gemerkt.get(k):
                i[k] = gemerkt[k]
        if not verbunden and gemerkt.get("art"):
            i["art"] = gemerkt["art"]
        i.update(verbunden=verbunden, lesbar=lesbar, da=bool(verbunden and lesbar is not False and (lesbar or not pruefen)),
                 alternativ="")
        return i

    tab = tabelle if tabelle is not None else mount_tabelle()
    vol = volumes.rstrip("/")
    m = re.match(re.escape(vol) + r"/([^/]+)", p)
    mt = _mount_von(p, tab)
    if m:                                            # macOS: /Volumes/<Name>/…
        name = m.group(1)
        wurzel = vol + "/" + name
        verbunden = any((x["ziel"].rstrip("/") == wurzel) for x in tab) if tabelle is not None or sys.platform == "darwin" \
            else os.path.ismount(wurzel)
    elif mt is not None:                             # Linux /media/…, /mnt/…, oder anderer Mount-Punkt
        wurzel = mt["ziel"].rstrip("/")
        name = Path(wurzel).name or wurzel
        verbunden = True
    else:                                            # Ordner auf diesem Rechner
        lesbar = _lesbar(p) if pruefen else None
        da = os.path.isdir(p) and lesbar is not False
        return {"name": "", "art": "intern", "server": "", "url": "", "freigabe": "", "wurzel": "",
                "verbunden": True, "lesbar": lesbar, "da": bool(da and (lesbar or not pruefen)), "alternativ": ""}

    eintrag = next((x for x in tab if x["ziel"].rstrip("/") == wurzel), None) if verbunden else None
    art, server, url, freigabe = "extern", "", "", ""
    if eintrag is not None:
        if eintrag["netz"]:
            art = "netz"
            server, url, freigabe = _server_und_url(eintrag["quelle"], eintrag["fs"])
    elif gemerkt:
        art = gemerkt.get("art") or art
        server, url, freigabe = gemerkt.get("server", ""), gemerkt.get("url", ""), gemerkt.get("freigabe", "")
    lesbar: Optional[bool]
    if verbunden:
        lesbar = _lesbar(p) if pruefen else None
    else:
        lesbar = False
    # Unter anderem Namen eingehängt? („Fotos-1", „Fotos 1") — und liegt derselbe Unterordner dort?
    alternativ = ""
    if not verbunden and m:
        rel = p[len(wurzel):]
        muster = re.compile(r"^" + re.escape(vol) + "/" + re.escape(name) + r"[- ]\d+$")
        for x in tab:
            z = x["ziel"].rstrip("/")
            if not muster.match(z):
                continue
            if url and x["netz"]:
                _s, u2, _f = _server_und_url(x["quelle"], x["fs"])
                if u2 and u2.split("@")[-1].lower() != url.split("@")[-1].lower():
                    continue
            kandidat = z + rel
            if _lesbar(kandidat, 1.5):
                alternativ = kandidat
                break
    da = bool(verbunden and lesbar is not False and (lesbar or not pruefen))
    return {"name": name, "art": art, "server": server, "url": url, "freigabe": freigabe, "wurzel": wurzel,
            "verbunden": bool(verbunden), "lesbar": lesbar, "da": da, "alternativ": alternativ}


def verbinden(url: str) -> bool:
    """Netzlaufwerk über das Betriebssystem öffnen (wie ⌘K im Finder). Passwort fragt das System, nicht die App."""
    u = str(url or "").strip()
    if not u:
        return False
    if not (re.match(r"^(smb|afp|nfs|https?)://", u) or u.startswith("\\\\")):
        return False
    try:
        if sys.platform == "darwin":
            subprocess.Popen(["/usr/bin/open", u])
        elif sys.platform == "win32":
            os.startfile(u)  # type: ignore[attr-defined]  # noqa: S606
        else:
            subprocess.Popen(["xdg-open", u], **_ohne_fenster())
        return True
    except Exception:  # noqa: BLE001
        return False
