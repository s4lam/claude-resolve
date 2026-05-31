const fs = require('fs');
const path = require('path');
const { execFileSync, execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const pluginPkg = JSON.parse(fs.readFileSync(path.join(root, 'plugin', 'package.json'), 'utf8'));
const outDir = path.join(root, 'dist', 'release');
const version = pluginPkg.version || 'dev';
const zipNames = [
    `ResolveAI-Windows-v${version}.zip`,
    `ResolveAI-macOS-v${version}.zip`
];
const stageDir = path.join(outDir, 'resolve-ai');

function ensureBuiltinTemplatePack() {
    const dataDir = path.join(root, 'plugin', 'data');
    const packPath = path.join(dataDir, 'builtin-template-packs.json');
    if (fs.existsSync(packPath)) return;
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(packPath, JSON.stringify([{
        id: 'creator-essentials',
        name: 'Creator Essentials',
        templates: [{
            id: 'creator-title-card',
            name: 'Creator Title Card',
            title: 'Creator Title Card',
            category: 'creator essentials',
            tags: ['title', 'creator'],
            prompt: 'Create a clean creator title card. 1920x1080, 25fps, ProRes 4444 overlay.',
            html: '<!DOCTYPE html><html><body><div id="stage"><h1>Creator Title</h1></div><script>window.getAnimationDuration=()=>5;window.renderFrame=()=>{};</script></body></html>',
            thumbnail: 'builtin://creator-title-card',
            preview: 'builtin://creator-title-card',
            fps: 25,
            width: 1920,
            height: 1080,
            createdBy: 'Resolve AI',
            recommendedProvider: 'auto'
        }]
    }], null, 2), 'utf8');
}

function copyRecursive(source, target, options = {}) {
    const excludedDirs = options.excludedDirs || ['node_modules', '.git'];
    const stat = fs.statSync(source);
    if (stat.isDirectory()) {
        fs.mkdirSync(target, { recursive: true });
        for (const entry of fs.readdirSync(source)) {
            if (excludedDirs.includes(entry)) continue;
            copyRecursive(path.join(source, entry), path.join(target, entry), options);
        }
        return;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
}

fs.rmSync(stageDir, { recursive: true, force: true });
fs.mkdirSync(stageDir, { recursive: true });
ensureBuiltinTemplatePack();
execSync('npm --prefix plugin run build', { cwd: root, stdio: 'inherit' });

for (const item of ['plugin', 'community-templates', 'screenshots']) {
    const source = path.join(root, item);
    if (fs.existsSync(source)) copyRecursive(source, path.join(stageDir, item));
}

for (const file of ['README.md', 'CONTRIBUTING.md', 'RELEASE_NOTES.md', 'LICENSE', 'install.bat', 'install.ps1', 'install.sh', 'install.command']) {
    const source = path.join(root, file);
    if (fs.existsSync(source)) copyRecursive(source, path.join(stageDir, file));
}

execFileSync(process.execPath, [path.join(root, 'scripts', 'validate-release-package.js'), stageDir], { stdio: 'inherit' });

for (const zipName of zipNames) {
    fs.rmSync(path.join(outDir, zipName), { force: true });
}

function createZip(zipName) {
    const zipPath = path.join(outDir, zipName);
    if (process.platform === 'win32') {
        execFileSync('powershell.exe', [
            '-NoProfile',
            '-Command',
            `Compress-Archive -Path "${stageDir}\\*" -DestinationPath "${zipPath}" -Force`
        ], { stdio: 'inherit' });
    } else {
        execFileSync('zip', ['-r', zipPath, '.'], { cwd: stageDir, stdio: 'inherit' });
    }
    console.log(zipPath);
}

for (const zipName of zipNames) {
    createZip(zipName);
}
