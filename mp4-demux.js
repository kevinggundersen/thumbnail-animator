/* global TextDecoder, module, self, window */
/**
 * Minimal MP4 (ISO BMFF) demuxer for WebCodecs playback of the grid's proxies.
 *
 * Reads the first video track of a non-fragmented, faststart MP4 and returns
 * what a VideoDecoder needs: the codec string, the codec-specific description
 * (avcC / hvcC / vpcC / av1C payload), dimensions, and every sample's byte
 * range, presentation timestamp, duration and sync flag, in decode order.
 *
 * Shared between the renderer (classic script, `Mp4Demux` global), the
 * WebCodecs worker (importScripts) and the unit tests (CommonJS).
 */
(function (root) {
    'use strict';

    const te = typeof TextDecoder !== 'undefined' ? new TextDecoder('latin1') : null;
    function fourcc(view, offset) {
        if (te) return te.decode(new Uint8Array(view.buffer, view.byteOffset + offset, 4));
        return String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
    }

    /** Iterate the boxes in [start, end) of a DataView, calling fn(type, bodyStart, bodyEnd, headerStart). */
    function eachBox(view, start, end, fn) {
        let p = start;
        while (p + 8 <= end) {
            let size = view.getUint32(p);
            const type = fourcc(view, p + 4);
            let header = 8;
            if (size === 1) {
                // 64-bit size; the high 32 bits are never needed for a proxy-sized file.
                size = view.getUint32(p + 8) * 4294967296 + view.getUint32(p + 12);
                header = 16;
            } else if (size === 0) {
                size = end - p; // to end of file
            }
            if (size < header || p + size > end) break;
            if (fn(type, p + header, p + size, p) === false) break;
            p += size;
        }
    }

    function hex2(n) { return (n < 16 ? '0' : '') + n.toString(16); }

    /** Parse a sample description (stsd entry) into { codec, description, width, height }. */
    function parseSampleEntry(view, type, start, end) {
        // VisualSampleEntry: 6 reserved + 2 data_reference_index, then 16 bytes
        // pre_defined/reserved, width(2), height(2), 12 bytes resolution/reserved,
        // frame_count(2), compressorname(32), depth(2), pre_defined(2) = 78 bytes.
        if (end - start < 78) return null;
        const width = view.getUint16(start + 24);
        const height = view.getUint16(start + 26);
        const out = { codec: null, description: null, width, height, entryType: type };
        eachBox(view, start + 78, end, (child, cs, ce) => {
            const payload = new Uint8Array(view.buffer, view.byteOffset + cs, ce - cs);
            if (child === 'avcC' && (type === 'avc1' || type === 'avc3')) {
                // AVCDecoderConfigurationRecord: version(1), profile(1), compat(1), level(1), ...
                if (payload.length >= 4) out.codec = `avc1.${hex2(payload[1])}${hex2(payload[2])}${hex2(payload[3])}`;
                out.description = payload.slice();
            } else if (child === 'hvcC' && (type === 'hvc1' || type === 'hev1')) {
                // HEVCDecoderConfigurationRecord: version(1), profile_space/tier/idc(1),
                // compat flags(4), constraint flags(6), level_idc(1) ...
                if (payload.length >= 13) {
                    const b = payload[1];
                    const profileSpace = b >> 6, tier = (b >> 5) & 1, profileIdc = b & 0x1f;
                    const compat = (payload[2] << 24 | payload[3] << 16 | payload[4] << 8 | payload[5]) >>> 0;
                    // The compatibility flags are stored bit-reversed in the codec string.
                    let rev = 0; for (let i = 0; i < 32; i++) if (compat & (1 << i)) rev |= 1 << (31 - i);
                    const level = payload[12];
                    out.codec = `${type}.${['', 'A', 'B', 'C'][profileSpace]}${profileIdc}.${(rev >>> 0).toString(16).toUpperCase()}.${tier ? 'H' : 'L'}${level}.B0`;
                }
                out.description = payload.slice();
            } else if (child === 'vpcC' && type === 'vp09') {
                // version(1) flags(3) profile(1) level(1) bitDepth:4 chroma:3 range:1 ...
                if (payload.length >= 7) out.codec = `vp09.${hex2(payload[4])}.${hex2(payload[5])}.${hex2(payload[6] >> 4)}`;
                out.description = null; // VP9 needs no description
            } else if (child === 'av1C' && type === 'av01') {
                // marker/version(1), seq_profile:3 seq_level_idx:5, tier:1 high_bitdepth:1 twelve_bit:1 ...
                if (payload.length >= 4) {
                    const profile = payload[1] >> 5, level = payload[1] & 0x1f;
                    const tier = payload[2] >> 7, high = (payload[2] >> 6) & 1, twelve = (payload[2] >> 5) & 1;
                    const depth = twelve ? 12 : high ? 10 : 8;
                    out.codec = `av01.${profile}.${(level < 10 ? '0' : '') + level}${tier ? 'H' : 'M'}.${depth < 10 ? '0' : ''}${depth}`;
                }
                out.description = payload.slice();
            }
        });
        return out;
    }

    function parseTrak(view, start, end) {
        const t = { handler: null, timescale: 0, duration: 0, entry: null, stts: [], ctts: null, stss: null, stsz: null, sampleSize: 0, stsc: [], chunkOffsets: null, sampleCount: 0, mediaTime: null };
        eachBox(view, start, end, (type, s, e) => {
            if (type === 'edts') {
                // Edit list: the first segment's media_time is the composition delay
                // (B-frames) that presentation timestamps must be shifted back by.
                eachBox(view, s, e, (t2, s2) => {
                    if (t2 !== 'elst') return;
                    const version = view.getUint8(s2);
                    const n = view.getUint32(s2 + 4);
                    let p = s2 + 8;
                    for (let i = 0; i < n; i++) {
                        const mediaTime = version === 1 ? view.getUint32(p + 8) * 4294967296 + view.getUint32(p + 12) : view.getInt32(p + 4);
                        p += version === 1 ? 20 : 12;
                        if (mediaTime >= 0) { t.mediaTime = mediaTime; break; } // -1 is an empty (delay) segment
                    }
                });
            } else if (type === 'mdia') {
                eachBox(view, s, e, (t2, s2, e2) => {
                    if (t2 === 'mdhd') {
                        const version = view.getUint8(s2);
                        if (version === 1) { t.timescale = view.getUint32(s2 + 20); t.duration = view.getUint32(s2 + 24) * 4294967296 + view.getUint32(s2 + 28); }
                        else { t.timescale = view.getUint32(s2 + 12); t.duration = view.getUint32(s2 + 16); }
                    } else if (t2 === 'hdlr') {
                        t.handler = fourcc(view, s2 + 8);
                    } else if (t2 === 'minf') {
                        eachBox(view, s2, e2, (t3, s3, e3) => {
                            if (t3 !== 'stbl') return;
                            eachBox(view, s3, e3, (t4, s4, e4) => parseStblBox(view, t, t4, s4, e4));
                        });
                    }
                });
            }
        });
        return t;
    }

    function parseStblBox(view, t, type, s, e) {
        const version = view.getUint8(s);
        const count = () => view.getUint32(s + 4);
        if (type === 'stsd') {
            const n = count();
            let p = s + 8;
            for (let i = 0; i < n && p + 8 <= e; i++) {
                const size = view.getUint32(p), etype = fourcc(view, p + 4);
                if (!t.entry) t.entry = parseSampleEntry(view, etype, p + 8, p + size);
                p += size;
            }
        } else if (type === 'stts') {
            const n = count();
            for (let i = 0; i < n; i++) t.stts.push([view.getUint32(s + 8 + i * 8), view.getUint32(s + 12 + i * 8)]);
        } else if (type === 'ctts') {
            const n = count();
            t.ctts = [];
            for (let i = 0; i < n; i++) {
                const c = view.getUint32(s + 8 + i * 8);
                const off = version === 1 ? view.getInt32(s + 12 + i * 8) : view.getUint32(s + 12 + i * 8);
                t.ctts.push([c, off]);
            }
        } else if (type === 'stss') {
            const n = count();
            t.stss = new Set();
            for (let i = 0; i < n; i++) t.stss.add(view.getUint32(s + 8 + i * 4));
        } else if (type === 'stsz') {
            t.sampleSize = view.getUint32(s + 4);
            t.sampleCount = view.getUint32(s + 8);
            if (t.sampleSize === 0) {
                t.stsz = new Uint32Array(t.sampleCount);
                for (let i = 0; i < t.sampleCount; i++) t.stsz[i] = view.getUint32(s + 12 + i * 4);
            }
        } else if (type === 'stsc') {
            const n = count();
            for (let i = 0; i < n; i++) t.stsc.push([view.getUint32(s + 8 + i * 12), view.getUint32(s + 12 + i * 12), view.getUint32(s + 16 + i * 12)]);
        } else if (type === 'stco') {
            const n = count();
            t.chunkOffsets = new Float64Array(n);
            for (let i = 0; i < n; i++) t.chunkOffsets[i] = view.getUint32(s + 8 + i * 4);
        } else if (type === 'co64') {
            const n = count();
            t.chunkOffsets = new Float64Array(n);
            for (let i = 0; i < n; i++) t.chunkOffsets[i] = view.getUint32(s + 8 + i * 8) * 4294967296 + view.getUint32(s + 12 + i * 8);
        }
    }

    /**
     * @param {ArrayBuffer} buffer whole file
     * @returns {{ codec: string|null, description: Uint8Array|null, width: number, height: number,
     *   timescale: number, durationUs: number, samples: Array<{offset:number,size:number,timestamp:number,duration:number,key:boolean}> }}
     */
    function parse(buffer) {
        const view = new DataView(buffer);
        let video = null;
        eachBox(view, 0, buffer.byteLength, (type, s, e) => {
            if (type !== 'moov') return;
            eachBox(view, s, e, (t2, s2, e2) => {
                if (t2 !== 'trak' || video) return;
                const trak = parseTrak(view, s2, e2);
                if (trak.handler === 'vide' && trak.entry) video = trak;
            });
            return false;
        });
        if (!video) throw new Error('no video track');
        if (!video.chunkOffsets || !video.stsc.length || !video.stts.length || !video.sampleCount) throw new Error('incomplete sample tables (fragmented MP4?)');

        const n = video.sampleCount;
        const ts = video.timescale || 1;
        const toUs = (units) => Math.round(units * 1e6 / ts);
        // Decode timestamps from stts, composition offsets from ctts.
        const dts = new Float64Array(n), dur = new Float64Array(n);
        let i = 0, time = 0;
        for (const [cnt, delta] of video.stts) for (let k = 0; k < cnt && i < n; k++, i++) { dts[i] = time; dur[i] = delta; time += delta; }
        for (; i < n; i++) { dts[i] = time; dur[i] = video.stts.length ? video.stts[video.stts.length - 1][1] : 0; time += dur[i]; }
        const cto = new Float64Array(n);
        if (video.ctts) { i = 0; for (const [cnt, off] of video.ctts) for (let k = 0; k < cnt && i < n; k++, i++) cto[i] = off; }
        // Byte offsets from stsc + stco.
        const offsets = new Float64Array(n), sizes = new Uint32Array(n);
        const chunks = video.chunkOffsets.length;
        let sample = 0;
        for (let c = 0; c < chunks && sample < n; c++) {
            // samples per chunk for chunk c (1-based first_chunk runs)
            let spc = video.stsc[0][1];
            for (const [first, count] of video.stsc) { if (c + 1 >= first) spc = count; else break; }
            let off = video.chunkOffsets[c];
            for (let k = 0; k < spc && sample < n; k++, sample++) {
                const size = video.sampleSize || video.stsz[sample];
                offsets[sample] = off; sizes[sample] = size; off += size;
            }
        }
        // Presentation timestamps start at zero: shift by the edit list's media_time,
        // or by the earliest composition time when there is no edit list.
        let shift = video.mediaTime;
        if (shift == null) { shift = Infinity; for (let k = 0; k < n; k++) shift = Math.min(shift, dts[k] + cto[k]); if (!isFinite(shift)) shift = 0; }
        const samples = new Array(n);
        let endUnits = 0;
        for (let k = 0; k < n; k++) {
            const pts = dts[k] + cto[k] - shift;
            if (pts + dur[k] > endUnits) endUnits = pts + dur[k];
            samples[k] = {
                offset: offsets[k], size: sizes[k],
                timestamp: toUs(pts), duration: toUs(dur[k]),
                key: video.stss ? video.stss.has(k + 1) : true,
            };
        }
        const entry = video.entry;
        return {
            codec: entry.codec, description: entry.description, width: entry.width, height: entry.height,
            timescale: ts, durationUs: toUs(endUnits), samples,
        };
    }

    const api = { parse };
    root.Mp4Demux = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis));
