const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { CONFIG_DIR } = require('./paths');
const { readConfig } = require('./config');

const ROUGH_CUT_DIR = path.join(CONFIG_DIR, 'rough-cuts');
const PLAN_DIR = path.join(ROUGH_CUT_DIR, 'plans');
const SCRIPT_DIR = path.join(ROUGH_CUT_DIR, 'scripts');
const DEFAULT_MIN_KEEP_SECONDS = 0.5;
const SHORTS_MIN_SECONDS = 12;
const SHORTS_MIN_TARGET_RATIO = 0.55;
const SHORTS_IDEAL_TARGET_RATIO = 0.75;
const SHORTS_MAX_TARGET_RATIO = 1.45;
const SHORTS_YOUTUBE_STANDARD_SECONDS = 60;
const SHORTS_YOUTUBE_MAX_SECONDS = 180;
const SHORTS_RUBRIC_FIELDS = [
    'hookStrength',
    'standaloneContext',
    'payoff',
    'emotionOrSurprise',
    'cleanEnding',
    'captionTitlePotential',
    'confidence'
];
const INTELLISCRIPT_FALLBACK_MESSAGE = 'Direct IntelliScript API was not found in this Resolve version. You can still use AI Rough Cut, or export a script and run native IntelliScript manually inside Resolve.';

const DIRECT_INTELLISCRIPT_CANDIDATES = [
    'CreateTimelineUsingIntelliScript',
    'CreateTimelineUsingIntelliscript',
    'CreateNewTimelineUsingIntelliScript',
    'CreateNewTimelineUsingIntelliscript',
    'RunIntelliScript',
    'RunIntelliscript',
    'IntelliScript',
    'Intelliscript'
];

function getResolveApi() {
    return require('./resolve');
}

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function normalizePathPart(value, fallback = 'rough-cut') {
    return String(value || fallback)
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
        .replace(/\s+/g, ' ')
        .replace(/[_\s]+$/g, '')
        .trim()
        .slice(0, 80) || fallback;
}

function makePlanId(prefix = 'rough-cut') {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toFiniteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function parseLooseNumber(value) {
    if (value === null || value === undefined) return null;
    const match = String(value).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const number = Number(match[0]);
    return Number.isFinite(number) ? number : null;
}

function parseFps(value) {
    const number = parseLooseNumber(value);
    return number && number > 0 ? number : null;
}

function cleanText(value) {
    return String(value || '')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function parseTimestamp(value, fps = null) {
    if (value === null || value === undefined) return null;
    const raw = String(value).trim();
    if (!raw) return null;
    if (/^\d+(?:\.\d+)?$/.test(raw)) return Number(raw);

    const normalized = raw.replace(',', '.').replace(';', ':');
    const parts = normalized.split(':');
    if (parts.length < 2 || parts.length > 4) return null;

    const numbers = parts.map(part => Number(part));
    if (numbers.some(number => !Number.isFinite(number))) return null;

    if (parts.length === 4) {
        const rate = fps ? Number(fps) : null;
        if (!rate || rate <= 0) return null;
        const [hours, minutes, seconds, frames] = numbers;
        return (hours * 3600) + (minutes * 60) + seconds + (frames / rate);
    }

    const secondsPart = numbers[numbers.length - 1];
    const minutesPart = numbers[numbers.length - 2];
    const hoursPart = numbers.length === 3 ? numbers[0] : 0;
    if (minutesPart < 0 || secondsPart < 0) return null;
    return (hoursPart * 3600) + (minutesPart * 60) + secondsPart;
}

function formatTimestamp(seconds = 0) {
    const clamped = Math.max(0, Number(seconds) || 0);
    const hours = Math.floor(clamped / 3600);
    const minutes = Math.floor((clamped % 3600) / 60);
    const wholeSeconds = Math.floor(clamped % 60);
    const ms = Math.round((clamped - Math.floor(clamped)) * 1000);
    return [
        String(hours).padStart(2, '0'),
        String(minutes).padStart(2, '0'),
        String(wholeSeconds).padStart(2, '0')
    ].join(':') + `.${String(ms).padStart(3, '0')}`;
}

function parseTimedCaptionBlocks(text, format = 'srt') {
    const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
    if (!normalized) return [];
    const blocks = normalized
        .replace(/^\uFEFF?WEBVTT[^\n]*\n+/i, '')
        .split(/\n{2,}/)
        .map(block => block.trim())
        .filter(Boolean);
    const cues = [];
    for (const block of blocks) {
        const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
        const timingIndex = lines.findIndex(line => line.includes('-->'));
        if (timingIndex < 0) continue;
        const [startRaw, endRaw] = lines[timingIndex].split('-->').map(part => part.trim().split(/\s+/)[0]);
        const start = parseTimestamp(startRaw);
        const end = parseTimestamp(endRaw);
        const cueText = cleanText(lines.slice(timingIndex + 1).join(' '));
        if (start === null || end === null || end <= start || !cueText) continue;
        cues.push({
            index: cues.length + 1,
            start,
            end,
            text: cueText,
            format
        });
    }
    return cues;
}

function parseTimestampedTxt(text) {
    const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
    if (!normalized) return [];
    const cues = [];
    const rangePattern = /^\s*(?:\[\s*)?(\d+(?::\d{1,2}){1,2}[,.]\d{1,3}|\d+(?::\d{2}){1,3})(?:\s*\]?)\s*(?:-->|-|to)\s*(?:\[\s*)?(\d+(?::\d{1,2}){1,2}[,.]\d{1,3}|\d+(?::\d{2}){1,3})(?:\s*\]?)\s*[:-]?\s*(.+)$/i;
    for (const line of normalized.split('\n')) {
        const match = line.match(rangePattern);
        if (!match) continue;
        const start = parseTimestamp(match[1]);
        const end = parseTimestamp(match[2]);
        const cueText = cleanText(match[3]);
        if (start === null || end === null || end <= start || !cueText) continue;
        cues.push({
            index: cues.length + 1,
            start,
            end,
            text: cueText,
            format: 'txt'
        });
    }
    return cues;
}

function analyzeTranscript(cues = []) {
    const valid = cues.filter(cue => Number(cue.end) > Number(cue.start));
    const firstStart = valid.length ? Math.min(...valid.map(cue => cue.start)) : 0;
    const lastEnd = valid.length ? Math.max(...valid.map(cue => cue.end)) : 0;
    const wordCount = valid.reduce((sum, cue) => sum + cleanText(cue.text).split(/\s+/).filter(Boolean).length, 0);
    return {
        cueCount: valid.length,
        wordCount,
        firstStart,
        lastEnd,
        duration: Number(Math.max(0, lastEnd - firstStart).toFixed(3))
    };
}

function parseTranscriptText(text, format = 'txt') {
    const requested = String(format || 'txt').toLowerCase();
    const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
    const autoFormat = normalized.toUpperCase().startsWith('WEBVTT') ? 'vtt' : requested;
    const isCaption = autoFormat === 'srt' || autoFormat === 'vtt';
    const cues = isCaption
        ? parseTimedCaptionBlocks(normalized, autoFormat)
        : parseTimestampedTxt(normalized);
    return {
        success: true,
        format: autoFormat,
        cues,
        hasTiming: cues.length > 0,
        storyText: cleanText(normalized.replace(/^\uFEFF?WEBVTT[^\n]*\n+/i, '')),
        analysis: analyzeTranscript(cues),
        warnings: cues.length ? [] : ['No parseable timestamp ranges found. Untimestamped TXT can prepare Native IntelliScript text, but cannot create a frame-accurate rough cut.']
    };
}

function buildTranscriptHash(text) {
    return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

function detectTranscriptOffsetSeconds(analysisOrCues = {}, clip = {}) {
    const analysis = Array.isArray(analysisOrCues)
        ? analyzeTranscript(analysisOrCues)
        : analysisOrCues || {};
    const firstStart = Number(analysis.firstStart || 0);
    const lastEnd = Number(analysis.lastEnd || 0);
    const span = Math.max(0, lastEnd - firstStart);
    const clipDuration = Number(clip.durationSeconds || 0);
    if (firstStart >= 3600) return Math.floor(firstStart / 3600) * 3600;
    if (clipDuration > 0 && lastEnd > clipDuration * 1.5 && span <= clipDuration * 1.25) {
        return firstStart;
    }
    return 0;
}

function offsetCue(cue = {}, offsetSeconds = 0) {
    const offset = Math.max(0, Number(offsetSeconds) || 0);
    return {
        ...cue,
        start: Math.max(0, Number(cue.start || 0) - offset),
        end: Math.max(0, Number(cue.end || 0) - offset)
    };
}

function chunkTranscript(cues = [], maxChars = 5000, options = {}) {
    const offsetSeconds = Number(options.offsetSeconds || 0);
    const normalizedCues = cues.map(cue => offsetCue(cue, offsetSeconds)).filter(cue => cue.end > cue.start);
    const chunks = [];
    let current = [];
    let chars = 0;
    for (const cue of normalizedCues) {
        const line = `[${formatTimestamp(cue.start)}-${formatTimestamp(cue.end)}] ${cue.text}`;
        if (current.length && chars + line.length > maxChars) {
            chunks.push({
                index: chunks.length + 1,
                start: current[0].start,
                end: current[current.length - 1].end,
                text: current.map(item => `[${formatTimestamp(item.start)}-${formatTimestamp(item.end)}] ${item.text}`).join('\n')
            });
            current = [];
            chars = 0;
        }
        current.push(cue);
        chars += line.length + 1;
    }
    if (current.length) {
        chunks.push({
            index: chunks.length + 1,
            start: current[0].start,
            end: current[current.length - 1].end,
            text: current.map(item => `[${formatTimestamp(item.start)}-${formatTimestamp(item.end)}] ${item.text}`).join('\n')
        });
    }
    return chunks;
}

function normalizeGoal(goal) {
    return cleanText(goal) || 'keep the strongest, most useful, most entertaining moments';
}

function normalizeRubricScores(candidate = {}) {
    const source = candidate.rubricScores || {};
    const scores = {};
    const missing = [];
    for (const field of SHORTS_RUBRIC_FIELDS) {
        const value = Number(source[field]);
        if (!Number.isFinite(value) || value < 0 || value > 1) {
            missing.push(field);
        } else {
            scores[field] = Number(value.toFixed(3));
        }
    }
    if (missing.length) return { success: false, missing, scores: null, average: null };
    const average = SHORTS_RUBRIC_FIELDS.reduce((sum, field) => sum + scores[field], 0) / SHORTS_RUBRIC_FIELDS.length;
    return { success: true, missing: [], scores, average: Number(average.toFixed(4)) };
}

function normalizeWhyThisWorks(candidate = {}) {
    const source = candidate.whyThisWorks || {};
    return {
        scrollStoppingHook: cleanText(source.scrollStoppingHook || candidate.hook),
        requiredContext: cleanText(source.requiredContext || candidate.setup),
        payoff: cleanText(source.payoff || candidate.payoff),
        cleanEnding: cleanText(source.cleanEnding || candidate.ending),
        titleCaptionAngle: cleanText(source.titleCaptionAngle || candidate.captionHook || candidate.title)
    };
}

function formatCreatorProfile(profile = null) {
    if (!profile || (!profile.selectedCount && !profile.rejectedCount)) return '';
    return [
        'Creator preference profile from prior local choices:',
        profile.likedTags?.length ? `- Lean toward tags/topics: ${profile.likedTags.join(', ')}.` : '',
        profile.rejectedTags?.length ? `- Avoid patterns/tags often rejected: ${profile.rejectedTags.join(', ')}.` : '',
        profile.averageSelectedDurationSeconds ? `- Preferred selected clip length averages about ${profile.averageSelectedDurationSeconds}s.` : '',
        profile.notes?.length ? `- User feedback notes: ${profile.notes.slice(0, 5).join(' / ')}.` : ''
    ].filter(Boolean).join('\n');
}

function buildCutPlanPrompt({
    cues = [],
    goal = '',
    targetDurationSeconds = null,
    handleSeconds = 0.5,
    clip = {},
    transcriptOffsetSeconds = null,
    provider = null,
    model = null,
    creatorProfile = null
} = {}) {
    const offset = transcriptOffsetSeconds !== null && transcriptOffsetSeconds !== undefined
        ? Number(transcriptOffsetSeconds) || 0
        : detectTranscriptOffsetSeconds(cues, clip);
    const chunks = chunkTranscript(cues, 5000, { offsetSeconds: offset });
    const target = toFiniteNumber(targetDurationSeconds);
    const clipDuration = toFiniteNumber(clip.durationSeconds);
    return [
        'You are creating a non-destructive AI Rough Cut plan for DaVinci Resolve.',
        'Return ONLY valid JSON. No markdown, no prose, no comments.',
        '',
        'Schema:',
        '{"goal":"keep funny parts","targetDurationSeconds":60,"ranges":[{"type":"keep","start":"00:01:12.400","end":"00:01:25.100","reason":"funny reaction","tags":["funny","important"],"confidence":0.82}]}',
        '',
        'Rules:',
        '- Prefer type "keep" ranges. Use "remove" only if absolutely necessary.',
        '- Timestamps must be clip-relative HH:MM:SS.mmm values from the transcript.',
        '- Do not invent timestamps outside the transcript or clip duration.',
        '- Keep ranges should be meaningful and not shorter than 0.5 seconds after handles.',
        '- Reasons should be short editor-facing notes.',
        '- Tags should be short labels such as funny, important, dead-air, repeat, unclear, strong-open, useful.',
        '- Confidence must be a number from 0 to 1.',
        target ? `- Prefer a final rough cut near ${target} seconds. Validation will still decide final ranges deterministically.` : '- No strict target duration was provided; prioritize the goal.',
        `- User-selected handles are ${Number(handleSeconds) || 0}s before and after each kept range; account for that when choosing tight moments.`,
        offset > 0 ? `- Transcript timecodes were normalized by subtracting ${formatTimestamp(offset)}. Return clip-relative timestamps from the normalized transcript below, not the original absolute timeline timecode.` : '',
        '',
        'Privacy note: transcript text may be sent to the selected AI provider; media files are not included in this request.',
        '',
        'Clip:',
        `- Name: ${clip.name || 'Selected clip'}`,
        clipDuration ? `- Duration: ${clipDuration.toFixed(3)} seconds` : '- Duration: unavailable',
        clip.fps ? `- Source FPS: ${clip.fps}` : '- Source FPS: unavailable',
        provider ? `- Provider: ${provider}` : '',
        model ? `- Model: ${model}` : '',
        '',
        `Goal: ${normalizeGoal(goal)}`,
        '',
        '<timestamped_transcript_chunks>',
        chunks.map(chunk => [
            `<chunk index="${chunk.index}" start="${formatTimestamp(chunk.start)}" end="${formatTimestamp(chunk.end)}">`,
            chunk.text,
            '</chunk>'
        ].join('\n')).join('\n\n'),
        '</timestamped_transcript_chunks>'
    ].filter(Boolean).join('\n');
}

function buildShortsPrompt({
    cues = [],
    goal = '',
    targetDurationSeconds = 60,
    maxClips = 6,
    handleSeconds = 0.5,
    clip = {},
    transcriptOffsetSeconds = null,
    provider = null,
    model = null,
    creatorProfile = null
} = {}) {
    const offset = transcriptOffsetSeconds !== null && transcriptOffsetSeconds !== undefined
        ? Number(transcriptOffsetSeconds) || 0
        : detectTranscriptOffsetSeconds(cues, clip);
    const chunks = chunkTranscript(cues, 5000, { offsetSeconds: offset });
    const target = Number(targetDurationSeconds) > 0 ? Number(targetDurationSeconds) : 60;
    const count = Math.max(1, Math.min(10, Number(maxClips) || 6));
    return [
        'You are finding standalone viral short-form clips from a long-form video transcript.',
        'Return ONLY valid JSON. No markdown, no prose, no comments.',
        '',
        'Schema:',
        '{"goal":"find viral clips","targetDurationSeconds":60,"clips":[{"title":"A clear short title","start":"00:13:19.208","end":"00:14:02.500","hook":"why someone would stop scrolling","setup":"context the viewer needs","payoff":"main reveal, joke, lesson, or emotional moment","ending":"why the clip ends cleanly here","captionHook":"short on-screen opening text","reason":"self-contained emotional story beat","score":0.91,"rubricScores":{"hookStrength":0.92,"standaloneContext":0.86,"payoff":0.9,"emotionOrSurprise":0.84,"cleanEnding":0.88,"captionTitlePotential":0.91,"confidence":0.87},"whyThisWorks":{"scrollStoppingHook":"why a viewer stops in the first 2 seconds","requiredContext":"what the viewer understands quickly","payoff":"the reveal, joke, useful lesson, or emotional beat","cleanEnding":"why this endpoint feels complete","titleCaptionAngle":"title/caption idea for the post"},"tags":["emotional","story","shorts"]}]}',
        '',
        'Rules:',
        `- Return ${count} or fewer standalone clips.`,
        `- The ${target} second target is PER SHORT, not the combined duration of all clips.`,
        `- Each clip should be close to ${target} seconds when possible. Acceptable range: ${Math.max(SHORTS_MIN_SECONDS, Math.round(target * SHORTS_MIN_TARGET_RATIO))}-${Math.round(target * SHORTS_MAX_TARGET_RATIO)} seconds.`,
        '- If the transcript does not contain enough strong standalone candidates near the target length, return fewer clips instead of short disconnected highlights.',
        '- Do not stitch unrelated moments together.',
        '- Do not create a compilation or montage. Every clips[] entry becomes its own separate timeline.',
        '- Each clip must make sense on its own: hook, context/setup, payoff, and clean ending.',
        '- Fill hook, setup, payoff, and ending for every candidate. If one is weak, choose a different boundary or skip the clip.',
        '- Fill rubricScores for every candidate. Scores must be 0..1: hookStrength, standaloneContext, payoff, emotionOrSurprise, cleanEnding, captionTitlePotential, confidence.',
        '- Fill whyThisWorks for every candidate: scrollStoppingHook, requiredContext, payoff, cleanEnding, titleCaptionAngle.',
        '- Include captionHook as a short first-frame text overlay idea.',
        '- Prefer moments with tension, surprise, emotion, clear explanation, controversy, transformation, strong quote, or useful lesson.',
        '- Avoid clips that require too much missing context.',
        '- Timestamps must be clip-relative HH:MM:SS.mmm values from the normalized transcript below.',
        '- Title should be short and usable as a timeline name.',
        '- Hook should explain why the clip might perform well as a Short/Reel/TikTok.',
        '- Score must be a number from 0 to 1.',
        `- User-selected handles are ${Number(handleSeconds) || 0}s before and after each short; account for that when choosing boundaries.`,
        offset > 0 ? `- Transcript timecodes were normalized by subtracting ${formatTimestamp(offset)}. Return normalized clip-relative timestamps, not original absolute timecode.` : '',
        '',
        'Privacy note: transcript text may be sent to the selected AI provider; media files are not included in this request.',
        '',
        formatCreatorProfile(creatorProfile),
        creatorProfile ? '' : '',
        'Source clip:',
        `- Name: ${clip.name || 'Selected clip'}`,
        clip.durationSeconds ? `- Duration: ${Number(clip.durationSeconds).toFixed(3)} seconds` : '- Duration: unavailable',
        clip.fps ? `- Source FPS: ${clip.fps}` : '- Source FPS: unavailable',
        provider ? `- Provider: ${provider}` : '',
        model ? `- Model: ${model}` : '',
        '',
        `Creator goal: ${normalizeGoal(goal || 'find clips likely to work as standalone shorts')}`,
        '',
        '<timestamped_transcript_chunks>',
        chunks.map(chunk => [
            `<chunk index="${chunk.index}" start="${formatTimestamp(chunk.start)}" end="${formatTimestamp(chunk.end)}">`,
            chunk.text,
            '</chunk>'
        ].join('\n')).join('\n\n'),
        '</timestamped_transcript_chunks>'
    ].filter(Boolean).join('\n');
}

function extractJsonObject(text) {
    if (text && typeof text === 'object') return text;
    const value = String(text || '').trim();
    if (!value) throw new Error('No JSON provided.');
    try {
        return JSON.parse(value);
    } catch { /* try fenced JSON */ }
    const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
        try {
            return JSON.parse(fenced[1].trim());
        } catch { /* try object slice */ }
    }
    const start = value.indexOf('{');
    const end = value.lastIndexOf('}');
    if (start >= 0 && end > start) {
        return JSON.parse(value.slice(start, end + 1));
    }
    throw new Error('Could not parse cut-plan JSON.');
}

function parseCutPlanJson(input) {
    try {
        return { success: true, plan: extractJsonObject(input), error: null };
    } catch (err) {
        return { success: false, plan: null, error: err.message || 'Invalid JSON' };
    }
}

function rawRangeToSeconds(range = {}, fps = null, options = {}) {
    const start = parseTimestamp(range.start, fps);
    const end = parseTimestamp(range.end, fps);
    const offset = Math.max(0, Number(options.transcriptOffsetSeconds || 0));
    if (offset > 0 && start !== null && end !== null && start >= offset && end >= offset) {
        return { start: start - offset, end: end - offset };
    }
    return { start, end };
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function mergeRanges(ranges = []) {
    const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
    const merged = [];
    for (const range of sorted) {
        const previous = merged[merged.length - 1];
        if (previous && range.start <= previous.end) {
            previous.end = Math.max(previous.end, range.end);
            previous.reason = [previous.reason, range.reason].filter(Boolean).join(' / ');
            previous.tags = Array.from(new Set([...(previous.tags || []), ...(range.tags || [])]));
            previous.confidence = previous.confidence === null || range.confidence === null
                ? null
                : Number(Math.min(previous.confidence, range.confidence).toFixed(3));
        } else {
            merged.push({ ...range });
        }
    }
    return merged;
}

function rangeDuration(range) {
    return Math.max(0, Number(range.end) - Number(range.start));
}

function confidenceScore(range) {
    const confidence = Number(range.confidence);
    return Number.isFinite(confidence) ? confidence : 0.5;
}

function fitRangesToTarget(ranges = [], targetDurationSeconds = null) {
    const target = Number(targetDurationSeconds);
    const total = ranges.reduce((sum, range) => sum + rangeDuration(range), 0);
    if (!Number.isFinite(target) || target <= 0 || ranges.length <= 1) {
        return { ranges, warning: null };
    }
    if (total <= target * 1.1) {
        const warning = total < target * 0.7
            ? `AI selected ${total.toFixed(1)}s, below the ${target.toFixed(1)}s target. Ask it to regenerate with more keep ranges if needed.`
            : null;
        return { ranges, warning };
    }

    const scale = 2; // half-second DP buckets keep this deterministic and cheap.
    const limitUnits = Math.max(1, Math.ceil(target * 1.08 * scale));
    const dp = new Array(limitUnits + 1).fill(null);
    dp[0] = { score: 0, indexes: [], duration: 0 };

    ranges.forEach((range, index) => {
        const duration = rangeDuration(range);
        const units = Math.max(1, Math.round(duration * scale));
        const score = Math.round(confidenceScore(range) * 1000) + Math.min(200, Math.round(duration * 2));
        for (let unit = limitUnits - units; unit >= 0; unit -= 1) {
            if (!dp[unit]) continue;
            const nextUnit = unit + units;
            const next = {
                score: dp[unit].score + score,
                indexes: [...dp[unit].indexes, index],
                duration: dp[unit].duration + duration
            };
            if (!dp[nextUnit] || next.score > dp[nextUnit].score) dp[nextUnit] = next;
        }
    });

    const candidates = dp.filter(Boolean).filter(item => item.indexes.length > 0);
    if (!candidates.length) {
        const bestSingle = [...ranges].sort((a, b) => {
            const aDistance = Math.abs(rangeDuration(a) - target);
            const bDistance = Math.abs(rangeDuration(b) - target);
            if (Math.abs(aDistance - bDistance) > 0.25) return aDistance - bDistance;
            return confidenceScore(b) - confidenceScore(a);
        })[0];
        if (!bestSingle) return { ranges, warning: null };
        return {
            ranges: [bestSingle],
            warning: `Target ${target.toFixed(1)}s applied: selected 1 of ${ranges.length} keep ranges, ${rangeDuration(bestSingle).toFixed(1)}s total. The selected range is longer than the target but is the closest valid range.`
        };
    }

    const preferred = candidates.filter(item => item.duration >= target * 0.75);
    const pool = preferred.length ? preferred : candidates;
    const best = pool.sort((a, b) => {
        const aDistance = Math.abs(a.duration - target);
        const bDistance = Math.abs(b.duration - target);
        if (Math.abs(aDistance - bDistance) > 0.25) return aDistance - bDistance;
        return b.score - a.score;
    })[0];
    if (!best) return { ranges, warning: null };

    const selected = best.indexes
        .sort((a, b) => a - b)
        .map(index => ranges[index]);
    return {
        ranges: selected,
        warning: `Target ${target.toFixed(1)}s applied: selected ${selected.length} of ${ranges.length} keep ranges, ${best.duration.toFixed(1)}s total.`
    };
}

function removeToKeep(removeRanges = [], clipDurationSeconds) {
    const duration = Number(clipDurationSeconds);
    if (!Number.isFinite(duration) || duration <= 0) return [];
    const removes = mergeRanges(removeRanges.map(range => ({
        start: clamp(range.start, 0, duration),
        end: clamp(range.end, 0, duration),
        reason: range.reason,
        tags: range.tags || [],
        confidence: range.confidence
    })).filter(range => range.end > range.start));
    const keeps = [];
    let cursor = 0;
    for (const remove of removes) {
        if (remove.start > cursor) {
            keeps.push({
                type: 'keep',
                start: cursor,
                end: remove.start,
                reason: 'kept outside AI remove range',
                tags: ['converted-from-remove'],
                confidence: null
            });
        }
        cursor = Math.max(cursor, remove.end);
    }
    if (cursor < duration) {
        keeps.push({
            type: 'keep',
            start: cursor,
            end: duration,
            reason: 'kept outside AI remove range',
            tags: ['converted-from-remove'],
            confidence: null
        });
    }
    return keeps;
}

function normalizeRanges(plan = {}, options = {}) {
    const clipDuration = toFiniteNumber(options.clipDurationSeconds ?? options.clip?.durationSeconds);
    const fps = parseFps(options.fps ?? options.clip?.fps);
    const handleSeconds = Math.max(0, Number(options.handleSeconds || 0));
    const minDuration = Math.max(0, Number(options.minDurationSeconds || DEFAULT_MIN_KEEP_SECONDS));
    const errors = [];
    const warnings = [];

    if (!clipDuration || clipDuration <= 0) {
        errors.push('Selected clip duration is unavailable, so frame-accurate rough cut ranges cannot be validated.');
        return { success: false, errors, warnings, normalizedRanges: [] };
    }

    const rawRanges = Array.isArray(plan.ranges) ? plan.ranges : [];
    const keep = [];
    const remove = [];
    rawRanges.forEach((range, index) => {
        const type = range?.type;
        if (type !== 'keep' && type !== 'remove') {
            errors.push(`Range ${index + 1} has invalid type.`);
            return;
        }
        const { start, end } = rawRangeToSeconds(range, fps, { transcriptOffsetSeconds: options.transcriptOffsetSeconds });
        if (start === null || end === null) {
            errors.push(`Range ${index + 1} has an invalid timestamp.`);
            return;
        }
        if (end <= start) {
            errors.push(`Range ${index + 1} ends before or at its start.`);
            return;
        }
        if (start < 0 || end > clipDuration) {
            errors.push(`Range ${index + 1} is outside the selected clip duration.`);
            return;
        }
        let confidence = range.confidence;
        if (confidence === undefined || confidence === null || confidence === '') {
            confidence = null;
        } else {
            confidence = Number(confidence);
            if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
                confidence = null;
                warnings.push(`Range ${index + 1} confidence was invalid and was cleared.`);
            }
        }
        const normalized = {
            type,
            start,
            end,
            startLabel: formatTimestamp(start),
            endLabel: formatTimestamp(end),
            reason: cleanText(range.reason) || '',
            tags: Array.isArray(range.tags) ? range.tags.map(cleanText).filter(Boolean).slice(0, 8) : [],
            confidence
        };
        if (type === 'keep') keep.push(normalized);
        else remove.push(normalized);
    });

    if (errors.length) return { success: false, errors, warnings, normalizedRanges: [] };

    let baseKeep = keep;
    if (!baseKeep.length && remove.length) {
        baseKeep = removeToKeep(remove, clipDuration);
        warnings.push('AI returned remove ranges only; converted them into deterministic keep ranges.');
    } else if (keep.length && remove.length) {
        warnings.push('AI returned both keep and remove ranges; using keep ranges only for timeline creation.');
    }

    const handled = baseKeep.map(range => {
        const handledStart = clamp(range.start - handleSeconds, 0, clipDuration);
        const handledEnd = clamp(range.end + handleSeconds, 0, clipDuration);
        return {
            ...range,
            originalStart: range.start,
            originalEnd: range.end,
            start: Number(handledStart.toFixed(3)),
            end: Number(handledEnd.toFixed(3)),
            startLabel: formatTimestamp(handledStart),
            endLabel: formatTimestamp(handledEnd),
            handleSeconds
        };
    }).filter((range, index) => {
        const duration = range.end - range.start;
        if (duration < minDuration) {
            warnings.push(`Range ${index + 1} was shorter than ${minDuration}s after handles and was removed.`);
            return false;
        }
        return true;
    });

    let merged = mergeRanges(handled).map((range, index) => ({
        ...range,
        index: index + 1,
        durationSeconds: Number((range.end - range.start).toFixed(3))
    }));

    const fitted = fitRangesToTarget(merged, options.targetDurationSeconds);
    merged = fitted.ranges.map((range, index) => ({
        ...range,
        index: index + 1,
        durationSeconds: Number(rangeDuration(range).toFixed(3))
    }));
    if (fitted.warning) warnings.push(fitted.warning);

    if (!merged.length) {
        errors.push('No valid keep ranges remained after validation.');
        return { success: false, errors, warnings, normalizedRanges: [] };
    }

    return { success: true, errors, warnings, normalizedRanges: merged };
}

function validateCutPlan(input, options = {}) {
    const parsed = parseCutPlanJson(input);
    if (!parsed.success) {
        return { success: false, errors: [parsed.error], warnings: [], plan: null, normalizedRanges: [] };
    }
    const plan = parsed.plan || {};
    const errors = [];
    const warnings = [];
    if (!cleanText(plan.goal)) errors.push('Cut plan requires a goal string.');
    if (!Array.isArray(plan.ranges) || plan.ranges.length === 0) errors.push('Cut plan requires a non-empty ranges array.');
    if (plan.targetDurationSeconds !== undefined && plan.targetDurationSeconds !== null && plan.targetDurationSeconds !== '') {
        const target = Number(plan.targetDurationSeconds);
        if (!Number.isFinite(target) || target <= 0) errors.push('targetDurationSeconds must be a positive number when provided.');
    }
    if (errors.length) return { success: false, errors, warnings, plan, normalizedRanges: [] };
    const normalized = normalizeRanges(plan, options);
    return {
        success: normalized.success,
        errors: normalized.errors,
        warnings: [...warnings, ...normalized.warnings],
        plan: {
            goal: cleanText(plan.goal),
            targetDurationSeconds: Number(plan.targetDurationSeconds) > 0 ? Number(plan.targetDurationSeconds) : null,
            ranges: plan.ranges
        },
        normalizedRanges: normalized.normalizedRanges
    };
}

function normalizeHashtag(value) {
    const tag = cleanText(value)
        .replace(/^#/, '')
        .replace(/[^a-zA-Z0-9_]/g, '')
        .slice(0, 28);
    return tag ? `#${tag}` : '';
}

function buildShortsPlatformChecks(candidate = {}) {
    const duration = Number(candidate.durationSeconds || 0);
    const checks = [];
    if (duration <= 0) {
        return [{ id: 'duration', label: 'Duration', status: 'warn', message: 'Duration unavailable.' }];
    }
    if (duration <= SHORTS_YOUTUBE_STANDARD_SECONDS) {
        checks.push({
            id: 'youtube-standard',
            label: 'YouTube Shorts',
            status: 'ready',
            message: 'Within the classic 60s Shorts target.'
        });
    } else if (duration <= SHORTS_YOUTUBE_MAX_SECONDS) {
        checks.push({
            id: 'youtube-extended',
            label: 'YouTube Shorts',
            status: 'warn',
            message: 'Eligible for 1-3 minute Shorts, but music/content claims can be stricter.'
        });
    } else {
        checks.push({
            id: 'youtube-too-long',
            label: 'YouTube Shorts',
            status: 'fail',
            message: 'Longer than the 3 minute Shorts limit.'
        });
    }
    checks.push({
        id: 'vertical',
        label: 'Vertical edit',
        status: 'info',
        message: 'Create a 9:16 timeline or crop before publishing.'
    });
    return checks;
}

function buildShortsPublishPackage(candidate = {}, options = {}) {
    const clipName = cleanText(options.clipName || options.clip?.name || '');
    const tags = Array.isArray(candidate.tags) ? candidate.tags : [];
    const hashtags = [
        ...tags,
        'shorts',
        'video'
    ].map(normalizeHashtag).filter(Boolean);
    const uniqueHashtags = [...new Set(hashtags)].slice(0, 8);
    const hook = cleanText(candidate.hook || candidate.reason || candidate.title || 'Watch this moment');
    const captionHook = cleanText(candidate.captionHook || candidate.hook || candidate.title || 'Watch this');
    const title = cleanText(candidate.title || hook || 'Shorts clip');
    return {
        title,
        captionHook: captionHook.slice(0, 90),
        description: [hook, clipName ? `Source: ${clipName}` : ''].filter(Boolean).join('\n\n'),
        hashtags: uniqueHashtags,
        captionPrompt: `Create punchy short-form captions for this clip. First-frame hook: "${captionHook.slice(0, 90)}". Highlight key words from: ${[candidate.setup, candidate.payoff].map(cleanText).filter(Boolean).join(' / ') || hook}.`,
        platformChecks: buildShortsPlatformChecks(candidate)
    };
}

function validateShortsPlan(input, options = {}) {
    const parsed = parseCutPlanJson(input);
    if (!parsed.success) {
        return { success: false, errors: [parsed.error], warnings: [], plan: null, clips: [] };
    }
    const plan = parsed.plan || {};
    const errors = [];
    const warnings = [];
    const clipDuration = toFiniteNumber(options.clipDurationSeconds ?? options.clip?.durationSeconds);
    const fps = parseFps(options.fps ?? options.clip?.fps);
    const handleSeconds = Math.max(0, Number(options.handleSeconds || 0));
    const target = Number(options.targetDurationSeconds || plan.targetDurationSeconds || 0) || null;
    const maxClips = Math.max(1, Math.min(10, Number(options.maxClips || 6)));
    const allowReviewCandidates = Boolean(options.allowReviewCandidates);

    if (!cleanText(plan.goal)) errors.push('Shorts plan requires a goal string.');
    if (!Array.isArray(plan.clips) || plan.clips.length === 0) errors.push('Shorts plan requires a non-empty clips array.');
    if (!clipDuration || clipDuration <= 0) errors.push('Selected clip duration is unavailable, so Shorts candidates cannot be validated.');
    if (errors.length) return { success: false, errors, warnings, plan, clips: [] };

    const minDuration = target ? Math.max(SHORTS_MIN_SECONDS, target * SHORTS_MIN_TARGET_RATIO) : SHORTS_MIN_SECONDS;
    const idealDuration = target ? target * SHORTS_IDEAL_TARGET_RATIO : minDuration;
    const maxDuration = target ? target * SHORTS_MAX_TARGET_RATIO : 180;
    const normalized = [];
    plan.clips.slice(0, maxClips).forEach((candidate, index) => {
        const { start, end } = rawRangeToSeconds(candidate, fps, { transcriptOffsetSeconds: options.transcriptOffsetSeconds });
        if (start === null || end === null) {
            warnings.push(`Clip ${index + 1} skipped because its timestamps did not parse.`);
            return;
        }
        if (end <= start) {
            warnings.push(`Clip ${index + 1} skipped because it ends before its start.`);
            return;
        }
        if (start < 0 || end > clipDuration) {
            warnings.push(`Clip ${index + 1} skipped because it is outside the selected source duration.`);
            return;
        }
        const handledStart = clamp(start - handleSeconds, 0, clipDuration);
        const handledEnd = clamp(end + handleSeconds, 0, clipDuration);
        const duration = handledEnd - handledStart;
        if (duration < minDuration) {
            warnings.push(`Clip ${index + 1} skipped because ${duration.toFixed(1)}s is too short for the ${target || 'Shorts'} target.`);
            return;
        }
        if (duration > maxDuration) {
            warnings.push(`Clip ${index + 1} is longer than the target, but kept because it is one standalone candidate.`);
        }
        let score = Number(candidate.score ?? candidate.confidence);
        if (!Number.isFinite(score) || score < 0 || score > 1) score = null;
        const structure = {
            hook: cleanText(candidate.hook),
            setup: cleanText(candidate.setup),
            payoff: cleanText(candidate.payoff),
            ending: cleanText(candidate.ending),
            captionHook: cleanText(candidate.captionHook)
        };
        const structureScore = [structure.hook, structure.setup, structure.payoff, structure.ending].filter(Boolean).length / 4;
        if (structureScore < 1 && !allowReviewCandidates) {
            warnings.push(`Clip ${index + 1} skipped because hook, setup, payoff, and ending must all be filled.`);
            return;
        }
        const rubric = normalizeRubricScores(candidate);
        if (!rubric.success) {
            warnings.push(`Clip ${index + 1} skipped because rubricScores is missing or invalid: ${rubric.missing.join(', ')}.`);
            return;
        }
        const durationFit = target
            ? duration < idealDuration
                ? 'short'
                : duration > maxDuration
                    ? 'long'
                    : 'target'
            : 'ok';
        if (target && duration < idealDuration) {
            warnings.push(`Clip ${index + 1} is valid but shorter than the ideal ${target.toFixed(0)}s target.`);
        }
        if (structureScore < 0.75) {
            warnings.push(`Clip ${index + 1} is missing some hook/setup/payoff/ending notes.`);
        }
        const normalizedCandidate = {
            index: normalized.length + 1,
            title: cleanText(candidate.title) || `Short ${normalized.length + 1}`,
            start: Number(handledStart.toFixed(3)),
            end: Number(handledEnd.toFixed(3)),
            originalStart: start,
            originalEnd: end,
            startLabel: formatTimestamp(handledStart),
            endLabel: formatTimestamp(handledEnd),
            durationSeconds: Number(duration.toFixed(3)),
            hook: structure.hook,
            setup: structure.setup,
            payoff: structure.payoff,
            ending: structure.ending,
            captionHook: structure.captionHook,
            reason: cleanText(candidate.reason),
            tags: Array.isArray(candidate.tags) ? candidate.tags.map(cleanText).filter(Boolean).slice(0, 8) : [],
            score: score ?? rubric.scores.confidence,
            rubricScores: rubric.scores,
            whyThisWorks: normalizeWhyThisWorks(candidate),
            rankScore: Number(((score ?? rubric.average) * 0.45 + rubric.average * 0.35 + structureScore * 0.12 + (durationFit === 'target' ? 0.08 : 0.03)).toFixed(4)),
            structureScore,
            durationFit,
            handleSeconds
        };
        normalizedCandidate.publish = buildShortsPublishPackage(normalizedCandidate, { clip: options.clip });
        normalized.push(normalizedCandidate);
    });

    normalized.sort((a, b) => {
        const scoreDiff = Number(b.rankScore || 0) - Number(a.rankScore || 0);
        if (Math.abs(scoreDiff) > 0.001) return scoreDiff;
        return a.start - b.start;
    });

    if (!normalized.length) {
        return { success: false, errors: ['No valid standalone shorts remained after validation.'], warnings, plan, clips: [] };
    }

    return {
        success: true,
        errors: [],
        warnings,
        plan: {
            goal: cleanText(plan.goal),
            targetDurationSeconds: target,
            clips: plan.clips
        },
        clips: normalized.map((candidate, index) => ({ ...candidate, index: index + 1 }))
    };
}

function secondsToSourceFrameRange(range = {}, clip = {}, options = {}) {
    const fps = parseFps(options.fps ?? clip.fps);
    const sourceStartFrame = Number.isFinite(Number(options.sourceStartFrame ?? clip.sourceStartFrame))
        ? Number(options.sourceStartFrame ?? clip.sourceStartFrame)
        : null;
    if (!fps || sourceStartFrame === null) {
        return { success: false, error: 'Missing source FPS or source start frame.' };
    }
    const startOffset = Math.floor((Number(range.start) || 0) * fps + 1e-6);
    const exclusiveEndOffset = Math.max(startOffset + 1, Math.ceil((Number(range.end) || 0) * fps - 1e-6));
    const mode = options.endFrameMode || 'inclusive';
    const startFrame = Math.round(sourceStartFrame + startOffset);
    const endFrame = Math.round(sourceStartFrame + (mode === 'exclusive' ? exclusiveEndOffset : exclusiveEndOffset - 1));
    return {
        success: true,
        startFrame,
        endFrame,
        endFrameMode: mode,
        durationFrames: Math.max(1, exclusiveEndOffset - startOffset)
    };
}

function buildClipInfos(ranges = [], clip = {}, mediaPoolItem = null, options = {}) {
    let recordFrame = 0;
    return ranges.map(range => {
        const frames = secondsToSourceFrameRange(range, clip, options);
        if (!frames.success) throw new Error(frames.error);
        const clipInfo = {
            mediaPoolItem,
            startFrame: frames.startFrame,
            endFrame: frames.endFrame,
            recordFrame
        };
        const linkedClipInfo = { ...clipInfo };
        const videoClipInfo = { ...clipInfo, mediaType: 1 };
        const audioClipInfo = { ...clipInfo, mediaType: 2 };
        recordFrame += frames.durationFrames;
        return {
            range,
            frames,
            clipInfo,
            linkedClipInfo,
            videoClipInfo,
            audioClipInfo,
            appendClipInfos: options.includeAudio === false ? [videoClipInfo] : [linkedClipInfo],
            recordStartFrame: clipInfo.recordFrame
        };
    });
}

function buildDryRunSummary({ clip = {}, normalizedRanges = [], handleSeconds = 0, timelineName = '' } = {}) {
    const estimated = normalizedRanges.reduce((sum, range) => sum + Math.max(0, Number(range.end) - Number(range.start)), 0);
    return {
        originalDurationSeconds: Number(clip.durationSeconds || 0),
        estimatedDurationSeconds: Number(estimated.toFixed(3)),
        keptSections: normalizedRanges.length,
        handleSeconds: Number(handleSeconds) || 0,
        timelineName: timelineName || makeTimelineName(clip.name)
    };
}

function summarizeAppendResult({ requestedItems = 0, appendedItems = 0, sectionCount = 0, includeAudio = true } = {}) {
    const requested = Number(requestedItems) || 0;
    const appended = Number(appendedItems) || 0;
    const sections = Number(sectionCount) || 0;
    const warnings = [];
    if (!requested) return warnings;
    if (appended === 0) {
        warnings.push('Resolve created the timeline but did not report appended timeline items. Check whether the selected clip has usable source video/audio.');
    } else if (appended < sections) {
        warnings.push(`Resolve reported ${appended} appended items for ${sections} requested sections. Some source ranges may not have landed.`);
    } else if (includeAudio && appended < requested) {
        warnings.push(`Resolve reported ${appended} of ${requested} requested video/audio timeline items. Audio may be unavailable or Resolve may have linked audio internally.`);
    }
    return warnings;
}

function sanitizeTimelineName(name) {
    return normalizePathPart(name || 'Selected Clip', 'Selected Clip');
}

function makeTimelineName(clipName, date = new Date()) {
    const pad = value => String(value).padStart(2, '0');
    const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}-${pad(date.getMinutes())}`;
    return `AI Rough Cut - ${sanitizeTimelineName(clipName)} - ${stamp}`;
}

function makeShortTimelineName(candidate = {}, clipName = 'Clip', date = new Date()) {
    const pad = value => String(value).padStart(2, '0');
    const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}-${pad(date.getMinutes())}`;
    const index = String(candidate.index || 1).padStart(2, '0');
    const title = sanitizeTimelineName(candidate.title || candidate.reason || clipName).slice(0, 42);
    return `Short ${index} - ${title} - ${stamp}`;
}

function overlapsRange(cue, range) {
    return cue.start < range.end && cue.end > range.start;
}

function buildIntelliScriptText({ cues = [], ranges = [], storyText = '' } = {}) {
    const selected = Array.isArray(ranges) && ranges.length
        ? cues.filter(cue => ranges.some(range => overlapsRange(cue, range)))
        : cues;
    const lines = selected.map(cue => cleanText(cue.text)).filter(Boolean);
    if (lines.length) return lines.join('\n');
    return cleanText(storyText);
}

function planFilePath(id, planDir = PLAN_DIR) {
    return path.join(planDir, `${normalizePathPart(id, 'plan')}.json`);
}

function saveCutPlan(payload = {}, planDir = PLAN_DIR) {
    ensureDir(planDir);
    const id = payload.id || makePlanId();
    const plan = {
        id,
        transcriptHash: payload.transcriptHash || null,
        clipIdentifier: payload.clipIdentifier || payload.clip?.id || null,
        clipName: payload.clipName || payload.clip?.name || null,
        provider: payload.provider || null,
        model: payload.model || null,
        goal: normalizeGoal(payload.goal || payload.plan?.goal),
        targetDurationSeconds: Number(payload.targetDurationSeconds || payload.plan?.targetDurationSeconds) || null,
        handleSeconds: Number(payload.handleSeconds || 0),
        generatedPlan: payload.generatedPlan || payload.plan || null,
        normalizedRanges: Array.isArray(payload.normalizedRanges) ? payload.normalizedRanges : [],
        validationWarnings: Array.isArray(payload.validationWarnings) ? payload.validationWarnings : [],
        createdAt: payload.createdAt || new Date().toISOString()
    };
    fs.writeFileSync(planFilePath(id, planDir), JSON.stringify(plan, null, 2), 'utf8');
    return plan;
}

function listCutPlans(planDir = PLAN_DIR) {
    ensureDir(planDir);
    return fs.readdirSync(planDir)
        .filter(name => name.endsWith('.json'))
        .map(name => {
            try {
                const plan = JSON.parse(fs.readFileSync(path.join(planDir, name), 'utf8'));
                return {
                    id: plan.id,
                    clipName: plan.clipName,
                    goal: plan.goal,
                    provider: plan.provider,
                    model: plan.model,
                    targetDurationSeconds: plan.targetDurationSeconds,
                    handleSeconds: plan.handleSeconds,
                    keptSections: Array.isArray(plan.normalizedRanges) ? plan.normalizedRanges.length : 0,
                    createdAt: plan.createdAt
                };
            } catch {
                return null;
            }
        })
        .filter(Boolean)
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

function getCutPlan(id, planDir = PLAN_DIR) {
    try {
        return JSON.parse(fs.readFileSync(planFilePath(id, planDir), 'utf8'));
    } catch {
        return null;
    }
}

function deleteCutPlan(id, planDir = PLAN_DIR) {
    const file = planFilePath(id, planDir);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return { success: true };
}

function normalizedPropKey(key) {
    return String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function readProp(props = {}, names = []) {
    const targets = names.map(normalizedPropKey);
    for (const [key, value] of Object.entries(props || {})) {
        if (targets.includes(normalizedPropKey(key))) return value;
    }
    return null;
}

async function safeCall(label, fn, unavailable, fallback = null) {
    try {
        const value = await fn();
        if (value === undefined || value === null || value === '') {
            unavailable.push(label);
            return fallback;
        }
        return value;
    } catch {
        unavailable.push(label);
        return fallback;
    }
}

function normalizeCollection(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'object') return Object.values(value);
    return [];
}

function timecodeToFrame(value, fps = 25) {
    const seconds = parseTimestamp(value, fps);
    return seconds === null ? null : Math.round(seconds * fps);
}

async function normalizeMediaPoolItem(item, index = 0, unavailable = []) {
    const props = await safeCall('clip properties', () => (
        item && typeof item.GetClipProperty === 'function' ? item.GetClipProperty() : null
    ), unavailable, {});
    const name = await safeCall('clip name', async () => {
        if (item && typeof item.GetName === 'function') return item.GetName();
        return readProp(props, ['Clip Name', 'File Name', 'Name']);
    }, unavailable, null);
    const mediaId = await safeCall('clip media id', async () => {
        if (item && typeof item.GetMediaId === 'function') return item.GetMediaId();
        if (item && typeof item.GetUniqueId === 'function') return item.GetUniqueId();
        return readProp(props, ['Media Id', 'Unique Id']);
    }, unavailable, null);

    const fps = parseFps(readProp(props, ['FPS', 'Frame Rate', 'Video Frame Rate', 'Clip Frame Rate']));
    const frames = parseLooseNumber(readProp(props, ['Frames', 'Duration Frames', 'Frame Count']));
    const durationValue = readProp(props, ['Duration']);
    let durationSeconds = frames && fps
        ? frames / fps
        : (durationValue ? parseTimestamp(durationValue, fps) : null);
    const sourceStartFrameValue = parseLooseNumber(readProp(props, ['Start Frame', 'Source Start Frame']));
    const sourceStartTimecode = readProp(props, ['Start TC', 'Start Timecode', 'Source Start TC', 'Source Timecode']);
    const sourceEndTimecode = readProp(props, ['End TC', 'End Timecode', 'Source End TC', 'Source End Timecode']);
    if ((!durationSeconds || durationSeconds <= 0) && sourceStartTimecode && sourceEndTimecode && fps) {
        const startSeconds = parseTimestamp(sourceStartTimecode, fps);
        const endSeconds = parseTimestamp(sourceEndTimecode, fps);
        if (startSeconds !== null && endSeconds !== null && endSeconds > startSeconds) {
            durationSeconds = endSeconds - startSeconds;
        }
    }
    const sourceStartFrame = sourceStartFrameValue !== null
        ? sourceStartFrameValue
        : (sourceStartTimecode && fps ? timecodeToFrame(sourceStartTimecode, fps) : null);
    const filePath = readProp(props, ['File Path', 'FilePath', 'Path']);
    const fileName = readProp(props, ['File Name', 'Filename']);
    const missingTiming = [];
    if (!fps) missingTiming.push('source FPS');
    if (!durationSeconds) missingTiming.push('duration');
    if (sourceStartFrame === null) missingTiming.push('source start timecode/frame');

    return {
        id: mediaId || `selected-${index + 1}`,
        name: name || fileName || `Selected clip ${index + 1}`,
        fileName: fileName || (filePath ? path.basename(filePath) : null),
        filePath: filePath || null,
        mediaId: mediaId || null,
        fps,
        durationFrames: frames || (durationSeconds && fps ? Math.round(durationSeconds * fps) : null),
        durationSeconds: durationSeconds ? Number(durationSeconds.toFixed(3)) : null,
        sourceStartFrame,
        sourceStartTimecode: sourceStartTimecode || null,
        dropFrame: Boolean(sourceStartTimecode && String(sourceStartTimecode).includes(';')),
        props,
        timingReady: missingTiming.length === 0,
        missingTiming,
        methodSupport: {
            transcribeAudio: Boolean(item && typeof item.TranscribeAudio === 'function'),
            analyzeForIntellisearch: Boolean(item && typeof item.AnalyzeForIntellisearch === 'function'),
            addMarker: Boolean(item && typeof item.AddMarker === 'function')
        }
    };
}

async function getSelectedMediaPoolItems() {
    const unavailable = [];
    const { getCurrentProject } = getResolveApi();
    const project = await getCurrentProject();
    if (!project) return { success: false, state: 'unavailable', unavailable: ['project'], items: [], clips: [] };
    const mediaPool = await safeCall('media pool', () => project.GetMediaPool(), unavailable, null);
    if (!mediaPool) return { success: false, state: 'unavailable', unavailable, items: [], clips: [] };
    if (typeof mediaPool.GetSelectedClips !== 'function') {
        return { success: false, state: 'unavailable', unavailable: [...unavailable, 'GetSelectedClips'], mediaPool, items: [], clips: [] };
    }
    const raw = normalizeCollection(await safeCall('selected Media Pool clips', () => mediaPool.GetSelectedClips(), unavailable, []));
    const clips = [];
    for (let i = 0; i < raw.length; i += 1) {
        clips.push(await normalizeMediaPoolItem(raw[i], i, unavailable));
    }
    const state = clips.length === 0 ? 'none' : clips.length > 1 ? 'multiple' : 'ready';
    return { success: true, state, project, mediaPool, items: raw, clips, unavailable };
}

function publicSelectedMediaResult(result) {
    if (!result.success) {
        return {
            success: false,
            state: result.state || 'unavailable',
            message: 'Resolve scripting could not read the current Media Pool selection.',
            unavailable: result.unavailable || [],
            clips: []
        };
    }
    if (result.state === 'none') {
        return { success: true, state: 'none', message: 'Select one Media Pool clip to use AI Rough Cut.', clips: [], unavailable: result.unavailable || [] };
    }
    if (result.state === 'multiple') {
        return {
            success: true,
            state: 'multiple',
            message: 'AI Rough Cut currently supports one selected clip. Select one clip, or wait for multi-clip support.',
            clips: result.clips,
            unavailable: result.unavailable || []
        };
    }
    const clip = result.clips[0];
    return {
        success: true,
        state: clip.timingReady ? 'ready' : 'needs-metadata',
        message: clip.timingReady
            ? 'Selected clip ready for AI Rough Cut.'
            : `Selected clip is missing ${clip.missingTiming.join(', ')}. Rough Cut will not apply until Resolve exposes this metadata.`,
        clip,
        clips: [clip],
        unavailable: result.unavailable || []
    };
}

async function detectResolveFeatures() {
    const unavailable = [];
    const direct = [];
    const { getResolve, getCurrentProject } = getResolveApi();
    const resolve = await safeCall('resolve', getResolve, unavailable, null);
    const project = await safeCall('project', getCurrentProject, unavailable, null);
    const mediaPool = project ? await safeCall('media pool', () => project.GetMediaPool(), unavailable, null) : null;
    const timeline = project ? await safeCall('current timeline', () => project.GetCurrentTimeline(), unavailable, null) : null;
    const selected = mediaPool && typeof mediaPool.GetSelectedClips === 'function'
        ? normalizeCollection(await safeCall('selected Media Pool clips', () => mediaPool.GetSelectedClips(), unavailable, []))
        : [];
    const clip = selected[0] || null;
    const objects = [
        ['Resolve', resolve],
        ['Project', project],
        ['MediaPool', mediaPool],
        ['Timeline', timeline],
        ['MediaPoolItem', clip]
    ];
    for (const [objectName, object] of objects) {
        if (!object) continue;
        for (const method of DIRECT_INTELLISCRIPT_CANDIDATES) {
            if (typeof object[method] === 'function') direct.push({ object: objectName, method });
        }
    }
    return {
        success: true,
        selectedMediaPoolClipApi: Boolean(mediaPool && typeof mediaPool.GetSelectedClips === 'function'),
        createTimelineFromClips: Boolean(mediaPool && typeof mediaPool.CreateTimelineFromClips === 'function'),
        appendToTimeline: Boolean(mediaPool && typeof mediaPool.AppendToTimeline === 'function'),
        mediaPoolItemTranscribeAudio: Boolean(clip && typeof clip.TranscribeAudio === 'function'),
        folderTranscribeAudio: false,
        analyzeForIntellisearch: Boolean(clip && typeof clip.AnalyzeForIntellisearch === 'function'),
        directIntelliScript: direct,
        directIntelliScriptAvailable: direct.length > 0,
        endFrameMode: 'inclusive',
        endFrameVerification: 'Manual Resolve verification still required; clipInfo endFrame is treated as inclusive to avoid one-frame early trims.',
        fallbackMessage: direct.length ? '' : INTELLISCRIPT_FALLBACK_MESSAGE,
        unavailable
    };
}

function providerModelFromConfig(config = readConfig()) {
    const provider = config.provider || 'auto';
    return {
        provider,
        model: provider === 'codex' ? config.codexModel : config.model
    };
}

async function handleGetSelectedMedia() {
    return publicSelectedMediaResult(await getSelectedMediaPoolItems());
}

async function handleImportTranscript(_event, payload = {}) {
    if (payload.text !== undefined) {
        const text = String(payload.text || '');
        const format = payload.format || 'txt';
        const parsed = parseTranscriptText(text, format);
        return {
            ...parsed,
            filePath: null,
            transcriptHash: buildTranscriptHash(text),
            rawText: text
        };
    }

    let filePath = payload.path;
    if (!filePath) {
        const { dialog } = require('electron');
        const result = await dialog.showOpenDialog({
            title: 'Import rough-cut transcript',
            properties: ['openFile'],
            filters: [{ name: 'Transcript', extensions: ['srt', 'vtt', 'txt'] }]
        });
        if (result.canceled || !result.filePaths[0]) {
            return { success: true, canceled: true, cues: [], hasTiming: false };
        }
        filePath = result.filePaths[0];
    }
    const text = fs.readFileSync(filePath, 'utf8');
    const ext = path.extname(filePath).slice(1).toLowerCase() || 'txt';
    const parsed = parseTranscriptText(text, ext);
    return {
        ...parsed,
        filePath,
        transcriptHash: buildTranscriptHash(text),
        rawText: text
    };
}

function handleBuildCutPlan(_event, payload = {}) {
    const config = readConfig();
    const { provider, model } = providerModelFromConfig(config);
    const prompt = buildCutPlanPrompt({
        cues: payload.cues || [],
        goal: payload.goal,
        targetDurationSeconds: payload.targetDurationSeconds,
        handleSeconds: payload.handleSeconds,
        clip: payload.clip || {},
        transcriptOffsetSeconds: payload.transcriptOffsetSeconds,
        creatorProfile: payload.creatorProfile,
        provider,
        model
    });
    return {
        success: true,
        prompt,
        displayText: `AI Rough Cut plan: ${normalizeGoal(payload.goal)}`,
        transcriptHash: payload.transcriptHash || buildTranscriptHash((payload.cues || []).map(cue => cue.text).join('\n')),
        provider,
        model
    };
}

function handleBuildShortsPlan(_event, payload = {}) {
    const config = readConfig();
    const { provider, model } = providerModelFromConfig(config);
    const prompt = buildShortsPrompt({
        cues: payload.cues || [],
        goal: payload.goal,
        targetDurationSeconds: payload.targetDurationSeconds,
        maxClips: payload.maxClips,
        handleSeconds: payload.handleSeconds,
        clip: payload.clip || {},
        transcriptOffsetSeconds: payload.transcriptOffsetSeconds,
        provider,
        model
    });
    return {
        success: true,
        prompt,
        displayText: `Find Shorts: ${normalizeGoal(payload.goal || 'viral clips')}`,
        transcriptHash: payload.transcriptHash || buildTranscriptHash((payload.cues || []).map(cue => cue.text).join('\n')),
        provider,
        model
    };
}

function handleValidateCutPlan(_event, payload = {}) {
    const clip = payload.clip || {};
    const result = validateCutPlan(payload.plan || payload.text || payload.json, {
        clip,
        clipDurationSeconds: payload.clipDurationSeconds || clip.durationSeconds,
        fps: clip.fps,
        transcriptOffsetSeconds: payload.transcriptOffsetSeconds,
        targetDurationSeconds: payload.targetDurationSeconds,
        handleSeconds: payload.handleSeconds,
        minDurationSeconds: payload.minDurationSeconds || DEFAULT_MIN_KEEP_SECONDS
    });
    const timelineName = makeTimelineName(clip.name);
    const dryRun = result.success
        ? buildDryRunSummary({ clip, normalizedRanges: result.normalizedRanges, handleSeconds: payload.handleSeconds, timelineName })
        : null;
    let savedPlan = null;
    if (result.success && payload.save !== false) {
        const config = readConfig();
        const { provider, model } = providerModelFromConfig(config);
        savedPlan = saveCutPlan({
            transcriptHash: payload.transcriptHash,
            clip,
            provider: payload.provider || provider,
            model: payload.model || model,
            goal: result.plan.goal,
            targetDurationSeconds: result.plan.targetDurationSeconds,
            handleSeconds: payload.handleSeconds,
            generatedPlan: result.plan,
            normalizedRanges: result.normalizedRanges,
            validationWarnings: result.warnings
        });
    }
    return { ...result, savedPlan, dryRun, timelineName };
}

function handleValidateShortsPlan(_event, payload = {}) {
    const clip = payload.clip || {};
    const result = validateShortsPlan(payload.plan || payload.text || payload.json, {
        clip,
        clipDurationSeconds: payload.clipDurationSeconds || clip.durationSeconds,
        fps: clip.fps,
        transcriptOffsetSeconds: payload.transcriptOffsetSeconds,
        targetDurationSeconds: payload.targetDurationSeconds,
        maxClips: payload.maxClips,
        allowReviewCandidates: payload.allowReviewCandidates,
        handleSeconds: payload.handleSeconds,
        minDurationSeconds: payload.minDurationSeconds || DEFAULT_MIN_KEEP_SECONDS
    });
    return {
        ...result,
        dryRun: result.success ? {
            candidateCount: result.clips.length,
            targetDurationSeconds: Number(payload.targetDurationSeconds || result.plan?.targetDurationSeconds || 0) || null,
            totalCandidateSeconds: Number(result.clips.reduce((sum, item) => sum + item.durationSeconds, 0).toFixed(3))
        } : null
    };
}

function buildApplyContext(publicResult, selected) {
    if (publicResult.state === 'none' || publicResult.state === 'multiple' || publicResult.state === 'unavailable') {
        return { success: false, error: publicResult.message || 'Select one Media Pool clip before applying.' };
    }
    const clip = publicResult.clip;
    if (!clip.fps || !clip.durationSeconds || clip.durationSeconds <= 0 || clip.sourceStartFrame === null || clip.sourceStartFrame === undefined) {
        const missing = Array.isArray(clip.missingTiming) ? [...clip.missingTiming] : [];
        if (!clip.fps) missing.push('source FPS');
        if (!clip.durationSeconds || clip.durationSeconds <= 0) missing.push('duration');
        if (clip.sourceStartFrame === null || clip.sourceStartFrame === undefined) missing.push('source start timecode/frame');
        const uniqueMissing = [...new Set(missing)];
        return { success: false, error: `Selected Media Pool item is missing ${uniqueMissing.join(', ')}. Select one video or compound clip from the Media Pool with readable timing metadata.` };
    }
    const mediaPool = selected.mediaPool;
    if (!mediaPool || (typeof mediaPool.CreateEmptyTimeline !== 'function' && typeof mediaPool.CreateTimelineFromClips !== 'function')) {
        return { success: false, error: 'Resolve timeline creation API is unavailable.' };
    }
    return { success: true, clip, mediaPool, mediaPoolItem: selected.items[0], project: selected.project };
}

async function createTimelineFromRanges({ mediaPool, mediaPoolItem, project, clip, ranges, timelineName, includeAudio = true, addMarkers = true, markerPrefix = 'AI keep' } = {}) {
    let mapped;
    try {
        mapped = buildClipInfos(ranges, clip, mediaPoolItem, {
            endFrameMode: 'inclusive',
            includeAudio
        });
    } catch (err) {
        return { success: false, error: err.message || 'Could not map ranges to source frames.' };
    }

    let timeline = null;
    let appendedItems = [];
    const appendClipInfos = mapped.flatMap(item => item.appendClipInfos);
    if (typeof mediaPool.CreateEmptyTimeline === 'function' && typeof mediaPool.AppendToTimeline === 'function') {
        timeline = await mediaPool.CreateEmptyTimeline(timelineName);
        if (!timeline) return { success: false, error: 'Resolve did not create the empty timeline.' };
        try {
            if (project && typeof project.SetCurrentTimeline === 'function') await project.SetCurrentTimeline(timeline);
        } catch { /* best-effort */ }
        try {
            appendedItems = normalizeCollection(await mediaPool.AppendToTimeline(appendClipInfos));
        } catch (err) {
            return {
                success: false,
                error: `Resolve created the timeline but failed to append source ranges: ${err?.message || 'AppendToTimeline failed'}.`,
                timelineName,
                warnings: ['An empty timeline may have been created. Delete it manually if it is visible in the Media Pool.']
            };
        }
    } else {
        timeline = await mediaPool.CreateTimelineFromClips(timelineName, mapped.map(item => item.clipInfo));
    }
    if (!timeline) return { success: false, error: 'Resolve did not create the timeline.' };

    const warnings = summarizeAppendResult({
        requestedItems: appendClipInfos.length,
        appendedItems: appendedItems.length,
        sectionCount: mapped.length,
        includeAudio
    });
    if (!clip.durationSeconds || clip.durationSeconds <= 0) {
        warnings.push('Resolve did not report clip duration; used reviewed transcript ranges to create source frame cuts.');
    }
    if (addMarkers && typeof timeline.AddMarker === 'function') {
        for (const mappedRange of mapped) {
            const range = mappedRange.range;
            const tags = (range.tags || []).join(', ');
            const note = [range.reason || range.hook, tags ? `Tags: ${tags}` : '', range.confidence !== null && range.confidence !== undefined ? `Confidence: ${range.confidence}` : range.score !== null && range.score !== undefined ? `Score: ${range.score}` : '']
                .filter(Boolean)
                .join('\n');
            try {
                await timeline.AddMarker(
                    mappedRange.recordStartFrame,
                    'Blue',
                    range.tags?.[0] || markerPrefix,
                    note,
                    mappedRange.frames.durationFrames,
                    JSON.stringify({ source: 'resolve-ai-rough-cut', rangeIndex: range.index })
                );
            } catch {
                warnings.push('One or more timeline markers could not be added.');
                break;
            }
        }
    } else if (addMarkers) {
        warnings.push('Timeline markers are unavailable in this Resolve scripting object.');
    }
    return {
        success: true,
        timelineName,
        keptSections: ranges.length,
        appendedItems: appendedItems.length || null,
        requestedItems: appendClipInfos.length || mapped.length,
        warnings,
        clipInfos: mapped.map(item => ({
            startFrame: item.clipInfo.startFrame,
            endFrame: item.clipInfo.endFrame,
            recordFrame: item.clipInfo.recordFrame,
            videoMediaType: item.videoClipInfo.mediaType,
            audioMediaType: item.audioClipInfo.mediaType,
            durationFrames: item.frames.durationFrames
        }))
    };
}

async function handleApplyCutPlan(_event, payload = {}) {
    const selected = await getSelectedMediaPoolItems();
    const publicResult = publicSelectedMediaResult(selected);
    const context = buildApplyContext(publicResult, selected);
    if (!context.success) return context;
    const plan = payload.planId ? getCutPlan(payload.planId) : payload.plan;
    const ranges = payload.normalizedRanges || plan?.normalizedRanges || [];
    if (!ranges.length) return { success: false, error: 'No normalized keep ranges to apply.' };
    return createTimelineFromRanges({
        ...context,
        ranges,
        timelineName: payload.timelineName || makeTimelineName(context.clip.name),
        includeAudio: payload.includeAudio !== false,
        addMarkers: payload.addMarkers !== false,
        markerPrefix: 'AI keep'
    });
}

async function handleApplyShortsPlan(_event, payload = {}) {
    const selected = await getSelectedMediaPoolItems();
    const publicResult = publicSelectedMediaResult(selected);
    const context = buildApplyContext(publicResult, selected);
    if (!context.success) return context;
    const candidates = Array.isArray(payload.clips) ? payload.clips : [];
    const selectedIndexes = Array.isArray(payload.selectedIndexes) && payload.selectedIndexes.length
        ? new Set(payload.selectedIndexes.map(Number))
        : null;
    const chosen = candidates.filter(candidate => !selectedIndexes || selectedIndexes.has(Number(candidate.index)));
    if (!chosen.length) return { success: false, error: 'No Shorts candidates selected.' };

    const results = [];
    for (const candidate of chosen) {
        const timelineName = makeShortTimelineName(candidate, context.clip.name);
        const result = await createTimelineFromRanges({
            ...context,
            ranges: [{
                ...candidate,
                reason: candidate.reason || candidate.hook,
                tags: candidate.tags || [],
                confidence: candidate.score
            }],
            timelineName,
            includeAudio: payload.includeAudio !== false,
            addMarkers: payload.addMarkers !== false,
            markerPrefix: 'Short candidate'
        });
        results.push({ ...result, candidate });
    }
    return {
        success: results.some(result => result.success),
        created: results.filter(result => result.success).length,
        failed: results.filter(result => !result.success).length,
        results,
        warnings: results.flatMap(result => result.warnings || [])
    };
}

function writeScriptFile(text, clipName, scriptDir = SCRIPT_DIR) {
    ensureDir(scriptDir);
    const fileName = `${normalizePathPart(clipName || 'IntelliScript')}-${Date.now()}.txt`;
    const filePath = path.join(scriptDir, fileName);
    fs.writeFileSync(filePath, text, 'utf8');
    return filePath;
}

function handleExportIntelliScript(_event, payload = {}) {
    const text = buildIntelliScriptText({
        cues: payload.cues || [],
        ranges: payload.normalizedRanges || payload.ranges || [],
        storyText: payload.storyText || payload.text || ''
    });
    if (!text) return { success: false, error: 'No dialogue/story text to export.' };
    const filePath = writeScriptFile(text, payload.clip?.name || payload.clipName || 'IntelliScript');
    try {
        require('electron').shell.showItemInFolder(filePath);
    } catch { /* reveal is best-effort */ }
    return { success: true, filePath, text };
}

async function handlePrepareNativeIntelliScript(_event, payload = {}) {
    const selected = await getSelectedMediaPoolItems();
    const publicResult = publicSelectedMediaResult(selected);
    const features = await detectResolveFeatures();
    let transcribeResult = null;
    if (payload.transcribe && publicResult.state === 'ready') {
        const item = selected.items[0];
        if (item && typeof item.TranscribeAudio === 'function') {
            try {
                transcribeResult = { attempted: true, success: Boolean(await item.TranscribeAudio(Boolean(payload.speakerDetection))) };
            } catch (err) {
                transcribeResult = { attempted: true, success: false, error: err.message || 'TranscribeAudio failed.' };
            }
        } else {
            transcribeResult = { attempted: false, success: false, error: 'TranscribeAudio is unavailable on this selected clip.' };
        }
    }
    const exportResult = handleExportIntelliScript(null, payload);
    return {
        success: exportResult.success,
        filePath: exportResult.filePath || null,
        error: exportResult.error || null,
        transcribeResult,
        directIntelliScriptAvailable: features.directIntelliScriptAvailable,
        directIntelliScript: features.directIntelliScript,
        fallbackMessage: features.directIntelliScriptAvailable ? '' : INTELLISCRIPT_FALLBACK_MESSAGE,
        manualSteps: [
            'Select the transcribed clip or clips in the Media Pool.',
            'Right-click the selection.',
            'Choose AI Tools -> IntelliScript / Create New Timeline Using IntelliScript.',
            'Choose the exported TXT script when Resolve asks for script material.'
        ]
    };
}

async function handleTranscribeSelectedMedia(_event, payload = {}) {
    const selected = await getSelectedMediaPoolItems();
    const publicResult = publicSelectedMediaResult(selected);
    if (publicResult.state !== 'ready') {
        return { success: false, provider: 'resolve', error: publicResult.message || 'Select one Media Pool clip before transcribing.' };
    }
    const item = selected.items[0];
    if (!item || typeof item.TranscribeAudio !== 'function') {
        return { success: false, provider: 'resolve', error: 'Resolve TranscribeAudio is unavailable on this selected clip.' };
    }
    try {
        const success = Boolean(await item.TranscribeAudio(Boolean(payload.speakerDetection)));
        return {
            success,
            provider: 'resolve',
            message: success
                ? 'Resolve TranscribeAudio completed. Resolve scripting does not expose transcript text here; export/import SRT if needed.'
                : 'Resolve TranscribeAudio returned false.'
        };
    } catch (err) {
        return { success: false, provider: 'resolve', error: err?.message || 'Resolve TranscribeAudio failed.' };
    }
}

function handleListPlans() {
    return listCutPlans();
}

function handleGetPlan(_event, id) {
    return getCutPlan(id);
}

function handleDeletePlan(_event, id) {
    return deleteCutPlan(id);
}

function setupRoughCutHandlers(ipcMain) {
    ipcMain.handle('roughCut:getSelectedMedia', handleGetSelectedMedia);
    ipcMain.handle('roughCut:importTranscript', handleImportTranscript);
    ipcMain.handle('roughCut:buildCutPlan', handleBuildCutPlan);
    ipcMain.handle('roughCut:buildShortsPlan', handleBuildShortsPlan);
    ipcMain.handle('roughCut:validateCutPlan', handleValidateCutPlan);
    ipcMain.handle('roughCut:validateShortsPlan', handleValidateShortsPlan);
    ipcMain.handle('roughCut:applyCutPlan', handleApplyCutPlan);
    ipcMain.handle('roughCut:applyShortsPlan', handleApplyShortsPlan);
    ipcMain.handle('roughCut:exportIntelliScript', handleExportIntelliScript);
    ipcMain.handle('roughCut:detectFeatures', detectResolveFeatures);
    ipcMain.handle('roughCut:prepareNativeIntelliScript', handlePrepareNativeIntelliScript);
    ipcMain.handle('roughCut:listPlans', handleListPlans);
    ipcMain.handle('roughCut:getPlan', handleGetPlan);
    ipcMain.handle('roughCut:deletePlan', handleDeletePlan);
}

module.exports = {
    DEFAULT_MIN_KEEP_SECONDS,
    INTELLISCRIPT_FALLBACK_MESSAGE,
    handleApplyShortsPlan,
    handleBuildShortsPlan,
    handleGetSelectedMedia,
    handleImportTranscript,
    handleTranscribeSelectedMedia,
    handleValidateShortsPlan,
    buildClipInfos,
    buildCutPlanPrompt,
    buildDryRunSummary,
    buildIntelliScriptText,
    buildShortsPrompt,
    buildShortsPlatformChecks,
    buildShortsPublishPackage,
    buildTranscriptHash,
    chunkTranscript,
    deleteCutPlan,
    detectTranscriptOffsetSeconds,
    fitRangesToTarget,
    formatTimestamp,
    getCutPlan,
    listCutPlans,
    makeTimelineName,
    makeShortTimelineName,
    mergeRanges,
    normalizeRanges,
    parseCutPlanJson,
    publicSelectedMediaResult,
    normalizeRubricScores,
    normalizeWhyThisWorks,
    parseTimestamp,
    parseTimestampedTxt,
    parseTranscriptText,
    removeToKeep,
    saveCutPlan,
    secondsToSourceFrameRange,
    setupRoughCutHandlers,
    summarizeAppendResult,
    validateCutPlan,
    validateShortsPlan
};
