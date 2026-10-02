#!/usr/bin/env python3
"""Hausmusik fürs Schnell-Video: ein selbst erzeugtes, nahtlos loopendes Stück + ein Foto-Klick (02.10.2026).

Marc: „Bereite auch die Musik vor und komponiere direkt erstmal ein Stück, das endlos läuft, das man drunter
legen kann. Mache dann noch direkt so einen Klicksound, wenn ein Foto kommt."

Alles hier wird aus Zahlen erzeugt (keine Samples, keine fremden Aufnahmen) → keine Lizenzfrage.
Nahtlos: jede Note wird modulo Stücklänge in den Puffer gelegt (Ausklänge wandern an den Anfang), der Hall läuft
über drei aneinandergehängte Durchgänge, genommen wird der mittlere — so passt das Ende sample-genau an den Anfang.

Aufruf:  .venv/bin/python scripts/musik_komponieren.py   → ui/audio/musik_unterwegs.flac, ui/audio/foto_klick.wav (ui/ kommt ganz ins Bundle)
"""
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np

SR = 44100
BPM = 96
SCHLAG = 60 / BPM
TAKT = 4 * SCHLAG
TAKTE = 16
L = int(round(TAKTE * TAKT * SR))
RNG = np.random.default_rng(20261002)
ZIEL = Path(__file__).resolve().parent.parent / "ui" / "audio"


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def lege(puffer, start_s, sig, pan=0.0):
    """Stereo-Signal (oder Mono mit Pan) modulo Länge in den Loop-Puffer legen."""
    if sig.ndim == 1:
        li, re = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
        sig = np.stack([sig * li, sig * re], axis=1)
    i0 = int(round(start_s * SR)) % L
    n = len(sig)
    pos = 0
    while pos < n:
        a = (i0 + pos) % L
        k = min(n - pos, L - a)
        puffer[a:a + k] += sig[pos:pos + k]
        pos += k


def huelle(n, a, d, s, r, dauer):
    t = np.arange(n) / SR
    e = np.where(t < a, t / max(a, 1e-6), 1.0)
    e = np.where((t >= a) & (t < a + d), 1 - (1 - s) * (t - a) / max(d, 1e-6), e)
    e = np.where((t >= a + d) & (t < dauer), s, e)
    e = np.where(t >= dauer, s * np.exp(-(t - dauer) / max(r, 1e-6) * 4), e)
    return e


# ── Instrumente ────────────────────────────────────────────────────────────────────────────────────────────
def pad(midi, dauer):
    n = int((dauer + 1.6) * SR)
    t = np.arange(n) / SR
    out = np.zeros((n, 2))
    for kanal, verstimm in ((0, -4), (1, 4)):
        f = hz(midi) * 2 ** (verstimm / 1200)
        s = sum(np.sin(2 * np.pi * f * h * t + h) / h ** 1.6 for h in range(1, 7))
        s += 0.5 * np.sin(2 * np.pi * f * 1.003 * t)
        out[:, kanal] = s
    langsam = 1 + 0.15 * np.sin(2 * np.pi * 0.2 * t)          # leichtes Atmen
    return out * (huelle(n, 0.6, 0.4, 0.8, 1.4, dauer) * langsam)[:, None] * 0.05


def zupf(midi, dauer=1.4, hell=0.5):
    """Karplus-Strong: klingt wie eine leise gezupfte Gitarre."""
    f = hz(midi)
    n = int(dauer * SR)
    p = max(2, int(SR / f))
    buf = RNG.uniform(-1, 1, p)
    buf = np.convolve(buf, [0.5, 0.5], mode="same") * (0.6 + 0.4 * hell)
    daempf = 0.996
    bloecke = [buf]
    while len(bloecke) * p < n:                     # Periode für Periode vektorisiert: y[i] = d·½(y[i−p] + y[i−p+1])
        v = bloecke[-1]
        neu = np.empty(p)
        neu[:-1] = daempf * 0.5 * (v[:-1] + v[1:])
        neu[-1] = daempf * 0.5 * (v[-1] + neu[0])
        bloecke.append(neu)
    out = np.concatenate(bloecke)[:n]
    out *= np.exp(-np.arange(n) / SR * 1.8)
    return out * 0.32


def bass(midi, dauer):
    n = int((dauer + 0.3) * SR)
    t = np.arange(n) / SR
    f = hz(midi)
    s = np.sin(2 * np.pi * f * t) + 0.25 * np.sin(4 * np.pi * f * t) + 0.08 * np.sin(6 * np.pi * f * t)
    return s * huelle(n, 0.01, 0.15, 0.7, 0.25, dauer) * 0.30


def glocke(midi, dauer=2.2):
    n = int(dauer * SR)
    t = np.arange(n) / SR
    f = hz(midi)
    mod = 2.2 * np.exp(-t * 3) * np.sin(2 * np.pi * f * 3.5 * t)
    s = np.sin(2 * np.pi * f * t + mod)
    return s * np.exp(-t * 1.6) * np.minimum(1, t / 0.004) * 0.13


def kick():
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    f = 48 + 70 * np.exp(-t * 30)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-t * 9) * 0.42


def rausch(dauer, abfall, hoch=True):
    n = int(dauer * SR)
    t = np.arange(n) / SR
    s = RNG.normal(0, 1, n)
    if hoch:                                    # Hochpass erster Ordnung, grob
        s = np.diff(s, prepend=0)
    return s * np.exp(-t * abfall)


def hihat(laut):
    return rausch(0.09, 55) * 0.045 * laut


def rim():
    s = rausch(0.12, 35, hoch=False)
    s = np.convolve(s, np.ones(6) / 6, mode="same")
    t = np.arange(len(s)) / SR
    return (s * 0.10 + 0.06 * np.sin(2 * np.pi * 330 * t) * np.exp(-t * 40))


# ── Satz ───────────────────────────────────────────────────────────────────────────────────────────────────
# Akkorde je Takt (Grundton MIDI, Dreiklang-Intervalle)
DUR, MOLL = (0, 4, 7), (0, 3, 7)
AKK = [(48, DUR), (43, DUR), (45, MOLL), (41, DUR), (48, DUR), (43, DUR), (41, DUR), (43, DUR),
       (45, MOLL), (41, DUR), (48, DUR), (43, DUR), (45, MOLL), (41, DUR), (43, DUR), (43, DUR)]
# Melodie (Takt, Schlag, MIDI) — C-Dur-Pentatonik, erst in der zweiten Hälfte, sparsam
MELODIE = [(8, 0, 76), (8, 2.5, 79), (9, 1, 81), (9, 3, 79), (10, 0, 76), (10, 2, 74), (11, 0, 74), (11, 1.5, 72),
           (12, 0, 72), (12, 2, 76), (13, 0, 77), (13, 2.5, 76), (14, 0, 74), (14, 2, 79), (15, 0, 79), (15, 2, 76)]


def komponieren():
    dry = np.zeros((L, 2))
    for takt, (grund, iv) in enumerate(AKK):
        t0 = takt * TAKT
        for i in iv:                                            # Fläche eine Oktave über dem Bass
            lege(dry, t0, pad(grund + 12 + i, TAKT * 0.98))
        lege(dry, t0, bass(grund - 12, SCHLAG * 1.6), pan=0)
        lege(dry, t0 + 2.5 * SCHLAG, bass(grund - 12, SCHLAG * 1.2), pan=0)
        muster = [0, 1, 2, 3, 2, 1, 2, 3]                        # Zupf-Arpeggio in Achteln
        ton = [grund + 12 + iv[0], grund + 12 + iv[1], grund + 12 + iv[2], grund + 24 + iv[0]]
        for a, m in enumerate(muster):
            lege(dry, t0 + a * SCHLAG / 2, zupf(ton[m], hell=0.8 if a % 2 == 0 else 0.5), pan=0.35 if a % 2 else 0.15)
        lege(dry, t0, kick(), 0)                                 # Schlagzeug leise
        lege(dry, t0 + 2 * SCHLAG, kick() * 0.8, 0)
        for s in (1, 3):
            lege(dry, t0 + s * SCHLAG, rim(), -0.2)
        for a in range(8):
            lege(dry, t0 + a * SCHLAG / 2 + (0.012 if a % 2 else 0), hihat(1.0 if a % 2 else 0.6), 0.45)
    for takt, schlag, m in MELODIE:
        lege(dry, takt * TAKT + schlag * SCHLAG, glocke(m), -0.3)
    # Hall (Schroeder) über drei Durchgänge, mittlerer zählt → nahtlos
    drei = np.concatenate([dry, dry, dry])
    nass = np.zeros_like(drei)
    for kanal, versatz in ((0, 0), (1, 23)):
        x = drei[:, kanal]
        y = np.zeros_like(x)
        for d, g in ((1557, 0.80), (1617, 0.79), (1491, 0.81), (1422, 0.80)):
            d += versatz
            c = np.zeros_like(x)
            for start in range(0, len(x), d):                   # Kammfilter blockweise (vektorisiert je Block)
                ende = min(start + d, len(x))
                c[start:ende] = x[start:ende] + (g * c[start - d:ende - d] if start >= d else 0)
            y += c / 4
        for d, g in ((225, 0.5), (556, 0.5)):
            a = np.zeros_like(y)
            for start in range(0, len(y), d):                   # Allpass blockweise: a[i] = −g·y[i] + y[i−d] + g·a[i−d]
                ende = min(start + d, len(y))
                a[start:ende] = -g * y[start:ende] + ((y[start - d:ende - d] + g * a[start - d:ende - d]) if start >= d else 0)
            y = a
        nass[:, kanal] = y
    misch = drei + 0.22 * nass
    mitte = misch[L:2 * L]
    mitte = np.tanh(mitte * 1.4) / 1.4                          # sanft zusammenhalten
    mitte /= np.max(np.abs(mitte)) / 10 ** (-1.5 / 20)            # Spitze −1,5 dBFS
    return mitte


def klick():
    """Kamera-Auslöser: zwei kurze mechanische Transienten + ein Hauch Rauschen, ~120 ms."""
    n = int(0.14 * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for ab, f, laut in ((0.0, 2400, 1.0), (0.055, 1700, 0.7)):
        i = int(ab * SR)
        tt = t[: n - i]
        tick = (RNG.normal(0, 1, len(tt)) * np.exp(-tt * 260) * 0.6
                + np.sin(2 * np.pi * f * tt) * np.exp(-tt * 180))
        out[i:] += tick * laut
    out += np.convolve(RNG.normal(0, 1, n), np.ones(4) / 4, mode="same") * np.exp(-t * 40) * 0.08
    out /= np.max(np.abs(out)) / 10 ** (-3 / 20)
    return np.stack([out, out], axis=1)


def wav_schreiben(pfad, x):
    x16 = (np.clip(x, -1, 1) * 32767).astype("<i2")
    with wave.open(str(pfad), "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(x16.tobytes())


def main():
    ZIEL.mkdir(parents=True, exist_ok=True)
    m = komponieren()
    tmp = ZIEL / "_musik_unterwegs.wav"
    wav_schreiben(tmp, m)
    flac = ZIEL / "musik_unterwegs.flac"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(tmp), "-c:a", "flac", "-compression_level", "8", str(flac)], check=True)
    tmp.unlink()
    wav_schreiben(ZIEL / "foto_klick.wav", klick())
    rms = 20 * np.log10(np.sqrt(np.mean(m ** 2)))
    sprung = np.max(np.abs(m[0] - m[-1]))
    print(f"Musik {L / SR:.2f} s, RMS {rms:.1f} dBFS, Naht-Sprung {sprung:.4f} → {flac.name} ({flac.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    sys.exit(main())
