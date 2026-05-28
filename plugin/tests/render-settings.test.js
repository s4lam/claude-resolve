const assert = require('assert');
const {
  applyRenderPreset,
  extensionForRenderSettings,
  normalizeRenderSettings,
  presetForRenderSettings,
  proxyPathFor,
  renderPresetDetails
} = require('../ipc/render-settings');

assert.deepStrictEqual(normalizeRenderSettings({}), {
  renderPreset: 'prores_mov',
  outputFormat: 'prores',
  proresProfile: '4444',
  threads: 'auto',
  createProxy: false,
  proxyEncoder: 'auto',
  proxyQuality: 'balanced'
});

assert.deepStrictEqual(normalizeRenderSettings({
  outputFormat: 'h264',
  proresProfile: '4444xq',
  threads: '64',
  createProxy: true,
  proxyEncoder: 'h264_nvenc',
  proxyQuality: 'high'
}), {
  renderPreset: 'mp4_cpu_quality',
  outputFormat: 'h264',
  proresProfile: '4444xq',
  threads: '32',
  createProxy: true,
  proxyEncoder: 'h264_nvenc',
  proxyQuality: 'high'
});

assert.strictEqual(normalizeRenderSettings({
  outputFormat: 'bad',
  proresProfile: 'bad',
  threads: 'bad',
  proxyEncoder: 'bad',
  proxyQuality: 'bad'
}).proxyEncoder, 'auto');

assert.strictEqual(proxyPathFor('Title.mov'), 'Title.preview.mp4');
assert.strictEqual(extensionForRenderSettings({ outputFormat: 'h264' }), '.mp4');
assert.strictEqual(extensionForRenderSettings({ outputFormat: 'hevc_nvenc_hq' }), '.mp4');
assert.strictEqual(extensionForRenderSettings({ outputFormat: 'prores' }), '.mov');
assert.strictEqual(normalizeRenderSettings({ outputFormat: 'hevc_nvenc_hq' }).outputFormat, 'hevc_nvenc_hq');
assert.strictEqual(normalizeRenderSettings({ renderPreset: 'mp4_cpu_quality' }).outputFormat, 'h264');
assert.strictEqual(normalizeRenderSettings({ renderPreset: 'mp4_cpu_quality' }).proxyEncoder, 'libx264');
assert.strictEqual(normalizeRenderSettings({ renderPreset: 'mp4_gpu_quality' }).outputFormat, 'hevc_nvenc_hq');
assert.strictEqual(presetForRenderSettings({ outputFormat: 'h264' }), 'mp4_cpu_quality');
assert.strictEqual(applyRenderPreset('mp4_gpu_quality').outputFormat, 'hevc_nvenc_hq');
assert.strictEqual(renderPresetDetails({ renderPreset: 'prores_mov', proresProfile: '4444xq' }).codec, 'ProRes 4444 XQ');

console.log('render-settings tests passed');
