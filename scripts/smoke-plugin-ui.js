const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const requiredFiles = [
    'plugin/src/components/App.jsx',
    'plugin/src/components/Sidebar.jsx',
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
for (const tab of ['Sessions', 'Create', 'Timeline', 'Clip Finder', 'Rough Cut', 'Assets', 'Variations', 'Captions', 'Gallery', 'Templates', 'Renders']) {
    if (!sidebar.includes(tab)) throw new Error(`Missing tool tab ${tab}`);
}

const preload = fs.readFileSync(path.join(root, 'plugin/preload.js'), 'utf8');
for (const api of ['timelineAPI', 'variationAPI', 'assetAPI', 'captionAPI', 'galleryAPI', 'roughCutAPI', 'shortsAPI', 'debugAPI', 'updatesAPI']) {
    if (!preload.includes(api)) throw new Error(`Missing preload API ${api}`);
}
for (const method of ['detectTranscribers', 'transcribeSource', 'saveCandidateFeedback', 'getCreatorProfile', 'exportMarkers']) {
    if (!preload.includes(method)) throw new Error(`Missing shorts API method ${method}`);
}

const styles = fs.readFileSync(path.join(root, 'plugin/src/css/styles.css'), 'utf8');
if (!styles.includes('.sb-tools-view .tools-panel') || !styles.includes('overflow-y: auto')) {
    throw new Error('Tools sidebar scroll styles missing.');
}

console.log('smoke plugin UI checks passed');
