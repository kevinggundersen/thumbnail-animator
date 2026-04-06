/**
 * Pure helper functions shared between filter-sort-worker.js and tests.
 * Loaded via importScripts() in the worker context, require() in Node/tests.
 */
'use strict';

function normalizePath(p) {
    if (!p) return p;
    return p.replace(/\\/g, '/').replace(/\/+$/, '') || p;
}

function cosineSim(a, b) {
    let dot = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) dot += a[i] * b[i];
    return dot;
}

function parseAspectRatio(str) {
    if (!str) return NaN;
    const parts = String(str).split(':').map(s => parseFloat(s));
    if (parts.length !== 2 || !parts[0] || !parts[1]) return NaN;
    return parts[0] / parts[1];
}

function pad2(n) { return n < 10 ? '0' + n : '' + n; }

function getDateGroupKey(file, granularity) {
    const t = file.mtime || 0;
    if (!t) return 'unknown';
    const d = new Date(t);
    if (granularity === 'year') return String(d.getFullYear());
    if (granularity === 'day') return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; // default month
}

function getDateGroupLabel(key) {
    if (key === 'unknown') return 'Unknown date';
    return key;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { normalizePath, cosineSim, parseAspectRatio, pad2, getDateGroupKey, getDateGroupLabel };
}
