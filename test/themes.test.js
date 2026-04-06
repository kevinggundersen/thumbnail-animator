const { hexToRgb, rgbToHex, lighten, darken, hexAlpha, BUILTIN_THEMES, THEME_VARIABLES } = require('../themes');

// ── hexToRgb ──────────────────────────────────────────────────────────

describe('hexToRgb', () => {
    it('parses 6-digit hex', () => {
        expect(hexToRgb('#ff8800')).toEqual({ r: 255, g: 136, b: 0 });
    });

    it('parses 6-digit hex without #', () => {
        expect(hexToRgb('ff8800')).toEqual({ r: 255, g: 136, b: 0 });
    });

    it('parses 3-digit shorthand hex', () => {
        expect(hexToRgb('#f80')).toEqual({ r: 255, g: 136, b: 0 });
    });

    it('parses black', () => {
        expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
    });

    it('parses white', () => {
        expect(hexToRgb('#ffffff')).toEqual({ r: 255, g: 255, b: 255 });
    });

    it('parses case-insensitively', () => {
        expect(hexToRgb('#FF8800')).toEqual({ r: 255, g: 136, b: 0 });
    });
});

// ── rgbToHex ──────────────────────────────────────────────────────────

describe('rgbToHex', () => {
    it('converts RGB to 6-digit hex', () => {
        expect(rgbToHex(255, 136, 0)).toBe('#ff8800');
    });

    it('converts black', () => {
        expect(rgbToHex(0, 0, 0)).toBe('#000000');
    });

    it('converts white', () => {
        expect(rgbToHex(255, 255, 255)).toBe('#ffffff');
    });

    it('clamps values above 255', () => {
        expect(rgbToHex(300, 0, 0)).toBe('#ff0000');
    });

    it('clamps negative values to 0', () => {
        expect(rgbToHex(-10, 0, 0)).toBe('#000000');
    });

    it('rounds fractional values', () => {
        expect(rgbToHex(127.6, 0, 0)).toBe('#800000');
    });
});

// ── lighten ───────────────────────────────────────────────────────────

describe('lighten', () => {
    it('lightening black by 100% gives white', () => {
        expect(lighten('#000000', 100)).toBe('#ffffff');
    });

    it('lightening by 0% returns the same color', () => {
        expect(lighten('#ff8800', 0)).toBe('#ff8800');
    });

    it('lightening by 50% moves halfway to white', () => {
        // #000000 lightened 50% → rgb(127.5, 127.5, 127.5) → #808080
        expect(lighten('#000000', 50)).toBe('#808080');
    });

    it('lightening white stays white', () => {
        expect(lighten('#ffffff', 50)).toBe('#ffffff');
    });
});

// ── darken ────────────────────────────────────────────────────────────

describe('darken', () => {
    it('darkening white by 100% gives black', () => {
        expect(darken('#ffffff', 100)).toBe('#000000');
    });

    it('darkening by 0% returns the same color', () => {
        expect(darken('#ff8800', 0)).toBe('#ff8800');
    });

    it('darkening by 50% halves the channel values', () => {
        // #ffffff darkened 50% → rgb(127.5, 127.5, 127.5) → #808080
        expect(darken('#ffffff', 50)).toBe('#808080');
    });

    it('darkening black stays black', () => {
        expect(darken('#000000', 50)).toBe('#000000');
    });
});

// ── hexAlpha ──────────────────────────────────────────────────────────

describe('hexAlpha', () => {
    it('converts hex to rgba string', () => {
        expect(hexAlpha('#ff0000', 0.5)).toBe('rgba(255, 0, 0, 0.5)');
    });

    it('handles alpha of 1', () => {
        expect(hexAlpha('#00ff00', 1)).toBe('rgba(0, 255, 0, 1)');
    });

    it('handles alpha of 0', () => {
        expect(hexAlpha('#0000ff', 0)).toBe('rgba(0, 0, 255, 0)');
    });
});

// ── Theme definitions ─────────────────────────────────────────────────

describe('BUILTIN_THEMES', () => {
    it('includes dark and light themes', () => {
        expect(BUILTIN_THEMES.dark).toBeDefined();
        expect(BUILTIN_THEMES.light).toBeDefined();
    });

    it('each theme defines all required CSS variables', () => {
        for (const [id, theme] of Object.entries(BUILTIN_THEMES)) {
            for (const variable of THEME_VARIABLES) {
                expect(theme.colors[variable]).toBeDefined();
            }
        }
    });

    it('dark themes have type "dark"', () => {
        expect(BUILTIN_THEMES.dark.type).toBe('dark');
        expect(BUILTIN_THEMES.nord.type).toBe('dark');
    });

    it('light themes have type "light"', () => {
        expect(BUILTIN_THEMES.light.type).toBe('light');
    });
});
