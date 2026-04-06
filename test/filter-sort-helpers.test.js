const {
    normalizePath,
    cosineSim,
    parseAspectRatio,
    pad2,
    getDateGroupKey,
    getDateGroupLabel,
} = require('../filter-sort-helpers');

// ── normalizePath ─────────────────────────────────────────────────────

describe('normalizePath', () => {
    it('converts backslashes to forward slashes', () => {
        expect(normalizePath('C:\\Users\\foo\\bar')).toBe('C:/Users/foo/bar');
    });

    it('strips trailing slashes', () => {
        expect(normalizePath('/foo/bar/')).toBe('/foo/bar');
    });

    it('strips trailing backslashes (after conversion)', () => {
        expect(normalizePath('C:\\foo\\bar\\')).toBe('C:/foo/bar');
    });

    it('returns null for null input', () => {
        expect(normalizePath(null)).toBeNull();
    });

    it('returns undefined for undefined input', () => {
        expect(normalizePath(undefined)).toBeUndefined();
    });

    it('returns empty string for empty string', () => {
        expect(normalizePath('')).toBe('');
    });

    it('handles a root-only path', () => {
        // "/" stripped to "" → fallback returns original "/"
        expect(normalizePath('/')).toBe('/');
    });
});

// ── cosineSim ─────────────────────────────────────────────────────────

describe('cosineSim', () => {
    it('returns 1.0 for identical unit vectors', () => {
        const v = new Float32Array([0, 0, 1]);
        expect(cosineSim(v, v)).toBeCloseTo(1.0);
    });

    it('returns 0.0 for orthogonal vectors', () => {
        const a = new Float32Array([1, 0, 0]);
        const b = new Float32Array([0, 1, 0]);
        expect(cosineSim(a, b)).toBeCloseTo(0.0);
    });

    it('computes correct dot product', () => {
        const a = new Float32Array([1, 2, 3]);
        const b = new Float32Array([4, 5, 6]);
        // 1*4 + 2*5 + 3*6 = 32
        expect(cosineSim(a, b)).toBeCloseTo(32);
    });

    it('uses minimum length when vectors differ', () => {
        const a = new Float32Array([1, 2]);
        const b = new Float32Array([3, 4, 5]);
        // 1*3 + 2*4 = 11 (ignores b[2])
        expect(cosineSim(a, b)).toBeCloseTo(11);
    });

    it('returns 0 for empty vectors', () => {
        expect(cosineSim(new Float32Array([]), new Float32Array([]))).toBe(0);
    });
});

// ── parseAspectRatio ──────────────────────────────────────────────────

describe('parseAspectRatio', () => {
    it('parses "16:9" to ~1.778', () => {
        expect(parseAspectRatio('16:9')).toBeCloseTo(16 / 9);
    });

    it('parses "4:3" to ~1.333', () => {
        expect(parseAspectRatio('4:3')).toBeCloseTo(4 / 3);
    });

    it('parses "1:1" to 1.0', () => {
        expect(parseAspectRatio('1:1')).toBeCloseTo(1.0);
    });

    it('returns NaN for null', () => {
        expect(parseAspectRatio(null)).toBeNaN();
    });

    it('returns NaN for empty string', () => {
        expect(parseAspectRatio('')).toBeNaN();
    });

    it('returns NaN for malformed "abc"', () => {
        expect(parseAspectRatio('abc')).toBeNaN();
    });

    it('returns NaN for "16:" (missing denominator)', () => {
        expect(parseAspectRatio('16:')).toBeNaN();
    });

    it('returns NaN for ":9" (missing numerator)', () => {
        expect(parseAspectRatio(':9')).toBeNaN();
    });

    it('returns NaN for "16:0" (zero denominator)', () => {
        expect(parseAspectRatio('16:0')).toBeNaN();
    });
});

// ── pad2 ──────────────────────────────────────────────────────────────

describe('pad2', () => {
    it('pads single digit with leading zero', () => {
        expect(pad2(5)).toBe('05');
    });

    it('returns two-digit number as string', () => {
        expect(pad2(12)).toBe('12');
    });

    it('pads 0 to "00"', () => {
        expect(pad2(0)).toBe('00');
    });

    it('pads 9 to "09"', () => {
        expect(pad2(9)).toBe('09');
    });
});

// ── getDateGroupKey ───────────────────────────────────────────────────

describe('getDateGroupKey', () => {
    // Use a fixed timestamp: 2024-03-15 14:30:00 UTC
    const ts = new Date(2024, 2, 15, 14, 30, 0).getTime();

    it('returns year key for granularity="year"', () => {
        expect(getDateGroupKey({ mtime: ts }, 'year')).toBe('2024');
    });

    it('returns YYYY-MM key for granularity="month"', () => {
        expect(getDateGroupKey({ mtime: ts }, 'month')).toBe('2024-03');
    });

    it('returns YYYY-MM-DD key for granularity="day"', () => {
        expect(getDateGroupKey({ mtime: ts }, 'day')).toBe('2024-03-15');
    });

    it('defaults to month when granularity is unrecognized', () => {
        expect(getDateGroupKey({ mtime: ts }, 'week')).toBe('2024-03');
    });

    it('returns "unknown" for mtime=0', () => {
        expect(getDateGroupKey({ mtime: 0 }, 'month')).toBe('unknown');
    });

    it('returns "unknown" for missing mtime', () => {
        expect(getDateGroupKey({}, 'month')).toBe('unknown');
    });
});

// ── getDateGroupLabel ─────────────────────────────────────────────────

describe('getDateGroupLabel', () => {
    it('returns "Unknown date" for "unknown" key', () => {
        expect(getDateGroupLabel('unknown')).toBe('Unknown date');
    });

    it('returns the key itself for date keys', () => {
        expect(getDateGroupLabel('2024-03')).toBe('2024-03');
    });
});
