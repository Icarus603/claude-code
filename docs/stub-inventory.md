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
- `src/**/src/services/analytics/*` compatibility stubs

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

## Phase 2 Update

Phase 2 removed the analytics/telemetry transition seam entirely instead of
promoting it to a package:

- `src/services/analytics/*` has been deleted.
- corresponding `src/*/src/services/analytics/*` type-any stubs have been deleted.
- runtime imports now target package seams (`@claude-code/config`, `@claude-code/memory`,
  `@claude-code/permission`, `@claude-code/tool-registry`) or local-only no-op
  diagnostic helpers.

This means analytics-related stub directories are no longer valid inventory
items for later phases; reintroducing them would be a regression.

Phase 2 also converted part of the old `src/` implementation into true package
ownership instead of leaving every seam as a re-export:

- `src/utils/config.ts` now forwards to `@claude-code/config`, so config state
  no longer exists in two competing implementations.
- `src/services/featureFlags.ts` now forwards to `@claude-code/config/feature-flags`,
  so feature-flag ownership also lives under the config package seam.
- `src/memdir/memoryAge.ts`, `src/memdir/paths.ts`, `src/memdir/teamMemPaths.ts`
  now forward to `@claude-code/memory`, where the implementation lives.
- `src/memdir/memdir.ts`, `findRelevantMemories.ts`, `memoryTypes.ts`,
  `teamMemPrompts.ts`, `src/services/extractMemories/extractMemories.ts`,
  `src/services/autoDream/autoDream.ts`,
  `src/services/autoDream/consolidationPrompt.ts`,
  `src/services/teamMemorySync/index.ts`, and
  `src/tools/AgentTool/agentMemory.ts` now also forward to
  `@claude-code/memory`.
- `src/services/autoDream/config.ts` and
  `src/services/autoDream/consolidationLock.ts` now forward to
  `@claude-code/memory`.
- `src/utils/permissions/PermissionMode.ts`,
  `PermissionResult.ts`, `PermissionRule.ts`, `PermissionUpdateSchema.ts`,
  `permissionRuleParser.ts`, and `PermissionUpdate.ts` now forward to
  `@claude-code/permission`.
- `src/utils/permissions/permissions.ts`, `permissionSetup.ts`,
  `filesystem.ts`, `PermissionPromptToolResultSchema.ts`, and
  `denialTracking.ts` now also forward to `@claude-code/permission`.

Phase 2 also paid down a cluster of old import-cycle hazards that were blocking
package-level validation, even though they predated the seam extraction:

- `src/services/compact/microCompact.ts`
- `src/services/compact/apiMicrocompact.ts`
- `src/constants/tools.ts`
- `src/utils/attribution.ts`
- `src/tools/AgentTool/built-in/claudeCodeGuideAgent.ts`
- `src/tools/FileReadTool/FileReadTool.ts`

These files no longer rely on eager top-level tool-name initialization for the
affected paths, which lets `@claude-code/memory/memdir` load independently for
Phase 2 smoke validation.

These are intentional compatibility shims, not evidence that the old `src/`
modules still own the logic.
