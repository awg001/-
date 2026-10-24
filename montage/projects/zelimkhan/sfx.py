"""Sound bed for «Зелимхан», timed to render.py, mixed under the voiceover (vo.mp3 → final mix.wav)."""
import os, subprocess, sys, wave
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../lib'))
from storykit import WORK

OUT = f'{WORK}/zelimkhan'
SR, DUR = 44100, 49.5
N = int(SR * DUR)
t = np.arange(N) / SR
rng = np.random.default_rng(7)
bed = np.zeros((N, 2), np.float32)

def add(sig, at, gain=1., pan=0.):
    i = int(at * SR); j = min(N, i + len(sig))
    if j <= i: return
    l, r = np.sqrt((1 - pan) / 2), np.sqrt((1 + pan) / 2)
    bed[i:j, 0] += sig[:j - i] * gain * l * 1.41
    bed[i:j, 1] += sig[:j - i] * gain * r * 1.41

def whoosh(d=.7, rise=.55):
    n = int(d * SR); x = rng.normal(0, 1, n).astype(np.float32)
    k = np.linspace(0, 1, n)
    env = np.where(k < rise, (k / rise) ** 2.5, ((1 - k) / (1 - rise)) ** 1.5)
    a = .02 + .25 * env
    y = np.empty_like(x); acc = 0.
    for i in range(n): acc += a[i] * (x[i] - acc); y[i] = acc
    return y * env * 3

def hit(f0=58, d=.6):
    n = int(d * SR); k = np.arange(n) / SR
    f = f0 * (1 + 2.5 * np.exp(-k * 30))
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-k * 7)
    click = rng.normal(0, 1, n) * np.exp(-k * 120) * .4
    return (body + click).astype(np.float32)

def tick():
    n = int(.04 * SR); k = np.arange(n) / SR
    return (rng.normal(0, 1, n) * np.exp(-k * 250) + np.sin(2 * np.pi * 2400 * k) * np.exp(-k * 300) * .5).astype(np.float32)

def clank():
    n = int(1.2 * SR); k = np.arange(n) / SR
    s = sum(np.sin(2 * np.pi * f * k) * np.exp(-k * d) for f, d in [(220, 4), (587, 6), (1310, 9), (2240, 12)])
    return (s / 3 + rng.normal(0, 1, n) * np.exp(-k * 60) * .5).astype(np.float32)

def train(d=5.5):
    n = int(d * SR); k = np.arange(n) / SR
    chug = (np.sin(2 * np.pi * 2.6 * k) > .6).astype(np.float32)
    noise = rng.normal(0, 1, n).astype(np.float32)
    y = np.empty_like(noise); acc = 0.
    for i in range(n): acc += .04 * (noise[i] - acc); y[i] = acc
    env = np.clip(k / .6, 0, 1) * np.clip((d - k) / .6, 0, 1)
    return y * (0.4 + chug) * env * 4

# drone with a darker swell towards the end
drone = sum(np.sin(2 * np.pi * f * t + p) for f, p in [(49, 0), (49.3, 1), (73.4, 2), (98.2, .5)]) / 4
drone *= (.55 + .45 * np.sin(2 * np.pi * .11 * t - 1.5)) * np.clip(t / 1.0, 0, 1) * np.clip((DUR - t) / .8, 0, 1)
add(drone.astype(np.float32), 0, .25)

CUTS = [4.2, 8.3, 15.2, 18.85, 20.95, 26.4, 28.75, 33.85, 43.0]
for tc in CUTS:
    add(whoosh(), tc - .45, .5, -.3); add(whoosh(.6, .6), tc - .38, .35, .3); add(hit(45, .9), tc, .45)
add(whoosh(.5, .7), 0, .3)
for at, g, f in [(.55, .5, 65), (4.35, .5, 50), (4.9, .3, 70), (6.3, .25, 80), (8.55, .5, 65), (10.3, .3, 75),
                 (15.85, .5, 60), (16.5, .3, 70), (21.9, .55, 55), (23.55, .3, 80), (24.2, .3, 80), (25.55, .45, 60),
                 (27.95, .5, 60), (32.2, .45, 50), (32.85, .45, 50), (37.85, .5, 60), (20.1, .6, 40)]:
    add(hit(f, .5), at, g)
add(hit(38, 1.2), 11.1, .8)                    # stamp slam
add(clank(), 8.4, .25, -.4)                    # cell door
add(train(), 21.0, .35)
add(whoosh(.9, .8), 26.3, .35)                 # poster drop
for i in range(16): add(tick(), 34.1 + i * 2.9 / 16 + rng.uniform(0, .01), .3, .2)
add(hit(30, 1.8), 41.6, .9)                    # «погибает»
add(whoosh(1.6, .7), 45.5, .3)                 # name re-forms

# mix: voice on top, bed ducked under speech
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', f'{OUT}/vo.mp3', '-ar', str(SR), '-ac', '2', f'{OUT}/vo.wav'], check=True)
with wave.open(f'{OUT}/vo.wav') as w:
    vo = np.frombuffer(w.readframes(w.getnframes()), np.int16).reshape(-1, 2).astype(np.float32) / 32768
voice = np.zeros_like(bed); voice[:min(N, len(vo))] = vo[:N]
env = np.abs(voice).mean(axis=1)
k = int(.15 * SR); env = np.convolve(env, np.ones(k) / k, 'same')
duck = 1 - .45 * np.clip(env / (env.max() * .25), 0, 1)
bed /= max(1e-6, np.abs(bed).max())
mix = voice * .95 + bed * .30 * duck[:, None]
mix /= max(1., np.abs(mix).max() / .95)
with wave.open(f'{OUT}/mix.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((mix * 32767).astype(np.int16).tobytes())
print('mix.wav', len(mix) / SR)
