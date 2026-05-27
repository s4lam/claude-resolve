import React, { useState } from 'react';

const CAPTION_STYLES = [
    ['clean', 'Clean'],
    ['kinetic', 'Kinetic'],
    ['karaoke', 'Karaoke'],
    ['social shorts', 'Social'],
    ['podcast clips', 'Podcast']
];

export default function SidebarCaptions({ config, onPrompt }) {
    const [cues, setCues] = useState([]);
    const [style, setStyle] = useState('clean');
    const [status, setStatus] = useState('');

    async function handleImport() {
        setStatus('Importing');
        const result = await window.captionAPI.import();
        setCues(result?.cues || []);
        setStatus(result?.cues?.length ? `${result.cues.length} cues` : 'No captions');
        setTimeout(() => setStatus(''), 2400);
    }

    async function handleGenerate() {
        if (cues.length === 0) return;
        const result = await window.captionAPI.generate({
            cues,
            style,
            width: config.width,
            height: config.height,
            fps: config.fps
        });
        if (result?.prompt) {
            onPrompt(result.prompt, { displayText: `Captions: ${style}` });
        }
    }

    return (
        <div className="sb-section captions-section">
            <div className="sb-title">
                <span>Captions</span>
                <span className="sb-actions">
                    {status && <span className="sync-status">{status}</span>}
                    <button className="sync" onClick={handleImport}>Import</button>
                </span>
            </div>
            <div className="caption-controls">
                <select className="select compact" value={style} onChange={e => setStyle(e.target.value)}>
                    {CAPTION_STYLES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                </select>
                <button className="mini-action" disabled={cues.length === 0} onClick={handleGenerate}>Generate</button>
                <span>{cues.length ? `${cues.length} cues loaded` : 'SRT/VTT local only'}</span>
            </div>
        </div>
    );
}
