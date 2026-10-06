'use strict';
// Summarize a .cpuprofile (Chrome DevTools / CDP Profiler format):
// top functions by self time and by file, so a scroll test can be read without DevTools.
// Usage: node scripts/cpuprofile-top.js <file.cpuprofile> [--top 25]
const fs = require('fs');
const path = require('path');

const file = process.argv[2];
if (!file) { console.error('usage: cpuprofile-top <file.cpuprofile> [--top N]'); process.exit(1); }
const topN = parseInt((process.argv.indexOf('--top') >= 0 ? process.argv[process.argv.indexOf('--top') + 1] : '25'), 10);
const prof = JSON.parse(fs.readFileSync(file, 'utf8'));

const byId = new Map(prof.nodes.map(n => [n.id, n]));
const self = new Map(); // node id -> samples
for (const id of prof.samples) self.set(id, (self.get(id) || 0) + 1);
const totalSamples = prof.samples.length;
const durationMs = (prof.endTime - prof.startTime) / 1000;
const msPerSample = durationMs / Math.max(1, totalSamples);

const byFn = new Map();
const byFile = new Map();
for (const [id, n] of self) {
    const node = byId.get(id);
    const cf = node.callFrame;
    const fileName = cf.url ? path.basename(cf.url.split('?')[0]) : (cf.functionName ? '(native)' : '(root)');
    const fnKey = `${cf.functionName || '(anonymous)'}  ${fileName}:${cf.lineNumber + 1}`;
    byFn.set(fnKey, (byFn.get(fnKey) || 0) + n);
    byFile.set(fileName, (byFile.get(fileName) || 0) + n);
}
const fmt = (samples) => `${(samples * msPerSample).toFixed(0).padStart(6)} ms ${((samples / totalSamples) * 100).toFixed(1).padStart(5)}%`;
console.log(`profile: ${durationMs.toFixed(0)} ms, ${totalSamples} samples (${msPerSample.toFixed(2)} ms/sample)\n`);
console.log('By file (self time):');
for (const [k, v] of [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${fmt(v)}  ${k}`);
console.log('\nTop functions (self time):');
for (const [k, v] of [...byFn.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN)) console.log(`  ${fmt(v)}  ${k}`);
