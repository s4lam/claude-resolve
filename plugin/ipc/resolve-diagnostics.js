const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { CONFIG_DIR } = require('./paths');
const { getCurrentProject, getResolve } = require('./resolve');
const { getRenderHealth, summarizeRenderHealth } = require('./render-health');
const { detectNativeText } = require('./captions');
const { readConfig } = require('./config');

const SAFETY_DIR = path.join(CONFIG_DIR, 'safety-snapshots');

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function status(ready, partial = false) {
    if (ready) return 'ready';
    return partial ? 'partial' : 'unavailable';
}

function cap(id, label, ready, fallback, extra = {}) {
    return {
        id,
        label,
        status: status(Boolean(ready), Boolean(extra.partial)),
        fallback: ready ? '' : fallback,
        ...extra
    };
}

async function safe(label, fn, fallbackValue = null) {
    try {
        return { ok: true, value: await fn() };
    } catch (error) {
        return { ok: false, value: fallbackValue, error: `${label}: ${error.message || error}` };
    }
}

function methodNames(obj) {
    if (!obj) return [];
    const names = new Set();
    let cur = obj;
    while (cur && cur !== Object.prototype) {
        for (const name of Object.getOwnPropertyNames(cur)) {
            if (typeof obj[name] === 'function') names.add(name);
        }
        cur = Object.getPrototypeOf(cur);
    }
    return [...names].sort();
}

function hasMethod(obj, name) {
    return methodNames(obj).includes(name);
}

function selectedClipList(selected) {
    if (Array.isArray(selected)) return selected.filter(Boolean);
    if (selected && typeof selected === 'object') {
        return Object.values(selected).filter(item => item && typeof item === 'object');
    }
    return [];
}

async function buildCapabilityReport(options = {}) {
    const cfg = options.config || readConfig();
    const generatedAt = new Date().toISOString();
    const renderHealth = getRenderHealth(cfg, options);
    const nativeText = detectNativeText({ templateName: cfg.captions?.nativeTemplateName });
    const report = {
        generatedAt,
        resolve: { status: 'unavailable', version: '', page: '' },
        project: null,
        capabilities: [],
        render: {
            status: renderHealth.ready ? 'ready' : 'partial',
            summary: summarizeRenderHealth(renderHealth),
            ffmpeg: renderHealth.ffmpeg,
            encoders: renderHealth.encoders
        }
    };

    const resolveResult = await safe('resolve', () => getResolve());
    const resolve = resolveResult.value;
    report.resolve.status = resolveResult.ok && resolve ? 'ready' : 'unavailable';
    if (!resolve) {
        report.capabilities.push(cap('resolve-connection', 'Resolve connection', false, 'Open DaVinci Resolve Studio and enable Workflow Integration scripting.'));
        return report;
    }

    const version = await safe('version', () => resolve.GetVersionString ? resolve.GetVersionString() : '');
    const page = await safe('page', () => resolve.GetCurrentPage ? resolve.GetCurrentPage() : '');
    report.resolve.version = version.value || '';
    report.resolve.page = page.value || '';

    const projectResult = await safe('project', () => getCurrentProject());
    const project = projectResult.value;
    report.project = {
        status: project ? 'ready' : 'unavailable',
        name: project && project.GetName ? await safe('project name', () => project.GetName(), '').then(r => r.value) : ''
    };

    const mediaPool = hasMethod(project, 'GetMediaPool') ? await safe('media pool', () => project.GetMediaPool()).then(r => r.value) : null;
    const timeline = hasMethod(project, 'GetCurrentTimeline') ? await safe('timeline', () => project.GetCurrentTimeline()).then(r => r.value) : null;
    const selected = hasMethod(mediaPool, 'GetSelectedClips') ? await safe('selected clips', () => mediaPool.GetSelectedClips(), []).then(r => r.value) : null;
    const selectedItems = selectedClipList(selected);
    const selectedCount = selectedItems.length;

    report.capabilities.push(
        cap('media-pool-selection', 'Selected Media Pool clips', hasMethod(mediaPool, 'GetSelectedClips'), 'Select one Media Pool clip manually or import a transcript.', { selectedCount }),
        cap('timeline-access', 'Current timeline access', Boolean(timeline), 'Open a timeline before using timeline-aware tools.'),
        cap('create-timeline', 'Create timelines from clips', hasMethod(mediaPool, 'CreateTimelineFromClips'), 'Use render-only output or create timelines manually in Resolve.'),
        cap('append-timeline', 'Append clips to timeline', hasMethod(mediaPool, 'AppendToTimeline'), 'Resolve API cannot append clips in this version/state.'),
        cap('timeline-markers', 'Timeline markers', hasMethod(timeline, 'AddMarker'), 'Review marker export will stay as JSON until marker APIs are available.'),
        cap('render-settings', 'Resolve render settings probe', hasMethod(project, 'GetRenderFormats') || hasMethod(project, 'SetRenderSettings'), 'FFmpeg overlay rendering still works without Resolve render setting probes.', { partial: Boolean(project) }),
        cap('transcription', 'Resolve transcription hooks', Boolean(selectedCount && methodNames(selectedItems[0]).some(name => /transcribe/i.test(name))), 'Use local Whisper or import SRT/VTT/TXT.'),
        cap('native-text', 'Native Resolve Text+ captions', nativeText.ready, nativeText.reason || 'Use transparent overlay captions.', { detail: nativeText }),
        cap('fusion-text', 'Fusion/Text+ bridge', nativeText.ready, 'Feature-gated until fuscript and caption template are detected.')
    );

    return report;
}

function safetySnapshotPath(id, dir = SAFETY_DIR) {
    return path.join(dir, `${String(id || '').replace(/[^a-z0-9_-]/gi, '_')}.json`);
}

function createSafetySnapshot(payload = {}, dir = SAFETY_DIR) {
    ensureDir(dir);
    const id = payload.id || `safety-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
    const snapshot = {
        id,
        createdAt: new Date().toISOString(),
        action: payload.action || 'unknown',
        project: payload.project || null,
        source: payload.source || null,
        plan: payload.plan || null,
        result: payload.result || null,
        createdTimelineNames: payload.createdTimelineNames || [],
        notes: payload.notes || []
    };
    fs.writeFileSync(safetySnapshotPath(id, dir), JSON.stringify(snapshot, null, 2), 'utf8');
    return snapshot;
}

function listSafetySnapshots(dir = SAFETY_DIR) {
    ensureDir(dir);
    return fs.readdirSync(dir)
        .filter(name => name.endsWith('.json'))
        .map(name => {
            try {
                const item = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
                return { id: item.id, action: item.action, createdAt: item.createdAt, createdTimelineNames: item.createdTimelineNames || [] };
            } catch (_err) {
                return null;
            }
        })
        .filter(Boolean)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function getLatestSafetySnapshot(dir = SAFETY_DIR) {
    const list = listSafetySnapshots(dir);
    if (!list.length) return null;
    return JSON.parse(fs.readFileSync(safetySnapshotPath(list[0].id, dir), 'utf8'));
}

function setupResolveDiagnosticsHandlers(ipcMain) {
    ipcMain.handle('resolve:capabilityReport', () => buildCapabilityReport());
    ipcMain.handle('resolve:safetySnapshot', (_event, payload = {}) => createSafetySnapshot(payload));
}

module.exports = {
    buildCapabilityReport,
    cap,
    createSafetySnapshot,
    getLatestSafetySnapshot,
    listSafetySnapshots,
    setupResolveDiagnosticsHandlers
};
