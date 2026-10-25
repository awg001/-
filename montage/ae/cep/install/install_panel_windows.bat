@echo off
chcp 65001 >nul
rem Caption AE panel: copies the extension into the user's CEP folder and allows it in AE 2020-2026 (CSXS 9-12).
set "SRC=%~dp0com.captionae.panel"
set "DST=%APPDATA%\Adobe\CEP\extensions\com.captionae.panel"
if not exist "%SRC%\CSXS\manifest.xml" (
  echo ERROR: folder com.captionae.panel not found next to this file. Unpack the whole archive first.
  echo ОШИБКА: рядом нет папки com.captionae.panel. Сначала распакуйте весь архив.
  pause & exit /b 1
)
if exist "%DST%" rmdir /s /q "%DST%"
xcopy "%SRC%" "%DST%\" /e /i /q /y >nul
if errorlevel 1 ( echo ERROR: copy failed / ОШИБКА копирования & pause & exit /b 1 )
for %%v in (9 10 11 12) do reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul
echo.
echo Done. Restart After Effects: Window ^> Extensions ^> Caption AE
echo Готово. Перезапустите After Effects: Window ^> Extensions ^> Caption AE
echo (Speech recognition needs Python - see the guide / распознаванию нужен Python - см. инструкцию)
pause
