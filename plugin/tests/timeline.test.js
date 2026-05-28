const assert = require('assert');
const { buildTimelinePrompt, inferMarkerAction, normalizeMarkers, normalizeSelectedClips, normalizeTimelineContext, secondsToTimecode, timecodeToSeconds } = require('../ipc/timeline');

assert.strictEqual(timecodeToSeconds('01:02:03:12', 24), 3723.5);
assert.strictEqual(secondsToTimecode(10, 25), '00:00:10:00');

const context = normalizeTimelineContext({
  available: true,
  projectName: 'Project',
  timelineName: 'Timeline 1',
  fps: '25',
  width: '1920',
  height: '1080',
  currentTimecode: '00:00:10:00',
  selectedClips: [{ name: 'Interview A', startFrame: 20, endFrame: 80, mediaType: 'Video' }],
  markers: {
    250: { name: 'Lower third: Host', note: 'Add speaker name', color: 'Blue', duration: 50 },
    500: { name: 'Chapter title', note: 'New section' }
  }
}, { fps: 30, width: 1280, height: 720 });

assert.strictEqual(context.fps, 25);
assert.strictEqual(context.width, 1920);
assert.strictEqual(context.playheadFrame, 250);
assert.strictEqual(context.selectedClips.length, 1);
assert.strictEqual(context.markers.length, 2);
assert.strictEqual(context.markers[0].action, 'lower-third');

const prompt = buildTimelinePrompt({ type: 'lower-third', context });
assert(prompt.includes('lower third'));
assert(prompt.includes('Timeline 1'));
assert(prompt.includes('1920x1080'));
assert(prompt.includes('00:00:10:00'));
assert(prompt.includes('Interview A'));

const markerPrompt = buildTimelinePrompt({ type: 'marker', context, marker: context.markers[0] });
assert(markerPrompt.includes('Marker context'));
assert(markerPrompt.includes('Lower third: Host'));
assert(markerPrompt.includes('00:00:10:00'));

assert.strictEqual(inferMarkerAction({ name: 'Transition wipe' }), 'transition');
const markers = normalizeMarkers([{ frame: 20, name: 'Title card' }], { fps: 10, playheadFrame: 0 });
assert.strictEqual(markers[0].timecode, '00:00:02:00');

const clips = normalizeSelectedClips({ a: { 'Clip Name': 'Clip A' }, b: { fileName: 'clip-b.mov' } });
assert.strictEqual(clips.length, 2);
assert.strictEqual(clips[0].name, 'Clip A');

console.log('timeline tests passed');
