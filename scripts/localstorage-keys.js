'use strict';
// Inventory of raw localStorage keys used by the renderer scripts, with their
// read/write sites, and whether settings.js's schema already covers them.
const fs = require('fs');
const path = require('path');
const { rendererScripts } = require('./renderer-globals');
const ROOT = path.join(__dirname, '..');
const files = rendererScripts().filter(f => !/vendor|bundle|\.min\.|settings\.js$/.test(f));
const keys = new Map(); // key -> { reads: [], writes: [], removes: [] }
const add = (kind, key, where) => { if (!keys.has(key)) keys.set(key, { reads: [], writes: [], removes: [] }); keys.get(key)[kind].push(where); };
for (const f of files) {
    const lines = fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n');
    lines.forEach((line, i) => {
        const where = `${f}:${i + 1}`;
        for (const m of line.matchAll(/localStorage\.getItem\(\s*'([^']+)'/g)) add('reads', m[1], where);
        for (const m of line.matchAll(/localStorage\.setItem\(\s*'([^']+)'/g)) add('writes', m[1], where);
        for (const m of line.matchAll(/deferLocalStorageWrite\(\s*'([^']+)'/g)) add('writes', m[1], where);
        for (const m of line.matchAll(/localStorage\.removeItem\(\s*'([^']+)'/g)) add('removes', m[1], where);
    });
}
const schemaSrc = fs.readFileSync(path.join(ROOT, 'settings.js'), 'utf8');
const schemaKeys = new Set([...schemaSrc.matchAll(/storageKey: '([^']+)'/g)].map(m => m[1]).concat([...schemaSrc.matchAll(/: '([A-Za-z0-9]+)'(?=\s*[,}])/g)].map(m => m[1])));
const rows = [...keys.entries()].sort((a, b) => a[0].localeCompare(b[0]));
console.log(`${rows.length} raw keys; ${rows.filter(([k]) => schemaKeys.has(k)).length} already in the schema`);
for (const [k, v] of rows) {
    console.log(`${schemaKeys.has(k) ? '[schema] ' : '         '}${k.padEnd(28)} r:${v.reads.length} w:${v.writes.length} rm:${v.removes.length}  ${[...v.reads, ...v.writes].slice(0, 3).join(' ')}`);
}
