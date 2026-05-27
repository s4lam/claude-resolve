const assert = require('assert');
const { buildCaptionPrompt, parseCaptionText } = require('../ipc/captions');

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

const vtt = parseCaptionText(`WEBVTT

00:00:00.000 --> 00:00:01.200
Fast intro`, 'vtt');
assert.strictEqual(vtt.length, 1);

const prompt = buildCaptionPrompt({ cues, style: 'karaoke', width: 1920, height: 1080, fps: 25 });
assert(prompt.includes('karaoke'));
assert(prompt.includes('Welcome to the show'));
assert(prompt.includes('transparent ProRes 4444 overlay'));

console.log('captions tests passed');
