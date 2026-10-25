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
    // ExtendScript arrays have no indexOf (ES3)
    function find(a, v) { for (var i = 0; i < a.length; i++) if (a[i] === v) return i; return -1; }

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
        return "var T=" + arr(T) + ",i=Math.min(textIndex-1,T.length-1),t=time-inPoint;\n" +
            "var v=(t>=T[i]&&(i==T.length-1||t<T[i+1]))?100:0;[v,v,v]";
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
        return n; // only size and height: colours live on the text layers themselves (Character panel works)
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

    // On-screen words without punctuation: quotes and brackets go everywhere, other marks only at the word's edges,
    // so "из-за" and "т.е" keep their inner marks. keepQE leaves ? and ! for intonation. A lone "—" becomes "".
    function stripPunct(w, keepQE) {
        var edge = keepQE ? "[.,;:…—–\\-]" : "[.,;:…—–\\-!?]";
        return String(w).replace(/[«»"“”„()\[\]]/g, "").replace(new RegExp("^" + edge + "+|" + edge + "+$", "g"), "");
    }
    // a phrase with cleaned words; words that were only punctuation drop out
    function cleanPhrase(p, keepQE) {
        var out = [], j, k, c, w;
        for (j = 0; j < p.length; j++) {
            w = stripPunct(p[j].w, keepQE); if (w === "") continue;
            c = {}; for (k in p[j]) c[k] = p[j][k]; c.w = w; out.push(c);
        }
        return out;
    }

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
        if (opt.mblur) comp.motionBlur = true;
        var made = 0, i, j, hotI;
        function on(scope) { return scope === "all" || (scope === "hot" && hotI); } // light on all lines or accent lines
        for (i = 0; i < ph.length; i++) {
            var p = opt.noPunct ? cleanPhrase(ph[i], opt.keepQE) : ph[i], st = STYLES[styles[i]], ws = [], T = [], S = [], A = [];
            if (!p.length) continue; // the phrase was punctuation only
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
            td.font = opt.font; td.fontSize = opt.size; td.fillColor = opt.text || [1, 1, 1];
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
                } else opt.note = "Разные шрифты и размеры в фразе — только в AE 2024+.";
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

            // colours are plain values, not links to CAPTION_CTRL: the Character panel and the animators stay editable,
            // and deleting the null cannot turn anything red
            var anyAcc = false; for (j = 0; j < A.length; j++) if (A[j]) anyAcc = true;
            if (anyAcc) {
                var accP = { "ADBE Text Fill Color": opt.accent };
                if (!plan && accS !== 100) accP["ADBE Text Scale 3D"] = [accS, accS, 100]; // a hero word is already big
                addAnimator(layer, "Accent", accP, accentExpr(A));
            }
            if (opt.karaoke) addAnimator(layer, "Highlight", { "ADBE Text Fill Color": opt.hl, "ADBE Text Scale 3D": [104, 104, 100] }, highlightExpr(S));
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
            // the layer's own Anchor Point value is added on top, so it can still be nudged by hand
            tr.property("ADBE Anchor Point").expression = "var r=sourceRectAtTime(Math.max(inPoint,outPoint-" + D + "-thisComp.frameDuration),false);add([r.left+r.width/2,r.top+r.height/2],value)";
            tr.property("ADBE Position").setValue([comp.width / 2, comp.height * opt.posY]);
            tr.property("ADBE Position").expression = ctrlPosExpr;
            tr.property("ADBE Scale").setValue([fit, fit]);
            tr.property("ADBE Scale").expression = ctrlScaleExpr;
            if (exits[i] === "fade") tr.property("ADBE Opacity").expression = "var f=3*thisComp.frameDuration;value*linear(time,outPoint-f,outPoint,1,0)";
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
        addEffect(layer, "ADBE Slider Control", pre + " amount", 0);
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

        // looked up again by name: in AE, adding the effects above invalidated the reference returned at creation
        var a = fxs.property(pre + " amount").property(1), fr = comp.frameDuration, t0 = o.t0, t1 = o.t0 + o.dur;
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
            tr.property("ADBE Anchor Point").expression = "var r=sourceRectAtTime(inPoint,false);add([r.left+r.width/2,r.top+r.height/2],value)";
            tr.property("ADBE Position").setValue([comp.width / 2, y]);
            tr.property("ADBE Scale").setValue([sc, sc]);
            tr.property("ADBE Scale").expression = popInScale(L.inPoint, S.from, S.d, S.c);
            tr.property("ADBE Opacity").expression = "value*linear(time,inPoint,inPoint+" + (4 * fr) + ",0,1)"; // the layer's Opacity still counts
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

    // size and height of all captions from CAPTION_CTRL; without the null the layer simply keeps its own values
    var ctrlPosExpr = 'try{add(value,[0,thisComp.layer("' + CTRL + '").effect("Y offset")(1)])}catch(e){value}';
    var ctrlScaleExpr = 'try{var s=thisComp.layer("' + CTRL + '").effect("Size %")(1)/100;[value[0]*s,value[1]*s]}catch(e){value}';

    // Recolour captions already in the comp, also ones made by older versions: the text's own fill = text colour,
    // accent / karaoke animators get plain colours (karaoke stays only if «Караоке» is ticked); old links to CAPTION_CTRL ("Base color", Karaoke switch) go away.
    function recolorSubs(comp, o) {
        var n = 0, i, k;
        for (i = 1; i <= comp.numLayers; i++) {
            var L = comp.layer(i);
            if (L.comment !== TAG || !(L instanceof TextLayer)) continue;
            var src = L.property("ADBE Text Properties").property("ADBE Text Document"), td = src.value;
            td.fillColor = o.text; src.setValue(td);
            var ans = L.property("ADBE Text Properties").property("ADBE Text Animators");
            for (k = ans.numProperties; k >= 1; k--) {
                var an = ans.property(k);
                if (an.name === "Base color" || (an.name === "Highlight" && !o.karaoke)) { an.remove(); continue; }
                if (an.name !== "Accent" && an.name !== "Highlight") continue;
                var fc = an.property("ADBE Text Animator Properties").property("ADBE Text Fill Color");
                if (!fc) continue;
                fc.expression = ""; fc.setValue(an.name === "Highlight" ? o.hl : o.accent);
                if (an.name === "Highlight") { // the old karaoke switch lived on the null
                    var am = an.property("ADBE Text Selectors").property(1).property("ADBE Text Expressible Amount");
                    am.expression = am.expression.replace(/,on=thisComp\.layer\("[^"]*"\)\.effect\("Karaoke"\)\(1\)\.value;/, ";").replace("on&&", "");
                }
            }
            var tr = L.property("ADBE Transform Group");
            if (/^value\+\[0,/.test(tr.property("ADBE Position").expression)) tr.property("ADBE Position").expression = ctrlPosExpr;
            var apx = tr.property("ADBE Anchor Point").expression; // older versions ignored the layer's own anchor
            if (/^var r=sourceRectAtTime/.test(apx) && !/add\(/.test(apx))
                tr.property("ADBE Anchor Point").expression = apx.replace(/\[r\.left\+r\.width\/2,r\.top\+r\.height\/2\]$/, "add([r.left+r.width/2,r.top+r.height/2],value)");
            if (/^var s=/.test(tr.property("ADBE Scale").expression)) tr.property("ADBE Scale").expression = ctrlScaleExpr;
            n++;
        }
        return n;
    }

    function removeSubs(comp) {
        var n = 0;
        for (var i = comp.numLayers; i >= 1; i--) if (comp.layer(i).comment === TAG) { comp.layer(i).remove(); n++; }
        return n;
    }

    // Russian number agreement: plural(5, ["фраза", "фразы", "фраз"]) -> "5 фраз"
    function plural(n, f) {
        var a = Math.abs(n) % 100, b = a % 10;
        return n + " " + (a > 10 && a < 20 ? f[2] : b === 1 ? f[0] : b > 1 && b < 5 ? f[1] : f[2]);
    }

    // ---------- replacement dictionary: Whisper's recurring mistakes, fixed once ----------
    // One rule per line: "как распознало = как надо" (also -> or →). Case and ё/е do not matter; several words
    // on the left merge into one ("зелим хан = Зелимхан"). Lines starting with # are notes.
    function normWord(w) { return bare(w).toLowerCase().replace(/ё/g, "е"); }
    function parseDict(text) {
        var lines = String(text).replace(/\r/g, "\n").split("\n"), rules = [], i, m, from;
        for (i = 0; i < lines.length; i++) {
            m = /^(.+?)\s*(?:=|->|→)\s*(.+)$/.exec(trim(lines[i]));
            if (!m || /^#/.test(m[1])) continue;
            from = trim(m[1]).split(/\s+/);
            for (var k = 0; k < from.length; k++) from[k] = normWord(from[k]);
            if (from.join("") !== "") rules.push({ from: from, to: trim(m[2]).split(/\s+/) });
        }
        rules.sort(function (a, b) { return b.from.length - a.from.length; }); // longer phrases first
        return rules;
    }
    // ws: [{w, start, end, ...}]. Keeps the punctuation around the replaced words and a capital at a sentence start;
    // merged words take the span of the originals, split evenly. Returns { words, n } (n = places fixed).
    function applyDict(ws, rules) {
        var out = [], n = 0, i = 0, r, k, ok;
        while (i < ws.length) {
            for (r = 0; r < rules.length; r++) {
                ok = i + rules[r].from.length <= ws.length;
                for (k = 0; ok && k < rules[r].from.length; k++) ok = normWord(ws[i + k].w) === rules[r].from[k];
                if (ok) break;
            }
            if (r === rules.length) { out.push(ws[i]); i++; continue; }
            var a = ws[i], b = ws[i + rules[r].from.length - 1], to = rules[r].to;
            var lead = /^[«"“„(\[]*/.exec(a.w)[0], tail = /[.,!?…;:—»"”)\]]*$/.exec(b.w)[0];
            var cap = /^[«"“„(\[]*[A-ZА-ЯЁ]/.test(a.w), t0 = a.start, d = (b.end - a.start) / to.length;
            for (k = 0; k < to.length; k++) {
                var c = {}, key; for (key in a) c[key] = a[key];
                var w = to[k];
                if (k === 0 && cap) w = w.charAt(0).toUpperCase() + w.substring(1);
                c.w = (k === 0 ? lead : "") + w + (k === to.length - 1 ? tail : "");
                c.start = t0 + k * d; c.end = t0 + (k + 1) * d;
                out.push(c);
            }
            i += rules[r].from.length; n++;
        }
        return { words: out, n: n };
    }
    // the same on the panel's text: keeps "00:01.2 | " prefixes and *accent* marks
    function applyDictText(text, rules) {
        var lines = String(text).replace(/\r/g, "\n").split("\n"), n = 0, i, j;
        for (i = 0; i < lines.length; i++) {
            var bar = lines[i].indexOf("|"), head = bar >= 0 ? lines[i].substring(0, bar + 1) + " " : "";
            var body = trim(bar >= 0 ? lines[i].substring(bar + 1) : lines[i]);
            if (!body) continue;
            var toks = body.split(/\s+/), ws = [];
            for (j = 0; j < toks.length; j++) {
                var acc = /^\*.+\*$/.test(toks[j]);
                ws.push({ w: acc ? toks[j].substring(1, toks[j].length - 1) : toks[j], start: j, end: j + 1, accent: acc });
            }
            var res = applyDict(ws, rules), outT = [];
            for (j = 0; j < res.words.length; j++) outT.push(res.words[j].accent ? "*" + res.words[j].w + "*" : res.words[j].w);
            lines[i] = head + outT.join(" "); n += res.n;
        }
        return { text: lines.join("\n"), n: n };
    }

    // ---------- SRT export: the same phrases and timing as the captions on screen ----------
    function srtStamp(t) {
        var ms = Math.max(0, Math.round(t * 1000)), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60,
            sec = Math.floor(ms / 1000) % 60, r = ms % 1000;
        function z(v, n) { v = String(v); while (v.length < n) v = "0" + v; return v; }
        return z(h, 2) + ":" + z(m, 2) + ":" + z(sec, 2) + "," + z(r, 3);
    }
    // Lines end in \n; saveSrt writes them as CRLF. o: hold (s after the last word), fixedDur, noPunct/keepQE, lineWords (2-line captions)
    function srtText(ph, offset, o) {
        var out = [], n = 0, i, j;
        for (i = 0; i < ph.length; i++) {
            var p = o.noPunct ? cleanPhrase(ph[i], o.keepQE) : ph[i];
            if (!p.length) continue;
            var t0 = offset + p[0].start, last = offset + p[p.length - 1].end;
            var next = i + 1 < ph.length ? offset + ph[i + 1][0].start : last + o.hold;
            var t1 = Math.min(next, last + o.hold);
            if (next - last < 0.6) t1 = next;
            if (o.fixedDur) t1 = Math.min(next, t0 + o.fixedDur);
            if (t1 - t0 < 0.2) t1 = t0 + 0.2;
            var ws = []; for (j = 0; j < p.length; j++) ws.push(p[j].w);
            var txt = o.lineWords && ws.length > o.lineWords ?
                ws.slice(0, o.lineWords).join(" ") + "\n" + ws.slice(o.lineWords).join(" ") : ws.join(" ");
            out.push(++n + "\n" + srtStamp(t0) + " --> " + srtStamp(t1) + "\n" + txt + "\n");
        }
        return out.join("\n");
    }

    // ---------- sound on events: whoosh as a phrase appears, hit on the accent word ----------
    // phrases: "none" | "all" | "pause" (only after a pause ≥ 0.35 s, and the first) | "half" (every 2nd)
    // A hit wins over a whoosh closer than 0.25 s; sounds of one kind are at least 0.25 s apart. Returns [{t, kind}].
    function sfxPlan(ph, offset, phrases, accents) {
        var ev = [], hits = [], i, k, t;
        if (accents) { var am = accentMoments(ph, offset, 1e9); hits = am.A; }
        for (i = 0; i < hits.length; i++) ev.push({ t: hits[i], kind: "hit" });
        for (i = 0; phrases !== "none" && i < ph.length; i++) {
            var inf = phraseInfo(ph, i);
            if (phrases === "pause" && i && inf.gapBefore < 0.35) continue;
            if (phrases === "half" && i % 2) continue;
            t = offset + ph[i][0].start;
            for (k = 0; k < hits.length && Math.abs(hits[k] - t) >= 0.25; k++) {}
            if (k === hits.length) ev.push({ t: t, kind: "whoosh" });
        }
        ev.sort(function (a, b) { return a.t - b.t; });
        var out = [], lastT = {};
        for (i = 0; i < ev.length; i++) {
            if (lastT[ev[i].kind] !== undefined && ev[i].t - lastT[ev[i].kind] < 0.25) continue;
            lastT[ev[i].kind] = ev[i].t; out.push(ev[i]);
        }
        return out;
    }

    var API = { trim: trim, parseDict: parseDict, applyDict: applyDict, applyDictText: applyDictText, srtText: srtText, sfxPlan: sfxPlan, parseJSONWords: parseJSONWords, parseSRT: parseSRT, groupPhrases: groupPhrases,
        phrasesToText: phrasesToText, textToPhrases: textToPhrases, pickStyles: pickStyles, revealExpr: revealExpr,
        highlightExpr: highlightExpr, accentExpr: accentExpr, wrapLine: wrapLine, STYLES: STYLES,
        pickExits: pickExits, shakeExpr: shakeExpr, punchExpr: punchExpr, typoPlan: typoPlan, typoLayout: typoLayout, heroExpr: heroExpr,
        buildSubs: buildSubs, shakeFrame: shakeFrame, addHookTitle: addHookTitle, addPunchZoom: addPunchZoom,
        accentMoments: accentMoments, punchZoomExpr: punchZoomExpr, addShake: addShake, addPunch: addPunch, addGlow: addGlow, addSweep: addSweep, autoAccents: autoAccents, phraseInfo: phraseInfo, shatterMoveExpr: shatterMoveExpr, shatterFadeExpr: shatterFadeExpr, wordExitExpr: wordExitExpr, EXITS: EXITS };
    if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

    // ---------- UI ----------
    var SEC = "CaptionAE", words = [], offset = 0, srcLayerName = "", srcName = ""; // srcName: for the SRT file name
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

    // An error names what failed and the way out; the technical detail goes last, for the bug report
    function fail(what, e) {
        alert(what + "\nОтмените (Ctrl+Z), если что-то успело появиться, и пришлите скриншот этого окна.\n\nПодробности: " +
            e + (e && e.line ? ", строка " + e.line : ""));
    }

    // ASCII-only form of a path for the command line; transcribe.py decodes "hex:…" back to UTF-8
    function hexUtf8(str) {
        var e = encodeURIComponent(str), out = "", i, h;
        for (i = 0; i < e.length; i++) {
            if (e.charAt(i) === "%") { out += e.substr(i + 1, 2); i += 2; }
            else { h = e.charCodeAt(i).toString(16); out += h.length < 2 ? "0" + h : h; }
        }
        return out.toLowerCase();
    }
    // what went wrong with recognition, in words, from transcribe.py's log
    function whyFailed(log) {
        if (/No module named|Не найден распознаватель/.test(log))
            return "Распознавание не установлено для этого Python.\nЗапустите install_windows.bat (Mac: install_mac.command) из архива и повторите.";
        if (/FileNotFoundError|No such file/.test(log))
            return "Python не нашёл файл видео/аудио этого слоя.\nПроверьте, что файл на месте и диск подключён; если путь очень длинный или на сетевом диске — скопируйте файл в обычную папку и переподключите.";
        if (/SSL|CERTIFICATE/i.test(log))
            return "Не удалось скачать модель распознавания (ошибка сертификата).\nMac: Программы → Python 3.x → «Install Certificates.command». Затем повторите.";
        if (/HTTP|Connection|resolve|timed out|huggingface/i.test(log))
            return "Не удалось скачать модель распознавания — нужен интернет при первом запуске. Проверьте сеть и повторите.";
        if (!/Traceback/.test(log)) // no Python traceback at all: Python itself did not start
            return "Python не запустился.\nВ «Настройки ▸» в поле Python впишите: python (или py). На Mac — путь из команды which python3.";
        return "Распознавание не удалось.\nПришлите скриншот этого окна.";
    }

    function hex(c) { return [parseInt(c.substr(0, 2), 16) / 255, parseInt(c.substr(2, 2), 16) / 255, parseInt(c.substr(4, 2), 16) / 255]; }

    var win = thisObj instanceof Panel ? thisObj : new Window("palette", "Caption AE — субтитры, тряска, акценты", undefined, { resizeable: true });
    win.orientation = "column"; win.alignChildren = ["fill", "top"]; win.spacing = 6; win.margins = 10;

    var tabs = win.add("tabbedpanel"); tabs.alignChildren = ["fill", "top"];
    var tSub = tabs.add("tab", undefined, "Субтитры"); tSub.alignChildren = ["fill", "top"];
    var tPlain = tabs.add("tab", undefined, "Простые субтитры"); tPlain.alignChildren = ["fill", "top"];
    var tShake = tabs.add("tab", undefined, "Тряска"); tShake.alignChildren = ["fill", "top"];
    var tHit = tabs.add("tab", undefined, "Акцент-эффекты"); tHit.alignChildren = ["fill", "top"];
    // Compact layout: text + preset + buttons always visible; fine-tuning folds away under «Настройки ▸»,
    // and the «Микс» checklist shows only while a Mix is chosen. Hidden controls get zero size so they take no room.
    function showCtl(c, on) { c.visible = on; c.maximumSize = on ? [4000, 4000] : [0, 0]; }
    function relayout() { try { win.layout.layout(true); win.layout.resize(); } catch (eLay) {} }

    var g1 = tSub.add("panel", undefined, "Текст"); g1.alignChildren = ["fill", "top"]; g1.spacing = 4;
    var r1 = g1.add("group");
    var bTrans = r1.add("button", undefined, "Распознать речь слоя");
    var bImport = r1.add("button", undefined, "Импорт SRT / JSON");
    var editor = g1.add("edittext", undefined, "", { multiline: true, scrolling: true });
    editor.preferredSize = [380, 130];
    var r1b = g1.add("group");
    var bDict = r1b.add("button", undefined, "Словарь замен…");
    bDict.helpTip = "Слова, которые распознавание пишет неправильно: имена, бренды, сленг. Исправляются в каждом новом тексте.";
    var bSrt = r1b.add("button", undefined, "Экспорт SRT");
    bSrt.helpTip = "Файл субтитров с этими фразами — для YouTube, TikTok, Premiere";
    g1.add("statictext", undefined, "Строка = фраза. Enter делит фразу, *слово* = акцент.");

    var r4 = tSub.add("group"); r4.alignment = ["fill", "top"];
    r4.add("statictext", undefined, "Пресет");
    var PRESETS = ["Свои настройки", "Сторителлинг — сдержанно", "Динамично (TikTok)", "Jatho — эксперт", "Простые субтитры"];
    var ddPreset = r4.add("dropdownlist", undefined, PRESETS); ddPreset.selection = Math.min(+pref("preset", "1"), PRESETS.length - 1);
    var r4b = tSub.add("group"); r4b.alignment = ["fill", "top"];
    var bBuild = r4b.add("button", undefined, "Создать субтитры");
    var bRemove = r4b.add("button", undefined, "Удалить субтитры");
    var bSet = r4b.add("button", undefined, "Настройки ▸");

    // ---------- fine-tuning (folded by default) ----------
    var sett = tSub.add("group"); sett.orientation = "column"; sett.alignChildren = ["fill", "top"]; sett.spacing = 6;
    var r1c = sett.add("group");
    r1c.add("statictext", undefined, "Язык");
    var ddLang = r1c.add("dropdownlist", undefined, ["ru", "en", "auto"]); ddLang.selection = 0;
    ddLang.helpTip = "Язык речи для распознавания";
    r1c.add("statictext", undefined, "Модель");
    var ddModel = r1c.add("dropdownlist", undefined, ["small", "medium", "large-v3"]);
    ddModel.selection = { small: 0, medium: 1, "large-v3": 2 }[pref("model", "small")] || 0;
    ddModel.helpTip = "small — быстрее, medium и large-v3 — точнее, но дольше";
    r1c.add("statictext", undefined, "Python");
    var ePy = r1c.add("edittext", undefined, pref("python", defaultPython())); ePy.characters = 14;
    ePy.helpTip = "Путь к Python, в который установлен faster-whisper";

    var g2 = sett.add("panel", undefined, "Разбивка"); g2.alignChildren = ["left", "top"];
    var DISPLAY = [["flow", "По мере речи"], ["single", "По одному слову"], ["whole", "Фраза целиком"], ["block", "Блок 2 строки"]];
    var dNames = []; for (var di = 0; di < DISPLAY.length; di++) dNames.push(DISPLAY[di][1]);
    var g2r = g2.add("group");
    g2r.add("statictext", undefined, "Показ");
    var ddDisplay = g2r.add("dropdownlist", undefined, dNames); ddDisplay.selection = Math.min(+pref("display", "0"), DISPLAY.length - 1);
    g2r.add("statictext", undefined, "Слов");
    var eWords = g2r.add("edittext", undefined, pref("maxWords", "3")); eWords.characters = 2;
    g2r.add("statictext", undefined, "Букв");
    var eChars = g2r.add("edittext", undefined, pref("maxChars", "18")); eChars.characters = 3;
    var bRegroup = g2r.add("button", undefined, "Разбить");
    var g2p = g2.add("group");
    var cNoPunct = g2p.add("checkbox", undefined, "Без знаков препинания"); cNoPunct.value = pref("noPunct", "0") === "1";
    var cKeepQE = g2p.add("checkbox", undefined, "Оставить ? и !"); cKeepQE.value = pref("keepQE", "1") === "1";
    cNoPunct.helpTip = "Убирает точки, запятые, кавычки, тире на экране. Дефис внутри слова (из-за) остаётся.";
    function updPunct() { cKeepQE.enabled = cNoPunct.value; }
    cNoPunct.onClick = updPunct; updPunct();

    var g3 = sett.add("panel", undefined, "Стиль"); g3.alignChildren = ["left", "top"]; g3.spacing = 4;
    var names = ["Микс"];
    for (var si = 1; si < STYLE_KEYS.length; si++) names.push(STYLES[STYLE_KEYS[si]].name);
    var exNames = ["Микс"];
    for (si = 1; si < EXIT_KEYS.length; si++) exNames.push(EXITS[EXIT_KEYS[si]].name);
    var rS = g3.add("group"); rS.add("statictext", undefined, "Появление");
    var ddStyle = rS.add("dropdownlist", undefined, names); ddStyle.selection = Math.min(+pref("style", String(find(STYLE_KEYS, "soft"))), names.length - 1); // default = storytelling preset
    var rE = g3.add("group"); rE.add("statictext", undefined, "Уход");
    var ddExit = rE.add("dropdownlist", undefined, exNames); ddExit.selection = Math.min(+pref("exit", String(find(EXIT_KEYS, "soft"))), exNames.length - 1);

    var gm = g3.add("panel", undefined, "Что разрешено «Миксу»"); gm.alignChildren = ["left", "top"]; gm.spacing = 2;
    var MIX_UI = [["pop", "Pop"], ["slide", "Выезд"], ["blur", "Размытие"], ["cut", "Рубленый"], ["rise", "Подъём"],
        ["flick", "Мерцание"], ["punch", "Удар"], ["glitch", "Глитч"], ["soft", "Кино"]];
    var EXIT_UI = [["fade", "Затухание"], ["shatter", "Распад"], ["up", "Вылет"], ["blurout", "Размытие"], ["flick", "Мерцание"], ["soft", "Мягкий"]];
    var onIn = "," + pref("enIn", "pop,slide,blur,cut,rise,flick,punch,glitch,soft") + ",";
    var onOut = "," + pref("enOut", "fade,shatter,up,blurout,flick,soft") + ",";
    var cbIn = [], cbOut = [], row, ci;
    for (ci = 0; ci < MIX_UI.length; ci++) {
        if (ci % 5 === 0) { row = gm.add("group"); if (!ci) row.add("statictext", undefined, "Вход:"); }
        cbIn.push(row.add("checkbox", undefined, MIX_UI[ci][1])); cbIn[ci].value = onIn.indexOf("," + MIX_UI[ci][0] + ",") >= 0;
    }
    for (ci = 0; ci < EXIT_UI.length; ci++) {
        if (ci % 5 === 0) { row = gm.add("group"); if (!ci) row.add("statictext", undefined, "Уход:"); }
        cbOut.push(row.add("checkbox", undefined, EXIT_UI[ci][1])); cbOut[ci].value = onOut.indexOf("," + EXIT_UI[ci][0] + ",") >= 0;
    }
    var rv = gm.add("group");
    var cSmart = rv.add("checkbox", undefined, "Умный подбор"); cSmart.value = pref("smart", "1") === "1";
    var cVoice = rv.add("checkbox", undefined, "Акценты по голосу, дБ"); cVoice.value = pref("voice", "1") === "1";
    var eThr = rv.add("edittext", undefined, pref("thr", "5")); eThr.characters = 2;

    function checkedKeys(cbs, ui) {
        var en = {}, list = [], i;
        for (i = 0; i < cbs.length; i++) if (cbs[i].value) { en[ui[i][0]] = true; list.push(ui[i][0]); }
        en.list = list.join(",");
        return en;
    }
    var r3 = g3.add("group");
    r3.add("statictext", undefined, "Шрифт");
    var eFont = r3.add("edittext", undefined, pref("font", "PlayfairDisplay-Regular")); eFont.characters = 18;
    r3.add("statictext", undefined, "Размер");
    var eSize = r3.add("edittext", undefined, pref("size", "74")); eSize.characters = 3;
    r3.add("statictext", undefined, "Высота %");
    var ePos = r3.add("edittext", undefined, pref("posY", "72")); ePos.characters = 3;
    var r3c = g3.add("group");
    r3c.add("statictext", undefined, "Подсветка #");
    var eHl = r3c.add("edittext", undefined, pref("hl", "FFD400")); eHl.characters = 6;
    r3c.add("statictext", undefined, "Акцент #");
    var eAcc = r3c.add("edittext", undefined, pref("acc", "FFFFFF")); eAcc.characters = 6;
    r3c.add("statictext", undefined, "крупнее %");
    var eAccS = r3c.add("edittext", undefined, pref("accS", "112")); eAccS.characters = 3;
    var r3e = g3.add("group");
    r3e.add("statictext", undefined, "Текст #");
    var eTxt = r3e.add("edittext", undefined, pref("txt", "FFFFFF")); eTxt.characters = 6;
    var bRecolor = r3e.add("button", undefined, "Перекрасить готовые");
    bRecolor.helpTip = "Новые цвета текста, акцента и подсветки — всем субтитрам Caption AE в композиции, включая сделанные старой версией. " +
        "Одну фразу можно перекрасить и вручную: панель Character (Fill) или аниматор Accent.";
    var r3d = g3.add("group");
    var cKara = r3d.add("checkbox", undefined, "Караоке"); cKara.value = pref("kara", "0") === "1";
    var cUpper = r3d.add("checkbox", undefined, "КАПС"); cUpper.value = pref("upper", "0") === "1";
    var cStroke = r3d.add("checkbox", undefined, "Обводка"); cStroke.value = pref("stroke", "0") === "1";
    var cShadow = r3d.add("checkbox", undefined, "Тень"); cShadow.value = pref("shadow", "1") === "1";
    var cMblur = r3d.add("checkbox", undefined, "Motion blur"); cMblur.value = pref("mblur", "1") === "1";
    var rz = g3.add("group");
    var cHotHit = rz.add("checkbox", undefined, "Толчок на акцентах"); cHotHit.value = pref("hotHit", "0") === "1";
    var cZoom = rz.add("checkbox", undefined, "Панч-зум видео"); cZoom.value = pref("zoom", "0") === "1";
    var eZoom = rz.add("edittext", undefined, pref("zoomAmt", "12")); eZoom.characters = 2;
    rz.add("statictext", undefined, "%");
    var ddZoomKind = rz.add("dropdownlist", undefined, ["скачком", "плавно"]); ddZoomKind.selection = +pref("zoomKind", "0");

    var g5 = sett.add("panel", undefined, "Типографика и свет"); g5.alignChildren = ["left", "top"]; g5.spacing = 4;
    var TYPO = [["plain", "Одинаковая"], ["all", "Разная во всех фразах"], ["mix", "Микс: акценты и каждая 3-я"],
        ["accent", "Только акцентное слово"]];
    var tyNames = []; for (si = 0; si < TYPO.length; si++) tyNames.push(TYPO[si][1]);
    var LIGHT = [["none", "нет"], ["hot", "на акцентных"], ["all", "на всех"]];
    var lNames = []; for (si = 0; si < LIGHT.length; si++) lNames.push(LIGHT[si][1]);
    var t1r = g5.add("group");
    t1r.add("statictext", undefined, "Крупное слово");
    var ddTypo = t1r.add("dropdownlist", undefined, tyNames); ddTypo.selection = Math.min(+pref("typo", "3"), TYPO.length - 1);
    var t2r = g5.add("group"); t2r.add("statictext", undefined, "Шрифт");
    var eFont2 = t2r.add("edittext", undefined, pref("font2", "PlayfairDisplay-Black")); eFont2.characters = 15;
    t2r.add("statictext", undefined, "Крупное %"); var eBig = t2r.add("edittext", undefined, pref("bigPct", "200")); eBig.characters = 3;
    t2r.add("statictext", undefined, "Мелкие %"); var eSmall = t2r.add("edittext", undefined, pref("smallPct", "100")); eSmall.characters = 3;
    var t4r = g5.add("group");
    t4r.add("statictext", undefined, "Свечение"); var ddGlow = t4r.add("dropdownlist", undefined, lNames); ddGlow.selection = +pref("glow", "0");
    t4r.add("statictext", undefined, "Блик"); var ddSweep = t4r.add("dropdownlist", undefined, lNames); ddSweep.selection = +pref("sweep", "0");
    var cHeroUp = t4r.add("checkbox", undefined, "КАПСОМ"); cHeroUp.value = pref("heroUp", "1") === "1";
    var cHeroFly = t4r.add("checkbox", undefined, "Влёт 160%"); cHeroFly.value = pref("heroFly", "1") === "1";
    g5.add("statictext", undefined, "Крупное = акцент *…* или самое длинное. Разные шрифты в фразе — AE 2024+.");

    var g6 = sett.add("panel", undefined, "Звук"); g6.alignChildren = ["left", "top"]; g6.spacing = 4;
    var SFX_PH = [["none", "без звука"], ["all", "каждая"], ["pause", "после паузы"], ["half", "каждая 2-я"]];
    var sfNames = []; for (si = 0; si < SFX_PH.length; si++) sfNames.push(SFX_PH[si][1]);
    var u1 = g6.add("group"); u1.add("statictext", undefined, "Фразы: whoosh");
    var ddSfx = u1.add("dropdownlist", undefined, sfNames); ddSfx.selection = Math.min(+pref("sfxPh", "0"), SFX_PH.length - 1);
    var cSfxHit = u1.add("checkbox", undefined, "Удар на акцентах"); cSfxHit.value = pref("sfxHit", "0") === "1";
    u1.add("statictext", undefined, "дБ"); var eSfxDb = u1.add("edittext", undefined, pref("sfxDb", "-10")); eSfxDb.characters = 3;
    var u2 = g6.add("group"); u2.add("statictext", undefined, "Папка");
    var eSfxDir = u2.add("edittext", undefined, pref("sfxDir", scriptDir.fsName + "/CaptionAE_sounds")); eSfxDir.characters = 26;
    var bSfxDir = u2.add("button", undefined, "…"); bSfxDir.preferredSize = [28, -1];
    eSfxDir.helpTip = "В папке — подпапки whoosh и hit с файлами WAV/MP3. Варианты чередуются, чтобы звук не повторялся.";
    bSfxDir.onClick = function () { var f = Folder.selectDialog("Папка звуков (с подпапками whoosh и hit)"); if (f) eSfxDir.text = f.fsName; };

    function updMix() { showCtl(gm, ddStyle.selection.index === 0 || ddExit.selection.index === 0); relayout(); }
    ddStyle.onChange = updMix; ddExit.onChange = updMix;
    var setOpen = pref("setOpen", "0") === "1";
    function updSet() { showCtl(sett, setOpen); bSet.text = setOpen ? "Настройки ▾" : "Настройки ▸"; relayout(); }
    bSet.onClick = function () { setOpen = !setOpen; setPref("setOpen", setOpen ? 1 : 0); updSet(); };
    showCtl(gm, ddStyle.selection.index === 0 || ddExit.selection.index === 0); showCtl(sett, setOpen);
    bSet.text = setOpen ? "Настройки ▾" : "Настройки ▸";

    // presets fill the controls; anything can still be changed by hand afterwards
    function applyPreset(k) {
        var P = [null, {
            style: "soft", exit: "soft", font: "PlayfairDisplay-Regular", size: 74, kara: false, upper: false, stroke: false, shadow: true,
            hotHit: false, acc: "FFFFFF", typo: "accent", font2: "PlayfairDisplay-Black", big: 200, small: 100, glow: 0, sweep: 0, heroUp: true, heroFly: true,
            noPunct: false, sfx: "none", sfxHit: false
        }, {
            style: "pop", exit: "fade", font: "Montserrat-ExtraBold", size: 80, kara: true, upper: true, stroke: true, shadow: true,
            hotHit: true, acc: "FFFFFF", typo: "plain", font2: "PlayfairDisplay-Black", big: 160, small: 100, glow: 0, sweep: 0, heroUp: true, heroFly: false,
            noPunct: true, sfx: "half", sfxHit: true
        }, {
            // Devin Jatho: white bold caps at Y≈1450 with a soft shadow (no hard outline), phrase pops, accent word red, punch-in on accents
            style: "jpop", exit: "fade", font: "Montserrat-ExtraBold", size: 92, kara: false, upper: true, stroke: false, shadow: true,
            hotHit: false, acc: "E51926", typo: "plain", font2: "PlayfairDisplay-Black", big: 160, small: 100, glow: 0, sweep: 0, heroUp: true, heroFly: false,
            display: "whole", posY: 75, words: 3, zoom: true, accS: 100, noPunct: true, sfx: "pause", sfxHit: true
        }, {
            // plain captions: no reveal, no exit, no karaoke, no accents growing — just the text and the soft shadow
            style: "none", exit: "none", font: "Montserrat-ExtraBold", size: 72, kara: false, upper: false, stroke: false, shadow: true,
            hotHit: false, acc: "FFFFFF", typo: "plain", font2: "PlayfairDisplay-Black", big: 160, small: 100, glow: 0, sweep: 0, heroUp: false, heroFly: false,
            display: "whole", posY: 75, words: 4, zoom: false, accS: 100, noPunct: false, sfx: "none", sfxHit: false
        }][k];
        if (!P) return;
        ddStyle.selection = find(STYLE_KEYS, P.style); ddExit.selection = find(EXIT_KEYS, P.exit);
        eFont.text = P.font; eSize.text = P.size; cKara.value = P.kara; cUpper.value = P.upper; cStroke.value = P.stroke;
        cShadow.value = P.shadow; cHotHit.value = P.hotHit; eAcc.text = P.acc; eHl.text = "F7D640"; eTxt.text = "FFFFFF";
        for (var i = 0; i < TYPO.length; i++) if (TYPO[i][0] === P.typo) ddTypo.selection = i;
        eFont2.text = P.font2; eBig.text = P.big; eSmall.text = P.small; ddGlow.selection = P.glow; ddSweep.selection = P.sweep;
        cHeroUp.value = P.heroUp; cHeroFly.value = P.heroFly; cMblur.value = true; cZoom.value = !!P.zoom;
        cNoPunct.value = !!P.noPunct; cKeepQE.value = true; updPunct();
        for (i = 0; i < SFX_PH.length; i++) if (SFX_PH[i][0] === P.sfx) ddSfx.selection = i;
        cSfxHit.value = P.sfxHit;
        ePos.text = P.posY || 72; eWords.text = P.words || 3; eAccS.text = P.accS || 112;
        for (i = 0; i < DISPLAY.length; i++) if (DISPLAY[i][0] === (P.display || "flow")) ddDisplay.selection = i;
        updMix();
    }
    ddPreset.onChange = function () { if (ddPreset.selection) applyPreset(ddPreset.selection.index); };
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
    s3.add("statictext", undefined, "Зум, %"); var eShZoom = s3.add("edittext", undefined, pref("shZoom", "3")); eShZoom.characters = 4;
    ddPow.onChange = function () {
        if (!ddPow.selection) return;
        var w = POWER[ddPow.selection.index]; ePx.text = w[1]; eRot.text = w[2]; eShZoom.text = w[3];
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
            freq: +eFreq.text || 14, px: +ePx.text || 0, rot: +eRot.text || 0, zoom: +eShZoom.text || 0,
            sharp: Math.max(1, Math.min(4, +eSharp.text || 2)), blur: cShBlur.value, keepSubs: cKeepSubs.value };
        var keep = { shKind: ddShake.selection.index, shTarget: ddTarget.selection.index, shRh: ddRh.selection ? ddRh.selection.index : 2, shPow: ddPow.selection ? ddPow.selection.index : 1,
            shFreq: eFreq.text, shPx: ePx.text, shRot: eRot.text, shZoom: eShZoom.text, shDur: eDur.text, shSharp: eSharp.text,
            shBlur: cShBlur.value ? 1 : 0, shKeep: cKeepSubs.value ? 1 : 0 };
        for (var k in keep) setPref(k, keep[k]);
        app.beginUndoGroup("Caption AE: тряска");
        try {
            var when = " с " + fmtTime(o.t0) + " на " + o.dur + " с — проиграйте этот участок" + (o.kind === "rise" ? " (на первом кадре она ещё нулевая)." : ".");
            if (ddTarget.selection.index === 0) { shakeFrame(comp, o); status.text = "Тряска на весь кадр (слой SHAKE)" + when; }
            else {
                var sel = comp.selectedLayers, i;
                if (!sel.length) { alert("Выделите слои."); }
                for (i = 0; i < sel.length; i++) addShake(comp, sel[i], o);
                if (sel.length) status.text = "Тряска: " + plural(sel.length, ["слой", "слоя", "слоёв"]) + when;
            }
        } catch (e) { fail("Не удалось добавить тряску.", e); }
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
            status.text = "Акцент добавлен: " + plural(sel.length, ["слой", "слоя", "слоёв"]) + ".";
        } catch (e) { fail("Не удалось добавить акцент.", e); }
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
        } catch (e) { fail("Не удалось добавить заголовок.", e); }
        app.endUndoGroup();
    };

    function eachSelected(name, fn) {
        var comp = activeComp(); if (!comp) return;
        var sel = comp.selectedLayers, i;
        if (!sel.length) { alert("Выделите слои."); return; }
        app.beginUndoGroup("Caption AE: " + name);
        try { for (i = 0; i < sel.length; i++) fn(comp, sel[i]); status.text = "Добавлено (" + name + "): " + plural(sel.length, ["слой", "слоя", "слоёв"]) + "."; }
        catch (e) { fail("Не удалось добавить " + name + ".", e); }
        app.endUndoGroup();
    }
    bGlow.onClick = function () { eachSelected("свечение", function (c, L) { addGlow(L, +eSize.text || 90); }); };
    bSweep.onClick = function () { eachSelected("блик", function (c, L) { addSweep(L, c.time, 0.6 * Math.max(0.2, +eHDur.text || 1)); }); };

    // ---------- plain captions: a separate tool, no animation; words per caption and duration are the controls ----------
    var gp = tPlain.add("panel", undefined, "Простые субтитры — без анимации"); gp.alignChildren = ["left", "top"];
    var p0 = gp.add("group");
    var bPTrans = p0.add("button", undefined, "Распознать речь слоя");
    var bPImp = p0.add("button", undefined, "Импорт SRT / JSON");
    var bPDict = p0.add("button", undefined, "Словарь…"); bPDict.helpTip = bDict.helpTip;
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
    var p6b = gp.add("group");
    var cPNoP = p6b.add("checkbox", undefined, "Без знаков препинания"); cPNoP.value = pref("pNoPunct", "0") === "1";
    var cPQE = p6b.add("checkbox", undefined, "Оставить ? и !"); cPQE.value = pref("pKeepQE", "1") === "1";
    cPNoP.helpTip = cNoPunct.helpTip;
    function updPPunct() { cPQE.enabled = cPNoP.value; }
    cPNoP.onClick = updPPunct; updPPunct();
    var p7 = gp.add("group");
    var bPBuild = p7.add("button", undefined, "Создать субтитры");
    var bPDel = p7.add("button", undefined, "Удалить субтитры");
    var bPSrt = p7.add("button", undefined, "Экспорт SRT");
    gp.add("statictext", undefined, "Фиксированная длительность обрывается раньше, если следующие слова уже звучат.\n«Создать» заменяет прежние субтитры Caption AE (вернуть — Ctrl+Z).", { multiline: true });

    function plainInfo() { pInfo.text = words.length ? "Текст: " + words.length + " слов, " + fmtTime(words[words.length - 1].end) : "Текст: ещё не загружен"; }
    bPTrans.onClick = function () { bTrans.onClick(); plainInfo(); };
    bPImp.onClick = function () { bImport.onClick(); plainInfo(); };
    bPDel.onClick = function () { bRemove.onClick(); };
    bPDict.onClick = function () { openDict(); };
    // plain captions as set on the tab: the phrases and the options for buildSubs / srtText
    function plainSetup() {
        var per = ddPN.selection.index + 1, lines = ddPL.selection.index + 1, n = per * lines, fixed = ddPDur.selection.index === 1;
        var keep = { pN: ddPN.selection.index, pLines: ddPL.selection.index, pLead: ePLead.text, pBreak: cPBreak.value ? 1 : 0, pDurMode: ddPDur.selection.index, pDur: ePDur.text, pHold: ePHold.text,
            pFont: ePFont.text, pSize: ePSize.text, pY: ePY.text, pCol: ePCol.text, pUp: cPUp.value ? 1 : 0, pSh: cPSh.value ? 1 : 0,
            pNoPunct: cPNoP.value ? 1 : 0, pKeepQE: cPQE.value ? 1 : 0 };
        for (var k in keep) setPref(k, keep[k]);
        var ph = groupPhrases(words, n, 999, cPBreak.value ? 0.4 : 1e9, !cPBreak.value);
        var col = hex(ePCol.text.replace("#", ""));
        return { ph: ph, col: col, fixed: fixed, opt: { en: {}, smart: false, style: "none", exit: "none", mblur: false, font: ePFont.text, size: +ePSize.text || 72,
            posY: (+ePY.text || 75) / 100, maxChars: 999, lineWords: lines === 2 ? per : 0, leadingPct: Math.max(50, +ePLead.text || 110), hold: Math.max(0, +ePHold.text || 0), fixedDur: fixed ? Math.max(0.2, +ePDur.text || 1.5) : 0,
            text: col, hl: col, accent: col, karaoke: false, upper: cPUp.value, stroke: false, shadow: cPSh.value, hotHit: false, typo: "plain",
            glow: "none", sweep: "none", display: "whole", accentScale: 100, heroUpper: false, heroFly: false,
            noPunct: cPNoP.value, keepQE: cPQE.value } };
    }
    bPSrt.onClick = function () {
        if (!words.length) { alert("Сначала распознайте речь или импортируйте субтитры."); return; }
        var P = plainSetup(); saveSrt(P.ph, P.opt);
    };
    bPBuild.onClick = function () {
        var comp = activeComp(); if (!comp) return;
        if (!words.length) { alert("Сначала распознайте речь или импортируйте субтитры."); return; }
        var P = plainSetup(), ph = P.ph, col = P.col, fixed = P.fixed, opt = P.opt;
        app.beginUndoGroup("Caption AE: простые субтитры");
        try {
            var old = removeSubs(comp);
            var made = buildSubs(comp, ph, opt, offset);
            status.text = "Готово: " + plural(made, ["субтитр", "субтитра", "субтитров"]) + (fixed ? ", по " + opt.fixedDur + " с" : ", по речи") + "." +
                (old ? " Прежние заменены — вернуть: Ctrl+Z." : "");
        } catch (e) { fail("Не удалось создать субтитры.", e); }
        app.endUndoGroup();
    };

    var status = win.add("statictext", undefined, "Выделите слой с голосом и нажмите «Распознать речь слоя» или импортируйте SRT.", { multiline: true });
    status.alignment = ["fill", "bottom"]; status.preferredSize.height = 32; // two lines: long messages wrap instead of being cut

    // ---------- dictionary, SRT, sounds ----------
    function dictText() { return String(pref("dict", "# пример:¶# зелим хан = Зелимхан")).replace(/¶/g, "\n"); }
    // fix freshly recognised / imported words; returns the number of places fixed
    function fixWords() {
        var rules = parseDict(dictText()); if (!rules.length) return 0;
        var r = applyDict(words, rules); words = r.words; return r.n;
    }
    function openDict() {
        var d = new Window("dialog", "Словарь замен"); d.alignChildren = ["fill", "top"];
        d.add("statictext", undefined, "Одна замена в строке: как распознало = как надо. Регистр и ё не важны.\n" +
            "Несколько слов слева склеиваются в одно: зелим хан = Зелимхан. Строки с # — заметки.", { multiline: true });
        var e = d.add("edittext", undefined, dictText(), { multiline: true, scrolling: true }); e.preferredSize = [400, 200];
        var r = d.add("group"); r.alignment = ["right", "top"];
        var bOk = r.add("button", undefined, "Сохранить и исправить"), bNo = r.add("button", undefined, "Отмена");
        bOk.onClick = function () { d.close(1); }; bNo.onClick = function () { d.close(2); };
        if (d.show() !== 1) return;
        setPref("dict", e.text.replace(/\r\n|\r|\n/g, "¶"));
        var rules = parseDict(e.text), nW = 0, nT = 0;
        if (!rules.length) { status.text = "Словарь пуст — в каждой строке нужно «было = стало»."; return; }
        if (words.length) { var rw = applyDict(words, rules); words = rw.words; nW = rw.n; }
        if (trim(editor.text)) { var rt = applyDictText(editor.text, rules); editor.text = rt.text; nT = rt.n; }
        plainInfo();
        status.text = "Словарь сохранён: " + plural(rules.length, ["замена", "замены", "замен"]) + ". Исправлено мест в тексте: " +
            Math.max(nW, nT) + ". Новые тексты исправляются сами.";
    }
    bDict.onClick = openDict;

    function saveSrt(ph, o) {
        var txt = srtText(ph, offset, { hold: o.hold, fixedDur: o.fixedDur, noPunct: o.noPunct, keepQE: o.keepQE, lineWords: o.lineWords });
        if (!txt) { alert("Нет фраз для экспорта."); return; }
        var name = (srcName || "subtitles").replace(/\.[^.]+$/, "") + ".srt";
        var f = new File(Folder.desktop.fsName + "/" + name).saveDlg("Сохранить субтитры SRT", $.os.indexOf("Windows") >= 0 ? "SRT:*.srt" : undefined);
        if (!f) return;
        if (!/\.srt$/i.test(f.name)) f = new File(f.fsName + ".srt");
        f.encoding = "UTF-8"; f.lineFeed = "Windows"; // CRLF: what YouTube, Premiere and players expect
        if (!f.open("w")) { alert("Не удалось записать файл:\n" + f.fsName + "\nВыберите другую папку."); return; }
        f.write(txt); f.close();
        status.text = "SRT сохранён: " + f.name + " — " + plural(txt.split(" --> ").length - 1, ["субтитр", "субтитра", "субтитров"]) + ".";
    }
    bSrt.onClick = function () {
        if (!words.length || !trim(editor.text)) { alert("Сначала распознайте речь или импортируйте субтитры."); return; }
        saveSrt(textToPhrases(editor.text, words), { hold: 0.4, noPunct: cNoPunct.value, keepQE: cKeepQE.value });
    };

    var WHOOSH_LEAD = 0.18; // the bundled whooshes peak 0.18 s in (sounds/make_sounds.py): the peak lands on the phrase
    function soundFiles(dir) {
        var f = Folder(dir), a;
        if (!f.exists) return [];
        a = f.getFiles(function (x) { return x instanceof File && /\.(wav|mp3|aiff?|m4a)$/i.test(x.name); });
        a.sort(function (x, y) { return x.name < y.name ? -1 : 1; });
        return a;
    }
    function importOnce(file) {
        var i, it, bin = null;
        for (i = 1; i <= app.project.numItems; i++) {
            it = app.project.item(i);
            if (it instanceof FootageItem && it.file && it.file.fsName === file.fsName) return it;
            if (it instanceof FolderItem && it.name === "Caption AE — звуки") bin = it;
        }
        it = app.project.importFile(new ImportOptions(file));
        it.parentFolder = bin || app.project.items.addFolder("Caption AE — звуки");
        return it;
    }
    // sound layers sit under everything, tagged like the captions: «Удалить» and a rebuild replace them too
    function addSfx(comp, plan, F, db) {
        var used = { whoosh: 0, hit: 0 }, made = 0, i;
        for (i = 0; i < plan.length; i++) {
            var list = F[plan[i].kind]; if (!list.length) continue;
            var L = comp.layers.add(importOnce(list[used[plan[i].kind]++ % list.length])); // variants take turns
            L.startTime = plan[i].t - (plan[i].kind === "whoosh" ? WHOOSH_LEAD : 0);
            L.name = "SFX " + plan[i].kind; L.comment = TAG;
            L.property("ADBE Audio Group").property("ADBE Audio Levels").setValue([db, db]);
            L.moveToEnd(); made++;
        }
        return made;
    }

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
        if (!L || !L.source || !L.source.file) {
            alert("Выделите в композиции слой с аудио/видео файлом.\nЕсли это вложенная композиция — откройте её и выделите исходный видео- или аудиослой."); return;
        }
        if (L.source.footageMissing || !L.source.file.exists) {
            alert("Файл этого слоя не найден:\n" + L.source.file.fsName + "\nПереподключите его (File → Replace Footage) или выделите другой слой."); return;
        }
        if (!canRunCommands()) return;
        var py = File(scriptDir.fsName + "/transcribe.py");
        if (!py.exists) { alert("Рядом со скриптом нет transcribe.py:\n" + py.fsName); return; }
        var out = File(Folder.temp.fsName + "/captionae_words.json"); if (out.exists) out.remove();
        setPref("python", ePy.text); setPref("model", ddModel.selection.text);
        status.text = "Распознаю… (AE подвиснет на время распознавания)"; win.update && win.update();
        var q = function (s) { return '"' + s + '"'; };
        // file paths go as hex of their UTF-8 bytes: Windows' command line mangles non-Latin names ("A:\монтаж\...")
        var log = system.callSystem(q(ePy.text) + " " + q(py.fsName) + " hex:" + hexUtf8(L.source.file.fsName) + " hex:" + hexUtf8(out.fsName) +
            " " + ddLang.selection.text + " " + ddModel.selection.text);
        if (!out.exists) {
            alert(whyFailed(String(log)) + "\n\nПодробности (конец журнала):\n" + String(log).slice(-700));
            status.text = "Распознавание не удалось — см. сообщение."; return;
        }
        words = parseJSONWords(readFile(out));
        offset = L.startTime; // word times are from the file start; the layer may be shifted in the comp
        srcLayerName = srcName = L.name;
        var fx = fixWords();
        regroup();
        if (fx) status.text += " Словарь исправил: " + fx + ".";
    };

    bImport.onClick = function () {
        var f = File.openDialog("Файл субтитров", "Субтитры:*.srt;*.json,All:*.*");
        if (!f) return;
        var s = readFile(f);
        try { words = /\.json$/i.test(f.name) ? parseJSONWords(s) : parseSRT(s); }
        catch (e) { alert("Не удалось прочитать файл. Нужен SRT или JSON со словами (как из transcribe.py).\n\nПодробности: " + e); return; }
        offset = 0; srcName = f.name; srcLayerName = "";
        var fx = fixWords();
        regroup();
        if (fx) status.text += " Словарь исправил: " + fx + ".";
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
            text: hex(eTxt.text.replace("#", "")), hl: hex(eHl.text.replace("#", "")), accent: hex(eAcc.text.replace("#", "")),
            karaoke: cKara.value, upper: cUpper.value, stroke: cStroke.value, shadow: cShadow.value,
            noPunct: cNoPunct.value, keepQE: cKeepQE.value,
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
            posY: ePos.text, hl: eHl.text, acc: eAcc.text, txt: eTxt.text, kara: cKara.value ? 1 : 0, upper: cUpper.value ? 1 : 0,
            stroke: cStroke.value ? 1 : 0, shadow: cShadow.value ? 1 : 0, noPunct: cNoPunct.value ? 1 : 0, keepQE: cKeepQE.value ? 1 : 0,
            zoom: cZoom.value ? 1 : 0, zoomAmt: eZoom.text, accS: eAccS.text, zoomKind: ddZoomKind.selection.index,
            sfxPh: ddSfx.selection.index, sfxHit: cSfxHit.value ? 1 : 0, sfxDb: eSfxDb.text, sfxDir: eSfxDir.text };
        for (var k in keep) setPref(k, keep[k]);
        var ph = textToPhrases(editor.text, words);
        var plan = sfxPlan(ph, offset, SFX_PH[ddSfx.selection.index][0], cSfxHit.value);
        var SF = { whoosh: [], hit: [] };
        if (plan.length) {
            SF = { whoosh: soundFiles(eSfxDir.text + "/whoosh"), hit: soundFiles(eSfxDir.text + "/hit") };
            if (!SF.whoosh.length && !SF.hit.length) {
                alert("В папке звуков нет файлов:\n" + eSfxDir.text + "\nНужны подпапки whoosh и hit с WAV/MP3 (папка CaptionAE_sounds из архива).\n" +
                    "Укажите её в «Настройки ▸» → «Звук» или выключите звук."); return;
            }
        }
        app.beginUndoGroup("Caption AE: создать");
        try {
            var old = removeSubs(comp);
            var n = buildSubs(comp, ph, opt, offset);
            var ns = plan.length ? addSfx(comp, plan, SF, +eSfxDb.text || -10) : 0;
            status.text = opt.note || ("Готово: " + plural(n, ["фраза", "фразы", "фраз"]) + (ns ? ", " + plural(ns, ["звук", "звука", "звуков"]) : "") +
                ". Цвет — как у обычного текста (Character); общий размер и высота — слой " + CTRL + "." + (old ? " Прежние заменены — вернуть: Ctrl+Z." : ""));
        } catch (e) { fail("Не удалось создать субтитры.", e); }
        app.endUndoGroup();
    };

    bRecolor.onClick = function () {
        var comp = activeComp(); if (!comp) return;
        setPref("txt", eTxt.text); setPref("hl", eHl.text); setPref("acc", eAcc.text);
        app.beginUndoGroup("Caption AE: перекрасить");
        try {
            var n = recolorSubs(comp, { text: hex(eTxt.text.replace("#", "")), hl: hex(eHl.text.replace("#", "")), accent: hex(eAcc.text.replace("#", "")), karaoke: cKara.value });
            status.text = n ? "Перекрашено: " + plural(n, ["фраза", "фразы", "фраз"]) + ". Вернуть: Ctrl+Z." : "В этой композиции нет субтитров Caption AE.";
        } catch (e) { fail("Не удалось перекрасить субтитры.", e); }
        app.endUndoGroup();
    };

    bRemove.onClick = function () {
        var comp = activeComp(); if (!comp) return;
        app.beginUndoGroup("Caption AE: удалить"); var n = removeSubs(comp); app.endUndoGroup();
        status.text = n ? "Субтитры удалены. Вернуть: Ctrl+Z." : "В этой композиции нет субтитров Caption AE.";
    };

    win.onResizing = win.onResize = function () { this.layout.resize(); };
    if (win instanceof Window) { win.center(); win.show(); } else { win.layout.layout(true); }
})(this);
