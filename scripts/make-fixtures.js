'use strict';
// Generates a reference media folder for manual and automated performance checks.
// Usage: node scripts/make-fixtures.js <outDir> [--images N] [--videos N] [--gifs N]
// Requires ffmpeg on PATH for videos and GIFs; images use sharp from node_modules.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const sharp = require('sharp');

const args = process.argv.slice(2);
const outDir = args[0];
if (!outDir) { console.error('usage: make-fixtures <outDir> [--images N] [--videos N] [--gifs N]'); process.exit(1); }
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? parseInt(args[i + 1], 10) : def; };
const nImages = opt('--images', 1500), nVideos = opt('--videos', 150), nGifs = opt('--gifs', 60);

fs.mkdirSync(outDir, { recursive: true });
const sizes = [[640, 480], [480, 640], [800, 450], [450, 800], [512, 512], [1024, 576], [300, 900], [1200, 300]];
let seed = 1;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

(async () => {
    const t0 = Date.now();
    for (let i = 0; i < nImages; i++) {
        const [w, h] = sizes[i % sizes.length];
        const ext = i % 5 === 0 ? 'png' : i % 7 === 0 ? 'webp' : 'jpg';
        const file = path.join(outDir, `img_${String(i).padStart(5, '0')}.${ext}`);
        if (fs.existsSync(file)) continue;
        const r = Math.floor(rnd() * 255), g = Math.floor(rnd() * 255), b = Math.floor(rnd() * 255);
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
            <rect width="100%" height="100%" fill="rgb(${r},${g},${b})"/>
            <circle cx="${w * rnd()}" cy="${h * rnd()}" r="${Math.min(w, h) * 0.3}" fill="rgb(${255 - r},${255 - g},${255 - b})"/>
            <text x="20" y="${h - 20}" font-size="32" fill="white">${i}</text></svg>`;
        await sharp(Buffer.from(svg)).toFormat(ext === 'jpg' ? 'jpeg' : ext).toFile(file);
    }
    console.log(`images done in ${Date.now() - t0}ms`);
    const ff = (argv) => spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...argv], { stdio: 'inherit' });
    for (let i = 0; i < nVideos; i++) {
        const [w, h] = sizes[i % sizes.length];
        const file = path.join(outDir, `vid_${String(i).padStart(4, '0')}.mp4`);
        if (fs.existsSync(file)) continue;
        ff(['-f', 'lavfi', '-i', `testsrc2=size=${w}x${h}:rate=24:duration=${2 + (i % 4)}`,
            '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file]);
    }
    console.log(`videos done in ${Date.now() - t0}ms`);
    for (let i = 0; i < nGifs; i++) {
        const file = path.join(outDir, `anim_${String(i).padStart(4, '0')}.${i % 3 === 0 ? 'webp' : 'gif'}`);
        if (fs.existsSync(file)) continue;
        ff(['-f', 'lavfi', '-i', `testsrc=size=320x240:rate=12:duration=${1 + (i % 3)}`, ...(file.endsWith('.webp') ? ['-loop', '0'] : []), file]);
    }
    console.log(`all done in ${Date.now() - t0}ms`);
})();
