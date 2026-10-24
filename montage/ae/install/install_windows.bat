@echo off
chcp 65001 >nul
echo Caption AE: installing speech recognition (faster-whisper)...
python -m pip install --upgrade faster-whisper
if errorlevel 1 (
  echo Trying the "py" launcher...
  py -m pip install --upgrade faster-whisper
  if errorlevel 1 (
    echo.
    echo ERROR: Python not found. Install it from https://www.python.org and tick "Add python.exe to PATH".
    echo ОШИБКА: Python не найден. Установите с https://www.python.org и отметьте "Add python.exe to PATH".
    pause
    exit /b 1
  )
  echo.
  echo NOTE: in the Caption AE panel set the Python field to: py
  echo ВАЖНО: в панели Caption AE в поле Python впишите: py
)
echo.
echo Done / Готово. You can close this window.
pause
