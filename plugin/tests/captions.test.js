const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  analyzeCaptionCues,
  buildCaptionOverlayRender,
  buildCaptionPrompt,
  buildFuscriptArgs,
  buildNativeLuaJob,
  buildNativeSelfTestPayload,
  buildNativeTextPayload,
  buildNativeWrapperSource,
  captionFitRules,
  deleteCaptionProject,
  detectNativeText,
  estimateWordTimings,
  getCaptionProject,
  installNativeTemplateAsset,
  listCaptionProjects,
  nativeDebugPayload,
  nativeCueRows,
  parseCaptionText,
  parseNativeTextResult,
  prepareNativeTextJob,
  regroupCues,
  saveCaptionProject,
  validateCaptionFit
} = require('../ipc/captions');

const cues = parseCaptionText(`1
00:00:01,000 --> 00:00:02,500
Welcome to the show

2
00:00:03.000 --> 00:00:04.000
Let's begin`, 'srt');

assert.strictEqual(cues.length, 2);
assert.strictEqual(cues[0].start, 1);
assert.strictEqual(cues[0].end, 2.5);
assert.strictEqual(cues[1].text, "Let's begin");

const styledCue = parseCaptionText(`1
00:00:00,000 --> 00:00:01,000
<b>Hello</b> <i>world</i> &amp; friends`, 'srt');
assert.strictEqual(styledCue[0].text, 'Hello world & friends');

const vtt = parseCaptionText(`WEBVTT

00:00:00.000 --> 00:00:01.200
Fast intro`, 'vtt');
assert.strictEqual(vtt.length, 1);
assert.strictEqual(vtt[0].end, 1.2);

const timestampedTxt = parseCaptionText(`[00:00:05.500] Timestamped text works
00:00:07.000 --> 00:00:08.000 second cue`, 'txt');
assert.strictEqual(timestampedTxt.length, 2);
assert.strictEqual(timestampedTxt[0].start, 5.5);

const untimestampedTxt = parseCaptionText('No timing here', 'txt');
assert.strictEqual(untimestampedTxt.length, 0);

const prompt = buildCaptionPrompt({ cues, style: 'karaoke', width: 1920, height: 1080, fps: 25 });
assert(prompt.includes('transparent caption overlay'));
assert(prompt.includes('Style: karaoke'));
assert(prompt.includes('<caption_words>'));
assert(prompt.includes('Caption stats'));

const verticalPrompt = buildCaptionPrompt({ cues, style: 'social shorts', width: 1080, height: 1920, fps: 30 });
assert(verticalPrompt.includes('Output orientation: vertical'));
assert(verticalPrompt.includes('x 7%-93%, y 12%-86%'));
assert(verticalPrompt.includes('max-width 86%'));
assert(verticalPrompt.includes('max 2 visible lines'));
assert(verticalPrompt.includes('no clipped words'));

const boldHookPrompt = buildCaptionPrompt({ cues, style: 'bold hook', width: 1080, height: 1920, fps: 30 });
assert(boldHookPrompt.includes('Style: bold hook'));
assert(boldHookPrompt.includes('<caption_words>'));

const documentaryPrompt = buildCaptionPrompt({ cues, style: 'documentary', width: 1080, height: 1920, fps: 30 });
assert(documentaryPrompt.includes('Style: documentary'));

const verticalFit = captionFitRules({ width: 1080, height: 1920, style: 'bold hook' });
assert.strictEqual(verticalFit.orientation, 'vertical');
assert.strictEqual(verticalFit.maxLines, 2);

const timings = estimateWordTimings(cues[0]);
assert.strictEqual(timings.length, 4);
assert.strictEqual(timings[0].word, 'Welcome');
assert.strictEqual(timings[0].start, 1);
assert.strictEqual(timings[timings.length - 1].end, 2.5);

const regrouped = regroupCues(parseCaptionText(`1
00:00:00,000 --> 00:00:06,000
one two three four five six seven eight`, 'srt'), { mode: 'punchy', maxWords: 3, maxChars: 30 });
assert.strictEqual(regrouped.cues.length, 3);
assert.strictEqual(regrouped.cues[0].text, 'one two three');
assert(regrouped.cues[0].end <= regrouped.cues[1].start);

const single = regroupCues(cues, { mode: 'single' });
assert(single.cues.every(cue => cue.text.split(/\s+/).length === 1));

const fitWarnings = validateCaptionFit([{ start: 0, end: 1, text: 'This caption is intentionally too long for vertical shorts and should warn loudly' }], { width: 1080, height: 1920, style: 'bold hook' });
assert(fitWarnings.warnings.length > 0);

const spanCues = parseCaptionText(`1
00:00:10,000 --> 00:00:12,000
Caption starts ten seconds in

2
00:00:48,000 --> 00:00:50,000
Caption ends at fifty seconds`, 'srt');
const overlayRender = buildCaptionOverlayRender({
  cues: spanCues,
  style: 'clean',
  width: 1920,
  height: 1080,
  fps: 25,
  timelineContext: {
    fps: 25,
    selectedClips: [{ name: 'Interview.mov', startFrame: 1000, durationFrames: 1500 }],
    playheadFrame: 200
  }
});
assert.strictEqual(overlayRender.success, true);
assert.strictEqual(overlayRender.metadata.duration, 40);
assert.strictEqual(overlayRender.metadata.totalFrames, 1000);
assert.strictEqual(overlayRender.metadata.placementRecordFrame, 1250);
assert(overlayRender.html.includes('window.getAnimationDuration = () => DURATION;'));
assert(overlayRender.html.includes('const time = FIRST_CUE_START + frame / safeFps;'));
assert(!overlayRender.warnings.some(warning => /No selected clip/i.test(warning)));

const nativePayload = buildNativeTextPayload({
  cues: [{ start: 0, end: 1, text: 'hello"); os.execute("bad") --' }],
  templateName: 'Resolve AI Caption',
  fps: 30,
  recordFrame: 1000
});
assert.strictEqual(nativePayload.cues.length, 1);
assert.strictEqual(nativePayload.recordFrame, 1000);
assert(nativePayload.cues[0].text.includes('os.execute'));
assert(!JSON.stringify(nativePayload).includes('CAPTION_JOB'));
const cueRows = nativeCueRows(nativePayload);
assert(cueRows.includes('hello"); os.execute("bad") --'));
assert.strictEqual(cueRows.split('\t').length, 3);

const nativeFromCues = prepareNativeTextJob({ cues, fps: 30 });
assert.strictEqual(nativeFromCues.success, true);
assert.strictEqual(nativeFromCues.cueCount, 2);
assert.strictEqual(nativeFromCues.payload.cues.length, 2);
const nativeLuaJob = buildNativeLuaJob(nativeFromCues.payload, 'caption-cues.tsv');
assert.strictEqual(nativeLuaJob.cueCount, 2);
assert.strictEqual(nativeLuaJob.cues.length, 2);
assert.strictEqual(nativeLuaJob.cueFile, 'caption-cues.tsv');
assert(nativeLuaJob.bridgeVersion);

const selfTestPayload = buildNativeSelfTestPayload({ fps: 24, templateName: 'Resolve AI Caption' });
assert.strictEqual(selfTestPayload.cues.length, 2);
assert.strictEqual(selfTestPayload.templateName, 'Resolve AI Caption');

const debugPayload = nativeDebugPayload({ ...nativeLuaJob, rawText: 'full transcript should not be copied' }, 'caption.lua', 'caption.tsv');
assert.strictEqual(debugPayload.cueCount, 2);
assert(!JSON.stringify(debugPayload).includes('full transcript should not be copied'));
assert(debugPayload.firstCue.textPreview.includes('Welcome'));
const wrapperSource = buildNativeWrapperSource(nativeLuaJob, 'caption.tsv', 'caption-debug.json');
assert(wrapperSource.includes('CAPTION_CUE_ROWS='));
assert(wrapperSource.includes('CAPTION_NATIVE_CUES='));
assert(wrapperSource.includes('cues=CAPTION_NATIVE_CUES'));
assert(wrapperSource.includes('templateAssetPath='));
assert(wrapperSource.includes('recordFrame='));
assert(wrapperSource.includes('Welcome to the show'));
assert(wrapperSource.includes('cueCount=2'));
assert(wrapperSource.includes('Resolve AI Native Text+ bridge follows'));
assert(!wrapperSource.includes('dofile('));

const luaSource = fs.readFileSync(path.join(__dirname, '..', 'lua', 'resolve_ai_caption_native.lua'), 'utf8');
assert(luaSource.includes('Bridge mismatch: cueCount was '));
assert(luaSource.includes('CAPTION_CUE_ROWS'));
assert(luaSource.includes('CAPTION_NATIVE_CUES'));
assert(luaSource.includes('AppendToTimeline'));
assert(!luaSource.includes('InsertFusionTitleIntoTimeline'));
assert(!luaSource.includes('InsertTitleIntoTimeline'));
assert(luaSource.includes('INFO: native bridge'));

const nativeFromRawText = prepareNativeTextJob({
  cues: [],
  rawText: `1
00:00:00,000 --> 00:00:01,000
Raw SRT cue`,
  format: 'srt',
  fps: 30
});
assert.strictEqual(nativeFromRawText.success, true);
assert.strictEqual(nativeFromRawText.cueCount, 1);
assert.strictEqual(nativeFromRawText.payload.cues[0].text, 'Raw SRT cue');

const nativeFromUntimedText = prepareNativeTextJob({ cues: [], rawText: 'No timing here', format: 'txt' });
assert.strictEqual(nativeFromUntimedText.success, false);
assert.strictEqual(nativeFromUntimedText.cueCount, 0);
assert(nativeFromUntimedText.error.includes('No timestamped cues'));

const missingNative = detectNativeText({ fuscriptPath: path.join(os.tmpdir(), 'missing-fuscript'), templateName: 'Resolve AI Caption' });
assert.strictEqual(missingNative.ready, false);
assert(missingNative.bridgeVersion);
assert.strictEqual(missingNative.inlineCueSupport, true);
assert(missingNative.templateAssetPath);
const disabledNative = detectNativeText({ fuscriptPath: process.execPath, templateName: 'Resolve AI Caption' });
assert.strictEqual(disabledNative.ready, true);
assert.strictEqual(disabledNative.bridgeReady, true);
assert.strictEqual(disabledNative.directCreationDisabled, false);
assert.strictEqual(disabledNative.durationUnsupported, false);
const installedTemplateAsset = installNativeTemplateAsset();
assert.strictEqual(installedTemplateAsset.success, false);
assert.strictEqual(installedTemplateAsset.manualRequired, true);
assert.deepStrictEqual(buildFuscriptArgs('caption.lua'), ['-l', 'lua', 'caption.lua']);
assert.deepStrictEqual(parseNativeTextResult('OK: created 3 native captions').created, 3);
assert.strictEqual(parseNativeTextResult('INFO: received 2 native caption cues').luaReceivedCueCount, 2);
assert.strictEqual(parseNativeTextResult('OK: created 0 native captions').zeroCreated, true);
assert.strictEqual(parseNativeTextResult('ERROR: Caption template not found').error, 'Caption template not found');
assert.strictEqual(parseNativeTextResult('ERROR: Resolve inserted a Text+ title, but ignored scripted duration trimming. Native per-cue Text+ creation is unavailable in this Resolve scripting environment.').durationUnsupported, true);

const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-ai-caption-test-'));
const saved = saveCaptionProject({ title: 'Round trip', cues, rawText: 'raw srt text', format: 'srt', style: 'clean' }, projectDir);
assert(saved.id);
assert.strictEqual(listCaptionProjects(projectDir).length, 1);
assert.strictEqual(getCaptionProject(saved.id, projectDir).title, 'Round trip');
assert.strictEqual(getCaptionProject(saved.id, projectDir).rawText, 'raw srt text');
assert.strictEqual(getCaptionProject(saved.id, projectDir).format, 'srt');
deleteCaptionProject(saved.id, projectDir);
assert.strictEqual(listCaptionProjects(projectDir).length, 0);

const analysis = analyzeCaptionCues(cues);
assert.strictEqual(analysis.cueCount, 2);
assert.strictEqual(analysis.wordCount, 6);
assert.strictEqual(analysis.duration, 3);

console.log('captions tests passed');
