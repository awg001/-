"""Default Caption AE sounds, synthesized (no licences): python3 make_sounds.py <out_dir>

<out_dir>/whoosh/*.wav — phrase appears; loudest point at WHOOSH_PEAK s (the panel starts the layer that much earlier).
<out_dir>/hit/*.wav    — accent word; the attack is at 0 s.
Three variants of each, so repeated events do not sound copy-pasted."""
import os, sys, wave
import numpy as np

SR = 48000
WHOOSH_PEAK = 0.18  # keep in sync with WHOOSH_LEAD in CaptionAE.jsx


def lowpass(x, a):
    """one-pole lowpass with a per-sample coefficient a (0..1)"""
    y = np.empty_like(x); acc = 0.
    for i in range(len(x)):
        acc += a[i] * (x[i] - acc); y[i] = acc
    return y


def whoosh(rng, d, bright, pan):
    n = int(d * SR); k = np.arange(n) / SR
    up = np.clip(k / WHOOSH_PEAK, 0, 1) ** 2.2
    down = np.exp(-np.clip(k - WHOOSH_PEAK, 0, None) * (4.5 / (d - WHOOSH_PEAK)))
    env = up * down
    air = lowpass(rng.normal(0, 1, n), 0.015 + bright * env)  # the filter opens towards the peak
    body = lowpass(rng.normal(0, 1, n), 0.004 + 0.02 * env) * 2.5  # low rumble under it
    m = (air + body) * env
    return stereo(m, pan * np.sin(np.pi * np.clip(k / d, 0, 1)))  # passes across the stereo field


def hit(rng, f0, d, click):
    n = int(d * SR); k = np.arange(n) / SR
    f = f0 * (1 + 2.2 * np.exp(-k * 35))  # pitch drop = punch
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-k * 6.5)
    snap = lowpass(rng.normal(0, 1, n), np.full(n, 0.35)) * np.exp(-k * 90) * click
    tail = lowpass(rng.normal(0, 1, n), np.full(n, 0.02)) * np.exp(-k * 9) * 0.6
    m = np.tanh((body + snap + tail) * 1.6)  # soft saturation, like a mastered impact
    return stereo(m, np.zeros(n))


def stereo(m, pan):
    m = m / (np.abs(m).max() + 1e-9) * 0.89  # -1 dBFS
    fade = np.minimum(1, (len(m) - np.arange(len(m))) / (0.02 * SR))
    m = m * fade
    return np.stack([m * (1 - pan) ** 0.5, m * (1 + pan) ** 0.5], 1) / 2 ** 0.5


def save(path, x):
    x = (np.clip(x, -1, 1) * 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(x.tobytes())


def main(out):
    rng = np.random.default_rng(7)
    for sub in ('whoosh', 'hit'):
        os.makedirs(os.path.join(out, sub), exist_ok=True)
    for i, (d, b, p) in enumerate([(0.55, 0.20, 0.5), (0.45, 0.28, -0.5), (0.65, 0.14, 0.3)], 1):
        save(os.path.join(out, 'whoosh', 'whoosh_%d.wav' % i), whoosh(rng, d, b, p))
    for i, (f0, d, c) in enumerate([(55, 0.7, 0.5), (65, 0.55, 0.8), (48, 0.9, 0.35)], 1):
        save(os.path.join(out, 'hit', 'hit_%d.wav' % i), hit(rng, f0, d, c))


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'CaptionAE_sounds'))
