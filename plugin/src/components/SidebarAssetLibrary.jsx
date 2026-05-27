import React, { useEffect, useMemo, useState } from 'react';
import { Folder } from './Icons';
import { hashGradient } from '../utils/hashGradient';

const CATEGORY_OPTIONS = [
    ['logo', 'Logo'],
    ['texture', 'Texture'],
    ['product', 'Product'],
    ['background', 'Background'],
    ['icon', 'Icon'],
    ['reference', 'Reference'],
    ['other', 'Other']
];

const CATEGORY_LABELS = Object.fromEntries(CATEGORY_OPTIONS);

function formatAssetSize(size) {
    if (!size) return 'Local file';
    if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function SidebarAssetLibrary({ config, onConfigChange }) {
    const [assets, setAssets] = useState([]);
    const [status, setStatus] = useState('');
    const [activeId, setActiveId] = useState(null);
    const selectedIds = useMemo(() => new Set(config.selectedAssetIds || []), [config.selectedAssetIds]);
    const selectedCount = assets.filter(asset => selectedIds.has(asset.id)).length;
    const pinnedCount = assets.filter(asset => asset.alwaysInclude).length;
    const activeAsset = useMemo(() => {
        if (assets.length === 0) return null;
        return assets.find(asset => asset.id === activeId) || assets[0];
    }, [assets, activeId]);

    useEffect(() => {
        refreshAssets();
        const onChanged = () => refreshAssets();
        window.addEventListener('resolve-ai:assets-changed', onChanged);
        return () => window.removeEventListener('resolve-ai:assets-changed', onChanged);
    }, []);

    async function refreshAssets() {
        if (!window.assetAPI) return;
        const nextAssets = await window.assetAPI.list();
        setAssets(nextAssets);
        setActiveId(current => {
            if (nextAssets.some(asset => asset.id === current)) return current;
            return nextAssets[0]?.id || null;
        });
    }

    async function handleAdd() {
        setStatus('Adding');
        try {
            const result = await window.assetAPI.add();
            const addedIds = (result?.added || []).map(asset => asset.id);
            if (addedIds.length > 0) {
                const next = Array.from(new Set([...(config.selectedAssetIds || []), ...addedIds]));
                await onConfigChange({ selectedAssetIds: next });
                setStatus(`Added ${addedIds.length}`);
            } else {
                setStatus('No asset added');
            }
            await refreshAssets();
            window.dispatchEvent(new CustomEvent('resolve-ai:assets-changed'));
        } catch {
            setStatus('Add failed');
        }
        setTimeout(() => setStatus(''), 2200);
    }

    async function handleToggle(id) {
        const next = selectedIds.has(id)
            ? (config.selectedAssetIds || []).filter(assetId => assetId !== id)
            : [...(config.selectedAssetIds || []), id];
        await onConfigChange({ selectedAssetIds: next });
    }

    async function handleNotes(id, notes) {
        await window.assetAPI.update(id, { notes });
        refreshAssets();
    }

    async function handlePatch(id, patch) {
        await window.assetAPI.update(id, patch);
        refreshAssets();
    }

    async function handleDelete(id) {
        await window.assetAPI.delete(id);
        await onConfigChange({
            selectedAssetIds: (config.selectedAssetIds || []).filter(assetId => assetId !== id)
        });
        refreshAssets();
    }

    return (
        <div className="sb-section asset-library-section">
            <div className="sb-title">
                <span>Asset Library</span>
                <span className="sb-actions">
                    {status && <span className="sync-status">{status}</span>}
                    <button className="sync asset-add" onClick={handleAdd}>Add</button>
                </span>
            </div>

            {assets.length === 0 ? (
                <div className="asset-empty-card">
                    <div className="asset-empty-art" aria-hidden="true">
                        <span />
                        <span />
                        <span />
                    </div>
                    <div>
                        <strong>No assets yet</strong>
                        <p>Add logos, product shots, backgrounds, textures, or reference images. Assets stay local and can be attached to the next prompt.</p>
                    </div>
                    <button className="sync asset-empty-action" onClick={handleAdd}>Add first asset</button>
                </div>
            ) : (
                <>
                    <div className="asset-library-meta">
                        <span>{assets.length} asset{assets.length === 1 ? '' : 's'}</span>
                        <span>{selectedCount} attached</span>
                        <span>{pinnedCount} pinned</span>
                    </div>
                    <div className="asset-list">
                        {assets.map(asset => {
                            const selected = selectedIds.has(asset.id);
                            const category = asset.category || 'reference';
                            return (
                                <article
                                    className={'asset-row' + (selected ? ' selected' : '') + (activeAsset?.id === asset.id ? ' active' : '')}
                                    key={asset.id}
                                >
                                    <button
                                        className="asset-row-main"
                                        onClick={() => setActiveId(asset.id)}
                                        aria-pressed={activeAsset?.id === asset.id}
                                        title="Edit asset details"
                                    >
                                        <span className="asset-row-thumb-wrap">
                                            {asset.url
                                                ? <img className="asset-row-thumb" src={asset.url} alt="" />
                                                : <span className="asset-row-thumb" style={{ background: hashGradient(asset.name) }} />}
                                        </span>
                                        <span className="asset-row-copy">
                                            <span className="asset-row-name">{asset.name}</span>
                                            <span className="asset-row-sub">
                                                {CATEGORY_LABELS[category] || 'Reference'} / {asset.ext || 'image'} / {formatAssetSize(asset.size)}
                                            </span>
                                        </span>
                                    </button>
                                    <button
                                        className={'asset-attach' + (selected ? ' selected' : '')}
                                        onClick={() => handleToggle(asset.id)}
                                        aria-pressed={selected}
                                        title={selected ? 'Detach from next prompts' : 'Attach to next prompts'}
                                    >
                                        {selected ? 'On' : 'Use'}
                                    </button>
                                </article>
                            );
                        })}
                    </div>
                    {activeAsset && (
                        <div className="asset-inspector">
                            <div className="asset-inspector-head">
                                <div className="asset-inspector-copy">
                                    <span className="asset-inspector-label">Editing</span>
                                    <strong title={activeAsset.name}>{activeAsset.name}</strong>
                                </div>
                                <button
                                    className="asset-icon-button"
                                    title="Open asset folder"
                                    onClick={() => window.assetAPI.reveal(activeAsset.id)}
                                >
                                    <Folder />
                                </button>
                                <button
                                    className="asset-icon-button danger"
                                    title="Delete asset"
                                    onClick={() => handleDelete(activeAsset.id)}
                                >
                                    &#10005;
                                </button>
                            </div>

                            <textarea
                                className="asset-notes"
                                key={activeAsset.id}
                                defaultValue={activeAsset.notes || ''}
                                onBlur={e => handleNotes(activeAsset.id, e.target.value)}
                                placeholder="Notes for AI: what is this, how should it be used?"
                                rows={2}
                            />

                            <div className="asset-controls">
                                <label className="asset-field">
                                    <span>Category</span>
                                    <select
                                        className="asset-category"
                                        value={activeAsset.category || 'reference'}
                                        onChange={e => handlePatch(activeAsset.id, { category: e.target.value })}
                                    >
                                        {CATEGORY_OPTIONS.map(([value, label]) => (
                                            <option value={value} key={value}>{label}</option>
                                        ))}
                                    </select>
                                </label>
                                <label className="asset-brand">
                                    <input
                                        type="checkbox"
                                        checked={!!activeAsset.alwaysInclude}
                                        onChange={e => handlePatch(activeAsset.id, { alwaysInclude: e.target.checked })}
                                    />
                                    <span>Always include</span>
                                </label>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
