const assert = require('assert');
const { validateTemplatePackUrl } = require('../ipc/template-packs');

assert.strictEqual(validateTemplatePackUrl('https://raw.githubusercontent.com/user/repo/main/pack.json').ok, true);
assert.strictEqual(validateTemplatePackUrl('http://localhost:3000/pack.json').ok, false);
assert.strictEqual(validateTemplatePackUrl('http://127.0.0.1/pack.json').ok, false);
assert.strictEqual(validateTemplatePackUrl('http://[::1]/pack.json').ok, false);
assert.strictEqual(validateTemplatePackUrl('http://10.0.0.1/pack.json').ok, false);
assert.strictEqual(validateTemplatePackUrl('http://172.16.0.1/pack.json').ok, false);
assert.strictEqual(validateTemplatePackUrl('http://192.168.1.1/pack.json').ok, false);
assert.strictEqual(validateTemplatePackUrl('http://169.254.169.254/pack.json').ok, false);
assert.strictEqual(validateTemplatePackUrl('https://user:pass@example.com/pack.json').ok, false);
assert.strictEqual(validateTemplatePackUrl('file:///tmp/pack.json').ok, false);
assert.strictEqual(validateTemplatePackUrl('https://example.com/pack.txt').ok, false);
assert.strictEqual(validateTemplatePackUrl('not a url').ok, false);

console.log('template pack URL tests passed');
