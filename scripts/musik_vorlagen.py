# Herkunft von ui/audio/musik_{panorama,tagebuch,puls}.flac und foto_klick_{k,l}.wav (05.10.2026).
#
# Ursprünglich für die Schnell-Video-Entwürfe geschrieben; hier zur
# Nachvollziehbarkeit abgelegt. Die Stücke sind 40-s-Skizzen aus Oszillatoren und Hüllkurven, ohne Samples.
# In die App kamen sie per ffmpeg nach FLAC (44,1 kHz). Ausgabeordner unten (HERE/VIDEO_DIR) beim Neu-
# Erzeugen anpassen.
"""Original, sample-free music sketches for the three Schnellvideo concepts.

Requires NumPy and ffmpeg. Outputs 40-second AAC music, two short photo cues,
and four 12-second video studies with a synced soundtrack. No stock samples.
"""

from __future__ import annotations

import math
import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np


HERE = Path(__file__).resolve().parent
VIDEO_DIR = HERE.parent
RATE = 44100
DURATION = 40.0
N = int(RATE * DURATION)
RNG = np.random.default_rng(50105)


def hz(midi: float) -> float:
    return 440.0 * (2.0 ** ((midi - 69.0) / 12.0))


def add_mono(stereo: np.ndarray, sound: np.ndarray, start: float, pan: float = 0.0):
    a = max(0, int(start * RATE))
    if a >= len(stereo):
        return
    size = min(len(sound), len(stereo) - a)
    left = math.sqrt((1 - pan) / 2)
    right = math.sqrt((1 + pan) / 2)
    stereo[a:a+size, 0] += sound[:size] * left
    stereo[a:a+size, 1] += sound[:size] * right


def synth(midi: float, length: float, kind: str, velocity: float = 1.0) -> np.ndarray:
    n = max(1, int(length * RATE))
    t = np.arange(n, dtype=np.float32) / RATE
    f = hz(midi)
    if kind == "pad":
        tone = (.58*np.sin(2*np.pi*f*t) + .24*np.sin(2*np.pi*f*1.004*t)
                + .14*np.sin(2*np.pi*f*2*t) + .08*np.sin(2*np.pi*f*.5*t))
        attack = np.minimum(1, t/.25)
        release = np.minimum(1, (length-t)/.50)
        env = attack * np.maximum(0, release)
    elif kind == "piano":
        tone = (np.sin(2*np.pi*f*t) + .42*np.sin(2*np.pi*2*f*t)
                + .18*np.sin(2*np.pi*3*f*t) + .08*np.sin(2*np.pi*4*f*t))
        env = np.minimum(1,t/.008) * np.exp(-t*(2.0 if midi>65 else 1.35))
    elif kind == "pluck":
        tone = (np.sin(2*np.pi*f*t) + .6*np.sin(2*np.pi*2*f*t)
                + .25*np.sin(2*np.pi*3*f*t) + .13*np.sin(2*np.pi*4*f*t))
        env = np.minimum(1,t/.003) * np.exp(-t*(4.2 if midi>60 else 2.6))
    elif kind == "bell":
        tone = (np.sin(2*np.pi*f*t) + .34*np.sin(2*np.pi*f*2.01*t)
                + .19*np.sin(2*np.pi*f*3.94*t))
        env = np.minimum(1,t/.006) * np.exp(-t*2.7)
    elif kind == "bass":
        tone = .86*np.sin(2*np.pi*f*t) + .18*np.sin(2*np.pi*2*f*t)
        env = np.minimum(1,t/.009) * np.exp(-t*2.0)
    else:
        raise ValueError(kind)
    return (tone*env*velocity).astype(np.float32)


def note(stereo, midi, start, length, kind, amp=.1, pan=0):
    add_mono(stereo, synth(midi, length, kind, amp), start, pan)


def kick(stereo, start, amp=.22):
    length=.32
    t=np.arange(int(RATE*length),dtype=np.float32)/RATE
    phase=2*np.pi*(57*t + (71-57)*(.07/(2*np.pi))*np.exp(-t/.07)*2*np.pi)
    sound=np.sin(phase)*np.exp(-t*16)*amp
    add_mono(stereo,sound.astype(np.float32),start)


def snare(stereo,start,amp=.055):
    n=int(RATE*.19)
    t=np.arange(n,dtype=np.float32)/RATE
    noise=RNG.standard_normal(n).astype(np.float32)
    # Differencing removes the low-frequency part; a short tail softens it.
    high=np.concatenate(([0.0],np.diff(noise)))
    sound=(high*.45+np.sin(2*np.pi*185*t)*.35)*np.exp(-t*25)*amp
    add_mono(stereo,sound.astype(np.float32),start,.08)


def hat(stereo,start,amp=.022,pan=.25):
    n=int(RATE*.085)
    t=np.arange(n,dtype=np.float32)/RATE
    noise=RNG.standard_normal(n).astype(np.float32)
    high=np.concatenate(([0.0],np.diff(noise)))
    sound=high*np.exp(-t*54)*amp
    add_mono(stereo,sound.astype(np.float32),start,pan)


def breath(stereo,start,length=.8,amp=.012):
    n=int(RATE*length)
    t=np.arange(n,dtype=np.float32)/RATE
    noise=RNG.standard_normal(n).astype(np.float32)
    smooth=np.convolve(noise,np.ones(18,dtype=np.float32)/18,mode="same")
    env=np.sin(np.pi*np.clip(t/length,0,1))**2
    add_mono(stereo,(smooth*env*amp).astype(np.float32),start,-.2)


def ambience(stereo, intensity=.12):
    # A few early reflections make the synthesis less dry without sample libraries.
    dry=stereo.copy()
    for delay,gain in [(0.19,.08),(0.31,.07),(0.43,.05)]:
        n=int(delay*RATE)
        stereo[n:,0]+=dry[:-n,1]*gain*intensity/.12
        stereo[n:,1]+=dry[:-n,0]*gain*intensity/.12


def finish(stereo, fade_out=2.2):
    t=np.arange(len(stereo),dtype=np.float32)/RATE
    fade=np.minimum(1,t/.40)*np.minimum(1,np.maximum(0,(DURATION-t)/fade_out))
    stereo*=fade[:,None]
    peak=np.max(np.abs(stereo))
    if peak:
        stereo*=min(.90/peak,1.7)
    stereo=np.tanh(stereo*1.15).astype(np.float32)
    rms=float(np.sqrt(np.mean(stereo*stereo)))
    peak=float(np.max(np.abs(stereo)))
    if rms and peak:
        stereo*=min((10**(-20/20))/rms, .95/peak)
    return stereo


def weite() -> np.ndarray:
    m=np.zeros((N,2),dtype=np.float32)
    bpm=96; bar=240/bpm
    chords=[(50,54,57,61,64),(47,50,54,57,61),(43,47,50,54,57),(45,50,52,57,59)]
    melody=[74,73,69,66,69,73,76,74]
    for b in range(16):
        start=b*bar; chord=chords[b%4]
        for i,pitch in enumerate(chord):
            note(m,pitch,start,bar+0.2,"pad",.040 if i<3 else .028,pan=(-.38+i*.19))
        note(m,chord[0]-12,start,bar*.85,"bass",.035)
        if b%2==0:
            note(m,melody[(b//2)%len(melody)],start+.42,1.8,"piano",.105,.20)
        note(m,chord[2]+12,start+bar*.68,1.1,"piano",.036,-.25)
        if b>=4 and b<14:
            kick(m,start,.075)
            hat(m,start+bar*.5,.008,-.15)
        if b in (3,7,11):
            breath(m,start+bar*.6,.95,.017)
    # Musical breath around the sample photo reveal (around 20 seconds).
    for pitch,offset in [(74,.10),(78,.28),(81,.48)]:
        note(m,pitch,20+offset,1.15,"bell",.033,.3)
    ambience(m,.12)
    return finish(m)


def tagebuch() -> np.ndarray:
    m=np.zeros((N,2),dtype=np.float32)
    bpm=96; bar=240/bpm
    chords=[(43,47,50,54),(42,45,50,57),(40,43,47,50),(48,52,55,59)]
    pattern=[0,2,1,3,2,1,3,2]
    for b in range(16):
        start=b*bar; chord=chords[b%4]
        for i,pitch in enumerate(chord):
            note(m,pitch,start,bar*.95,"pad",.019,pan=(-.25+i*.16))
        note(m,chord[0]-12,start,bar*.70,"bass",.040)
        for i,pick in enumerate(pattern):
            pitch=chord[pick]+(12 if pick>0 else 0)
            note(m,pitch,start+i*bar/8,.82,"pluck",.056 if i in (0,4) else .039,pan=(-.28 if i%2 else .28))
        if b>=4:
            kick(m,start,.060)
            snare(m,start+bar*.5,.013)
        if b in (1,5,9,13):
            note(m,79,start+bar*.73,1.4,"bell",.035,.25)
    for pitch,offset in [(76,.04),(79,.21),(83,.39)]:
        note(m,pitch,20+offset,1.4,"bell",.036,-.24)
    ambience(m,.14)
    return finish(m)


def puls() -> np.ndarray:
    m=np.zeros((N,2),dtype=np.float32)
    bpm=120; beat=60/bpm; bar=4*beat
    chords=[(40,47,52,55,59),(36,43,48,52,55),(43,50,55,59,62),(38,45,50,54,57)]
    arp=(0,2,3,4,2,3,1,3)
    for b in range(20):
        start=b*bar; chord=chords[b%4]
        for i,pitch in enumerate(chord[1:]):
            note(m,pitch,start,bar*.98,"pad",.020,pan=-.3+i*.17)
        for q in range(4):
            note(m,chord[0]-12,start+q*beat,beat*.84,"bass",.069)
        for i,pick in enumerate(arp):
            note(m,chord[pick]+12,start+i*beat/2,beat*.72,"pluck",.038 if i%2==0 else .024,pan=(-.22 if i%2 else .22))
        for q in range(4):
            intensity=.78 if 9<=b<=11 else 1.0
            kick(m,start+q*beat,.135*intensity if q in (0,2) else .066*intensity)
            if q in (1,3): snare(m,start+q*beat,.030*intensity)
            hat(m,start+q*beat,.013*intensity,-.22)
            hat(m,start+q*beat+beat/2,.010*intensity,.2)
    for pitch,offset in [(76,.06),(79,.20),(83,.38)]:
        note(m,pitch,20+offset,.88,"bell",.022,.3)
    ambience(m,.08)
    return finish(m)


def photo_cue() -> np.ndarray:
    length=.78;n=int(RATE*length)
    cue=np.zeros((n,2),dtype=np.float32)
    t=np.arange(n,dtype=np.float32)/RATE
    # Soft double camera click, followed by a glass-like upward pair.
    for at,amp in [(0.0,.18),(.065,.10)]:
        k=int(at*RATE);count=int(.034*RATE)
        tt=np.arange(count,dtype=np.float32)/RATE
        noise=RNG.standard_normal(count).astype(np.float32)
        click=(np.concatenate(([0.0],np.diff(noise)))*.22 + np.sin(2*np.pi*650*tt)*.3)
        click*=np.exp(-tt*120)*amp
        cue[k:k+count,0]+=click
        cue[k:k+count,1]+=click*.86
    for pitch,at,amp in [(79,.08,.085),(86,.18,.064)]:
        s=synth(pitch,length-at,"bell",amp)
        add_mono(cue,s,at,.18 if pitch==79 else -.12)
    noise=RNG.standard_normal(n).astype(np.float32)
    smooth=np.convolve(noise,np.ones(40,dtype=np.float32)/40,mode="same")
    env=np.sin(np.pi*np.clip(t/length,0,1))**2
    add_mono(cue,(smooth*env*.009).astype(np.float32),0)
    cue=np.tanh(cue*1.8)
    return cue.astype(np.float32)


def shutter_cue() -> np.ndarray:
    """A compact, mechanical two-stage camera shutter, synthesized from noise."""
    duration=.44
    n=int(RATE*duration)
    out=np.zeros((n,2),dtype=np.float32)
    rng=np.random.default_rng(6130)
    # Trigger, shutter snap, and a short return mechanism. No sampled camera audio.
    for at,length,amp,body_hz,pan in [(.004,.055,.20,330,-.12),
                                       (.083,.094,.48,185,.09),
                                       (.174,.048,.13,520,-.04)]:
        count=int(length*RATE)
        t=np.arange(count,dtype=np.float32)/RATE
        noise=rng.standard_normal(count).astype(np.float32)
        high=np.concatenate(([0.0],np.diff(noise)))
        metallic=np.sin(2*np.pi*(1350*t+380*t*t))*np.exp(-t*60)
        body=np.sin(2*np.pi*body_hz*t)*np.exp(-t*33)
        env=np.minimum(1,t/.0009)*np.exp(-t*(74 if at==.083 else 100))
        sound=(.31*high+.27*metallic+.42*body)*env*amp
        add_mono(out,sound.astype(np.float32),at,pan)
    # Quiet shutter-blade flutter behind the main snap.
    count=int(.11*RATE)
    t=np.arange(count,dtype=np.float32)/RATE
    flutter=np.sin(2*np.pi*(990*t+1250*t*t))*np.exp(-t*42)*.032
    add_mono(out,flutter.astype(np.float32),.098,.12)
    peak=float(np.max(np.abs(out)))
    if peak:
        out*=min(.70/peak,4.0)
    return out


def pcm16(stereo: np.ndarray) -> bytes:
    return (np.clip(stereo,-1,1)*32767).astype("<i2").tobytes()


def write_wav(path: Path, stereo: np.ndarray):
    with wave.open(str(path),"wb") as f:
        f.setnchannels(2);f.setsampwidth(2);f.setframerate(RATE)
        f.writeframes(pcm16(stereo))


def run(*cmd: str):
    subprocess.run(cmd,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)


def mux_preview(choice: str, music: np.ndarray, cue: np.ndarray, suffix: str = "mit-musik"):
    duration=12
    cut=music[:duration*RATE].copy()
    cue_start=6.0
    a=int(cue_start*RATE);b=min(len(cut),a+len(cue))
    # Ease the music down by ~4 dB around the photo; the cue never masks speech.
    duck_a=int(5.82*RATE);duck_b=int(6.90*RATE)
    q=np.linspace(0,1,duck_b-duck_a,dtype=np.float32)
    depth=1-.37*(np.sin(np.pi*q)**2)
    cut[duck_a:duck_b]*=depth[:,None]
    cut[a:b]+=cue[:b-a]*.72
    cut=np.tanh(cut*1.04)
    with tempfile.TemporaryDirectory() as temp:
        wav=Path(temp)/"preview.wav";write_wav(wav,cut)
        source=VIDEO_DIR/f"schnellvideo-{choice}.mp4"
        dest=VIDEO_DIR/f"schnellvideo-{choice}-{suffix}.mp4"
        run("ffmpeg","-y","-loglevel","error","-i",str(source),"-i",str(wav),
            "-map","0:v:0","-map","1:a:0","-c:v","copy","-c:a","aac","-b:a","192k",
            "-shortest","-movflags","+faststart",str(dest))
        print(dest.name,dest.stat().st_size,"bytes")


def main():
    HERE.mkdir(parents=True,exist_ok=True)
    cue=photo_cue()
    cue_path=HERE/"foto-einblendung.wav"
    write_wav(cue_path,cue)
    print(cue_path.name,cue_path.stat().st_size,"bytes")
    shutter=shutter_cue()
    shutter_path=HERE/"kamera-shutter-klick.wav"
    write_wav(shutter_path,shutter)
    print(shutter_path.name,shutter_path.stat().st_size,"bytes")
    shutter_web=HERE/"kamera-shutter-klick.m4a"
    run("ffmpeg","-y","-loglevel","error","-i",str(shutter_path),
        "-c:a","aac","-b:a","192k",str(shutter_web))
    print(shutter_web.name,shutter_web.stat().st_size,"bytes")
    for choice,compose in [("weite",weite),("tagebuch",tagebuch),("puls",puls)]:
        music=compose()
        with tempfile.TemporaryDirectory() as temp:
            wav=Path(temp)/"master.wav";write_wav(wav,music)
            dest=HERE/f"musik-{choice}-40s.m4a"
            run("ffmpeg","-y","-loglevel","error","-i",str(wav),"-c:a","aac","-b:a","192k",str(dest))
            print(dest.name,dest.stat().st_size,"bytes")
        mux_preview(choice,music,cue)
        if choice=="weite":
            mux_preview(choice,music,shutter,"mit-shutter")


if __name__=="__main__":
    main()
