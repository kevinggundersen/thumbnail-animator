'use strict';
// Removes single-declarator top-level variables that nothing references (see dead-variables.js).
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const { rendererScripts } = require('./renderer-globals');
const ROOT = path.join(__dirname, '..');
const files = rendererScripts().filter(f => !/vendor|bundle|\.min\./.test(f));
const sources = Object.fromEntries(files.map(f => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]));
const all = Object.values(sources).join('\n') + '\n' + fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
let total = 0;
for (const f of files) {
    let s = sources[f];
    const crlf = s.includes('\r\n');
    if (crlf) s = s.replace(/\r\n/g, '\n');
    let ast;
    try { ast = acorn.parse(s, { ecmaVersion: 'latest', sourceType: 'script' }); } catch { continue; }
    const ranges = [];
    for (const node of ast.body) {
        if (node.type !== 'VariableDeclaration' || node.declarations.length !== 1) continue;
        const d = node.declarations[0];
        if (d.id.type !== 'Identifier') continue;
        const re = new RegExp(`(?<![\w$.])${d.id.name.replace(/\$/g, '\$')}(?![\w$])`, 'g');
        if ((all.match(re) || []).length > 1) continue;
        let start = s.lastIndexOf('\n', node.start - 1) + 1;
        if (!/^\s*$/.test(s.slice(start, node.start))) start = node.start;
        let end = node.end;
        const lineEnd = s.indexOf('\n', end);
        if (lineEnd >= 0 && /^\s*(\/\/.*)?$/.test(s.slice(end, lineEnd))) end = lineEnd + 1;
        ranges.push([start, end, d.id.name]);
    }
    ranges.sort((a, b) => b[0] - a[0]);
    for (const [start, end, name] of ranges) {
        const n = s.slice(start, end).split('\n').length - 1;
        if (n > 40) throw new Error(`refusing ${name}: ${n} lines`);
        total += n;
        s = s.slice(0, start) + s.slice(end);
        console.log(`removed ${f} ${name} (${n} lines)`);
    }
    fs.writeFileSync(path.join(ROOT, f), crlf ? s.replace(/\n/g, '\r\n') : s);
}
console.log(`removed ${total} lines`);
