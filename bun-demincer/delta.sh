#!/usr/bin/env bash
# delta.sh — diff two decoded ant claude-code versions and write a
# changelog markdown for the user.
#
# Usage:
#   ./delta.sh <version-a> <version-b>   # explicit pair
#   ./delta.sh --auto                    # newest two decoded versions
#   e.g. ./delta.sh 2.1.123 2.1.126
#        ./delta.sh --auto
#
# Output: deltas/<a>-to-<b>.md (+ .json), repo-relative.
#
# Requires: both versions already decoded under work/claude-code-X.Y.Z/.
# (Run ./decode.sh <version> first if missing.)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
WORK_DIR="$ROOT/work"
DELTAS_DIR="$ROOT/deltas"
LOG_FILE="$ROOT/runs.log"

mkdir -p "$DELTAS_DIR"

ts() { date '+%Y-%m-%d %H:%M:%S'; }
log() { echo "[$(ts)] $*" | tee -a "$LOG_FILE" >&2; }

# --auto: pick the two newest decoded versions by semver. Skips work/
# entries that don't have a fully-built decoded/ directory (i.e. only run
# delta on versions that decode.sh actually finished).
if [[ "${1:-}" == "--auto" ]]; then
    if [[ ! -d "$WORK_DIR" ]]; then
        log "ERROR: $WORK_DIR not found — nothing decoded yet"
        exit 1
    fi
    # Collect "X.Y.Z" tokens from work/claude-code-X.Y.Z/decoded/.
    # macOS ships bash 3.2 — no `mapfile`, no negative-index slices. Use a
    # while-read loop and explicit ${arr[$((n-1))]} indexing, which works
    # on every POSIX-ish bash from 3.0 onward.
    versions=()
    while IFS= read -r v; do
        versions+=("$v")
    done < <(
        find "$WORK_DIR" -mindepth 1 -maxdepth 1 -type d -name 'claude-code-*' |
            while read -r d; do
                ver="${d##*claude-code-}"
                [[ -d "$d/decoded" ]] || continue
                [[ "$ver" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || continue
                echo "$ver"
            done |
            # numeric sort by major/minor/patch — `sort -V` handles semver
            sort -V
    )
    if [[ ${#versions[@]} -lt 2 ]]; then
        log "ERROR: --auto needs ≥2 fully-decoded versions, found ${#versions[@]}"
        exit 1
    fi
    n=${#versions[@]}
    A="${versions[$((n-2))]}"
    B="${versions[$((n-1))]}"
    log "auto-pick: ${A} → ${B} (newest pair of ${n} decoded)"
elif [[ $# -lt 2 ]]; then
    echo "Usage: $0 <version-a> <version-b>" >&2
    echo "       $0 --auto" >&2
    exit 1
else
    A="$1"
    B="$2"
fi
DIR_A="$WORK_DIR/claude-code-$A"
DIR_B="$WORK_DIR/claude-code-$B"
OUT="$DELTAS_DIR/$A-to-$B.md"
JSON_OUT="$DELTAS_DIR/$A-to-$B.json"

for d in "$DIR_A" "$DIR_B"; do
    if [[ ! -d "$d/resplit" ]]; then
        log "ERROR: $d/resplit missing — run ./decode.sh $(basename "$d" | sed 's/^claude-code-//') first"
        exit 1
    fi
done

log "delta start: $A → $B"

# diff-versions.mjs accepts absolute paths directly (resolveVersionDir at
# line 130 short-circuits on isAbsolute() && exists()). Pass our work-dir
# paths and bypass the script's built-in versions/ lookup.
node "$ROOT/src/diff-versions.mjs" "$DIR_A" "$DIR_B" \
    --out "$JSON_OUT" \
    --changelog \
    --stats 2> "$DELTAS_DIR/.stderr-$A-to-$B.tmp" || {
        log "ERROR: diff-versions failed; see $DELTAS_DIR/.stderr-$A-to-$B.tmp"
        exit 1
    }

# Build a markdown report with the changelog (already in stderr) and a
# pointer to the JSON for deeper inspection.
{
    echo "# ccb delta: ant v$A → v$B"
    echo
    echo "Generated $(ts)."
    echo
    echo "## Stats / Changelog"
    echo
    echo '```'
    cat "$DELTAS_DIR/.stderr-$A-to-$B.tmp"
    echo '```'
    echo
    echo "## Detail"
    echo
    echo "Full JSON report: \`$JSON_OUT\`"
    echo
    echo "Each entry there has matched-pair fingerprints, normalized-diff,"
    echo "and a per-module score. Grep for \`type: \"new\"\` (modules added"
    echo "in $B) and \`type: \"removed\"\` (modules dropped from $A) for"
    echo "the most surprising changes."
} > "$OUT"

rm -f "$DELTAS_DIR/.stderr-$A-to-$B.tmp"

log "delta done:  $A → $B → $OUT"
echo "$OUT"
