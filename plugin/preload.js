// Resolve AI — Preload Bridge
// Exposes a safe resolveAPI surface to the renderer via contextBridge.
// Each method maps 1:1 to an ipcMain.handle channel in main.js.

const { contextBridge, ipcRenderer } = require('electron/renderer');

contextBridge.exposeInMainWorld('resolveAPI', {
    // Navigation
    openPage: (pageName) => ipcRenderer.invoke('resolve:openPage', pageName),
    getCurrentPage: () => ipcRenderer.invoke('resolve:getCurrentPage'),

    // Project
    getProjectName: () => ipcRenderer.invoke('resolve:getProjectName'),

    // Timeline
    getCurrentTimeline: () => ipcRenderer.invoke('resolve:getCurrentTimeline'),
    getTimelineSettings: () => ipcRenderer.invoke('resolve:getTimelineSettings'),

    // Lifecycle
    cleanup: () => ipcRenderer.invoke('resolve:cleanup')
});

contextBridge.exposeInMainWorld('timelineAPI', {
    getContext: () => ipcRenderer.invoke('timeline:getContext'),
    generateAtPlayhead: (payload) => ipcRenderer.invoke('timeline:generateAtPlayhead', payload)
});

contextBridge.exposeInMainWorld('overlayAPI', {
    renderMov: (data) => ipcRenderer.invoke('overlay:renderMov', data),
    validate: (data) => ipcRenderer.invoke('overlay:validate', data),
    getRenderHealth: () => ipcRenderer.invoke('overlay:getRenderHealth'),
    repairRenderDeps: () => ipcRenderer.invoke('overlay:repairRenderDeps'),
    getLastRenderError: () => ipcRenderer.invoke('overlay:getLastRenderError'),
    onRenderProgress: (callback) => {
        const handler = (_e, data) => callback(data);
        ipcRenderer.on('overlay:renderProgress', handler);
        return () => ipcRenderer.removeListener('overlay:renderProgress', handler);
    },
    listRenders: () => ipcRenderer.invoke('renders:list'),
    deleteRender: (name) => ipcRenderer.invoke('renders:delete', name),
    renameRender: (name, nextName) => ipcRenderer.invoke('renders:rename', name, nextName),
    revealRender: (name) => ipcRenderer.invoke('renders:reveal', name),
    addRenderToTimeline: (name) => ipcRenderer.invoke('renders:addToTimeline', name),
    deleteAllRenders: () => ipcRenderer.invoke('renders:deleteAll'),
    syncToMediaPool: () => ipcRenderer.invoke('renders:syncToMediaPool'),
    openFolder: () => ipcRenderer.invoke('renders:openFolder'),
    queue: (payload) => ipcRenderer.invoke('renders:queue', payload)
});

function createAgentBridge(prefix) {
    return {
        checkAuth: () => ipcRenderer.invoke(`${prefix}:checkAuth`),
        openLoginTerminal: () => ipcRenderer.invoke(`${prefix}:openLoginTerminal`),
        openProviderLoginTerminal: (providerId) => ipcRenderer.invoke(`${prefix}:openProviderLoginTerminal`, providerId),
        start: () => ipcRenderer.invoke(`${prefix}:start`),
        health: () => ipcRenderer.invoke(`${prefix}:health`),
        getLogs: (options) => ipcRenderer.invoke(`${prefix}:getLogs`, options),
        clearLogs: () => ipcRenderer.invoke(`${prefix}:clearLogs`),
        restart: () => ipcRenderer.invoke(`${prefix}:restart`),
        sendPrompt: (text) => ipcRenderer.invoke(`${prefix}:send`, text),
        repairRender: (payload) => ipcRenderer.invoke(`${prefix}:repairRender`, payload),
        abort: () => ipcRenderer.invoke(`${prefix}:abort`),
        onOutput: (callback) => ipcRenderer.on(`${prefix}:stdout`, (_e, data) => callback(data)),
        onError: (callback) => ipcRenderer.on(`${prefix}:stderr`, (_e, data) => callback(data)),
        onDone: (callback) => ipcRenderer.on(`${prefix}:done`, (_e, code) => callback(code)),
        onStatus: (callback) => ipcRenderer.on(`${prefix}:status`, (_e, data) => callback(data))
    };
}

contextBridge.exposeInMainWorld('agentAPI', createAgentBridge('agent'));
contextBridge.exposeInMainWorld('claudeAPI', createAgentBridge('claude'));

contextBridge.exposeInMainWorld('windowAPI', {
    resize: ({ width, height }) => ipcRenderer.invoke('window:resize', { width, height }),
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    close: () => ipcRenderer.invoke('window:close'),
    getState: () => ipcRenderer.invoke('window:getState'),
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url)
});

contextBridge.exposeInMainWorld('configAPI', {
    get: () => ipcRenderer.invoke('config:get'),
    set: (partial) => ipcRenderer.invoke('config:set', partial)
});

contextBridge.exposeInMainWorld('brandAPI', {
    get: () => ipcRenderer.invoke('brand:get'),
    set: (brandKit) => ipcRenderer.invoke('brand:set', brandKit)
});

contextBridge.exposeInMainWorld('templateAPI', {
    list: () => ipcRenderer.invoke('templates:list'),
    save: (template) => ipcRenderer.invoke('templates:save', template),
    delete: (id) => ipcRenderer.invoke('templates:delete', id),
    use: (id) => ipcRenderer.invoke('templates:use', id)
});

contextBridge.exposeInMainWorld('sessionsAPI', {
    list: (options) => ipcRenderer.invoke('sessions:list', options),
    get: (id) => ipcRenderer.invoke('sessions:get', id),
    create: (payload) => ipcRenderer.invoke('sessions:create', payload),
    update: (id, patch) => ipcRenderer.invoke('sessions:update', id, patch),
    delete: (id) => ipcRenderer.invoke('sessions:delete', id),
    setActive: (id) => ipcRenderer.invoke('sessions:setActive', id),
    getActive: () => ipcRenderer.invoke('sessions:getActive')
});

contextBridge.exposeInMainWorld('ographAPI', {
    list: () => ipcRenderer.invoke('ograph:list'),
    get: (id) => ipcRenderer.invoke('ograph:get', id),
    save: (payload) => ipcRenderer.invoke('ograph:save', payload),
    update: (id, patch) => ipcRenderer.invoke('ograph:update', id, patch),
    delete: (id) => ipcRenderer.invoke('ograph:delete', id),
    createFromGeneration: (payload) => ipcRenderer.invoke('ograph:createFromGeneration', payload),
    createFromManim: (payload) => ipcRenderer.invoke('ograph:createFromManim', payload),
    buildPrompt: (graph, action) => ipcRenderer.invoke('ograph:buildPrompt', graph, action)
});

contextBridge.exposeInMainWorld('manimAPI', {
    detect: (options) => ipcRenderer.invoke('manim:detect', options),
    getStarterScenes: () => ipcRenderer.invoke('manim:getStarterScenes'),
    buildPrompt: (payload) => ipcRenderer.invoke('manim:buildPrompt', payload),
    validateSource: (source) => ipcRenderer.invoke('manim:validateSource', source),
    renderScene: (payload) => ipcRenderer.invoke('manim:renderScene', payload)
});

contextBridge.exposeInMainWorld('assetAPI', {
    list: () => ipcRenderer.invoke('assets:list'),
    add: (payload) => ipcRenderer.invoke('assets:add', payload),
    update: (id, patch) => ipcRenderer.invoke('assets:update', id, patch),
    delete: (id) => ipcRenderer.invoke('assets:delete', id),
    reveal: (id) => ipcRenderer.invoke('assets:reveal', id),
    inspect: (id) => ipcRenderer.invoke('assets:inspect', id),
    extractColors: (id) => ipcRenderer.invoke('assets:extractColors', id),
    resolveHtml: (html, selectedAssetIds, options) => ipcRenderer.invoke('assets:resolveHtml', html, selectedAssetIds, options)
});

contextBridge.exposeInMainWorld('galleryAPI', {
    list: () => ipcRenderer.invoke('gallery:list'),
    use: (id) => ipcRenderer.invoke('gallery:use', id),
    importPack: () => ipcRenderer.invoke('templatePacks:import'),
    installPackFromUrl: (url) => ipcRenderer.invoke('templatePacks:installFromUrl', { url }),
    validatePack: (pack) => ipcRenderer.invoke('templatePacks:validate', pack)
});

contextBridge.exposeInMainWorld('captionAPI', {
    import: () => ipcRenderer.invoke('captions:import'),
    parse: (payload) => ipcRenderer.invoke('captions:parse', payload),
    generate: (payload) => ipcRenderer.invoke('captions:generate', payload)
});

contextBridge.exposeInMainWorld('roughCutAPI', {
    getSelectedMedia: () => ipcRenderer.invoke('roughCut:getSelectedMedia'),
    importTranscript: (payload) => ipcRenderer.invoke('roughCut:importTranscript', payload),
    buildCutPlan: (payload) => ipcRenderer.invoke('roughCut:buildCutPlan', payload),
    buildShortsPlan: (payload) => ipcRenderer.invoke('roughCut:buildShortsPlan', payload),
    validateCutPlan: (payload) => ipcRenderer.invoke('roughCut:validateCutPlan', payload),
    validateShortsPlan: (payload) => ipcRenderer.invoke('roughCut:validateShortsPlan', payload),
    applyCutPlan: (payload) => ipcRenderer.invoke('roughCut:applyCutPlan', payload),
    applyShortsPlan: (payload) => ipcRenderer.invoke('roughCut:applyShortsPlan', payload),
    exportIntelliScript: (payload) => ipcRenderer.invoke('roughCut:exportIntelliScript', payload),
    detectFeatures: () => ipcRenderer.invoke('roughCut:detectFeatures'),
    prepareNativeIntelliScript: (payload) => ipcRenderer.invoke('roughCut:prepareNativeIntelliScript', payload),
    listPlans: () => ipcRenderer.invoke('roughCut:listPlans'),
    getPlan: (id) => ipcRenderer.invoke('roughCut:getPlan', id),
    deletePlan: (id) => ipcRenderer.invoke('roughCut:deletePlan', id)
});

contextBridge.exposeInMainWorld('shortsAPI', {
    getSource: () => ipcRenderer.invoke('shorts:getSource'),
    importTranscript: (payload) => ipcRenderer.invoke('shorts:importTranscript', payload),
    buildCandidates: (payload) => ipcRenderer.invoke('shorts:buildCandidates', payload),
    validateCandidates: (payload) => ipcRenderer.invoke('shorts:validateCandidates', payload),
    createTimelines: (payload) => ipcRenderer.invoke('shorts:createTimelines', payload),
    packageSelected: (payload) => ipcRenderer.invoke('shorts:packageSelected', payload),
    detectTranscribers: () => ipcRenderer.invoke('shorts:detectTranscribers'),
    transcribeSource: (payload) => ipcRenderer.invoke('shorts:transcribeSource', payload),
    saveCandidateFeedback: (payload) => ipcRenderer.invoke('shorts:saveCandidateFeedback', payload),
    getCreatorProfile: () => ipcRenderer.invoke('shorts:getCreatorProfile'),
    exportMarkers: (payload) => ipcRenderer.invoke('shorts:exportMarkers', payload),
    listProjects: () => ipcRenderer.invoke('shorts:listProjects'),
    getProject: (id) => ipcRenderer.invoke('shorts:getProject', id),
    deleteProject: (id) => ipcRenderer.invoke('shorts:deleteProject', id)
});

contextBridge.exposeInMainWorld('variationAPI', {
    generate: (payload) => ipcRenderer.invoke('variations:generate', payload),
    generateMultiPrompt: (payload) => ipcRenderer.invoke('variations:generateMultiPrompt', payload)
});

contextBridge.exposeInMainWorld('debugAPI', {
    createBundle: (options) => ipcRenderer.invoke('debug:createBundle', options)
});

contextBridge.exposeInMainWorld('runtimeQAAPI', {
    run: () => ipcRenderer.invoke('runtimeQA:run')
});

contextBridge.exposeInMainWorld('showcaseAPI', {
    build: (options) => ipcRenderer.invoke('showcase:build', options)
});

contextBridge.exposeInMainWorld('updatesAPI', {
    check: (opts) => ipcRenderer.invoke('app:checkUpdate', opts),
    download: (opts) => ipcRenderer.invoke('app:downloadUpdate', opts),
    install: () => ipcRenderer.invoke('app:installStagedUpdate'),
    getStatus: () => ipcRenderer.invoke('app:getUpdateStatus'),
    onProgress: (callback) => {
        const handler = (_e, data) => callback(data);
        ipcRenderer.on('app:updateProgress', handler);
        return () => ipcRenderer.removeListener('app:updateProgress', handler);
    }
});

contextBridge.exposeInMainWorld('previewAPI', {
    getRealtimeBundle: () => ipcRenderer.invoke('preview:getRealtimeBundle')
});
