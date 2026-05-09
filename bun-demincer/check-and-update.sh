#!/usr/bin/env bash
# check-and-update.sh — daily auto-trigger for the bun-demincer pipeline.
#
# Compares the newest non-empty binary under
# ~/.local/share/claude/versions/ against the newest fully-decoded
# version under work/. If the official auto-updater has pulled a newer
# binary than we've decoded, run decode.sh + delta.sh --auto.
#
# Designed to be invoked by launchd (see scheduler/com.icarus.bun-demincer.plist)
# but safe to run by hand. No-op when caught up — quiet by design.
#
# Side effects: appends to runs.log (same file decode.sh / delta.sh use)
# and posts a single macOS notification on successful catch-up.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
ANT_VERSIONS_DIR="$HOME/.local/share/claude/versions"
WORK_DIR="$ROOT/work"
LOG_FILE="$ROOT/runs.log"
LOCK_FILE="$ROOT/.update.lock"

ts() { date '+%Y-%m-%d %H:%M:%S'; }
log() { echo "[$(ts)] check: $*" | tee -a "$LOG_FILE" >&2; }
notify() {
    # Best-effort macOS Notification Center post. Silent on headless /
    # ssh / non-aqua sessions — never block the pipeline on this.
    local title="$1"
    local body="$2"
    osascript -e "display notification \"${body}\" with title \"${title}\"" \
        2>/dev/null || true
}

# ── single-instance lock ────────────────────────────────────────────────
# launchd will not double-fire by itself, but a manual `./check-and-update.sh`
# while a launchd run is mid-pipeline would interleave runs.log and corrupt
# the partial work/ tree. macOS doesn't ship `flock`; use atomic mkdir
# (POSIX-portable: mkdir on an existing dir returns non-zero, and the
# operation is atomic at the filesystem level — exactly the lock primitive
# we need).
LOCK_DIR="${LOCK_FILE%.lock}.lockdir"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    # Stale-lock recovery: if the lock dir exists but the recorded PID is
    # gone, the previous run crashed — claim the lock. Otherwise bail.
    if [[ -f "$LOCK_DIR/pid" ]]; then
        prev_pid="$(cat "$LOCK_DIR/pid" 2>/dev/null || echo 0)"
        if [[ "$prev_pid" =~ ^[0-9]+$ ]] && ! kill -0 "$prev_pid" 2>/dev/null; then
            log "stale lock from pid $prev_pid (process gone) — reclaiming"
            rm -rf "$LOCK_DIR"
            mkdir "$LOCK_DIR"
        else
            log "another run in progress (pid=$prev_pid) — exiting"
            exit 0
        fi
    else
        log "lock dir present without pid file — exiting (manual cleanup: rm -rf $LOCK_DIR)"
        exit 0
    fi
fi
echo "$$" > "$LOCK_DIR/pid"
trap 'rm -rf "$LOCK_DIR"' EXIT INT TERM

# ── A) newest non-empty official binary ─────────────────────────────────
local_max=""
if [[ -d "$ANT_VERSIONS_DIR" ]]; then
    local_max=$(
        for f in "$ANT_VERSIONS_DIR"/*; do
            # -f = regular file, -s = exists AND size > 0 (filters
            # zero-byte placeholders the auto-updater may briefly leave)
            [[ -f "$f" && -s "$f" ]] || continue
            name="$(basename "$f")"
            [[ "$name" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || continue
            echo "$name"
        done | sort -V | tail -1
    )
fi

if [[ -z "$local_max" ]]; then
    log "no official binary under $ANT_VERSIONS_DIR — nothing to do"
    exit 0
fi

# ── B) newest fully-decoded version ─────────────────────────────────────
decoded_max=""
if [[ -d "$WORK_DIR" ]]; then
    decoded_max=$(
        for d in "$WORK_DIR"/claude-code-*; do
            [[ -d "$d" ]] || continue
            ver="$(basename "$d" | sed 's/^claude-code-//')"
            [[ "$ver" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || continue
            # "fully decoded" = decoded/ exists AND non-empty (a half-built
            # tree from a crashed decode.sh shouldn't count as the floor).
            [[ -d "$d/decoded" ]] || continue
            [[ -n "$(ls -A "$d/decoded" 2>/dev/null)" ]] || continue
            echo "$ver"
        done | sort -V | tail -1
    )
fi

# ── C) compare ──────────────────────────────────────────────────────────
# sort -V handles 2.1.10 > 2.1.9 correctly (string compare wouldn't).
# If decoded_max is empty (first-ever run), local_max wins by default.
if [[ -n "$decoded_max" ]]; then
    newest="$(printf '%s\n%s\n' "$local_max" "$decoded_max" | sort -V | tail -1)"
    if [[ "$newest" == "$decoded_max" && "$local_max" == "$decoded_max" ]]; then
        # equal — caught up
        log "up to date (local=$local_max, decoded=$decoded_max)"
        exit 0
    fi
    if [[ "$newest" == "$decoded_max" ]]; then
        # decoded > local — happens after manual decode of a version no
        # longer present in versions/ (auto-updater pruned older binaries).
        # Not an error, just nothing to do.
        log "decoded ahead of local (local=$local_max, decoded=$decoded_max) — nothing to do"
        exit 0
    fi
fi

# ── D) catch up ─────────────────────────────────────────────────────────
log "update available: local=$local_max, decoded=${decoded_max:-<none>} — running pipeline"

# decode.sh auto-walks every official binary that doesn't yet have a
# work/ directory; --auto on delta.sh picks the newest pair. Both
# already append to runs.log themselves.
"$ROOT/decode.sh"
"$ROOT/delta.sh" --auto

# ── E) LLM analysis (Opus 4.7, max effort, bypassPermissions) ──────────
# analyze.sh --all-pairs walks every adjacent pair of fully-decoded
# versions and:
#   - skips pairs that already have reports/<A>-to-<B>/analysis.md
#   - generates the delta JSON if missing (filling in gaps that
#     delta.sh --auto skipped because it only does the newest pair)
#   - spawns ccb agent per pair to write analysis.md + metadata.json
# Soft-fails: a single ccb error does NOT abort the catch-up loop.
"$ROOT/analyze.sh" --all-pairs

# Re-read decoded_max post-pipeline so the notification reflects truth,
# not what we hoped for. (decode.sh could have failed on one specific
# version while succeeding on others.)
new_decoded_max=$(
    for d in "$WORK_DIR"/claude-code-*; do
        [[ -d "$d" ]] || continue
        ver="$(basename "$d" | sed 's/^claude-code-//')"
        [[ "$ver" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || continue
        [[ -d "$d/decoded" && -n "$(ls -A "$d/decoded" 2>/dev/null)" ]] || continue
        echo "$ver"
    done | sort -V | tail -1
)

log "pipeline done — decoded now at ${new_decoded_max:-<none>}"
notify "bun-demincer caught up" \
    "decoded ${decoded_max:-<none>} → ${new_decoded_max:-<none>} (local: $local_max)"
