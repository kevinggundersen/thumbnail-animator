// ==================== COMMAND PALETTE ====================
// Ctrl+P to open -- fuzzy search across all app commands
const CommandPalette = (() => {
    let commands = [];
    let recentIds = JSON.parse(localStorage.getItem('commandPaletteRecents') || '[]');
    let isOpen = false;
    let selectedIndex = 0;
    let filtered = [];
    let previousFocus = null;

    // DOM refs
    let overlay, input, list, dialog;

    function init() {
        overlay = document.getElementById('command-palette-overlay');
        dialog = overlay.querySelector('.command-palette-dialog');
        input = document.getElementById('command-palette-input');
        list = document.getElementById('command-palette-list');

        overlay.addEventListener('mousedown', (e) => {
            if (e.target === overlay) close();
        });

        input.addEventListener('input', () => {
            selectedIndex = 0;
            render();
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                selectedIndex = Math.min(selectedIndex + 1, filtered.length - 1);
                updateSelection();
                scrollSelectedIntoView();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                selectedIndex = Math.max(selectedIndex - 1, 0);
                updateSelection();
                scrollSelectedIntoView();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                executeSelected();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                close();
            }
        });
    }

    // -- Fuzzy search --
    function fuzzyScore(query, text) {
        const q = query.toLowerCase();
        const t = text.toLowerCase();

        // Exact substring match (best)
        if (t.includes(q)) {
            return 100 + (q.length / t.length) * 50;
        }

        // Subsequence match
        let qi = 0;
        let score = 0;
        let lastMatchIdx = -1;
        for (let ti = 0; ti < t.length && qi < q.length; ti++) {
            if (t[ti] === q[qi]) {
                // Bonus for word boundary matches
                if (ti === 0 || t[ti - 1] === ' ' || t[ti - 1] === ':' || t[ti - 1] === '-') {
                    score += 10;
                } else {
                    score += 5;
                }
                // Bonus for consecutive matches
                if (lastMatchIdx === ti - 1) score += 3;
                lastMatchIdx = ti;
                qi++;
            }
        }

        // All query chars matched?
        if (qi < q.length) return -1;
        return score;
    }

    function getFiltered() {
        const query = input.value.trim();
        let results;

        if (!query) {
            // Show recents first, then all commands
            const recentCmds = recentIds
                .map(id => commands.find(c => c.id === id))
                .filter(Boolean)
                .filter(c => !c.when || c.when());
            const rest = commands
                .filter(c => !recentIds.includes(c.id) && (!c.when || c.when()));
            results = [
                ...recentCmds.map(c => ({ cmd: c, score: 1000, isRecent: true })),
                ...rest.map(c => ({ cmd: c, score: 0, isRecent: false }))
            ];
        } else {
            results = [];
            for (const cmd of commands) {
                if (cmd.when && !cmd.when()) continue;
                const searchStr = cmd.label + ' ' + (cmd.keywords || []).join(' ') + ' ' + (cmd.category || '');
                const score = fuzzyScore(query, searchStr);
                if (score > 0) {
                    results.push({ cmd, score, isRecent: recentIds.includes(cmd.id) });
                }
            }
            // Recently used commands get a bonus
            results.forEach(r => { if (r.isRecent) r.score += 20; });
            results.sort((a, b) => b.score - a.score);
        }

        return results;
    }

    function render() {
        filtered = getFiltered();
        list.innerHTML = '';

        if (filtered.length === 0) {
            list.innerHTML = '<div class="command-palette-empty">No matching commands</div>';
            return;
        }

        const query = input.value.trim();
        let currentCategory = null;

        // When no query, show "Recent" header for recents
        if (!query && filtered.some(f => f.isRecent)) {
            const header = document.createElement('div');
            header.className = 'command-palette-category';
            header.setAttribute('role', 'presentation');
            header.textContent = 'Recent';
            list.appendChild(header);
        }

        let itemIndex = 0;
        for (const { cmd, isRecent } of filtered) {
            // Category headers (skip in "recent" section when no query)
            if (query || !isRecent) {
                const cat = cmd.category || 'Other';
                if (cat !== currentCategory) {
                    // When transitioning from recents to all, add separator
                    if (!query && currentCategory === null && !isRecent) {
                        // Already added "Recent" header, now switch to categories
                    }
                    if (query || !isRecent) {
                        currentCategory = cat;
                        const header = document.createElement('div');
                        header.className = 'command-palette-category';
                        header.setAttribute('role', 'presentation');
                        header.textContent = cat;
                        list.appendChild(header);
                    }
                }
            }

            const item = document.createElement('div');
            item.className = 'command-palette-item' + (itemIndex === selectedIndex ? ' selected' : '');
            item.setAttribute('role', 'option');
            item.setAttribute('id', 'cmd-item-' + itemIndex);
            item.setAttribute('aria-selected', itemIndex === selectedIndex ? 'true' : 'false');
            item.dataset.index = itemIndex;

            const label = document.createElement('span');
            label.className = 'command-palette-item-label';
            label.textContent = cmd.label;
            item.appendChild(label);

            if (cmd.shortcut) {
                const kbd = document.createElement('kbd');
                kbd.className = 'command-palette-item-shortcut';
                kbd.textContent = cmd.shortcut;
                item.appendChild(kbd);
            }

            item.addEventListener('click', () => {
                selectedIndex = parseInt(item.dataset.index);
                executeSelected();
            });

            item.addEventListener('mouseenter', () => {
                selectedIndex = parseInt(item.dataset.index);
                updateSelection();
            });

            list.appendChild(item);
            itemIndex++;
        }

        input.setAttribute('aria-activedescendant', 'cmd-item-' + selectedIndex);
    }

    function updateSelection() {
        const items = list.querySelectorAll('.command-palette-item');
        items.forEach((item, i) => {
            const sel = i === selectedIndex;
            item.classList.toggle('selected', sel);
            item.setAttribute('aria-selected', sel ? 'true' : 'false');
        });
        input.setAttribute('aria-activedescendant', 'cmd-item-' + selectedIndex);
    }

    function scrollSelectedIntoView() {
        const item = list.querySelector('.command-palette-item.selected');
        if (item) item.scrollIntoView({ block: 'nearest' });
    }

    function executeSelected() {
        if (filtered.length === 0) return;
        const { cmd } = filtered[selectedIndex];

        // Track recent
        recentIds = [cmd.id, ...recentIds.filter(id => id !== cmd.id)].slice(0, 8);
        localStorage.setItem('commandPaletteRecents', JSON.stringify(recentIds));

        close();

        // Execute after close so focus returns first
        requestAnimationFrame(() => {
            try { cmd.action(); } catch (err) { console.error('Command palette error:', err); }
        });
    }

    // -- Public API --
    function open() {
        if (isOpen) return;
        isOpen = true;
        previousFocus = document.activeElement;
        overlay.classList.remove('hidden');
        input.value = '';
        selectedIndex = 0;
        render();
        input.focus();
    }

    function close() {
        if (!isOpen) return;
        isOpen = false;
        overlay.classList.add('hidden');
        if (previousFocus && typeof previousFocus.focus === 'function') {
            previousFocus.focus();
        }
        previousFocus = null;
    }

    function toggle() {
        isOpen ? close() : open();
    }

    function register(cmd) {
        // Replace if same id exists
        commands = commands.filter(c => c.id !== cmd.id);
        commands.push(cmd);
    }

    function registerMany(cmds) {
        for (const cmd of cmds) register(cmd);
    }

    function unregister(id) {
        commands = commands.filter(c => c.id !== id);
    }

    // -- Global keyboard shortcut --
    document.addEventListener('keydown', (e) => {
        // Ctrl+P / Cmd+P to toggle
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'p') {
            e.preventDefault();
            e.stopPropagation();
            toggle();
            return;
        }

        // Escape to close (higher priority than other overlays)
        if (e.key === 'Escape' && isOpen) {
            e.preventDefault();
            e.stopPropagation();
            close();
        }
    }, true); // capture phase to intercept before other handlers

    // Init when DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    return { open, close, toggle, isVisible: () => isOpen, register, registerMany, unregister };
})();
