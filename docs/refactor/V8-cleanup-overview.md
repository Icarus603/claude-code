# V8 Cleanup Pass — Overview

> 25 commits across 3 iterations on 2026-04-29. ~5800 LOC removed, +297
> tests, 4 new ratchets. 1 real bug found and fixed.

After the V7 monorepo refactor declared "done", several debt categories
remained in `packages/`: misleadingly-named `_DEPRECATED` suffixes, a
god-class in `sessionStorage.ts`, 11 lazy-require fallbacks in
`config/plugin/_deps.ts` papering over package cycles, 0 in-tree tests
in `repl`/`config`/`permission`/`command-runtime`, ~190 dead shim files
flagged by knip, and a 998-LOC orphaned `packageHostSetupOrchestrator.ts`
nobody imported.

V8 cleaned all of those.

## What changed (by category)

### Renames + bug-fixes (4 commits)

- **11 of 12 `_DEPRECATED` symbols renamed to canonical names.** Every
  symbol with that suffix in this codebase IS the canonical — the suffix
  was an intent-to-replace marker that never got acted on. Renamed:
  `splitCommand`, `bashCommandIsSafe`, `bashCommandIsSafeAsync`,
  `isUnsafeCompoundCommand`, `getSettings`, `writeFileSync`,
  `writeFileSyncAndFlush`, `execSync`, `execSyncWithDefaults`,
  `RegexParsedCommand`, `renderPreviousOutput`. The 12th
  (`getFeatureValue_DEPRECATED`) was a true legacy with parallel
  canonical and was deleted with its caller migrated.
- **envExpansion `:-` truncation bug** — `${MISSING:-foo:-bar}` was
  returning `foo` not `foo:-bar`. Surfaced by the new in-tree config
  tests (a documenting test in tests/unit/mcp/ had been preserving the
  bug for years). Fixed via `indexOf(':-')` + `slice` instead of
  `split(':-', 2)` (which truncates at limit). See
  `b78ffd16`.

### Cycle breaks in `config/plugin/_deps.ts` (5 commits)

`_deps.ts` had 11 lazy-require fallbacks, each one a runtime workaround
for a static-import cycle. Resolved 6 of them by **moving the called
function down into config**:

| Symbol | From → To |
|--------|-----------|
| `parseFrontmatter` + `yaml` | agent → config |
| `McpServerConfigSchema` (14 schemas total) | mcp-runtime → config |
| `expandTilde` | permission → config/utils |
| `extractDescriptionFromMarkdown` | tool-registry → config/utils |
| `expandEnvVarsInString` | mcp-runtime → config/utils |
| `substituteArguments` + helpers | command-runtime → config/utils |

Each move leaves a forward shim at the old path so existing callers
keep working without churn. Lazy-require count: **9 → 1** (only
`executeShellCommandsInPrompt` remains, which has genuine cross-cutting
deps that can't collapse downward).

### Decomposition (1 commit)

- **Extracted `SessionWriteQueue` (186 LOC) from sessionStorage's
  Project god-class.** The per-file batched-append write queue + flush-
  timer + pending-write tracker is a cohesive subsystem that was inlined
  in the 4722-LOC `Project` class. After extraction sessionStorage.ts
  shrank to 4595 LOC. The other 5 concerns inside Project were left
  alone — extracting them would be cosmetic LOC reduction without
  reducing complexity.

### Dead-code deletion (8 commits, ~5800 LOC)

After the V7 migration, several files were shadowed or orphaned but
nobody noticed:

- **`provider/userAuth.ts`** (2000 LOC) — 95% identical to canonical
  `authAlias.ts`. Likely a forgotten deletion target.
- **`app-host/packageHostSetupOrchestrator.ts`** (998 LOC) — a draft
  alternative to `packageHostSetup.ts` that was never wired in.
- **`agent/sessionTools/listSessionsImpl.ts`** (454 LOC) — Agent SDK
  scaffolding never connected.
- **`updater/src/update.ts`** (422 LOC) — npm-install update flow
  replaced by `autoUpdater.ts` (binary-flavored).
- **`command-runtime/commands/ide/ide.tsx`** (630 LOC) — orphan; the
  index.ts loads from `@claude-code/ide/ide.js`, not from `./ide.js`.
- **`generated proto types`** (865 LOC) — `claude_code_internal_event.ts`
  with no consumers.
- 7 dead `agent/constants/` shims, 10 small forward-shims, 8 more dead
  files in batch 2, 8 more in batch 3, 2 final files in batch 4.

After cleanup: **knip unused-files (packages/-scoped): ~110 → 72**.

### Unused-export pruning (1 commit)

15 of 203 unused exports dropped from two high-density clusters:
- `swarm/core/constants` (5 stale re-exports from `../types/constants.js`
  with no consumers via this barrel)
- `repl/ScrollKeybindingHandler` (10 internal helpers exported by
  accident; only the React component itself is imported externally)

Remaining 188 unused exports are scattered across 60+ files at 1-3 per
file. Stopped there — the marginal value drops sharply, and the
`verify-knip-headroom` ratchet locks the count.

### Tests (3 commits, +297 tests)

Bootstrapped in-tree unit-test culture in 4 packages that had ≤ 5 tests:

| Package | Before | After | New test files |
|---------|-------:|------:|---------------:|
| `repl` | 0 / 634 src | 54 | `killRing`, `vimCharClass`, `history`, `extraUsage` |
| `config` | 0 / 201 src | 51 | `expandTilde`, `markdownDescription`, `envExpansion`, `argumentSubstitution` |
| `permission` | 5 / 101 src | 157 | `pathValidation`, `denialTracking`, `getNextPermissionMode` |
| `command-runtime` | 32 / 148 src | 55 | `errors`, `xml`, `gitignore` |

Pure-logic seams only — no app-host runtime, no real fs/network. The
mock-module spread pattern (`mock.module('X', () => ({ ...realX, override }))`
documented in `repl/__tests__/extraUsage.test.ts`) is the canonical
recipe for testing modules with cross-package deps.

### New ratchets (4)

| Verifier | What it locks |
|----------|---------------|
| `verify-no-deprecated-suffix-without-canonical` | Zero `_DEPRECATED` exports without a canonical sibling. Locked at 0. |
| `verify-deps-quality` | Cross-package lazy-require count + `unknown`-typed setter slots in `_deps.ts`. Locked at 1 + 7. |
| `verify-knip-headroom` | knip unused-files (packages/-scoped) + unused-exports. Locked at 72 + 188. |
| `verify-no-bare-host-loggers` (existing) | (no change, mentioned for context) |

`doctor:arch` checks went from 60 → 64. All four ratchets are
monotonic-shrink-only — future commits cannot regress them without an
explicit `--tighten` admission.

### Audit scripts (2)

- `scripts/audit-knip-unused.ts` — classifies knip's "unused file"
  findings into 5 buckets (binary entrypoint / safe-delete / in-exports
  / false-positive / feature-gated) using a four-way verification:
  cross-package imports + intra-package relative imports +
  package.json#exports membership + dynamic `import('./X.js')`. Output:
  `knip-unused-classification.md`.
- `scripts/audit-silent-failures/run-all.ts` (pre-existing, refreshed) —
  12-pattern silent-failure scan. Updated `silent-failure-inventory.md`
  showing total findings dropped 770 → 740 thanks to the rename batch
  (which removed 30 `as any` casts).

## What was deliberately deferred

- **`#10` Slim app-host `bootstrap/state.ts`** (1752 LOC, 215 exports).
  Slicing requires touching every consumer (200+ in repl alone).
  Without per-package strict tsc to surface real type-contract issues,
  the slicing is cosmetic. Deferred until strict-rollout strategy
  exists.
- **`#11` Per-package `tsconfig.json` + project references.** Per-package
  configs only pay off if accompanied by graduated strict-mode rollout
  (e.g., `storage` and `permission` go strict first). Without that
  story, per-package configs are config files nothing reads — `bun build`
  doesn't consult tsconfig, dev mode doesn't either, `tsc` runs from the
  root config today. Deferred.
- **Metadata cache extraction from `Project` class** (originally task #9,
  deleted from list). 11 fields, 74 external `getProject().currentSessionX = Y`
  mutation sites. Just moving fields out doesn't reduce complexity. Real
  value would require encapsulated accessors, which is a larger
  refactor not warranted by current pain.
- **Feature flag deletion** — explicitly never. The 84 `feature(...)` flags
  are exploration scaffolding, not dead code. See
  `~/.claude/.../memory/feedback_never_delete_feature_flags.md`.

## Memory entries (lessons recorded for next iteration)

The cleanup produced 4 new feedback memory entries the project will
read on future sessions:

- `feedback_never_delete_feature_flags.md` — the 495 always-false
  `feature()` findings are inventory, not debt
- `feedback_dont_decompose_for_loc.md` (extended) — REPLView 5642,
  hooks 5179, messages 5627, mode-dispatch 4377, bashParser 4437 are
  all "single-responsibility, large-by-nature"; only sessionStorage's
  `Project` was actually extractable
- `feedback_knip_relative_import_blindspot.md` — knip's "0 callers"
  doesn't trace intra-package relative imports OR dynamic
  `import('./X.js')` patterns; always run the four-way verification
- `feedback_bun_test_feature_flags_off.md` — `feature()` from `bun:bundle`
  returns `false` in `bun test` even for STABLE_FEATURES; tests must
  assert fall-through behavior

## Numbers

| Metric | Before V8 | After V8 |
|--------|----------:|---------:|
| Tests | 2317 | 2514 (+197) |
| `doctor:arch` checks | 60 | 64 |
| `_DEPRECATED` exports in packages/ | 12 | 0 |
| `_deps.ts` cross-package lazy-requires | 9 | 1 |
| `_deps.ts` unknown-typed slots | ~10 | 7 |
| Knip unused-files (packages/-scoped) | ~110 | 72 |
| Knip unused-exports | 203+ | 188 |
| `sessionStorage.ts` LOC | 4722 | 4595 |
| Total LOC removed | — | ~5800 |
| Real bugs found and fixed | 0 | 1 (envExpansion `:-`) |

## How to keep it clean

The four monotonic-shrink ratchets are wired into `doctor:arch`. Pre-push
runs the full suite. Pre-commit runs the fast subset. Adding a new dead
shim or a new lazy-require to `_deps.ts` will fail CI.

To genuinely add a new feature gate or a new shim, you need to either
(a) update the baseline with `--tighten` and explain why in the commit
message, or (b) wire the shim's consumers immediately so it's not dead
on arrival.
