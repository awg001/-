// Caption AE — CEP panel logic. The text work (phrases, dictionary, SRT, sound plan) runs here with the same engine
// functions as After Effects (host/CaptionAE.jsx, loaded through Node); building layers goes to AE via CEP.call().
(function () {
    "use strict";
    var $ = function (id) { return document.getElementById(id); };
    var N = CEP.node, CK = null;
    try { CK = CEP.req(CEP.root + "/host/CaptionAE.jsx"); } catch (e) { CK = null; }

    // ---------- status line ----------
    var statusEl = $("status"), bar = $("bar"), barFill = $("barFill");
    function status(text, kind) { statusEl.textContent = text; statusEl.className = kind || ""; }
    function busy(on, pct) {
        bar.className = on && pct === undefined ? "busy" : "";
        barFill.style.width = on && pct !== undefined ? Math.round(pct * 100) + "%" : on ? "" : "0";
        if (!on) barFill.style.width = "0";
    }
    function fail(e) { busy(false); status(String(e && e.message || e), "err"); }
    function plural(n, f) { var a = Math.abs(n) % 100, b = a % 10; return n + " " + (a > 10 && a < 20 ? f[2] : b === 1 ? f[0] : b > 1 && b < 5 ? f[1] : f[2]); }
    function ask(text, yes) {
        return new Promise(function (resolve) {
            $("mtext").textContent = text; $("myes").textContent = yes || "Да"; $("modal").className = "";
            $("myes").onclick = function () { $("modal").className = "hidden"; resolve(true); };
            $("mno").onclick = function () { $("modal").className = "hidden"; resolve(false); };
        });
    }
    if (!CK) { status("Не загрузился движок (host/CaptionAE.jsx). Переустановите панель.", "err"); return; }

    // ---------- data the controls are filled from ----------
    var PRESETS = [
        ["Свои", null],
        ["Сторителлинг", { style: "soft", exit: "soft", font: "PlayfairDisplay-Regular", size: 74, kara: false, upper: false, stroke: false, shadow: true,
            hotHit: false, acc: "#FFFFFF", typo: "accent", font2: "PlayfairDisplay-Black", bigPct: 200, smallPct: 100, glow: "none", sweep: "none",
            heroUp: true, heroFly: true, noPunct: false, sfxPh: "none", sfxHit: false, display: "flow", posY: 72, maxWords: 3, zoom: false, accS: 112 }],
        ["TikTok", { style: "pop", exit: "fade", font: "Montserrat-ExtraBold", size: 80, kara: true, upper: true, stroke: true, shadow: true,
            hotHit: true, acc: "#FFFFFF", typo: "plain", font2: "PlayfairDisplay-Black", bigPct: 160, smallPct: 100, glow: "none", sweep: "none",
            heroUp: true, heroFly: false, noPunct: true, sfxPh: "half", sfxHit: true, display: "flow", posY: 72, maxWords: 3, zoom: false, accS: 112 }],
        ["Jatho — эксперт", { style: "jpop", exit: "fade", font: "Montserrat-ExtraBold", size: 92, kara: false, upper: true, stroke: false, shadow: true,
            hotHit: false, acc: "#E51926", typo: "plain", font2: "PlayfairDisplay-Black", bigPct: 160, smallPct: 100, glow: "none", sweep: "none",
            heroUp: true, heroFly: false, noPunct: true, sfxPh: "pause", sfxHit: true, display: "whole", posY: 75, maxWords: 3, zoom: true, accS: 100 }],
        ["Простые", { style: "none", exit: "none", font: "Montserrat-ExtraBold", size: 72, kara: false, upper: false, stroke: false, shadow: true,
            hotHit: false, acc: "#FFFFFF", typo: "plain", font2: "PlayfairDisplay-Black", bigPct: 160, smallPct: 100, glow: "none", sweep: "none",
            heroUp: false, heroFly: false, noPunct: false, sfxPh: "none", sfxHit: false, display: "whole", posY: 75, maxWords: 4, zoom: false, accS: 100 }]
    ];
    var DISPLAY = [["flow", "По мере речи"], ["single", "По одному слову"], ["whole", "Фраза целиком"], ["block", "Блок 2 строки"]];
    var TYPO = [["plain", "Одинаковая"], ["all", "Разная во всех фразах"], ["mix", "Микс: акценты и каждая 3-я"], ["accent", "Только акцентное слово"]];
    var LIGHT = [["none", "нет"], ["hot", "на акцентных"], ["all", "на всех"]];
    var SFX = [["none", "без звука"], ["all", "каждая фраза"], ["pause", "после паузы"], ["half", "каждая 2-я"]];
    var MIX_IN = [["pop", "Pop"], ["slide", "Выезд"], ["blur", "Размытие"], ["cut", "Рубленый"], ["rise", "Подъём"], ["flick", "Мерцание"], ["punch", "Удар"], ["glitch", "Глитч"], ["soft", "Кино"]];
    var MIX_OUT = [["fade", "Затухание"], ["shatter", "Распад"], ["up", "Вылет"], ["blurout", "Размытие"], ["flick", "Мерцание"], ["soft", "Мягкий"]];
    var HOOK_COL = [["красный — проблема", "#E51926"], ["зелёный — успех", "#39E75F"], ["жёлтый", "#FFD400"], ["фиолетовый — бренд", "#A855F7"], ["голубой — цифры", "#22D3EE"]];
    function fill(sel, list) { $(sel).innerHTML = list.map(function (o) { return '<option value="' + o[0] + '">' + o[1] + "</option>"; }).join(""); }
    fill("display", DISPLAY); fill("typo", TYPO); fill("glow", LIGHT); fill("sweep", LIGHT); fill("sfxPh", SFX);
    fill("exit", CK.EXIT_KEYS.map(function (k) { return [k, k === "mix" ? "Микс" : CK.EXITS[k].name]; }));
    fill("pN", [1, 2, 3, 4, 5, 6].map(function (n) { return [n, n]; }));
    fill("shKind", CK.SHAKE_KEYS.map(function (k) { return [k, CK.SHAKES[k]]; }));
    fill("shRh", CK.RHYTHM.map(function (r, i) { return [i, r[0]]; }));
    fill("shPow", CK.POWER.map(function (r, i) { return [i, r[0]]; }));
    fill("hKind", CK.PUNCH_KEYS.map(function (k) { return [k, CK.PUNCHES[k][0]]; }));
    fill("hkCol", HOOK_COL.map(function (c) { return [c[1], c[0]]; }));
    // mix checklists
    $("mixIn").innerHTML = "<span class=hint>Вход:</span>" + MIX_IN.map(function (m) { return '<label class="ck"><input type="checkbox" data-mix-in="' + m[0] + '"> ' + m[1] + "</label>"; }).join("");
    $("mixOut").innerHTML = "<span class=hint>Уход:</span>" + MIX_OUT.map(function (m) { return '<label class="ck"><input type="checkbox" data-mix-out="' + m[0] + '"> ' + m[1] + "</label>"; }).join("");
    // style cards with previews (img/style_<key>.webp, made by cep/previews/make_previews.js)
    var styleSel = "soft";
    $("styles").innerHTML = CK.STYLE_KEYS.map(function (k) {
        var name = k === "mix" ? "Микс" : CK.STYLES[k].name;
        return '<div class="scard" data-style="' + k + '" title="' + name + '"><img src="img/style_' + k + '.webp" alt="" onload="this.className=\'on\'"><span>' + name + "</span></div>";
    }).join("");
    $("presets").innerHTML = PRESETS.map(function (p, i) { return '<button class="chip" data-preset="' + i + '">' + p[0] + "</button>"; }).join("");
    // anchor grid
    var ag = ""; for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) ag += '<button data-anchor="' + r + "," + c + '" title="Точка привязки сюда"></button>';
    $("anchorGrid").innerHTML = ag;

    // ---------- settings: every control keeps its value between sessions ----------
    var DEF = { display: "flow", maxWords: 3, maxChars: 18, noPunct: false, keepQE: true, exit: "soft", smart: true, voice: true, thr: 5,
        hotHit: false, zoom: false, zoomAmt: 12, zoomKind: "0", font: "PlayfairDisplay-Regular", size: 74, posY: 72, txt: "#FFFFFF", acc: "#FFFFFF",
        hl: "#FFD400", accS: 112, kara: false, upper: false, stroke: false, shadow: true, mblur: true, typo: "accent", font2: "PlayfairDisplay-Black",
        bigPct: 200, smallPct: 100, heroUp: true, heroFly: true, glow: "none", sweep: "none", sfxPh: "none", sfxDb: -10, sfxHit: false,
        pN: "2", pLines: "1", pLead: 110, pBreak: true, pDurMode: "0", pDur: 1.5, pHold: 0.3, pFont: "Montserrat-ExtraBold", pSize: 72, pY: 75,
        pCol: "#FFFFFF", pUp: false, pSh: true, pNoP: false, pQE: true,
        shKind: "rise", shTarget: "frame", shRh: "2", shFreq: 14, shPow: "1", shPx: 25, shRot: 1.5, shZoom: 3, shDur: 1.5, shSharp: 2, shBlur: true, shKeep: true,
        hKind: "hit", hPow: "1", hDur: 1, hWhen: "0", hShake: true, hBlur: true, hk1: "SAME VIDEO BUT", hk2: "125X VIEWS", hkCol: "#E51926", hkDur: 1.8, hkY: 40, hkGlow: true,
        alignSel: false, cFrom: 0, cTo: 100, cDur: 2, cPre: "", cSuf: "", cDec: 0,
        lang: "ru", model: "small", python: defaultPython(), dict: "", sfxDir: CEP.root + "/host/CaptionAE_sounds" };
    var store = {};
    try { store = JSON.parse(localStorage.getItem("captionae") || "{}"); } catch (e) { store = {}; }
    function save() { try { localStorage.setItem("captionae", JSON.stringify(store)); } catch (e) {} }
    function get(id) { var el = $(id); return el.type === "checkbox" ? el.checked : el.type === "number" ? +el.value : el.value; }
    function set(id, v) { var el = $(id); if (!el) return; if (el.type === "checkbox") el.checked = !!v; else el.value = v; }
    Object.keys(DEF).forEach(function (id) {
        if (!$(id)) return;
        set(id, store[id] !== undefined ? store[id] : DEF[id]);
        $(id).addEventListener("change", function () { store[id] = get(id); save(); refresh(); });
    });
    styleSel = store.style || "soft";
    var mixIn = store.mixIn || MIX_IN.map(function (m) { return m[0]; }), mixOut = store.mixOut || MIX_OUT.map(function (m) { return m[0]; });
    document.querySelectorAll("[data-mix-in]").forEach(function (b) { b.checked = mixIn.indexOf(b.dataset.mixIn) >= 0; });
    document.querySelectorAll("[data-mix-out]").forEach(function (b) { b.checked = mixOut.indexOf(b.dataset.mixOut) >= 0; });
    document.addEventListener("change", function (e) {
        if (e.target.dataset.mixIn !== undefined || e.target.dataset.mixOut !== undefined) {
            store.mixIn = [].map.call(document.querySelectorAll("[data-mix-in]:checked"), function (b) { return b.dataset.mixIn; });
            store.mixOut = [].map.call(document.querySelectorAll("[data-mix-out]:checked"), function (b) { return b.dataset.mixOut; });
            save();
        }
    });
    // folding sections remember what was open
    document.querySelectorAll("details.sec").forEach(function (d) {
        d.open = !!(store.open && store.open[d.dataset.sec]);
        d.addEventListener("toggle", function () { store.open = store.open || {}; store.open[d.dataset.sec] = d.open; save(); });
    });
    function refresh() { // things that depend on other controls
        document.querySelectorAll(".scard").forEach(function (el) { el.classList.toggle("on", el.dataset.style === styleSel); });
        $("mixbox").style.display = styleSel === "mix" || $("exit").value === "mix" ? "" : "none";
        $("keepQE").disabled = !$("noPunct").checked; $("keepQE").parentNode.classList.toggle("off", !$("noPunct").checked);
        $("pQE").disabled = !$("pNoP").checked; $("pQE").parentNode.classList.toggle("off", !$("pNoP").checked);
        document.querySelectorAll(".chip").forEach(function (el) { el.classList.toggle("on", +el.dataset.preset === (store.preset === undefined ? 1 : store.preset)); });
    }
    function applyPreset(i) {
        store.preset = i; var P = PRESETS[i][1];
        if (P) {
            styleSel = P.style; store.style = P.style;
            var map = { exit: P.exit, font: P.font, size: P.size, kara: P.kara, upper: P.upper, stroke: P.stroke, shadow: P.shadow, hotHit: P.hotHit,
                acc: P.acc, txt: "#FFFFFF", hl: "#F7D640", typo: P.typo, font2: P.font2, bigPct: P.bigPct, smallPct: P.smallPct, glow: P.glow, sweep: P.sweep,
                heroUp: P.heroUp, heroFly: P.heroFly, noPunct: P.noPunct, keepQE: true, sfxPh: P.sfxPh, sfxHit: P.sfxHit, display: P.display, posY: P.posY,
                maxWords: P.maxWords, zoom: P.zoom, accS: P.accS, mblur: true };
            Object.keys(map).forEach(function (k) { set(k, map[k]); store[k] = map[k]; });
        }
        save(); refresh();
        status(P ? "Пресет «" + PRESETS[i][0] + "»: настройки заполнены, любую можно поменять." : "Свои настройки.");
    }

    // ---------- tabs ----------
    document.querySelectorAll(".tab").forEach(function (t) {
        t.addEventListener("click", function () { showTab(t.dataset.tab); });
    });
    function showTab(id) {
        document.querySelectorAll(".tab").forEach(function (x) { x.classList.toggle("on", x.dataset.tab === id); });
        document.querySelectorAll(".page").forEach(function (p) { p.classList.toggle("on", p.id === "p-" + id); });
        store.tab = id; save();
    }
    showTab(store.tab || "subs");

    // ---------- words: recognition / import → both tabs ----------
    var words = [], offset = 0, srcName = "", srcLayer = "";
    function hexRGB(h) { h = String(h).replace("#", ""); return [parseInt(h.substr(0, 2), 16) / 255, parseInt(h.substr(2, 2), 16) / 255, parseInt(h.substr(4, 2), 16) / 255]; }
    function fixWords() {
        var rules = CK.parseDict($("dict").value); if (!rules.length) return 0;
        var r = CK.applyDict(words, rules); words = r.words; return r.n;
    }
    function regroup() {
        if (!words.length) return;
        var mode = $("display").value, mw = Math.max(1, +$("maxWords").value || 3), mc = Math.max(4, +$("maxChars").value || 18);
        if (mode === "single") { mw = 1; mc = 999; }
        if (mode === "block") { mw *= 2; mc = mc * 2 + 1; }
        var ph = CK.groupPhrases(words, mw, mc, 0.4);
        if ($("voice").checked) CK.autoAccents(ph, +$("thr").value || 5);
        $("editor").value = CK.phrasesToText(ph);
        $("wordinfo").textContent = plural(words.length, ["слово", "слова", "слов"]) + " · строка = фраза · *слово* = акцент";
    }
    function syncPlain() { // plain-tab edits flow back into the words, so a new «Слов в строке» keeps them
        if (!words.length || !$("pEdit").value.trim()) return;
        var ph = CK.textToPhrases($("pEdit").value, words), nw = [];
        ph.forEach(function (p) { p.forEach(function (w) { nw.push({ w: w.w, start: w.start, end: w.end }); }); });
        if (nw.length) words = nw;
    }
    function plainRegroup(fresh) {
        if (!fresh) syncPlain();
        var n = +$("pN").value * +$("pLines").value;
        $("pEdit").value = words.length ? CK.phrasesToText(CK.groupPhrases(words, n, 999, $("pBreak").checked ? 0.4 : 1e9, !$("pBreak").checked)) : "";
        $("pInfo").textContent = words.length ? "Текст: " + plural(words.length, ["слово", "слова", "слов"]) : "Текст: ещё не загружен";
    }
    ["pN", "pLines", "pBreak"].forEach(function (id) { $(id).addEventListener("change", function () { plainRegroup(false); }); });
    function onWords(msg) {
        var fx = fixWords(); regroup(); plainRegroup(true);
        status(msg + (fx ? " Словарь исправил: " + fx + "." : "") + " Проверьте текст и нажмите «Создать субтитры».", "ok");
    }

    // ---------- recognition: Python runs as a child process, progress through a file ----------
    function defaultPython() {
        if (!N) return "python";
        if (N.os.platform() === "win32") return "python";
        var c = ["/opt/homebrew/bin/python3", "/usr/local/bin/python3", "/Library/Frameworks/Python.framework/Versions/Current/bin/python3", "/usr/bin/python3"];
        for (var i = 0; i < c.length; i++) if (N.fs.existsSync(c[i])) return c[i];
        return "python3";
    }
    var TRANSCRIBE = CEP.root + "/host/transcribe.py";
    function whyFailed(log) {
        if (/No module named|Не найден распознаватель/.test(log)) return "Распознавание не установлено для этого Python. Настройки → «Установить распознавание».";
        if (/FileNotFoundError|No such file/.test(log)) return "Python не нашёл файл видео/аудио этого слоя. Проверьте, что файл на месте и диск подключён.";
        if (/SSL|CERTIFICATE/i.test(log)) return "Не удалось скачать модель (сертификат). Mac: Программы → Python 3.x → «Install Certificates.command».";
        if (/HTTP|Connection|resolve|timed out|huggingface/i.test(log)) return "Не удалось скачать модель — при первом запуске нужен интернет.";
        if (/PyAV/.test(log)) return "Сломана библиотека чтения видео (PyAV). Настройки → «Установить распознавание» переустановит её.";
        if (!/Traceback/.test(log)) return "Python не запустился. Настройки → поле Python: python (или py); на Mac — путь из «which python3».";
        return "Распознавание не удалось. Пришлите скриншот: " + log.slice(-300);
    }
    function checkPython() {
        return new Promise(function (resolve) {
            N.cp.execFile($("python").value, ["-c", "import sys,importlib.util as u;print('Python '+sys.version.split()[0]+' '+sys.executable);print('FW_OK' if u.find_spec('faster_whisper') else 'FW_MISSING')"],
                { timeout: 30000, windowsHide: true }, function (err, out, errOut) {
                    var s = String(out || "") + String(errOut || "") + (err && !out ? String(err.message) : "");
                    var m = /Python (\S+) (.+)/.exec(s);
                    resolve({ ok: !!m, fw: /FW_OK/.test(s), version: m ? m[1] : "", exe: m ? m[2].trim() : "", raw: s });
                });
        });
    }
    var job = null;
    function stopJob() { if (job) { clearInterval(job.timer); job = null; } document.querySelectorAll('[data-act="recognize"]').forEach(function (b) { b.textContent = "Распознать речь слоя"; }); busy(false); }
    function recognize() {
        if (job) { // the same button cancels
            try { N.fs.writeFileSync(job.prog + ".cancel", "1"); } catch (e) {}
            try { job.child.kill(); } catch (e) {}
            stopJob(); status("Распознавание отменено."); return;
        }
        if (!N) return fail("Нет доступа к Python: панель открыта без Node.js.");
        var L;
        CEP.call("layer").then(function (l) { L = l; status("Проверяю Python…"); return checkPython(); }).then(function (py) {
            if (!py.ok) throw new Error(whyFailed(py.raw));
            if (!py.fw) return askInstall(py);
            var base = N.path.join(N.os.tmpdir(), "captionae_" + Date.now()), out = base + ".json", prog = base + "_progress.txt";
            var child = N.cp.spawn($("python").value, [TRANSCRIBE, L.path, out, $("lang").value, $("model").value, prog], { windowsHide: true });
            job = { child: child, prog: prog, out: out, t0: Date.now() };
            document.querySelectorAll('[data-act="recognize"]').forEach(function (b) { b.textContent = "Отменить распознавание"; });
            busy(true); status("Запускаю распознавание (" + $("model").value + ")…");
            job.timer = setInterval(function () {
                if (!job) return;
                var st = ["Запускаю распознавание", "0"];
                try { st = N.fs.readFileSync(prog, "utf8").split("|"); } catch (e) {}
                var pct = +st[1] || 0, secs = Math.round((Date.now() - job.t0) / 1000);
                busy(true, pct || undefined);
                status(st[0] + (pct ? " — " + Math.round(pct * 100) + " %" : "") + " · " + secs + " с · AE можно пользоваться");
            }, 500);
            child.on("exit", function () {
                if (!job || job.child !== child) return;
                stopJob();
                if (N.fs.existsSync(out)) {
                    words = CK.parseJSONWords(N.fs.readFileSync(out, "utf8")); offset = L.start; srcName = srcLayer = L.name;
                    try { N.fs.unlinkSync(out); N.fs.unlinkSync(prog); } catch (e) {}
                    onWords("Готово: " + plural(words.length, ["слово", "слова", "слов"]) + ".");
                } else {
                    var log = ""; try { log = N.fs.readFileSync(out + ".log", "utf8"); } catch (e) {}
                    if (/Cancelled/.test(log)) return status("Распознавание отменено.");
                    if (/No module named|Не найден распознаватель/.test(log)) return checkPython().then(askInstall);
                    fail(whyFailed(log));
                }
            });
        }).catch(fail);
    }
    function askInstall(py) {
        return ask("Распознавание не установлено для Python, которым пользуется панель:\n" + (py.exe || $("python").value) +
            "\n\nУстановить сейчас? 1–3 минуты, нужен интернет.", "Установить").then(function (yes) {
            if (!yes) return status("Распознавание не установлено. Настройки → «Установить распознавание».");
            return install();
        });
    }
    function install() {
        var base = N.path.join(N.os.tmpdir(), "captionae_install_" + Date.now()), t0 = Date.now();
        var child = N.cp.spawn($("python").value, [TRANSCRIBE, "--install", base], { windowsHide: true });
        busy(true); status("Устанавливаю распознавание…");
        var timer = setInterval(function () { status("Устанавливаю распознавание… " + Math.round((Date.now() - t0) / 1000) + " с"); }, 1000);
        return new Promise(function (resolve) {
            child.on("exit", function () {
                clearInterval(timer); busy(false);
                if (N.fs.existsSync(base + ".done")) status("Распознавание установлено. Нажмите «Распознать речь слоя».", "ok");
                else { var log = ""; try { log = N.fs.readFileSync(base + ".log", "utf8"); } catch (e) {} fail("Не удалось установить распознавание. Нужен интернет и Python 3.9–3.13. " + log.slice(-300)); }
                resolve();
            });
            child.on("error", function (e) { clearInterval(timer); fail("Python не запустился: " + e.message); resolve(); });
        });
    }

    // ---------- building: phrases + options → After Effects ----------
    function opts() {
        var en = {}; (store.mixIn || mixIn).forEach(function (k) { en[k] = true; }); (store.mixOut || mixOut).forEach(function (k) { en[k] = true; });
        return { en: en, smart: $("smart").checked, display: $("display").value, hotHit: $("hotHit").checked, typo: $("typo").value,
            font2: $("font2").value, bigPct: +$("bigPct").value || 160, smallPct: +$("smallPct").value || 65, glow: $("glow").value, sweep: $("sweep").value,
            heroUpper: $("heroUp").checked, heroFly: $("heroFly").checked, style: styleSel, exit: $("exit").value, mblur: $("mblur").checked,
            font: $("font").value, size: +$("size").value || 90, posY: (+$("posY").value || 72) / 100, maxChars: +$("maxChars").value || 18, hold: 0.4,
            text: hexRGB($("txt").value), hl: hexRGB($("hl").value), accent: hexRGB($("acc").value), karaoke: $("kara").checked, upper: $("upper").checked,
            stroke: $("stroke").checked, shadow: $("shadow").checked, noPunct: $("noPunct").checked, keepQE: $("keepQE").checked,
            accentScale: +$("accS").value || 112, zoomAmt: +$("zoomAmt").value || 12 };
    }
    function build() {
        if (!words.length || !$("editor").value.trim()) return fail("Сначала распознайте речь или импортируйте субтитры.");
        var ph = CK.textToPhrases($("editor").value, words), o = opts();
        var plan = CK.sfxPlan(ph, offset, $("sfxPh").value, $("sfxHit").checked);
        var a = { ph: ph, opt: o, offset: offset, sfx: plan.length ? { plan: plan, dir: $("sfxDir").value, db: +$("sfxDb").value || -10 } : null,
            zoom: $("zoom").checked ? { layer: srcLayer, smooth: $("zoomKind").value === "1" } : null };
        busy(true); status("Создаю субтитры…");
        CEP.call("build", a).then(function (r) {
            busy(false);
            status(r.note || ("Готово: " + plural(r.made, ["фраза", "фразы", "фраз"]) + (r.sounds ? ", " + plural(r.sounds, ["звук", "звука", "звуков"]) : "") +
                "." + (r.replaced ? " Прежние заменены — вернуть: Ctrl+Z." : "")), "ok");
        }).catch(fail);
    }
    function plainSetup() {
        var per = +$("pN").value, lines = +$("pLines").value, fixed = $("pDurMode").value === "1", col = hexRGB($("pCol").value);
        var ph = $("pEdit").value.trim() ? CK.textToPhrases($("pEdit").value, words) : CK.groupPhrases(words, per * lines, 999, $("pBreak").checked ? 0.4 : 1e9, !$("pBreak").checked);
        return { ph: ph, fixed: fixed, opt: { en: {}, smart: false, style: "none", exit: "none", mblur: false, font: $("pFont").value, size: +$("pSize").value || 72,
            posY: (+$("pY").value || 75) / 100, maxChars: 999, lineWords: lines === 2 ? per : 0, leadingPct: Math.max(50, +$("pLead").value || 110),
            hold: Math.max(0, +$("pHold").value || 0), fixedDur: fixed ? Math.max(0.2, +$("pDur").value || 1.5) : 0, text: col, hl: col, accent: col,
            karaoke: false, upper: $("pUp").checked, stroke: false, shadow: $("pSh").checked, hotHit: false, typo: "plain", glow: "none", sweep: "none",
            display: "whole", accentScale: 100, heroUpper: false, heroFly: false, noPunct: $("pNoP").checked, keepQE: $("pQE").checked } };
    }
    function pbuild() {
        if (!words.length) return fail("Сначала распознайте речь или импортируйте субтитры.");
        var P = plainSetup(); busy(true);
        CEP.call("build", { ph: P.ph, opt: P.opt, offset: offset }).then(function (r) {
            busy(false);
            status("Готово: " + plural(r.made, ["субтитр", "субтитра", "субтитров"]) + (P.fixed ? ", по " + P.opt.fixedDur + " с" : ", по речи") + "." +
                (r.replaced ? " Прежние заменены — вернуть: Ctrl+Z." : ""), "ok");
        }).catch(fail);
    }

    // ---------- files ----------
    function importFile() {
        CEP.call("pickOpen", { title: "Файл субтитров", filter: "Субтитры:*.srt;*.json,All:*.*" }).then(function (r) {
            if (!r.path) return;
            var s = N.fs.readFileSync(r.path, "utf8");
            try { words = /\.json$/i.test(r.path) ? CK.parseJSONWords(s) : CK.parseSRT(s); }
            catch (e) { throw new Error("Не удалось прочитать файл. Нужен SRT или JSON со словами."); }
            offset = 0; srcName = N.path.basename(r.path); srcLayer = "";
            onWords("Импортировано: " + plural(words.length, ["слово", "слова", "слов"]) + ".");
        }).catch(fail);
    }
    function saveSrt(ph, o) {
        var txt = CK.srtText(ph, offset, { hold: o.hold, fixedDur: o.fixedDur, noPunct: o.noPunct, keepQE: o.keepQE, lineWords: o.lineWords });
        if (!txt) return fail("Нет фраз для экспорта.");
        var name = (srcName || "subtitles").replace(/\.[^.]+$/, "") + ".srt";
        CEP.call("pickSave", { title: "Сохранить субтитры SRT", name: name, filter: "SRT:*.srt" }).then(function (r) {
            if (!r.path) return;
            var p = /\.srt$/i.test(r.path) ? r.path : r.path + ".srt";
            N.fs.writeFileSync(p, txt.replace(/\n/g, "\r\n"), "utf8");
            status("SRT сохранён: " + N.path.basename(p) + " — " + plural(txt.split(" --> ").length - 1, ["субтитр", "субтитра", "субтитров"]) + ".", "ok");
        }).catch(fail);
    }
    function dictSave() {
        store.dict = $("dict").value; save();
        var rules = CK.parseDict($("dict").value), n = 0;
        if (!rules.length) return status("Словарь пуст — в каждой строке «было = стало».");
        if (words.length) { var rw = CK.applyDict(words, rules); words = rw.words; n = rw.n; }
        if ($("editor").value.trim()) { var rt = CK.applyDictText($("editor").value, rules); $("editor").value = rt.text; n = Math.max(n, rt.n); }
        if ($("pEdit").value.trim()) $("pEdit").value = CK.applyDictText($("pEdit").value, rules).text;
        status("Словарь сохранён: " + plural(rules.length, ["замена", "замены", "замен"]) + ". Исправлено мест: " + n + ".", "ok");
    }

    // ---------- buttons ----------
    function done(msg) { return function (r) { busy(false); status(typeof msg === "function" ? msg(r) : msg, "ok"); }; }
    function run(cmd, args, msg) { busy(true); return CEP.call(cmd, args || {}).then(done(msg)).catch(fail); }
    var ACT = {
        recognize: recognize, import: importFile, build: build, pbuild: pbuild,
        regroup: function () { regroup(); status("Текст разбит заново."); },
        dict: function () { showTab("set"); $("dict").focus(); status("Словарь замен — во вкладке «Настройки»."); },
        dictSave: dictSave,
        srt: function () { if (!words.length) return fail("Сначала распознайте речь или импортируйте субтитры."); saveSrt(CK.textToPhrases($("editor").value, words), { hold: 0.4, noPunct: $("noPunct").checked, keepQE: $("keepQE").checked }); },
        psrt: function () { if (!words.length) return fail("Сначала распознайте речь или импортируйте субтитры."); var P = plainSetup(); saveSrt(P.ph, P.opt); },
        remove: function () { run("remove", {}, function (r) { return r.removed ? "Субтитры удалены. Вернуть: Ctrl+Z." : "В этой композиции нет субтитров Caption AE."; }); },
        recolor: function () { run("recolor", { text: hexRGB($("txt").value), hl: hexRGB($("hl").value), accent: hexRGB($("acc").value), karaoke: $("kara").checked },
            function (r) { return r.recolored ? "Перекрашено: " + plural(r.recolored, ["фраза", "фразы", "фраз"]) + ". Вернуть: Ctrl+Z." : "В этой композиции нет субтитров Caption AE."; }); },
        shake: function () {
            var o = { kind: $("shKind").value, target: $("shTarget").value, dur: Math.max(0.1, +$("shDur").value || 1.5), freq: +$("shFreq").value || 14,
                px: +$("shPx").value || 0, rot: +$("shRot").value || 0, zoom: +$("shZoom").value || 0, sharp: Math.max(1, Math.min(4, +$("shSharp").value || 2)),
                blur: $("shBlur").checked, keepSubs: $("shKeep").checked };
            run("shake", o, function (r) { return (o.target === "frame" ? "Тряска на весь кадр (слой SHAKE)" : "Тряска: " + plural(r.layers, ["слой", "слоя", "слоёв"])) +
                " на " + o.dur + " с — проиграйте этот участок."; });
        },
        hit: function () { run("hit", { kind: $("hKind").value, power: +$("hPow").value, dur: +$("hDur").value || 1, fromLayerStart: $("hWhen").value === "1",
            shake: $("hShake").checked, blur: $("hBlur").checked }, function (r) { return "Акцент: " + plural(r.layers, ["слой", "слоя", "слоёв"]) + "."; }); },
        glow: function () { run("glow", { size: +$("size").value || 90 }, function (r) { return "Свечение: " + plural(r.layers, ["слой", "слоя", "слоёв"]) + "."; }); },
        sweep: function () { run("sweep", { dur: +$("hDur").value || 1 }, function (r) { return "Блик: " + plural(r.layers, ["слой", "слоя", "слоёв"]) + "."; }); },
        hook: function () { run("hook", { l1: $("hk1").value, l2: $("hk2").value, color: hexRGB($("hkCol").value), dur: Math.max(0.3, +$("hkDur").value || 1.8),
            y: (+$("hkY").value || 40) / 100, glow: $("hkGlow").checked }, "Заголовок добавлен: слои HOOK 1 / HOOK 2."); },
        null: function () { run("nullParent", {}, function (r) { return r.children ? "Нуль «Управление»: " + plural(r.children, ["слой привязан", "слоя привязаны", "слоёв привязано"]) + "." : "Нуль добавлен."; }); },
        adjustment: function () { run("adjustment", {}, "Корректирующий слой добавлен."); },
        bounce: function () { run("bounce", {}, function (r) { return "Bounce: " + plural(r.props, ["свойство", "свойства", "свойств"]) + ". Сила — ползунки Bounce на слое."; }); },
        copyEase: function () { run("copyEase", {}, "Сглаживание скопировано — выделите ключи и нажмите «Вставить»."); },
        pasteEase: function () { run("pasteEase", {}, function (r) { return "Сглаживание вставлено: " + plural(r.keys, ["ключ", "ключа", "ключей"]) + "."; }); },
        splitWords: function () { run("split", { mode: "words" }, splitMsg); },
        splitLines: function () { run("split", { mode: "lines" }, splitMsg); },
        counter: function () { run("counter", { from: +$("cFrom").value || 0, to: +$("cTo").value, dur: +$("cDur").value || 2, prefix: $("cPre").value,
            suffix: $("cSuf").value, dec: +$("cDec").value || 0, font: $("pFont").value }, "Счётчик добавлен: число — ползунок «Число» на слое."); },
        organize: function () { run("organize", {}, function (r) { return r.moved ? "Разложено по папкам: " + plural(r.moved, ["элемент", "элемента", "элементов"]) + "." : "Раскладывать нечего — всё уже в папках."; }); },
        purge: function () { run("purge", {}, "Память очищена."); },
        clearFx: function () { run("clearFx", {}, function (r) { return r.removed ? "Снято: " + plural(r.removed, ["эффект", "эффекта", "эффектов"]) + "." : "На выделенных слоях нет эффектов Caption AE."; }); },
        checkPy: function () { if (!N) return fail("Нет Node.js в панели."); status("Проверяю…"); checkPython().then(function (p) {
            if (!p.ok) return fail(whyFailed(p.raw));
            status("Python " + p.version + " (" + p.exe + ") — распознавание " + (p.fw ? "установлено." : "НЕ установлено: нажмите «Установить распознавание»."), p.fw ? "ok" : "err"); }); },
        installRec: function () { if (!N) return fail("Нет Node.js в панели."); install(); },
        sfxPick: function () { CEP.call("pickFolder", { title: "Папка звуков (подпапки whoosh и hit)" }).then(function (r) { if (r.path) { set("sfxDir", r.path); store.sfxDir = r.path; save(); } }).catch(fail); }
    };
    function splitMsg(r) { return r.made ? "Готово: " + plural(r.made, ["слой", "слоя", "слоёв"]) + ", исходный слой выключен." + (r.skipped ? " Пропущено: " + r.skipped + "." : "") : "Выделите текстовый слой (без анимированной точки привязки)."; }
    document.addEventListener("click", function (e) {
        var t = e.target.closest("[data-act],[data-preset],[data-style],[data-anchor],[data-align]"); if (!t) return;
        if (t.dataset.act) return ACT[t.dataset.act]();
        if (t.dataset.preset !== undefined) return applyPreset(+t.dataset.preset);
        if (t.dataset.style) { styleSel = t.dataset.style; store.style = styleSel; store.preset = 0; save(); refresh(); return; }
        if (t.dataset.anchor) { var rc = t.dataset.anchor.split(","); return run("anchor", { r: +rc[0], c: +rc[1] }, function (r) {
            return "Точка привязки перенесена: " + plural(r.layers, ["слой", "слоя", "слоёв"]) + (r.skipped ? " (пропущено " + r.skipped + ": анимированная точка)" : "") + "."; }); }
        if (t.dataset.align) return run("align", { mode: t.dataset.align, toSel: $("alignSel").checked }, function (r) {
            return "Выровнено: " + plural(r.layers, ["слой", "слоя", "слоёв"]) + (r.skipped ? " (пропущено " + r.skipped + ": есть родитель)" : "") + "."; });
    });
    $("shRh").addEventListener("change", function () { set("shFreq", CK.RHYTHM[+$("shRh").value][1]); store.shFreq = +$("shFreq").value; save(); });
    $("shPow").addEventListener("change", function () { var w = CK.POWER[+$("shPow").value]; set("shPx", w[1]); set("shRot", w[2]); set("shZoom", w[3]);
        store.shPx = w[1]; store.shRot = w[2]; store.shZoom = w[3]; save(); });
    $("model").addEventListener("change", function () { if ($("model").value !== "small") status($("model").value + ": точнее, но дольше; в первый раз скачается " + ($("model").value === "medium" ? "~1,5" : "~3") + " ГБ."); });
    $("ver").textContent = "v" + (CEP.version || "1.0"); $("aboutVer").textContent = $("ver").textContent;
    refresh();
    status(CEP.inAE ? "Выделите слой с голосом и нажмите «Распознать речь слоя» — или импортируйте SRT." : "Предпросмотр вне After Effects.");
    window.CAE_TEST = { ACT: ACT, get words() { return words; }, set words(w) { words = w; }, onWords: onWords, store: store, applyPreset: applyPreset }; // for the self-test
})();
