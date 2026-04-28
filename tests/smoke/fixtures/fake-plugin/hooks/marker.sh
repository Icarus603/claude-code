#!/usr/bin/env bash
# Live-fire smoke marker — writes to a marker dir so the smoke test can
# assert the hook command actually spawned. The marker dir is provided
# via SMOKE_MARKER_DIR env var (set by the test).
set -euo pipefail

EVENT="${1:-unknown}"
MARKER_DIR="${SMOKE_MARKER_DIR:-/tmp/cc-smoke-marker}"
mkdir -p "$MARKER_DIR"

# Write event marker. Test asserts presence of "$EVENT" file.
echo "fired at $(date +%s%N)" > "$MARKER_DIR/$EVENT.fired"

# For Stop hook: emit decision:block JSON so the loop knows we ran.
if [ "$EVENT" = "Stop" ]; then
  cat <<EOF
{"decision": "block", "reason": "smoke fixture stop hook", "systemMessage": "smoke marker fired"}
EOF
fi

exit 0
