/**
 * Binary parsers for GIF and animated WebP duration extraction.
 * No dependencies – uses DataView on ArrayBuffer directly.
 */

/**
 * Parse a GIF89a/GIF87a binary to extract total animation duration and frame count.
 * @param {ArrayBuffer} buffer
 * @returns {{ totalDuration: number, frameCount: number } | null}
 */
function parseGifDuration(buffer) {
    const data = new DataView(buffer);
    const len = buffer.byteLength;
    if (len < 13) return null;

    // Verify GIF signature
    const sig = String.fromCharCode(data.getUint8(0), data.getUint8(1), data.getUint8(2));
    if (sig !== 'GIF') return null;

    let offset = 6; // skip signature + version (6 bytes)

    // Logical Screen Descriptor
    const packed = data.getUint8(offset + 4);
    const hasGCT = (packed >> 7) & 1;
    const gctSize = packed & 0x07;
    offset += 7; // LSD is 7 bytes

    // Skip Global Color Table
    if (hasGCT) {
        offset += 3 * (1 << (gctSize + 1));
    }

    let totalDuration = 0;
    let frameCount = 0;

    while (offset < len) {
        const sentinel = data.getUint8(offset);
        offset++;

        if (sentinel === 0x3B) {
            // Trailer – end of GIF
            break;
        } else if (sentinel === 0x21) {
            // Extension block
            if (offset >= len) break;
            const label = data.getUint8(offset);
            offset++;

            if (label === 0xF9) {
                // Graphic Control Extension
                if (offset >= len) break;
                const blockSize = data.getUint8(offset);
                offset++;
                if (blockSize >= 4 && offset + 4 <= len) {
                    let delay = data.getUint16(offset + 1, true); // little-endian, centiseconds
                    if (delay === 0) delay = 10; // browsers render 0-delay as ~10cs (~100ms)
                    totalDuration += delay * 10; // convert to milliseconds
                    offset += blockSize;
                }
                // Skip block terminator
                if (offset < len) offset++; // zero-length sub-block
            } else {
                // Skip other extension sub-blocks
                while (offset < len) {
                    const subSize = data.getUint8(offset);
                    offset++;
                    if (subSize === 0) break;
                    offset += subSize;
                }
            }
        } else if (sentinel === 0x2C) {
            // Image Descriptor
            frameCount++;
            if (offset + 9 > len) break;
            const imgPacked = data.getUint8(offset + 8);
            const hasLCT = (imgPacked >> 7) & 1;
            const lctSize = imgPacked & 0x07;
            offset += 9;

            // Skip Local Color Table
            if (hasLCT) {
                offset += 3 * (1 << (lctSize + 1));
            }

            // Skip LZW minimum code size
            if (offset < len) offset++;

            // Skip LZW data sub-blocks
            while (offset < len) {
                const subSize = data.getUint8(offset);
                offset++;
                if (subSize === 0) break;
                offset += subSize;
            }
        } else {
            // Unknown block – try to skip
            break;
        }
    }

    if (frameCount === 0) return null;
    return { totalDuration, frameCount };
}

/**
 * Parse an animated WebP (RIFF container) to extract total animation duration.
 * Returns null for static WebP files.
 * @param {ArrayBuffer} buffer
 * @returns {{ totalDuration: number, frameCount: number } | null}
 */
function parseWebpDuration(buffer) {
    const data = new DataView(buffer);
    const len = buffer.byteLength;
    if (len < 20) return null;

    // Verify RIFF + WEBP signature
    const riff = data.getUint32(0, false); // 'RIFF'
    const webp = data.getUint32(8, false); // 'WEBP'
    if (riff !== 0x52494646 || webp !== 0x57454250) return null;

    let offset = 12;
    let isAnimated = false;
    let totalDuration = 0;
    let frameCount = 0;

    while (offset + 8 <= len) {
        const fourcc = data.getUint32(offset, false);
        const chunkSize = data.getUint32(offset + 4, true); // little-endian
        const chunkDataStart = offset + 8;

        if (fourcc === 0x56503858) {
            // 'VP8X' – extended format; animation flag is bit 1 of the flags byte
            if (chunkDataStart < len) {
                isAnimated = !!(data.getUint8(chunkDataStart) & 0x02);
            }
        } else if (fourcc === 0x414E4D46) {
            // 'ANMF' – animation frame (presence implies animated even without VP8X flag)
            isAnimated = true;
            frameCount++;
            if (chunkDataStart + 16 <= len) {
                // Frame duration is at bytes 12-14 (24-bit LE) within the ANMF chunk data
                const b0 = data.getUint8(chunkDataStart + 12);
                const b1 = data.getUint8(chunkDataStart + 13);
                const b2 = data.getUint8(chunkDataStart + 14);
                let duration = b0 | (b1 << 8) | (b2 << 16);
                if (duration === 0) duration = 100; // same fallback as GIF
                totalDuration += duration;
            }
        }

        // Move to next chunk (padded to even boundary)
        offset = chunkDataStart + chunkSize + (chunkSize & 1);
    }

    if (!isAnimated || frameCount === 0) return null;
    return { totalDuration, frameCount };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parseGifDuration, parseWebpDuration };
}
