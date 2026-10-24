// Virtual After Effects preview for Caption AE.
// 1) runs CaptionAE.jsx's real build functions against mock_ae.js (the same calls the panel makes),
// 2) plays the recorded comp back frame by frame, evaluating the plugin's own expressions
//    (reveal, karaoke, accents, exits, hits, shake, light sweep) and drawing text with node canvas.
// Approximations: no motion blur, wiggle uses its own noise, glow / sweep / shadow are drawn by hand.
// Usage: node render.js <outDir> <firstFrame> <lastFrame>    (needs @napi-rs/canvas)
const fs = require("fs"), path = require("path");
const { createCanvas, loadImage, GlobalFonts } = require("@napi-rs/canvas");
const mock = require("./mock_ae.js");
mock.install(global);
const CK = require("../CaptionAE.jsx");

const ROOT = path.resolve(__dirname, "../../..");
const FONTS = { "Montserrat-ExtraBold": ["work/fonts/montserrat-800-normal.ttf", "MontEB"],
    "PlayfairDisplay-Black": ["work/fonts/playfair-display-900-normal.ttf", "PlayBlack"],
    "PlayfairDisplay-Regular": ["work/fonts/playfair-display-400-normal.ttf", "PlayReg"] };
for (const k in FONTS) GlobalFonts.registerFromPath(path.join(ROOT, FONTS[k][0]), FONTS[k][1]);
const family = ps => (FONTS[ps] || FONTS["Montserrat-ExtraBold"])[1];

const W = 1080, H = 1920, FPS = 30;

// ---------- scenes: what the panel would do ----------
// SCENE=story (default): the "Сторителлинг — сдержанно" preset over the whole clip; SCENE=mix: everything switched on
function scene() {
    const k = process.env.SCENE || "story";
    return k === "mix" ? sceneMix() : k === "jatho" ? sceneJatho() : k === "plain" ? scenePlain() : sceneStory();
}

// "Простые субтитры" tab: N words per caption (PLAIN_N, default 2), no animation, fixed PLAIN_DUR seconds or by speech
function scenePlain() {
    const words = CK.parseJSONWords(fs.readFileSync(path.join(ROOT, "montage/projects/zelimkhan/words.json"), "utf8")).filter(w => w.start < 10);
    const comp = new CompItem(W, H, 10.4, FPS);
    comp.layers.addSolid([0, 0, 0], "BG", W, H);
    const per = +(process.env.PLAIN_N || 2), lines = +(process.env.PLAIN_LINES || 1), fixed = +(process.env.PLAIN_DUR || 0);
    const ph = CK.groupPhrases(words, per * lines, 999, 0.4, false);
    CK.buildSubs(comp, ph, { en: {}, smart: false, style: "none", exit: "none", mblur: false, font: "Montserrat-ExtraBold", size: 72, posY: 0.75,
        maxChars: 999, lineWords: lines === 2 ? per : 0, leadingPct: +(process.env.PLAIN_LEAD || 110), hold: 0.3, fixedDur: fixed, hl: [1, 1, 1], accent: [1, 1, 1], karaoke: false, upper: false, stroke: false, shadow: true,
        hotHit: false, typo: "plain", glow: "none", sweep: "none", display: "whole", accentScale: 100, heroUpper: false, heroFly: false }, 0);
    return { comp, phA: CK.phrasesToText(ph), phB: "" };
}

// "Jatho — эксперт" preset: two-tone hook title, phrase pops in white caps, accent words red, punch-in on accents
function sceneJatho() {
    const words = CK.parseJSONWords(fs.readFileSync(path.join(ROOT, "montage/projects/zelimkhan/words.json"), "utf8")).filter(w => w.start < 15.3);
    const comp = new CompItem(W, H, 15.6, FPS);
    const foot = comp.layers.addSolid([0, 0, 0], "BG", W, H); foot.footage = true; // the talking-head clip
    const opt = { en: {}, smart: true, style: "jpop", exit: "fade", mblur: true, font: "Montserrat-ExtraBold", size: 92, posY: 0.75, accentScale: 100,
        maxChars: 18, hold: 0.4, hl: [0.97, 0.84, 0.25], accent: [0.9, 0.1, 0.15], karaoke: false, upper: true, stroke: false, shadow: true,
        hotHit: false, typo: "plain", font2: "PlayfairDisplay-Black", bigPct: 160, smallPct: 100, glow: "none", sweep: "none",
        heroUpper: true, heroFly: false, display: "whole", zoomLayer: foot, zoomAmt: 12, zoomDur: 0 };
    const txt = markAccents(CK.phrasesToText(CK.groupPhrases(words, 3, 18, 0.4)), ["одним", "Зелимхан", "тюрьму", "несправедливым."]);
    CK.buildSubs(comp, CK.textToPhrases(txt, words), opt, 0);
    comp.time = 0;
    CK.addHookTitle(comp, { l1: "Его искала", l2: "вся империя", color: [0.898, 0.098, 0.149], t0: 0.1, dur: 2.6, y: 0.40, font: "Montserrat-ExtraBold", glow: true });
    return { comp, phA: txt, phB: "" };
}

const markAccents = (txt, list) => list.reduce((t, w) => t.replace(new RegExp("(\\| |\\s)" + w.replace(".", "\\.") + "(?=\\s|$)"), "$1*" + w + "*"), txt);

function sceneStory() {
    const words = CK.parseJSONWords(fs.readFileSync(path.join(ROOT, "montage/projects/zelimkhan/words.json"), "utf8")).filter(w => w.start < 21.2);
    const comp = new CompItem(W, H, 21.6, FPS);
    comp.layers.addSolid([0, 0, 0], "BG", W, H);
    // the preset's values, exactly as applyPreset(1) sets the panel
    const opt = { en: {}, smart: true, style: "soft", exit: "soft", mblur: true, font: "PlayfairDisplay-Regular", size: 74, posY: 0.72,
        maxChars: 18, hold: 0.4, hl: [0.97, 0.84, 0.25], accent: [1, 1, 1], karaoke: false, upper: false, stroke: false, shadow: true,
        hotHit: false, typo: "accent", font2: "PlayfairDisplay-Black", bigPct: 200, smallPct: 100, glow: "none", sweep: "none",
        heroUpper: true, heroFly: true, display: "flow" };
    // accents by meaning, ~one per 3–4 s, as Claude would return the panel text
    const txt = markAccents(CK.phrasesToText(CK.groupPhrases(words, 3, 18, 0.4)), ["одним", "Зелимхан", "тюрьму", "несправедливым.", "бежит", "начало."]);
    CK.buildSubs(comp, CK.textToPhrases(txt, words), opt, 0);
    return { comp, phA: txt, phB: "" };
}

function sceneMix() {
    const words = CK.parseJSONWords(fs.readFileSync(path.join(ROOT, "montage/projects/zelimkhan/words.json"), "utf8"));
    const comp = new CompItem(W, H, 21.6, FPS);
    const bg = comp.layers.addSolid([0, 0, 0], "BG", W, H); // stands in for the footage
    const base = { en: { pop: 1, slide: 1, blur: 1, cut: 1, rise: 1, flick: 1, punch: 1, glitch: 1, fade: 1, shatter: 1, up: 1, blurout: 1 },
        smart: true, style: "mix", exit: "mix", mblur: true, font: "Montserrat-ExtraBold", size: 90, posY: 0.72, maxChars: 18, hold: 0.4,
        hl: [1, 0.83, 0], accent: [1, 0.23, 0.19], karaoke: true, upper: false, stroke: true, shadow: true,
        hotHit: true, typo: "mix", font2: "PlayfairDisplay-Black", bigPct: 160, smallPct: 65, glow: "hot", sweep: "hot" };
    // part A (0–15 s): phrases, words as spoken. Accents marked the way Claude returns the text from the panel.
    const A = words.filter(w => w.start < 15.3), B = words.filter(w => w.start >= 15.3 && w.start < 21.2);
    let txt = CK.phrasesToText(CK.groupPhrases(A, 3, 18, 0.4));
    for (const w of ["охотилась", "Зелимхан", "тюрьму", "несправедливым."]) txt = txt.replace(new RegExp("(\\| |\\s)" + w.replace(".", "\\.") + "(?=\\s|$)"), "$1*" + w + "*");
    const phA = CK.textToPhrases(txt, A);
    CK.buildSubs(comp, phA, Object.assign({}, base, { display: "flow" }), 0);
    // part B (15.3–21.2 s): one word at a time, accents on the escape and on "начало"
    let txtB = CK.phrasesToText(CK.groupPhrases(B, 1, 999, 0.4)).replace("| бежит", "| *бежит*").replace("| начало.", "| *начало.*");
    CK.buildSubs(comp, CK.textToPhrases(txtB, B), Object.assign({}, base, { display: "single", size: 120 }), 0);
    // full-frame shake building up under "уходит в горы", then the hit on "начало"
    comp.time = 17.4;
    CK.shakeFrame(comp, { kind: "rise", t0: 17.4, dur: 1.55, freq: 14, px: 25, rot: 1.5, zoom: 3, sharp: 2, blur: true, keepSubs: true });
    return { comp, phA: txt, phB: txtB };
}

// ---------- expression runtime ----------
// FNV-1a hash of the seed, then mulberry32: neighbouring seeds (textIndex 1, 2, 3…) give unrelated sequences
function rng(seed) {
    let h = 2166136261; const str = String(seed);
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return () => { h = (h + 0x6D2B79F5) >>> 0; let x = h; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}
function lattice(seed, i) { return rng(seed + ":" + i)() * 2 - 1; }
function noise1(seed, x) { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return lattice(seed, i) * (1 - u) + lattice(seed, i + 1) * u; }

function effectOf(layer, t) {
    return name => {
        const fx = layer.property("ADBE Effect Parade").children.find(c => c.name === name);
        if (!fx) throw new Error("no effect " + name + " on " + layer.name);
        return idx => {
            const v = fx.property(idx).valueAt(t);
            if (Array.isArray(v)) { const a = v.length === 3 ? v.concat([1]) : v.slice(); a.value = a; return a; }
            const n = new Number(v); n.value = v; return n;
        };
    };
}

// Plays the role of AE's expression engine: it runs the expression strings CaptionAE.jsx itself generated (no outside input).
// The function body is fixed; the expression arrives as data and is evaluated with AE's globals in scope.
const EVAL = new Function("ctx", "code", "with (ctx) { return eval(code); }");
// AE adds arrays with +, JavaScript would concatenate them: rewrite the one vector form the plugin uses, value+[...]
const vec = code => code.replace(/^value\+(\[[\s\S]*\])$/, "add(value,$1)");
function run(code, layer, t, extra) {
    let rnd = Math.random;
    const key = extra.key || "";
    const ctx = Object.assign({
        time: t, inPoint: layer.inPoint, outPoint: layer.outPoint, value: extra.value,
        thisComp: { width: W, height: H, frameDuration: 1 / FPS, layer: n => ({ effect: effectOf(layer.containingComp.layer(n), t) }) },
        effect: effectOf(layer, t),
        sourceRectAtTime: () => extra.rect || { left: 0, top: 0, width: 0, height: 0 },
        linear: (x, a, b, v1, v2) => { const u = Math.max(0, Math.min(1, (x - a) / (b - a))); return v1 + (v2 - v1) * u; },
        clamp: (x, a, b) => Math.max(a, Math.min(b, x)),
        seedRandom: (s, timeless) => { rnd = rng(key + "|" + s + (timeless ? "" : "|" + t)); },
        random: (a, b) => { const r = rnd(); return a === undefined ? r : b === undefined ? r * a : a + (b - a) * r; },
        wiggle: (freq, amp, oct) => {
            const v = extra.value, dims = Array.isArray(v) ? v.length : 1, out = [];
            for (let d = 0; d < dims; d++) {
                let n = 0, a = 1, f = freq;
                for (let o = 0; o < Math.max(1, oct || 1); o++) { n += a * noise1(key + "/" + d + "/" + o, t * f); a *= 0.5; f *= 2; }
                out.push((Array.isArray(v) ? v[d] : v) + Number(amp) * n);
            }
            return Array.isArray(v) ? out : out[0];
        },
        add: (a, b) => a.map((x, i) => x + Number(b[i] || 0))
    }, extra.vars || {});
    return EVAL(ctx, vec(code));
}
const val = (p, layer, t, extra) => p.expression ? run(p.expression, layer, t, Object.assign({ value: p.valueAt(t), key: layer.id + p.matchName }, extra)) : p.valueAt(t);

// ---------- text layout (layer space: first baseline at y=0, centered) ----------
const meas = createCanvas(10, 10).getContext("2d");
function layout(layer) {
    if (layer._lay) return layer._lay;
    const td = layer.property("ADBE Text Properties").property("ADBE Text Document").value;
    const text = td.text, chars = [], words = [];
    const styleAt = i => { let f = td.font, s = td.fontSize; for (const r of td.ranges) if (i >= r.start && i < r.end) { if (r.font) f = r.font; if (r.fontSize) s = r.fontSize; } return { f, s }; };
    let lines = [[]], wi = -1, inWord = false, ci = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === "\r") { lines.push([]); inWord = false; continue; }
        if (c === " ") { inWord = false; lines[lines.length - 1].push({ c, i, space: true, ...styleAt(i) }); continue; }
        if (!inWord) { wi++; words.push({ chars: [] }); inWord = true; }
        const ch = { c, i, w: wi, ci: ci++, ...styleAt(i) };
        lines[lines.length - 1].push(ch); words[wi].chars.push(ch); chars.push(ch);
    }
    let y = 0, minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    lines.forEach((ln, li) => {
        const maxS = Math.max(...ln.map(c => c.s), td.fontSize);
        if (li) y += td.autoLeading === false && td.leading ? td.leading : 1.2 * maxS; // fixed leading if the script set one
        let x = 0;
        for (const c of ln) { meas.font = `${c.s}px ${family(c.f)}`; c.adv = meas.measureText(c.c).width; c.x = x; x += c.adv; }
        for (const c of ln) { c.x -= x / 2; c.y = y; }
        for (const c of ln) if (!c.space) { minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x + c.adv); minY = Math.min(minY, y - 0.74 * c.s); maxY = Math.max(maxY, y + 0.2 * c.s); }
    });
    for (const w of words) { // word anchor: center, 35% of the font size above the baseline (Anchor Point Align [0,-35])
        const a = w.chars[0], b = w.chars[w.chars.length - 1];
        w.ax = (a.x + b.x + b.adv) / 2; w.ay = a.y - 0.35 * a.s;
    }
    layer._lay = { td, chars, words, rect: { left: minX, top: minY, width: maxX - minX, height: maxY - minY } };
    return layer._lay;
}

// AE measures text for the script too (layer.sourceRectAtTime): answer from the same layout the renderer draws
mock.Layer.prototype.sourceRectAtTime = function () { return layout(this).rect; };

// ---------- one text layer ----------
const BUF = 2400, buf = createCanvas(BUF, BUF), bctx = buf.getContext("2d"), tmp = createCanvas(BUF, BUF), tctx = tmp.getContext("2d");
const mat = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
function trs(p, r, s, a) { // T(p) R(r) S(s) T(-a)
    const c = Math.cos(r), n = Math.sin(r);
    return mat([1, 0, 0, 1, p[0], p[1]], mat([c, n, -n, c, 0, 0], mat([s[0], 0, 0, s[1], 0, 0], [1, 0, 0, 1, -a[0], -a[1]])));
}

function drawText(ctx, layer, t) {
    const L = layout(layer), rect = L.rect, fxs = layer.property("ADBE Effect Parade").children;
    const anims = layer.property("ADBE Text Properties").property("ADBE Text Animators").children;
    const nW = L.words.length, nC = L.chars.length;
    // animator amounts per character
    const fill = (L.td.fillColor || [1, 1, 1]).slice(0, 3); // the text's own colour, before any animator
    const st = L.chars.map(() => ({ sx: 1, sy: 1, px: 0, py: 0, rot: 0, op: 1, blur: 0, col: fill.slice() }));
    for (const an of anims) {
        const sel = an.property("ADBE Text Selectors").children[0];
        let amt = () => [1, 1, 1];
        if (sel) {
            const by = sel.property("ADBE Text Range Type2").value || 3, code = sel.property("ADBE Text Expressible Amount").expression, cache = {};
            amt = ch => {
                const idx = by === 1 ? ch.ci : ch.w;
                if (!(idx in cache)) {
                    let v = run(code, layer, t, { key: layer.id + an.name, vars: { textIndex: idx + 1, textTotal: by === 1 ? nC : nW } });
                    if (!Array.isArray(v)) v = [v, v, v];
                    cache[idx] = v.map(x => Math.max(-1, Math.min(1, x / 100)));
                }
                return cache[idx];
            };
        }
        const props = an.property("ADBE Text Animator Properties").children;
        L.chars.forEach((ch, k) => {
            const a = amt(ch), s = st[k];
            for (const p of props) {
                const v = p.expression ? run(p.expression, layer, t, { key: layer.id + p.matchName }) : p.value;
                switch (p.matchName) {
                    case "ADBE Text Fill Color": { const u = Math.max(0, Math.min(1, a[0])); s.col = s.col.map((c, i) => c + (v[i] - c) * u); break; }
                    case "ADBE Text Scale 3D": s.sx *= (100 + (v[0] - 100) * a[0]) / 100; s.sy *= (100 + (v[1] - 100) * a[1]) / 100; break;
                    case "ADBE Text Position 3D": s.px += v[0] * a[0]; s.py += v[1] * a[1]; break;
                    case "ADBE Text Rotation": s.rot += v * a[0]; break;
                    case "ADBE Text Opacity": s.op *= Math.max(0, Math.min(100, 100 + (v - 100) * a[0])) / 100; break;
                    case "ADBE Text Blur": s.blur += Math.max(0, v[0] * a[0]); break;
                }
            }
        });
    }
    // Transform effects (hit / shake) in effect order, as one matrix in layer space
    let M = [1, 0, 0, 1, 0, 0];
    const center = [rect.left + rect.width / 2, rect.top + rect.height / 2];
    for (const fx of fxs) if (fx.matchName === "ADBE Geometry2") {
        const g = n => fx.property("ADBE Geometry2-" + n);
        const an = g("0001").expression ? val(g("0001"), layer, t, { rect, value: center }) : center;
        const po = val(g("0002"), layer, t, { rect, value: center });
        const sc = g("0003").expression ? val(g("0003"), layer, t, { rect, value: 100 }) : 100;
        const ro = g("0007").expression ? val(g("0007"), layer, t, { rect, value: 0 }) : 0;
        M = mat(trs(po, ro * Math.PI / 180, [sc / 100, sc / 100], an), M);
    }
    // glyphs into the layer buffer (layer origin at the buffer center)
    bctx.setTransform(1, 0, 0, 1, 0, 0); bctx.clearRect(0, 0, BUF, BUF);
    const strokeW = L.td.applyStroke ? L.td.strokeWidth : 0;
    L.chars.forEach((ch, k) => {
        const s = st[k]; if (s.op <= 0.003) return;
        const w = L.words[ch.w];
        const G = mat([1, 0, 0, 1, BUF / 2, BUF / 2], mat(M, trs([w.ax + s.px, w.ay + s.py], s.rot * Math.PI / 180, [s.sx, s.sy], [w.ax, w.ay])));
        bctx.setTransform(...G);
        bctx.globalAlpha = s.op; bctx.filter = s.blur > 0.5 ? `blur(${(s.blur / 2).toFixed(1)}px)` : "none";
        bctx.font = `${ch.s}px ${family(ch.f)}`;
        if (strokeW) { bctx.lineJoin = "round"; bctx.lineWidth = strokeW; bctx.strokeStyle = "#000"; bctx.strokeText(ch.c, ch.x, ch.y); }
        bctx.fillStyle = `rgb(${s.col.slice(0, 3).map(c => Math.round(c * 255)).join(",")})`; bctx.fillText(ch.c, ch.x, ch.y);
    });
    bctx.setTransform(1, 0, 0, 1, 0, 0); bctx.globalAlpha = 1; bctx.filter = "none";
    // raster effects in order
    for (const fx of fxs) {
        if (fx.matchName === "CC Light Sweep") {
            const c = val(fx.property(1), layer, t, { rect, value: [0, 0] });
            const P = [M[0] * c[0] + M[2] * c[1] + M[4] + BUF / 2, M[1] * c[0] + M[3] * c[1] + M[5] + BUF / 2];
            const dir = (fx.property(2).value || -25) * Math.PI / 180, nx = Math.cos(dir), ny = Math.sin(dir), wdt = 60;
            const gr = bctx.createLinearGradient(P[0] - nx * wdt, P[1] - ny * wdt, P[0] + nx * wdt, P[1] + ny * wdt);
            gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(0.5, `rgba(255,255,240,${(fx.property(5).value || 50) / 100})`); gr.addColorStop(1, "rgba(255,255,255,0)");
            bctx.globalCompositeOperation = "source-atop"; bctx.fillStyle = gr; bctx.fillRect(0, 0, BUF, BUF); bctx.globalCompositeOperation = "source-over";
        } else if (fx.matchName === "ADBE Glo2") {
            const rad = fx.property(3).value || 30, inten = fx.property(4).value || 1;
            tctx.clearRect(0, 0, BUF, BUF); tctx.filter = `blur(${rad / 2}px)`; tctx.drawImage(buf, 0, 0); tctx.filter = "none";
            bctx.globalCompositeOperation = "lighter"; bctx.globalAlpha = Math.min(1, 0.55 * inten); bctx.drawImage(tmp, 0, 0);
            bctx.globalAlpha = 1; bctx.globalCompositeOperation = "source-over";
        } else if (fx.matchName === "ADBE Drop Shadow") {
            const d = fx.property("ADBE Drop Shadow-0004").value || 5, soft = fx.property("ADBE Drop Shadow-0005").value || 0;
            tctx.clearRect(0, 0, BUF, BUF); tctx.shadowColor = "rgba(0,0,0,0.5)"; tctx.shadowBlur = soft / 2;
            tctx.shadowOffsetX = d * Math.SQRT1_2; tctx.shadowOffsetY = d * Math.SQRT1_2; tctx.drawImage(buf, 0, 0);
            tctx.shadowColor = "transparent"; bctx.clearRect(0, 0, BUF, BUF); bctx.drawImage(tmp, 0, 0);
        }
    }
    // layer transform into the comp
    const tr = layer.property("ADBE Transform Group");
    const A = val(tr.property("ADBE Anchor Point"), layer, t, { rect });
    const P = val(tr.property("ADBE Position"), layer, t, { rect });
    const S = val(tr.property("ADBE Scale"), layer, t, { rect });
    const O = val(tr.property("ADBE Opacity"), layer, t, { rect });
    ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, O / 100));
    ctx.setTransform(...mat(trs(P, 0, [S[0] / 100, S[1] / 100], A), [1, 0, 0, 1, -BUF / 2, -BUF / 2]));
    ctx.drawImage(buf, 0, 0); ctx.restore();
}

// full-frame shake: re-draw what is below with the adjustment layer's Transform effect
function applyAdjust(ctx, layer, t, frame) {
    const fx = layer.property("ADBE Effect Parade").children.find(c => c.matchName === "ADBE Geometry2");
    const c = [W / 2, H / 2], g = n => fx.property("ADBE Geometry2-" + n);
    const po = val(g("0002"), layer, t, { value: c }), sc = val(g("0003"), layer, t, { value: 100 }), ro = val(g("0007"), layer, t, { value: 0 });
    tctx.setTransform(1, 0, 0, 1, 0, 0); tctx.clearRect(0, 0, BUF, BUF); tctx.drawImage(frame, 0, 0);
    ctx.save(); ctx.setTransform(...trs(po, ro * Math.PI / 180, [sc / 100, sc / 100], c));
    // mirrored margins (Motion Tile) ≈ the frame drawn over a slightly larger copy of itself
    ctx.drawImage(tmp, 0, 0, W, H, -W * 0.1, -H * 0.1, W * 1.2, H * 1.2); ctx.drawImage(tmp, 0, 0, W, H, 0, 0, W, H); ctx.restore();
}

// ---------- footage stand-in: a still, cover-fit, darkened; Transform effects on its layer apply (punch zoom) ----------
let FOOT = null;
async function loadFootage() {
    const img = await loadImage(path.join(ROOT, "work/assets/s9.jpg")), c = createCanvas(W, H), x = c.getContext("2d");
    const k = Math.max(W / img.width, H / img.height);
    x.drawImage(img, (W - img.width * k) / 2, (H - img.height * k) / 2, img.width * k, img.height * k);
    x.fillStyle = "rgba(5,8,20,0.35)"; x.fillRect(0, 0, W, H);
    FOOT = c;
}
function drawFootage(ctx, L, t) {
    let M = [1, 0, 0, 1, 0, 0];
    for (const fx of L.property("ADBE Effect Parade").children) if (fx.matchName === "ADBE Geometry2") {
        const g = n => fx.property("ADBE Geometry2-" + n);
        const an = g("0001").value || [W / 2, H / 2], po = g("0002").value || an;
        const sc = g("0003").expression ? val(g("0003"), L, t, { value: 100 }) : 100;
        M = mat(trs(po, 0, [sc / 100, sc / 100], an), M);
    }
    ctx.save(); ctx.setTransform(...M); ctx.drawImage(FOOT, 0, 0); ctx.restore();
}

// ---------- background: dark red grid, like the Zelimkhan reel ----------
function background() {
    const c = createCanvas(W, H), x = c.getContext("2d");
    const g = x.createRadialGradient(W / 2, H * 0.45, 50, W / 2, H * 0.5, H * 0.75);
    g.addColorStop(0, "#4a0d0f"); g.addColorStop(1, "#0b0203"); x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.strokeStyle = "rgba(255,180,160,0.07)"; x.lineWidth = 2;
    for (let i = 0; i <= W; i += 90) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, H); x.stroke(); }
    for (let j = 0; j <= H; j += 90) { x.beginPath(); x.moveTo(0, j); x.lineTo(W, j); x.stroke(); }
    return c;
}

async function main() {
    const [out, f0, f1] = [process.argv[2], +process.argv[3] || 0, process.argv[4] !== undefined ? +process.argv[4] : 1e9];
    const { comp, phA, phB } = scene();
    fs.mkdirSync(out, { recursive: true });
    if (f0 === 0) {
        fs.writeFileSync(path.join(out, "panel_text.txt"), phA + "\n---\n" + phB + "\n");
        const sum = comp.layerList.map(l => `${l.kind.padEnd(5)} ${l.inPoint.toFixed(2)}-${l.outPoint.toFixed(2)} ${l.name} | ` +
            (l.kind === "text" ? l.property("ADBE Text Properties").property("ADBE Text Animators").children.map(a => a.name).join(", ") + " | fx: " +
                l.property("ADBE Effect Parade").children.map(e => e.name).join(", ") : ""));
        fs.writeFileSync(path.join(out, "layers.txt"), sum.join("\n") + "\n");
    }
    if (comp.layerList.some(l => l.footage)) await loadFootage();
    const bg = background(), frame = createCanvas(W, H), ctx = frame.getContext("2d");
    const n = Math.round(comp.duration * FPS);
    // motion blur like AE with the plugin's settings: shutter 180°, phase -90° -> open from t-¼ to t+¼ frame; 4 subframes
    const SUB = comp.motionBlur ? 4 : 1, acc = new Uint32Array(W * H * 4);
    const renderAt = t => {
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.drawImage(bg, 0, 0);
        for (let i = comp.layerList.length - 1; i >= 0; i--) { // bottom to top
            const L = comp.layerList[i];
            if (!L.enabled || t < L.inPoint || t >= L.outPoint) continue;
            if (L.footage) drawFootage(ctx, L, t);
            else if (L.kind === "text") drawText(ctx, L, t);
            else if (L.adjustmentLayer) applyAdjust(ctx, L, t, frame);
        }
    };
    for (let f = f0; f < Math.min(f1, n); f++) {
        acc.fill(0);
        for (let k = 0; k < SUB; k++) {
            renderAt((f + (SUB > 1 ? -0.25 + 0.5 * (k + 0.5) / SUB : 0)) / FPS);
            const d = ctx.getImageData(0, 0, W, H).data;
            for (let i = 0; i < d.length; i++) acc[i] += d[i];
        }
        const img = ctx.createImageData(W, H);
        for (let i = 0; i < acc.length; i++) img.data[i] = acc[i] / SUB;
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.putImageData(img, 0, 0);
        fs.writeFileSync(path.join(out, String(f).padStart(4, "0") + ".png"), frame.toBuffer("image/png"));
    }
}
main().catch(e => { console.error(e); process.exit(1); });
