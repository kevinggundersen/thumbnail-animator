// build/afterPack.js — electron-builder afterPack hook
// Strips ONNX Runtime binaries for platforms/architectures that don't match the
// current build target, keeping each installer at ~160 MB instead of ~400+ MB.
//
// Why a hook instead of "files" patterns?
//   electron-builder's `files` property is only supported at the top-level
//   Configuration, NOT inside per-platform sections (win/mac/linux).  A hook
//   lets us use the build context to decide what to keep.

const fs   = require('fs');
const path = require('path');

const ARCH_NAMES = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' };

exports.default = async function afterPack(context) {
    const platform = context.electronPlatformName;          // 'darwin' | 'linux' | 'win32'
    const arch     = ARCH_NAMES[context.arch] || 'x64';    // e.g. 'x64', 'arm64'

    // Locate the unpacked onnxruntime-node binaries inside the build output.
    // macOS apps nest resources inside the .app bundle; all others use a flat
    // resources/ directory.
    const bases = [
        path.join(context.appOutDir, 'resources', 'app.asar.unpacked'),
    ];
    if (platform === 'darwin') {
        const appName = context.packager.appInfo.productFilename;
        bases.push(
            path.join(context.appOutDir, `${appName}.app`, 'Contents', 'Resources', 'app.asar.unpacked')
        );
    }

    for (const base of bases) {
        const onnxBinDir = path.join(
            base, 'node_modules', '@huggingface', 'transformers',
            'node_modules', 'onnxruntime-node', 'bin', 'napi-v6'
        );
        if (!fs.existsSync(onnxBinDir)) continue;

        let removed = 0;

        for (const platformDir of fs.readdirSync(onnxBinDir)) {
            const platformPath = path.join(onnxBinDir, platformDir);
            if (!fs.statSync(platformPath).isDirectory()) continue;

            // Wrong platform → remove entirely
            if (platformDir !== platform) {
                fs.rmSync(platformPath, { recursive: true, force: true });
                removed++;
                continue;
            }

            // Right platform → remove wrong architectures
            for (const archDir of fs.readdirSync(platformPath)) {
                const archPath = path.join(platformPath, archDir);
                if (fs.statSync(archPath).isDirectory() && archDir !== arch) {
                    fs.rmSync(archPath, { recursive: true, force: true });
                    removed++;
                }
            }
        }

        if (removed > 0) {
            console.log(`  [afterPack] Stripped ${removed} unused ONNX Runtime directories (keeping ${platform}/${arch})`);
        }
    }
};
