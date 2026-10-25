// Minimal stand-in for the After Effects scripting DOM, enough to run CaptionAE.jsx's build functions in Node.
// It records what the script creates (layers, properties, values, keyframes, expressions) so render.js can play it back.
"use strict";

class Prop {
    constructor(matchName, parent) {
        this.matchName = matchName; this.name = matchName; this.parent = parent;
        this.children = []; this.val = undefined; this.expression = ""; this.keys = [];
        this.selectedKeys = []; this.canSetExpression = true; this.dimensionsSeparated = false; this.ease = {};
    }
    // a property with no members is a value; anything else a group (what clearBounce-style walks rely on)
    get propertyType() { return this.children.length ? 6214 : 6212; }
    get propertyDepth() { let d = 0, p = this; while (p.parent) { d++; p = p.parent; } return d; }
    propertyGroup(n) { let p = this; for (let i = 0; i < (n || 1); i++) p = p.parent; return p && !p.parent && p.layer ? p.layer : p; }
    property(k) {
        this._check();
        if (typeof k === "number") {
            while (this.children.length < k) this._add("#" + (this.children.length + 1));
            return this.children[k - 1];
        }
        for (const c of this.children) if (c.matchName === k || c.name === k) return c;
        return this._add(k);
    }
    _add(m) { const c = new Prop(m, this); this.children.push(c); return c; }
    // Like After Effects: adding a property to a group (an effect, an animator…) invalidates the references a script
    // already holds to that group's other members; looking them up again by name or index gives a valid object.
    addProperty(m) {
        this.children = this.children.map(c => { const n = Object.create(Prop.prototype); Object.assign(n, c); c._invalid = true; return n; });
        return this._add(m);
    }
    get numProperties() { return this.children.length; }
    setValue(v) { this._check(); this.val = v; }
    get value() { return this.val; }
    _check() { if (this._invalid) throw new Error("Object is invalid (reference held across addProperty)"); }
    setValueAtTime(t, v) { this._check(); this.keys.push([t, v]); this.keys.sort((a, b) => a[0] - b[0]); }
    get numKeys() { return this.keys.length; }
    keyTime(i) { return this.keys[i - 1][0]; }
    keyValue(i) { return this.keys[i - 1][1]; }
    setValueAtKey(k, v) { this._check(); this.keys[k - 1][1] = v; }
    valueAtTime(t) { return this.valueAt(t); }
    setInterpolationTypeAtKey(k, a, b) { this.ease[k] = Object.assign(this.ease[k] || {}, { inT: a, outT: b === undefined ? a : b }); }
    keyInInterpolationType(k) { return (this.ease[k] || {}).inT || 3; }
    keyOutInterpolationType(k) { return (this.ease[k] || {}).outT || 3; }
    _dims() { const v = this.keys.length ? this.keys[0][1] : this.val; return Array.isArray(v) && !/Position/.test(this.matchName) ? v.length : 1; }
    keyInTemporalEase(k) { return (this.ease[k] || {}).inE || Array.from({ length: this._dims() }, () => ({ speed: 0, influence: 33.3 })); }
    keyOutTemporalEase(k) { return (this.ease[k] || {}).outE || Array.from({ length: this._dims() }, () => ({ speed: 0, influence: 33.3 })); }
    setTemporalEaseAtKey(k, a, b) { // AE refuses an ease array of the wrong length
        if (a.length !== this._dims() || (b || a).length !== this._dims()) throw new Error("setTemporalEaseAtKey: wrong number of ease dimensions");
        this.ease[k] = Object.assign(this.ease[k] || {}, { inE: a, outE: b || a });
    }
    clone(parent) {
        const c = new Prop(this.matchName, parent); c.name = this.name; c.expression = this.expression;
        const cp = v => v instanceof TextDocument ? Object.assign(new TextDocument(v.text), v, { ranges: [] }) : Array.isArray(v) ? v.slice() : v;
        c.val = cp(this.val); c.keys = this.keys.map(k => [k[0], cp(k[1])]); c.children = this.children.map(x => x.clone(c));
        return c;
    }
    remove() { // removing also invalidates references to the other members of the group, as in AE
        this._check(); const g = this.parent; g.children.splice(g.children.indexOf(this), 1); this._invalid = true;
        g.children = g.children.map(c => { const n = Object.create(Prop.prototype); Object.assign(n, c); c._invalid = true; return n; });
    }
    // value at time t: keyframes interpolate linearly (AE's default for sliders)
    valueAt(t) {
        const k = this.keys;
        if (!k.length) return this.val;
        if (t <= k[0][0]) return k[0][1];
        if (t >= k[k.length - 1][0]) return k[k.length - 1][1];
        for (let i = 0; i < k.length - 1; i++) if (t < k[i + 1][0]) {
            const u = (t - k[i][0]) / (k[i + 1][0] - k[i][0]), a = k[i][1], b = k[i + 1][1];
            return Array.isArray(a) ? a.map((x, j) => x + (b[j] - x) * u) : a + (b - a) * u;
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
        this.root = new Prop("root", null); this.root.layer = this; this.parent = null;
        const tr = this.root.property("ADBE Transform Group");
        tr.property("ADBE Anchor Point").setValue([0, 0]);
        tr.property("ADBE Position").setValue([comp.width / 2, comp.height / 2]);
        tr.property("ADBE Scale").setValue([100, 100]);
        tr.property("ADBE Rotate Z").setValue(0);
        tr.property("ADBE Opacity").setValue(100);
    }
    property(k) { return this.root.property(k); }
    get numProperties() { return this.root.numProperties; }
    // a rough text box (selftest / render override it): ~0.55 em per character, left- or centre-justified
    sourceRectAtTime() {
        const td = this.kind === "text" ? this.property("ADBE Text Properties").property("ADBE Text Document").value : null;
        if (!td) return { left: -this.containingComp.width / 2, top: -this.containingComp.height / 2, width: this.containingComp.width, height: this.containingComp.height };
        const fs = td.fontSize || 100, w = String(td.text).length * fs * 0.55;
        return { left: td.justification === "left" ? 0 : -w / 2, top: -fs * 0.8, width: w, height: fs };
    }
    duplicate() {
        const D = new Layer(this.containingComp, this.kind, this.name);
        Object.assign(D, this, { id: D.id, root: this.root.clone(null) }); D.root.layer = D;
        const L = this.containingComp.layerList; L.splice(L.indexOf(this), 0, D); return D;
    }
    get index() { return this.containingComp.layerList.indexOf(this) + 1; }
    moveToBeginning() { const L = this.containingComp.layerList; L.splice(L.indexOf(this), 1); L.unshift(this); }
    moveToEnd() { const L = this.containingComp.layerList; L.splice(L.indexOf(this), 1); L.push(this); }
    moveBefore(x) { const L = this.containingComp.layerList; L.splice(L.indexOf(this), 1); L.splice(L.indexOf(x), 0, this); }
    remove() { const L = this.containingComp.layerList; L.splice(L.indexOf(this), 1); }
}

class CompItem {
    constructor(w, h, duration, fps) {
        this.width = w; this.height = h; this.duration = duration; this.frameDuration = 1 / fps; this.pixelAspect = 1;
        this.time = 0; this.motionBlur = false; this.layerList = []; this.selectedLayers = []; this.selectedProperties = [];
        const comp = this;
        this.layers = {
            addText(text) {
                const L = new Layer(comp, "text", text);
                L.property("ADBE Text Properties").property("ADBE Text Document").setValue(new TextDocument(text));
                comp.layerList.unshift(L); return L;
            },
            addSolid(color, name, w, h) { const L = new Layer(comp, "solid", name); L.color = color; comp.layerList.unshift(L); return L; },
            add(item) { const L = new Layer(comp, item.hasVideo === false ? "audio" : "footage", item.name); L.source = item; comp.layerList.unshift(L); return L; },
            addNull() { const L = new Layer(comp, "null", "Null"); comp.layerList.unshift(L); return L; }
        };
    }
    get numLayers() { return this.layerList.length; }
    layer(i) { return typeof i === "number" ? this.layerList[i - 1] : this.layerList.find(l => l.name === i); }
}

function install(globalObj) {
    globalObj.CompItem = CompItem;
    globalObj.TextLayer = class TextLayer { static [Symbol.hasInstance](x) { return x instanceof Layer && x.kind === "text"; } };
    globalObj.ParagraphJustification = { CENTER_JUSTIFY: "center", LEFT_JUSTIFY: "left", RIGHT_JUSTIFY: "right" };
    globalObj.PropertyType = { PROPERTY: 6212, INDEXED_GROUP: 6213, NAMED_GROUP: 6214 };
    globalObj.KeyframeEase = function KeyframeEase(speed, influence) { this.speed = speed; this.influence = influence; };
    globalObj.FolderItem = class FolderItem { constructor(n) { this.name = n; } };
    globalObj.SolidSource = class SolidSource {};
    globalObj.PurgeTarget = { ALL_CACHES: 1 };
    globalObj.KeyframeInterpolationType = { LINEAR: 1, HOLD: 2, BEZIER: 3 };
    globalObj.app = { purge() {}, effects: [{ displayName: "Glow", matchName: "ADBE Glo2" }, { displayName: "CC Light Sweep", matchName: "CC Light Sweep" }] };
}

module.exports = { Prop, TextDocument, Layer, CompItem, install };
