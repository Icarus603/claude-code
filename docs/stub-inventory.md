# Transition Stub Inventory

## Scope

This inventory tracks the current `src/*/src` transition layer footprint for Phase 0.
The goal is to keep the repo honest about where compatibility shims still exist, which
ones are structural, and which ones can be removed without waiting for package
extraction.

## Classification

### Necessary Transition

These paths still act as active compatibility seams for imports that resolve through
`src/...` aliases or for code that has not yet been moved behind a stable package seam.

- `src/cli/src/*`
- `src/bootstrap/src/*`
- `src/components/agents/src/*`
- `src/components/PromptInput/src/*`
- `src/services/api/src/*`
- `src/tools/*/src/*`
- `src/utils/processUserInput/src/*`
- `src/utils/src/*`

Typical characteristics:
- Contains many files, not only `export type ... = any`.
- Still fronts code that is imported through `src/*.js` compatibility paths.
- Should be retired only after the owning Phase establishes a real public seam.

### Immediate Removal Candidates

These were low-risk dead stubs in Phase 0 because they were single-purpose type-any
re-exports with no live references in the repo.

Removed in this phase:
- `src/components/LogoV2/src/ink.ts`
- `src/components/messages/src/ink.ts`
- `src/components/permissions/src/ink.ts`
- `src/components/tasks/src/ink.ts`
- `src/hooks/notifs/src/ink.ts`
- `src/hooks/src/ink.ts`

Still worth reviewing next:
- `src/components/Settings/src/cost-tracker.ts`
- `src/components/src/commands.ts`
- `src/constants/src/commands.ts`

Review rule:
- Only remove when the shim is dead and the stable import target already exists.

### Defer Until Package / Seam Landing

These areas are intentionally postponed because they still represent unresolved package,
provider, or domain boundaries.

- `src/services/mcp/src/*`
- `src/state/src/*`
- `src/commands/src/*`
- `src/services/src/*`
- `src/components/FeedbackSurvey/src/*`
- `src/components/TrustDialog/src/*`
- `src/commands/install-github-app/src/*`

Typical reasons to defer:
- The shim sits on a future package seam.
- Removing it now would force broad import rewrites unrelated to Phase 0.
- The owning domain still lacks a clean public entrypoint.

## Current Guardrails

- `scripts/check-transition-stubs.ts` blocks any newly introduced `src/*/src` directories.
- `bun run health` includes the transition stub guard result.
- Existing `export type ... = any` stubs are inventory, not proof of a completed boundary.

## Phase 0 Outcome

Phase 0 does not attempt to delete every transition stub. It establishes:

- a tracked inventory,
- a failing guard against new transition directories,
- and a small first pass of safe deletions to prove the cleanup path works.
