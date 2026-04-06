// IPC Result shape helpers — used by renderer.js and renderer-features.js.
// Loaded as a plain <script> before renderer.js in index.html (no module system).
//
// Target shape:
//   { ok: true, value: <anything> }
//   { ok: false, error: <string> }
//
// See CLAUDE.local.md "IPC result shape" for the convention.
'use strict';

function ipcOk(value) {
    return { ok: true, value: value };
}

function ipcErr(error) {
    var msg;
    if (error == null) msg = 'unknown error';
    else if (typeof error === 'string') msg = error;
    else if (error && typeof error.message === 'string') msg = error.message;
    else msg = String(error);
    return { ok: false, error: msg };
}

// Strip a known top-level key and return the remaining own-enumerable
// properties as a new object. Used to translate legacy
// { success: true, ...fields } into { value: { ...fields } }.
function stripKey(obj, key) {
    var out = {};
    for (var k in obj) {
        if (k === key) continue;
        if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
    }
    return out;
}

// Normalize any legacy/new IPC response (or a Promise of one) to the
// { ok, value, error } Result shape. Ordered first-match-wins.
async function unwrapIpc(x) {
    var r;
    try {
        r = await x;
    } catch (err) {
        return ipcErr(err);
    }
    if (r == null) return ipcErr('no response');
    if (Array.isArray(r)) return ipcOk(r);
    if (typeof r !== 'object') return ipcOk(r);

    // Already in target shape.
    if (r.ok === true || r.ok === false) {
        if (r.ok === true && !('value' in r)) {
            // Legacy {ok: true, ...fields} — wrap remaining fields as value.
            return ipcOk(stripKey(r, 'ok'));
        }
        if (r.ok === false && typeof r.error !== 'string') {
            return ipcErr(r.error);
        }
        return r;
    }

    // Legacy success-wrapped: {success: true, data?, ...rest}
    if (r.success === true) {
        if ('data' in r) return ipcOk(r.data);
        return ipcOk(stripKey(r, 'success'));
    }
    if (r.success === false) {
        return ipcErr(r.error || 'unknown error');
    }

    // Legacy error-only: {error: "..."} without success/ok.
    if (typeof r.error === 'string' && !('ok' in r) && !('success' in r)) {
        return ipcErr(r.error);
    }

    // Plain object without status keys: treat as successful value.
    return ipcOk(r);
}

// Attach to window for browser <script> context
if (typeof window !== 'undefined') {
    window.ipcOk = ipcOk;
    window.ipcErr = ipcErr;
    window.unwrapIpc = unwrapIpc;
}

// Export for Node/test context
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ipcOk, ipcErr, unwrapIpc, stripKey };
}
