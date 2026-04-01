'use strict';

const workflowKeys = ['workflow', 'Workflow', 'WORKFLOW', 'prompt', 'Prompt', 'PROMPT', 'comfyui_workflow', 'ComfyUI_Workflow'];

let pngChunksExtract = null;
try {
    pngChunksExtract = require('png-chunks-extract');
} catch (err) {
    console.warn('[comfyui-workflow] png-chunks-extract not available:', err.message);
}

function activate(api) {
    return {
        extractWorkflow,
        copyWorkflowJSON,
    };
}

/**
 * Extract ComfyUI workflow/prompt data from a PNG file's text metadata chunks.
 * Returns { key, workflow, raw } or null if no workflow found.
 */
function extractWorkflow(filePath) {
    try {
        if (!pngChunksExtract) return null;

        const fileBuffer = require('fs').readFileSync(filePath);
        const chunks = pngChunksExtract(fileBuffer);

        // First pass: look for known workflow keys
        for (const chunk of chunks) {
            if (chunk.name !== 'tEXt' && chunk.name !== 'zTXt' && chunk.name !== 'iTXt') continue;
            try {
                const textData = _decodeChunk(chunk);
                if (textData === null) continue;

                const nullIndex = textData.indexOf('\0');
                if (nullIndex === -1) {
                    // No null separator — try parsing entire text as JSON
                    try {
                        const parsed = JSON.parse(textData);
                        if (parsed && typeof parsed === 'object' && (parsed.nodes || parsed.workflow || parsed.prompt)) {
                            return { key: 'workflow', workflow: parsed, raw: textData };
                        }
                    } catch (_) { /* not JSON */ }
                    continue;
                }

                const key = textData.substring(0, nullIndex);
                const value = textData.substring(nullIndex + 1);
                const keyLower = key.toLowerCase();
                const isWorkflowKey = workflowKeys.some(wk => keyLower === wk.toLowerCase()) ||
                    keyLower.includes('workflow') || keyLower.includes('comfyui');
                const isPromptKey = keyLower === 'prompt';

                if (isWorkflowKey || isPromptKey || value.trim().startsWith('{') || value.trim().startsWith('[')) {
                    try {
                        const workflow = JSON.parse(value);
                        console.log(`[ComfyUI Debug] Successfully parsed workflow from key "${key}"`);
                        return { key, workflow, raw: value };
                    } catch (parseError) {
                        console.warn(`[ComfyUI Debug] Failed to parse JSON for key "${key}":`, parseError.message);
                        const trimmed = value.trim();
                        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                            return { key, workflow: null, raw: value };
                        }
                        continue;
                    }
                }
            } catch (chunkError) {
                console.warn('[ComfyUI] Error processing PNG chunk:', chunkError.message);
                continue;
            }
        }

        // Second pass: any text chunk containing JSON that looks like a workflow
        for (const chunk of chunks) {
            if (chunk.name !== 'tEXt' && chunk.name !== 'zTXt' && chunk.name !== 'iTXt') continue;
            try {
                const textData = _decodeChunk(chunk);
                if (textData === null) continue;

                const nullIndex = textData.indexOf('\0');
                let key = 'unknown';
                let valueToCheck = textData;
                if (nullIndex !== -1) {
                    key = textData.substring(0, nullIndex);
                    valueToCheck = textData.substring(nullIndex + 1);
                }

                try {
                    const parsed = JSON.parse(valueToCheck);
                    if (parsed && typeof parsed === 'object') {
                        if (Array.isArray(parsed) ||
                            parsed.nodes || parsed.workflow || parsed.prompt ||
                            (Object.keys(parsed).length > 0 &&
                                Object.values(parsed).some(v => typeof v === 'object' && v && v.class_type))) {
                            return { key, workflow: parsed, raw: valueToCheck };
                        }
                    }
                } catch (_) { /* not valid JSON */ }
            } catch (_) { continue; }
        }

        // Debug: log available text chunks when no workflow found
        const textChunks = chunks.filter(c => c.name === 'tEXt' || c.name === 'zTXt' || c.name === 'iTXt');
        if (textChunks.length > 0) {
            console.log(`[ComfyUI Debug] Found ${textChunks.length} text chunks in PNG, but no workflow detected`);
            textChunks.forEach((chunk, idx) => {
                try {
                    const textData = _decodeChunk(chunk) || '';
                    const nullIndex = textData.indexOf('\0');
                    if (nullIndex !== -1) {
                        const key = textData.substring(0, nullIndex);
                        const preview = textData.substring(nullIndex + 1, nullIndex + 150);
                        console.log(`[ComfyUI Debug] Chunk ${idx} (${chunk.name}): key="${key}", value preview: ${preview}...`);
                    } else {
                        console.log(`[ComfyUI Debug] Chunk ${idx} (${chunk.name}): ${textData.substring(0, 150)}...`);
                    }
                } catch (e) {
                    console.log(`[ComfyUI Debug] Chunk ${idx} (${chunk.name}): [could not decode] - ${e.message}`);
                }
            });
        } else {
            console.log('[ComfyUI Debug] No text chunks found in PNG file');
        }

        return null;
    } catch (error) {
        console.warn('[comfyui-workflow] Error extracting workflow:', error.message);
        return null;
    }
}

/**
 * Context menu action: returns the workflow JSON string so the renderer can copy it.
 */
function copyWorkflowJSON(filePath, metadata) {
    const workflow = metadata && metadata['comfyui-workflow'];
    if (!workflow) return { success: false, error: 'No workflow data available' };
    try {
        const json = JSON.stringify(workflow.workflow ?? workflow, null, 2);
        return { success: true, json };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// --- helpers ---

function _decodeChunk(chunk) {
    const zlib = require('zlib');
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

module.exports = { activate };
