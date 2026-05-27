import React, { useRef, useEffect } from 'react';
import { Gear, Send, Stop } from './Icons';

export default function ChatInput({ onSend, onStop, isProcessing, sidebarOpen, sidebarView, onToggleSidebar, updateAvailable }) {
    const inputRef = useRef(null);

    useEffect(() => {
        if (!isProcessing && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isProcessing]);

    function handleSend() {
        const text = inputRef.current.value.trim();
        if (!text || isProcessing) return;
        inputRef.current.value = '';
        onSend(text);
    }

    function handleKeyDown(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSend();
        }
    }

    const settingsOpen = sidebarOpen && sidebarView === 'settings';
    const gearLabel = settingsOpen ? 'Close settings' : 'Open settings';

    return (
        <div className="composer">
            <button
                className={'composer-gear' + (settingsOpen ? ' on' : '')}
                onClick={onToggleSidebar}
                aria-label={gearLabel}
                aria-pressed={settingsOpen}
                title={gearLabel}
            >
                <Gear />
                {updateAvailable && <span className="gear-badge" />}
            </button>

            <div className="input-wrap">
                <input
                    ref={inputRef}
                    type="text"
                    className="composer-input"
                    placeholder="Ask Resolve AI to animate..."
                    autoFocus
                    disabled={isProcessing}
                    onKeyDown={handleKeyDown}
                />
            </div>

            {isProcessing ? (
                <button className="send stop" onClick={onStop} aria-label="Stop">
                    <Stop />
                </button>
            ) : (
                <button className="send" onClick={handleSend} aria-label="Send">
                    <Send />
                </button>
            )}
        </div>
    );
}
