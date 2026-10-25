// Self-test of the CEP panel without After Effects. The built extension is opened in Chromium (Playwright); its
// window.__adobe_cep__.evalScript goes to a Node vm that runs host/host.jsx + the engine in an ES3 sandbox (no JSON,
// no Array.indexOf…, like ExtendScript) over the AE mock (preview/mock_ae.js). Node's fs / child_process inside the
// panel are stand-ins: a memory file system and a fake Python that "recognises" a fixed sentence.
// Then every button is pressed in every mode; any error status, page error or failed AE call fails the test.
// Usage: python3 montage/ae/cep/build_cep.py OUT && node montage/ae/cep/test/paneltest.js OUT/com.captionae.panel [SHOTS_DIR]
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const { chromium } = require("playwright");
const EXT = path.resolve(process.argv[2] || "cep_build/com.captionae.panel"), SHOTS = process.argv[3];
const AE = path.join(__dirname, "..", ".."), mock = require(path.join(AE, "preview/mock_ae.js"));

// ---------- After Effects side: host.jsx in an ES3 sandbox over the mock ----------
const saved = [];
function FileS(p) {
    if (!(this instanceof FileS)) return new FileS(p);
    this.fsName = String(p); this.name = path.basename(this.fsName); this.parent = { fsName: path.dirname(this.fsName) };
}
FileS.prototype = {
    get exists() { return fs.existsSync(this.fsName) || /\.(mp4|wav|mov)$/.test(this.fsName); },
    saveDlg() { saved.push(this.name); return new FileS("/out/" + this.name); }
};
FileS.openDialog = () => new FileS("/in/subs.srt");
function FolderS(p) { return { fsName: p, get exists() { return fs.existsSync(p); }, getFiles(fn) { return fs.readdirSync(p).map(n => new FileS(path.join(p, n))).filter(fn); } }; }
FolderS.desktop = { fsName: "/Users/me/Desktop" }; FolderS.selectDialog = () => ({ fsName: path.join(EXT, "host/CaptionAE_sounds") });
const sandbox = { File: FileS, Folder: FolderS, alert: m => { throw new Error("alert in host: " + m); } };
mock.install(sandbox);
class FootageItem { constructor(f) { this.file = f; this.name = f.name; this.hasVideo = false; } }
const items = [], root = { name: "root" };
const comp = new sandbox.CompItem(1080, 1920, 12, 30); comp.name = "Main"; comp.parentFolder = root; items.push(comp);
Object.assign(sandbox, { FootageItem, ImportOptions: function (f) { this.file = f; } });
Object.assign(sandbox.app, { version: "24.6", beginUndoGroup() {}, endUndoGroup() {},
    project: { activeItem: comp, rootFolder: root, get numItems() { return items.length; }, item: i => items[i - 1],
        importFile(o) { const it = new FootageItem(o.file); it.parentFolder = root; items.push(it); return it; },
        items: { addFolder(n) { const f = new sandbox.FolderItem(n); f.parentFolder = root; items.push(f); return f; } } } });
// project items to sort: a used precomp, a solid, video, audio, picture
const pre = new sandbox.CompItem(1080, 1920, 5, 30); pre.name = "pre"; pre.usedIn = [comp]; pre.parentFolder = root; items.push(pre);
for (const n of ["clip.mp4", "music.wav", "logo.png"]) items.push({ name: n, file: { name: n }, parentFolder: root });
items.push({ name: "Black Solid", mainSource: new sandbox.SolidSource(), parentFolder: root });
const vid = comp.layers.addSolid([0, 0, 0], "talking_head.mp4", 1080, 1920);
vid.source = { file: { fsName: "/media/монтаж/Sequence 01.mp4", exists: true } };
comp.selectedLayers = [vid];
sandbox.$ = { fileName: path.join(EXT, "host/host.jsx"), os: "Windows 10", global: {},
    evalFile: f => vm.runInContext(fs.readFileSync(f.fsName || String(f), "utf8").replace(/^﻿/, ""), sandbox) };
sandbox.$.global = sandbox; sandbox.global = sandbox;
vm.createContext(sandbox);
vm.runInContext(`(function (o, ks) { for (var i = 0; i < ks.length; i++) delete o[ks[i]]; })
    (Array.prototype, ["indexOf", "lastIndexOf", "forEach", "map", "filter", "some", "every", "reduce", "reduceRight", "find", "findIndex", "includes", "fill"]);
(function (o, ks) { for (var i = 0; i < ks.length; i++) delete o[ks[i]]; })
    (String.prototype, ["trim", "trimStart", "trimEnd", "includes", "startsWith", "endsWith", "repeat", "padStart", "padEnd"]);
delete Array.isArray; delete Object.keys; delete Object.create; delete Object.assign; delete Function.prototype.bind; delete this.JSON;`, sandbox);
const calls = [];
function aeEval(code) {
    try { const r = vm.runInContext(code, sandbox); if (/^cae\(/.test(code)) calls.push(code.slice(4, 30) + " → " + String(r).slice(0, 120)); return String(r); }
    catch (e) { calls.push("EVAL THROWS " + e.message); return "EvalScript error."; }
}

// ---------- the panel: Chromium with CEP's Node stand-ins ----------
const ENGINE = fs.readFileSync(path.join(EXT, "host/CaptionAE.jsx"), "utf8").replace(/^﻿/, "");
const SRT = "1\n00:00:00,000 --> 00:00:01,200\nДвенадцать лет царская власть\n\n2\n00:00:01,500 --> 00:00:03,000\nохотилась за одним человеком!\n\n3\n00:00:03,600 --> 00:00:05,000\nПочему он бежал?\n";
function initScript({ engine, srt }) {
    const FS = { "/in/subs.srt": srt }, listeners = {};
    const fsS = { existsSync: p => p in FS || /python3$/.test(p), readFileSync: p => { if (!(p in FS)) throw new Error("ENOENT " + p); return FS[p]; },
        writeFileSync: (p, s) => { FS[p] = String(s); }, unlinkSync: p => { delete FS[p]; } };
    const pathS = { join: (...a) => a.join("/").replace(/\/+/g, "/"), basename: p => String(p).split(/[\\/]/).pop() };
    function proc() { const h = {}; return { on: (e, f) => { h[e] = f; }, emit: (e, x) => h[e] && h[e](x), kill() { this.killed = true; } }; }
    const cpS = {
        execFile: (exe, args, o, cb) => setTimeout(() => cb(null, "Python 3.12.4 /usr/bin/python3\n" + (window.__FW === false ? "FW_MISSING" : "FW_OK"), ""), 30),
        spawn: (exe, args) => {
            const p = proc(); window.__SPAWNS = (window.__SPAWNS || []).concat([args.join(" ")]);
            if (args[1] === "--install") { setTimeout(() => { FS[args[2] + ".done"] = ""; window.__FW = true; p.emit("exit", 0); }, 150); return p; }
            const [, media, out, , , prog] = args;
            setTimeout(() => { FS[prog] = "Распознаю|0.500"; }, 100);
            setTimeout(() => {
                if (p.killed) return;
                if (window.__FAIL) FS[out + ".log"] = window.__FAIL;
                else FS[out] = JSON.stringify(["Двенадцать", "лет", "царская", "власть", "охотилась", "за", "одним", "человеком."]
                    .map((w, i) => ({ word: w, start: i * 0.5, end: i * 0.5 + 0.4 })));
                p.emit("exit", 0);
            }, 900);
            return p;
        }
    };
    const osS = { tmpdir: () => "/tmp", platform: () => "darwin" };
    window.require = m => {
        if (/CaptionAE\.jsx$/.test(m)) { const mod = { exports: {} }; new Function("module", engine)(mod); return mod.exports; }
        return { fs: fsS, path: pathS, child_process: cpS, os: osS }[m];
    };
    window.__FS = FS;
    window.__adobe_cep__ = { evalScript: (code, cb) => window.__aeEval(code).then(cb) };
}

(async () => {
    const browser = await chromium.launch(), page = await browser.newPage({ viewport: { width: 380, height: 820 } });
    const pageErrors = [];
    page.on("pageerror", e => pageErrors.push(e.message));
    page.on("console", m => { if (m.type() === "error") pageErrors.push(m.text()); });
    await page.exposeFunction("__aeEval", aeEval);
    await page.addInitScript(initScript, { engine: ENGINE, srt: SRT });
    await page.goto("file://" + EXT + "/client/index.html");
    const errs = [], ok = [];
    const st = () => page.evaluate(() => ({ text: document.getElementById("status").textContent, cls: document.getElementById("status").className,
        busy: document.getElementById("bar").className }));
    async function settle() { for (let i = 0; i < 100; i++) { await page.waitForTimeout(20); if (!(await st()).busy && !(await page.evaluate(() => !!document.querySelector("#barFill[style*='%']")))) break; } }
    // press a button even inside a folded section; expectErr = the status must turn red with this text
    async function press(label, sel, expectErr) {
        const n0 = calls.length, e0 = pageErrors.length;
        await page.evaluate(s => { document.getElementById("status").textContent = "…"; document.getElementById("status").className = ""; document.querySelector(s).click(); }, sel);
        await settle(); await page.waitForTimeout(30);
        const s = await st(), bad = calls.slice(n0).filter(c => /"ok":false|THROWS|EvalScript error/.test(c));
        if (pageErrors.length > e0) errs.push(label + ": page error " + pageErrors.slice(e0).join(" | "));
        else if (expectErr ? !(s.cls === "err" && expectErr.test(s.text)) : s.cls === "err" || bad.length) errs.push(label + ": " + s.text + (bad.length ? " | " + bad[0] : ""));
        else ok.push(label);
        return s.text;
    }
    const val = (id, v) => page.evaluate(([id, v]) => { const el = document.getElementById(id); if (el.type === "checkbox") el.checked = v; else el.value = v;
        el.dispatchEvent(new Event("change", { bubbles: true })); }, [id, v]);
    const opts = id => page.evaluate(id => [...document.getElementById(id).options].map(o => o.value), id);
    const act = a => `[data-act="${a}"]`;

    if (!/Выделите слой/.test((await st()).text)) errs.push("start status: " + (await st()).text);
    // recognition: progress, result in both editors; cancel; missing recogniser → install offer; failure message
    await page.evaluate(() => document.querySelector('[data-act="recognize"]').click());
    await page.waitForTimeout(650);
    const mid = await st();
    if (!/Распознаю — 50 %/.test(mid.text)) errs.push("no progress: " + mid.text);
    await page.waitForTimeout(550);
    const ed = await page.evaluate(() => [document.getElementById("editor").value, document.getElementById("pEdit").value]);
    if (!/Двенадцать/.test(ed[0]) || !/Двенадцать/.test(ed[1])) errs.push("recognised text missing: " + JSON.stringify(ed));
    if (!/Готово: 8 слов/.test((await st()).text)) errs.push("after recognition: " + (await st()).text);
    const spawned = await page.evaluate(() => window.__SPAWNS[0]);
    if (!/transcribe\.py \/media\/монтаж\/Sequence 01\.mp4 \S+\.json ru small \S+_progress\.txt/.test(spawned)) errs.push("spawn args: " + spawned);
    await page.evaluate(() => document.querySelector('[data-act="recognize"]').click()); await page.waitForTimeout(200);
    await page.evaluate(() => document.querySelector('[data-act="recognize"]').click());
    if (!/отменено/.test((await st()).text)) errs.push("cancel: " + (await st()).text);
    await page.evaluate(() => { window.__FW = false; document.getElementById("myes").textContent = ""; document.querySelector('[data-act="recognize"]').click(); });
    await page.waitForTimeout(300);
    const modal = await page.evaluate(() => [document.getElementById("modal").className, document.getElementById("mtext").textContent]);
    if (modal[0] === "hidden" || !/\/usr\/bin\/python3/.test(modal[1])) errs.push("no install offer: " + JSON.stringify(modal));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "modal.png") });
    await page.click("#myes"); await page.waitForTimeout(400);
    if (!/установлено/.test((await st()).text)) errs.push("install: " + (await st()).text);
    await page.evaluate(() => { window.__FAIL = "Traceback…\nFileNotFoundError: [Errno 2]"; document.querySelector('[data-act="recognize"]').click(); });
    await page.waitForTimeout(1300);
    if (!/не нашёл файл/.test((await st()).text)) errs.push("failure message: " + (await st()).text);
    await page.evaluate(() => { window.__FAIL = null; document.querySelector('[data-act="recognize"]').click(); }); await page.waitForTimeout(1300);
    console.log(errs.length ? "RECOGNITION ERRORS\n" + errs.join("\n") : "recognition: progress, both editors, cancel, install offer, failure — OK");

    // import SRT (native dialog in AE, file read through Node)
    await press("import srt", act("import"));
    if (!/Почему он бежал/.test(await page.evaluate(() => document.getElementById("editor").value))) errs.push("import: editor empty");
    await page.evaluate(() => { const e = document.getElementById("editor"); e.value = e.value.replace("власть", "*власть*").replace("бежал?", "*бежал?*"); });
    // subtitles: presets, every style card, every exit, display modes, typography × light, toggles
    const nPre = await page.evaluate(() => document.querySelectorAll("[data-preset]").length);
    for (let i = 0; i < nPre; i++) { await page.evaluate(i => document.querySelector(`[data-preset="${i}"]`).click(), i); await press("preset " + i, act("build")); }
    const styles = await page.evaluate(() => [...document.querySelectorAll("[data-style]")].map(e => e.dataset.style));
    const exits = await opts("exit");
    for (let i = 0; i < styles.length; i++) { await page.evaluate(s => document.querySelector(`[data-style="${s}"]`).click(), styles[i]); await val("exit", exits[i % exits.length]);
        await press("style " + styles[i] + " / exit " + exits[i % exits.length], act("build")); }
    for (const e of exits) { await val("exit", e); await press("exit " + e, act("build")); }
    for (const d of await opts("display")) { await val("display", d); await press("display " + d, act("build")); }
    for (const t of await opts("typo")) for (const g of await opts("glow")) { await val("typo", t); await val("glow", g); await val("sweep", g); await press("typo " + t + " light " + g, act("build")); }
    for (const c of ["kara", "upper", "stroke", "shadow", "mblur", "hotHit", "zoom", "noPunct", "smart", "voice", "heroUp", "heroFly", "sfxHit"]) {
        const v = await page.evaluate(c => document.getElementById(c).checked, c); await val(c, !v); await press("toggle " + c, act("build")); }
    for (const s of await opts("sfxPh")) { await val("sfxPh", s); await press("sounds " + s, act("build")); }
    if (!comp.layerList.some(l => l.kind === "audio")) errs.push("no sound layers were added");
    await press("recolor", act("recolor"));
    await press("srt", act("srt"));
    if (!/-->/.test(await page.evaluate(() => window.__FS["/out/subs.srt"] || ""))) errs.push("SRT not written: " + JSON.stringify(saved));
    await press("regroup", act("regroup"));
    await page.evaluate(() => { document.getElementById("dict").value = "царская = Царская"; });
    await press("dictionary", act("dictSave"));
    if (!/Царская/.test(await page.evaluate(() => document.getElementById("editor").value))) errs.push("dictionary not applied");
    await press("remove", act("remove"));
    // plain captions
    for (const n of ["1", "3", "6"]) for (const l of ["1", "2"]) for (const d of ["0", "1"]) {
        await val("pN", n); await val("pLines", l); await val("pDurMode", d); await press(`plain ${n}x${l} dur${d}`, act("pbuild")); }
    await press("plain srt", act("psrt"));
    // effects: shake (kind × target × power), hits, glow, sweep, hook
    const txt = comp.layerList.find(l => l.kind === "text");
    for (const k of await opts("shKind")) for (const t of await opts("shTarget")) for (const p of await opts("shPow")) {
        comp.selectedLayers = [txt]; comp.time = 1; await val("shKind", k); await val("shTarget", t); await val("shPow", p); await press(`shake ${k} ${t} ${p}`, act("shake")); }
    for (const k of await opts("hKind")) for (const w of await opts("hWhen")) { comp.selectedLayers = [txt, vid]; await val("hKind", k); await val("hWhen", w); await press(`hit ${k} ${w}`, act("hit")); }
    comp.selectedLayers = [txt]; await press("glow", act("glow")); await press("sweep", act("sweep"));
    for (const c of await opts("hkCol")) { await val("hkCol", c); await press("hook " + c, act("hook")); }
    comp.selectedLayers = []; await press("hit without selection", act("hit"), /Выделите слои/);
    // tools
    const T = comp.layers.addText("Два слова"); const td = T.property("ADBE Text Properties").property("ADBE Text Document").value;
    td.fontSize = 100; td.font = "Montserrat"; td.justification = "center";
    T.property("ADBE Transform Group").property("ADBE Position").setValue([540, 900]);
    comp.selectedLayers = [T];
    const box = () => { const L = T, rc = L.sourceRectAtTime(), a = L.property("ADBE Transform Group").property("ADBE Anchor Point").value,
        p = L.property("ADBE Transform Group").property("ADBE Position").value; return [p[0] - a[0] + rc.left + rc.width / 2, p[1] - a[1] + rc.top + rc.height / 2].map(Math.round); };
    const box0 = box().join();
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) await press(`anchor ${r},${c}`, `[data-anchor="${r},${c}"]`);
    // the anchor moved, the text did not: box centre stays put
    if (box().join() !== box0) errs.push("anchor moved the text: " + box());
    const T2 = comp.layers.addText("Второй"); T2.property("ADBE Text Properties").property("ADBE Text Document").value.fontSize = 60;
    for (const sel of [false, true]) for (const m of ["left", "hcenter", "right", "top", "vcenter", "bottom"]) {
        comp.selectedLayers = [T, T2]; await val("alignSel", sel); await press(`align ${m} ${sel ? "selection" : "comp"}`, `[data-align="${m}"]`); }
    await val("alignSel", false); comp.selectedLayers = [T]; await page.evaluate(() => document.querySelector('[data-align="left"]').click()); await settle();
    if (Math.round(T.property("ADBE Transform Group").property("ADBE Position").value[0] - T.property("ADBE Transform Group").property("ADBE Anchor Point").value[0] + T.sourceRectAtTime().left) !== 0)
        errs.push("align left: box not at x=0");
    comp.selectedLayers = [T, T2]; await press("null parent", act("null"));
    if (T.parent === null || T.parent.name !== "Управление") errs.push("null: no parent");
    await press("adjustment", act("adjustment"));
    const P = T2.property("ADBE Transform Group").property("ADBE Position"); P.setValueAtTime(0, [100, 100]); P.setValueAtTime(1, [500, 300]);
    const S = T2.property("ADBE Transform Group").property("ADBE Scale"); S.setValueAtTime(0, [0, 0, 100]); S.setValueAtTime(1, [100, 100, 100]);
    comp.selectedProperties = [P, S]; await press("bounce", act("bounce"));
    if (!/Caption AE bounce/.test(P.expression) || !T2.property("ADBE Effect Parade").children.some(e => e.name === "Bounce сила")) errs.push("bounce not added");
    S.selectedKeys = [1]; S.setInterpolationTypeAtKey(1, 1, 1); comp.selectedProperties = [S]; await press("copy ease", act("copyEase"));
    P.selectedKeys = [1, 2]; comp.selectedProperties = [P]; await press("paste ease", act("pasteEase"));
    if (P.keyInInterpolationType(2) !== 1) errs.push("ease not pasted");
    comp.selectedProperties = []; await press("paste ease without keys", act("pasteEase"), /Выделите ключи/);
    const T3 = comp.layers.addText("Первая строка\rвторая"); T3.property("ADBE Text Properties").property("ADBE Text Document").value.fontSize = 80;
    comp.selectedLayers = [T3]; const n0 = comp.numLayers; await press("split lines", act("splitLines"));
    if (comp.numLayers !== n0 + 2 || T3.enabled) errs.push("split lines: " + (comp.numLayers - n0) + " layers");
    comp.selectedLayers = [T3]; await press("split words", act("splitWords"));
    await press("counter", act("counter"));
    const cnt = comp.layerList.find(l => l.name === "Счётчик");
    if (!cnt || !/toFixed/.test(cnt.property("ADBE Text Properties").property("ADBE Text Document").expression)) errs.push("counter missing");
    await press("organize", act("organize"));
    const where = n => (items.find(i => i.name === n).parentFolder || {}).name;
    if (where("pre") !== "Прекомпы" || where("Main") !== "Композиции" || where("clip.mp4") !== "Видео" || where("music.wav") !== "Аудио" || where("logo.png") !== "Картинки" || where("Black Solid") !== "Солиды")
        errs.push("organize: " + ["pre", "Main", "clip.mp4", "music.wav", "logo.png", "Black Solid"].map(n => n + "→" + where(n)).join(", "));
    await press("organize again", act("organize"));
    await press("purge", act("purge"));
    comp.selectedLayers = [txt, T2]; const fx0 = txt.property("ADBE Effect Parade").numProperties;
    await press("clear effects", act("clearFx"));
    if (!fx0 || txt.property("ADBE Effect Parade").children.some(e => /^(Shake|Hit|CAE |Bounce )/.test(e.name)) || /bounce/.test(P.expression)) errs.push("clearFx left effects");
    // settings
    await press("check python", act("checkPy"));
    await press("sound folder", act("sfxPick"));
    // no comp open → a clear message, not a crash
    sandbox.app.project.activeItem = null; await press("no comp", act("remove"), /Откройте композицию/); sandbox.app.project.activeItem = comp;
    // settings survive a reload
    await val("size", 81); await page.reload(); await page.waitForTimeout(300);
    if (await page.evaluate(() => document.getElementById("size").value) !== "81") errs.push("settings not kept after reload");

    if (SHOTS) { // every tab at panel size, sections open
        fs.mkdirSync(SHOTS, { recursive: true });
        await page.evaluate(() => { window.CAE_TEST.words = [{ w: "Двенадцать", start: 0, end: .4 }, { w: "лет", start: .5, end: .9 }, { w: "царская", start: 1, end: 1.4 },
            { w: "власть", start: 1.5, end: 1.9 }]; window.CAE_TEST.onWords("Готово: 4 слова."); });
        for (const t of ["subs", "plain", "fx", "tools", "set"]) {
            await page.evaluate(t => { document.querySelector(`.tab[data-tab="${t}"]`).click(); }, t);
            await page.screenshot({ path: path.join(SHOTS, t + ".png") });
            await page.evaluate(t => document.querySelectorAll(`#p-${t} details.sec`).forEach(d => { d.open = true; }), t);
            await page.screenshot({ path: path.join(SHOTS, t + "_open.png"), fullPage: false });
            const h = await page.evaluate(() => document.querySelector("main").scrollHeight);
            await page.setViewportSize({ width: 380, height: h + 160 }); await page.screenshot({ path: path.join(SHOTS, t + "_full.png") });
            await page.setViewportSize({ width: 380, height: 820 });
            await page.evaluate(t => document.querySelectorAll(`#p-${t} details.sec`).forEach(d => { d.open = false; }), t);
        }
        await page.setViewportSize({ width: 300, height: 600 }); await page.evaluate(() => document.querySelector('.tab[data-tab="subs"]').click());
        await page.screenshot({ path: path.join(SHOTS, "narrow.png") });
        const over = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
        if (over) errs.push("horizontal scroll at 300 px");
    }
    await browser.close();
    console.log(ok.length, "cases ok;", calls.length, "AE calls");
    console.log(errs.length ? errs.join("\n") : "NO ERRORS");
    process.exit(errs.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
