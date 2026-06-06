const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');
const { shell } = require('electron');
const { spawn } = require('child_process');
const { getResolve, getCurrentProject } = require('./resolve');
const { readConfig } = require('./config');
const { validateOverlayHtml } = require('./render-validation');
const { extensionForRenderSettings, normalizeRenderSettings, proxyPathFor } = require('./render-settings');
const { resolveAssetReferences } = require('./assets');
const { createRenderQueue } = require('./render-queue');
const {
    ENV, NODE_PATH, PLAYWRIGHT_BROWSERS_PATH,
    RENDER_DIR, THUMBNAIL_DIR, CONFIG_DIR
} = require('./paths');
const {
    applyRenderHealthFallback,
    friendlyRenderError,
    getLastRenderError,
    getRenderHealth,
    setLastRenderError,
    summarizeRenderHealth
} = require('./render-health');

const RENDER_START_TIMEOUT_MS = 45000;

console.log('RESOLVED: node=' + NODE_PATH);

function renderFilename(name, extension = '.mov') {
    const safe = (name || 'Overlay').replace(/[^a-zA-Z0-9_-]/g, '_');
    const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
    return `${safe}_${ts}${extension}`;
}

function metadataPathFor(name) {
    return path.join(RENDER_DIR, name.replace(/\.(mov|mp4)$/i, '.json'));
}

function thumbnailPathFor(name) {
    return path.join(THUMBNAIL_DIR, name.replace(/\.(mov|mp4)$/i, '.png'));
}

function thumbnailUrlFor(name) {
    const thumbFile = thumbnailPathFor(name);
    return fs.existsSync(thumbFile) ? pathToFileURL(thumbFile).href : null;
}

function isRenderableOutput(name) {
    return /\.(mov|mp4)$/i.test(name) && !/\.preview\.mp4$/i.test(name);
}

function readRenderMetadata(name) {
    const metadataPath = metadataPathFor(name);
    if (!fs.existsSync(metadataPath)) return null;
    try {
        return JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    } catch {
        return null;
    }
}

function writeRenderMetadata(name, metadata) {
    fs.mkdirSync(RENDER_DIR, { recursive: true });
    const next = {
        ...metadata,
        name,
        path: path.join(RENDER_DIR, name),
        thumbnail: thumbnailUrlFor(name),
        updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(metadataPathFor(name), JSON.stringify(next, null, 2), 'utf8');
    return next;
}

let mainWindow = null;
const RENDER_QUEUE_PATH = path.join(CONFIG_DIR, 'render-queue.json');

function readQueueJobs() {
    try {
        const parsed = JSON.parse(fs.readFileSync(RENDER_QUEUE_PATH, 'utf8'));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function writeQueueJobs(jobs) {
    fs.mkdirSync(path.dirname(RENDER_QUEUE_PATH), { recursive: true });
    fs.writeFileSync(RENDER_QUEUE_PATH, JSON.stringify(jobs, null, 2), 'utf8');
}

const renderQueue = createRenderQueue(readQueueJobs());
const activeRenderProcesses = new Map();

function persistQueue() {
    writeQueueJobs(renderQueue.list());
    return renderQueue.list();
}

async function findOrCreateBin(mediaPool, binName) {
    const root = await mediaPool.GetRootFolder();
    const subs = await root.GetSubFolderList();
    for (const folder of subs) {
        const name = await folder.GetName();
        if (name === binName) return folder;
    }
    return await mediaPool.AddSubFolder(root, binName);
}

function timecodeToFrame(tc, fps) {
    // tc format: "HH:MM:SS:FF" or "HH:MM:SS;FF" (drop-frame)
    const parts = tc.replace(';', ':').split(':').map(Number);
    if (parts.length !== 4) return 0;
    return ((parts[0] * 3600 + parts[1] * 60 + parts[2]) * fps) + parts[3];
}

async function findEmptyTrack(timeline, atFrame, clipFrames) {
    const trackCount = await timeline.GetTrackCount('video');
    // Search from V2 upward for an empty slot at playhead.
    // Locked or disabled tracks can reject AppendToTimeline silently, so skip
    // them when the current Resolve build exposes those checks.
    for (let t = 2; t <= trackCount; t++) {
        try {
            const locked = await timeline.GetIsTrackLocked?.('video', t);
            const enabled = await timeline.GetIsTrackEnabled?.('video', t);
            if (locked || enabled === false) continue;
        } catch (_err) { /* older Resolve builds may not expose track state */ }

        const items = await timeline.GetItemListInTrack('video', t);
        if (!items || items.length === 0) return t;
        let occupied = false;
        for (const item of items) {
            const start = await item.GetStart();
            const end = await item.GetEnd();
            // Overlap check: clip would occupy [atFrame, atFrame+clipFrames)
            if (atFrame < end && (atFrame + clipFrames) > start) {
                occupied = true;
                break;
            }
        }
        if (!occupied) return t;
    }
    // No usable existing track — add one new track.
    await timeline.AddTrack('video');
    return trackCount + 1;
}

async function importToTimeline(movPath) {
    const resolve = await getResolve();
    if (!resolve) return { imported: false, placed: false, reason: 'Resolve is not connected' };

    const project = await getCurrentProject();
    if (!project) return { imported: false, placed: false, reason: 'no project is open' };
    const mediaPool = await project.GetMediaPool();

    // Import into the Resolve AI bin first. If placement fails, the rendered
    // file still remains easy to find in the Media Pool.
    const prevFolder = await mediaPool.GetCurrentFolder();
    const bin = await findOrCreateBin(mediaPool, 'Resolve AI');
    await mediaPool.SetCurrentFolder(bin);
    const clips = await mediaPool.ImportMedia([movPath]);
    await mediaPool.SetCurrentFolder(prevFolder);
    if (!clips || clips.length === 0) {
        return { imported: false, placed: false, reason: 'could not import the file into the Media Pool' };
    }

    try {
        const timeline = await project.GetCurrentTimeline();
        if (!timeline) return { imported: true, placed: false, reason: 'no timeline is open' };

        const tc = await timeline.GetCurrentTimecode();
        const fpsStr = await timeline.GetSetting('timelineFrameRate');
        const fps = parseFloat(fpsStr) || 25;
        const playheadFrame = timecodeToFrame(tc, fps);

        const clip = clips[0];
        const clipProps = await clip.GetClipProperty();
        const clipFrames = parseInt(clipProps.Frames, 10) || Math.round(fps * 5);

        const trackIndex = await findEmptyTrack(timeline, playheadFrame, clipFrames);

        let startFrame = null;
        let endFrame = null;
        try {
            startFrame = await timeline.GetStartFrame();
            endFrame = await timeline.GetEndFrame();
        } catch (_err) { /* older Resolve builds may lack these getters */ }

        const appended = await mediaPool.AppendToTimeline([{
            mediaPoolItem: clip,
            trackIndex,
            recordFrame: playheadFrame,
            mediaType: 1
        }]);

        const placedCount = Array.isArray(appended) ? appended.length : (appended ? 1 : 0);
        console.log('IMPORT PLACEMENT:', JSON.stringify({
            timecode: tc,
            fps,
            recordFrame: playheadFrame,
            trackIndex,
            timelineStartFrame: startFrame,
            timelineEndFrame: endFrame,
            clipFrames,
            appended: placedCount
        }));

        if (placedCount === 0) {
            return {
                imported: true,
                placed: false,
                reason: `Resolve rejected placement on track V${trackIndex} at frame ${playheadFrame}`
            };
        }
        return { imported: true, placed: true, track: trackIndex };
    } catch (err) {
        return { imported: true, placed: false, reason: err.message || 'timeline placement failed' };
    }
}

async function handleRenderMov(_event, { html, name, fps, width, height, renderSettings, metadata }) {
    const cfg = readConfig();
    fps = fps || cfg.fps;
    width = width || cfg.width;
    height = height || cfg.height;
    let normalizedRender = normalizeRenderSettings({ ...(cfg.render || {}), ...(renderSettings || {}) });
    const renderHealth = getRenderHealth({ ...cfg, render: { ...(cfg.render || {}), ...(renderSettings || {}) } });
    if (!renderHealth.ffmpeg.path) {
        const error = friendlyRenderError(renderHealth.ffmpeg.error || 'FFmpeg failed to spawn');
        setLastRenderError({ message: error, raw: renderHealth.ffmpeg.error, renderSettings: normalizedRender, outputPath: null, ffmpegPath: null });
        return { success: false, error, health: renderHealth };
    }
    if (!renderHealth.renderFolder?.writable) {
        const error = friendlyRenderError(renderHealth.renderFolder?.error || 'Permission denied writing render output');
        setLastRenderError({ message: error, raw: renderHealth.renderFolder?.error, renderSettings: normalizedRender, outputPath: null, ffmpegPath: renderHealth.ffmpeg.path });
        return { success: false, error, health: renderHealth };
    }
    if (!(renderHealth.playwright?.ready ?? renderHealth.playwright?.installed)) {
        const raw = renderHealth.playwright?.error || 'Playwright Chromium browser executable is missing';
        const error = friendlyRenderError(raw);
        setLastRenderError({ message: error, raw, renderSettings: normalizedRender, outputPath: null, ffmpegPath: renderHealth.ffmpeg.path });
        return { success: false, error, health: renderHealth };
    }
    const effectiveRender = applyRenderHealthFallback(normalizedRender, renderHealth);
    normalizedRender = effectiveRender.settings;
    for (const warning of effectiveRender.warnings) {
        if (mainWindow) mainWindow.webContents.send('overlay:renderProgress', { type: 'warning', message: warning });
    }
    const neededEncoder = normalizedRender.outputFormat === 'prores'
        ? 'prores_ks'
        : normalizedRender.outputFormat === 'h264'
            ? 'libx264'
            : effectiveRender.hevcEncoder;
    if (neededEncoder && !renderHealth.encoders?.[neededEncoder]) {
        const error = friendlyRenderError(`Unknown encoder ${neededEncoder}`);
        setLastRenderError({ message: error, raw: `Missing encoder ${neededEncoder}`, renderSettings: normalizedRender, outputPath: null, ffmpegPath: renderHealth.ffmpeg.path });
        return { success: false, error, health: renderHealth };
    }
    html = resolveAssetReferences(html, metadata?.selectedAssetIds || cfg.selectedAssetIds || []);
    const tempDir = path.join(os.tmpdir(), 'claude_resolve_' + Date.now());
    fs.mkdirSync(tempDir, { recursive: true });
    fs.mkdirSync(RENDER_DIR, { recursive: true });

    const htmlPath = path.join(tempDir, 'overlay.html');
    const outputPath = path.join(RENDER_DIR, renderFilename(name, extensionForRenderSettings(normalizedRender)));
    const proxyPath = normalizedRender.outputFormat === 'prores' && normalizedRender.createProxy ? proxyPathFor(outputPath) : null;
    const outputName = path.basename(outputPath);
    fs.writeFileSync(htmlPath, html);

    const renderScript = path.join(__dirname, '..', 'renderer', 'render.js');

    console.log('RENDER: script=' + renderScript, 'html=' + htmlPath, 'out=' + outputPath);

    const cleanupTempDir = () => {
        try { fs.rmSync(tempDir, { recursive: true, force: true }); }
        catch (e) { console.log('RENDER TEMP CLEANUP FAILED:', e.message); }
    };

    return new Promise((resolve) => {
        const nodePath = fs.existsSync(NODE_PATH) ? NODE_PATH : process.execPath;
        const usingElectronAsNode = nodePath === process.execPath;
        const proc = spawn(nodePath, [
            renderScript, htmlPath,
            '--fps', String(fps),
            '--width', String(width),
            '--height', String(height),
            '--output', outputPath,
            '--ffmpeg', renderHealth.ffmpeg.path,
            '--output-format', normalizedRender.outputFormat,
            '--prores-profile', normalizedRender.proresProfile,
            '--ffmpeg-threads', normalizedRender.threads,
            ...(effectiveRender.hevcEncoder ? ['--hevc-encoder', effectiveRender.hevcEncoder] : []),
            ...(proxyPath ? [
                '--proxy-output', proxyPath,
                '--proxy-encoder', normalizedRender.proxyEncoder,
                '--proxy-quality', normalizedRender.proxyQuality
            ] : [])
        ], {
            env: usingElectronAsNode
                ? { ...ENV, ELECTRON_RUN_AS_NODE: '1', PLAYWRIGHT_BROWSERS_PATH }
                : { ...ENV, PLAYWRIGHT_BROWSERS_PATH }
        });
        const queueId = metadata?.renderQueueId;
        if (queueId) activeRenderProcesses.set(queueId, proc);

        let buf = '';
        let stderrBuf = '';
        let renderMessages = [];
        let sawRenderOutput = false;
        let settled = false;

        const startupTimer = setTimeout(() => {
            if (sawRenderOutput || settled) return;
            stderrBuf += `\nRenderer produced no output after ${Math.round(RENDER_START_TIMEOUT_MS / 1000)}s. Node path: ${nodePath}`;
            try { proc.kill(); } catch (_e) { /* ignore */ }
        }, RENDER_START_TIMEOUT_MS);

        proc.stdout.on('data', (chunk) => {
            sawRenderOutput = true;
            buf += chunk.toString();
            const lines = buf.split('\n');
            buf = lines.pop();
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const msg = JSON.parse(line);
                    if (msg?.type === 'error' || msg?.type === 'warning') {
                        renderMessages.push(msg);
                    }
                    mainWindow.webContents.send('overlay:renderProgress', msg);
                } catch (_e) { /* ignore non-JSON */ }
            }
        });

        proc.stderr.on('data', (chunk) => {
            sawRenderOutput = true;
            stderrBuf += chunk.toString();
            console.log('RENDER STDERR:', chunk.toString());
        });

        proc.on('close', async (code) => {
            settled = true;
            clearTimeout(startupTimer);
            console.log('RENDER EXIT:', code, stderrBuf.slice(0, 500));
            if (queueId) activeRenderProcesses.delete(queueId);
            cleanupTempDir();
            if (code !== 0) {
                const rendererError = [...renderMessages].reverse().find((msg) => msg.type === 'error' && msg.message)?.message;
                const stderrError = stderrBuf.trim().split('\n').filter(Boolean).pop();
                const errMsg = friendlyRenderError(rendererError || stderrError || 'Render process exited with code ' + code);
                setLastRenderError({ message: errMsg, raw: stderrBuf, renderSettings: normalizedRender, outputPath, ffmpegPath: renderHealth.ffmpeg.path, code });
                resolve({ success: false, error: errMsg });
                return;
            }
            if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size <= 0) {
                const errMsg = friendlyRenderError('Render finished but no output file was created: ' + outputPath);
                setLastRenderError({ message: errMsg, raw: errMsg, renderSettings: normalizedRender, outputPath, ffmpegPath: renderHealth.ffmpeg.path, code });
                resolve({ success: false, error: errMsg });
                return;
            }
            const renderMetadata = writeRenderMetadata(outputName, {
                ...(metadata || {}),
                title: name || outputName.replace(/\.(mov|mp4)$/i, ''),
                html,
                fps,
                width,
                height,
                renderSettings: normalizedRender,
                proxyPath: proxyPath && fs.existsSync(proxyPath) ? proxyPath : null,
                size: fs.existsSync(outputPath) ? fs.statSync(outputPath).size : null,
                createdAt: metadata?.createdAt || new Date().toISOString()
            });
            const timelineResult = await importToTimeline(outputPath);
            setLastRenderError(null);
            resolve({
                success: true,
                path: outputPath,
                name: outputName,
                metadata: renderMetadata,
                imported: !!timelineResult.imported,
                placed: !!timelineResult.placed,
                track: timelineResult.track || null,
                placementReason: timelineResult.reason || '',
                warning: timelineResult.placed
                    ? ''
                    : timelineResult.imported
                        ? 'Rendered and imported to Media Pool, but timeline placement failed: ' + (timelineResult.reason || 'unknown reason')
                        : 'Rendered, but Media Pool import failed: ' + (timelineResult.reason || 'unknown reason')
            });
        });

        proc.on('error', (err) => {
            settled = true;
            clearTimeout(startupTimer);
            console.log('RENDER SPAWN ERROR:', err.message);
            if (queueId) activeRenderProcesses.delete(queueId);
            cleanupTempDir();
            const errMsg = friendlyRenderError('Failed to spawn: ' + err.message);
            setLastRenderError({ message: errMsg, raw: err.message, renderSettings: normalizedRender, outputPath, ffmpegPath: renderHealth.ffmpeg.path });
            resolve({ success: false, error: errMsg });
        });
    });
}

function handleListRenders() {
    if (!fs.existsSync(RENDER_DIR)) return [];
    return fs.readdirSync(RENDER_DIR)
        .filter(isRenderableOutput)
        .map(f => {
            const stat = fs.statSync(path.join(RENDER_DIR, f));
            const thumbnail = thumbnailUrlFor(f);
            const metadata = readRenderMetadata(f);
            return {
                name: f,
                size: stat.size,
                thumbnail,
                createdAt: stat.birthtime?.toISOString?.() || null,
                updatedAt: stat.mtime?.toISOString?.() || null,
                metadata: metadata ? { ...metadata, thumbnail: metadata.thumbnail || thumbnail } : null
            };
        })
        .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
}

async function handleSyncToMediaPool() {
    if (!fs.existsSync(RENDER_DIR)) return { synced: 0, total: 0 };
    const files = fs.readdirSync(RENDER_DIR).filter(isRenderableOutput);
    if (files.length === 0) return { synced: 0, total: 0 };

    const resolve = await getResolve();
    if (!resolve) return { synced: 0, total: files.length, error: 'Resolve not connected' };

    const project = await getCurrentProject();
    const mediaPool = await project.GetMediaPool();
    const bin = await findOrCreateBin(mediaPool, 'Resolve AI');

    const existing = await bin.GetClipList();
    const existingNames = new Set();
    for (const clip of (existing || [])) {
        const props = await clip.GetClipProperty();
        if (props['File Name']) existingNames.add(props['File Name']);
    }

    const toImport = files.filter(f => !existingNames.has(f));
    if (toImport.length === 0) return { synced: 0, total: files.length };

    const prevFolder = await mediaPool.GetCurrentFolder();
    await mediaPool.SetCurrentFolder(bin);
    await mediaPool.ImportMedia(toImport.map(f => path.join(RENDER_DIR, f)));
    await mediaPool.SetCurrentFolder(prevFolder);

    return { synced: toImport.length, total: files.length };
}

function handleDeleteRender(_event, name) {
    const p = path.join(RENDER_DIR, name);
    if (!fs.existsSync(p)) return false;
    const metadataValue = readRenderMetadata(name);
    fs.rmSync(p);
    if (metadataValue?.proxyPath && fs.existsSync(metadataValue.proxyPath)) fs.rmSync(metadataValue.proxyPath);
    const thumb = thumbnailPathFor(name);
    if (fs.existsSync(thumb)) fs.rmSync(thumb);
    const metadata = metadataPathFor(name);
    if (fs.existsSync(metadata)) fs.rmSync(metadata);
    return true;
}

function handleRenameRender(_event, name, nextName) {
    const source = path.join(RENDER_DIR, name);
    if (!fs.existsSync(source)) return { success: false, error: 'Render not found' };

    const safeBase = String(nextName || '')
        .replace(/\.(mov|mp4)$/i, '')
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .replace(/^_+|_+$/g, '') || name.replace(/\.(mov|mp4)$/i, '');
    const extension = path.extname(name).toLowerCase() === '.mp4' ? '.mp4' : '.mov';
    const targetName = `${safeBase}${extension}`;
    const target = path.join(RENDER_DIR, targetName);
    if (fs.existsSync(target)) return { success: false, error: 'A render with that name already exists' };

    fs.renameSync(source, target);

    const oldThumb = thumbnailPathFor(name);
    const newThumb = thumbnailPathFor(targetName);
    if (fs.existsSync(oldThumb)) fs.renameSync(oldThumb, newThumb);

    const oldMetadata = readRenderMetadata(name) || {};
    if (oldMetadata.proxyPath && fs.existsSync(oldMetadata.proxyPath)) {
        const nextProxy = proxyPathFor(target);
        fs.renameSync(oldMetadata.proxyPath, nextProxy);
        oldMetadata.proxyPath = nextProxy;
    }
    const oldMetadataPath = metadataPathFor(name);
    if (fs.existsSync(oldMetadataPath)) fs.rmSync(oldMetadataPath);
    const metadata = writeRenderMetadata(targetName, oldMetadata);

    return { success: true, name: targetName, metadata };
}

function handleRevealRender(_event, name) {
    const p = path.join(RENDER_DIR, name);
    if (!fs.existsSync(p)) return false;
    shell.showItemInFolder(p);
    return true;
}

async function handleAddRenderToTimeline(_event, name) {
    const safeName = path.basename(String(name || ''));
    if (!isRenderableOutput(safeName)) return { success: false, error: 'Unsupported render file.' };
    const renderPath = path.join(RENDER_DIR, safeName);
    if (!fs.existsSync(renderPath)) return { success: false, error: 'Render not found.' };
    try {
        await importToTimeline(renderPath);
        return { success: true, name: safeName };
    } catch (err) {
        return { success: false, error: err.message || 'Could not add render to the active timeline.' };
    }
}

function handleDeleteAllRenders() {
    if (!fs.existsSync(RENDER_DIR)) return false;
    fs.rmSync(RENDER_DIR, { recursive: true, force: true });
    fs.mkdirSync(RENDER_DIR, { recursive: true });
    return true;
}

function handleValidateOverlay(_event, input) {
    return validateOverlayHtml(input);
}

function handleGetRenderHealth() {
    return getRenderHealth(readConfig());
}

function handleRepairRenderDeps() {
    const health = getRenderHealth(readConfig());
    const summary = summarizeRenderHealth(health);
    return {
        success: summary.ok,
        health,
        failures: summary.failures,
        warnings: summary.warnings,
        message: summary.ok
            ? 'Render dependencies are ready.'
            : `Render dependencies still need attention. ${summary.fix}`
    };
}

function handleRenderQueue(_event, payload = {}) {
    const action = payload.action || 'list';
    let result = null;
    if (action === 'enqueue') result = renderQueue.enqueue(payload.job || {});
    else if (action === 'start') result = renderQueue.start(payload.id);
    else if (action === 'complete') result = renderQueue.complete(payload.id, payload.result);
    else if (action === 'fail') result = renderQueue.fail(payload.id, payload.error);
    else if (action === 'cancel') {
        const proc = activeRenderProcesses.get(payload.id);
        if (proc) {
            try { proc.kill('SIGTERM'); } catch { /* ignore */ }
            activeRenderProcesses.delete(payload.id);
        }
        result = renderQueue.cancel(payload.id);
    }
    else if (action === 'retry') result = renderQueue.retry(payload.id);
    else if (action === 'clearCompleted') result = { cleared: renderQueue.clearCompleted() };
    return { success: true, action, result, jobs: persistQueue() };
}

async function handleOpenRenderFolder() {
    fs.mkdirSync(RENDER_DIR, { recursive: true });
    const error = await shell.openPath(RENDER_DIR);
    return { success: !error, error: error || null, path: RENDER_DIR };
}

function setupOverlayHandlers(ipcMain, win) {
    mainWindow = win;
    ipcMain.handle('overlay:renderMov', handleRenderMov);
    ipcMain.handle('overlay:validate', handleValidateOverlay);
    ipcMain.handle('overlay:getRenderHealth', handleGetRenderHealth);
    ipcMain.handle('overlay:repairRenderDeps', handleRepairRenderDeps);
    ipcMain.handle('overlay:getLastRenderError', () => getLastRenderError());
    ipcMain.handle('renders:list', handleListRenders);
    ipcMain.handle('renders:delete', handleDeleteRender);
    ipcMain.handle('renders:rename', handleRenameRender);
    ipcMain.handle('renders:reveal', handleRevealRender);
    ipcMain.handle('renders:addToTimeline', handleAddRenderToTimeline);
    ipcMain.handle('renders:deleteAll', handleDeleteAllRenders);
    ipcMain.handle('renders:syncToMediaPool', handleSyncToMediaPool);
    ipcMain.handle('renders:queue', handleRenderQueue);
    ipcMain.handle('renders:openFolder', handleOpenRenderFolder);
}

module.exports = { setupOverlayHandlers };
