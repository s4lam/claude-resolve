const fs = require('fs');
const path = require('path');
const { CONFIG_DIR } = require('./paths');

const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const DEFAULT_BRAND_KIT = {
    colors: '',
    fonts: '',
    logoPath: '',
    tone: '',
    phrases: ''
};

const DEFAULTS = {
    provider: 'auto',
    model: 'sonnet',
    codexModel: 'default',
    fps: 25,
    width: 1920,
    height: 1080,
    brandKit: DEFAULT_BRAND_KIT,
    promptPresets: [],
    savedTemplates: [],
    selectedAssetIds: [],
    ui: {
        rawLogsOpen: false
    }
};

function mergeConfig(parsed = {}) {
    return {
        ...DEFAULTS,
        ...parsed,
        brandKit: { ...DEFAULT_BRAND_KIT, ...(parsed.brandKit || {}) },
        selectedAssetIds: Array.isArray(parsed.selectedAssetIds) ? parsed.selectedAssetIds : [],
        ui: { ...(DEFAULTS.ui || {}), ...(parsed.ui || {}) }
    };
}

function readConfig() {
    try {
        return mergeConfig(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')));
    } catch {
        return mergeConfig();
    }
}

function writeConfig(partial) {
    const current = readConfig();
    const config = {
        ...current,
        ...partial,
        brandKit: { ...DEFAULT_BRAND_KIT, ...(current.brandKit || {}), ...(partial.brandKit || {}) },
        selectedAssetIds: Array.isArray(partial.selectedAssetIds) ? partial.selectedAssetIds : current.selectedAssetIds,
        ui: { ...(current.ui || {}), ...(partial.ui || {}) }
    };
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    return config;
}

function setupConfigHandlers(ipcMain) {
    ipcMain.handle('config:get', () => readConfig());
    ipcMain.handle('config:set', (_e, partial) => writeConfig(partial));
    ipcMain.handle('brand:get', () => readConfig().brandKit || DEFAULT_BRAND_KIT);
    ipcMain.handle('brand:set', (_e, brandKit) => writeConfig({ brandKit }).brandKit);
}

module.exports = { setupConfigHandlers, readConfig, writeConfig, mergeConfig, DEFAULT_BRAND_KIT };
