'use strict';

let pngChunksExtract = null;
try {
    pngChunksExtract = require('png-chunks-extract');
} catch (err) {
    console.warn('[sd-metadata] png-chunks-extract not available:', err.message);
}

let ExifReader = null;
try {
    ExifReader = require('exifreader');
} catch (err) {
    console.warn('[sd-metadata] exifreader not available:', err.message);
}

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ─── Plugin entry point ────────────────────────────────────────────────────────

function activate(api) {
    return {
        extractSDParams,
        renderSDSection,
        copySDParams,
    };
}

// ─── Metadata Extractor ────────────────────────────────────────────────────────

/**
 * Extract Stable Diffusion generation parameters from an image file.
 * Supports A1111/Forge/SDXL (PNG tEXt "parameters"), InvokeAI (PNG tEXt "Dream"),
 * and EXIF UserComment for JPEG/WebP.
 *
 * Returns { source, raw, prompt, negativePrompt, params } or null.
 */
async function extractSDParams(filePath) {
    try {
        const ext = path.extname(filePath).toLowerCase();

        // PNG: try text chunks first
        if (ext === '.png') {
            const result = _tryExtractFromPNG(filePath);
            if (result) return result;
        }

        // JPEG/WebP (and PNG fallback): try EXIF UserComment
        if (ext === '.jpg' || ext === '.jpeg' || ext === '.webp' || ext === '.png') {
            const result = await _tryExtractFromEXIF(filePath);
            if (result) return result;
        }

        return null;
    } catch (error) {
        console.warn('[sd-metadata] extractSDParams error:', error.message);
        return null;
    }
}

/**
 * Try to extract SD parameters from PNG text chunks.
 */
function _tryExtractFromPNG(filePath) {
    if (!pngChunksExtract) return null;

    try {
        const fileBuffer = fs.readFileSync(filePath);
        const chunks = pngChunksExtract(fileBuffer);

        for (const chunk of chunks) {
            if (chunk.name !== 'tEXt' && chunk.name !== 'zTXt' && chunk.name !== 'iTXt') continue;

            try {
                const textData = _decodeChunk(chunk);
                if (textData === null) continue;

                const nullIndex = textData.indexOf('\0');
                if (nullIndex === -1) continue;

                const key = textData.substring(0, nullIndex);
                const value = textData.substring(nullIndex + 1);

                // Skip JSON values — those are ComfyUI workflow data
                const trimmedValue = value.trim();
                if (trimmedValue.startsWith('{') || trimmedValue.startsWith('[')) continue;

                if (key === 'parameters') {
                    const parsed = _parseA1111Format(value);
                    if (parsed) return { source: 'png-parameters', raw: value, ...parsed };
                }

                if (key === 'Dream') {
                    const parsed = _parseDreamFormat(value);
                    if (parsed) return { source: 'png-dream', raw: value, ...parsed };
                }
            } catch (chunkError) {
                console.warn('[sd-metadata] Error processing PNG chunk:', chunkError.message);
                continue;
            }
        }
    } catch (err) {
        console.warn('[sd-metadata] PNG extraction error:', err.message);
    }

    return null;
}

/**
 * Try to extract SD parameters from EXIF UserComment field.
 */
async function _tryExtractFromEXIF(filePath) {
    if (!ExifReader) return null;

    try {
        const buf = await fs.promises.readFile(filePath);
        const tags = ExifReader.load(buf, { expanded: true });
        const exif = tags?.exif || {};

        // Check UserComment
        const userComment = exif['UserComment'];
        if (!userComment) return null;

        let commentText = null;
        if (userComment.description && typeof userComment.description === 'string') {
            commentText = userComment.description;
        } else if (userComment.value && typeof userComment.value === 'string') {
            commentText = userComment.value;
        } else if (Array.isArray(userComment.value)) {
            // Some formats store as byte array
            try {
                commentText = Buffer.from(userComment.value).toString('utf8').replace(/^\0+/, '');
            } catch { /* skip */ }
        }

        if (!commentText || commentText.length < 10) return null;

        // Skip if it looks like JSON (ComfyUI)
        const trimmed = commentText.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) return null;

        const parsed = _parseA1111Format(commentText);
        if (parsed && (parsed.prompt || Object.keys(parsed.params).length > 0)) {
            return { source: 'exif-usercomment', raw: commentText, ...parsed };
        }
    } catch (err) {
        if (err.name !== 'MetadataMissingError') {
            console.warn('[sd-metadata] EXIF extraction error:', err.message);
        }
    }

    return null;
}

// ─── A1111 Format Parser ───────────────────────────────────────────────────────

/**
 * Parse A1111/Forge/SDXL parameter text format:
 *   positive prompt
 *   Negative prompt: negative prompt
 *   Steps: 20, Sampler: Euler a, CFG scale: 7, Seed: 12345, ...
 *
 * Returns { prompt, negativePrompt, params } or null.
 */
function _parseA1111Format(text) {
    if (!text || typeof text !== 'string') return null;
    text = text.trim();
    if (text.length === 0) return null;

    const lines = text.split('\n');

    // Find the params line (last line starting with "Steps:")
    let paramsLineIdx = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
        const trimmed = lines[i].trim();
        if (/^Steps:\s*\d/.test(trimmed)) {
            paramsLineIdx = i;
            break;
        }
    }

    // Fallback: look for a line with 3+ key-value pairs
    if (paramsLineIdx === -1) {
        for (let i = lines.length - 1; i >= 0; i--) {
            const trimmed = lines[i].trim();
            const kvCount = (trimmed.match(/[A-Za-z][A-Za-z0-9 ]*:/g) || []).length;
            if (kvCount >= 3) {
                paramsLineIdx = i;
                break;
            }
        }
    }

    // If still not found, this might just be a prompt with no params
    if (paramsLineIdx === -1) {
        // Check if the entire text looks like a prompt (no key-value structure)
        if (text.length > 5) {
            return { prompt: text, negativePrompt: null, params: {} };
        }
        return null;
    }

    // Parse key-value pairs from the params line(s)
    const paramsText = lines.slice(paramsLineIdx).join(', ');
    const params = _parseKeyValuePairs(paramsText);

    // Everything before the params line is prompt text
    const promptBlock = lines.slice(0, paramsLineIdx).join('\n').trim();

    // Split by "Negative prompt:" — use the LAST occurrence before params
    let prompt = promptBlock;
    let negativePrompt = null;

    const negIdx = promptBlock.lastIndexOf('Negative prompt:');
    if (negIdx !== -1) {
        prompt = promptBlock.substring(0, negIdx).trim();
        negativePrompt = promptBlock.substring(negIdx + 'Negative prompt:'.length).trim();
    }

    // If prompt is empty but we have params, that's still valid
    if (!prompt && Object.keys(params).length === 0) return null;

    return { prompt: prompt || null, negativePrompt: negativePrompt || null, params };
}

/**
 * Parse A1111 key-value pairs from a params string.
 * Format: "Steps: 20, Sampler: Euler a, CFG scale: 7, ..."
 * Handles values containing commas by splitting on ", Key:" boundaries.
 */
function _parseKeyValuePairs(text) {
    const params = {};
    if (!text) return params;

    // Split on ", Key:" boundaries where Key starts with an uppercase letter or known key
    // Use a lookahead to keep the key in the next segment
    const parts = text.split(/,\s*(?=[A-Z][A-Za-z0-9 /\-_.]*:\s)/);

    for (const part of parts) {
        const colonIdx = part.indexOf(':');
        if (colonIdx === -1) continue;

        const key = part.substring(0, colonIdx).trim();
        const value = part.substring(colonIdx + 1).trim();

        // Skip empty keys or values
        if (!key) continue;

        // Clean up value — remove trailing commas
        params[key] = value.replace(/,\s*$/, '');
    }

    return params;
}

/**
 * Parse InvokeAI "Dream" format:
 *   "a beautiful landscape" -s 50 -S 12345 -W 512 -H 768 -C 7.5 -A k_euler_a
 */
function _parseDreamFormat(text) {
    if (!text || typeof text !== 'string') return null;
    text = text.trim();
    if (text.length === 0) return null;

    const params = {};
    let prompt = '';
    let negativePrompt = null;

    // Extract quoted prompt
    const quotedMatch = text.match(/^"([^"]*)"(.*)$/s);
    if (quotedMatch) {
        prompt = quotedMatch[1];
        text = quotedMatch[2];
    } else {
        // Prompt is everything before the first flag
        const flagIdx = text.search(/\s-[a-zA-Z]/);
        if (flagIdx !== -1) {
            prompt = text.substring(0, flagIdx).trim();
            text = text.substring(flagIdx);
        } else {
            prompt = text;
            text = '';
        }
    }

    // Parse flags
    const flagMap = {
        '-s': 'Steps', '-S': 'Seed', '-W': 'Width', '-H': 'Height',
        '-C': 'CFG scale', '-A': 'Sampler', '-n': 'negative',
    };

    const flagRegex = /\s(-[a-zA-Z])\s+(\S+)/g;
    let match;
    while ((match = flagRegex.exec(text)) !== null) {
        const flag = match[1];
        const value = match[2];
        const key = flagMap[flag];
        if (key === 'negative') {
            negativePrompt = value;
        } else if (key) {
            params[key] = value;
        }
    }

    // Synthesize Size from Width + Height
    if (params.Width && params.Height) {
        params.Size = `${params.Width}x${params.Height}`;
        delete params.Width;
        delete params.Height;
    }

    if (!prompt && Object.keys(params).length === 0) return null;

    return { prompt: prompt || null, negativePrompt, params };
}

// ─── Chunk Decoding ────────────────────────────────────────────────────────────

/**
 * Decode a PNG text chunk (tEXt, zTXt, iTXt).
 * Returns the raw text including "key\0value" format.
 */
function _decodeChunk(chunk) {
    try {
        if (chunk.name === 'zTXt') {
            const buf = Buffer.isBuffer(chunk.data) ? chunk.data : Buffer.from(chunk.data);
            return zlib.inflateSync(buf).toString('utf8');
        } else if (chunk.name === 'iTXt') {
            let dataStr;
            if (Buffer.isBuffer(chunk.data)) dataStr = chunk.data.toString('utf8');
            else if (chunk.data instanceof Uint8Array || Array.isArray(chunk.data)) dataStr = Buffer.from(chunk.data).toString('utf8');
            else dataStr = String(chunk.data);
            const lastNullIndex = dataStr.lastIndexOf('\0');
            return lastNullIndex !== -1 ? dataStr.substring(lastNullIndex + 1) : dataStr;
        } else {
            // tEXt
            if (Buffer.isBuffer(chunk.data)) return chunk.data.toString('utf8');
            if (chunk.data instanceof Uint8Array || Array.isArray(chunk.data)) return Buffer.from(chunk.data).toString('utf8');
            if (typeof chunk.data === 'string') return chunk.data;
            return Buffer.from(chunk.data).toString('utf8');
        }
    } catch (_) {
        return null;
    }
}

// ─── Info Section Renderer ─────────────────────────────────────────────────────

/**
 * Render SD parameters as HTML for the file inspector panel.
 * Returns { title, html, actions, summary } or null.
 */
function renderSDSection(filePath, pluginMetadata) {
    const data = pluginMetadata?.['sd-metadata'];
    if (!data) return null;

    const { prompt, negativePrompt, params = {}, raw = '', source = '' } = data;
    const sections = [];

    // Prompt section
    if (prompt) {
        sections.push(
            `<div class="exif-group-header">Prompt</div>` +
            `<div class="file-info-detail-row">` +
            `<div class="sd-prompt-text">${escHtml(prompt)}</div>` +
            `</div>`
        );
    }

    // Negative prompt section
    if (negativePrompt) {
        sections.push(
            `<div class="exif-group-header">Negative Prompt</div>` +
            `<div class="file-info-detail-row">` +
            `<div class="sd-prompt-text sd-negative-prompt">${escHtml(negativePrompt)}</div>` +
            `</div>`
        );
    }

    // Generation parameters
    const paramRows = [];
    // Show key params in a logical order
    const orderedKeys = [
        'Steps', 'Sampler', 'Schedule type', 'CFG scale', 'Distilled CFG scale',
        'Seed', 'Size', 'Model hash', 'Model', 'VAE', 'VAE hash',
        'Denoising strength', 'Clip skip', 'ENSD',
        'Hires upscale', 'Hires steps', 'Hires upscaler',
        'Face restoration',
    ];

    const shownKeys = new Set();
    for (const key of orderedKeys) {
        if (params[key] !== undefined) {
            paramRows.push(row(key, params[key]));
            shownKeys.add(key);
        }
    }

    // Show any remaining params not in the ordered list
    for (const [key, value] of Object.entries(params)) {
        if (!shownKeys.has(key) && value !== undefined) {
            paramRows.push(row(key, value));
        }
    }

    if (paramRows.length > 0) {
        sections.push(group('Generation Parameters', paramRows));
    }

    // Source indicator
    const sourceLabels = {
        'png-parameters': 'PNG tEXt (A1111)',
        'png-dream': 'PNG tEXt (InvokeAI)',
        'exif-usercomment': 'EXIF UserComment',
    };
    sections.push(row('Source', sourceLabels[source] || source));

    if (sections.length === 0) return null;

    const html = sections.join('') + `
        <style>
            .exif-group-header { font-size: 11px; font-weight: 600; text-transform: uppercase;
                letter-spacing: 0.06em; opacity: 0.5; margin: 10px 0 4px; padding-top: 8px;
                border-top: 1px solid var(--border-subtle, rgba(255,255,255,0.08)); }
            .exif-group-header:first-child { margin-top: 0; border-top: none; padding-top: 0; }
            .sd-prompt-text { white-space: pre-wrap; word-break: break-word; font-size: 12px;
                line-height: 1.5; padding: 6px 8px; border-radius: 4px;
                background: rgba(255,255,255,0.04); max-height: 200px; overflow-y: auto; }
            .sd-negative-prompt { opacity: 0.7; }
        </style>`;

    // Actions
    const actions = [];
    if (raw) actions.push({ label: 'Copy Full Parameters', copyText: raw });
    if (prompt) actions.push({ label: 'Copy Prompt', copyText: prompt });
    if (negativePrompt) actions.push({ label: 'Copy Negative', copyText: negativePrompt });

    // Summary
    const summaryParts = [];
    if (params.Model) summaryParts.push(params.Model);
    if (params.Size) summaryParts.push(params.Size);
    else if (params.Width && params.Height) summaryParts.push(`${params.Width}x${params.Height}`);
    if (params.Steps) summaryParts.push(`${params.Steps} steps`);
    if (params.Sampler) summaryParts.push(params.Sampler);

    return {
        title: 'SD Generation Parameters',
        html,
        actions,
        summary: summaryParts.join(' \u00b7 '),
    };
}

// ─── Context Menu Action ───────────────────────────────────────────────────────

/**
 * Copy SD parameters text to clipboard.
 */
function copySDParams(filePath, metadata) {
    const data = metadata?.['sd-metadata'];
    if (!data) return { success: false, error: 'No SD parameters found' };
    return { success: true, json: data.raw || '' };
}

// ─── HTML Helpers ──────────────────────────────────────────────────────────────

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
