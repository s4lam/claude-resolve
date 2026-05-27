import React, { useEffect, useMemo, useState } from 'react';

function promptFromTemplate(item, mode) {
    if (mode === 'template') {
        return [
            'Use this Resolve AI gallery template as the starting point.',
            '',
            `Template: ${item.title || item.name}`,
            `Category: ${item.category}`,
            '',
            `Original prompt: ${item.prompt}`,
            '',
            'Template HTML:',
            '```html',
            item.html || '',
            '```',
            '',
            'Return one complete replacement HTML file. Keep the same output contract.'
        ].join('\n');
    }
    if (mode === 'remix') {
        return `${item.prompt}\n\nRemix this with a fresh visual direction while keeping it useful for ${item.category} videos.`;
    }
    return item.prompt;
}

export default function SidebarPromptGallery({ onPrompt }) {
    const [items, setItems] = useState([]);
    const [query, setQuery] = useState('');
    const [status, setStatus] = useState('');

    async function refresh() {
        if (!window.galleryAPI) return;
        setItems(await window.galleryAPI.list());
    }

    useEffect(() => { refresh(); }, []);

    async function handleImportPack() {
        setStatus('Importing');
        const result = await window.galleryAPI.importPack();
        setStatus(result?.success && !result?.canceled ? 'Imported' : 'No import');
        await refresh();
        setTimeout(() => setStatus(''), 2200);
    }

    async function handleBuildShowcase() {
        setStatus('Building');
        const result = await window.showcaseAPI.build({
            items: items.map(item => ({
                title: item.title,
                category: item.category,
                prompt: item.prompt,
                thumbnail: item.preview,
                tags: item.tags
            }))
        });
        setStatus(result?.success ? `Showcase ${result.count}` : 'Failed');
        setTimeout(() => setStatus(''), 2600);
    }

    const filtered = useMemo(() => {
        const q = query.toLowerCase();
        return items.filter(item => [
            item.title,
            item.category,
            item.prompt,
            ...(item.tags || [])
        ].filter(Boolean).join(' ').toLowerCase().includes(q));
    }, [items, query]);

    return (
        <div className="sb-section gallery-section">
            <div className="sb-title">
                <span>Prompt Gallery</span>
                <span className="sb-actions">
                    {status && <span className="sync-status">{status}</span>}
                    <button className="sync" onClick={handleImportPack}>Import</button>
                    <button className="sync" onClick={handleBuildShowcase}>Showcase</button>
                </span>
            </div>
            <input className="sb-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search gallery" />
            <div className="gallery-list">
                {filtered.map(item => (
                    <div className="gallery-row" key={`${item.packId}-${item.id}`}>
                        <div className="template-thumb gallery-thumb" />
                        <div className="template-meta">
                            <div className="template-name">{item.title || item.name}</div>
                            <div className="template-sub">{item.category} · {(item.tags || []).slice(0, 2).join(', ')}</div>
                            <div className="render-actions">
                                <button className="mini-action" onClick={() => onPrompt(promptFromTemplate(item, 'prompt'), { displayText: item.title })}>Use Prompt</button>
                                <button className="mini-action" onClick={() => onPrompt(promptFromTemplate(item, 'template'), { displayText: `Use template: ${item.title}` })}>Use Template</button>
                                <button className="mini-action" onClick={() => onPrompt(promptFromTemplate(item, 'remix'), { displayText: `Remix: ${item.title}` })}>Remix</button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
