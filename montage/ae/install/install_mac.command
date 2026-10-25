#!/bin/bash
# Installs faster-whisper into every Python the Caption AE panel may use, so the panel and this installer agree.
# The panel tries these in order: Homebrew, /usr/local, python.org, Apple's /usr/bin/python3.
echo "Caption AE: installing speech recognition (faster-whisper)..."
ok=""; bad=""
seen=" "
for PY in /opt/homebrew/bin/python3 /usr/local/bin/python3 /Library/Frameworks/Python.framework/Versions/Current/bin/python3 \
          /usr/bin/python3 "$(command -v python3)"; do
  [ -n "$PY" ] && [ -x "$PY" ] || continue
  REAL="$("$PY" -c 'import sys;print(sys.executable)' 2>/dev/null)" || continue   # /usr/bin/python3 without Xcode tools fails here
  case "$seen" in *" $REAL "*) continue;; esac
  seen="$seen$REAL "
  echo; echo "→ $PY ($("$PY" --version 2>&1))"
  "$PY" -m pip install --upgrade --disable-pip-version-check faster-whisper \
    || "$PY" -m pip install --user --upgrade --disable-pip-version-check faster-whisper \
    || "$PY" -m pip install --user --upgrade --disable-pip-version-check --break-system-packages faster-whisper
  # python.org builds need their certificates installed, or the model download fails with an SSL error
  CERT="/Applications/Python $("$PY" -c 'import sys;print("%d.%d"%sys.version_info[:2])')/Install Certificates.command"
  [ -f "$CERT" ] && bash "$CERT" >/dev/null 2>&1
  if "$PY" -c "import faster_whisper" 2>/dev/null; then ok="$ok\n   $PY"; else bad="$bad\n   $PY"; fi
done
echo
if [ -z "$ok$bad" ]; then
  echo "ERROR: Python 3 not found. Install it from https://www.python.org/downloads/macos/ and run this file again."
  echo "ОШИБКА: Python 3 не найден. Установите с https://www.python.org/downloads/macos/ и запустите этот файл снова."
else
  [ -n "$ok" ] && printf "Ready / Готово:$ok\n"
  [ -n "$bad" ] && printf "Failed / Не установилось:$bad\n"
  echo
  echo "In the Caption AE panel («Настройки ▸» → Python) use one of the Ready paths."
  echo "В панели Caption AE («Настройки ▸» → поле Python) должен стоять один из путей «Готово»."
  echo "Easiest: just press «Распознать речь слоя» — the panel offers to install into its own Python."
  echo "Проще всего: нажмите «Распознать речь слоя» — панель сама предложит установить в свой Python."
fi
read -n 1 -s -r -p "Press any key / Нажмите любую клавишу..."
