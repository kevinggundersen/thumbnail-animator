// Usage: node scripts/trace-threads.js <trace.json>
//
// Busy time per thread in a Chrome trace (scripts/perf-smoke.js --trace), counting
// only top-level tasks so nested RunTask events are not double counted, plus the
// renderer main thread's per-frame work counts (style, pre-paint, paint, layerize).
// Per-thread busy time counting only top-level tasks (no double counting of nested RunTask events).
const t = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8')).traceEvents;
const tn = new Map(); for (const e of t) if (e.ph === 'M' && e.name === 'thread_name') tn.set(e.pid + ':' + e.tid, e.args.name);
const byThread = new Map();
let tmin = Infinity, tmax = 0;
for (const e of t) { if (e.ph !== 'X' || !e.dur) continue; if (e.ts < tmin) tmin = e.ts; if (e.ts + e.dur > tmax) tmax = e.ts + e.dur; const k = e.pid + ':' + e.tid; if (!byThread.has(k)) byThread.set(k, []); byThread.get(k).push(e); }
const span = (tmax - tmin) / 1000;
const out = [];
for (const [k, list] of byThread) { list.sort((a, b) => a.ts - b.ts || b.dur - a.dur); let end = -1, busy = 0; for (const e of list) { if (e.ts >= end) { busy += e.dur; end = e.ts + e.dur; } else if (e.ts + e.dur > end) { busy += e.ts + e.dur - end; end = e.ts + e.dur; } } out.push([tn.get(k) || k, busy / 1000]); }
out.sort((a, b) => b[1] - a[1]);
console.log(' span', span.toFixed(0), 'ms; busy:', out.slice(0, 8).map(([n, ms]) => `${n} ${(100 * ms / span).toFixed(0)}%`).join(' | '));
const main = t.filter(e => e.ph === 'X' && tn.get(e.pid + ':' + e.tid) === 'CrRendererMain'); const c = {}; for (const e of main) { if (/^(Paint|Layerize|UpdateLayoutTree|PrePaint)$/.test(e.name)) c[e.name] = (c[e.name] || 0) + 1; } console.log(' main-thread per-frame work:', JSON.stringify(c));
