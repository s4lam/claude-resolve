#!/bin/bash
# Friendly double-click launcher for Resolve AI releases.
cd "$(dirname "$0")" || exit 1
chmod +x "./Install Resolve AI.command" ./installer/install.sh 2>/dev/null || true
bash ./installer/install.sh
