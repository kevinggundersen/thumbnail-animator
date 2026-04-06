/**
 * Tests for database-proxy.js
 *
 * Strategy: intercept require() for worker_threads and ./database
 * before loading database-proxy, providing mock implementations.
 */

const EventEmitter = require('events');
const Module = require('module');

// ── State shared between mock and tests ──────────────────────────────────────

let mockWorkerInstance = null;
const mockDbMethods = {};

// ── Intercept require() for worker_threads + database ────────────────────────

const _origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
    // Already handled by setup-db-alias.js for better-sqlite3
    return _origResolve.call(this, request, parent, ...rest);
};

// Build mock worker_threads module
class MockWorker extends EventEmitter {
    constructor() {
        super();
        mockWorkerInstance = this;
        this.postMessage = vi.fn();
        this.terminate = vi.fn();
    }
}

// Inject mocks into require cache
const workerThreadsPath = require.resolve('worker_threads');
require.cache[workerThreadsPath] = {
    id: workerThreadsPath,
    filename: workerThreadsPath,
    loaded: true,
    exports: { Worker: MockWorker },
};

// Mock database.js (for fallback path)
const path = require('path');
const databasePath = path.resolve(__dirname, '..', 'database.js');
require.cache[databasePath] = {
    id: databasePath,
    filename: databasePath,
    loaded: true,
    exports: function FakeAppDatabase() {
        Object.assign(this, mockDbMethods);
    },
};

// Suppress console noise
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

// ── Import DatabaseProxy (uses our mocked modules) ───────────────────────────

// Clear cached database-proxy so it re-requires with our mocks
const dbProxyPath = path.resolve(__dirname, '..', 'database-proxy.js');
delete require.cache[dbProxyPath];
const DatabaseProxy = require('../database-proxy');

// ── Helpers ──────────────────────────────────────────────────────────────────

function workerReady() {
    mockWorkerInstance.emit('message', { type: 'ready' });
}

function workerRespond(id, data) {
    mockWorkerInstance.emit('message', { type: 'result', id, data });
}

function workerError(id, error) {
    mockWorkerInstance.emit('message', { type: 'error', id, error });
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
    mockWorkerInstance = null;
    // Re-initialize mock db methods
    mockDbMethods.close = vi.fn();
    mockDbMethods.getAllRatings = vi.fn(() => ({ '/test/a.png': 5 }));
    mockDbMethods.setRating = vi.fn();
    mockDbMethods.getMeta = vi.fn(() => null);
    mockDbMethods.setMeta = vi.fn();
});

// ═══════════════════════════════════════════════════════════════════════════
// CONSTRUCTOR AND INIT
// ═══════════════════════════════════════════════════════════════════════════

describe('DatabaseProxy — constructor and init', () => {
    it('sends init message with dbPath to worker', () => {
        const proxy = new DatabaseProxy('/tmp/test.db');
        expect(mockWorkerInstance).not.toBeNull();
        expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith({
            type: 'init',
            dbPath: '/tmp/test.db',
        });
        proxy.close();
    });

    it('ready() resolves when worker sends ready message', async () => {
        const proxy = new DatabaseProxy('/tmp/test.db');
        const readyPromise = proxy.ready();
        workerReady();
        await readyPromise;
        proxy.close();
    });

    it('uses in-process fallback when worker sends init-error', async () => {
        const proxy = new DatabaseProxy('/tmp/test.db');
        mockWorkerInstance.emit('message', { type: 'init-error', error: 'init failed' });
        await proxy.ready();

        const result = await proxy.getAllRatings();
        expect(mockDbMethods.getAllRatings).toHaveBeenCalled();
        expect(result).toEqual({ '/test/a.png': 5 });
        proxy.close();
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// RPC CALLS
// ═══════════════════════════════════════════════════════════════════════════

describe('DatabaseProxy — RPC calls', () => {
    let proxy;

    beforeEach(async () => {
        proxy = new DatabaseProxy('/tmp/test.db');
        workerReady();
        await proxy.ready();
        mockWorkerInstance.postMessage.mockClear();
    });

    afterEach(() => {
        proxy.close();
    });

    // _call is async (awaits readyPromise) so we need to yield before checking postMessage
    const tick = () => new Promise(r => setTimeout(r, 0));

    it('forwards method calls to worker via postMessage', async () => {
        const promise = proxy.getAllRatings();
        await tick();
        expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith({
            type: 'call',
            id: expect.any(Number),
            method: 'getAllRatings',
            args: [],
        });
        const callId = mockWorkerInstance.postMessage.mock.calls[0][0].id;
        workerRespond(callId, { '/a.png': 3 });
        expect(await promise).toEqual({ '/a.png': 3 });
    });

    it('resolves promise when worker returns result', async () => {
        const promise = proxy.getMeta('version');
        await tick();
        const callId = mockWorkerInstance.postMessage.mock.calls[0][0].id;
        workerRespond(callId, '1.0');
        expect(await promise).toBe('1.0');
    });

    it('rejects promise when worker returns error', async () => {
        const promise = proxy.getMeta('version');
        await tick();
        const callId = mockWorkerInstance.postMessage.mock.calls[0][0].id;
        workerError(callId, 'DB corrupt');
        await expect(promise).rejects.toThrow('DB corrupt');
    });

    it('handles concurrent calls with different IDs', async () => {
        const p1 = proxy.getMeta('a');
        const p2 = proxy.getMeta('b');
        await tick();
        const id1 = mockWorkerInstance.postMessage.mock.calls[0][0].id;
        const id2 = mockWorkerInstance.postMessage.mock.calls[1][0].id;
        expect(id1).not.toBe(id2);

        workerRespond(id2, 'val_b');
        workerRespond(id1, 'val_a');
        expect(await p1).toBe('val_a');
        expect(await p2).toBe('val_b');
    });

    it('passes arguments to worker', async () => {
        const promise = proxy.setRating('/test.png', 5);
        await tick();
        expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ method: 'setRating', args: ['/test.png', 5] })
        );
        const callId = mockWorkerInstance.postMessage.mock.calls[0][0].id;
        workerRespond(callId, null);
        await promise;
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// PROXY BEHAVIOR
// ═══════════════════════════════════════════════════════════════════════════

describe('DatabaseProxy — Proxy behavior', () => {
    let proxy;

    beforeEach(async () => {
        proxy = new DatabaseProxy('/tmp/test.db');
        workerReady();
        await proxy.ready();
    });

    afterEach(() => {
        proxy.close();
    });

    it('returns async function for any property access', () => {
        expect(typeof proxy.someArbitraryMethod).toBe('function');
    });

    it('returns undefined for then/catch/finally (Promise duck-typing guard)', () => {
        expect(proxy.then).toBeUndefined();
        expect(proxy.catch).toBeUndefined();
        expect(proxy.finally).toBeUndefined();
    });

    it('returns undefined for symbol properties', () => {
        expect(proxy[Symbol.toPrimitive]).toBeUndefined();
    });

    it('returns real methods for known properties', () => {
        expect(typeof proxy.close).toBe('function');
        expect(typeof proxy.ready).toBe('function');
    });

    it('returns undefined for _private properties', () => {
        expect(proxy._somePrivate).toBeUndefined();
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// WORKER CRASH FALLBACK
// ═══════════════════════════════════════════════════════════════════════════

describe('DatabaseProxy — worker crash fallback', () => {
    it('switches to fallback when worker emits error', async () => {
        const proxy = new DatabaseProxy('/tmp/test.db');
        workerReady();
        await proxy.ready();

        mockWorkerInstance.emit('error', new Error('worker crashed'));

        const result = await proxy.getAllRatings();
        expect(mockDbMethods.getAllRatings).toHaveBeenCalled();
        proxy.close();
    });

    it('rejects all pending calls on worker error', async () => {
        const proxy = new DatabaseProxy('/tmp/test.db');
        workerReady();
        await proxy.ready();

        const promise = proxy.getMeta('key');
        await new Promise(r => setTimeout(r, 0)); // let _call post the message
        mockWorkerInstance.emit('error', new Error('boom'));
        await expect(promise).rejects.toThrow('boom');
        proxy.close();
    });

    it('switches to fallback when worker exits with non-zero code', async () => {
        const proxy = new DatabaseProxy('/tmp/test.db');
        workerReady();
        await proxy.ready();

        mockWorkerInstance.emit('exit', 1);

        const result = await proxy.getAllRatings();
        expect(mockDbMethods.getAllRatings).toHaveBeenCalled();
        proxy.close();
    });

    it('fallback throws for unknown methods', async () => {
        const proxy = new DatabaseProxy('/tmp/test.db');
        mockWorkerInstance.emit('message', { type: 'init-error', error: 'fail' });
        await proxy.ready();

        await expect(proxy.nonExistentMethod()).rejects.toThrow('unknown method');
        proxy.close();
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// CLOSE
// ═══════════════════════════════════════════════════════════════════════════

describe('DatabaseProxy — close', () => {
    it('sends close message to worker', async () => {
        const proxy = new DatabaseProxy('/tmp/test.db');
        workerReady();
        await proxy.ready();
        mockWorkerInstance.postMessage.mockClear();

        proxy.close();
        expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith({ type: 'close' });
    });

    it('close is idempotent', async () => {
        const proxy = new DatabaseProxy('/tmp/test.db');
        workerReady();
        await proxy.ready();

        proxy.close();
        proxy.close(); // should not throw
    });

    it('rejects calls after close', async () => {
        const proxy = new DatabaseProxy('/tmp/test.db');
        workerReady();
        await proxy.ready();
        proxy.close();

        await expect(proxy.getMeta('key')).rejects.toThrow('database closed');
    });

    it('closes fallback DB if in fallback mode', async () => {
        const proxy = new DatabaseProxy('/tmp/test.db');
        mockWorkerInstance.emit('message', { type: 'init-error', error: 'fail' });
        await proxy.ready();

        proxy.close();
        expect(mockDbMethods.close).toHaveBeenCalled();
    });
});
