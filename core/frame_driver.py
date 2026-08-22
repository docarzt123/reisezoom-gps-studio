"""Gemeinsamer Bild-für-Bild-Treiber für alle Video-Renderer (22.08.2026).

Animator (Einzel- und Mehrspur) und Höhen-Animator hatten je eine eigene Kopie
derselben ffmpeg-Lebenslaufs: Prozess starten, stderr leerlesen, Bilder in die
Pipe schreiben, bei Abbruch/Fehler Prozess beenden und Teildatei wegräumen,
am Ende mit Zeitgrenze warten, Rückgabewert prüfen, Teildatei an ihren Platz
schieben. Drei Kopien hieß: jeder Fix (Teildatei `.rzpart`, Windows-EINVAL,
Zeitgrenze, Zombie-ffmpeg) musste dreimal gemacht werden — und wurde es nicht
immer (Audit 22.08.2026 fand den Höhen-Animator zweimal hinterher).

`FrameMuxer` ist dieser Lebenslauf, einmal. Die Frame-Schleifen selbst (Kamera,
Diagramm-Fortschritt) bleiben in den Modulen — die sind wirklich verschieden.

    mux = FrameMuxer(ffmpeg_cmd, cfg.output_path, total_frames)
    try:
        for frame in ...:
            mux.schreiben(shot, frame + 1)
    except BaseException:
        mux.abbrechen()          # Prozess weg, Teildatei weg
        raise
    mux.abschliessen(is_cancelled)   # warten, prüfen, Teildatei → Ziel
"""
from __future__ import annotations

import logging
import os
import subprocess
import threading
from pathlib import Path
from typing import Callable, Optional

_log = logging.getLogger("frame_driver")

_WIN_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0

# ffmpeg schreibt WÄHREND des Renderns in eine Nachbardatei, nicht an den vom
# Nutzer gewählten Platz. Erst der fertige Film wird dorthin geschoben — so
# liegt am Ziel nie ein abgeschnittener Torso (siehe core/animator.py).
TEIL = ".rzpart"


class RenderCancelled(Exception):
    """Vom Nutzer abgebrochen. Die Module führen eigene Unterklassen/Aliasse."""


def teildatei(ziel: str) -> str:
    """Arbeitsname neben dem Ziel — gleicher Ordner, damit das Umbenennen auf
    derselben Platte bleibt und in einem Rutsch geschieht."""
    return f"{ziel}{TEIL}"


def fertigstellen(ziel: str) -> None:
    teil = teildatei(ziel)
    if os.path.exists(teil):
        os.replace(teil, ziel)


def teil_wegraeumen(ziel: str) -> None:
    try:
        Path(teildatei(ziel)).unlink(missing_ok=True)
    except Exception:       # noqa: BLE001 — Aufräumen darf den echten Fehler nie verdecken
        pass


def drain_stderr(pipe):
    """stderr eines Subprozesses fortlaufend in einem Thread leerlesen — sonst
    blockiert ffmpeg, sobald es > 64 KB meldet (Platte voll), liest stdin nicht
    mehr und `stdin.write(frame)` hängt für immer."""
    buf = bytearray()

    def _run():
        try:
            for chunk in iter(lambda: pipe.read(65536), b""):
                buf.extend(chunk)
        except Exception:
            pass

    th = threading.Thread(target=_run, daemon=True, name="ffmpeg-stderr")
    th.start()
    return th, buf


def ffmpeg_gestorben(ff, err_th, err_buf, frame: int, total: int, out_path: str) -> RuntimeError:
    """ffmpeg ist mitten im Schreiben verschwunden — seine Begründung retten.
    (Ein Nutzer schickte sechs Berichte mit nacktem „Broken pipe"; warum, stand
    nirgends. Deshalb Ausgabedatei und ffmpeg-Text mit in die Meldung.)"""
    try:
        err_th.join(timeout=2)
    except Exception:
        pass
    err = bytes(err_buf).decode(errors="replace").strip()
    rc = ff.poll()
    _log.error("ffmpeg starb bei Frame %d/%d (returncode=%s), Ziel: %s\nffmpeg-Ausgabe:\n%s",
               frame, total, rc, out_path, err or "(keine — vermutlich von außen beendet)")
    if err:
        return RuntimeError(f"ffmpeg brach ab (Frame {frame}/{total}): {err.splitlines()[-1][:300]}")
    return RuntimeError(
        f"ffmpeg brach bei Frame {frame}/{total} ohne Meldung ab. Häufigste "
        f"Ursachen: ein Virenscanner blockiert das Schreiben, das Ziel liegt "
        f"auf einem Netz-/Wechsellaufwerk oder die Platte ist voll. "
        f"Ziel war: {out_path}")


# Endung → ffmpeg-Muxer. ⚠️ Ohne ausdrückliches `-f` scheitert JEDER Render:
# ffmpeg kann aus der Teildatei `…mp4.rzpart` kein Format ableiten. Der
# Höhen-Animator hatte genau das vergessen (E2E-Test 22.08.2026) — deshalb
# setzt der Treiber das Format jetzt selbst, wenn der Befehl keins trägt.
MUXER = {".mp4": "mp4", ".m4v": "mp4", ".mov": "mov", ".mkv": "matroska",
         ".webm": "webm", ".avi": "avi", ".gif": "gif", ".png": "image2", ".jpg": "image2"}


def muxer_fuer(ziel: str) -> str:
    """Das Ausgabeformat, das ffmpeg sonst aus der Endung raten würde —
    gerechnet auf dem ECHTEN Ziel (`…mp4`), nicht auf der Teildatei."""
    return MUXER.get(Path(ziel).suffix.lower(), "mp4")


class FrameMuxer:
    """Ein ffmpeg-Prozess, der Bilder über stdin entgegennimmt."""

    def __init__(self, ffmpeg_cmd: list[str], output_path: str, total_frames: int,
                 *, log: Optional[logging.Logger] = None,
                 cancelled_cls: type[BaseException] = RenderCancelled):
        self.output_path = output_path
        self.total_frames = max(1, int(total_frames))
        self.log = log or _log
        self.cancelled_cls = cancelled_cls
        self.geschrieben = 0
        self.abgeschlossen = False
        teil_wegraeumen(output_path)
        cmd = list(ffmpeg_cmd)
        if cmd and cmd[-1] == teildatei(output_path):
            cmd.pop()
        if "-f" not in cmd[max(0, len(cmd) - 3):]:      # kein Ausgabeformat gesetzt
            cmd += ["-f", muxer_fuer(output_path)]
        cmd.append(teildatei(output_path))
        self.cmd = cmd
        self.log.info("ffmpeg-Cmd: %s", " ".join(cmd))
        self.ff = subprocess.Popen(cmd, stdin=subprocess.PIPE,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                                   creationflags=_WIN_NO_WINDOW)
        self._err_th, self._err_buf = drain_stderr(self.ff.stderr)

    # ── Bilder ───────────────────────────────────────────────────────────
    def schreiben(self, shot: bytes, frame: int | None = None) -> None:
        """Ein kodiertes Bild (PNG/JPEG) in die Pipe. Stirbt ffmpeg dabei,
        kommt ein RuntimeError MIT seiner Begründung."""
        try:
            self.ff.stdin.write(shot)
        except (BrokenPipeError, OSError):   # Windows: EINVAL statt BrokenPipe
            raise ffmpeg_gestorben(self.ff, self._err_th, self._err_buf,
                                   frame or (self.geschrieben + 1), self.total_frames,
                                   teildatei(self.output_path)) from None
        self.geschrieben += 1

    # ── Ende ─────────────────────────────────────────────────────────────
    def _stdin_zu(self) -> None:
        try:
            self.ff.stdin.close()
        except Exception:
            pass

    def abbrechen(self, grund: str = "") -> None:
        """Abbruch ODER Fehler: Prozess beenden, Teildatei weg. Das endgültige
        Ziel bleibt unangetastet — dort könnte ein älteres Video liegen."""
        if grund:
            self.log.info("Render beendet (%s) — ffmpeg wird beendet und Teildatei gelöscht.", grund)
        self._stdin_zu()
        try:
            self.ff.terminate()
            self.ff.wait(timeout=3)
        except Exception:
            try:
                self.ff.kill()
            except Exception:
                pass
        teil_wegraeumen(self.output_path)

    def abschliessen(self, is_cancelled: Optional[Callable[[], bool]] = None,
                     max_s: int = 600) -> None:
        """Pipe schließen, auf ffmpeg warten (mit Zeitgrenze + Abbruch-Check),
        Rückgabewert prüfen, Teildatei an ihren Platz."""
        self._stdin_zu()
        ff = self.ff
        for _ in range(max_s):
            try:
                ff.wait(timeout=1)
                break
            except subprocess.TimeoutExpired:
                if is_cancelled and is_cancelled():
                    try:
                        ff.terminate()
                    except Exception:
                        pass
                    teil_wegraeumen(self.output_path)
                    raise self.cancelled_cls("Vom User abgebrochen") from None
        else:
            try:
                ff.kill()
            except Exception:
                pass
            teil_wegraeumen(self.output_path)
            raise RuntimeError(f"ffmpeg hat die Datei nicht fertiggestellt (Zeitgrenze {max_s // 60} min).")
        try:
            self._err_th.join(timeout=2)
        except Exception:
            pass
        err = bytes(self._err_buf).decode(errors="replace").strip()
        if ff.returncode != 0:
            self.log.error("ffmpeg returncode=%s — stderr:\n%s", ff.returncode, err)
            teil_wegraeumen(self.output_path)
            raise RuntimeError(f"ffmpeg fehlgeschlagen (returncode={ff.returncode}): {err[:500]}")
        if err:
            self.log.info("ffmpeg stderr (info-level): %s", err[:1500])
        fertigstellen(self.output_path)
        self.abgeschlossen = True
        try:
            sz = Path(self.output_path).stat().st_size
            self.log.info("Output OK: %s (%.1f MB)", self.output_path, sz / 1_000_000)
        except Exception as e:
            self.log.warning("Konnte Output-Datei nicht stat()en: %s", e)
