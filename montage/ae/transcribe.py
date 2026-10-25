"""Speech → word timings for CaptionAE.jsx: python3 transcribe.py media.mp4 out.json [ru] [small]

Paths may come as "hex:<UTF-8 bytes in hex>": the panel sends them so, because Windows' command line breaks
non-Latin folder names (A:\\монтаж\\...).

Runs locally on the editor's machine. Needs `pip install faster-whisper` (the model downloads once, ~0.5–3 GB).
Falls back to openai-whisper if that is what is installed. Output is the same format as tools/align.py:
[{"w": "слово", "start": 1.23, "end": 1.51, "db": 4.2}, ...] — times in seconds from the start of the media file,
db = how much louder than the speaker's median the word was said (Caption AE turns the loudest into accents)."""
import json, os, sys


def with_faster_whisper(media, lang, model):
    from faster_whisper import WhisperModel
    m = WhisperModel(model, device='auto', compute_type='auto')
    segs, _ = m.transcribe(media, language=lang, word_timestamps=True, vad_filter=True)
    return [(w.word, w.start, w.end) for s in segs for w in (s.words or [])]


def with_openai_whisper(media, lang, model):
    import whisper
    r = whisper.load_model(model).transcribe(media, language=lang, word_timestamps=True)
    return [(w['word'], w['start'], w['end']) for s in r['segments'] for w in s.get('words', [])]


def loudness(media, words):
    import numpy as np
    try:
        from faster_whisper.audio import decode_audio
        a = decode_audio(media)
    except ImportError:
        import whisper
        a = whisper.load_audio(media)
    sr, db = 16000, []
    for _, s, e in words:
        seg = a[int(s * sr):max(int(e * sr), int(s * sr) + 1)]
        db.append(20 * np.log10(np.sqrt(np.mean(seg.astype(np.float64) ** 2)) + 1e-9))
    med = float(np.median(db))
    return [round(float(d - med), 1) for d in db]


def arg_path(p):
    return bytes.fromhex(p[4:]).decode('utf-8') if p.startswith('hex:') else p


def main(media, out, lang='ru', model='small'):
    media, out = arg_path(media), arg_path(out)
    if not os.path.exists(media):
        sys.exit('FileNotFoundError: No such file: %r' % media)
    lang = None if lang == 'auto' else lang
    try:
        words = with_faster_whisper(media, lang, model)
    except ImportError:
        try:
            words = with_openai_whisper(media, lang, model)
        except ImportError:
            sys.exit('Не найден распознаватель. Установите: pip install faster-whisper')
    try:
        db = loudness(media, words)
    except Exception as ex:  # accents are a bonus: keep the transcript even if audio analysis fails
        print('loudness skipped:', ex)
        db = [None] * len(words)
    res = [dict({'w': w.strip(), 'start': round(s, 3), 'end': round(e, 3)}, **({'db': d} if d is not None else {}))
           for (w, s, e), d in zip(words, db) if w.strip()]
    json.dump(res, open(out, 'w', encoding='utf8'), ensure_ascii=False, indent=0)
    print(f'{len(res)} words')


if __name__ == '__main__':
    main(*sys.argv[1:5])
