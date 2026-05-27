const fs = require('fs');
const path = require('path');
const { CONFIG_DIR } = require('./paths');

const BUILTIN_PACKS_PATH = path.join(__dirname, '..', 'data', 'builtin-template-packs.json');
const IMPORTED_PACKS_PATH = path.join(CONFIG_DIR, 'imported-template-packs.json');

function isSafeTemplateHtml(html) {
    const text = String(html || '');
    return text.includes('getAnimationDuration')
        && (text.includes('renderFrame') || text.includes('ReactDOM.createRoot'))
        && !/<script[^>]+src\s*=/i.test(text)
        && !/https?:\/\//i.test(text)
        && !/require\s*\(|child_process|fs\./i.test(text);
}

function validateTemplate(template) {
    const required = ['id', 'name', 'category', 'prompt', 'html', 'thumbnail', 'fps', 'width', 'height', 'createdBy'];
    const missing = required.filter(key => template[key] === undefined || template[key] === null || template[key] === '');
    const errors = missing.map(key => `Template missing ${key}`);
    if (!Array.isArray(template.tags)) errors.push('Template tags must be an array');
    if (!isSafeTemplateHtml(template.html)) errors.push('Template HTML is unsafe or missing render contract');
    if (!Number(template.fps) || !Number(template.width) || !Number(template.height)) errors.push('Template dimensions/fps must be numeric');
    return { ok: errors.length === 0, errors };
}

function validateTemplatePack(pack) {
    const errors = [];
    if (!pack || typeof pack !== 'object') errors.push('Pack must be an object');
    if (!pack?.id) errors.push('Pack missing id');
    if (!pack?.name) errors.push('Pack missing name');
    if (!Array.isArray(pack?.templates) || pack.templates.length === 0) errors.push('Pack templates must be a non-empty array');
    for (const template of pack?.templates || []) {
        const result = validateTemplate(template);
        if (!result.ok) errors.push(...result.errors.map(error => `${template?.id || 'template'}: ${error}`));
    }
    return { ok: errors.length === 0, errors };
}

function readJsonArray(filePath) {
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function loadPacks(options = {}) {
    const builtinPath = options.builtinPath || BUILTIN_PACKS_PATH;
    const importedStorePath = options.importedStorePath || IMPORTED_PACKS_PATH;
    return [...readJsonArray(builtinPath), ...readJsonArray(importedStorePath)]
        .filter(pack => validateTemplatePack(pack).ok);
}

function flattenGalleryItems(packs = []) {
    return packs.flatMap(pack => pack.templates.map(template => ({
        ...template,
        title: template.title || template.name,
        preview: template.preview || template.thumbnail,
        recommendedProvider: template.recommendedProvider || 'auto',
        packId: pack.id,
        packName: pack.name
    })));
}

function loadGalleryItems(options = {}) {
    return flattenGalleryItems(loadPacks(options));
}

function importTemplatePackPayload(pack, storePath = IMPORTED_PACKS_PATH) {
    const validation = validateTemplatePack(pack);
    if (!validation.ok) return { success: false, errors: validation.errors };
    const current = readJsonArray(storePath).filter(existing => existing.id !== pack.id);
    current.unshift(pack);
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, JSON.stringify(current, null, 2), 'utf8');
    return { success: true, pack };
}

async function handleImportTemplatePack(_event, payload = {}) {
    let filePath = payload.path;
    if (!filePath) {
        const { dialog } = require('electron');
        const result = await dialog.showOpenDialog({
            title: 'Import template pack',
            properties: ['openFile'],
            filters: [{ name: 'Template Pack JSON', extensions: ['json'] }]
        });
        if (result.canceled || !result.filePaths[0]) return { success: true, canceled: true };
        filePath = result.filePaths[0];
    }
    const pack = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return importTemplatePackPayload(pack);
}

function setupTemplatePackHandlers(ipcMain) {
    ipcMain.handle('gallery:list', () => loadGalleryItems());
    ipcMain.handle('gallery:use', (_event, id) => loadGalleryItems().find(item => item.id === id) || null);
    ipcMain.handle('templatePacks:validate', (_event, pack) => validateTemplatePack(pack));
    ipcMain.handle('templatePacks:import', handleImportTemplatePack);
}

module.exports = {
    flattenGalleryItems,
    importTemplatePackPayload,
    isSafeTemplateHtml,
    loadGalleryItems,
    setupTemplatePackHandlers,
    validateTemplate,
    validateTemplatePack
};
