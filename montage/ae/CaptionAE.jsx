// Caption AE — editing toolkit panel for After Effects (ExtendScript, AE 2020+): animated subtitles, screen shake, text hits.
// Run: File > Scripts > Run Script File…, or copy into "Scripts/ScriptUI Panels" to get a dockable panel (Window > CaptionAE.jsx).
// Text source: local Whisper (transcribe.py next to this file), an SRT (e.g. Premiere's Speech to Text export),
// or a words JSON [{w,start,end}] (montage/tools/align.py). Every phrase becomes a text layer animated by expression
// selectors, so editing Source Text later keeps the animation; global look lives on the CAPTION_CTRL null.
// Layers stay plain text layers in the comp (no precomp); transform expressions add on top of each layer's own values,
// so any line can still be dragged, scaled or rotated by hand.
(function (thisObj) {
    var CTRL = "CAPTION_CTRL", TAG = "captionae";

    // ---------- pure helpers (ES3: ExtendScript has no map/forEach/trim/JSON) ----------
    function trim(s) { return String(s).replace(/^\s+|\s+$/g, ""); }

    // ExtendScript has no JSON object: eval only after the json2.js check that the text is pure JSON data
    function parseJSON(src) {
        if (typeof JSON !== "undefined") return JSON.parse(src);
        var chk = String(src).replace(/\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g, "@")
            .replace(/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g, "]")
            .replace(/(?:^|:|,)(?:\s*\[)+/g, "");
        if (!/^[\],:{}\s]*$/.test(chk)) throw new Error("файл не JSON");
        return eval("(" + src + ")");
    }

    function parseJSONWords(src) {
        var d = parseJSON(src), arr = d.words || d.segments || d, out = [], i, w;
        for (i = 0; i < arr.length; i++) {
            w = arr[i];
            var txt = trim(w.w !== undefined ? w.w : (w.word !== undefined ? w.word : w.text));
            if (txt) out.push({ w: txt, start: +w.start, end: +w.end, db: w.db });
        }
        return out;
    }

    function srtTime(s) {
        var m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(s);
        return m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / Math.pow(10, m[4].length) : 0;
    }

    // SRT cues carry phrase times only: spread each cue's words over it by letter count
    function parseSRT(src) {
        var blocks = String(src).replace(/\r/g, "").split(/\n\s*\n/), out = [], b, i, j;
        for (b = 0; b < blocks.length; b++) {
            var lines = blocks[b].split("\n"), t = -1;
            for (i = 0; i < lines.length; i++) if (lines[i].indexOf("-->") >= 0) { t = i; break; }
            if (t < 0) continue;
            var se = lines[t].split("-->"), s0 = srtTime(se[0]), s1 = srtTime(se[1]);
            var toks = trim(lines.slice(t + 1).join(" ").replace(/<[^>]+>/g, "")).split(/\s+/), tot = 0, cum = 0;
            for (j = 0; j < toks.length; j++) tot += toks[j].length + 1;
            for (j = 0; j < toks.length; j++) {
                if (!toks[j]) continue;
                var a = s0 + (s1 - s0) * cum / tot; cum += toks[j].length + 1;
                out.push({ w: toks[j], start: a, end: s0 + (s1 - s0) * cum / tot });
            }
        }
        return out;
    }

    // Split words into on-screen phrases: by word/char limits, pauses and sentence ends.
    // strict: exactly maxWords per phrase, ignoring punctuation and pauses
    function groupPhrases(words, maxWords, maxChars, gap, strict) {
        var ph = [], cur = [], len = 0, i, w;
        for (i = 0; i < words.length; i++) {
            w = words[i];
            if (cur.length) {
                var prev = cur[cur.length - 1];
                var brk = strict ? cur.length >= maxWords : cur.length >= maxWords || len + 1 + w.w.length > maxChars ||
                    w.start - prev.end > gap || /[.!?…]$/.test(prev.w) || (/[,;:—]$/.test(prev.w) && cur.length >= 2);
                if (brk) {
                    // a dangling preposition ("в", "из", "и") goes to the next line with its word
                    var tail = !strict && cur.length >= 2 && prev.w.length <= 2 && !/[.,!?…;:—]$/.test(prev.w) ? cur.pop() : null;
                    ph.push(cur); cur = []; len = 0;
                    if (tail) { cur.push(tail); len = tail.w.length; }
                }
            }
            cur.push(w); len += (len ? 1 : 0) + w.w.length;
        }
        if (cur.length) ph.push(cur);
        return ph;
    }

    // Voice accents: in each phrase the loudest word (vs the speaker's median, from transcribe.py) if it stands out by thr dB
    function autoAccents(ph, thr) {
        var i, j, best, p;
        for (i = 0; i < ph.length; i++) {
            p = ph[i]; best = -1;
            for (j = 0; j < p.length; j++) {
                p[j].accent = false;
                var bare = p[j].w.replace(/[.,!?…;:—«»"()\-]/g, "");
                if (p[j].db !== undefined && bare.length >= 3 && p[j].db >= thr && (best < 0 || p[j].db > p[best].db)) best = j;
            }
            if (best >= 0) p[best].accent = true;
        }
        return ph;
    }

    function fmtTime(t) {
        var m = Math.floor(t / 60), s = t - m * 60;
        return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s.toFixed(1);
    }

    function phrasesToText(ph) {
        var lines = [], i, j, ws;
        for (i = 0; i < ph.length; i++) {
            ws = [];
            for (j = 0; j < ph[i].length; j++) ws.push(ph[i][j].accent ? "*" + ph[i][j].w + "*" : ph[i][j].w);
            lines.push(fmtTime(ph[i][0].start) + " | " + ws.join(" "));
        }
        return lines.join("\n");
    }

    // Edited text back to timed phrases. Times come from the original words by order; if the user added or
    // removed words, each new token borrows the time of the proportionally nearest original word.
    function textToPhrases(text, words) {
        var lines = String(text).replace(/\r/g, "\n").split("\n"), toks = [], ph = [], i, j;
        for (i = 0; i < lines.length; i++) {
            var l = lines[i], bar = l.indexOf("|");
            if (bar >= 0) l = l.substring(bar + 1);
            l = trim(l);
            if (!l) continue;
            var ws = l.split(/\s+/), row = [];
            for (j = 0; j < ws.length; j++) { row.push(toks.length); toks.push(ws[j]); }
            ph.push(row);
        }
        var N = toks.length, M = words.length, out = [];
        for (i = 0; i < ph.length; i++) {
            var p = [];
            for (j = 0; j < ph[i].length; j++) {
                var k = ph[i][j], src = words[N === M ? k : Math.min(M - 1, Math.round(k * (M - 1) / Math.max(1, N - 1)))];
                var raw = toks[k], acc = /^\*.+\*$/.test(raw);
                p.push({ w: acc ? raw.substring(1, raw.length - 1) : raw, start: src.start, end: src.end, accent: acc });
            }
            for (j = 1; j < p.length; j++) if (p[j].start < p[j - 1].start) p[j].start = p[j - 1].start;
            out.push(p);
        }
        return out;
    }

    // Look of the hidden state per style; reveal animates each word from it to normal.
    // per: true = each word appears on its own spoken time, false = whole line with a fixed stagger.
    // ease: 0 cut, 1 out-back, 2 out-expo, 3 out-cubic, 4 flicker, 5 glitch (flicker + sideways jitter).
    var STYLES = {
        pop:   { name: "Pop (слова прыгают)",       per: true,  dur: 0.28, ease: 1, scale: 0,   opacity: 0, pos: [0, 0],  blur: 0 },
        slide: { name: "Выезд снизу",               per: true,  dur: 0.35, ease: 2, scale: 100, opacity: 0, pos: [0, 70], blur: 0 },
        blur:  { name: "Из размытия",               per: true,  dur: 0.40, ease: 3, scale: 115, opacity: 0, pos: [0, 0],  blur: 30 },
        cut:   { name: "Рубленый (слово за словом)", per: true,  dur: 0.01, ease: 0, scale: 100, opacity: 0, pos: [0, 0],  blur: 0 },
        rise:  { name: "Подъём строки",             per: false, dur: 0.30, ease: 2, scale: 100, opacity: 0, pos: [0, 40], blur: 8, stagger: 0.05 },
        punch: { name: "Удар (акцент)",             per: false, dur: 0.22, ease: 2, scale: 260, opacity: 0, pos: [0, 0],  blur: 12, stagger: 0 },
        flick: { name: "Мерцание (flicker)",        per: true,  dur: 0.35, ease: 4, scale: 100, opacity: 0, pos: [0, 0],  blur: 0 },
        glitch:{ name: "Глитч (акцент)",            per: false, dur: 0.30, ease: 5, scale: 100, opacity: 0, pos: [90, 0], blur: 6, stagger: 0.03 },
        // storytelling passport: each word 0.45 s, blur 14 -> 0, rises 40 px, fades in
        soft:  { name: "Кино: из размытия вверх",   per: true,  dur: 0.45, ease: 3, scale: 100, opacity: 0, pos: [0, 40], blur: 14 },
        // Devin Jatho captions: the whole phrase pops 80 -> ~105 -> 100 % in 6 frames, phrases change on a hard cut
        jpop:  { name: "Поп фразой (Jatho)",        per: false, dur: 0.2,  ease: 1, scale: 80,  opacity: 0, pos: [0, 0],  blur: 0, stagger: 0 },
        // plain captions: the phrase is simply there from its first word to the next phrase, nothing moves
        none:  { name: "Без анимации",              per: false, dur: 0,    ease: 0, scale: 100, opacity: 100, pos: [0, 0], blur: 0, stagger: 0 }
    };
    var STYLE_KEYS = ["mix", "pop", "slide", "blur", "cut", "rise", "flick", "punch", "glitch", "soft", "jpop", "none"];
    var MIX = ["pop", "slide", "blur", "cut", "rise", "flick", "soft"];
    var HOT = ["punch", "glitch"];

    // Exits run over the last D seconds of a phrase. by: 1 = letters, 3 = words.
    var EXITS = {
        fade:    { name: "Быстрое затухание" },
        shatter: { name: "Распад на буквы",  by: 1, D: 0.40 },
        up:      { name: "Вылет вверх",      by: 3, D: 0.30, ease: 0, props: { "ADBE Text Position 3D": [0, -90, 0], "ADBE Text Opacity": 0, "ADBE Text Blur": [12, 12] } },
        blurout: { name: "Уход в размытие",  by: 3, D: 0.30, ease: 0, props: { "ADBE Text Scale 3D": [118, 118, 100], "ADBE Text Opacity": 0, "ADBE Text Blur": [30, 30] } },
        flick:   { name: "Мерцание",         by: 3, D: 0.30, ease: 1, props: { "ADBE Text Opacity": 0 } },
        soft:    { name: "Мягкий: вверх в размытие", by: 3, D: 0.35, ease: 0, props: { "ADBE Text Position 3D": [0, -30, 0], "ADBE Text Opacity": 0, "ADBE Text Blur": [12, 12] } },
        none:    { name: "Без ухода (обрыв)" }
    };
    var EXIT_KEYS = ["mix", "fade", "shatter", "up", "blurout", "flick", "soft", "none"];
    var EXIT_MIX = ["up", "blurout", "flick", "fade", "soft"];

    function pool(list, en) {
        var r = [], i;
        for (i = 0; i < list.length; i++) if (en[list[i]]) r.push(list[i]);
        return r;
    }

    // deterministic pick that never repeats the previous one
    function nextFrom(list, last, rng) {
        if (!list.length) return null;
        if (list.length === 1) return list[0];
        var s;
        do { rng.seed = (rng.seed * 1103515245 + 12345) % 2147483648; s = list[rng.seed % list.length]; } while (s === last);
        return s;
    }

    function phraseInfo(ph, i) {
        var p = ph[i], lw = p[p.length - 1].w, hot = /!$/.test(lw), dur = 0, j;
        for (j = 0; j < p.length; j++) { if (p[j].accent) hot = true; dur += p[j].end - p[j].start; }
        return {
            hot: hot, question: /\?$/.test(lw), end: /[.!?…]$/.test(lw), fast: dur / p.length < 0.22,
            gapBefore: i ? p[0].start - ph[i - 1][ph[i - 1].length - 1].end : 99,
            gapAfter: i + 1 < ph.length ? ph[i + 1][0].start - p[p.length - 1].end : 99
        };
    }

    // Mix uses only the ticked styles. Accent / "!" lines take the strong ones (punch, glitch).
    // Smart mode reads the speech: a line after a long pause opens calmly and big, a question flickers,
    // fast speech gets snappy cuts; everything else rotates without repeats.
    function pickStyles(ph, mode, en, smart) {
        var res = [], last = "", rng = { seed: 7 }, i;
        if (mode !== "mix") { for (i = 0; i < ph.length; i++) res.push(mode); return res; }
        var calm = pool(MIX, en), hot = pool(HOT, en);
        if (!calm.length) calm = hot.length ? hot : ["pop"];
        if (!hot.length) hot = calm;
        function prefer(list) { return nextFrom(pool(list, en), last, rng); }
        for (i = 0; i < ph.length; i++) {
            var inf = phraseInfo(ph, i), c = null;
            if (inf.hot) c = nextFrom(hot, last, rng);
            else if (smart) {
                if (inf.question) c = prefer(["flick", "blur"]);
                else if (inf.gapBefore >= 0.8) c = prefer(["rise", "slide", "blur"]);
                else if (inf.fast) c = prefer(["cut", "pop"]);
            }
            if (!c) c = nextFrom(calm, last, rng);
            res.push(c); last = c;
        }
        return res;
    }

    // Exits: strong lines break apart. Smart mode keeps mid-sentence lines on a quick fade (speech flows on)
    // and gives a visible exit only where a sentence ends on a pause.
    function pickExits(ph, styles, mode, en, smart) {
        var res = [], last = "", rng = { seed: 11 }, i;
        if (mode !== "mix") { for (i = 0; i < ph.length; i++) res.push(mode); return res; }
        var rest = pool(EXIT_MIX, en), strong = pool(["up", "blurout", "flick"], en);
        if (!rest.length) rest = en.shatter ? ["shatter"] : ["fade"];
        for (i = 0; i < ph.length; i++) {
            var inf = phraseInfo(ph, i), e = null;
            if ((inf.hot || styles[i] === "punch" || styles[i] === "glitch") && en.shatter) e = "shatter";
            else if (smart) {
                if (!(inf.end && inf.gapAfter >= 0.5)) e = en.fade ? "fade" : null;
                else e = nextFrom(strong, last, rng);
            }
            if (!e) e = nextFrom(rest, last, rng);
            res.push(e); last = e;
        }
        return res;
    }

    function arr(a) {
        var s = [], i;
        for (i = 0; i < a.length; i++) s.push(typeof a[i] === "number" ? Math.round(a[i] * 1000) / 1000 : (a[i] ? 1 : 0));
        return "[" + s.join(",") + "]";
    }

    // Expression selector amounts: 100 = animator fully applied (hidden / highlighted), 0 = plain text
    function revealExpr(T, st) {
        return "var T=" + arr(T) + ",D=" + st.dur + ",E=" + st.ease + ";\n" +
            "var i=Math.min(textIndex-1,T.length-1),p=Math.max(0,Math.min(1,(time-inPoint-T[i])/D)),q=p-1,e;\n" +
            "seedRandom(textIndex*13+Math.floor(time/thisComp.frameDuration),true);\n" +
            "if(E==0)e=p>0?1:0;else if(E==1)e=1+2.70158*q*q*q+1.70158*q*q;else if(E==2)e=p>=1?1:1-Math.pow(2,-10*p);\n" +
            "else if(E==3)e=1-Math.pow(1-p,3);else e=p>=1?1:(p<=0?0:(random()<0.3+0.6*p?1:0));\n" +
            "var v=100*(1-e);if(E==5&&p>0&&p<1&&random()<0.5)v=random(-100,100)*(1-p);[v,v,v]";
    }

    // Letters fly apart and fall, each with its own delay; the fade animator replays the same random delay
    function shatterMoveExpr(D) {
        return "var D=" + D + ";seedRandom(textIndex,true);var r=random(),dx=random(-1,1),dy=random(-0.4,1);\n" +
            "var p=Math.max(0,Math.min(1,(time-(outPoint-D)-r*0.35*D)/(0.65*D))),e=p*p;[100*dx*e,100*dy*e,0]";
    }

    function shatterFadeExpr(D) {
        return "var D=" + D + ";seedRandom(textIndex,true);var r=random();\n" +
            "var p=Math.max(0,Math.min(1,(time-(outPoint-D)-r*0.35*D)/(0.65*D))),v=100*Math.pow(p,1.5);[v,v,v]";
    }

    // Word exits: a short left-to-right stagger, ease-in so words accelerate away (E=1: flicker out)
    function wordExitExpr(ex, D) {
        return "var D=" + D + ",E=" + ex.ease + ",u=(time-(outPoint-D))/D,s=0.3*(textIndex-1)/Math.max(1,textTotal-1);\n" +
            "var p=Math.max(0,Math.min(1,(u-s)/0.7)),e;seedRandom(textIndex*17+Math.floor(time/thisComp.frameDuration),true);\n" +
            "if(E==1)e=p>=1?1:(p<=0?0:(random()<p?1:0));else e=p*p*p;var v=100*e;[v,v,v]";
    }

    function highlightExpr(T) {
        return "var T=" + arr(T) + ",on=thisComp.layer(\"" + CTRL + "\").effect(\"Karaoke\")(1).value;\n" +
            "var i=Math.min(textIndex-1,T.length-1),t=time-inPoint;\n" +
            "var v=(on&&t>=T[i]&&(i==T.length-1||t<T[i+1]))?100:0;[v,v,v]";
    }

    // key word flies in from a bigger scale with blur, out-expo over 0.5 s, on its own reveal time
    function heroExpr(T, big) {
        return "var T=" + arr(T) + ",H=" + big + ",D=0.5,i=Math.min(textIndex-1,T.length-1);\n" +
            "var p=Math.max(0,Math.min(1,(time-inPoint-T[i])/D)),e=p>=1?1:1-Math.pow(2,-10*p),v=(i==H)?100*(1-e):0;[v,v,v]";
    }

    function accentExpr(A) {
        return "var A=" + arr(A) + ",i=Math.min(textIndex-1,A.length-1),v=A[i]?100:0;[v,v,v]";
    }

    // ---------- After Effects side ----------
    function addEffect(layer, match, name, val) {
        var fx = layer.property("ADBE Effect Parade").addProperty(match);
        fx.name = name;
        if (val !== undefined) fx.property(1).setValue(val);
        return fx;
    }

    function getCtrl(comp, opt) {
        for (var i = 1; i <= comp.numLayers; i++) if (comp.layer(i).name === CTRL) return comp.layer(i);
        var n = comp.layers.addNull(comp.duration);
        n.name = CTRL; n.comment = TAG; n.enabled = false;
        addEffect(n, "ADBE Slider Control", "Size %", 100);
        addEffect(n, "ADBE Slider Control", "Y offset", 0);
        addEffect(n, "ADBE Color Control", "Text", [1, 1, 1]);
        addEffect(n, "ADBE Color Control", "Highlight", opt.hl);
        addEffect(n, "ADBE Color Control", "Accent", opt.accent);
        addEffect(n, "ADBE Checkbox Control", "Karaoke", opt.karaoke ? 1 : 0);
        return n;
    }

    function addAnimator(layer, name, props, expr, basedOn) {
        var an = layer.property("ADBE Text Properties").property("ADBE Text Animators").addProperty("ADBE Text Animator");
        an.name = name;
        var ap = an.property("ADBE Text Animator Properties"), k, p;
        for (k in props) {
            p = ap.addProperty(k);
            if (typeof props[k] === "string") p.expression = props[k]; else p.setValue(props[k]);
        }
        if (expr) {
            var sel = an.property("ADBE Text Selectors").addProperty("ADBE Text Expressible Selector");
            sel.property("ADBE Text Range Type2").setValue(basedOn || 3); // 1 letters, 3 words
            sel.property("ADBE Text Expressible Amount").expression = expr;
        }
        return an;
    }

    // The one shadow for all text: barely offset, wide and soft (6 % / 25 % of the font size), no hard dark edge.
    function softShadow(layer, size) {
        var sh = layer.property("ADBE Effect Parade").addProperty("ADBE Drop Shadow");
        sh.property("ADBE Drop Shadow-0004").setValue(Math.round(size * 0.06));
        sh.property("ADBE Drop Shadow-0005").setValue(Math.round(size * 0.25));
        return sh;
    }

    function wrapLine(ws, maxChars) {
        var s = ws.join(" ");
        if (s.length <= maxChars || ws.length < 2) return s;
        var best = 1, bd = 1e9, run = 0, i;
        for (i = 0; i < ws.length - 1; i++) {
            run += ws[i].length + (i ? 1 : 0);
            var d = Math.abs(run - (s.length - run - 1));
            if (d < bd) { bd = d; best = i + 1; }
        }
        return ws.slice(0, best).join(" ") + "\r" + ws.slice(best).join(" ");
    }

    function bare(w) { return String(w).replace(/[.,!?…;:—«»"()\-]/g, ""); }

    // Typography composition: which phrases get it and which word is the hero.
    // mode: plain | all | mix (accent lines + every third line); hero = accent word, else the longest word of 4+ letters
    function typoPlan(p, mode, i, hot) {
        if (mode === "plain" || (mode === "mix" && !hot && i % 3 !== 1) || (mode === "accent" && !hot)) return null;
        if (p.length === 1 && !hot) return null; // one word on screen: only an accent earns the big type
        var big = -1, bl = 3, j;
        for (j = 0; j < p.length; j++) if (p[j].accent) { big = j; break; }
        if (big < 0) for (j = 0; j < p.length; j++) if (bare(p[j].w).length > bl) { bl = bare(p[j].w).length; big = j; }
        return big < 0 ? null : { big: big };
    }

    // Hero word on its own line between the words before and after it; ranges = [start, end) of each word in the text
    function typoLayout(ws, big) {
        var after = big + 1;
        while (after < ws.length && bare(ws[after]) === "") after++; // a lone "—" or "!" stays on the hero's line
        var lines = [ws.slice(0, big), ws.slice(big, after), ws.slice(after)], text = "", ranges = [], i, j;
        for (i = 0; i < lines.length; i++) {
            if (!lines[i].length) continue;
            if (text) text += "\r";
            for (j = 0; j < lines[i].length; j++) {
                if (j) text += " ";
                ranges.push([text.length, text.length + lines[i][j].length]);
                text += lines[i][j];
            }
        }
        return { text: text, ranges: ranges };
    }

    function buildSubs(comp, ph, opt, offset) {
        var ctrl = getCtrl(comp, opt), styles = pickStyles(ph, opt.style, opt.en, opt.smart);
        var exits = pickExits(ph, styles, opt.exit, opt.en, opt.smart);
        var C = 'thisComp.layer("' + CTRL + '")';
        if (opt.mblur) comp.motionBlur = true;
        var made = 0, i, j;
        for (i = 0; i < ph.length; i++) {
            var p = ph[i], st = STYLES[styles[i]], ws = [], T = [], S = [], A = [];
            var t0 = offset + p[0].start, last = offset + p[p.length - 1].end;
            var next = i + 1 < ph.length ? offset + ph[i + 1][0].start : comp.duration;
            var t1 = Math.min(next, last + opt.hold);
            if (next - last < 0.6) t1 = next; // close gap: no flicker between lines
            if (opt.fixedDur) t1 = Math.min(next, t0 + opt.fixedDur); // fixed length, cut short only by the next words
            if (t1 - t0 < 0.2) t1 = t0 + 0.2;
            if (next > t0 && t1 > next) t1 = next; // never two captions on screen at once
            for (j = 0; j < p.length; j++) {
                ws.push(opt.upper ? p[j].w.toUpperCase() : p[j].w);
                S.push(offset + p[j].start - t0); // when the word is spoken (karaoke)
                // when the word appears: "whole" shows the line at once with a short stagger
                T.push(opt.display === "whole" ? j * 0.035 : st.per ? S[j] : j * st.stagger);
                A.push(p[j].accent);
            }
            var hotI = phraseInfo(ph, i).hot, plan = typoPlan(p, opt.typo, i, hotI);
            if (plan && opt.heroUpper) ws[plan.big] = ws[plan.big].toUpperCase();
            var lay = plan ? typoLayout(ws, plan.big) : null;
            var ta = t0 + 0.15; // accent moment: the accent word, else just after the line appears
            for (j = 0; j < p.length; j++) if (p[j].accent) { ta = offset + p[j].start; break; }
            // opt.lineWords: first line holds exactly that many words, the rest go to line 2 (plain captions, 2 lines)
            var plainText = opt.lineWords && ws.length > opt.lineWords ?
                ws.slice(0, opt.lineWords).join(" ") + "\r" + ws.slice(opt.lineWords).join(" ") : wrapLine(ws, opt.maxChars);
            var layer = comp.layers.addText(lay ? lay.text : plainText);
            layer.name = ws.join(" ").substring(0, 40); layer.comment = TAG;
            layer.startTime = 0; layer.inPoint = t0; layer.outPoint = Math.min(t1, comp.duration);

            var srcProp = layer.property("ADBE Text Properties").property("ADBE Text Document"), td = srcProp.value;
            td.resetCharStyle(); td.resetParagraphStyle();
            td.font = opt.font; td.fontSize = opt.size; td.fillColor = [1, 1, 1];
            td.applyStroke = opt.stroke; td.strokeColor = [0, 0, 0]; td.strokeWidth = Math.round(opt.size * 0.09);
            td.strokeOverFill = false; td.justification = ParagraphJustification.CENTER_JUSTIFY;
            if (opt.leadingPct) { // line spacing as % of the font size instead of AE's auto (120 %)
                try { td.autoLeading = false; td.leading = Math.round(opt.size * opt.leadingPct / 100); } catch (eL) {}
            }
            if (lay) {
                if (typeof td.characterRange === "function") { // per-word font and size: AE 2024+
                    for (j = 0; j < ws.length; j++) {
                        var cr = td.characterRange(lay.ranges[j][0], lay.ranges[j][1]);
                        if (j === plan.big) { cr.font = opt.font2; cr.fontSize = Math.round(opt.size * opt.bigPct / 100); }
                        else if (bare(ws[j]).length <= 3) cr.fontSize = Math.round(opt.size * opt.smallPct / 100);
                    }
                } else opt.note = "Разные шрифт и размер слов работают в AE 2024+; здесь только раскладка по строкам.";
            }
            srcProp.setValue(td);
            // fit: measured before any animator exists, so allow for the karaoke (104%) and accent (112%) growth added later;
            // wider than 90% of the frame -> the layer's own scale shrinks it
            var grow = 1.04, rc = layer.sourceRectAtTime(t0, false);
            var accS = opt.accentScale || 112;
            if (!plan) for (j = 0; j < p.length; j++) if (p[j].accent) grow = 1.04 * accS / 100;
            var fit = rc.width * grow > comp.width * 0.9 ? comp.width * 0.9 / (rc.width * grow) * 100 : 100;

            var more = layer.property("ADBE Text Properties").property("ADBE Text More Options");
            more.property("ADBE Text Anchor Point Option").setValue(2); // scale each word around its own center
            more.property("ADBE Text Anchor Point Align").setValue([0, -35]);

            addAnimator(layer, "Base color", { "ADBE Text Fill Color": C + '.effect("Text")(1)' }, null);
            var accP = { "ADBE Text Fill Color": C + '.effect("Accent")(1)' };
            if (!plan && accS !== 100) accP["ADBE Text Scale 3D"] = [accS, accS, 100]; // a hero word is already big
            addAnimator(layer, "Accent", accP, accentExpr(A));
            addAnimator(layer, "Highlight", { "ADBE Text Fill Color": C + '.effect("Highlight")(1)', "ADBE Text Scale 3D": [104, 104, 100] }, highlightExpr(S));
            var rv = {};
            if (st.scale !== 100) rv["ADBE Text Scale 3D"] = [st.scale, st.scale, 100];
            if (st.pos[0] || st.pos[1]) rv["ADBE Text Position 3D"] = [st.pos[0], st.pos[1], 0];
            if (st.blur) rv["ADBE Text Blur"] = [st.blur, st.blur];
            rv["ADBE Text Opacity"] = st.opacity;
            if (styles[i] !== "none") addAnimator(layer, "Reveal " + styles[i], rv, revealExpr(T, st));
            if (plan && opt.heroFly) addAnimator(layer, "Hero fly", { "ADBE Text Scale 3D": [160, 160, 100], "ADBE Text Blur": [10, 10] }, heroExpr(T, plan.big));

            // exit squeezed into the pause after the last word, but never shorter than 0.15 s
            var ex = EXITS[exits[i]], lastEnd = offset + p[p.length - 1].end;
            var D = ex.D ? Math.round(Math.max(0.15, Math.min(ex.D, layer.outPoint - lastEnd)) * 100) / 100 : 0;
            if (exits[i] === "shatter") {
                addAnimator(layer, "Exit shatter", { "ADBE Text Position 3D": [260, 360, 0], "ADBE Text Rotation": 240 }, shatterMoveExpr(D), 1);
                addAnimator(layer, "Exit shatter fade", { "ADBE Text Opacity": 0, "ADBE Text Blur": [18, 18] }, shatterFadeExpr(D), 1);
            } else if (ex.props) {
                addAnimator(layer, "Exit " + exits[i], ex.props, wordExitExpr(ex, D), ex.by);
            }
            layer.motionBlur = opt.mblur;

            // accent lines: on the accent word (or the line start for "!") the whole line kicks and shakes
            if (opt.hotHit && hotI) {
                var th = t0;
                for (j = 0; j < p.length; j++) if (p[j].accent) { th = offset + p[j].start; break; }
                addPunch(comp, layer, { kind: "kick", t0: th, d: 0.22, s: 125, blur: opt.mblur });
                addShake(comp, layer, { kind: "hit", t0: th, dur: 0.35, freq: 18, px: 14, rot: 1.5, zoom: 0, sharp: 3, blur: opt.mblur });
            }

            var tr = layer.property("ADBE Transform Group");
            // center on the fully revealed line, measured before the exit starts scattering it
            tr.property("ADBE Anchor Point").expression = "var r=sourceRectAtTime(Math.max(inPoint,outPoint-" + D + "-thisComp.frameDuration),false);[r.left+r.width/2,r.top+r.height/2]";
            tr.property("ADBE Position").setValue([comp.width / 2, comp.height * opt.posY]);
            tr.property("ADBE Position").expression = "value+[0," + C + '.effect("Y offset")(1)]';
            tr.property("ADBE Scale").setValue([fit, fit]);
            tr.property("ADBE Scale").expression = "var s=" + C + '.effect("Size %")(1)/100;[value[0]*s,value[1]*s]';
            if (exits[i] === "fade") tr.property("ADBE Opacity").expression = "var f=3*thisComp.frameDuration;value*linear(time,outPoint-f,outPoint,1,0)";
            function on(scope) { return scope === "all" || (scope === "hot" && hotI); }
            if (on(opt.sweep)) addSweep(layer, ta, 0.6);
            if (on(opt.glow)) addGlow(layer, opt.size);
            if (opt.shadow) {
                softShadow(layer, opt.size);
            }
            made++;
        }
        if (opt.zoomLayer) {
            var M = accentMoments(ph, offset, comp.duration);
            addPunchZoom(comp, opt.zoomLayer, M.A, M.B, { amt: opt.zoomAmt, dur: opt.zoomDur, faceY: 0.35, blur: opt.mblur });
        }
        ctrl.moveToBeginning();
        return made;
    }

    // ---------- shake: a separate editing tool, not tied to subtitles ----------
    // Transform effect driven by wiggle; strength follows the "amount" slider (keyframed envelope, 0..100)
    // raised to "curve": rise = slow start that builds up, hit = sharp start that dies away.
    var SHAKES = { rise: "Нарастание", hit: "Удар (затухает)", hold: "Постоянная" };
    var SHAKE_KEYS = ["rise", "hit", "hold"];
    var RHYTHM = [["Плавно", 2], ["Средне", 6], ["Резко", 14], ["Очень резко", 24]];
    var POWER = [["Мягкая", 8, 0.5, 1], ["Средняя", 25, 1.5, 3], ["Сильная", 60, 3.5, 7]]; // px, rotation °, zoom %

    function shakeExpr(pre, what) {
        var env = "var env=Math.pow(Math.max(0,effect(\"" + pre + " amount\")(1))/100,effect(\"" + pre + " curve\")(1));\n";
        var f = "effect(\"" + pre + " freq\")(1)", oct = "Math.max(1,Math.round(effect(\"" + pre + " sharpness\")(1)))";
        return env + "wiggle(" + f + ",effect(\"" + pre + " " + what + "\")(1)*env," + oct + ")";
    }

    function addShake(comp, layer, o) {
        var fxs = layer.property("ADBE Effect Parade"), n = 1, i;
        for (i = 1; i <= fxs.numProperties; i++) if (/^Shake\d* amount$/.test(fxs.property(i).name)) n++;
        var pre = "Shake" + (n > 1 ? n : "");
        var amt = addEffect(layer, "ADBE Slider Control", pre + " amount", 0);
        addEffect(layer, "ADBE Slider Control", pre + " freq", o.freq);
        addEffect(layer, "ADBE Slider Control", pre + " px", o.px);
        addEffect(layer, "ADBE Slider Control", pre + " rotation", o.rot);
        addEffect(layer, "ADBE Slider Control", pre + " zoom", o.zoom);
        addEffect(layer, "ADBE Slider Control", pre + " sharpness", o.sharp);
        addEffect(layer, "ADBE Slider Control", pre + " curve", 2);
        var zoomBase = 0;
        if (o.mirror) { // whole frame: mirrored margins so shaking never shows black edges
            try {
                var tile = fxs.addProperty("ADBE Tile"); tile.name = pre + " edges";
                tile.property("ADBE Tile-0004").setValue(140); tile.property("ADBE Tile-0005").setValue(140);
                tile.property("ADBE Tile-0006").setValue(1);
            } catch (e) { // no Motion Tile: hide the edges by zooming in just enough for the shake
                if (tile) tile.remove();
                zoomBase = Math.ceil(200 * (o.px + Math.sin(o.rot * Math.PI / 180) * Math.max(comp.width, comp.height)) / Math.min(comp.width, comp.height));
            }
        }
        var tf = fxs.addProperty("ADBE Geometry2"); tf.name = pre + " transform";
        tf.property("ADBE Geometry2-0002").expression = shakeExpr(pre, "px");
        tf.property("ADBE Geometry2-0007").expression = shakeExpr(pre, "rotation");
        tf.property("ADBE Geometry2-0003").expression = shakeExpr(pre, "zoom").replace("wiggle(", "var z=wiggle(") + ";value+Math.abs(z-value)+" + zoomBase + "*env";
        if (o.blur) { tf.property("ADBE Geometry2-0009").setValue(0); tf.property("ADBE Geometry2-0010").setValue(180); }

        var a = amt.property(1), fr = comp.frameDuration, t0 = o.t0, t1 = o.t0 + o.dur;
        if (o.kind === "rise") { a.setValueAtTime(t0, 0); a.setValueAtTime(t1, 100); a.setValueAtTime(t1 + fr, 0); }
        else if (o.kind === "hit") { a.setValueAtTime(t0 - fr, 0); a.setValueAtTime(t0, 100); a.setValueAtTime(t1, 0); }
        else { a.setValueAtTime(t0 - fr, 0); a.setValueAtTime(t0, 100); a.setValueAtTime(t1, 100); a.setValueAtTime(t1 + fr, 0); }
        return pre;
    }

    // ---------- text hits: scale kicks on any layer (text, footage, subtitle lines) ----------
    // A Transform effect pivoting on the layer's visible center. kinds:
    // hit  = jumps to "scale" % and lands on 100 with a small undershoot (out-back)
    // spring = starts small and springs into place (elastic)
    // kick = quick bump up to "scale" % and back
    var PUNCHES = { hit: ["Удар: резкий зум и посадка", 120, 0.25], spring: ["Пружина", -45, 0.6], kick: ["Толчок", 20, 0.22] };
    var PUNCH_KEYS = ["hit", "spring", "kick"];

    function punchExpr(pre, kind, t0, d) {
        var K = { hit: 0, spring: 1, kick: 2 }[kind];
        return "var t=time-" + (Math.round(t0 * 1000) / 1000) + ",d=" + d + ",s=effect(\"" + pre + " scale\")(1),K=" + K + ";\n" +
            "var p=Math.max(0,Math.min(1,t/d)),q=p-1,e;\n" +
            "if(K==0)e=1+2.70158*q*q*q+1.70158*q*q;else if(K==1)e=p>=1?1:Math.pow(2,-10*p)*Math.sin((p*10-0.75)*2.0944)+1;else e=1-Math.sin(Math.PI*p);\n" +
            "t<0?value:value+(s-100)*(1-e)";
    }

    function addPunch(comp, layer, o) {
        var fxs = layer.property("ADBE Effect Parade"), n = 1, i;
        for (i = 1; i <= fxs.numProperties; i++) if (/^Hit\d* scale$/.test(fxs.property(i).name)) n++;
        var pre = "Hit" + (n > 1 ? n : "");
        addEffect(layer, "ADBE Slider Control", pre + " scale", o.s);
        var tf = fxs.addProperty("ADBE Geometry2"); tf.name = pre + " transform";
        var center = "var r=sourceRectAtTime(time,false);[r.left+r.width/2,r.top+r.height/2]";
        tf.property("ADBE Geometry2-0001").expression = center;
        tf.property("ADBE Geometry2-0002").expression = center;
        tf.property("ADBE Geometry2-0003").expression = punchExpr(pre, o.kind, o.t0, o.d);
        if (o.blur) { tf.property("ADBE Geometry2-0009").setValue(0); tf.property("ADBE Geometry2-0010").setValue(180); }
        return pre;
    }

    // ---------- light: glow and a light sweep across the layer ----------
    function findEffect(re) {
        for (var i = 0; i < app.effects.length; i++) if (re.test(app.effects[i].displayName)) return app.effects[i].matchName;
        return null;
    }

    // Deep Glow if the plugin is installed (its own defaults), otherwise the built-in Glow tuned for text
    function addGlow(layer, size) {
        var fxs = layer.property("ADBE Effect Parade"), dg = findEffect(/^deep glow/i);
        if (dg) return fxs.addProperty(dg);
        var g = fxs.addProperty("ADBE Glo2"), set = [[2, 55], [3, Math.round(size * 0.35)], [4, 1.3]], i;
        for (i = 0; i < set.length; i++) try { g.property(set[i][0]).setValue(set[i][1]); } catch (e) {}
        return g;
    }

    // CC Light Sweep: the light band crosses the layer's visible box left to right in d seconds from t0
    function addSweep(layer, t0, d) {
        var fx = layer.property("ADBE Effect Parade").addProperty("CC Light Sweep");
        fx.property(1).expression = "var r=sourceRectAtTime(time,false),p=Math.max(0,Math.min(1,(time-" + (Math.round(t0 * 1000) / 1000) + ")/" + d + "));\n" +
            "var p2=1-Math.pow(1-p,2);[r.left-r.height+(r.width+2*r.height)*p2,r.top+r.height/2]";
        try { fx.property(2).setValue(-25); } catch (e) {}
        try { fx.property(5).setValue(90); } catch (e) {}
        return fx;
    }

    function shakeFrame(comp, o) {
        var L = comp.layers.addSolid([0, 0, 0], "SHAKE " + SHAKES[o.kind], comp.width, comp.height, comp.pixelAspect, comp.duration);
        L.adjustmentLayer = true; L.label = 11;
        L.inPoint = Math.max(0, o.t0 - comp.frameDuration); L.outPoint = Math.min(comp.duration, o.t0 + o.dur + comp.frameDuration);
        if (o.keepSubs) { // shake the picture, not the captions: sit right under the subtitle layers
            for (var i = 2; i <= comp.numLayers; i++) {
                var x = comp.layer(i);
                if (x.comment.indexOf(TAG) !== 0) { if (i > 2) L.moveBefore(x); break; } // captions and hook titles stay still
            }
        }
        o.mirror = true; addShake(comp, L, o);
        return L;
    }

    // ---------- Jatho kit ----------
    // Punch-in of the footage on accent words: from each accent to the next phrase the frame sits Z % closer to the face.
    // D = 0 jumps like a cut (his usual), D > 0 eases out over D seconds.
    function punchZoomExpr(A, B, Z, D) {
        return "var A=" + arr(A) + ",B=" + arr(B) + ",Z=" + Z + ",D=" + D + ",s=0;\n" +
            "for(var i=0;i<A.length;i++)if(time>=A[i]&&time<B[i]){var p=D>0?Math.min(1,(time-A[i])/D):1;s=Z*(1-Math.pow(1-p,3));}\n" +
            "value+s";
    }

    function addPunchZoom(comp, layer, A, B, o) {
        var fxs = layer.property("ADBE Effect Parade"), i;
        for (i = fxs.numProperties; i >= 1; i--) if (fxs.property(i).name === "Punch zoom") fxs.property(i).remove();
        var tf = fxs.addProperty("ADBE Geometry2"); tf.name = "Punch zoom";
        var w = layer.width || comp.width, h = layer.height || comp.height, face = [w / 2, h * o.faceY];
        tf.property("ADBE Geometry2-0001").setValue(face); tf.property("ADBE Geometry2-0002").setValue(face);
        tf.property("ADBE Geometry2-0003").expression = punchZoomExpr(A, B, o.amt, o.dur);
        if (o.blur) { tf.property("ADBE Geometry2-0009").setValue(0); tf.property("ADBE Geometry2-0010").setValue(180); }
        return tf;
    }

    // accent moments of the built phrases: the accent word, else the start of a "!" line; held until the next phrase
    function accentMoments(ph, offset, compDur) {
        var A = [], B = [], i, j;
        for (i = 0; i < ph.length; i++) {
            if (!phraseInfo(ph, i).hot) continue;
            var t = offset + ph[i][0].start;
            for (j = 0; j < ph[i].length; j++) if (ph[i][j].accent) { t = offset + ph[i][j].start; break; }
            A.push(t); B.push(i + 1 < ph.length ? offset + ph[i + 1][0].start : compDur);
        }
        return { A: A, B: B };
    }

    // pop-in on a layer's own scale: from F % to 100 with out-back (overshoot c), opacity in over the first frames
    function popInScale(t0, F, d, c) {
        return "var t=time-" + (Math.round(t0 * 1000) / 1000) + ",p=Math.max(0,Math.min(1,t/" + d + ")),q=p-1,c=" + c + ";\n" +
            "var e=1+(c+1)*q*q*q+c*q*q,s=(" + F + "+(100-" + F + ")*e)/100;[value[0]*s,value[1]*s]";
    }

    // Two-tone hook title: line 1 white, line 2 in colour with a glow of the same colour. Measured on his reels:
    // widths ~82 % / ~88 % of the frame, line 2 lands 4 frames later from 125 % with a slight undershoot.
    function addHookTitle(comp, o) {
        var fr = comp.frameDuration, made = [], k, y = comp.height * o.y;
        var spec = [{ text: o.l1, col: [1, 1, 1], w: 0.82, from: 115, delay: 0, d: 4 * fr, c: 0 },
            { text: o.l2, col: o.color, w: 0.88, from: 125, delay: 4 * fr, d: 7 * fr, c: 1.2 }];
        for (k = 0; k < 2; k++) {
            var S = spec[k]; if (!S.text) continue;
            var L = comp.layers.addText(String(S.text).toUpperCase());
            L.name = "HOOK " + (k + 1) + ": " + S.text; L.comment = TAG + "-hook";
            L.startTime = 0; L.inPoint = o.t0 + S.delay; L.outPoint = Math.min(comp.duration, o.t0 + o.dur);
            var sp = L.property("ADBE Text Properties").property("ADBE Text Document"), td = sp.value;
            td.resetCharStyle(); td.resetParagraphStyle();
            td.font = o.font; td.fontSize = 120; td.fillColor = S.col; td.applyStroke = false;
            td.justification = ParagraphJustification.CENTER_JUSTIFY; sp.setValue(td);
            var rc = L.sourceRectAtTime(L.inPoint, false), sc = rc.width ? comp.width * S.w / rc.width * 100 : 100;
            var h = rc.height * sc / 100;
            // o.y is the seam between the lines: line 1 sits above it, line 2 below, 12 px apart
            if (k === 0) y -= h / 2 + 6; else if (made.length) y += 6 + h / 2;
            var tr = L.property("ADBE Transform Group");
            tr.property("ADBE Anchor Point").expression = "var r=sourceRectAtTime(inPoint,false);[r.left+r.width/2,r.top+r.height/2]";
            tr.property("ADBE Position").setValue([comp.width / 2, y]);
            tr.property("ADBE Scale").setValue([sc, sc]);
            tr.property("ADBE Scale").expression = popInScale(L.inPoint, S.from, S.d, S.c);
            tr.property("ADBE Opacity").expression = "linear(time,inPoint,inPoint+" + (4 * fr) + ",0,100)";
            softShadow(L, 120);
            if (k === 1 && o.glow) {
                var g = L.property("ADBE Effect Parade").addProperty("ADBE Glo2");
                try { g.property(2).setValue(40); g.property(3).setValue(45); g.property(4).setValue(1); } catch (e) {}
            }
            if (k === 0) y += h / 2 + 6;
            L.motionBlur = true; made.push(L);
        }
        return made;
    }

    function removeSubs(comp) {
        for (var i = comp.numLayers; i >= 1; i--) if (comp.layer(i).comment === TAG) comp.layer(i).remove();
    }

    var API = { trim: trim, parseJSONWords: parseJSONWords, parseSRT: parseSRT, groupPhrases: groupPhrases,
        phrasesToText: phrasesToText, textToPhrases: textToPhrases, pickStyles: pickStyles, revealExpr: revealExpr,
        highlightExpr: highlightExpr, accentExpr: accentExpr, wrapLine: wrapLine, STYLES: STYLES,
        pickExits: pickExits, shakeExpr: shakeExpr, punchExpr: punchExpr, typoPlan: typoPlan, typoLayout: typoLayout, heroExpr: heroExpr,
        buildSubs: buildSubs, shakeFrame: shakeFrame, addHookTitle: addHookTitle, addPunchZoom: addPunchZoom,
        accentMoments: accentMoments, punchZoomExpr: punchZoomExpr, addShake: addShake, addPunch: addPunch, addGlow: addGlow, addSweep: addSweep, autoAccents: autoAccents, phraseInfo: phraseInfo, shatterMoveExpr: shatterMoveExpr, shatterFadeExpr: shatterFadeExpr, wordExitExpr: wordExitExpr, EXITS: EXITS };
    if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

    // ---------- UI ----------
    var SEC = "CaptionAE", words = [], offset = 0, srcLayerName = "";
    var scriptDir = File($.fileName).parent;

    function pref(k, d) { return app.settings.haveSetting(SEC, k) ? app.settings.getSetting(SEC, k) : d; }
    function setPref(k, v) { app.settings.saveSetting(SEC, k, String(v)); }

    function readFile(f) { f.encoding = "UTF-8"; f.open("r"); var s = f.read(); f.close(); return s; }

    function defaultPython() {
        if ($.os.indexOf("Windows") >= 0) return "python";
        // same list as install/install_mac.command, which installs faster-whisper into each of these
        var c = ["/opt/homebrew/bin/python3", "/usr/local/bin/python3",
            "/Library/Frameworks/Python.framework/Versions/Current/bin/python3", "/usr/bin/python3"];
        for (var i = 0; i < c.length; i++) if (File(c[i]).exists) return c[i];
        return "python3";
    }

    function activeComp() {
        var c = app.project.activeItem;
        if (!(c && c instanceof CompItem)) { alert("Откройте композицию."); return null; }
        return c;
    }

    function canRunCommands() {
        if (app.preferences.getPrefAsLong("Main Pref Section", "Pref_SCRIPTING_FILE_NETWORK_SECURITY") !== 1) {
            alert("Включите: Edit (After Effects) > Preferences > Scripting & Expressions >\n«Allow Scripts to Write Files and Access Network», затем повторите.");
            return false;
        }
        return true;
    }

    function hex(c) { return [parseInt(c.substr(0, 2), 16) / 255, parseInt(c.substr(2, 2), 16) / 255, parseInt(c.substr(4, 2), 16) / 255]; }

    var win = thisObj instanceof Panel ? thisObj : new Window("palette", "Caption AE — субтитры, тряска, акценты", undefined, { resizeable: true });
    win.orientation = "column"; win.alignChildren = ["fill", "top"]; win.spacing = 6; win.margins = 10;

    var tabs = win.add("tabbedpanel"); tabs.alignChildren = ["fill", "top"];
    var tSub = tabs.add("tab", undefined, "Субтитры"); tSub.alignChildren = ["fill", "top"];
    var tPlain = tabs.add("tab", undefined, "Простые субтитры"); tPlain.alignChildren = ["fill", "top"];
    var tShake = tabs.add("tab", undefined, "Тряска"); tShake.alignChildren = ["fill", "top"];
    var tHit = tabs.add("tab", undefined, "Акцент-эффекты"); tHit.alignChildren = ["fill", "top"];
    var g1 = tSub.add("panel", undefined, "1. Текст"); g1.alignChildren = ["fill", "top"];
    var r1 = g1.add("group");
    var bTrans = r1.add("button", undefined, "Распознать речь слоя");
    var bImport = r1.add("button", undefined, "Импорт SRT / JSON");
    var r1b = g1.add("group");
    r1b.add("statictext", undefined, "Язык");
    var ddLang = r1b.add("dropdownlist", undefined, ["ru", "en", "auto"]); ddLang.selection = 0;
    r1b.add("statictext", undefined, "Модель");
    var ddModel = r1b.add("dropdownlist", undefined, ["small", "medium", "large-v3"]);
    ddModel.selection = { small: 0, medium: 1, "large-v3": 2 }[pref("model", "small")] || 0;
    var r1c = g1.add("group");
    r1c.add("statictext", undefined, "Python");
    var ePy = r1c.add("edittext", undefined, pref("python", defaultPython())); ePy.characters = 26;

    var editor = g1.add("edittext", undefined, "", { multiline: true, scrolling: true });
    editor.preferredSize = [380, 220];
    g1.add("statictext", undefined, "Строка = фраза на экране. Правьте слова, Enter делит фразу, *слово* = акцент.", { multiline: true });

    var g2 = tSub.add("panel", undefined, "2. Показ и разбивка"); g2.alignChildren = ["left", "top"];
    var DISPLAY = [["flow", "Фраза: слова появляются по мере речи"], ["single", "По одному слову (слово сменяет слово)"],
        ["whole", "Фраза целиком сразу"], ["block", "Блок из 2 строк: слова по мере речи"]];
    var dNames = []; for (var di = 0; di < DISPLAY.length; di++) dNames.push(DISPLAY[di][1]);
    var ddDisplay = g2.add("dropdownlist", undefined, dNames); ddDisplay.selection = Math.min(+pref("display", "0"), DISPLAY.length - 1);
    var g2r = g2.add("group");
    g2r.add("statictext", undefined, "Слов в строке до");
    var eWords = g2r.add("edittext", undefined, pref("maxWords", "3")); eWords.characters = 3;
    g2r.add("statictext", undefined, "Букв до");
    var eChars = g2r.add("edittext", undefined, pref("maxChars", "18")); eChars.characters = 3;
    var bRegroup = g2r.add("button", undefined, "Разбить заново");

    var g3 = tSub.add("panel", undefined, "3. Стиль"); g3.alignChildren = ["fill", "top"];
    var rP = g3.add("group"); rP.add("statictext", undefined, "Пресет");
    var PRESETS = ["Свои настройки", "Сторителлинг — сдержанно", "Динамично (TikTok)", "Jatho — эксперт", "Простые субтитры"];
    var ddPreset = rP.add("dropdownlist", undefined, PRESETS); ddPreset.selection = Math.min(+pref("preset", "1"), PRESETS.length - 1);
    var names = ["Микс (разная анимация, акценты — удар/глитч)"];
    for (var si = 1; si < STYLE_KEYS.length; si++) names.push(STYLES[STYLE_KEYS[si]].name);
    var rS = g3.add("group"); rS.add("statictext", undefined, "Появление");
    var ddStyle = rS.add("dropdownlist", undefined, names); ddStyle.selection = Math.min(+pref("style", String(STYLE_KEYS.length - 1)), names.length - 1);
    var exNames = ["Микс (акценты — распад)"];
    for (si = 1; si < EXIT_KEYS.length; si++) exNames.push(EXITS[EXIT_KEYS[si]].name);
    var rE = g3.add("group"); rE.add("statictext", undefined, "Уход");
    var ddExit = rE.add("dropdownlist", undefined, exNames); ddExit.selection = Math.min(+pref("exit", String(EXIT_KEYS.length - 1)), exNames.length - 1);

    var gm = g3.add("panel", undefined, "Что разрешено «Миксу»"); gm.alignChildren = ["left", "top"];
    var MIX_UI = [["pop", "Pop"], ["slide", "Выезд"], ["blur", "Размытие"], ["cut", "Рубленый"], ["rise", "Подъём"],
        ["flick", "Мерцание"], ["punch", "Удар"], ["glitch", "Глитч"], ["soft", "Кино"]];
    var EXIT_UI = [["fade", "Затухание"], ["shatter", "Распад"], ["up", "Вылет"], ["blurout", "Размытие"], ["flick", "Мерцание"], ["soft", "Мягкий"]];
    var onIn = "," + pref("enIn", "pop,slide,blur,cut,rise,flick,punch,glitch,soft") + ",";
    var onOut = "," + pref("enOut", "fade,shatter,up,blurout,flick,soft") + ",";
    var cbIn = [], cbOut = [], row, ci;
    gm.add("statictext", undefined, "Появление:");
    for (ci = 0; ci < MIX_UI.length; ci++) {
        if (ci % 4 === 0) row = gm.add("group");
        cbIn.push(row.add("checkbox", undefined, MIX_UI[ci][1])); cbIn[ci].value = onIn.indexOf("," + MIX_UI[ci][0] + ",") >= 0;
    }
    gm.add("statictext", undefined, "Уход:");
    row = gm.add("group");
    for (ci = 0; ci < EXIT_UI.length; ci++) {
        cbOut.push(row.add("checkbox", undefined, EXIT_UI[ci][1])); cbOut[ci].value = onOut.indexOf("," + EXIT_UI[ci][0] + ",") >= 0;
    }
    var cSmart = gm.add("checkbox", undefined, "Умный подбор: паузы, вопросы, темп речи, конец предложения");
    cSmart.value = pref("smart", "1") === "1";
    var rv = gm.add("group");
    var cVoice = rv.add("checkbox", undefined, "Акценты по голосу: громче на"); cVoice.value = pref("voice", "1") === "1";
    var eThr = rv.add("edittext", undefined, pref("thr", "5")); eThr.characters = 3;
    rv.add("statictext", undefined, "дБ");

    function checkedKeys(cbs, ui) {
        var en = {}, list = [], i;
        for (i = 0; i < cbs.length; i++) if (cbs[i].value) { en[ui[i][0]] = true; list.push(ui[i][0]); }
        en.list = list.join(",");
        return en;
    }
    var r3 = g3.add("group");
    r3.add("statictext", undefined, "Шрифт (PostScript)");
    var eFont = r3.add("edittext", undefined, pref("font", "PlayfairDisplay-Regular")); eFont.characters = 18;
    var r3b = g3.add("group");
    r3b.add("statictext", undefined, "Размер");
    var eSize = r3b.add("edittext", undefined, pref("size", "74")); eSize.characters = 4;
    r3b.add("statictext", undefined, "Высота, % кадра");
    var ePos = r3b.add("edittext", undefined, pref("posY", "72")); ePos.characters = 4;
    var r3c = g3.add("group");
    r3c.add("statictext", undefined, "Подсветка #");
    var eHl = r3c.add("edittext", undefined, pref("hl", "FFD400")); eHl.characters = 7;
    r3c.add("statictext", undefined, "Акцент #");
    var eAcc = r3c.add("edittext", undefined, pref("acc", "FFFFFF")); eAcc.characters = 7;
    r3c.add("statictext", undefined, "крупнее, %");
    var eAccS = r3c.add("edittext", undefined, pref("accS", "112")); eAccS.characters = 4;
    var r3d = g3.add("group");
    var cKara = r3d.add("checkbox", undefined, "Караоке-подсветка"); cKara.value = pref("kara", "0") === "1";
    var cUpper = r3d.add("checkbox", undefined, "КАПС"); cUpper.value = pref("upper", "0") === "1";
    var cStroke = r3d.add("checkbox", undefined, "Обводка"); cStroke.value = pref("stroke", "0") === "1";
    var cShadow = r3d.add("checkbox", undefined, "Тень"); cShadow.value = pref("shadow", "1") === "1";
    var cMblur = g3.add("checkbox", undefined, "Motion blur (плавнее движение, рендер дольше)"); cMblur.value = pref("mblur", "1") === "1";
    var cHotHit = g3.add("checkbox", undefined, "Акцентные фразы: толчок + тряска на акцентном слове"); cHotHit.value = pref("hotHit", "0") === "1";
    var rz = g3.add("group");
    var cZoom = rz.add("checkbox", undefined, "Панч-зум видео на акцентах"); cZoom.value = pref("zoom", "0") === "1";
    var eZoom = rz.add("edittext", undefined, pref("zoomAmt", "12")); eZoom.characters = 3;
    rz.add("statictext", undefined, "%");
    var ddZoomKind = rz.add("dropdownlist", undefined, ["скачком", "плавно"]); ddZoomKind.selection = +pref("zoomKind", "0");

    var g5 = tSub.add("panel", undefined, "4. Типографика и свет"); g5.alignChildren = ["left", "top"];
    var TYPO = [["plain", "Одинаковая"], ["all", "Разная во всех фразах"], ["mix", "Микс: разная на акцентах и каждой 3-й фразе"],
        ["accent", "Только акцентное слово"]];
    var tyNames = []; for (si = 0; si < TYPO.length; si++) tyNames.push(TYPO[si][1]);
    var t1r = g5.add("group"); t1r.add("statictext", undefined, "Типографика");
    var ddTypo = t1r.add("dropdownlist", undefined, tyNames); ddTypo.selection = Math.min(+pref("typo", "3"), TYPO.length - 1);
    var t2r = g5.add("group"); t2r.add("statictext", undefined, "Шрифт крупного слова");
    var eFont2 = t2r.add("edittext", undefined, pref("font2", "PlayfairDisplay-Black")); eFont2.characters = 18;
    var t3r = g5.add("group");
    t3r.add("statictext", undefined, "Крупное, %"); var eBig = t3r.add("edittext", undefined, pref("bigPct", "200")); eBig.characters = 4;
    t3r.add("statictext", undefined, "Мелкие слова, %"); var eSmall = t3r.add("edittext", undefined, pref("smallPct", "100")); eSmall.characters = 4;
    var LIGHT = [["none", "нет"], ["hot", "на акцентных"], ["all", "на всех"]];
    var lNames = []; for (si = 0; si < LIGHT.length; si++) lNames.push(LIGHT[si][1]);
    var t4r = g5.add("group");
    t4r.add("statictext", undefined, "Свечение"); var ddGlow = t4r.add("dropdownlist", undefined, lNames); ddGlow.selection = +pref("glow", "0");
    t4r.add("statictext", undefined, "Блик"); var ddSweep = t4r.add("dropdownlist", undefined, lNames); ddSweep.selection = +pref("sweep", "0");
    var t5r = g5.add("group");
    var cHeroUp = t5r.add("checkbox", undefined, "Крупное слово КАПСОМ"); cHeroUp.value = pref("heroUp", "1") === "1";
    var cHeroFly = t5r.add("checkbox", undefined, "Влетает с 160%"); cHeroFly.value = pref("heroFly", "1") === "1";
    g5.add("statictext", undefined, "Крупное слово = акцент *…*, иначе самое длинное. Мелкие = слова до 3 букв.\nРазные шрифт и размер в одной фразе — AE 2024 и новее.", { multiline: true });

    // presets fill the controls; anything can still be changed by hand afterwards
    function applyPreset(k) {
        var P = [null, {
            style: "soft", exit: "soft", font: "PlayfairDisplay-Regular", size: 74, kara: false, upper: false, stroke: false, shadow: true,
            hotHit: false, acc: "FFFFFF", typo: "accent", font2: "PlayfairDisplay-Black", big: 200, small: 100, glow: 0, sweep: 0, heroUp: true, heroFly: true
        }, {
            style: "pop", exit: "fade", font: "Montserrat-ExtraBold", size: 80, kara: true, upper: true, stroke: true, shadow: true,
            hotHit: true, acc: "FFFFFF", typo: "plain", font2: "PlayfairDisplay-Black", big: 160, small: 100, glow: 0, sweep: 0, heroUp: true, heroFly: false
        }, {
            // Devin Jatho: white bold caps at Y≈1450 with a soft shadow (no hard outline), phrase pops, accent word red, punch-in on accents
            style: "jpop", exit: "fade", font: "Montserrat-ExtraBold", size: 92, kara: false, upper: true, stroke: false, shadow: true,
            hotHit: false, acc: "E51926", typo: "plain", font2: "PlayfairDisplay-Black", big: 160, small: 100, glow: 0, sweep: 0, heroUp: true, heroFly: false,
            display: "whole", posY: 75, words: 3, zoom: true, accS: 100
        }, {
            // plain captions: no reveal, no exit, no karaoke, no accents growing — just the text and the soft shadow
            style: "none", exit: "none", font: "Montserrat-ExtraBold", size: 72, kara: false, upper: false, stroke: false, shadow: true,
            hotHit: false, acc: "FFFFFF", typo: "plain", font2: "PlayfairDisplay-Black", big: 160, small: 100, glow: 0, sweep: 0, heroUp: false, heroFly: false,
            display: "whole", posY: 75, words: 4, zoom: false, accS: 100
        }][k];
        if (!P) return;
        ddStyle.selection = STYLE_KEYS.indexOf(P.style); ddExit.selection = EXIT_KEYS.indexOf(P.exit);
        eFont.text = P.font; eSize.text = P.size; cKara.value = P.kara; cUpper.value = P.upper; cStroke.value = P.stroke;
        cShadow.value = P.shadow; cHotHit.value = P.hotHit; eAcc.text = P.acc; eHl.text = "F7D640";
        for (var i = 0; i < TYPO.length; i++) if (TYPO[i][0] === P.typo) ddTypo.selection = i;
        eFont2.text = P.font2; eBig.text = P.big; eSmall.text = P.small; ddGlow.selection = P.glow; ddSweep.selection = P.sweep;
        cHeroUp.value = P.heroUp; cHeroFly.value = P.heroFly; cMblur.value = true; cZoom.value = !!P.zoom;
        ePos.text = P.posY || 72; eWords.text = P.words || 3; eAccS.text = P.accS || 112;
        for (i = 0; i < DISPLAY.length; i++) if (DISPLAY[i][0] === (P.display || "flow")) ddDisplay.selection = i;
    }
    ddPreset.onChange = function () { if (ddPreset.selection) applyPreset(ddPreset.selection.index); };

    var r4 = tSub.add("group"); r4.alignment = ["fill", "top"];
    var bBuild = r4.add("button", undefined, "Создать субтитры");
    var bRemove = r4.add("button", undefined, "Удалить субтитры");
    var gs = tShake.add("panel", undefined, "Тряска кадра или слоёв"); gs.alignChildren = ["left", "top"];
    var s1 = gs.add("group"); s1.add("statictext", undefined, "Тип");
    var shNames = []; for (si = 0; si < SHAKE_KEYS.length; si++) shNames.push(SHAKES[SHAKE_KEYS[si]]);
    var ddShake = s1.add("dropdownlist", undefined, shNames); ddShake.selection = Math.min(+pref("shKind", "0"), 2);
    s1.add("statictext", undefined, "На");
    var ddTarget = s1.add("dropdownlist", undefined, ["весь кадр", "выделенные слои"]); ddTarget.selection = +pref("shTarget", "0");
    var s2 = gs.add("group"); s2.add("statictext", undefined, "Ритм");
    var rhNames = []; for (si = 0; si < RHYTHM.length; si++) rhNames.push(RHYTHM[si][0]);
    var ddRh = s2.add("dropdownlist", undefined, rhNames); ddRh.selection = +pref("shRh", "2");
    s2.add("statictext", undefined, "Частота, Гц");
    var eFreq = s2.add("edittext", undefined, pref("shFreq", "14")); eFreq.characters = 4;
    ddRh.onChange = function () { if (ddRh.selection) eFreq.text = RHYTHM[ddRh.selection.index][1]; };
    var s2b = gs.add("group"); s2b.add("statictext", undefined, "Сила");
    var pwNames = []; for (si = 0; si < POWER.length; si++) pwNames.push(POWER[si][0]);
    var ddPow = s2b.add("dropdownlist", undefined, pwNames); ddPow.selection = +pref("shPow", "1");
    s2b.add("statictext", undefined, "(заполняет поля ниже, их можно менять)");
    var s3 = gs.add("group");
    s3.add("statictext", undefined, "Сила, px"); var ePx = s3.add("edittext", undefined, pref("shPx", "25")); ePx.characters = 4;
    s3.add("statictext", undefined, "Поворот, °"); var eRot = s3.add("edittext", undefined, pref("shRot", "1.5")); eRot.characters = 4;
    s3.add("statictext", undefined, "Зум, %"); var eZoom = s3.add("edittext", undefined, pref("shZoom", "3")); eZoom.characters = 4;
    ddPow.onChange = function () {
        if (!ddPow.selection) return;
        var w = POWER[ddPow.selection.index]; ePx.text = w[1]; eRot.text = w[2]; eZoom.text = w[3];
    };
    var s4 = gs.add("group");
    s4.add("statictext", undefined, "Длительность, с"); var eDur = s4.add("edittext", undefined, pref("shDur", "1.5")); eDur.characters = 4;
    s4.add("statictext", undefined, "Резкость 1–4"); var eSharp = s4.add("edittext", undefined, pref("shSharp", "2")); eSharp.characters = 3;
    var cShBlur = gs.add("checkbox", undefined, "Размытие в движении"); cShBlur.value = pref("shBlur", "1") === "1";
    var cKeepSubs = gs.add("checkbox", undefined, "Субтитры не трясти (весь кадр)"); cKeepSubs.value = pref("shKeep", "1") === "1";
    var bShake = gs.add("button", undefined, "Добавить тряску с текущего кадра");
    gs.add("statictext", undefined, "Потом: эффекты Shake… на слое — сила, частота, поворот, зум, резкость;\nключи Shake amount — форма нарастания/затухания (двигайте их).", { multiline: true });

    bShake.onClick = function () {
        var comp = activeComp(); if (!comp) return;
        var o = { kind: SHAKE_KEYS[ddShake.selection.index], t0: comp.time, dur: Math.max(0.1, +eDur.text || 1.5),
            freq: +eFreq.text || 14, px: +ePx.text || 0, rot: +eRot.text || 0, zoom: +eZoom.text || 0,
            sharp: Math.max(1, Math.min(4, +eSharp.text || 2)), blur: cShBlur.value, keepSubs: cKeepSubs.value };
        var keep = { shKind: ddShake.selection.index, shTarget: ddTarget.selection.index, shRh: ddRh.selection ? ddRh.selection.index : 2, shPow: ddPow.selection ? ddPow.selection.index : 1,
            shFreq: eFreq.text, shPx: ePx.text, shRot: eRot.text, shZoom: eZoom.text, shDur: eDur.text, shSharp: eSharp.text,
            shBlur: cShBlur.value ? 1 : 0, shKeep: cKeepSubs.value ? 1 : 0 };
        for (var k in keep) setPref(k, keep[k]);
        app.beginUndoGroup("Caption AE: тряска");
        try {
            if (ddTarget.selection.index === 0) { shakeFrame(comp, o); status.text = "Тряска на весь кадр: слой SHAKE."; }
            else {
                var sel = comp.selectedLayers, i;
                if (!sel.length) { alert("Выделите слои."); }
                for (i = 0; i < sel.length; i++) addShake(comp, sel[i], o);
                if (sel.length) status.text = "Тряска добавлена на " + sel.length + " слой(ёв).";
            }
        } catch (e) { alert("Ошибка: " + e + " (строка " + e.line + ")"); }
        app.endUndoGroup();
    };

    var gh = tHit.add("panel", undefined, "Акцент на выделенных слоях (текст, видео, фото)"); gh.alignChildren = ["left", "top"];
    var h1 = gh.add("group"); h1.add("statictext", undefined, "Эффект");
    var phNames = []; for (si = 0; si < PUNCH_KEYS.length; si++) phNames.push(PUNCHES[PUNCH_KEYS[si]][0]);
    var ddPunch = h1.add("dropdownlist", undefined, phNames); ddPunch.selection = Math.min(+pref("hKind", "0"), 2);
    var h2 = gh.add("group"); h2.add("statictext", undefined, "Сила");
    var ddHPow = h2.add("dropdownlist", undefined, ["Мягко", "Средне", "Сильно"]); ddHPow.selection = +pref("hPow", "1");
    h2.add("statictext", undefined, "Длительность ×");
    var eHDur = h2.add("edittext", undefined, pref("hDur", "1")); eHDur.characters = 4;
    var h3 = gh.add("group"); h3.add("statictext", undefined, "Когда");
    var ddWhen = h3.add("dropdownlist", undefined, ["с текущего кадра", "с начала каждого слоя"]); ddWhen.selection = +pref("hWhen", "0");
    var cHShake = gh.add("checkbox", undefined, "+ резкая тряска в момент удара"); cHShake.value = pref("hShake", "1") === "1";
    var cHBlur = gh.add("checkbox", undefined, "Размытие в движении"); cHBlur.value = pref("hBlur", "1") === "1";
    var bHit = gh.add("button", undefined, "Применить к выделенным слоям");
    var hl = gh.add("group");
    var bGlow = hl.add("button", undefined, "Свечение");
    var bSweep = hl.add("button", undefined, "Блик (Light Sweep) с текущего кадра");
    gh.add("statictext", undefined, "Можно выделить сразу все фразы субтитров и выбрать «с начала каждого слоя».\nСилу потом меняет эффект Hit scale на слое.", { multiline: true });

    bHit.onClick = function () {
        var comp = activeComp(); if (!comp) return;
        var sel = comp.selectedLayers, i;
        if (!sel.length) { alert("Выделите слои."); return; }
        var key = PUNCH_KEYS[ddPunch.selection.index], P = PUNCHES[key], mult = [0.5, 1, 1.6][ddHPow.selection.index];
        var d = P[2] * Math.max(0.2, +eHDur.text || 1);
        var keep = { hKind: ddPunch.selection.index, hPow: ddHPow.selection.index, hDur: eHDur.text, hWhen: ddWhen.selection.index,
            hShake: cHShake.value ? 1 : 0, hBlur: cHBlur.value ? 1 : 0 };
        for (var k in keep) setPref(k, keep[k]);
        app.beginUndoGroup("Caption AE: акцент");
        try {
            for (i = 0; i < sel.length; i++) {
                var t0 = ddWhen.selection.index ? sel[i].inPoint : comp.time;
                addPunch(comp, sel[i], { kind: key, t0: t0, d: d, s: Math.round(100 + P[1] * mult), blur: cHBlur.value });
                if (cHShake.value) addShake(comp, sel[i], { kind: "hit", t0: t0, dur: 0.35, freq: 20, px: Math.round(16 * mult),
                    rot: 2 * mult, zoom: 0, sharp: 3, blur: cHBlur.value });
            }
            status.text = "Акцент добавлен на " + sel.length + " слой(ёв).";
        } catch (e) { alert("Ошибка: " + e + " (строка " + e.line + ")"); }
        app.endUndoGroup();
    };

    var gk = tHit.add("panel", undefined, "Заголовок-хук (две строки, как у Jatho)"); gk.alignChildren = ["left", "top"];
    var k1 = gk.add("group"); k1.add("statictext", undefined, "Строка 1 (белая)");
    var eL1 = k1.add("edittext", undefined, pref("hk1", "SAME VIDEO BUT")); eL1.characters = 22;
    var k2 = gk.add("group"); k2.add("statictext", undefined, "Строка 2 (цвет)");
    var eL2 = k2.add("edittext", undefined, pref("hk2", "125X VIEWS")); eL2.characters = 22;
    var HOOK_COL = [["красный — проблема", "E51926"], ["зелёный — успех", "39E75F"], ["жёлтый", "FFD400"], ["фиолетовый — бренд", "A855F7"], ["голубой — цифры", "22D3EE"]];
    var hcNames = []; for (si = 0; si < HOOK_COL.length; si++) hcNames.push(HOOK_COL[si][0]);
    var k3 = gk.add("group"); k3.add("statictext", undefined, "Цвет");
    var ddHC = k3.add("dropdownlist", undefined, hcNames); ddHC.selection = +pref("hkCol", "0");
    var k4 = gk.add("group");
    k4.add("statictext", undefined, "Длительность, с"); var eHkDur = k4.add("edittext", undefined, pref("hkDur", "1.8")); eHkDur.characters = 4;
    k4.add("statictext", undefined, "Высота, % кадра"); var eHkY = k4.add("edittext", undefined, pref("hkY", "40")); eHkY.characters = 4;
    var cHkGlow = gk.add("checkbox", undefined, "Свечение цветной строки"); cHkGlow.value = pref("hkGlow", "1") === "1";
    var bHook = gk.add("button", undefined, "Добавить заголовок с текущего кадра");
    bHook.onClick = function () {
        var comp = activeComp(); if (!comp) return;
        var keep = { hk1: eL1.text, hk2: eL2.text, hkCol: ddHC.selection.index, hkDur: eHkDur.text, hkY: eHkY.text, hkGlow: cHkGlow.value ? 1 : 0 };
        for (var k in keep) setPref(k, keep[k]);
        app.beginUndoGroup("Caption AE: заголовок");
        try {
            addHookTitle(comp, { l1: eL1.text, l2: eL2.text, color: hex(HOOK_COL[ddHC.selection.index][1]), t0: comp.time,
                dur: Math.max(0.3, +eHkDur.text || 1.8), y: (+eHkY.text || 40) / 100, font: "Montserrat-ExtraBold", glow: cHkGlow.value });
            status.text = "Заголовок добавлен: слои HOOK 1 / HOOK 2.";
        } catch (e) { alert("Ошибка: " + e + " (строка " + e.line + ")"); }
        app.endUndoGroup();
    };

    function eachSelected(name, fn) {
        var comp = activeComp(); if (!comp) return;
        var sel = comp.selectedLayers, i;
        if (!sel.length) { alert("Выделите слои."); return; }
        app.beginUndoGroup("Caption AE: " + name);
        try { for (i = 0; i < sel.length; i++) fn(comp, sel[i]); status.text = name + ": " + sel.length + " слой(ёв)."; }
        catch (e) { alert("Ошибка: " + e + " (строка " + e.line + ")"); }
        app.endUndoGroup();
    }
    bGlow.onClick = function () { eachSelected("свечение", function (c, L) { addGlow(L, +eSize.text || 90); }); };
    bSweep.onClick = function () { eachSelected("блик", function (c, L) { addSweep(L, c.time, 0.6 * Math.max(0.2, +eHDur.text || 1)); }); };

    // ---------- plain captions: a separate tool, no animation; words per caption and duration are the controls ----------
    var gp = tPlain.add("panel", undefined, "Простые субтитры — без анимации"); gp.alignChildren = ["left", "top"];
    var p0 = gp.add("group");
    var bPTrans = p0.add("button", undefined, "Распознать речь слоя");
    var bPImp = p0.add("button", undefined, "Импорт SRT / JSON");
    var pInfo = gp.add("statictext", undefined, "Текст: ещё не загружен", { truncate: "end" }); pInfo.preferredSize = [380, 18];
    var p1 = gp.add("group"); p1.add("statictext", undefined, "Слов в строке");
    var ddPN = p1.add("dropdownlist", undefined, ["1", "2", "3", "4", "5", "6"]); ddPN.selection = Math.min(+pref("pN", "1"), 5);
    p1.add("statictext", undefined, "Строк");
    var ddPL = p1.add("dropdownlist", undefined, ["1", "2"]); ddPL.selection = Math.min(+pref("pLines", "0"), 1);
    p1.add("statictext", undefined, "Межстрочный, %");
    var ePLead = p1.add("edittext", undefined, pref("pLead", "110")); ePLead.characters = 4;
    var cPBreak = gp.add("checkbox", undefined, "Рвать на точках и паузах (без галочки — строго по N слов)"); cPBreak.value = pref("pBreak", "1") === "1";
    var p2 = gp.add("group"); p2.add("statictext", undefined, "Длительность");
    var ddPDur = p2.add("dropdownlist", undefined, ["по речи — до следующих слов", "фиксированная"]); ddPDur.selection = +pref("pDurMode", "0");
    var p3 = gp.add("group");
    p3.add("statictext", undefined, "Фикс., с"); var ePDur = p3.add("edittext", undefined, pref("pDur", "1.5")); ePDur.characters = 4;
    p3.add("statictext", undefined, "По речи: держать после слова, с"); var ePHold = p3.add("edittext", undefined, pref("pHold", "0.3")); ePHold.characters = 4;
    var p4 = gp.add("group"); p4.add("statictext", undefined, "Шрифт (PostScript)");
    var ePFont = p4.add("edittext", undefined, pref("pFont", "Montserrat-ExtraBold")); ePFont.characters = 18;
    var p5 = gp.add("group");
    p5.add("statictext", undefined, "Размер"); var ePSize = p5.add("edittext", undefined, pref("pSize", "72")); ePSize.characters = 4;
    p5.add("statictext", undefined, "Высота, %"); var ePY = p5.add("edittext", undefined, pref("pY", "75")); ePY.characters = 4;
    p5.add("statictext", undefined, "Цвет #"); var ePCol = p5.add("edittext", undefined, pref("pCol", "FFFFFF")); ePCol.characters = 7;
    var p6 = gp.add("group");
    var cPUp = p6.add("checkbox", undefined, "КАПС"); cPUp.value = pref("pUp", "0") === "1";
    var cPSh = p6.add("checkbox", undefined, "Мягкая тень"); cPSh.value = pref("pSh", "1") === "1";
    var p7 = gp.add("group");
    var bPBuild = p7.add("button", undefined, "Добавить субтитры");
    var bPDel = p7.add("button", undefined, "Удалить субтитры");
    gp.add("statictext", undefined, "Фиксированная длительность обрывается раньше, если следующие слова уже звучат.\nКаждый субтитр — обычный текстовый слой, правится руками.", { multiline: true });

    function plainInfo() { pInfo.text = words.length ? "Текст: " + words.length + " слов, " + fmtTime(words[words.length - 1].end) : "Текст: ещё не загружен"; }
    bPTrans.onClick = function () { bTrans.onClick(); plainInfo(); };
    bPImp.onClick = function () { bImport.onClick(); plainInfo(); };
    bPDel.onClick = function () { bRemove.onClick(); };
    bPBuild.onClick = function () {
        var comp = activeComp(); if (!comp) return;
        if (!words.length) { alert("Сначала распознайте речь или импортируйте субтитры."); return; }
        var per = ddPN.selection.index + 1, lines = ddPL.selection.index + 1, n = per * lines, fixed = ddPDur.selection.index === 1;
        var keep = { pN: ddPN.selection.index, pLines: ddPL.selection.index, pLead: ePLead.text, pBreak: cPBreak.value ? 1 : 0, pDurMode: ddPDur.selection.index, pDur: ePDur.text, pHold: ePHold.text,
            pFont: ePFont.text, pSize: ePSize.text, pY: ePY.text, pCol: ePCol.text, pUp: cPUp.value ? 1 : 0, pSh: cPSh.value ? 1 : 0 };
        for (var k in keep) setPref(k, keep[k]);
        var ph = groupPhrases(words, n, 999, cPBreak.value ? 0.4 : 1e9, !cPBreak.value);
        var col = hex(ePCol.text.replace("#", ""));
        var opt = { en: {}, smart: false, style: "none", exit: "none", mblur: false, font: ePFont.text, size: +ePSize.text || 72,
            posY: (+ePY.text || 75) / 100, maxChars: 999, lineWords: lines === 2 ? per : 0, leadingPct: Math.max(50, +ePLead.text || 110), hold: Math.max(0, +ePHold.text || 0), fixedDur: fixed ? Math.max(0.2, +ePDur.text || 1.5) : 0,
            hl: col, accent: col, karaoke: false, upper: cPUp.value, stroke: false, shadow: cPSh.value, hotHit: false, typo: "plain",
            glow: "none", sweep: "none", display: "whole", accentScale: 100, heroUpper: false, heroFly: false };
        app.beginUndoGroup("Caption AE: простые субтитры");
        try {
            removeSubs(comp);
            var made = buildSubs(comp, ph, opt, offset);
            comp.layer(CTRL).property("ADBE Effect Parade").property("Text").property(1).setValue(col);
            status.text = "Готово: " + made + " субтитров, " + per + " сл. × " + lines + " стр." + (cPBreak.value ? " (с разрывами на паузах)" : " строго") +
                (fixed ? ", по " + opt.fixedDur + " с" : ", по речи") + ".";
        } catch (e) { alert("Ошибка: " + e + " (строка " + e.line + ")"); }
        app.endUndoGroup();
    };

    var status = win.add("statictext", undefined, "Выберите слой с голосом и нажмите «Распознать», или импортируйте SRT.", { truncate: "end" });

    function regroup() {
        if (!words.length) return;
        var mode = DISPLAY[ddDisplay.selection.index][0], mw = Math.max(1, +eWords.text || 3), mc = Math.max(4, +eChars.text || 18);
        if (mode === "single") { mw = 1; mc = 999; }
        if (mode === "block") { mw *= 2; mc = mc * 2 + 1; }
        var ph = groupPhrases(words, mw, mc, 0.4);
        if (cVoice.value) autoAccents(ph, +eThr.text || 5);
        editor.text = phrasesToText(ph);
        status.text = words.length + " слов. Проверьте текст и нажмите «Создать субтитры».";
    }

    bTrans.onClick = function () {
        var comp = activeComp(); if (!comp) return;
        var L = comp.selectedLayers[0];
        if (!L || !L.source || !L.source.file) { alert("Выделите в композиции слой с аудио/видео файлом."); return; }
        if (!canRunCommands()) return;
        var py = File(scriptDir.fsName + "/transcribe.py");
        if (!py.exists) { alert("Рядом со скриптом нет transcribe.py:\n" + py.fsName); return; }
        var out = File(Folder.temp.fsName + "/captionae_words.json"); if (out.exists) out.remove();
        setPref("python", ePy.text); setPref("model", ddModel.selection.text);
        status.text = "Распознаю… (AE подвиснет на время распознавания)"; win.update && win.update();
        var q = function (s) { return '"' + s + '"'; };
        var log = system.callSystem(q(ePy.text) + " " + q(py.fsName) + " " + q(L.source.file.fsName) + " " + q(out.fsName) +
            " " + ddLang.selection.text + " " + ddModel.selection.text);
        if (!out.exists) { alert("Распознавание не удалось:\n" + log); status.text = "Ошибка распознавания."; return; }
        words = parseJSONWords(readFile(out));
        offset = L.startTime; // word times are from the file start; the layer may be shifted in the comp
        srcLayerName = L.name;
        regroup();
    };

    bImport.onClick = function () {
        var f = File.openDialog("Файл субтитров", "Субтитры:*.srt;*.json,All:*.*");
        if (!f) return;
        var s = readFile(f);
        try { words = /\.json$/i.test(f.name) ? parseJSONWords(s) : parseSRT(s); }
        catch (e) { alert("Не удалось прочитать файл: " + e); return; }
        offset = 0; regroup();
    };

    bRegroup.onClick = regroup;
    cVoice.onClick = regroup;
    ddDisplay.onChange = regroup;

    bBuild.onClick = function () {
        var comp = activeComp(); if (!comp) return;
        if (!words.length || !trim(editor.text)) { alert("Сначала распознайте речь или импортируйте субтитры."); return; }
        var opt = {
            en: (function () { var a = checkedKeys(cbIn, MIX_UI), b = checkedKeys(cbOut, EXIT_UI), k; for (k in b) a[k] = b[k]; return a; })(),
            smart: cSmart.value, display: DISPLAY[ddDisplay.selection.index][0], hotHit: cHotHit.value,
            typo: TYPO[ddTypo.selection.index][0], font2: eFont2.text, bigPct: +eBig.text || 160, smallPct: +eSmall.text || 65,
            glow: LIGHT[ddGlow.selection.index][0], sweep: LIGHT[ddSweep.selection.index][0],
            heroUpper: cHeroUp.value, heroFly: cHeroFly.value,
            style: STYLE_KEYS[ddStyle.selection.index], exit: EXIT_KEYS[ddExit.selection.index], mblur: cMblur.value, font: eFont.text, size: +eSize.text || 90,
            posY: (+ePos.text || 72) / 100, maxChars: +eChars.text || 18, hold: 0.4,
            hl: hex(eHl.text.replace("#", "")), accent: hex(eAcc.text.replace("#", "")),
            karaoke: cKara.value, upper: cUpper.value, stroke: cStroke.value, shadow: cShadow.value,
            accentScale: +eAccS.text || 112, zoomAmt: +eZoom.text || 12, zoomDur: ddZoomKind.selection.index ? 4 * comp.frameDuration : 0
        };
        if (cZoom.value) { // the clip that was transcribed, else the selected footage layer
            var zl = srcLayerName ? comp.layer(srcLayerName) : null, sl = comp.selectedLayers;
            for (var si2 = 0; !zl && si2 < sl.length; si2++) if (sl[si2].source && sl[si2].comment.indexOf(TAG) !== 0) zl = sl[si2];
            if (zl) opt.zoomLayer = zl; else { alert("Для панч-зума выделите слой с видео."); return; }
        }
        var keep = { maxWords: eWords.text, maxChars: eChars.text, style: ddStyle.selection.index, exit: ddExit.selection.index,
            mblur: cMblur.value ? 1 : 0, enIn: checkedKeys(cbIn, MIX_UI).list, enOut: checkedKeys(cbOut, EXIT_UI).list,
            smart: cSmart.value ? 1 : 0, display: ddDisplay.selection.index, hotHit: cHotHit.value ? 1 : 0, typo: ddTypo.selection.index, font2: eFont2.text,
            bigPct: eBig.text, smallPct: eSmall.text, glow: ddGlow.selection.index, sweep: ddSweep.selection.index,
            heroUp: cHeroUp.value ? 1 : 0, heroFly: cHeroFly.value ? 1 : 0, preset: ddPreset.selection.index, voice: cVoice.value ? 1 : 0, thr: eThr.text, font: eFont.text, size: eSize.text,
            posY: ePos.text, hl: eHl.text, acc: eAcc.text, kara: cKara.value ? 1 : 0, upper: cUpper.value ? 1 : 0,
            stroke: cStroke.value ? 1 : 0, shadow: cShadow.value ? 1 : 0,
            zoom: cZoom.value ? 1 : 0, zoomAmt: eZoom.text, accS: eAccS.text, zoomKind: ddZoomKind.selection.index };
        for (var k in keep) setPref(k, keep[k]);
        app.beginUndoGroup("Caption AE: создать");
        try {
            removeSubs(comp);
            var n = buildSubs(comp, textToPhrases(editor.text, words), opt, offset);
            status.text = opt.note || ("Готово: " + n + " фраз. Общий вид — эффекты слоя " + CTRL + ".");
        } catch (e) { alert("Ошибка: " + e + " (строка " + e.line + ")"); }
        app.endUndoGroup();
    };

    bRemove.onClick = function () {
        var comp = activeComp(); if (!comp) return;
        app.beginUndoGroup("Caption AE: удалить"); removeSubs(comp); app.endUndoGroup();
        status.text = "Субтитры удалены.";
    };

    win.onResizing = win.onResize = function () { this.layout.resize(); };
    if (win instanceof Window) { win.center(); win.show(); } else { win.layout.layout(true); }
})(this);
