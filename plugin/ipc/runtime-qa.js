const fs = require('fs');
const path = require('path');
const { getRenderHealth } = require('./render-health');
const { readConfig } = require('./config');
const { getManimStarterScenes, validateManimSource, detectManim } = require('./manim');
const { DEFAULT_STORE } = require('./ograph');

function checkFile(rootDir, relativePath, label) {
    const filePath = path.join(rootDir, relativePath);
    return {
        id: `file:${relativePath}`,
        label,
        status: fs.existsSync(filePath) ? 'pass' : 'fail',
        detail: relativePath
    };
}

function pass(id, label, detail = '') {
    return { id, label, status: 'pass', detail };
}

function warn(id, label, detail = '') {
    return { id, label, status: 'warn', detail };
}

function fail(id, label, detail = '') {
    return { id, label, status: 'fail', detail };
}

function summarize(checks) {
    return {
        pass: checks.filter(check => check.status === 'pass').length,
        warn: checks.filter(check => check.status === 'warn').length,
        fail: checks.filter(check => check.status === 'fail').length
    };
}

function runRuntimeQA(options = {}) {
    const rootDir = options.rootDir || path.join(__dirname, '..');
    const config = options.config || readConfig();
    const checks = [
        checkFile(rootDir, 'dist/index.html', 'Built renderer bundle'),
        checkFile(rootDir, 'src/components/WorkspaceShell.jsx', 'Workspace shell source'),
        checkFile(rootDir, 'src/components/WorkspaceRail.jsx', 'Workspace rail source'),
        checkFile(rootDir, 'src/components/InspectorPanel.jsx', 'Inspector panel source'),
        checkFile(rootDir, 'src/components/SidebarOgraph.jsx', 'Ograph workbench source'),
        checkFile(rootDir, 'src/components/SidebarManimLab.jsx', 'Manim Lab source'),
        checkFile(rootDir, 'ipc/ograph.js', 'Ograph IPC'),
        checkFile(rootDir, 'ipc/manim.js', 'Manim IPC'),
        checkFile(rootDir, 'ipc/render-health.js', 'Render health IPC')
    ];

    const renderHealth = options.renderHealth || getRenderHealth(config);
    checks.push(renderHealth.ready
        ? pass('render:health', 'Render engine ready', `${renderHealth.ffmpeg?.source || 'unknown'} FFmpeg`)
        : fail('render:health', 'Render engine needs attention', renderHealth.ffmpeg?.error || renderHealth.missingRequiredEncoders?.join(', ') || 'Unknown render issue'));

    const requiredEncoders = renderHealth.requiredEncoders || [];
    for (const encoder of requiredEncoders) {
        checks.push(renderHealth.encoders?.[encoder]
            ? pass(`encoder:${encoder}`, `Encoder ${encoder}`, 'Available')
            : fail(`encoder:${encoder}`, `Encoder ${encoder}`, 'Missing'));
    }

    const starterScenes = options.starterScenes || getManimStarterScenes();
    const starterFailures = starterScenes
        .map(scene => ({ scene, validation: validateManimSource(scene.source) }))
        .filter(item => !item.validation.valid);
    checks.push(starterScenes.length
        ? pass('manim:starters', 'Manim starter scenes', `${starterScenes.length} available`)
        : fail('manim:starters', 'Manim starter scenes', 'No starter scenes registered'));
    checks.push(starterFailures.length
        ? fail('manim:starter-validation', 'Manim starter validation', starterFailures.map(item => item.scene.id).join(', '))
        : pass('manim:starter-validation', 'Manim starter validation', 'All starter scenes pass'));

    const manimHealth = options.manimHealth || detectManim();
    checks.push(manimHealth.ready
        ? pass('manim:local', 'Local Manim renderer', manimHealth.manim?.version || manimHealth.mode || 'Ready')
        : warn('manim:local', 'Local Manim renderer optional', 'Install Manim to render technical scenes locally'));

    const ographStoreDir = path.dirname(options.ographStore || DEFAULT_STORE);
    checks.push(fs.existsSync(ographStoreDir)
        ? pass('ograph:store', 'Ograph storage folder', ographStoreDir)
        : warn('ograph:store', 'Ograph storage folder', 'Will be created after first Ograph save'));

    const manual = [
        'Open Resolve AI inside DaVinci Resolve at narrow plugin width and confirm no clipped rail/sidebar controls.',
        'Generate an overlay, open Ograph, use Render graph, then Add at Playhead.',
        'Ask the AI for a Manim scene, open Manim Lab, click Use latest AI source, then confirm the Python source editor fills.',
        'Open Manim Lab, load a starter scene or latest AI source, render MP4 when Manim is installed, then Add at Playhead.',
        'After a successful Manim render, click Save to Ograph and confirm the new Ograph is labeled Manim Lab.',
        'From that Manim Ograph, click Open in Manim Lab and confirm the same source returns ready for validation/render.',
        'Switch Create, Produce, and Discover workspaces and confirm existing tools remain reachable.',
        'Repeat the full Ograph and Manim loop on Windows and macOS before marking the release runtime-verified.'
    ];

    const summary = summarize(checks);
    return {
        status: summary.fail ? 'fail' : summary.warn ? 'warn' : 'pass',
        summary,
        checks,
        manual,
        createdAt: new Date().toISOString()
    };
}

function setupRuntimeQAHandlers(ipcMain) {
    ipcMain.handle('runtimeQA:run', () => runRuntimeQA());
}

module.exports = {
    runRuntimeQA,
    setupRuntimeQAHandlers,
    summarize
};
