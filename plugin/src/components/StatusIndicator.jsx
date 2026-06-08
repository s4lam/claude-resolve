import React, { useState, useEffect, useRef } from 'react';
import SELECTORS from '../data/selectors.json';

const TOOL_LABELS = {
    Read: 'Reading',
    Write: 'Writing',
    Edit: 'Editing',
    Bash: 'Running',
    Grep: 'Searching',
    Glob: 'Finding files',
    Agent: 'Delegating',
    WebSearch: 'Searching web',
    WebFetch: 'Fetching'
};

function shortPath(p) {
    if (!p) return null;
    const name = p.replace(/\\/g, '/').split('/').pop();
    return name.length > 24 ? name.slice(0, 21) + '...' : name;
}

const MODEL_LABELS = {
    ...Object.fromEntries(SELECTORS.models.map(m => [m.value, m.label])),
    sonnet: 'Sonnet',
    opus: 'Opus',
    haiku: 'Haiku',
    default: 'GPT-5.5',
    'gpt-5.4-mini': 'GPT-5.4 Mini',
    'gpt-5.5': 'GPT-5.5'
};

const PROVIDER_LABELS = { auto: 'Auto', claude: 'Claude', codex: 'Codex' };

function displayModel(model) {
    if (model === 'gpt-5.3-codex') return MODEL_LABELS['gpt-5.5'];
    return MODEL_LABELS[model] || model;
}

export default function StatusIndicator({ tool, tokens, model, provider }) {
    const [elapsed, setElapsed] = useState(0);
    const startRef = useRef(Date.now());

    useEffect(() => {
        startRef.current = Date.now();
        const id = setInterval(() => {
            setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
        }, 1000);
        return () => clearInterval(id);
    }, []);

    const parts = ['Thinking'];
    if (elapsed > 0) parts.push(`${elapsed}s`);
    if (provider) parts.push(PROVIDER_LABELS[provider] || provider);
    if (tokens > 0) parts.push(`${tokens} tokens`);
    if (model) parts.push(displayModel(model));
    if (tool) {
        const action = TOOL_LABELS[tool.name] || tool.name;
        const file = shortPath(tool.file);
        parts.push(file ? `${action} ${file}` : action);
    }

    return (
        <div className="tool">
            <span className="spin" />
            <span>{parts.join(' · ')}</span>
        </div>
    );
}
