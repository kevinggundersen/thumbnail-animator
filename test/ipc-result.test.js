const { ipcOk, ipcErr, unwrapIpc, stripKey } = require('../ipc-result');

// ── ipcOk ─────────────────────────────────────────────────────────────

describe('ipcOk', () => {
    it('wraps a value in { ok: true, value }', () => {
        expect(ipcOk(42)).toEqual({ ok: true, value: 42 });
    });

    it('wraps null', () => {
        expect(ipcOk(null)).toEqual({ ok: true, value: null });
    });

    it('wraps an array', () => {
        expect(ipcOk([1, 2])).toEqual({ ok: true, value: [1, 2] });
    });
});

// ── ipcErr ────────────────────────────────────────────────────────────

describe('ipcErr', () => {
    it('wraps a string error', () => {
        expect(ipcErr('boom')).toEqual({ ok: false, error: 'boom' });
    });

    it('extracts .message from an Error object', () => {
        expect(ipcErr(new Error('fail'))).toEqual({ ok: false, error: 'fail' });
    });

    it('falls back to "unknown error" for null', () => {
        expect(ipcErr(null)).toEqual({ ok: false, error: 'unknown error' });
    });

    it('falls back to "unknown error" for undefined', () => {
        expect(ipcErr(undefined)).toEqual({ ok: false, error: 'unknown error' });
    });

    it('stringifies non-string, non-Error values', () => {
        expect(ipcErr(123)).toEqual({ ok: false, error: '123' });
    });
});

// ── stripKey ──────────────────────────────────────────────────────────

describe('stripKey', () => {
    it('removes the specified key and returns the rest', () => {
        expect(stripKey({ a: 1, b: 2, c: 3 }, 'b')).toEqual({ a: 1, c: 3 });
    });

    it('returns empty object when only the stripped key exists', () => {
        expect(stripKey({ ok: true }, 'ok')).toEqual({});
    });
});

// ── unwrapIpc ─────────────────────────────────────────────────────────

describe('unwrapIpc', () => {
    // -- Target shape pass-through --

    it('passes through { ok: true, value }', async () => {
        const result = await unwrapIpc({ ok: true, value: 'data' });
        expect(result).toEqual({ ok: true, value: 'data' });
    });

    it('passes through { ok: false, error: string }', async () => {
        const result = await unwrapIpc({ ok: false, error: 'bad' });
        expect(result).toEqual({ ok: false, error: 'bad' });
    });

    // -- Legacy { ok: true } without value key --

    it('wraps remaining fields when { ok: true } has no value key', async () => {
        const result = await unwrapIpc({ ok: true, count: 5, name: 'x' });
        expect(result).toEqual({ ok: true, value: { count: 5, name: 'x' } });
    });

    // -- { ok: false } with non-string error --

    it('normalizes non-string error in { ok: false }', async () => {
        const result = await unwrapIpc({ ok: false, error: new Error('oops') });
        expect(result).toEqual({ ok: false, error: 'oops' });
    });

    // -- Legacy { success } shape --

    it('converts { success: true, data } to ok shape', async () => {
        const result = await unwrapIpc({ success: true, data: [1, 2, 3] });
        expect(result).toEqual({ ok: true, value: [1, 2, 3] });
    });

    it('converts { success: true, ...fields } without data key', async () => {
        const result = await unwrapIpc({ success: true, count: 7 });
        expect(result).toEqual({ ok: true, value: { count: 7 } });
    });

    it('converts { success: false, error }', async () => {
        const result = await unwrapIpc({ success: false, error: 'nope' });
        expect(result).toEqual({ ok: false, error: 'nope' });
    });

    it('uses "unknown error" for { success: false } without error', async () => {
        const result = await unwrapIpc({ success: false });
        expect(result).toEqual({ ok: false, error: 'unknown error' });
    });

    // -- Orphaned error --

    it('handles { error: "..." } without ok or success', async () => {
        const result = await unwrapIpc({ error: 'orphan' });
        expect(result).toEqual({ ok: false, error: 'orphan' });
    });

    // -- Plain values --

    it('wraps a plain object (no status keys) as value', async () => {
        const result = await unwrapIpc({ foo: 'bar' });
        expect(result).toEqual({ ok: true, value: { foo: 'bar' } });
    });

    it('wraps an array as value', async () => {
        const result = await unwrapIpc([1, 2, 3]);
        expect(result).toEqual({ ok: true, value: [1, 2, 3] });
    });

    it('wraps a primitive as value', async () => {
        const result = await unwrapIpc(42);
        expect(result).toEqual({ ok: true, value: 42 });
    });

    // -- Null / undefined --

    it('returns error for null response', async () => {
        const result = await unwrapIpc(null);
        expect(result).toEqual({ ok: false, error: 'no response' });
    });

    // -- Promise handling --

    it('resolves a Promise before normalizing', async () => {
        const result = await unwrapIpc(Promise.resolve({ ok: true, value: 'async' }));
        expect(result).toEqual({ ok: true, value: 'async' });
    });

    it('catches a rejected Promise and returns error', async () => {
        const result = await unwrapIpc(Promise.reject(new Error('rejected')));
        expect(result).toEqual({ ok: false, error: 'rejected' });
    });
});
