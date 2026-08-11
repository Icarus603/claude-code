#!/usr/bin/env bash
# analyze.sh — invoke ccb (Opus 4.7, max effort, bypassPermissions) to
# produce a structured changelog for one (verA, verB) version pair.
#
# Usage:
#   ./analyze.sh 2.1.131 2.1.132    # analyse a single pair
#   ./analyze.sh --all-pairs        # analyse every adjacent pair of
#                                   # decoded versions that doesn't
#                                   # yet have a reports/<A>-to-<B>/.
#
# Side effects:
#   - writes reports/<A>-to-<B>/analysis.md       (the changelog)
#   - writes reports/<A>-to-<B>/metadata.json     (run footprint)
#   - appends to runs.log
#   - calls delta.sh A B if deltas/<A>-to-<B>.json doesn't exist
#
# Idempotent: skips a pair when reports/<A>-to-<B>/analysis.md already
# exists. Force re-run with --force.
#
# Pair isolation: --all-pairs continues after a single pair fails, then
# returns non-zero after the walk if any pair failed. Callers therefore get
# a truthful run status without losing diagnostics for later pairs.

set -uo pipefail        # NOTE: no -e here — soft failures by design

ROOT="$(cd "$(dirname "$0")" && pwd)"
WORK_DIR="$ROOT/work"
DELTAS_DIR="$ROOT/deltas"
REPORTS_DIR="$ROOT/reports"
LOG_FILE="$ROOT/runs.log"
AUTH_CHECK_STATE="unchecked"

ts() { date '+%Y-%m-%d %H:%M:%S'; }
log() { echo "[$(ts)] analyze: $*" | tee -a "$LOG_FILE" >&2; }

# ── locate ccb (release binary, not dev) ───────────────────────────────
CCB_BIN="${CCB_BIN:-$HOME/.local/bin/ccb}"
if [[ ! -x "$CCB_BIN" ]]; then
    # Fall back to PATH lookup. launchd's PATH includes ~/.local/bin
    # via the plist EnvironmentVariables, but a manual run from a weird
    # shell might not.
    CCB_BIN="$(command -v ccb 2>/dev/null || true)"
fi
if [[ -z "$CCB_BIN" || ! -x "$CCB_BIN" ]]; then
    log "ERROR: ccb binary not found (tried \$HOME/.local/bin/ccb and \$PATH) — install ccb first"
    exit 1
fi

# ── authentication preflight ───────────────────────────────────────────
# Run lazily: a fully analysed --all-pairs invocation should remain a clean
# no-op even when the user is currently logged out. The result is cached so a
# missing login produces one actionable diagnostic instead of one per pair.
check_ccb_auth() {
    if [[ "$AUTH_CHECK_STATE" == "ready" ]]; then
        return 0
    fi
    if [[ "$AUTH_CHECK_STATE" == "failed" ]]; then
        return 1
    fi

    if [[ "${CCB_SKIP_AUTH_CHECK:-0}" == "1" ]]; then
        AUTH_CHECK_STATE="ready"
        log "WARN: ccb authentication preflight bypassed by CCB_SKIP_AUTH_CHECK=1"
        return 0
    fi

    local auth_output
    local auth_exit=0
    auth_output=$("$CCB_BIN" auth status 2>&1) || auth_exit=$?
    if printf '%s' "$auth_output" | grep -Eq '"loggedIn"[[:space:]]*:[[:space:]]*false'; then
        AUTH_CHECK_STATE="failed"
        log "ERROR: ccb is not logged in — run '$CCB_BIN auth login' interactively before automated analysis"
        return 1
    fi
    if (( auth_exit != 0 )); then
        AUTH_CHECK_STATE="failed"
        log "ERROR: ccb auth status failed (exit=$auth_exit) — run '$CCB_BIN auth login' interactively"
        return 1
    fi
    if ! printf '%s' "$auth_output" | grep -Eq '"loggedIn"[[:space:]]*:[[:space:]]*true'; then
        AUTH_CHECK_STATE="failed"
        log "ERROR: ccb is not logged in — run '$CCB_BIN auth login' interactively before automated analysis"
        return 1
    fi

    AUTH_CHECK_STATE="ready"
    return 0
}

# ── core: analyse one pair ──────────────────────────────────────────────
analyze_pair() {
    local A="$1"
    local B="$2"
    local force="${3:-}"

    local pair_dir="$REPORTS_DIR/$A-to-$B"
    local analysis_md="$pair_dir/analysis.md"
    local metadata_json="$pair_dir/metadata.json"
    local delta_json="$DELTAS_DIR/$A-to-$B.json"

    # ── skip if already done (unless --force) ──────────────────────────
    if [[ -f "$analysis_md" && "$force" != "--force" ]]; then
        log "skip $A->$B (analysis.md exists — pass --force to redo)"
        return 0
    fi

    # ── ensure delta JSON exists ───────────────────────────────────────
    if [[ ! -f "$delta_json" ]]; then
        log "delta missing for $A->$B — generating via delta.sh"
        if ! "$ROOT/delta.sh" "$A" "$B" >/dev/null; then
            log "ERROR: delta.sh $A $B failed — skipping analysis for this pair"
            return 1
        fi
    fi

    # ── ensure both decoded trees exist ────────────────────────────────
    for v in "$A" "$B"; do
        local d="$WORK_DIR/claude-code-$v/decoded"
        if [[ ! -d "$d" || -z "$(ls -A "$d" 2>/dev/null)" ]]; then
            log "ERROR: decoded tree missing/empty for $v -- skipping pair $A->$B"
            return 1
        fi
    done

    if ! check_ccb_auth; then
        return 1
    fi

    mkdir -p "$pair_dir"

    log "ccb agent start: $A -> $B (opus-4-7, max effort, bypassPermissions)"
    local start_epoch
    start_epoch=$(date +%s)

    # ── the entire instruction set lives in analyzer/ — this prompt is
    # ── a 3-line pointer. agent reads PROMPT.md / METHOD.md / TEMPLATE.md
    # ── / EXAMPLE.md and writes the report itself.
    #
    # Why this short: prompt cache stays warm between runs (only the A/B
    # values change), and editing analyser/*.md becomes the way to
    # tune behaviour — no shell-string rebuilds, no quoting hell.
    local prompt
    prompt=$(cat <<EOF
你被派為 autonomous ccb agent。讀取 \`analyzer/PROMPT.md\` 並完整執行其指示。

本次分析目標：
- versionA: $A
- versionB: $B
- 報告寫到: reports/$A-to-$B/analysis.md
- 元資訊寫到: reports/$A-to-$B/metadata.json

開始之前：先 Read analyzer/PROMPT.md, analyzer/METHOD.md, analyzer/TEMPLATE.md, analyzer/EXAMPLE.md。然後執行任務。完成所有 TEMPLATE.md 要求的 section 才算完工。
EOF
)

    # ── invoke ccb. Capture both stdout (the model's narration) and the
    # ── real exit code. Metadata is still written on failure so the run
    # ── remains auditable; --all-pairs decides whether to continue.
    local ccb_log="$pair_dir/.ccb.log"
    local ccb_exit=0
    "$CCB_BIN" -p \
            --model claude-opus-4-7 \
            --permission-mode bypassPermissions \
            --no-session-persistence \
            --output-format text \
            "$prompt" \
            > "$ccb_log" 2>&1 || ccb_exit=$?
    if (( ccb_exit != 0 )); then
        log "WARN: ccb exited non-zero ($ccb_exit) for $A->$B -- see $ccb_log"
    fi

    local end_epoch
    end_epoch=$(date +%s)
    local wall_seconds=$((end_epoch - start_epoch))

    # ── verify outputs ─────────────────────────────────────────────────
    local analysis_present=false
    local analysis_size=0
    if [[ -f "$analysis_md" ]]; then
        analysis_present=true
        analysis_size=$(wc -c < "$analysis_md" | tr -d ' ')
    fi

    # ── write metadata.json regardless (so we can audit failed runs) ───
    cat > "$metadata_json" <<EOF
{
  "versionA": "$A",
  "versionB": "$B",
  "generatedAt": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
  "analyzer": "claude-opus-4-7",
  "analyzerEffort": "max",
  "permissionMode": "bypassPermissions",
  "wallSeconds": $wall_seconds,
  "ccbExitCode": $ccb_exit,
  "analysisPresent": $analysis_present,
  "analysisBytes": $analysis_size,
  "ccbLog": ".ccb.log"
}
EOF

    if [[ "$analysis_present" == false ]]; then
        log "WARN: $A->$B finished but analysis.md missing -- wrote stub metadata.json only"
        return 1
    fi

    if [[ "$analysis_size" -lt 500 ]]; then
        log "WARN: $A->$B analysis.md exists but only $analysis_size bytes -- likely incomplete"
        return 1
    fi

    if (( ccb_exit != 0 )); then
        return 1
    fi

    log "ccb agent done:  $A -> $B (${wall_seconds}s, $analysis_size bytes) -> $analysis_md"
}

# ── --all-pairs: walk every adjacent pair of fully-decoded versions ─────
analyze_all_pairs() {
    local force="${1:-}"
    if [[ ! -d "$WORK_DIR" ]]; then
        log "ERROR: $WORK_DIR not found"
        exit 1
    fi

    # Same bash 3.2 compat shape as delta.sh (no mapfile, no negative idx)
    local versions=()
    while IFS= read -r v; do
        versions+=("$v")
    done < <(
        for d in "$WORK_DIR"/claude-code-*; do
            [[ -d "$d" ]] || continue
            ver="$(basename "$d" | sed 's/^claude-code-//')"
            [[ "$ver" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || continue
            [[ -d "$d/decoded" && -n "$(ls -A "$d/decoded" 2>/dev/null)" ]] || continue
            echo "$ver"
        done | sort -V
    )

    local n=${#versions[@]}
    if (( n < 2 )); then
        log "--all-pairs: need ≥2 fully-decoded versions, found $n"
        return 0
    fi

    log "--all-pairs: walking $((n-1)) adjacent pair(s) across $n versions"
    local i
    local failed=0
    for (( i = 0; i < n - 1; i++ )); do
        if ! analyze_pair "${versions[i]}" "${versions[i+1]}" "$force"; then
            failed=$((failed + 1))
        fi
    done
    if (( failed > 0 )); then
        log "ERROR: --all-pairs completed with $failed failed pair(s)"
        return 1
    fi
}

main() {
    local arg1="${1:-}"
    local arg2="${2:-}"
    local arg3="${3:-}"

    case "$arg1" in
        --all-pairs)
            analyze_all_pairs "$arg2"
            ;;
        --check-auth)
            check_ccb_auth
            ;;
        --help|-h|"")
            cat <<EOF
Usage:
  $0 <versionA> <versionB> [--force]   analyse one pair
  $0 --all-pairs [--force]             analyse every adjacent decoded pair
  $0 --check-auth                       validate non-interactive ccb authentication

Outputs reports/<A>-to-<B>/analysis.md and metadata.json.
Idempotent: skips pairs whose analysis.md already exists.
Pair failures don't abort --all-pairs, but the final process status is non-zero.
Set CCB_SKIP_AUTH_CHECK=1 only for a deliberately configured non-Anthropic provider.
EOF
            ;;
        *)
            if [[ -z "$arg2" ]]; then
                log "ERROR: missing versionB. See $0 --help"
                exit 1
            fi
            analyze_pair "$arg1" "$arg2" "$arg3"
            ;;
    esac
}

main "$@"
