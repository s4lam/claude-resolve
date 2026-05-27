const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { ASSET_DIR, CONFIG_DIR } = require('./paths');

const STORE_PATH = path.join(CONFIG_DIR, 'assets.json');
const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif']);
const ASSET_CATEGORIES = new Set(['logo', 'texture', 'product', 'background', 'icon', 'reference', 'other']);

function isAllowedAsset(filePath) {
    return ALLOWED_EXTENSIONS.has(path.extname(filePath || '').toLowerCase());
}

function ensureDir(dir = ASSET_DIR) {
    fs.mkdirSync(dir, { recursive: true });
}

function readAssets(storePath = STORE_PATH, assetDir = ASSET_DIR) {
    let assets = [];
    try {
        assets = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    } catch {
        assets = [];
    }
    if (!Array.isArray(assets)) assets = [];
    return assets
        .filter(asset => asset && asset.fileName)
        .map(asset => hydrateAsset(asset, assetDir))
        .filter(asset => fs.existsSync(asset.path));
}

function writeAssets(assets, storePath = STORE_PATH) {
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, JSON.stringify(assets, null, 2), 'utf8');
    return assets;
}

function hydrateAsset(asset, assetDir = ASSET_DIR) {
    const fullPath = path.join(assetDir, asset.fileName);
    return {
        ...asset,
        path: fullPath,
        url: pathToFileURL(fullPath).href,
        size: fs.existsSync(fullPath) ? fs.statSync(fullPath).size : asset.size || 0
    };
}

function safeFileName(sourcePath, usedNames) {
    const ext = path.extname(sourcePath).toLowerCase();
    const base = path.basename(sourcePath, ext)
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 60) || 'asset';
    let candidate = `${base}${ext}`;
    let index = 2;
    while (usedNames.has(candidate)) {
        candidate = `${base}_${index}${ext}`;
        index += 1;
    }
    usedNames.add(candidate);
    return candidate;
}

function importAssetFiles(filePaths, options = {}) {
    const storePath = options.storePath || STORE_PATH;
    const assetDir = options.assetDir || ASSET_DIR;
    ensureDir(assetDir);

    const assets = readAssets(storePath, assetDir);
    const usedNames = new Set(assets.map(asset => asset.fileName));
    const added = [];

    for (const sourcePath of filePaths || []) {
        if (!isAllowedAsset(sourcePath) || !fs.existsSync(sourcePath)) continue;
        const fileName = safeFileName(sourcePath, usedNames);
        const targetPath = path.join(assetDir, fileName);
        fs.copyFileSync(sourcePath, targetPath);

        const asset = hydrateAsset({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name: path.basename(sourcePath),
            fileName,
            ext: path.extname(fileName).toLowerCase(),
            mime: mimeFromExtension(fileName),
            category: 'reference',
            notes: '',
            alwaysInclude: false,
            createdAt: new Date().toISOString()
        }, assetDir);
        assets.unshift(asset);
        added.push(asset);
    }

    writeAssets(assets.map(stripRuntimeFields), storePath);
    return { success: true, added, assets: readAssets(storePath, assetDir) };
}

function stripRuntimeFields(asset) {
    const { path: _path, url: _url, size: _size, ...stored } = asset;
    return stored;
}

function mimeFromExtension(fileName) {
    const ext = path.extname(fileName).toLowerCase();
    if (ext === '.svg') return 'image/svg+xml';
    if (ext === '.png') return 'image/png';
    if (ext === '.webp') return 'image/webp';
    if (ext === '.gif') return 'image/gif';
    return 'image/jpeg';
}

function updateAsset(id, patch = {}, storePath = STORE_PATH, assetDir = ASSET_DIR) {
    const assets = readAssets(storePath, assetDir);
    const index = assets.findIndex(asset => asset.id === id);
    if (index === -1) return null;
    const next = {
        ...assets[index],
        notes: typeof patch.notes === 'string' ? patch.notes.slice(0, 700) : assets[index].notes,
        name: typeof patch.name === 'string' && patch.name.trim() ? patch.name.trim().slice(0, 120) : assets[index].name,
        category: ASSET_CATEGORIES.has(patch.category) ? patch.category : (assets[index].category || 'reference'),
        alwaysInclude: typeof patch.alwaysInclude === 'boolean' ? patch.alwaysInclude : Boolean(assets[index].alwaysInclude),
        updatedAt: new Date().toISOString()
    };
    assets[index] = next;
    writeAssets(assets.map(stripRuntimeFields), storePath);
    return hydrateAsset(stripRuntimeFields(next), assetDir);
}

function deleteAsset(id, storePath = STORE_PATH, assetDir = ASSET_DIR) {
    const assets = readAssets(storePath, assetDir);
    const asset = assets.find(item => item.id === id);
    if (!asset) return { success: false, error: 'Asset not found' };

    if (fs.existsSync(asset.path)) fs.rmSync(asset.path);
    writeAssets(assets.filter(item => item.id !== id).map(stripRuntimeFields), storePath);
    return { success: true, deleted: id };
}

function formatSelectedAssets(selectedAssetIds = [], options = {}) {
    const ids = new Set(Array.isArray(selectedAssetIds) ? selectedAssetIds : []);

    const assets = readAssets(options.storePath || STORE_PATH, options.assetDir || ASSET_DIR)
        .filter(asset => ids.has(asset.id) || asset.alwaysInclude)
        .slice(0, 8);
    if (assets.length === 0) return '';

    const lines = assets.map(asset => [
        `- ${asset.name || asset.fileName}`,
        `  URL: ${asset.url}`,
        `  Type: ${asset.mime || 'image'}`,
        `  Category: ${asset.category || 'reference'}`,
        asset.alwaysInclude ? '  Brand Kit: always include' : null,
        asset.notes ? `  Notes: ${asset.notes}` : null
    ].filter(Boolean).join('\n'));

    return `\n\n<selected_assets>\nUse these local assets when relevant. Reference the exact file URL in HTML img/src, CSS url(), or inline SVG/image usage. Do not shorten the URL to only the filename. The model cannot inspect the image pixels; rely on the notes when provided. Keep file URLs unchanged.\n${lines.join('\n')}\n</selected_assets>`;
}

function assetCandidates(asset) {
    return new Set([
        asset.name,
        asset.fileName,
        path.basename(asset.name || ''),
        path.basename(asset.fileName || ''),
        path.basename(asset.fileName || '', path.extname(asset.fileName || '')),
        path.basename(asset.name || '', path.extname(asset.name || ''))
    ].filter(Boolean).map(value => value.toLowerCase()));
}

function basenameFromReference(value) {
    const cleaned = String(value || '').trim()
        .replace(/^['"]|['"]$/g, '')
        .split(/[?#]/)[0]
        .replace(/\\/g, '/');
    const last = cleaned.split('/').pop() || cleaned;
    try {
        return decodeURIComponent(last).toLowerCase();
    } catch {
        return last.toLowerCase();
    }
}

function findAssetForReference(value, assets) {
    const ref = basenameFromReference(value);
    if (!ref || /^(data|blob|https?):/i.test(String(value || ''))) return null;
    return assets.find(asset => assetCandidates(asset).has(ref)) || null;
}

function resolvedAssetUrl(asset, options = {}) {
    if (!options.inlineDataUrls) return asset.url;
    try {
        const data = fs.readFileSync(asset.path);
        return `data:${asset.mime || 'image/png'};base64,${data.toString('base64')}`;
    } catch {
        return asset.url;
    }
}

function getRelevantAssets(selectedAssetIds = [], options = {}) {
    const ids = new Set(Array.isArray(selectedAssetIds) ? selectedAssetIds : []);
    return readAssets(options.storePath || STORE_PATH, options.assetDir || ASSET_DIR)
        .filter(asset => ids.has(asset.id) || asset.alwaysInclude);
}

function resolveAssetReferences(html = '', selectedAssetIds = [], options = {}) {
    const assets = getRelevantAssets(selectedAssetIds, options);
    if (!assets.length || !html) return html;

    let nextHtml = String(html);

    nextHtml = nextHtml.replace(/\b(src|href)\s*=\s*(["'])([^"']+)\2/gi, (match, attr, quote, value) => {
        const asset = findAssetForReference(value, assets);
        return asset ? `${attr}=${quote}${resolvedAssetUrl(asset, options)}${quote}` : match;
    });

    nextHtml = nextHtml.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (match, quote, value) => {
        const asset = findAssetForReference(value, assets);
        return asset ? `url("${resolvedAssetUrl(asset, options)}")` : match;
    });

    return nextHtml;
}

async function handleAddAssets(_event, payload = {}) {
    let filePaths = payload.paths;
    if (!Array.isArray(filePaths)) {
        const { dialog } = require('electron');
        const result = await dialog.showOpenDialog({
            title: 'Add assets',
            properties: ['openFile', 'multiSelections'],
            filters: [
                { name: 'Images and SVG', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif'] }
            ]
        });
        if (result.canceled) return { success: true, added: [], assets: readAssets() };
        filePaths = result.filePaths;
    }
    return importAssetFiles(filePaths);
}

function handleRevealAsset(_event, id) {
    const asset = readAssets().find(item => item.id === id);
    if (!asset) return false;
    const { shell } = require('electron');
    shell.showItemInFolder(asset.path);
    return true;
}

function setupAssetHandlers(ipcMain) {
    ipcMain.handle('assets:list', () => readAssets());
    ipcMain.handle('assets:add', handleAddAssets);
    ipcMain.handle('assets:update', (_event, id, patch) => updateAsset(id, patch));
    ipcMain.handle('assets:delete', (_event, id) => deleteAsset(id));
    ipcMain.handle('assets:reveal', handleRevealAsset);
    ipcMain.handle('assets:resolveHtml', (_event, html, selectedAssetIds, options) => resolveAssetReferences(html, selectedAssetIds, options));
}

module.exports = {
    ALLOWED_EXTENSIONS,
    ASSET_CATEGORIES,
    deleteAsset,
    formatSelectedAssets,
    importAssetFiles,
    isAllowedAsset,
    readAssets,
    resolveAssetReferences,
    setupAssetHandlers,
    updateAsset,
    writeAssets
};
