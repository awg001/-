# Caption AE — панель с вкладками (CEP / ZXP)

Та же Caption AE, но HTML-панелью с вкладками сверху: **Субтитры · Простые · Эффекты · Инструменты · ⚙**.
Движок общий со ScriptUI-панелью: `host/host.jsx` подгружает `CaptionAE.jsx` в режиме «только функции» (флаг `CAPTIONAE_HOST`)
и отвечает на команды `cae("build", "<json>")` JSON-ом. Текстовая работа (фразы, словарь, SRT, план звуков) идёт в панели
теми же функциями движка через Node (`require(".../CaptionAE.jsx")`), распознавание — `transcribe.py` дочерним процессом Node.

```
cep/CSXS/manifest.xml   AEFT 17+, CSXS 9, Node (--enable-nodejs --mixed-context)
cep/client/             index.html, style.css, cep.js (мост evalScript + Node), app.js (логика), img/ (иконка, превью стилей)
cep/host/host.jsx       команды для AE
cep/install/            установщики панели (Windows .bat, Mac .command) и инструкции RU/EN
cep/sign/               самоподписанный сертификат ZXP (ключ в репозитории намеренно: доверия не даёт, держит обновления под одним сертификатом)
cep/build_cep.py        сборка + подпись ZXP
cep/test/paneltest.js   самопроверка панели
```

## Сборка
```bash
python3 montage/ae/cep/build_cep.py OUT
# OUT/com.captionae.panel/  подписанная папка расширения (= распакованный zxp)
# OUT/CaptionAE.zxp         для ZXP-установщиков
# OUT/CaptionAE_panel.zip   папка + zxp + установщики — это отдавать тестерам
```
Подпись — формат Adobe ZXP (UCF-zip: `mimetype` первым без сжатия, `META-INF/signatures.xml` XML-DSig: SHA-256 каждого файла
в `<Manifest>`, его каноническая форма → `<SignedInfo>`, подпись RSA-SHA1). У Adobe ZXPSignCmd нет сборки под Linux, поэтому своя.
Каноникализация — **exclusive c14n** (хотя в XML записан inclusive): так считает подписчик Adobe, проверено на настоящем ZXP.
`build_cep.py --verify файл.zxp` проверяет любой пакет как установщик.

## Проверка без AE
```bash
export NODE_PATH=$(npm root -g)          # playwright
python3 montage/ae/cep/build_cep.py /tmp/cepb
node montage/ae/cep/test/paneltest.js /tmp/cepb/com.captionae.panel [папка_для_скриншотов]
```
Панель открывается в Chromium; `__adobe_cep__.evalScript` уходит в Node vm, где `host.jsx` + движок работают в песочнице ES3
(нет JSON, Array.indexOf… — как ExtendScript) поверх мока AE (`preview/mock_ae.js`). Node внутри панели заменён памятью и
поддельным Python. Тест жмёт все кнопки во всех режимах (распознавание с прогрессом/отменой/установкой/ошибкой, пресеты, стили,
уходы, показ, типографика, звуки, простые субтитры, тряска, акценты, хук, все инструменты) и падает на любой красной строке статуса.

## Уроки
- AE и ScriptUI-панель живут в одном движке ExtendScript: флаг `CAPTIONAE_HOST` после загрузки сбрасывать, иначе
  ScriptUI-панель при следующем открытии загрузится «без окна».
- Кнопки внутри свёрнутых `<details>` — нажимать в тесте через `element.click()`, не через клик мышью.
