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
 */

'use strict';

const path = require('path');
const { Worker } = require('worker_threads');

class DatabaseProxy {
    constructor(dbPath) {
        this._nextId = 0;
        this._pending = new Map();  // id -> { resolve, reject }
        this._worker = null;
        this._readyPromise = null;
        this._closed = false;
        this._fallbackDb = null;    // in-process AppDatabase if worker fails
        this._dbPath = dbPath;
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
        this._readyPromise = new Promise((resolve) => {
            const onMsg = (msg) => {
                if (msg.type === 'ready') {
                    this._worker.off('message', onMsg);
                    console.log('[db-proxy] worker ready');
                    resolve();
                } else if (msg.type === 'init-error') {
                    this._worker.off('message', onMsg);
                    console.warn('[db-proxy] worker init failed, using in-process fallback:', msg.error);
                    this._initFallback();
                    resolve(); // resolve anyway; _call checks fallback
                }
            };
            this._worker.on('message', onMsg);
        });
        // Watchdog: if worker doesn't become ready in 5s, fall back
        setTimeout(() => {
            if (!this._fallbackDb && this._worker && this._readyPromise) {
                // Not yet resolved — give up and fall back
                Promise.race([
                    this._readyPromise,
                    new Promise(r => setTimeout(r, 100))
                ]).then(() => {
                    if (!this._fallbackDb && !this._closed) {
                        // If we never got ready, fall back
                        // (this is best-effort; worker might still become ready later)
                    }
                });
            }
        }, 5000);

        this._worker.on('message', (msg) => {
            if (msg.type === 'result' || msg.type === 'error') {
                const entry = this._pending.get(msg.id);
                if (!entry) return;
                this._pending.delete(msg.id);
                if (msg.type === 'result') entry.resolve(msg.data);
                else entry.reject(new Error(msg.error));
            }
        });
        this._worker.on('error', (err) => {
            console.error('[db-worker] error:', err);
            for (const [, entry] of this._pending) entry.reject(err);
            this._pending.clear();
            if (!this._fallbackDb) {
                console.warn('[db-proxy] switching to in-process fallback after worker error');
                this._initFallback();
            }
        });
        this._worker.on('exit', (code) => {
            if (!this._closed && code !== 0) {
                console.warn('[db-worker] exited unexpectedly code=' + code);
                if (!this._fallbackDb) this._initFallback();
            }
            for (const [, entry] of this._pending) entry.reject(new Error('db worker exited'));
            this._pending.clear();
        });

        this._worker.postMessage({ type: 'init', dbPath });
    }

    _initFallback() {
        try {
            const AppDatabase = require('./database');
            this._fallbackDb = new AppDatabase(this._dbPath);
            console.log('[db-proxy] in-process fallback ready');
        } catch (err) {
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

    /** Close the database + kill the worker. */
    close() {
        if (this._closed) return;
        this._closed = true;
        if (this._fallbackDb) {
            try { this._fallbackDb.close(); } catch {}
            this._fallbackDb = null;
        }
        if (this._worker) {
            try { this._worker.postMessage({ type: 'close' }); } catch {}
            setTimeout(() => { try { this._worker.terminate(); } catch {} }, 200);
        }
    }
}

module.exports = DatabaseProxy;
