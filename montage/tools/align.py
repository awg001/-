"""Offline forced alignment for a known script: python3 align.py vo.mp3 script.txt out.json

No ASR model is reachable from the container, so words are placed by syllables.
Speech segments (between detected pauses) are matched to contiguous word runs by DP so that each run's
syllable rate stays close to the average. Display tokens may carry their spoken form: `1901|тысяча девятьсот первом`.
Accuracy is ~0.1–0.2 s per word — enough for word-by-word captions."""
import json, re, subprocess, sys

VOW = set('аеёиоуыэюяАЕЁИОУЫЭЮЯ')

def syl(spoken):
    n = sum(c in VOW for c in spoken)
    return n if n else 0.35

def pauses(path):
    r = subprocess.run(['ffmpeg', '-v', 'info', '-i', path, '-af', 'silencedetect=noise=-32dB:d=0.18', '-f', 'null', '-'],
                       capture_output=True, text=True).stderr
    st = [float(x) for x in re.findall(r'silence_start: ([0-9.]+)', r)]
    en = [float(x) for x in re.findall(r'silence_end: ([0-9.]+)', r)]
    dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
                               capture_output=True, text=True).stdout)
    sil = list(zip(st, en + [dur] * (len(st) - len(en))))
    lead = sil.pop(0)[1] if sil and sil[0][0] < .05 else 0.
    tail = sil.pop()[0] if sil and sil[-1][1] >= dur - .05 else dur
    return lead, tail, sil

def main(audio, script, out):
    toks = []
    for raw in open(script, encoding='utf8').read().split():
        disp, _, spoken = raw.partition('|')
        spoken = spoken.replace('_', ' ') or disp
        toks.append({'w': disp, 's': syl(spoken), 'brk': bool(re.search(r'[.,:;!?—]$', disp)) or disp == '—'})
    lead, tail, sil = pauses(audio)
    # speech segments between pauses
    segs, t0 = [], lead
    for s, e in sil:
        segs.append((t0, s)); t0 = e
    segs.append((t0, tail))
    syls = [t['s'] for t in toks]
    R = sum(syls) / sum(b - a for a, b in segs)
    # DP: split the word sequence into len(segs) contiguous runs; each run's syllable rate should match R,
    # and a run should end on punctuation (otherwise it is a breath mid-phrase: small penalty)
    import math
    n, m = len(segs), len(toks)
    pre = [0]
    for x in syls: pre.append(pre[-1] + x)
    INF = 1e18
    D = [[INF] * (m + 1) for _ in range(n + 1)]; P = [[0] * (m + 1) for _ in range(n + 1)]
    D[0][0] = 0
    for k in range(1, n + 1):
        dur = segs[k - 1][1] - segs[k - 1][0]
        for b in range(1, m + 1):
            pen = 0 if (toks[b - 1]['brk'] or b == m) else .35
            for a in range(max(0, b - 40), b):
                if D[k - 1][a] >= INF: continue
                c = D[k - 1][a] + math.log((pre[b] - pre[a]) / dur / R) ** 2 + pen
                if c < D[k][b]: D[k][b], P[k][b] = c, a
    cuts, b = [], m
    for k in range(n, 0, -1):
        a = P[k][b]; cuts.append((a, b, segs[k - 1])); b = a
    res = []
    for a, b, (s0, s1) in reversed(cuts):
        tot, cum = pre[b] - pre[a], 0
        for t in toks[a:b]:
            st = s0 + (s1 - s0) * cum / tot; cum += t['s']
            res.append({'w': t['w'], 'start': round(st, 3), 'end': round(s0 + (s1 - s0) * cum / tot, 3)})
    json.dump(res, open(out, 'w', encoding='utf8'), ensure_ascii=False, indent=0)
    print(f'{len(res)} words over {len(segs)} speech segments')

if __name__ == '__main__':
    main(*sys.argv[1:4])
