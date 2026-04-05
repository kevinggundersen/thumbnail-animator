/**
 * Database Worker Thread
 *
 * Loads the AppDatabase (better-sqlite3 synchronous) in a dedicated worker so
 * all SQL work happens off the main Electron process. The main process is a
 * thin async proxy that forwards calls to this worker.
 *
 * Message protocol:
 *   parent -> worker: { type: 'init', dbPath }
 *                     { type: 'call', id, method, args }
 *                     { type: 'close' }
 *   worker -> parent: { type: 'ready' }
 *                     { type: 'init-error', error }
 *                     { type: 'result', id, data }
 *                     { type: 'error', id, error }
 */

'use strict';

const { parentPort } = require('worker_threads');

let db = null;

parentPort.on('message', (msg) => {
    if (!msg || !msg.type) return;

    switch (msg.type) {
        case 'init': {
            try {
                const AppDatabase = require('./database.js');
                db = new AppDatabase(msg.dbPath);
                parentPort.postMessage({ type: 'ready' });
            } catch (err) {
                parentPort.postMessage({
                    type: 'init-error',
                    error: err && err.message ? err.message : String(err)
                });
            }
            break;
        }
        case 'call': {
            const { id, method, args } = msg;
            try {
                if (!db) throw new Error('database not initialized');
                if (typeof db[method] !== 'function') {
                    throw new Error(`unknown method: ${method}`);
                }
                const data = db[method].apply(db, args || []);
                parentPort.postMessage({ type: 'result', id, data });
            } catch (err) {
                parentPort.postMessage({
                    type: 'error',
                    id,
                    error: err && err.message ? err.message : String(err)
                });
            }
            break;
        }
        case 'close': {
            try { if (db && db.close) db.close(); } catch {}
            db = null;
            process.exit(0);
            break;
        }
    }
});
