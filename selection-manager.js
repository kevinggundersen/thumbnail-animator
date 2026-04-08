// ═══════════════════════════════════════════════════════════════════════════
// SELECTION MANAGER
// Extracted from renderer.js.  Owns multi-select state (selectedCardPaths),
// shift-click range selection, and marquee drag-to-select.
//
// The internal Set is NEVER reassigned — always mutated in place so that the
// backward-compat alias `const selectedCardPaths = selection.paths` stays
// valid for the lifetime of the app.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

class SelectionManager {
    /**
     * @param {Object} opts
     * @param {HTMLElement} opts.gridContainer  The grid container element
     * @param {Function}   opts.getVsState      Returns the live vsState object
     * @param {Function}   opts.onSelectionChange  Called after every mutation
     */
    constructor({ gridContainer, getVsState, onSelectionChange }) {
        this._gridContainer = gridContainer;
        this._getVsState = getVsState;
        this._onSelectionChange = onSelectionChange || (() => {});
        this._paths = new Set();
        this._lastIndex = -1;
        this._statusBarEl = null; // lazily resolved

        this._marquee = {
            active: false,
            pending: false,
            startClientX: 0,
            startClientY: 0,
            startContentX: 0,
            startContentY: 0,
            element: null,
            ctrlHeld: false,
            preSelection: null,
            rafId: null,
            justFinished: false,
            autoScrollId: null,
        };

        // Bind event handlers so they can be added/removed from document
        this._boundOnMouseMove = (e) => this._onMouseMove(e);
        this._boundOnMouseUp = (e) => this._onMouseUp(e);
    }

    // ── Read access ───────────────────────────────────────────────────

    /** The live Set — backward-compat alias uses this reference directly. */
    get paths()     { return this._paths; }
    get size()      { return this._paths.size; }
    get lastIndex() { return this._lastIndex; }
    has(path)       { return this._paths.has(path); }
    toArray()       { return Array.from(this._paths); }

    // ── Mutations ─────────────────────────────────────────────────────

    clear() {
        if (this._paths.size === 0) return;
        this._paths.clear();
        this._lastIndex = -1;
        // Skip DOM query when canvas grid is active (no DOM cards exist)
        if (!(window.CG && window.CG.isEnabled())) {
            document.querySelectorAll('.video-card.selected').forEach(c => c.classList.remove('selected'));
        }
        this._updateStatusBar();
        this._onSelectionChange();
    }

    selectAll() {
        const vs = this._getVsState();
        this._paths.clear();
        let lastIndex = -1;
        for (let i = 0; i < vs.sortedItems.length; i++) {
            const item = vs.sortedItems[i];
            if (!item || item.type === 'folder' || item.type === 'group-header') continue;
            if (!item.path) continue;
            this._paths.add(item.path);
            lastIndex = i;
        }
        this._lastIndex = lastIndex;
        vs.activeCards.forEach((card) => {
            if (card.dataset.path && this._paths.has(card.dataset.path)) {
                card.classList.add('selected');
            }
        });
        this._updateStatusBar();
        this._onSelectionChange();
    }

    /**
     * Toggle a card's selection.
     * @param {HTMLElement|string} cardOrPath  Card element or file path
     * @param {number} itemIndex  Index into vsState.sortedItems
     */
    toggle(cardOrPath, itemIndex) {
        let path, card;
        if (typeof cardOrPath === 'string') {
            path = cardOrPath;
            card = null;
        } else {
            card = cardOrPath;
            path = card.dataset.path;
        }
        if (!path) return;
        if (this._paths.has(path)) {
            this._paths.delete(path);
            if (card) card.classList.remove('selected');
        } else {
            this._paths.add(path);
            if (card) card.classList.add('selected');
        }
        this._lastIndex = itemIndex;
        this._updateStatusBar();
        this._onSelectionChange();
    }

    /**
     * Range-select between two indices (inclusive).
     */
    range(fromIndex, toIndex) {
        const vs = this._getVsState();
        const lo = Math.min(fromIndex, toIndex);
        const hi = Math.max(fromIndex, toIndex);
        for (let i = lo; i <= hi; i++) {
            const item = vs.sortedItems[i];
            if (!item || item.type === 'folder') continue;
            this._paths.add(item.path);
        }
        vs.activeCards.forEach((card) => {
            if (card.dataset.path && this._paths.has(card.dataset.path)) {
                card.classList.add('selected');
            }
        });
        this._lastIndex = toIndex;
        this._updateStatusBar();
        this._onSelectionChange();
    }

    /**
     * Clear + select a single path (for canvas-grid 'none' modifier click).
     */
    set(path, itemIndex) {
        this._paths.clear();
        this._paths.add(path);
        this._lastIndex = itemIndex;
        this._updateStatusBar();
        this._onSelectionChange();
    }

    /**
     * Add a single path without clearing (for context-menu right-click).
     */
    addPath(path, itemIndex) {
        this._paths.add(path);
        if (itemIndex !== undefined) this._lastIndex = itemIndex;
        this._updateStatusBar();
        this._onSelectionChange();
    }

    // ── Marquee (drag-to-select) ──────────────────────────────────────

    get marqueeActive()       { return this._marquee.active; }
    get marqueePending()      { return this._marquee.pending; }
    get marqueeJustFinished() { return this._marquee.justFinished; }
    set marqueeJustFinished(v){ this._marquee.justFinished = v; }

    /**
     * Initiate marquee from a mousedown event on empty grid space.
     * Caller should have already checked it's a left-click on empty space.
     */
    startMarquee(e) {
        const m = this._marquee;
        m.ctrlHeld = e.ctrlKey || e.metaKey;
        if (m.ctrlHeld) {
            m.preSelection = new Set(this._paths);
        } else {
            this.clear();
        }
        m.startClientX = e.clientX;
        m.startClientY = e.clientY;
        const content = this._clientToContent(e.clientX, e.clientY);
        m.startContentX = content.x;
        m.startContentY = content.y;
        m.pending = true;
        document.addEventListener('mousemove', this._boundOnMouseMove);
        document.addEventListener('mouseup', this._boundOnMouseUp);
        e.preventDefault();
    }

    cancelMarquee() {
        const m = this._marquee;
        if (!m.active && !m.pending) return;
        document.removeEventListener('mousemove', this._boundOnMouseMove);
        document.removeEventListener('mouseup', this._boundOnMouseUp);
        this._stopAutoScroll();
        if (m.rafId) { cancelAnimationFrame(m.rafId); m.rafId = null; }
        if (m.element && m.element.parentNode) m.element.remove();
        m.element = null;
        this._gridContainer.classList.remove('marquee-dragging');
        // Restore pre-selection if Ctrl was held
        if (m.ctrlHeld && m.preSelection) {
            this._paths.clear();
            for (const p of m.preSelection) this._paths.add(p);
            const vs = this._getVsState();
            vs.activeCards.forEach((card) => {
                if (card.dataset.path) {
                    card.classList.toggle('selected', this._paths.has(card.dataset.path));
                }
            });
            this._updateStatusBar();
            this._onSelectionChange();
        }
        m.active = false;
        m.pending = false;
        m.preSelection = null;
    }

    // ── Item index lookup ─────────────────────────────────────────────

    _getItemIndex(cardOrPath) {
        const path = typeof cardOrPath === 'string' ? cardOrPath : cardOrPath.dataset.path;
        if (!path) return -1;
        const vs = this._getVsState();
        return vs.sortedItems.findIndex(item => item.path === path);
    }

    // ── Status bar ────────────────────────────────────────────────────

    _updateStatusBar() {
        const count = this._paths.size;
        if (!this._statusBarEl) {
            this._statusBarEl = document.getElementById('status-selection-count');
        }
        const el = this._statusBarEl;
        if (el) {
            el.textContent = count > 0 ? `${count} selected` : '';
        }
    }

    // ── Marquee internals ─────────────────────────────────────────────

    _clientToContent(clientX, clientY) {
        const rect = this._gridContainer.getBoundingClientRect();
        return {
            x: clientX - rect.left,
            y: clientY - rect.top + this._gridContainer.scrollTop
        };
    }

    _getRect(cx, cy) {
        const m = this._marquee;
        const cur = this._clientToContent(cx, cy);
        const x1 = Math.min(m.startContentX, cur.x);
        const y1 = Math.min(m.startContentY, cur.y);
        const x2 = Math.max(m.startContentX, cur.x);
        const y2 = Math.max(m.startContentY, cur.y);
        return { left: x1, top: y1, right: x2, bottom: y2 };
    }

    _updateRect(clientX, clientY) {
        const m = this._marquee;
        if (!m.element) return;
        const cur = this._clientToContent(clientX, clientY);
        const x1 = Math.min(m.startContentX, cur.x);
        const y1 = Math.min(m.startContentY, cur.y);
        const x2 = Math.max(m.startContentX, cur.x);
        const y2 = Math.max(m.startContentY, cur.y);
        m.element.style.left = x1 + 'px';
        m.element.style.top = y1 + 'px';
        m.element.style.width = (x2 - x1) + 'px';
        m.element.style.height = (y2 - y1) + 'px';
    }

    _computeSelection(clientX, clientY) {
        const vs = this._getVsState();
        if (!vs.positions || !vs.sortedItems.length) return;
        const sel = this._getRect(clientX, clientY);
        const itemCount = vs.sortedItems.length;
        const m = this._marquee;

        // Rebuild selection
        this._paths.clear();
        if (m.ctrlHeld && m.preSelection) {
            for (const p of m.preSelection) this._paths.add(p);
        }

        // Binary search for first item whose bottom edge >= sel.top
        let lo = 0, hi = itemCount - 1;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            const midIdx = mid * 4;
            if (vs.positions[midIdx + 1] + vs.positions[midIdx + 3] < sel.top) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }

        for (let i = lo; i < itemCount; i++) {
            const idx = i * 4;
            const cT = vs.positions[idx + 1];
            if (cT > sel.bottom) break;

            const item = vs.sortedItems[i];
            if (!item.path || item.type === 'folder' || item.type === 'group-header') continue;
            const cL = vs.positions[idx];
            const cR = cL + vs.positions[idx + 2];
            const cB = cT + vs.positions[idx + 3];
            if (!(sel.right < cL || sel.left > cR || sel.bottom < cT || sel.top > cB)) {
                this._paths.add(item.path);
            }
        }
        // Update visible card DOM
        vs.activeCards.forEach((card) => {
            if (card.dataset.path) {
                card.classList.toggle('selected', this._paths.has(card.dataset.path));
            }
        });
        this._updateStatusBar();
        this._onSelectionChange();
    }

    _startAutoScroll(clientY) {
        const m = this._marquee;
        if (m.autoScrollId) return;
        const EDGE = 50, MAX_SPEED = 15;
        const gc = this._gridContainer;
        const step = () => {
            if (!m.active) { m.autoScrollId = null; return; }
            const rect = gc.getBoundingClientRect();
            let speed = 0;
            if (clientY < rect.top + EDGE) {
                speed = -MAX_SPEED * (1 - Math.max(0, clientY - rect.top) / EDGE);
            } else if (clientY > rect.bottom - EDGE) {
                speed = MAX_SPEED * (1 - Math.max(0, rect.bottom - clientY) / EDGE);
            }
            if (Math.abs(speed) > 0.5) {
                gc.scrollTop += speed;
            }
            m.autoScrollId = requestAnimationFrame(step);
        };
        m.autoScrollId = requestAnimationFrame(step);
    }

    _stopAutoScroll() {
        const m = this._marquee;
        if (m.autoScrollId) {
            cancelAnimationFrame(m.autoScrollId);
            m.autoScrollId = null;
        }
    }

    _onMouseMove(e) {
        const m = this._marquee;
        if (!m.pending && !m.active) return;
        const dx = e.clientX - m.startClientX;
        const dy = e.clientY - m.startClientY;

        if (m.pending) {
            if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return; // dead zone
            m.pending = false;
            m.active = true;
            this._gridContainer.classList.add('marquee-dragging');
            m.element = document.createElement('div');
            m.element.className = 'marquee-selection-rect';
            this._gridContainer.appendChild(m.element);
        }

        this._updateRect(e.clientX, e.clientY);

        // Auto-scroll near edges
        this._stopAutoScroll();
        const containerRect = this._gridContainer.getBoundingClientRect();
        if (e.clientY < containerRect.top + 50 || e.clientY > containerRect.bottom - 50) {
            this._startAutoScroll(e.clientY);
        }

        // Throttle intersection via rAF
        if (!m.rafId) {
            const cx = e.clientX, cy = e.clientY;
            m.rafId = requestAnimationFrame(() => {
                m.rafId = null;
                if (m.active) this._computeSelection(cx, cy);
            });
        }
    }

    _onMouseUp(e) {
        const m = this._marquee;
        document.removeEventListener('mousemove', this._boundOnMouseMove);
        document.removeEventListener('mouseup', this._boundOnMouseUp);
        this._stopAutoScroll();

        if (m.active) {
            this._computeSelection(e.clientX, e.clientY);
            if (m.element && m.element.parentNode) {
                m.element.remove();
            }
            m.element = null;
            this._gridContainer.classList.remove('marquee-dragging');
            m.active = false;
            if (m.rafId) { cancelAnimationFrame(m.rafId); m.rafId = null; }
            m.justFinished = true;
            requestAnimationFrame(() => { m.justFinished = false; });
        }
        m.pending = false;
        m.preSelection = null;
    }
}

// Export class to global scope
window.SelectionManager = SelectionManager;
