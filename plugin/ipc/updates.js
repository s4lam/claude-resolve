const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { version: CURRENT_VERSION } = require('../package.json');

const OWNER = 's4lam';
const REPO = 'resolve-ai';
const RELEASES_URL = `https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=10`;
const CACHE_TTL_MS = 60 * 60 * 1000;
const PLUGIN_ID = 'com.clauderesolve.plugin';
const REQUIRED_PLUGIN_FILES = [
    'manifest.xml',
    'main.js',
    'preload.js',
    path.join('dist', 'index.html'),
    path.join('renderer', 'render.js')
];
const UPDATE_STATES = {
    IDLE: 'idle',
    CHECKING: 'checking',
    DOWNLOADING: 'downloading',
    EXTRACTING: 'extracting',
    READY: 'ready-to-install',
    LAUNCHING: 'launching-installer',
    FAILED: 'failed'
};

let cached = null;
let mainWindowRef = null;
let updateStatus = {
    state: UPDATE_STATES.IDLE,
    current: CURRENT_VERSION,
    latest: null,
    hasUpdate: false,
    downloadedBytes: 0,
    totalBytes: 0,
    stageDir: null,
    error: null,
    instruction: null
};

function parseVersion(tag) {
    const cleaned = String(tag || '').replace(/^v/i, '').split('-')[0];
    const parts = cleaned.split('.').map(n => parseInt(n, 10)).filter(n => Number.isFinite(n));
    while (parts.length < 3) parts.push(0);
    return parts.slice(0, 3);
}

function normalizeVersion(tag) {
    return String(tag || '').trim().replace(/^v/i, '');
}

function isNewer(latest, current) {
    const a = parseVersion(latest);
    const b = parseVersion(current);
    for (let i = 0; i < 3; i++) {
        if (a[i] > b[i]) return true;
        if (a[i] < b[i]) return false;
    }
    return false;
}

function platformName(platform = process.platform) {
    if (platform === 'win32') return 'Windows';
    if (platform === 'darwin') return 'macOS';
    return platform;
}

function expectedAssetName(version, platform = process.platform) {
    const label = platformName(platform);
    if (!['Windows', 'macOS'].includes(label)) return null;
    return `ResolveAI-${label}-v${normalizeVersion(version)}.zip`;
}

function selectReleaseAsset(release, platform = process.platform) {
    const assets = Array.isArray(release?.assets) ? release.assets : [];
    const expected = expectedAssetName(release?.tag_name, platform);
    const exact = expected && assets.find(asset => String(asset?.name || '').toLowerCase() === expected.toLowerCase());
    if (exact) return exact;

    const label = platformName(platform);
    if (label === 'Windows' || label === 'macOS') {
        const platformPattern = new RegExp(`^ResolveAI-${label}-v.+\\.zip$`, 'i');
        return assets.find(asset => platformPattern.test(String(asset?.name || ''))) || null;
    }

    const platformZip = assets.find(asset => {
        const name = String(asset?.name || '');
        return name.endsWith('.zip') && name.includes(`ResolveAI-${label}-`);
    });
    if (platformZip) return platformZip;

    return assets.find(asset => String(asset?.name || '').endsWith('.zip')) || null;
}

function isPrivateIPv4(hostname) {
    const match = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(hostname);
    if (!match) return false;
    const octets = match.slice(1).map(Number);
    const [a, b] = octets;
    return a === 10
        || a === 127
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168)
        || (a === 169 && b === 254)
        || a === 0;
}

function isTrustedReleaseAssetUrl(rawUrl) {
    try {
        const parsed = new URL(rawUrl);
        const host = parsed.hostname.toLowerCase();
        if (parsed.protocol !== 'https:') return false;
        if (parsed.username || parsed.password) return false;
        if (host === 'localhost' || host === '::1' || isPrivateIPv4(host)) return false;
        return host === 'github.com'
            || host.endsWith('.github.com')
            || host === 'objects.githubusercontent.com'
            || host === 'release-assets.githubusercontent.com'
            || host === 'github-releases.githubusercontent.com';
    } catch {
        return false;
    }
}

function serializeStatus(patch = {}) {
    updateStatus = {
        ...updateStatus,
        ...patch,
        current: CURRENT_VERSION
    };
    return { ...updateStatus };
}

function emitStatus(patch) {
    const next = serializeStatus(patch);
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
        mainWindowRef.webContents.send('app:updateProgress', next);
    }
    return next;
}

function requestJson(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, {
            headers: { 'User-Agent': 'resolve-ai', 'Accept': 'application/vnd.github+json' },
            timeout: 10000
        }, (res) => {
            let body = '';
            res.on('data', (c) => body += c);
            res.on('end', () => {
                if (res.statusCode === 403) return reject(new Error('rate-limited'));
                if (res.statusCode === 404) return reject(new Error('no-releases'));
                if (res.statusCode !== 200) return reject(new Error('http-' + res.statusCode));
                try {
                    resolve(JSON.parse(body));
                } catch {
                    reject(new Error('bad-response'));
                }
            });
        });
        req.on('error', () => reject(new Error('offline')));
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
}

async function fetchLatestRelease(platform = process.platform) {
    const list = await requestJson(RELEASES_URL);
    if (!Array.isArray(list) || list.length === 0) throw new Error('no-releases');

    const rel = list.find(item => item && !item.draft);
    if (!rel) throw new Error('no-releases');
    const asset = selectReleaseAsset(rel, platform);
    if (asset && !isTrustedReleaseAssetUrl(asset.browser_download_url)) throw new Error('untrusted-release-url');

    return {
        tag: rel.tag_name,
        version: normalizeVersion(rel.tag_name),
        url: rel.html_url,
        platform: platformName(platform),
        assetName: asset?.name || null,
        assetUrl: asset?.browser_download_url || null,
        size: asset?.size || 0
    };
}

function updateRootForPlatform(platform = process.platform, env = process.env, home = os.homedir()) {
    if (platform === 'win32') {
        return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'ResolveAI', 'updates');
    }
    if (platform === 'darwin') {
        return path.join(home, 'Library', 'Application Support', 'ResolveAI', 'updates');
    }
    return path.join(home, '.local', 'share', 'ResolveAI', 'updates');
}

function installDestinationForPlatform(platform = process.platform) {
    if (platform === 'win32') {
        return path.join(
            process.env.PROGRAMDATA || 'C:\\ProgramData',
            'Blackmagic Design',
            'DaVinci Resolve',
            'Support',
            'Workflow Integration Plugins',
            PLUGIN_ID
        );
    }
    if (platform === 'darwin') {
        return path.join(
            '/Library',
            'Application Support',
            'Blackmagic Design',
            'DaVinci Resolve',
            'Workflow Integration Plugins',
            PLUGIN_ID
        );
    }
    return path.join(os.homedir(), '.resolve-ai', PLUGIN_ID);
}

function backupDestinationForPlatform(version, platform = process.platform) {
    const parent = path.dirname(installDestinationForPlatform(platform));
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return path.join(parent, `${PLUGIN_ID}.backup-${normalizeVersion(version)}-${stamp}`);
}

function ensureCleanDir(dir) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
}

function runCommand(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        execFile(command, args, { windowsHide: true, ...options }, (err, stdout, stderr) => {
            if (err) {
                const message = String(stderr || stdout || err.message || 'command-failed').trim();
                reject(new Error(message || 'command-failed'));
            } else {
                resolve({ stdout, stderr });
            }
        });
    });
}

function downloadFile(url, target, onProgress, redirectCount = 0) {
    if (!isTrustedReleaseAssetUrl(url)) return Promise.reject(new Error('untrusted-release-url'));
    if (redirectCount > 5) return Promise.reject(new Error('too-many-redirects'));

    return new Promise((resolve, reject) => {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const req = https.get(url, {
            headers: { 'User-Agent': 'resolve-ai' },
            timeout: 30000
        }, (res) => {
            if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
                res.resume();
                const nextUrl = new URL(res.headers.location, url).toString();
                downloadFile(nextUrl, target, onProgress, redirectCount + 1).then(resolve, reject);
                return;
            }
            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error('download-http-' + res.statusCode));
                return;
            }

            const totalBytes = Number(res.headers['content-length'] || 0);
            let downloadedBytes = 0;
            const file = fs.createWriteStream(target);
            res.on('data', chunk => {
                downloadedBytes += chunk.length;
                onProgress?.({ downloadedBytes, totalBytes });
            });
            res.pipe(file);
            file.on('finish', () => file.close(resolve));
            file.on('error', reject);
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('download-timeout')); });
    });
}

async function extractZip(zipPath, extractDir, platform = process.platform) {
    ensureCleanDir(extractDir);
    if (platform === 'win32') {
        await runCommand('powershell.exe', [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            'Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force',
            zipPath,
            extractDir
        ]);
        return;
    }
    if (platform === 'darwin') {
        await runCommand('/usr/bin/ditto', ['-x', '-k', zipPath, extractDir]);
        return;
    }
    await runCommand('unzip', ['-q', zipPath, '-d', extractDir]);
}

function hasRequiredPluginShape(pluginDir) {
    return REQUIRED_PLUGIN_FILES.every(file => fs.existsSync(path.join(pluginDir, file)));
}

function findStagedRoot(extractDir) {
    const rootPlugin = path.join(extractDir, 'plugin');
    if (hasRequiredPluginShape(rootPlugin)) return extractDir;

    const queue = [{ dir: extractDir, depth: 0 }];
    while (queue.length) {
        const { dir, depth } = queue.shift();
        const pluginDir = path.join(dir, 'plugin');
        if (hasRequiredPluginShape(pluginDir)) return dir;
        if (depth >= 3) continue;
        let entries = [];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') {
                queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
            }
        }
    }
    return null;
}

function validateStagedUpdate(stagedRoot, currentVersion = CURRENT_VERSION) {
    const pluginDir = path.join(stagedRoot, 'plugin');
    const missing = REQUIRED_PLUGIN_FILES
        .map(file => path.join('plugin', file))
        .filter(file => !fs.existsSync(path.join(stagedRoot, file)));
    if (missing.length > 0) {
        return { ok: false, error: 'missing: ' + missing.join(', ') };
    }

    const packagePath = path.join(pluginDir, 'package.json');
    if (!fs.existsSync(packagePath)) {
        return { ok: false, error: 'missing: plugin/package.json' };
    }

    try {
        const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
        if (!pkg.version) return { ok: false, error: 'missing package version' };
        if (!isNewer(pkg.version, currentVersion)) {
            return { ok: false, error: `version ${pkg.version} is not newer than ${currentVersion}` };
        }
        return { ok: true, version: pkg.version, pluginDir };
    } catch {
        return { ok: false, error: 'bad plugin/package.json' };
    }
}

function writeInstallPlan({ version, stageDir, pluginDir, platform = process.platform }) {
    const plan = {
        version,
        pluginSource: pluginDir,
        destination: installDestinationForPlatform(platform),
        backup: backupDestinationForPlatform(version, platform),
        platform,
        createdAt: new Date().toISOString(),
        preserves: ['Claude Resolve config folder', 'renders', 'assets']
    };
    const planPath = path.join(stageDir, 'install-plan.json');
    fs.writeFileSync(planPath, JSON.stringify(plan, null, 2), 'utf8');
    return { ...plan, planPath };
}

function quoteShell(value) {
    return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

function spawnDetachedLauncher(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        let settled = false;
        let child;
        try {
            child = spawn(command, args, {
                detached: true,
                stdio: 'ignore',
                ...options
            });
        } catch (err) {
            reject(err);
            return;
        }

        const done = (err) => {
            if (settled) return;
            settled = true;
            if (err) reject(err);
            else resolve(child);
        };

        child.once('error', done);
        child.once('exit', code => {
            if (!settled && code && code !== 0) done(new Error(`${command} exited with code ${code}`));
        });
        setTimeout(() => {
            if (!settled) {
                try { child.unref(); } catch {}
                done();
            }
        }, 700);
    });
}

async function launchWindowsHelper(helperPath, plan) {
    const args = [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        helperPath,
        '-Source',
        plan.pluginSource,
        '-Destination',
        plan.destination,
        '-Backup',
        plan.backup,
        '-ParentPid',
        String(process.pid)
    ];
    await spawnDetachedLauncher('powershell.exe', args, {
        windowsHide: false
    });
}

async function launchMacHelper(helperPath, plan) {
    fs.chmodSync(helperPath, 0o755);
    const command = [
        quoteShell(helperPath),
        '--source', quoteShell(plan.pluginSource),
        '--destination', quoteShell(plan.destination),
        '--backup', quoteShell(plan.backup),
        '--parent-pid', quoteShell(String(process.pid))
    ].join(' ');

    try {
        await spawnDetachedLauncher('osascript', [
            '-e',
            'tell application "Terminal"',
            '-e',
            `do script ${JSON.stringify(command)}`,
            '-e',
            'activate',
            '-e',
            'end tell'
        ]);
    } catch {
        await spawnDetachedLauncher('osascript', [
            '-e',
            `do shell script ${JSON.stringify(command)} with administrator privileges`
        ]);
    }
}

function helperPathForPlatform(platform = process.platform) {
    const helperName = platform === 'win32' ? 'install-update.ps1' : 'install-update.sh';
    return path.join(__dirname, '..', 'updater', helperName);
}

async function handleCheckUpdate(_event, opts) {
    const force = !!(opts && opts.force);
    const now = Date.now();
    if (!force && cached && (now - cached.at) < CACHE_TTL_MS) return cached.result;

    emitStatus({ state: UPDATE_STATES.CHECKING, error: null });
    try {
        const release = await fetchLatestRelease(process.platform);
        const result = {
            current: CURRENT_VERSION,
            latest: release.version,
            tag: release.tag,
            platform: release.platform || platformName(process.platform),
            hasUpdate: isNewer(release.version, CURRENT_VERSION),
            downloadUrl: release.url,
            assetName: release.assetName,
            assetUrl: release.assetUrl,
            size: release.size
        };
        cached = { at: now, result };
        emitStatus({
            state: UPDATE_STATES.IDLE,
            latest: result.latest,
            hasUpdate: result.hasUpdate,
            downloadUrl: result.downloadUrl,
            assetName: result.assetName,
            totalBytes: result.size || 0,
            error: null
        });
        return result;
    } catch (err) {
        emitStatus({ state: UPDATE_STATES.FAILED, error: err.message });
        return { current: CURRENT_VERSION, error: err.message };
    }
}

async function handleDownloadUpdate(_event, opts = {}) {
    try {
        const release = await fetchLatestRelease(process.platform);
        if (!isNewer(release.version, CURRENT_VERSION)) {
            const result = emitStatus({
                state: UPDATE_STATES.IDLE,
                latest: release.version,
                hasUpdate: false,
                error: null,
                instruction: 'Resolve AI is already up to date.'
            });
            return { success: false, ...result };
        }
        if (!release.assetUrl) throw new Error('missing-platform-release-zip');

        const stageDir = path.join(updateRootForPlatform(process.platform), release.version);
        const zipPath = path.join(stageDir, release.assetName || `ResolveAI-${release.version}.zip`);
        const extractDir = path.join(stageDir, 'extracted');
        ensureCleanDir(stageDir);

        emitStatus({
            state: UPDATE_STATES.DOWNLOADING,
            latest: release.version,
            hasUpdate: true,
            downloadUrl: release.url,
            assetName: release.assetName,
            stageDir,
            zipPath,
            downloadedBytes: 0,
            totalBytes: release.size || 0,
            error: null,
            instruction: null
        });

        await downloadFile(release.assetUrl, zipPath, progress => {
            emitStatus({
                state: UPDATE_STATES.DOWNLOADING,
                downloadedBytes: progress.downloadedBytes,
                totalBytes: progress.totalBytes || release.size || 0
            });
        });

        emitStatus({ state: UPDATE_STATES.EXTRACTING });
        await extractZip(zipPath, extractDir, process.platform);

        const stagedRoot = findStagedRoot(extractDir);
        if (!stagedRoot) throw new Error('missing: plugin/manifest.xml');

        const validation = validateStagedUpdate(stagedRoot, CURRENT_VERSION);
        if (!validation.ok) throw new Error(validation.error);

        const plan = writeInstallPlan({
            version: validation.version,
            stageDir,
            pluginDir: validation.pluginDir,
            platform: process.platform
        });

        const result = emitStatus({
            state: UPDATE_STATES.READY,
            latest: validation.version,
            hasUpdate: true,
            stageDir,
            zipPath,
            planPath: plan.planPath,
            pluginSource: plan.pluginSource,
            destination: plan.destination,
            backup: plan.backup,
            error: null,
            instruction: 'Ready to install. Resolve AI will close, but DaVinci Resolve can stay open.'
        });
        return { success: true, ...result };
    } catch (err) {
        const result = emitStatus({ state: UPDATE_STATES.FAILED, error: err.message });
        return { success: false, ...result };
    }
}

async function handleInstallStagedUpdate() {
    try {
        if (updateStatus.state !== UPDATE_STATES.READY || !updateStatus.planPath) {
            throw new Error('no-staged-update');
        }
        const plan = JSON.parse(fs.readFileSync(updateStatus.planPath, 'utf8'));
        const helperPath = helperPathForPlatform(process.platform);
        if (!fs.existsSync(helperPath)) throw new Error('missing-updater-helper');

        if (process.platform === 'win32') await launchWindowsHelper(helperPath, plan);
        else if (process.platform === 'darwin') await launchMacHelper(helperPath, plan);
        else throw new Error('unsupported-platform');

        const result = emitStatus({
            state: UPDATE_STATES.LAUNCHING,
            error: null,
            instruction: 'Update installer launched. Reopen Resolve AI from Workspace > Workflow Integration.'
        });

        setTimeout(() => {
            if (mainWindowRef && !mainWindowRef.isDestroyed()) mainWindowRef.close();
        }, 650);

        return { success: true, ...result };
    } catch (err) {
        const result = emitStatus({ state: UPDATE_STATES.FAILED, error: err.message });
        return { success: false, ...result };
    }
}

function setupUpdateHandlers(ipcMain, mainWindow) {
    mainWindowRef = mainWindow || null;
    ipcMain.handle('app:checkUpdate', handleCheckUpdate);
    ipcMain.handle('app:downloadUpdate', handleDownloadUpdate);
    ipcMain.handle('app:installStagedUpdate', handleInstallStagedUpdate);
    ipcMain.handle('app:getUpdateStatus', () => ({ ...updateStatus }));
}

module.exports = {
    setupUpdateHandlers,
    parseVersion,
    normalizeVersion,
    isNewer,
    expectedAssetName,
    selectReleaseAsset,
    isTrustedReleaseAssetUrl,
    updateRootForPlatform,
    installDestinationForPlatform,
    validateStagedUpdate,
    findStagedRoot,
    REQUIRED_PLUGIN_FILES
};
