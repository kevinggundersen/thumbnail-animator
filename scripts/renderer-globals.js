'use strict';
// Collects the names every classic <script> in index.html declares at top level.
// Until the renderer is converted to ES modules, these names are shared
// implicitly across files; ESLint's no-undef needs to know them so that it can
// flag the names that are *not* declared anywhere (real bugs).
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

const ROOT = path.join(__dirname, '..');

function rendererScripts() {
    const m = require('./renderer-manifest');
    return [...m.sync, ...m.vendorDeferred, ...m.deferred];
}

function topLevelNames(file) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const names = new Set();
    let ast;
    try {
        ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true });
    } catch (e) {
        return names; // vendored minified bundles sometimes trip the parser; skip
    }
    const addPattern = (p) => {
        if (!p) return;
        if (p.type === 'Identifier') names.add(p.name);
        else if (p.type === 'ObjectPattern') p.properties.forEach(pr => addPattern(pr.value || pr.argument));
        else if (p.type === 'ArrayPattern') p.elements.forEach(addPattern);
        else if (p.type === 'AssignmentPattern') addPattern(p.left);
        else if (p.type === 'RestElement') addPattern(p.argument);
    };
    for (const node of ast.body) {
        if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') names.add(node.id.name);
        else if (node.type === 'VariableDeclaration') node.declarations.forEach(d => addPattern(d.id));
    }
    // window.X = ... assignments anywhere in the file
    const re = /\bwindow\.([A-Za-z_$][\w$]*)\s*=[^=]/g;
    let m;
    while ((m = re.exec(src))) names.add(m[1]);
    return names;
}

function collect() {
    const globals = {};
    for (const file of rendererScripts()) {
        for (const n of topLevelNames(file)) globals[n] = 'writable';
    }
    return globals;
}

module.exports = { collect, rendererScripts, topLevelNames };

if (require.main === module) {
    const g = collect();
    console.log(`${Object.keys(g).length} shared renderer globals`);
}
