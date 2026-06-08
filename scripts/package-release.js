const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const pluginPkg = JSON.parse(fs.readFileSync(path.join(root, 'plugin', 'package.json'), 'utf8'));
const outDir = path.join(root, 'dist', 'release');
const version = pluginPkg.version || 'dev';
const zipNames = [
    `ResolveAI-Windows-v${version}.zip`,
    `ResolveAI-macOS-v${version}.zip`
];
const stageDir = path.join(outDir, 'resolve-ai');
const validationDir = path.join(outDir, 'validation');

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

function runPluginBuild() {
    const viteBin = path.join(root, 'plugin', 'node_modules', 'vite', 'bin', 'vite.js');
    if (!fs.existsSync(viteBin)) {
        throw new Error('Missing plugin/node_modules/vite. Run npm --prefix plugin install before packaging a release.');
    }
    execFileSync(process.execPath, [viteBin, 'build'], {
        cwd: path.join(root, 'plugin'),
        stdio: 'inherit'
    });
}

function writeReleaseMetadata() {
    const manifest = {
        name: 'Resolve AI',
        version,
        generatedAt: new Date().toISOString(),
        assets: zipNames,
        install: {
            windows: 'Double-click Install Resolve AI.bat from the extracted ResolveAI-Windows ZIP.',
            macOS: 'Double-click Install Resolve AI.command from the extracted ResolveAI-macOS ZIP.',
            warning: 'Download ResolveAI-...zip from GitHub Releases, not GitHub Source code.zip.'
        },
        required: [
            'START HERE.txt',
            'plugin/manifest.xml',
            'plugin/main.js',
            'plugin/preload.js',
            'plugin/dist/index.html',
            'plugin/data/builtin-template-packs.json',
            'plugin/renderer/render.js',
            'plugin/renderer/package.json',
            'plugin/renderer/package-lock.json',
            'plugin/scripts/check-render-deps.js',
            'plugin/updater/install-update.ps1',
            'plugin/updater/install-update.sh',
            'installer/release-manifest.json',
            'installer/install.ps1',
            'installer/install.sh',
            'installer/README.md',
            'Install Resolve AI.bat',
            'Install Resolve AI.command'
        ]
    };
    fs.mkdirSync(path.join(stageDir, 'installer'), { recursive: true });
    fs.writeFileSync(path.join(stageDir, 'installer', 'release-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    fs.writeFileSync(path.join(stageDir, 'START HERE.txt'), [
        'Resolve AI installer',
        '',
        'Use this release ZIP, not GitHub Source code.zip.',
        '',
        'Windows:',
        '  Double-click Install Resolve AI.bat',
        '',
        'macOS:',
        '  Double-click Install Resolve AI.command',
        '',
        'Internal installer scripts live in the installer folder. Normal users should not run them directly.',
        '',
        'After install, open DaVinci Resolve > Workspace > Workflow Integration > Resolve AI.',
        ''
    ].join('\n'), 'utf8');
    fs.writeFileSync(path.join(stageDir, 'installer', 'README.md'), [
        '# Resolve AI installer internals',
        '',
        'Use the root launchers instead:',
        '',
        '- Windows: `Install Resolve AI.bat`',
        '- macOS: `Install Resolve AI.command`',
        '',
        '`install.ps1` and `install.sh` contain the real platform install logic and are called by the launchers.',
        ''
    ].join('\n'), 'utf8');
}

function extractZip(zipPath, targetDir) {
    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.mkdirSync(targetDir, { recursive: true });
    if (process.platform === 'win32') {
        execFileSync('powershell.exe', [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            '& { param($zipPath, $targetDir) Expand-Archive -LiteralPath $zipPath -DestinationPath $targetDir -Force }',
            zipPath,
            targetDir
        ], { stdio: 'inherit' });
        return;
    }
    execFileSync('unzip', ['-q', zipPath, '-d', targetDir], { stdio: 'inherit' });
}

fs.rmSync(stageDir, { recursive: true, force: true });
fs.rmSync(validationDir, { recursive: true, force: true });
fs.mkdirSync(stageDir, { recursive: true });
ensureBuiltinTemplatePack();
runPluginBuild();

for (const item of ['plugin']) {
    const source = path.join(root, item);
    if (fs.existsSync(source)) copyRecursive(source, path.join(stageDir, item));
}

for (const file of ['README.md', 'RELEASE_NOTES.md', 'LICENSE', 'Install Resolve AI.bat', 'Install Resolve AI.command']) {
    const source = path.join(root, file);
    if (fs.existsSync(source)) copyRecursive(source, path.join(stageDir, file));
}

for (const file of ['install.ps1', 'install.sh']) {
    const source = path.join(root, 'installer', file);
    if (fs.existsSync(source)) copyRecursive(source, path.join(stageDir, 'installer', file));
}

writeReleaseMetadata();
execFileSync(process.execPath, [path.join(root, 'scripts', 'validate-release-package.js'), stageDir], { stdio: 'inherit' });

if (fs.existsSync(outDir)) {
    for (const entry of fs.readdirSync(outDir)) {
        if (/^ResolveAI-.*\.zip$/i.test(entry)) {
            fs.rmSync(path.join(outDir, entry), { force: true });
        }
    }
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
    return zipPath;
}

for (const zipName of zipNames) {
    const zipPath = createZip(zipName);
    const target = path.join(validationDir, zipName.replace(/\.zip$/i, ''));
    extractZip(zipPath, target);
    execFileSync(process.execPath, [path.join(root, 'scripts', 'validate-release-package.js'), target], { stdio: 'inherit' });
}
