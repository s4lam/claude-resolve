const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const requiredFiles = [
    'plugin/src/components/App.jsx',
    'plugin/src/components/Sidebar.jsx',
    'plugin/src/components/WorkspaceShell.jsx',
    'plugin/src/components/WorkspaceRail.jsx',
    'plugin/src/components/InspectorPanel.jsx',
    'plugin/src/components/SidebarOgraph.jsx',
    'plugin/src/components/SidebarManimLab.jsx',
    'plugin/src/components/SidebarCreate.jsx',
    'plugin/src/components/SidebarTimeline.jsx',
    'plugin/src/components/SidebarAssetLibrary.jsx',
    'plugin/src/components/SidebarVariations.jsx',
    'plugin/src/components/SidebarCaptions.jsx',
    'plugin/src/components/SidebarPromptGallery.jsx',
    'plugin/src/components/SidebarRoughCut.jsx',
    'plugin/src/components/SidebarShortsStudio.jsx',
    'plugin/preload.js',
    'plugin/main.js'
];

for (const file of requiredFiles) {
    if (!fs.existsSync(path.join(root, file))) {
        throw new Error(`Missing ${file}`);
    }
}

const sidebar = fs.readFileSync(path.join(root, 'plugin/src/components/Sidebar.jsx'), 'utf8');
for (const tab of ['Sessions', 'Create', 'Timeline', 'Clip Finder', 'Rough Cut', 'Assets', 'Workflow Graph', 'Motion Diagram', 'Variations', 'Captions', 'Gallery', 'Templates', 'Renders']) {
    if (!sidebar.includes(tab)) throw new Error(`Missing tool tab ${tab}`);
}
for (const mode of ['create', 'produce', 'discover']) {
    if (!sidebar.includes(mode)) throw new Error(`Missing workspace mode ${mode}`);
}

const workspaceRail = fs.readFileSync(path.join(root, 'plugin/src/components/WorkspaceRail.jsx'), 'utf8');
for (const label of ['Create', 'Produce', 'Discover', 'Tools', 'Settings']) {
    if (!workspaceRail.includes(label)) throw new Error(`Missing workspace rail label ${label}`);
}

const inspector = fs.readFileSync(path.join(root, 'plugin/src/components/InspectorPanel.jsx'), 'utf8');
for (const label of ['Workflow Graph', 'Motion Diagram', 'Generation', 'Output']) {
    if (!inspector.includes(label)) throw new Error(`Missing inspector label ${label}`);
}

const preload = fs.readFileSync(path.join(root, 'plugin/preload.js'), 'utf8');
for (const api of ['timelineAPI', 'variationAPI', 'assetAPI', 'captionAPI', 'galleryAPI', 'roughCutAPI', 'shortsAPI', 'debugAPI', 'runtimeQAAPI', 'updatesAPI']) {
    if (!preload.includes(api)) throw new Error(`Missing preload API ${api}`);
}
if (!preload.includes('ographAPI')) throw new Error('Missing preload API ographAPI');
if (!preload.includes('createFromManim')) throw new Error('Missing ograph API method createFromManim');
if (!preload.includes('manimAPI')) throw new Error('Missing preload API manimAPI');
for (const method of ['validateSource', 'renderScene']) {
    if (!preload.includes(method)) throw new Error(`Missing manim API method ${method}`);
}
for (const method of ['detectTranscribers', 'transcribeSource', 'saveCandidateFeedback', 'getCreatorProfile', 'exportMarkers']) {
    if (!preload.includes(method)) throw new Error(`Missing shorts API method ${method}`);
}
for (const method of ['getRenderHealth', 'repairRenderDeps', 'getLastRenderError', 'openFolder']) {
    if (!preload.includes(method)) throw new Error(`Missing render diagnostics API method ${method}`);
}

const styles = fs.readFileSync(path.join(root, 'plugin/src/css/styles.css'), 'utf8');
for (const selector of ['.workspace-shell', '.workspace-rail', '.workspace-inspector', '.ograph-section', '.ograph-node', '.ograph-node-detail', '.manim-section', '.manim-health', '.manim-source-panel', '.manim-ograph-status']) {
    if (!styles.includes(selector)) throw new Error(`Missing workspace CSS selector ${selector}`);
}
if (!styles.includes('.sb-tools-view .tools-panel') || !styles.includes('overflow-y: auto')) {
    throw new Error('Tools sidebar scroll styles missing.');
}
if (!styles.includes('.render-health-card')) throw new Error('Render health styles missing.');

console.log('smoke plugin UI checks passed');
