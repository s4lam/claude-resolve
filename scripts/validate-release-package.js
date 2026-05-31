const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const packageDir = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(root, 'dist', 'release', 'resolve-ai');

const requiredFiles = [
    'plugin/manifest.xml',
    'plugin/main.js',
    'plugin/preload.js',
    'plugin/dist/index.html',
    'plugin/renderer/render.js',
    'plugin/data/builtin-template-packs.json',
    'plugin/ipc/rough-cut.js',
    'plugin/ipc/shorts-studio.js',
    'plugin/src/components/SidebarRoughCut.jsx',
    'plugin/src/components/SidebarShortsStudio.jsx',
    'plugin/updater/install-update.ps1',
    'plugin/updater/install-update.sh',
    'README.md',
    'install.bat',
    'install.ps1',
    'install.sh',
    'install.command'
];

function exists(relativePath) {
    return fs.existsSync(path.join(packageDir, relativePath));
}

const missing = requiredFiles.filter(file => !exists(file));
const assetsDir = path.join(packageDir, 'plugin', 'dist', 'assets');
const assets = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir) : [];
const hasBuiltJs = assets.some(file => /^index-.*\.js$/.test(file));
const hasBuiltCss = assets.some(file => /^index-.*\.css$/.test(file));

if (missing.length || !hasBuiltJs || !hasBuiltCss) {
    if (missing.length) console.error(`Missing release files:\n${missing.map(file => `- ${file}`).join('\n')}`);
    if (!hasBuiltJs) console.error('Missing built Vite JS asset in plugin/dist/assets.');
    if (!hasBuiltCss) console.error('Missing built Vite CSS asset in plugin/dist/assets.');
    process.exit(1);
}

console.log(`Release package valid: ${packageDir}`);
