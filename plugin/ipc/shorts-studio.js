const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { CONFIG_DIR } = require('./paths');
const { readConfig } = require('./config');
const {
    buildTranscriptHash,
    formatTimestamp,
    handleApplyShortsPlan,
    handleBuildShortsPlan,
    handleGetSelectedMedia,
    handleImportTranscript,
    handleTranscribeSelectedMedia,
    handleValidateShortsPlan,
    makeShortTimelineName
} = require('./rough-cut');

const SHORTS_DIR = path.join(CONFIG_DIR, 'shorts-studio');
const PROJECT_DIR = path.join(SHORTS_DIR, 'projects');
const EXPORT_DIR = path.join(SHORTS_DIR, 'exports');
const TRANSCRIPT_DIR = path.join(SHORTS_DIR, 'transcripts');
const FEEDBACK_PATH = path.join(SHORTS_DIR, 'candidate-feedback.json');
const PROFILE_VERSION = 1;
const execFileAsync = promisify(execFile);

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function makeId(prefix = 'shorts') {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function providerModelFromConfig(config = readConfig()) {
    const provider = config.provider === 'codex' ? 'codex' : config.provider === 'claude' ? 'claude' : 'auto';
    return {
        provider,
        model: provider === 'codex' ? config.codexModel : config.model
    };
}

function projectPath(id, dir = PROJECT_DIR) {
    return path.join(dir, `${String(id || '').replace(/[^a-zA-Z0-9_-]/g, '')}.json`);
}

function readJson(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return null;
    }
}

function writeProject(project, dir = PROJECT_DIR) {
    ensureDir(dir);
    const now = new Date().toISOString();
    const next = {
        ...project,
        id: project.id || makeId(),
        createdAt: project.createdAt || now,
        updatedAt: now
    };
    fs.writeFileSync(projectPath(next.id, dir), JSON.stringify(next, null, 2), 'utf8');
    return next;
}

function listProjects(dir = PROJECT_DIR) {
    ensureDir(dir);
    return fs.readdirSync(dir)
        .filter(name => name.endsWith('.json'))
        .map(name => readJson(path.join(dir, name)))
        .filter(Boolean)
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
        .map(project => ({
            id: project.id,
            sourceName: project.source?.name || project.source?.fileName || 'Selected clip',
            goal: project.goal,
            candidateCount: Array.isArray(project.candidates) ? project.candidates.length : 0,
            selectedCount: Array.isArray(project.selectedIndexes) ? project.selectedIndexes.length : 0,
            provider: project.provider,
            model: project.model,
            updatedAt: project.updatedAt,
            createdAt: project.createdAt
        }));
}

function getProject(id, dir = PROJECT_DIR) {
    const project = readJson(projectPath(id, dir));
    return project && project.id ? project : null;
}

function deleteProject(id, dir = PROJECT_DIR) {
    const filePath = projectPath(id, dir);
    if (!fs.existsSync(filePath)) return { success: false, error: 'Shorts Studio project not found.' };
    fs.unlinkSync(filePath);
    return { success: true };
}

function readFeedback() {
    const records = readJson(FEEDBACK_PATH);
    return Array.isArray(records) ? records : [];
}

function writeFeedback(records = []) {
    ensureDir(path.dirname(FEEDBACK_PATH));
    fs.writeFileSync(FEEDBACK_PATH, JSON.stringify(records.slice(-500), null, 2), 'utf8');
}

function buildCreatorProfile(records = readFeedback()) {
    const selected = records.filter(item => item.decision === 'selected');
    const rejected = records.filter(item => item.decision === 'rejected');
    const countTags = (items) => {
        const counts = new Map();
        for (const item of items) {
            for (const tag of item.tags || []) counts.set(tag, (counts.get(tag) || 0) + 1);
        }
        return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([tag]) => tag);
    };
    const selectedDuration = selected.reduce((sum, item) => sum + (Number(item.durationSeconds) || 0), 0);
    return {
        version: PROFILE_VERSION,
        selectedCount: selected.length,
        rejectedCount: rejected.length,
        likedTags: countTags(selected),
        rejectedTags: countTags(rejected),
        averageSelectedDurationSeconds: selected.length ? Number((selectedDuration / selected.length).toFixed(1)) : null,
        notes: records.map(item => cleanText(item.feedbackReason)).filter(Boolean).slice(-10),
        updatedAt: records.at(-1)?.createdAt || null
    };
}

function saveCandidateFeedback(payload = {}) {
    const candidate = payload.candidate || {};
    const decision = payload.decision === 'rejected' ? 'rejected' : 'selected';
    const record = {
        id: makeId('feedback'),
        projectId: payload.projectId || null,
        candidateIndex: candidate.index ?? payload.candidateIndex ?? null,
        title: candidate.title || '',
        decision,
        feedbackReason: cleanText(payload.feedbackReason || ''),
        tags: Array.isArray(candidate.tags) ? candidate.tags.map(cleanText).filter(Boolean) : [],
        durationSeconds: Number(candidate.durationSeconds || 0) || null,
        rubricScores: candidate.rubricScores || null,
        createdAt: new Date().toISOString()
    };
    const records = readFeedback();
    records.push(record);
    writeFeedback(records);
    if (payload.projectId) {
        const project = getProject(payload.projectId);
        if (project) {
            const candidates = (project.candidates || []).map(item => Number(item.index) === Number(record.candidateIndex)
                ? { ...item, decision, feedbackReason: record.feedbackReason }
                : item);
            writeProject({ ...project, candidates });
        }
    }
    return { success: true, record, profile: buildCreatorProfile(records) };
}

function selectedIndexesFromPayload(payload = {}, candidates = []) {
    const explicit = Array.isArray(payload.selectedIndexes) ? payload.selectedIndexes.map(Number) : null;
    if (explicit && explicit.length) return explicit;
    return candidates.map(candidate => Number(candidate.index)).filter(Number.isFinite);
}

function makePostText(candidate = {}) {
    const publish = candidate.publish || {};
    return [
        publish.title || candidate.title,
        '',
        publish.description || candidate.hook || candidate.reason,
        '',
        Array.isArray(publish.hashtags) ? publish.hashtags.join(' ') : ''
    ].filter(line => line !== undefined && line !== null).join('\n');
}

function makePackageText(packages = []) {
    return packages.map(item => [
        item.title,
        item.timelineName ? `Timeline: ${item.timelineName}` : '',
        item.range?.startLabel && item.range?.endLabel ? `Range: ${item.range.startLabel} - ${item.range.endLabel}` : '',
        '',
        'Post text:',
        item.postText || '',
        '',
        'Caption prompt:',
        item.captionPrompt || '',
        '',
        item.renderPlan ? `Render: ${item.renderPlan.resolution}, ${item.renderPlan.codec}, ${item.renderPlan.fps ? `${item.renderPlan.fps} fps` : 'timeline fps'}` : ''
    ].filter(line => line !== undefined && line !== null).join('\n')).join('\n\n---\n\n');
}

function buildPackage(candidate = {}, source = {}) {
    const timelineName = candidate.timelineName || makeShortTimelineName(candidate, source.name || source.fileName || 'Short');
    const publish = candidate.publish || {};
    const renderPlan = {
        kind: 'timeline-export-prep',
        queueStatus: 'manual',
        timelineName,
        format: 'MP4',
        codec: 'H.265',
        encoder: 'Configured render preset',
        resolution: '1080x1920',
        fps: source.fps || null,
        note: 'Use a vertical 9:16 timeline or crop/reframe before final export.'
    };
    return {
        candidateIndex: candidate.index,
        title: publish.title || candidate.title || `Short ${candidate.index || ''}`.trim(),
        timelineName,
        captionPrompt: publish.captionPrompt || `Create short-form captions for ${candidate.title || 'this Short'}.`,
        postText: makePostText(candidate),
        renderPlan,
        renderPresetSuggestion: {
            format: renderPlan.format,
            codec: renderPlan.codec,
            resolution: renderPlan.resolution,
            fps: renderPlan.fps,
            note: renderPlan.note
        },
        platformChecks: publish.platformChecks || [],
        range: {
            start: candidate.start,
            end: candidate.end,
            startLabel: candidate.startLabel || formatTimestamp(candidate.start || 0),
            endLabel: candidate.endLabel || formatTimestamp(candidate.end || 0)
        }
    };
}

function pathEntries(envPath = process.env.PATH || '') {
    return String(envPath).split(path.delimiter).filter(Boolean);
}

function findExecutable(command, options = {}) {
    if (!command) return null;
    const value = String(command).trim().replace(/^"|"$/g, '');
    const extensions = process.platform === 'win32'
        ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';')
        : [''];
    const candidates = [];
    if (path.isAbsolute(value) || value.includes(path.sep) || value.includes('/')) {
        candidates.push(value);
    } else {
        for (const dir of pathEntries(options.envPath)) {
            candidates.push(path.join(dir, value));
            for (const ext of extensions) {
                if (ext && !value.toLowerCase().endsWith(ext.toLowerCase())) candidates.push(path.join(dir, `${value}${ext.toLowerCase()}`));
            }
        }
    }
    return candidates.find(file => {
        try {
            return fs.existsSync(file) && fs.statSync(file).isFile();
        } catch {
            return false;
        }
    }) || null;
}

function detectLocalTranscribers(config = readConfig(), options = {}) {
    const transcription = config.transcription || {};
    const configured = transcription.commandPath ? findExecutable(transcription.commandPath, options) : null;
    const whisper = transcription.provider === 'whisper' && configured
        ? configured
        : (findExecutable('whisper', options) || findExecutable('whisper.cmd', options));
    const whisperCpp = transcription.provider === 'whisperCpp' && configured
        ? configured
        : (findExecutable('whisper-cli', options) || findExecutable('whisper-cli.exe', options) || findExecutable('whisper.cpp', options));
    const whisperCppModelReady = Boolean(transcription.model && fs.existsSync(transcription.model));
    return {
        whisper: {
            id: 'whisper',
            label: 'OpenAI Whisper',
            ready: Boolean(whisper),
            commandPath: whisper || null,
            requiresModelPath: false
        },
        whisperCpp: {
            id: 'whisperCpp',
            label: 'whisper.cpp',
            ready: Boolean(whisperCpp),
            commandPath: whisperCpp || null,
            requiresModelPath: true,
            modelReady: whisperCppModelReady
        }
    };
}

async function handleDetectTranscribers() {
    const config = readConfig();
    const source = await handleGetSource();
    const local = detectLocalTranscribers(config);
    const providers = [
        {
            id: 'resolve',
            label: 'Resolve TranscribeAudio',
            ready: Boolean(source?.clip?.methodSupport?.transcribeAudio),
            status: source?.clip?.methodSupport?.transcribeAudio ? 'Ready' : 'Unavailable'
        },
        {
            ...local.whisper,
            status: local.whisper.ready ? 'Ready' : 'Not installed'
        },
        {
            ...local.whisperCpp,
            ready: Boolean(local.whisperCpp.ready && local.whisperCpp.modelReady),
            status: local.whisperCpp.ready
                ? local.whisperCpp.modelReady ? 'Ready' : 'Model path needed'
                : 'Not installed'
        }
    ];
    const preferred = providers.find(item => item.id === config.transcription?.provider && item.ready)
        || providers.find(item => (item.id === 'whisper' || item.id === 'whisperCpp') && item.ready)
        || providers.find(item => item.ready)
        || null;
    return { success: true, providers, preferredProvider: preferred?.id || null };
}

function findNewestTranscriptFile(dir) {
    if (!fs.existsSync(dir)) return null;
    return fs.readdirSync(dir)
        .filter(name => /\.(srt|vtt|txt)$/i.test(name))
        .map(name => path.join(dir, name))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || null;
}

async function runWhisperTranscription({ provider, commandPath, clip, config }) {
    if (!clip?.filePath || !fs.existsSync(clip.filePath)) {
        return { success: false, error: 'Selected Media Pool clip does not expose a readable local file path.' };
    }
    ensureDir(TRANSCRIPT_DIR);
    const outputDir = path.join(TRANSCRIPT_DIR, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    ensureDir(outputDir);
    const transcription = config.transcription || {};
    const languageArgs = transcription.language ? ['--language', transcription.language] : [];
    if (provider === 'whisperCpp') {
        if (!transcription.model || !fs.existsSync(transcription.model)) return { success: false, error: 'whisper.cpp transcription needs transcription.model set to a local model path.' };
        const outBase = path.join(outputDir, path.parse(clip.filePath).name);
        await execFileAsync(commandPath, ['-m', transcription.model, '-f', clip.filePath, '-osrt', '-of', outBase], { timeout: 1000 * 60 * 60 });
    } else {
        await execFileAsync(commandPath, [
            clip.filePath,
            '--model', transcription.model || 'base',
            '--output_format', 'srt',
            '--output_dir', outputDir,
            ...languageArgs
        ], { timeout: 1000 * 60 * 60 });
    }
    const transcriptPath = findNewestTranscriptFile(outputDir);
    if (!transcriptPath) return { success: false, error: 'Transcriber finished but no SRT/VTT/TXT output was found.' };
    const text = fs.readFileSync(transcriptPath, 'utf8');
    const parsed = await handleImport(null, { text, format: transcriptPath.toLowerCase().endsWith('.vtt') ? 'vtt' : 'srt' });
    return { ...parsed, success: Boolean(parsed?.hasTiming), provider, transcriptPath };
}

async function handleGetSource() {
    return handleGetSelectedMedia();
}

async function handleImport(_event, payload = {}) {
    return handleImportTranscript(_event, payload);
}

function handleBuildCandidates(_event, payload = {}) {
    const creatorProfile = buildCreatorProfile();
    const result = handleBuildShortsPlan(_event, { ...payload, creatorProfile });
    const analysis = payload.analysisReport;
    const analysisContext = analysis ? [
        '',
        '<source_safe_analysis>',
        analysis.success ? 'status: ready' : 'status: unavailable',
        analysis.technical?.durationSeconds ? `duration: ${analysis.technical.durationSeconds}s` : '',
        analysis.technical?.video?.codec ? `video: ${analysis.technical.video.codec} ${analysis.technical.video.width || ''}x${analysis.technical.video.height || ''} ${analysis.technical.video.fps || ''}fps` : '',
        analysis.technical?.audio?.codec ? `audio: ${analysis.technical.audio.codec} ${analysis.technical.audio.channels || ''}ch` : '',
        Array.isArray(analysis.audioHints) && analysis.audioHints.length ? `audio_hints: ${analysis.audioHints.join('; ')}` : '',
        analysis.transcription?.provided ? `transcript_cues: ${analysis.transcription.cueCount}` : '',
        '</source_safe_analysis>'
    ].filter(Boolean).join('\n') : '';
    return {
        ...result,
        prompt: `${result.prompt || ''}${analysisContext}`,
        creatorProfile,
        displayText: `AI Clip Finder: ${cleanText(payload.goal || 'find standalone shorts')}`
    };
}

function handleValidateCandidates(_event, payload = {}) {
    const result = handleValidateShortsPlan(_event, payload);
    if (!result.success) return result;
    const config = readConfig();
    const { provider, model } = providerModelFromConfig(config);
    const candidates = result.clips || [];
    const selectedIndexes = selectedIndexesFromPayload(payload, candidates);
    const project = writeProject({
        id: payload.projectId,
        source: payload.clip || {},
        transcriptHash: payload.transcriptHash || buildTranscriptHash(JSON.stringify(payload.cues || [])),
        goal: result.plan?.goal || payload.goal || '',
        targetDurationSeconds: result.plan?.targetDurationSeconds || payload.targetDurationSeconds || null,
        handleSeconds: Number(payload.handleSeconds || 0),
        generatedPlan: result.plan,
        candidates,
        selectedIndexes,
        rejectedIndexes: candidates.map(candidate => Number(candidate.index)).filter(index => !selectedIndexes.includes(index)),
        validationWarnings: result.warnings || [],
        provider,
        model
    });
    return { ...result, project };
}

async function handleCreateTimelines(_event, payload = {}) {
    const project = payload.projectId ? getProject(payload.projectId) : null;
    const candidates = payload.candidates || project?.candidates || [];
    const selectedIndexes = selectedIndexesFromPayload(payload, candidates);
    const rejectedIndexes = candidates.map(candidate => Number(candidate.index)).filter(index => !selectedIndexes.includes(index));
    const result = await handleApplyShortsPlan(_event, {
        clips: candidates,
        selectedIndexes,
        addMarkers: payload.addMarkers !== false,
        includeAudio: payload.includeAudio !== false
    });
    try {
        if (readConfig().resolve?.safetySnapshots !== false) {
            await require('./resolve-diagnostics').createSafetySnapshot({
                action: 'shorts:createTimelines',
                source: project?.source || payload.source || {},
                plan: { selectedIndexes, candidateCount: candidates.length },
                result: { success: result.success, created: result.created, errors: result.errors || [] },
                createdTimelineNames: (result.results || []).filter(item => item.success).map(item => item.timelineName)
            });
        }
    } catch (_err) {
        // Safety snapshots are diagnostic; timeline creation result should remain authoritative.
    }
    if (project) {
        const created = (result.results || [])
            .filter(item => item.success)
            .map(item => ({
                candidateIndex: item.candidate?.index,
                timelineName: item.timelineName,
                clipInfos: item.clipInfos || []
            }));
        writeProject({
            ...project,
            selectedIndexes,
            rejectedIndexes,
            createdTimelines: [...(project.createdTimelines || []), ...created]
        });
    }
    return result;
}

function handlePackageSelected(_event, payload = {}) {
    const project = payload.projectId ? getProject(payload.projectId) : null;
    const candidates = payload.candidates || project?.candidates || [];
    const source = payload.source || project?.source || {};
    const selectedIndexes = selectedIndexesFromPayload(payload, candidates);
    const rejectedIndexes = candidates.map(candidate => Number(candidate.index)).filter(index => !selectedIndexes.includes(index));
    const packages = candidates
        .filter(candidate => selectedIndexes.includes(Number(candidate.index)))
        .map(candidate => buildPackage(candidate, source));
    if (!packages.length) return { success: false, error: 'No Shorts selected to package.', packages: [] };
    if (project) {
        writeProject({
            ...project,
            selectedIndexes,
            rejectedIndexes,
            packages
        });
    }
    return { success: true, packages, packageText: makePackageText(packages) };
}

async function handleTranscribeSource(_event, payload = {}) {
    const config = readConfig();
    const source = await handleGetSource();
    if (source?.state !== 'ready') return { success: false, error: source?.message || 'Select one Media Pool clip before transcribing.' };
    const provider = payload.provider || config.transcription?.provider || 'whisper';
    if (provider === 'resolve') return handleTranscribeSelectedMedia(_event, payload);
    const local = detectLocalTranscribers(config);
    const transcriber = local[provider];
    if (!transcriber?.ready) return { success: false, error: `${provider} transcriber is not installed or configured.` };
    if (provider === 'whisperCpp' && !transcriber.modelReady) return { success: false, error: 'whisper.cpp model path is not configured.' };
    return runWhisperTranscription({ provider, commandPath: transcriber.commandPath, clip: source.clip, config });
}

function markerPayloadForCandidates(candidates = [], selectedIndexes = []) {
    const selected = new Set(selectedIndexes.map(Number));
    return candidates
        .filter(candidate => selected.has(Number(candidate.index)))
        .map(candidate => ({
            candidateIndex: candidate.index,
            title: candidate.title,
            start: candidate.start,
            end: candidate.end,
            startLabel: candidate.startLabel || formatTimestamp(candidate.start || 0),
            endLabel: candidate.endLabel || formatTimestamp(candidate.end || 0),
            durationSeconds: candidate.durationSeconds,
            reason: candidate.reason || candidate.hook || '',
            tags: candidate.tags || [],
            rubricScores: candidate.rubricScores || null
        }));
}

function handleExportMarkers(_event, payload = {}) {
    const project = payload.projectId ? getProject(payload.projectId) : null;
    const candidates = payload.candidates || project?.candidates || [];
    const selectedIndexes = selectedIndexesFromPayload(payload, candidates);
    const markers = markerPayloadForCandidates(candidates, selectedIndexes);
    if (!markers.length) return { success: false, error: 'No selected Shorts candidates to export.', markers: [] };
    ensureDir(EXPORT_DIR);
    const filePath = path.join(EXPORT_DIR, `shorts-markers-${Date.now()}.json`);
    fs.writeFileSync(filePath, JSON.stringify({ source: payload.source || project?.source || {}, markers }, null, 2), 'utf8');
    return { success: true, filePath, markers };
}

function setupShortsStudioHandlers(ipcMain) {
    ipcMain.handle('shorts:getSource', handleGetSource);
    ipcMain.handle('shorts:importTranscript', handleImport);
    ipcMain.handle('shorts:buildCandidates', handleBuildCandidates);
    ipcMain.handle('shorts:validateCandidates', handleValidateCandidates);
    ipcMain.handle('shorts:createTimelines', handleCreateTimelines);
    ipcMain.handle('shorts:packageSelected', handlePackageSelected);
    ipcMain.handle('shorts:detectTranscribers', handleDetectTranscribers);
    ipcMain.handle('shorts:transcribeSource', handleTranscribeSource);
    ipcMain.handle('shorts:saveCandidateFeedback', (_event, payload) => saveCandidateFeedback(payload));
    ipcMain.handle('shorts:getCreatorProfile', () => buildCreatorProfile());
    ipcMain.handle('shorts:exportMarkers', handleExportMarkers);
    ipcMain.handle('shorts:listProjects', () => listProjects());
    ipcMain.handle('shorts:getProject', (_event, id) => getProject(id));
    ipcMain.handle('shorts:deleteProject', (_event, id) => deleteProject(id));
}

module.exports = {
    buildPackage,
    buildCreatorProfile,
    deleteProject,
    detectLocalTranscribers,
    getProject,
    handleBuildCandidates,
    handleDetectTranscribers,
    handleExportMarkers,
    handlePackageSelected,
    handleTranscribeSource,
    handleValidateCandidates,
    listProjects,
    makePackageText,
    makePostText,
    markerPayloadForCandidates,
    saveCandidateFeedback,
    setupShortsStudioHandlers,
    writeProject
};
