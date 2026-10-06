'use strict';
// Removes the unreferenced top-level functions reported by dead-functions.js,
// together with a comment block that sits directly above each one (nothing but
// whitespace between the comment's end and the function). Re-run
// dead-functions.js afterwards: removing one function can orphan another.
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const ROOT = path.join(__dirname, '..');
const dead = require('./dead-functions');
const byFile = new Map();
for (const d of dead) { if (!byFile.has(d.file)) byFile.set(d.file, new Set()); byFile.get(d.file).add(d.name); }
let removedLines = 0;
for (const [file, names] of byFile) {
    const p = path.join(ROOT, file);
    let s = fs.readFileSync(p, 'utf8');
    const crlf = s.includes('\r\n');
    if (crlf) s = s.replace(/\r\n/g, '\n');
    const comments = [];
    const ast = acorn.parse(s, { ecmaVersion: 'latest', sourceType: 'script', onComment: comments });
    const ranges = [];
    for (const node of ast.body) {
        if (node.type !== 'FunctionDeclaration' || !names.has(node.id.name)) continue;
        let start = node.start;
        // Walk back over comments that are separated from the function only by whitespace.
        for (;;) {
            const c = comments.filter(c => c.end <= start && /^\s*$/.test(s.slice(c.end, start))).sort((a, b) => b.end - a.end)[0];
            if (!c) break;
            start = c.start;
        }
        // Include the line start and one following newline so no blank line is left behind.
        const lineStart = s.lastIndexOf('\n', start - 1) + 1;
        if (/^\s*$/.test(s.slice(lineStart, start))) start = lineStart;
        let end = node.end;
        if (s[end] === '\n') end++;
        ranges.push([start, end, node.id.name]);
    }
    ranges.sort((a, b) => b[0] - a[0]);
    for (const [start, end, name] of ranges) {
        const n = s.slice(start, end).split('\n').length - 1;
        if (n > 400) throw new Error(`refusing to remove ${name}: ${n} lines looks wrong`);
        removedLines += n;
        s = s.slice(0, start) + s.slice(end);
        console.log(`removed ${file} ${name} (${n} lines)`);
    }
    fs.writeFileSync(p, crlf ? s.replace(/\n/g, '\r\n') : s);
}
console.log(`removed ${removedLines} lines`);
