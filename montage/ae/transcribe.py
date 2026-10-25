"""Speech → word timings for CaptionAE.jsx: python3 transcribe.py media.mp4 out.json [ru] [small] [progress.txt]
Also: python3 transcribe.py --install <base> — installs faster-whisper into this very Python (see install());
      python3 transcribe.py --spawn <any of the above> — runs it detached and returns at once (see spawn()).

The panel runs it in the background (After Effects stays responsive) and watches files next to out.json:
progress.txt — "stage text|fraction" while working; progress.txt.cancel — created by the panel to stop;
out.json.log — everything printed, with the traceback on failure; out.json.failed — written when it stopped
without a result. out.json itself appears only when complete.

Paths may come as "hex:<UTF-8 bytes in hex>": the panel sends them so, because Windows' command line breaks
non-Latin folder names (A:\\монтаж\\...).

Runs locally on the editor's machine. Needs `pip install faster-whisper` (the model downloads once, ~0.5–3 GB).
Falls back to openai-whisper if that is what is installed. Output is the same format as tools/align.py:
[{"w": "слово", "start": 1.23, "end": 1.51, "db": 4.2}, ...] — times in seconds from the start of the media file,
db = how much louder than the speaker's median the word was said (Caption AE turns the loudest into accents)."""
import json, os, sys


def decode(media, sr=16000):
    """Media file -> mono float32 at 16 kHz, read with PyAV directly. faster-whisper's own decode_audio passes
    av.open(metadata_errors=...), which PyAV 19 removed ("unexpected keyword argument 'metadata_errors'"), so a
    fresh install breaks; this works with old and new PyAV alike."""
    try:
        import av
    except ImportError as ex:  # not "recogniser missing": faster-whisper is there, its PyAV is broken
        raise RuntimeError('PyAV (av) не загружается: %s. Переустановите: pip install --force-reinstall av' % ex)
    import numpy as np
    out = []
    with av.open(media, mode='r') as c:
        if not c.streams.audio:
            raise ValueError('В файле нет звуковой дорожки')
        rs = av.audio.resampler.AudioResampler(format='s16', layout='mono', rate=sr)
        for frame in c.decode(audio=0):
            frame.pts = None
            for f in rs.resample(frame):
                out.append(f.to_ndarray().reshape(-1))
        for f in rs.resample(None):  # flush
            out.append(f.to_ndarray().reshape(-1))
    return (np.concatenate(out).astype(np.float32) / 32768.0) if out else np.zeros(0, np.float32)


AUDIO = None  # decoded once, shared by recognition and loudness


def audio_of(media):
    global AUDIO
    if AUDIO is None:
        AUDIO = decode(media)
    return AUDIO


class Cancelled(Exception):
    pass


PROGRESS = None


def report(stage, frac=0.0):
    if not PROGRESS:
        return
    if os.path.exists(PROGRESS + '.cancel'):
        raise Cancelled('Отменено')
    with open(PROGRESS, 'w', encoding='utf8') as f:
        f.write('%s|%.3f' % (stage, frac))


def with_faster_whisper(media, lang, model):
    from faster_whisper import WhisperModel

    def run(device, compute):
        report('Загружаю модель %s (первый раз скачивается: small ~0,5 ГБ, medium ~1,5 ГБ, large-v3 ~3 ГБ)' % model)
        m = WhisperModel(model, device=device, compute_type=compute)
        report('Читаю звук')
        segs, info = m.transcribe(audio_of(media), language=lang, word_timestamps=True, vad_filter=True)
        dur, out = max(info.duration or 0, 0.1), []
        report('Распознаю', 0)
        for s in segs:  # segments are lazy: errors (and the work) happen here
            out += [(w.word, w.start, w.end) for w in (s.words or [])]
            report('Распознаю', min(1, s.end / dur))
        return out

    try:
        return run('auto', 'auto')  # an NVIDIA card is used when its CUDA libraries are installed
    except (RuntimeError, OSError) as ex:
        # a GPU without cuBLAS/cuDNN (e.g. "cublas64_12.dll is not found") — the processor always works
        if not any(k in str(ex).lower() for k in ('cuda', 'cublas', 'cudnn', 'gpu', '.dll', '.so')):
            raise
        print('GPU unavailable (%s), using CPU' % ex)
        return run('cpu', 'int8')


def with_openai_whisper(media, lang, model):
    import whisper
    r = whisper.load_model(model).transcribe(media, language=lang, word_timestamps=True)
    return [(w['word'], w['start'], w['end']) for s in r['segments'] for w in s.get('words', [])]


def loudness(media, words):
    import numpy as np
    try:
        a = audio_of(media)
    except ImportError:
        import whisper
        a = whisper.load_audio(media)
    sr, db = 16000, []
    for _, s, e in words:
        seg = a[int(s * sr):max(int(e * sr), int(s * sr) + 1)]
        # a word past the end of the decoded audio has no samples: no loudness (NaN would break the JSON)
        db.append(20 * np.log10(np.sqrt(np.mean(seg.astype(np.float64) ** 2)) + 1e-9) if len(seg) else None)
    known = [d for d in db if d is not None]
    med = float(np.median(known)) if known else 0.0
    return [round(float(d - med), 1) if d is not None else None for d in db]


def arg_path(p):
    return bytes.fromhex(p[4:]).decode('utf-8') if p.startswith('hex:') else p


def main(media, out, lang='ru', model='small', progress=None):
    global PROGRESS
    media, out = arg_path(media), arg_path(out)
    PROGRESS = arg_path(progress) if progress else None
    if not os.path.exists(media):
        sys.exit('FileNotFoundError: No such file: %r' % media)
    lang = None if lang == 'auto' else lang
    try:
        words = with_faster_whisper(media, lang, model)
    except ImportError:
        try:
            words = with_openai_whisper(media, lang, model)
        except ImportError:
            sys.exit('Не найден распознаватель (No module named faster_whisper). Установите: pip install faster-whisper')
    report('Анализ громкости', 1)
    try:
        db = loudness(media, words)
    except Exception as ex:  # accents are a bonus: keep the transcript even if audio analysis fails
        print('loudness skipped:', ex)
        db = [None] * len(words)
    res = [dict({'w': w.strip(), 'start': round(s, 3), 'end': round(e, 3)}, **({'db': d} if d is not None else {}))
           for (w, s, e), d in zip(words, db) if w.strip()]
    json.dump(res, open(out + '.tmp', 'w', encoding='utf8'), ensure_ascii=False, indent=0)
    os.replace(out + '.tmp', out)  # appears complete or not at all: the panel polls for it
    print(f'{len(res)} words')


def install(base):
    """Install faster-whisper into THIS Python (the one the panel runs) — the panel's «Установить» button.
    Tries a normal install, then --user, then --user --break-system-packages (Homebrew Python on Mac);
    success = faster_whisper imports. Leaves base.done or base.failed; the log is base.log."""
    import subprocess
    log = open(base + '.log', 'w', encoding='utf8', buffering=1)
    sys.stdout = sys.stderr = log
    run = lambda c: subprocess.run(c, stdout=log, stderr=log).returncode == 0
    print('Python:', sys.executable, sys.version)
    if not run([sys.executable, '-m', 'pip', '--version']):
        run([sys.executable, '-m', 'ensurepip', '--user'])
    ok = False
    for extra in ([], ['--user'], ['--user', '--break-system-packages']):
        cmd = [sys.executable, '-m', 'pip', 'install', '--upgrade', '--disable-pip-version-check'] + extra + ['faster-whisper']
        print('$', ' '.join(cmd))
        if run(cmd) and run([sys.executable, '-c', 'import faster_whisper']):
            ok = True
            break
    print('OK' if ok else 'FAILED')
    open(base + ('.done' if ok else '.failed'), 'w').close()


def spawn(args):
    """Start transcribe.py with these args as a detached process and return at once. The panel calls this through
    system.callSystem, which waits until every holder of its output pipe is gone: the child gets no inherited
    handles (close_fds, DEVNULL), its own session / no console, so After Effects is released immediately."""
    import subprocess
    kw = dict(stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, close_fds=True)
    if os.name == 'nt':
        kw['creationflags'] = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    else:
        kw['start_new_session'] = True
    subprocess.Popen([sys.executable, os.path.abspath(__file__)] + args, **kw)
    print('SPAWNED')


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--spawn':
        spawn(sys.argv[2:])
        sys.exit()
    if len(sys.argv) > 2 and sys.argv[1] == '--install':
        install(arg_path(sys.argv[2]))
        sys.exit()
    args = sys.argv[1:6]
    out = arg_path(args[1]) if len(args) > 1 else None
    if out and len(args) > 4:  # background mode: everything goes to out.log, failure leaves out.failed
        sys.stdout = sys.stderr = open(out + '.log', 'w', encoding='utf8', buffering=1)
        try:
            main(*args)
        except BaseException:
            import traceback
            traceback.print_exc()
            open(out + '.failed', 'w').close()
    else:
        main(*args)
