"""Inhaltssuche im Foto-Archiv: „Sonnenuntergang", „Hund am Strand", „ähnliche Fotos" (04.10.2026, IDEAS §81).

Marc: „wenn jemand seine Bilder irgendwo liegen hat … indiziert … schnell die passenden Bilder findet". Bedingungen
aus dem Gespräch: Modell nur auf Wunsch laden, offen, ohne Konto, läuft auf dem Rechner, sucht in jeder Sprache.

Wie es geht (dasselbe Prinzip wie Immich, siehe unten): Ein Bildmodell macht aus jedem Foto einen Zahlenvektor
(768 Zahlen, „was ist auf dem Bild"), ein Textmodell macht aus der Suchanfrage einen Vektor im selben Raum. Gesucht
wird über das Skalarprodukt — eine Matrixmultiplikation über alle Fotos, unter 0,1 s bei 170.000. Der Vektor hat
keine Sprache; Sprache gibt es nur in der Anfrage.

Modell: Google SigLIP 2 (Apache-2.0) als ONNX-Export von onnx-community, Laufzeit onnxruntime (MIT), Tokenizer
`tokenizers` (Apache-2.0). Gemessen auf dem Mac mini (M6, 04.10.2026): Bildteil fp16 ≈ 25–30 Bilder/s auf der CPU;
CoreML brachte mit diesem Export nichts; die int8-Fassung des Bildteils weicht zu stark ab (Kosinus bis 0,84) und
ist deshalb verworfen. Textteil int8 ist praktisch gleich fp16 (≥ 0,99) und halb so groß.

Angelehnt an Immich (https://github.com/immich-app/immich, AGPL-3.0, machine-learning/immich_ml/models/clip):
die Textaufbereitung (Leerraum zusammenfassen, Satzzeichen weg, klein — „canonicalize") und der Bildzuschnitt für
SigLIP 2 (aufs Quadrat stauchen, bikubisch, Mittelwert/Streuung 0,5). Marc, 04.10.2026: „übernehmt, was wir
übernehmen können … Fotoarchiv inspired by Immich" — steht so in den Credits.

Wo was liegt:
  · Modelle  → <App-Daten>/inhaltssuche/<variante>/   (pro Rechner, jederzeit neu ladbar)
  · Index    → <Bibliothek>/inhaltsindex/<variante>.sqlite   (zieht mit der Bibliothek um — Marc: „könnte man diese
               Bibliothek dann auch auf den Mac mini übertragen?")
"""
from __future__ import annotations

import hashlib
import io
import json
import logging
import math
import os
import sqlite3
import string
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

from core import dateischutz as _ds
from typing import Callable, Optional

log = logging.getLogger(__name__)

# ── Modelle ─────────────────────────────────────────────────────────────────
# Dateien mit fester Revision und Prüfsumme: was geladen wird, ist genau das, was getestet wurde. Zuerst vom eigenen
# Server (reisezoom.com), sonst von Hugging Face (Marc, Q5: „eigener Server, Hugging Face als Rückfall").
SPIEGEL = "https://reisezoom.com/downloads/gps-studio/modelle"

VARIANTEN = {
    "base": {
        "name": "SigLIP 2 Base (224 px)",
        "repo": "onnx-community/siglip2-base-patch16-224-ONNX",
        "rev": "ba1f3b0843f24bc5417d38e19c37b287d719b2f4",
        "px": 224, "dim": 768,
        # logit_scale / logit_bias aus google/siglip2-base-patch16-224 (model.safetensors) — für die Treffer-Schwelle
        "scale": 4.724453449249268, "bias": -16.771724700927734,
        "dateien": {
            "vision.onnx": ("onnx/vision_model_fp16.onnx", 186039516,
                            "a1959f7bd3993a607e48839f6d01e25b876fe76afda301b028b78eef68aabd95"),
            "text.onnx": ("onnx/text_model_int8.onnx", 283438275,
                          "3a0603d3a00c05a80a6ded4743c16aaac7b1e62cdcc7e362e7ce418659b96400"),
            "tokenizer.json": ("tokenizer.json", 34363039,
                               "cb9140fae3ac5122c972d37adf83e1248471a38147ad76f8215c8872c6fd8322"),
        },
    },
    "gross": {
        "name": "SigLIP 2 So400m (256 px)",
        "repo": "onnx-community/siglip2-so400m-patch16-256-ONNX",
        "rev": "7881d8f282cbd7cdeac1aca6bed493a36d58e713",
        "px": 256, "dim": 1152,
        "scale": 4.699399948120117, "bias": -15.932409286499023,
        "dateien": {
            "vision.onnx": ("onnx/vision_model_fp16.onnx", 856359102,
                            "f700a9ffcaa976d663ffd8f3eaff249db42fc22cc70d2aa5e29cc4da5e42b5ad"),
            "text.onnx": ("onnx/text_model_int8.onnx", 711126655,
                          "189f41c153c7a914b67ee3f8aff2b90d6deacf280a504284b4004257cebf9066"),
            "tokenizer.json": ("tokenizer.json", 34363039,
                               "cb9140fae3ac5122c972d37adf83e1248471a38147ad76f8215c8872c6fd8322"),
        },
    },
}
STANDARD = "base"
TEXT_LAENGE = 64          # SigLIP 2 ist so trainiert: immer auf 64 Wortteile aufgefüllt
STAPEL = 16               # Bilder je Modellaufruf
FAEDEN = 2                # Rechenfäden — gedrosselt, damit Animator und Vorschau nicht ruckeln (Q6)
PANORAMA_AB = 2.0         # breiter als 2:1 → in Quadrate zerlegen statt stauchen
QUELLE_PX = 600           # aus dieser Vorschaugröße wird indiziert (Marc, Q9)

LIZENZ_TEXT = """SigLIP 2 — Copyright Google LLC. Licensed under the Apache License, Version 2.0
(https://www.apache.org/licenses/LICENSE-2.0). Model: https://huggingface.co/google/siglip2-base-patch16-224
ONNX export by onnx-community (https://huggingface.co/{repo}), revision {rev}.
Used unmodified by Reisezoom GPS Studio for on-device photo search.
"""


def verfuegbar() -> bool:
    """Ist die Laufzeit da? (Im Bundle immer; im Quellbaum nur mit installiertem onnxruntime/tokenizers.)"""
    try:
        import onnxruntime  # noqa: F401
        import tokenizers  # noqa: F401
        return True
    except Exception:  # noqa: BLE001
        return False


def modell_ordner(app_support: Path, variante: str) -> Path:
    return Path(app_support) / "inhaltssuche" / variante


def index_pfad(bib: Path, variante: str) -> Path:
    return Path(bib) / "inhaltsindex" / f"{variante}.sqlite"


def download_groesse(variante: str) -> int:
    return sum(g for _, g, _ in VARIANTEN[variante]["dateien"].values())


def modell_da(app_support: Path, variante: str) -> bool:
    d = modell_ordner(app_support, variante)
    return all((d / n).is_file() and (d / n).stat().st_size == g
               for n, (_, g, _) in VARIANTEN[variante]["dateien"].items())


def _quellen(variante: str, name: str) -> list:
    v = VARIANTEN[variante]
    pfad, _, _ = v["dateien"][name]
    return [f"{SPIEGEL}/{v['repo'].split('/')[-1]}/{v['rev'][:12]}/{pfad}",
            f"https://huggingface.co/{v['repo']}/resolve/{v['rev']}/{pfad}"]


def _sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for teil in iter(lambda: f.read(1 << 20), b""):
            h.update(teil)
    return h.hexdigest()


def modell_laden(app_support: Path, variante: str, fortschritt: Optional[Callable] = None,
                 stop: Optional[Callable] = None) -> dict:
    """Die Modelldateien holen — fortsetzbar (.part), mit Prüfsumme. `fortschritt(bytes, gesamt, datei)`."""
    v = VARIANTEN[variante]
    ziel = modell_ordner(app_support, variante)
    ziel.mkdir(parents=True, exist_ok=True)
    gesamt = download_groesse(variante)
    fertig_bytes = 0
    for name, (_, groesse, sha) in v["dateien"].items():
        datei = ziel / name
        if datei.is_file() and datei.stat().st_size == groesse:
            fertig_bytes += groesse
            continue
        part = ziel / (name + ".part")
        letzter = None
        for url in _quellen(variante, name):
            try:
                schon = part.stat().st_size if part.is_file() else 0
                if schon > groesse:
                    _ds.loeschen(part, "inhalt_download", art=_ds.ART_TEMP)
                    schon = 0
                req = urllib.request.Request(url, headers={"User-Agent": "ReisezoomGPSStudio"})
                if schon:
                    req.add_header("Range", f"bytes={schon}-")
                # 05.10.2026 (Audit) — geprüfter TLS-Kontext der App: im Paket findet Python die Zertifikate sonst nicht
                # (CERTIFICATE_VERIFY_FAILED beim ersten Einschalten der Inhaltssuche)
                from core import net as _net
                with urllib.request.urlopen(req, timeout=30, context=_net.ssl_context()) as r:
                    if schon and r.status != 206:      # Server kann nicht fortsetzen → von vorn
                        schon = 0
                    with open(part, "ab" if schon else "wb") as f:
                        while True:
                            if stop and stop():
                                return {"ok": False, "abbruch": True}
                            block = r.read(1 << 20)
                            if not block:
                                break
                            f.write(block)
                            schon += len(block)
                            if fortschritt:
                                fortschritt(fertig_bytes + schon, gesamt, name)
                if part.stat().st_size != groesse or _sha256(part) != sha:
                    _ds.loeschen(part, "inhalt_download", art=_ds.ART_TEMP)
                    raise ValueError("Prüfsumme stimmt nicht")
                _ds.ersetzen(part, datei, "inhalt_download", art=_ds.ART_CACHE)
                letzter = None
                log.info("[inhalt] %s geladen von %s", name, url.split("/")[2])
                break
            except Exception as e:  # noqa: BLE001 — nächste Quelle versuchen
                letzter = e
                log.info("[inhalt] %s von %s: %s", name, url.split("/")[2], e)
        if letzter is not None:
            return {"ok": False, "error": f"{name}: {letzter}"}
        fertig_bytes += groesse
    (ziel / "LICENSE.txt").write_text(LIZENZ_TEXT.format(repo=v["repo"], rev=v["rev"]), encoding="utf-8")
    return {"ok": True}


# ── Modell ausführen ────────────────────────────────────────────────────────

_SATZZEICHEN = str.maketrans("", "", string.punctuation)


def text_saeubern(text: str) -> str:
    """Wie Immich `clean_text(canonicalize=True)` für SigLIP 2: Leerraum zusammen, Satzzeichen weg, klein."""
    return " ".join(str(text or "").split()).translate(_SATZZEICHEN).lower()


class Modell:
    """Bild- und Textteil, erst bei Bedarf geladen. Ein Exemplar pro Variante, fadensicher."""

    def __init__(self, app_support: Path, variante: str = STANDARD):
        self.variante = variante
        self.v = VARIANTEN[variante]
        self.ordner = modell_ordner(app_support, variante)
        self._bild = self._text = self._tok = None
        self._lock = threading.Lock()

    def _sitzung(self, datei: str, faeden: int):
        import onnxruntime as ort
        so = ort.SessionOptions()
        so.intra_op_num_threads = faeden
        so.inter_op_num_threads = 1
        so.log_severity_level = 3
        return ort.InferenceSession(str(self.ordner / datei), so, providers=["CPUExecutionProvider"])

    def bild_vektoren(self, bilder: list) -> "object":
        """PIL-Bilder → normierte Vektoren (n × dim, float32). Panoramen werden in Quadrate zerlegt und gemittelt."""
        import numpy as np
        with self._lock:
            if self._bild is None:
                self._bild = self._sitzung("vision.onnx", FAEDEN)
        stuecke, zu = [], []
        for i, im in enumerate(bilder):
            for s in _zuschnitte(im, self.v["px"]):
                stuecke.append(s)
                zu.append(i)
        x = np.stack(stuecke).astype(np.float32)
        aus = np.concatenate([self._bild.run(["pooler_output"], {"pixel_values": x[j:j + STAPEL]})[0]
                              for j in range(0, len(x), STAPEL)])
        aus /= np.linalg.norm(aus, axis=1, keepdims=True)
        erg = np.zeros((len(bilder), aus.shape[1]), dtype=np.float32)
        np.add.at(erg, np.array(zu), aus)
        erg /= np.linalg.norm(erg, axis=1, keepdims=True)
        return erg

    def text_vektor(self, text: str):
        import numpy as np
        with self._lock:
            if self._text is None:
                from tokenizers import Tokenizer
                tok = Tokenizer.from_file(str(self.ordner / "tokenizer.json"))
                tok.enable_padding(length=TEXT_LAENGE, pad_id=0, pad_token="<pad>")
                tok.enable_truncation(max_length=TEXT_LAENGE)
                self._tok = tok
                self._text = self._sitzung("text.onnx", 4)
        ids = np.array([self._tok.encode(text_saeubern(text)).ids], dtype=np.int64)
        v = self._text.run(["pooler_output"], {"input_ids": ids})[0][0]
        return (v / np.linalg.norm(v)).astype(np.float32)

    def wahrscheinlichkeit(self, kos):
        """SigLIP-Bewertung: sigmoid(exp(scale)·cos + bias) — eine echte Wahrscheinlichkeit „Text passt zum Bild"."""
        import numpy as np
        return 1.0 / (1.0 + np.exp(-(math.exp(self.v["scale"]) * kos + self.v["bias"])))


def _zuschnitte(im, px: int) -> list:
    """Ein Bild → Eingaben fürs Modell (3 × px × px, −1…1).

    Normal wie Immich/SigLIP 2: aufs Quadrat stauchen (so ist das Modell trainiert — kein Verlust am Rand). Panoramen
    breiter als 2:1 würden dabei bis zur Unkenntlichkeit gequetscht; die zerlegen wir in überlappende Quadrate über die
    ganze Breite (bzw. Höhe) und mitteln deren Vektoren (s. `bild_vektoren`)."""
    import numpy as np
    from PIL import Image
    if im.mode != "RGB":
        im = im.convert("RGB")
    w, h = im.size
    teile = [im]
    lang, kurz = max(w, h), min(w, h)
    if kurz and lang / kurz > PANORAMA_AB:
        n = math.ceil(lang / kurz)
        teile = []
        for k in range(n):
            o = round(k * (lang - kurz) / (n - 1)) if n > 1 else 0
            teile.append(im.crop((o, 0, o + kurz, kurz) if w >= h else (0, o, kurz, o + kurz)))
    raus = []
    for t in teile:
        a = np.asarray(t.resize((px, px), Image.BICUBIC), dtype=np.float32) / 127.5 - 1.0
        raus.append(a.transpose(2, 0, 1))
    return raus


# ── Index ───────────────────────────────────────────────────────────────────

INDEX_SCHEMA = """
CREATE TABLE IF NOT EXISTS vek (
    path      TEXT PRIMARY KEY,
    inhalt_id TEXT,          -- Größe + Teil-Hash (wie im Fotobestand): erkennt Umbenanntes/Verschobenes wieder
    fp        TEXT,          -- Fingerabdruck beim Indizieren; ändert sich die Datei, wird neu gerechnet
    px        INTEGER,       -- Quellgröße (600 = Vorschau aus der Datei, 220 = nur das kleine Rasterbild)
    vec       BLOB,          -- float16, normiert
    am        REAL
);
CREATE INDEX IF NOT EXISTS idx_vek_inhalt ON vek(inhalt_id);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
"""


def index_oeffnen(pfad: Path) -> sqlite3.Connection:
    pfad = Path(pfad)
    pfad.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(str(pfad), check_same_thread=False, timeout=30.0)
    c.row_factory = sqlite3.Row
    try:
        c.execute("PRAGMA journal_mode=WAL")
    except sqlite3.DatabaseError:
        pass
    c.executescript(INDEX_SCHEMA)
    return c


def _version_hoch(idx: sqlite3.Connection) -> None:
    idx.execute("INSERT INTO meta(k, v) VALUES('version', '1') "
                "ON CONFLICT(k) DO UPDATE SET v = CAST(v AS INTEGER) + 1")


def offene(conn: sqlite3.Connection, idx: sqlite3.Connection) -> tuple:
    """(zu rechnen, aus Doppeln übernehmbar, Index-Stand) — was im Fotobestand steht, aber (so) nicht im Index."""
    bekannt = {r["path"]: (r["fp"], r["px"]) for r in idx.execute("SELECT path, fp, px FROM vek")}
    nach_inhalt = {r["inhalt_id"]: r["path"] for r in idx.execute(
        "SELECT inhalt_id, path FROM vek WHERE inhalt_id IS NOT NULL AND inhalt_id != ''")}
    rechnen, kopieren = [], []
    for r in conn.execute("SELECT path, art, fp, inhalt_id FROM fotos WHERE fehlt_seit IS NULL "
                          "ORDER BY aufnahme_utc DESC NULLS LAST"):
        b = bekannt.get(r["path"])
        if b is not None and (not r["fp"] or not b[0] or b[0] == r["fp"]):
            continue
        quelle = nach_inhalt.get(r["inhalt_id"]) if r["inhalt_id"] else None
        if b is None and quelle and quelle != r["path"]:
            kopieren.append((r["path"], quelle, r["fp"], r["inhalt_id"]))
        else:
            rechnen.append(dict(r))
    return rechnen, kopieren, len(bekannt)


# 05.10.2026 (Audit A-7) — womit die Vektoren gerechnet sind. Stimmt etwas davon nicht mehr (anderes Modell, andere
# Vorverarbeitung, andere Dimension), gelten sie nicht als „bekannt", sondern werden neu gerechnet — sonst lägen Text-
# und Bildvektoren in verschiedenen Räumen und die Treffer wären Rauschen, ohne Fehler. Die Bibliothek zieht um (andere
# App-Version, anderer Rechner) — genau dort trifft es zu.
SCHEMA_STAND = "1"
VORVERARBEITUNG = f"squash{QUELLE_PX}/pano{PANORAMA_AB}"


def index_kennung(variante: str) -> dict:
    v = VARIANTEN[variante]
    return {"schema": SCHEMA_STAND, "repo": v["repo"], "rev": v["rev"], "dim": str(v["dim"]), "vorverarbeitung": VORVERARBEITUNG}


def index_pruefen(idx: sqlite3.Connection, variante: str) -> bool:
    """Index zur Variante passend machen. True, wenn er geleert wurde (falsches Modell/Schema)."""
    soll = index_kennung(variante)
    ist = {r["k"]: r["v"] for r in idx.execute("SELECT k, v FROM meta WHERE k IN (%s)" % ",".join("?" * len(soll)),
                                                list(soll))}
    leer = idx.execute("SELECT COUNT(*) FROM vek").fetchone()[0] == 0
    if ist == soll:
        return False
    geleert = False
    if not leer:
        log.warning("[inhalt] Index passt nicht zum Modell (%s ≠ %s) — wird neu gerechnet", ist, soll)
        idx.execute("DELETE FROM vek")
        _version_hoch(idx)
        geleert = True
    idx.executemany("INSERT INTO meta(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", list(soll.items()))
    idx.commit()
    return geleert


def nachbessern(conn: sqlite3.Connection, idx: sqlite3.Connection, stop: Optional[Callable] = None) -> list:
    """Was nur aus dem kleinen Rasterbild (220 px) indiziert ist, dessen Datei aber jetzt erreichbar ist. Nur Fotos —
    Videos bleiben beim Rasterbild (Audit A-9). Abbrechbar je 100 Pfade: auf einem weggefallenen Netzlaufwerk kann
    jeder `isfile` Sekunden dauern (Audit A-5)."""
    klein = [r["path"] for r in idx.execute("SELECT path FROM vek WHERE px < ?", (QUELLE_PX,))]
    if not klein:
        return []
    raus = []
    for i, p in enumerate(klein):
        if i % 100 == 0 and stop and stop():
            break
        r = conn.execute("SELECT path, art, fp, inhalt_id FROM fotos WHERE path = ?", (p,)).fetchone()
        if r and r["art"] != "video" and os.path.isfile(p):
            raus.append(dict(r))
    return raus


def _bild_holen(path: str, fp: Optional[str], art: str = "foto") -> tuple:
    """(PIL-Bild, Quellgröße) — 600er-Vorschau aus dem Cache, sonst aus der Datei (nur im Speicher: 600er für
    170.000 Fotos wären ~12 GB Cache), sonst das kleine Rasterbild, wenn das Laufwerk gerade weg ist.
    Videos (Audit A-9, 05.10.2026): nur über ihr Rasterbild (220 px, wird bei Bedarf einmal erzeugt und liegt dann auch
    für die Ansicht im Cache) — ein 600er-Standbild hieße je Video ffmpeg über das ganze Netz."""
    from PIL import Image
    from core import photos as cphotos
    if art == "video":
        daten = cphotos.thumb_gecacht(path, cphotos.THUMB_RASTER_PX, fp, nur_cache=not os.path.isfile(path))
        px = cphotos.THUMB_RASTER_PX
    else:
        daten = cphotos.thumb_gecacht(path, QUELLE_PX, fp, nur_cache=True)
        px = QUELLE_PX
        if not daten and os.path.isfile(path):
            daten = cphotos._thumb_bytes_fuer(path, QUELLE_PX)
        if not daten:
            daten = cphotos.thumb_gecacht(path, cphotos.THUMB_RASTER_PX, fp, nur_cache=True)
            px = cphotos.THUMB_RASTER_PX
    if not daten:
        return None, 0
    im = Image.open(io.BytesIO(daten))
    im.load()
    # Videos zählen als „fertig", auch mit 220 px — sonst bessert `nachbessern` sie nie aus
    return im, (QUELLE_PX if art == "video" else px)


def indizieren(conn: sqlite3.Connection, idx: sqlite3.Connection, modell: Modell,
               fortschritt: Optional[Callable] = None, stop: Optional[Callable] = None,
               pause: Optional[Callable] = None) -> dict:
    """Alles Offene in den Index rechnen. Stapelweise, abbrechbar; `pause()` → True hält an (Render läuft)."""
    import numpy as np
    dim = int(modell.v["dim"])
    rechnen, kopieren, schon = offene(conn, idx)
    for path, quelle, fp, _iid in kopieren:
        idx.execute("INSERT OR REPLACE INTO vek(path, inhalt_id, fp, px, vec, am) "
                    "SELECT ?, inhalt_id, ?, px, vec, ? FROM vek WHERE path = ?", (path, fp, time.time(), quelle))
    if kopieren:
        _version_hoch(idx)
        idx.commit()
    if stop and stop():
        return {"abbruch": True, "fertig": 0, "gesamt": len(rechnen), "fehler": 0, "ohne_bild": 0}
    bekannt_rechnen = {x["path"] for x in rechnen}
    rechnen += [r for r in nachbessern(conn, idx, stop) if r["path"] not in bekannt_rechnen]
    gesamt = len(rechnen)
    fertig = fehler = ohne = 0
    if fortschritt:
        fortschritt(0, gesamt, schon + len(kopieren))
    STUECK = 32
    for i in range(0, gesamt, STUECK):
        while pause and pause():
            if stop and stop():
                break
            time.sleep(2.0)
        if stop and stop():
            return {"abbruch": True, "fertig": fertig, "gesamt": gesamt, "fehler": fehler, "ohne_bild": ohne}
        teil = rechnen[i:i + STUECK]
        bilder, zeilen = [], []
        for r in teil:
            try:
                im, px = _bild_holen(r["path"], r.get("fp"), r.get("art") or "foto")
            except Exception as e:  # noqa: BLE001
                log.debug("[inhalt] Bild %s: %s", r["path"], e)
                im, px = None, 0
            if im is None:
                ohne += 1
                continue
            bilder.append(im)
            zeilen.append((r, px))
        if bilder:
            try:
                vek = modell.bild_vektoren(bilder)
            except Exception as e:  # noqa: BLE001
                log.warning("[inhalt] Stapel fehlgeschlagen (%s) — einzeln weiter", e)
                vek = []
                for b in bilder:
                    try:
                        vek.append(modell.bild_vektoren([b])[0])
                    except Exception:  # noqa: BLE001
                        vek.append(None)
                        fehler += 1
            jetzt = time.time()
            for (r, px), v in zip(zeilen, vek):
                # Audit A-2: nie einen Vektor fremder Länge in diesen Index — ein einziger macht ihn unlesbar
                if v is None or len(v) != dim:
                    fehler += 0 if v is None else 1
                    continue
                idx.execute("INSERT OR REPLACE INTO vek(path, inhalt_id, fp, px, vec, am) VALUES(?,?,?,?,?,?)",
                            (r["path"], r.get("inhalt_id"), r.get("fp"), px,
                             np.asarray(v, dtype=np.float16).tobytes(), jetzt))
            _version_hoch(idx)
            idx.commit()
        fertig += len(teil)
        if fortschritt:
            fortschritt(fertig, gesamt, schon + len(kopieren))
    return {"fertig": fertig, "gesamt": gesamt, "fehler": fehler, "ohne_bild": ohne}


def index_stand(idx: sqlite3.Connection) -> dict:
    r = idx.execute("SELECT COUNT(*) n, SUM(px < ?) klein, SUM(LENGTH(vec)) bytes FROM vek", (QUELLE_PX,)).fetchone()
    return {"n": int(r["n"] or 0), "klein": int(r["klein"] or 0), "bytes": int(r["bytes"] or 0)}


def bereinigen(conn: sqlite3.Connection, idx: sqlite3.Connection, stop: Optional[Callable] = None) -> int:
    """Einträge zu Dateien, die es im Fotobestand gar nicht mehr gibt (Ordner entfernt), wegräumen."""
    da = {r[0] for r in conn.execute("SELECT path FROM fotos")}
    if stop and stop():
        return 0
    weg = [p for (p,) in idx.execute("SELECT path FROM vek") if p not in da]
    for i in range(0, len(weg), 500):
        t = weg[i:i + 500]
        idx.execute("DELETE FROM vek WHERE path IN (%s)" % ",".join("?" * len(t)), t)
    if weg:
        _version_hoch(idx)
        idx.commit()
    return len(weg)


# ── Suchen ──────────────────────────────────────────────────────────────────

class Stand:
    """Unveränderliche Momentaufnahme (Audit A-4): Pfade, Positionen und Matrix gehören zusammen. Wer sucht, rechnet
    auf genau einem Stand — ein paralleles Nachladen tauscht nur den Verweis aus, nie einzelne Teile."""
    __slots__ = ("pfade", "pos", "m")

    def __init__(self, pfade: list, m):
        self.pfade = pfade
        self.pos = {p: i for i, p in enumerate(pfade)}
        self.m = m

    def vektor(self, path: str):
        i = self.pos.get(path)
        return None if i is None else self.m[i].astype("float32")


class Matrix:
    """Alle Vektoren im Speicher (170.000 × 768 × fp16 ≈ 260 MB). Neu geladen, wenn sich der Index geändert hat —
    während des Indizierens höchstens alle NEU_S Sekunden, damit Suchen dabei nicht ständig nachlädt.
    Geladen wird in eine vorher angelegte Matrix (Audit A-8: vorher Liste aller Blobs + ein zusammengeklebter Block
    = 2,2 × Speicher, bei 400.000 Fotos ~1,4 GB Spitze). Zeilen anderer Länge werden übersprungen (A-2)."""
    NEU_S = 20.0

    def __init__(self):
        import numpy as np
        self._stand = Stand([], np.zeros((0, 1), dtype=np.float16))
        self._version = None
        self._geladen = 0.0
        self._lock = threading.Lock()

    def aktuell(self, idx: sqlite3.Connection, dim: int) -> Stand:
        import numpy as np
        with self._lock:
            r = idx.execute("SELECT v FROM meta WHERE k = 'version'").fetchone()
            ver = r[0] if r else "0"
            st = self._stand
            if self._version is not None and st.m.shape[1] == dim and (
                    ver == self._version or time.time() - self._geladen < self.NEU_S):
                return st
            n = idx.execute("SELECT COUNT(*) FROM vek").fetchone()[0]
            m = np.empty((n, dim), dtype=np.float16)
            pfade = []
            soll = dim * 2
            for path, vec in idx.execute("SELECT path, vec FROM vek"):
                if len(pfade) >= n or vec is None or len(vec) != soll:
                    continue
                m[len(pfade)] = np.frombuffer(vec, dtype=np.float16)
                pfade.append(path)
            self._stand = Stand(pfade, m[:len(pfade)])
            self._version, self._geladen = ver, time.time()
            return self._stand


# Treffer-Schwellen. Text→Bild: SigLIP-Wahrscheinlichkeit; dazu nie mehr als MAX_TREFFER und nicht weiter als
# ABSTAND unter dem besten Treffer (sonst bringt eine seltene Anfrage hunderte Zufallstreffer). Bild→Bild: Kosinus.
# Werte vom Prüfstand (tests/pruefstand_inhaltssuche.py) — dort nachmessen, bevor sie geändert werden.
# Geeicht am 04.10.2026 auf Marcs Archiv (17.086 Fotos, Mac mini): bei „Sonnenuntergang" sind bis p ≈ 0,01 (Rang ~150)
# fast nur echte Sonnenuntergänge, bei p ≈ 0,004 (Rang ~400) nur noch Zufall; „Gletscher" (keine im Ausschnitt) hat
# als besten Treffer p = 0,019. Vorher 0,001 → 782 Treffer, die meisten Rauschen.
MIN_WAHRSCH = 0.01
ABSTAND = 0.05
# „Ähnliche Fotos" (05.10.2026, Audit K-11, Marc: „was schlägst du vor?"): an drei Proben aus dem Prüfstand (17.086
# Fotos) passen die Bilder bis Kosinus ~0,75 noch (Blüten → Blüten, Laub → Laub, Plattenbau → Plattenbau); ab 0,70 galten
# aber 364–728 Fotos als ähnlich. Deshalb 0,75 und höchstens 100, die ähnlichsten zuerst.
AEHNLICH_MIN = 0.75
AEHNLICH_MAX = 100
MAX_TREFFER = 1500


def rangliste_text(modell: Modell, stand: Stand, text: str) -> list:
    """[(path, punkte)] absteigend — Punkte 0…1 (SigLIP-Wahrscheinlichkeit)."""
    import numpy as np
    if stand.m is None or not len(stand.pfade) or not text_saeubern(text):
        return []
    t = modell.text_vektor(text)
    if len(t) != stand.m.shape[1]:
        return []
    kos = _block_mal(stand.m, t)
    top = np.argsort(-kos)[:MAX_TREFFER]
    if not len(top):
        return []
    beste = float(kos[top[0]])
    w = modell.wahrscheinlichkeit(kos[top])
    return [(stand.pfade[i], float(p)) for i, p in zip(top, w)
            if p >= MIN_WAHRSCH and kos[i] >= beste - ABSTAND]


def rangliste_aehnlich(stand: Stand, path: str) -> list:
    import numpy as np
    v = stand.vektor(path)
    if v is None:
        return []
    kos = _block_mal(stand.m, v)
    top = np.argsort(-kos)[:AEHNLICH_MAX]
    return [(stand.pfade[i], float(kos[i])) for i in top if kos[i] >= AEHNLICH_MIN]


def _block_mal(m, v):
    """m @ v in Blöcken — erspart eine float32-Vollkopie der ganzen Matrix."""
    import numpy as np
    raus = np.empty(m.shape[0], dtype=np.float32)
    for i in range(0, m.shape[0], 20000):
        raus[i:i + 20000] = m[i:i + 20000].astype(np.float32) @ v
    return raus


def loeschen(app_support: Path, bib: Path, variante: Optional[str] = None) -> dict:
    """Modell(e) und Index(e) entfernen (Einstellungen → „Löschen"). Ohne `variante`: alle."""
    namen = [variante] if variante else list(VARIANTEN)
    frei = 0
    for v in namen:
        d = modell_ordner(app_support, v)
        # 05.10.2026 (Audit K-13) — über den Dateischutz: Modell = neu ladbar, Index = neu rechenbar → ART_CACHE
        # (keine Kopie im Papierkorb; ein Index für 400.000 Fotos wären ~600 MB)
        if d.is_dir():
            frei += sum(f.stat().st_size for f in d.rglob("*") if f.is_file())
            _ds.ordner_loeschen(d, "inhalt_loeschen", art=_ds.ART_CACHE, ignore_errors=True)
        for p in (index_pfad(bib, v), Path(str(index_pfad(bib, v)) + "-wal"), Path(str(index_pfad(bib, v)) + "-shm")):
            if p.is_file():
                frei += p.stat().st_size
                _ds.loeschen(p, "inhalt_loeschen", art=_ds.ART_CACHE)
    return {"ok": True, "frei": frei}


def ordner_groesse(app_support: Path, bib: Path, variante: str) -> dict:
    d = modell_ordner(app_support, variante)
    m = sum(f.stat().st_size for f in d.rglob("*") if f.is_file()) if d.is_dir() else 0
    i = index_pfad(bib, variante)
    return {"modell": m, "index": i.stat().st_size if i.is_file() else 0}


def meta_lesen(idx: sqlite3.Connection, k: str, vorgabe=None):
    r = idx.execute("SELECT v FROM meta WHERE k = ?", (k,)).fetchone()
    return json.loads(r[0]) if r and r[0] and r[0][:1] in "[{\"" else (r[0] if r else vorgabe)
