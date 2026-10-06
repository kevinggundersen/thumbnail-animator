// settings.js reads localStorage and installs itself on window at load; give it both.
const fs = require('fs');
const path = require('path');

function makeStorage() {
    const m = new Map();
    return {
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => m.set(k, String(v)),
        removeItem: (k) => m.delete(k),
        clear: () => m.clear(),
        _map: m,
    };
}

let Settings, SETTINGS_SCHEMA;
beforeAll(() => {
    global.window = globalThis;
    global.localStorage = makeStorage();
    ({ Settings, SETTINGS_SCHEMA } = require('../settings'));
});

describe('SETTINGS_SCHEMA coverage', () => {
    it('declares every raw localStorage key the renderer scripts use', () => {
        const { rendererScripts } = require('../scripts/renderer-globals');
        const ROOT = path.join(__dirname, '..');
        const files = rendererScripts().filter(f => !/vendor|bundle|\.min\.|settings\.js$/.test(f));
        const used = new Set();
        for (const f of files) {
            const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
            for (const m of src.matchAll(/localStorage\.(?:getItem|setItem|removeItem)\(\s*'([^']+)'/g)) used.add(m[1]);
            for (const m of src.matchAll(/deferLocalStorageWrite\(\s*'([^']+)'/g)) used.add(m[1]);
        }
        const declared = new Set();
        for (const desc of Object.values(SETTINGS_SCHEMA)) {
            if (desc.storageKeys) Object.values(desc.storageKeys).forEach(k => declared.add(k));
            else declared.add(desc.storageKey);
        }
        const missing = [...used].filter(k => !declared.has(k)).sort();
        expect(missing).toEqual([]);
    });

    it('has a type and default for every entry', () => {
        for (const [name, desc] of Object.entries(SETTINGS_SCHEMA)) {
            expect(desc.type, name).toMatch(/^(int|float|bool|string|json|object)$/);
            expect(desc, name).toHaveProperty('default');
        }
    });
});

describe('Settings', () => {
    let s;
    beforeEach(() => {
        global.localStorage.clear();
        s = new Settings({
            n: { type: 'int', default: 3, storageKey: 'n' },
            f: { type: 'float', default: 0.5, storageKey: 'f' },
            b: { type: 'bool', default: true, storageKey: 'b' },
            j: { type: 'json', default: [], storageKey: 'j' },
            secret: { type: 'int', default: 0, storageKey: 'secret', export: false },
            pair: { type: 'object', default: { a: 1, b: false }, storageKeys: { a: 'pairA', b: 'pairB' } },
        });
    });

    it('hydrates typed values with defaults and parses floats', () => {
        expect(s.get('n')).toBe(3);
        expect(s.get('f')).toBe(0.5);
        global.localStorage.setItem('f', '0.15');
        global.localStorage.setItem('n', '7');
        s.hydrate();
        expect(s.get('f')).toBeCloseTo(0.15);
        expect(s.get('n')).toBe(7);
    });

    it('exportKeys groups keys by storage kind and leaves out export:false', () => {
        const k = s.exportKeys();
        expect(k.string.sort()).toEqual(['b', 'f', 'n', 'pairA', 'pairB']);
        expect(k.json).toEqual(['j']);
    });

    it('export skips machine-local keys', () => {
        s.set('secret', 42);
        s.set('n', 5);
        const out = s.export();
        expect(out).toHaveProperty('n', '5');
        expect(out).not.toHaveProperty('secret');
    });

    it('import parses floats and fires listeners', () => {
        const seen = [];
        s.on('f', (v) => seen.push(v));
        s.import({ f: '0.25' });
        expect(s.get('f')).toBeCloseTo(0.25);
        expect(seen).toEqual([0.25]);
    });

    it('onWrite fires for raw-key writes through _deferWrite', () => {
        const seen = [];
        const off = s.onWrite('zoomLevel', (v, k) => seen.push([k, v]));
        s._deferWrite('zoomLevel', '80');
        expect(seen).toEqual([['zoomLevel', '80']]);
        off();
        s._deferWrite('zoomLevel', '90');
        expect(seen).toHaveLength(1);
    });
});
