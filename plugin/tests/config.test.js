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
assert.strictEqual(merged.ui.activeToolTab, 'create');
assert.strictEqual(merged.generation.variationCount, 3);
assert.strictEqual(merged.generation.locks.logo, false);
assert.strictEqual(merged.captions.defaultStyle, 'clean');
assert.strictEqual(merged.assets.maxImportSizeMb, 25);
assert.strictEqual(merged.render.proresProfile, '4444');
assert.strictEqual(merged.render.threads, 'auto');
assert.strictEqual(merged.render.createProxy, false);
assert.strictEqual(merged.render.proxyEncoder, 'auto');
assert.deepStrictEqual(merged.gallery.favorites, []);
assert.deepStrictEqual(merged.gallery.recentIds, []);
assert.strictEqual(merged.width, 1920);
assert.deepStrictEqual(merged.selectedAssetIds, []);

console.log('config tests passed');
