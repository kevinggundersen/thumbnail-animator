'use strict';
// Concatenates the first-party renderer scripts into two bundles (sync and
// deferred, see renderer-manifest.js) and minifies them with esbuild. The
// scripts share one global scope, so this is a concatenation, not a module
// bundle; a file-level 'use strict' directive is dropped so it cannot leak into
// the files that follow it. Output: dist-renderer/app.sync.js, app.deferred.js (+ .map).
// Usage: node scripts/build-renderer.js [--dev]   (--dev: readable, unminified)
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const manifest = require('./renderer-manifest');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist-renderer');
const dev = process.argv.includes('--dev');
fs.mkdirSync(OUT, { recursive: true });

function stripFileDirective(src) {
    // Only a directive that is the file's first statement (comments may precede it).
    return src.replace(/^((?:\s*\/\/[^\n]*\n|\s*\/\*[\s\S]*?\*\/\s*)*)\s*(['"])use strict\2;?/, '$1');
}

function bundle(files, name) {
    let code = '';
    for (const f of files) {
        const src = stripFileDirective(fs.readFileSync(path.join(ROOT, f), 'utf8'));
        code += `\n// ---- ${f} ----\n${src}\n`;
    }
    const outFile = path.join(OUT, name);
    if (dev) {
        fs.writeFileSync(outFile, code);
        return { bytes: code.length };
    }
    const res = esbuild.transformSync(code, {
        minify: true, sourcemap: true, target: 'chrome142', legalComments: 'none',
        sourcefile: name + '.src.js', // what the map points at (the concatenation)
    });
    fs.writeFileSync(outFile, res.code + `\n//# sourceMappingURL=${name}.map\n`);
    fs.writeFileSync(outFile + '.map', res.map);
    fs.writeFileSync(path.join(OUT, name + '.src.js'), code); // for the source map and for reading stack traces
    return { bytes: res.code.length, srcBytes: code.length };
}

const t0 = Date.now();
const a = bundle(manifest.sync, 'app.sync.js');
const b = bundle(manifest.deferred, 'app.deferred.js');
console.log(`[build-renderer] ${dev ? 'dev' : 'minified'}: app.sync.js ${(a.bytes / 1024).toFixed(0)} KB, app.deferred.js ${(b.bytes / 1024).toFixed(0)} KB` +
    (dev ? '' : ` (from ${((a.srcBytes + b.srcBytes) / 1024).toFixed(0)} KB)`) + ` in ${Date.now() - t0} ms`);
