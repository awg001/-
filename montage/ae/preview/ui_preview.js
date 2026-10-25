// Interface preview of Caption AE without After Effects: runs CaptionAE.jsx's real ScriptUI code against a tiny
// ScriptUI stand-in that records every control, then writes one HTML page per tab in AE's dark look.
// Usage: node ui_preview.js <outDir>   → <outDir>/tab_<n>.html (screenshot them with Playwright).
const fs = require("fs"), path = require("path"), vm = require("vm");

class Ctl {
    constructor(type, parent, text, props) {
        this.type = type; this.parent = parent; this.children = []; this.props = props || {};
        this.items = Array.isArray(text) ? text.slice() : null;
        this.text = Array.isArray(text) ? "" : (text || ""); this.value = false; this._sel = null; this.visible = true; this.preferredSize = { width: -1, height: -1 };
        this.orientation = type === "group" ? "row" : "column";
        this.layout = { layout() {}, resize() {} };
    }
    add(type, bounds, text, props) { const c = new Ctl(type, this, text, props); this.children.push(c); return c; }
    set selection(v) { this._sel = typeof v === "number" ? v : v && v.index !== undefined ? v.index : null; }
    get selection() { return this._sel === null || !this.items ? null : { index: this._sel, text: this.items[this._sel] }; }
    center() {} show() { SHOWN.push(this); } update() {}
}
const SHOWN = [];
const findType = (c, t) => { if (c.type === t) return c; for (const k of c.children) { const r = findType(k, t); if (r) return r; } return null; };
class Window extends Ctl { constructor(type, title) { super("window", null, title); } }
class Panel {}

// ES5+ built-ins After Effects' ExtendScript does not have (its arrays have no indexOf, there is no JSON, no trim…)
const ES3 = `(function (o, ks) { for (var i = 0; i < ks.length; i++) delete o[ks[i]]; })
    (Array.prototype, ["indexOf", "lastIndexOf", "forEach", "map", "filter", "some", "every", "reduce", "reduceRight", "find", "findIndex", "includes", "fill"]);
(function (o, ks) { for (var i = 0; i < ks.length; i++) delete o[ks[i]]; })
    (String.prototype, ["trim", "trimStart", "trimEnd", "includes", "startsWith", "endsWith", "repeat", "padStart", "padEnd"]);
delete Array.isArray; delete Object.keys; delete Object.create; delete Object.assign; delete Function.prototype.bind; delete Date.now; delete this.JSON;`;
module.exports = { ES3 };
const settings = {};
if (process.env.OPEN) settings["CaptionAEopenSec"] = process.env.OPEN; // OPEN=n: render with settings section n unfolded
const sandbox = {
    Window, Panel, SHOWN,
    app: {
        settings: { haveSetting: (s, k) => (s + k) in settings, getSetting: (s, k) => settings[s + k], saveSetting: (s, k, v) => { settings[s + k] = v; } },
        project: { activeItem: null }, effects: [], preferences: { getPrefAsLong: () => 1 },
        beginUndoGroup() {}, endUndoGroup() {}, scheduleTask: () => 1, cancelTask() {}
    },
    $: { fileName: "/x/CaptionAE.jsx", os: "Windows", global: {} },
    File: Object.assign(p => ({ parent: { fsName: "/x" }, exists: false, fsName: p }), { openDialog: () => null }),
    Folder: { temp: { fsName: "/tmp" } }, system: { callSystem: () => "" },
    ParagraphJustification: { CENTER_JUSTIFY: 1 }, alert: () => {}
};
sandbox.global = sandbox;
vm.createContext(sandbox);
// ExtendScript is ES3: take away what it lacks, so code that leans on ES5 fails here as it does in After Effects
vm.runInContext(ES3, sandbox);
const src = fs.readFileSync(process.env.JSX || path.join(__dirname, "../CaptionAE.jsx"), "utf8").replace(/^﻿/, "");
vm.runInContext(src, sandbox, { filename: "CaptionAE.jsx" });
const win = sandbox.SHOWN[0];

// ---------- HTML in After Effects' panel style ----------
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
// fixed widths (label column, checkbox grid) and fill-width buttons, as the ScriptUI code sets them
const w = c => c.preferredSize && c.preferredSize.width > 0 ? ` style="width:${c.preferredSize.width}px;flex:none"` : "";
const fill = c => Array.isArray(c.alignment) && c.alignment[0] === "fill";
function html(c) {
    if (c.visible === false) return ""; // folded / hidden controls take no room, as in AE
    const kids = () => c.children.map(html).join("");
    switch (c.type) {
        case "group": return `<div class="g ${c.orientation}">${kids()}</div>`;
        case "panel": return `<fieldset class="p"><legend>${esc(c.text)}</legend>${kids()}</fieldset>`;
        case "statictext": return `<span class="st"${w(c)}>${esc(c.text).replace(/\n/g, "<br>")}</span>`;
        case "edittext": return c.props.multiline ? `<textarea rows="9">${esc(c.text)}</textarea>`
            : `<input value="${esc(c.text)}" style="width:${(c.characters || 10) * 8 + 10}px">`;
        case "button": return `<button${fill(c) ? ' class="fill"' : ""}${w(c)}>${esc(c.text)}</button>`;
        case "checkbox": return `<label class="cb${c.enabled === false ? " off" : ""}"${w(c)}><span class="box">${c.value ? "✓" : ""}</span>${esc(c.text)}</label>`;
        case "dropdownlist": return `<span class="dd">${esc(c.selection ? c.selection.text : "")}<i>▾</i></span>`;
        default: return kids();
    }
}
const css = `body{margin:0;background:#1b1b1b;font:12px/1.35 "Segoe UI",Arial,sans-serif;color:#c8c8c8}
.win{width:470px;background:#232323;border:1px solid #3a3a3a;margin:8px}
.title{background:#2d2d2d;padding:5px 10px;color:#ddd;border-bottom:1px solid #3a3a3a}
.tabs{display:flex;gap:2px;padding:8px 8px 0}.tab{padding:5px 10px;background:#2b2b2b;border:1px solid #3a3a3a;border-bottom:none;color:#9a9a9a}
.tab.on{background:#323232;color:#fff}.body{border-top:1px solid #3a3a3a;margin:0 8px;padding:8px 2px;display:flex;flex-direction:column;gap:6px}
.g{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.g.column{flex-direction:column;align-items:flex-start}
fieldset.p{border:1px solid #444;border-radius:3px;margin:0;padding:6px 8px 8px;display:flex;flex-direction:column;gap:6px;align-items:flex-start}
legend{color:#e0e0e0;padding:0 4px}.st{color:#bdbdbd}
input,textarea{background:#191919;border:1px solid #474747;color:#e6e6e6;font:inherit;padding:2px 4px}
textarea{width:420px;resize:none}button{background:#3a3a3a;border:1px solid #555;color:#eee;font:inherit;padding:4px 10px;border-radius:2px}
.cb{display:flex;align-items:center;gap:5px}.box{width:12px;height:12px;border:1px solid #666;background:#191919;display:inline-flex;align-items:center;justify-content:center;font-size:10px;color:#4aa3ff}
.dd{background:#2b2b2b;border:1px solid #4a4a4a;padding:2px 6px;display:inline-flex;gap:10px;align-items:center;color:#e6e6e6}.dd i{color:#888;font-style:normal}
button.fill{width:100%;text-align:left;background:#2e2e2e}.cb.off{opacity:.45}.st{white-space:nowrap}
.status{padding:6px 10px;border-top:1px solid #3a3a3a;color:#9a9a9a}`;

const out = process.argv[2] || "ui_out";
fs.mkdirSync(out, { recursive: true });
const tp = findType(win, "tabbedpanel"), status = win.children.find(c => c.type === "statictext");
tp.children.forEach((tab, i) => {
    const tabs = tp.children.map((t, j) => `<span class="tab${i === j ? " on" : ""}">${esc(t.text)}</span>`).join("");
    fs.writeFileSync(path.join(out, `tab_${i + 1}${process.env.OPEN && i === 0 ? "_open" + process.env.OPEN : ""}.html`), `<!doctype html><meta charset="utf-8"><style>${css}</style>
<div class="win"><div class="title">${esc(win.text)}</div><div class="tabs">${tabs}</div><div class="body">${tab.children.map(html).join("")}</div>
<div class="status">${esc(status ? status.text : "")}</div></div>`);
});
console.log(tp.children.map(t => t.text).join(" | "));
