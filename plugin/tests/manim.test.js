const assert = require('assert');
const {
  buildManimInstallCommand,
  buildManimPrompt,
  buildRenderArgs,
  detectManim,
  extractPythonSource,
  firstLine,
  getManimStarterScenes,
  probeFirst,
  validateManimSource
} = require('../ipc/manim');

assert.strictEqual(firstLine('\nManim Community v0.19.0\nextra'), 'Manim Community v0.19.0');

const ready = detectManim({}, (command, args) => {
  if (command === 'manim' && args[0] === '--version') {
    return { ok: true, stdout: 'Manim Community v0.19.0\n', stderr: '' };
  }
  if ((command === 'python' || command === 'python3' || command === 'py') && args[0] === '--version') {
    return { ok: true, stdout: 'Python 3.12.0\n', stderr: '' };
  }
  return { ok: false, stdout: '', stderr: '', error: 'missing' };
});
assert.strictEqual(ready.status, 'ready');
assert.strictEqual(ready.ready, true);
assert.strictEqual(ready.mode, 'cli');

const moduleFallback = detectManim({ pythonPath: 'python3' }, (command, args) => {
  if (command === 'python3' && args.join(' ') === '--version') {
    return { ok: true, stdout: 'Python 3.11.8\n', stderr: '' };
  }
  if (command === 'python3' && args.join(' ') === '-m manim --version') {
    return { ok: true, stdout: 'Manim Community v0.18.1\n', stderr: '' };
  }
  return { ok: false, stdout: '', stderr: '', error: 'missing' };
});
assert.strictEqual(moduleFallback.status, 'ready');
assert.strictEqual(moduleFallback.mode, 'python-module');
assert.strictEqual(moduleFallback.manim.command, 'python3 -m manim');

const missing = detectManim({}, () => ({ ok: false, stdout: '', stderr: '', error: 'missing' }));
assert.strictEqual(missing.status, 'missing');
assert.strictEqual(missing.ready, false);
assert.ok(missing.suggestions.some(line => line.includes('Python')));

const installCommand = buildManimInstallCommand({
  python: { installed: true, command: 'python3' }
});
assert.strictEqual(installCommand.success, true);
assert.ok(installCommand.command.includes('-m pip install manim'));

const installWithoutPython = buildManimInstallCommand({
  python: { installed: false, command: '' }
});
assert.strictEqual(installWithoutPython.success, false);
assert.strictEqual(installWithoutPython.error, 'python-missing');

const probed = probeFirst(['bad', 'good'], ['--version'], command => {
  if (command === 'good') return { ok: true, stdout: 'ok version\n', stderr: '' };
  return { ok: false, stdout: '', stderr: '', error: 'no' };
});
assert.strictEqual(probed.command, 'good');

const prompt = buildManimPrompt({
  idea: 'Explain a sine wave',
  style: 'clean math',
  width: 1080,
  height: 1920,
  fps: 30,
  duration: 12,
  latestGeneration: { html: '<html>gold typography</html>' }
});
assert.ok(prompt.prompt.includes('ResolveAIManimScene'));
assert.ok(prompt.prompt.includes('1080x1920'));
assert.ok(prompt.prompt.includes('no network calls'));
assert.ok(prompt.prompt.includes('gold typography'));
assert.strictEqual(prompt.safeMode, true);

const source = `\`\`\`python
from manim import *
import math

class ResolveAIManimScene(Scene):
    def construct(self):
        self.play(Create(Circle()))
\`\`\``;
assert.ok(extractPythonSource(source).includes('class ResolveAIManimScene'));
const validation = validateManimSource(source);
assert.strictEqual(validation.valid, true);
assert.strictEqual(validation.errors.length, 0);

const unsafe = validateManimSource(`
from manim import *
import os
class ResolveAIManimScene(Scene):
    def construct(self):
        open("x.txt", "w")
`);
assert.strictEqual(unsafe.valid, false);
assert.ok(unsafe.errors.some(error => error.includes('unsafe')));
assert.ok(unsafe.errors.some(error => error.includes('os')));

const noClass = validateManimSource('from manim import *\\nclass Other(Scene): pass');
assert.strictEqual(noClass.valid, false);
assert.ok(noClass.errors.some(error => error.includes('ResolveAIManimScene')));

const renderArgs = buildRenderArgs('scene.py', 'media', { width: 1080, height: 1920, fps: 60, quality: 'medium', name: 'My Scene' }, ready);
assert.strictEqual(renderArgs.command, ready.renderCommand.command);
assert.ok(renderArgs.args.includes('-qm'));
assert.ok(renderArgs.args.includes('1080,1920'));
assert.ok(renderArgs.args.includes('ResolveAIManimScene'));

const starters = getManimStarterScenes();
assert.ok(starters.length >= 3);
for (const scene of starters) {
  assert.ok(scene.id);
  assert.ok(scene.title);
  assert.ok(scene.description);
  const result = validateManimSource(scene.source);
  assert.strictEqual(result.valid, true, `${scene.id} starter scene should validate`);
  assert.strictEqual(result.errors.length, 0);
}

console.log('manim tests passed');
