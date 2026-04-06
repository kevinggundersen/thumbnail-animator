const { parseGifDuration, parseWebpDuration } = require('../gif-duration-parser');

// ── Helper: build a minimal GIF89a binary ─────────────────────────────

function buildGif({ frames = [], hasGCT = false, gctSize = 0 } = {}) {
    const parts = [];
    // GIF89a signature
    parts.push(Buffer.from('GIF89a'));

    // Logical Screen Descriptor (7 bytes)
    const lsd = Buffer.alloc(7);
    lsd.writeUInt16LE(1, 0); // width
    lsd.writeUInt16LE(1, 2); // height
    let packed = 0;
    if (hasGCT) {
        packed |= 0x80;
        packed |= gctSize & 7;
    }
    lsd[4] = packed;
    parts.push(lsd);

    // Global Color Table
    if (hasGCT) {
        parts.push(Buffer.alloc(3 * (1 << (gctSize + 1))));
    }

    for (const frame of frames) {
        // Graphic Control Extension (8 bytes total)
        const gce = Buffer.alloc(8);
        gce[0] = 0x21; // extension introducer
        gce[1] = 0xf9; // GCE label
        gce[2] = 0x04; // block size
        gce.writeUInt16LE(frame.delayCentiseconds, 4); // delay (little-endian)
        gce[7] = 0x00; // block terminator
        parts.push(gce);

        // Image Descriptor (10 bytes)
        const imgDesc = Buffer.alloc(10);
        imgDesc[0] = 0x2c; // image separator
        imgDesc.writeUInt16LE(1, 5); // width
        imgDesc.writeUInt16LE(1, 7); // height
        parts.push(imgDesc);

        // LZW min code size + empty sub-block
        parts.push(Buffer.from([0x02, 0x00]));
    }

    // Trailer
    parts.push(Buffer.from([0x3b]));

    const buf = Buffer.concat(parts);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

// ── Helper: build a minimal animated WebP binary ──────────────────────

function buildWebp({ frames = [], animated = true } = {}) {
    const chunks = [];

    // VP8X chunk (extended format header)
    const vp8x = Buffer.alloc(18);
    vp8x.write('VP8X', 0);
    vp8x.writeUInt32LE(10, 4); // chunk size
    if (animated) vp8x.writeUInt32LE(0x02, 8); // animation flag = bit 1
    chunks.push(vp8x);

    // ANMF chunks (animation frames)
    for (const frame of frames) {
        const anmf = Buffer.alloc(24); // 8 header + 16 data minimum
        anmf.write('ANMF', 0);
        anmf.writeUInt32LE(16, 4); // chunk data size
        // Duration at bytes 12-14 within chunk data (offset 20-22 in anmf buffer)
        const duration = frame.durationMs;
        anmf[20] = duration & 0xff;
        anmf[21] = (duration >> 8) & 0xff;
        anmf[22] = (duration >> 16) & 0xff;
        chunks.push(anmf);
    }

    const payload = Buffer.concat(chunks);
    // RIFF header: 'RIFF' + fileSize + 'WEBP' + payload
    const header = Buffer.alloc(12);
    header.write('RIFF', 0);
    header.writeUInt32LE(4 + payload.length, 4); // file size - 8
    header.write('WEBP', 8);

    const buf = Buffer.concat([header, payload]);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

// ── GIF tests ─────────────────────────────────────────────────────────

describe('parseGifDuration', () => {
    it('returns null for buffer smaller than 13 bytes', () => {
        expect(parseGifDuration(new ArrayBuffer(10))).toBeNull();
    });

    it('returns null for non-GIF signature', () => {
        const buf = new ArrayBuffer(20);
        new DataView(buf).setUint8(0, 0x50); // 'P' instead of 'G'
        expect(parseGifDuration(buf)).toBeNull();
    });

    it('returns null for GIF with zero frames', () => {
        const result = parseGifDuration(buildGif({ frames: [] }));
        expect(result).toBeNull();
    });

    it('calculates duration for a single frame (50cs = 500ms)', () => {
        const result = parseGifDuration(
            buildGif({ frames: [{ delayCentiseconds: 50 }] }),
        );
        expect(result).toEqual({ totalDuration: 500, frameCount: 1 });
    });

    it('treats 0cs delay as 10cs (100ms) per browser convention', () => {
        const result = parseGifDuration(
            buildGif({ frames: [{ delayCentiseconds: 0 }] }),
        );
        expect(result).toEqual({ totalDuration: 100, frameCount: 1 });
    });

    it('sums delays across multiple frames', () => {
        const result = parseGifDuration(
            buildGif({
                frames: [
                    { delayCentiseconds: 10 }, // 100ms
                    { delayCentiseconds: 20 }, // 200ms
                    { delayCentiseconds: 5 }, //  50ms
                ],
            }),
        );
        expect(result).toEqual({ totalDuration: 350, frameCount: 3 });
    });

    it('handles GIF with Global Color Table', () => {
        const result = parseGifDuration(
            buildGif({
                hasGCT: true,
                gctSize: 1, // 4-entry (12 byte) color table
                frames: [{ delayCentiseconds: 10 }],
            }),
        );
        expect(result).toEqual({ totalDuration: 100, frameCount: 1 });
    });
});

// ── WebP tests ────────────────────────────────────────────────────────

describe('parseWebpDuration', () => {
    it('returns null for buffer smaller than 20 bytes', () => {
        expect(parseWebpDuration(new ArrayBuffer(15))).toBeNull();
    });

    it('returns null for non-RIFF/WEBP signature', () => {
        expect(parseWebpDuration(new ArrayBuffer(24))).toBeNull();
    });

    it('returns null for static WebP (no animation flag)', () => {
        const result = parseWebpDuration(
            buildWebp({ animated: false, frames: [] }),
        );
        expect(result).toBeNull();
    });

    it('calculates duration for a single animated frame', () => {
        const result = parseWebpDuration(
            buildWebp({ frames: [{ durationMs: 200 }] }),
        );
        expect(result).toEqual({ totalDuration: 200, frameCount: 1 });
    });

    it('treats 0ms duration as 100ms fallback', () => {
        const result = parseWebpDuration(
            buildWebp({ frames: [{ durationMs: 0 }] }),
        );
        expect(result).toEqual({ totalDuration: 100, frameCount: 1 });
    });

    it('sums durations across multiple frames', () => {
        const result = parseWebpDuration(
            buildWebp({
                frames: [
                    { durationMs: 100 },
                    { durationMs: 150 },
                    { durationMs: 250 },
                ],
            }),
        );
        expect(result).toEqual({ totalDuration: 500, frameCount: 3 });
    });
});
