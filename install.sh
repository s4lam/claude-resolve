#!/bin/bash
# Claude Resolve — macOS Installer
# Copies plugin + renderer into DaVinci Resolve's Workflow Integration Plugins directory.
# Requires sudo (system-level plugin directory).

DEST="/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins/com.clauderesolve.plugin"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Claude Code CLI requires Node.js 18+ — fail early with a clear message.
if ! command -v node >/dev/null 2>&1; then
    echo "Error: Node.js is not installed."
    echo "Install Node.js 18+ first:  brew install node   (or: fnm install 22)"
    exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
    echo "Error: Node.js 18+ required, found $(node --version)."
    echo "Upgrade with:  brew install node   (or: fnm install 22)"
    exit 1
fi

# Install renderer dependencies as the invoking user (not root) so node_modules
# isn't root-owned and Playwright's Chromium lands in the user's cache —
# the same cache DaVinci Resolve reads from when it runs the renderer.
RUN_USER="${SUDO_USER:-$USER}"
echo "Installing renderer dependencies..."
sudo -u "$RUN_USER" bash -c "cd '$SCRIPT_DIR/plugin/renderer' && npm install --no-audit --no-fund" || {
    echo "Error: npm install failed."
    exit 1
}
sudo -u "$RUN_USER" bash -c "cd '$SCRIPT_DIR/plugin/renderer' && npx --yes playwright install chromium" || {
    echo "Error: Playwright Chromium download failed."
    exit 1
}

echo "Installing Claude Resolve..."

sudo mkdir -p "$DEST"
sudo cp -R "$SCRIPT_DIR/plugin/"* "$DEST/"

echo ""
echo "Done. Restart DaVinci Resolve to use the plugin."
echo "Open it from Workspace > Workflow Integration > Claude Resolve"
