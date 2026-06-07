const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    expectedAssetName,
    findStagedRoot,
    installDestinationForPlatform,
    isNewer,
    isTrustedReleaseAssetUrl,
    REQUIRED_PLUGIN_FILES,
    REQUIRED_RELEASE_FILES,
    selectReleaseAsset,
    updateRootForPlatform,
    validateStagedUpdate
} = require('../ipc/updates');

assert.strictEqual(isNewer('0.5.1-beta', '0.5.0-beta'), true);
assert.strictEqual(isNewer('0.5.0-beta', '0.5.0-beta'), false);
assert.strictEqual(isNewer('0.4.9', '0.5.0-beta'), false);

assert.strictEqual(expectedAssetName('v1.2.3', 'win32'), 'ResolveAI-Windows-v1.2.3.zip');
assert.strictEqual(expectedAssetName('v1.2.3', 'darwin'), 'ResolveAI-macOS-v1.2.3.zip');

const release = {
    tag_name: 'v1.2.3',
    assets: [
        { name: 'ResolveAI-macOS-v1.2.3.zip', browser_download_url: 'https://github.com/s4lam/resolve-ai/releases/download/v1.2.3/ResolveAI-macOS-v1.2.3.zip' },
        { name: 'ResolveAI-Windows-v1.2.3.zip', browser_download_url: 'https://github.com/s4lam/resolve-ai/releases/download/v1.2.3/ResolveAI-Windows-v1.2.3.zip' }
    ]
};
assert.strictEqual(selectReleaseAsset(release, 'win32').name, 'ResolveAI-Windows-v1.2.3.zip');
assert.strictEqual(selectReleaseAsset(release, 'darwin').name, 'ResolveAI-macOS-v1.2.3.zip');
assert.strictEqual(selectReleaseAsset({
    tag_name: 'v1.2.3',
    assets: [{ name: 'ResolveAI-Windows-v1.2.3.zip' }]
}, 'darwin'), null);

assert.strictEqual(isTrustedReleaseAssetUrl('https://github.com/s4lam/resolve-ai/releases/download/v1.2.3/ResolveAI-Windows-v1.2.3.zip'), true);
assert.strictEqual(isTrustedReleaseAssetUrl('https://release-assets.githubusercontent.com/github-production-release-asset/file.zip'), true);
assert.strictEqual(isTrustedReleaseAssetUrl('http://github.com/s4lam/resolve-ai/releases/download/file.zip'), false);
assert.strictEqual(isTrustedReleaseAssetUrl('https://user:pass@github.com/s4lam/resolve-ai/releases/download/file.zip'), false);
assert.strictEqual(isTrustedReleaseAssetUrl('https://127.0.0.1/file.zip'), false);
assert.strictEqual(isTrustedReleaseAssetUrl('https://169.254.169.254/file.zip'), false);
assert.strictEqual(isTrustedReleaseAssetUrl('file:///tmp/file.zip'), false);

const winRoot = updateRootForPlatform('win32', { LOCALAPPDATA: 'C:\\Users\\Test\\AppData\\Local' }, 'C:\\Users\\Test');
assert(winRoot.includes('ResolveAI'));
assert(winRoot.includes('updates'));
assert(installDestinationForPlatform('win32').includes('Workflow Integration Plugins'));
assert(installDestinationForPlatform('win32').endsWith('com.clauderesolve.plugin'));
assert(installDestinationForPlatform('darwin').includes('Workflow Integration Plugins'));
assert(installDestinationForPlatform('darwin').endsWith('com.clauderesolve.plugin'));

function writeRequiredPlugin(root, version = '0.5.1-beta', skip = null) {
    for (const rel of REQUIRED_RELEASE_FILES) {
        if (rel === skip) continue;
        const target = path.join(root, rel);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, rel.endsWith('.json') ? '{}' : 'ok', 'utf8');
    }
    for (const rel of REQUIRED_PLUGIN_FILES) {
        if (path.join('plugin', rel) === skip || rel === skip) continue;
        if (rel === 'package.json') continue;
        const target = path.join(root, 'plugin', rel);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, 'ok', 'utf8');
    }
    const pkgPath = path.join(root, 'plugin', 'package.json');
    fs.mkdirSync(path.dirname(pkgPath), { recursive: true });
    fs.writeFileSync(pkgPath, JSON.stringify({ version }), 'utf8');
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-ai-update-'));
try {
    const good = path.join(tmpRoot, 'good');
    writeRequiredPlugin(good);
    const result = validateStagedUpdate(good, '0.5.0-beta');
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.version, '0.5.1-beta');
    assert.strictEqual(findStagedRoot(good), good);

    const nested = path.join(tmpRoot, 'nested', 'ResolveAI-Windows-v0.5.1-beta');
    writeRequiredPlugin(nested);
    assert.strictEqual(findStagedRoot(path.join(tmpRoot, 'nested')), nested);

    const missing = path.join(tmpRoot, 'missing');
    writeRequiredPlugin(missing, '0.5.1-beta', path.join('dist', 'index.html'));
    assert.strictEqual(validateStagedUpdate(missing, '0.5.0-beta').ok, false);

    const oldVersion = path.join(tmpRoot, 'old');
    writeRequiredPlugin(oldVersion, '0.5.0-beta');
    assert.strictEqual(validateStagedUpdate(oldVersion, '0.5.0-beta').ok, false);
} finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
}

console.log('updates tests passed');
