#!/usr/bin/env python3
"""Fünf weitere Stücke in verschiedenen Stilen + drei Foto-Klicks zur Auswahl (02.10.2026).

Marc: „Probiere nochmal einen anderen Klicksound und mach auch gleich nochmal andere Musik. Komponiere einfach fünf
verschiedene Musikstücke in verschiedenen Stilen und zeig mir die alle."

Wie scripts/musik_komponieren.py („Unterwegs"): alles aus Zahlen, keine Samples → keine Lizenzfrage; jedes Stück loopt
nahtlos (Noten modulo Länge, Hall über drei Durchgänge, der mittlere zählt).

  weite        ruhig, filmisch — Flächen, Klavier, kein Schlagzeug            70 BPM, D-Dur
  gipfelsturm  treibender Indie-Elektro-Pop — Kick auf jedem Schlag, Synth     118 BPM, A-Moll
  rast         Lo-Fi / Chillhop — E-Piano-Septakkorde, swingende Beats, Knistern 84 BPM, F-Dur
  grat         episch — Streicher, Pauken, Bläser-Schwellen                    90 BPM, D-Moll
  wanderlied   akustischer Folk — gezupfte Gitarre, Shaker, Pfeif-Melodie     100 BPM, G-Dur

Aufruf:  .venv/bin/python scripts/musik_stile.py [Vorhör-Ordner für MP3s] [--klicks]
         → ui/audio/musik_<name>.flac, ui/audio/foto_klick_<a|b|c>.wav
"""
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np

SR = 44100
ZIEL = Path(__file__).resolve().parent.parent / "ui" / "audio"


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


# ── Werkzeuge ─────────────────────────────────────────────────────────────────────────────────────────────
def lege(buf, t, sig, pan=0.0):
    """Mono (mit Pan) oder Stereo modulo Länge in den Loop-Puffer legen."""
    L = len(buf)
    if sig.ndim == 1:
        a = (pan + 1) * np.pi / 4
        sig = np.stack([sig * np.cos(a), sig * np.sin(a)], axis=1)
    i0 = int(round(t * SR)) % L
    pos = 0
    while pos < len(sig):
        a = (i0 + pos) % L
        k = min(len(sig) - pos, L - a)
        buf[a:a + k] += sig[pos:pos + k]
        pos += k


def adsr(n, a, d, s, r, halten):
    t = np.arange(n) / SR
    e = np.ones(n)
    e = np.where(t < a, t / max(a, 1e-6), e)
    e = np.where((t >= a) & (t < a + d), 1 - (1 - s) * (t - a) / max(d, 1e-6), e)
    e = np.where((t >= a + d) & (t < halten), s, e)
    return np.where(t >= halten, s * np.exp(-(t - halten) / max(r, 1e-6) * 3), e)


def filt(x, tief=None, hoch=None, ordnung=4):
    """Frequenzfilter über FFT (für kurze Noten und ganze Spuren gleichermaßen)."""
    n = len(x)
    X = np.fft.rfft(x, n=n)
    f = np.fft.rfftfreq(n, 1 / SR)
    H = np.ones_like(f)
    if tief:
        H = H / (1 + (f / tief) ** ordnung)
    if hoch:
        H = H * (1 - 1 / (1 + (f / hoch) ** ordnung))
    return np.fft.irfft(X * H, n=n)


def saege(f, n, verstimm=0.0, harm=30):
    t = np.arange(n) / SR
    f = f * 2 ** (verstimm / 1200)
    k = max(1, min(harm, int(SR / 2 / f)))
    return sum(np.sin(2 * np.pi * f * h * t) / h for h in range(1, k + 1)) * 0.6


def rausch(n, rng):
    return rng.normal(0, 1, n)


def hall(dry, anteil=0.25, gross=1.0):
    """Schroeder-Hall über drei Durchgänge, der mittlere zählt → nahtlos."""
    L = len(dry)
    drei = np.concatenate([dry, dry, dry])
    nass = np.zeros_like(drei)
    for kanal, versatz in ((0, 0), (1, 23)):
        x = drei[:, kanal]
        y = np.zeros_like(x)
        for d, g in ((1557, 0.82), (1617, 0.81), (1491, 0.83), (1422, 0.82)):
            d = int((d + versatz) * gross)
            c = np.zeros_like(x)
            for s in range(0, len(x), d):
                e = min(s + d, len(x))
                c[s:e] = x[s:e] + (g * c[s - d:e - d] if s >= d else 0)
            y += c / 4
        for d, g in ((225, 0.5), (556, 0.5)):
            a = np.zeros_like(y)
            for s in range(0, len(y), d):
                e = min(s + d, len(y))
                a[s:e] = -g * y[s:e] + ((y[s - d:e - d] + g * a[s - d:e - d]) if s >= d else 0)
            y = a
        nass[:, kanal] = y
    return (drei + anteil * nass)[L:2 * L]


def meistern(x, ziel_rms_db=-16.0):
    x = x - x.mean(axis=0)
    rms = np.sqrt(np.mean(x ** 2))
    x = x * (10 ** (ziel_rms_db / 20) / max(rms, 1e-9))
    x = np.tanh(x * 1.3) / 1.3
    return x / max(1.0, np.max(np.abs(x)) / 10 ** (-1.2 / 20))


# ── Instrumente ───────────────────────────────────────────────────────────────────────────────────────────
def klavier(m, dauer=2.5, laut=0.25, hell=1.0):
    n = int(dauer * SR)
    t = np.arange(n) / SR
    f = hz(m)
    s = np.zeros(n)
    for h in range(1, 9):
        fh = f * h * np.sqrt(1 + 0.0004 * h * h)              # leicht unharmonisch wie eine Saite
        s += np.sin(2 * np.pi * fh * t) * (hell ** (h - 1)) / h ** 1.1 * np.exp(-t * (0.9 + h * 0.55))
    s *= np.minimum(1, t / 0.003)
    return s * laut


def epiano(m, dauer=1.6, laut=0.18):
    """FM-E-Piano (Rhodes-artig): Glocke im Anschlag, warmer Ton, leichtes Tremolo."""
    n = int((dauer + 0.8) * SR)
    t = np.arange(n) / SR
    f = hz(m)
    idx = 1.6 * np.exp(-t * 6) + 0.25
    s = np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * f * t))
    s += 0.25 * np.sin(2 * np.pi * f * 14 * t) * np.exp(-t * 30)  # „Tine"
    s *= adsr(n, 0.004, 0.6, 0.55, 0.5, dauer) * (1 + 0.12 * np.sin(2 * np.pi * 4.5 * t))
    return s * laut


def flaeche(m, dauer, laut=0.05, hell=1400):
    n = int((dauer + 2.0) * SR)
    s = np.stack([saege(hz(m), n, -7, 16) + saege(hz(m), n, 5, 16), saege(hz(m), n, 7, 16) + saege(hz(m), n, -4, 16)], axis=1)
    for k in (0, 1):
        s[:, k] = filt(s[:, k], tief=hell, ordnung=2)
    return s * adsr(n, 0.7, 0.5, 0.85, 1.6, dauer)[:, None] * laut


def streicher(m, dauer, laut=0.06):
    n = int((dauer + 1.2) * SR)
    t = np.arange(n) / SR
    vib = 1 + 0.004 * np.sin(2 * np.pi * 5.2 * t)
    out = np.zeros((n, 2))
    for k, vs in ((0, (-9, 4)), (1, (8, -3))):
        x = np.zeros(n)
        for v in vs:
            ph = 2 * np.pi * np.cumsum(hz(m) * 2 ** (v / 1200) * vib) / SR
            x += sum(np.sin(h * ph) / h for h in range(1, 12))
        out[:, k] = filt(x, tief=2600, hoch=120, ordnung=2)
    return out * adsr(n, 0.35, 0.3, 0.9, 0.8, dauer)[:, None] * laut


def synthbass(m, dauer, laut=0.22, hell=700):
    n = int((dauer + 0.15) * SR)
    s = filt(saege(hz(m), n, 0, 24), tief=hell, ordnung=4) + 0.6 * np.sin(2 * np.pi * hz(m) * np.arange(n) / SR)
    return s * adsr(n, 0.005, 0.12, 0.7, 0.08, dauer) * laut


def bass(m, dauer, laut=0.3):
    n = int((dauer + 0.25) * SR)
    t = np.arange(n) / SR
    s = np.sin(2 * np.pi * hz(m) * t) + 0.3 * np.sin(4 * np.pi * hz(m) * t) + 0.1 * np.sin(6 * np.pi * hz(m) * t)
    return s * adsr(n, 0.008, 0.2, 0.65, 0.2, dauer) * laut


def zupf(m, rng, dauer=1.6, laut=0.3, hell=0.7, daempf=0.996):
    f = hz(m)
    p = max(2, int(SR / f))
    buf = np.convolve(rng.uniform(-1, 1, p), [0.5, 0.5], mode="same") * (0.6 + 0.4 * hell)
    bl = [buf]
    n = int(dauer * SR)
    while len(bl) * p < n:
        v = bl[-1]
        neu = np.empty(p)
        neu[:-1] = daempf * 0.5 * (v[:-1] + v[1:])
        neu[-1] = daempf * 0.5 * (v[-1] + neu[0])
        bl.append(neu)
    return np.concatenate(bl)[:n] * np.exp(-np.arange(n) / SR * 1.6) * laut


def pfeifen(m, dauer, rng, laut=0.09):
    n = int((dauer + 0.15) * SR)
    t = np.arange(n) / SR
    vib = 1 + 0.006 * np.sin(2 * np.pi * 5.5 * t) * np.minimum(1, t / 0.4)
    ph = 2 * np.pi * np.cumsum(hz(m) * vib) / SR
    s = np.sin(ph) + 0.06 * np.sin(2 * ph)
    s += filt(rausch(n, rng), tief=hz(m) * 1.3, hoch=hz(m) * 0.7, ordnung=4) * 0.08   # Atem
    return s * adsr(n, 0.05, 0.1, 0.85, 0.12, dauer) * laut


def kick(laut=0.45, tief=48):
    n = int(0.4 * SR)
    t = np.arange(n) / SR
    f = tief + 90 * np.exp(-t * 32)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 8) * laut


def snare(rng, laut=0.22):
    n = int(0.25 * SR)
    t = np.arange(n) / SR
    s = filt(rausch(n, rng), tief=7000, hoch=1500) * np.exp(-t * 22) * 0.8 + np.sin(2 * np.pi * 190 * t) * np.exp(-t * 30) * 0.6
    return s * laut


def clap(rng, laut=0.2):
    n = int(0.22 * SR)
    t = np.arange(n) / SR
    e = sum(np.exp(-np.maximum(0, t - d) * 90) * (t >= d) for d in (0, 0.011, 0.022)) + np.exp(-t * 18) * 0.5
    return filt(rausch(n, rng), tief=5000, hoch=900) * e * laut


def hat(rng, laut=0.05, offen=False):
    n = int((0.25 if offen else 0.06) * SR)
    t = np.arange(n) / SR
    return filt(rausch(n, rng), hoch=7000) * np.exp(-t * (14 if offen else 70)) * laut


def shaker(rng, laut=0.04):
    n = int(0.09 * SR)
    t = np.arange(n) / SR
    e = np.sin(np.pi * np.minimum(1, t / 0.09)) ** 2
    return filt(rausch(n, rng), hoch=4500) * e * laut


def pauke(m, laut=0.4):
    n = int(1.4 * SR)
    t = np.arange(n) / SR
    f = hz(m) * (1 + 0.15 * np.exp(-t * 20))
    ph = 2 * np.pi * np.cumsum(f) / SR
    return (np.sin(ph) + 0.4 * np.sin(1.5 * ph) + 0.2 * np.sin(2.0 * ph)) * np.exp(-t * 2.6) * laut


def knistern(L, rng, laut=0.012):
    s = filt(rausch(L, rng), tief=3000, hoch=400) * 0.25
    idx = rng.integers(0, L, L // 2200)
    s[idx] += rng.normal(0, 4, len(idx))
    return filt(s, tief=9000) * laut


def blaeser(m, dauer, laut=0.05):
    n = int((dauer + 0.6) * SR)
    t = np.arange(n) / SR
    ph = 2 * np.pi * hz(m) * t
    hell = np.minimum(1, t / max(0.1, dauer * 0.7))           # Schwelle: wird heller
    s = sum(np.sin(h * ph) * (hell ** (h / 3)) / h ** 0.8 for h in range(1, 10))
    return s * adsr(n, dauer * 0.5, 0.2, 0.9, 0.4, dauer) * laut


DUR, MOLL, MAJ7, MIN7, DOM7, SUS2 = (0, 4, 7), (0, 3, 7), (0, 4, 7, 11), (0, 3, 7, 10), (0, 4, 7, 10), (0, 2, 7)


def raster(bpm, takte):
    schlag = 60 / bpm
    return schlag, 4 * schlag, int(round(takte * 4 * schlag * SR))


# ── Stücke ────────────────────────────────────────────────────────────────────────────────────────────────
def weite():

    S, T, L = raster(70, 16)
    buf = np.zeros((L, 2))
    # D – A/C# – Bm – G  |  D – A – G – G   (×2, zweite Hälfte mit Melodie)
    ak = [(50, DUR), (45, DUR), (47, MOLL), (43, DUR), (50, DUR), (45, DUR), (43, SUS2), (43, DUR)] * 2
    for k, (g, iv) in enumerate(ak):
        t0 = k * T
        for i in iv:
            lege(buf, t0, flaeche(g + 12 + i, T * 1.05, 0.035, 1100))   # Akkorde gehen ineinander über
        lege(buf, t0, bass(g - 12, T * 1.0, 0.22))
        for j, (s, o) in enumerate(((0, 0), (1.5, 1), (2.5, 2), (3, 1))):   # ruhige Klavier-Figur
            lege(buf, t0 + s * S, klavier(g + 24 + iv[o % len(iv)], 3.0, 0.11, 0.6), pan=-0.2 + 0.15 * j)
    mel = [(8, 0, 78), (8, 2, 76), (9, 0, 73), (9, 3, 74), (10, 0, 71), (10, 2, 73), (11, 0, 74), (12, 0, 78),
           (12, 2, 81), (13, 0, 76), (13, 2, 78), (14, 0, 74), (14, 2, 71), (15, 0, 73)]
    for tk, sch, m in mel:
        lege(buf, tk * T + sch * S, klavier(m, 3.5, 0.16, 0.75), pan=0.15)
    return meistern(hall(buf, 0.45, 1.3), -17)


def gipfelsturm():
    rng = np.random.default_rng(118)
    S, T, L = raster(118, 24)
    buf = np.zeros((L, 2))
    ak = [(45, MOLL), (41, DUR), (48, DUR), (43, DUR)] * 6          # Am – F – C – G
    arp = [0, 2, 1, 2, 0, 2, 1, 2, 0, 2, 1, 2, 0, 2, 1, 2]
    for k, (g, iv) in enumerate(ak):
        t0 = k * T
        teil = k // 8                                              # 0 Aufbau · 1 voll · 2 voll mit Lead
        for i in iv:
            lege(buf, t0, flaeche(g + 12 + i, T * 0.98, 0.022 if teil else 0.03, 2400))
        for a in range(8):                                         # Bass in Achteln
            lege(buf, t0 + a * S / 2, synthbass(g - 12 + (12 if a % 4 == 3 else 0), S / 2 * 0.85, 0.16, 900))
        for a in range(16):                                        # Synth-Arpeggio in Sechzehnteln
            m = g + 24 + iv[arp[a]] + (12 if a % 8 == 6 else 0)
            n = int(0.22 * SR)
            tt = np.arange(n) / SR
            s = filt(saege(hz(m), n, 0, 14), tief=3000, ordnung=2) * np.exp(-tt * 14) * (0.05 if teil else 0.035)
            lege(buf, t0 + a * S / 4, s, pan=0.35 if a % 2 else -0.35)
        for b in range(4):
            lege(buf, t0 + b * S, kick(0.5))
            lege(buf, t0 + b * S + S / 2, hat(rng, 0.05, offen=True), 0.3)
            if teil and b in (1, 3):
                lege(buf, t0 + b * S, clap(rng, 0.2), -0.1)
        if teil:
            for a in range(16):
                lege(buf, t0 + a * S / 4, hat(rng, 0.022), 0.4)
    lead = [(0, 76), (1.5, 74), (2, 72), (3, 74), (4, 72), (5.5, 69), (6, 67), (7, 69)]   # zwei Takte, viermal
    for w in range(4):
        for sch, m in lead:
            t = (16 + w * 2) * T + sch * S
            n = int(S * 0.9 * SR)
            tt = np.arange(n) / SR
            s = filt(saege(hz(m), n, 4, 12) + saege(hz(m), n, -4, 12), tief=2600, ordnung=2) * adsr(n, 0.01, 0.1, 0.7, 0.1, S * 0.8) * 0.045
            lege(buf, t, s, pan=0.05)
    return meistern(hall(buf, 0.2, 0.9), -14)


def rast():
    rng = np.random.default_rng(84)
    S, T, L = raster(84, 16)
    buf = np.zeros((L, 2))
    ak = [(53, MAJ7), (50, MIN7), (46, MAJ7), (48, DOM7)] * 4      # Fmaj7 – Dm7 – Bbmaj7 – C7
    sw = S / 2 * 0.62                                              # Swing: zweites Achtel spät
    for k, (g, iv) in enumerate(ak):
        t0 = k * T
        for o, (sch, d) in enumerate(((0, 1.4), (1.5 + 0.12, 0.5), (2.5 + 0.12, 1.2))):
            for i in iv:
                lege(buf, t0 + sch * S, epiano(g + 12 + i - (12 if i > 7 else 0), d * S, 0.06 if o else 0.075), pan=-0.15)
        lege(buf, t0, bass(g - 12, S * 1.5, 0.28))
        lege(buf, t0 + 2.5 * S + 0.06, bass(g - 12 + 7, S * 0.9, 0.22))
        lege(buf, t0 + 3.5 * S + 0.06, bass(g - 12 + (12 if k % 2 else 10), S * 0.4, 0.18))
        for b in range(4):
            if b in (0, 2) or (b == 3 and k % 2):
                lege(buf, t0 + b * S + (sw * 0.5 if b == 3 else 0), kick(0.42, 52))
            if b in (1, 3):
                lege(buf, t0 + b * S, filt(snare(rng, 0.2), tief=4000), -0.05)
            lege(buf, t0 + b * S, hat(rng, 0.03), 0.35)
            lege(buf, t0 + b * S + sw, hat(rng, 0.02), 0.35)
    mel = [(4, 0, 77), (4, 1.6, 76), (4, 2.6, 72), (5, 0.6, 74), (6, 0, 74), (6, 1.6, 72), (7, 0, 70), (7, 2, 72),
           (12, 0, 77), (12, 1.6, 79), (12, 2.6, 81), (13, 0.6, 79), (14, 0, 77), (14, 1.6, 74), (15, 0, 76)]
    for tk, sch, m in mel:
        lege(buf, tk * T + sch * S, epiano(m, S * 0.9, 0.07), pan=0.2)
    x = hall(buf, 0.22, 0.8)
    x = np.stack([filt(x[:, 0], tief=6500), filt(x[:, 1], tief=6500)], axis=1)   # Lo-Fi: oben abgeschnitten
    x += np.stack([knistern(L, rng), knistern(L, rng)], axis=1)
    return meistern(x, -17)


def grat():

    S, T, L = raster(90, 16)
    buf = np.zeros((L, 2))
    ak = [(50, MOLL), (46, DUR), (41, DUR), (48, DUR), (50, MOLL), (46, DUR), (43, MOLL), (45, DUR)] * 2   # Dm Bb F C | Dm Bb Gm A
    for k, (g, iv) in enumerate(ak):
        t0 = k * T
        voll = k >= 8
        for i in iv:
            lege(buf, t0, streicher(g + 12 + i, T * 1.03, 0.04 if voll else 0.03))
        lege(buf, t0, streicher(g - 12, T * 1.03, 0.05))
        for a in range(8):                                         # Ostinato der tiefen Streicher
            m = g + (0 if a % 2 == 0 else 7) + (12 if a in (3, 7) else 0)
            n = int(S / 2 * 0.8 * SR)
            lege(buf, t0 + a * S / 2, streicher(m, S / 2 * 0.6, 0.03)[:n] if voll else np.zeros((1, 2)))
        lege(buf, t0, pauke(g - 24, 0.42))
        if voll:
            lege(buf, t0 + 2.5 * S, pauke(g - 24, 0.25))
            lege(buf, t0 + 3 * S, pauke(g - 17, 0.3))
        if k % 4 == 3:
            lege(buf, t0 + 2 * S, blaeser(g + 12, S * 2, 0.06 if voll else 0.04))
    for tk, m in ((8, 74), (9, 77), (10, 81), (11, 79), (12, 74), (13, 77), (14, 79), (15, 81)):   # Hörner-Melodie
        lege(buf, tk * T, blaeser(m, T * 0.95, 0.05), pan=-0.1)
    for tk in (7, 15):                                             # Wirbel vor dem Wechsel
        for a in range(8):
            lege(buf, tk * T + 3 * S + a * S / 8, pauke(38, 0.06 + a * 0.02))
    return meistern(hall(buf, 0.42, 1.5), -15)


def wanderlied():
    rng = np.random.default_rng(100)
    S, T, L = raster(100, 20)
    buf = np.zeros((L, 2))
    ak = [(43, DUR), (43, DUR), (48, DUR), (43, DUR), (50, DUR), (48, DUR), (43, DUR), (50, DUR),
          (40, MOLL), (48, DUR), (43, DUR), (50, DUR)]
    ak = (ak + ak)[:20]                                            # G G C G D C G D Em C G D …
    for k, (g, iv) in enumerate(ak):
        t0 = k * T
        # Travis-Picking: Daumen wechselt Grundton/Quinte, Finger dazwischen
        for a in range(8):
            if a % 2 == 0:
                m = g + (0 if a % 4 == 0 else 7)
                lege(buf, t0 + a * S / 2, zupf(m, rng, 1.4, 0.32, 0.6), pan=-0.25)
            else:
                m = g + 12 + iv[(a // 2) % 3 + 0 if len(iv) > 2 else 0] + (12 if a == 5 else 0)
                lege(buf, t0 + a * S / 2, zupf(m, rng, 1.1, 0.22, 0.9), pan=0.25)
        lege(buf, t0, bass(g - 12, S * 1.8, 0.2))
        lege(buf, t0 + 2 * S, bass(g - 5, S * 1.6, 0.17))
        for a in range(8):
            lege(buf, t0 + a * S / 2, shaker(rng, 0.03 if a % 2 else 0.045), 0.45)
        if k >= 4:
            lege(buf, t0, kick(0.28, 55))
            lege(buf, t0 + 2 * S, kick(0.22, 55))
    mel = [(4, [(0, 71, 1), (1, 74, 1), (2, 79, 2)]), (5, [(0, 76, 1.5), (1.5, 74, 0.5), (2, 72, 2)]),
           (6, [(0, 71, 1), (1, 74, 1), (2, 79, 1), (3, 78, 1)]), (7, [(0, 76, 3)]),
           (8, [(0, 76, 1), (1, 79, 1), (2, 76, 2)]), (9, [(0, 72, 1.5), (1.5, 74, 0.5), (2, 76, 2)]),
           (10, [(0, 74, 1), (1, 71, 1), (2, 67, 2)]), (11, [(0, 69, 3)])]
    for wdh in (0, 8):
        for tk, noten in mel:
            for sch, m, d in noten:
                if tk + wdh < 20:
                    lege(buf, (tk + wdh) * T + sch * S, pfeifen(m + 12, d * S * 0.92, rng, 0.06), pan=0.1)
    return meistern(hall(buf, 0.25, 1.0), -16)


# ── Foto-Klicks ───────────────────────────────────────────────────────────────────────────────────────────
def klick_a(rng):
    """Spiegelreflex: Spiegel hoch (dumpfer Schlag) + Verschluss (heller Klack) + Spiegel zurück."""
    n = int(0.18 * SR)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for ab, f, tief, laut in ((0.0, 900, 2500, 1.0), (0.028, 2600, 9000, 0.55), (0.075, 1300, 4000, 0.7)):
        i = int(ab * SR)
        tt = t[: n - i]
        x[i:] += (filt(rausch(n - i, rng), tief=tief, hoch=f * 0.5) * np.exp(-tt * 140) * 0.7
                  + np.sin(2 * np.pi * f * tt) * np.exp(-tt * 220)) * laut
    return x


def klick_b(rng):
    """Spiegellos/Kompakt: ein kurzer, trockener, heller Klick."""
    n = int(0.08 * SR)
    t = np.arange(n) / SR
    return (filt(rausch(n, rng), tief=11000, hoch=2500) * np.exp(-t * 260) + 0.6 * np.sin(2 * np.pi * 3200 * t) * np.exp(-t * 400))


def klick_c(rng):
    """Analog: Klack mit kurzem Nachfedern und leisem Filmtransport-Ratschen."""
    n = int(0.42 * SR)
    t = np.arange(n) / SR
    x = (filt(rausch(n, rng), tief=6000, hoch=700) * np.exp(-t * 90) + 0.5 * np.sin(2 * np.pi * 1700 * t) * np.exp(-t * 160)) * 1.0
    x += 0.12 * np.sin(2 * np.pi * 4100 * t) * np.exp(-t * 35)    # Feder
    for k in range(5):                                             # Ratschen
        i = int((0.17 + k * 0.035) * SR)
        tt = t[: n - i]
        x[i:] += filt(rausch(n - i, rng), hoch=2000) * np.exp(-tt * 300) * 0.25
    return x


# ── Zweite Runde Klicks (02.10.2026, Marc: „Die Klicks gefallen mir alle noch nicht … baue noch ein paar") ──────
# Unterschied zur ersten Runde: Modalsynthese (gedämpfte, unharmonische Teiltöne wie bei Metallteilen) statt
# Sinus + Rauschen, dazu ein kurzer Raumanteil — trocken klang alles nach Synthesizer.
def _modal(n, t, teile, rng, rausch_laut=0.3, rausch_tief=9000, rausch_hoch=1500, abfall=160):
    x = np.zeros(n)
    for f, d, a in teile:
        x += a * np.sin(2 * np.pi * f * t + rng.uniform(0, 6.28)) * np.exp(-t * d)
    x += filt(rausch(n, rng), tief=rausch_tief, hoch=rausch_hoch) * np.exp(-t * abfall) * rausch_laut
    return x


def _raum(x, rng, anteil=0.18, laenge=0.09):
    n = int(laenge * SR)
    t = np.arange(n) / SR
    ir = filt(rausch(n, rng), tief=6000) * np.exp(-t / (laenge / 4))
    ir /= np.max(np.abs(ir))
    nass = np.zeros(len(x) + n)
    f = np.convolve(x, ir)[: len(x) + n] * anteil / 8
    nass[: len(f)] = f
    return np.concatenate([x, np.zeros(n)]) + nass


def _ereignis(x, ab, y):
    i = int(ab * SR)
    x[i:i + len(y)] += y[: len(x) - i]


def klick_d(rng):
    """Messsucher: leiser, weicher Zentralverschluss — ein gedämpftes „tk"."""
    n = int(0.06 * SR); t = np.arange(n) / SR
    y = _modal(n, t, [(1850, 120, 0.5), (3100, 180, 0.3), (720, 90, 0.35)], rng, 0.25, 6000, 900, 220)
    return _raum(filt(y, tief=7000), rng, 0.12)


def klick_e(rng):
    """Handy: zwei schnelle, helle Klacks (auf/zu) mit kurzem Metallklang."""
    x = np.zeros(int(0.16 * SR))
    for ab, k in ((0.0, 1.0), (0.045, 0.8)):
        n = int(0.06 * SR); t = np.arange(n) / SR
        _ereignis(x, ab, k * _modal(n, t, [(2350, 150, 0.6), (3900, 210, 0.45), (6100, 300, 0.3), (1100, 120, 0.25)], rng, 0.5, 11000, 2000, 260))
    return _raum(x, rng, 0.2, 0.07)


def klick_f(rng):
    """Sofortbild: satter Klack, dann kurz der Motor, der das Bild auswirft."""
    x = np.zeros(int(0.75 * SR))
    n = int(0.08 * SR); t = np.arange(n) / SR
    _ereignis(x, 0.0, _modal(n, t, [(1300, 110, 0.7), (2700, 160, 0.4), (430, 70, 0.5)], rng, 0.4, 7000, 700, 150))
    n = int(0.5 * SR); t = np.arange(n) / SR
    motor = (np.sin(2 * np.pi * 210 * t + 3 * np.sin(2 * np.pi * 37 * t)) * 0.5 + filt(rausch(n, rng), tief=2500, hoch=400) * 0.4)
    motor *= np.minimum(1, t / 0.04) * np.minimum(1, (0.5 - t) / 0.08) * 0.22
    _ereignis(x, 0.13, motor)
    return _raum(x, rng, 0.15)


def klick_g(rng):
    """Pop: weicher, moderner Plopp — kein Kamerageräusch."""
    n = int(0.16 * SR); t = np.arange(n) / SR
    f = 520 * np.exp(-t * 9) + 260
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 28) * np.minimum(1, t / 0.002)
    return _raum(y, rng, 0.1)


def klick_h(rng):
    """Holz: kurzer, warmer Holzblock."""
    n = int(0.2 * SR); t = np.arange(n) / SR
    y = _modal(n, t, [(820, 38, 0.8), (2240, 70, 0.35), (3910, 120, 0.15)], rng, 0.15, 5000, 600, 300)
    return _raum(y, rng, 0.14)


def klick_i(rng):
    """Glöckchen: sanftes, helles Ding."""
    n = int(1.2 * SR); t = np.arange(n) / SR
    f0 = 1760
    y = sum(a * np.sin(2 * np.pi * f0 * r * t) * np.exp(-t * d) for r, d, a in ((1, 3.5, 0.6), (2.76, 6, 0.25), (5.4, 11, 0.12), (8.93, 18, 0.06)))
    y *= np.minimum(1, t / 0.002)
    return _raum(y * 0.8, rng, 0.2, 0.25)


def klick_j(rng):
    """Wusch + Klick: kurzer Luftzug, dann der Auslöser (Social-Media-Stil)."""
    x = np.zeros(int(0.45 * SR))
    n = int(0.22 * SR); t = np.arange(n) / SR
    w = filt(rausch(n, rng), tief=3500, hoch=600) * np.sin(np.pi * t / 0.22) ** 2 * 0.35
    _ereignis(x, 0.0, w)
    n = int(0.06 * SR); t = np.arange(n) / SR
    _ereignis(x, 0.2, _modal(n, t, [(2350, 150, 0.6), (3900, 210, 0.4), (6100, 300, 0.25)], rng, 0.45, 11000, 2000, 260))
    return _raum(x, rng, 0.18)


KLICKS_NEU = (("d", klick_d), ("e", klick_e), ("f", klick_f), ("g", klick_g), ("h", klick_h), ("i", klick_i), ("j", klick_j))


def nur_klicks(vorhoer):
    for name, fn in KLICKS_NEU:
        x = fn(np.random.default_rng(11))
        x = x / np.max(np.abs(x)) * 10 ** (-3 / 20)
        wav(ZIEL / f"foto_klick_{name}.wav", x)
        if vorhoer:
            pause = np.zeros(int(0.7 * SR))
            reihe = np.concatenate([pause[: SR // 4], x, pause, x, pause, x, pause])
            tmp = vorhoer / f"_k{name}.wav"
            wav(tmp, reihe)
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(tmp), "-c:a", "libmp3lame", "-b:a", "192k", str(vorhoer / f"Klick-{name}.mp3")], check=True)
            tmp.unlink()


# ── Ausgabe ───────────────────────────────────────────────────────────────────────────────────────────────
def wav(pfad, x):
    if x.ndim == 1:
        x = np.stack([x, x], axis=1)
    with wave.open(str(pfad), "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype("<i2").tobytes())


def main():
    vorhoer = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    if len(sys.argv) > 2 and sys.argv[2] == "--klicks":   # nur die Klicks (Musik bleibt, wie sie ist)
        vorhoer.mkdir(parents=True, exist_ok=True)
        nur_klicks(vorhoer)
        return
    ZIEL.mkdir(parents=True, exist_ok=True)
    if vorhoer:
        vorhoer.mkdir(parents=True, exist_ok=True)
    for name, fn in (("weite", weite), ("gipfelsturm", gipfelsturm), ("rast", rast), ("grat", grat), ("wanderlied", wanderlied)):
        x = fn()
        tmp = ZIEL / f"_{name}.wav"
        wav(tmp, x)
        flac = ZIEL / f"musik_{name}.flac"
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(tmp), "-c:a", "flac", "-compression_level", "8", str(flac)], check=True)
        if vorhoer:   # zum Anhören: zweimal hintereinander (man hört die Naht), MP3
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-stream_loop", "1", "-i", str(tmp), "-c:a", "libmp3lame", "-b:a", "192k",
                            str(vorhoer / f"Musik-{name}.mp3")], check=True)
        tmp.unlink()
        print(f"{name:12s} {len(x) / SR:5.1f} s  Spitze {20 * np.log10(np.max(np.abs(x))):5.1f} dB  RMS {20 * np.log10(np.sqrt(np.mean(x ** 2))):5.1f} dB")
    for name, fn in (("a", klick_a), ("b", klick_b), ("c", klick_c)):
        x = fn(np.random.default_rng(7))
        x = x / np.max(np.abs(x)) * 10 ** (-3 / 20)
        wav(ZIEL / f"foto_klick_{name}.wav", x)
        if vorhoer:   # dreimal mit Pause, damit man ihn gut hört
            pause = np.zeros(int(0.7 * SR))
            reihe = np.concatenate([pause[: SR // 4], x, pause, x, pause, x, pause])
            tmp = vorhoer / f"_k{name}.wav"
            wav(tmp, reihe)
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(tmp), "-c:a", "libmp3lame", "-b:a", "192k", str(vorhoer / f"Klick-{name}.mp3")], check=True)
            tmp.unlink()


if __name__ == "__main__":
    sys.exit(main())
