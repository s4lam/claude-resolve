const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runRuntimeQA, summarize } = require('../ipc/runtime-qa');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-ai-runtime-qa-'));

try {
    for (const file of [
        'dist/index.html',
        'src/components/WorkspaceShell.jsx',
        'src/components/WorkspaceRail.jsx',
        'src/components/InspectorPanel.jsx',
        'src/components/SidebarOgraph.jsx',
        'src/components/SidebarManimLab.jsx',
        'ipc/ograph.js',
        'ipc/manim.js',
        'ipc/render-health.js'
    ]) {
        const target = path.join(tempRoot, file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, 'ok', 'utf8');
    }

    const result = runRuntimeQA({
        rootDir: tempRoot,
        renderHealth: {
            ready: true,
            ffmpeg: { source: 'bundled' },
            requiredEncoders: ['prores_ks', 'libx264'],
            encoders: { prores_ks: true, libx264: true }
        },
        manimHealth: { ready: false },
        ographStore: path.join(tempRoot, 'ographs.json')
    });

    assert.strictEqual(result.status, 'warn');
    assert.strictEqual(result.summary.fail, 0);
    assert.ok(result.summary.pass > 10);
    assert.ok(result.checks.some(check => check.id === 'manim:local' && check.status === 'warn'));
    assert.ok(result.manual.some(line => line.includes('Ograph')));
    assert.ok(result.manual.some(line => line.includes('Use latest AI source')));
    assert.ok(result.manual.some(line => line.includes('Save to Ograph')));
    assert.ok(result.manual.some(line => line.includes('Open in Manim Lab')));
    assert.ok(result.manual.some(line => line.includes('Windows and macOS')));

    const bad = summarize([{ status: 'pass' }, { status: 'warn' }, { status: 'fail' }]);
    assert.deepStrictEqual(bad, { pass: 1, warn: 1, fail: 1 });

    console.log('runtime QA tests passed');
} finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
}
