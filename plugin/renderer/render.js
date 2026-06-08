/*
 * Resolve AI — Playwright .mov Renderer
 *
 * Pre-loads via page.addInitScript (before any HTML <script>):
 *   - window.React, window.ReactDOM (React 18 UMD)
 *   - window.Motion             (Framer Motion v10 UMD; exposes motion, AnimatePresence, etc.)
 *   - @font-face for "Bricolage Grotesque", "Fraunces", "JetBrains Mono"
 *   - deterministic clock hijack: performance.now / Date.now /
 *     requestAnimationFrame / Element.prototype.animate (WAAPI)
 *
 * Modes (auto-detected per HTML):
 *   - frame:            HTML implements window.renderFrame(frame, fps); renderer
 *                       calls it for each frame then screenshots.
 *   - realtime-precise: HTML doesn't implement renderFrame. The clock hijack
 *                       (installed before any HTML script) freezes time, so
 *                       React/Framer Motion mount at t=0 with entrance
 *                       animations queued; the renderer then steps time
 *                       manually so springs, layout and WAAPI-accelerated
 *                       animations settle deterministically per frame.
 *
 * Required HTML API:
 *   - window.getAnimationDuration() -> positive number (seconds). Hard-clamped at
 *     MAX_DURATION_SEC; durations above that are clamped with a 'warning' emit.
 *
 * Outputs ProRes 4444 .mov (yuva444p10le, alpha channel).
 * JSON progress lines emitted to stdout for the plugin's IPC stream.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawnSync } = require('child_process');
const { chromium } = require('playwright');

const RENDERER_DIR = __dirname;
const VENDOR_DIR = path.join(RENDERER_DIR, 'vendor');
const FONTS_DIR = path.join(RENDERER_DIR, 'fonts');

const MAX_DURATION_SEC = 30;
const FONT_READY_TIMEOUT_MS = 5000;

const UMD_FILES = [
    path.join(VENDOR_DIR, 'react.production.min.js'),
    path.join(VENDOR_DIR, 'react-dom.production.min.js'),
    path.join(VENDOR_DIR, 'framer-motion.js'),
];

// [family, file, format, weight-range]
const FONT_FACES = [
    ['Bricolage Grotesque', path.join(FONTS_DIR, 'BricolageGrotesque-VF.ttf'), 'truetype', '200 800'],
    ['Fraunces', path.join(FONTS_DIR, 'Fraunces-VF.woff2'), 'woff2', '100 900'],
    ['JetBrains Mono', path.join(FONTS_DIR, 'JetBrainsMono-VF.woff2'), 'woff2', '100 800'],
];

function defaultFfmpegPath() {
    if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
    try {
        const bundled = require('ffmpeg-static');
        if (bundled && fs.existsSync(bundled)) return bundled;
    } catch (_err) {
        // The main process normally passes --ffmpeg. This fallback keeps the
        // renderer usable from the command line and installer self-tests.
    }
    return 'ffmpeg';
}

function emit(msg) {
    process.stdout.write(JSON.stringify(msg) + '\n');
}

function pad6(n) {
    return String(n).padStart(6, '0');
}

// Deterministic clock + animation hijack. Installed via addInitScript so it
// runs before ANY HTML <script> — React and Framer Motion mount on a clock
// frozen at t=0, with their entrance animations queued, not played:
//   - performance.now / Date.now -> return window.__renderTime while active
//   - requestAnimationFrame      -> callbacks queued, fired only by __stepFrame
//   - Element.prototype.animate  -> WAAPI animations paused on creation and
//     driven by __stepFrame. FM v10 offloads opacity/transform to WAAPI, which
//     the performance.now / rAF overrides alone cannot reach — without this an
//     entrance animation plays in real wall-clock time during page load and is
//     already settled before the first frame is stepped.
const TIME_HIJACK = `
(() => {
    if (window.__renderHijack) return;
    window.__renderHijack = true;
    window.__renderTime = 0;
    window.__renderActive = true;

    const origPerfNow = performance.now.bind(performance);
    performance.now = () => window.__renderActive ? window.__renderTime : origPerfNow();
    const origDateNow = Date.now.bind(Date);
    Date.now = () => window.__renderActive ? window.__renderTime : origDateNow();

    const callbacks = [];
    window.requestAnimationFrame = (cb) => { callbacks.push(cb); return callbacks.length; };

    // WAAPI: pause every animation on creation, remember the render-time it
    // was created at, then drive its currentTime from __stepFrame.
    const waapiAnims = [];
    const origAnimate = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
        const anim = origAnimate.call(this, keyframes, options);
        if (window.__renderActive) {
            try { anim.pause(); } catch (_) {}
            waapiAnims.push({ anim: anim, startTime: window.__renderTime });
        }
        return anim;
    };

    window.__stepFrame = (timeMs) => {
        window.__renderTime = timeMs;
        const cbs = callbacks.splice(0);
        cbs.forEach((cb) => { try { cb(timeMs); } catch (_) {} });
        for (const rec of waapiAnims) {
            try {
                const local = timeMs - rec.startTime;
                rec.anim.currentTime = local < 0 ? 0 : local;
            } catch (_) {}
        }
    };
})();
`;

// Time hijack + concatenated UMD bundles + font injector. Runs in the page's
// main world before any HTML script. UMDs assign window.React / window.ReactDOM
// / window.Motion themselves; font injector polls for <head> then appends a
// <style> with @font-face rules using file:// URLs.
function buildInitScript() {
    const umdBlobs = [];
    for (const p of UMD_FILES) {
        if (!fs.existsSync(p)) throw new Error(`Missing vendor file: ${p}`);
        umdBlobs.push(fs.readFileSync(p, 'utf-8'));
    }

    const fontRules = [];
    for (const [family, p, fmt, weightRange] of FONT_FACES) {
        if (!fs.existsSync(p)) throw new Error(`Missing font file: ${p}`);
        const uri = pathToFileURL(p).href; // absolute file:// URL
        fontRules.push(
            `@font-face { ` +
            `font-family: "${family}"; ` +
            `src: url("${uri}") format("${fmt}"); ` +
            `font-weight: ${weightRange}; ` +
            `font-display: block; ` +
            `}`
        );
    }
    const fontCss = fontRules.join(' ');

    const fontInjector =
        '(function(){' +
        'function inject(){' +
        'if(!document.head){setTimeout(inject,0);return;}' +
        "if(document.getElementById('__cr_fonts'))return;" +
        "var s=document.createElement('style');" +
        "s.id='__cr_fonts';" +
        `s.textContent=${JSON.stringify(fontCss)};` +
        'document.head.appendChild(s);' +
        '}' +
        'inject();' +
        '})();';

    return TIME_HIJACK + '\n' + umdBlobs.join('\n') + '\n' + fontInjector;
}

async function detectMode(page) {
    const hasRenderFrame = await page.evaluate("typeof window.renderFrame === 'function'");
    return hasRenderFrame ? 'frame' : 'realtime-precise';
}

async function fitPageToViewport(page, args) {
    await page.evaluate(({ targetWidth, targetHeight }) => {
        function numericPx(value) {
            const n = parseFloat(value);
            return Number.isFinite(n) && n > 0 ? n : null;
        }

        function findSourceSize() {
            const selectors = ['#stage', '.stage', '#root > *', '#root', '.overlay', '.canvas', 'body'];
            for (const selector of selectors) {
                const el = document.querySelector(selector);
                if (!el) continue;
                const style = getComputedStyle(el);
                const width = numericPx(style.width) || el.getBoundingClientRect().width;
                const height = numericPx(style.height) || el.getBoundingClientRect().height;
                if (width && height && (Math.abs(width - targetWidth) > 2 || Math.abs(height - targetHeight) > 2)) {
                    return { width, height };
                }
            }
            return null;
        }

        if (document.getElementById('__resolve_ai_fit_root')) return;
        const source = findSourceSize();
        if (!source) return;

        const scale = Math.min(targetWidth / source.width, targetHeight / source.height);
        if (!Number.isFinite(scale) || scale <= 0) return;

        const bodyStyle = getComputedStyle(document.body);
        const htmlStyle = getComputedStyle(document.documentElement);
        const inheritedBackground = bodyStyle.background !== 'rgba(0, 0, 0, 0)' && bodyStyle.background !== 'none'
            ? bodyStyle.background
            : htmlStyle.background;

        const root = document.createElement('div');
        root.id = '__resolve_ai_fit_root';
        root.style.position = 'absolute';
        root.style.left = `${(targetWidth - source.width * scale) / 2}px`;
        root.style.top = `${(targetHeight - source.height * scale) / 2}px`;
        root.style.width = `${source.width}px`;
        root.style.height = `${source.height}px`;
        root.style.transformOrigin = 'top left';
        root.style.transform = `scale(${scale})`;
        root.style.overflow = 'hidden';
        root.style.background = inheritedBackground;

        const children = Array.from(document.body.childNodes);
        children.forEach(child => {
            if (child !== root) root.appendChild(child);
        });
        document.body.appendChild(root);

        document.documentElement.style.width = `${targetWidth}px`;
        document.documentElement.style.height = `${targetHeight}px`;
        document.documentElement.style.margin = '0';
        document.documentElement.style.overflow = 'hidden';
        document.body.style.width = `${targetWidth}px`;
        document.body.style.height = `${targetHeight}px`;
        document.body.style.margin = '0';
        document.body.style.overflow = 'hidden';
        document.body.style.background = 'transparent';
    }, { targetWidth: args.width, targetHeight: args.height });
}

async function renderFrameMode(page, args, framesDir, totalFrames) {
    for (let frame = 0; frame < totalFrames; frame++) {
        await page.evaluate(`window.renderFrame(${frame}, ${args.fps})`);
        const p = path.join(framesDir, `frame_${pad6(frame)}.png`);
        await page.screenshot({ path: p, omitBackground: true });
        if (frame % 10 === 0 || frame === totalFrames - 1) {
            const pct = Math.round((frame + 1) / totalFrames * 100);
            emit({ type: 'progress', frame: frame + 1, total: totalFrames, percent: pct });
        }
    }
}

// Step the browser clock manually per frame. The clock + animation hijack
// (performance.now / Date.now / rAF / WAAPI) is installed via addInitScript,
// so React and Framer Motion already mounted with the clock frozen at t=0 and
// their entrance animations queued — not yet played.
async function renderRealtimePreciseMode(page, args, framesDir, totalFrames) {
    // Let React finish mounting and Framer Motion register its animations,
    // all at the frozen t=0, before we start stepping the clock.
    await page.waitForTimeout(500);
    await page.evaluate('window.__stepFrame(0)');

    for (let frame = 0; frame < totalFrames; frame++) {
        const tMs = (frame / args.fps) * 1000.0;
        // Multiple sub-steps per frame so Framer Motion springs settle smoothly
        for (let k = 0; k < 3; k++) {
            const sub = tMs + (k / 3.0) * (1000.0 / args.fps);
            await page.evaluate(`window.__stepFrame(${sub})`);
        }
        // Let the DOM commit
        await page.waitForTimeout(8);
        const p = path.join(framesDir, `frame_${pad6(frame)}.png`);
        await page.screenshot({ path: p, omitBackground: true });
        if (frame % 10 === 0 || frame === totalFrames - 1) {
            const pct = Math.round((frame + 1) / totalFrames * 100);
            emit({ type: 'progress', frame: frame + 1, total: totalFrames, percent: pct });
        }
    }

    await page.evaluate('window.__renderActive = false');
}

function parseArgs(argv) {
    const args = {
        fps: 25,
        width: 1920,
        height: 1080,
        output: null,
        ffmpeg: defaultFfmpegPath(),
        htmlPath: null,
        outputFormat: 'prores',
        proresProfile: '4444',
        hevcEncoder: 'auto',
        ffmpegThreads: 'auto',
        proxyOutput: null,
        proxyEncoder: 'auto',
        proxyQuality: 'balanced'
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--fps') args.fps = parseFloat(argv[++i]);
        else if (a === '--width') args.width = parseInt(argv[++i], 10);
        else if (a === '--height') args.height = parseInt(argv[++i], 10);
        else if (a === '--output') args.output = argv[++i];
        else if (a === '--ffmpeg') args.ffmpeg = argv[++i];
        else if (a === '--output-format') args.outputFormat = String(argv[++i] || 'prores').toLowerCase();
        else if (a === '--prores-profile') args.proresProfile = String(argv[++i] || '4444').toLowerCase();
        else if (a === '--hevc-encoder') args.hevcEncoder = String(argv[++i] || 'auto').toLowerCase();
        else if (a === '--ffmpeg-threads') args.ffmpegThreads = String(argv[++i] || 'auto');
        else if (a === '--proxy-output') args.proxyOutput = argv[++i];
        else if (a === '--proxy-encoder') args.proxyEncoder = String(argv[++i] || 'auto');
        else if (a === '--proxy-quality') args.proxyQuality = String(argv[++i] || 'balanced');
        else if (!args.htmlPath) args.htmlPath = a;
    }
    return args;
}

function normalizedThreads(value) {
    const raw = String(value || 'auto').toLowerCase();
    if (raw === 'auto') return null;
    const threads = Math.floor(Number(raw));
    return Number.isFinite(threads) && threads > 0 ? String(Math.min(32, threads)) : null;
}

function computeFramePlan(duration, fps) {
    const safeDuration = Number(duration);
    const safeFps = Number(fps);
    if (!Number.isFinite(safeDuration) || safeDuration <= 0 || !Number.isFinite(safeFps) || safeFps <= 0) {
        return { totalFrames: 0, encodedDuration: 0 };
    }
    const totalFrames = Math.max(1, Math.ceil((safeDuration * safeFps) - 1e-6));
    return {
        totalFrames,
        encodedDuration: totalFrames / safeFps
    };
}

function proresProfileValue(value) {
    return String(value || '').toLowerCase() === '4444xq' ? '4444xq' : '4444';
}

function platformDefaultProxyEncoder() {
    if (process.platform === 'darwin') return 'h264_videotoolbox';
    if (process.platform === 'win32' || process.platform === 'linux') return 'h264_nvenc';
    return 'libx264';
}

function proxyEncoderValue(value) {
    if (value === 'auto') return platformDefaultProxyEncoder();
    if (['h264_nvenc', 'h264_videotoolbox', 'h264_qsv', 'libx264'].includes(value)) return value;
    return 'libx264';
}

function platformDefaultHevcEncoder() {
    if (process.platform === 'darwin') return 'hevc_videotoolbox';
    return 'hevc_nvenc';
}

function hevcEncoderValue(value) {
    if (value === 'auto' || !value) return platformDefaultHevcEncoder();
    if (['hevc_nvenc', 'hevc_videotoolbox'].includes(value)) return value;
    return platformDefaultHevcEncoder();
}

function proxyQualityArgs(encoder, quality) {
    const q = ['small', 'balanced', 'high'].includes(quality) ? quality : 'balanced';
    if (encoder === 'h264_nvenc') {
        return q === 'high' ? ['-preset', 'p5', '-cq', '18'] : q === 'small' ? ['-preset', 'p4', '-cq', '28'] : ['-preset', 'p4', '-cq', '23'];
    }
    if (encoder === 'h264_videotoolbox') {
        return q === 'high' ? ['-b:v', '18M'] : q === 'small' ? ['-b:v', '5M'] : ['-b:v', '10M'];
    }
    if (encoder === 'h264_qsv') {
        return q === 'high' ? ['-global_quality', '18'] : q === 'small' ? ['-global_quality', '28'] : ['-global_quality', '23'];
    }
    return q === 'high' ? ['-preset', 'fast', '-crf', '16'] : q === 'small' ? ['-preset', 'veryfast', '-crf', '28'] : ['-preset', 'veryfast', '-crf', '22'];
}

function finalOutputArgs(args, framesDir, threads) {
    if (args.outputFormat === 'hevc_nvenc_hq') {
        const encoder = hevcEncoderValue(args.hevcEncoder);
        if (encoder === 'hevc_videotoolbox') {
            return {
                encoder,
                ffmpegArgs: [
                    '-y',
                    '-framerate', String(args.fps),
                    '-i', path.join(framesDir, 'frame_%06d.png'),
                    '-vf', 'format=yuv420p',
                    '-c:v', 'hevc_videotoolbox',
                    '-profile:v', 'main',
                    '-b:v', '18M',
                    '-tag:v', 'hvc1',
                    ...(threads ? ['-threads', threads] : []),
                    '-movflags', '+faststart',
                    args.output
                ]
            };
        }
        return {
            encoder,
            ffmpegArgs: [
                '-y',
                '-framerate', String(args.fps),
                '-i', path.join(framesDir, 'frame_%06d.png'),
                '-vf', 'format=yuv420p',
                '-c:v', encoder,
                '-preset', 'slow',
                '-tune', 'hq',
                '-rc', 'constqp',
                '-init_qpI', '22',
                '-init_qpP', '25',
                '-init_qpB', '28',
                '-bf', '3',
                '-b_ref_mode', 'middle',
                '-rc-lookahead', '32',
                '-multipass', 'fullres',
                '-profile:v', 'main',
                ...(threads ? ['-threads', threads] : []),
                '-movflags', '+faststart',
                args.output
            ]
        };
    }
    if (args.outputFormat === 'h264') {
        const encoder = proxyEncoderValue(args.proxyEncoder);
        return {
            encoder,
            ffmpegArgs: [
                '-y',
                '-framerate', String(args.fps),
                '-i', path.join(framesDir, 'frame_%06d.png'),
                '-vf', 'format=yuv420p',
                '-c:v', encoder,
                ...proxyQualityArgs(encoder, args.proxyQuality),
                ...(threads ? ['-threads', threads] : []),
                '-movflags', '+faststart',
                args.output
            ]
        };
    }
    return {
        encoder: 'prores_ks',
        ffmpegArgs: [
            '-y',
            '-framerate', String(args.fps),
            '-i', path.join(framesDir, 'frame_%06d.png'),
            '-c:v', 'prores_ks',
            '-profile:v', proresProfileValue(args.proresProfile),
            '-pix_fmt', 'yuva444p10le',
            '-vendor', 'apl0',
            ...(threads ? ['-threads', threads] : []),
            args.output,
        ]
    };
}

function runFfmpeg(ffmpeg, ffmpegArgs, failurePrefix) {
    const result = spawnSync(ffmpeg, ffmpegArgs, { encoding: 'utf-8' });
    if (result.error) {
        return { ok: false, error: `${failurePrefix} failed to spawn: ${result.error.message}` };
    }
    if (result.status !== 0) {
        return { ok: false, error: `${failurePrefix} failed: ${(result.stderr || '').slice(0, 500)}` };
    }
    return { ok: true };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    // Resolve runs this under its bundled Electron as Node (ELECTRON_RUN_AS_NODE).
    // Playwright needs Node 18+ — fail with a clear message instead of a cryptic
    // module-load error if that runtime is too old.
    const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
    if (!Number.isFinite(nodeMajor) || nodeMajor < 18) {
        emit({ type: 'error', message: `Renderer needs Node 18+, but the bundled runtime is Node ${process.versions.node}.` });
        process.exit(1);
    }

    if (!args.htmlPath) {
        emit({ type: 'error', message: 'Missing HTML path argument' });
        process.exit(1);
    }
    if (!args.output) {
        emit({ type: 'error', message: 'Missing --output argument' });
        process.exit(1);
    }

    const htmlPath = path.resolve(args.htmlPath);
    if (!fs.existsSync(htmlPath)) {
        emit({ type: 'error', message: `HTML file not found: ${htmlPath}` });
        process.exit(1);
    }

    let initScript;
    try {
        initScript = buildInitScript();
    } catch (e) {
        emit({ type: 'error', message: e.message });
        process.exit(1);
    }

    const framesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude_resolve_frames_'));

    try {
        const browser = await chromium.launch();
        const page = await browser.newPage({
            viewport: { width: args.width, height: args.height },
            deviceScaleFactor: 1,
        });

        await page.addInitScript(initScript);
        await page.goto(pathToFileURL(htmlPath).href);
        await page.waitForLoadState('networkidle');

        try {
            await page.waitForFunction('document.fonts.ready', null, { timeout: FONT_READY_TIMEOUT_MS });
        } catch (_e) {
            emit({ type: 'warning', message: 'document.fonts.ready timed out' });
        }

        // Extra settle for font decode + initial paint
        await page.waitForTimeout(200);
        await fitPageToViewport(page, args);

        let duration = await page.evaluate('window.getAnimationDuration()');
        if (typeof duration !== 'number' || !isFinite(duration) || duration <= 0) {
            emit({ type: 'error', message: `getAnimationDuration returned invalid value: ${JSON.stringify(duration)}` });
            process.exit(1);
        }

        let clamped = false;
        if (duration > MAX_DURATION_SEC) {
            duration = MAX_DURATION_SEC;
            clamped = true;
        }

        const { totalFrames, encodedDuration } = computeFramePlan(duration, args.fps);
        if (totalFrames <= 0) {
            emit({ type: 'error', message: `Computed 0 frames (duration=${duration}, fps=${args.fps})` });
            process.exit(1);
        }

        const mode = await detectMode(page);
        emit({ type: 'mode_detected', mode });
        if (clamped) {
            emit({ type: 'warning', message: `duration clamped to ${MAX_DURATION_SEC}s` });
        }

        emit({ type: 'start', totalFrames, duration, encodedDuration, mode });

        if (mode === 'frame') {
            await renderFrameMode(page, args, framesDir, totalFrames);
        } else {
            await renderRealtimePreciseMode(page, args, framesDir, totalFrames);
        }

        // Save a sidebar thumbnail from ~85% through the animation —
        // late enough to show the resolved state, before any fade-out.
        const thumbIdx = Math.min(totalFrames - 1, Math.max(0, Math.floor(totalFrames * 0.85)));
        const thumbSrc = path.join(framesDir, `frame_${pad6(thumbIdx)}.png`);
        if (fs.existsSync(thumbSrc)) {
            try {
                const outResolved = path.resolve(args.output);
                const thumbDir = path.join(path.dirname(outResolved), 'thumbnails');
                fs.mkdirSync(thumbDir, { recursive: true });
                const thumbDst = path.join(thumbDir, path.basename(outResolved, path.extname(outResolved)) + '.png');
                fs.copyFileSync(thumbSrc, thumbDst);
                emit({ type: 'thumbnail', path: thumbDst });
            } catch (e) {
                emit({ type: 'warning', message: `thumbnail save failed: ${e.message}` });
            }
        }

        await browser.close();

        const threads = normalizedThreads(args.ffmpegThreads);
        const finalOutput = finalOutputArgs(args, framesDir, threads);

        emit({ type: 'encoding' });
        if (args.outputFormat !== 'prores') {
            emit({ type: 'warning', message: 'MP4 output does not preserve transparency/alpha.' });
        }
        const result = runFfmpeg(args.ffmpeg, finalOutput.ffmpegArgs, 'FFmpeg');
        if (!result.ok) {
            emit({ type: 'error', message: result.error });
            process.exit(1);
        }

        if (args.proxyOutput) {
            const proxyEncoder = proxyEncoderValue(args.proxyEncoder);
            const proxyArgs = [
                '-y',
                '-framerate', String(args.fps),
                '-i', path.join(framesDir, 'frame_%06d.png'),
                '-vf', 'format=yuv420p',
                '-c:v', proxyEncoder,
                ...proxyQualityArgs(proxyEncoder, args.proxyQuality),
                ...(threads ? ['-threads', threads] : []),
                '-movflags', '+faststart',
                args.proxyOutput
            ];
            const proxyResult = runFfmpeg(args.ffmpeg, proxyArgs, 'Proxy FFmpeg');
            if (proxyResult.ok) {
                emit({ type: 'proxy_done', output: args.proxyOutput, encoder: proxyEncoder });
            } else {
                emit({ type: 'warning', message: proxyResult.error });
            }
        }

        emit({ type: 'done', output: args.output, totalFrames, duration, encodedDuration });
    } finally {
        fs.rmSync(framesDir, { recursive: true, force: true });
    }
}

if (require.main === module) {
    main()
        .then(() => {
            // Exit explicitly — Playwright/Electron-as-Node can leave the event
            // loop alive after browser.close(), so a natural return would hang
            // the parent process (which waits on the 'close' event).
            process.exit(0);
        })
        .catch((err) => {
            emit({ type: 'error', message: err && err.message ? err.message : String(err) });
            process.exit(1);
        });
}

module.exports = {
    computeFramePlan,
    finalOutputArgs,
    normalizedThreads
};
