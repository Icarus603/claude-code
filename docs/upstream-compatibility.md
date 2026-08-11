# Upstream Compatibility Baseline

Last reviewed: 2026-08-11

## Baselines

- Source reconstruction baseline: Claude Code 2.1.88 (2026-03-31).
- Latest decoded binary and structural delta: Claude Code 2.1.207.
- Latest selected behavior port and repository verification: Claude Code
  2.1.207 (`fdf67900`, 2026-07-12).
- Latest complete autonomous semantic report: Claude Code 2.1.158. Reports
  after that version currently have failure metadata but no `analysis.md`
  because the scheduled ccb analyzer was logged out.
- Agent SDK development dependency: `@anthropic-ai/claude-agent-sdk@0.3.197`.

The compatibility review compares the stable upstream CLI surface and decoded
bundle deltas with ccb's packages. It is not a claim of line-for-line parity:
ccb remains a local, public, multi-provider derivative with its own release and
feature policy.

These states are deliberately separate. “Decoded” means a binary was
structurally recovered; “analysed” means the delta received a complete semantic
report; “ported” means selected applicable behavior entered ccb; “verified”
means the resulting repository passed its gates. None of them means
line-for-line parity.

## 2.1.207 Port Outcome

The 2.1.207 alignment commit touched 101 files and ported selected changes in
hooks, permission handling, MCP roots and reserved names, stacked slash
commands, worktree safety, updater streaming, background-agent notifications,
and provider retry/recovery behavior. It also added focused tests around the
new boundaries.

The earlier 2.1.197 review had already included these public CLI changes:

- `--effort` accepts and documents the already-supported `xhigh` level.
- `--prompt-suggestions` is exposed for print/SDK stream-json sessions and
  feeds the existing prompt-suggestion pipeline.
- `--remote-control [name]` is visible now that `BRIDGE_MODE` is stable and
  enabled in release builds.

That review also confirmed that several upstream changes were already present,
including push notifications, existing-path worktree entry, Remote Control,
and prompt-suggestion generation. The upstream thinking-aware tool-use reorder
guard does not apply because ccb's merge path does not perform the upstream
reordering operation.

Anthropic-hosted or internal-only surfaces such as `gateway` and
`ultrareview` are intentionally outside ccb's public compatibility contract.
They should not be added unless a local, provider-neutral implementation and a
maintainable public contract exist.

The semantic-report backlog from 2.1.158 through 2.1.207 remains an explicit
evidence gap even though selected 2.1.207 behavior was ported and verified.
Run `bun-demincer/analyze.sh --check-auth`, log in interactively if needed, and
then rerun `--all-pairs` to close it. Failed attempts now return non-zero and
preserve metadata instead of appearing successful.

## Refresh Procedure

For the next review:

1. Pin the current stable Agent SDK rather than following an unbounded range.
2. Compare the previous reviewed stable bundle with the new stable bundle.
3. Map each semantic change to an existing ccb owner package.
4. Port applicable behavior with tests; document intentional exclusions.
5. Run lint, tests, the architecture doctor, smoke tests, and a release build.
