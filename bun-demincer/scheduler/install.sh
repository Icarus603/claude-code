#!/usr/bin/env bash
# Install the daily bun-demincer auto-update launchd job.
#
# Idempotent: re-running replaces the existing plist + reloads it.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LABEL="com.icarus.bun-demincer"
SRC_PLIST="$SCRIPT_DIR/${LABEL}.plist"
DST_PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"

if [[ ! -f "$SRC_PLIST" ]]; then
    echo "missing source plist: $SRC_PLIST" >&2
    exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents"

# Bootout existing job (if any) before swapping the plist. Ignore errors
# — bootout returns non-zero when nothing is loaded, which is fine.
launchctl bootout "gui/$UID/${LABEL}" 2>/dev/null || true

cp "$SRC_PLIST" "$DST_PLIST"

# Bootstrap into the GUI (Aqua) launchd domain — that's the one that
# stays alive while the user is logged in. The system domain (root)
# can't access the user's homebrew-installed node.
launchctl bootstrap "gui/$UID" "$DST_PLIST"

echo "installed: $DST_PLIST"
echo "next fire: 09:07 daily"
echo
echo "  list:    launchctl list | grep ${LABEL}"
echo "  trigger: launchctl kickstart gui/\$UID/${LABEL}"
echo "  remove:  $SCRIPT_DIR/uninstall.sh"
