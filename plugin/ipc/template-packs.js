const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const dns = require('dns').promises;
const net = require('net');
const { CONFIG_DIR } = require('./paths');

const BUILTIN_PACKS_PATH = path.join(__dirname, '..', 'data', 'builtin-template-packs.json');
const IMPORTED_PACKS_PATH = path.join(CONFIG_DIR, 'imported-template-packs.json');
const MAX_REDIRECTS = 5;

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

function normalizeHostname(hostname) {
    return String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

function isPrivateIPv4(address) {
    const parts = String(address).split('.').map(Number);
    if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true;
    const [a, b] = parts;
    return a === 0
        || a === 10
        || a === 127
        || (a === 100 && b >= 64 && b <= 127)
        || (a === 169 && b === 254)
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168)
        || (a === 198 && (b === 18 || b === 19))
        || a >= 224;
}

function isPrivateIPv6(address) {
    const value = normalizeHostname(address);
    if (value.startsWith('::ffff:')) return isPrivateIPv4(value.slice(7));
    return value === '::'
        || value === '::1'
        || value.startsWith('fc')
        || value.startsWith('fd')
        || value.startsWith('fe8')
        || value.startsWith('fe9')
        || value.startsWith('fea')
        || value.startsWith('feb')
        || value.startsWith('ff');
}

function isBlockedNetworkAddress(address) {
    const value = normalizeHostname(address);
    const family = net.isIP(value);
    if (family === 4) return isPrivateIPv4(value);
    if (family === 6) return isPrivateIPv6(value);
    return false;
}

function isBlockedHostname(hostname) {
    const host = normalizeHostname(hostname);
    if (!host) return true;
    if (host === 'localhost' || host.endsWith('.localhost')) return true;
    if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan')) return true;
    return isBlockedNetworkAddress(host);
}

function validateTemplatePackUrl(value) {
    try {
        const url = new URL(String(value || '').trim());
        if (!['https:', 'http:'].includes(url.protocol)) return { ok: false, error: 'URL must use http or https' };
        if (!url.hostname) return { ok: false, error: 'URL missing host' };
        if (url.username || url.password) return { ok: false, error: 'URL must not include credentials' };
        if (isBlockedHostname(url.hostname)) return { ok: false, error: 'URL host is not allowed' };
        if (!/\.json(?:$|\?)/i.test(url.pathname + url.search)) return { ok: false, error: 'URL must point to a JSON file' };
        return { ok: true, url: url.toString() };
    } catch {
        return { ok: false, error: 'Invalid URL' };
    }
}

async function assertPublicRemoteUrl(url) {
    if (isBlockedHostname(url.hostname)) throw new Error('URL host is not allowed');
    const hostname = normalizeHostname(url.hostname);
    if (net.isIP(hostname)) return;
    const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
    if (!addresses.length) throw new Error('URL host could not be resolved');
    if (addresses.some(entry => isBlockedNetworkAddress(entry.address))) {
        throw new Error('URL resolves to a private or local network address');
    }
}

async function fetchJson(url, maxBytes = 2 * 1024 * 1024, redirectsRemaining = MAX_REDIRECTS) {
    const validation = validateTemplatePackUrl(url);
    if (!validation.ok) throw new Error(validation.error);
    const parsedUrl = new URL(validation.url);
    await assertPublicRemoteUrl(parsedUrl);
    const client = parsedUrl.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
        const request = client.get(parsedUrl, { timeout: 15000 }, (response) => {
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                response.resume();
                if (redirectsRemaining <= 0) {
                    reject(new Error('Too many redirects'));
                    return;
                }
                const nextUrl = new URL(response.headers.location, parsedUrl).toString();
                fetchJson(nextUrl, maxBytes, redirectsRemaining - 1).then(resolve, reject);
                return;
            }
            if (response.statusCode !== 200) {
                response.resume();
                reject(new Error(`HTTP ${response.statusCode}`));
                return;
            }
            let total = 0;
            const chunks = [];
            response.on('data', chunk => {
                total += chunk.length;
                if (total > maxBytes) {
                    request.destroy(new Error('Template pack is too large'));
                    return;
                }
                chunks.push(chunk);
            });
            response.on('end', () => {
                try {
                    resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
                } catch {
                    reject(new Error('Response was not valid JSON'));
                }
            });
        });
        request.on('timeout', () => request.destroy(new Error('Request timed out')));
        request.on('error', reject);
    });
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

async function handleInstallTemplatePackFromUrl(_event, payload = {}) {
    const validation = validateTemplatePackUrl(payload.url);
    if (!validation.ok) return { success: false, error: validation.error };
    try {
        const pack = await fetchJson(validation.url);
        const result = importTemplatePackPayload(pack);
        return result.success ? { ...result, url: validation.url } : result;
    } catch (err) {
        return { success: false, error: err.message || 'Failed to install template pack' };
    }
}

function setupTemplatePackHandlers(ipcMain) {
    ipcMain.handle('gallery:list', () => loadGalleryItems());
    ipcMain.handle('gallery:use', (_event, id) => loadGalleryItems().find(item => item.id === id) || null);
    ipcMain.handle('templatePacks:validate', (_event, pack) => validateTemplatePack(pack));
    ipcMain.handle('templatePacks:import', handleImportTemplatePack);
    ipcMain.handle('templatePacks:installFromUrl', handleInstallTemplatePackFromUrl);
}

module.exports = {
    flattenGalleryItems,
    importTemplatePackPayload,
    isSafeTemplateHtml,
    loadGalleryItems,
    setupTemplatePackHandlers,
    validateTemplate,
    validateTemplatePackUrl,
    validateTemplatePack
};
