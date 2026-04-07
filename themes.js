// ============================================================
// Theme System — themes.js
// JS-object-based theme engine. Each theme defines CSS variable
// overrides; ThemeManager.apply() sets them on :root.
// ============================================================

const THEME_VARIABLES = [
    '--bg-primary', '--bg-secondary', '--bg-tertiary', '--bg-hover',
    '--bg-color', '--card-bg',
    '--border-subtle', '--border-default', '--border-strong',
    '--text-primary', '--text-secondary', '--text-tertiary', '--text-color',
    '--accent', '--accent-hover', '--accent-muted', '--accent-strong', '--accent-color',
    '--success', '--warning', '--danger', '--info',
    '--shadow-sm', '--shadow-md', '--shadow-lg', '--shadow-xl'
];

// ---- Color utilities ----

function hexToRgb(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    const n = parseInt(hex, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(c => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('');
}

function lighten(hex, amount) {
    const { r, g, b } = hexToRgb(hex);
    const t = amount / 100;
    return rgbToHex(r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t);
}

function darken(hex, amount) {
    const { r, g, b } = hexToRgb(hex);
    const t = 1 - amount / 100;
    return rgbToHex(r * t, g * t, b * t);
}

function hexAlpha(hex, alpha) {
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ---- Built-in theme definitions ----

const BUILTIN_THEMES = {
    dark: {
        id: 'dark', name: 'Dark', type: 'dark', builtin: true,
        colors: {
            '--bg-primary': '#0d0d0f', '--bg-secondary': '#161618', '--bg-tertiary': '#1c1c20', '--bg-hover': '#222228',
            '--bg-color': '#0d0d0f', '--card-bg': '#161618',
            '--border-subtle': 'rgba(255, 255, 255, 0.06)', '--border-default': 'rgba(255, 255, 255, 0.10)', '--border-strong': 'rgba(255, 255, 255, 0.16)',
            '--text-primary': '#ececf0', '--text-secondary': '#9d9da6', '--text-tertiary': '#5c5c66', '--text-color': '#ececf0',
            '--accent': '#e8a44a', '--accent-hover': '#f0b560', '--accent-muted': 'rgba(232, 164, 74, 0.15)', '--accent-strong': 'rgba(232, 164, 74, 0.25)', '--accent-color': '#e8a44a',
            '--success': '#4ade80', '--warning': '#fbbf24', '--danger': '#f87171', '--info': '#60a5fa',
            '--shadow-sm': '0 1px 2px rgba(0, 0, 0, 0.3)', '--shadow-md': '0 4px 12px rgba(0, 0, 0, 0.4)', '--shadow-lg': '0 8px 32px rgba(0, 0, 0, 0.5)', '--shadow-xl': '0 16px 48px rgba(0, 0, 0, 0.6)'
        }
    },
    light: {
        id: 'light', name: 'Light', type: 'light', builtin: true,
        colors: {
            '--bg-primary': '#f5f5f7', '--bg-secondary': '#ffffff', '--bg-tertiary': '#f0f0f2', '--bg-hover': '#e8e8ec',
            '--bg-color': '#f5f5f7', '--card-bg': '#ffffff',
            '--border-subtle': 'rgba(0, 0, 0, 0.04)', '--border-default': 'rgba(0, 0, 0, 0.08)', '--border-strong': 'rgba(0, 0, 0, 0.14)',
            '--text-primary': '#1a1a1e', '--text-secondary': '#6b6b76', '--text-tertiary': '#9d9da6', '--text-color': '#1a1a1e',
            '--accent': '#c47a1a', '--accent-hover': '#d4892a', '--accent-muted': 'rgba(196, 122, 26, 0.10)', '--accent-strong': 'rgba(196, 122, 26, 0.18)', '--accent-color': '#c47a1a',
            '--success': '#16a34a', '--warning': '#d97706', '--danger': '#dc2626', '--info': '#2563eb',
            '--shadow-sm': '0 1px 2px rgba(0, 0, 0, 0.06)', '--shadow-md': '0 4px 12px rgba(0, 0, 0, 0.08)', '--shadow-lg': '0 8px 32px rgba(0, 0, 0, 0.12)', '--shadow-xl': '0 16px 48px rgba(0, 0, 0, 0.16)'
        }
    },
    nord: {
        id: 'nord', name: 'Nord', type: 'dark', builtin: true,
        colors: {
            '--bg-primary': '#2e3440', '--bg-secondary': '#3b4252', '--bg-tertiary': '#434c5e', '--bg-hover': '#4c566a',
            '--bg-color': '#2e3440', '--card-bg': '#3b4252',
            '--border-subtle': 'rgba(216, 222, 233, 0.06)', '--border-default': 'rgba(216, 222, 233, 0.10)', '--border-strong': 'rgba(216, 222, 233, 0.16)',
            '--text-primary': '#eceff4', '--text-secondary': '#d8dee9', '--text-tertiary': '#7b88a1', '--text-color': '#eceff4',
            '--accent': '#88c0d0', '--accent-hover': '#8fbcbb', '--accent-muted': 'rgba(136, 192, 208, 0.15)', '--accent-strong': 'rgba(136, 192, 208, 0.25)', '--accent-color': '#88c0d0',
            '--success': '#a3be8c', '--warning': '#ebcb8b', '--danger': '#bf616a', '--info': '#81a1c1',
            '--shadow-sm': '0 1px 2px rgba(0, 0, 0, 0.3)', '--shadow-md': '0 4px 12px rgba(0, 0, 0, 0.4)', '--shadow-lg': '0 8px 32px rgba(0, 0, 0, 0.5)', '--shadow-xl': '0 16px 48px rgba(0, 0, 0, 0.6)'
        }
    },
    'catppuccin-mocha': {
        id: 'catppuccin-mocha', name: 'Catppuccin Mocha', type: 'dark', builtin: true,
        colors: {
            '--bg-primary': '#1e1e2e', '--bg-secondary': '#28283d', '--bg-tertiary': '#313244', '--bg-hover': '#3b3b52',
            '--bg-color': '#1e1e2e', '--card-bg': '#28283d',
            '--border-subtle': 'rgba(205, 214, 244, 0.06)', '--border-default': 'rgba(205, 214, 244, 0.10)', '--border-strong': 'rgba(205, 214, 244, 0.16)',
            '--text-primary': '#cdd6f4', '--text-secondary': '#bac2de', '--text-tertiary': '#6c7086', '--text-color': '#cdd6f4',
            '--accent': '#cba6f7', '--accent-hover': '#d4b8fa', '--accent-muted': 'rgba(203, 166, 247, 0.15)', '--accent-strong': 'rgba(203, 166, 247, 0.25)', '--accent-color': '#cba6f7',
            '--success': '#a6e3a1', '--warning': '#f9e2af', '--danger': '#f38ba8', '--info': '#89b4fa',
            '--shadow-sm': '0 1px 2px rgba(0, 0, 0, 0.3)', '--shadow-md': '0 4px 12px rgba(0, 0, 0, 0.4)', '--shadow-lg': '0 8px 32px rgba(0, 0, 0, 0.5)', '--shadow-xl': '0 16px 48px rgba(0, 0, 0, 0.6)'
        }
    },
    'solarized-dark': {
        id: 'solarized-dark', name: 'Solarized Dark', type: 'dark', builtin: true,
        colors: {
            '--bg-primary': '#002b36', '--bg-secondary': '#073642', '--bg-tertiary': '#0a3f4c', '--bg-hover': '#0d4956',
            '--bg-color': '#002b36', '--card-bg': '#073642',
            '--border-subtle': 'rgba(147, 161, 161, 0.08)', '--border-default': 'rgba(147, 161, 161, 0.14)', '--border-strong': 'rgba(147, 161, 161, 0.22)',
            '--text-primary': '#fdf6e3', '--text-secondary': '#93a1a1', '--text-tertiary': '#657b83', '--text-color': '#fdf6e3',
            '--accent': '#b58900', '--accent-hover': '#c99a00', '--accent-muted': 'rgba(181, 137, 0, 0.15)', '--accent-strong': 'rgba(181, 137, 0, 0.25)', '--accent-color': '#b58900',
            '--success': '#859900', '--warning': '#cb4b16', '--danger': '#dc322f', '--info': '#268bd2',
            '--shadow-sm': '0 1px 2px rgba(0, 0, 0, 0.3)', '--shadow-md': '0 4px 12px rgba(0, 0, 0, 0.4)', '--shadow-lg': '0 8px 32px rgba(0, 0, 0, 0.5)', '--shadow-xl': '0 16px 48px rgba(0, 0, 0, 0.6)'
        }
    },
    'solarized-light': {
        id: 'solarized-light', name: 'Solarized Light', type: 'light', builtin: true,
        colors: {
            '--bg-primary': '#fdf6e3', '--bg-secondary': '#eee8d5', '--bg-tertiary': '#e8e1cb', '--bg-hover': '#ddd6c1',
            '--bg-color': '#fdf6e3', '--card-bg': '#eee8d5',
            '--border-subtle': 'rgba(88, 110, 117, 0.06)', '--border-default': 'rgba(88, 110, 117, 0.12)', '--border-strong': 'rgba(88, 110, 117, 0.20)',
            '--text-primary': '#073642', '--text-secondary': '#586e75', '--text-tertiary': '#93a1a1', '--text-color': '#073642',
            '--accent': '#b58900', '--accent-hover': '#c99a00', '--accent-muted': 'rgba(181, 137, 0, 0.12)', '--accent-strong': 'rgba(181, 137, 0, 0.20)', '--accent-color': '#b58900',
            '--success': '#859900', '--warning': '#cb4b16', '--danger': '#dc322f', '--info': '#268bd2',
            '--shadow-sm': '0 1px 2px rgba(0, 0, 0, 0.06)', '--shadow-md': '0 4px 12px rgba(0, 0, 0, 0.08)', '--shadow-lg': '0 8px 32px rgba(0, 0, 0, 0.12)', '--shadow-xl': '0 16px 48px rgba(0, 0, 0, 0.16)'
        }
    },
    'tokyo-night': {
        id: 'tokyo-night', name: 'Tokyo Night', type: 'dark', builtin: true,
        colors: {
            '--bg-primary': '#1a1b26', '--bg-secondary': '#1f2335', '--bg-tertiary': '#24283b', '--bg-hover': '#292e42',
            '--bg-color': '#1a1b26', '--card-bg': '#1f2335',
            '--border-subtle': 'rgba(169, 177, 214, 0.06)', '--border-default': 'rgba(169, 177, 214, 0.10)', '--border-strong': 'rgba(169, 177, 214, 0.16)',
            '--text-primary': '#c0caf5', '--text-secondary': '#a9b1d6', '--text-tertiary': '#565f89', '--text-color': '#c0caf5',
            '--accent': '#7aa2f7', '--accent-hover': '#89b4fa', '--accent-muted': 'rgba(122, 162, 247, 0.15)', '--accent-strong': 'rgba(122, 162, 247, 0.25)', '--accent-color': '#7aa2f7',
            '--success': '#9ece6a', '--warning': '#e0af68', '--danger': '#f7768e', '--info': '#7dcfff',
            '--shadow-sm': '0 1px 2px rgba(0, 0, 0, 0.3)', '--shadow-md': '0 4px 12px rgba(0, 0, 0, 0.4)', '--shadow-lg': '0 8px 32px rgba(0, 0, 0, 0.5)', '--shadow-xl': '0 16px 48px rgba(0, 0, 0, 0.6)'
        }
    },
    dracula: {
        id: 'dracula', name: 'Dracula', type: 'dark', builtin: true,
        colors: {
            '--bg-primary': '#282a36', '--bg-secondary': '#2d303e', '--bg-tertiary': '#343746', '--bg-hover': '#3c3f52',
            '--bg-color': '#282a36', '--card-bg': '#2d303e',
            '--border-subtle': 'rgba(248, 248, 242, 0.06)', '--border-default': 'rgba(248, 248, 242, 0.10)', '--border-strong': 'rgba(248, 248, 242, 0.16)',
            '--text-primary': '#f8f8f2', '--text-secondary': '#c0c0d0', '--text-tertiary': '#6272a4', '--text-color': '#f8f8f2',
            '--accent': '#bd93f9', '--accent-hover': '#caa4fb', '--accent-muted': 'rgba(189, 147, 249, 0.15)', '--accent-strong': 'rgba(189, 147, 249, 0.25)', '--accent-color': '#bd93f9',
            '--success': '#50fa7b', '--warning': '#f1fa8c', '--danger': '#ff5555', '--info': '#8be9fd',
            '--shadow-sm': '0 1px 2px rgba(0, 0, 0, 0.3)', '--shadow-md': '0 4px 12px rgba(0, 0, 0, 0.4)', '--shadow-lg': '0 8px 32px rgba(0, 0, 0, 0.5)', '--shadow-xl': '0 16px 48px rgba(0, 0, 0, 0.6)'
        }
    }
};

// ---- Derive a full theme from 4 user-picked colors ----

function deriveFullTheme(accent, bg, surface, text, isDark) {
    const colors = {};
    colors['--bg-primary'] = bg;
    colors['--bg-secondary'] = surface;
    colors['--bg-tertiary'] = isDark ? lighten(surface, 5) : darken(surface, 3);
    colors['--bg-hover'] = isDark ? lighten(surface, 10) : darken(surface, 6);
    colors['--bg-color'] = bg;
    colors['--card-bg'] = surface;

    const borderBase = isDark ? '255, 255, 255' : '0, 0, 0';
    colors['--border-subtle'] = `rgba(${borderBase}, ${isDark ? 0.06 : 0.04})`;
    colors['--border-default'] = `rgba(${borderBase}, ${isDark ? 0.10 : 0.08})`;
    colors['--border-strong'] = `rgba(${borderBase}, ${isDark ? 0.16 : 0.14})`;

    colors['--text-primary'] = text;
    colors['--text-secondary'] = isDark ? darken(text, 20) : lighten(text, 30);
    colors['--text-tertiary'] = isDark ? darken(text, 50) : lighten(text, 55);
    colors['--text-color'] = text;

    colors['--accent'] = accent;
    colors['--accent-hover'] = isDark ? lighten(accent, 12) : darken(accent, 10);
    colors['--accent-muted'] = hexAlpha(accent, isDark ? 0.15 : 0.10);
    colors['--accent-strong'] = hexAlpha(accent, isDark ? 0.25 : 0.18);
    colors['--accent-color'] = accent;

    colors['--success'] = isDark ? '#4ade80' : '#16a34a';
    colors['--warning'] = isDark ? '#fbbf24' : '#d97706';
    colors['--danger'] = isDark ? '#f87171' : '#dc2626';
    colors['--info'] = isDark ? '#60a5fa' : '#2563eb';

    const so = isDark ? [0.3, 0.4, 0.5, 0.6] : [0.06, 0.08, 0.12, 0.16];
    colors['--shadow-sm'] = `0 1px 2px rgba(0, 0, 0, ${so[0]})`;
    colors['--shadow-md'] = `0 4px 12px rgba(0, 0, 0, ${so[1]})`;
    colors['--shadow-lg'] = `0 8px 32px rgba(0, 0, 0, ${so[2]})`;
    colors['--shadow-xl'] = `0 16px 48px rgba(0, 0, 0, ${so[3]})`;

    return colors;
}

// ---- ThemeManager singleton ----

const ThemeManager = {
    current: 'dark',
    _customThemes: [],
    _systemDarkQuery: null,
    _editingThemeId: null,

    init() {
        // Load custom themes
        try {
            const raw = localStorage.getItem('customThemes');
            this._customThemes = raw ? JSON.parse(raw) : [];
        } catch { this._customThemes = []; }

        // Load and apply saved theme
        const saved = localStorage.getItem('selectedTheme') || 'dark';
        this.apply(saved, false);

        // System theme listener
        this._initSystemThemeListener();

        // Render UI (deferred until settings opened, or immediately if DOM ready)
        this._wireUI();
    },

    getTheme(id) {
        if (id === 'auto') return null;
        return BUILTIN_THEMES[id] || this._customThemes.find(t => t.id === id) || null;
    },

    getAllThemes() {
        return [...Object.values(BUILTIN_THEMES), ...this._customThemes];
    },

    apply(id, persist = true) {
        this.current = id;

        let resolved = id;
        if (id === 'auto') {
            const prefersDark = !this._systemDarkQuery || this._systemDarkQuery.matches;
            resolved = prefersDark ? 'dark' : 'light';
        }

        this._applyResolved(resolved);

        if (persist) {
            localStorage.setItem('selectedTheme', id);
        }

        // Update UI active states
        this._updateActiveCard();
    },

    _applyResolved(id) {
        const el = document.documentElement;

        // Clear all theme overrides first
        for (const v of THEME_VARIABLES) {
            el.style.removeProperty(v);
        }

        const theme = this.getTheme(id);
        if (theme) {
            // Apply overrides (for dark, CSS defaults match, but we apply anyway for consistency)
            for (const [prop, val] of Object.entries(theme.colors)) {
                el.style.setProperty(prop, val);
            }
            // Toggle light-theme class
            el.classList.toggle('light-theme', theme.type === 'light');
        } else {
            el.classList.remove('light-theme');
        }

        // Invalidate style caches if available (defined in renderer.js)
        if (typeof invalidateMasonryStyleCache === 'function') {
            invalidateMasonryStyleCache();
        }
        if (typeof invalidateVsStyleCache === 'function') {
            invalidateVsStyleCache();
        }

        // Update Electron title bar overlay colors
        if (window.electronAPI && window.electronAPI.updateTitleBarOverlay) {
            const bg = theme ? theme.colors['--bg-secondary'] : '#161618';
            const sym = theme ? theme.colors['--text-secondary'] : '#9d9da6';
            window.electronAPI.updateTitleBarOverlay({ color: bg, symbolColor: sym });
        }
    },

    _initSystemThemeListener() {
        this._systemDarkQuery = window.matchMedia('(prefers-color-scheme: dark)');
        this._systemDarkQuery.addEventListener('change', () => {
            if (this.current === 'auto') {
                this._applyResolved(this._systemDarkQuery.matches ? 'dark' : 'light');
            }
        });
    },

    // ---- Custom theme CRUD ----

    saveCustomTheme(theme) {
        const idx = this._customThemes.findIndex(t => t.id === theme.id);
        if (idx >= 0) {
            this._customThemes[idx] = theme;
        } else {
            this._customThemes.push(theme);
        }
        localStorage.setItem('customThemes', JSON.stringify(this._customThemes));
        this.renderThemeGrid();
        this.renderCustomThemesList();
    },

    deleteCustomTheme(id) {
        this._customThemes = this._customThemes.filter(t => t.id !== id);
        localStorage.setItem('customThemes', JSON.stringify(this._customThemes));
        if (this.current === id) this.apply('dark');
        this.renderThemeGrid();
        this.renderCustomThemesList();
    },

    // ---- UI rendering ----

    _wireUI() {
        const createBtn = document.getElementById('create-theme-btn');
        if (createBtn) createBtn.addEventListener('click', () => this._openEditor(null));

        const cancelBtn = document.getElementById('theme-editor-cancel');
        if (cancelBtn) cancelBtn.addEventListener('click', () => this._closeEditor());

        const saveBtn = document.getElementById('theme-editor-save');
        if (saveBtn) saveBtn.addEventListener('click', () => this._saveFromEditor());

        const previewBtn = document.getElementById('theme-editor-preview');
        if (previewBtn) previewBtn.addEventListener('click', () => this._previewFromEditor());

        const baseSelect = document.getElementById('theme-editor-base');
        if (baseSelect) {
            // Populate base theme options
            for (const t of Object.values(BUILTIN_THEMES)) {
                const opt = document.createElement('option');
                opt.value = t.id;
                opt.textContent = t.name;
                baseSelect.appendChild(opt);
            }
            baseSelect.addEventListener('change', () => this._onBaseThemeChange());
        }

        // Wire color picker hex displays
        for (const field of ['accent', 'bg', 'surface', 'text']) {
            const input = document.getElementById(`theme-editor-${field}`);
            const hex = document.getElementById(`theme-editor-${field}-hex`);
            if (input && hex) {
                input.addEventListener('input', () => { hex.textContent = input.value; });
            }
        }

        this.renderThemeGrid();
        this.renderCustomThemesList();
    },

    renderThemeGrid() {
        const grid = document.getElementById('theme-grid');
        if (!grid) return;
        grid.innerHTML = '';

        // Auto theme card
        grid.appendChild(this._createAutoCard());

        // Built-in themes
        for (const theme of Object.values(BUILTIN_THEMES)) {
            grid.appendChild(this._createThemeCard(theme));
        }

        // Custom themes
        for (const theme of this._customThemes) {
            grid.appendChild(this._createThemeCard(theme));
        }
    },

    _createAutoCard() {
        const card = document.createElement('div');
        card.className = 'theme-card' + (this.current === 'auto' ? ' active' : '');
        card.dataset.themeId = 'auto';

        const preview = document.createElement('div');
        preview.className = 'theme-card-preview auto-preview-split';

        const darkHalf = document.createElement('div');
        darkHalf.className = 'auto-half dark-half';
        darkHalf.style.backgroundColor = '#0d0d0f';

        const lightHalf = document.createElement('div');
        lightHalf.className = 'auto-half light-half';
        lightHalf.style.backgroundColor = '#f5f5f7';

        preview.appendChild(darkHalf);
        preview.appendChild(lightHalf);

        const name = document.createElement('div');
        name.className = 'theme-card-name';
        name.textContent = 'Auto';

        const check = document.createElement('div');
        check.className = 'theme-card-check';
        check.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

        card.appendChild(preview);
        card.appendChild(name);
        card.appendChild(check);
        card.addEventListener('click', () => this.apply('auto'));
        return card;
    },

    _createThemeCard(theme) {
        const card = document.createElement('div');
        card.className = 'theme-card' + (this.current === theme.id ? ' active' : '');
        card.dataset.themeId = theme.id;

        const preview = document.createElement('div');
        preview.className = 'theme-card-preview';
        preview.style.backgroundColor = theme.colors['--bg-primary'];

        // Swatch bars
        const swatches = document.createElement('div');
        swatches.className = 'theme-card-swatches';

        const bar1 = document.createElement('div');
        bar1.className = 'swatch-bar';
        bar1.style.backgroundColor = theme.colors['--bg-secondary'];

        const bar2 = document.createElement('div');
        bar2.className = 'swatch-bar';
        bar2.style.backgroundColor = theme.colors['--accent'];

        const textSample = document.createElement('div');
        textSample.className = 'swatch-text';
        textSample.style.color = theme.colors['--text-primary'];
        textSample.textContent = 'Aa';

        swatches.appendChild(bar1);
        swatches.appendChild(bar2);
        preview.appendChild(swatches);
        preview.appendChild(textSample);

        const name = document.createElement('div');
        name.className = 'theme-card-name';
        name.textContent = theme.name;

        const check = document.createElement('div');
        check.className = 'theme-card-check';
        check.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

        card.appendChild(preview);
        card.appendChild(name);
        card.appendChild(check);
        card.addEventListener('click', () => this.apply(theme.id));
        return card;
    },

    _updateActiveCard() {
        const grid = document.getElementById('theme-grid');
        if (!grid) return;
        for (const card of grid.children) {
            card.classList.toggle('active', card.dataset.themeId === this.current);
        }
    },

    renderCustomThemesList() {
        const list = document.getElementById('custom-themes-list');
        if (!list) return;
        list.innerHTML = '';

        if (this._customThemes.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'custom-themes-empty';
            empty.textContent = 'No custom themes yet';
            list.appendChild(empty);
            return;
        }

        for (const theme of this._customThemes) {
            const item = document.createElement('div');
            item.className = 'custom-theme-item';

            const colorDot = document.createElement('div');
            colorDot.className = 'custom-theme-dot';
            colorDot.style.backgroundColor = theme.colors['--accent'];

            const nameEl = document.createElement('span');
            nameEl.className = 'custom-theme-name';
            nameEl.textContent = theme.name;

            const actions = document.createElement('div');
            actions.className = 'custom-theme-actions';

            const editBtn = document.createElement('button');
            editBtn.className = 'custom-theme-action-btn';
            editBtn.title = 'Edit';
            editBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
            editBtn.addEventListener('click', (e) => { e.stopPropagation(); this._openEditor(theme); });

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'custom-theme-action-btn danger';
            deleteBtn.title = 'Delete';
            deleteBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
            deleteBtn.addEventListener('click', (e) => { e.stopPropagation(); this.deleteCustomTheme(theme.id); });

            actions.appendChild(editBtn);
            actions.appendChild(deleteBtn);

            item.appendChild(colorDot);
            item.appendChild(nameEl);
            item.appendChild(actions);
            list.appendChild(item);
        }
    },

    // ---- Theme editor ----

    _openEditor(theme) {
        const editor = document.getElementById('theme-editor');
        if (!editor) return;
        editor.classList.remove('hidden');

        this._editingThemeId = theme ? theme.id : null;

        const nameInput = document.getElementById('theme-editor-name');
        const baseSelect = document.getElementById('theme-editor-base');
        const accentInput = document.getElementById('theme-editor-accent');
        const bgInput = document.getElementById('theme-editor-bg');
        const surfaceInput = document.getElementById('theme-editor-surface');
        const textInput = document.getElementById('theme-editor-text');

        if (theme) {
            // Editing existing
            nameInput.value = theme.name;
            baseSelect.value = theme.type === 'light' ? 'light' : 'dark';
            accentInput.value = theme.colors['--accent'];
            bgInput.value = theme.colors['--bg-primary'];
            surfaceInput.value = theme.colors['--bg-secondary'];
            textInput.value = theme.colors['--text-primary'];
        } else {
            // New theme — prefill from current active theme
            const base = this.getTheme(this.current === 'auto' ? 'dark' : this.current) || BUILTIN_THEMES.dark;
            nameInput.value = '';
            baseSelect.value = base.id in BUILTIN_THEMES ? base.id : base.type === 'light' ? 'light' : 'dark';
            accentInput.value = this._toHex(base.colors['--accent']);
            bgInput.value = this._toHex(base.colors['--bg-primary']);
            surfaceInput.value = this._toHex(base.colors['--bg-secondary']);
            textInput.value = this._toHex(base.colors['--text-primary']);
        }

        // Update hex displays
        for (const field of ['accent', 'bg', 'surface', 'text']) {
            const input = document.getElementById(`theme-editor-${field}`);
            const hex = document.getElementById(`theme-editor-${field}-hex`);
            if (input && hex) hex.textContent = input.value;
        }
    },

    _closeEditor() {
        const editor = document.getElementById('theme-editor');
        if (editor) editor.classList.add('hidden');
        this._editingThemeId = null;
        // Reapply current theme to undo any preview
        this.apply(this.current, false);
    },

    _previewFromEditor() {
        const colors = this._getEditorColors();
        if (!colors) return;
        const el = document.documentElement;
        for (const [prop, val] of Object.entries(colors)) {
            el.style.setProperty(prop, val);
        }
        const baseSelect = document.getElementById('theme-editor-base');
        const baseTheme = BUILTIN_THEMES[baseSelect.value] || BUILTIN_THEMES.dark;
        el.classList.toggle('light-theme', baseTheme.type === 'light');
    },

    _saveFromEditor() {
        const nameInput = document.getElementById('theme-editor-name');
        const name = nameInput.value.trim();
        if (!name) {
            nameInput.focus();
            nameInput.style.outline = '2px solid var(--danger)';
            setTimeout(() => nameInput.style.outline = '', 1500);
            return;
        }

        const colors = this._getEditorColors();
        if (!colors) return;

        const id = this._editingThemeId || 'custom-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

        // Check for duplicate name (excluding the one being edited)
        const duplicate = this._customThemes.find(t => t.name.toLowerCase() === name.toLowerCase() && t.id !== id);
        if (duplicate) {
            nameInput.focus();
            nameInput.style.outline = '2px solid var(--warning)';
            setTimeout(() => nameInput.style.outline = '', 1500);
            return;
        }

        const baseSelect = document.getElementById('theme-editor-base');
        const baseTheme = BUILTIN_THEMES[baseSelect.value] || BUILTIN_THEMES.dark;

        const theme = {
            id,
            name,
            type: baseTheme.type,
            builtin: false,
            colors
        };

        this.saveCustomTheme(theme);
        this._closeEditor();
        this.apply(id);
    },

    _getEditorColors() {
        const baseSelect = document.getElementById('theme-editor-base');
        const accentInput = document.getElementById('theme-editor-accent');
        const bgInput = document.getElementById('theme-editor-bg');
        const surfaceInput = document.getElementById('theme-editor-surface');
        const textInput = document.getElementById('theme-editor-text');

        const baseTheme = BUILTIN_THEMES[baseSelect.value] || BUILTIN_THEMES.dark;
        const isDark = baseTheme.type === 'dark';

        return deriveFullTheme(accentInput.value, bgInput.value, surfaceInput.value, textInput.value, isDark);
    },

    _onBaseThemeChange() {
        const baseSelect = document.getElementById('theme-editor-base');
        const base = BUILTIN_THEMES[baseSelect.value] || BUILTIN_THEMES.dark;

        const accentInput = document.getElementById('theme-editor-accent');
        const bgInput = document.getElementById('theme-editor-bg');
        const surfaceInput = document.getElementById('theme-editor-surface');
        const textInput = document.getElementById('theme-editor-text');

        accentInput.value = this._toHex(base.colors['--accent']);
        bgInput.value = this._toHex(base.colors['--bg-primary']);
        surfaceInput.value = this._toHex(base.colors['--bg-secondary']);
        textInput.value = this._toHex(base.colors['--text-primary']);

        // Update hex displays
        for (const field of ['accent', 'bg', 'surface', 'text']) {
            const input = document.getElementById(`theme-editor-${field}`);
            const hex = document.getElementById(`theme-editor-${field}-hex`);
            if (input && hex) hex.textContent = input.value;
        }
    },

    _toHex(val) {
        // Convert a CSS color value to hex (handles hex already, ignores rgba)
        if (!val) return '#000000';
        val = val.trim();
        if (val.startsWith('#')) {
            if (val.length === 4) return '#' + val[1]+val[1]+val[2]+val[2]+val[3]+val[3];
            return val.slice(0, 7);
        }
        // For rgba or other formats, return a sensible default
        return '#000000';
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { hexToRgb, rgbToHex, lighten, darken, hexAlpha, BUILTIN_THEMES, THEME_VARIABLES };
}
