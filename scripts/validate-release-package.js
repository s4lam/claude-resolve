const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const packageDir = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(root, 'dist', 'release', 'resolve-ai');

const requiredFiles = [
    'START HERE.txt',
    'plugin/manifest.xml',
    'plugin/main.js',
    'plugin/preload.js',
    'plugin/dist/index.html',
    'plugin/renderer/render.js',
    'plugin/renderer/package.json',
    'plugin/renderer/package-lock.json',
    'plugin/scripts/check-render-deps.js',
    'plugin/data/builtin-template-packs.json',
    'plugin/ipc/render-health.js',
    'plugin/ipc/runtime-qa.js',
    'plugin/ipc/rough-cut.js',
    'plugin/ipc/shorts-studio.js',
    'plugin/src/components/SidebarRoughCut.jsx',
    'plugin/src/components/SidebarShortsStudio.jsx',
    'plugin/updater/install-update.ps1',
    'plugin/updater/install-update.sh',
    'README.md',
    'installer/release-manifest.json',
    'installer/install.ps1',
    'installer/install.sh',
    'installer/README.md',
    'Install Resolve AI.bat',
    'Install Resolve AI.command'
];

const forbiddenRootFiles = [
    'install.bat',
    'install.command',
    'install.ps1',
    'install.sh',
    'INSTALL-FIRST.txt',
    'release-manifest.json'
];

const allowedRootItems = new Set([
    'START HERE.txt',
    'Install Resolve AI.bat',
    'Install Resolve AI.command',
    'README.md',
    'RELEASE_NOTES.md',
    'LICENSE',
    'plugin',
    'installer'
]);

function exists(relativePath) {
    return fs.existsSync(path.join(packageDir, relativePath));
}

function looksLikeGithubSourceZip() {
    return fs.existsSync(path.join(packageDir, 'plugin', 'package.json'))
        && !fs.existsSync(path.join(packageDir, 'plugin', 'dist', 'index.html'));
}

const missing = requiredFiles.filter(file => !exists(file));
const forbidden = forbiddenRootFiles.filter(file => exists(file));
const rootItems = fs.existsSync(packageDir) ? fs.readdirSync(packageDir) : [];
const unexpectedRootItems = rootItems.filter(item => !allowedRootItems.has(item));
const assetsDir = path.join(packageDir, 'plugin', 'dist', 'assets');
const assets = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir) : [];
const hasBuiltJs = assets.some(file => /^index-.*\.js$/.test(file));
const hasBuiltCss = assets.some(file => /^index-.*\.css$/.test(file));

if (missing.length || forbidden.length || unexpectedRootItems.length || !hasBuiltJs || !hasBuiltCss) {
    if (looksLikeGithubSourceZip()) {
        console.error('This looks like GitHub Source code.zip, not a Resolve AI release ZIP.');
        console.error('Download ResolveAI-Windows-vX.Y.Z.zip or ResolveAI-macOS-vX.Y.Z.zip from GitHub Releases.');
    }
    if (missing.length) console.error(`Missing release files:\n${missing.map(file => `- ${file}`).join('\n')}`);
    if (forbidden.length) console.error(`Root contains legacy/internal installer files:\n${forbidden.map(file => `- ${file}`).join('\n')}`);
    if (unexpectedRootItems.length) console.error(`Root contains unexpected files/folders:\n${unexpectedRootItems.map(file => `- ${file}`).join('\n')}`);
    if (!hasBuiltJs) console.error('Missing built Vite JS asset in plugin/dist/assets.');
    if (!hasBuiltCss) console.error('Missing built Vite CSS asset in plugin/dist/assets.');
    process.exit(1);
}

console.log(`Release package valid: ${packageDir}`);
