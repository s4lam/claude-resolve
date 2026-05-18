#!/bin/bash
# Claude Resolve - macOS installer.
set -u

# Resolve our own location, then drop root if launched via sudo: Node/npm
# live in the user's environment, and only the final copy into /Library
# needs root (step 7 calls sudo itself).
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
if [ "$(id -u)" -eq 0 ] && [ -n "${SUDO_USER:-}" ]; then
    exec sudo -u "$SUDO_USER" bash "$SELF" "$@"
fi

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_SRC="$REPO_ROOT/plugin"
RENDERER_SRC="$PLUGIN_SRC/renderer"
DEST="/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins/com.clauderesolve.plugin"

c_cyan=$'\033[36m'; c_green=$'\033[32m'; c_yel=$'\033[33m'; c_red=$'\033[31m'; c_off=$'\033[0m'
step() { printf '\n%s[%s/9] %s%s\n' "$c_cyan" "$1" "$2" "$c_off"; }
ok()   { printf '%s  OK   %s%s\n' "$c_green" "$1" "$c_off"; }
warn() { printf '%s  !    %s%s\n' "$c_yel" "$1" "$c_off"; }
fail() {
    printf '%s  X    %s%s\n' "$c_red" "$1" "$c_off"
    echo
    read -r -p "Installation failed. Press Enter to exit..." _
    exit 1
}

printf '\nClaude Resolve installer\n'

# 1 - DaVinci Resolve
step 1 'Checking DaVinci Resolve...'
if [ ! -d "/Applications/DaVinci Resolve/DaVinci Resolve.app" ]; then
    fail 'DaVinci Resolve not found. Install DaVinci Resolve Studio 21+ first.'
fi
if pgrep -x 'DaVinci Resolve' >/dev/null 2>&1; then
    fail 'DaVinci Resolve is running. Quit it completely, then re-run this installer.'
fi
ok 'Resolve found. (Workflow Integration Plugins require the Studio edition.)'

# 2 - Node.js 18+
step 2 'Checking Node.js...'
if ! command -v node >/dev/null 2>&1; then
    fail 'Node.js not found. Install Node.js 18+:  brew install node'
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "${NODE_MAJOR:-0}" -lt 18 ]; then
    fail "Node.js 18+ required, found $(node --version). Upgrade:  brew install node"
fi
ok "Node.js $(node --version)"

# 3 - Claude Code CLI
step 3 'Checking Claude Code CLI...'
if command -v claude >/dev/null 2>&1; then
    ok 'Claude Code CLI present.'
else
    warn 'Claude Code CLI not found - installing via npm...'
    if npm install -g @anthropic-ai/claude-code; then
        ok 'Claude Code CLI installed.'
    else
        warn 'Automatic install failed. Install it manually: npm install -g @anthropic-ai/claude-code'
    fi
fi
# Login status - best effort, never aborts.
if [ -f "$HOME/.claude/.credentials.json" ]; then
    ok 'Claude Code is logged in.'
else
    warn 'Claude Code installed but not logged in - run claude in terminal to log in.'
fi

# 4 - Renderer dependencies
step 4 'Installing renderer dependencies (Playwright)...'
if ! ( cd "$RENDERER_SRC" && npm install --no-audit --no-fund ); then
    fail 'npm install failed in plugin/renderer.'
fi
ok 'Renderer dependencies installed.'

# 5 - Chromium
step 5 'Downloading Playwright Chromium...'
if ! ( cd "$RENDERER_SRC" && npx --yes playwright install chromium ); then
    fail 'Playwright Chromium download failed.'
fi
ok 'Chromium installed.'

# 6 - ffmpeg
step 6 'Checking ffmpeg...'
if command -v ffmpeg >/dev/null 2>&1; then
    ok 'ffmpeg found.'
else
    warn 'ffmpeg not found on PATH. Rendering will not work until ffmpeg is installed (brew install ffmpeg).'
fi

# 7 - Copy plugin into DaVinci Resolve (needs root)
step 7 'Installing plugin into DaVinci Resolve...'
echo '  (your administrator password may be requested)'
if ! sudo rm -rf "$DEST" \
   || ! sudo mkdir -p "$DEST" \
   || ! sudo cp -R "$PLUGIN_SRC/." "$DEST/"; then
    fail 'Could not copy plugin files into /Library.'
fi
ok "Installed to $DEST"

# 8 - Verify
step 8 'Verifying installation...'
for rel in manifest.xml main.js dist/index.html renderer/render.js renderer/node_modules/playwright; do
    if [ ! -e "$DEST/$rel" ]; then
        fail "Verification failed - missing: $rel"
    fi
done
ok 'All required files present.'

# 9 - Done
step 9 'Done.'
echo
printf '%sClaude Resolve is installed.%s\n' "$c_green" "$c_off"
echo 'Restart DaVinci Resolve, then open it from:'
echo '  Workspace > Workflow Integration > Claude Resolve'
echo
read -r -p "Press Enter to exit..." _
