// Caption AE — the After Effects side of the CEP panel. The panel (client/app.js) calls cae("command", "<json>");
// every command answers a JSON string {ok:true, ...} or {ok:false, error:"…"}. The work itself is done by the same
// engine as the ScriptUI panel: CaptionAE.jsx, loaded here in host mode (functions only, no window).
// The flag is cleared right away: the ScriptUI panel (CaptionAE.jsx in ScriptUI Panels) shares this engine and must still build its window.
$.global.CAPTIONAE_HOST = true;
try { $.evalFile(File(File($.fileName).parent.fsName + "/CaptionAE.jsx")); } finally { $.global.CAPTIONAE_HOST = false; }
var CK = $.global.CaptionAE;

// ExtendScript has no JSON.stringify: a small one for the answers
function caeJSON(v) {
    if (v === null || v === undefined) return "null";
    var t = typeof v, i, out;
    if (t === "number") return isFinite(v) ? String(v) : "null";
    if (t === "boolean") return v ? "true" : "false";
    if (t === "string") return '"' + v.replace(/[\\"\u0000-\u001f\u2028\u2029]/g, function (c) {
        var m = { "\\": "\\\\", '"': '\\"', "\n": "\\n", "\r": "\\r", "\t": "\\t" };
        return m[c] || "\\u" + ("000" + c.charCodeAt(0).toString(16)).slice(-4);
    }) + '"';
    if (v instanceof Array) { out = []; for (i = 0; i < v.length; i++) out.push(caeJSON(v[i])); return "[" + out.join(",") + "]"; }
    out = []; for (i in v) if (v.hasOwnProperty(i)) out.push(caeJSON(String(i)) + ":" + caeJSON(v[i]));
    return "{" + out.join(",") + "}";
}

function caeComp() {
    var c = app.project && app.project.activeItem;
    if (!(c && c instanceof CompItem)) throw new Error("Откройте композицию.");
    return c;
}
function caeSel(comp, need) {
    var s = comp.selectedLayers;
    if (need && !s.length) throw new Error("Выделите слои.");
    return s;
}

var CAE = {
    ping: function () { return { version: app.version, os: $.os, engine: "Caption AE" }; },

    // the selected footage layer for recognition
    layer: function () {
        var comp = caeComp(), L = comp.selectedLayers[0];
        if (!L || !L.source || !L.source.file) throw new Error("Выделите в композиции слой с аудио/видео файлом. Если это вложенная композиция — откройте её и выделите исходный слой.");
        if (L.source.footageMissing || !L.source.file.exists) throw new Error("Файл этого слоя не найден: " + L.source.file.fsName + ". Переподключите его (File → Replace Footage).");
        return { path: L.source.file.fsName, start: L.startTime, name: L.name };
    },

    // phrases + options from the panel → caption layers (+ sounds, + punch zoom)
    build: function (a) {
        var comp = caeComp(), opt = a.opt, i, made, ns = 0, old;
        opt.hl = a.opt.hl; opt.accent = a.opt.accent; opt.text = a.opt.text;
        if (a.zoom) { // the clip that was transcribed, else the selected footage layer
            var zl = null, sl = comp.selectedLayers;
            if (a.zoom.layer) for (i = 1; i <= comp.numLayers; i++) if (comp.layer(i).name === a.zoom.layer) zl = comp.layer(i);
            for (i = 0; !zl && i < sl.length; i++) if (sl[i].source && String(sl[i].comment).indexOf(CK.TAG) !== 0) zl = sl[i];
            if (!zl) throw new Error("Для панч-зума выделите слой с видео.");
            opt.zoomLayer = zl; opt.zoomDur = a.zoom.smooth ? 4 * comp.frameDuration : 0;
        }
        var SF = null;
        if (a.sfx && a.sfx.plan.length) {
            SF = { whoosh: CK.soundFiles(a.sfx.dir + "/whoosh"), hit: CK.soundFiles(a.sfx.dir + "/hit") };
            if (!SF.whoosh.length && !SF.hit.length) throw new Error("В папке звуков нет файлов: " + a.sfx.dir + ". Нужны подпапки whoosh и hit с WAV/MP3.");
        }
        app.beginUndoGroup("Caption AE: создать");
        try {
            old = CK.removeSubs(comp);
            made = CK.buildSubs(comp, a.ph, opt, a.offset || 0);
            if (SF) ns = CK.addSfx(comp, a.sfx.plan, SF, a.sfx.db);
        } finally { app.endUndoGroup(); }
        return { made: made, sounds: ns, replaced: old, note: opt.note || "" };
    },
    remove: function () {
        var comp = caeComp(); app.beginUndoGroup("Caption AE: удалить");
        try { return { removed: CK.removeSubs(comp) }; } finally { app.endUndoGroup(); }
    },
    recolor: function (a) {
        var comp = caeComp(); app.beginUndoGroup("Caption AE: перекрасить");
        try { return { recolored: CK.recolorSubs(comp, a) }; } finally { app.endUndoGroup(); }
    },

    // effects tab
    shake: function (a) {
        var comp = caeComp(), o = a, n = 0, i; o.t0 = comp.time;
        app.beginUndoGroup("Caption AE: тряска");
        try {
            if (a.target === "frame") { CK.shakeFrame(comp, o); n = 1; }
            else { var s = caeSel(comp, true); for (i = 0; i < s.length; i++) CK.addShake(comp, s[i], o); n = s.length; }
        } finally { app.endUndoGroup(); }
        return { layers: n, t0: o.t0 };
    },
    hit: function (a) {
        var comp = caeComp(), s = caeSel(comp, true), i, P = CK.PUNCHES[a.kind], mult = [0.5, 1, 1.6][a.power];
        var d = P[2] * Math.max(0.2, a.dur || 1);
        app.beginUndoGroup("Caption AE: акцент");
        try {
            for (i = 0; i < s.length; i++) {
                var t0 = a.fromLayerStart ? s[i].inPoint : comp.time;
                CK.addPunch(comp, s[i], { kind: a.kind, t0: t0, d: d, s: Math.round(100 + P[1] * mult), blur: a.blur });
                if (a.shake) CK.addShake(comp, s[i], { kind: "hit", t0: t0, dur: 0.35, freq: 20, px: Math.round(16 * mult), rot: 2 * mult, zoom: 0, sharp: 3, blur: a.blur });
            }
        } finally { app.endUndoGroup(); }
        return { layers: s.length };
    },
    glow: function (a) {
        var comp = caeComp(), s = caeSel(comp, true), i; app.beginUndoGroup("Caption AE: свечение");
        try { for (i = 0; i < s.length; i++) CK.addGlow(s[i], a.size || 90); } finally { app.endUndoGroup(); }
        return { layers: s.length };
    },
    sweep: function (a) {
        var comp = caeComp(), s = caeSel(comp, true), i; app.beginUndoGroup("Caption AE: блик");
        try { for (i = 0; i < s.length; i++) CK.addSweep(s[i], comp.time, 0.6 * Math.max(0.2, a.dur || 1)); } finally { app.endUndoGroup(); }
        return { layers: s.length };
    },
    hook: function (a) {
        var comp = caeComp(); app.beginUndoGroup("Caption AE: заголовок");
        try { CK.addHookTitle(comp, { l1: a.l1, l2: a.l2, color: a.color, t0: comp.time, dur: a.dur, y: a.y, font: a.font || "Montserrat-ExtraBold", glow: a.glow }); }
        finally { app.endUndoGroup(); }
        return { ok: 1 };
    },

    // tools tab
    anchor: function (a) {
        var comp = caeComp(), s = caeSel(comp, true), i, n = 0; app.beginUndoGroup("Caption AE: точка привязки");
        try { for (i = 0; i < s.length; i++) if (CK.moveAnchor(s[i], comp.time, a.r, a.c)) n++; } finally { app.endUndoGroup(); }
        return { layers: n, skipped: s.length - n };
    },
    align: function (a) {
        var comp = caeComp(), s = caeSel(comp, true), n; app.beginUndoGroup("Caption AE: выравнивание");
        try { n = CK.alignLayers(comp, s, a.mode, a.toSel && s.length > 1); } finally { app.endUndoGroup(); }
        return { layers: n, skipped: s.length - n };
    },
    nullParent: function () {
        var comp = caeComp(), s = caeSel(comp, false); app.beginUndoGroup("Caption AE: нуль");
        try { CK.nullParent(comp, s); } finally { app.endUndoGroup(); }
        return { children: s.length };
    },
    adjustment: function () {
        var comp = caeComp(), s = caeSel(comp, false); app.beginUndoGroup("Caption AE: корректирующий слой");
        try { CK.addAdjustment(comp, s); } finally { app.endUndoGroup(); }
        return { ok: 1 };
    },
    bounce: function () {
        var comp = caeComp(), n; app.beginUndoGroup("Caption AE: bounce");
        try { n = CK.addBounce(comp.selectedProperties); } finally { app.endUndoGroup(); }
        if (!n) throw new Error("Выделите свойства (Position, Scale, Rotation…) с двумя и больше ключами.");
        return { props: n };
    },
    copyEase: function () {
        if (!CK.copyEase(caeComp().selectedProperties)) throw new Error("Выделите ключ, сглаживание которого копировать.");
        return { ok: 1 };
    },
    pasteEase: function () {
        var comp = caeComp(), n; app.beginUndoGroup("Caption AE: вставить сглаживание");
        try { n = CK.pasteEase(comp.selectedProperties); } finally { app.endUndoGroup(); }
        if (n < 0) throw new Error("Сначала скопируйте сглаживание.");
        if (!n) throw new Error("Выделите ключи, куда вставить.");
        return { keys: n };
    },
    counter: function (a) {
        var comp = caeComp(); a.t0 = comp.time; app.beginUndoGroup("Caption AE: счётчик");
        try { CK.addCounter(comp, a); } finally { app.endUndoGroup(); }
        return { ok: 1 };
    },
    split: function (a) {
        var comp = caeComp(), s = caeSel(comp, true), i, n = 0, bad = 0; app.beginUndoGroup("Caption AE: разбить текст");
        try {
            for (i = 0; i < s.length; i++) {
                if (!(s[i] instanceof TextLayer)) { bad++; continue; }
                var r = CK.splitText(comp, s[i], a.mode); if (r < 0) bad++; else n += r;
            }
        } finally { app.endUndoGroup(); }
        return { made: n, skipped: bad };
    },
    organize: function () {
        app.beginUndoGroup("Caption AE: разложить проект");
        try { return { moved: CK.organizeProject() }; } finally { app.endUndoGroup(); }
    },
    purge: function () { app.purge(PurgeTarget.ALL_CACHES); return { ok: 1 }; },
    clearFx: function () {
        var comp = caeComp(), s = caeSel(comp, true), n; app.beginUndoGroup("Caption AE: снять эффекты");
        try { n = CK.clearCaeFx(s); } finally { app.endUndoGroup(); }
        return { removed: n };
    },

    // files: native dialogs (the panel reads / writes through Node)
    pickOpen: function (a) { var f = File.openDialog(a.title || "Файл", a.filter || "*.*"); return { path: f ? f.fsName : "" }; },
    pickSave: function (a) {
        var f = new File(Folder.desktop.fsName + "/" + (a.name || "file")).saveDlg(a.title || "Сохранить", $.os.indexOf("Windows") >= 0 ? (a.filter || "*.*") : undefined);
        return { path: f ? f.fsName : "" };
    },
    pickFolder: function (a) { var f = Folder.selectDialog(a.title || "Папка"); return { path: f ? f.fsName : "" }; }
};

function cae(cmd, json) {
    try {
        if (!CAE[cmd]) throw new Error("Неизвестная команда: " + cmd);
        var r = CAE[cmd](json ? CK.parseJSON(json) : {});
        r = r || {}; r.ok = true;
        return caeJSON(r);
    } catch (e) {
        return caeJSON({ ok: false, error: String(e && e.message || e), line: e && e.line });
    }
}
