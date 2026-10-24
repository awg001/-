// AutoSubs — animated subtitles for After Effects (ExtendScript, AE 2020+).
// Run: File > Scripts > Run Script File…, or copy into "Scripts/ScriptUI Panels" to get a dockable panel (Window > AutoSubs.jsx).
// Text source: local Whisper (transcribe.py next to this file), an SRT (e.g. Premiere's Speech to Text export),
// or a words JSON [{w,start,end}] (montage/tools/align.py). Every phrase becomes a text layer animated by expression
// selectors, so editing Source Text later keeps the animation; global look lives on the SUBS_CTRL null.
(function (thisObj) {
    var CTRL = "SUBS_CTRL", TAG = "autosubs";

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
            if (txt) out.push({ w: txt, start: +w.start, end: +w.end });
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

    // Split words into on-screen phrases: by word/char limits, pauses and sentence ends
    function groupPhrases(words, maxWords, maxChars, gap) {
        var ph = [], cur = [], len = 0, i, w;
        for (i = 0; i < words.length; i++) {
            w = words[i];
            if (cur.length) {
                var prev = cur[cur.length - 1];
                var brk = cur.length >= maxWords || len + 1 + w.w.length > maxChars || w.start - prev.end > gap ||
                    /[.!?…]$/.test(prev.w) || (/[,;:—]$/.test(prev.w) && cur.length >= 2);
                if (brk) {
                    // a dangling preposition ("в", "из", "и") goes to the next line with its word
                    var tail = cur.length >= 2 && prev.w.length <= 2 && !/[.,!?…;:—]$/.test(prev.w) ? cur.pop() : null;
                    ph.push(cur); cur = []; len = 0;
                    if (tail) { cur.push(tail); len = tail.w.length; }
                }
            }
            cur.push(w); len += (len ? 1 : 0) + w.w.length;
        }
        if (cur.length) ph.push(cur);
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
            for (j = 0; j < ph[i].length; j++) ws.push(ph[i][j].w);
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
        glitch:{ name: "Глитч (акцент)",            per: false, dur: 0.30, ease: 5, scale: 100, opacity: 0, pos: [90, 0], blur: 6, stagger: 0.03 }
    };
    var STYLE_KEYS = ["mix", "pop", "slide", "blur", "cut", "rise", "flick", "punch", "glitch"];
    var MIX = ["pop", "slide", "blur", "cut", "rise", "flick"];
    var HOT = ["punch", "glitch"];

    // Exits run over the last D seconds of a phrase. by: 1 = letters, 3 = words.
    var EXITS = {
        fade:    { name: "Быстрое затухание" },
        shatter: { name: "Распад на буквы",  by: 1, D: 0.40 },
        up:      { name: "Вылет вверх",      by: 3, D: 0.30, ease: 0, props: { "ADBE Text Position 3D": [0, -90, 0], "ADBE Text Opacity": 0, "ADBE Text Blur": [12, 12] } },
        blurout: { name: "Уход в размытие",  by: 3, D: 0.30, ease: 0, props: { "ADBE Text Scale 3D": [118, 118, 100], "ADBE Text Opacity": 0, "ADBE Text Blur": [30, 30] } },
        flick:   { name: "Мерцание",         by: 3, D: 0.30, ease: 1, props: { "ADBE Text Opacity": 0 } }
    };
    var EXIT_KEYS = ["mix", "fade", "shatter", "up", "blurout", "flick"];
    var EXIT_MIX = ["up", "blurout", "flick", "fade"];

    // Mix: rotate through calm styles without repeats; lines with an accent word or "!" get the punch
    function pickStyles(ph, mode) {
        var res = [], last = "", i, j, seed = 7, nhot = 0;
        for (i = 0; i < ph.length; i++) {
            if (mode !== "mix") { res.push(mode); continue; }
            var hot = /!$/.test(ph[i][ph[i].length - 1].w);
            for (j = 0; j < ph[i].length; j++) if (ph[i][j].accent) hot = true;
            var s;
            if (hot) s = HOT[nhot++ % HOT.length];
            else {
                do { seed = (seed * 1103515245 + 12345) % 2147483648; s = MIX[seed % MIX.length]; } while (s === last);
            }
            res.push(s); last = s;
        }
        return res;
    }

    // Mix exits: accent lines break apart into letters, the rest rotate without repeats
    function pickExits(styles, mode) {
        var res = [], last = "", seed = 11, i, e;
        for (i = 0; i < styles.length; i++) {
            if (mode !== "mix") { res.push(mode); continue; }
            if (styles[i] === "punch" || styles[i] === "glitch") e = "shatter";
            else do { seed = (seed * 1103515245 + 12345) % 2147483648; e = EXIT_MIX[seed % EXIT_MIX.length]; } while (e === last);
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

    function buildSubs(comp, ph, opt, offset) {
        var ctrl = getCtrl(comp, opt), styles = pickStyles(ph, opt.style), exits = pickExits(styles, opt.exit);
        var C = 'thisComp.layer("' + CTRL + '")';
        if (opt.mblur) comp.motionBlur = true;
        var made = 0, i, j;
        for (i = 0; i < ph.length; i++) {
            var p = ph[i], st = STYLES[styles[i]], ws = [], T = [], A = [];
            var t0 = offset + p[0].start, last = offset + p[p.length - 1].end;
            var next = i + 1 < ph.length ? offset + ph[i + 1][0].start : comp.duration;
            var t1 = Math.min(next, last + opt.hold);
            if (next - last < 0.6) t1 = next; // close gap: no flicker between lines
            if (t1 - t0 < 0.2) t1 = t0 + 0.2;
            for (j = 0; j < p.length; j++) {
                ws.push(opt.upper ? p[j].w.toUpperCase() : p[j].w);
                T.push(st.per ? offset + p[j].start - t0 : j * st.stagger);
                A.push(p[j].accent);
            }
            var layer = comp.layers.addText(wrapLine(ws, opt.maxChars));
            layer.name = ws.join(" ").substring(0, 40); layer.comment = TAG;
            layer.startTime = 0; layer.inPoint = t0; layer.outPoint = Math.min(t1, comp.duration);

            var srcProp = layer.property("ADBE Text Properties").property("ADBE Text Document"), td = srcProp.value;
            td.resetCharStyle(); td.resetParagraphStyle();
            td.font = opt.font; td.fontSize = opt.size; td.fillColor = [1, 1, 1];
            td.applyStroke = opt.stroke; td.strokeColor = [0, 0, 0]; td.strokeWidth = Math.round(opt.size * 0.09);
            td.strokeOverFill = false; td.justification = ParagraphJustification.CENTER_JUSTIFY;
            srcProp.setValue(td);

            var more = layer.property("ADBE Text Properties").property("ADBE Text More Options");
            more.property("ADBE Text Anchor Point Option").setValue(2); // scale each word around its own center
            more.property("ADBE Text Anchor Point Align").setValue([0, -35]);

            addAnimator(layer, "Base color", { "ADBE Text Fill Color": C + '.effect("Text")(1)' }, null);
            addAnimator(layer, "Accent", { "ADBE Text Fill Color": C + '.effect("Accent")(1)', "ADBE Text Scale 3D": [118, 118, 100] }, accentExpr(A));
            addAnimator(layer, "Highlight", { "ADBE Text Fill Color": C + '.effect("Highlight")(1)', "ADBE Text Scale 3D": [108, 108, 100] }, highlightExpr(T));
            var rv = {};
            if (st.scale !== 100) rv["ADBE Text Scale 3D"] = [st.scale, st.scale, 100];
            if (st.pos[0] || st.pos[1]) rv["ADBE Text Position 3D"] = [st.pos[0], st.pos[1], 0];
            if (st.blur) rv["ADBE Text Blur"] = [st.blur, st.blur];
            rv["ADBE Text Opacity"] = st.opacity;
            addAnimator(layer, "Reveal " + styles[i], rv, revealExpr(T, st));

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

            var tr = layer.property("ADBE Transform Group");
            // center on the fully revealed line, measured before the exit starts scattering it
            tr.property("ADBE Anchor Point").expression = "var r=sourceRectAtTime(Math.max(inPoint,outPoint-" + D + "-thisComp.frameDuration),false);[r.left+r.width/2,r.top+r.height/2]";
            tr.property("ADBE Position").expression = "[thisComp.width/2,thisComp.height*" + opt.posY + "+" + C + '.effect("Y offset")(1)]';
            tr.property("ADBE Scale").expression = "var s=" + C + '.effect("Size %")(1);[s,s]';
            if (exits[i] === "fade") tr.property("ADBE Opacity").expression = "var f=3*thisComp.frameDuration;linear(time,outPoint-f,outPoint,100,0)";
            if (opt.shadow) {
                var sh = layer.property("ADBE Effect Parade").addProperty("ADBE Drop Shadow");
                sh.property("ADBE Drop Shadow-0004").setValue(Math.round(opt.size * 0.06));
                sh.property("ADBE Drop Shadow-0005").setValue(Math.round(opt.size * 0.25));
            }
            made++;
        }
        ctrl.moveToBeginning();
        return made;
    }

    function removeSubs(comp) {
        for (var i = comp.numLayers; i >= 1; i--) if (comp.layer(i).comment === TAG) comp.layer(i).remove();
    }

    var API = { trim: trim, parseJSONWords: parseJSONWords, parseSRT: parseSRT, groupPhrases: groupPhrases,
        phrasesToText: phrasesToText, textToPhrases: textToPhrases, pickStyles: pickStyles, revealExpr: revealExpr,
        highlightExpr: highlightExpr, accentExpr: accentExpr, wrapLine: wrapLine, STYLES: STYLES,
        pickExits: pickExits, shatterMoveExpr: shatterMoveExpr, shatterFadeExpr: shatterFadeExpr, wordExitExpr: wordExitExpr, EXITS: EXITS };
    if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }

    // ---------- UI ----------
    var SEC = "AutoSubs", words = [], offset = 0;
    var scriptDir = File($.fileName).parent;

    function pref(k, d) { return app.settings.haveSetting(SEC, k) ? app.settings.getSetting(SEC, k) : d; }
    function setPref(k, v) { app.settings.saveSetting(SEC, k, String(v)); }

    function readFile(f) { f.encoding = "UTF-8"; f.open("r"); var s = f.read(); f.close(); return s; }

    function defaultPython() {
        if ($.os.indexOf("Windows") >= 0) return "python";
        var c = ["/opt/homebrew/bin/python3", "/usr/local/bin/python3", "/usr/bin/python3"];
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

    var win = thisObj instanceof Panel ? thisObj : new Window("palette", "AutoSubs — субтитры", undefined, { resizeable: true });
    win.orientation = "column"; win.alignChildren = ["fill", "top"]; win.spacing = 6; win.margins = 10;

    var g1 = win.add("panel", undefined, "1. Текст"); g1.alignChildren = ["fill", "top"];
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

    var g2 = win.add("panel", undefined, "2. Разбивка"); g2.orientation = "row";
    g2.add("statictext", undefined, "Слов до");
    var eWords = g2.add("edittext", undefined, pref("maxWords", "3")); eWords.characters = 3;
    g2.add("statictext", undefined, "Букв до");
    var eChars = g2.add("edittext", undefined, pref("maxChars", "18")); eChars.characters = 3;
    var bRegroup = g2.add("button", undefined, "Разбить заново");

    var g3 = win.add("panel", undefined, "3. Стиль"); g3.alignChildren = ["fill", "top"];
    var names = ["Микс (разная анимация, акценты — удар/глитч)"];
    for (var si = 1; si < STYLE_KEYS.length; si++) names.push(STYLES[STYLE_KEYS[si]].name);
    var rS = g3.add("group"); rS.add("statictext", undefined, "Появление");
    var ddStyle = rS.add("dropdownlist", undefined, names); ddStyle.selection = Math.min(+pref("style", "0"), names.length - 1);
    var exNames = ["Микс (акценты — распад)"];
    for (si = 1; si < EXIT_KEYS.length; si++) exNames.push(EXITS[EXIT_KEYS[si]].name);
    var rE = g3.add("group"); rE.add("statictext", undefined, "Уход");
    var ddExit = rE.add("dropdownlist", undefined, exNames); ddExit.selection = Math.min(+pref("exit", "0"), exNames.length - 1);
    var r3 = g3.add("group");
    r3.add("statictext", undefined, "Шрифт (PostScript)");
    var eFont = r3.add("edittext", undefined, pref("font", "Montserrat-ExtraBold")); eFont.characters = 18;
    var r3b = g3.add("group");
    r3b.add("statictext", undefined, "Размер");
    var eSize = r3b.add("edittext", undefined, pref("size", "90")); eSize.characters = 4;
    r3b.add("statictext", undefined, "Высота, % кадра");
    var ePos = r3b.add("edittext", undefined, pref("posY", "72")); ePos.characters = 4;
    var r3c = g3.add("group");
    r3c.add("statictext", undefined, "Подсветка #");
    var eHl = r3c.add("edittext", undefined, pref("hl", "FFD400")); eHl.characters = 7;
    r3c.add("statictext", undefined, "Акцент #");
    var eAcc = r3c.add("edittext", undefined, pref("acc", "FF3B30")); eAcc.characters = 7;
    var r3d = g3.add("group");
    var cKara = r3d.add("checkbox", undefined, "Караоке-подсветка"); cKara.value = pref("kara", "1") === "1";
    var cUpper = r3d.add("checkbox", undefined, "КАПС"); cUpper.value = pref("upper", "0") === "1";
    var cStroke = r3d.add("checkbox", undefined, "Обводка"); cStroke.value = pref("stroke", "1") === "1";
    var cShadow = r3d.add("checkbox", undefined, "Тень"); cShadow.value = pref("shadow", "1") === "1";
    var cMblur = g3.add("checkbox", undefined, "Motion blur (плавнее движение, рендер дольше)"); cMblur.value = pref("mblur", "1") === "1";

    var r4 = win.add("group"); r4.alignment = ["fill", "top"];
    var bBuild = r4.add("button", undefined, "Создать субтитры");
    var bRemove = r4.add("button", undefined, "Удалить субтитры");
    var status = win.add("statictext", undefined, "Выберите слой с голосом и нажмите «Распознать», или импортируйте SRT.", { truncate: "end" });

    function regroup() {
        if (!words.length) return;
        editor.text = phrasesToText(groupPhrases(words, Math.max(1, +eWords.text || 3), Math.max(4, +eChars.text || 18), 0.4));
        status.text = words.length + " слов. Проверьте текст и нажмите «Создать субтитры».";
    }

    bTrans.onClick = function () {
        var comp = activeComp(); if (!comp) return;
        var L = comp.selectedLayers[0];
        if (!L || !L.source || !L.source.file) { alert("Выделите в композиции слой с аудио/видео файлом."); return; }
        if (!canRunCommands()) return;
        var py = File(scriptDir.fsName + "/transcribe.py");
        if (!py.exists) { alert("Рядом со скриптом нет transcribe.py:\n" + py.fsName); return; }
        var out = File(Folder.temp.fsName + "/autosubs_words.json"); if (out.exists) out.remove();
        setPref("python", ePy.text); setPref("model", ddModel.selection.text);
        status.text = "Распознаю… (AE подвиснет на время распознавания)"; win.update && win.update();
        var q = function (s) { return '"' + s + '"'; };
        var log = system.callSystem(q(ePy.text) + " " + q(py.fsName) + " " + q(L.source.file.fsName) + " " + q(out.fsName) +
            " " + ddLang.selection.text + " " + ddModel.selection.text);
        if (!out.exists) { alert("Распознавание не удалось:\n" + log); status.text = "Ошибка распознавания."; return; }
        words = parseJSONWords(readFile(out));
        offset = L.startTime; // word times are from the file start; the layer may be shifted in the comp
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

    bBuild.onClick = function () {
        var comp = activeComp(); if (!comp) return;
        if (!words.length || !trim(editor.text)) { alert("Сначала распознайте речь или импортируйте субтитры."); return; }
        var opt = {
            style: STYLE_KEYS[ddStyle.selection.index], exit: EXIT_KEYS[ddExit.selection.index], mblur: cMblur.value, font: eFont.text, size: +eSize.text || 90,
            posY: (+ePos.text || 72) / 100, maxChars: +eChars.text || 18, hold: 0.4,
            hl: hex(eHl.text.replace("#", "")), accent: hex(eAcc.text.replace("#", "")),
            karaoke: cKara.value, upper: cUpper.value, stroke: cStroke.value, shadow: cShadow.value
        };
        var keep = { maxWords: eWords.text, maxChars: eChars.text, style: ddStyle.selection.index, exit: ddExit.selection.index,
            mblur: cMblur.value ? 1 : 0, font: eFont.text, size: eSize.text,
            posY: ePos.text, hl: eHl.text, acc: eAcc.text, kara: cKara.value ? 1 : 0, upper: cUpper.value ? 1 : 0,
            stroke: cStroke.value ? 1 : 0, shadow: cShadow.value ? 1 : 0 };
        for (var k in keep) setPref(k, keep[k]);
        app.beginUndoGroup("AutoSubs: создать");
        try {
            removeSubs(comp);
            var n = buildSubs(comp, textToPhrases(editor.text, words), opt, offset);
            status.text = "Готово: " + n + " фраз. Общий вид — эффекты слоя " + CTRL + ".";
        } catch (e) { alert("Ошибка: " + e + " (строка " + e.line + ")"); }
        app.endUndoGroup();
    };

    bRemove.onClick = function () {
        var comp = activeComp(); if (!comp) return;
        app.beginUndoGroup("AutoSubs: удалить"); removeSubs(comp); app.endUndoGroup();
        status.text = "Субтитры удалены.";
    };

    win.onResizing = win.onResize = function () { this.layout.resize(); };
    if (win instanceof Window) { win.center(); win.show(); } else { win.layout.layout(true); }
})(this);
