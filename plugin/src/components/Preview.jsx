import React, { useRef, useState, useEffect, useMemo, memo } from 'react';

// Module-level singleton: fetched once per session, shared across all Preview
// instances. The bundle is ~1.2 MB (UMDs + base64 fonts), no point re-fetching.
let cachedBundle = null;
let pendingBundle = null;
function loadBundle() {
    if (cachedBundle) return Promise.resolve(cachedBundle);
    if (!pendingBundle) {
        pendingBundle = window.previewAPI.getRealtimeBundle()
            .then(b => { cachedBundle = b; return b; })
            .catch(() => { pendingBundle = null; return { umd: '', fonts: '' }; });
    }
    return pendingBundle;
}

function injectIntoHead(html, content) {
    if (html.includes('<head>')) return html.replace('<head>', '<head>' + content);
    if (html.includes('<html>')) return html.replace('<html>', '<html><head>' + content + '</head>');
    return '<head>' + content + '</head>' + html;
}

function injectBeforeBodyClose(html, content) {
    if (html.includes('</body>')) return html.replace('</body>', content + '</body>');
    if (html.includes('</html>')) return html.replace('</html>', content + '</html>');
    return html + content;
}

const FRAME_PLAY_SCRIPT = `<script>
document.addEventListener('DOMContentLoaded',function(){
if(typeof window.getAnimationDuration!=='function'||typeof window.renderFrame!=='function')return;
var fps=25,dur=window.getAnimationDuration(),total=Math.ceil(dur*fps);
var running=true,startTime=null,lastFrame=-1;
function tick(ts){
if(!running){startTime=null;requestAnimationFrame(tick);return}
if(!startTime)startTime=ts;
var elapsed=ts-startTime;
var f=Math.floor(elapsed/(1000/fps))%total;
if(f!==lastFrame){window.renderFrame(f,fps);lastFrame=f}
requestAnimationFrame(tick)}
window.addEventListener('message',function(e){if(e.data==='play')running=true;else if(e.data==='pause')running=false});
requestAnimationFrame(tick);
});
<\/script>`;

// Realtime mode helper: postMessage duration back to parent so it can schedule
// the next iframe re-mount and create a perpetual loop.
const REALTIME_DURATION_HELPER = `<script>
window.addEventListener('load', function() {
  try {
    var dur = typeof window.getAnimationDuration === 'function' ? window.getAnimationDuration() : 0;
    if (dur > 0) window.parent.postMessage({ __cr: 'duration', seconds: dur }, '*');
  } catch (_) {}
});
<\/script>`;

function canvasFitScript(width, height) {
    return `<script>
(function(){
  var targetWidth=${Number(width) || 1920},targetHeight=${Number(height) || 1080};
  function numericPx(value){var n=parseFloat(value);return Number.isFinite(n)&&n>0?n:null}
  function findSourceSize(){
    var selectors=['#stage','.stage','#root > *','#root','.overlay','.canvas','body'];
    for(var i=0;i<selectors.length;i++){
      var el=document.querySelector(selectors[i]); if(!el) continue;
      var style=getComputedStyle(el);
      var rect=el.getBoundingClientRect();
      var w=numericPx(style.width)||rect.width;
      var h=numericPx(style.height)||rect.height;
      if(w&&h&&(Math.abs(w-targetWidth)>2||Math.abs(h-targetHeight)>2)) return {width:w,height:h};
    }
    return null;
  }
  function fit(){
    if(document.getElementById('__resolve_ai_fit_root')) return;
    var source=findSourceSize(); if(!source) return;
    var scale=Math.min(targetWidth/source.width,targetHeight/source.height);
    if(!Number.isFinite(scale)||scale<=0) return;
    var bodyStyle=getComputedStyle(document.body),htmlStyle=getComputedStyle(document.documentElement);
    var inheritedBackground=bodyStyle.background!=='rgba(0, 0, 0, 0)'&&bodyStyle.background!=='none'?bodyStyle.background:htmlStyle.background;
    var root=document.createElement('div');
    root.id='__resolve_ai_fit_root';
    root.style.position='absolute';
    root.style.left=((targetWidth-source.width*scale)/2)+'px';
    root.style.top=((targetHeight-source.height*scale)/2)+'px';
    root.style.width=source.width+'px';
    root.style.height=source.height+'px';
    root.style.transformOrigin='top left';
    root.style.transform='scale('+scale+')';
    root.style.overflow='hidden';
    root.style.background=inheritedBackground;
    Array.prototype.slice.call(document.body.childNodes).forEach(function(child){ if(child!==root) root.appendChild(child); });
    document.body.appendChild(root);
    document.documentElement.style.width=targetWidth+'px';
    document.documentElement.style.height=targetHeight+'px';
    document.documentElement.style.margin='0';
    document.documentElement.style.overflow='hidden';
    document.body.style.width=targetWidth+'px';
    document.body.style.height=targetHeight+'px';
    document.body.style.margin='0';
    document.body.style.overflow='hidden';
    document.body.style.background='transparent';
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',fit); else fit();
})();
<\/script>`;
}

const REPLAY_BUFFER_MS = 500;

function numericDimension(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const HTMLPreview = memo(function HTMLPreview({ parsed, selectedAssetIds, width = 1920, height = 1080 }) {
    const iframeRef = useRef(null);
    const containerRef = useRef(null);
    const [scale, setScale] = useState(1);
    const [isPlaying, setIsPlaying] = useState(true);
    const [bundle, setBundle] = useState(cachedBundle);
    const [replayKey, setReplayKey] = useState(0);
    const [loopDuration, setLoopDuration] = useState(null);
    const [isVisible, setIsVisible] = useState(true);
    const [resolvedHtml, setResolvedHtml] = useState(parsed.html);
    const wasOffscreenRef = useRef(false);
    const canvasWidth = numericDimension(width, 1920);
    const canvasHeight = numericDimension(height, 1080);

    useEffect(() => {
        if (!bundle) loadBundle().then(setBundle);
    }, [bundle]);

    useEffect(() => {
        let alive = true;
        if (!window.assetAPI?.resolveHtml) {
            setResolvedHtml(parsed.html);
            return undefined;
        }
        window.assetAPI.resolveHtml(parsed.html, selectedAssetIds || [], { inlineDataUrls: true })
            .then(html => { if (alive) setResolvedHtml(html || parsed.html); })
            .catch(() => { if (alive) setResolvedHtml(parsed.html); });
        return () => { alive = false; };
    }, [parsed.html, selectedAssetIds]);

    useEffect(() => {
        // Bump on new HTML and on bundle availability so the iframe is
        // re-mounted with the proper srcdoc once the UMDs/fonts arrive.
        if (bundle) setReplayKey(k => k + 1);
    }, [resolvedHtml, bundle]);

    useEffect(() => {
        function updateScale() {
            if (containerRef.current) {
                const box = containerRef.current.getBoundingClientRect();
                const nextScale = Math.min(box.width / canvasWidth, box.height / canvasHeight);
                setScale(Number.isFinite(nextScale) && nextScale > 0 ? nextScale : 1);
            }
        }
        updateScale();
        const obs = new ResizeObserver(updateScale);
        if (containerRef.current) obs.observe(containerRef.current);
        return () => obs.disconnect();
    }, [canvasWidth, canvasHeight]);

    // IntersectionObserver: pause loop when iframe scrolls offscreen.
    useEffect(() => {
        if (!containerRef.current) return;
        const obs = new IntersectionObserver(
            ([entry]) => setIsVisible(entry.isIntersecting),
            { threshold: 0.1 }
        );
        obs.observe(containerRef.current);
        return () => obs.disconnect();
    }, []);

    // Listen for the duration handshake from the realtime iframe.
    useEffect(() => {
        if (parsed.mode !== 'realtime') return;
        function onMessage(e) {
            if (e.data && e.data.__cr === 'duration' && typeof e.data.seconds === 'number') {
                setLoopDuration(e.data.seconds);
            }
        }
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [parsed.mode]);

    // When iframe re-enters the viewport after being offscreen, restart the
    // animation so the user always sees it from frame 0 — not the static
    // end-state that's been sitting there.
    useEffect(() => {
        if (parsed.mode !== 'realtime') return;
        if (isVisible && wasOffscreenRef.current) {
            setReplayKey(k => k + 1);
            wasOffscreenRef.current = false;
        } else if (!isVisible) {
            wasOffscreenRef.current = true;
        }
    }, [isVisible, parsed.mode]);

    // The actual loop: schedule a key bump after duration + buffer.
    // Guarded on visibility — offscreen iframes don't burn CPU.
    useEffect(() => {
        if (parsed.mode !== 'realtime' || !loopDuration || !isVisible) return;
        const id = setTimeout(
            () => setReplayKey(k => k + 1),
            loopDuration * 1000 + REPLAY_BUFFER_MS
        );
        return () => clearTimeout(id);
    }, [parsed.mode, loopDuration, replayKey, isVisible]);

    const srcdoc = useMemo(() => {
        if (!bundle) return '<!DOCTYPE html><html><body style="margin:0;background:#000"></body></html>';

        let html = resolvedHtml;
        const headInjections = [];
        headInjections.push(bundle.fonts);
        if (parsed.mode === 'realtime') {
            headInjections.push(`<script>${bundle.umd}</script>`);
            headInjections.push(REALTIME_DURATION_HELPER);
        }
        html = injectIntoHead(html, headInjections.join(''));

        if (parsed.mode !== 'realtime') {
            html = injectBeforeBodyClose(html, FRAME_PLAY_SCRIPT);
        }
        html = injectBeforeBodyClose(html, canvasFitScript(canvasWidth, canvasHeight));
        return html;
    }, [parsed, resolvedHtml, bundle, canvasWidth, canvasHeight]);

    function togglePlay() {
        const next = !isPlaying;
        setIsPlaying(next);
        iframeRef.current?.contentWindow?.postMessage(next ? 'play' : 'pause', '*');
    }

    return (
        <div ref={containerRef} className="card-preview">
            <iframe
                key={replayKey}
                ref={iframeRef}
                className="card-preview-frame"
                width={canvasWidth}
                height={canvasHeight}
                sandbox="allow-scripts"
                srcDoc={srcdoc}
                style={{ transform: `translate(-50%, -50%) scale(${scale})` }}
            />
            {parsed.mode !== 'realtime' && (
                <button
                    className={'card-play' + (isPlaying ? '' : ' play-glyph')}
                    onClick={togglePlay}
                >
                    {isPlaying ? '⏸' : '▶'}
                </button>
            )}
        </div>
    );
});

export default function Preview({ parsed, selectedAssetIds, width, height }) {
    return <HTMLPreview parsed={parsed} selectedAssetIds={selectedAssetIds} width={width} height={height} />;
}
