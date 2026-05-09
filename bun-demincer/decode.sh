#!/usr/bin/env bash
# decode.sh — full bun-demincer pipeline for one ant claude-code version.
#
# Usage:
#   ./decode.sh                 # auto-decode every version under
#                               # ~/.local/share/claude/versions/ that
#                               # doesn't yet have a work/claude-code-X.Y.Z/.
#   ./decode.sh 2.1.126         # decode a specific version.
#   ./decode.sh 2.1.126 --force # re-decode even if already present.
#
# Pipeline (per version):
#   1. extract  → work/claude-code-X.Y.Z/extracted/
#   2. resplit  → work/claude-code-X.Y.Z/resplit/
#   3. vendors  → resplit/vendor-overrides.json (classify only, no rebuild)
#   4. deobf    → work/claude-code-X.Y.Z/decoded/
#
# Subsequent stages (extract-deps / cluster-graph / organize) need a
# manual cluster-labels.json so they're skipped here.
#
# Side effect: appends to ./runs.log (inside bun-demincer/, gitignored).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
ANT_VERSIONS_DIR="$HOME/.local/share/claude/versions"
WORK_DIR="$ROOT/work"
LOG_FILE="$ROOT/runs.log"

ts() { date '+%Y-%m-%d %H:%M:%S'; }
log() { echo "[$(ts)] $*" | tee -a "$LOG_FILE" >&2; }

decode_one() {
    local version="$1"
    local force="${2:-}"
    local binary="$ANT_VERSIONS_DIR/$version"
    local outdir="$WORK_DIR/claude-code-$version"

    if [[ ! -f "$binary" ]]; then
        log "ERROR: binary missing: $binary"
        return 1
    fi

    if [[ -d "$outdir/decoded" && "$force" != "--force" ]]; then
        log "skip $version (already decoded — pass --force to redo)"
        return 0
    fi

    log "decode start: $version"
    rm -rf "$outdir"
    mkdir -p "$outdir"

    # 1. extract
    log "  [1/4] extract"
    node "$ROOT/src/extract.mjs" "$binary" "$outdir/extracted/"

    # 2. resplit — bundle lives at extracted/src/entrypoints/cli.js (not
    # `extracted/bundle.js` like older docs say).
    log "  [2/4] resplit"
    local bundle="$outdir/extracted/src/entrypoints/cli.js"
    if [[ ! -f "$bundle" ]]; then
        log "ERROR: bundle missing after extract: $bundle"
        return 1
    fi
    node "$ROOT/src/resplit.mjs" "$bundle" "$outdir/resplit/"

    # 3. vendor classification (--classify reuses the existing fingerprint DB)
    log "  [3/4] match-vendors"
    node "$ROOT/src/match-vendors.mjs" "$outdir/resplit/" \
        --db "$ROOT/data/vendor-fingerprints-1000.json" \
        --classify

    # 4. deobfuscate (copy resplit → decoded, run all stages)
    log "  [4/4] deobfuscate"
    cp -R "$outdir/resplit" "$outdir/decoded"
    node "$ROOT/src/deobfuscate.mjs" --dir "$outdir/decoded/"

    log "decode done:  $version → $outdir"
}

main() {
    local target="${1:-}"
    local flag="${2:-}"

    if [[ -n "$target" ]]; then
        decode_one "$target" "$flag"
        return
    fi

    # Auto: walk ~/.local/share/claude/versions/, decode every binary that
    # doesn't have a matching work/ directory yet.
    if [[ ! -d "$ANT_VERSIONS_DIR" ]]; then
        log "ERROR: $ANT_VERSIONS_DIR not found"
        exit 1
    fi

    local decoded_count=0
    for binary in "$ANT_VERSIONS_DIR"/*; do
        [[ -f "$binary" ]] || continue
        local version
        version="$(basename "$binary")"
        # Only treat plain semver-ish names as versions.
        [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || continue
        if [[ -d "$WORK_DIR/claude-code-$version/decoded" ]]; then
            continue
        fi
        decode_one "$version"
        decoded_count=$((decoded_count + 1))
    done

    if [[ $decoded_count -eq 0 ]]; then
        log "auto: nothing new to decode"
    else
        log "auto: decoded $decoded_count new version(s)"
    fi
}

main "$@"
