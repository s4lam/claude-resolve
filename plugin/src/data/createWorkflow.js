export const CREATE_TYPES = [
    {
        id: 'title-card',
        label: 'Title',
        help: 'Full-frame opener, chapter card, or segment title.',
        prompt: 'Create a polished title card for the current video.'
    },
    {
        id: 'lower-third',
        label: 'Lower Third',
        help: 'Name/title/location overlay with alpha.',
        prompt: 'Create a clean transparent lower third overlay.'
    },
    {
        id: 'transition',
        label: 'Transition',
        help: 'Short bridge at the playhead.',
        prompt: 'Create a short transparent transition overlay.'
    },
    {
        id: 'captions',
        label: 'Captions',
        help: 'Animated caption look or reusable caption system.',
        prompt: 'Create an animated transparent caption overlay style.'
    },
    {
        id: 'logo-reveal',
        label: 'Logo Reveal',
        help: 'Brand or channel mark reveal.',
        prompt: 'Create a refined logo reveal animation.'
    },
    {
        id: 'product-reveal',
        label: 'Product Reveal',
        help: 'Product shot, app, object, or feature reveal.',
        prompt: 'Create a premium product reveal motion graphic.'
    },
    {
        id: 'social-repurpose',
        label: 'Social Cutdown',
        help: 'Safe-area title/caption system for shorts, reels, or posts.',
        prompt: 'Create a social-first motion graphic that can be repurposed across vertical, square, and horizontal edits.'
    }
];

export const BACKGROUND_MODES = [
    ['transparent', 'Transparent overlay'],
    ['full-frame', 'Full-frame background'],
    ['asset', 'Use attached asset'],
    ['auto', 'Auto']
];

export const ASPECT_RATIOS = [
    ['timeline', 'Timeline settings'],
    ['16:9', '16:9 horizontal'],
    ['9:16', '9:16 vertical'],
    ['1:1', '1:1 square'],
    ['4:5', '4:5 social'],
    ['multi-social', 'Multi social safe areas']
];

export const STYLE_LEVELS = [
    ['clean', 'Clean'],
    ['balanced', 'Balanced'],
    ['cinematic', 'Cinematic'],
    ['bold', 'Bold']
];

export const STYLE_LOCKS = [
    {
        id: 'logo',
        label: 'Keep logo',
        instruction: '- Keep selected logo/image assets recognizable, full quality, and do not redraw them.'
    },
    {
        id: 'colors',
        label: 'Keep colors',
        instruction: '- Keep the same color palette and brand color relationships.'
    },
    {
        id: 'typography',
        label: 'Keep type',
        instruction: '- Keep the same typography direction, font mood, weight contrast, and text hierarchy.'
    },
    {
        id: 'layout',
        label: 'Keep layout',
        instruction: '- Keep the same composition scale, safe margins, and major layout relationships.'
    },
    {
        id: 'animationOnly',
        label: 'Only motion',
        instruction: '- Only change animation timing and motion; do not change layout, copy, colors, typography, or assets.'
    }
];

export function buildStyleLockLines(locks = {}) {
    return STYLE_LOCKS
        .filter(lock => !!locks?.[lock.id])
        .map(lock => lock.instruction);
}

export function buildCreatePrompt({
    type,
    idea,
    duration,
    backgroundMode,
    aspectRatio,
    styleLevel,
    selectedAssets,
    config,
    timelineContext,
    locks = {},
    useLatestStyle = false,
    latestGeneration = null
}) {
    const chosen = CREATE_TYPES.find(item => item.id === type) || CREATE_TYPES[0];
    const fps = config?.fps || 25;
    const width = config?.width || 1920;
    const height = config?.height || 1080;
    const lockText = buildStyleLockLines(locks);
    const hasLatestStyle = !!(useLatestStyle && latestGeneration?.html);
    const assetText = selectedAssets > 0
        ? `Use the ${selectedAssets} attached local asset${selectedAssets === 1 ? '' : 's'} when relevant. Keep referenced assets recognizable and use exact file URLs if provided.`
        : 'No assets are attached.';
    const clipLines = (timelineContext?.selectedClips || []).map(clip => [
        clip.name || clip.fileName || 'Selected clip',
        clip.mediaType ? `type ${clip.mediaType}` : null,
        clip.startFrame !== null && clip.endFrame !== null ? `frames ${clip.startFrame}-${clip.endFrame}` : null
    ].filter(Boolean).join(' / '));

    return [
        chosen.prompt,
        idea ? `Creative brief: ${idea}` : 'Creative brief: make a useful universal creator motion graphic.',
        `Duration: ${duration || 5} seconds.`,
        `Background mode: ${backgroundMode}.`,
        `Aspect ratio: ${aspectRatio}. Canvas: ${width}x${height} at ${fps}fps.`,
        aspectRatio === 'multi-social'
            ? 'Design with visible safe-area guides in mind for 16:9, 9:16, 1:1, and 4:5 crops. Keep essential text and logos inside the central safe zone.'
            : 'Respect the selected aspect ratio and keep important text inside safe margins.',
        timelineContext?.timelineName ? `Timeline: ${timelineContext.timelineName}.` : 'Timeline context unavailable.',
        timelineContext?.currentTimecode ? `Playhead: ${timelineContext.currentTimecode}.` : 'Playhead unavailable.',
        clipLines.length ? `Selected clip context:\n${clipLines.join('\n')}` : 'Selected clip context unavailable.',
        `Style intensity: ${styleLevel}.`,
        lockText.length ? 'Style locks:' : '',
        ...lockText,
        hasLatestStyle ? `Use latest result as style reference: ${latestGeneration.previousName || latestGeneration.name || 'Previous Resolve AI result'}.` : '',
        hasLatestStyle && latestGeneration.previousPrompt ? `Previous prompt: ${latestGeneration.previousPrompt}` : '',
        hasLatestStyle ? 'Latest generated HTML context:' : '',
        hasLatestStyle ? '```html' : '',
        hasLatestStyle ? latestGeneration.html : '',
        hasLatestStyle ? '```' : '',
        assetText,
        'Keep the output practical for DaVinci Resolve editors and universal creator/business/social/video workflows.',
        'Use window.renderFrame(frame, fps) and window.getAnimationDuration().',
        backgroundMode === 'transparent'
            ? 'Set html, body, and any full-stage backgrounds to transparent. Do not add opaque full-frame rectangles.'
            : 'Use a coherent full-frame visual system if a background is needed.',
        'Return one complete HTML file.'
    ].join('\n');
}
