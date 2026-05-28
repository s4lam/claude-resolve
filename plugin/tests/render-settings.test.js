const assert = require('assert');
const { normalizeRenderSettings, proxyPathFor } = require('../ipc/render-settings');

assert.deepStrictEqual(normalizeRenderSettings({}), {
  proresProfile: '4444',
  threads: 'auto',
  createProxy: false,
  proxyEncoder: 'auto',
  proxyQuality: 'balanced'
});

assert.deepStrictEqual(normalizeRenderSettings({
  proresProfile: '4444xq',
  threads: '64',
  createProxy: true,
  proxyEncoder: 'h264_nvenc',
  proxyQuality: 'high'
}), {
  proresProfile: '4444xq',
  threads: '32',
  createProxy: true,
  proxyEncoder: 'h264_nvenc',
  proxyQuality: 'high'
});

assert.strictEqual(normalizeRenderSettings({
  proresProfile: 'bad',
  threads: 'bad',
  proxyEncoder: 'bad',
  proxyQuality: 'bad'
}).proxyEncoder, 'auto');

assert.strictEqual(proxyPathFor('Title.mov'), 'Title.preview.mp4');

console.log('render-settings tests passed');
