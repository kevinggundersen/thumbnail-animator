/**
 * Database Proxy
 *
 * Replaces `new AppDatabase(dbPath)` in the main process with an async proxy
 * that forwards every method call to a dedicated worker_thread. All SQL work
 * runs off the main process.
 *
 * The exposed object supports the same method names as AppDatabase, but each
 * call now returns a Promise. Existing IPC handlers that do `await appDb.foo()`
 * just work; synchronous call sites need to be converted (or fire-and-forget).
 *
 * Robustness:
 * - If the worker reports a corrupt database file on init, the file (and its
 *   -wal/-shm siblings) is moved aside once and the worker is respawned on a
 *   fresh database. Metadata is lost but the app starts.
 * - If the worker never reports ready within READY_TIMEOUT_MS, the proxy falls
 *   back to an in-process AppDatabase so calls cannot hang forever.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');

const READY_TIMEOUT_MS = 10000;

function isCorruptionError(message) {
    const m = String(message || '').toLowerCase();
    return m.includes('sqlite_corrupt') || m.includes('malformed') ||
        m.includes('not a database') || m.includes('sqlite_notadb');
}

/** Move a corrupt database and its WAL/SHM files aside. Returns the new path or null. */
function quarantineDatabase(dbPath) {
    if (!dbPath || dbPath === ':memory:') return null;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = `${dbPath}.corrupt-${stamp}`;
    let moved = null;
    for (const suffix of ['', '-wal', '-shm']) {
        const src = dbPath + suffix;
        if (!fs.existsSync(src)) continue;
        try {
            fs.renameSync(src, target + suffix);
            if (!suffix) moved = target;
        } catch (err) {
            console.error(`[db-proxy] could not move ${src} aside:`, err.message);
        }
    }
    return moved;
}

class DatabaseProxy {
    constructor(dbPath) {
        this._nextId = 0;
        this._pending = new Map();  // id -> { resolve, reject }
        this._worker = null;
        this._readyPromise = null;
        this._closed = false;
        this._fallbackDb = null;    // in-process AppDatabase if worker fails
        this._dbPath = dbPath;
        this._recoveryAttempted = false;
        this._lastRecovery = null;  // path the corrupt file was moved to, for the UI
        this._spawn(dbPath);

        // Return a Proxy so callers can use any method name transparently.
        return new Proxy(this, {
            get(target, prop, receiver) {
                // Real methods on the target itself (close, ready, _call, etc.)
                if (prop in target) return Reflect.get(target, prop, receiver);
                if (typeof prop !== 'string') return undefined;
                if (prop.startsWith('_')) return undefined;
                // Guard: Promise-related properties. If someone `await appDb`
                // or returns it from an async function, JS checks for .then —
                // we don't want to forward those to the DB worker.
                if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined;
                // Return an async function that forwards to the worker.
                return (...args) => target._call(prop, args);
            }
        });
    }

    _spawn(dbPath) {
        try {
            this._worker = new Worker(path.join(__dirname, 'database-worker.js'));
        } catch (err) {
            console.warn('[db-proxy] could not spawn worker, using in-process fallback:', err.message);
            this._initFallback();
            return;
        }
        const worker = this._worker;
        this._readyPromise = new Promise((resolve) => {
            let settled = false;
            const settle = () => { if (!settled) { settled = true; clearTimeout(watchdog); resolve(); } };

            const onMsg = (msg) => {
                if (msg.type === 'ready') {
                    worker.off('message', onMsg);
                    console.log('[db-proxy] worker ready');
                    settle();
                } else if (msg.type === 'init-error') {
                    worker.off('message', onMsg);
                    if (!this._recoveryAttempted && isCorruptionError(msg.error)) {
                        this._recoveryAttempted = true;
                        console.error('[db-proxy] database is corrupt, moving it aside and starting fresh:', msg.error);
                        this._lastRecovery = quarantineDatabase(dbPath);
                        this._terminateWorker(worker);
                        this._spawn(dbPath);               // sets a new _readyPromise
                        this._readyPromise.then(settle);   // resolve this one when the retry is ready
                        return;
                    }
                    console.warn('[db-proxy] worker init failed, using in-process fallback:', msg.error);
                    this._initFallback();
                    settle(); // resolve anyway; _call checks fallback
                }
            };
            worker.on('message', onMsg);

            // Watchdog: a worker that never reports must not leave every DB call
            // awaiting forever. Fall back to in-process after a timeout.
            const watchdog = setTimeout(() => {
                if (settled || this._closed) return;
                worker.off('message', onMsg);
                console.error(`[db-proxy] worker did not become ready within ${READY_TIMEOUT_MS}ms, using in-process fallback`);
                this._terminateWorker(worker);
                this._initFallback();
                settle();
            }, READY_TIMEOUT_MS);
        });

        worker.on('message', (msg) => {
            if (msg.type === 'result' || msg.type === 'error') {
                const entry = this._pending.get(msg.id);
                if (!entry) return;
                this._pending.delete(msg.id);
                if (msg.type === 'result') entry.resolve(msg.data);
                else entry.reject(new Error(msg.error));
            }
        });
        worker.on('error', (err) => {
            if (this._worker !== worker) return; // superseded by a respawn
            console.error('[db-worker] error:', err);
            for (const [, entry] of this._pending) entry.reject(err);
            this._pending.clear();
            if (!this._fallbackDb) {
                console.warn('[db-proxy] switching to in-process fallback after worker error');
                this._initFallback();
            }
        });
        worker.on('exit', (code) => {
            if (this._worker !== worker) return; // superseded by a respawn
            if (!this._closed && code !== 0) {
                console.warn('[db-worker] exited unexpectedly code=' + code);
                if (!this._fallbackDb) this._initFallback();
            }
            for (const [, entry] of this._pending) entry.reject(new Error('db worker exited'));
            this._pending.clear();
        });

        worker.postMessage({ type: 'init', dbPath });
    }

    _terminateWorker(worker) {
        if (!worker) return;
        if (this._worker === worker) this._worker = null;
        try { worker.removeAllListeners(); } catch {}
        try { worker.terminate(); } catch {}
    }

    _initFallback() {
        try {
            const AppDatabase = require('./database');
            this._fallbackDb = new AppDatabase(this._dbPath);
            console.log('[db-proxy] in-process fallback ready');
        } catch (err) {
            if (!this._recoveryAttempted && isCorruptionError(err.message)) {
                this._recoveryAttempted = true;
                console.error('[db-proxy] database is corrupt, moving it aside and starting fresh:', err.message);
                this._lastRecovery = quarantineDatabase(this._dbPath);
                return this._initFallback();
            }
            console.error('[db-proxy] fallback AppDatabase also failed:', err);
        }
    }

    async _call(method, args) {
        if (this._closed) throw new Error('database closed');
        // If we already fell back, call sync
        if (this._fallbackDb) {
            if (typeof this._fallbackDb[method] !== 'function') {
                throw new Error(`unknown method: ${method}`);
            }
            return this._fallbackDb[method].apply(this._fallbackDb, args || []);
        }
        if (this._readyPromise) await this._readyPromise;
        // Worker may have switched to fallback while we awaited
        if (this._fallbackDb) {
            return this._fallbackDb[method].apply(this._fallbackDb, args || []);
        }
        if (!this._worker) throw new Error('database unavailable');
        const id = ++this._nextId;
        return new Promise((resolve, reject) => {
            this._pending.set(id, { resolve, reject });
            try {
                this._worker.postMessage({ type: 'call', id, method, args });
            } catch (err) {
                this._pending.delete(id);
                reject(err);
            }
        });
    }

    /** Wait for the worker to finish loading the database. */
    ready() { return this._readyPromise; }

    /** Path the corrupt database was moved to during this session, if any. */
    recoveredFrom() { return this._lastRecovery; }

    /** Close the database + kill the worker. */
    close() {
        if (this._closed) return;
        this._closed = true;
        if (this._fallbackDb) {
            try { this._fallbackDb.close(); } catch {}
            this._fallbackDb = null;
        }
        if (this._worker) {
            const worker = this._worker;
            try { worker.postMessage({ type: 'close' }); } catch {}
            setTimeout(() => { try { worker.terminate(); } catch {} }, 200);
        }
    }
}

module.exports = DatabaseProxy;
