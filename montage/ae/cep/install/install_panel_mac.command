#!/bin/bash
# Caption AE panel: copies the extension into the user's CEP folder and allows it in AE 2020-2026 (CSXS 9-12).
cd "$(dirname "$0")"
SRC="$PWD/com.captionae.panel"
DST="$HOME/Library/Application Support/Adobe/CEP/extensions/com.captionae.panel"
if [ ! -f "$SRC/CSXS/manifest.xml" ]; then
  echo "ОШИБКА: рядом нет папки com.captionae.panel. Сначала распакуйте весь архив."
  echo "ERROR: folder com.captionae.panel not found next to this file."; read -n1; exit 1
fi
mkdir -p "$(dirname "$DST")" && rm -rf "$DST" && cp -R "$SRC" "$DST" || { echo "ОШИБКА копирования / copy failed"; read -n1; exit 1; }
xattr -dr com.apple.quarantine "$DST" 2>/dev/null
for v in 9 10 11 12; do defaults write com.adobe.CSXS.$v PlayerDebugMode 1; done
echo
echo "Готово. Перезапустите After Effects: Window → Extensions → Caption AE"
echo "Done. Restart After Effects: Window → Extensions → Caption AE"
echo "(Распознаванию нужен Python — см. инструкцию / speech recognition needs Python — see the guide)"
read -n1 -p "Нажмите любую клавишу / press any key"
