const fs = require('fs');
const path = require('path');
const { parse } = require('../mp4-demux');

describe('Mp4Demux', () => {
    const buf = fs.readFileSync(path.join(__dirname, 'fixtures', 'tiny.mp4'));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

    it('reads the video track of a faststart H.264 file', () => {
        const info = parse(ab);
        expect(info.codec).toMatch(/^avc1\.[0-9a-f]{6}$/);
        expect(info.description).toBeInstanceOf(Uint8Array);
        expect(info.description[0]).toBe(1);             // avcC version
        expect(info.width).toBe(64);
        expect(info.height).toBe(64);
        expect(info.samples).toHaveLength(12);           // 1.2 s at 10 fps
        expect(info.durationUs).toBe(1200000);
    });

    it('marks sync samples and keeps decode order with presentation timestamps', () => {
        const { samples } = parse(ab);
        const keys = samples.map((s, i) => (s.key ? i : -1)).filter(i => i >= 0);
        expect(keys).toEqual([0, 4, 8]);                 // -g 4
        // Decode order is file order; with B-frames the presentation timestamps are not monotonic.
        const pts = samples.map(s => s.timestamp).sort((a, b) => a - b);
        expect(pts).toEqual([...Array(12).keys()].map(i => i * 100000));
        expect(samples.every(s => s.duration === 100000)).toBe(true);
        // Byte ranges lie inside the file and do not overlap.
        const ranges = samples.map(s => [s.offset, s.offset + s.size]).sort((a, b) => a[0] - b[0]);
        for (let i = 1; i < ranges.length; i++) expect(ranges[i][0]).toBeGreaterThanOrEqual(ranges[i - 1][1]);
        expect(ranges[ranges.length - 1][1]).toBeLessThanOrEqual(ab.byteLength);
    });

    it('rejects a file without a video track', () => {
        expect(() => parse(new ArrayBuffer(16))).toThrow(/no video track/);
    });
});
