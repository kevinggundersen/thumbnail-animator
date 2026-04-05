/**
 * WebGPU Hamming Distance Compute
 *
 * Runs the O(n²) pairwise perceptual-hash comparison on the GPU via WebGPU
 * compute shader. For 10K hashes (50M pairs), a modern GPU completes in <100ms
 * vs. ~3-5 seconds on CPU with the byte-XOR + popcount LUT.
 *
 * Input:  Uint8Array of concatenated 16-byte (128-bit) hashes (N * 16 bytes)
 * Output: Uint32Array laid out as [i0, j0, d0, i1, j1, d1, ...] for all pairs
 *         with hamming distance ≤ threshold.
 *
 * The kernel launches N threads; each thread handles row i and iterates all
 * j > i, emitting pairs below the threshold via an atomic counter.
 *
 * Exposed on window as `window.webgpuHamming.computeHammingPairs(bytes, threshold)`.
 */

(() => {
'use strict';

const MAX_OUTPUT_PAIRS = 500_000; // safety cap; overflow triggers CPU fallback
const BYTES_PER_HASH = 16;        // 128-bit perceptual hashes
const U32_PER_HASH = BYTES_PER_HASH / 4;

let _device = null;
let _pipeline = null;
let _deviceInitPromise = null;

async function ensureDevice() {
    if (_device) return _device;
    if (_deviceInitPromise) return _deviceInitPromise;
    _deviceInitPromise = (async () => {
        if (!navigator.gpu) throw new Error('WebGPU not supported in this Electron version');
        const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (!adapter) throw new Error('No WebGPU adapter available');
        const device = await adapter.requestDevice();
        device.lost.then(info => {
            console.warn('[webgpu-hamming] device lost:', info.message);
            _device = null;
            _pipeline = null;
            _deviceInitPromise = null;
        });
        _device = device;
        return device;
    })();
    try {
        return await _deviceInitPromise;
    } catch (err) {
        _deviceInitPromise = null;
        throw err;
    }
}

function getPipeline(device) {
    if (_pipeline) return _pipeline;

    const shaderCode = `
struct Params {
    num_hashes: u32,
    threshold: u32,
    u32_per_hash: u32,
    max_pairs: u32,
};

@group(0) @binding(0) var<storage, read> hashes: array<u32>;
@group(0) @binding(1) var<storage, read_write> out_count: atomic<u32>;
@group(0) @binding(2) var<storage, read_write> out_pairs: array<u32>;
@group(0) @binding(3) var<uniform> params: Params;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= params.num_hashes) { return; }

    let stride = params.u32_per_hash;
    let i_base = i * stride;

    for (var j = i + 1u; j < params.num_hashes; j = j + 1u) {
        let j_base = j * stride;
        var dist: u32 = 0u;
        for (var k: u32 = 0u; k < stride; k = k + 1u) {
            let a = hashes[i_base + k];
            let b = hashes[j_base + k];
            dist = dist + countOneBits(a ^ b);
        }
        if (dist <= params.threshold) {
            let idx = atomicAdd(&out_count, 1u);
            if (idx < params.max_pairs) {
                out_pairs[idx * 3u]      = i;
                out_pairs[idx * 3u + 1u] = j;
                out_pairs[idx * 3u + 2u] = dist;
            }
        }
    }
}
`;

    const shaderModule = device.createShaderModule({ code: shaderCode });
    const pipeline = device.createComputePipeline({
        layout: 'auto',
        compute: { module: shaderModule, entryPoint: 'main' }
    });
    _pipeline = pipeline;
    return pipeline;
}

/**
 * Compute similar pairs via WebGPU.
 *
 * @param {Uint8Array|ArrayBuffer} hashBytes — N * 16 bytes
 * @param {number} threshold — max hamming distance to emit
 * @returns {Promise<{pairs: Uint32Array, overflowed: boolean, count: number}>}
 */
async function computeHammingPairs(hashBytes, threshold) {
    const device = await ensureDevice();
    const pipeline = getPipeline(device);

    if (!(hashBytes instanceof Uint8Array)) {
        hashBytes = new Uint8Array(hashBytes);
    }
    if (hashBytes.byteLength % BYTES_PER_HASH !== 0) {
        throw new Error(`hash buffer length ${hashBytes.byteLength} not a multiple of ${BYTES_PER_HASH}`);
    }
    const n = hashBytes.byteLength / BYTES_PER_HASH;
    if (n < 2) {
        return { pairs: new Uint32Array(0), overflowed: false, count: 0 };
    }

    // Copy the hash data into an aligned u32 typed array (WGSL reads u32).
    const hashU32 = new Uint32Array(n * U32_PER_HASH);
    new Uint8Array(hashU32.buffer).set(hashBytes);

    const hashBuffer = device.createBuffer({
        size: hashU32.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(hashBuffer, 0, hashU32);

    const countBuffer = device.createBuffer({
        size: 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    device.queue.writeBuffer(countBuffer, 0, new Uint32Array([0]));

    const pairsBuffer = device.createBuffer({
        size: MAX_OUTPUT_PAIRS * 3 * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    const paramsBuffer = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(paramsBuffer, 0, new Uint32Array([n, threshold, U32_PER_HASH, MAX_OUTPUT_PAIRS]));

    const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: hashBuffer } },
            { binding: 1, resource: { buffer: countBuffer } },
            { binding: 2, resource: { buffer: pairsBuffer } },
            { binding: 3, resource: { buffer: paramsBuffer } },
        ],
    });

    const numWorkgroups = Math.ceil(n / 64);
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(numWorkgroups);
    pass.end();

    const countReadBuffer = device.createBuffer({
        size: 4,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    encoder.copyBufferToBuffer(countBuffer, 0, countReadBuffer, 0, 4);
    device.queue.submit([encoder.finish()]);

    await countReadBuffer.mapAsync(GPUMapMode.READ);
    const actualCount = new Uint32Array(countReadBuffer.getMappedRange().slice(0))[0];
    countReadBuffer.unmap();

    const overflowed = actualCount > MAX_OUTPUT_PAIRS;
    const returnedCount = Math.min(actualCount, MAX_OUTPUT_PAIRS);
    let pairs = new Uint32Array(0);

    if (returnedCount > 0) {
        const bytes = returnedCount * 3 * 4;
        const pairsReadBuffer = device.createBuffer({
            size: bytes,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });
        const enc2 = device.createCommandEncoder();
        enc2.copyBufferToBuffer(pairsBuffer, 0, pairsReadBuffer, 0, bytes);
        device.queue.submit([enc2.finish()]);
        await pairsReadBuffer.mapAsync(GPUMapMode.READ);
        pairs = new Uint32Array(pairsReadBuffer.getMappedRange().slice(0));
        pairsReadBuffer.unmap();
        pairsReadBuffer.destroy();
    }

    hashBuffer.destroy();
    countBuffer.destroy();
    pairsBuffer.destroy();
    paramsBuffer.destroy();
    countReadBuffer.destroy();

    return { pairs, overflowed, count: actualCount };
}

async function isAvailable() {
    if (!navigator.gpu) return false;
    try {
        const adapter = await navigator.gpu.requestAdapter();
        return !!adapter;
    } catch { return false; }
}

window.webgpuHamming = { computeHammingPairs, isAvailable, MAX_OUTPUT_PAIRS };
})();
