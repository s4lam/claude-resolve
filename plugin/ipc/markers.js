const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { CONFIG_DIR } = require('./paths');
const { getCurrentProject } = require('./resolve');

const MARKER_DIR = path.join(CONFIG_DIR, 'review-markers');

const TAG_COLORS = {
    hook: 'Green',
    payoff: 'Blue',
    funny: 'Yellow',
    important: 'Cyan',
    cut: 'Red',
    caption: 'Purple',
    'needs review': 'Orange',
    review: 'Orange'
};

function ensureDir(dir = MARKER_DIR) {
    fs.mkdirSync(dir, { recursive: true });
}

function normalizeMarker(payload = {}, options = {}) {
    const tags = Array.isArray(payload.tags)
        ? payload.tags.map(tag => String(tag).trim().toLowerCase()).filter(Boolean)
        : String(payload.tags || '').split(',').map(tag => tag.trim().toLowerCase()).filter(Boolean);
    const fps = Number(payload.fps || options.fps || 30) || 30;
    const seconds = Number(payload.seconds ?? payload.start ?? payload.time ?? 0);
    const frame = Number.isFinite(Number(payload.frame))
        ? Math.max(0, Math.round(Number(payload.frame)))
        : Math.max(0, Math.round((Number.isFinite(seconds) ? seconds : 0) * fps));
    const firstTag = tags.find(tag => TAG_COLORS[tag]);
    const color = payload.color || TAG_COLORS[firstTag] || 'Cyan';
    const name = String(payload.name || payload.title || payload.label || firstTag || 'Resolve AI Review').slice(0, 120);
    const note = String(payload.note || payload.reason || payload.comment || payload.description || '').slice(0, 1000);
    const duration = Math.max(1, Math.round(Number(payload.durationFrames || payload.duration || 1) || 1));
    return {
        frame,
        color,
        name,
        note,
        duration,
        tags,
        customData: JSON.stringify({
            source: 'Resolve AI',
            tags,
            confidence: Number.isFinite(Number(payload.confidence)) ? Number(payload.confidence) : null
        })
    };
}

function normalizeMarkers(markers = [], options = {}) {
    return (Array.isArray(markers) ? markers : []).map(marker => normalizeMarker(marker, options));
}

async function addTimelineMarkers(markers = [], options = {}) {
    const project = await getCurrentProject();
    const timeline = project?.GetCurrentTimeline ? await project.GetCurrentTimeline() : null;
    if (!timeline?.AddMarker) {
        return { success: false, added: 0, reason: 'Current timeline does not expose AddMarker.' };
    }
    const normalized = normalizeMarkers(markers, options);
    let added = 0;
    const failures = [];
    for (const marker of normalized) {
        try {
            const ok = await timeline.AddMarker(marker.frame, marker.color, marker.name, marker.note, marker.duration, marker.customData);
            if (ok !== false) added += 1;
        } catch (error) {
            failures.push(`${marker.name}: ${error.message || error}`);
        }
    }
    return { success: failures.length === 0, added, failures, markers: normalized };
}

function markerReportText(markers = [], metadata = {}) {
    const normalized = normalizeMarkers(markers, metadata);
    return [
        '# Resolve AI Review Markers',
        '',
        `Created: ${new Date().toISOString()}`,
        metadata.projectName ? `Project: ${metadata.projectName}` : '',
        metadata.timelineName ? `Timeline: ${metadata.timelineName}` : '',
        '',
        ...normalized.map(marker => [
            `## ${marker.name}`,
            `Frame: ${marker.frame}`,
            `Color: ${marker.color}`,
            marker.tags.length ? `Tags: ${marker.tags.join(', ')}` : '',
            marker.note ? `Note: ${marker.note}` : ''
        ].filter(Boolean).join('\n'))
    ].filter(line => line !== '').join('\n');
}

function exportMarkerReport(payload = {}, dir = MARKER_DIR) {
    ensureDir(dir);
    const id = payload.id || `markers-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
    const filePath = path.join(dir, `${id}.md`);
    fs.writeFileSync(filePath, markerReportText(payload.markers || [], payload.metadata || payload), 'utf8');
    return { success: true, id, filePath };
}

function setupMarkerHandlers(ipcMain) {
    ipcMain.handle('markers:normalize', (_event, payload = {}) => ({
        success: true,
        markers: normalizeMarkers(payload.markers || [], payload)
    }));
    ipcMain.handle('markers:addReviewMarkers', (_event, payload = {}) => addTimelineMarkers(payload.markers || [], payload));
    ipcMain.handle('markers:exportReport', (_event, payload = {}) => exportMarkerReport(payload));
}

module.exports = {
    TAG_COLORS,
    addTimelineMarkers,
    exportMarkerReport,
    markerReportText,
    normalizeMarker,
    normalizeMarkers,
    setupMarkerHandlers
};
