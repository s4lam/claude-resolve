const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { CONFIG_DIR } = require('./paths');

const CAPTION_STYLE_PRESETS = {
    clean: {
        label: 'Clean',
        description: 'Readable subtitles with minimal motion.',
        maxLineChars: 34,
        maxLines: 2
    },
    kinetic: {
        label: 'Kinetic',
        description: 'Phrase motion with strong emphasis.',
        maxLineChars: 22,
        maxLines: 2
    },
    karaoke: {
        label: 'Karaoke',
        description: 'Timed word or phrase highlighting.',
        maxLineChars: 24,
        maxLines: 2
    },
    'social shorts': {
        label: 'Social',
        description: 'Large center-safe captions for short-form clips.',
        maxLineChars: 18,
        maxLines: 2
    },
    'podcast clips': {
        label: 'Podcast',
        description: 'Lower-third captions with room for faces.',
        maxLineChars: 26,
        maxLines: 2
    },
    'bold hook': {
        label: 'Bold Hook',
        description: 'Large first-line hook for vertical shorts.',
        maxLineChars: 18,
        maxLines: 2
    },
    documentary: {
        label: 'Documentary',
        description: 'Minimal captions for story edits.',
        maxLineChars: 28,
        maxLines: 2
    }
};

const DEFAULT_REGROUP_OPTIONS = {
    mode: 'punchy',
    maxWords: 6,
    maxChars: 34,
    maxGapSeconds: 0.8
};

const PROJECT_DIR = path.join(CONFIG_DIR, 'caption-projects');
const NATIVE_LUA = path.join(__dirname, '..', 'lua', 'resolve_ai_caption_native.lua');
const NATIVE_TIMEOUT_MS = 120000;

function parseTimecode(value) {
    const text = String(value || '').trim().replace(',', '.');
    const match = text.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/);
    if (!match) return null;
    const hours = Number(match[1] || 0);
    const minutes = Number(match[2] || 0);
    const seconds = Number(match[3] || 0);
    const ms = Number(String(match[4] || '').padEnd(3, '0') || 0);
    if ([hours, minutes, seconds, ms].some(n => !Number.isFinite(n))) return null;
    return hours * 3600 + minutes * 60 + seconds + ms / 1000;
}

function formatTime(seconds) {
    const totalMs = Math.max(0, Math.round(Number(seconds || 0) * 1000));
    const ms = totalMs % 1000;
    const totalSeconds = Math.floor(totalMs / 1000);
    const s = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const m = totalMinutes % 60;
    const h = Math.floor(totalMinutes / 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

function splitWords(text) {
    return String(text || '').trim().split(/\s+/).filter(Boolean);
}

function estimateWordTimings(cue) {
    const words = splitWords(cue.text);
    const duration = Math.max(0.001, Number(cue.end || 0) - Number(cue.start || 0));
    if (!words.length) return [];
    const unit = duration / words.length;
    return words.map((word, index) => ({
        word,
        start: Number((cue.start + unit * index).toFixed(3)),
        end: Number((cue.start + unit * (index + 1)).toFixed(3))
    }));
}

function normalizeCue(cue = {}, index = 0) {
    const start = Number(cue.start);
    const end = Number(cue.end);
    const text = String(cue.text || '').replace(/\s+/g, ' ').trim();
    return {
        id: cue.id || `cue-${index + 1}`,
        index: index + 1,
        start: Number.isFinite(start) ? Number(start.toFixed(3)) : 0,
        end: Number.isFinite(end) ? Number(end.toFixed(3)) : 0,
        text,
        words: Array.isArray(cue.words) && cue.words.length ? cue.words : estimateWordTimings({ start, end, text })
    };
}

function normalizeCues(cues = []) {
    return (Array.isArray(cues) ? cues : [])
        .map(normalizeCue)
        .filter(cue => cue.text && Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end > cue.start)
        .sort((a, b) => a.start - b.start)
        .map((cue, index) => ({ ...cue, id: cue.id || `cue-${index + 1}`, index: index + 1 }));
}

function parseTimestampedTxt(text) {
    const cues = [];
    const lines = String(text || '').split(/\r?\n/);
    const lineRe = /^\s*(?:\[)?(\d{1,2}:\d{2}:\d{2}(?:[,.]\d{1,3})?|\d{1,2}:\d{2}(?:[,.]\d{1,3})?)(?:\])?\s*(?:-->|-|–|—)?\s*(?:(\d{1,2}:\d{2}:\d{2}(?:[,.]\d{1,3})?|\d{1,2}:\d{2}(?:[,.]\d{1,3})?)\s*)?(.*)$/;
    for (const line of lines) {
        const match = line.match(lineRe);
        if (!match) continue;
        const start = parseTimecode(match[1]);
        const maybeEnd = parseTimecode(match[2]);
        const body = String(match[3] || '').trim();
        if (start === null || !body) continue;
        cues.push({ start, end: maybeEnd ?? start + Math.max(1.2, splitWords(body).length * 0.32), text: body });
    }
    return normalizeCues(cues);
}

function parseCaptionText(text, format = 'srt') {
    const raw = String(text || '').replace(/\r/g, '').trim();
    if (!raw) return [];
    const normalizedFormat = String(format || '').toLowerCase();
    if (normalizedFormat === 'txt') return parseTimestampedTxt(raw);

    const body = normalizedFormat === 'vtt'
        ? raw.replace(/^WEBVTT[^\n]*(?:\n+)?/i, '').trim()
        : raw;
    const blocks = body.split(/\n{2,}/);
    const cues = [];
    for (const block of blocks) {
        const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
        const timeIndex = lines.findIndex(line => line.includes('-->'));
        if (timeIndex === -1) continue;
        const [startRaw, endRaw] = lines[timeIndex].split('-->').map(part => part.trim().split(/\s+/)[0]);
        const start = parseTimecode(startRaw);
        const end = parseTimecode(endRaw);
        if (start === null || end === null || end <= start) continue;
        const textLines = lines.slice(timeIndex + 1);
        if (!textLines.length) continue;
        cues.push({ start, end, text: textLines.join(' ') });
    }
    return normalizeCues(cues);
}

function analyzeCaptionCues(cues = []) {
    const normalized = normalizeCues(cues);
    if (!normalized.length) return { cueCount: 0, wordCount: 0, duration: 0, averageWordsPerCue: 0, warnings: [] };
    const firstStart = normalized[0].start;
    const lastEnd = normalized[normalized.length - 1].end;
    const wordCount = normalized.reduce((sum, cue) => sum + splitWords(cue.text).length, 0);
    const longestCue = normalized.reduce((max, cue) => Math.max(max, cue.text.length), 0);
    const warnings = [];
    if (longestCue > 90) warnings.push('Some cues are very long. Regroup before rendering captions.');
    return {
        cueCount: normalized.length,
        wordCount,
        duration: Number(Math.max(0, lastEnd - firstStart).toFixed(2)),
        averageWordsPerCue: Number((wordCount / normalized.length).toFixed(1)),
        longestCue,
        warnings
    };
}

function captionFitRules({ width = 1920, height = 1080, style = 'clean' } = {}) {
    const vertical = Number(height) > Number(width);
    const preset = CAPTION_STYLE_PRESETS[style] || CAPTION_STYLE_PRESETS.clean;
    if (vertical) {
        const tighter = ['social shorts', 'bold hook', 'kinetic', 'karaoke'].includes(style);
        return {
            orientation: 'vertical',
            maxLines: 2,
            maxLineChars: tighter ? 18 : Math.min(24, preset.maxLineChars),
            safeX: '7%-93%',
            safeY: '12%-86%',
            maxWidth: '86%',
            fontSize: tighter ? 'clamp(34px, 5.8vh, 76px)' : 'clamp(28px, 4.5vh, 58px)'
        };
    }
    return {
        orientation: 'landscape',
        maxLines: preset.maxLines || 2,
        maxLineChars: preset.maxLineChars || 34,
        safeX: '6%-94%',
        safeY: '8%-88%',
        maxWidth: '78%',
        fontSize: 'clamp(28px, 4.2vw, 64px)'
    };
}

function wordsToCue(words, fallbackIndex) {
    const first = words[0];
    const last = words[words.length - 1];
    return normalizeCue({
        id: `cue-${fallbackIndex}`,
        start: first.start,
        end: last.end,
        text: words.map(item => item.word).join(' '),
        words
    }, fallbackIndex - 1);
}

function flattenCueWords(cues) {
    const words = [];
    for (const cue of normalizeCues(cues)) {
        const timed = Array.isArray(cue.words) && cue.words.length ? cue.words : estimateWordTimings(cue);
        for (const item of timed) {
            if (!item.word) continue;
            words.push({
                word: item.word,
                start: Number.isFinite(Number(item.start)) ? Number(item.start) : cue.start,
                end: Number.isFinite(Number(item.end)) ? Number(item.end) : cue.end
            });
        }
    }
    return words.sort((a, b) => a.start - b.start);
}

function regroupCues(cues = [], options = {}) {
    const normalized = normalizeCues(cues);
    const mode = options.mode || DEFAULT_REGROUP_OPTIONS.mode;
    if (!normalized.length) return { cues: [], analysis: analyzeCaptionCues([]), warnings: ['No captions to regroup.'] };
    if (mode === 'original') return { cues: normalized, analysis: analyzeCaptionCues(normalized), warnings: [] };

    const words = flattenCueWords(normalized);
    const maxWords = Number(options.maxWords || (mode === 'single' ? 1 : mode === 'sentence' ? 14 : DEFAULT_REGROUP_OPTIONS.maxWords));
    const maxChars = Number(options.maxChars || (mode === 'single' ? 28 : mode === 'sentence' ? 70 : DEFAULT_REGROUP_OPTIONS.maxChars));
    const maxGapSeconds = Number(options.maxGapSeconds ?? DEFAULT_REGROUP_OPTIONS.maxGapSeconds);
    const out = [];
    let phrase = [];

    const flush = () => {
        if (!phrase.length) return;
        out.push(wordsToCue(phrase, out.length + 1));
        phrase = [];
    };

    for (const word of words) {
        const previous = phrase[phrase.length - 1];
        const nextText = [...phrase.map(item => item.word), word.word].join(' ');
        const sentenceEnd = previous && /[.!?]$/.test(previous.word);
        const gapTooLarge = previous && word.start - previous.end > maxGapSeconds;
        const countLimit = phrase.length >= maxWords;
        const charLimit = nextText.length > maxChars;
        const singleLimit = mode === 'single' && phrase.length >= 1;
        const karaokeLimit = mode === 'karaoke' && phrase.length >= Math.min(4, maxWords);
        if (phrase.length && (gapTooLarge || sentenceEnd || countLimit || charLimit || singleLimit || karaokeLimit)) flush();
        phrase.push(word);
    }
    flush();

    const warnings = [];
    if (!out.length) warnings.push('Regrouping produced no captions.');
    return { cues: normalizeCues(out), analysis: analyzeCaptionCues(out), warnings };
}

function validateCaptionFit(cues = [], options = {}) {
    const fit = captionFitRules(options);
    const warnings = [];
    for (const cue of normalizeCues(cues)) {
        const words = splitWords(cue.text);
        const longestWord = words.reduce((max, word) => Math.max(max, word.length), 0);
        if (longestWord > fit.maxLineChars) warnings.push(`Cue ${cue.index} has a long word that may clip in ${fit.orientation} output.`);
        if (cue.text.length > fit.maxLineChars * fit.maxLines + 8) warnings.push(`Cue ${cue.index} is too long for ${fit.orientation} ${fit.maxLines}-line captions.`);
    }
    return { fit, warnings: [...new Set(warnings)] };
}

function buildCaptionPrompt({ cues = [], style = 'clean', width = 1920, height = 1080, fps = 25 } = {}) {
    const normalized = normalizeCues(cues);
    const analysis = analyzeCaptionCues(normalized);
    const fit = captionFitRules({ width, height, style });
    const cueLines = normalized.map((cue, index) => `${index + 1}. ${formatTime(cue.start)} --> ${formatTime(cue.end)} | ${cue.text}`).join('\n');
    const wordLines = ['karaoke', 'kinetic', 'social shorts', 'bold hook'].includes(style)
        ? normalized.flatMap((cue, index) => (cue.words || estimateWordTimings(cue)).map(word => `${index + 1} | ${formatTime(word.start)}-${formatTime(word.end)} | ${word.word}`)).join('\n')
        : '';
    return [
        `Create a transparent caption overlay as complete HTML for ${width}x${height} at ${fps}fps.`,
        `Style: ${style}.`,
        `Caption stats: ${analysis.cueCount} cues, ${analysis.wordCount} words, ${analysis.duration}s span.`,
        `Output orientation: ${fit.orientation}.`,
        `Fit rules: keep captions inside x ${fit.safeX}, y ${fit.safeY}; max-width ${fit.maxWidth}; max ${fit.maxLines} visible lines; about ${fit.maxLineChars} characters per line.`,
        `Use responsive font sizing around ${fit.fontSize}.`,
        'Use a transparent page and body background. Do not add opaque full-frame rectangles.',
        'No horizontal scrolling, no clipped words, no text outside the stage, and no text touching the frame edges.',
        'Use window.renderFrame(frame, fps) and window.getAnimationDuration().',
        '<caption_cues>',
        cueLines,
        '</caption_cues>',
        wordLines ? '\n<caption_words>\n' + wordLines + '\n</caption_words>' : ''
    ].filter(Boolean).join('\n');
}

function ensureProjectDir(dir = PROJECT_DIR) {
    fs.mkdirSync(dir, { recursive: true });
}

function hashCues(cues = []) {
    return crypto.createHash('sha256').update(JSON.stringify(normalizeCues(cues))).digest('hex');
}

function projectPath(id, dir = PROJECT_DIR) {
    return path.join(dir, `${String(id || '').replace(/[^a-z0-9_-]/gi, '_')}.json`);
}

function saveCaptionProject(payload = {}, dir = PROJECT_DIR) {
    ensureProjectDir(dir);
    const now = new Date().toISOString();
    const cues = normalizeCues(payload.cues || []);
    const id = payload.id || `caption-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
    const project = {
        id,
        title: String(payload.title || 'Caption Project').slice(0, 120),
        source: payload.source || {},
        cues,
        analysis: analyzeCaptionCues(cues),
        style: payload.style || 'clean',
        outputMode: payload.outputMode || 'overlay',
        regroupMode: payload.regroupMode || DEFAULT_REGROUP_OPTIONS.mode,
        transcriptHash: hashCues(cues),
        fit: validateCaptionFit(cues, payload.fitOptions || {}).fit,
        warnings: payload.warnings || validateCaptionFit(cues, payload.fitOptions || {}).warnings,
        createdAt: payload.createdAt || now,
        updatedAt: now
    };
    fs.writeFileSync(projectPath(id, dir), JSON.stringify(project, null, 2), 'utf8');
    return project;
}

function listCaptionProjects(dir = PROJECT_DIR) {
    ensureProjectDir(dir);
    return fs.readdirSync(dir)
        .filter(name => name.endsWith('.json'))
        .map(name => {
            try {
                const project = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
                return {
                    id: project.id,
                    title: project.title,
                    cueCount: project.analysis?.cueCount || project.cues?.length || 0,
                    style: project.style,
                    outputMode: project.outputMode,
                    updatedAt: project.updatedAt || project.createdAt
                };
            } catch (_err) {
                return null;
            }
        })
        .filter(Boolean)
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

function getCaptionProject(id, dir = PROJECT_DIR) {
    if (!id) return null;
    const file = projectPath(id, dir);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function deleteCaptionProject(id, dir = PROJECT_DIR) {
    const file = projectPath(id, dir);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return { success: true };
}

function fuscriptCandidates() {
    if (process.platform === 'darwin') {
        return [
            '/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fuscript',
            '/Applications/DaVinci Resolve Studio/DaVinci Resolve.app/Contents/Libraries/Fusion/fuscript',
            '/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/fuscript'
        ];
    }
    return [
        'C:\\Program Files\\Blackmagic Design\\DaVinci Resolve\\fuscript.exe',
        'C:\\Program Files\\Blackmagic Design\\DaVinci Resolve\\Fusion\\fuscript.exe'
    ];
}

function findFuscript() {
    return fuscriptCandidates().find(candidate => fs.existsSync(candidate)) || '';
}

function detectNativeText(options = {}) {
    const fuscriptPath = options.fuscriptPath || findFuscript();
    const fuscriptAvailable = Boolean(fuscriptPath && fs.existsSync(fuscriptPath));
    const luaAvailable = fs.existsSync(NATIVE_LUA);
    const templateName = options.templateName || options.nativeTemplateName || 'Resolve AI Caption';
    const ready = Boolean(fuscriptAvailable && luaAvailable && templateName);
    return {
        success: true,
        ready,
        status: ready ? 'ready' : 'unavailable',
        fuscriptPath,
        fuscriptAvailable,
        luaAvailable,
        templateName,
        reason: ready ? '' : 'Native Text+ needs DaVinci Resolve fuscript and a Media Pool caption template named Resolve AI Caption.'
    };
}

function luaQuote(value) {
    return JSON.stringify(String(value ?? '')).replace(/\u2028|\u2029/g, '');
}

function toLuaValue(value) {
    if (Array.isArray(value)) return `{${value.map(toLuaValue).join(',')}}`;
    if (value && typeof value === 'object') {
        return `{${Object.entries(value).map(([key, val]) => `[${luaQuote(key)}]=${toLuaValue(val)}`).join(',')}}`;
    }
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '0';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (value === null || value === undefined) return 'nil';
    return luaQuote(value);
}

function buildNativeTextPayload({ cues = [], templateName = 'Resolve AI Caption', trackName = 'Resolve AI Captions', fps = 25, preview = false } = {}) {
    const normalized = normalizeCues(cues).slice(0, preview ? 1 : 500).map(cue => ({
        start: cue.start,
        end: cue.end,
        text: cue.text
    }));
    return {
        templateName: String(templateName || 'Resolve AI Caption').slice(0, 120),
        trackName: String(trackName || 'Resolve AI Captions').slice(0, 120),
        fps: Number(fps) || 25,
        preview: Boolean(preview),
        cues: normalized
    };
}

function runNativeTextJob(payload, options = {}) {
    const detection = detectNativeText(options);
    if (!detection.ready) return Promise.resolve({ success: false, ...detection });
    const job = buildNativeTextPayload(payload);
    if (!job.cues.length) return Promise.resolve({ success: false, error: 'No captions to create.' });
    const tempDir = path.join(os.tmpdir(), 'resolve-ai-captions');
    fs.mkdirSync(tempDir, { recursive: true });
    const wrapper = path.join(tempDir, `caption-${Date.now()}.lua`);
    fs.writeFileSync(wrapper, `CAPTION_JOB=${toLuaValue(job)}\ndofile(${luaQuote(NATIVE_LUA)})\n`, 'utf8');
    return new Promise((resolve) => {
        const child = spawn(detection.fuscriptPath, ['-l', wrapper], { windowsHide: true });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
            child.kill();
            resolve({ success: false, error: 'Native Text+ timed out.', stdout, stderr });
        }, NATIVE_TIMEOUT_MS);
        child.stdout.on('data', chunk => { stdout += chunk.toString(); });
        child.stderr.on('data', chunk => { stderr += chunk.toString(); });
        child.on('close', code => {
            clearTimeout(timer);
            try { fs.unlinkSync(wrapper); } catch (_err) { /* ignore temp cleanup */ }
            resolve({ success: code === 0, code, stdout, stderr, payload: job });
        });
        child.on('error', err => {
            clearTimeout(timer);
            resolve({ success: false, error: err.message, payload: job });
        });
    });
}

async function handleImportCaptions(_event, payload = {}) {
    let filePath = payload.path;
    if (!filePath) {
        const { dialog } = require('electron');
        const result = await dialog.showOpenDialog({
            title: 'Import captions',
            properties: ['openFile'],
            filters: [{ name: 'Captions', extensions: ['srt', 'vtt', 'txt'] }]
        });
        if (result.canceled || !result.filePaths[0]) return { success: true, cues: [], prompt: '' };
        filePath = result.filePaths[0];
    }

    const text = fs.readFileSync(filePath, 'utf8');
    const ext = path.extname(filePath).toLowerCase();
    const format = ext === '.vtt' ? 'vtt' : ext === '.txt' ? 'txt' : 'srt';
    const cues = parseCaptionText(text, format);
    return { success: true, filePath, format, cues, analysis: analyzeCaptionCues(cues) };
}

function handleParseCaptions(_event, payload = {}) {
    const text = payload.text || '';
    const format = payload.format || (String(text).trim().toUpperCase().startsWith('WEBVTT') ? 'vtt' : String(text).includes('-->') ? 'srt' : 'txt');
    const cues = parseCaptionText(text, format);
    return { success: true, format, cues, analysis: analyzeCaptionCues(cues) };
}

function handleGenerateCaptions(_event, payload = {}) {
    const cues = normalizeCues(payload.cues || []);
    return {
        success: true,
        prompt: buildCaptionPrompt({ ...payload, cues }),
        analysis: analyzeCaptionCues(cues),
        fit: validateCaptionFit(cues, payload).fit,
        warnings: validateCaptionFit(cues, payload).warnings
    };
}

function setupCaptionHandlers(ipcMain) {
    ipcMain.handle('captions:import', handleImportCaptions);
    ipcMain.handle('captions:parse', handleParseCaptions);
    ipcMain.handle('captions:generate', handleGenerateCaptions);
    ipcMain.handle('captions:regroup', (_event, payload = {}) => regroupCues(payload.cues || [], payload.options || payload));
    ipcMain.handle('captions:listProjects', () => listCaptionProjects());
    ipcMain.handle('captions:getProject', (_event, id) => getCaptionProject(id));
    ipcMain.handle('captions:saveProject', (_event, payload = {}) => saveCaptionProject(payload));
    ipcMain.handle('captions:deleteProject', (_event, id) => deleteCaptionProject(id));
    ipcMain.handle('captions:detectNativeText', (_event, payload = {}) => detectNativeText(payload));
    ipcMain.handle('captions:importNativeTemplate', () => ({ success: false, error: 'Import a Resolve Text+ caption template into the Media Pool and name it Resolve AI Caption.' }));
    ipcMain.handle('captions:previewNativeText', (_event, payload = {}) => runNativeTextJob({ ...payload, preview: true }, payload));
    ipcMain.handle('captions:createNativeText', (_event, payload = {}) => runNativeTextJob(payload, payload));
    ipcMain.handle('captions:clearNativePreview', () => ({ success: true }));
}

module.exports = {
    CAPTION_STYLE_PRESETS,
    analyzeCaptionCues,
    buildCaptionPrompt,
    buildNativeTextPayload,
    captionFitRules,
    deleteCaptionProject,
    detectNativeText,
    estimateWordTimings,
    formatTime,
    getCaptionProject,
    hashCues,
    listCaptionProjects,
    normalizeCues,
    parseCaptionText,
    parseTimecode,
    regroupCues,
    saveCaptionProject,
    setupCaptionHandlers,
    splitWords,
    validateCaptionFit
};
