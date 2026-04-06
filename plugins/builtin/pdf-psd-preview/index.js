'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

let sharp = null;
try {
    sharp = require('sharp');
} catch (err) {
    console.warn('[pdf-psd-preview] sharp not available:', err.message);
}

const COLOR_MODES = {
    0: 'Bitmap', 1: 'Grayscale', 2: 'Indexed', 3: 'RGB',
    4: 'CMYK', 7: 'Multichannel', 8: 'Duotone', 9: 'Lab',
};

const MAX_PSD_SIZE = 200 * 1024 * 1024; // 200 MB
const MAX_SIZE = 512; // thumbnail max edge

let _pdfToolCache = null;
let _pdfToolDetectionPromise = null;

// ─── Plugin entry point ────────────────────────────────────────────────────────

function activate(api) {
    // Pre-detect PDF tools at activation time (runs outside the 10s plugin timeout).
    // The result is cached for the session, so subsequent calls are instant.
    _detectPDFTool().then(info => {
        if (info.available) {
            console.log(`[pdf-psd-preview] PDF tool ready: ${info.tool} (${info.cmd})`);
        } else {
            console.log('[pdf-psd-preview] No PDF rendering tool found — placeholders will be used');
        }
    }).catch(() => {});

    return {
        extractPSDMetadata,
        extractPDFMetadata,
        renderPSDInfoSection,
        renderPDFInfoSection,
        generatePSDThumbnail,
        generatePDFThumbnail,
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PSD SUPPORT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Extract metadata from a PSD file header.
 */
async function extractPSDMetadata(filePath) {
    try {
        const stats = await fs.promises.stat(filePath);
        // Read first 64 KB for header + section navigation
        const fd = await fs.promises.open(filePath, 'r');
        const headerSize = Math.min(stats.size, 64 * 1024);
        const buf = Buffer.alloc(headerSize);
        await fd.read(buf, 0, headerSize, 0);
        await fd.close();

        const header = _parsePSDHeader(buf);
        if (!header) return null;

        header.fileSize = stats.size;
        return header;
    } catch (err) {
        console.warn('[pdf-psd-preview] extractPSDMetadata error:', err.message);
        return null;
    }
}

/**
 * Parse the PSD file header from a buffer.
 * Returns { version, channels, width, height, depth, colorMode, layerCount } or null.
 */
function _parsePSDHeader(buf) {
    if (buf.length < 26) return null;

    const sig = buf.toString('ascii', 0, 4);
    if (sig !== '8BPS') return null;

    const version = buf.readUInt16BE(4);  // 1 = PSD, 2 = PSB
    if (version !== 1 && version !== 2) return null;

    const channels = buf.readUInt16BE(12);
    const height = buf.readUInt32BE(14);
    const width = buf.readUInt32BE(18);
    const depth = buf.readUInt16BE(22);
    const colorModeRaw = buf.readUInt16BE(24);
    const colorMode = COLOR_MODES[colorModeRaw] || `Unknown (${colorModeRaw})`;

    // Try to navigate to layer count
    let layerCount = null;
    try {
        let offset = 26;

        // Color Mode Data section length
        if (offset + 4 > buf.length) throw new Error('eof');
        const cmLen = buf.readUInt32BE(offset);
        offset += 4 + cmLen;

        // Image Resources section length
        if (offset + 4 > buf.length) throw new Error('eof');
        const irLen = buf.readUInt32BE(offset);
        offset += 4 + irLen;

        // Layer and Mask Info section length
        if (offset + 4 > buf.length) throw new Error('eof');
        const lmLen = buf.readUInt32BE(offset);
        offset += 4;

        if (lmLen > 0 && offset + 4 <= buf.length) {
            // Layer Info sub-section length
            const liLen = buf.readUInt32BE(offset);
            offset += 4;
            if (liLen > 0 && offset + 2 <= buf.length) {
                layerCount = Math.abs(buf.readInt16BE(offset));
            }
        }
    } catch {
        // Could not reach layer info within the header read — that's fine
    }

    return {
        version,
        format: version === 2 ? 'PSB' : 'PSD',
        channels,
        width,
        height,
        depth,
        colorMode,
        colorModeRaw,
        layerCount,
    };
}

/**
 * Generate a PNG thumbnail from a PSD file's composite (merged) image data.
 * Returns a base64 data URL or null.
 */
async function generatePSDThumbnail(filePath) {
    if (!sharp) return null;

    try {
        const stats = await fs.promises.stat(filePath);
        if (stats.size > MAX_PSD_SIZE) {
            console.warn('[pdf-psd-preview] PSD too large, skipping thumbnail:', _formatBytes(stats.size));
            return null;
        }

        const fileBuffer = await fs.promises.readFile(filePath);
        const header = _parsePSDHeader(fileBuffer);
        if (!header) return null;
        if (header.width === 0 || header.height === 0) return null;
        if (header.width > 30000 || header.height > 30000) return null;
        if (header.depth !== 8 && header.depth !== 16) return null;

        // Navigate to the Image Data section by skipping all preceding sections
        let offset = 26;

        // Color Mode Data
        const cmLen = fileBuffer.readUInt32BE(offset);
        offset += 4 + cmLen;

        // Image Resources
        const irLen = fileBuffer.readUInt32BE(offset);
        offset += 4 + irLen;

        // Layer and Mask Info
        const lmLen = fileBuffer.readUInt32BE(offset);
        offset += 4 + lmLen;

        // Image Data section
        if (offset + 2 > fileBuffer.length) return null;
        const compression = fileBuffer.readUInt16BE(offset);
        offset += 2;

        const { width, height, channels, depth } = header;
        let channelData;

        if (compression === 0) {
            channelData = _extractRawChannels(fileBuffer, offset, width, height, channels, depth);
        } else if (compression === 1) {
            channelData = _extractRLEChannels(fileBuffer, offset, width, height, channels, depth);
        } else {
            // ZIP compression (2, 3) — not supported in v1
            console.warn('[pdf-psd-preview] Unsupported PSD compression type:', compression);
            return null;
        }

        if (!channelData) return null;

        const rgbaBuf = _convertToRGBA(channelData, width, height, header.colorMode, depth);
        if (!rgbaBuf) return null;

        // Feed raw RGBA pixels to sharp
        const longest = Math.max(width, height);
        let pipeline = sharp(rgbaBuf, { raw: { width, height, channels: 4 } });

        if (longest > MAX_SIZE) {
            const scale = MAX_SIZE / longest;
            pipeline = pipeline.resize(
                Math.max(1, Math.round(width * scale)),
                Math.max(1, Math.round(height * scale)),
                { fit: 'inside', withoutEnlargement: true }
            );
        }

        const pngBuf = await pipeline.png().toBuffer();
        return 'data:image/png;base64,' + pngBuf.toString('base64');
    } catch (err) {
        console.warn('[pdf-psd-preview] PSD thumbnail error:', err.message);
        return null;
    }
}

/**
 * Extract raw (uncompressed) channel data from PSD image data section.
 * PSD stores channels in planar order: all of channel 0, then channel 1, etc.
 */
function _extractRawChannels(buf, offset, width, height, channels, depth) {
    const bytesPerPixel = depth / 8;
    const channelSize = width * height * bytesPerPixel;
    const totalSize = channelSize * channels;

    if (offset + totalSize > buf.length) return null;

    const result = [];
    for (let c = 0; c < channels; c++) {
        const start = offset + c * channelSize;
        result.push(buf.subarray(start, start + channelSize));
    }
    return result;
}

/**
 * Extract RLE (PackBits) compressed channel data from PSD image data section.
 * Format: [scanline byte counts for all channels], then [compressed scanline data].
 */
function _extractRLEChannels(buf, offset, width, height, channels, depth) {
    const totalScanlines = height * channels;

    // Read byte counts for each scanline (2 bytes each)
    if (offset + totalScanlines * 2 > buf.length) return null;

    const scanlineByteCounts = [];
    for (let i = 0; i < totalScanlines; i++) {
        scanlineByteCounts.push(buf.readUInt16BE(offset));
        offset += 2;
    }

    const bytesPerPixel = depth / 8;
    const scanlineBytes = width * bytesPerPixel;
    const result = [];

    for (let c = 0; c < channels; c++) {
        const channelBuf = Buffer.alloc(height * scanlineBytes);

        for (let row = 0; row < height; row++) {
            const scanlineIdx = c * height + row;
            const compressedLen = scanlineByteCounts[scanlineIdx];

            if (offset + compressedLen > buf.length) return null;

            const compressedData = buf.subarray(offset, offset + compressedLen);
            offset += compressedLen;

            // Decompress PackBits into the channel buffer
            _decompressPackBits(compressedData, channelBuf, row * scanlineBytes, scanlineBytes);
        }

        result.push(channelBuf);
    }

    return result;
}

/**
 * PackBits decompression for a single scanline.
 */
function _decompressPackBits(src, dst, dstOffset, expectedLen) {
    let srcPos = 0;
    let dstPos = dstOffset;
    const dstEnd = dstOffset + expectedLen;

    while (srcPos < src.length && dstPos < dstEnd) {
        const n = src[srcPos] > 127 ? src[srcPos] - 256 : src[srcPos]; // signed byte
        srcPos++;

        if (n >= 0 && n <= 127) {
            // Copy next n+1 bytes literally
            const count = n + 1;
            for (let i = 0; i < count && srcPos < src.length && dstPos < dstEnd; i++) {
                dst[dstPos++] = src[srcPos++];
            }
        } else if (n >= -127 && n <= -1) {
            // Repeat next byte 1-n times
            const count = 1 - n;
            const value = srcPos < src.length ? src[srcPos++] : 0;
            for (let i = 0; i < count && dstPos < dstEnd; i++) {
                dst[dstPos++] = value;
            }
        }
        // n === -128: no-op
    }
}

/**
 * Convert planar channel data to interleaved RGBA buffer.
 * Handles RGB, RGBA, CMYK, and Grayscale modes.
 */
function _convertToRGBA(channelData, width, height, colorMode, depth) {
    const pixelCount = width * height;
    const rgba = Buffer.alloc(pixelCount * 4);
    const bytesPerPixel = depth / 8;
    const is16bit = depth === 16;

    const readPixel = (channelBuf, pixelIdx) => {
        if (is16bit) {
            const val = channelBuf.readUInt16BE(pixelIdx * 2);
            return Math.round(val / 257); // 16-bit to 8-bit
        }
        return channelBuf[pixelIdx];
    };

    if (colorMode === 'RGB') {
        const rCh = channelData[0];
        const gCh = channelData[1];
        const bCh = channelData[2];
        const aCh = channelData.length >= 4 ? channelData[3] : null;

        for (let i = 0; i < pixelCount; i++) {
            const off = i * 4;
            rgba[off] = readPixel(rCh, i);
            rgba[off + 1] = readPixel(gCh, i);
            rgba[off + 2] = readPixel(bCh, i);
            rgba[off + 3] = aCh ? readPixel(aCh, i) : 255;
        }
    } else if (colorMode === 'CMYK') {
        const cCh = channelData[0];
        const mCh = channelData[1];
        const yCh = channelData[2];
        const kCh = channelData[3];

        for (let i = 0; i < pixelCount; i++) {
            const c = readPixel(cCh, i) / 255;
            const m = readPixel(mCh, i) / 255;
            const y = readPixel(yCh, i) / 255;
            const k = readPixel(kCh, i) / 255;

            const off = i * 4;
            rgba[off] = Math.round(255 * (1 - c) * (1 - k));
            rgba[off + 1] = Math.round(255 * (1 - m) * (1 - k));
            rgba[off + 2] = Math.round(255 * (1 - y) * (1 - k));
            rgba[off + 3] = 255;
        }
    } else if (colorMode === 'Grayscale') {
        const gCh = channelData[0];
        const aCh = channelData.length >= 2 ? channelData[1] : null;

        for (let i = 0; i < pixelCount; i++) {
            const g = readPixel(gCh, i);
            const off = i * 4;
            rgba[off] = g;
            rgba[off + 1] = g;
            rgba[off + 2] = g;
            rgba[off + 3] = aCh ? readPixel(aCh, i) : 255;
        }
    } else if (colorMode === 'Lab') {
        // Basic Lab→RGB conversion
        const lCh = channelData[0];
        const aCh = channelData[1];
        const bCh = channelData[2];

        for (let i = 0; i < pixelCount; i++) {
            // PSD stores L as 0-255 (maps to 0-100), a/b as 0-255 (maps to -128..127)
            const L = readPixel(lCh, i) / 255 * 100;
            const a = readPixel(aCh, i) - 128;
            const b = readPixel(bCh, i) - 128;

            // Lab to XYZ (D65 illuminant)
            const fy = (L + 16) / 116;
            const fx = a / 500 + fy;
            const fz = fy - b / 200;

            const xr = fx > 0.206897 ? fx * fx * fx : (fx - 16 / 116) / 7.787;
            const yr = fy > 0.206897 ? fy * fy * fy : (fy - 16 / 116) / 7.787;
            const zr = fz > 0.206897 ? fz * fz * fz : (fz - 16 / 116) / 7.787;

            const X = xr * 0.95047;
            const Y = yr * 1.0;
            const Z = zr * 1.08883;

            // XYZ to sRGB
            let r = X * 3.2406 + Y * -1.5372 + Z * -0.4986;
            let g = X * -0.9689 + Y * 1.8758 + Z * 0.0415;
            let bl = X * 0.0557 + Y * -0.2040 + Z * 1.0570;

            // Gamma
            r = r > 0.0031308 ? 1.055 * Math.pow(r, 1 / 2.4) - 0.055 : 12.92 * r;
            g = g > 0.0031308 ? 1.055 * Math.pow(g, 1 / 2.4) - 0.055 : 12.92 * g;
            bl = bl > 0.0031308 ? 1.055 * Math.pow(bl, 1 / 2.4) - 0.055 : 12.92 * bl;

            const off = i * 4;
            rgba[off] = Math.max(0, Math.min(255, Math.round(r * 255)));
            rgba[off + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
            rgba[off + 2] = Math.max(0, Math.min(255, Math.round(bl * 255)));
            rgba[off + 3] = 255;
        }
    } else {
        // Unsupported color mode — try treating as RGB anyway
        if (channelData.length >= 3) {
            for (let i = 0; i < pixelCount; i++) {
                const off = i * 4;
                rgba[off] = readPixel(channelData[0], i);
                rgba[off + 1] = readPixel(channelData[1], i);
                rgba[off + 2] = readPixel(channelData[2], i);
                rgba[off + 3] = 255;
            }
        } else {
            return null;
        }
    }

    return rgba;
}

/**
 * Render PSD metadata as HTML for the file inspector panel.
 */
function renderPSDInfoSection(filePath, pluginMetadata) {
    const data = pluginMetadata?.['psd-metadata'];
    if (!data) return null;

    const rows = [];
    rows.push(row('Dimensions', `${data.width} \u00d7 ${data.height}`));
    rows.push(row('Color Mode', data.colorMode));
    rows.push(row('Bit Depth', `${data.depth}-bit`));
    rows.push(row('Channels', data.channels));
    rows.push(row('Format', data.format));
    if (data.layerCount !== null) rows.push(row('Layers', data.layerCount));
    if (data.fileSize) rows.push(row('File Size', _formatBytes(data.fileSize)));

    const html = rows.join('') + `
        <style>
            .exif-group-header { font-size: 11px; font-weight: 600; text-transform: uppercase;
                letter-spacing: 0.06em; opacity: 0.5; margin: 10px 0 4px; padding-top: 8px;
                border-top: 1px solid var(--border-subtle, rgba(255,255,255,0.08)); }
            .exif-group-header:first-child { margin-top: 0; border-top: none; padding-top: 0; }
        </style>`;

    const summaryParts = [];
    summaryParts.push(`${data.width}\u00d7${data.height}`);
    summaryParts.push(`${data.colorMode} ${data.depth}-bit`);
    if (data.layerCount !== null) summaryParts.push(`${data.layerCount} layers`);

    return {
        title: 'PSD Details',
        html,
        actions: [],
        summary: summaryParts.join(' \u00b7 '),
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PDF SUPPORT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Extract metadata from a PDF file header.
 */
async function extractPDFMetadata(filePath) {
    try {
        const stats = await fs.promises.stat(filePath);

        // Read first 64 KB for header parsing
        const fd = await fs.promises.open(filePath, 'r');
        const readSize = Math.min(stats.size, 64 * 1024);
        const buf = Buffer.alloc(readSize);
        await fd.read(buf, 0, readSize, 0);
        await fd.close();

        const headerText = buf.toString('latin1');

        // PDF version
        const versionMatch = headerText.match(/%PDF-(\d+\.\d+)/);
        const pdfVersion = versionMatch ? versionMatch[1] : null;
        if (!pdfVersion) return null; // Not a PDF file

        // Encryption check
        const encrypted = /\/Encrypt\b/.test(headerText);

        // Page count — heuristic, may not always be in first 64 KB
        let pageCount = null;
        const countMatch = headerText.match(/\/Type\s*\/Pages[^]*?\/Count\s+(\d+)/);
        if (countMatch) {
            pageCount = parseInt(countMatch[1], 10);
        }

        // Title
        let title = null;
        const titleMatch = headerText.match(/\/Title\s*\(([^)]*)\)/);
        if (titleMatch) title = titleMatch[1];

        // Author
        let author = null;
        const authorMatch = headerText.match(/\/Author\s*\(([^)]*)\)/);
        if (authorMatch) author = authorMatch[1];

        // Detect available PDF tool
        const toolInfo = await _detectPDFTool();

        return {
            pdfVersion,
            encrypted,
            pageCount,
            title,
            author,
            fileSize: stats.size,
            hasToolAvailable: toolInfo.available,
            toolUsed: toolInfo.tool,
        };
    } catch (err) {
        console.warn('[pdf-psd-preview] extractPDFMetadata error:', err.message);
        return null;
    }
}

/**
 * Detect available system tool for PDF rendering.
 * Checks in priority order: pdftoppm (poppler), mutool (mupdf), magick (ImageMagick 7),
 * Ghostscript (probes common install dirs on Windows since GS is often not in PATH).
 * Result is cached for the session.
 */
function _detectPDFTool() {
    if (_pdfToolCache !== null) return Promise.resolve(_pdfToolCache);
    // Deduplicate concurrent detection calls — all callers wait on the same promise
    if (_pdfToolDetectionPromise) return _pdfToolDetectionPromise;
    _pdfToolDetectionPromise = _doDetectPDFTool().then(result => {
        _pdfToolCache = result;
        _pdfToolDetectionPromise = null;
        return result;
    });
    return _pdfToolDetectionPromise;
}

async function _doDetectPDFTool() {
    const isWin = process.platform === 'win32';

    // Tools to check on PATH first
    const pathTools = [
        { cmd: 'pdftoppm', args: ['-v'], name: 'pdftoppm' },
        { cmd: 'mutool', args: ['--version'], name: 'mutool' },
        { cmd: 'magick', args: ['--version'], name: 'magick' },
        ...(isWin ? [
            { cmd: 'gswin64c', args: ['-v'], name: 'gswin64c' },
            { cmd: 'gswin32c', args: ['-v'], name: 'gswin32c' },
        ] : [
            { cmd: 'gs', args: ['-v'], name: 'gs' },
        ]),
    ];

    // Check all PATH tools in parallel for speed (ENOENT returns instantly)
    const pathResults = await Promise.all(pathTools.map(async tool => ({
        ...tool,
        available: await _tryExec(tool.cmd, tool.args),
    })));
    const found = pathResults.find(r => r.available);
    if (found) {
        return { available: true, tool: found.name, cmd: found.cmd };
    }

    // On Windows, probe common installation directories for Ghostscript
    if (isWin) {
        const gsDirs = await _findGhostscriptWindows();
        for (const gsPath of gsDirs) {
            const available = await _tryExec(gsPath, ['-v']);
            if (available) {
                console.log(`[pdf-psd-preview] Found Ghostscript at: ${gsPath}`);
                return { available: true, tool: 'gswin64c', cmd: gsPath };
            }
        }
    }

    return { available: false, tool: null, cmd: null };
}

/**
 * Search common Windows directories for Ghostscript executables.
 * Returns an array of full paths to try.
 */
async function _findGhostscriptWindows() {
    const candidates = [];
    const programDirs = [
        process.env['ProgramFiles'] || 'C:\\Program Files',
        process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    ];

    for (const programDir of programDirs) {
        const gsRoot = path.join(programDir, 'gs');
        try {
            const entries = await fs.promises.readdir(gsRoot, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory() && entry.name.startsWith('gs')) {
                    // Check for gswin64c.exe and gswin32c.exe in the bin subdirectory
                    const binDir = path.join(gsRoot, entry.name, 'bin');
                    candidates.push(path.join(binDir, 'gswin64c.exe'));
                    candidates.push(path.join(binDir, 'gswin32c.exe'));
                }
            }
        } catch {
            // Directory doesn't exist or can't be read
        }
    }

    // Sort by version descending (higher version dirs come first)
    candidates.sort((a, b) => b.localeCompare(a));
    return candidates;
}

function _tryExec(cmd, args) {
    return new Promise(resolve => {
        try {
            execFile(cmd, args, { timeout: 1500, windowsHide: true }, (err) => {
                resolve(!err);
            });
        } catch {
            resolve(false);
        }
    });
}

function _execFileAsync(cmd, args, options = {}) {
    return new Promise((resolve, reject) => {
        execFile(cmd, args, { timeout: 8000, ...options }, (err, stdout, stderr) => {
            if (err) reject(err);
            else resolve({ stdout, stderr });
        });
    });
}

/**
 * Generate a PNG thumbnail from a PDF file using system tools.
 * Falls back to a styled placeholder if no tool is available.
 */
async function generatePDFThumbnail(filePath) {
    if (!sharp) return null;

    try {
        const toolInfo = await _detectPDFTool();

        if (!toolInfo.available) {
            // Return null instead of a placeholder — placeholders should not be cached
            // in the thumbnail cache (they'd prevent real thumbnails from being generated
            // once a tool is installed). The renderer handles null gracefully.
            return null;
        }

        // Use plugin cache directory for temp files
        const cacheDir = path.join(path.dirname(path.dirname(__dirname)), '..', '..');
        const tempDir = path.join(require('os').tmpdir(), 'pdf-psd-preview-thumbs');
        await fs.promises.mkdir(tempDir, { recursive: true });

        const hash = _simpleHash(filePath);
        const tempBase = path.join(tempDir, hash);

        let pngBuffer = null;

        // Use toolInfo.cmd which may be a full path (e.g. for Ghostscript found outside PATH)
        const toolCmd = toolInfo.cmd;
        const toolName = toolInfo.tool;

        if (toolName === 'pdftoppm') {
            try {
                await _execFileAsync(toolCmd, [
                    '-png', '-f', '1', '-l', '1', '-scale-to', String(MAX_SIZE),
                    filePath, tempBase
                ]);
                // pdftoppm appends -1.png or -01.png
                const outFile = await _findPdftoppmOutput(tempDir, hash);
                if (outFile) {
                    pngBuffer = await fs.promises.readFile(outFile);
                    fs.promises.unlink(outFile).catch(() => {});
                }
            } catch (err) {
                console.warn('[pdf-psd-preview] pdftoppm failed:', err.message);
            }
        } else if (toolName === 'mutool') {
            const outFile = tempBase + '.png';
            try {
                await _execFileAsync(toolCmd, [
                    'draw', '-o', outFile, '-F', 'png',
                    '-w', String(MAX_SIZE), '-h', String(MAX_SIZE),
                    filePath, '1'
                ]);
                pngBuffer = await fs.promises.readFile(outFile);
                fs.promises.unlink(outFile).catch(() => {});
            } catch (err) {
                console.warn('[pdf-psd-preview] mutool failed:', err.message);
            }
        } else if (toolName === 'magick') {
            const outFile = tempBase + '.png';
            try {
                await _execFileAsync(toolCmd, [
                    filePath + '[0]',
                    '-thumbnail', `${MAX_SIZE}x${MAX_SIZE}`,
                    '-background', 'white', '-alpha', 'remove',
                    outFile
                ]);
                pngBuffer = await fs.promises.readFile(outFile);
                fs.promises.unlink(outFile).catch(() => {});
            } catch (err) {
                console.warn('[pdf-psd-preview] magick failed:', err.message);
            }
        } else if (toolName === 'gswin64c' || toolName === 'gswin32c' || toolName === 'gs') {
            const outFile = tempBase + '.png';
            try {
                await _execFileAsync(toolCmd, [
                    '-dBATCH', '-dNOPAUSE', '-dQUIET', '-dFirstPage=1', '-dLastPage=1',
                    '-sDEVICE=png16m', '-r72',
                    `-sOutputFile=${outFile}`,
                    filePath
                ], { timeout: 10000 });
                pngBuffer = await fs.promises.readFile(outFile);
                // Resize to MAX_SIZE (GS renders at full page size)
                if (pngBuffer && sharp) {
                    const meta = await sharp(pngBuffer).metadata();
                    if (meta.width > MAX_SIZE || meta.height > MAX_SIZE) {
                        pngBuffer = await sharp(pngBuffer).resize(MAX_SIZE, MAX_SIZE, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
                    }
                }
                fs.promises.unlink(outFile).catch(() => {});
            } catch (err) {
                console.warn(`[pdf-psd-preview] ${toolName} failed:`, err.message);
            }
        }

        if (!pngBuffer) return null;

        return 'data:image/png;base64,' + pngBuffer.toString('base64');
    } catch (err) {
        console.warn('[pdf-psd-preview] PDF thumbnail error:', err.message);
        return null;
    }
}

/**
 * Find the output file from pdftoppm (it appends page numbers).
 */
async function _findPdftoppmOutput(dir, prefix) {
    try {
        const files = await fs.promises.readdir(dir);
        const match = files.find(f => f.startsWith(prefix) && f.endsWith('.png'));
        return match ? path.join(dir, match) : null;
    } catch {
        return null;
    }
}

/**
 * Generate a styled placeholder thumbnail for a PDF file.
 */
async function _generatePDFPlaceholder(filePath) {
    if (!sharp) return null;

    try {
        const fileName = path.basename(filePath, '.pdf');
        const displayName = fileName.length > 30 ? fileName.substring(0, 27) + '...' : fileName;

        const svg = `<svg width="384" height="512" xmlns="http://www.w3.org/2000/svg">
            <rect width="384" height="512" fill="#2a2a2a" rx="8"/>
            <rect x="64" y="48" width="256" height="340" fill="#3a3a3a" stroke="#555" stroke-width="2" rx="4"/>
            <line x1="96" y1="140" x2="288" y2="140" stroke="#555" stroke-width="2"/>
            <line x1="96" y1="170" x2="260" y2="170" stroke="#555" stroke-width="2"/>
            <line x1="96" y1="200" x2="280" y2="200" stroke="#555" stroke-width="2"/>
            <line x1="96" y1="230" x2="240" y2="230" stroke="#555" stroke-width="2"/>
            <line x1="96" y1="260" x2="270" y2="260" stroke="#555" stroke-width="2"/>
            <text x="192" y="108" text-anchor="middle" font-family="sans-serif"
                  font-size="42" font-weight="bold" fill="#e53935">PDF</text>
            <text x="192" y="440" text-anchor="middle" font-family="sans-serif"
                  font-size="20" fill="#999">${_escSvg(displayName)}</text>
        </svg>`;

        const pngBuf = await sharp(Buffer.from(svg)).resize(MAX_SIZE, MAX_SIZE, { fit: 'inside' }).png().toBuffer();
        return 'data:image/png;base64,' + pngBuf.toString('base64');
    } catch (err) {
        console.warn('[pdf-psd-preview] placeholder generation error:', err.message);
        return null;
    }
}

/**
 * Render PDF metadata as HTML for the file inspector panel.
 */
function renderPDFInfoSection(filePath, pluginMetadata) {
    const data = pluginMetadata?.['pdf-metadata'];
    if (!data) return null;

    const rows = [];
    rows.push(row('PDF Version', data.pdfVersion));
    if (data.pageCount !== null) rows.push(row('Pages', data.pageCount));
    if (data.title) rows.push(row('Title', data.title));
    if (data.author) rows.push(row('Author', data.author));
    if (data.encrypted) rows.push(row('Encrypted', 'Yes'));
    if (data.fileSize) rows.push(row('File Size', _formatBytes(data.fileSize)));
    if (data.hasToolAvailable) {
        const toolDisplayNames = {
            pdftoppm: 'pdftoppm (Poppler)',
            mutool: 'mutool (MuPDF)',
            magick: 'magick (ImageMagick)',
            gswin64c: 'Ghostscript (64-bit)',
            gswin32c: 'Ghostscript (32-bit)',
            gs: 'Ghostscript',
        };
        rows.push(row('Preview Tool', toolDisplayNames[data.toolUsed] || data.toolUsed));
    } else {
        rows.push(row('Preview Tool', 'None found \u2014 install Poppler, MuPDF, ImageMagick, or Ghostscript for thumbnails'));
    }

    const html = rows.join('') + `
        <style>
            .exif-group-header { font-size: 11px; font-weight: 600; text-transform: uppercase;
                letter-spacing: 0.06em; opacity: 0.5; margin: 10px 0 4px; padding-top: 8px;
                border-top: 1px solid var(--border-subtle, rgba(255,255,255,0.08)); }
            .exif-group-header:first-child { margin-top: 0; border-top: none; padding-top: 0; }
        </style>`;

    const summaryParts = [];
    summaryParts.push(`PDF ${data.pdfVersion}`);
    if (data.pageCount !== null) summaryParts.push(`${data.pageCount} pages`);
    if (data.encrypted) summaryParts.push('Encrypted');

    return {
        title: 'PDF Details',
        html,
        actions: [],
        summary: summaryParts.join(' \u00b7 '),
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SHARED HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function _simpleHash(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xffffffff;
    }
    return (hash >>> 0).toString(16);
}

function _escSvg(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function _formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const k = 1024;
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1);
    return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function row(label, value) {
    if (value === null || value === undefined || value === '') return '';
    return `<div class="file-info-detail-row">
        <span class="file-info-detail-label">${escHtml(label)}:</span>
        <span class="file-info-detail-value">${escHtml(String(value))}</span>
    </div>`;
}

function group(title, rows) {
    const content = rows.join('');
    if (!content) return '';
    return `<div class="exif-group-header">${escHtml(title)}</div>${content}`;
}

function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

module.exports = { activate };
