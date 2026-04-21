// Stub command shared across feature-disabled entry points.
//
// Replaces 17 individual src/commands/(name)/index.js stubs that were
// identical (ant-trace, autofix-pr, backfill-sessions, break-cache,
// bughunter, ctx_viz, debug-tool-call, env, good-claude, issue,
// mock-limits, oauth-refresh, onboarding, perf-issue, share, summary,
// teleport). The registry treats isHidden + isEnabled=false commands as
// absent, so callers see the same runtime behavior as before while the
// file count drops by 17.

export default { isEnabled: () => false, isHidden: true, name: 'stub' }
