'use strict';

const fs = require('fs');
const path = require('path');

let sharp = null;
try {
    sharp = require('sharp');
} catch (err) {
    console.warn('[svg-inspector] sharp not available:', err.message);
}

const MAX_FULL_READ = 10 * 1024 * 1024; // 10 MB
const PARTIAL_READ = 64 * 1024;          // 64 KB for large files

// SVG element names to count
const COUNTED_ELEMENTS = [
    'path', 'rect', 'circle', 'ellipse', 'line', 'polygon', 'polyline',
    'text', 'tspan', 'g', 'use', 'image', 'clipPath', 'mask', 'filter',
    'linearGradient', 'radialGradient', 'defs', 'symbol', 'pattern',
    'foreignObject', 'marker',
];
const ELEMENT_REGEX = new RegExp(
    `<(${COUNTED_ELEMENTS.join('|')})[\\s/>]`, 'gi'
);

// ─── Plugin entry point ────────────────────────────────────────────────────────

function activate(api) {
    return {
        extractSVGMetadata,
        renderSVGInfoSection,
        copySVGSource,
        generateSVGThumbnail,
    };
}

// ─── Metadata Extractor ────────────────────────────────────────────────────────

/**
 * Extract metadata from an SVG file: dimensions, element counts, features.
 */
async function extractSVGMetadata(filePath) {
    try {
        const stats = await fs.promises.stat(filePath);
        const isLarge = stats.size > MAX_FULL_READ;

        let svgText;
        if (isLarge) {
            // For very large SVGs, read only the beginning for root attributes
            const fd = await fs.promises.open(filePath, 'r');
            const buf = Buffer.alloc(PARTIAL_READ);
            await fd.read(buf, 0, PARTIAL_READ, 0);
            await fd.close();
            svgText = buf.toString('utf8');
        } else {
            svgText = await fs.promises.readFile(filePath, 'utf8');
        }

        // Find the <svg> root tag
        const svgTagMatch = svgText.match(/<svg\b[^>]*>/is);
        if (!svgTagMatch) return null;
        const svgTag = svgTagMatch[0];

        // Extract root attributes
        const width = _extractAttr(svgTag, 'width');
        const height = _extractAttr(svgTag, 'height');
        const viewBox = _extractAttr(svgTag, 'viewBox');
        const xmlns = _extractAttr(svgTag, 'xmlns');
        const svgVersion = _extractAttr(svgTag, 'version');

        // Parse viewBox
        let viewBoxParsed = null;
        if (viewBox) {
            const parts = viewBox.trim().split(/[\s,]+/).map(Number);
            if (parts.length === 4 && parts.every(n => !isNaN(n))) {
                viewBoxParsed = { minX: parts[0], minY: parts[1], width: parts[2], height: parts[3] };
            }
        }

        // Parse numeric dimensions
        const widthPx = _parseDimension(width, viewBoxParsed?.width);
        const heightPx = _parseDimension(height, viewBoxParsed?.height);

        // Count elements
        const elementCounts = {};
        let total = 0;
        ELEMENT_REGEX.lastIndex = 0;
        let m;
        while ((m = ELEMENT_REGEX.exec(svgText)) !== null) {
            const name = m[1].toLowerCase();
            elementCounts[name] = (elementCounts[name] || 0) + 1;
            total++;
        }
        elementCounts.total = total;

        // Detect animation
        const animationTypes = [];
        if (/<animate[\s>]/i.test(svgText)) animationTypes.push('animate');
        if (/<animateTransform[\s>]/i.test(svgText)) animationTypes.push('animateTransform');
        if (/<animateMotion[\s>]/i.test(svgText)) animationTypes.push('animateMotion');
        if (/<set[\s>]/i.test(svgText)) animationTypes.push('set');
        if (/@keyframes\s/i.test(svgText)) animationTypes.push('@keyframes');
        const hasAnimation = animationTypes.length > 0;

        // Detect fonts
        const fontSet = new Set();
        const fontRegex = /font-family\s*[:=]\s*["']?([^"';})]+)/gi;
        let fm;
        while ((fm = fontRegex.exec(svgText)) !== null) {
            const families = fm[1].split(',').map(f => f.trim().replace(/^["']|["']$/g, ''));
            const genericFonts = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'inherit']);
            for (const family of families) {
                if (family && !genericFonts.has(family.toLowerCase())) {
                    fontSet.add(family);
                }
            }
        }
        const fonts = [...fontSet];

        // Feature detection
        const hasText = (elementCounts.text || 0) > 0 || (elementCounts.tspan || 0) > 0;
        const hasEmbeddedCSS = /<style[\s>]/i.test(svgText);
        const hasFilters = (elementCounts.filter || 0) > 0;
        const hasGradients = (elementCounts.linearGradient || 0) + (elementCounts.radialGradient || 0) > 0;
        const hasClipPaths = (elementCounts.clipPath || 0) > 0;
        const hasEmbeddedImages = (elementCounts.image || 0) > 0;

        return {
            width: width || null,
            height: height || null,
            widthPx,
            heightPx,
            viewBox: viewBox || null,
            viewBoxParsed,
            xmlns: xmlns || null,
            svgVersion: svgVersion || null,
            elementCounts,
            hasAnimation,
            animationTypes,
            fonts,
            hasText,
            hasEmbeddedCSS,
            hasFilters,
            hasGradients,
            hasClipPaths,
            hasEmbeddedImages,
            fileSize: stats.size,
            isApproximate: isLarge,
        };
    } catch (err) {
        console.warn('[svg-inspector] extractSVGMetadata error:', err.message);
        return null;
    }
}

// ─── Info Section Renderer ─────────────────────────────────────────────────────

/**
 * Render SVG metadata as HTML for the file inspector panel.
 */
async function renderSVGInfoSection(filePath, pluginMetadata) {
    const data = pluginMetadata?.['svg-inspector'] ?? await extractSVGMetadata(filePath);
    if (!data) return null;

    const sections = [];

    // ── Dimensions group ───────────────────────────────────────────────────
    const dimRows = [];

    if (data.widthPx && data.heightPx) {
        dimRows.push(row('Size', `${Math.round(data.widthPx)} \u00d7 ${Math.round(data.heightPx)}`));
    } else if (data.width || data.height) {
        const w = data.width || '?';
        const h = data.height || '?';
        dimRows.push(row('Size', `${w} \u00d7 ${h}`));
    }

    if (data.viewBox) {
        dimRows.push(row('viewBox', data.viewBox));
    }

    if (data.widthPx && data.heightPx && data.widthPx > 0) {
        const ratio = (data.widthPx / data.heightPx).toFixed(2);
        dimRows.push(row('Aspect Ratio', ratio));
    }

    if (data.svgVersion) {
        dimRows.push(row('SVG Version', data.svgVersion));
    }

    dimRows.push(row('File Size', _formatBytes(data.fileSize)));

    if (dimRows.length) sections.push(group('Dimensions', dimRows));

    // ── Structure group ────────────────────────────────────────────────────
    const structRows = [];
    const ec = data.elementCounts;

    const approxLabel = data.isApproximate ? ' (approx.)' : '';
    structRows.push(row('Total Elements', `${ec.total}${approxLabel}`));

    // Show non-zero element counts in logical groups
    const shapeCount = (ec.path || 0) + (ec.rect || 0) + (ec.circle || 0) +
        (ec.ellipse || 0) + (ec.line || 0) + (ec.polygon || 0) + (ec.polyline || 0);
    if (shapeCount) structRows.push(row('Shapes', shapeCount));
    if (ec.path) structRows.push(row('  Paths', ec.path));
    if (ec.text || ec.tspan) structRows.push(row('Text Elements', (ec.text || 0) + (ec.tspan || 0)));
    if (ec.g) structRows.push(row('Groups', ec.g));
    if (ec.use || ec.symbol) structRows.push(row('Symbols/Use', (ec.symbol || 0) + (ec.use || 0)));
    if (ec.image) structRows.push(row('Embedded Images', ec.image));
    if (ec.defs) structRows.push(row('Defs Blocks', ec.defs));

    if (structRows.length) sections.push(group('Structure', structRows));

    // ── Features group ─────────────────────────────────────────────────────
    const featRows = [];

    if (data.hasAnimation) {
        featRows.push(row('Animation', data.animationTypes.join(', ')));
    }
    if (data.fonts.length > 0) {
        featRows.push(row('Fonts', data.fonts.join(', ')));
    }
    if (data.hasEmbeddedCSS) featRows.push(row('Embedded CSS', 'Yes'));
    if (data.hasFilters) featRows.push(row('Filters', `${ec.filter} filter(s)`));
    if (data.hasGradients) {
        const gCount = (ec.linearGradient || 0) + (ec.radialGradient || 0);
        featRows.push(row('Gradients', `${gCount} gradient(s)`));
    }
    if (data.hasClipPaths) featRows.push(row('Clip Paths', `${ec.clipPath} clip path(s)`));

    if (featRows.length) sections.push(group('Features', featRows));

    if (sections.length === 0) return null;

    const html = sections.join('') + `
        <style>
            .exif-group-header { font-size: 11px; font-weight: 600; text-transform: uppercase;
                letter-spacing: 0.06em; opacity: 0.5; margin: 10px 0 4px; padding-top: 8px;
                border-top: 1px solid var(--border-subtle, rgba(255,255,255,0.08)); }
            .exif-group-header:first-child { margin-top: 0; border-top: none; padding-top: 0; }
        </style>`;

    // Summary
    const summaryParts = [];
    if (data.widthPx && data.heightPx) {
        summaryParts.push(`${Math.round(data.widthPx)}\u00d7${Math.round(data.heightPx)}`);
    }
    summaryParts.push(`${ec.total} elements`);
    if (data.hasAnimation) summaryParts.push('Animated');

    return {
        title: 'SVG Details',
        html,
        actions: [{ label: 'Copy SVG Source', copyText: '__DEFERRED__' }],
        summary: summaryParts.join(' \u00b7 '),
    };
}

// ─── Context Menu: Copy SVG Source ─────────────────────────────────────────────

async function copySVGSource(filePath, metadata) {
    try {
        const svgContent = await fs.promises.readFile(filePath, 'utf8');
        return { success: true, json: svgContent };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ─── Thumbnail Generator ───────────────────────────────────────────────────────

/**
 * Generate a PNG thumbnail from an SVG file using sharp with higher DPI.
 * Returns a base64 data URL or null.
 */
async function generateSVGThumbnail(filePath) {
    if (!sharp) return null;

    try {
        const svgBuffer = await fs.promises.readFile(filePath);
        const MAX_SIZE = 512;

        // Use density 150 for crisper SVG rendering (default is 72)
        const meta = await sharp(svgBuffer, { density: 150 }).metadata();
        if (!meta.width || !meta.height) return null;

        const longest = Math.max(meta.width, meta.height);
        let pipeline = sharp(svgBuffer, { density: 150 });

        if (longest > MAX_SIZE) {
            const scale = MAX_SIZE / longest;
            pipeline = pipeline.resize(
                Math.max(1, Math.round(meta.width * scale)),
                Math.max(1, Math.round(meta.height * scale)),
                { fit: 'inside', withoutEnlargement: true }
            );
        }

        const pngBuf = await pipeline.png().toBuffer();
        return 'data:image/png;base64,' + pngBuf.toString('base64');
    } catch (err) {
        console.warn('[svg-inspector] thumbnail generation error:', err.message);
        return null;
    }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function _extractAttr(tagStr, attrName) {
    const regex = new RegExp(attrName + '\\s*=\\s*["\']([^"\']*)["\']', 'i');
    const match = tagStr.match(regex);
    return match ? match[1] : null;
}

/**
 * Parse a dimension value (e.g., "200", "100px", "72pt", "50%") to pixels.
 * Returns a number or null if not determinable.
 */
function _parseDimension(raw, viewBoxFallback) {
    if (!raw) return viewBoxFallback || null;

    const trimmed = raw.trim();

    // Bare number
    const bareNum = parseFloat(trimmed);
    if (/^\d+(\.\d+)?$/.test(trimmed) && !isNaN(bareNum)) return bareNum;

    // Number with px
    const pxMatch = trimmed.match(/^(\d+(?:\.\d+)?)px$/i);
    if (pxMatch) return parseFloat(pxMatch[1]);

    // Number with pt (1pt = 1.333px)
    const ptMatch = trimmed.match(/^(\d+(?:\.\d+)?)pt$/i);
    if (ptMatch) return parseFloat(ptMatch[1]) * 1.333;

    // Number with mm (1mm = 3.7795px)
    const mmMatch = trimmed.match(/^(\d+(?:\.\d+)?)mm$/i);
    if (mmMatch) return parseFloat(mmMatch[1]) * 3.7795;

    // Number with cm (1cm = 37.795px)
    const cmMatch = trimmed.match(/^(\d+(?:\.\d+)?)cm$/i);
    if (cmMatch) return parseFloat(cmMatch[1]) * 37.795;

    // Number with in (1in = 96px)
    const inMatch = trimmed.match(/^(\d+(?:\.\d+)?)in$/i);
    if (inMatch) return parseFloat(inMatch[1]) * 96;

    // Percentage, em, rem, vw, vh — not resolvable
    return viewBoxFallback || null;
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
