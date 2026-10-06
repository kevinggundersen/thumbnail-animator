'use strict';
// Top-level const/let/var in the classic renderer scripts that nothing else references.
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const { rendererScripts } = require('./renderer-globals');
const ROOT = path.join(__dirname, '..');
const files = rendererScripts().filter(f => !/vendor|bundle|\.min\./.test(f));
const sources = Object.fromEntries(files.map(f => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]));
const all = Object.values(sources).join('\n') + '\n' + fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const out = [];
for (const f of files) {
    let ast;
    try { ast = acorn.parse(sources[f], { ecmaVersion: 'latest', sourceType: 'script' }); } catch { continue; }
    for (const node of ast.body) {
        if (node.type !== 'VariableDeclaration') continue;
        for (const d of node.declarations) {
            if (d.id.type !== 'Identifier') continue;
            const name = d.id.name;
            const re = new RegExp(`(?<![\w$.])${name.replace(/\$/g, '\$')}(?![\w$])`, 'g');
            const count = (all.match(re) || []).length;
            if (count <= 1) out.push({ file: f, name, line: sources[f].slice(0, node.start).split('\n').length });
        }
    }
}
console.log(`${out.length} unreferenced top-level variables`);
for (const o of out) console.log(`  ${o.file}:${o.line}  ${o.name}`);
