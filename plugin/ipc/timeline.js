const { readConfig } = require('./config');

function getResolveApi() {
    return require('./resolve');
}

function timecodeToSeconds(value, fps = 25) {
    const parts = String(value || '').replace(';', ':').split(':').map(Number);
    if (parts.length !== 4 || parts.some(Number.isNaN)) return null;
    return parts[0] * 3600 + parts[1] * 60 + parts[2] + (parts[3] / (Number(fps) || 25));
}

function secondsToTimecode(seconds, fps = 25) {
    const rate = Number(fps) || 25;
    const totalFrames = Math.max(0, Math.round(Number(seconds || 0) * rate));
    const hours = Math.floor(totalFrames / (rate * 3600));
    const minutes = Math.floor((totalFrames / (rate * 60)) % 60);
    const wholeSeconds = Math.floor((totalFrames / rate) % 60);
    const frames = totalFrames % rate;
    return [hours, minutes, wholeSeconds, frames]
        .map(value => String(value).padStart(2, '0'))
        .join(':');
}

function normalizeTimelineContext(raw = {}, fallback = {}) {
    const fps = Number(raw.fps || fallback.fps) || null;
    const width = Number(raw.width || fallback.width) || null;
    const height = Number(raw.height || fallback.height) || null;
    const playheadSeconds = raw.playheadSeconds !== undefined && raw.playheadSeconds !== null
        ? Number(raw.playheadSeconds)
        : timecodeToSeconds(raw.currentTimecode, fps || 25);
    return {
        available: Boolean(raw.available),
        projectName: raw.projectName || null,
        timelineName: raw.timelineName || raw.name || null,
        page: raw.page || null,
        fps,
        width,
        height,
        durationSeconds: raw.durationSeconds !== undefined && raw.durationSeconds !== null ? Number(raw.durationSeconds) : null,
        currentTimecode: raw.currentTimecode || null,
        playheadSeconds,
        playheadFrame: playheadSeconds !== null && fps ? Math.round(playheadSeconds * fps) : null,
        selectedClips: normalizeSelectedClips(raw.selectedClips),
        markers: normalizeMarkers(raw.markers, { fps, playheadFrame: playheadSeconds !== null && fps ? Math.round(playheadSeconds * fps) : null }),
        unavailable: Array.isArray(raw.unavailable) ? raw.unavailable : []
    };
}

function normalizeClip(raw = {}) {
    if (!raw || typeof raw !== 'object') return null;
    const name = raw.name || raw['Clip Name'] || raw['File Name'] || raw.fileName || raw.type || null;
    if (!name && Object.keys(raw).length === 0) return null;
    const startFrame = Number(raw.startFrame ?? raw.start ?? raw.Start) || null;
    const endFrame = Number(raw.endFrame ?? raw.end ?? raw.End) || null;
    return {
        name,
        fileName: raw.fileName || raw['File Name'] || null,
        mediaType: raw.mediaType || raw['Type'] || raw.type || null,
        startFrame,
        endFrame,
        durationFrames: Number(raw.durationFrames ?? raw.duration ?? raw.Duration) || (startFrame !== null && endFrame !== null ? endFrame - startFrame : null),
        trackIndex: Number(raw.trackIndex ?? raw.track ?? raw.Track) || null
    };
}

function normalizeSelectedClips(value) {
    const items = Array.isArray(value)
        ? value
        : value && typeof value === 'object'
            ? Object.values(value)
            : [];
    return items.map(normalizeClip).filter(Boolean).slice(0, 6);
}

function inferMarkerAction(marker = {}) {
    const text = [marker.name, marker.note, marker.customData].filter(Boolean).join(' ').toLowerCase();
    if (/\b(lower|lower[-\s]?third|speaker|nameplate|name plate|location)\b/.test(text)) return 'lower-third';
    if (/\b(transition|wipe|bridge|cut|stinger|interstitial)\b/.test(text)) return 'transition';
    return 'title';
}

function normalizeMarker(frameId, raw = {}, options = {}) {
    if (!raw || typeof raw !== 'object') return null;
    const fps = Number(options.fps) || 25;
    const frame = Number(raw.frameId ?? raw.frame ?? frameId);
    if (!Number.isFinite(frame)) return null;
    const seconds = frame / fps;
    const durationFrames = Number(raw.duration ?? raw.Duration ?? raw.durationFrames ?? 0) || 0;
    const marker = {
        frame,
        seconds,
        timecode: secondsToTimecode(seconds, fps),
        name: raw.name || raw.Name || raw.markerName || `Marker ${frame}`,
        note: raw.note || raw.Note || raw.notes || '',
        color: raw.color || raw.Color || '',
        durationFrames,
        customData: raw.customData || raw.CustomData || raw.custom_data || ''
    };
    return {
        ...marker,
        action: inferMarkerAction(marker),
        distanceFromPlayhead: Number.isFinite(options.playheadFrame) ? Math.abs(frame - options.playheadFrame) : null
    };
}

function normalizeMarkers(value, options = {}) {
    const entries = Array.isArray(value)
        ? value.map((item, index) => [item.frameId ?? item.frame ?? index, item])
        : value && typeof value === 'object'
            ? Object.entries(value)
            : [];
    return entries
        .map(([frameId, marker]) => normalizeMarker(frameId, marker, options))
        .filter(Boolean)
        .sort((a, b) => {
            if (a.distanceFromPlayhead !== null && b.distanceFromPlayhead !== null) {
                return a.distanceFromPlayhead - b.distanceFromPlayhead;
            }
            return a.frame - b.frame;
        })
        .slice(0, 8);
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

async function readClipInfo(clip, unavailable) {
    if (!clip) return null;
    const props = await safeCall('clip properties', () => (
        typeof clip.GetClipProperty === 'function' ? clip.GetClipProperty() : null
    ), unavailable, {});
    const name = await safeCall('clip name', async () => {
        if (typeof clip.GetName === 'function') return clip.GetName();
        return props?.['Clip Name'] || props?.['File Name'] || props?.Name || null;
    }, unavailable, null);
    const [startFrame, endFrame, durationFrames] = await Promise.all([
        safeCall('clip start', () => typeof clip.GetStart === 'function' ? clip.GetStart() : null, unavailable, null),
        safeCall('clip end', () => typeof clip.GetEnd === 'function' ? clip.GetEnd() : null, unavailable, null),
        safeCall('clip duration', () => typeof clip.GetDuration === 'function' ? clip.GetDuration() : null, unavailable, null)
    ]);
    return normalizeClip({
        name,
        fileName: props?.['File Name'],
        mediaType: props?.Type || props?.['Media Type'],
        startFrame,
        endFrame,
        durationFrames
    });
}

async function getSelectedClips(timeline, unavailable) {
    if (!timeline) return [];
    const selectedMethods = ['GetSelectedItems', 'GetSelectedClips', 'GetSelectedTimelineItems'];
    for (const method of selectedMethods) {
        if (typeof timeline[method] !== 'function') continue;
        const clips = normalizeCollection(await safeCall('selected clips', () => timeline[method](), unavailable, []));
        if (clips.length > 0) {
            const infos = [];
            for (const clip of clips.slice(0, 6)) {
                const info = await readClipInfo(clip, unavailable);
                if (info) infos.push(info);
            }
            if (infos.length > 0) return infos;
        }
    }

    for (const method of ['GetCurrentVideoItem', 'GetCurrentClip']) {
        if (typeof timeline[method] !== 'function') continue;
        const clip = await safeCall('current clip', () => timeline[method](), unavailable, null);
        const info = await readClipInfo(clip, unavailable);
        if (info) return [info];
    }
    unavailable.push('selected clip');
    return [];
}

async function getTimelineContext() {
    const { handleGetProjectName, handleGetCurrentPage, handleGetTimelineSettings, getCurrentProject } = getResolveApi();
    const cfg = readConfig();
    const unavailable = [];
    const settings = await safeCall('timeline settings', handleGetTimelineSettings, unavailable, null);
    const projectName = await safeCall('project name', handleGetProjectName, unavailable, null);
    const page = await safeCall('current page', handleGetCurrentPage, unavailable, null);

    let currentTimecode = null;
    let durationSeconds = null;
    let selectedClips = [];
    let markers = [];
    try {
        const project = await getCurrentProject();
        const timeline = project ? await project.GetCurrentTimeline() : null;
        if (timeline) {
            currentTimecode = await safeCall('playhead timecode', () => timeline.GetCurrentTimecode(), unavailable, null);
            const endFrame = await safeCall('timeline end frame', () => timeline.GetEndFrame(), unavailable, null);
            const fps = Number(settings?.fps || cfg.fps) || 25;
            if (Number(endFrame)) durationSeconds = Number(endFrame) / fps;
            selectedClips = await getSelectedClips(timeline, unavailable);
            if (typeof timeline.GetMarkers === 'function') {
                markers = await safeCall('timeline markers', () => timeline.GetMarkers(), unavailable, []);
            }
        } else {
            unavailable.push('active timeline');
        }
    } catch {
        unavailable.push('timeline details');
    }

    return normalizeTimelineContext({
        available: Boolean(settings),
        projectName,
        page,
        timelineName: settings?.name,
        fps: settings?.fps,
        width: settings?.width,
        height: settings?.height,
        currentTimecode,
        durationSeconds,
        selectedClips,
        markers,
        unavailable
    }, cfg);
}

function typeLabel(type) {
    if (type === 'lower-third') return 'Lower third';
    if (type === 'transition') return 'Transition';
    if (type === 'rerender') return 'Re-render';
    if (type === 'marker') return 'Marker';
    return 'Title';
}

function markerLines(marker) {
    if (!marker) return [];
    return [
        `Marker: ${marker.name || 'Untitled marker'}`,
        marker.timecode ? `Timecode: ${marker.timecode}` : null,
        marker.color ? `Color: ${marker.color}` : null,
        marker.note ? `Note: ${marker.note}` : null,
        marker.customData ? `Custom data: ${marker.customData}` : null,
        marker.action ? `Suggested action: ${typeLabel(marker.action)}` : null
    ].filter(Boolean);
}

function buildTimelinePrompt({ type = 'title', context = {}, render = null, marker = null } = {}) {
    const promptType = type === 'marker' && marker ? inferMarkerAction(marker) : type;
    const label = marker ? `Marker ${marker.name || typeLabel(promptType)}` : typeLabel(promptType);
    const fps = context.fps || 25;
    const width = context.width || 1920;
    const height = context.height || 1080;
    const placement = marker?.timecode
        ? `Place timing around marker ${marker.timecode}.`
        : context.currentTimecode
        ? `Place timing around playhead ${context.currentTimecode}.`
        : 'Use the current playhead as the intended placement.';
    const clipLines = (context.selectedClips || []).map(clip => [
        `- ${clip.name || clip.fileName || 'Selected clip'}`,
        clip.fileName ? `file ${clip.fileName}` : null,
        clip.mediaType ? `type ${clip.mediaType}` : null,
        clip.startFrame !== null && clip.endFrame !== null ? `frames ${clip.startFrame}-${clip.endFrame}` : null
    ].filter(Boolean).join(' / '));
    const markerContext = markerLines(marker);

    if (promptType === 'rerender' && render) {
        const metadata = render.metadata || {};
        return [
            'Re-render this saved Resolve AI history item for the current DaVinci Resolve timeline.',
            placement,
            `Timeline: ${context.timelineName || 'Unavailable'}. Canvas: ${width}x${height} at ${fps}fps.`,
            markerContext.length ? `Marker context:\n${markerContext.join('\n')}` : '',
            clipLines.length ? `Selected clip context:\n${clipLines.join('\n')}` : 'Selected clip context unavailable.',
            '',
            `Original request: ${metadata.prompt || render.name}`,
            metadata.html ? 'Previous generated HTML:' : '',
            metadata.html ? '```html' : '',
            metadata.html || '',
            metadata.html ? '```' : '',
            '',
            'Return one complete replacement HTML file using the existing overlay contract.'
        ].filter(Boolean).join('\n');
    }

    const typeInstructions = {
        title: 'Create a polished title overlay that can be rendered and inserted at the playhead.',
        'lower-third': 'Create a clean lower third overlay for a speaker, subject, location, or segment label at the playhead.',
        transition: 'Create a transparent transition overlay that works as a short bridge at the playhead.'
    };

    return [
        `${typeInstructions[promptType] || typeInstructions.title}`,
        placement,
        `Timeline context: ${context.timelineName || 'Unavailable'} in project ${context.projectName || 'Unavailable'}.`,
        `Canvas: ${width}x${height}. FPS: ${fps}.`,
        context.durationSeconds ? `Timeline duration: about ${context.durationSeconds.toFixed(1)} seconds.` : 'Timeline duration unavailable.',
        markerContext.length ? `Marker context:\n${markerContext.join('\n')}` : 'Marker context unavailable.',
        clipLines.length ? `Selected clip context:\n${clipLines.join('\n')}` : 'Selected clip context unavailable.',
        'Use transparent ProRes 4444-safe output when this is an overlay or transition.',
        'Use window.renderFrame(frame, fps) and window.getAnimationDuration().',
        'Keep the design universal for creators, editors, businesses, podcasts, education, sports, music, or events.',
        '',
        `Return one complete HTML file for ${label.toLowerCase()} in the current timeline.`
    ].join('\n');
}

async function handleGenerateAtPlayhead(_event, payload = {}) {
    const context = payload.context || await getTimelineContext();
    const prompt = buildTimelinePrompt({ type: payload.type, context, render: payload.render, marker: payload.marker });
    return {
        success: true,
        prompt,
        displayText: payload.marker?.name ? `${typeLabel(payload.type)}: ${payload.marker.name}` : `${typeLabel(payload.type)} at playhead`,
        context
    };
}

function setupTimelineHandlers(ipcMain) {
    ipcMain.handle('timeline:getContext', getTimelineContext);
    ipcMain.handle('timeline:generateAtPlayhead', handleGenerateAtPlayhead);
}

module.exports = {
    buildTimelinePrompt,
    inferMarkerAction,
    normalizeClip,
    normalizeMarkers,
    normalizeSelectedClips,
    normalizeTimelineContext,
    secondsToTimecode,
    setupTimelineHandlers,
    timecodeToSeconds
};
