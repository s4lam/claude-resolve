const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  applyRenderHealthFallback,
  friendlyRenderError,
  findPlaywrightChromiumExecutable,
  getRenderHealth,
  parseEncoderSupport,
  preferredHevcEncoder,
  resolveFfmpegPath,
  summarizeRenderHealth
} = require('../ipc/render-health');

const okProbe = candidate => !String(candidate).includes('bad');
const exists = candidate => String(candidate).startsWith('/exists') || String(candidate).startsWith('C:\\exists');

const configured = resolveFfmpegPath({
  render: { ffmpegPath: '/exists/config/ffmpeg' }
}, {
  existsSync: exists,
  probeExecutable: okProbe,
  bundledPath: '/exists/static/ffmpeg',
  candidates: ['/exists/system/ffmpeg'],
  shellCandidate: '/exists/shell/ffmpeg'
});
assert.strictEqual(configured.path, '/exists/config/ffmpeg');
assert.strictEqual(configured.source, 'config');

const bundled = resolveFfmpegPath({
  render: { ffmpegPath: '/missing/config/ffmpeg' }
}, {
  existsSync: exists,
  probeExecutable: okProbe,
  bundledPath: '/exists/static/ffmpeg',
  candidates: ['/exists/system/ffmpeg'],
  shellCandidate: '/exists/shell/ffmpeg'
});
assert.strictEqual(bundled.path, '/exists/static/ffmpeg');
assert.strictEqual(bundled.source, 'bundled');

const system = resolveFfmpegPath({}, {
  existsSync: exists,
  probeExecutable: okProbe,
  bundledPath: null,
  candidates: ['/missing/system/ffmpeg', '/exists/system/ffmpeg'],
  shellCandidate: '/exists/shell/ffmpeg'
});
assert.strictEqual(system.path, '/exists/system/ffmpeg');
assert.strictEqual(system.source, 'known-path');

const fallback = resolveFfmpegPath({}, {
  existsSync: exists,
  probeExecutable: okProbe,
  bundledPath: null,
  candidates: ['/missing/system/ffmpeg'],
  shellCandidate: '/exists/shell/ffmpeg'
});
assert.strictEqual(fallback.path, '/exists/shell/ffmpeg');
assert.strictEqual(fallback.source, 'shell');

const missing = resolveFfmpegPath({}, {
  existsSync: () => false,
  probeExecutable: () => false,
  bundledPath: null,
  candidates: ['/missing/system/ffmpeg'],
  shellCandidate: null
});
assert.strictEqual(missing.path, null);
assert(missing.error.includes('FFmpeg'));

const encoders = parseEncoderSupport(`
 V..... prores_ks Apple ProRes
 V..... libx264 libx264 H.264
 V..... hevc_videotoolbox VideoToolbox HEVC
`);
assert.strictEqual(encoders.prores_ks, true);
assert.strictEqual(encoders.libx264, true);
assert.strictEqual(encoders.hevc_videotoolbox, true);
assert.strictEqual(encoders.hevc_nvenc, false);

assert.strictEqual(preferredHevcEncoder('darwin'), 'hevc_videotoolbox');
assert.strictEqual(preferredHevcEncoder('win32'), 'hevc_nvenc');

const gpuFallback = applyRenderHealthFallback(
  { renderPreset: 'mp4_gpu_quality', outputFormat: 'hevc_nvenc_hq' },
  { encoders: { hevc_nvenc: false } },
  'win32'
);
assert.strictEqual(gpuFallback.fallback, true);
assert.strictEqual(gpuFallback.settings.outputFormat, 'h264');
assert(gpuFallback.warnings[0].includes('CPU MP4'));

const gpuOk = applyRenderHealthFallback(
  { renderPreset: 'mp4_gpu_quality', outputFormat: 'hevc_nvenc_hq' },
  { encoders: { hevc_videotoolbox: true } },
  'darwin'
);
assert.strictEqual(gpuOk.fallback, false);
assert.strictEqual(gpuOk.hevcEncoder, 'hevc_videotoolbox');

const tmpBrowsers = path.join(__dirname, '.tmp-playwright-browsers');
fs.rmSync(tmpBrowsers, { recursive: true, force: true });
try {
  const missingFullChromium = path.join(tmpBrowsers, 'chromium-1223', 'chrome-win64');
  const headlessShell = path.join(tmpBrowsers, 'chromium_headless_shell-1223', 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
  fs.mkdirSync(missingFullChromium, { recursive: true });
  fs.mkdirSync(path.dirname(headlessShell), { recursive: true });
  fs.writeFileSync(headlessShell, '');
  assert.strictEqual(
    findPlaywrightChromiumExecutable({ browsersPath: tmpBrowsers, platform: 'win32' }),
    headlessShell
  );
} finally {
  fs.rmSync(tmpBrowsers, { recursive: true, force: true });
}

const fakeExec = (_bin, args) => {
  if (args.includes('-encoders')) {
    return ' V..... prores_ks Apple ProRes\n V..... libx264 libx264 H.264\n';
  }
  return 'ffmpeg version test';
};
const healthy = getRenderHealth({}, {
  existsSync: exists,
  probeExecutable: okProbe,
  bundledPath: '/exists/static/ffmpeg',
  candidates: [],
  shellCandidate: null,
  execFileSync: fakeExec,
  renderDir: __dirname,
  playwrightHealth: () => ({ installed: true, ready: true, chromiumInstalled: true })
});
assert.strictEqual(healthy.ready, true);
assert.strictEqual(healthy.summary.ok, true);

const missingChromium = getRenderHealth({}, {
  existsSync: exists,
  probeExecutable: okProbe,
  bundledPath: '/exists/static/ffmpeg',
  candidates: [],
  shellCandidate: null,
  execFileSync: fakeExec,
  renderDir: __dirname,
  playwrightHealth: () => ({ installed: true, ready: false, chromiumInstalled: false })
});
assert.strictEqual(missingChromium.ready, false);

const blockedFolder = getRenderHealth({}, {
  existsSync: exists,
  probeExecutable: okProbe,
  bundledPath: '/exists/static/ffmpeg',
  candidates: [],
  shellCandidate: null,
  execFileSync: fakeExec,
  renderDir: __filename,
  playwrightHealth: () => ({ installed: true, ready: true, chromiumInstalled: true })
});
assert.strictEqual(blockedFolder.renderFolder.writable, false);
assert.strictEqual(blockedFolder.ready, false);

const summaryOk = summarizeRenderHealth(healthy, 'win32');
assert.strictEqual(summaryOk.ok, true);
assert.strictEqual(summaryOk.failures.length, 0);
assert(summaryOk.warnings[0].includes('hevc_nvenc'));

const summaryBad = summarizeRenderHealth({
  ffmpeg: { path: null, error: 'missing ffmpeg' },
  encoders: { prores_ks: false, libx264: false },
  renderFolder: { writable: false, error: 'Access denied' },
  playwright: { installed: true, ready: false }
}, 'darwin');
assert.strictEqual(summaryBad.ok, false);
assert(summaryBad.failures.some(item => item.includes('prores_ks')));
assert(summaryBad.failures.some(item => item.includes('libx264')));
assert(summaryBad.failures.some(item => item.includes('Chromium')));
assert(summaryBad.fix.includes('brew install ffmpeg'));

assert(friendlyRenderError('FFmpeg failed to spawn: spawn ffmpeg ENOENT').includes('could not be started'));
assert(friendlyRenderError('Unknown encoder hevc_nvenc').includes('encoder is not available'));
assert(friendlyRenderError('Permission denied writing output.mov').includes('cannot write'));
assert(friendlyRenderError('MP4 alpha mismatch').includes('ProRes MOV'));
assert(friendlyRenderError('browser executable does not exist at chromium').includes('Chromium'));
assert(friendlyRenderError('Render finished but no output file was created: out.mov').includes('usable output'));

console.log('render health tests passed');
