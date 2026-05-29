const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const workflowPath = path.join(__dirname, '..', 'src', 'data', 'createWorkflow.js');
const source = fs.readFileSync(workflowPath, 'utf8')
    .replace(/export const /g, 'const ')
    .replace(/export function /g, 'function ')
    + '\nmodule.exports = { CREATE_TYPES, BACKGROUND_MODES, ASPECT_RATIOS, STYLE_LEVELS, STYLE_LOCKS, buildStyleLockLines, buildCreatePrompt };';
const sandbox = { module: { exports: {} }, exports: {} };
vm.runInNewContext(source, sandbox, { filename: workflowPath });
const workflow = sandbox.module.exports;

const base = {
    type: 'logo-reveal',
    idea: 'Premium channel ident with clean geometry',
    duration: 5,
    backgroundMode: 'transparent',
    aspectRatio: 'timeline',
    styleLevel: 'cinematic',
    selectedAssets: 1,
    config: { width: 1920, height: 1080, fps: 25 },
    timelineContext: { timelineName: 'Main Timeline', currentTimecode: '01:00:00:00', selectedClips: [] }
};

const prompt = workflow.buildCreatePrompt(base);
assert(prompt.includes('Create a refined logo reveal animation.'));
assert(prompt.includes('Duration: 5 seconds.'));
assert(prompt.includes('Background mode: transparent.'));
assert(prompt.includes('Aspect ratio: timeline. Canvas: 1920x1080 at 25fps.'));
assert(prompt.includes('Style intensity: cinematic.'));
assert(prompt.includes('Set html, body, and any full-stage backgrounds to transparent.'));
assert(prompt.includes('Do not add opaque full-frame rectangles.'));

const locked = workflow.buildCreatePrompt({
    ...base,
    locks: {
        logo: true,
        colors: true,
        typography: true,
        layout: true,
        animationOnly: true
    },
    useLatestStyle: true,
    latestGeneration: {
        name: 'PremiumIdent',
        previousPrompt: 'Original premium ident prompt',
        html: '<html><body><script>window.getAnimationDuration=()=>5;window.renderFrame=()=>{};</script></body></html>'
    }
});
assert(locked.includes('Style locks:'));
assert(locked.includes('Keep selected logo/image assets recognizable'));
assert(locked.includes('Keep the same color palette'));
assert(locked.includes('Keep the same typography direction'));
assert(locked.includes('Keep the same composition scale'));
assert(locked.includes('Only change animation timing'));
assert(locked.includes('Use latest result as style reference: PremiumIdent.'));
assert(locked.includes('Previous prompt: Original premium ident prompt'));
assert(locked.includes('Latest generated HTML context:'));
assert(locked.includes('window.renderFrame'));

const ignoredLatest = workflow.buildCreatePrompt({
    ...base,
    useLatestStyle: false,
    latestGeneration: {
        name: 'ShouldNotAppear',
        html: '<html></html>'
    }
});
assert(!ignoredLatest.includes('ShouldNotAppear'));
assert(!ignoredLatest.includes('Latest generated HTML context:'));

console.log('create workflow tests passed');
