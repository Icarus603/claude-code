# Upstream Compatibility Baseline

Last reviewed: 2026-07-10

## Baselines

- Source reconstruction baseline: Claude Code 2.1.88 (2026-03-31).
- Latest stable compatibility review: Claude Code 2.1.197.
- Agent SDK development dependency: `@anthropic-ai/claude-agent-sdk@0.3.197`.

The compatibility review compares the stable upstream CLI surface and decoded
bundle deltas with ccb's packages. It is not a claim of line-for-line parity:
ccb remains a local, public, multi-provider derivative with its own release and
feature policy.

## 2.1.197 Review Outcome

This baseline includes the applicable public CLI changes through 2.1.197:

- `--effort` accepts and documents the already-supported `xhigh` level.
- `--prompt-suggestions` is exposed for print/SDK stream-json sessions and
  feeds the existing prompt-suggestion pipeline.
- `--remote-control [name]` is visible now that `BRIDGE_MODE` is stable and
  enabled in release builds.

The review also confirmed that several upstream changes were already present,
including push notifications, existing-path worktree entry, Remote Control,
and prompt-suggestion generation. The upstream thinking-aware tool-use reorder
guard does not apply because ccb's merge path does not perform the upstream
reordering operation.

Anthropic-hosted or internal-only surfaces such as `gateway` and
`ultrareview` are intentionally outside ccb's public compatibility contract.
They should not be added unless a local, provider-neutral implementation and a
maintainable public contract exist.

## Refresh Procedure

For the next review:

1. Pin the current stable Agent SDK rather than following an unbounded range.
2. Compare the previous reviewed stable bundle with the new stable bundle.
3. Map each semantic change to an existing ccb owner package.
4. Port applicable behavior with tests; document intentional exclusions.
5. Run lint, tests, the architecture doctor, smoke tests, and a release build.
