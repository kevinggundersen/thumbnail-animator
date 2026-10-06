'use strict';
// Lists top-level functions in the classic renderer scripts that nothing references
// (not from any script, index.html, or a window.* export). Heuristic: a bare
// identifier match anywhere other than its own declaration counts as a use.
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const { rendererScripts } = require('./renderer-globals');
const ROOT = path.join(__dirname, '..');
const files = rendererScripts().filter(f => !/vendor|bundle|\.min\./.test(f));
const sources = Object.fromEntries(files.map(f => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const all = Object.values(sources).join('\n') + '\n' + html;
const out = [];
for (const f of files) {
    let ast;
    try { ast = acorn.parse(sources[f], { ecmaVersion: 'latest', sourceType: 'script' }); } catch { continue; }
    for (const node of ast.body) {
        if (node.type !== 'FunctionDeclaration') continue;
        const name = node.id.name;
        const re = new RegExp(`(?<![\w$.])${name.replace(/\$/g, '\$')}(?![\w$])`, 'g');
        const count = (all.match(re) || []).length;
        if (count <= 1) out.push({ file: f, name, line: sources[f].slice(0, node.start).split('\n').length, lines: sources[f].slice(node.start, node.end).split('\n').length });
    }
}
out.sort((a, b) => b.lines - a.lines);
if (require.main === module) {
    console.log(`${out.length} unreferenced top-level functions, ${out.reduce((a, b) => a + b.lines, 0)} lines`);
    for (const o of out) console.log(`${String(o.lines).padStart(5)}  ${o.file}:${o.line}  ${o.name}`);
}
module.exports = out;
