const assert = require('assert');
const { mergeConfig } = require('../ipc/config');

const merged = mergeConfig({
  provider: 'codex',
  brandKit: { colors: '#fff' },
  ui: {}
});

assert.strictEqual(merged.provider, 'codex');
assert.strictEqual(merged.brandKit.colors, '#fff');
assert.strictEqual(merged.brandKit.fonts, '');
assert.strictEqual(merged.ui.rawLogsOpen, false);
assert.strictEqual(merged.width, 1920);
assert.deepStrictEqual(merged.selectedAssetIds, []);

console.log('config tests passed');
