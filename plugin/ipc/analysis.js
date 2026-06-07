const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { CONFIG_DIR } = require('./paths');
const { readConfig } = require('./config');
const { resolveFfmpegPath } = require('./render-health');
const { getCurrentProject } = require('./resolve');

const ANALYSIS_DIR = path.join(CONFIG_DIR, 'analysis-reports');

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function reportPath(id, dir = ANALYSIS_DIR) {
    return path.join(dir, `${String(id || '').replace(/[^a-z0-9_-]/gi, '_')}.json`);
}

function hashText(text) {
    return crypto.createHash('sha256').update(String(text || '')).digest('hex');
}

function sanitizePathForReport(filePath) {
    return {
        fileName: filePath ? path.basename(filePath) : '',
        extension: filePath ? path.extname(filePath).toLowerCase() : ''
    };
}

function findFfprobe(ffmpegPath = '', options = {}) {
    if (options.ffprobePath && fs.existsSync(options.ffprobePath)) return options.ffprobePath;
    const candidates = [];
    if (ffmpegPath) {
        const dir = path.dirname(ffmpegPath);
        candidates.push(path.join(dir, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'));
    }
    if (process.platform === 'darwin') {
        candidates.push('/opt/homebrew/bin/ffprobe', '/usr/local/bin/ffprobe', 'ffprobe');
    } else if (process.platform === 'win32') {
        candidates.push('ffprobe.exe', 'ffprobe');
    } else {
        candidates.push('ffprobe');
    }
    return candidates.find(candidate => {
        if (!candidate) return false;
        if (candidate.includes(path.sep) && !fs.existsSync(candidate)) return false;
        try {
            (options.execFileSync || execFileSync)(candidate, ['-version'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 });
            return true;
        } catch (_err) {
            return false;
        }
    }) || '';
}

function parseFfprobeJson(raw = '') {
    try {
        const data = JSON.parse(raw);
        const streams = Array.isArray(data.streams) ? data.streams : [];
        const video = streams.find(stream => stream.codec_type === 'video') || {};
        const audio = streams.find(stream => stream.codec_type === 'audio') || {};
        const duration = Number(data.format?.duration || video.duration || audio.duration || 0) || null;
        const fpsText = video.avg_frame_rate || video.r_frame_rate || '';
        const fpsParts = String(fpsText).split('/').map(Number);
        const fps = fpsParts.length === 2 && fpsParts[1] ? fpsParts[0] / fpsParts[1] : Number(fpsText) || null;
        return {
            durationSeconds: duration,
            format: data.format?.format_name || '',
            bitrate: Number(data.format?.bit_rate || 0) || null,
            video: {
                codec: video.codec_name || '',
                profile: video.profile || '',
                width: Number(video.width || 0) || null,
                height: Number(video.height || 0) || null,
                fps: fps ? Number(fps.toFixed(3)) : null,
                pixFmt: video.pix_fmt || '',
                colorSpace: video.color_space || '',
                colorTransfer: video.color_transfer || '',
                colorPrimaries: video.color_primaries || ''
            },
            audio: {
                codec: audio.codec_name || '',
                sampleRate: Number(audio.sample_rate || 0) || null,
                channels: Number(audio.channels || 0) || null,
                layout: audio.channel_layout || ''
            }
        };
    } catch (_err) {
        return null;
    }
}

function probeMediaFile(filePath, options = {}) {
    if (!filePath || !fs.existsSync(filePath)) {
        return { success: false, error: 'Media file path is missing or unavailable.' };
    }
    const cfg = options.config || readConfig();
    const ffmpeg = options.ffmpegPath || resolveFfmpegPath(cfg, options).path || '';
    const ffprobe = findFfprobe(ffmpeg, options);
    const exec = options.execFileSync || execFileSync;
    if (!ffprobe) {
        return {
            success: false,
            error: 'ffprobe was not found. Analysis remains source-safe, but technical metadata is unavailable.',
            ffmpegPath: ffmpeg || ''
        };
    }
    try {
        const raw = exec(ffprobe, [
            '-v', 'error',
            '-show_format',
            '-show_streams',
            '-of', 'json',
            filePath
        ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: options.timeout || 15000 });
        return { success: true, ffprobePath: ffprobe, ffmpegPath: ffmpeg || '', technical: parseFfprobeJson(raw) };
    } catch (error) {
        return { success: false, error: error.message || String(error), ffprobePath: ffprobe, ffmpegPath: ffmpeg || '' };
    }
}

function buildAudioHints(technical = {}, transcript = null) {
    const hints = [];
    if (!technical.audio?.codec) hints.push('No audio stream detected by ffprobe.');
    if (technical.audio?.channels === 1) hints.push('Mono audio detected.');
    if (technical.durationSeconds && transcript?.cues?.length) {
        const cueSpan = Math.max(0, (transcript.cues.at(-1)?.end || 0) - (transcript.cues[0]?.start || 0));
        if (cueSpan && cueSpan < technical.durationSeconds * 0.5) hints.push('Transcript covers less than half of the source duration.');
    }
    return hints;
}

function markerSuggestionsFromCandidates(candidates = []) {
    return (Array.isArray(candidates) ? candidates : []).slice(0, 50).map((candidate, index) => ({
        frame: Math.max(0, Math.round(Number(candidate.start || 0) * Number(candidate.fps || 30))),
        color: candidate.status === 'ready' ? 'Green' : 'Yellow',
        name: candidate.title || `Short candidate ${index + 1}`,
        note: candidate.hook || candidate.reason || candidate.publish?.captionHook || '',
        tags: candidate.tags || []
    }));
}

async function selectedClipFallback() {
    try {
        const project = await getCurrentProject();
        const mediaPool = project && await project.GetMediaPool();
        const selected = mediaPool?.GetSelectedClips ? await mediaPool.GetSelectedClips() : [];
        const list = Array.isArray(selected) ? selected : Object.values(selected || {});
        const clip = list[0];
        if (!clip?.GetClipProperty) return null;
        const props = await clip.GetClipProperty();
        return {
            name: props['Clip Name'] || props['File Name'] || 'Selected clip',
            filePath: props['File Path'] || props.FilePath || props.Path || '',
            fps: Number(props.FPS || props['Frame Rate'] || 0) || null,
            durationSeconds: null
        };
    } catch (_err) {
        return null;
    }
}

function saveAnalysisReport(report, dir = ANALYSIS_DIR) {
    ensureDir(dir);
    fs.writeFileSync(reportPath(report.id, dir), JSON.stringify(report, null, 2), 'utf8');
    return report;
}

function listAnalysisReports(dir = ANALYSIS_DIR) {
    ensureDir(dir);
    return fs.readdirSync(dir)
        .filter(name => name.endsWith('.json'))
        .map(name => {
            try {
                const report = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
                return {
                    id: report.id,
                    clipName: report.clipName,
                    createdAt: report.createdAt,
                    fileName: report.file?.fileName || '',
                    durationSeconds: report.technical?.durationSeconds || null,
                    success: report.success
                };
            } catch (_err) {
                return null;
            }
        })
        .filter(Boolean)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function getAnalysisReport(id, dir = ANALYSIS_DIR) {
    const file = reportPath(id, dir);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function deleteAnalysisReport(id, dir = ANALYSIS_DIR) {
    const file = reportPath(id, dir);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return { success: true };
}

async function buildAnalysisReport(payload = {}, options = {}) {
    const cfg = options.config || readConfig();
    const clip = payload.clip || await selectedClipFallback() || {};
    const filePath = payload.filePath || clip.filePath || clip.path || '';
    const probe = probeMediaFile(filePath, { ...options, config: cfg });
    const transcript = payload.transcript || null;
    const technical = probe.technical || {};
    const id = payload.id || `analysis-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
    const report = {
        id,
        success: probe.success,
        createdAt: new Date().toISOString(),
        clipId: clip.id || clip.mediaId || hashText(`${clip.name || ''}:${filePath}`).slice(0, 16),
        clipName: clip.name || clip.fileName || path.basename(filePath || '') || 'Selected clip',
        file: sanitizePathForReport(filePath),
        sourceSafety: {
            sourceFileModified: false,
            writes: ['Resolve AI sidecar analysis JSON only'],
            note: 'Analysis reads source media and stores a local sidecar report. It does not modify, transcode, proxy, or relink source files.'
        },
        technical,
        audioHints: cfg.analysis?.includeAudioHints === false ? [] : buildAudioHints(technical, transcript),
        transcription: {
            provided: Boolean(transcript?.cues?.length),
            cueCount: transcript?.cues?.length || 0,
            localProvider: cfg.transcription?.provider || 'none',
            enabled: cfg.analysis?.includeTranscription !== false
        },
        markerSuggestions: markerSuggestionsFromCandidates(payload.candidates || []),
        errors: probe.success ? [] : [probe.error],
        toolPaths: {
            ffprobe: probe.ffprobePath || '',
            ffmpeg: probe.ffmpegPath || ''
        }
    };
    return saveAnalysisReport(report, options.dir || ANALYSIS_DIR);
}

function setupAnalysisHandlers(ipcMain) {
    ipcMain.handle('analysis:probeMedia', (_event, payload = {}) => buildAnalysisReport(payload));
    ipcMain.handle('analysis:listReports', () => listAnalysisReports());
    ipcMain.handle('analysis:getReport', (_event, id) => getAnalysisReport(id));
    ipcMain.handle('analysis:deleteReport', (_event, id) => deleteAnalysisReport(id));
}

module.exports = {
    buildAnalysisReport,
    buildAudioHints,
    deleteAnalysisReport,
    findFfprobe,
    getAnalysisReport,
    listAnalysisReports,
    markerSuggestionsFromCandidates,
    parseFfprobeJson,
    probeMediaFile,
    saveAnalysisReport,
    setupAnalysisHandlers
};
