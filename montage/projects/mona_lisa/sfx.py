"""Synthesised sound bed matched to render.py timings."""
import os, numpy as np, wave

SR, DUR = 44100, 9.0
N = int(SR * DUR)
t = np.arange(N) / SR
rng = np.random.default_rng(7)
out = np.zeros((N, 2), np.float32)

def add(sig, at, gain=1., pan=0.):
    i = int(at * SR); j = min(N, i + len(sig))
    l, r = np.sqrt((1 - pan) / 2), np.sqrt((1 + pan) / 2)
    out[i:j, 0] += sig[:j - i] * gain * l * 1.41
    out[i:j, 1] += sig[:j - i] * gain * r * 1.41

def lowpass(x, a):
    y = np.empty_like(x); acc = 0.
    for i, v in enumerate(x): acc += a * (v - acc); y[i] = acc
    return y

# drone: detuned low fifths with slow swell, darker in the reveal
drone = sum(np.sin(2 * np.pi * f * t + p) for f, p in [(55, 0), (55.4, 1), (82.4, 2), (110.3, .5)]) / 4
drone *= .5 + .5 * np.sin(2 * np.pi * .18 * t - 1.5)
drone *= np.clip(t / .6, 0, 1) * np.clip((DUR - t) / .4, 0, 1)
add(drone.astype(np.float32), 0, .22)

def whoosh(d=.7, rise=.55):
    n = int(d * SR); x = rng.normal(0, 1, n).astype(np.float32)
    k = np.linspace(0, 1, n)
    env = np.where(k < rise, (k / rise) ** 2.5, ((1 - k) / (1 - rise)) ** 1.5)
    a = .02 + .25 * env                      # brighter at the peak
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

for tc in (3.4, 6.0):                        # zoom-blur transitions
    add(whoosh(), tc - .45, .55, -.3); add(whoosh(.6, .6), tc - .38, .4, .3)
    add(hit(45, .9), tc, .5)
add(whoosh(.5, .7), .0, .35)                 # intro push
add(hit(70, .35), .6, .35, -.4)              # plate 1
add(hit(80, .3), .78, .25, -.4)              # plate 2
add(hit(65, .5), 1.6, .55, .3)               # БЕСЦЕННА sticker
for i in range(4): add(hit(90, .25), 3.4 - .22 + .45 + i * .28, .18)   # words
add(hit(40, 1.2), 3.4 - .22 + 1.8, .7)       # БЕЗУМНЕЕ
for i in range(15): add(tick(), 6.0 - .22 + .4 + i * .5 / 15 + rng.uniform(0, .01), .35, .2)
add(hit(50, 1.0), 6.0 - .22 + 1.1, .75)      # УКРАДЕНА

out /= max(1e-6, np.abs(out).max()) / .85
dst = os.path.join(os.environ.get('MONTAGE_WORK', os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../../work')), 'mona_lisa')
os.makedirs(dst, exist_ok=True)
with wave.open(os.path.join(dst, 'sfx.wav'), 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((out * 32767).astype(np.int16).tobytes())
