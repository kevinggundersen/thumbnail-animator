// Usage: node scripts/trace-top.js <trace.json> [--thread CrRendererMain] [--top 30]
//
// Summarizes a Chrome trace (scripts/perf-smoke.js --trace) by self time per
// event name on one thread (default: the renderer main thread), so the native
// "(program)" time of a CPU profile can be attributed: layout, style, paint,
// media element work, garbage collection, IPC, timers ...
const fs = require('fs');
const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
if (!file) { console.error('usage: node scripts/trace-top.js <trace.json> [--thread name] [--top n]'); process.exit(2); }
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
const threadWanted = opt('--thread', 'CrRendererMain');
const top = parseInt(opt('--top', '30'), 10);

const trace = JSON.parse(fs.readFileSync(file, 'utf8'));
const events = Array.isArray(trace) ? trace : trace.traceEvents;

// Thread names come from metadata events.
const threadNames = new Map(); // `${pid}:${tid}` -> name
for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') threadNames.set(`${e.pid}:${e.tid}`, e.args && e.args.name);
const threads = [...threadNames.entries()].filter(([, n]) => n === threadWanted).map(([k]) => k);
if (threads.length === 0) {
    console.error(`no thread named ${threadWanted}; threads seen: ${[...new Set(threadNames.values())].join(', ')}`);
    process.exit(1);
}
// Several renderer processes may exist (preload sandboxes etc.); take the busiest one.
const perThread = new Map();
for (const e of events) {
    if (e.ph !== 'X' || typeof e.dur !== 'number') continue;
    const key = `${e.pid}:${e.tid}`;
    if (!threads.includes(key)) continue;
    if (!perThread.has(key)) perThread.set(key, []);
    perThread.get(key).push(e);
}
let best = null;
for (const [key, list] of perThread) { const total = list.reduce((a, e) => a + e.dur, 0); if (!best || total > best.total) best = { key, list, total }; }
if (!best) { console.error('no complete events on that thread'); process.exit(1); }
const list = best.list.sort((a, b) => a.ts - b.ts || b.dur - a.dur);

// Self time = duration minus the duration of nested events (stack by ts/dur).
const self = new Map(); const count = new Map(); const maxDur = new Map();
const stack = [];
for (const e of list) {
    while (stack.length && stack[stack.length - 1].ts + stack[stack.length - 1].dur <= e.ts) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) parent._child = (parent._child || 0) + e.dur;
    stack.push(e);
}
let wall = 0; let first = Infinity; let last = 0;
for (const e of list) {
    const s = Math.max(0, e.dur - (e._child || 0));
    const name = e.name + (e.name === 'FunctionCall' && e.args && e.args.data && e.args.data.functionName ? ` ${e.args.data.functionName}` : '');
    self.set(name, (self.get(name) || 0) + s);
    count.set(name, (count.get(name) || 0) + 1);
    maxDur.set(name, Math.max(maxDur.get(name) || 0, e.dur));
    wall += s; first = Math.min(first, e.ts); last = Math.max(last, e.ts + e.dur);
}
const span = (last - first) / 1000;
console.log(`thread ${best.key} (${threadWanted}): ${(wall / 1000).toFixed(0)} ms busy of ${span.toFixed(0)} ms span (${(100 * wall / 1000 / span).toFixed(0)}%)`);
console.log('\nTop events by self time:');
const rows = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, top);
for (const [name, us] of rows) {
    console.log(`${(us / 1000).toFixed(0).padStart(8)} ms ${(100 * us / wall).toFixed(1).padStart(5)}%  ${String(count.get(name)).padStart(6)}x  max ${(maxDur.get(name) / 1000).toFixed(1).padStart(7)} ms  ${name}`);
}
// Long top-level tasks: what was inside the worst ones.
const topLevel = list.filter(e => e.name === 'RunTask' || e.name === 'ThreadControllerImpl::RunTask' || e.name === 'MessageLoop::RunTask');
const worst = topLevel.sort((a, b) => b.dur - a.dur).slice(0, 5);
if (worst.length) {
    console.log('\nLongest tasks and their biggest nested events:');
    for (const t of worst) {
        const inner = list.filter(e => e !== t && e.ts >= t.ts && e.ts + e.dur <= t.ts + t.dur && e.dur > 2000).sort((a, b) => b.dur - a.dur).slice(0, 6);
        console.log(`  ${(t.dur / 1000).toFixed(0)} ms task: ${inner.map(e => `${e.name}${e.args && e.args.data && e.args.data.functionName ? ' ' + e.args.data.functionName : ''} ${(e.dur / 1000).toFixed(0)}ms`).join(' | ')}`);
    }
}
