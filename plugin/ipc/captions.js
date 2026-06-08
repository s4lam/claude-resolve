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
const NATIVE_TEMPLATE_DIR = path.join(CONFIG_DIR, 'native-text');
const NATIVE_TEMPLATE_DRB = path.join(NATIVE_TEMPLATE_DIR, 'Resolve AI Caption.drb');
const NATIVE_LUA = path.join(__dirname, '..', 'lua', 'resolve_ai_caption_native.lua');
const NATIVE_TIMEOUT_MS = 120000;
const NATIVE_BRIDGE_VERSION = 'native-text-template-append-v1';
const NATIVE_TEMPLATE_SETUP_REASON = 'Create or import a Text+ template in the Media Pool named Resolve AI Caption. Resolve AI will preserve that template style and append one timed Text+ clip per cue.';
const NATIVE_PROCESS_STARTED_AT = new Date().toISOString();
const NATIVE_PROCESS_IPC_MTIME_MS = (() => {
    try { return fs.statSync(__filename).mtimeMs; } catch (_err) { return 0; }
})();
const NATIVE_PROCESS_LUA_MTIME_MS = (() => {
    try { return fs.statSync(NATIVE_LUA).mtimeMs; } catch (_err) { return 0; }
})();

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

function decodeCaptionEntities(text = '') {
    const entities = {
        amp: '&',
        lt: '<',
        gt: '>',
        quot: '"',
        apos: "'",
        nbsp: ' '
    };
    return String(text || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
        const key = String(entity || '').toLowerCase();
        if (key[0] === '#') {
            const code = key[1] === 'x' ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
            return Number.isFinite(code) ? String.fromCodePoint(code) : match;
        }
        return entities[key] || match;
    });
}

function cleanCaptionText(text = '') {
    return decodeCaptionEntities(String(text || '')
        .replace(/<\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3}>/g, '')
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<\/?(?:b|i|u|font|c|v|ruby|rt|lang|span)[^>]*>/gi, ' '))
        .replace(/\s+/g, ' ')
        .trim();
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
    const text = cleanCaptionText(cue.text);
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

function jsonForScript(value) {
    return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, '');
}

function selectedClipForCaptions(timelineContext = {}) {
    const selected = Array.isArray(timelineContext.selectedClips) ? timelineContext.selectedClips : [];
    return selected.find(clip => Number.isFinite(Number(clip?.startFrame))) || null;
}

function captionPlacementPlan(cues = [], { fps = 25, timelineContext = {} } = {}) {
    const normalized = normalizeCues(cues);
    const renderFps = Number(fps) || 25;
    const timelineFps = Number(timelineContext.fps) || renderFps;
    if (!normalized.length) {
        return {
            success: false,
            error: 'No timestamped cues found. Import SRT/VTT or paste timestamped captions first.',
            warnings: []
        };
    }
    const firstStart = normalized[0].start;
    const lastEnd = normalized[normalized.length - 1].end;
    const duration = Number(Math.max(0.001, lastEnd - firstStart).toFixed(3));
    const totalFrames = Math.max(1, Math.ceil(duration * renderFps - 1e-6));
    const selectedClip = selectedClipForCaptions(timelineContext);
    const playheadFrame = Number(timelineContext.playheadFrame);
    const baseFrame = selectedClip ? Number(selectedClip.startFrame) : (Number.isFinite(playheadFrame) ? playheadFrame : 0);
    const placementRecordFrame = Math.round(baseFrame + firstStart * timelineFps);
    const warnings = [];
    if (!selectedClip) warnings.push('No selected clip found. Captions will be placed relative to the current playhead.');
    if (selectedClip?.durationFrames) {
        const clipDurationSeconds = Number(selectedClip.durationFrames) / timelineFps;
        if (Number.isFinite(clipDurationSeconds) && lastEnd > clipDurationSeconds + 0.001) {
            warnings.push(`Captions extend past selected clip duration by ${(lastEnd - clipDurationSeconds).toFixed(1)}s.`);
        }
    }
    return {
        success: true,
        cues: normalized,
        firstStart,
        lastEnd,
        duration,
        totalFrames,
        placementRecordFrame,
        placementReference: selectedClip ? 'selectedClip' : 'playhead',
        placementFps: timelineFps,
        baseFrame,
        selectedClip,
        warnings
    };
}

function buildCaptionOverlayHtml({ cues = [], style = 'clean', width = 1920, height = 1080, fps = 25 } = {}) {
    const normalized = normalizeCues(cues);
    const fit = captionFitRules({ width, height, style });
    const plan = captionPlacementPlan(normalized, { fps });
    if (!plan.success) return '';
    const preset = CAPTION_STYLE_PRESETS[style] || CAPTION_STYLE_PRESETS.clean;
    const vertical = fit.orientation === 'vertical';
    const alignBottom = style === 'podcast clips' || style === 'documentary';
    const stageClass = [
        'stage',
        vertical ? 'vertical' : 'landscape',
        alignBottom ? 'lower' : 'center',
        ['kinetic', 'karaoke', 'social shorts', 'bold hook'].includes(style) ? 'strong' : 'quiet'
    ].join(' ');
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${Number(width) || 1920}, height=${Number(height) || 1080}">
<style>
html, body {
  margin: 0;
  width: ${Number(width) || 1920}px;
  height: ${Number(height) || 1080}px;
  overflow: hidden;
  background: transparent;
  font-family: "Bricolage Grotesque", "Inter", "Segoe UI", Arial, sans-serif;
  letter-spacing: 0;
}
body { color: white; }
.stage {
  position: relative;
  width: 100vw;
  height: 100vh;
  display: flex;
  justify-content: center;
  box-sizing: border-box;
  padding: ${vertical ? '12vh 7vw 14vh' : '8vh 6vw 10vh'};
  pointer-events: none;
}
.stage.center { align-items: center; }
.stage.lower { align-items: flex-end; padding-bottom: ${vertical ? '15vh' : '11vh'}; }
.caption {
  max-width: ${fit.maxWidth};
  font-size: ${fit.fontSize};
  line-height: 1.05;
  text-align: center;
  font-weight: ${style === 'documentary' ? 620 : 760};
  text-wrap: balance;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  opacity: 0;
  transform: translateY(10px) scale(0.985);
  transition: opacity 120ms cubic-bezier(.2,.8,.2,1), transform 120ms cubic-bezier(.2,.8,.2,1);
  text-shadow: 0 2px 12px rgba(0, 0, 0, .75), 0 1px 2px rgba(0, 0, 0, .9);
}
.caption::after {
  content: "";
  position: absolute;
  inset: -0.22em -0.42em;
  border-radius: 8px;
  background: rgba(0, 0, 0, ${style === 'clean' || style === 'documentary' ? '.34' : '.42'});
  z-index: -1;
}
.caption {
  position: relative;
}
.caption.active {
  opacity: 1;
  transform: translateY(0) scale(1);
}
.strong .caption {
  font-weight: 840;
  text-transform: ${style === 'bold hook' ? 'uppercase' : 'none'};
}
.quiet .caption {
  max-width: ${style === 'documentary' ? '70%' : fit.maxWidth};
}
</style>
</head>
<body>
<div class="${stageClass}">
  <div id="caption" class="caption"></div>
</div>
<script>
const cues = ${jsonForScript(normalized)};
const FIRST_CUE_START = ${plan.firstStart};
const DURATION = ${plan.duration};
const MAX_LINES = ${Number(fit.maxLines) || 2};
const caption = document.getElementById('caption');
function cueAt(time) {
  return cues.find(cue => time >= cue.start && time < cue.end) || null;
}
function applyCue(cue) {
  if (!cue) {
    caption.textContent = '';
    caption.classList.remove('active');
    return;
  }
  caption.textContent = cue.text;
  caption.classList.add('active');
}
window.getAnimationDuration = () => DURATION;
window.renderFrame = (frame, fpsValue) => {
  const safeFps = Number(fpsValue) || ${Number(fps) || 25};
  const time = FIRST_CUE_START + frame / safeFps;
  applyCue(cueAt(time));
};
window.renderFrame(0, ${Number(fps) || 25});
</script>
</body>
</html>`;
}

function buildCaptionOverlayRender({ cues = [], style = 'clean', width = 1920, height = 1080, fps = 25, timelineContext = {} } = {}) {
    const normalized = normalizeCues(cues);
    const fitResult = validateCaptionFit(normalized, { width, height, style });
    const plan = captionPlacementPlan(normalized, { fps, timelineContext });
    if (!plan.success) return plan;
    const html = buildCaptionOverlayHtml({ cues: normalized, style, width, height, fps });
    const metadata = {
        type: 'caption-overlay',
        title: 'Caption Overlay',
        style,
        cueCount: normalized.length,
        cueStart: plan.firstStart,
        cueEnd: plan.lastEnd,
        duration: plan.duration,
        totalFrames: plan.totalFrames,
        fps: Number(fps) || 25,
        width: Number(width) || 1920,
        height: Number(height) || 1080,
        placementRecordFrame: plan.placementRecordFrame,
        placementReference: plan.placementReference,
        placementFps: plan.placementFps,
        selectedClip: plan.selectedClip ? {
            name: plan.selectedClip.name || null,
            startFrame: plan.selectedClip.startFrame,
            durationFrames: plan.selectedClip.durationFrames || null
        } : null,
        transcriptHash: hashCues(normalized)
    };
    return {
        success: true,
        html,
        metadata,
        analysis: analyzeCaptionCues(normalized),
        fit: fitResult.fit,
        warnings: [...new Set([...fitResult.warnings, ...plan.warnings])]
    };
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
        rawText: String(payload.rawText || payload.text || '').slice(0, 500000),
        format: inferCaptionFormat(payload.rawText || payload.text || '', payload.format),
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

function fileBridgeInfo(filePath, loadedMtimeMs = 0) {
    try {
        const stat = fs.statSync(filePath);
        return {
            path: filePath,
            exists: true,
            mtime: stat.mtime.toISOString(),
            mtimeMs: stat.mtimeMs,
            changedSinceProcessStart: Boolean(loadedMtimeMs && stat.mtimeMs > loadedMtimeMs + 1000)
        };
    } catch (_err) {
        return {
            path: filePath,
            exists: false,
            mtime: '',
            mtimeMs: 0,
            changedSinceProcessStart: false
        };
    }
}

function ensureNativeTemplateAsset() {
    fs.mkdirSync(NATIVE_TEMPLATE_DIR, { recursive: true });
    return NATIVE_TEMPLATE_DRB;
}

function detectNativeText(options = {}) {
    const fuscriptPath = options.fuscriptPath || findFuscript();
    const fuscriptAvailable = Boolean(fuscriptPath && fs.existsSync(fuscriptPath));
    const luaAvailable = fs.existsSync(NATIVE_LUA);
    const templateName = options.templateName || options.nativeTemplateName || 'Resolve AI Caption';
    let templateDrbPath = options.templateDrbPath || '';
    try { templateDrbPath = templateDrbPath || ensureNativeTemplateAsset(); } catch (_err) { templateDrbPath = NATIVE_TEMPLATE_DRB; }
    const templateDrbAvailable = Boolean(templateDrbPath && fs.existsSync(templateDrbPath));
    const bridgeReady = Boolean(fuscriptAvailable && luaAvailable && templateName);
    const ipcFile = fileBridgeInfo(__filename, NATIVE_PROCESS_IPC_MTIME_MS);
    const luaFile = fileBridgeInfo(NATIVE_LUA, NATIVE_PROCESS_LUA_MTIME_MS);
    const restartRequired = Boolean(ipcFile.changedSinceProcessStart || luaFile.changedSinceProcessStart);
    return {
        success: true,
        ready: Boolean(bridgeReady && !restartRequired),
        bridgeReady,
        status: bridgeReady ? 'template-append-ready' : 'missing-dependency',
        bridgeVersion: NATIVE_BRIDGE_VERSION,
        processStartedAt: NATIVE_PROCESS_STARTED_AT,
        inlineCueSupport: true,
        appendToTimeline: true,
        directCreationDisabled: false,
        durationUnsupported: false,
        ipcFile,
        luaFile,
        restartRequired,
        templateDrbPath,
        templateDrbAvailable,
        templateAssetPath: templateDrbPath,
        templateAssetAvailable: templateDrbAvailable,
        fuscriptPath,
        fuscriptAvailable,
        luaAvailable,
        templateName,
        reason: restartRequired
            ? 'Restart DaVinci Resolve to load the updated Native Text+ bridge.'
            : (bridgeReady ? NATIVE_TEMPLATE_SETUP_REASON : 'Native Text+ needs DaVinci Resolve fuscript and the Resolve AI Lua bridge.')
    };
}

function luaQuote(value) {
    return JSON.stringify(String(value ?? '')).replace(/\u2028|\u2029/g, '');
}

function luaLongString(value = '') {
    const text = String(value ?? '');
    let marker = '=';
    while (text.includes(`]${marker}]`)) marker += '=';
    return `[${marker}[${text}]${marker}]`;
}

function luaNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? String(number) : String(fallback);
}

function luaBoolean(value) {
    return value ? 'true' : 'false';
}

function luaCueArray(job = {}) {
    const cues = normalizeCues(job.cues || []);
    return `{${cues.map(cue => [
        '{',
        `start=${luaNumber(cue.start, 0)},`,
        `["end"]=${luaNumber(cue.end, Math.max(1, Number(cue.start || 0) + 1))},`,
        `text=${luaLongString(nativeCueText(cue.text))}`,
        '}'
    ].join('')).join(',')}}`;
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

function nativeCueText(value = '') {
    return String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function nativeCueRows(job = {}) {
    return normalizeCues(job.cues || []).map(cue => [
        Number(cue.start) || 0,
        Number(cue.end) || Math.max(1, (Number(cue.start) || 0) + 1),
        nativeCueText(cue.text)
    ].join('\t')).join('\n');
}

function writeNativeCueFile(job = {}, tempDir = os.tmpdir()) {
    const cueFile = path.join(tempDir, `caption-cues-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.tsv`);
    fs.writeFileSync(cueFile, `${nativeCueRows(job)}\n`, 'utf8');
    return cueFile;
}

function buildNativeLuaJob(job = {}, cueFile = '') {
    const cues = normalizeCues(job.cues || []);
    return { ...job, bridgeVersion: NATIVE_BRIDGE_VERSION, cues, cueCount: cues.length, cueFile };
}

function nativeDebugPayload(job = {}, wrapper = '', cueFile = '') {
    const firstCue = Array.isArray(job.cues) && job.cues.length ? job.cues[0] : null;
    return {
        bridgeVersion: NATIVE_BRIDGE_VERSION,
        ipcPath: __filename,
        luaPath: NATIVE_LUA,
        wrapperPath: wrapper,
        cueFile,
        cueCount: Number(job.cueCount || job.cues?.length || 0) || 0,
        rawTextLength: Number(job.rawTextLength || 0) || 0,
        templateName: job.templateName || 'Resolve AI Caption',
        templateDrbPath: job.templateDrbPath || '',
        recordFrame: Number.isFinite(Number(job.recordFrame)) ? Number(job.recordFrame) : null,
        fps: job.fps,
        preview: Boolean(job.preview),
        firstCue: firstCue ? {
            start: firstCue.start,
            end: firstCue.end,
            textPreview: nativeCueText(firstCue.text).slice(0, 120)
        } : null,
        writtenAt: new Date().toISOString()
    };
}

function buildNativeWrapperSource(job = {}, cueFile = '', debugPath = '') {
    const rows = nativeCueRows(job);
    const nativeSource = fs.readFileSync(NATIVE_LUA, 'utf8');
    return [
        `CAPTION_CUE_FILE=${luaLongString(cueFile)}`,
        `CAPTION_CUE_ROWS=${luaLongString(rows)}`,
        `CAPTION_NATIVE_CUES=${luaCueArray(job)}`,
        `CAPTION_DEBUG_PATH=${luaLongString(debugPath)}`,
        'CAPTION_JOB={',
        `bridgeVersion=${luaLongString(job.bridgeVersion || NATIVE_BRIDGE_VERSION)},`,
        `templateName=${luaLongString(job.templateName || 'Resolve AI Caption')},`,
        `templateAssetPath=${luaLongString(job.templateAssetPath || '')},`,
        `templateDrbPath=${luaLongString(job.templateDrbPath || '')},`,
        `trackName=${luaLongString(job.trackName || 'Resolve AI Captions')},`,
        `fps=${luaNumber(job.fps, 25)},`,
        `recordFrame=${luaNumber(job.recordFrame, 0)},`,
        `preview=${luaBoolean(job.preview)},`,
        `setupOnly=${luaBoolean(job.setupOnly)},`,
        `cueCount=${luaNumber(job.cueCount || job.cues?.length || 0)},`,
        `rawTextLength=${luaNumber(job.rawTextLength, 0)},`,
        'cues=CAPTION_NATIVE_CUES,',
        'cueFile=CAPTION_CUE_FILE',
        '}',
        '-- Resolve AI Native Text+ bridge follows. Keep data and bridge in one file for fuscript.',
        nativeSource,
        ''
    ].join('\n');
}

function inferCaptionFormat(text = '', format = '') {
    if (format) return String(format).toLowerCase();
    const raw = String(text || '').trim();
    if (/^WEBVTT\b/i.test(raw)) return 'vtt';
    if (raw.includes('-->')) return 'srt';
    return 'txt';
}

function prepareNativeTextJob({ cues = [], rawText = '', text = '', format = '', templateName = 'Resolve AI Caption', trackName = 'Resolve AI Captions', fps = 25, preview = false, templateAssetPath = '', templateDrbPath = '', recordFrame = 0, setupOnly = false } = {}) {
    let preparedCues = normalizeCues(cues);
    const sourceText = String(rawText || text || '');
    const sourceFormat = inferCaptionFormat(sourceText, format);
    if (!preparedCues.length && sourceText.trim()) {
        preparedCues = parseCaptionText(sourceText, sourceFormat);
    }
    if (setupOnly) {
        return {
            success: true,
            cueCount: 0,
            payload: buildNativeTextPayload({ cues: [], templateName, trackName, fps, preview, rawTextLength: sourceText.length, templateAssetPath, templateDrbPath, recordFrame, setupOnly: true })
        };
    }
    if (!preparedCues.length) {
        return {
            success: false,
            cueCount: 0,
            error: 'No timestamped cues found. Import SRT/VTT or paste timestamped captions first.'
        };
    }
    return {
        success: true,
        cueCount: preparedCues.length,
        payload: buildNativeTextPayload({ cues: preparedCues, templateName, trackName, fps, preview, rawTextLength: sourceText.length, templateAssetPath, templateDrbPath, recordFrame, setupOnly })
    };
}

function buildNativeTextPayload({ cues = [], templateName = 'Resolve AI Caption', trackName = 'Resolve AI Captions', fps = 25, preview = false, rawTextLength = 0, templateAssetPath = '', templateDrbPath = '', recordFrame = 0, setupOnly = false } = {}) {
    const normalized = normalizeCues(cues).slice(0, preview ? 1 : 500).map(cue => ({
        start: cue.start,
        end: cue.end,
        text: cue.text
    }));
    return {
        bridgeVersion: NATIVE_BRIDGE_VERSION,
        templateName: String(templateName || 'Resolve AI Caption').slice(0, 120),
        templateAssetPath: String(templateAssetPath || '').slice(0, 500),
        templateDrbPath: String(templateDrbPath || '').slice(0, 500),
        trackName: String(trackName || 'Resolve AI Captions').slice(0, 120),
        fps: Number(fps) || 25,
        recordFrame: Math.max(0, Math.round(Number(recordFrame) || 0)),
        preview: Boolean(preview),
        setupOnly: Boolean(setupOnly),
        cueCount: normalized.length,
        rawTextLength: Math.max(0, Number(rawTextLength) || 0),
        cues: normalized
    };
}

function buildFuscriptArgs(wrapper) {
    return ['-l', 'lua', wrapper];
}

function parseNativeTextResult(output = '') {
    const errorMatch = String(output || '').match(/ERROR:\s*(.+)/i);
    const createdMatch = String(output || '').match(/OK:\s*created\s+(\d+)\s+native captions/i);
    const receivedMatch = String(output || '').match(/INFO:\s*received\s+(\d+)\s+native caption cues/i);
    const bridgeMatch = String(output || '').match(/INFO:\s*native bridge\s+(.+)/i);
    const created = createdMatch ? Number(createdMatch[1]) : null;
    const error = errorMatch ? errorMatch[1].trim() : '';
    return {
        created,
        luaReceivedCueCount: receivedMatch ? Number(receivedMatch[1]) : null,
        bridgeVersion: bridgeMatch ? bridgeMatch[1].trim() : '',
        error,
        durationUnsupported: /ignored scripted duration trimming|Native per-cue Text\+ creation is unavailable/i.test(error),
        zeroCreated: created === 0
    };
}

function runNativeTextJob(payload, options = {}) {
    const detection = detectNativeText(options);
    const templateAssetPath = detection.templateAssetPath || ensureNativeTemplateAsset();
    const templateDrbPath = payload.templateDrbPath || options.templateDrbPath || detection.templateDrbPath || '';
    const prepared = prepareNativeTextJob({ ...payload, templateAssetPath, templateDrbPath });
    if (!prepared.success) return Promise.resolve(prepared);
    if (!detection.ready) return Promise.resolve({ success: false, cueCount: prepared.cueCount, ...detection });
    const job = prepared.payload;
    const tempDir = path.join(os.tmpdir(), 'resolve-ai-captions');
    fs.mkdirSync(tempDir, { recursive: true });
    const wrapper = path.join(tempDir, `caption-${Date.now()}.lua`);
    const cueFile = writeNativeCueFile(job, tempDir);
    // Send cues inline first. The sidecar file stays as a fallback for fuscript
    // environments that can read temp files reliably.
    const luaJob = buildNativeLuaJob(job, cueFile);
    const debugPath = path.join(tempDir, `caption-debug-${Date.now()}.json`);
    fs.writeFileSync(debugPath, JSON.stringify(nativeDebugPayload(luaJob, wrapper, cueFile), null, 2), 'utf8');
    const cleanupTemp = () => {
        try { fs.unlinkSync(wrapper); } catch (_err) { /* ignore temp cleanup */ }
        try { fs.unlinkSync(cueFile); } catch (_err) { /* ignore temp cleanup */ }
    };
    fs.writeFileSync(wrapper, buildNativeWrapperSource(luaJob, cueFile, debugPath), 'utf8');
    return new Promise((resolve) => {
        const child = spawn(detection.fuscriptPath, buildFuscriptArgs(wrapper), { windowsHide: true });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
            child.kill();
            resolve({ success: false, error: 'Native Text+ timed out.', stdout, stderr, debugPath, wrapperPath: wrapper, bridgeVersion: NATIVE_BRIDGE_VERSION, cueCount: job.cues.length, ipcCueCount: luaJob.cueCount });
        }, NATIVE_TIMEOUT_MS);
        child.stdout.on('data', chunk => { stdout += chunk.toString(); });
        child.stderr.on('data', chunk => { stderr += chunk.toString(); });
        child.on('close', code => {
            clearTimeout(timer);
            const output = `${stdout}\n${stderr}`;
            const nativeResult = parseNativeTextResult(output);
            const templateMissing = /Caption template not found/i.test(output);
            const success = code === 0 && !nativeResult.error && nativeResult.created !== 0;
            if (success) cleanupTemp();
            resolve({
                success,
                code,
                created: nativeResult.created,
                cueCount: job.cues.length,
                ipcCueCount: luaJob.cueCount,
                luaReceivedCueCount: nativeResult.luaReceivedCueCount,
                bridgeVersion: nativeResult.bridgeVersion || NATIVE_BRIDGE_VERSION,
                debugPath,
                wrapperPath: wrapper,
                cueFile,
                stdout,
                stderr,
                durationUnsupported: nativeResult.durationUnsupported,
                appendToTimeline: true,
                error: success ? '' : templateMissing
                    ? `Caption template not found. Import a Resolve Text+ title/generator into the Media Pool and name it ${job.templateName}.`
                    : (nativeResult.error
                        || (nativeResult.zeroCreated ? 'Native Text+ ran, but Resolve did not create any timeline items. Check that the template is a Media Pool Text+ title/generator and the current timeline is editable.' : '')
                        || stderr.trim()
                        || stdout.trim()
                        || 'Native Text+ failed.'),
                payload: job
            });
        });
        child.on('error', err => {
            clearTimeout(timer);
            resolve({ success: false, error: err.message, cueCount: job.cues.length, ipcCueCount: luaJob.cueCount, debugPath, wrapperPath: wrapper, bridgeVersion: NATIVE_BRIDGE_VERSION, payload: job });
        });
    });
}

function buildNativeSelfTestPayload(options = {}) {
    return {
        cues: [
            { start: 0, end: 1.2, text: 'Resolve AI native caption self test one.' },
            { start: 1.4, end: 2.6, text: 'Resolve AI native caption self test two.' }
        ],
        rawText: '',
        format: 'srt',
        fps: options.fps || 25,
        templateName: options.templateName || options.nativeTemplateName || 'Resolve AI Caption',
        templateAssetPath: options.templateAssetPath || '',
        templateDrbPath: options.templateDrbPath || NATIVE_TEMPLATE_DRB,
        recordFrame: options.recordFrame || 0,
        preview: false
    };
}

function installNativeTemplateAsset() {
    const templateDrbPath = ensureNativeTemplateAsset();
    const available = fs.existsSync(templateDrbPath);
    return {
        success: available,
        ready: available,
        manualRequired: !available,
        templateDrbPath,
        templateAssetPath: templateDrbPath,
        templateName: 'Resolve AI Caption',
        message: available
            ? 'Native Text+ template bundle found. Create Text+ captions to auto-import it if missing.'
            : 'No bundled Text+ template found. Create or import a Text+ title in the Media Pool and name it Resolve AI Caption.'
    };
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
    return { success: true, filePath, format, text, rawText: text, cues, cueCount: cues.length, analysis: analyzeCaptionCues(cues) };
}

function handleParseCaptions(_event, payload = {}) {
    const text = payload.text || '';
    const format = inferCaptionFormat(text, payload.format);
    const cues = parseCaptionText(text, format);
    return { success: true, format, text, rawText: text, cues, cueCount: cues.length, analysis: analyzeCaptionCues(cues) };
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

function handleBuildOverlayRender(_event, payload = {}) {
    return buildCaptionOverlayRender(payload);
}

function setupCaptionHandlers(ipcMain) {
    ipcMain.handle('captions:import', handleImportCaptions);
    ipcMain.handle('captions:parse', handleParseCaptions);
    ipcMain.handle('captions:generate', handleGenerateCaptions);
    ipcMain.handle('captions:buildOverlayRender', handleBuildOverlayRender);
    ipcMain.handle('captions:regroup', (_event, payload = {}) => regroupCues(payload.cues || [], payload.options || payload));
    ipcMain.handle('captions:listProjects', () => listCaptionProjects());
    ipcMain.handle('captions:getProject', (_event, id) => getCaptionProject(id));
    ipcMain.handle('captions:saveProject', (_event, payload = {}) => saveCaptionProject(payload));
    ipcMain.handle('captions:deleteProject', (_event, id) => deleteCaptionProject(id));
    ipcMain.handle('captions:detectNativeText', (_event, payload = {}) => detectNativeText(payload));
    ipcMain.handle('captions:importNativeTemplate', () => installNativeTemplateAsset());
    ipcMain.handle('captions:selfTestNativeText', (_event, payload = {}) => runNativeTextJob(buildNativeSelfTestPayload(payload), payload));
    ipcMain.handle('captions:previewNativeText', (_event, payload = {}) => runNativeTextJob({ ...payload, preview: true }, payload));
    ipcMain.handle('captions:createNativeText', (_event, payload = {}) => runNativeTextJob(payload, payload));
    ipcMain.handle('captions:clearNativePreview', () => ({ success: true }));
}

module.exports = {
    CAPTION_STYLE_PRESETS,
    analyzeCaptionCues,
    buildCaptionOverlayRender,
    buildCaptionPrompt,
    buildFuscriptArgs,
    buildNativeWrapperSource,
    buildNativeSelfTestPayload,
    nativeDebugPayload,
    buildNativeLuaJob,
    buildNativeTextPayload,
    captionFitRules,
    deleteCaptionProject,
    detectNativeText,
    estimateWordTimings,
    formatTime,
    getCaptionProject,
    hashCues,
    installNativeTemplateAsset,
    listCaptionProjects,
    nativeCueRows,
    normalizeCues,
    parseCaptionText,
    parseNativeTextResult,
    parseTimecode,
    prepareNativeTextJob,
    regroupCues,
    saveCaptionProject,
    setupCaptionHandlers,
    splitWords,
    validateCaptionFit
};
