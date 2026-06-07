const fs = require('fs');
const path = require('path');
const { CONFIG_DIR } = require('./paths');
const { applyRenderPreset, normalizeRenderSettings } = require('./render-settings');

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
    effort: 'auto',
    codexModel: 'default',
    fps: 25,
    width: 1920,
    height: 1080,
    brandKit: DEFAULT_BRAND_KIT,
    promptPresets: [],
    savedTemplates: [],
    selectedAssetIds: [],
    generation: {
        variationCount: 3,
        locks: {
            logo: false,
            colors: false,
            layout: false,
            animationOnly: false
        }
    },
    captions: {
        defaultStyle: 'clean',
        defaultOutputMode: 'overlay',
        defaultRegroupMode: 'punchy',
        nativeTemplateName: 'Resolve AI Caption',
        verticalSafe: true
    },
    transcription: {
        provider: 'none',
        commandPath: '',
        model: 'base',
        language: ''
    },
    analysis: {
        enabled: true,
        includeTranscription: true,
        includeAudioHints: true,
        publishMarkers: false
    },
    resolve: {
        safetySnapshots: true
    },
    assets: {
        maxImportSizeMb: 25
    },
    render: {
        renderPreset: 'prores_mov',
        outputFormat: 'prores',
        proresProfile: '4444',
        threads: 'auto',
        createProxy: false,
        proxyEncoder: 'auto',
        proxyQuality: 'balanced',
        ffmpegPath: ''
    },
    ui: {
        rawLogsOpen: false,
        activeToolTab: 'create',
        activeWorkspaceMode: 'create'
    },
    gallery: {
        favorites: [],
        recentIds: []
    }
};

function mergeRenderSettings(base = {}, patch = {}) {
    const hasPresetPatch = Object.prototype.hasOwnProperty.call(patch, 'renderPreset');
    const hasOutputPatch = Object.prototype.hasOwnProperty.call(patch, 'outputFormat');
    const expandedPatch = hasPresetPatch && !hasOutputPatch
        ? applyRenderPreset(patch.renderPreset, { threads: base.threads || 'auto', ...patch })
        : patch;
    return normalizeRenderSettings({ ...base, ...expandedPatch });
}

function mergeConfig(parsed = {}) {
    return {
        ...DEFAULTS,
        ...parsed,
        brandKit: { ...DEFAULT_BRAND_KIT, ...(parsed.brandKit || {}) },
        selectedAssetIds: Array.isArray(parsed.selectedAssetIds) ? parsed.selectedAssetIds : [],
        generation: {
            ...(DEFAULTS.generation || {}),
            ...(parsed.generation || {}),
            locks: {
                ...(DEFAULTS.generation.locks || {}),
                ...((parsed.generation || {}).locks || {})
            }
        },
        captions: { ...(DEFAULTS.captions || {}), ...(parsed.captions || {}) },
        transcription: { ...(DEFAULTS.transcription || {}), ...(parsed.transcription || {}) },
        analysis: { ...(DEFAULTS.analysis || {}), ...(parsed.analysis || {}) },
        resolve: { ...(DEFAULTS.resolve || {}), ...(parsed.resolve || {}) },
        assets: { ...(DEFAULTS.assets || {}), ...(parsed.assets || {}) },
        render: mergeRenderSettings(DEFAULTS.render || {}, parsed.render || {}),
        ui: { ...(DEFAULTS.ui || {}), ...(parsed.ui || {}) },
        gallery: {
            ...(DEFAULTS.gallery || {}),
            ...(parsed.gallery || {}),
            favorites: Array.isArray(parsed.gallery?.favorites) ? parsed.gallery.favorites : [],
            recentIds: Array.isArray(parsed.gallery?.recentIds) ? parsed.gallery.recentIds : []
        }
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
        generation: {
            ...(current.generation || DEFAULTS.generation),
            ...(partial.generation || {}),
            locks: {
                ...((current.generation || DEFAULTS.generation).locks || {}),
                ...((partial.generation || {}).locks || {})
            }
        },
        captions: { ...(current.captions || DEFAULTS.captions), ...(partial.captions || {}) },
        analysis: { ...(current.analysis || DEFAULTS.analysis), ...(partial.analysis || {}) },
        resolve: { ...(current.resolve || DEFAULTS.resolve), ...(partial.resolve || {}) },
        assets: { ...(current.assets || DEFAULTS.assets), ...(partial.assets || {}) },
        render: mergeRenderSettings(current.render || DEFAULTS.render, partial.render || {}),
        ui: { ...(current.ui || {}), ...(partial.ui || {}) },
        gallery: {
            ...(current.gallery || DEFAULTS.gallery),
            ...(partial.gallery || {}),
            favorites: Array.isArray(partial.gallery?.favorites)
                ? partial.gallery.favorites
                : (current.gallery?.favorites || []),
            recentIds: Array.isArray(partial.gallery?.recentIds)
                ? partial.gallery.recentIds
                : (current.gallery?.recentIds || [])
        }
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
