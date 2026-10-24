// Minimal stand-in for the After Effects scripting DOM, enough to run CaptionAE.jsx's build functions in Node.
// It records what the script creates (layers, properties, values, keyframes, expressions) so render.js can play it back.
"use strict";

class Prop {
    constructor(matchName, parent) {
        this.matchName = matchName; this.name = matchName; this.parent = parent;
        this.children = []; this.val = undefined; this.expression = ""; this.keys = [];
    }
    property(k) {
        if (typeof k === "number") {
            while (this.children.length < k) this._add("#" + (this.children.length + 1));
            return this.children[k - 1];
        }
        for (const c of this.children) if (c.matchName === k || c.name === k) return c;
        return this._add(k);
    }
    _add(m) { const c = new Prop(m, this); this.children.push(c); return c; }
    addProperty(m) { return this._add(m); }
    get numProperties() { return this.children.length; }
    setValue(v) { this.val = v; }
    get value() { return this.val; }
    setValueAtTime(t, v) { this.keys.push([t, v]); this.keys.sort((a, b) => a[0] - b[0]); }
    get numKeys() { return this.keys.length; }
    keyTime(i) { return this.keys[i - 1][0]; }
    keyValue(i) { return this.keys[i - 1][1]; }
    setInterpolationTypeAtKey() {}
    remove() { const s = this.parent.children; s.splice(s.indexOf(this), 1); }
    // value at time t: keyframes interpolate linearly (AE's default for sliders)
    valueAt(t) {
        const k = this.keys;
        if (!k.length) return this.val;
        if (t <= k[0][0]) return k[0][1];
        if (t >= k[k.length - 1][0]) return k[k.length - 1][1];
        for (let i = 0; i < k.length - 1; i++) if (t < k[i + 1][0]) {
            const u = (t - k[i][0]) / (k[i + 1][0] - k[i][0]);
            return k[i][1] + (k[i + 1][1] - k[i][1]) * u;
        }
    }
}

class TextDocument {
    constructor(text) { this.text = text; this.ranges = []; }
    resetCharStyle() {}
    resetParagraphStyle() {}
    characterRange(a, b) { const r = { start: a, end: b }; this.ranges.push(r); return r; }
}

let LAYER_ID = 0;
class Layer {
    constructor(comp, kind, name) {
        this.id = ++LAYER_ID; this.containingComp = comp; this.kind = kind; this.name = name; this.comment = "";
        this.startTime = 0; this.inPoint = 0; this.outPoint = comp.duration;
        this.enabled = true; this.motionBlur = false; this.adjustmentLayer = false; this.label = 0;
        this.root = new Prop("root", null);
        const tr = this.root.property("ADBE Transform Group");
        tr.property("ADBE Anchor Point").setValue([0, 0]);
        tr.property("ADBE Position").setValue([comp.width / 2, comp.height / 2]);
        tr.property("ADBE Scale").setValue([100, 100]);
        tr.property("ADBE Rotate Z").setValue(0);
        tr.property("ADBE Opacity").setValue(100);
    }
    property(k) { return this.root.property(k); }
    get index() { return this.containingComp.layerList.indexOf(this) + 1; }
    moveToBeginning() { const L = this.containingComp.layerList; L.splice(L.indexOf(this), 1); L.unshift(this); }
    moveBefore(x) { const L = this.containingComp.layerList; L.splice(L.indexOf(this), 1); L.splice(L.indexOf(x), 0, this); }
    remove() { const L = this.containingComp.layerList; L.splice(L.indexOf(this), 1); }
}

class CompItem {
    constructor(w, h, duration, fps) {
        this.width = w; this.height = h; this.duration = duration; this.frameDuration = 1 / fps; this.pixelAspect = 1;
        this.time = 0; this.motionBlur = false; this.layerList = [];
        const comp = this;
        this.layers = {
            addText(text) {
                const L = new Layer(comp, "text", text);
                L.property("ADBE Text Properties").property("ADBE Text Document").setValue(new TextDocument(text));
                comp.layerList.unshift(L); return L;
            },
            addSolid(color, name, w, h) { const L = new Layer(comp, "solid", name); L.color = color; comp.layerList.unshift(L); return L; },
            addNull() { const L = new Layer(comp, "null", "Null"); comp.layerList.unshift(L); return L; }
        };
    }
    get numLayers() { return this.layerList.length; }
    layer(i) { return typeof i === "number" ? this.layerList[i - 1] : this.layerList.find(l => l.name === i); }
}

function install(globalObj) {
    globalObj.CompItem = CompItem;
    globalObj.ParagraphJustification = { CENTER_JUSTIFY: "center" };
    globalObj.KeyframeInterpolationType = { LINEAR: 1, HOLD: 2, BEZIER: 3 };
    globalObj.app = { effects: [{ displayName: "Glow", matchName: "ADBE Glo2" }, { displayName: "CC Light Sweep", matchName: "CC Light Sweep" }] };
}

module.exports = { Prop, TextDocument, Layer, CompItem, install };
