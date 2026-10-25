// Scroll test of the panel: a docked panel shorter than the tabs gets a scrollbar that moves them; a tall one hides it.
// Usage: node scrolltest.js [CaptionAE.jsx]   (prints the numbers and exits 1 on a wrong result)
// layout stand-in: tabs want NAT px; the docked panel is WIN px tall; check the scroll maths of relayout()
const fs = require("fs"), vm = require("vm"), NAT = 900, WIN = 600;
class C {
  constructor(t, p, x) { this.type = t; this.parent = p; this.children = []; this.text = typeof x === "string" ? x : ""; this.items = Array.isArray(x) ? x : null;
    this.visible = true; this.size = { width: 400, height: 20 }; this.location = [0, 0]; this.minimumSize = [0, 0]; this.maximumSize = [10000, 10000];
    this.preferredSize = { width: -1, height: -1 }; this.margins = 10; this.spacing = 6; this.value = 0; this.maxvalue = 100; }
  add(t, b, x, pr) { const c = new C(t, this, t === "scrollbar" ? "" : x, pr); this.children.push(c); return c; }
  set selection(v) { this._s = v; } get selection() { return this.items ? { index: this._s || 0, text: this.items[this._s || 0] } : null; }
  show() {} center() {} update() {} close() {}
  get layout() { const w = this; return { layout() { lay(w); }, resize() { lay(w); } }; }
}
let tabs, view, row, status, win;
function lay(w) { // the parts relayout() relies on: min/max sizes respected, tabs keep their natural height
  tabs = tabs || find(w, "tabbedpanel"); view = tabs.parent; row = view.parent; status = w.children[w.children.length - 1];
  tabs.size = { width: 380, height: Math.max(NAT, tabs.minimumSize[1]) };
  const mx = Array.isArray(view.maximumSize) ? view.maximumSize[1] : 10000;
  view.size = { width: 380, height: Math.min(NAT, mx) }; status.size = { width: 380, height: 32 }; tabs.location = [0, 0];
}
const find = (c, t) => c.type === t ? c : c.children.map(k => find(k, t)).find(Boolean);
class Window extends C { constructor() { super("window", null, ""); } }
class Panel extends C { constructor() { super("panel", null, ""); this.size = { width: 420, height: WIN }; this.margins = { top: 10, bottom: 10, left: 10, right: 10 }; } }
win = new Panel();
const sb = { Window, Panel, $: { fileName: "/x/a.jsx", os: "Windows", global: {}, screens: [{ top: 0, bottom: 800 }] },
  app: { settings: { haveSetting: () => false, getSetting: () => "", saveSetting() {} }, project: {}, effects: [], preferences: { getPrefAsLong: () => 1 },
    scheduleTask: () => 1, cancelTask() {}, beginUndoGroup() {}, endUndoGroup() {} },
  File: Object.assign(p => ({ parent: { fsName: "/x" }, exists: false, fsName: p }), { openDialog: () => null }), Folder: { temp: { fsName: "/tmp" } },
  system: { callSystem: () => "" }, ScriptUI: { environment: { keyboardState: {} } }, ParagraphJustification: {}, alert() {} };
sb.global = sb; vm.createContext(sb);
const src = fs.readFileSync(process.argv[2] || require("path").join(__dirname, "../CaptionAE.jsx"), "utf8").replace(/^﻿/, "").replace(/\}\)\(this\);\s*$/, "})(PANEL);");
sb.PANEL = win; vm.runInContext(src, sb);
const vsb = find(win, "scrollbar");
console.log("avail", view.size.height, "nat", tabs.size.height, "scrollbar visible", vsb.visible, "max", vsb.maxvalue);
vsb.value = 150; vsb.onChanging(); console.log("scrolled 150 → tabs y", tabs.location[1]);
const vis1 = vsb.visible, max1 = vsb.maxvalue;
win.size.height = 2000; win.onResize.call(win); console.log("tall panel → scrollbar visible", vsb.visible, "tabs y", tabs.location[1]);
const okScroll = vis1 && max1 === NAT - 542 && !vsb.visible && tabs.location[1] === 0;
if (!okScroll) { console.log("SCROLL TEST FAILED"); process.exit(1); } else console.log("scroll OK");
