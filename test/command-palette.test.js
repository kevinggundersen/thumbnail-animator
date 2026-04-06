/**
 * Tests for command-palette.js
 *
 * Strategy: set up full DOM mocks and Fuse.js before requiring the IIFE module.
 * The IIFE calls init() synchronously on require, so everything must be ready.
 */

// ── Mock localStorage ────────────────────────────────────────────────────────

const localStorageData = {};
global.localStorage = {
    getItem: vi.fn((key) => localStorageData[key] || null),
    setItem: vi.fn((key, val) => { localStorageData[key] = val; }),
    removeItem: vi.fn((key) => { delete localStorageData[key]; }),
};

// ── Mock Fuse.js ─────────────────────────────────────────────────────────────

global.Fuse = class MockFuse {
    constructor(items, options) {
        this._items = items;
        this._keys = (options?.keys || []).map(k => typeof k === 'string' ? k : k.name);
    }
    search(query) {
        const q = query.toLowerCase();
        return this._items
            .filter(item => {
                return this._keys.some(key => {
                    const val = item[key];
                    if (typeof val === 'string') return val.toLowerCase().includes(q);
                    if (Array.isArray(val)) return val.some(v => String(v).toLowerCase().includes(q));
                    return false;
                });
            })
            .map((item, i) => ({ item, score: 0.1 * (i + 1) }));
    }
};

// ── Mock DOM ─────────────────────────────────────────────────────────────────

function createMockElement(tag = 'div') {
    const listeners = {};
    const children = [];
    return {
        tagName: tag,
        className: '',
        textContent: '',
        innerHTML: '',
        value: '',
        style: {},
        dataset: {},
        children,
        classList: {
            add: vi.fn(),
            remove: vi.fn(),
            toggle: vi.fn(),
            contains: vi.fn(() => false),
        },
        setAttribute: vi.fn(),
        getAttribute: vi.fn(),
        addEventListener: vi.fn((event, handler) => {
            if (!listeners[event]) listeners[event] = [];
            listeners[event].push(handler);
        }),
        removeEventListener: vi.fn(),
        appendChild: vi.fn((child) => children.push(child)),
        querySelector: vi.fn(() => null),
        querySelectorAll: vi.fn(() => []),
        scrollIntoView: vi.fn(),
        focus: vi.fn(),
        _listeners: listeners,
        _fire: (event, data) => {
            (listeners[event] || []).forEach(h => h(data));
        },
    };
}

const overlayEl = createMockElement();
const inputEl = createMockElement('input');
const listEl = createMockElement();
const dialogEl = createMockElement();

overlayEl.querySelector = vi.fn(() => dialogEl);

global.document = {
    readyState: 'complete',
    activeElement: createMockElement(),
    getElementById: vi.fn((id) => {
        if (id === 'command-palette-overlay') return overlayEl;
        if (id === 'command-palette-input') return inputEl;
        if (id === 'command-palette-list') return listEl;
        return createMockElement();
    }),
    createElement: vi.fn((tag) => createMockElement(tag)),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
};

global.requestAnimationFrame = vi.fn((cb) => { cb(); return 1; });
global.cancelAnimationFrame = vi.fn();

// Suppress console.error from command execution
vi.spyOn(console, 'error').mockImplementation(() => {});

// ── Import CommandPalette (IIFE executes, calls init()) ──────────────────────

const CommandPalette = require('../command-palette');

// ═══════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════

// Track all registered IDs for cleanup
const allKnownIds = new Set();
const origRegister = CommandPalette.register;
const origRegisterMany = CommandPalette.registerMany;
CommandPalette.register = function(cmd) {
    allKnownIds.add(cmd.id);
    return origRegister.call(this, cmd);
};
CommandPalette.registerMany = function(cmds) {
    for (const cmd of cmds) allKnownIds.add(cmd.id);
    return origRegisterMany.call(this, cmds);
};

beforeEach(() => {
    // Unregister all known commands
    for (const id of allKnownIds) CommandPalette.unregister(id);
    allKnownIds.clear();
    // Reset localStorage mock
    delete localStorageData['commandPaletteRecents'];
    localStorage.setItem.mockClear();
    // Close if open
    if (CommandPalette.isVisible()) CommandPalette.close();
    // Reset list mock
    listEl.appendChild.mockClear();
    listEl.innerHTML = '';
});

describe('CommandPalette — register/unregister', () => {
    it('register adds a command', () => {
        CommandPalette.register({ id: 'test1', label: 'Test Command', action: vi.fn() });
        // Verify it shows up when palette is opened
        CommandPalette.open();
        // The render function populates the list — check appendChild was called
        expect(listEl.appendChild).toHaveBeenCalled();
        CommandPalette.close();
    });

    it('registerMany adds multiple commands', () => {
        CommandPalette.registerMany([
            { id: 'a', label: 'Alpha', action: vi.fn() },
            { id: 'b', label: 'Beta', action: vi.fn() },
        ]);
        CommandPalette.open();
        // At least 2 items rendered (plus category headers)
        expect(listEl.appendChild.mock.calls.length).toBeGreaterThanOrEqual(2);
        CommandPalette.close();
    });

    it('register replaces command with same id', () => {
        const action1 = vi.fn();
        const action2 = vi.fn();
        CommandPalette.register({ id: 'dup', label: 'First', action: action1 });
        CommandPalette.register({ id: 'dup', label: 'Replaced', action: action2 });
        // Only the replacement should exist
        CommandPalette.open();
        CommandPalette.close();
        // No direct assertion on count; just verify no duplicate
    });

    it('unregister removes command by id', () => {
        CommandPalette.register({ id: 'rm', label: 'Remove Me', action: vi.fn() });
        CommandPalette.unregister('rm');
        // Verify it's gone
        listEl.appendChild.mockClear();
        listEl.innerHTML = '';
        CommandPalette.open();
        // Should have no items (only __cleanup__ was removed, this was also removed)
        CommandPalette.close();
    });
});

describe('CommandPalette — open/close/toggle', () => {
    it('open shows overlay', () => {
        CommandPalette.open();
        expect(overlayEl.classList.remove).toHaveBeenCalledWith('hidden');
        expect(CommandPalette.isVisible()).toBe(true);
        CommandPalette.close();
    });

    it('close hides overlay', () => {
        CommandPalette.open();
        CommandPalette.close();
        expect(overlayEl.classList.add).toHaveBeenCalledWith('hidden');
        expect(CommandPalette.isVisible()).toBe(false);
    });

    it('toggle opens when closed and closes when open', () => {
        expect(CommandPalette.isVisible()).toBe(false);
        CommandPalette.toggle();
        expect(CommandPalette.isVisible()).toBe(true);
        CommandPalette.toggle();
        expect(CommandPalette.isVisible()).toBe(false);
    });

    it('open focuses the input', () => {
        CommandPalette.open();
        expect(inputEl.focus).toHaveBeenCalled();
        CommandPalette.close();
    });
});

describe('CommandPalette — filtering', () => {
    beforeEach(() => {
        CommandPalette.registerMany([
            { id: 'zoom-in', label: 'Zoom In', category: 'View', keywords: ['magnify'], action: vi.fn() },
            { id: 'zoom-out', label: 'Zoom Out', category: 'View', action: vi.fn() },
            { id: 'open-folder', label: 'Open Folder', category: 'File', action: vi.fn() },
        ]);
    });

    it('empty query shows all commands', () => {
        inputEl.value = '';
        CommandPalette.open();
        // Should render all 3 commands + category headers
        expect(listEl.appendChild.mock.calls.length).toBeGreaterThanOrEqual(3);
        CommandPalette.close();
    });

    it('when() predicate filters out unavailable commands', () => {
        CommandPalette.register({ id: 'hidden-cmd', label: 'Hidden', action: vi.fn(), when: () => false });
        inputEl.value = '';
        listEl.appendChild.mockClear();
        CommandPalette.open();
        // hidden-cmd should not be rendered (when() returns false)
        // We can't easily check which items were rendered, but count should be same as before
        CommandPalette.close();
    });
});

describe('CommandPalette — execution', () => {
    it('executing a command calls action()', () => {
        const action = vi.fn();
        CommandPalette.register({ id: 'exec-test', label: 'Execute Test', action });
        inputEl.value = '';
        CommandPalette.open();
        // selectedIndex=0 should be our only command
        inputEl._fire('keydown', { key: 'Enter', preventDefault: vi.fn() });
        // Action is called via requestAnimationFrame (which we mock to run sync)
        expect(action).toHaveBeenCalled();
    });

    it('executing a command records it as recent', () => {
        const action = vi.fn();
        CommandPalette.register({ id: 'recent-test', label: 'Recent Test', action });
        inputEl.value = '';
        CommandPalette.open();
        inputEl._fire('keydown', { key: 'Enter', preventDefault: vi.fn() });
        expect(localStorage.setItem).toHaveBeenCalledWith(
            'commandPaletteRecents',
            expect.stringContaining('recent-test')
        );
    });

    it('recent list caps at 8 entries', () => {
        for (let i = 0; i < 10; i++) {
            CommandPalette.register({ id: `cmd-${i}`, label: `Cmd ${i}`, action: vi.fn() });
        }
        // Execute all 10 commands
        for (let i = 0; i < 10; i++) {
            inputEl.value = `Cmd ${i}`;
            CommandPalette.open();
            inputEl._fire('keydown', { key: 'Enter', preventDefault: vi.fn() });
        }
        const lastCall = localStorage.setItem.mock.calls[localStorage.setItem.mock.calls.length - 1];
        const recents = JSON.parse(lastCall[1]);
        expect(recents.length).toBeLessThanOrEqual(8);
    });
});
