#!/bin/bash
# Installs faster-whisper into every Python the Caption AE panel may use, so the panel and this installer agree.
echo "Caption AE: installing speech recognition (faster-whisper)..."
found=0
for PY in /opt/homebrew/bin/python3 /usr/local/bin/python3 /Library/Frameworks/Python.framework/Versions/Current/bin/python3; do
  [ -x "$PY" ] || continue
  found=1
  echo; echo "→ $PY"
  "$PY" -m pip install --user --upgrade faster-whisper \
    || "$PY" -m pip install --user --upgrade --break-system-packages faster-whisper
  # python.org builds need their certificates installed, or the model download fails with an SSL error
  CERT="/Applications/Python $("$PY" -c 'import sys;print("%d.%d"%sys.version_info[:2])')/Install Certificates.command"
  [ -f "$CERT" ] && bash "$CERT" >/dev/null 2>&1
done
if [ $found = 0 ]; then
  echo
  echo "ERROR: Python 3 not found. Install it from https://www.python.org/downloads/macos/ and run this file again."
  echo "ОШИБКА: Python 3 не найден. Установите с https://www.python.org/downloads/macos/ и запустите этот файл снова."
else
  echo; echo "Done / Готово."
fi
read -n 1 -s -r -p "Press any key / Нажмите любую клавишу..."
