// Caption AE — the panel's line to After Effects and to the computer.
// AE: window.__adobe_cep__.evalScript runs ExtendScript; host/host.jsx answers cae("command", "<json>") with JSON.
// Computer: CEP's Node.js (manifest --enable-nodejs --mixed-context) gives fs / child_process for Python and files.
var CEP = (function () {
    var cep = window.__adobe_cep__;
    var req = typeof window.require === "function" ? window.require : null;
    var node = req ? { fs: req("fs"), path: req("path"), cp: req("child_process"), os: req("os") } : null;

    // the extension folder, from this page's own URL (…/client/index.html)
    var root = decodeURIComponent(String(location.href).replace(/^file:\/\/\/?/, "").replace(/[?#].*$/, ""))
        .replace(/\/client\/[^\/]*$/, "");
    if (!/^[A-Za-z]:/.test(root) && root.charAt(0) !== "/") root = "/" + root; // file:///Users/… → /Users/…

    function evalScript(code) {
        return new Promise(function (resolve) {
            if (!cep) return resolve('{"ok":false,"error":"Панель открыта не в After Effects"}');
            cep.evalScript(code, resolve);
        });
    }
    var hostLoaded = null;
    function ensureHost() { // manifest ScriptPath loads host.jsx; if AE did not, load it ourselves; then the engine, by our folder
        var R = JSON.stringify(root.replace(/\\/g, "/"));
        if (!hostLoaded) hostLoaded = evalScript("typeof caeInit").then(function (t) {
            if (t !== "function") return evalScript("$.evalFile(File(" + R + ' + "/host/host.jsx"))');
        }).then(function () { return evalScript("caeInit(" + R + ")"); }).then(function (r) {
            if (r !== "ok") { hostLoaded = null; throw new Error(r && r !== "undefined" ? r : "After Effects не загрузил host.jsx панели. Переустановите Caption AE и перезапустите AE."); }
        });
        return hostLoaded;
    }
    function call(cmd, args) {
        return ensureHost().then(function () {
            return evalScript("cae(" + JSON.stringify(cmd) + "," + JSON.stringify(JSON.stringify(args || {})) + ")");
        }).then(function (r) {
            var o;
            try { o = JSON.parse(r); } catch (e) { throw new Error("After Effects не ответил как ожидалось: " + String(r).slice(0, 200)); }
            if (!o.ok) throw new Error(o.error + (o.line ? " (строка " + o.line + ")" : ""));
            return o;
        });
    }
    function openURL(u) { try { window.cep.util.openURLInDefaultBrowser(u); } catch (e) { window.open(u); } }
    return { call: call, node: node, root: root, openURL: openURL, inAE: !!cep, req: req };
})();
