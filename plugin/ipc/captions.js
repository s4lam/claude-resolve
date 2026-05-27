const fs = require('fs');

function parseTimecode(value) {
    const match = String(value || '').trim().match(/(?:(\d+):)?(\d{2}):(\d{2})[,.](\d{3})/);
    if (!match) return 0;
    const hours = Number(match[1] || 0);
    const minutes = Number(match[2] || 0);
    const seconds = Number(match[3] || 0);
    const ms = Number(match[4] || 0);
    return hours * 3600 + minutes * 60 + seconds + ms / 1000;
}

function parseCaptionText(text, format = 'srt') {
    const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
    if (!normalized) return [];

    const blocks = normalized
        .replace(/^WEBVTT[^\n]*\n+/i, '')
        .split(/\n{2,}/)
        .map(block => block.trim())
        .filter(Boolean);

    const cues = [];
    for (const block of blocks) {
        const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
        const timingIndex = lines.findIndex(line => line.includes('-->'));
        if (timingIndex === -1) continue;
        const [startRaw, endRaw] = lines[timingIndex].split('-->').map(part => part.trim().split(/\s+/)[0]);
        const cueText = lines.slice(timingIndex + 1).join(' ').replace(/<[^>]+>/g, '').trim();
        if (!cueText) continue;
        cues.push({
            index: cues.length + 1,
            start: parseTimecode(startRaw),
            end: parseTimecode(endRaw),
            text: cueText,
            format
        });
    }
    return cues;
}

function buildCaptionPrompt({ cues = [], style = 'clean', width = 1920, height = 1080, fps = 25 } = {}) {
    const limited = cues.slice(0, 120);
    const cueLines = limited.map(cue => `[${cue.start.toFixed(3)}-${cue.end.toFixed(3)}] ${cue.text}`).join('\n');
    return [
        `Create animated captions as a transparent ProRes 4444 overlay.`,
        `Style: ${style}.`,
        `Canvas: ${width}x${height} at ${fps}fps.`,
        'Use window.renderFrame(frame, fps) and window.getAnimationDuration().',
        'Respect exact cue timing. Keep captions readable and inside safe margins.',
        'If style is karaoke, highlight the active words over time. If style is kinetic, animate phrases without hurting readability.',
        '',
        '<caption_cues>',
        cueLines,
        '</caption_cues>'
    ].join('\n');
}

async function handleImportCaptions(_event, payload = {}) {
    let filePath = payload.path;
    if (!filePath) {
        const { dialog } = require('electron');
        const result = await dialog.showOpenDialog({
            title: 'Import captions',
            properties: ['openFile'],
            filters: [{ name: 'Captions', extensions: ['srt', 'vtt'] }]
        });
        if (result.canceled || !result.filePaths[0]) return { success: true, cues: [], prompt: '' };
        filePath = result.filePaths[0];
    }

    const text = fs.readFileSync(filePath, 'utf8');
    const format = filePath.toLowerCase().endsWith('.vtt') ? 'vtt' : 'srt';
    const cues = parseCaptionText(text, format);
    return { success: true, filePath, format, cues };
}

function handleGenerateCaptions(_event, payload = {}) {
    return { success: true, prompt: buildCaptionPrompt(payload) };
}

function setupCaptionHandlers(ipcMain) {
    ipcMain.handle('captions:import', handleImportCaptions);
    ipcMain.handle('captions:generate', handleGenerateCaptions);
}

module.exports = {
    buildCaptionPrompt,
    parseCaptionText,
    parseTimecode,
    setupCaptionHandlers
};
