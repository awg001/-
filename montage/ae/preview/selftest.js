// Self-test of the whole Caption AE panel without After Effects: runs CaptionAE.jsx's real UI code in an ES3 sandbox
// (like ExtendScript) over the AE mock (which invalidates references the way AE does), then presses every button
// in every mode: presets, styles, exits, display modes, typography and light, toggles, recolour, SRT, plain captions,
// shake (kind × target × rhythm × power), accent effects, glow, sweep, hook titles. Fails on any error or alert.
// Usage: node selftest.js   → "N cases ok … NO ERRORS". Run it before every build_zip.py.
// Drives the real Caption AE panel handlers in Node: ScriptUI stub (from ui_preview.js) + AE mock (mock_ae.js).
const fs = require("fs"), path = require("path"), vm = require("vm");
const OUT = require("os").tmpdir() + "/captionae_selftest";
const AE = process.argv[2] || path.join(__dirname, ".."), mock = require(path.join(AE, "preview/mock_ae.js"));
class Ctl {
    constructor(type, parent, text, props) {
        this.type = type; this.parent = parent; this.children = []; this.props = props || {};
        this.items = Array.isArray(text) ? text.slice() : null;
        this.text = Array.isArray(text) ? "" : (text || ""); this.value = false; this._sel = null; this.visible = true; this.enabled = true;
        this.preferredSize = { width: -1, height: -1 }; this.layout = { layout() {}, resize() {} };
    }
    add(type, b, text, props) { const c = new Ctl(type, this, text, props); this.children.push(c); return c; }
    set selection(v) { this._sel = typeof v === "number" ? v : v && v.index !== undefined ? v.index : null; }
    get selection() { return this._sel === null || !this.items ? null : { index: this._sel, text: this.items[this._sel] }; }
    center() {} update() {} close(v) { this._ret = v; }
    show() {
        if (this.type !== "dialog") { SHOWN.push(this); return; }
        const e = this.children.find(c => c.type === "edittext"); LOG.push("dialog shows: " + JSON.stringify(e.text));
        e.text = DIALOG_TEXT; return 1;
    }
    find(t) { if (this.text === t) return this; for (const c of this.children) { const r = c.find(t); if (r) return r; } return null; }
}
const SHOWN = [], LOG = [], WRITES = {}, settings = {};
let TASKS = 0, LAUNCHED = null;
// system.callSystem: "python --version" answers like Python; the background launch is recorded and run by the test
let HAS_FW = true, CONFIRM = true; const CONFIRMS = [];
// "python -c …import faster_whisper" answers like a Python with (or without) the recogniser; launches are recorded
let REAL_SPAWN = null; const TASKQ = [];
const SYS = c => { if (/ -c "import sys/.test(c)) return "Python 3.13.1 /usr/bin/python3\n" + (HAS_FW ? "FW_OK" : "FW_MISSING");
    LAUNCHED = c;
    if (REAL_SPAWN) return require("child_process").execSync(c.replace(/^"[^"]*"/, "python3"), { env: Object.assign({}, process.env, REAL_SPAWN) }).toString();
    return /--spawn/.test(c) ? "SPAWNED" : ""; };
let DIALOG_TEXT = "", OPEN_FILE = null;
class Window extends Ctl { constructor(type, title) { super(type === "dialog" ? "dialog" : "window", null, title); } }
class Panel {}
function FileS(p) {
    if (!(this instanceof FileS)) return new FileS(p);
    this.fsName = p; this.name = path.basename(p); this.parent = { fsName: path.dirname(p) };
}
FileS.prototype = {
    get exists() { return fs.existsSync(this.fsName); },
    open(m) { this.m = m; return true; }, read() { return fs.readFileSync(this.fsName, "utf8"); },
    write(s) { WRITES[this.fsName] = { text: s, lineFeed: this.lineFeed, encoding: this.encoding }; }, close() {},
    saveDlg() { return new FileS(OUT + "/" + this.name.replace(".srt", "")); }
};
FileS.openDialog = () => OPEN_FILE;
function FolderS(p) {
    return { fsName: p, get exists() { return fs.existsSync(p); },
        getFiles(fn) { return fs.readdirSync(p).map(n => new FileS(path.join(p, n))).filter(fn); } };
}
FolderS.temp = { fsName: OUT }; FolderS.desktop = { fsName: "/Users/me/Desktop" }; FolderS.selectDialog = () => null;
const items = [];
class FootageItem { constructor(f) { this.file = f; this.name = f.name; this.hasVideo = false; } }
class FolderItem { constructor(n) { this.name = n; } }
const sandbox = { Window, Panel, SHOWN, File: FileS, Folder: FolderS, FootageItem, FolderItem,
    ImportOptions: function (f) { this.file = f; },
    $: { fileName: path.join(AE, "CaptionAE.jsx"), os: "Windows", global: {}, sleep: ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) },
    ScriptUI: { environment: { keyboardState: { keyName: "" } } }, system: { callSystem: c => SYS(c) }, alert: m => LOG.push("ALERT: " + m), confirm: m => { CONFIRMS.push(m); return CONFIRM; } };
mock.install(sandbox);
mock.Layer.prototype.sourceRectAtTime = function () { return { left: -200, top: -50, width: 400, height: 100 }; };
Object.assign(sandbox.app, {
    settings: { haveSetting: (s, k) => (s + k) in settings, getSetting: (s, k) => settings[s + k], saveSetting: (s, k, v) => { settings[s + k] = v; } },
    preferences: { getPrefAsLong: () => 1 }, beginUndoGroup() {}, endUndoGroup() {},
    scheduleTask: (code, ms, rep) => { TASKQ.push(code); return ++TASKS; }, cancelTask() {},
    project: { activeItem: null, get numItems() { return items.length; }, item: i => items[i - 1],
        importFile(o) { const it = new FootageItem(o.file); items.push(it); return it; },
        items: { addFolder(n) { const f = new FolderItem(n); items.push(f); return f; } } }
});
const ES3 = `(function (o, ks) { for (var i = 0; i < ks.length; i++) delete o[ks[i]]; })
    (Array.prototype, ["indexOf", "lastIndexOf", "forEach", "map", "filter", "some", "every", "reduce", "reduceRight", "find", "findIndex", "includes", "fill"]);
(function (o, ks) { for (var i = 0; i < ks.length; i++) delete o[ks[i]]; })
    (String.prototype, ["trim", "trimStart", "trimEnd", "includes", "startsWith", "endsWith", "repeat", "padStart", "padEnd"]);
delete Array.isArray; delete Object.keys; delete Object.create; delete Object.assign; delete Function.prototype.bind; delete Date.now; delete this.JSON;`;
sandbox.global = sandbox; vm.createContext(sandbox); vm.runInContext(ES3, sandbox);
vm.runInContext(fs.readFileSync(path.join(AE, "CaptionAE.jsx"), "utf8").replace(/^﻿/, ""), sandbox);
const win = SHOWN[0], B = t => { const c = win.find(t); if (!c) throw new Error("no control " + t); return c; };
const status = () => win.children.find(c => c.type === "statictext").text;
const comp = new sandbox.CompItem(1080, 1920, 12, 30); sandbox.app.project.activeItem = comp;
const vid = comp.layers.addSolid([0,0,0], "talking_head.mp4", 1080, 1920); vid.source = { file: {} }; comp.selectedLayers = [vid];


// ---------- background recognition: real transcribe.py, fake recognizer, poll / progress / cancel / failure ----------
const cp = require("child_process");
const FW = OUT + "/fw/faster_whisper"; fs.mkdirSync(FW, { recursive: true });
fs.writeFileSync(FW + "/__init__.py", `import time
class W:
    def __init__(s, w, a, b): s.word, s.start, s.end = w, a, b
class WhisperModel:
    def __init__(self, model, device, compute_type): self.device = device
    def transcribe(self, media, **k):
        def gen():
            if self.device != "cpu": raise RuntimeError("Library cublas64_12.dll is not found")  # GPU without CUDA
            for i, t in enumerate(["Двенадцать", "лет", "царская", "власть", "охотилась", "за", "одним", "человеком."]):
                time.sleep(0.05); yield type("S", (), {"words": [W(" " + t, i * 0.5, i * 0.5 + 0.4)], "end": i * 0.5 + 0.5})()
        return gen(), type("I", (), {"duration": 4.0})()
`);
fs.writeFileSync(FW + "/audio.py", "import numpy as np\ndef decode_audio(m): return np.random.default_rng(0).normal(0, .1, 16000 * 3)\n");
const MEDIA = OUT + "/монтаж/Sequence 01.mp4"; fs.mkdirSync(path.dirname(MEDIA), { recursive: true }); fs.writeFileSync(MEDIA, "x");
vid.source = { file: { fsName: MEDIA, exists: true } }; comp.selectedLayers = [vid];
const pyArgs = cmd => cmd.match(/--spawn (.*)$/)[1].split(" ");
const runPy = (args, env) => cp.spawnSync("python3", [path.join(AE, "transcribe.py"), ...args], { env: Object.assign({}, process.env, env) });
const recErrs = [];
const tabs0 = win.children.find(c => c.type === "tabbedpanel");
const pEdit = (function f(c) { if (c.type === "edittext" && c.props.multiline) return c; for (const k of c.children) { const r = f(k); if (r) return r; } })(tabs0.children[1]);
// 0) AE's timer cannot reach the panel (the ping never fired): the progress window waits for a really detached run
REAL_SPAWN = { PYTHONPATH: OUT + "/fw" };
const tSync = Date.now(); B("Распознать речь слоя").onClick(); REAL_SPAWN = null;
const pal = SHOWN.find(w => w.text === "Caption AE");
if (!pal || !pal.children.some(c => c.type === "progressbar")) recErrs.push("no progress window in sync mode");
if (!/Двенадцать/.test(pEdit.text)) recErrs.push("sync mode: no text after waiting: " + status());
console.log("sync mode (progress window):", (Date.now() - tSync) + " ms →", status().slice(0, 50));
// Esc in the progress window stops it
sandbox.ScriptUI.environment.keyboardState.keyName = "Escape"; REAL_SPAWN = { PYTHONPATH: OUT + "/fw" };
B("Распознать речь слоя").onClick(); REAL_SPAWN = null; sandbox.ScriptUI.environment.keyboardState.keyName = "";
if (!/отменено/.test(status()) || win.find("Распознать речь слоя") === null) recErrs.push("Esc did not cancel: " + status());
// the timer works: the ping fires, everything below runs watched in the background
TASKQ.splice(0).forEach(code => vm.runInContext(code, sandbox));
const palsBefore = SHOWN.filter(w => w.text === "Caption AE").length;
// 1) success
B("Распознать речь слоя").onClick();
if (!LAUNCHED || !/--spawn hex:/.test(LAUNCHED)) recErrs.push("not launched detached: " + LAUNCHED);
if (SHOWN.filter(w => w.text === "Caption AE").length > palsBefore) recErrs.push("progress window shown although the timer works");
if (win.find("Отменить распознавание") === null) recErrs.push("button did not turn into cancel");
sandbox.$.global.CaptionAE_poll(); const st1 = status();
{ const pf = Buffer.from(pyArgs(LAUNCHED)[4].slice(4), "hex").toString(); fs.writeFileSync(pf, "Распознаю|0.420");
  sandbox.$.global.CaptionAE_poll(); if (!/Распознаю — 42 %/.test(status())) recErrs.push("progress not shown: " + status()); else console.log("progress:", status().slice(0, 40)); }
runPy(pyArgs(LAUNCHED), { PYTHONPATH: OUT + "/fw" });
sandbox.$.global.CaptionAE_poll();
console.log("recognition:", st1.slice(0, 60), "→", status().slice(0, 70));
if (!/Распознаю|Загружаю|Запускаю/.test(st1)) recErrs.push("no progress status: " + st1);
const ed0 = tabs0.children[0].find("Строка = фраза. Enter делит фразу, *слово* = акцент.").parent.children.find(c => c.type === "edittext");
if (!/Двенадцать/.test(ed0.text)) recErrs.push("subtitles tab text empty after recognition");
if (!/Двенадцать/.test(pEdit.text)) recErrs.push("plain tab text empty after recognition");
// 2) plain: fix a word, change words per line — the fix survives; build uses it
pEdit.text = pEdit.text.replace("охотилась", "ОХОТИЛАСЬ");
const pdd0 = (function all(c, r) { if (c.type === "dropdownlist") r.push(c); c.children.forEach(k => all(k, r)); return r; })(tabs0.children[1], []);
pdd0[0].selection = 2; pdd0[0].onChange();
if (!/ОХОТИЛАСЬ/.test(pEdit.text)) recErrs.push("plain edit lost on regroup: " + pEdit.text);
tabs0.children[1].find("Создать субтитры").onClick();
if (!comp.layerList.some(l => /ОХОТИЛАСЬ/.test(l.name))) recErrs.push("plain build ignored the edited text");
// 3) cancel
B("Распознать речь слоя").onClick(); const a3 = pyArgs(LAUNCHED);
tabs0.children[0].find("Отменить распознавание").onClick();
if (!/отменено/.test(status())) recErrs.push("cancel status: " + status());
const progFile = Buffer.from(a3[4].slice(4), "hex").toString();
if (!WRITES[progFile + ".cancel"]) recErrs.push("cancel file not written");
else fs.writeFileSync(progFile + ".cancel", "1"); // the stub File records writes; put it on disk for Python
const r3 = runPy(a3, { PYTHONPATH: OUT + "/fw" }), outF = Buffer.from(a3[1].slice(4), "hex").toString();
if (fs.existsSync(outF) || !/Cancelled/.test(fs.readFileSync(outF + ".log", "utf8"))) recErrs.push("transcribe.py ignored the cancel file");
// 4) recogniser missing (found by the quick check) → offer to install → install runs in the background → done
HAS_FW = false; B("Распознать речь слоя").onClick();
if (!/не установлено для Python/.test(CONFIRMS.join(" ")) || !/\/usr\/bin\/python3/.test(CONFIRMS.join(" "))) recErrs.push("no install offer naming the Python: " + CONFIRMS.join(" | "));
if (!/--install hex:/.test(LAUNCHED)) recErrs.push("install not launched: " + LAUNCHED);
const ib = Buffer.from(LAUNCHED.match(/--install hex:(\S+)/)[1], "hex").toString();
sandbox.$.global.CaptionAE_poll(); if (!/Устанавливаю/.test(status())) recErrs.push("install progress: " + status());
fs.writeFileSync(ib + ".log", "OK"); fs.writeFileSync(ib + ".done", ""); sandbox.$.global.CaptionAE_poll();
if (!/установлено/.test(status())) recErrs.push("install done status: " + status());
// 4b) declined → no launch, hint in the status
CONFIRM = false; LAUNCHED = null; B("Распознать речь слоя").onClick();
if (LAUNCHED || !/install_mac/.test(status())) recErrs.push("declined install: " + status());
// 4c) recognition itself fails with "not installed" (e.g. a different Python at run time) → offer again
HAS_FW = true; CONFIRM = true; B("Распознать речь слоя").onClick(); runPy(pyArgs(LAUNCHED), { PYTHONPATH: "" });
const nC = CONFIRMS.length; sandbox.$.global.CaptionAE_poll();
if (CONFIRMS.length !== nC + 1) recErrs.push("run-time missing recogniser did not offer install");
sandbox.$.global.CaptionAE_poll(); // the install job it started
tabs0.children[0].find("Отменить распознавание").onClick();
console.log(recErrs.length ? "RECOGNITION ERRORS:\n" + recErrs.join("\n") : "recognition: background run, progress, plain edits, cancel, failure — OK");

// ---------- full matrix: every option of every tab ----------
const errs = [], ok = [];
const tabsP = win.children.find(c => c.type === "tabbedpanel");
const all = (root, type) => { const r = []; (function w(c) { if (c.type === type) r.push(c); c.children.forEach(w); })(root); return r; };
const dd = (tab, i) => all(tabsP.children[tab], "dropdownlist")[i];
function click(label, tab, name) {
    const b = all(tabsP.children[tab], "button").find(x => x.text === name);
    const before = LOG.length;
    try { b.onClick(); } catch (e) { errs.push(label + " THROWS " + e.message); return; }
    const al = LOG.slice(before).filter(l => l.startsWith("ALERT"));
    if (al.length) errs.push(label + " ALERT " + al[0].replace(/\n/g, " ").slice(0, 200)); else ok.push(label);
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(OUT + "/m.srt", "1\n00:00:00,000 --> 00:00:01,200\nДвенадцать лет царская власть\n\n2\n00:00:01,500 --> 00:00:03,000\nохотилась за одним человеком!\n\n3\n00:00:03,600 --> 00:00:05,000\nПочему он бежал?\n\n4\n00:00:05,200 --> 00:00:06,600\nИ тут — взрыв.\n");
OPEN_FILE = new FileS(OUT + "/m.srt"); B("Импорт SRT / JSON").onClick();
const editor = all(tabsP.children[0], "edittext").find(e => e.props.multiline);
editor.text = editor.text.replace("власть", "*власть*").replace("взрыв.", "*взрыв.*");
const T0 = tabsP.children[0];
const ddStyle = all(T0, "dropdownlist").find(d => d.items && d.items[0] === "Микс" && d.items.length > 9);
const ddExit = all(T0, "dropdownlist").filter(d => d.items && d.items[0] === "Микс")[1];
const ddDisp = all(T0, "dropdownlist").find(d => d.items && d.items[0] === "По мере речи");
const ddTypo = all(T0, "dropdownlist").find(d => d.items && d.items[0] === "Одинаковая");
const ddLights = all(T0, "dropdownlist").filter(d => d.items && d.items[0] === "нет");
const cb = n => all(T0, "checkbox").find(c => c.text === n);
const pre = all(T0, "dropdownlist").find(d => d.items && d.items[0] === "Свои настройки");
const sfxDir = all(T0, "edittext").find(e => /CaptionAE_sounds|nope|\/x/.test(e.text));
sfxDir.text = AE + "/CaptionAE_sounds";
for (let k = 0; k < pre.items.length; k++) { pre.selection = k; pre.onChange(); click("preset " + pre.items[k], 0, "Создать субтитры"); }
pre.selection = 0;
for (let s = 0; s < ddStyle.items.length; s++) { ddStyle.selection = s; ddExit.selection = s % ddExit.items.length; ddStyle.onChange && ddStyle.onChange();
    click("style " + ddStyle.items[s] + " / exit " + ddExit.items[s % ddExit.items.length], 0, "Создать субтитры"); }
for (let e = 0; e < ddExit.items.length; e++) { ddExit.selection = e; click("exit " + ddExit.items[e], 0, "Создать субтитры"); }
for (let d = 0; d < ddDisp.items.length; d++) { ddDisp.selection = d; ddDisp.onChange(); editor.text = editor.text.replace(/\| (\S+)/, "| **"); click("display " + ddDisp.items[d], 0, "Создать субтитры"); }
for (let t = 0; t < ddTypo.items.length; t++) for (let g = 0; g < 3; g++) { ddTypo.selection = t; ddLights[0].selection = g; ddLights[1].selection = g;
    click("typo " + ddTypo.items[t] + " light " + g, 0, "Создать субтитры"); }
for (const n of ["Караоке", "КАПС", "Обводка", "Тень", "Motion blur", "Толчок на акцентах", "Панч-зум видео", "Без знаков препинания", "Умный подбор", "Акценты по голосу, дБ"]) {
    const c = cb(n); if (!c) { errs.push("no checkbox " + n); continue; } c.value = !c.value; click("toggle " + n, 0, "Создать субтитры"); }
click("recolor", 0, "Перекрасить готовые");
click("srt", 0, "Экспорт SRT");
click("delete", 0, "Удалить субтитры");
// plain tab
const T1 = tabsP.children[1], pdd = all(T1, "dropdownlist");
for (let n = 0; n < 6; n++) for (let l = 0; l < 2; l++) for (let du = 0; du < 2; du++) { pdd[0].selection = n; pdd[1].selection = l; pdd[2].selection = du;
    click("plain " + (n + 1) + "x" + (l + 1) + " dur" + du, 1, "Создать субтитры"); }
click("plain srt", 1, "Экспорт SRT");
// shake: every kind x target x rhythm x power
const T2 = tabsP.children[2], sdd = all(T2, "dropdownlist");
const txtL = comp.layerList.find(l => l.kind === "text");
for (let k = 0; k < 3; k++) for (let tg = 0; tg < 2; tg++) for (let rh = 0; rh < sdd[2].items.length; rh += 3) for (let pw = 0; pw < 3; pw++) {
    sdd[0].selection = k; sdd[1].selection = tg; sdd[2].selection = rh; sdd[2].onChange(); sdd[3].selection = pw; sdd[3].onChange();
    comp.selectedLayers = [txtL, vid]; comp.time = 1 + k;
    click("shake " + sdd[0].items[k] + " on " + sdd[1].items[tg] + " rh" + rh + " pw" + pw, 2, "Добавить тряску с текущего кадра"); }
// accent effects
const T3 = tabsP.children[3], hdd = all(T3, "dropdownlist");
for (let k = 0; k < hdd[0].items.length; k++) for (let pw = 0; pw < 3; pw++) for (let w = 0; w < 2; w++) {
    hdd[0].selection = k; hdd[1].selection = pw; hdd[2].selection = w; comp.selectedLayers = [txtL, vid];
    click("hit " + hdd[0].items[k] + " pw" + pw + " when" + w, 3, "Применить к выделенным слоям"); }
click("glow", 3, "Свечение"); click("sweep", 3, "Блик (Light Sweep) с текущего кадра");
for (let c = 0; c < hdd[3].items.length; c++) { hdd[3].selection = c; click("hook " + hdd[3].items[c], 3, "Добавить заголовок с текущего кадра"); }
// stale-reference check on what was built: every effect slider named in an expression exists on its layer
let refs = 0;
for (const L of comp.layerList) for (const fx of (L.property("ADBE Effect Parade").children)) {
    (function walk(p) { if (p.expression) { const m = p.expression.match(/effect\("([^"]+)"\)/g) || [];
        for (const x of m) { refs++; const n = x.slice(8, -2); if (!L.property("ADBE Effect Parade").children.some(e => e.name === n)) errs.push("missing effect " + n + " on " + L.name); } }
      p.children.forEach(walk); })(fx); }
console.log(ok.length, "cases ok;", refs, "effect references checked");
console.log(errs.length ? errs.join("\n") : "NO ERRORS");
// the shake bug's signature: an "amount" slider with no keyframes = a shake that never moves
let amounts = 0, dead = 0;
for (const L of comp.layerList) for (const fx of L.property("ADBE Effect Parade").children)
    if (/ amount$/.test(fx.name)) { amounts++; if (fx.property(1).keys.length < 2) dead++; }
console.log(amounts, "shake amount sliders,", dead, "without keyframes");
const kinds = {}; for (const L of comp.layerList) kinds[L.kind] = (kinds[L.kind] || 0) + 1; console.log("layers:", JSON.stringify(kinds));
if (errs.length || dead || recErrs.length) process.exit(1);
