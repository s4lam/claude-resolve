#!/bin/bash
# Friendly double-click launcher for Resolve AI releases.
# Kept separate from install.command so old instructions continue to work.
cd "$(dirname "$0")" || exit 1
chmod +x "./Install Resolve AI.command" ./install.command ./install.sh 2>/dev/null || true
bash ./install.command
