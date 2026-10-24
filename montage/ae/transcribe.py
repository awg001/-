"""Speech → word timings for AutoSubs.jsx: python3 transcribe.py media.mp4 out.json [ru] [small]

Runs locally on the editor's machine. Needs `pip install faster-whisper` (the model downloads once, ~0.5–3 GB).
Falls back to openai-whisper if that is what is installed. Output is the same format as tools/align.py:
[{"w": "слово", "start": 1.23, "end": 1.51}, ...] — times in seconds from the start of the media file."""
import json, sys


def with_faster_whisper(media, lang, model):
    from faster_whisper import WhisperModel
    m = WhisperModel(model, device='auto', compute_type='auto')
    segs, _ = m.transcribe(media, language=lang, word_timestamps=True, vad_filter=True)
    return [(w.word, w.start, w.end) for s in segs for w in (s.words or [])]


def with_openai_whisper(media, lang, model):
    import whisper
    r = whisper.load_model(model).transcribe(media, language=lang, word_timestamps=True)
    return [(w['word'], w['start'], w['end']) for s in r['segments'] for w in s.get('words', [])]


def main(media, out, lang='ru', model='small'):
    lang = None if lang == 'auto' else lang
    try:
        words = with_faster_whisper(media, lang, model)
    except ImportError:
        try:
            words = with_openai_whisper(media, lang, model)
        except ImportError:
            sys.exit('Не найден распознаватель. Установите: pip install faster-whisper')
    res = [{'w': w.strip(), 'start': round(s, 3), 'end': round(e, 3)} for w, s, e in words if w.strip()]
    json.dump(res, open(out, 'w', encoding='utf8'), ensure_ascii=False, indent=0)
    print(f'{len(res)} words')


if __name__ == '__main__':
    main(*sys.argv[1:5])
