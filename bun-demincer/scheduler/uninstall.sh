#!/usr/bin/env bash
# Remove the bun-demincer auto-update launchd job.

set -euo pipefail

LABEL="com.icarus.bun-demincer"
DST_PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"

launchctl bootout "gui/$UID/${LABEL}" 2>/dev/null || true

if [[ -f "$DST_PLIST" ]]; then
    rm "$DST_PLIST"
    echo "removed: $DST_PLIST"
else
    echo "nothing to remove (plist not at $DST_PLIST)"
fi
