const fs = require('fs');
const path = require('path');
const { execFileSync, execSync } = require('child_process');
const { normalizeRenderSettings } = require('./render-settings');
const {
    FFMPEG_CANDIDATES,
    FFMPEG_VERIFY_CMD,
    PLAYWRIGHT_BROWSERS_PATH,
    RENDER_DIR
} = require('./paths');

const REQUIRED_ENCODERS = ['prores_ks', 'libx264'];
const OPTIONAL_ENCODERS = ['hevc_nvenc', 'hevc_videotoolbox'];

let lastRenderError = null;

function rendererRoot() {
    return path.join(__dirname, '..', 'renderer');
}

function bundledFfmpegPath() {
    try {
        const modulePath = require.resolve('ffmpeg-static', { paths: [rendererRoot()] });
        const candidate = require(modulePath);
        return candidate && fs.existsSync(candidate) ? candidate : null;
    } catch {
        return null;
    }
}

function executableWorks(candidate, execFile = execFileSync) {
    if (!candidate) return false;
    try {
        execFile(candidate, ['-version'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] });
        return true;
    } catch {
        return false;
    }
}

function shellLookup(verifyCmd = FFMPEG_VERIFY_CMD, exec = execSync) {
    try {
        const out = exec(verifyCmd, { encoding: 'utf8', shell: true, timeout: 5000 }).trim();
        return out.split(/\r?\n/).map(line => line.trim()).find(Boolean) || null;
    } catch {
        return null;
    }
}

function resolveFfmpegPath(config = {}, options = {}) {
    const render = config.render || {};
    const exists = options.existsSync || fs.existsSync;
    const probe = options.probeExecutable || ((candidate) => executableWorks(candidate, options.execFileSync || execFileSync));
    const attempts = [];

    function tryCandidate(candidate, source, requireExists = true) {
        if (!candidate) return null;
        attempts.push({ path: candidate, source });
        if (requireExists && !exists(candidate)) return null;
        return probe(candidate) ? { path: candidate, source, attempts } : null;
    }

    const configured = String(render.ffmpegPath || '').trim();
    const configuredResult = tryCandidate(configured, 'config', true);
    if (configuredResult) return configuredResult;

    const staticCandidate = options.bundledPath !== undefined ? options.bundledPath : bundledFfmpegPath();
    const staticResult = tryCandidate(staticCandidate, 'bundled', true);
    if (staticResult) return staticResult;

    for (const candidate of options.candidates || FFMPEG_CANDIDATES) {
        const absolute = path.isAbsolute(candidate);
        const result = tryCandidate(candidate, absolute ? 'known-path' : 'path', absolute);
        if (result) return result;
    }

    const shellCandidate = options.shellCandidate !== undefined
        ? options.shellCandidate
        : shellLookup(options.verifyCmd || FFMPEG_VERIFY_CMD, options.execSync || execSync);
    const shellResult = tryCandidate(shellCandidate, 'shell', Boolean(shellCandidate && path.isAbsolute(shellCandidate)));
    if (shellResult) return shellResult;

    return {
        path: null,
        source: null,
        attempts,
        error: 'FFmpeg was not found. Install dependencies again or set Settings > Render > FFmpeg path.'
    };
}

function ffmpegVersion(ffmpegPath, execFile = execFileSync) {
    try {
        const out = execFile(ffmpegPath, ['-version'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] });
        return out.split(/\r?\n/)[0] || '';
    } catch {
        return '';
    }
}

function parseEncoderSupport(output = '', names = [...REQUIRED_ENCODERS, ...OPTIONAL_ENCODERS]) {
    const result = {};
    for (const name of names) {
        result[name] = new RegExp(`(^|\\s)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`, 'm').test(output);
    }
    return result;
}

function probeEncoders(ffmpegPath, execFile = execFileSync) {
    try {
        const out = execFile(ffmpegPath, ['-hide_banner', '-encoders'], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] });
        return parseEncoderSupport(out);
    } catch {
        return parseEncoderSupport('');
    }
}

function renderFolderHealth(renderDir = RENDER_DIR) {
    try {
        fs.mkdirSync(renderDir, { recursive: true });
        const probeFile = path.join(renderDir, `.write-test-${Date.now()}`);
        fs.writeFileSync(probeFile, 'ok');
        fs.rmSync(probeFile, { force: true });
        return { writable: true, path: renderDir };
    } catch (err) {
        return { writable: false, path: renderDir, error: err.message };
    }
}

function findPlaywrightChromiumExecutable(options = {}) {
    const browsersPath = options.browsersPath || PLAYWRIGHT_BROWSERS_PATH;
    const platform = options.platform || process.platform;
    const exists = options.existsSync || fs.existsSync;
    const readdir = options.readdirSync || fs.readdirSync;
    const stat = options.statSync || fs.statSync;
    if (!browsersPath || !exists(browsersPath)) return null;

    const wanted = platform === 'win32'
        ? ['chrome-headless-shell.exe', 'chrome.exe']
        : platform === 'darwin'
            ? ['Chromium', 'Google Chrome for Testing', 'chrome-headless-shell', 'chrome']
            : ['chrome-headless-shell', 'chrome', 'chromium'];

    function findInDir(dir, depth = 0, visited = { count: 0 }) {
        if (depth > 7 || visited.count > 2400) return null;
        let entries = [];
        try {
            entries = readdir(dir, { withFileTypes: true });
        } catch {
            return null;
        }
        visited.count += entries.length;

        for (const name of wanted) {
            const match = entries.find(entry => entry.isFile?.() && entry.name === name);
            if (match) return path.join(dir, match.name);
        }

        const dirs = entries
            .filter(entry => entry.isDirectory?.())
            .sort((a, b) => {
                const ah = a.name.includes('headless') ? -1 : 0;
                const bh = b.name.includes('headless') ? -1 : 0;
                return ah - bh || a.name.localeCompare(b.name);
            });

        for (const entry of dirs) {
            const full = path.join(dir, entry.name);
            try {
                if (!stat(full).isDirectory()) continue;
            } catch {
                continue;
            }
            const found = findInDir(full, depth + 1, visited);
            if (found) return found;
        }
        return null;
    }

    let roots = [];
    try {
        roots = readdir(browsersPath, { withFileTypes: true })
            .filter(entry => entry.isDirectory?.() && entry.name.startsWith('chromium'))
            .sort((a, b) => {
                const ah = a.name.includes('headless') ? -1 : 0;
                const bh = b.name.includes('headless') ? -1 : 0;
                return ah - bh || a.name.localeCompare(b.name);
            })
            .map(entry => path.join(browsersPath, entry.name));
    } catch {
        return null;
    }

    for (const root of roots) {
        const found = findInDir(root);
        if (found && exists(found)) return found;
    }
    return null;
}

function playwrightHealth() {
    const modulePath = path.join(rendererRoot(), 'node_modules', 'playwright');
    let chromiumPath = null;
    let reportedChromiumPath = null;
    let fallbackChromiumPath = null;
    let chromiumInstalled = false;
    let error = null;
    try {
        const playwrightPath = require.resolve('playwright', { paths: [rendererRoot()] });
        const { chromium } = require(playwrightPath);
        reportedChromiumPath = chromium.executablePath();
        if (reportedChromiumPath && fs.existsSync(reportedChromiumPath)) {
            chromiumPath = reportedChromiumPath;
        } else {
            fallbackChromiumPath = findPlaywrightChromiumExecutable();
            chromiumPath = fallbackChromiumPath;
        }
        chromiumInstalled = Boolean(chromiumPath && fs.existsSync(chromiumPath));
    } catch (err) {
        error = err.message;
    }
    return {
        installed: fs.existsSync(modulePath),
        ready: fs.existsSync(modulePath) && chromiumInstalled,
        chromiumPath,
        reportedChromiumPath,
        fallbackChromiumPath,
        chromiumInstalled,
        error,
        browsersPath: PLAYWRIGHT_BROWSERS_PATH,
        browsersPathExists: fs.existsSync(PLAYWRIGHT_BROWSERS_PATH)
    };
}

function preferredHevcEncoder(platform = process.platform) {
    return platform === 'darwin' ? 'hevc_videotoolbox' : 'hevc_nvenc';
}

function summarizeRenderHealth(health = {}, platform = process.platform) {
    const failures = [];
    const warnings = [];
    const gpuEncoder = preferredHevcEncoder(platform);

    if (!health.ffmpeg?.path) {
        failures.push(health.ffmpeg?.error || 'FFmpeg was not found.');
    }
    if (!health.encoders?.prores_ks) {
        failures.push('FFmpeg encoder prores_ks is missing. ProRes MOV renders will fail.');
    }
    if (!health.encoders?.libx264) {
        failures.push('FFmpeg encoder libx264 is missing. CPU MP4 renders will fail.');
    }
    if (!health.renderFolder?.writable) {
        failures.push(`Render folder is not writable: ${health.renderFolder?.error || health.renderFolder?.path || 'unknown path'}`);
    }
    if (!(health.playwright?.ready ?? health.playwright?.installed)) {
        failures.push('Playwright Chromium is missing. Run npx playwright install chromium in plugin/renderer.');
    }
    if (!health.encoders?.[gpuEncoder]) {
        warnings.push(`Optional GPU MP4 encoder ${gpuEncoder} is unavailable. Resolve AI will fall back to CPU MP4.`);
    }

    return {
        ok: failures.length === 0,
        failures,
        warnings,
        gpuEncoder,
        fix: platform === 'darwin'
            ? 'Re-run the installer with internet access. Fallback: brew install ffmpeg.'
            : 'Re-run the installer with internet access. Fallback: winget install Gyan.FFmpeg.'
    };
}

function applyRenderHealthFallback(settings = {}, health = {}, platform = process.platform) {
    const normalized = normalizeRenderSettings(settings);
    const encoder = preferredHevcEncoder(platform);
    if (normalized.outputFormat !== 'hevc_nvenc_hq') {
        return { settings: normalized, warnings: [], hevcEncoder: null, fallback: false };
    }
    if (health.encoders?.[encoder]) {
        return { settings: normalized, warnings: [], hevcEncoder: encoder, fallback: false };
    }
    return {
        settings: normalizeRenderSettings({ renderPreset: 'mp4_cpu_quality', outputFormat: 'h264', proxyEncoder: 'libx264' }),
        warnings: [`GPU HEVC encoder ${encoder} is unavailable. Rendering CPU MP4 instead.`],
        hevcEncoder: null,
        fallback: true
    };
}

function friendlyRenderError(message = '') {
    const text = String(message || '');
    const lower = text.toLowerCase();
    if (/enoent|not found|failed to spawn/.test(lower) && /ffmpeg/.test(lower)) {
        return 'FFmpeg could not be started. Re-run the installer or set Settings > Render > FFmpeg path.';
    }
    if (/unknown encoder|encoder.*not found|cannot find.*encoder/.test(lower)) {
        return 'The selected FFmpeg encoder is not available on this machine. Use ProRes MOV or CPU MP4, or install a full FFmpeg build.';
    }
    if (/permission denied|access is denied|operation not permitted/.test(lower)) {
        return 'Resolve AI cannot write to the render folder. Choose a writable folder or fix folder permissions.';
    }
    if (/playwright|chromium|browser executable/.test(lower)) {
        return 'Playwright Chromium is missing or cannot start. Re-run the installer so the renderer browser is installed.';
    }
    if (/no such file or directory|cannot open|unable to open/.test(lower) && /output|mov|mp4/.test(lower)) {
        return 'FFmpeg could not create the output file. Check the render folder path and filename.';
    }
    if (/no output file|output file was created|invalid argument/.test(lower) && /render|output|mov|mp4/.test(lower)) {
        return 'Render finished without a usable output file. Check the output path, render folder permissions, and selected preset.';
    }
    if (/alpha|yuva|prores/.test(lower) && /mp4/.test(lower)) {
        return 'MP4 does not preserve transparent alpha. Use ProRes MOV for transparent overlays.';
    }
    return text || 'Render failed.';
}

function getRenderHealth(config = {}, options = {}) {
    const resolved = resolveFfmpegPath(config, options);
    const encoders = resolved.path ? probeEncoders(resolved.path, options.execFileSync || execFileSync) : parseEncoderSupport('');
    const folder = renderFolderHealth(options.renderDir || RENDER_DIR);
    const playwright = options.playwrightHealth ? options.playwrightHealth() : playwrightHealth();
    const missingRequired = REQUIRED_ENCODERS.filter(name => !encoders[name]);
    const health = {
        ready: Boolean(resolved.path && !missingRequired.length && folder.writable && (playwright.ready ?? playwright.installed)),
        ffmpeg: {
            path: resolved.path,
            source: resolved.source,
            version: resolved.path ? ffmpegVersion(resolved.path, options.execFileSync || execFileSync) : '',
            error: resolved.error || null,
            attempts: resolved.attempts || []
        },
        encoders,
        requiredEncoders: REQUIRED_ENCODERS,
        optionalEncoders: OPTIONAL_ENCODERS,
        missingRequiredEncoders: missingRequired,
        renderFolder: folder,
        playwright
    };
    health.summary = summarizeRenderHealth(health, options.platform || process.platform);
    return health;
}

function setLastRenderError(error) {
    lastRenderError = error ? { ...error, at: new Date().toISOString() } : null;
}

function getLastRenderError() {
    return lastRenderError;
}

module.exports = {
    REQUIRED_ENCODERS,
    OPTIONAL_ENCODERS,
    applyRenderHealthFallback,
    friendlyRenderError,
    findPlaywrightChromiumExecutable,
    getLastRenderError,
    getRenderHealth,
    parseEncoderSupport,
    preferredHevcEncoder,
    resolveFfmpegPath,
    setLastRenderError,
    summarizeRenderHealth
};
