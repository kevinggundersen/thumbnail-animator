'use strict';

const workflowKeys = ['workflow', 'Workflow', 'WORKFLOW', 'prompt', 'Prompt', 'PROMPT', 'comfyui_workflow', 'ComfyUI_Workflow'];

let pngChunksExtract = null;
try {
    pngChunksExtract = require('png-chunks-extract');
} catch (err) {
    console.warn('[comfyui-workflow] png-chunks-extract not available:', err.message);
}

let _api = null;

function activate(api) {
    _api = api;
    return {
        extractWorkflow,
        copyWorkflowJSON,
        renderInfoSection,
        buildTooltipHtml,
        loadSettings,
        saveSettings,
    };
}

function buildTooltipHtml(filePath, pluginMetadata) {
    if (_api && !_api.storage.get('showInTooltip', true)) return null;
    const data = pluginMetadata?.['comfyui-workflow'];
    if (!data) return null;
    return { html: '<span>ComfyUI Workflow</span>' };
}

function loadSettings() {
    return { showInTooltip: _api ? _api.storage.get('showInTooltip', true) : true };
}

function saveSettings(data) {
    if (_api) _api.storage.set('showInTooltip', data.showInTooltip === true || data.showInTooltip === 'true');
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

/**
 * infoSection renderer: returns { title, html, actions, summary? } for the lightbox inspector.
 */
function renderInfoSection(filePath, pluginMetadata) {
    const data = pluginMetadata && pluginMetadata['comfyui-workflow'];
    if (!data) return null;

    let workflow = data.workflow;
    if (!workflow && data.raw) {
        try { workflow = JSON.parse(data.raw); } catch (_) { /* raw is not valid JSON */ }
    }

    const params = workflow ? _extractParams(workflow) : null;
    const e = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const rows = [];
    if (params) {
        if (params.prompt) rows.push(`<div class="file-info-detail-row file-info-prompt-row"><span class="file-info-detail-label">Prompt:</span><div class="file-info-prompt-value">${e(params.prompt)}</div></div>`);
        if (params.negativePrompt) rows.push(`<div class="file-info-detail-row file-info-prompt-row"><span class="file-info-detail-label">Negative Prompt:</span><div class="file-info-prompt-value">${e(params.negativePrompt)}</div></div>`);
        const grid = [];
        if (params.cfgScale !== null) grid.push(`<div class="file-info-detail-row"><span class="file-info-detail-label">CFG Scale:</span><span class="file-info-detail-value">${params.cfgScale}</span></div>`);
        if (params.steps !== null) grid.push(`<div class="file-info-detail-row"><span class="file-info-detail-label">Steps:</span><span class="file-info-detail-value">${params.steps}</span></div>`);
        if (params.sampler) grid.push(`<div class="file-info-detail-row"><span class="file-info-detail-label">Sampler:</span><span class="file-info-detail-value">${e(params.sampler)}</span></div>`);
        if (params.seed !== null) grid.push(`<div class="file-info-detail-row"><span class="file-info-detail-label">Seed:</span><span class="file-info-detail-value">${params.seed}</span></div>`);
        if (params.model) grid.push(`<div class="file-info-detail-row"><span class="file-info-detail-label">Model:</span><span class="file-info-detail-value">${e(params.model)}</span></div>`);
        if (params.width && params.height) grid.push(`<div class="file-info-detail-row"><span class="file-info-detail-label">Resolution:</span><span class="file-info-detail-value">${params.width} x ${params.height}</span></div>`);
        if (grid.length) rows.push(`<div class="file-info-comfyui-params-grid">${grid.join('')}</div>`);
    }

    rows.push(`<div class="file-info-detail-row"><span class="file-info-detail-label">Metadata Key:</span><span class="file-info-detail-value">${e(data.key)}</span></div>`);

    if (workflow) {
        const jsonStr = JSON.stringify(workflow, null, 2);
        rows.push(`<div class="file-info-detail-row"><span class="file-info-detail-label">Workflow Data:</span><div class="file-info-workflow-json"><pre class="file-info-json-pre">${e(jsonStr)}</pre></div></div>`);
    }

    const actions = [];
    if (workflow) {
        actions.push({ label: 'Copy Workflow JSON', copyText: JSON.stringify(workflow, null, 2) });
    }
    if (data.raw) {
        actions.push({ label: 'Copy Raw', copyText: data.raw });
    }

    const summaryParts = [];
    if (params?.model) summaryParts.push(params.model);
    if (params?.width && params?.height) summaryParts.push(`${params.width} x ${params.height}`);
    if (params?.steps !== null) summaryParts.push(`${params.steps} steps`);
    if (summaryParts.length === 0 && data.key) summaryParts.push(`Key: ${data.key}`);

    return {
        title: 'ComfyUI Workflow',
        html: rows.join(''),
        actions,
        summary: summaryParts.join(' · ')
    };
}

/**
 * Extract generation parameters from a ComfyUI workflow object.
 */
function _extractParams(workflow) {
    const params = { prompt: null, negativePrompt: null, cfgScale: null, steps: null, sampler: null, seed: null, model: null, width: null, height: null };
    if (!workflow || typeof workflow !== 'object') return params;

    const nodes = Array.isArray(workflow) ? workflow : Object.values(workflow);
    for (const node of nodes) {
        if (!node || typeof node !== 'object') continue;
        const inputs = node.inputs || {};
        const classType = (node.class_type || '').toLowerCase();

        if (classType.includes('cliptextencode') || classType.includes('text_encode')) {
            if (!params.prompt && typeof inputs.text === 'string') params.prompt = inputs.text;
            else if (!params.negativePrompt && typeof inputs.text === 'string') params.negativePrompt = inputs.text;
        }
        if (classType.includes('ksampler') || classType.includes('sampler')) {
            if (inputs.cfg !== undefined) params.cfgScale = inputs.cfg;
            if (inputs.steps !== undefined) params.steps = inputs.steps;
            if (inputs.sampler_name !== undefined) params.sampler = inputs.sampler_name;
            if (inputs.seed !== undefined) params.seed = inputs.seed;
            if (inputs.noise_seed !== undefined) params.seed = inputs.noise_seed;
        }
        if (classType.includes('emptylatent') || classType.includes('empty_latent')) {
            if (inputs.width !== undefined) params.width = inputs.width;
            if (inputs.height !== undefined) params.height = inputs.height;
        }
        if (classType.includes('checkpointloader') || classType.includes('load_checkpoint')) {
            if (typeof inputs.ckpt_name === 'string') params.model = inputs.ckpt_name;
        }
    }
    return params;
}

module.exports = { activate };
